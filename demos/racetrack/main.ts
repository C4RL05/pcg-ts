/**
 * The dressed lap, as a layout you can fly.
 *
 * WHAT THIS PAGE IS FOR, and it is not a finished scene: the technique in
 * `dressing.ts` decides WHERE things go, and the only honest way to look
 * at that is to draw each placement as the box the rules reason about.
 * Every placement carries its own `footprintW` and `tallnessW`, so the
 * boxes are not stand-ins for art that has not been made — they are the
 * data itself, at the size the sightline and coverage passes measured.
 * Real assets would hide the one thing this page exists to show.
 *
 * TWO VIEWS IN ONE FRAME. A layout is two questions. The plan answers "is
 * the lap dressed evenly, and does it lean the right way through the
 * bends" — what most of the seventeen metrics are scored on. The
 * travelling view answers "what does a driver see", which is what the
 * sightline and legibility passes exist for and what no plan can answer.
 * They are drawn OVER each other rather than side by side: the plan goes
 * down as a wireframe over the driven image, so the two readings share
 * every pixel instead of splitting the screen, and a marker says where in
 * the lap the driven view is. Same cook, one frame, two answers.
 *
 * WHY THE HOST HAS A LOOP. Calibration is a share of a total — placements
 * per half-width, the band mix, the outside-of-bend share — and a cook
 * cannot read its own totals, so the fit happens here: cook, measure,
 * correct, cook again, keep the best. That is the technique's own
 * architecture rather than a workaround, and it is why this ships as a
 * demo with a host instead of a graph in the corpus. See `dressing.ts`.
 */
import { cook, firstGeometry, type DataCollection, type Geometry } from "pcg-ts";
import { toBufferGeometry } from "pcg-ts/three";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Euler,
  Fog,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createFpsMeter } from "../../shared/fps.js";
import { createOverlay } from "../../shared/overlay.js";
import { BACKGROUND } from "../../shared/scene.js";
import {
  type Corrections,
  type Plan,
  calibrate,
  chooseCommittedStretches,
  correct,
  noCorrections,
} from "./calibrate.js";
import { buildTrackDressingGraph } from "./dressing.js";
import { CORRIDOR, PRESETS, type Preset } from "./kit.js";
import { TRACK, better, col, scoreCook } from "./read.js";

// ------------------------------------------------------------------ //
// The cook, and the closed loop around it.
// ------------------------------------------------------------------ //

/** One finished fit: the geometry to draw, and the card that scores it. */
interface Lap {
  readonly placements: Geometry;
  readonly frames: Geometry;
  readonly road: Geometry;
  readonly lapW: number;
  readonly passed: number;
  readonly total: number;
  readonly card: string;
  readonly cookMs: number;
  readonly cooks: number;
}

function requireGeo(name: string, collection: DataCollection | undefined): Geometry {
  const geo = collection ? firstGeometry(collection) : undefined;
  if (!geo) throw new Error(`racetrack: the graph produced no '${name}' geometry`);
  return geo;
}

/**
 * Fit the kit to the lap, then dress it — the same sequence the metric
 * suite runs, with the ribbon output switched on so there is a road under
 * the result.
 *
 * ITERATIONS ARE NOT POLISH. A single uncorrected pass scores 16 of 17:
 * the outside-of-bend share runs hot until the controller has seen it
 * once. Drawing that pass would put a lap on the page that no run of the
 * technique produces, so the loop runs and the BEST iteration is the one
 * that gets drawn.
 */
