import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Mic,
  Square,
  Loader2,
  AlertTriangle,
  Sparkles,
  Trash2,
  Volume2,
  Send,
  Bot,
  RefreshCw,
  Plug,
  PlugZap,
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

function Message({ role, children, footer }: {
  role: Role;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const alignment = role === "user" ? "items-end" : "items-start";
  const bubble =
    role === "user"
      ? "bg-(--color-accent-soft) border-(--color-accent)/40 text-(--color-text)"
      : role === "assistant"
      ? "bg-(--color-bg) border-(--color-accent)/30 text-(--color-text)"
      : "bg-(--color-panel) border-(--color-border) text-(--color-muted)";
  return (
    <div className={`flex flex-col gap-1 ${alignment}`}>
      <div className={`max-w-[88%] rounded-2xl border px-4 py-3 leading-relaxed ${bubble}`}>
        {children}
      </div>
      {footer && (
        <div className="text-xs text-(--color-muted)">{footer}</div>
      )}
    </div>
  );
}

function StatusPill({ kind, children }: {
  kind: "idle" | "recording" | "transcribing" | "error" | "disconnected";
  children: React.ReactNode;
}) {
  const styles: Record<typeof kind, string> = {
    idle:         "border-(--color-border) text-(--color-muted)",
    recording:    "border-(--color-warn) text-(--color-warn) bg-(--color-warn)/10 animate-pulse",
    transcribing: "border-(--color-accent) text-(--color-accent) bg-(--color-accent)/10",
    error:        "border-(--color-error) text-(--color-error) bg-(--color-error)/10",
    disconnected: "border-(--color-error)/50 text-(--color-error) bg-(--color-error)/5",
  } as const;
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${styles[kind]}`}>
      {children}
    </span>
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

type WSHandlers = {
  onReady?: (info: { asr_model_id: string; tts_model_id: string; llm_model_id: string }) => void;
  onAsrPartial?: (t: { text: string; stable_text: string }) => void;
  onTranscript?: (t: {
    id: string; text: string; ms: number; audio_bytes: number; peak_level: number | null;
    created_at: string; model: string;
  }) => void;
  onMeta?: (m: { model: string; voice: string }) => void;
  onAssistantToken?: (delta: string) => void;
  onAudioChunk?: (b64: string, text: string, idx: number, dur_ms: number, synth_ms: number) => void;
  onChatDone?: (s: { full_text: string; total_ms: number; n_audio: number; history_len: number }) => void;
  onInterrupted?: (reason: string) => void;
  onTtsDone?: (s: { ms: number; dur_ms: number; size: number }) => void;
  onHistoryReset?: (cleared: number) => void;
  onError?: (where: string, message: string) => void;
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

  return { connected, recording, level, peak, startRecording, stopRecording, interrupt, reset, ttsOneShot };
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
        "底部输入框可以单独试 TTS。",
    },
  ]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [ttsText, setTtsText] = useState("");
  const [composerBusy, setComposerBusy] = useState(false);
  const [chatting, setChatting] = useState(false);
  const [latestTranscribeMs, setLatestTranscribeMs] = useState<number | null>(null);
  const [serverInfo, setServerInfo] = useState<{
    asr_model_id: string;
    tts_model_id: string;
    llm_model_id: string;
  } | null>(null);
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
  });

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

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="border-b border-(--color-border) bg-(--color-panel) px-6 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-(--color-accent)" />
            <span className="font-medium">voice-asr-test</span>
            <span
              className="text-xs text-(--color-muted) font-mono"
              title={
                serverInfo
                  ? `ASR: ${serverInfo.asr_model_id}\nLLM: ${serverInfo.llm_model_id}\nTTS: ${serverInfo.tts_model_id}`
                  : ""
              }
            >
              {serverInfo
                ? `${serverInfo.asr_model_id.split("/").pop()} · ${serverInfo.llm_model_id} · ${serverInfo.tts_model_id.split("/").pop()?.replace("Qwen3-TTS-12Hz-", "TTS-")}`
                : "loading…"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {!ws.connected && (
              <StatusPill kind="disconnected">
                <Plug size={12} />
                WS 未连接
              </StatusPill>
            )}
            {ws.connected && !ws.recording && !chatting && (
              <StatusPill kind="idle">
                <PlugZap size={12} />
                就绪
              </StatusPill>
            )}
            {ws.recording && (
              <StatusPill kind="recording">
                <span className="inline-block size-2 rounded-full bg-(--color-warn)" />
                录音中
              </StatusPill>
            )}
            {chatting && (
              <StatusPill kind="transcribing">
                <Bot size={12} className="animate-pulse" />
                {audioQueue.playing ? "AI 回复中(播放)" : "AI 思考/合成中"}
              </StatusPill>
            )}
            {latestTranscribeMs !== null && (
              <span className="text-xs text-(--color-muted)">last ASR {latestTranscribeMs}ms</span>
            )}
            {chatting && (
              <button
                type="button"
                onClick={() => { ws.interrupt(); audioQueue.stop(); }}
                className="inline-flex items-center gap-1 rounded-full border border-(--color-warn)/60 px-2.5 py-1 text-xs text-(--color-warn) hover:bg-(--color-warn)/10 transition"
                title="打断当前 AI 回复(server 端 cancel + 本地清队列)"
              >
                <StopCircle size={12} />
                打断
              </button>
            )}
            <button
              type="button"
              onClick={resetConversation}
              className="inline-flex items-center gap-1 rounded-full border border-(--color-border) px-2.5 py-1 text-xs text-(--color-muted) hover:border-(--color-accent) hover:text-(--color-accent) transition"
              title="清空对话上下文(server + client)"
            >
              <RefreshCw size={12} />
              重置
            </button>
          </div>
        </div>
      </header>

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
            const content =
              e.kind === "assistant" && e.streaming ? (
                <>
                  {e.text || <span className="text-(--color-muted) italic">思考中…</span>}
                  <span className="ml-0.5 inline-block w-1.5 h-4 -mb-0.5 bg-(--color-accent) animate-pulse" />
                </>
              ) : (
                e.text
              );
            return (
              <Message key={e.id} role={e.kind} footer={footer}>
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

      {/* Composer */}
      <footer className="border-t border-(--color-border) bg-(--color-panel) px-6 py-4">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3">
          <form
            className="flex w-full items-center gap-2"
            onSubmit={(e) => { e.preventDefault(); submitComposerTts(); }}
          >
            <input
              type="text"
              value={ttsText}
              onChange={(ev) => setTtsText(ev.target.value)}
              placeholder='试合成:比如 "你好,这是 Qwen3-TTS 的测试"'
              className="flex-1 rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm placeholder:text-(--color-muted)/60 focus:outline-none focus:border-(--color-accent)"
            />
            <button
              type="submit"
              disabled={!ttsText.trim() || composerBusy || !ws.connected}
              className="inline-flex items-center gap-1 rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm transition hover:border-(--color-accent) hover:text-(--color-accent) disabled:opacity-40 disabled:cursor-not-allowed"
              title="合成并播放(回车也行)"
            >
              {composerBusy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              合成
            </button>
          </form>
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
            className={`group flex size-20 items-center justify-center rounded-full border transition
              ${ws.recording
                ? "border-(--color-warn) bg-(--color-warn)/20 scale-110"
                : !ws.connected
                ? "border-(--color-border)/50 bg-(--color-bg) opacity-50 cursor-not-allowed"
                : "border-(--color-border) bg-(--color-bg) hover:bg-(--color-panel) hover:border-(--color-accent)"
              }`}
            aria-label="按住录音"
          >
            {ws.recording ? (
              <Square size={24} className="fill-(--color-warn) text-(--color-warn)" />
            ) : (
              <Mic size={28} className="text-(--color-text) group-hover:text-(--color-accent)" />
            )}
          </button>
          {ws.recording && (
            <div className="flex w-full max-w-md flex-col items-center gap-1">
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-(--color-bg) border border-(--color-border)">
                <div
                  className="h-full transition-[width] duration-75"
                  style={{
                    width: `${Math.min(100, ws.level * 300)}%`,
                    background:
                      ws.level < 0.02
                        ? "var(--color-error)"
                        : ws.level < 0.08
                        ? "var(--color-warn)"
                        : "var(--color-success)",
                  }}
                />
              </div>
              <span className="text-xs text-(--color-muted)">
                mic level: {(ws.level * 100).toFixed(1)}% · peak {(ws.peak * 100).toFixed(0)}%
                {ws.level < 0.02 && " — 没采到声音,检查 mic 选择"}
              </span>
            </div>
          )}
          <p className="text-center text-xs text-(--color-muted)">
            按住按钮(或 Space 键)说话 · AudioWorklet 16kHz PCM → WebSocket 实时上传
            <br />
            AI 回复时再按一次录音键 = 自动打断 · 首次 TTS 会下载模型 ~2-3GB
          </p>
        </div>
      </footer>
    </div>
  );
}
