/**
 * Field specs: the declarative JSON description of a field, and the
 * symbol channel that carries one on a constructed `Field`.
 *
 * This module sits below both `src/fields` (whose constructors DERIVE a
 * spec from their inputs' specs) and `src/nodes/fieldJson.ts` (whose
 * `fieldFromJson` REMEMBERS the author's original spec). At runtime it
 * imports nothing but `./types.js` so the combinators can attach specs
 * without `src/fields` ever depending on `src/nodes`; the resolver
 * interface it forwards in {@link resolverView} is a type-only import.
 *
 * Two provenances, one channel:
 *
 * - **authored** — stamped by `fieldFromJson` from JSON the caller wrote.
 * - **derived** — composed by a constructor from its inputs' specs.
 *   Marked in a module `WeakSet` of spec OBJECTS, never as a key inside
 *   the spec: `checkKeys` in `fieldJson.ts` rejects unknown keys, so a
 *   marker key would make `fieldFromJson(getFieldSpec(f))` throw — the
 *   very round-trip that validates derivation.
 *
 * The public {@link getFieldSpec} does not distinguish them (a spec is a
 * spec). The internal `deviceSpec` does, because device eligibility
 * depends on provenance: it is THE predicate every eligibility seam asks,
 * and the only way to ask it.
 */
import type { GpuFieldResolver } from "./gpuResolver.js";
import { type Field, isField } from "./types.js";

/** A JSON field expression: a constructor name plus its arguments. */
export interface FieldSpec {
  /** Field constructor name; see `listFieldFns`. */
  readonly fn: string;
  readonly [key: string]: unknown;
}

/** An argument position: a nested spec, or a number/tuple (wraps into constant). */
export type FieldSpecArg = FieldSpec | number | readonly number[];

/**
 * @internal Symbol under which a field carries its spec. Symbol-keyed so
 * it is invisible to `Object.keys`, `JSON.stringify`, and the graph
 * executor's structural param hash.
 */
export const FIELD_SPEC: unique symbol = Symbol("pcg-ts.fieldSpec");

/**
 * Nesting cap for field specs, counted in levels: a leaf like
 * `{fn: "position"}` is 1, `{fn: "add", args: [{fn: "position"}, 2]}` is
 * 2 (a raw number argument is not a level — the parser does not recurse
 * into it).
 *
 * `fieldFromJson` refuses to PARSE deeper than this, so derivation must
 * refuse to PRODUCE deeper: a spec the parser would reject is worse than
 * no spec at all, because `serializeGraph` would then write a graph
 * `deserializeGraph` cannot read back. One constant, imported by
 * `src/nodes/fieldJson.ts`, so the two ends cannot drift apart.
 */
export const MAX_SPEC_DEPTH = 256;

/**
 * Spec objects composed by a constructor rather than written by an
 * author. Identity-keyed on the spec object itself, so the defensive
 * copy {@link getFieldSpec} hands out is deliberately NOT marked — the
 * marker is an internal provenance record, not part of the value.
 */
const DERIVED_SPECS = new WeakSet<FieldSpec>();

/**
 * Nesting depth of each attached spec, in the levels {@link
 * MAX_SPEC_DEPTH} counts. Recorded rather than measured because child
 * specs are structure-shared: walking a tree at every attach would make
 * building an n-deep expression O(n²).
 */
const SPEC_DEPTH = new WeakMap<FieldSpec, number>();

function readSpec(field: Field): FieldSpec | undefined {
  if (!isField(field)) return undefined;
  const spec = (field as unknown as Record<symbol, unknown>)[FIELD_SPEC];
  return spec === undefined ? undefined : (spec as FieldSpec);
}

/**
 * @internal Attach a DERIVED spec to a freshly constructed field. The
 * spec object is stored as given (children are structure-shared with the
 * inputs' specs, so a deep tree costs O(depth) objects, not O(depth²)) —
 * callers must never mutate a spec after attaching it.
 *
 * `depth` is the spec's own nesting depth: 1 for a leaf, otherwise
 * `1 + ` the deepest spec nested inside it ({@link argSpecs} computes it
 * for argument lists, {@link specDepth} for a single nested child).
 * Callers must withhold the spec entirely rather than attach one deeper
 * than {@link MAX_SPEC_DEPTH}.
 */
export function attachSpec(field: Field, spec: FieldSpec, depth: number): void {
  DERIVED_SPECS.add(spec);
  SPEC_DEPTH.set(spec, depth);
  (field as unknown as Record<symbol, unknown>)[FIELD_SPEC] = spec;
}

