"""Terminal voice client for voice-asr-test.

Same wire protocol as the browser UI (/ws), just driven from a terminal:

  Space  press to start/stop recording (toggle, not hold — terminals
         don't reliably tell you when a key is *released*)
  i      interrupt the assistant's current reply
  r      reset conversation history
  q      quit

Audio I/O via sounddevice: mic → 16 kHz int16 PCM → WebSocket binary;
incoming audio_chunk events → base64 WAV → numpy → sequential playback
through the default output device.

Run:
    ./tui.py                # server must already be up on :8501
    SERVER_URL=ws://localhost:8501/ws ./tui.py
"""
#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import base64
import collections
import io
import json
import logging
import os
import queue
import threading
import time
import uuid
import wave

# File-based debug logging — textual owns the screen so prints/log
# would corrupt the UI. ``tail -f /tmp/voice-tui.log`` in another
# terminal to watch live. Toggle off with VOICE_TUI_DEBUG=0.
_LOG_PATH = os.environ.get("VOICE_TUI_LOG", "/tmp/voice-tui.log")
logging.basicConfig(
    filename=_LOG_PATH,
    level=logging.DEBUG if os.environ.get("VOICE_TUI_DEBUG", "1") != "0" else logging.WARNING,
    format="%(asctime)s.%(msecs)03d [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    filemode="w",  # truncate on each run so logs match the current session
)
log = logging.getLogger("tui")

import numpy as np
import sounddevice as sd
import websockets
from rich.console import Group
from rich.panel import Panel
from rich.text import Text
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import VerticalScroll
from textual.reactive import reactive
from textual.widgets import Footer, Header, Static

SERVER_URL = os.environ.get("SERVER_URL", "ws://127.0.0.1:8501/ws")
MIC_SR = 16000           # what the server's ASR wants
MIC_BLOCK = 800          # 50ms @ 16kHz, matches the AudioWorklet on the browser
# Output sample rate is delivered by the server in the "ready" event,
# defaults to 24kHz (Qwen3-TTS) — we update on connect.

class AudioStreamer:
    """Gap-free audio playback for chunked TTS.

    The previous implementation called ``sd.play(samples, blocking=True)``
    per chunk inside a worker thread. Each call opened a fresh
    OutputStream, wrote the samples, and tore it down — costing ~20-50ms
    setup overhead between chunks AND giving the OS audio engine a brief
    underrun, both of which the user perceived as a "⏸" between
    sentences.

    Here we keep one persistent OutputStream running; new chunks are
    appended to a thread-safe deque and the audio-thread callback
    consumes from it continuously, padding with zeros when empty. Joining
    two consecutive chunks now adds zero scheduling latency — only the
    silence that's actually present inside the audio data itself (which
    we trim server-side).
    """
    def __init__(self, sample_rate: int):
        self._sr = sample_rate
        self._buf = collections.deque()         # of np.ndarray float32 mono
        self._cur: np.ndarray | None = None
        self._cur_pos = 0
        self._lock = threading.Lock()
        self._stream = sd.OutputStream(
            samplerate=sample_rate, channels=1, dtype="float32",
            blocksize=512, callback=self._callback,
        )
        self._stream.start()

    def _callback(self, outdata, frames, time_info, status):
        out = outdata[:, 0]
        out.fill(0.0)
        written = 0
        with self._lock:
            while written < frames:
                if self._cur is None:
                    if not self._buf:
                        break
                    self._cur = self._buf.popleft()
                    self._cur_pos = 0
                remaining = self._cur.shape[0] - self._cur_pos
                take = min(remaining, frames - written)
                out[written:written+take] = self._cur[self._cur_pos:self._cur_pos+take]
                self._cur_pos += take
                written += take
                if self._cur_pos >= self._cur.shape[0]:
                    self._cur = None

    def enqueue(self, samples: np.ndarray) -> None:
        with self._lock:
            self._buf.append(samples)

    def clear(self) -> None:
        """Stop playback immediately (interrupt / new recording)."""
        with self._lock:
            self._buf.clear()
            self._cur = None
            self._cur_pos = 0

    @property
    def busy(self) -> bool:
        with self._lock:
            return self._cur is not None or len(self._buf) > 0

    def close(self) -> None:
        try:
            self._stream.stop(); self._stream.close()
        except Exception:
            pass


