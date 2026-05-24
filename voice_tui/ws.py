"""WebSocket client — connection lifecycle + event dispatch + reconnect.

Owns the WS object; everything else (recording, UI updates, draft
recovery) talks through a small callback interface so the app module
doesn't need to know how WS works.

Event dispatch
==============
``HANDLERS = {event_name: method_name}`` table replaces the long
``if t == "...": ...`` chain that used to live in VoiceTUI._handle_event.
Adding a new server-side event = add a class method + one line.

Reconnect (B3)
==============
On clean ``ConnectionClosed`` we attempt exponential-backoff reconnect.
The session_id is preserved across reconnects, so the server's
conversation store + ablework conv_id continue to make sense. After
reconnect we ask the server for any ``interrupted`` drafts and surface
them via ``on_drafts_available``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Awaitable, Callable, Optional

import httpx
import websockets

from .config import (
    RECONNECT_FACTOR,
    RECONNECT_INITIAL_SEC,
    RECONNECT_MAX_SEC,
    SERVER_URL,
    http_base_url,
)

log = logging.getLogger("tui.ws")


# --- callback type hints ---------------------------------------------------

EventHandler = Callable[[dict], Awaitable[None]]
DraftsCallback = Callable[[list[dict]], Awaitable[None]]
StatusCallback = Callable[[bool, bool], None]  # (connected, reconnecting)


class WsClient:
    """Async WS connection holder + dispatcher.

    The app subclasses or composes this and wires ``on_event_*`` methods
    on its event handler dict. We don't use inheritance — the app passes
    a dict of handlers in at construction.
    """

    def __init__(
        self,
        *,
        session_id: Optional[str] = None,
        handlers: dict[str, EventHandler],
        on_status: StatusCallback,
        on_drafts_available: DraftsCallback,
    ):
        self.session_id = session_id or uuid.uuid4().hex
        self._handlers = handlers
        self._on_status = on_status
        self._on_drafts = on_drafts_available
        self._ws: Optional[websockets.ClientConnection] = None  # type: ignore[name-defined]
        self._read_task: Optional[asyncio.Task] = None
        self._reconnect_delay = RECONNECT_INITIAL_SEC
        self._stopping = False

    @property
    def is_open(self) -> bool:
        if self._ws is None:
            return False
        try:
            from websockets.protocol import State  # noqa: PLC0415
            return self._ws.state is State.OPEN
        except Exception:
            return True

    async def send_json(self, obj: dict) -> None:
        if not self.is_open or self._ws is None:
            log.debug("send_json skipped — ws not open: %s", obj.get("type"))
            return
        try:
            await self._ws.send(json.dumps(obj))
        except Exception:
            log.exception("send_json failed: %s", obj.get("type"))

    async def send_bytes(self, data: bytes) -> None:
        if not self.is_open or self._ws is None:
            return
        try:
            await self._ws.send(data)
        except Exception:
            # Caller (recorder) tolerates failures — frame is dropped,
            # recording continues, server-side draft has its part.
            raise

    async def run(self) -> None:
        """Connect-read-reconnect loop. Returns only when ``stop()`` is
        called (caller hits ``q`` etc.)."""
        while not self._stopping:
            self._on_status(False, True)  # reconnecting
            try:
                self._ws = await websockets.connect(SERVER_URL)
            except Exception as exc:
                log.warning("WS connect failed: %s (retry in %.1fs)", exc, self._reconnect_delay)
                await asyncio.sleep(self._reconnect_delay)
                self._reconnect_delay = min(
                    self._reconnect_delay * RECONNECT_FACTOR, RECONNECT_MAX_SEC,
                )
                continue
            # Connected.
            self._reconnect_delay = RECONNECT_INITIAL_SEC
            self._on_status(True, False)
            await self.send_json({"type": "hello", "session_id": self.session_id})
            # Surface any interrupted drafts (crash from previous run or
            # WS drop from a moment ago).
            asyncio.create_task(self._refresh_drafts(), name="refresh-drafts")
            # Read loop. Exits on disconnect; outer while triggers reconnect.
            try:
                async for raw in self._ws:
                    if not isinstance(raw, str):
                        continue
                    try:
                        ev = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    await self._dispatch(ev)
            except websockets.exceptions.ConnectionClosed:
                pass
            except Exception:
                log.exception("WS read loop crashed")
            finally:
                self._ws = None
                self._on_status(False, not self._stopping)
            # Loop iterates → reconnect attempt.

    async def _dispatch(self, ev: dict) -> None:
        t = ev.get("type")
        handler = self._handlers.get(t or "")
        if handler is None:
            log.debug("unhandled event type: %r", t)
            return
        try:
            await handler(ev)
        except Exception:
            log.exception("handler crashed for event %r", t)

    async def _refresh_drafts(self) -> None:
        """GET /drafts?status=interrupted via HTTP. Server lifespan
        runs ``mark_orphans_interrupted`` on startup; this picks up
        anything left over from a previous run or a WS that died."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{http_base_url()}/drafts?status=interrupted")
                if r.status_code != 200:
                    return
                rows = r.json()
        except Exception:
            log.exception("draft refresh failed (continuing)")
            return
        if rows:
            await self._on_drafts(rows)

    async def stop(self) -> None:
        self._stopping = True
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
