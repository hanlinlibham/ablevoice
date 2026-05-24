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

from .audio import pop_speakable
from .config import settings
from .polish import polish_text
from .providers import get_llm, get_tts
from .providers.llm import reset_ablework_session
from .runtime import mlx_call

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

    async def llm_task() -> None:
        nonlocal text_buf, full_text
        first_chunk_pending = True
        try:
            async for delta in llm.stream(payload_messages, session_id):
                full_text += delta
                text_buf += delta
                await emit("token", {"delta": delta})
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
        finally:
            await tts_q.put(None)

    async def tts_task() -> None:
        nonlocal n_audio
        while True:
            sent = await tts_q.get()
            if sent is None:
                break
            t0 = time.monotonic()
            try:
                wav_bytes, sr, n_samples = await tts.synth(sent)
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

    await emit("meta", {"model": llm.model_id, "voice": settings.tts.voice})
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


async def synth_one(text: str) -> tuple[bytes, int, int]:
    """One-shot TTS — for the /tts HTTP endpoint and the WS ``tts``
    event. Returns ``(wav_bytes, sample_rate, n_samples)``."""
    tts = get_tts()
    return await tts.synth(text)
