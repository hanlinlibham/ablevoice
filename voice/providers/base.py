"""Provider protocols + factory dispatch.

The chat pipeline and WS handler only see these abstractions; concrete
provider classes import + register here, so swapping or adding a backend
doesn't touch business logic.

Three protocols
===============
``AsrSession`` — one per recording. Has ``feed(pcm)``, ``finish()``
(returns final text), ``cancel()`` (abort without finalising). Partials
are pushed via the ``on_partial`` callback the factory injects.

``LlmProvider`` — ``stream(messages, session_id) -> AsyncIterator[str]``.
Async generator of content deltas. ``session_id`` is only used by
ablework (for stable conversation-id mapping); other providers ignore.

``TtsProvider`` — ``synth(text) -> (wav_bytes, sample_rate, n_samples)``.
Sync (runs on the MLX worker or via httpx); the caller wraps in
``runtime.mlx_call`` for the MLX impl.
"""

from __future__ import annotations

from typing import AsyncIterator, Awaitable, Callable, Optional, Protocol


class AsrSession(Protocol):
    """One session per recording window. Provider chooses how to manage
    upstream state (MLX in-memory; DashScope keeps an upstream WS)."""

    async def start(self) -> None: ...
    async def feed(self, pcm_bytes: bytes) -> None: ...
    async def finish(self) -> str: ...
    async def cancel(self) -> None: ...

    @property
    def model_id(self) -> str: ...


# Async generator of content deltas. ``session_id`` is opaque to most
# providers; ablework uses it for conversation-id mapping.
LlmStream = Callable[[list[dict], str], AsyncIterator[str]]


class LlmProvider(Protocol):
    def stream(self, messages: list[dict], session_id: str) -> AsyncIterator[str]: ...

    @property
    def model_id(self) -> str: ...


class TtsProvider(Protocol):
    """Synth one text chunk. Returns the encoded WAV bytes + sample
    rate + sample count (so caller can compute dur_ms)."""

    async def synth(self, text: str) -> tuple[bytes, int, int]: ...

    @property
    def model_id(self) -> str: ...


# --- Factories --------------------------------------------------------------
# Import inside the factory to keep startup cheap (MLX providers do
# heavy imports at module load).

OnPartial = Callable[[str, str], Awaitable[None]]  # (text, stable_text)


def get_asr(sample_rate: int, on_partial: OnPartial) -> AsrSession:
    from ..config import settings
    if settings.asr.provider == "dashscope":
        from .asr import DashscopeRealtimeAsr
        return DashscopeRealtimeAsr(sample_rate, on_partial)
    from .asr import MlxStreamingAsr
    return MlxStreamingAsr(sample_rate, on_partial)


def get_llm() -> LlmProvider:
    from ..config import settings
    p = settings.llm.provider
    if p == "mlx":
        from .llm import MlxLlm
        return MlxLlm()
    if p == "dashscope":
        from .llm import DashscopeLlm
        return DashscopeLlm()
    if p == "ablework":
        from .llm import AbleworkLlm
        return AbleworkLlm()
    from .llm import OllamaLlm
    return OllamaLlm()


def get_tts() -> TtsProvider:
    from ..config import settings
    if settings.tts.provider == "dashscope":
        from .tts import DashscopeTts
        return DashscopeTts()
    from .tts import MlxTts
    return MlxTts()


# --- One-shot ASR (HTTP /transcribe path) -----------------------------------
# The HTTP /transcribe endpoint takes a complete audio file (webm/wav)
# and runs ASR once. That's a different shape from AsrSession (which is
# streaming), so it's its own callable. Only MLX needs it today —
# DashScope's qwen3-asr-flash one-shot path was never wired into HTTP.

async def transcribe_file(audio_path: str) -> tuple[str, str]:
    """Transcribe a file. Returns (text, model_id). Only MLX today.

    Cloud one-shot ASR (qwen3-asr-flash) isn't wired into this endpoint;
    if/when needed, branch on settings.asr.provider here.
    """
    from ..runtime import mlx_call
    from .asr import ensure_mlx_session
    session = await mlx_call(ensure_mlx_session)
    result = await mlx_call(session.transcribe, audio_path)
    return getattr(result, "text", "") or "", settings_asr_model_id()


def settings_asr_model_id() -> str:
    from ..config import settings
    return settings.asr_active_model_id
