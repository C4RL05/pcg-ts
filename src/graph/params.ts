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
  /**
   * Whether ±Infinity is a MEANINGFUL plain value for this param, not a
   * broken one — an axis of a box that should not be bounded is the case
   * this exists for (`filterByBounds.boundsMin`, whose own description
   * says to write `-Infinity` there). `f32`, `vec3` and `vec4` only. NaN
   * is never admitted, and a declared `min`/`max` still binds, so a
   * bounded param admits only the infinity its bounds leave room for.
   *
   * A LIVE-graph permission only. JSON has no infinity literal —
   * `JSON.stringify(Infinity)` is `null` — so {@link paramValueError},
   * which is the serialization rule, ignores this flag and keeps refusing
   * the value: a graph that saved one would fail to load. Which is why
   * the gap and the feature are the same gap, and why the two checks are
   * two functions.
   */
  readonly acceptsInfinite?: boolean;
}

/**
 * One graph-scoped param: a value declared once on the graph and read by
 * name from any node's field expression.
 *
 * The shape is the inline `param` spec node's, minus `fn` — a graph-scoped
 * param IS an inline value hoisted out of one expression so several can
 * share it, so it carries the same five keys and derives the same schema
 * from them. It holds a LITERAL and never an expression: a value that can
 * compute is a node, and a param referring to another param would need a
 * topological order and cycle detection for no caller that has asked.
 */
