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
    workspace_name = reactive("")          # current ablework workspace or "" for default
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
        # NOTE: workspace info moved to dedicated WorkspaceBar widget
        # so it gets more visual weight than a tiny chip — see app.py
        # latency
        if self.last_first_audio_ms:
            t.append("  ★首音 ", style="dim")
            t.append(f"{self.last_first_audio_ms}ms", style="bold green")
        if self.last_total_ms:
            t.append("  total ", style="dim")
            t.append(f"{self.last_total_ms}ms", style="green")
        return t


class WorkspaceBar(Static):
    """Dedicated row showing the current ablework workspace + count +
    hotkey hint. Sits right under the StatusBar so the user always
    knows which sandbox their next chat will run in — much more
    visible than a tiny chip in the status row.

    Styling rationale: when in a workspace, use a yellow-on-blue chip
    that pops; when at default sandbox, show dim italic so empty is
    quietly explained, not silently absent."""
    workspace_name = reactive("")
    workspace_count = reactive(0)
    last_action = reactive("")          # "已切换" / "已搬到" / "已创建" etc
    last_action_until = reactive(0.0)   # monotonic timestamp — fade after 4s

    def on_mount(self) -> None:
        # 4 fps tick to fade the action label after ~4s.
        self.set_interval(0.25, self._maybe_refresh)

    def _maybe_refresh(self) -> None:
        if self.last_action and time.monotonic() > self.last_action_until:
            self.last_action = ""
            self.last_action_until = 0.0
        if self.last_action:   # animate
            self.refresh()

    def render(self):
        t = Text()
        t.append("  📁 工作区 ", style="dim")
        if self.workspace_name:
            t.append(f" {self.workspace_name} ",
                     style="bold black on yellow")
        else:
            t.append("(默认 sandbox)", style="dim italic")
        # Recent action — fades after 4s so user knows what just happened
        if self.last_action:
            t.append("   ", style="")
            t.append(self.last_action, style="bold magenta")
        # Right-side hint: total count + hotkey
        if self.workspace_count:
            t.append(f"     ", style="")
            t.append(f"共 {self.workspace_count} 个", style="dim")
            t.append("   按 ", style="dim")
            t.append("W", style="bold cyan")
            t.append(" 切换 / 列表", style="dim")
        return t

    def flash_action(self, text: str, *, seconds: float = 4.0) -> None:
        """Set a transient action label that auto-fades."""
        self.last_action = text
        self.last_action_until = time.monotonic() + seconds
        self.refresh()


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

    def append_divider(self, text: str) -> None:
        """Visually-distinct row rendered with rule chars on both sides.
        Used when workspace switches so the conversation log clearly
        shows the boundary between turns in old vs new workspace."""
        self.append(Message("divider", text))

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
            elif m.role == "divider":
                # Bold workspace-transition rule, full-width.
                renderables.append(Text.from_markup(
                    f"  [bold magenta]── {m.text} ──[/bold magenta]"
                ))
            else:  # system — allow [yellow]/[bold]/etc markup from caller
                renderables.append(Text.from_markup(
                    f"  · {m.text}", style="dim italic",
                ))
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
    """Live level bar for the bottom bar — doubles as a recording meter
    (mic input, while recording) and a playback meter (TTS output, while
    the assistant is speaking).

    Recording also shows duration (``00:23``) so a long-form capture (the
    1-5min scenarios) gives the user a clock instead of "is this thing
    on?" anxiety. Playback shows a cyan waveform riding the TTS envelope."""
    level = reactive(0.0)                  # mic input level (recording)
    peak = reactive(0.0)
    visible = reactive(False)              # True while recording
    t_started = reactive(0.0)              # set when recording begins
    playing = reactive(False)              # True while TTS is playing
    play_level = reactive(0.0)             # TTS output level (playback)

    _VOICE_THRESHOLD = 0.025
    _HOT_THRESHOLD = 0.12

    def on_mount(self) -> None:
        # 12 fps while active: enough for an obvious live waveform without
        # making the terminal redraw noisy. Idle cost is one cheap
        # visibility check per tick.
        self.set_interval(1 / 12, self._tick)

    def _tick(self) -> None:
        if self.visible or self.playing:
            self.refresh()

    def _wave(self, level: float, width: int = 18) -> str:
        """Small animated mono waveform driven by ``level`` (RMS).

        Callbacks give us a level, not raw samples, so this renders a
        level-responsive synthetic wave — a confidence cue ("audio is
        flowing") rather than a real waveform analyzer. Shared by the
        recording (mic) and playback (TTS) meters."""
        if level < self._VOICE_THRESHOLD:
            return "·" * width
        glyphs = "▁▂▃▄▅▆▇█"
        amp = min(1.0, max(0.0, level / self._HOT_THRESHOLD))
        phase = int(time.monotonic() * 18)
        chars = []
        for i in range(width):
            # Triangle-ish repeating wave, shifted over time.
            x = (i + phase) % 8
            tri = x if x < 4 else 7 - x
            idx = int(1 + tri * amp * 2)
            chars.append(glyphs[min(idx, len(glyphs) - 1)])
        return "".join(chars)

    def _bar_width(self) -> int:
        width = getattr(getattr(self, "size", None), "width", 100) or 100
        return max(12, min(32, width - 64))

    def render(self):
        if self.visible:
            return self._render_recording()
        if self.playing:
            return self._render_playback()
        return Text("")

    def _render_recording(self):
        bar_width = self._bar_width()
        filled = int(min(1.0, self.level * 3.0) * bar_width)
        bar = "█" * filled + "░" * (bar_width - filled)
        speaking = self.level >= self._VOICE_THRESHOLD
        if not speaking:
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
            t.append("  音量检测中 ", style="dim")
        else:
            t.append("  音量检测中 ", style="dim")
        t.append(bar, style=colour)
        t.append("  ")
        if speaking:
            t.append(self._wave(self.level), style="bold green")
            t.append("  正在输入", style="bold green")
        else:
            t.append(self._wave(self.level), style="dim red")
        t.append(f"  {self.level*100:5.1f}%  peak {self.peak*100:4.0f}%", style="dim")
        if not speaking:
            t.append("  ← 没采到声音", style="bold red")
        return t

    def _render_playback(self):
        bar_width = self._bar_width()
        lvl = self.play_level
        filled = int(min(1.0, lvl * 3.0) * bar_width)
        bar = "█" * filled + "░" * (bar_width - filled)
        t = Text()
        t.append("  🔊 播放中 ", style="bold cyan")
        t.append(bar, style="cyan")
        t.append("  ")
        t.append(self._wave(lvl), style="bold cyan")
        t.append(f"  {lvl*100:5.1f}%", style="dim")
        return t
