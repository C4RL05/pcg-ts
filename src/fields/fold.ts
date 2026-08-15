/**
 * Domain-constant folding: evaluate ONCE what cannot vary per element.
 *
 * `{"fn":"nodeSeed"}` resolves to `ctx.seed` — the same number on every
 * element — so the seed-shift idiom the graphs use to derive a per-node
 * offset, `A * (fract(nodeSeed * 2^-32 * K) - W0)`, is a chain of six
 * arithmetic nodes whose value is fixed for the whole domain. It was
 * being recomputed for every one of a cloud's 40 000 points, three times
 * over for three axes. This rewrites each maximal subexpression that
 * cannot vary per element into the literal it already evaluates to, so
 * the chain runs once instead of once per element.
 *
 * **Bit-exactness is the premise, not an aspiration.** Every combinator
 * computes in f64 and stores f32, so folding a chain to the f32 value it
 * already produced and re-emitting that through `constant` rounds a
 * number that is already an f32 — idempotent, so the fold cannot move a
 * bit. That is what makes it safe to do behind the author's back. A fold
 * that evaluated the chain in f64 and skipped the intermediate roundings
 * would NOT be exact and must not be written that way.
 *
 * **It rewrites the SPEC and rebuilds**, rather than rewriting the closure
 * tree: every grammar-built field carries a `FieldSpec` (see `spec.ts`),
 * the same description the WGSL compiler reads, and a rewrite expressed in
 * it needs no new representation and no cooperation from the combinators.
 * A field carrying no spec — a hand-written `makeField` closure — is
 * returned untouched, because nothing can name what it computes.
 *
 * Applied at the CPU resolve seam only (`resolveOnAllowingNonFinite` in
 * `src/nodes/util.ts`), and deliberately not on the GPU path: `nodeSeed`
 * already lowers to a uniform there and the compiler already value-numbers
 * its emissions, so the device has this win without help — while rebuilding
 * a field on that path would change its provenance, which is what device
 * eligibility turns on.
 */
import { createPointCloud } from "../data/index.js";
import { fieldFromJson, fnVariation } from "./fieldJson.js";
import { type FieldSpec, isSpecNumber, peekFieldSpec } from "./spec.js";
import { type EvalContext, type Field, evaluateField } from "./types.js";

/**
 * The geometry every fold evaluates against: ONE point, with nothing on
 * it.
 *
 * Sound precisely because a domain-constant subtree reads neither the
 * geometry nor the domain — that is exactly what the classification
 * establishes — so the seed is the only part of the context whose value
 * can reach the folded number. One shared instance because no field may
 * mutate the geometry it evaluates over, and the ones that could even
 * read it are the ones this never evaluates.
 */
const ONE_POINT = createPointCloud(1);

/**
 * Rewritten fields, per originating field and seed. Keyed on the field
 * INSTANCE so an entry dies with the graph node holding it, and bounded on
 * the inner map because the seed is a value that MOVES: a hierarchical
 * cook derives a seed per cell, so an unbounded map here would grow with
 * the number of cells a world has ever streamed. That is how the GPU
 * pipeline cache nearly grew without limit, and the fix is the same one.
 *
 * The value is the field to resolve with, which for most fields is the
 * ORIGINAL — caching the negative answer is what keeps a field with
 * nothing to fold from re-walking its spec on every resolve.
 */
const FOLDED = new WeakMap<Field, Map<number, Field>>();

/**
 * Seeds remembered per field. Small because the common case is ONE (a
 * node's seed is fixed for the cook), and the streaming case wants a
 * bound far more than it wants hits.
 */
const MAX_SEEDS_PER_FIELD = 8;

/**
 * Domain size below which folding is not attempted at all.
 *
 * A fold MISS costs about 89 µs — it re-parses the whole tree through
 * `fieldFromJson`, plus one parse per subtree it replaces — while the
 * saving is per element. So there is a break-even domain size, and under
 * it this optimization is a pessimization.
 *
 * That is not a corner case, it is the library's streaming regime. A
 * hierarchical cook derives a seed per CELL, and the per-field cache
 * holds {@link MAX_SEEDS_PER_FIELD} seeds, so past a handful of cells
 * every cell is a miss. Measured on one shared field resolved over 4000
 * cells, `add(position, vec(shift, shift, shift))`:
 *
 *     elements/resolve     fold off     fold on
 *                   16      17.8 ms    298.2 ms   16.8x SLOWER
 *                   64      49.0 ms    275.1 ms    5.6x slower
 *                  256     126.2 ms    334.1 ms    2.6x slower
 *                 4096      83.7 ms     41.5 ms    2.0x faster
 *                40000     834.5 ms    278.0 ms    3.0x faster
 *
 * 1024 sits above the measured crossover (somewhere in 300–1000) rather
 * than on it, because the two sides are not symmetric: past the crossover
 * the fold wins by a ratio that keeps growing, while under it a wrong
 * guess multiplies the cost of the small cooks that happen thousands of
 * times. A missed fold costs a fraction of one resolve; a taken one on a
 * 16-point cell costs 17 of them.
 *
 * The one-shot 40k cook this was originally measured on sits at the far
 * end of that table, which is exactly why the first version shipped
 * without a threshold and looked like a pure win.
 */
