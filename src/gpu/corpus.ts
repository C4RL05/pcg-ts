/**
 * Shared representative spec corpus for the device test suite: one
 * minimal spec per grammar fn (drift-pinned against `listFieldFns` by
 * corpus.test.ts) plus richer per-family variants exercising every
 * codegen shape the compiler can produce (noise normalization, worley
 * outputs/exact mode, fbm bases, ramp helpers, integer/bool attribute
 * marshalling, vec/swizzle, knife-edge-free branch ops). Test-only —
 * not exported from the package.
 *
 * Also home to the measured parity table ({@link PARITY_CASES}) and the
 * code-authored twin of every case in it ({@link DERIVED_FIELDS}). The
 * table lives here rather than in `parity.device.test.ts` because
 * `corpus.test.ts` must pin the twins against the same authored specs
 * the device suite measures, and importing one `*.test.ts` from another
 * would re-register the device suite inside the CPU one.
 */
import {
  type Field,
  abs,
  acos,
  add,
  asin,
  atan,
  atan2,
  attribute,
  clamp,
  component,
  cos,
  div,
  dot,
  floor,
  ge,
  length,
  lerp,
  max,
  min,
  mul,
  normalize,
  position,
  ramp,
  randomField,
  remap,
  select,
  sin,
  sub,
  tan,
  vec,
} from "../fields/index.js";
import { fbm, perlinNoise, simplexNoise, valueNoise, worleyNoise } from "../noise/index.js";
import type { FieldSpecArg } from "../nodes/fieldJson.js";
import type { FieldKernelLayout } from "./types.js";