async function dressLap(preset: Preset, seed: number): Promise<Lap> {
  const t0 = performance.now();
  const base = { ...TRACK, preset, seed, ribbon: true };
  let cooks = 0;

  // The lap's length is a fact about the spline and the calibration is
  // stated per half-width, so one cheap cook with every rule pass off
  // answers "how long is this lap in W" before anything is placed.
  const probe = buildTrackDressingGraph({
    ...base,
    countByProfile: { flat: 1, built: 1, clustered: 1 },
    weightByArchetype: {},
    legibility: false,
    coverage: false,
    sightline: false,
    landmarks: false,
    balance: false,
  });
  cooks++;
  const probeFrames = requireGeo("frames", (await cook(probe.graph)).outputs.frames);
  const lapLength = probeFrames.attrs.primitive.require("lapLen").get(0) as number;
  const lapW = lapLength / TRACK.halfWidth;

  let corrections: Corrections = noCorrections();
  let plan: Plan = calibrate(preset, lapW, corrections);

  const run = async (committed: Record<number, number>) => {
    const graph = buildTrackDressingGraph({
      ...base,
      countByProfile: plan.countByProfile,
      weightByArchetype: plan.weightByArchetype,
      variantsByArchetype: plan.variantsByArchetype,
      polygonScale: plan.polygonScale,
      committedStretches: committed,
    }).graph;
    cooks++;
    const out = await cook(graph);
    return { ...scoreCook(out, preset, lapW), out };
  };

  // Which stretches can carry a lean is a fact about the dressed lap, so
  // finding out takes a cook with the balance pass off.
  const dry = await run({});
  const committed = chooseCommittedStretches(dry.placements, lapW);

  let current = await run(committed);
  let best = current;
  for (let iter = 0; iter < 2; iter++) {
    // Corrected from the LATEST iteration, never from the best one: a
    // controller has to see where it just was, and one that re-derives
    // the same correction from the same report never moves.
    corrections = correct(preset, current.report, corrections);
    plan = calibrate(preset, lapW, corrections);
    current = await run(committed);
    if (better(current.report, best.report, preset)) best = current;
  }

  const metrics = best.report.metrics;
  return {
    placements: requireGeo("placements", best.out.outputs.placements),
    frames: requireGeo("frames", best.out.outputs.frames),
    road: requireGeo("road", best.out.outputs.road),
    lapW,
    passed: best.report.passed,
    total: metrics.length,
    card: metrics
      .map((m) => `${m.pass ? "PASS" : "FAIL"} ${fmt(m.value)}  ${m.name}\n            ${m.target}`)
      .join("\n"),
    cookMs: performance.now() - t0,
    cooks,
  };
}

function fmt(v: number): string {
  return (Math.abs(v) >= 100 || Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2)).padStart(6);
}

// ------------------------------------------------------------------ //
// Drawing.
// ------------------------------------------------------------------ //

/**
 * Everything is drawn in HALF-WIDTHS rather than world units.
 *
 * The kit states every length in W, and the generated lap is 1755 world
 * units across — so a scene in world units puts the far plane a quarter of
 * a million out and spends its depth buffer on a track one unit wide.
 * Dividing by the half-width on the way in costs one multiply per column,
 * puts the whole lap inside a sane frustum, and is the unit the overlay
 * quotes anyway.
 */
const W = TRACK.halfWidth;

/** How far up the lap the travelling camera looks, in half-widths. */
const LOOK_AHEAD_W = 4;

/** How far off the road the drawn centreline sits, in half-widths. */
const LIFT_W = 0.04;

/** Zone colours: the lateral/height band a placement belongs to. */
const ZONE_COLOR: Record<number, number> = {
  2: 0xffd166, // verge furniture, right at the track edge
  3: 0xef8354, // near band
  4: 0x8ecae6, // mid band
  5: 0x76c893, // far band
  6: 0x5c7ba8, // distant silhouette
  7: 0xc77dff, // over the track
};

/**
 * TWO MATERIAL SETS, because the same objects are drawn twice per frame.
 *
 * Both are UNLIT. Nothing here is a scene: it is a drawing of where 440
 * volumes sit, and a lamp on a diagram only decides which parts of the
 * answer are legible. Unlit means a placement's colour is exactly its
 * zone and the road's colour is exactly its corner model, at every angle
 * and on both sides.
 *
 * The driven pass is the full-strength one and the plan pass is faded, so
 * where they land on the same pixels the plan reads as a drawing over the
 * driven image rather than as a second scene competing with it. Minted
 * once at module scope and never per cook: a page that re-cooks on every
 * knob would otherwise leak a GPU program per cook.
 */
const RIDE_MAT = {
  spine: new LineBasicMaterial({ color: 0xffe9b8, transparent: true, opacity: 0.65 }),
  box: new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }),
  road: new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }),
};

const PLAN_MAT = {
  spine: new LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.85 }),
  // ONE COLOUR, deliberately. Both passes draw the same 5,280 lines, and
  // if both draw them in zone colours the eye cannot tell which layer it
  // is looking at. The plan gives its colour up and keeps its shape; the
  // zones stay legible on the pass that is actually showing you a zone.
  box: new LineBasicMaterial({ color: 0x9fb4d4, transparent: true, opacity: 0.42 }),
  road: new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.45,
    side: DoubleSide,
  }),
};

