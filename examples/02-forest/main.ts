/**
 * 02 — forest: an fbm heightfield displaces a terrain mesh (core fields
 * API used directly, outside any graph), the displaced mesh feeds a graph
 * via fromBufferGeometry + dataInput, surfaceSample scatters candidates,
 * height/slope attributes are stamped from position/normal fields, low
 * slope + below-treeline filters keep the plantable points, and a string
 * setAttribute picks each point's `species` declaratively so spawnInstances
 * splits the spawn into pine and bush instance batches — all in one graph.
 *
 * The spawn can end two different ways, and the toggle switches between
 * them live:
 *
 * - **device-resident** — one `GPUDevice` backs both halves. The
 *   `GpuFieldEvaluator` (constructed with `deviceInstances: true`)
 *   composes the 4x4s in a WGSL kernel — one buffer and one dispatch per
 *   asset, so `species` survives intact — and a `WebGPURenderer` created
 *   with `{ device }` adopts those buffers as storage instance attributes
 *   through `createWebGpuInstanceAdapter`. No readback, no `Float32Array`
 *   of matrices, no `instanceMatrix` upload.
 * - **CPU readback** — the same graph, the same device, the same fields,
 *   but an evaluator without `deviceInstances`. `spawnInstances` is then
 *   not a resident terminal, so JS composes the matrices and
 *   `toInstancedMeshes` uploads them.
 *
 * **The run is one member deep, and the page says so.** A resident run is
 * a maximal linear chain of resident-capable nodes, and this graph's
 * chain breaks immediately before the spawn: `setAttribute("species")` is
 * a *string* attribute, which no resident node can produce, so it is not
 * resident-capable at all. `surfaceSample` and both filters change the
 * point count and are never run members either, and the height/slope/size
 * fields are code-authored, so they carry no `FieldSpec` to lower into
 * WGSL. The run is therefore the spawn alone — `resident runs / fused
 * members` reads `1 / 1`, which is the honest number, and the panel's
 * "why one fused member" section spells out the reason. What the device
 * path buys is exactly one thing, and it is the expensive one: the
 * compose and the upload.
 *
 * Both the cook and the terrain rebuild are budgeted. That matters more
 * than it looks: a long synchronous cook can trip the browser's watchdog
 * and cost the page its WebGPU device, and a lost device leaves in-flight
 * readbacks pending forever. `device.lost` is therefore surfaced in the
 * panel instead of being allowed to look like a hang.
 *
 * Without WebGPU — or with a renderer that will not share our device —
 * the page says exactly what was missing and runs the CPU path, so it
 * still renders.
 */
import {
  Graph,
  attribute,
  component,
  cook,
  createPointCloud,
  dataInput,
  evaluateField,
  fbm,
  filterByAttribute,
  ge,
  hashCombine,
  makeGeometryItem,
  mul,
  perlinNoise,
  position,
  randomField,
  remap,
  setAttribute,
  spawnInstances,
  sub,
  surfaceSample,
  vec,
  type CellCoord,
  type DeviceInstanceBatch,
  type Field,
  type GpuCookStats,
  type InstancesItem,
} from "pcg-ts";
import { GpuFieldEvaluator, type GpuAdapterInfoLike, type GpuDeviceLike } from "pcg-ts/gpu";
import {
  createWebGpuInstanceAdapter,
  fromBufferGeometry,
  toInstancedMeshes,
  type AssetMap,
  type DeviceCellBounds,
  type WebGpuInstanceAdapter,
} from "pcg-ts/three";
import {
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  type BufferGeometry,
  type InstancedMesh,
  type Object3D,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MeshStandardNodeMaterial, WebGPURenderer } from "three/webgpu";
import { createFpsMeter } from "../shared/fps.js";
import { createOverlay } from "../shared/overlay.js";
import { makeRecooker } from "../shared/recook.js";

const TERRAIN_SIZE = 240;
const TERRAIN_SEGS = 150;
const HEIGHT_SCALE = 18;
const TREELINE = 9.5; // max height a tree accepts
const MAX_SLOPE = 0.28; // slope = 1 - normal.y
/** Upper target of the `scale` remap below; the bounds derivation reads it. */
const MAX_TREE_SCALE = 1.5;
/** Shared background, matching the page CSS. */
const BACKGROUND = 0x0d1117;
/** Per-cook yield budget. See the file header: this is load-bearing. */
const BUDGET_MS = 8;

/** Which end the instance matrices are composed at. */
type PathMode = "device" | "cpu";

let seed = 1;
let treeCount = 9000;
let mode: PathMode = "device";

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// -- WebGPU device ---------------------------------------------------------

/**
 * Minimal structural view of `navigator.gpu` (kept local so the example
 * compiles with or without ambient WebGPU type packages). A real
 * `GPUDevice` is compile-time assignable to `GpuDeviceLike`.
 */
interface AdapterLike {
  readonly info?: GpuAdapterInfoLike;
  requestDevice(): Promise<GpuDeviceLike>;
}
interface NavigatorGpuLike {
  requestAdapter(): Promise<AdapterLike | null>;
}

interface DeviceProbe {
  readonly device: GpuDeviceLike;
  readonly info: GpuAdapterInfoLike | undefined;
  readonly label: string;
}

