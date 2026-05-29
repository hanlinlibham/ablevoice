import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { NeuralOperationState, NeuralVoiceApiState, NeuralVoicePhase } from "./NeuralVoiceField";

/* ---------------------------------------------------------------------------
 * NeuralNebula — 单色三维粒子星云。
 *
 * 设计语言:本体图谱的物理具象化。纯黑底 + 纯白粒子,完全不靠颜色,
 * 只靠「运动速度 / 聚合密度 / 连线闪烁频次」表达 AI 工作负载与思考深度
 * (信息剔除 · Signal over Praise)。四个核心状态:
 *
 *   idle      散是满天星   — 松散点云,缓慢游弋,偶发单丝连线代谢
 *   listening 引力坍缩     — 强引力场,粒子急剧向心收敛(收缩感)
 *   thinking  聚是一团火   — 高密度核心 + 高频震颤 + 电弧闪烁(逻辑穿透)
 *   speaking  声纹共振     — 火团随语音波形膨胀收缩 + 外围火星抛射
 *
 * 渲染:three.js Points(自定义 shader)+ LineSegments(电弧)+
 * EffectComposer/UnrealBloomPass 后期泛光。物理是 CPU 上的轻量力模型
 * (径向弹簧 + home 弹簧按 collapse 混合 + 旋涡 + 抖动 + 高频震颤),
 * 不做真 N-body 斥力,但足以呈现「力导向图」的聚散质感。
 * ------------------------------------------------------------------------- */

type NeuralNebulaProps = {
  apiState: NeuralVoiceApiState;
  className?: string;
  frameless?: boolean;
};

const PARTICLE_COUNT = 2200;
const MAX_ARCS = 260;
const MAX_OPERATION_ARCS = 72;
const FIELD_RADIUS = 7;
const FOV = 55;
const TAU = Math.PI * 2;

const OPERATION_COLORS: Record<NeuralOperationState, readonly [number, number, number]> = {
  query: [230 / 255, 196 / 255, 102 / 255],
  modify: [201 / 255, 100 / 255, 66 / 255],
  delete: [212 / 255, 92 / 255, 92 / 255],
};

type Profile = {
  collapse: number; // 0 = 停在 home(满天星), 1 = 收成实心球(火团)
  coreRadius: number; // 球半径占 FIELD_RADIUS 的比例
  ballStiff: number; // 朝径向目标的弹簧刚度
  homeStiff: number; // 朝 home 位置的弹簧刚度
  swirl: number; // 切向旋涡加速度
  jitter: number; // 无序噪声加速度
  tremor: number; // 相干高频震颤(thinking)
  damping: number; // 每步速度保留
  baseEnergy: number; // 亮度基线
  coreGlow: number; // 越靠核心越亮的增益
  arcRate: number; // 每帧电弧生成数(再乘 activity)
  arcLife: number; // 电弧基础寿命(s)
  arcIntensity: number; // 电弧亮度
  spin: number; // 整体自转速度
  eject: number; // 外围火星抛射概率(speaking)
};

