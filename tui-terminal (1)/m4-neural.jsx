/* eslint-disable react/prop-types */
// M4 — Neural Voice
// A macOS voice assistant whose ENTIRE feedback surface is a living
// neural network: nodes drift, edges connect by proximity, and pulses
// of "current" travel along the edges. The network's shape, density,
// pulse rate, and color are bound to the API state of the assistant.
//
// Component is in neural-engine.jsx as <NeuralField/> — pure prop-driven.

const { useState, useEffect, useRef } = React;

const M4 = () => (
  <div className="scene" style={{ background: "#0a0a10", borderColor: "rgba(255,255,255,0.06)" }}>
    <div className="scene-head">
      <h3 style={{ color: "#e6e0d4" }}>M4 · Neural Voice</h3>
      <span className="meta" style={{ color: "rgba(230,224,212,0.45)" }}>
        nodes · edges · current pulses · all driven by API state
      </span>
    </div>

    {/* HERO — auto-cycling summoned HUD */}
    <M4Hero />
    <FrameCaption tag="hero · summoned">
      <b style={{ color: "#e6e0d4" }}>⌃Space summons the network.</b>{" "}
      <span style={{ color: "rgba(230,224,212,0.55)" }}>
        idle = sparse cyan grid breathing · listening = warm pulses
        rushing inward from the edges · thinking = dense magenta
        traffic across every hub · speaking = green waves
        radiating outward, each hop lighting up the next node.
      </span>
    </FrameCaption>

    {/* INTERACTIVE LAB — drive the network with controls */}
    <div style={{ marginTop: 32, marginBottom: 12 }}>
      <span style={{ fontFamily: "JetBrains Mono", fontSize: 12, color: "rgba(230,224,212,0.55)", letterSpacing: "0.06em" }}>
        ─── interactive lab · drive the API yourself ───
      </span>
    </div>
    <M4Lab />
    <FrameCaption tag="lab · live API">
      <b style={{ color: "#e6e0d4" }}>Click a state, drag volume.</b>{" "}
      <span style={{ color: "rgba(230,224,212,0.55)" }}>
        Each control maps 1:1 onto the component props the runtime
        will receive from the ASR/LLM streams. "Fire pulse" calls
        the imperative <code style={{ color: "#e6c466" }}>ref.fire()</code>
        method — useful for showing single tool-call events.
      </span>
    </FrameCaption>

    {/* STATE MATRIX */}
    <div style={{ marginTop: 32, marginBottom: 12 }}>
      <span style={{ fontFamily: "JetBrains Mono", fontSize: 12, color: "rgba(230,224,212,0.55)", letterSpacing: "0.06em" }}>
        ─── state matrix · 5 phases side by side ───
      </span>
    </div>
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(5, 1fr)",
      gap: 12, marginBottom: 14,
    }}>
      {[
        { state: "idle",      label: "idle",      sub: "0.012 pulse/frame · cyan"   },
        { state: "listening", label: "listening", sub: "edges → center · yellow"    },
        { state: "thinking",  label: "thinking",  sub: "dense traffic · magenta"    },
        { state: "speaking",  label: "speaking",  sub: "wave propagation · green"   },
        { state: "error",     label: "error",     sub: "jitter + fast · red"        },
      ].map((c, i) => (
        <StateCard key={i} {...c} />
      ))}
    </div>
    <FrameCaption tag="matrix">
      <span style={{ color: "rgba(230,224,212,0.55)" }}>
        The same network instance, same topology, only the{" "}
        <code style={{ color: "#e6c466" }}>state</code> prop changes —
        physics, pulse rate, palette, and breathing all derive from
        a single state machine.
      </span>
    </FrameCaption>

    {/* API surface */}
    <div style={{ marginTop: 32, marginBottom: 12 }}>
      <span style={{ fontFamily: "JetBrains Mono", fontSize: 12, color: "rgba(230,224,212,0.55)", letterSpacing: "0.06em" }}>
        ─── component API surface ───
      </span>
    </div>
    <APICard />

    {/* INTEGRATION SCENES */}
    <div style={{ marginTop: 32, marginBottom: 12 }}>
      <span style={{ fontFamily: "JetBrains Mono", fontSize: 12, color: "rgba(230,224,212,0.55)", letterSpacing: "0.06em" }}>
        ─── integration · embeddings ───
      </span>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
      <M4TrayEmbed />
      <M4DockEmbed />
    </div>
  </div>
);

