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
 * **A bound `param` folds like the number it stands for.** The value a
 * reference was substituted with is recoverable from the spec node it was
 * stamped on ({@link paramBindings}), so the rebuild can re-supply it and
 * a chain built out of one is as domain-constant as any other. Baking it
 * into a literal cannot go stale: substitution happens at BUILD time, so
 * the value is already fixed in the field this was handed, and rebinding
 * a param builds a new field — a new cache key — rather than moving the
 * old one's value.
 *
 * Applied at the CPU resolve seam only (`resolveOnAllowingNonFinite` in
 * `src/nodes/util.ts`), and deliberately not on the GPU path: `nodeSeed`
 * already lowers to a uniform there and the compiler already value-numbers
 * its emissions, so the device has this win without help — while rebuilding
 * a field on that path would change its provenance, which is what device
 * eligibility turns on.
 */
import { createPointCloud } from "../data/index.js";
import { type FieldBindings, fieldFromJson, fnVariation, paramNamesOf } from "./fieldJson.js";
import {
  type FieldBindingValue,
  type FieldSpec,
  isSpecNumber,
  paramValue,
  peekFieldSpec,
  specChildren,
} from "./spec.js";
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
 * A fold MISS re-parses the whole tree through `fieldFromJson` plus one
 * parse per subtree it replaces, while the saving is per element. So
 * there is a break-even domain size, and under it this optimization is a
 * pessimization.
 *
 * **The miss cost is PER SUBTREE, roughly 20-25 µs each** — an earlier
 * version of this comment quoted one spec's total, 89 µs, as though it
 * were a constant. That distinction is the whole justification for
 * thresholding on element count ALONE, so it is worth stating rather than
 * leaving as arithmetic someone has to redo. Measured across expressions
 * carrying 1 / 2 / 4 / 8 / 16 foldable chains, the miss costs 49.8 / 54.5
 * / 99.2 / 200.8 / 378.4 µs and the break-even lands at 256 / 1024 / 1024
 * / 1024 / 1024 elements.
 *
 * Both sides scale with the number of foldable subtrees, so they cancel
 * and break-even is INVARIANT in it. A gate weighing `subtrees x
 * elements` — the obvious-looking refinement, and one that was proposed
 * and measured before being dropped — would fold more aggressively
 * exactly where folding costs more, which is backwards. Only the
 * single-subtree case pays below 1024, and one case is not worth a
 * special path.
 *
 * Nor is falling under the threshold a corner case — it is the library's
 * streaming regime. A
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
 * 1024 sits AT the crossover for every expression carrying more than one
 * foldable chain, and above it for the single-chain case that pays from
 * 256. Rounding that way rather than down is deliberate, because the two
 * sides are not symmetric: past the crossover the fold wins by a ratio
 * that keeps growing, while under it a wrong guess multiplies the cost of
 * the small cooks that happen thousands of times. A missed fold costs a
 * fraction of one resolve; a taken one on a 16-point cell costs 17 of
 * them.
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
 * A noise's sample position, the one spec-valued position `rewrite` has to
 * REBUILD by name rather than merely visit. It is where the corpus' folds
 * actually live: the noise itself varies per element, but the seed shift
 * added to its sample position does not.
 *
 * Pure VISITS use {@link specChildren} instead, which is the shared answer
 * to "what hangs off this spec" — `args` entries, this, and
 * `byAttribute`'s `cases` values and `default`.
 */
function positionOpt(spec: FieldSpec): unknown {
  return isPlainObject(spec.opts) ? spec.opts.position : undefined;
}

