/**
 * 08 — gpu fields: one million+ scattered points colored and sized by
 * chunky JSON field expressions, cooked through the normal graph path
 * (`pointScatterInBounds` → two `setAttribute` nodes) with a CPU/GPU
 * toggle. In GPU mode the cook is passed a `GpuFieldEvaluator` over the
 * browser's WebGPU device, so each spec'd field resolves as one WGSL
 * compute dispatch; in CPU mode the identical graph cooks on the CPU —
 * the bit-exact reference. The panel shows wall times, `CookStats.gpu`
 * counters, per-path output hashes (cache provenance made visible), and
 * a live max-deviation readout against the CPU over a sample window.
 * Without WebGPU the page runs CPU-only with a visible notice.
 */
import {
  Graph,
  cook,
  createPointCloud,
  evaluateField,
  fieldFromJson,
  firstGeometry,
  pointScatterInBounds,
  setAttribute,
  type Field,
  type Geometry,
} from "pcg-ts";
import {
  GpuFieldEvaluator,
  type GpuAdapterInfoLike,
  type GpuDeviceLike,
} from "pcg-ts/gpu";
import { mount } from "svelte";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial } from "three";
import { createFpsMeter } from "../shared/fps.js";
import { makeRecooker } from "../shared/recook.js";
import { createScene } from "../shared/scene.js";
import Panel from "./Panel.svelte";
import { sizeSpec, tintSpec } from "./spec.js";
import type { CookMode, PanelBridge, PanelView } from "./view.js";

const AREA = 30; // half extent in X/Z
const HALF_Y = 9; // half extent in Y
const DEVIATION_WINDOW = 16384;

// -- graph -----------------------------------------------------------------

let seed = 1;
let count = 1_000_000;
let frequency = 0.055;
let mode: CookMode = "cpu";

function buildRig() {
  const graph = new Graph(seed);
  const scatter = graph.add(pointScatterInBounds, {
    count,
    boundsMin: [-AREA, -HALF_Y, -AREA],
    boundsMax: [AREA, HALF_Y, AREA],
  });
  const tintField: Field = fieldFromJson(tintSpec(frequency));
  const tintNode = graph.add(setAttribute, {
    name: "tint",
    domain: "point",
    type: "f32",
    tupleSize: 3,
    value: tintField,
  });
  const sizeNode = graph.add(setAttribute, {
    name: "psize",
    domain: "point",
    type: "f32",
    tupleSize: 1,
    value: fieldFromJson(sizeSpec(frequency)),
  });
  graph.connect(scatter, "out", tintNode, "in");
  graph.connect(tintNode, "out", sizeNode, "in");
  graph.output(sizeNode, "out", "points");
  return { graph, scatter, tintNode, sizeNode, tintField };
}

let rig = buildRig();

// -- WebGPU device ---------------------------------------------------------

/** Minimal structural view of `navigator.gpu` (kept local so the example
 * compiles with or without ambient WebGPU type packages). A real
 * `GPUDevice` is compile-time assignable to `GpuDeviceLike`. */
interface AdapterLike {
  readonly info?: GpuAdapterInfoLike;
  requestDevice(): Promise<GpuDeviceLike>;
}
interface NavigatorGpuLike {
  requestAdapter(): Promise<AdapterLike | null>;
}

let gpuEval: GpuFieldEvaluator | undefined;

