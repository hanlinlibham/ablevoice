/* eslint-disable react/prop-types */
// M3 — Particle Voice
// Mac app where the VOICE is the UI. No waveform glyphs, no spinner —
// a living particle field IS the conversation. Different aesthetics
// give different "personalities" to the same lifecycle:
//   idle → listening → thinking → speaking → idle
//
// All scenes use real canvas particles via <ParticleField/>.

const { useState, useEffect } = React;

const M3 = () => (
  <div className="scene" style={{ background: "#15110d", borderColor: "rgba(255,255,255,0.06)" }}>
    <div className="scene-head">
      <h3 style={{ color: "#e6e0d4" }}>M3 · Particle Voice</h3>
      <span className="meta" style={{ color: "rgba(230,224,212,0.45)" }}>
        the voice is the UI · 5 personalities × 4 states
      </span>
    </div>

    {/* HERO — lifecycle cycler */}
    <M3Hero />
    <FrameCaption tag="hero · lifecycle">
      <b style={{ color: "#e6e0d4" }}>The whole loop, one HUD.</b>{" "}
      <span style={{ color: "rgba(230,224,212,0.55)" }}>
        idle (cyan dust) → listening (radial reaction to voice) →
        thinking (slow spiral) → speaking (emit outward as the
        reply materializes). Each state has its own physics; the
        same particles persist across them — they don't disappear,
        they re-organize.
      </span>
    </FrameCaption>

    {/* AESTHETICS GRID — 4 different personalities of the same metaphor */}
    <div style={{ marginTop: 28, marginBottom: 12, display: "flex", alignItems: "baseline", gap: 12 }}>
      <span style={{ fontFamily: "JetBrains Mono", fontSize: 12, color: "rgba(230,224,212,0.55)", letterSpacing: "0.06em" }}>
        ─── four personalities ───
      </span>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
      <ParticleScene
        title="01 · Constellation"
        kind="constellation"
        palette={["cyan", "white"]}
        mode="listening"
        caption={
          <>
            <b style={{ color: "#e6e0d4" }}>Sparse + connected.</b>{" "}
            <span style={{ color: "rgba(230,224,212,0.55)" }}>
              Points connected by faint lines. Reads as a star chart
              breathing. Quietest aesthetic — for people who find
              dense particles distracting.
            </span>
          </>
        }
      />
      <ParticleScene
        title="02 · Fluid orb"
        kind="fluid"
        palette={["cyan", "blue", "magenta"]}
        mode="listening"
        caption={
          <>
            <b style={{ color: "#e6e0d4" }}>Dense, watery.</b>{" "}
            <span style={{ color: "rgba(230,224,212,0.55)" }}>
              A liquid blob that bulges and snaps back with each
              syllable. Most "alive" feeling — for people who want
              the AI to feel like an entity.
            </span>
          </>
        }
      />
      <ParticleScene
        title="03 · Ember stream"
        kind="ember"
        palette={["orange", "yellow", "red"]}
        mode="speaking"
        caption={
          <>
            <b style={{ color: "#e6e0d4" }}>Upward, warm.</b>{" "}
            <span style={{ color: "rgba(230,224,212,0.55)" }}>
              Sparks drift up like a campfire. Best for the
              "speaking" state — feels like words being released
              into the room rather than displayed on a screen.
            </span>
          </>
        }
      />
      <ParticleScene
        title="04 · Mesh wave"
        kind="mesh"
        palette={["green", "cyan"]}
        mode="speaking"
        caption={
          <>
            <b style={{ color: "#e6e0d4" }}>Calm, controlled.</b>{" "}
            <span style={{ color: "rgba(230,224,212,0.55)" }}>
              A regular grid that ripples with voice. The most
              "engineering-honest" aesthetic — reads like an FFT
              you can almost decode. Keeps the terminal DNA.
            </span>
          </>
        }
      />
    </div>

    {/* MAC INTEGRATION */}
    <div style={{ marginTop: 4, marginBottom: 12 }}>
      <span style={{ fontFamily: "JetBrains Mono", fontSize: 12, color: "rgba(230,224,212,0.55)", letterSpacing: "0.06em" }}>
        ─── living on the Mac ───
      </span>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1fr", gap: 24 }}>
      <M3MenuBar />
      <M3Screenshot />
    </div>
  </div>
);

