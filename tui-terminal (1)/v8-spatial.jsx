/* eslint-disable react/prop-types */
// V8 — Spatial Workspace (rooms on an ASCII map)
// Workspaces aren't a chip — they are PLACES. The TUI shows a small map of
// connected "rooms" (workspaces). The current room is filled (⦿), others are
// open (○). You can see file counts, last activity, and the doors between
// rooms. Voice acts on the current room. Conversation flows on the left;
// map sits on the right.

const V8 = () => (
  <div className="proto">
    <div className="label-row">
      <h3>V8 · Spatial Workspace</h3>
      <span className="meta">workspaces = ASCII rooms · voice acts on current room</span>
    </div>
    <div className="stack">
      <V8Variant cols={120} state="active" />
      <V8Variant cols={80} state="map-overlay" />
    </div>
    <p className="cap">
      <span className="pill">why</span>
      Workspaces today are an opaque list — <code>w</code> opens a popup, you guess
      which to pick. Treating them as <b>places on a map</b> builds spatial memory:
      <i> "Q3 financials is north of scratch, west of inbox."</i> You see file counts,
      last activity, who else is in there. Voice commands like <i>"go to scratch"</i>
      become a literal movement. On narrow widths the map collapses to a fullscreen
      overlay (press <kbd>m</kbd>).
    </p>
  </div>
);

const V8Variant = ({ cols, state }) => (
  <div>
    <Term cols={cols} rows={24} clock="18:50">
      {state === "active" ? <V8Active cols={cols} /> : <V8MapOverlay cols={cols} />}
    </Term>
    <div className="cap" style={{ marginTop: 10 }}>
      <span className="pill">{cols} cols</span>
      {state === "active"
        ? "Wide — convo on left, mini-map driver on right. Current room glows."
        : "Narrow — fullscreen map overlay you navigate with hjkl."}
    </div>
  </div>
);

// ---------- Wide: split convo + minimap ----------
const V8Active = ({ cols }) => {
  const convoW = Math.floor(cols * 0.58);
  const mapW = cols - convoW - 1;

  const cellLeft = (children) => (
    <span style={{ display:"inline-block", width:`${convoW}ch`, whiteSpace:"pre", verticalAlign:"top" }}>{children}</span>
  );
  const cellRight = (children) => (
    <span style={{ display:"inline-block", width:`${mapW}ch`, whiteSpace:"pre", verticalAlign:"top" }}>{children}</span>
  );

  const left = buildV8Convo(convoW);
  const right = buildV8Map(mapW);

  const rowCount = Math.max(left.length, right.length);
  const rows = [];
  for (let i = 0; i < rowCount; i++) {
    rows.push(
      <Line key={i}>
        {cellLeft(left[i] || " ")}
        <Span c="border">{"│"}</Span>
        {cellRight(right[i] || " ")}
      </Line>
    );
  }
  return <>{rows}</>;
};

const buildV8Convo = (w) => [
  <><Span bg="var(--ansi-green)" b style={{color:"#14201a"}}>{" ⠹ 思考中   "}</Span><Span c="dim">{"   in:"}</Span><Span c="yellow" b>{" Q3 财报"}</Span></>,
  <Span c="border-soft">{"─".repeat(w - 1)}</Span>,
  " ",
  <><Span c="magenta" b>{" → moved to "}</Span><Span c="yellow" b>{"Q3 财报"}</Span><Span c="faint">{"  · 412ms"}</Span></>,
  " ",
  <BarBubble who="你" whoColor="cyan" barColor="cyan" cols={w} info="ASR 705 · ✨">
    <Span c="fg">{"请帮我看一下今天的财报数据,重点云业务占比。"}</Span>
  </BarBubble>,
  null, null, null,
  " ",
  <BarBubble who="AI" whoColor="green" barColor="green" cols={w} caret info="streaming · 2/5">
    <Span c="fg">{"营收同比 +12%,云业务占比首次超过 30%,"}</Span>
    <Span c="fg">{"毛利率提升 1.8pt——"}</Span>
  </BarBubble>,
  null, null, null,
  " ",
  <><Span c="yellow" b>{" 00:23"}</Span><Span c="dim">{" mic "}</Span><Span c="green">{"████████"}</Span><Span c="faint">{"░".repeat(16)}</Span></>,
  " ",
  <V8BottomKeys />,
].filter(x => x !== null);

const V8BottomKeys = () => (
  <>
    <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" space "}</Span>
    <Span c="dim">{" 录音 "}</Span>
    <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" m "}</Span>
    <Span c="dim">{" map "}</Span>
    <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" hjkl "}</Span>
    <Span c="dim">{" 走房间 "}</Span>
    <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" ? "}</Span>
    <Span c="dim">{" all"}</Span>
  </>
);

