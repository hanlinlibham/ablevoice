"""Per-WsSession workspace cache + refresh strategy.

The classifier needs the workspace name list as context so it can
fuzzy-match user-spoken names to actual cached names. Caching at the
session level (not module-global) keeps multi-user / multi-WS isolation
clean — different sessions could have different tokens / workspaces in
principle.

Refresh policy:
  - first refresh: lazy, when first accessed (or proactively on WS hello)
  - manual: ``refresh()`` call (after ws_create succeeds, after a "X
    not found" miss, on user-triggered refresh event)
"""

from __future__ import annotations

import logging
from typing import Optional

from .. import ablework_api

logger = logging.getLogger("voice.intents.workspace_cache")


class WorkspaceCache:
    """Mutable per-session cache. Order is newest-active-first as
    returned by ``/workspaces``."""

    def __init__(self):
        self._workspaces: list[dict] = []
        self._loaded: bool = False

    @property
    def loaded(self) -> bool:
        return self._loaded

    @property
    def workspaces(self) -> list[dict]:
        return list(self._workspaces)

    @property
    def names(self) -> list[str]:
        return [w.get("name", "?") for w in self._workspaces]

    async def refresh(self) -> int:
        """Re-fetch from /workspaces. Returns count. Failures leave
        the cache as-is + log a warning."""
        try:
            rows = await ablework_api.list_workspaces()
        except Exception:
            logger.exception("workspace refresh failed (keeping stale cache)")
            return len(self._workspaces)
        self._workspaces = rows
        self._loaded = True
        logger.info("workspace cache: %d entries", len(rows))
        return len(rows)

    def find_by_name(self, name: str) -> Optional[dict]:
        """Layered match (most-strict → most-lenient):
          1. Exact equality
          2. Case-insensitive equality
          3. Substring (either direction)
          4. Token-order: user input split on whitespace, all tokens
             must appear in ws name in order. Handles e.g. "vix 监控"
             matching "vix 指数的监控" — neither substring works because
             of the "指数的" between, but tokens [vix, 监控] do.

        Returns None if nothing matches. Caller should refresh + retry
        once before giving up."""
        if not name:
            return None
        # 1. Exact
        for w in self._workspaces:
            if w.get("name") == name:
                return w
        # 2. Case-insensitive
        low = name.lower()
        for w in self._workspaces:
            if w.get("name", "").lower() == low:
                return w
        # 3. Substring (either direction)
        for w in self._workspaces:
            if low in w.get("name", "").lower():
                return w
        for w in self._workspaces:
            if w.get("name", "").lower() in low:
                return w
        # 4. Token-order match
        tokens = [t for t in low.split() if t]
        if tokens:
            for w in self._workspaces:
                if _tokens_in_order(tokens, w.get("name", "").lower()):
                    return w
        return None

    def by_id(self, ws_id: str) -> Optional[dict]:
        for w in self._workspaces:
            if w.get("id") == ws_id:
                return w
        return None

    def add(self, ws: dict) -> None:
        """After ws_create succeeds, splice the new row at the front
        so subsequent classifies see it as the most-recent option."""
        self._workspaces.insert(0, ws)


def _tokens_in_order(tokens: list[str], hay: str) -> bool:
    """All ``tokens`` appear in ``hay`` in order (not necessarily
    adjacent). Both already lowercased by caller."""
    pos = 0
    for tok in tokens:
        i = hay.find(tok, pos)
        if i < 0:
            return False
        pos = i + len(tok)
    return True