const PROFILES: Record<NeuralVoicePhase, Profile> = {
  offline: {
    collapse: 0.0, coreRadius: 1.15, ballStiff: 3, homeStiff: 1.2, swirl: 0.015,
    jitter: 0.018, tremor: 0, damping: 0.9, baseEnergy: 0.035, coreGlow: 0.08,
    arcRate: 0.012, arcLife: 0.5, arcIntensity: 0.2, spin: 0.012, eject: 0,
  },
  idle: {
    collapse: 0.05, coreRadius: 1.0, ballStiff: 4, homeStiff: 2.2, swirl: 0.04,
    jitter: 0.05, tremor: 0, damping: 0.9, baseEnergy: 0.06, coreGlow: 0.12,
    arcRate: 0.05, arcLife: 0.45, arcIntensity: 0.36, spin: 0.028, eject: 0,
  },
  listening: {
    collapse: 0.9, coreRadius: 0.62, ballStiff: 9, homeStiff: 0.6, swirl: 0.12,
    jitter: 0.06, tremor: 0.03, damping: 0.85, baseEnergy: 0.26, coreGlow: 0.42,
    arcRate: 0.12, arcLife: 0.3, arcIntensity: 0.55, spin: 0.05, eject: 0,
  },
  polishing: {
    collapse: 0.65, coreRadius: 0.62, ballStiff: 7, homeStiff: 1.0, swirl: 0.5,
    jitter: 0.08, tremor: 0.05, damping: 0.86, baseEnergy: 0.28, coreGlow: 0.55,
    arcRate: 0.35, arcLife: 0.35, arcIntensity: 0.55, spin: 0.12, eject: 0,
  },
  thinking: {
    collapse: 0.95, coreRadius: 0.52, ballStiff: 11, homeStiff: 0.4, swirl: 0.18,
    jitter: 0.09, tremor: 0.16, damping: 0.82, baseEnergy: 0.27, coreGlow: 0.48,
    arcRate: 0.9, arcLife: 0.4, arcIntensity: 0.95, spin: 0.1, eject: 0,
  },
  speaking: {
    collapse: 0.72, coreRadius: 0.6, ballStiff: 8, homeStiff: 0.7, swirl: 0.12,
    jitter: 0.07, tremor: 0.05, damping: 0.85, baseEnergy: 0.27, coreGlow: 0.48,
    arcRate: 0.3, arcLife: 0.35, arcIntensity: 0.72, spin: 0.08, eject: 0.12,
  },
  recovering: {
    collapse: 0.5, coreRadius: 0.65, ballStiff: 6, homeStiff: 1.0, swirl: 0.22,
    jitter: 0.14, tremor: 0.1, damping: 0.84, baseEnergy: 0.28, coreGlow: 0.5,
    arcRate: 0.2, arcLife: 0.3, arcIntensity: 0.5, spin: 0.1, eject: 0,
  },
};

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.min(hi, Math.max(lo, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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
  const vis = clamp(state.visualIntensity ?? 0);
  const base =
    phase === "offline" ? 0.04 :
    phase === "idle" ? 0.28 :
    phase === "listening" ? Math.max(0.5, mic) :
    phase === "speaking" ? 0.85 :
    phase === "polishing" ? 0.7 :
    phase === "recovering" ? 0.72 :
    0.72;
  return clamp(base + peak * 0.18 + vis * 0.4 + (state.coalescing ? 0.2 : 0));
}

function voiceEnvelope(state: NeuralVoiceApiState, phase: NeuralVoicePhase, time: number): number {
  const live = Math.max(clamp(state.level * 8), clamp(state.peak * 2.4));
  const sim =
    phase === "listening" ?
      0.34 + 0.58 * (0.5 + 0.5 * Math.sin(time * 4.2)) * (0.55 + 0.45 * Math.sin(time * 12.6 + 1.1)) :
    phase === "speaking" ?
      0.24 + 0.42 * (0.5 + 0.5 * Math.sin(time * 7.2)) * (0.6 + 0.4 * Math.sin(time * 18.6 + 0.7)) :
      0.05 + 0.025 * Math.sin(time * 1.1);
  return clamp(Math.max(live, sim));
}

const POINT_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aEnergy;
  varying float vEnergy;
  uniform float uScale;
  void main() {
    vEnergy = aEnergy;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

// 粒子本体保持锐利实边(near-crisp disc),发光交给 Bloom。
const POINT_FRAG = /* glsl */ `
  precision mediump float;
  varying float vEnergy;
  uniform vec3 uColor;
  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.24, d);
    float halo = smoothstep(0.5, 0.0, d) * 0.13;
    float a = clamp(core + halo, 0.0, 1.0);
    // 单粒子偏暗,密集叠加才发亮 → 火团有「中心炽热、边缘可辨」的密度梯度
    float bright = 0.09 + vEnergy * 0.92;
    gl_FragColor = vec4(uColor * bright, a);
  }
`;

const ARC_VERT = /* glsl */ `
  attribute float aBright;
  varying float vBright;
  void main() {
    vBright = aBright;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ARC_FRAG = /* glsl */ `
  precision mediump float;
  varying float vBright;
  uniform vec3 uColor;
  void main() {
    // 电弧要明显亮过粒子,1px 细线靠 Bloom 晕成发光弧 → 神经放电感
    gl_FragColor = vec4(uColor * (0.4 + vBright * 2.6), clamp(vBright * 1.15, 0.0, 1.0));
  }
`;

const OPERATION_ARC_VERT = /* glsl */ `
  attribute float aBright;
  attribute vec3 aColor;
  varying float vBright;
  varying vec3 vColor;
  void main() {
    vBright = aBright;
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const OPERATION_ARC_FRAG = /* glsl */ `
  precision mediump float;
  varying float vBright;
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor * (0.75 + vBright * 2.2), clamp(0.55 + vBright * 0.65, 0.0, 1.0));
  }
`;

type Arc = { a: number; b: number; age: number; life: number; intensity: number };
type OperationArc = Arc & { operation: NeuralOperationState };

function inferOperation(text: string): NeuralOperationState | null {
  if (/(删除|移除|清除|清空|撤掉|discard|drop|remove|delete)/i.test(text)) return "delete";
  if (/(修改|更新|编辑|改成|写入|保存|替换|应用|patch|update|edit|modify|write|save|apply)/i.test(text)) return "modify";
  if (/(查询|搜索|查找|查一下|检索|读取|看看|分析|总结|search|query|lookup|find|fetch|read|inspect|analyze)/i.test(text)) return "query";
  return null;
}

function pickOperation(): NeuralOperationState {
  const r = Math.random();
  if (r < 0.52) return "query";
  if (r < 0.84) return "modify";
  return "delete";
}

export function NeuralNebula({ apiState, className = "", frameless = false }: NeuralNebulaProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiStateRef = useRef(apiState);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    apiStateRef.current = apiState;
  }, [apiState]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () => { reducedMotionRef.current = Boolean(media?.matches); };
    update();
    media?.addEventListener("change", update);
    return () => media?.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      return; // 无 WebGL — 安静降级为透明容器
    }
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.NoToneMapping;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.inset = "0";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    camera.position.set(0, 0, 17);

    const group = new THREE.Group();
    scene.add(group);

    // ── 粒子 home 布局(确定性):清空内核、按体积向外铺开 ──────────────
    // 休眠时是「散是满天星」——分散的卫星点云,中心不堆积(否则一上来就像火团)。
    const rand = seeded(0x51a7c0de);
    const home = new Float32Array(PARTICLE_COUNT * 3);
    const homeFrac = new Float32Array(PARTICLE_COUNT);
    const seedArr = new Float32Array(PARTICLE_COUNT);
    const sizeArr = new Float32Array(PARTICLE_COUNT);
    const energyBoost = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const r = FIELD_RADIUS * (0.32 + 0.68 * Math.cbrt(rand()));
      const theta = rand() * TAU;
      const phi = Math.acos(2 * rand() - 1);
      home[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      home[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.82;
      home[i * 3 + 2] = r * Math.cos(phi);
      homeFrac[i] = r / FIELD_RADIUS;
      seedArr[i] = rand() * 1000;
      const hub = rand() < 0.12;
      sizeArr[i] = 0.055 + rand() * 0.1 + (hub ? 0.11 : 0);
      energyBoost[i] = hub ? 0.18 : 0;
    }

    // ── 仿真状态 ─────────────────────────────────────────────────────────
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const vel = new Float32Array(PARTICLE_COUNT * 3);
    const energyBase = new Float32Array(PARTICLE_COUNT);
    const flash = new Float32Array(PARTICLE_COUNT);
    pos.set(home);

    const geom = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(pos, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const energyData = new Float32Array(PARTICLE_COUNT);
    const energyAttr = new THREE.BufferAttribute(energyData, 1);
    energyAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute("position", posAttr);
    geom.setAttribute("aSize", new THREE.BufferAttribute(sizeArr, 1));
    geom.setAttribute("aEnergy", energyAttr);

    const pointMat = new THREE.ShaderMaterial({
      uniforms: {
        uScale: { value: 600 },
        uColor: { value: new THREE.Color(1, 1, 1) },
      },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geom, pointMat);
    points.frustumCulled = false;
    group.add(points);

    // ── 电弧 LineSegments ────────────────────────────────────────────────
    const arcPos = new Float32Array(MAX_ARCS * 2 * 3);
    const arcBright = new Float32Array(MAX_ARCS * 2);
    const arcGeom = new THREE.BufferGeometry();
    const arcPosAttr = new THREE.BufferAttribute(arcPos, 3);
    arcPosAttr.setUsage(THREE.DynamicDrawUsage);
    const arcBrightAttr = new THREE.BufferAttribute(arcBright, 1);
    arcBrightAttr.setUsage(THREE.DynamicDrawUsage);
    arcGeom.setAttribute("position", arcPosAttr);
    arcGeom.setAttribute("aBright", arcBrightAttr);
    arcGeom.setDrawRange(0, 0);
    const arcMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: ARC_VERT,
      fragmentShader: ARC_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const arcLines = new THREE.LineSegments(arcGeom, arcMat);
    arcLines.frustumCulled = false;
    group.add(arcLines);

    const arcs: Arc[] = [];

    // ── 动作语义电弧:少量彩色连线,黄色/橙色/红色 = 查询/修改/删除 ───────
    const opArcPos = new Float32Array(MAX_OPERATION_ARCS * 2 * 3);
    const opArcBright = new Float32Array(MAX_OPERATION_ARCS * 2);
    const opArcColor = new Float32Array(MAX_OPERATION_ARCS * 2 * 3);
    const opArcGeom = new THREE.BufferGeometry();
    const opArcPosAttr = new THREE.BufferAttribute(opArcPos, 3);
    opArcPosAttr.setUsage(THREE.DynamicDrawUsage);
    const opArcBrightAttr = new THREE.BufferAttribute(opArcBright, 1);
    opArcBrightAttr.setUsage(THREE.DynamicDrawUsage);
    const opArcColorAttr = new THREE.BufferAttribute(opArcColor, 3);
    opArcColorAttr.setUsage(THREE.DynamicDrawUsage);
    opArcGeom.setAttribute("position", opArcPosAttr);
    opArcGeom.setAttribute("aBright", opArcBrightAttr);
    opArcGeom.setAttribute("aColor", opArcColorAttr);
    opArcGeom.setDrawRange(0, 0);
    const opArcMat = new THREE.ShaderMaterial({
      vertexShader: OPERATION_ARC_VERT,
      fragmentShader: OPERATION_ARC_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const opArcLines = new THREE.LineSegments(opArcGeom, opArcMat);
    opArcLines.frustumCulled = false;
    group.add(opArcLines);

    const operationArcs: OperationArc[] = [];

    // ── 后期:Bloom 泛光 ─────────────────────────────────────────────────
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.8, 0.62);
    composer.addPass(bloom);
    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    let width = 1;
    let height = 1;
    const resize = () => {
      const rect = host.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      renderer.setPixelRatio(dpr);
      composer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      bloom.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const fovRad = (FOV * Math.PI) / 180;
      pointMat.uniforms.uScale.value = height / (2 * Math.tan(fovRad / 2));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    // 平滑的当前 profile(朝目标插值,让相位切换是「冲进去」而非瞬切)
    const cur: Profile = { ...PROFILES.offline };
    const center = new THREE.Vector3();
    let raf = 0;
    let last = performance.now();
    let groupRot = 0;

    const spawnArc = (a: number, b: number, intensity: number, life: number) => {
      if (arcs.length >= MAX_ARCS || a === b) return;
      arcs.push({ a, b, age: 0, life, intensity });
      flash[a] = Math.min(1.6, flash[a] + 0.35);
      flash[b] = Math.min(1.6, flash[b] + 0.35);
    };

    const spawnOperationArc = (
      a: number,
      b: number,
      operation: NeuralOperationState,
      intensity: number,
      life: number,
    ) => {
      if (operationArcs.length >= MAX_OPERATION_ARCS || a === b) return;
      operationArcs.push({ a, b, operation, age: 0, life, intensity });
      flash[a] = Math.min(1.8, flash[a] + 0.42);
      flash[b] = Math.min(1.8, flash[b] + 0.42);
    };

    // 动态选一对粒子作电弧:坍缩时是横跨核心的长弦(可见的「放电」),
    // 松散时是邻近的短单丝(代谢)。距离落在 band 内 → 长度可控、可见。
    const pickArcPair = (coreWorld: number): [number, number] => {
      const collapsed = cur.collapse > 0.45;
      let a = (Math.random() * PARTICLE_COUNT) | 0;
      if (collapsed) {
        const r2 = coreWorld * coreWorld * 1.6;
        for (let t = 0; t < 4; t += 1) {
          const c = (Math.random() * PARTICLE_COUNT) | 0;
          const dx = pos[c * 3] - center.x, dy = pos[c * 3 + 1] - center.y, dz = pos[c * 3 + 2] - center.z;
          if (dx * dx + dy * dy + dz * dz < r2) { a = c; break; }
        }
      }
      const dMin = collapsed ? coreWorld * 0.7 : 0.2;
      const dMax = collapsed ? coreWorld * 2.4 : coreWorld * 0.9 + 0.6;
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      let b = a;
      for (let t = 0; t < 7; t += 1) {
        const c = (Math.random() * PARTICLE_COUNT) | 0;
        if (c === a) continue;
        const dx = pos[c * 3] - ax, dy = pos[c * 3 + 1] - ay, dz = pos[c * 3 + 2] - az;
        const dd = dx * dx + dy * dy + dz * dz;
        b = c;
        if (dd >= dMin * dMin && dd <= dMax * dMax) break;
      }
      return [a, b];
    };

    let lastNonce = apiStateRef.current.semanticSignal?.nonce ?? -1;

    const render = () => {
      raf = requestAnimationFrame(render);
      const now = performance.now();
      const reduced = reducedMotionRef.current;
      let dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const time = now / 1000;
      if (reduced) dt *= 0.25;

      const state = apiStateRef.current;
      const phase = phaseFromApiState(state);
      const activity = stateActivity(state, phase);
      const env = voiceEnvelope(state, phase, time);
      const vis = clamp(state.visualIntensity ?? 0);
      const coalescing = Boolean(state.coalescing);
      const activeOperation =
        state.operation ??
        state.semanticSignal?.operation ??
        inferOperation(state.semanticSignal?.text ?? "");

      // 目标 profile + visualIntensity / coalescing 调制(让无后端时点击也有反应)
      const target = PROFILES[phase];
      let tCollapse = target.collapse;
      let tCore = target.coreRadius;
      let tArcRate = target.arcRate;
      let tBaseEnergy = target.baseEnergy;
      let tBallStiff = target.ballStiff;
      let tHomeStiff = target.homeStiff;
      let tTremor = target.tremor;
      // 收束越强,弹簧越硬、home 拉力越弱 → 真坍缩成实心火团而非松球
      const tighten = (k: number) => {
        tCollapse = Math.max(tCollapse, lerp(tCollapse, 0.94, k));
        tCore = Math.min(tCore, lerp(tCore, 0.5, k));
        tBallStiff = Math.max(tBallStiff, lerp(tBallStiff, 11, k));
        tHomeStiff = Math.min(tHomeStiff, lerp(tHomeStiff, 0.4, k));
        tTremor = Math.max(tTremor, lerp(tTremor, 0.13, k));
        tArcRate = Math.max(tArcRate, lerp(tArcRate, 0.7, k));
      };
      if (vis > 0) {
        tighten(vis * 0.7);
        tBaseEnergy += vis * 0.16;
      }
      if (coalescing) {
        tighten(0.9);
        tBaseEnergy += 0.12;
      }

      const ease = clamp(dt * 3.8);
      const easeFast = clamp(dt * 5.0);
      cur.collapse = lerp(cur.collapse, tCollapse, easeFast);
      cur.coreRadius = lerp(cur.coreRadius, tCore, ease);
      cur.ballStiff = lerp(cur.ballStiff, tBallStiff, ease);
      cur.homeStiff = lerp(cur.homeStiff, tHomeStiff, ease);
      cur.swirl = lerp(cur.swirl, target.swirl, ease);
      cur.jitter = lerp(cur.jitter, target.jitter, ease);
      cur.tremor = lerp(cur.tremor, tTremor, ease);
      cur.damping = lerp(cur.damping, target.damping, ease);
      cur.baseEnergy = lerp(cur.baseEnergy, tBaseEnergy, ease);
      cur.coreGlow = lerp(cur.coreGlow, target.coreGlow, ease);
      cur.arcRate = lerp(cur.arcRate, tArcRate, ease);
      cur.arcLife = lerp(cur.arcLife, target.arcLife, ease);
      cur.arcIntensity = lerp(cur.arcIntensity, target.arcIntensity, ease);
      cur.spin = lerp(cur.spin, target.spin, ease);
      cur.eject = lerp(cur.eject, target.eject, ease);

      // 偏心锚点:核心缓慢游走
      center.set(
        Math.sin(time * 0.13) * 0.6,
        Math.cos(time * 0.17) * 0.5,
        Math.sin(time * 0.09) * 0.4,
      );

      // speaking 火团随声纹呼吸
      const coreWorld = FIELD_RADIUS * cur.coreRadius * (phase === "speaking" ? 1 + env * 0.45 : 1);
      const stepDamp = Math.pow(cur.damping, dt * 60);
      const swirlAccel = cur.swirl * 6 * (0.4 + cur.collapse);
      const jitterAccel = cur.jitter * 6;
      const tremorAccel = cur.tremor * FIELD_RADIUS * (reduced ? 0.2 : 1);

      for (let i = 0; i < PARTICLE_COUNT; i += 1) {
        const ix = i * 3, iy = ix + 1, iz = ix + 2;
        const px = pos[ix], py = pos[iy], pz = pos[iz];
        const dx = px - center.x, dy = py - center.y, dz = pz - center.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
        const nx = dx / dist, ny = dy / dist, nz = dz / dist;

        // 实心球:内层粒子目标半径更小 → 填满而非空壳
        const targetR = coreWorld * (0.35 + 0.65 * homeFrac[i]);
        const radialErr = dist - targetR;
        const radialK = -radialErr * cur.ballStiff * cur.collapse;
        const homeK = cur.homeStiff * (1 - cur.collapse);

        // 切向旋涡:tangent = up × radial,up = (0,1,0) → (nz, 0, -nx)
        const tanx = nz;
        const tanz = -nx;

        const tremx = Math.sin(time * 23 + seedArr[i]) * tremorAccel;
        const tremy = Math.sin(time * 19 + seedArr[i] * 2.1 + 1.7) * tremorAccel;
        const tremz = Math.sin(time * 27 + seedArr[i] * 0.7 + 3.1) * tremorAccel;

        const ax = nx * radialK + (home[ix] - px) * homeK + tanx * swirlAccel + tremx + (Math.random() * 2 - 1) * jitterAccel;
        const ay = ny * radialK + (home[iy] - py) * homeK + tremy + (Math.random() * 2 - 1) * jitterAccel;
        const az = nz * radialK + (home[iz] - pz) * homeK + tanz * swirlAccel + tremz + (Math.random() * 2 - 1) * jitterAccel;

        vel[ix] = vel[ix] * stepDamp + ax * dt;
        vel[iy] = vel[iy] * stepDamp + ay * dt;
        vel[iz] = vel[iz] * stepDamp + az * dt;
        pos[ix] = px + vel[ix] * dt;
        pos[iy] = py + vel[iy] * dt;
        pos[iz] = pz + vel[iz] * dt;

        // 亮度:基线 + 越靠核心越亮(火团);松散时叠加缓慢闪烁 → 满天星的呼吸
        const coreT = clamp(1 - dist / (coreWorld * 1.4));
        const glowMul = phase === "speaking" ? 0.6 + env * 0.7 : 1;
        const twinkle = (1 - cur.collapse) * Math.max(0, Math.sin(time * 1.2 + seedArr[i])) * 0.16;
        const targetE = cur.baseEnergy + coreT * cur.coreGlow * glowMul + energyBoost[i] + twinkle;
        energyBase[i] = lerp(energyBase[i], targetE, clamp(dt * 4));
        flash[i] *= Math.pow(0.86, dt * 60);
        energyData[i] = clamp(energyBase[i] + flash[i], 0, 2.4);
      }
      posAttr.needsUpdate = true;
      energyAttr.needsUpdate = true;

      // speaking:外围火星抛射
      if (!reduced && cur.eject > 0.001) {
        const ejects = Math.random() < cur.eject * (0.6 + env) ? 1 + ((Math.random() * 2) | 0) : 0;
        for (let n = 0; n < ejects; n += 1) {
          const i = (Math.random() * PARTICLE_COUNT) | 0;
          const ix = i * 3;
          const dx = pos[ix] - center.x, dy = pos[ix + 1] - center.y, dz = pos[ix + 2] - center.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
          const imp = (0.5 + env) * 9;
          vel[ix] += (dx / d) * imp;
          vel[ix + 1] += (dy / d) * imp;
          vel[ix + 2] += (dz / d) * imp;
          flash[i] = 1.4;
        }
      }

      // 语义脉冲 → 电弧爆发(代表一次推理事件/工具调用)
      const nonce = state.semanticSignal?.nonce ?? -1;
      if (nonce !== lastNonce) {
        lastNonce = nonce;
        const strength = clamp(state.semanticSignal?.strength ?? 1, 0.2, 1.3);
        const burst = Math.round(lerp(8, 18, strength));
        for (let n = 0; n < burst; n += 1) {
          const [pa, pb] = pickArcPair(coreWorld);
          spawnArc(pa, pb, cur.arcIntensity * (0.7 + strength * 0.5), cur.arcLife * (0.7 + Math.random() * 0.8));
        }
        if (activeOperation) {
          const operationBurst = Math.round(lerp(3, 8, strength));
          for (let n = 0; n < operationBurst; n += 1) {
            const [pa, pb] = pickArcPair(coreWorld);
            spawnOperationArc(pa, pb, activeOperation, 0.9 + strength * 0.55, cur.arcLife * (1.2 + Math.random() * 0.9));
          }
        }
      }

      // 环境电弧:thinking 越深,越多越亮越长
      if (!reduced) {
        const rate = cur.arcRate * (0.4 + activity * 1.5);
        let n = Math.floor(rate);
        if (Math.random() < rate - n) n += 1;
        for (let k = 0; k < n; k += 1) {
          const [pa, pb] = pickArcPair(coreWorld);
          spawnArc(pa, pb, cur.arcIntensity * (0.6 + Math.random() * 0.6) * (0.6 + activity * 0.7), cur.arcLife * (0.6 + Math.random() * 0.8) * (0.7 + activity * 0.8));
        }
        const operationRate = (activeOperation ? 0.42 : 0.09) * (0.35 + activity * 0.9);
        let operationCount = Math.floor(operationRate);
        if (Math.random() < operationRate - operationCount) operationCount += 1;
        for (let k = 0; k < operationCount; k += 1) {
          const [pa, pb] = pickArcPair(coreWorld);
          spawnOperationArc(
            pa,
            pb,
            activeOperation ?? pickOperation(),
            cur.arcIntensity * (0.75 + activity * 0.65),
            cur.arcLife * (1.35 + Math.random() * 1.2),
          );
        }
      }

      // 写电弧顶点
      let w = 0;
      for (let a = arcs.length - 1; a >= 0; a -= 1) {
        const arc = arcs[a];
        arc.age += dt;
        if (arc.age >= arc.life) { arcs.splice(a, 1); continue; }
        const ia = arc.a, ib = arc.b;
        const bright = Math.sin((arc.age / arc.life) * Math.PI) * arc.intensity;
        arcPos[w * 3] = pos[ia * 3];
        arcPos[w * 3 + 1] = pos[ia * 3 + 1];
        arcPos[w * 3 + 2] = pos[ia * 3 + 2];
        arcBright[w] = bright;
        w += 1;
        arcPos[w * 3] = pos[ib * 3];
        arcPos[w * 3 + 1] = pos[ib * 3 + 1];
        arcPos[w * 3 + 2] = pos[ib * 3 + 2];
        arcBright[w] = bright;
        w += 1;
      }
      arcGeom.setDrawRange(0, w);
      arcPosAttr.needsUpdate = true;
      arcBrightAttr.needsUpdate = true;

      let ow = 0;
      for (let a = operationArcs.length - 1; a >= 0; a -= 1) {
        const arc = operationArcs[a];
        arc.age += dt;
        if (arc.age >= arc.life) { operationArcs.splice(a, 1); continue; }
        const ia = arc.a, ib = arc.b;
        const bright = Math.sin((arc.age / arc.life) * Math.PI) * arc.intensity;
        const color = OPERATION_COLORS[arc.operation];
        opArcPos[ow * 3] = pos[ia * 3];
        opArcPos[ow * 3 + 1] = pos[ia * 3 + 1];
        opArcPos[ow * 3 + 2] = pos[ia * 3 + 2];
        opArcBright[ow] = bright;
        opArcColor[ow * 3] = color[0];
        opArcColor[ow * 3 + 1] = color[1];
        opArcColor[ow * 3 + 2] = color[2];
        ow += 1;
        opArcPos[ow * 3] = pos[ib * 3];
        opArcPos[ow * 3 + 1] = pos[ib * 3 + 1];
        opArcPos[ow * 3 + 2] = pos[ib * 3 + 2];
        opArcBright[ow] = bright;
        opArcColor[ow * 3] = color[0];
        opArcColor[ow * 3 + 1] = color[1];
        opArcColor[ow * 3 + 2] = color[2];
        ow += 1;
      }
      opArcGeom.setDrawRange(0, ow);
      opArcPosAttr.needsUpdate = true;
      opArcBrightAttr.needsUpdate = true;
      opArcColorAttr.needsUpdate = true;

      // 整体自转 — 提供三维视差
      groupRot += dt * cur.spin * (reduced ? 0.2 : 1);
      group.rotation.y = groupRot;
      group.rotation.x = Math.sin(time * 0.05) * 0.12;

      // bloom 强度随 activity 微调(更密更亮 = 更强泛光,但克制避免白爆)
      bloom.strength = lerp(0.28, 0.58, clamp(activity * 0.7 + cur.collapse * 0.25));

      composer.render();
    };

    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      composer.dispose();
      bloom.dispose();
      geom.dispose();
      pointMat.dispose();
      arcGeom.dispose();
      arcMat.dispose();
      opArcGeom.dispose();
      opArcMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, [frameless]);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label="语音助手三维神经星云动效"
      className={`relative overflow-hidden ${frameless ? "" : "rounded-lg border border-white/10 bg-black"} ${className}`}
      data-phase={phaseFromApiState(apiState)}
    />
  );
}