function describeAdapter(info: GpuAdapterInfoLike | undefined): string {
  // `description` is often an empty string rather than absent, so fall
  // through to `device` on both empty and missing.
  const detail = (info?.description ?? "") !== "" ? info?.description : info?.device;
  return (
    [info?.vendor, info?.architecture, detail]
      .filter((p): p is string => typeof p === "string" && p !== "")
      .join(" · ") || "adapter (no info exposed)"
  );
}

async function requestDevice(): Promise<DeviceProbe | { error: string }> {
  const navGpu = (navigator as unknown as { gpu?: NavigatorGpuLike }).gpu;
  if (navGpu === undefined) {
    return { error: "navigator.gpu is missing — this browser has no WebGPU." };
  }
  try {
    const gpuAdapter = await navGpu.requestAdapter();
    if (gpuAdapter === null) {
      return { error: "navigator.gpu.requestAdapter() returned null — no compatible GPU adapter." };
    }
    const info = gpuAdapter.info;
    const device = await gpuAdapter.requestDevice();
    // A lost device never rejects work already in flight — a pending
    // readback simply never settles — so surface it rather than let the
    // page sit there looking hung.
    const lost = (device as { lost?: Promise<{ reason?: string; message?: string }> }).lost;
    if (lost !== undefined) {
      void lost.then((detail) => {
        onDeviceLost(`${detail?.reason ?? "unknown"}: ${detail?.message ?? "no detail"}`);
      });
    }
    return { device, info, label: describeAdapter(info) };
  } catch (err) {
    return { error: `requestDevice() failed: ${errText(err)}` };
  }
}

// -- terrain: heightfield via the core fields API (no graph) ---------------

const terrainGeo = new PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGS, TERRAIN_SEGS);
terrainGeo.rotateX(-Math.PI / 2);
const terrainMesh = new Mesh(
  terrainGeo,
  new MeshStandardNodeMaterial({ vertexColors: true, roughness: 1 }),
);

function heightField(s: number): Field {
  const base = fbm(perlinNoise, { seed: hashCombine(s, 1), frequency: 0.012, octaves: 5 });
  return mul(remap(base, -1, 1, 0, 1), HEIGHT_SCALE);
}

const lowColor = new Color(0x37503a);
const highColor = new Color(0x6d6f66);
const steepColor = new Color(0x565149);

/** Displace terrain vertices by the heightfield and recolor by height/slope. */
function rebuildTerrain(s: number): void {
  const pos = terrainGeo.getAttribute("position");
  const n = pos.count;
  // A point cloud of the vertex positions is the evaluation domain: this
  // is the fields API working directly on data, outside any graph.
  const cloud = createPointCloud(n);
  const P = cloud.attrs.point.require("P").data;
  for (let i = 0; i < n; i++) {
    P[i * 3] = pos.getX(i);
    P[i * 3 + 1] = 0;
    P[i * 3 + 2] = pos.getZ(i);
  }
  const heights = evaluateField(heightField(s), { geo: cloud, domain: "point", seed: 0 });
  for (let i = 0; i < n; i++) pos.setY(i, heights.data[i]);
  pos.needsUpdate = true;
  terrainGeo.computeVertexNormals();

  const normal = terrainGeo.getAttribute("normal");
  let colorAttr = terrainGeo.getAttribute("color") as BufferAttribute | undefined;
  if (!colorAttr) {
    colorAttr = new BufferAttribute(new Float32Array(n * 3), 3);
    terrainGeo.setAttribute("color", colorAttr);
  }
  const c = new Color();
  for (let i = 0; i < n; i++) {
    const t = Math.min(Math.max(heights.data[i] / HEIGHT_SCALE, 0), 1);
    const slope = 1 - normal.getY(i);
    c.copy(lowColor).lerp(highColor, t);
    c.lerp(steepColor, Math.min(slope * 2.2, 1));
    colorAttr.setXYZ(i, c.r, c.g, c.b);
  }
  colorAttr.needsUpdate = true;
  terrainGeo.computeBoundingSphere();
}

// -- graph: sample the terrain surface and filter plantable spots ----------

const graph = new Graph(seed);
const terrainIn = graph.add(dataInput);
const sample = graph.add(surfaceSample, { count: treeCount });
const heightAttr = graph.add(setAttribute, {
  name: "height",
  tupleSize: 1,
  value: component(position(), 1),
});
const slopeAttr = graph.add(setAttribute, {
  name: "slope",
  tupleSize: 1,
  value: sub(1, component(attribute("normal", 3), 1)),
});
const slopeFilter = graph.add(filterByAttribute, {
  attribute: "slope",
  comparison: "le",
  value: MAX_SLOPE,
});
const treelineFilter = graph.add(filterByAttribute, {
  attribute: "height",
  comparison: "le",
  value: TREELINE,
});
const sizeAttr = graph.add(setAttribute, {
  name: "scale",
  tupleSize: 3,
  value: (() => {
    const s = remap(randomField("size"), 0, 1, 0.6, MAX_TREE_SCALE);
    return vec(s, s, s); // one field instance, evaluated once, uniform scale
  })(),
});
// Declarative species pick: a string setAttribute selects into `values`
// per point (floor + clamp), so ~72% index 0 ("pine"), else "bush".
//
// This node is also where the device-resident run stops. A string column
// is CPU-only by construction — no resident node can produce one — so
// this `setAttribute` is not resident-capable and the chain breaks here,
// one node short of the spawn. The spawn itself is still resident, and
// still splits by `species`: the host plans the grouping and the device
// composes one buffer per asset.
const speciesAttr = graph.add(setAttribute, {
  name: "species",
  type: "string",
  values: ["pine", "bush"],
  value: ge(randomField("species"), 0.72),
});
const spawn = graph.add(spawnInstances, { assetId: "pine", assetAttr: "species" });
graph.connect(terrainIn, "out", sample, "in");
graph.connect(sample, "out", heightAttr, "in");
graph.connect(heightAttr, "out", slopeAttr, "in");
graph.connect(slopeAttr, "out", slopeFilter, "in");
graph.connect(slopeFilter, "out", treelineFilter, "in");
graph.connect(treelineFilter, "out", sizeAttr, "in");
graph.connect(sizeAttr, "out", speciesAttr, "in");
graph.connect(speciesAttr, "out", spawn, "in");
graph.output(spawn, "instances", "instances");

