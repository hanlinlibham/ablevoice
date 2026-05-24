"""Centralised configuration. Every env var the server reads is declared
here so a typo doesn't silently fall back to a default with no warning.

Usage:

    from voice.config import settings
    settings.tts.voice
    settings.llm.provider

``settings`` is a module-level singleton built once on first import; the
load is logged so startup output shows the effective config in one place.
The fields are frozen after construction — re-reading os.environ at
request time would just mask test flakiness.

Why not pydantic-settings: this is a probe sandbox, we already keep deps
lean (no pydantic-settings, no python-dotenv at runtime — the start
scripts pre-load .env.local before exec'ing uvicorn). A small dataclass
+ explicit ``_env_*`` parsers covers the same surface without dragging
in another dependency.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger("voice.config")

_TRUE = ("1", "true", "yes", "on")


def _env_str(name: str, default: str) -> str:
    return os.environ.get(name, default)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.lower() in _TRUE


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"env {name}={raw!r} is not an integer") from exc


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise RuntimeError(f"env {name}={raw!r} is not a float") from exc


# --- Provider sub-configs ---------------------------------------------------

@dataclass(frozen=True)
class AsrConfig:
    """ASR — provider switch + the model id for whichever path is active.

    ``provider``: ``mlx`` (local mlx-qwen3-asr, real-time partials) or
    ``dashscope`` (cloud paraformer-realtime-v2 WS bridge for partials,
    or qwen3-asr-flash for one-shot — picked by model id).
    """
    provider: str          # "mlx" | "dashscope"
    mlx_model: str         # huggingface id, e.g. "Qwen/Qwen3-ASR-1.7B"
    stream_chunk_sec: float  # mlx streaming chunk size; 1.5 = clean partials
    # DashScope
    ds_model: str          # "paraformer-realtime-v2" (WS) or "qwen3-asr-flash"
    ds_lang: str           # "zh" — sent as language_hints[0]
    ds_ws_url: str         # paraformer realtime WebSocket endpoint

    @property
    def active_model_id(self) -> str:
        return self.ds_model if self.provider == "dashscope" else self.mlx_model


@dataclass(frozen=True)
class LlmConfig:
    """LLM — four providers, each with its own model id.

    The system prompt is shared (forwarded by mlx/ollama/dashscope, dropped
    for ablework which has its own preset-driven system prompt).
    """
    provider: str          # "mlx" | "ollama" | "dashscope" | "ablework"
    mlx_model: str
    mlx_max_tokens: int
    ollama_url: str
    ollama_model: str
    ollama_think: bool
    ds_api_key: str
    ds_base_url: str
    ds_model: str
    ds_thinking: bool
    ablework_url: str
    ablework_token: str
    ablework_verify_ssl: bool
    system_prompt: str

    @property
    def active_model_id(self) -> str:
        return {
            "mlx":       self.mlx_model,
            "dashscope": self.ds_model,
            "ablework":  "(server-side preset)",
            "ollama":    self.ollama_model,
        }.get(self.provider, self.ollama_model)

    @property
    def active_url(self) -> str | None:
        return {
            "mlx":       None,
            "dashscope": self.ds_base_url,
            "ablework":  self.ablework_url,
            "ollama":    self.ollama_url,
        }.get(self.provider)


@dataclass(frozen=True)
class TtsConfig:
    """TTS — local CustomVoice or cloud qwen3-tts(-instruct)-flash.

    Voice stability knobs (seed/temperature/instruct/RMS/silence-trim) all
    live here so a future "voice profile" preset can ship as one struct.
    """
    provider: str          # "mlx" | "dashscope"
    mlx_model: str
    sr: int                # output sample rate (24000 for Qwen3-TTS)
    voice: str             # speaker name
    lang: str              # "chinese" — mlx-audio lang_code
    temperature: float
    seed: int
    instruct: str
    ref_text: str          # text used to synth voice-anchor ref clip
    # DashScope
    ds_model: str          # qwen3-tts-instruct-flash | qwen3-tts-flash
    ds_url: str
    ds_lang: str           # "Chinese" (note Title-case for dashscope)
    # Post-processing (used by both providers)
    target_rms: float
    max_gain: float
    trim_dbfs: float
    keep_head_ms: int
    keep_tail_ms: int

    @property
    def active_model_id(self) -> str:
        return self.ds_model if self.provider == "dashscope" else self.mlx_model


@dataclass(frozen=True)
class PolishConfig:
    """ASR-output polish agent — LangGraph mini-agent that turns口语
    转写 into clean书面 text before it hits the chat LLM.

    ``provider`` selects the backend for the polish LLM call. ``mlx``
    shares the chat model (no extra load) but blocks the GPU for ~500ms
    per polish; ``dashscope`` is offload-able but adds ~1s network RTT.
    ``off`` disables polish entirely (graph short-circuits, downstream
    sees raw ASR text)."""
    enabled: bool
    provider: str          # "mlx" | "dashscope" | "off"
    use_polished_for_chat: bool   # if True, run_chat_pipeline uses polished as user input
    ds_model: str          # polish-specific dashscope model (often a cheaper one)
    max_tokens: int
    temperature: float
    max_attempts: int      # initial + retries; 2 = one retry


@dataclass(frozen=True)
class SentenceConfig:
    """How aggressively the streaming TTS splitter cuts the LLM output."""
    min_chars: int
    soft_cap: int
    first_min_chars: int
    first_soft_cap: int


@dataclass(frozen=True)
class StorageConfig:
    """Filesystem layout. data_dir is the package root so blowing away
    the demo is one ``rm -rf``."""
    data_dir: Path
    db_path: Path
    audio_dir: Path
    keep_audio: bool


@dataclass(frozen=True)
class Settings:
    """Top-level config bag. ``settings`` (singleton below) is what the
    rest of the code touches."""
    asr: AsrConfig
    llm: LlmConfig
    tts: TtsConfig
    polish: PolishConfig
    sentence: SentenceConfig
    storage: StorageConfig
    warmup: bool


def _load() -> Settings:
    data_dir = Path(__file__).resolve().parent.parent
    return Settings(
        asr=AsrConfig(
            provider=_env_str("ASR_PROVIDER", "mlx").lower(),
            mlx_model=_env_str("MLX_QWEN_MODEL", "Qwen/Qwen3-ASR-1.7B"),
            stream_chunk_sec=_env_float("ASR_STREAM_CHUNK_SEC", 1.5),
            ds_model=_env_str("DASHSCOPE_ASR_MODEL", "paraformer-realtime-v2"),
            ds_lang=_env_str("DASHSCOPE_ASR_LANG", "zh"),
            ds_ws_url=_env_str(
                "DASHSCOPE_ASR_WS_URL",
                "wss://dashscope.aliyuncs.com/api-ws/v1/inference/",
            ),
        ),
        llm=LlmConfig(
            provider=_env_str("LLM_PROVIDER", "ablework").lower(),
            mlx_model=_env_str("MLX_LLM_MODEL", "mlx-community/Qwen3-4B-Instruct-2507-4bit"),
            mlx_max_tokens=_env_int("MLX_LLM_MAX_TOKENS", 512),
            ollama_url=_env_str("OLLAMA_URL", "http://127.0.0.1:11434"),
            ollama_model=_env_str("OLLAMA_MODEL", "qwen3.5:35b"),
            ollama_think=_env_bool("OLLAMA_THINK", False),
            ds_api_key=_env_str("DASHSCOPE_API_KEY", ""),
            ds_base_url=_env_str(
                "DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"
            ),
            ds_model=_env_str("DASHSCOPE_MODEL", "qwen3.7-max"),
            ds_thinking=_env_bool("DASHSCOPE_THINKING", False),
            ablework_url=_env_str("ABLEWORK_URL", "https://ab.itseek.cc/api/chat"),
            ablework_token=_env_str("ABLEWORK_TOKEN", os.environ.get("TOKEN", "")),
            ablework_verify_ssl=_env_bool("ABLEWORK_VERIFY_SSL", False),
            system_prompt=_env_str(
                "SYSTEM_PROMPT",
                "你是一个语音助手。回复请简短自然、像口语,通常 1-3 句话。"
                "不要用 markdown、列表、代码块或表情;用户是通过语音听你的回答。",
            ),
        ),
        tts=TtsConfig(
            provider=_env_str("TTS_PROVIDER", "mlx").lower(),
            mlx_model=_env_str(
                "MLX_TTS_MODEL", "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16"
            ),
            sr=_env_int("MLX_TTS_SR", 24000),
            voice=_env_str("MLX_TTS_VOICE", "serena"),
            lang=_env_str("MLX_TTS_LANG", "chinese"),
            temperature=_env_float("MLX_TTS_TEMPERATURE", 0.5),
            seed=_env_int("MLX_TTS_SEED", 42),
            instruct=_env_str(
                "MLX_TTS_INSTRUCT",
                "请用平稳、冷静、像新闻播报员的语气朗读,语速适中,不要加入任何情绪起伏。",
            ),
            ref_text=_env_str(
                "MLX_TTS_REF_TEXT", "你好,我是一个语音助手,很高兴为你服务。"
            ),
            ds_model=_env_str("DASHSCOPE_TTS_MODEL", "qwen3-tts-instruct-flash"),
            ds_url=_env_str(
                "DASHSCOPE_TTS_URL",
                "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
            ),
            ds_lang=_env_str("DASHSCOPE_TTS_LANG", "Chinese"),
            target_rms=_env_float("MLX_TTS_TARGET_RMS", 0.12),
            max_gain=_env_float("MLX_TTS_MAX_GAIN", 4.0),
            trim_dbfs=_env_float("MLX_TTS_TRIM_DBFS", -40),
            keep_head_ms=_env_int("MLX_TTS_KEEP_HEAD_MS", 20),
            keep_tail_ms=_env_int("MLX_TTS_KEEP_TAIL_MS", 30),
        ),
        polish=PolishConfig(
            enabled=_env_bool("POLISH_ENABLED", True),
            provider=_env_str("POLISH_PROVIDER", "mlx").lower(),
            use_polished_for_chat=_env_bool("POLISH_USE_FOR_CHAT", True),
            ds_model=_env_str("POLISH_DASHSCOPE_MODEL", "qwen-flash"),
            max_tokens=_env_int("POLISH_MAX_TOKENS", 256),
            temperature=_env_float("POLISH_TEMPERATURE", 0.2),
            max_attempts=_env_int("POLISH_MAX_ATTEMPTS", 2),
        ),
        sentence=SentenceConfig(
            min_chars=_env_int("CHAT_SENT_MIN_CHARS", 6),
            soft_cap=_env_int("CHAT_SENT_SOFT_CAP", 40),
            first_min_chars=_env_int("CHAT_FIRST_MIN_CHARS", 6),
            first_soft_cap=_env_int("CHAT_FIRST_SOFT_CAP", 24),
        ),
        storage=StorageConfig(
            data_dir=data_dir,
            db_path=data_dir / "transcripts.db",
            audio_dir=data_dir / "recordings",
            keep_audio=_env_bool("KEEP_AUDIO", False),
        ),
        warmup=_env_bool("WARMUP", True),
    )


def _validate(s: Settings) -> None:
    """Fail loud at startup if a provider is selected without the creds /
    URL it needs — beats discovering at first request that DASHSCOPE_API_KEY
    isn't set."""
    valid_asr = {"mlx", "dashscope"}
    valid_llm = {"mlx", "ollama", "dashscope", "ablework"}
    valid_tts = {"mlx", "dashscope"}
    valid_polish = {"mlx", "dashscope", "off"}
    if s.asr.provider not in valid_asr:
        raise RuntimeError(f"ASR_PROVIDER={s.asr.provider!r} not in {valid_asr}")
    if s.llm.provider not in valid_llm:
        raise RuntimeError(f"LLM_PROVIDER={s.llm.provider!r} not in {valid_llm}")
    if s.tts.provider not in valid_tts:
        raise RuntimeError(f"TTS_PROVIDER={s.tts.provider!r} not in {valid_tts}")
    if s.polish.provider not in valid_polish:
        raise RuntimeError(f"POLISH_PROVIDER={s.polish.provider!r} not in {valid_polish}")
    if s.polish.enabled and s.polish.provider == "dashscope" and not s.llm.ds_api_key:
        logger.warning("POLISH_PROVIDER=dashscope but DASHSCOPE_API_KEY empty — polish will fail")
    if s.asr.provider == "dashscope" and not s.llm.ds_api_key:
        logger.warning("ASR_PROVIDER=dashscope but DASHSCOPE_API_KEY empty — calls will fail")
    if s.tts.provider == "dashscope" and not s.llm.ds_api_key:
        logger.warning("TTS_PROVIDER=dashscope but DASHSCOPE_API_KEY empty — calls will fail")
    if s.llm.provider == "dashscope" and not s.llm.ds_api_key:
        logger.warning("LLM_PROVIDER=dashscope but DASHSCOPE_API_KEY empty — calls will fail")
    if s.llm.provider == "ablework" and not s.llm.ablework_token:
        logger.warning("LLM_PROVIDER=ablework but ABLEWORK_TOKEN/TOKEN empty — calls will fail")


def _log_summary(s: Settings) -> None:
    polish_tag = (
        f"{s.polish.provider}{'+chat' if s.polish.use_polished_for_chat else ''}"
        if s.polish.enabled else "off"
    )
    logger.info(
        "config: ASR=%s(%s) LLM=%s(%s) TTS=%s(%s, voice=%s) polish=%s keep_audio=%s warmup=%s",
        s.asr.provider, s.asr.active_model_id,
        s.llm.provider, s.llm.active_model_id,
        s.tts.provider, s.tts.active_model_id, s.tts.voice,
        polish_tag, s.storage.keep_audio, s.warmup,
    )


settings: Settings = _load()
_validate(settings)
_log_summary(settings)
