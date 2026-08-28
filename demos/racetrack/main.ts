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
 *
 * THE DRESSING ARRIVES IN SECTORS. The rules still settle the WHOLE lap at
 * once — they have to, because a corner's marker is a statement about the
 * circuit rather than about the stretch of it a car can see — and only the
 * settled list is cut into arc sectors, which cook as the car reaches them
 * and are dropped behind it. `levels.ts` argues where that cut falls and
 * why the union of the sectors is the whole lap box for box.
 *
 * WHICH COSTS THE MAP THE QUESTION IT WAS FOR, and the page says so rather
 * than pretending otherwise. "Is the whole lap dressed" cannot be read off
 * a view that only ever holds five sectors of it; what the map shows now
 * is the resident window sliding round the circuit. The `sectors` readout
 * is the honest replacement — how much of the lap is live against how much
 * of it there is — and the union claim itself is a test
 * (`tests/racetrackLevels.test.ts`), which is where a claim about every
 * sector belongs anyway.
 */
import {
  CookCancelledError,
  World,
  buildInstanceBatches,
  cook,
  firstGeometry,
  type DataCollection,
  type Geometry,
  type Graph,
} from "pcg-ts";
import {
  WorldThreeBinding,
  ownsGeometry,
  toBufferGeometry,
  toInstancedMeshes,
  toLineGeometry,
  type AssetMap,
} from "pcg-ts/three";
import {
  ConeGeometry,
  Euler,
  Fog,
  Group,
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
import type { PlaceableAsset } from "./assets.js";
import { cookReserveMarkers } from "./cornerGraph.js";
import { SEVERITY, cornersOf } from "./corners.js";
import type { MarkerKit } from "./legibility.js";
import { DENSITY } from "./stations.js";
import { type Kit, type PlacedBox, loadKit, placeKit } from "./kit.js";
import { shippedVocabulary } from "./vocabulary.js";
import { type Lap, placeAt, poseAt, readLap } from "./lap.js";
import { type Spline, makeTrackSpline, splineBounds } from "./spline.js";
import { ASSET_ATTR, DEFAULT_ASSET, boxCloud } from "./spawn.js";
import {
  DRESS_OUTPUTS,
  languagePoses,
  poseLibrary,
  readEnclosure,
  readRepairs,
  type EnclosureReport,
  type RepairReport,
} from "./dressGraph.js";
import {
  AHEAD_SECTORS,
  BEHIND_SECTORS,
  LEVELS,
  buildRacetrackLevels,
} from "./levels.js";
import {
  type Population,
  disposeAssetMap,
  disposePoseAssetMap,
  makeAssetMap,
  makeMapMaterials,
  makePoseAssetMap,
  makeStreamedMapMaterial,
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
 * One drawable this page owns, and the two looks it has.
 *
 * The pair is kept because the reference layer needs DIFFERENT
 * transparency in the two passes; the other three layers hold the same
 * colour in both and are a pair only for uniformity. (This comment used
 * to claim the passes differ in hue — true of `demos/road`, which
 * it was copied from, and not of this file since the palette settled.)
 * A pair of materials rather than one re-coloured per pass, because the
 * swap then costs a pointer rather than a uniform upload twice a frame.
 *
 * WHAT IS NOT IN THIS LIST any more is the generated dressing. Its meshes
 * are minted and freed by the world binding as sectors stream in and out,
 * so a list this page appends to would hold a mesh the binding has already
 * disposed within one frame of the car passing it. {@link paintStreamed}
 * reaches them the only way there is: by walking the live cell groups.
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
  paintStreamed(pass);
  car.scale.setScalar(pass === "map" ? mapMarkerScale : 1);
}

/**
 * Each streamed mesh's own chase material, remembered the first time the
 * map pass borrows it.
 *
 * IT HAS TO BE REMEMBERED BECAUSE THE BINDING OWNS IT. `toInstancedMeshes`
 * clones the asset map's template per mesh, and that clone's `dispose()`
 * is the one signal three accepts to release the mesh's cached render
 * state — so handing the mesh back the TEMPLATE instead would leave the
 * clone unreachable and disposed by nobody. Weak, because the mesh's own
 * lifetime is the right lifetime for the entry: the binding frees it when
 * its sector goes and nothing here should keep either alive.
 */
const chaseOf = new WeakMap<Object3D, Material>();

/**
 * The streamed dressing's half of the pass swap.
 *
 * ONE BORROWED MATERIAL FOR THE WHOLE POPULATION, and the borrow lasts
 * exactly from here to the end of the map render. That window is the
 * invariant the rest of this file depends on: a mesh caught holding the
 * shared material by an evict or a teardown would have it disposed as if
 * it were the mesh's own, killing it for every other sector at once. The
 * window contains no `world.update` and no `await`, so nothing that
 * disposes a mesh can run inside it — which is why the restore is a plain
 * statement after the render rather than a guard on the dispose path.
 */
function paintStreamed(pass: "chase" | "map"): void {
  const rig = streamed;
  if (!rig) return;
  for (const cell of rig.group.children) {
    for (const mesh of cell.children) {
      if (pass === "map") {
        // Recorded once, on first sight, when the material is guaranteed
        // to still be the mesh's own: a second record would overwrite the
        // clone with the shared material and lose it.
        if (!chaseOf.has(mesh)) chaseOf.set(mesh, (mesh as Mesh).material as Material);
        (mesh as Mesh).material = rig.mapMaterial;
        continue;
      }
      const own = chaseOf.get(mesh);
      if (own) (mesh as Mesh).material = own;
    }
  }
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
  // measured kit gives 1980 boxes at 5.59 per placement from 150 distinct
  // assets. The real vocabulary's own box decompositions are what make a
  // placement read as a grandstand rather than as a crate — and 5.59
  // against the reference layer's 6.08 is why the generated dressing sits
  // beside the measured art without looking out of place.
  //
  // TWO THINGS ABOUT THOSE NUMBERS, both found on 2026-08-28 and both
  // worth having here rather than in a commit message.
  //
  // THE FIRST IS THAT THEY MOVED, from 2033 / 5.8 / 153. Z-3's donor order
  // changed which placements the mix redraws, so a lap keeps the same
  // stations and the same COUNT and carries different assets at some of
  // them — and a box count is a sum over what each asset decomposes into.
  // The seed and the lap are unchanged.
  //
  // THE SECOND IS THAT THE COMPARISON THIS SENTENCE USED TO MAKE NO LONGER
  // EXISTS. It read "against 580 boxes at 1.7 per placement from 90", and
  // re-measuring that arm gives 1980 / 5.59 / 150 — the SAME lap, to the
  // box. `vocabulary.json` is now the anonymised dump of this same
  // catalogue: 229 assets either way, the same ids, the same 362 recorded
  // placements and 2200 library boxes, differing only in the names. So the
  // branch below is still the right one to take — a checkout with no local
  // manifest must dress from something — but it is no longer a fallback of
  // lower quality, and any argument that rests on it being one needs
  // rebuilding before it is quoted again.
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
  // WHAT THIS OWNS AND WHAT IT DOES NOT, and the ownership rule is now
  // ASKED rather than remembered. An instanced mesh OWNS its material,
  // which is a per-mesh clone and the one signal three uses to release
  // that mesh's cached render state — disposed below with the rest of the
  // layer materials. Its GEOMETRY is usually borrowed: every box mesh
  // this page spawns today draws the asset map's single shared unit cube,
  // and throwing that away would pull the buffers out from under the next
  // cook. But a batch carrying NAMED per-instance channels is handed a
  // geometry CLONE of its own, because an `InstancedBufferAttribute`
  // lives on the geometry — and that clone is disposed by nobody but
  // here. `ownsGeometry` is the marker `toInstancedMeshes` leaves on the
  // mesh, so the question is answered by the mesh instead of by a name
  // this file has to keep in sync. (It was spelled as an identity test
  // against a module-level `PROP_BOX` once, then as an unconditional
  // skip; both were the borrowed case stated as if it were the only one.)
  for (const obj of built) {
    scene.remove(obj);
    if (obj instanceof InstancedMesh) {
      obj.dispose();
      if (ownsGeometry(obj)) obj.geometry.dispose();
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

  // THE GENERATED DRESSING IS NOT BUILT HERE. It is the one population on
  // this page that streams, so its meshes come and go with the sectors
  // rather than with the cook — see {@link buildStreamedDressing}, which
  // this function's caller runs immediately after it.

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

/**
 * WHAT THE LAP LEVEL DECIDED, WHICH IS NOW THE ONLY LAP THIS PAGE KNOWS
 * ANYTHING ABOUT.
 *
 * THERE USED TO BE A SECOND ONE BESIDE IT. `lastStats` held `dressLap`'s
 * `DressStats`, and two of the four readouts read it -- a lap settled in
 * TypeScript before the level cooked, short by exactly the cover the
 * level was about to build (11, 16 and 16 pieces on seeds 1-3). The page
 * does not run that pass at all any more: the level decides the list, so
 * there is no second lap for a readout to be describing by mistake, which
 * is a thing this page had to keep saying and no longer has to.
 *
 * IT ARRIVES LATE, AND THAT IS THE WHOLE REASON THE VARIABLE EXISTS. The
 * lap level cooks under a frame budget, so its figures land some frames
 * after the panel was first drawn. Until they do, every readout below
 * says so rather than filling the gap with a number about something else.
 */
let lastLap:
  | {
      readonly enclosure: EnclosureReport;
      readonly repairs: RepairReport;
      readonly placed: number;
      /**
       * Wall clock from the World being built to the lap cell landing.
       *
       * NOT COMPARABLE WITH THE `cookMs` THIS REPLACES, and the label on
       * the panel says a different word for that reason. `dressLap` ran
       * synchronously and reported its own compute time; the level is
       * budgeted across frames, so this includes every frame it waited.
       * It is the honest answer to "how long until the lap was there",
       * which is the question a viewer watching it appear is asking.
       */
      readonly readyMs: number;
    }
  | undefined;

// ------------------------------------------------------------------ //
// The streamed dressing.
// ------------------------------------------------------------------ //

/**
 * Per-update cook budget, and a hard cap on cells per update.
 *
 * Small on purpose. A sector is a filter, a scale and a spawn over a few
 * hundred placements, so the cap is about smoothing a burst — the moment
 * the lap level lands and the whole window of five sectors becomes
 * cookable at once — rather than about the cost of any one of them. The
 * FIRST update gets more because nothing is on screen yet and a frame's
 * worth of jank buys the opening picture.
 */
const BUDGET_MS = 7;
const FIRST_BUDGET_MS = 12;
const MAX_COOKS_PER_UPDATE = 8;

/**
 * One World and everything that dies with it.
 *
 * A RIG RATHER THAN LOOSE MODULE STATE, because a rebuild starts the next
 * world while the outgoing one's update may still be settling: every
 * callback and every `.then` has to be able to ask whether the world IT
 * belongs to is still the live one, and a set of module variables that
 * have already been reassigned cannot answer that.
 */
interface StreamedDressing {
  /**
   * Assigned a line after the rig is built, because the World's own
   * callbacks close over the rig: one of the two has to exist first, and
   * a rig with a hole in it for one statement is cheaper to read than a
   * pair of callbacks reaching through a module-level variable.
   */
  world: World;
  readonly group: Group;
  readonly binding: WorldThreeBinding;
  /** Pose meshes AND their geometry; freed only after the binding is. */
  readonly assets: AssetMap;
  /** The one flat colour the whole population wears on the map. */
  readonly mapMaterial: MeshBasicMaterial;
  /** Cancels this world's in-flight update when it is torn down. */
  readonly abort: AbortController;
  /**
   * The lap's half-width, carried so the anchor cannot be computed
   * against a different lap than the sectors were cut from.
   */
  readonly halfWidth: number;
  readonly sectorCount: number;
  /**
   * The sector length the World actually cut, which is not the one that
   * was asked for. `cellSize` is rounded to a whole number of sectors, so
   * a 20 W request on a 286 W lap cuts 20.4 W -- and a readout naming the
   * request would be the one place in the page repeating a number the
   * runtime had already rounded away.
   */
  readonly sectorW: number;
  /** Which sectors are resident, for the readout. */
  readonly live: Set<number>;
  disposed: boolean;
}

let streamed: StreamedDressing | undefined;
/**
 * Wanted cells the last update could not get to.
 *
 * UNDEFINED UNTIL AN UPDATE HAS ANSWERED, which is not the same number as
 * zero. The lap level's own cell is a wanted cell and it takes the longest
 * cook on the page, so a readout that printed 0 from the start would claim
 * a settled world during precisely the seconds it is furthest from one.
 */
let lastPending: number | undefined;

/**
 * Tear the current world down, in the one order that is correct.
 *
 * MARK, ABORT, UNBIND, UNPARENT, AND ONLY THEN FREE THE ASSETS. The pose
 * map owns the GEOMETRY every streamed mesh draws — `toInstancedMeshes`
 * shares it by reference and never clones it — so freeing it before the
 * binding has disposed those meshes would pull the buffers out from under
 * live draw calls. That is the opposite of the box map's rule, where the
 * shared cube belongs to nobody and the map is freed the instant the
 * meshes exist; `assets3d.ts` states both.
 *
 * The shared map material is safe to free here for the reason
 * {@link paintStreamed} gives: outside the map render no mesh is holding
 * it, and nothing can run inside that window.
 *
 * AND THE LAST THREE STEPS ARE NOT SKIPPABLE. `WorldThreeBinding.dispose`
 * is entitled to throw: it tears every cell down and only then rethrows
 * the first failure it hit — its `attempt` helper exists for precisely
 * that — so by the time it throws, its meshes are already gone and this
 * map's geometry is already unreachable from anything but here. Letting
 * the throw escape past these three would strand a group in the scene and
 * a whole vocabulary of merged geometry that nothing in the process could
 * ever free. A recook is what calls this, so it is not a rare path.
 */
function disposeStreamedDressing(): void {
  const rig = streamed;
  if (!rig) return;
  streamed = undefined;
  rig.disposed = true;
  rig.abort.abort();
  try {
    rig.binding.dispose();
  } finally {
    scene.remove(rig.group);
    disposePoseAssetMap(rig.assets);
    rig.mapMaterial.dispose();
  }
}

/**
 * THE GENERATED DRESSING — the thing this page is about, now streamed.
 *
 * Placed by the rules from the kit's own measurements and drawn with the
 * same renderer as the reference, so the two can still be compared fairly.
 *
 * AND THE LIST IS THE LEVEL'S OWN NOW. `placements` is not passed at all:
 * the lap level runs the station process, D-4's repair, the asset choice,
 * the assembly, the corner language and every repair rule, settles the
 * whole lap once, and `buildRacetrackLevels` cuts what it settled into arc
 * sectors. A sector becomes geometry when the car is near enough to want
 * it. Everything below comes from `reserveMarkers`, which is the one cook
 * that stays outside the graph -- it decides WHICH ASSETS EXIST before
 * anything is dressed, so it cannot be a stage inside the graph that
 * consumes its answer.
 *
 * ONE INSTANCE PER PLACEMENT rather than per box, which is why the asset
 * map is keyed by POSE. The reference layer beside it still draws a box
 * each — the two are different pictures of the same numbers, and
 * `assets3d.ts` argues why both are wanted.
 */
function buildStreamedDressing(
  circuit: Circuit,
  kit: Kit,
  reservation: { readonly markers?: MarkerKit; readonly pool: PlaceableAsset[] },
): {
  lapGraph: Graph;
  dressingGraph: Graph;
} {
  disposeStreamedDressing();
  const { markers } = reservation;
  const built = buildRacetrackLevels({
    kit,
    lap: circuit.lap,
    frames: circuit.frames,
    // NO `placements`. That is what this whole campaign was for.
    seed: state.seed,
    // L-3's braking mark, and nothing else: L-1 must DROP a blocked ruler
    // rather than shove it to the verge, because a braking reference in
    // the wrong place is worse than none. `reserveMarkers` is where the
    // three come from, so the id is the reservation's own rather than a
    // second guess at which asset L-3 speaks with.
    immovable: new Set(markers ? [markers.brake.id] : []),
    // Z-3'S PROTECT SET IS THE RESERVED THREE AND NOTHING ELSE, WHICH IS A
    // POLICY AND WAS MEASURED BEFORE IT WAS CHOSEN.
    //
    // `dressLap` pins `reserved ∪ landmarkAssets(the settled list)` -- L-4's
    // landmarks, the assets unique to a tenth of the lap -- and the page
    // cannot reproduce that without first running `dressLap`, because the
    // set is a property of the list the graph is deciding. So the question
    // was whether the landmark half is worth porting, and the answer is
    // that it is worth NOT porting.
    //
    // L-4'S ACTUAL GUARANTEE IS STRETCH COVERAGE -- every tenth of the lap
    // holds an asset that appears nowhere else on it -- and pinning is
    // what is supposed to stop Z-3's redraw breaking it. Measured over six
    // seeds against a two-pass reconstruction of the full 13-id set: the
    // covered-stretch count was IDENTICAL on seeds 1-5 (10, 10, 9, 10, 10)
    // and on seed 6 the reserved-only lap was strictly BETTER, 10 against
    // 9. Seed 3's one bare stretch was bare with nothing pinned at all, so
    // it was not the mix's doing. Placement counts are identical either way.
    //
    // RETAKEN IN PART ON 2026-08-28, AND THE SENTENCE ABOUT SEED 3 IS NOW
    // FALSE. Z-3's donor order changed which assets a lap carries once, so
    // which tenths hold a landmark changed with it: the reserved-only lap
    // this page cooks reads 10, 10, 10, 10, 10, 9 -- seed 3 is now full and
    // seed 6 has the bare tenth -- and the reference `dressLap` path reads
    // 10 on all six. The FULL-PIN arm was not re-run, so the COMPARISON is
    // currently unmeasured rather than confirmed. It is left in place
    // because the decision does not rest on it: the mechanism in the next
    // paragraph is what it rests on, and the placement count is still
    // identical either way.
    //
    // THE MECHANISM IS THAT PINNING COSTS A DONOR AND A DRAW. A pinned id
    // is excluded from the quota's eligible set AND from the redraw pool,
    // so withholding ten more assets shrinks a ~226-asset pool and pushes
    // the mix onto more-repeated replacements -- which destroys uniqueness
    // elsewhere faster than the pin protects it here. And the pin is
    // purely defensive in graph mode: `repairLandmarks` is not a stage, so
    // there is no L-4 repair to restore what the mix breaks, which is the
    // situation the reference's pin was answering.
    mixPinned: new Set(markers ? [markers.sharp.id, markers.open.id, markers.brake.id] : []),
    pool: reservation.pool,
    // READ ONLY BECAUSE `placements` IS ABSENT, and required for the same
    // reason: without it the lap comes out with no L-2 or L-3 vocabulary
    // at all, which is a lap that cooks perfectly and has no corner
    // language on it.
    markers,
    densityScale: state.density,
  });

  const group = new Group();
  scene.add(group);
  const lib = poseLibrary(kit);
  // L-2's two assets and L-3's one, as POSE ids -- the placement cloud
  // carries no asset ord, so counting a vocabulary on it has to come at it
  // through the library. Built once here rather than per readout.
  const language = markers ? languagePoses(lib, markers) : undefined;
  const assets = makePoseAssetMap(lib, circuit.lap.halfWidth, "generated");
  const binding = new WorldThreeBinding({ group, assets });
  const rig: StreamedDressing = {
    world: undefined as unknown as World,
    group,
    binding,
    assets,
    mapMaterial: makeStreamedMapMaterial("generated"),
    abort: new AbortController(),
    halfWidth: circuit.lap.halfWidth,
    sectorCount: built.sectorCount,
    sectorW: circuit.lap.lengthW / built.sectorCount,
    live: new Set<number>(),
    disposed: false,
  };
  // THE CLOCK THE `ready in` FIGURE IS READ OFF, started before the World
  // exists rather than at the first update: what a viewer is waiting for
  // is the lap appearing, and every frame between here and the level
  // landing is part of that wait whether it was spent cooking or not.
  const worldT0 = performance.now();
  rig.world = new World({
    seed: state.seed,
    levels: built.levels,
    // CLEAR OF THE SECTOR COUNT, for the reason `RacetrackLevels` gives:
    // a closed lap wants every sector once per circuit, so a cap below
    // that evicts the sector the car is about to reach again and the
    // whole lap re-cooks every lap.
    maxCellsPerLevel: built.sectorCount + 8,
    onCellReady(level, coord, outputs) {
      if (rig.disposed) return;
      binding.cellReady(level, coord, outputs);
      if (level === LEVELS.dressing) rig.live.add(coord[0]);
      // THE LAP LEVEL'S CELL IS WHERE EVERY FIGURE ON THIS PANEL COMES
      // FROM NOW. `readEnclosure` and `readRepairs` are the same two
      // readers `dressLapByGraph` uses, so a number on the panel is a
      // number a test measures -- see `tests/racetrackLevels.test.ts`,
      // which pins the two schedules equal. There is exactly one cell on
      // an unbounded level, so this fires once per world.
      if (level === LEVELS.lap) {
        lastLap = {
          enclosure: readEnclosure(outputs, circuit.lap),
          repairs: readRepairs(outputs, language),
          placed: requirePlacementCount(outputs),
          readyMs: performance.now() - worldT0,
        };
        showLapStats();
      }
    },
    onCellEvicted(level, coord) {
      if (rig.disposed) return;
      binding.cellEvicted(level, coord);
      if (level === LEVELS.dressing) rig.live.delete(coord[0]);
    },
  });
  streamed = rig;
  lastPending = undefined;
  // The outgoing world's figures describe the outgoing lap. Clearing this
  // here rather than in `cookAndBuild` keeps it tied to the world it is
  // about: a seed typed mid-cook rebuilds through this function, and a
  // stale report surviving one frame of that is a readout describing a lap
  // that has already been disposed.
  lastLap = undefined;
  // Kick the first update before the first frame, so the lap level is
  // already cooking rather than waiting a frame to be asked.
  runUpdate(rig, FIRST_BUDGET_MS);
  return { lapGraph: built.lapGraph, dressingGraph: built.dressingGraph };
}

/** Where the car is, as the World wants it. */
function viewpoint(): [number, number, number] {
  return [car.position.x, car.position.y, car.position.z];
}

/**
 * The anchor the dressing level is streamed round, IN HALF-WIDTHS.
 *
 * `state.station` is in world units and the path table is in W, because
 * `stationW` is the column a sector's filter tests and every rule in this
 * demo is stated in W (`levels.ts` argues that at length). The divide is
 * the whole conversion between the two and it is load-bearing: pass the
 * world-unit station and the anchor lands `halfWidth` times too far round
 * a table that wraps, which is not an error anywhere — it silently streams
 * the wrong part of the lap.
 */
function dressingAnchor(rig: StreamedDressing): number {
  return state.station / rig.halfWidth;
}

/** Generation counter, so only the newest update may clear `updating`. */
let updateToken = 0;
let updating = false;

/**
 * One budgeted update.
 *
 * TOKENED SO FRAMES CANNOT PILE UP. A rebuild mid-update (a seed typed, a
 * density dragged) starts a second update while the first is still
 * settling; without the token the older one's `finally` would open the
 * gate and the next frame would start a third against a world that is
 * already two behind.
 */
function runUpdate(rig: StreamedDressing, budgetMs: number): void {
  const token = ++updateToken;
  updating = true;
  rig.world
    .update(viewpoint(), {
      anchors: { [LEVELS.dressing]: dressingAnchor(rig) },
      budgetMs,
      maxCooksPerUpdate: MAX_COOKS_PER_UPDATE,
      signal: rig.abort.signal,
    })
    .then((stats) => {
      if (!rig.disposed) lastPending = stats.pending;
    })
    .catch((err: unknown) => {
      // A torn-down world rejects with CookCancelledError because we
      // aborted it, which is not news. Anything else is a real cook
      // failure and is logged even for a dead rig — swallowing those
      // would hide a genuine error that happened to race a recook.
      if (err instanceof CookCancelledError) return;
      console.error(err);
    })
    .finally(() => {
      if (token === updateToken) updating = false;
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
  title: "racetrack",
  info:
    "A centreline this page did not make, handed to pcg-ts: it sweeps the road and dresses the verges. " +
    "The rules settle the whole lap at once; the dressing then streams in arc sectors as the car " +
    "reaches them. The map frames the whole circuit from above; the chase view is the only viewpoint " +
    "the result is ever consumed from. Both are wireframe, drawn over each other, and the car is one " +
    "object in both.",
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
// WHAT IS RESIDENT AGAINST WHAT THERE IS. Streaming is invisible while it
// works, and the map — which used to answer "is the whole lap dressed" —
// now shows only the window. This is the readout that says how big the
// window is and how much of the circuit it is a window onto.
const statSectors = overlay.addStat("sectors");
const statProps = overlay.addStat("dressing");
const statReference = overlay.addStat("reference");
const statCover = overlay.addStat("enclosure");
const statCorners = overlay.addStat("corner language");
const statRules = overlay.addStat("repairs");
const statCook = overlay.addStat("cook");

/**
 * How many placements the lap level settled, off its own output.
 *
 * A THROW RATHER THAN A FALLBACK, for the reason the dressing level's bind
 * gives about the same output: a page that quietly printed 0 placements
 * would look like a lap the rules emptied, which is a different failure
 * from a graph that stopped publishing its list.
 */
function requirePlacementCount(
  outputs: Readonly<Record<string, DataCollection | undefined>>,
): number {
  const settled = firstGeometry(outputs[DRESS_OUTPUTS.placements] ?? []);
  if (!settled) {
    throw new Error(
      `racetrack: the lap level published no "${DRESS_OUTPUTS.placements}" geometry, so the ` +
        `page cannot say what it is drawing. Check that the dress graph still declares that ` +
        `output.`,
    );
  }
  return settled.pointCount;
}

/**
 * THE FOUR READOUTS THAT DESCRIBE THE LAP ON SCREEN, ALL FROM THE LEVEL
 * THAT DECIDED IT.
 *
 * IT USED TO BE TWO, AND THE OTHER TWO WERE ABOUT A DIFFERENT LAP. The
 * corner-language and repairs lines read `dressLap`'s `DressStats` -- a
 * lap settled in TypeScript in a prelude, next to a lap drawn by the
 * graph. They were close enough to look right and were not the same lap.
 * There is no prelude now, so all four come off the one cell.
 *
 * CALLED TWICE PER COOK, WHICH IS THE POINT OF THE FUNCTION. The lap
 * level cooks under a frame budget, so for a second or so after a seed
 * changes the page is drawing a circuit it cannot yet describe. Every
 * line says so, in the same words the `sectors` readout already uses,
 * and all four land together when the level answers. Filling that window
 * with anything else is what the old arrangement did.
 *
 * THE COUNT AND THE COVER COME FROM THE SAME CELL because they are two
 * views of one list: L-6's pieces ARE placements, so a count taken before
 * enclosure and a cover share taken after it would not add up. Measured on
 * the shipped vocabulary, the level's list is the pre-enclosure one plus
 * exactly the pieces it built -- 11, 16 and 16 on seeds 1-3 -- which is a
 * 3-5% error in `/W` and enough to move the D-1 verdict.
 */
function showLapStats(): void {
  if (!circuit) return;
  const level = lastLap;
  if (!level) {
    statProps("cooking the lap");
    statCover("cooking the lap");
    statCorners("cooking the lap");
    statRules("cooking the lap");
    return;
  }

  // D-1 in its own units, with the verdict rather than just the number,
  // READ FROM THE SPEC rather than restated here: this line carried
  // 0.6-1.2 by hand while DENSITY says 0.71-1.54, so the verdict on screen
  // was wrong at both edges. `unfinished` is a third verdict and not a
  // synonym for the floor — below it a lap is unfinished rather than
  // sparse, which is the word the spec asks for.
  const perW = level.placed / circuit.lap.lengthW;
  const band =
    perW < DENSITY.unfinished
      ? " — unfinished"
      : perW < DENSITY.min
        ? " — under D-1"
        : perW > DENSITY.max
          ? " — over D-1"
          : " — inside D-1";
  // `ready in`, NOT `ms`, AND THE WORD IS THE HONEST PART. The figure this
  // replaced was `dressLap`'s own compute time, measured round a
  // synchronous call. The level is budgeted across frames, so this is wall
  // clock from the World being built to the cell landing -- which includes
  // every frame it waited and is what a viewer watching the lap appear is
  // actually timing.
  statProps(
    `${level.placed} placements, ${perW.toFixed(2)}/W${band}, ready in ${level.readyMs.toFixed(0)} ms`,
  );

  // MEASURED, not planned. L-6's only real claim is what a ray cast finds,
  // and the dressing already encloses a good deal of lap before any
  // enclosure run is placed — so the interesting numbers are the before
  // and after, not the intent.
  //
  // THE TRIM READS ZERO AT THE DENSITY THIS PAGE OPENS AT, and that is a
  // measurement rather than an omission: re-measured over seeds 1-8, the
  // shipped vocabulary finishes between 9.89% and 14.45% of lap at density
  // 1, against L-6's 25% ceiling, so there is nothing to bring back down.
  // It is printed because a rule only ever seen not firing is one nobody
  // can tell from a rule that is missing.
  //
  // AND THE SLIDER CAN TAKE IT SOMEWHERE THE TRIM DOES FIRE, which this
  // used to deny -- it read "zero on every lap this page can draw". The
  // density control goes to x3, and the same sweep at densities 2 and 3
  // reaches 24.89% and 26.78%, with the reference rule taking between 4
  // and 35 placements on six of those twenty-four laps. So the readout
  // below is not decoration at the top of the slider's range: drag the
  // density up and it is the one number on this panel that starts moving.
  const e = level.enclosure;
  statCover(
    `${(100 * e.shareBefore).toFixed(1)}% -> ${(100 * e.share).toFixed(1)}% of lap · ` +
      `+${e.coverStretches} runs (${e.coverPieces} pieces) · ` +
      `${e.trims} trimmed off ${e.runsTrimmed}` +
      (e.blocked
        ? " · held back by Z-3"
        : e.nothingToTrim
          ? " · nothing incidental to trim"
          : ""),
  );

  // THE CORNER LANGUAGE, AND THE CORNER COUNT IS A READING OF THE LAP
  // RATHER THAN A RULE THE PAGE RUNS. `cornersOf` turns the road graph's
  // own curvature columns into corners; it is the same model the graph's
  // stage reads, pinned corner for corner against `cookCorners` in
  // `tests/racetrackCornerGraph.test.ts`. So this is the same category of
  // thing as the lap length on the line above, not a survival of the
  // prelude.
  //
  // AND IT IS WHAT MAKES THE MARKER COUNTS MEAN ANYTHING. "19 markers" is
  // not a claim on its own; "19 markers on 19 corners" is L-2 satisfied,
  // and one short of it is the rule failing where a viewer can see it.
  //
  // WHAT THIS LINE NO LONGER SPLITS is L-2's converted from its added.
  // `dressLap` reported the two apart; a conversion and an addition leave
  // the same marker on the same list, so the difference lives in the
  // bookkeeping stage and not in the cloud it hands on. The total is
  // honest and the split would have to be published to come back.
  const r = level.repairs;
  const corners = cornersOf(circuit.lap);
  const tight = corners.filter((c) => c.tightestW < SEVERITY.tightW).length;
  statCorners(
    `${corners.length} corners (${tight} tight) · ` +
      `L-2 ${r.markersPlaced} markers, ${r.markersPlaced - r.markersKept} lost to cull · ` +
      `L-3 ${r.rulersPlaced} marks, ${r.rulersPlaced - r.rulersKept} lost`,
  );

  // THE REPAIRS, AND WHAT THIS LINE SAYS IS SHORTER THAN WHAT IT USED TO
  // AND TRUE, WHICH THE FIRST VERSION OF IT WAS NOT.
  //
  // It printed `still pushed N, still lowered M (last round)` and both
  // were ALWAYS ZERO. `PLACEMENT.pushW` and `PLACEMENT.drop` are
  // rewritten unconditionally every round rather than accumulated, and
  // `writeSettleCount` stops the loop exactly when both read zero over
  // every point -- so on a converged lap the final round moved nothing and
  // the counts are zero by construction. They carried the one bit
  // `converged` already carries and read as "L-1 pushed nothing", which is
  // false about the lap. `RepairReport` says the same at greater length.
  //
  // `cut` IS A TOTAL AND SURVIVES THE SAME ARGUMENT, because it is a
  // difference between two published LISTS rather than a flag on a carry:
  // the first pass only ever shrinks, so the count that entered it minus
  // the count that left it is the whole of what L-1 dropped, however many
  // rounds it took. The round counts survive it too, for the opposite
  // reason -- `repeatUntil` synthesizes them and the body cannot see them,
  // so nothing in the body can overwrite them.
  //
  // FIVE FIGURES ARE GONE AND ARE NOT COMING BACK QUIETLY. D-4's
  // post-cull pass and L-4 are not stages in this graph at all, so
  // `coverageMoves`, `worstGapW` and `landmarkFixes` have no source --
  // that is a property of what was ported, not of what is published.
  // Z-1's and Z-3's per-round counts are folded into the settle signal
  // rather than reduced apart, so `corridorFixes` and `mixMoves` would
  // need their own outputs and a running column to be totals. Printing a
  // stale number for any of them is exactly what dropping the prelude was
  // for.
  statRules(
    `${r.assembled} assembled -> ${r.settledFirst} settled · ` +
      `sightline cut ${r.dropped} · ` +
      (r.converged
        ? `settled in ${r.roundsFirst}+${r.roundsSecond} rounds`
        : `DID NOT SETTLE in ${r.roundsFirst}+${r.roundsSecond} rounds`),
  );
}

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
    // THERE IS NO PRELUDE ANY MORE, AND THAT WAS THE POINT OF THE WHOLE
    // CAMPAIGN. What stood here settled the lap in TypeScript before the
    // level cooked -- `cookLapPlacements`, `placementsBeforeLanguage`,
    // `cookCorners`, `cookCornerBookkeeping` and `dressLap` -- and handed
    // the finished list to `buildRacetrackLevels`. The graph could decide
    // its own list for some time before this line changed; what the page
    // was still doing was deciding it FIRST and handing it over, which
    // made the placements DATA in the lap graph. A graph whose answer is
    // bound into it as input is a picture of one lap and cannot be
    // serialized and re-run against another spline, which is the only
    // version of it a game could ship.
    //
    // ONE COOK STAYS, DELIBERATELY. `cookReserveMarkers` decides WHICH
    // ASSETS EXIST before anything is dressed -- the pool everything
    // downstream draws from is the kit minus L-2 and L-3's three reserved
    // verticals -- so it cannot be a stage inside the graph that consumes
    // its answer. Folding it in would also mean ranking three objects by
    // height in-graph and handing back a list of TypeScript objects for
    // indices to resolve against. It is a cook over eight candidates and
    // costs nothing measurable.
    //
    // WHAT THE PAGE GAVE UP TO GET HERE is on the two readouts, not in the
    // geometry: five of `DressStats`' figures have no graph source and
    // `showLapStats` says which and why. The lap itself is the same rules
    // in the same order.
    const kit = dressingKit();
    const reservation = await cookReserveMarkers({
      assets: (kit.assets as unknown as PlaceableAsset[]).filter((a) => a.where),
      seed: state.seed,
    });
    buildCircuit(next);
    const graphs = buildStreamedDressing(next, kit, reservation);
    frameMap(next, state.mapZoom);
    statLap(`${next.lap.lengthW.toFixed(1)} W (${next.lap.length.toFixed(0)} u)`);
    // AND EVERY LINE ABOUT THE LAP THE PAGE DRAWS, none of which anything
    // knows yet: the lap level has been asked to cook and has not
    // answered. This renders the waiting state; `onCellReady` calls it
    // again with the answer.
    showLapStats();
    statCook(`${next.cookMs.toFixed(0)} ms`);
    // Called only when the graphs CHANGED — it re-serializes and re-lays
    // out, which is not free and is wasted every frame.
    //
    // ALL THREE, because all three are cooked. The road sweeps the
    // surface, the lap settles the placement list once for the whole
    // circuit, and the dressing is what a single sector runs — the last
    // is four nodes beside the lap's few hundred, which is itself the
    // clearest statement of where the cut falls.
    const entries = [
      { name: "road", graph: next.graph },
      { name: "lap", graph: graphs.lapGraph },
      { name: "dressing", graph: graphs.dressingGraph },
    ];
    if (graphPanel) graphPanel.set(entries);
    else graphPanel = attachGraphPanel(entries, { into: graphSlot, title: "graph" });
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

  // The car has moved, so ask for the sectors around where it is now —
  // BEFORE the passes, so a sector that lands this frame is drawn this
  // frame rather than one late. Pausing does not stop this: a paused lap
  // that has not finished streaming would otherwise stay half dressed
  // forever, which is the state a capture must never photograph.
  const rig = streamed;
  if (rig && !updating) runUpdate(rig, BUDGET_MS);
  if (rig) {
    statSectors(
      `${rig.live.size} of ${rig.sectorCount} live ` +
        `(+${AHEAD_SECTORS}/-${BEHIND_SECTORS} at ${rig.sectorW.toFixed(1)} W) · ` +
        `${lastPending === undefined ? "cooking the lap" : `${lastPending} pending`}`,
    );
  }

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
    try {
      renderer.render(scene, mapCamera);
    } finally {
      // AND STRAIGHT BACK, in a `finally` rather than the next statement.
      // The streamed meshes are borrowing one shared material; leaving it
      // on them past this point would let an evict or a teardown dispose
      // it as though it were a mesh's own, and take every other sector's
      // map colour with it. A plain statement here would be skipped by a
      // throwing render -- which then unwinds this frame, lets the
      // pending update's continuation run, and evicts a mesh still
      // holding the shared material. `finally` is what makes the window
      // end on every path rather than on the happy one.
      // See {@link paintStreamed}.
      setPass("chase");
    }
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
 *
 * AND A STATION IS NO LONGER ENOUGH, now the dressing streams. A seek
 * jumps the anchor to a part of the lap that has never been cooked, so the
 * frame immediately after it is a bare road: the same station on two
 * machines would photograph two different amounts of dressing, which is
 * exactly the non-determinism this probe exists to remove. So the seek
 * PUMPS — it drives updates itself until the World reports nothing left
 * pending, and only then is the shot the whole window.
 */
declare global {
  interface Window {
    pcgRacetrack?: { seek(station: number): Promise<void>; pause(on: boolean): void };
  }
}

/**
 * How many pumped updates a seek will spend before giving up.
 *
 * An unbudgeted update cooks every wanted cell, so one round settles a
 * window and the second confirms it; the ceiling is here because a page
 * that can HANG in a capture is worse than one that photographs a
 * half-dressed lap and leaves the evidence in the `sectors` readout.
 */
const SEEK_ROUNDS = 32;

async function seekAndSettle(station: number): Promise<void> {
  state.station = station;
  const rig = streamed;
  if (!rig) return;
  for (let i = 0; i < SEEK_ROUNDS; i++) {
    try {
      // No budget and no cap: the point of this path is to finish, not to
      // stay inside a frame. `viewpoint()` may be a frame stale — the car
      // is moved by the loop — and that costs nothing here, because only
      // the anchor decides which sectors a path level wants.
      const stats = await rig.world.update(viewpoint(), {
        anchors: { [LEVELS.dressing]: dressingAnchor(rig) },
        signal: rig.abort.signal,
      });
      // Only while this rig is still the live one: a torn-down world's
      // pending count reaching the readout is the same class of bug the
      // `rig.disposed` guards elsewhere exist to stop.
      if (!rig.disposed) lastPending = stats.pending;
      if (stats.pending === 0) return;
    } catch (err) {
      // A recook mid-pump aborts this world, and that is not a failed
      // seek — the world replacing it streams the same station. It must
      // not escape either: an unhandled rejection is a page error, and
      // the capture script fails a shot that reports one.
      if (err instanceof CookCancelledError) return;
      // REPORTED, NOT RETHROWN. `capture-demos.mjs` does not await this
      // promise, so a rethrow here is an unhandled rejection rather than
      // a caught error -- and the capture script fails a shot that
      // reports one, turning a cook problem into an unrelated-looking
      // page error. `runUpdate` logs for the same reason.
      console.error("racetrack: seek failed to settle", err);
      return;
    }
    if (rig.disposed) return;
  }
}

window.pcgRacetrack = {
  seek(station: number): Promise<void> {
    return seekAndSettle(station);
  },
  pause(on: boolean): void {
    state.paused = on;
  },
};

export {};
