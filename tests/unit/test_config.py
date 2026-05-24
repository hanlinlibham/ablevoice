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
        "ASR_PROVIDER", "LLM_PROVIDER", "TTS_PROVIDER",
        "MLX_QWEN_MODEL", "MLX_TTS_VOICE", "KEEP_AUDIO", "WARMUP",
        "DASHSCOPE_API_KEY", "ABLEWORK_TOKEN", "TOKEN",
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


def test_token_falls_back_to_legacy_env(monkeypatch):
    cfg = _reload(monkeypatch, TOKEN="legacy-token-value")
    assert cfg.settings.llm.ablework_token == "legacy-token-value"


def test_bool_parsing(monkeypatch):
    cfg = _reload(monkeypatch, KEEP_AUDIO="yes", WARMUP="0")
    assert cfg.settings.storage.keep_audio is True
    assert cfg.settings.warmup is False


def test_int_typo_raises_loud(monkeypatch):
    with pytest.raises(RuntimeError, match="CHAT_SENT_SOFT_CAP"):
        _reload(monkeypatch, CHAT_SENT_SOFT_CAP="forty")


def test_active_model_id_dispatches(monkeypatch):
    cfg = _reload(monkeypatch, ASR_PROVIDER="dashscope")
    assert cfg.settings.asr.active_model_id == cfg.settings.asr.ds_model
    cfg = _reload(monkeypatch, ASR_PROVIDER="mlx")
    assert cfg.settings.asr.active_model_id == cfg.settings.asr.mlx_model
