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


class TtsStreamSession(Protocol):
    """One streaming TTS session — only meaningful for providers that
    support a duplex protocol (DashScope Realtime WS today). The chat
    pipeline opens one session per LLM turn, feeds token deltas via
    ``append``, drains PCM via ``audio_frames``, and tears down with
    ``finish`` (graceful) or ``cancel`` (abrupt, on interrupt).

    Audio frames are int16 LE mono PCM at ``sample_rate`` — callers wrap
    in a WAV header for client playback parity with the one-shot path."""

    async def open(self) -> None: ...
    async def append(self, text_delta: str) -> None: ...
    async def finish(self) -> None: ...
    async def cancel(self) -> None: ...

    def audio_frames(self) -> AsyncIterator[bytes]: ...

    @property
    def sample_rate(self) -> int: ...


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
    def stream(
        self, messages: list[dict], session_id: str,
        *, workspace_id: str | None = None,
    ) -> AsyncIterator[str]: ...

    @property
    def model_id(self) -> str: ...


class TtsProvider(Protocol):
    """Synth one text chunk. Returns the encoded WAV bytes + sample
    rate + sample count (so caller can compute dur_ms).

    ``voice`` overrides the configured default for this single call —
    callers (chat pipeline / WS handler) thread per-session voice
    settings through without mutating global config.

    ``stream`` returns a ``TtsStreamSession`` for duplex providers
    (currently only DashScope Realtime WS), or ``None`` for one-shot
    providers (MLX local, DashScope HTTP). The chat pipeline checks for
    None and falls back to the per-sentence ``synth()`` path."""

    async def synth(self, text: str, *, voice: str | None = None) -> tuple[bytes, int, int]: ...

    def stream(
        self, *, voice: str | None = None,
        speech_rate: float | None = None,
        volume: float | None = None,
    ) -> Optional[TtsStreamSession]: ...

    @property
    def model_id(self) -> str: ...


# --- Factories --------------------------------------------------------------
# Import inside the factory to keep startup cheap (MLX providers do
# heavy imports at module load).

OnPartial = Callable[[str, str], Awaitable[None]]  # (text, stable_text)


def get_asr(sample_rate: int, on_partial: OnPartial) -> AsrSession:
    from ..config import settings
    if settings.asr.provider == "dashscope":
        # Two cloud models, two different WS protocols — route by name.
        # qwen3-asr-* uses the OpenAI-Realtime endpoint; paraformer/others
        # use the run-task inference endpoint.
        if settings.dashscope.asr_model.startswith("qwen"):
            from .asr import DashscopeQwenRealtimeAsr
            return DashscopeQwenRealtimeAsr(sample_rate, on_partial)
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
        # Dispatch on the model name: ``*realtime*`` → WS streaming,
        # else the HTTP one-shot path. Lets users A/B without flipping
        # ``TTS_PROVIDER``.
        if settings.dashscope.tts_is_realtime:
            from .tts import DashscopeRealtimeTts
            return DashscopeRealtimeTts()
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
