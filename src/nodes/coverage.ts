/**
 * Coverage nodes: is a point of a path covered, from some direction, by a
 * cloud of oriented boxes?
 *
 * WHY THIS CASTS RAYS INSTEAD OF TESTING BOUNDS. The question "how much of
 * this path runs under cover" has three cheap proxies and all three are
 * wrong. Binning a box at its centre, projecting its bounds corners onto
 * the path's arc length, and taking its lateral reach in the path's own
 * frame gave 7.9%, 32.3% and 50.3% for the same circuit — no two of them
 * estimating the same quantity, each trading one artefact for another. The
 * 32.3% figure was published and then withdrawn: it came from a single
 * object near a hairpin claiming 78 half-widths of lap for 6 half-widths of
 * geometry, because A BOUNDS PROJECTION ONTO A FOLDED CENTRELINE CANNOT
 * TELL "ABOVE THE PATH HERE" FROM "NEAR THE PATH TWICE". Two stations tens
 * of units apart along the arc are centimetres apart in world space at a
 * hairpin, and a path-relative window either misses the cover or claims
 * path the geometry never spanned. The ray cast is the first method that
 * CONVERGES — 10.5% at one ceiling height, 10.7% at twice it — which is the
 * property the other three lacked, and it converges because it is asked and
 * answered entirely in WORLD SPACE, where a fold is two different places.
 *
 * That argument is the whole reason this node exists, and it is why none of
 * its geometry is expressed in path coordinates: the fan is built at a
 * point's world position, and a box is hit or not hit in the world.
 */
import type { Geometry } from "../data/index.js";
import type { Column } from "../fields/index.js";
import { cloneGeometry, makeGeometryItem } from "../graph/index.js";
import { UniformGrid } from "../spatial/index.js";
import { standardNode } from "./registry.js";
import {
  ORIENT_PARALLEL_EPS,
  type FieldParam,
  polylineArcTables,
  positionView,
  readComp,
  requireGeometry,
  requireReportSlot,
  requireScalarColumn,
  requireVec3Column,
  resolveOn,
  rotateVec,
  writePolylineTangents,
} from "./util.js";

/**
 * How little of a ray may lie along a slab axis before the slab counts as
 * parallel to it — as a FRACTION of the ray's own length, because that is
 * the only thing "little" can be measured against here.
 *
 * PARALLEL IS A RATIO, NOT A LENGTH. The guard asks whether the ray has any
 * extent along an axis before it divides by that extent, and "any" only
 * means something relative to the ray itself: the same 1e-9 of projection
 * is a dead-parallel cast on a ray tens of units long and a perfectly
 * ordinary crossing on a ray that short.
 *
 * An ABSOLUTE guard is what this replaces, and the absolute value that
 * looked safe (1e-12) is below what f32 can even hold at world scale — one
 * part in 10^12 of a 30-unit ray is a hundred thousand times finer than the
 * f32 spacing there, so the branch would never be taken and a grazing ray
 * would divide by something indistinguishable from zero. `t1` and `t2` come
 * back at 1e12 and the slab arithmetic that follows is meaningless.
 *
 * A relative threshold of 1e-6 is about eight f32 spacings, and it changes
 * nothing in f64: for a near-parallel ray the two branches already AGREE in
 * the limit — outside the slab the two enormous roots share a sign and fail
 * `tMin > tMax`, which is the parallel branch's `return false`; inside it
 * they straddle and leave `tMin`/`tMax` alone, which is its `continue`.
 * This computes that answer instead of arriving at it through 1e12.
 */
const PARALLEL_FRACTION = 1e-6;

/** How many path points between cancellation checks. */
const CANCEL_STRIDE = 256;

/**
 * Does the segment from (fx, fy, fz) to (tx, ty, tz) pass through box `b`?
 *
 * The slab method IN THE BOX'S OWN FRAME, not the world frame. A box in
 * this library is oriented by a quaternion and is axis-aligned in nobody's
 * frame but its own, so the segment is projected onto the box's three axes
 * and the interval test runs there. A world-space AABB test would be a
 * different (and always larger) box, which on a banked or rolled placement
 * reports cover that is not there.
 *
 * Reads the SoA tables directly and takes no vectors: this runs once per
 * (path point, box, ray) triple, and a per-call `[x, y, z]` is exactly the
 * per-element allocation the hot-path rule forbids.
 *
 * `<=` in the parallel test rather than `<` so that a degenerate
 * zero-length ray — a point, which is what `near === far` and `spread === 0`
 * produce — takes the parallel branch on all three axes and is tested for
 * containment instead of dividing by zero.
 */
