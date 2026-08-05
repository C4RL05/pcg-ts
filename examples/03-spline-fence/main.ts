/**
 * 03 — spline fence: a closed CatmullRom loop becomes pcg spline geometry
 * via fromCurve, splineSample places posts at fixed spacing along the arc
 * length, orientAlongVector turns each sample's `tangent` attribute into
 * the standard `rot` quaternion (default `+z` axis — posts face along the
 * curve), and spawnInstances emits the oriented posts — one graph, one
 * cook. Rails are two TubeGeometry meshes along the same curve.
 */
import {
  Graph,
  attribute,
  cook,
  dataInput,
  firstGeometry,
  hashCombine,
  hashFloat,
  makeGeometryItem,
  orientAlongVector,
  splineSample,
  spawnInstances,
  type InstancesItem,
} from "pcg-ts";
import { fromCurve, toInstancedMeshes, type AssetMap } from "pcg-ts/three";
import {
  BoxGeometry,
  CatmullRomCurve3,
  GridHelper,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import { createFpsMeter } from "../shared/fps.js";
import { createOverlay } from "../shared/overlay.js";
import { makeRecooker } from "../shared/recook.js";
import { createScene } from "../shared/scene.js";

const CONTROL_POINTS = 10;
const CURVE_SEGMENTS = 240;

let seed = 1;
let spacing = 1.6;

// -- deterministic loop curve ---------------------------------------------

function buildCurve(s: number): CatmullRomCurve3 {
  const pts: Vector3[] = [];
  for (let i = 0; i < CONTROL_POINTS; i++) {
    const a = (i / CONTROL_POINTS) * Math.PI * 2;
    const r = 14 + (hashFloat(hashCombine(s, i)) - 0.5) * 9;
    pts.push(new Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  return new CatmullRomCurve3(pts, true, "centripetal");
}

// -- graph -----------------------------------------------------------------
// One graph end to end: sample the spline, orient each post along its
// tangent (orientAlongVector reads the `tangent` attribute as a field and
// writes `rot`), spawn instances. The spawner's `points` passthrough pin
// doubles as the post-count output.

const graph = new Graph(seed);
const curveIn = graph.add(dataInput);
const sampler = graph.add(splineSample, { mode: "spacing", spacing });
const orient = graph.add(orientAlongVector, { direction: attribute("tangent", 3) });
const spawner = graph.add(spawnInstances, { assetId: "post" });
graph.connect(curveIn, "out", sampler, "in");
graph.connect(sampler, "out", orient, "in");
graph.connect(orient, "out", spawner, "in");
graph.output(spawner, "instances", "instances");
graph.output(spawner, "points", "posts");

// -- scene -----------------------------------------------------------------

const { scene, start } = createScene({ cameraPosition: [26, 20, 26] });

scene.add(
  (() => {
    const ground = new Mesh(
      new PlaneGeometry(90, 90),
      new MeshStandardMaterial({ color: 0x1b2433, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    return ground;
  })(),
);
scene.add(new GridHelper(90, 45, 0x2c3a52, 0x1e2939));

const woodMat = new MeshStandardMaterial({ color: 0x8a6440, roughness: 0.9 });
const railMat = new MeshStandardMaterial({ color: 0x9d7a52, roughness: 0.85 });
const assets: AssetMap = {
  // A deliberately non-square post so the tangent orientation is visible.
  post: { geometry: new BoxGeometry(0.12, 1.15, 0.3).translate(0, 0.575, 0), material: woodMat },
};

const fenceGroup = new Group();
scene.add(fenceGroup);
let meshes: InstancedMesh[] = [];
let rails: Mesh[] = [];

// -- overlay ---------------------------------------------------------------

const overlay = createOverlay({
  title: "03 · spline fence",
  info: "CatmullRom loop → fromCurve → splineSample (spacing) → orientAlongVector (tangent) → spawnInstances + tube rails",
});
const statFps = overlay.addStat("fps");
const statPosts = overlay.addStat("posts");
const statLength = overlay.addStat("fence length");
const statCook = overlay.addStat("cook");

// -- rebuild ---------------------------------------------------------------

let curve = buildCurve(seed);

function rebuildRails(): void {
  for (const r of rails) {
    fenceGroup.remove(r);
    r.geometry.dispose();
  }
  rails = [0.52, 0.95].map((y) => {
    const lifted = new CatmullRomCurve3(
      curve.points.map((p) => new Vector3(p.x, p.y + y, p.z)),
      true,
      "centripetal",
    );
    const mesh = new Mesh(new TubeGeometry(lifted, CURVE_SEGMENTS, 0.045, 8, true), railMat);
    fenceGroup.add(mesh);
    return mesh;
  });
}

const recook = makeRecooker(async () => {
  const result = await cook(graph);
  const posts = firstGeometry(result.outputs.posts);
  if (!posts) return;
  const instances = result.outputs.instances.find(
    (i): i is InstancesItem => i.kind === "instances",
  );

  for (const m of meshes) {
    fenceGroup.remove(m);
    m.dispose();
  }
  meshes = instances ? toInstancedMeshes(instances.batches, assets) : [];
  for (const m of meshes) fenceGroup.add(m);

  statPosts(String(posts.pointCount));
  statLength(`${curve.getLength().toFixed(1)} u`);
  statCook(`${result.stats.elapsedMs.toFixed(1)} ms`);
});

function regenerate(): void {
  curve = buildCurve(seed);
  graph.setParam(curveIn, "items", [makeGeometryItem(fromCurve(curve, CURVE_SEGMENTS, true))]);
  rebuildRails();
  recook();
}

overlay.addSeed(seed, (s) => {
  seed = s;
  regenerate();
});
overlay.addSlider(
  "post spacing",
  { min: 0.8, max: 5, step: 0.1, value: spacing, format: (v) => `${v.toFixed(1)} u` },
  (v) => {
    spacing = v;
    graph.setParam(sampler, "spacing", spacing);
    recook();
  },
);
overlay.addNote("Posts face along the curve tangent — the flat side follows the fence line.");

const fps = createFpsMeter((v) => statFps(v));
regenerate();
start(() => fps());