// ════════════════════════════════════════════════════════════
// HERO — auto-cycling lifecycle HUD
// ════════════════════════════════════════════════════════════
const HERO_TIMELINE = [
  { key: "idle",      dur: 3.0, label: "idle",        hint: "hold space, or just start speaking" },
  { key: "listening", dur: 5.0, label: "listening",   hint: "现金流那个,先告诉我自由现金流" },
  { key: "thinking",  dur: 3.0, label: "thinking",    hint: "" },
  { key: "speaking",  dur: 5.5, label: "speaking",    hint: "自由现金流 +18% YoY,Q3 单季 14.2 B,主要受云业务驱动…" },
];

function M3Hero() {
  const { phase, idx } = useVoiceLifecycle(HERO_TIMELINE);
  const mode = phase.key;

  // copy varies per phase
  const stateBadge = {
    idle:      { color: "cyan",    text: "○ ready",     bg: "rgba(107,214,200,0.18)", fg: "#6bd6c8" },
    listening: { color: "yellow",  text: "● listening", bg: "rgba(230,196,102,0.22)", fg: "#e6c466" },
    thinking:  { color: "magenta", text: "⠹ thinking",  bg: "rgba(201,138,214,0.22)", fg: "#c98ad6" },
    speaking:  { color: "green",   text: "▸ speaking",  bg: "rgba(126,194,122,0.22)", fg: "#7ec27a" },
  }[mode];

  const palette = {
    idle:      ["cyan", "white"],
    listening: ["yellow", "orange", "white"],
    thinking:  ["magenta", "blue"],
    speaking:  ["green", "cyan", "white"],
  }[mode];

  return (
    <MacStage width={1200} height={620} wallpaper="dusk" asrTray={
      <><MicroParticles mode={mode} palette={palette}/><span style={{marginLeft:6,fontFamily:"JetBrains Mono"}}>able-asr</span></>
    }>
      {/* HUD positioned center-low */}
      <div style={{
        position: "absolute",
        left: 200, top: 110, width: 800, height: 470,
        borderRadius: 28,
        background: "rgba(20,16,12,0.62)",
        backdropFilter: "blur(40px) saturate(140%)",
        WebkitBackdropFilter: "blur(40px) saturate(140%)",
        boxShadow: "0 40px 100px -20px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.08)",
        overflow: "hidden",
        display: "flex", flexDirection: "column",
      }}>
        {/* HUD header */}
        <div style={{
          padding: "14px 22px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          display: "flex", alignItems: "center", gap: 10,
          fontFamily: "JetBrains Mono", fontSize: 12,
          color: "rgba(230,224,212,0.85)",
        }}>
          <span style={{
            background: stateBadge.bg, color: stateBadge.fg,
            padding: "3px 10px", borderRadius: 6,
            fontWeight: 600, transition: "all 0.4s",
          }}>{stateBadge.text}</span>
          <span style={{ color: "rgba(230,224,212,0.4)" }}>~/</span>
          <span style={{ color: "#e6c466", fontWeight: 600 }}>q3-financials</span>
          <span style={{ flex: 1 }} />
          <span style={{ color: "rgba(230,224,212,0.4)" }}>paraformer · ablework · Maia</span>
        </div>

        {/* The particle field is the canvas — 320px tall, fills width */}
        <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
          <ParticleField
            width={800}
            height={320}
            mode={mode}
            style="dust"
            palette={palette}
            density={300}
            trail
          />
          {/* state label overlay */}
          <div style={{
            position: "absolute", left: 0, right: 0, top: "50%",
            transform: "translateY(-50%)",
            display: "flex", justifyContent: "center",
            pointerEvents: "none",
            opacity: mode === "thinking" ? 0.9 : 0.6,
            transition: "opacity 0.4s",
          }}>
            <div style={{
              fontFamily: "JetBrains Mono",
              fontSize: 11, letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: stateBadge.fg,
              padding: "4px 16px",
              borderRadius: 999,
              background: "rgba(0,0,0,0.35)",
              border: `1px solid ${stateBadge.bg}`,
            }}>
              {phase.label}
            </div>
          </div>
        </div>

        {/* live caption strip */}
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
              <span style={{ color: "rgba(230,224,212,0.4)" }}>to talk, or just start speaking</span>
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
              ⠹ resolving from {`{q3-revenue.csv, cashflow.md, board-deck.key}`}…
            </span>
          )}
          {mode === "speaking" && (
            <span style={{ color: "#e6e0d4" }}>{phase.hint}<Caret /></span>
          )}
        </div>
      </div>

      {/* corner phase pip — tiny timeline showing where in the cycle we are */}
      <div style={{
        position: "absolute", left: 200, top: 86,
        display: "flex", gap: 6,
        fontFamily: "JetBrains Mono", fontSize: 10,
        color: "rgba(230,224,212,0.4)",
      }}>
        {HERO_TIMELINE.map((p, i) => (
          <span key={i} style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            opacity: i === idx ? 1 : 0.45,
            transition: "opacity 0.3s",
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: 999,
              background: i === idx ? "#e6e0d4" : "rgba(230,224,212,0.3)",
              transition: "background 0.3s",
            }} />
            {p.label}
          </span>
        ))}
      </div>
    </MacStage>
  );
}

