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
 * contents serialize with the graph. `numberList` is its numeric sibling,
 * for a list of numbers that is authoring data too — the weights beside
 * those values. It exists because the alternative was spelling numbers as
 * digit strings (`["4","2","1","2"]`), which asks every reader of the
 * machine-readable schema to learn a convention the type could simply
 * state.
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
  | "stringList"
  | "numberList";

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

/** One node param a graph-scoped param writes into. */
export interface GraphParamTarget {
  readonly node: string;
  readonly param: string;
}

/**
 * One graph-scoped param: a value declared once on the graph, read by name
 * from any node's field expression and — when it declares `targets` —
 * written into named node params outright.
 *
 * WITHOUT TARGETS it is an inline `param` spec node hoisted out of one
 * expression so several can share it, and it carries that node's keys minus
 * `fn`. It reaches only what an expression can reach, which is a number:
 * every field-capable param in the registry is `f32`, `vec3` or `vec4`.
 *
 * WITH TARGETS it reaches the other half of the format — `i32`, `bool`,
 * `string`, `enum`, `stringList`, and non-field vectors — because the value
 * is WRITTEN into the param rather than substituted into an expression. The
 * schema is then DERIVED from the targets' registered schemas and carried
 * in {@link GraphParam.schema}, exactly as a subgraph's exposed param
 * derives its own, and by the same resolver: a declaration can never claim
 * a type or a capability the params it drives do not have.
 *
 * It holds a LITERAL and never an expression, either way: a value that can
 * compute is a node, and a param referring to another param would need a
 * topological order and cycle detection for no caller that has asked.
 */
export interface GraphParam {
  /** Read by `{"fn":"param","name":…}`. Dot-free, and never `$`-prefixed. */
  readonly name: string;
  /**
   * The value. A finite number or a numeric tuple when targetless; anything
   * the targets' merged schema admits when not.
   */
  readonly value: ParamValue;
  /**
   * Node params this writes into, in write order. Absent or empty means the
   * expressions that read the name are its only readers.
   */
  readonly targets?: readonly GraphParamTarget[];
  /**
   * The schema merged from {@link GraphParam.targets}, resolved ABOVE this
   * layer because param schemas live in the node registry and the graph
   * layer may not import it — the same split `ExposedParam` makes. Absent
   * for a targetless param, whose type comes from the value's own shape.
   */
  readonly schema?: ParamSchema;
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
  // A TARGETED param is judged by the schema its targets merged into,
  // because that schema is the whole point: it is how a declaration reaches
  // an `i32` or an `enum`, and the numeric rules below would refuse both.
  // `liveParamValueError` rather than `paramValueError` for the reason
  // `setParam` uses it — this is a live graph, not a serialization.
  if (param.schema !== undefined) {
    const bad = liveParamValueError(param.schema, value);
    return bad === undefined ? undefined : `${who}: graph param "${name}" ${bad}`;
  }
  // Targets declared but not yet resolved: the value is judged when the
  // schema is, and judging it here on the NUMERIC rules would refuse the
  // very values targets exist to carry — a `"xy"` bound for an enum, a
  // `true` for a bool. The reader calls this before the nodes exist and
  // again after resolution, which is the pass that has the schema.
  if (param.targets !== undefined && param.targets.length > 0) return undefined;
  if (!isFiniteNumber(value)) {
    if (!Array.isArray(value) || value.length === 0 || !value.every(isFiniteNumber)) {
      return `${who}: graph param "${name}" must hold a finite number or a non-empty array of finite numbers, got ${JSON.stringify(value)}. A param that drives a non-numeric node param declares "targets" and takes its type from them`;
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
  const components = typeof value === "number" ? [value] : (value as readonly number[]);
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
  for (const param of params) {
    const v = param.value;
    // Only what a field expression can hold. A targeted param may carry a
    // string, a bool or an enum — those reach their node params by being
    // WRITTEN, and an expression naming one stays unbound, which
    // `fieldFromJson` reports against the name the author actually typed.
    if (typeof v === "number" || (Array.isArray(v) && v.every((x) => typeof x === "number"))) {
      out[param.name] = v as number | readonly number[];
    }
  }
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
    case "numberList":
      if (!Array.isArray(d) || !d.every((v) => typeof v === "number" && Number.isFinite(v))) {
        return "default must be an array of finite numbers ([] for an empty list)";
      }
      if (schema.acceptsField === true) {
        return "cannot accept fields — number lists are authoring data, not per-element values";
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
  const bad = valueError(schema, value, false);
  // The advice rides the REFUSAL rather than replacing it: the shape error
  // is still the fact, and this is what to do about it.
  if (bad !== undefined && schema.acceptsField !== true && looksLikeFieldSpec(value)) {
    return bad + fieldSpecAdvice(schema);
  }
  return bad;
}

/**
 * The body of {@link paramValueError}, with the one axis the two callers
 * disagree on: whether ±Infinity counts as a number. See
 * {@link ParamSchema.acceptsInfinite} for why serialization always says no.
 */
/**
 * Is this value an author reaching for a field expression?
 *
 * A plain object carrying a string `fn` is the field grammar's own shape,
 * and nothing else a param may hold looks like it. Recognizing it is what
 * lets the refusal below say something useful instead of quoting the spec
 * back as a malformed number.
 */
function looksLikeFieldSpec(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { fn?: unknown }).fn === "string"
  );
}

/**
 * The sentence a field spec at a non-field param earns, which the bare
 * "expected an integer" does not give.
 *
 * The author has just learned that a name can stand for a value, tried it
 * one param over, and been told only that the shape is wrong. What they
 * cannot know from that is the RULE — every field-capable param in the
 * registry is `f32`, `vec3` or `vec4`, so an `i32`, an `enum`, a `bool` or
 * a `string` is not "not yet" field-capable but structurally never — nor
 * the route that does work, which is to drive the param by NAME from the
 * graph's own `params` block. The body-slot refusal one level down has
 * said as much for a while; this brings the top level up to it.
 */
function fieldSpecAdvice(schema: ParamSchema): string {
  // Spoken, not spelled: "an f32" and "an i32" because the letters are read
  // aloud, "a u32" because that one is not.
  const article = /^[aeiofilmnsx]/.test(schema.type) && !schema.type.startsWith("u") ? "an" : "a";
  const named = `${article} ${schema.type}`;
  return `. ${article === "an" ? "An" : "A"} ${schema.type} param is never field-capable — a field resolves per element and only f32, vec3 and vec4 params read one — so this expression cannot live here. To drive it from one place, declare a graph param with "targets" naming this node and param: its value is WRITTEN into the slot rather than substituted into an expression, which is how a declaration reaches ${named}`;
}

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
    case "numberList":
      // Finite, because a list that serializes must survive JSON, and
      // `JSON.stringify(Infinity)` is `null`. Same rule the numeric
      // scalars keep.
      return !Array.isArray(value) ||
        !value.every((v) => typeof v === "number" && Number.isFinite(v))
        ? `expected an array of finite numbers, got ${JSON.stringify(value)}`
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
