"""LLM runner for intent classification.

Calls qwen-flash (or whatever ``INTENT_DASHSCOPE_MODEL`` is) via
DashScope's OpenAI-compat endpoint. Returns raw text — parsing happens
in ``classify.py``. Failures bubble up so the caller can decide to
fall back to ``chat``.

Why not reuse ``voice/polish/llm.py``: polish has its own ``MAX_TOKENS``
+ retry semantics tuned for polish. Intent classification has different
needs:
  - smaller max_tokens (we want ~80 chars of JSON)
  - lower temperature (0.0 — deterministic classification)
  - tighter timeout (don't block chat for >2s on a slow classify)
"""

from __future__ import annotations

import json
import logging

import httpx
from langchain_core.messages import BaseMessage

from ..config import settings
from ..runtime import with_retries

logger = logging.getLogger("voice.intents.llm")


_ROLE_MAP = {"system": "system", "human": "user", "ai": "assistant"}


def _to_dicts(messages: list[BaseMessage]) -> list[dict]:
    return [
        {"role": _ROLE_MAP.get(m.type, m.type), "content": m.content}
        for m in messages
    ]


async def run_classify(messages: list[BaseMessage]) -> str:
    """Single-shot LLM call for classification. Returns the assistant
    content (typically a JSON blob). Dispatches on ``INTENT_PROVIDER``.

    ``off`` never reaches here — ``classify.classify`` short-circuits it
    to CHAT before any LLM call.
    """
    provider = settings.intent.provider
    if provider == "mlx":
        return await _run_classify_mlx(messages)
    if provider == "dashscope":
        return await _run_classify_dashscope(messages)
    raise RuntimeError(
        f"run_classify reached with unsupported INTENT_PROVIDER={provider!r}"
    )


async def _run_classify_mlx(messages: list[BaseMessage]) -> str:
    """Route the classify prompt through the local MLX chat LLM so a
    pure-local preset stays offline. One-shot: drain the token stream and
    return the joined text for ``classify.py`` to parse."""
    from ..providers.llm import MlxLlm  # noqa: PLC0415 — heavy mlx import

    llm = MlxLlm()
    chunks: list[str] = []
    async for delta in llm.stream(_to_dicts(messages), session_id="intent-classify"):
        chunks.append(delta)
    return "".join(chunks).strip()


async def _run_classify_dashscope(messages: list[BaseMessage]) -> str:
    if not settings.dashscope.api_key:
        raise RuntimeError(
            "INTENT_PROVIDER=dashscope but DASHSCOPE_API_KEY not set"
        )

    body = {
        "model": settings.intent.ds_model,
        "messages": _to_dicts(messages),
        "stream": False,
        "max_tokens": 128,
        "temperature": 0.0,
        "enable_thinking": False,
    }
    headers = {
        "Authorization": f"Bearer {settings.dashscope.api_key}",
        "Content-Type": "application/json",
    }

    async def _call() -> str:
        async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
            r = await client.post(
                f"{settings.dashscope.base_url}/chat/completions",
                headers=headers, json=body,
            )
            if r.status_code != 200:
                raise RuntimeError(
                    f"intent classify HTTP {r.status_code}: {r.text[:200]}"
                )
            data = r.json()
        try:
            return (data["choices"][0]["message"]["content"] or "").strip()
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError(
                f"intent classify bad response: {json.dumps(data)[:200]}"
            ) from exc

    return await with_retries(_call)
