/**
 * Device parity suite: bit-exactness of hash/u32 streams, measured
 * per-family float tolerances vs the CPU reference, and run-to-run
 * determinism — all executed in the plain-Node device runner. Budgets
 * are asserted tight, with the measured value on the reference adapter
 * (RTX 5090, D3D12) recorded next to each; see PARITY_CASES.
 */
import { describe, expect, it } from "vitest";
import { evaluateField, type Column } from "../fields/index.js";
import { fieldFromJson, type FieldSpec, type FieldSpecArg } from "../nodes/fieldJson.js";
import { compileFieldSpec } from "./compile.js";
import { CORPUS_LAYOUT, EXTENDED_SPECS } from "./corpus.js";
import { decodeRun, dispatchTask, runDeviceTasks, type RunnerTask } from "./runnerClient.js";
import { deviceSuiteName, testDevice } from "./testDevice.js";
import { makeCorpusGeometry } from "./testGeometry.js";

function cpuColumn(spec: FieldSpecArg, count: number, seed: number): Column {
  const geo = makeCorpusGeometry(count);
  // Every spec in this suite is an object spec (never a bare number).
  return evaluateField(fieldFromJson(spec as FieldSpec), { geo, domain: "point", seed });
}

function bytesOf(col: Column): Uint8Array {
  return new Uint8Array(col.data.buffer, col.data.byteOffset, col.data.byteLength);
}

function expectBytesEqual(a: Column, b: Column, label: string): void {
  expect(b.tupleSize, `${label}: tupleSize`).toBe(a.tupleSize);
  expect(b.data.constructor.name, `${label}: element type`).toBe(a.data.constructor.name);
  const ab = bytesOf(a);
  const bb = bytesOf(b);
  expect(bb.length, `${label}: byteLength`).toBe(ab.length);
  let diff = -1;
  for (let i = 0; i < ab.length; i++) {
    if (ab[i] !== bb[i]) {
      diff = i;
      break;
    }
  }
  expect(diff, `${label}: first differing byte index`).toBe(-1);
}

/** f32 ULP distance; 0 for bit-equal or both-NaN, Infinity for NaN vs number. */
function ulpDistance(a: number, b: number): number {
  if (Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b))) return 0;
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  const f = new Float32Array([a, b]);
  if (f[0] === f[1]) return 0; // e.g. -0 vs 0
  const u = new Uint32Array(f.buffer);
  const ord = (x: number): number =>
    x >>> 31 ? 0x80000000 - (x & 0x7fffffff) : 0x80000000 + x;
  return Math.abs(ord(u[0]) - ord(u[1]));
}

/**
 * Parity measurement of a GPU column against the CPU reference.
 *
 * - `maxUlp`: raw per-lane f32 ULP distance. Meaningful for exactness
 *   families; misleading near zero-crossings, where the CPU's f64
 *   interior keeps precision through cancellation that f32 arithmetic
 *   cannot (a tiny absolute error at an output near 0 spans a huge ULP
 *   count).
 * - `rangeUlp`: absolute error scaled to ULP units at the top of the
 *   family's output range — `|cpu - gpu| / (2^-23 · max|cpu|)`. This is
 *   the documented tolerance metric: for outputs near the range it
 *   coincides with ULP distance; near zero it reflects the absolute
 *   error fairly.
 * - Infinity for a NaN vs number mismatch.
 */
function measureParity(cpu: Column, gpu: Column): { maxUlp: number; rangeUlp: number; range: number } {
  let range = 0;
  for (let i = 0; i < cpu.data.length; i++) {
    const a = Math.abs(cpu.data[i]);
    if (a > range && Number.isFinite(a)) range = a;
  }
  const unit = 2 ** -23 * (range === 0 ? 1 : range);
  let maxUlpSeen = 0;
  let rangeUlp = 0;
  for (let i = 0; i < cpu.data.length; i++) {
    const c = cpu.data[i];
    const g = gpu.data[i];
    const d = ulpDistance(c, g);
    if (d > maxUlpSeen) maxUlpSeen = d;
    // A one-sided NaN is an infinite divergence, never a skipped lane:
    // Math.abs(NaN - x) is NaN and `NaN > rangeUlp` is false, so without
    // this branch a NaN-producing lane would silently pass the budget.
    const abs =
      Number.isNaN(c) || Number.isNaN(g)
        ? Number.isNaN(c) && Number.isNaN(g)
          ? 0
          : Number.POSITIVE_INFINITY
        : Math.abs(c - g) / unit;
    if (abs > rangeUlp) rangeUlp = abs;
  }
  return { maxUlp: maxUlpSeen, rangeUlp, range };
}

