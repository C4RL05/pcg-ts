/**
 * Param schemas — the machine-readable description of one node param —
 * and the two pure validators that act on one: is the schema itself
 * well-formed, and is a value legal under it.
 *
 * These live in the graph layer because params are a graph-layer concept:
 * `Graph` stores them, the executor hashes them into memo keys, and
 * subgraph nodes expose them. The node REGISTRY that authors schemas and
 * serves them to agents lives one layer up (`src/nodes`), and imports
 * these types from here — which is what lets a subgraph node carry a
 * resolved schema without the graph layer importing the registry (a
 * layering cycle).
 *
 * Both validators return the message TAIL of the first violation instead
 * of throwing, so each caller prefixes it with whatever names the
 * offender in its own vocabulary (`standardNode "x": param "y" ...`,
 * `node "n" param "p": ...`, `exposed param "count": ...`) and raises its
 * own error type.
 */
import type { DataItem } from "./data.js";

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

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function checkNumberVector(v: unknown, size: number): v is readonly number[] {
  return Array.isArray(v) && v.length === size && v.every(isFiniteNumber);
}

/**
 * @internal First way `schema` is not a well-formed param schema, as a
 * message tail ("must have a non-empty description"), or `undefined` when
 * it is well-formed. Checks the default against the declared type, the
 * enum list, and the bounds.
 */
export function paramSchemaError(schema: ParamSchema): string | undefined {
  if (typeof schema.description !== "string" || schema.description.trim() === "") {
    return "must have a non-empty description";
  }
  const d = schema.default;
  if (schema.enum !== undefined && schema.type !== "enum") {
    return `declares an enum list but has type "${schema.type}" (use type "enum")`;
  }
  switch (schema.type) {
    case "f32":
      if (!isFiniteNumber(d)) return "default must be a finite number";
      break;
    case "i32":
      if (!isFiniteNumber(d) || !Number.isInteger(d)) return "default must be an integer";
      break;
    case "u32":
      if (!isFiniteNumber(d) || !Number.isInteger(d) || d < 0) {
        return "default must be a non-negative integer";
      }
      break;
    case "bool":
      if (typeof d !== "boolean") return "default must be a boolean";
      break;
    case "string":
      if (typeof d !== "string") return "default must be a string";
      break;
    case "enum": {
      const values = schema.enum;
      if (!Array.isArray(values) || values.length === 0 || !values.every((v) => typeof v === "string")) {
        return "must declare a non-empty `enum` list of strings";
      }
      if (typeof d !== "string" || !(values as string[]).includes(d)) {
        return `default must be one of: ${(values as string[]).join(", ")}`;
      }
      break;
    }
    case "vec3":
      if (!checkNumberVector(d, 3)) return "default must be an array of 3 finite numbers";
      break;
    case "vec4":
      if (!checkNumberVector(d, 4)) return "default must be an array of 4 finite numbers";
      break;
    case "items":
      if (!Array.isArray(d) || d.length !== 0) {
        return "default must be an empty array ([]) — DataItems are injected at runtime and are never part of a schema default";
      }
      if (schema.acceptsField === true) {
        return "cannot accept fields — item lists carry runtime DataItems, not per-element values";
      }
      if (schema.min !== undefined || schema.max !== undefined) {
        return "cannot declare min/max — item lists have no numeric bounds";
      }
      break;
    case "stringList":
      if (!Array.isArray(d) || !d.every((v) => typeof v === "string")) {
        return "default must be an array of strings ([] for an empty list)";
      }
      if (schema.acceptsField === true) {
        return "cannot accept fields — string lists are authoring data, not per-element values";
      }
      if (schema.min !== undefined || schema.max !== undefined) {
        return "cannot declare min/max — string lists have no numeric bounds";
      }
      break;
    default:
      return `has unknown type "${(schema as { type: string }).type}"`;
  }
  for (const bound of ["min", "max"] as const) {
    const b = schema[bound];
    if (b === undefined) continue;
    if (!isFiniteNumber(b)) return `${bound} must be a finite number`;
    const components = typeof d === "number" ? [d] : Array.isArray(d) ? d.filter(isFiniteNumber) : undefined;
    if (components) {
      for (const c of components) {
        if (bound === "min" && c < b) return `default ${c} is below min ${b}`;
        if (bound === "max" && c > b) return `default ${c} is above max ${b}`;
      }
    }
  }
  return undefined;
}

/**
 * @internal First way a plain (non-field) `value` violates `schema`, as a
 * message tail ("expected an integer, got 1.5"), or `undefined` when it is
 * legal. Field values are the caller's business — see
 * {@link ParamSchema.acceptsField}.
 */
export function paramValueError(schema: ParamSchema, value: unknown): string | undefined {
  const numberError = (label: string): string | undefined =>
    typeof value !== "number" || !Number.isFinite(value)
      ? `expected ${label}, got ${JSON.stringify(value)}`
      : undefined;
  const boundsError = (nums: readonly number[]): string | undefined => {
    for (const v of nums) {
      if (schema.min !== undefined && v < schema.min) {
        return `${v} is below the minimum ${schema.min}`;
      }
      if (schema.max !== undefined && v > schema.max) {
        return `${v} is above the maximum ${schema.max}`;
      }
    }
    return undefined;
  };
  switch (schema.type) {
    case "f32":
      return numberError("a finite number") ?? boundsError([value as number]);
    case "i32": {
      const bad = numberError("an integer");
      if (bad !== undefined) return bad;
      const v = value as number;
      if (!Number.isInteger(v)) return `expected an integer, got ${v}`;
      return boundsError([v]);
    }
    case "u32": {
      const bad = numberError("a non-negative integer");
      if (bad !== undefined) return bad;
      const v = value as number;
      if (!Number.isInteger(v) || v < 0) return `expected a non-negative integer, got ${v}`;
      return boundsError([v]);
    }
    case "bool":
      return typeof value !== "boolean"
        ? `expected a boolean, got ${JSON.stringify(value)}`
        : undefined;
    case "string":
      return typeof value !== "string"
        ? `expected a string, got ${JSON.stringify(value)}`
        : undefined;
    case "enum": {
      const valid = schema.enum ?? [];
      if (typeof value !== "string" || !valid.includes(value)) {
        return `expected one of ${valid.map((v) => `"${v}"`).join(", ")}, got ${JSON.stringify(value)}`;
      }
      return undefined;
    }
    case "vec3":
    case "vec4": {
      const size = schema.type === "vec3" ? 3 : 4;
      if (
        !Array.isArray(value) ||
        value.length !== size ||
        !value.every((v) => typeof v === "number" && Number.isFinite(v))
      ) {
        return `expected an array of ${size} finite numbers, got ${JSON.stringify(value)}`;
      }
      return boundsError(value as number[]);
    }
    case "items":
      return !Array.isArray(value) || value.length !== 0
        ? `item lists are not serialized — live DataItems are injected at runtime (bind them with graph.setParam after deserializing); expected an empty array [], got ${JSON.stringify(value)}`
        : undefined;
    case "stringList":
      // Unlike `items`, string lists are authoring data: their contents
      // serialize with the graph.
      return !Array.isArray(value) || !value.every((v) => typeof v === "string")
        ? `expected an array of strings, got ${JSON.stringify(value)}`
        : undefined;
  }
  return undefined;
}
