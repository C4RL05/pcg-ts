/**
 * Attribute operation nodes: create/overwrite attributes from fields,
 * promote between domains, transfer between geometries, and partition
 * geometry by attribute value.
 */
import {
  promote,
  transferNearest,
  transferRaycast,
  transferUv,
  type AttrType,
  type Domain,
  type PromoteMode,
  type TransferAttrDomain,
  type TransferRaycastOptions,
} from "../data/index.js";
import { cloneGeometry, makeGeometryItem, type DataItem } from "../graph/index.js";
import { hashCombine } from "../random/index.js";
import { standardNode } from "./registry.js";
import {
  type FieldParam,
  gatherPoints,
  geometryItems,
  requireGeometry,
  requireGeometryItem,
  requireReportSlot,
  resolveOn,
  tryResolveOnGpu,
} from "./util.js";

const DOMAIN_ENUM = ["point", "vertex", "primitive", "detail"] as const;

/** Params of {@link setAttribute}. */
export interface SetAttributeParams {
  name: string;
  domain: string;
  type: string;
  tupleSize: number;
  value: FieldParam;
  values: readonly string[];
  stringValue: string;
  seed: number;
}

/** Create or overwrite an attribute from a field. */
export const setAttribute = standardNode<SetAttributeParams>({
  type: "setAttribute",
  category: "attribute",
  description:
    "Creates or overwrites an attribute on the chosen domain. Numeric types fill from `value`, which is field-capable and resolves per element of that domain (so it can read position, other attributes, or noise); the evaluated field must be scalar (broadcast across the tuple) or match tupleSize exactly, and stores with the target type's conversion: i32/u32 truncate, bool stores nonzero as 1. Type 'string' writes through the geometry's string table in two modes: with a non-empty `values` list, `value` acts as a per-element numeric selector — floor(selector), then clamped into [0, values.length - 1]; NaN selects 0 — choosing one entry per element (e.g. for per-point asset ids consumed by spawnInstances assetAttr); with `values` empty, the constant `stringValue` is written to every element.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    name: {
      type: "string",
      default: "value",
      description: "Attribute name to create or overwrite (an existing attribute of any shape is replaced).",
    },
    domain: {
      type: "enum",
      default: "point",
      enum: [...DOMAIN_ENUM],
      description: "Domain the attribute lives on: point, vertex, primitive, or detail (one element).",
    },
    type: {
      type: "enum",
      default: "f32",
      enum: ["f32", "i32", "u32", "bool", "string"],
      description:
        "Storage type. f32 keeps fractions; i32/u32 truncate toward zero; bool stores 0/1 (nonzero field values become 1); string interns into the geometry's string table and writes via `values` + selector or `stringValue` (see those params).",
    },
    tupleSize: {
      type: "i32",
      default: 1,
      min: 1,
      max: 4,
      description: "Components per element (1 = scalar, 3 = vector, 4 = color/quaternion). Range 1..4.",
    },
    value: {
      type: "f32",
      default: 0,
      acceptsField: true,
      description:
        "Numeric value written to every element — or, for type 'string' with a non-empty `values` list, the per-element selector into it: floor(selector) clamped into [0, values.length - 1], NaN selects 0 (a total function; out-of-range never errors per element). Field-capable: evaluated on the target domain; scalar results broadcast across the tuple, otherwise the tuple size must match tupleSize. Ignored for type 'string' with `values` empty.",
    },
    values: {
      type: "stringList",
      default: [],
      description:
        "String values to choose among when type is 'string': `value` selects per element (floor, then clamp into range). Leave empty to write the constant `stringValue` instead. Setting this with a numeric type is an error. Note: when the attribute feeds spawnInstances via assetAttr, an empty-string entry never names an asset — the spawner falls back to its assetId param for those elements.",
    },
    stringValue: {
      type: "string",
      default: "",
      description:
        "Constant written to every element when type is 'string' and `values` is empty. Must stay \"\" for numeric types.",
    },
    seed: {
      type: "u32",
      default: 0,
      description:
        "Extra seed for evaluating `value`: 0 (the default) uses the node's derived seed unchanged, so pre-existing graphs keep bit-identical output; any nonzero value folds in as hashCombine(nodeSeed, seed). This re-rolls randomness drawn from the EVALUATION CONTEXT — randomField, and the per-point seed attribute — but NOT noise: a noise field carries its own seed inside its spec, so `valueNoise`, `perlinNoise`, `simplexNoise`, `worleyNoise` and `fbm` are unaffected here and are varied through their own `opts.seed`, or by moving the positions they sample. Bind a per-cell value (such as ctx.seed) here for per-cell variation in a World level.",
    },
  },
  // Numeric mode resolves `value` on the GPU when a cook carries a
  // resolver ("fields": the memo key gains device provenance only when
  // `value` is a spec'd Field — plain values keep their cache across the
  // gpu toggle).
  gpu: "fields",
  // Fusable into device-resident runs in numeric point-domain mode
  // only: string modes, other domains, and the values/stringValue
  // misuse errors keep the per-node path so behavior (including the
  // exact CPU error messages) is unchanged.
  resident: {
    kind: "setAttribute",
    eligible: (p) =>
      p.type !== "string" && p.domain === "point" && p.values.length === 0 && p.stringValue === "",
  },
  async execute({ inputs, params, seed: nodeSeed, gpu }) {
    const geo = cloneGeometry(requireGeometry(inputs, "in", "setAttribute"));
    const domain = params.domain as Domain;
    const type = params.type as AttrType;
    const ts = params.tupleSize;
    // seed 0 keeps the node's derived seed byte-compatible with graphs
    // authored before this param existed; nonzero folds in exactly like
    // the sampler nodes fold their seed params.
    const seed = params.seed === 0 ? nodeSeed : hashCombine(nodeSeed, params.seed);
    const set = geo.attrs[domain];
    if (type === "string") {
      if (params.values.length === 0) {
        // Constant-string mode: intern once, fill every element with it.
        const attr = set.replace(params.name, "string", ts);
        attr.fill(params.stringValue, 0, set.count);
        return { out: [makeGeometryItem(geo)] };
      }
      // Value-list mode: `value` selects per element among `values`.
      const col = resolveOn(geo, domain, params.value, seed);
      if (col.tupleSize !== 1 && col.tupleSize !== ts) {
        throw new Error(
          `setAttribute: value evaluates to tuple size ${col.tupleSize}, which is neither 1 (broadcast) nor tupleSize ${ts}`,
        );
      }
      // No aliasing snapshot needed here: the selector column can only view
      // numeric storage (string attributes are not readable as fields), and
      // replace() either reuses string storage or allocates fresh — it never
      // resets a numeric buffer the column could alias.
      const attr = set.replace(params.name, "string", ts);
      // Intern each list entry once up front; the loop then writes plain
      // table indices — no per-element string work.
      const values = params.values;
      const tableIdx = new Uint32Array(values.length);
      for (let v = 0; v < values.length; v++) tableIdx[v] = attr.internString(values[v]);
      const last = values.length - 1;
      const data = attr.data;
      const n = set.count;
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < ts; k++) {
          const s = col.tupleSize === 1 ? col.data[i] : col.data[i * ts + k];
          // Total selection: floor, then clamp into [0, last]. NaN and
          // -Infinity land on 0 (via `!(idx > 0)`), +Infinity on last —
          // never a per-element throw.
          let idx = Math.floor(s);
          if (!(idx > 0)) idx = 0;
          else if (idx > last) idx = last;
          data[i * ts + k] = tableIdx[idx];
        }
      }
      return { out: [makeGeometryItem(geo)] };
    }
    if (params.values.length > 0) {
      throw new Error(
        `setAttribute: param "values" (${params.values.length} strings) is only used when type is "string", got type "${type}"; set type to "string" or clear values`,
      );
    }
    if (params.stringValue !== "") {
      throw new Error(
        `setAttribute: param "stringValue" is only used when type is "string", got type "${type}"; set type to "string" or clear stringValue`,
      );
    }
    // GPU adoption (numeric mode only): an eligible spec'd field resolves
    // on the device; null (plain value, no spec, incompatible layout)
    // falls back to the byte-identical CPU evaluation.
    const gpuCol =
      gpu !== undefined ? await tryResolveOnGpu(gpu, geo, domain, params.value, seed) : null;
    const col = gpuCol ?? resolveOn(geo, domain, params.value, seed);
    if (col.tupleSize !== 1 && col.tupleSize !== ts) {
      throw new Error(
        `setAttribute: value evaluates to tuple size ${col.tupleSize}, which is neither 1 (broadcast) nor tupleSize ${ts}`,
      );
    }
    // The evaluated column may be a zero-copy view of the very attribute
    // being replaced (e.g. value = attribute(name), or position() writing
    // onto "P"): replace() reuses matching storage and resets it to
    // defaults, which would clobber the column before it is read.
    // Snapshot the column when its buffer aliases the target attribute
    // (same hazard transferNearest guards against in src/data).
    const existing = set.get(params.name);
    const colData =
      existing && existing.data.buffer === col.data.buffer ? col.data.slice() : col.data;
    const attr = set.replace(params.name, type, ts);
    const data = attr.data;
    const n = set.count;
    const isBool = type === "bool";
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < ts; k++) {
        const v = col.tupleSize === 1 ? colData[i] : colData[i * ts + k];
        data[i * ts + k] = isBool ? (v !== 0 ? 1 : 0) : v;
      }
    }
    return { out: [makeGeometryItem(geo)] };
  },
});

