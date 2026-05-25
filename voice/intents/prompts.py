"""Classification prompt construction. Workspace list is injected as
context so the LLM can fuzzy-match user-spoken names to the actual
cached names ("vix 监控" → "vix 指数的监控").

Few-shot examples included for two reasons:
  1. Anchors the JSON output format — qwen-flash sometimes adds prose
     prefix without examples
  2. Demonstrates fuzzy-match behaviour and the null-confidence case
"""

from __future__ import annotations

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage


_BASE_SYSTEM = """\
你是意图分类器。判断用户的输入(已经过 ASR + polish 整理)属于以下哪种意图。

意图列表:
- chat        普通对话,跟工作区无关 (默认,占绝大多数)
- ws_list     列出工作区。如 "我有什么工作区" / "列出所有 workspace"
- ws_switch   切换到某个已存在工作区。如 "切到 X" / "用 X 工作区" / "进入 X"
              switch 会清空当前对话
- ws_create   新建一个工作区。如 "新建一个 X 工作区" / "建个叫 X 的工作区"
              如果同时含 "并切到" 或类似措辞也算 create
- ws_move     把当前对话移动/搬到/归到 某工作区。
              如 "把这个对话搬到 X" / "把刚才的对话归到 X 里"
              move 保留对话历史,但 backend 切到新 ws
- ws_leave    退出工作区,回到默认。如 "退出工作区" / "回到默认"

判断规则:
1. 含 "切" / "用" / "进入" + 工作区名字 → ws_switch
2. 含 "搬" / "归到" / "移到" + 工作区名字 → ws_move
3. 含 "新建" / "建一个" / "建个" + 工作区名字 → ws_create
4. 含 "列" / "有什么" / "有哪些" + 工作区 → ws_list
5. 含 "退出" / "回到默认" + 工作区 → ws_leave
6. 否则一律 chat — 即便句子里出现工作区名字(例如查询该工作区数据)

输出严格 JSON,无前缀无解释:
{
  "intent": "chat|ws_list|ws_switch|ws_create|ws_move|ws_leave",
  "workspace_match": "<已存在工作区的完整名字>" | null,
  "new_name": "<用户想要的新工作区名字>" | null,
  "confidence": 0.0..1.0
}

- workspace_match 必须是工作区列表里的**完整名字**,模糊匹配但要匹上。匹不上 → null + confidence < 0.5
- new_name 仅 ws_create 时填,取用户口述的新名字
- 不要任何前缀(如"好的")或解释"""


_FEW_SHOT_USER_1 = """工作区列表:vix 指数的监控 / coding / 量化研究 / 闲聊

用户输入:切到 vix 监控"""
_FEW_SHOT_AI_1 = '{"intent":"ws_switch","workspace_match":"vix 指数的监控","new_name":null,"confidence":0.95}'

_FEW_SHOT_USER_2 = """工作区列表:vix 指数的监控 / coding / 量化研究 / 闲聊

用户输入:vix 现在多少"""
_FEW_SHOT_AI_2 = '{"intent":"chat","workspace_match":null,"new_name":null,"confidence":0.9}'

_FEW_SHOT_USER_3 = """工作区列表:vix 指数的监控 / coding / 量化研究 / 闲聊

用户输入:新建一个 港股周报 工作区"""
_FEW_SHOT_AI_3 = '{"intent":"ws_create","workspace_match":null,"new_name":"港股周报","confidence":0.95}'

_FEW_SHOT_USER_4 = """工作区列表:vix 指数的监控 / coding / 量化研究 / 闲聊

用户输入:切到 不存在的工作区"""
_FEW_SHOT_AI_4 = '{"intent":"ws_switch","workspace_match":null,"new_name":null,"confidence":0.3}'

_FEW_SHOT_USER_5 = """工作区列表:vix 指数的监控 / coding / 量化研究 / 闲聊

用户输入:把这个对话搬到 量化研究"""
_FEW_SHOT_AI_5 = '{"intent":"ws_move","workspace_match":"量化研究","new_name":null,"confidence":0.95}'


def _few_shot_messages() -> list[BaseMessage]:
    """Few-shot anchored as AI/Human pairs — qwen-flash respects this
    pattern and sometimes drops the JSON format anchor when given only
    system-prompt examples."""
    from langchain_core.messages import AIMessage  # noqa: PLC0415
    pairs = [
        (_FEW_SHOT_USER_1, _FEW_SHOT_AI_1),
        (_FEW_SHOT_USER_2, _FEW_SHOT_AI_2),
        (_FEW_SHOT_USER_3, _FEW_SHOT_AI_3),
        (_FEW_SHOT_USER_4, _FEW_SHOT_AI_4),
        (_FEW_SHOT_USER_5, _FEW_SHOT_AI_5),
    ]
    msgs: list[BaseMessage] = []
    for u, a in pairs:
        msgs.append(HumanMessage(content=u))
        msgs.append(AIMessage(content=a))
    return msgs


def build_messages(user_text: str, workspaces: list[dict]) -> list[BaseMessage]:
    """Construct the classification messages. ``workspaces`` is the
    list of cached workspace dicts (each with ``name`` field at minimum).
    The ``/`` separator reads cleanly + isn't inside any Chinese name."""
    if workspaces:
        ws_line = "工作区列表:" + " / ".join(w.get("name", "?") for w in workspaces)
    else:
        ws_line = "工作区列表:(空 — 用户没有任何工作区)"
    return [
        SystemMessage(content=_BASE_SYSTEM),
        *_few_shot_messages(),
        HumanMessage(content=f"{ws_line}\n\n用户输入:{user_text}"),
    ]
