/**
 * Shared representative spec corpus for the device test suite: one
 * minimal spec per grammar fn (drift-pinned against `listFieldFns` by
 * parity.test.ts) plus richer per-family variants exercising every
 * codegen shape the compiler can produce (noise normalization, worley
 * outputs/exact mode, fbm bases, ramp helpers, integer/bool attribute
 * marshalling, vec/swizzle, knife-edge-free branch ops). Test-only —
 * not exported from the package.
 *
 * Also home to the measured parity table ({@link PARITY_CASES}) and the
 * code-authored twin of every case in it ({@link DERIVED_FIELDS}). The
 * table lives here rather than in `parity.device.test.ts` because
 * `parity.test.ts` must pin the twins against the same authored specs
 * the device suite measures, and importing one `*.test.ts` from another
 * would re-register the device suite inside the CPU one.
 */
import {
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
  cross,
  distance,
  div,
  dot,
  exp,
  floor,
  fract,
  fraction,
  ge,
  length,
  lerp,
  log,
  max,
  min,
  mod,
  mul,
  normalize,
  position,
  pow,
  ramp,
  randomField,
  remap,
  select,
  sign,
  sin,
  smoothstep,
  sqrt,
  step,
  sub,
  tan,
  type Field,
  vec,
} from "../fields/index.js";
import { fbm, perlinNoise, simplexNoise, valueNoise, worleyNoise } from "../noise/index.js";
import type { FieldSpecArg } from "../fields/fieldJson.js";
import type { FieldKernelLayout } from "./types.js";

/** Layout matching the geometry `makeParityGeometry` builds. */
export const PARITY_LAYOUT: FieldKernelLayout = {
  attributes: {
    P: { type: "f32", tupleSize: 3 },
    density: { type: "f32", tupleSize: 1 },
    // Unit-length shading normal. Present so the corpus can carry the
    // `graphs/examples-forest.json` slope field verbatim (it reads `normal`); the
    // other suites' geometry gains one more f32x3 column, which nothing
    // pins.
    normal: { type: "f32", tupleSize: 3 },
    uv: { type: "f32", tupleSize: 2 },
    active: { type: "bool", tupleSize: 1 },
    id: { type: "u32", tupleSize: 1 },
    material: { type: "i32", tupleSize: 1 },
    // The only string column, and the only fns that read one are
    // `attributeIs` and `byAttribute`. It is here so the corpus can carry
    // them at all: a layout without a string attribute cannot compile
    // either.
    species: { type: "string", tupleSize: 1 },
  },
};