/** The eight corners of a unit box, and the twelve edges joining them. */
const BOX_CORNERS: readonly (readonly [number, number, number])[] = [
  [-0.5, -0.5, -0.5],
  [0.5, -0.5, -0.5],
  [0.5, -0.5, 0.5],
  [-0.5, -0.5, 0.5],
  [-0.5, 0.5, -0.5],
  [0.5, 0.5, -0.5],
  [0.5, 0.5, 0.5],
  [-0.5, 0.5, 0.5],
];

// Floor, then ceiling, then the four uprights joining them.
const BOX_EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/**
 * Every placement's bounding box, as twelve edges.
 *
 * EDGES, NOT A WIREFRAME MATERIAL, and the difference is the whole
 * picture. `wireframe: true` draws the triangles a box is made of, which
 * is a diagonal across all six faces — at 440 boxes, 2,640 lines
 * describing nothing, and they are what turns the driven view into a
 * thicket. Twelve edges is what a bounding box IS.
 *
 * Drawn as one `LineSegments` rather than instanced for the same kind of
 * reason: 440 boxes is 10,560 vertices, which is nothing, and instancing
 * lines costs a custom shader to save a buffer nobody is short of.
 *
 * `P`, `rot` and `scale` are the standard transform attributes the graph
 * already writes — the same three a spawner reads — so this is the spawn
 * path with a box where the asset would be, not a second description of
 * where things are.
 */