// -- scene -----------------------------------------------------------------
//
// Built here rather than through `shared/scene.ts`: the device path needs
// a `WebGPURenderer` constructed with our own `GPUDevice`, and the shared
// factory owns a `WebGLRenderer` for the other examples. The look (dark
// background, fog, hemisphere + sun) is the shared one, copied.

const scene = new Scene();
scene.background = new Color(BACKGROUND);
scene.fog = new Fog(BACKGROUND, 140, 460);
const camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1200);
camera.position.set(120, 90, 120);
camera.lookAt(0, 0, 0);
scene.add(new HemisphereLight(0xa8bce0, 0x232a33, 0.9));
const sun = new DirectionalLight(0xfff1dc, 1.6);
sun.position.set(60, 90, 35);
scene.add(sun);
scene.add(terrainMesh);

const instGroup = new Group();
scene.add(instGroup);

// -- assets ----------------------------------------------------------------
//
// Node materials, not legacy ones: the device path renders through TSL
// (`storage(instanceMatrix, "mat4", n).element(instanceIndex)`), so the
// material must be a NodeMaterial for the instance-matrix node to be
// built at all. They render unchanged on the WebGL2 fallback, which is
// what lets the degraded page look like the real one.
//
// Two material sets over shared geometry, split by *attribute shape*
// rather than by mode: a material carries its built node program, and
// the two kinds of mesh reach three through different instance-matrix
// nodes — a storage attribute on one side, an ordinary instanced
// attribute on the other — so neither set ever has its instancing shape
// swapped underneath it when the toggle flips.

const pineGeo = mergeGeometries(
  [
    new CylinderGeometry(0.14, 0.2, 1.2, 6).translate(0, 0.6, 0),
    new ConeGeometry(1.0, 2.8, 8).translate(0, 2.4, 0),
  ],
  true,
);
const bushGeo = new SphereGeometry(0.62, 7, 5).scale(1, 0.72, 1).translate(0, 0.4, 0);

function makeAssets(): AssetMap {
  return {
    pine: {
      geometry: pineGeo,
      material: [
        new MeshStandardNodeMaterial({ color: 0x6e4a2f, roughness: 1 }),
        new MeshStandardNodeMaterial({ color: 0x2f6b3c, roughness: 0.9 }),
      ],
    },
    bush: {
      geometry: bushGeo,
      material: new MeshStandardNodeMaterial({ color: 0x4c7a3d, roughness: 0.9 }),
    },
  };
}
/** Used only by `createWebGpuInstanceAdapter` — storage attributes only. */
const residentAssets = makeAssets();
/** Used only by `toInstancedMeshes` — ordinary instanced attributes only. */
const cpuAssets = makeAssets();

// -- out-of-band bounds ----------------------------------------------------

/**
 * `InstancedMesh.computeBoundingSphere()` cannot be used on the device
 * path — it loops over CPU instance matrices that were never composed —
 * so the sphere is derived instead, per asset (the adapter asks once per
 * batch, so a pine batch is not culled by a bush's radius).
 *
 * Instance origins are the sampled surface points: |x|, |z| ≤
 * TERRAIN_SIZE/2, and y ∈ [0, TREELINE] because the treeline filter is
 * `height ≤ TREELINE` and the heightfield remaps into [0, HEIGHT_SCALE].
 * Around each origin the asset reaches `maxVertexDistance × the largest
 * `scale` the remap can emit` — no rotation is applied, and a uniform
 * scale cannot widen it further. Rounded up, because over-covering only
 * loosens the frustum test while a sphere that is too small silently
 * culls geometry that is on screen.
 */
function assetExtent(geometry: BufferGeometry): number {
  geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere;
  const reach = sphere === null ? 0 : sphere.center.length() + sphere.radius;
  return Math.ceil(reach * MAX_TREE_SCALE);
}
const SPAWN_CENTER: readonly [number, number, number] = [0, TREELINE / 2, 0];
const SPAWN_SPREAD = Math.hypot(TERRAIN_SIZE / 2, TERRAIN_SIZE / 2, TREELINE / 2);
const ASSET_RADIUS: Record<string, number> = {
  pine: assetExtent(pineGeo),
  bush: assetExtent(bushGeo),
};

function spawnBounds(assetId: string): DeviceCellBounds {
  return {
    center: SPAWN_CENTER,
    // Unknown ids never reach here (the adapter rejects them first), but
    // a missing radius must not shrink the sphere.
    radius: SPAWN_SPREAD + (ASSET_RADIUS[assetId] ?? Math.max(...Object.values(ASSET_RADIUS))),
  };
}

