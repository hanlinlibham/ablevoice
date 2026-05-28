/* eslint-disable react/prop-types */
// V5 — Breadcrumb Chat
// Bold IA challenge: workspace becomes a *path* (~/research/q3-financials),
// mode is a segmented pill embedded in the breadcrumb, latency floats top-right.
// Defaults to LIGHT theme — challenges the assumption that TUI = dark.
// Bubbles use ultra-minimal TagBubble — speaker tag + indent, no glyphs.

const V5 = () => (
  <div className="proto">
    <div className="label-row">
      <h3>V5 · Breadcrumb Chat</h3>
      <span className="meta">workspace as path · segmented mode pill · light theme</span>
    </div>
    <div className="stack">
      <V5Variant cols={80} state="empty" theme="light" />
      <V5Variant cols={120} state="streaming" theme="light" />
    </div>
    <p className="cap">
      <span className="pill">why</span>
      Treats <b>workspace as a filesystem path</b> (<code>~/research/q3-financials</code>)
      because that's what users build intuition for in CLIs. Mode is a <b>segmented
      pill</b> showing the full pipeline state simultaneously — record · recog · polish
      · think · play — so you see where you are in the loop, not just where you are now.
      Light theme defaults answer "I work in a light terminal" without changing structure.
    </p>
  </div>
);

const V5Variant = ({ cols, state, theme }) => (
  <div>
    <Term cols={cols} rows={24} clock="18:50" theme={theme}>
      {state === "empty" ? <V5Empty cols={cols} /> : <V5Streaming cols={cols} />}
    </Term>
    <div className="cap" style={{ marginTop: 10 }}>
      <span className="pill">{cols} cols · {theme}</span>
      {state === "empty"
        ? "Empty / welcome — breadcrumb shows you're in default sandbox at root."
        : "Streaming reply — segmented mode pill shows pipeline stage by stage."}
    </div>
  </div>
);

// Breadcrumb header — 1 line
// Format:  ~ › research › q3-financials   [ rec · recog · polish · ◉ think · play ]   ★705ms · Σ2.34s
const V5Breadcrumb = ({ cols, path, stage = "idle", latency, theme = "light" }) => {
  const stages = ["rec", "recog", "polish", "think", "play"];
  const activeIdx = stage === "idle" ? -1 : stages.indexOf(stage);
  return (
    <Line>
      <Span c="dim">{" "}</Span>
      <Span c={theme === "light" ? "dim" : "faint"}>{"~"}</Span>
      {path.map((p, i) => (
        <React.Fragment key={i}>
          <Span c={theme === "light" ? "dim" : "faint"}>{" › "}</Span>
          <Span c={i === path.length - 1 ? "fg" : "dim"} b={i === path.length - 1}>{p}</Span>
        </React.Fragment>
      ))}
      <Span c="dim">{"   "}</Span>
      {/* segmented pill */}
      <Span c="border">{"["}</Span>
      {stages.map((s, i) => (
        <React.Fragment key={i}>
          {i === activeIdx ? (
            <Span bg="var(--ansi-green)" b style={{ color: "#14201a" }}>{` ◉ ${s} `}</Span>
          ) : (
            <Span c={i < activeIdx ? "green" : "faint"}>{` ${i < activeIdx ? "✓" : "·"} ${s} `}</Span>
          )}
          {i < stages.length - 1 && <Span c="border">{"·"}</Span>}
        </React.Fragment>
      ))}
      <Span c="border">{"]"}</Span>
      {latency && (
        <>
          <Span c="dim">{"   "}</Span>
          <Span c="green" b>{`★${latency.first}`}</Span>
          <Span c="dim">{"ms · Σ"}</Span>
          <Span c="cyan" b>{latency.total}</Span>
          <Span c="dim">{"s"}</Span>
        </>
      )}
    </Line>
  );
};

// minimal bottom: just a single line with contextual keys
const V5Bottom = ({ mode = "idle", theme = "light" }) => {
  const items =
    mode === "rec"
      ? [["space","停录"],["i","打断"],["w","cd workspace"],["?","keys"]]
      : mode === "think"
      ? [["i","interrupt"],["space","barge in"],["?","keys"]]
      : [["space","record"],["w","cd workspace"],["v/V","voice"],["?","keys"],["q","quit"]];
  return (
    <Line>
      {items.map(([k, l], i) => (
        <React.Fragment key={i}>
          <Span
            b
            style={{
              background: theme === "light" ? "#d8d1bf" : "#2f2b25",
              color: theme === "light" ? "#2a251f" : "#e6e0d4",
              padding: "0 1ch",
            }}
          >{` ${k} `}</Span>
          <Span c="dim">{` ${l}   `}</Span>
        </React.Fragment>
      ))}
    </Line>
  );
};

