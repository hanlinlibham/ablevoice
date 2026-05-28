/* eslint-disable react/prop-types */
// particle-engine.jsx — canvas-based particle field for able-asr voice UI.
// Each <ParticleField> renders its own animation loop.
// Props:
//   width, height
//   mode: "idle" | "listening" | "thinking" | "speaking"
//   style: "dust" | "constellation" | "fluid" | "ember" | "mesh" | "ring"
//   palette: array of named colors from ANSI palette
//   density: number of particles (defaults vary by style)
//   center: { x, y } — anchor point in canvas coords
//   showLinks: connect close particles with faint lines (auto on for constellation)
//   voiceFn: optional (t) => 0..1 — override simulated voice level
//   onFrame: optional callback per frame (used by hero for sync)

const ANSI = {
  cyan:    [107, 214, 200],
  yellow:  [230, 196, 102],
  green:   [126, 194, 122],
  magenta: [201, 138, 214],
  blue:    [107, 159, 227],
  orange:  [201, 100, 66],
  red:     [212, 92, 92],
  white:   [230, 224, 212],
  cream:   [202, 191, 169],
};

const STYLE_DEFAULTS = {
  dust:         { density: 220, showLinks: false, baseSize: 1.3, glow: 2.6 },
  constellation:{ density: 70,  showLinks: true,  baseSize: 1.6, glow: 3.0 },
  fluid:        { density: 380, showLinks: false, baseSize: 1.1, glow: 2.0 },
  ember:        { density: 180, showLinks: false, baseSize: 1.0, glow: 3.5 },
  mesh:         { density: 200, showLinks: false, baseSize: 1.4, glow: 2.0, gridded: true },
  ring:         { density: 240, showLinks: false, baseSize: 1.2, glow: 2.4, ringMode: true },
};