/** Params of {@link promoteAttribute}. */
export interface PromoteAttributeParams {
  name: string;
  from: string;
  to: string;
  mode: string;
}

/** Promote an attribute between domains (wraps data promote). */
export const promoteAttribute = standardNode<PromoteAttributeParams>({
  type: "promoteAttribute",
  category: "attribute",
  description:
    "Moves an attribute between domains using the geometry's topology, creating or overwriting it on the target domain. Modes: 'first' keeps the first contribution in scan order (the only mode valid for string attributes); 'average', 'sum', 'min', 'max' aggregate all contributions. 'detail' broadcasts (from) or reduces over everything (to). Elements with no contributors keep the attribute default.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    name: {
      type: "string",
      default: "density",
      description: "Name of the attribute to promote. Must exist on the `from` domain.",
    },
    from: {
      type: "enum",
      default: "point",
      enum: [...DOMAIN_ENUM],
      description: "Domain the attribute currently lives on.",
    },
    to: {
      type: "enum",
      default: "primitive",
      enum: [...DOMAIN_ENUM],
      description: "Domain to create the attribute on.",
    },
    mode: {
      type: "enum",
      default: "average",
      enum: ["first", "average", "sum", "min", "max"],
      description:
        "How multiple contributions collapse: first (scan order), average, sum, min, or max. String attributes support only 'first'.",
    },
  },
  execute({ inputs, params }) {
    const geo = cloneGeometry(requireGeometry(inputs, "in", "promoteAttribute"));
    promote(geo, params.name, params.from as Domain, params.to as Domain, params.mode as PromoteMode);
    return { out: [makeGeometryItem(geo)] };
  },
});

