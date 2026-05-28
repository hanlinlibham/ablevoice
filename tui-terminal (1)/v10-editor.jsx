/* eslint-disable react/prop-types */
// V10 — Helix-style editor mode
// Treat the TUI like a modal editor (Helix/Neovim). Conversation is a live-edited
// markdown buffer with line numbers + gutter. Modes: NOR / INS / VOC (voice) /
// SEL. Leader-key (<space>) opens a popup menu of commands. Footer is a vim
// modeline. Workspaces are buffers (`:b`, `<space>b`).

const V10 = () => (
  <div className="proto">
    <div className="label-row">
      <h3>V10 · Editor Mode (Helix metaphor)</h3>
      <span className="meta">modal editor · convo = markdown buffer · leader popup</span>
    </div>
    <div className="stack">
      <V10Variant cols={120} state="leader" />
      <V10Variant cols={80} state="voice" />
    </div>
    <p className="cap">
      <span className="pill">why</span>
      Aimed squarely at the <b>vim/helix population</b> — the most likely TUI users.
      Conversation lives in a real buffer, you can yank/select/copy a turn like text.
      Modes communicate intent precisely:
      <Span c="cyan" b> NOR</Span> = navigate history,
      <Span c="green" b> INS</Span> = typing,
      <Span c="yellow" b> VOC</Span> = recording,
      <Span c="magenta" b> SEL</Span> = selecting a turn.
      Press <kbd style={{fontFamily:"JetBrains Mono"}}>&lt;space&gt;</kbd> and a menu pops with
      <code style={{fontFamily:"JetBrains Mono"}}> w </code>workspace,
      <code style={{fontFamily:"JetBrains Mono"}}> v </code>voice,
      <code style={{fontFamily:"JetBrains Mono"}}> p </code>polish,
      <code style={{fontFamily:"JetBrains Mono"}}> f </code>files —
      no more <code style={{fontFamily:"JetBrains Mono"}}>v</code> vs <code style={{fontFamily:"JetBrains Mono"}}>V</code> case-sensitivity dance.
    </p>
  </div>
);

const V10Variant = ({ cols, state }) => (
  <div>
    <Term cols={cols} rows={26} clock="18:50">
      {state === "leader" ? <V10Leader cols={cols} /> : <V10Voice cols={cols} />}
    </Term>
    <div className="cap" style={{ marginTop: 10 }}>
      <span className="pill">{cols} cols</span>
      {state === "leader"
        ? "NORMAL mode + <space> leader pressed — command popup floats above buffer."
        : "VOICE mode — modeline turns yellow, recording starts at cursor."}
    </div>
  </div>
);

// Shared: gutter-rendered buffer line
const BufLine = ({ n, current, children, blank }) => (
  <Line>
    <span style={{ display:"inline-block", width:"4ch", textAlign:"right" }}>
      {n ? <Span c={current ? "yellow" : "faint"} b={current}>{`${n} `}</Span> : <Span c="faint">{"~ "}</Span>}
    </span>
    <Span c="border">{"│ "}</Span>
    {blank ? <Span> </Span> : children}
  </Line>
);

// ---------- NORMAL + leader popup ----------
const V10Leader = ({ cols }) => (
  <>
    <V10TopChrome cols={cols} bufName="q3-financials.conv.md" dirty />
    <BufLine n={1}><Span c="cyan" b>{"# research/q3-financials"}</Span><Span c="dim">{"   · 2 turns · live"}</Span></BufLine>
    <BufLine n={2} blank />
    <BufLine n={3}><Span c="green" b>{"## you "}</Span><Span c="dim">{"18:49:02  ✨ polished"}</Span></BufLine>
    <BufLine n={4} blank />
    <BufLine n={5}><Span c="fg">{"请帮我看一下今天的财报数据,重点关注云业务收入占比和毛利率。"}</Span></BufLine>
    <BufLine n={6}><Span c="dim" i>{"  > raw: 请帮我看一下今。今天的财报数据,重点云业务收入占比和毛利率。"}</Span></BufLine>
    <BufLine n={7} blank />
    <BufLine n={8}><Span c="magenta" b>{"## ai "}</Span><Span c="dim">{"18:49:03  · streaming · 2/5 TTS"}</Span></BufLine>
    <BufLine n={9} blank />
    <BufLine n={10}><Span c="fg">{"今天的财报显示营收同比增长 12%,主要来自服务器业务,毛利率提升 1.8pt。"}</Span></BufLine>
    <BufLine n={11}><Span c="fg">{"其中云业务收入占比首次超过 30%,这是公司战略转型的关键拐点。"}</Span></BufLine>
    <BufLine n={12} current><Span c="fg">{"成本端,服务器折旧增加 8.2%"}</Span><Caret /></BufLine>
    <BufLine blank />
    <BufLine blank />
    <V10LeaderPopup cols={cols} />
    <V10Modeline mode="NOR" buf="q3-financials" line="12:24" leader />
  </>
);

