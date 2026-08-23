/**
 * Roadside dressing along a spline you already have — the simple one.
 *
 * THE TWIN OF `demos/racetrack`, and the reason there are two.
 * `racetrack` is where the placement rules go: the spec's corner reactions, its variety, its
 * clearance checks, and whatever host-side loop those turn out to need.
 * This page is the same thing with none of that — one spline, one sweep,
 * one evenly spaced row per side — and it stays that way. It is what you
 * read first, and what a reader ports; `racetrack` is what the technique
 * actually becomes.
 *
 * They are a DELIBERATE COPY rather than a shared module with a flag. A
 * flag would mean the simple version is a configuration of the complex
 * one, so reading it means reading past every branch the complex one
 * needs — which is the thing a simple version exists to spare you. The
 * price is that the two drift, and that is the intended direction: `diff
 * demos/racetrack demos/road` is meant to read as what the rules added.
 * Everything below the identity strings is byte-identical today.
 *
 * WHAT THIS PAGE IS FOR. A road is not the interesting part of a road —
 * the interesting part is everything standing beside it, and where that
 * comes from. So the page is handed a centreline it did not make
 * (`spline.ts`), pcg-ts turns it into a surface and populates its verges
 * (`graph.ts`), and the page's whole job is to let you judge the result
 * from the two viewpoints that can actually judge it.
 *
 * TWO VIEWS IN ONE FRAME, OVER EACH OTHER. A layout is two questions.
 * The MAP answers "is the whole lap dressed, and does the dressing follow
 * the road" — a question only an orthographic view of the entire circuit
 * can answer. The CHASE view answers "what does a driver see", which no
 * map can answer and which is the only viewpoint the result is ever
 * consumed from. They are drawn OVER each other rather than side by side
 * so the two readings share every pixel instead of splitting the screen,
 * and the car is one object in both, so they can never disagree about
 * where the player is.
 *
 * EVERYTHING IS WIREFRAME, and that is not a placeholder for shading. The
 * output of this technique is a COMPOSITION — what is where, at what size,
 * facing which way. Solid boxes with a light on them would read as bad
 * art; a wireframe reads as what it is, which is the measurement.
 */