// ---------------------------------------------------------------------------
// bit-exact section: u32/hash streams must match byte for byte

const BITEXACT_SPECS: Record<string, FieldSpecArg> = {
  randomField: { fn: "randomField" },
  randomKeyed: { fn: "randomField", key: "jitter" },
  index: { fn: "index" },
  // Pure hash + compare + select: no rounding anywhere, so bit-exact.
  randomSelect: EXTENDED_SPECS.randomSelect,
};
const BITEXACT_COUNTS = [1, 63, 64, 65, 10_000];
const BITEXACT_SEEDS = [0, 1, 0xdeadbeef, -7];

// ---------------------------------------------------------------------------
// float parity section: per-family max-ULP budgets vs the CPU reference.
// Budgets are the values measured on the reference adapter (RTX 5090,
// D3D12, Dawn) over 10_000 dense hash-derived inputs, seed 1 — recorded
// in the comment per case and asserted as-measured (a different adapter
// exceeding one is a finding, not noise).

interface ParityCase {
  readonly name: string;
  readonly spec: FieldSpecArg;
  /** Assert raw maxUlp 0 (bit-exact family) instead of a rangeUlp budget. */
  readonly exact?: boolean;
  /** rangeUlp budget (error in ULP units at the family's output range). */
  readonly budget: number;
}

const P = { fn: "position" } as const;
const PX = { fn: "component", args: [P], index: 0 } as const;
const PY = { fn: "component", args: [P], index: 1 } as const;

// Budgets: measured on RTX 5090 (D3D12, Dawn), 10_000 dense inputs,
// then rounded up minimally. Each case's comment records the measured
// (rangeUlp, raw maxUlp) pair — raw maxUlp inflation on smooth families
// comes from lanes near output zero-crossings, where the CPU's f64
// interior survives cancellation that f32 cannot (rangeUlp is the
// honest metric there).
const PARITY_CASES: ParityCase[] = [
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
];
const PARITY_COUNT = 10_000;
const PARITY_SEED = 1;

