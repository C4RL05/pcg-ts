/**
 * WGSL library snippets shared by generated field kernels, plus literal
 * serialization helpers. Every constant that exists in CPU source (hash
 * murmur constants, noise salts and scales, gradient table, simplex
 * factors) is imported from its CPU module and serialized here at
 * codegen time — never hand-duplicated — so the two implementations
 * cannot drift. Structural elements without a named CPU constant (the
 * quintic fade coefficients, the murmur rotate/shift structure, the
 * `hash >> 8` of hashFloat) are ported by shape and pinned by the
 * phase-20 parity suite.
 *
 * Integer hash paths are bit-exact ports (u32 arithmetic is modular in
 * both JS `Math.imul`/`>>>` and WGSL). Float paths compute in f32 where
 * the CPU computes in f64 and stores f32; WGSL builtins (sin, sqrt,
 * division, ...) are not bit-identical to JS Math — phase 20 measures
 * and documents the per-op tolerances.
 */
import { GRAD3 } from "../noise/util.js";
import { PERLIN_SCALE } from "../noise/perlin.js";
import { F3, G3, R2, SIMPLEX_SCALE } from "../noise/simplex.js";
import {
  HASH_FINAL_MUL1,
  HASH_FINAL_MUL2,
  HASH_FINAL_SHIFT1,
  HASH_FINAL_SHIFT2,
  HASH_FINAL_SHIFT3,
  HASH_FLOAT_SCALE,
  HASH_MIX_MUL1,
  HASH_MIX_MUL2,
  HASH_MIX_ROT1,
  HASH_MIX_ROT2,
  HASH_MIX_ROUND_ADD,
  HASH_MIX_ROUND_MUL,
  hashSeed,
} from "../random/hash.js";
import { GpuCompileError } from "./types.js";

/**
 * Serialize a number as a WGSL f32 literal. The value is rounded to f32
 * first (mirroring CPU storage into Float32Array) and printed with full
 * round-trip precision, so a conforming WGSL implementation parses the
 * exact same f32 bits. `context` names the offending spec location in
 * the error when the value is not a finite f32.
 */
export function wgslF32(value: number, context: string): string {
  const f = Math.fround(value);
  if (!Number.isFinite(f)) {
    throw new GpuCompileError(
      `${context}: value ${value} is not representable as a finite f32 ` +
        "(WGSL kernels compute in f32; keep magnitudes within ~3.4e38)",
    );
  }
  if (Object.is(f, -0)) return "-0f";
  return `${String(f)}f`;
}

/** Serialize a number as a decimal WGSL u32 literal (wrapped mod 2^32). */
export function wgslU32(value: number): string {
  return `${value >>> 0}u`;
}

/** Serialize a number as a hex WGSL u32 literal (seeds, salts, hash constants). */
export function wgslHexU32(value: number): string {
  return `0x${(value >>> 0).toString(16).padStart(8, "0")}u`;
}

const HEX = wgslHexU32;

/**
 * The CPU starts worley's f1/f2 at Infinity; WGSL has no infinity
 * literal, so the kernels start at f32 max instead. Any real candidate
 * distance is far smaller, so the first sample always replaces it; only
 * non-finite sample positions (GIGO on both paths) can observe the
 * difference.
 */
const F32_MAX = wgslF32(3.4028234663852886e38, "internal f32 max");

function hashChain(seedConst: number, args: readonly string[]): string {
  let expr = HEX(seedConst);
  for (const a of args) expr = `pcg_hash_mix(${expr}, ${a})`;
  return `pcg_hash_finalize(${expr})`;
}

interface LibItem {
  readonly deps: readonly string[];
  readonly text: string;
}

function grad3Text(): string {
  const rows: string[] = [];
  for (let g = 0; g < 12; g++) {
    const c = (k: number): string => wgslF32(GRAD3[g * 3 + k], "internal GRAD3");
    rows.push(`  vec3<f32>(${c(0)}, ${c(1)}, ${c(2)}),`);
  }
  return `var<private> PCG_GRAD3: array<vec3<f32>, 12> = array<vec3<f32>, 12>(
${rows.join("\n")}
);`;
}

const L = (context: string) => (v: number) => wgslF32(v, context);

/**
 * Library definitions in canonical emission order. Each generated
 * kernel includes exactly the transitive closure of what it uses, each
 * definition exactly once.
 */
