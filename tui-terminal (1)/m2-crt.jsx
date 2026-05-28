/* eslint-disable react/prop-types */
// M2 — CRT-on-Desktop
// Refuses to assimilate. Full skeumorphic CRT terminal floating on the macOS
// desktop: scanlines, phosphor glow, chunky beveled bezel. This is the
// strongest possible brand assertion. ~95% terminal, 5% Mac (only the desktop
// underneath and the menu bar concede).

const M2 = () => (
  <div className="scene">
    <div className="scene-head">
      <h3>M2 · CRT-on-Desktop</h3>
      <span className="meta">95/5 — refuses to assimilate · phosphor over Sequoia</span>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 20, marginBottom: 20 }}>
      <div>
        <M2Summoned />
        <FrameCaption tag="1 · summoned">
          ⌃Space and a green-phosphor CRT pops in mid-screen. Floats on real macOS but stays unmistakably <i>itself</i>. Scanlines, vignette, phosphor bleed.
        </FrameCaption>
      </div>
      <div>
        <M2MenuBar />
        <FrameCaption tag="2 · menu bar">
          Tray icon = mini CRT. Drop-down is a tiny CRT too — even the preview refuses to be a SwiftUI sheet.
        </FrameCaption>
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
      <div>
        <M2Recording />
        <FrameCaption tag="3 · recording">
          Phosphor flickers in sync with voice level. Live partial transcript scrolls up. Mode written as an <i>ASCII status line</i>, not a Mac chip.
        </FrameCaption>
      </div>
      <div>
        <M2Multiturn />
        <FrameCaption tag="4 · multi-turn">
          Conversation IS a scrolling terminal session, not a stack of bubbles. Older turns dim into phosphor decay.
        </FrameCaption>
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 20 }}>
      <div>
        <M2Workspace />
        <FrameCaption tag="5 · workspace">
          <code style={{fontFamily:"JetBrains Mono"}}>cd</code> prompt, real shell vibe. <code>⇥</code> completes. <code>⏎</code> jumps. Voice still works.
        </FrameCaption>
      </div>
      <div>
        <M2Screenshot />
        <FrameCaption tag="6 · screenshot context">
          Native macOS selection lasso, but the image lands in the CRT as <b>ASCII art preview</b> + a thin attachment tag. Most absurd × most on-brand.
        </FrameCaption>
      </div>
    </div>
  </div>
);

// ====================== 1. Summoned ======================
const M2Summoned = () => (
  <MacStage width={720} height={460} wallpaper="dawn">
    <CRT x={140} y={130} width={440} height={250}>
      <div className="glow" style={{ fontSize: 13, lineHeight: 1.7 }}>
        <Line><Span c="green" b>{"able-asr 0.4.2"}</Span><Span c="green">{"  ·  ready"}</Span></Line>
        <Line><Span c="green">{"workspace: "}</Span><Span c="green" b>{"~/default"}</Span><Span c="green">{"  ·  paraformer · ablework · Maia"}</Span></Line>
        <Blank n={1} />
        <Line><Span c="green" b>{"$"}</Span><Span c="green">{" "}</Span><span style={{
          display: "inline-block", width: "0.6em", height: "1.1em",
          background: "#b8e066", verticalAlign: "text-bottom",
          boxShadow: "0 0 6px rgba(184,224,102,0.7)",
          animation: "m2blink 1s steps(2,start) infinite",
        }} /></Line>
        <Blank n={1} />
        <Line><Span c="green">{"hold "}</Span><Span c="green" b>{"[space]"}</Span><Span c="green">{" to talk · "}</Span><Span c="green" b>{"[esc]"}</Span><Span c="green">{" to dismiss"}</Span></Line>
        <Line><Span c="green">{"or just speak: "}</Span><Span c="green" i>{"\"看一下今天的财报\""}</Span></Line>
        <Blank n={1} />
        <Line><Span c="green" style={{opacity:0.55}}>{"─ tip: ⌘⇧4 to attach a screenshot"}</Span></Line>
      </div>
    </CRT>
    <Kbd x={620} y={395}>⌃Space</Kbd>
  </MacStage>
);

