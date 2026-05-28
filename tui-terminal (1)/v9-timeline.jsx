/* eslint-disable react/prop-types */
// V9 — Timeline / Gantt
// Conversation flows top-to-bottom but each turn is a HORIZONTAL Gantt row:
// record → asr → polish → llm → tts, each a colored bar with its real duration.
// Latency is BAKED INTO the visual — no separate telemetry. You see immediately
// where time went (polish slow? llm slow? tts queued?).
// Caption text sits under each Gantt row.

const V9 = () => (
  <div className="proto">
    <div className="label-row">
      <h3>V9 · Timeline / Gantt</h3>
      <span className="meta">每个 turn = Gantt 行 · 延迟即叙事</span>
    </div>
    <div className="stack">
      <V9Variant cols={80} state="active" />
      <V9Variant cols={140} state="active" />
    </div>
    <p className="cap">
      <span className="pill">why</span>
      Treats the demo's central asset — <b>latency</b> — as the primary visual,
      not a footnote. Every turn shows where its 2.34s went: <Span c="yellow">█</Span>
      record, <Span c="cyan">█</Span> asr, <Span c="magenta">█</Span> polish,
      <Span c="green">█</Span> llm-token, <Span c="green">▆</Span> tts. You can
      <i> see</i> that polish ate 400ms before any text appeared, or that TTS
      queued behind LLM tokens. Captions sit under each row. The whole thing is
      basically a flame-chart for your voice loop.
    </p>
  </div>
);

const V9Variant = ({ cols, state }) => (
  <div>
    <Term cols={cols} rows={26} clock="18:50">
      <V9Body cols={cols} />
    </Term>
    <div className="cap" style={{ marginTop: 10 }}>
      <span className="pill">{cols} cols</span>
      Recent 3 turns visible as Gantt rows. Active turn animates from left.
    </div>
  </div>
);

const V9Body = ({ cols }) => {
  // Total chars used for the timeline bar — leave room for prefix label
  const labelW = cols >= 100 ? 22 : 14;
  const tailW = cols >= 100 ? 14 : 9; // "★705 · 2.34s"
  const barW = cols - labelW - tailW - 2;

  return (
    <>
      <V9Header cols={cols} />
      <Line>
        <Span c="border-soft">{"─".repeat(cols - 2)}</Span>
      </Line>
      <Blank n={1} />
      <V9Turn
        cols={cols}
        labelW={labelW}
        barW={barW}
        tailW={tailW}
        time="18:48"
        kind="you"
        text="先看上一份附录里的现金流。"
        stages={[
          { name: "rec",   from: 0.00, to: 0.42, c: "yellow"  },
          { name: "asr",   from: 0.42, to: 0.55, c: "cyan"    },
          { name: "polish",from: 0.55, to: 0.72, c: "magenta" },
          { name: "llm",   from: 0.72, to: 1.40, c: "green"   },
          { name: "tts",   from: 1.10, to: 1.92, c: "green"   },
        ]}
        firstAudio={612}
        total={1.92}
        complete
      />
      <Blank n={1} />
      <V9Turn
        cols={cols}
        labelW={labelW}
        barW={barW}
        tailW={tailW}
        time="18:49"
        kind="you"
        text="请帮我看一下今天的财报数据,重点关注云业务收入占比和毛利率。"
        polished
        stages={[
          { name: "rec",   from: 0.00, to: 0.95, c: "yellow"  },
          { name: "asr",   from: 0.95, to: 1.10, c: "cyan"    },
          { name: "polish",from: 1.10, to: 1.51, c: "magenta" },
          { name: "llm",   from: 1.51, to: 2.20, c: "green"   },
          { name: "tts",   from: 1.85, to: 2.34, c: "green"   },
        ]}
        firstAudio={705}
        total={2.34}
        complete
      />
      <Blank n={1} />
      <V9Turn
        cols={cols}
        labelW={labelW}
        barW={barW}
        tailW={tailW}
        time="now"
        kind="you"
        text="现金流那个,先告诉我自由现金流"
        live
        stages={[
          { name: "rec",   from: 0.00, to: 0.62, c: "yellow",  live: true },
        ]}
      />
      <Blank n={cols === 80 ? 2 : 3} />
      <Line>
        <Span c="border-soft">{"─".repeat(cols - 2)}</Span>
      </Line>
      <V9Bottom cols={cols} />
    </>
  );
};

const V9Header = ({ cols }) => (
  <Line>
    <Span c="dim">{" "}</Span>
    <Span bg="var(--ansi-yellow)" b style={{color:"#1a1814"}}>{" ⠋ 录音中   "}</Span>
    <Span c="dim">{"   "}</Span>
    <Span c="yellow">{"📁 "}</Span>
    <Span c="yellow" b>{"研究 Q3 财报"}</Span>
    <Span c="dim">{"   · 3 turns shown · "}</Span>
    <Span c="dim">{"axis 0 ─── 3s"}</Span>
    <Span c="dim">{"   · "}</Span>
    <Span c="cyan">{"⏱ avg 705ms"}</Span>
  </Line>
);

const V9Bottom = ({ cols }) => (
  <Line>
    {/* mini legend + keys */}
    <Span c="dim">{" "}</Span>
    <Span c="yellow">{"█"}</Span><Span c="dim">{"rec "}</Span>
    <Span c="cyan">{"█"}</Span><Span c="dim">{"asr "}</Span>
    <Span c="magenta">{"█"}</Span><Span c="dim">{"polish "}</Span>
    <Span c="green">{"█"}</Span><Span c="dim">{"llm "}</Span>
    <Span c="green">{"▆"}</Span><Span c="dim">{"tts   "}</Span>
    <Span c="dim">{"  "}</Span>
    <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" space "}</Span>
    <Span c="dim">{" 录音  "}</Span>
    <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" i "}</Span>
    <Span c="dim">{" 打断  "}</Span>
    <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" w "}</Span>
    <Span c="dim">{" 工作区  "}</Span>
    <Span bg="#2f2b25" b style={{color:"#e6e0d4",padding:"0 1ch"}}>{" ? "}</Span>
    <Span c="dim">{" all"}</Span>
  </Line>
);