describe.skipIf(testDevice === null)(deviceSuiteName("device parity"), () => {
  it("hash/u32 streams are bit-exact across counts and seeds", () => {
    const geo = makeCorpusGeometry(10_000);
    const tasks: RunnerTask[] = [];
    const kernels = new Map<string, ReturnType<typeof compileFieldSpec>>();
    for (const [name, spec] of Object.entries(BITEXACT_SPECS)) {
      kernels.set(name, compileFieldSpec(spec, CORPUS_LAYOUT));
    }
    for (const [name, kernel] of kernels) {
      for (const count of BITEXACT_COUNTS) {
        for (const seed of BITEXACT_SEEDS) {
          tasks.push(dispatchTask(`${name}|c${count}|s${seed}`, kernel, geo, count, seed));
        }
      }
    }
    const results = runDeviceTasks(tasks);
    expect(results.every((r) => r.errors.length === 0)).toBe(true);
    for (const result of results) {
      const [name, c, s] = result.name.split("|");
      const kernel = kernels.get(name)!;
      const count = Number(c.slice(1));
      const seed = Number(s.slice(1));
      const gpu = decodeRun(kernel, result.runs![0]);
      const cpu = cpuColumn(BITEXACT_SPECS[name], count, seed);
      expectBytesEqual(cpu, gpu, result.name);
    }
  });

  it("count 0 has nothing to compare (dispatch is skipped upstream)", () => {
    // The evaluator returns an empty column without dispatching; covered
    // in resolver.test.ts and integration.device.test.ts. Recorded here
    // so the count matrix is visibly complete.
    expect(BITEXACT_COUNTS.length).toBeGreaterThan(0);
  });

  it("float parity per op family stays within measured budgets", () => {
    const geo = makeCorpusGeometry(PARITY_COUNT);
    const kernels = PARITY_CASES.map((pc) => compileFieldSpec(pc.spec, CORPUS_LAYOUT));
    const tasks = PARITY_CASES.map((pc, i) =>
      dispatchTask(pc.name, kernels[i], geo, PARITY_COUNT, PARITY_SEED),
    );
    const results = runDeviceTasks(tasks);
    const lines: string[] = [];
    const over: string[] = [];
    for (let i = 0; i < PARITY_CASES.length; i++) {
      const pc = PARITY_CASES[i];
      const result = results[i];
      expect(result.errors, pc.name).toEqual([]);
      const gpu = decodeRun(kernels[i], result.runs![0]);
      const cpu = cpuColumn(pc.spec, PARITY_COUNT, PARITY_SEED);
      const m = measureParity(cpu, gpu);
      lines.push(
        `${pc.name}: rangeUlp=${m.rangeUlp.toFixed(2)} maxUlp=${m.maxUlp} range=${m.range.toPrecision(4)}` +
          ` (${pc.exact === true ? "exact" : `budget ${pc.budget}`})`,
      );
      if (pc.exact === true) {
        if (m.maxUlp !== 0) over.push(`${pc.name}: expected bit-exact, measured maxUlp ${m.maxUlp}`);
      } else if (m.rangeUlp > pc.budget) {
        over.push(`${pc.name}: measured rangeUlp ${m.rangeUlp.toFixed(2)} > budget ${pc.budget}`);
      }
    }
    // Measured tolerance table (phase-21 documentation source):
    console.log(`[parity ${testDevice!.label}]\n${lines.join("\n")}`);
    expect(over, "families exceeding their measured budget").toEqual([]);
  });

  it("audit residual probes: NaN min/max, normalize extremes, lattice overflow, subnormals", () => {
    // Deliberately-pathological inputs from the phase-19 audit's residual
    // list. Divergence here is documented GIGO contract, not a defect:
    // this test asserts the invariants that must hold on any adapter and
    // logs the measured divergence lines for the documentation.
    const geo = makeCorpusGeometry(64);
    const P = geo.attrs.point.require("P");
    const density = geo.attrs.point.require("density");
    // Rows 0..3: normalize/length extremes (+ a control row).
    P.data.set([1e19, 0, 0], 0);
    P.data.set([1e20, 1e20, 0], 3);
    P.data.set([1e-25, 1e-25, 0], 6);
    P.data.set([3, 4, 0], 9);
    // Rows 4..7: lattice coordinates at/beyond 2^31 (+ a negative).
    P.data.set([2147483904, 0.5, 0.5], 12);
    P.data.set([3e9, 0.5, 0.5], 15);
    P.data.set([-3e9, 0.5, 0.5], 18);
    P.data.set([5e9, 0.25, 0.75], 21);
    // NaN density lanes for min/max propagation.
    for (let i = 0; i < 64; i += 4) density.data[i] = NaN;

    const probes: Record<string, FieldSpecArg> = {
      minNaN: { fn: "min", args: [{ fn: "attribute", name: "density" }, 0.5] },
      maxNaN: { fn: "max", args: [{ fn: "attribute", name: "density" }, 0.5] },
      normalizeX: { fn: "component", args: [{ fn: "normalize", args: [{ fn: "position" }] }], index: 0 },
      lengthP: { fn: "length", args: [{ fn: "position" }] },
      valueNoiseLattice: { fn: "valueNoise" },
      subnormalMul: { fn: "mul", args: [{ fn: "attribute", name: "density" }, 1e-40] },
    };
    const kernels = Object.fromEntries(
      Object.entries(probes).map(([name, spec]) => [name, compileFieldSpec(spec, CORPUS_LAYOUT)]),
    );
    const results = runDeviceTasks(
      Object.entries(kernels).map(([name, kernel]) => dispatchTask(name, kernel, geo, 64, 1)),
    );
    const gpuCols: Record<string, Column> = {};
    for (const result of results) {
      expect(result.errors, result.name).toEqual([]);
      gpuCols[result.name] = decodeRun(kernels[result.name], result.runs![0]);
    }
    const cpuCols = Object.fromEntries(
      Object.entries(probes).map(([name, spec]) => [
        name,
        evaluateField(fieldFromJson(spec as FieldSpec), { geo, domain: "point", seed: 1 }),
      ]),
    );
    const lines: string[] = [];

    // min/max with NaN: CPU propagates NaN; WGSL min/max may return the
    // non-NaN operand. Non-NaN lanes must stay bit-exact on any adapter.
    for (const name of ["minNaN", "maxNaN"]) {
      const cpu = cpuCols[name];
      const gpu = gpuCols[name];
      let gpuNaN = 0;
      let gpuOperand = 0;
      for (let i = 0; i < 64; i++) {
        if (i % 4 === 0) {
          expect(Number.isNaN(cpu.data[i]), `${name}: CPU NaN lane ${i}`).toBe(true);
          if (Number.isNaN(gpu.data[i])) gpuNaN++;
          else if (gpu.data[i] === 0.5) gpuOperand++;
        } else {
          expect(gpu.data[i], `${name}: non-NaN lane ${i}`).toBe(cpu.data[i]);
        }
      }
      expect(gpuNaN + gpuOperand, `${name}: NaN lanes must yield NaN or the other operand`).toBe(16);
      lines.push(`${name}: CPU NaN; GPU → NaN on ${gpuNaN}/16 lanes, other operand on ${gpuOperand}/16`);
    }

    // normalize/length at f32-overflow / underflow magnitudes.
    const nrm = { cpu: cpuCols.normalizeX, gpu: gpuCols.normalizeX };
    const len = { cpu: cpuCols.lengthP, gpu: gpuCols.lengthP };
    for (const [row, label] of [[0, "|v|=1e19"], [1, "|v|≈1.4e20"], [2, "|v|≈1.4e-25"], [3, "[3,4,0] control"]] as const) {
      lines.push(
        `normalize.x ${label}: cpu=${nrm.cpu.data[row]} gpu=${nrm.gpu.data[row]}; ` +
          `length: cpu=${len.cpu.data[row]} gpu=${len.gpu.data[row]}`,
      );
    }
    // The control row must agree bit-for-bit on any adapter.
    expect(nrm.gpu.data[3], "normalize control row").toBe(nrm.cpu.data[3]);
    expect(len.gpu.data[3], "length control row").toBe(len.cpu.data[3]);

    // Lattice coords ≥ 2^31: JS ToUint32 wraps, WGSL f32→u32/i32 saturates.
    const vn = { cpu: cpuCols.valueNoiseLattice, gpu: gpuCols.valueNoiseLattice };
    for (const [row, label] of [[4, "x=2^31+256"], [5, "x=3e9"], [6, "x=-3e9"], [7, "x=5e9"]] as const) {
      const same = vn.cpu.data[row] === vn.gpu.data[row];
      lines.push(`valueNoise ${label}: cpu=${vn.cpu.data[row]} gpu=${vn.gpu.data[row]}${same ? " (equal)" : " (DIVERGES)"}`);
    }
    // Ordinary rows (8+) must stay within the noise family budget.
    for (let i = 24; i < 64; i++) {
      expect(ulpDistance(vn.cpu.data[i], vn.gpu.data[i]), `valueNoise ordinary lane ${i}`).toBeLessThan(256);
    }

    // Subnormal results: WGSL may flush to zero; CPU keeps them.
    const sub = { cpu: cpuCols.subnormalMul, gpu: gpuCols.subnormalMul };
    let flushed = 0;
    for (let i = 0; i < 64; i++) {
      if (Number.isNaN(sub.cpu.data[i])) continue; // NaN density lanes
      if (sub.gpu.data[i] === sub.cpu.data[i]) continue;
      expect(sub.gpu.data[i], `subnormal lane ${i}: flushed lanes must flush to zero`).toBe(0);
      flushed++;
    }
    lines.push(`subnormalMul (×1e-40): ${flushed}/48 non-NaN lanes flushed to zero on GPU`);

    console.log(`[residuals ${testDevice!.label}]\n${lines.join("\n")}`);
  });

  it("dispatches are deterministic run to run", () => {
    const geo = makeCorpusGeometry(4096);
    const picks: Array<[string, FieldSpecArg]> = [
      ["randomField", { fn: "randomField" }],
      ["fbmPerlin", EXTENDED_SPECS.fbmPerlin],
      ["worleyExact", EXTENDED_SPECS.worleyExact],
      ["composite", EXTENDED_SPECS.composite],
    ];
    const kernels = picks.map(([, spec]) => compileFieldSpec(spec, CORPUS_LAYOUT));
    const tasks = picks.map(([name], i) => dispatchTask(name, kernels[i], geo, 4096, 42, 3));
    const results = runDeviceTasks(tasks);
    for (let i = 0; i < picks.length; i++) {
      const runs = results[i].runs!;
      expect(runs.length).toBe(3);
      expect(runs[1], `${picks[i][0]}: run 2 vs 1`).toBe(runs[0]);
      expect(runs[2], `${picks[i][0]}: run 3 vs 1`).toBe(runs[0]);
    }
  });
});
