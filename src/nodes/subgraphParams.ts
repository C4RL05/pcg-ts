/**
 * Exposed params on subgraph nodes: turning an authored DECLARATION —
 * "call this `count`, it drives these inner params" — into the resolved
 * {@link ExposedParam} the graph layer stores and cooks.
 *
 * Resolution lives here, above `src/graph`, because param schemas live in
 * the node registry and the graph layer may not import it. The author
 * supplies only what the targets cannot know (a name, an agent-facing
 * description, optionally a default, optionally NARROWED bounds); `type`,
 * `enum` and `acceptsField` are derived from the targets' own registered
 * schemas and are not overridable, so an exposed param can never claim a
 * capability its inner params do not have.
 */
import { isField } from "../fields/index.js";
import {
  type ExposedParam,
  type ExposedParamTarget,
  type Graph,
  GraphValidationError,
  type NodeHandle,
  type ParamSchema,
  type ParamType,
  type ParamValue,
  getSubgraphSpec,
  paramSchemaError,
} from "../graph/index.js";
import { getNodeType, hasNodeType } from "./registry.js";

/** One inner `(node, param)` slot an exposed param declaration binds. */
export interface ExposedParamTargetDecl {
  /** Handle of the inner node holding the param. */
  readonly node: NodeHandle;
  /** Param name on that inner node. */
  readonly param: string;
}

/**
 * An authored exposed param, before its schema is resolved. Pass the
 * result of {@link resolveExposedParam} to `subgraphNode`'s fourth
 * argument.
 */
export interface ExposedParamDecl {
  /** Param name on the wrapping subgraph node. */
  readonly name: string;
  /**
   * Inner params this one drives, in write order. One target is the
   * common case; several fan one value out, and must then agree on `type`
   * and `enum` (their `acceptsField` is ANDed and their bounds intersect).
   *
   * May be EMPTY, for a param the body's field expressions read by name
   * (`{"fn": "param", "name": "…"}`) instead of one that writes into a
   * param slot. There is then no inner schema to borrow, so `default`
   * becomes required and its SHAPE decides the type: a number is f32, a
   * 3-number array vec3, a 4-number array vec4. Such a param is never
   * field-capable — the value is substituted into the expression as a
   * literal, and a Field is not a literal.
   */
  readonly targets: readonly ExposedParamTargetDecl[];
  /**
   * What the param does at the PRIMITIVE's level of abstraction ("spacing
   * in metres"), not the inner node's wording. Agent-facing, required.
   */
  readonly description: string;
  /**
   * Value a fresh instance starts with. Defaults to the first target's
   * LIVE value at wrap time, so wrapping a tuned graph keeps its tuning
   * instead of snapping back to the inner node's schema default.
   */
  readonly default?: ParamValue;
  /** Inclusive lower bound; may only NARROW the targets' own bound. */
  readonly min?: number;
  /** Inclusive upper bound; may only NARROW the targets' own bound. */
  readonly max?: number;
  /**
   * Assert that the resulting param must accept a `Field`.
   *
   * `acceptsField` is ANDed across targets, which is correct — the exposed
   * schema must never admit a value one target would reject — but silent:
   * fan a knob across one field-capable param and one plain one and it
   * registers cleanly having quietly become non-field-capable, which is
   * usually the entire point of the knob. Set this to `true` and the
   * resolver names the target that refuses instead. Opt-in, like the
   * content hash on a subgraph reference: an author who says it means it.
   */
  readonly acceptsField?: boolean;
}

function bad(name: string, message: string): never {
  throw new GraphValidationError(`exposed param "${name}": ${message}`);
}

/** `"nodeId".param`, the way every error in this module names a target. */
function label(target: ExposedParamTargetDecl): string {
  return `"${target.node.id}".${target.param}`;
}

/**
 * The registered schema of one inner target. A target that is itself a
 * subgraph instance resolves through that instance's own exposed params,
 * which are already merged — so nesting composes without re-deriving.
 */
function targetSchema(inner: Graph, name: string, target: ExposedParamTargetDecl): ParamSchema {
  const state = inner._nodes.get(target.node.id);
  if (state === undefined) {
    bad(
      name,
      `unknown inner node "${target.node.id}"; inner nodes: ${[...inner._nodes.keys()].join(", ") || "(none)"}`,
    );
  }
  const nested = getSubgraphSpec(state.def);
  if (nested !== undefined) {
    const found = nested.params.find((p) => p.name === target.param);
    if (found === undefined) {
      bad(
        name,
        `inner subgraph node "${state.id}" exposes no param "${target.param}"; its exposed params: ${nested.params.map((p) => `"${p.name}"`).join(", ") || "(none)"}`,
      );
    }
    return found.schema;
  }
  if (!hasNodeType(state.def.type)) {
    bad(
      name,
      `inner node "${state.id}" has unregistered type "${state.def.type}"; an exposed param derives its schema from the node registry, so every target's type must be registered via standardNode (or be a subgraph node exposing that param)`,
    );
  }
  const schemas = getNodeType(state.def.type).info.params;
  const schema = schemas[target.param];
  if (schema === undefined) {
    bad(
      name,
      `node "${state.id}" (type "${state.def.type}") has no param "${target.param}"; params: ${Object.keys(schemas).join(", ") || "(none)"}`,
    );
  }
  return schema;
}

