"""Centralised configuration. Every env var the server reads is declared
here so a typo doesn't silently fall back to a default with no warning.

Usage:

    from voice.config import settings
    settings.tts.voice
    settings.llm.provider
    settings.dashscope.api_key   # shared by ASR / LLM / TTS / Polish

``settings`` is a module-level singleton built once on first import; the
load is logged so startup output shows the effective config in one place.
The fields are frozen after construction — re-reading os.environ at
request time would just mask test flakiness.

Why not pydantic-settings: this is a probe sandbox, we already keep deps
lean (no pydantic-settings, no python-dotenv at runtime — the start
scripts pre-load .env.local before exec'ing uvicorn). A small dataclass
+ explicit ``_env_*`` parsers covers the same surface without dragging
in another dependency.

See ``.env.example`` for the full env contract with defaults + comments.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
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
class DashscopeConfig:
    """All DashScope (Alibaba cloud) creds + endpoints. One API key
    serves the ASR / LLM / TTS / Polish stages because they're all the
    same vendor account — keeping this as a separate sub-config (rather
    than glued to LlmConfig) avoids the cross-stage coupling smell."""
    api_key: str
    base_url: str          # OpenAI-compat /chat/completions base
    asr_model: str         # "paraformer-realtime-v2" (default) or "qwen3-asr-flash-realtime" (newer LLM-style ASR, supports natural-language hotword context)
    asr_lang: str          # "zh" — sent as language_hints[0]
    asr_ws_url: str
    asr_vocabulary_id: str # paraformer custom hotword vocabulary id (empty = no biasing). Manage via scripts/manage_vocabulary.py. Ignored by qwen3-asr-flash-realtime.
    asr_context: str       # qwen3-asr-flash-realtime "Technical terms: ..." prompt (empty = none). Ignored by paraformer-realtime-v2. Use one or the other based on asr_model.
    chat_model: str        # "qwen3.7-max"
    chat_thinking: bool    # leave off for voice (kills first-audio latency)
    tts_model: str         # realtime: "qwen3-tts-flash-realtime" / "qwen3-tts-instruct-flash-realtime"; http: "qwen3-tts-instruct-flash"
    tts_url: str           # HTTP one-shot endpoint
    tts_realtime_url: str  # WS realtime endpoint (used when tts_model contains "realtime")
    tts_realtime_mode: str # "server_commit" (default, server auto-segments) | "commit" (client-driven)
    tts_lang: str          # "Chinese" (note Title-case for dashscope)
    polish_model: str      # "qwen-flash" — cheaper model good enough for polish

    @property
    def has_key(self) -> bool:
        return bool(self.api_key)

    @property
    def tts_is_realtime(self) -> bool:
        return "realtime" in self.tts_model.lower()


@dataclass(frozen=True)
class AblewerkConfig:
    """Ablework backend creds + URL. The token is JWT-shaped (long).
    SSL verify defaults off because the corp proxy MITMs with a
    self-signed CA; flip on if your CA is in the system trust store.

    ``default_workspace_id`` is the env-level fallback used when no
    per-session override is set (via voice ws_switch / hotkey). Leave
    empty → ablework backend's legacy per-thread sandbox."""
    url: str
    token: str
    verify_ssl: bool
    default_workspace_id: str

    @property
    def has_token(self) -> bool:
        return bool(self.token)


@dataclass(frozen=True)
class OllamaConfig:
    url: str
    model: str
    think: bool


@dataclass(frozen=True)
class AsrConfig:
    """ASR — provider switch + MLX-local model id (cloud model id lives
    in DashscopeConfig.asr_model)."""
    provider: str          # "mlx" | "dashscope"
    mlx_model: str         # huggingface id, e.g. "Qwen/Qwen3-ASR-1.7B"
    stream_chunk_sec: float

    def active_model_id(self, dashscope: DashscopeConfig) -> str:
        return dashscope.asr_model if self.provider == "dashscope" else self.mlx_model


@dataclass(frozen=True)
class LlmConfig:
    """LLM stage — provider + MLX-local model + the chat system prompt.
    Cloud model ids live in DashscopeConfig / OllamaConfig / AblewerkConfig
    so adding a new provider doesn't expand this struct."""
    provider: str          # "mlx" | "ollama" | "dashscope" | "ablework"
    mlx_model: str
    mlx_max_tokens: int
    system_prompt: str

    def active_model_id(
        self, ds: DashscopeConfig, ol: OllamaConfig,
    ) -> str:
        return {
            "mlx":       self.mlx_model,
            "dashscope": ds.chat_model,
            "ablework":  "(server-side preset)",
            "ollama":    ol.model,
        }.get(self.provider, ol.model)


