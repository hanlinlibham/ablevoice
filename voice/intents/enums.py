"""Intent enum + result dataclass — shared by classify / handlers / api."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class Intent(str, Enum):
    CHAT = "chat"
    WS_LIST = "ws_list"
    WS_SWITCH = "ws_switch"
    WS_CREATE = "ws_create"
    WS_MOVE = "ws_move"
    WS_LEAVE = "ws_leave"

    @classmethod
    def parse(cls, raw: str) -> "Intent":
        """Forgiving parse — lowercase, unknown → CHAT (safe default)."""
        try:
            return cls(raw.strip().lower())
        except ValueError:
            return cls.CHAT


@dataclass
class IntentResult:
    """What the classifier produced + what the handler did with it.

    ``intent`` is always set. The semantic fields (workspace_match /
    new_name / confidence) depend on intent type. ``ack_text`` is the
    natural-language reply the handler wants spoken back to the user
    (set after handling — None means "fall through to chat")."""
    intent: Intent
    raw_text: str                              # the polished input we classified
    confidence: float = 1.0                    # 0..1; below threshold → treat as CHAT
    workspace_match: Optional[str] = None      # exact name from cache (ws_switch / ws_move)
    workspace_id: Optional[str] = None         # resolved id after handler runs
    new_name: Optional[str] = None             # for ws_create
    # Set by handler:
    handled: bool = False                      # True if NOT falling through to chat
    ack_text: Optional[str] = None             # what to speak back ("已切换到 X" etc)
    error: Optional[str] = None                # set on handler failure
    ms_classify: int = 0                       # LLM classify latency
    ms_handle: int = 0                         # handler action latency (API call etc)
    skipped_classify: bool = False             # pre-filter said "obvious chat, skip LLM"

    @property
    def is_workspace_op(self) -> bool:
        return self.intent != Intent.CHAT
