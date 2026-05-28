/* eslint-disable react/prop-types */
// V11 — Ambient Glance
// Challenges the assumption that this is a fullscreen TUI at all.
// Default mode: one row in your tmux status / shell prompt area —
// ASCII tray icon + micro braille waveform + latency + workspace.
// Hotkey expands to full TUI when you actually want to read.
// Variations: tmux statusline · shell prompt · sticky banner above shell.

const V11 = () => (
  <div className="proto">
    <div className="label-row">
      <h3>V11 · Ambient Glance</h3>
      <span className="meta">不抢屏 · 一行驻留 · 按键展开</span>
    </div>
    <div className="stack">
      <V11Variant variant="tmux" />
      <V11Variant variant="prompt" />
      <V11Variant variant="banner" />
      <V11Variant variant="expanded" />
    </div>
    <p className="cap">
      <span className="pill">why</span>
      Does this <i>really</i> need to take over the whole terminal? Voice convos are
      <b> intermittent</b> — read a reply, do something, ask again. The default
      surface here is <b>one row</b>, embedded in your tmux status bar or shell
      prompt. You see: workspace · mode · micro-waveform · latency. Hit{" "}
      <code style={{fontFamily:"JetBrains Mono"}}>&lt;leader&gt;a</code> (or whatever shortcut you bind) to expand
      to the full TUI when you want to read or scroll. Most ambitious bet: the
      product disappears into your existing terminal furniture.
    </p>
  </div>
);

