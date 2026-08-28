/**
 * Point operation nodes: transform, jitter, instance-copy, merge, and
 * bounds stamping. All clone their inputs before mutating (the executor
 * caches inputs by reference).
 */
import {
  type AttrDefault,
  type Attribute,
  type AttributeSet,
  type Domain,
  Geometry,
  PRIMTYPE_ATTR,
  createPointCloud,
} from "../data/index.js";
import { pointIdentities } from "../data/identity.js";
import { type GeometryItem, cloneGeometry, makeGeometryItem } from "../graph/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import { standardNode } from "./registry.js";
import { isField, type Column } from "../fields/index.js";
import {
  ORIENT_AXES,
  type FieldParam,
  geometryItems,
  orientQuat,
  quatFromEulerDeg,
  quatMul,
  readComp,
  requireGeometry,
  requireTuple,
  resolveOn,
  resolveOnMaybeGpu,
  rotateVec,
} from "./util.js";

/** Params of {@link transformPoints}. */
export interface TransformPointsParams {
  translate: FieldParam;
  rotateEuler: FieldParam;
  scale: FieldParam;
}

/** Per-point SRT transform that composes with existing rot/scale attrs. */
export const transformPoints = standardNode<TransformPointsParams>({
  type: "transformPoints",
  category: "point op",
  description:
    "Transforms every point: P' = R * (scale * P) + translate, with R from rotateEuler (degrees, extrinsic XYZ order — world X applied first, then world Y, then world Z; equivalent to intrinsic ZYX, three.js Euler order 'ZYX'). Composes with existing point transform attributes when present: rot becomes R * rot (quaternion product) and scale multiplies componentwise. All three params are field-capable and resolve per point on the input positions.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    translate: {
      type: "vec3",
      default: [0, 0, 0],
      acceptsField: true,
      description: "Translation added after rotation and scale, in world units. Field-capable (tuple 1 broadcasts).",
    },
    rotateEuler: {
      type: "vec3",
      default: [0, 0, 0],
      acceptsField: true,
      description:
        "Rotation about the world origin in degrees per axis, applied extrinsically in XYZ order: world X first, then world Y, then world Z (equivalent to intrinsic ZYX; three.js Euler order 'ZYX'). Field-capable (tuple 1 broadcasts).",
    },
    scale: {
      type: "vec3",
      default: [1, 1, 1],
      acceptsField: true,
      description: "Componentwise scale about the world origin, applied before rotation. Field-capable (tuple 1 broadcasts).",
    },
  },
  // Field params may resolve on the GPU ("fields": the memo key gains
  // device provenance only when some param is a spec'd Field — plain
  // values keep their cache across the gpu toggle). All three params
  // resolve on the cloned input's point domain BEFORE any mutation, so
  // GPU (fresh) and CPU (possibly zero-copy view) columns read the same
  // pre-transform bytes.
  gpu: "fields",
  // Fusable into device-resident runs (count-preserving, single
  // geometry in/out); the resolver's planner ports the SRT loop —
  // including the conditional rot/scale composition — as an apply
  // kernel and falls back per-node for layouts it does not model.
  resident: { kind: "transformPoints" },
  async execute({ inputs, params, seed, gpu }) {
    const geo = cloneGeometry(requireGeometry(inputs, "in", "transformPoints"));
    const n = geo.pointCount;
    const tCol = requireTuple(await resolveOnMaybeGpu(gpu, geo, "point", params.translate, seed, "transformPoints", "translate"), [1, 3], "transformPoints", "translate");
    const rCol = requireTuple(await resolveOnMaybeGpu(gpu, geo, "point", params.rotateEuler, seed, "transformPoints", "rotateEuler"), [1, 3], "transformPoints", "rotateEuler");
    const sCol = requireTuple(await resolveOnMaybeGpu(gpu, geo, "point", params.scale, seed, "transformPoints", "scale"), [1, 3], "transformPoints", "scale");
    const P = geo.attrs.point.require("P");
    const pd = P.data;
    const ps = P.tupleSize;
    const rotAttr = geo.attrs.point.get("rot");
    const rot = rotAttr && rotAttr.type === "f32" && rotAttr.tupleSize === 4 ? rotAttr.data : undefined;
    const scaleAttr = geo.attrs.point.get("scale");
    const scl = scaleAttr && scaleAttr.type === "f32" && scaleAttr.tupleSize === 3 ? scaleAttr.data : undefined;
    const q: number[] = [0, 0, 0, 1];
    const v: number[] = [0, 0, 0];
    const q2: number[] = [0, 0, 0, 1];
    for (let i = 0; i < n; i++) {
      const sx = readComp(sCol, i, 0);
      const sy = readComp(sCol, i, 1);
      const sz = readComp(sCol, i, 2);
      quatFromEulerDeg(q, readComp(rCol, i, 0), readComp(rCol, i, 1), readComp(rCol, i, 2));
      rotateVec(v, q[0], q[1], q[2], q[3], pd[i * ps] * sx, pd[i * ps + 1] * sy, pd[i * ps + 2] * sz);
      pd[i * ps] = v[0] + readComp(tCol, i, 0);
      pd[i * ps + 1] = v[1] + readComp(tCol, i, 1);
      pd[i * ps + 2] = v[2] + readComp(tCol, i, 2);
      if (rot) {
        quatMul(q2, q[0], q[1], q[2], q[3], rot[i * 4], rot[i * 4 + 1], rot[i * 4 + 2], rot[i * 4 + 3]);
        rot[i * 4] = q2[0];
        rot[i * 4 + 1] = q2[1];
        rot[i * 4 + 2] = q2[2];
        rot[i * 4 + 3] = q2[3];
      }
      if (scl) {
        scl[i * 3] *= sx;
        scl[i * 3 + 1] *= sy;
        scl[i * 3 + 2] *= sz;
      }
    }
    return { out: [makeGeometryItem(geo)] };
  },
});

/** Params of {@link jitterPoints}. */
export interface JitterPointsParams {
  amount: FieldParam;
  seed: number;
}

/** Deterministic random offset per point. */
export const jitterPoints = standardNode<JitterPointsParams>({
  type: "jitterPoints",
  category: "point op",
  description:
    "Offsets each point by a deterministic random vector: each axis moves by a uniform random in [-amount, +amount], hashed from (seed, point IDENTITY, axis). Identity is the point's incoming position bits together with its `seed` point attribute, not its array index, so the offset belongs to the point: reorder the cloud, drop points upstream, or derive the same region inside another cell's halo, and every point still moves exactly as far. Two points that share a position AND a seed move identically and stay coincident (the `seed` attribute defaults to 0, so a cloud with no per-point seeds jitters on position alone). amount is field-capable (evaluated on the input positions; tuple 1 broadcasts to all axes).",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    amount: {
      type: "vec3",
      default: [0.1, 0.1, 0.1],
      acceptsField: true,
      description: "Maximum offset per axis, in world units. Field-capable (tuple 1 broadcasts).",
    },
    seed: {
      type: "u32",
      default: 0,
      description: "Extra seed folded into the node seed; change it to re-roll the jitter.",
    },
  },
  // `amount` may resolve on the GPU; it is evaluated on the cloned
  // input's positions with the jitter-derived seed BEFORE any point
  // moves — exactly the CPU path's context.
  gpu: "fields",
  // Fusable into device-resident runs; the apply kernel reproduces the
  // hashFloat(hashCombine(seed, identity, k)) offset chain bit-for-bit
  // (the hash is exact in f32, and the identity is a u32 hash of the
  // incoming position bits and the seed attribute), with the final
  // multiply-add in f32.
  resident: { kind: "jitterPoints" },
  async execute({ inputs, params, seed: nodeSeed, gpu }) {
    const geo = cloneGeometry(requireGeometry(inputs, "in", "jitterPoints"));
    const seed = hashCombine(nodeSeed, params.seed);
    const amount = requireTuple(await resolveOnMaybeGpu(gpu, geo, "point", params.amount, seed, "jitterPoints", "amount"), [1, 3], "jitterPoints", "amount");
    const P = geo.attrs.point.require("P");
    const pd = P.data;
    const ps = P.tupleSize;
    const n = geo.pointCount;
    // Identities come from the INCOMING positions, before anything moves —
    // the same context `amount` was resolved in. Keying on `i` instead
    // would tie the offset to the slot rather than to the point, so a
    // reordered cloud would land somewhere else entirely.
    const ident = pointIdentities(geo, "jitterPoints");
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        pd[i * ps + k] +=
          (hashFloat(hashCombine(seed, ident[i], k)) * 2 - 1) * readComp(amount, i, k);
      }
    }
    return { out: [makeGeometryItem(geo)] };
  },
});

/** Standard transform attrs ensured on copyToPoints output. */
const COPY_STANDARD: ReadonlyArray<{
  name: string;
  type: "f32" | "u32";
  tupleSize: number;
  defaultValue: number | readonly number[];
}> = [
  { name: "P", type: "f32", tupleSize: 3, defaultValue: [0, 0, 0] },
  { name: "rot", type: "f32", tupleSize: 4, defaultValue: [0, 0, 0, 1] },
  { name: "scale", type: "f32", tupleSize: 3, defaultValue: [1, 1, 1] },
  { name: "seed", type: "u32", tupleSize: 1, defaultValue: 0 },
];

/** Params of {@link copyToPoints}. */
export interface CopyToPointsParams {
  targetNames: readonly string[];
  targetIndexAttr: string;
  sourceGroupAttr: string;
  targetGroupAttr: string;
  topology: string;
}

