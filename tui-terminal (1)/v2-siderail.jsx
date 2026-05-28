/* eslint-disable react/prop-types */
// V2 — Side-rail Dashboard
// On wide terminals: persistent right-side rail with mode card, workspace,
// model stack, latency sparklines, and recent events. Conversation is
// uninterrupted on the left.
// On narrow: rail collapses into a single compact status row at top.

const V2 = () => (
  <div className="proto">
    <div className="label-row">
      <h3>V2 · Side-rail Dashboard</h3>
      <span className="meta">wide → rail · narrow → 1 status row</span>
    </div>
    <div className="stack">
      <V2Wide />
      <V2Narrow />
    </div>
    <p className="cap">
      <span className="pill">why</span>
      Conversation gets a tall, uninterrupted column. The right rail is where you
      glance for "what's happening" — <b>mode card</b>, <b>workspace</b>, <b>model
      stack</b>, <b>latency history sparkline</b>, last <b>3 system events</b>. On
      80-col it disappears and you get a single-row status line.
    </p>
  </div>
);

// ------- Wide (140 col) -------
const V2Wide = () => {
  const cols = 140;
  const railW = 38; // chars
  const mainW = cols - railW - 1; // 1 char gutter
  return (
    <div>
      <Term cols={cols} rows={26} clock="18:50">
        <V2WideBody mainW={mainW} railW={railW} />
      </Term>
      <div className="cap" style={{ marginTop: 10 }}>
        <span className="pill">140 cols</span>
        Streaming reply — mode, workspace, providers, latency history all in the rail.
      </div>
    </div>
  );
};

const V2WideBody = ({ mainW, railW }) => {
  // Compose row by row: main left column, vertical bar, rail right
  const sep = "│";
  // Helper to render a full-width 1-line composite
  const row = (left, right, key) => (
    <Line key={key}>
      <Span c="fg">{padRight(left, mainW)}</Span>
      <Span c="border">{sep}</Span>
      <Span c="fg">{padRight(right, railW)}</Span>
    </Line>
  );

  // We'll build the rail content as an array of rendered span-arrays
  // and same for main, then interleave row-by-row.
  const main = buildMainLines(mainW);
  const rail = buildRailLines(railW);

  const rowCount = Math.max(main.length, rail.length);
  const rows = [];
  for (let i = 0; i < rowCount; i++) {
    rows.push(
      <Line key={i}>
        <span style={{ display: "inline-block", width: `${mainW}ch`, overflow: "hidden", whiteSpace: "pre" }}>{main[i] || " "}</span>
        <Span c="border">{sep}</Span>
        <span style={{ display: "inline-block", width: `${railW}ch`, overflow: "hidden", whiteSpace: "pre" }}>{rail[i] || " "}</span>
      </Line>
    );
  }
  return <>{rows}</>;
};

// pad helper that ignores CJK width for spans (we let CSS handle visual)
const padRight = (s, n) => {
  const w = vwidth(s);
  return s + " ".repeat(Math.max(0, n - w));
};

