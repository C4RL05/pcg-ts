/**
 * 08 — gpu fields: a million+ scattered points pushed through a
 * five-node, count-preserving chain
 *
 *   setAttribute("wobble") → jitterPoints → transformPoints
 *                          → setAttribute("tint") → setAttribute("psize")
 *
 * cooked three ways and timed against each other:
 *
 * - **CPU** — `cook(graph)` with no resolver. The bit-exact reference:
 *   every field evaluation and every apply loop runs in JS.
 * - **GPU per-node** — the real `GpuFieldEvaluator` for field
 *   resolution, but fusion switched off (a wrapper whose `planRun`
 *   returns null). Each node still clones the geometry, reads its
 *   field column back from the device, and applies it on the CPU.
 * - **GPU fused** — the plain evaluator. All five nodes are one
 *   device-resident run: attribute columns live in storage buffers
 *   across member kernels and only the terminal reads back, so
 *   `readbacksSaved = fusedNodes − residentRuns = 5 − 1 = 4`.
 *
 * Every timing is taken from **cold caches** (a fresh graph per
 * measurement). That is not decoration: the terminal node holds a
 * single memo slot, and a fused cook stores under a run key
 * (`run1|gpu:<salt>|…`) while a per-node cook stores under a node key
 * (`<type>|s…`). Switching paths therefore always recooks the chain —
 * by design, not a bug — so a "warm" number would silently be a number
 * from whichever path ran last.
 *
 * Without WebGPU the page runs CPU-only with a visible notice.
 */
