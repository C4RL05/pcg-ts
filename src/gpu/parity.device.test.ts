/**
 * Device parity suite: bit-exactness of hash/u32 streams, measured
 * per-family float tolerances vs the CPU reference, and run-to-run
 * determinism — all executed in the plain-Node device runner. Budgets
 * are asserted against the measured sweep on the reference adapter
 * (RTX 5090, D3D12) recorded next to each; see `PARITY_CASES` in
 * `parity.testsupport.ts` for the derivation.
 *
 * Two budgets per family, asserted together because they fail for
 * different reasons: `rangeUlp` is the worst lane (an extreme-value
 * statistic that climbs as more lanes are sampled — so it is swept
 * across element counts here, never measured at one), and `meanAbs` is
 * the mean absolute divergence (sample-size stable to 1.04x across two
 * decades of count — so it moves only when the interior really changes).
 *
 * Each float family is measured twice: once for the AUTHORED spec
 * (`fieldFromJson` JSON) and once for the code-authored twin carrying a
 * DERIVED spec, against the same budgets. `parity.test.ts` pins that the
 * two compile to the byte-identical kernel, so any divergence between
 * the two measurements is a CPU-side difference, not a codegen one.
 */
import { describe, expect, it } from "vitest";
import type { Geometry } from "../data/index.js";
import { evaluateField, type Column } from "../fields/index.js";
import { fieldFromJson, getFieldSpec, type FieldSpec, type FieldSpecArg } from "../fields/fieldJson.js";
import { compileFieldSpec } from "./compile.js";
import {
  PARITY_LAYOUT,
  DERIVED_FIELDS,
  EXTENDED_SPECS,
  PARITY_CASES,
  PARITY_COUNT,
  PARITY_SEED,
  PARITY_SWEEP_COUNTS,
  type ParityCase,
} from "./parity.testsupport.js";
import { decodeRun, dispatchTask, runDeviceTasks, type RunnerTask } from "./runnerClient.js";
import {
  DEVICE_MEASUREMENT_TIMEOUT_MS,
  deviceSuiteName,
  testDevice,
} from "./gpuDevice.testsupport.js";
import { makeParityGeometry } from "./testGeometry.js";

/**
 * CPU reference for one spec over `geo` (whose point count IS the
 * element count — `evaluateField` reads the domain, not a parameter).
 *
 * The geometry is a parameter rather than built here on purpose: this
 * runs once per family per count, and rebuilding a 262 144-point fixture
 * 19 times was costing more than the device dispatches it is compared
 * against. `makeParityGeometry` is deterministic, so sharing one
 * instance across families changes no measured value.
 */
