/**
 * Shared representative spec corpus for the device test suite: one
 * minimal spec per grammar fn (drift-pinned against `listFieldFns` by
 * corpus.test.ts) plus richer per-family variants exercising every
 * codegen shape the compiler can produce (noise normalization, worley
 * outputs/exact mode, fbm bases, ramp helpers, integer/bool attribute
 * marshalling, vec/swizzle, knife-edge-free branch ops). Test-only —
 * not exported from the package.
 */
import type { FieldSpecArg } from "../nodes/fieldJson.js";
import type { FieldKernelLayout } from "./types.js";

/** Layout matching the geometry `makeCorpusGeometry` builds. */
export const CORPUS_LAYOUT: FieldKernelLayout = {
  attributes: {
    P: { type: "f32", tupleSize: 3 },
    density: { type: "f32", tupleSize: 1 },
    uv: { type: "f32", tupleSize: 2 },
    active: { type: "bool", tupleSize: 1 },
    id: { type: "u32", tupleSize: 1 },
    material: { type: "i32", tupleSize: 1 },
  },
};

/** One minimal compilable spec per grammar fn (keys = `listFieldFns()`). */
export const MINIMAL_SPECS: Record<string, FieldSpecArg> = {
  constant: { fn: "constant", value: 1 },
  attribute: { fn: "attribute", name: "density" },
  position: { fn: "position" },
  index: { fn: "index" },
  randomField: { fn: "randomField" },
  add: { fn: "add", args: [1, 2] },
  sub: { fn: "sub", args: [1, 2] },
  mul: { fn: "mul", args: [1, 2] },
  div: { fn: "div", args: [1, 2] },
  min: { fn: "min", args: [1, 2] },
  max: { fn: "max", args: [1, 2] },
  abs: { fn: "abs", args: [-1] },
  floor: { fn: "floor", args: [1.5] },
  sin: { fn: "sin", args: [1] },
  cos: { fn: "cos", args: [1] },
  tan: { fn: "tan", args: [1] },
  asin: { fn: "asin", args: [0.5] },
  acos: { fn: "acos", args: [0.5] },
  atan: { fn: "atan", args: [1] },
  atan2: { fn: "atan2", args: [1, 2] },
  clamp: { fn: "clamp", args: [1, 0, 2] },
  lerp: { fn: "lerp", args: [0, 1, 0.5] },
  remap: { fn: "remap", args: [1, 0, 2, 0, 1] },
  select: { fn: "select", args: [1, 2, 3] },
  lt: { fn: "lt", args: [1, 2] },
  le: { fn: "le", args: [1, 2] },
  gt: { fn: "gt", args: [1, 2] },
  ge: { fn: "ge", args: [1, 2] },
  eq: { fn: "eq", args: [1, 2] },
  dot: { fn: "dot", args: [[1, 2, 3], [4, 5, 6]] },
  length: { fn: "length", args: [[1, 2, 3]] },
  normalize: { fn: "normalize", args: [[1, 2, 3]] },
  vec: { fn: "vec", args: [1, 2, 3] },
  component: { fn: "component", args: [[1, 2, 3]], index: 1 },
  ramp: { fn: "ramp", args: [1], stops: [[0, 0], [1, 1]] },
  valueNoise: { fn: "valueNoise" },
  perlinNoise: { fn: "perlinNoise" },
  simplexNoise: { fn: "simplexNoise" },
  worleyNoise: { fn: "worleyNoise" },
  fbm: { fn: "fbm", base: "perlinNoise" },
};

/**
 * Richer variants covering codegen shapes the minimal specs miss:
 * every noise normalization, worley output/exact combination, all fbm
 * bases, multi-stop ramps, attribute-driven expressions, integer and
 * bool marshalling, u32/i32/index roots, vec concat + swizzle, and a
 * chunky composite. Names are stable identifiers for reporting.
 */