// Render ONE Gantt row + caption
const V9Turn = ({ cols, labelW, barW, tailW, time, kind, text, stages, firstAudio, total, polished, live, complete }) => {
  const maxSec = 3.0; // axis 0..3s
  // Render a single row of stage bars: for each col index 0..barW, look up which stage covers it
  // Stages can overlap (e.g. tts starts during llm) — we'll render two adjacent rows for clarity.

  // Row A — primary pipeline (rec, asr, polish, llm)
  const rowA = stages.filter((s) => s.name !== "tts");
  // Row B — tts only (offset row)
  const rowB = stages.filter((s) => s.name === "tts");

  const barRow = (rowStages) => {
    const cells = [];
    for (let c = 0; c < barW; c++) {
      const t = (c / barW) * maxSec;
      let stage = null;
      for (const s of rowStages) {
        if (t >= s.from && t < s.to) { stage = s; break; }
      }
      if (stage) {
        const isEdge = c === Math.round((stage.from / maxSec) * barW);
        cells.push(
          <Span key={c} c={stage.c} b>{stage.live ? "▒" : "█"}</Span>
        );
      } else {
        cells.push(<Span key={c} c="faint">{"·"}</Span>);
      }
    }
    return cells;
  };

  // Build labels for each non-tts stage on its bar
  const stageLabels = (rowStages, kindRow) => {
    const arr = new Array(barW).fill(null);
    for (const s of rowStages) {
      const startCol = Math.round((s.from / maxSec) * barW);
      const label = s.name;
      // place label centered in bar if there's room
      const widthCols = Math.round(((s.to - s.from) / maxSec) * barW);
      if (widthCols >= label.length + 2) {
        const startLabel = startCol + Math.floor((widthCols - label.length) / 2);
        for (let i = 0; i < label.length; i++) {
          arr[startLabel + i] = { ch: label[i], stage: s };
        }
      }
    }
    return arr.map((cell, i) => {
      if (cell) {
        return <Span key={i} c="white" b>{cell.ch}</Span>;
      }
      return <Span key={i}>{" "}</Span>;
    });
  };

  // Speaker glyph + time
  const speakerGlyph = kind === "you" ? "›" : "‹";
  const speakerColor = kind === "you" ? "cyan" : "green";

  // Label cell
  const label = (
    <span style={{ display:"inline-block", width:`${labelW}ch`, whiteSpace:"pre", verticalAlign:"top" }}>
      <Span c={speakerColor} b>{` ${speakerGlyph} `}</Span>
      <Span c="dim">{time}</Span>
      {polished && <Span c="magenta">{" ✨"}</Span>}
      {live && <Span c="yellow" b>{" ⠹ rec"}</Span>}
    </span>
  );

  // Tail (latency)
  const tail = (
    <span style={{ display:"inline-block", width:`${tailW}ch`, whiteSpace:"pre", textAlign:"right", verticalAlign:"top" }}>
      {complete ? (
        <>
          <Span c="green" b>{`★${firstAudio}`}</Span>
          <Span c="dim">{" · Σ"}</Span>
          <Span c="cyan" b>{`${total}`}</Span>
          <Span c="dim">{"s "}</Span>
        </>
      ) : live ? (
        <>
          <Span c="yellow" b>{"··· "}</Span>
        </>
      ) : null}
    </span>
  );

  // Row 1 — labels inside bars
  // Row 2 — actual bars
  // Row 3 — caption (text)
  return (
    <>
      {/* main bar row */}
      <Line>
        {label}
        <span style={{ display:"inline-block", width:`${barW}ch`, whiteSpace:"pre", verticalAlign:"top" }}>
          {stageLabels(rowA)}
        </span>
        {tail}
      </Line>
      <Line>
        <span style={{ display:"inline-block", width:`${labelW}ch`, whiteSpace:"pre", verticalAlign:"top" }}>{" "}</span>
        <span style={{ display:"inline-block", width:`${barW}ch`, whiteSpace:"pre", verticalAlign:"top" }}>
          {barRow(rowA)}
        </span>
        <span style={{ display:"inline-block", width:`${tailW}ch`, whiteSpace:"pre", verticalAlign:"top" }}>{" "}</span>
      </Line>
      {/* tts offset row, only if present */}
      {rowB.length > 0 && (
        <Line>
          <span style={{ display:"inline-block", width:`${labelW}ch`, whiteSpace:"pre", verticalAlign:"top" }}>
            <Span c="dim">{"      ↳ tts"}</Span>
          </span>
          <span style={{ display:"inline-block", width:`${barW}ch`, whiteSpace:"pre", verticalAlign:"top" }}>
            {barRow(rowB)}
          </span>
          <span style={{ display:"inline-block", width:`${tailW}ch`, whiteSpace:"pre", verticalAlign:"top" }}>
            <Span c="dim">{" 5 segs"}</Span>
          </span>
        </Line>
      )}
      {/* caption */}
      <Line>
        <span style={{ display:"inline-block", width:`${labelW}ch`, whiteSpace:"pre", verticalAlign:"top" }}>{" "}</span>
        <span style={{ display:"inline-block", width:`${barW + tailW}ch`, whiteSpace:"pre", verticalAlign:"top" }}>
          <Span c={live ? "yellow" : "fg"}>{text}</Span>
          {live && <Caret />}
        </span>
      </Line>
    </>
  );
};

window.V9 = V9;
