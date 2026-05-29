import { useEffect, useMemo, useRef } from "react";

export type NeuralVoicePhase =
  | "offline"
  | "idle"
  | "listening"
  | "polishing"
  | "thinking"
  | "speaking"
  | "recovering";

export type NeuralSemanticSource = "user" | "assistant" | "system" | "ontology" | "audio";
export type NeuralSemanticRoute = "ontology" | "fact" | "evidence" | "memory" | "review" | "discard";
export type NeuralOperationState = "query" | "modify" | "delete";
export type NeuralSemanticKind =
  | "concept"
  | "entity"
  | "claim"
  | "procedure"
  | "preference"
  | "capability"
  | "evidence"
  | "observation";

export type NeuralSemanticSignal = {
  nonce: number;
  text: string;
  source: NeuralSemanticSource;
  strength?: number;
  route?: NeuralSemanticRoute;
  kind?: NeuralSemanticKind;
  operation?: NeuralOperationState;
};

export type NeuralVoiceApiState = {
  connected: boolean;
  recording: boolean;
  polishing: boolean;
  chatting: boolean;
  playing: boolean;
  level: number;
  peak: number;
  retrying?: boolean;
  latencyMs?: number | null;
  workspaceActive?: boolean;
  phase?: NeuralVoicePhase;
  semanticSignal?: NeuralSemanticSignal | null;
  visualIntensity?: number;
  coalescing?: boolean;
  operation?: NeuralOperationState | null;
};

type NeuralVoiceFieldProps = {
  apiState: NeuralVoiceApiState;
  className?: string;
  frameless?: boolean;
};

type Rgb = readonly [number, number, number];

type Palette = {
  primary: Rgb;
  secondary: Rgb;
  current: Rgb;
  bgTop: Rgb;
  bgBottom: Rgb;
  linkAlpha: number;
  nodeAlpha: number;
  motion: number;
  currentSpeed: number;
  coreScale: number;
};

type Particle = {
  anchorX: number;
  anchorY: number;
  angle: number;
  orbit: number;
  layer: number;
  speed: number;
  seed: number;
  size: number;
  contact: boolean;
};

type Edge = {
  a: number;
  b: number;
  strength: number;
  highway: boolean;
  lane: number;
  operation: NeuralOperationState | null;
};

type Topology = {
  particles: Particle[];
  edges: Edge[];
  adjacency: number[][];
};

type Pulse = {
  edgeIndex: number;
  t: number;
  reversed: boolean;
  speed: number;
  color: Rgb;
  semantic: boolean;
};

type Point = {
  x: number;
  y: number;
  size: number;
  alpha: number;
  energy: number;
  bodyPulse: number;
  contact: boolean;
  semantic: number;
  flash: number;
};

type CardiacRhythm = {
  phase: number;
  beat: number;
};

type SemanticActivation = {
  nonce: number;
  startedAt: number;
  hash: number;
  angle: number;
  source: NeuralSemanticSource;
  route: NeuralSemanticRoute;
  kind: NeuralSemanticKind;
  kindIndex: number;
  channels: number[];
  strength: number;
  operation: NeuralOperationState | null;
};

const PARTICLE_COUNT = 96;
const TAU = Math.PI * 2;
const SEMANTIC_KINDS: NeuralSemanticKind[] = [
  "concept",
  "entity",
  "claim",
  "procedure",
  "preference",
  "capability",
  "evidence",
  "observation",
];

const ROUTE_COLORS: Record<NeuralSemanticRoute, Rgb> = {
  ontology: [129, 140, 248],
  fact: [56, 189, 248],
  evidence: [45, 212, 191],
  memory: [244, 114, 182],
  review: [245, 158, 11],
  discard: [120, 126, 142],
};
const OPERATION_COLORS: Record<NeuralOperationState, Rgb> = {
  query: [230, 196, 102],
  modify: [201, 100, 66],
  delete: [212, 92, 92],
};
const CREAM: Rgb = [230, 224, 212];

const PALETTES: Record<NeuralVoicePhase, Palette> = {
  offline: {
    primary: [96, 98, 108],
    secondary: [58, 60, 68],
    current: [212, 92, 92],
    bgTop: [10, 11, 16],
    bgBottom: [17, 20, 27],
    linkAlpha: 0.12,
    nodeAlpha: 0.38,
    motion: 0.08,
    currentSpeed: 0.18,
    coreScale: 0.52,
  },
  idle: {
    primary: [107, 214, 200],
    secondary: [107, 159, 227],
    current: [230, 224, 212],
    bgTop: [8, 9, 15],
    bgBottom: [11, 11, 18],
    linkAlpha: 0.24,
    nodeAlpha: 0.62,
    motion: 0.22,
    currentSpeed: 0.42,
    coreScale: 0.72,
  },
  listening: {
    primary: [230, 196, 102],
    secondary: [201, 100, 66],
    current: [230, 224, 212],
    bgTop: [18, 13, 9],
    bgBottom: [9, 17, 21],
    linkAlpha: 0.38,
    nodeAlpha: 0.86,
    motion: 0.92,
    currentSpeed: 1.45,
    coreScale: 1.02,
  },
  polishing: {
    primary: [201, 138, 214],
    secondary: [180, 130, 230],
    current: [230, 224, 212],
    bgTop: [18, 9, 24],
    bgBottom: [10, 15, 26],
    linkAlpha: 0.32,
    nodeAlpha: 0.8,
    motion: 0.72,
    currentSpeed: 1.1,
    coreScale: 0.92,
  },
  thinking: {
    primary: [201, 138, 214],
    secondary: [107, 159, 227],
    current: [230, 224, 212],
    bgTop: [13, 9, 18],
    bgBottom: [8, 9, 18],
    linkAlpha: 0.42,
    nodeAlpha: 0.76,
    motion: 0.62,
    currentSpeed: 0.94,
    coreScale: 0.88,
  },
  speaking: {
    primary: [126, 194, 122],
    secondary: [107, 214, 200],
    current: [230, 224, 212],
    bgTop: [7, 14, 13],
    bgBottom: [8, 11, 16],
    linkAlpha: 0.38,
    nodeAlpha: 0.9,
    motion: 0.82,
    currentSpeed: 1.25,
    coreScale: 1.08,
  },
  recovering: {
    primary: [212, 92, 92],
    secondary: [201, 100, 66],
    current: [230, 224, 212],
    bgTop: [22, 9, 13],
    bgBottom: [18, 14, 9],
    linkAlpha: 0.3,
    nodeAlpha: 0.82,
    motion: 0.7,
    currentSpeed: 1.05,
    coreScale: 0.82,
  },
};