// Main column lines as JSX nodes
const buildMainLines = (w) => {
  return [
    <Span c="dim" i>{" · server ready · paraformer-realtime-v2 · ablework · Maia @ 24kHz"}</Span>,
    " ",
    <Span c="magenta" b>{" ── 已切到 研究 Q3 财报 ──"}</Span>,
    " ",
    // user bubble (BarBubble style)
    <><Span c="cyan">{"▍ "}</Span><Span c="cyan" b>{"你"}</Span><Span c="dim">{"   ASR 705ms · 92KB · "}</Span><Span c="magenta">{"polish 412ms ✨"}</Span></>,
    <><Span c="cyan">{"▍ "}</Span><Span c="fg">{"请帮我看一下今天的财报数据。"}</Span></>,
    <><Span c="cyan">{"▍ "}</Span><Span c="dim" i>{"原 ▸ "}</Span><Span c="dim" strike>{"请帮我看一下今。今天的财报数据。"}</Span></>,
    " ",
    <><Span c="green">{"▍ "}</Span><Span c="green" b>{"AI"}</Span><Caret /><Span c="dim">{"   streaming · 2 TTS 段"}</Span></>,
    <><Span c="green">{"▍ "}</Span><Span c="fg">{"今天的财报显示营收同比增长 12%,主要来自服务器业务,毛利率提升 1.8pt。"}</Span></>,
    <><Span c="green">{"▍ "}</Span><Span c="fg">{"其中云业务收入占比首次超过 30%,这是公司战略转型的关键拐点。"}</Span></>,
    <><Span c="green">{"▍ "}</Span><Span c="fg">{"成本端,服务器折旧增加 8.2%,但被产能优化吸收……"}</Span></>,
    " ",
    " ",
    " ",
    " ",
    " ",
    " ",
    " ",
    // bottom: mic meter
    <><Span c="yellow" b>{" 00:23"}</Span><Span c="dim">{" mic "}</Span><Span c="green">{"████████████████"}</Span><Span c="faint">{"░░░░░░░░░░░░░░░░░░░░░░░░"}</Span><Span c="dim">{"  lvl 35.2% · peak 78%"}</Span></>,
    // footer
    <>
      <Span bg="#2f2b25" b style={{padding: "0 1ch", color: "#e6e0d4"}}>{" space "}</Span>
      <Span c="dim">{" 录音  "}</Span>
      <Span bg="#2f2b25" b style={{padding: "0 1ch", color: "#e6e0d4"}}>{" i "}</Span>
      <Span c="dim">{" 打断  "}</Span>
      <Span bg="#2f2b25" b style={{padding: "0 1ch", color: "#e6e0d4"}}>{" w "}</Span>
      <Span c="dim">{" 工作区  "}</Span>
      <Span bg="#2f2b25" b style={{padding: "0 1ch", color: "#e6e0d4"}}>{" p "}</Span>
      <Span c="dim">{" polish  "}</Span>
      <Span bg="#2f2b25" b style={{padding: "0 1ch", color: "#e6e0d4"}}>{" ? "}</Span>
      <Span c="dim">{" 全部"}</Span>
    </>,
  ];
};

// Rail column lines as JSX nodes
const buildRailLines = (w) => {
  const dashes = "─".repeat(w - 2);
  return [
    <Span c="border">{`╭${dashes}╮`}</Span>,
    <><Span c="border">{"│ "}</Span><Span c="dim">{"MODE"}</Span></>,
    <><Span c="border">{"│ "}</Span><Span bg="var(--ansi-green)" b style={{color: "#14201a"}}>{"  ⠹ 思考中   "}</Span></>,
    <><Span c="border">{"│ "}</Span><Span c="dim" i>{"AI streaming · 2 TTS 段"}</Span></>,
    <><Span c="border">{"├"}{"─".repeat(w - 2)}{"┤"}</Span></>,
    <><Span c="border">{"│ "}</Span><Span c="dim">{"WORKSPACE"}</Span></>,
    <><Span c="border">{"│ "}</Span><Span c="yellow">{"📁 "}</Span><Span c="yellow" b>{"研究 Q3 财报"}</Span></>,
    <><Span c="border">{"│ "}</Span><Span c="dim">{"17 个 · w 列表 · W 刷新"}</Span></>,
    <><Span c="border">{"├"}{"─".repeat(w - 2)}{"┤"}</Span></>,
    <><Span c="border">{"│ "}</Span><Span c="dim">{"MODELS"}</Span></>,
    <><Span c="border">{"│ "}</Span><Span c="dim">{"ASR "}</Span><Span c="cyan">{"paraformer-rt"}</Span></>,
    <><Span c="border">{"│ "}</Span><Span c="dim">{"LLM "}</Span><Span c="cyan">{"ablework"}</Span></>,
    <><Span c="border">{"│ "}</Span><Span c="dim">{"TTS "}</Span><Span c="cyan">{"Maia"}</Span><Span c="dim">{" (cloud)"}</Span></>,
    <><Span c="border">{"│ "}</Span><Span c="dim">{"polish "}</Span><Span c="green">{"on"}</Span></>,
    <><Span c="border">{"├"}{"─".repeat(w - 2)}{"┤"}</Span></>,
    <><Span c="border">{"│ "}</Span><Span c="dim">{"LATENCY  ★ 首音 / Σ"}</Span></>,
    <><Span c="border">{"│ "}</Span><Spark values={[0.6, 0.5, 0.7, 0.4, 0.5, 0.3, 0.4, 0.35, 0.5, 0.42, 0.38, 0.42]} c="green" /><Span c="dim">{"  "}</Span><Span c="green" b>{"705"}</Span><Span c="dim">{"ms"}</Span></>,
    <><Span c="border">{"│ "}</Span><Spark values={[0.8, 0.7, 0.9, 0.6, 0.7, 0.5, 0.65, 0.6, 0.7, 0.62, 0.58, 0.7]} c="cyan" /><Span c="dim">{"  "}</Span><Span c="cyan" b>{"2.34"}</Span><Span c="dim">{"s"}</Span></>,
    <><Span c="border">{"├"}{"─".repeat(w - 2)}{"┤"}</Span></>,
    <><Span c="border">{"│ "}</Span><Span c="dim">{"RECENT"}</Span></>,
    <><Span c="border">{"│ "}</Span><Span c="dim">{"18:50  "}</Span><Span c="magenta">{"✦ ws_switch"}</Span></>,
    <><Span c="border">{"│ "}</Span><Span c="dim">{"18:49  "}</Span><Span c="green">{"✓ chat_done"}</Span></>,
    <><Span c="border">{"│ "}</Span><Span c="dim">{"18:48  "}</Span><Span c="yellow">{"⚠ mic_drop ×3"}</Span></>,
    <Span c="border">{`╰${dashes}╯`}</Span>,
    " ",
    " ",
  ];
};

