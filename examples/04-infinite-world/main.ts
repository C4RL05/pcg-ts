/**
 * 04 — infinite world: a two-level hierarchical World streamed around a
 * flying camera. The coarse level is unbounded (one global cook) and
 * scatters sparse mega-rocks; the fine level (cellSize 20) scatters small
 * rocks per cell, with density read from one shared world-space noise
 * field so cell borders are seamless. Each level's bind wires the cell
 * bounds and ctx.seed into the graph per the LevelDef determinism
 * contract; WorldThreeBinding maps cell lifecycles onto the scene.
 */
import { World, type CellOutputs } from "pcg-ts";
import { WorldThreeBinding, type AssetMap } from "pcg-ts/three";
import { FINE_CELL, makeLandmarkLevel, makeRockLevel } from "./levels.js";
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

let seed = 1;
let speed = 18;
let radius = 140;

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
  disposed: boolean;
}

let rig: WorldRig | undefined;
let lastPending = 0;

function buildWorld(): void {
  if (rig) {
    rig.disposed = true;
    rig.binding.dispose();
    scene.remove(rig.group);
  }
  const group = new Group();
  scene.add(group);
  const binding = new WorldThreeBinding({ group, assets });
  const cellInstances = new Map<string, number>();
  const next: WorldRig = { world: undefined as unknown as World, group, binding, cellInstances, disposed: false };
  next.world = new World({
    seed,
    levels: [makeLandmarkLevel(), makeRockLevel(seed, radius)],
    maxCellsPerLevel: cellCap(radius, FINE_CELL),
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
  // Kick the first update immediately so cells start cooking before the
  // first animation frame (overlapping updates are serialized by World).
  void next.world
    .update([camera.position.x, 0, camera.position.z], { budgetMs: 12 })
    .then((stats) => {
      if (!next.disposed) lastPending = stats.pending;
    })
    .catch((err: unknown) => console.error(err));
}

// -- flight controls -------------------------------------------------------

let heading = 0;
let steer = 0;
const keys = new Set<string>();
window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

// -- overlay ---------------------------------------------------------------

const overlay = createOverlay({
  title: "04 · infinite world",
  info: "Unbounded landmark level + streamed 20u rock cells around a flying camera. Steer with A/D or arrow keys.",
});
const statFps = overlay.addStat("fps");
const statCells = overlay.addStat("rock cells");
const statCooked = overlay.addStat("cooked / evicted");
const statPending = overlay.addStat("pending");
const statInstances = overlay.addStat("instances");
const statPos = overlay.addStat("position");

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
overlay.addNote(
  "Cell content is a pure function of (seed, level, cell coord) — fly away and back, or change the radius: the same rocks return.",
);

// -- frame loop ------------------------------------------------------------

let updating = false;
const fps = createFpsMeter((v) => statFps(v));

buildWorld();
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
    updating = true;
    r.world
      .update([camera.position.x, 0, camera.position.z], { budgetMs: 7 })
      .then((stats) => {
        if (!r.disposed) lastPending = stats.pending;
      })
      .catch((err: unknown) => console.error(err))
      .finally(() => {
        updating = false;
      });
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