const PHASE_BORDER: Record<NeuralVoicePhase, string> = {
  offline: "border-rose-500/20",
  idle: "border-cyan-500/20",
  listening: "border-amber-500/45 shadow-[0_0_34px_rgba(245,158,11,0.16)]",
  polishing: "border-fuchsia-500/40 shadow-[0_0_32px_rgba(217,70,239,0.14)]",
  thinking: "border-emerald-500/35 shadow-[0_0_32px_rgba(74,222,128,0.12)]",
  speaking: "border-sky-500/40 shadow-[0_0_34px_rgba(56,189,248,0.16)]",
  recovering: "border-rose-500/40 shadow-[0_0_34px_rgba(248,113,113,0.12)]",
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function pulseCurve(phase: number, center: number, width: number): number {
  const distance = Math.abs(phase - center);
  return Math.exp(-(distance * distance) / (2 * width * width));
}

function cardiacRhythm(time: number, activity: number, coalescing: boolean): CardiacRhythm {
  const rate = mix(0.76, 1.22, activity) + (coalescing ? 0.16 : 0);
  const phase = fract(time * rate);
  const firstBeat = pulseCurve(phase, 0.08, 0.022);
  const secondBeat = pulseCurve(phase, 0.2, 0.038) * 0.58;
  return {
    phase,
    beat: clamp(firstBeat + secondBeat),
  };
}

function breathScale(time: number, phase: NeuralVoicePhase, activity: number, visual: number): number {
  const rate =
    phase === "offline" ? 0.1 :
    phase === "idle" ? 0.18 :
    phase === "listening" ? 0.28 :
    phase === "thinking" ? 0.16 :
    phase === "speaking" ? 0.24 :
    phase === "polishing" ? 0.2 :
    0.32;
  const amplitude =
    phase === "offline" ? 0.012 :
    phase === "idle" ? 0.025 :
    phase === "listening" ? 0.048 :
    phase === "thinking" ? 0.022 :
    phase === "speaking" ? 0.04 :
    0.034;
  return Math.sin(time * TAU * rate) * amplitude * (0.62 + activity * 0.44 + visual * 0.28);
}

function voiceEnvelope(state: NeuralVoiceApiState, phase: NeuralVoicePhase, time: number): number {
  const liveInput = Math.max(clamp(state.level * 8), clamp(state.peak * 2.4));
  const simulated =
    phase === "listening" ?
      0.34 + 0.58 *
      (0.5 + 0.5 * Math.sin(time * 4.2)) *
      (0.55 + 0.45 * Math.sin(time * 12.6 + 1.1)) :
    phase === "speaking" ?
      0.24 + 0.42 *
      (0.5 + 0.5 * Math.sin(time * 7.2)) *
      (0.6 + 0.4 * Math.sin(time * 18.6 + 0.7)) :
    phase === "thinking" || phase === "polishing" ?
      0.2 + 0.08 * Math.sin(time * 2.1) :
      0.045 + 0.025 * Math.sin(time * 1.1);
  return clamp(Math.max(liveInput, simulated));
}

function outwardPulse(orbit: number, rhythm: CardiacRhythm, activity: number): number {
  const front = (rhythm.phase - 0.045) / 0.72;
  if (front < 0 || front > 1.08) return 0;
  const width = 0.07 + activity * 0.035;
  const distance = Math.abs(orbit - front);
  const decay = clamp(1 - rhythm.phase * 0.72);
  return clamp(Math.exp(-(distance * distance) / (2 * width * width)) * decay * (0.32 + activity * 0.68));
}

function rgba(rgb: Rgb, alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clamp(alpha)})`;
}

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashText(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildParticles(): Particle[] {
  const rand = seeded(0x51a7c0de);
  return Array.from({ length: PARTICLE_COUNT }, (_, index) => {
    const layer = index % 4;
    const anchorRadius = Math.pow(rand(), 0.64);
    const anchorAngle = rand() * TAU;
    const outerContact = anchorRadius > 0.78 && index % 4 === 0;
    return {
      anchorX: Math.cos(anchorAngle) * anchorRadius,
      anchorY: Math.sin(anchorAngle) * anchorRadius,
      angle: (index / PARTICLE_COUNT) * TAU + rand() * 0.42,
      orbit: anchorRadius,
      layer,
      speed: mix(0.08, 0.32, rand()) * (index % 2 === 0 ? 1 : -1),
      seed: rand() * 1000,
      size: mix(1.15, 2.45, rand()) + (index % 9 === 0 ? 1.05 : 0) + (outerContact ? 0.42 : 0),
      contact: index % 9 === 0 || index % 17 === 0 || outerContact,
    };
  });
}

function edgeOperation(a: number, b: number, lane: number): NeuralOperationState | null {
  if (lane === 0 || lane === 9) return "query";
  if (lane === 5 || lane === 14) return "modify";
  if (lane === 21) return "delete";
  const roll = (a * 37 + b * 53 + lane * 11) % 100;
  if (roll < 4) return "query";
  if (roll < 7) return "modify";
  if (roll < 9) return "delete";
  return null;
}

function buildTopology(): Topology {
  const particles = buildParticles();
  const seen = new Set<string>();
  const edges: Edge[] = [];
  const adjacency: number[][] = particles.map(() => []);

  for (let i = 0; i < particles.length; i += 1) {
    const neighbors = particles
      .map((particle, index) => {
        const dx = particle.anchorX - particles[i].anchorX;
        const dy = particle.anchorY - particles[i].anchorY;
        return { index, distance: Math.sqrt(dx * dx + dy * dy) };
      })
      .filter((item) => item.index !== i && item.distance < 0.5)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, particles[i].contact ? 4 : 3);

    for (const neighbor of neighbors) {
      const a = Math.min(i, neighbor.index);
      const b = Math.max(i, neighbor.index);
      const key = `${a}-${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const edgeIndex = edges.length;
      const edge: Edge = {
        a,
        b,
        strength: clamp(1 - neighbor.distance / 0.5, 0.18, 1),
        highway: particles[a].contact || particles[b].contact || edges.length % 13 === 0,
        lane: (a * 31 + b * 17 + edges.length * 7) % 29,
        operation: null,
      };
      edge.operation = edgeOperation(a, b, edge.lane);
      edges.push(edge);
      adjacency[a].push(edgeIndex);
      adjacency[b].push(edgeIndex);
    }
  }

  return { particles, edges, adjacency };
}

