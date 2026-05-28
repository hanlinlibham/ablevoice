"""TTS provider implementations — MLX local + DashScope cloud.

Both return ``(wav_bytes, sample_rate, n_samples)`` and run their
output through ``audio.pcm_float_to_wav_bytes`` so trim + RMS-normalise
applies uniformly across providers and chunks sound consistent end-to-
end. Cloud path fetches the hosted WAV, decodes int16 → float32, and
re-encodes through the same path.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import ssl
import time
import uuid
import wave
from typing import AsyncIterator, Optional

import httpx
import websockets as _wspkg

from ..audio import pcm_float_to_wav_bytes
from ..config import settings
from ..runtime import mlx_call

logger = logging.getLogger("voice.providers.tts")


# --- MLX local (CustomVoice / VoiceDesign / Base) ---------------------------

_mlx_tts = None
_mlx_ref_audio = None  # mx.array, set during warmup for Base anchoring


def ensure_mlx_tts():
    """Lazy-load mlx-audio TTS model. Same warm-then-reuse pattern as
    the ASR session — first call pays download + load (~10s on warm HF
    cache, much more cold), subsequent calls just hit the model."""
    global _mlx_tts
    if _mlx_tts is None:
        from mlx_audio.tts.utils import load_model  # noqa: PLC0415 — heavy
        t0 = time.monotonic()
        logger.info("loading TTS model: %s", settings.tts.mlx_model)
        _mlx_tts = load_model(settings.tts.mlx_model)
        logger.info("TTS model ready in %.2fs", time.monotonic() - t0)
    return _mlx_tts


def mlx_tts_loaded() -> bool:
    return _mlx_tts is not None


def mlx_tts_voices() -> list[str]:
    if _mlx_tts is None:
        return []
    try:
        return list(_mlx_tts.get_supported_speakers() or [])
    except Exception:
        return []


def mlx_tts_variant() -> Optional[str]:
    if _mlx_tts is None:
        return None
    return getattr(_mlx_tts.config, "tts_model_type", "base")


def ensure_mlx_tts_ref():
    """Synthesise the reference clip used to anchor voice across calls.

    Only meaningful for Base TTS (unconditional speaker model). Called
    once during warmup. Uses a fixed seed so the reference itself is
    deterministic — re-warming a fresh server always picks the same
    voice, instead of rolling a new one on each restart.
    """
    global _mlx_ref_audio
    if _mlx_ref_audio is not None:
        return _mlx_ref_audio
    import mlx.core as mx  # noqa: PLC0415
    import numpy as np  # noqa: PLC0415
    t = settings.tts
    model = ensure_mlx_tts()
    mx.random.seed(t.seed)
    chunks = []
    for result in model.generate(
        t.ref_text, voice=t.voice, temperature=t.temperature,
    ):
        chunks.append(getattr(result, "audio", result))
    if not chunks:
        return None
    flat = np.concatenate([np.asarray(c, dtype=np.float32).reshape(-1) for c in chunks])
    _mlx_ref_audio = mx.array(flat)
    logger.info("TTS voice anchor ready (%d samples, %.2fs from %r)",
                flat.shape[0], flat.shape[0] / t.sr, t.ref_text[:24])
    return _mlx_ref_audio


def _synth_mlx_sync(text: str, voice: str | None = None) -> tuple[bytes, int, int]:
    """Run on the MLX worker thread. Dispatches on model variant:

      - ``custom_voice`` (default): real per-speaker embeddings — call
        ``generate_custom_voice(text, speaker=…)`` directly. Empirically
        ~50% less F0 drift across chunks than going through ``generate()``
        routing (serena spread 136Hz → 70Hz).
      - ``voice_design``: text-prompt voice via ``instruct=``.
      - ``base``: unconditional speaker — fall back to ref_audio anchor.

    Re-seed ``mx.random`` so the same input is deterministic.
    """
    import mlx.core as mx  # noqa: PLC0415
    import numpy as np  # noqa: PLC0415

    t = settings.tts
    speaker = voice or t.voice
    mx.random.seed(t.seed)
    model = ensure_mlx_tts()
    ttype = getattr(model.config, "tts_model_type", "base")

    chunks = []
    if ttype == "custom_voice":
        cv_kwargs: dict[str, object] = {
            "speaker":     speaker,
            "language":    t.lang,
            "temperature": t.temperature,
        }
        if t.instruct:
            cv_kwargs["instruct"] = t.instruct
        gen = model.generate_custom_voice(text, **cv_kwargs)
    elif ttype == "voice_design":
        # voice_design needs ``instruct`` (free-form voice description).
        # ``speaker`` is reused as the instruction string here.
        gen = model.generate_voice_design(
            text, instruct=speaker, temperature=t.temperature,
        )
    else:
        gen_kwargs: dict[str, object] = {
            "voice": speaker, "temperature": t.temperature,
        }
        if _mlx_ref_audio is not None:
            gen_kwargs["ref_audio"] = _mlx_ref_audio
            gen_kwargs["ref_text"] = t.ref_text
        gen = model.generate(text, **gen_kwargs)
    for result in gen:
        chunks.append(getattr(result, "audio", result))

    if not chunks:
        return b"", t.sr, 0
    flat = np.concatenate([np.asarray(c, dtype=np.float32).reshape(-1) for c in chunks])
    wav = pcm_float_to_wav_bytes(flat, t.sr)
    return wav, t.sr, int(flat.shape[0])


class MlxTts:
    @property
    def model_id(self) -> str:
        return settings.tts.mlx_model

    async def synth(self, text: str, *, voice: str | None = None) -> tuple[bytes, int, int]:
        return await mlx_call(_synth_mlx_sync, text, voice)

    def stream(self, *, voice: str | None = None,    # noqa: ARG002
               speech_rate: float | None = None,
               volume: float | None = None):
        # MLX path is one-shot; chat.py falls back to synth() per sentence.
        # speech_rate / volume are ignored — mlx-audio doesn't expose them yet.
        return None


# --- DashScope cloud --------------------------------------------------------

def _synth_dashscope_sync(text: str, voice: str | None = None) -> tuple[bytes, int, int]:
    """qwen3-tts-flash / qwen3-tts-instruct-flash. Returns the same
    triple as MLX so the caller doesn't care which backend produced it.
    Still applies our trim + RMS-normalise post-process so chunk joins
    stay clean.

    Sync HTTP call; the caller wraps in asyncio.to_thread.
    """
    import numpy as np  # noqa: PLC0415

    t = settings.tts
    ds = settings.dashscope
    speaker = voice or t.voice
    if not ds.api_key:
        raise RuntimeError("TTS_PROVIDER=dashscope but DASHSCOPE_API_KEY not set")

    body: dict = {
        "model": ds.tts_model,
        "input": {
            "text": text,
            "voice": speaker,
            "language_type": ds.tts_lang,
        },
    }
    # ``instructions`` is a sibling of ``input`` (NOT inside it) per the
    # qwen3-tts-instruct-flash spec. Only attach when both the model
    # supports it and we actually have an instruction string — sending
    # to plain qwen3-tts-flash silently no-ops but adds 1600-token
    # accounting overhead.
    if t.instruct and "instruct" in ds.tts_model:
        body["instructions"] = t.instruct
        body["optimize_instructions"] = True
    headers = {
        "Authorization": f"Bearer {settings.dashscope.api_key}",
        "Content-Type": "application/json",
    }
    # ``verify=False`` to match the chat path — corp proxy CA isn't in
    # trust store.
    with httpx.Client(timeout=30.0, verify=False) as client:
        r = client.post(ds.tts_url, headers=headers, json=body)
        if r.status_code != 200:
            raise RuntimeError(f"dashscope TTS HTTP {r.status_code}: {r.text[:200]}")
        out = r.json().get("output", {})
        audio = out.get("audio") or {}
        url = audio.get("url")
        if not url:
            raise RuntimeError(f"dashscope TTS missing url: {out}")
        wav_bytes = client.get(url).content

    # Parse the returned WAV → float32 → re-pack so it gets trimmed +
    # normalized (same path as MLX TTS output).
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        sr = wf.getframerate()
        n = wf.getnframes()
        pcm = wf.readframes(n)
    arr = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    cleaned = pcm_float_to_wav_bytes(arr, sr)
    with wave.open(io.BytesIO(cleaned), "rb") as wf:
        n2 = wf.getnframes()
        sr2 = wf.getframerate()
    return cleaned, sr2, n2


class DashscopeTts:
    @property
    def model_id(self) -> str:
        return settings.dashscope.tts_model

    async def synth(self, text: str, *, voice: str | None = None) -> tuple[bytes, int, int]:
        # Cloud path: HTTP-bound, but we still funnel through mlx_call
        # so the GPU/CPU contention with MLX (if a parallel local model
        # is also serving) stays serialised — and so the asyncio loop
        # isn't blocked by the sync httpx call.
        return await mlx_call(_synth_dashscope_sync, text, voice)

    def stream(self, *, voice: str | None = None,    # noqa: ARG002
               speech_rate: float | None = None,
               volume: float | None = None):
        # HTTP one-shot endpoint — no duplex, callers fall back to synth().
        return None


# --- DashScope Realtime WS --------------------------------------------------
# Spec: wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=<id>
# Auth header `Authorization: Bearer <api_key>`. Client events: session.update,
# input_text_buffer.append/commit/clear, session.finish. Server events:
# session.created/updated/finished, response.created, response.output_item.added,
# response.audio.delta (base64 PCM in `delta`), response.audio.done,
# response.done, error.

class DashscopeRealtimeTtsStream:
    """One duplex Qwen-TTS Realtime session. Each chat turn opens, streams
    LLM tokens via ``append``, drains audio via ``audio_frames``, then
    ``finish`` (graceful) or ``cancel`` (abrupt — for user interrupts).

    Concurrency:
      - ``_reader_loop`` task consumes upstream JSON events, pushes raw
        int16 PCM to ``_audio_q``.
      - ``audio_frames`` is the async generator the caller iterates.
      - ``_opened`` event gates ``open()`` returning until the server
        confirms ``session.updated`` (catches bad-creds / bad-voice fast).
      - ``_finished`` event lets ``finish()`` wait for ``session.finished``
        before closing, so we don't truncate trailing audio.
    """

    def __init__(self, voice: Optional[str] = None,
                 speech_rate: Optional[float] = None,
                 volume: Optional[float] = None):
        self._voice = voice
        # Per-session prosody overrides — None means "use settings.tts default".
        # Drives the session.update payload in open() below. Set by the WS
        # handler in response to meta-command fast-path (慢点/快点/大声点/小声点).
        self._speech_rate_override = speech_rate
        self._volume_override = volume
        self._ws: Optional[_wspkg.WebSocketClientProtocol] = None
        self._reader_task: Optional[asyncio.Task] = None
        self._opened = asyncio.Event()
        self._finished = asyncio.Event()
        self._open_error: Optional[str] = None
        self._audio_q: asyncio.Queue[Optional[bytes]] = asyncio.Queue()
        self._sample_rate = settings.tts.sr

    @property
    def sample_rate(self) -> int:
        return self._sample_rate

    async def open(self) -> None:
        ds = settings.dashscope
        t = settings.tts
        if not ds.api_key:
            raise RuntimeError(
                "DASHSCOPE_API_KEY empty — set it in .env.local before using "
                "the realtime TTS WS path."
            )
        url = f"{ds.tts_realtime_url}?model={ds.tts_model}"
        headers = {"Authorization": f"Bearer {ds.api_key}"}
        # ``verify=False`` parity with the HTTP path: corp proxy MITMs.
        ssl_ctx = ssl._create_unverified_context() if url.startswith("wss://") else None
        try:
            self._ws = await _wspkg.connect(
                url,
                additional_headers=headers,
                ssl=ssl_ctx,
                max_size=None,
                ping_interval=20,
                open_timeout=10,
            )
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"realtime TTS WS connect failed: {exc}") from exc

        self._reader_task = asyncio.create_task(
            self._reader_loop(), name="dashscope-rt-tts-reader",
        )

        # ``session.update`` — declare voice / mode / audio format /
        # rate-pitch-volume up-front. Only attach ``instructions`` when
        # the selected model variant supports it (qwen3-tts-instruct-*).
        session_cfg: dict = {
            "voice": self._voice or t.voice,
            "mode": ds.tts_realtime_mode,
            "language_type": ds.tts_lang,
            "response_format": t.response_format,
            "sample_rate": t.sr,
            "speech_rate": self._speech_rate_override if self._speech_rate_override is not None else t.speech_rate,
            "pitch_rate": t.pitch_rate,
            "volume": self._volume_override if self._volume_override is not None else t.volume,
        }
        if t.response_format == "opus":
            session_cfg["bit_rate"] = t.bit_rate
        if t.instruct and "instruct" in ds.tts_model:
            session_cfg["instructions"] = t.instruct
            session_cfg["optimize_instructions"] = True
        await self._send({"type": "session.update", "session": session_cfg})

        try:
            await asyncio.wait_for(self._opened.wait(), timeout=10)
        except asyncio.TimeoutError as exc:
            await self.cancel()
            raise RuntimeError("realtime TTS session.update timed out") from exc
        if self._open_error:
            err = self._open_error
            await self.cancel()
            raise RuntimeError(f"realtime TTS session.update rejected: {err}")

    async def append(self, text_delta: str) -> None:
        if not text_delta or self._ws is None or self._finished.is_set():
            return
        await self._send({"type": "input_text_buffer.append", "text": text_delta})

    async def finish(self) -> None:
        """Send session.finish, wait for session.finished + drain audio,
        then close. Bounded by timeout so a stuck upstream can't hang
        chat teardown."""
        if self._ws is None:
            return
        try:
            await self._send({"type": "session.finish"})
        except Exception:
            pass
        try:
            await asyncio.wait_for(self._finished.wait(), timeout=20)
        except asyncio.TimeoutError:
            logger.warning("realtime TTS session.finish timeout")
        await self._close()

    async def cancel(self) -> None:
        """Abrupt close — for user interruption mid-chat. We don't bother
        with session.finish; just shut the socket so the upstream stops
        billing and our reader unwinds."""
        await self._close()

    async def _send(self, payload: dict) -> None:
        if self._ws is None:
            return
        payload = {"event_id": uuid.uuid4().hex, **payload}
        await self._ws.send(json.dumps(payload))

    async def _reader_loop(self) -> None:
        assert self._ws is not None
        try:
            async for msg in self._ws:
                if isinstance(msg, (bytes, bytearray)):
                    # Spec uses JSON only; defensively ignore binary.
                    continue
                try:
                    ev = json.loads(msg)
                except json.JSONDecodeError:
                    logger.warning("realtime TTS bad JSON from server: %.120s", msg)
                    continue
                t = ev.get("type")
                if t == "session.updated":
                    self._opened.set()
                elif t == "response.audio.delta":
                    b64 = ev.get("delta") or ""
                    if b64:
                        try:
                            pcm = base64.b64decode(b64)
                        except Exception:  # noqa: BLE001
                            logger.exception("realtime TTS bad base64 delta")
                            continue
                        if pcm:
                            await self._audio_q.put(pcm)
                elif t == "session.finished":
                    break
                elif t == "error":
                    err = ev.get("error") or {}
                    msg_txt = err.get("message") or str(err)
                    logger.warning("realtime TTS server error: %s", msg_txt)
                    if not self._opened.is_set():
                        self._open_error = msg_txt
                    break
                # Unhandled (session.created / response.created / response.done /
                # response.audio.done / input_text_buffer.committed) — informational.
        except _wspkg.exceptions.ConnectionClosed:
            pass
        except Exception:  # noqa: BLE001
            logger.exception("realtime TTS reader crashed")
        finally:
            self._opened.set()
            self._finished.set()
            await self._audio_q.put(None)

    async def audio_frames(self) -> AsyncIterator[bytes]:
        while True:
            chunk = await self._audio_q.get()
            if chunk is None:
                return
            yield chunk

    async def _close(self) -> None:
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None
        if self._reader_task is not None and not self._reader_task.done():
            self._reader_task.cancel()
            try:
                await self._reader_task
            except Exception:
                pass
        self._opened.set()
        self._finished.set()


class DashscopeRealtimeTts:
    """Realtime WS TTS provider. ``stream()`` is the fast path used by
    chat.py; ``synth()`` (for one-shot /tts and synth_one) runs the same
    WS round-trip but buffers the full PCM into a single WAV blob to
    match the legacy interface."""

    @property
    def model_id(self) -> str:
        return settings.dashscope.tts_model

    def stream(self, *, voice: str | None = None,
               speech_rate: float | None = None,
               volume: float | None = None) -> DashscopeRealtimeTtsStream:
        return DashscopeRealtimeTtsStream(
            voice=voice, speech_rate=speech_rate, volume=volume,
        )

    async def synth(self, text: str, *, voice: str | None = None) -> tuple[bytes, int, int]:
        import numpy as np  # noqa: PLC0415

        sess = self.stream(voice=voice)
        await sess.open()
        try:
            await sess.append(text)
            # Drain audio frames concurrently with finish() so we don't
            # deadlock — finish() waits for session.finished, which only
            # fires after the server emits all audio.
            collected: list[bytes] = []

            async def _collect() -> None:
                async for chunk in sess.audio_frames():
                    collected.append(chunk)

            collector = asyncio.create_task(_collect(), name="rt-tts-one-shot-collect")
            try:
                await sess.finish()
            finally:
                try:
                    await asyncio.wait_for(collector, timeout=5)
                except asyncio.TimeoutError:
                    collector.cancel()
                    try:
                        await collector
                    except (asyncio.CancelledError, Exception):
                        pass
        finally:
            await sess.cancel()  # idempotent if finish() already closed

        if not collected:
            return b"", sess.sample_rate, 0
        pcm = b"".join(collected)
        # int16 LE → float32 [-1, 1] → re-encode through the shared
        # post-processor for trim + RMS-normalise parity with HTTP path.
        arr = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        wav = pcm_float_to_wav_bytes(arr, sess.sample_rate)
        with wave.open(io.BytesIO(wav), "rb") as wf:
            n = wf.getnframes()
            sr = wf.getframerate()
        return wav, sr, n
