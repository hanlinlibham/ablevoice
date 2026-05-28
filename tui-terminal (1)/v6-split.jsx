/* eslint-disable react/prop-types */
// V6 — Split Dashboard
// Bold IA challenge: at wide widths, split conversation (top 60%) from a real
// ASCII telemetry pane (bottom 40%) with latency histogram, TTS chunk queue,
// pipeline timeline, and event log columns.
// Narrow falls back to a tabbed shell where you press [1] [2] to swap pane.

const V6 = () => (
  <div className="proto">
    <div className="label-row">
      <h3>V6 · Split Dashboard</h3>
      <span className="meta">conversation + live ASCII telemetry pane · tabbed on narrow</span>
    </div>
    <div className="stack">
      <V6Wide />
      <V6Narrow />
    </div>
    <p className="cap">
      <span className="pill">why</span>
      For users who care about latency / pipeline timing (which is exactly the demo
      story), a dedicated <b>telemetry pane</b> turns the TUI into a live dashboard:
      latency histogram, ★ first-audio timeline, TTS chunk queue, recent events.
      Conversation stays scrollable on top. Narrow widths swap to a <b>tabbed
      shell</b> (press <kbd>1</kbd>/<kbd>2</kbd>) — same info, mobile-friendly.
    </p>
  </div>
);

// ============== Wide (140 col, dashboard split) ==============
const V6Wide = () => {
  const cols = 140;
  return (
    <div>
      <Term cols={cols} rows={32} clock="18:50">
        <V6WideBody cols={cols} />
      </Term>
      <div className="cap" style={{ marginTop: 10 }}>
        <span className="pill">140 cols</span>
        Wide-screen dashboard — top is conversation (60%), bottom is live telemetry pane (40%).
      </div>
    </div>
  );
};

const V6WideBody = ({ cols }) => {
  return (
    <>
      {/* Top status strip */}
      <Line>
        <Span bg="var(--ansi-green)" b style={{color:"#14201a"}}>{" ⠹ 思考中   "}</Span>
        <Span c="dim">{"   "}</Span>
        <Span c="yellow">{"📁 "}</Span>
        <Span c="yellow" b>{"研究 Q3 财报"}</Span>
        <Span c="dim">{"   17 workspaces"}</Span>
        <Span c="dim">{"     · paraformer-realtime-v2 · ablework · Maia (cloud) · polish on"}</Span>
        <Span c="dim">{"     "}</Span>
        <Span c="green" b>{"★705"}</Span>
        <Span c="dim">{"ms · Σ"}</Span>
        <Span c="cyan" b>{"2.34"}</Span>
        <Span c="dim">{"s"}</Span>
      </Line>
      <Line><Span c="border">{"═".repeat(cols - 2)}</Span></Line>

      {/* Conversation area — left flow, right slim sidebar */}
      <V6Convo cols={cols} />

      {/* Telemetry split */}
      <Line><Span c="border">{"═".repeat(cols - 2)}</Span></Line>
      <Line>
        <Span c="dim">{" "}</Span>
        <Span c="fg" b>{"telemetry"}</Span>
        <Span c="dim">{"  ── press "}</Span>
        <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" t "}</Span>
        <Span c="dim">{" to collapse · last 12 rounds"}</Span>
      </Line>
      <V6Telemetry cols={cols} />
      <Line><Span c="border">{"─".repeat(cols - 2)}</Span></Line>
      <V6Footer />
    </>
  );
};

const V6Convo = ({ cols }) => {
  // 60% top — but we'll just render the top section, height not strictly enforced
  return (
    <>
      <Blank n={1} />
      <Line>
        <Span c="dim">{" "}</Span>
        <Span c="magenta" b>{"✦ cd 研究 Q3 财报  "}</Span>
        <Span c="dim" i>{"(412ms)"}</Span>
      </Line>
      <Blank n={1} />
      <BarBubble who="你" whoColor="cyan" barColor="cyan" cols={cols}
        info="ASR 705ms · 92KB · polish 412ms ✨">
        <Span c="fg">{"请帮我看一下今天的财报数据,重点关注云业务收入占比和毛利率变化趋势。"}</Span>
        <><Span c="dim" i>{"原 ▸ "}</Span><Span c="dim" strike>{"请帮我看一下今。今天的财报数据,重点关注……"}</Span></>
      </BarBubble>
      <Blank n={1} />
      <BarBubble who="AI" whoColor="green" barColor="green" cols={cols}
        info="streaming · TTS 段 2/5" caret>
        <Span c="fg">{"今天的财报显示营收同比增长 12%,主要来自服务器业务,毛利率提升 1.8pt。"}</Span>
        <Span c="fg">{"云业务收入占比首次超过 30%,这是公司战略转型的关键拐点。"}</Span>
        <Span c="fg">{"成本端,服务器折旧增加 8.2%,被产能优化吸收。运营利润率"}</Span>
      </BarBubble>
      <Blank n={1} />
      <Line>
        <Span c="yellow" b>{" 00:23"}</Span>
        <Span c="dim">{" mic "}</Span>
        <Span c="green">{"████████████████"}</Span>
        <Span c="faint">{"░░░░░░░░░░░░░░░░░░░░░░░░"}</Span>
        <Span c="dim">{"  lvl 35.2% · peak 78%"}</Span>
      </Line>
    </>
  );
};

