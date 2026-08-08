/**
 * Deterministic geometry fixture matching `CORPUS_LAYOUT`, for the
 * device parity suites: dense, varied, hash-derived attribute values
 * (no `Math.random`), stable across runs and platforms. Test-only.
 */
import { Geometry } from "../data/index.js";
import { hashCombine, hashFloat } from "../random/index.js";

/**
 * Points-only geometry with the corpus attributes: `P` (f32x3 in
 * [-8, 8]), `density` (f32 in [0, 1]), `normal` (f32x3, unit length),
 * `uv` (f32x2 in [0, 1]), `active` (bool), `id` (u32), `material` (i32,
 * mixed signs).
 */
export function makeCorpusGeometry(count: number): Geometry {
  const geo = new Geometry();
  const set = geo.attrs.point;
  const P = set.add("P", "f32", 3);
  const density = set.add("density", "f32", 1);
  const normal = set.add("normal", "f32", 3);
  const uv = set.add("uv", "f32", 2);
  const active = set.add("active", "bool", 1);
  const id = set.add("id", "u32", 1);
  const material = set.add("material", "i32", 1);
  set.resize(count);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      P.data[i * 3 + k] = (hashFloat(hashCombine(101, i, k)) - 0.5) * 16;
    }
    density.data[i] = hashFloat(hashCombine(202, i));
    // Unit-length, upper-hemisphere-biased: the shape a shading normal
    // has, so the forest slope field (1 - normal.y) spans [0, 1].
    {
      const nx = hashFloat(hashCombine(606, i, 0)) - 0.5;
      // y stays in [0.5, 1) so the tuple can never be the zero vector.
      const ny = 0.5 + 0.5 * hashFloat(hashCombine(606, i, 1));
      const nz = hashFloat(hashCombine(606, i, 2)) - 0.5;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      normal.data[i * 3] = nx * inv;
      normal.data[i * 3 + 1] = ny * inv;
      normal.data[i * 3 + 2] = nz * inv;
    }
    uv.data[i * 2] = hashFloat(hashCombine(303, i, 0));
    uv.data[i * 2 + 1] = hashFloat(hashCombine(303, i, 1));
    active.data[i] = i % 3 === 0 ? 1 : 0;
    id.data[i] = hashCombine(404, i);
    material.data[i] = (hashCombine(505, i) | 0) % 1000;
  }
  return geo;
}