@dataclass(frozen=True)
class TtsConfig:
    """TTS stage. ``voice`` / ``instruct`` etc. apply to BOTH providers —
    cloud TTS accepts these as request params, MLX TTS as generate
    kwargs."""
    provider: str          # "mlx" | "dashscope"
    mlx_model: str
    sr: int                # output sample rate (24000 for Qwen3-TTS)
    voice: str             # speaker name (mlx 9-builtin or cloud ~50)
    lang: str              # "chinese" — mlx-audio lang_code
    temperature: float
    seed: int
    instruct: str
    ref_text: str
    # Realtime fine-grain controls (DashScope Realtime WS only — HTTP
    # `qwen3-tts-instruct-flash` ignores these silently).
    speech_rate: float     # 0.5~2.0, 1.0 = normal
    pitch_rate: float      # 0.5~2.0, 1.0 = normal
    volume: int            # 0~100, default 50
    bit_rate: int          # 6~510 kbps (opus only)
    response_format: str   # "pcm" | "wav" | "mp3" | "opus" — realtime WS output
    # Post-processing (used by both providers)
    target_rms: float
    max_gain: float
    trim_dbfs: float
    keep_head_ms: int
    keep_tail_ms: int

    def active_model_id(self, dashscope: DashscopeConfig) -> str:
        return dashscope.tts_model if self.provider == "dashscope" else self.mlx_model


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
    use_polished_for_chat: bool
    max_tokens: int
    temperature: float
    max_attempts: int


@dataclass(frozen=True)
class IntentConfig:
    """Voice intent classifier — routes polished user text to either
    chat (default) or one of the ws_* operations.

    ``provider``: only ``dashscope`` for now (qwen-flash via OAI-compat).
    ``ds_model``: which model. Bake-off picked ``qwen-flash`` (TTFT
    ~440ms,total ~510ms,14/14 quality on intent test set).
    ``min_confidence``: classifier outputs <below default to CHAT so
    a borderline misclassification doesn't silently swallow a real
    question.
    ``pre_filter``: regex check before LLM. With it on, only inputs
    containing workspace keywords pay LLM latency — vast majority
    of normal chat turns skip the classify call entirely."""
    enabled: bool
    provider: str          # "dashscope" (only supported for now)
    ds_model: str          # e.g. "qwen-flash"
    min_confidence: float
    pre_filter: bool


@dataclass(frozen=True)
class SentenceConfig:
    """How aggressively the streaming TTS splitter cuts the LLM output."""
    min_chars: int
    soft_cap: int
    first_min_chars: int
    first_soft_cap: int


@dataclass(frozen=True)
class StorageConfig:
    """Filesystem layout. ``data_dir`` is the package root so blowing
    away the demo is one ``rm -rf``."""
    data_dir: Path
    db_path: Path
    audio_dir: Path
    keep_audio: bool


@dataclass(frozen=True)
class Settings:
    """Top-level config bag. ``settings`` (singleton below) is what the
    rest of the code touches."""
    dashscope: DashscopeConfig
    ablework: AblewerkConfig
    ollama: OllamaConfig
    asr: AsrConfig
    llm: LlmConfig
    tts: TtsConfig
    polish: PolishConfig
    intent: IntentConfig
    sentence: SentenceConfig
    storage: StorageConfig
    warmup: bool

    # Convenience accessors — keep call sites readable.
    @property
    def asr_active_model_id(self) -> str:
        return self.asr.active_model_id(self.dashscope)

    @property
    def llm_active_model_id(self) -> str:
        return self.llm.active_model_id(self.dashscope, self.ollama)

    @property
    def tts_active_model_id(self) -> str:
        return self.tts.active_model_id(self.dashscope)

    @property
    def llm_active_url(self) -> str | None:
        return {
            "mlx":       None,
            "dashscope": self.dashscope.base_url,
            "ablework":  self.ablework.url,
            "ollama":    self.ollama.url,
        }.get(self.llm.provider)


