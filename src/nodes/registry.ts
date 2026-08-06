/**
 * Node registry: the standard node library registers machine-readable
 * metadata (description, pins, param schemas) so agents and tools can
 * enumerate the library's capabilities at runtime — without reading
 * source — and so graphs referencing node types by name can be
 * serialized and deserialized (see serialize.ts).
 */
import type { DataItem, NodeDef, NodeExecuteArgs, NodeOutputs, PinDef, PinKind, ResidentDesc } from "../graph/index.js";

/**
 * Value kinds a node param can declare in its schema. `items` is a list
 * of runtime-injected {@link DataItem}s (bound via `graph.setParam`, e.g.
 * by the World per cell): its default is always `[]` and serialized
 * graphs carry an empty list — live items are never part of the JSON.
 * `stringList` is an ordered list of strings that is authoring data
 * (e.g. the value list of a string `setAttribute`): unlike `items`, its
 * contents serialize with the graph.
 */
export type ParamType =
  | "f32"
  | "i32"
  | "u32"
  | "bool"
  | "string"
  | "vec3"
  | "vec4"
  | "enum"
  | "items"
  | "stringList";

/** Plain (non-field) values a param can hold. */
export type ParamValue =
  | number
  | boolean
  | string
  | readonly number[]
  | readonly string[]
  | readonly DataItem[];

/**
 * Machine-readable schema of one node param. Descriptions are agent-facing
 * documentation: they state what the param does, its units, and its valid
 * range, so a graph can be authored from `listNodeTypes()` alone.
 */
export interface ParamSchema {
  readonly type: ParamType;
  /** Value a fresh node instance starts with. Must match `type`. */
  readonly default: ParamValue;
  /** What the param does: semantics, units, valid ranges, interactions. */
  readonly description: string;
  /** Valid values, for `enum` params only. */
  readonly enum?: readonly string[];
  /**
   * Whether the param also accepts a `Field`, resolved per element on the
   * geometry it applies to. Serialized graphs carry field values as
   * declarative specs (see fieldJson.ts).
   */
  readonly acceptsField?: boolean;
  /** Inclusive lower bound (componentwise for vec types). */
  readonly min?: number;
  /** Inclusive upper bound (componentwise for vec types). */
  readonly max?: number;
}

/**
 * A node definition plus registry metadata, passed to {@link standardNode}.
 * `defaultParams` is derived from the schemas' `default` values, so the
 * schema is the single source of truth.
 */
export interface NodeSpec<P> {
  /** Node type name; must be unique across the registry. */
  readonly type: string;
  /** What the node does — agent-facing documentation. */
  readonly description: string;
  /**
   * Optional grouping label for palettes and generated docs. Short and
   * lowercase; the standard library uses "source" (emits points from
   * nothing), "sampler" (points from existing geometry), "point op"
   * (transforms a point cloud), "filter" (keeps a subset), "attribute"
   * (attribute create/promote/transfer), "value" (plain value plumbing),
   * "spawn" (graph terminals emitting instances), "io" (runtime data
   * bridges), and "composite" (nodes wrapping inner graphs). Omit it to
   * leave a type uncategorized (valid for third-party nodes; tools fall
   * back to their own grouping).
   */
  readonly category?: string;
  readonly inputs: readonly PinDef[];
  readonly outputs: readonly PinDef[];
  /** One schema per param; keys must exactly match `P`. */
  readonly params: { readonly [K in keyof P]-?: ParamSchema };
  execute(args: NodeExecuteArgs<P>): NodeOutputs | Promise<NodeOutputs>;
  memoKey?(): string;
  /** GPU adoption declaration, copied onto the def; see {@link NodeDef.gpu}. */
  readonly gpu?: "fields" | "always";
  /** Resident-fusion declaration, copied onto the def; see {@link NodeDef.resident}. */
  readonly resident?: ResidentDesc<P>;
}

/** JSON-safe pin metadata. */
export interface PinInfo {
  readonly name: string;
  readonly kind: PinKind;
  readonly multi: boolean;
}

