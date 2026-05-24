"""Constants + env reads + logging setup.

Mirrors the server-side ``voice/config.py`` philosophy: one place for
every env var so a typo doesn't silently fall back.
"""

from __future__ import annotations

import logging
import os
from urllib.parse import urlparse, urlunparse


# --- network ---------------------------------------------------------------

SERVER_URL = os.environ.get("SERVER_URL", "ws://127.0.0.1:8501/ws")


def http_base_url() -> str:
    """Derive ``http://host:port`` from ``SERVER_URL`` (which is the WS
    URL). Used for /drafts REST calls — keeps the user from having to
    set two env vars."""
    p = urlparse(SERVER_URL)
    scheme = "http" if p.scheme == "ws" else "https" if p.scheme == "wss" else p.scheme
    return urlunparse((scheme, p.netloc, "", "", "", ""))


# --- audio I/O -------------------------------------------------------------

MIC_SR = 16000           # what the server's ASR wants
MIC_BLOCK = 800          # 50ms @ 16kHz, matches the AudioWorklet on the browser side

DEFAULT_TTS_SR = 24000   # overridden by the server's ``ready`` event
# How many PCM frames we buffer before back-pressuring the mic callback.
# 100 frames × 50ms = 5s of buffered audio — plenty for a momentary
# WS stall without dropping mic input.
PCM_QUEUE_SIZE = 100


# --- reconnect -------------------------------------------------------------

# Exponential backoff parameters for the WS reconnect loop. Cap at 30s
# so a long server outage doesn't make you wait minutes after recovery.
RECONNECT_INITIAL_SEC = 1.0
RECONNECT_MAX_SEC = 30.0
RECONNECT_FACTOR = 1.8


# --- voice cycling ---------------------------------------------------------

# Pressed ``v`` to cycle through these — order = preference. mlx voices
# (local CustomVoice) first, then a curated cloud subset. Hot-swap
# changes the active voice for *subsequent* TTS chunks; in-flight chunks
# play out at the previous voice.
MLX_VOICE_CYCLE = (
    "serena", "vivian", "ono_anna", "sohee",   # female
    "ryan", "aiden", "dylan", "eric", "uncle_fu",  # male
)

# Cloud voices via dashscope qwen3-tts-instruct-flash. Pressed ``V``
# (Shift+v) to cycle. Small curated set — the full ~50 catalog isn't
# worth typing through.
DASHSCOPE_VOICE_CYCLE = (
    "Maia", "Cherry", "Chelsie", "Ethan",
)


# --- logging ---------------------------------------------------------------

LOG_PATH = os.environ.get("VOICE_TUI_LOG", "/tmp/voice-tui.log")


def setup_logging() -> logging.Logger:
    """File-based debug logging. Textual owns the screen so prints/log
    would corrupt the UI. ``tail -f /tmp/voice-tui.log`` in another
    terminal to watch live. Toggle off with ``VOICE_TUI_DEBUG=0``."""
    level = logging.DEBUG if os.environ.get("VOICE_TUI_DEBUG", "1") != "0" else logging.WARNING
    logging.basicConfig(
        filename=LOG_PATH,
        level=level,
        format="%(asctime)s.%(msecs)03d [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        filemode="w",  # truncate on each run so logs match the current session
    )
    return logging.getLogger("tui")