/** Params of {@link transferAttribute}. */
export interface TransferAttributeParams {
  name: string;
  mapping: string;
  attrDomain: string;
  uvAttr: string;
  direction: readonly number[];
  directionAttr: string;
  maxDistance: number;
  missCountAttr: string;
  hitAttr: string;
}

/** Transfer an attribute from a source geometry (nearest / uv / raycast). */
export const transferAttribute = standardNode<TransferAttributeParams>({
  type: "transferAttribute",
  category: "attribute",
  description:
    "Transfers an attribute from the `source` geometry onto the main input's points, creating or overwriting it on the output's point domain. Mapping 'nearest' copies from the nearest source point in 3D (positions from P; distance ties resolve to the lowest source index; every point is assigned). Mapping 'uv' locates each destination point's UV (see uvAttr) in the source triangulation's UV space and interpolates inside the containing triangle; a UV on an edge shared by two triangles deterministically picks the lowest source primitive index. Mapping 'raycast' casts a normalized ray from each destination point along `direction` (or per-point directionAttr) against the source triangle mesh and interpolates at the nearest forward hit (smallest t >= 0, optionally capped by maxDistance; exactly-equal distances pick the lowest source primitive index). For uv/raycast the source must have 3-vertex 'poly' primitives (createTriangleMesh); zero-area (degenerate) triangles are skipped; f32 attributes interpolate barycentrically while i32/u32/bool/string take the triangle corner with the largest barycentric weight (ties to the first corner in vertex order); destination points with no containing triangle or no hit are misses that keep their prior value (the attribute default when the attribute did not exist) — set missCountAttr to record how many missed, and hitAttr to record WHICH ones did not (a per-point bool, 1 = found a source, 0 = missed). A miss cannot report itself through the transferred value, so hitAttr is the only per-point way to find one: filter on it to discard the misses rather than casting a second query to re-learn what this one already knew. All mappings are accelerated with deterministic uniform grids, so large inputs are fine.",
  inputs: [
    { name: "in", kind: "geometry" },
    { name: "source", kind: "geometry" },
  ],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    name: {
      type: "string",
      default: "density",
      description:
        "Name of the attribute to transfer. Must exist on the source domain selected by attrDomain (always the point domain for mapping 'nearest').",
    },
    mapping: {
      type: "enum",
      default: "nearest",
      enum: ["nearest", "uv", "raycast"],
      description:
        "How destination points find their source value: 'nearest' (closest source point in 3D), 'uv' (barycentric lookup of the destination UV in the source triangulation's UV space), or 'raycast' (nearest triangle hit along a ray from each destination point).",
    },
    attrDomain: {
      type: "enum",
      default: "point",
      enum: ["point", "vertex"],
      description:
        "Source domain the transferred attribute is read from (uv/raycast only): 'point' reads triangle corners through the topology, 'vertex' reads per-corner values (seam-accurate). Mapping 'nearest' supports only 'point'. The result always lands on the destination's point domain.",
    },
    uvAttr: {
      type: "string",
      default: "uv",
      description:
        "UV attribute name for mapping 'uv' (ignored otherwise). On the destination it must live on the point domain (f32, tupleSize >= 2; extra components ignored). On the source it is read from the vertex domain when present (per-corner UVs, supports seams), else from the point domain. Destination UVs with non-finite components miss.",
    },
    direction: {
      type: "vec3",
      default: [0, -1, 0],
      description:
        "Constant ray direction for mapping 'raycast' (ignored otherwise, and ignored when directionAttr is set). Normalized internally so maxDistance is world-space; must be non-zero.",
    },
    directionAttr: {
      type: "string",
      default: "",
      description:
        "Optional per-point ray direction attribute on the destination point domain (f32, tupleSize >= 3) for mapping 'raycast'; overrides `direction` when non-empty. Each direction is normalized per point; points with a zero or non-finite direction miss. Empty = use `direction`.",
    },
    maxDistance: {
      type: "f32",
      default: 0,
      min: 0,
      description:
        "Maximum world-space hit distance for mapping 'raycast' (ignored otherwise). 0 (the default) means unlimited; a positive value ignores hits farther along the ray. Rays are forward-only regardless (hits need t >= 0).",
    },
    missCountAttr: {
      type: "string",
      default: "",
      description:
        "When non-empty, writes the number of missed destination points into a u32 detail attribute of this name on the output (mapping 'nearest' always writes 0 — every point is assigned). Empty = don't record. For which points those were, see hitAttr. This is a reporting slot whose shape this node picks (u32, tuple 1), so a name the input's DETAIL domain already holds under a different shape is REFUSED rather than deleted and re-added — give it a name of its own (a \"__\" prefix marks it internal, e.g. \"__missed\") or removeAttribute the clash first. A same-shape column is reused and reset.",
    },
    hitAttr: {
      type: "string",
      default: "",
      description:
        "When non-empty, writes a per-point flag of this name onto the OUTPUT'S POINT DOMAIN (bool, tuple 1). The polarity is the HIT, not the miss — the inverse of missCountAttr, which counts the zeros: 1 means this point found a source and received a transferred value, 0 means it missed and kept its prior value (the attribute default when it had none). Every point is written, so the column never carries a stale value: mapping 'nearest' leaves it all 1 (every point is assigned), and a source with nothing to search — every triangle degenerate — leaves it all 0, since nothing was found. Feed it to filterByAttribute (comparison 'eq', value 1) to keep only the points that landed, then removeAttribute to clean it up. Two names are refused rather than written: `name`, which the flag would otherwise overwrite, and any point attribute the input ALREADY holds under a different shape — the flag's shape is this node's to pick, so writing it there would delete that column and everything in it while the cook still looked fine (hitAttr \"P\" would leave a point cloud with no positions). An existing bool tuple-1 column of the same name IS reused and reset, which is what keeps the flag describing THIS transfer only. On a clash, give the flag a name of its own (a \"__\" prefix marks it internal, e.g. \"__hit\") or removeAttribute the existing column first. Empty = don't record.",
    },
  },
  execute({ inputs, params }) {
    const dst = cloneGeometry(requireGeometry(inputs, "in", "transferAttribute"));
    const src = requireGeometry(inputs, "source", "transferAttribute");
    const attrDomain = params.attrDomain as TransferAttrDomain;
    if (params.hitAttr !== "" && params.hitAttr === params.name) {
      throw new Error(
        `transferAttribute: hitAttr "${params.hitAttr}" is the same as name — the hit flag would overwrite the attribute just transferred; give hitAttr a distinct name (a "__" prefix marks it internal, e.g. "__hit") or leave it empty to skip the flag`,
      );
    }
    // Checked BEFORE any work: a refusal must cost nothing, and the only
    // column the transfer itself adds is `name`, which the guard above
    // already separates from both reporting slots.
    if (params.hitAttr !== "") {
      requireReportSlot({
        attrs: dst.attrs.point,
        nodeType: "transferAttribute",
        param: "hitAttr",
        name: params.hitAttr,
        type: "bool",
        tupleSize: 1,
        domain: "point",
        suggestion: "__hit",
      });
    }
    if (params.missCountAttr !== "") {
      requireReportSlot({
        attrs: dst.attrs.detail,
        nodeType: "transferAttribute",
        param: "missCountAttr",
        name: params.missCountAttr,
        type: "u32",
        tupleSize: 1,
        domain: "detail",
        suggestion: "__missed",
      });
    }
    let missCount = 0;
    // Per-point outcome of the SAME query that wrote the values, kept only
    // when hitAttr asks for it. Sizing it here (rather than after the
    // branch) keeps the nearest case honest: transferNearest assigns every
    // point, so its flags are all 1 by construction.
    let hit: Uint8Array | null = null;
    if (params.mapping === "nearest") {
      if (attrDomain !== "point") {
        throw new Error(
          `transferAttribute: attrDomain "${params.attrDomain}" is only valid for the "uv" and "raycast" mappings — mapping "nearest" transfers point-domain attributes; set attrDomain to "point" or switch mapping`,
        );
      }
      transferNearest(dst, src, params.name);
      if (params.hitAttr !== "") hit = new Uint8Array(dst.attrs.point.count).fill(1);
    } else if (params.mapping === "uv") {
      const res = transferUv(dst, src, params.name, {
        uvAttr: params.uvAttr,
        attrDomain,
      });
      missCount = res.missCount;
      hit = res.hit;
    } else if (params.mapping === "raycast") {
      const opts: TransferRaycastOptions = { direction: params.direction, attrDomain };
      if (params.directionAttr !== "") opts.directionAttr = params.directionAttr;
      if (params.maxDistance > 0) opts.maxDistance = params.maxDistance;
      const res = transferRaycast(dst, src, params.name, opts);
      missCount = res.missCount;
      hit = res.hit;
    } else {
      throw new Error(
        `transferAttribute: unknown mapping "${params.mapping}"; valid mappings: nearest, uv, raycast`,
      );
    }
    if (params.missCountAttr !== "") {
      dst.attrs.detail.replace(params.missCountAttr, "u32", 1).set(0, missCount);
    }
    if (params.hitAttr !== "" && hit !== null) {
      // `replace` resets every element to the default 0 before the fill, so
      // a destination that already carried this name contributes nothing:
      // the flag describes THIS transfer only. That is the whole point of
      // it — an internal marker that inherits a prior value is how a miss
      // gets to claim it landed.
      const flag = dst.attrs.point.replace(params.hitAttr, "bool", 1);
      flag.data.set(hit.subarray(0, dst.attrs.point.count));
    }
    return { out: [makeGeometryItem(dst)] };
  },
});

