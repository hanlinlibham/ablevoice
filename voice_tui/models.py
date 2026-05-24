"""Conversation row model. Just enough to render with."""

from __future__ import annotations


class Message:
    """One row in the conversation panel."""
    __slots__ = ("role", "text", "info", "streaming", "raw")

    def __init__(
        self, role: str, text: str = "", *,
        info: str = "", streaming: bool = False, raw: str = "",
    ):
        self.role = role            # "user" | "assistant" | "system"
        self.text = text
        self.info = info            # small dim tagline ("ASR 312ms" etc.)
        self.streaming = streaming  # render a caret while still arriving
        # Original raw ASR text (before polish). Stored on user messages
        # so the UI can show a "原:..." line under the polished version
        # — non-empty only when polish actually changed the text.
        self.raw = raw
