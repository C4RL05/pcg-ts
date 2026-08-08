/**
 * 01 — scatter basic: uniform scatter in bounds, density from a JSON
 * field spec (fbm perlin remapped to [0, 1]) written into the standard
 * `density` attribute, probabilistic density filtering, and instancing
 * through the spawnInstances terminal + the three adapter.
 */
import {
  Graph,
  cook,
  fieldFromJson,
  filterByDensity,
  pointScatterInBounds,
  setAttribute,
  spawnInstances,
  type FieldSpec,
  type GeometryItem,
  type InstancesItem,
} from "pcg-ts";
import { toInstancedMeshes, toPointsObject, type AssetMap } from "pcg-ts/three";
import {
  BoxGeometry,
  BufferGeometry,
  GridHelper,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
} from "three";
import { createFpsMeter } from "../shared/fps.js";
import { createOverlay } from "../shared/overlay.js";
import { makeRecooker } from "../shared/recook.js";
import { createScene } from "../shared/scene.js";

const AREA = 25; // scatter half-extent in world units
// Candidates before the density filter. Kept modest on purpose: at
// 6000 the survivors read as a solid mass and the thinning the
// density field is doing stops being visible, which is the one thing
// this example exists to show.
const COUNT = 2600;

// -- density field as a JSON spec (the agent-facing grammar) ---------------

function densitySpec(frequency: number): FieldSpec {
  return {
    fn: "remap",
    args: [{ fn: "fbm", base: "perlinNoise", opts: { frequency, octaves: 4 } }, -1, 1, 0, 1],
  };
}

// -- graph -----------------------------------------------------------------

let seed = 1;
let frequency = 0.08;

const graph = new Graph(seed);
const scatter = graph.add(pointScatterInBounds, {
  count: COUNT,
  boundsMin: [-AREA, 0, -AREA],
  boundsMax: [AREA, 0, AREA],
});
const density = graph.add(setAttribute, {
  name: "density",
  domain: "point",
  type: "f32",
  tupleSize: 1,
  value: fieldFromJson(densitySpec(frequency)),
});
const filter = graph.add(filterByDensity, { mode: "probabilistic" });
const spawn = graph.add(spawnInstances, { assetId: "box" });
graph.connect(scatter, "out", density, "in");
graph.connect(density, "out", filter, "in");
graph.connect(filter, "out", spawn, "in");
graph.output(spawn, "instances", "instances");
graph.output(spawn, "points", "points");

// -- scene -----------------------------------------------------------------

const { scene, start } = createScene({ cameraPosition: [34, 26, 34] });

const ground = new Mesh(
  new PlaneGeometry(AREA * 2 + 2, AREA * 2 + 2),
  new MeshStandardMaterial({ color: 0x1a2230, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
scene.add(ground);
scene.add(new GridHelper(AREA * 2, 25, 0x2c3a52, 0x1e2939));

const assets: AssetMap = {
  box: {
    geometry: new BoxGeometry(0.35, 0.7, 0.35).translate(0, 0.35, 0),
    material: new MeshStandardMaterial({ color: 0x6fb1ff, roughness: 0.7 }),
  },
};

const instGroup = new Group();
scene.add(instGroup);
let meshes: InstancedMesh[] = [];
let debugPoints: Points<BufferGeometry, PointsMaterial> | undefined;
let showPoints = false;

// -- overlay ---------------------------------------------------------------

const overlay = createOverlay({
  title: "01 · scatter basic",
  info: "pointScatterInBounds → density from a JSON fbm field → filterByDensity (probabilistic) → spawnInstances",
});
const specPre = overlay.addCollapsible("density field JSON", true);
const statFps = overlay.addStat("fps");
const statSurvivors = overlay.addStat("instances");
const statCook = overlay.addStat("cook");
const statCache = overlay.addStat("nodes cooked/cached");

function updateSpecView(): void {
  specPre.textContent = JSON.stringify(densitySpec(frequency), null, 2);
}
updateSpecView();

// -- cook + scene swap -----------------------------------------------------

const recook = makeRecooker(async () => {
  const result = await cook(graph);
  const instances = result.outputs.instances.find(
    (i): i is InstancesItem => i.kind === "instances",
  );
  const points = result.outputs.points.find((i): i is GeometryItem => i.kind === "geometry");

  for (const m of meshes) {
    instGroup.remove(m);
    m.dispose();
  }
  meshes = instances ? toInstancedMeshes(instances.batches, assets) : [];
  for (const m of meshes) instGroup.add(m);

  if (debugPoints) {
    scene.remove(debugPoints);
    debugPoints.geometry.dispose();
    debugPoints.material.dispose();
  }
  debugPoints = points ? toPointsObject(points.geo, { size: 0.25 }) : undefined;
  if (debugPoints) {
    debugPoints.position.y = 0.9;
    debugPoints.visible = showPoints;
    scene.add(debugPoints);
  }

  statSurvivors(`${points?.geo.pointCount ?? 0} / ${COUNT}`);
  statCook(`${result.stats.elapsedMs.toFixed(1)} ms`);
  statCache(`${result.stats.cooked} / ${result.stats.cached}`);
});

overlay.addSeed(seed, (s) => {
  seed = s;
  graph.setSeed(seed);
  recook();
});
overlay.addSlider(
  "density freq",
  { min: 0.02, max: 0.3, step: 0.005, value: frequency, format: (v) => v.toFixed(3) },
  (v) => {
    frequency = v;
    graph.setParam(density, "value", fieldFromJson(densitySpec(frequency)));
    updateSpecView();
    recook();
  },
);
overlay.addCheckbox("debug points", showPoints, (on) => {
  showPoints = on;
  if (debugPoints) debugPoints.visible = on;
});
overlay.addNote("Same seed always reproduces the same scatter — try re-entering it.");

const fps = createFpsMeter((v) => statFps(v));
recook();
start(() => fps());
