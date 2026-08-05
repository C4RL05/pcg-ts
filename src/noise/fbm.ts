import { type Field, add, mul } from "../fields/index.js";
import { hashCombine } from "../random/index.js";
import {
  type NoiseFactory,
  type NoiseOpts,
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
  return normalize01(raw, [lo, hi]);
}
