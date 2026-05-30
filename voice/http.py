"""REST endpoints: /health /transcribe /tts /history /chat (+ subroutes).

All the heavy lifting is in ``chat`` / ``providers``; this file is just
the FastAPI shape (request/response models, exception mapping, SSE
adapter for /chat).
"""

from __future__ import annotations

import asyncio
import json
import logging
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from . import chat, db
from .audio import pcm_float_to_wav_bytes
from .config import public_view, settings
from .providers import get_tts
from .providers.asr import ensure_mlx_session, mlx_session_loaded
from .providers.llm import mlx_llm_loaded
from .providers.tts import mlx_tts_loaded, mlx_tts_variant, mlx_tts_voices
from .runtime import mlx_call

logger = logging.getLogger("voice.http")
router = APIRouter()


# --- Pydantic models -------------------------------------------------------

class TranscribeResponse(BaseModel):
    id: str
    created_at: str
    text: str
    ms: int
    audio_bytes: int
    peak_level: Optional[float] = None
    model: str


class HistoryRow(BaseModel):
    id: str
    created_at: str
    text: str
    text_polished: Optional[str] = None
    ms: int
    audio_bytes: int
    peak_level: Optional[float] = None
    model: str
    audio_path: Optional[str] = None


class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    lang: Optional[str] = None


class ChatRequest(BaseModel):
    session_id: str
    text: str
    model: Optional[str] = None
    voice: Optional[str] = None


class DraftRow(BaseModel):
    id: str
    session_id: Optional[str] = None
    started_at: str
    updated_at: str
    sample_rate: int
    pcm_path: str
    audio_bytes: int
    latest_partial: Optional[str] = None
    status: str
    transcript_id: Optional[str] = None


# --- /health ---------------------------------------------------------------

@router.get("/health")
async def health() -> dict[str, object]:
    return {
        "ok": True,
        "voice_mode": settings.voice_mode,
        "model_loaded": mlx_session_loaded(),
        "asr_provider": settings.asr.provider,
        "asr_model_id": settings.asr_active_model_id,
        "tts_provider": settings.tts.provider,
        "tts_model_loaded": mlx_tts_loaded(),
        "tts_model_id": settings.tts_active_model_id,
        "tts_variant": mlx_tts_variant(),
        "tts_voice": settings.tts.voice,
        "tts_voices_available": mlx_tts_voices(),
        "tts_sr": settings.tts.sr,
        "llm_provider": settings.llm.provider,
        "llm_model_id": settings.llm_active_model_id,
        "llm_loaded": mlx_llm_loaded() if settings.llm.provider == "mlx" else None,
        "llm_url": settings.llm_active_url,
        "dashscope_key_set": bool(settings.dashscope.api_key)
                             if settings.llm.provider == "dashscope" else None,
        "ablework_token_set": bool(settings.ablework.token)
                              if settings.llm.provider == "ablework" else None,
        "keep_audio": settings.storage.keep_audio,
        "db": str(settings.storage.db_path),
    }


# --- /config ---------------------------------------------------------------
#
# /health is for "is the server up + which providers are wired";
# /config is for "what's the FULL effective configuration including
# tunable knobs". Secrets (api_key, token) are redacted to a 4-char
# prefix + length — enough to verify a value is set without leaking.

@router.get("/config")
async def config_view() -> dict:
    return public_view()


# --- /tts ------------------------------------------------------------------