/**
 * @internal Attach an AUTHORED spec (the JSON a caller handed to
 * `fieldFromJson`). Overwrites any derived spec the constructors
 * attached while building the same field, which is what makes
 * `fieldToJson` return the author's exact JSON rather than a
 * canonicalized derivation.
 *
 * `depth` is what the parser measured while walking this spec, so a
 * constructor building on top of an authored field keeps counting from
 * where the author's tree ended.
 */
export function attachAuthoredSpec(field: Field, spec: FieldSpec, depth: number): void {
  DERIVED_SPECS.delete(spec);
  SPEC_DEPTH.set(spec, depth);
  (field as unknown as Record<symbol, unknown>)[FIELD_SPEC] = spec;
}

/**
 * @internal The field's spec without the defensive copy — for hot paths
 * (device eligibility, spec composition) that only read it. The returned
 * object is the field's own; treat it as immutable.
 */
export function peekFieldSpec(field: Field): FieldSpec | undefined {
  return readSpec(field);
}

/**
 * @internal **The** device-eligibility predicate: the spec a seam may
 * compile for `field`, or undefined when the field must stay on the CPU.
 * Non-cloning, like {@link peekFieldSpec}.
 *
 * There is deliberately no provenance-blind and no flag-free variant of
 * this question. Four seams decide it — the memo-key salt and the fusion
 * gate (`src/graph/execute.ts`), the per-field resolution
 * (`src/gpu/evaluator.ts`) and the resident-run planner
 * (`src/gpu/run.ts`) — and if any two of them ever disagree, a node can
 * resolve on the device without its memo key gaining the resolver's
 * `|gpu:` salt, which serves GPU bytes to a CPU cook. Making this the
 * single implementation, with the flag a REQUIRED argument, is what
 * makes that disagreement a type error rather than a latent cache bug.
 *
 * `acceptDerivedSpecs` is the caller's `GpuFieldResolver`-advertised
 * flag, read through {@link acceptsDerivedSpecs}. False (the default):
 * only specs AUTHORED via `fieldFromJson` are eligible, so every byte a
 * pre-v0.9 graph produced is unchanged — a derived spec describes a
 * field faithfully, but accepting one moves that field's evaluation from
 * the CPU (the bit-exact reference) to the GPU (a documented
 * approximation) for a graph that never asked. True: any spec is
 * eligible, authored or derived.
 */
export function deviceSpec(field: Field, acceptDerivedSpecs: boolean): FieldSpec | undefined {
  const spec = readSpec(field);
  if (spec === undefined) return undefined;
  if (acceptDerivedSpecs) return spec;
  return DERIVED_SPECS.has(spec) ? undefined : spec;
}

/**
 * @internal Why {@link deviceSpec} returned undefined, as the
 * machine-readable fallback reason counted in `GpuCookStats.fallbacks`.
 * `"no-spec"` keeps its original meaning — the field cannot be described
 * at all (a `makeField` closure, a tree containing one, or a tree past
 * `MAX_SPEC_DEPTH`) — and `"derived-spec"` names the new population: a
 * field that describes itself perfectly well but was authored in code,
 * which only `acceptDerivedSpecs` admits.
 *
 * Only meaningful when `deviceSpec` returned undefined; with the flag on
 * a derived spec is eligible and never reaches a fallback count.
 */
export function specFallbackReason(field: Field): "no-spec" | "derived-spec" {
  return readSpec(field) === undefined ? "no-spec" : "derived-spec";
}

/**
 * @internal Interpret a resolver's (or an evaluator option bag's)
 * `acceptDerivedSpecs` advertisement. The ONE place the option's absence
 * is turned into `false`, so the evaluator that acts on the flag and the
 * executor that salts memo keys for it can never read it differently.
 * Structurally typed so this module keeps importing nothing but
 * `./types.js`.
 */
export function acceptsDerivedSpecs(
  source: { readonly acceptDerivedSpecs?: boolean } | undefined,
): boolean {
  return source?.acceptDerivedSpecs === true;
}

