#!/usr/bin/env python3
"""Terminal voice client for able-asr.

Layout / wiring lives in ``voice_tui/`` — this file is the executable
entry. Run via ``./tui.py`` or ``./start-tui.sh``.
"""
from voice_tui.app import VoiceTUI

if __name__ == "__main__":
    VoiceTUI().run()
