"""WebSocket /ws handler — single full-duplex channel for the voice loop.

Wire protocol
=============
Client → Server
  binary   PCM int16 LE @ 16kHz mono (only between start/stop_recording)
  JSON     {"type": "hello", "session_id": "..."}        (once, first msg)
           {"type": "start_recording", "sample_rate": 16000}
           {"type": "stop_recording", "peak_level": 0.0..1.0}
           {"type": "interrupt"}                          (cancel chat)
           {"type": "text_message", "text": "..."}        (typed chat turn)
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

import base64

from . import db
from .chat import reset_conversation, run_chat_pipeline
from .chat import synth_one
from .config import settings, apply_preset, current_preset, preset_options
from .intents import process_intent
from .intents.workspace_cache import WorkspaceCache
from .meta_commands import MetaCommand, MetaMatch, match as match_meta_command
from .polish import polish_text
from .providers import get_asr
from .providers.base import AsrSession
from .providers.llm import reset_ablework_session
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
        # Per-session runtime overrides (settable via WS events from the
        # TUI / browser UI). When set, take precedence over the global
        # settings.tts.voice / settings.polish.enabled values for THIS
        # WS session only — doesn't mutate global Settings (which is
        # frozen by design).
        self.voice_override: Optional[str] = None
        self.tts_provider_override: Optional[str] = None  # "mlx" | "dashscope"
        self.polish_override: Optional[bool] = None       # None = use global default
        # TTS prosody overrides — driven by meta-command fast-path ("慢点" /
        # "快点" / "大声点" / "小声点"). None means "use settings.tts default".
        # Persists until the user adjusts again or session ends.
        self.speech_rate_override: Optional[float] = None
        self.volume_override: Optional[float] = None
        # Per-session workspace state — voice intent classifier (or
        # explicit set_workspace WS event) sets workspace_override; cache
        # is the list of available workspaces fetched at hello-time and
        # refreshed on demand.
        self.workspace_override: Optional[str] = None
        self.cache = WorkspaceCache()

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

    async def _emit_intent_ack(self, result) -> None:
        """Send a workspace-changed + intent_ack pair, then TTS the
        ack_text. The TUI plays the audio through its normal audio_chunk
        path so user hears the ack like a chat reply."""
        # 1. Structural event — UI status bar updates from this
        ws = self.cache.by_id(self.workspace_override) if self.workspace_override else None
        await self.send_json({
            "type": "workspace_changed",
            "id": self.workspace_override,
            "name": (ws or {}).get("name") if ws else None,
            "intent": result.intent.value,
            "ok": result.error is None,
            "error": result.error,
        })
        # 2. Text + meta — for UI display
        await self.send_json({
            "type": "intent_ack",
            "intent": result.intent.value,
            "text": result.ack_text or "",
            "workspace_id": result.workspace_id,
            "workspace_match": result.workspace_match,
            "ms_classify": result.ms_classify,
            "ms_handle": result.ms_handle,
        })
        # 3. Speak it. synth_one runs through normal MLX worker / cloud
        # TTS path. Failures are non-fatal — the text message above
        # already conveys the info, audio is just an enhancement.
        ack = (result.ack_text or "").strip()
        if not ack:
            return
        try:
            from .audio import strip_tts_unfriendly
            wav_bytes, sr, n_samples = await synth_one(
                strip_tts_unfriendly(ack), voice=self.voice_override,
            )
            if not wav_bytes:
                return
            dur_ms = int(1000 * n_samples / sr) if n_samples and sr else 0
            b64 = base64.b64encode(wav_bytes).decode("ascii")
            await self.send_json({
                "type": "audio_chunk", "text": ack, "b64": b64,
                "dur_ms": dur_ms, "synth_ms": 0, "idx": 0,
            })
        except Exception:
            logger.exception("intent ack TTS failed (text was sent already)")

    # --- Meta-command handler ----------------------------------------------

    async def _handle_meta_command(self, meta: MetaMatch) -> None:
        """Execute a fast-path meta-command. STOP cancels the running
        chat; SLOWER/FASTER adjust speech_rate_override; LOUDER/QUIETER
        adjust volume_override. RESUME/REPLAY are acknowledged here but
        their playback effect lives client-side (server has no audio
        cache to replay). All paths emit ``meta_command_ack`` + TTS the
        ack text so the user hears confirmation."""
        cmd = meta.command
        notes: dict = {"command": cmd.value, "phrase": meta.matched_phrase}

        if cmd is MetaCommand.STOP:
            await self.cancel_chat("user_meta_stop")
        elif cmd is MetaCommand.SLOWER:
            cur = self.speech_rate_override if self.speech_rate_override is not None else settings.tts.speech_rate
            self.speech_rate_override = max(0.5, round(cur - 0.2, 2))
            notes["speech_rate"] = self.speech_rate_override
        elif cmd is MetaCommand.FASTER:
            cur = self.speech_rate_override if self.speech_rate_override is not None else settings.tts.speech_rate
            self.speech_rate_override = min(2.0, round(cur + 0.2, 2))
            notes["speech_rate"] = self.speech_rate_override
        elif cmd is MetaCommand.LOUDER:
            cur = self.volume_override if self.volume_override is not None else settings.tts.volume
            self.volume_override = min(100.0, round(cur + 15.0, 1))
            notes["volume"] = self.volume_override
        elif cmd is MetaCommand.QUIETER:
            cur = self.volume_override if self.volume_override is not None else settings.tts.volume
            self.volume_override = max(0.0, round(cur - 15.0, 1))
            notes["volume"] = self.volume_override
        # RESUME / REPLAY — server-side no-op; client-side replay UX TBD.

        logger.info(
            "ws meta_command session=%s %s → %s",
            (self.session_id or "?")[:8], cmd.value, notes,
        )
        await self.send_json({"type": "meta_command_ack", **notes})

        # Speak the ack so the user hears confirmation. TTS failure is
        # non-fatal — the meta_command_ack JSON above already conveyed
        # the state change, audio is just the natural feedback.
        ack = meta.ack_text.strip()
        if not ack:
            return
        try:
            from .audio import strip_tts_unfriendly
            wav_bytes, sr, n_samples = await synth_one(
                strip_tts_unfriendly(ack), voice=self.voice_override,
            )
            if not wav_bytes:
                return
            dur_ms = int(1000 * n_samples / sr) if n_samples and sr else 0
            b64 = base64.b64encode(wav_bytes).decode("ascii")
            await self.send_json({
                "type": "audio_chunk", "text": ack, "b64": b64,
                "dur_ms": dur_ms, "synth_ms": 0, "idx": 0,
            })
        except Exception:
            logger.exception("meta_command ack TTS failed (text was sent already)")

    # --- SessionCtx adapter (for voice.intents.handlers) -------------------

    def get_workspace_override(self) -> Optional[str]:
        return self.workspace_override

    def set_workspace_override(self, ws_id: Optional[str]) -> None:
        self.workspace_override = ws_id

    def reset_conversation(self) -> int:
        """Full local + ablework conv reset — for ws_switch / ws_create
        / ws_leave handlers."""
        return reset_conversation(self.session_id or "")

    def reset_ablework_session_only(self) -> None:
        """Only clear the ablework-side conv_id — keep local
        ``_conversations[session_id]`` history so the UI still shows it.
        Used by ws_move so the user sees their previous turns continuing
        in the new workspace."""
        reset_ablework_session(self.session_id or "")

    # --- ready frame --------------------------------------------------------

    def _config_snapshot(self) -> dict:
        """Current provider stack + preset state — shared by the ready
        event and preset_changed so clients render one consistent view."""
        return {
            "asr_provider": settings.asr.provider,
            "asr_model_id": settings.asr_active_model_id,
            "tts_provider": settings.tts.provider,
            "tts_model_id": settings.tts_active_model_id,
            "tts_voice":    settings.tts.voice,
            "llm_provider": settings.llm.provider,
            "llm_model_id": settings.llm_active_model_id,
            "tts_sr": settings.tts.sr,
            "preset": current_preset(),
            "presets": preset_options(),
        }

    async def send_ready(self) -> None:
        await self.send_json({"type": "ready", **self._config_snapshot()})

    # --- event handlers -----------------------------------------------------

    async def handle_hello(self, ev: dict) -> None:
        self.session_id = str(ev.get("session_id") or uuid.uuid4().hex)
        logger.info("ws hello session=%s", self.session_id[:8])
        # If env default workspace is set, seed the override so the
        # first chat lands there (the user can override later via voice).
        if not self.workspace_override and settings.ablework.default_workspace_id:
            self.workspace_override = settings.ablework.default_workspace_id
        # Fetch workspace list in the background — used by the intent
        # classifier for fuzzy matching + by the TUI status bar. We
        # don't block hello on this; cache lazy-fills if first intent
        # arrives before fetch completes.
        asyncio.create_task(self._bootstrap_workspaces(), name="ws-bootstrap")

    async def _bootstrap_workspaces(self) -> None:
        """Fetch workspaces, populate cache, send workspace_list event
        to TUI so status bar shows current ws name. Non-fatal — logs
        on failure (might happen if token expired or ablework down)."""
        if not settings.ablework.has_token:
            return
        try:
            await self.cache.refresh()
        except Exception:
            logger.exception("workspace bootstrap failed")
            return
        current = self.cache.by_id(self.workspace_override) if self.workspace_override else None
        await self.send_json({
            "type": "workspace_list",
            "workspaces": [
                {"id": w.get("id"), "name": w.get("name"),
                 "last_active_at": w.get("last_active_at")}
                for w in self.cache.workspaces
            ],
            "current_id": self.workspace_override,
            "current_name": (current or {}).get("name") if current else None,
        })

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

        # Meta-command fast path — deterministic short commands
        # ("停"/"慢点"/"大声点" etc.) bypass polish + LLM intent classify
        # + chat entirely. Saves ~3s for these high-frequency control
        # utterances. Only triggers when duration AND text-length gates
        # both hold (see voice.meta_commands for the exact rule).
        meta = match_meta_command(said, duration_ms=total_ms)
        if meta is not None:
            await self._handle_meta_command(meta)
            return

        # Polish the transcript before chat. Per-session ``polish_override``
        # (settable via ``set_polish`` WS event from the TUI) wins; falls
        # back to global ``settings.polish.enabled`` otherwise. When
        # disabled we still emit ``transcript_polished`` with ``skipped``
        # so the client UI has a stable signal.
        polish_active = (
            settings.polish.enabled if self.polish_override is None
            else self.polish_override
        )
        if polish_active:
            polish_result = await polish_text(said)
        else:
            from .polish.api import PolishResult
            polish_result = PolishResult(
                final=said, raw=said, polished="", skipped=True,
                attempts=0, ok=True, errors=["polish_disabled_per_session"],
                ms=0,
            )
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

        # ---- Intent classification (workspace ops via voice) ----------
        # Runs on the polished text. If user said "切到 X" / "新建 X" /
        # etc, ``process_intent`` handles it directly (speaks ack via
        # TTS, emits workspace_changed event) and we skip the chat
        # pipeline for this turn. Plain chat falls through.
        try:
            intent_result = await process_intent(polish_result.final, self)
        except Exception:
            logger.exception("process_intent crashed — falling through to chat")
            intent_result = None
        if intent_result is not None and intent_result.handled:
            await self._emit_intent_ack(intent_result)
            return

        # Spawn chat — cancellable via interrupt/new_recording. Pass
        # ``polished_text`` so chat.py doesn't repeat the polish call.
        self._spawn_chat(said, chat_input)

    def _spawn_chat(self, said: str, chat_input: str) -> None:
        """Start a cancellable chat turn shared by the voice and typed
        input paths. ``said`` is the raw user text (history/logging);
        ``chat_input`` is what the LLM actually sees — polished text for
        voice, the raw typed text for the composer."""
        sid = self.session_id or ""

        async def emit(ev_name: str, data: dict) -> None:
            payload = {"type": ev_name if ev_name != "done" else "chat_done", **data}
            await self.send_json(payload)
        # Pass voice override down so MLX TTS picks the right speaker
        # for this session. None means "use settings.tts.voice default".
        # workspace_id: per-session override > env default > none.
        effective_ws = self.workspace_override or settings.ablework.default_workspace_id
        self.chat_task = asyncio.create_task(
            run_chat_pipeline(
                sid, said, emit,
                polished_text=chat_input,
                voice_override=self.voice_override,
                workspace_id=effective_ws or None,
                speech_rate_override=self.speech_rate_override,
                volume_override=self.volume_override,
            ),
            name=f"chat-{sid[:8]}",
        )

    async def handle_text_message(self, ev: dict) -> None:
        """Typed-input path — runs the same chat pipeline as a voice turn,
        minus ASR + polish (typed text has no ASR artifacts to clean).
        Intent classification still runs so typed workspace ops ("切到 X")
        work. The reply streams identical meta / token / audio_chunk /
        chat_done events, so text and voice are interchangeable inputs to
        a single conversation."""
        text = (ev.get("text") or "").strip()
        if not text:
            await self.send_json({"type": "error", "where": "text_message",
                                  "message": "empty text"})
            return
        # A fresh turn supersedes any in-flight reply, mirroring how a new
        # recording would. Cancel silently — the user deliberately started
        # a new turn, so no "interrupted" flash is warranted.
        if self.chat_task is not None and not self.chat_task.done():
            self.chat_task.cancel()
            try:
                await self.chat_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self.chat_task = None

        logger.info("ws text_message session=%s → %r",
                    (self.session_id or "?")[:8], text[:60])

        # Intent (workspace ops) on the typed text — same as the voice path.
        try:
            intent_result = await process_intent(text, self)
        except Exception:  # noqa: BLE001
            logger.exception("process_intent crashed — falling through to chat")
            intent_result = None
        if intent_result is not None and intent_result.handled:
            await self._emit_intent_ack(intent_result)
            return

        # Typed text is already clean — feed it to the LLM verbatim.
        self._spawn_chat(text, text)

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

    async def handle_set_voice(self, ev: dict) -> None:
        """Per-session voice override. ``provider`` selects mlx /
        dashscope route for the override (defaults to keeping the
        current TTS provider). Empty/missing ``voice`` clears the
        override back to global default."""
        voice = (ev.get("voice") or "").strip()
        provider = ev.get("provider")
        if voice:
            self.voice_override = voice
            self.tts_provider_override = (
                provider if provider in ("mlx", "dashscope") else None
            )
        else:
            self.voice_override = None
            self.tts_provider_override = None
        logger.info(
            "ws set_voice session=%s voice=%r provider=%r",
            (self.session_id or "?")[:8], self.voice_override, self.tts_provider_override,
        )
        await self.send_json({
            "type": "voice_set",
            "voice": self.voice_override,
            "provider": self.tts_provider_override,
        })

    async def handle_set_polish(self, ev: dict) -> None:
        """Per-session polish toggle. ``enabled`` bool; missing/None
        clears the override back to global ``POLISH_ENABLED``."""
        if "enabled" in ev:
            self.polish_override = bool(ev["enabled"])
        else:
            self.polish_override = None
        logger.info(
            "ws set_polish session=%s polish_override=%r",
            (self.session_id or "?")[:8], self.polish_override,
        )
        await self.send_json({
            "type": "polish_set",
            "enabled": (settings.polish.enabled if self.polish_override is None
                        else self.polish_override),
        })

    async def handle_set_workspace(self, ev: dict) -> None:
        """Per-session workspace override — for TUI hotkey + reconnect
        replay. Empty / null id clears to default (env-level).

        Does NOT reset the conversation (caller already chose this) and
        does NOT touch the workspace remotely (caller can use ws_switch
        voice intent if they want both)."""
        new_id = (ev.get("id") or "").strip() or None
        self.workspace_override = new_id
        logger.info(
            "ws set_workspace session=%s workspace=%r",
            (self.session_id or "?")[:8], new_id,
        )
        # Resolve name from cache for ack — refresh once if not loaded
        if not self.cache.loaded:
            await self.cache.refresh()
        ws = self.cache.by_id(new_id) if new_id else None
        await self.send_json({
            "type": "workspace_changed",
            "id": new_id,
            "name": (ws or {}).get("name") if ws else None,
            "intent": "set_workspace",
            "ok": True,
            "error": None,
        })

    async def handle_set_preset(self, ev: dict) -> None:
        """Switch the whole provider stack at runtime (global, no restart).
        The new providers take effect on the next recording / chat turn —
        the ASR session is built per-recording and chat reads providers per
        turn. Cancels any in-flight chat so the next turn uses the new stack.
        Switching INTO a local-MLX preset lazy-loads the model on first use
        (one-time pause)."""
        name = (ev.get("preset") or ev.get("name") or "").strip()
        try:
            apply_preset(name)
        except KeyError:
            await self.send_json({"type": "error", "where": "set_preset",
                                  "message": f"unknown preset: {name!r}"})
            return
        await self.cancel_chat("preset_switch")
        await self.send_json({"type": "preset_changed", **self._config_snapshot()})

    async def handle_refresh_workspaces(self, ev: dict) -> None:
        """Client-triggered refresh — re-fetch ablework /workspaces and
        emit a fresh workspace_list event."""
        await self._bootstrap_workspaces()

    # --- main loop ---------------------------------------------------------

    HANDLERS = {
        "hello":              "handle_hello",
        "start_recording":    "handle_start_recording",
        "stop_recording":     "handle_stop_recording",
        "interrupt":          "handle_interrupt",
        "text_message":       "handle_text_message",
        "tts":                "handle_tts",
        "reset":              "handle_reset",
        "set_voice":          "handle_set_voice",
        "set_polish":         "handle_set_polish",
        "set_workspace":      "handle_set_workspace",
        "set_preset":         "handle_set_preset",
        "refresh_workspaces": "handle_refresh_workspaces",
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
