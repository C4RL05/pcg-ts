import {
  type Field,
  type FieldLike,
  elementCount,
  evaluateField,
  keyNum,
  keyRef,
  makeField,
  position,
  resolveField,
} from "../fields/index.js";
import {
  type FieldSpec,
  MAX_SPEC_DEPTH,
  type WithheldReason,
  attachSpec,
  isSpecNumber,
  peekFieldSpec,
  recordWithheld,
  specDepth,
  withheldOver,
} from "../fields/spec.js";
import { hashFinalize, hashMix, hashSeed } from "../random/hash.js";

/**
 * The largest `variant` a {@link NodeSeedRef} may carry, inclusive: 2^24
 * is where an f32 stops holding every integer, and the GPU may read a
 * `param` variant back through an f32 uniform slot. A variant is a slot
 * number, not a seed, so the bound costs nothing.
 */
export const MAX_SEED_VARIANT = 2 ** 24;

/**
 * A noise seed derived from the COOKING NODE's seed rather than written
 * as a literal: `hashCombine(ctx.seed, variant)`, in u32 integer math.
 *
 * It exists because a serialized field expression bakes its numbers, so a
 * saved noise carries a literal `opts.seed` and the graph's seed box
 * moves the scatters and not the shapes. This is the one non-numeric form
 * `opts.seed` admits, and it is closed on purpose: every step of the
 * derivation is `Math.imul`, xor and shift here and the same operations
 * on wrapping u32s in WGSL, built from the same exported murmur
 * constants, so CPU and GPU land on the same u32 with no tolerance spent.
 * An arbitrary expression could not promise that — a field column is f32,
 * and a one-ULP disagreement in a seed is not a rounding error but an
 * unrelated noise field.
 *
 * `variant` picks WHICH independent draw off that node, so two noises on
 * one node with different variants are two independent draws. It is the
 * old literal seed's position and keeps whatever meaning that number had.
 *
 * Adopting this in a saved noise RE-ROLLS it: at the graph's default seed
 * the output is a different draw from the same family. That is not an
 * oversight — a form that were the identity at one particular seed would
 * have to be told which seed, i.e. carry a calibration constant, and a
 * calibration constant goes stale on every rename.
 */
export interface NodeSeedRef {
  /**
   * Which seed the derivation reads. `"node"` is the only member today;
   * a discriminator rather than a boolean because it has obvious future
   * ones (a per-cell re-roll, say).
   */
  readonly from: "node";
  /** Which independent draw off the node. Integer, 0..2^24. Default 0. */
  readonly variant?: number;
  /**
   * @internal fbm's octave index, hashed in after the node seed so the
   * octave layers are seeded the way they already are
   * (`hashCombine(seed, o)`). NOT part of the JSON grammar — an fbm spec
   * carries one `opts.seed` — which is why a ref carrying one withholds
   * its own derived spec (see {@link noiseOptsSpec}).
   */
  readonly octave?: number;
}

/** Options shared by all noise fields. */
export interface NoiseOpts {
  /**
   * Integer seed, or a {@link NodeSeedRef} (`{ from: "node", variant }`)
   * that derives one from the cooking node's own seed. Noise is a pure
   * function of (seed, sample position); a literal seed ignores the field
   * context seed, which is exactly what the ref form is for. Default 0.
   */
  seed?: number | NodeSeedRef;
  /** Uniform scale applied to positions before sampling. Default 1. */
  frequency?: number;
  /** Offset added after scaling (in noise space). Default [0, 0, 0]. */
  offset?: readonly [number, number, number];
  /** Position input field (tuple 3). Defaults to `position()`. */
  position?: FieldLike;
  /**
   * When true, map the raw output affinely to [0, 1] using the noise
   * type's documented raw range `[lo, hi]` (see {@link NOISE_RAW_RANGES}):
   * `out = (raw - lo) / (hi - lo)`. Default false — the raw output is
   * returned unchanged (bit-identical to builds without this option).
   */
  normalized?: boolean;
}

/** Inclusive `[lo, hi]` output range of a noise field. */
export type NoiseRange = readonly [number, number];