/** JSON-safe metadata of one registered node type. */
export interface NodeTypeInfo {
  readonly type: string;
  readonly description: string;
  /** Grouping label (see {@link NodeSpec.category}); absent when the type declared none. */
  readonly category?: string;
  readonly inputs: readonly PinInfo[];
  readonly outputs: readonly PinInfo[];
  readonly params: Record<string, ParamSchema>;
}

/** A registered node type: the executable def plus its JSON-safe metadata. */
export interface RegisteredNodeType {
  readonly def: NodeDef<Record<string, unknown>>;
  readonly info: NodeTypeInfo;
}

const registry = new Map<string, RegisteredNodeType>();

function specError(type: string, message: string): Error {
  return new Error(`standardNode "${type}": ${message}`);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function checkNumberVector(v: unknown, size: number): v is readonly number[] {
  return Array.isArray(v) && v.length === size && v.every(isFiniteNumber);
}

function validateSchema(type: string, name: string, schema: ParamSchema): void {
  const fail = (msg: string): never => {
    throw specError(type, `param "${name}" ${msg}`);
  };
  if (typeof schema.description !== "string" || schema.description.trim() === "") {
    fail("must have a non-empty description");
  }
  const d = schema.default;
  if (schema.enum !== undefined && schema.type !== "enum") {
    fail(`declares an enum list but has type "${schema.type}" (use type "enum")`);
  }
  switch (schema.type) {
    case "f32":
      if (!isFiniteNumber(d)) fail("default must be a finite number");
      break;
    case "i32":
      if (!isFiniteNumber(d) || !Number.isInteger(d)) fail("default must be an integer");
      break;
    case "u32":
      if (!isFiniteNumber(d) || !Number.isInteger(d) || (d as number) < 0) {
        fail("default must be a non-negative integer");
      }
      break;
    case "bool":
      if (typeof d !== "boolean") fail("default must be a boolean");
      break;
    case "string":
      if (typeof d !== "string") fail("default must be a string");
      break;
    case "enum": {
      const values = schema.enum;
      if (!Array.isArray(values) || values.length === 0 || !values.every((v) => typeof v === "string")) {
        fail("must declare a non-empty `enum` list of strings");
      }
      if (typeof d !== "string" || !(values as string[]).includes(d)) {
        fail(`default must be one of: ${(values as string[]).join(", ")}`);
      }
      break;
    }
    case "vec3":
      if (!checkNumberVector(d, 3)) fail("default must be an array of 3 finite numbers");
      break;
    case "vec4":
      if (!checkNumberVector(d, 4)) fail("default must be an array of 4 finite numbers");
      break;
    case "items":
      if (!Array.isArray(d) || d.length !== 0) {
        fail(
          "default must be an empty array ([]) — DataItems are injected at runtime and are never part of a schema default",
        );
      }
      if (schema.acceptsField === true) {
        fail("cannot accept fields — item lists carry runtime DataItems, not per-element values");
      }
      if (schema.min !== undefined || schema.max !== undefined) {
        fail("cannot declare min/max — item lists have no numeric bounds");
      }
      break;
    case "stringList":
      if (!Array.isArray(d) || !d.every((v) => typeof v === "string")) {
        fail("default must be an array of strings ([] for an empty list)");
      }
      if (schema.acceptsField === true) {
        fail("cannot accept fields — string lists are authoring data, not per-element values");
      }
      if (schema.min !== undefined || schema.max !== undefined) {
        fail("cannot declare min/max — string lists have no numeric bounds");
      }
      break;
    default:
      fail(`has unknown type "${(schema as { type: string }).type}"`);
  }
  for (const bound of ["min", "max"] as const) {
    const b = schema[bound];
    if (b === undefined) continue;
    if (!isFiniteNumber(b)) fail(`${bound} must be a finite number`);
    const components = typeof d === "number" ? [d] : Array.isArray(d) ? d.filter(isFiniteNumber) : undefined;
    if (components) {
      for (const c of components) {
        if (bound === "min" && c < b) fail(`default ${c} is below min ${b}`);
        if (bound === "max" && c > b) fail(`default ${c} is above max ${b}`);
      }
    }
  }
}

function copyParamValue(v: ParamValue): ParamValue {
  return Array.isArray(v) ? ([...v] as ParamValue) : v;
}

function copySchema(schema: ParamSchema): ParamSchema {
  const copy: {
    type: ParamType;
    default: ParamValue;
    description: string;
    enum?: readonly string[];
    acceptsField?: boolean;
    min?: number;
    max?: number;
  } = {
    type: schema.type,
    default: copyParamValue(schema.default),
    description: schema.description,
  };
  if (schema.enum !== undefined) copy.enum = [...schema.enum];
  if (schema.acceptsField !== undefined) copy.acceptsField = schema.acceptsField;
  if (schema.min !== undefined) copy.min = schema.min;
  if (schema.max !== undefined) copy.max = schema.max;
  return copy;
}

function copyPins(pins: readonly PinDef[]): PinInfo[] {
  return pins.map((p) => ({ name: p.name, kind: p.kind, multi: p.multi === true }));
}

/**
 * Validate a node spec (non-empty descriptions, complete param schemas,
 * defaults matching schema types), register it in the global registry,
 * and return its executable {@link NodeDef}. `defaultParams` is built
 * from the schemas. Duplicate type names throw.
 */
export function standardNode<P>(spec: NodeSpec<P>): NodeDef<P> {
  if (typeof spec.type !== "string" || spec.type.trim() === "") {
    throw new Error("standardNode: spec.type must be a non-empty string");
  }
  if (registry.has(spec.type)) {
    throw specError(spec.type, "a node type with this name is already registered");
  }
  if (typeof spec.description !== "string" || spec.description.trim() === "") {
    throw specError(spec.type, "must have a non-empty description");
  }
  if (
    spec.category !== undefined &&
    (typeof spec.category !== "string" || spec.category.trim() === "")
  ) {
    throw specError(
      spec.type,
      "category, when present, must be a non-empty string (omit it to leave the type uncategorized)",
    );
  }
  const defaultParams: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries<ParamSchema>(spec.params)) {
    validateSchema(spec.type, name, schema);
    defaultParams[name] = copyParamValue(schema.default);
  }

  const def: NodeDef<P> = {
    type: spec.type,
    inputs: spec.inputs,
    outputs: spec.outputs,
    defaultParams: defaultParams as P,
    execute: (args) => spec.execute(args),
    ...(spec.memoKey !== undefined ? { memoKey: spec.memoKey.bind(spec) } : {}),
    ...(spec.gpu !== undefined ? { gpu: spec.gpu } : {}),
    ...(spec.resident !== undefined ? { resident: spec.resident } : {}),
  };
  const params: Record<string, ParamSchema> = {};
  for (const [name, schema] of Object.entries<ParamSchema>(spec.params)) {
    params[name] = copySchema(schema);
  }
  registry.set(spec.type, {
    def: def as unknown as NodeDef<Record<string, unknown>>,
    info: {
      type: spec.type,
      description: spec.description,
      ...(spec.category !== undefined ? { category: spec.category } : {}),
      inputs: copyPins(spec.inputs),
      outputs: copyPins(spec.outputs),
      params,
    },
  });
  return def;
}

/**
 * Look up a registered node type by name. Throws an error listing all
 * registered type names when the type is unknown.
 */
export function getNodeType(type: string): RegisteredNodeType {
  const entry = registry.get(type);
  if (!entry) {
    throw new Error(
      `unknown node type "${type}"; registered types: ${[...registry.keys()].sort().join(", ")}`,
    );
  }
  return entry;
}

/** Whether a node type name is registered. */
export function hasNodeType(type: string): boolean {
  return registry.has(type);
}

/**
 * JSON-safe metadata for every registered node type, in registration
 * order: type name, description, category (when declared), pins, and
 * per-param schemas (type, default, description, enum values, field
 * capability, bounds). This is the runtime capability catalog for agents
 * authoring graphs.
 */
export function listNodeTypes(): NodeTypeInfo[] {
  return [...registry.values()].map((entry) => ({
    type: entry.info.type,
    description: entry.info.description,
    ...(entry.info.category !== undefined ? { category: entry.info.category } : {}),
    inputs: copyPins(entry.info.inputs),
    outputs: copyPins(entry.info.outputs),
    params: Object.fromEntries(
      Object.entries(entry.info.params).map(([k, s]) => [k, copySchema(s)]),
    ),
  }));
}