import { cook, firstGeometry, type DataCollection, type Geometry, type Graph } from "pcg-ts";
import { toBufferGeometry, toLineGeometry } from "pcg-ts/three";
import {
  BoxGeometry,
  ConeGeometry,
  Euler,
  Fog,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { createFpsMeter } from "../../shared/fps.js";
import { createOverlay } from "../../shared/overlay.js";
import { attachGraphPanel, type GraphPanelHandle } from "../../shared/graph/panel.js";
import { attachWordmark } from "../../shared/wordmark.js";
import { BACKGROUND } from "../../shared/scene.js";
import { OUTPUTS, buildRoadGraph } from "./graph.js";
import { type Lap, poseAt, readLap } from "./lap.js";
import { type Spline, makeTrackSpline, splineBounds } from "./spline.js";

// ------------------------------------------------------------------ //
// The cook.
// ------------------------------------------------------------------ //

/** One cooked circuit: what to draw, and what to say about it. */
interface Circuit {
  readonly spline: Spline;
  readonly graph: Graph;
  readonly lap: Lap;
  readonly frames: Geometry;
  readonly road: Geometry;
  readonly props: Geometry;
  readonly cookMs: number;
}

function requireGeo(name: string, collection: DataCollection | undefined): Geometry {
  const geo = collection ? firstGeometry(collection) : undefined;
  if (!geo) throw new Error(`road: the graph produced no '${name}' geometry`);
  return geo;
}

async function cookCircuit(seed: number): Promise<Circuit> {
  const t0 = performance.now();
  const spline = makeTrackSpline({ seed });
  const graph = buildRoadGraph({ spline, seed });
  const out = (await cook(graph)).outputs;
  const frames = requireGeo(OUTPUTS.frames, out[OUTPUTS.frames]);
  return {
    spline,
    graph,
    lap: readLap(frames),
    frames,
    road: requireGeo(OUTPUTS.road, out[OUTPUTS.road]),
    props: requireGeo(OUTPUTS.props, out[OUTPUTS.props]),
    cookMs: performance.now() - t0,
  };
}

// ------------------------------------------------------------------ //
// The page.
// ------------------------------------------------------------------ //

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// Two full-screen passes per frame, so clearing is manual: the second
// pass has to land ON the first rather than replace it.
//
// AND THE BACKGROUND IS THE RENDERER'S, NOT THE SCENE'S. A scene with a
// colour background clears the colour buffer at the start of EVERY render
// regardless of `autoClear` — the background pass forces it — so leaving
// it on the scene means the map pass wipes the chase image a moment
// before drawing over it.
renderer.autoClear = false;
renderer.setClearColor(BACKGROUND, 1);
document.body.appendChild(renderer.domElement);

// No lights: nothing here is lit. See the header — the wireframe IS the
// output, and a lit wireframe is a contradiction.
const scene = new Scene();

/**
 * Fog for the chase pass only.
 *
 * It is what gives an eye-level shot its depth and it is exactly wrong
 * for the map: a camera parked above the whole circuit sits far beyond
 * any fog range that reads from a car, so the same fog that makes one
 * pass legible erases the other. Swapped per pass rather than compromised
 * into a distance that suits neither.
 */
const CHASE_FOG = new Fog(BACKGROUND, 60, 420);

/**
 * One drawable, and the two looks it has.
 *
 * The passes differ in HUE, not in geometry: the chase view is the warm
 * near reading and the map is the cool overview, so two wireframes on the
 * same pixels stay separable. Kept as a pair of materials rather than one
 * material re-coloured per pass, because the swap then costs a pointer
 * rather than a uniform upload twice a frame.
 */
interface Layer {
  readonly obj: Object3D;
  readonly chase: Material;
  readonly map: Material;
}

const layers: Layer[] = [];

/**
 * How much bigger the car is drawn on the map than in the world.
 *
 * The car is ONE object in both passes, which is what keeps the two views
 * from ever disagreeing about where the player is — but a five-unit wedge
 * on a five-thousand-unit lap is a sub-pixel speck from above. So the map
 * pass scales it to a fixed share of the FRAME rather than of the world,
 * which is what every map marker does and what no world-space size can
 * be. Set by {@link frameMap}, because the frame is what it is a share
 * of.
 */
let mapMarkerScale = 1;

function setPass(pass: "chase" | "map"): void {
  for (const l of layers) {
    (l.obj as Mesh).material = pass === "chase" ? l.chase : l.map;
  }
  car.scale.setScalar(pass === "map" ? mapMarkerScale : 1);
}

/** The map. Orthographic, because a layout read in perspective is a lie. */
const mapCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 8000);
// +Z runs DOWN the screen, so the map reads like a map rather than like a
// mirror of one.
mapCamera.up.set(0, 0, -1);

/** The travelling view: a chase camera behind and above the car. */
const chaseCamera = new PerspectiveCamera(65, 1, 0.1, 4000);

/**
 * The car — a wedge, drawn in both passes.
 *
 * In the CHASE pass it is the subject; in the MAP pass it is the player
 * position, which is one of the two things the map exists to show. ONE
 * object rather than a car and a separate marker, so the two views can
 * never disagree about where on the lap the player is.
 */
const car = new Mesh(
  new ConeGeometry(1.8, 5, 3),
  new MeshBasicMaterial({ color: 0xffd7a8, wireframe: true }),
);
car.frustumCulled = false;
scene.add(car);
layers.push({
  obj: car,
  chase: car.material,
  map: new MeshBasicMaterial({ color: 0xffffff, wireframe: true }),
});

// ------------------------------------------------------------------ //
// Building the drawables from a cook.
// ------------------------------------------------------------------ //

/** Everything a cook put in the scene, so a recook can take it out again. */
let built: Object3D[] = [];

function disposeBuilt(): void {
  for (const obj of built) {
    scene.remove(obj);
    (obj as Mesh).geometry?.dispose();
  }
  built = [];
  // The car is layer 0 and survives every recook; everything after it
  // belongs to the cook that has just been replaced.
  layers.length = 1;
}

/** The placeholder prop. See `dressVerges` in graph.ts. */
const PROP_BOX = new BoxGeometry(1, 1, 1);
const PROP_SIZE = new Vector3(1.6, 3.2, 1.6);
const scratchMatrix = new Matrix4();
const scratchPos = new Vector3();
const scratchQuat = new Quaternion();