// ════════════════════════════════════════════════════════════
// HERO — summoned HUD on a Mac desktop, auto-cycling
// ════════════════════════════════════════════════════════════
const HERO_TL = [
  { key: "idle",      dur: 3.0, hint: "hold space, or just start speaking" },
  { key: "listening", dur: 5.0, hint: "现金流那个,先告诉我自由现金流" },
  { key: "thinking",  dur: 3.0, hint: "" },
  { key: "speaking",  dur: 6.0, hint: "自由现金流 +18% YoY,Q3 单季 14.2 B,主要受云业务驱动…" },
];

function M4Hero() {
  const { phase, idx } = useVoiceLifecycle(HERO_TL);
  const mode = phase.key;
  const badge = STATE_BADGE[mode];

  return (
    <MacStage width={1200} height={640} wallpaper="noir" asrTray={
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "JetBrains Mono", fontSize: 12 }}>
        <NeuralField width={18} height={14} state={mode} density={14} trail={false} />
        able-asr
      </span>
    }>
      {/* HUD */}
      <div style={{
        position: "absolute", left: 220, top: 110, width: 760, height: 490,
        borderRadius: 28,
        background: "rgba(10,10,16,0.72)",
        backdropFilter: "blur(40px) saturate(140%)",
        WebkitBackdropFilter: "blur(40px) saturate(140%)",
        boxShadow: "0 40px 100px -20px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.08), 0 0 80px " + badge.glow,
        overflow: "hidden",
        display: "flex", flexDirection: "column",
        transition: "box-shadow 0.6s",
      }}>
        {/* header */}
        <div style={{
          padding: "14px 22px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          display: "flex", alignItems: "center", gap: 10,
          fontFamily: "JetBrains Mono", fontSize: 12,
          color: "rgba(230,224,212,0.85)",
        }}>
          <span style={{
            background: badge.bg, color: badge.fg,
            padding: "3px 10px", borderRadius: 6,
            fontWeight: 600, transition: "all 0.4s",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: 999, background: badge.fg,
              animation: mode === "idle" ? "none" : "neural-pulse 1.2s ease-in-out infinite",
            }} />
            {badge.text}
          </span>
          <span style={{ color: "rgba(230,224,212,0.4)" }}>~/</span>
          <span style={{ color: "#e6c466", fontWeight: 600 }}>q3-financials</span>
          <span style={{ flex: 1 }} />
          <span style={{ color: "rgba(230,224,212,0.4)" }}>paraformer · ablework · Maia</span>
        </div>

        {/* neural network field */}
        <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
          <NeuralField
            width={760}
            height={340}
            state={mode}
            density={75}
            trail
          />
          {/* state name overlay */}
          <div style={{
            position: "absolute", left: 0, right: 0, top: 16,
            display: "flex", justifyContent: "center",
            pointerEvents: "none",
          }}>
            <div style={{
              fontFamily: "JetBrains Mono",
              fontSize: 10, letterSpacing: "0.32em",
              textTransform: "uppercase",
              color: badge.fg,
              opacity: 0.85,
              padding: "3px 14px",
              borderRadius: 999,
              background: "rgba(0,0,0,0.45)",
              border: `1px solid ${badge.bg}`,
            }}>
              {badge.text.replace(/^[^a-z]+/i, "")}
            </div>
          </div>
        </div>

        {/* live caption */}
        <div style={{
          padding: "14px 22px 18px",
          borderTop: "1px solid rgba(255,255,255,0.05)",
          fontFamily: "JetBrains Mono",
          fontSize: 14, lineHeight: 1.6,
          minHeight: 76,
          display: "flex", alignItems: "center", gap: 12,
        }}>
          {mode === "idle" && (
            <>
              <span style={{ color: "rgba(230,224,212,0.4)" }}>hold</span>
              <Kbd2>space</Kbd2>
              <span style={{ color: "rgba(230,224,212,0.4)" }}>to talk, or start speaking</span>
            </>
          )}
          {mode === "listening" && (
            <>
              <Span c="dim">{"› "}</Span>
              <span style={{ color: "#e6e0d4", fontStyle: "italic" }}>{phase.hint}</span>
              <Caret />
            </>
          )}
          {mode === "thinking" && (
            <span style={{ color: "rgba(230,224,212,0.45)", fontStyle: "italic" }}>
              ⠹ resolving from {`{q3-revenue.csv · cashflow.md · board-deck.key}`} …
            </span>
          )}
          {mode === "speaking" && (
            <span style={{ color: "#e6e0d4" }}>{phase.hint}<Caret /></span>
          )}
        </div>
      </div>

      {/* phase pip */}
      <div style={{
        position: "absolute", left: 220, top: 84,
        display: "flex", gap: 10,
        fontFamily: "JetBrains Mono", fontSize: 10,
        color: "rgba(230,224,212,0.4)",
      }}>
        {HERO_TL.map((p, i) => (
          <span key={i} style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            opacity: i === idx ? 1 : 0.4,
            transition: "opacity 0.3s",
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: 999,
              background: i === idx ? STATE_BADGE[p.key].fg : "rgba(230,224,212,0.3)",
            }} />
            {p.key}
          </span>
        ))}
      </div>
    </MacStage>
  );
}

