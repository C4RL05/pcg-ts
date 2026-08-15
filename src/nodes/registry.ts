/**
 * Node registry: the standard node library registers machine-readable
 * metadata (description, pins, param schemas) so agents and tools can
 * enumerate the library's capabilities at runtime — without reading
 * source — and so graphs referencing node types by name can be
 * serialized and deserialized (see serialize.ts).
 */
import {
  type NodeDef,
  type NodeExecuteArgs,
  type NodeOutputs,
  type ParamSchema,
  type ParamType,
  type ParamValue,
  type PinDef,
  type PinKind,
  type ResidentDesc,
  paramSchemaError,
} from "../graph/index.js";

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
   * nothing), "sampler" (points from existing geometry), "surface"
   * (builds triangle mesh from curves), "point op" (transforms a point
   * cloud), "filter" (keeps a subset), "attribute"
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
    const bad = paramSchemaError(schema);
    if (bad !== undefined) throw specError(spec.type, `param "${name}" ${bad}`);
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