export const EXTENDED_SPECS: Record<string, FieldSpecArg> = {
  attrVec3Root: { fn: "position" },
  attrUv: { fn: "attribute", name: "uv" },
  attrBool: { fn: "attribute", name: "active" },
  attrU32Root: { fn: "attribute", name: "id" },
  attrI32Root: { fn: "attribute", name: "material" },
  boolInExpr: { fn: "mul", args: [{ fn: "attribute", name: "active" }, { fn: "attribute", name: "density" }] },
  intInExpr: {
    fn: "add",
    args: [{ fn: "attribute", name: "id" }, { fn: "attribute", name: "material" }],
  },
  randomKeyed: { fn: "randomField", key: "jitter" },
  randomSelect: {
    fn: "select",
    args: [
      { fn: "gt", args: [{ fn: "randomField", key: "a" }, 0.5] },
      { fn: "randomField", key: "b" },
      { fn: "randomField", key: "c" },
    ],
  },
  arithChain: {
    fn: "sub",
    args: [
      {
        fn: "mul",
        args: [
          { fn: "add", args: [{ fn: "component", args: [{ fn: "position" }], index: 0 }, 1.5] },
          { fn: "component", args: [{ fn: "position" }], index: 1 },
        ],
      },
      { fn: "attribute", name: "density" },
    ],
  },
  divChain: {
    fn: "div",
    args: [
      { fn: "component", args: [{ fn: "position" }], index: 0 },
      { fn: "add", args: [{ fn: "abs", args: [{ fn: "component", args: [{ fn: "position" }], index: 2 }] }, 3] },
    ],
  },
  trigChain: {
    fn: "add",
    args: [
      { fn: "sin", args: [{ fn: "component", args: [{ fn: "position" }], index: 0 }] },
      { fn: "cos", args: [{ fn: "mul", args: [{ fn: "component", args: [{ fn: "position" }], index: 1 }, 0.7] }] },
    ],
  },
  atanFamily: {
    fn: "atan2",
    args: [
      { fn: "component", args: [{ fn: "position" }], index: 0 },
      { fn: "add", args: [{ fn: "abs", args: [{ fn: "component", args: [{ fn: "position" }], index: 1 }] }, 0.5] },
    ],
  },
  inverseTrig: {
    fn: "asin",
    args: [{ fn: "clamp", args: [{ fn: "mul", args: [{ fn: "attribute", name: "density" }, 0.9] }, -0.9, 0.9] }],
  },
  lengthNormalize: {
    fn: "mul",
    args: [{ fn: "length", args: [{ fn: "position" }] }, { fn: "component", args: [{ fn: "normalize", args: [{ fn: "position" }] }], index: 0 }],
  },
  dotField: { fn: "dot", args: [{ fn: "position" }, { fn: "vec", args: [0.3, 0.5, 0.7] }] },
  vecSwizzle: {
    fn: "component",
    args: [
      {
        fn: "vec",
        args: [{ fn: "attribute", name: "density" }, { fn: "attribute", name: "uv" }],
      },
    ],
    index: 2,
  },
  rampMultiStop: {
    fn: "ramp",
    args: [{ fn: "length", args: [{ fn: "position" }] }],
    stops: [
      [0, 1],
      [2, 0.75],
      [3.5, 0.25],
      [6, 0],
    ],
  },
  remapField: {
    fn: "remap",
    args: [{ fn: "component", args: [{ fn: "position" }], index: 0 }, -8, 8, 0, 1],
  },
  selectAway: {
    fn: "select",
    args: [
      { fn: "ge", args: [{ fn: "attribute", name: "density" }, 0.25] },
      { fn: "position" },
      { fn: "vec", args: [1, 2, 3] },
    ],
  },
  valueNoiseNorm: { fn: "valueNoise", opts: { seed: 7, frequency: 0.35, normalized: true } },
  perlinNoiseNorm: { fn: "perlinNoise", opts: { seed: 3, frequency: 0.5, offset: [1.5, -2.25, 0.75], normalized: true } },
  simplexNoiseNorm: { fn: "simplexNoise", opts: { seed: 11, frequency: 0.4, normalized: true } },
  worleyF1: { fn: "worleyNoise", opts: { seed: 5, frequency: 0.6 } },
  worleyF2: { fn: "worleyNoise", opts: { seed: 5, frequency: 0.6, output: "f2" } },
  worleyF2F1Norm: { fn: "worleyNoise", opts: { seed: 5, frequency: 0.6, output: "f2-f1", normalized: true } },
  worleyExact: { fn: "worleyNoise", opts: { seed: 9, frequency: 0.6, exact: true, output: "f2-f1" } },
  fbmValue: { fn: "fbm", base: "valueNoise", opts: { seed: 2, octaves: 5, frequency: 0.3, normalized: true } },
  fbmPerlin: { fn: "fbm", base: "perlinNoise", opts: { seed: 2, octaves: 4, frequency: 0.3, lacunarity: 2.1, gain: 0.45, normalized: true } },
  fbmSimplex: { fn: "fbm", base: "simplexNoise", opts: { seed: 2, octaves: 3, frequency: 0.3 } },
  fbmWorley: { fn: "fbm", base: "worleyNoise", opts: { seed: 2, octaves: 3, frequency: 0.3, normalized: true } },
  composite: {
    fn: "mul",
    args: [
      {
        fn: "ramp",
        args: [{ fn: "perlinNoise", opts: { seed: 4, frequency: 0.25, normalized: true } }],
        stops: [
          [0, 0],
          [0.4, 0.2],
          [0.7, 0.9],
          [1, 1],
        ],
      },
      {
        fn: "add",
        args: [
          { fn: "mul", args: [{ fn: "randomField", key: "w" }, 0.25] },
          { fn: "attribute", name: "density" },
        ],
      },
    ],
  },
};

/** Every corpus spec as a flat `{ name, spec }` list (minimal + extended). */
export function corpusSpecs(): Array<{ name: string; spec: FieldSpecArg }> {
  return [
    ...Object.entries(MINIMAL_SPECS).map(([name, spec]) => ({ name: `min:${name}`, spec })),
    ...Object.entries(EXTENDED_SPECS).map(([name, spec]) => ({ name, spec })),
  ];
}