function buildBoxEdges(placements: Geometry): { lines: LineSegments; nudged: number } {
  const count = placements.pointCount;
  const p = col(placements, "P");
  const rot = col(placements, "rot");
  const scale = col(placements, "scale");
  const zone = col(placements, "zone");
  const lateral = col(placements, "lateralW");
  const height = col(placements, "heightW");
  // pack1 is (rightB, radiusW): the banked lateral unit vector the graph
  // itself placed this point along, so the box can be moved along the
  // same axis without re-deriving a frame.
  const pack1 = col(placements, "pack1");

  const positions = new Float32Array(count * BOX_EDGES.length * 2 * 3);
  const colors = new Float32Array(count * BOX_EDGES.length * 2 * 3);
  const m = new Matrix4();
  const pos = new Vector3();
  const quat = new Quaternion();
  const siz = new Vector3();
  const colour = new Color();
  const corners = BOX_CORNERS.map(() => new Vector3());
  const right = new Vector3();
  const axis = new Vector3();
  let at = 0;
  let nudged = 0;

  for (let i = 0; i < count; i++) {
    // `P` IS THE CENTRE, and reading it as a base is a mistake the kit
    // will confirm for you: `ground-detail` sits at a height of 0.1..0.4 W
    // and is 0.4..0.8 tall, which is a centre at half its own height.
    // Lifting by another half-tallness floats the whole lap.
    pos.set(p[i * 3] / W, p[i * 3 + 1] / W, p[i * 3 + 2] / W);
    quat.set(rot[i * 4], rot[i * 4 + 1], rot[i * 4 + 2], rot[i * 4 + 3]);
    siz.set(scale[i * 3] / W, scale[i * 3 + 1] / W, scale[i * 3 + 2] / W);

    // KEEP THE CORRIDOR CLEAR, which the anchor alone does not.
    //
    // `CORRIDOR` is tested against where a placement is PUT. `footprintW`
    // is the plan size of the art that will stand there, and the two do
    // not have to agree: a `terrain-shell` is 8..9.5 W across and is
    // anchored 2.3..3.8 W out, so a box centred on a perfectly legal
    // anchor still reaches over the racing line. Drawn that way the page
    // asserts a solid block across the track that no rule in the
    // technique believes in — and it is the picture, not the rule, that
    // is wrong: `lateralW` reads as the offset of the thing's
    // track-facing side (every side archetype's band starts at 1.05 W,
    // just outside the corridor, which only makes sense that way).
    //
    // So a box whose near face would enter the corridor is slid outboard
    // along its own `rightB` by exactly the shortfall — never more, and
    // never at all above the corridor ceiling, where a gantry or a tunnel
    // shell is supposed to span the track. How often that was needed is
    // reported in the panel rather than hidden: it is a real gap between
    // what the rule checks and what the kit describes.
    if (height[i] < CORRIDOR.ceilingW) {
      right.set(pack1[i * 4], pack1[i * 4 + 1], pack1[i * 4 + 2]);
      // The box is oriented, so its half-extent ACROSS the track is the
      // support of the rotated box along `right`, not half of any one
      // side.
      const across =
        0.5 *
        (Math.abs(right.dot(axis.set(1, 0, 0).applyQuaternion(quat))) * siz.x +
          Math.abs(right.dot(axis.set(0, 1, 0).applyQuaternion(quat))) * siz.y +
          Math.abs(right.dot(axis.set(0, 0, 1).applyQuaternion(quat))) * siz.z);
      const shortfall = CORRIDOR.halfWidthW - (Math.abs(lateral[i]) - across);
      if (shortfall > 0) {
        pos.addScaledVector(right, Math.sign(lateral[i]) * shortfall);
        nudged++;
      }
    }

    m.compose(pos, quat, siz);
    for (let c = 0; c < BOX_CORNERS.length; c++) {
      const [cx, cy, cz] = BOX_CORNERS[c];
      corners[c].set(cx, cy, cz).applyMatrix4(m);
    }
    colour.setHex(ZONE_COLOR[Math.round(zone[i])] ?? 0x9aa5b1);
    for (const [a, b] of BOX_EDGES) {
      for (const end of [corners[a], corners[b]]) {
        positions[at] = end.x;
        positions[at + 1] = end.y;
        positions[at + 2] = end.z;
        colors[at] = colour.r;
        colors[at + 1] = colour.g;
        colors[at + 2] = colour.b;
        at += 3;
      }
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setAttribute("color", new BufferAttribute(colors, 3));
  const lines = new LineSegments(geo, RIDE_MAT.box);
  lines.frustumCulled = false;
  return { lines, nudged };
}

/**
 * The road surface, straight from the ribbon the graph swept.
 *
 * SCALED, and this is the one place the half-width convention has to be
 * applied to an object rather than to a column. Every other buffer here
 * is built by hand, so the divide happens as each `P` is read; this one
 * is converted by `toBufferGeometry`, which quite correctly copies `P`
 * exactly as the graph wrote it — in world units. Left alone the road
 * comes back 1755 times too big and centred a hundred thousand units
 * out, which does not look like a bug on screen. It looks like no road.
 *
 * No normals: the material is unlit, so they would be a buffer nothing
 * reads.
 */
function buildRoad(road: Geometry): Mesh {
  const mesh = new Mesh(toBufferGeometry(road, { normals: false }), RIDE_MAT.road);
  mesh.scale.setScalar(1 / W);
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * The centreline itself, drawn.
 *
 * Without it the road is a two-half-width slab of flat colour, and a slab
 * has no speed in it: nothing on the surface tells you how fast it is
 * going past or where the middle of it is. The frames already describe
 * the line exactly — this is the same 400 points the camera rides, lifted
 * a hair along the banked up so it sits ON the road rather than fighting
 * it for the same depth.
 */
function buildSpine(frames: Geometry): LineLoop {
  const count = frames.pointCount;
  const p = col(frames, "P");
  const up = col(frames, "upB");
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = p[i * 3] / W + up[i * 3] * LIFT_W;
    positions[i * 3 + 1] = p[i * 3 + 1] / W + up[i * 3 + 1] * LIFT_W;
    positions[i * 3 + 2] = p[i * 3 + 2] / W + up[i * 3 + 2] * LIFT_W;
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  const line = new LineLoop(geo, RIDE_MAT.spine);
  line.frustumCulled = false;
  return line;
}

/** The resampled centreline: where the travelling camera rides. */
interface Ride {
  readonly p: Float64Array;
  readonly tangent: Float64Array;
  readonly up: Float64Array;
  readonly count: number;
  readonly lapW: number;
}

function buildRide(frames: Geometry, lapW: number): Ride {
  return {
    p: col(frames, "P"),
    tangent: col(frames, "tangent"),
    // `upB`, the banked up the corner model computed — the same vector
    // the ribbon is swept with and the placements are oriented against,
    // so the camera banks with the road rather than against it. NOT
    // `curveNormal`: that frame is rotation-minimizing and free to roll,
    // and a camera that inherits its drift tips the horizon over.
    up: col(frames, "upB"),
    count: frames.pointCount,
    lapW,
  };
}

interface Pose {
  readonly p: Vector3;
  readonly dir: Vector3;
  readonly up: Vector3;
}

function makePose(): Pose {
  return { p: new Vector3(), dir: new Vector3(), up: new Vector3() };
}

/**
 * Where the camera is at a given station, in W.
 *
 * Frames are evenly spaced along the lap by construction (`pathResample`
 * in 'count' mode), so a station maps to a fractional index directly and
 * the seam wraps with a modulo rather than a special case.
 */
function sampleRide(ride: Ride, stationW: number, out: Pose): void {
  const f = ((((stationW / ride.lapW) * ride.count) % ride.count) + ride.count) % ride.count;
  const i0 = Math.floor(f);
  const i1 = (i0 + 1) % ride.count;
  const t = f - i0;
  const mix = (a: Float64Array, v: Vector3, divide: number) => {
    v.set(
      (a[i0 * 3] + (a[i1 * 3] - a[i0 * 3]) * t) / divide,
      (a[i0 * 3 + 1] + (a[i1 * 3 + 1] - a[i0 * 3 + 1]) * t) / divide,
      (a[i0 * 3 + 2] + (a[i1 * 3 + 2] - a[i0 * 3 + 2]) * t) / divide,
    );
  };
  mix(ride.p, out.p, W);
  // Tangent and up are already unit length, so they interpolate without
  // the W divide and are renormalized rather than rescaled.
  mix(ride.tangent, out.dir, 1);
  out.dir.normalize();
  mix(ride.up, out.up, 1);
  out.up.normalize();
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
// colour background clears the colour buffer at the start of EVERY
// render regardless of `autoClear` — the background pass forces it — so
// leaving it on the scene means the plan pass wipes the driven image a
// moment before drawing over it, and the wireframe lands on black. Set
// once here and cleared once per frame instead.
renderer.autoClear = false;
renderer.setClearColor(BACKGROUND, 1);
document.body.appendChild(renderer.domElement);

// No lights, because no material here is lit. See RIDE_MAT.
const scene = new Scene();

/**
 * Fog for the driven pass only.
 *
 * It is what gives an eye-level shot its depth, and it is exactly wrong
 * for the plan: an orthographic camera parked 320 W above the lap sits
 * beyond any fog range that reads at eye level, so the same fog that
 * makes one pass legible erases the other. Swapped per pass rather than
 * compromised into a distance that suits neither.
 */
const RIDE_FOG = new Fog(BACKGROUND, 35, 170);

// A ground plane, only so the boxes have something to sit against. Below
// the lap rather than at it: the circuit has relief, and a plane at the
// mean height would cut through its lower half. Driven pass only — from
// straight above it is an opaque sheet over the whole drawing.
const ground = new Mesh(
  new PlaneGeometry(4000, 4000),
  new MeshBasicMaterial({ color: 0x121822 }),
);
ground.setRotationFromEuler(new Euler(-Math.PI / 2, 0, 0));
ground.position.y = -TRACK.relief / W - 1.5;
scene.add(ground);

/** The plan. Orthographic, because a layout read in perspective is a lie. */
const planCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
planCamera.up.set(0, 0, -1);

/** The travelling view: one driver's eye, on the centreline. */
const rideCamera = new PerspectiveCamera(72, 1, 0.05, 900);

// Pan and zoom the plan, but never rotate it: the moment it tilts it
// stops being a plan, and the image underneath is already the tilted one.
const controls = new OrbitControls(planCamera, renderer.domElement);
controls.enableRotate = false;
controls.enableDamping = true;
controls.dampingFactor = 0.08;

/** Where on the plan the driven view currently is. */
const marker = new Mesh(
  new ConeGeometry(2.4, 6.6, 3),
  new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 }),
);
marker.frustumCulled = false;
scene.add(marker);

const overlay = createOverlay({
  title: "racetrack",
  info: "A spline dressed by rule, drawn as the boxes the rules measure.",
});

let presetName = "lush";
let seed = 21;
let speedW = 45;
let eyeW = 0.8;
let planOn = true;
let paused = false;

overlay.addSelect(
  "preset",
  Object.keys(PRESETS).map((k) => ({ value: k, label: k })),
  presetName,
  (v) => {
    presetName = v;
    void regenerate();
  },
);
overlay.addSeed(seed, (v) => {
  seed = v;
  void regenerate();
});
overlay.addSlider("speed (W/s)", { min: 5, max: 140, step: 1, value: speedW }, (v) => {
  speedW = v;
});
overlay.addSlider(
  "eye height (W)",
  { min: 0.1, max: 4, step: 0.05, value: eyeW, format: (v) => v.toFixed(2) },
  (v) => {
    eyeW = v;
  },
);
overlay.addSlider(
  "plan zoom",
  { min: 0.4, max: 3, step: 0.05, value: 1, format: (v) => `${v.toFixed(2)}x` },
  (v) => {
    planCamera.zoom = v;
    planCamera.updateProjectionMatrix();
  },
);
overlay.addCheckbox("plan overlay", planOn, (v) => {
  planOn = v;
});
overlay.addCheckbox("pause travel", paused, setPaused);

/**
 * The pause checkbox, so the key and the probe below can move it too.
 *
 * Found by its label rather than returned by `addCheckbox`, which hands
 * back nothing: three ways to pause that disagree about whether the box
 * is ticked is worse than one query.
 */
const pauseBox = [...overlay.el.querySelectorAll(".pcg-row")]
  .find((row) => row.textContent?.trim().startsWith("pause travel"))
  ?.querySelector("input");

function setPaused(v: boolean): void {
  paused = v;
  if (pauseBox instanceof HTMLInputElement) pauseBox.checked = v;
}

// Space stops the lap where it is, which is what anyone reaches for when
// something goes past too fast to look at.
window.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.target !== document.body) return;
  e.preventDefault();
  setPaused(!paused);
});

