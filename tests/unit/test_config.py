"""Config loader / validator unit tests.

We re-import ``voice.config`` after mucking with the env so the module
top-level ``settings = _load()`` re-runs. Each test is fully isolated
via ``monkeypatch.setenv`` + ``importlib.reload``.
"""

from __future__ import annotations

import importlib

import pytest


def _reload(monkeypatch, **env):
    """Reset relevant env vars then reload voice.config so its top-level
    ``settings = _load()`` runs fresh. monkeypatch undoes everything at
    teardown."""
    # Wipe any leftover values from .env.local that the test runner may
    # have sourced into the shell.
    for k in [
        "ASR_PROVIDER", "LLM_PROVIDER", "TTS_PROVIDER", "POLISH_PROVIDER",
        "MLX_QWEN_MODEL", "MLX_TTS_VOICE", "KEEP_AUDIO", "WARMUP",
        "DASHSCOPE_API_KEY", "ABLEWORK_TOKEN",
        "SYSTEM_PROMPT", "SYSTEM_PROMPT_FILE",
        "CHAT_SENT_SOFT_CAP", "MLX_TTS_TEMPERATURE",
    ]:
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, str(v))
    import voice.config as cfg
    return importlib.reload(cfg)


def test_defaults_load_clean(monkeypatch):
    cfg = _reload(monkeypatch)
    assert cfg.settings.asr.provider == "mlx"
    assert cfg.settings.llm.provider == "ablework"
    assert cfg.settings.tts.provider == "mlx"
    assert cfg.settings.tts.voice == "serena"
    assert cfg.settings.warmup is True
    assert cfg.settings.storage.keep_audio is False


def test_invalid_provider_raises(monkeypatch):
    with pytest.raises(RuntimeError, match="ASR_PROVIDER"):
        _reload(monkeypatch, ASR_PROVIDER="bogus")


def test_bool_parsing(monkeypatch):
    cfg = _reload(monkeypatch, KEEP_AUDIO="yes", WARMUP="0")
    assert cfg.settings.storage.keep_audio is True
    assert cfg.settings.warmup is False


def test_int_typo_raises_loud(monkeypatch):
    with pytest.raises(RuntimeError, match="CHAT_SENT_SOFT_CAP"):
        _reload(monkeypatch, CHAT_SENT_SOFT_CAP="forty")


def test_active_model_id_dispatches(monkeypatch):
    cfg = _reload(monkeypatch, ASR_PROVIDER="dashscope")
    assert cfg.settings.asr_active_model_id == cfg.settings.dashscope.asr_model
    cfg = _reload(monkeypatch, ASR_PROVIDER="mlx")
    assert cfg.settings.asr_active_model_id == cfg.settings.asr.mlx_model


def test_token_legacy_alias_removed(monkeypatch):
    """``TOKEN`` (no prefix) used to fall back to ABLEWORK_TOKEN.
    That alias is gone — setting only ``TOKEN`` must not populate
    ablework.token."""
    cfg = _reload(monkeypatch, TOKEN="must-be-ignored")
    assert cfg.settings.ablework.token == ""


def test_system_prompt_file_loads(tmp_path, monkeypatch):
    f = tmp_path / "prompt.txt"
    f.write_text("custom system prompt from file\n", encoding="utf-8")
    cfg = _reload(monkeypatch, SYSTEM_PROMPT_FILE=str(f))
    assert cfg.settings.llm.system_prompt == "custom system prompt from file"


def test_system_prompt_file_missing_raises(monkeypatch):
    with pytest.raises(RuntimeError, match="SYSTEM_PROMPT_FILE"):
        _reload(monkeypatch, SYSTEM_PROMPT_FILE="/no/such/path.txt")


def test_system_prompt_inline_used(monkeypatch):
    cfg = _reload(monkeypatch, SYSTEM_PROMPT="inline override prompt")
    assert cfg.settings.llm.system_prompt == "inline override prompt"


def test_public_view_redacts_secrets(monkeypatch):
    long_token = "eyJhbGciOiJSUzI1NiIs" + "x" * 100
    cfg = _reload(
        monkeypatch,
        DASHSCOPE_API_KEY="sk-1234567890abcdef1234567890abcdef",
        ABLEWORK_TOKEN=long_token,
    )
    view = cfg.public_view()
    import json
    blob = json.dumps(view, ensure_ascii=False)
    # Raw secrets must not appear anywhere in the dump.
    assert "sk-1234567890abcdef" not in blob
    assert long_token not in blob
    # Redacted form keeps a 4-char prefix + length hint so users can
    # sanity-check a key is set.
    assert view["dashscope"]["api_key"].startswith("sk-1")
    assert "(len=" in view["dashscope"]["api_key"]
    assert view["ablework"]["token"].startswith("eyJh")
    assert "(len=" in view["ablework"]["token"]


def test_public_view_empty_secrets_shown_empty(monkeypatch):
    cfg = _reload(monkeypatch)  # no creds
    view = cfg.public_view()
    assert view["dashscope"]["api_key"] == ""
    assert view["ablework"]["token"] == ""
