/**
 * 09 — gpu world: a streamed world drawn from matrices that never leave
 * the GPU.
 *
 * A `World` streams cells around a flying camera. Every cell's graph ends
 * in `spawnInstances`, and the same graph can end two different ways:
 *
 * - **device-resident** — one `GPUDevice` backs both halves. The
 *   `GpuFieldEvaluator` (constructed with `deviceInstances: true`)
 *   composes the cell's 4x4s in a WGSL kernel and hands back a retained
 *   device buffer; a `WebGPURenderer` created with `{ device }` adopts
 *   that same buffer as a storage instance attribute through
 *   `createWebGpuInstanceAdapter`. No readback, no `Float32Array` of
 *   matrices, no `instanceMatrix` upload.
 * - **CPU readback** — the same graph, the same device, the same fields,
 *   but an evaluator without `deviceInstances`. `spawnInstances` is then
 *   no longer a resident terminal, so the run materialises its columns
 *   back to the CPU, JS composes the matrices, and `toInstancedMeshes`
 *   uploads them per cell.
 *
 * The toggle switches between them live, so the cost of the readback is
 * something you can watch appear and disappear rather than take on
 * trust. Both paths are budgeted (`update({ budgetMs })`), which matters
 * more than it looks: a long synchronous cook can trip the browser's
 * watchdog and cost the page its WebGPU device, and a lost device leaves
 * in-flight readbacks pending forever. `device.lost` is therefore
 * surfaced in the panel instead of being allowed to look like a hang.
 *
 * Without WebGPU — or with a renderer that will not share our device —
 * the page says exactly what was missing and runs the CPU path, so it
 * still renders.
 */
import { World, hashCombine, type CellCoord, type CellOutputs, type Graph } from "pcg-ts";
import { GpuFieldEvaluator, type GpuAdapterInfoLike, type GpuDeviceLike } from "pcg-ts/gpu";
import {
  WorldThreeBinding,
  createWebGpuInstanceAdapter,
  type AssetMap,
  type DeviceCellBounds,
  type WebGpuInstanceAdapter,
} from "pcg-ts/three";
import {
  AmbientLight,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  type InstancedMesh,
} from "three";
import { MeshStandardNodeMaterial, WebGPURenderer } from "three/webgpu";
import { createFpsMeter } from "../../shared/fps.js";
import { NARROW_MEDIA_QUERY } from "../../shared/mobile.js";
import { createOverlay } from "../../shared/overlay.js";
import { attachGraphPanel, type GraphPanelHandle } from "../../shared/graph/panel.js";
import { attachWordmark } from "../../shared/wordmark.js";
import { FINE_CELL, MAX_SCALE_TALL, MAX_SCALE_WIDE, makeSpireLevel } from "./levels.js";

// -- tunables --------------------------------------------------------------

/** Which end the instance matrices are composed at. */
type PathMode = "device" | "cpu";

let seed = 1;
let speed = 26;
let radius = 150;
let perCell = 140;
let autopilot = true;
let mode: PathMode = "device";

/** Per-update cook budget. See the file header: this is load-bearing. */
const BUDGET_MS = 6;
/** Hard cap on cells cooked per update, so one update can never run long. */
const MAX_COOKS_PER_UPDATE = 4;
/** An update in flight longer than this is reported as stalled. */
const STALL_MS = 5000;

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

// -- scene -----------------------------------------------------------------

const scene = new Scene();
scene.fog = new Fog(0x0d1117, 120, 620);
const camera = new PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 1600);
camera.position.set(0, 22, 0);

scene.add(new AmbientLight(0x8fa8d0, 1.1));
const sun = new DirectionalLight(0xfff0d8, 2.4);
sun.position.set(60, 120, 40);
scene.add(sun);

