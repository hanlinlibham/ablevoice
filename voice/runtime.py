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


# --- Retry helper ----------------------------------------------------------
# Cloud backends (ablework, dashscope) occasionally return 502 / 504 /
# connection-reset when their upstream is restarting or a transient
# router blip happens. Without retry, every such blip kills a whole chat
# turn (the user sees a red error and has to retake). With one or two
# retries the same call usually succeeds within a few seconds.
#
# Retry policy:
#   - retry on: 5xx, 429 (rate-limit), httpx network errors, timeouts
#   - DO NOT retry on: 4xx auth/permission (would just fail again), our
#     own bad request, or anything that already streamed any output
#     (retrying would duplicate tokens user already saw).

import logging
from typing import Awaitable, Callable, TypeVar

logger = logging.getLogger("voice.runtime")

T = TypeVar("T")

# Default backoff: total budget ~ 0.5 + 1.0 + 2.0 = 3.5s across 3
# attempts (2 retries). Cloud 502s usually clear within 1-2s.
RETRY_ATTEMPTS = 3
RETRY_INITIAL_DELAY = 0.5
RETRY_FACTOR = 2.0


def is_retryable_error(exc: BaseException) -> bool:
    """True if the error is transient enough to retry. Conservative —
    when in doubt, return False so we don't mask programmer errors as
    network blips."""
    # httpx network-level — almost always worth one retry.
    try:
        if isinstance(exc, (
            httpx.ConnectError, httpx.ReadError, httpx.WriteError,
            httpx.ConnectTimeout, httpx.ReadTimeout, httpx.WriteTimeout,
            httpx.RemoteProtocolError, httpx.NetworkError, httpx.PoolTimeout,
        )):
            return True
    except AttributeError:
        # httpx version that doesn't have some of these — fall through.
        pass
    # Our providers wrap upstream HTTP errors as RuntimeError(
    # "ablework HTTP 502: ...") / similar. Parse the status code.
    if isinstance(exc, RuntimeError):
        msg = str(exc)
        for code in ("500", "502", "503", "504", "429"):
            if f"HTTP {code}" in msg:
                return True
    # Generic asyncio timeout (e.g. our DashscopeRealtimeAsr start
    # wait_for() timing out on a slow handshake).
    if isinstance(exc, asyncio.TimeoutError):
        return True
    return False


RetryNotify = Callable[[int, BaseException, float], None]


async def with_retries(
    factory: Callable[[], Awaitable[T]],
    *,
    attempts: int = RETRY_ATTEMPTS,
    initial_delay: float = RETRY_INITIAL_DELAY,
    factor: float = RETRY_FACTOR,
    on_retry: RetryNotify | None = None,
) -> T:
    """Call ``await factory()`` with exponential-backoff retries on
    transient errors. ``factory`` is a no-arg async callable so the
    caller can rebuild fresh httpx Clients / WS connections per
    attempt (state from a failed attempt is gone)."""
    delay = initial_delay
    for attempt in range(1, attempts + 1):
        try:
            return await factory()
        except BaseException as exc:
            if attempt >= attempts or not is_retryable_error(exc):
                raise
            if on_retry is not None:
                try:
                    on_retry(attempt, exc, delay)
                except Exception:
                    pass
            logger.warning(
                "retry attempt=%d/%d after %s: %.80s — waiting %.1fs",
                attempt, attempts, type(exc).__name__, str(exc), delay,
            )
            await asyncio.sleep(delay)
            delay *= factor
    # Unreachable — last attempt either returned or re-raised.
    raise RuntimeError("with_retries: control flow bug")