// ====================== 2. Menu bar dropdown ======================
const M2MenuBar = () => (
  <MacStage width={500} height={460} wallpaper="dawn"
    asrTray={<><span style={{
      display:"inline-block", width:14, height:10, borderRadius:2,
      background:"#0a1404", boxShadow:"inset 0 0 4px rgba(184,224,102,0.6), 0 0 0 1px rgba(0,0,0,0.4)",
      position:"relative",
    }}>
      <span style={{
        position:"absolute", inset:2, background:"#b8e066", opacity:0.7,
        borderRadius:1,
      }} />
    </span></>}
  >
    {/* mini CRT dropdown */}
    <CRT x={170} y={36} width={300} height={220} style={{ borderRadius: 8 }}>
      <div className="glow" style={{ fontSize: 12, lineHeight: 1.6 }}>
        <Line><Span c="green" b>{"⠹ thinking"}</Span><Span c="green">{"  · ~/q3-financials"}</Span></Line>
        <Line><Span c="green" style={{opacity:0.5}}>{"─".repeat(34)}</Span></Line>
        <Blank n={1} />
        <Line><Span c="green">{"last:"}</Span></Line>
        <Line><Span c="green" b>{"营收 +12%, 云业务占比 30%+,"}</Span></Line>
        <Line><Span c="green" b>{"毛利率提升 1.8pt"}</Span></Line>
        <Blank n={1} />
        <Line><Span c="green" style={{opacity:0.5}}>{"feels ≈ snappy · 3 turns"}</Span></Line>
        <Blank n={1} />
        <Line><Span c="green">{"["}</Span><Span c="green" b>{"⌃Space"}</Span><Span c="green">{"] open"}</Span><Span c="green" style={{opacity:0.5}}>{"   ["}</Span><Span c="green" b>{"q"}</Span><Span c="green" style={{opacity:0.5}}>{"] quit"}</Span></Line>
      </div>
    </CRT>
    {/* arrow to tray */}
    <svg style={{ position: "absolute", top: 30, right: 70, width: 60, height: 12 }} viewBox="0 0 60 12">
      <path d="M58 6 Q40 0 4 6" stroke="#c96442" strokeWidth="1.5" fill="none" />
      <path d="M4 6 L9 2 M4 6 L9 10" stroke="#c96442" strokeWidth="1.5" fill="none" />
    </svg>
  </MacStage>
);

// ====================== 3. Recording ======================
const M2Recording = () => {
  const samples = fakeSpeech(40, 3);
  return (
    <MacStage width={620} height={460} wallpaper="dawn">
      <CRT x={70} y={120} width={480} height={280}>
        <div className="glow" style={{ fontSize: 13, lineHeight: 1.65 }}>
          <Line><Span c="green" b>{"able-asr"}</Span><Span c="green">{"  ·  ~/q3-financials"}</Span></Line>
          <Line><Span c="green" style={{opacity:0.5}}>{"─".repeat(52)}</Span></Line>
          <Blank n={1} />
          {/* prior turn */}
          <Line><Span c="green" style={{opacity:0.45}}>{"› 营收同比 +12%, 云业务占比首次 30%+"}</Span></Line>
          <Blank n={1} />
          {/* recording status line */}
          <Line>
            <Span c="green" b>{"●REC"}</Span>
            <Span c="green">{"  0:23  "}</Span>
            <Span c="green">{"["}</Span>
            <Span c="green" b>{"████████████"}</Span>
            <Span c="green" style={{opacity:0.4}}>{"░░░░░░░░░░░░"}</Span>
            <Span c="green">{"]  peak 78%"}</Span>
          </Line>
          {/* mini waveform */}
          <div style={{ fontSize: 12, lineHeight: 1.1, marginTop: 4, marginBottom: 4 }}>
            <HudWave samples={samples} rows={3} cols={42} c="green" />
          </div>
          <Blank n={1} />
          <Line><Span c="green">{"› "}</Span><Span c="green" b i>{"现金流那个先告诉我自由现金流"}</Span><span style={{
            display:"inline-block", width:"0.6em", height:"1.1em", background:"#b8e066",
            verticalAlign:"text-bottom", boxShadow:"0 0 6px rgba(184,224,102,0.7)",
            animation:"m2blink 1s steps(2,start) infinite",
          }} /></Line>
          <Blank n={1} />
          <Line><Span c="green" style={{opacity:0.45}}>{"release [space] to send · [esc] cancel"}</Span></Line>
        </div>
      </CRT>
    </MacStage>
  );
};

