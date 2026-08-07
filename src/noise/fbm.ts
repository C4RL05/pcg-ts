import { type Field, add, mul, resolveField } from "../fields/index.js";
import { MAX_SPEC_DEPTH, attachSpec, isSpecNumber, peekFieldSpec, specDepth } from "../fields/spec.js";
import { hashCombine } from "../random/index.js";
import { perlinNoise } from "./perlin.js";
import { simplexNoise } from "./simplex.js";
import {
  type NoiseFactory,
  type NoiseOpts,
  noiseOptsSpec,
  noiseOutputRange,
  normalize01,
  setNoiseOutputRange,
} from "./util.js";
import { valueNoise } from "./value.js";
import { worleyNoise } from "./worley.js";

/**
 * The four factories the JSON grammar's `base` names. A base outside
 * this table cannot be named in a spec, so an fbm over one derives no
 * `fbm` spec of its own — it keeps whatever spec its `add`/`mul` octave
 * tree composed, which is `undefined` unless every octave is spec'd.
 */
const BUILT_IN_BASES: ReadonlyArray<readonly [NoiseFactory, string]> = [
  [valueNoise, "valueNoise"],
  [perlinNoise, "perlinNoise"],
  [simplexNoise, "simplexNoise"],
  [worleyNoise, "worleyNoise"],
];

function baseName(base: NoiseFactory): string | undefined {
  for (const [factory, name] of BUILT_IN_BASES) {
    if (factory === base) return name;
  }
  return undefined;
}

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
  // All terms are scalar fields, so the sum is too.
  const raw = sum as Field<1>;
  if (rangeKnown) setNoiseOutputRange(raw, [lo, hi]);
  const derived = deriveFbmSpec(base, opts, { octaves, lacunarity, gain, seed, frequency });
  if (derived !== undefined) attachSpec(raw, derived.spec, derived.depth);
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
  const wrapped = normalize01(raw, [lo, hi]);
  if (derived !== undefined) {
    attachSpec(
      wrapped,
      { ...derived.spec, opts: { ...derived.spec.opts, normalized: true } },
      derived.depth,
    );
  }
  return wrapped;
}

/**
 * The derived spec for an fbm result and its nesting depth, or undefined
 * when it cannot be named in the grammar: a base outside {@link
 * BUILT_IN_BASES}, or an option outside what the grammar's parser accepts
 * (`fbm` never checks `lacunarity`/`gain` for finiteness, so those must
 * be filtered here).
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
  opts: FbmOpts,
  resolved: {
    octaves: number;
    lacunarity: number;
    gain: number;
    seed: number;
    frequency: number;
  },
): { spec: { fn: "fbm"; base: string; opts: Record<string, unknown> }; depth: number } | undefined {
  const name = baseName(base);
  if (name === undefined) return undefined;
  if (!isSpecNumber(resolved.lacunarity) || !isSpecNumber(resolved.gain)) return undefined;
  const positionSpec =
    opts.position === undefined ? undefined : peekFieldSpec(resolveField(opts.position));
  const optsSpec = noiseOptsSpec(
    opts,
    resolved.seed,
    resolved.frequency,
    opts.offset ?? [0, 0, 0],
    positionSpec,
    { octaves: resolved.octaves, lacunarity: resolved.lacunarity, gain: resolved.gain },
  );
  if (optsSpec === undefined) return undefined;
  // One level for the `fbm` spec, plus the position nested in its opts.
  const depth = 1 + specDepth(positionSpec);
  if (depth > MAX_SPEC_DEPTH) return undefined;
  return { spec: { fn: "fbm", base: name, opts: optsSpec }, depth };
}
