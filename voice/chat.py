"""Chat pipeline — LLM stream → sentence split → TTS chunks → emit.

Pipeline shape
==============

  LLM stream (chars)
        │
        ├── ``token``  events       (UI shows text as it arrives)
        │
        ▼ split-at-punctuation
  sentence queue
        │
        ▼ TTS worker
  audio chunks (b64-encoded WAV)
        │
        ▼
  ``audio_chunk`` events             (UI sequential-plays from queue)

Two queues + worker because the TTS call blocks for hundreds of ms per
sentence. If the same coroutine that reads the LLM also blocks on TTS,
downstream tokens stall and the UI stops updating mid-reply. With a
worker, the LLM keeps pouring text while TTS cranks through whatever
sentences are queued.

Cancellation
============
``task.cancel()`` the coroutine running ``run_chat_pipeline``. The two
sub-tasks are cancelled, the partial assistant turn is NOT appended to
history (we don't want to remember a half-spoken reply), and ``done``
is NOT emitted. Caller (WS handler) emits its own ``interrupted``.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from typing import Awaitable, Callable, Optional

from .audio import (
    pop_speakable,
    strip_terminated_links_and_urls,
    strip_tts_unfriendly,
    wrap_pcm_int16_as_wav,
)
from .config import settings
from .polish import polish_text
from .providers import get_llm, get_tts
from .providers.llm import reset_ablework_session
from .runtime import (
    RETRY_ATTEMPTS,
    RETRY_FACTOR,
    RETRY_INITIAL_DELAY,
    is_retryable_error,
    mlx_call,
    with_retries,
)

logger = logging.getLogger("voice.chat")

# In-memory conversation store: session_id -> [{"role", "content"}].
# Lives only for the server's lifetime — restart = fresh slate.
_conversations: dict[str, list[dict[str, str]]] = {}


def get_conversation(session_id: str) -> list[dict[str, str]]:
    return list(_conversations.get(session_id, []))


def reset_conversation(session_id: str) -> int:
    """Wipe history for a session. Returns prior message count."""
    prior = len(_conversations.get(session_id, []))
    _conversations.pop(session_id, None)
    reset_ablework_session(session_id)
    return prior


Emit = Callable[[str, dict], Awaitable[None]]


async def run_chat_pipeline(
    session_id: str,
    user_text: str,
    emit: Emit,
    *,
    polished_text: Optional[str] = None,
    voice_override: Optional[str] = None,
    workspace_id: Optional[str] = None,
    speech_rate_override: Optional[float] = None,
    volume_override: Optional[float] = None,
) -> dict:
    """Run one chat turn — (optional) polish → LLM streaming + sentence-
    level TTS — and push progress to ``emit``. Transport-agnostic (called
    from both the /chat SSE adapter and the /ws WebSocket handler).

    Polish dispatch:
      - if ``polished_text`` is passed (e.g. /ws already polished + emitted
        ``transcript_polished``), use it directly — no second polish call
      - else if ``settings.polish.use_polished_for_chat`` is True, run
        polish_text() internally and use ``.final``
      - else, skip polish entirely

    Events emitted (in order):

      ``meta``        once at start         ``{model, voice}``
      ``token``       per LLM delta         ``{delta}``
      ``audio_chunk`` per speakable chunk   ``{text, b64, dur_ms, synth_ms, idx}``
      ``done``        once at end          ``{full_text, total_ms, n_audio, history_len}``
      ``error``       on failure            ``{message}``

    Returns the same summary dict as the ``done`` event for callers
    that want a return value instead of just listening to events.
    """
    llm = get_llm()
    tts = get_tts()

    # Resolve effective user text. Polish is best-effort — on any failure
    # we fall back to raw (polish_text() never raises).
    if polished_text is not None:
        effective_text = polished_text
    elif settings.polish.use_polished_for_chat:
        result = await polish_text(user_text)
        effective_text = result.final
        if not result.skipped:
            await emit("polish", {
                "raw": result.raw, "final": result.final,
                "skipped": result.skipped, "ok": result.ok,
                "attempts": result.attempts, "ms": result.ms,
            })
    else:
        effective_text = user_text

    history = _conversations.setdefault(session_id, [])
    history.append({"role": "user", "content": effective_text})
    payload_messages = [
        {"role": "system", "content": settings.llm.system_prompt},
        *history,
    ]

    t_started = time.monotonic()
    full_text = ""
    text_buf = ""
    n_audio = 0
    tts_q: asyncio.Queue[Optional[str]] = asyncio.Queue()

    # Try the streaming TTS path. Providers without duplex support
    # return None; we fall through to the per-sentence path below.
    stream_sess = tts.stream(
        voice=voice_override,
        speech_rate=speech_rate_override,
        volume=volume_override,
    )
    if stream_sess is not None:
        try:
            await stream_sess.open()
        except Exception as exc:  # noqa: BLE001
            logger.exception("realtime TTS open failed — falling back to per-sentence")
            await emit("error", {"where": "tts_open",
                                 "message": f"{type(exc).__name__}: {exc}"})
            stream_sess = None

    if stream_sess is not None:
        await emit("meta", {"model": llm.model_id,
                            "voice": voice_override or settings.tts.voice})
        summary = await _run_streaming_chat(
            session_id=session_id,
            user_text=user_text,
            full_text_start=full_text,
            history=history,
            payload_messages=payload_messages,
            llm=llm,
            stream_sess=stream_sess,
            emit=emit,
            t_started=t_started,
            workspace_id=workspace_id,
        )
        await emit("done", summary)
        return summary

    async def llm_task() -> None:
        nonlocal text_buf, full_text
        first_chunk_pending = True
        yielded_any = False

        async def _consume_one_stream() -> None:
            """One full pass through the upstream LLM stream. Sets
            ``yielded_any`` on the first delta so the retry loop knows
            it can no longer safely retry (retrying mid-stream would
            duplicate tokens the user already saw)."""
            nonlocal first_chunk_pending, full_text, text_buf, yielded_any
            async for delta in llm.stream(payload_messages, session_id, workspace_id=workspace_id):
                yielded_any = True
                full_text += delta
                text_buf += delta
                await emit("token", {"delta": delta})
                # Strip terminated URLs / markdown links from the buffer
                # BEFORE the sentence splitter sees it — so the splitter
                # doesn't accidentally cut inside a URL on the ``.``
                # between ``tw.trip``. Partial constructs (still being
                # typed) survive until they close.
                text_buf = strip_terminated_links_and_urls(text_buf)
                while True:
                    chunk, rest = pop_speakable(
                        text_buf, force=False, is_first=first_chunk_pending,
                    )
                    if chunk is None:
                        break
                    text_buf = rest
                    first_chunk_pending = False
                    await tts_q.put(chunk)
            if text_buf.strip():
                await tts_q.put(text_buf)
                text_buf = ""

        try:
            # Retry the initial connect / first-response when the upstream
            # gives a transient failure (e.g. ablework nginx 502 during
            # an upstream restart). Once tokens start flowing we don't
            # retry — that would duplicate output the user already saw.
            delay = RETRY_INITIAL_DELAY
            for attempt in range(1, RETRY_ATTEMPTS + 1):
                try:
                    await _consume_one_stream()
                    break
                except BaseException as exc:
                    if (
                        yielded_any
                        or attempt >= RETRY_ATTEMPTS
                        or not is_retryable_error(exc)
                    ):
                        raise
                    await emit("retry", {
                        "where": "llm",
                        "attempt": attempt,
                        "max_attempts": RETRY_ATTEMPTS,
                        "wait_ms": int(delay * 1000),
                        "reason": f"{type(exc).__name__}: {str(exc)[:80]}",
                    })
                    logger.warning(
                        "LLM retry attempt=%d/%d after %s — waiting %.1fs",
                        attempt, RETRY_ATTEMPTS, type(exc).__name__, delay,
                    )
                    await asyncio.sleep(delay)
                    delay *= RETRY_FACTOR
        finally:
            await tts_q.put(None)

    async def tts_task() -> None:
        nonlocal n_audio
        while True:
            sent = await tts_q.get()
            if sent is None:
                break
            # Strip TTS-unfriendly tokens (stock codes, English tickers)
            # before synth. The original sentence still goes back to the
            # client in ``text`` so the UI shows the LLM's actual output.
            spoken = strip_tts_unfriendly(sent)
            t0 = time.monotonic()

            def _notify_tts_retry(att: int, exc: BaseException, dly: float) -> None:
                # ``on_retry`` is sync; schedule the emit as a side task
                # so the retry loop can keep timing.
                asyncio.create_task(emit("retry", {
                    "where": "tts",
                    "attempt": att,
                    "max_attempts": RETRY_ATTEMPTS,
                    "wait_ms": int(dly * 1000),
                    "reason": f"{type(exc).__name__}: {str(exc)[:80]}",
                }))

            try:
                wav_bytes, sr, n_samples = await with_retries(
                    lambda: tts.synth(spoken, voice=voice_override),
                    on_retry=_notify_tts_retry,
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception("tts_task failed for: %r", sent[:80])
                await emit("error", {"message": f"TTS: {exc}"})
                continue
            synth_ms = int((time.monotonic() - t0) * 1000)
            n_audio += 1
            dur_ms = int(1000 * n_samples / sr) if n_samples and sr else 0
            b64 = base64.b64encode(wav_bytes).decode("ascii") if wav_bytes else ""
            await emit("audio_chunk", {
                "text": sent,
                "b64": b64,
                "dur_ms": dur_ms,
                "synth_ms": synth_ms,
                "idx": n_audio,
            })

    await emit("meta", {"model": llm.model_id, "voice": voice_override or settings.tts.voice})
    llm_t = asyncio.create_task(llm_task(), name="chat-llm")
    tts_t = asyncio.create_task(tts_task(), name="chat-tts")
    try:
        await llm_t
        await tts_t
    except asyncio.CancelledError:
        for t in (llm_t, tts_t):
            if not t.done():
                t.cancel()
        for t in (llm_t, tts_t):
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass
        logger.info("chat cancelled session=%s after %d chars", session_id[:8], len(full_text))
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("llm_task failed")
        await emit("error", {"message": f"LLM: {type(exc).__name__}: {exc}"})
        if not tts_t.done():
            tts_t.cancel()
            try:
                await tts_t
            except (asyncio.CancelledError, Exception):
                pass

    if full_text.strip():
        history.append({"role": "assistant", "content": full_text})
    total_ms = int((time.monotonic() - t_started) * 1000)
    summary = {
        "full_text": full_text,
        "total_ms": total_ms,
        "n_audio": n_audio,
        "history_len": len(history),
    }
    logger.info(
        "chat session=%s %d→%d chars, %d audio chunks, %dms total",
        session_id[:8], len(user_text), len(full_text), n_audio, total_ms,
    )
    await emit("done", summary)
    return summary


async def synth_one(text: str, *, voice: Optional[str] = None) -> tuple[bytes, int, int]:
    """One-shot TTS — for the /tts HTTP endpoint and the WS ``tts``
    event. Returns ``(wav_bytes, sample_rate, n_samples)``."""
    tts = get_tts()
    return await tts.synth(text, voice=voice)


# --- Streaming TTS chat path ------------------------------------------------

async def _run_streaming_chat(
    *,
    session_id: str,
    user_text: str,
    full_text_start: str,
    history: list,
    payload_messages: list,
    llm,
    stream_sess,
    emit: Emit,
    t_started: float,
    workspace_id: Optional[str] = None,
) -> dict:
    """LLM deltas → stream_sess.append; stream_sess.audio_frames → emit
    audio_chunk. Two concurrent tasks share state via closure.

    On normal completion: send session.finish, drain remaining audio,
    return summary. On cancellation: stream_sess.cancel() + re-raise so
    the WS handler emits its own ``interrupted`` event."""
    full_text = full_text_start
    n_audio = 0
    sr = stream_sess.sample_rate

    async def llm_task() -> None:
        nonlocal full_text
        yielded_any = False

        async def _consume() -> None:
            nonlocal full_text, yielded_any
            async for delta in llm.stream(payload_messages, session_id, workspace_id=workspace_id):
                yielded_any = True
                full_text += delta
                await emit("token", {"delta": delta})
                # ``strip_tts_unfriendly`` is conservative — it only
                # rewrites whole tokens (stock codes, ASCII tickers).
                # Per-delta application can miss patterns split across
                # deltas (e.g. ``600`` + ``519.SH``), but the upstream
                # server segments on natural pauses anyway, so missing
                # a partial pattern only costs a slightly awkward read.
                safe = strip_tts_unfriendly(delta)
                if safe:
                    try:
                        await stream_sess.append(safe)
                    except Exception as exc:  # noqa: BLE001
                        logger.exception("stream_sess.append failed")
                        await emit("error", {"where": "tts_append",
                                             "message": f"{type(exc).__name__}: {exc}"})
                        raise

        try:
            delay = RETRY_INITIAL_DELAY
            for attempt in range(1, RETRY_ATTEMPTS + 1):
                try:
                    await _consume()
                    break
                except BaseException as exc:
                    if (
                        yielded_any
                        or attempt >= RETRY_ATTEMPTS
                        or not is_retryable_error(exc)
                    ):
                        raise
                    await emit("retry", {
                        "where": "llm",
                        "attempt": attempt,
                        "max_attempts": RETRY_ATTEMPTS,
                        "wait_ms": int(delay * 1000),
                        "reason": f"{type(exc).__name__}: {str(exc)[:80]}",
                    })
                    logger.warning(
                        "LLM retry attempt=%d/%d after %s — waiting %.1fs",
                        attempt, RETRY_ATTEMPTS, type(exc).__name__, delay,
                    )
                    await asyncio.sleep(delay)
                    delay *= RETRY_FACTOR
        finally:
            # Always close the input side so the upstream knows we're
            # done — even on errors, so it can drain the remaining audio.
            try:
                await stream_sess.finish()
            except Exception:  # noqa: BLE001
                logger.exception("stream_sess.finish failed")

    async def audio_task() -> None:
        nonlocal n_audio
        async for pcm in stream_sess.audio_frames():
            n_audio += 1
            # Each ``response.audio.delta`` is int16 LE PCM at sr; wrap
            # in a 44-byte WAV header so the client UI's existing audio
            # element handles it without changes. Mini-WAVs concatenate
            # gaplessly because we don't add silence padding here.
            wav_bytes = wrap_pcm_int16_as_wav(pcm, sr)
            dur_ms = int(1000 * (len(pcm) // 2) / sr) if sr else 0
            b64 = base64.b64encode(wav_bytes).decode("ascii")
            await emit("audio_chunk", {
                "text": "",        # text comes via token events; this is a streaming chunk
                "b64": b64,
                "dur_ms": dur_ms,
                "synth_ms": 0,    # not meaningful for delta chunks
                "idx": n_audio,
            })

    llm_t = asyncio.create_task(llm_task(), name="chat-llm-rt")
    audio_t = asyncio.create_task(audio_task(), name="chat-audio-rt")
    try:
        await llm_t
        await audio_t
    except asyncio.CancelledError:
        # Abrupt cancel — the WS handler triggered an interrupt. Close
        # the upstream so we stop receiving billed audio, then cancel
        # the sub-tasks.
        try:
            await stream_sess.cancel()
        except Exception:
            pass
        for t in (llm_t, audio_t):
            if not t.done():
                t.cancel()
        for t in (llm_t, audio_t):
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass
        logger.info(
            "chat (streaming) cancelled session=%s after %d chars",
            session_id[:8], len(full_text),
        )
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("streaming LLM task failed")
        await emit("error", {"message": f"LLM: {type(exc).__name__}: {exc}"})
        try:
            await stream_sess.cancel()
        except Exception:
            pass
        if not audio_t.done():
            audio_t.cancel()
            try:
                await audio_t
            except (asyncio.CancelledError, Exception):
                pass

    if full_text.strip():
        history.append({"role": "assistant", "content": full_text})
    total_ms = int((time.monotonic() - t_started) * 1000)
    summary = {
        "full_text": full_text,
        "total_ms": total_ms,
        "n_audio": n_audio,
        "history_len": len(history),
    }
    logger.info(
        "chat (streaming) session=%s %d→%d chars, %d audio chunks, %dms total",
        session_id[:8], len(user_text), len(full_text), n_audio, total_ms,
    )
    return summary