function inferSemanticKind(text: string): NeuralSemanticKind {
  if (/(怎么|如何|步骤|流程|执行|操作|workflow|process)/i.test(text)) return "procedure";
  if (/(帮我|创建|生成|写|查|分析|总结|打开|运行|调用|tool|api|能力)/i.test(text)) return "capability";
  if (/(记住|以后|偏好|喜欢|习惯|不要|默认|preference)/i.test(text)) return "preference";
  if (/(证据|依据|来源|引用|为什么|因为|evidence|source|cite)/i.test(text)) return "evidence";
  if (/(同比|环比|营收|利润|现金流|财报|季度|Q[1-4]|\d+(\.\d+)?%|\d{4})/i.test(text)) return "observation";
  if (/(认为|判断|结论|风险|假设|claim|verdict)/i.test(text)) return "claim";
  if (/(公司|项目|工作区|用户|文件|模型|agent|assistant|实体|entity)/i.test(text)) return "entity";
  return "concept";
}

function inferSemanticRoute(text: string, kind: NeuralSemanticKind): NeuralSemanticRoute {
  if (/(取消|忽略|不需要|discard|drop)/i.test(text)) return "discard";
  if (/(确认|审核|review|冲突|矛盾|校准|promotion)/i.test(text)) return "review";
  if (kind === "observation" || /(\d|财报|季度|同比|环比)/i.test(text)) return "fact";
  if (kind === "evidence") return "evidence";
  if (kind === "preference" || /(记住|以后|偏好|history|memory)/i.test(text)) return "memory";
  return "ontology";
}

function inferOperation(text: string): NeuralOperationState | null {
  if (/(删除|移除|清除|清空|撤掉|discard|drop|remove|delete)/i.test(text)) return "delete";
  if (/(修改|更新|编辑|改成|写入|保存|替换|应用|patch|update|edit|modify|write|save|apply)/i.test(text)) return "modify";
  if (/(查询|搜索|查找|查一下|检索|读取|看看|分析|总结|search|query|lookup|find|fetch|read|inspect|analyze)/i.test(text)) return "query";
  return null;
}

function buildSemanticActivation(signal: NeuralSemanticSignal, startedAt: number): SemanticActivation {
  const text = signal.text.trim();
  const hash = hashText(`${signal.source}:${text}`);
  const kind = signal.kind ?? inferSemanticKind(text);
  const route = signal.route ?? inferSemanticRoute(text, kind);
  const kindIndex = SEMANTIC_KINDS.indexOf(kind);
  const safeKindIndex = kindIndex >= 0 ? kindIndex : 0;
  const sourceBias =
    signal.source === "user" ? 0 :
    signal.source === "assistant" ? Math.PI :
    signal.source === "ontology" ? Math.PI * 0.5 :
    signal.source === "system" ? Math.PI * 1.5 :
    Math.PI * 0.25;
  const angle = sourceBias + (hash % 628) / 100;
  const routeIndex = (["ontology", "fact", "evidence", "memory", "review", "discard"] as NeuralSemanticRoute[]).indexOf(route);
  const channels = Array.from(new Set([
    safeKindIndex,
    (safeKindIndex + 3) % SEMANTIC_KINDS.length,
    (routeIndex + 2 + (hash % 3)) % SEMANTIC_KINDS.length,
    hash % SEMANTIC_KINDS.length,
  ]));

  return {
    nonce: signal.nonce,
    startedAt,
    hash,
    angle,
    source: signal.source,
    route,
    kind,
    kindIndex: safeKindIndex,
    channels,
    strength: clamp(signal.strength ?? 1, 0.16, 1.25),
    operation: signal.operation ?? inferOperation(text),
  };
}

function semanticLife(activation: SemanticActivation | null, time: number): number {
  if (!activation) return 0;
  return clamp(1 - (time - activation.startedAt) / 4.2);
}

function semanticResonance(
  index: number,
  particle: Particle,
  activation: SemanticActivation | null,
  time: number,
): number {
  const life = semanticLife(activation, time);
  if (!activation || life <= 0) return 0;
  const channel = (index + particle.layer + Math.floor(particle.orbit * 8)) % SEMANTIC_KINDS.length;
  const channelHit = activation.channels.includes(channel) ? 1 : 0;
  const hashHit = (index + activation.hash) % 7 === 0 ? 0.58 : 0;
  const routeHit = particle.contact ? 0.38 : 0;
  const wave = 0.72 + Math.max(0, Math.sin((time - activation.startedAt) * 5.6 - particle.orbit * 6 + particle.seed)) * 0.28;
  return clamp((0.08 + channelHit * 0.78 + hashHit + routeHit) * life * activation.strength * wave);
}

function phaseFromApiState(state: NeuralVoiceApiState): NeuralVoicePhase {
  if (state.phase) return state.phase;
  if (state.retrying) return "recovering";
  if (!state.connected) return "offline";
  if (state.recording) return "listening";
  if (state.polishing) return "polishing";
  if (state.playing) return "speaking";
  if (state.chatting) return "thinking";
  return "idle";
}

function stateActivity(state: NeuralVoiceApiState, phase: NeuralVoicePhase): number {
  const mic = clamp(state.level * 7.5);
  const peak = clamp(state.peak * 3.5);
  const visual = clamp(state.visualIntensity ?? 0);
  const latency = state.latencyMs ? clamp(1 - state.latencyMs / 1800, 0.12, 1) : 0.38;
  const base =
    phase === "idle" ? 0.28 :
    phase === "offline" ? 0.04 :
    phase === "recovering" ? 0.72 :
    phase === "listening" ? Math.max(0.5, mic) :
    phase === "speaking" ? 0.86 :
    phase === "polishing" ? 0.7 :
    0.62 + latency * 0.28;
  return clamp(base + peak * 0.18 + visual * 0.36 + (state.coalescing ? 0.22 : 0) + (state.workspaceActive ? 0.08 : 0), 0, 1);
}

