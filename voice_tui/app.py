"""VoiceTUI — top-level Textual App that wires widgets + recorder + ws.

Thin orchestrator: no event-protocol knowledge, no audio knowledge —
those live in ws.py / recorder.py. App owns layout, hotkeys, and the
single place where state changes flow from WS events to widget reactives.

Hotkeys:

    Space  toggle record
    i      interrupt assistant
    r      reset conversation
    R      recover an interrupted draft (offered when one exists)
    v      cycle MLX voice
    V      cycle DashScope voice (Shift+v)
    p      toggle polish
    q      quit
"""

from __future__ import annotations

import asyncio
import base64
import io
import logging
import os
import time
import wave
from typing import Optional

import httpx
import numpy as np
import sounddevice as sd
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import VerticalScroll
from textual.widgets import Footer, Header

from .audio import AudioStreamer
from .config import (
    DASHSCOPE_VOICE_CYCLE,
    DEFAULT_TTS_SR,
    MIC_BLOCK,
    MIC_SR,
    MLX_VOICE_CYCLE,
    http_base_url,
    setup_logging,
)
from .devices import format_input_devices, resolve_input_device
from .models import Message
from .recorder import Recorder
from .widgets import Conversation, MicMeter, StatusBar
from .ws import WsClient

log = setup_logging()


