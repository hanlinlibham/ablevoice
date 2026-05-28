/* eslint-disable react/prop-types */
// M1 — Terminal-in-Glass
// macOS HUD shape (rounded, vibrancy, soft shadow) but content is pure terminal:
// JetBrains Mono, ANSI palette, ASCII glyphs. The frame is Mac, the soul is terminal.
// This is the BASELINE — most balanced.

const M1 = () => (
  <div className="scene">
    <div className="scene-head">
      <h3>M1 · Terminal-in-Glass</h3>
      <span className="meta">Mac shape · terminal content · the baseline</span>
    </div>

    {/* Hero row: summoned HUD on a desktop */}
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20, marginBottom: 20 }}>
      <div>
        <M1HudSummoned />
        <FrameCaption tag="1 · summoned">
          User pressed <b>⌃Space</b>. HUD fades in mid-screen, vibrancy under it. Pulsing dot = mic armed. Workspace chip + last-used model on the right.
        </FrameCaption>
      </div>
      <div>
        <M1MenuBarPreview />
        <FrameCaption tag="2 · menu bar">
          Click the menu bar tray icon → compact preview. Last reply, live mode, latency hidden as a subtle <i>"~700ms"</i> footer (no number-flexing).
        </FrameCaption>
      </div>
    </div>

    {/* Row 2: recording + multi-turn */}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
      <div>
        <M1Recording />
        <FrameCaption tag="3 · recording">
          Speaking. Waveform replaces the prompt; live partial transcript animates in. Breathing-rate dot = system pulse (slow = healthy, fast = slow upstream).
        </FrameCaption>
      </div>
      <div>
        <M1Multiturn />
        <FrameCaption tag="4 · multi-turn">
          HUD grows upward as the conversation deepens. Faded older turns at top, current turn full-strength at bottom. No scrollbar — past fades naturally.
        </FrameCaption>
      </div>
    </div>

    {/* Row 3: workspace switcher + screenshot context */}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 20 }}>
      <div>
        <M1WorkspaceSwitcher />
        <FrameCaption tag="5 · workspace">
          Type or press <b>⇥</b>. Workspaces are paths (<code>~/research/q3</code>). Fuzzy match. Voice command also works: <i>"切到 Q3 财报"</i>.
        </FrameCaption>
      </div>
      <div>
        <M1Screenshot />
        <FrameCaption tag="6 · Mac-native">
          <b>⌘⇧4</b> or drag any image onto HUD. Thumbnail stack to the left of input. Voice + screenshot context = "what does this chart mean?". TUI literally can't do this.
        </FrameCaption>
      </div>
    </div>
  </div>
);

// ====================== 1. Summoned HUD ======================
const M1HudSummoned = () => (
  <MacStage width={720} height={460} wallpaper="dusk">
    <MacHUD x={120} y={150} width={480}>
      <M1HudHeader workspace="default" />
      <div style={{ padding: "18px 22px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{
            width: 10, height: 10, borderRadius: "50%",
            background: "var(--ansi-cyan)",
            boxShadow: "0 0 0 0 rgba(107,214,200,0.5)",
            animation: "m1pulse 1.6s ease-out infinite",
          }} />
          <Span c="dim">{"hold "}</Span>
          <span style={{
            display: "inline-block",
            background: "rgba(255,255,255,0.12)",
            padding: "2px 8px", borderRadius: 5,
            fontSize: 12, fontWeight: 600, color: "#e6e0d4",
          }}>space</span>
          <Span c="dim">{" to talk, or just start speaking"}</Span>
        </div>
        <div style={{ marginTop: 16, fontSize: 12, color: "rgba(230,224,212,0.5)" }}>
          ── try: <Span c="fg-soft" i>{"\"看一下今天的财报\""}</Span>{" · "}
          <Span c="fg-soft" i>{"\"切到 scratch\""}</Span>{" · "}
          <Span c="fg-soft" i>{"\"截这块屏问一下\""}</Span>
        </div>
      </div>
    </MacHUD>
    <Kbd x={620} y={395}>⌃Space</Kbd>
  </MacStage>
);