// ---------- Empty ----------
const V5Empty = ({ cols }) => (
  <>
    <V5Breadcrumb cols={cols} path={["sandbox"]} stage="idle" theme="light" />
    <Line><Span c="faint">{" "}{"─".repeat(cols - 2)}</Span></Line>
    <Blank n={2} />
    <Line>
      <Span c="dim">{"   $ "}</Span>
      <Span c="fg" b>{"able-asr"}</Span>
      <Span c="dim">{"  — hold "}</Span>
      <Span style={{ background:"#d8d1bf", color:"#2a251f", padding:"0 1ch" }} b>{" space "}</Span>
      <Span c="dim">{" to talk"}</Span>
    </Line>
    <Blank n={1} />
    <Line>
      <Span c="dim">{"     "}</Span>
      <Span c="faint">{"·"}</Span>
      <Span c="dim">{"  to change workspace:  "}</Span>
      <Span style={{ background:"#d8d1bf", color:"#2a251f", padding:"0 1ch" }} b>{" w "}</Span>
      <Span c="dim">{"   (or speak: "}</Span>
      <Span c="fg" i>{"切到 Q3 财报"}</Span>
      <Span c="dim">{")"}</Span>
    </Line>
    <Line>
      <Span c="dim">{"     "}</Span>
      <Span c="faint">{"·"}</Span>
      <Span c="dim">{"  see all keys:         "}</Span>
      <Span style={{ background:"#d8d1bf", color:"#2a251f", padding:"0 1ch" }} b>{" ? "}</Span>
    </Line>
    <Line>
      <Span c="dim">{"     "}</Span>
      <Span c="faint">{"·"}</Span>
      <Span c="dim">{"  pipeline: "}</Span>
      <Span c="fg">{"paraformer-realtime-v2"}</Span>
      <Span c="dim">{"  →  "}</Span>
      <Span c="fg">{"ablework"}</Span>
      <Span c="dim">{"  →  "}</Span>
      <Span c="fg">{"Maia"}</Span>
    </Line>
    <Blank n={cols === 80 ? 9 : 11} />
    <Line><Span c="faint">{" "}{"─".repeat(cols - 2)}</Span></Line>
    <V5Bottom mode="idle" theme="light" />
  </>
);

// ---------- Streaming ----------
const V5Streaming = ({ cols }) => (
  <>
    <V5Breadcrumb
      cols={cols}
      path={["research", "q3-financials"]}
      stage="think"
      latency={{ first: 705, total: "2.34" }}
      theme="light"
    />
    <Line><Span c="faint">{" "}{"─".repeat(cols - 2)}</Span></Line>
    <Blank n={1} />
    <Line>
      <Span c="dim">{" "}</Span>
      <Span c="magenta" b>{"cd"}</Span>
      <Span c="dim">{" research/q3-financials   "}</Span>
      <Span c="faint">{"(412ms · "}</Span>
      <Span c="magenta">{"✦ ws_switch"}</Span>
      <Span c="faint">{")"}</Span>
    </Line>
    <Blank n={1} />
    <Line>
      <Span c="cyan" b>{" you"}</Span>
      <Span c="faint">{"  18:49:02  · "}</Span>
      <Span c="magenta">{"✨ polished"}</Span>
      <Span c="faint">{"  · ASR 705 polish 412"}</Span>
    </Line>
    <Line>
      <Span c="dim">{"     "}</Span>
      <Span c="fg" b>{"请帮我看一下今天的财报数据。"}</Span>
    </Line>
    <Line>
      <Span c="dim">{"     "}</Span>
      <Span c="dim" i>{"原 ▸ "}</Span>
      <Span c="dim" strike>{"请帮我看一下今。今天的财报数据。"}</Span>
    </Line>
    <Blank n={1} />
    <Line>
      <Span c="green" b>{" ai "}</Span>
      <Span c="faint">{" 18:49:03  · streaming · TTS 段 2/5"}</Span>
      <Caret />
    </Line>
    <Line>
      <Span c="dim">{"     "}</Span>
      <Span c="fg">{"今天的财报显示营收同比增长 12%,主要来自服务器业务,"}</Span>
    </Line>
    <Line>
      <Span c="dim">{"     "}</Span>
      <Span c="fg">{"毛利率提升 1.8pt。云业务收入占比首次超过 30%。"}</Span>
    </Line>
    <Line>
      <Span c="dim">{"     "}</Span>
      <Span c="fg">{"成本端,服务器折旧增加 8.2%,但被产能优化吸收。"}</Span>
    </Line>
    <Blank n={cols === 80 ? 3 : 5} />
    <Line><Span c="faint">{" "}{"─".repeat(cols - 2)}</Span></Line>
    <V5Bottom mode="think" theme="light" />
  </>
);

window.V5 = V5;