def _resolve_input_device() -> int | None:
    """Pick the audio input device.

    Default behaviour: return None so sounddevice uses PortAudio's
    default, which on macOS follows the system Sound Settings choice.
    Users manage their mic via macOS Sound Settings — TUI doesn't
    second-guess.

    Escape hatches (highest priority first):
      1. ``VOICE_INPUT_DEVICE=<index>``  — explicit index
      2. ``VOICE_INPUT_NAME=<substring>`` — first input-capable device
         whose name contains the substring (case-insensitive). Useful
         when Bluetooth reconnects shuffle indices.
    """
    explicit = os.environ.get("VOICE_INPUT_DEVICE")
    if explicit and explicit.lstrip("-").isdigit():
        return int(explicit)
    name_pat = os.environ.get("VOICE_INPUT_NAME")
    if name_pat:
        needle = name_pat.lower()
        try:
            for i, d in enumerate(sd.query_devices()):
                if d.get("max_input_channels", 0) > 0 and needle in d["name"].lower():
                    return i
        except Exception:
            pass
    return None


def _format_input_devices() -> str:
    """Compact ``#0 name | #4 name | …`` listing of all input-capable
    devices, so the user can see what indices are available without
    leaving the TUI."""
    try:
        out = []
        for i, d in enumerate(sd.query_devices()):
            if d.get("max_input_channels", 0) > 0:
                out.append(f"#{i} {d['name']}")
        return " | ".join(out)
    except Exception:
        return "?"


# ──────────────────────────────────────────────────────────────────────────
# Conversation model
# ──────────────────────────────────────────────────────────────────────────

class Message:
    """One row in the conversation panel."""
    __slots__ = ("role", "text", "info", "streaming")

    def __init__(self, role: str, text: str = "", info: str = "", streaming: bool = False):
        self.role = role            # "user" | "assistant" | "system"
        self.text = text
        self.info = info            # small dim tagline ("ASR 312ms" etc.)
        self.streaming = streaming  # render a caret if assistant is still typing


# ──────────────────────────────────────────────────────────────────────────
# TUI widgets
# ──────────────────────────────────────────────────────────────────────────

class StatusBar(Static):
    """Top bar — shows connection state, current mode, latency telemetry."""
    connected = reactive(False)
    recording = reactive(False)
    chatting = reactive(False)
    playing = reactive(False)
    asr_info = reactive("")
    llm_info = reactive("")
    tts_info = reactive("")
    last_first_audio_ms = reactive(0)
    last_total_ms = reactive(0)

    def on_mount(self) -> None:
        # 8 fps spinner — only refresh when there's an active state to
        # animate. Cheap when idle.
        self.set_interval(1 / 8, self._maybe_refresh)

    def _maybe_refresh(self) -> None:
        if self.chatting or self.recording:
            self.refresh()

    def render(self):
        t = Text()
        spin = _SPINNER_FRAMES[int(time.monotonic() * 8) % len(_SPINNER_FRAMES)]
        # connection chip
        if not self.connected:
            t.append(" ● 未连接 ", style="bold red on red dim")
        elif self.recording:
            t.append(f" {spin} 录音中 ", style="bold black on yellow")
        elif self.chatting:
            label = f" {spin} 播放中 " if self.playing else f" {spin} 思考/合成中 "
            t.append(label, style="bold black on green")
        else:
            t.append(" ✓ 就绪 ", style="bold black on cyan")
        t.append("  ", style="")
        # models
        t.append("ASR ", style="dim"); t.append(self.asr_info or "?", style="cyan")
        t.append("  LLM ", style="dim"); t.append(self.llm_info or "?", style="cyan")
        t.append("  TTS ", style="dim"); t.append(self.tts_info or "?", style="cyan")
        # latency
        if self.last_first_audio_ms:
            t.append("  ★首音 ", style="dim")
            t.append(f"{self.last_first_audio_ms}ms", style="bold green")
        if self.last_total_ms:
            t.append("  total ", style="dim")
            t.append(f"{self.last_total_ms}ms", style="green")
        return t


# Braille spinner — clean motion in a single cell. 10 frames at ~8fps
# gives a smooth rotation that's obviously moving without being noisy.
_SPINNER_FRAMES = ("⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏")