/**
 * Returns whether the source's topology is KEPT.
 *
 * The twin of `requireTopologyRule` in `filtering.ts`, and deliberately a
 * second function rather than a shared one, though the reason narrowed
 * when per-target selection arrived. That guard's message states a
 * SURVIVAL rule ("keep preserves the primitives all of whose points
 * survive"), and this node used to have no use for it at all — nothing
 * was filtered and every source primitive was re-emitted once per target.
 * Under selection it applies the SAME rule to a different question: a
 * point survives into a target's block when that target's key asked for
 * it. So the survival rule is now shared vocabulary alongside the param
 * name, the two values and the default — and the two messages still have
 * to differ, because "the predicate kept it" and "this target asked for
 * it" are not the same sentence and error messages are part of the agent
 * API.
 *
 * Checked at runtime for the reason {@link requireCopyTopologyRule}'s twin
 * gives: a param's `enum` is metadata for an editor, not a runtime guard,
 * and a value that reached execute unrecognized must not silently mean
 * "drop".
 */
function requireCopyTopologyRule(value: string): boolean {
  if (value !== "drop" && value !== "keep") {
    throw new Error(
      `copyToPoints: topology must be "drop" or "keep", got ${JSON.stringify(value)}; ` +
        '"drop" copies the source\'s POINTS only and its vertices and primitives are gone, ' +
        '"keep" re-emits the source\'s primitives onto each target\'s block of copies — every ' +
        'primitive once per target by default, and under "sourceGroupAttr"/"targetGroupAttr" only ' +
        "the primitives all of whose points that target asked for",
    );
  }
  return value === "keep";
}

/**
 * The vertex/primitive domains a geometry carries must be sized BY its
 * topology, which `setTopology` (and `setPolylineTopology`) is the only
 * thing that does. A geometry that resized one of those attribute sets
 * directly would land its vertex values on another block's vertices in
 * the assemblers below — silently, and with a plausible-looking cook.
 *
 * `where` names the input in the author's words: a pin for
 * {@link copyToPoints}, a numbered multi-pin slot for
 * {@link mergePrimitives}.
 */
function requireTopologySized(geo: Geometry, who: string, where: string): void {
  if (geo.attrs.vertex.count !== geo.vertexToPoint.length) {
    throw new Error(
      `${who}: ${where} has ${geo.attrs.vertex.count} vertex attribute ` +
        `elements but ${geo.vertexToPoint.length} vertex references; build topology with setTopology ` +
        "(or setPolylineTopology), which sizes the vertex attributes to match, rather than resizing " +
        "the vertex attribute set on its own.",
    );
  }
  if (geo.attrs.primitive.count !== geo.primVertexStart.length) {
    throw new Error(
      `${who}: ${where} has ${geo.attrs.primitive.count} primitive attribute ` +
        `elements but ${geo.primVertexStart.length} vertex ranges; build topology with setTopology ` +
        "(or setPolylineTopology), which sizes the primitive attributes to match, rather than resizing " +
        "the primitive attribute set on its own.",
    );
  }
}

/**
 * Append ONE BLOCK's topology into output arrays at the given bases:
 * every vertex reference shifted onto that block's points, every
 * primitive's vertex range shifted onto that block's vertices, counts
 * verbatim. The block's vertex layout arrives as it was — nothing is
 * compacted HERE, which is what separates this from `gatherPrimitives`
 * (util.ts) and is spelled out at {@link mergePrimitives}'s call.
 *
 * Shared by the file's two block-wise assemblers, which build the same
 * arrays from different block SOURCES: {@link mergePrimitives} walks a
 * list of inputs, {@link copyToPoints} under `topology "keep"` walks one
 * {@link KeepPlan} per target — the same input's whole topology when
 * nothing is selected, and the subset that target asked for when
 * something is. A copy array is a union with all the terms equal, so the
 * index arithmetic must be one function or the two will drift on what
 * "renumber" means.
 *
 * Takes the three ARRAYS rather than a `Geometry` because
 * {@link copyToPoints} under per-target selection has no geometry to hand
 * it: the block is a subset of the source's primitives, renumbered onto a
 * subset of its points, and only {@link buildKeepPlan} has ever held it.
 * Handed a geometry's own three arrays this is the function it always was.
 */
function appendTopologyBlock(
  srcV2P: Uint32Array,
  srcStart: Uint32Array,
  srcCount: Uint32Array,
  vertexToPoint: Uint32Array,
  primVertexStart: Uint32Array,
  primVertexCount: Uint32Array,
  pointBase: number,
  vertexBase: number,
  primBase: number,
): void {
  for (let v = 0; v < srcV2P.length; v++) vertexToPoint[vertexBase + v] = srcV2P[v] + pointBase;
  for (let p = 0; p < srcStart.length; p++) {
    primVertexStart[primBase + p] = srcStart[p] + vertexBase;
    primVertexCount[primBase + p] = srcCount[p];
  }
}

/**
 * Copy `indices.length` elements of `src` into `dst`, element k landing at
 * slot k, coalescing CONSECUTIVE source indices into one ranged
 * `copyFrom`.
 *
 * The gather every domain of {@link copyToPoints} goes through, and the
 * reason its default path is byte-identical to the ranged copies it
 * replaced rather than merely equivalent to them: with no selection the
 * gather is the source's own order repeated once per target, so the run
 * detection emits exactly one `copyFrom(src, 0, t * per, per)` per block —
 * the same calls, in the same order, with the same arguments. Selection
 * only ever SPLITS those runs.
 *
 * WHAT ONE CODE PATH COSTS THE BROADCAST, MEASURED, because the scan is
 * pure overhead when nothing is selected and a cost nobody prints is a
 * cost nobody notices. On 778,800 copies (2,200 sources x 354 targets),
 * one f32x3 column, median of twelve rounds: 0.41ms for the ranged copies
 * alone against 0.87ms through the gather, plus 0.64ms once for the index
 * array the gather reads. That is roughly half a nanosecond per copy per
 * COLUMN — the scan is over the copy count and does not care about tuple
 * size — so a cloud carrying the four standard columns pays about 3ms
 * inside a 73ms cook, four percent, to keep selection and broadcast one
 * function. A `selecting` fast path would erase it and would be a second
 * spelling of the assembly this node's byte-identity argument rests on.
 *
 * `copyFrom` and not a raw `data.set` because a string column's values are
 * indices into ITS OWN table: `copyFrom` re-interns, so the output says the
 * words the source did rather than whatever those indices happen to name
 * here.
 */
function gatherInto(dst: Attribute, src: Attribute, indices: Uint32Array): void {
  const n = indices.length;
  let i = 0;
  while (i < n) {
    const start = indices[i];
    // The expected next index is CARRIED rather than re-read as
    // `indices[j - 1] + 1`: the scan runs once per copy per column on the
    // broadcast path, where it is pure overhead against the ranged copies
    // it replaced, and one bounds-checked load per step instead of two is
    // most of what that overhead was.
    let next = start + 1;
    let j = i + 1;
    while (j < n && indices[j] === next) {
      j++;
      next++;
    }
    dst.copyFrom(src, start, i, j - i);
    i = j;
  }
}

/**
 * One distinct group key's share of the source: which source points every
 * target naming that key receives, ascending.
 *
 * Ascending SOURCE INDEX, never key order or first-seen order, because the
 * node's published layout is "the copies of a target, in source order" and
 * selection removes copies from that order rather than reordering what is
 * left.
 */
interface SourceGroup {
  readonly indices: Uint32Array;
}

/**
 * Which source points land on each target.
 *
 * ONE SHAPE FOR BOTH MODES, so the assemblers below have no second
 * spelling to drift from. With selection off there is exactly one group
 * holding every source point and every target names it, which is the
 * broadcast written as a selection — same blocks, same order, same
 * arithmetic (`starts[t]` is `t * nSource` term for term). With selection
 * on there is one group per distinct source key, and `groupOf[t]` is -1
 * for a target whose key no source point carries.
 */
interface CopySelection {
  readonly groups: readonly SourceGroup[];
  /** Group index per target, or -1 for a target that matched none. */
  readonly groupOf: Int32Array;
  /**
   * Whether the pair of params was set — NOT whether the blocks happen to
   * be whole. `topology "keep"` reads this rather than comparing a block's
   * length to the source's, because a selection in which every key matches
   * every point would otherwise take the unselected vertex layout: what
   * the output IS has to depend on the graph and never on the data.
   */
  readonly selecting: boolean;
}

/** The empty block a target that matched no source group receives. */
const NO_SOURCE_GROUP: SourceGroup = { indices: new Uint32Array(0) };

/**
 * Resolve a param naming the point attribute holding a SELECTION KEY.
 *
 * The same scalar-or-string rule `pointsToPath`'s `groupAttr` applies, and
 * deliberately a second function rather than that file's private one: its
 * message ends "leave the param empty to skip it", and here leaving ONE of
 * the pair empty is refused — the fix has to name both params or it sends
 * the author into the error below.
 */
function requireSelectionKeyAttr(
  geo: Geometry,
  name: string,
  param: string,
  side: string,
): Attribute {
  const set = geo.attrs.point;
  const attr = set.get(name);
  if (!attr) {
    throw new Error(
      `copyToPoints: param "${param}" names point attribute "${name}", which the ${side} has no point ` +
        `attribute for; available on the ${side}: ${set.names().join(", ") || "(none)"}. Write the key ` +
        `upstream with setAttribute, or clear BOTH "sourceGroupAttr" and "targetGroupAttr" to stamp the ` +
        "whole source on every target.",
    );
  }
  if (attr.tupleSize !== 1) {
    throw new Error(
      `copyToPoints: param "${param}" names ${side} attribute "${name}" with tupleSize ${attr.tupleSize}; ` +
        "a selection key must be scalar (tupleSize 1) — take one component into a scalar column with " +
        "setAttribute and name that instead.",
    );
  }
  return attr;
}