function projectParticle(
  particle: Particle,
  index: number,
  time: number,
  width: number,
  height: number,
  state: NeuralVoiceApiState,
  phase: NeuralVoicePhase,
  activity: number,
  activation: SemanticActivation | null,
  flash: number,
): Point {
  const minDim = Math.min(width, height);
  const palette = PALETTES[phase];
  const centerX = width * 0.5 + Math.sin(time * 0.17) * minDim * 0.018;
  const centerY = height * 0.52 + Math.cos(time * 0.13) * minDim * 0.014;
  const mic = clamp(state.level * 8);
  const visual = clamp(state.visualIntensity ?? 0);
  const coalescing = Boolean(state.coalescing);
  const activatedCloud = visual > 0 && visual < 0.75 && !coalescing;
  const focusedCloud = visual >= 0.75 && !coalescing;
  const rhythm = cardiacRhythm(time, activity, coalescing);
  const breath = breathScale(time, phase, activity, visual);
  const envelope = voiceEnvelope(state, phase, time);
  const pulseWave = outwardPulse(particle.orbit, rhythm, activity);
  const feedbackSpeed = 1 + visual * 1.85 + (coalescing ? 0.34 : 0);
  const breathe = Math.sin(time * (phase === "idle" ? 1.1 : 2.2) * feedbackSpeed + particle.seed) * (0.045 + visual * 0.052);
  const angle = particle.angle + time * particle.speed * palette.motion * feedbackSpeed;
  const base = minDim * (0.25 + palette.coreScale * 0.09);
  const stretchX = 1.5;
  const stretchY = 0.96;
  const visualRadiusScale = activatedCloud ? 1.08 : focusedCloud ? 0.86 : 1;
  const cardiacContraction = rhythm.beat * (0.028 + activity * 0.038 + (coalescing ? 0.035 : 0));
  const pulseExpansion = pulseWave * (0.03 + envelope * 0.035);
  const bodyScale = 1 + breath - cardiacContraction + pulseExpansion;
  let radius = base * (0.58 + particle.orbit * 1.08 + breathe) * visualRadiusScale * bodyScale;
  let x = centerX + Math.cos(angle) * radius * stretchX;
  let y = centerY + Math.sin(angle) * radius * stretchY;
  let alpha = palette.nodeAlpha * mix(0.58, 1, particle.orbit);
  const semantic = semanticResonance(index, particle, activation, time);

  if (phase === "offline") {
    radius = base * (0.26 + particle.orbit * 0.34);
    x = centerX + Math.cos(particle.angle) * radius * stretchX;
    y = centerY + Math.sin(particle.angle) * radius * 0.52;
    alpha *= 0.55;
  } else if (phase === "listening") {
    const livePush = Math.max(mic, envelope);
    radius = base * (0.54 + particle.orbit * 1.08 + livePush * 0.18) * bodyScale;
    const neuralFold = Math.sin(angle * 3 + time * 2.4 + particle.seed) * (7 + livePush * 18);
    x = centerX + Math.cos(angle) * radius * stretchX * (0.76 + livePush * 0.24) + neuralFold;
    y =
      centerY +
      Math.sin(angle * 1.08) * radius * stretchY * (0.92 + livePush * 0.42) +
      Math.sin(time * 5.8 + particle.seed) * livePush * 15;
    alpha *= 0.82 + activity * 0.28;
  } else if (phase === "polishing") {
    const spiralRadius = base * (0.22 + particle.orbit * 1.18) * bodyScale;
    const spiralAngle = particle.angle + particle.orbit * 4.9 + time * (0.58 + particle.layer * 0.08);
    x = centerX + Math.cos(spiralAngle) * spiralRadius * stretchX * 0.98;
    y = centerY + Math.sin(spiralAngle) * spiralRadius * stretchY * 0.72;
    alpha *= 0.74 + activity * 0.22;
  } else if (phase === "thinking") {
    radius = base * (0.58 + particle.orbit * 1.25) * bodyScale;
    x =
      centerX +
      Math.cos(angle + Math.sin(time * 0.35 + particle.seed) * 0.7) * radius * stretchX +
      Math.sin(time * 0.9 + particle.seed * 1.7) * minDim * 0.07;
    y =
      centerY +
      Math.sin(angle * 1.2 + particle.layer * 0.3) * radius * stretchY +
      Math.cos(time * 0.62 + particle.seed) * minDim * 0.045;
    alpha *= 0.72 + activity * 0.24;
  } else if (phase === "speaking") {
    const wave = Math.sin(time * 5.2 + particle.angle * 5.8) * (0.045 + activity * 0.12 + envelope * 0.04);
    radius = base * (0.52 + particle.orbit * 1.12 + wave);
    x = centerX + Math.cos(angle) * radius * stretchX * (1.05 + activity * 0.08 + envelope * 0.06) * bodyScale;
    y = centerY + Math.sin(angle) * radius * stretchY * (0.82 + activity * 0.22 + envelope * 0.08) * bodyScale;
    alpha *= 0.84 + activity * 0.26;
  } else if (phase === "recovering") {
    const kink = Math.sin(angle * 5 + time * 4.4 + particle.seed) * minDim * 0.035;
    radius = base * (0.42 + particle.orbit * 0.96) * bodyScale;
    x = centerX + Math.cos(angle) * radius * stretchX + kink;
    y = centerY + Math.sin(angle * 0.9) * radius * stretchY - kink * 0.36;
    alpha *= 0.74 + activity * 0.2;
  }

  const drift = palette.motion * (10 + activity * 18);
  const anchorBreath =
    phase === "listening" ? 0.92 + mic * 0.12 :
    phase === "thinking" ? 1.08 :
    phase === "speaking" ? 1 + Math.sin(time * 3.2 + particle.seed) * 0.07 + activity * 0.1 :
    phase === "offline" ? 0.42 :
    0.98 + Math.sin(time * (1.25 + visual * 0.9) + particle.seed) * (0.04 + visual * 0.025);
  const anchorX =
    centerX +
    particle.anchorX * width * 0.46 * anchorBreath * visualRadiusScale * bodyScale +
    Math.sin(time * particle.speed * feedbackSpeed + particle.seed) * drift * (1 + visual * 0.5);
  const anchorY =
    centerY +
    particle.anchorY * height * 0.44 * anchorBreath * visualRadiusScale * bodyScale +
    Math.cos(time * particle.speed * 1.17 * feedbackSpeed + particle.seed * 1.3) * drift * (1 + visual * 0.5);
  const anchorWeight =
    phase === "polishing" ? 0.5 :
    phase === "offline" ? 0.72 :
    0.8;
  x = mix(x, anchorX, anchorWeight);
  y = mix(y, anchorY, anchorWeight);

  if (visual > 0 && !coalescing) {
    const dx = x - centerX;
    const dy = y - centerY;
    const contraction = focusedCloud ? 0.74 + Math.sin(time * 1.35 + particle.seed) * 0.025 : 1;
    const expansion = activatedCloud ? 1.1 + Math.sin(time * 2.2 + particle.seed) * 0.04 : 1;
    const stateScale = contraction * expansion;
    const tangent = activatedCloud ? 1 : -0.38;
    const ripple =
      Math.sin(time * (1.9 + visual * 2.2) + particle.seed + particle.layer) *
      minDim *
      (activatedCloud ? 0.024 : 0.012) *
      visual;
    const targetX = centerX + dx * stateScale + -dy * 0.055 * tangent * visual + Math.cos(angle + Math.PI / 2) * ripple;
    const targetY = centerY + dy * stateScale + dx * 0.035 * tangent * visual + Math.sin(angle + Math.PI / 2) * ripple * 0.76;
    x = mix(x, targetX, focusedCloud ? 0.78 : 0.64);
    y = mix(y, targetY, focusedCloud ? 0.78 : 0.64);
    alpha = clamp(alpha + visual * (activatedCloud ? 0.2 : 0.14));
  }

  if (semantic > 0) {
    const routeAngle = activation?.angle ?? angle;
    const direction = activation?.source === "assistant" ? -1 : 1;
    const alignment = Math.max(0, Math.cos(angle - routeAngle));
    const stretch = minDim * semantic * (0.06 + alignment * 0.12);
    const curl = Math.sin(time * 2.2 + particle.seed) * minDim * 0.018 * semantic;
    x += Math.cos(routeAngle) * stretch * direction + Math.cos(routeAngle + Math.PI / 2) * curl;
    y += Math.sin(routeAngle) * stretch * 0.72 * direction + Math.sin(routeAngle + Math.PI / 2) * curl * 0.7;
    alpha = clamp(alpha + semantic * 0.42);
  }
  if (coalescing) {
    const sourceAngle = Math.atan2(particle.anchorY, particle.anchorX || 0.0001);
    const compactAngle = sourceAngle + Math.sin(time * 0.28 + particle.seed) * 0.035;
    const compactBreath = 1 + Math.sin(time * 1.15 + particle.seed) * 0.024 + breath * 0.8 - rhythm.beat * 0.065 + pulseWave * 0.055;
    const compactRadius = minDim * (0.045 + Math.pow(particle.orbit, 0.82) * 0.29) * compactBreath;
    const laneJitter = Math.sin(time * 0.72 + particle.seed * 1.3) * minDim * 0.01;
    const targetX = centerX + Math.cos(compactAngle) * (compactRadius * 1.1 + laneJitter);
    const targetY = centerY + Math.sin(compactAngle) * (compactRadius * 0.92 + laneJitter * 0.6);
    x = mix(x, targetX, 0.9);
    y = mix(y, targetY, 0.9);
    alpha = clamp(alpha + 0.14);
  }
  alpha = clamp(alpha + flash * 0.34);

  return {
    x,
    y,
    size: particle.size * (0.86 + activity * 0.32 + visual * 0.22 + rhythm.beat * 0.18 + pulseWave * 0.38 + (coalescing ? 0.08 : 0) + (particle.contact ? 0.22 : 0) + semantic * 0.75 + flash * 0.85),
    alpha: clamp(alpha + rhythm.beat * 0.08 + pulseWave * 0.12),
    energy: clamp(activity * 0.7 + particle.orbit * 0.3 + rhythm.beat * 0.28 + pulseWave * 0.44 + flash * 0.35),
    bodyPulse: clamp(rhythm.beat * 0.42 + pulseWave),
    contact: particle.contact,
    semantic,
    flash,
  };
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: Palette,
  activity: number,
): void {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, rgba(palette.bgTop, 0.98));
  gradient.addColorStop(1, rgba(palette.bgBottom, 0.98));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const halo = ctx.createRadialGradient(
    width * 0.5,
    height * 0.5,
    0,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.54,
  );
  halo.addColorStop(0, rgba(palette.primary, 0.06 + activity * 0.09));
  halo.addColorStop(0.48, rgba(palette.secondary, 0.035 + activity * 0.04));
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, width, height);
}