// ====================== 4. Multi-turn ======================
const M2Multiturn = () => (
  <MacStage width={620} height={460} wallpaper="dawn">
    <CRT x={70} y={60} width={480} height={360}>
      <div className="glow" style={{ fontSize: 12, lineHeight: 1.55 }}>
        <Line><Span c="green" b>{"able-asr"}</Span><Span c="green">{"  ·  ~/q3-financials  ·  18:50"}</Span></Line>
        <Line><Span c="green" style={{opacity:0.5}}>{"─".repeat(56)}</Span></Line>
        <Blank n={1} />
        {/* fade 1 */}
        <Line><Span c="green" style={{opacity:0.35}}>{"› 请帮我看一下今天的财报数据"}</Span></Line>
        <Line><Span c="green" style={{opacity:0.35}}>{"  营收 +12%, 云业务占比首次 30%+, 毛利率提升 1.8pt"}</Span></Line>
        <Blank n={1} />
        {/* fade 2 */}
        <Line><Span c="green" style={{opacity:0.55}}>{"› 云业务那块再展开讲讲?"}</Span></Line>
        <Line><Span c="green" style={{opacity:0.55}}>{"  云业务 14.2B, SaaS 占 62%, 首次贡献正经营现金流"}</Span></Line>
        <Blank n={1} />
        {/* fade 3 */}
        <Line><Span c="green" style={{opacity:0.75}}>{"› 自由现金流呢? ✨"}</Span></Line>
        <Line><Span c="green" style={{opacity:0.75}}>{"  自由现金流 +18% YoY, Q3 单季 14.2B"}</Span></Line>
        <Blank n={1} />
        {/* current */}
        <Line><Span c="green" b>{"› 增速比经营现金流快多少?"}</Span></Line>
        <Line><Span c="green">{"  ⠹ thinking · TTS 2/5 · "}</Span><span style={{
          display:"inline-block", width:"0.6em", height:"1.1em", background:"#b8e066",
          verticalAlign:"text-bottom", boxShadow:"0 0 6px rgba(184,224,102,0.7)",
          animation:"m2blink 1s steps(2,start) infinite",
        }} /></Line>
        <Blank n={1} />
        <Line><Span c="green" style={{opacity:0.5}}>{"─".repeat(56)}</Span></Line>
        <Line><Span c="green" style={{opacity:0.5}}>{"[space] talk · [i] interrupt · [⌘k] clear · [⇥] ws"}</Span></Line>
      </div>
    </CRT>
  </MacStage>
);

// ====================== 5. Workspace ======================
const M2Workspace = () => (
  <MacStage width={520} height={460} wallpaper="dawn">
    <CRT x={70} y={120} width={380} height={280}>
      <div className="glow" style={{ fontSize: 13, lineHeight: 1.6 }}>
        <Line><Span c="green" b>{"$ cd "}</Span><Span c="green" b style={{background:"rgba(184,224,102,0.18)", padding:"0 2px"}}>{"q3"}</Span><span style={{
          display:"inline-block", width:"0.6em", height:"1.1em", background:"#b8e066",
          verticalAlign:"text-bottom", boxShadow:"0 0 6px rgba(184,224,102,0.7)",
          animation:"m2blink 1s steps(2,start) infinite",
        }} /></Line>
        <Line><Span c="green" style={{opacity:0.5}}>{"matches:"}</Span></Line>
        <Blank n={1} />
        <Line><Span c="green" b>{"› "}</Span><Span c="green" b>{"~/q3-financials"}</Span><Span c="green" style={{opacity:0.55}}>{"   17 files  ● live"}</Span></Line>
        <Line><Span c="green">{"  "}</Span><Span c="green">{"~/q3-board-deck"}</Span><Span c="green" style={{opacity:0.55}}>{"   8 files  · 2h"}</Span></Line>
        <Blank n={1} />
        <Line><Span c="green" style={{opacity:0.5}}>{"others:"}</Span></Line>
        <Line><Span c="green" style={{opacity:0.55}}>{"  ~/research-base   42 files · 2d"}</Span></Line>
        <Line><Span c="green" style={{opacity:0.55}}>{"  ~/scratch          6 files · 1d"}</Span></Line>
        <Line><Span c="green">{"  ~/inbox            "}</Span><Span c="green" b>{"3 unread"}</Span></Line>
        <Blank n={1} />
        <Line><Span c="green" style={{opacity:0.5}}>{"⇥ next · ⏎ enter · ⌘N new · or say \"切到 ...\""}</Span></Line>
      </div>
    </CRT>
  </MacStage>
);

