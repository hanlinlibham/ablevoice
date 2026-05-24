"""Terminal voice client — package layout.

Modules:

    config    — env reads + numeric constants + logging setup
    models    — Message dataclass
    audio     — AudioStreamer (gap-free chunked playback)
    devices   — input device selection helpers
    widgets   — StatusBar / Conversation / MicMeter (Textual widgets)
    recorder  — mic InputStream + dedicated async PCM sender task
    ws        — WS client + event dispatch table + reconnect loop
    app       — VoiceTUI Textual App that wires everything

``tui.py`` (repo root) is a 5-line entry that imports ``app.VoiceTUI``.
"""

from .app import VoiceTUI

__all__ = ["VoiceTUI"]