function sameEnum(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** How one target constrains the merged range, for the empty-range error. */
function rangeOf(schema: ParamSchema): string {
  const lo = schema.min === undefined ? "-inf" : String(schema.min);
  const hi = schema.max === undefined ? "+inf" : String(schema.max);
  return `[${lo}, ${hi}]`;
}

/**
 * Resolve one exposed-param declaration against the live inner graph:
 * look every target's schema up in the registry, merge them, and settle
 * the default. The result is what `subgraphNode(inner, ins, outs, params)`
 * takes.
 *
 * Merge rules — chosen so the wrapping schema is SOUND, i.e. every value
 * it admits is legal at every target:
 *
 * - `type` and `enum` must be identical across targets (a disagreement is
 *   an error naming both targets, not a silent widening);
 * - `acceptsField` is ANDed: field-capable only if every target is;
 * - `min`/`max` intersect, and an empty intersection is an error;
 * - `description` is authored here and never merged;
 * - `default` is the author's, else the first target's live value.
 *
 * With NO targets there is nothing to merge and the schema is derived from
 * the default's shape instead — see {@link resolveTargetless}. That is the
 * form a param takes when its only reader is a field expression in the
 * body, which has no param slot to write into.
 */
export function resolveExposedParam(inner: Graph, decl: ExposedParamDecl): ExposedParam {
  const name = decl.name;
  if (typeof name !== "string" || name === "") {
    throw new GraphValidationError(
      `exposed param: name must be a non-empty string, got ${JSON.stringify(name)}`,
    );
  }
  if (!Array.isArray(decl.targets)) {
    bad(
      name,
      `"targets" must be an array of { node, param } — pass [] for a param the body's field expressions read by name, got ${JSON.stringify(decl.targets)}`,
    );
  }
  if (decl.targets.length === 0) return resolveTargetless(name, decl);
  const schemas = decl.targets.map((t) => targetSchema(inner, name, t));
  const first = schemas[0];
  const firstTarget = decl.targets[0];

  let acceptsField = first.acceptsField === true;
  let min = first.min;
  let max = first.max;
  for (let i = 1; i < schemas.length; i++) {
    const schema = schemas[i];
    const target = decl.targets[i];
    if (schema.type !== first.type) {
      bad(
        name,
        `targets disagree on type — ${label(firstTarget)} is ${first.type} but ${label(target)} is ${schema.type}; every target of one exposed param must have the same param type (expose them as separate params, or bind only the ${first.type} targets)`,
      );
    }
    if (!sameEnum(first.enum, schema.enum)) {
      bad(
        name,
        `targets disagree on their enum values — ${label(firstTarget)} allows ${(first.enum ?? []).join(", ") || "(none)"} but ${label(target)} allows ${(schema.enum ?? []).join(", ") || "(none)"}; every target of one exposed param must accept exactly the same values`,
      );
    }
    acceptsField &&= schema.acceptsField === true;
    if (schema.min !== undefined) min = min === undefined ? schema.min : Math.max(min, schema.min);
    if (schema.max !== undefined) max = max === undefined ? schema.max : Math.min(max, schema.max);
  }

  // An asserted field capability is checked against every target, not
  // just the merged result, so the message can name WHICH one refuses.
  if (decl.acceptsField === true && !acceptsField) {
    const refusing = decl.targets.filter((_, i) => schemas[i].acceptsField !== true);
    const capable = decl.targets.filter((_, i) => schemas[i].acceptsField === true);
    bad(
      name,
      `declares acceptsField: true, but ${refusing.map(label).join(" and ")} ${refusing.length === 1 ? "does" : "do"} not accept fields${
        capable.length > 0 ? ` (${capable.map(label).join(" and ")} would)` : ""
      }; capability is ANDed across targets, so binding a plain param here would silently make the whole knob field-incapable — drop the assertion, drop the plain target, or expose it separately`,
    );
  }

  // The author may only tighten. A wider bound would admit values some
  // target rejects, which is exactly the near-miss the merge rules exist
  // to prevent — so say so instead of quietly ignoring it.
  if (decl.min !== undefined) {
    if (min !== undefined && decl.min < min) {
      bad(
        name,
        `min ${decl.min} is wider than the targets' own bound ${min}; an exposed bound may only narrow — omit it, or raise it to at least ${min}`,
      );
    }
    min = decl.min;
  }
  if (decl.max !== undefined) {
    if (max !== undefined && decl.max > max) {
      bad(
        name,
        `max ${decl.max} is wider than the targets' own bound ${max}; an exposed bound may only narrow — omit it, or lower it to at most ${max}`,
      );
    }
    max = decl.max;
  }
  if (min !== undefined && max !== undefined && min > max) {
    bad(
      name,
      `the merged bounds are empty — min ${min} is above max ${max}; the targets' ranges do not overlap (${decl.targets.map((t, i) => `${label(t)} ${rangeOf(schemas[i])}`).join(", ")}); bind targets whose ranges overlap, or expose them as separate params`,
    );
  }

  let value = resolveDefault(inner, name, decl, first, firstTarget);
  // Field-capable vec params accept a runtime-legal scalar (tuple-1
  // broadcast); canonicalize a live one to the vec arity so the recorded
  // default always matches the schema, exactly as serialization does.
  if ((first.type === "vec3" || first.type === "vec4") && acceptsField && typeof value === "number") {
    value = new Array<number>(first.type === "vec3" ? 3 : 4).fill(value);
  }

  const schema: ParamSchema = {
    type: first.type,
    default: value,
    description: decl.description,
    ...(first.enum !== undefined ? { enum: [...first.enum] } : {}),
    ...(acceptsField ? { acceptsField: true } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  };
  const schemaBad = paramSchemaError(schema);
  if (schemaBad !== undefined) bad(name, schemaBad);

  const targets: ExposedParamTarget[] = decl.targets.map((t, i) => ({
    node: { id: t.node.id },
    param: t.param,
    // Recorded per target so the cook-time Field check can name exactly
    // which targets refuse one; the merged flag alone cannot.
    acceptsField: schemas[i].acceptsField === true,
  }));
  return { name, targets, schema };
}

/** The type a targetless default's shape implies, or undefined for none. */
function derivedType(value: ParamValue): ParamType | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return "f32";
  if (Array.isArray(value) && value.every((v) => typeof v === "number" && Number.isFinite(v))) {
    if (value.length === 3) return "vec3";
    if (value.length === 4) return "vec4";
  }
  return undefined;
}

/**
 * Resolve a declaration with NO targets: a param the body's field
 * expressions read by name rather than one that writes into a param slot.
 *
 * There is no inner param to borrow a schema from, so the schema comes
 * from the SHAPE of the default — the one thing the author has already
 * said. A number is `f32`, a 3-number array `vec3`, a 4-number array
 * `vec4`: exactly the literals the field grammar accepts in an argument
 * position, which is the whole set a substitution can produce. `i32`/`u32`
 * are deliberately not derivable — a field expression has no integers, so
 * deriving one from `3` would promise a rounding the grammar never
 * performs.
 *
 * Never field-capable, for the reason the whole mechanism substitutes: the
 * value is written INTO the expression before it is built, and a Field is
 * not something a literal position can hold.
 */
function resolveTargetless(name: string, decl: ExposedParamDecl): ExposedParam {
  if (decl.acceptsField === true) {
    bad(
      name,
      'declares acceptsField: true and no targets; a targetless param is read by the body\'s field expressions as {"fn": "param", "name": …}, and that value is substituted as a LITERAL before the expression is built — a Field cannot stand in a literal position. Drop the assertion, or give the param a field-capable inner target',
    );
  }
  const value = decl.default;
  if (value === undefined) {
    bad(
      name,
      'has no targets, so there is no inner param to derive a schema from and "default" is required; its shape is the only thing that can say whether the param is a number, a vec3 or a vec4',
    );
  }
  const type = derivedType(value);
  if (type === undefined) {
    bad(
      name,
      `has no targets, so its type is derived from the shape of "default" — a finite number is f32, a 3-number array vec3, a 4-number array vec4 — but the default is ${JSON.stringify(value)}; give it one of those shapes, or add an inner target to derive the schema from`,
    );
  }
  if (decl.min !== undefined && decl.max !== undefined && decl.min > decl.max) {
    bad(name, `min ${decl.min} is above max ${decl.max}; the declared bounds are empty`);
  }
  const schema: ParamSchema = {
    type,
    // Copied, so no two instances of the def share one mutable tuple.
    default: type === "f32" ? (value as number) : [...(value as readonly number[])],
    description: decl.description,
    ...(decl.min !== undefined ? { min: decl.min } : {}),
    ...(decl.max !== undefined ? { max: decl.max } : {}),
  };
  const schemaBad = paramSchemaError(schema);
  if (schemaBad !== undefined) bad(name, schemaBad);
  return { name, targets: [], schema };
}

/**
 * The default: the author's, else the first target's LIVE value at wrap
 * time — so wrapping a graph tuned to `count: 200` exposes `count` with
 * default 200, not the inner node's schema default of 1000.
 */
function resolveDefault(
  inner: Graph,
  name: string,
  decl: ExposedParamDecl,
  first: ParamSchema,
  firstTarget: ExposedParamTargetDecl,
): ParamValue {
  // Item lists are runtime-injected; their default is always the empty
  // list, never whatever the World happened to have bound at wrap time.
  if (first.type === "items") return [];
  if (decl.default !== undefined) return decl.default;
  const live: unknown = inner.require(firstTarget.node.id).params[firstTarget.param];
  if (isField(live)) {
    bad(
      name,
      `its default would come from the live value of ${label(firstTarget)}, which holds a Field; schema defaults are plain values (a Field is set as a VALUE on an instance, not as a default) — pass an explicit "default" on the declaration`,
    );
  }
  if (live === undefined) {
    bad(
      name,
      `${label(firstTarget)} holds no value to take a default from; pass an explicit "default" on the declaration`,
    );
  }
  return live as ParamValue;
}