/** Params of {@link attributeReduce}. */
export interface AttributeReduceParams {
  name: string;
  domain: string;
  mode: string;
  outName: string;
}

/** Reduce an attribute across a domain into one detail-domain value. */
export const attributeReduce = standardNode<AttributeReduceParams>({
  type: "attributeReduce",
  category: "attribute",
  description:
    "Collapses a numeric attribute over a whole domain into a single value on the detail domain: sum, min, max, average (all f32, componentwise, keeping the source tuple size) or count (u32, the number of elements — this mode reads no attribute). NaN elements are ignored by every mode, and average divides by however many were left, so one bad element cannot destroy the statistic; this is the deliberate difference from promoteAttribute point->detail, which propagates NaN. The other difference is outName: two reductions of one attribute (a min AND a max) can coexist, which promoting cannot do because both would land on the same detail name. Over an empty domain sum and average are 0, min is Infinity, max is -Infinity, count is 0. Note that a detail attribute is NOT readable from a point-domain field (a field reads the domain it lands on), so a reduction is for hosts, inspection and cook-stat reporting — to rescale an attribute by its own observed range use attributeRemap's 'fit' mode, which measures it internally.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    name: {
      type: "string",
      default: "density",
      description:
        "Numeric attribute to reduce (tuple 1..4). Must exist on `domain`. Ignored by mode 'count', which counts elements and may leave this empty.",
    },
    domain: {
      type: "enum",
      default: "point",
      enum: [...DOMAIN_ENUM],
      description: "Domain to reduce over: point, vertex, primitive, or detail (one element).",
    },
    mode: {
      type: "enum",
      default: "max",
      enum: ["sum", "min", "max", "average", "count"],
      description:
        "How the elements collapse: sum, min, max, average (each componentwise over the tuple, NaN elements skipped), or count (how many elements the domain has, ignoring `name`).",
    },
    outName: {
      type: "string",
      default: "",
      description:
        "Name of the detail attribute to write. Empty (the default) reuses `name`, which is what promoting would have produced; give distinct names to hold several reductions of one attribute at once. The shape is this node's to pick (f32 at the source's tuple size, or u32 for mode 'count'), so a name the DETAIL domain already holds under a different shape is REFUSED rather than deleted and re-added — writing it would destroy that column while the cook still looked fine. A same-shape column is reused and reset. The one exception is reducing a detail attribute into its own name: there the column replaced is the column read, so it converts in place.",
    },
  },
  execute({ inputs, params }) {
    const geo = cloneGeometry(requireGeometry(inputs, "in", "attributeReduce"));
    const domain = params.domain as Domain;
    const set = geo.attrs[domain];
    const mode = params.mode;
    const outName = params.outName !== "" ? params.outName : params.name;
    if (outName === "") {
      throw new Error(
        `attributeReduce: no output name — mode "${mode}" left \`name\` empty and \`outName\` is empty too; set outName to the detail attribute the result should be written to`,
      );
    }
    if (mode === "count") {
      // Mode count reads no attribute, so there is no in-place case here:
      // whatever sits under `outName` is destroyed, not rewritten from
      // itself. Checked before the write, which is the whole node.
      requireReportSlot({
        attrs: geo.attrs.detail,
        nodeType: "attributeReduce",
        param: "outName",
        name: outName,
        type: "u32",
        tupleSize: 1,
        domain: "detail",
        suggestion: `${outName}_count`,
      });
      geo.attrs.detail.replace(outName, "u32", 1, 0).set(0, set.count);
      return { out: [makeGeometryItem(geo)] };
    }
    const attr = set.get(params.name);
    if (!attr) {
      throw new Error(
        `attributeReduce: ${domain} attribute "${params.name}" not found; available: ${set.names().join(", ") || "(none)"}`,
      );
    }
    if (attr.type === "string") {
      throw new Error(
        `attributeReduce: attribute "${params.name}" is a string attribute and cannot be reduced with mode "${mode}"; reduce a numeric attribute (f32/i32/u32/bool), or use mode "count"`,
      );
    }
    if (attr.tupleSize > 4) {
      throw new Error(
        `attributeReduce: attribute "${params.name}" has tupleSize ${attr.tupleSize}; reduction supports tuple sizes 1 to 4`,
      );
    }
    const ts = attr.tupleSize;
    // Checked once the written shape is known (it is the source's tuple
    // size) and before the accumulation, so a refusal costs nothing. The
    // one existing column this MAY replace is the source itself, which only
    // happens when the reduction reads the detail domain it writes: there
    // the single element is rewritten from its own value, so `replace`
    // converts rather than destroys.
    requireReportSlot({
      attrs: geo.attrs.detail,
      nodeType: "attributeReduce",
      param: "outName",
      name: outName,
      type: "f32",
      tupleSize: ts,
      domain: "detail",
      suggestion: `${outName}_${mode}`,
      source: attr,
    });
    const n = set.count;
    const data = attr.data;
    // Accumulate in float64 regardless of the source type, so a long f32
    // sum does not lose the tail.
    const acc = new Float64Array(ts);
    const kept = new Uint32Array(ts);
    if (mode === "min") acc.fill(Number.POSITIVE_INFINITY);
    else if (mode === "max") acc.fill(Number.NEGATIVE_INFINITY);
    for (let i = 0; i < n; i++) {
      const o = i * ts;
      for (let k = 0; k < ts; k++) {
        const v = data[o + k];
        // NaN is skipped, not propagated: `v !== v` is the NaN test that
        // does not depend on Number.isNaN's argument coercion.
        if (v !== v) continue;
        kept[k]++;
        if (mode === "min") {
          if (v < acc[k]) acc[k] = v;
        } else if (mode === "max") {
          if (v > acc[k]) acc[k] = v;
        } else {
          acc[k] += v;
        }
      }
    }
    const out = geo.attrs.detail.replace(outName, "f32", ts, 0);
    for (let k = 0; k < ts; k++) {
      out.set(0, mode === "average" ? (kept[k] === 0 ? 0 : acc[k] / kept[k]) : acc[k], k);
    }
    return { out: [makeGeometryItem(geo)] };
  },
});