const V10LeaderPopup = ({ cols }) => {
  // floating popup near bottom-left
  const padL = " ".repeat(6);
  const w = 56;
  const inner = w - 4;
  const row = (k, name, desc) => (
    <Line>
      {padL}
      <Span c="border">{"│  "}</Span>
      <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{` ${k} `}</Span>
      <Span c="fg" b>{`  ${name}`}</Span>
      <Span c="dim">{"  "}</Span>
      <Span c="dim" i>{desc}</Span>
      <Span c="border">{" ".repeat(Math.max(2, inner - k.length - name.length - desc.length - 8))}</Span>
      <Span c="border">{"│"}</Span>
    </Line>
  );
  return (
    <>
      <Line>{padL}<Span c="border">{"╭" + "─".repeat(w - 2) + "╮"}</Span></Line>
      <Line>{padL}<Span c="border">{"│  "}</Span><Span c="yellow" b>{"<space>"}</Span><Span c="dim">{" — pending leader"}</Span><Span c="border">{" ".repeat(w - 33)}</Span><Span c="border">{"│"}</Span></Line>
      <Line>{padL}<Span c="border">{"├" + "─".repeat(w - 2) + "┤"}</Span></Line>
      {row("w", "workspace", "switch · :b")}
      {row("v", "voice",     "start recording")}
      {row("p", "polish",    "toggle (on)")}
      {row("f", "files",     "open file picker")}
      {row("y", "yank turn", "copy last reply")}
      {row("?", "help",      "all bindings")}
      <Line>{padL}<Span c="border">{"╰" + "─".repeat(w - 2) + "╯"}</Span></Line>
    </>
  );
};

// ---------- VOICE mode ----------
const V10Voice = ({ cols }) => (
  <>
    <V10TopChrome cols={cols} bufName="q3-financials.conv.md" dirty />
    <BufLine n={1}><Span c="cyan" b>{"# research/q3-financials"}</Span></BufLine>
    <BufLine n={2} blank />
    <BufLine n={3}><Span c="green" b>{"## you "}</Span><Span c="dim">{"18:49"}</Span></BufLine>
    <BufLine n={4} blank />
    <BufLine n={5}><Span c="fg">{"先看上一份附录里的现金流。"}</Span></BufLine>
    <BufLine n={6} blank />
    <BufLine n={7}><Span c="magenta" b>{"## ai "}</Span><Span c="dim">{"18:49"}</Span></BufLine>
    <BufLine n={8} blank />
    <BufLine n={9}><Span c="fg">{"自由现金流 +18% YoY,Q3 单季 14.2B,经营性 22.1B。"}</Span></BufLine>
    <BufLine n={10} blank />
    <BufLine n={11}><Span c="green" b>{"## you "}</Span><Span c="yellow" i>{"recording…"}</Span></BufLine>
    <BufLine n={12} blank />
    <BufLine n={13} current>
      <Span c="yellow" i>{"现金流那个先告诉我自由现金流"}</Span>
      <Caret />
    </BufLine>
    <BufLine blank />
    {/* level meter inside the buffer area, as ghost text */}
    <Line>
      <span style={{ display:"inline-block", width:"4ch", textAlign:"right" }}>
        <Span c="faint">{"~ "}</Span>
      </span>
      <Span c="border">{"│ "}</Span>
      <Span c="yellow" b>{" 00:12 "}</Span>
      <Span c="green">{"████████████"}</Span>
      <Span c="faint">{"░".repeat(28)}</Span>
      <Span c="dim">{" lvl 42%"}</Span>
    </Line>
    <BufLine blank />
    <V10Modeline mode="VOC" buf="q3-financials" line="13:18" recording />
  </>
);

// Top chrome — buffer tabs (workspace = buffer)
const V10TopChrome = ({ cols, bufName, dirty }) => (
  <Line>
    <Span c="dim">{" "}</Span>
    <Span bg="var(--ansi-cyan)" b style={{color:"#14201f"}}>{` ${bufName} ${dirty ? "[+] " : ""}`}</Span>
    <Span c="dim">{"  "}</Span>
    <Span c="faint">{" inbox.conv.md   scratch.conv.md   research-base.conv.md "}</Span>
    <Span c="dim">{"   "}</Span>
    <Span c="dim">{"4/17 buffers"}</Span>
  </Line>
);

// Vim modeline — the bottom 1-line modeline
const V10Modeline = ({ mode, buf, line, leader, recording }) => {
  const modeBg = {
    NOR: "var(--ansi-cyan)",
    INS: "var(--ansi-green)",
    VOC: "var(--ansi-yellow)",
    SEL: "var(--ansi-magenta)",
  }[mode];
  const modeFg = mode === "VOC" ? "#1a1814" : (mode === "INS" || mode === "NOR") ? "#14201f" : "#1f1424";
  return (
    <Line>
      <Span bg={modeBg} b style={{ color: modeFg }}>{` ${mode} `}</Span>
      <Span style={{ background:"#2f2b25", color:"#e6e0d4" }}>{` ${buf} `}</Span>
      <Span c="dim">{`  ${line}  `}</Span>
      {leader && <Span c="yellow" b i>{"<space>·"}</Span>}
      {recording && (
        <>
          <Span c="yellow" b>{"  ● rec "}</Span>
          <Span c="dim">{"0:12"}</Span>
          <Span c="dim">{"  ★ last 705ms"}</Span>
        </>
      )}
      <Span c="dim">{"   "}</Span>
      <Span c="dim">{recording ? "" : "polish on · paraformer · ablework · Maia"}</Span>
      <Span c="dim">{"   "}</Span>
      <Span c="dim">{"UTF-8  markdown"}</Span>
    </Line>
  );
};

window.V10 = V10;
