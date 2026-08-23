/**
 * Roadside dressing along a spline you already have.
 *
 * `demos/road` is this page with none of the placement rules — a
 * deliberate copy, not a mode of this one. Read that first; see its header
 * for why the duplication is the point.
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
import {
  buildInstanceBatches,
  cook,
  firstGeometry,
  type DataCollection,
  type Geometry,
  type Graph,
} from "pcg-ts";
import { toBufferGeometry, toInstancedMeshes, toLineGeometry } from "pcg-ts/three";
import {
  ConeGeometry,
  Euler,
  Fog,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { createFpsMeter } from "../../shared/fps.js";
import { createOverlay } from "../../shared/overlay.js";
import { makeRecooker } from "../../shared/recook.js";
import { attachGraphPanel, type GraphPanelHandle } from "../../shared/graph/panel.js";
import { attachWordmark } from "../../shared/wordmark.js";
import { BACKGROUND } from "../../shared/scene.js";
import { OUTPUTS, buildRoadGraph } from "./graph.js";
import { type DressStats, dressLap } from "./dress.js";
import { DENSITY } from "./stations.js";
import { type Kit, type PlacedBox, loadKit, placeKit } from "./kit.js";
import { shippedVocabulary } from "./vocabulary.js";
import { type Lap, placeAt, poseAt, readLap } from "./lap.js";
import { type Spline, makeTrackSpline, splineBounds } from "./spline.js";
import { ASSET_ATTR, DEFAULT_ASSET, boxCloud } from "./spawn.js";
import {
  type Population,
  disposeAssetMap,
  makeAssetMap,
  makeMapMaterials,
} from "./assets3d.js";

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
 * The pair is kept because the two instanced layers need DIFFERENT
 * transparency in the two passes; the other three layers hold the same
 * colour in both and are a pair only for uniformity. (This comment used
 * to claim the passes differ in hue — true of `demos/road`, which
 * it was copied from, and not of this file since the palette settled.)
 * A pair of materials rather than one re-coloured per pass, because the
 * swap then costs a pointer rather than a uniform upload twice a frame.
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

/**
 * Load the optional MEASURED kit once, before the first cook draws
 * anything. It is the reference layer only; the dressing does not depend
 * on it. See `measuredKit` below.
 */
async function loadReference(): Promise<void> {
  measuredKit = await loadKit();
}

/**
 * The vocabulary the rules dress from.
 *
 * THE MEASURED KIT IS THE REFERENCE, NOT THE SOURCE. It cannot be
 * published — it is derived measurement of a commercial game — so a build
 * without it used to draw placeholder boxes and report "rules idle",
 * which meant the live demo showed none of the thing it exists to show.
 * The dressing now runs on a vocabulary built from the published RULES
 * (see `vocabulary.ts`), and the measured kit, when present, is drawn
 * beside it as the comparison.
 *
 * Which also makes the better point: a generator that only works on one
 * catalogue has demonstrated nothing.
 */
