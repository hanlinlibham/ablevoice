/* eslint-disable react/prop-types */
// V7 — Waveform-first
// Voice IS the UI. A multi-row centered waveform fills the middle of the
// screen, showing the last few minutes of audio history. Each speech turn
// leaves a visible "fingerprint" in the wave. Latency dots float above as a
// parallel time series. Conversation text is captions to the side / below.
// Mode is communicated by the waveform's COLOR, not by chips.

// ---- waveform synthesizer (centered bars per column) ----
// Builds a JSX block of ROWS rows × COLS cols, centered vertically.
// `samples` is an array of length COLS, values in [0..1].
// `colorFor(i, amp)` returns a CSS color class hint per column.
function Waveform({ samples, rows = 7, cols = 80, colorFor }) {
  const center = (rows - 1) / 2;
  const out = [];
  for (let r = 0; r < rows; r++) {
    const cells = [];
    for (let c = 0; c < cols; c++) {
      const a = Math.max(0, Math.min(1, samples[c] || 0));
      const half = (a * rows) / 2;
      const dist = Math.abs(r - center);
      let ch = " ";
      if (dist <= half - 0.45) ch = "█";
      else if (dist <= half - 0.05) ch = r < center ? "▄" : "▀";
      // color: bright near peaks, dim near rest
      const color = colorFor ? colorFor(c, a) : a > 0.7 ? "yellow" : a > 0.3 ? "green" : "cyan";
      cells.push(
        <Span key={c} c={a > 0.05 ? color : "faint"}>{ch}</Span>
      );
    }
    out.push(<Line key={r}>{cells}</Line>);
  }
  return <>{out}</>;
}

// fake audio history: returns [0..1] amplitudes that look like 3 turns of speech
function synthSamples(cols, segments) {
  // segments: [{start, end, amp, kind}]  start/end are column indices
  const out = new Array(cols).fill(0).map((_, i) => 0.02 + Math.random() * 0.04);
  for (const s of segments) {
    for (let c = s.start; c <= s.end && c < cols; c++) {
      // shape: gaussian-ish envelope * fine wiggle
      const t = (c - s.start) / Math.max(1, s.end - s.start);
      const env = Math.sin(Math.PI * t) ** 0.6;
      const wiggle = 0.55 + 0.45 * Math.sin(c * 0.9 + s.start) * Math.cos(c * 0.31);
      out[c] = s.amp * env * (0.5 + 0.5 * wiggle);
    }
  }
  return out;
}

const V7 = () => (
  <div className="proto">
    <div className="label-row">
      <h3>V7 · Waveform-first</h3>
      <span className="meta">voice IS the UI · mode = waveform color/shape</span>
    </div>
    <div className="stack">
      <V7Variant cols={80} state="idle" />
      <V7Variant cols={120} state="active" />
    </div>
    <p className="cap">
      <span className="pill">why</span>
      Re-grounds the UI in what it actually is — an <b>audio interface</b>. The last
      few minutes of mic history are visible as a centered, color-graded waveform. You
      can see "I just said three things, the second one was loud." Each turn drops a
      visible <b>fingerprint</b> + ★ latency dot. Mode is communicated by waveform
      <i> color</i> (yellow=rec, green=think, cyan=idle, magenta=polish) — no chip
      needed, no row spent on status. Captions and ★ float around the wave.
      Hard requirement: OpenTUI or Ink + Yoga (Textual can't animate this).
    </p>
  </div>
);

const V7Variant = ({ cols, state }) => (
  <div>
    <Term cols={cols} rows={24} clock="18:50">
      {state === "idle" ? <V7Idle cols={cols} /> : <V7Active cols={cols} />}
    </Term>
    <div className="cap" style={{ marginTop: 10 }}>
      <span className="pill">{cols} cols</span>
      {state === "idle"
        ? "Idle — wave is flat & dim; ready cue is the centered dotted axis."
        : "Active — mid-recording, peak fingerprints from last 2 turns visible to the left."}
    </div>
  </div>
);

// Idle / welcome
const V7Idle = ({ cols }) => {
  const samples = new Array(cols).fill(0).map(() => 0.03 + Math.random() * 0.04);
  return (
    <>
      <Blank n={1} />
      {/* top timeline scale */}
      <Line>
        <Span c="faint">{" ".repeat(2)}</Span>
        <Span c="dim">{"5m ago".padEnd(Math.floor(cols / 5))}</Span>
        <Span c="dim">{"4m".padEnd(Math.floor(cols / 5))}</Span>
        <Span c="dim">{"3m".padEnd(Math.floor(cols / 5))}</Span>
        <Span c="dim">{"2m".padEnd(Math.floor(cols / 5))}</Span>
        <Span c="dim">{"1m"}</Span>
        <Span c="cyan" b>{"   now ›"}</Span>
      </Line>
      <Blank n={1} />
      <Waveform samples={samples} rows={5} cols={cols} colorFor={() => "faint"} />
      <Line>
        <Span c="faint">{"·".repeat(cols)}</Span>
      </Line>
      <Blank n={2} />
      {/* welcome line */}
      <Line>
        <Span c="dim">{" ".repeat(Math.max(2, Math.floor((cols - 56) / 2)))}</Span>
        <Span c="cyan" b>{"hold "}</Span>
        <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" space "}</Span>
        <Span c="cyan" b>{" to record"}</Span>
        <Span c="dim">{"   ·   waveform colors: "}</Span>
        <Span c="yellow">{"rec"}</Span>
        <Span c="dim">{" / "}</Span>
        <Span c="green">{"think"}</Span>
        <Span c="dim">{" / "}</Span>
        <Span c="cyan">{"idle"}</Span>
      </Line>
      <Blank n={cols === 80 ? 4 : 5} />
      {/* bottom minimal hint */}
      <Line>
        <Span c="dim">{" "}</Span>
        <Span c="yellow">{"📁"}</Span>
        <Span c="yellow" b>{" 默认 sandbox"}</Span>
        <Span c="dim">{"   ·   paraformer · ablework · Maia   ·   "}</Span>
        <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" ? "}</Span>
        <Span c="dim">{" keys"}</Span>
      </Line>
    </>
  );
};

