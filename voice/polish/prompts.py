"""Prompt construction for the polish step.

V1 is intentionally minimal — one base system prompt + the raw text +
(optional) a regenerate-with-feedback message on retry. The build
function takes ``Classification`` so v2 can add conditional sections
(数字保留 / 实体保留 / 领域 vocab / 会话上下文) by extending
``_dynamic_sections()`` without touching the graph.

Why no ChatPromptTemplate
=========================
LangChain's ChatPromptTemplate adds template-variable plumbing we don't
need (one raw string, no slots beyond ``{raw}``). Plain f-string
keeps the prompt readable + diff-able when iterating.
"""

from __future__ import annotations

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from .state import Classification

# Strict, no-preamble instruction — the OpenLess pattern. The two
# numbered rule blocks (transform vs preserve) split the model's
# attention between "what to change" and "what to keep verbatim",
# which empirically reduces over-rewriting on already-clean input.
_BASE_SYSTEM = """\
你是 ASR 转写文本的整理助手。任务:把口语化的转写整理成准确的书面表达。

要做:
1. 删除口语助词("呃"、"嗯"、"啊"、"那个"、"就是" 等)
2. 修正 ASR 错字、错断句、缺漏标点
3. 把支离破碎的口语整成通顺的句子

不能做:
1. 不要改变原意、不要增加新信息、不要重组段落结构
2. 不要解释、不要加前缀("好的"、"整理后:" 等)
3. 数字、人名、公司名、专有名词必须原样保留
4. 如果原文已经通顺,原样输出

只输出整理后的文本。"""


def _dynamic_sections(cls: Classification) -> list[str]:
    """V1 stub. Returns extra system-prompt sections based on classifier
    hints. Currently empty — v2 will populate (digit preservation /
    entity preservation / domain vocab / session context)."""
    return []


def build_messages(raw: str, cls: Classification) -> list[BaseMessage]:
    """Initial attempt — system + user only."""
    system_parts = [_BASE_SYSTEM, *_dynamic_sections(cls)]
    system = "\n\n".join(system_parts)
    return [
        SystemMessage(content=system),
        HumanMessage(content=f"原文:{raw}\n\n输出:"),
    ]


def build_retry_messages(
    raw: str, cls: Classification, prev_output: str, errors: list[str],
) -> list[BaseMessage]:
    """Retry attempt — include the previous failed output + validator
    feedback as a corrective turn. The model sees its own mistake and
    a one-line reason, which empirically lands fix-on-second-try better
    than just re-prompting with a stronger instruction."""
    feedback = _format_errors(errors)
    return [
        *build_messages(raw, cls),
        AIMessage(content=prev_output),
        HumanMessage(content=(
            f"上面的输出不符合要求:{feedback}。请重新整理,严格遵守规则,"
            f"只输出整理后的文本,不要前缀或解释。\n\n原文:{raw}\n\n输出:"
        )),
    ]


# Short human-readable explanations of validator error codes — kept
# adjacent to prompts because the model needs to understand the
# feedback string, not the raw error code.
_ERROR_EXPLAIN = {
    "empty_output":      "输出为空",
    "has_preamble":      "包含了前缀(如'好的'、'整理后:')",
    "too_long":          "输出过长,似乎增加了原文没有的内容",
    "too_short":         "输出过短,似乎删掉了原文的内容",
}


def _format_errors(errors: list[str]) -> str:
    parts = []
    for e in errors:
        if e.startswith("lost_digit:"):
            digit = e.split(":", 1)[1]
            parts.append(f"丢失了原文中的数字 {digit!r}")
        else:
            parts.append(_ERROR_EXPLAIN.get(e, e))
    return ";".join(parts)
