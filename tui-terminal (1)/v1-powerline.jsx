/* eslint-disable react/prop-types */
// V1 — Powerline Modeline
// Idea: collapse Status / Workspace / Footer into ONE bottom modeline (vim-style).
// Frees the top of the screen entirely for conversation. Provider stack moves
// into a quiet, faded zone you only read when you care.

const V1 = () => {
  return (
    <div className="proto">
      <div className="label-row">
        <h3>V1 · Powerline Modeline</h3>
        <span className="meta">−3 chrome rows · footer drives status</span>
      </div>

      <div className="stack">
        <V1Variant cols={80} state="empty" />
        <V1Variant cols={120} state="streaming" />
      </div>

      <p className="cap">
        <span className="pill">why</span>
        Top of screen is sacred — conversation gets it. Mode + workspace + latency live
        on a <b>powerline-segmented bottom bar</b> (always exactly 1 row), and hotkeys
        slide in as a context-sensitive <b>second modeline</b> only when relevant. Saves
        <b> 3 rows</b> vs. current layout. Mode chip is <b>fixed 8 chars</b> so the
        powerline never twitches.
      </p>
    </div>
  );
};

const V1Variant = ({ cols, state }) => {
  return (
    <div>
      <Term cols={cols} rows={24} clock="18:50">
        {state === "empty" ? <V1Empty cols={cols} /> : <V1Streaming cols={cols} />}
      </Term>
      <div className="cap" style={{ marginTop: 10 }}>
        <span className="pill">{cols} cols</span>
        {state === "empty" ? "Empty / welcome state — first launch hint card." : "Streaming reply mid-flight with workspace just switched."}
      </div>
    </div>
  );
};

// ---------- Empty / welcome state ----------
const V1Empty = ({ cols }) => {
  const c = cols;
  const inner = c - 2;
  return (
    <>
      <Blank n={2} />
      {/* Welcome card centered-ish */}
      <Line>
        <Span c="faint">{" ".repeat(Math.max(2, Math.floor((c - 60) / 2)))}</Span>
        <Span c="border">{"╭"}{"─".repeat(58)}{"╮"}</Span>
      </Line>
      <Line>
        <Span c="faint">{" ".repeat(Math.max(2, Math.floor((c - 60) / 2)))}</Span>
        <Span c="border">{"│"}</Span>
        <Span c="cyan" b>{"  able-asr  "}</Span>
        <Span c="dim">{"voice → workspace → action".padEnd(45)}</Span>
        <Span c="border">{"│"}</Span>
      </Line>
      <Line>
        <Span c="faint">{" ".repeat(Math.max(2, Math.floor((c - 60) / 2)))}</Span>
        <Span c="border">{"├"}{"─".repeat(58)}{"┤"}</Span>
      </Line>
      {[
        ["1.", "hold ", "space", "  to record"],
        ["2.", "press ", "w    ", "  to pick a workspace"],
        ["3.", "press ", "i    ", "  any time to interrupt"],
      ].map(([num, t1, k, t2], i) => (
        <Line key={i}>
          <Span c="faint">{" ".repeat(Math.max(2, Math.floor((c - 60) / 2)))}</Span>
          <Span c="border">{"│  "}</Span>
          <Span c="dim">{num}</Span>
          <Span c="fg-soft">{`  ${t1}`}</Span>
          <Span c="yellow" b>{` ${k.trim()} `}</Span>
          <Span c="fg-soft">{t2.padEnd(58 - 4 - 2 - 4 - k.trim().length - t1.length - 2)}</Span>
          <Span c="border">{"│"}</Span>
        </Line>
      ))}
      <Line>
        <Span c="faint">{" ".repeat(Math.max(2, Math.floor((c - 60) / 2)))}</Span>
        <Span c="border">{"│  "}</Span>
        <Span c="dim" i>{"server ready · paraformer-realtime-v2 · ablework · Maia"}</Span>
        <Span c="border">{"  │"}</Span>
      </Line>
      <Line>
        <Span c="faint">{" ".repeat(Math.max(2, Math.floor((c - 60) / 2)))}</Span>
        <Span c="border">{"╰"}{"─".repeat(58)}{"╯"}</Span>
      </Line>
      <Blank n={cols === 80 ? 6 : 8} />
      <V1Modeline cols={cols} state="idle" />
      <V1Hotkeys cols={cols} state="idle" />
    </>
  );
};

