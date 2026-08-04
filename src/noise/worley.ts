import type { Field } from "../fields/index.js";
import { hashFloat } from "../random/hash.js";
import { type NoiseOpts, hash5, makeNoiseField } from "./util.js";

const WORLEY_SALT = 0x776f726c; // "worl"

/** Options for {@link worleyNoise}. */
export interface WorleyNoiseOpts extends NoiseOpts {
  /**
   * Which distance to output: nearest feature point (`f1`), second
   * nearest (`f2`), or their difference (`f2-f1`). Default `f1`.
   */
  output?: "f1" | "f2" | "f2-f1";
}

/**
 * Worley (cellular) noise: Euclidean distance to hashed feature points,
 * one per unit cell, searched over the 3x3x3 neighborhood (the standard
 * approximation). F1 is in [0, ~√3); F2 >= F1, so `f2-f1` is >= 0.
 * Deterministic from `seed`.
 *
 * The 3x3x3 search can miss a closer feature just outside the searched
 * block: measured over corner-adjacent queries, ~7e-5 return a wrong F1
 * and ~7e-4 a wrong F2, with error magnitudes around 0.016. An exact
 * wider search is a possible future opt-in.
 */
export function worleyNoise(opts: WorleyNoiseOpts = {}): Field<1> {
  const output = opts.output ?? "f1";
  return makeNoiseField(`worley:${output}`, WORLEY_SALT, opts, (seed) => (x, y, z) => {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const cz = Math.floor(z);
    let f1 = Infinity;
    let f2 = Infinity;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const gx = cx + dx;
          const gy = cy + dy;
          const gz = cz + dz;
          const px = gx + hashFloat(hash5(seed, gx, gy, gz, 0));
          const py = gy + hashFloat(hash5(seed, gx, gy, gz, 1));
          const pz = gz + hashFloat(hash5(seed, gx, gy, gz, 2));
          const ddx = px - x;
          const ddy = py - y;
          const ddz = pz - z;
          const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
          if (d < f1) {
            f2 = f1;
            f1 = d;
          } else if (d < f2) {
            f2 = d;
          }
        }
      }
    }
    return output === "f1" ? f1 : output === "f2" ? f2 : f2 - f1;
  });
}