const groundMat = new MeshStandardNodeMaterial({ color: 0x141c29, roughness: 1 });
const ground = new Mesh(new PlaneGeometry(4000, 4000), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
scene.add(ground);

/**
 * Node materials, not legacy ones: the device path renders through TSL
 * (`storage(instanceMatrix, "mat4", n).element(instanceIndex)`), so the
 * material must be a NodeMaterial for the instance-matrix node to be
 * built at all. They also render unchanged on the WebGL2 fallback, which
 * is what lets the degraded page look like the real one.
 *
 * Two material instances over shared geometry, split by *attribute
 * shape* rather than by mode. A material carries its built node program,
 * and the two kinds of mesh reach three through different
 * instance-matrix nodes — a storage attribute on one side, an ordinary
 * instanced attribute on the other — so neither material ever has its
 * instancing shape swapped underneath it.
 *
 * The split is not simply "device mode vs CPU mode": a cell in device
 * mode whose resident run is rejected (over the resident byte budget,
 * say) still arrives as CPU batches, and `WorldThreeBinding` renders
 * those through `toInstancedMeshes` with the binding's own asset map.
 * So the binding always gets `cpuAssets` and only the adapter — which
 * builds nothing but storage-attribute meshes — gets `residentAssets`.
 */
const SPIRE_TOP_RADIUS = 0.18;
const SPIRE_BASE_RADIUS = 0.55;
const SPIRE_HEIGHT = 2.4;
/** Translated so the origin sits at the base — the scatter point's own spot. */
const spireGeometry = new CylinderGeometry(
  SPIRE_TOP_RADIUS,
  SPIRE_BASE_RADIUS,
  SPIRE_HEIGHT,
  6,
).translate(0, SPIRE_HEIGHT / 2, 0);
function spireMaterial(): MeshStandardNodeMaterial {
  return new MeshStandardNodeMaterial({ color: 0x86d7a4, roughness: 0.7, flatShading: true });
}
/** Used only by `createWebGpuInstanceAdapter` — storage attributes only. */
const residentAssets: AssetMap = { spire: { geometry: spireGeometry, material: spireMaterial() } };
/** Used by every `WorldThreeBinding` — ordinary instanced attributes only. */
const cpuAssets: AssetMap = { spire: { geometry: spireGeometry, material: spireMaterial() } };

// -- out-of-band bounds ----------------------------------------------------

/**
 * Largest distance from an instance's origin to any of its own vertices,
 * derived rather than guessed so it stays checkable when the graph or
 * the geometry changes.
 *
 * The origin is the scatter point, at the spire's base (the geometry is
 * translated up by half its height above). The matrix is composed
 * `T · R · S` about that origin, and `R` is a rotation, so the extent is
 * `max |S · v|` over the geometry's vertices — the lean never widens it.
 * `S` is `[wide, tall, wide]`, capped by `MAX_SCALE_WIDE` /
 * `MAX_SCALE_TALL` in levels.ts, and the two candidate vertices are the
 * base rim (radius, at y = 0) and the top rim (radius, at y = height):
 *
 *   base: 0.55 · 1.885                    ≈ 1.04
 *   top:  hypot(0.18 · 1.885, 2.4 · 3.58) ≈ 8.60  ← the bound
 *
 * Rounded up, because a normalized noise band can overshoot 1 by a hair
 * and because over-covering only loosens the frustum test.
 */
const MAX_INSTANCE_RADIUS = Math.ceil(
  Math.max(
    SPIRE_BASE_RADIUS * MAX_SCALE_WIDE,
    Math.hypot(SPIRE_TOP_RADIUS * MAX_SCALE_WIDE, SPIRE_HEIGHT * MAX_SCALE_TALL),
  ),
);

/**
 * The bounding sphere the renderer culls each cell with on the device
 * path. `computeBoundingSphere()` cannot be used — it reads CPU instance
 * matrices that were never composed — so it comes from the cell AABB
 * instead: the XZ cell's centre, and a radius covering the cell's
 * diagonal, the instances' height, and the tallest instance's own
 * radius. Erring large is the safe direction; too small silently culls
 * geometry that is on screen — hence `CELL_HEIGHT` (not half of it) in
 * the diagonal, and the rounded-up instance radius.
 */
const CELL_HALF = FINE_CELL / 2;
const CELL_HEIGHT = 8;
const CELL_RADIUS =
  Math.sqrt(2 * CELL_HALF * CELL_HALF + CELL_HEIGHT * CELL_HEIGHT) + MAX_INSTANCE_RADIUS;

function cellBounds(levelName: string, coord: CellCoord): DeviceCellBounds | undefined {
  if (levelName !== "spires") return undefined;
  return {
    center: [(coord[0] + 0.5) * FINE_CELL, CELL_HEIGHT / 2, (coord[1] + 0.5) * FINE_CELL],
    radius: CELL_RADIUS,
  };
}

// -- gpu rig ---------------------------------------------------------------

let renderer: WebGPURenderer | undefined;
let backendLabel = "…";
let adapterLabel = "…";
/** `deviceInstances: true` — `spawnInstances` is a resident terminal. */
let residentEval: GpuFieldEvaluator | undefined;
/** Same device, no resident terminals — the run materialises to the CPU. */
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
 * says so rather than leaving a live-looking button that builds a world
 * which can never cook or draw.
 */
function deviceLostStatus(): string {
  return `device lost (${deviceLostDetail}) — both paths are disabled; reload for a fresh device`;
}

function residentAvailable(): boolean {
  return residentEval !== undefined && deviceAdapter !== undefined && !deviceLost;
}

/**
 * The graph behind the page, in the corner.
 *
 * One level and so one graph, and the spire count is a PARAM of it rather
 * than something bound per cell — so moving that slider rebuilds the graph
 * and the panel has to be told. It is the same shape either way; the
 * number in the box is what changes.
 */
let graphPanel: GraphPanelHandle | undefined;

function showGraph(spires: Graph): void {
  const entries = [{ name: "spires", graph: spires }];
  if (graphPanel) graphPanel.set(entries);
  else graphPanel = attachGraphPanel(entries, { into: graphSlot, title: "GPU world" });
}

// -- world lifecycle -------------------------------------------------------

function cellCap(genRadius: number, cellSize: number): number {
  const r = (genRadius * 1.25) / cellSize + 1.5;
  return Math.max(64, Math.ceil(Math.PI * r * r));
}

interface WorldRig {
  world: World;
  group: Group;
  binding: WorldThreeBinding;
  abort: AbortController;
  mode: PathMode;
  disposed: boolean;
}

let rig: WorldRig | undefined;
let updating = false;
let updateStartedAt = 0;
let lastPending = 0;

/** Live instance count per cell, so `instances drawn` works on both paths. */
const cellInstances = new Map<string, number>();
let liveInstances = 0;

/** Cumulative, across path switches — the whole point of the comparison. */
let avoidedCount = 0;
let avoidedBytes = 0;
let uploadedCount = 0;
let uploadedBytes = 0;

function cellKey(level: string, coord: CellCoord): string {
  return `${level}|${coord.join(",")}`;
}

/**
 * Count what a cell just cost, and tally the matrix bytes either way.
 *
 * Both tallies measure the *same* quantity — `count * 64` bytes of 4x4
 * matrices — on opposite sides of the bus. A device batch's
 * `transforms.byteLength` is the logical size of the matrix buffer that
 * stayed on the device and was therefore never uploaded; a CPU batch's
 * `transforms` is the `Float32Array` of exactly those bytes, composed in
 * JS and uploaded per cell. So `avoidedBytes` is the matrix upload that
 * did not happen, which is what the readout is labelled.
 *
 * It is *not* the readback the device path also avoids: that is the
 * run's written columns (`scale` f32x3 + `rot` f32x4 = 28 B/instance),
 * and it is skipped only while nothing reads the spawner's `points` pin
 * — see `materialize` in the library's run executor. This level leaves
 * that pin unconnected and undeclared, so no readback runs, but that is
 * a property of the graph rather than something these counters measure.
 */
function accountCell(level: string, coord: CellCoord, outputs: CellOutputs): void {
  let n = 0;
  for (const name of Object.keys(outputs)) {
    for (const item of outputs[name]) {
      if (item.kind !== "instances") continue;
      const device = item.deviceBatches;
      if (device !== undefined) {
        for (const b of device) {
          n += b.count;
          avoidedCount++;
          avoidedBytes += b.transforms.byteLength;
        }
      } else {
        for (const b of item.batches) {
          n += b.count;
          uploadedCount++;
          uploadedBytes += b.transforms.byteLength;
        }
      }
    }
  }
  const key = cellKey(level, coord);
  liveInstances += n - (cellInstances.get(key) ?? 0);
  cellInstances.set(key, n);
}

function forgetCell(level: string, coord: CellCoord): void {
  const key = cellKey(level, coord);
  liveInstances -= cellInstances.get(key) ?? 0;
  cellInstances.delete(key);
}

/**
 * Cells that finish cooking after their world was torn down never reach
 * the binding, so nothing else will ever retain their device handles.
 * The example is their owner by default; dropping them on the floor
 * leaks a GPU buffer per late cell, which a slider drag produces plenty
 * of. `dispose()` is idempotent, so this is safe even on the paths where
 * the handle was already released.
 */
function releaseOrphanedOutputs(outputs: CellOutputs): void {
  for (const name of Object.keys(outputs)) {
    for (const item of outputs[name]) {
      if (item.kind !== "instances") continue;
      for (const b of item.deviceBatches ?? []) b.transforms.dispose();
    }
  }
}

/** Tear a world rig down completely: scene objects, GPU handles, cooks. */
function teardown(prev: WorldRig): void {
  prev.disposed = true;
  prev.abort.abort();
  // Releases every InstancedMesh, every adapter-built object, and every
  // device transform handle the binding retained (refcounted by handle
  // identity, so a handle shared by two cells outlives the first).
  prev.binding.dispose();
  scene.remove(prev.group);
  cellInstances.clear();
  liveInstances = 0;
}

/** Slider drags fire per pixel; rebuild once the value settles. */
let rebuildTimer = 0;
function scheduleRebuild(): void {
  clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(buildWorld, 160);
}

function buildWorld(): void {
  // Nothing can cook or draw on a lost device, and the sliders and the
  // seed field still fire after one. Build nothing rather than allocate
  // a `World`, a binding and a `Group` behind a banner that says
  // rendering has stopped.
  if (deviceLost) {
    clearTimeout(rebuildTimer);
    setStatus(deviceLostStatus());
    return;
  }
  // A rebuild from any source cancels a pending debounced one; otherwise
  // a seed edit or a path switch mid-drag gets torn down again 160 ms
  // later, discarding the GPU buffers it just cooked.
  clearTimeout(rebuildTimer);
  const previousMode = rig?.mode;
  if (rig) {
    teardown(rig);
    // Leaving a path for good: drop that evaluator's idle buffer pool
    // too. (`dispose()` destroys pooled buffers only; the evaluator
    // stays usable, and buffers still in use are untouched.)
    if (previousMode !== undefined && previousMode !== mode) {
      const leaving = previousMode === "device" ? residentEval : cpuEval;
      leaving?.dispose();
    }
    rig = undefined;
  }

  const group = new Group();
  scene.add(group);

  const useDevice = mode === "device" && residentAvailable();
  const adapter = deviceAdapter;
  const binding =
    useDevice && adapter !== undefined
      ? new WorldThreeBinding({
          group,
          assets: cpuAssets,
          deviceInstances: { adapter, bounds: cellBounds },
        })
      : new WorldThreeBinding({ group, assets: cpuAssets });

  const next: WorldRig = {
    world: undefined as unknown as World,
    group,
    binding,
    abort: new AbortController(),
    mode: useDevice ? "device" : "cpu",
    disposed: false,
  };
  // Both paths still resolve their fields on the device when there is
  // one; only the spawner terminal's residency differs. With no WebGPU
  // at all the resolver is absent and the whole cook is JS.
  const resolver = deviceLost ? undefined : useDevice ? residentEval : cpuEval;
  const spires = makeSpireLevel(hashCombine(seed, 7), radius, perCell);
  showGraph(spires.graph);
  next.world = new World({
    seed,
    levels: [spires],
    maxCellsPerLevel: cellCap(radius, FINE_CELL),
    ...(resolver !== undefined ? { gpu: resolver } : {}),
    onCellReady: (level, coord, outputs) => {
      if (next.disposed) {
        releaseOrphanedOutputs(outputs);
        return;
      }
      // Bind first, account second. The runtime has already stored the
      // cell by the time it calls us, so a throwing `cellReady` (unknown
      // asset, unbindable batch) leaves a cell that is never redrawn and
      // never recooked — counting it first would also leave it in the
      // totals forever.
      binding.cellReady(level, coord, outputs);
      accountCell(level, coord, outputs);
    },
    onCellEvicted: (level, coord) => {
      if (next.disposed) return;
      forgetCell(level, coord);
      // The binding disposes the evicted cell's meshes and releases its
      // device handles here; that is what keeps `device matrices` flat
      // during a sustained fly-through instead of climbing.
      binding.cellEvicted(level, coord);
    },
  });
  rig = next;
  lastPending = 0;
  resetChurnBaseline();
  paintMode();
}

// -- overlay ---------------------------------------------------------------

const overlay = createOverlay({
  title: "gpu world",
  info:
    "A world streamed around a flying camera. Each cell's instance matrices are composed in a " +
    "WGSL kernel and drawn straight from that GPU buffer — they never exist on the CPU. Switch " +
    "to the CPU path to watch the same world pay for the readback and the per-cell upload.",
});

const style = document.createElement("style");
style.textContent = `
.pcg09-seg { display: flex; gap: 6px; margin: 4px 0 4px; }
.pcg09-seg button {
  flex: 1; padding: 6px 4px; cursor: pointer; border-radius: 6px;
  border: 1px solid var(--ed-edge); background: var(--ed-well); color: var(--ed-ink-mid);
  font: 12px system-ui, sans-serif;
}
.pcg09-seg button:hover:not(:disabled) { border-color: var(--ed-accent); color: var(--ed-ink); }
.pcg09-seg button[aria-pressed="true"] { background: var(--ed-raised-hi); border-color: var(--ed-accent); color: var(--ed-ink-hi); }
.pcg09-seg button:disabled { opacity: 0.4; cursor: not-allowed; }
.pcg09-hint { margin: 0 0 10px; color: var(--ed-ink-faint); font-size: 11px; }
.pcg09-hud {
  position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 10;
  max-width: max(240px, min(680px, calc(100vw - 360px))); padding: 8px 14px; box-sizing: border-box;
  text-align: center; border-radius: 8px;
  background: var(--ed-panel); border: 1px solid var(--ed-rule);
  color: var(--ed-ink-mid); font: 12px/1.55 system-ui, sans-serif; backdrop-filter: blur(6px);
}
.pcg09-hud b { color: var(--ed-figure); font-weight: 600; }
.pcg09-hud .pcg09-keys { color: var(--ed-ink-faint); }
.pcg09-hud.pcg09-warn { border-color: var(--ed-edge-warn); color: var(--ed-ink-mid); }
.pcg09-hud.pcg09-warn b { color: var(--ed-ink-hi); }
/* On narrow screens the shared overlay becomes a bottom sheet, so the HUD
   moves to the top edge the overlay vacated instead of colliding with it.
   The desktop max-width reserved 360px for the left panel; there is no side
   panel here, so the HUD may span the viewport minus margins. */
@media ${NARROW_MEDIA_QUERY} {
  .pcg09-hud {
    bottom: auto;
    top: calc(12px + env(safe-area-inset-top));
    max-width: calc(100vw - 24px);
  }
}
`;
document.head.appendChild(style);

/**
 * The shared overlay factory has no button control, and it is shared, so
 * this example adds its own rows into the same controls container rather
 * than growing the shared surface for one page.
 */
const statsEl = overlay.el.querySelector(".pcg-stats");
const controlsEl = (statsEl?.previousElementSibling as HTMLElement | null) ?? overlay.el;

overlay.addSeed(seed, (s) => {
  seed = s;
  buildWorld();
});
overlay.addSlider(
  "speed",
  { min: 0, max: 90, step: 1, value: speed, format: (v) => `${v} u/s` },
  (v) => {
    speed = v;
  },
);
overlay.addSlider(
  "gen radius",
  { min: 60, max: 260, step: 10, value: radius, format: (v) => `${v} u` },
  (v) => {
    radius = v;
    scheduleRebuild();
  },
);
overlay.addSlider(
  "per cell",
  { min: 20, max: 600, step: 20, value: perCell, format: (v) => `${v}` },
  (v) => {
    perCell = v;
    scheduleRebuild();
  },
);

// -- path toggle (button + keyboard, prepended above the sliders) ----------

const seg = document.createElement("div");
seg.className = "pcg09-seg";
const btnDevice = document.createElement("button");
btnDevice.type = "button";
btnDevice.textContent = "device-resident";
const btnCpu = document.createElement("button");
btnCpu.type = "button";
btnCpu.textContent = "CPU readback";
seg.append(btnDevice, btnCpu);

const hint = document.createElement("p");
hint.className = "pcg09-hint";
hint.textContent = "G switches path · space toggles autopilot · A/D or ←/→ steer";

const autoRow = document.createElement("div");
autoRow.className = "pcg-row";
const autoLabel = document.createElement("label");
autoLabel.textContent = "autopilot";
const autoInput = document.createElement("input");
autoInput.type = "checkbox";
autoInput.checked = autopilot;
autoInput.addEventListener("change", () => {
  autopilot = autoInput.checked;
});
autoRow.append(autoLabel, autoInput);
controlsEl.appendChild(autoRow);
controlsEl.prepend(seg, hint);

function setMode(next: PathMode): void {
  if (deviceLost) {
    // Both buttons are disabled, but the keyboard shortcut is not.
    setStatus(deviceLostStatus());
    return;
  }
  if (next === mode) return;
  if (next === "device" && !residentAvailable()) {
    // The button is disabled, but the keyboard shortcut is not — say why
    // rather than swallow the keystroke.
    setStatus("device path unavailable — see the banner at the bottom of the page");
    return;
  }
  mode = next;
  buildWorld();
}
btnDevice.addEventListener("click", () => setMode("device"));
btnCpu.addEventListener("click", () => setMode("cpu"));

// -- stats -----------------------------------------------------------------

const statAdapter = overlay.addStat("renderer");
const statFps = overlay.addStat("fps");
const statCells = overlay.addStat("live cells");
const statChurn = overlay.addStat("cells cooked / evicted");
const statRate = overlay.addStat("churn per second");
const statDrawn = overlay.addStat("instances drawn");
const statDeviceBytes = overlay.addStat("matrices held on device");
const statAvoided = overlay.addStat("matrix uploads avoided");
const statUploaded = overlay.addStat("matrices uploaded");
const statStatus = overlay.addStat("status");
statStatus("initialising…");

/* The graph section, claimed HERE rather than where the panel is filled,
   so this page decides where in its own panel the graph sits. Right after
   the readouts and above the prose: the collapsibles and notes below run
   to several hundred pixels on this page, and a thumbnail under them is a
   thumbnail below the fold. */
const graphSlot = overlay.addSlot();

/* The mark, bottom left, linking back to the shelf these came from.
   Every demo is otherwise a page you can arrive at and not leave. */
attachWordmark();
const diagnostics = overlay.addCollapsible("diagnostics");

overlay.addNote(
  "Every instance is a 4x4 matrix: 64 bytes. On the device path those bytes are written once, on " +
    "the device, and the renderer draws from that same buffer — `matrix uploads avoided` counts " +
    "the matrix buffers that never crossed the bus. On the CPU path the same bytes are read " +
    "back, composed in JS and uploaded per cell, and `matrices uploaded` climbs by exactly the " +
    "same arithmetic instead. Both totals survive a switch, so you can fly a while on each and " +
    "compare.",
);

const hud = document.createElement("div");
hud.className = "pcg09-hud";
document.body.appendChild(hud);

function paintMode(): void {
  const canDevice = residentAvailable();
  btnDevice.disabled = !canDevice;
  // The CPU path cooks on the same device (only the spawner terminal
  // differs), so a loss takes it down too: leaving its button live would
  // build a world that can never cook or render.
  btnCpu.disabled = deviceLost;
  btnDevice.setAttribute("aria-pressed", String(mode === "device" && canDevice));
  btnCpu.setAttribute("aria-pressed", String(mode !== "device" || !canDevice));
  if (!canDevice && residentBlocker !== undefined) btnDevice.title = residentBlocker;
  if (deviceLost) {
    btnDevice.title = deviceLostStatus();
    btnCpu.title = deviceLostStatus();
  }

  const onDevice = rig?.mode === "device";
  hud.classList.toggle("pcg09-warn", !canDevice);
  if (deviceLost) {
    hud.innerHTML =
      "<b>WebGPU device lost.</b> Rendering has stopped — reload the page for a fresh device.";
    return;
  }
  if (!canDevice) {
    hud.innerHTML =
      `<b>CPU readback</b> — ${escapeHtml(sentence(residentBlocker ?? "the device path is unavailable"))} ` +
      "The world still streams and renders; its matrices are composed in JS and uploaded per cell." +
      ' <span class="pcg09-keys">space autopilot · A/D steer</span>';
    return;
  }
  hud.innerHTML = onDevice
    ? "<b>device-resident</b> — each cell's matrices are composed in a WGSL kernel and the " +
      "renderer draws from that buffer. Nothing is read back and nothing is uploaded." +
      ' <span class="pcg09-keys">G to compare · space autopilot · A/D steer</span>'
    : "<b>CPU readback</b> — the same graph, the same fields on the same device, but the " +
      "spawner materialises: matrices come back over the bus, are composed in JS, and are " +
      "uploaded per cell." +
      ' <span class="pcg09-keys">G to compare · space autopilot · A/D steer</span>';
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

function setStatus(message: string): void {
  statStatus(message);
}

function onDeviceLost(detail: string): void {
  deviceLost = true;
  deviceLostDetail = detail;
  deviceAdapter = undefined;
  setStatus(deviceLostStatus());
  console.error(`gpu-world: WebGPU device lost — ${detail}`);
  if (rig) teardown(rig);
  rig = undefined;
  paintMode();
}

// -- flight controls -------------------------------------------------------

let heading = 0;
const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  if (target !== null && (target.tagName === "INPUT" || target.tagName === "SELECT")) return;
  const key = e.key.toLowerCase();
  if (key === " ") {
    autopilot = !autopilot;
    autoInput.checked = autopilot;
    e.preventDefault();
  }
  if (key === "g") {
    setMode(mode === "device" ? "cpu" : "device");
    e.preventDefault();
  }
  keys.add(key);
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

// -- readouts --------------------------------------------------------------

const fps = createFpsMeter((v) => statFps(v));
let elapsed = 0;
let lastTime = performance.now();

let churnAt = performance.now();
let churnCooked = 0;
let churnEvicted = 0;
let cookedRate = 0;
let evictedRate = 0;

function resetChurnBaseline(): void {
  churnAt = performance.now();
  churnCooked = 0;
  churnEvicted = 0;
  cookedRate = 0;
  evictedRate = 0;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function fmtCount(n: number): string {
  return n.toLocaleString("en-US");
}

function frame(): void {
  // A lost device cannot render and cannot cook; the panel and the
  // banner say so, and the loop stops rather than spinning on errors.
  if (deviceLost) return;
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  elapsed += dt;
  fps();

  const steer =
    (keys.has("a") || keys.has("arrowleft") ? 1 : 0) -
    (keys.has("d") || keys.has("arrowright") ? 1 : 0);
  // Autopilot keeps a gentle, never-repeating turn so cells stream in
  // and out continuously without anyone holding a key down.
  const turn = autopilot ? 0.42 * Math.sin(elapsed * 0.21) + 0.18 * Math.sin(elapsed * 0.073) : 0;
  heading += (steer * 1.1 + turn) * dt;
  camera.position.x += Math.sin(heading) * speed * dt;
  camera.position.z += Math.cos(heading) * speed * dt;
  camera.position.y = 22;
  camera.lookAt(
    camera.position.x + Math.sin(heading) * 60,
    6,
    camera.position.z + Math.cos(heading) * 60,
  );
  // The world is unbounded; the ground is one finite plane. Carry it
  // with the camera so a long fly-through never runs off its edge.
  ground.position.x = camera.position.x;
  ground.position.z = camera.position.z;

  const r = rig;
  const gl = renderer;
  if (gl === undefined) return;

  if (r !== undefined) {
    if (!updating) {
      updating = true;
      updateStartedAt = now;
      r.world
        // Budgeted and capped: one update can never block long enough to
        // trip the browser's GPU watchdog, whichever path is live.
        .update([camera.position.x, 0, camera.position.z], {
          budgetMs: BUDGET_MS,
          maxCooksPerUpdate: MAX_COOKS_PER_UPDATE,
          signal: r.abort.signal,
        })
        .then((stats) => {
          if (!r.disposed) {
            lastPending = stats.pending;
            if (!deviceLost) setStatus(statusLine());
          }
        })
        .catch((err: unknown) => {
          if (!r.disposed && !deviceLost) setStatus(`cook failed: ${errText(err)}`);
        })
        .finally(() => {
          updating = false;
        });
    } else if (now - updateStartedAt > STALL_MS) {
      setStatus("a cook has been in flight for over 5 s — the GPU device may have been lost.");
    }

    const ws = r.world.stats();
    if (now - churnAt >= 500) {
      const secs = (now - churnAt) / 1000;
      cookedRate = Math.max(0, ws.totalCooked - churnCooked) / secs;
      evictedRate = Math.max(0, ws.totalEvicted - churnEvicted) / secs;
      churnAt = now;
      churnCooked = ws.totalCooked;
      churnEvicted = ws.totalEvicted;
    }
    statCells(String(ws.levels.find((l) => l.name === "spires")?.cellCount ?? 0));
    statChurn(`${fmtCount(ws.totalCooked)} / ${fmtCount(ws.totalEvicted)}`);
    statRate(`${cookedRate.toFixed(1)} / ${evictedRate.toFixed(1)}`);
    statDrawn(fmtCount(liveInstances));
    statDeviceBytes(
      `${r.binding.deviceHandleCount} buf · ${fmtBytes(r.binding.deviceHandleBytes)}`,
    );
    statAvoided(`${fmtCount(avoidedCount)} buf · ${fmtBytes(avoidedBytes)}`);
    statUploaded(`${fmtCount(uploadedCount)} buf · ${fmtBytes(uploadedBytes)}`);

    if (diagnostics.parentElement instanceof HTMLDetailsElement && diagnostics.parentElement.open) {
      diagnostics.textContent = diagnosticsText(r);
    }
  }
  gl.render(scene, camera);
}

function statusLine(): string {
  if (rig?.mode === "device") return "device-resident · no matrix readback";
  // The full sentence explaining *why* lives in the banner and on the
  // disabled button's tooltip; the stat line stays one line.
  return residentAvailable()
    ? "CPU readback · matrices composed in JS"
    : "CPU readback · device path unavailable";
}

/**
 * The numbers a first-time viewer does not need, kept out of the way but
 * not thrown away: the evaluator pool's own accounting is the
 * independent second opinion on `binding buffers`. It is the *counts*
 * (`binding buffers` vs `pool detached`) that must agree and reach a
 * steady state during a fly-through, and even those only outside the
 * window between a run detaching a buffer and `cellReady` delivering it.
 *
 * The byte figures differ by design and never converge: the pool reports
 * the power-of-two bucket it allocated, the binding reports the logical
 * `count * 64` payload it was handed.
 */
function diagnosticsText(r: WorldRig): string {
  const lines = [
    `path            ${r.mode}`,
    `backend         ${backendLabel}`,
    `pending cells   ${lastPending}`,
    `binding buffers ${r.binding.deviceHandleCount}`,
    `binding bytes   ${r.binding.deviceHandleBytes} logical`,
  ];
  const ev = r.mode === "device" ? residentEval : cpuEval;
  if (ev !== undefined) {
    const p = ev.poolStats;
    lines.push(
      `pool detached   ${p.detachedBuffers} (${fmtBytes(p.detachedBytes)} bucketed)`,
      `pool idle       ${p.pooledBuffers} (${fmtBytes(p.pooledBytes)})`,
      `pool made/freed ${p.buffersCreated} / ${p.buffersDestroyed}`,
      `pool reused     ${p.buffersReused}`,
    );
  }
  if (deviceAdapter !== undefined) {
    const s = deviceAdapter.stats;
    lines.push(
      `adapter live    ${s.built - s.released} of ${s.built}`,
      `adapter adopted ${s.adopted}`,
      `adapter insts   ${s.liveInstances}`,
    );
  }
  lines.push(
    `page            ${document.visibilityState}`,
    `position        ${camera.position.x.toFixed(0)}, ${camera.position.z.toFixed(0)}`,
  );
  return lines.join("\n");
}

/**
 * Console hook for verifying the claim rather than taking it on trust:
 * for the first live cell mesh it reports the CPU matrix array length
 * (0 on the device path — the matrices were never composed), the
 * instance count three will draw, whether the attribute is a storage
 * attribute, and whether the GPUBuffer three's backend holds is big
 * enough to be the adopted one rather than one three made for itself.
 *
 * That last check is only meaningful on a storage attribute, so it is
 * `null` everywhere else: the CPU path hands three a real `count * 16`
 * float array, three allocates a `count * 64` buffer of its own for it,
 * and a size test would pass there while proving nothing about
 * adoption.
 */
interface WorldProbe {
  mode: PathMode | null;
  backend: string;
  cells: number;
  meshes: number;
  cpuMatrixFloats: number | null;
  instanceCount: number | null;
  isStorageAttribute: boolean | null;
  boundingSphereRadius: number | null;
  backendBufferSize: number | null;
  backendBufferIsAdopted: boolean | null;
  deviceBuffers: number;
  deviceBytes: number;
  matrixUploadsAvoided: number;
  bytesAvoided: number;
  matricesUploaded: number;
  bytesUploaded: number;
}

(window as unknown as { pcgWorld: unknown }).pcgWorld = {
  probe(): WorldProbe {
    const r = rig;
    const gl = renderer;
    const out: WorldProbe = {
      mode: r?.mode ?? null,
      backend: backendLabel,
      cells: r?.binding.cellCount ?? 0,
      meshes: 0,
      cpuMatrixFloats: null,
      instanceCount: null,
      isStorageAttribute: null,
      boundingSphereRadius: null,
      backendBufferSize: null,
      backendBufferIsAdopted: null,
      deviceBuffers: r?.binding.deviceHandleCount ?? 0,
      deviceBytes: r?.binding.deviceHandleBytes ?? 0,
      matrixUploadsAvoided: avoidedCount,
      bytesAvoided: avoidedBytes,
      matricesUploaded: uploadedCount,
      bytesUploaded: uploadedBytes,
    };
    if (r === undefined || gl === undefined) return out;
    for (const cell of r.group.children) {
      for (const child of cell.children) {
        const mesh = child as InstancedMesh & { isInstancedMesh?: boolean };
        if (mesh.isInstancedMesh !== true) continue;
        out.meshes++;
        if (out.cpuMatrixFloats !== null) continue;
        const attr = mesh.instanceMatrix as unknown as {
          array: ArrayLike<number>;
          count: number;
          isStorageInstancedBufferAttribute?: boolean;
        };
        out.cpuMatrixFloats = attr.array.length;
        out.instanceCount = mesh.count;
        out.isStorageAttribute = attr.isStorageInstancedBufferAttribute === true;
        out.boundingSphereRadius = mesh.boundingSphere?.radius ?? null;
        const record = (gl.backend as unknown as { get(o: object): { buffer?: unknown } }).get(
          attr as unknown as object,
        );
        // On a storage attribute the array is zero-length, so a GPUBuffer
        // three created for itself would be sized from that: anything big
        // enough to hold the matrices can only be the adopted one. On an
        // ordinary instanced attribute the array is real and three's own
        // buffer is `count * 64` too, so the test cannot fail and is
        // reported as `null` (not applicable) rather than as a pass.
        const gpuBuffer = record.buffer as { size?: number } | undefined;
        out.backendBufferSize = gpuBuffer?.size ?? null;
        out.backendBufferIsAdopted =
          out.isStorageAttribute === true
            ? gpuBuffer?.size !== undefined && gpuBuffer.size >= mesh.count * 64
            : null;
      }
    }
    return out;
  },
};

// -- boot ------------------------------------------------------------------

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
      console.warn("gpu-world: shared-device renderer failed:", err);
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
      console.warn("gpu-world: device instance adapter unavailable:", err);
    }
  }

  statAdapter(`${adapterLabel} · ${backendLabel}`);
  if (!residentAvailable()) {
    mode = "cpu";
    console.info(`gpu-world: device path unavailable — ${residentBlocker ?? "unknown reason"}`);
  } else {
    console.info(
      `gpu-world: WebGPU ready — ${adapterLabel}; ` +
        `residentTerminals=[${residentEval?.residentTerminals.join(", ") ?? ""}]`,
    );
  }
  const canvas = active.domElement;
  canvas.style.display = "block";
  document.body.appendChild(canvas);
  const resize = (): void => {
    active.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    active.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();

  // After buildWorld(), so `statusLine()` can read the mode the rig
  // actually settled on rather than the one that was merely requested.
  buildWorld();
  setStatus(statusLine());
  requestAnimationFrame(frame);
}

void boot().catch((err: unknown) => {
  setStatus(`boot failed: ${errText(err)}`);
  console.error("gpu-world: boot failed:", err);
});