function buildCircuit(circuit: Circuit): void {
  disposeBuilt();

  // The centreline itself, as the spline it is. Drawn in BOTH passes: on
  // the map it is the circuit, and from the car it is the racing line.
  const spline = new LineSegments(
    toLineGeometry(circuit.frames),
    new LineBasicMaterial({ color: 0x8fd0ff }),
  );
  spline.frustumCulled = false;
  scene.add(spline);
  built.push(spline);
  layers.push({
    obj: spline,
    chase: spline.material,
    map: new LineBasicMaterial({ color: 0xffffff }),
  });

  // The road surface. Wireframe in both passes — from above, its
  // tessellation is exactly what shows whether the sampling stayed even
  // through the corners.
  const road = new Mesh(
    toBufferGeometry(circuit.road),
    new MeshBasicMaterial({ color: 0x44586c, wireframe: true }),
  );
  road.frustumCulled = false;
  scene.add(road);
  built.push(road);
  layers.push({
    obj: road,
    chase: road.material,
    map: new MeshBasicMaterial({ color: 0x2c3a48, wireframe: true }),
  });

  // The dressing. Instanced boxes at each placement, because the SIZE is
  // part of what is being judged and a point sprite has none.
  // PLACEHOLDER GEOMETRY: the spec decides what these become.
  const P = circuit.props.attrs.point.require("P");
  const n = circuit.props.pointCount;
  const props = new InstancedMesh(
    PROP_BOX,
    new MeshBasicMaterial({ color: 0x7de2b0, wireframe: true }),
    n,
  );
  for (let i = 0; i < n; i++) {
    // Sat ON the verge rather than centred on it: the placement is a
    // ground position, so the box is raised by half its own height.
    scratchPos.set(P.data[i * 3], P.data[i * 3 + 1] + PROP_SIZE.y / 2, P.data[i * 3 + 2]);
    scratchMatrix.compose(scratchPos, scratchQuat, PROP_SIZE);
    props.setMatrixAt(i, scratchMatrix);
  }
  props.instanceMatrix.needsUpdate = true;
  props.frustumCulled = false;
  scene.add(props);
  built.push(props);
  layers.push({
    obj: props,
    chase: props.material,
    map: new MeshBasicMaterial({ color: 0x4a9a76, wireframe: true }),
  });
}

/**
 * Frame the whole circuit in the map camera.
 *
 * Recomputed on resize as well as on recook: an orthographic frustum
 * carries the aspect ratio itself, so a window that changes shape
 * squashes the map until this runs again.
 */
function frameMap(circuit: Circuit, zoom: number): void {
  const { min, max } = splineBounds(circuit.spline);
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const aspect = window.innerWidth / window.innerHeight;
  // Padded so the outermost dressing is inside the frame rather than
  // clipped by it: the verges are the point, and they sit outside the
  // centreline's own extents.
  const pad = 1.12 / zoom;
  const half = Math.max((max[0] - min[0]) / 2 / aspect, (max[2] - min[2]) / 2) * pad;
  mapCamera.left = -half * aspect;
  mapCamera.right = half * aspect;
  mapCamera.top = half;
  mapCamera.bottom = -half;
  mapCamera.position.set(cx, max[1] + 2000, cz);
  mapCamera.lookAt(cx, 0, cz);
  mapCamera.updateProjectionMatrix();
  // A marker about a twentieth of the frame's height, whatever the lap
  // measures and whatever the zoom is. The car is 5 units long.
  mapMarkerScale = (half * 2) / 20 / 5;
}

// ------------------------------------------------------------------ //
// The panel.
// ------------------------------------------------------------------ //

const overlay = createOverlay({
  title: "road",
  info:
    "A centreline this page did not make, handed to pcg-ts: it sweeps the road and dresses the verges. " +
    "The map is the whole lap from above; the chase view is the only viewpoint the result is ever " +
    "consumed from. Both are wireframe, drawn over each other, and the car is one object in both.",
});

const state = {
  seed: 1,
  /** World units per second. */
  speed: 45,
  chaseBack: 16,
  chaseHeight: 6,
  mapOn: true,
  mapZoom: 1,
  paused: false,
  /** Distance travelled round the lap, in world units. */
  station: 0,
};

let circuit: Circuit | undefined;
let graphPanel: GraphPanelHandle | undefined;

overlay.addSeed(state.seed, (seed) => {
  state.seed = seed;
  void recook();
});
overlay.addSlider("speed", { min: 0, max: 160, step: 1, value: state.speed }, (v) => {
  state.speed = v;
});
overlay.addSlider("chase back", { min: 4, max: 60, step: 1, value: state.chaseBack }, (v) => {
  state.chaseBack = v;
});
overlay.addSlider("chase height", { min: 1, max: 30, step: 0.5, value: state.chaseHeight }, (v) => {
  state.chaseHeight = v;
});
overlay.addCheckbox("map overlay", state.mapOn, (on) => {
  state.mapOn = on;
});
overlay.addSlider("map zoom", { min: 0.5, max: 4, step: 0.05, value: state.mapZoom }, (v) => {
  state.mapZoom = v;
  if (circuit) frameMap(circuit, state.mapZoom);
});
overlay.addCheckbox("pause", state.paused, (on) => {
  state.paused = on;
});

