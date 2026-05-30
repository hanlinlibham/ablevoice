"""Intent classification pipeline:

    1. ``looks_like_workspace_op(text)`` — cheap regex pre-filter.
       Returns False → caller skips LLM entirely (= CHAT, default 90% case).
    2. ``classify(text, workspaces)`` — full LLM call + JSON parse.
       Returns IntentResult with intent / workspace_match / new_name /
       confidence.

Pre-filter is conservative — only catches text that DEFINITELY mentions
a workspace operation. False negatives (missed switches) are tolerable
because the user can rephrase; false positives (asking LLM on plain
chat) just cost ~500ms.
"""

from __future__ import annotations

import json
import logging
import re
import time

from ..config import settings
from .enums import Intent, IntentResult
from .llm import run_classify
from .prompts import build_messages

logger = logging.getLogger("voice.intents.classify")


# Keywords that strongly suggest a workspace operation. If NONE of these
# appear in the user text, we skip LLM classification entirely.
_TRIGGER_PATTERN = re.compile(
    r"工作区|工作\s*区|workspace|"
    r"切到|切换|切入|切去|换到|换成|"
    r"新建|建一个|建个|创建|新做|"
    r"搬到|移到|移动到|归到|放到|挪到|"
    r"退出|回到|回归|默认|"
    r"列出|有什么|有哪些|有几个|看看我的|查看我的|"
    r"进入|进到|去到",
    re.IGNORECASE,
)


def looks_like_workspace_op(text: str) -> bool:
    """Cheap O(len) check — runs on every polished input before
    classify. Returns True if the text contains any trigger keyword."""
    if not text:
        return False
    return bool(_TRIGGER_PATTERN.search(text))


# ---------------------------------------------------------------------------

# JSON fence — qwen-flash sometimes wraps output in ```json``` despite
# instructions not to.
_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)


def _parse_classify_output(raw: str, fallback_text: str) -> IntentResult:
    """Forgiving JSON parse. Strips fences if present, defaults missing
    fields. Unparseable → CHAT (safe default — user just gets normal
    chat response)."""
    body = raw.strip()
    m = _FENCE_RE.search(body)
    if m:
        body = m.group(1)
    try:
        obj = json.loads(body)
    except json.JSONDecodeError:
        logger.warning("intent JSON parse failed; falling back to CHAT: %r", raw[:120])
        return IntentResult(intent=Intent.CHAT, raw_text=fallback_text, confidence=0.0)

    intent = Intent.parse(str(obj.get("intent", "chat")))
    return IntentResult(
        intent=intent,
        raw_text=fallback_text,
        confidence=float(obj.get("confidence") or 0.0),
        workspace_match=obj.get("workspace_match") or None,
        new_name=obj.get("new_name") or None,
    )


async def classify(text: str, workspaces: list[dict]) -> IntentResult:
    """Full classification: regex pre-filter → (maybe LLM) → parse.

    Returns IntentResult with timing populated. Caller can check
    ``.skipped_classify`` to see whether the LLM was called.
    """
    # INTENT_PROVIDER=off — never call an LLM. Everything is CHAT; the only
    # workspace routing left is whatever the meta-command layer catches
    # upstream. Keeps a pure-local preset from reaching for the cloud.
    if settings.intent.provider == "off":
        return IntentResult(
            intent=Intent.CHAT, raw_text=text,
            confidence=1.0, skipped_classify=True,
        )

    if settings.intent.pre_filter and not looks_like_workspace_op(text):
        return IntentResult(
            intent=Intent.CHAT, raw_text=text,
            confidence=1.0, skipped_classify=True,
        )

    t0 = time.monotonic()
    try:
        messages = build_messages(text, workspaces)
        raw = await run_classify(messages)
    except Exception as exc:
        logger.exception("intent classify failed; falling back to CHAT")
        return IntentResult(
            intent=Intent.CHAT, raw_text=text,
            confidence=0.0, error=f"classify failed: {exc}",
        )

    result = _parse_classify_output(raw, text)
    result.ms_classify = int((time.monotonic() - t0) * 1000)
    logger.info(
        "intent classify text=%r → intent=%s conf=%.2f match=%r new=%r ms=%d",
        text[:40], result.intent.value, result.confidence,
        result.workspace_match, result.new_name, result.ms_classify,
    )
    return result
