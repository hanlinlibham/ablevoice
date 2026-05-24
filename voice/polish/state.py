"""Polish agent state — what flows between LangGraph nodes.

Designed as a TypedDict because LangGraph natively supports it and
TypedDict updates merge cleanly (return ``{"key": value}`` from a node
and only that key is overwritten).
"""

from __future__ import annotations

from typing import Optional, TypedDict


class Classification(TypedDict, total=False):
    """Rule-based classifier output. ``total=False`` so future fields
    (domain, register, ...) can be added without breaking older callers."""
    length: int
    has_numbers: bool
    has_entities: bool
    is_question: bool
    is_too_short: bool
    is_too_clean: bool


class Validation(TypedDict):
    ok: bool
    errors: list[str]


class PolishState(TypedDict, total=False):
    """Graph state. Required key on entry: ``raw``."""
    raw: str
    classification: Classification
    should_polish: bool
    polished: str               # LLM output of latest attempt
    validation: Validation
    attempts: int               # incremented by polish_node
    final: str                  # filled by finalize_node
    error: str                  # set on hard failure (LLM raised)
