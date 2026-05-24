"""Rule-based input classifier. Pure function — no LLM, no I/O.

Sub-second classification (regex matches on short strings) so the graph's
first decision (``should_polish?``) doesn't pay any model overhead. If
input is too short or already looks clean, the graph short-circuits and
returns the raw text unmodified.

We considered a tiny LLM classifier for register/domain detection but
postponed — see ``prompts.py`` extension points for when that becomes
v2 work.
"""

from __future__ import annotations

import re

from .state import Classification

# 中文 + 英文常见 ASR 口语 filler。这些是"polish 必须删"的强信号。
_FILLERS = (
    "呃", "嗯", "啊", "唉",
    "那个", "这个", "就是说", "就是",
    "然后呢", "然后", "其实", "你知道",
    "对吧", "对吗",
    "um", "uh", "you know", "like ",
)

_END_PUNCT = ("。", "?", "!", ".", "?", "!", "…", ":", ":")

_ENTITY_HINT = re.compile(
    # 简单启发式 — 不做 NER。"X集团/X公司/X 银行" 这类 + 全大写英文 token
    # + 多于一个汉字的连续 capital-like 词。够用于 v1 dispatch,不用于
    # 实体保留(那是 prompt 层做的)。
    r"[一-鿿]{2,}(?:集团|公司|银行|证券|科技|股份|控股|实业)"
    r"|[A-Z][A-Z0-9]{2,}"
)

_QUESTION_MARKERS = ("吗", "呢", "?", "?", "几", "多少", "怎么", "如何", "是不是", "什么")


def classify(text: str) -> Classification:
    """Inspect ``text`` and return classifier hints. Cost: O(len(text)),
    no LLM, runs synchronously."""
    s = text.strip()
    length = len(s)

    has_numbers = bool(re.search(r"\d", s))
    has_entities = bool(_ENTITY_HINT.search(s))
    is_question = (
        s.endswith(("?", "?"))
        or any(m in s for m in _QUESTION_MARKERS)
    )

    has_filler = any(f in s for f in _FILLERS)
    has_end_punct = s.endswith(_END_PUNCT)
    # "Too short" — under 8 chars often a single command word that polish
    # would mangle. Skip.
    is_too_short = length < 8
    # "Too clean" — no口语 fillers + proper punctuation. Probably already
    # written-style; sending to LLM risks over-rewriting it.
    is_too_clean = (not has_filler) and has_end_punct and length < 80

    return Classification(
        length=length,
        has_numbers=has_numbers,
        has_entities=has_entities,
        is_question=is_question,
        is_too_short=is_too_short,
        is_too_clean=is_too_clean,
    )
