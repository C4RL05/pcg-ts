/**
 * 02 — forest: an fbm heightfield displaces a terrain mesh (core fields
 * API used directly, outside any graph), the displaced mesh feeds a graph
 * via fromBufferGeometry + dataInput, surfaceSample scatters candidates,
 * height/slope attributes are stamped from position/normal fields, low
 * slope + below-treeline filters keep the plantable points, and a string
 * setAttribute picks each point's `species` declaratively so spawnInstances
 * splits the spawn into pine and bush instance batches — all in one graph.
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
  type Field,
  type InstancesItem,
} from "pcg-ts";
import { fromBufferGeometry, toInstancedMeshes, type AssetMap } from "pcg-ts/three";
import {
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createFpsMeter } from "../shared/fps.js";
import { createOverlay } from "../shared/overlay.js";
import { makeRecooker } from "../shared/recook.js";
import { createScene } from "../shared/scene.js";

const TERRAIN_SIZE = 240;
const TERRAIN_SEGS = 150;
const HEIGHT_SCALE = 18;
const TREELINE = 9.5; // max height a tree accepts
const MAX_SLOPE = 0.28; // slope = 1 - normal.y

let seed = 1;
let treeCount = 9000;

// -- terrain: heightfield via the core fields API (no graph) ---------------

const terrainGeo = new PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGS, TERRAIN_SEGS);
terrainGeo.rotateX(-Math.PI / 2);
const terrainMesh = new Mesh(
  terrainGeo,
  new MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
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
    const s = remap(randomField("size"), 0, 1, 0.6, 1.5);
    return vec(s, s, s); // one field instance, evaluated once, uniform scale
  })(),
});
// Declarative species pick: a string setAttribute selects into `values`
// per point (floor + clamp), so ~72% index 0 ("pine"), else "bush".
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

// -- scene + assets --------------------------------------------------------

const { scene, start } = createScene({
  cameraPosition: [120, 90, 120],
  fog: { near: 140, far: 460 },
  far: 1200,
});
scene.add(terrainMesh);

const trunkMat = new MeshStandardMaterial({ color: 0x6e4a2f, roughness: 1 });
const pineMat = new MeshStandardMaterial({ color: 0x2f6b3c, roughness: 0.9 });
const bushMat = new MeshStandardMaterial({ color: 0x4c7a3d, roughness: 0.9 });

const pineGeo = mergeGeometries(
  [
    new CylinderGeometry(0.14, 0.2, 1.2, 6).translate(0, 0.6, 0),
    new ConeGeometry(1.0, 2.8, 8).translate(0, 2.4, 0),
  ],
  true,
);
const assets: AssetMap = {
  pine: { geometry: pineGeo, material: [trunkMat, pineMat] },
  bush: {
    geometry: new SphereGeometry(0.62, 7, 5).scale(1, 0.72, 1).translate(0, 0.4, 0),
    material: bushMat,
  },
};

const instGroup = new Group();
scene.add(instGroup);
let meshes: InstancedMesh[] = [];

// -- overlay ---------------------------------------------------------------

const overlay = createOverlay({
  title: "02 · forest",
  info: "fbm heightfield → fromBufferGeometry → surfaceSample → height/slope attrs → filters → pine/bush instances",
});
const statFps = overlay.addStat("fps");
const statPlanted = overlay.addStat("planted (pine/bush)");
const statCook = overlay.addStat("cook");
const statCache = overlay.addStat("nodes cooked/cached");

// -- cook ------------------------------------------------------------------

const recook = makeRecooker(async () => {
  const result = await cook(graph);
  const instances = result.outputs.instances.find(
    (i): i is InstancesItem => i.kind === "instances",
  );
  if (!instances) return;
  const batches = instances.batches;

  for (const m of meshes) {
    instGroup.remove(m);
    m.dispose();
  }
  meshes = toInstancedMeshes(batches, assets);
  for (const m of meshes) instGroup.add(m);

  const pine = batches.find((b) => b.assetId === "pine")?.count ?? 0;
  const bush = batches.find((b) => b.assetId === "bush")?.count ?? 0;
  statPlanted(`${pine + bush} (${pine}/${bush})`);
  statCook(`${result.stats.elapsedMs.toFixed(1)} ms`);
  statCache(`${result.stats.cooked} / ${result.stats.cached}`);
});

function regenerate(): void {
  rebuildTerrain(seed);
  graph.setParam(terrainIn, "items", [makeGeometryItem(fromBufferGeometry(terrainGeo))]);
  graph.setSeed(seed);
  recook();
}

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
overlay.addNote(
  "Trees avoid steep slopes and high altitude. Density counts candidates before filtering.",
);

const fps = createFpsMeter((v) => statFps(v));
regenerate();
start(() => fps());