const statScore = overlay.addStat("metrics passed");
const statPlacements = overlay.addStat("placements");
const statNudged = overlay.addStat("nudged off the track");
const statLap = overlay.addStat("lap");
const statCook = overlay.addStat("cook");
const statStation = overlay.addStat("station");
const statFps = overlay.addStat("fps");
const card = overlay.addCollapsible("metric card", false);
overlay.addNote(
  "Every box is one placement, at its own footprint x tallness and " +
    "coloured by the zone it sits in. The faded copy is the same lap seen " +
    "from directly above; the marker is where the driven view has got to. " +
    "Space pauses; drag and scroll move the plan. \u201cNudged\u201d counts " +
    "boxes slid clear of the track: the corridor rule tests where a " +
    "placement is anchored, not how wide the art on it turns out to be.",
);

const tickFps = createFpsMeter(statFps);
const here = makePose();
const ahead = makePose();

let lap: Lap | undefined;
let boxes: LineSegments | undefined;
let roadMesh: Mesh | undefined;
let spine: LineLoop | undefined;
let ride: Ride | undefined;
let station = 0;
let cooking = false;
let planExtent = 80;
const planCentre = new Vector3();

/** Swap a pass's materials onto the meshes that are in the scene. */
function usePlanMaterials(on: boolean): void {
  const set = on ? PLAN_MAT : RIDE_MAT;
  if (boxes) boxes.material = set.box;
  if (roadMesh) roadMesh.material = set.road;
  if (spine) spine.material = set.spine;
}

