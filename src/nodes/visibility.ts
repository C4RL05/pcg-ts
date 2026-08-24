/**
 * Visibility: what a point cloud does to a line of sight.
 *
 * One node so far, {@link occlusionCull}, and one question behind it — can
 * an observer standing HERE still see THERE, with these boxes in the way?
 * That question is not a distribution and cannot be sampled: a scatter
 * decides where things go, and this decides, afterwards, which of them may
 * stay. So the shape of every node here is the same — placement happens
 * upstream, this checks it and REPAIRS it, moving a point out of the way
 * where moving is enough and removing it only where it is not.
 *
 * It is a POINT filter in the sense `src/nodes/filtering.ts` means: it
 * rebuilds the point domain from the survivors and the input's topology
 * goes with them. It is not one in a second sense those five nodes are —
 * it also MOVES points, which no filter does, and that is why it carries
 * no `topology` param at all (see the node's own description).
 */
import type { Geometry } from "../data/index.js";
// Directly, not through `../data/index.js`: identity is internal to the
// library (see that module's header), and every identity-keyed node in the
// standard library reaches it the same way.
import { canonicalPointRanks } from "../data/identity.js";
import { isField } from "../fields/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { UniformGrid } from "../spatial/index.js";
import { standardNode } from "./registry.js";
import {
  CANCEL_STRIDE,
  PARALLEL_FRACTION,
  segmentHitsBox,
  type FieldParam,
  gatherPoints,
  locateOnArcLength,
  polylineWalks,
  positionView,
  requireGeometry,
  requireScalarColumn,
  requireVec3Column,
  resolveOn,
} from "./util.js";

/** Named once; every message in this file leads with it. */
const NODE = "occlusionCull";

/**
 * Ceiling on the chords one cook may build — eyes times `samples`.
 *
 * `samples` is a number the author typed and the schema bounds it, but the
 * EYE count is not: it is however many points the sight input happens to
 * carry, and a resampled centreline at 10cm spacing over a kilometre is
 * ten thousand of them before anyone notices. The product is what gets
 * allocated (three f64 per chord endpoint), so it is the product that is
 * bounded — the same hazard `MAX_RESAMPLE_POINTS` and `MAX_EDGES` bound,
 * and bounded in the same shape: checked BEFORE the allocation, with a
 * message that names both factors so an author can see which one to change.
 */
const MAX_SIGHT_CHORDS = 1_048_576;

/**
 * Ceiling on the push attempts one blocked point may make.
 *
 * `pushMax / pushStep` is two numbers the author typed and a ratio nobody
 * did. A step of 1e-6 against a max of 10 is ten million occlusion tests
 * for ONE point, each of them a full sweep of that point's eyes — a page
 * that stops responding with nothing on screen to explain why. Far above
 * any real search (the racing case that motivated this node uses 12 steps)
 * and far below the runaway.
 */
const MAX_PUSH_STEPS = 4096;



/**
 * Write the images of local +X, +Y and +Z under the rotation `q` into
 * `out` (nine packed numbers, three per axis) — the columns of the
 * rotation matrix, which is what the slab test projects onto.
 *
 * The quaternion is NORMALIZED first. A `rot` column is meant to be unit,
 * but nothing in the library enforces that on a hand-written one, and an
 * unnormalized quaternion would come out as a scaled basis — which the slab
 * test reads as a box whose half extents were multiplied by the square of
 * the quaternion's length. Silently. Normalizing costs one square root per
 * point and makes an unnormalized quaternion mean the rotation it points
 * at, which is the only thing it can have been intended to mean. An
 * all-zero quaternion has no rotation in it at all and falls back to the
 * identity — a box aligned to the world axes, which is what a point with no
 * `rot` column gets too.
 */
function writeBoxAxes(out: Float64Array, qx: number, qy: number, qz: number, qw: number): void {
  const len = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
  let x = 0;
  let y = 0;
  let z = 0;
  let w = 1;
  if (len > 0) {
    const inv = 1 / len;
    x = qx * inv;
    y = qy * inv;
    z = qz * inv;
    w = qw * inv;
  }
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  out[0] = 1 - (yy + zz);
  out[1] = xy + wz;
  out[2] = xz - wy;
  out[3] = xy - wz;
  out[4] = 1 - (xx + zz);
  out[5] = yz + wx;
  out[6] = xz + wy;
  out[7] = yz - wx;
  out[8] = 1 - (xx + yy);
}

/**
 * The refusal for a transform column of the wrong shape.
 *
 * `rot` and `scale` are STANDARD point attributes with fixed shapes
 * (f32x4 and f32x3), and this node reads them as a box's orientation and
 * extents. A column of another shape is not a box description that happens
 * to be narrow — it is a different column wearing the name, and reading its
 * first components would silently cull against a box nobody described. The
 * message names the node, the column, the shape found and the shape needed,
 * because an author reading only "wrong tuple size" has to guess which of
 * the two this node even wanted.
 */
