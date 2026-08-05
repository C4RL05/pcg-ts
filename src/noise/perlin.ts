import type { Field } from "../fields/index.js";
import { GRAD3, NOISE_RAW_RANGES, type NoiseOpts, fade, hash4, makeNoiseField, mix } from "./util.js";

const PERLIN_SALT = 0x7065726c; // "perl"

// Gradients have length √2 and the unit-gradient bound for 3D Perlin is
// √3/2, so values fall in ±√6/2; this normalizes to ±1.
const PERLIN_SCALE = 2 / Math.sqrt(6);

/**
 * Perlin gradient noise: hash-selected cube-edge gradients, quintic
 * fade, trilinear blend. Raw output is in [-1, 1] (the kernel bound
 * √6/2 times the 2/√6 output scale; typical values well inside —
 * documented range `NOISE_RAW_RANGES.perlinNoise`). Deterministic from
 * `seed`.
 */
export function perlinNoise(opts: NoiseOpts = {}): Field<1> {
  return makeNoiseField("perlin", PERLIN_SALT, opts, NOISE_RAW_RANGES.perlinNoise, (seed) => {
    const gdot = (xi: number, yi: number, zi: number, dx: number, dy: number, dz: number) => {
      const g = (hash4(seed, xi, yi, zi) % 12) * 3;
      return GRAD3[g] * dx + GRAD3[g + 1] * dy + GRAD3[g + 2] * dz;
    };
    return (x, y, z) => {
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const z0 = Math.floor(z);
      const fx = x - x0;
      const fy = y - y0;
      const fz = z - z0;
      const u = fade(fx);
      const v = fade(fy);
      const w = fade(fz);
      const n000 = gdot(x0, y0, z0, fx, fy, fz);
      const n100 = gdot(x0 + 1, y0, z0, fx - 1, fy, fz);
      const n010 = gdot(x0, y0 + 1, z0, fx, fy - 1, fz);
      const n110 = gdot(x0 + 1, y0 + 1, z0, fx - 1, fy - 1, fz);
      const n001 = gdot(x0, y0, z0 + 1, fx, fy, fz - 1);
      const n101 = gdot(x0 + 1, y0, z0 + 1, fx - 1, fy, fz - 1);
      const n011 = gdot(x0, y0 + 1, z0 + 1, fx, fy - 1, fz - 1);
      const n111 = gdot(x0 + 1, y0 + 1, z0 + 1, fx - 1, fy - 1, fz - 1);
      return (
        PERLIN_SCALE *
        mix(
          mix(mix(n000, n100, u), mix(n010, n110, u), v),
          mix(mix(n001, n101, u), mix(n011, n111, u), v),
          w,
        )
      );
    };
  });
}