// ---------- Streaming state ----------
const V1Streaming = ({ cols }) => {
  const useNarrow = cols <= 96;
  return (
    <>
      <Line>{" "}<SysContent /></Line>
      <Divider text="已切到 研究 Q3 财报" cols={cols} />
      <Blank n={1} />
      {useNarrow ? (
        <BarBubble
          who="你"
          whoColor="cyan"
          barColor="cyan"
          info="ASR 705ms · polish 412ms"
          cols={cols}
        >
          <Span c="fg">请帮我看一下今天的财报数据。</Span>
        </BarBubble>
      ) : (
        <PanelBubble
          who="你"
          whoColor="cyan"
          borderColor="magenta"
          info="ASR 705ms · 92KB · polish 412ms · ✨"
          cols={cols}
        >
          <Span c="fg">请帮我看一下今天的财报数据。</Span>
          <></>
        </PanelBubble>
      )}
      {!useNarrow && (
        <Line>
          {" "}
          <Span c="faint">{"    "}</Span>
          <Span c="dim" i>{"原 ▸ "}</Span>
          <Span c="dim" strike>{"请帮我看一下今。今天的财报数据。"}</Span>
        </Line>
      )}
      <Blank n={1} />
      {useNarrow ? (
        <BarBubble who="AI" whoColor="green" barColor="green" cols={cols} caret info="streaming · 2 TTS 段">
          <Span c="fg">今天的财报显示营收同比增长 12%,主要来自服</Span>
          <Span c="fg">务器业务,毛利率提升 1.8pt…</Span>
        </BarBubble>
      ) : (
        <PanelBubble who="AI" whoColor="green" borderColor="green" cols={cols} caret info="streaming · 2 TTS 段 · ★ 705ms">
          <Span c="fg">今天的财报显示营收同比增长 12%,主要来自服务器业务,毛利率</Span>
          <Span c="fg">提升 1.8pt。其中云业务收入占比首次超过 30%…</Span>
        </PanelBubble>
      )}
      <Blank n={useNarrow ? 1 : 2} />
      <V1Modeline cols={cols} state="recording" />
      <V1Hotkeys cols={cols} state="recording" />
    </>
  );
};

// ---------- The modeline itself ----------
// Powerline segments: [MODE] [WORKSPACE] [LATENCY] ... [PROVIDER STACK] [CLOCK]
const V1Modeline = ({ cols, state }) => {
  const isRec = state === "recording";
  const modeBg = isRec ? "var(--ansi-green)" : "var(--ansi-cyan)";
  const modeFg = "#14201a";
  const modeText = isRec ? " ⠹ 思考中 " : " ✓ 就绪   ";

  const wsBg = "var(--ansi-yellow)";
  const wsText = isRec ? " 📁 研究 Q3 财报 " : " 📁 默认 sandbox ";

  const latBg = "#2f2b25";
  const latText = isRec ? " ★705 · Σ2340ms " : " idle · 0ms ";

  // Provider tail — fades
  const providers = " ASR paraformer · LLM ablework · TTS Maia ";

  // Build with powerline arrows ▶ between segments
  // Heads sit in colored bg blocks; tail is on terminal bg.
  return (
    <Line>
      <span style={{ background: modeBg, color: modeFg, fontWeight: 700 }}>{modeText}</span>
      <span style={{ color: modeBg, background: wsBg }}></span>
      <span style={{ background: wsBg, color: "#1a1814", fontWeight: 700 }}>{wsText}</span>
      <span style={{ color: wsBg, background: latBg }}></span>
      <span style={{ background: latBg, color: "var(--ansi-green)", fontWeight: 700 }}>{latText}</span>
      <span style={{ color: latBg }}></span>
      <Span c="dim">{providers.slice(0, Math.max(0, cols - (modeText.length + wsText.length + latText.length + 3 + 8)))}</Span>
    </Line>
  );
};

// Context-sensitive 2nd line: only the keys that matter right now
const V1Hotkeys = ({ cols, state }) => {
  const items =
    state === "recording"
      ? [
          { k: "i", label: "打断" },
          { k: "space", label: "停录" },
          { k: "w", label: "工作区" },
          { k: "p", label: "polish" },
          { k: "?", label: "全部" },
        ]
      : [
          { k: "space", label: "录音" },
          { k: "w", label: "工作区" },
          { k: "v/V", label: "声音" },
          { k: "r", label: "重置" },
          { k: "?", label: "全部" },
          { k: "q", label: "退出" },
        ];
  return <KeyRow items={items} />;
};

const SysContent = () => (
  <Span c="dim" i>{" · server ready · paraformer-realtime-v2 (cloud) · ablework · Maia @ 24kHz"}</Span>
);

window.V1 = V1;
