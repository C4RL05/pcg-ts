import type { Field } from "../fields/index.js";
import { hashFloat } from "../random/hash.js";
import { NOISE_RAW_RANGES, type NoiseOpts, fade, hash4, makeNoiseField, mix } from "./util.js";

/** Kind salt decorrelating value noise from other noise types ("valu"). */
export const VALUE_SALT = 0x76616c75;

/**
 * Value noise: random lattice values in [0, 1) interpolated with a
 * quintic fade. Raw output is in [0, 1) — a convex blend of lattice
 * values (documented range `NOISE_RAW_RANGES.valueNoise` = [0, 1], so
 * `normalized: true` is the identity map). Deterministic from `seed` —
 * lattice values come from `hashCombine(seed', xi, yi, zi)`.
 */
export function valueNoise(opts: NoiseOpts = {}): Field<1> {
  return makeNoiseField("value", VALUE_SALT, opts, NOISE_RAW_RANGES.valueNoise, (seed) => (x, y, z) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const fx = x - x0;
    const fy = y - y0;
    const fz = z - z0;
    const u = fade(fx);
    const v = fade(fy);
    const w = fade(fz);
    const v000 = hashFloat(hash4(seed, x0, y0, z0));
    const v100 = hashFloat(hash4(seed, x0 + 1, y0, z0));
    const v010 = hashFloat(hash4(seed, x0, y0 + 1, z0));
    const v110 = hashFloat(hash4(seed, x0 + 1, y0 + 1, z0));
    const v001 = hashFloat(hash4(seed, x0, y0, z0 + 1));
    const v101 = hashFloat(hash4(seed, x0 + 1, y0, z0 + 1));
    const v011 = hashFloat(hash4(seed, x0, y0 + 1, z0 + 1));
    const v111 = hashFloat(hash4(seed, x0 + 1, y0 + 1, z0 + 1));
    return mix(
      mix(mix(v000, v100, u), mix(v010, v110, u), v),
      mix(mix(v001, v101, u), mix(v011, v111, u), v),
      w,
    );
  });
}