// Active — recording mid-flight, with history
const V7Active = ({ cols }) => {
  // Build segments: 2 past turns + 1 current
  const segments = [
    { start: Math.floor(cols * 0.05), end: Math.floor(cols * 0.18), amp: 0.55, kind: "user" },     // 你 turn 1
    { start: Math.floor(cols * 0.22), end: Math.floor(cols * 0.36), amp: 0.78, kind: "ai" },        // AI replied
    { start: Math.floor(cols * 0.42), end: Math.floor(cols * 0.55), amp: 0.62, kind: "user" },     // 你 turn 2
    { start: Math.floor(cols * 0.60), end: Math.floor(cols * 0.78), amp: 0.85, kind: "ai" },        // AI replied
    { start: Math.floor(cols * 0.86), end: cols - 4, amp: 0.72, kind: "user" },                     // current recording
  ];
  const samples = synthSamples(cols, segments);

  // Color per column based on which segment it falls into
  const colorFor = (c) => {
    for (const s of segments) {
      if (c >= s.start && c <= s.end) {
        if (s === segments[segments.length - 1]) return "yellow"; // currently recording
        return s.kind === "user" ? "cyan" : "green";
      }
    }
    return "faint";
  };

  // Latency dot markers above the waveform — small ★ at the end of each completed turn
  // Map: completed AI segments leave a ★ at their end column showing first-audio latency.
  const latencyMarkers = segments
    .filter((s) => s.kind === "ai")
    .map((s, i) => ({ col: s.end, ms: i === 0 ? 612 : 705 }));

  return (
    <>
      {/* top: timeline scale */}
      <Line>
        <Span c="faint">{" "}</Span>
        <Span c="dim">{"history ›".padEnd(Math.floor(cols / 4))}</Span>
        <Span c="dim">{"3m ago".padEnd(Math.floor(cols / 4))}</Span>
        <Span c="dim">{"1m".padEnd(Math.floor(cols / 4))}</Span>
        <Span c="yellow" b>{"  ⠹ recording…"}</Span>
      </Line>
      {/* latency-dot row */}
      <Line>
        {Array.from({ length: cols }, (_, c) => {
          const m = latencyMarkers.find((l) => Math.abs(l.col - c) <= 1);
          if (m && c === m.col) return <Span key={c} c="green" b>★</Span>;
          if (m && Math.abs(m.col - c) === 1) {
            const text = ` ${m.ms}ms`;
            return null; // placeholder — text added separately
          }
          return <Span key={c} c="faint"> </Span>;
        })}
      </Line>
      {/* latency text labels */}
      <Line>
        {Array.from({ length: cols }, (_, c) => {
          const m = latencyMarkers.find((l) => l.col === c);
          if (m) return <Span key={c} c="green" b>{`${m.ms}`}</Span>;
          // skip the digit span chars
          const mPrev = latencyMarkers.find((l) => l.col < c && l.col + (`${l.ms}`).length > c);
          if (mPrev) return null;
          return <Span key={c}> </Span>;
        })}
      </Line>
      <Blank n={1} />
      {/* The hero waveform */}
      <Waveform samples={samples} rows={7} cols={cols} colorFor={colorFor} />
      {/* dotted center axis */}
      <Line>
        <Span c="faint">{"·".repeat(cols)}</Span>
      </Line>
      <Blank n={1} />
      {/* Captions row — last completed turn shown as a brief caption */}
      <Line>
        <Span c="green" b>{" ‹ "}</Span>
        <Span c="fg">{"今天的财报显示营收同比增长 12%,云业务占比首次超过 30%。"}</Span>
        <Span c="dim">{"   ★705 · ✓"}</Span>
      </Line>
      <Line>
        <Span c="yellow" b>{" ⠹ "}</Span>
        <Span c="fg">{"现金流那个先告诉我自由现金流"}</Span>
        <Caret />
        <Span c="dim">{"   (实时识别)"}</Span>
      </Line>
      <Blank n={cols === 80 ? 1 : 2} />
      {/* Bottom: minimal contextual hotkeys + workspace */}
      <Line>
        <Span c="yellow">{" 📁 "}</Span>
        <Span c="yellow" b>{"研究 Q3 财报"}</Span>
        <Span c="dim">{"   ·   "}</Span>
        <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" i "}</Span>
        <Span c="dim">{" 打断  "}</Span>
        <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" space "}</Span>
        <Span c="dim">{" 停录  "}</Span>
        <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" w "}</Span>
        <Span c="dim">{" 工作区  "}</Span>
        <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" tab "}</Span>
        <Span c="dim">{" transcript"}</Span>
      </Line>
    </>
  );
};

window.V7 = V7;