function dressingKit(): Kit {
  // THE MEASURED KIT WHEN THERE IS ONE. The generated vocabulary exists
  // so the PUBLISHED page has something to dress from; making it
  // unconditional was a mistake that confused what ships with what runs,
  // and it cost most of the demo's quality wherever a kit was available.
  //
  // Measured on the same lap under the same rules: dressing from the
  // measured kit gives 2033 boxes at 5.8 per placement from 153 distinct
  // assets, against 580 boxes at 1.7 per placement from 90. The real
  // vocabulary's own box decompositions are what make a placement read as
  // a grandstand rather than as a crate — and 5.8 against the reference
  // layer's 6.1 is why the generated dressing used to sit beside the
  // measured art without looking out of place.
  if (measuredKit) return measuredKit;

  // Otherwise the committed vocabulary: the same measured dimensions and
  // statistics, carrying no level layout and no source identifiers. It is
  // what every visitor to the published page dresses from.
  if (!vocabulary) vocabulary = shippedVocabulary();
  return vocabulary;
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
  new MeshBasicMaterial({ color: 0xffffff, wireframe: true }),
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

/**
 * The measured kit, if one was made available. See `kit.js` — it is
 * optional, absent for almost everyone, and the page owes it nothing.
 */
let measuredKit: Kit | undefined;

/** The published vocabulary the rules dress from. Built once per seed. */
let vocabulary: Kit | undefined;

/** Everything a cook put in the scene, so a recook can take it out again. */
let built: Object3D[] = [];

function disposeBuilt(): void {
  // WHAT THIS OWNS AND WHAT IT DOES NOT, and the ownership rule now comes
  // from the asset map rather than from a name this file has to remember.
  // An instanced mesh BORROWS its geometry — every one of them draws the
  // asset map's single shared unit cube — and OWNS its material, which is
  // a per-mesh clone and the one signal three uses to release that mesh's
  // cached render state. So: dispose the mesh and its two materials,
  // never its geometry. (This used to be spelled as an identity test
  // against a module-level `PROP_BOX`, which was the same rule stated in
  // a way only this file could check.)
  for (const obj of built) {
    scene.remove(obj);
    if (obj instanceof InstancedMesh) {
      obj.dispose();
      continue;
    }
    (obj as Mesh).geometry?.dispose();
  }
  for (const l of layers.slice(1)) {
    l.chase.dispose();
    if (l.map !== l.chase) l.map.dispose();
  }
  built = [];
  // The car is layer 0 and survives every recook; everything after it
  // belongs to the cook that has just been replaced.
  layers.length = 1;
}

/**
 * Draw the measured kit's placements on THIS spline.
 *
 * The whole point of the track frame, made visible. These are 442
 * placements measured on a real circuit, dropped onto a lap they were
 * never measured from, through nothing but a station, a signed lateral
 * and a height. If the two sides mean the same thing by those, this reads
 * as a track; if either has a convention backwards, it reads as a cloud.
 *
 * A REFERENCE AND NOT A TARGET: nothing this page generates is fitted to
 * these. They are drawn beside the generated verges so a person can see
 * whether the generated ones read, which is the judgement no statistic
 * replaced.
 */
function buildReference(circuit: Circuit): SpawnedLayer | undefined {
  // Through `dressingKit`, so the choice of source is made in exactly one
  // place and the shipped vocabulary is parsed once rather than re-wrapped
  // on every cook.
  const from = dressingKit();
  if (from.placements.length === 0) return undefined;
  const lap = circuit.lap;
  const boxes = placeKit(from, lap, (station, lateral, height) => {
    // ONE lookup: `placeAt` already returns the pose it used, so asking
    // `poseAt` for it again is a second binary search over the same lap
    // for a value that is already in hand.
    const { p, pose } = placeAt(lap, { station, lateral, height });
    return { p, across: pose.across, along: pose.dir, up: pose.up };
  });
  return spawnBoxes(boxes, "reference");
}

/**
 * THE GENERATED DRESSING — the thing this page is about.
 *
 * Placed by the rules from the kit's own measurements, drawn with the
 * SAME renderer as the reference so the two can be compared fairly. A
 * different material would be a different picture, and the whole question
 * is whether the generated one reads like the measured one.
 */
function buildDressing(circuit: Circuit): { layer: SpawnedLayer; stats: DressStats } {
  const d = dressLap(dressingKit(), circuit.lap, state.seed, {
    density: state.density,
  });
  return { layer: spawnBoxes(d.boxes, "generated"), stats: d.stats };
}

/** One population's meshes, and the map-pass material each of them swaps to. */
interface SpawnedLayer {
  readonly meshes: readonly InstancedMesh[];
  readonly mapMaterials: Readonly<Record<string, MeshBasicMaterial>>;
  /** Total instances across the meshes — what the readout used to count. */
  readonly count: number;
}

/**
 * Boxes to instanced meshes, through the library's spawner.
 *
 * WHAT CHANGED AND WHAT DID NOT. This used to be a hand-written loop that
 * composed a `Matrix4` per box and pushed it into one `InstancedMesh`.
 * The matrices it built are the same matrices the spawner builds — the
 * box is axis-aligned in the TRACK frame, so the instance's rotation is
 * that frame's three axes as columns, never a yaw about world up, which
 * would be wrong the moment the track has relief. `spawn.ts` writes that
 * frame as the standard `rot` quaternion and the spawner composes
 * `T(P) * R(rot) * S(scale)` from it; `tests/racetrackSpawn.test.ts`
 * checks the two against each other rather than trusting this paragraph.
 *
 * WHAT IT BUYS is one mesh per ASSET ID instead of one mesh for
 * everything. That costs a few more draw calls on a lap that has never
 * been draw-call bound, and it is the entire point: an id is a name a
 * real prop can be bound to, and there was no such name before.
 */
function spawnBoxes(boxes: readonly PlacedBox[], population: Population): SpawnedLayer {
  const batches = buildInstanceBatches(boxCloud(boxes), {
    defaultAssetId: DEFAULT_ASSET,
    assetAttr: ASSET_ATTR,
  });
  // The map's materials are templates: `toInstancedMeshes` clones one per
  // mesh, and the clone is what renders and what releases that mesh's
  // render state on dispose. These originals are never uploaded, so
  // disposing them here is bookkeeping rather than GPU work — and it
  // leaves every live material owned by exactly one mesh, which is what
  // makes `disposeBuilt` correct without a special case.
  const assets = makeAssetMap(population);
  let meshes: InstancedMesh[];
  try {
    meshes = toInstancedMeshes(batches, assets);
  } finally {
    disposeAssetMap(assets);
  }
  // Frustum culling stays off, as it was: the map pass frames the whole
  // circuit at once and the chase pass wants the lap ahead, so there is
  // nothing here a per-mesh sphere test can usefully reject.
  for (const m of meshes) m.frustumCulled = false;
  return {
    meshes,
    mapMaterials: makeMapMaterials(
      population,
      meshes.map((m) => m.name),
    ),
    count: batches.reduce((n, b) => n + b.count, 0),
  };
}

/** Add a spawned population to the scene, one layer per mesh. */
function addSpawned(layer: SpawnedLayer): void {
  for (const mesh of layer.meshes) {
    scene.add(mesh);
    built.push(mesh);
    layers.push({
      obj: mesh,
      // Narrowed because InstancedMesh types its material as one OR an
      // array; the spawner gives each mesh exactly one.
      chase: mesh.material as Material,
      map: layer.mapMaterials[mesh.name],
    });
  }
}

function buildCircuit(circuit: Circuit): void {
  disposeBuilt();

  // The centreline itself, as the spline it is. Drawn in BOTH passes: on
  // the map it is the circuit, and from the car it is the racing line.
  const spline = new LineSegments(
    toLineGeometry(circuit.frames),
    new LineBasicMaterial({ color: 0x00ff00 }),
  );
  spline.frustumCulled = false;
  scene.add(spline);
  built.push(spline);
  layers.push({
    obj: spline,
    chase: spline.material,
    map: new LineBasicMaterial({ color: 0x00ff00 }),
  });

  // The road surface. Wireframe in both passes — from above, its
  // tessellation is exactly what shows whether the sampling stayed even
  // through the corners.
  const road = new Mesh(
    toBufferGeometry(circuit.road),
    new MeshBasicMaterial({ color: 0x333333, wireframe: true }),
  );
  road.frustumCulled = false;
  scene.add(road);
  built.push(road);
  layers.push({
    obj: road,
    chase: road.material,
    map: new MeshBasicMaterial({ color: 0x333333, wireframe: true }),
  });

  // THE GENERATED DRESSING. Placed by the rules from the kit's own
  // measurements, wearing that kit's box decomposition — which is what
  // makes this a picture of the technique rather than of a placeholder.
  //
  // THE RULES ALWAYS RUN. There was a fallback here to the graph's even
  // verge rows, for a viewer with no measured kit — and once the demo
  // began shipping its own vocabulary there is no such viewer, so the
  // branch became unreachable and the placeholder it drew became dead
  // weight in the node graph the panel puts on screen.
  const dressed = buildDressing(circuit);
  addSpawned(dressed.layer);
  lastStats = dressed.stats;

  const reference = buildReference(circuit);
  if (reference) {
    for (const m of reference.meshes) m.visible = state.referenceOn;
    addSpawned(reference);
    referenceMeshes = reference.meshes;
    statReference(`${reference.count} boxes`);
  } else {
    referenceMeshes = [];
    statReference("none — generated only");
  }
}

/**
 * The reference layer, so the checkbox can reach it between cooks.
 *
 * A LIST NOW, NOT ONE MESH. The spawner emits one mesh per asset id, so
 * "the reference" is however many ids its boxes carried — and the toggle
 * has to reach all of them or it hides part of a population.
 */
let referenceMeshes: readonly InstancedMesh[] = [];

/** What the last dressing pass had to repair, for the readouts. */
let lastStats: DressStats | undefined;

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
  title: "racetrack",
  info:
    "A centreline this page did not make, handed to pcg-ts: it sweeps the road and dresses the verges. " +
    "The map is the whole lap from above; the chase view is the only viewpoint the result is ever " +
    "consumed from. Both are wireframe, drawn over each other, and the car is one object in both.",
});