/** Params of {@link attributeRemap}. */
export interface AttributeRemapParams {
  name: string;
  outName: string;
  domain: string;
  mode: string;
  inMin: number;
  inMax: number;
  outMin: number;
  outMax: number;
  clamp: boolean;
}

/** Rescale an attribute from one numeric range to another. */
export const attributeRemap = standardNode<AttributeRemapParams>({
  type: "attributeRemap",
  category: "attribute",
  description:
    "Rescales a numeric attribute linearly from an input range to an output range, writing f32. Mode 'range' uses inMin/inMax as given — the hand-tuned remap(x, -1, 1, 0, 1) that every noise-driven graph writes. Mode 'fit' MEASURES the attribute's own range over the domain first (ignoring NaN) and uses that, which is what turns any invented quantity — a neighbor count, a hand-built score — into a usable 0..1 density or color input without knowing its scale in advance; it is also why this node needs no help from attributeReduce, whose detail-domain output no field or param could have read back anyway. An empty input range (inMin == inMax, or a fit over zero usable elements) maps everything to outMin, matching the `remap` field function. Tuples remap componentwise against one shared range, and NaN stays NaN in every mode — including the empty-range case, so unmeasurable data never turns into a valid-looking value. Reversed output ranges are fine and invert the values.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    name: {
      type: "string",
      default: "density",
      description: "Numeric attribute to rescale (tuple 1..4). Must exist on `domain`.",
    },
    outName: {
      type: "string",
      default: "",
      description:
        "Name of the f32 attribute to write on the same domain. Empty (the default) rewrites `name` in place, which also converts an integer attribute to f32. Writing over a DIFFERENT attribute that already exists with another shape is REFUSED rather than deleted and re-added — remapping into an i32 `id` or into `P` would destroy that column while the cook still looked fine. A same-shape column is reused, and the in-place conversion above stays legal because there the column replaced is the one being read.",
    },
    domain: {
      type: "enum",
      default: "point",
      enum: [...DOMAIN_ENUM],
      description: "Domain the attribute lives on: point, vertex, primitive, or detail.",
    },
    mode: {
      type: "enum",
      default: "range",
      enum: ["range", "fit"],
      description:
        "'range' takes the input range from inMin/inMax; 'fit' measures the attribute's actual minimum and maximum over the domain and ignores inMin/inMax.",
    },
    inMin: {
      type: "f32",
      default: -1,
      description: "Value mapped to outMin, in mode 'range'. Ignored in mode 'fit'.",
    },
    inMax: {
      type: "f32",
      default: 1,
      description: "Value mapped to outMax, in mode 'range'. Ignored in mode 'fit'.",
    },
    outMin: { type: "f32", default: 0, description: "Value inMin maps to." },
    outMax: { type: "f32", default: 1, description: "Value inMax maps to." },
    clamp: {
      type: "bool",
      default: false,
      description:
        "Hold results inside the output range (whichever of outMin/outMax is smaller or larger). False (the default) extrapolates, matching the `remap` field function; true is the usual choice when the result feeds density or color. In mode 'fit' it only affects NaN-free data trivially, since fitted values already land inside the range.",
    },
  },
  execute({ inputs, params }) {
    const geo = cloneGeometry(requireGeometry(inputs, "in", "attributeRemap"));
    const domain = params.domain as Domain;
    const set = geo.attrs[domain];
    const attr = set.get(params.name);
    if (!attr) {
      throw new Error(
        `attributeRemap: ${domain} attribute "${params.name}" not found; available: ${set.names().join(", ") || "(none)"}`,
      );
    }
    if (attr.type === "string") {
      throw new Error(
        `attributeRemap: attribute "${params.name}" is a string attribute and has no numeric range; remap a numeric attribute (f32/i32/u32/bool)`,
      );
    }
    if (attr.tupleSize > 4) {
      throw new Error(
        `attributeRemap: attribute "${params.name}" has tupleSize ${attr.tupleSize}; remapping supports tuple sizes 1 to 4`,
      );
    }
    const ts = attr.tupleSize;
    const outName = params.outName !== "" ? params.outName : params.name;
    // The narrower rule this node needs. The result is always f32, so the
    // blanket reporting-slot refusal would outlaw the conversion `outName`
    // documents: an empty outName rewrites `name` itself, which is how an
    // i32/u32 attribute (a neighbour count, an id) becomes an f32 density.
    // `source: attr` is what separates the two — the write lands on the
    // very column that was just read, so `replace` converts it instead of
    // deleting someone else's data. Every other differently-shaped column
    // is still refused, including one of the same tuple size under a
    // different name (an i32 `id`), which the write would silently erase.
    // Checked before the fit pass and the value loop: a refusal costs
    // nothing.
    requireReportSlot({
      attrs: set,
      nodeType: "attributeRemap",
      param: "outName",
      name: outName,
      type: "f32",
      tupleSize: ts,
      domain,
      suggestion: `${outName}_remap`,
      source: attr,
    });
    const n = set.count;
    const source = attr.data;
    let inMin = params.inMin;
    let inMax = params.inMax;
    if (params.mode === "fit") {
      inMin = Number.POSITIVE_INFINITY;
      inMax = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < n * ts; i++) {
        // NaN needs no test of its own: both comparisons are false for it,
        // so it can never become the measured minimum or maximum.
        const v = source[i];
        if (v < inMin) inMin = v;
        if (v > inMax) inMax = v;
      }
      // Nothing usable (empty domain, or every element NaN): an empty
      // range, which the span-0 rule below handles. Currently this cannot
      // change an output — it fires only when no element is finite, and
      // those elements are all NaN, which both paths map to NaN (verified
      // over every input family: all-NaN, empty, ±Infinity, mixed). It
      // stays because without it correctness rests on
      // (v - Infinity) / -Infinity being NaN, and because it is what keeps
      // the branch honest if the NaN rule below ever changes.
      if (inMin > inMax) {
        inMin = 0;
        inMax = 0;
      }
    }
    const span = inMax - inMin;
    const outMin = params.outMin;
    const outMax = params.outMax;
    const lo = Math.min(outMin, outMax);
    const hi = Math.max(outMin, outMax);
    const clamp = params.clamp;
    // Read every source value before replacing: an in-place remap of an
    // f32 attribute reuses the same storage.
    const values = new Float64Array(n * ts);
    for (let i = 0; i < n * ts; i++) {
      const v = source[i];
      // NaN survives the empty-range shortcut too: turning unmeasurable
      // data into a valid-looking outMin would hide it from every
      // downstream test.
      let mapped =
        span === 0
          ? v !== v
            ? v
            : outMin
          : outMin + ((v - inMin) / span) * (outMax - outMin);
      if (clamp) {
        if (mapped < lo) mapped = lo;
        else if (mapped > hi) mapped = hi;
      }
      values[i] = mapped;
    }
    const target = set.replace(outName, "f32", ts, 0);
    const data = target.data;
    for (let i = 0; i < n * ts; i++) data[i] = values[i];
    return { out: [makeGeometryItem(geo)] };
  },
});