/** The forest is one spawn, not a streamed grid; the adapter still wants a label. */
const SPAWN_CELL: CellCoord = [0, 0];

// -- gpu rig ---------------------------------------------------------------

let renderer: WebGPURenderer | undefined;
let controls: OrbitControls | undefined;
let backendLabel = "…";
let adapterLabel = "…";
/** `deviceInstances: true` — `spawnInstances` is a resident terminal. */
let residentEval: GpuFieldEvaluator | undefined;
/** Same device, no resident terminals — the spawn materialises to the CPU. */
let cpuEval: GpuFieldEvaluator | undefined;
/** Present only when the renderer shares our device and the seam holds. */
let deviceAdapter: WebGpuInstanceAdapter | undefined;
/** Why the device path is not offered, in the viewer's words. */
let residentBlocker: string | undefined;
let deviceLost = false;
let deviceLostDetail = "";

/**
 * Both paths cook on the same device, so a loss ends both of them — the
 * CPU path composes matrices in JS but still resolves its fields on the
 * device. Nothing can be rebuilt until the page reloads, and the panel
 * says so rather than leaving a live-looking button.
 */
function deviceLostStatus(): string {
  return `device lost (${deviceLostDetail}) — both paths are disabled; reload for a fresh device`;
}

function residentAvailable(): boolean {
  return residentEval !== undefined && deviceAdapter !== undefined && !deviceLost;
}

// -- drawn state -----------------------------------------------------------

/** Meshes built by `toInstancedMeshes` (CPU path). */
let cpuMeshes: InstancedMesh[] = [];
/** Objects built by the WebGPU adapter (device path). */
let deviceObjects: Object3D[] = [];
/**
 * Device batches currently on screen. Nothing memoizes a device-resident
 * spawner's handles — the cook's caller owns every one it receives — so
 * this list is the demo's ownership record and every entry is disposed
 * before the next draw replaces it.
 */
let heldBatches: readonly DeviceInstanceBatch[] = [];

let liveInstances = 0;
let liveBatches = 0;
let livePine = 0;
let liveBush = 0;
let liveDeviceBuffers = 0;
let liveDeviceBytes = 0;

/** Cumulative, across path switches — the whole point of the comparison. */
let avoidedCount = 0;
let avoidedBytes = 0;
let uploadedCount = 0;
let uploadedBytes = 0;

/** Counters from the most recent cook that had a GPU resolver. */
let lastGpu: GpuCookStats | undefined;

function clearDrawn(): void {
  for (const m of cpuMeshes) {
    instGroup.remove(m);
    m.dispose();
  }
  cpuMeshes = [];
  for (const o of deviceObjects) {
    instGroup.remove(o);
    deviceAdapter?.release(o);
  }
  deviceObjects = [];
  // `dispose()` is idempotent, so this is safe on every path — including
  // after a device loss, where the buffers are gone already.
  for (const b of heldBatches) b.transforms.dispose();
  heldBatches = [];
  liveInstances = 0;
  liveBatches = 0;
  livePine = 0;
  liveBush = 0;
  liveDeviceBuffers = 0;
  liveDeviceBytes = 0;
}

function countSpecies(assetId: string, n: number): void {
  if (assetId === "pine") livePine += n;
  else if (assetId === "bush") liveBush += n;
}

/**
 * Draw device batches, and tally the matrix bytes that never crossed the
 * bus.
 *
 * `transforms.byteLength` is the logical size of the matrix buffer that
 * stayed on the device — `count * 64` — which is exactly what the CPU
 * path composes in JS and uploads instead. So the two tallies measure the
 * same quantity on opposite sides of the bus, which is what makes them
 * comparable.
 *
 * It is *not* the readback the device path also avoids: that would be the
 * run's written columns, and the run writes none (a spawner only reads).
 * With the spawner's `points` pin unconnected and undeclared, the run
 * performs no readback at all.
 */
function drawDevice(batches: readonly DeviceInstanceBatch[], adapter: WebGpuInstanceAdapter): void {
  heldBatches = batches;
  try {
    for (const batch of batches) {
      const object = adapter.build(batch, {
        levelName: "forest",
        coord: SPAWN_CELL,
        bounds: spawnBounds(batch.assetId),
      });
      deviceObjects.push(object);
      instGroup.add(object);
      liveInstances += batch.count;
      liveBatches++;
      countSpecies(batch.assetId, batch.count);
      liveDeviceBuffers++;
      liveDeviceBytes += batch.transforms.byteLength;
      avoidedCount++;
      avoidedBytes += batch.transforms.byteLength;
    }
  } catch (err) {
    // A partial build owns handles nothing else will ever release.
    clearDrawn();
    throw err;
  }
}

/** Draw CPU batches, and tally the matrix bytes that were uploaded. */
function drawCpu(item: InstancesItem): void {
  const batches = item.batches;
  cpuMeshes = toInstancedMeshes(batches, cpuAssets);
  for (const m of cpuMeshes) instGroup.add(m);
  for (const batch of batches) {
    liveInstances += batch.count;
    liveBatches++;
    countSpecies(batch.assetId, batch.count);
    uploadedCount++;
    uploadedBytes += batch.transforms.byteLength;
  }
}

// -- overlay ---------------------------------------------------------------

