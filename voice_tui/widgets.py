"""Textual widgets — StatusBar / Conversation / MicMeter.

All three are dumb display surfaces driven by reactive properties.
Behaviour (recording / chatting / playing state) is owned by the
``VoiceTUI`` app and pushed in.
"""

from __future__ import annotations

import time

from rich.console import Group
from rich.panel import Panel
from rich.text import Text
from textual.reactive import reactive
from textual.widgets import Static

from .models import Message


# Braille spinner — clean motion in a single cell. 10 frames at ~8fps
# gives a smooth rotation that's obviously moving without being noisy.
SPINNER_FRAMES = ("⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏")


def _spinner_frame() -> str:
    return SPINNER_FRAMES[int(time.monotonic() * 8) % len(SPINNER_FRAMES)]


class StatusBar(Static):
    """Top bar — shows connection state, current mode, latency telemetry,
    active provider + voice + polish flag.

    Phase priority (highest first), drives the colored mode chip:
      reconnecting > recording > finalizing > polishing > chatting > idle

    States are *not* mutually exclusive at the field level (server WS
    events arrive asynchronously) — the render() method picks the
    highest-priority active flag."""
    connected = reactive(False)
    reconnecting = reactive(False)
    recording = reactive(False)
    finalizing = reactive(False)           # ASR finalize after stop_recording
    polishing = reactive(False)            # polish agent is running
    chatting = reactive(False)
    playing = reactive(False)
    asr_info = reactive("")
    llm_info = reactive("")
    tts_info = reactive("")                # voice (provider)
    polish_enabled = reactive(True)        # toggleable via 'p' hotkey
    last_first_audio_ms = reactive(0)
    last_total_ms = reactive(0)

    def on_mount(self) -> None:
        # 8 fps spinner — only refresh when there's an active state to
        # animate. Cheap when idle.
        self.set_interval(1 / 8, self._maybe_refresh)

    def _maybe_refresh(self) -> None:
        if (self.chatting or self.recording or self.polishing
                or self.finalizing or self.reconnecting):
            self.refresh()

    def render(self):
        t = Text()
        spin = _spinner_frame()
        # connection chip
        if not self.connected:
            label = " ↻ 重连中 " if self.reconnecting else " ● 未连接 "
            style = "bold black on yellow" if self.reconnecting else "bold red on red dim"
            t.append(label, style=style)
        elif self.recording:
            t.append(f" {spin} 录音中 ", style="bold black on yellow")
        elif self.finalizing:
            # Between stop_recording (client) and transcript event (server) —
            # ASR is finalising the last chunk(s). On a 30s recording this
            # can easily take 5-6s; without a dedicated state the user
            # would see a misleading "整理中" instead.
            t.append(f" {spin} 识别中 ", style="bold black on cyan")
        elif self.polishing:
            t.append(f" {spin} 整理中 ", style="bold black on magenta")
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
        # polish on/off chip
        if not self.polish_enabled:
            t.append("  polish:off", style="dim red")
        # latency
        if self.last_first_audio_ms:
            t.append("  ★首音 ", style="dim")
            t.append(f"{self.last_first_audio_ms}ms", style="bold green")
        if self.last_total_ms:
            t.append("  total ", style="dim")
            t.append(f"{self.last_total_ms}ms", style="green")
        return t