/**
 * Documented raw output ranges of the standard noise fields, as
 * machine-readable metadata. These are the documented bounds of each
 * implementation — derived theoretically, except simplex's, which is
 * empirical with headroom (see the per-factory doc comments) — and the
 * exact affine endpoints used by the `normalized` option:
 *
 * - `valueNoise`: [0, 1] — lattice values in [0, 1) blended convexly.
 * - `perlinNoise`: [-1, 1] — kernel bound √6/2 scaled by 2/√6.
 * - `simplexNoise`: [-1, 1] — empirical kernel-sum scale with headroom.
 * - `worleyNoise.f1`: [0, √3] — a feature always lies in the query's own
 *   unit cell, at most a cube diagonal away.
 * - `worleyNoise.f2` and `worleyNoise["f2-f1"]`: [0, √6] — a second
 *   feature always lies in a face-adjacent cell, at most √6 away, and
 *   f2-f1 ∈ [0, f2]. Valid for both the approximate and `exact` search
 *   (the exact search can only find nearer features).
 *
 * fbm ranges are per-configuration; see {@link noiseOutputRange}.
 */
export const NOISE_RAW_RANGES: {
  readonly valueNoise: NoiseRange;
  readonly perlinNoise: NoiseRange;
  readonly simplexNoise: NoiseRange;
  readonly worleyNoise: {
    readonly f1: NoiseRange;
    readonly f2: NoiseRange;
    readonly "f2-f1": NoiseRange;
  };
} = {
  valueNoise: [0, 1],
  perlinNoise: [-1, 1],
  simplexNoise: [-1, 1],
  worleyNoise: {
    f1: [0, Math.sqrt(3)],
    f2: [0, Math.sqrt(6)],
    "f2-f1": [0, Math.sqrt(6)],
  },
};

const OUTPUT_RANGES = new WeakMap<Field, NoiseRange>();

/**
 * The documented inclusive output range of a field built by this
 * module's noise factories: the raw range when `normalized` is off,
 * `[0, 1]` when it is on, and the per-configuration amplitude-summed
 * range for `fbm`. Returns undefined for fields not built by a noise
 * factory (e.g. combinator results).
 */
export function noiseOutputRange(field: Field): NoiseRange | undefined {
  return OUTPUT_RANGES.get(field);
}

/** @internal Record a field's documented output range for {@link noiseOutputRange}. */
export function setNoiseOutputRange(field: Field, range: NoiseRange): void {
  OUTPUT_RANGES.set(field, range);
}

/** @internal A derived spec and its nesting depth, as {@link attachSpec} takes them. */
export interface DerivedSpec {
  readonly spec: FieldSpec;
  readonly depth: number;
}

/**
 * @internal Affine map of a scalar field from `[lo, hi]` to [0, 1]:
 * `out = (v - lo) / (hi - lo)`, endpoints kept in f64 so the result is
 * exactly the affine image of the (f32) raw output.
 *
 * `inner`'s spec does NOT carry over — this is a fresh field through
 * `makeField` — so pass `inner`'s own derived spec (undefined when it has
 * none) as `derived` and the wrapper gets the mirrored one: the same spec
 * with `normalized: true`, which is exactly how the grammar reaches this
 * shape. The mirroring lives here rather than at the call sites because
 * this function is the ONLY thing that builds the wrapper, and two
 * spellings of the rule could diverge into a spec whose round trip is a
 * different field.
 *
 * `derived` must therefore be a NOISE spec — the only shape whose `opts`
 * the grammar lets `normalized` into. Pass undefined for anything else
 * (an `fbm` whose octave tree composed an `add` spec, say), never the
 * unrelated spec the field happens to carry.
 *
 * `withheld` is why `derived` is undefined, and is recorded on the
 * wrapper for the same reason the spec is mirrored onto it: the wrapper
 * is a fresh field, so it inherits neither, and a caller that mirrored
 * only one of the two would leave the refusal unable to name its cause.
 */