function segmentHitsBox(
  b: number,
  centre: Float64Array,
  axes: Float64Array,
  half: Float64Array,
  fx: number,
  fy: number,
  fz: number,
  tx: number,
  ty: number,
  tz: number,
): boolean {
  const c = b * 3;
  const ox = fx - centre[c];
  const oy = fy - centre[c + 1];
  const oz = fz - centre[c + 2];
  const dx = tx - fx;
  const dy = ty - fy;
  const dz = tz - fz;
  const parallel = PARALLEL_FRACTION * Math.hypot(dx, dy, dz);
  let tMin = 0;
  let tMax = 1;
  for (let a = 0; a < 3; a++) {
    const o = b * 9 + a * 3;
    const ex = axes[o];
    const ey = axes[o + 1];
    const ez = axes[o + 2];
    const lo = ox * ex + oy * ey + oz * ez;
    const ld = dx * ex + dy * ey + dz * ez;
    const h = half[c + a];
    if (Math.abs(ld) <= parallel) {
      // Parallel to this slab: outside it here is outside it everywhere.
      if (lo < -h || lo > h) return false;
      continue;
    }
    let t1 = (-h - lo) / ld;
    let t2 = (h - lo) / ld;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return false;
  }
  return true;
}

/**
 * The box cloud in the only form the ray test wants: SoA world centres,
 * orthonormal axes, world half-extents, and the radius of each box's
 * bounding sphere.
 */
interface BoxTable {
  readonly count: number;
  /** World centre, 3 per box — a box is centred on its own point. */
  readonly centre: Float64Array;
  /** The images of local +X, +Y, +Z, 9 per box, orthonormal. */
  readonly axes: Float64Array;
  /** World half-extents along those axes, 3 per box. */
  readonly half: Float64Array;
  /** `|half|`: the radius of the sphere about `centre` containing the box. */
  readonly radius: Float64Array;
}

/**
 * Build the box table from the standard transform attributes.
 *
 * THE UNITS TRAP, stated once so nobody has to rediscover it. A box's world
 * size is `boxSize * scale`, componentwise — `boxSize` is the asset's own
 * extent in its local frame and `scale` is the per-point multiplier
 * `spawnInstances` puts in the matrix. Multiplying by only one of them
 * shrinks or inflates every box, and BOTH mistakes produce a run that looks
 * plausible: too small reports no cover anywhere, too large reports a tunnel
 * over everything. The default `boxSize` of [1, 1, 1] is the unit-cube
 * asset, for which `scale` alone IS the size.
 *
 * A `rot` that is not unit length is normalized here (a zero quaternion
 * reads as identity). The slab test needs an orthonormal frame, and a
 * non-unit quaternion rotated straight through would skew it. Note that
 * this is the one place the measurement and `spawnInstances` can disagree:
 * a non-unit `rot` also SCALES the rendered instance, and that extra scale
 * is ignored here. Keep `rot` unit — every node in this library that writes
 * it does.
 */
function buildBoxTable(boxes: Geometry, size: Column): BoxTable {
  const points = boxes.attrs.point;
  const P = points.require("P");
  const pd = P.data;
  const ps = P.tupleSize;
  const n = boxes.pointCount;
  const rotAttr = points.get("rot");
  const rot = rotAttr && rotAttr.type === "f32" && rotAttr.tupleSize === 4 ? rotAttr.data : undefined;
  const scaleAttr = points.get("scale");
  const scale =
    scaleAttr && scaleAttr.type === "f32" && scaleAttr.tupleSize === 3 ? scaleAttr.data : undefined;

  const centre = new Float64Array(n * 3);
  const axes = new Float64Array(n * 9);
  const half = new Float64Array(n * 3);
  const radius = new Float64Array(n);
  // One scratch tuple for every rotation of every box: hoisted out of the
  // loop so the build allocates per CLOUD and not per box.
  const v: number[] = [0, 0, 0];
  for (let b = 0; b < n; b++) {
    const o = b * ps;
    centre[b * 3] = pd[o];
    centre[b * 3 + 1] = pd[o + 1];
    centre[b * 3 + 2] = pd[o + 2];

    let qx = 0;
    let qy = 0;
    let qz = 0;
    let qw = 1;
    if (rot) {
      const r = b * 4;
      qx = rot[r];
      qy = rot[r + 1];
      qz = rot[r + 2];
      qw = rot[r + 3];
      const len = Math.hypot(qx, qy, qz, qw);
      if (len > 0) {
        qx /= len;
        qy /= len;
        qz /= len;
        qw /= len;
      } else {
        qw = 1;
      }
    }
    rotateVec(v, qx, qy, qz, qw, 1, 0, 0);
    axes[b * 9] = v[0];
    axes[b * 9 + 1] = v[1];
    axes[b * 9 + 2] = v[2];
    rotateVec(v, qx, qy, qz, qw, 0, 1, 0);
    axes[b * 9 + 3] = v[0];
    axes[b * 9 + 4] = v[1];
    axes[b * 9 + 5] = v[2];
    rotateVec(v, qx, qy, qz, qw, 0, 0, 1);
    axes[b * 9 + 6] = v[0];
    axes[b * 9 + 7] = v[1];
    axes[b * 9 + 8] = v[2];

    // Half-extents: half the local size, scaled per axis. Negative sizes
    // and negative scales are mirrored, never inverted — a box of size -2
    // is the same set of points as one of size 2.
    const hx = Math.abs(0.5 * readComp(size, b, 0) * (scale ? scale[b * 3] : 1));
    const hy = Math.abs(0.5 * readComp(size, b, 1) * (scale ? scale[b * 3 + 1] : 1));
    const hz = Math.abs(0.5 * readComp(size, b, 2) * (scale ? scale[b * 3 + 2] : 1));
    half[b * 3] = hx;
    half[b * 3 + 1] = hy;
    half[b * 3 + 2] = hz;
    radius[b] = Math.hypot(hx, hy, hz);
  }
  return { count: n, centre, axes, half, radius };
}