// ------- Narrow (80 col) -------
const V2Narrow = () => {
  return (
    <div>
      <Term cols={80} rows={24} clock="18:50">
        <V2NarrowBody />
      </Term>
      <div className="cap" style={{ marginTop: 10 }}>
        <span className="pill">80 cols</span>
        Rail collapses into one compact status row. Same info, prioritized.
      </div>
    </div>
  );
};

const V2NarrowBody = () => (
  <>
    {/* one-line status (replaces 3 rows) */}
    <Line>
      <Span bg="var(--ansi-cyan)" b style={{color:"#14201f"}}>{" ✓ 就绪    "}</Span>
      <Span c="dim">{"  "}</Span>
      <Span c="yellow">{"📁 默认"}</Span>
      <Span c="dim">{"  · "}</Span>
      <Spark values={[0.5,0.3,0.4,0.35,0.5,0.42,0.38,0.42]} c="green" />
      <Span c="green" b>{" 705"}</Span>
      <Span c="dim">{"ms"}</Span>
    </Line>
    <Line>
      <Span c="dim" i>{" · paraformer-rt · ablework · Maia (cloud)"}</Span>
    </Line>
    <Line> </Line>
    {/* welcome / empty */}
    <Line> </Line>
    <Line>{"    "}<Span c="cyan" b>{"able-asr"}</Span><Span c="dim">{"   voice → workspace → action"}</Span></Line>
    <Line> </Line>
    <Line>{"    "}<Span c="dim">{"1."}</Span><Span c="fg-soft">{"  hold "}</Span><Span bg="#2f2b25" b style={{padding:"0 1ch", color:"#e6e0d4"}}>{" space "}</Span><Span c="fg-soft">{"  to record"}</Span></Line>
    <Line>{"    "}<Span c="dim">{"2."}</Span><Span c="fg-soft">{"  press "}</Span><Span bg="#2f2b25" b style={{padding:"0 1ch", color:"#e6e0d4"}}>{" w "}</Span><Span c="fg-soft">{"      to pick a workspace"}</Span></Line>
    <Line>{"    "}<Span c="dim">{"3."}</Span><Span c="fg-soft">{"  press "}</Span><Span bg="#2f2b25" b style={{padding:"0 1ch", color:"#e6e0d4"}}>{" ? "}</Span><Span c="fg-soft">{"      for all keys"}</Span></Line>
    <Blank n={6} />
    <Line>
      <Span bg="#2f2b25" b style={{padding:"0 1ch", color:"#e6e0d4"}}>{" space "}</Span>
      <Span c="dim">{" 录音  "}</Span>
      <Span bg="#2f2b25" b style={{padding:"0 1ch", color:"#e6e0d4"}}>{" w "}</Span>
      <Span c="dim">{" 工作区  "}</Span>
      <Span bg="#2f2b25" b style={{padding:"0 1ch", color:"#e6e0d4"}}>{" v/V "}</Span>
      <Span c="dim">{" 声音  "}</Span>
      <Span bg="#2f2b25" b style={{padding:"0 1ch", color:"#e6e0d4"}}>{" ? "}</Span>
      <Span c="dim">{" 全部"}</Span>
    </Line>
  </>
);

window.V2 = V2;
