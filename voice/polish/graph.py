"""LangGraph StateGraph for the polish agent.

Topology:

       ┌─────────┐
       │classify │
       └────┬────┘
            │
    ┌───────┴────────┐
    │ should_polish? │
    └─┬───────────┬──┘
   yes│         no│
      ▼           ▼
   ┌───────┐   ┌──────────┐
   │polish │   │ finalize │ ← returns raw
   └───┬───┘   └────┬─────┘
       ▼            │
   ┌────────┐       │
   │validate│       │
   └──┬───┬─┘       │
   ok │   │fail+retry?
      │   │
      │   └──→ polish (max 2 attempts)
      ▼
   ┌──────────┐
   │ finalize │ ← returns polished (or raw on hard fail)
   └────┬─────┘
        ▼
       END

We compile once at import time so the per-request cost is just a
state-dict roundtrip + the LLM call inside polish_node.
"""

from __future__ import annotations

import logging
from typing import Any

from langgraph.graph import END, StateGraph

from ..config import settings
from .classify import classify
from .llm import run_polish
from .prompts import build_messages, build_retry_messages
from .state import PolishState
from .validators import validate

logger = logging.getLogger("voice.polish.graph")


# --- Nodes -----------------------------------------------------------------

async def classify_node(state: PolishState) -> dict[str, Any]:
    cls = classify(state["raw"])
    should = not (cls["is_too_short"] or cls["is_too_clean"])
    return {"classification": cls, "should_polish": should, "attempts": 0}


async def polish_node(state: PolishState) -> dict[str, Any]:
    attempts = state.get("attempts", 0)
    cls = state["classification"]
    if attempts == 0:
        messages = build_messages(state["raw"], cls)
    else:
        # Retry — include validator feedback.
        prev = state.get("polished", "")
        errs = state.get("validation", {}).get("errors", [])
        messages = build_retry_messages(state["raw"], cls, prev, errs)
    try:
        out = await run_polish(messages)
    except Exception as exc:  # noqa: BLE001
        logger.exception("polish LLM call failed (attempt %d)", attempts + 1)
        return {"error": f"{type(exc).__name__}: {exc}", "attempts": attempts + 1}
    return {"polished": out, "attempts": attempts + 1}


async def validate_node(state: PolishState) -> dict[str, Any]:
    if state.get("error"):
        return {}  # let routing handle the failure
    v = validate(state["raw"], state.get("polished", ""))
    return {"validation": v}


async def finalize_node(state: PolishState) -> dict[str, Any]:
    # Resolution order:
    #   1. should_polish == False → return raw
    #   2. validate ok → return polished
    #   3. attempted but never validated → return raw (safe fallback)
    if not state.get("should_polish"):
        return {"final": state["raw"]}
    if state.get("validation", {}).get("ok"):
        return {"final": state.get("polished", state["raw"])}
    return {"final": state["raw"]}


# --- Edges -----------------------------------------------------------------

def _route_after_classify(state: PolishState) -> str:
    return "polish" if state.get("should_polish") else "finalize"


def _route_after_validate(state: PolishState) -> str:
    # Hard LLM failure — give up immediately.
    if state.get("error"):
        return "finalize"
    if state.get("validation", {}).get("ok"):
        return "finalize"
    # Validate failed — retry once (attempts goes 1 → 2).
    if state.get("attempts", 0) < settings.polish.max_attempts:
        return "polish"
    return "finalize"


def _build() -> Any:
    g = StateGraph(PolishState)
    g.add_node("classify", classify_node)
    g.add_node("polish", polish_node)
    g.add_node("validate", validate_node)
    g.add_node("finalize", finalize_node)

    g.set_entry_point("classify")
    g.add_conditional_edges(
        "classify", _route_after_classify,
        {"polish": "polish", "finalize": "finalize"},
    )
    g.add_edge("polish", "validate")
    g.add_conditional_edges(
        "validate", _route_after_validate,
        {"polish": "polish", "finalize": "finalize"},
    )
    g.add_edge("finalize", END)

    return g.compile()


_compiled = None


def get_graph():
    """Lazy-compile the graph on first call so module import (and unit
    tests that don't run polish) stay cheap."""
    global _compiled
    if _compiled is None:
        _compiled = _build()
    return _compiled
