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
  PanelRight,
} from "lucide-react";
import {
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
 * the server, then schedule them on one Web Audio timeline. DashScope
 * realtime TTS often emits many 60-300ms mini-WAVs; playing those with
 * one HTMLAudioElement per chunk creates audible seams. Here we parse the
 * PCM payload directly and place every chunk at an exact AudioContext
 * timestamp, so playback stays continuous even when chunks arrive fast.
 * ------------------------------------------------------------------------ */

function useAudioQueue() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const generationRef = useRef(0);
  const [playing, setPlaying] = useState(false);

  const ensureAudioContext = useCallback(async () => {
    const existing = audioCtxRef.current;
    if (existing && existing.state !== "closed") {
      if (existing.state === "suspended") await existing.resume();
      return existing;
    }

    const AudioContextCtor = window.AudioContext ?? (window as Window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;
    if (!AudioContextCtor) throw new Error("AudioContext unavailable");

    const ctx = new AudioContextCtor();
    audioCtxRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();
    return ctx;
  }, []);

  const unlock = useCallback(() => {
    void ensureAudioContext().catch((err: unknown) => {
      console.warn("[audio-playback] unlock failed:", errorMessage(err));
    });
  }, [ensureAudioContext]);

  const decodePcmWav = useCallback((ctx: AudioContext, bytes: Uint8Array): AudioBuffer => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const readTag = (offset: number) => String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
    if (bytes.byteLength < 44 || readTag(0) !== "RIFF" || readTag(8) !== "WAVE") {
      throw new Error("unsupported WAV container");
    }

    let audioFormat = 0;
    let channels = 0;
    let sampleRate = 0;
    let bitsPerSample = 0;
    let dataOffset = 0;
    let dataSize = 0;

    let offset = 12;
    while (offset + 8 <= bytes.byteLength) {
      const tag = readTag(offset);
      const size = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (tag === "fmt ") {
        audioFormat = view.getUint16(start, true);
        channels = view.getUint16(start + 2, true);
        sampleRate = view.getUint32(start + 4, true);
        bitsPerSample = view.getUint16(start + 14, true);
      } else if (tag === "data") {
        dataOffset = start;
        dataSize = size;
      }
      offset = start + size + (size % 2);
    }

    if (audioFormat !== 1 || bitsPerSample !== 16 || channels < 1 || sampleRate <= 0 || dataSize <= 0) {
      throw new Error(`unsupported WAV format fmt=${audioFormat} bits=${bitsPerSample} channels=${channels}`);
    }

    const frameCount = Math.floor(dataSize / (channels * 2));
    const buffer = ctx.createBuffer(channels, frameCount, sampleRate);
    for (let ch = 0; ch < channels; ch++) {
      const out = buffer.getChannelData(ch);
      for (let i = 0; i < frameCount; i++) {
        const sampleOffset = dataOffset + ((i * channels + ch) * 2);
        out[i] = view.getInt16(sampleOffset, true) / 32768;
      }
    }
    return buffer;
  }, []);

  const enqueueB64Wav = useCallback((b64: string) => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const generation = generationRef.current;
    chainRef.current = chainRef.current
      .then(async () => {
        if (generation !== generationRef.current) return;
        const ctx = await ensureAudioContext();
        if (generation !== generationRef.current) return;

        const buffer = decodePcmWav(ctx, bytes);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);

        const now = ctx.currentTime;
        const startAt = Math.max(
          nextStartTimeRef.current,
          now + (nextStartTimeRef.current > now ? 0.015 : 0.08),
        );
        nextStartTimeRef.current = startAt + buffer.duration;
        sourcesRef.current.add(source);
        source.onended = () => {
          source.disconnect();
          sourcesRef.current.delete(source);
          if (sourcesRef.current.size === 0 && ctx.currentTime >= nextStartTimeRef.current - 0.03) {
            nextStartTimeRef.current = 0;
            setPlaying(false);
          }
        };
        source.start(startAt);
        setPlaying(true);
      })
      .catch((err: unknown) => {
        console.warn("[audio-playback] enqueue failed:", errorMessage(err));
      });
  }, [decodePcmWav, ensureAudioContext]);

  const stop = useCallback(() => {
    generationRef.current += 1;
    chainRef.current = Promise.resolve();
    for (const source of sourcesRef.current) {
      try { source.stop(); } catch { /* already stopped */ }
      try { source.disconnect(); } catch { /* already disconnected */ }
    }
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setPlaying(false);
  }, []);

  useEffect(() => () => {
    stop();
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== "closed") void ctx.close();
  }, [stop]);

  return { enqueueB64Wav, stop, unlock, playing };
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
  voice_mode?: string;
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

  // Tear down the mic → PCM graph. Shared by push-to-talk stop,
  // hands-free stop, and websocket close; clears the browser mic indicator.
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
      setRecording(false);
      setHandsfree(false);
      setVadState(null);
      teardownAudio();
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
        case "error": {
          const where = typeof msg.where === "string" ? msg.where : "?";
          if (where === "handsfree") {
            setHandsfree(false);
            setVadState(null);
            teardownAudio();
          }
          h.onError?.(
            where,
            typeof msg.message === "string" ? msg.message : "?",
          );
          break;
        }
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
      // Detach handlers BEFORE closing. Under React StrictMode (and on any
      // reconnect) this cleanup closes a still-CONNECTING socket; its async
      // onclose/onerror would otherwise fire *after* the replacement socket
      // has already opened, stomping connected→false and wsRef→null — which
      // disables the record button with no error shown. Silencing the dead
      // socket also clears the bogus "ws error / closed before established".
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      if (ws.readyState === WebSocket.CONNECTING) {
        // Closing a CONNECTING socket makes the browser log a noisy
        // "closed before the connection is established"; defer to its open
        // event (handlers already detached, so it won't send or touch state).
        ws.addEventListener("open", () => { try { ws.close(); } catch { /* noop */ } }, { once: true });
      } else {
        try { ws.close(); } catch { /* already closed */ }
      }
    };
  }, [sessionId, teardownAudio]);

  // ── recording lifecycle ──────────────────────────────────────────────
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
    // Chrome's autoplay policy can hand back a *suspended* context even from
    // a user gesture; if it stays suspended the worklet never runs, so no PCM
    // is sent and the mic looks dead ("没接通"). Resume before wiring the graph.
    if (audioCtx.state === "suspended") {
      try { await audioCtx.resume(); } catch { /* best-effort */ }
    }
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
    // WebSocket binary frame. Always read the latest socket: after a
    // reconnect, a long-lived hands-free mic graph must not keep writing
    // into the socket that existed when the mic was first opened.
    worklet.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
      const liveWs = wsRef.current;
      if (liveWs && liveWs.readyState === WebSocket.OPEN) liveWs.send(ev.data);
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
    voice_mode?: string;
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
  const [debugLogOpen, setDebugLogOpen] = useState(true);
  const [lastAction, setLastAction] = useState<{ text: string; until: number } | null>(null);
  const [simpleNotice, setSimpleNotice] = useState<{ text: string; tone: "info" | "ok" | "warn" | "error" } | null>(null);
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
  const pendingRecordStopRef = useRef(false);

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
      voice_mode: info.voice_mode,
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
      setSimpleNotice({
        tone: t.text.trim() ? "ok" : "warn",
        text: t.text.trim()
          ? `转写完成: ${t.text.slice(0, 28)}`
          : `转写为空 · peak ${(((t.peak_level ?? 0)) * 100).toFixed(0)}%`,
      });
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
        setSimpleNotice({ tone: "ok", text: `首音 ${firstAudioAtRef.current}ms` });
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
      setSimpleNotice({ tone: "ok", text: `完成 · ${s.n_audio} 段语音 · ${s.total_ms}ms` });
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
      setSimpleNotice({ tone: "warn", text: `已打断: ${reason}` });
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
      setSimpleNotice({ tone: "ok", text: `已重置 · 清空 ${cleared} 条` });
      append({ kind: "system", text: `对话已清空(server 端 ${cleared} 条消息已 drop)` });
    },
    onError: (where, message) => {
      console.warn("[voice-ui-error]", where, message);
      setSimpleNotice({ tone: "error", text: `${where}: ${message}` });
      append({ kind: "system", text: `[${where}] ${message}` });
      if (where === "asr" || where === "ws" || where === "mic" || where === "worklet") {
        pendingRecordStopRef.current = false;
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
      setSimpleNotice({ tone: "warn", text });
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

  useEffect(() => {
    if (ws.recording) {
      setSimpleNotice({ tone: "info", text: `录音中 · peak ${(ws.peak * 100).toFixed(0)}%` });
      if (pendingRecordStopRef.current) {
        pendingRecordStopRef.current = false;
        ws.stopRecording();
      }
    }
  }, [ws.recording, ws.peak, ws.stopRecording]);

  useEffect(() => {
    if (ws.handsfree) {
      setSimpleNotice({
        tone: "info",
        text: ws.vadState === "speech" ? "免按键 · 正在说话" : "免按键监听中",
      });
    }
  }, [ws.handsfree, ws.vadState]);

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
  }, [entries, debugLogOpen]);

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
    audioQueue.unlock();
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
    audioQueue.unlock();
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
    audioQueue.unlock();
    pendingRecordStopRef.current = false;
    setSimpleNotice({ tone: "info", text: "正在打开麦克风..." });
    audioQueue.stop();
    setCoalescing(false);
    pulseSemantic("voice input", "audio", 0.36);
    void ws.startRecording();
  }, [audioQueue, pulseSemantic, ws]);

  const onPressEnd = useCallback(() => {
    if (ws.recording) {
      ws.stopRecording();
    } else {
      pendingRecordStopRef.current = true;
      setSimpleNotice({ tone: "info", text: "等待麦克风启动后收尾..." });
    }
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
                  audioQueue.unlock();
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
          {simpleNotice && (
            <div
              className={`max-w-full rounded-full border px-3 py-1 text-center text-xs font-mono shadow-[0_12px_30px_rgba(0,0,0,0.22)] ${
                simpleNotice.tone === "error"
                  ? "border-rose-500/50 bg-rose-500/10 text-rose-300"
                  : simpleNotice.tone === "warn"
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                    : simpleNotice.tone === "ok"
                      ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200"
                      : "border-cyan-400/40 bg-cyan-400/10 text-cyan-100"
              }`}
              role="status"
            >
              {simpleNotice.text}
            </div>
          )}
        </div>
      </div>
    );
  }

  const conversationEntries = entries.filter((e) => e.kind !== "system");
  const logEntries = entries.filter((e) => e.kind === "system").slice(-80);
  const providerBits = serverInfo
    ? [
        ["MODE", serverInfo.voice_mode ?? "chat"],
        ["ASR", serverInfo.asr_model_id.split("/").pop() || serverInfo.asr_model_id],
        ["LLM", serverInfo.llm_model_id],
        ["TTS", serverInfo.tts_model_id.split("/").pop()?.replace("Qwen3-TTS-12Hz-", "") || serverInfo.tts_model_id],
      ]
    : [];
  const debugPhase =
    !ws.connected ? "offline" :
    ws.recording ? "recording" :
    polishing ? "polishing" :
    audioQueue.playing ? "speaking" :
    chatting ? "thinking" :
    ws.handsfree ? `handsfree:${ws.vadState ?? "ready"}` :
    "ready";

  const renderConversationEntry = (e: Entry) => {
    const footerBits: string[] = [];
    if (e.kind === "user" && e.ms !== undefined) footerBits.push(`${e.ms}ms`);
    if (e.bytes) footerBits.push(`${(e.bytes / 1024).toFixed(1)} KB`);
    if (e.peakLevel !== undefined && e.peakLevel !== null) {
      footerBits.push(`peak ${(e.peakLevel * 100).toFixed(0)}%`);
    }
    if (e.createdAt) footerBits.push(e.createdAt.slice(11, 19));
    if (e.kind === "assistant") {
      if (e.audioChunks !== undefined && e.audioChunks > 0) {
        footerBits.push(`${e.audioChunks} audio`);
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
            onClick={() => { audioQueue.unlock(); audioQueue.stop(); ws.ttsOneShot(e.text); }}
            className="rounded p-0.5 transition hover:bg-white/5 hover:text-(--color-text)"
            title="再播一次"
          >
            <Volume2 size={12} />
          </button>
        )}
        {e.transcriptId && (
          <button
            type="button"
            onClick={() => deleteTranscript(e.transcriptId!, e.id)}
            className="rounded p-0.5 transition hover:bg-rose-500/10 hover:text-rose-300"
            title="删除 transcript"
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
          {e.text || <span className="text-(--color-muted)">思考中...</span>}
          <span className="ml-1 inline-block h-4 w-1 -mb-0.5 animate-pulse bg-emerald-300/80" />
        </>
      ) : showPolishDiff ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span>{e.text}</span>
            <span className="rounded border border-fuchsia-400/30 bg-fuchsia-400/10 px-1.5 py-0.5 text-[10px] text-fuchsia-200">
              polish{e.polishMs ? ` ${e.polishMs}ms` : ""}
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
  };

  return (
    <div
      className={`grid h-full min-h-0 bg-[#08090c] text-(--color-text) ${
        debugLogOpen ? "xl:grid-cols-[minmax(0,1fr)_400px]" : "xl:grid-cols-1"
      }`}
    >
      <main
        ref={simpleRootRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        className="relative flex min-h-0 flex-col overflow-hidden bg-(--color-bg) outline-none"
      >
        <div
          onClick={triggerVisualFeedback}
          className="absolute inset-0"
          aria-label="星云调试主画面"
          title="点击星云触发一次视觉反馈"
        >
          <NeuralNebula
            apiState={voiceVisualState}
            frameless
            className="h-full min-h-[520px] w-full"
          />
        </div>

        <header className="pointer-events-none absolute inset-x-0 top-0 z-20 px-5 py-4">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2">
            <div className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 bg-black/35 px-2.5 text-sm font-semibold backdrop-blur">
              <Sparkles size={15} className="text-teal-300" />
              able voice debug
            </div>
            <ModeChip
              connected={ws.connected}
              recording={ws.recording}
              polishing={polishing}
              chatting={chatting}
              playing={audioQueue.playing}
            />
            {providerBits.length > 0 && (
              <div className="hidden min-w-0 items-center gap-2 rounded-md border border-white/10 bg-black/25 px-2 py-1 text-xs text-(--color-muted) backdrop-blur md:flex">
                {providerBits.map(([label, value]) => (
                  <span key={label} className="min-w-0 truncate">
                    <span className="opacity-60">{label}</span>{" "}
                    <span className="text-teal-200/90">{value}</span>
                  </span>
                ))}
              </div>
            )}
            {presets.length > 0 && (
              <select
                value={currentPreset ?? ""}
                onChange={(e) => switchPreset(e.target.value)}
                className="h-8 rounded-md border border-white/10 bg-black/45 px-2 text-xs text-(--color-text) outline-none backdrop-blur transition focus:border-teal-300/60"
                title="provider preset"
              >
                {currentPreset === null && <option value="">默认(.env)</option>}
                {presets.map((p) => (
                  <option key={p.name} value={p.name}>{p.label}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => setWsListOpen((v) => !v)}
              className="h-8 rounded-md border border-white/10 bg-black/35 px-2 text-xs text-(--color-muted) backdrop-blur transition hover:border-teal-300/50 hover:text-teal-100"
              title="workspace"
            >
              {currentWs.name || "default sandbox"}
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setDebugLogOpen((v) => !v)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs backdrop-blur transition ${
                debugLogOpen
                  ? "border-teal-300/40 bg-teal-300/10 text-teal-100"
                  : "border-white/10 bg-black/35 text-(--color-muted) hover:border-teal-300/50 hover:text-teal-100"
              }`}
              aria-pressed={debugLogOpen}
              title={debugLogOpen ? "隐藏对话日志" : "显示对话日志"}
            >
              <PanelRight size={13} />
              log
            </button>
            {chatting && (
              <button
                type="button"
                onClick={() => { ws.interrupt(); audioQueue.stop(); }}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-amber-400/40 bg-black/30 px-2 text-xs text-amber-200 backdrop-blur transition hover:bg-amber-400/10"
                title="打断"
              >
                <StopCircle size={13} />打断
              </button>
            )}
            <button
              type="button"
              onClick={resetConversation}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-white/10 bg-black/35 px-2 text-xs text-(--color-muted) backdrop-blur transition hover:border-teal-300/50 hover:text-teal-100"
              title="重置"
            >
              <RefreshCw size={13} />重置
            </button>
          </div>

          {wsListOpen && (
            <div className="pointer-events-auto mt-3 max-h-56 w-full max-w-xl overflow-y-auto rounded-md border border-white/10 bg-[#0d0e13]/95 p-2 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur">
              {workspaces.length === 0 && (
                <div className="px-2 py-2 text-sm text-(--color-muted)">工作区列表为空</div>
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
                    className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition ${
                      active
                        ? "bg-teal-300/10 text-teal-100"
                        : "text-(--color-muted) hover:bg-white/5 hover:text-(--color-text)"
                    }`}
                  >
                    <span>{w.name}</span>
                    <span className="text-xs opacity-55">{w.id.slice(0, 8)}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  ws.send({ type: "set_workspace", id: "" });
                  setWsListOpen(false);
                }}
                className="w-full rounded-md px-2 py-1.5 text-left text-sm text-(--color-muted) transition hover:bg-white/5 hover:text-(--color-text)"
              >
                default sandbox
              </button>
            </div>
          )}
        </header>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-5 pb-5">
          <div className="pointer-events-auto mx-auto flex w-fit max-w-full flex-col items-center gap-3">
            {(retryBanner || polishing || simpleNotice) && (
              <div className="flex max-w-[min(760px,calc(100vw-40px))] flex-wrap justify-center gap-2 text-xs">
                {retryBanner && <span className="rounded-full border border-amber-400/30 bg-black/45 px-2.5 py-1 text-amber-200 backdrop-blur">{retryBanner.text}</span>}
                {polishing && <span className="rounded-full border border-fuchsia-300/30 bg-black/45 px-2.5 py-1 text-fuchsia-200 backdrop-blur">整理中</span>}
                {simpleNotice && (
                  <span className={`rounded-full border bg-black/45 px-2.5 py-1 backdrop-blur ${
                    simpleNotice.tone === "error"
                      ? "border-rose-400/30 text-rose-200"
                      : simpleNotice.tone === "warn"
                        ? "border-amber-400/30 text-amber-200"
                        : simpleNotice.tone === "ok"
                          ? "border-emerald-300/30 text-emerald-200"
                          : "border-teal-300/30 text-teal-100"
                  }`}>
                    {simpleNotice.text}
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/40 p-2 shadow-[0_18px_60px_rgba(0,0,0,0.36)] backdrop-blur">
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
              <button
                type="button"
                onClick={() => {
                  if (ws.handsfree) {
                    ws.stopHandsfree();
                  } else {
                    audioQueue.unlock();
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
                  ? `免按键监听中${ws.vadState === "speech" ? "(说话中)" : ""} - 点击关闭`
                  : "免按键:VAD 自动断句,说话即录(点击开启)"}
              >
                <AudioLines
                  size={18}
                  className={ws.handsfree && ws.vadState === "speech" ? "animate-pulse" : ""}
                />
              </button>
            </div>
          </div>
        </div>

        {ws.recording && (
          <div className="absolute inset-x-0 bottom-24 z-20 px-5">
            <RecordingMeter level={ws.level} peak={ws.peak} startedAt={recordingStartedAt} />
          </div>
        )}
      </main>

      {debugLogOpen && (
        <aside className="flex min-h-0 flex-col border-t border-white/8 bg-[#0d0e13] xl:border-l xl:border-t-0">
          <div className="border-b border-white/8 px-4 py-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">对话日志</div>
                <div className="mt-0.5 font-mono text-[10px] text-(--color-muted)">{debugPhase}</div>
              </div>
              <button
                type="button"
                onClick={() => setDebugLogOpen(false)}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-white/10 px-2 text-xs text-(--color-muted) transition hover:border-teal-300/50 hover:text-teal-100"
                title="隐藏对话日志"
              >
                <PanelRight size={13} />隐藏
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1.5 text-xs">
              <div className="rounded-md border border-white/8 bg-white/[0.025] p-2">
                <div className="text-(--color-muted)">ws</div>
                <div className={ws.connected ? "text-emerald-200" : "text-rose-200"}>{ws.connected ? "on" : "off"}</div>
              </div>
              <div className="rounded-md border border-white/8 bg-white/[0.025] p-2">
                <div className="text-(--color-muted)">vad</div>
                <div className="truncate text-(--color-text)">{ws.handsfree ? (ws.vadState ?? "on") : "off"}</div>
              </div>
              <div className="rounded-md border border-white/8 bg-white/[0.025] p-2">
                <div className="text-(--color-muted)">msg</div>
                <div className="font-mono text-(--color-text)">{conversationEntries.length}</div>
              </div>
              <div className="rounded-md border border-white/8 bg-white/[0.025] p-2">
                <div className="text-(--color-muted)">asr</div>
                <div className="font-mono text-(--color-text)">{latestTranscribeMs ?? "-"}ms</div>
              </div>
            </div>
            <div className="mt-3 space-y-1 font-mono text-[11px]">
              {providerBits.map(([label, value]) => (
                <div key={label} className="flex gap-2">
                  <span className="w-8 text-(--color-muted)">{label}</span>
                  <span className="min-w-0 flex-1 truncate text-teal-100/85">{value}</span>
                </div>
              ))}
            </div>
          </div>

          <section ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-4">
              {conversationEntries.length === 0 && historyLoaded && (
                <div className="rounded-md border border-dashed border-white/10 px-3 py-8 text-center text-sm text-(--color-muted)">
                  暂无对话
                </div>
              )}
              {conversationEntries.map(renderConversationEntry)}
              {!historyLoaded && (
                <div className="flex items-center justify-center gap-2 text-xs text-(--color-muted)">
                  <Loader2 size={12} className="animate-spin" />
                  加载历史...
                </div>
              )}
            </div>
          </section>

          <details className="border-t border-white/8 px-4 py-3 text-xs text-(--color-muted)">
            <summary className="cursor-pointer select-none">系统事件 {logEntries.length}</summary>
            <div className="mt-3 max-h-40 space-y-2 overflow-y-auto">
              {logEntries.length === 0 && (
                <div className="rounded-md border border-dashed border-white/10 px-3 py-3 text-center">
                  no events
                </div>
              )}
              {logEntries.map((e) => (
                <div key={e.id} className="rounded-md border border-white/8 bg-white/[0.025] px-3 py-2 leading-relaxed">
                  {e.text}
                </div>
              ))}
            </div>
          </details>

          <footer className="border-t border-white/8 px-4 py-3">
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => { e.preventDefault(); submitComposerChat(); }}
            >
              <input
                type="text"
                value={ttsText}
                onChange={(ev) => setTtsText(ev.target.value)}
                placeholder="输入文字对话"
                className="h-10 min-w-0 flex-1 rounded-md border border-white/10 bg-[#08090c] px-3 text-sm text-(--color-text) outline-none transition placeholder:text-(--color-muted)/60 focus:border-teal-300/60"
              />
              <button
                type="button"
                onClick={submitComposerTts}
                disabled={!ttsText.trim() || composerBusy || !ws.connected}
                className="flex size-10 items-center justify-center rounded-md border border-white/10 text-(--color-muted) transition hover:border-teal-300/50 hover:text-teal-100 disabled:cursor-not-allowed disabled:opacity-40"
                title="试听 TTS"
              >
                {composerBusy ? <Loader2 size={15} className="animate-spin" /> : <Volume2 size={15} />}
              </button>
              <button
                type="submit"
                disabled={!ttsText.trim() || chatting || !ws.connected}
                className="flex size-10 items-center justify-center rounded-md border border-teal-300/30 bg-teal-300/10 text-teal-100 transition hover:bg-teal-300/15 disabled:cursor-not-allowed disabled:opacity-40"
                title="发送"
              >
                {chatting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              </button>
            </form>
          </footer>
        </aside>
      )}
    </div>
  );
}
