"""Audio input device picker.

Default behaviour: return ``None`` so sounddevice uses PortAudio's
default (which on macOS follows the system Sound Settings choice).
Users manage their mic via macOS Sound Settings — TUI doesn't
second-guess.

Escape hatches (highest priority first):

    VOICE_INPUT_DEVICE=<index>     explicit index
    VOICE_INPUT_NAME=<substring>   first input-capable device whose
                                   name contains the substring (case-
                                   insensitive). Useful when Bluetooth
                                   reconnects shuffle indices.
"""

from __future__ import annotations

import os
from typing import Optional

import sounddevice as sd


def resolve_input_device() -> Optional[int]:
    explicit = os.environ.get("VOICE_INPUT_DEVICE")
    if explicit and explicit.lstrip("-").isdigit():
        return int(explicit)
    name_pat = os.environ.get("VOICE_INPUT_NAME")
    if name_pat:
        needle = name_pat.lower()
        try:
            for i, d in enumerate(sd.query_devices()):
                if d.get("max_input_channels", 0) > 0 and needle in d["name"].lower():
                    return i
        except Exception:
            pass
    return None


def format_input_devices() -> str:
    """Compact ``#0 name | #4 name | …`` listing of all input-capable
    devices, so the user can see what indices are available without
    leaving the TUI."""
    try:
        out = []
        for i, d in enumerate(sd.query_devices()):
            if d.get("max_input_channels", 0) > 0:
                out.append(f"#{i} {d['name']}")
        return " | ".join(out)
    except Exception:
        return "?"
