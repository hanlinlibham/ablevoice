"""Voice meta-commands — short, deterministic utterances that control the
voice loop itself (stop, slow down, louder, etc.) rather than feeding the
chat agent.

Why a separate fast path
========================
Running these through ASR → polish → intent classify → chat takes ~3s.
The user's expectation when saying "停" is sub-second response. We trade
fewer features (only 6 fixed commands) for round-trip latency that's
just ``ASR finish + regex match + handler dispatch``.

Selection rule
==============
Fast path triggers only when ALL of these hold:

  1. recording duration < ``MAX_DURATION_MS`` (default 1500ms) — long
     utterances are clearly not single-word commands
  2. transcript text length ≤ ``MAX_TEXT_LEN`` (4 chars) — guards against
     ASR over-recognition when the user mumbled a full sentence
  3. the (stripped) text matches one of the keyword patterns

Misses fall through to the normal polish + intent + chat pipeline.

Available commands
==================

  STOP        停 / 暂停 / 停止 / 别说了        → cancel current chat task
  RESUME      继续 / 接着说                    → reserved; client-side replay-from-pause
  REPLAY      重说 / 再说一遍 / 重复            → re-emit last assistant audio
  SLOWER      慢点 / 慢一点 / 说慢点            → decrease speech_rate
  FASTER      快点 / 快一点 / 说快点            → increase speech_rate
  LOUDER      大声点 / 大点声 / 声音大点         → increase volume
  QUIETER     小声点 / 小点声 / 声音小点         → decrease volume
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Optional


class MetaCommand(str, Enum):
    STOP = "stop"
    RESUME = "resume"
    REPLAY = "replay"
    SLOWER = "slower"
    FASTER = "faster"
    LOUDER = "louder"
    QUIETER = "quieter"


@dataclass
class MetaMatch:
    """A fast-path match. ``ack_text`` is the short Chinese reply we'll
    TTS back ("好的,放慢一些"); leaving it None falls back to a generic
    "好的" the WS handler may speak."""
    command: MetaCommand
    matched_phrase: str
    ack_text: str


# Gates — utterances longer than these can't plausibly be meta-commands
# (the longest in our table is 4 chars, recording > 1.5s carries real
# content). Tunable via the public constants for tests / experiments.
MAX_DURATION_MS = 1500
MAX_TEXT_LEN = 4


# Punctuation tolerated at the end of an ASR result. We strip BEFORE
# matching so a partial like "停。" or "慢点!" still hits.
_TRAILING_PUNCT = re.compile(r"[。!?,\.!?,\s]+$")

# Pattern → (command, ack_text). Patterns are anchored ``^...$`` against
# the stripped transcript so we don't match e.g. "停下手头的工作" as STOP.
# Multiple synonyms per command, full-width and half-width tolerated.
# Order matters only for unambiguous matches (no overlap currently).
_PATTERNS: list[tuple[re.Pattern[str], MetaCommand, str]] = [
    (re.compile(r"^(停|停下|暂停|停止|别说了|别说)$"),       MetaCommand.STOP,    "好的"),
    (re.compile(r"^(继续|接着说|接着讲|继续讲)$"),          MetaCommand.RESUME,  "好的,继续"),
    (re.compile(r"^(重说|重复|再说一遍|再来一遍|再说)$"),    MetaCommand.REPLAY,  "好的,我再说一遍"),
    (re.compile(r"^(慢点|慢一点|说慢点|慢些|放慢)$"),       MetaCommand.SLOWER,  "好的,放慢"),
    (re.compile(r"^(快点|快一点|说快点|快些|加快)$"),       MetaCommand.FASTER,  "好的,加快"),
    (re.compile(r"^(大声点|大点声|声音大点|大声)$"),        MetaCommand.LOUDER,  "好的,大声"),
    (re.compile(r"^(小声点|小点声|声音小点|小声)$"),        MetaCommand.QUIETER, "好的,小声"),
]


def match(text: str, duration_ms: int) -> Optional[MetaMatch]:
    """Try to match a fast-path meta-command. Returns ``None`` if any
    gate fails (duration too long, text too long, no pattern hit)."""
    if not text or duration_ms > MAX_DURATION_MS:
        return None
    stripped = _TRAILING_PUNCT.sub("", text.strip())
    if not stripped or len(stripped) > MAX_TEXT_LEN:
        return None
    for pat, cmd, ack in _PATTERNS:
        m = pat.match(stripped)
        if m:
            return MetaMatch(command=cmd, matched_phrase=stripped, ack_text=ack)
    return None