/**
 * Read one element of a key column as a comparable key.
 *
 * WHOLE NUMBERS OR STRINGS, the rule `pointsToPath`'s `groupAttr` sets and
 * for its reason, quoted rather than paraphrased: a key is an IDENTITY, two
 * values a ULP apart would be two groups, and CPU/GPU parity is a tolerance
 * rather than an equality. A fractional key is refused on either side.
 */
function readSelectionKey(
  attr: Attribute,
  index: number,
  param: string,
  side: string,
): number | string {
  if (attr.type === "string") return attr.getString(index);
  const value = attr.data[index];
  if (!Number.isInteger(value)) {
    throw new Error(
      `copyToPoints: ${side} point ${index} has ${attr.name} = ${value}, which is not a whole number; a ` +
        "selection key is an IDENTITY, and a fractional one cannot be trusted to be equal to itself — two " +
        "values a single ULP apart are two groups, and the GPU is only promised to agree with the CPU " +
        `within a tolerance. Write a whole-number id with setAttribute (type 'i32', which truncates), or ` +
        `name the group with a string attribute, which "${param}" also accepts`,
    );
  }
  return value;
}

/**
 * Settle which source points each target takes — the whole of the
 * `sourceGroupAttr` / `targetGroupAttr` pair.
 *
 * Both empty is the broadcast, expressed as the one group every target
 * names. Exactly one set is refused: half a selection has no meaning, and
 * the two readings a lenient node could pick (ignore it, or match against
 * nothing) differ by the entire output.
 */
function buildCopySelection(
  src: Geometry,
  tgt: Geometry,
  params: CopyToPointsParams,
): CopySelection {
  const sName = params.sourceGroupAttr;
  const tName = params.targetGroupAttr;
  const nS = src.attrs.point.count;
  const nT = tgt.attrs.point.count;
  if (sName === "" && tName === "") {
    const all = new Uint32Array(nS);
    for (let s = 0; s < nS; s++) all[s] = s;
    return { groups: [{ indices: all }], groupOf: new Int32Array(nT), selecting: false };
  }
  if (sName === "" || tName === "") {
    const [set, unset] =
      sName === ""
        ? ["targetGroupAttr", "sourceGroupAttr"]
        : ["sourceGroupAttr", "targetGroupAttr"];
    throw new Error(
      `copyToPoints: params "sourceGroupAttr" and "targetGroupAttr" work only as a PAIR — "${set}" is ` +
        `set and "${unset}" is empty. Per-target source selection needs both: "sourceGroupAttr" is the ` +
        "key each SOURCE point carries and \"targetGroupAttr\" is the key each TARGET point asks for, and " +
        `a target takes the source points whose keys match. Name a scalar point attribute for "${unset}" ` +
        "too, or clear both to stamp the whole source on every target.",
    );
  }

  const sAttr = requireSelectionKeyAttr(src, sName, "sourceGroupAttr", 'source on pin "source"');
  const tAttr = requireSelectionKeyAttr(tgt, tName, "targetGroupAttr", 'target on pin "target"');
  // A string column and a numeric one can never produce a match, so every
  // target would come out empty and the cook would finish, cleanly, with
  // no points. That is an authoring mistake and not data: refuse it here
  // rather than let an empty output stand in for it.
  if ((sAttr.type === "string") !== (tAttr.type === "string")) {
    const stringSide = sAttr.type === "string" ? "sourceGroupAttr" : "targetGroupAttr";
    const numberSide = sAttr.type === "string" ? "targetGroupAttr" : "sourceGroupAttr";
    throw new Error(
      `copyToPoints: param "${stringSide}" names a string attribute and "${numberSide}" names a numeric ` +
        `one (${(sAttr.type === "string" ? tAttr : sAttr).type}); a string key can never equal a number, ` +
        "so every target would take nothing. Name columns of the same kind on both sides — two string " +
        "names, or two whole-number ids.",
    );
  }

  // Source keys first, in ASCENDING SOURCE INDEX, so each group's block is
  // the source's own order with the non-members removed.
  const byKey = new Map<number | string, number[]>();
  for (let s = 0; s < nS; s++) {
    const key = readSelectionKey(sAttr, s, "sourceGroupAttr", "source");
    let bucket = byKey.get(key);
    if (!bucket) byKey.set(key, (bucket = []));
    bucket.push(s);
  }
  const keyToGroup = new Map<number | string, number>();
  const groups: SourceGroup[] = [];
  for (const [key, bucket] of byKey) {
    keyToGroup.set(key, groups.length);
    groups.push({ indices: Uint32Array.from(bucket) });
  }

  const groupOf = new Int32Array(nT);
  for (let t = 0; t < nT; t++) {
    const key = readSelectionKey(tAttr, t, "targetGroupAttr", "target");
    const group = keyToGroup.get(key);
    // A TARGET THAT MATCHES NOTHING IS A LEGAL EMPTY BLOCK, not an error,
    // and for the reason `pointsToPath`'s `shortGroups "skip"` gives for
    // the same shape of question: a selection key is normally DATA — an
    // asset id resolved from a catalogue, a species drawn from a noise, a
    // pose chosen per placement — so which keys a given cell's targets ask
    // for is not knowable at graph-build time, and a cell that happens to
    // ask for a pose this source cloud does not carry must not fail the
    // whole cook. Nothing else moves: the targets that DO match take the
    // same copies, in the same order, that they would have taken had the
    // unmatched target never been in the input.
    groupOf[t] = group === undefined ? -1 : group;
  }
  return { groups, groupOf, selecting: true };
}

/**
 * One block's re-emitted topology under `topology "keep"`, block-local:
 * which source primitives survive, which source vertices they own, and
 * where those vertices land among the block's own points.
 *
 * `primSrc` and `vertexSrc` exist so the vertex and primitive ATTRIBUTES
 * can be gathered by the same {@link gatherInto} the point domain uses —
 * a re-emitted primitive carries the original's values whether or not its
 * neighbours were re-emitted.
 */
interface KeepPlan {
  readonly primSrc: Uint32Array;
  readonly vertexSrc: Uint32Array;
  readonly vertexToPoint: Uint32Array;
  readonly primVertexStart: Uint32Array;
  readonly primVertexCount: Uint32Array;
}

/**
 * The plan for a block holding EVERY source point: the source's topology
 * verbatim, which is what `topology "keep"` has always emitted.
 *
 * Verbatim down to the vertex LAYOUT — same vertex count, same order,
 * gaps and out-of-order primitive ranges included — because that is the
 * observable the shipped node has: {@link appendTopologyBlock} shifts and
 * copies, it never compacts. {@link buildKeepPlan} cannot promise the same
 * and says why.
 */
function wholeSourceKeepPlan(src: Geometry): KeepPlan {
  const nV = src.vertexToPoint.length;
  const nPrim = src.primVertexStart.length;
  const primSrc = new Uint32Array(nPrim);
  for (let p = 0; p < nPrim; p++) primSrc[p] = p;
  const vertexSrc = new Uint32Array(nV);
  for (let v = 0; v < nV; v++) vertexSrc[v] = v;
  return {
    primSrc,
    vertexSrc,
    vertexToPoint: src.vertexToPoint,
    primVertexStart: src.primVertexStart,
    primVertexCount: src.primVertexCount,
  };
}

/**
 * The plan for a SELECTED block: the source primitives ALL of whose points
 * the block holds, in ascending source order, renumbered onto the block.
 *
 * THE SURVIVAL RULE IS THE POINT FILTERS', quoted rather than invented:
 * "keep preserves the primitives all of whose points survive"
 * (`filtering.ts`), which `gatherPrimitives`' explicit point rule states
 * again as a precondition. A selection is a point filter applied per
 * target, so a primitive straddling two keys belongs to neither block and
 * is re-emitted for neither — the alternative is a primitive with a vertex
 * pointing at a point that is not in this block, which `setTopology`'s
 * bounds check would happily accept as some OTHER target's point.
 *
 * THE VERTEX LAYOUT IS COMPACTED HERE, and it has to be: the block holds a
 * subset of the source's points, so a vertex referencing a point the block
 * dropped has nothing to renumber onto and cannot be carried. What comes
 * out is the surviving primitives' own vertices, in primitive order — the
 * same thing `gatherPrimitives` produces. On a source whose primitive
 * ranges already tile its vertex array in order (everything `setTopology`
 * and `setPolylineTopology` build) that is the identity, so this differs
 * from the unselected block only for a source carrying vertices no
 * primitive references, or ranges out of order.
 */
function buildKeepPlan(src: Geometry, indices: Uint32Array, nS: number): KeepPlan {
  const srcV2P = src.vertexToPoint;
  const srcStart = src.primVertexStart;
  const srcCount = src.primVertexCount;
  const nPrim = srcStart.length;
  // Where each source point sits in this block, or -1 for one it dropped.
  const local = new Int32Array(nS).fill(-1);
  for (let k = 0; k < indices.length; k++) local[indices[k]] = k;

  const primSrc: number[] = [];
  let nv = 0;
  for (let p = 0; p < nPrim; p++) {
    const start = srcStart[p];
    const end = start + srcCount[p];
    let survives = true;
    for (let v = start; v < end; v++) {
      const point = srcV2P[v];
      // A vertex referencing a point the SOURCE does not have. Only a
      // geometry whose point domain shrank after `setTopology` can carry
      // one, and `requireTopologySized` cannot see it: that guard compares
      // the vertex and primitive attribute counts to the topology, not the
      // topology to the points. Refused rather than read, because
      // `local[out of range]` is `undefined`, `undefined < 0` is false,
      // and the primitive would go on to be re-emitted with a vertex
      // pointing at whatever slot 0 of the block happens to be.
      if (point >= nS) {
        throw new Error(
          `copyToPoints: the source on pin "source" has vertex ${v} referencing point ${point}, but ` +
            `the source has only ${nS} point${nS === 1 ? "" : "s"}; rebuild its topology with ` +
            "setTopology (or setPolylineTopology) after whatever changed the point count, rather than " +
            "leaving vertex references pointing past the cloud.",
        );
      }
      if (local[point] < 0) {
        survives = false;
        break;
      }
    }
    if (survives) {
      primSrc.push(p);
      nv += srcCount[p];
    }
  }

  const prims = Uint32Array.from(primSrc);
  const vertexSrc = new Uint32Array(nv);
  const vertexToPoint = new Uint32Array(nv);
  const primVertexStart = new Uint32Array(prims.length);
  const primVertexCount = new Uint32Array(prims.length);
  let w = 0;
  for (let k = 0; k < prims.length; k++) {
    const p = prims[k];
    primVertexStart[k] = w;
    primVertexCount[k] = srcCount[p];
    const start = srcStart[p];
    for (let v = start; v < start + srcCount[p]; v++) {
      vertexSrc[w] = v;
      vertexToPoint[w] = local[srcV2P[v]];
      w++;
    }
  }
  return { primSrc: prims, vertexSrc, vertexToPoint, primVertexStart, primVertexCount };
}