const MIN_ELEMENTS_TO_FOLD = 1024;

function isSpec(v: unknown): v is FieldSpec {
  return (
    typeof v === "object" && v !== null && !Array.isArray(v) &&
    typeof (v as { fn?: unknown }).fn === "string"
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A number or number tuple written straight into an argument position. */
function isLiteralArg(v: unknown): boolean {
  if (typeof v === "number") return true;
  return Array.isArray(v) && v.every((x) => typeof x === "number");
}

/**
 * The spec-valued positions of a node: `args` entries and `opts.position`
 * — the same two `walkSpecNodes` in `fieldJson.ts` and `collectAttrNames`
 * in `src/gpu/compile.ts` walk. A noise's position input is an argument
 * position like any other, and it is where the corpus' folds actually
 * live: the noise itself varies per element, but the seed shift added to
 * its sample position does not.
 */
function positionOpt(spec: FieldSpec): unknown {
  return isPlainObject(spec.opts) ? spec.opts.position : undefined;
}

/**
 * Can this subexpression's value differ from element to element?
 *
 * A node is domain-constant when its own `fn` introduces no variation of
 * its own — the classification the grammar registry records for every
 * registered fn, so that adding one forces the decision — AND every
 * spec-valued argument is domain-constant. An argument that is a plain
 * number or tuple is constant by definition; anything else is a shape this
 * walk does not recognize, and an unrecognized shape is not evidence of
 * constancy.
 *
 * `opts.position` is not consulted here, only in {@link rewrite}: the
 * five noises are the only fns that accept an `opts` at all and all five
 * are classified per-element, so a node with a position option never
 * reaches this test as a candidate.
 */
function isDomainConstant(spec: FieldSpec): boolean {
  if (fnVariation(spec.fn) !== "uniform") return false;
  const args = spec.args;
  if (args === undefined) return true;
  if (!Array.isArray(args)) return false;
  for (const a of args) {
    if (isSpec(a)) {
      if (!isDomainConstant(a)) return false;
    } else if (!isLiteralArg(a)) {
      return false;
    }
  }
  return true;
}

/**
 * Is a domain-constant node worth replacing? Only when something is
 * COMPOSED under it: a node whose arguments are all plain numbers is a
 * literal, or one step from the literal the author could have written,
 * and rebuilding the field to save that is a re-parse spent on nothing.
 * The chains this exists for are all several levels deep.
 */
function isWorthFolding(spec: FieldSpec): boolean {
  if (spec.fn === "constant") return false;
  const args = spec.args;
  return Array.isArray(args) && args.some(isSpec);
}

/**
 * The literal a domain-constant subtree evaluates to, or undefined to
 * DECLINE the fold and leave the subtree exactly as written.
 *
 * Declining is not an optimization detail. `constant` is defined over the
 * numbers a spec may carry ({@link isSpecNumber}: finite, and not `-0`,
 * because `JSON.stringify(-0)` is `"0"` while the two columns differ), so
 * a subtree evaluating to `Infinity` — a division by zero, say — must be
 * left alone rather than folded: otherwise the rebuild throws from inside
 * an optimization, at a site the author cannot see, instead of the
 * finiteness guard reporting it at the seam with the message it was
 * written to give.
 *
 * The evaluation itself is deliberately not guarded. Every tuple size in
 * a domain-constant subtree is statically known, so the arity checks that
 * throw here all fired when the ORIGINAL field was built from these same
 * nodes; a throw that reaches this frame is a bug in the fold, and it
 * should fail loudly rather than be swallowed as a decline.
 */
function foldToLiteral(spec: FieldSpec, ctx: EvalContext): FieldSpec | undefined {
  const col = evaluateField(fieldFromJson(spec), ctx);
  const values: number[] = [];
  for (let k = 0; k < col.tupleSize; k++) {
    const v = col.data[k];
    if (!isSpecNumber(v)) return undefined;
    values.push(v);
  }
  if (values.length === 0) return undefined;
  return { fn: "constant", value: values.length === 1 ? values[0] : values };
}

/**
 * Replace each maximal domain-constant subtree with its literal. Returns
 * the spec UNCHANGED — the same object — when nothing folded, which is
 * what lets the caller skip the rebuild entirely; untouched subtrees are
 * structure-shared with the original rather than copied, and nothing here
 * mutates a node it was given.
 *
 * A declined subtree ({@link foldToLiteral}) is left whole, children
 * included. Recursing into it would salvage the odd inner fold, at the
 * cost of a rule that is no longer one sentence: what the seam sees for
 * an expression the fold could not take is exactly what the author wrote.
 */
function rewrite(spec: FieldSpec, ctx: EvalContext): FieldSpec {
  if (isDomainConstant(spec) && isWorthFolding(spec)) {
    return foldToLiteral(spec, ctx) ?? spec;
  }
  const args = Array.isArray(spec.args) ? spec.args : undefined;
  const nextArgs = args?.map((a) => (isSpec(a) ? rewrite(a, ctx) : a));
  const argsChanged = args !== undefined && nextArgs !== undefined &&
    nextArgs.some((a, i) => a !== args[i]);

  const position = positionOpt(spec);
  const nextPosition = isSpec(position) ? rewrite(position, ctx) : position;
  const positionChanged = nextPosition !== position;

  if (!argsChanged && !positionChanged) return spec;
  const out: Record<string, unknown> = { ...spec };
  if (argsChanged) out.args = nextArgs;
  if (positionChanged) out.opts = { ...(spec.opts as Record<string, unknown>), position: nextPosition };
  return out as unknown as FieldSpec;
}

/**
 * Does this spec reference a `param` anywhere?
 *
 * A field built with bindings carries the REFERENCE in its spec and the
 * bound value outside it, keyed on the spec node (see `attachParamValue`)
 * — so rebuilding that spec through `fieldFromJson` without the bindings
 * produces an unbound param, a field that refuses to evaluate. The fold
 * has no bindings to pass and no business inventing them, so a spec that
 * mentions one is left alone entirely. Classifying `param` as per-element
 * keeps it out of any FOLD; this keeps it out of the REBUILD too, which
 * is the part that would break.
 */
function hasParamReference(spec: FieldSpec): boolean {
  if (spec.fn === "param") return true;
  if (Array.isArray(spec.args)) {
    for (const a of spec.args) {
      if (isSpec(a) && hasParamReference(a)) return true;
    }
  }
  const position = positionOpt(spec);
  return isSpec(position) && hasParamReference(position);
}

function foldOnce(field: Field, spec: FieldSpec, seed: number): Field {
  if (hasParamReference(spec)) return field;
  // ONE context for the whole walk, so the sub-chains a spec repeats (the
  // seed shift appears once per axis) are evaluated once between them —
  // `evaluateField` memoizes per context object, keyed on the field key.
  const ctx: EvalContext = { geo: ONE_POINT, domain: "point", seed };
  const rewritten = rewrite(spec, ctx);
  if (rewritten === spec) return field;
  return fieldFromJson(rewritten);
}

/**
 * The field to resolve `field` with on the CPU: an equivalent field whose
 * domain-constant subexpressions have been replaced by the literals they
 * evaluate to at this seed, or `field` itself when there is nothing to
 * fold, when it carries no spec, or when a fold was declined.
 *
 * Bit-exact by construction (see the module doc), so a caller may use the
 * result wherever it would have used the original. The seed is part of
 * the identity of the answer and not an incidental input: `nodeSeed` is
 * what most folded subtrees are made of.
 */
export function foldDomainConstants(field: Field, seed: number, count: number): Field {
  const spec = peekFieldSpec(field);
  if (spec === undefined) return field;
  let bySeed = FOLDED.get(field);
  const hit = bySeed?.get(seed);
  // Before the threshold, because a cached fold costs a map lookup and is
  // worth having at any size. Only the MISS is expensive.
  if (hit !== undefined) return hit;
  if (count < MIN_ELEMENTS_TO_FOLD) return field;
  const folded = foldOnce(field, spec, seed);
  if (bySeed === undefined) {
    bySeed = new Map();
    FOLDED.set(field, bySeed);
  }
  if (bySeed.size >= MAX_SEEDS_PER_FIELD) {
    // Oldest first: a Map iterates in insertion order, and the seed a
    // field was first resolved at is the one least likely to come back.
    bySeed.delete(bySeed.keys().next().value as number);
  }
  bySeed.set(seed, folded);
  return folded;
}