const state = {
  /** Multiplier on D-1's fitted 0.95 placements per W. */
  density: 1,
  seed: 1,
  /** World units per second. */
  speed: 100,
  chaseBack: 16,
  chaseHeight: 6,
  mapOn: true,
  mapZoom: 0.9,
  referenceOn: true,
  paused: false,
  /** Distance travelled round the lap, in world units. */
  station: 0,
};

let circuit: Circuit | undefined;
let graphPanel: GraphPanelHandle | undefined;

overlay.addSeed(state.seed, (seed) => {
  state.seed = seed;
  recook();
});
overlay.addSlider("speed", { min: 0, max: 160, step: 1, value: state.speed }, (v) => {
  state.speed = v;
});
// DENSITY IS THE ONE RULE PARAMETER ON THE PANEL, because it is the one
// a viewer will want to argue with — and because leaving the measured
// reference layer off makes the generated dressing look thinner than the
// two together did. The readout names D-1's accepted band so the slider
// cannot quietly imply that every position on it is equally valid.
overlay.addSlider(
  "density",
  { min: 0.4, max: 3, step: 0.05, value: state.density, format: (v) => `x${v.toFixed(2)}` },
  (v) => {
    state.density = v;
    recook();
  },
);
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
overlay.addCheckbox("reference kit", state.referenceOn, (on) => {
  state.referenceOn = on;
  for (const m of referenceMeshes) m.visible = on;
});
overlay.addCheckbox("pause", state.paused, (on) => {
  state.paused = on;
});

