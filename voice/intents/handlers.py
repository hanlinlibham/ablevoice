"""Intent handlers — one async function per Intent value.

Each handler is passed the (already-classified) IntentResult + a
SessionContext that exposes:
    - cache: WorkspaceCache (mutable)
    - workspace_override_setter / getter (per-session active ws id)
    - reset_conversation(): nuke local + ablework conv state
    - reset_ablework_session(): only clear ablework conv_id (keep local)

Returns the same IntentResult with ``handled=True``, ``ack_text``, and
optionally ``workspace_id`` / ``error`` populated.
"""

from __future__ import annotations

import logging
import time
from typing import Awaitable, Callable, Protocol

from .. import ablework_api
from .enums import Intent, IntentResult
from .workspace_cache import WorkspaceCache

logger = logging.getLogger("voice.intents.handlers")


class SessionCtx(Protocol):
    """Subset of WsSession the handlers need. Defined as Protocol so
    tests can pass a tiny mock instead of a full WsSession."""
    @property
    def cache(self) -> WorkspaceCache: ...
    def get_workspace_override(self) -> str | None: ...
    def set_workspace_override(self, ws_id: str | None) -> None: ...
    def reset_conversation(self) -> int: ...        # full nuke
    def reset_ablework_session_only(self) -> None: ...  # ablework conv_id only


# ---------------------------------------------------------------------------

async def handle(result: IntentResult, ctx: SessionCtx) -> IntentResult:
    """Dispatch on intent. Always returns the (mutated) ``result``.
    ``result.handled`` ends up True except when intent==CHAT (fall
    through to chat pipeline)."""
    t0 = time.monotonic()
    try:
        if result.intent == Intent.CHAT:
            result.handled = False
            return result
        if result.intent == Intent.WS_LIST:
            await _handle_list(result, ctx)
        elif result.intent == Intent.WS_SWITCH:
            await _handle_switch(result, ctx)
        elif result.intent == Intent.WS_MOVE:
            await _handle_move(result, ctx)
        elif result.intent == Intent.WS_CREATE:
            await _handle_create(result, ctx)
        elif result.intent == Intent.WS_LEAVE:
            await _handle_leave(result, ctx)
        else:
            result.handled = False
    except Exception as exc:
        logger.exception("intent handler crashed for %s", result.intent)
        result.handled = True
        result.error = f"{type(exc).__name__}: {exc}"
        result.ack_text = f"操作失败:{exc}"
    finally:
        result.ms_handle = int((time.monotonic() - t0) * 1000)
    return result


# ---------------------------------------------------------------------------
# Per-intent implementations

async def _ensure_cache(ctx: SessionCtx) -> None:
    if not ctx.cache.loaded:
        await ctx.cache.refresh()


async def _handle_list(result: IntentResult, ctx: SessionCtx) -> None:
    await _ensure_cache(ctx)
    names = ctx.cache.names
    if not names:
        result.ack_text = "你还没有工作区,需要的话我可以帮你新建一个。"
    else:
        # Limit ack to first 8 — TTS doesn't want to read a long list
        head = names[:8]
        more = f",还有 {len(names) - 8} 个" if len(names) > 8 else ""
        result.ack_text = f"你有 {len(names)} 个工作区:" + "、".join(head) + more
    result.handled = True


async def _resolve_target(name: str | None, ctx: SessionCtx) -> dict | None:
    """Cache lookup with one refresh retry (catches user's just-created
    ws not yet in cache)."""
    if not name:
        return None
    await _ensure_cache(ctx)
    found = ctx.cache.find_by_name(name)
    if found is not None:
        return found
    # Refresh + retry once
    await ctx.cache.refresh()
    return ctx.cache.find_by_name(name)


def _suggest_workspaces(ctx: SessionCtx) -> str:
    """Short list of candidate names for "X not found" error messages."""
    names = ctx.cache.names[:5]
    if not names:
        return ""
    more = f" 等 {len(ctx.cache.names)} 个" if len(ctx.cache.names) > 5 else ""
    return "、".join(names) + more


async def _handle_switch(result: IntentResult, ctx: SessionCtx) -> None:
    found = await _resolve_target(result.workspace_match, ctx)
    if found is None:
        result.handled = True
        result.error = "workspace_not_found"
        suggest = _suggest_workspaces(ctx)
        if result.workspace_match:
            result.ack_text = f"没找到名为 {result.workspace_match} 的工作区。" + (
                f"你的工作区有:{suggest}。" if suggest else ""
            )
        else:
            result.ack_text = "我没听清要切到哪个工作区。" + (
                f"你的工作区有:{suggest}。" if suggest else ""
            )
        return
    ws_id = found["id"]
    ctx.set_workspace_override(ws_id)
    try:
        await ablework_api.touch_workspace(ws_id)
    except Exception:
        logger.warning("touch_workspace failed (continuing)", exc_info=True)
    ctx.reset_conversation()
    result.workspace_id = ws_id
    result.workspace_match = found["name"]   # canonicalise (might have fuzzy-matched)
    result.handled = True
    result.ack_text = f"已切换到 {found['name']},对话已清空。"


async def _handle_move(result: IntentResult, ctx: SessionCtx) -> None:
    found = await _resolve_target(result.workspace_match, ctx)
    if found is None:
        result.handled = True
        result.error = "workspace_not_found"
        suggest = _suggest_workspaces(ctx)
        result.ack_text = f"没找到要搬到的工作区。" + (
            f"你的工作区有:{suggest}。" if suggest else ""
        )
        return
    ws_id = found["id"]
    ctx.set_workspace_override(ws_id)
    try:
        await ablework_api.touch_workspace(ws_id)
    except Exception:
        logger.warning("touch_workspace failed (continuing)", exc_info=True)
    # Move keeps local conversation history visible — only resets the
    # ablework-side conv_id so the new workspace gets a fresh server
    # conv (it'll still see history because we send the full messages
    # list every turn).
    ctx.reset_ablework_session_only()
    result.workspace_id = ws_id
    result.workspace_match = found["name"]
    result.handled = True
    result.ack_text = f"已把对话搬到 {found['name']},历史保留。"


async def _handle_create(result: IntentResult, ctx: SessionCtx) -> None:
    if not result.new_name:
        result.handled = True
        result.error = "missing_name"
        result.ack_text = "我没听清要新建什么名字的工作区,请再说一遍。"
        return
    try:
        ws = await ablework_api.create_workspace(result.new_name)
    except Exception as exc:
        result.handled = True
        result.error = f"create_failed: {exc}"
        result.ack_text = f"创建工作区失败:{exc}"
        return
    ctx.cache.add(ws)
    ws_id = ws.get("id", "")
    ctx.set_workspace_override(ws_id)
    ctx.reset_conversation()
    result.workspace_id = ws_id
    result.workspace_match = ws.get("name", result.new_name)
    result.handled = True
    result.ack_text = f"已创建工作区 {result.new_name} 并切入,对话从空开始。"


async def _handle_leave(result: IntentResult, ctx: SessionCtx) -> None:
    ctx.set_workspace_override(None)
    ctx.reset_conversation()
    result.workspace_id = None
    result.handled = True
    result.ack_text = "已退出工作区,回到默认。"