class Conversation(Static):
    """Scrolling conversation history rendered as stacked panels.

    Helper methods (``append`` / ``update_streaming_assistant`` / ...)
    consolidate the ``msgs = list(...); msgs.append(...); messages = msgs``
    pattern that used to be repeated in every event handler.
    """
    # ``always_update=True`` is required because we mutate Message
    # objects in place (e.g. ``m.text += delta``) — without it,
    # textual's default == comparison sees no change and skips the
    # render, so streaming tokens never visibly arrive.
    messages: list[Message] = reactive(list, layout=True, always_update=True)

    def on_mount(self) -> None:
        # Tick 8 times per second to drive the "AI thinking" spinner.
        # We only refresh when there's actually a streaming-with-no-
        # text bubble to animate, so this stays cheap when idle.
        self.set_interval(1 / 8, self._spinner_tick)

    def _spinner_tick(self) -> None:
        for m in self.messages:
            if m.streaming and not m.text:
                self.refresh()
                return

    def watch_messages(self, _old, _new) -> None:
        # Auto-scroll the enclosing VerticalScroll to the bottom on
        # every mutation. call_after_refresh defers to the next paint
        # so the scroll target reflects the just-rendered size.
        scroll = self.parent
        if scroll is not None and hasattr(scroll, "scroll_end"):
            self.call_after_refresh(scroll.scroll_end, animate=False)

    # --- mutation helpers (B2) ---------------------------------------------

    def append(self, m: Message) -> int:
        """Append a Message, return its index (callers may need the
        index to mutate the same bubble later via ``replace_at``)."""
        msgs = list(self.messages)
        msgs.append(m)
        self.messages = msgs
        return len(msgs) - 1

    def append_system(self, text: str) -> None:
        self.append(Message("system", text))

    def replace_at(self, idx: int, *, text: str | None = None,
                   info: str | None = None, streaming: bool | None = None,
                   raw: str | None = None) -> None:
        """Mutate the message at ``idx`` in place. None means no change."""
        msgs = list(self.messages)
        if not (0 <= idx < len(msgs)):
            return
        m = msgs[idx]
        if text is not None: m.text = text
        if info is not None: m.info = info
        if streaming is not None: m.streaming = streaming
        if raw is not None: m.raw = raw
        self.messages = msgs

    def append_to_streaming_assistant(self, delta: str) -> None:
        """Append ``delta`` to the in-flight assistant bubble (the last
        one with ``streaming=True``). No-op if none exists."""
        msgs = list(self.messages)
        for m in reversed(msgs):
            if m.role == "assistant" and m.streaming:
                m.text += delta
                break
        self.messages = msgs

    def finalize_streaming_assistant(self, *, info: str | None = None,
                                     suffix: str | None = None) -> None:
        """Mark the in-flight assistant bubble as done. ``suffix`` is
        appended to its text (e.g. ``"  [⏹ 打断]"`` on interrupt)."""
        msgs = list(self.messages)
        for m in reversed(msgs):
            if m.role == "assistant" and m.streaming:
                m.streaming = False
                if suffix is not None:
                    m.text = (m.text or "") + suffix
                if info is not None:
                    m.info = info
                break
        self.messages = msgs

    # --- render ------------------------------------------------------------

    def render(self):
        renderables = []
        frame = _spinner_frame()
        for m in self.messages:
            if m.role == "user":
                renderables.append(self._render_user(m, frame))
            elif m.role == "assistant":
                renderables.append(self._render_assistant(m, frame))
            else:  # system
                renderables.append(Text(f"  · {m.text}", style="dim italic"))
        return Group(*renderables) if renderables else Text("")

    @staticmethod
    def _render_user(m: Message, frame: str):
        cursor = "  [blink]▮[/blink]" if m.streaming else ""
        polish_changed = bool(m.raw) and (m.raw != m.text)
        polished_marker = " [magenta bold]✨ 已整理[/magenta bold]" if polish_changed else ""
        title = f"[bold cyan]你[/bold cyan]{polished_marker}{cursor}"
        if m.info:
            title += f"  [dim]{m.info}[/dim]"
        # Border shifts to magenta when polish actually changed the text
        # so the eye lands on the bubble that has the diff.
        border = "magenta" if polish_changed else "cyan"
        if m.streaming and not m.text:
            body = Text.from_markup(f"[cyan]{frame}[/cyan] [dim italic]听…[/dim italic]")
        elif polish_changed:
            # Show polished (bold) above + raw (strikethrough + dim)
            # below so the user sees the diff at a glance.
            body = Text()
            body.append(m.text or "(empty)", style="bold")
            body.append("\n  ", style="")
            body.append("原 ▸ ", style="dim magenta")
            body.append(m.raw, style="dim strike")
        else:
            body = Text(m.text or "(empty)")
        return Panel(
            body, title=title, title_align="left",
            border_style=border, padding=(0, 1),
        )

    @staticmethod
    def _render_assistant(m: Message, frame: str):
        cursor = "  [blink]▮[/blink]" if m.streaming else ""
        title = f"[bold green]AI[/bold green]{cursor}"
        if m.info:
            title += f"  [dim]{m.info}[/dim]"
        if m.streaming and not m.text:
            body = Text.from_markup(
                f"[green]{frame}[/green] [dim italic]AI 思考中…[/dim italic]"
            )
        else:
            body = Text(m.text or "(empty)")
        return Panel(
            body, title=title, title_align="left",
            border_style="green", padding=(0, 1),
        )


class MicMeter(Static):
    """Live mic level bar — visible only while recording.

    Also shows recording duration (``00:23 recording``) so a long-form
    capture (the 1-5min scenarios) gives the user a clock instead of
    "is this thing on?" anxiety."""
    level = reactive(0.0)
    peak = reactive(0.0)
    visible = reactive(False)
    t_started = reactive(0.0)              # set when recording begins

    def on_mount(self) -> None:
        # 1 Hz tick for the duration counter. Only refreshes while
        # visible — idle cost is one comparison per second.
        self.set_interval(1.0, self._tick)

    def _tick(self) -> None:
        if self.visible:
            self.refresh()

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
        # Duration mm:ss
        if self.t_started:
            dur = int(time.monotonic() - self.t_started)
            mm, ss = divmod(dur, 60)
            t.append(f"  {mm:02d}:{ss:02d}", style="bold yellow")
            t.append("  mic ", style="dim")
        else:
            t.append("  mic ", style="dim")
        t.append(bar, style=colour)
        t.append(f"  {self.level*100:5.1f}%  peak {self.peak*100:4.0f}%", style="dim")
        if self.level < 0.02:
            t.append("  ← 没采到声音", style="bold red")
        return t
