/**
 * Attribute operation nodes: create/overwrite attributes from fields,
 * promote between domains, transfer between geometries, and partition
 * geometry by attribute value.
 */
import { promote, transferNearest, type AttrType, type Domain, type PromoteMode } from "../data/index.js";
import { cloneGeometry, makeGeometryItem, type DataItem } from "../graph/index.js";
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
}

/** Create or overwrite an attribute from a field. */
export const setAttribute = standardNode<SetAttributeParams>({
  type: "setAttribute",
  description:
    "Creates or overwrites an attribute on the chosen domain and fills it from `value`, which is field-capable and resolves per element of that domain (so it can read position, other attributes, or noise). The evaluated field must be scalar (broadcast across the tuple) or match tupleSize exactly. Values store with the target type's conversion: i32/u32 truncate, bool stores nonzero as 1. String attributes cannot be written this way.",
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
      enum: ["f32", "i32", "u32", "bool"],
      description:
        "Storage type. f32 keeps fractions; i32/u32 truncate toward zero; bool stores 0/1 (nonzero field values become 1).",
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
        "Value written to every element. Field-capable: evaluated on the target domain; scalar results broadcast across the tuple, otherwise the tuple size must match tupleSize.",
    },
  },
  execute({ inputs, params, seed }) {
    const geo = cloneGeometry(requireGeometry(inputs, "in", "setAttribute"));
    const domain = params.domain as Domain;
    const type = params.type as AttrType;
    const ts = params.tupleSize;
    const col = resolveOn(geo, domain, params.value, seed);
    if (col.tupleSize !== 1 && col.tupleSize !== ts) {
      throw new Error(
        `setAttribute: value evaluates to tuple size ${col.tupleSize}, which is neither 1 (broadcast) nor tupleSize ${ts}`,
      );
    }
    const set = geo.attrs[domain];
    const attr = set.replace(params.name, type, ts);
    const data = attr.data;
    const n = set.count;
    const isBool = type === "bool";
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < ts; k++) {
        const v = col.tupleSize === 1 ? col.data[i] : col.data[i * ts + k];
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
}

/** Transfer a point attribute from a source geometry by nearest point. */
export const transferAttribute = standardNode<TransferAttributeParams>({
  type: "transferAttribute",
  description:
    "Copies a point attribute from the `source` geometry onto the main input's points: each destination point takes the value of its nearest source point in 3D (positions read from P; distance ties resolve to the lowest source index). Creates or overwrites the attribute on the output. Accelerated with a uniform grid, so large clouds are fine.",
  inputs: [
    { name: "in", kind: "geometry" },
    { name: "source", kind: "geometry" },
  ],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    name: {
      type: "string",
      default: "density",
      description: "Name of the point attribute to transfer. Must exist on the source's point domain.",
    },
  },
  execute({ inputs, params }) {
    const dst = cloneGeometry(requireGeometry(inputs, "in", "transferAttribute"));
    const src = requireGeometry(inputs, "source", "transferAttribute");
    transferNearest(dst, src, params.name);
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
