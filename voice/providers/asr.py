"""ASR provider implementations.

Two streaming sessions (start/feed/finish/cancel) — MLX local + DashScope
cloud realtime — plus a tiny lazy-loader for the MLX Session that the
HTTP /transcribe path also reuses.

MLX path
========
``mlx_qwen3_asr.Session`` exposes ``init_streaming() / feed_audio() /
finish_streaming()``. We adapt that to our AsrSession protocol; every
MLX call runs through ``runtime.mlx_call`` to stay on the single GPU-
stream thread (see runtime.py for why).

DashScope realtime path
=======================
Two cloud models, two DIFFERENT endpoints + protocols — one provider
class each:

  - ``paraformer-realtime-v2`` (default) → ``DashscopeRealtimeAsr``
    Endpoint ``api-ws/v1/inference/``; run-task / result-generated /
    finish-task frames. Binary PCM frames. Hotwords via
    ``parameters.vocabulary_id`` (DASHSCOPE_ASR_VOCABULARY_ID, managed
    cloud-side via scripts/manage_vocabulary.py).

  - ``qwen3-asr-flash-realtime`` → ``DashscopeQwenRealtimeAsr``
    Endpoint ``api-ws/v1/realtime?model=…``; OpenAI-Realtime-style
    events (session.update / input_audio_buffer.append [base64 PCM] /
    commit / session.finish; results on
    conversation.item.input_audio_transcription.text + .completed).

NOTE: an earlier revision claimed both models shared the inference
endpoint and run-task shape — that was wrong (DashScope returns
"Model not found" for qwen3 on the inference endpoint). They are
genuinely different wire protocols; ``get_asr`` routes by model name.

To A/B test qwen3 vs paraformer:
    DASHSCOPE_ASR_MODEL=qwen3-asr-flash-realtime ./start-tui.sh
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import ssl
import time
import uuid
from typing import Awaitable, Callable, Optional

import websockets as _wspkg

from ..config import settings
from ..runtime import mlx_call, with_retries

logger = logging.getLogger("voice.providers.asr")

OnPartial = Callable[[str, str], Awaitable[None]]  # (text, stable_text)


# --- MLX session (lazy, single global) --------------------------------------

_mlx_session = None  # type: ignore[assignment]


def ensure_mlx_session():
    """Lazy-load mlx-qwen3-asr Session — keep it global so subsequent
    requests reuse the warmed model + tokenizer."""
    global _mlx_session
    if _mlx_session is None:
        from mlx_qwen3_asr import Session  # noqa: PLC0415 — heavy import
        t0 = time.monotonic()
        logger.info("loading ASR model: %s", settings.asr.mlx_model)
        _mlx_session = Session(model=settings.asr.mlx_model)
        logger.info("session ready in %.2fs", time.monotonic() - t0)
    return _mlx_session


def mlx_session_loaded() -> bool:
    return _mlx_session is not None


# --- MLX streaming AsrSession ----------------------------------------------

class MlxStreamingAsr:
    """Wraps ``mlx_qwen3_asr.Session.init_streaming`` etc. behind the
    AsrSession protocol. Emits a partial whenever ``state.text`` changes
    so callers get the same update cadence as the cloud bridge."""

    def __init__(self, sample_rate: int, on_partial: OnPartial):
        self._sr = sample_rate
        self._on_partial = on_partial
        self._state = None
        self._last_text = ""

    @property
    def model_id(self) -> str:
        return settings.asr.mlx_model

    async def start(self) -> None:
        def _init():
            sess = ensure_mlx_session()
            return sess.init_streaming(
                sample_rate=self._sr,
                chunk_size_sec=settings.asr.stream_chunk_sec,
            )
        self._state = await mlx_call(_init)

    async def feed(self, pcm_bytes: bytes) -> None:
        if self._state is None:
            return
        import numpy as np  # noqa: PLC0415

        def _feed(state, raw: bytes):
            sess = ensure_mlx_session()
            samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
            return sess.feed_audio(samples, state)

        self._state = await mlx_call(_feed, self._state, pcm_bytes)
        cur = self._state.text
        if cur != self._last_text:
            self._last_text = cur
            await self._on_partial(cur, self._state.stable_text or "")

    async def finish(self) -> str:
        if self._state is None:
            return ""

        def _finish(state):
            sess = ensure_mlx_session()
            return sess.finish_streaming(state)

        self._state = await mlx_call(_finish, self._state)
        return self._state.text or ""

    async def cancel(self) -> None:
        # MLX streaming session is pure local state — just drop it.
        self._state = None


# --- DashScope realtime AsrSession ------------------------------------------

def _build_run_task_payload(
    *, model: str, sample_rate: int, lang: str,
    task_id: str, vocabulary_id: str = "", context: str = "",
) -> dict:
    """Assemble the DashScope inference WS ``run-task`` frame. Pure /
    no I/O so unit tests can pin the wire shape across both ASR model
    routes (paraformer vs qwen3-asr-flash-realtime).

    Hotword fields are conditional:
      - non-empty ``vocabulary_id`` → ``parameters.vocabulary_id`` (paraformer)
      - non-empty ``context``       → ``input.context`` (qwen3-asr)
    Both can be set without harm; each model ignores the other's field.
    """
    params: dict = {
        "sample_rate": sample_rate,
        "format": "pcm",
        "language_hints": [lang],
    }
    if vocabulary_id:
        params["vocabulary_id"] = vocabulary_id
    input_payload: dict = {}
    if context:
        input_payload["context"] = context
    return {
        "header": {"action": "run-task", "task_id": task_id, "streaming": "duplex"},
        "payload": {
            "task_group": "audio",
            "task": "asr",
            "function": "recognition",
            "model": model,
            "parameters": params,
            "input": input_payload,
        },
    }


def _common_prefix(a: str, b: str) -> str:
    """Longest common prefix of two strings — used by the LocalAgreement-2
    stabilizer in ``DashscopeRealtimeAsr``. Pure / no I/O, kept module-level
    so unit tests can hit it directly without spinning up a session."""
    if not a or not b:
        return ""
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    return a[:i]


class DashscopeRealtimeAsr:
    """Bridge from our /ws PCM stream to DashScope's paraformer-realtime
    WebSocket. Owns one upstream WS per recording."""

    def __init__(self, sample_rate: int, on_partial: OnPartial):
        self._sr = sample_rate
        self._on_partial = on_partial
        self._ws = None
        self._task_id = uuid.uuid4().hex
        self._last_text = ""
        # LocalAgreement-2 partial stabilization. ``_committed_text`` is
        # the longest prefix that has appeared in two consecutive partials —
        # safe to render in normal weight in the UI. The trailing portion of
        # ``_last_text`` past ``_committed_text`` is "tentative" and should be
        # rendered dimmed/grey so users don't get jarred by re-writes.
        # Monotone: once a prefix is committed, it cannot retract.
        self._committed_text = ""
        self._started = asyncio.Event()
        self._finished = asyncio.Event()
        self._reader_task: Optional[asyncio.Task] = None

    @property
    def model_id(self) -> str:
        return f"dashscope:{settings.dashscope.asr_model}"

    async def start(self) -> None:
        if not settings.dashscope.api_key:
            raise RuntimeError("ASR_PROVIDER=dashscope but DASHSCOPE_API_KEY not set")

        async def _attempt() -> None:
            sslctx = ssl.create_default_context()
            sslctx.check_hostname = False
            sslctx.verify_mode = ssl.CERT_NONE
            self._ws = await _wspkg.connect(
                settings.dashscope.asr_ws_url,
                additional_headers={
                    "Authorization": f"bearer {settings.dashscope.api_key}",
                    "X-DashScope-DataInspection": "enable",
                },
                ssl=sslctx,
                max_size=None,
            )
            # Fresh started Event per attempt — a prior attempt that
            # almost-succeeded shouldn't poison the next one.
            self._started = asyncio.Event()
            self._finished = asyncio.Event()
            # Hotword biasing — see _build_run_task_payload for the dual
            # paraformer (vocabulary_id) vs qwen3-asr (context) routes.
            payload = _build_run_task_payload(
                model=settings.dashscope.asr_model,
                sample_rate=self._sr,
                lang=settings.dashscope.asr_lang,
                task_id=self._task_id,
                vocabulary_id=settings.dashscope.asr_vocabulary_id,
                context=settings.dashscope.asr_context,
            )
            await self._ws.send(json.dumps(payload))
            self._reader_task = asyncio.create_task(self._reader(), name="ds-asr-reader")
            # Block briefly until upstream confirms task-started —
            # otherwise the first PCM frames would race the run-task
            # and be dropped. wait_for TimeoutError is retryable.
            await asyncio.wait_for(self._started.wait(), timeout=5)

        await with_retries(_attempt)

    async def _reader(self) -> None:
        try:
            async for msg in self._ws:
                if not isinstance(msg, str):
                    continue
                try:
                    ev = json.loads(msg)
                except json.JSONDecodeError:
                    continue
                header = ev.get("header", {}) or {}
                event = header.get("event")
                if event == "task-started":
                    self._started.set()
                elif event == "result-generated":
                    sentence = ((ev.get("payload") or {}).get("output") or {}).get("sentence") or {}
                    text = sentence.get("text") or ""
                    if text and text != self._last_text:
                        # LocalAgreement-2: a prefix is "committed" once it
                        # has appeared in two consecutive partials. We compute
                        # agreement = lcp(prev_partial, cur_partial) and only
                        # extend committed_text — never shrink (rewrites are
                        # tentative, never undo a commit).
                        prev = self._last_text
                        agreement = _common_prefix(prev, text)
                        if len(agreement) > len(self._committed_text):
                            self._committed_text = agreement
                        self._last_text = text
                        try:
                            await self._on_partial(text, self._committed_text)
                        except Exception:
                            logger.exception("on_partial callback raised")
                elif event in ("task-finished", "task-failed"):
                    if event == "task-failed":
                        logger.warning("dashscope ASR task-failed: %s",
                                       header.get("error_message"))
                    break
        except _wspkg.exceptions.ConnectionClosed:
            pass
        except Exception:
            logger.exception("dashscope ASR reader crashed")
        finally:
            self._started.set()   # unblock start() even on early failure
            self._finished.set()

    async def feed(self, pcm_bytes: bytes) -> None:
        """Forward a binary PCM frame to upstream. No-op if the session
        is already finishing — keeps callers from raising on race."""
        if self._ws is None or self._finished.is_set():
            return
        try:
            await self._ws.send(pcm_bytes)
        except _wspkg.exceptions.ConnectionClosed:
            self._finished.set()

    async def finish(self) -> str:
        if self._ws is None:
            return self._last_text
        try:
            await self._ws.send(json.dumps({
                "header": {"action": "finish-task", "task_id": self._task_id, "streaming": "duplex"},
                "payload": {"input": {}},
            }))
        except Exception:
            pass
        try:
            await asyncio.wait_for(self._finished.wait(), timeout=10)
        except asyncio.TimeoutError:
            logger.warning("dashscope ASR finish-task timeout")
        try:
            await self._ws.close()
        except Exception:
            pass
        return self._last_text

    async def cancel(self) -> None:
        if self._ws is not None:
            try: await self._ws.close()
            except Exception: pass
        self._finished.set()
        if self._reader_task is not None and not self._reader_task.done():
            self._reader_task.cancel()
            try: await self._reader_task
            except Exception: pass


# --- DashScope qwen3-asr-flash-realtime AsrSession --------------------------

class DashscopeQwenRealtimeAsr:
    """Bridge to ``qwen3-asr-flash-realtime`` over DashScope's
    OpenAI-Realtime-style WS (``api-ws/v1/realtime``). Distinct endpoint +
    event shape from the paraformer run-task protocol — see module docstring.

    Two turn modes (DASHSCOPE_ASR_REALTIME_VAD):

      - VAD (server_vad, default): the server transcribes DURING speech and
        streams ``…transcription.text`` partials; each detected turn ends
        with a ``…transcription.completed``. We accumulate completed
        segments and flush the tail with ``session.finish`` on stop. Lower
        finalize latency (transcription overlaps recording) + live partials.

      - manual (turn_detection null): all PCM is buffered, then ``commit`` +
        ``session.finish`` on stop produce one ``…completed``. No partials.

    Audio is base64-encoded PCM16 in ``input_audio_buffer.append`` frames
    (this protocol has no binary frame mode, unlike paraformer)."""

    def __init__(self, sample_rate: int, on_partial: OnPartial):
        self._sr = sample_rate
        self._on_partial = on_partial
        self._ws = None
        self._last_text = ""
        self._segments: list[str] = []     # one per …transcription.completed
        self._ready = asyncio.Event()      # session.created / session.updated
        self._completed = asyncio.Event()  # session end / socket close
        self._reader_task: Optional[asyncio.Task] = None

    @property
    def model_id(self) -> str:
        return f"dashscope:{settings.dashscope.asr_model}"

    def _url(self) -> str:
        base = settings.dashscope.asr_realtime_ws_url.rstrip("/")
        return f"{base}?model={settings.dashscope.asr_model}"

    async def start(self) -> None:
        if not settings.dashscope.api_key:
            raise RuntimeError("ASR_PROVIDER=dashscope but DASHSCOPE_API_KEY not set")

        async def _attempt() -> None:
            sslctx = ssl.create_default_context()
            sslctx.check_hostname = False
            sslctx.verify_mode = ssl.CERT_NONE
            self._ws = await _wspkg.connect(
                self._url(),
                additional_headers={"Authorization": f"bearer {settings.dashscope.api_key}"},
                ssl=sslctx,
                max_size=None,
            )
            self._ready = asyncio.Event()
            self._completed = asyncio.Event()
            self._reader_task = asyncio.create_task(self._reader(), name="qwen-asr-reader")
            # Configure the session: PCM16 @ sr + language hint. VAD mode
            # streams partials and overlaps transcription with recording;
            # manual mode (null) waits for our explicit commit on stop.
            turn_detection = (
                {"type": "server_vad",
                 "silence_duration_ms": settings.dashscope.asr_realtime_silence_ms}
                if settings.dashscope.asr_realtime_vad else None
            )
            await self._ws.send(json.dumps({
                "event_id": uuid.uuid4().hex,
                "type": "session.update",
                "session": {
                    "modalities": ["text"],
                    "input_audio_format": "pcm",
                    "sample_rate": self._sr,
                    "input_audio_transcription": {"language": settings.dashscope.asr_lang},
                    "turn_detection": turn_detection,
                },
            }))
            # Wait until the server acks the session is live before feeding
            # audio — otherwise early appends race the session.update.
            await asyncio.wait_for(self._ready.wait(), timeout=5)

        await with_retries(_attempt)

    async def _reader(self) -> None:
        try:
            async for msg in self._ws:
                if not isinstance(msg, str):
                    continue
                try:
                    ev = json.loads(msg)
                except json.JSONDecodeError:
                    continue
                t = ev.get("type")
                if t in ("session.created", "session.updated"):
                    self._ready.set()
                elif t == "conversation.item.input_audio_transcription.text":
                    text = ev.get("text") or ""
                    if text and text != self._last_text:
                        self._last_text = text
                        # No separate stable-prefix from this protocol — pass
                        # text as both current + committed (UI just renders it).
                        try:
                            await self._on_partial(text, text)
                        except Exception:
                            logger.exception("on_partial callback raised")
                elif t == "conversation.item.input_audio_transcription.completed":
                    tr = ev.get("transcript") or ""
                    if tr:
                        self._segments.append(tr)
                        self._last_text = tr
                    # Manual mode = a single turn, so this IS the final →
                    # unblock finish() now. VAD mode may produce more turns;
                    # wait for the session-end event instead.
                    if not settings.dashscope.asr_realtime_vad:
                        self._completed.set()
                elif t == "error":
                    logger.warning("qwen3-asr realtime error: %s",
                                   ev.get("error") or ev.get("message") or ev)
                elif t in ("session.finished", "session.done"):
                    self._completed.set()
                    break
        except _wspkg.exceptions.ConnectionClosed:
            pass
        except Exception:
            logger.exception("qwen3-asr realtime reader crashed")
        finally:
            self._ready.set()      # unblock start() even on early failure
            self._completed.set()  # unblock finish()

    async def feed(self, pcm_bytes: bytes) -> None:
        if self._ws is None or self._completed.is_set():
            return
        try:
            await self._ws.send(json.dumps({
                "event_id": uuid.uuid4().hex,
                "type": "input_audio_buffer.append",
                "audio": base64.b64encode(pcm_bytes).decode("ascii"),
            }))
        except _wspkg.exceptions.ConnectionClosed:
            self._completed.set()

    async def finish(self) -> str:
        if self._ws is None:
            return self._last_text
        try:
            # Manual mode: submit the buffered audio. VAD mode auto-commits
            # on silence, so an explicit commit can error — just finish.
            if not settings.dashscope.asr_realtime_vad:
                await self._ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
            await self._ws.send(json.dumps({"type": "session.finish"}))
        except Exception:
            pass
        try:
            await asyncio.wait_for(self._completed.wait(), timeout=10)
        except asyncio.TimeoutError:
            logger.warning("qwen3-asr realtime finish timeout")
        try:
            await self._ws.close()
        except Exception:
            pass
        # Chinese has no inter-word spaces; join VAD segments directly.
        return "".join(self._segments) or self._last_text

    async def cancel(self) -> None:
        if self._ws is not None:
            try: await self._ws.close()
            except Exception: pass
        self._completed.set()
        if self._reader_task is not None and not self._reader_task.done():
            self._reader_task.cancel()
            try: await self._reader_task
            except Exception: pass