function transformShapeError(name: string, found: string, want: string, why: string): Error {
  return new Error(
    `${NODE}: point attribute "${name}" is ${found}, but this node reads it as ${why} and needs ${want}. ` +
      `Every cloud from createPointCloud carries "${name}" in that shape, and spawnInstances reads the same ` +
      `column — something upstream overwrote it. Rename the offending column with setAttribute, or ` +
      `removeAttribute it if it is dead (a point with no "${name}" column is read as a degenerate box, ` +
      "which blocks nothing, rather than as an error).",
  );
}

/** The refusal for a plain vec3 param written with fewer than three components. */
function vec3ParamError(param: string, value: FieldParam): Error {
  const got = Array.isArray(value) ? `${value.length} components` : `${typeof value}`;
  return new Error(
    `${NODE}: param "${param}" needs three components [x, y, z], got ${got}; a direction and an offset are ` +
      "both positions' worth of numbers. Write it as a plain [x, y, z], or as a field built with " +
      "vec(x, y, z) — a scalar field broadcasts to all three axes, a scalar NUMBER does not.",
  );
}

/**
 * Resolve a field-capable SCALAR param to one f64 per element of `domain`,
 * as a flat typed array the scan can read without a branch.
 *
 * A plain number is FILLED rather than routed through a field column, and
 * the distinction is not cosmetic: `constant()` stores f32, so a plain
 * `pushStep` of 0.3 would become 0.30000001192092896 and every push
 * distance after it would drift off the ladder the author wrote. Filling
 * keeps the f64 the author typed.
 *
 * GUARDED against non-finite values (`resolveOn`): no param in this node
 * has a documented meaning for NaN or ±Infinity. A NaN look-ahead is not
 * "see nothing" and an infinite push is not "push forever" — both are a
 * broken expression, and the refusal names the param rather than producing
 * a cull whose survivors nobody can account for.
 */
function scalarPerElement(
  geo: Geometry,
  param: string,
  value: FieldParam,
  seed: number,
  what: string,
  domain: "point",
  count: number,
): Float64Array {
  const out = new Float64Array(count);
  if (typeof value === "number") {
    out.fill(value);
    return out;
  }
  const col = requireScalarColumn(
    resolveOn(geo, domain, value, seed, NODE, param),
    NODE,
    param,
    domain,
    what,
  );
  for (let i = 0; i < count; i++) out[i] = col.data[i];
  return out;
}

/**
 * {@link scalarPerElement} for a VEC3 param: three f64 per element, packed.
 *
 * A scalar field broadcasts to all three axes exactly as it does everywhere
 * else in the library ({@link requireVec3Column} is the shared guard); a
 * plain scalar does NOT, because a plain param is three numbers an author
 * wrote and a one-number spelling of a direction is a mistake rather than a
 * broadcast.
 */
function vec3PerElement(
  geo: Geometry,
  param: string,
  value: FieldParam,
  seed: number,
  what: string,
  domain: "point",
  count: number,
): Float64Array {
  const out = new Float64Array(count * 3);
  if (!isField(value)) {
    if (!Array.isArray(value) || value.length < 3) throw vec3ParamError(param, value);
    const v = value as readonly number[];
    for (let i = 0; i < count; i++) {
      out[i * 3] = v[0];
      out[i * 3 + 1] = v[1];
      out[i * 3 + 2] = v[2];
    }
    return out;
  }
  const col = requireVec3Column(
    resolveOn(geo, domain, value, seed, NODE, param),
    NODE,
    param,
    domain,
    what,
  );
  const ts = col.tupleSize;
  const data = col.data;
  for (let i = 0; i < count; i++) {
    const o = i * ts;
    out[i * 3] = data[o];
    out[i * 3 + 1] = ts === 1 ? data[o] : data[o + 1];
    out[i * 3 + 2] = ts === 1 ? data[o] : data[o + 2];
  }
  return out;
}

/**
 * One ordered run of the sight input: which points it visits, in walk
 * order, and the arc length before each of them.
 *
 * "Ahead" is the whole reason this exists. An eye needs an ORDER to look
 * along, and a point cloud has none of its own — see the `sight` pin's
 * description for what this node does about that.
 */
interface SightChain {
  /** Point indices in walk order; a closed run repeats its first at the end. */
  readonly points: Uint32Array;
  /** Arc length before each visited point; one entry per point, `cum[0] === 0`. */
  readonly cum: Float64Array;
  /** Whether the last entry of `points` is the first one again. */
  readonly closed: boolean;
}

