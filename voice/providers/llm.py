"""LLM provider implementations — one class per backend, all yielding
content deltas through the same ``stream(messages, session_id)`` async
generator surface. Markdown is stripped here (for TTS hygiene) only for
providers that emit raw markdown — ablework does, the others tend to
follow our system prompt and stay clean.

mlx
===
mlx-lm's ``stream_generate`` is a sync generator; we drive it one
``next()`` at a time on the dedicated MLX worker so concurrent TTS calls
can slip into the executor queue between tokens. Caller cancellation
(``async for`` exit) close()s the underlying generator so the GPU stops
decoding tokens nobody will hear.

dashscope
=========
OpenAI-compat ``/chat/completions`` SSE. Same shape as ollama, just
different URL + auth header. ``enable_thinking=false`` is the magic
needed to keep qwen3.7-max from burning seconds in reasoning_content
before the first user-visible token.

ablework
========
AI SDK v6 UIMessage SSE — 70 sidecar event types of which we only care
about ``text-delta``. Conversation id stays stable per session_id so
multi-turn state on the backend doesn't reset between turns.

ollama
======
``/api/chat`` JSON-lines. ``think: false`` to silence reasoning models'
``<reasoning_content>`` prelude.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import AsyncIterator

import httpx

from ..audio import strip_markdown_inline
from ..config import settings
from ..runtime import mlx_call

logger = logging.getLogger("voice.providers.llm")


# --- MLX (in-process) -------------------------------------------------------

_mlx_llm = None  # (model, tokenizer) tuple once loaded


def ensure_mlx_llm():
    """Lazy-load mlx-lm. Same pattern as the ASR/TTS sessions —
    first chat call pays load + (one-time) download, subsequent calls
    hit the warm model."""
    global _mlx_llm
    if _mlx_llm is None:
        from mlx_lm import load  # noqa: PLC0415 — heavy import
        t0 = time.monotonic()
        logger.info("loading MLX LLM: %s", settings.llm.mlx_model)
        _mlx_llm = load(settings.llm.mlx_model)
        logger.info("MLX LLM ready in %.2fs", time.monotonic() - t0)
    return _mlx_llm


def mlx_llm_loaded() -> bool:
    return _mlx_llm is not None


class MlxLlm:
    @property
    def model_id(self) -> str:
        return settings.llm.mlx_model

    async def stream(
        self, messages: list[dict], session_id: str
    ) -> AsyncIterator[str]:
        from mlx_lm import stream_generate  # noqa: PLC0415 — heavy

        llm_model, tokenizer = await mlx_call(ensure_mlx_llm)
        prompt = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        # Generator lives in a dict so both the init closure and the
        # step closure can see it (and we can close it from finally).
        state: dict = {"gen": None}

        def _init():
            state["gen"] = stream_generate(
                llm_model, tokenizer, prompt, max_tokens=settings.llm.mlx_max_tokens,
            )

        await mlx_call(_init)
        try:
            while True:
                def _step():
                    try:
                        return next(state["gen"])
                    except StopIteration:
                        return None
                tok = await mlx_call(_step)
                if tok is None:
                    break
                delta = getattr(tok, "text", "") or ""
                if delta:
                    yield delta
        finally:
            gen = state.get("gen")
            if gen is not None:
                try:
                    gen.close()
                except Exception:
                    pass


# --- DashScope (OpenAI-compat) ----------------------------------------------

class DashscopeLlm:
    @property
    def model_id(self) -> str:
        return settings.llm.ds_model

    async def stream(
        self, messages: list[dict], session_id: str
    ) -> AsyncIterator[str]:
        if not settings.llm.ds_api_key:
            raise RuntimeError(
                "DASHSCOPE_API_KEY not set — `export DASHSCOPE_API_KEY=sk-...` "
                "before starting the server, or switch LLM_PROVIDER back to mlx."
            )
        headers = {
            "Authorization": f"Bearer {settings.llm.ds_api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": settings.llm.ds_model,
            "messages": messages,
            "stream": True,
            "max_tokens": 1024,
            "enable_thinking": settings.llm.ds_thinking,
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST", f"{settings.llm.ds_base_url}/chat/completions",
                headers=headers, json=body,
            ) as r:
                if r.status_code != 200:
                    detail = (await r.aread())[:300].decode("utf-8", "replace")
                    raise RuntimeError(f"dashscope HTTP {r.status_code}: {detail}")
                async for line in r.aiter_lines():
                    line = line.strip()
                    if not line or not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        event = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    choices = event.get("choices") or []
                    if not choices:
                        continue
                    delta = (choices[0].get("delta") or {}).get("content") or ""
                    if delta:
                        yield delta


# --- Ablework (AI SDK v6 UIMessage SSE) -------------------------------------

# Stable conversation UUID per session_id — keeps backend conversation
# state coherent across turns instead of starting fresh each turn.
_ablework_conv_ids: dict[str, str] = {}


def reset_ablework_session(session_id: str) -> None:
    _ablework_conv_ids.pop(session_id, None)


class AbleworkLlm:
    @property
    def model_id(self) -> str:
        return "ablework"

    async def stream(
        self, messages: list[dict], session_id: str
    ) -> AsyncIterator[str]:
        if not settings.llm.ablework_token:
            raise RuntimeError(
                "ABLEWORK_TOKEN (or TOKEN) not set — put it in .env.local or "
                "export TOKEN=eyJ... before starting the server."
            )
        # Drop system messages — ablework has its own preset-driven
        # system prompt and only wants user/assistant alternation.
        clean_msgs = [m for m in messages if m.get("role") in ("user", "assistant")]
        conv_id = _ablework_conv_ids.setdefault(session_id, uuid.uuid4().hex)
        body = {
            "messages": clean_msgs,
            "id": conv_id,
            "preset_id": None,
            "controller_mode": "on",
        }
        headers = {
            "Authorization": f"Bearer {settings.llm.ablework_token}",
            "Content-Type": "application/json",
        }
        # Cert verify off by default — see config.py comment.
        async with httpx.AsyncClient(
            timeout=60.0, verify=settings.llm.ablework_verify_ssl,
        ) as client:
            async with client.stream(
                "POST", settings.llm.ablework_url, headers=headers, json=body,
            ) as r:
                if r.status_code != 200:
                    detail = (await r.aread())[:300].decode("utf-8", "replace")
                    raise RuntimeError(f"ablework HTTP {r.status_code}: {detail}")
                async for line in r.aiter_lines():
                    line = line.strip()
                    if not line or not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        event = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    t = event.get("type")
                    if t == "text-delta":
                        delta = event.get("delta") or ""
                        # Strip markdown so TTS doesn't read out ``*``,
                        # ``|`` etc. ablework backend emits raw markdown
                        # (the others tend to follow our system prompt
                        # and stay clean, so we don't strip them).
                        delta = strip_markdown_inline(delta)
                        if delta:
                            yield delta
                    elif t == "finish":
                        break
                    # Everything else (data-event, reasoning-*, data-usage,
                    # tool-input-*, etc.) silently dropped.


# --- Ollama -----------------------------------------------------------------

class OllamaLlm:
    @property
    def model_id(self) -> str:
        return settings.llm.ollama_model

    async def stream(
        self, messages: list[dict], session_id: str
    ) -> AsyncIterator[str]:
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST",
                f"{settings.llm.ollama_url}/api/chat",
                json={
                    "model": settings.llm.ollama_model,
                    "messages": messages,
                    "stream": True,
                    "think": settings.llm.ollama_think,
                },
            ) as r:
                if r.status_code != 200:
                    body = await r.aread()
                    raise RuntimeError(
                        f"ollama HTTP {r.status_code}: {body[:200].decode('utf-8','replace')}"
                    )
                async for line in r.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    msg = event.get("message", {}) or {}
                    delta = msg.get("content", "") or ""
                    if delta:
                        yield delta
                    if event.get("done"):
                        break
