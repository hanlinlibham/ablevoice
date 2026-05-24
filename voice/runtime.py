"""Runtime singletons: single-thread MLX executor + shared httpx client.

MLX worker
==========
All MLX work (ASR + TTS + LLM) MUST run on a single OS thread. MLX
maintains per-thread GPU streams; when an MLX model is loaded on thread
A and then ``asyncio.to_thread`` ships its inference to thread B, you
get ``RuntimeError: There is no Stream(gpu, N) in current thread``.

The default asyncio thread pool spreads work across multiple threads,
which used to be "fine" because we only had mlx-qwen3-asr + mlx-audio
(and mlx-audio happened to tolerate it). Once we add mlx-lm the
stream-mismatch starts crashing TTS calls. Easiest robust fix:
one dedicated single-worker executor for everything MLX, so the entire
voice loop runs on a consistent stream context.

Trade-off: GPU work is now strictly serialized (LLM token N must yield
before TTS chunk K can start). MLX serializes GPU compute anyway on
Apple Silicon, so the wall-clock cost is small in practice.

Shared httpx
============
Cloud providers (DashScope ASR/TTS, ablework chat, Ollama) all reuse one
``httpx.AsyncClient``. Per-call clients were thrown away after each
request, redoing TCP+TLS each time; pooling cuts ~50-100ms off chunked
TTS calls and keeps connections to ablework warm. The corporate proxy
MITMs HTTPS so verify is off by default — flip via env if your CA is
trusted system-wide.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
from typing import Optional

import httpx

_mlx_executor = concurrent.futures.ThreadPoolExecutor(
    max_workers=1, thread_name_prefix="mlx-worker"
)


async def mlx_call(fn, /, *args, **kwargs):
    """Run a sync MLX-using function on the dedicated MLX worker thread.

    Drop-in replacement for ``asyncio.to_thread`` when the callable
    touches any MLX model (load, transcribe, synthesize, stream_generate).
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_mlx_executor, lambda: fn(*args, **kwargs))


# Shared httpx clients — created on first use (lazy so import order
# stays simple) and closed by the FastAPI lifespan shutdown hook.
_http_verify: Optional[httpx.AsyncClient] = None
_http_no_verify: Optional[httpx.AsyncClient] = None


def http(verify: bool = True) -> httpx.AsyncClient:
    """Return the long-lived AsyncClient. Two flavours — verify on/off —
    because the corporate proxy MITMs upstream HTTPS without a system
    trust-store entry. Callers that talk to ablework / dashscope cloud
    typically need ``verify=False``; localhost paths (ollama) keep
    verify on.
    """
    global _http_verify, _http_no_verify
    if verify:
        if _http_verify is None:
            _http_verify = httpx.AsyncClient(timeout=60.0, verify=True)
        return _http_verify
    if _http_no_verify is None:
        _http_no_verify = httpx.AsyncClient(timeout=60.0, verify=False)
    return _http_no_verify


async def close_http() -> None:
    """Close shared clients. Called from the FastAPI lifespan shutdown."""
    global _http_verify, _http_no_verify
    for c in (_http_verify, _http_no_verify):
        if c is not None:
            try:
                await c.aclose()
            except Exception:
                pass
    _http_verify = None
    _http_no_verify = None
