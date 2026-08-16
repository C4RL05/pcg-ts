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
  topology: string;
}

/**
 * Returns whether the source's topology is KEPT.
 *
 * The twin of `requireTopologyRule` in `filtering.ts`, and deliberately a
 * second function rather than a shared one: that guard is private to its
 * file, and its message states a SURVIVAL rule ("keep preserves the
 * primitives all of whose points survive") that has no meaning here —
 * nothing is filtered, every source primitive is re-emitted once per
 * target. Unifying the two would mean a message that says neither thing
 * precisely, and error messages are part of the agent API. What IS shared
 * is the vocabulary: same param name, same two values, same default.
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
        '"keep" re-emits every source primitive once per target, renumbered onto that target\'s block of copies',
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
 * Append ONE geometry's topology into output arrays at the given bases:
 * every vertex reference shifted onto that block's points, every
 * primitive's vertex range shifted onto that block's vertices, counts
 * verbatim. Each input's vertex layout arrives as it was — nothing is
 * compacted, which is what separates this from `gatherPrimitives`
 * (util.ts) and is spelled out at {@link mergePrimitives}'s call.
 *
 * Shared by the file's two block-wise assemblers, which build the same
 * arrays from different block SOURCES: {@link mergePrimitives} walks a
 * list of inputs, {@link copyToPoints} under `topology "keep"` walks the
 * SAME input once per target. A copy array is a union with all the terms
 * equal, so the index arithmetic must be one function or the two will
 * drift on what "renumber" means.
 */
function appendTopologyBlock(
  geo: Geometry,
  vertexToPoint: Uint32Array,
  primVertexStart: Uint32Array,
  primVertexCount: Uint32Array,
  pointBase: number,
  vertexBase: number,
  primBase: number,
): void {
  const srcV2P = geo.vertexToPoint;
  for (let v = 0; v < srcV2P.length; v++) vertexToPoint[vertexBase + v] = srcV2P[v] + pointBase;
  const srcStart = geo.primVertexStart;
  const srcCount = geo.primVertexCount;
  for (let p = 0; p < srcStart.length; p++) {
    primVertexStart[primBase + p] = srcStart[p] + vertexBase;
    primVertexCount[primBase + p] = srcCount[p];
  }
}