// Helper: little space-bar key
const Kbd2 = ({ children }) => (
  <span style={{
    display: "inline-block", padding: "2px 8px", borderRadius: 5,
    background: "rgba(255,255,255,0.1)", color: "#e6e0d4",
    fontFamily: "JetBrains Mono", fontSize: 12, fontWeight: 600,
  }}>{children}</span>
);

// ════════════════════════════════════════════════════════════
// Single-aesthetic scene block
// ════════════════════════════════════════════════════════════
function ParticleScene({ title, kind, palette, mode: initialMode, caption }) {
  // cycle the 4 modes for each scene so user sees each aesthetic across states
  const [mode, setMode] = useState(initialMode);
  const modes = ["idle", "listening", "thinking", "speaking"];

  return (
    <div>
      <MacStage width={580} height={420} wallpaper="noir">
        <div style={{
          position: "absolute", left: 40, top: 80, width: 500, height: 300,
          borderRadius: 22,
          background: "rgba(20,16,12,0.55)",
          backdropFilter: "blur(30px) saturate(140%)",
          WebkitBackdropFilter: "blur(30px) saturate(140%)",
          boxShadow: "0 30px 70px -20px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.06)",
          overflow: "hidden",
        }}>
          {/* header */}
          <div style={{
            padding: "10px 16px",
            display: "flex", alignItems: "center", gap: 10,
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            fontFamily: "JetBrains Mono", fontSize: 11,
            color: "rgba(230,224,212,0.75)",
          }}>
            <span style={{ color: "rgba(230,224,212,0.45)" }}>{title}</span>
            <span style={{ flex: 1 }} />
            {/* tiny mode chips */}
            {modes.map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  background: m === mode ? "rgba(230,224,212,0.15)" : "transparent",
                  border: "1px solid rgba(230,224,212," + (m === mode ? "0.3" : "0.1") + ")",
                  color: m === mode ? "#e6e0d4" : "rgba(230,224,212,0.45)",
                  fontFamily: "JetBrains Mono", fontSize: 10,
                  padding: "2px 7px", borderRadius: 4,
                  cursor: "pointer", letterSpacing: "0.03em",
                }}
              >{m}</button>
            ))}
          </div>
          {/* canvas */}
          <div style={{ position: "relative" }}>
            <ParticleField
              width={500}
              height={258}
              mode={mode}
              style={kind}
              palette={palette}
              trail={kind === "ember" || kind === "fluid"}
            />
          </div>
        </div>
      </MacStage>
      <FrameCaption tag={title.toLowerCase()}>{caption}</FrameCaption>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Mac menu bar tray indicator — same lifecycle, miniaturized