/** `byAttribute`'s case values, in key order, or undefined for any other fn. */
function caseEntries(spec: FieldSpec): [string, unknown][] | undefined {
  if (!isPlainObject(spec.cases)) return undefined;
  return Object.entries(spec.cases as Record<string, unknown>);
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
 *
 * `param` is the one case decided by a VALUE rather than by the registry,
 * and necessarily so. {@link fnVariation} answers per FN, before any
 * binding exists, so it has to answer for every value the name can take —
 * and one of those is a `Field`, a noise or a position spliced in where
 * the reference stands, which varies per element. `"per-element"` is the
 * only sound per-fn answer and it stays that way. Here, though, the node
 * itself is in hand and so is what was bound to it: a stamped
 * {@link paramValue} is a number or a tuple ({@link FieldBindingValue}
 * admits nothing else), and a number does not vary over a domain. A
 * `Field` binding stamps no value — it records a SPEC instead
 * (`attachParamSpec`) — so it reads as unstamped here and stays
 * per-element, which is exactly right: the fold cannot see through a
 * spliced expression from the reference alone.
 *
 * That last case is unreachable today, because {@link paramBindings}
 * declines the whole field before any walk begins when a stamp is
 * missing. It is still tested for here rather than assumed from the
 * caller: this predicate decides what may be replaced by a number, and a
 * rule that answers on its own terms cannot drift apart from the gate
 * that currently makes it redundant.
 */
function isDomainConstant(spec: FieldSpec): boolean {
  if (spec.fn === "param") return paramValue(spec) !== undefined;
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
function foldToLiteral(
  spec: FieldSpec,
  ctx: EvalContext,
  bindings: FieldBindings | undefined,
): FieldSpec | undefined {
  // The same bindings the whole rebuild uses: a subtree may be
  // domain-constant BECAUSE of a param, and building it without the value
  // would evaluate an unbound reference rather than the number it stands
  // for.
  const col = evaluateField(fieldFromJson(spec, bindings), ctx);
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
function rewrite(spec: FieldSpec, ctx: EvalContext, bindings: FieldBindings | undefined): FieldSpec {
  if (isDomainConstant(spec) && isWorthFolding(spec)) {
    return foldToLiteral(spec, ctx, bindings) ?? spec;
  }
  const args = Array.isArray(spec.args) ? spec.args : undefined;
  const nextArgs = args?.map((a) => (isSpec(a) ? rewrite(a, ctx, bindings) : a));
  const argsChanged = args !== undefined && nextArgs !== undefined &&
    nextArgs.some((a, i) => a !== args[i]);

  const position = positionOpt(spec);
  const nextPosition = isSpec(position) ? rewrite(position, ctx, bindings) : position;
  const positionChanged = nextPosition !== position;

  // `byAttribute`'s branches. Rebuilt rather than merely visited, and
  // keyed rather than positional, so the object that comes out carries the
  // same keys in the same order as the one that went in — a case set whose
  // keys moved would still cook the same, but the spec would no longer be
  // what the author wrote, and `fieldToJson` hands that spec back.
  const cases = caseEntries(spec);
  const nextCases = cases?.map(
    ([k, v]) => [k, isSpec(v) ? rewrite(v, ctx, bindings) : v] as [string, unknown],
  );
  const casesChanged =
    cases !== undefined && nextCases !== undefined && nextCases.some((e, i) => e[1] !== cases[i][1]);
  const fallback = spec.default;
  const nextFallback = isSpec(fallback) ? rewrite(fallback, ctx, bindings) : fallback;
  const fallbackChanged = nextFallback !== fallback;

  if (!argsChanged && !positionChanged && !casesChanged && !fallbackChanged) return spec;
  const out: Record<string, unknown> = { ...spec };
  if (argsChanged) out.args = nextArgs;
  if (positionChanged) out.opts = { ...(spec.opts as Record<string, unknown>), position: nextPosition };
  if (casesChanged) out.cases = Object.fromEntries(nextCases as [string, unknown][]);
  if (fallbackChanged) out.default = nextFallback;
  return out as unknown as FieldSpec;
}

/** Two stamps for one name: the same number, or the same tuple. */
function sameBinding(a: FieldBindingValue, b: FieldBindingValue): boolean {
  if (typeof a === "number" || typeof b === "number") return Object.is(a, b);
  return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
}

/**
 * What every `param` reference in `spec` was bound to, by name — or
 * undefined to DECLINE the whole field, folds and rebuild together.
 *
 * A param is substituted at BUILD time: the REFERENCE stays in the spec
 * so it serializes as one, while the value rides beside the node in a
 * side table (`attachParamValue`, keyed per node so it survives
 * composition). Rebuilding that spec with no bindings would therefore
 * produce an unbound param — a field that refuses to evaluate — which is
 * why this module once declined every spec that mentioned one.
 *
 * The values are recoverable, though, and something already recovers
 * them: `paramSlotValues` in `src/gpu/compile.ts` fills its uniform slots
 * from `paramValue`, not from any subgraph object. What makes the same
 * move work here is that {@link peekFieldSpec} hands back the field's OWN
 * spec object rather than a defensive copy, so the nodes the fold walks
 * are the stamped ones; and {@link rewrite} structure-shares every node it
 * does not replace, so the `param` leaves in the rewritten tree are those
 * same objects again.
 *
 * Two ways to decline, and both are the same sentence — this cannot
 * reproduce the build, so it must not attempt one:
 *
 * - An UNSTAMPED node. Nothing bound the name, and the rebuild would be
 *   the same unbound param refusing in the same words — so declining
 *   reaches that place without spending the rewrite. Or the binding was a
 *   `Field`, which records a spec to SPLICE rather than a value to
 *   substitute; the parser can rebuild from that record, but the map this
 *   returns is keyed by name and the spliced spec has its own params,
 *   under names chosen by whoever wrote it. Rebuilding through this map
 *   would let an outer name capture an inner one and substitute a number
 *   the inner expression never saw. Bindings that are not visible cannot
 *   be reproduced, so the field is left exactly as the author wrote it,
 *   which is what its behavior already was.
 * - TWO stamps for ONE name. {@link FieldBindings} is keyed by name, so
 *   the rebuild can carry only one value per name. Within a single
 *   `fieldFromJson` call every reference to a name gets the same binding,
 *   but composition can put two independently built subtrees under one
 *   spec (`mul(fieldFromJson(s, {a: 1}), fieldFromJson(s, {a: 2}))`), and
 *   there the name means two different numbers. Picking one would change
 *   what the field computes, so this declines instead.
 */
function paramBindings(spec: FieldSpec, into: Record<string, FieldBindingValue>): boolean {
  if (spec.fn === "param") {
    const name = spec.name;
    // A nameless reference is a spec the parser refuses, so it can only be
    // reached by walking one the fold was handed rather than one it built.
    // Nothing to key a binding on, and nothing worth a second guess.
    if (typeof name !== "string" || name === "") return false;
    const value = paramValue(spec);
    if (value === undefined) return false;
    const seen = into[name];
    if (seen !== undefined && !sameBinding(seen, value)) return false;
    into[name] = value;
    return true;
  }
  for (const child of specChildren(spec as unknown as Record<string, unknown>)) {
    if (isSpec(child) && !paramBindings(child, into)) return false;
  }
  return true;
}

function foldOnce(field: Field, spec: FieldSpec, seed: number): Field {
  // Null-prototype, because a param name is an author's string and
  // `"__proto__"`, `"constructor"` and `"toString"` are among the strings
  // they may write. On a plain object every one of them answers a lookup
  // that should have missed, so the conflict test above reads an
  // inherited value as a second stamp and declines a field that folds
  // perfectly well. Losing the fold is the whole cost — the decline is
  // still a decline — which is exactly why it would never have been
  // noticed.
  const collected = Object.create(null) as Record<string, FieldBindingValue>;
  if (!paramBindings(spec, collected)) return field;
  // Cross-checked against the PARSER's own walk, not trusted from this
  // module's. `paramBindings` visits `args` entries and `opts.position`,
  // which is every field-valued position the grammar has — but that is a
  // fact about the registry as it stands, and the day a fn puts a spec
  // somewhere else this walk would miss a reference while the rebuild
  // still needed its value, turning a legal cook into an unbound-param
  // throw. `paramNamesOf` reads the same tree through `walkSpecNodes`,
  // which such a fn would have to teach; a name it found and this did not
  // is that drift, and declining keeps the cost a missed fold.
  if (paramNamesOf(spec).length !== Object.keys(collected).length) return field;
  // Undefined rather than an empty map when the spec names no param, so a
  // param-free field takes the exact build path it took before this
  // module could see through one.
  const bindings: FieldBindings | undefined = Object.keys(collected).length > 0 ? collected : undefined;
  // ONE context for the whole walk, so the sub-chains a spec repeats (the
  // seed shift appears once per axis) are evaluated once between them —
  // `evaluateField` memoizes per context object, keyed on the field key.
  const ctx: EvalContext = { geo: ONE_POINT, domain: "point", seed };
  const rewritten = rewrite(spec, ctx, bindings);
  if (rewritten === spec) return field;
  return fieldFromJson(rewritten, bindings);
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
