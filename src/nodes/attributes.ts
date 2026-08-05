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
  resolveOn,
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
        "Extra seed for evaluating `value`: 0 (the default) uses the node's derived seed unchanged, so pre-existing graphs keep bit-identical output; any nonzero value folds in as hashCombine(nodeSeed, seed), re-rolling field randomness (e.g. randomField). Bind a per-cell value (such as ctx.seed) here for per-cell variation in a World level.",
    },
  },
  execute({ inputs, params, seed: nodeSeed }) {
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
    const col = resolveOn(geo, domain, params.value, seed);
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
}

/** Transfer an attribute from a source geometry (nearest / uv / raycast). */
export const transferAttribute = standardNode<TransferAttributeParams>({
  type: "transferAttribute",
  description:
    "Transfers an attribute from the `source` geometry onto the main input's points, creating or overwriting it on the output's point domain. Mapping 'nearest' copies from the nearest source point in 3D (positions from P; distance ties resolve to the lowest source index; every point is assigned). Mapping 'uv' locates each destination point's UV (see uvAttr) in the source triangulation's UV space and interpolates inside the containing triangle; a UV on an edge shared by two triangles deterministically picks the lowest source primitive index. Mapping 'raycast' casts a normalized ray from each destination point along `direction` (or per-point directionAttr) against the source triangle mesh and interpolates at the nearest forward hit (smallest t >= 0, optionally capped by maxDistance; exactly-equal distances pick the lowest source primitive index). For uv/raycast the source must have 3-vertex 'poly' primitives (createTriangleMesh); zero-area (degenerate) triangles are skipped; f32 attributes interpolate barycentrically while i32/u32/bool/string take the triangle corner with the largest barycentric weight (ties to the first corner in vertex order); destination points with no containing triangle or no hit are misses that keep their prior value (the attribute default when the attribute did not exist) — set missCountAttr to record how many missed. All mappings are accelerated with deterministic uniform grids, so large inputs are fine.",
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
        "When non-empty, writes the number of missed destination points into a u32 detail attribute of this name on the output (mapping 'nearest' always writes 0 — every point is assigned). Empty = don't record.",
    },
  },
  execute({ inputs, params }) {
    const dst = cloneGeometry(requireGeometry(inputs, "in", "transferAttribute"));
    const src = requireGeometry(inputs, "source", "transferAttribute");
    const attrDomain = params.attrDomain as TransferAttrDomain;
    let missCount = 0;
    if (params.mapping === "nearest") {
      if (attrDomain !== "point") {
        throw new Error(
          `transferAttribute: attrDomain "${params.attrDomain}" is only valid for the "uv" and "raycast" mappings — mapping "nearest" transfers point-domain attributes; set attrDomain to "point" or switch mapping`,
        );
      }
      transferNearest(dst, src, params.name);
    } else if (params.mapping === "uv") {
      missCount = transferUv(dst, src, params.name, {
        uvAttr: params.uvAttr,
        attrDomain,
      }).missCount;
    } else if (params.mapping === "raycast") {
      const opts: TransferRaycastOptions = { direction: params.direction, attrDomain };
      if (params.directionAttr !== "") opts.directionAttr = params.directionAttr;
      if (params.maxDistance > 0) opts.maxDistance = params.maxDistance;
      missCount = transferRaycast(dst, src, params.name, opts).missCount;
    } else {
      throw new Error(
        `transferAttribute: unknown mapping "${params.mapping}"; valid mappings: nearest, uv, raycast`,
      );
    }
    if (params.missCountAttr !== "") {
      dst.attrs.detail.replace(params.missCountAttr, "u32", 1).set(0, missCount);
    }
    return { out: [makeGeometryItem(dst)] };
  },
});

/** Params of {@link partitionByAttribute}. */
export interface PartitionByAttributeParams {
  name: string;
}

/** Split one geometry into per-value point clouds, tagged. */
export const partitionByAttribute = standardNode<PartitionByAttributeParams>({
  type: "partitionByAttribute",
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
    const items = geometryItems(inputs.in);
    if (items.length === 0) {
      throw new Error('partitionByAttribute: input pin "in" has no geometry connected');
    }
    const item = items[0];
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