// ════════════════════════════════════════════════════════════
function MicroParticles({ mode, palette }) {
  return (
    <span style={{ display: "inline-block", verticalAlign: "middle" }}>
      <ParticleField
        width={18}
        height={14}
        mode={mode}
        style="dust"
        palette={palette}
        density={26}
        glow
      />
    </span>
  );
}

function M3MenuBar() {
  const { phase } = useVoiceLifecycle([
    { key: "idle",      dur: 2.5, label: "idle" },
    { key: "listening", dur: 3.5, label: "listening" },
    { key: "speaking",  dur: 3.0, label: "speaking" },
  ]);
  const mode = phase.key;
  const palette = mode === "idle" ? ["cyan"] :
                  mode === "listening" ? ["yellow", "orange"] :
                  ["green", "cyan"];

  return (
    <div>
      <MacStage width={580} height={420} wallpaper="graphite" asrTray={
        <><MicroParticles mode={mode} palette={palette} /></>
      }>
        {/* zoomed-in callout of the tray icon */}
        <div style={{
          position: "absolute", top: 60, right: 60,
          width: 220, height: 100,
          borderRadius: 14,
          background: "rgba(20,16,12,0.78)",
          backdropFilter: "blur(30px) saturate(140%)",
          WebkitBackdropFilter: "blur(30px) saturate(140%)",
          boxShadow: "0 20px 50px -15px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.06)",
          padding: "14px 18px",
          fontFamily: "JetBrains Mono",
          color: "#e6e0d4",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{
              width: 36, height: 28, borderRadius: 6,
              background: "rgba(0,0,0,0.4)",
              display: "flex", alignItems: "center", justifyContent: "center",
              border: "1px solid rgba(255,255,255,0.08)",
            }}>
              <ParticleField
                width={32}
                height={22}
                mode={mode}
                style="dust"
                palette={palette}
                density={60}
                glow
              />
            </div>
            <div style={{ fontSize: 12, color: "rgba(230,224,212,0.7)" }}>
              tray · live state
            </div>
          </div>
          <div style={{ fontSize: 11, color: "rgba(230,224,212,0.55)", lineHeight: 1.5 }}>
            no glyph spinner — the particle field {" "}
            <span style={{ color: "#e6c466" }}>{phase.label}</span>
            {" "}gives you the state at a glance
          </div>
        </div>

        {/* highlight arrow up to tray */}
        <svg style={{ position: "absolute", top: 26, right: 145, width: 50, height: 36 }} viewBox="0 0 50 36">
          <path d="M44 4 Q30 10 8 30" stroke="#c96442" strokeWidth="1.5" fill="none" />
          <path d="M8 30 L13 26 M8 30 L13 24" stroke="#c96442" strokeWidth="1.5" fill="none" />
        </svg>

        {/* desktop label */}
        <div style={{
          position: "absolute", left: 28, bottom: 24,
          fontFamily: "JetBrains Mono", fontSize: 12,
          color: "rgba(230,224,212,0.5)",
          maxWidth: 320, lineHeight: 1.5,
        }}>
          <div style={{ color: "#e6c466", marginBottom: 4 }}>5 · always-on indicator</div>
          The same particle "soul" lives in the menu bar — a 16×14
          field that breathes when armed, jitters when you talk,
          flows when it replies.
        </div>
      </MacStage>
      <FrameCaption tag="5 · menu bar">
        <b style={{ color: "#e6e0d4" }}>The icon IS the particle field.</b>{" "}
        <span style={{ color: "rgba(230,224,212,0.55)" }}>
          A 16×14 dust cloud lives in the tray and runs the same
          state machine as the HUD — peripheral awareness without
          a notification.
        </span>
      </FrameCaption>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Screenshot context — particles attaching to a dragged image
// ════════════════════════════════════════════════════════════
function M3Screenshot() {
  return (
    <div>
      <MacStage width={580} height={420} wallpaper="dusk">
        {/* fake screenshot thumb on desktop */}
        <div style={{
          position: "absolute", left: 350, top: 70,
          width: 180, height: 110,
          borderRadius: 8,
          background: "linear-gradient(135deg, rgba(107,159,227,0.4), rgba(126,194,122,0.3))",
          border: "1px solid rgba(255,255,255,0.18)",
          boxShadow: "0 14px 30px -10px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}>
          {/* fake chart inside screenshot */}
          <svg viewBox="0 0 180 110" style={{ position: "absolute", inset: 0 }}>
            <polyline
              points="10,80 30,60 50,70 70,40 90,55 110,30 130,42 150,22 170,28"
              stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" fill="none" />
            <polyline
              points="10,90 30,82 50,86 70,72 90,80 110,68 130,72 150,60 170,64"
              stroke="rgba(255,255,255,0.3)" strokeWidth="1" fill="none" />
            <text x="10" y="20" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(255,255,255,0.6)">毛利率 ↘</text>
          </svg>
        </div>

        {/* HUD with screenshot thumbnail attached */}
        <div style={{
          position: "absolute", left: 40, bottom: 32, width: 500,
          borderRadius: 18,
          background: "rgba(20,16,12,0.72)",
          backdropFilter: "blur(30px) saturate(140%)",
          WebkitBackdropFilter: "blur(30px) saturate(140%)",
          boxShadow: "0 30px 70px -20px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.06)",
          overflow: "hidden",
        }}>
          {/* particles + screenshot pinned together */}
          <div style={{ display: "flex", alignItems: "center", gap: 0, padding: 14, position: "relative" }}>
            {/* mini screenshot thumb anchored on the LEFT, particles wrap around it */}
            <div style={{
              width: 76, height: 50, borderRadius: 5,
              background: "linear-gradient(135deg, rgba(107,159,227,0.5), rgba(126,194,122,0.3))",
              border: "1px solid rgba(255,255,255,0.2)",
              position: "relative", overflow: "hidden",
              flexShrink: 0,
            }}>
              <svg viewBox="0 0 76 50" style={{ position: "absolute", inset: 0 }}>
                <polyline points="4,38 14,28 24,32 34,18 44,24 54,12 64,18 72,10"
                  stroke="rgba(255,255,255,0.7)" strokeWidth="1" fill="none" />
              </svg>
            </div>
            {/* particle field expanding rightward — the voice */}
            <div style={{ flex: 1, position: "relative", marginLeft: -8 }}>
              <ParticleField
                width={400}
                height={50}
                mode="listening"
                style="dust"
                palette={["yellow", "orange", "white"]}
                density={140}
                center={{ x: 30, y: 25 }}
                trail
              />
            </div>
          </div>
          {/* transcript */}
          <div style={{
            padding: "10px 16px 16px",
            borderTop: "1px solid rgba(255,255,255,0.05)",
            fontFamily: "JetBrains Mono", fontSize: 13,
            color: "#e6e0d4", lineHeight: 1.6,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <Span c="dim">{"› "}</Span>
            <span style={{ fontStyle: "italic" }}>
              这块的毛利率为什么环比下降这么多
            </span>
            <Caret />
            <span style={{ flex: 1 }} />
            <span style={{
              fontSize: 10,
              color: "rgba(230,224,212,0.4)",
              padding: "2px 7px",
              borderRadius: 4,
              background: "rgba(255,255,255,0.05)",
            }}>1 attachment</span>
          </div>
        </div>

        {/* drag arrow */}
        <svg style={{ position: "absolute", top: 130, left: 320, width: 80, height: 140 }} viewBox="0 0 80 140">
          <path d="M70 20 Q40 40 18 110" stroke="rgba(201,100,66,0.7)" strokeWidth="1.5" fill="none" strokeDasharray="3 3" />
          <path d="M18 110 L24 104 M18 110 L26 108" stroke="rgba(201,100,66,0.7)" strokeWidth="1.5" fill="none" />
        </svg>
      </MacStage>
      <FrameCaption tag="6 · screenshot context">
        <b style={{ color: "#e6e0d4" }}>Drag a screenshot into the cloud.</b>{" "}
        <span style={{ color: "rgba(230,224,212,0.55)" }}>
          Particles wrap around the dropped image and your voice
          fans out from it. Visual proof that this turn has
          attached context — no "1 file attached" pill needed.
        </span>
      </FrameCaption>
    </div>
  );
}

window.M3 = M3;