// ====================== 2. Menu bar preview ======================
const M1MenuBarPreview = () => (
  <MacStage width={500} height={460} wallpaper="graphite"
    asrTray={<><Span c="green">{"⠹"}</Span><span style={{marginLeft:4,fontFamily:"JetBrains Mono"}}>able-asr</span></>}
  >
    {/* dropdown card */}
    <div style={{
      position: "absolute", top: 32, right: 80, width: 320,
      background: "rgba(24,22,19,0.86)",
      backdropFilter: "blur(40px) saturate(150%)",
      WebkitBackdropFilter: "blur(40px) saturate(150%)",
      borderRadius: 10,
      boxShadow: "0 20px 50px -10px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.07) inset",
      fontFamily: "JetBrains Mono",
      color: "#e6e0d4",
      fontSize: 12,
      overflow: "hidden",
    }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 8 }}>
        <Span bg="var(--ansi-green)" b style={{ color: "#14201a", padding: "1px 6px", borderRadius: 3, fontSize: 10 }}>{" thinking "}</Span>
        <Span c="yellow">{"📁 q3-financials"}</Span>
      </div>
      <div style={{ padding: "12px 14px", lineHeight: 1.5 }}>
        <div style={{ color: "rgba(230,224,212,0.55)", fontSize: 11, marginBottom: 4 }}>last reply</div>
        <Span c="fg">{"营收同比 +12%,云业务占比"}</Span>
        <br />
        <Span c="fg">{"首次超过 30%,毛利率提升…"}</Span>
      </div>
      <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", color: "rgba(230,224,212,0.5)", fontSize: 11 }}>
        <span>~700ms response</span>
        <span>open · ⌃Space</span>
      </div>
    </div>
    {/* highlight arrow to menu bar tray */}
    <svg style={{ position: "absolute", top: 30, right: 145, width: 60, height: 12 }} viewBox="0 0 60 12">
      <path d="M58 6 Q40 0 4 6" stroke="#c96442" strokeWidth="1.5" fill="none" />
      <path d="M4 6 L9 2 M4 6 L9 10" stroke="#c96442" strokeWidth="1.5" fill="none" />
    </svg>
  </MacStage>
);