const statFps = overlay.addStat("fps");
const statStation = overlay.addStat("station");
const statLap = overlay.addStat("lap length");
const statProps = overlay.addStat("dressing");
const statReference = overlay.addStat("reference");
const statCover = overlay.addStat("enclosure");
const statCorners = overlay.addStat("corner language");
const statRules = overlay.addStat("repairs");
const statCook = overlay.addStat("cook");

// The slot is claimed HERE, where the panel is built, so this page decides
// where in its own panel the graph sits — under the readouts.
const graphSlot = overlay.addSlot();

attachWordmark();

// ------------------------------------------------------------------ //
// The loop.
// ------------------------------------------------------------------ //

/**
 * A cook, and the trigger that serializes them.
 *
 * COALESCING, NOT DROPPING. This guarded itself with a plain `if (busy)
 * return`, which silently DISCARDS a request made while a cook is in
 * flight — so a seed typed or a slider dragged during the ~250 ms
 * dressing pass was simply lost, and the page kept showing the previous
 * lap with the new value on the panel. `makeRecooker` queues a trailing
 * run instead, which is the behaviour the editor has always had.
 */
async function cookAndBuild(): Promise<void> {
  {
    const next = await cookCircuit(state.seed);
    circuit = next;
    buildCircuit(next);
    frameMap(next, state.mapZoom);
    statLap(`${next.lap.lengthW.toFixed(1)} W (${next.lap.length.toFixed(0)} u)`);
    if (lastStats) {
      const s = lastStats;
      // D-1 in its own units, with the verdict rather than just the
      // number, READ FROM THE SPEC rather than restated here: this line
      // carried 0.6-1.2 by hand while DENSITY says 0.71-1.54, so the
      // verdict on screen was wrong at both edges. `unfinished` is a
      // third verdict and not a synonym for the floor — below it a lap is
      // unfinished rather than sparse, which is the word the spec asks
      // for.
      const band =
        s.perW < DENSITY.unfinished
          ? " — unfinished"
          : s.perW < DENSITY.min
            ? " — under D-1"
            : s.perW > DENSITY.max
              ? " — over D-1"
              : " — inside D-1";
      statProps(
        `${s.placed} placements, ${s.perW.toFixed(2)}/W${band}, ${s.cookMs.toFixed(0)} ms`,
      );
      // The corner language gets its own line: L-2 and L-3 are the only
      // rules that ADD placements, so their two counts are what makes
      // D-1's budget drift explicable rather than mysterious. The losses
      // to the cull are on the same line because L-1 runs after them and
      // has the last word — a marker can be placed correctly and still
      // not survive.
      // MEASURED, not planned. L-6's only real claim is what a ray cast
      // finds, and the dressing already encloses a good deal of lap
      // before any enclosure run is placed — so the interesting numbers
      // are the before and after, not the intent.
      statCover(
        `${(100 * s.enclosureBefore).toFixed(1)}% -> ${(100 * s.enclosureAfter).toFixed(1)}% of lap · ` +
          `+${s.coverStretches} runs (${s.coverPieces} pieces) · ${s.enclosureTrims} trimmed` +
          (s.enclosureBlocked
            ? " · held back by Z-3"
            : s.enclosureNothingToTrim
              ? " · no incidental overhead to trim"
              : ""),
      );
      statCorners(
        `${s.corners} corners (${s.tightCorners} tight) · ` +
          `L-2 ${s.markersConverted}+${s.markersAdded} · ` +
          `L-3 ${s.brakeMarks}-${s.brakeDisplaced} · ` +
          `cull took ${s.markersLostToCull} markers, ${s.rulersLostToCull} rulers`,
      );
      statRules(
        `gaps ${s.stationGapRepairs}+${s.coverageMoves} (worst ${s.worstGapW.toFixed(0)}W) · corridor ${s.corridorFixes} · ` +
          `sightline ${s.blocked} (${s.pushedOut} out, ${s.dropped} cut) · ` +
          `landmarks ${s.landmarkFixes} · false edges ${s.falseEdges}/${s.edgeMoves} · ` +
          `mix ${s.mixMoves}`,
      );
    }
    statCook(`${next.cookMs.toFixed(0)} ms`);
    // Called only when the graph CHANGED — it re-serializes and re-lays
    // out, which is not free and is wasted every frame.
    const graphs = [{ name: "road", graph: next.graph }];
    if (graphPanel) graphPanel.set(graphs);
    else graphPanel = attachGraphPanel(graphs, { into: graphSlot, title: "graph" });
  }
}

const recook = makeRecooker(cookAndBuild);

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

  statStation(
    `${(state.station / circuit.lap.halfWidth).toFixed(1)} / ${circuit.lap.lengthW.toFixed(1)} W`,
  );

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

// The kit first, so the opening cook can draw it: a reference layer that
// appears a beat after the page does reads as a bug rather than as an
// optional extra.
void loadReference()
  .then(() => cookAndBuild())
  .then(() => {
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
    pcgRacetrack?: { seek(station: number): void; pause(on: boolean): void };
  }
}
window.pcgRacetrack = {
  seek(station: number): void {
    state.station = station;
  },
  pause(on: boolean): void {
    state.paused = on;
  },
};

export {};
