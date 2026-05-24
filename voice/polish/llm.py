"""LLM runner for the polish node.

Why a dedicated runner instead of reusing chat's provider abstraction:
the polish step has different requirements than chat — it's one-shot
(no streaming UI), short output, no conversation history, and uses a
different provider env (POLISH_PROVIDER) so you can run a small local
model for polish while chat hits ablework.

We accept ``list[BaseMessage]`` so the prompt module owns message
construction (system/user/assistant roles) cleanly, and adapt to each
provider's dict shape inside the runner.
"""

from __future__ import annotations

import json
import logging

import httpx
from langchain_core.messages import BaseMessage

from ..config import settings
from ..runtime import mlx_call

logger = logging.getLogger("voice.polish.llm")


# Map LangChain message types to OpenAI-style role strings.
_ROLE_MAP = {"system": "system", "human": "user", "ai": "assistant"}


def _to_dicts(messages: list[BaseMessage]) -> list[dict]:
    return [
        {"role": _ROLE_MAP.get(m.type, m.type), "content": m.content}
        for m in messages
    ]


async def run_polish(messages: list[BaseMessage]) -> str:
    """Dispatch to the configured polish backend. Returns the text
    content of the assistant reply (full, non-streaming)."""
    provider = settings.polish.provider
    if provider == "off":
        # Shouldn't be called when off (graph short-circuits earlier),
        # but be defensive.
        raise RuntimeError("polish provider=off — run_polish should not be invoked")
    if provider == "mlx":
        return await _run_mlx(messages)
    if provider == "dashscope":
        return await _run_dashscope(messages)
    raise RuntimeError(f"unknown POLISH_PROVIDER: {provider!r}")


# --- MLX path ---------------------------------------------------------------

def _run_mlx_sync(messages: list[BaseMessage]) -> str:
    """Synchronous mlx-lm generate. Runs on the MLX worker thread."""
    from mlx_lm import generate  # noqa: PLC0415 — heavy import lazily

    from ..providers.llm import ensure_mlx_llm  # local import to avoid cycle

    model, tokenizer = ensure_mlx_llm()
    prompt = tokenizer.apply_chat_template(
        _to_dicts(messages), tokenize=False, add_generation_prompt=True,
    )
    out = generate(
        model, tokenizer, prompt=prompt,
        max_tokens=settings.polish.max_tokens,
        verbose=False,
    )
    return (out or "").strip()


async def _run_mlx(messages: list[BaseMessage]) -> str:
    return await mlx_call(_run_mlx_sync, messages)


# --- DashScope path ---------------------------------------------------------

async def _run_dashscope(messages: list[BaseMessage]) -> str:
    if not settings.dashscope.api_key:
        raise RuntimeError(
            "POLISH_PROVIDER=dashscope but DASHSCOPE_API_KEY not set"
        )
    headers = {
        "Authorization": f"Bearer {settings.dashscope.api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": settings.dashscope.polish_model,
        "messages": _to_dicts(messages),
        "stream": False,
        "max_tokens": settings.polish.max_tokens,
        # Polish is deterministic-ish — low temperature so repeated runs
        # of the same input produce the same output (helps caching +
        # debug).
        "temperature": settings.polish.temperature,
        "enable_thinking": False,
    }
    async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
        r = await client.post(
            f"{settings.dashscope.base_url}/chat/completions",
            headers=headers, json=body,
        )
        if r.status_code != 200:
            raise RuntimeError(
                f"polish dashscope HTTP {r.status_code}: {r.text[:200]}"
            )
        data = r.json()
    try:
        return (data["choices"][0]["message"]["content"] or "").strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"polish dashscope bad response: {json.dumps(data)[:200]}") from exc