/**
 * Which boxes could possibly meet which point's fan.
 *
 * THE CORRECTNESS ARGUMENT, which is the only reason a prefilter is allowed
 * to exist at all. Let `p` be a path point, `c` a box's centre, `R` the
 * radius of the sphere about `c` containing the box, and `D` the ray reach
 * (the farthest any point of any of `p`'s rays can be from `p`). If a ray at
 * `p` meets that box then some `x` lies on both, so
 * `|p - c| <= |p - x| + |x - c| <= D + R`. Every pair failing that
 * inequality is discarded and no hitting pair can be. Note the bound uses
 * each box's OWN `R`: a long canopy centred far off the path still gets
 * tested, which a fixed centre-distance cutoff would wrongly drop.
 *
 * IT IS A WORLD-SPACE BOUND, NOT A PATH-COORDINATE ONE, and that is the
 * whole point — see this module's header. Bucketing by arc length and
 * widening by a box's extent is unsound exactly where a path folds back on
 * itself.
 *
 * TWO TIERS, because one grid cannot hold a skybox and a bollard. Boxes
 * whose `R` is at most `split` are binned by centre into a uniform grid
 * whose cell is exactly the query radius `D + split`, so a query is the
 * 3x3x3 block around the point's cell. The rest are scanned for every path
 * point. `split` is `max(D, median R)`, which bounds the linear tier at HALF
 * the cloud however the sizes are distributed: the racetrack case (a few
 * grandstand shells among thousands of kit pieces) bins everything but the
 * shells, and a cloud of uniformly enormous boxes degrades to a coarse grid
 * rather than to a lie.
 */
interface BoxIndex {
  /** Grid over the binned boxes' centres, absent when nothing is binned. */
  readonly grid: UniformGrid | undefined;
  /** Grid point index -> box index. */
  readonly binned: Uint32Array;
  /** Boxes tested at every path point. */
  readonly large: Uint32Array;
  /** Radius to query the grid with; equals the grid's cell size. */
  readonly queryRadius: number;
}

function buildBoxIndex(table: BoxTable, reach: number): BoxIndex {
  const n = table.count;
  if (n === 0 || !Number.isFinite(reach)) {
    // Nothing to index, or a reach that cannot size a cell: every box is
    // scanned. Sound either way — the tiers change the COST of the answer
    // and never the answer.
    return {
      grid: undefined,
      binned: new Uint32Array(0),
      large: Uint32Array.from({ length: n }, (_, b) => b),
      queryRadius: 0,
    };
  }
  const sorted = Float64Array.from(table.radius);
  sorted.sort();
  // The LOWER median, so at least half the boxes satisfy `R <= split`
  // whatever the ties do. A non-finite radius sorts last and lands in the
  // linear tier, where it costs time and breaks nothing.
  const median = sorted[(n - 1) >> 1];
  const split = Math.max(reach, Number.isFinite(median) ? median : 0);
  const queryRadius = reach + split;
  const binnedList: number[] = [];
  const largeList: number[] = [];
  for (let b = 0; b < n; b++) {
    if (table.radius[b] <= split) binnedList.push(b);
    else largeList.push(b);
  }
  if (binnedList.length === 0 || !(queryRadius > 0)) {
    return {
      grid: undefined,
      binned: new Uint32Array(0),
      large: Uint32Array.from({ length: n }, (_, b) => b),
      queryRadius: 0,
    };
  }
  const binned = Uint32Array.from(binnedList);
  const positions = new Float64Array(binned.length * 3);
  for (let k = 0; k < binned.length; k++) {
    const c = binned[k] * 3;
    positions[k * 3] = table.centre[c];
    positions[k * 3 + 1] = table.centre[c + 1];
    positions[k * 3 + 2] = table.centre[c + 2];
  }
  const grid = UniformGrid.build({ data: positions, stride: 3, count: binned.length }, queryRadius);
  return { grid, binned, large: Uint32Array.from(largeList), queryRadius };
}