/** Params of {@link removeAttribute}. */
export interface RemoveAttributeParams {
  names: readonly string[];
  domain: string;
  strict: boolean;
}

/** Delete attributes from a domain. */
export const removeAttribute = standardNode<RemoveAttributeParams>({
  type: "removeAttribute",
  category: "attribute",
  description:
    "Deletes named attributes from one domain. Every idiom that carries a value between nodes — a scratch column feeding a filter, a parameter attribute read back by a field, a hit marker recovered from a transfer — leaves that column on the output forever; this is the only way to take it off again. Unknown names are an error by default, so a typo does not silently leave the debris it was meant to remove; set strict false when a name may legitimately be absent. Removing the point attribute \"P\" is refused: it is the position every downstream node reads, and dropping it turns a clear failure here into an obscure one later.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    names: {
      type: "stringList",
      default: [],
      description:
        "Attribute names to delete, in any order. An empty list removes nothing (and is not an error, so a graph can leave the node in place with nothing to clean).",
    },
    domain: {
      type: "enum",
      default: "point",
      enum: [...DOMAIN_ENUM],
      description: "Domain to delete from: point, vertex, primitive, or detail.",
    },
    strict: {
      type: "bool",
      default: true,
      description:
        "Error when a listed name does not exist on the domain, naming the available attributes. False makes removal best-effort and skips missing names.",
    },
  },
  execute({ inputs, params }) {
    const geo = cloneGeometry(requireGeometry(inputs, "in", "removeAttribute"));
    const domain = params.domain as Domain;
    const set = geo.attrs[domain];
    for (const name of params.names) {
      if (domain === "point" && name === "P") {
        throw new Error(
          'removeAttribute: refusing to remove the point attribute "P" — it holds the positions every downstream node reads; remove the derived attribute instead, or build a fresh geometry',
        );
      }
      if (!set.remove(name) && params.strict) {
        throw new Error(
          `removeAttribute: ${domain} attribute "${name}" not found; available: ${set.names().join(", ") || "(none)"} (set strict false to skip names that may be absent)`,
        );
      }
    }
    return { out: [makeGeometryItem(geo)] };
  },
});

