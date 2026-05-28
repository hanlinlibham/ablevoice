/* eslint-disable react/prop-types */
// Shared TUI primitives — render monospace lines that look like real terminal output.

const { useMemo } = React;

// CJK-aware visual width (1 ASCII = 1, 1 CJK / fullwidth = 2)
const vwidth = (str) => {
  if (!str) return 0;
  let n = 0;
  for (const ch of String(str)) {
    const code = ch.codePointAt(0);
    // crude but effective: anything beyond Latin/extended is 2-wide
    n += code > 0x2e80 || (code >= 0x2010 && code <= 0x2027) ? 2 : 1;
  }
  return n;
};

// ---------- low-level: span helpers ----------
const Span = ({ c, b, i, u, strike, bg, children, style }) => {
  const cls = [
    c ? `c-${c}` : "",
    b ? "b" : "",
    i ? "i" : "",
    u ? "u" : "",
    strike ? "strike" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const s = bg ? { background: bg, ...(style || {}) } : style;
  return <span className={cls} style={s}>{children}</span>;
};

// Mode chip — always 8 chars wide so position never shifts
// kind: rec | think | recog | polish | err | warn | ok
const ChipMode = ({ kind, label, spinner = "⠋" }) => {
  const cls = `chip chip-${kind}`;
  // pad label to a stable width inside chip (Chinese chars count as 2)
  const visualWidth = (str) => [...str].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x7f ? 2 : 1), 0);
  const w = visualWidth(label);
  const pad = Math.max(0, 6 - w);
  const padStr = " ".repeat(pad);
  return (
    <span className={cls}>{` ${spinner} ${label}${padStr} `}</span>
  );
};

// Workspace chip
const ChipWs = ({ children }) => <span className="chip chip-ws">{` ${children} `}</span>;
const ChipFlash = ({ children }) => <span className="chip chip-flash">{` ${children} `}</span>;

// Key binding chip (for footer)
const Key = ({ k }) => <span className="chip chip-key">{` ${k} `}</span>;

// Blink caret
const Caret = () => <span className="caret"> </span>;

// ---------- terminal frame ----------
const Term = ({
  cols = 96,
  rows,
  title = "able-asr",
  clock = "18:50",
  theme = "dark",
  chrome = true,
  children,
  fontSize = 13,
}) => {
  // width is in ch so it always reflects cols
  return (
    <div
      className={`term ${theme === "light" ? "--light" : ""}`}
      style={{
        width: `${cols}ch`,
        fontSize: `${fontSize}px`,
      }}
    >
      {chrome && (
        <div className="term-chrome">
          <span className="dots"><i /><i /><i /></span>
          <span className="title">{title}</span>
          <span className="meta">{`${cols}×${rows || "auto"} · ${clock}`}</span>
        </div>
      )}
      <div className="term-body">{children}</div>
    </div>
  );
};

// One terminal "line" — block-level, monospace, preserves spaces
const Line = ({ children, style }) => (
  <div style={{ whiteSpace: "pre", minHeight: "1.55em", ...style }}>{children}</div>
);

const Blank = ({ n = 1 }) => Array.from({ length: n }).map((_, i) => <Line key={i}>{" "}</Line>);

// Repeat a character to fill width (for borders / dividers)
const repeat = (ch, n) => ch.repeat(Math.max(0, n));

// ---------- bubbles ----------
// Panel bubble: classic, with ╭─ title ─╮ borders
const PanelBubble = ({
  who = "AI",
  whoColor = "green",
  borderColor = "green",
  info,
  cols = 96,
  inset = 1,
  children,
  caret = false,
}) => {
  // The bubble's outer width = cols - 2*inset; inner content width = outer - 4 (2 chars each side: '│ ' / ' │')
  const outer = cols - inset * 2;
  const pad = " ".repeat(inset);

  // title line: ╭─ who · info ─...─╮
  const titleText = `${who}${info ? `   ${info}` : ""}`;
  // measured monospace width — CJK chars are 2 wide
  const titleVisible = vwidth(titleText) + (caret ? 2 : 0);
  const dashes = Math.max(2, outer - 6 - titleVisible);

  return (
    <>
      <Line>
        {pad}
        <Span c={borderColor}>{"╭─ "}</Span>
        <Span c={whoColor} b>{who}</Span>
        {info && (
          <>
            <Span c="dim">{`   ${info}`}</Span>
          </>
        )}
        {caret && <Caret />}
        <Span c={borderColor}>{`  ${repeat("─", dashes)}╮`}</Span>
      </Line>
      {React.Children.map(children, (child, idx) => (
        <Line key={idx}>
          {pad}
          <Span c={borderColor}>{"│ "}</Span>
          {child}
        </Line>
      ))}
      <Line>
        {pad}
        <Span c={borderColor}>{`╰${repeat("─", outer - 2)}╯`}</Span>
      </Line>
    </>
  );
};

