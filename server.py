"""voice-asr-test — FastAPI entry. Wires the modules in ``voice/``.

This file used to be a 2280-line monolith doing model lifecycle, three
provider stacks, HTTP routes, WebSocket router, SQLite, and assorted
audio post-processing. Each of those lives in its own module now; this
file just builds the FastAPI app, mounts the routes, and runs warmup
during lifespan.

Run:
    ~/voice-asr-test/.venv/bin/uvicorn server:app --host 127.0.0.1 --port 8501

Models load lazily on first request. Set ``WARMUP=0`` to skip the
startup warmup that triggers them all up-front.
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from datetime import datetime, timezone

from voice import db
from voice.config import settings
from voice.http import router as http_router
from voice.providers.asr import ensure_mlx_session
from voice.providers.llm import ensure_mlx_llm
from voice.providers.tts import (
    ensure_mlx_tts,
    ensure_mlx_tts_ref,
    mlx_tts_variant,
)
from voice.runtime import close_http, mlx_call
from voice.chat import synth_one
from voice.ws import websocket_voice

logger = logging.getLogger("voice_asr_server")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

db.ensure_layout()


async def _warmup() -> None:
    """Load all selected provider models and run a tiny dummy inference
    so the first real voice turn doesn't pay graph-compilation cost.
    Skipped when WARMUP=0."""
    if not settings.warmup:
        logger.info("warmup skipped (WARMUP=0)")
        return
    t0 = time.monotonic()
    logger.info("warmup: loading models + running dummy inference…")
    try:
        # ASR — skip MLX load entirely when running cloud ASR (saves
        # ~5GB RAM for 1.7B). Cloud ASR has no local warmup.
        if settings.asr.provider == "mlx":
            fixture = settings.storage.data_dir / "tests" / "fixtures" / "test_zh.wav"
            if fixture.exists():
                session = await mlx_call(ensure_mlx_session)
                await mlx_call(session.transcribe, str(fixture))
            else:
                await mlx_call(ensure_mlx_session)
        # TTS warmup. Skip MLX-model load entirely when running cloud TTS.
        if settings.tts.provider == "mlx":
            await mlx_call(ensure_mlx_tts)
            if mlx_tts_variant() == "base":
                await mlx_call(ensure_mlx_tts_ref)
            # Trigger one synth so the graph is compiled.
            await synth_one("你好世界")
        else:
            # Cloud TTS warmup: just round-trip once so the connection
            # pool is hot. Doesn't load anything locally.
            await synth_one("你好世界")
        if settings.llm.provider == "mlx":
            await mlx_call(ensure_mlx_llm)
        logger.info("warmup done in %.1fs (models hot, first turn should be fast)",
                    time.monotonic() - t0)
    except Exception:  # noqa: BLE001
        logger.exception("warmup failed (server still up, first call will be slow)")


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # Crash-recovery: any draft still ``in_progress`` belongs to a
    # previous run that died before stop_recording. Flip them so the
    # /drafts endpoint can surface them.
    n = db.mark_orphans_interrupted(
        datetime.now(timezone.utc).isoformat(timespec="seconds")
    )
    if n:
        logger.info("recovered %d orphaned draft recording(s) → status=interrupted", n)
    # Warm models in the background so health/ws endpoints come up
    # immediately. ``mlx_call`` serialises against any incoming /tts or
    # /chat anyway, so racing is fine.
    asyncio.create_task(_warmup())
    try:
        yield
    finally:
        await close_http()


app = FastAPI(title="voice-asr-test", lifespan=_lifespan)

# Permissive CORS — server listens on 127.0.0.1 only. Vite dev server
# lives on a different port (5173), so CORS must be on for the UI to
# call us at all.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["POST", "GET", "OPTIONS", "DELETE"],
    allow_headers=["*"],
)

app.include_router(http_router)


@app.websocket("/ws")
async def ws_route(ws: WebSocket) -> None:
    await websocket_voice(ws)
