/* eslint-disable react/prop-types */
// neural-engine.jsx — Neural-network particle field for able-asr.
//
// Architecture:
//   • Nodes:        small drifting points, sized by degree.
//                   ~10% are "hub" nodes (larger, brighter, more connections).
//   • Edges:        proximity-based connections between nearby nodes.
//                   Drawn as thin lines whose alpha falls with length.
//   • Pulses:       small bright points traveling ALONG an edge from end to end.
//                   On arrival, the destination node flashes; in `speaking` state
//                   the flash propagates into that node's outgoing edges (wave).
//
// API (props):
//   width, height        — canvas size in CSS px
//   state                — "idle" | "listening" | "thinking" | "speaking" | "error"
//   volume               — 0..1, intensifies pulses and node motion
//   density              — node count (default 60)
//   scale                — global zoom (default 1.0); voice can locally boost this
//   palette              — array of ANSI color keys (node + line + pulse colors)
//   trail                — fade-to-clear background, default true
//   showLabels           — small node-index labels (debug)
//
// Imperative API (via ref):
//   ref.current.fire(srcIdx?)   — manually fire a pulse from a node
//   ref.current.snapshot()      — { nodes, edges, pulses } for inspection
//   ref.current.setExternalVol(v) — feed real volume in (overrides simulated)

const NEURAL_ANSI = {
  cyan:    [107, 214, 200],
  yellow:  [230, 196, 102],
  green:   [126, 194, 122],
  magenta: [201, 138, 214],
  blue:    [107, 159, 227],
  orange:  [201, 100, 66],
  red:     [212, 92, 92],
  white:   [230, 224, 212],
  cream:   [202, 191, 169],
  violet:  [180, 130, 230],
};

// per-state physics + visuals
const NEURAL_STATES = {
  idle: {
    palette:    ["cyan", "blue"],
    pulseRate:  0.012,        // per-frame probability of spawning a random pulse
    pulseSpeed: 0.012,
    nodeDrift:  0.6,
    edgeAlpha:  0.22,
    flashGain:  0.7,
    breathHz:   0.0035,       // slow breathing scale
    breathAmp:  0.04,
  },
  listening: {
    palette:    ["yellow", "orange", "white"],
    pulseRate:  0.05,
    pulseSpeed: 0.022,
    nodeDrift:  1.4,
    edgeAlpha:  0.32,
    flashGain:  1.1,
    breathHz:   0.012,
    breathAmp:  0.08,
    edgeBias:   "in",         // pulses prefer outer→center
  },
  thinking: {
    palette:    ["magenta", "violet", "blue"],
    pulseRate:  0.10,         // densest activity
    pulseSpeed: 0.018,
    nodeDrift:  0.9,
    edgeAlpha:  0.40,
    flashGain:  1.0,
    breathHz:   0.0,
    breathAmp:  0,
    edgeBias:   "any",
  },
  speaking: {
    palette:    ["green", "cyan", "white"],
    pulseRate:  0.04,
    pulseSpeed: 0.024,
    nodeDrift:  1.0,
    edgeAlpha:  0.36,
    flashGain:  1.3,
    breathHz:   0.008,
    breathAmp:  0.06,
    edgeBias:   "out",        // pulses prefer center→outer
    propagate:  true,         // arrival triggers downstream wave
  },
  error: {
    palette:    ["red", "orange"],
    pulseRate:  0.08,
    pulseSpeed: 0.04,
    nodeDrift:  2.4,
    edgeAlpha:  0.22,
    flashGain:  1.5,
    breathHz:   0.04,
    breathAmp:  0.12,
    jitter:     true,
  },
};

