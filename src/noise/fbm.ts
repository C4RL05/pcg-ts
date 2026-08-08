import { type Field, add, mul, position, resolveField } from "../fields/index.js";
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
import { hashCombine } from "../random/index.js";
import { NOISE_BASES } from "./bases.js";
import {
  type DerivedSpec,
  type NoiseFactory,
  type NoiseOpts,
  noiseOptsSpec,
  noiseOutputRange,
  normalize01,
  setNoiseOutputRange,
} from "./util.js";

/** Options for {@link fbm}. */
export interface FbmOpts extends NoiseOpts {
  /** Number of layered octaves. Default 4. */
  octaves?: number;
  /** Frequency multiplier between octaves. Default 2. */
  lacunarity?: number;
  /** Amplitude multiplier between octaves. Default 0.5. */
  gain?: number;
}

/**
 * Fractal Brownian motion: layers a base noise at increasing frequency
 * and decreasing amplitude. Octave `o` uses seed `hashCombine(seed, o)`,
 * frequency `frequency * lacunarity^o`, and amplitude `gain^o`. The sum
 * is not renormalized, so the raw range grows toward
 * `baseRange * (1 - gain^octaves) / (1 - gain)`.
 *
 * With `normalized: true` the sum maps affinely to [0, 1] using the
 * per-configuration range: each octave contributes `gain^o *
 * baseRange`, summed across octaves (the base's range comes from its
 * factory's metadata — see `noiseOutputRange`; `normalized` is not
 * forwarded to the octaves themselves). The raw (default) output is
 * unchanged by this option existing.
 */
export function fbm(base: NoiseFactory, opts: FbmOpts = {}): Field<1> {
  const { octaves = 4, lacunarity = 2, gain = 0.5, seed = 0, frequency = 1 } = opts;
  if (!Number.isInteger(octaves) || octaves < 1) {
    throw new Error(`fbm: octaves must be a positive integer, got ${octaves}`);
  }
  let sum: Field | undefined;
  // Octave 0's field: its derived spec names the base in the grammar and
  // carries the position spec, so `deriveFbmSpec` needs neither a linear
  // scan of the base table nor a throwaway `resolveField(opts.position)`.
  let firstLayer: Field<1> | undefined;
  let amplitude = 1;
  let octaveFrequency = frequency;
  let lo = 0;
  let hi = 0;
  let rangeKnown = true;
  for (let o = 0; o < octaves; o++) {
    const layer = base({
      seed: hashCombine(seed, o),
      frequency: octaveFrequency,
      offset: opts.offset,
      position: opts.position,
    });
    if (o === 0) firstLayer = layer;
    const layerRange = noiseOutputRange(layer);
    if (layerRange === undefined) {
      rangeKnown = false;
    } else {
      // amplitude may be negative (negative gain, odd octave): the
      // octave's contribution range flips accordingly.
      lo += amplitude >= 0 ? amplitude * layerRange[0] : amplitude * layerRange[1];
      hi += amplitude >= 0 ? amplitude * layerRange[1] : amplitude * layerRange[0];
    }
    const term = amplitude === 1 ? layer : mul(layer, amplitude);
    sum = sum === undefined ? term : add(sum, term);
    amplitude *= gain;
    octaveFrequency *= lacunarity;
  }
  // All terms are scalar fields, so the sum is too, and `octaves >= 1` is
  // enforced above, so octave 0 was built.
  const raw = sum as Field<1>;
  const first = firstLayer as Field<1>;
  if (rangeKnown) setNoiseOutputRange(raw, [lo, hi]);
  const result = deriveFbmSpec(base, first, opts, {
    octaves,
    lacunarity,
    gain,
    seed,
    frequency,
  });
  const derived = "withheld" in result ? undefined : result;
  const withheld = "withheld" in result ? result.withheld : undefined;
  if (derived !== undefined) attachSpec(raw, derived.spec, derived.depth);
  // Only when the octave tree composed no spec of its own is there a
  // refusal to explain — with one, `raw` serializes as that `add` tree
  // and `fieldToJson` never asks. Where both exist, fbm's reason is the
  // more specific of the two (`lacunarity` names an option; the tree can
  // only name the octave the option spoiled).
  else if (withheld !== undefined && peekFieldSpec(raw) === undefined) {
    recordWithheld(raw, withheld);
  }
  if (opts.normalized !== true) return raw;
  if (!rangeKnown) {
    throw new Error(
      "fbm: normalized: true requires a base whose fields carry output-range metadata " +
        "(valueNoise, perlinNoise, simplexNoise, worleyNoise, fbm, or a closure over them); " +
        "the given base's fields report none — normalize the result yourself with remap, " +
        "or use one of the standard noise factories",
    );
  }
  if (!(hi > lo)) {
    throw new Error(
      `fbm: normalized: true needs a non-degenerate output range, got [${lo}, ${hi}] ` +
        "for this octaves/gain configuration",
    );
  }
  // The wrapper is a fresh field and needs its own spec; `normalize01`
  // mirrors this one with `normalized: true`. Passing `derived` rather
  // than whatever `raw` carries matters: with no `fbm` spec, `raw` keeps
  // the octave tree's own (`add`) spec, and the grammar has no
  // `normalized` option there.
  return normalize01(raw, [lo, hi], derived, withheld);
}