/**
 * @internal Build a resolver VIEW — a resolver that delegates to `base` —
 * carrying `base`'s `acceptDerivedSpecs` advertisement across unchanged.
 * THE ONLY way a wrapper in this repository is allowed to be built.
 *
 * This is the fifth seam, and the one the type system cannot guard by
 * itself. {@link deviceSpec} makes the flag a REQUIRED argument, so a
 * seam that READS the predicate without it is a compile error. But
 * `GpuFieldResolver.acceptDerivedSpecs` has to stay optional — resolvers
 * written before v0.9 omit it — so a wrapper that FORGETS to forward it
 * typechecks cleanly while silently narrowing what the executor believes
 * the base will accept. The executor then salts memo keys for the
 * authored population while the base resolves the wider one: GPU bytes
 * written under a CPU key, and served to the next CPU-only cook.
 *
 * Two things close that hole here rather than in review:
 *
 * 1. The advertisement is copied by this function, so it cannot be
 *    forgotten by a wrapper that uses it.
 * 2. `view` may not carry `acceptDerivedSpecs` at all (typed `never`), so
 *    re-declaring it by hand — the exact line that made the old
 *    `gpuStatsView` mutable — is a type error. A resolver that decides
 *    the flag decides it as a BASE, never as a view.
 *
 * `src/gpu/resolverView.test.ts` pins both the round-trip and the fact
 * that every wrapper in `src/` is built through here.
 */
export function resolverView(
  base: { readonly acceptDerivedSpecs?: boolean },
  view: Omit<GpuFieldResolver, "acceptDerivedSpecs"> & { readonly acceptDerivedSpecs?: never },
): GpuFieldResolver {
  const out: { -readonly [K in keyof GpuFieldResolver]: GpuFieldResolver[K] } = { ...view };
  if (base.acceptDerivedSpecs !== undefined) out.acceptDerivedSpecs = base.acceptDerivedSpecs;
  return out;
}

/** @internal Was this exact spec object composed by a constructor? */
export function isDerivedSpec(spec: FieldSpec): boolean {
  return DERIVED_SPECS.has(spec);
}

/**
 * The JSON spec describing a field, or undefined. Fields built by
 * `fieldFromJson` carry the spec they were built from; fields built with
 * the combinator API carry one composed from their inputs' specs, which
 * is undefined as soon as any input lacks one (notably anything built
 * with `makeField`, whose evaluator is an arbitrary closure). Returns a
 * defensive copy — mutating it does not affect the field or later calls
 * — and undefined for non-Field values.
 */
export function getFieldSpec(field: Field): FieldSpec | undefined {
  const spec = readSpec(field);
  if (spec === undefined) return undefined;
  return structuredClone(spec) as FieldSpec;
}

/**
 * @internal May this number appear in a derived spec? Finite, because
 * that is what the grammar's parser accepts; and not negative zero,
 * because `JSON.stringify(-0)` is `"0"` and the fields differ (`keyNum`
 * keeps them apart precisely because their columns differ). A spec that
 * changes meaning in transit is worse than no spec at all.
 */
export function isSpecNumber(v: number): boolean {
  return Number.isFinite(v) && !Object.is(v, -0);
}

/**
 * @internal Nesting depth of a spec about to be nested inside another, or
 * 0 for "nothing nested here" — so a parent's depth is always
 * `1 + specDepth(child)`. Every attached spec is recorded, so the `?? 1`
 * fallback is unreachable in practice; it errs toward "leaf".
 */
export function specDepth(spec: FieldSpec | undefined): number {
  if (spec === undefined) return 0;
  return SPEC_DEPTH.get(spec) ?? 1;
}

/** @internal An argument list's specs, plus the depth of the spec built over them. */
export interface ArgSpecs {
  /** One spec per argument, in order, structure-shared with the inputs'. */
  readonly specs: FieldSpec[];
  /** Depth of the parent spec these become the `args` of. */
  readonly depth: number;
}

/**
 * @internal The specs of an argument list, or undefined if any argument
 * lacks one. This is the `undefined`-propagation rule that keeps derived
 * specs total: a tree describes itself only if every subtree does.
 *
 * Depth propagates the same way. A tree past {@link MAX_SPEC_DEPTH}
 * withholds here rather than at the top, so the whole chain above it
 * withholds too — the alternative is a spec `fieldFromJson` throws on,
 * which is exactly what a saved graph must never contain.
 */
export function argSpecs(fields: readonly Field[]): ArgSpecs | undefined {
  const specs: FieldSpec[] = [];
  let deepest = 0;
  for (const f of fields) {
    const spec = readSpec(f);
    if (spec === undefined) return undefined;
    const d = specDepth(spec);
    if (d > deepest) deepest = d;
    specs.push(spec);
  }
  const depth = deepest + 1;
  if (depth > MAX_SPEC_DEPTH) return undefined;
  return { specs, depth };
}