const overlay = createOverlay({
  title: "02 · forest",
  info:
    "fbm heightfield → fromBufferGeometry → surfaceSample → height/slope attrs → filters → " +
    "pine/bush instances. On the device path the spawn composes one matrix buffer per species " +
    "in a WGSL kernel and the renderer draws straight from them.",
});

const style = document.createElement("style");
style.textContent = `
.pcg02-seg { display: flex; gap: 6px; margin: 4px 0 4px; }
.pcg02-seg button {
  flex: 1; padding: 6px 4px; cursor: pointer; border-radius: 6px;
  border: 1px solid #33405a; background: #161d29; color: #aeb9c9;
  font: 12px system-ui, sans-serif;
}
.pcg02-seg button:hover:not(:disabled) { border-color: #4c8dff; color: #dbe4f0; }
.pcg02-seg button[aria-pressed="true"] { background: #1d3a6b; border-color: #4c8dff; color: #eaf2ff; }
.pcg02-seg button:disabled { opacity: 0.4; cursor: not-allowed; }
.pcg02-hint { margin: 0 0 10px; color: #6f7c8f; font-size: 11px; }
.pcg02-hud {
  position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 10;
  max-width: max(240px, min(680px, calc(100vw - 360px))); padding: 8px 14px; box-sizing: border-box;
  text-align: center; border-radius: 8px;
  background: rgba(13, 17, 23, 0.84); border: 1px solid #2a3548;
  color: #aeb9c9; font: 12px/1.55 system-ui, sans-serif; backdrop-filter: blur(6px);
}
.pcg02-hud b { color: #8fd0ff; font-weight: 600; }
.pcg02-hud .pcg02-keys { color: #6f7c8f; }
.pcg02-hud.pcg02-warn { border-color: #7a4a2a; color: #ffd8b4; }
.pcg02-hud.pcg02-warn b { color: #ffb066; }
`;
document.head.appendChild(style);

/**
 * The shared overlay factory has no button control, and it is shared, so
 * this example adds its own rows into the same controls container rather
 * than growing the shared surface for one page.
 */
const statsEl = overlay.el.querySelector(".pcg-stats");
const controlsEl = (statsEl?.previousElementSibling as HTMLElement | null) ?? overlay.el;

const seg = document.createElement("div");
seg.className = "pcg02-seg";
const btnDevice = document.createElement("button");
btnDevice.type = "button";
btnDevice.textContent = "device-resident";
const btnCpu = document.createElement("button");
btnCpu.type = "button";
btnCpu.textContent = "CPU readback";
seg.append(btnDevice, btnCpu);

const hint = document.createElement("p");
hint.className = "pcg02-hint";
hint.textContent = "G switches path · drag to orbit";
controlsEl.prepend(seg, hint);

overlay.addSeed(seed, (s) => {
  seed = s;
  regenerate();
});
overlay.addSlider(
  "tree density",
  { min: 1000, max: 24000, step: 500, value: treeCount, format: (v) => String(v) },
  (v) => {
    treeCount = v;
    graph.setParam(sample, "count", treeCount);
    recook();
  },
);

const statAdapter = overlay.addStat("renderer");
const statFps = overlay.addStat("fps");
const statBatches = overlay.addStat("live batches (pine/bush)");
const statDrawn = overlay.addStat("instances drawn");
const statDeviceBytes = overlay.addStat("matrices held on device");
const statAvoided = overlay.addStat("matrix uploads avoided");
const statUploaded = overlay.addStat("matrices uploaded");
const statFused = overlay.addStat("resident runs / fused members");
const statDispatches = overlay.addStat("device dispatches");
const statFallbacks = overlay.addStat("gpu fallbacks");
const statCook = overlay.addStat("cook");
const statCache = overlay.addStat("nodes cooked/cached");
const statStatus = overlay.addStat("status");
statStatus("initialising…");

const why = overlay.addCollapsible("why one fused member");
why.textContent = [
  "A device-resident run is a maximal linear chain of resident-capable",
  "nodes. This graph's chain is one node long:",
  "",
  "  surfaceSample        cpu     changes the point count — never a member",
  "  setAttribute height  cpu     code-authored field: no FieldSpec to lower",
  "  setAttribute slope   cpu     code-authored field: no FieldSpec to lower",
  "  filterByAttribute    cpu     changes the point count — never a member",
  "  filterByAttribute    cpu     changes the point count — never a member",
  "  setAttribute scale   cpu     code-authored field: no FieldSpec to lower",
  '  setAttribute species cpu     string column: NOT resident-capable at all',
  "  spawnInstances       DEVICE  the run — 1 member, 1 dispatch per species",
  "",
  "The chain break that matters is the last one. No resident node can",
  "produce a string attribute, so `setAttribute(\"species\")` cannot join a",
  "run, and the run therefore starts and ends at the spawn.",
  "",
  "The two rows above it are worth reading against `gpu fallbacks`: the",
  "height and slope setAttributes ARE resident-capable and do form a",
  "two-node chain, which is then rejected at plan time because their",
  "fields carry no FieldSpec to lower into WGSL. That is the",
  "`run-plan-failed` you see; the `no-spec` counts are the same fields",
  "falling back again on the per-node path.",
  "",
  "That does not cost the spawn its residency, and it does not cost",
  "`species` its meaning: the host plans the grouping from the string",
  "column it already holds, uploads a permutation, and the device",
  "composes one buffer per asset. `resident runs / fused members` reads",
  "1 / 1 because that is the truth — and `device dispatches` counts one",
  "compose per species, not one per member.",
].join("\n");