/**
 * The derived spec for an fbm result and its nesting depth, or the reason
 * it cannot be named in the grammar: a base outside {@link NOISE_BASES},
 * or an option outside what the grammar's parser accepts (`fbm` never
 * checks `lacunarity`/`gain` for finiteness, so those must be filtered
 * here). Withholding leaves the result carrying whatever spec its
 * `add`/`mul` octave tree composed, which is `undefined` unless every
 * octave is spec'd.
 *
 * `firstLayer` is octave 0. Its own derived spec supplies the base's
 * grammar name and the position spec nested in its opts — but the name is
 * only a CLAIM by the field, so it is checked against {@link NOISE_BASES}
 * BY IDENTITY: a custom base that forwards to a built-in factory (say
 * `(o) => worleyNoise({ ...o, output: "f2" })`) hands back a field whose
 * spec says `worleyNoise`, and naming that as an fbm base would round-trip
 * to a different field. Identity accepts exactly the four factories, which
 * is what a scan of the table accepted. With no spec at all, the layer is
 * where the trail to the un-nameable leaf continues.
 *
 * `octaves` is already validated identically by the constructor, and
 * `seed` by {@link noiseOptsSpec} — it rejects a non-integer `opts.seed`,
 * which is the same condition as a non-integer `resolved.seed` because
 * `resolved.seed` is `opts.seed ?? 0`. (`-0` needs no guard of its own:
 * `hashCombine` cannot tell it from `0`, so both build the identical
 * field and JSON's `-0` → `0` cannot change what the spec means.)
 */
function deriveFbmSpec(
  base: NoiseFactory,
  firstLayer: Field<1>,
  opts: FbmOpts,
  resolved: {
    octaves: number;
    lacunarity: number;
    gain: number;
    seed: number;
    frequency: number;
  },
): DerivedSpec | { readonly withheld: WithheldReason } {
  const baseSpec: FieldSpec | undefined = peekFieldSpec(firstLayer);
  if (baseSpec === undefined) return { withheld: withheldOver(firstLayer) };
  const name = baseSpec.fn;
  if (NOISE_BASES[name] !== base) {
    return {
      withheld: {
        kind: "ungrammatical",
        detail: "fbm's `base` is not one of the built-in noise factories",
      },
    };
  }
  if (!isSpecNumber(resolved.lacunarity)) {
    return {
      withheld: { kind: "ungrammatical", detail: "fbm's `lacunarity` must be finite, and not -0" },
    };
  }
  if (!isSpecNumber(resolved.gain)) {
    return {
      withheld: { kind: "ungrammatical", detail: "fbm's `gain` must be finite, and not -0" },
    };
  }
  // The octave resolved `opts.position` already (it is passed verbatim),
  // so its spec is the one a `resolveField` here would peek at: the very
  // same object for a Field input, and for a bare number/tuple the spec
  // of an equal constant, which is what a throwaway `resolveField` built
  // anyway. Its absence still withholds, via `noiseOptsSpec` below.
  const positionSpec =
    opts.position === undefined
      ? undefined
      : ((baseSpec.opts as Record<string, unknown> | undefined)?.position as FieldSpec | undefined);
  const optsSpec = noiseOptsSpec(
    "fbm",
    opts,
    resolved.seed,
    resolved.frequency,
    opts.offset ?? [0, 0, 0],
    positionSpec,
    // Withhold path only: the same expression the octave resolved, so the
    // leaf it names is the leaf the octave's own refusal would name.
    () => resolveField(opts.position ?? position()),
    { octaves: resolved.octaves, lacunarity: resolved.lacunarity, gain: resolved.gain },
  );
  if ("withheld" in optsSpec) return optsSpec;
  // One level for the `fbm` spec, plus the position nested in its opts.
  const depth = 1 + specDepth(positionSpec);
  if (depth > MAX_SPEC_DEPTH) return { withheld: { kind: "too-deep" } };
  return { spec: { fn: "fbm", base: name, opts: optsSpec.opts }, depth };
}