@router.post("/tts")
async def tts(req: TTSRequest) -> Response:
    """Synthesize ``req.text`` to a WAV blob. Returns the audio inline
    so the UI can pipe the response body straight into ``new Audio(url)``.

    Honours the request's ``voice`` / ``lang`` override only for MLX
    (a quick way to A/B speakers without restart); cloud path always
    uses the configured voice — change MLX_TTS_VOICE in env to switch.
    """
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty text")
    if len(text) > 4000:
        raise HTTPException(status_code=413, detail="text > 4000 chars")

    started = time.monotonic()
    # For MLX, per-request ``voice`` / ``lang`` override goes through a
    # dedicated path so callers can A/B speakers without restarting
    # (the regular MlxTts.synth() uses the configured defaults). Cloud
    # TTS ignores these — change MLX_TTS_VOICE in env if you want to
    # switch the cloud-default voice.
    if settings.tts.provider == "mlx" and (req.voice or req.lang):
        try:
            wav_bytes, sr, n_samples = await _synth_mlx_override(
                text, req.voice, req.lang,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("tts failed")
            raise HTTPException(
                status_code=500,
                detail=f"tts failed: {type(exc).__name__}: {exc}",
            ) from exc
    else:
        try:
            wav_bytes, sr, n_samples = await get_tts().synth(text, voice=req.voice)
        except Exception as exc:  # noqa: BLE001
            logger.exception("tts failed")
            raise HTTPException(
                status_code=500,
                detail=f"tts failed: {type(exc).__name__}: {exc}",
            ) from exc

    if not wav_bytes:
        raise HTTPException(status_code=500, detail="tts produced no audio")

    ms = int((time.monotonic() - started) * 1000)
    dur_ms = int(1000 * n_samples / sr) if n_samples and sr else 0
    logger.info(
        "tts %d chars → %d samples (%dms audio) in %dms (RTF %.2f)",
        len(text), n_samples, dur_ms, ms, ms / max(dur_ms, 1),
    )
    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "X-TTS-Latency-Ms": str(ms),
            "X-TTS-Duration-Ms": str(dur_ms),
            "X-TTS-Sample-Rate": str(sr),
            "X-TTS-Voice": str(req.voice or settings.tts.voice),
            "X-TTS-Model": settings.tts_active_model_id,
        },
    )


async def _synth_mlx_override(
    text: str, voice: Optional[str], lang: Optional[str],
) -> tuple[bytes, int, int]:
    """Per-request voice/lang override path. Bypasses MlxTts which uses
    the configured defaults — used by the /tts ad-hoc endpoint."""
    from .providers.tts import ensure_mlx_tts
    import numpy as np  # noqa: PLC0415

    def _sync():
        model = ensure_mlx_tts()
        kwargs: dict[str, object] = {"voice": voice or settings.tts.voice}
        if lang:
            kwargs["lang_code"] = lang
        chunks = []
        for result in model.generate(text, **kwargs):
            chunks.append(getattr(result, "audio", result))
        if not chunks:
            return b"", settings.tts.sr, 0
        flat = np.concatenate([np.asarray(c, dtype=np.float32).reshape(-1) for c in chunks])
        wav = pcm_float_to_wav_bytes(flat, settings.tts.sr)
        return wav, settings.tts.sr, int(flat.shape[0])

    return await mlx_call(_sync)


# --- /history --------------------------------------------------------------

@router.get("/history", response_model=list[HistoryRow])
async def history(limit: int = 50) -> list[HistoryRow]:
    rows = db.list_transcripts(limit)
    return [HistoryRow(**r) for r in rows]


@router.delete("/history/{transcript_id}")
async def delete_transcript(transcript_id: str) -> dict[str, object]:
    audio_path = db.delete_transcript(transcript_id)
    if audio_path is None:
        raise HTTPException(status_code=404, detail="not found")
    if audio_path:
        try:
            Path(audio_path).unlink(missing_ok=True)
        except Exception:
            pass
    return {"ok": True, "id": transcript_id}


# --- /transcribe (one-shot file upload) -------------------------------------