/** Params of {@link partitionByAttribute}. */
export interface PartitionByAttributeParams {
  name: string;
}

/** Split one geometry into per-value point clouds, tagged. */
export const partitionByAttribute = standardNode<PartitionByAttributeParams>({
  type: "partitionByAttribute",
  category: "attribute",
  description:
    "Splits the input into one point cloud per distinct value of an i32, u32, or string point attribute (tuple 1). The output collection holds the groups in order of each value's first occurrence; every group carries all point attributes and is tagged `<name>=<value>` (plus the input's tags) so downstream nodes can route by tag.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    name: {
      type: "string",
      default: "name",
      description: "Point attribute to partition by. Must be i32, u32, or string with tuple size 1.",
    },
  },
  execute({ inputs, params }) {
    // Partitioning a partition (or a subgraph forwarding several
    // geometries) used to silently keep only the first group. This node
    // SPLITS a collection, so being handed one is the case most likely to
    // look deliberate and be wrong.
    const item = requireGeometryItem(inputs, "in", "partitionByAttribute");
    const geo = item.geo;
    const attr = geo.attrs.point.get(params.name);
    if (!attr) {
      throw new Error(
        `partitionByAttribute: point attribute "${params.name}" not found; available: ${geo.attrs.point.names().join(", ")}`,
      );
    }
    if (attr.tupleSize !== 1 || (attr.type !== "i32" && attr.type !== "u32" && attr.type !== "string")) {
      throw new Error(
        `partitionByAttribute: attribute "${params.name}" must be i32, u32, or string with tuple size 1 (got ${attr.type} tuple ${attr.tupleSize})`,
      );
    }
    // Group point indices by value, in first-occurrence order (Map keeps
    // insertion order).
    const groups = new Map<number | string, number[]>();
    const isString = attr.type === "string";
    for (let i = 0; i < geo.pointCount; i++) {
      const key = isString ? attr.getString(i) : attr.data[i];
      let bucket = groups.get(key);
      if (!bucket) groups.set(key, (bucket = []));
      bucket.push(i);
    }
    const out: DataItem[] = [];
    for (const [value, indices] of groups) {
      const tags = new Set(item.tags);
      tags.add(`${params.name}=${value}`);
      out.push(makeGeometryItem(gatherPoints(geo, indices), tags));
    }
    return { out };
  },
});