function ParticleField({
  width, height,
  mode = "idle",
  style = "dust",
  palette = ["cyan"],
  density,
  center,
  showLinks,
  glow = true,
  voiceFn,
  trail = false,
  className,
}) {
  const canvasRef = React.useRef(null);
  const modeRef = React.useRef(mode);
  React.useEffect(() => { modeRef.current = mode; }, [mode]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const cfg = STYLE_DEFAULTS[style] || STYLE_DEFAULTS.dust;
    const N = density ?? cfg.density;
    const linksOn = showLinks ?? cfg.showLinks;
    const cx = center?.x ?? width / 2;
    const cy = center?.y ?? height / 2;

    // ----- init particles based on style -----
    const parts = [];
    for (let i = 0; i < N; i++) {
      let x, y, homeR, homeAng;
      if (style === "mesh") {
        // grid layout
        const cols = Math.ceil(Math.sqrt(N * (width / height)));
        const rows = Math.ceil(N / cols);
        const cellW = width / (cols + 1);
        const cellH = height / (rows + 1);
        const ci = i % cols, ri = Math.floor(i / cols);
        x = (ci + 1) * cellW;
        y = (ri + 1) * cellH;
        homeR = 0;
        homeAng = 0;
      } else if (style === "ember") {
        x = cx + (Math.random() - 0.5) * width * 0.4;
        y = cy + Math.random() * 60;
        homeR = Math.random() * 30;
        homeAng = Math.random() * Math.PI * 2;
      } else if (style === "ring") {
        homeAng = (i / N) * Math.PI * 2 + Math.random() * 0.05;
        homeR = 60 + Math.random() * 8;
        x = cx + Math.cos(homeAng) * homeR;
        y = cy + Math.sin(homeAng) * homeR;
      } else {
        homeAng = Math.random() * Math.PI * 2;
        // wider home radius so the cluster fills the HUD, not just a dot
        const maxR = style === "fluid" ? 70 :
                     style === "constellation" ? Math.min(width, height) * 0.42 :
                     Math.min(width, height) * 0.38;
        homeR = Math.pow(Math.random(), 0.7) * maxR;
        x = cx + Math.cos(homeAng) * homeR;
        y = cy + Math.sin(homeAng) * homeR;
      }
      parts.push({
        x, y, hx: x, hy: y,
        homeR, homeAng,
        seed: Math.random() * Math.PI * 2,
        speed: 0.7 + Math.random() * 0.6,
        size: cfg.baseSize * (0.55 + Math.random() * 1.1),
        col: palette[Math.floor(Math.random() * palette.length)],
        alpha: 0.45 + Math.random() * 0.5,
        life: Math.random(),
      });
    }

    let raf = 0, t = 0, vol = 0;

    const animate = () => {
      t += 1;
      const m = modeRef.current;

      // background fade for trail effect, else clear
      if (trail) {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "rgba(20,18,15,0.16)";
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.clearRect(0, 0, width, height);
      }

      // simulated voice level by mode
      let target = 0;
      if (voiceFn) {
        target = voiceFn(t);
      } else if (m === "listening") {
        target = 0.35 + 0.6 *
          (0.5 + 0.5 * Math.sin(t * 0.07)) *
          (0.55 + 0.45 * Math.sin(t * 0.21 + 1.1));
      } else if (m === "speaking") {
        target = 0.25 + 0.4 *
          (0.5 + 0.5 * Math.sin(t * 0.12)) *
          (0.6 + 0.4 * Math.sin(t * 0.31 + 0.7));
      } else if (m === "thinking") {
        target = 0.18 + 0.08 * Math.sin(t * 0.04);
      } else {
        target = 0.05 + 0.03 * Math.sin(t * 0.02);
      }
      vol = vol * 0.86 + target * 0.14;

      // update + draw
      for (const p of parts) {
        // STYLE DRIVES SHAPE / MOTION HABIT
        if (style === "mesh") {
          // ripple grid: wave from center scaled by voice
          const dx = p.hx - cx, dy = p.hy - cy;
          const dist = Math.sqrt(dx*dx + dy*dy);
          const phase = t * 0.08 - dist * 0.04;
          const wave = Math.sin(phase) * (4 + vol * 28);
          const ang = Math.atan2(dy, dx);
          p.x = p.hx + Math.cos(ang) * wave * 0.3;
          p.y = p.hy + Math.sin(ang) * wave * 0.3 + wave * 0.6 * (m === "speaking" ? 1 : 0.4);
        } else if (style === "ember") {
          // upward drift, reset at top
          p.y -= p.speed * (0.6 + vol * 2.2);
          p.x += Math.sin(t * 0.04 + p.seed) * 0.4 * (0.4 + vol);
          if (p.y < -8 || Math.random() < 0.003) {
            p.y = cy + 40 + Math.random() * 20;
            p.x = cx + (Math.random() - 0.5) * width * 0.35;
            p.life = 0;
          }
          p.life = Math.min(1, p.life + 0.008);
        } else if (style === "ring") {
          // breathing ring; voice expands radius + wobble
          const ang = p.homeAng + t * 0.003 * (m === "thinking" ? 2.5 : 1);
          const r = p.homeR + vol * 36 + Math.sin(t * 0.05 + p.seed) * 3;
          p.x = cx + Math.cos(ang) * r;
          p.y = cy + Math.sin(ang) * r;
        } else if (m === "idle") {
          const ang = p.homeAng + Math.sin(t * 0.006 + p.seed) * 0.18;
          const r = p.homeR + Math.sin(t * 0.013 + p.seed) * 4 + vol * 8;
          const tx = cx + Math.cos(ang) * r;
          const ty = cy + Math.sin(ang) * r;
          p.x += (tx - p.x) * 0.05;
          p.y += (ty - p.y) * 0.05;
        } else if (m === "listening") {
          // expand from home outward proportional to voice
          const ang = p.homeAng +
                      Math.sin(t * 0.02 + p.seed) * 0.06 +
                      Math.sin(t * 0.005) * 0.02;
          const targetR = p.homeR * (1 + vol * 1.4) +
                          Math.sin(t * 0.08 + p.seed * 2) * 10 * vol;
          const tx = cx + Math.cos(ang) * targetR;
          const ty = cy + Math.sin(ang) * targetR;
          p.x += (tx - p.x) * 0.12;
          p.y += (ty - p.y) * 0.12;
        } else if (m === "thinking") {
          // slow orbital — particles maintain their home radius but rotate
          const ang = p.homeAng + t * 0.012 * (0.4 + p.speed * 0.5);
          const r = p.homeR + Math.sin(t * 0.02 + p.seed * 2) * 6;
          p.homeAng = ang; // accumulate rotation
          const tx = cx + Math.cos(ang) * r;
          const ty = cy + Math.sin(ang) * r;
          p.x += (tx - p.x) * 0.18;
          p.y += (ty - p.y) * 0.18;
        } else if (m === "speaking") {
          // recycle radial bursts — long throw
          p.life += 0.009 * p.speed;
          if (p.life > 1) {
            p.life = 0;
            p.homeAng = Math.random() * Math.PI * 2;
          }
          const ang = p.homeAng + Math.sin(t * 0.01 + p.seed) * 0.35;
          const reach = Math.min(width, height) * 0.45;
          const r = 8 + p.life * (reach + vol * 30);
          p.x = cx + Math.cos(ang) * r;
          p.y = cy + Math.sin(ang) * r;
          p.alpha = (1 - p.life * 0.85) * 0.95;
        }

        // ---- draw ----
        const c = ANSI[p.col] || ANSI.cyan;
        const a = Math.min(1, p.alpha * (0.55 + vol * 0.6));
        if (glow) {
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a * 0.22})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * cfg.glow, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // links (constellation)
      if (linksOn) {
        ctx.globalCompositeOperation = "lighter";
        const TH = 90;
        for (let i = 0; i < parts.length; i++) {
          for (let j = i + 1; j < parts.length; j++) {
            const dx = parts[i].x - parts[j].x;
            const dy = parts[i].y - parts[j].y;
            const d2 = dx*dx + dy*dy;
            if (d2 < TH * TH) {
              const c = ANSI[parts[i].col] || ANSI.cyan;
              const a = (1 - Math.sqrt(d2)/TH) * 0.22 * (0.5 + vol * 0.5);
              ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
              ctx.lineWidth = 0.6;
              ctx.beginPath();
              ctx.moveTo(parts[i].x, parts[i].y);
              ctx.lineTo(parts[j].x, parts[j].y);
              ctx.stroke();
            }
          }
        }
      }

      raf = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line
  }, [width, height, density, style, palette.join(","), showLinks, trail]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width, height, display: "block" }}
    />
  );
}

// ─────────────────────────────────────────────────────────
// Lifecycle cycler hook — drives a state machine through phases.
// Returns: { phase, label, subtitle, t (0..1 within phase) }
// ─────────────────────────────────────────────────────────
function useVoiceLifecycle(timeline, opts = {}) {
  const [idx, setIdx] = React.useState(0);
  const [tInPhase, setTInPhase] = React.useState(0);
  React.useEffect(() => {
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const elapsed = (now - start) / 1000;
      let acc = 0;
      let found = 0;
      let inside = 0;
      const total = timeline.reduce((s, p) => s + p.dur, 0);
      const loopT = elapsed % total;
      for (let i = 0; i < timeline.length; i++) {
        if (loopT < acc + timeline[i].dur) {
          found = i;
          inside = (loopT - acc) / timeline[i].dur;
          break;
        }
        acc += timeline[i].dur;
      }
      setIdx(found);
      setTInPhase(inside);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return { phase: timeline[idx], idx, t: tInPhase };
}

Object.assign(window, { ParticleField, ANSI, useVoiceLifecycle });