export function normalize01(
  inner: Field<1>,
  range: NoiseRange,
  derived?: DerivedSpec,
  withheld?: WithheldReason,
): Field<1> {
  const [lo, hi] = range;
  const span = hi - lo;
  const field = makeField<1>(
    `norm01(${keyRef(inner.key)},${keyNum(lo)},${keyNum(hi)})`,
    1,
    (ctx) => {
      const col = evaluateField(inner, ctx);
      const n = elementCount(ctx);
      const out = new Float32Array(n);
      const d = col.data;
      for (let i = 0; i < n; i++) out[i] = (d[i] - lo) / span;
      return { data: out, tupleSize: 1 };
    },
  );
  setNoiseOutputRange(field, [0, 1]);
  if (derived !== undefined) {
    const opts = derived.spec.opts as Record<string, unknown> | undefined;
    attachSpec(field, { ...derived.spec, opts: { ...opts, normalized: true } }, derived.depth);
  } else if (withheld !== undefined) {
    recordWithheld(field, withheld);
  }
  return field;
}

/** A noise constructor usable as an fbm base (e.g. `perlinNoise`). */
export type NoiseFactory = (opts?: NoiseOpts) => Field<1>;

/**
 * @internal How a noise factory names itself in the JSON grammar:
 * `fn` is its `listFieldFns()` entry (which is NOT the internal `kind`
 * string — `kind` also encodes worley's output/exact selection), and
 * `extraOpts` are the grammar-legal options beyond the shared five.
 *
 * A factory that cannot name itself passes a {@link WithheldReason}
 * instead of this. That is a REASON rather than an `undefined` so that
 * opting out and saying why are the same act: a factory cannot decline
 * silently and leave `fieldToJson` with nothing to report.
 */
export interface NoiseSpecInfo {
  readonly fn: string;
  readonly extraOpts?: Readonly<Record<string, unknown>>;
}

/** @internal {@link noiseOptsSpec}' two outcomes: the `opts`, or why there are none. */
export type NoiseOptsResult =
  | { readonly opts: Record<string, unknown> }
  | { readonly withheld: WithheldReason };

/**
 * Is this `opts.seed` the tagged ref rather than a literal? The union is
 * `number | NodeSeedRef`, so "not a number" settles it; the grammar's
 * parser is what checks the SHAPE, and it does so before anything here
 * sees the object.
 */
export function isNodeSeedRef(seed: number | NodeSeedRef | undefined): seed is NodeSeedRef {
  return typeof seed === "object" && seed !== null;
}

/**
 * @internal The u32 a {@link NodeSeedRef} stands for at this evaluation
 * seed. Pure integer murmur — the same `hashCombine` the executor derives
 * node seeds with — so the GPU's transliteration of it agrees bit for bit
 * with no budget spent.
 */
export function resolveNodeSeed(ref: NodeSeedRef, ctxSeed: number): number {
  const seed = hash2(ctxSeed, ref.variant ?? 0);
  return ref.octave === undefined ? seed : hash2(seed, ref.octave);
}

/**
 * @internal How a {@link NodeSeedRef} names itself inside `Field.key`.
 * The key is fixed at CONSTRUCTION while the seed arrives at evaluation,
 * so it names the ref and not the value it will resolve to — the same
 * shape `nodeSeed()` already has, and sound for the same two reasons:
 * `evaluateField` memoizes per `EvalContext` object (one context is one
 * seed), and the executor's node memo key carries the node seed verbatim,
 * so every node recooks when the graph seed moves.
 *
 * The `n` prefix makes a ref unforgeable by a literal seed, which spells
 * itself as a bare decimal.
 */
function nodeSeedKey(ref: NodeSeedRef): string {
  const variant = `n${ref.variant ?? 0}`;
  return ref.octave === undefined ? variant : `${variant}o${ref.octave}`;
}

/**
 * @internal Why this ref cannot appear in a derived spec, or undefined.
 * The range rules are the parser's, restated here because the factories
 * are reachable directly and a spec that cannot be parsed back must never
 * be produced.
 */
function nodeSeedRefProblem(ref: NodeSeedRef): string | undefined {
  if (ref.octave !== undefined) {
    return "per-octave `seed` ref is internal to fbm and has no form in the grammar";
  }
  if (ref.from !== "node") return '`seed.from` must be "node"';
  const variant = ref.variant ?? 0;
  if (!Number.isInteger(variant) || variant < 0 || variant > MAX_SEED_VARIANT) {
    return `\`seed.variant\` must be an integer from 0 to ${MAX_SEED_VARIANT}`;
  }
  return undefined;
}