overlay.addNote(
  "Trees avoid steep slopes and high altitude. Density counts candidates before filtering. " +
    "Every instance is a 4x4 matrix: 64 bytes. On the device path those bytes are written once, " +
    "on the device, and the renderer draws from that same buffer — `matrix uploads avoided` " +
    "counts the matrix buffers that never crossed the bus. On the CPU path the same bytes are " +
    "composed in JS and uploaded, and `matrices uploaded` climbs by exactly the same arithmetic " +
    "instead. Both totals survive a switch, so you can recook a few times on each and compare. " +
    "`resident runs / fused members` is `CookStats.gpu.residentRuns / fusedNodes` verbatim — the " +
    "same counters 08 · gpu fields shows as “fused nodes”.",
);

const hud = document.createElement("div");
hud.className = "pcg02-hud";
document.body.appendChild(hud);

function setStatus(message: string): void {
  statStatus(message);
}

/**
 * Library error messages (and three's seam errors) do not end in a full
 * stop; the banner runs them into the next sentence, so give them one.
 */
function sentence(s: string): string {
  return /[.!?]$/.test(s.trim()) ? s : `${s.trim()}.`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

/**
 * The mode the last cook actually *drew* on, which is not always the
 * requested one — a resident run can be rejected at plan time and arrive
 * as CPU batches. Undefined until the first cook has drawn something.
 */
let drawnMode: PathMode | undefined;

function paintMode(): void {
  const canDevice = residentAvailable();
  btnDevice.disabled = !canDevice;
  // The CPU path cooks on the same device (only the spawner terminal
  // differs), so a loss takes it down too.
  btnCpu.disabled = deviceLost;
  btnDevice.setAttribute("aria-pressed", String(mode === "device" && canDevice));
  btnCpu.setAttribute("aria-pressed", String(mode !== "device" || !canDevice));
  if (!canDevice && residentBlocker !== undefined) btnDevice.title = residentBlocker;
  if (deviceLost) {
    btnDevice.title = deviceLostStatus();
    btnCpu.title = deviceLostStatus();
  }

  hud.classList.toggle("pcg02-warn", !canDevice);
  if (deviceLost) {
    hud.innerHTML =
      "<b>WebGPU device lost.</b> Rendering has stopped — reload the page for a fresh device.";
    return;
  }
  if (!canDevice) {
    hud.innerHTML =
      `<b>CPU readback</b> — ${escapeHtml(sentence(residentBlocker ?? "the device path is unavailable"))} ` +
      "The forest still grows and renders; its matrices are composed in JS and uploaded." +
      ' <span class="pcg02-keys">drag to orbit</span>';
    return;
  }
  if (mode === "device" && drawnMode === "cpu") {
    // Requested the device path and got CPU batches back: the run was
    // rejected at plan time (over the resident byte budget, a param the
    // planner cannot lower, ...). `gpu fallbacks` in the panel names the
    // reason; the page draws either way.
    hud.classList.add("pcg02-warn");
    hud.innerHTML =
      "<b>device path requested, CPU batches delivered</b> — the resident run was rejected at " +
      "plan time, so the spawner materialised instead. See <code>gpu fallbacks</code> in the " +
      "panel for the machine-readable reason." +
      ' <span class="pcg02-keys">G to compare · drag to orbit</span>';
    return;
  }
  // `mode`, not `drawnMode`: before the first cook the requested path is
  // what is about to happen, and the rejected case above already owns the
  // one situation where the two disagree.
  hud.innerHTML =
    mode === "device"
      ? "<b>device-resident</b> — the spawn composes one matrix buffer per species in a WGSL " +
        "kernel and the renderer draws from them. Nothing is read back and nothing is uploaded. " +
        "The run is <b>one member deep</b>: the string <code>species</code> attribute breaks the " +
        "chain right before the spawn." +
        ' <span class="pcg02-keys">G to compare · drag to orbit</span>'
      : "<b>CPU readback</b> — the same graph, the same fields on the same device, but the " +
        "spawner materialises: matrices are composed in JS and uploaded per batch." +
        ' <span class="pcg02-keys">G to compare · drag to orbit</span>';
}

function setMode(next: PathMode): void {
  if (deviceLost) {
    // Both buttons are disabled, but the keyboard shortcut is not.
    setStatus(deviceLostStatus());
    return;
  }
  if (next === mode) return;
  if (next === "device" && !residentAvailable()) {
    setStatus("device path unavailable — see the banner at the bottom of the page");
    return;
  }
  // Leaving a path for good: drop that evaluator's idle buffer pool.
  // (`dispose()` destroys pooled buffers only; the evaluator stays
  // usable, and buffers still in use are untouched.)
  const leaving = mode === "device" ? residentEval : cpuEval;
  mode = next;
  leaving?.dispose();
  paintMode();
  recook();
}
btnDevice.addEventListener("click", () => setMode("device"));
btnCpu.addEventListener("click", () => setMode("cpu"));
window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  if (target !== null && (target.tagName === "INPUT" || target.tagName === "SELECT")) return;
  if (e.key.toLowerCase() === "g") {
    setMode(mode === "device" ? "cpu" : "device");
    e.preventDefault();
  }
});