@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    audio: UploadFile = File(...),
    peak_level: Optional[float] = Form(None),
    client_meta: Optional[str] = Form(None),
) -> TranscribeResponse:
    """Transcribe a single audio file, persist the result.

    Accepts whatever ffmpeg-decodable format the browser hands us. 20MB
    cap is a safety net — long-form audio should call Session.transcribe
    directly, not this round-trip endpoint.
    """
    raw = await audio.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty audio body")
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="audio > 20MB")

    transcript_id = uuid.uuid4().hex
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    suffix = Path(audio.filename or "audio.webm").suffix or ".webm"

    if settings.storage.keep_audio:
        audio_path: Optional[Path] = settings.storage.audio_dir / f"{transcript_id}{suffix}"
        audio_path.write_bytes(raw)
        decode_source = str(audio_path)
    else:
        audio_path = None
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(raw)
            decode_source = tmp.name

    started = time.monotonic()
    try:
        session = await mlx_call(ensure_mlx_session)
        result = await mlx_call(session.transcribe, decode_source)
    except Exception as exc:  # noqa: BLE001
        logger.exception("transcribe failed")
        if not settings.storage.keep_audio:
            try: Path(decode_source).unlink(missing_ok=True)
            except Exception: pass
        raise HTTPException(
            status_code=500,
            detail=f"transcribe failed: {type(exc).__name__}: {exc}",
        ) from exc
    finally:
        if not settings.storage.keep_audio:
            try: Path(decode_source).unlink(missing_ok=True)
            except Exception: pass

    ms = int((time.monotonic() - started) * 1000)
    text = getattr(result, "text", "") or ""

    db.insert_transcript(
        id=transcript_id, created_at=created_at, text=text,
        ms=ms, audio_bytes=len(raw), peak_level=peak_level,
        model=settings.asr.mlx_model,
        audio_path=str(audio_path) if audio_path else None,
        client_meta=client_meta,
    )
    logger.info(
        "transcribed id=%s %d bytes (%s) peak=%s → %d chars in %dms %s",
        transcript_id, len(raw), suffix,
        f"{peak_level:.2f}" if peak_level is not None else "?",
        len(text), ms,
        "[saved audio]" if settings.storage.keep_audio else "",
    )
    return TranscribeResponse(
        id=transcript_id, created_at=created_at, text=text,
        ms=ms, audio_bytes=len(raw), peak_level=peak_level,
        model=settings.asr.mlx_model,
    )


# --- /chat (SSE adapter) ---------------------------------------------------

def _sse(event: str, data: dict | str) -> bytes:
    payload = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")


@router.post("/chat")
async def chat_route(req: ChatRequest) -> StreamingResponse:
    """SSE adapter for ``chat.run_chat_pipeline``. Most clients should
    use ``/ws`` instead — it supports interrupt and binary PCM upload.
    This endpoint stays for curl-based smoke tests."""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty text")

    async def event_stream() -> AsyncIterator[bytes]:
        out_q: asyncio.Queue[Optional[bytes]] = asyncio.Queue()

        async def emit(event: str, data: dict) -> None:
            # SSE event names match the WS protocol verbatim — same
            # discriminator across transports.
            await out_q.put(_sse(event, data))

        async def runner() -> None:
            try:
                await chat.run_chat_pipeline(req.session_id, text, emit)
            finally:
                await out_q.put(None)

        runner_t = asyncio.create_task(runner())
        try:
            while True:
                item = await out_q.get()
                if item is None:
                    break
                yield item
        finally:
            if not runner_t.done():
                runner_t.cancel()
                try: await runner_t
                except (asyncio.CancelledError, Exception): pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/chat/reset")
async def chat_reset(payload: dict) -> dict:
    session_id = (payload or {}).get("session_id", "")
    if not session_id:
        raise HTTPException(status_code=400, detail="missing session_id")
    prior = chat.reset_conversation(session_id)
    return {"ok": True, "cleared": prior}


@router.get("/chat/history")
async def chat_history(session_id: str) -> dict:
    return {
        "session_id": session_id,
        "messages": chat.get_conversation(session_id),
    }


# --- /drafts — crash-recovered recordings ----------------------------------
#
# A "draft" is the on-disk buffer for a recording window: each binary PCM
# frame got appended to recordings/draft-<id>.pcm and each ASR partial
# was snapshotted into the DB. Drafts that lived through stop_recording
# are status=completed (and link to a transcripts row). Drafts that the
# WS died mid-recording end up status=interrupted on the next server
# startup — those show up here and can be re-transcribed via /recover.