const STATE_BADGE = {
  idle:      { text: "○ ready",     bg: "rgba(107,214,200,0.18)", fg: "#6bd6c8", glow: "rgba(107,214,200,0.08)" },
  listening: { text: "● listening", bg: "rgba(230,196,102,0.22)", fg: "#e6c466", glow: "rgba(230,196,102,0.12)" },
  thinking:  { text: "⠹ thinking",  bg: "rgba(201,138,214,0.22)", fg: "#c98ad6", glow: "rgba(201,138,214,0.12)" },
  speaking:  { text: "▸ speaking",  bg: "rgba(126,194,122,0.22)", fg: "#7ec27a", glow: "rgba(126,194,122,0.12)" },
  error:     { text: "✕ error",     bg: "rgba(212,92,92,0.22)",   fg: "#d45c5c", glow: "rgba(212,92,92,0.12)" },
};

const Kbd2 = ({ children }) => (
  <span style={{
    display: "inline-block", padding: "2px 8px", borderRadius: 5,
    background: "rgba(255,255,255,0.1)", color: "#e6e0d4",
    fontFamily: "JetBrains Mono", fontSize: 12, fontWeight: 600,
  }}>{children}</span>
);

// ════════════════════════════════════════════════════════════
// LAB — interactive controls driving real props on a NeuralField
// ════════════════════════════════════════════════════════════
function M4Lab() {
  const [labState, setLabState] = useState("listening");
  const [vol, setVol] = useState(0.5);
  const [density, setDensity] = useState(60);
  const [scale, setScale] = useState(1);
  const [auto, setAuto] = useState(true);
  const fieldRef = useRef(null);

  const states = ["idle", "listening", "thinking", "speaking", "error"];

  // when `auto`, we leave volume null (component simulates internally)
  const volProp = auto ? undefined : vol;

  return (
    <div style={{
      borderRadius: 22,
      background: "rgba(15,15,22,0.92)",
      boxShadow: "0 30px 70px -20px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.06)",
      overflow: "hidden",
      display: "grid",
      gridTemplateColumns: "1fr 320px",
    }}>
      {/* canvas pane */}
      <div style={{ position: "relative", borderRight: "1px solid rgba(255,255,255,0.05)" }}>
        <NeuralField
          ref={fieldRef}
          width={820}
          height={420}
          state={labState}
          density={density}
          scale={scale}
          volume={volProp}
          trail
        />
        {/* mode label */}
        <div style={{
          position: "absolute", top: 14, left: 16,
          fontFamily: "JetBrains Mono", fontSize: 10,
          letterSpacing: "0.28em", textTransform: "uppercase",
          color: STATE_BADGE[labState].fg,
          padding: "3px 10px", borderRadius: 999,
          background: "rgba(0,0,0,0.4)",
          border: `1px solid ${STATE_BADGE[labState].bg}`,
        }}>
          state · {labState}
        </div>
      </div>

      {/* controls pane */}
      <div style={{
        padding: "20px 22px",
        fontFamily: "JetBrains Mono",
        color: "#e6e0d4",
        background: "rgba(0,0,0,0.25)",
      }}>
        <div style={{ fontSize: 11, letterSpacing: "0.18em", color: "rgba(230,224,212,0.45)", marginBottom: 14 }}>
          NEURAL · LIVE PROPS
        </div>

        {/* state */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 10, color: "rgba(230,224,212,0.5)", marginBottom: 6, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            state
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {states.map(s => (
              <button
                key={s}
                onClick={() => setLabState(s)}
                style={{
                  background: s === labState ? STATE_BADGE[s].bg : "rgba(255,255,255,0.03)",
                  color: s === labState ? STATE_BADGE[s].fg : "rgba(230,224,212,0.55)",
                  border: `1px solid ${s === labState ? STATE_BADGE[s].bg : "rgba(255,255,255,0.06)"}`,
                  fontFamily: "JetBrains Mono", fontSize: 11,
                  padding: "5px 9px", borderRadius: 5,
                  cursor: "pointer",
                  fontWeight: s === labState ? 600 : 400,
                  transition: "all 0.15s",
                }}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* volume */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: "rgba(230,224,212,0.5)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              volume
            </span>
            <span style={{ fontSize: 11, color: auto ? "rgba(230,224,212,0.3)" : "#e6c466" }}>
              {auto ? "auto" : vol.toFixed(2)}
            </span>
          </div>
          <input
            type="range" min={0} max={1} step={0.01}
            value={vol}
            disabled={auto}
            onChange={e => { setAuto(false); setVol(parseFloat(e.target.value)); }}
            style={{ width: "100%", accentColor: "#e6c466" }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 10, color: "rgba(230,224,212,0.5)" }}>
            <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />
            simulated (let component drive)
          </label>
        </div>

        {/* density */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: "rgba(230,224,212,0.5)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              density
            </span>
            <span style={{ fontSize: 11, color: "#e6c466" }}>{density}</span>
          </div>
          <input
            type="range" min={20} max={140} step={1}
            value={density}
            onChange={e => setDensity(parseInt(e.target.value))}
            style={{ width: "100%", accentColor: "#e6c466" }}
          />
        </div>

        {/* scale */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: "rgba(230,224,212,0.5)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              scale
            </span>
            <span style={{ fontSize: 11, color: "#e6c466" }}>{scale.toFixed(2)}×</span>
          </div>
          <input
            type="range" min={0.5} max={1.5} step={0.01}
            value={scale}
            onChange={e => setScale(parseFloat(e.target.value))}
            style={{ width: "100%", accentColor: "#e6c466" }}
          />
        </div>

        {/* imperative fire */}
        <button
          onClick={() => fieldRef.current?.fire()}
          style={{
            width: "100%",
            background: "rgba(230,196,102,0.16)",
            color: "#e6c466",
            border: "1px solid rgba(230,196,102,0.3)",
            padding: "9px 12px", borderRadius: 6,
            fontFamily: "JetBrains Mono", fontSize: 12, fontWeight: 600,
            cursor: "pointer",
            letterSpacing: "0.04em",
          }}>
          ⚡ fire pulse → ref.fire()
        </button>

        <div style={{
          marginTop: 16, paddingTop: 16,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          fontSize: 10, lineHeight: 1.6,
          color: "rgba(230,224,212,0.4)",
        }}>
          all changes flow as props.<br/>
          your runtime can stream state from<br/>
          the ASR/LLM session.
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// STATE MATRIX — five panels, same network instance per state
// ════════════════════════════════════════════════════════════
function StateCard({ state, label, sub }) {
  const b = STATE_BADGE[state];
  return (
    <div style={{
      borderRadius: 14,
      background: "rgba(15,15,22,0.92)",
      boxShadow: "0 20px 40px -15px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.06)",
      overflow: "hidden",
    }}>
      <div style={{
        padding: "8px 12px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        fontFamily: "JetBrains Mono", fontSize: 10,
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}>
        <span style={{
          padding: "2px 7px", borderRadius: 4,
          background: b.bg, color: b.fg,
          fontWeight: 600,
        }}>{label}</span>
      </div>
      <NeuralField width={220} height={180} state={state} density={42} trail />
      <div style={{
        padding: "8px 12px",
        fontFamily: "JetBrains Mono", fontSize: 10,
        color: "rgba(230,224,212,0.45)",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        lineHeight: 1.5,
      }}>
        {sub}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// API CARD — shows the component contract
// ════════════════════════════════════════════════════════════
function APICard() {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 16,
    }}>
      {/* PROPS */}
      <div style={{
        borderRadius: 16,
        background: "rgba(15,15,22,0.92)",
        boxShadow: "0 20px 40px -15px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.06)",
        padding: "18px 20px",
        fontFamily: "JetBrains Mono",
        color: "#e6e0d4",
      }}>
        <div style={{ fontSize: 11, letterSpacing: "0.18em", color: "rgba(230,224,212,0.45)", marginBottom: 12 }}>
          PROPS
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.9 }}>
          <APIRow name="state" type='"idle" | "listening" | "thinking" | "speaking" | "error"' desc="drives physics + palette" />
          <APIRow name="volume" type="number | undefined" desc="0–1; if undefined the component simulates" />
          <APIRow name="density" type="number" desc="node count, 20–140" />
          <APIRow name="scale" type="number" desc="global zoom multiplier" />
          <APIRow name="palette" type="ANSI[] | undefined" desc="override per-state palette" />
          <APIRow name="trail" type="boolean" desc="fade-to-clear backdrop" />
        </div>
      </div>

      {/* IMPERATIVE / WIRING */}
      <div style={{
        borderRadius: 16,
        background: "rgba(15,15,22,0.92)",
        boxShadow: "0 20px 40px -15px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.06)",
        padding: "18px 20px",
        fontFamily: "JetBrains Mono",
        color: "#e6e0d4",
      }}>
        <div style={{ fontSize: 11, letterSpacing: "0.18em", color: "rgba(230,224,212,0.45)", marginBottom: 12 }}>
          WIRING TO YOUR RUNTIME
        </div>
        <pre style={{
          margin: 0, fontSize: 11, lineHeight: 1.65,
          color: "rgba(230,224,212,0.85)",
          whiteSpace: "pre-wrap",
        }}>
{`const ref = useRef();
const { state, level } = useAblesrSession();
//  state: ASR/LLM-driven enum
//  level: live mic RMS, 0..1

<NeuralField
  ref={ref}
  state={state}        // "listening" | …
  volume={level}       // 0..1
  density={75}
/>

// fire a one-off when a tool call lands
session.on("tool_call", () => ref.current.fire());`}
        </pre>
      </div>
    </div>
  );
}

const APIRow = ({ name, type, desc }) => (
  <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 12, marginBottom: 2 }}>
    <span style={{ color: "#e6c466" }}>{name}</span>
    <span style={{ color: "rgba(230,224,212,0.55)" }}>
      <span style={{ color: "rgba(107,214,200,0.85)" }}>{type}</span>
      <span style={{ color: "rgba(230,224,212,0.35)", marginLeft: 8 }}>· {desc}</span>
    </span>
  </div>
);

// ════════════════════════════════════════════════════════════
// INTEGRATION — menu bar tray + dock-anchored variant
// ════════════════════════════════════════════════════════════
function M4TrayEmbed() {
  const { phase } = useVoiceLifecycle([
    { key: "idle", dur: 2.5 },
    { key: "listening", dur: 3.5 },
    { key: "thinking", dur: 1.8 },
    { key: "speaking", dur: 3.5 },
  ]);
  const mode = phase.key;

  return (
    <div>
      <MacStage width={620} height={400} wallpaper="graphite" asrTray={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <NeuralField width={20} height={14} state={mode} density={12} trail={false} />
        </span>
      }>
        {/* dropdown card from tray */}
        <div style={{
          position: "absolute", top: 36, right: 56,
          width: 270,
          borderRadius: 14,
          background: "rgba(10,10,16,0.86)",
          backdropFilter: "blur(40px) saturate(140%)",
          WebkitBackdropFilter: "blur(40px) saturate(140%)",
          boxShadow: "0 24px 50px -15px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.06)",
          overflow: "hidden",
          fontFamily: "JetBrains Mono",
        }}>
          <NeuralField width={270} height={130} state={mode} density={28} trail />
          <div style={{ padding: "10px 14px", fontSize: 11, color: "#e6e0d4", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ color: STATE_BADGE[mode].fg, marginBottom: 4 }}>
              {STATE_BADGE[mode].text}
            </div>
            <div style={{ color: "rgba(230,224,212,0.55)" }}>
              {mode === "idle"      && "click to summon · ⌃Space"}
              {mode === "listening" && "0:04 · pulses inbound"}
              {mode === "thinking"  && "resolving 3 sources…"}
              {mode === "speaking"  && "streaming reply · 12 tokens"}
            </div>
          </div>
        </div>

        {/* highlight arrow */}
        <svg style={{ position: "absolute", top: 28, right: 142, width: 50, height: 12 }} viewBox="0 0 50 12">
          <path d="M44 6 Q26 0 4 6" stroke="#c96442" strokeWidth="1.5" fill="none" />
          <path d="M4 6 L9 2 M4 6 L9 10" stroke="#c96442" strokeWidth="1.5" fill="none" />
        </svg>
      </MacStage>
      <FrameCaption tag="tray dropdown">
        <b style={{ color: "#e6e0d4" }}>Click the tray → mini-network preview.</b>{" "}
        <span style={{ color: "rgba(230,224,212,0.55)" }}>
          Same component, just{" "}
          <code style={{ color: "#e6c466" }}>density={"{"}28{"}"}</code>
          {" "}and 270×130. Always-on peripheral state.
        </span>
      </FrameCaption>
    </div>
  );
}

function M4DockEmbed() {
  return (
    <div>
      <MacStage width={620} height={400} wallpaper="dusk">
        {/* dock-anchored compact bar */}
        <div style={{
          position: "absolute", bottom: 28, left: "50%", transform: "translateX(-50%)",
          width: 480, height: 96,
          borderRadius: 24,
          background: "rgba(10,10,16,0.78)",
          backdropFilter: "blur(40px) saturate(140%)",
          WebkitBackdropFilter: "blur(40px) saturate(140%)",
          boxShadow: "0 24px 60px -15px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.08)",
          overflow: "hidden",
          display: "flex", alignItems: "center", gap: 12,
          padding: "0 18px",
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 14,
            background: "rgba(0,0,0,0.4)", overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
            flexShrink: 0,
          }}>
            <NeuralField width={64} height={64} state="speaking" density={20} trail />
          </div>
          <div style={{ flex: 1, fontFamily: "JetBrains Mono", color: "#e6e0d4", fontSize: 12 }}>
            <div style={{ color: STATE_BADGE.speaking.fg, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 3 }}>
              ▸ speaking
            </div>
            <div style={{ color: "#e6e0d4" }}>
              自由现金流 +18% YoY,Q3 单季 14.2 B
              <Caret />
            </div>
          </div>
          <Kbd2>⌃␣</Kbd2>
        </div>
      </MacStage>
      <FrameCaption tag="dock bar">
        <b style={{ color: "#e6e0d4" }}>Compact dock-anchored variant.</b>{" "}
        <span style={{ color: "rgba(230,224,212,0.55)" }}>
          When the user wants the answer in the corner of their
          eye while they keep working — the 64×64 network in a
          rounded chip is the avatar.
        </span>
      </FrameCaption>
    </div>
  );
}

// keyframes once
(() => {
  if (document.getElementById("m4-kf")) return;
  const s = document.createElement("style");
  s.id = "m4-kf";
  s.textContent = `
    @keyframes neural-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.7); }
    }
  `;
  document.head.appendChild(s);
})();

window.M4 = M4;