class VoiceTUI(App):
    """Terminal client for the voice loop."""
    CSS = """
    Screen { background: $surface; }
    StatusBar { dock: top; height: 1; padding: 0 1; background: $boost; }
    Conversation { padding: 1 2; }
    MicMeter { dock: bottom; height: 1; padding: 0 1; }
    Footer { background: $boost; }
    """
    BINDINGS = [
        Binding("space", "toggle_record", "Record (Space)"),
        Binding("i",     "interrupt", "Interrupt"),
        Binding("r",     "reset",     "Reset"),
        Binding("R",     "recover",   "Recover draft"),
        Binding("v",     "cycle_voice_mlx",       "Voice ▾"),
        Binding("V",     "cycle_voice_dashscope", "Cloud voice ▾"),
        Binding("p",     "toggle_polish",         "Polish on/off"),
        Binding("q",     "quit",      "Quit"),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.tts_sr = DEFAULT_TTS_SR
        self.audio: Optional[AudioStreamer] = None
        self.recorder: Optional[Recorder] = None
        self.ws_client: Optional[WsClient] = None
        # Chat-turn timing
        self.turn_t_stop: Optional[float] = None
        self.first_audio_logged = False
        # Per-turn partial bubble index (mutated on each asr_partial)
        self.partial_user_idx: Optional[int] = None
        # Voice cycle state — index into MLX_VOICE_CYCLE (or DS_VOICE_CYCLE)
        self._mlx_voice_idx = 0
        self._ds_voice_idx = 0
        # Polish toggle (UI state — also reflected to server via set_polish)
        self._polish_enabled = True
        # Drafts available to recover (set on server-side notification)
        self._pending_drafts: list[dict] = []

    # ── layout ────────────────────────────────────────────────────────
    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        yield StatusBar(id="status")
        with VerticalScroll(id="body"):
            yield Conversation(id="conv")
        yield MicMeter(id="mic")
        yield Footer()

    # ── lifecycle ─────────────────────────────────────────────────────
    async def on_mount(self) -> None:
        conv = self.query_one("#conv", Conversation)
        conv.append_system(
            "Space 录音 · i 打断 · r 重置 · R 恢复 · v/V 换声 · p polish · q 退出"
        )
        # Mic device intro — same diagnostic as before. Helps users
        # spot virtual routing devices that PortAudio sometimes picks
        # as default but doesn't actually feed via callbacks.
        try:
            picked = resolve_input_device()
            if picked is not None:
                d = sd.query_devices(picked, kind="input")
                src = "VOICE_INPUT_DEVICE" if os.environ.get("VOICE_INPUT_DEVICE") else "VOICE_INPUT_NAME"
                conv.append_system(f"mic = #{picked} {d['name']!r}  ({src} override)")
            else:
                idx = sd.default.device[0]
                d = sd.query_devices(idx, kind="input")
                conv.append_system(
                    f"mic (PortAudio 默认 #{idx}) = {d['name']!r}  ·  "
                    f"录音 0%? 用 VOICE_INPUT_DEVICE=<idx> 或 VOICE_INPUT_NAME=<子串> 换设备 "
                    f"({format_input_devices()})"
                )
        except Exception:
            pass

        # Audio playback streamer — recreated when ready event tells us
        # the actual TTS sample rate.
        self.audio = AudioStreamer(self.tts_sr)

        # Recorder — needs the asyncio loop pinned to the App's loop.
        loop = asyncio.get_running_loop()
        mic_widget = self.query_one("#mic", MicMeter)

        def _on_level(level: float, peak: float) -> None:
            mic_widget.level = level
            mic_widget.peak = peak

        self.recorder = Recorder(loop, MIC_SR, MIC_BLOCK, _on_level)

        # WS client with our handler dispatch table.
        self.ws_client = WsClient(
            handlers={
                "ready":               self._h_ready,
                "asr_partial":         self._h_asr_partial,
                "transcript":          self._h_transcript,
                "transcript_polished": self._h_transcript_polished,
                "polish":              self._h_polish,
                "meta":                self._h_noop,
                "token":               self._h_token,
                "audio_chunk":         self._h_audio_chunk,
                "chat_done":           self._h_chat_done,
                "interrupted":         self._h_interrupted,
                "retry":               self._h_retry,
                "tts_done":            self._h_noop,
                "history_reset":       self._h_history_reset,
                "error":               self._h_error,
            },
            on_status=self._on_ws_status,
            on_drafts_available=self._on_drafts_available,
        )
        asyncio.create_task(self.ws_client.run(), name="ws-loop")
        # Background poll: AudioStreamer.busy → status.playing.
        asyncio.create_task(self._poll_playing(), name="playing-poll")

    async def on_unmount(self) -> None:
        if self.recorder is not None:
            await self.recorder.stop()
        if self.ws_client is not None:
            await self.ws_client.stop()
        if self.audio is not None:
            self.audio.close()
            self.audio = None

    # ── WS status callback ───────────────────────────────────────────
    def _on_ws_status(self, connected: bool, reconnecting: bool) -> None:
        try:
            status = self.query_one("#status", StatusBar)
        except Exception:
            return
        status.connected = connected
        status.reconnecting = reconnecting
        if not connected and not reconnecting:
            self._sys("[red]WebSocket 已断开[/red]")

    async def _on_drafts_available(self, drafts: list[dict]) -> None:
        """Server reports ``interrupted`` drafts — surface them so the
        user can press ``R`` to recover."""
        self._pending_drafts = drafts
        n = len(drafts)
        if n == 1:
            d = drafts[0]
            kb = d.get("audio_bytes", 0) // 1024
            preview = (d.get("latest_partial") or "")[:30]
            hint = f" partial=…{preview!r}" if preview else ""
            self._sys(
                f"[yellow]发现 1 条未完成录音 ({kb}KB,{d.get('started_at','?')[:16]}){hint}"
                f" — 按 [bold]R[/bold] 恢复[/yellow]"
            )
        elif n > 1:
            self._sys(
                f"[yellow]发现 {n} 条未完成录音 — 按 [bold]R[/bold] 逐条恢复(最新优先)[/yellow]"
            )

    # ── event handlers (B1 — one per server event) ───────────────────

    async def _h_noop(self, ev: dict) -> None:
        return

    async def _h_ready(self, ev: dict) -> None:
        status = self.query_one("#status", StatusBar)
        # Adjust to server's TTS sample rate if it differs.
        new_sr = int(ev.get("tts_sr", DEFAULT_TTS_SR))
        if new_sr != self.tts_sr:
            if self.audio is not None:
                self.audio.close()
            self.tts_sr = new_sr
            self.audio = AudioStreamer(self.tts_sr)
        asr_provider = ev.get("asr_provider", "?")
        llm_provider = ev.get("llm_provider", "?")
        tts_provider = ev.get("tts_provider", "?")
        tts_voice    = ev.get("tts_voice")  or "?"

        def _tag(label: str, provider: str) -> str:
            if provider in ("dashscope",):
                tag = "cloud"
            elif provider in ("ablework", "ollama"):
                tag = provider
            else:
                tag = "local"
            return label if tag.lower() == label.lower() else f"{label} ({tag})"

        status.asr_info = _tag(self._short(ev.get("asr_model_id", "?")), asr_provider)
        status.llm_info = _tag(self._short(ev.get("llm_model_id", "?")), llm_provider)
        status.tts_info = _tag(tts_voice, tts_provider)
        # Initialise voice cycle index to whatever server is using.
        try:
            if tts_provider == "mlx" and tts_voice in MLX_VOICE_CYCLE:
                self._mlx_voice_idx = MLX_VOICE_CYCLE.index(tts_voice)
            elif tts_provider == "dashscope" and tts_voice in DASHSCOPE_VOICE_CYCLE:
                self._ds_voice_idx = DASHSCOPE_VOICE_CYCLE.index(tts_voice)
        except ValueError:
            pass
        self._sys(
            f"server ready: ASR={status.asr_info} · "
            f"LLM={status.llm_info} · TTS={status.tts_info} @ {self.tts_sr}Hz"
        )

    async def _h_asr_partial(self, ev: dict) -> None:
        text = ev.get("text", "")
        conv = self.query_one("#conv", Conversation)
        if self.partial_user_idx is not None and 0 <= self.partial_user_idx < len(conv.messages):
            conv.replace_at(self.partial_user_idx,
                            text=text, info="(实时识别…)", streaming=True)
        else:
            idx = conv.append(Message("user", text, info="(实时识别…)", streaming=True))
            self.partial_user_idx = idx

    async def _h_transcript(self, ev: dict) -> None:
        conv = self.query_one("#conv", Conversation)
        text = ev.get("text", "") or "(空)"
        info = f"ASR {ev.get('ms', 0)}ms · {ev.get('audio_bytes', 0)//1024}KB"
        if self.partial_user_idx is not None and 0 <= self.partial_user_idx < len(conv.messages):
            conv.replace_at(self.partial_user_idx,
                            text=text, info=info, streaming=False)
        else:
            conv.append(Message("user", text, info=info))
        # NOTE: don't clear partial_user_idx yet — transcript_polished
        # event arrives next and we want to mutate the same bubble.
        # Prepare assistant bubble that will fill via tokens.
        conv.append(Message("assistant", "", info="", streaming=True))
        status = self.query_one("#status", StatusBar)
        # Phase transition: ASR done → polish window opens.
        status.finalizing = False
        # Server emits transcript_polished within ~15ms-1.5s of transcript;
        # only show the polishing chip if the user has polish enabled
        # (otherwise the chip would briefly flash for a no-op).
        if status.polish_enabled:
            status.polishing = True
        status.chatting = True
        self.first_audio_logged = False

    async def _h_transcript_polished(self, ev: dict) -> None:
        """Replace the user bubble text with the polished version
        (raw is preserved on the Message for "原:" line render).
        If polish was skipped or unchanged, we leave the bubble alone."""
        conv = self.query_one("#conv", Conversation)
        status = self.query_one("#status", StatusBar)
        status.polishing = False
        polished = ev.get("text", "")
        raw = ev.get("raw", "")
        if ev.get("skipped"):
            self.partial_user_idx = None
            return
        # Find the user bubble for this transcript — most recently
        # appended user bubble (partial_user_idx may already be cleared
        # if h_transcript appended a new one).
        idx = self.partial_user_idx
        if idx is None:
            # Search backwards for the latest user message.
            for i in range(len(conv.messages) - 1, -1, -1):
                if conv.messages[i].role == "user":
                    idx = i
                    break
        if idx is not None:
            ms = ev.get("ms", 0)
            ok = ev.get("ok", True)
            tag = f"polish {ms}ms" + ("" if ok else " ⚠")
            current_info = conv.messages[idx].info or ""
            new_info = f"{current_info} · {tag}" if current_info else tag
            conv.replace_at(idx, text=polished, info=new_info, raw=raw)
        self.partial_user_idx = None

    async def _h_polish(self, ev: dict) -> None:
        """Server emitted ``polish`` event during chat — shows "整理中"
        indicator. Same payload as transcript_polished but emitted by
        chat.run_chat_pipeline when /chat (SSE) polishes inline."""
        status = self.query_one("#status", StatusBar)
        status.polishing = bool(ev.get("skipped") is False)

    async def _h_token(self, ev: dict) -> None:
        conv = self.query_one("#conv", Conversation)
        conv.append_to_streaming_assistant(ev.get("delta", ""))

    async def _h_audio_chunk(self, ev: dict) -> None:
        if self.audio is None:
            return
        samples = self._decode_wav_b64(ev.get("b64", ""))
        self.audio.enqueue(samples)
        if not self.first_audio_logged and self.turn_t_stop is not None:
            ms = int((time.monotonic() - self.turn_t_stop) * 1000)
            self.query_one("#status", StatusBar).last_first_audio_ms = ms
            self.first_audio_logged = True

    async def _h_chat_done(self, ev: dict) -> None:
        conv = self.query_one("#conv", Conversation)
        n_audio = ev.get("n_audio", 0)
        conv.finalize_streaming_assistant(
            info=f"{ev.get('total_ms', 0)}ms · {n_audio} TTS 段",
        )
        status = self.query_one("#status", StatusBar)
        status.chatting = False
        status.polishing = False
        status.last_total_ms = ev.get("total_ms", 0)

    async def _h_interrupted(self, ev: dict) -> None:
        conv = self.query_one("#conv", Conversation)
        conv.finalize_streaming_assistant(
            info=f"interrupted ({ev.get('reason','?')})",
            suffix="  [⏹ 打断]",
        )
        # Stop playback of the cancelled reply.
        if self.audio is not None:
            self.audio.clear()
        status = self.query_one("#status", StatusBar)
        status.chatting = False
        status.polishing = False
        self.partial_user_idx = None

    async def _h_retry(self, ev: dict) -> None:
        """Server retried a transient upstream failure (5xx / connection
        reset). Show it inline so the user understands the brief stall."""
        where = ev.get("where", "?")
        attempt = ev.get("attempt", "?")
        maxn = ev.get("max_attempts", "?")
        reason = ev.get("reason", "")
        wait_ms = ev.get("wait_ms", 0)
        # Truncate reason in case the server returned an HTML 502 page
        # — first line is usually enough to diagnose.
        short_reason = reason.split("\n", 1)[0][:80]
        self._sys(
            f"[yellow]⟳ {where} 重试 {attempt}/{maxn} ({wait_ms}ms 后)"
            f"  原因:{short_reason}[/yellow]"
        )

    async def _h_history_reset(self, ev: dict) -> None:
        conv = self.query_one("#conv", Conversation)
        conv.messages = [Message(
            "system", f"对话已清空 (server 端 {ev.get('cleared',0)} 条 drop)"
        )]
        status = self.query_one("#status", StatusBar)
        status.last_first_audio_ms = 0
        status.last_total_ms = 0

    async def _h_error(self, ev: dict) -> None:
        self._sys(f"[red][{ev.get('where','?')}] {ev.get('message','')}[/red]")
        status = self.query_one("#status", StatusBar)
        status.chatting = False
        status.polishing = False

    # ── helpers ──────────────────────────────────────────────────────

    def _sys(self, text: str) -> None:
        try:
            self.query_one("#conv", Conversation).append_system(text)
        except Exception:
            pass

    @staticmethod
    def _short(model_id: str) -> str:
        return model_id.rsplit("/", 1)[-1]

    @staticmethod
    def _decode_wav_b64(b64: str) -> np.ndarray:
        raw = base64.b64decode(b64)
        with wave.open(io.BytesIO(raw), "rb") as wf:
            n = wf.getnframes()
            pcm = wf.readframes(n)
        return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0

    # ── playback poll ────────────────────────────────────────────────
    async def _poll_playing(self) -> None:
        try:
            status = self.query_one("#status", StatusBar)
        except Exception:
            return
        while True:
            await asyncio.sleep(0.1)
            if self.audio is None:
                continue
            new = self.audio.busy
            if new != status.playing:
                status.playing = new

    # ── actions (hotkeys) ────────────────────────────────────────────

    def action_toggle_record(self) -> None:
        if self.recorder is None:
            return
        if not self.recorder.active:
            asyncio.create_task(self._start_recording())
        else:
            asyncio.create_task(self._stop_recording())

    async def _start_recording(self) -> None:
        if self.ws_client is None or not self.ws_client.is_open:
            self._sys("[red]WS 未连接,无法录音[/red]")
            return
        # Implicit interrupt — server will cancel any in-flight chat.
        if self.audio is not None:
            self.audio.clear()

        status = self.query_one("#status", StatusBar)
        mic = self.query_one("#mic", MicMeter)
        mic.peak = 0.0
        mic.level = 0.0
        mic.t_started = time.monotonic()
        mic.visible = True
        status.recording = True

        await self.ws_client.send_json({"type": "start_recording", "sample_rate": MIC_SR})
        try:
            await self.recorder.start(self.ws_client.send_bytes)
        except Exception as exc:
            self._sys(f"[red]mic 启动失败:{exc}[/red]")
            status.recording = False
            mic.visible = False
            return
        self.turn_t_stop = None

    async def _stop_recording(self) -> None:
        if self.recorder is None or not self.recorder.active:
            return
        peak = await self.recorder.stop()
        status = self.query_one("#status", StatusBar)
        mic = self.query_one("#mic", MicMeter)
        status.recording = False
        mic.visible = False
        mic.level = 0.0
        mic.t_started = 0.0
        self.turn_t_stop = time.monotonic()
        # ASR finalize on long recordings can take 5-6s — show a
        # dedicated "识别中" state for that window. polishing is set
        # ONLY between transcript and transcript_polished (handled by
        # _h_transcript) so the user sees the actual phase progression
        # instead of one stuck label.
        status.finalizing = True
        if self.ws_client is not None and self.ws_client.is_open:
            await self.ws_client.send_json({
                "type": "stop_recording",
                "peak_level": round(peak, 4),
            })
            status.last_first_audio_ms = 0

    def action_interrupt(self) -> None:
        if self.ws_client is None:
            return
        asyncio.create_task(self.ws_client.send_json({"type": "interrupt"}))
        if self.audio is not None:
            self.audio.clear()

    def action_reset(self) -> None:
        if self.ws_client is None:
            return
        asyncio.create_task(self.ws_client.send_json({"type": "interrupt"}))
        asyncio.create_task(self.ws_client.send_json({"type": "reset"}))
        if self.audio is not None:
            self.audio.clear()

    def action_recover(self) -> None:
        """Recover the most recent interrupted draft via /drafts/{id}/recover.
        Pulls fresh from the server in case the queue moved since the
        notification."""
        asyncio.create_task(self._recover_next_draft())

    async def _recover_next_draft(self) -> None:
        # Pull fresh draft list — the cached one may be stale if other
        # clients also recovered some.
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(f"{http_base_url()}/drafts?status=interrupted")
                r.raise_for_status()
                drafts = r.json()
        except Exception as exc:
            self._sys(f"[red]拉 drafts 失败:{exc}[/red]")
            return
        if not drafts:
            self._sys("没有可恢复的录音")
            self._pending_drafts = []
            return
        d = drafts[0]
        draft_id = d["id"]
        self._sys(f"[yellow]恢复中 draft={draft_id[:8]}…[/yellow]")
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                rr = await client.post(f"{http_base_url()}/drafts/{draft_id}/recover")
                rr.raise_for_status()
                t = rr.json()
        except Exception as exc:
            self._sys(f"[red]recover 失败:{exc}[/red]")
            return
        text = (t.get("text") or "").strip() or "(空)"
        ms = t.get("ms", 0)
        self._sys(f"[green]✓ recovered:[/green] {text!r} ({ms}ms)")
        # Refresh pending state — if more drafts exist, log a hint.
        self._pending_drafts = drafts[1:]
        if self._pending_drafts:
            self._sys(f"还剩 {len(self._pending_drafts)} 条可继续按 R")

    def action_cycle_voice_mlx(self) -> None:
        if not MLX_VOICE_CYCLE:
            return
        self._mlx_voice_idx = (self._mlx_voice_idx + 1) % len(MLX_VOICE_CYCLE)
        voice = MLX_VOICE_CYCLE[self._mlx_voice_idx]
        asyncio.create_task(self._set_voice(voice, provider="mlx"))

    def action_cycle_voice_dashscope(self) -> None:
        if not DASHSCOPE_VOICE_CYCLE:
            return
        self._ds_voice_idx = (self._ds_voice_idx + 1) % len(DASHSCOPE_VOICE_CYCLE)
        voice = DASHSCOPE_VOICE_CYCLE[self._ds_voice_idx]
        asyncio.create_task(self._set_voice(voice, provider="dashscope"))

    async def _set_voice(self, voice: str, *, provider: str) -> None:
        if self.ws_client is None:
            return
        await self.ws_client.send_json({
            "type": "set_voice", "voice": voice, "provider": provider,
        })
        self._sys(f"[cyan]→ voice = {voice} ({provider})[/cyan]")
        # Update status bar optimistically; server's next ready/chat
        # cycle will confirm.
        try:
            self.query_one("#status", StatusBar).tts_info = (
                voice if provider == "mlx" else f"{voice} (cloud)"
            )
        except Exception:
            pass

    def action_toggle_polish(self) -> None:
        self._polish_enabled = not self._polish_enabled
        asyncio.create_task(self._set_polish(self._polish_enabled))

    async def _set_polish(self, enabled: bool) -> None:
        if self.ws_client is None:
            return
        await self.ws_client.send_json({
            "type": "set_polish", "enabled": enabled,
        })
        try:
            self.query_one("#status", StatusBar).polish_enabled = enabled
        except Exception:
            pass
        self._sys(f"[cyan]polish = {'on' if enabled else 'off'}[/cyan]")