/** Copy a source cloud onto every target point, composing transforms. */
export const copyToPoints = standardNode<CopyToPointsParams>({
  type: "copyToPoints",
  category: "point op",
  description:
    "Copies the source point cloud onto every target point (output count = source points * target points, grouped by target). Set `sourceGroupAttr` and `targetGroupAttr` and each target instead takes only the source points whose group key it asks for, which is the same node stamping a DIFFERENT subset per target rather than the whole cloud. Transforms compose per copy: P = targetP + targetRot * (targetScale * sourceP), rot = targetRot * sourceRot (quaternion product), scale = targetScale * sourceScale (componentwise), and each copied seed is hashCombine(sourceSeed, targetSeed). All other source point attributes are carried through unchanged; missing transform attributes are treated as identity. `targetNames` additionally carries named TARGET point attributes onto the copies: every copy in a target's block receives that target's value, in a column keeping the target's type, tuple size and default. That is what lets copies vary by what the author computed on the target cloud — a species tag, an age, a noise sampled per target — since the copies are otherwise identical in everything but placement. The composed transform attributes cannot be carried, a name the source already carries is refused rather than silently overwritten, a name repeated in the list is refused, and a name absent from the target is an error. `targetIndexAttr` writes the target's INDEX rather than one of its attributes, which is what makes \"one thing per target\" — one path per anchor, one group per instance — expressible without an upstream setAttribute whose only job was to give this node something to carry. `sourceGroupAttr` and `targetGroupAttr` are PER-TARGET SOURCE SELECTION, the pair that turns \"every target takes every source point\" into \"every target takes the source points it names\": without them a vocabulary in which each target wants a different subset has to stamp the whole cloud and filter the wrong copies away, which is quadratic in a library nobody uses all of. The source's TOPOLOGY is dropped by default — an array of a path comes out a bare cloud — and `topology \"keep\"` re-emits every source primitive once per target instead, which is what makes the array of paths a set of paths without rebuilding them downstream.",
  inputs: [
    { name: "source", kind: "geometry" },
    { name: "target", kind: "geometry" },
  ],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    targetNames: {
      type: "stringList",
      default: [],
      description:
        'Target point attributes to carry onto the copies, in any order. Each copy in a target\'s block gets that target\'s value, and the column arrives with the target\'s type, tuple size and default. An empty list carries nothing, which is the default and not an error. Three kinds of name are refused rather than resolved silently: "P", "rot", "scale" and "seed", because they are composed per copy and already hold the target\'s contribution (copy one to another name on the target with setAttribute and carry that to get the raw value); a name repeated in the list; and a name the source also carries, because the two would write the same column. A name absent from the target is an error listing what the target does carry.',
    },
    targetIndexAttr: {
      type: "string",
      default: "",
      description:
        'Name of an i32 point attribute to write the TARGET INDEX into — 0 for every copy that landed on the first target point, 1 for the second, and so on. Empty (the default) writes nothing. This is the key downstream nodes group by: pointsToPath\'s `groupAttr` turns "the copies of one target" into one path per target, and partitionByAttribute turns them into one item each. The node already computes this index to place the copies, so naming it here replaces the setAttribute writing `{"fn":"index"}` on the target purely so `targetNames` had something to carry. The column is i32, tuple size 1, default -1 (which no copy ever gets, so an element appended later reads as belonging to no target). That stays true under `sourceGroupAttr`/`targetGroupAttr` selection, and it is worth saying why, because selection is exactly what could have broken it: a target that matches no source group contributes ZERO copies rather than a copy carrying some placeholder, so its index is simply a value this column never holds — -1 still means "no target" and not "the target that took nothing". What selection does change is that a target index can be MISSING from the output entirely, so a downstream grouping on this column sees fewer groups than the target cloud has points (pointsToPath\'s `shortGroups "skip"` is the setting that expects exactly that). Refused for the same three reasons `targetNames` refuses a name: "P", "rot", "scale" and "seed" are composed per copy, a name the source already carries would have two writers, and so would a name `targetNames` is carrying.',
    },
    sourceGroupAttr: {
      type: "string",
      default: "",
      description:
        'Name of a scalar SOURCE point attribute holding each source point\'s group key — the half of per-target source selection that says what each source point IS. Set it together with `targetGroupAttr` (the key each target ASKS FOR) and a target receives only the source points whose key equals its own; leave BOTH empty, the default, and every target receives every source point exactly as before. Setting one without the other is refused rather than half-applied, because the two lenient readings — ignore it, or match everything against nothing — differ by the entire output. A NUMERIC key must be a whole number, the rule `pointsToPath`\'s `groupAttr` sets and for its reason: a key is an IDENTITY, two values a ULP apart would be two groups, and CPU/GPU parity is a tolerance rather than an equality — so write ids with setAttribute type \'i32\' (which truncates), and a fractional value is an error naming the point. A STRING key names the group instead, which is the usual thing a group is (an asset id, a pose name, a species), and it compares BY VALUE and never by string-table index, so the same word selects the same points in every geometry and every cell. Both sides must be the same kind: a string column against a numeric one can never match and is refused rather than cooking to nothing. This column is an ordinary source attribute and rides onto the copies like any other; the key does not disappear because it was used.',
    },
    targetGroupAttr: {
      type: "string",
      default: "",
      description:
        'Name of a scalar TARGET point attribute naming which source group that target takes — the half of per-target source selection that does the asking. Used only together with `sourceGroupAttr`, under the key rules stated there. What it buys is the case this node could not express: when each target wants a DIFFERENT subset of the source, the alternative is to stamp the whole source on every target and filter the wrong copies away, which costs sourcePoints * targetPoints intermediate points to keep a few thousand — the measured racetrack case stamped 776,000 copies to keep 1,900. With this set the node emits only the copies that survive, so the stage becomes linear in the answer. Everything else is unchanged: the copies still come out in contiguous per-target blocks, in ascending SOURCE INDEX within a block, and `targetNames`, `targetIndexAttr` and the composed transforms all behave as they do without selection — selection REMOVES copies from that layout, it never reorders what is left, and it never perturbs the seed of a copy that would have existed anyway (a copy\'s seed is hashCombine(sourceSeed, targetSeed), which names the pair and not the slot). A target whose key matches NO source group takes zero copies and that is legal, not an error, for the reason `pointsToPath`\'s `shortGroups "skip"` gives: a selection key is normally DATA — resolved from a catalogue, drawn from a noise, chosen per placement — so which keys a cell\'s targets ask for is unknowable at graph-build time, and a cell asking for a pose this source does not carry must not fail the whole cook. If a missing key IS an authoring error in your graph, catch it upstream where the population is known rather than here where it is data.',
    },
    topology: {
      type: "enum",
      default: "drop",
      enum: ["drop", "keep"],
      description:
        "What happens to the SOURCE's topology — the vertices and primitives built over the source's points. 'drop' (the default) copies POINTS only: an array of a path comes out a bare cloud with the paths gone, which is why the copies have to be rebuilt downstream (targetIndexAttr, then a pointsToPath grouping on it). 'keep' re-emits source primitives onto the target blocks instead, which is the whole difference between an array of points and an array of paths. WITHOUT SELECTION (`sourceGroupAttr` and `targetGroupAttr` both empty) that is every source primitive once per TARGET, and the arithmetic is closed: the copies are laid out in contiguous blocks of nSource (copy s of target t is point t * nSource + s), so primitive p of block t walks exactly the points its original walked, t * nSource further on, and a source with N primitives always yields nTarget * N, in target-block order, nothing filtered and no primitive reshaped. That is what mergePrimitives produces from nTarget copies of the source. WITH SELECTION both of those identities are gone, and they have to be: a target holds only the source points its key asked for, so there is no fixed block stride, and a vertex referencing a point the block did not take has no point to renumber onto — it cannot be carried, and carrying it anyway would produce an index setTopology's bounds check accepts as some OTHER target's point. What replaces them is the POINT FILTERS' survival rule, quoted rather than invented: a primitive is re-emitted for a target only when ALL of its points are in that target's block. So a source primitive whose points carry two different keys belongs to no block and is re-emitted for none of them (put the key on whole primitives, not across them), and the primitive count is the sum over targets of what each target's key kept — not a product of anything. What does NOT change is the order: within a block the surviving primitives keep ascending source order and each keeps its own vertices in their own order, and the blocks still follow target order. One further difference is visible only on a source whose vertex array does not tile: an unselected block copies that array verbatim, gaps and out-of-order primitive ranges included, while a selected block is compacted to the surviving primitives' own vertices in primitive order — what gatherPrimitives produces. Everything setTopology and setPolylineTopology build already tiles in order, so for those the two are the same array. The source's VERTEX and PRIMITIVE attributes come along, each copy carrying the original's values (a per-primitive width, a per-vertex uv, and `primtype`, so the copies stay samplable as what they are). The TARGET's own topology is never read under either setting — the target contributes point transforms and, through targetNames/targetIndexAttr, point attributes, while its primitives describe points that are not in this output at all. The POINT domain is IDENTICAL under both settings — same points, same order, same attributes, same identities — so this param only ever ADDS information, and neither targetNames nor targetIndexAttr (which write point columns) can be disturbed by it, with or without selection. The DETAIL domain is carried under NEITHER setting, for the reason mergePrimitives gives for dropping it: there are two inputs, each has a detail domain, and choosing between them would be a guess. On IDENTITY, because it decides what per-copy randomness does: a primitive is named by the fold of its own points' identities, and a point's identity is its position bits plus its `seed` — both of which this node composes per copy (P from the target's transform, seed from hashCombine(sourceSeed, targetSeed)). So the copies of one source primitive are DISTINCT primitives, one per target that re-emitted it, and a randomField on the primitive domain draws a different value for each, which is what 'one variation per copy' needs. The exception is the one mergePrimitives documents: two targets sharing a position AND a seed produce copies that are the same points, hence ONE primitive to every identity-keyed decision — give coincident targets distinct seeds.",
    },
  },
  execute({ inputs, params }) {
    const src = requireGeometry(inputs, "source", "copyToPoints");
    const tgt = requireGeometry(inputs, "target", "copyToPoints");
    const keepTopology = requireCopyTopologyRule(params.topology);
    const srcSet = src.attrs.point;
    const tgtSet = tgt.attrs.point;
    const nS = srcSet.count;
    const nT = tgtSet.count;

    // WHICH SOURCE POINTS EACH TARGET TAKES, settled before anything is
    // sized, because with selection on the output count is no longer
    // nS * nT — it is the sum of the blocks. With selection off there is
    // one group holding every source point, `starts[t]` is `t * nS` term
    // for term and `pointSrc` is the source's order repeated per target,
    // so every loop below is the arithmetic that shipped.
    const selection = buildCopySelection(src, tgt, params);
    const blockAt = (t: number): SourceGroup => {
      const g = selection.groupOf[t];
      return g < 0 ? NO_SOURCE_GROUP : selection.groups[g];
    };
    const starts = new Uint32Array(nT + 1);
    let total = 0;
    for (let t = 0; t < nT; t++) {
      total += blockAt(t).indices.length;
      starts[t + 1] = total;
    }
    // `starts` is u32, like every index array in this file. The RUNNING
    // total is not, deliberately: a copy count past 2^32 would wrap in the
    // block offsets and come out as a small, entirely plausible output,
    // where the count this node used to compute as a plain product failed
    // loudly at the allocation instead. Checked against `total` and not
    // against nSource * nTarget because selection makes the product an
    // upper bound that a legal cook may be far under.
    if (total > 0xffffffff) {
      throw new Error(
        `copyToPoints: ${nS} source points onto ${nT} target points comes to ${total} copies, past ` +
          "the 2^32 this node can index (with selection on, that is the sum of the blocks rather than " +
          "the product). Cut one of the two clouds down, or give each target only the source points " +
          'it needs with "sourceGroupAttr" and "targetGroupAttr".',
      );
    }
    // The source point behind each copy, flat. One array rather than a
    // per-block indirection so every domain gathers the same way.
    const pointSrc = new Uint32Array(total);
    for (let t = 0; t < nT; t++) {
      const indices = blockAt(t).indices;
      pointSrc.set(indices, starts[t]);
    }

    const out = new Geometry();
    const outSet = out.attrs.point;
    for (const attr of srcSet) {
      outSet.add(attr.name, attr.type, attr.tupleSize, attr.defaultValue as AttrDefault);
    }
    for (const std of COPY_STANDARD) {
      if (!outSet.has(std.name)) {
        outSet.add(std.name, std.type, std.tupleSize, std.defaultValue as AttrDefault);
      }
    }

    // Carried target columns are added LAST, after the source columns and
    // the standards, so every way a name could already be taken is
    // refused first and by name. The alternative is the attribute layer's
    // own "already exists", which names neither this node nor the param
    // the author typed the name into. Type, tuple size and default come
    // from the target column and nothing else — the same derivation
    // `promote` and `transferNearest` use when they move a column.
    const carried: Attribute[] = [];
    const listed = new Set<string>();
    for (const name of params.targetNames) {
      if (COPY_STANDARD.some((std) => std.name === name)) {
        throw new Error(
          `copyToPoints: param "targetNames" cannot carry "${name}" — P, rot, scale and seed are ` +
            "composed per copy and already hold the target's contribution, so carrying one would " +
            "overwrite every copy in a target's block with the target's own value. Copy it to another " +
            "name on the target upstream with setAttribute and carry that name instead.",
        );
      }
      if (listed.has(name)) {
        throw new Error(
          `copyToPoints: param "targetNames" lists "${name}" twice; name each attribute once.`,
        );
      }
      listed.add(name);
      const attr = tgtSet.get(name);
      if (!attr) {
        throw new Error(
          `copyToPoints: param "targetNames" names "${name}", which the target has no point attribute ` +
            `for; available: ${tgtSet.names().join(", ") || "(none)"}.`,
        );
      }
      if (srcSet.has(name)) {
        throw new Error(
          `copyToPoints: param "targetNames" cannot carry "${name}" — the source carries a point ` +
            "attribute of that name too, and the two would write the same column. Rename one side with " +
            `setAttribute, or drop it from the source upstream with removeAttribute (domain "point", ` +
            `names ["${name}"]).`,
        );
      }
      outSet.add(name, attr.type, attr.tupleSize, attr.defaultValue as AttrDefault);
      carried.push(attr);
    }

    // The target index is SYNTHESIZED rather than carried, so it takes the
    // same three refusals a carried name takes — a composed standard, a
    // name `targetNames` is already carrying, a name the source already
    // writes — each naming the param the author typed the name into. It is
    // added after the carried columns so their refusals happen first: a
    // name that is wrong for both reasons reports the one the author is
    // more likely to have meant.
    const indexName = params.targetIndexAttr;
    if (indexName !== "") {
      if (COPY_STANDARD.some((std) => std.name === indexName)) {
        throw new Error(
          `copyToPoints: param "targetIndexAttr" cannot write "${indexName}" — P, rot, scale and seed ` +
            "are composed per copy, so writing the target index over one would destroy the placement " +
            "this node exists to compute. Name an attribute of your own instead.",
        );
      }
      if (listed.has(indexName)) {
        throw new Error(
          `copyToPoints: param "targetIndexAttr" writes "${indexName}", which param "targetNames" is ` +
            "already carrying from the target; the two would write the same column. Drop it from " +
            "targetNames (the index this writes is the same for every copy in a target's block), or " +
            "give one of them another name.",
        );
      }
      if (srcSet.has(indexName)) {
        throw new Error(
          `copyToPoints: param "targetIndexAttr" cannot write "${indexName}" — the source carries a ` +
            "point attribute of that name too, and the two would write the same column. Rename one " +
            `side with setAttribute, or drop it from the source upstream with removeAttribute (domain ` +
            `"point", names ["${indexName}"]).`,
        );
      }
      // i32 like every other index column the library writes
      // (`sampleNearestPoint.indexAttr`), and defaulted to -1 for the same
      // reason: -1 is the value no target has, so an element appended after
      // this node reads as belonging to no target rather than to the first.
      outSet.add(indexName, "i32", 1, -1);
    }

    outSet.resize(total);

    // Written per TARGET, not per copy: one fill over the block of copies
    // that landed on it, at the same offsets the transform loop below
    // writes them at. A target that took nothing gets an empty fill, so
    // its index never appears in the column — which is what keeps -1
    // meaning "belongs to no target" rather than "took no copies".
    if (indexName !== "") {
      const dst = outSet.require(indexName).data;
      for (let t = 0; t < nT; t++) dst.fill(t, starts[t], starts[t + 1]);
    }

    // Bulk-carry every source attribute into each target block, then
    // overwrite the composed transform attributes. `gatherInto` coalesces
    // the runs, which with no selection is exactly one ranged copy per
    // block — the same calls this loop made when it was written by hand.
    for (const attr of srcSet) {
      gatherInto(outSet.require(attr.name), attr, pointSrc);
    }

    // The target carry is a BROADCAST, not a range copy: one target
    // element spread over the copies that landed on it. So it reads the
    // element once per TARGET and writes it once per copy in that
    // target's block, rather than calling copyFrom per copy — that one
    // allocates a subarray view on every call, which is one per copy in
    // an inner loop. Strings go through internString because a string
    // column's data holds indices into ITS OWN table, and an index means
    // nothing in another geometry's; interning per target rather than per
    // copy is what makes the output column say the same words the target
    // did.
    const vals: number[] = [];
    for (const attr of carried) {
      const dst = outSet.require(attr.name);
      const ts = dst.tupleSize;
      const dd = dst.data;
      const sd = attr.data;
      const isString = attr.type === "string";
      vals.length = ts;
      for (let t = 0; t < nT; t++) {
        for (let k = 0; k < ts; k++) {
          vals[k] = isString ? dst.internString(attr.getString(t, k)) : sd[t * ts + k];
        }
        // EVERY TARGET IS READ, including one whose block is empty, and
        // that is deliberate rather than an oversight: skipping the read
        // would leave a string column's TABLE holding different words
        // depending on how many targets matched, and the table is
        // serialized and hashed even when the column has no elements. A
        // word the output interned and no copy says is harmless; a
        // default path whose bytes depend on a param being present is not.
        // The write loop below simply runs zero times.
        for (let i = starts[t], end = starts[t + 1]; i < end; i++) {
          const o = i * ts;
          for (let k = 0; k < ts; k++) dd[o + k] = vals[k];
        }
      }
    }

    const readVec = (geoAttr: ReturnType<typeof srcSet.get>, tuple: number): Float32Array | undefined =>
      geoAttr && geoAttr.type === "f32" && geoAttr.tupleSize === tuple
        ? (geoAttr.data as Float32Array)
        : undefined;
    const sP = readVec(srcSet.get("P"), 3);
    if (!sP) throw new Error('copyToPoints: source needs a point attribute "P" (f32, tupleSize 3)');
    const tP = readVec(tgtSet.get("P"), 3);
    if (!tP) throw new Error('copyToPoints: target needs a point attribute "P" (f32, tupleSize 3)');
    const sRot = readVec(srcSet.get("rot"), 4);
    const tRot = readVec(tgtSet.get("rot"), 4);
    const sScale = readVec(srcSet.get("scale"), 3);
    const tScale = readVec(tgtSet.get("scale"), 3);
    const sSeedAttr = srcSet.get("seed");
    const sSeed = sSeedAttr && sSeedAttr.type === "u32" && sSeedAttr.tupleSize === 1 ? sSeedAttr.data : undefined;
    const tSeedAttr = tgtSet.get("seed");
    const tSeed = tSeedAttr && tSeedAttr.type === "u32" && tSeedAttr.tupleSize === 1 ? tSeedAttr.data : undefined;

    const oP = outSet.require("P").data;
    const oRot = outSet.require("rot").data;
    const oScale = outSet.require("scale").data;
    const oSeed = outSet.require("seed").data;
    const v: number[] = [0, 0, 0];
    const q: number[] = [0, 0, 0, 1];
    for (let t = 0; t < nT; t++) {
      const qx = tRot ? tRot[t * 4] : 0;
      const qy = tRot ? tRot[t * 4 + 1] : 0;
      const qz = tRot ? tRot[t * 4 + 2] : 0;
      const qw = tRot ? tRot[t * 4 + 3] : 1;
      const tsx = tScale ? tScale[t * 3] : 1;
      const tsy = tScale ? tScale[t * 3 + 1] : 1;
      const tsz = tScale ? tScale[t * 3 + 2] : 1;
      const tSeedVal = tSeed ? tSeed[t] : t;
      const end = starts[t + 1];
      // `s` comes off the block rather than from the loop counter, which
      // is the ONE line selection changes here: the seed a copy gets is
      // hashCombine(sourceSeed, targetSeed) — the source point's own seed
      // and the target's, never the slot — so a copy that would have
      // existed without selection gets the same seed with it.
      for (let i = starts[t]; i < end; i++) {
        const s = pointSrc[i];
        rotateVec(v, qx, qy, qz, qw, sP[s * 3] * tsx, sP[s * 3 + 1] * tsy, sP[s * 3 + 2] * tsz);
        oP[i * 3] = tP[t * 3] + v[0];
        oP[i * 3 + 1] = tP[t * 3 + 1] + v[1];
        oP[i * 3 + 2] = tP[t * 3 + 2] + v[2];
        quatMul(
          q,
          qx,
          qy,
          qz,
          qw,
          sRot ? sRot[s * 4] : 0,
          sRot ? sRot[s * 4 + 1] : 0,
          sRot ? sRot[s * 4 + 2] : 0,
          sRot ? sRot[s * 4 + 3] : 1,
        );
        oRot[i * 4] = q[0];
        oRot[i * 4 + 1] = q[1];
        oRot[i * 4 + 2] = q[2];
        oRot[i * 4 + 3] = q[3];
        oScale[i * 3] = tsx * (sScale ? sScale[s * 3] : 1);
        oScale[i * 3 + 1] = tsy * (sScale ? sScale[s * 3 + 1] : 1);
        oScale[i * 3 + 2] = tsz * (sScale ? sScale[s * 3 + 2] : 1);
        oSeed[i] = hashCombine(sSeed ? sSeed[s] : s, tSeedVal);
      }
    }

    // TOPOLOGY, opt-in and strictly additive. It runs LAST because
    // `setTopology` validates the renumbered vertex references against the
    // point count, and the point domain is only final here. Nothing above
    // is re-derived: `topology "drop"` skips this block entirely rather
    // than routing through a rebuild, so the default is byte-identical to
    // what shipped by construction, not by argument.
    //
    // `targetNames` and `targetIndexAttr` cannot collide with any of this:
    // they write POINT columns, while `setTopology` only sizes the vertex
    // and primitive sets and leaves the point domain untouched.
    if (keepTopology) {
      requireTopologySized(src, "copyToPoints", 'the source on pin "source"');
      // ONE PLAN PER GROUP, NOT PER TARGET. Which primitives survive
      // depends only on which source points the block holds, and every
      // target asking the same key holds the same ones — so the survival
      // sweep runs once per distinct key however many targets name it.
      // With no selection there is one group, its plan is the source's
      // topology verbatim, and this is the loop that shipped.
      const plans: (KeepPlan | undefined)[] = new Array(selection.groups.length).fill(undefined);
      const planAt = (t: number): KeepPlan | undefined => {
        const g = selection.groupOf[t];
        if (g < 0) return undefined;
        let plan = plans[g];
        if (!plan) {
          const indices = selection.groups[g].indices;
          plan = selection.selecting
            ? buildKeepPlan(src, indices, nS)
            : wholeSourceKeepPlan(src);
          plans[g] = plan;
        }
        return plan;
      };

      let totalVerts = 0;
      let totalPrims = 0;
      for (let t = 0; t < nT; t++) {
        const plan = planAt(t);
        if (!plan) continue;
        totalVerts += plan.vertexSrc.length;
        totalPrims += plan.primSrc.length;
      }
      const vertexToPoint = new Uint32Array(totalVerts);
      const primVertexStart = new Uint32Array(totalPrims);
      const primVertexCount = new Uint32Array(totalPrims);
      // Source vertex/primitive behind each re-emitted element, so the
      // vertex and primitive columns gather exactly as the point columns
      // did — one flat array per domain, one `gatherInto` per attribute.
      const vertexSrc = new Uint32Array(totalVerts);
      const primSrc = new Uint32Array(totalPrims);
      // One block per target. `starts[t]` is the point base — the same
      // number the transform loop above wrote its copies at, which is
      // exactly why this is a re-emission and not a rebuild: the copies
      // are already contiguous per target, so the shift is the only thing
      // a primitive needs.
      let vertexBase = 0;
      let primBase = 0;
      for (let t = 0; t < nT; t++) {
        const plan = planAt(t);
        if (!plan) continue;
        appendTopologyBlock(
          plan.vertexToPoint,
          plan.primVertexStart,
          plan.primVertexCount,
          vertexToPoint,
          primVertexStart,
          primVertexCount,
          starts[t],
          vertexBase,
          primBase,
        );
        vertexSrc.set(plan.vertexSrc, vertexBase);
        primSrc.set(plan.primSrc, primBase);
        vertexBase += plan.vertexSrc.length;
        primBase += plan.primSrc.length;
      }
      // Runs even when the source has NO primitives (the common case, and
      // an empty topology either way): what the output IS must depend on
      // the graph and never on the data — the rule the point filters'
      // `topology "keep"` states at selfPrune's off switch.
      out.setTopology(vertexToPoint, primVertexStart, primVertexCount);
      // Vertex and primitive columns are gathered per block, exactly as
      // the source POINT columns are above: every copy of a primitive
      // carries the original's values. `add` cannot collide here — both
      // sets are fresh, and only the point domain has other writers — and
      // `setTopology` has already sized them. With no selection the
      // gather coalesces to one ranged write per block, which is the copy
      // this loop used to make by hand. String columns (`primtype`)
      // re-intern through `copyFrom`, since a table index means nothing in
      // another geometry.
      for (const domain of ["vertex", "primitive"] as const) {
        const from = src.attrs[domain];
        const to = out.attrs[domain];
        const gathered = domain === "vertex" ? vertexSrc : primSrc;
        for (const attr of from) {
          const dst = to.add(attr.name, attr.type, attr.tupleSize, attr.defaultValue as AttrDefault);
          gatherInto(dst, attr, gathered);
        }
      }
    }
    return { out: [makeGeometryItem(out)] };
  },
});