# --- System prompt loader ---------------------------------------------------
_DEFAULT_SYSTEM_PROMPT = (
    "你是一个语音助手。回复请简短自然、像口语,通常 1-3 句话。\n"
    "\n"
    "用户通过 TTS 听你的回答,以下格式约束严格遵守:\n"
    "- 不要使用 markdown、列表、代码块、emoji、表情符号、特殊符号\n"
    "- 不要输出股票代码、英文缩写、url、文件路径、数字序列 — TTS 会逐字念,听不懂。\n"
    "  改用中文名称自然描述(例:不说 \"贵州茅台 600519.SH\",说 \"贵州茅台\";"
    "不说 \"AAPL\",说 \"苹果公司\";不说 \"AI\",说 \"人工智能\")\n"
    "- 数字保留中文读法,不要拼读字母\n"
    "- 不要念出标点符号本身(例:不说 \"逗号\"、\"括号\")\n"
    "- 表格数据用语义描述,不要罗列字段"
)


def _load_system_prompt(data_dir: Path) -> str:
    """Resolve the chat system prompt.

    Precedence:
      1. ``SYSTEM_PROMPT_FILE`` — path to a file (relative paths resolved
         under ``data_dir``). Useful for multi-line / non-ASCII prompts
         that env vars don't carry cleanly.
      2. ``SYSTEM_PROMPT`` — inline literal.
      3. Default (the voice-assistant one)."""
    path_str = os.environ.get("SYSTEM_PROMPT_FILE", "").strip()
    if path_str:
        p = Path(path_str)
        if not p.is_absolute():
            p = data_dir / p
        try:
            return p.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            raise RuntimeError(
                f"SYSTEM_PROMPT_FILE={path_str!r} not found (looked at {p})"
            )
    return os.environ.get("SYSTEM_PROMPT", _DEFAULT_SYSTEM_PROMPT)


# --- Loader -----------------------------------------------------------------