const LIB: ReadonlyMap<string, LibItem> = new Map<string, LibItem>([
  ["PCG_GRAD3", { deps: [], text: grad3Text() }],
  [
    "pcg_hash_mix",
    {
      deps: [],
      text: `fn pcg_hash_mix(h_in: u32, value: u32) -> u32 {
  var k = value * ${HEX(HASH_MIX_MUL1)};
  k = (k << ${HASH_MIX_ROT1}u) | (k >> ${32 - HASH_MIX_ROT1}u);
  k = k * ${HEX(HASH_MIX_MUL2)};
  var h = h_in ^ k;
  h = (h << ${HASH_MIX_ROT2}u) | (h >> ${32 - HASH_MIX_ROT2}u);
  h = h * ${HASH_MIX_ROUND_MUL}u + ${HEX(HASH_MIX_ROUND_ADD)};
  return h;
}`,
    },
  ],
  [
    "pcg_hash_finalize",
    {
      deps: [],
      text: `fn pcg_hash_finalize(h_in: u32) -> u32 {
  var h = h_in ^ (h_in >> ${HASH_FINAL_SHIFT1}u);
  h = h * ${HEX(HASH_FINAL_MUL1)};
  h = h ^ (h >> ${HASH_FINAL_SHIFT2}u);
  h = h * ${HEX(HASH_FINAL_MUL2)};
  h = h ^ (h >> ${HASH_FINAL_SHIFT3}u);
  return h;
}`,
    },
  ],
  [
    "pcg_hash3",
    {
      deps: ["pcg_hash_mix", "pcg_hash_finalize"],
      text: `fn pcg_hash3(a: u32, b: u32, c: u32) -> u32 {
  return ${hashChain(hashSeed(3), ["a", "b", "c"])};
}`,
    },
  ],
  [
    "pcg_hash4",
    {
      deps: ["pcg_hash_mix", "pcg_hash_finalize"],
      text: `fn pcg_hash4(a: u32, b: u32, c: u32, d: u32) -> u32 {
  return ${hashChain(hashSeed(4), ["a", "b", "c", "d"])};
}`,
    },
  ],
  [
    "pcg_hash5",
    {
      deps: ["pcg_hash_mix", "pcg_hash_finalize"],
      text: `fn pcg_hash5(a: u32, b: u32, c: u32, d: u32, e: u32) -> u32 {
  return ${hashChain(hashSeed(5), ["a", "b", "c", "d", "e"])};
}`,
    },
  ],
  [
    "pcg_hash_float",
    {
      deps: [],
      text: `fn pcg_hash_float(h: u32) -> f32 {
  return f32(h >> 8u) * ${wgslF32(HASH_FLOAT_SCALE, "internal hashFloat scale")};
}`,
    },
  ],
  [
    "pcg_fade",
    {
      deps: [],
      text: `fn pcg_fade(t: f32) -> f32 {
  return t * t * t * (t * (t * 6f - 15f) + 10f);
}`,
    },
  ],
  [
    "pcg_mix",
    {
      deps: [],
      text: `fn pcg_mix(a: f32, b: f32, t: f32) -> f32 {
  return a + (b - a) * t;
}`,
    },
  ],
  [
    "pcg_value_noise",
    {
      deps: ["pcg_hash4", "pcg_hash_float", "pcg_fade", "pcg_mix"],
      text: `fn pcg_value_noise(seed: u32, p: vec3<f32>) -> f32 {
  let pf = floor(p);
  let x0 = bitcast<u32>(i32(pf.x));
  let y0 = bitcast<u32>(i32(pf.y));
  let z0 = bitcast<u32>(i32(pf.z));
  let fr = p - pf;
  let u = pcg_fade(fr.x);
  let v = pcg_fade(fr.y);
  let w = pcg_fade(fr.z);
  let v000 = pcg_hash_float(pcg_hash4(seed, x0, y0, z0));
  let v100 = pcg_hash_float(pcg_hash4(seed, x0 + 1u, y0, z0));
  let v010 = pcg_hash_float(pcg_hash4(seed, x0, y0 + 1u, z0));
  let v110 = pcg_hash_float(pcg_hash4(seed, x0 + 1u, y0 + 1u, z0));
  let v001 = pcg_hash_float(pcg_hash4(seed, x0, y0, z0 + 1u));
  let v101 = pcg_hash_float(pcg_hash4(seed, x0 + 1u, y0, z0 + 1u));
  let v011 = pcg_hash_float(pcg_hash4(seed, x0, y0 + 1u, z0 + 1u));
  let v111 = pcg_hash_float(pcg_hash4(seed, x0 + 1u, y0 + 1u, z0 + 1u));
  return pcg_mix(
    pcg_mix(pcg_mix(v000, v100, u), pcg_mix(v010, v110, u), v),
    pcg_mix(pcg_mix(v001, v101, u), pcg_mix(v011, v111, u), v),
    w);
}`,
    },
  ],
  [
    "pcg_perlin_gdot",
    {
      deps: ["pcg_hash4", "PCG_GRAD3"],
      text: `fn pcg_perlin_gdot(seed: u32, xi: u32, yi: u32, zi: u32, d: vec3<f32>) -> f32 {
  let g = pcg_hash4(seed, xi, yi, zi) % 12u;
  return dot(PCG_GRAD3[g], d);
}`,
    },
  ],
  [
    "pcg_perlin_noise",
    {
      deps: ["pcg_perlin_gdot", "pcg_fade", "pcg_mix"],
      text: `fn pcg_perlin_noise(seed: u32, p: vec3<f32>) -> f32 {
  let pf = floor(p);
  let x0 = bitcast<u32>(i32(pf.x));
  let y0 = bitcast<u32>(i32(pf.y));
  let z0 = bitcast<u32>(i32(pf.z));
  let fr = p - pf;
  let u = pcg_fade(fr.x);
  let v = pcg_fade(fr.y);
  let w = pcg_fade(fr.z);
  let n000 = pcg_perlin_gdot(seed, x0, y0, z0, fr);
  let n100 = pcg_perlin_gdot(seed, x0 + 1u, y0, z0, fr - vec3<f32>(1f, 0f, 0f));
  let n010 = pcg_perlin_gdot(seed, x0, y0 + 1u, z0, fr - vec3<f32>(0f, 1f, 0f));
  let n110 = pcg_perlin_gdot(seed, x0 + 1u, y0 + 1u, z0, fr - vec3<f32>(1f, 1f, 0f));
  let n001 = pcg_perlin_gdot(seed, x0, y0, z0 + 1u, fr - vec3<f32>(0f, 0f, 1f));
  let n101 = pcg_perlin_gdot(seed, x0 + 1u, y0, z0 + 1u, fr - vec3<f32>(1f, 0f, 1f));
  let n011 = pcg_perlin_gdot(seed, x0, y0 + 1u, z0 + 1u, fr - vec3<f32>(0f, 1f, 1f));
  let n111 = pcg_perlin_gdot(seed, x0 + 1u, y0 + 1u, z0 + 1u, fr - vec3<f32>(1f, 1f, 1f));
  return ${L("internal PERLIN_SCALE")(PERLIN_SCALE)} * pcg_mix(
    pcg_mix(pcg_mix(n000, n100, u), pcg_mix(n010, n110, u), v),
    pcg_mix(pcg_mix(n001, n101, u), pcg_mix(n011, n111, u), v),
    w);
}`,
    },
  ],
  [
    "pcg_simplex_corner",
    {
      deps: ["pcg_hash4", "PCG_GRAD3"],
      text: `fn pcg_simplex_corner(seed: u32, i: i32, j: i32, k: i32, x: f32, y: f32, z: f32) -> f32 {
  let t = ${L("internal simplex R2")(R2)} - x * x - y * y - z * z;
  if (t <= 0f) {
    return 0f;
  }
  let g = pcg_hash4(seed, bitcast<u32>(i), bitcast<u32>(j), bitcast<u32>(k)) % 12u;
  let t2 = t * t;
  return t2 * t2 * dot(PCG_GRAD3[g], vec3<f32>(x, y, z));
}`,
    },
  ],
  [
    "pcg_simplex_noise",
    {
      deps: ["pcg_simplex_corner"],
      text: `fn pcg_simplex_noise(seed: u32, p: vec3<f32>) -> f32 {
  let s = (p.x + p.y + p.z) * ${L("internal simplex F3")(F3)};
  let i = i32(floor(p.x + s));
  let j = i32(floor(p.y + s));
  let k = i32(floor(p.z + s));
  let t = f32(i + j + k) * ${L("internal simplex G3")(G3)};
  let x0 = p.x - (f32(i) - t);
  let y0 = p.y - (f32(j) - t);
  let z0 = p.z - (f32(k) - t);
  var i1: i32;
  var j1: i32;
  var k1: i32;
  var i2: i32;
  var j2: i32;
  var k2: i32;
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
  let x1 = x0 - f32(i1) + ${L("internal simplex G3")(G3)};
  let y1 = y0 - f32(j1) + ${L("internal simplex G3")(G3)};
  let z1 = z0 - f32(k1) + ${L("internal simplex G3")(G3)};
  let x2 = x0 - f32(i2) + ${L("internal simplex 2*G3")(2 * G3)};
  let y2 = y0 - f32(j2) + ${L("internal simplex 2*G3")(2 * G3)};
  let z2 = z0 - f32(k2) + ${L("internal simplex 2*G3")(2 * G3)};
  let x3 = x0 - 1f + ${L("internal simplex 3*G3")(3 * G3)};
  let y3 = y0 - 1f + ${L("internal simplex 3*G3")(3 * G3)};
  let z3 = z0 - 1f + ${L("internal simplex 3*G3")(3 * G3)};
  return ${L("internal SIMPLEX_SCALE")(SIMPLEX_SCALE)} * (pcg_simplex_corner(seed, i, j, k, x0, y0, z0)
    + pcg_simplex_corner(seed, i + i1, j + j1, k + k1, x1, y1, z1)
    + pcg_simplex_corner(seed, i + i2, j + j2, k + k2, x2, y2, z2)
    + pcg_simplex_corner(seed, i + 1, j + 1, k + 1, x3, y3, z3));
}`,
    },
  ],
  [
    "pcg_worley_point_dist",
    {
      deps: ["pcg_hash5", "pcg_hash_float"],
      text: `fn pcg_worley_point_dist(seed: u32, gx: i32, gy: i32, gz: i32, p: vec3<f32>) -> f32 {
  let ux = bitcast<u32>(gx);
  let uy = bitcast<u32>(gy);
  let uz = bitcast<u32>(gz);
  let px = f32(gx) + pcg_hash_float(pcg_hash5(seed, ux, uy, uz, 0u));
  let py = f32(gy) + pcg_hash_float(pcg_hash5(seed, ux, uy, uz, 1u));
  let pz = f32(gz) + pcg_hash_float(pcg_hash5(seed, ux, uy, uz, 2u));
  let dx = px - p.x;
  let dy = py - p.y;
  let dz = pz - p.z;
  return sqrt(dx * dx + dy * dy + dz * dz);
}`,
    },
  ],
  [
    "pcg_worley",
    {
      deps: ["pcg_worley_point_dist"],
      text: `fn pcg_worley(seed: u32, p: vec3<f32>, exact: bool, needs_f2: bool) -> vec2<f32> {
  let cx = i32(floor(p.x));
  let cy = i32(floor(p.y));
  let cz = i32(floor(p.z));
  var f1 = ${F32_MAX};
  var f2 = ${F32_MAX};
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let d = pcg_worley_point_dist(seed, cx + dx, cy + dy, cz + dz, p);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
  }
  if (exact) {
    var r = 1;
    loop {
      var needed = f1;
      if (needs_f2) {
        needed = f2;
      }
      if (!(r < 3 && needed > f32(r))) {
        break;
      }
      r = r + 1;
      for (var dz = -r; dz <= r; dz++) {
        let az = abs(dz);
        for (var dy = -r; dy <= r; dy++) {
          let ay = abs(dy);
          for (var dx = -r; dx <= r; dx++) {
            let ax = abs(dx);
            if (ax != r && ay != r && az != r) {
              continue;
            }
            let d = pcg_worley_point_dist(seed, cx + dx, cy + dy, cz + dz, p);
            if (d < f1) {
              f2 = f1;
              f1 = d;
            } else if (d < f2) {
              f2 = d;
            }
          }
        }
      }
    }
  }
  return vec2<f32>(f1, f2);
}`,
    },
  ],
]);

/**
 * WGSL text blocks for the given library roots plus their transitive
 * dependencies, in the canonical definition order (dependencies first).
 */
export function libClosure(roots: Iterable<string>): string[] {
  const used = new Set<string>();
  const visit = (name: string): void => {
    if (used.has(name)) return;
    const item = LIB.get(name);
    if (!item) throw new Error(`internal: unknown WGSL library item "${name}"`);
    used.add(name);
    for (const dep of item.deps) visit(dep);
  };
  for (const r of roots) visit(r);
  const out: string[] = [];
  for (const [name, item] of LIB) {
    if (used.has(name)) out.push(item.text);
  }
  return out;
}