class Conversation(Static):
    """Scrolling conversation history rendered as stacked panels."""
    # ``always_update=True`` is required because we mutate Message objects
    # in place (e.g. ``m.text += delta``) and reassign the list — without
    # it, textual's default == comparison sees no change and skips the
    # render, so streaming tokens never visibly arrive.
    messages: list[Message] = reactive(list, layout=True, always_update=True)

    def on_mount(self) -> None:
        # Tick 8 times per second to drive the "AI thinking" spinner. We
        # only call refresh() when there's actually a streaming-with-no-
        # text bubble to animate, so this stays cheap when idle.
        self.set_interval(1 / 8, self._spinner_tick)

    def _spinner_tick(self) -> None:
        for m in self.messages:
            if m.role == "assistant" and m.streaming and not m.text:
                self.refresh()
                return
            if m.role == "user" and m.streaming and not m.text:
                self.refresh()
                return

    def watch_messages(self, _old, _new) -> None:
        # Auto-scroll the enclosing VerticalScroll to the bottom whenever
        # messages mutate (new bubble OR token appended to an existing
        # bubble). call_after_refresh defers to the next paint so the
        # scroll target reflects the just-rendered size, not the previous.
        scroll = self.parent
        if scroll is not None and hasattr(scroll, "scroll_end"):
            self.call_after_refresh(scroll.scroll_end, animate=False)

    def _spinner(self) -> str:
        return _SPINNER_FRAMES[int(time.monotonic() * 8) % len(_SPINNER_FRAMES)]

    def render(self):
        renderables = []
        frame = self._spinner()
        for m in self.messages:
            if m.role == "user":
                cursor = "  [blink]▮[/blink]" if m.streaming else ""
                title = f"[bold cyan]你[/bold cyan]{cursor}"
                if m.info: title += f"  [dim]{m.info}[/dim]"
                if m.streaming and not m.text:
                    # Listening for first ASR partial — animated dot.
                    body = Text.from_markup(f"[cyan]{frame}[/cyan] [dim italic]听…[/dim italic]")
                else:
                    body = Text(m.text or "(empty)")
                renderables.append(Panel(
                    body, title=title, title_align="left",
                    border_style="cyan", padding=(0, 1),
                ))
            elif m.role == "assistant":
                cursor = "  [blink]▮[/blink]" if m.streaming else ""
                title = f"[bold green]AI[/bold green]{cursor}"
                if m.info: title += f"  [dim]{m.info}[/dim]"
                if m.streaming and not m.text:
                    # Pre-first-token: animated spinner + label so the
                    # ablework agent's 5s RAG/tool latency feels alive
                    # instead of frozen.
                    body = Text.from_markup(
                        f"[green]{frame}[/green] [dim italic]AI 思考中…[/dim italic]"
                    )
                else:
                    body = Text(m.text or "(empty)")
                renderables.append(Panel(
                    body, title=title, title_align="left",
                    border_style="green", padding=(0, 1),
                ))
            else:  # system
                renderables.append(Text(f"  · {m.text}", style="dim italic"))
        return Group(*renderables) if renderables else Text("")


class MicMeter(Static):
    """Live mic level bar — visible only while recording."""
    level = reactive(0.0)
    peak = reactive(0.0)
    visible = reactive(False)

    def render(self):
        if not self.visible:
            return Text("")
        bar_width = 40
        filled = int(min(1.0, self.level * 3.0) * bar_width)
        bar = "█" * filled + "░" * (bar_width - filled)
        if self.level < 0.02:
            colour = "red"
        elif self.level < 0.08:
            colour = "yellow"
        else:
            colour = "green"
        t = Text()
        t.append("  mic ", style="dim")
        t.append(bar, style=colour)
        t.append(f"  {self.level*100:5.1f}%  peak {self.peak*100:4.0f}%", style="dim")
        if self.level < 0.02:
            t.append("  ← 没采到声音", style="bold red")
        return t


