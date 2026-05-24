"""Rule-based validators — no LLM. Checks polish output against the
raw text, returning structured errors for the retry node.

Validators are intentionally strict on things the LLM commonly gets
wrong (preamble, lost digits) and lenient on style (we accept any
phrasing as long as content invariants hold).
"""

from __future__ import annotations

import re

from .state import Validation


_BAD_PREFIX = (
    "好的", "好,", "好啊",
    "整理后", "以下是", "这是", "改写后",
    "Sure", "Here", "Here is", "Here's",
    "Okay", "OK", "OK,",
)


def validate(raw: str, polished: str) -> Validation:
    """Return ``{"ok": bool, "errors": [...]}``. Empty errors → pass."""
    errors: list[str] = []
    s = polished.strip()

    if not s:
        return Validation(ok=False, errors=["empty_output"])

    if any(s.startswith(p) for p in _BAD_PREFIX):
        errors.append("has_preamble")

    # Length sanity. Polish should never grow the text dramatically
    # (it deletes fillers + tightens phrasing). 1.8x is generous to
    # leave room for "把它" → "把这个东西" kind of natural expansion.
    if len(s) > max(len(raw) * 1.8, 30):
        errors.append("too_long")
    # Conversely too-short means the LLM cut content. Be lenient on
    # short inputs (8-char rambling commonly trims to 5).
    if len(s) < len(raw) * 0.3 and len(raw) > 20:
        errors.append("too_short")

    # Digit preservation. Every contiguous digit run in raw must appear
    # somewhere in polished. We don't check 顺序 — model may reorder
    # phrases.
    for d in re.findall(r"\d+", raw):
        if d not in s:
            errors.append(f"lost_digit:{d}")

    return Validation(ok=not errors, errors=errors)