/** Layout matching the geometry `makeCorpusGeometry` builds. */
export const CORPUS_LAYOUT: FieldKernelLayout = {
  attributes: {
    P: { type: "f32", tupleSize: 3 },
    density: { type: "f32", tupleSize: 1 },
    // Unit-length shading normal. Present so the corpus can carry the
    // `examples/02-forest` slope field verbatim (it reads `normal`); the
    // other suites' geometry gains one more f32x3 column, which nothing
    // pins.
    normal: { type: "f32", tupleSize: 3 },
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
  ne: { fn: "ne", args: [1, 2] },
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

  // The four fields `examples/02-forest` drives its scatter with, as the
  // JSON the combinator expressions in that example derive. Shipped
  // demo expressions are the population most likely to reach the device
  // through a derived spec, so they are measured like any other family.
  forestHeight: { fn: "component", args: [{ fn: "position" }], index: 1 },
  forestSlope: {
    fn: "sub",
    args: [1, { fn: "component", args: [{ fn: "attribute", name: "normal", tupleSize: 3 }], index: 1 }],
  },
  forestSize: { fn: "remap", args: [{ fn: "randomField", key: "size" }, 0, 1, 0.6, 1.5] },
  forestSpecies: { fn: "ge", args: [{ fn: "randomField", key: "species" }, 0.72] },
};

/** Every corpus spec as a flat `{ name, spec }` list (minimal + extended). */
export function corpusSpecs(): Array<{ name: string; spec: FieldSpecArg }> {
  return [
    ...Object.entries(MINIMAL_SPECS).map(([name, spec]) => ({ name: `min:${name}`, spec })),
    ...Object.entries(EXTENDED_SPECS).map(([name, spec]) => ({ name, spec })),
  ];
}

// ---------------------------------------------------------------------------
// measured float-parity table
//
// Per-family max-ULP budgets vs the CPU reference, measured on the
// reference adapter (RTX 5090, D3D12, Dawn) over PARITY_COUNT dense
// hash-derived inputs at PARITY_SEED, then rounded up minimally. Each
// case's comment records the measured (rangeUlp, raw maxUlp) pair — raw
// maxUlp inflation on smooth families comes from lanes near output
// zero-crossings, where the CPU's f64 interior survives cancellation
// that f32 cannot (rangeUlp is the honest metric there). A different
// adapter exceeding one is a finding, not noise.

/** One measured float-parity family: an authored spec and its budget. */
export interface ParityCase {
  readonly name: string;
  readonly spec: FieldSpecArg;
  /** Assert raw maxUlp 0 (bit-exact family) instead of a rangeUlp budget. */
  readonly exact?: boolean;
  /** rangeUlp budget (error in ULP units at the family's output range). */
  readonly budget: number;
}

/** Element count and seed every parity measurement is taken at. */
export const PARITY_COUNT = 10_000;
export const PARITY_SEED = 1;

const P = { fn: "position" } as const;
const PX = { fn: "component", args: [P], index: 0 } as const;
const PY = { fn: "component", args: [P], index: 1 } as const;

export const PARITY_CASES: ParityCase[] = [
  // measured 0, 0 — double rounding innocuous for + - ×.
  { name: "arith add/sub/mul", spec: EXTENDED_SPECS.arithChain, exact: true, budget: 0 },
  // measured 0.76, 2 — f32 division within the 2.5-ULP WGSL bound.
  { name: "div", spec: EXTENDED_SPECS.divChain, budget: 1 },
  // measured 0.50, 3529 — CPU-formula lerp; maxUlp spike at zero crossings.
  { name: "lerp", spec: { fn: "lerp", args: [PX, PY, { fn: "attribute", name: "density" }] }, budget: 1 },
  // measured 0, 0.
  { name: "clamp/min/max", spec: { fn: "clamp", args: [PX, { fn: "min", args: [PY, 0] }, { fn: "max", args: [{ fn: "abs", args: [PY] }, 1] }] }, exact: true, budget: 0 },
  // measured 0, 0.
  { name: "floor", spec: { fn: "floor", args: [PX] }, exact: true, budget: 0 },
  // measured 0, 0 over a non-degenerate span.
  { name: "remap", spec: EXTENDED_SPECS.remapField, budget: 1 },
  // measured 1.09, 12288 — baked f32 stop constants vs CPU f64 segments.
  { name: "ramp", spec: EXTENDED_SPECS.rampMultiStop, budget: 2 },
  // measured 0, 0 away from knife edges.
  { name: "select/compare", spec: EXTENDED_SPECS.selectAway, exact: true, budget: 0 },
  // measured 6.50, 18432 over inputs in [-8, 8].
  { name: "sin/cos", spec: EXTENDED_SPECS.trigChain, budget: 8 },
  // measured 19.48, 4681 over inputs in [-1.45, 1.45].
  { name: "tan", spec: { fn: "tan", args: [{ fn: "remap", args: [PX, -8, 8, -1.45, 1.45] }] }, budget: 24 },
  // measured 503.99, 4623155 — ≈ 6.7e-5 absolute, the WGSL asin bound.
  { name: "asin", spec: EXTENDED_SPECS.inverseTrig, budget: 512 },
  // measured 359.09, 721 — same absolute-error class as asin.
  { name: "acos", spec: { fn: "acos", args: [{ fn: "clamp", args: [{ fn: "attribute", name: "density" }, -0.9, 0.9] }] }, budget: 384 },
  // measured 64.52, 2231.
  { name: "atan2", spec: EXTENDED_SPECS.atanFamily, budget: 80 },
  // measured 67.06, 2195.
  { name: "atan", spec: { fn: "atan", args: [PX] }, budget: 80 },
  // measured 1.50, 3 — sqrt/1-sqrt correctly rounded on this adapter.
  { name: "length/normalize", spec: EXTENDED_SPECS.lengthNormalize, budget: 2 },
  // measured 0.70, 305 — f32 dot accumulation vs CPU f64.
  { name: "dot", spec: EXTENDED_SPECS.dotField, budget: 1 },
  // measured 6.53, 208.
  { name: "valueNoise raw", spec: { fn: "valueNoise", opts: { seed: 7, frequency: 0.35 } }, budget: 8 },
  // measured 6.53, 208.
  { name: "valueNoise normalized", spec: EXTENDED_SPECS.valueNoiseNorm, budget: 8 },
  // measured 7.69, 50034 (raw spikes at the noise's zero crossings).
  { name: "perlinNoise raw", spec: { fn: "perlinNoise", opts: { seed: 3, frequency: 0.5 } }, budget: 10 },
  // measured 4.21, 10.
  { name: "perlinNoise normalized", spec: EXTENDED_SPECS.perlinNoiseNorm, budget: 6 },
  // measured 17.46, 76712.
  { name: "simplexNoise raw", spec: { fn: "simplexNoise", opts: { seed: 11, frequency: 0.4 } }, budget: 24 },
  // measured 8.55, 72.
  { name: "simplexNoise normalized", spec: EXTENDED_SPECS.simplexNoiseNorm, budget: 12 },
  // measured 5.16, 89.
  { name: "worley f1", spec: EXTENDED_SPECS.worleyF1, budget: 8 },
  // measured 4.71, 22.
  { name: "worley f2", spec: EXTENDED_SPECS.worleyF2, budget: 8 },
  // measured 9.42, 41868.
  { name: "worley f2-f1 normalized", spec: EXTENDED_SPECS.worleyF2F1Norm, budget: 12 },
  // measured 9.28, 43836.
  { name: "worley exact f2-f1", spec: EXTENDED_SPECS.worleyExact, budget: 12 },
  // measured 4.32, 29.
  { name: "fbm value", spec: EXTENDED_SPECS.fbmValue, budget: 6 },
  // measured 4.84, 12.
  { name: "fbm perlin", spec: EXTENDED_SPECS.fbmPerlin, budget: 6 },
  // measured 19.02, 212992.
  { name: "fbm simplex", spec: EXTENDED_SPECS.fbmSimplex, budget: 24 },
  // measured 4.81, 16.
  { name: "fbm worley", spec: EXTENDED_SPECS.fbmWorley, budget: 6 },
  // measured 9.77, 50.
  { name: "composite", spec: EXTENDED_SPECS.composite, budget: 12 },
  // -- examples/02-forest, classified into the families above ---------------
  // attribute read (a component of P, no arithmetic): measured 0, 0.
  { name: "forest height", spec: EXTENDED_SPECS.forestHeight, exact: true, budget: 0 },
  // add/sub over an attribute read: measured 0, 0.
  { name: "forest slope", spec: EXTENDED_SPECS.forestSlope, exact: true, budget: 0 },
  // remap (of a bit-exact hash stream): measured 0.67, 1 — inside the
  // remap family's budget of 1, so no widening.
  { name: "forest size", spec: EXTENDED_SPECS.forestSize, budget: 1 },
  // compare: measured 0, 0.
  { name: "forest species", spec: EXTENDED_SPECS.forestSpecies, exact: true, budget: 0 },
];

// ---------------------------------------------------------------------------
// code-authored twins
//
// The same expressions written with the combinator API instead of JSON.
// Each carries a DERIVED FieldSpec (`getFieldSpec`), the population the
// `acceptDerivedSpecs` flag admits to the device. Keyed by
// `ParityCase.name` so the pairing is mechanical and a missing twin is a
// drift-pin failure, not a silently smaller measurement.
//
// Thunks, not fields: a mis-written twin should fail the equivalence pin
// in corpus.test.ts, and building the tree at call time keeps module
// import free of noise construction.

const px = (): Field => component(position(), 0);
const py = (): Field => component(position(), 1);
const pz = (): Field => component(position(), 2);
const density = (): Field => attribute("density");

export const DERIVED_FIELDS: Record<string, () => Field> = {
  "arith add/sub/mul": () => sub(mul(add(px(), 1.5), py()), density()),
  div: () => div(px(), add(abs(pz()), 3)),
  lerp: () => lerp(px(), py(), density()),
  "clamp/min/max": () => clamp(px(), min(py(), 0), max(abs(py()), 1)),
  floor: () => floor(px()),
  remap: () => remap(px(), -8, 8, 0, 1),
  ramp: () =>
    ramp(length(position()), [
      [0, 1],
      [2, 0.75],
      [3.5, 0.25],
      [6, 0],
    ]),
  "select/compare": () => select(ge(density(), 0.25), position(), vec(1, 2, 3)),
  "sin/cos": () => add(sin(px()), cos(mul(py(), 0.7))),
  tan: () => tan(remap(px(), -8, 8, -1.45, 1.45)),
  asin: () => asin(clamp(mul(density(), 0.9), -0.9, 0.9)),
  acos: () => acos(clamp(density(), -0.9, 0.9)),
  atan2: () => atan2(px(), add(abs(py()), 0.5)),
  atan: () => atan(px()),
  "length/normalize": () => mul(length(position()), component(normalize(position()), 0)),
  dot: () => dot(position(), vec(0.3, 0.5, 0.7)),
  "valueNoise raw": () => valueNoise({ seed: 7, frequency: 0.35 }),
  "valueNoise normalized": () => valueNoise({ seed: 7, frequency: 0.35, normalized: true }),
  "perlinNoise raw": () => perlinNoise({ seed: 3, frequency: 0.5 }),
  "perlinNoise normalized": () =>
    perlinNoise({ seed: 3, frequency: 0.5, offset: [1.5, -2.25, 0.75], normalized: true }),
  "simplexNoise raw": () => simplexNoise({ seed: 11, frequency: 0.4 }),
  "simplexNoise normalized": () => simplexNoise({ seed: 11, frequency: 0.4, normalized: true }),
  "worley f1": () => worleyNoise({ seed: 5, frequency: 0.6 }),
  "worley f2": () => worleyNoise({ seed: 5, frequency: 0.6, output: "f2" }),
  "worley f2-f1 normalized": () =>
    worleyNoise({ seed: 5, frequency: 0.6, output: "f2-f1", normalized: true }),
  "worley exact f2-f1": () => worleyNoise({ seed: 9, frequency: 0.6, exact: true, output: "f2-f1" }),
  "fbm value": () => fbm(valueNoise, { seed: 2, octaves: 5, frequency: 0.3, normalized: true }),
  "fbm perlin": () =>
    fbm(perlinNoise, {
      seed: 2,
      octaves: 4,
      frequency: 0.3,
      lacunarity: 2.1,
      gain: 0.45,
      normalized: true,
    }),
  "fbm simplex": () => fbm(simplexNoise, { seed: 2, octaves: 3, frequency: 0.3 }),
  "fbm worley": () => fbm(worleyNoise, { seed: 2, octaves: 3, frequency: 0.3, normalized: true }),
  composite: () =>
    mul(
      ramp(perlinNoise({ seed: 4, frequency: 0.25, normalized: true }), [
        [0, 0],
        [0.4, 0.2],
        [0.7, 0.9],
        [1, 1],
      ]),
      add(mul(randomField("w"), 0.25), density()),
    ),
  // examples/02-forest, verbatim (MAX_TREE_SCALE inlined as 1.5).
  "forest height": () => component(position(), 1),
  "forest slope": () => sub(1, component(attribute("normal", 3), 1)),
  "forest size": () => remap(randomField("size"), 0, 1, 0.6, 1.5),
  "forest species": () => ge(randomField("species"), 0.72),
};