# ──────────────────────────────────────────────────────────────────────────
# App
# ──────────────────────────────────────────────────────────────────────────

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
        Binding("i", "interrupt", "Interrupt"),
        Binding("r", "reset", "Reset"),
        Binding("q", "quit", "Quit"),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.session_id = uuid.uuid4().hex
        # websockets v16 ClientConnection — typed loosely so we don't pin
        self.ws = None
        self.loop: asyncio.AbstractEventLoop | None = None

        # Recording
        self.input_stream: sd.InputStream | None = None
        self.pcm_thread_q: queue.Queue = queue.Queue()   # callback → main loop
        self.pcm_sender_task: asyncio.Task | None = None
        self._mic_peak = 0.0

        # Playback — persistent OutputStream + ring buffer (see
        # AudioStreamer class for why this beats sd.play() per chunk).
        self.tts_sr = 24000
        self.audio: AudioStreamer | None = None  # created on first ready event

        # Chat-turn timing
        self.turn_t_stop: float | None = None
        self.first_audio_logged = False
        # Index of the in-progress user-partial entry in conv.messages,
        # so asr_partial events can mutate the same bubble instead of
        # appending a new one each time. Set on first partial, cleared
        # when transcript finalizes (or recording cancels).
        self.partial_user_idx: int | None = None

    # ── layout ────────────────────────────────────────────────────────
    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        yield StatusBar(id="status")
        # VerticalScroll wraps the conversation so it scrolls when it
        # overflows the window. Auto-scroll-to-bottom on new messages
        # is wired below via watch_messages → scroll_end().
        with VerticalScroll(id="body"):
            yield Conversation(id="conv")
        yield MicMeter(id="mic")
        yield Footer()

    # ── lifecycle ─────────────────────────────────────────────────────
    async def on_mount(self) -> None:
        self.loop = asyncio.get_running_loop()
        intro = [Message("system",
            "Space 开始/停止录音 · i 打断 · r 重置 · q 退出  ·  "
            "音频走默认输入/输出设备(sounddevice)")]

        # Surface mic device choice prominently — virtual routing devices
        # (Loopback, SoundSource, Audio Hijack, etc.) often default in
        # PortAudio but silently return zero on callback streams. The user
        # can override with VOICE_INPUT_DEVICE=<index>.
        try:
            picked = _resolve_input_device()
            if picked is not None:
                d = sd.query_devices(picked, kind="input")
                src = "VOICE_INPUT_DEVICE" if os.environ.get("VOICE_INPUT_DEVICE") else "VOICE_INPUT_NAME"
                intro.append(Message("system",
                    f"mic = #{picked} {d['name']!r}  ({src} override)"))
            else:
                idx = sd.default.device[0]
                d = sd.query_devices(idx, kind="input")
                intro.append(Message("system",
                    f"mic (PortAudio 默认 #{idx}) = {d['name']!r}  ·  "
                    f"录音 0%? 用 VOICE_INPUT_DEVICE=<idx> 或 VOICE_INPUT_NAME=<子串> 换设备 "
                    f"({_format_input_devices()})"))
        except Exception:
            pass

        self.query_one("#conv", Conversation).messages = intro
        asyncio.create_task(self._connect_and_read(), name="ws")
        # AudioStreamer is created when we know the server's TTS sample
        # rate (delivered in the ready event). For now leave a default
        # 24kHz one so a one-shot TTS test before ready still plays.
        self.audio = AudioStreamer(self.tts_sr)
        # Light-touch task: poll AudioStreamer.busy to drive status.playing.
        asyncio.create_task(self._poll_playing(), name="playing-poll")

    async def on_unmount(self) -> None:
        await self._stop_recording_audio(send_stop=False)
        if self.ws is not None:
            try: await self.ws.close()
            except Exception: pass
        if self.audio is not None:
            self.audio.close()
            self.audio = None

    # ── WebSocket ────────────────────────────────────────────────────
    async def _connect_and_read(self) -> None:
        status = self.query_one("#status", StatusBar)
        try:
            self.ws = await websockets.connect(SERVER_URL)
        except Exception as exc:
            self._sys(f"[red]WS 连接失败:{exc}[/red]")
            return
        await self.ws.send(json.dumps({"type": "hello", "session_id": self.session_id}))
        status.connected = True

        try:
            async for raw in self.ws:
                if not isinstance(raw, str):
                    continue
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                await self._handle_event(msg)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            status.connected = False
            self._sys("[red]WebSocket 已断开[/red]")

    async def _handle_event(self, ev: dict) -> None:
        status = self.query_one("#status", StatusBar)
        conv = self.query_one("#conv", Conversation)
        t = ev.get("type")

        if t == "ready":
            new_sr = int(ev.get("tts_sr", 24000))
            if new_sr != self.tts_sr:
                # Sample rate changed (e.g. different TTS model) — rebuild
                # the streamer on the new rate.
                if self.audio is not None: self.audio.close()
                self.tts_sr = new_sr
                self.audio = AudioStreamer(self.tts_sr)
            asr_provider = ev.get("asr_provider", "?")
            llm_provider = ev.get("llm_provider", "?")
            tts_provider = ev.get("tts_provider", "?")
            tts_voice    = ev.get("tts_voice")  or "?"

            def _tag(label: str, provider: str, *, local_label="local",
                     cloud_label="cloud", provider_tag_for=("dashscope", "ablework", "ollama")) -> str:
                # Decide the parenthetical tag for a model row:
                #  - "(cloud)" when the model itself doesn't already
                #    name the provider (e.g. "qwen3.7-max (cloud)")
                #  - "(local)" for everything else (mlx, etc.)
                #  - skip the tag entirely if it would duplicate the
                #    model name (e.g. "ablework (ablework)" → just
                #    "ablework")
                if provider in provider_tag_for:
                    tag = cloud_label if provider == "dashscope" else provider
                else:
                    tag = local_label
                if tag.lower() == label.lower():
                    return label
                return f"{label} ({tag})"

            status.asr_info = _tag(self._short(ev.get("asr_model_id", "?")), asr_provider)
            status.llm_info = _tag(self._short(ev.get("llm_model_id", "?")), llm_provider)
            status.tts_info = _tag(tts_voice, tts_provider)
            self._sys(
                f"server ready: ASR={status.asr_info} · "
                f"LLM={status.llm_info} · TTS={status.tts_info} @ {self.tts_sr}Hz"
            )
            return

        if t == "asr_partial":
            # Live transcription — replace the in-progress user bubble
            # text (or create one on the very first partial).
            text = ev.get("text", "")
            msgs = list(conv.messages)
            if self.partial_user_idx is not None and 0 <= self.partial_user_idx < len(msgs):
                msgs[self.partial_user_idx].text = text
                msgs[self.partial_user_idx].info = "(实时识别…)"
                msgs[self.partial_user_idx].streaming = True
            else:
                msgs.append(Message("user", text, info="(实时识别…)", streaming=True))
                self.partial_user_idx = len(msgs) - 1
            conv.messages = msgs
            return

        if t == "transcript":
            text = ev.get("text", "") or "(空)"
            info = f"ASR {ev.get('ms', 0)}ms · {ev.get('audio_bytes', 0)//1024}KB"
            msgs = list(conv.messages)
            # If we had a partial bubble, finalize it in-place instead of
            # appending a duplicate.
            if self.partial_user_idx is not None and 0 <= self.partial_user_idx < len(msgs):
                msgs[self.partial_user_idx].text = text
                msgs[self.partial_user_idx].info = info
                msgs[self.partial_user_idx].streaming = False
            else:
                msgs.append(Message("user", text, info=info))
            self.partial_user_idx = None
            # Prepare the assistant bubble that will fill via tokens
            msgs.append(Message("assistant", "", info="", streaming=True))
            conv.messages = msgs
            status.chatting = True
            self.first_audio_logged = False
            return

        if t == "meta":
            return

        if t == "token":
            delta = ev.get("delta", "")
            msgs = list(conv.messages)
            for m in reversed(msgs):
                if m.role == "assistant" and m.streaming:
                    m.text += delta
                    break
            conv.messages = msgs  # trigger re-render
            return

        if t == "audio_chunk":
            b64 = ev.get("b64", "")
            samples = self._decode_wav_b64(b64)
            if self.audio is not None:
                self.audio.enqueue(samples)
            if not self.first_audio_logged and self.turn_t_stop is not None:
                ms = int((time.monotonic() - self.turn_t_stop) * 1000)
                status.last_first_audio_ms = ms
                self.first_audio_logged = True
            return

        if t == "chat_done":
            msgs = list(conv.messages)
            for m in reversed(msgs):
                if m.role == "assistant" and m.streaming:
                    m.streaming = False
                    n_audio = ev.get("n_audio", 0)
                    m.info = f"{ev.get('total_ms', 0)}ms · {n_audio} TTS 段"
                    break
            conv.messages = msgs
            status.chatting = False
            status.last_total_ms = ev.get("total_ms", 0)
            return

        if t == "interrupted":
            msgs = list(conv.messages)
            for m in reversed(msgs):
                if m.role == "assistant" and m.streaming:
                    m.streaming = False
                    m.text = (m.text or "") + "  [⏹ 打断]"
                    m.info = f"interrupted ({ev.get('reason','?')})"
                    break
            conv.messages = msgs
            # Drain pending audio so we stop playing the cancelled reply.
            self._clear_player_queue()
            status.chatting = False
            # If the interrupt came from a new recording, the partial
            # bubble for the next utterance hasn't started yet — clear
            # any stale index. (No-op if already cleared.)
            self.partial_user_idx = None
            return

        if t == "tts_done":
            return

        if t == "history_reset":
            conv.messages = [Message("system",
                f"对话已清空 (server 端 {ev.get('cleared',0)} 条 drop)")]
            status.last_first_audio_ms = 0
            status.last_total_ms = 0
            return

        if t == "error":
            self._sys(f"[red][{ev.get('where','?')}] {ev.get('message','')}[/red]")
            status.chatting = False
            return

    def _sys(self, text: str) -> None:
        # Guarded: during teardown the widget tree may already be gone.
        try:
            conv = self.query_one("#conv", Conversation)
        except Exception:
            return
        msgs = list(conv.messages)
        msgs.append(Message("system", text))
        conv.messages = msgs

    @staticmethod
    def _short(model_id: str) -> str:
        return model_id.rsplit("/", 1)[-1]

    def _ws_open(self) -> bool:
        """``websockets`` v16 dropped the ``.closed`` shortcut, so we
        peek at the connection state enum directly."""
        if self.ws is None:
            return False
        try:
            from websockets.protocol import State  # noqa: PLC0415
            return self.ws.state is State.OPEN
        except Exception:
            return True  # best-effort; let send raise if it's wrong

    @staticmethod
    def _decode_wav_b64(b64: str) -> np.ndarray:
        raw = base64.b64decode(b64)
        with wave.open(io.BytesIO(raw), "rb") as wf:
            n = wf.getnframes()
            pcm = wf.readframes(n)
        arr = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        return arr  # mono float32 [-1, 1]

    # ── audio playback ───────────────────────────────────────────────
    async def _poll_playing(self) -> None:
        """Update status.playing from the AudioStreamer.busy flag.
        Cheap poll (10Hz) is fine — this is just UI state, no audio
        decisions depend on it."""
        try:
            status = self.query_one("#status", StatusBar)
        except Exception:
            return
        while True:
            await asyncio.sleep(0.1)
            if self.audio is None: continue
            new = self.audio.busy
            if new != status.playing:
                status.playing = new

    def _clear_player_queue(self) -> None:
        """Compat shim (older call sites still use this name)."""
        if self.audio is not None:
            self.audio.clear()

    # ── recording ────────────────────────────────────────────────────
    def action_toggle_record(self) -> None:
        if self.input_stream is None:
            asyncio.create_task(self._start_recording())
        else:
            asyncio.create_task(self._stop_recording_audio(send_stop=True))

    async def _start_recording(self) -> None:
        log.info("_start_recording called")
        if self.ws is None:
            self._sys("[red]WS 未连接,无法录音[/red]")
            log.warning("ws is None at start_recording")
            return
        # Implicit interrupt — server will cancel any in-flight chat.
        self._clear_player_queue()

        status = self.query_one("#status", StatusBar)
        mic = self.query_one("#mic", MicMeter)
        self._mic_peak = 0.0
        mic.peak = 0.0
        mic.level = 0.0
        mic.visible = True
        status.recording = True

        loop = asyncio.get_running_loop()
        log.info("captured loop=%r", loop)
        self._cb_count = 0
        self._cb_nonzero = 0
        self._cb_first_t = None
        t_start_rec = time.monotonic()

        def cb(indata, frames, time_info, status_in):
            # indata: float32 (frames, 1)
            ch = indata[:, 0]
            rms = float(np.sqrt(np.mean(ch * ch)))
            if rms > self._mic_peak:
                self._mic_peak = rms
            pcm16 = (np.clip(ch, -1.0, 1.0) * 32767.0).astype(np.int16).tobytes()
            self._cb_count += 1
            if rms > 0.001:
                self._cb_nonzero += 1
            if self._cb_first_t is None:
                self._cb_first_t = time.monotonic() - t_start_rec
                log.info("first audio callback after %dms, rms=%.4f, frames=%d, status=%s",
                         int(self._cb_first_t * 1000), rms, frames, status_in)
            # Every 20 callbacks (~1s) log a summary so the log isn't 20Hz spam
            if self._cb_count % 20 == 0:
                log.info("cb #%d rms=%.4f peak=%.4f nonzero=%d/%d",
                         self._cb_count, rms, self._mic_peak, self._cb_nonzero, self._cb_count)
            try:
                loop.call_soon_threadsafe(self._on_pcm_chunk, pcm16, rms)
            except RuntimeError as e:
                log.warning("call_soon_threadsafe failed: %r", e)

        # Device selection priority (highest first):
        #   1. VOICE_INPUT_DEVICE=<index>  — explicit index
        #   2. VOICE_INPUT_NAME=<substring> — match first input-capable
        #      device whose name contains the substring (case-insensitive).
        #      Useful for surviving Bluetooth reconnects that shuffle
        #      indices, and for steering past virtual routing devices
        #      that PortAudio sometimes picks as default but doesn't
        #      actually feed via callbacks.
        #   3. PortAudio default
        device_arg = _resolve_input_device()
        try:
            dev_info = sd.query_devices(device_arg if device_arg is not None
                                        else sd.default.device[0], kind="input")
            log.info("opening InputStream device=%s (%r), sr=%d, block=%d",
                     device_arg if device_arg is not None else sd.default.device[0],
                     dev_info.get("name", "?"), MIC_SR, MIC_BLOCK)
        except Exception as e:
            log.warning("query_devices failed: %r", e)
        try:
            self.input_stream = sd.InputStream(
                samplerate=MIC_SR, channels=1, dtype="float32",
                blocksize=MIC_BLOCK, callback=cb,
                device=device_arg,
            )
            self.input_stream.start()
            log.info("InputStream.start() returned, active=%s, latency=%s",
                     self.input_stream.active, self.input_stream.latency)
        except Exception as exc:
            log.exception("InputStream start failed")
            self._sys(f"[red]mic 启动失败:{exc}[/red]")
            status.recording = False
            mic.visible = False
            return

        await self.ws.send(json.dumps({"type": "start_recording", "sample_rate": MIC_SR}))
        log.info("sent start_recording to WS")
        self.turn_t_stop = None  # set on stop

    def _on_pcm_chunk(self, pcm16: bytes, rms: float) -> None:
        if not hasattr(self, "_pcm_count"):
            self._pcm_count = 0
            log.info("_on_pcm_chunk first call, len=%d, rms=%.4f", len(pcm16), rms)
        self._pcm_count += 1
        if self._pcm_count % 20 == 0:
            log.info("_on_pcm_chunk #%d rms=%.4f mic.visible=%s",
                     self._pcm_count, rms,
                     self.query_one('#mic').visible)
        mic = self.query_one("#mic", MicMeter)
        mic.level = rms
        mic.peak = self._mic_peak
        # Fire-and-forget send. ws.send returns a coroutine; we wrap as task.
        if self._ws_open():
            asyncio.create_task(self.ws.send(pcm16))

    async def _stop_recording_audio(self, send_stop: bool) -> None:
        if self.input_stream is None:
            log.info("_stop_recording called but input_stream is None")
            return
        log.info("_stop_recording — cb_count=%d, cb_nonzero=%d, peak=%.4f, send_stop=%s",
                 getattr(self, "_cb_count", 0), getattr(self, "_cb_nonzero", 0),
                 self._mic_peak, send_stop)
        try:
            self.input_stream.stop()
            self.input_stream.close()
        except Exception:
            log.exception("stream stop/close failed")
        self.input_stream = None
        # Reset PCM counter so next recording's debug starts fresh.
        if hasattr(self, "_pcm_count"):
            log.info("_on_pcm_chunk fired %d times total this turn", self._pcm_count)
            del self._pcm_count

        status = self.query_one("#status", StatusBar)
        mic = self.query_one("#mic", MicMeter)
        status.recording = False
        mic.visible = False
        mic.level = 0.0
        self.turn_t_stop = time.monotonic()

        if send_stop and self._ws_open():
            await self.ws.send(json.dumps({
                "type": "stop_recording",
                "peak_level": round(self._mic_peak, 4),
            }))
            log.info("sent stop_recording")
            status.last_first_audio_ms = 0  # reset for new turn

    # ── actions ──────────────────────────────────────────────────────
    def action_interrupt(self) -> None:
        if self.ws is None:
            return
        asyncio.create_task(self.ws.send(json.dumps({"type": "interrupt"})))
        self._clear_player_queue()

    def action_reset(self) -> None:
        if self.ws is None:
            return
        asyncio.create_task(self.ws.send(json.dumps({"type": "interrupt"})))
        asyncio.create_task(self.ws.send(json.dumps({"type": "reset"})))
        self._clear_player_queue()


if __name__ == "__main__":
    VoiceTUI().run()