// Compact bubble: no border, left vertical bar
const BarBubble = ({
  who = "AI",
  whoColor = "green",
  barColor,
  info,
  cols = 96,
  inset = 1,
  children,
  caret = false,
}) => {
  const c = barColor || whoColor;
  const pad = " ".repeat(inset);
  return (
    <>
      <Line>
        {pad}
        <Span c={c}>{"▍ "}</Span>
        <Span c={whoColor} b>{who}</Span>
        {info && <Span c="dim">{`   ${info}`}</Span>}
        {caret && <Caret />}
      </Line>
      {React.Children.map(children, (child, idx) => (
        <Line key={idx}>
          {pad}
          <Span c={c}>{"▍ "}</Span>
          {child}
        </Line>
      ))}
    </>
  );
};

// Ultra-minimal bubble: indent + tag header, no glyphs
const TagBubble = ({
  who = "AI",
  whoColor = "green",
  info,
  cols = 96,
  inset = 1,
  children,
  caret = false,
}) => {
  const pad = " ".repeat(inset);
  return (
    <>
      <Line>
        {pad}
        <Span c={whoColor} b>{who}</Span>
        <Span c="faint">{"  ┊  "}</Span>
        {info && <Span c="dim">{info}</Span>}
        {caret && <Caret />}
      </Line>
      {React.Children.map(children, (child, idx) => (
        <Line key={idx}>
          {pad}
          {"  "}
          {child}
        </Line>
      ))}
    </>
  );
};

// System message line
const SysLine = ({ children, c = "dim", glyph = " · " }) => (
  <Line>
    <Span c={c} i>{glyph}{children}</Span>
  </Line>
);

// Divider line for workspace switches
const Divider = ({ text, color = "magenta", cols = 96 }) => {
  const dashes = " ── ";
  return (
    <Line>
      <Span c={color} b>{` ── ${text} ── `}</Span>
    </Line>
  );
};

// Level meter — 40 chars wide bar with color thresholds, rendered as colored spans
const MicMeter = ({ mmss = "00:23", filled = 16, total = 40, lvl = 35.2, peak = 78, tone = "green" }) => {
  const block = "█".repeat(filled);
  const empty = "░".repeat(total - filled);
  return (
    <Line>
      {" "}
      <Span c="yellow" b>{mmss}</Span>{" "}
      <Span c="dim">mic </Span>
      <Span c={tone}>{block}</Span>
      <Span c="faint">{empty}</Span>
      <Span c="dim">{`  lvl ${lvl.toFixed(1)}% · peak ${peak}%`}</Span>
    </Line>
  );
};

// Inline sparkline (mini chart from values 0..1)
const Spark = ({ values, c = "green" }) => {
  const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const s = values
    .map((v) => blocks[Math.min(7, Math.max(0, Math.round(v * 7)))])
    .join("");
  return <Span c={c}>{s}</Span>;
};

// Mini bar gauge: ▏▎▍▌▋▊▉█ — 1 char proportional
const MiniBar = ({ value = 0.5, width = 8, c = "green" }) => {
  const blocks = ["▏","▎","▍","▌","▋","▊","▉","█"];
  const total = width;
  const v = Math.max(0, Math.min(1, value));
  const filledF = v * total;
  const full = Math.floor(filledF);
  const frac = filledF - full;
  const tip = frac > 0 ? blocks[Math.min(7, Math.floor(frac * 8))] : "";
  return (
    <Span c={c}>{"█".repeat(full)}{tip}<Span c="faint">{"░".repeat(Math.max(0, total - full - (tip ? 1 : 0)))}</Span></Span>
  );
};

// Footer key-row helper
const KeyRow = ({ items }) => (
  <Line>
    {items.map((it, idx) => (
      <React.Fragment key={idx}>
        <Key k={it.k} />
        <Span c="dim">{` ${it.label}  `}</Span>
      </React.Fragment>
    ))}
  </Line>
);

// share to window for cross-script use
Object.assign(window, {
  Span, ChipMode, ChipWs, ChipFlash, Key, Caret,
  Term, Line, Blank, PanelBubble, BarBubble, TagBubble, SysLine, Divider,
  MicMeter, Spark, MiniBar, KeyRow, repeat, vwidth,
});
