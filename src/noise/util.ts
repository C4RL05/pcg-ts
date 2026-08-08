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

/** Options shared by all noise fields. */
export interface NoiseOpts {
  /**
   * Integer seed. Noise is a pure function of (seed, sample position) —
   * the field context seed does not affect it; derive per-node seeds
   * with `hashCombine` when needed. Default 0.
   */
  seed?: number;
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
  seed: number,
  frequency: number,
  offset: readonly number[],
  positionSpec: FieldSpec | undefined,
  resolvedPosition: () => Field,
  extra: Readonly<Record<string, unknown>> | undefined,
): NoiseOptsResult {
  if (opts.seed !== undefined && !Number.isInteger(opts.seed)) {
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
    seed,
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
 * the effective seed passed to `makeSampler` is `hash2(kindSalt, seed)`.
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
  const seed = (opts.seed ?? 0) >>> 0;
  const frequency = opts.frequency ?? 1;
  const offset = opts.offset ?? [0, 0, 0];
  const [ox, oy, oz] = offset;
  const pos = resolveField(opts.position ?? position());
  const key = `${kind}(${seed},${keyNum(frequency)},${keyNum(ox)},${keyNum(oy)},${keyNum(oz)};${keyRef(pos.key)})`;
  const sample = makeSampler(hash2(kindSalt, seed));
  const raw = makeField<1>(key, 1, (ctx) => {
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
