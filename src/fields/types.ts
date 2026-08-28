import type { Domain, Geometry } from "../data/index.js";

/** Backing storage of an evaluated field column. */
export type ColumnData = Float32Array | Int32Array | Uint32Array;

/**
 * The result of evaluating a field over a domain: `count * tupleSize`
 * scalars in SoA layout. Columns may alias live attribute storage —
 * treat them as read-only. They are snapshots-or-views valid only until
 * the geometry is mutated or resized (resizing can reallocate attribute
 * storage, leaving a held Column aliasing dead memory) — re-evaluate
 * with a fresh context after mutating.
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

/**
 * Number of elements the context's domain currently holds — and so the
 * length the column an evaluator returns must have (times its tuple
 * size). The first line of nearly every {@link Field} evaluator, and one
 * of the three helpers that only matter when hand-authoring one through
 * {@link makeField}; see "Hand-authoring a field" in docs/authoring.md.
 *
 * Read per evaluation rather than captured at construction: a field is
 * built long before any geometry exists, and the same field instance is
 * evaluated over domains of different sizes.
 */
export function elementCount(ctx: EvalContext): number {
  return ctx.geo.attrs[ctx.domain].count;
}

/**
 * A deferred computation resolved on a domain. `N` is the tuple size of
 * the result when statically known. Fields are plain objects: `key` is a
 * stable structural identity (kind, params, and child keys), and it is
 * what BOTH memoizations key on — the graph executor's node cache
 * (`stableValueHash` hashes a field as `F(<key>)`) and the per-evaluation
 * cache in {@link evaluateField}.
 *
 * The contract that follows from that, and which {@link makeField}
 * callers must honour: **equal keys mean interchangeable columns.** Two
 * fields sharing a key must evaluate to the same bytes on the same
 * context, because the library will compute one of them and hand the
 * result to the other.
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

/**
 * @internal Brand stamped by {@link makeField} marking genuine Fields.
 * Enumerable so structural copies (`{ ...field }`) keep the brand.
 *
 * NOT part of the package's public surface, and deliberately so even
 * though hand-authoring a Field IS supported: {@link makeField} stamps
 * this for you and {@link isField} is the supported check, which leaves
 * a hand-author with nothing to do about it. Published, its only use
 * would be the spelling that must not spread — an object literal that
 * skips `makeField` and freezes this representation.
 */
export const FIELD_BRAND: unique symbol = Symbol("pcg-ts.field");

/**
 * Type guard: is this value a genuine Field (created by {@link makeField})?
 * Brand-based, not duck-typed — a plain `{ key, evaluate }` object is not
 * a Field (the graph executor relies on this to hash such objects
 * structurally instead of by `key`).
 */
export function isField(v: unknown): v is Field {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { [FIELD_BRAND]?: unknown })[FIELD_BRAND] === true
  );
}

/**
 * Serialize a number for use in a structural key. Object.is-aware: -0
 * serializes as "-0" so it never collides with 0 (their columns differ).
 *
 * Use it for every numeric parameter a hand-authored {@link makeField}
 * takes. `String(v)` is right for all of them except -0, and the one it
 * gets wrong is silent: two fields would share a key, and the contract
 * on {@link Field} says the library may then compute one and hand the
 * column to the other.
 */
export function keyNum(v: number): string {
  return Object.is(v, -0) ? "-0" : String(v);
}

/**
 * Embed a child field's key inside a parent key, injection-proof: the
 * length prefix makes the embedding unambiguous no matter what
 * characters the child key contains (e.g. user attribute names).
 *
 * Use it for every child field a hand-authored {@link makeField} reads.
 * A child key is an arbitrary string — a hand-authored one chooses its
 * own — so raw concatenation is ambiguous: `f("x,y", "z")` and
 * `f("x", "y,z")` both become `f(x,y,z)`. A collided key is a wrong
 * COLUMN, not a parse error, because both caches trust the key.
 */
export function keyRef(key: string): string {
  return `${key.length}#${key}`;
}

/**
 * Build a Field from a structural key, static tuple size, and evaluator.
 *
 * **The supported extension point, and the only constructor.** Every
 * shipped input, combinator and noise goes through it, and so does a
 * hand-authored field — the door out of the field grammar for a
 * computation that is not elementwise (a whole-column reduction, an
 * order statistic) or simply has no name in it. `docs/authoring.md`,
 * "Hand-authoring a field", is the write-up.
 *
 * Two things to know before writing one:
 *
 * - **`key` is a promise.** Equal keys mean interchangeable columns —
 *   see {@link Field}. Put every input that can change the column in it
 *   ({@link keyNum} for numbers, {@link keyRef} for child fields) and
 *   nothing that cannot.
 * - **A field built here carries no JSON spec**, and the absence
 *   propagates through anything composed over it. So a graph holding one
 *   cannot be serialized, cannot be sent to a worker, and cannot compile
 *   to WGSL — it counts a `no-spec` GPU fallback and evaluates on the
 *   CPU. Cooking in-process is unaffected.
 *
 * The brand it stamps is what {@link isField} reads. A plain
 * `{ key, tupleSize, evaluate }` literal type-checks as a `Field` and is
 * not one — but it fails loudly rather than quietly, because `isField`
 * is the gate at every seam: `Graph.add`/`setParam` do not recognize it
 * as a field value at all and report the schema's ordinary type error
 * (`expected a finite number, got {"key":…}`), and `stableValueHash`
 * shortcuts to `F(<key>)` only for a branded field.
 */
export function makeField<N extends number = number>(
  key: string,
  tupleSize: N | undefined,
  evaluate: (ctx: EvalContext) => Column,
): Field<N> {
  return { key, tupleSize, evaluate, [FIELD_BRAND]: true } as Field<N>;
}

const evalCaches = new WeakMap<EvalContext, Map<string, Column>>();

/**
 * Evaluate a field with per-evaluation memoization: within one context
 * object, each distinct field KEY is evaluated at most once. Combinators
 * resolve their inputs through this function, so caching applies at every
 * level of a field tree.
 *
 * Keyed on `key` rather than on instance identity, which is common
 * subexpression elimination — and the difference is not academic, because
 * a field tree built from the JSON grammar has no shared instances at
 * all. `fieldFromJson` walks the spec and constructs a fresh combinator
 * per occurrence, so the two textually identical halves of
 * `sub(x, floor(x))` were two object graphs computing the same column
 * twice. The serialized seed-shift idiom in `graphs/examples-gpu-fields`
 * is exactly that shape, three times over.
 *
 * Sound because equal keys already promised interchangeable columns (see
 * {@link Field}) — the graph executor has keyed its node cache on that
 * promise since fields could be params. This makes the promise load
 * bearing in a second place; it does not weaken it. `key` is built to
 * carry everything the column depends on: `keyNum` keeps -0 distinct from
 * 0, and `keyRef` length-prefixes children so no attribute name can forge
 * a parent's key.
 *
 * What it does NOT dedupe: two fields computing identical bytes under
 * different keys. `position()` and `attribute("P", 3)` are that pair.
 */
export function evaluateField(field: Field, ctx: EvalContext): Column {
  let cache = evalCaches.get(ctx);
  if (!cache) {
    cache = new Map();
    evalCaches.set(ctx, cache);
  }
  const hit = cache.get(field.key);
  if (hit) return hit;
  const column = field.evaluate(ctx);
  cache.set(field.key, column);
  return column;
}