const V6Telemetry = ({ cols }) => {
  // 3-column layout:  [latency histogram]  │  [pipeline timeline]  │  [events]
  // Render row-by-row using inline-block widths matching ch units
  const left = 48; const mid = 50; const right = cols - left - mid - 4;

  const cellL = (children) => (
    <span style={{ display:"inline-block", width:`${left}ch`, whiteSpace:"pre", verticalAlign:"top" }}>{children}</span>
  );
  const cellM = (children) => (
    <span style={{ display:"inline-block", width:`${mid}ch`, whiteSpace:"pre", verticalAlign:"top" }}>{children}</span>
  );
  const cellR = (children) => (
    <span style={{ display:"inline-block", width:`${right}ch`, whiteSpace:"pre", verticalAlign:"top" }}>{children}</span>
  );

  // Build line by line for proper alignment
  const lines = [];
  const N = 9;
  for (let i = 0; i < N; i++) {
    lines.push(
      <Line key={i}>
        {cellL(<V6LatencyRow i={i} />)}
        <Span c="border">{" │ "}</Span>
        {cellM(<V6PipelineRow i={i} />)}
        <Span c="border">{" │ "}</Span>
        {cellR(<V6EventRow i={i} />)}
      </Line>
    );
  }
  return <>{lines}</>;
};

// --- Latency column (histogram + headers) ---
const V6LatencyRow = ({ i }) => {
  const values = [705, 612, 880, 540, 690, 470, 605, 525, 705];
  const maxv = 900;
  if (i === 0) return <><Span c="dim">{" "}</Span><Span c="fg" b>{"latency · ★ first audio"}</Span></>;
  if (i === 1) return <><Span c="dim">{" round   ms    "}</Span><Span c="dim">{"  bar (max=900ms)"}</Span></>;
  const idx = i - 2;
  if (idx >= values.length) return null;
  const v = values[idx];
  const fill = Math.round((v / maxv) * 28);
  const isMax = v === Math.max(...values);
  return (
    <>
      <Span c="dim">{` r-${(values.length - idx).toString().padStart(2," ")}   `}</Span>
      <Span c={v > 800 ? "yellow" : "green"} b>{` ${v.toString().padStart(3)}  `}</Span>
      <Span c={v > 800 ? "yellow" : "green"}>{"█".repeat(fill)}</Span>
      <Span c="faint">{"░".repeat(28 - fill)}</Span>
      {isMax && <Span c="yellow">{"  peak"}</Span>}
    </>
  );
};

// --- Pipeline timeline column ---
const V6PipelineRow = ({ i }) => {
  if (i === 0) return <><Span c="dim">{" "}</Span><Span c="fg" b>{"pipeline timeline · current round"}</Span></>;
  if (i === 1) return <><Span c="dim">{" stage      0ms ─── 705 ── 1.2k ─── 2.34s"}</Span></>;
  const stages = [
    { name: "record    ", from: 0,    to: 1.45, c: "yellow" },
    { name: "asr-rt    ", from: 0.2,  to: 0.32, c: "cyan" },
    { name: "asr-final ", from: 1.45, to: 1.55, c: "cyan" },
    { name: "polish    ", from: 1.55, to: 1.85, c: "magenta" },
    { name: "llm-token ", from: 1.85, to: 2.34, c: "green" },
    { name: "tts-1     ", from: 2.10, to: 2.34, c: "green" },
    { name: "tts-2     ", from: 2.34, to: 2.62, c: "green" },
  ];
  const idx = i - 2;
  if (idx >= stages.length) return null;
  const s = stages[idx];
  const total = 36; // chars for bar
  const tStart = Math.round((s.from / 2.8) * total);
  const tEnd = Math.round((s.to / 2.8) * total);
  return (
    <>
      <Span c="dim">{" "}</Span>
      <Span c="fg-soft">{s.name}</Span>
      <Span c="faint">{"·".repeat(tStart)}</Span>
      <Span c={s.c}>{"█".repeat(Math.max(1, tEnd - tStart))}</Span>
      <Span c="faint">{"·".repeat(Math.max(0, total - tEnd))}</Span>
    </>
  );
};