function clear(): void {
  // Geometries only. The materials are shared and live for the page.
  for (const obj of [boxes, roadMesh, spine]) {
    if (!obj) continue;
    scene.remove(obj);
    obj.geometry.dispose();
  }
  boxes = undefined;
  roadMesh = undefined;
  spine = undefined;
}

/** Frame the plan camera on the lap that was just cooked. */
function framePlan(road: Geometry): void {
  const p = col(road, "P");
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < road.pointCount; i++) {
    const x = p[i * 3] / W;
    const z = p[i * 3 + 2] / W;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  // A HALF-extent plus a margin: the frustum is stated as a half-height,
  // and framing to the full extent puts the lap's edge on the screen's.
  planExtent = Math.max(maxX - minX, maxZ - minZ) / 2 + 6;
  planCentre.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  planCamera.position.set(planCentre.x, 320, planCentre.z);
  planCamera.lookAt(planCentre);
  controls.target.copy(planCentre);
  controls.update();
  layout();
}

async function regenerate(): Promise<void> {
  if (cooking) return;
  cooking = true;
  statCook("cooking…");
  // One frame of breathing room, so the overlay repaints before a cook
  // takes the thread.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  try {
    lap = await dressLap(PRESETS[presetName], seed);
    clear();
    const built = buildBoxEdges(lap.placements);
    boxes = built.lines;
    roadMesh = buildRoad(lap.road);
    spine = buildSpine(lap.frames);
    ride = buildRide(lap.frames, lap.lapW);
    scene.add(boxes);
    scene.add(roadMesh);
    scene.add(spine);
    framePlan(lap.road);
    station = 0;
    statScore(`${lap.passed} / ${lap.total}`);
    statPlacements(lap.placements.pointCount);
    statNudged(`${built.nudged} of ${lap.placements.pointCount}`);
    statLap(`${lap.lapW.toFixed(0)} W`);
    statCook(`${lap.cookMs.toFixed(0)} ms, ${lap.cooks} cooks`);
    card.textContent = lap.card;
  } finally {
    cooking = false;
  }
}

