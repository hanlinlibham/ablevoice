"""Single public entry: ``process_intent(text, session) → IntentResult``.

Combines classify + handle in one call. Caller (ws.py) just checks
``.handled`` to decide whether to skip the chat pipeline."""

from __future__ import annotations

import logging

from ..config import settings
from .classify import classify
from .enums import Intent, IntentResult
from .handlers import SessionCtx, handle

logger = logging.getLogger("voice.intents.api")


async def process_intent(text: str, session: SessionCtx) -> IntentResult:
    """Run the full pipeline on ``text``. Returns the result with
    ``handled`` set:
      - True  → caller should ack via ack_text, skip chat
      - False → fall through to normal chat pipeline (intent was
        ``chat`` or below confidence threshold)
    """
    if not settings.intent.enabled or not text.strip():
        return IntentResult(intent=Intent.CHAT, raw_text=text, handled=False,
                            skipped_classify=True)

    result = await classify(text, session.cache.workspaces)

    # Confidence gate — borderline classifications fall through to chat
    # so a false positive doesn't silently swallow a user's question.
    if (
        result.intent != Intent.CHAT
        and result.confidence < settings.intent.min_confidence
    ):
        logger.info(
            "intent %s below threshold (conf=%.2f < %.2f) — treating as CHAT",
            result.intent.value, result.confidence, settings.intent.min_confidence,
        )
        result.intent = Intent.CHAT
        result.handled = False
        return result

    return await handle(result, session)
