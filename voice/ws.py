"""WebSocket /ws handler — single full-duplex channel for the voice loop.

Wire protocol
=============
Client → Server
  binary   PCM int16 LE @ 16kHz mono (only between start/stop_recording)
  JSON     {"type": "hello", "session_id": "..."}        (once, first msg)
           {"type": "start_recording", "sample_rate": 16000}
           {"type": "stop_recording", "peak_level": 0.0..1.0}
           {"type": "interrupt"}                          (cancel chat)
           {"type": "tts", "text": "..."}                 (one-shot TTS)
           {"type": "reset"}                              (clear history)

Server → Client (all JSON)
  {"type": "ready", asr_model_id, tts_model_id, llm_model_id, ...}
  {"type": "asr_partial", text, stable_text}             (during recording)
  {"type": "transcript", id, text, ms, audio_bytes, peak_level, model}
  {"type": "meta",        model, voice}
  {"type": "token",       delta}
  {"type": "audio_chunk", text, b64, dur_ms, synth_ms, idx}
  {"type": "chat_done",   full_text, total_ms, n_audio, history_len}
  {"type": "interrupted", reason}
  {"type": "tts_done",    ms, dur_ms, size}              (after one-shot TTS)
  {"type": "history_reset", cleared}
  {"type": "error",       where, message}

Implementation
==============
One ``WsSession`` per WebSocket. Each event type has its own ``_handle_*``
method, dispatched from a small table in the receive loop — beats a
300-line chain of if-elif. State is just three values: ``idle``,
``recording``, ``chatting``.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import WebSocket

from . import db
from .chat import reset_conversation, run_chat_pipeline
from .chat import synth_one
from .config import settings
from .polish import polish_text
from .providers import get_asr
from .providers.base import AsrSession
from .storage import DraftRecorder

logger = logging.getLogger("voice.ws")


class WsSession:
    """Per-connection state machine."""

    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.session_id: Optional[str] = None
        self.state: str = "idle"
        self.sample_rate: int = 16000
        self.chat_task: Optional[asyncio.Task] = None
        self.asr: Optional[AsrSession] = None
        self.draft: Optional[DraftRecorder] = None
        self.audio_bytes: int = 0
        self.t_started: float = 0.0
        self._send_lock = asyncio.Lock()

    async def send_json(self, obj: dict) -> None:
        async with self._send_lock:
            try:
                await self.ws.send_json(obj)
            except Exception:
                # client gone or socket closed — outer loop will notice.
                pass

    async def cancel_chat(self, reason: str) -> None:
        t = self.chat_task
        self.chat_task = None
        if t is None or t.done():
            return
        t.cancel()
        try:
            await t
        except (asyncio.CancelledError, Exception):
            pass
        await self.send_json({"type": "interrupted", "reason": reason})
        logger.info("chat interrupted (%s) session=%s", reason,
                    (self.session_id or "?")[:8])

    # --- ready frame --------------------------------------------------------

    async def send_ready(self) -> None:
        await self.send_json({
            "type": "ready",
            "asr_provider": settings.asr.provider,
            "asr_model_id": settings.asr_active_model_id,
            "tts_provider": settings.tts.provider,
            "tts_model_id": settings.tts_active_model_id,
            "tts_voice":    settings.tts.voice,
            "llm_provider": settings.llm.provider,
            "llm_model_id": settings.llm_active_model_id,
            "tts_sr": settings.tts.sr,
        })

    # --- event handlers -----------------------------------------------------

    async def handle_hello(self, ev: dict) -> None:
        self.session_id = str(ev.get("session_id") or uuid.uuid4().hex)
        logger.info("ws hello session=%s", self.session_id[:8])

    async def handle_start_recording(self, ev: dict) -> None:
        # Implicit interrupt if a chat is still streaming.
        if self.chat_task is not None and not self.chat_task.done():
            await self.cancel_chat("new_recording")
        # Cancel any orphaned ASR session from a prior recording.
        if self.asr is not None:
            await self.asr.cancel()
            self.asr = None
        # Abort any orphaned draft too (would only happen if
        # start_recording fired without an intervening stop).
        if self.draft is not None:
            try:
                await self.draft.abort()
            except Exception:  # noqa: BLE001
                logger.exception("orphan draft abort failed")
            self.draft = None
        self.sample_rate = int(ev.get("sample_rate", 16000))
        self.audio_bytes = 0
        self.t_started = time.monotonic()

        # Crash-safe buffer — opens a .pcm file + inserts row. Started
        # before ASR so even the first ASR-init error leaves us with
        # an orphaned but recoverable draft.
        self.draft = DraftRecorder(self.session_id, self.sample_rate)
        try:
            await self.draft.start()
        except Exception as exc:  # noqa: BLE001
            logger.exception("draft start failed")
            await self.send_json({"type": "error", "where": "draft_init",
                                  "message": f"{type(exc).__name__}: {exc}"})
            self.draft = None
            return

        async def on_partial(text: str, stable_text: str) -> None:
            if self.draft is not None:
                self.draft.update_partial(text)
            await self.send_json({
                "type": "asr_partial",
                "text": text,
                "stable_text": stable_text,
            })

        self.asr = get_asr(self.sample_rate, on_partial)
        try:
            await self.asr.start()
        except Exception as exc:  # noqa: BLE001
            logger.exception("ASR start failed")
            await self.send_json({"type": "error", "where": "asr_init",
                                  "message": f"{type(exc).__name__}: {exc}"})
            # Tear down the draft we just opened — no ASR means no
            # usable recording. Leave row as in_progress so it shows up
            # as interrupted; user can decide if they want to recover
            # the raw PCM by running ASR manually.
            try:
                await self.draft.abort()
            except Exception:  # noqa: BLE001
                pass
            self.draft = None
            self.asr = None
            return
        self.state = "recording"

    async def handle_stop_recording(self, ev: dict) -> None:
        if self.state != "recording":
            await self.send_json({"type": "error", "where": "stop_recording",
                                  "message": f"not recording (state={self.state})"})
            return
        self.state = "idle"
        peak_level = ev.get("peak_level")
        client_meta = json.dumps({
            k: v for k, v in ev.items()
            if k not in ("type", "peak_level")
        }) if any(k for k in ev if k not in ("type", "peak_level")) else None

        # No audio captured — short-circuit with an empty transcript.
        if self.audio_bytes == 0:
            await self.send_json({"type": "transcript",
                                  "id": "", "text": "", "ms": 0,
                                  "audio_bytes": 0,
                                  "peak_level": peak_level,
                                  "model": settings.asr_active_model_id})
            if self.asr is not None:
                await self.asr.cancel()
                self.asr = None
            # Discard the empty draft — nothing to recover.
            if self.draft is not None:
                try:
                    await self.draft.finalize(transcript_id=None)
                except Exception:  # noqa: BLE001
                    pass
                # Override status to 'discarded' so the empty draft
                # doesn't show up in recovery UI.
                db.finalize_draft(
                    self.draft.id, status="discarded",
                    transcript_id=None, audio_bytes=0,
                    updated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                )
                self.draft = None
            return

        if self.asr is None:
            await self.send_json({"type": "error", "where": "asr",
                                  "message": "asr session missing"})
            return

        t_finalize = time.monotonic()
        try:
            final_text = await self.asr.finish()
        except Exception as exc:  # noqa: BLE001
            logger.exception("ASR finish failed")
            await self.send_json({"type": "error", "where": "asr",
                                  "message": f"{type(exc).__name__}: {exc}"})
            self.asr = None
            return
        model_id = self.asr.model_id
        self.asr = None

        total_ms = int((time.monotonic() - self.t_started) * 1000)
        finalize_ms = int((time.monotonic() - t_finalize) * 1000)
        transcript_id = uuid.uuid4().hex
        created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

        # If KEEP_AUDIO=1, the draft's PCM file becomes the archive
        # audio_path. Otherwise audio_path stays None (draft will
        # delete the file).
        archived_audio_path = (
            str(self.draft.pcm_path) if (self.draft and settings.storage.keep_audio)
            else None
        )
        db.insert_transcript(
            id=transcript_id, created_at=created_at, text=final_text,
            ms=total_ms, audio_bytes=self.audio_bytes, peak_level=peak_level,
            model=model_id, audio_path=archived_audio_path, client_meta=client_meta,
        )
        # Mark the draft completed + link it to the transcript. This
        # also deletes the .pcm if KEEP_AUDIO=0.
        if self.draft is not None:
            try:
                await self.draft.finalize(transcript_id=transcript_id)
            except Exception:  # noqa: BLE001
                logger.exception("draft finalize failed (transcript saved anyway)")
            self.draft = None
        logger.info(
            "ws ASR (%s) id=%s pcm=%d bytes total=%dms (finalize %dms) → %r",
            settings.asr.provider, transcript_id, self.audio_bytes,
            total_ms, finalize_ms, final_text[:60],
        )

        rec = {
            "id": transcript_id, "created_at": created_at,
            "text": final_text, "ms": total_ms,
            "audio_bytes": self.audio_bytes,
            "peak_level": peak_level, "model": model_id,
        }
        await self.send_json({"type": "transcript", **rec})

        said = (rec["text"] or "").strip()
        if not said:
            return

        # Polish the transcript before chat. Runs synchronously here so
        # we can both emit ``transcript_polished`` (UI feedback) and pass
        # the cleaned text to the chat pipeline. polish_text() never
        # raises — on any failure ``.final`` is the raw text.
        # Always emit the event (even when skipped) so the client has a
        # stable signal it can wait on; ``skipped`` tells the UI whether
        # the polished text differs from raw.
        polish_result = await polish_text(said)
        await self.send_json({
            "type": "transcript_polished",
            "id": transcript_id,
            "text": polish_result.final,
            "raw": polish_result.raw,
            "skipped": polish_result.skipped,
            "attempts": polish_result.attempts,
            "ok": polish_result.ok,
            "errors": polish_result.errors,
            "ms": polish_result.ms,
        })
        if polish_result.final != said:
            db.update_polished(transcript_id, polish_result.final)

        # Decide what chat actually sees. ``use_polished_for_chat`` lets
        # the user keep UI polish while still feeding the agent the raw
        # ASR (rare but valid for debugging).
        chat_input = (
            polish_result.final
            if settings.polish.use_polished_for_chat
            else said
        )

        # Spawn chat — cancellable via interrupt/new_recording. Pass
        # ``polished_text`` so chat.py doesn't repeat the polish call.
        sid = self.session_id

        async def emit(ev_name: str, data: dict) -> None:
            payload = {"type": ev_name if ev_name != "done" else "chat_done", **data}
            await self.send_json(payload)
        self.chat_task = asyncio.create_task(
            run_chat_pipeline(sid, said, emit, polished_text=chat_input),
            name=f"chat-{sid[:8]}",
        )

    async def handle_interrupt(self, ev: dict) -> None:
        await self.cancel_chat("user_interrupt")

    async def handle_tts(self, ev: dict) -> None:
        """One-shot TTS for the composer textarea — runs in parallel
        with any chat (MLX serialises GPU compute anyway)."""
        text = (ev.get("text") or "").strip()
        if not text:
            await self.send_json({"type": "error", "where": "tts",
                                  "message": "empty text"})
            return
        t0 = time.monotonic()
        try:
            wav_bytes, sr, n_samples = await synth_one(text)
        except Exception as exc:  # noqa: BLE001
            logger.exception("ws tts failed")
            await self.send_json({"type": "error", "where": "tts",
                                  "message": f"{type(exc).__name__}: {exc}"})
            return
        ms = int((time.monotonic() - t0) * 1000)
        dur_ms = int(1000 * n_samples / sr) if n_samples and sr else 0
        b64 = base64.b64encode(wav_bytes).decode("ascii") if wav_bytes else ""
        await self.send_json({"type": "audio_chunk", "text": text, "b64": b64,
                              "dur_ms": dur_ms, "synth_ms": ms, "idx": 0})
        await self.send_json({"type": "tts_done", "ms": ms, "dur_ms": dur_ms,
                              "size": len(wav_bytes)})

    async def handle_reset(self, ev: dict) -> None:
        await self.cancel_chat("reset")
        prior = reset_conversation(self.session_id or "")
        await self.send_json({"type": "history_reset", "cleared": prior})

    # --- main loop ---------------------------------------------------------

    HANDLERS = {
        "hello":           "handle_hello",
        "start_recording": "handle_start_recording",
        "stop_recording":  "handle_stop_recording",
        "interrupt":       "handle_interrupt",
        "tts":             "handle_tts",
        "reset":           "handle_reset",
    }

    async def run(self) -> None:
        await self.ws.accept()
        await self.send_ready()
        try:
            while True:
                msg = await self.ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    break

                # Binary frames: PCM during recording window.
                if "bytes" in msg and msg["bytes"] is not None:
                    if self.state != "recording" or self.asr is None:
                        continue
                    pcm_chunk = msg["bytes"]
                    self.audio_bytes += len(pcm_chunk)
                    # Persist FIRST, then feed ASR — if ASR raises we
                    # still have the bytes on disk for recovery.
                    if self.draft is not None:
                        try:
                            self.draft.append_pcm(pcm_chunk)
                        except Exception:  # noqa: BLE001
                            logger.exception("draft append_pcm failed")
                    try:
                        await self.asr.feed(pcm_chunk)
                    except Exception as exc:  # noqa: BLE001
                        logger.exception("asr.feed failed")
                        await self.send_json({"type": "error", "where": "asr_partial",
                                              "message": f"{type(exc).__name__}: {exc}"})
                    continue

                text_frame = msg.get("text")
                if text_frame is None:
                    continue
                try:
                    event = json.loads(text_frame)
                except json.JSONDecodeError:
                    await self.send_json({"type": "error", "where": "parse",
                                          "message": "bad json"})
                    continue
                ev_type = event.get("type")

                # Auto-assign session_id if first non-hello message
                # didn't include one (curl-style ad-hoc clients).
                if ev_type != "hello" and self.session_id is None:
                    self.session_id = uuid.uuid4().hex

                handler_name = self.HANDLERS.get(ev_type)
                if handler_name is None:
                    await self.send_json({"type": "error", "where": "router",
                                          "message": f"unknown event type: {ev_type!r}"})
                    continue
                await getattr(self, handler_name)(event)

        except Exception:  # noqa: BLE001
            logger.exception("ws handler crashed")
        finally:
            # Clean up dangling ASR session before chat — if WS dies
            # mid-recording the upstream WS needs an explicit close.
            if self.asr is not None:
                try:
                    await self.asr.cancel()
                except Exception:
                    pass
            # Flush the draft's PCM to disk + close file handle. The
            # row stays ``in_progress``; next server startup converts
            # to ``interrupted`` (see server.py lifespan).
            if self.draft is not None:
                try:
                    await self.draft.abort()
                except Exception:
                    pass
                self.draft = None
            # If the socket dies mid-chat, kill the background task —
            # don't leave it talking to a closed pipe.
            if self.chat_task is not None and not self.chat_task.done():
                self.chat_task.cancel()
                try:
                    await self.chat_task
                except (asyncio.CancelledError, Exception):
                    pass
            logger.info("ws closed session=%s state=%s",
                        (self.session_id or "?")[:8], self.state)


async def websocket_voice(ws: WebSocket) -> None:
    """FastAPI route entry — instantiates a session and runs the loop."""
    session = WsSession(ws)
    await session.run()