/**
 * Unit across-direction for every path point, from the path's own topology.
 *
 * The tangent is the central difference between a point's neighbours along
 * the polyline (`writePolylineTangents`, shared with `writeTangents` and
 * `writeCurveFrame` so the three cannot drift), and "across" is that tangent
 * crossed with the cast direction — perpendicular to both, which is what
 * "offset across the path" means for a fan cast along `direction`.
 */
function tangentsOf(geo: Geometry): Float32Array {
  const P = geo.attrs.point.require("P");
  const out = new Float32Array(geo.pointCount * 3);
  writePolylineTangents(polylineArcTables(geo, "pathCoverage"), P.data, P.tupleSize, out);
  return out;
}

/** Params of {@link pathCoverage}. */
export interface PathCoverageParams {
  direction: FieldParam;
  near: FieldParam;
  far: FieldParam;
  rayCount: number;
  spread: FieldParam;
  minHits: number;
  acrossAttr: string;
  boxSize: FieldParam;
  coveredAttr: string;
  hitsAttr: string;
}

/** Per-point cover from a cloud of oriented boxes, by ray cast. */
export const pathCoverage = standardNode<PathCoverageParams>({
  type: "pathCoverage",
  category: "attribute",
  description:
    "Measures, at every point of the `path` input, whether that point is COVERED from some direction by any of the oriented boxes in the `boxes` input, and writes the answer as point attributes: coveredAttr gets a bool (did at least minHits rays hit anything), hitsAttr gets the u32 count of rays that did. The test is a FAN OF REAL RAYS IN WORLD SPACE — rayCount segments running from `near` to `far` along `direction`, offset evenly across the path over -spread..+spread — intersected against each box as an oriented box (position from P, orientation from rot, extent from boxSize times scale, the same columns spawnInstances reads), by the slab method in the BOX'S OWN frame. It casts rays rather than testing path-relative bounds because a bounds projection onto a folded centreline cannot tell 'above the path here' from 'near the path twice': that mistake put a single object near a hairpin in credit for 78 half-widths of lap on 6 half-widths of geometry, and the 32.3% figure it produced had to be withdrawn. Three cheaper proxies for the same question disagreed with each other by a factor of six; the ray cast is the one that converges as the far plane moves, because a fold is two different places in the world and one place in arc length. A FAR PLANE IS LOAD-BEARING: with no ceiling the sky is a tunnel, so `far` is a real distance and not a sentinel for infinity. Rays are counted DISTINCT, not per box — three boxes stacked over the same two rays is two hits, not six, because the question is whether cover spans the corridor and not how much of it there is. THIS NODE ADDS A COLUMN AND REMOVES NOTHING: points, vertices, primitives, the polyline topology and every existing attribute come through untouched, so a path goes in and the same path comes out one column wider. That is the opposite of the point filters (filterByAttribute, filterByExpression, filterByDensity, filterByBounds, selfPrune), which rebuild the point domain from the survivors and take the topology with it — measure first with this node, then filter on the attribute it wrote if dropping points is what you wanted. It is ORDER-INDEPENDENT by construction: no point's answer depends on any other point, no box's on any other box, and nothing is accumulated in floating point, so the output is identical whatever order the boxes arrive in and the node is EXACTLY CELL-INVARIANT under a partitioned cook given a halo of hypot(spread, max(|near|, |far|)) + the largest box's bounding-sphere radius (half the length of its boxSize*scale vector) — a cell that sees every box within that distance of it computes exactly what the whole world would. Cost is O(path points x candidate boxes): boxes are indexed in a two-tier structure, a uniform grid over the ones no larger than the ray reach (queried as a 3x3x3 block) plus a linear tier for the rest, bounded at half the cloud by splitting at the median radius.",
  inputs: [
    { name: "path", kind: "geometry" },
    { name: "boxes", kind: "geometry" },
  ],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    direction: {
      type: "vec3",
      default: [0, 1, 0],
      acceptsField: true,
      description:
        "World direction the rays are cast along, from each path point; need not be unit length. The default [0, 1, 0] asks the question this node was built for — what is ABOVE the path — but the axis is free: cast along -Y to ask what the path stands on, or along a horizontal axis to ask what walls it in. As a FIELD it is PER PATH POINT, resolved on the path's own point domain, which is how a banked or rolled path asks about its own local up rather than the world's: pass attribute(\"N\") or a curve frame's normal and each point casts along the surface it belongs to. A zero-length direction is REFUSED, naming the point — unlike orientAlongVector, where a zero direction has the honest reading 'leave this point alone', a coverage query with no cast direction has no answer at all, and reporting 'not covered' for it would be exactly the plausible-looking cook this library refuses to produce.",
    },
    near: {
      type: "f32",
      default: 0,
      acceptsField: true,
      description:
        "Where each ray STARTS, as a distance along `direction` from the path point. This is the floor of the test, and it is what stops the path's own surface — and anything lying on it — from counting as cover over it: on a road, set it above the tallest kerb and below the lowest thing that could ever be a roof. Negative values start the ray behind the point. As a FIELD it is per path point. Together with `far` and `spread` it fixes the ray reach hypot(spread, max(|near|, |far|)), which is the halo this node needs under a partitioned cook.",
    },
    far: {
      type: "f32",
      default: 10,
      acceptsField: true,
      description:
        "Where each ray ENDS, as a distance along `direction` from the path point. THE FAR PLANE IS LOAD-BEARING AND HAS NO 'UNLIMITED' SETTING: with an unbounded ray the sky is a tunnel and the answer is 100% everywhere, so this is a real distance chosen for the scene — the height above which something overhead has stopped being cover and started being scenery. A measurement whose value is that today's figure can be compared with yesterday's must not move when a placement rule is retuned, so prefer restating the number here to importing it from whatever placed the boxes. `far` less than `near` describes the same segment reversed and is legal; `far` equal to `near` collapses each ray to a point and asks pure containment. As a FIELD it is per path point.",
    },
    rayCount: {
      type: "i32",
      default: 6,
      min: 1,
      description:
        "How many rays in the fan, spread evenly across -spread..+spread WITH BOTH EDGES INCLUDED. 1 casts a single ray straight through the point and ignores `spread`. A single centre ray is not enough for anything wider than a footpath: cover over a corridor is usually a shell with legs at the edges and a span in the middle, and one ray down the middle either sees the span and calls a bare gantry a tunnel, or sits in the gap between two panels and calls a tunnel bare. Six over three half-widths — the shipped default — puts rays at the corridor edges, where the legs are, without doubling up on the middle, where a single spanning panel already answers for everything. Cost is linear in this: each ray is one slab test per candidate box, minus the ones already hit.",
    },
    spread: {
      type: "f32",
      default: 1.5,
      min: 0,
      acceptsField: true,
      description:
        "HALF the lateral span of the fan, in world units: rays are placed from -spread to +spread across the path, so the full corridor tested is 2*spread wide. 'Across' is perpendicular to both the path's own direction of travel and to `direction` (see acrossAttr for where that comes from). Set it to the width you are willing to call covered — wider than the path itself if a partial overhang counts, narrower if only cover directly overhead does. 0 collapses the fan onto the centre line whatever rayCount says, which makes every ray identical and the hit count either 0 or rayCount. As a FIELD it is per path point, so a path that changes width can carry its own corridor; the ray reach, and therefore the partitioned-cook halo, is then set by the LARGEST value the field can return anywhere in the world, which is a bound to derive rather than measure.",
    },
    minHits: {
      type: "i32",
      default: 3,
      min: 1,
      description:
        "How many of the fan's rays must hit before the point counts as covered, AT LEAST this many (the test is >=, so 3 of 6 is covered). This is the knob that decides what 'under cover' means, and it is a threshold rather than a fraction so that it reads the same when rayCount changes: half the rays is the shipped default and says 'art spans the corridor', 1 says 'anything at all overhead', rayCount says 'cover edge to edge'. Refused when it exceeds rayCount, because that test can never pass and a run of all-false is not a useful way to learn so. hitsAttr writes the raw count, so a graph that wants a different threshold later can write the count once and compare it downstream instead of re-casting.",
    },
    acrossAttr: {
      type: "string",
      default: "",
      description:
        "Name of a numeric point attribute (tuple 3) on the path giving the across direction directly, for paths that already carry their own frame. Empty (the default) derives it from the path's POLYLINE TOPOLOGY instead: the central-difference tangent at each point (the same one writeTangents and writeCurveFrame produce) crossed with `direction`. That derivation is why an empty acrossAttr requires real polyline primitives and refuses a bare point cloud. Prefer this param when the boxes were placed through a frame the path already stores: a second way of computing 'across' is a second chance to disagree with the geometry being measured, and the disagreement looks like a plausible number rather than like a bug. Whatever the source, the vector is made perpendicular to `direction` and normalized before use, so the fan stays a flat fan and the ray-reach bound stays exact. A point with no usable across direction — one no polyline visits, or one whose path neighbours all coincide, or a tangent parallel to `direction` — falls back to a deterministic axis perpendicular to `direction` (the same fallback orientAlongVector uses), so it is still measured and still reproducible, but its fan is not oriented by the path.",
    },
    boxSize: {
      type: "vec3",
      default: [1, 1, 1],
      acceptsField: true,
      description:
        "Extent of one box along its own local X, Y and Z axes BEFORE the per-point `scale` is applied — the size of the asset the cloud stands for. The world half-extent is 0.5 * boxSize * scale componentwise, so the default [1, 1, 1] means 'the points carry unit cubes and `scale` IS the size', which is the common case. As a FIELD it is resolved ON THE BOXES CLOUD, not on the path, so attribute(\"...\") inside it reads the boxes' own columns: a cloud carrying its extents in the standard bounds attributes is subtract(attribute(\"boundsMax\"), attribute(\"boundsMin\")). GETTING THIS WRONG IS SILENT IN BOTH DIRECTIONS: scaling twice inflates every box and reports a tunnel over the whole path, forgetting `scale` shrinks them and reports no cover anywhere, and each produces a run that finishes cleanly with a wrong number in it. Boxes are centred on their points; a negative size is read as its magnitude, since a box of size -2 is the same set of points as one of size 2.",
    },
    coveredAttr: {
      type: "string",
      default: "covered",
      description:
        "Name of the bool point attribute receiving the covered/not decision (hits >= minHits). Empty writes no flag (then hitsAttr must be set). The shape is this node's to pick (bool, tuple 1), so a name the path already holds under a DIFFERENT shape is REFUSED, not overwritten: writing it would delete that column outright and the cook would still look fine (coveredAttr \"P\" would leave a path with no positions). An existing bool tuple-1 column of the same name IS reused and reset, so re-running this node over its own output is fine. To write over something of another shape, removeAttribute it first, or pick another name.",
    },
    hitsAttr: {
      type: "string",
      default: "",
      description:
        "Name of the u32 point attribute receiving how many of the fan's rays hit at least one box, 0..rayCount. Empty (the default) writes no count. Worth writing when the threshold is still being chosen, or when the interesting quantity is HOW enclosed a point is rather than whether it passed: the count is what distinguishes a bare gantry from a tunnel, and a graph can compare it against several thresholds downstream without casting again. Same rule as coveredAttr: the shape is this node's to pick (u32, tuple 1), so a name held under a different shape is refused, while a same-shape column is reused and reset.",
    },
  },
  execute({ inputs, params, checkCancelled, seed: nodeSeed }) {
    const geo = cloneGeometry(requireGeometry(inputs, "path", "pathCoverage"));
    const boxes = requireGeometry(inputs, "boxes", "pathCoverage");
    const wantCovered = params.coveredAttr !== "";
    const wantHits = params.hitsAttr !== "";
    if (!wantCovered && !wantHits) {
      throw new Error(
        "pathCoverage: nothing to write — set coveredAttr (the bool covered/not flag) or hitsAttr (the count of rays that hit), or both; both are currently empty",
      );
    }
    const rayCount = params.rayCount;
    if (!Number.isInteger(rayCount) || rayCount < 1) {
      throw new Error(
        `pathCoverage: rayCount is ${rayCount}, but a fan needs at least one ray; pass a positive integer (6 spreads rays across the corridor with both edges included, 1 casts a single ray through the point and ignores spread)`,
      );
    }
    if (params.minHits > rayCount) {
      throw new Error(
        `pathCoverage: minHits is ${params.minHits} but rayCount is only ${rayCount}, so no point could ever be covered and every answer would be false. Lower minHits to at most ${rayCount} (${Math.max(1, Math.ceil(rayCount / 2))} is half the fan, the usual meaning of "cover spans the corridor"), or raise rayCount.`,
      );
    }
    // Checked before any work: a refusal must cost nothing, and neither
    // slot's shape depends on anything read below.
    const set = geo.attrs.point;
    if (wantCovered) {
      requireReportSlot({
        attrs: set,
        nodeType: "pathCoverage",
        param: "coveredAttr",
        name: params.coveredAttr,
        type: "bool",
        tupleSize: 1,
        domain: "point",
        suggestion: "covered",
      });
    }
    if (wantHits) {
      requireReportSlot({
        attrs: set,
        nodeType: "pathCoverage",
        param: "hitsAttr",
        name: params.hitsAttr,
        type: "u32",
        tupleSize: 1,
        domain: "point",
        suggestion: "coverHits",
      });
    }

    const n = geo.pointCount;
    const view = positionView(geo, "pathCoverage", "path");
    // Validated even when the cloud is empty: an author who wired the wrong
    // geometry to `boxes` must hear about it from the pin they wired, not
    // from a silent run of all-false.
    const boxView = positionView(boxes, "pathCoverage", "boxes");

    // The across direction, from the path's own frame or from its topology.
    // Resolved before the fan is built because an empty acrossAttr makes
    // polyline topology a REQUIREMENT, and that refusal should land before
    // any box is touched.
    let acrossData: ArrayLike<number>;
    let acrossStride: number;
    let fromTangent = false;
    if (params.acrossAttr !== "") {
      const attr = set.get(params.acrossAttr);
      if (!attr) {
        throw new Error(
          `pathCoverage: acrossAttr "${params.acrossAttr}" is not a point attribute of the path; available: ${set.names().join(", ") || "(none)"} — leave acrossAttr empty to derive the across direction from the path's polyline topology instead`,
        );
      }
      if (attr.type === "string" || attr.tupleSize !== 3) {
        throw new Error(
          `pathCoverage: acrossAttr "${params.acrossAttr}" is ${attr.type}${attr.tupleSize === 1 ? "" : `x${attr.tupleSize}`}, but the across direction is three numbers per point (a numeric attribute of tupleSize 3, e.g. a curve frame's binormal); pick a tuple-3 numeric attribute, or leave acrossAttr empty to derive it from the polyline topology`,
        );
      }
      acrossData = attr.data;
      acrossStride = 3;
    } else {
      acrossData = tangentsOf(geo);
      acrossStride = 3;
      fromTangent = true;
    }

    const dirCol = requireVec3Column(
      resolveOn(geo, "point", params.direction, nodeSeed, "pathCoverage", "direction"),
      "pathCoverage",
      "direction",
      "point",
      "the cast direction is a world vector",
    );
    const nearCol = requireScalarColumn(
      resolveOn(geo, "point", params.near, nodeSeed, "pathCoverage", "near"),
      "pathCoverage",
      "near",
      "point",
      "a ray start distance",
    );
    const farCol = requireScalarColumn(
      resolveOn(geo, "point", params.far, nodeSeed, "pathCoverage", "far"),
      "pathCoverage",
      "far",
      "point",
      "a ray end distance",
    );
    const spreadCol = requireScalarColumn(
      resolveOn(geo, "point", params.spread, nodeSeed, "pathCoverage", "spread"),
      "pathCoverage",
      "spread",
      "point",
      "a lateral half-span",
    );
    const sizeCol = requireVec3Column(
      resolveOn(boxes, "point", params.boxSize, nodeSeed, "pathCoverage", "boxSize"),
      "pathCoverage",
      "boxSize",
      "box",
      "a box extent is three numbers",
    );

    const covered = wantCovered ? new Uint8Array(n) : undefined;
    const hits = wantHits ? new Uint32Array(n) : undefined;
    const table = buildBoxTable(boxes, sizeCol);

    // THE RAY REACH: the farthest any point of any ray can be from the path
    // point that cast it. A ray point is `p + lateral * across + t * dir`
    // with `across` and `dir` orthonormal, so its distance from `p` is
    // hypot(lateral, t), maximised at the fan's edge and at whichever end
    // is farther out. The global maximum over the path is what sizes the
    // index; the per-point value is what the exact prefilter uses.
    let reach = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(
        spreadCol.data[i],
        Math.max(Math.abs(nearCol.data[i]), Math.abs(farCol.data[i])),
      );
      if (r > reach) reach = r;
    }
    const index = buildBoxIndex(table, reach);

    if (boxView.count > 0 && n > 0) {
      const pd = view.data;
      const ps = view.stride;
      // Every buffer the hot loop touches is allocated once, here: a fan of
      // endpoints, a per-ray hit flag, and two candidate lists. Nothing
      // inside the loop allocates.
      const rayFrom = new Float64Array(rayCount * 3);
      const rayTo = new Float64Array(rayCount * 3);
      const hitFlag = new Uint8Array(rayCount);
      const cand: number[] = [];
      const gridOut: number[] = [];
      const { centre, axes, half, radius } = table;
      for (let i = 0; i < n; i++) {
        if (i % CANCEL_STRIDE === 0) checkCancelled();
        const o = i * ps;
        const px = pd[o];
        const py = pd[o + 1];
        const pz = pd[o + 2];

        let dx = readComp(dirCol, i, 0);
        let dy = readComp(dirCol, i, 1);
        let dz = readComp(dirCol, i, 2);
        const dLen = Math.hypot(dx, dy, dz);
        if (!(dLen > 0)) {
          throw new Error(
            `pathCoverage: param "direction" is zero-length at path point ${i}; the cast direction is what decides which way the rays go, so there is no coverage answer without one — pass a nonzero vector such as vec(0, 1, 0), or, if it comes from an attribute, make sure every point of the path carries a direction`,
          );
        }
        dx /= dLen;
        dy /= dLen;
        dz /= dLen;

        // The across direction: from the tangent (crossed with the cast) or
        // from the attribute (projected perpendicular to the cast). Either
        // way it ends up unit and perpendicular to `dir`, which is what
        // makes the reach bound above exact.
        const ao = i * acrossStride;
        let ax: number;
        let ay: number;
        let az: number;
        if (fromTangent) {
          const tx = acrossData[ao];
          const ty = acrossData[ao + 1];
          const tz = acrossData[ao + 2];
          ax = ty * dz - tz * dy;
          ay = tz * dx - tx * dz;
          az = tx * dy - ty * dx;
        } else {
          const vx = acrossData[ao];
          const vy = acrossData[ao + 1];
          const vz = acrossData[ao + 2];
          const along = vx * dx + vy * dy + vz * dz;
          ax = vx - along * dx;
          ay = vy - along * dy;
          az = vz - along * dz;
        }
        let aLen = ax * ax + ay * ay + az * az;
        if (aLen <= ORIENT_PARALLEL_EPS) {
          // No usable across direction: no tangent, or one parallel to the
          // cast. The same two fallbacks orientQuat uses, in the same order,
          // so a degenerate frame is deterministic rather than whatever the
          // cross product happened to leave behind.
          ax = -dy;
          ay = dx;
          az = 0;
          aLen = ax * ax + ay * ay;
          if (aLen <= ORIENT_PARALLEL_EPS) {
            ax = 0;
            ay = -dz;
            az = dy;
            aLen = ay * ay + az * az;
          }
        }
        const aInv = 1 / Math.sqrt(aLen);
        ax *= aInv;
        ay *= aInv;
        az *= aInv;

        const near = nearCol.data[i];
        const far = farCol.data[i];
        const spread = spreadCol.data[i];
        for (let k = 0; k < rayCount; k++) {
          // Both edges included: rayCount rays over [-spread, +spread] any
          // other way would either miss the corridor's edges or double up
          // on its middle. A single ray sits on the centre line.
          const lat = rayCount === 1 ? 0 : -spread + (2 * spread * k) / (rayCount - 1);
          const bx = px + lat * ax;
          const by = py + lat * ay;
          const bz = pz + lat * az;
          rayFrom[k * 3] = bx + near * dx;
          rayFrom[k * 3 + 1] = by + near * dy;
          rayFrom[k * 3 + 2] = bz + near * dz;
          rayTo[k * 3] = bx + far * dx;
          rayTo[k * 3 + 1] = by + far * dy;
          rayTo[k * 3 + 2] = bz + far * dz;
        }

        // Candidates: the linear tier plus the grid block. The ORDER they
        // arrive in is deliberately not fixed — queryRadiusUnordered is the
        // query that says so in its name — because the result is a set of
        // per-ray booleans OR-ed together, so no order can change it. Only
        // how soon the early exit fires depends on the order, and that is
        // cost, not answer.
        cand.length = 0;
        for (let t = 0; t < index.large.length; t++) cand.push(index.large[t]);
        if (index.grid) {
          index.grid.queryRadiusUnordered(px, py, pz, index.queryRadius, gridOut);
          for (let t = 0; t < gridOut.length; t++) cand.push(index.binned[gridOut[t]]);
        }

        hitFlag.fill(0);
        let count = 0;
        const pointReach = Math.hypot(spread, Math.max(Math.abs(near), Math.abs(far)));
        for (let t = 0; t < cand.length && count < rayCount; t++) {
          const b = cand[t];
          const c = b * 3;
          const ex = centre[c] - px;
          const ey = centre[c + 1] - py;
          const ez = centre[c + 2] - pz;
          const limit = pointReach + radius[b];
          // The exact bound from the header, per box: a box farther than
          // reach + its own radius cannot meet any ray of this fan.
          if (ex * ex + ey * ey + ez * ez > limit * limit) continue;
          for (let k = 0; k < rayCount; k++) {
            // Counted per RAY, not per box: two boxes over the same ray are
            // one hit, which is what "cover spans the corridor" means.
            if (hitFlag[k]) continue;
            const r = k * 3;
            if (
              segmentHitsBox(
                b,
                centre,
                axes,
                half,
                rayFrom[r],
                rayFrom[r + 1],
                rayFrom[r + 2],
                rayTo[r],
                rayTo[r + 1],
                rayTo[r + 2],
              )
            ) {
              hitFlag[k] = 1;
              count++;
            }
          }
        }
        if (hits) hits[i] = count;
        if (covered) covered[i] = count >= params.minHits ? 1 : 0;
      }
    }

    // Written only after every read: a slot may legitimately name a column
    // the loop above was still reading, and replace() reuses storage.
    if (covered) {
      set.replace(params.coveredAttr, "bool", 1).data.set(covered.subarray(0, n));
    }
    if (hits) {
      const attr = set.replace(params.hitsAttr, "u32", 1, 0);
      const data = attr.data;
      for (let i = 0; i < n; i++) data[i] = hits[i];
    }
    return { out: [makeGeometryItem(geo)] };
  },
});
