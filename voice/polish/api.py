"""Public surface for the polish module — one entry point + a result
dataclass that's easy to log + persist.

Callers (chat pipeline, WS handler) only import this — everything else
in ``voice.polish.*`` is an implementation detail.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from ..config import settings
from .graph import get_graph

logger = logging.getLogger("voice.polish")


@dataclass(frozen=True)
class PolishResult:
    """Result of one polish run.

    ``final`` — the text downstream should use (= polished if ok, else raw)
    ``raw`` — the original ASR text
    ``polished`` — what the LLM produced (may differ from final if validate failed)
    ``skipped`` — True when classify decided not to polish (too short/clean)
    ``attempts`` — how many LLM calls (0 if skipped, 1-2 otherwise)
    ``ok`` — True iff polish succeeded and validate passed
    ``errors`` — validator error codes (empty if ok)
    ``ms`` — wall clock of the whole graph run
    """
    final: str
    raw: str
    polished: str
    skipped: bool
    attempts: int
    ok: bool
    errors: list[str]
    ms: int


async def polish_text(raw: str) -> PolishResult:
    """Run the polish agent on ``raw`` text. Never raises — on any
    failure the result has ``final == raw`` so callers can use it
    unconditionally.

    When ``POLISH_ENABLED=0`` returns a passthrough result immediately
    (no graph run) — the public surface stays uniform so call sites
    don't need to branch.
    """
    if not settings.polish.enabled or not raw.strip():
        return PolishResult(
            final=raw, raw=raw, polished="", skipped=True,
            attempts=0, ok=True, errors=[], ms=0,
        )

    t0 = time.monotonic()
    graph = get_graph()
    try:
        state = await graph.ainvoke({"raw": raw})
    except Exception as exc:  # noqa: BLE001 — diagnostic boundary
        logger.exception("polish graph crashed, falling back to raw")
        return PolishResult(
            final=raw, raw=raw, polished="", skipped=False,
            attempts=0, ok=False, errors=[f"graph_crash:{type(exc).__name__}"],
            ms=int((time.monotonic() - t0) * 1000),
        )

    ms = int((time.monotonic() - t0) * 1000)
    skipped = not state.get("should_polish", False)
    validation = state.get("validation") or {"ok": False, "errors": []}
    polished = state.get("polished") or ""
    final = state.get("final", raw)
    errors = list(validation.get("errors", []))
    if state.get("error"):
        errors.append(state["error"])

    # ``ok`` semantics: skipped is success (we deliberately chose not
    # to polish); otherwise require validate pass + no hard error.
    if skipped:
        ok = True
    else:
        ok = validation.get("ok", False) and not state.get("error")

    result = PolishResult(
        final=final,
        raw=raw,
        polished=polished,
        skipped=skipped,
        attempts=state.get("attempts", 0),
        ok=ok,
        errors=errors,
        ms=ms,
    )
    logger.info(
        "polish raw=%r → final=%r skipped=%s attempts=%d ok=%s ms=%d",
        raw[:40], final[:40], skipped, result.attempts, result.ok, ms,
    )
    return result