// ====================== 6. Screenshot context ======================
const M2Screenshot = () => (
  <MacStage width={620} height={460} wallpaper="dawn">
    {/* desktop lasso */}
    <svg style={{ position: "absolute", top: 60, left: 380, pointerEvents: "none" }} width="200" height="120">
      <rect x="6" y="6" width="188" height="108" fill="rgba(107,159,227,0.18)" stroke="#6b9fe3" strokeWidth="1.5" strokeDasharray="4 3" />
      <text x="12" y="22" fontFamily="JetBrains Mono" fontSize="10" fill="#6b9fe3" fontWeight="700">200 × 120</text>
    </svg>
    <CRT x={70} y={210} width={480} height={210}>
      <div className="glow" style={{ fontSize: 12, lineHeight: 1.55 }}>
        <Line><Span c="green">{"📎 attached: "}</Span><Span c="green" b>{"Screenshot 2026-05-26 18-50-12.png"}</Span><Span c="green" style={{opacity:0.5}}>{"  200×120"}</Span></Line>
        <Blank n={1} />
        {/* ASCII art preview */}
        <Line><Span c="green" style={{opacity:0.7}}>{"┌──────────────────────────────────────┐"}</Span></Line>
        <Line><Span c="green" style={{opacity:0.7}}>{"│ "}</Span><Span c="green">{"   ▁▂▄▇█▇▄▂▁                    "}</Span><Span c="green" style={{opacity:0.7}}>{"   │"}</Span></Line>
        <Line><Span c="green" style={{opacity:0.7}}>{"│ "}</Span><Span c="green">{"▁▂▄▇████████▇▆▄▂▁          ▁▂▄  "}</Span><Span c="green" style={{opacity:0.7}}>{"   │"}</Span></Line>
        <Line><Span c="green" style={{opacity:0.7}}>{"│ "}</Span><Span c="green">{"Q1   Q2   Q3   Q4   Q1   Q2     "}</Span><Span c="green" style={{opacity:0.7}}>{"   │"}</Span></Line>
        <Line><Span c="green" style={{opacity:0.7}}>{"└──────────────────────────────────────┘"}</Span></Line>
        <Blank n={1} />
        <Line><Span c="green" b>{"●REC"}</Span><Span c="green">{"  0:08  "}</Span><Span c="green">{"›"}</Span><Span c="green" i>{" 这块的毛利率为什么环比下降"}</Span><span style={{
          display:"inline-block", width:"0.6em", height:"1.1em", background:"#b8e066",
          verticalAlign:"text-bottom", boxShadow:"0 0 6px rgba(184,224,102,0.7)",
          animation:"m2blink 1s steps(2,start) infinite",
        }} /></Line>
      </div>
    </CRT>
  </MacStage>
);

// ===== keyframes =====
(() => {
  if (document.getElementById("m2-kf")) return;
  const s = document.createElement("style");
  s.id = "m2-kf";
  s.textContent = `
    @keyframes m2blink { to { visibility: hidden; } }
  `;
  document.head.appendChild(s);
})();

window.M2 = M2;
