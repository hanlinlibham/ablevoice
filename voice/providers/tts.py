"""TTS provider implementations — MLX local + DashScope cloud.

Both return ``(wav_bytes, sample_rate, n_samples)`` and run their
output through ``audio.pcm_float_to_wav_bytes`` so trim + RMS-normalise
applies uniformly across providers and chunks sound consistent end-to-
end. Cloud path fetches the hosted WAV, decodes int16 → float32, and
re-encodes through the same path.
"""

from __future__ import annotations

import io
import logging
import time
import wave
from typing import Optional

import httpx

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
