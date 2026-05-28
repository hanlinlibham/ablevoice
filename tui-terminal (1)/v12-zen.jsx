/* eslint-disable react/prop-types */
// V12 — Cursor-as-status (zen mode)
// The most radical UI subtraction: no status bar, no chips, no panels, no
// footer. Just conversation, full bleed. The cursor itself carries all the
// state: shape + color + blink = mode + recording + workspace.
// One ultra-faint line of dimmed hint text fades in/out at the very bottom.
// Hover the cursor (or press ?) to get a 200ms transient overlay.

const V12 = () => (
  <div className="proto">
    <div className="label-row">
      <h3>V12 · Cursor-as-status</h3>
      <span className="meta">无 chrome · 光标本身=状态 · 极简禅模式</span>
    </div>
    <div className="stack">
      <V12Row state="idle"      cols={100} />
      <V12Row state="recording" cols={100} />
      <V12Row state="thinking"  cols={100} />
      <V12Row state="reveal"    cols={140} />
    </div>
    <p className="cap">
      <span className="pill">why</span>
      Most TUIs treat the cursor as <i>where you type</i> — but in voice-first apps
      you don't type much. So make the cursor do real work: <b>shape, color, blink
      rate, trail = mode + workspace + activity</b>. Idle = thin gray vertical bar.
      Recording = solid yellow block, slow pulse. Thinking = blinking green diamond.
      Polish in flight = small magenta caret with sparkle trail. The hint line at the
      bottom is the only chrome and it dims to 4% opacity when you're not in idle.
    </p>
  </div>
);

