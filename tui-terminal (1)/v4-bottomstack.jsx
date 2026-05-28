/* eslint-disable react/prop-types */
// V4 — Compact Bottom-Stack
// All telemetry sinks to bottom in a tight 3-row stack:
//   row 1: latency sparklines + provider stack
//   row 2: mic meter ⊕ mode chip ⊕ workspace
//   row 3: hotkeys
// Top half is 100% conversation. Welcome card on first launch.

const V4 = () => (
  <div className="proto">
    <div className="label-row">
      <h3>V4 · Compact Bottom-Stack</h3>
      <span className="meta">all chrome → bottom · sparklines on latency</span>
    </div>
    <div className="stack">
      <V4Variant cols={80} state="empty" />
      <V4Variant cols={120} state="recording" />
    </div>
    <p className="cap">
      <span className="pill">why</span>
      Keyboard-driven users stare at the <i>bottom</i> when they're acting and the
      <i> top</i> when they're reading. Put status near the hands, conversation under
      the eyes. Latency gets a real <b>sparkline</b> so you can see trend, not just a
      number. Mic meter, mode chip, and workspace share the middle row, separated by
      thin column rules.
    </p>
  </div>
);

const V4Variant = ({ cols, state }) => (
  <div>
    <Term cols={cols} rows={24} clock="18:50">
      {state === "empty" ? <V4Empty cols={cols} /> : <V4Recording cols={cols} />}
    </Term>
    <div className="cap" style={{ marginTop: 10 }}>
      <span className="pill">{cols} cols</span>
      {state === "empty"
        ? "Empty / welcome — clean top, action stack at bottom."
        : "Mid-recording — meter live, sparklines show prior-round latencies."}
    </div>
  </div>
);

// The 3-row bottom stack
const V4BottomStack = ({ cols, mode = "idle" }) => {
  const modeChip = {
    idle:  { bg: "var(--ansi-cyan)",    fg: "#14201f", txt: " ✓ 就绪    " },
    rec:   { bg: "var(--ansi-yellow)",  fg: "#1a1814", txt: " ⠋ 录音中   " },
    think: { bg: "var(--ansi-green)",   fg: "#14201a", txt: " ⠹ 思考中   " },
  }[mode];

  // Row 1 — sparkline telemetry
  const row1 = (
    <Line>
      <Span c="dim">{" ★ 首音 "}</Span>
      <Spark values={[0.7,0.5,0.6,0.45,0.55,0.4,0.5,0.42,0.38,0.5,0.42,0.38]} c="green" />
      <Span c="green" b>{"  705"}</Span>
      <Span c="dim">{"ms      "}</Span>
      <Span c="dim">{"Σ total "}</Span>
      <Spark values={[0.85,0.7,0.8,0.6,0.75,0.55,0.65,0.6,0.55,0.7,0.65,0.6]} c="cyan" />
      <Span c="cyan" b>{"  2.34"}</Span>
      <Span c="dim">{"s     "}</Span>
      {cols >= 100 && (
        <>
          <Span c="dim">{"ASR "}</Span>
          <Span c="cyan">{"paraformer-rt"}</Span>
          <Span c="dim">{"  LLM "}</Span>
          <Span c="cyan">{"ablework"}</Span>
          <Span c="dim">{"  TTS "}</Span>
          <Span c="cyan">{"Maia"}</Span>
        </>
      )}
    </Line>
  );

  // Row 2 — meter | mode | workspace
  const meterFilled = mode === "rec" ? 18 : 0;
  const row2 = (
    <Line>
      {mode === "rec" ? (
        <>
          <Span c="yellow" b>{" 00:23 "}</Span>
          <Span c="green">{"█".repeat(meterFilled)}</Span>
          <Span c="faint">{"░".repeat(28 - meterFilled)}</Span>
        </>
      ) : (
        <>
          <Span c="faint">{" 00:00 "}</Span>
          <Span c="faint">{"·".repeat(28)}</Span>
        </>
      )}
      <Span c="border">{"  │  "}</Span>
      <Span bg={modeChip.bg} b style={{ color: modeChip.fg }}>{modeChip.txt}</Span>
      <Span c="border">{"  │  "}</Span>
      <Span c="yellow">{"📁 "}</Span>
      <Span c="yellow" b>{mode === "idle" ? "默认 sandbox" : "研究 Q3 财报"}</Span>
    </Line>
  );

  // Row 3 — hotkeys
  const items = mode === "rec"
    ? [["i","打断"],["space","停录"],["w","工作区"],["?","全部"]]
    : [["space","录音"],["w","工作区"],["v/V","声音"],["p","polish"],["r","重置"],["?","全部"],["q","退出"]];
  const row3 = (
    <Line>
      {items.map(([k,l],i)=>(
        <React.Fragment key={i}>
          <Span bg="#2f2b25" b style={{color:"#e6e0d4", padding:"0 1ch"}}>{` ${k} `}</Span>
          <Span c="dim">{` ${l}  `}</Span>
        </React.Fragment>
      ))}
    </Line>
  );

  return (
    <>
      <Line>
        <Span c="border-soft">{"─".repeat(cols - 2)}</Span>
      </Line>
      {row1}
      {row2}
      {row3}
    </>
  );
};

