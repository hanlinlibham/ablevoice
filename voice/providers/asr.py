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
``paraformer-realtime-v2`` over their inference WS. Protocol:
    1. connect with Authorization bearer <key>
    2. send JSON ``run-task`` (task_group=audio / task=asr / function=
       recognition, model, sample_rate, format=pcm)
    3. wait for header.event == ``task-started``
    4. send binary PCM frames (int16 LE, mono)
    5. JSON ``result-generated`` events carry cumulative text on
       payload.output.sentence.text — forward each as a partial
    6. send ``finish-task`` → wait for ``task-finished`` → take last
       partial text as the final transcript
"""

from __future__ import annotations

import asyncio
import json
import logging
import ssl
import time
import uuid
from typing import Awaitable, Callable, Optional

import websockets as _wspkg

from ..config import settings
from ..runtime import mlx_call

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

class DashscopeRealtimeAsr:
    """Bridge from our /ws PCM stream to DashScope's paraformer-realtime
    WebSocket. Owns one upstream WS per recording."""

    def __init__(self, sample_rate: int, on_partial: OnPartial):
        self._sr = sample_rate
        self._on_partial = on_partial
        self._ws = None
        self._task_id = uuid.uuid4().hex
        self._last_text = ""
        self._started = asyncio.Event()
        self._finished = asyncio.Event()
        self._reader_task: Optional[asyncio.Task] = None

    @property
    def model_id(self) -> str:
        return f"dashscope:{settings.asr.ds_model}"

    async def start(self) -> None:
        if not settings.llm.ds_api_key:
            raise RuntimeError("ASR_PROVIDER=dashscope but DASHSCOPE_API_KEY not set")
        sslctx = ssl.create_default_context()
        sslctx.check_hostname = False
        sslctx.verify_mode = ssl.CERT_NONE
        self._ws = await _wspkg.connect(
            settings.asr.ds_ws_url,
            additional_headers={
                "Authorization": f"bearer {settings.llm.ds_api_key}",
                "X-DashScope-DataInspection": "enable",
            },
            ssl=sslctx,
            max_size=None,
        )
        await self._ws.send(json.dumps({
            "header": {"action": "run-task", "task_id": self._task_id, "streaming": "duplex"},
            "payload": {
                "task_group": "audio",
                "task": "asr",
                "function": "recognition",
                "model": settings.asr.ds_model,
                "parameters": {
                    "sample_rate": self._sr,
                    "format": "pcm",
                    "language_hints": [settings.asr.ds_lang],
                },
                "input": {},
            },
        }))
        self._reader_task = asyncio.create_task(self._reader(), name="ds-asr-reader")
        # Block briefly until upstream confirms task-started — otherwise
        # the first PCM frames would race the run-task and be dropped.
        await asyncio.wait_for(self._started.wait(), timeout=5)

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
                        self._last_text = text
                        try:
                            # Cloud doesn't separate stable from current text
                            # — pass empty so caller falls back to full text.
                            await self._on_partial(text, "")
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
