/**
 * 09 — gpu world (verification harness).
 *
 * A streamed `World` whose cells render from instance matrices that
 * never touch the CPU. One `GPUDevice` backs both halves: the
 * `GpuFieldEvaluator` composes each cell's 4x4s in a WGSL kernel and
 * hands back a retained buffer, and a `WebGPURenderer` created with
 * `{ device }` draws straight from that buffer through
 * `createWebGpuInstanceAdapter`. No readback, no `Float32Array` of
 * matrices, no `instanceMatrix` upload.
 *
 * This is a harness, not the polished demo (that is phase 28). It exists
 * so the lifetime story can be checked by eye: the panel shows live
 * cells, the device buffers/bytes the binding is holding, and — as an
 * independent second opinion — the evaluator pool's own detached-buffer
 * accounting. Over a sustained fly-through those two numbers must track
 * each other and reach a steady state instead of climbing.
 *
 * Without WebGPU the page says so and renders nothing; there is no CPU
 * fallback here on purpose — a fallback would hide the very thing this
 * page is for.
 */
import { World, hashCombine, type CellCoord, type CellOutputs } from "pcg-ts";
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
import { createFpsMeter } from "../shared/fps.js";
import { createOverlay } from "../shared/overlay.js";
import { FINE_CELL, MAX_INSTANCE_RADIUS, makeSpireLevel } from "./levels.js";

// -- tunables --------------------------------------------------------------

let seed = 1;
let speed = 26;
let radius = 150;
let perCell = 140;
let autopilot = true;

// -- WebGPU device (shared by the evaluator and the renderer) --------------

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

interface Rig {
  readonly device: GpuDeviceLike;
  readonly evaluator: GpuFieldEvaluator;
  readonly renderer: WebGPURenderer;
  readonly adapter: WebGpuInstanceAdapter;
  readonly label: string;
}

