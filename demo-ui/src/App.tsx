import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Mic,
  Square,
  Loader2,
  Sparkles,
  Trash2,
  Volume2,
  Send,
  RefreshCw,
  StopCircle,
} from "lucide-react";

/* --------------------------------------------------------------------------
 * ai-elements-style minimal components.
 *
 * Real ai-elements (CLI shadcn-style copy-in) brings a lot of setup. For
 * this demo we keep the look-and-feel — Conversation / Message / status
 * pill — but inline the JSX. When this graduates into a real subroute
 * inside dpagt/frontend_dp/, swap these for the registry components.
 * ------------------------------------------------------------------------ */

type Role = "user" | "assistant" | "system";

function Message({ role, children, footer, polishChanged }: {
  role: Role;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** When the user bubble has a polished+raw diff, switch border to
   *  magenta so the eye lands on the bubble with the diff. */
  polishChanged?: boolean;
}) {
  // Side-aligned bubbles like a chat client: user right, AI left, system center.
  const alignment = role === "user" ? "items-end" : role === "assistant" ? "items-start" : "items-stretch";
  const label = role === "user" ? "你" : role === "assistant" ? "AI" : "";
  const borderColor =
    role === "user"
      ? polishChanged
        ? "border-fuchsia-500/60"
        : "border-cyan-500/40"
      : role === "assistant"
      ? "border-emerald-500/40"
      : "border-(--color-border)";
  const labelColor =
    role === "user" ? "text-cyan-400" : role === "assistant" ? "text-emerald-400" : "text-(--color-muted)";
  const bubbleBg =
    role === "user"
      ? "bg-cyan-500/5"
      : role === "assistant"
      ? "bg-emerald-500/5"
      : "bg-transparent";
  // System messages render as dim italic single line — matches TUI's
  // "  · message" rendering.
  if (role === "system") {
    return (
      <div className="text-xs text-(--color-muted) italic flex items-start gap-1 px-1">
        <span className="opacity-50 mt-px">·</span>
        <span className="flex-1 whitespace-pre-wrap break-words">{children}</span>
      </div>
    );
  }
  return (
    <div className={`flex flex-col gap-0.5 ${alignment}`}>
      <div className={`max-w-[88%] rounded-lg border ${borderColor} ${bubbleBg}`}>
        {/* Title bar — matches TUI Panel's title_align="left" header */}
        <div className="px-3 pt-1.5 pb-1 flex items-baseline justify-between gap-2 border-b border-current/10">
          <span className={`text-xs font-semibold ${labelColor}`}>{label}</span>
          {footer && <div className="text-[10px] text-(--color-muted)">{footer}</div>}
        </div>
        <div className="px-3 py-2 leading-relaxed text-sm">{children}</div>
      </div>
    </div>
  );
}

// Braille spinner — same frames as TUI's _SPINNER_FRAMES so the two
// clients feel consistent. 8 fps tick = changes ~125ms.
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function useSpinner(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 125);
    return () => clearInterval(t);
  }, [active]);
  return SPINNER_FRAMES[frame];
}

/** Single dense status chip — mode label + spinner + colored bg.
 *  Replaces the old 4-pill conditional. Mode priority (top→bottom):
 *  reconnecting > recording > finalizing > polishing > chatting > idle. */