function onDeviceLost(detail: string): void {
  deviceLost = true;
  deviceLostDetail = detail;
  // Release through the adapter before dropping it, so its stats stay
  // honest and every mesh is torn down rather than merely unparented.
  clearDrawn();
  deviceAdapter = undefined;
  setStatus(deviceLostStatus());
  console.error(`02-forest: WebGPU device lost — ${detail}`);
  paintMode();
}

// -- cook ------------------------------------------------------------------

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function fmtCount(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtFallbacks(fallbacks: Record<string, number>): string {
  const entries = Object.entries(fallbacks).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "none";
  return entries.map(([reason, n]) => `${reason} ×${n}`).join(", ");
}

function paintStats(): void {
  statBatches(`${liveBatches} · ${fmtCount(livePine)} / ${fmtCount(liveBush)}`);
  statDrawn(fmtCount(liveInstances));
  statDeviceBytes(`${liveDeviceBuffers} buf · ${fmtBytes(liveDeviceBytes)}`);
  statAvoided(`${fmtCount(avoidedCount)} buf · ${fmtBytes(avoidedBytes)}`);
  statUploaded(`${fmtCount(uploadedCount)} buf · ${fmtBytes(uploadedBytes)}`);
  if (lastGpu === undefined) {
    statFused("– (no GPU resolver)");
    statDispatches("–");
    statFallbacks("–");
    return;
  }
  statFused(`${lastGpu.residentRuns} / ${lastGpu.fusedNodes}`);
  statDispatches(String(lastGpu.dispatches));
  statFallbacks(fmtFallbacks(lastGpu.fallbacks));
}

const recook = makeRecooker(async () => {
  if (deviceLost) return;
  const useDevice = mode === "device" && residentAvailable();
  const adapter = deviceAdapter;
  // Both paths still resolve their fields on the device when there is
  // one; only the spawner terminal's residency differs. With no WebGPU
  // at all the resolver is absent and the whole cook is JS.
  const resolver = useDevice ? residentEval : cpuEval;
  setStatus("cooking…");
  try {
    // Budgeted: the cook yields to the event loop rather than blocking
    // the main thread long enough to trip the browser's GPU watchdog.
    const result = await cook(graph, {
      budgetMs: BUDGET_MS,
      ...(resolver !== undefined ? { gpu: resolver } : {}),
    });
    const item = result.outputs.instances.find((i): i is InstancesItem => i.kind === "instances");
    lastGpu = result.stats.gpu;
    if (item === undefined) {
      setStatus("cook produced no instances item");
      paintStats();
      return;
    }
    // Never touch `item.batches` before this check: on a device-resident
    // item the getter throws by design, because those matrices were
    // never composed on the CPU.
    const device = item.deviceBatches;
    clearDrawn();
    if (device !== undefined && adapter !== undefined) {
      drawDevice(device, adapter);
      drawnMode = "device";
    } else if (device !== undefined) {
      // Device batches with no adapter to draw them: an impossible state
      // (the resident evaluator is only ever selected alongside one),
      // but owning handles nothing can render is a leak, so free them.
      for (const b of device) b.transforms.dispose();
      setStatus("device batches arrived with no adapter to bind them — nothing drawn");
      paintStats();
      return;
    } else {
      drawCpu(item);
      drawnMode = "cpu";
    }

    statCook(`${result.stats.elapsedMs.toFixed(1)} ms`);
    statCache(`${result.stats.cooked} / ${result.stats.cached}`);
    paintStats();
    setStatus(statusLine());
    paintMode();
  } catch (err) {
    // A device loss reports itself; anything else must not leave the
    // panel reading "cooking…" forever, which is what a hang looks like.
    if (deviceLost) return;
    setStatus(`cook failed: ${errText(err)}`);
    console.error("02-forest: cook failed:", err);
  }
});

function statusLine(): string {
  if (drawnMode === "device") return "device-resident · no matrix readback";
  if (mode === "device" && residentAvailable()) {
    return "resident run rejected · CPU batches drawn";
  }
  return residentAvailable()
    ? "CPU readback · matrices composed in JS"
    : "CPU readback · device path unavailable";
}

function regenerate(): void {
  rebuildTerrain(seed);
  graph.setParam(terrainIn, "items", [makeGeometryItem(fromBufferGeometry(terrainGeo))]);
  graph.setSeed(seed);
  recook();
}

// -- probe -----------------------------------------------------------------

/**
 * Console hook for verifying the claim rather than taking it on trust:
 * for the first drawn mesh it reports the CPU matrix array length (0 on
 * the device path — the matrices were never composed), the instance count
 * three will draw, and whether the attribute is a storage attribute.
 * `fusedMembers` is the counter the panel shows, so a reader can confirm
 * the "one member" claim from the console too.
 */
interface ForestProbe {
  mode: PathMode | null;
  requestedMode: PathMode;
  backend: string;
  blocker: string | null;
  batches: number;
  meshes: number;
  cpuMatrixFloats: number | null;
  instanceCount: number | null;
  isStorageAttribute: boolean | null;
  boundingSphereRadius: number | null;
  deviceBuffers: number;
  deviceBytes: number;
  matrixUploadsAvoided: number;
  bytesAvoided: number;
  matricesUploaded: number;
  bytesUploaded: number;
  residentRuns: number | null;
  fusedMembers: number | null;
  dispatches: number | null;
  fallbacks: Record<string, number> | null;
}

(window as unknown as { pcgForest: unknown }).pcgForest = {
  probe(): ForestProbe {
    const out: ForestProbe = {
      mode: drawnMode ?? null,
      requestedMode: mode,
      backend: backendLabel,
      blocker: residentBlocker ?? null,
      batches: liveBatches,
      meshes: 0,
      cpuMatrixFloats: null,
      instanceCount: null,
      isStorageAttribute: null,
      boundingSphereRadius: null,
      deviceBuffers: liveDeviceBuffers,
      deviceBytes: liveDeviceBytes,
      matrixUploadsAvoided: avoidedCount,
      bytesAvoided: avoidedBytes,
      matricesUploaded: uploadedCount,
      bytesUploaded: uploadedBytes,
      residentRuns: lastGpu?.residentRuns ?? null,
      fusedMembers: lastGpu?.fusedNodes ?? null,
      dispatches: lastGpu?.dispatches ?? null,
      fallbacks: lastGpu === undefined ? null : { ...lastGpu.fallbacks },
    };
    for (const child of instGroup.children) {
      const mesh = child as InstancedMesh & { isInstancedMesh?: boolean };
      if (mesh.isInstancedMesh !== true) continue;
      out.meshes++;
      if (out.cpuMatrixFloats !== null) continue;
      const attr = mesh.instanceMatrix as unknown as {
        array: ArrayLike<number>;
        isStorageInstancedBufferAttribute?: boolean;
      };
      out.cpuMatrixFloats = attr.array.length;
      out.instanceCount = mesh.count;
      out.isStorageAttribute = attr.isStorageInstancedBufferAttribute === true;
      out.boundingSphereRadius = mesh.boundingSphere?.radius ?? null;
    }
    return out;
  },
};

// -- boot ------------------------------------------------------------------

const fps = createFpsMeter((v) => statFps(v));

function frame(): void {
  // A lost device cannot render and cannot cook; the panel and the banner
  // say so, and the loop stops rather than spinning on errors.
  if (deviceLost) return;
  requestAnimationFrame(frame);
  fps();
  controls?.update();
  renderer?.render(scene, camera);
}

async function boot(): Promise<void> {
  const probe = await requestDevice();
  let device: GpuDeviceLike | undefined;
  let info: GpuAdapterInfoLike | undefined;
  if ("error" in probe) {
    residentBlocker = probe.error;
    adapterLabel = "no WebGPU adapter";
  } else {
    device = probe.device;
    info = probe.info;
    adapterLabel = probe.label;
  }

  // One device, two consumers: a WebGPU buffer cannot be shared across
  // devices, so if three ever stopped honouring `parameters.device` the
  // evaluator's batches would be unbindable. Check it rather than assume
  // it — and keep a renderer either way, so the CPU path always draws.
  let gl: WebGPURenderer | undefined;
  if (device !== undefined) {
    try {
      const shared = new WebGPURenderer({ device, antialias: true });
      await shared.init();
      gl = shared;
      if ((shared.backend as unknown as { device?: unknown }).device !== device) {
        residentBlocker =
          "the renderer did not adopt the supplied GPUDevice (`renderer.backend.device` is a " +
          "different device), so buffers written by the field evaluator cannot be bound.";
      }
    } catch (err) {
      residentBlocker = `the renderer failed to initialise on the shared device: ${errText(err)}`;
      console.warn("02-forest: shared-device renderer failed:", err);
    }
  }
  if (gl === undefined) {
    // No device, or the shared-device renderer threw. three falls back to
    // a WebGL2 backend on its own when WebGPU is unavailable, so the CPU
    // path still draws.
    const plain = new WebGPURenderer({ antialias: true });
    await plain.init();
    gl = plain;
  }
  const active: WebGPURenderer = gl;
  renderer = active;
  backendLabel =
    (active.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend === true
      ? "webgpu"
      : "webgl2";

  if (device !== undefined) {
    const base = info !== undefined ? { adapterInfo: info } : {};
    residentEval = new GpuFieldEvaluator(device, { ...base, deviceInstances: true });
    cpuEval = new GpuFieldEvaluator(device, base);
  }
  if (device !== undefined && residentBlocker === undefined) {
    try {
      // Throws with a specific message if three's adoption seam has
      // moved; that message is what the viewer gets to see.
      deviceAdapter = await createWebGpuInstanceAdapter({
        renderer: active,
        assets: residentAssets,
      });
    } catch (err) {
      residentBlocker = `device instances are unavailable: ${errText(err)}`;
      console.warn("02-forest: device instance adapter unavailable:", err);
    }
  }

  statAdapter(`${adapterLabel} · ${backendLabel}`);
  if (!residentAvailable()) {
    mode = "cpu";
    console.info(`02-forest: device path unavailable — ${residentBlocker ?? "unknown reason"}`);
  } else {
    console.info(
      `02-forest: WebGPU ready — ${adapterLabel}; ` +
        `residentTerminals=[${residentEval?.residentTerminals.join(", ") ?? ""}]`,
    );
  }

  const canvas = active.domElement;
  canvas.style.display = "block";
  document.body.appendChild(canvas);
  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.update();

  const resize = (): void => {
    active.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    active.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();

  paintMode();
  paintStats();
  regenerate();
  requestAnimationFrame(frame);
}

void boot().catch((err: unknown) => {
  setStatus(`boot failed: ${errText(err)}`);
  console.error("02-forest: boot failed:", err);
});
