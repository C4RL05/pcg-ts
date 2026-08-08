/**
 * 04 — infinite world: a two-level hierarchical World streamed around a
 * flying camera. The coarse level is unbounded (one global cook) and
 * scatters sparse mega-rocks; the fine level (cellSize 20) scatters small
 * rocks per cell, with density read from one shared world-space noise
 * field so cell borders are seamless. Each level's bind wires the cell
 * bounds and ctx.seed into the graph per the LevelDef determinism
 * contract; WorldThreeBinding maps cell lifecycles onto the scene.
 *
 * This page also carries a GPU field evaluator, toggled live. Every
 * field in `levels.ts` is written with the combinator API — `remap`,
 * `vec`, `mul`, `randomField`, `fbm(perlinNoise)` — and combinator-built
 * fields DERIVE their spec rather than having one authored through
 * `fieldFromJson`. A resolver only accepts those if it advertises
 * `acceptDerivedSpecs`, so that flag is not a tuning knob here: with it
 * off, every field on this page counts a `"derived-spec"` fallback and
 * evaluates on the CPU. The "derived specs" checkbox switches between
 * two evaluators on one device so you can watch the counters swap.
 *
 * What this page is NOT: device-resident instancing. The renderer and
 * the instancing path are untouched, matrices still round-trip to the
 * CPU, and `spawnInstances` never joins a run. See 09 for that. It also
 * fuses nothing at all — see the "diagnostics" section in the panel for
 * why that is a property of these graphs rather than of the device.
 */