function cpuColumn(geo: Geometry, spec: FieldSpecArg, seed: number): Column {
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
 *   family's output range — `|cpu - gpu| / (2^-23 · max|cpu|)`. The
 *   budgeted tail metric: for outputs near the range it coincides with
 *   ULP distance; near zero it reflects the absolute error fairly. It is
 *   a max over lanes, so it grows with the element count — which is why
 *   the count-sensitive families are swept rather than spot-measured.
 *   Two things to know when reading a swept series: `unit` comes from
 *   THAT count's own `max|cpu|`, so the unit shifts slightly between
 *   counts (worley f1's range moves 0.34% from 262k to 1M — sub-1%, but
 *   not zero); and for a multi-component column `range` is the max over
 *   ALL components, so a small-magnitude component would be scored in
 *   the largest one's units. No non-`exact` family is vec-valued today.
 * - `meanAbs`: mean of `|cpu - gpu|` over lanes, in absolute units. The
 *   budgeted interior metric, and the one that is stable under sample
 *   size (≤ 1.04x across 10k → 1M for every sampled family). A
 *   regression that shifts the whole distribution moves this even when
 *   the worst lane still fits under a widened max budget.
 * - Infinity for a NaN vs number mismatch.
 */
function measureParity(
  cpu: Column,
  gpu: Column,
): { maxUlp: number; rangeUlp: number; meanAbs: number; range: number; nanLanes: number } {
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
  let sumAbs = 0;
  let nanLanes = 0;
  for (let i = 0; i < cpu.data.length; i++) {
    const c = cpu.data[i];
    const g = gpu.data[i];
    const d = ulpDistance(c, g);
    if (d > maxUlpSeen) maxUlpSeen = d;
    // Two ways a lane can produce NaN from non-NaN arithmetic, and both
    // would be SILENT: `NaN > budget` is false, so a NaN divergence
    // passes every budget. One is a one-sided NaN (Math.abs(NaN - x) is
    // NaN); the other is two equal infinities (Math.abs(Inf - Inf) is
    // NaN), which is agreement, not divergence — and which poisons the
    // MEAN even though it leaves the max alone, since the sum carries it
    // to every lane. Neither is reachable from these families' ranges
    // today; both are one edit away.
    if (Number.isNaN(c) || Number.isNaN(g)) nanLanes++;
    const abs =
      Number.isNaN(c) || Number.isNaN(g)
        ? Number.isNaN(c) && Number.isNaN(g)
          ? 0
          : Number.POSITIVE_INFINITY
        : Object.is(c, g)
          ? 0
          : Math.abs(c - g);
    sumAbs += abs;
    if (abs / unit > rangeUlp) rangeUlp = abs / unit;
  }
  return {
    maxUlp: maxUlpSeen,
    rangeUlp,
    meanAbs: cpu.data.length === 0 ? 0 : sumAbs / cpu.data.length,
    range,
    // Counted, not just scored: a lane that is NaN on BOTH sides scores
    // zero divergence and passes every budget including `exact` — it is
    // agreement between two non-answers. The corpus geometry cannot
    // produce one today (P is in [-8, 8], density in [0, 1)), which is
    // exactly why it would go unnoticed if a spec change ever did.
    nanLanes,
  };
}

/**
 * The budget check both measured passes and the count sweep share, so
 * one family can never be held to a different rule in one of them.
 * Returns the reasons this measurement busts its budgets (empty = pass).
 */
function budgetFailures(
  pc: ParityCase,
  m: { maxUlp: number; rangeUlp: number; meanAbs: number; nanLanes: number },
  where: string,
): string[] {
  const out: string[] = [];
  // Before any budget: no family in this table has a domain that reaches
  // NaN, so a NaN lane means the expression changed, not that the device
  // disagreed — and a both-NaN lane would otherwise score as agreement.
  if (m.nanLanes > 0) {
    out.push(`${pc.name}${where}: ${m.nanLanes} NaN lane(s); no family here has a NaN domain`);
  }
  if (pc.exact === true) {
    if (m.maxUlp !== 0) out.push(`${pc.name}${where}: expected bit-exact, measured maxUlp ${m.maxUlp}`);
    return out;
  }
  // Comparisons against a budget are one-sided, so a non-finite metric
  // passes silently. Reject it explicitly instead: Infinity means a NaN
  // or infinite lane, and NaN means the measurement itself broke.
  if (!Number.isFinite(m.rangeUlp) || !Number.isFinite(m.meanAbs)) {
    out.push(`${pc.name}${where}: non-finite measurement (rangeUlp ${m.rangeUlp}, meanAbs ${m.meanAbs})`);
  }
  if (m.rangeUlp > pc.budget) {
    out.push(`${pc.name}${where}: rangeUlp ${m.rangeUlp.toFixed(2)} > budget ${pc.budget}`);
  }
  if (m.meanAbs > pc.meanAbs) {
    out.push(`${pc.name}${where}: meanAbs ${m.meanAbs.toExponential(3)} > budget ${pc.meanAbs.toExponential(3)}`);
  }
  return out;
}

/** One measured family's log line, in the form the table's comments use. */
function parityLine(
  pc: ParityCase,
  m: { maxUlp: number; rangeUlp: number; meanAbs: number; range: number },
): string {
  return (
    `${pc.name}: rangeUlp=${m.rangeUlp.toFixed(2)} meanAbs=${m.meanAbs.toExponential(3)}` +
    ` maxUlp=${m.maxUlp} range=${m.range.toPrecision(4)}` +
    ` (${pc.exact === true ? "exact" : `budgets ${pc.budget} / ${pc.meanAbs.toExponential(1)}`})`
  );
}

// ---------------------------------------------------------------------------
// bit-exact section: u32/hash streams must match byte for byte

const BITEXACT_SPECS: Record<string, FieldSpecArg> = {
  randomField: { fn: "randomField" },
  randomKeyed: { fn: "randomField", key: "jitter" },
  index: { fn: "index" },
  // The seed itself, which is where the claim actually bites: the CPU
  // holds it in an f32 column and the kernel splits the u32 rather than
  // converting it whole, because converting a value past 2^24 is lossy
  // and 0xdeadbeef and -7 in BITEXACT_SEEDS are both past it. If the
  // split were wrong, or if the CPU dropped its `>>> 0`, this row says
  // so — and it is the row that keeps the claim from resting on how one
  // adapter happens to round.
  nodeSeed: { fn: "nodeSeed" },
  // Pure hash + compare + select: no rounding anywhere, so bit-exact.
  randomSelect: EXTENDED_SPECS.randomSelect,
};
const BITEXACT_COUNTS = [1, 63, 64, 65, 10_000];
const BITEXACT_SEEDS = [0, 1, 0xdeadbeef, -7];

// ---------------------------------------------------------------------------
// float parity section. `PARITY_CASES` (authored specs + measured
// per-family budgets), `DERIVED_FIELDS` (their code-authored twins), and
// PARITY_COUNT/PARITY_SEED live in `parity.testsupport.ts`: `parity.test.ts` has to
// pin the twins against the same authored specs this suite measures, and
// importing one `*.test.ts` from another would re-register this whole
// device suite inside that CPU-only one.

describe.skipIf(testDevice === null)(deviceSuiteName("device parity"), () => {
  it("hash/u32 streams are bit-exact across counts and seeds", () => {
    const geo = makeParityGeometry(10_000);
    const tasks: RunnerTask[] = [];
    const kernels = new Map<string, ReturnType<typeof compileFieldSpec>>();
    for (const [name, spec] of Object.entries(BITEXACT_SPECS)) {
      kernels.set(name, compileFieldSpec(spec, PARITY_LAYOUT));
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
    // One fixture per count, shared across the 16 (spec, seed) pairs that
    // read it: the CPU reference needs a geometry whose point count IS
    // the dispatched count, and building 80 of them is pure overhead.
    const geoByCount = new Map(BITEXACT_COUNTS.map((c) => [c, makeParityGeometry(c)]));
    for (const result of results) {
      const [name, c, s] = result.name.split("|");
      const kernel = kernels.get(name)!;
      const count = Number(c.slice(1));
      const seed = Number(s.slice(1));
      const gpu = decodeRun(kernel, result.runs![0]);
      const cpu = cpuColumn(geoByCount.get(count)!, BITEXACT_SPECS[name], seed);
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
    const geo = makeParityGeometry(10_000);
    const spec: FieldSpecArg = { fn: "fraction" };
    const kernel = compileFieldSpec(spec, PARITY_LAYOUT);
    const counts = [1, 2, 3, 5, 63, 64, 65, 1000, 10_000];
    const results = runDeviceTasks(
      counts.map((c) => dispatchTask(`c${c}`, kernel, geo, c, PARITY_SEED)),
    );
    const lines: string[] = [];
    for (let i = 0; i < counts.length; i++) {
      const count = counts[i];
      expect(results[i].errors, `count ${count}`).toEqual([]);
      const gpu = decodeRun(kernel, results[i].runs![0]);
      const cpu = cpuColumn(makeParityGeometry(count), spec, PARITY_SEED);
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
    const geo = makeParityGeometry(PARITY_COUNT);
    const kernels = PARITY_CASES.map((pc) => compileFieldSpec(pc.spec, PARITY_LAYOUT));
    const tasks = PARITY_CASES.map((pc, i) =>
      dispatchTask(pc.name, kernels[i], geo, PARITY_COUNT, PARITY_SEED),
    );
    const results = runDeviceTasks(tasks);
    const lines: string[] = [];
    const over: string[] = [];
    for (let i = 0; i < PARITY_CASES.length; i++) {
      const pc = PARITY_CASES[i];
      const result = results[i];
      // Positional pairing: the runner returns results in task order,
      // and a reordering would measure one family against another's CPU
      // column — silently, since every budget here is of the same order.
      expect(result.name, `result ${i} pairing`).toBe(pc.name);
      expect(result.errors, pc.name).toEqual([]);
      const gpu = decodeRun(kernels[i], result.runs![0]);
      const cpu = cpuColumn(geo, pc.spec, PARITY_SEED);
      const m = measureParity(cpu, gpu);
      lines.push(parityLine(pc, m));
      over.push(...budgetFailures(pc, m, ""));
    }
    // Measured tolerance table (phase-21 documentation source):
    console.log(`[parity ${testDevice!.label} @${PARITY_COUNT}]\n${lines.join("\n")}`);
    expect(over, "families exceeding their measured budget").toEqual([]);
  }, DEVICE_MEASUREMENT_TIMEOUT_MS);

  it("code-authored (derived-spec) twins stay within the same measured budgets", () => {
    // The comparison a user who wrote `mul(position(), 0.1)` actually
    // cares about: the GPU result of the DERIVED spec against the CPU
    // evaluation of THAT FIELD — not against a rebuild of the authored
    // JSON. `parity.test.ts` already pins that the two specs compile to
    // the identical kernel, so reusing the authored budgets is sound and
    // any drift here is a CPU-side difference.
    const geo = makeParityGeometry(PARITY_COUNT);
    const fields = PARITY_CASES.map((pc) => {
      const make = DERIVED_FIELDS[pc.name];
      expect(make, `${pc.name}: no code-authored twin`).toBeDefined();
      return make();
    });
    const kernels = fields.map((field, i) => {
      const spec = getFieldSpec(field);
      expect(spec, `${PARITY_CASES[i].name}: derived spec`).toBeDefined();
      return compileFieldSpec(spec as FieldSpec, PARITY_LAYOUT);
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
      // Positional pairing: the runner returns results in task order,
      // and a reordering would measure one family against another's CPU
      // column — silently, since every budget here is of the same order.
      expect(result.name, `result ${i} pairing`).toBe(pc.name);
      expect(result.errors, pc.name).toEqual([]);
      const gpu = decodeRun(kernels[i], result.runs![0]);
      const cpu = evaluateField(fields[i], { geo, domain: "point", seed: PARITY_SEED });
      const m = measureParity(cpu, gpu);
      lines.push(parityLine(pc, m));
      over.push(...budgetFailures(pc, m, ""));
    }
    console.log(`[parity derived ${testDevice!.label} @${PARITY_COUNT}]\n${lines.join("\n")}`);
    expect(over, "derived-spec families exceeding their measured budget").toEqual([]);
  }, DEVICE_MEASUREMENT_TIMEOUT_MS);

  it("count-sensitive families hold their budgets across element counts", () => {
    // `rangeUlp` is a max over lanes, so measuring it at ONE element
    // count measures the cloud size as much as it measures the family:
    // a bigger cloud of the same distribution reaches further into the
    // same tail. That is not hypothetical — it is how five budgets came
    // to be exceeded by an unchanged compiler (valueNoise 6.53 at 10k,
    // 8.02 at 65k, 10.44 at 1M, against a budget of 8). Noise seeds ride
    // in the spec, so seed is inert here and count was the only unpinned
    // axis; sweeping it is what makes a budget a statement about the
    // family. `meanAbs` is swept alongside for the opposite reason: it
    // must NOT move (≤ 1.04x across two decades), so any shift in it is
    // a real change in the interior rather than a deeper tail.
    const cases = PARITY_CASES.filter((pc) => pc.countSensitive === true);
    expect(cases.length, "count-sensitive families in the table").toBeGreaterThan(0);
    const kernels = cases.map((pc) => compileFieldSpec(pc.spec, PARITY_LAYOUT));
    const swept = cases.map(() => ({ ru: [] as string[], ma: [] as string[] }));
    const over: string[] = [];
    for (const count of PARITY_SWEEP_COUNTS) {
      const geo = makeParityGeometry(count);
      const results = runDeviceTasks(
        cases.map((pc, i) => dispatchTask(pc.name, kernels[i], geo, count, PARITY_SEED)),
      );
      for (let i = 0; i < cases.length; i++) {
        const pc = cases[i];
        expect(results[i].name, `result ${i} pairing @${count}`).toBe(pc.name);
        expect(results[i].errors, `${pc.name} @${count}`).toEqual([]);
        const gpu = decodeRun(kernels[i], results[i].runs![0]);
        const cpu = cpuColumn(geo, pc.spec, PARITY_SEED);
        const m = measureParity(cpu, gpu);
        swept[i].ru.push(m.rangeUlp.toFixed(2));
        swept[i].ma.push(m.meanAbs.toExponential(2));
        over.push(...budgetFailures(pc, m, ` @${count}`));
      }
    }
    const lines = cases.map(
      (pc, i) =>
        `${pc.name}: rangeUlp ${swept[i].ru.join("/")} (budget ${pc.budget})` +
        ` meanAbs ${swept[i].ma.join("/")} (budget ${pc.meanAbs.toExponential(1)})`,
    );
    console.log(
      `[parity counts ${testDevice!.label} @${PARITY_SWEEP_COUNTS.join("/")}]\n${lines.join("\n")}`,
    );
    expect(over, "families exceeding a budget at some element count").toEqual([]);
  }, DEVICE_MEASUREMENT_TIMEOUT_MS);

  it("audit residual probes: NaN min/max, normalize extremes, lattice overflow, subnormals", () => {
    // Deliberately-pathological inputs from the phase-19 audit's residual
    // list. Divergence here is documented GIGO contract, not a defect:
    // this test asserts the invariants that must hold on any adapter and
    // logs the measured divergence lines for the documentation.
    const geo = makeParityGeometry(64);
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
      Object.entries(probes).map(([name, spec]) => [name, compileFieldSpec(spec, PARITY_LAYOUT)]),
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
    const geo = makeParityGeometry(4096);
    const picks: Array<[string, FieldSpecArg]> = [
      ["randomField", { fn: "randomField" }],
      ["fbmPerlin", EXTENDED_SPECS.fbmPerlin],
      ["worleyExact", EXTENDED_SPECS.worleyExact],
      ["composite", EXTENDED_SPECS.composite],
    ];
    const kernels = picks.map(([, spec]) => compileFieldSpec(spec, PARITY_LAYOUT));
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