/**
 * @internal The `opts` object of a derived noise spec, or the reason no
 * spec can be derived because an option falls outside what the grammar's
 * parser accepts. The factories are looser than the parser (`seed` is
 * coerced with `>>> 0`, `frequency`/`offset` are never checked for
 * finiteness), so a spec derived from raw arguments could be one
 * `fieldFromJson` would reject — and a spec that cannot be parsed back
 * must never be produced.
 *
 * Values are the NORMALIZED ones that already feed the structural key,
 * so the rebuilt field is key-identical.
 *
 * `resolvedPosition` is called only when an explicit `opts.position`
 * turns out to carry no spec, to name the root leaf of THAT expression —
 * so the success path never resolves a position it does not need.
 *
 * `fn` prefixes each `ungrammatical` detail, because that reason is
 * inherited verbatim by everything built over this field: without the
 * factory's name, a "`seed` must be an integer" arriving from six levels
 * up names the option but nothing that locates it.
 */
export function noiseOptsSpec(
  fn: string,
  opts: NoiseOpts,
  seed: number | NodeSeedRef,
  frequency: number,
  offset: readonly number[],
  positionSpec: FieldSpec | undefined,
  resolvedPosition: () => Field,
  extra: Readonly<Record<string, unknown>> | undefined,
): NoiseOptsResult {
  if (isNodeSeedRef(seed)) {
    const problem = nodeSeedRefProblem(seed);
    if (problem !== undefined) {
      return { withheld: { kind: "ungrammatical", detail: `${fn}'s ${problem}` } };
    }
  } else if (opts.seed !== undefined && !Number.isInteger(opts.seed)) {
    return { withheld: { kind: "ungrammatical", detail: `${fn}'s \`seed\` must be an integer` } };
  }
  if (!isSpecNumber(frequency)) {
    return {
      withheld: {
        kind: "ungrammatical",
        detail: `${fn}'s \`frequency\` must be finite, and not -0`,
      },
    };
  }
  if (offset.length !== 3 || !offset.every(isSpecNumber)) {
    return {
      withheld: {
        kind: "ungrammatical",
        detail: `${fn}'s \`offset\` must be three finite numbers, none of them -0`,
      },
    };
  }
  if (opts.position !== undefined && positionSpec === undefined) {
    return { withheld: withheldOver(resolvedPosition()) };
  }
  const out: Record<string, unknown> = {
    // A FRESH object for a ref: a spec is immutable by contract, and the
    // one the caller handed in is theirs to keep mutating.
    seed: isNodeSeedRef(seed) ? { from: "node", variant: seed.variant ?? 0 } : seed,
    frequency,
    offset: [offset[0], offset[1], offset[2]],
  };
  if (opts.position !== undefined) out.position = positionSpec;
  if (extra !== undefined) Object.assign(out, extra);
  return { opts: out };
}

/** Fixed-arity hashCombine(a, b): identical output, no rest-array alloc. */
export function hash2(a: number, b: number): number {
  return hashFinalize(hashMix(hashMix(hashSeed(2), a), b));
}

/** Fixed-arity hashCombine(a, b, c, d) for per-cell lattice hashing. */
export function hash4(a: number, b: number, c: number, d: number): number {
  return hashFinalize(hashMix(hashMix(hashMix(hashMix(hashSeed(4), a), b), c), d));
}

/** Fixed-arity hashCombine(a, b, c, d, e) for salted per-cell hashing. */
export function hash5(a: number, b: number, c: number, d: number, e: number): number {
  return hashFinalize(hashMix(hashMix(hashMix(hashMix(hashMix(hashSeed(5), a), b), c), d), e));
}

/** Quintic fade curve 6t^5 - 15t^4 + 10t^3 (C2-continuous at lattice planes). */
export function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Scalar linear interpolation. */
export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The 12 cube-edge gradient directions (components -1/0/1, length √2),
 * flat xyz triplets.
 */
export const GRAD3: Float32Array = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

/**
 * Build a noise Field from per-sample logic: resolves the position input,
 * applies frequency/offset, and evaluates `sample` per element into an
 * f32 scalar column. `kindSalt` decorrelates noise types sharing a seed;
 * the effective seed passed to `makeSampler` is `hash2(kindSalt, seed)`,
 * where `seed` is `opts.seed` itself or — for a {@link NodeSeedRef} — the
 * u32 it resolves to against the evaluation context.
 * `rawRange` is the sampler's documented output range; when
 * `opts.normalized` is set the raw field is wrapped with
 * {@link normalize01} (the raw path stays bit-identical).
 *
 * `spec` names the factory in the JSON grammar so the field can carry a
 * derived {@link FieldSpec}; pass a {@link WithheldReason} to derive none
 * and say why.
 */