async function initGpu(): Promise<Rig | { error: string }> {
  const navGpu = (navigator as unknown as { gpu?: NavigatorGpuLike }).gpu;
  if (navGpu === undefined) {
    return { error: "navigator.gpu is missing — this browser has no WebGPU." };
  }
  const gpuAdapter = await navGpu.requestAdapter();
  if (gpuAdapter === null) {
    return { error: "requestAdapter() returned null — no compatible GPU adapter." };
  }
  const info = gpuAdapter.info;
  const device = await gpuAdapter.requestDevice();
  const lost = (device as { lost?: Promise<{ reason?: string; message?: string }> }).lost;
  if (lost !== undefined) {
    void lost.then((detail) => {
      setError(
        `WebGPU device lost (${detail?.reason ?? "unknown"}: ${detail?.message ?? "no detail"}).`,
      );
    });
  }

  // The whole feature rests on this: one device, two consumers. A
  // WebGPU buffer cannot be shared across devices, so if three ever
  // stopped honouring `parameters.device` the batches would be
  // unbindable — check it rather than assume it.
  const renderer = new WebGPURenderer({ device, antialias: true } as ConstructorParameters<
    typeof WebGPURenderer
  >[0]);
  await renderer.init();
  const rendererDevice = (renderer.backend as unknown as { device: unknown }).device;
  if (rendererDevice !== device) {
    return {
      error:
        "WebGPURenderer did not adopt the supplied GPUDevice (renderer.backend.device is a " +
        "different device), so the evaluator's buffers cannot be bound. three no longer honours " +
        "`parameters.device`.",
    };
  }

  const evaluator = new GpuFieldEvaluator(device, {
    ...(info !== undefined ? { adapterInfo: info } : {}),
    deviceInstances: true,
  });
  const adapter = await createWebGpuInstanceAdapter({ renderer, assets });
  const label =
    [info?.vendor, info?.architecture, info?.description !== "" ? info?.description : info?.device]
      .filter((p): p is string => typeof p === "string" && p !== "")
      .join(" · ") || "adapter (no info exposed)";
  console.info(
    `09-gpu-world: WebGPU ready — ${label}; residentTerminals=[${evaluator.residentTerminals.join(", ")}]`,
  );
  return { device, evaluator, renderer, adapter, label };
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
 * built at all.
 */
const assets: AssetMap = {
  spire: {
    geometry: new CylinderGeometry(0.18, 0.55, 2.4, 6).translate(0, 1.2, 0),
    material: new MeshStandardNodeMaterial({ color: 0x86d7a4, roughness: 0.7, flatShading: true }),
  },
};

// -- out-of-band bounds ----------------------------------------------------

/**
 * The bounding sphere the renderer culls each cell with.
 * `computeBoundingSphere()` cannot be used — it reads CPU instance
 * matrices that were never composed — so it comes from the cell AABB
 * instead: the XZ cell's centre, and a radius covering the cell's
 * diagonal, the instances' height, and the tallest instance's own
 * radius. Erring large is the safe direction; too small silently culls
 * geometry that is on screen.
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

// -- world lifecycle -------------------------------------------------------

function cellCap(genRadius: number, cellSize: number): number {
  const r = (genRadius * 1.25) / cellSize + 1.5;
  return Math.max(64, Math.ceil(Math.PI * r * r));
}

interface WorldRig {
  world: World;
  group: Group;
  binding: WorldThreeBinding;
  disposed: boolean;
}

let gpu: Rig | undefined;
let rig: WorldRig | undefined;
let lastPending = 0;
let deviceItems = 0;
let cpuItems = 0;
let deviceInstancesSeen = 0;

function inspectOutputs(outputs: CellOutputs): void {
  for (const name of Object.keys(outputs)) {
    for (const item of outputs[name]) {
      if (item.kind !== "instances") continue;
      if (item.deviceBatches !== undefined) {
        deviceItems++;
        for (const b of item.deviceBatches) deviceInstancesSeen += b.count;
      } else {
        cpuItems++;
      }
    }
  }
}

function buildWorld(): void {
  const g = gpu;
  if (g === undefined) return;
  if (rig) {
    rig.disposed = true;
    rig.binding.dispose();
    scene.remove(rig.group);
  }
  deviceItems = 0;
  cpuItems = 0;
  deviceInstancesSeen = 0;
  const group = new Group();
  scene.add(group);
  const binding = new WorldThreeBinding({
    group,
    assets,
    deviceInstances: { adapter: g.adapter, bounds: cellBounds },
  });
  const next: WorldRig = {
    world: undefined as unknown as World,
    group,
    binding,
    disposed: false,
  };
  next.world = new World({
    seed,
    levels: [makeSpireLevel(hashCombine(seed, 7), radius, perCell)],
    maxCellsPerLevel: cellCap(radius, FINE_CELL),
    gpu: g.evaluator,
    onCellReady: (level, coord, outputs) => {
      if (next.disposed) return;
      inspectOutputs(outputs);
      binding.cellReady(level, coord, outputs);
    },
    onCellEvicted: (level, coord) => {
      if (next.disposed) return;
      binding.cellEvicted(level, coord);
    },
  });
  rig = next;
  lastPending = 0;
}

// -- overlay ---------------------------------------------------------------

const overlay = createOverlay({
  title: "09 · gpu world (harness)",
  info: "Streamed cells whose instance matrices are composed on the GPU and drawn from that buffer — no readback, no CPU matrices. Steer with A/D or arrows; space toggles autopilot.",
});
const statAdapter = overlay.addStat("adapter");
const statFps = overlay.addStat("fps");
const statVisible = overlay.addStat("page");
const statCells = overlay.addStat("live cells");
const statCooked = overlay.addStat("cooked / evicted");
const statPending = overlay.addStat("pending");
const statItems = overlay.addStat("device / cpu items");
const statDrawn = overlay.addStat("instances drawn");
const statBuffers = overlay.addStat("device buffers");
const statBytes = overlay.addStat("device bytes");
const statPool = overlay.addStat("pool detached");
const statPoolLife = overlay.addStat("pool made / freed");
const statObjects = overlay.addStat("adapter live objs");
const statPos = overlay.addStat("position");
const statError = overlay.addStat("status");
statError("initialising…");

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
    buildWorld();
  },
);
overlay.addSlider(
  "per cell",
  { min: 20, max: 600, step: 20, value: perCell, format: (v) => `${v}` },
  (v) => {
    perCell = v;
    buildWorld();
  },
);
overlay.addCheckbox("autopilot", autopilot, (v) => {
  autopilot = v;
});
overlay.addNote(
  "`device buffers` (held by WorldThreeBinding) and `pool detached` (the evaluator's own count of " +
    "buffers whose ownership left the pool) must agree and must reach a steady state during a " +
    "sustained fly-through. Climbing numbers are a leak.",
);

function setError(message: string): void {
  statError(message);
  console.error(`09-gpu-world: ${message}`);
}

// -- flight controls -------------------------------------------------------

let heading = 0;
const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  if (e.key === " ") autopilot = !autopilot;
  keys.add(e.key.toLowerCase());
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

// -- boot ------------------------------------------------------------------

const fps = createFpsMeter((v) => statFps(v));
let updating = false;
let elapsed = 0;
let lastTime = performance.now();

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function frame(): void {
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  elapsed += dt;
  fps();
  statVisible(document.visibilityState);

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

  const g = gpu;
  const r = rig;
  if (g !== undefined && r !== undefined) {
    if (!updating) {
      updating = true;
      r.world
        .update([camera.position.x, 0, camera.position.z], { budgetMs: 6 })
        .then((stats) => {
          if (!r.disposed) lastPending = stats.pending;
        })
        .catch((err: unknown) => setError(String(err)))
        .finally(() => {
          updating = false;
        });
    }
    const ws = r.world.stats();
    const pool = g.evaluator.poolStats;
    statCells(String(ws.levels.find((l) => l.name === "spires")?.cellCount ?? 0));
    statCooked(`${ws.totalCooked} / ${ws.totalEvicted}`);
    statPending(String(lastPending));
    statItems(`${deviceItems} / ${cpuItems}`);
    statDrawn(`${g.adapter.stats.liveInstances} (${deviceInstancesSeen} total)`);
    statBuffers(String(r.binding.deviceHandleCount));
    statBytes(fmtBytes(r.binding.deviceHandleBytes));
    statPool(`${pool.detachedBuffers} / ${fmtBytes(pool.detachedBytes)}`);
    statPoolLife(`${pool.buffersCreated} / ${pool.buffersDestroyed}`);
    statObjects(`${g.adapter.stats.built - g.adapter.stats.released} of ${g.adapter.stats.built}`);
    statPos(`${camera.position.x.toFixed(0)}, ${camera.position.z.toFixed(0)}`);
    g.renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}

/**
 * Verification hook: `pcgHarness.probe()` in the devtools console
 * answers "are these matrices really coming from the device buffer?"
 * without taking anything on trust. For the first live cell mesh it
 * reports the CPU matrix array length (must be 0 — the matrices were
 * never composed on the CPU), the instance count three will draw, and
 * whether the GPUBuffer three's backend holds for that attribute is
 * *identical* to the one the batch's handle owns.
 */
interface HarnessProbe {
  cells: number;
  meshes: number;
  cpuMatrixFloats: number | null;
  instanceCount: number | null;
  isStorageAttribute: boolean | null;
  boundingSphereRadius: number | null;
  frustumCulled: boolean | null;
  backendBufferIsAdopted: boolean | null;
  backendBufferSize: number | null;
  backendBufferUsage: number | null;
  deviceBuffers: number;
  deviceBytes: number;
}

(window as unknown as { pcgHarness: unknown }).pcgHarness = {
  probe(): HarnessProbe {
    const r = rig;
    const g = gpu;
    const out: HarnessProbe = {
      cells: r?.binding.cellCount ?? 0,
      meshes: 0,
      cpuMatrixFloats: null,
      instanceCount: null,
      isStorageAttribute: null,
      boundingSphereRadius: null,
      frustumCulled: null,
      backendBufferIsAdopted: null,
      backendBufferSize: null,
      backendBufferUsage: null,
      deviceBuffers: r?.binding.deviceHandleCount ?? 0,
      deviceBytes: r?.binding.deviceHandleBytes ?? 0,
    };
    if (r === undefined || g === undefined) return out;
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
        out.frustumCulled = mesh.frustumCulled;
        const record = (g.renderer.backend as unknown as { get(o: object): { buffer?: unknown } }).get(
          attr as unknown as object,
        );
        // A GPUBuffer three created for itself would be sized from the
        // attribute's (zero-length) array, so anything big enough to
        // hold the matrices can only be the adopted one.
        const gpuBuffer = record.buffer as { size?: number; usage?: number } | undefined;
        out.backendBufferSize = gpuBuffer?.size ?? null;
        out.backendBufferUsage = gpuBuffer?.usage ?? null;
        out.backendBufferIsAdopted =
          gpuBuffer?.size !== undefined && gpuBuffer.size >= mesh.count * 64;
      }
    }
    return out;
  },
};

async function boot(): Promise<void> {
  const result = await initGpu();
  if ("error" in result) {
    setError(result.error);
    statAdapter("unavailable");
    return;
  }
  gpu = result;
  statAdapter(result.label);
  statError("device-resident");
  const canvas = result.renderer.domElement;
  canvas.style.display = "block";
  document.body.appendChild(canvas);
  const resize = (): void => {
    result.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    result.renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();
  buildWorld();
  requestAnimationFrame(frame);
}

void boot();