/** Measure a run of point indices into a {@link SightChain}. */
function measureChain(
  points: Uint32Array,
  closed: boolean,
  pd: ArrayLike<number>,
  ps: number,
): SightChain {
  const nv = points.length;
  const cum = new Float64Array(nv);
  for (let k = 1; k < nv; k++) {
    const a = points[k - 1] * ps;
    const b = points[k] * ps;
    const dx = pd[b] - pd[a];
    const dy = pd[b + 1] - pd[a + 1];
    const dz = pd[b + 2] - pd[a + 2];
    cum[k] = cum[k - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return { points, cum, closed };
}

/**
 * Every ordered run the sight input offers.
 *
 * A geometry with PRIMITIVES is read through its polylines, which is the
 * structural answer: a path's order is carried by its topology, so it
 * survives a shuffle, a filter and a cell boundary. A geometry with NO
 * primitives is read as one open run through its points in POINT ORDER,
 * which is the one place in this node where array order is data — stated
 * plainly in the `sight` pin's description, with `pointsToPath` named as
 * the way out of it.
 *
 * Runs shorter than two points are dropped: a single position defines no
 * line to look along, so it contributes no eye rather than an eye that sees
 * only itself.
 */
function sightChains(geo: Geometry, pd: ArrayLike<number>, ps: number): SightChain[] {
  const chains: SightChain[] = [];
  if (geo.primitiveCount > 0) {
    // Throws, naming this node, when the primitives are not polylines —
    // which is a real mistake rather than a reason to fall back to point
    // order: a mesh handed to this pin has an order nobody meant.
    for (const walk of polylineWalks(geo, NODE)) {
      if (walk.points.length >= 2) chains.push(measureChain(walk.points, walk.closed, pd, ps));
    }
    return chains;
  }
  const n = geo.pointCount;
  if (n < 2) return chains;
  const points = new Uint32Array(n);
  for (let i = 0; i < n; i++) points[i] = i;
  chains.push(measureChain(points, false, pd, ps));
  return chains;
}

/** Params of {@link occlusionCull}. */
export interface OcclusionCullParams {
  lookAhead: FieldParam;
  samples: number;
  eyeOffset: FieldParam;
  pushAxis: FieldParam;
  pushMax: FieldParam;
  pushStep: number;
  pushClearance: FieldParam;
}

/** Move or drop points whose oriented box blocks a line of sight. */
export const occlusionCull = standardNode<OcclusionCullParams>({
  type: NODE,
  category: "filter",
  description:
    "Removes points whose ORIENTED BOX stands in a line of sight, after first trying to move them out of it. Its subject is three things and nothing else: a cloud of EYE POSES, the TARGETS visible from each of them, and a cloud of boxes that may block the lines between — so it serves a driver who must see the road ahead, a guard who must see the gate, and a camera that must see the actor, with no knowledge of roads, gates or actors in it. The `in` pin carries the boxes: each point's `P` is the box centre, its `rot` (f32x4) the orientation and its `scale` (f32x3) the FULL extents, which are the same three columns spawnInstances reads, so what is tested is what will be drawn. The `sight` pin carries the lines: its points are the eye positions, raised by `eyeOffset`, and the path through them supplies the targets. FROM EACH EYE THE TEST IS A FAN OF CHORDS, not one chord to the far end, and that is the difference between a rule that works and one that passes vacuously: the requirement is that the next `lookAhead` of PATH be visible, and a box can leave the far point in plain view while standing in front of everything between — a single chord to the end of the run would clear it. `samples` chords are tested per eye, to points evenly spaced in ARC LENGTH along the run ahead. The test itself runs in each box's OWN frame (the slab method over its three axes), never in the world: a box turned into the sight line presents a narrower profile than its world-aligned hull, and on a straight the two agree while through a bend they do not — which is precisely where the rule matters, so testing the hull would check the one case that never fails. A blocked point is PUSHED before it is dropped: the node steps it along `pushAxis` in `pushStep` increments up to `pushMax`, away from the sight path, and keeps the first position that clears every chord. Only a point that cannot be cleared by pushing is removed. That order is the point of the node and not an optimisation — pushing PRESERVES THE POPULATION COUNT, so any rule upstream that budgeted a number of points still has that number, and the asset the author placed is still in the scene; dropping spends both. With the default `pushMax` of 0 nothing is pushed and every blocker is dropped, which is the conservative reading: this node will not silently relocate an authored point by a distance nobody chose. DETERMINISM: points are visited in an order fixed by point IDENTITY — the bits of the stored position plus the per-point `seed` attribute — and never by array index, so shuffling the input, filtering something upstream, or deriving the same points inside another cell's halo yields the identical survivor set. Order matters here only when `pushClearance` is above 0, which makes a pushed point avoid the points already settled and so makes one verdict depend on others; below that every point is decided from the sight input alone. HALO: with `pushClearance` at 0 the answer for a point depends on the eyes within roughly `lookAhead + pushMax` of it and on nothing else, so a partitioned cook is exact given a window that wide. Above 0 it is a GREEDY op, and a greedy op has no finite width — this point settled here because that one settled there, an unbounded chain no halo covers — so a per-cell cook will differ from a whole-region one, and the difference shows up as pushed points overlapping at the seams rather than as an error. OUTPUT is a point cloud of the survivors with every point attribute carried, and the input's topology is NOT preserved under any setting. There is no `topology: \"keep\"` here, unlike the five point filters, for a reason those five do not have: this node MOVES points as well as removing them, and a primitive kept over a moved point would describe a shape nobody authored — a road that follows its lamp posts sideways. Rebuild any network downstream (pointsToPath, connectPoints). One consequence worth stating because nothing else will say it: a PUSHED point comes out with a different `P`, and `P` is half of a point's identity, so anything identity-keyed downstream (filterByDensity's probabilistic mode, selfPrune's tiebreak, randomField) re-rolls for exactly the points this node moved. COST is one occlusion test per (point, nearby eye, sample), so it scales with the eye density of the sight path as well as with the cloud — resample the path to the spacing the rule actually needs rather than to the spacing it happens to have.",
  inputs: [
    { name: "in", kind: "geometry" },
    { name: "sight", kind: "geometry" },
  ],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    lookAhead: {
      type: "f32",
      default: 12,
      min: 0,
      acceptsField: true,
      description:
        "How far along the sight path, in world units of ARC LENGTH, must be visible from each eye. The fan's targets are spread evenly over that distance, so this and `samples` together fix the resolution of the test: `lookAhead / samples` is the gap between consecutive targets, and a box narrower than that gap can slip between two chords and be kept. Size them together — halving the gap doubles the cost. As a FIELD it is evaluated on the SIGHT input's points, one look-ahead per eye, which is how a rule that varies along the route is written: attribute(\"speed\") scaled to a stopping distance asks for more sight where the observer is moving faster and less where a tight corner makes the demand impossible to satisfy anyway. A value of 0 leaves the fan with nowhere to go and collapses every chord to the eye position itself, which still asks one question — is the eye INSIDE the box — and nothing more; that is the honest reading of a zero-length line of sight, not an off switch. Negative values are read the same way as 0. A look-ahead longer than the path itself simply clamps at the far end on an open run and wraps on a closed one. This is also the HALO WIDTH a partitioned cook needs, plus `pushMax` and plus the widest box half-diagonal; as a field, use the bound the expression can reach ANYWHERE in the world rather than the largest value present in the cell, which is circular — the cell's cloud has already been clipped by the very halo you are sizing.",
    },
    samples: {
      type: "u32",
      default: 8,
      min: 1,
      max: 1024,
      description:
        "How many chords make up one eye's fan. The targets sit at `lookAhead * i / samples` for i in 1..samples, so the far end of the run is always tested and the eye's own position never is. The count exists because the rule is about a STRETCH of path rather than a point on it: with samples 1 the test is a single chord to the far end, which a box standing squarely across the middle of the run does not touch — it leaves the far point visible while hiding everything before it, and the cull would keep it. Raise this until the gap between targets is smaller than the narrowest box you care about; lowering it is the cheapest way to make the node faster and the first thing to make it wrong. The ceiling of 1024 is a guard on cost rather than a semantic limit, and the total number of chords (eyes times samples) is bounded again at cook time.",
    },
    eyeOffset: {
      type: "vec3",
      default: [0, 1.5, 0],
      acceptsField: true,
      description:
        "World-space offset added to each eye's position on the sight path, in world units. The default raises the eye 1.5 above the path, which is where an observer's eye is relative to the ground they stand on — the reason the param exists at all is that the path is almost always the surface and almost never the viewpoint, and testing from the surface would have every kerb and every rut block the view. The TARGETS are not offset: they stay on the path, because what must be visible is the path itself, and lifting both ends would let a low box hide under a chord that clears it. As a FIELD it is evaluated on the SIGHT input's points, one offset per eye, so a route that climbs into a vehicle and back out again can carry its own eye height; build it with vec(x, y, z), and note that a scalar FIELD broadcasts to all three axes (rarely what an eye height means) while a plain scalar is refused outright. An offset of [0, 0, 0] puts the eye exactly on the path.",
    },
    pushAxis: {
      type: "vec3",
      default: [1, 0, 0],
      acceptsField: true,
      description:
        "Direction along which a blocked point is moved before the node gives up and drops it, in world units. Normalized internally, so only its direction is read; the SIGN is chosen by the node, not by the author — a point is pushed in whichever of ±axis takes it FURTHER from the nearest eye, because 'out of the way' has no other meaning when the sight line is the only thing there is to be out of the way of. That is what lets one axis serve both sides of a route without an author writing a sign per point. As a FIELD it is evaluated on the `in` points, one direction per point, which is the form this param is really for: a lateral written upstream by pathSegments or promoted off the road primitive gives every point the outward direction of the stretch it stands on, and a straight world axis stops being an approximation the moment the route turns. A ZERO axis cannot be pushed along, so such a point is dropped the moment it blocks — which is a deliberate way to spell 'this one must never move' for a piece whose whole value is being in line with its neighbours (a row of markers with one shoved out of line reads as a mistake; the same row two markers shorter still reads as a row). `pushMax` 0 says the same thing for the whole cloud.",
    },
    pushMax: {
      type: "f32",
      default: 0,
      min: 0,
      acceptsField: true,
      description:
        "Furthest a blocked point may be moved along `pushAxis`, in world units. The default of 0 means NEVER PUSH: every blocker is dropped, and the node is a pure cull. There is deliberately no generous default distance — 6 is a long way in a corridor and nothing at all on a motorway, so a default would either do nothing or silently relocate an authored point by an amount nobody chose, and of the two failures dropping the point is the one an author notices. Set it as soon as the population count matters: pushing keeps the point, keeps the asset, and keeps whatever budget upstream counted, where dropping spends all three. As a FIELD it is evaluated on the `in` points, one allowance per point, and 0 for a point is exactly the 'drop rather than move' exception — attribute(\"locked\") driving it lets a class of props be immovable while everything around them shuffles aside. The search is a ladder of `pushStep` increments and stops at the FIRST distance that clears every chord, so the point moves the least it can rather than the most it may; a point still blocked at `pushMax` is dropped. Widening this widens the halo a partitioned cook needs by the same amount, since a point can be tested against eyes that far beyond where it started.",
    },
    pushStep: {
      type: "f32",
      default: 0.5,
      min: 0,
      description:
        "Distance between successive push attempts, in world units. Must be greater than 0 — a step of 0 is a search that never advances, and it is refused rather than silently treated as 'do not push', which is what `pushMax` 0 already says. This is a RESOLUTION knob and not a distance the author cares about: it decides how close to the minimum the found position is, so a point that would clear at 1.2 is placed at 1.5 with the default step and at 1.25 with a step of 0.25. It is deliberately not field-capable — a per-point search resolution is a knob nobody needs and would make two points that started together end up on different ladders, which is a difference in the OUTPUT that no author asked for. Every attempt costs a full sweep of the point's eyes, so the ratio pushMax / pushStep is the per-point cost multiplier and is bounded: a ratio above 4096 is refused with both numbers named.",
    },
    pushClearance: {
      type: "f32",
      default: 0,
      acceptsField: true,
      min: 0,
      description:
        "Room a PUSHED point needs at its new position, in world units, measured to the points already settled. It exists because pushing along a shared axis piles blockers up: a dozen props shoved aside from a dozen different eyes all come to rest at the same offset, interpenetrating, and the cull that was supposed to tidy the scene has made a heap in it. With a clearance set, a pushed point skips a rung of the ladder that would land it inside a neighbour and keeps climbing. THIS IS WHAT MAKES THE NODE GREEDY, and the trade is worth stating plainly: at 0 (the default) every point's verdict depends only on the sight input and on the point itself, so the node is embarrassingly parallel, exactly reproducible from a bounded halo, and completely indifferent to visit order. Above 0 a verdict depends on where other points settled, which depends on where THEIR neighbours settled, and no halo width covers that chain — a per-cell cook will disagree with a whole-region one at the seams. The visit order is fixed by point identity either way, so the answer is at least always the same answer. Only PUSHED points are tested: a point that never had to move stays exactly where the author put it and is never dropped for standing too close to something, which is selfPrune's job and not this node's. As a FIELD it is evaluated on the `in` points, so a large prop can demand more room than a small one; it is read on the point being PUSHED, not on the neighbour it is avoiding.",
    },
  },
  execute({ inputs, params, seed: nodeSeed, checkCancelled }) {
    const geo = requireGeometry(inputs, "in", NODE);
    const sightGeo = requireGeometry(inputs, "sight", NODE);
    // Checked before anything is read, and before either geometry is
    // consulted: a search that cannot advance is an authoring mistake
    // whatever the data says, and what a graph REFUSES must not depend on
    // the numbers that happen to arrive.
    const step = params.pushStep;
    if (!(step > 0)) {
      throw new Error(
        `${NODE}: pushStep must be greater than 0, got ${JSON.stringify(step)}; it is the distance between ` +
          "successive push attempts, so a step of 0 (or a negative one) is a search that never advances. " +
          'To turn pushing off entirely set pushMax to 0, which drops every blocker instead of moving it.',
      );
    }
    const samples = params.samples;
    if (!Number.isInteger(samples) || samples < 1) {
      throw new Error(
        `${NODE}: samples must be an integer of at least 1, got ${JSON.stringify(samples)}; it is the number ` +
          "of chords in one eye's fan, and a fractional count is not a fan. 1 tests only the far end of the " +
          "look-ahead, which a box standing across the middle of it does not touch — 8 is the default for that reason.",
      );
    }

    // Positions of both clouds, validated with the library's shared message
    // so an author reads the node and the PIN they have to fix.
    const view = positionView(geo, NODE, "in");
    const sightView = positionView(sightGeo, NODE, "sight");
    const pd = view.data;
    const ps = view.stride;
    const n = view.count;
    const sd = sightView.data;
    const ss = sightView.stride;
    const sn = sightView.count;

    // The box columns. Absent is legal and MEANS something (see the
    // messages below); present-but-reshaped is not.
    const rotAttr = geo.attrs.point.get("rot");
    if (rotAttr !== undefined && (rotAttr.type === "string" || rotAttr.tupleSize !== 4)) {
      throw transformShapeError(
        "rot",
        rotAttr.type === "string" ? "a string attribute" : `${rotAttr.type}x${rotAttr.tupleSize}`,
        "a quaternion (f32, tupleSize 4)",
        "the box's orientation",
      );
    }
    const scaleAttr = geo.attrs.point.get("scale");
    if (scaleAttr !== undefined && (scaleAttr.type === "string" || scaleAttr.tupleSize !== 3)) {
      throw transformShapeError(
        "scale",
        scaleAttr.type === "string"
          ? "a string attribute"
          : `${scaleAttr.type}x${scaleAttr.tupleSize}`,
        "three extents (f32, tupleSize 3)",
        "the box's full extents",
      );
    }
    const rd = rotAttr?.data;
    const scd = scaleAttr?.data;

    // Every field-capable param resolves BEFORE anything is decided, and
    // each on the domain its meaning lives on: the two sight params on the
    // sight cloud's points (one per eye), the three push params on the
    // input's (one per box). Nothing below mutates either geometry, so a
    // column aliasing attribute storage stays valid for the whole scan.
    const lookAhead = scalarPerElement(
      sightGeo,
      "lookAhead",
      params.lookAhead,
      nodeSeed,
      "a distance along the path",
      "point",
      sn,
    );
    const eyeOffset = vec3PerElement(
      sightGeo,
      "eyeOffset",
      params.eyeOffset,
      nodeSeed,
      "an eye offset is a position's worth of numbers",
      "point",
      sn,
    );
    const pushAxis = vec3PerElement(
      geo,
      "pushAxis",
      params.pushAxis,
      nodeSeed,
      "a push direction is a position's worth of numbers",
      "point",
      n,
    );
    const pushMax = scalarPerElement(
      geo,
      "pushMax",
      params.pushMax,
      nodeSeed,
      "a distance",
      "point",
      n,
    );
    const clearance = scalarPerElement(
      geo,
      "pushClearance",
      params.pushClearance,
      nodeSeed,
      "a distance",
      "point",
      n,
    );

    let widestPush = 0;
    let widestClearance = 0;
    for (let i = 0; i < n; i++) {
      if (pushMax[i] > widestPush) widestPush = pushMax[i];
      if (clearance[i] > widestClearance) widestClearance = clearance[i];
    }
    if (Math.floor(widestPush / step) > MAX_PUSH_STEPS) {
      throw new Error(
        `${NODE}: pushMax ${widestPush} at pushStep ${step} is ${Math.floor(widestPush / step)} attempts for a ` +
          `single blocked point, over the ceiling of ${MAX_PUSH_STEPS}. Every attempt re-tests that point against ` +
          "every chord it can reach, so the ratio is the per-point cost multiplier. Raise pushStep (it is a search " +
          "resolution, not a distance anyone measures) or lower pushMax.",
      );
    }

    // The eyes and their fans, built once. Chords are STRAIGHT LINES in
    // space while `lookAhead` is measured along the path, so the widest
    // chord is discovered here rather than assumed — it is what the eye
    // query below has to reach, and on a hairpin it is far shorter than the
    // arc that produced it.
    const chains = sightChains(sightGeo, sd, ss);
    let eyeCount = 0;
    for (const chain of chains) {
      eyeCount += chain.closed ? chain.points.length - 1 : chain.points.length;
    }
    if (eyeCount * samples > MAX_SIGHT_CHORDS) {
      throw new Error(
        `${NODE}: ${eyeCount} eyes at samples ${samples} is ${eyeCount * samples} chords, over the ceiling of ` +
          `${MAX_SIGHT_CHORDS}. The eye count is however many points the "sight" input carries, which nobody typed — ` +
          "thin it with pathResample (spacing mode) to the spacing the rule actually needs, or lower samples. " +
          "Both are allocations made before a single point is tested, which is why this is refused rather than merely slow.",
      );
    }
    const eyePos = new Float64Array(eyeCount * 3);
    const targets = new Float64Array(eyeCount * samples * 3);
    const loc: number[] = [0, 0];
    let widestChord = 0;
    let e = 0;
    for (const chain of chains) {
      const pts = chain.points;
      const cum = chain.cum;
      const nv = pts.length;
      const m = chain.closed ? nv - 1 : nv;
      const total = cum[nv - 1];
      for (let k = 0; k < m; k++) {
        const pt = pts[k];
        const o = pt * ss;
        const ex = sd[o] + eyeOffset[pt * 3];
        const ey = sd[o + 1] + eyeOffset[pt * 3 + 1];
        const ez = sd[o + 2] + eyeOffset[pt * 3 + 2];
        eyePos[e * 3] = ex;
        eyePos[e * 3 + 1] = ey;
        eyePos[e * 3 + 2] = ez;
        // A negative look-ahead is read as 0 rather than as a fan pointing
        // backwards: "how far ahead must be visible" has no negative value,
        // and extrapolating off the start of the run would invent path.
        const ahead = lookAhead[pt] > 0 ? lookAhead[pt] : 0;
        for (let s = 1; s <= samples; s++) {
          let arc = cum[k] + (ahead * s) / samples;
          if (chain.closed && total > 0) {
            arc %= total;
            if (arc < 0) arc += total;
          }
          locateOnArcLength(loc, cum, arc);
          const seg = loc[0];
          const t = loc[1];
          const a = pts[seg] * ss;
          const b = pts[seg + 1] * ss;
          const tx = sd[a] + (sd[b] - sd[a]) * t;
          const ty = sd[a + 1] + (sd[b + 1] - sd[a + 1]) * t;
          const tz = sd[a + 2] + (sd[b + 2] - sd[a + 2]) * t;
          const to = (e * samples + (s - 1)) * 3;
          targets[to] = tx;
          targets[to + 1] = ty;
          targets[to + 2] = tz;
          const d = Math.sqrt((tx - ex) ** 2 + (ty - ey) ** 2 + (tz - ez) ** 2);
          if (d > widestChord) widestChord = d;
        }
        e++;
      }
    }
    // Cell size decides only how many cells a query touches, never an
    // answer; the widest chord makes the usual query a 3x3x3 block, and a
    // degenerate sight input (every chord zero-length) has no informative
    // size, so 1 stands in and every query full-scans a set that is empty
    // or tiny anyway.
    const eyeGrid = UniformGrid.build(
      { data: eyePos, stride: 3, count: eyeCount },
      widestChord > 0 ? widestChord : 1,
    );

    // THE VISIT ORDER, and the whole of this node's determinism story.
    //
    // canonicalPointRanks keys on point IDENTITY (the bits of the stored
    // position plus the `seed` attribute), then on the raw position bits
    // and seed again, and only on the array index for two points that are
    // byte-identical in both — which this library already treats as the
    // same point. Index order would make the survivors a function of the
    // array a cook happened to build: the same two points would settle
    // differently after a shuffle, after an upstream filter, or in a cell
    // that derived them in another order. Identity is the point's own name,
    // so both sides of a seam agree on it.
    //
    // Built even though the order only CHANGES an answer when
    // pushClearance is above 0. Whether this node is greedy is a property
    // of the graph, and the order must not be one thing on one path and
    // another on the other: a graph that turns a clearance on should get
    // the same survivors it had, plus the clearance.
    const rank = canonicalPointRanks(geo, NODE);
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[rank[i]] = i;

    // Scratch reused across every point: the SoA rule forbids allocating
    // per point, and these are the only per-point objects there would be.
    const axes = new Float64Array(9);
    const half = new Float64Array(3);
    const hits: number[] = [];

    /** Does a box at this centre block any chord of any reachable eye? */
    const blocks = (cx: number, cy: number, cz: number): boolean => {
      for (const eye of hits) {
        const eo = eye * 3;
        const ex = eyePos[eo];
        const ey = eyePos[eo + 1];
        const ez = eyePos[eo + 2];
        const base = eye * samples * 3;
        for (let s = 0; s < samples; s++) {
          const to = base + s * 3;
          if (
            segmentHitsBox(
              ex,
              ey,
              ez,
              targets[to],
              targets[to + 1],
              targets[to + 2],
              cx,
              cy,
              cz,
              axes,
              0,
              half,
              0,
            )
          ) {
            return true;
          }
        }
      }
      return false;
    };

    const finalPos = new Float64Array(n * 3);
    const kept = new Uint8Array(n);
    const moved = new Uint8Array(n);
    // Only built when a clearance can actually bite. The grid indexes the
    // SETTLED positions, which is why it reads `finalPos` rather than the
    // input's P: a point that was pushed occupies where it ended up.
    const settled =
      widestClearance > 0
        ? new UniformGrid({ data: finalPos, stride: 3, count: n }, widestClearance)
        : undefined;

    for (let k = 0; k < n; k++) {
      if ((k & (CANCEL_STRIDE - 1)) === 0) checkCancelled();
      const i = order[k];
      const o = i * ps;
      const cx = pd[o];
      const cy = pd[o + 1];
      const cz = pd[o + 2];
      // A missing `rot` column is the identity rotation — the attribute's
      // own default, and a box aligned to the world axes. A missing
      // `scale` column is a DEGENERATE box with no extent at all, and that
      // asymmetry is deliberate: assuming a unit box would delete points on
      // the strength of a size nobody wrote, while assuming no box makes
      // the node a visible no-op that an author can diagnose. Negative
      // extents mirror rather than shrink, so the magnitude is what a half
      // extent reads.
      writeBoxAxes(
        axes,
        rd === undefined ? 0 : rd[i * 4],
        rd === undefined ? 0 : rd[i * 4 + 1],
        rd === undefined ? 0 : rd[i * 4 + 2],
        rd === undefined ? 1 : rd[i * 4 + 3],
      );
      half[0] = scd === undefined ? 0 : Math.abs(scd[i * 3]) * 0.5;
      half[1] = scd === undefined ? 0 : Math.abs(scd[i * 3 + 1]) * 0.5;
      half[2] = scd === undefined ? 0 : Math.abs(scd[i * 3 + 2]) * 0.5;
      const boxRadius = Math.sqrt(half[0] ** 2 + half[1] ** 2 + half[2] ** 2);
      const allowance = pushMax[i] > 0 ? pushMax[i] : 0;
      // Every point of every chord lies within that chord's own length of
      // its eye, so a box touching one has its CENTRE within
      // widestChord + boxRadius of that eye — plus however far this point
      // may travel, since the same eye set has to serve every candidate.
      eyeGrid.queryRadius(cx, cy, cz, widestChord + boxRadius + allowance, hits);

      let fx = cx;
      let fy = cy;
      let fz = cz;
      let survives = true;
      if (hits.length > 0 && blocks(cx, cy, cz)) {
        survives = false;
        const ax0 = pushAxis[i * 3];
        const ay0 = pushAxis[i * 3 + 1];
        const az0 = pushAxis[i * 3 + 2];
        const axisLen = Math.sqrt(ax0 * ax0 + ay0 * ay0 + az0 * az0);
        const steps = axisLen > 0 ? Math.floor(allowance / step) : 0;
        if (steps > 0) {
          const ax = ax0 / axisLen;
          const ay = ay0 / axisLen;
          const az = az0 / axisLen;
          // Away from the sight path: the nearest reachable eye fixes the
          // sign, and `hits` is ascending, so a tie between two equidistant
          // eyes goes to the lower index — a property of the eye array,
          // which the sight input's own topology fixes, not of this cloud's
          // order.
          let nearest = -1;
          let best = Number.POSITIVE_INFINITY;
          for (const eye of hits) {
            const eo = eye * 3;
            const d =
              (eyePos[eo] - cx) ** 2 + (eyePos[eo + 1] - cy) ** 2 + (eyePos[eo + 2] - cz) ** 2;
            if (d < best) {
              best = d;
              nearest = eye;
            }
          }
          let sign = 1;
          if (nearest >= 0) {
            const eo = nearest * 3;
            const away =
              (cx - eyePos[eo]) * ax + (cy - eyePos[eo + 1]) * ay + (cz - eyePos[eo + 2]) * az;
            if (away < 0) sign = -1;
          }
          const room = clearance[i] > 0 ? clearance[i] : 0;
          for (let s = 1; s <= steps; s++) {
            // s * step rather than an accumulated sum: an accumulation
            // drifts off the ladder the author wrote, and the rung a point
            // lands on is part of the output.
            const d = s * step * sign;
            const qx = cx + ax * d;
            const qy = cy + ay * d;
            const qz = cz + az * d;
            if (blocks(qx, qy, qz)) continue;
            if (room > 0 && settled !== undefined && settled.hasPointCloserThan(qx, qy, qz, room)) {
              continue;
            }
            fx = qx;
            fy = qy;
            fz = qz;
            survives = true;
            moved[i] = 1;
            break;
          }
        }
      }
      if (!survives) continue;
      kept[i] = 1;
      finalPos[i * 3] = fx;
      finalPos[i * 3 + 1] = fy;
      finalPos[i * 3 + 2] = fz;
      settled?.insert(i);
    }

    // Survivors come out in ascending INPUT index order, exactly as the
    // point filters emit theirs: the visit order above chooses WHO
    // survives, never the order they are emitted in.
    const keep: number[] = [];
    for (let i = 0; i < n; i++) {
      if (kept[i] === 1) keep.push(i);
    }
    const out = gatherPoints(geo, keep);
    if (keep.length > 0) {
      const outP = out.attrs.point.require("P");
      for (let j = 0; j < keep.length; j++) {
        const i = keep[j];
        if (moved[i] === 0) continue;
        outP.set(j, finalPos[i * 3], 0);
        outP.set(j, finalPos[i * 3 + 1], 1);
        outP.set(j, finalPos[i * 3 + 2], 2);
      }
    }
    return { out: [makeGeometryItem(out)] };
  },
});