export interface GraphParam {
  /** Read by `{"fn":"param","name":…}`. Dot-free, and never `$`-prefixed. */
  readonly name: string;
  /** A finite number, or a non-empty tuple of them. */
  readonly value: number | readonly number[];
  readonly min?: number;
  readonly max?: number;
  /** What turning it does, in the graph rather than in a panel beside it. */
  readonly description?: string;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Why `param` is not a legal graph-scoped param, or undefined.
 *
 * The name rules are the two the addressing depends on. A `.` would make
 * `"$name"` ambiguous against the node forms a knob key splits from the
 * right (`<node>.<param>` and `<node>.<param>.<fieldParam>`), and a leading
 * `$` would let `$$x` exist — the sigil appears exactly once or the address
 * stops being readable.
 */
export function graphParamError(param: GraphParam, who: string): string | undefined {
  const { name, value } = param;
  if (typeof name !== "string" || name === "") {
    return `${who}: a graph param needs a non-empty string name, got ${JSON.stringify(name)}`;
  }
  if (name.includes(".")) {
    return `${who}: graph param name ${JSON.stringify(name)} contains a "."; a knob addresses a graph param as "$<name>" and a node param as "<node>.<param>", so a dot in the name would make the address ambiguous`;
  }
  if (name.startsWith("$")) {
    return `${who}: graph param name ${JSON.stringify(name)} starts with "$"; that sigil is the address's own ("$${name.slice(1)}"), so the name carries it exactly once and never itself`;
  }
  if (!isFiniteNumber(value)) {
    if (!Array.isArray(value) || value.length === 0 || !value.every(isFiniteNumber)) {
      return `${who}: graph param "${name}" must hold a finite number or a non-empty array of finite numbers, got ${JSON.stringify(value)}`;
    }
    // A width the param vocabulary cannot name has no schema, and a
    // declaration nothing can describe is one nothing can address: it would
    // bind into the expressions silently and then be missing from every
    // knob listing. The grammar takes any run of numbers INSIDE a spec, so
    // this is stricter than an inline value — deliberately, because a
    // declaration is a promise that the value is turnable.
    if (value.length !== 3 && value.length !== 4) {
      return `${who}: graph param "${name}" holds ${value.length} number${value.length === 1 ? "" : "s"}, which the param vocabulary cannot name — declare a single number, a vec3 or a vec4, since a declared param has to be describable to be addressable`;
    }
  }
  const { min, max } = param;
  if (min !== undefined && max !== undefined && min > max) {
    return `${who}: graph param "${name}" declares min ${min} above max ${max}, a range no value satisfies`;
  }
  // The GRAPH enforces its own declared range, because nothing else can.
  // An inline `param` declares its bounds INSIDE the spec, so the grammar
  // refuses there on every rebuild; a hoisted one has no spec of its own,
  // and a knob free to write past its declared max would make the range a
  // decoration rather than a rule. Componentwise for a tuple, the way a
  // vec param's bounds already read.
  const components = typeof value === "number" ? [value] : value;
  for (const component of components) {
    if ((min !== undefined && component < min) || (max !== undefined && component > max)) {
      return `${who}: graph param "${name}" is ${JSON.stringify(value)}, outside its declared range ${min ?? "-∞"}..${max ?? "∞"}`;
    }
  }
  return undefined;
}

/**
 * The declared values as the binding record `fieldFromJson` takes, so a
 * `{"fn":"param","name":…}` reference resolves to the graph's value when
 * the field is BUILT — the only moment a value can reach `Field.key`, and
 * therefore the only moment it can reach a memo key.
 */
export function graphParamBindings(
  params: readonly GraphParam[],
): Readonly<Record<string, number | readonly number[]>> {
  // Null-prototype: a param name is any dot-free non-empty string, which
  // includes `__proto__`, and on a plain object that key is a setter.
  const out = Object.create(null) as Record<string, number | readonly number[]>;
  for (const param of params) out[param.name] = param.value;
  return out;
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
  if (
    schema.acceptsInfinite === true &&
    schema.type !== "f32" &&
    schema.type !== "vec3" &&
    schema.type !== "vec4"
  ) {
    return `declares acceptsInfinite but has type "${schema.type}"; only f32, vec3 and vec4 have an infinity that means anything (an integer type has none, and no other type is a number)`;
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
  return valueError(schema, value, false);
}

/**
 * The body of {@link paramValueError}, with the one axis the two callers
 * disagree on: whether ±Infinity counts as a number. See
 * {@link ParamSchema.acceptsInfinite} for why serialization always says no.
 */
function valueError(schema: ParamSchema, value: unknown, allowInfinite: boolean): string | undefined {
  const okNumber = (v: unknown): v is number =>
    typeof v === "number" && (allowInfinite ? !Number.isNaN(v) : Number.isFinite(v));
  const finite = allowInfinite ? "" : " finite";
  const numberError = (label: string): string | undefined =>
    !okNumber(value) ? `expected ${label}, got ${JSON.stringify(value)}` : undefined;
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
      return numberError(`a${finite} number`) ?? boundsError([value as number]);
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
      if (!Array.isArray(value) || value.length !== size || !value.every(okNumber)) {
        return `expected an array of ${size}${finite} numbers, got ${JSON.stringify(value)}`;
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

/**
 * @internal First way a plain (non-field) `value` violates `schema` on a
 * LIVE graph — `Graph.add`, `Graph.setParam`, an exposed param resolved
 * into a subgraph body — as a message tail, or `undefined` when it is
 * legal.
 *
 * The rules of {@link paramValueError}, minus the ones that are about the
 * JSON rather than about the cook, plus the one the JSON cannot express:
 *
 * - an `items` param holds live {@link DataItem}s, injected per cook by a
 *   level's `bind` or by a host; "must be an empty array" is a statement
 *   about the serialized form, not about the graph;
 * - a field-capable NUMERIC param takes any constant a Field could
 *   evaluate to — `FieldLike` in `src/fields` is `number | number[] |
 *   Field` — so a scalar on a `vec3` broadcasts across the tuple and a
 *   tuple on an `f32` is a constant column (`setAttribute.value` with
 *   `tupleSize: 3`, whose arity another param decides). Arity is checked
 *   by the NODE against the domain it lands on, exactly as it must be for
 *   a real field; the component rules and the bounds still apply here;
 * - `acceptsInfinite` admits ±Infinity, which JSON has no literal for.
 *
 * One function rather than a rule per caller, so what `setParam` accepts
 * and what an exposed param accepts cannot drift apart.
 */
export function liveParamValueError(schema: ParamSchema, value: unknown): string | undefined {
  const t = schema.type;
  if (t === "items") return undefined;
  const allowInfinite = schema.acceptsInfinite === true;
  if (schema.acceptsField === true) {
    const vec = t === "vec3" || t === "vec4";
    const scalar = t === "f32" || t === "i32" || t === "u32";
    const components =
      vec && typeof value === "number"
        ? [value]
        : scalar && Array.isArray(value) && value.length > 0
          ? (value as readonly unknown[])
          : undefined;
    if (components !== undefined) {
      const element: ParamSchema = { ...schema, type: vec ? "f32" : t, default: 0 };
      for (const c of components) {
        const bad = valueError(element, c, allowInfinite);
        if (bad !== undefined) return bad;
      }
      return undefined;
    }
  }
  return valueError(schema, value, allowInfinite);
}