/** One minimal compilable spec per grammar fn (keys = `listFieldFns()`). */
export const MINIMAL_SPECS: Record<string, FieldSpecArg> = {
  fract: { fn: "fract", args: [{ fn: "attribute", name: "density" }] },
  // Dividend on the NEGATIVE side, because a floored modulo only differs
  // from a truncated one there.
  mod: { fn: "mod", args: [{ fn: "component", args: [{ fn: "position" }], index: 0 }, 8] },
  sign: { fn: "sign", args: [{ fn: "component", args: [{ fn: "position" }], index: 0 }] },
  exp: { fn: "exp", args: [{ fn: "attribute", name: "density" }] },
  // Guarded strictly positive: 0 is -Infinity and negatives are NaN.
  log: { fn: "log", args: [{ fn: "add", args: [{ fn: "abs", args: [{ fn: "attribute", name: "density" }] }, 0.5] }] },
  smoothstep: { fn: "smoothstep", args: [-4, 4, { fn: "component", args: [{ fn: "position" }], index: 0 }] },
  distance: { fn: "distance", args: [{ fn: "position" }, [0.25, -1.5, 2]] },
  constant: { fn: "constant", value: 1 },
  attribute: { fn: "attribute", name: "density" },
  // Parity here is EXACT rather than budgeted, on both sides: the CPU
  // compares two table indices and writes 0 or 1, and so does the kernel.
  // No float interior, so nothing to round. The literal is one the
  // fixture's table holds; the absent case is measured too, on the device
  // (see attributeIs.testsupport.ts), because it is the one whose answer
  // comes from a uniform the compiler could not have baked.
  attributeIs: { fn: "attributeIs", name: "species", value: "pine" },
  // Exact for the same reason, and the minimal spec deliberately mixes the
  // three shapes a case set can take: a key the fixture's table HOLDS, a
  // key it does not (which must take the default rather than throw), and a
  // scalar default broadcast against tuple cases.
  byAttribute: {
    fn: "byAttribute",
    name: "species",
    cases: { pine: [1, 2, 3], nothing_interns_this: [4, 5, 6] },
    default: 7,
  },
  position: { fn: "position" },
  index: { fn: "index" },
  fraction: { fn: "fraction" },
  nodeSeed: { fn: "nodeSeed" },
  randomField: { fn: "randomField" },
  // Keyed on a VALUE, so unlike `randomField` above it needs no identity
  // and lowers on any domain. The key is an attribute rather than a
  // literal so the case exercises a real per-element hash rather than a
  // constant the fold could swallow.
  randomFrom: { fn: "randomFrom", args: [{ fn: "attribute", name: "density" }], key: 0 },
  // Unbound: the front end must accept the uniform-slot lowering on the
  // name alone (a bound one produces the same kernel — the value never
  // reaches the WGSL text).
  param: { fn: "param", name: "amplitude" },
  add: { fn: "add", args: [1, 2] },
  sub: { fn: "sub", args: [1, 2] },
  mul: { fn: "mul", args: [1, 2] },
  div: { fn: "div", args: [1, 2] },
  min: { fn: "min", args: [1, 2] },
  max: { fn: "max", args: [1, 2] },
  abs: { fn: "abs", args: [-1] },
  floor: { fn: "floor", args: [1.5] },
  // 2 rather than 4: a perfect square is the one input class the device
  // gets exactly right (see `sqrt`'s note in combinators.ts), so a
  // minimal spec built on one would compile the same kernel while
  // reading as if the fn were exact. The literal is non-negative because
  // a negative one is NaN on both paths by construction.
  sqrt: { fn: "sqrt", args: [2] },
  // Base strictly positive, and that is a DOMAIN requirement rather than
  // a taste: `pow` follows the device's `exp2(b * log2(a))` identity, so
  // a zero or negative base is NaN on both paths and the minimal spec
  // would be a NaN kernel. Exponent 3 is an integer on purpose — the
  // case a reader is most likely to assume is exact, and is not.
  pow: { fn: "pow", args: [2, 3] },
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
  // Shaped like the compare fns above rather than like a threshold on a
  // field, because that is what it IS — `ge` with the operands swapped.
  // Reading `[1, 2]` as "edge 1, x 2" next to `ge: [1, 2]` is the whole
  // point: the two rows differ only in argument order.
  step: { fn: "step", args: [1, 2] },
  dot: { fn: "dot", args: [[1, 2, 3], [4, 5, 6]] },
  // Two explicit width-3 literals, mirroring `dot` so the pair reads
  // together — and unlike every other entry here it CANNOT be narrowed
  // to scalars: `cross` is the grammar's only width-specific fn and a
  // scalar argument is a compile error rather than a broadcast.
  cross: { fn: "cross", args: [[1, 2, 3], [4, 5, 6]] },
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
  // `fraction` as a CHILD, not a root: the minimal spec only covers the
  // root store path, and this is the idiom it exists for — a ramp read
  // along a cloud, which needs both endpoints of [0, 1] to be reached.
  fractionRamp: {
    fn: "ramp",
    args: [{ fn: "fraction" }],
    stops: [
      [0, 0],
      [0.5, 1],
      [1, 0],
    ],
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

  // The four fields `graphs/examples-forest.json` drives its scatter with, as the
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
export function paritySpecs(): Array<{ name: string; spec: FieldSpecArg }> {
  return [
    ...Object.entries(MINIMAL_SPECS).map(([name, spec]) => ({ name: `min:${name}`, spec })),
    ...Object.entries(EXTENDED_SPECS).map(([name, spec]) => ({ name, spec })),
  ];
}

// ---------------------------------------------------------------------------
// measured float-parity table
//
// Per-family budgets vs the CPU reference, measured on the reference
// adapter (RTX 5090, D3D12, Dawn) at PARITY_SEED over the corpus
// geometry, SWEPT across element counts 10 000 / 65 536 / 262 144 /
// 1 000 000. Every case records that sweep below, which is what makes
// each budget checkable rather than asserted.
//
// The four-count sweep is the DERIVATION, taken with a throwaway
// out-of-process probe (the 1M pass evaluates 44M CPU lanes — 40
// families, two of them vec3 — and is not something to pay for on
// every test run). What the suite re-checks on every run is
// PARITY_COUNT for every family, plus PARITY_SWEEP_COUNTS for the
// count-sensitive ones. Re-deriving means re-running the probe; the
// numbers below are what it must reproduce.
//
// Two metrics, kept together because they fail for different reasons:
//
// - `budget` bounds `rangeUlp` — the worst lane, |cpu - gpu| scaled to
//   ULP units at the top of the family's output range. It is an
//   EXTREME-VALUE statistic: sample more lanes and it climbs, because a
//   bigger cloud reaches further into the tail of the same distribution.
//   What it catches is a lane going structurally wrong.
// - `meanAbs` bounds the mean of |cpu - gpu| over lanes, in absolute
//   units. It is SAMPLE-SIZE STABLE: over the sweep it moves by at most
//   1.05x for every family whose mean is a sampling statistic (fbm
//   simplex 1.004x, valueNoise 1.026x, ramp 1.032x, sqrt 1.051x — the
//   worst, and all of that is the 10k pass being a small sample: sqrt's
//   65k/262k/1M means agree to 1.005x). `fraction` is the sole exception
//   and its own row says why. What this catches is a shift in the
//   interior, which a widened max budget would sleep through.
//
// Why the counts are swept at all: these budgets were originally
// max-over-lanes values measured at exactly 10 000 elements, which made
// them tuned to a cloud size rather than principled. Noise seeds ride in
// the spec, so seed is inert here and count was the only unpinned axis —
// and FIVE families already exceeded their own budget at ordinary point
// counts with nothing having regressed (six rows: valueNoise raw and
// normalized measure identically). valueNoise 6.53 at 10k, 8.02 at 65k,
// 10.44 at 1M against a budget of 8; fbm simplex 19.02 → 32.18 against
// 24; fbm value 4.32 → 6.16 against 6; perlin raw 7.69 → 10.63 against
// 10; composite 8.78 → 17.05 against 12. Three of the six fail by
// 65 536, four by 262 144, all six by 1M.
//
// Budget derivation — one rule, checkable against the numbers on each
// case:
//
// - `budget` = the first value on the ladder {1, 2, 4, 6, 8, 10, 12, 16,
//   20, 24, 32, 40, 48, 64, 96, 128, 192, 256, 384, 512, 640} at or
//   above N x the largest rangeUlp measured anywhere in the sweep, with
//   N = 1.5 for families whose maximum GROWS with count and N = 1.25 for
//   families whose maximum has SATURATED. The ladder is spelled out so
//   "rounded up to something readable" is checkable rather than a matter
//   of taste; it is what makes every budget re-derivable from the
//   numbers on its own row.
//
//   The growth split is measured, not judged. Comparing the 1M value to
//   the 10k value, the growing families gain 4.7% (perlin normalized) to
//   94% (composite), while the saturated ones move between -4.4% (dot)
//   and +0.6% (asin) — no trend, just sampling wobble. A saturated
//   family's error is bounded by the op's own absolute-error allowance
//   (asin/acos are the clearest case), so sampling more lanes cannot
//   find a worse one.
//
//   1.5x follows the measured growth law: the extreme value grows
//   roughly logarithmically in the count, at +0.1 to +2 rangeUlp per
//   decade for most families and +2.6 (simplex raw), +4.1 (composite),
//   +6.3 (fbm simplex) for the steep ones. Divide each budget's headroom
//   by its own slope and every family has at least 2.8 more decades of
//   count before it would trip — valueNoise is the tightest at 2.8, fbm
//   simplex has 5.1 — which is far enough to be a property of the family
//   and near enough that a distribution shift still trips it.
// - `meanAbs` = the smallest two-significant-digit value at or above
//   1.25x the largest meanAbs in the sweep. 1.25x, not 1.5x, because the
//   statistic's own sample-size drift is <= 1.04x; the rest of the
//   margin is for adapter-to-adapter difference, not for growth.
//
// `countSensitive` marks the growing families: they take the 1.5x rule
// and they are re-measured at every PARITY_SWEEP_COUNTS by
// parity.device.test.ts, so the count axis cannot drift unpinned again.
//
// A different adapter exceeding a budget is a finding, not noise. Raw
// `maxUlp` is logged but never budgeted for a non-`exact` family: it
// inflates at output zero-crossings, where the CPU's f64 interior
// survives cancellation that f32 cannot.
//
// SCOPE, measured rather than assumed: a budget bounds the family AS
// PARAMETERISED HERE, not the grammar fn in general. The noise options
// move it, and not always in the direction you would guess — at 1M
// elements, `{fn:"simplexNoise"}` with default options measures
// rangeUlp 48.86 against this table's 22.56 at frequency 0.4, while
// `{fn:"valueNoise"}` measures 5.64 against this table's 10.44. Read a
// row as "this expression, this adapter, this count range", and measure
// again before quoting one at a different frequency.
//
// What is NOT parameter-dependent, at 1M elements: the divergence stays
// rounding-class. `select(gt(perlinNoise, 0))` flips 0 lanes in
// 1 000 000; worley's worst lane is 8.3e-7 absolute, where picking a
// different cell would move f1 by O(0.1); `normalized: true` damps the
// error rather than amplifying it; and fbm does not compound
// disproportionately with octaves.

/** One measured float-parity family: an authored spec and its budgets. */
export interface ParityCase {
  readonly name: string;
  readonly spec: FieldSpecArg;
  /** Assert raw maxUlp 0 (bit-exact family) instead of the budgets. */
  readonly exact?: boolean;
  /** rangeUlp budget (worst lane, in ULP units at the output range top). */
  readonly budget: number;
  /** Mean |cpu - gpu| budget, in absolute units — the stable sentinel. */
  readonly meanAbs: number;
  /**
   * This family's rangeUlp grows with element count, so it takes the
   * 1.5x headroom rule and is swept across PARITY_SWEEP_COUNTS.
   */
  readonly countSensitive?: boolean;
}

/**
 * Element count every per-family budget is asserted at, and the seed.
 *
 * 65 536 rather than the 10 000 this table was first measured at: 10k is
 * smaller than an ordinary point cloud, and it under-sampled the
 * extreme-value tail badly enough that five families passed only because
 * of the count — valueNoise measures 8.02 here against its old budget of
 * 8. The move costs ~5.5 s per measured pass (7.8 s vs 2.2 s), nearly
 * all of it the CPU reference rather than the device.
 */
export const PARITY_COUNT = 65_536;
export const PARITY_SEED = 1;

/**
 * Counts every `countSensitive` family is re-measured at, which is what
 * makes its budget a statement about the family rather than about one
 * cloud size.
 *
 * These BRACKET `PARITY_COUNT` rather than including it: the two
 * measured passes above already measure every family at the pinned
 * count, so re-measuring it here would buy nothing and cost the most
 * expensive thing in this suite — the CPU reference evaluation, which
 * runs ~3.8x slower inside a vitest worker than in the plain-Node
 * device runner (measured, not assumed).
 *
 * The ceiling is 131 072 because the cost is linear in it and the
 * information is logarithmic: this sweep spans 1.1 decades of count,
 * which is enough to catch a family whose worst lane starts climbing,
 * while 262 144 cost 16 s more per test run for 0.3 decades more span.
 * Nothing in the DERIVATION depends on the ceiling — the budgets are
 * anchored at a 1 000 000-element measurement taken out of process and
 * recorded per case — so raising it re-checks, it does not re-derive.
 */
export const PARITY_SWEEP_COUNTS: readonly number[] = [10_000, 131_072];

const P = { fn: "position" } as const;
const PX = { fn: "component", args: [P], index: 0 } as const;
const PY = { fn: "component", args: [P], index: 1 } as const;

// PROVENANCE. Rows carrying four figures (`rangeUlp a/b/c/d`) are historical
// anchors from a sweep at 10k/65k/262k/1M that the harness no longer runs:
// PARITY_SWEEP_COUNTS is [10_000, 131_072] and PARITY_COUNT is 65_536, so
// what CI re-measures every run is two counts plus the fixed one. Rows added
// since say which counts they were measured at rather than inheriting a
// header that describes a wider sweep than the one that produced them.
export const PARITY_CASES: ParityCase[] = [
  // rangeUlp 0 and maxUlp 0 at every count — double rounding is
  // innocuous for + - ×.
  { name: "arith add/sub/mul", spec: EXTENDED_SPECS.arithChain, exact: true, budget: 0, meanAbs: 0 },
  // rangeUlp 0.76/0.76/0.75/0.75 — saturated: one f32 division, bounded
  // by the 2.5-ULP WGSL bound and not by how many lanes are sampled.
  // budget 1 = 1.31x the sweep max; meanAbs 2.0e-8 = 1.27x of 1.58e-8.
  { name: "div", spec: EXTENDED_SPECS.divChain, budget: 1, meanAbs: 2.0e-8 },
  // rangeUlp 0.50/0.50/0.50/0.50 — one f32 division of two exact
  // integers, so it sits in the `div` family and takes its budget rather
  // than claiming bit-exactness (the CPU divides in f64 and rounds once;
  // WGSL promises only 2.5 ULP). budget 1 = 2.00x the sweep max.
  // meanAbs is NOT a sampling statistic here — `fraction` is a function
  // of the COUNT itself, and its mean wanders by 1420x over the sweep
  // (1.03e-8 at 1M, 1.2e-10 at 65k) without meaning anything — so the
  // 1.25x rule is meaningless for it. It takes the CORRECTLY-ROUNDED
  // bound instead: half an ULP at the top of [0, 1] is 5.96e-8, which
  // this adapter meets with 5.8x to spare on the worst count measured.
  // That is deliberately stricter than the WGSL guarantee, which is 2.5
  // ULP (2.98e-7): an adapter spending its full allowance here would
  // trip this budget, and that is a finding worth seeing rather than
  // noise to absorb. The count sweep — including the degenerate counts,
  // which ARE bit-exact — is pinned separately in parity.device.test.ts.
  { name: "fraction", spec: { fn: "fraction" }, budget: 1, meanAbs: 6.0e-8 },
  // rangeUlp 0.50/0.50/0.50/0.50, saturated; maxUlp 57138 at 1M is the
  // usual zero-crossing spike. budget 1 = 1.99x; meanAbs 7.3e-8 = 1.27x.
  { name: "lerp", spec: { fn: "lerp", args: [PX, PY, { fn: "attribute", name: "density" }] }, budget: 1, meanAbs: 7.3e-8 },
  // rangeUlp 0 and maxUlp 0 at every count.
  { name: "clamp/min/max", spec: { fn: "clamp", args: [PX, { fn: "min", args: [PY, 0] }, { fn: "max", args: [{ fn: "abs", args: [PY] }, 1] }] }, exact: true, budget: 0, meanAbs: 0 },
  // rangeUlp 0 and maxUlp 0 at every count.
  { name: "floor", spec: { fn: "floor", args: [PX] }, exact: true, budget: 0, meanAbs: 0 },
  // rangeUlp 0 and meanAbs 0 at every count, over a non-degenerate span:
  // this remap divides by 16, so the one division is exact. Budgeted at
  // the `div` family's bound rather than at 0 anyway — the family is one
  // f32 division, and pinning it to an accident of these constants would
  // fail the moment the span stopped being a power of two. meanAbs takes
  // the same correctly-rounded bound `fraction` does (half an ULP at
  // 1.0). Both budgets are therefore loose here BY CONSTRUCTION: for
  // this row they assert the family's arithmetic class, and the exact-0
  // measurement is what the comment carries.
  { name: "remap", spec: EXTENDED_SPECS.remapField, budget: 1, meanAbs: 6.0e-8 },
  // rangeUlp 1.09/1.27/1.27/1.27 — baked f32 stop constants vs CPU f64
  // segments; maxUlp 9.2e6 at 1M at segment zero crossings.
  // budget 2 = 1.57x the sweep max; meanAbs 3.8e-9 = 1.27x of 3.00e-9.
  { name: "ramp", spec: EXTENDED_SPECS.rampMultiStop, budget: 2, meanAbs: 3.8e-9, countSensitive: true },
  // rangeUlp 0 and maxUlp 0 at every count, away from knife edges.
  { name: "select/compare", spec: EXTENDED_SPECS.selectAway, exact: true, budget: 0, meanAbs: 0 },
  // rangeUlp 0 and maxUlp 0 at every count, and exact BY CONSTRUCTION
  // rather than by measurement: `step` lowers to `ge`'s
  // `select(0, 1, x >= edge)` (see the note in compile.ts on why the
  // WGSL `step()` builtin is not emitted), and both operands here are
  // attribute reads that are already bit-identical on the two paths, so
  // there is no rounding left to disagree about.
  // Both branches are populated — 49.6/49.8/50.0/50.1% of lanes answer
  // 1 across the sweep — because an all-zero or all-one output would
  // score exact while testing nothing. The edge VARIES per lane for the
  // same reason: a constant edge would not notice the operands being
  // swapped, which is the one mistake this fn's argument order invites.
  // Falsifiable, and checked: reversing the CPU comparison to
  // `v[0] >= v[1]` turns this row red on 99.99% of lanes.
  { name: "step", spec: { fn: "step", args: [PY, PX] }, exact: true, budget: 0, meanAbs: 0 },
  // The four rows that follow are exact BY CONSTRUCTION rather than by a
  // budget, with ONE contract-level exception they share with every other
  // row in this table: a SUBNORMAL INPUT is flushed to zero on the device
  // and kept on the CPU, so `sign(1e-40)` is 1 here and 0 there. That is
  // f32 denormal flushing rather than anything these fns do, it is the
  // same contract `subnormalMul` measures, and the edge probe in
  // parity.device.test.ts asserts it explicitly so the exactness claims
  // above cannot be read as covering it.
  //
  // rangeUlp 0 and maxUlp 0 at every count: `x - floor(x)` on both sides, two operations that are each exact in
  // f32. WGSL's `fract()` is specified as the same expansion, so emitting
  // the builtin would very likely measure the same — writing it out is what
  // makes "the same" a property of the text rather than of this adapter.
  // Falsifiable, and checked: emitting `floor` in place of the subtraction
  // reddens this row.
  { name: "fract", spec: { fn: "fract", args: [PX] }, exact: true, budget: 0, meanAbs: 0 },
  // rangeUlp 0 and maxUlp 0 at every count, and the exactness is EARNED
  // rather than inherited: the CPU rounds each of the four operations to
  // f32 individually (`Math.fround` around the divide, the multiply and the
  // subtraction) so that it runs the device's expansion step for step. The
  // f64-accumulate-then-round-once path that every other `elementwise` fn
  // takes would NOT be exact here — that is the same trade `cross` makes.
  // The dividend spans both signs, so the floored-vs-truncated difference
  // is inside the measured domain rather than beside it. Falsifiable, and checked: emitting WGSL's `%` reddens this
  // row, and only the negative half of the cloud can be what does it,
  // since the two definitions agree above zero.
  { name: "mod", spec: { fn: "mod", args: [PX, 8] }, exact: true, budget: 0, meanAbs: 0 },
  // rangeUlp 0 and maxUlp 0 at every count. Exact for `step`'s reason: the
  // lowering is a pair of comparisons, and a comparison has no interior to
  // round. The coordinate read here spans both signs, so a reversed
  // comparison cannot hide in a cloud that is all one sign — falsifiable,
  // and checked: swapping the two comparisons reddens this row.
  { name: "sign", spec: { fn: "sign", args: [PX] }, exact: true, budget: 0, meanAbs: 0 },
  // rangeUlp 0 and maxUlp 0 at every count, which was NOT a given: this is
  // a five-operation interior, and it is exact only because the CPU rounds
  // each of them to f32 in the same order the kernel does. The edges are
  // -4 and 4 against a coordinate spanning [-8, 8], so a large share of the
  // lanes land in the curve rather than on a clamped end — an all-clamped
  // domain would score exact while measuring nothing but `clamp`.
  // Falsifiable, and checked: emitting WGSL's `smoothstep()` builtin over
  // the same clamped t reddens this row, which is the measurement behind
  // the decision to expand it rather than call it.
  { name: "smoothstep", spec: { fn: "smoothstep", args: [-4, 4, PX] }, exact: true, budget: 0, meanAbs: 0 },
  // rangeUlp 3.44 -> 4.12 over 10k -> 131k, 4.13 at 65k, and 4.12 again at
  // 1M on a widened anchor run: it GROWS 1.20x over the first two decades
  // and then SATURATES, so 4.12 is the bound rather than the largest sample
  // so far. One of the two genuinely transcendental additions: the device
  // has its own exp and the CPU has `Math.exp`, and they are simply not the
  // same function. budget 8 = 1.94x, matching `pow`, whose device lowering
  // is exp2 of a product and so is the same machinery.
  // meanAbs 3.8e-5 = 1.24x of the measured 3.06e-5 at 1M.
  { name: "exp", spec: { fn: "exp", args: [PX] }, budget: 8, meanAbs: 3.8e-5, countSensitive: true },
  // rangeUlp 0.93/0.93 over 10k -> 131k and 0.93 again at 1M — dead flat to
  // three significant figures across two further decades. budget 2 = 2.15x;
  // meanAbs 5.5e-8 = 1.25x of 4.38e-8.
  // THE RAW maxUlp IS 4843 AND THAT IS NOT A DEFECT, it is the clearest
  // demonstration in the table of why `rangeUlp` is the metric. `log`
  // crosses zero at x = 1, and an absolute error of 4.4e-8 beside an output
  // of 1e-11 is thousands of ULP OF THAT OUTPUT while being a thousandth of
  // one ULP of the family's range. Budgeting the raw figure would demand
  // 6000 here and would still say nothing about the answers anyone reads.
  { name: "log", spec: { fn: "log", args: [{ fn: "add", args: [{ fn: "abs", args: [PX] }, 0.5] }] }, budget: 2, meanAbs: 5.5e-8, countSensitive: true },
  // rangeUlp 0.52/0.51 — saturated, and 0.5 is the floor rather than a
  // coincidence: maxUlp is 1, so the worst lane is a single f32 ULP and the
  // result is correctly rounded everywhere else. It measures BETTER than
  // `length/normalize` (budget 4) because that family compounds two fns in
  // one spec; this one is the same sqrt over a subtraction the CPU also
  // rounds to f32, which is what makes `distance(a, b)` and
  // `length(sub(a, b))` the same number on both paths.
  // budget 1 = 1.92x the sweep max (0.52/0.50 over 10k -> 131k, 0.50 at 1M);
  // meanAbs 1.9e-7 = 1.24x of 1.53e-7.
  { name: "distance", spec: { fn: "distance", args: [P, { fn: "vec", args: [0.25, -1.5, 2] }] }, budget: 1, meanAbs: 1.9e-7, countSensitive: true },
  // rangeUlp 6.50/6.50/7.13/7.13 over inputs in [-8, 8].
  // budget 12 = 1.68x the sweep max; meanAbs 3.2e-7 = 1.28x of 2.51e-7.
  { name: "sin/cos", spec: EXTENDED_SPECS.trigChain, budget: 12, meanAbs: 3.2e-7, countSensitive: true },
  // rangeUlp 19.48/22.34/22.34/22.34 over inputs in [-1.45, 1.45].
  // budget 40 = 1.79x the sweep max; meanAbs 6.5e-7 = 1.25x of 5.20e-7.
  { name: "tan", spec: { fn: "tan", args: [{ fn: "remap", args: [PX, -8, 8, -1.45, 1.45] }] }, budget: 40, meanAbs: 6.5e-7, countSensitive: true },
  // rangeUlp 503.99/506.04/506.89/506.98 — saturated (1.006x over two
  // decades): the worst lane is ≈ 6.8e-5 absolute, which matches the WGSL
  // asin absolute-error class, so more lanes cannot find a worse one.
  // budget 640 = 1.26x the sweep max; meanAbs 3.9e-5 = 1.25x of the
  // measured mean 3.11e-5. The old budget of 512 sat 1.01x above the
  // measurement, which is a knife edge rather than a bound.
  { name: "asin", spec: EXTENDED_SPECS.inverseTrig, budget: 640, meanAbs: 3.9e-5 },
  // rangeUlp 359.09/360.97/360.96/360.96 — same absolute-error class as
  // asin, equally saturated. budget 512 = 1.42x; meanAbs 3.8e-5 = 1.28x.
  { name: "acos", spec: { fn: "acos", args: [{ fn: "clamp", args: [{ fn: "attribute", name: "density" }, -0.9, 0.9] }] }, budget: 512, meanAbs: 3.8e-5 },
  // rangeUlp 64.52/64.33/64.33/64.32 — saturated.
  // budget 96 = 1.49x the sweep max; meanAbs 9.2e-6 = 1.25x of 7.34e-6.
  { name: "atan2", spec: EXTENDED_SPECS.atanFamily, budget: 96, meanAbs: 9.2e-6 },
  // rangeUlp 67.06/67.06/67.06/67.06 — saturated, flat to four
  // significant figures.
  // budget 96 = 1.43x the sweep max; meanAbs 1.1e-5 = 1.36x of 8.10e-6.
  { name: "atan", spec: { fn: "atan", args: [PX] }, budget: 96, meanAbs: 1.1e-5 },
  // rangeUlp 1.50/2.00/2.00/2.00 — sqrt / 1-over-sqrt correctly rounded
  // on this adapter, but the worst lane grows 1.33x over the sweep and
  // the old budget of 2 was EXACTLY the measurement from 65k up.
  // budget 4 = 2.00x the sweep max; meanAbs 2.0e-7 = 1.27x of 1.58e-7.
  { name: "length/normalize", spec: EXTENDED_SPECS.lengthNormalize, budget: 4, meanAbs: 2.0e-7, countSensitive: true },
  // rangeUlp 0.71/0.71/0.71/0.71 — dead flat (-0.01% over the sweep),
  // and 0.7071 is not a coincidence: it is 2 / sqrt(8), one f32 ULP in
  // the binade [2, 4) expressed in units of this family's range top. So
  // the worst lane is EXACTLY one ULP, which the raw maxUlp confirms
  // directly — 1 at every count, with 16.2/16.7/16.9/16.8% of lanes off
  // by one and NONE off by two. The DEVICE is the inaccurate side here
  // (rsqrt plus refinement, against a correctly rounded `Math.sqrt`),
  // and its error is bounded by the refinement rather than by the
  // sampling, so more lanes cannot find a worse one: saturated.
  // The `abs` is a DOMAIN GUARD, not tidiness — it makes the argument
  // non-negative over the whole cloud. sqrt of a negative is NaN on both
  // paths by design; device NaN is 0x7fffffff against JS's 0x7fc00000,
  // and |cpu - gpu| is NaN whenever either side is, which is not `>` any
  // budget and would slip through every threshold here. (`nanLanes` in
  // parity.device.test.ts now catches that too; the guard is what keeps
  // it from having to.) Domain agreement belongs in the CPU-side unit
  // tests. Do NOT simplify it away.
  // budget 1 = 1.41x the sweep max; meanAbs 3.6e-8 = 1.26x of 2.86e-8.
  { name: "sqrt", spec: { fn: "sqrt", args: [{ fn: "abs", args: [PX] }] }, budget: 1, meanAbs: 3.6e-8 },
  // rangeUlp 4.31/3.94/5.07/5.05, and the grammar's widest ELEMENTWISE
  // budget outside the inverse-trig pair. It GROWS with count (+17% from
  // 10k to 1M, against -4.4%..+0.6% for the saturated families), so it
  // takes the 1.5x rule and joins the sweep — the same relative-error
  // tail `tan` and `sin/cos` have, not the absolute-error ceiling that
  // saturates `asin`. The growth is real but sparse: the worst lane's
  // ABSOLUTE error takes only two values across the whole sweep (2.75e-4
  // at 10k and 65k, 3.66e-4 at 262k and 1M) while raw maxUlp climbs
  // 9/12/12/13. The interior does not move with it — meanAbs varies
  // 1.03x — and the per-lane distribution is stable to a tenth of a
  // percent: 37.0% of lanes bit-exact, 40.5% off by 1 ULP, the tail
  // thinning ~2.8x per further ULP out to 13.
  // DOMAIN GUARD, load-bearing: the base is `abs(P.x) + 0.5`, so it is
  // STRICTLY POSITIVE (min 0.500002 at 1M) and finite everywhere. A
  // negative or zero base is NaN BY DESIGN — the CPU adopts the device's
  // `exp2(b * log2(a))` domain — and a NaN lane poisons this comparison
  // rather than failing it (see the sqrt row above for why). That the
  // two paths agree on WHERE the answer is NaN is a CPU-side unit test's
  // job, not this float corpus's. Do NOT simplify the guard away.
  // The exponent is `P.y * 0.375` rather than a `remap` into [-3, 3] on
  // purpose. Both arguments were measured bit-exact on both paths at
  // every count (maxUlp 0, 100% of lanes), so this row measures `pow`
  // ALONE; a remap would have fed a 1-ULP exponent difference into a
  // function that amplifies it by ~6 ULP at exponent 3, and the row
  // would have been reporting remap's rounding as pow's.
  // budget 8 = 1.58x the sweep max; meanAbs 2.9e-6 = 1.29x of 2.24e-6.
  {
    name: "pow",
    spec: {
      fn: "pow",
      args: [
        { fn: "add", args: [{ fn: "abs", args: [PX] }, 0.5] },
        { fn: "mul", args: [PY, 0.375] },
      ],
    },
    budget: 8,
    meanAbs: 2.9e-6,
    countSensitive: true,
  },
  // rangeUlp 0.70/0.69/0.68/0.67 — saturated (f32 dot accumulation vs
  // CPU f64). budget 1 = 1.43x; meanAbs 7.4e-8 = 1.25x of 5.91e-8.
  { name: "dot", spec: EXTENDED_SPECS.dotField, budget: 1, meanAbs: 7.4e-8 },
  // rangeUlp 0 and maxUlp 0 at every count, over 3 000 000 lanes at the
  // 1M pass — and against two genuinely varying vec3 inputs (P crossed
  // with the unit shading normal), not a vector against a constant,
  // because a constant operand would exercise three of the six products
  // as multiplications by a compile-time literal.
  // The one COMPOUND fn in the grammar that is bit-exact, where its
  // neighbours `dot` and `length/normalize` both carry budgets, and it
  // is exact by choice rather than by luck: the CPU rounds each of the
  // six products to f32 with `Math.fround` before subtracting, matching
  // the device's `cross` builtin step for step, where accumulating in
  // f64 and rounding once would be 539 ULP out.
  // Falsifiable, and checked: dropping a single `Math.fround` from the
  // CPU expansion turns this row red.
  // It is also the table's second vec3-valued family, and like the first
  // (`select/compare`) it is `exact` — which is what keeps measureParity's
  // one-range-per-column caveat from biting: a budgeted vec family would
  // score its small component in the largest one's units.
  {
    name: "cross",
    spec: { fn: "cross", args: [P, { fn: "attribute", name: "normal", tupleSize: 3 }] },
    exact: true,
    budget: 0,
    meanAbs: 0,
  },
  // rangeUlp 6.53/8.02/10.26/10.44 — the family that exposed the whole
  // problem: the old budget of 8 was measured at 10k and is exceeded at
  // 65k by an unchanged compiler. budget 16 = 1.53x the sweep max
  // (1.99x at the pinned count); meanAbs 7.0e-8 = 1.26x of 5.57e-8.
  { name: "valueNoise raw", spec: { fn: "valueNoise", opts: { seed: 7, frequency: 0.35 } }, budget: 16, meanAbs: 7.0e-8, countSensitive: true },
  // Identical numbers to the raw case: `normalized` is an affine remap
  // of the same lattice, so it damps rather than amplifies.
  { name: "valueNoise normalized", spec: EXTENDED_SPECS.valueNoiseNorm, budget: 16, meanAbs: 7.0e-8, countSensitive: true },
  // rangeUlp 7.69/8.25/8.86/10.63 (old budget 10, exceeded at 1M);
  // maxUlp 6.2e5 at 1M at the noise's zero crossings.
  // budget 16 = 1.50x the sweep max; meanAbs 7.6e-8 = 1.25x of 6.07e-8.
  { name: "perlinNoise raw", spec: { fn: "perlinNoise", opts: { seed: 3, frequency: 0.5 } }, budget: 16, meanAbs: 7.6e-8, countSensitive: true },
  // rangeUlp 4.21/4.44/4.43/4.41 — normalization damps here too.
  // budget 8 = 1.80x the sweep max; meanAbs 3.8e-8 = 1.26x of 3.02e-8.
  { name: "perlinNoise normalized", spec: EXTENDED_SPECS.perlinNoiseNorm, budget: 8, meanAbs: 3.8e-8, countSensitive: true },
  // rangeUlp 17.46/20.84/21.23/22.56 — the steepest of the single-octave
  // bases (+2.6 rangeUlp per decade of count).
  // budget 40 = 1.77x the sweep max; meanAbs 2.6e-7 = 1.30x of 2.00e-7.
  { name: "simplexNoise raw", spec: { fn: "simplexNoise", opts: { seed: 11, frequency: 0.4 } }, budget: 40, meanAbs: 2.6e-7, countSensitive: true },
  // rangeUlp 8.55/9.81/10.33/10.85.
  // budget 20 = 1.84x the sweep max; meanAbs 1.3e-7 = 1.30x of 1.00e-7.
  { name: "simplexNoise normalized", spec: EXTENDED_SPECS.simplexNoiseNorm, budget: 20, meanAbs: 1.3e-7, countSensitive: true },
  // rangeUlp 5.16/5.80/5.80/6.00 — which is 8.3e-7 ABSOLUTE at the worst
  // lane of 1M, and that is the proof the cell walk never picks a
  // different cell: a different cell would move f1 by O(0.1), not by
  // 1e-6. The divergence is the distance arithmetic inside one cell.
  // budget 10 = 1.67x the sweep max; meanAbs 1.5e-7 = 1.26x of 1.19e-7.
  { name: "worley f1", spec: EXTENDED_SPECS.worleyF1, budget: 10, meanAbs: 1.5e-7, countSensitive: true },
  // rangeUlp 4.71/4.97/5.30/5.71.
  // budget 10 = 1.75x the sweep max; meanAbs 1.5e-7 = 1.27x of 1.19e-7.
  { name: "worley f2", spec: EXTENDED_SPECS.worleyF2, budget: 10, meanAbs: 1.5e-7, countSensitive: true },
  // rangeUlp 9.42/10.17/9.96/10.64 — the f2-f1 difference cancels, which
  // is why maxUlp reaches 5.7e6 at 1M while rangeUlp stays in this band.
  // budget 16 = 1.50x the sweep max; meanAbs 9.0e-8 = 1.26x of 7.14e-8.
  { name: "worley f2-f1 normalized", spec: EXTENDED_SPECS.worleyF2F1Norm, budget: 16, meanAbs: 9.0e-8, countSensitive: true },
  // rangeUlp 9.28/9.72/10.14/10.38 — `exact: true` (the full 5x5x5 walk)
  // is the same error class as the pruned walk, not a worse one.
  // budget 16 = 1.54x the sweep max; meanAbs 2.3e-7 = 1.31x of 1.76e-7.
  { name: "worley exact f2-f1", spec: EXTENDED_SPECS.worleyExact, budget: 16, meanAbs: 2.3e-7, countSensitive: true },
  // rangeUlp 4.32/5.02/6.16/6.12 (old budget 6, exceeded at 262k). Five
  // octaves do NOT compound disproportionately: the sum stays in the
  // single-octave error class because the gain series damps it.
  // budget 10 = 1.62x the sweep max; meanAbs 7.8e-8 = 1.26x of 6.18e-8.
  { name: "fbm value", spec: EXTENDED_SPECS.fbmValue, budget: 10, meanAbs: 7.8e-8, countSensitive: true },
  // rangeUlp 4.84/4.70/4.95/5.90.
  // budget 10 = 1.70x the sweep max; meanAbs 5.1e-8 = 1.26x of 4.05e-8.
  { name: "fbm perlin", spec: EXTENDED_SPECS.fbmPerlin, budget: 10, meanAbs: 5.1e-8, countSensitive: true },
  // rangeUlp 19.02/25.67/32.18/31.67 — the widest budget of any noise
  // family, and the steepest growth (+6.3 rangeUlp per decade): three RAW
  // simplex octaves, summed without the normalization that damps the
  // others. Old budget 24, exceeded at 65k.
  // budget 64 = 1.99x the sweep max; meanAbs 4.6e-7 = 1.26x of 3.64e-7.
  { name: "fbm simplex", spec: EXTENDED_SPECS.fbmSimplex, budget: 64, meanAbs: 4.6e-7, countSensitive: true },
  // rangeUlp 4.81/4.66/5.10/5.10 — the flattest fbm (1.06x over the
  // sweep). budget 8 = 1.57x the sweep max; meanAbs 4.7e-8 = 1.27x.
  { name: "fbm worley", spec: EXTENDED_SPECS.fbmWorley, budget: 8, meanAbs: 4.7e-8, countSensitive: true },
  // rangeUlp 8.78/9.30/11.48/17.05 — steeper than any of its parts
  // (1.94x over the sweep, the worst in the table) because the ramp's
  // middle segment has slope 2.33 and multiplies the perlin error by it.
  // Old budget 12, exceeded at 1M. budget 32 = 1.88x the sweep max
  // (3.44x at the pinned count); meanAbs 7.4e-8 = 1.26x of 5.88e-8.
  { name: "composite", spec: EXTENDED_SPECS.composite, budget: 32, meanAbs: 7.4e-8, countSensitive: true },
  // -- examples-forest, classified into the families above ------------------
  // attribute read (a component of P, no arithmetic): 0 at every count.
  { name: "forest height", spec: EXTENDED_SPECS.forestHeight, exact: true, budget: 0, meanAbs: 0 },
  // add/sub over an attribute read: 0 at every count.
  { name: "forest slope", spec: EXTENDED_SPECS.forestSlope, exact: true, budget: 0, meanAbs: 0 },
  // remap (of a bit-exact hash stream): rangeUlp 0.67 at every count,
  // saturated — inside the remap family's budget of 1, so no widening.
  // meanAbs 2.4e-8 = 1.26x of 1.91e-8.
  { name: "forest size", spec: EXTENDED_SPECS.forestSize, budget: 1, meanAbs: 2.4e-8 },
  // compare: 0 at every count.
  { name: "forest species", spec: EXTENDED_SPECS.forestSpecies, exact: true, budget: 0, meanAbs: 0 },
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
// in parity.test.ts, and building the tree at call time keeps module
// import free of noise construction.

const px = (): Field => component(position(), 0);
const py = (): Field => component(position(), 1);
const pz = (): Field => component(position(), 2);
const density = (): Field => attribute("density");

export const DERIVED_FIELDS: Record<string, () => Field> = {
  "arith add/sub/mul": () => sub(mul(add(px(), 1.5), py()), density()),
  div: () => div(px(), add(abs(pz()), 3)),
  fraction: () => fraction(),
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
  step: () => step(py(), px()),
  fract: () => fract(px()),
  mod: () => mod(px(), 8),
  sign: () => sign(px()),
  smoothstep: () => smoothstep(-4, 4, px()),
  exp: () => exp(px()),
  log: () => log(add(abs(px()), 0.5)),
  distance: () => distance(position(), vec(0.25, -1.5, 2)),
  sqrt: () => sqrt(abs(px())),
  pow: () => pow(add(abs(px()), 0.5), mul(py(), 0.375)),
  cross: () => cross(position(), attribute("normal", 3)),
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
  // examples-forest, verbatim (MAX_TREE_SCALE inlined as 1.5).
  "forest height": () => component(position(), 1),
  "forest slope": () => sub(1, component(attribute("normal", 3), 1)),
  "forest size": () => remap(randomField("size"), 0, 1, 0.6, 1.5),
  "forest species": () => ge(randomField("species"), 0.72),
};