function drawAmbientHalo(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: Palette,
  activity: number,
): void {
  const halo = ctx.createRadialGradient(
    width * 0.5,
    height * 0.52,
    0,
    width * 0.5,
    height * 0.52,
    Math.max(width, height) * 0.42,
  );
  halo.addColorStop(0, rgba(palette.primary, 0.06 + activity * 0.08));
  halo.addColorStop(0.46, rgba(palette.secondary, 0.025 + activity * 0.035));
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, width, height);
}

function drawSemanticPath(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  activation: SemanticActivation | null,
): void {
  const life = semanticLife(activation, time);
  if (!activation || life <= 0) return;
  const color = ROUTE_COLORS[activation.route];
  const centerX = width * 0.5;
  const centerY = height * 0.52;
  const radius = Math.min(width, height) * (0.22 + activation.strength * 0.12);
  const direction = activation.source === "assistant" ? -1 : 1;
  const angle = activation.angle + Math.sin(time * 0.6 + activation.hash) * 0.18;
  const startX = centerX - Math.cos(angle) * radius * direction;
  const startY = centerY - Math.sin(angle) * radius * 0.72 * direction;
  const endX = centerX + Math.cos(angle) * radius * direction;
  const endY = centerY + Math.sin(angle) * radius * 0.72 * direction;
  const ctrlX = centerX + Math.cos(angle + Math.PI / 2) * radius * 0.3;
  const ctrlY = centerY + Math.sin(angle + Math.PI / 2) * radius * 0.22;
  const pulse = activation.source === "assistant"
    ? 1 - fract((time - activation.startedAt) * 1.15)
    : fract((time - activation.startedAt) * 1.15);
  const pulseX = (1 - pulse) * (1 - pulse) * startX + 2 * (1 - pulse) * pulse * ctrlX + pulse * pulse * endX;
  const pulseY = (1 - pulse) * (1 - pulse) * startY + 2 * (1 - pulse) * pulse * ctrlY + pulse * pulse * endY;

  ctx.save();
  ctx.lineWidth = 1.2 + life * activation.strength;
  ctx.strokeStyle = rgba(color, 0.16 + life * 0.28);
  ctx.shadowColor = rgba(color, 0.4 + life * 0.24);
  ctx.shadowBlur = 18 * life;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
  ctx.stroke();
  ctx.fillStyle = rgba(color, 0.55 + life * 0.32);
  ctx.beginPath();
  ctx.arc(pulseX, pulseY, 2 + life * 2.4, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawLinks(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  edges: Edge[],
  palette: Palette,
  activity: number,
  activation: SemanticActivation | null,
  time: number,
  apiOperation?: NeuralOperationState | null,
): void {
  const routeColor = activation ? ROUTE_COLORS[activation.route] : palette.current;
  const activeOperation = activation?.operation ?? apiOperation ?? null;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const edge of edges) {
    const a = points[edge.a];
    const b = points[edge.b];
    const semanticHighway = activation && (a.semantic > 0.12 || b.semantic > 0.12) && (edge.lane + activation.hash) % 3 !== 0;
    const highway = semanticHighway || (edge.highway && activity > 0.18);
    const bodyPulse = Math.max(a.bodyPulse, b.bodyPulse);
    const operationMatch = Boolean(activeOperation && edge.operation === activeOperation);
    const operationFlicker = edge.operation ? clamp((Math.sin(time * 0.86 + edge.lane * 1.91) - 0.56) / 0.44) : 0;
    const operationLife = operationMatch
      ? 0.92 + bodyPulse * 0.34
      : edge.operation
        ? 0.62 + operationFlicker * (0.28 + bodyPulse * 0.18)
        : 0;
    const operationColor = edge.operation ? OPERATION_COLORS[edge.operation] : null;
    const strokeRgb =
      operationColor && operationLife > 0.02
        ? operationColor
        : semanticHighway ? routeColor : highway ? palette.current : palette.primary;
    const alpha =
      edge.strength * palette.linkAlpha * (highway ? 1.42 : 0.84) * mix(0.78, 1.18, activity) +
      bodyPulse * 0.09 +
      operationLife * (operationMatch ? 0.46 : 0.34);

    ctx.lineWidth = (highway ? 0.85 + activity * 0.42 : 0.48) + bodyPulse * 0.22 + operationLife * 0.8;
    ctx.strokeStyle = rgba(strokeRgb, alpha + (semanticHighway ? 0.16 : 0));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    if (operationColor && operationLife > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.shadowColor = rgba(operationColor, operationMatch ? 0.9 : 0.72);
      ctx.shadowBlur = operationMatch ? 15 : 10;
      ctx.lineCap = "round";
      ctx.lineWidth = operationMatch ? 2.2 : 1.55;
      ctx.strokeStyle = rgba(operationColor, operationMatch ? 0.96 : 0.88);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

function phasePulseRate(phase: NeuralVoicePhase, activity: number): number {
  const base =
    phase === "offline" ? 0 :
    phase === "idle" ? 0.018 :
    phase === "listening" ? 0.054 :
    phase === "polishing" ? 0.064 :
    phase === "thinking" ? 0.085 :
    phase === "speaking" ? 0.058 :
    0.074;
  return base * (0.58 + activity * 1.35);
}

function phasePulseSpeed(phase: NeuralVoicePhase): number {
  return (
    phase === "idle" ? 0.012 :
    phase === "listening" ? 0.022 :
    phase === "thinking" ? 0.018 :
    phase === "speaking" ? 0.024 :
    phase === "recovering" ? 0.035 :
    0.017
  );
}

function distanceFromCenter(point: Point, width: number, height: number): number {
  return Math.hypot(point.x - width * 0.5, point.y - height * 0.52);
}

function choosePulseDirection(edge: Edge, points: Point[], width: number, height: number, phase: NeuralVoicePhase): boolean {
  const distA = distanceFromCenter(points[edge.a], width, height);
  const distB = distanceFromCenter(points[edge.b], width, height);
  if (phase === "listening") return distA > distB ? false : true;
  if (phase === "speaking") return distA < distB ? false : true;
  return edge.lane % 2 !== 0;
}

function pickPulseEdge(edges: Edge[], points: Point[], width: number, height: number, phase: NeuralVoicePhase): number {
  if (edges.length === 0 || phase === "offline") return -1;
  const maxRadius = Math.max(1, Math.min(width, height) * 0.5);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const edgeIndex = Math.floor(Math.random() * edges.length);
    const edge = edges[edgeIndex];
    const distA = distanceFromCenter(points[edge.a], width, height);
    const distB = distanceFromCenter(points[edge.b], width, height);
    const outer = Math.max(distA, distB) / maxRadius;
    const inner = 1 - Math.min(distA, distB) / maxRadius;
    const phaseBias =
      phase === "listening" ? outer :
      phase === "speaking" ? inner :
      phase === "thinking" || phase === "polishing" ? edge.strength :
      edge.highway ? 0.72 : 0.38;
    if (Math.random() < 0.22 + phaseBias * 0.7) return edgeIndex;
  }
  return Math.floor(Math.random() * edges.length);
}

function pushPulse(
  pulses: Pulse[],
  edgeIndex: number,
  reversed: boolean,
  color: Rgb,
  speed: number,
  semantic = false,
  t = 0,
): void {
  if (edgeIndex < 0 || pulses.length >= 72) return;
  pulses.push({ edgeIndex, t, reversed, speed, color, semantic });
}

function enqueueSemanticBurst(
  pulses: Pulse[],
  edges: Edge[],
  activation: SemanticActivation,
  phase: NeuralVoicePhase,
): void {
  if (edges.length === 0) return;
  const color = ROUTE_COLORS[activation.route];
  const count = Math.round(mix(6, 13, activation.strength));
  const speed = phasePulseSpeed(phase) * (1.15 + activation.strength * 0.32);
  for (let i = 0; i < count; i += 1) {
    const edgeIndex = (activation.hash + activation.kindIndex * 19 + i * 23) % edges.length;
    const edge = edges[edgeIndex];
    const reversed =
      activation.source === "assistant" ? edge.lane % 2 === 0 :
      activation.source === "system" ? edge.lane % 3 === 0 :
      edge.lane % 2 !== 0;
    pushPulse(pulses, edgeIndex, reversed, color, speed, true, i * -0.055);
  }
}

function maybeSpawnAmbientPulse(
  pulses: Pulse[],
  edges: Edge[],
  points: Point[],
  width: number,
  height: number,
  phase: NeuralVoicePhase,
  palette: Palette,
  activity: number,
  heartbeat = 0,
): void {
  const bursts = (phase === "thinking" && Math.random() < 0.22 ? 2 : 1) + (heartbeat > 0.35 ? 1 : 0);
  for (let i = 0; i < bursts; i += 1) {
    if (Math.random() >= phasePulseRate(phase, clamp(activity + heartbeat * 0.32))) continue;
    const edgeIndex = pickPulseEdge(edges, points, width, height, phase);
    if (edgeIndex < 0) continue;
    const edge = edges[edgeIndex];
    const color =
      phase === "polishing" ? palette.secondary :
      phase === "idle" && edge.lane % 3 === 0 ? palette.secondary :
      palette.current;
    pushPulse(
      pulses,
      edgeIndex,
      choosePulseDirection(edge, points, width, height, phase),
      color,
      phasePulseSpeed(phase) * (1 + heartbeat * 0.45),
    );
  }
}

function drawPulses(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  edges: Edge[],
  adjacency: number[][],
  pulses: Pulse[],
  flashes: number[],
  phase: NeuralVoicePhase,
  activity: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = pulses.length - 1; i >= 0; i -= 1) {
    const pulse = pulses[i];
    pulse.t += pulse.speed * (1 + activity * 1.18);
    if (pulse.t < 0) continue;
    const edge = edges[pulse.edgeIndex];
    if (!edge) {
      pulses.splice(i, 1);
      continue;
    }
    const start = points[pulse.reversed ? edge.b : edge.a];
    const end = points[pulse.reversed ? edge.a : edge.b];
    if (pulse.t >= 1) {
      const destinationIndex = pulse.reversed ? edge.a : edge.b;
      flashes[destinationIndex] = Math.min(1.8, (flashes[destinationIndex] ?? 0) + (pulse.semantic ? 1.22 : 0.78));
      const shouldPropagate =
        (phase === "speaking" && Math.random() < (pulse.semantic ? 0.66 : 0.42)) ||
        (pulse.semantic && Math.random() < 0.36);
      if (shouldPropagate && pulses.length < 72) {
        const nextEdges = adjacency[destinationIndex]?.filter((edgeIndex) => edgeIndex !== pulse.edgeIndex) ?? [];
        const count = pulse.semantic && phase !== "idle" ? 2 : 1;
        for (let n = 0; n < count && nextEdges.length > 0 && pulses.length < 72; n += 1) {
          const nextEdgeIndex = nextEdges[Math.floor(Math.random() * nextEdges.length)];
          const next = edges[nextEdgeIndex];
          pushPulse(
            pulses,
            nextEdgeIndex,
            next.b === destinationIndex,
            pulse.color,
            pulse.speed * 0.94,
            pulse.semantic,
            n * -0.03,
          );
        }
      }
      pulses.splice(i, 1);
      continue;
    }

    const px = mix(start.x, end.x, pulse.t);
    const py = mix(start.y, end.y, pulse.t);
    const tailT = clamp(pulse.t - (pulse.semantic ? 0.2 : 0.13), 0, 1);
    const tx = mix(start.x, end.x, tailT);
    const ty = mix(start.y, end.y, tailT);
    const gradient = ctx.createLinearGradient(tx, ty, px, py);
    gradient.addColorStop(0, rgba(pulse.color, 0));
    gradient.addColorStop(0.68, rgba(pulse.color, pulse.semantic ? 0.42 : 0.26));
    gradient.addColorStop(1, rgba(CREAM, pulse.semantic ? 0.92 : 0.78));
    ctx.lineCap = "round";
    ctx.lineWidth = pulse.semantic ? 1.85 + activity * 1.05 : 1.15 + activity * 0.72;
    ctx.strokeStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(px, py);
    ctx.stroke();

    ctx.fillStyle = rgba(pulse.color, pulse.semantic ? 0.24 : 0.16);
    ctx.beginPath();
    ctx.arc(px, py, pulse.semantic ? 7.2 + activity * 3 : 4.8 + activity * 2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = rgba(CREAM, 0.9);
    ctx.beginPath();
    ctx.arc(px, py, pulse.semantic ? 1.55 + activity * 0.75 : 1.05 + activity * 0.55, 0, TAU);
    ctx.fill();
    ctx.fillStyle = rgba(pulse.color, pulse.semantic ? 0.94 : 0.78);
    ctx.beginPath();
    ctx.arc(px, py, pulse.semantic ? 2.75 + activity * 0.95 : 2 + activity * 0.72, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawOperationLinks(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  edges: Edge[],
  activation: SemanticActivation | null,
  apiOperation?: NeuralOperationState | null,
): void {
  const activeOperation = activation?.operation ?? apiOperation ?? null;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.lineCap = "round";
  for (const edge of edges) {
    if (!edge.operation) continue;
    const a = points[edge.a];
    const b = points[edge.b];
    const color = OPERATION_COLORS[edge.operation];
    const operationMatch = activeOperation === edge.operation;
    ctx.shadowColor = rgba(color, operationMatch ? 0.86 : 0.62);
    ctx.shadowBlur = operationMatch ? 16 : 10;
    ctx.lineWidth = operationMatch ? 2.4 : 1.7;
    ctx.strokeStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
    ctx.beginPath();
    ctx.arc((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, operationMatch ? 3.1 : 2.2, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawNodes(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  time: number,
  palette: Palette,
  activity: number,
  activation: SemanticActivation | null,
): void {
  const routeColor = activation ? ROUTE_COLORS[activation.route] : palette.current;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const usePrimary = i % 3 !== 0;
    const rgb = point.semantic > 0.12 ? routeColor : usePrimary ? palette.primary : palette.secondary;
    const touch = point.contact && point.energy > 0.22;
    const blink = touch ? 0.18 + Math.max(0, Math.sin(time * 2.8 + i)) * 0.34 : 0;
    const flash = point.flash;
    const bodyPulse = point.bodyPulse;

    if (touch || point.semantic > 0.16 || flash > 0.08 || bodyPulse > 0.12) {
      ctx.shadowColor = rgba(point.semantic > 0.16 ? routeColor : rgb, 0.34 + activity * 0.18 + point.semantic * 0.18 + flash * 0.16 + bodyPulse * 0.22);
      ctx.shadowBlur = 8 + activity * 8 + point.semantic * 10 + flash * 8 + bodyPulse * 10;
    } else {
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = rgba(rgb, 0.06 + point.semantic * 0.08 + flash * 0.055 + bodyPulse * 0.06);
    ctx.beginPath();
    ctx.arc(point.x, point.y, point.size * (3.2 + point.semantic * 2.2 + flash * 1.4 + bodyPulse * 1.2), 0, TAU);
    ctx.fill();
    ctx.fillStyle = rgba(rgb, point.alpha + blink + point.semantic * 0.2 + flash * 0.28 + bodyPulse * 0.2);
    ctx.beginPath();
    ctx.arc(point.x, point.y, point.size, 0, TAU);
    ctx.fill();

    if (touch || point.semantic > 0.24 || flash > 0.16 || bodyPulse > 0.28) {
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = rgba(point.semantic > 0.24 ? routeColor : CREAM, 0.28 + activity * 0.42 + point.semantic * 0.22 + flash * 0.36 + bodyPulse * 0.38);
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.size * (2.3 + activity * 0.8 + point.semantic + flash * 0.7 + bodyPulse * 1.1), 0, TAU);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function NeuralVoiceField({ apiState, className = "", frameless = false }: NeuralVoiceFieldProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const apiStateRef = useRef(apiState);
  const semanticActivationRef = useRef<SemanticActivation | null>(null);
  const reducedMotionRef = useRef(false);
  const pulsesRef = useRef<Pulse[]>([]);
  const flashesRef = useRef<number[]>([]);
  const topology = useMemo(() => buildTopology(), []);
  const { particles, edges, adjacency } = topology;
  const operationEdgeCount = useMemo(() => edges.filter((edge) => edge.operation).length, [edges]);
  const phase = phaseFromApiState(apiState);

  useEffect(() => {
    apiStateRef.current = apiState;
    const signal = apiState.semanticSignal;
    if (signal && signal.nonce !== semanticActivationRef.current?.nonce) {
      const activation = buildSemanticActivation(signal, performance.now() / 1000);
      semanticActivationRef.current = activation;
      enqueueSemanticBurst(pulsesRef.current, edges, activation, phaseFromApiState(apiState));
    }
  }, [apiState, edges]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => {
      reducedMotionRef.current = Boolean(media?.matches);
    };
    updateMotionPreference();
    media?.addEventListener("change", updateMotionPreference);
    return () => media?.removeEventListener("change", updateMotionPreference);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext("2d", { alpha: frameless });
    if (!ctx) return;

    let frame = 0;
    let width = 0;
    let height = 0;
    let lastReducedDraw = 0;
    flashesRef.current = Array.from({ length: particles.length }, () => 0);

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const render = (nowMs: number) => {
      if (reducedMotionRef.current && nowMs - lastReducedDraw < 520) {
        frame = requestAnimationFrame(render);
        return;
      }
      lastReducedDraw = nowMs;
      const time = reducedMotionRef.current ? 0 : nowMs / 1000;
      const state = apiStateRef.current;
      const currentPhase = phaseFromApiState(state);
      const palette = PALETTES[currentPhase];
      const activity = stateActivity(state, currentPhase);
      const rhythm = cardiacRhythm(time, activity, Boolean(state.coalescing));
      const activation = semanticActivationRef.current;
      let flashes = flashesRef.current;
      if (flashes.length !== particles.length) {
        flashesRef.current = Array.from({ length: particles.length }, () => 0);
        flashes = flashesRef.current;
      }
      const points = particles.map((particle, index) =>
        projectParticle(particle, index, time, width, height, state, currentPhase, activity, activation, flashes[index] ?? 0),
      );

      if (frameless) {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = rgba(palette.bgTop, reducedMotionRef.current ? 0.72 : 0.2);
        ctx.fillRect(0, 0, width, height);
        drawAmbientHalo(ctx, width, height, palette, activity);
      } else {
        ctx.clearRect(0, 0, width, height);
        drawBackground(ctx, width, height, palette, activity);
      }
      if (!reducedMotionRef.current) {
        maybeSpawnAmbientPulse(pulsesRef.current, edges, points, width, height, currentPhase, palette, activity, rhythm.beat);
      }
      drawLinks(ctx, points, edges, palette, activity, activation, time, state.operation);
      drawPulses(ctx, points, edges, adjacency, pulsesRef.current, flashes, currentPhase, activity);
      drawSemanticPath(ctx, width, height, time, activation);
      drawNodes(ctx, points, time, palette, activity, activation);
      drawOperationLinks(ctx, points, edges, activation, state.operation);
      for (let i = 0; i < flashes.length; i += 1) {
        flashes[i] *= 0.88;
      }

      frame = requestAnimationFrame(render);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    frame = requestAnimationFrame(render);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [adjacency, edges, particles, frameless]);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label="语音助手神经网络状态动效"
      className={`relative overflow-hidden rounded-lg ${
        frameless ? "border border-transparent bg-transparent" : `border bg-(--color-bg) ${PHASE_BORDER[phase]}`
      } ${className}`}
      data-phase={phase}
      data-operation-edges={operationEdgeCount}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      {!frameless && <div className="pointer-events-none absolute inset-0 border border-white/5" />}
    </div>
  );
}
