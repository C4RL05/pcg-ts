import type { Field } from "../fields/index.js";
import { GRAD3, type NoiseOpts, hash4, makeNoiseField } from "./util.js";

const SIMPLEX_SALT = 0x73696d70; // "simp"

const F3 = 1 / 3;
const G3 = 1 / 6;

// Kernel radius² 0.5 (not Gustavson's 0.6): with 0.6 the kernel support
// overruns the four traversed corners, producing a true C0 discontinuity
// across skew-cell boundaries (measured |Δv| ≈ 0.005); with 0.5 the
// support never reaches an omitted corner, so the field is continuous.
const R2 = 0.5;

// Output scale, derived empirically for R2 = 0.5: the largest |raw
// kernel sum| observed over 1.28M samples (5 seeds x 4 frequencies) was
// 0.013005, and 72 maps that to ~0.94 — inside [-1, 1] with ~6% headroom
// for rarer, unobserved peaks.
const SIMPLEX_SCALE = 72;

/**
 * Simplex noise (Gustavson's 3D formulation with hash-selected
 * gradients instead of a permutation table, kernel r² = 0.5 for
 * continuity across skew cells). Output is in approximately [-1, 1].
 * Deterministic from `seed`.
 */
export function simplexNoise(opts: NoiseOpts = {}): Field<1> {
  return makeNoiseField("simplex", SIMPLEX_SALT, opts, (seed) => {
    const corner = (
      i: number,
      j: number,
      k: number,
      x: number,
      y: number,
      z: number,
    ): number => {
      const t = R2 - x * x - y * y - z * z;
      if (t <= 0) return 0;
      const g = (hash4(seed, i, j, k) % 12) * 3;
      const t2 = t * t;
      return t2 * t2 * (GRAD3[g] * x + GRAD3[g + 1] * y + GRAD3[g + 2] * z);
    };
    return (x, y, z) => {
      // Skew into simplex cell space.
      const s = (x + y + z) * F3;
      const i = Math.floor(x + s);
      const j = Math.floor(y + s);
      const k = Math.floor(z + s);
      const t = (i + j + k) * G3;
      const x0 = x - (i - t);
      const y0 = y - (j - t);
      const z0 = z - (k - t);
      // Rank the components to pick the simplex traversal order.
      let i1;
      let j1;
      let k1;
      let i2;
      let j2;
      let k2;
      if (x0 >= y0) {
        if (y0 >= z0) {
          i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
        } else if (x0 >= z0) {
          i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
        } else {
          i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
        }
      } else {
        if (y0 < z0) {
          i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
        } else if (x0 < z0) {
          i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
        } else {
          i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
        }
      }
      const x1 = x0 - i1 + G3;
      const y1 = y0 - j1 + G3;
      const z1 = z0 - k1 + G3;
      const x2 = x0 - i2 + 2 * G3;
      const y2 = y0 - j2 + 2 * G3;
      const z2 = z0 - k2 + 2 * G3;
      const x3 = x0 - 1 + 3 * G3;
      const y3 = y0 - 1 + 3 * G3;
      const z3 = z0 - 1 + 3 * G3;
      return (
        SIMPLEX_SCALE *
        (corner(i, j, k, x0, y0, z0) +
          corner(i + i1, j + j1, k + k1, x1, y1, z1) +
          corner(i + i2, j + j2, k + k2, x2, y2, z2) +
          corner(i + 1, j + 1, k + 1, x3, y3, z3))
      );
    };
  });
}
