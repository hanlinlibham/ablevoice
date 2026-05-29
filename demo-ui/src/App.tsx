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
  AudioLines,
} from "lucide-react";
import {
  NeuralVoiceField,
  type NeuralSemanticSignal,
  type NeuralVoiceApiState,
  type NeuralVoicePhase,
} from "./components/NeuralVoiceField";
import { NeuralNebula } from "./components/NeuralNebula";

/* --------------------------------------------------------------------------
 * ai-elements-style minimal components.
 *
 * Real ai-elements (CLI shadcn-style copy-in) brings a lot of setup. For
 * this demo we keep the look-and-feel — Conversation / Message / status
 * pill — but inline the JSX. When this graduates into a real subroute
 * inside dpagt/frontend_dp/, swap these for the registry components.
 * ------------------------------------------------------------------------ */

type Role = "user" | "assistant" | "system";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    return () => clearInterval(t);
  }, [startedAt]);
  const dur = startedAt ? Math.floor(elapsedMs / 1000) : 0;
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

  const playNext = useCallback(function playNextInner() {
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
      playNextInner();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(item.url);
      currentRef.current = null;
      playNextInner();
    };
    setPlaying(true);
    void audio.play().catch(() => {
      URL.revokeObjectURL(item.url);
      currentRef.current = null;
      playNextInner();
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

type Preset = { name: string; label: string };
/** Hands-free listening state, mirrored from the server's vad_state events.
 *  null = not in hands-free mode. */
type VadState = "listening" | "speech" | "endpoint" | null;
type ConfigSnapshot = {
  asr_provider: string; asr_model_id: string;
  tts_provider: string; tts_model_id: string; tts_voice: string;
  llm_provider: string; llm_model_id: string; tts_sr: number;
  preset: string | null; presets: Preset[];
};

type WSHandlers = {
  onReady?: (info: ConfigSnapshot) => void;
  onPresetChanged?: (info: ConfigSnapshot) => void;
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
  onVadState?: (v: { state: string }) => void;
};

type HandlerArg<K extends keyof WSHandlers> = Parameters<NonNullable<WSHandlers[K]>>[0];

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
  /** Hands-free (VAD-driven) listening: mic stays open, the server decides
   *  turn boundaries. Mutually exclusive with push-to-talk recording. */
  handsfree: boolean;
  vadState: VadState;
  startHandsfree: () => Promise<void>;
  stopHandsfree: () => void;
};

function useVoiceWS(sessionId: string, handlers: WSHandlers): VoiceWS {
  const [connected, setConnected] = useState(false);
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [handsfree, setHandsfree] = useState(false);
  const [vadState, setVadState] = useState<VadState>(null);

  // Latest handlers, accessed by message handler without re-creating the WS.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

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
      let msg: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(ev.data);
        if (!parsed || typeof parsed !== "object") return;
        msg = parsed as Record<string, unknown>;
      } catch {
        return;
      }
      const h = handlersRef.current;
      switch (msg.type) {
        case "ready":         h.onReady?.(msg as HandlerArg<"onReady">); break;
        case "preset_changed": h.onPresetChanged?.(msg as HandlerArg<"onPresetChanged">); break;
        case "asr_partial":   h.onAsrPartial?.(msg as HandlerArg<"onAsrPartial">); break;
        case "transcript":    h.onTranscript?.(msg as HandlerArg<"onTranscript">); break;
        case "meta":          h.onMeta?.(msg as HandlerArg<"onMeta">); break;
        case "token":         h.onAssistantToken?.(typeof msg.delta === "string" ? msg.delta : ""); break;
        case "audio_chunk":   h.onAudioChunk?.(
          typeof msg.b64 === "string" ? msg.b64 : "",
          typeof msg.text === "string" ? msg.text : "",
          typeof msg.idx === "number" ? msg.idx : 0,
          typeof msg.dur_ms === "number" ? msg.dur_ms : 0,
          typeof msg.synth_ms === "number" ? msg.synth_ms : 0,
        ); break;
        case "chat_done":     h.onChatDone?.(msg as HandlerArg<"onChatDone">); break;
        case "interrupted":   h.onInterrupted?.(typeof msg.reason === "string" ? msg.reason : "?"); break;
        case "tts_done":      h.onTtsDone?.(msg as HandlerArg<"onTtsDone">); break;
        case "history_reset": h.onHistoryReset?.(typeof msg.cleared === "number" ? msg.cleared : 0); break;
        case "error":         h.onError?.(
          typeof msg.where === "string" ? msg.where : "?",
          typeof msg.message === "string" ? msg.message : "?",
        ); break;
        case "transcript_polished": h.onTranscriptPolished?.(msg as HandlerArg<"onTranscriptPolished">); break;
        case "polish":        h.onPolish?.(msg as HandlerArg<"onPolish">); break;
        case "retry":         h.onRetry?.(msg as HandlerArg<"onRetry">); break;
        case "workspace_list": h.onWorkspaceList?.(msg as HandlerArg<"onWorkspaceList">); break;
        case "workspace_changed": h.onWorkspaceChanged?.(msg as HandlerArg<"onWorkspaceChanged">); break;
        case "intent_ack":    h.onIntentAck?.(msg as HandlerArg<"onIntentAck">); break;
        case "voice_set":     h.onVoiceSet?.(msg as HandlerArg<"onVoiceSet">); break;
        case "polish_set":    h.onPolishSet?.(msg as HandlerArg<"onPolishSet">); break;
        case "vad_state":
          setVadState((typeof msg.state === "string" ? msg.state : null) as VadState);
          h.onVadState?.({ state: typeof msg.state === "string" ? msg.state : "" });
          break;
        case "handsfree_started": setHandsfree(true); break;
        case "handsfree_stopped": setHandsfree(false); setVadState(null); break;
        default: console.warn("unknown ws event", msg);
      }
    };
    return () => {
      try { ws.close(); } catch { /* already closed */ }
    };
  }, [sessionId]);

  // ── recording lifecycle ──────────────────────────────────────────────
  // Tear down the mic → PCM graph. Shared by push-to-talk stop and
  // hands-free stop; clears the browser mic indicator immediately.
  const teardownAudio = useCallback(() => {
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
  }, []);

  // Build the mic → 16kHz int16 PCM → ws pipeline. Shared by push-to-talk
  // and hands-free. echoCancellation is ESSENTIAL for hands-free: the mic
  // stays open while TTS plays, so without AEC the assistant's own voice
  // would trip the server-side VAD and barge in on itself.
  const setupAudio = useCallback(async (): Promise<boolean> => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      handlersRef.current.onError?.("ws", "WebSocket not connected");
      return false;
    }
    if (workletNodeRef.current) return true;  // already streaming

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err: unknown) {
      handlersRef.current.onError?.("mic", `getUserMedia failed: ${errorMessage(err)}`);
      return false;
    }
    streamRef.current = stream;

    // Don't pin AudioContext to 16kHz — Safari ignores it; we resample
    // in the worklet using the actual sampleRate.
    const AudioContextCtor = window.AudioContext ?? (window as Window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;
    if (!AudioContextCtor) {
      handlersRef.current.onError?.("mic", "AudioContext unavailable");
      teardownAudio();
      return false;
    }
    const audioCtx = new AudioContextCtor();
    audioCtxRef.current = audioCtx;
    try {
      await audioCtx.audioWorklet.addModule("/pcm-worklet.js");
    } catch (err: unknown) {
      handlersRef.current.onError?.("worklet", `addModule failed: ${errorMessage(err)}`);
      teardownAudio();
      return false;
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
    return true;
  }, [teardownAudio]);

  // ── push-to-talk ──────────────────────────────────────────────────────
  const stopRecording = useCallback(() => {
    setRecording(false);
    teardownAudio();
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "stop_recording",
        peak_level: Number(peakRef.current.toFixed(4)),
        browser: navigator.userAgent.slice(0, 80),
      }));
    }
  }, [teardownAudio]);

  const startRecording = useCallback(async () => {
    const ok = await setupAudio();
    if (!ok) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Tell the server we're about to stream PCM. This also implicitly
      // interrupts any in-flight chat.
      ws.send(JSON.stringify({ type: "start_recording", sample_rate: 16000 }));
      setRecording(true);
    }
  }, [setupAudio]);

  // ── hands-free (VAD-driven) ─────────────────────────────────────────────
  const startHandsfree = useCallback(async () => {
    const ok = await setupAudio();
    if (!ok) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Keep the mic open and let the server's VAD decide turn boundaries.
      ws.send(JSON.stringify({ type: "start_handsfree", sample_rate: 16000 }));
      setHandsfree(true);
    }
  }, [setupAudio]);

  const stopHandsfree = useCallback(() => {
    setHandsfree(false);
    setVadState(null);
    teardownAudio();
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop_handsfree" }));
    }
  }, [teardownAudio]);

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

  return {
    connected, recording, level, peak, handsfree, vadState,
    startRecording, stopRecording, startHandsfree, stopHandsfree,
    interrupt, reset, ttsOneShot, send,
  };
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
  // ── provider preset switching (driven by ready/preset_changed) ──
  const [presets, setPresets] = useState<Preset[]>([]);
  const [currentPreset, setCurrentPreset] = useState<string | null>(null);
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
  const [semanticSignal, setSemanticSignal] = useState<NeuralSemanticSignal | null>(null);
  const [visualFeedbackLevel, setVisualFeedbackLevel] = useState(0);
  const [coalescing, setCoalescing] = useState(false);
  const audioQueue = useAudioQueue();

  // Per-tab session id; refresh = brand-new conversation.
  const sessionId = useMemo(
    () => (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`),
    [],
  );
  const showDebugConsole = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("debug") === "1";
    } catch {
      return false;
    }
  }, []);
  const simpleRootRef = useRef<HTMLDivElement | null>(null);

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
  const semanticNonceRef = useRef(0);
  const lastPartialPulseAtRef = useRef(0);

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

  const pulseSemantic = useCallback((
    text: string,
    source: NeuralSemanticSignal["source"],
    strength = 1,
  ) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const now = performance.now();
    if (source === "user" && strength < 0.7 && now - lastPartialPulseAtRef.current < 120) return;
    if (source === "user" && strength < 0.7) lastPartialPulseAtRef.current = now;
    semanticNonceRef.current += 1;
    setSemanticSignal({
      nonce: semanticNonceRef.current,
      text: trimmed.slice(-220),
      source,
      strength,
    });
  }, []);

  const triggerVisualFeedback = useCallback(() => {
    const nextLevel = (visualFeedbackLevel + 1) % 3;
    const labels = ["松散呼吸", "通路激活", "收束聚焦"];
    setCoalescing(false);
    setVisualFeedbackLevel(nextLevel);
    semanticNonceRef.current += 1;
    setSemanticSignal({
      nonce: semanticNonceRef.current,
      text: labels[nextLevel],
      source: "system",
      strength: [0.32, 0.72, 0.96][nextLevel],
      route: "ontology",
      kind: "concept",
    });
  }, [visualFeedbackLevel]);

  const toggleCoalescing = useCallback(() => {
    const nextCoalescing = !coalescing;
    setCoalescing(nextCoalescing);
    setVisualFeedbackLevel(0);
    semanticNonceRef.current += 1;
    setSemanticSignal({
      nonce: semanticNonceRef.current,
      text: nextCoalescing ? "助手实心聚合收缩" : "助手恢复松散点云",
      source: "system",
      strength: nextCoalescing ? 0.42 : 0.3,
      route: "ontology",
      kind: "concept",
    });
  }, [coalescing]);

  const applyConfigSnapshot = useCallback((info: ConfigSnapshot) => {
    setServerInfo({
      asr_model_id: info.asr_model_id,
      tts_model_id: info.tts_model_id,
      llm_model_id: info.llm_model_id,
    });
    if (info.presets) setPresets(info.presets);
    setCurrentPreset(info.preset ?? null);
  }, []);

  const ws = useVoiceWS(sessionId, {
    onReady: applyConfigSnapshot,
    onPresetChanged: (info) => {
      applyConfigSnapshot(info);
      append({ kind: "system", text: `已切换预设 → ${info.preset ?? "?"}(ASR ${info.asr_provider} · LLM ${info.llm_provider} · TTS ${info.tts_provider})` });
    },
    onAsrPartial: (p) => {
      pulseSemantic(p.stable_text || p.text, "user", 0.42);
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
      pulseSemantic(t.text, "user", 1);
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
    onAudioChunk: (b64) => {
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
      pulseSemantic(s.full_text, "assistant", 0.88);
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
      pulseSemantic(p.text, "ontology", 0.72);
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
      pulseSemantic(`${r.where} ${r.reason}`, "system", 0.62);
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
      pulseSemantic(label, "system", 0.55);
      setLastAction({ text: `✦ ${label}`, until: Date.now() + 4000 });
      // Drop a clear divider entry in conversation log
      append({ kind: "system", text: `── ${label} ──` });
    },
    onIntentAck: (a) => {
      const ms = a.ms_classify + a.ms_handle;
      pulseSemantic(`${a.intent} ${a.text}`, "ontology", 0.9);
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

  // hands-free 收尾:VAD 判定话轮结束的瞬间打一个收束脉冲 — 星云上有个
  // "收到"的能量注入,随后 chat 起来自然过渡到 thinking。
  useEffect(() => {
    if (ws.vadState === "endpoint") pulseSemantic("收束", "system", 0.7);
  }, [ws.vadState, pulseSemantic]);

  // hands-free 三态映射成星云 phase。待命=armed,说话=listening(坍缩),
  // endpoint 收尾交给默认推导(此时 chat 已起 → thinking)。
  const handsfreePhase: NeuralVoicePhase | undefined = ws.handsfree
    ? (ws.vadState === "speech"
        ? "listening"
        : ws.vadState === "endpoint"
          ? undefined
          : "armed")
    : undefined;

  const voiceVisualState = useMemo<NeuralVoiceApiState>(() => ({
    connected: ws.connected,
    recording: ws.recording || (ws.handsfree && ws.vadState === "speech"),
    polishing,
    chatting,
    playing: audioQueue.playing,
    level: Math.max(ws.level, visualFeedbackLevel * 0.035),
    peak: Math.max(ws.peak, visualFeedbackLevel * 0.12),
    retrying: Boolean(retryBanner),
    latencyMs: latestTranscribeMs,
    workspaceActive: Boolean(currentWs.id),
    semanticSignal,
    visualIntensity: visualFeedbackLevel / 2,
    coalescing,
    // hands-free 子状态 → 显式 phase:待命聆听=armed(半聚拢呼吸),说话中=
    // listening(引力坍缩),endpoint 不强制 → undefined 让它自然过渡到
    // thinking。非 hands-free 时 undefined,星云走内部默认推导。
    phase: handsfreePhase,
  }), [
    ws.connected,
    ws.recording,
    ws.handsfree,
    ws.vadState,
    ws.level,
    ws.peak,
    polishing,
    chatting,
    audioQueue.playing,
    retryBanner,
    latestTranscribeMs,
    currentWs.id,
    semanticSignal,
    visualFeedbackLevel,
    coalescing,
  ]);

  // Cold-load: hydrate the conversation panel from SQLite (read-only —
  // server-side LLM history is per-session, but ASR transcripts persist).
  useEffect(() => {
    if (!showDebugConsole) {
      setHistoryLoaded(true);
      return;
    }
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
      } catch (err: unknown) {
        setEntries((prev) => [
          ...prev,
          { id: "history-err", kind: "system", text: `历史加载失败: ${errorMessage(err)}` },
        ]);
        setHistoryLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [showDebugConsole]);

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
    } catch (err: unknown) {
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

  const switchPreset = useCallback((name: string) => {
    if (name && name !== currentPreset) ws.send({ type: "set_preset", preset: name });
  }, [currentPreset, ws]);

  /* Push-to-talk handlers — the AudioWorklet starts pushing PCM as soon
     as startRecording resolves. New recording mid-AI-reply implicitly
     interrupts (server cancels chat task). */
  const onPressStart = useCallback(() => {
    if (ws.handsfree) return;  // push-to-talk disabled while hands-free is on
    audioQueue.stop();
    setCoalescing(false);
    pulseSemantic("voice input", "audio", 0.36);
    void ws.startRecording();
  }, [audioQueue, pulseSemantic, ws]);

  const onPressEnd = useCallback(() => {
    if (ws.recording) ws.stopRecording();
  }, [ws]);

  /* Keyboard: Space hold = push-to-talk while button is focused. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.code === "Space" && !ws.recording && !ws.handsfree) {
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

  useEffect(() => {
    if (!showDebugConsole) simpleRootRef.current?.focus();
  }, [showDebugConsole]);

  if (!showDebugConsole) {
    return (
      <div
        ref={simpleRootRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        className="relative flex h-full min-h-0 items-center justify-center overflow-hidden bg-(--color-bg) px-6 py-8 outline-none"
      >
        <div className="relative flex w-full max-w-[820px] flex-col items-center gap-5">
          <div
            onClick={triggerVisualFeedback}
            className="relative w-full overflow-hidden rounded-[28px]"
            style={{
              background: "rgba(10,10,16,0.72)",
              backdropFilter: "blur(40px) saturate(140%)",
              WebkitBackdropFilter: "blur(40px) saturate(140%)",
              boxShadow:
                "0 40px 100px -24px rgba(0,0,0,0.64), inset 0 0 0 1px rgba(255,255,255,0.075), 0 0 72px rgba(107,214,200,0.08)",
              cursor: "pointer",
            }}
            aria-label="点云反馈"
            title="点击点云改变形态和速率"
          >
            <NeuralNebula
              apiState={voiceVisualState}
              frameless
              className="h-[60vh] max-h-[500px] min-h-[320px] w-full"
            />
          </div>
          <div className="flex items-center gap-2 rounded-full border border-(--color-border) bg-(--color-panel) p-2 shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
            {chatting && (
              <button
                type="button"
                onClick={() => { ws.interrupt(); audioQueue.stop(); }}
                className="flex size-10 items-center justify-center rounded-full border border-amber-500/50 text-amber-300 transition hover:bg-amber-500/10"
                aria-label="打断"
                title="打断"
              >
                <StopCircle size={18} />
              </button>
            )}
            <button
              type="button"
              onClick={toggleCoalescing}
              className={`flex size-10 items-center justify-center rounded-full border transition ${
                coalescing
                  ? "border-emerald-300/70 bg-emerald-400/12 text-emerald-200 shadow-[0_0_24px_rgba(52,211,153,0.24)]"
                  : "border-cyan-400/30 text-cyan-100/75 hover:border-emerald-300/70 hover:text-emerald-200"
              }`}
              aria-label="聚合收缩"
              aria-pressed={coalescing}
              title="聚合收缩"
            >
              <span className="size-3 rounded-full bg-current/35 shadow-[0_0_10px_currentColor]" />
            </button>
            <button
              type="button"
              onMouseDown={onPressStart}
              onMouseUp={onPressEnd}
              onMouseLeave={() => { if (ws.recording) onPressEnd(); }}
              onTouchStart={(e) => { e.preventDefault(); onPressStart(); }}
              onTouchEnd={(e) => { e.preventDefault(); onPressEnd(); }}
              disabled={!ws.connected || ws.handsfree}
              className={`flex size-14 items-center justify-center rounded-full border-2 transition ${
                ws.recording
                  ? "border-amber-400 bg-amber-500/25 text-amber-200 shadow-[0_0_30px_rgba(245,158,11,0.28)]"
                  : !ws.connected || ws.handsfree
                    ? "cursor-not-allowed border-(--color-border) text-(--color-muted) opacity-45"
                    : "border-cyan-400/45 text-cyan-100 hover:border-amber-400 hover:text-amber-200"
              }`}
              aria-label="按住录音"
              title={ws.handsfree ? "免按键模式下停用(关掉免按键再用)" : "按住录音 / Space / ⌘⇧Space"}
            >
              {ws.recording ? (
                <Square size={17} className="fill-amber-300 text-amber-300" />
              ) : (
                <Mic size={20} />
              )}
            </button>
            {/* Hands-free toggle — mic stays open, server VAD segments turns. */}
            <button
              type="button"
              onClick={() => {
                if (ws.handsfree) {
                  ws.stopHandsfree();
                } else {
                  audioQueue.stop();
                  void ws.startHandsfree();
                }
              }}
              disabled={!ws.connected}
              className={`flex size-10 items-center justify-center rounded-full border transition ${
                ws.handsfree
                  ? "border-emerald-300/70 bg-emerald-400/15 text-emerald-200 shadow-[0_0_24px_rgba(52,211,153,0.28)]"
                  : !ws.connected
                    ? "cursor-not-allowed border-(--color-border) text-(--color-muted) opacity-45"
                    : "border-cyan-400/30 text-cyan-100/75 hover:border-emerald-300/70 hover:text-emerald-200"
              }`}
              aria-label="免按键模式"
              aria-pressed={ws.handsfree}
              title={ws.handsfree
                ? `免按键监听中${ws.vadState === "speech" ? "(说话中)" : ""} — 点击关闭`
                : "免按键:VAD 自动断句,说话即录(点击开启)"}
            >
              <AudioLines
                size={18}
                className={ws.handsfree && ws.vadState === "speech" ? "animate-pulse" : ""}
              />
            </button>
            <button
              type="button"
              onClick={resetConversation}
              className="flex size-10 items-center justify-center rounded-full border border-(--color-border) text-(--color-muted) transition hover:border-(--color-accent) hover:text-(--color-accent)"
              aria-label="重置"
              title="重置"
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </div>
      </div>
    );
  }

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
          {/* Preset switcher — flips the whole provider stack at runtime */}
          {presets.length > 0 && (
            <label className="flex items-center gap-1 whitespace-nowrap" title="切换 provider 预设(运行时,下一轮生效)">
              <span className="opacity-60 text-(--color-muted)">预设</span>
              <select
                value={currentPreset ?? ""}
                onChange={(e) => switchPreset(e.target.value)}
                className="rounded border border-(--color-border) bg-(--color-bg) px-1.5 py-0.5 text-(--color-text) focus:outline-none focus:border-(--color-accent)"
              >
                {currentPreset === null && <option value="">默认(.env)</option>}
                {presets.map((p) => (
                  <option key={p.name} value={p.name}>{p.label}</option>
                ))}
              </select>
            </label>
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

      {/* API-state visualizer — always visible, not part of the auto-scrolled chat log. */}
      <div className="border-b border-(--color-border) bg-(--color-bg) px-6 py-3">
        <div className="mx-auto max-w-3xl">
          <NeuralVoiceField apiState={voiceVisualState} className="h-32 sm:h-36" />
        </div>
      </div>

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
