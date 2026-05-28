/* eslint-disable react/prop-types */
// V3 — Stream Transcript
// Rip out all Panel borders. Treat the conversation as a streaming log:
// timestamps in a fixed left gutter, single-char speaker glyph, content flows.
// Inspired by `git log --oneline`, irssi, and `aerc`.

const V3 = () => (
  <div className="proto">
    <div className="label-row">
      <h3>V3 · Stream Transcript</h3>
      <span className="meta">no panels · gutter timestamps · max density</span>
    </div>
    <div className="stack">
      <V3Variant cols={80} state="empty" />
      <V3Variant cols={120} state="active" />
    </div>
    <p className="cap">
      <span className="pill">why</span>
      Long sessions today drown in panel borders. This treats the whole conversation as
      a <b>log stream</b>: HH:MM:SS in a stable 8-char left gutter, then a single
      speaker glyph (<Span c="cyan" b>›</Span> you, <Span c="green" b>‹</Span> ai,
      <Span c="dim"> ·</Span> sys), then content. polish-changed lines show with a
      <Span c="magenta"> ▸</Span> marker. Status sits on a thin top bar; hotkeys on
      a thin bottom bar.
    </p>
  </div>
);

const V3Variant = ({ cols, state }) => (
  <div>
    <Term cols={cols} rows={24} clock="18:50">
      {state === "empty" ? <V3Empty cols={cols} /> : <V3Active cols={cols} />}
    </Term>
    <div className="cap" style={{ marginTop: 10 }}>
      <span className="pill">{cols} cols</span>
      {state === "empty"
        ? "Empty state — log header tells you what to do."
        : "Active conversation — 14 events visible in one screen, no chrome lost to borders."}
    </div>
  </div>
);

// thin top status bar (1 line)
const V3TopBar = ({ cols, mode = "ok" }) => {
  const modeMap = {
    ok: { bg: "var(--ansi-cyan)", fg: "#14201f", text: " ✓ 就绪    " },
    rec: { bg: "var(--ansi-yellow)", fg: "#1a1814", text: " ⠋ 录音中   " },
    think: { bg: "var(--ansi-green)", fg: "#14201a", text: " ⠹ 思考中   " },
  };
  const m = modeMap[mode];
  return (
    <Line>
      <Span bg={m.bg} b style={{ color: m.fg }}>{m.text}</Span>
      <Span c="dim">{" · "}</Span>
      <Span c="yellow">{"📁 "}</Span>
      <Span c="yellow" b>{mode === "ok" ? "默认 sandbox" : "研究 Q3 财报"}</Span>
      <Span c="dim">{"  · "}</Span>
      <Span c="dim">{"paraformer · ablework · Maia"}</Span>
      <Span c="dim">{"  · "}</Span>
      <Span c="green" b>{mode === "ok" ? "—" : "★705"}</Span>
      <Span c="dim">{mode === "ok" ? "" : "ms · Σ2.34s"}</Span>
    </Line>
  );
};

// thin bottom hotkey bar
const V3BottomBar = ({ mode = "idle" }) => {
  const items =
    mode === "rec"
      ? [["space","停录"],["i","打断"],["w","工作区"],["?","全部"]]
      : mode === "think"
      ? [["i","打断"],["space","抢话"],["w","工作区"],["?","全部"]]
      : [["space","录音"],["w","工作区"],["v/V","声音"],["p","polish"],["r","重置"],["?","全部"],["q","退出"]];
  return (
    <Line>
      {items.map(([k,l], i) => (
        <React.Fragment key={i}>
          <Span bg="#2f2b25" b style={{ color: "#e6e0d4", padding: "0 1ch" }}>{` ${k} `}</Span>
          <Span c="dim">{` ${l}  `}</Span>
        </React.Fragment>
      ))}
    </Line>
  );
};

// One log row: TIME · GLYPH · CONTENT
const LogRow = ({ time, glyph, glyphColor = "dim", children, sub }) => (
  <>
    <Line>
      <Span c="faint">{time}</Span>
      <Span c="dim">{"  "}</Span>
      <Span c={glyphColor} b>{glyph}</Span>
      <Span>{" "}</Span>
      {children}
    </Line>
    {sub && (
      <Line>
        <Span c="faint">{"         "}</Span>
        <Span c="dim" i>{sub}</Span>
      </Line>
    )}
  </>
);