const statFps = overlay.addStat("fps");
const statStation = overlay.addStat("station");
const statLap = overlay.addStat("lap length");
const statProps = overlay.addStat("dressing");
const statCook = overlay.addStat("cook");

// The slot is claimed HERE, where the panel is built, so this page decides
// where in its own panel the graph sits — under the readouts.
const graphSlot = overlay.addSlot();

attachWordmark();

// ------------------------------------------------------------------ //
// The loop.
// ------------------------------------------------------------------ //

let recooking = false;

async function recook(): Promise<void> {
  if (recooking) return;
  recooking = true;
  try {
    const next = await cookCircuit(state.seed);
    circuit = next;
    buildCircuit(next);
    frameMap(next, state.mapZoom);
    statLap(`${next.lap.length.toFixed(0)} u`);
    statProps(`${next.props.pointCount} placements`);
    statCook(`${next.cookMs.toFixed(0)} ms`);
    // Called only when the graph CHANGED — it re-serializes and re-lays
    // out, which is not free and is wasted every frame.
    const graphs = [{ name: "road + verges", graph: next.graph }];
    if (graphPanel) graphPanel.set(graphs);
    else graphPanel = attachGraphPanel(graphs, { into: graphSlot, title: "graph" });
  } finally {
    recooking = false;
  }
}

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight);
  chaseCamera.aspect = window.innerWidth / window.innerHeight;
  chaseCamera.updateProjectionMatrix();
  if (circuit) frameMap(circuit, state.mapZoom);
}
window.addEventListener("resize", resize);
resize();

const fps = createFpsMeter(statFps);

/** How far ahead of the car the chase camera looks, in world units. */
const LOOK_AHEAD = 24;

let last = performance.now();
function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  fps();

  if (!circuit) return;
  if (!state.paused) state.station += state.speed * dt;

  const here = poseAt(circuit.lap, state.station);
  const ahead = poseAt(circuit.lap, state.station + LOOK_AHEAD);

  // The car sits ON the centreline, nose along the tangent. The cone is
  // built pointing +Y, so it is laid down a quarter turn and then spun to
  // the heading.
  car.position.set(here.p[0], here.p[1] + 1, here.p[2]);
  car.setRotationFromEuler(new Euler(Math.PI / 2, 0, -Math.atan2(here.dir[0], here.dir[2])));

  chaseCamera.position.set(
    here.p[0] - here.dir[0] * state.chaseBack + here.up[0] * state.chaseHeight,
    here.p[1] - here.dir[1] * state.chaseBack + here.up[1] * state.chaseHeight,
    here.p[2] - here.dir[2] * state.chaseBack + here.up[2] * state.chaseHeight,
  );
  chaseCamera.up.set(here.up[0], here.up[1], here.up[2]);
  chaseCamera.lookAt(ahead.p[0], ahead.p[1] + 1.5, ahead.p[2]);

  statStation(`${state.station.toFixed(0)} / ${circuit.lap.length.toFixed(0)} u`);

  // PASS 1 — the chase view: near, fogged, warm.
  setPass("chase");
  scene.fog = CHASE_FOG;
  renderer.clear();
  renderer.render(scene, chaseCamera);

  // PASS 2 — the map, as a wireframe over it. The depth buffer is cleared
  // between them: the map is a drawing ON the image, and depth from a
  // camera two thousand units up has nothing to say about one at eye
  // level.
  if (state.mapOn) {
    setPass("map");
    scene.fog = null;
    renderer.clearDepth();
    renderer.render(scene, mapCamera);
  }
}

void recook().then(() => {
  frame();
});

/**
 * The capture probe.
 *
 * `scripts/capture-demos.mjs` has to photograph this page at a REPEATABLE
 * moment, and pausing it from the outside stops the lap wherever it had
 * got to — which is a function of how fast the machine booted. Setting the
 * station directly is the same picture on every machine.
 */
declare global {
  interface Window {
    pcgRoad?: { seek(station: number): void; pause(on: boolean): void };
  }
}
window.pcgRoad = {
  seek(station: number): void {
    state.station = station;
  },
  pause(on: boolean): void {
    state.paused = on;
  },
};

export {};