// ───────────────────────────────────────────────────────────────
// Network generation: Poisson-disc-ish inside a CIRCLE,
//   with soft radial density falloff (denser near center).
//   + k-nearest connections.
// ───────────────────────────────────────────────────────────────
function buildNetwork(width, height, count, palette) {
  // bounding circle — sits centered, inset from edges
  const cx0 = width / 2;
  const cy0 = height / 2;
  const radius = Math.min(width, height) * 0.46;

  // average spacing — packing a disc of given radius with `count` discs
  // area ≈ π r² / count → diameter ≈ sqrt(πr²/count) * 2 * pack
  const minDist = Math.sqrt(Math.PI * radius * radius / count) * 0.82;
  const nodes = [];
  let tries = 0;
  while (nodes.length < count && tries < count * 60) {
    tries++;
    // sample inside the disc with a slight center bias
    // sqrt-uniform gives even density; ^0.7 biases toward center
    const r  = Math.pow(Math.random(), 0.7) * radius;
    const ang = Math.random() * Math.PI * 2;
    const x = cx0 + Math.cos(ang) * r;
    const y = cy0 + Math.sin(ang) * r;
    let ok = true;
    for (const n of nodes) {
      const d = Math.hypot(n.hx - x, n.hy - y);
      if (d < minDist) { ok = false; break; }
    }
    if (!ok) continue;
    nodes.push({
      hx: x, hy: y, x, y,
      seed: Math.random() * Math.PI * 2,
      driftAmp: 2 + Math.random() * 3,
      driftHz: 0.003 + Math.random() * 0.006,
      flash: 0,
      degree: 0,
      isHub: false,
      color: palette[Math.floor(Math.random() * palette.length)],
    });
  }

  // For each node, connect to k nearest. Bidirectional dedupe.
  const edges = [];
  const seen = new Set();
  const maxLen = minDist * 3.6;
  for (let i = 0; i < nodes.length; i++) {
    const ns = [];
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const d = Math.hypot(nodes[i].hx - nodes[j].hx, nodes[i].hy - nodes[j].hy);
      if (d < maxLen) ns.push({ j, d });
    }
    ns.sort((a, b) => a.d - b.d);
    const k = 2 + Math.floor(Math.random() * 3); // 2-4
    for (let m = 0; m < Math.min(k, ns.length); m++) {
      const j = ns[m].j;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a: Math.min(i, j), b: Math.max(i, j), len: ns[m].d });
      nodes[i].degree++;
      nodes[j].degree++;
    }
  }

  // Promote ~12% highest-degree nodes to hubs
  const sorted = [...nodes].sort((a, b) => b.degree - a.degree);
  const hubCount = Math.max(1, Math.floor(nodes.length * 0.12));
  for (let i = 0; i < hubCount; i++) sorted[i].isHub = true;

  // Adjacency list for propagation
  const adj = nodes.map(() => []);
  edges.forEach((e, idx) => {
    adj[e.a].push({ to: e.b, edgeIdx: idx });
    adj[e.b].push({ to: e.a, edgeIdx: idx });
  });

  // Compute center & distance-from-center for edge biasing
  let cx = 0, cy = 0;
  for (const n of nodes) { cx += n.hx; cy += n.hy; }
  cx /= nodes.length; cy /= nodes.length;
  for (const n of nodes) {
    n.distFromCenter = Math.hypot(n.hx - cx, n.hy - cy);
  }

  return { nodes, edges, adj, cx, cy };
}