// ---------- Empty / welcome state ----------
const V4Empty = ({ cols }) => {
  // Centered welcome
  const cardW = Math.min(56, cols - 6);
  const padL = " ".repeat(Math.max(2, Math.floor((cols - cardW) / 2)));
  return (
    <>
      <Blank n={cols === 80 ? 2 : 3} />
      <Line>
        {padL}
        <Span c="border">{"╭"}{"─".repeat(cardW - 2)}{"╮"}</Span>
      </Line>
      <Line>
        {padL}
        <Span c="border">{"│"}</Span>
        <Span c="cyan" b>{"  able-asr   "}</Span>
        <Span c="dim">{("voice · workspace · action").padEnd(cardW - 14)}</Span>
        <Span c="border">{"│"}</Span>
      </Line>
      <Line>
        {padL}
        <Span c="border">{"│"}</Span>
        <Span c="dim">{" ".repeat(cardW - 2)}</Span>
        <Span c="border">{"│"}</Span>
      </Line>
      <Line>
        {padL}
        <Span c="border">{"│  "}</Span>
        <Span c="dim">{"hold "}</Span>
        <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" space "}</Span>
        <Span c="dim">{" to record · release to send"}</Span>
        <Span c="border">{" │"}</Span>
      </Line>
      <Line>
        {padL}
        <Span c="border">{"│  "}</Span>
        <Span c="dim">{"press "}</Span>
        <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" w "}</Span>
        <Span c="dim">{" to switch workspace"}</Span>
        <Span c="border">{" ".repeat(cardW - 36)}</Span>
        <Span c="border">{"│"}</Span>
      </Line>
      <Line>
        {padL}
        <Span c="border">{"│  "}</Span>
        <Span c="dim">{"press "}</Span>
        <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" ? "}</Span>
        <Span c="dim">{" for the full keymap"}</Span>
        <Span c="border">{" ".repeat(cardW - 36)}</Span>
        <Span c="border">{"│"}</Span>
      </Line>
      <Line>
        {padL}
        <Span c="border">{"╰"}{"─".repeat(cardW - 2)}{"╯"}</Span>
      </Line>
      <Blank n={cols === 80 ? 7 : 9} />
      <V4BottomStack cols={cols} mode="idle" />
    </>
  );
};

// ---------- Recording state ----------
const V4Recording = ({ cols }) => (
  <>
    <Line>
      <Span c="dim" i>{" · server ready · paraformer-realtime-v2 · ablework · Maia"}</Span>
    </Line>
    <Line>
      <Span c="magenta" b>{" ── 已切到 研究 Q3 财报 ──"}</Span>
    </Line>
    <Blank n={1} />
    <BarBubble who="你" whoColor="cyan" barColor="cyan" cols={cols} info="ASR 705ms · 92KB · polish 412ms ✨">
      <Span c="fg">{"上一份我看完了,有几个数字想确认一下。"}</Span>
      <Span c="dim" i>{"原 ▸ "}</Span>
      <Span c="dim" strike>{"上一份我看完。有几个数字想确认一下。"}</Span>
    </BarBubble>
    <Blank n={1} />
    <BarBubble who="AI" whoColor="green" barColor="green" cols={cols} info="2 TTS 段 · 完成 · ★ 705ms">
      <Span c="fg">{"好,具体哪几个?Q3 的营收 / 毛利 / 现金流 任选。"}</Span>
    </BarBubble>
    <Blank n={1} />
    <Line>
      <Span c="dim">{"  "}</Span>
      <Span c="yellow">{"⠋ "}</Span>
      <Span c="yellow" b>{"录音中"}</Span>
      <Span c="dim">{"  实时识别: "}</Span>
      <Span c="fg">{"现金流那个先告诉我自由现金流"}</Span>
      <Caret />
    </Line>
    <Blank n={cols === 80 ? 3 : 5} />
    <V4BottomStack cols={cols} mode="rec" />
  </>
);

window.V4 = V4;