@router.get("/drafts", response_model=list[DraftRow])
async def list_drafts(status: Optional[str] = "interrupted") -> list[DraftRow]:
    """List drafts. Default ``status=interrupted`` so the recovery UI
    can show only what's actionable; pass ``status=`` (empty) or
    ``all`` to see everything for debugging."""
    if status in (None, "", "all"):
        rows = db.list_drafts(status=None)
    else:
        rows = db.list_drafts(status=status)
    return [DraftRow(**r) for r in rows]


@router.post("/drafts/{draft_id}/recover", response_model=TranscribeResponse)
async def recover_draft(draft_id: str) -> TranscribeResponse:
    """Re-transcribe an interrupted draft's PCM file and insert it as
    a normal transcript row. The draft is marked ``recovered``."""
    row = db.get_draft(draft_id)
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    if row["status"] not in ("interrupted", "in_progress"):
        raise HTTPException(
            status_code=409,
            detail=f"draft status={row['status']} — only interrupted/in_progress are recoverable",
        )
    pcm_path = Path(row["pcm_path"])
    if not pcm_path.exists():
        raise HTTPException(
            status_code=410,
            detail=f"pcm file gone: {pcm_path}",
        )

    # Wrap raw int16 PCM in a WAV header so mlx-qwen3-asr's ffmpeg
    # loader has something to chew on. ASR provider is MLX-only on
    # this path (cloud one-shot ASR not wired for /transcribe).
    from .audio import wrap_pcm_int16_as_wav
    import tempfile
    pcm_bytes = pcm_path.read_bytes()
    wav_bytes = wrap_pcm_int16_as_wav(pcm_bytes, row["sample_rate"])
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(wav_bytes)
        decode_source = tmp.name

    started = time.monotonic()
    try:
        session = await mlx_call(ensure_mlx_session)
        result = await mlx_call(session.transcribe, decode_source)
    except Exception as exc:  # noqa: BLE001
        logger.exception("draft recover ASR failed")
        try: Path(decode_source).unlink(missing_ok=True)
        except Exception: pass
        raise HTTPException(
            status_code=500,
            detail=f"recover failed: {type(exc).__name__}: {exc}",
        ) from exc
    finally:
        try: Path(decode_source).unlink(missing_ok=True)
        except Exception: pass

    ms = int((time.monotonic() - started) * 1000)
    text = getattr(result, "text", "") or ""

    transcript_id = uuid.uuid4().hex
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    # If KEEP_AUDIO=1, archive the PCM path; otherwise drop the link.
    archived_path = str(pcm_path) if settings.storage.keep_audio else None
    db.insert_transcript(
        id=transcript_id, created_at=created_at, text=text,
        ms=ms, audio_bytes=row["audio_bytes"], peak_level=None,
        model=settings.asr.mlx_model,
        audio_path=archived_path,
        client_meta='{"recovered_from_draft":"' + draft_id + '"}',
    )
    db.finalize_draft(
        draft_id, status="recovered",
        transcript_id=transcript_id,
        audio_bytes=row["audio_bytes"], updated_at=created_at,
    )
    if not settings.storage.keep_audio:
        try: pcm_path.unlink(missing_ok=True)
        except Exception: pass
    logger.info(
        "recovered draft id=%s → transcript=%s %d bytes → %d chars in %dms",
        draft_id[:8], transcript_id[:8], row["audio_bytes"], len(text), ms,
    )
    return TranscribeResponse(
        id=transcript_id, created_at=created_at, text=text,
        ms=ms, audio_bytes=row["audio_bytes"], peak_level=None,
        model=settings.asr.mlx_model,
    )


@router.delete("/drafts/{draft_id}")
async def discard_draft(draft_id: str) -> dict[str, object]:
    """Throw away an interrupted draft — delete the PCM file + remove
    the DB row. Completed drafts (which link to transcripts) are not
    deletable through this endpoint — use /history/{transcript_id}."""
    row = db.get_draft(draft_id)
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    if row["status"] == "completed":
        raise HTTPException(
            status_code=409,
            detail="draft is completed — delete the transcript via /history instead",
        )
    pcm_path = db.delete_draft(draft_id)
    if pcm_path:
        try: Path(pcm_path).unlink(missing_ok=True)
        except Exception: pass
    return {"ok": True, "id": draft_id}
