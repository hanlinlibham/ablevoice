/* eslint-disable react/prop-types */
// Mac client shared primitives: menu bar, HUD shell, mac window chrome,
// CRT shell. All sized in pixels (CSS) so they sit on the design canvas
// crisply. Reuses the TUI primitives (Span, Line, etc.) for content.

// ---------- Menu bar ----------
// Renders a full macOS menu bar at top of a stage.
// `activeApp` is the app name shown after the apple logo.
// `tray` is an array of strings rendered right-aligned (Wi-Fi · battery · clock).
// `asrTray` (optional) — special tray item showing able-asr live state
const MacMenuBar = ({ activeApp = "able-asr", menus = ["File", "Edit", "View", "Conversation", "Workspace", "Window", "Help"], asrTray, tray = ["􀙇", "100%", "Wed 18:50"] }) => (
  <div className="mac-menubar">
    <span className="apple"></span>
    <span className="app-name">{activeApp}</span>
    <div className="menus">
      {menus.map((m, i) => <span key={i}>{m}</span>)}
    </div>
    <span className="spacer" />
    <div className="tray">
      {asrTray && <span className="item active">{asrTray}</span>}
      {tray.map((t, i) => <span key={i} className="item">{t}</span>)}
    </div>
  </div>
);

// ---------- HUD shell ----------
// A floating rounded-corner panel. Used for M1 (Terminal-in-Glass), M3, etc.
const MacHUD = ({ x, y, width = 720, theme = "dark", children, style }) => (
  <div
    className={`hud ${theme === "light" ? "--light" : ""}`}
    style={{
      left: x, top: y, width,
      ...style,
    }}
  >
    {children}
  </div>
);

// ---------- Mac window ----------
const MacWindowChrome = ({ x, y, width = 720, height, title, toolbar, children }) => (
  <div className="mac-window" style={{ left: x, top: y, width, height }}>
    <div className="titlebar">
      <span className="lights"><i /><i /><i /></span>
      <span className="title">{title}</span>
      <span style={{ width: 56 }} />
    </div>
    {toolbar && <div className="toolbar">{toolbar}</div>}
    <div style={{ padding: 0 }}>{children}</div>
  </div>
);

// ---------- CRT shell (for M2) ----------
const CRT = ({ x, y, width = 720, height, theme = "phosphor", tilt = 0, children, style }) => (
  <div
    className={`crt ${theme === "amber" ? "--amber" : ""}`}
    style={{
      left: x, top: y, width, height,
      transform: tilt ? `rotate(${tilt}deg)` : undefined,
      ...style,
    }}
  >
    <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
  </div>
);

// ---------- Desktop stage ----------
// A bounded box with a macOS-style wallpaper that other elements sit inside.
const MacStage = ({ width, height, wallpaper = "dusk", showMenuBar = true, asrTray, children }) => (
  <div
    className={`mac-desktop --${wallpaper}`}
    style={{ width, height, position: "relative" }}
  >
    {showMenuBar && <MacMenuBar asrTray={asrTray} />}
    {children}
  </div>
);

// ---------- Frame caption helper ----------
const FrameCaption = ({ tag, children }) => (
  <div className="frame-caption">
    {tag && <span className="tag">{tag}</span>}
    {children}
  </div>
);

// ---------- Common mode-color util ----------
const MODE_COLORS = {
  idle:    { bg: "rgba(107,214,200,0.18)", fg: "#6bd6c8", chip: "var(--ansi-cyan)",   text: "ready" },
  rec:     { bg: "rgba(230,196,102,0.22)", fg: "#e6c466", chip: "var(--ansi-yellow)", text: "recording" },
  think:   { bg: "rgba(126,194,122,0.22)", fg: "#7ec27a", chip: "var(--ansi-green)",  text: "thinking" },
  polish:  { bg: "rgba(201,138,214,0.22)", fg: "#c98ad6", chip: "var(--ansi-magenta)",text: "polish" },
};

// ---------- Reusable waveform (for HUDs) ----------
// rows = number of vertical rows; cols = width in chars
const HudWave = ({ samples, rows = 4, cols = 60, c = "green" }) => {
  const lines = [];
  const center = (rows - 1) / 2;
  for (let r = 0; r < rows; r++) {
    const cells = [];
    for (let c2 = 0; c2 < cols; c2++) {
      const a = Math.max(0, Math.min(1, samples[c2] || 0));
      const half = (a * rows) / 2;
      const dist = Math.abs(r - center);
      let ch = " ";
      if (dist <= half - 0.45) ch = "█";
      else if (dist <= half - 0.05) ch = r < center ? "▄" : "▀";
      cells.push(<Span key={c2} c={a > 0.05 ? c : "faint"}>{ch}</Span>);
    }
    lines.push(<Line key={r}>{cells}</Line>);
  }
  return <>{lines}</>;
};

// Fake "speech samples" generator
const fakeSpeech = (n, seed = 1) => {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const env = Math.sin((i / n) * Math.PI) ** 0.5;
    const wiggle = 0.5 + 0.5 * Math.sin(i * 0.6 + seed) * Math.cos(i * 0.21 + seed * 1.3);
    out[i] = Math.max(0.05, env * wiggle * 0.95);
  }
  return out;
};

// Share to window
Object.assign(window, {
  MacMenuBar, MacHUD, MacWindowChrome, CRT, MacStage,
  FrameCaption, MODE_COLORS, HudWave, fakeSpeech,
});