const V11Variant = ({ variant }) => {
  const titles = {
    tmux:     "(a)  tmux statusline — bottom of your tmux session",
    prompt:   "(b)  shell prompt segment — right-aligned, lives with starship/p10k",
    banner:   "(c)  sticky banner — single row above your shell, persistent",
    expanded: "(d)  expanded — pressed <leader>a, TUI takes over",
  };
  return (
    <div>
      <div style={{ fontFamily: "JetBrains Mono", fontSize: 11, color: "#6b665b", marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {titles[variant]}
      </div>
      <Term cols={variant === "expanded" ? 140 : 140} rows={variant === "expanded" ? 24 : 18} clock="18:50">
        {variant === "tmux"     && <V11Tmux />}
        {variant === "prompt"   && <V11Prompt />}
        {variant === "banner"   && <V11Banner />}
        {variant === "expanded" && <V11Expanded />}
      </Term>
    </div>
  );
};

// micro braille waveform — 24 chars wide, encodes 8 samples per char (2 cols × 4 rows)
// We approximate with a smaller block-char sparkline.
const MicroWave = ({ samples = [], c = "green" }) => {
  const dots = ["⠀","⡀","⡠","⡰","⡴","⣴","⣶","⣾","⣿"];
  const s = samples.map((v) => dots[Math.min(8, Math.max(0, Math.round(v * 8)))]).join("");
  return <Span c={c}>{s}</Span>;
};

// fake samples for an ongoing convo
const FAKE = [0.2,0.35,0.7,0.85,0.6,0.4,0.5,0.3,0.1,0.05,0.3,0.5,0.7,0.85,0.9,0.6,0.4,0.2,0.1,0.4,0.6,0.8,0.7,0.3];

// (a) tmux statusline
const V11Tmux = () => (
  <>
    {/* fake tmux content above */}
    <Line><Span c="fg">{" $ "}</Span><Span c="cyan">{"git log --oneline -5"}</Span></Line>
    <Line><Span c="yellow">{" 4f2a1c"}</Span><Span c="fg">{" feat(tui): collapse modeline"}</Span></Line>
    <Line><Span c="yellow">{" 8a31b9"}</Span><Span c="fg">{" fix(asr): handle mic_drop retry"}</Span></Line>
    <Line><Span c="yellow">{" 2d4e7f"}</Span><Span c="fg">{" chore: bump paraformer to v2"}</Span></Line>
    <Line><Span c="yellow">{" 7c9d2e"}</Span><Span c="fg">{" refactor: extract telemetry pane"}</Span></Line>
    <Line><Span c="yellow">{" 1a3b5c"}</Span><Span c="fg">{" docs: TUI spec v3"}</Span></Line>
    <Blank n={1} />
    <Line><Span c="fg">{" $ "}</Span><Caret /></Line>
    <Blank n={cols => 6} />
    <Blank n={4} />
    {/* tmux statusline — bottom row */}
    <Line>
      {/* left tmux segments */}
      <Span bg="var(--ansi-green)" b style={{color:"#14201a"}}>{" 0 ables "}</Span>
      <Span c="green">{""}</Span>
      <Span style={{background:"#2f2b25", color:"#e6e0d4"}}>{" 1:zsh* 2:tui 3:logs "}</Span>
      <Span c="dim">{" "}</Span>
      {/* able-asr ambient segment */}
      <Span bg="var(--ansi-yellow)" b style={{color:"#1a1814"}}>{" ⠹ "}</Span>
      <Span style={{background:"#3a352d", color:"#e6e0d4"}}>{" "}</Span>
      <Span style={{background:"#3a352d", color:"#e6e0d4"}}>{"📁 q3-fin "}</Span>
      <Span style={{background:"#3a352d", color:"#e6e0d4"}}>{" "}</Span>
      <MicroWave samples={FAKE} c="green" />
      <Span style={{background:"#3a352d", color:"#e6e0d4"}}>{" "}</Span>
      <Span style={{background:"#3a352d", color:"#e6e0d4"}} b>{"★705ms"}</Span>
      <Span style={{background:"#3a352d", color:"#e6e0d4"}}>{" "}</Span>
      <Span style={{background:"#3a352d", color:"#cabfa9"}} i>{"AI streaming…"}</Span>
      <Span style={{background:"#3a352d", color:"#e6e0d4"}}>{" "}</Span>
      <Span c="dim">{"      ──────────       "}</Span>
      <Span c="dim">{" load 1.2 · 16:50 "}</Span>
    </Line>
  </>
);

// (b) shell prompt segment (right side of starship-style prompt)
const V11Prompt = () => (
  <>
    <Line><Span c="green" b>{" ~/code/able-asr "}</Span><Span c="magenta">{" main "}</Span><Span c="dim">{" ✓"}</Span></Line>
    <Line><Span c="cyan" b>{" $ "}</Span><Span c="fg">{"pnpm dev"}</Span></Line>
    <Blank n={1} />
    <Line><Span c="dim">{" ▸ paraformer ready · ws=q3-financials · 18:50"}</Span></Line>
    <Line><Span c="green">{" ✓ first audio in 705ms"}</Span></Line>
    <Blank n={2} />
    {/* prompt line — left + right */}
    <Line>
      <Span c="green" b>{" ~/code/able-asr "}</Span>
      <Span c="magenta">{" main "}</Span>
      <Span c="dim">{" ✓"}</Span>
      {/* the able-asr right-prompt segment */}
      <Span c="dim">{"  ".padEnd(70)}</Span>
      <Span c="yellow" b>{"⠹"}</Span>
      <Span c="dim">{" "}</Span>
      <Span c="yellow">{"q3-fin"}</Span>
      <Span c="dim">{" "}</Span>
      <MicroWave samples={FAKE} c="green" />
      <Span c="dim">{" "}</Span>
      <Span c="green" b>{"★705"}</Span>
      <Span c="dim">{"ms"}</Span>
    </Line>
    <Line><Span c="cyan" b>{" $ "}</Span><Caret /></Line>
    <Blank n={4} />
  </>
);

// (c) sticky banner above shell
const V11Banner = () => (
  <>
    {/* banner row */}
    <Line>
      <Span c="border">{"╭" + "─".repeat(136) + "╮"}</Span>
    </Line>
    <Line>
      <Span c="border">{"│ "}</Span>
      <Span bg="var(--ansi-yellow)" b style={{color:"#1a1814"}}>{" ⠹ 思考中 "}</Span>
      <Span c="dim">{"  "}</Span>
      <Span c="yellow">{"📁 "}</Span>
      <Span c="yellow" b>{"研究 Q3 财报"}</Span>
      <Span c="dim">{"   "}</Span>
      <MicroWave samples={FAKE} c="green" />
      <Span c="dim">{"   "}</Span>
      <Span c="green" b>{"★705ms"}</Span>
      <Span c="dim">{" · Σ2.34s · TTS 2/5  "}</Span>
      <Span c="dim" i>{"\"营收同比 +12%,云业务占比首次超过 30%……\""}</Span>
      <Span c="dim">{"  "}</Span>
      <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" ⌃a "}</Span>
      <Span c="dim">{" expand"}</Span>
      <Span c="border">{" │"}</Span>
    </Line>
    <Line>
      <Span c="border">{"╰" + "─".repeat(136) + "╯"}</Span>
    </Line>
    {/* shell below, untouched */}
    <Line><Span c="green" b>{" ~/code/able-asr "}</Span><Span c="cyan" b>{" $ "}</Span><Span c="fg">{"pnpm test"}</Span></Line>
    <Line><Span c="dim">{" PASS  packages/asr/src/parser.test.ts"}</Span></Line>
    <Line><Span c="dim">{" PASS  packages/tts/src/queue.test.ts"}</Span></Line>
    <Line><Span c="green">{" ✓ 47 tests passed"}</Span></Line>
    <Blank n={2} />
    <Line><Span c="green" b>{" ~/code/able-asr "}</Span><Span c="cyan" b>{" $ "}</Span><Caret /></Line>
    <Blank n={5} />
  </>
);

// (d) expanded mode — full TUI
const V11Expanded = () => (
  <>
    <Line>
      <Span bg="var(--ansi-magenta)" b style={{color:"#1f1424"}}>{" expanded "}</Span>
      <Span c="dim">{"   press "}</Span>
      <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" ⌃a "}</Span>
      <Span c="dim">{" to collapse back to banner"}</Span>
      <Span c="dim">{"   ·   "}</Span>
      <Span c="yellow">{"📁 "}</Span>
      <Span c="yellow" b>{"研究 Q3 财报"}</Span>
      <Span c="dim">{"   ·   "}</Span>
      <Span c="green" b>{"★705ms"}</Span>
    </Line>
    <Line><Span c="border-soft">{"─".repeat(138)}</Span></Line>
    <Blank n={1} />
    <BarBubble who="你" whoColor="cyan" barColor="cyan" cols={138} info="ASR 705ms · ✨">
      <Span c="fg">{"请帮我看一下今天的财报数据,重点关注云业务收入占比。"}</Span>
    </BarBubble>
    <Blank n={1} />
    <BarBubble who="AI" whoColor="green" barColor="green" cols={138} caret info="streaming · 2/5">
      <Span c="fg">{"今天的财报显示营收同比增长 12%,云业务占比首次超过 30%,"}</Span>
      <Span c="fg">{"毛利率提升 1.8pt。这是公司战略转型的关键拐点。"}</Span>
    </BarBubble>
    <Blank n={2} />
    <Line>
      <Span c="dim">{"  big waveform "}</Span>
      <MicroWave samples={[...FAKE, ...FAKE, ...FAKE]} c="green" />
    </Line>
    <Blank n={3} />
    <Line><Span c="border-soft">{"─".repeat(138)}</Span></Line>
    <Line>
      <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" space "}</Span>
      <Span c="dim">{" 录音  "}</Span>
      <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" i "}</Span>
      <Span c="dim">{" 打断  "}</Span>
      <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" w "}</Span>
      <Span c="dim">{" 工作区  "}</Span>
      <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" ⌃a "}</Span>
      <Span c="dim">{" 折叠  "}</Span>
      <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" ? "}</Span>
      <Span c="dim">{" all"}</Span>
    </Line>
  </>
);

window.V11 = V11;