// ====================== 3. Recording ======================
const M1Recording = () => {
  const samples = fakeSpeech(50, 2);
  return (
    <MacStage width={620} height={460} wallpaper="dusk">
      <MacHUD x={70} y={130} width={480}>
        <M1HudHeader workspace="q3-financials" state="rec" />
        <div style={{ padding: "18px 22px 22px" }}>
          {/* breathing dot */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <span style={{
              width: 10, height: 10, borderRadius: "50%",
              background: "var(--ansi-yellow)",
              boxShadow: "0 0 12px rgba(230,196,102,0.65)",
              animation: "m1breathe 1.1s ease-in-out infinite",
            }} />
            <Span c="yellow" b>{"recording"}</Span>
            <Span c="dim">{"0:23"}</Span>
            <span style={{ flex: 1 }} />
            <Span c="dim">{"release "}</Span>
            <span style={{ display: "inline-block", background: "rgba(255,255,255,0.12)", padding: "1px 7px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>space</span>
            <Span c="dim">{" to send"}</Span>
          </div>
          {/* waveform */}
          <div style={{ fontSize: 13, lineHeight: 1.1 }}>
            <HudWave samples={samples} rows={4} cols={50} c="yellow" />
          </div>
          {/* partial transcript */}
          <div style={{ marginTop: 16 }}>
            <Span c="dim">{"› "}</Span>
            <Span c="fg" i>{"现金流那个先告诉我自由现金流"}</Span>
            <Caret />
          </div>
        </div>
      </MacHUD>
    </MacStage>
  );
};

// ====================== 4. Multi-turn ======================
const M1Multiturn = () => (
  <MacStage width={620} height={460} wallpaper="dusk">
    <MacHUD x={70} y={70} width={480}>
      <M1HudHeader workspace="q3-financials" state="think" />
      <div style={{ padding: "16px 22px 20px", maxHeight: 340, overflow: "hidden" }}>
        {/* faded older turn */}
        <div style={{ opacity: 0.42 }}>
          <div style={{ marginBottom: 4 }}>
            <Span c="cyan" b>{"› "}</Span><Span c="fg">{"请帮我看一下今天的财报数据"}</Span>
          </div>
          <div style={{ marginBottom: 10, paddingLeft: 16 }}>
            <Span c="fg">{"营收同比 +12%,云业务占比首次超过 30%,毛利率提升 1.8pt。"}</Span>
          </div>
        </div>
        {/* mid-strength */}
        <div style={{ opacity: 0.72, marginTop: 8 }}>
          <div style={{ marginBottom: 4 }}>
            <Span c="cyan" b>{"› "}</Span><Span c="fg">{"云业务那块再展开讲讲?"}</Span>
          </div>
          <div style={{ marginBottom: 10, paddingLeft: 16 }}>
            <Span c="fg">{"云业务收入 14.2B,SaaS 占 62%,首次贡献正经营现金流。"}</Span>
          </div>
        </div>
        {/* current */}
        <div style={{ marginTop: 10 }}>
          <div style={{ marginBottom: 4 }}>
            <Span c="cyan" b>{"› "}</Span><Span c="fg">{"自由现金流呢?"}</Span>
            <Span c="magenta">{"  ✨"}</Span>
          </div>
          <div style={{ paddingLeft: 16 }}>
            <Span c="fg">{"自由现金流 +18% YoY,Q3 单季 14.2 B,主要受云业务"}</Span>
            <br />
            <Span c="fg">{"现金贡献提升和应收账款周转优化"}</Span>
            <Caret />
          </div>
        </div>
      </div>
      {/* slim footer */}
      <div style={{
        padding: "8px 22px", borderTop: "1px solid rgba(255,255,255,0.06)",
        display: "flex", justifyContent: "space-between",
        color: "rgba(230,224,212,0.4)", fontSize: 11,
      }}>
        <span>3 turns · ~700ms</span>
        <span>⌥↑ to fade · ⌘K to clear</span>
      </div>
    </MacHUD>
  </MacStage>
);

// ====================== 5. Workspace switcher ======================
const M1WorkspaceSwitcher = () => (
  <MacStage width={520} height={460} wallpaper="dusk">
    <MacHUD x={70} y={70} width={380}>
      <div style={{ padding: "14px 18px 6px", display: "flex", alignItems: "center", gap: 10 }}>
        <Span c="dim">{"cd"}</Span>
        <input
          readOnly
          value="q3"
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            color: "#e6c466", fontFamily: "JetBrains Mono", fontSize: 14, fontWeight: 600,
          }}
        />
        <Span c="dim">{"⇥"}</Span>
      </div>
      <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
      <div style={{ padding: "8px 0" }}>
        {[
          { name: "q3-financials",       hit: "q3",  files: 17, recent: "live · 2 turns", live: true,  matched: [0,1] },
          { name: "q3-board-deck",       hit: "q3",  files: 8,  recent: "2h ago", matched: [0,1] },
          { name: "research-base",       hit: "",    files: 42, recent: "2d ago" },
          { name: "scratch",             hit: "",    files: 6,  recent: "1d ago" },
          { name: "inbox",               hit: "",    files: 3,  recent: "3 unread", warn: true },
        ].map((w, i) => (
          <div key={i} style={{
            padding: "6px 18px",
            background: i === 0 ? "rgba(255,255,255,0.07)" : "transparent",
            display: "flex", alignItems: "center", gap: 10,
            fontSize: 13,
          }}>
            <Span c={w.live ? "green" : "dim"}>{w.live ? "●" : "○"}</Span>
            <span style={{ color: i === 0 ? "#e6c466" : "#cabfa9", fontWeight: i === 0 ? 600 : 400 }}>
              <span>~/</span>
              {w.matched ? (
                <>
                  <span style={{ background: "rgba(230,196,102,0.25)", padding: "0 1px" }}>{w.name.slice(0, 2)}</span>
                  {w.name.slice(2)}
                </>
              ) : w.name}
            </span>
            <span style={{ flex: 1 }} />
            <Span c="faint">{`${w.files} files`}</Span>
            <Span c={w.warn ? "yellow" : "faint"}>{`· ${w.recent}`}</Span>
          </div>
        ))}
      </div>
      <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
      <div style={{ padding: "8px 18px", display: "flex", gap: 14, color: "rgba(230,224,212,0.45)", fontSize: 11 }}>
        <span>↑↓ move</span>
        <span>⏎ open</span>
        <span>⌘N new</span>
        <span style={{ marginLeft: "auto" }}>or say "切到…"</span>
      </div>
    </MacHUD>
  </MacStage>
);

// ====================== 6. Screenshot context ======================
const M1Screenshot = () => (
  <MacStage width={620} height={460} wallpaper="dusk">
    {/* fake selection lasso on the desktop behind */}
    <svg style={{ position: "absolute", top: 60, left: 380, pointerEvents: "none" }} width="200" height="120">
      <rect x="6" y="6" width="188" height="108" fill="rgba(107,159,227,0.18)" stroke="#6b9fe3" strokeWidth="1.5" strokeDasharray="4 3" />
      <text x="12" y="22" fontFamily="JetBrains Mono" fontSize="10" fill="#6b9fe3" fontWeight="700">200 × 120</text>
    </svg>
    <MacHUD x={70} y={250} width={480}>
      {/* thumbnail strip */}
      <div style={{ padding: "12px 14px 10px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{
          width: 56, height: 36, borderRadius: 4,
          background: "linear-gradient(135deg, rgba(107,159,227,0.4), rgba(126,194,122,0.3))",
          border: "1px solid rgba(255,255,255,0.1)",
          position: "relative",
        }}>
          <div style={{ position: "absolute", inset: 4, border: "1px dashed rgba(255,255,255,0.5)", borderRadius: 2 }} />
        </div>
        <div style={{ width: 56, height: 36, borderRadius: 4, background: "rgba(255,255,255,0.08)", border: "1px dashed rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(230,224,212,0.4)", fontSize: 18 }}>+</div>
        <div style={{ flex: 1 }} />
        <Span c="dim">{"⌘⇧4 region · drag images · ⌘V paste"}</Span>
      </div>
      <div style={{ padding: "16px 22px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <span style={{
            width: 10, height: 10, borderRadius: "50%",
            background: "var(--ansi-yellow)",
            boxShadow: "0 0 12px rgba(230,196,102,0.65)",
            animation: "m1breathe 1.1s ease-in-out infinite",
          }} />
          <Span c="yellow" b>{"recording"}</Span>
          <Span c="dim">{"with screenshot context"}</Span>
        </div>
        <div>
          <Span c="dim">{"› "}</Span>
          <Span c="fg" i>{"这块的毛利率为什么环比下降这么多"}</Span>
          <Caret />
        </div>
      </div>
    </MacHUD>
  </MacStage>
);

// ====================== Shared HUD header ======================
const M1HudHeader = ({ workspace = "default", state = "idle" }) => {
  const m = MODE_COLORS[state];
  return (
    <div style={{
      padding: "10px 16px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      display: "flex", alignItems: "center", gap: 10,
      fontSize: 12,
    }}>
      <span style={{
        background: m.bg, color: m.fg, padding: "2px 8px", borderRadius: 5,
        fontWeight: 600, fontFamily: "JetBrains Mono",
      }}>
        {state === "rec" ? "⠋ rec" : state === "think" ? "⠹ think" : state === "polish" ? "✨ polish" : "○ ready"}
      </span>
      <Span c="dim">{"~/"}</Span>
      <Span c="yellow" b>{workspace}</Span>
      <span style={{ flex: 1 }} />
      <Span c="dim">{"paraformer · ablework · Maia"}</Span>
    </div>
  );
};

const Kbd = ({ x, y, children }) => (
  <span style={{
    position: "absolute", left: x, top: y,
    fontFamily: "JetBrains Mono", fontSize: 11, fontWeight: 600,
    background: "rgba(0,0,0,0.45)", color: "#e6e0d4",
    padding: "3px 8px", borderRadius: 5,
    backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
    border: "1px solid rgba(255,255,255,0.1)",
  }}>{children}</span>
);

// Keyframes once
(() => {
  if (document.getElementById("m1-kf")) return;
  const s = document.createElement("style");
  s.id = "m1-kf";
  s.textContent = `
    @keyframes m1pulse {
      0% { box-shadow: 0 0 0 0 rgba(107,214,200,0.45); }
      70% { box-shadow: 0 0 0 14px rgba(107,214,200,0); }
      100% { box-shadow: 0 0 0 0 rgba(107,214,200,0); }
    }
    @keyframes m1breathe {
      0%, 100% { transform: scale(1); opacity: 0.75; }
      50% { transform: scale(1.18); opacity: 1; }
    }
  `;
  document.head.appendChild(s);
})();

window.M1 = M1;
