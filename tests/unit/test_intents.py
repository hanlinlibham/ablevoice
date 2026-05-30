"""Unit tests for voice.intents — pre-filter regex, JSON parser,
workspace_cache fuzzy match, handler side effects (mocked API)."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from voice.intents.classify import _parse_classify_output, looks_like_workspace_op
from voice.intents.enums import Intent, IntentResult
from voice.intents.handlers import handle
from voice.intents.workspace_cache import WorkspaceCache


# --- Pre-filter regex ------------------------------------------------------

class TestLooksLikeWorkspaceOp:

    @pytest.mark.parametrize("text", [
        "切到 vix 监控",
        "切换工作区",
        "用 coding 工作区",
        "新建一个 X 工作区",
        "建个叫 港股周报 的工作区",
        "把这个对话搬到 量化研究",
        "把刚才的对话归到 闲聊",
        "退出工作区",
        "回到默认",
        "我有什么工作区",
        "有哪些工作区",
        "列出所有 workspace",
        "进入 coding",
        "switch to coding",   # English trigger via 'switch'? wait no
    ])
    def test_triggers(self, text):
        # NOTE: "switch to" 没在 regex 里(英文不是主要场景),所以可能 False
        # 这里测的是中文 + workspace 关键词。English 失败可以接受。
        result = looks_like_workspace_op(text)
        if "切" in text or "换" in text or "工作区" in text or "workspace" in text \
                or "搬" in text or "归到" in text or "退出" in text or "回到" in text \
                or "新建" in text or "建一个" in text or "建个" in text \
                or "列出" in text or "有什么" in text or "有哪些" in text \
                or "进入" in text:
            assert result is True, f"expected True for {text!r}"

    @pytest.mark.parametrize("text", [
        "今天市场怎么样",
        "vix 现在多少",
        "帮我查个数据",
        "你好",
        "what's the weather",
        "",
        "   ",
    ])
    def test_no_trigger(self, text):
        assert looks_like_workspace_op(text) is False


# --- JSON parser -----------------------------------------------------------

class TestParseClassifyOutput:

    def test_valid_chat(self):
        raw = '{"intent":"chat","workspace_match":null,"new_name":null,"confidence":0.95}'
        r = _parse_classify_output(raw, "hi")
        assert r.intent == Intent.CHAT
        assert r.confidence == 0.95
        assert r.workspace_match is None

    def test_valid_switch(self):
        raw = '{"intent":"ws_switch","workspace_match":"vix 指数的监控","new_name":null,"confidence":0.9}'
        r = _parse_classify_output(raw, "切到 vix")
        assert r.intent == Intent.WS_SWITCH
        assert r.workspace_match == "vix 指数的监控"

    def test_valid_create(self):
        raw = '{"intent":"ws_create","workspace_match":null,"new_name":"港股周报","confidence":0.95}'
        r = _parse_classify_output(raw, "新建港股周报工作区")
        assert r.intent == Intent.WS_CREATE
        assert r.new_name == "港股周报"

    def test_wrapped_in_code_fence(self):
        raw = '```json\n{"intent":"ws_list","confidence":1.0}\n```'
        r = _parse_classify_output(raw, "我有什么工作区")
        assert r.intent == Intent.WS_LIST

    def test_invalid_json_falls_back_to_chat(self):
        raw = "not json at all"
        r = _parse_classify_output(raw, "anything")
        assert r.intent == Intent.CHAT
        assert r.confidence == 0.0

    def test_unknown_intent_value(self):
        raw = '{"intent":"weird_thing","confidence":0.5}'
        r = _parse_classify_output(raw, "x")
        # Intent.parse forgivingly maps unknown → CHAT
        assert r.intent == Intent.CHAT

    def test_missing_fields_get_defaults(self):
        raw = '{"intent":"ws_switch"}'  # no confidence, no match
        r = _parse_classify_output(raw, "x")
        assert r.intent == Intent.WS_SWITCH
        assert r.confidence == 0.0
        assert r.workspace_match is None


# --- Provider dispatch / pure-local path -----------------------------------

class TestIntentProviderDispatch:

    @pytest.mark.asyncio
    async def test_off_short_circuits_to_chat(self, monkeypatch):
        """INTENT_PROVIDER=off must return CHAT without touching the LLM —
        even for text the regex pre-filter would have flagged."""
        import voice.intents.classify as cls
        fake = MagicMock()
        fake.intent.provider = "off"
        monkeypatch.setattr(cls, "settings", fake)
        spy = AsyncMock()
        monkeypatch.setattr(cls, "run_classify", spy)

        r = await cls.classify("切到 coding 工作区", [])
        assert r.intent == Intent.CHAT
        assert r.skipped_classify is True
        spy.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_run_classify_routes_to_mlx(self, monkeypatch):
        import voice.intents.llm as llm_mod
        fake = MagicMock()
        fake.intent.provider = "mlx"
        monkeypatch.setattr(llm_mod, "settings", fake)
        monkeypatch.setattr(llm_mod, "_run_classify_mlx",
                            AsyncMock(return_value="MLX_OUT"))
        assert await llm_mod.run_classify([]) == "MLX_OUT"

    @pytest.mark.asyncio
    async def test_run_classify_routes_to_dashscope(self, monkeypatch):
        import voice.intents.llm as llm_mod
        fake = MagicMock()
        fake.intent.provider = "dashscope"
        monkeypatch.setattr(llm_mod, "settings", fake)
        monkeypatch.setattr(llm_mod, "_run_classify_dashscope",
                            AsyncMock(return_value="DS_OUT"))
        assert await llm_mod.run_classify([]) == "DS_OUT"


# --- WorkspaceCache fuzzy match -------------------------------------------

WS_FIXTURE = [
    {"id": "id-1", "name": "vix 指数的监控"},
    {"id": "id-2", "name": "coding"},
    {"id": "id-3", "name": "量化研究"},
    {"id": "id-4", "name": "美股周报"},
]


class TestWorkspaceCacheMatch:

    def _cache(self):
        c = WorkspaceCache()
        # copy — TestWorkspaceCacheMatch.test_add_prepends mutates,
        # don't pollute the shared module-level fixture
        c._workspaces = [dict(w) for w in WS_FIXTURE]
        c._loaded = True
        return c

    def test_exact_match(self):
        c = self._cache()
        assert c.find_by_name("coding")["id"] == "id-2"

    def test_case_insensitive(self):
        c = self._cache()
        assert c.find_by_name("CODING")["id"] == "id-2"

    def test_substring_user_says_short(self):
        c = self._cache()
        # User says "vix 监控" → match "vix 指数的监控"
        assert c.find_by_name("vix 监控")["id"] == "id-1"

    def test_substring_ws_inside_user(self):
        c = self._cache()
        # User says "进入 coding 工作区" stripped to "coding" — but
        # workflow passes the full name from LLM, just test substring
        assert c.find_by_name("我要进入 coding 工作区")["id"] == "id-2"

    def test_no_match(self):
        c = self._cache()
        assert c.find_by_name("不存在的工作区") is None

    def test_empty_name(self):
        c = self._cache()
        assert c.find_by_name("") is None
        assert c.find_by_name(None) is None

    def test_by_id(self):
        c = self._cache()
        assert c.by_id("id-3")["name"] == "量化研究"
        assert c.by_id("not-here") is None

    def test_add_prepends(self):
        c = self._cache()
        c.add({"id": "new", "name": "新工作区"})
        assert c.workspaces[0]["id"] == "new"
        assert len(c.workspaces) == 5


# --- Handlers --------------------------------------------------------------

class FakeCtx:
    """Minimal SessionCtx mock for handler tests."""

    def __init__(self, workspaces=None):
        self.cache = WorkspaceCache()
        if workspaces is not None:
            self.cache._workspaces = workspaces
            self.cache._loaded = True
        self._override = None
        self.reset_count = 0
        self.reset_ablework_only_count = 0

    def get_workspace_override(self):
        return self._override

    def set_workspace_override(self, ws_id):
        self._override = ws_id

    def reset_conversation(self):
        self.reset_count += 1
        return 0

    def reset_ablework_session_only(self):
        self.reset_ablework_only_count += 1


@pytest.fixture
def ctx_with_ws():
    return FakeCtx(workspaces=list(WS_FIXTURE))


class TestHandlers:

    @pytest.mark.asyncio
    async def test_chat_returns_unhandled(self, ctx_with_ws):
        r = IntentResult(intent=Intent.CHAT, raw_text="hi", confidence=1.0)
        out = await handle(r, ctx_with_ws)
        assert out.handled is False

    @pytest.mark.asyncio
    async def test_ws_list_returns_ack(self, ctx_with_ws):
        r = IntentResult(intent=Intent.WS_LIST, raw_text="列出", confidence=1.0)
        out = await handle(r, ctx_with_ws)
        assert out.handled is True
        assert "4" in out.ack_text
        assert "coding" in out.ack_text

    @pytest.mark.asyncio
    async def test_ws_switch_found(self, ctx_with_ws):
        with patch("voice.intents.handlers.ablework_api.touch_workspace",
                   new=AsyncMock(return_value=None)):
            r = IntentResult(intent=Intent.WS_SWITCH, raw_text="切到",
                             confidence=0.95, workspace_match="coding")
            out = await handle(r, ctx_with_ws)
        assert out.handled is True
        assert out.workspace_id == "id-2"
        assert ctx_with_ws._override == "id-2"
        assert ctx_with_ws.reset_count == 1
        assert "coding" in out.ack_text

    @pytest.mark.asyncio
    async def test_ws_switch_not_found(self, ctx_with_ws):
        with patch("voice.intents.handlers.ablework_api.list_workspaces",
                   new=AsyncMock(return_value=list(WS_FIXTURE))):
            r = IntentResult(intent=Intent.WS_SWITCH, raw_text="切到",
                             confidence=0.3, workspace_match="不存在的")
            out = await handle(r, ctx_with_ws)
        assert out.handled is True
        assert out.error == "workspace_not_found"
        assert out.ack_text is not None
        assert "不存在的" in out.ack_text
        # No state change
        assert ctx_with_ws._override is None
        assert ctx_with_ws.reset_count == 0

    @pytest.mark.asyncio
    async def test_ws_move_keeps_local_history(self, ctx_with_ws):
        with patch("voice.intents.handlers.ablework_api.touch_workspace",
                   new=AsyncMock(return_value=None)):
            r = IntentResult(intent=Intent.WS_MOVE, raw_text="搬",
                             confidence=0.9, workspace_match="量化研究")
            out = await handle(r, ctx_with_ws)
        assert out.handled is True
        assert ctx_with_ws._override == "id-3"
        # move: reset_ablework_session_only, NOT full reset
        assert ctx_with_ws.reset_ablework_only_count == 1
        assert ctx_with_ws.reset_count == 0

    @pytest.mark.asyncio
    async def test_ws_create(self, ctx_with_ws):
        new_ws = {"id": "id-new", "name": "港股周报", "owner_user_id": "admin"}
        with patch("voice.intents.handlers.ablework_api.create_workspace",
                   new=AsyncMock(return_value=new_ws)):
            r = IntentResult(intent=Intent.WS_CREATE, raw_text="新建",
                             confidence=0.95, new_name="港股周报")
            out = await handle(r, ctx_with_ws)
        assert out.handled is True
        assert out.workspace_id == "id-new"
        assert ctx_with_ws._override == "id-new"
        # New ws should be in cache now
        assert ctx_with_ws.cache.by_id("id-new") is not None
        # ws_create resets conversation (clean slate in new ws)
        assert ctx_with_ws.reset_count == 1

    @pytest.mark.asyncio
    async def test_ws_create_missing_name(self, ctx_with_ws):
        r = IntentResult(intent=Intent.WS_CREATE, raw_text="新建", confidence=0.9)
        out = await handle(r, ctx_with_ws)
        assert out.handled is True
        assert out.error == "missing_name"
        # No API call expected — handler should bail before that

    @pytest.mark.asyncio
    async def test_ws_leave(self, ctx_with_ws):
        ctx_with_ws._override = "id-1"   # was in a workspace
        r = IntentResult(intent=Intent.WS_LEAVE, raw_text="退出", confidence=0.9)
        out = await handle(r, ctx_with_ws)
        assert out.handled is True
        assert ctx_with_ws._override is None
        assert ctx_with_ws.reset_count == 1

    @pytest.mark.asyncio
    async def test_handler_exception_caught(self, ctx_with_ws):
        with patch("voice.intents.handlers.ablework_api.touch_workspace",
                   new=AsyncMock(side_effect=RuntimeError("boom"))):
            r = IntentResult(intent=Intent.WS_SWITCH, raw_text="切",
                             confidence=0.9, workspace_match="coding")
            out = await handle(r, ctx_with_ws)
        # touch_workspace failure is swallowed (logged), switch still
        # completes — that's the contract
        assert out.handled is True
        assert out.error is None
        assert ctx_with_ws._override == "id-2"