// Map (mini, fits in the right rail)
const buildV8Map = (w) => {
  const inactive = "dim";
  const door = "border";
  // ASCII room map. The current room (Q3 financials) is filled ⦿.
  return [
    <><Span c="dim">{"  workspaces · "}</Span><Span c="cyan" b>{"17"}</Span><Span c="dim">{" rooms"}</Span></>,
    " ",
    <Span c="faint">{"                    ┌──────────┐"}</Span>,
    <><Span c="faint">{"                    │ "}</Span><Span c="dim">{"○ inbox  "}</Span><Span c="faint">{" │"}</Span></>,
    <><Span c="faint">{"                    │ "}</Span><Span c="yellow">{"3 unread"}</Span><Span c="dim">{"  "}</Span><Span c="faint">{" │"}</Span></>,
    <Span c="faint">{"                    └─────╥────┘"}</Span>,
    <Span c="faint">{"                          ║"}</Span>,
    <Span c="faint">{"   ┌──────────┐   ┌───────╨────┐"}</Span>,
    <><Span c="faint">{"   │ "}</Span><Span c="dim">{"○ scratch "}</Span><Span c="faint">{"│═══│ "}</Span><Span c="yellow" b>{"⦿ Q3 财报"}</Span><Span c="faint">{"  │"}</Span></>,
    <><Span c="faint">{"   │ "}</Span><Span c="dim">{"6 files   "}</Span><Span c="faint">{"│   │ "}</Span><Span c="cyan">{"17 files"}</Span><Span c="dim">{"  "}</Span><Span c="faint">{" │"}</Span></>,
    <><Span c="faint">{"   │ "}</Span><Span c="dim">{"2h idle   "}</Span><Span c="faint">{"│   │ "}</Span><Span c="green">{"● live"}</Span><Span c="dim">{"    "}</Span><Span c="faint">{" │"}</Span></>,
    <Span c="faint">{"   └──────────┘   └─────╥──────┘"}</Span>,
    <Span c="faint">{"                        ║"}</Span>,
    <Span c="faint">{"                ┌───────╨──────┐"}</Span>,
    <><Span c="faint">{"                │ "}</Span><Span c="dim">{"○ research base"}</Span><Span c="faint">{" │"}</Span></>,
    <><Span c="faint">{"                │ "}</Span><Span c="dim">{"42 files · 2d"}</Span><Span c="faint">{"  │"}</Span></>,
    <Span c="faint">{"                └──────────────┘"}</Span>,
    " ",
    <><Span c="dim">{"  legend:  "}</Span><Span c="yellow" b>{"⦿"}</Span><Span c="dim">{" here   "}</Span><Span c="dim">{"○"}</Span><Span c="dim">{" other "}</Span><Span c="green">{"●"}</Span><Span c="dim">{" live"}</Span></>,
    <><Span c="dim">{"  voice:   "}</Span><Span c="cyan" i>{"\"切到 scratch\""}</Span><Span c="dim">{"  / "}</Span><Span c="cyan" i>{"\"回 inbox\""}</Span></>,
  ];
};

// ---------- Narrow: fullscreen map overlay ----------
const V8MapOverlay = ({ cols }) => (
  <>
    <Line>
      <Span bg="var(--ansi-magenta)" b style={{color:"#1f1424"}}>{" m  map  "}</Span>
      <Span c="dim">{"  press "}</Span>
      <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" esc "}</Span>
      <Span c="dim">{" to return  ·  17 workspaces"}</Span>
    </Line>
    <Line><Span c="border-soft">{"─".repeat(cols - 2)}</Span></Line>
    <Blank n={1} />
    <Line><Span c="faint">{"                  ┌──────────────┐"}</Span></Line>
    <Line><Span c="faint">{"                  │ "}</Span><Span c="dim">{"○ inbox       "}</Span><Span c="faint">{"│"}</Span></Line>
    <Line><Span c="faint">{"                  │ "}</Span><Span c="yellow">{"3 unread · now"}</Span><Span c="faint">{"│"}</Span></Line>
    <Line><Span c="faint">{"                  └──────╥───────┘"}</Span></Line>
    <Line><Span c="faint">{"                         ║"}</Span></Line>
    <Line><Span c="faint">{"  ┌──────────────┐  ┌────╨─────────┐"}</Span></Line>
    <Line><Span c="faint">{"  │ "}</Span><Span c="dim">{"○ scratch     "}</Span><Span c="faint">{"│══│ "}</Span><Span c="yellow" b>{"⦿ Q3 财报    "}</Span><Span c="faint">{" │"}</Span></Line>
    <Line><Span c="faint">{"  │ "}</Span><Span c="dim">{"6 files · 2h  "}</Span><Span c="faint">{"│  │ "}</Span><Span c="cyan">{"17 files     "}</Span><Span c="faint">{" │"}</Span></Line>
    <Line><Span c="faint">{"  │              "}</Span><Span c="faint">{"│  │ "}</Span><Span c="green">{"● live · you"}</Span><Span c="dim">{"  "}</Span><Span c="faint">{" │"}</Span></Line>
    <Line><Span c="faint">{"  └──────────────┘  └────╥─────────┘"}</Span></Line>
    <Line><Span c="faint">{"                         ║"}</Span></Line>
    <Line><Span c="faint">{"                  ┌──────╨───────┐"}</Span></Line>
    <Line><Span c="faint">{"                  │ "}</Span><Span c="dim">{"○ research-bas"}</Span><Span c="faint">{"│"}</Span></Line>
    <Line><Span c="faint">{"                  │ "}</Span><Span c="dim">{"42 files · 2d "}</Span><Span c="faint">{"│"}</Span></Line>
    <Line><Span c="faint">{"                  └──────────────┘"}</Span></Line>
    <Blank n={1} />
    <Line><Span c="border-soft">{"─".repeat(cols - 2)}</Span></Line>
    <Line>
      <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" h "}</Span>
      <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" j "}</Span>
      <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" k "}</Span>
      <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" l "}</Span>
      <Span c="dim">{" walk     "}</Span>
      <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" enter "}</Span>
      <Span c="dim">{" cd   "}</Span>
      <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" n "}</Span>
      <Span c="dim">{" new room   "}</Span>
      <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" esc "}</Span>
      <Span c="dim">{" back"}</Span>
    </Line>
  </>
);

window.V8 = V8;