function ModeChip({
  connected, recording, polishing, chatting, playing,
}: {
  connected: boolean; recording: boolean; polishing: boolean;
  chatting: boolean; playing: boolean;
}) {
  const active = recording || polishing || chatting || !connected;
  const spin = useSpinner(active);
  let label: string;
  let cls: string;
  if (!connected) { label = "● 未连接"; cls = "bg-rose-500/15 text-rose-400 border-rose-500/40"; }
  else if (recording) { label = `${spin} 录音中`; cls = "bg-amber-500/15 text-amber-400 border-amber-500/40"; }
  else if (polishing) { label = `${spin} 整理中`; cls = "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/40"; }
  else if (chatting)  { label = playing ? `${spin} 播放中` : `${spin} 思考/合成中`;
                         cls = "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"; }
  else                { label = "✓ 就绪"; cls = "bg-cyan-500/15 text-cyan-400 border-cyan-500/40"; }
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-mono font-semibold ${cls}`}>
      {label}
    </span>
  );
}

/** Live mic meter — matches TUI MicMeter widget. Shows ``mm:ss``
 *  recording duration (yellow) + colored level bar + numeric level.
 *  Only renders when actively recording. */
function RecordingMeter({ level, peak, startedAt }: {
  level: number; peak: number; startedAt: number | null;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [startedAt]);
  // tick is unused by purpose — its re-render is what updates the
  // displayed mm:ss. Reference it so eslint doesn't flag unused.
  void tick;
  const dur = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  const mm = String(Math.floor(dur / 60)).padStart(2, "0");
  const ss = String(dur % 60).padStart(2, "0");
  const width = Math.min(100, level * 300);
  const color =
    level < 0.02 ? "bg-rose-500" :
    level < 0.08 ? "bg-amber-500" :
                   "bg-emerald-500";
  return (
    <div className="flex items-center gap-3 font-mono text-xs px-4 py-1.5 bg-amber-500/5 border-y border-amber-500/20">
      <span className="text-amber-400 font-bold tabular-nums">{mm}:{ss}</span>
      <span className="text-(--color-muted)">mic</span>
      <div className="relative flex-1 h-2 rounded overflow-hidden bg-(--color-bg) border border-(--color-border)">
        <div className={`h-full transition-[width] duration-75 ${color}`} style={{ width: `${width}%` }} />
      </div>
      <span className="text-(--color-muted) tabular-nums">{(level * 100).toFixed(1)}%</span>
      <span className="text-(--color-muted) tabular-nums">peak {(peak * 100).toFixed(0)}%</span>
      {level < 0.02 && <span className="text-rose-400">← 没采到声音</span>}
    </div>
  );
}

/** Bottom hotkey hints — matches TUI Footer. Mouse-clickable too. */
function HotkeyHints({ onSpace, onInterrupt, onReset, onToggleWsList, onTogglePolish, onQuit }: {
  onSpace: () => void; onInterrupt: () => void; onReset: () => void;
  onToggleWsList: () => void; onTogglePolish: () => void; onQuit?: () => void;
}) {
  const items: Array<[string, string, () => void]> = [
    ["Space", "录音", onSpace],
    ["i",     "打断", onInterrupt],
    ["r",     "重置", onReset],
    ["w",     "工作区", onToggleWsList],
    ["p",     "polish", onTogglePolish],
    ["⌘⇧Space", "全局录音", () => {}],   // not clickable; just info
  ];
  if (onQuit) items.push(["q", "退出", onQuit]);
  return (
    <div className="border-t border-(--color-border) bg-(--color-panel) px-4 py-1 flex items-center gap-3 text-[11px] font-mono text-(--color-muted) overflow-x-auto">
      {items.map(([k, label, fn]) => (
        <button
          key={k}
          type="button"
          onClick={fn}
          className="flex items-center gap-1 hover:text-(--color-accent) transition"
          title={`${k} → ${label}`}
        >
          <kbd className="px-1 rounded border border-(--color-border)/50 bg-(--color-bg) text-(--color-text)/80">{k}</kbd>
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

type Entry = {
  id: string;
  kind: "user" | "assistant" | "system";
  text: string;
  ms?: number;
  bytes?: number;
  err?: string;
  /** Server-side transcript id, if this row corresponds to a persisted
   *  transcript. Lets the user delete the underlying SQLite row + audio
   *  file (when KEEP_AUDIO=1) by clicking the trash icon. */
  transcriptId?: string;
  createdAt?: string;
  peakLevel?: number | null;
  /** Assistant-only: marks the row as still streaming so we render a
   *  caret + auto-target it for incoming token deltas. */
  streaming?: boolean;
  /** Assistant-only: how many audio chunks have been queued so far. */
  audioChunks?: number;
  /** User-only: pre-polish text (only set when polish actually changed
   *  the bubble). Rendered below ``text`` as struck-through dim. */
  raw?: string;
  /** User-only: polish latency in ms. */
  polishMs?: number;
};

type HistoryRow = {
  id: string;
  created_at: string;
  text: string;
  ms: number;
  audio_bytes: number;
  peak_level: number | null;
  model: string;
  audio_path: string | null;
};

/* --------------------------------------------------------------------------
 * Audio playback queue — append base64 WAV chunks as they stream in from
 * the server, play them sequentially. Used both by chat (multiple
 * sentence chunks) and the composer-textarea one-shot TTS (single
 * chunk).
 *
 * We use an HTMLAudioElement per chunk + a tiny scheduler instead of
 * Web Audio API because chunks are full WAV blobs (header + PCM) — the
 * cheapest "play this blob" tool the browser has. The downside is a few
 * ms of gap between chunks; for conversational TTS that's invisible.
 * ------------------------------------------------------------------------ */

function useAudioQueue() {
  const queueRef = useRef<{ url: string }[]>([]);
  const currentRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const playNext = useCallback(() => {
    const item = queueRef.current.shift();
    if (!item) {
      setPlaying(false);
      currentRef.current = null;
      return;
    }
    const audio = new Audio(item.url);
    currentRef.current = audio;
    audio.onended = () => {
      URL.revokeObjectURL(item.url);
      currentRef.current = null;
      playNext();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(item.url);
      currentRef.current = null;
      playNext();
    };
    setPlaying(true);
    void audio.play().catch(() => {
      URL.revokeObjectURL(item.url);
      currentRef.current = null;
      playNext();
    });
  }, []);

  const enqueueB64Wav = useCallback((b64: string) => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    queueRef.current.push({ url });
    if (!currentRef.current) playNext();
  }, [playNext]);

  const stop = useCallback(() => {
    queueRef.current.forEach((it) => URL.revokeObjectURL(it.url));
    queueRef.current = [];
    if (currentRef.current) {
      currentRef.current.pause();
      currentRef.current.src = "";
      currentRef.current = null;
    }
    setPlaying(false);
  }, []);

  return { enqueueB64Wav, stop, playing };
}

/* --------------------------------------------------------------------------
 * useVoiceWS — single source of truth for the voice loop.
 *
 * Owns:
 *   - the WebSocket to /api/ws
 *   - the AudioContext + AudioWorklet (mic → 16kHz int16 PCM → ws binary)
 *   - the AnalyserNode (live mic level for the UI bar)
 *   - dispatching incoming server events to a caller-supplied handler
 *
 * The caller (App) plugs in:
 *   - onTranscript     — user's words came back; insert a user bubble
 *   - onAssistantToken — append delta to streaming bubble
 *   - onAudioChunk     — base64 WAV chunk; queued for sequential playback
 *   - onChatDone       — final summary, finalize bubble
 *   - onInterrupted    — chat was cancelled (server-side)
 *   - onError          — anything went wrong
 *
 * Why one big hook and not five smaller ones: every piece references the
 * same WebSocket instance and AudioContext lifecycle. Splitting would
 * mean threading refs around. The hook stays ~150 lines, which is fine.
 * ------------------------------------------------------------------------ */

type Workspace = {
  id: string;
  name: string;
  last_active_at?: string;
};

type WSHandlers = {
  onReady?: (info: { asr_model_id: string; tts_model_id: string; llm_model_id: string }) => void;
  onAsrPartial?: (t: { text: string; stable_text: string }) => void;
  onTranscript?: (t: {
    id: string; text: string; ms: number; audio_bytes: number; peak_level: number | null;
    created_at: string; model: string;
  }) => void;
  onTranscriptPolished?: (p: {
    id: string; text: string; raw: string; skipped: boolean;
    attempts: number; ok: boolean; errors: string[]; ms: number;
  }) => void;
  onPolish?: (p: {
    raw: string; final: string; skipped: boolean; ok: boolean;
    attempts: number; ms: number;
  }) => void;
  onMeta?: (m: { model: string; voice: string }) => void;
  onAssistantToken?: (delta: string) => void;
  onAudioChunk?: (b64: string, text: string, idx: number, dur_ms: number, synth_ms: number) => void;
  onChatDone?: (s: { full_text: string; total_ms: number; n_audio: number; history_len: number }) => void;
  onInterrupted?: (reason: string) => void;
  onTtsDone?: (s: { ms: number; dur_ms: number; size: number }) => void;
  onHistoryReset?: (cleared: number) => void;
  onError?: (where: string, message: string) => void;
  onRetry?: (r: {
    where: string; attempt: number; max_attempts: number;
    wait_ms: number; reason: string;
  }) => void;
  onWorkspaceList?: (l: {
    workspaces: Workspace[]; current_id: string | null; current_name: string | null;
  }) => void;
  onWorkspaceChanged?: (c: {
    id: string | null; name: string | null; intent: string;
    ok: boolean; error: string | null;
  }) => void;
  onIntentAck?: (a: {
    intent: string; text: string; workspace_id: string | null;
    workspace_match: string | null; ms_classify: number; ms_handle: number;
  }) => void;
  onVoiceSet?: (v: { voice: string | null; provider: string | null }) => void;
  onPolishSet?: (p: { enabled: boolean }) => void;
};

type VoiceWS = {
  connected: boolean;
  recording: boolean;
  level: number;        // 0..1 live mic RMS
  peak: number;         // 0..1 peak over current recording
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  interrupt: () => void;
  reset: () => void;
  ttsOneShot: (text: string) => void;
  /** Send a raw JSON event to the server (e.g. set_workspace,
   *  refresh_workspaces, set_polish, set_voice). */
  send: (obj: Record<string, unknown>) => void;
};

function useVoiceWS(sessionId: string, handlers: WSHandlers): VoiceWS {
  const [connected, setConnected] = useState(false);
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);

  // Latest handlers, accessed by message handler without re-creating the WS.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const wsRef = useRef<WebSocket | null>(null);
  // Audio graph held across record cycles only — torn down on stop so the
  // browser mic indicator clears immediately.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const analyserRafRef = useRef<number | null>(null);
  const peakRef = useRef(0);

  // ── WebSocket lifecycle ──────────────────────────────────────────────
  useEffect(() => {
    // Build the WS URL from the page origin so the vite dev proxy
    // upgrades /api/ws → :8501/ws transparently.
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/api/ws`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "hello", session_id: sessionId }));
    };
    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
    };
    ws.onerror = (e) => {
      // .onclose will fire after this.
      console.warn("ws error", e);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let msg: any;
      try { msg = JSON.parse(ev.data); }
      catch { return; }
      const h = handlersRef.current;
      switch (msg.type) {
        case "ready":         h.onReady?.(msg); break;
        case "asr_partial":   h.onAsrPartial?.(msg); break;
        case "transcript":    h.onTranscript?.(msg); break;
        case "meta":          h.onMeta?.(msg); break;
        case "token":         h.onAssistantToken?.(msg.delta); break;
        case "audio_chunk":   h.onAudioChunk?.(msg.b64, msg.text, msg.idx, msg.dur_ms, msg.synth_ms); break;
        case "chat_done":     h.onChatDone?.(msg); break;
        case "interrupted":   h.onInterrupted?.(msg.reason || "?"); break;
        case "tts_done":      h.onTtsDone?.(msg); break;
        case "history_reset": h.onHistoryReset?.(msg.cleared ?? 0); break;
        case "error":         h.onError?.(msg.where || "?", msg.message || "?"); break;
        case "transcript_polished": h.onTranscriptPolished?.(msg); break;
        case "polish":        h.onPolish?.(msg); break;
        case "retry":         h.onRetry?.(msg); break;
        case "workspace_list": h.onWorkspaceList?.(msg); break;
        case "workspace_changed": h.onWorkspaceChanged?.(msg); break;
        case "intent_ack":    h.onIntentAck?.(msg); break;
        case "voice_set":     h.onVoiceSet?.(msg); break;
        case "polish_set":    h.onPolishSet?.(msg); break;
        default: console.warn("unknown ws event", msg);
      }
    };
    return () => {
      try { ws.close(); } catch {}
    };
  }, [sessionId]);

  // ── recording lifecycle ──────────────────────────────────────────────
  const stopRecording = useCallback(() => {
    setRecording(false);
    // Tear down the audio graph before sending stop_recording so the
    // mic indicator clears immediately.
    if (analyserRafRef.current !== null) {
      cancelAnimationFrame(analyserRafRef.current);
      analyserRafRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current.port.onmessage = null;
      workletNodeRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setLevel(0);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "stop_recording",
        peak_level: Number(peakRef.current.toFixed(4)),
        browser: navigator.userAgent.slice(0, 80),
      }));
    }
  }, []);

  const startRecording = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      handlersRef.current.onError?.("ws", "WebSocket not connected");
      return;
    }
    if (workletNodeRef.current) return;  // already recording

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: any) {
      handlersRef.current.onError?.("mic", `getUserMedia failed: ${err?.message || err}`);
      return;
    }
    streamRef.current = stream;

    // Don't pin AudioContext to 16kHz — Safari ignores it; we resample
    // in the worklet using the actual sampleRate.
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioCtx;
    try {
      await audioCtx.audioWorklet.addModule("/pcm-worklet.js");
    } catch (err: any) {
      handlersRef.current.onError?.("worklet", `addModule failed: ${err?.message || err}`);
      stopRecording();
      return;
    }

    const source = audioCtx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(audioCtx, "pcm-worklet");
    workletNodeRef.current = worklet;
    // The worklet posts int16 PCM ArrayBuffers; forward each one as a
    // WebSocket binary frame. Cheap: no copy thanks to transfer.
    worklet.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(ev.data);
    };

    // Parallel analyser for the UI level bar. Doesn't affect the worklet.
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.5;
    source.connect(analyser);
    source.connect(worklet);
    // Worklet has no output node; it just posts PCM via port. So we don't
    // connect worklet → destination (which would create feedback anyway).

    const buf = new Uint8Array(analyser.fftSize);
    peakRef.current = 0;
    setPeak(0);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      if (rms > peakRef.current) {
        peakRef.current = rms;
        setPeak(rms);
      }
      setLevel(rms);
      analyserRafRef.current = requestAnimationFrame(tick);
    };
    analyserRafRef.current = requestAnimationFrame(tick);

    // Tell the server we're about to stream PCM. This also implicitly
    // interrupts any in-flight chat.
    ws.send(JSON.stringify({
      type: "start_recording",
      sample_rate: 16000,
    }));
    setRecording(true);
  }, [stopRecording]);

  const interrupt = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "interrupt" }));
    }
  }, []);

  const reset = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "reset" }));
    }
  }, []);

  const ttsOneShot = useCallback((text: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "tts", text }));
    }
  }, []);

  const send = useCallback((obj: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }, []);

  return { connected, recording, level, peak, startRecording, stopRecording, interrupt, reset, ttsOneShot, send };
}