// Empty state
const V3Empty = ({ cols }) => (
  <>
    <V3TopBar cols={cols} mode="ok" />
    <Line> </Line>
    <LogRow time="18:50:02" glyph="·" glyphColor="dim">
      <Span c="dim" i>{"server ready · ASR=paraformer-realtime-v2 · LLM=ablework · TTS=Maia @ 24kHz"}</Span>
    </LogRow>
    <LogRow time="18:50:02" glyph="·" glyphColor="dim">
      <Span c="dim" i>{"workspace = 默认 sandbox · 17 workspaces available"}</Span>
    </LogRow>
    <Line> </Line>
    <Line>
      <Span c="faint">{"         "}</Span>
      <Span c="cyan" b>{"› hold "}</Span>
      <Span bg="#2f2b25" b style={{ color: "#e6e0d4", padding: "0 1ch" }}>{" space "}</Span>
      <Span c="cyan" b>{" to start"}</Span>
    </Line>
    <Line>
      <Span c="faint">{"         "}</Span>
      <Span c="dim">{"  press "}</Span>
      <Span bg="#2f2b25" b style={{ color: "#e6e0d4", padding: "0 1ch" }}>{" w "}</Span>
      <Span c="dim">{" to pick a workspace, "}</Span>
      <Span bg="#2f2b25" b style={{ color: "#e6e0d4", padding: "0 1ch" }}>{" ? "}</Span>
      <Span c="dim">{" for the full keymap"}</Span>
    </Line>
    <Blank n={cols === 80 ? 10 : 12} />
    <V3BottomBar mode="idle" />
  </>
);

// Active state
const V3Active = ({ cols }) => (
  <>
    <V3TopBar cols={cols} mode="think" />
    <Line> </Line>
    <LogRow time="18:48:11" glyph="·" glyphColor="dim">
      <Span c="dim" i>{"server ready · paraformer-realtime-v2 · ablework · Maia"}</Span>
    </LogRow>
    <LogRow time="18:48:14" glyph="·" glyphColor="dim">
      <Span c="magenta" b>{"✦ ws_switch  "}</Span>
      <Span c="dim">{"默认 sandbox → "}</Span>
      <Span c="yellow" b>{"研究 Q3 财报"}</Span>
      <Span c="faint">{" (412ms)"}</Span>
    </LogRow>
    <LogRow time="18:49:02" glyph="›" glyphColor="cyan"
      sub={<>原 ▸ <Span c="dim" strike>请帮我看一下今。今天的财报数据。</Span></>}>
      <Span c="fg">{"请帮我看一下今天的财报数据。"}</Span>
      <Span c="dim">{"   "}</Span>
      <Span c="magenta">{"✨"}</Span>
      <Span c="faint">{"  ASR 705 · polish 412"}</Span>
    </LogRow>
    <LogRow time="18:49:03" glyph="‹" glyphColor="green">
      <Span c="fg">{"今天的财报显示营收同比增长 12%,主要来自服务器业务,"}</Span>
    </LogRow>
    <LogRow time="" glyph=" " glyphColor="dim">
      <Span c="fg">{"毛利率提升 1.8pt,云业务收入占比首次超过 30%。"}</Span>
    </LogRow>
    <LogRow time="" glyph=" " glyphColor="dim">
      <Span c="fg">{"成本端,服务器折旧增加 8.2%"}</Span>
      <Caret />
      <Span c="faint">{"   ★705 · TTS 段 2/5"}</Span>
    </LogRow>
    <LogRow time="18:50:01" glyph="·" glyphColor="dim">
      <Span c="yellow" b>{"⚠ mic_drop ×3"}</Span>
      <Span c="dim" i>{"  WS/上游堵塞,本段录音可能有缺口"}</Span>
    </LogRow>
    <Blank n={cols === 80 ? 6 : 7} />
    <Line>
      <Span c="yellow" b>{" 00:23"}</Span>
      <Span c="dim">{" mic "}</Span>
      <Span c="green">{"████████████████"}</Span>
      <Span c="faint">{"░░░░░░░░░░░░░░░░░░░░░░░░"}</Span>
      <Span c="dim">{"  lvl 35.2% · peak 78%"}</Span>
    </Line>
    <V3BottomBar mode="think" />
  </>
);

window.V3 = V3;
