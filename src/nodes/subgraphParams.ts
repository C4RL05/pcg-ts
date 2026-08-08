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
 */
export function resolveExposedParam(inner: Graph, decl: ExposedParamDecl): ExposedParam {
  const name = decl.name;
  if (typeof name !== "string" || name === "") {
    throw new GraphValidationError(
      `exposed param: name must be a non-empty string, got ${JSON.stringify(name)}`,
    );
  }
  if (!Array.isArray(decl.targets) || decl.targets.length === 0) {
    bad(name, "needs at least one target { node, param } — an exposed param that writes nowhere cannot affect the cook");
  }
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