import { CookCancelledError, World, type CellOutputs, type GpuCookStats } from "pcg-ts";
import type { GpuFieldEvaluator } from "pcg-ts/gpu";
import { WorldThreeBinding, type AssetMap } from "pcg-ts/three";
import { FINE_CELL, makeLandmarkLevel, makeRockLevel } from "./levels.js";
import { CookStatsTap, createEvaluators, fmtFallbacks, requestGpuDevice } from "./gpu.js";
import {
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from "three";
import { createFpsMeter } from "../shared/fps.js";
import { createOverlay } from "../shared/overlay.js";
import { createScene } from "../shared/scene.js";

/** Where the fields are evaluated. */
type PathMode = "gpu" | "cpu";

let seed = 1;
let speed = 18;
let radius = 140;
let mode: PathMode = "gpu";
let acceptDerived = true;

/**
 * Per-update cook budget, and a hard cap on cells per update. Both are
 * load-bearing with a device attached: a long synchronous cook can cost
 * the page its WebGPU device, and a lost device leaves in-flight
 * readbacks pending forever with no rejection — indistinguishable from a
 * library hang. Keeping every update short is the cheapest defence.
 */
const BUDGET_MS = 7;
const FIRST_BUDGET_MS = 12;
const MAX_COOKS_PER_UPDATE = 8;
/** An update in flight longer than this is reported as stalled. */
const STALL_MS = 5000;

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// -- scene -----------------------------------------------------------------

const { scene, camera, start } = createScene({
  cameraPosition: [0, 26, 0],
  orbit: false,
  fog: { near: 140, far: 640 },
  far: 1600,
});

const ground = new Mesh(
  new PlaneGeometry(4000, 4000),
  new MeshStandardMaterial({ color: 0x161e2b, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.03;
scene.add(ground);

const rockMat = new MeshStandardMaterial({ color: 0x7a8290, roughness: 0.95, flatShading: true });
const megaMat = new MeshStandardMaterial({ color: 0x5d6675, roughness: 1, flatShading: true });
const assets: AssetMap = {
  megarock: { geometry: new DodecahedronGeometry(1).translate(0, 0.62, 0), material: megaMat },
  rock: { geometry: new IcosahedronGeometry(0.55).translate(0, 0.33, 0), material: rockMat },
};

// -- GPU state -------------------------------------------------------------

/**
 * The evaluators are long-lived (they own the pipeline caches); the
 * `CookStatsTap` around them is per-world. That split is deliberate: the
 * tap's drain window is "everything captured since the last drain", and
 * a tap shared between two worlds would blend them. `buildWorld` starts
 * a new world while the outgoing one's update may still be settling, so
 * a shared tap would let a dead world's counters be summed into — and
 * double-counted by — the live world's readout.
 */
let evalDerived: GpuFieldEvaluator | undefined;
let evalStrict: GpuFieldEvaluator | undefined;
let adapterLabel = "requesting…";
let gpuBlocker: string | undefined;
let deviceLost = false;
let deviceLostDetail = "";
/** Counters from the last update that did any device work. */
let lastGpu: GpuCookStats | undefined;

function gpuReady(): boolean {
  return evalDerived !== undefined && !deviceLost;
}

/**
 * The evaluator for the current mode, or `undefined` for the CPU path.
 *
 * Note the shape this feeds: `World` resolves `opts.gpu ?? this.gpu`, so
 * passing `gpu: undefined` in an update does NOT clear a resolver set on
 * the World. The CPU path therefore has to omit the key in both places,
 * which is why `buildWorld` spreads it conditionally too.
 */
function activeEvaluator(): GpuFieldEvaluator | undefined {
  if (mode === "cpu" || !gpuReady()) return undefined;
  return acceptDerived ? evalDerived : evalStrict;
}

// -- world lifecycle -------------------------------------------------------

function cellCap(genRadius: number, cellSize: number): number {
  const r = (genRadius * 1.25) / cellSize + 1.5;
  return Math.max(256, Math.ceil(Math.PI * r * r));
}

function countInstances(outputs: CellOutputs): number {
  let n = 0;
  for (const name of Object.keys(outputs)) {
    for (const item of outputs[name]) {
      if (item.kind === "instances") for (const b of item.batches) n += b.count;
    }
  }
  return n;
}

interface WorldRig {
  world: World;
  group: Group;
  binding: WorldThreeBinding;
  cellInstances: Map<string, number>;
  /** This world's own stats window, or undefined on the CPU path. */
  tap: CookStatsTap | undefined;
  /** Cancels this world's in-flight update when it is torn down. */
  abort: AbortController;
  disposed: boolean;
}

let rig: WorldRig | undefined;
let lastPending = 0;
let lastCookMs: number | undefined;
let updateStartedAt = 0;
let stalled = false;
/** Generation counter so only the newest update may clear `updating`. */
let updateToken = 0;

/**
 * Rebuild the world from scratch. Switching path rebuilds rather than
 * swapping the resolver per update: cell outputs are stored, and a
 * resolver swap alone marks nothing stale, so the cheap version would
 * leave a stale mix of CPU- and GPU-cooked cells on screen.
 */
function buildWorld(): void {
  if (rig) {
    rig.disposed = true;
    // Stop the outgoing world's cooks rather than let them run to
    // completion against a scene they no longer feed — it wastes device
    // work and keeps its tap alive longer than its readout matters.
    rig.abort.abort();
    rig.binding.dispose();
    scene.remove(rig.group);
  }
  const group = new Group();
  scene.add(group);
  const binding = new WorldThreeBinding({ group, assets });
  const cellInstances = new Map<string, number>();
  const evaluator = activeEvaluator();
  const next: WorldRig = {
    world: undefined as unknown as World,
    group,
    binding,
    cellInstances,
    tap: evaluator !== undefined ? new CookStatsTap(evaluator) : undefined,
    abort: new AbortController(),
    disposed: false,
  };
  next.world = new World({
    seed,
    levels: [makeLandmarkLevel(), makeRockLevel(seed, radius)],
    maxCellsPerLevel: cellCap(radius, FINE_CELL),
    ...(next.tap !== undefined ? { gpu: next.tap } : {}),
    onCellReady: (level, coord, outputs) => {
      if (next.disposed) return;
      binding.cellReady(level, coord, outputs);
      cellInstances.set(`${level}|${coord[0]},${coord[1]}`, countInstances(outputs));
    },
    onCellEvicted: (level, coord) => {
      if (next.disposed) return;
      binding.cellEvicted(level, coord);
      cellInstances.delete(`${level}|${coord[0]},${coord[1]}`);
    },
  });
  rig = next;
  lastPending = 0;
  lastGpu = undefined;
  lastCookMs = undefined;
  paintGpuStats();
  // Kick the first update immediately so cells start cooking before the
  // first animation frame (overlapping updates are serialized by World).
  runUpdate(next, FIRST_BUDGET_MS);
}

/**
 * One budgeted update, with the resolver passed per update as well as on
 * the World, and the resulting `CookStats.gpu` counters drained from the
 * tap once the update's cooks have settled.
 */
function runUpdate(r: WorldRig, budgetMs: number): void {
  // Rebuilding mid-update (a path switch, a seed change) starts a second
  // update while the first is still settling. Token the flag so only the
  // newest update can clear it — otherwise the older one's `finally`
  // would release the gate and the frame loop would pile on a third.
  const token = ++updateToken;
  updating = true;
  updateStartedAt = performance.now();
  r.world
    .update([camera.position.x, 0, camera.position.z], {
      budgetMs,
      maxCooksPerUpdate: MAX_COOKS_PER_UPDATE,
      signal: r.abort.signal,
      ...(r.tap !== undefined ? { gpu: r.tap } : {}),
    })
    .then((stats) => {
      if (r.disposed) return;
      lastPending = stats.pending;
      lastCookMs = stats.elapsedMs;
      // The tap holds the very `CookStats.gpu` objects the executor
      // published for this update's cell cooks — and it belongs to this
      // world alone, so nothing another world cooked can land here. An
      // update that cooked nothing leaves the previous counters standing.
      const drained = r.tap?.drain();
      if (drained !== undefined) lastGpu = drained;
      paintGpuStats();
      if (stalled) {
        stalled = false;
        setStatus(readyStatus());
      }
    })
    .catch((err: unknown) => {
      // A torn-down world rejects with CookCancelledError by design (we
      // aborted it), so neither log nor report that. Anything else is a
      // real failure and still gets logged, disposed or not — swallowing
      // every error from a dead rig would hide genuine cook errors that
      // happened to race a rebuild.
      if (err instanceof CookCancelledError) return;
      console.error(err);
      if (!r.disposed) setStatus(`update failed: ${errText(err)}`);
    })
    .finally(() => {
      if (token === updateToken) updating = false;
    });
}

// -- flight controls -------------------------------------------------------

let heading = 0;
let steer = 0;
const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "g") {
    setMode(mode === "gpu" ? "cpu" : "gpu");
    return;
  }
  keys.add(k);
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

// A hidden tab pauses rAF but throttles the cook's yield timer to ~1s, so
// an update straddling a hide/show can be many seconds old on the first
// tick back. Restart the stall clock instead of crying device loss.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") updateStartedAt = performance.now();
});

// -- overlay ---------------------------------------------------------------

const overlay = createOverlay({
  title: "04 · infinite world",
  info: "Unbounded landmark level + streamed 20u rock cells around a flying camera. Steer with A/D or arrow keys.",
});

const style = document.createElement("style");
style.textContent = `
.pcg04-seg { display: flex; gap: 6px; margin: 4px 0 4px; }
.pcg04-seg button {
  flex: 1; padding: 6px 4px; cursor: pointer; border-radius: 6px;
  border: 1px solid #33405a; background: #161d29; color: #aeb9c9;
  font: 12px system-ui, sans-serif;
}
.pcg04-seg button:hover:not(:disabled) { border-color: #4c8dff; color: #dbe4f0; }
.pcg04-seg button[aria-pressed="true"] { background: #1d3a6b; border-color: #4c8dff; color: #eaf2ff; }
.pcg04-seg button:disabled { opacity: 0.4; cursor: not-allowed; }
.pcg04-hint { margin: 0 0 10px; color: #6f7c8f; font-size: 11px; }
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
  { min: 0, max: 80, step: 1, value: speed, format: (v) => `${v} u/s` },
  (v) => {
    speed = v;
  },
);
overlay.addSlider(
  "gen radius",
  { min: 60, max: 240, step: 10, value: radius, format: (v) => `${v} u` },
  (v) => {
    radius = v;
    buildWorld();
  },
);

// -- path toggle (buttons + keyboard, prepended above the sliders) ---------

const seg = document.createElement("div");
seg.className = "pcg04-seg";
const btnGpu = document.createElement("button");
btnGpu.type = "button";
btnGpu.textContent = "GPU per-node";
const btnCpu = document.createElement("button");
btnCpu.type = "button";
btnCpu.textContent = "CPU";
seg.append(btnGpu, btnCpu);

const hint = document.createElement("p");
hint.className = "pcg04-hint";
hint.textContent = "G switches path · A/D or ←/→ steer";

const derivedRow = document.createElement("div");
derivedRow.className = "pcg-row";
const derivedLabel = document.createElement("label");
derivedLabel.textContent = "derived specs";
const derivedInput = document.createElement("input");
derivedInput.type = "checkbox";
derivedInput.checked = acceptDerived;
derivedInput.addEventListener("change", () => {
  acceptDerived = derivedInput.checked;
  buildWorld();
});
derivedRow.append(derivedLabel, derivedInput);

controlsEl.prepend(seg, hint, derivedRow);

function setMode(next: PathMode): void {
  if (next === mode) return;
  if (next === "gpu" && !gpuReady()) {
    // The button is disabled, but the keyboard shortcut is not — say why
    // rather than swallow the keystroke.
    setStatus(deviceLost ? deviceLostStatus() : (gpuBlocker ?? "GPU path not ready yet."));
    return;
  }
  mode = next;
  paintMode();
  buildWorld();
  setStatus(readyStatus());
}
btnGpu.addEventListener("click", () => setMode("gpu"));
btnCpu.addEventListener("click", () => setMode("cpu"));

function paintMode(): void {
  btnGpu.setAttribute("aria-pressed", String(mode === "gpu"));
  btnCpu.setAttribute("aria-pressed", String(mode === "cpu"));
  btnGpu.disabled = !gpuReady();
  if (gpuBlocker !== undefined) btnGpu.title = gpuBlocker;
  else if (deviceLost) btnGpu.title = deviceLostStatus();
  else btnGpu.title = "";
  // The flag only means anything when a resolver is actually in play.
  derivedInput.disabled = !gpuReady() || mode === "cpu";
}

// -- stats -----------------------------------------------------------------

const statAdapter = overlay.addStat("adapter");
const statFps = overlay.addStat("fps");
const statCells = overlay.addStat("rock cells");
const statCooked = overlay.addStat("cooked / evicted");
const statPending = overlay.addStat("pending");
const statInstances = overlay.addStat("instances");
const statPos = overlay.addStat("position");
const statCook = overlay.addStat("cook");
const statFused = overlay.addStat("resident runs / fused members");
const statDispatches = overlay.addStat("device dispatches");
const statFallbacks = overlay.addStat("gpu fallbacks");
const statStatus = overlay.addStat("status");

function setStatus(text: string): void {
  statStatus(text);
}

function deviceLostStatus(): string {
  return `device lost (${deviceLostDetail}) — the GPU path is disabled; reload for a fresh device`;
}

function readyStatus(): string {
  if (deviceLost) return deviceLostStatus();
  if (mode === "cpu") return "CPU path — no resolver passed to the cook";
  if (!gpuReady()) return gpuBlocker ?? "requesting WebGPU adapter…";
  return acceptDerived
    ? "GPU per-node — combinator fields accepted via acceptDerivedSpecs"
    : "GPU per-node — acceptDerivedSpecs off, so every field falls back";
}

/**
 * Paint the four measured readouts. The three GPU counters are read
 * straight off the `CookStats.gpu` objects the tap captured — nothing
 * here is reconstructed or estimated.
 */
function paintGpuStats(): void {
  statCook(lastCookMs === undefined ? "–" : `${lastCookMs.toFixed(1)} ms`);
  if (lastGpu === undefined) {
    statFused(rig?.tap === undefined ? "– (no GPU resolver)" : "–");
    statDispatches("–");
    statFallbacks("–");
    return;
  }
  statFused(`${lastGpu.residentRuns} / ${lastGpu.fusedNodes}`);
  statDispatches(String(lastGpu.dispatches));
  statFallbacks(fmtFallbacks(lastGpu.fallbacks));
}

overlay.addNote(
  "Cell content is a pure function of (seed, level, cell coord) — fly away and back, or change the radius: the same rocks return.",
);

const diagnostics = overlay.addCollapsible("diagnostics · why nothing fuses here");
diagnostics.textContent = `resident runs / fused members reads 0 / 0 on BOTH paths, and
that is a property of these graphs, not of the device.

A device-resident run needs two or more ADJACENT fusable nodes.
Of the node types used here, only setAttribute declares a CHAIN
resident descriptor. pointScatterInBounds and filterByDensity
declare none at all, and spawnInstances declares a TERMINAL one,
which joins a run only when the resolver advertises that kind in
residentTerminals — this page deliberately does not (see 09).

  landmarks   scatter -> setAttribute -> spawnInstances
                         ^ lone fusable node: a run of one, so no run

  rocks       scatter -> setAttribute -> filterByDensity
                      -> setAttribute -> spawnInstances
                         ^ two fusable nodes, held apart by
                           filterByDensity: two runs of one, so no run

filterByDensity changes the point count, and every member of a run
must be element-count preserving on one geometry in/out, so it can
never be a member. It is exactly what breaks the only chain here
that could have fused: delete it and the two setAttribute nodes
become a single 2-member run.

What acceptDerivedSpecs buys on this page is the PER-NODE path.
Every field in levels.ts is combinator-built (remap, vec, mul,
randomField, fbm(perlinNoise)), so each derives its spec rather
than having one authored via fieldFromJson:

  flag off   each field counts a "derived-spec" fallback and
             evaluates on the CPU -> 0 dispatches
  flag on    each field compiles to WGSL -> 1 dispatch per
             resolved field column

Field columns offered to the device per cook:
  landmarks   1   (the scale vec)
  rocks       2   (the density fbm, the scale vec)

Reading the numbers: "cook" is UpdateStats.elapsedMs, the wall time
of one budgeted update, which may cook several cells or none. World
discards each cell's CookStats, so the three counters under it are
summed from the CookStats.gpu objects captured by the resolver tap
over that same update, and hold their last non-empty value when an
update cooks nothing.`;

// -- GPU init --------------------------------------------------------------

function onDeviceLost(detail: string): void {
  deviceLost = true;
  deviceLostDetail = detail;
  adapterLabel = "device lost";
  statAdapter(adapterLabel);
  setStatus(deviceLostStatus());
  paintMode();
  if (mode === "gpu") {
    mode = "cpu";
    paintMode();
    buildWorld();
  }
}

async function initGpu(): Promise<void> {
  const probe = await requestGpuDevice(onDeviceLost);
  if ("error" in probe) {
    gpuBlocker = probe.error;
    adapterLabel = "no WebGPU adapter";
    statAdapter(adapterLabel);
    mode = "cpu";
    paintMode();
    setStatus(`${probe.error} Running the CPU path.`);
    return;
  }
  try {
    const evals = createEvaluators(probe);
    evalDerived = evals.derived;
    evalStrict = evals.strict;
  } catch (err) {
    gpuBlocker = `GpuFieldEvaluator construction failed: ${errText(err)}`;
    adapterLabel = "evaluator unavailable";
    statAdapter(adapterLabel);
    mode = "cpu";
    paintMode();
    setStatus(`${gpuBlocker} Running the CPU path.`);
    return;
  }
  // A device handed over already lost runs `onDeviceLost` before this
  // continuation; don't overwrite its report with an adapter name.
  if (deviceLost) return;
  adapterLabel = probe.label;
  statAdapter(adapterLabel);
  paintMode();
  setStatus(readyStatus());
  // The world is already streaming on the CPU by now; rebuild so the
  // cells cook through the resolver.
  if (mode === "gpu") buildWorld();
}

// -- frame loop ------------------------------------------------------------

let updating = false;
const fps = createFpsMeter((v) => statFps(v));

statAdapter(adapterLabel);
setStatus("requesting WebGPU adapter…");
paintMode();
paintGpuStats();
// Build and start rendering before the device is asked for, so a browser
// with no WebGPU (or a slow adapter request) still shows the world at
// once — the GPU path swaps in later if it arrives.
buildWorld();
void initGpu();

start((dt) => {
  fps();
  steer = (keys.has("a") || keys.has("arrowleft") ? 1 : 0) - (keys.has("d") || keys.has("arrowright") ? 1 : 0);
  heading += steer * 1.1 * dt;
  camera.position.x += Math.sin(heading) * speed * dt;
  camera.position.z += Math.cos(heading) * speed * dt;
  camera.position.y = 26;
  camera.lookAt(
    camera.position.x + Math.sin(heading) * 60,
    5,
    camera.position.z + Math.cos(heading) * 60,
  );

  const r = rig;
  if (r && !updating) {
    runUpdate(r, BUDGET_MS);
  } else if (updating && !stalled && performance.now() - updateStartedAt > STALL_MS) {
    // A lost device never rejects work already in flight, so a readback
    // that never settles looks exactly like a hung library. Say so.
    stalled = true;
    setStatus("a cook has been in flight for over 5 s — the GPU device may have been lost.");
  }
  if (r) {
    const ws = r.world.stats();
    const rocks = ws.levels.find((l) => l.name === "rocks")?.cellCount ?? 0;
    statCells(String(rocks));
    statCooked(`${ws.totalCooked} / ${ws.totalEvicted}`);
    statPending(String(lastPending));
    let total = 0;
    for (const n of r.cellInstances.values()) total += n;
    statInstances(String(total));
    statPos(`${camera.position.x.toFixed(0)}, ${camera.position.z.toFixed(0)}`);
  }
});
