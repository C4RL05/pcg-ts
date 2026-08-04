import type { Domain, Geometry } from "../data/index.js";

/** Backing storage of an evaluated field column. */
export type ColumnData = Float32Array | Int32Array | Uint32Array;

/**
 * The result of evaluating a field over a domain: `count * tupleSize`
 * scalars in SoA layout. Columns may alias live attribute storage —
 * treat them as read-only.
 */
export interface Column {
  readonly data: ColumnData;
  readonly tupleSize: number;
}

/**
 * Everything a field needs to resolve: the geometry, the domain it lands
 * on, and the evaluation seed. One context object represents one
 * evaluation pass — results are memoized per context object, so create a
 * fresh context after mutating the geometry.
 */
export interface EvalContext {
  readonly geo: Geometry;
  readonly domain: Domain;
  readonly seed: number;
}

/** Number of elements the context's domain currently holds. */
export function elementCount(ctx: EvalContext): number {
  return ctx.geo.attrs[ctx.domain].count;
}

/**
 * A deferred computation resolved on a domain. `N` is the tuple size of
 * the result when statically known. Fields are plain objects: `key` is a
 * stable structural identity (kind, params, and child keys) usable for
 * content-based memoization; instance identity drives the per-evaluation
 * cache (see {@link evaluateField}).
 */
export interface Field<N extends number = number> {
  /** Stable structural identity: kind, params, and child keys. */
  readonly key: string;
  /** Tuple size of the result, when statically known. */
  readonly tupleSize: N | undefined;
  /** Compute the column for the context's domain. */
  evaluate(ctx: EvalContext): Column;
}

/** A value accepted wherever a field is: raw numbers wrap into `constant`. */
export type FieldLike = number | readonly number[] | Field;

/** Type guard: is this field-like value already a Field? */
export function isField(v: FieldLike): v is Field {
  return typeof v === "object" && v !== null && "evaluate" in v;
}

/** Build a Field from a structural key, static tuple size, and evaluator. */
export function makeField<N extends number = number>(
  key: string,
  tupleSize: N | undefined,
  evaluate: (ctx: EvalContext) => Column,
): Field<N> {
  return { key, tupleSize, evaluate };
}

const evalCaches = new WeakMap<EvalContext, Map<Field, Column>>();

/**
 * Evaluate a field with per-evaluation memoization: within one context
 * object, each field instance is evaluated at most once (shared subtrees
 * resolve to the same column). Combinators resolve their inputs through
 * this function, so caching applies at every level of a field tree.
 */
export function evaluateField(field: Field, ctx: EvalContext): Column {
  let cache = evalCaches.get(ctx);
  if (!cache) {
    cache = new Map();
    evalCaches.set(ctx, cache);
  }
  const hit = cache.get(field);
  if (hit) return hit;
  const column = field.evaluate(ctx);
  cache.set(field, column);
  return column;
}