import {
  Geometry,
  Graph,
  cook,
  evaluateField,
  fieldFromJson,
  firstGeometry,
  jitterPoints,
  pointScatterInBounds,
  setAttribute,
  transformPoints,
  type Field,
  type GpuFieldResolver,
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
import { sizeSpec, tintSpec, wobbleSpec } from "./spec.js";
import {
  COOK_PATHS,
  TIGHT_RESIDENT_BYTES,
  type CookPath,
  type PanelBridge,
  type PanelView,
  type PathReport,
  type ResidentBudget,
} from "./view.js";

const AREA = 30; // half extent in X/Z
const HALF_Y = 9; // half extent in Y
const DEVIATION_WINDOW = 16384;

// -- graph -----------------------------------------------------------------

let seed = 1;
let count = 1_000_000;
let frequency = 0.055;
let path: CookPath = "cpu";
let residentBudget: ResidentBudget = "default";

/**
 * The chain is deliberately built from the four fusable node kinds
 * (`setAttribute` in numeric point mode, `jitterPoints`,
 * `transformPoints`, `orientAlongVector`) in a straight line with no
 * taps: one geometry in, one geometry out, one consumer each, and
 * every Field param carries a serializable spec. `pointScatterInBounds`
 * changes the point count, so it is never a run member — the run is
 * exactly the five nodes after it, and its terminal (`psize`) is the
 * declared output, which is where the single readback lands.
 *
 * `transformPoints` runs on plain vec3 constants on purpose: since
 * v0.6.1 a constant param rides a uniform slot instead of a device
 * column, so those three cost one apply kernel between them rather
 * than four dispatches and 36 MB of temporaries at a million points.
 */
function buildRig() {
  const graph = new Graph(seed);
  const scatter = graph.add(pointScatterInBounds, {
    count,
    boundsMin: [-AREA, -HALF_Y, -AREA],
    boundsMax: [AREA, HALF_Y, AREA],
  });
  const wobbleNode = graph.add(setAttribute, {
    name: "wobble",
    domain: "point",
    type: "f32",
    tupleSize: 3,
    value: fieldFromJson(wobbleSpec(frequency)),
  });
  // Reads the attribute the previous member just wrote — resident, so
  // the bytes never leave the device between the two nodes.
  const jitterNode = graph.add(jitterPoints, {
    amount: fieldFromJson({ fn: "attribute", name: "wobble", tupleSize: 3 }),
    seed: 7,
  });
  const transformNode = graph.add(transformPoints, {
    translate: [0, 0, 0],
    rotateEuler: [0, 14, 0],
    scale: [1, 0.92, 1],
  });
  // Evaluated on the post-jitter, post-transform positions: the tint
  // kernel reads P out of the resident slot the two members above
  // mutated in place.
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
  graph.connect(scatter, "out", wobbleNode, "in");
  graph.connect(wobbleNode, "out", jitterNode, "in");
  graph.connect(jitterNode, "out", transformNode, "in");
  graph.connect(transformNode, "out", tintNode, "in");
  graph.connect(tintNode, "out", sizeNode, "in");
  graph.output(sizeNode, "out", "points");
  return { graph, tintNode, tintField };
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

/** Fusing evaluator, default 512 MiB resident bound. */
let fusedEval: GpuFieldEvaluator | undefined;
/** Same device, tiny resident bound — every run rejects `run-too-large`. */
let tightEval: GpuFieldEvaluator | undefined;
/** Fusion disabled; fields still resolve on the device. */
let perNodeEval: GpuFieldResolver | undefined;
/** Set once the device is lost: GPU paths stop being offered. */
let gpuLost = false;

/**
 * Wraps a real evaluator so the executor never fuses: `planRun` returns
 * null (with no fallback counted — this is a mode, not a rejection), so
 * every member cooks through the per-node path. `executeRun` is
 * forwarded only because the executor requires *both* run methods
 * before it calls either; with a null plan it is unreachable.
 *
 * `cacheSalt` is the base evaluator's, deliberately. Both GPU paths run
 * on the same device, so claiming different device provenance would be
 * a lie. The two paths still never serve each other's bytes: a fused
 * terminal caches under a run key and a per-node cook under a node key,
 * and the two key formats cannot collide.
 */
function perNodeOnly(base: GpuFieldEvaluator): GpuFieldResolver {
  return {
    cacheSalt: base.cacheSalt,
    resolveField: (field, ctx, stats) => base.resolveField(field, ctx, stats),
    planRun: () => null,
    executeRun: (plan, input, stats) => base.executeRun(plan, input, stats),
  };
}

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
    // A lost device never rejects work already in flight — a pending
    // readback simply never settles — so surface it instead of letting
    // the page sit on "cooking…" forever. Chrome can lose the device
    // when the main thread blocks long enough to trip its watchdog,
    // which a million-point CPU cook is entirely capable of doing.
    const lost = (device as { lost?: Promise<{ reason?: string; message?: string }> }).lost;
    if (lost !== undefined) {
      void lost.then((detail) => {
        gpuLost = true;
        view.cooking = false;
        view.error =
          `WebGPU device lost (${detail?.reason ?? "unknown"}: ${detail?.message ?? "no detail"}) — ` +
          "GPU paths are disabled; reload to get a fresh device.";
        view.gpuAvailable = false;
        push();
      });
    }
    const base = info !== undefined ? { adapterInfo: info } : {};
    fusedEval = new GpuFieldEvaluator(device, base);
    tightEval = new GpuFieldEvaluator(device, { ...base, maxResidentBytes: TIGHT_RESIDENT_BYTES });
    perNodeEval = perNodeOnly(fusedEval);
    const label =
      [info?.vendor, info?.architecture, info?.description !== "" ? info?.description : info?.device]
        .filter((p): p is string => typeof p === "string" && p !== "")
        .join(" · ") || "adapter (no info exposed)";
    console.info(`04-gpu-fields: WebGPU ready — ${label}; cacheSalt=${fusedEval.cacheSalt}`);
    return { label };
  } catch (err) {
    console.error("04-gpu-fields: WebGPU init failed, falling back to CPU:", err);
    return { error: `WebGPU init failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** The resolver a path cooks with; `undefined` means "no gpu option". */
function resolverFor(p: CookPath): GpuFieldResolver | undefined {
  if (p === "cpu") return undefined;
  if (p === "gpu-node") return perNodeEval;
  return residentBudget === "tight" ? tightEval : fusedEval;
}

function pathAvailable(p: CookPath): boolean {
  return p === "cpu" || (fusedEval !== undefined && !gpuLost);
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
 * The first `w` points of `geo` as a standalone geometry, carrying
 * **every** point attribute — not a hand-picked subset.
 *
 * This is load-bearing, not tidiness. Per-point randomness is keyed on
 * point IDENTITY: `hashCombine(bits(Px), bits(Py), bits(Pz), seed)` over
 * the position bits *and* the standard `seed` column. A window that
 * copied only `P` would leave `seed` at its all-zero default, so the
 * same point would have a different identity on the two sides and
 * `randomField` would draw an unrelated stream rather than a nearly
 * equal one. The readout would then be comparing two different worlds
 * and faithfully reporting that they differ enormously — a probe
 * artifact indistinguishable, at a glance, from a parity failure.
 *
 * Copying the whole domain (rather than `P` + `seed`) keeps that true
 * for any field the spec grows later: `{ fn: "attribute", … }` reads
 * whatever column it names, and a window missing it would fail the same
 * way. Detail attributes come along for the same reason — a field
 * evaluated on the point domain can read them.
 */
function pointWindow(geo: Geometry, w: number): Geometry {
  const sub = new Geometry();
  sub.attrs.point.resize(w);
  for (const src of geo.attrs.point) {
    sub.attrs.point
      .add(src.name, src.type, src.tupleSize, src.defaultValue)
      .copyFrom(src, 0, 0, w);
  }
  for (const src of geo.attrs.detail) {
    sub.attrs.detail
      .add(src.name, src.type, src.tupleSize, src.defaultValue)
      .copyFrom(src, 0, 0, 1);
  }
  return sub;
}

/**
 * Re-evaluate the tint field on the CPU over the first `DEVIATION_WINDOW`
 * points of the cooked result (same positions the device kernel saw —
 * post-jitter, post-transform — the same per-point seeds, and the same
 * evaluation seed the setAttribute node used) and compare against the
 * cooked bytes. Reported both as max |cpu − gpu| and in range-ULP units
 * — the phase-measured metric: error / (2^-23 · max|cpu|), i.e. ULPs at
 * the top of the output range.
 */
function measureDeviation(geo: Geometry, tintGpu: Float32Array, p: CookPath): PanelView["deviation"] {
  const w = Math.min(DEVIATION_WINDOW, geo.pointCount);
  if (w === 0) return undefined;
  const sub = pointWindow(geo, w);
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
  return { maxAbs, rangeUlp, window: w, path: p };
}

// -- panel wiring ----------------------------------------------------------

function emptyReports(): Record<CookPath, PathReport> {
  return { cpu: {}, "gpu-node": {}, "gpu-fused": {} };
}

const view: PanelView = {
  gpuAvailable: false,
  gpuReason: "",
  adapter: "detecting…",
  path,
  count,
  seed,
  frequency,
  residentBudget,
  cooking: false,
  fps: "–",
  points: 0,
  reports: emptyReports(),
  specJson: JSON.stringify(tintSpec(frequency), null, 2),
};

const bridge: PanelBridge = {};

function push(): void {
  bridge.publish?.({
    ...view,
    reports: {
      cpu: { ...view.reports.cpu },
      "gpu-node": { ...view.reports["gpu-node"] },
      "gpu-fused": { ...view.reports["gpu-fused"] },
    },
    deviation: view.deviation && { ...view.deviation },
  });
}

function resetComparisons(): void {
  view.reports = emptyReports();
  view.deviation = undefined;
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

interface CookJob {
  readonly path: CookPath;
  /** Reuse the existing graph (caches populated) instead of rebuilding. */
  readonly warm: boolean;
}

async function runCook(job: CookJob): Promise<void> {
  if (!pathAvailable(job.path)) return;
  if (!job.warm) rig = buildRig();
  path = job.path;
  view.path = job.path;
  view.cooking = true;
  view.error = undefined;
  push();
  await paintFlush();

  const resolver = resolverFor(job.path);
  const t0 = performance.now();
  let result;
  try {
    // budgetMs lets the cook yield between nodes; a single 1M-point CPU
    // field evaluation is still one synchronous block (that contrast is
    // the demo).
    result = await cook(rig.graph, resolver !== undefined ? { gpu: resolver, budgetMs: 14 } : { budgetMs: 14 });
  } catch (err) {
    console.error("04-gpu-fields: cook failed:", err);
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

  const report = view.reports[job.path];
  report.nodes = `${result.stats.cooked} / ${result.stats.cached}`;
  if (result.stats.cooked > 0) {
    // A fully cached cook is not a cold-timing sample; it is the warm one.
    report.lastMs = wallMs;
    report.bestMs = report.bestMs === undefined ? wallMs : Math.min(report.bestMs, wallMs);
  } else {
    report.warmMs = wallMs;
  }
  report.hash = hashColumns(tint, psize);
  // Counters are kept from cold cooks only. A warm cook legitimately
  // reports all zeros (a run served from its terminal's memo entry does
  // no device work at all), but zeroing the panel would hide the
  // numbers worth reading; `nodes 0 / N` and the warm wall time are the
  // proof instead.
  if (result.stats.gpu !== undefined && result.stats.cooked > 0) {
    report.gpu = {
      dispatches: result.stats.gpu.dispatches,
      pipelinesCompiled: result.stats.gpu.pipelinesCompiled,
      pipelineCacheHits: result.stats.gpu.pipelineCacheHits,
      residentRuns: result.stats.gpu.residentRuns,
      fusedNodes: result.stats.gpu.fusedNodes,
      readbacksSaved: result.stats.gpu.readbacksSaved,
      fallbacks: { ...result.stats.gpu.fallbacks },
    };
  }
  view.points = n;
  if (job.path !== "cpu" && result.stats.cooked > 0) {
    view.deviation = measureDeviation(geo, tint, job.path);
  }
  view.cooking = false;
  push();
}

/**
 * Jobs run strictly in order; a newer request replaces whatever has not
 * started yet (so dragging the frequency slider never queues a dozen
 * million-point cooks) but never interrupts the cook in flight.
 */
let queue: CookJob[] = [];
const pump = makeRecooker(async () => {
  while (queue.length > 0) {
    const job = queue.shift();
    if (job !== undefined) await runCook(job);
  }
});

function schedule(...jobs: CookJob[]): void {
  queue = jobs;
  pump();
}

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
      setPath(p: CookPath) {
        if (!pathAvailable(p)) return;
        view.path = p;
        schedule({ path: p, warm: false });
      },
      setCount(n: number) {
        count = n;
        view.count = n;
        resetComparisons();
        schedule({ path, warm: false });
      },
      setSeed(s: number) {
        seed = s;
        view.seed = s;
        resetComparisons();
        schedule({ path, warm: false });
      },
      setFrequency(f: number) {
        frequency = f;
        view.frequency = f;
        view.specJson = JSON.stringify(tintSpec(f), null, 2);
        resetComparisons();
        schedule({ path, warm: false });
      },
      setResidentBudget(b: ResidentBudget) {
        residentBudget = b;
        view.residentBudget = b;
        // A different bound changes whether the run fuses at all, so no
        // previously measured time stays comparable.
        resetComparisons();
        schedule({ path, warm: false });
      },
      measureAll() {
        // GPU paths first, CPU last. A million-point CPU cook blocks the
        // main thread for the better part of a minute, which is long
        // enough for the browser to lose the WebGPU device — and a lost
        // device leaves an in-flight readback pending forever, so a CPU
        // measurement taken first can hang the GPU measurements behind
        // it. Measuring CPU last keeps the comparison honest and the
        // page responsive up to the one unavoidable freeze.
        const order = COOK_PATHS.filter(pathAvailable).sort((a, b) =>
          a === "cpu" ? 1 : b === "cpu" ? -1 : 0,
        );
        schedule(...order.map((p) => ({ path: p, warm: false })));
      },
      rebuild() {
        // Fresh graph, cold caches, same seed: the recook must reproduce
        // the same per-path hash — determinism made visible. The GPU
        // evaluators (and their pipeline caches) survive the rebuild.
        schedule({ path, warm: false });
      },
      cookWarm() {
        // Same graph again: every node is a memo hit, the fused run is
        // served from its terminal's single entry, and no device work
        // happens at all (residentRuns and dispatches both stay 0).
        schedule({ path, warm: true });
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
    path = "gpu-fused";
    view.path = "gpu-fused";
  } else {
    view.gpuAvailable = false;
    view.gpuReason = res.error;
    view.adapter = "none";
  }
  push();
  schedule({ path, warm: false });
});

const fps = createFpsMeter((v) => {
  view.fps = v;
  push();
});
start(() => fps());