const V12Row = ({ state, cols }) => {
  const labels = {
    idle:      "(a)  IDLE — thin gray bar, slow blink, hint visible",
    recording: "(b)  RECORDING — solid yellow block, pulse, ghost transcript appearing inline",
    thinking:  "(c)  THINKING — blinking green diamond at end of partial reply",
    reveal:    "(d)  REVEAL — pressing ? lifts a translucent overlay for 2s",
  };
  return (
    <div>
      <div style={{ fontFamily: "JetBrains Mono", fontSize: 11, color: "#6b665b", marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {labels[state]}
      </div>
      <Term cols={cols} rows={18} clock="18:50">
        {state === "idle"      && <V12Idle      cols={cols} />}
        {state === "recording" && <V12Recording cols={cols} />}
        {state === "thinking"  && <V12Thinking  cols={cols} />}
        {state === "reveal"    && <V12Reveal    cols={cols} />}
      </Term>
    </div>
  );
};

// Custom cursors for each mode
const CursorIdle = () => (
  <span style={{
    display: "inline-block", width: "0.55ch", height: "1.1em",
    background: "#8a8378", verticalAlign: "text-bottom",
    animation: "blink 1.4s steps(2, start) infinite",
  }} />
);
const CursorRecording = () => (
  <span style={{
    display: "inline-block", width: "1ch", height: "1.1em",
    background: "var(--ansi-yellow)", verticalAlign: "text-bottom",
    boxShadow: "0 0 0 1px rgba(230,196,102,0.4)",
    animation: "v12pulse 1.2s ease-in-out infinite",
  }} />
);
const CursorThinking = () => (
  <span style={{
    display: "inline-block",
    color: "var(--ansi-green)",
    fontWeight: 700,
    animation: "v12diamond 0.6s steps(2, start) infinite",
  }}>◆</span>
);

// ---------- (a) idle ----------
const V12Idle = ({ cols }) => (
  <>
    <Blank n={2} />
    <Line>
      <Span c="dim">{"   "}</Span>
      <Span c="green" b>{"›"}</Span>
      <Span c="fg">{" 营收同比 +12%,云业务占比首次超过 30%,毛利率提升 1.8pt。"}</Span>
    </Line>
    <Line>
      <Span c="dim">{"   "}</Span>
      <Span c="green" b>{"›"}</Span>
      <Span c="fg">{" 这是公司战略转型的关键拐点。"}</Span>
    </Line>
    <Blank n={2} />
    <Line>
      <Span c="dim">{"   "}</Span>
      <Span c="cyan" b>{"›"}</Span>
      <Span c="fg">{" "}</Span>
      <CursorIdle />
    </Line>
    <Blank n={cols => 4} />
    <Blank n={4} />
    {/* faint hint at very bottom — 60% dim */}
    <Line>
      <Span style={{ opacity: 0.55 }}>
        <Span c="dim">{"   hold "}</Span>
        <Span c="dim" b>{"space"}</Span>
        <Span c="dim">{" to talk    ·    "}</Span>
        <Span c="dim" b>{"?"}</Span>
        <Span c="dim">{" for keys    ·    📁 "}</Span>
        <Span c="dim" b>{"研究 Q3 财报"}</Span>
      </Span>
    </Line>
  </>
);

// ---------- (b) recording ----------
const V12Recording = ({ cols }) => (
  <>
    <Blank n={2} />
    <Line>
      <Span c="dim">{"   "}</Span>
      <Span c="green" b>{"›"}</Span>
      <Span c="fg">{" 营收同比 +12%,云业务占比首次超过 30%,毛利率提升 1.8pt。"}</Span>
    </Line>
    <Line>
      <Span c="dim">{"   "}</Span>
      <Span c="green" b>{"›"}</Span>
      <Span c="fg">{" 这是公司战略转型的关键拐点。"}</Span>
    </Line>
    <Blank n={2} />
    {/* live partial transcript appearing as ghost text */}
    <Line>
      <Span c="dim">{"   "}</Span>
      <Span c="cyan" b>{"›"}</Span>
      <Span c="fg">{" "}</Span>
      <Span c="yellow" i>{"现金流那个先告诉我自由现金流"}</Span>
      <Span c="fg">{" "}</Span>
      <CursorRecording />
    </Line>
    <Blank n={4} />
    {/* almost-invisible bottom hint */}
    <Line>
      <Span style={{ opacity: 0.18 }}>
        <Span c="dim">{"   recording…    release "}</Span>
        <Span c="dim" b>{"space"}</Span>
        <Span c="dim">{" to send    "}</Span>
        <Span c="dim" b>{"esc"}</Span>
        <Span c="dim">{" to cancel"}</Span>
      </Span>
    </Line>
  </>
);

// ---------- (c) thinking ----------
const V12Thinking = ({ cols }) => (
  <>
    <Blank n={2} />
    <Line>
      <Span c="dim">{"   "}</Span>
      <Span c="cyan" b>{"›"}</Span>
      <Span c="fg">{" 现金流那个先告诉我自由现金流"}</Span>
      <Span c="magenta">{"  ✨"}</Span>
    </Line>
    <Blank n={2} />
    <Line>
      <Span c="dim">{"   "}</Span>
      <Span c="green" b>{"›"}</Span>
      <Span c="fg">{" 自由现金流 +18% YoY,Q3 单季 14.2 B,经营性 22.1 B,"}</Span>
    </Line>
    <Line>
      <Span c="dim">{"   "}</Span>
      <Span c="green" b>{"›"}</Span>
      <Span c="fg">{" 主要受云业务现金贡献提升和应收账款周转优化"}</Span>
      <Span c="fg">{" "}</Span>
      <CursorThinking />
    </Line>
    <Blank n={4} />
    <Line>
      <Span style={{ opacity: 0.22 }}>
        <Span c="dim">{"   "}</Span>
        <Span c="dim" b>{"i"}</Span>
        <Span c="dim">{" to interrupt    "}</Span>
        <Span c="dim" b>{"space"}</Span>
        <Span c="dim">{" to barge in"}</Span>
      </Span>
    </Line>
  </>
);

// ---------- (d) reveal — pressed ? for 2s peek ----------
const V12Reveal = ({ cols }) => (
  <>
    {/* ghosted convo behind */}
    <Blank n={1} />
    <Line>
      <Span style={{ opacity: 0.25 }}>
        <Span c="dim">{"   "}</Span><Span c="green" b>{"›"}</Span><Span c="fg">{" 营收同比 +12%,云业务占比首次超过 30%……"}</Span>
      </Span>
    </Line>
    <Line>
      <Span style={{ opacity: 0.25 }}>
        <Span c="dim">{"   "}</Span><Span c="cyan" b>{"›"}</Span><Span c="fg">{" 现金流那个先告诉我自由现金流"}</Span>
      </Span>
    </Line>
    <Blank n={1} />
    {/* the overlay card centered */}
    {(() => {
      const w = 78;
      const pad = " ".repeat(Math.floor((cols - w) / 2));
      const row = (k, label) => (
        <Line>
          {pad}
          <Span c="border">{"│  "}</Span>
          <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{` ${k} `}</Span>
          <Span c="fg">{`   ${label}`}</Span>
          <Span c="border">{" ".repeat(w - 12 - k.length - label.length)}</Span>
          <Span c="border">{"│"}</Span>
        </Line>
      );
      return (
        <>
          <Line>{pad}<Span c="border">{"╭" + "─".repeat(w - 2) + "╮"}</Span></Line>
          <Line>
            {pad}
            <Span c="border">{"│  "}</Span>
            <Span c="cyan" b>{"able-asr · cheat sheet"}</Span>
            <Span c="dim">{"   fades in 2s    "}</Span>
            <Span c="dim">{`📁 研究 Q3 财报 · ★705ms `}</Span>
            <Span c="border">{"│"}</Span>
          </Line>
          <Line>{pad}<Span c="border">{"├" + "─".repeat(w - 2) + "┤"}</Span></Line>
          {row("space", "hold to record · release to send")}
          {row("i    ", "interrupt the AI mid-reply")}
          {row("w    ", "switch workspace")}
          {row("v/V  ", "voice settings (lower / upper)")}
          {row("p    ", "toggle polish")}
          {row("?    ", "this peek")}
          {row("q    ", "quit")}
          <Line>{pad}<Span c="border">{"╰" + "─".repeat(w - 2) + "╯"}</Span></Line>
        </>
      );
    })()}
    <Blank n={2} />
  </>
);

window.V12 = V12;

// inject the v12 keyframes if not already there
(() => {
  if (document.getElementById("v12-kf")) return;
  const s = document.createElement("style");
  s.id = "v12-kf";
  s.textContent = `
    @keyframes v12pulse { 0%,100%{opacity:1} 50%{opacity:0.55} }
    @keyframes v12diamond { to { visibility: hidden; } }
  `;
  document.head.appendChild(s);
})();