async function initGpu(): Promise<{ label: string } | { error: string }> {
  const navGpu = (navigator as unknown as { gpu?: NavigatorGpuLike }).gpu;
  if (navGpu === undefined) {
    return { error: "navigator.gpu is missing — this browser has no WebGPU" };
  }
  try {
    const adapter = await navGpu.requestAdapter();
    if (adapter === null) {
      return { error: "requestAdapter() returned null — no compatible GPU adapter" };
    }
    const info = adapter.info;
    const device = await adapter.requestDevice();
    gpuEval = new GpuFieldEvaluator(device, info !== undefined ? { adapterInfo: info } : {});
    const label =
      [info?.vendor, info?.architecture, info?.description !== "" ? info?.description : info?.device]
        .filter((p): p is string => typeof p === "string" && p !== "")
        .join(" · ") || "adapter (no info exposed)";
    console.info(`08-gpu-fields: WebGPU ready — ${label}; cacheSalt=${gpuEval.cacheSalt}`);
    return { label };
  } catch (err) {
    console.error("08-gpu-fields: WebGPU init failed, falling back to CPU:", err);
    return { error: `WebGPU init failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// -- scene + point cloud rendering -----------------------------------------

const { scene, camera, renderer, start } = createScene({ cameraPosition: [52, 26, 52] });

function viewScale(): number {
  return window.innerHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
}

const pointsMat = new ShaderMaterial({
  uniforms: {
    uScale: { value: viewScale() },
    uPx: { value: renderer.getPixelRatio() },
  },
  vertexShader: /* glsl */ `
    attribute vec3 aTint;
    attribute float aSize;
    uniform float uScale, uPx;
    varying vec3 vColor;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float px = aSize * 0.05 * uScale * uPx / max(0.1, -mv.z);
      float fade = clamp(px, 0.0, 1.0);
      vColor = aTint * (0.45 + 0.55 * fade);
      gl_PointSize = clamp(px, 1.0, 40.0 * uPx);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    varying vec3 vColor;
    void main() {
      vec2 q = gl_PointCoord - 0.5;
      float d = length(q) * 2.0;
      if (d > 1.0) discard;
      float a = pow(1.0 - d, 1.8);
      gl_FragColor = vec4(vColor * a, 1.0);
    }`,
  blending: AdditiveBlending,
  depthWrite: false,
  transparent: true,
});

let pointsObj: Points | undefined;

function uploadPoints(geo: Geometry, tint: Float32Array, psize: Float32Array): void {
  const n = geo.pointCount;
  const P = geo.attrs.point.require("P").data as Float32Array;
  const bufferGeo = new BufferGeometry();
  bufferGeo.setAttribute("position", new BufferAttribute(P.slice(0, n * 3), 3));
  bufferGeo.setAttribute("aTint", new BufferAttribute(tint.slice(0, n * 3), 3));
  bufferGeo.setAttribute("aSize", new BufferAttribute(psize.slice(0, n), 1));
  bufferGeo.computeBoundingSphere();
  if (pointsObj !== undefined) {
    scene.remove(pointsObj);
    pointsObj.geometry.dispose();
  }
  pointsObj = new Points(bufferGeo, pointsMat);
  scene.add(pointsObj);
}

window.addEventListener("resize", () => {
  pointsMat.uniforms.uScale.value = viewScale();
  pointsMat.uniforms.uPx.value = renderer.getPixelRatio();
});

// -- determinism hash ------------------------------------------------------

/** FNV-1a (32-bit) over a u32 view of the column bytes: a short, stable
 * fingerprint of exactly the bytes the cook produced. */
function fnv1aU32(h: number, words: Uint32Array): number {
  for (let i = 0; i < words.length; i++) {
    h ^= words[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hashColumns(tint: Float32Array, psize: Float32Array): string {
  let h = 0x811c9dc5;
  h = fnv1aU32(h, new Uint32Array(tint.buffer, tint.byteOffset, tint.length));
  h = fnv1aU32(h, new Uint32Array(psize.buffer, psize.byteOffset, psize.length));
  return h.toString(16).padStart(8, "0");
}

// -- deviation readout (live parity vs the CPU reference) ------------------

/**
 * Re-evaluate the tint field on the CPU over the first `DEVIATION_WINDOW`
 * points (same positions, same evaluation seed the setAttribute node
 * used) and compare against the GPU-cooked bytes. Reported both as
 * max |cpu − gpu| and in range-ULP units — the phase-measured metric:
 * error / (2^-23 · max|cpu|), i.e. ULPs at the top of the output range.
 */
function measureDeviation(geo: Geometry, tintGpu: Float32Array): PanelView["deviation"] {
  const w = Math.min(DEVIATION_WINDOW, geo.pointCount);
  if (w === 0) return undefined;
  const sub = createPointCloud(w);
  const dstP = sub.attrs.point.require("P").data as Float32Array;
  const srcP = geo.attrs.point.require("P").data as Float32Array;
  dstP.set(srcP.subarray(0, w * 3));
  // setAttribute with seed param 0 (the default) evaluates its field
  // with the node's derived seed — read it off the structural snapshot.
  const desc = rig.graph.describe().nodes.find((node) => node.id === rig.tintNode.id);
  if (desc === undefined) return undefined;
  const cpu = evaluateField(rig.tintField, { geo: sub, domain: "point", seed: desc.seed });
  let maxAbs = 0;
  let maxMag = 0;
  for (let i = 0; i < w * 3; i++) {
    const c = cpu.data[i];
    const d = Math.abs(c - tintGpu[i]);
    if (d > maxAbs) maxAbs = d;
    const m = Math.abs(c);
    if (m > maxMag) maxMag = m;
  }
  const rangeUlp = maxAbs === 0 ? 0 : maxMag === 0 ? Infinity : maxAbs / (2 ** -23 * maxMag);
  return { maxAbs, rangeUlp, window: w };
}

// -- panel wiring ----------------------------------------------------------

const view: PanelView = {
  gpuAvailable: false,
  gpuReason: "",
  adapter: "detecting…",
  mode,
  count,
  seed,
  frequency,
  cooking: false,
  fps: "–",
  points: 0,
  nodes: "–",
  cpu: {},
  gpu: {},
  specJson: JSON.stringify(tintSpec(frequency), null, 2),
};

const bridge: PanelBridge = {};

function push(): void {
  bridge.publish?.({
    ...view,
    cpu: { ...view.cpu },
    gpu: { ...view.gpu },
    gpuStats: view.gpuStats && { ...view.gpuStats, fallbacks: { ...view.gpuStats.fallbacks } },
    deviation: view.deviation && { ...view.deviation },
  });
}

function resetComparisons(): void {
  view.cpu = {};
  view.gpu = {};
  view.deviation = undefined;
  view.gpuStats = undefined;
}

// -- cook loop -------------------------------------------------------------

/** Two animation frames, so the "cooking…" state paints before a long
 * synchronous CPU field evaluation blocks the tab. Hidden tabs never fire
 * rAF, so a timeout keeps the cook from stalling until the tab is visible. */
function paintFlush(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 250);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      }),
    );
  });
}

const recook = makeRecooker(async () => {
  const useGpu = mode === "gpu" && gpuEval !== undefined;
  view.cooking = true;
  view.error = undefined;
  push();
  await paintFlush();
  const t0 = performance.now();
  let result;
  try {
    // budgetMs lets the cook yield between nodes; a single 1M-point CPU
    // field evaluation is still one synchronous block (that contrast is
    // the demo).
    result = await cook(rig.graph, useGpu ? { gpu: gpuEval, budgetMs: 14 } : { budgetMs: 14 });
  } catch (err) {
    console.error("08-gpu-fields: cook failed:", err);
    view.cooking = false;
    view.error = err instanceof Error ? err.message : String(err);
    push();
    return;
  }
  const wallMs = performance.now() - t0;

  const geo = firstGeometry(result.outputs.points);
  if (geo === undefined) {
    view.cooking = false;
    view.error = "cook produced no geometry";
    push();
    return;
  }
  const n = geo.pointCount;
  const tint = (geo.attrs.point.require("tint").data as Float32Array).subarray(0, n * 3);
  const psize = (geo.attrs.point.require("psize").data as Float32Array).subarray(0, n);
  uploadPoints(geo, tint, psize);

  const report = useGpu ? view.gpu : view.cpu;
  if (result.stats.cooked > 0) {
    // A fully cached cook (~0 ms) is not a timing sample.
    report.lastMs = wallMs;
    report.bestMs = report.bestMs === undefined ? wallMs : Math.min(report.bestMs, wallMs);
  }
  report.hash = hashColumns(tint, psize);
  view.points = n;
  view.nodes = `${result.stats.cooked} / ${result.stats.cached}`;
  if (result.stats.gpu !== undefined) {
    view.gpuStats = {
      dispatches: result.stats.gpu.dispatches,
      pipelinesCompiled: result.stats.gpu.pipelinesCompiled,
      pipelineCacheHits: result.stats.gpu.pipelineCacheHits,
      fallbacks: { ...result.stats.gpu.fallbacks },
    };
    if (useGpu && result.stats.gpu.dispatches > 0) {
      view.deviation = measureDeviation(geo, tint);
    }
  }
  view.cooking = false;
  push();
});

// -- controls --------------------------------------------------------------

mount(Panel, {
  target: (() => {
    const el = document.getElementById("panel");
    if (el === null) throw new Error("missing #panel element");
    return el;
  })(),
  props: {
    bridge,
    host: {
      setMode(m: CookMode) {
        if (m === "gpu" && gpuEval === undefined) return;
        mode = m;
        view.mode = m;
        recook();
      },
      setCount(n: number) {
        count = n;
        view.count = n;
        rig.graph.setParam(rig.scatter, "count", n);
        resetComparisons();
        recook();
      },
      setSeed(s: number) {
        seed = s;
        view.seed = s;
        rig.graph.setSeed(s);
        resetComparisons();
        recook();
      },
      setFrequency(f: number) {
        frequency = f;
        view.frequency = f;
        rig.tintField = fieldFromJson(tintSpec(f));
        rig.graph.setParam(rig.tintNode, "value", rig.tintField);
        rig.graph.setParam(rig.sizeNode, "value", fieldFromJson(sizeSpec(f)));
        view.specJson = JSON.stringify(tintSpec(f), null, 2);
        resetComparisons();
        recook();
      },
      rebuild() {
        // Fresh graph, cold caches, same seed: the recook must reproduce
        // the same per-path hash — determinism made visible. The GPU
        // evaluator (and its pipeline cache) survives the rebuild.
        rig = buildRig();
        recook();
      },
    },
    initial: { ...view },
  },
});

// -- boot ------------------------------------------------------------------

void initGpu().then((res) => {
  if ("label" in res) {
    view.gpuAvailable = true;
    view.adapter = res.label;
    mode = "gpu";
    view.mode = "gpu";
  } else {
    view.gpuAvailable = false;
    view.gpuReason = res.error;
    view.adapter = "none";
  }
  push();
  recook();
});

const fps = createFpsMeter((v) => {
  view.fps = v;
  push();
});
start(() => fps());