/**
 * Union the attribute columns of one domain across every input into
 * `into`: first-occurrence order, and the first occurrence's type, tuple
 * size and default. Two inputs disagreeing on an attribute's shape is a
 * hard error naming it — the alternative is a column whose meaning
 * changes halfway down, which nothing downstream could notice.
 *
 * Copying the values is the caller's job, because the two merges append
 * different things: this only settles what columns exist and what an
 * input that lacks one contributes (its default, filled by `resize`).
 *
 * `primtype` on the primitive domain is the ONE column whose default is
 * overridden, and {@link mergePrimitives} explains why.
 */
function unionColumns(
  who: string,
  items: readonly GeometryItem[],
  domain: Domain,
  into: AttributeSet,
): void {
  for (const item of items) {
    for (const attr of item.geo.attrs[domain]) {
      const existing = into.get(attr.name);
      if (!existing) {
        // `attr.type === "string"` is not decoration: the empty default
        // below is only a legal default FOR a string column, and a
        // hand-built numeric column under this name would otherwise be
        // refused by the attribute layer in an error naming neither this
        // node nor the input it came from. Such a column is not a type
        // tag anyway, so it takes the ordinary rule.
        const isPrimType =
          domain === "primitive" && attr.name === PRIMTYPE_ATTR && attr.type === "string";
        into.add(
          attr.name,
          attr.type,
          attr.tupleSize,
          isPrimType ? "" : (attr.defaultValue as AttrDefault),
        );
      } else if (existing.type !== attr.type || existing.tupleSize !== attr.tupleSize) {
        throw new Error(
          `${who}: attribute "${attr.name}" has conflicting shapes across inputs on the ${domain} ` +
            `domain (${existing.type} tuple ${existing.tupleSize} vs ${attr.type} tuple ${attr.tupleSize}). ` +
            `Every input must agree on a name's type and tuple size — rename one side with setAttribute, ` +
            `or drop the column upstream with removeAttribute (domain "${domain}", names ["${attr.name}"]).`,
        );
      }
    }
  }
}