export function makeNoiseField(
  kind: string,
  kindSalt: number,
  opts: NoiseOpts,
  rawRange: NoiseRange,
  makeSampler: (seed: number) => (x: number, y: number, z: number) => number,
  spec: NoiseSpecInfo | WithheldReason,
): Field<1> {
  const seedRef = isNodeSeedRef(opts.seed) ? opts.seed : undefined;
  const seed = seedRef === undefined ? ((opts.seed as number | undefined) ?? 0) >>> 0 : seedRef;
  const frequency = opts.frequency ?? 1;
  const offset = opts.offset ?? [0, 0, 0];
  const [ox, oy, oz] = offset;
  const pos = resolveField(opts.position ?? position());
  const seedKey = seedRef === undefined ? `${seed as number}` : nodeSeedKey(seedRef);
  const key = `${kind}(${seedKey},${keyNum(frequency)},${keyNum(ox)},${keyNum(oy)},${keyNum(oz)};${keyRef(pos.key)})`;
  // A literal seed keeps building its sampler at CONSTRUCTION, exactly as
  // it always did — same allocation, same bytes. A ref cannot: `ctx.seed`
  // does not exist yet, so the sampler moves inside the closure, memoized
  // on the last resolved u32. A sampler is a closure over one number, so
  // that is one allocation per distinct seed per field, against a
  // per-element sample loop.
  const literalSampler = seedRef === undefined ? makeSampler(hash2(kindSalt, seed as number)) : undefined;
  let lastSeed = -1;
  let lastSampler: ((x: number, y: number, z: number) => number) | undefined;
  const raw = makeField<1>(key, 1, (ctx) => {
    let sample = literalSampler;
    if (sample === undefined) {
      const s = resolveNodeSeed(seedRef as NodeSeedRef, ctx.seed);
      if (s !== lastSeed) {
        lastSampler = makeSampler(hash2(kindSalt, s));
        lastSeed = s;
      }
      sample = lastSampler as (x: number, y: number, z: number) => number;
    }
    const posCol = evaluateField(pos, ctx);
    if (posCol.tupleSize !== 3) {
      throw new Error(`${kind}: position field must have tupleSize 3, got ${posCol.tupleSize}`);
    }
    const n = elementCount(ctx);
    const p = posCol.data;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = sample(
        p[i * 3] * frequency + ox,
        p[i * 3 + 1] * frequency + oy,
        p[i * 3 + 2] * frequency + oz,
      );
    }
    return { data: out, tupleSize: 1 };
  });
  setNoiseOutputRange(raw, rawRange);
  // Only an EXPLICIT position lands in the spec (the default is implied by
  // its absence), so only that one contributes a nesting level.
  const positionSpec = opts.position === undefined ? undefined : peekFieldSpec(pos);
  // One level for the noise spec itself, plus the position it nests.
  const depth = 1 + specDepth(positionSpec);
  let derived: DerivedSpec | undefined;
  let withheld: WithheldReason | undefined;
  if ("kind" in spec) {
    withheld = spec;
  } else {
    const optsSpec = noiseOptsSpec(
      spec.fn,
      opts,
      seed,
      frequency,
      offset,
      positionSpec,
      () => pos,
      spec.extraOpts,
    );
    if ("withheld" in optsSpec) withheld = optsSpec.withheld;
    else if (depth > MAX_SPEC_DEPTH) withheld = { kind: "too-deep" };
    else derived = { spec: { fn: spec.fn, opts: optsSpec.opts }, depth };
  }
  if (derived !== undefined) attachSpec(raw, derived.spec, derived.depth);
  else if (withheld !== undefined) recordWithheld(raw, withheld);
  if (opts.normalized !== true) return raw;
  // The wrapper is a fresh field and needs its own spec; `normalize01`
  // mirrors this one with `normalized: true`, and mirrors the withheld
  // reason when there is no spec to mirror.
  return normalize01(raw, rawRange, derived, withheld);
}
