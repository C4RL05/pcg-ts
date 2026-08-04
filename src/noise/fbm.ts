import { type Field, add, mul } from "../fields/index.js";
import { hashCombine } from "../random/index.js";
import type { NoiseFactory, NoiseOpts } from "./util.js";

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
 * is not renormalized, so the range grows toward
 * `baseRange * (1 - gain^octaves) / (1 - gain)`.
 */
export function fbm(base: NoiseFactory, opts: FbmOpts = {}): Field<1> {
  const { octaves = 4, lacunarity = 2, gain = 0.5, seed = 0, frequency = 1 } = opts;
  if (!Number.isInteger(octaves) || octaves < 1) {
    throw new Error(`fbm: octaves must be a positive integer, got ${octaves}`);
  }
  let sum: Field | undefined;
  let amplitude = 1;
  let octaveFrequency = frequency;
  for (let o = 0; o < octaves; o++) {
    const layer = base({
      seed: hashCombine(seed, o),
      frequency: octaveFrequency,
      offset: opts.offset,
      position: opts.position,
    });
    const term = amplitude === 1 ? layer : mul(layer, amplitude);
    sum = sum === undefined ? term : add(sum, term);
    amplitude *= gain;
    octaveFrequency *= lacunarity;
  }
  // All terms are scalar fields, so the sum is too.
  return sum as Field<1>;
}