export default function App() {
  const [entries, setEntries] = useState<Entry[]>([
    {
      id: "intro",
      kind: "system",
      text:
        "本地全栈语音对话:AudioWorklet → WebSocket → ASR → LLM → TTS,全部 MLX/ollama。" +
        "按住 ⏺ 录音按钮(或 Space)说话 — 边录边把 16kHz PCM 推给 server;" +
        "松开后:转写 → 流式 LLM → 句级 TTS → 顺序播放。" +
        "AI 说话时再按录音键会立刻打断;header 的「重置」清空对话。" +
        "底部输入框直接打字也能对话(Enter 发送),回复同样会语音播报;🔊 按钮仅试听 TTS 不进对话。",
    },
  ]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [ttsText, setTtsText] = useState("");
  const [composerBusy, setComposerBusy] = useState(false);
  const [chatting, setChatting] = useState(false);
  const [polishing, setPolishing] = useState(false);   // true between transcript and transcript_polished
  const [latestTranscribeMs, setLatestTranscribeMs] = useState<number | null>(null);
  const [serverInfo, setServerInfo] = useState<{
    asr_model_id: string;
    tts_model_id: string;
    llm_model_id: string;
  } | null>(null);
  // ── workspace state (driven by server's workspace_list/changed events) ──
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWs, setCurrentWs] = useState<{ id: string | null; name: string }>({ id: null, name: "" });
  const [wsListOpen, setWsListOpen] = useState(false);
  const [lastAction, setLastAction] = useState<{ text: string; until: number } | null>(null);
  // ── reconnect / retry banner (auto-fade after 4s) ──
  const [retryBanner, setRetryBanner] = useState<{ text: string; until: number } | null>(null);
  // ── recording started timestamp (for mm:ss timer in RecordingMeter)
  // effect that depends on ws.recording lives *after* the useVoiceWS
  // call below so ``ws`` is in scope.
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const audioQueue = useAudioQueue();

  // Per-tab session id; refresh = brand-new conversation.
  const sessionId = useMemo(
    () => (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`),
    [],
  );

  // Ref to the currently-streaming assistant entry id, so token/audio
  // events know which row to mutate without each event re-finding it.
  const activeAssistantIdRef = useRef<string | null>(null);
  // Ref to the in-progress partial user bubble id — set on first
  // asr_partial event of a turn, mutated by subsequent partials, cleared
  // when transcript arrives (and the bubble is finalized).
  const partialUserIdRef = useRef<string | null>(null);
  // Timings for the in-flight chat turn — set on transcript, read on done.
  const turnT0Ref = useRef<number>(0);
  const firstTokenAtRef = useRef<number | null>(null);
  const firstAudioAtRef = useRef<number | null>(null);

  const append = useCallback((e: Omit<Entry, "id"> & { id?: string }) => {
    setEntries((prev) => [
      ...prev,
      { id: e.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...e },
    ]);
  }, []);

  // Open a streaming assistant bubble + reset per-turn timing refs. Shared
  // by the voice path (after transcript) and the typed-text path (on
  // composer submit) so both render replies identically.
  const beginAssistantTurn = useCallback(() => {
    const assistantId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    activeAssistantIdRef.current = assistantId;
    turnT0Ref.current = performance.now();
    firstTokenAtRef.current = null;
    firstAudioAtRef.current = null;
    setEntries((prev) => [
      ...prev,
      { id: assistantId, kind: "assistant", text: "", streaming: true, audioChunks: 0 },
    ]);
    setChatting(true);
  }, []);

  const ws = useVoiceWS(sessionId, {
    onReady: (info) => {
      setServerInfo({
        asr_model_id: info.asr_model_id,
        tts_model_id: info.tts_model_id,
        llm_model_id: info.llm_model_id,
      });
    },
    onAsrPartial: (p) => {
      // Live transcription as the user is still speaking. Mutate the
      // existing partial bubble or create one on the first event.
      setEntries((prev) => {
        const pid = partialUserIdRef.current;
        if (pid) {
          return prev.map((e) =>
            e.id === pid ? { ...e, text: p.text } : e
          );
        }
        const newId = `partial-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        partialUserIdRef.current = newId;
        return [...prev, {
          id: newId, kind: "user", text: p.text,
          streaming: true,
        }];
      });
    },
    onTranscript: (t) => {
      setLatestTranscribeMs(t.ms);
      // Server emits transcript_polished within ~15ms-1.5s of transcript;
      // turn on polishing indicator that the polished event clears.
      setPolishing(true);
      // Clear the partial pointer; we'll either finalize that bubble
      // or (if empty transcript) replace it with a system note.
      const partialId = partialUserIdRef.current;
      partialUserIdRef.current = null;
      if (!t.text.trim()) {
        // Drop any partial bubble — server has confirmed it was silent.
        if (partialId) {
          setEntries((prev) => prev.filter((e) => e.id !== partialId));
        }
        append({
          kind: "system",
          text: `录音转写为空(${t.audio_bytes} bytes,peak ${(((t.peak_level ?? 0)) * 100).toFixed(0)}%)— mic 静默?`,
        });
        return;
      }
      if (partialId) {
        // Finalize the existing partial bubble in-place rather than
        // adding a second one — keeps the visual continuity.
        setEntries((prev) => prev.map((e) =>
          e.id === partialId
            ? {
                ...e,
                text: t.text,
                streaming: false,
                ms: t.ms,
                bytes: t.audio_bytes,
                transcriptId: t.id,
                createdAt: t.created_at,
                peakLevel: t.peak_level,
              }
            : e
        ));
      } else {
        append({
          kind: "user",
          text: t.text,
          ms: t.ms,
          bytes: t.audio_bytes,
          transcriptId: t.id,
          createdAt: t.created_at,
          peakLevel: t.peak_level,
        });
      }
      // The server auto-triggers chat from here — prepare a placeholder
      // assistant bubble so token/audio events have a row to append to.
      beginAssistantTurn();
    },
    onAssistantToken: (delta) => {
      if (firstTokenAtRef.current === null) {
        firstTokenAtRef.current = Math.round(performance.now() - turnT0Ref.current);
      }
      const id = activeAssistantIdRef.current;
      if (!id) return;
      setEntries((prev) => prev.map((e) => e.id === id ? { ...e, text: e.text + delta } : e));
    },
    onAudioChunk: (b64, _text, _idx, _dur, _synth) => {
      if (firstAudioAtRef.current === null) {
        firstAudioAtRef.current = Math.round(performance.now() - turnT0Ref.current);
      }
      audioQueue.enqueueB64Wav(b64);
      const id = activeAssistantIdRef.current;
      // For the composer one-shot TTS path there's no assistant bubble
      // (composer just plays the audio); skip the row update in that case.
      if (id) {
        setEntries((prev) => prev.map((e) =>
          e.id === id ? { ...e, audioChunks: (e.audioChunks ?? 0) + 1 } : e
        ));
      }
    },
    onChatDone: (s) => {
      const id = activeAssistantIdRef.current;
      if (id) {
        setEntries((prev) => prev.map((e) =>
          e.id === id ? { ...e, streaming: false, text: e.text || s.full_text, ms: s.total_ms } : e
        ));
      }
      append({
        kind: "system",
        text:
          `assistant 完成 · ${s.total_ms}ms 总 · ` +
          (firstTokenAtRef.current !== null ? `首 token ${firstTokenAtRef.current}ms · ` : "") +
          (firstAudioAtRef.current !== null ? `首音 ${firstAudioAtRef.current}ms · ` : "") +
          `${s.n_audio} 段 TTS · ${s.full_text.length} 字`,
      });
      activeAssistantIdRef.current = null;
      setChatting(false);
    },
    onInterrupted: (reason) => {
      const id = activeAssistantIdRef.current;
      if (id) {
        setEntries((prev) => prev.map((e) =>
          e.id === id
            ? { ...e, streaming: false, text: (e.text || "") + " [⏹ 已打断]" }
            : e
        ));
      }
      audioQueue.stop();
      append({ kind: "system", text: `chat 已打断(${reason})· 历史中不会记录这条 assistant 回复` });
      activeAssistantIdRef.current = null;
      partialUserIdRef.current = null;
      setChatting(false);
    },
    onTtsDone: (s) => {
      setComposerBusy(false);
      append({
        kind: "system",
        text: `TTS(手动)· ${s.ms}ms · ${(s.dur_ms / 1000).toFixed(1)}s · ${(s.size / 1024).toFixed(1)} KB`,
      });
    },
    onHistoryReset: (cleared) => {
      append({ kind: "system", text: `对话已清空(server 端 ${cleared} 条消息已 drop)` });
    },
    onError: (where, message) => {
      append({ kind: "system", text: `[${where}] ${message}` });
      if (where === "asr" || where === "ws" || where === "mic" || where === "worklet") {
        setChatting(false);
        activeAssistantIdRef.current = null;
      }
      if (where === "tts") setComposerBusy(false);
    },
    onTranscriptPolished: (p) => {
      setPolishing(false);
      if (p.skipped || p.text === p.raw) return;
      // Replace the most recent user bubble's text with polished + keep raw for diff
      setEntries((prev) => {
        const idx = [...prev].reverse().findIndex((e) => e.kind === "user");
        if (idx < 0) return prev;
        const realIdx = prev.length - 1 - idx;
        const target = prev[realIdx];
        const updated = { ...target, text: p.text, raw: p.raw, polishMs: p.ms };
        return prev.map((e, i) => (i === realIdx ? updated : e));
      });
    },
    onPolish: (p) => {
      // Server's chat pipeline emits "polish" when run_chat_pipeline does
      // its own polish (HTTP /chat path). Just flash polishing flag so
      // the UI shows it.
      setPolishing(!p.skipped);
    },
    onRetry: (r) => {
      const text = `⟳ ${r.where} 重试 ${r.attempt}/${r.max_attempts} (${r.wait_ms}ms 后)  ${r.reason}`;
      setRetryBanner({ text, until: Date.now() + 6000 });
      // also leave a system message so user has a record
      append({ kind: "system", text });
    },
    onWorkspaceList: (l) => {
      setWorkspaces(l.workspaces || []);
      setCurrentWs({ id: l.current_id, name: l.current_name || "" });
      append({ kind: "system",
        text: `工作区已加载:${l.workspaces?.length ?? 0} 个${l.current_name ? `(当前 ${l.current_name})` : ""}` });
    },
    onWorkspaceChanged: (c) => {
      setCurrentWs({ id: c.id, name: c.name || "" });
      const verb = {
        ws_switch: "已切换到",
        ws_create: "已新建并切入",
        ws_move:   "已搬到",
        ws_leave:  "已退出",
        set_workspace: "已切到",
      }[c.intent] || "→";
      const label = c.name ? `${verb} ${c.name}` : "已退出工作区";
      setLastAction({ text: `✦ ${label}`, until: Date.now() + 4000 });
      // Drop a clear divider entry in conversation log
      append({ kind: "system", text: `── ${label} ──` });
    },
    onIntentAck: (a) => {
      const ms = a.ms_classify + a.ms_handle;
      append({ kind: "system", text: `✦ ${a.intent}  ${a.text}  (${ms}ms)` });
    },
    onVoiceSet: (v) => {
      if (v.voice) append({ kind: "system", text: `→ 切到 voice ${v.voice} (${v.provider})` });
    },
    onPolishSet: (p) => {
      append({ kind: "system", text: `polish = ${p.enabled ? "on" : "off"}` });
    },
  });

  // Fade out lastAction + retryBanner after their `until` ms — simple
  // interval that no-ops when both are clear.
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      if (lastAction && now > lastAction.until) setLastAction(null);
      if (retryBanner && now > retryBanner.until) setRetryBanner(null);
    }, 500);
    return () => clearInterval(t);
  }, [lastAction, retryBanner]);

  // Recording timer trigger — set timestamp on transition into recording,
  // clear on transition out. Mounted here because ws is in scope.
  useEffect(() => {
    setRecordingStartedAt(ws.recording ? Date.now() : null);
  }, [ws.recording]);

  // Cold-load: hydrate the conversation panel from SQLite (read-only —
  // server-side LLM history is per-session, but ASR transcripts persist).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch("/api/history?limit=100");
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const rows: HistoryRow[] = await resp.json();
        if (cancelled) return;
        if (rows.length === 0) {
          setHistoryLoaded(true);
          return;
        }
        const restored: Entry[] = [];
        for (const r of rows.reverse()) {
          restored.push({
            id: `restore-${r.id}`,
            kind: "user",
            text: r.text || "(empty transcript)",
            ms: r.ms,
            bytes: r.audio_bytes,
            transcriptId: r.id,
            createdAt: r.created_at,
            peakLevel: r.peak_level,
          });
        }
        setEntries((prev) => [
          ...prev,
          { id: "history-sep", kind: "system",
            text: `历史 ${rows.length} 条已加载(SQLite ~/voice-asr-test/transcripts.db)`,
          },
          ...restored,
        ]);
        setHistoryLoaded(true);
      } catch (err: any) {
        setEntries((prev) => [
          ...prev,
          { id: "history-err", kind: "system", text: `历史加载失败: ${err?.message || err}` },
        ]);
        setHistoryLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-scroll to newest entry on update.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [entries]);

  const deleteTranscript = useCallback(async (transcriptId: string, entryId: string) => {
    try {
      const resp = await fetch(`/api/history/${transcriptId}`, { method: "DELETE" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setEntries((prev) => prev.filter((e) => e.id !== entryId));
    } catch (err: any) {
      console.warn("delete failed", err);
    }
  }, []);

  const submitComposerTts = useCallback(() => {
    const t = ttsText.trim();
    if (!t || composerBusy) return;
    setComposerBusy(true);
    audioQueue.stop();
    ws.ttsOneShot(t);
  }, [ttsText, composerBusy, audioQueue, ws]);

  // Typed chat turn — same conversation as voice. Render the user bubble
  // locally (the text is already known; server doesn't echo it), open the
  // assistant bubble, then send. Reply streams token/audio/chat_done via
  // the existing handlers.
  const submitComposerChat = useCallback(() => {
    const t = ttsText.trim();
    if (!t || chatting || !ws.connected) return;
    audioQueue.stop();
    append({ kind: "user", text: t });
    beginAssistantTurn();
    ws.send({ type: "text_message", text: t });
    setTtsText("");
  }, [ttsText, chatting, audioQueue, append, beginAssistantTurn, ws]);

  const resetConversation = useCallback(() => {
    ws.interrupt();
    audioQueue.stop();
    ws.reset();
  }, [ws, audioQueue]);

  /* Push-to-talk handlers — the AudioWorklet starts pushing PCM as soon
     as startRecording resolves. New recording mid-AI-reply implicitly
     interrupts (server cancels chat task). */
  const onPressStart = useCallback(() => {
    audioQueue.stop();
    void ws.startRecording();
  }, [audioQueue, ws]);

  const onPressEnd = useCallback(() => {
    if (ws.recording) ws.stopRecording();
  }, [ws]);

  /* Keyboard: Space hold = push-to-talk while button is focused. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.code === "Space" && !ws.recording) {
      e.preventDefault();
      onPressStart();
    }
  };
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.code === "Space" && ws.recording) {
      e.preventDefault();
      onPressEnd();
    }
  };

  /* Tauri global shortcut bridge — the Rust side emits
     ``voice-toggle-record`` when ⌘⇧Space fires anywhere on the OS;
     here we toggle the in-app recording state to match. In a plain
     browser tab (no Tauri runtime), the import gracefully no-ops. */
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const tauriEvent = await import("@tauri-apps/api/event");
        if (cancelled) return;
        unlisten = await tauriEvent.listen("voice-toggle-record", () => {
          if (ws.recording) {
            onPressEnd();
          } else {
            onPressStart();
          }
        });
      } catch {
        // Running in a browser tab — Tauri runtime unavailable, that's fine.
      }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [ws.recording, onPressStart, onPressEnd]);

  return (
    <div className="flex h-full flex-col">
      {/* Header — dense single-row status bar, TUI vibe.
          Brand · Mode chip · Provider info · Latency · Actions */}
      <header className="border-b border-(--color-border) bg-(--color-panel) px-4 py-1.5">
        <div className="flex items-center gap-3 font-mono text-xs">
          {/* Brand */}
          <div className="flex items-center gap-1.5 text-(--color-text)">
            <Sparkles size={14} className="text-(--color-accent)" />
            <span className="font-semibold">able-asr</span>
          </div>
          {/* Mode chip */}
          <ModeChip
            connected={ws.connected}
            recording={ws.recording}
            polishing={polishing}
            chatting={chatting}
            playing={audioQueue.playing}
          />
          {/* Provider info — dense, TUI-style "ASR ... · LLM ... · TTS ..." */}
          {serverInfo && (
            <div className="flex items-center gap-3 text-(--color-muted) overflow-hidden">
              <span className="whitespace-nowrap">
                <span className="opacity-60">ASR </span>
                <span className="text-cyan-400">{serverInfo.asr_model_id.split("/").pop()}</span>
              </span>
              <span className="text-(--color-border)">·</span>
              <span className="whitespace-nowrap">
                <span className="opacity-60">LLM </span>
                <span className="text-cyan-400">{serverInfo.llm_model_id}</span>
              </span>
              <span className="text-(--color-border)">·</span>
              <span className="whitespace-nowrap">
                <span className="opacity-60">TTS </span>
                <span className="text-cyan-400">{serverInfo.tts_model_id.split("/").pop()?.replace("Qwen3-TTS-12Hz-", "")}</span>
              </span>
            </div>
          )}
          {/* Latency stats — right-aligned via flex-1 spacer */}
          <div className="flex-1" />
          {latestTranscribeMs !== null && (
            <span className="text-(--color-muted) whitespace-nowrap">
              <span className="opacity-60">★ASR </span>
              <span className="text-emerald-400">{latestTranscribeMs}ms</span>
            </span>
          )}
          {/* Actions */}
          {chatting && (
            <button
              type="button"
              onClick={() => { ws.interrupt(); audioQueue.stop(); }}
              className="inline-flex items-center gap-1 rounded border border-amber-500/60 px-2 py-0.5 text-amber-400 hover:bg-amber-500/10 transition"
              title="打断 AI 回复"
            >
              <StopCircle size={11} />打断
            </button>
          )}
          <button
            type="button"
            onClick={resetConversation}
            className="inline-flex items-center gap-1 rounded border border-(--color-border) px-2 py-0.5 text-(--color-muted) hover:border-(--color-accent) hover:text-(--color-accent) transition"
            title="清空对话"
          >
            <RefreshCw size={11} />重置
          </button>
        </div>
      </header>

      {/* Workspace bar — dedicated row so the active ablework sandbox is
          always visible. Click the chip to toggle the list panel. */}
      <div className="border-b border-(--color-border) bg-(--color-bg) px-6 py-2 text-xs flex items-center gap-3">
        <span className="text-(--color-muted)">📁 工作区</span>
        <button
          type="button"
          onClick={() => setWsListOpen((v) => !v)}
          className={`rounded-md px-2 py-0.5 transition border ${
            currentWs.name
              ? "border-(--color-warn) bg-(--color-warn)/15 text-(--color-warn) font-medium hover:bg-(--color-warn)/25"
              : "border-(--color-border) text-(--color-muted) italic hover:border-(--color-accent)"
          }`}
          title='点击展开工作区列表(或说 "切到 X 工作区")'
        >
          {currentWs.name || "(默认 sandbox)"}
        </button>
        {lastAction && (
          <span className="text-(--color-accent) font-medium">{lastAction.text}</span>
        )}
        <div className="flex-1" />
        {workspaces.length > 0 && (
          <span className="text-(--color-muted)">共 {workspaces.length} 个</span>
        )}
        <button
          type="button"
          onClick={() => ws.send({ type: "refresh_workspaces" })}
          className="text-(--color-muted) hover:text-(--color-accent) px-1"
          title="重新拉取工作区列表"
        >⟳</button>
      </div>

      {/* Workspace list panel — slides down when open. Click name → set_workspace. */}
      {wsListOpen && (
        <div className="border-b border-(--color-border) bg-(--color-panel) px-6 py-3 max-h-64 overflow-y-auto">
          <div className="mx-auto max-w-3xl flex flex-col gap-1">
            <div className="text-xs text-(--color-muted) mb-1">
              点击切换 · 说 "新建 X 工作区" 创建 · 说 "把对话搬到 X" 移动当前对话
            </div>
            {workspaces.length === 0 && (
              <div className="text-sm text-(--color-muted) italic">列表为空 — 点 ⟳ 重新拉取</div>
            )}
            {workspaces.map((w) => {
              const active = w.id === currentWs.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => {
                    ws.send({ type: "set_workspace", id: w.id });
                    setWsListOpen(false);
                  }}
                  className={`flex items-center justify-between rounded px-2 py-1.5 text-sm transition text-left ${
                    active
                      ? "bg-(--color-warn)/15 text-(--color-warn) font-medium"
                      : "hover:bg-(--color-bg)"
                  }`}
                >
                  <span>{w.name}</span>
                  <span className="text-xs text-(--color-muted) ml-2">
                    {active && "✓ 当前 · "}{w.id.slice(0, 8)}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                ws.send({ type: "set_workspace", id: "" });
                setWsListOpen(false);
              }}
              className="mt-2 rounded px-2 py-1.5 text-sm text-(--color-muted) italic hover:bg-(--color-bg) text-left"
            >
              ↩ 回到默认 sandbox(无工作区)
            </button>
          </div>
        </div>
      )}

      {/* Retry banner — auto-fade after a few seconds */}
      {retryBanner && (
        <div className="border-b border-(--color-warn)/40 bg-(--color-warn)/10 px-6 py-1.5 text-xs text-(--color-warn) text-center">
          {retryBanner.text}
        </div>
      )}

      {/* Polish-in-flight banner */}
      {polishing && (
        <div className="border-b border-(--color-accent)/40 bg-(--color-accent)/10 px-6 py-1 text-xs text-(--color-accent) text-center">
          ✨ 整理中…
        </div>
      )}

      {/* Conversation */}
      <section ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {entries.map((e) => {
            const footerBits: string[] = [];
            if (e.kind === "user" && e.ms !== undefined) footerBits.push(`${e.ms}ms`);
            if (e.bytes) footerBits.push(`${(e.bytes / 1024).toFixed(1)} KB`);
            if (e.peakLevel !== undefined && e.peakLevel !== null) {
              footerBits.push(`peak ${(e.peakLevel * 100).toFixed(0)}%`);
            }
            if (e.createdAt) footerBits.push(e.createdAt.slice(11, 19));
            if (e.kind === "assistant") {
              if (e.audioChunks !== undefined && e.audioChunks > 0) {
                footerBits.push(`🔊 ${e.audioChunks} 段`);
              }
              if (!e.streaming && e.ms !== undefined) footerBits.push(`${e.ms}ms`);
            }
            const canReplay = e.kind === "assistant" && !e.streaming && e.text && !e.text.endsWith("[⏹ 已打断]");
            const footer = footerBits.length > 0 ? (
              <div className="flex items-center gap-2">
                <span>{footerBits.join(" · ")}</span>
                {canReplay && (
                  <button
                    type="button"
                    onClick={() => { audioQueue.stop(); ws.ttsOneShot(e.text); }}
                    className="rounded p-0.5 hover:bg-(--color-accent)/10 hover:text-(--color-accent) transition"
                    title="再播一次(走 TTS,server 端不重新生成 LLM)"
                  >
                    <Volume2 size={12} />
                  </button>
                )}
                {e.transcriptId && (
                  <button
                    type="button"
                    onClick={() => deleteTranscript(e.transcriptId!, e.id)}
                    className="rounded p-0.5 hover:bg-(--color-error)/10 hover:text-(--color-error) transition"
                    title="删除这条 transcript(server 端 SQLite 也删)"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ) : undefined;
            const showPolishDiff = e.kind === "user" && e.raw && e.raw !== e.text;
            const content =
              e.kind === "assistant" && e.streaming ? (
                <>
                  {e.text || <span className="text-(--color-muted) italic">思考中…</span>}
                  <span className="ml-0.5 inline-block w-1.5 h-4 -mb-0.5 bg-(--color-accent) animate-pulse" />
                </>
              ) : showPolishDiff ? (
                // Polish changed the text — show polished (bold) above,
                // raw (struck-through dim) below so user sees the diff.
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{e.text}</span>
                    <span className="text-[10px] text-(--color-accent) px-1.5 py-0.5 rounded bg-(--color-accent)/10">
                      ✨ 已整理{e.polishMs ? ` ${e.polishMs}ms` : ""}
                    </span>
                  </div>
                  <div className="text-xs text-(--color-muted) line-through opacity-70">
                    原:{e.raw}
                  </div>
                </div>
              ) : (
                e.text
              );
            return (
              <Message key={e.id} role={e.kind} footer={footer} polishChanged={!!showPolishDiff}>
                {content}
              </Message>
            );
          })}
          {!historyLoaded && (
            <div className="flex items-center justify-center gap-2 text-xs text-(--color-muted)">
              <Loader2 size={12} className="animate-spin" />
              加载历史…
            </div>
          )}
        </div>
      </section>

      {/* Recording meter — own row, only when recording. mm:ss + bar. */}
      {ws.recording && (
        <RecordingMeter level={ws.level} peak={ws.peak} startedAt={recordingStartedAt} />
      )}

      {/* Composer — TTS try-out + central record button */}
      <div className="border-t border-(--color-border) bg-(--color-panel) px-4 py-2 flex items-center gap-3">
        {/* Record button — compact, left-aligned */}
        <button
          type="button"
          onMouseDown={onPressStart}
          onMouseUp={onPressEnd}
          onMouseLeave={() => { if (ws.recording) onPressEnd(); }}
          onTouchStart={(e) => { e.preventDefault(); onPressStart(); }}
          onTouchEnd={(e) => { e.preventDefault(); onPressEnd(); }}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          disabled={!ws.connected}
          className={`flex size-10 items-center justify-center rounded-full border-2 transition shrink-0
            ${ws.recording
              ? "border-amber-500 bg-amber-500/30 animate-pulse"
              : !ws.connected
              ? "border-(--color-border)/50 bg-(--color-bg) opacity-50 cursor-not-allowed"
              : "border-(--color-border) bg-(--color-bg) hover:border-amber-500 hover:text-amber-500"
            }`}
          aria-label="按住录音"
          title="按住录音 / Space / ⌘⇧Space"
        >
          {ws.recording ? (
            <Square size={14} className="fill-amber-500 text-amber-500" />
          ) : (
            <Mic size={16} className="text-(--color-text)" />
          )}
        </button>
        {/* Composer — type to chat (Enter / 发送), or 🔊 to try TTS only */}
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); submitComposerChat(); }}
        >
          <input
            type="text"
            value={ttsText}
            onChange={(ev) => setTtsText(ev.target.value)}
            placeholder='输入文字对话 · 或按住录音按钮说话'
            className="flex-1 rounded border border-(--color-border) bg-(--color-bg) px-3 py-1.5 text-sm placeholder:text-(--color-muted)/60 focus:outline-none focus:border-(--color-accent)"
          />
          <button
            type="button"
            onClick={submitComposerTts}
            disabled={!ttsText.trim() || composerBusy || !ws.connected}
            className="inline-flex items-center gap-1 rounded border border-(--color-border) bg-(--color-bg) px-2.5 py-1.5 text-sm transition hover:border-(--color-accent) hover:text-(--color-accent) disabled:opacity-40 disabled:cursor-not-allowed"
            title="仅合成播放(不进对话)"
          >
            {composerBusy ? <Loader2 size={13} className="animate-spin" /> : <Volume2 size={13} />}
          </button>
          <button
            type="submit"
            disabled={!ttsText.trim() || chatting || !ws.connected}
            className="inline-flex items-center gap-1 rounded border border-(--color-border) bg-(--color-bg) px-2.5 py-1.5 text-sm transition hover:border-(--color-accent) hover:text-(--color-accent) disabled:opacity-40 disabled:cursor-not-allowed"
            title="发送到对话(Enter)"
          >
            {chatting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            发送
          </button>
        </form>
      </div>

      {/* Hotkey hints — bottom strip, TUI Footer parity */}
      <HotkeyHints
        onSpace={() => ws.recording ? onPressEnd() : onPressStart()}
        onInterrupt={() => { ws.interrupt(); audioQueue.stop(); }}
        onReset={resetConversation}
        onToggleWsList={() => setWsListOpen((v) => !v)}
        onTogglePolish={() => ws.send({ type: "set_polish", enabled: false })}
      />
    </div>
  );
}