/** Copy a source cloud onto every target point, composing transforms. */
export const copyToPoints = standardNode<CopyToPointsParams>({
  type: "copyToPoints",
  category: "point op",
  description:
    "Copies the source point cloud onto every target point (output count = source points * target points, grouped by target). Transforms compose per copy: P = targetP + targetRot * (targetScale * sourceP), rot = targetRot * sourceRot (quaternion product), scale = targetScale * sourceScale (componentwise), and each copied seed is hashCombine(sourceSeed, targetSeed). All other source point attributes are carried through unchanged; missing transform attributes are treated as identity. `targetNames` additionally carries named TARGET point attributes onto the copies: every copy in a target's block receives that target's value, in a column keeping the target's type, tuple size and default. That is what lets copies vary by what the author computed on the target cloud — a species tag, an age, a noise sampled per target — since the copies are otherwise identical in everything but placement. The composed transform attributes cannot be carried, a name the source already carries is refused rather than silently overwritten, a name repeated in the list is refused, and a name absent from the target is an error. `targetIndexAttr` writes the target's INDEX rather than one of its attributes, which is what makes \"one thing per target\" — one path per anchor, one group per instance — expressible without an upstream setAttribute whose only job was to give this node something to carry. The source's TOPOLOGY is dropped by default — an array of a path comes out a bare cloud — and `topology \"keep\"` re-emits every source primitive once per target instead, which is what makes the array of paths a set of paths without rebuilding them downstream.",
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
        'Name of an i32 point attribute to write the TARGET INDEX into — 0 for every copy that landed on the first target point, 1 for the second, and so on. Empty (the default) writes nothing. This is the key downstream nodes group by: pointsToPath\'s `groupAttr` turns "the copies of one target" into one path per target, and partitionByAttribute turns them into one item each. The node already computes this index to place the copies, so naming it here replaces the setAttribute writing `{"fn":"index"}` on the target purely so `targetNames` had something to carry. The column is i32, tuple size 1, default -1 (which no copy ever gets, so an element appended later reads as belonging to no target). Refused for the same three reasons `targetNames` refuses a name: "P", "rot", "scale" and "seed" are composed per copy, a name the source already carries would have two writers, and so would a name `targetNames` is carrying.',
    },
    topology: {
      type: "enum",
      default: "drop",
      enum: ["drop", "keep"],
      description:
        "What happens to the SOURCE's topology — the vertices and primitives built over the source's points. 'drop' (the default) copies POINTS only: an array of a path comes out a bare cloud with the paths gone, which is why the copies have to be rebuilt downstream (targetIndexAttr, then a pointsToPath grouping on it). 'keep' re-emits every source primitive once per TARGET: the copies are laid out in contiguous blocks of nSource (copy s of target t is point t * nSource + s), so primitive p of block t walks exactly the points its original walked, t * nSource further on. That is what mergePrimitives produces from nTarget copies of the source, and it is the whole difference between an array of points and an array of paths. Nothing is filtered and no primitive is reshaped: a source with N primitives always yields nTarget * N, in target-block order. The source's VERTEX and PRIMITIVE attributes come along, each copy carrying the original's values (a per-primitive width, a per-vertex uv, and `primtype`, so the copies stay samplable as what they are). The TARGET's own topology is never read under either setting — the target contributes point transforms and, through targetNames/targetIndexAttr, point attributes, while its primitives describe points that are not in this output at all. The POINT domain is IDENTICAL under both settings — same points, same order, same attributes, same identities — so this param only ever ADDS information, and neither targetNames nor targetIndexAttr (which write point columns) can be disturbed by it. The DETAIL domain is carried under NEITHER setting, for the reason mergePrimitives gives for dropping it: there are two inputs, each has a detail domain, and choosing between them would be a guess. On IDENTITY, because it decides what per-copy randomness does: a primitive is named by the fold of its own points' identities, and a point's identity is its position bits plus its `seed` — both of which this node composes per copy (P from the target's transform, seed from hashCombine(sourceSeed, targetSeed)). So the nTarget copies of one source primitive are nTarget DISTINCT primitives, and a randomField on the primitive domain draws a different value for each, which is what 'one variation per copy' needs. The exception is the one mergePrimitives documents: two targets sharing a position AND a seed produce copies that are the same points, hence ONE primitive to every identity-keyed decision — give coincident targets distinct seeds.",
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
    const total = nS * nT;

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

    // Written per TARGET, not per copy: one fill over the block of nS
    // copies that landed on it, which is the same index the transform loop
    // below derives as `i = t * nS + s`.
    if (indexName !== "") {
      const dst = outSet.require(indexName).data;
      for (let t = 0; t < nT; t++) dst.fill(t, t * nS, (t + 1) * nS);
    }

    // Bulk-carry every source attribute into each target block, then
    // overwrite the composed transform attributes.
    for (const attr of srcSet) {
      const dst = outSet.require(attr.name);
      for (let t = 0; t < nT; t++) dst.copyFrom(attr, 0, t * nS, nS);
    }

    // The target carry is a BROADCAST, not a range copy: one target
    // element spread over the nS copies that landed on it. So it reads
    // the element once per TARGET and writes it nS times, rather than
    // calling copyFrom per copy — that one allocates a subarray view on
    // every call, which is nS * nT of them in an inner loop. Strings go
    // through internString because a string column's data holds indices
    // into ITS OWN table, and an index means nothing in another
    // geometry's; interning per target (nT times, not nS * nT) is what
    // makes the output column say the same words the target did.
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
        const base = t * nS * ts;
        for (let s = 0; s < nS; s++) {
          const o = base + s * ts;
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
      for (let s = 0; s < nS; s++) {
        const i = t * nS + s;
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
      const nV = src.vertexToPoint.length;
      const nPrim = src.primVertexStart.length;
      const vertexToPoint = new Uint32Array(nV * nT);
      const primVertexStart = new Uint32Array(nPrim * nT);
      const primVertexCount = new Uint32Array(nPrim * nT);
      // One block per target, with the same `t * nS` stride the transform
      // loop above used — which is exactly why this is a re-emission and
      // not a rebuild: the copies are already contiguous per target, so
      // the shift is the only thing a primitive needs.
      for (let t = 0; t < nT; t++) {
        appendTopologyBlock(
          src,
          vertexToPoint,
          primVertexStart,
          primVertexCount,
          t * nS,
          t * nV,
          t * nPrim,
        );
      }
      // Runs even when the source has NO primitives (the common case, and
      // an empty topology either way): what the output IS must depend on
      // the graph and never on the data — the rule the point filters'
      // `topology "keep"` states at selfPrune's off switch.
      out.setTopology(vertexToPoint, primVertexStart, primVertexCount);
      // Vertex and primitive columns are bulk-copied per block, exactly as
      // the source POINT columns are above: every copy of a primitive
      // carries the original's values. `add` cannot collide here — both
      // sets are fresh, and only the point domain has other writers — and
      // `setTopology` has already sized them, so the copy is a plain
      // ranged write. String columns (`primtype`) re-intern through
      // `copyFrom`, since a table index means nothing in another geometry.
      for (const domain of ["vertex", "primitive"] as const) {
        const from = src.attrs[domain];
        const to = out.attrs[domain];
        const per = from.count;
        for (const attr of from) {
          const dst = to.add(attr.name, attr.type, attr.tupleSize, attr.defaultValue as AttrDefault);
          for (let t = 0; t < nT; t++) dst.copyFrom(attr, 0, t * per, per);
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
        geo,
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
  boundsMin: readonly number[];
  boundsMax: readonly number[];
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
      description: "Minimum corner written to every point's boundsMin, in world units.",
    },
    boundsMax: {
      type: "vec3",
      default: [1, 1, 1],
      description: "Maximum corner written to every point's boundsMax, in world units.",
    },
  },
  execute({ inputs, params }) {
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
      attr.fill(value as AttrDefault, 0, set.count);
    }
    return { out: [makeGeometryItem(geo)] };
  },
});
