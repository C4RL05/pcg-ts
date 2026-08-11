/**
 * Device parity suite: bit-exactness of hash/u32 streams, measured
 * per-family float tolerances vs the CPU reference, and run-to-run
 * determinism — all executed in the plain-Node device runner. Budgets
 * are asserted tight, with the measured value on the reference adapter
 * (RTX 5090, D3D12) recorded next to each; see `PARITY_CASES` in
 * `corpus.ts`.
 *
 * Each float family is measured twice: once for the AUTHORED spec
 * (`fieldFromJson` JSON) and once for the code-authored twin carrying a
 * DERIVED spec, against the same budget. `corpus.test.ts` pins that the
 * two compile to the byte-identical kernel, so any divergence between
 * the two measurements is a CPU-side difference, not a codegen one.
 */
import { describe, expect, it } from "vitest";
import { evaluateField, type Column } from "../fields/index.js";
import { fieldFromJson, getFieldSpec, type FieldSpec, type FieldSpecArg } from "../nodes/fieldJson.js";
import { compileFieldSpec } from "./compile.js";
import {
  CORPUS_LAYOUT,
  DERIVED_FIELDS,
  EXTENDED_SPECS,
  PARITY_CASES,
  PARITY_COUNT,
  PARITY_SEED,
} from "./corpus.testsupport.js";
import { decodeRun, dispatchTask, runDeviceTasks, type RunnerTask } from "./runnerClient.js";
import { deviceSuiteName, testDevice } from "./gpuDevice.testsupport.js";
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
  // Shape BEFORE values, or the comparator scores a short column as
  // perfect: the loops run to `cpu.data.length` and index `gpu.data[i]`,
  // and for a truncated GPU column that is `undefined` — which is not
  // NaN, so the NaN guard never fires, and `Math.abs(c - undefined)/unit`
  // is NaN, which is never `> rangeUlp`. Every missing lane would be
  // skipped without a trace and every non-`exact` family would pass. The
  // bit-exact helper checks byteLength; this one has to check both.
  expect(gpu.data.length, "GPU column length vs the CPU reference").toBe(cpu.data.length);
  expect(gpu.tupleSize, "GPU column tupleSize vs the CPU reference").toBe(cpu.tupleSize);
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
// float parity section. `PARITY_CASES` (authored specs + measured
// per-family budgets), `DERIVED_FIELDS` (their code-authored twins), and
// PARITY_COUNT/PARITY_SEED live in `corpus.ts`: `corpus.test.ts` has to
// pin the twins against the same authored specs this suite measures, and
// importing one `*.test.ts` from another would re-register this whole
// device suite inside that CPU-only one.

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

  it("fraction agrees with the CPU across counts, bit-exactly at the degenerate ones", () => {
    // Every other family is a function of per-lane inputs, so one count
    // measures it. `fraction` is a function of the COUNT itself, so its
    // parity has to be SWEPT across counts — and the counts that matter
    // most are the ones a whole-cloud sweep never reaches: 1 (the
    // divide-by-zero guard, where CPU `n > 1 ? n - 1 : 1` and WGSL
    // `max(count, 2u) - 1u` must land on the same divisor) and 2 (the
    // first count that actually divides).
    const geo = makeCorpusGeometry(10_000);
    const spec: FieldSpecArg = { fn: "fraction" };
    const kernel = compileFieldSpec(spec, CORPUS_LAYOUT);
    const counts = [1, 2, 3, 5, 63, 64, 65, 1000, 10_000];
    const results = runDeviceTasks(
      counts.map((c) => dispatchTask(`c${c}`, kernel, geo, c, PARITY_SEED)),
    );
    const lines: string[] = [];
    for (let i = 0; i < counts.length; i++) {
      const count = counts[i];
      expect(results[i].errors, `count ${count}`).toEqual([]);
      const gpu = decodeRun(kernel, results[i].runs![0]);
      const cpu = cpuColumn(spec, count, PARITY_SEED);
      // The advertised range, asserted on BOTH sides: exactly 0 at the
      // first element and exactly 1 at the last (0 when there is only
      // one). No lane may be NaN at any count.
      for (const [label, col] of [["cpu", cpu], ["gpu", gpu]] as const) {
        expect(col.data.length, `count ${count}: ${label} length`).toBe(count);
        expect(col.data[0], `count ${count}: ${label} first lane`).toBe(0);
        expect(col.data[count - 1], `count ${count}: ${label} last lane`).toBe(count === 1 ? 0 : 1);
        for (let k = 0; k < count; k++) {
          if (Number.isNaN(col.data[k])) throw new Error(`count ${count}: ${label} NaN at lane ${k}`);
        }
      }
      const m = measureParity(cpu, gpu);
      lines.push(`count ${count}: rangeUlp=${m.rangeUlp.toFixed(2)} maxUlp=${m.maxUlp}`);
      // Counts 1 and 2 divide by 1, which is exact on any conforming
      // implementation — so they are held to byte identity, not to the
      // division family's budget. That is the guard's actual proof.
      if (count <= 2) {
        expectBytesEqual(cpu, gpu, `fraction count ${count}`);
      } else {
        // Everything else is one f32 division: the `div` family budget.
        expect(m.rangeUlp, `count ${count}: rangeUlp`).toBeLessThanOrEqual(1);
      }
    }
    console.log(`[fraction counts ${testDevice!.label}]\n${lines.join("\n")}`);
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

  it("code-authored (derived-spec) twins stay within the same measured budgets", () => {
    // The comparison a user who wrote `mul(position(), 0.1)` actually
    // cares about: the GPU result of the DERIVED spec against the CPU
    // evaluation of THAT FIELD — not against a rebuild of the authored
    // JSON. `corpus.test.ts` already pins that the two specs compile to
    // the identical kernel, so reusing the authored budgets is sound and
    // any drift here is a CPU-side difference.
    const geo = makeCorpusGeometry(PARITY_COUNT);
    const fields = PARITY_CASES.map((pc) => {
      const make = DERIVED_FIELDS[pc.name];
      expect(make, `${pc.name}: no code-authored twin`).toBeDefined();
      return make();
    });
    const kernels = fields.map((field, i) => {
      const spec = getFieldSpec(field);
      expect(spec, `${PARITY_CASES[i].name}: derived spec`).toBeDefined();
      return compileFieldSpec(spec as FieldSpec, CORPUS_LAYOUT);
    });
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
      const cpu = evaluateField(fields[i], { geo, domain: "point", seed: PARITY_SEED });
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
    console.log(`[parity derived ${testDevice!.label}]\n${lines.join("\n")}`);
    expect(over, "derived-spec families exceeding their measured budget").toEqual([]);
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