// --- Events column ---
const V6EventRow = ({ i }) => {
  if (i === 0) return <><Span c="dim">{" "}</Span><Span c="fg" b>{"events"}</Span></>;
  if (i === 1) return <Span c="dim">{" recent system messages"}</Span>;
  const events = [
    { t: "18:50:11", c: "green",   txt: "✓ tts seg 2/5" },
    { t: "18:50:09", c: "green",   txt: "✓ first audio · 705ms" },
    { t: "18:50:08", c: "magenta", txt: "✨ polish · 412ms" },
    { t: "18:50:07", c: "cyan",    txt: "▸ asr final · 88KB" },
    { t: "18:48:14", c: "magenta", txt: "✦ ws_switch" },
    { t: "18:48:11", c: "yellow",  txt: "⚠ mic_drop ×3" },
    { t: "18:48:00", c: "dim",     txt: "· server ready" },
  ];
  const idx = i - 2;
  if (idx >= events.length) return null;
  const e = events[idx];
  return (
    <>
      <Span c="faint">{` ${e.t}  `}</Span>
      <Span c={e.c}>{e.txt}</Span>
    </>
  );
};

const V6Footer = () => (
  <Line>
    {[
      ["space","录音"],["i","打断"],["w","工作区"],["t","隐藏 telemetry"],["?","全部"],["q","退出"]
    ].map(([k,l],i)=>(
      <React.Fragment key={i}>
        <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{` ${k} `}</Span>
        <Span c="dim">{` ${l}  `}</Span>
      </React.Fragment>
    ))}
  </Line>
);

// ============== Narrow (80 col, tabbed) ==============
const V6Narrow = () => (
  <div>
    <Term cols={80} rows={24} clock="18:50">
      <V6NarrowBody />
    </Term>
    <div className="cap" style={{ marginTop: 10 }}>
      <span className="pill">80 cols · tabbed</span>
      Telemetry hidden — press <kbd style={{fontFamily:"JetBrains Mono"}}>t</kbd> to swap. Active tab indicated by underline.
    </div>
  </div>
);

const V6NarrowBody = () => (
  <>
    {/* Tab bar */}
    <Line>
      <Span c="dim">{" "}</Span>
      <Span c="fg" b u>{"[1] chat"}</Span>
      <Span c="dim">{"     "}</Span>
      <Span c="dim">{"[2] telemetry"}</Span>
      <Span c="dim">{"     "}</Span>
      <Span bg="var(--ansi-green)" b style={{color:"#14201a"}}>{" ⠹ 思考中   "}</Span>
      <Span c="dim">{"   "}</Span>
      <Span c="yellow">{"📁 Q3 财报"}</Span>
    </Line>
    <Line><Span c="border">{"─".repeat(78)}</Span></Line>
    <Blank n={1} />
    <BarBubble who="你" whoColor="cyan" barColor="cyan" cols={80} info="ASR 705 · ✨">
      <Span c="fg">{"请帮我看一下今天的财报数据。"}</Span>
    </BarBubble>
    <Blank n={1} />
    <BarBubble who="AI" whoColor="green" barColor="green" cols={80} caret info="streaming">
      <Span c="fg">{"今天的财报显示营收同比增长 12%,主要"}</Span>
      <Span c="fg">{"来自服务器业务,毛利率提升 1.8pt。"}</Span>
    </BarBubble>
    <Blank n={5} />
    <Line><Span c="border">{"─".repeat(78)}</Span></Line>
    <Line>
      <Span c="dim">{" "}</Span>
      <Span c="green" b>{"★705"}</Span>
      <Span c="dim">{"ms · Σ"}</Span>
      <Span c="cyan" b>{"2.34"}</Span>
      <Span c="dim">{"s   · TTS 2/5 ·  press "}</Span>
      <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" 2 "}</Span>
      <Span c="dim">{"  for charts"}</Span>
    </Line>
    <Line>
      {[["space","录音"],["i","打断"],["w","ws"],["t","tabs"],["?","全部"]].map(([k,l],i)=>(
        <React.Fragment key={i}>
          <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{` ${k} `}</Span>
          <Span c="dim">{` ${l}  `}</Span>
        </React.Fragment>
      ))}
    </Line>
  </>
);

window.V6 = V6;