/** Params of {@link mergePoints} (none). */
export type MergePointsParams = Record<string, never>;

/** Concatenate the point clouds of every connected input. */
export const mergePoints = standardNode<MergePointsParams>({
  type: "mergePoints",
  category: "point op",
  description:
    "Concatenates the points of every connected geometry, in connection order, into one point cloud. The output carries the union of all point attributes: an attribute missing on an input fills with its default over that input's range. Attributes sharing a name must agree on type and tuple size. Topology (vertices/primitives) is not carried — the result is points only, so a network or a mesh arrives here and leaves as a bare cloud; `mergePrimitives` is the twin that keeps it. Output tags are the union of input tags.",
  inputs: [{ name: "in", kind: "geometry", multi: true }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {},
  execute({ inputs }) {
    const items = geometryItems(inputs.in);
    // Nothing connected: emit an EMPTY STANDARD cloud, not a bare
    // Geometry. The union of no inputs is no attributes, which is
    // internally consistent and useless — the result would not even
    // carry P, so the next node rejects it for a reason that has
    // nothing to do with what the author did wrong. An unconnected
    // multi-pin is a legitimate "slot to fill later" (the staged
    // pipeline's edit layer is exactly that), so it must produce a
    // valid empty cloud rather than a malformed one.
    if (items.length === 0) {
      return { out: [makeGeometryItem(createPointCloud(0))] };
    }
    const out = new Geometry();
    const outSet = out.attrs.point;
    unionColumns("mergePoints", items, "point", outSet);
    let total = 0;
    for (const item of items) total += item.geo.pointCount;
    outSet.resize(total);
    let offset = 0;
    for (const item of items) {
      const n = item.geo.pointCount;
      for (const attr of item.geo.attrs.point) {
        outSet.require(attr.name).copyFrom(attr, 0, offset, n);
      }
      offset += n;
    }
    const tags = new Set<string>();
    for (const item of items) for (const tag of item.tags) tags.add(tag);
    return { out: [makeGeometryItem(out, tags)] };
  },
});

/** Params of {@link mergePrimitives} (none). */
export type MergePrimitivesParams = Record<string, never>;

/** Concatenate whole geometries — points, vertices and primitives. */
export const mergePrimitives = standardNode<MergePrimitivesParams>({
  type: "mergePrimitives",
  category: "point op",
  description:
    "Concatenates every connected geometry, in connection order, KEEPING TOPOLOGY: points, vertices and primitives are appended and each input's vertex and primitive references are renumbered onto its place in the result, so an authored network merged with a generated one comes out a single network. The topology-preserving twin of mergePoints, which carries points only and so turns any input into a bare cloud. The point, vertex and primitive domains each carry the union of that domain's attributes: an attribute missing on an input fills with its default over that input's range, and attributes sharing a name must agree on type and tuple size. The one exception is `primtype`, which is a type tag rather than a value: each input's primitives keep their own tag, and primitives from an input carrying no primtype column come out with an EMPTY tag rather than inheriting another input's — this node cannot know what an untagged primitive is and must not guess. One consequence to know before relying on absence: surfaceSample ignores the tag entirely when a geometry has NO primtype column, so an untagged triangle mesh samples fine alone but is skipped once a tagged input is merged in and the column exists — tag such a mesh upstream (createTriangleMesh does) rather than leaving it untagged. Mixed primitive types are allowed, because every consumer selects what it understands (surfaceSample takes 3-vertex `poly`, the path nodes take `polyline`). An input with no topology contributes its points and no primitives, which is not an error. The detail domain is not carried: every input has one and choosing between them would be a guess. Output tags are the union of input tags. Point identity is position bits plus the `seed` attribute and both are copied verbatim, so two inputs holding a point at the same position with the same seed are ONE point to every identity-keyed decision (jitter, probabilistic filters, randomField) — the same inherited hazard mergePoints carries. Give clouds that must stay distinct distinct seeds.",
  inputs: [{ name: "in", kind: "geometry", multi: true }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {},
  execute({ inputs }) {
    const items = geometryItems(inputs.in);
    // Same reasoning as mergePoints: an unconnected multi-pin is a slot
    // to fill later, and it must produce a valid empty cloud rather than
    // an attribute-less Geometry the next node rejects for the wrong
    // reason.
    if (items.length === 0) {
      return { out: [makeGeometryItem(createPointCloud(0))] };
    }
    const out = new Geometry();
    for (const domain of ["point", "vertex", "primitive"] as const) {
      unionColumns("mergePrimitives", items, domain, out.attrs[domain]);
    }

    let totalPoints = 0;
    let totalVerts = 0;
    let totalPrims = 0;
    for (let i = 0; i < items.length; i++) {
      const geo = items[i].geo;
      // Topology is what sizes the vertex and primitive domains, and
      // `setTopology` is the only thing that does it — so the two agree for
      // every geometry built through the API. One that resized an
      // attribute set directly would land its vertex values on
      // other inputs' vertices here, silently, which is exactly the class
      // of failure this node exists to avoid.
      requireTopologySized(geo, "mergePrimitives", `input ${i} on pin "in"`);
      totalPoints += geo.pointCount;
      totalVerts += geo.vertexToPoint.length;
      totalPrims += geo.primVertexStart.length;
    }

    // THE ASSEMBLER IS LOCAL ON PURPOSE, and is not `gatherPrimitives`
    // (util.ts) with more sources. That one GATHERS a chosen subset of one
    // geometry's primitives and rebuilds their vertex runs contiguously
    // from `w`; this one APPENDS whole geometries and must keep each
    // input's vertex layout as it arrived. A geometry whose primitive
    // ranges do not tile its vertex array — nothing forbids it, only
    // `start + count <= nv` is checked — comes out of a compacting rebuild
    // with the unreferenced vertices GONE, and their attribute values
    // with them (that gather stays internally consistent, since it carries
    // the vertex columns through the same selection; what it loses is
    // data this node was asked to concatenate, not to filter). Two
    // different operations that happen to share the word "renumber", so
    // the shared pieces here are the column union above and the per-block
    // shift ({@link appendTopologyBlock}, which `copyToPoints`'
    // `topology "keep"` walks once per target), not `gatherPrimitives`.
    const vertexToPoint = new Uint32Array(totalVerts);
    const primVertexStart = new Uint32Array(totalPrims);
    const primVertexCount = new Uint32Array(totalPrims);
    let pointBase = 0;
    let vertexBase = 0;
    let primBase = 0;
    for (const item of items) {
      const geo = item.geo;
      appendTopologyBlock(
        geo.vertexToPoint,
        geo.primVertexStart,
        geo.primVertexCount,
        vertexToPoint,
        primVertexStart,
        primVertexCount,
        pointBase,
        vertexBase,
        primBase,
      );
      pointBase += geo.pointCount;
      vertexBase += geo.vertexToPoint.length;
      primBase += geo.primVertexStart.length;
    }

    // Points first: setTopology validates the renumbered vertex
    // references against the point count they are meant to index.
    out.attrs.point.resize(totalPoints);
    out.setTopology(vertexToPoint, primVertexStart, primVertexCount);

    let pointOffset = 0;
    let vertexOffset = 0;
    let primOffset = 0;
    for (const item of items) {
      const geo = item.geo;
      for (const attr of geo.attrs.point) {
        out.attrs.point.require(attr.name).copyFrom(attr, 0, pointOffset, geo.pointCount);
      }
      for (const attr of geo.attrs.vertex) {
        out.attrs.vertex.require(attr.name).copyFrom(attr, 0, vertexOffset, geo.attrs.vertex.count);
      }
      for (const attr of geo.attrs.primitive) {
        out.attrs.primitive
          .require(attr.name)
          .copyFrom(attr, 0, primOffset, geo.attrs.primitive.count);
      }
      pointOffset += geo.pointCount;
      vertexOffset += geo.attrs.vertex.count;
      primOffset += geo.attrs.primitive.count;
    }

    const tags = new Set<string>();
    for (const item of items) for (const tag of item.tags) tags.add(tag);
    return { out: [makeGeometryItem(out, tags)] };
  },
});

/** Params of {@link orientAlongVector}. */
export interface OrientAlongVectorParams {
  direction: FieldParam;
  /**
   * Widened from `readonly number[]` when `up` became field-capable. The
   * runtime keeps the two apart deliberately — see the execute body for
   * why a plain array must not be routed through a field column.
   */
  up: FieldParam;
  axis: string;
}

/** Build rot quaternions pointing a chosen local axis along a direction. */
export const orientAlongVector = standardNode<OrientAlongVectorParams>({
  type: "orientAlongVector",
  category: "point op",
  description:
    "Sets the standard rot point attribute (f32 tuple 4 quaternion, [x, y, z, w]) so the chosen local axis points along `direction`, with `up` fixing the roll. The quaternion is right-handed and matches the spawner path's three.js Matrix4.compose conventions (and quatFromEulerDeg's frame), so with the default '+z' axis, spawned assets face the direction the way the spline-fence example's tangent yaw does. For axes ±x and ±z the local +Y axis turns as close to `up` as the direction allows; for axes ±y (which consume the up-like axis) local +Z takes that role. Points with a zero-length direction keep their existing rot (identity when the attribute is newly created). When direction and up are parallel or antiparallel (cross product squared length <= 1e-12, after normalizing both), the up hint deterministically falls back to [0, 0, 1], then [1, 0, 0].",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    direction: {
      type: "vec3",
      default: [0, 0, 1],
      acceptsField: true,
      description:
        "World-space direction the chosen local axis should point along; need not be unit length. Field-capable (resolved per point on the input, e.g. a tangent attribute; tuple 1 broadcasts). Zero-length directions leave that point's rot unchanged (identity when the rot attribute did not exist before).",
    },
    up: {
      type: "vec3",
      default: [0, 1, 0],
      acceptsField: true,
      description:
        "Up hint fixing the roll around the direction; need not be unit length. When parallel/antiparallel to the direction (or zero), deterministically falls back to [0, 0, 1], then [1, 0, 0]. Field-capable (resolved per point on the input; tuple 1 broadcasts). A per-point up is what a curve that turns over needs: a CONSTANT up flips the roll a half turn as the direction passes through it, and everything placed along the curve snaps round with it — feed writeCurveFrame's `curveNormal` here instead and the roll varies smoothly. A field `up` keeps this node OFF the device-resident path, because the apply kernel bakes the normalized up in as a constant; the cook reports that by name in its fallbacks rather than silently producing different bytes.",
    },
    axis: {
      type: "enum",
      default: "+z",
      enum: [...ORIENT_AXES],
      description:
        "Which local axis maps onto the direction. Default '+z' — the forward axis assets face in the examples (a spline-fence style tangent yaw). For ±x/±z the local +Y follows the up hint; for ±y the local +Z follows it.",
    },
  },
  // `direction` may resolve on the GPU; it is evaluated on the cloned
  // input's point domain BEFORE the rot attribute is (re)created or
  // written, so the resolver sees the same attribute layout and bytes
  // the CPU evaluation would.
  gpu: "fields",
  // Fusable into device-resident runs; the apply kernel ports the
  // basis construction (up fallbacks, zero-direction keep-prior rot,
  // quatFromBasis trace branches) with the axis and normalized up
  // baked as constants.
  resident: {
    kind: "orientAlongVector",
    // A per-point up has nowhere to live in a kernel that bakes it in as
    // a constant. Named rather than a plain `false` because it is a
    // choice the author made and can unmake — the executor counts it
    // under exactly this string in CookStats.gpu.fallbacks.
    eligible: (params) =>
      !isField(params.up) || "up is a field; per-point roll is not ported to the device",
  },
  async execute({ inputs, params, seed, gpu }) {
    const geo = cloneGeometry(requireGeometry(inputs, "in", "orientAlongVector"));
    const axis = params.axis;
    if (!(ORIENT_AXES as readonly string[]).includes(axis)) {
      throw new Error(
        `orientAlongVector: param "axis" must be one of ${ORIENT_AXES.join(", ")}; got "${axis}"`,
      );
    }
    const dir = requireTuple(
      await resolveOnMaybeGpu(gpu, geo, "point", params.direction, seed, "orientAlongVector", "direction"),
      [1, 3],
      "orientAlongVector",
      "direction",
    );
    // A field up resolves per point; a plain one keeps the original code
    // path untouched, deliberately. resolveField wraps a plain array
    // through constant(), which stores f32, where the arithmetic below is
    // f64 over the raw param — so routing every up through a column
    // would shift `rot` for any up that is not f32-exact, and redden the
    // corpus golden for graphs that never asked for a field at all.
    const upIsField = isField(params.up);
    let upCol: Column | undefined;
    let upx = 0;
    let upy = 0;
    let upz = 0;
    if (upIsField) {
      upCol = requireTuple(
        await resolveOnMaybeGpu(gpu, geo, "point", params.up, seed, "orientAlongVector", "up"),
        [1, 3],
        "orientAlongVector",
        "up",
      );
    } else {
      const up = params.up;
      if (!Array.isArray(up) || up.length !== 3 || !up.every((v) => Number.isFinite(v))) {
        throw new Error(
          'orientAlongVector: param "up" must be an array of 3 finite numbers (e.g. [0, 1, 0])',
        );
      }
      // Normalize the up hint once so the parallel test is scale-invariant.
      const upLenSq = up[0] * up[0] + up[1] * up[1] + up[2] * up[2];
      const upInv = upLenSq > 0 ? 1 / Math.sqrt(upLenSq) : 0;
      upx = up[0] * upInv;
      upy = up[1] * upInv;
      upz = up[2] * upInv;
    }

    const set = geo.attrs.point;
    let rotAttr = set.get("rot");
    if (!rotAttr || rotAttr.type !== "f32" || rotAttr.tupleSize !== 4) {
      if (rotAttr) set.remove("rot");
      rotAttr = set.add("rot", "f32", 4, [0, 0, 0, 1]);
    }
    const rot = rotAttr.data;
    const q: number[] = [0, 0, 0, 1];
    const n = geo.pointCount;
    for (let i = 0; i < n; i++) {
      const dx = readComp(dir, i, 0);
      const dy = readComp(dir, i, 1);
      const dz = readComp(dir, i, 2);
      const dl = dx * dx + dy * dy + dz * dz;
      if (dl === 0) continue; // zero direction: keep the prior rot
      const dInv = 1 / Math.sqrt(dl);
      if (upCol !== undefined) {
        // Per-point up, normalized here for the scale invariance the
        // constant path gets once outside the loop. A zero-length up
        // normalizes to zero and lands on orientQuat's own parallel
        // fallbacks, which is the documented behaviour for a bad hint.
        const ux = readComp(upCol, i, 0);
        const uy = readComp(upCol, i, 1);
        const uz = readComp(upCol, i, 2);
        const ulSq = ux * ux + uy * uy + uz * uz;
        const uInv = ulSq > 0 ? 1 / Math.sqrt(ulSq) : 0;
        upx = ux * uInv;
        upy = uy * uInv;
        upz = uz * uInv;
      }
      orientQuat(q, dx * dInv, dy * dInv, dz * dInv, upx, upy, upz, axis);
      rot[i * 4] = q[0];
      rot[i * 4 + 1] = q[1];
      rot[i * 4 + 2] = q[2];
      rot[i * 4 + 3] = q[3];
    }
    return { out: [makeGeometryItem(geo)] };
  },
});

/** Params of {@link setBounds}. */
export interface SetBoundsParams {
  boundsMin: FieldParam;
  boundsMax: FieldParam;
}

/**
 * One corner of {@link setBounds}, as three numbers per point.
 *
 * The tupleSize guard is the whole check: this writes into an f32 tuple-3
 * attribute, and a scalar field would broadcast into it silently, giving
 * every point a cube when the author asked for a box.
 */
function boundsCorner(
  geo: Geometry,
  param: "boundsMin" | "boundsMax",
  value: FieldParam,
  seed: number,
): Column {
  const col = resolveOn(geo, "point", value, seed, "setBounds", param);
  if (col.tupleSize !== 3) {
    throw new Error(
      `setBounds: param "${param}" must evaluate to THREE numbers per point (tupleSize 3), got tupleSize ${col.tupleSize} — a bounds corner is a vec3. A scalar would broadcast to a cube rather than fail, which is why this is refused: build the corner with vec(x, y, z), or multiply a vec3 by your scalar.`,
    );
  }
  return col;
}

/** Stamp the standard boundsMin/boundsMax point attributes. */
export const setBounds = standardNode<SetBoundsParams>({
  type: "setBounds",
  category: "point op",
  description:
    "Sets the standard per-point bounds attributes: writes boundsMin and boundsMax (f32 tuple 3, world units) on every point, creating the attributes when missing. Downstream nodes and spawners read these as each point's axis-aligned extent.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    boundsMin: {
      type: "vec3",
      default: [0, 0, 0],
      acceptsField: true,
      description:
        "Minimum corner written to every point's boundsMin, in world units. As a FIELD it is PER POINT, which is the reading that makes this node worth more than a constant: an extent derived from the point's own `scale`, or from a species attribute, gives every instance the box it actually occupies rather than one box the whole cloud shares. Must evaluate to THREE numbers per point — a scalar is REFUSED rather than broadcast, because broadcasting would quietly hand every point a cube when a box was asked for.",
    },
    boundsMax: {
      type: "vec3",
      default: [1, 1, 1],
      acceptsField: true,
      description:
        "Maximum corner written to every point's boundsMax, in world units. As a FIELD it is PER POINT, on the same terms as boundsMin, and refuses a scalar for the same reason. Nothing here checks that max exceeds min: the two are written independently, and a point whose corners cross is a point with an inside-out box, which is what the author asked for and what a downstream reader will see.",
    },
  },
  execute({ inputs, params, seed: nodeSeed }) {
    const geo = cloneGeometry(requireGeometry(inputs, "in", "setBounds"));
    const set = geo.attrs.point;
    for (const [name, value] of [
      ["boundsMin", params.boundsMin],
      ["boundsMax", params.boundsMax],
    ] as const) {
      let attr = set.get(name);
      if (!attr || attr.type !== "f32" || attr.tupleSize !== 3) {
        if (attr) set.remove(name);
        attr = set.add(name, "f32", 3, [0, 0, 0]);
      }
      // A plain corner still goes through `fill`: same bytes, and it does
      // not pay for a resolved column to write one repeated value.
      if (!isField(value)) {
        attr.fill(value as AttrDefault, 0, set.count);
        continue;
      }
      const col = boundsCorner(geo, name, value, nodeSeed);
      const out = attr.data;
      for (let i = 0; i < set.count; i++) {
        const o = i * 3;
        out[o] = col.data[o];
        out[o + 1] = col.data[o + 1];
        out[o + 2] = col.data[o + 2];
      }
    }
    return { out: [makeGeometryItem(geo)] };
  },
});