function layout(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  const aspect = w / h;
  // Both cameras see the WHOLE canvas: the plan is drawn over the driven
  // view, not beside it.
  planCamera.left = -planExtent * aspect;
  planCamera.right = planExtent * aspect;
  planCamera.top = planExtent;
  planCamera.bottom = -planExtent;
  planCamera.updateProjectionMatrix();
  rideCamera.aspect = aspect;
  rideCamera.updateProjectionMatrix();
}

window.addEventListener("resize", layout);
layout();

let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  tickFps();
  controls.update();

  if (ride) {
    if (!paused && !cooking) station = (station + speedW * dt) % ride.lapW;
    sampleRide(ride, station, here);
    rideCamera.position.copy(here.p).addScaledVector(here.up, eyeW);
    rideCamera.up.copy(here.up);
    // Aimed a fixed distance up the lap rather than along the local
    // tangent: a tangent points at the outside wall on the way into a
    // bend, which is the one thing a driver's view never does.
    sampleRide(ride, station + LOOK_AHEAD_W, ahead);
    rideCamera.lookAt(ahead.p.addScaledVector(ahead.up, eyeW));
    // On the plan, not in the world: parked above everything the plan
    // camera can see, and turned by the tangent flattened to the ground.
    marker.position.set(here.p.x, 60, here.p.z);
    marker.setRotationFromEuler(new Euler(Math.PI / 2, 0, -Math.atan2(here.dir.x, here.dir.z)));
    statStation(`${station.toFixed(0)} / ${ride.lapW.toFixed(0)} W`);
  }

  // PASS 1 — the driven view: lit, solid, fogged.
  usePlanMaterials(false);
  scene.fog = RIDE_FOG;
  ground.visible = true;
  marker.visible = false;
  renderer.clear();
  renderer.render(scene, rideCamera);

  // PASS 2 — the plan, as a wireframe over it. The depth buffer is
  // cleared between them: the plan is a drawing ON the image, and depth
  // from a camera 320 W up has nothing to say about one at eye level.
  if (planOn) {
    usePlanMaterials(true);
    scene.fog = null;
    ground.visible = false;
    marker.visible = true;
    renderer.clearDepth();
    renderer.render(scene, planCamera);
  }
});

/**
 * The capture probe, and the reason it exists rather than a keypress.
 *
 * `scripts/capture-demos.mjs` has to photograph this page at a REPEATABLE
 * moment. Pausing with the checkbox stops it wherever the lap had got to
 * by the time the script got there, which is a function of how fast the
 * machine booted — so the committed screenshot would drift every time it
 * was regenerated. Naming a station instead makes the shot a pure
 * function of the seed.
 */
(window as unknown as { pcgTrack: unknown }).pcgTrack = {
  /** Has a lap been cooked yet? */
  ready(): boolean {
    return ride !== undefined;
  },
  /** Stop at a given station, in half-widths along the lap. */
  pauseAt(stationW: number): void {
    setPaused(true);
    station = ride ? ((stationW % ride.lapW) + ride.lapW) % ride.lapW : stationW;
  },
};

void regenerate();