// ───────────────────────────────────────────────────────────────
// The component
// ───────────────────────────────────────────────────────────────
const NeuralField = React.forwardRef(function NeuralField({
  width,
  height,
  state = "idle",
  volume,
  density = 60,
  scale = 1,
  palette,                       // optional override
  trail = true,
  className,
  style: cssStyle,
  background = "rgba(20,18,15,0.18)",
  showLabels = false,
}, ref) {
  const canvasRef = React.useRef(null);
  const stateRef = React.useRef(state);
  const scaleRef = React.useRef(scale);
  const volumeOverride = React.useRef(volume);
  const paletteOverride = React.useRef(palette);
  const apiRef = React.useRef({});

  React.useEffect(() => { stateRef.current = state; }, [state]);
  React.useEffect(() => { scaleRef.current = scale; }, [scale]);
  React.useEffect(() => { volumeOverride.current = volume; }, [volume]);
  React.useEffect(() => { paletteOverride.current = palette; }, [palette]);

  // expose imperative API
  React.useImperativeHandle(ref, () => ({
    fire(srcIdx) { apiRef.current.fire?.(srcIdx); },
    snapshot()   { return apiRef.current.snapshot?.(); },
    setExternalVol(v) { volumeOverride.current = v; },
  }));

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    // Build initial network using IDLE palette as the "base color identity"
    const basePalette = NEURAL_STATES.idle.palette;
    const net = buildNetwork(width, height, density, basePalette);
    const { nodes, edges, adj, cx, cy } = net;
    let pulses = [];
    const MAX_PULSES = 80;

    // queue of upcoming propagation arrivals (for speaking state)
    let propagationQueue = [];

    function colorOf(key, alpha = 1) {
      const c = NEURAL_ANSI[key] || NEURAL_ANSI.cyan;
      return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
    }

    function currentPalette() {
      return paletteOverride.current || NEURAL_STATES[stateRef.current]?.palette || basePalette;
    }

    // Spawn a pulse along a specific edge, given a starting node index.
    function spawnPulse({ edgeIdx, fromIdx, color, speed }) {
      if (pulses.length >= MAX_PULSES) return;
      const e = edges[edgeIdx];
      const reversed = e.a !== fromIdx;     // walking b→a
      pulses.push({
        edgeIdx, t: 0,
        reversed,
        speed: speed ?? NEURAL_STATES[stateRef.current].pulseSpeed,
        color: color || randPick(currentPalette()),
      });
    }

    function randPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    // Pick an edge weighted by state bias (in/out)
    function pickEdge() {
      const s = NEURAL_STATES[stateRef.current];
      if (!s.edgeBias || s.edgeBias === "any") {
        return Math.floor(Math.random() * edges.length);
      }
      // Bias by sum of |d-center| of endpoints
      // "in"  → prefer pulses starting from far nodes
      // "out" → prefer pulses starting from center
      for (let attempt = 0; attempt < 5; attempt++) {
        const idx = Math.floor(Math.random() * edges.length);
        const e = edges[idx];
        const dist = Math.max(nodes[e.a].distFromCenter, nodes[e.b].distFromCenter);
        const r = nodes[0].distFromCenter || 1; // not really max, fine
        const norm = Math.min(1, dist / Math.max(width, height) * 2);
        const prob = s.edgeBias === "in" ? norm : (1 - norm);
        if (Math.random() < 0.3 + prob * 0.7) return idx;
      }
      return Math.floor(Math.random() * edges.length);
    }

    // Imperative: manually fire from a node (or pick a hub)
    apiRef.current.fire = (srcIdx) => {
      if (srcIdx == null) {
        const hubs = nodes.map((n, i) => n.isHub ? i : -1).filter(i => i >= 0);
        srcIdx = hubs.length ? hubs[Math.floor(Math.random() * hubs.length)] :
                                Math.floor(Math.random() * nodes.length);
      }
      const out = adj[srcIdx];
      if (!out.length) return;
      const pick = out[Math.floor(Math.random() * out.length)];
      spawnPulse({ edgeIdx: pick.edgeIdx, fromIdx: srcIdx });
      nodes[srcIdx].flash = 1;
    };

    apiRef.current.snapshot = () => ({
      nodes: nodes.map(n => ({ x: n.x, y: n.y, isHub: n.isHub, degree: n.degree })),
      edges: edges.map(e => ({ a: e.a, b: e.b })),
      pulseCount: pulses.length,
    });

    let raf = 0, t = 0, vol = 0;

    const animate = () => {
      t += 1;
      const s = NEURAL_STATES[stateRef.current] || NEURAL_STATES.idle;
      const scaleNow = scaleRef.current;

      // ── compute volume ──
      let target;
      if (volumeOverride.current != null) {
        target = Math.max(0, Math.min(1, volumeOverride.current));
      } else if (stateRef.current === "listening") {
        target = 0.32 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.07)) *
                              (0.55 + 0.45 * Math.sin(t * 0.21 + 1.1));
      } else if (stateRef.current === "speaking") {
        target = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(t * 0.12));
      } else if (stateRef.current === "thinking") {
        target = 0.5 + 0.1 * Math.sin(t * 0.04);
      } else if (stateRef.current === "error") {
        target = 0.6 + 0.4 * Math.sin(t * 0.5);
      } else {
        target = 0.05 + 0.05 * Math.sin(t * 0.02);
      }
      vol = vol * 0.85 + target * 0.15;

      // ── breathe (global scale modulation) ──
      const breathScale = 1 + Math.sin(t * s.breathHz * 60 / 60) * s.breathAmp * (0.5 + vol);
      const totalScale = scaleNow * breathScale;

      // ── background ──
      if (trail) {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.clearRect(0, 0, width, height);
      }

      // ── update node positions (drift + state-modulated jitter) ──
      for (const n of nodes) {
        const drift = s.nodeDrift * (0.7 + vol * 0.6);
        const jx = Math.sin(t * n.driftHz + n.seed) * n.driftAmp * drift;
        const jy = Math.cos(t * n.driftHz * 1.13 + n.seed * 1.3) * n.driftAmp * drift;
        let tx = n.hx + jx;
        let ty = n.hy + jy;
        if (s.jitter) {
          tx += (Math.random() - 0.5) * 6;
          ty += (Math.random() - 0.5) * 6;
        }
        // scale around center
        tx = cx + (tx - cx) * totalScale;
        ty = cy + (ty - cy) * totalScale;
        n.x += (tx - n.x) * 0.18;
        n.y += (ty - n.y) * 0.18;
        n.flash *= 0.9;
      }

      // ── propagation queue (speaking wave) ──
      if (propagationQueue.length) {
        const due = [];
        propagationQueue = propagationQueue.filter(item => {
          if (item.fireAt <= t) {
            due.push(item);
            return false;
          }
          return true;
        });
        for (const item of due) {
          const out = adj[item.nodeIdx];
          for (const e of out) {
            // small chance to skip, to avoid exponential blowup
            if (Math.random() < 0.55) {
              spawnPulse({ edgeIdx: e.edgeIdx, fromIdx: item.nodeIdx });
            }
          }
        }
      }

      // ── draw edges ──
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 0.7;
      for (const e of edges) {
        const a = nodes[e.a], b = nodes[e.b];
        const len = Math.hypot(a.x - b.x, a.y - b.y);
        const aFade = Math.max(0.05, s.edgeAlpha * (1 - len / 220) *
                                     (0.55 + vol * 0.5 + Math.max(a.flash, b.flash) * 0.5));
        const colorKey = a.color;
        ctx.strokeStyle = colorOf(colorKey, aFade);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      // ── draw + update pulses ──
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += p.speed * (1 + vol * 1.2);
        const e = edges[p.edgeIdx];
        if (!e) { pulses.splice(i, 1); continue; }
        const A = nodes[p.reversed ? e.b : e.a];
        const B = nodes[p.reversed ? e.a : e.b];
        if (p.t >= 1) {
          const destIdx = p.reversed ? e.a : e.b;
          nodes[destIdx].flash = Math.min(1.4, nodes[destIdx].flash + s.flashGain);
          if (s.propagate && Math.random() < 0.55) {
            propagationQueue.push({ nodeIdx: destIdx, fireAt: t + 4 + Math.random() * 6 });
          }
          pulses.splice(i, 1);
          continue;
        }
        const px = A.x + (B.x - A.x) * p.t;
        const py = A.y + (B.y - A.y) * p.t;

        // tail
        const tailLen = 6;
        for (let k = tailLen; k > 0; k--) {
          const tk = Math.max(0, p.t - k * 0.025);
          const tx = A.x + (B.x - A.x) * tk;
          const ty = A.y + (B.y - A.y) * tk;
          const a = (1 - k / tailLen) * 0.55;
          ctx.fillStyle = colorOf(p.color, a);
          ctx.beginPath();
          ctx.arc(tx, ty, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
        // head glow
        ctx.fillStyle = colorOf(p.color, 0.22);
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fill();
        // head core
        ctx.fillStyle = colorOf("white", 0.95);
        ctx.beginPath();
        ctx.arc(px, py, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = colorOf(p.color, 1);
        ctx.beginPath();
        ctx.arc(px, py, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── draw nodes ──
      for (const n of nodes) {
        const baseSize = n.isHub ? 3.3 : 1.6;
        const sz = baseSize + n.flash * 2.6;
        const a  = 0.55 + Math.min(0.4, n.flash * 0.4) + vol * 0.15;
        // outer glow
        const g = n.isHub ? 14 : 7;
        ctx.fillStyle = colorOf(n.color, a * 0.16);
        ctx.beginPath(); ctx.arc(n.x, n.y, g + n.flash * 6, 0, Math.PI * 2); ctx.fill();
        // core
        ctx.fillStyle = colorOf(n.color, Math.min(1, a));
        ctx.beginPath(); ctx.arc(n.x, n.y, sz, 0, Math.PI * 2); ctx.fill();
        // hub ring
        if (n.isHub) {
          ctx.strokeStyle = colorOf("white", 0.28 + n.flash * 0.4);
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.arc(n.x, n.y, sz + 3, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // ── spawn pulses based on state pulseRate + volume ──
      const rate = s.pulseRate * (1 + vol * 1.6);
      if (Math.random() < rate) {
        const edgeIdx = pickEdge();
        const e = edges[edgeIdx];
        // pick start based on bias
        let fromIdx;
        if (s.edgeBias === "in") {
          fromIdx = nodes[e.a].distFromCenter > nodes[e.b].distFromCenter ? e.a : e.b;
        } else if (s.edgeBias === "out") {
          fromIdx = nodes[e.a].distFromCenter < nodes[e.b].distFromCenter ? e.a : e.b;
        } else {
          fromIdx = Math.random() < 0.5 ? e.a : e.b;
        }
        spawnPulse({ edgeIdx, fromIdx, color: randPick(currentPalette()) });
      }

      // optional debug labels
      if (showLabels) {
        ctx.globalCompositeOperation = "source-over";
        ctx.font = "9px JetBrains Mono, monospace";
        ctx.fillStyle = "rgba(230,224,212,0.5)";
        for (let i = 0; i < nodes.length; i++) {
          ctx.fillText(String(i), nodes[i].x + 4, nodes[i].y - 4);
        }
      }

      raf = requestAnimationFrame(animate);
    };

    animate();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line
  }, [width, height, density, trail, showLabels]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width, height, display: "block", ...cssStyle }}
    />
  );
});

Object.assign(window, { NeuralField, NEURAL_STATES, NEURAL_ANSI });