def _load() -> Settings:
    data_dir = Path(__file__).resolve().parent.parent
    return Settings(
        dashscope=DashscopeConfig(
            api_key=_env_str("DASHSCOPE_API_KEY", ""),
            base_url=_env_str(
                "DASHSCOPE_BASE_URL",
                "https://dashscope.aliyuncs.com/compatible-mode/v1",
            ),
            asr_model=_env_str("DASHSCOPE_ASR_MODEL", "paraformer-realtime-v2"),
            asr_lang=_env_str("DASHSCOPE_ASR_LANG", "zh"),
            asr_ws_url=_env_str(
                "DASHSCOPE_ASR_WS_URL",
                "wss://dashscope.aliyuncs.com/api-ws/v1/inference/",
            ),
            asr_vocabulary_id=_env_str("DASHSCOPE_ASR_VOCABULARY_ID", ""),
            asr_context=_env_str("DASHSCOPE_ASR_CONTEXT", ""),
            chat_model=_env_str("DASHSCOPE_MODEL", "qwen3.7-max"),
            chat_thinking=_env_bool("DASHSCOPE_THINKING", False),
            tts_model=_env_str("DASHSCOPE_TTS_MODEL", "qwen3-tts-flash-realtime"),
            tts_url=_env_str(
                "DASHSCOPE_TTS_URL",
                "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
            ),
            tts_realtime_url=_env_str(
                "DASHSCOPE_TTS_REALTIME_URL",
                "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
            ),
            tts_realtime_mode=_env_str("DASHSCOPE_TTS_REALTIME_MODE", "server_commit"),
            tts_lang=_env_str("DASHSCOPE_TTS_LANG", "Chinese"),
            polish_model=_env_str("POLISH_DASHSCOPE_MODEL", "qwen-flash"),
        ),
        ablework=AblewerkConfig(
            url=_env_str("ABLEWORK_URL", "https://ab.itseek.cc/api/chat"),
            token=_env_str("ABLEWORK_TOKEN", ""),
            verify_ssl=_env_bool("ABLEWORK_VERIFY_SSL", False),
            default_workspace_id=_env_str("ABLEWORK_WORKSPACE_ID", ""),
        ),
        ollama=OllamaConfig(
            url=_env_str("OLLAMA_URL", "http://127.0.0.1:11434"),
            model=_env_str("OLLAMA_MODEL", "qwen3.5:35b"),
            think=_env_bool("OLLAMA_THINK", False),
        ),
        asr=AsrConfig(
            provider=_env_str("ASR_PROVIDER", "dashscope").lower(),
            mlx_model=_env_str("MLX_QWEN_MODEL", "Qwen/Qwen3-ASR-1.7B"),
            stream_chunk_sec=_env_float("ASR_STREAM_CHUNK_SEC", 1.5),
        ),
        llm=LlmConfig(
            provider=_env_str("LLM_PROVIDER", "ablework").lower(),
            mlx_model=_env_str("MLX_LLM_MODEL", "mlx-community/Qwen3-4B-Instruct-2507-4bit"),
            mlx_max_tokens=_env_int("MLX_LLM_MAX_TOKENS", 512),
            system_prompt=_load_system_prompt(data_dir),
        ),
        tts=TtsConfig(
            provider=_env_str("TTS_PROVIDER", "dashscope").lower(),
            mlx_model=_env_str(
                "MLX_TTS_MODEL", "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16"
            ),
            sr=_env_int("MLX_TTS_SR", 24000),
            voice=_env_str("MLX_TTS_VOICE", "Maia"),
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
            speech_rate=_env_float("TTS_SPEECH_RATE", 1.0),
            pitch_rate=_env_float("TTS_PITCH_RATE", 1.0),
            volume=_env_int("TTS_VOLUME", 50),
            bit_rate=_env_int("TTS_BIT_RATE", 128),
            response_format=_env_str("TTS_RESPONSE_FORMAT", "pcm"),
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
            max_tokens=_env_int("POLISH_MAX_TOKENS", 256),
            temperature=_env_float("POLISH_TEMPERATURE", 0.2),
            max_attempts=_env_int("POLISH_MAX_ATTEMPTS", 2),
        ),
        intent=IntentConfig(
            enabled=_env_bool("INTENT_ENABLED", True),
            provider=_env_str("INTENT_PROVIDER", "dashscope").lower(),
            ds_model=_env_str("INTENT_DASHSCOPE_MODEL", "qwen-flash"),
            min_confidence=_env_float("INTENT_MIN_CONFIDENCE", 0.7),
            pre_filter=_env_bool("INTENT_PRE_FILTER", True),
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


# --- Validation -------------------------------------------------------------

def _validate(s: Settings) -> None:
    """Fail loud at startup if a provider is selected without the creds
    it needs. Plain warnings (not raises) for missing creds — the user
    might fix the env without restarting; the actual provider call will
    raise on demand."""
    valid_asr = {"mlx", "dashscope"}
    valid_llm = {"mlx", "ollama", "dashscope", "ablework"}
    valid_tts = {"mlx", "dashscope"}
    valid_polish = {"mlx", "dashscope", "off"}
    valid_rt_modes = {"server_commit", "commit"}
    valid_rt_formats = {"pcm", "wav", "mp3", "opus"}
    if s.asr.provider not in valid_asr:
        raise RuntimeError(f"ASR_PROVIDER={s.asr.provider!r} not in {valid_asr}")
    if s.llm.provider not in valid_llm:
        raise RuntimeError(f"LLM_PROVIDER={s.llm.provider!r} not in {valid_llm}")
    if s.tts.provider not in valid_tts:
        raise RuntimeError(f"TTS_PROVIDER={s.tts.provider!r} not in {valid_tts}")
    if s.polish.provider not in valid_polish:
        raise RuntimeError(f"POLISH_PROVIDER={s.polish.provider!r} not in {valid_polish}")
    if s.dashscope.tts_realtime_mode not in valid_rt_modes:
        raise RuntimeError(
            f"DASHSCOPE_TTS_REALTIME_MODE={s.dashscope.tts_realtime_mode!r} "
            f"not in {valid_rt_modes}"
        )
    if s.tts.response_format not in valid_rt_formats:
        raise RuntimeError(
            f"TTS_RESPONSE_FORMAT={s.tts.response_format!r} not in {valid_rt_formats}"
        )
    if not (0.5 <= s.tts.speech_rate <= 2.0):
        raise RuntimeError(f"TTS_SPEECH_RATE={s.tts.speech_rate} not in [0.5, 2.0]")
    if not (0.5 <= s.tts.pitch_rate <= 2.0):
        raise RuntimeError(f"TTS_PITCH_RATE={s.tts.pitch_rate} not in [0.5, 2.0]")
    if not (0 <= s.tts.volume <= 100):
        raise RuntimeError(f"TTS_VOLUME={s.tts.volume} not in [0, 100]")

    needs_dashscope = (
        (s.asr.provider == "dashscope") or
        (s.llm.provider == "dashscope") or
        (s.tts.provider == "dashscope") or
        (s.polish.enabled and s.polish.provider == "dashscope")
    )
    if needs_dashscope and not s.dashscope.has_key:
        logger.warning(
            "DASHSCOPE_API_KEY empty — calls to dashscope-backed providers will fail. "
            "Set it in .env.local (see .env.example)."
        )
    if s.llm.provider == "ablework" and not s.ablework.has_token:
        logger.warning(
            "ABLEWORK_TOKEN empty — ablework calls will fail. "
            "Set it in .env.local (see .env.example)."
        )
    if (s.llm.provider == "ablework") and (not s.ablework.verify_ssl):
        logger.warning(
            "ABLEWORK_VERIFY_SSL=0 — TLS cert verification is OFF. "
            "OK for corp-proxy / MITM environments; flip to 1 if your "
            "CA chain is trusted system-wide."
        )


# --- Logging ----------------------------------------------------------------

def _log_summary(s: Settings) -> None:
    polish_tag = (
        f"{s.polish.provider}{'+chat' if s.polish.use_polished_for_chat else ''}"
        if s.polish.enabled else "off"
    )
    tts_tag = s.tts_active_model_id
    if s.tts.provider == "dashscope" and s.dashscope.tts_is_realtime:
        tts_tag += f" [WS mode={s.dashscope.tts_realtime_mode}]"
    logger.info(
        "config: ASR=%s(%s) LLM=%s(%s) TTS=%s(%s, voice=%s) polish=%s keep_audio=%s warmup=%s",
        s.asr.provider, s.asr_active_model_id,
        s.llm.provider, s.llm_active_model_id,
        s.tts.provider, tts_tag, s.tts.voice,
        polish_tag, s.storage.keep_audio, s.warmup,
    )


# --- Secret-redacting view (for /config endpoint) ---------------------------

def _redact(secret: str) -> str:
    """Mask a secret for logging / /config readout. Keeps a 4-char
    prefix so the user can sanity-check they have *some* key set."""
    if not secret:
        return ""
    if len(secret) <= 8:
        return "***"
    return f"{secret[:4]}…(len={len(secret)})"


def public_view() -> dict:
    """Return the full effective config with secrets redacted. Used by
    the /config endpoint so users can audit what the server is actually
    running with."""
    s = settings
    return {
        "providers": {
            "asr": s.asr.provider,
            "llm": s.llm.provider,
            "tts": s.tts.provider,
            "polish": s.polish.provider if s.polish.enabled else "off",
        },
        "models": {
            "asr": s.asr_active_model_id,
            "llm": s.llm_active_model_id,
            "tts": s.tts_active_model_id,
        },
        "dashscope": {
            "api_key": _redact(s.dashscope.api_key),
            "base_url": s.dashscope.base_url,
            "chat_model": s.dashscope.chat_model,
            "asr_model": s.dashscope.asr_model,
            "tts_model": s.dashscope.tts_model,
            "tts_is_realtime": s.dashscope.tts_is_realtime,
            "tts_realtime_mode": s.dashscope.tts_realtime_mode,
            "polish_model": s.dashscope.polish_model,
        },
        "ablework": {
            "url": s.ablework.url,
            "token": _redact(s.ablework.token),
            "verify_ssl": s.ablework.verify_ssl,
        },
        "ollama": {
            "url": s.ollama.url,
            "model": s.ollama.model,
        },
        "tts_voice": {
            "voice": s.tts.voice,
            "lang": s.tts.lang,
            "temperature": s.tts.temperature,
            "seed": s.tts.seed,
            "instruct": s.tts.instruct[:60] + ("…" if len(s.tts.instruct) > 60 else ""),
            "speech_rate": s.tts.speech_rate,
            "pitch_rate": s.tts.pitch_rate,
            "volume": s.tts.volume,
            "response_format": s.tts.response_format,
        },
        "polish": {
            "enabled": s.polish.enabled,
            "provider": s.polish.provider,
            "use_polished_for_chat": s.polish.use_polished_for_chat,
            "max_attempts": s.polish.max_attempts,
        },
        "storage": {
            "data_dir": str(s.storage.data_dir),
            "db_path": str(s.storage.db_path),
            "audio_dir": str(s.storage.audio_dir),
            "keep_audio": s.storage.keep_audio,
        },
        "warmup": s.warmup,
        "system_prompt_chars": len(s.llm.system_prompt),
    }


# --- Singleton --------------------------------------------------------------

settings: Settings = _load()
_validate(settings)
_log_summary(settings)
