/**
 * Real-device suite for phase 26: device-resident instance transforms.
 * Asserts compose-TRS parity against `composeTRS` over a dense sample
 * and every degenerate case, that the retained buffer is genuinely
 * device-resident (read back straight out of the handle), that the
 * ownership model holds on real device memory across
 * cook → retain → dispose → recook cycles (including evaluator dispose
 * with an outstanding handle and cancellation), and that the CPU
 * fallbacks are byte-identical with their reason counted.
 *
 * Phase 45 adds the two halves of the spawner's remaining gap. Colour is
 * held to a different and stricter bar than the transforms above it: a
 * matrix is COMPUTED (an f32 kernel against an f64 reference, hence a
 * measured tolerance), while a colour is GATHERED, so the device bytes
 * must equal the CPU batch's bit for bit and any difference is a layout
 * or an indexing bug, never rounding. The budget's half asserts that the
 * device path adds no diagnostic of its own — the two paths' messages are
 * compared as whole strings. Bundles
 * instances.testsupport.ts with esbuild and executes it in a plain Node
 * child process (see deviceRunner.mjs for why no vitest worker may touch
 * Dawn). Skips visibly without an adapter.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import { DEVICE_HOOK_TIMEOUT_MS, deviceSuiteName, testDevice } from "./gpuDevice.testsupport.js";

interface Parity {
  n: number;
  maxAbs: number;
  rangeRel: number;
  rangeUlp: number;
  maxUlp: number;
  bitEqual: number;
  worstAt: number;
}

interface PoolSnap {
  detachedBuffers: number;
  detachedBytes: number;
  buffersDetached?: number;
  inFlight: number;
}

interface StatsShape {
  residentRuns: number;
  fusedNodes: number;
  readbacksSaved: number;
  dispatches: number;
  fallbacks: Record<string, number>;
  cooked: number;
  cached: number;
}

interface BatchObs {
  shapes: Array<[string, number]>;
  shapesMatchCpu: boolean;
  perBatch: Array<{
    assetId: string;
    count: number;
    byteLength: number;
    lengthsAgree: boolean;
    parity: Parity;
  }>;
  parity: Parity;
}

interface Variant {
  name: string;
  count: number;
  assetId: string;
  byteLength: number;
  residency: string;
  backend: string;
  parity: Parity;
  basis: Parity;
  translation: Parity;
  padExact: boolean;
  edges: Array<{ name: string; cpu: number[]; gpu: number[]; parity: Parity }>;
}

interface ScenarioOutput {
  ok: boolean;
  error?: string;
  parity: { variants: Variant[]; deterministic: boolean };
  chain: {
    fusedStats: StatsShape;
    withGeoStats: StatsShape;
    pointsProducedWhenUnread: boolean;
    pointsProducedWhenDeclared: boolean;
    parityVsCpuChain: Parity;
    parityMaterializedVsDevice: Parity;
    bareStats: StatsShape;
    bareParity: Parity;
    bareGeoUnchanged: boolean;
  };
  ownership: {
    expectedBytes: number;
    before: PoolSnap;
    afterCook: PoolSnap;
    readable: boolean;
    afterDispose: PoolSnap;
    disposedTwiceThrew: string | null;
    resourceAfterDispose: string | null;
    cycles: PoolSnap[];
    afterCycles: PoolSnap;
    holding: PoolSnap;
    afterRelease: PoolSnap;
    afterEvaluatorDispose: PoolSnap;
    usableAfterEvaluatorDispose: boolean;
    readableAfterEvaluatorDispose: boolean;
    final: PoolSnap;
  };
  cancellation: {
    cancelledName: string;
    isCookCancelled: boolean;
    before: PoolSnap;
    afterAbort: PoolSnap;
    duringRecovery: PoolSnap;
    after: PoolSnap;
  };
  grouping: {
    stats: StatsShape;
    deviceBatchesPresent: boolean;
    grouped: BatchObs;
    cpuShapes: Array<[string, number]>;
    tableEntries: string[];
    holding: { detachedBuffers: number; detachedBytes: number };
    holdingBytesMatchCounts: boolean;
    afterDispose: { detachedBuffers: number; detachedBytes: number; inFlight: number };
    cycles: Array<{ batches: number; detachedBuffers: number; detachedBytes: number }>;
    afterCycles: { detachedBuffers: number; detachedBytes: number; inFlight: number };
    identicalAcrossCooks: boolean;
    permutedTableShapes: Array<[string, number]>;
    wide: BatchObs;
    solo: BatchObs;
  };
  groupingChain: {
    stats: StatsShape;
    observed: BatchObs;
    batchCount: number;
  };
  colour: { cases: ColourCase[] };
  budget: {
    max: number;
    deviceMessage: string;
    cpuMessage: string;
    detachedAfterFailure: PoolSnap;
    limitStats: StatsShape;
    limitDeviceResident: boolean;
    limitShape: Array<[string, number, number]>;
    afterLimit: { detachedBuffers: number; detachedBytes: number };
  };
  optOut: {
    residentTerminals: string[];
    deviceBatchesPresent: boolean;
    batchCount: number;
    stats: StatsShape;
    parityVsCpuOnly: Parity;
    detachedBuffers: number;
  };
}

interface ColourAgreement {
  n: number;
  mismatchCount: number;
  mismatches: Array<{ instance: number; component: number; cpu: number; gpu: number }>;
  padNonZero: number;
  floatsPerInstance: number;
}

interface ColourCase {
  name: string;
  colorAttr: string;
  assetAttr: string;
  stats: StatsShape;
  batchCount: number;
  cpuShapes: Array<[string, number]>;
  shapes: Array<[string, number]>;
  colors: {
    perBatch: Array<{
      assetId: string;
      count?: number;
      byteLength?: number;
      backend?: string;
      missing?: boolean;
      agreement?: ColourAgreement;
    }>;
    mismatchTotal: number;
    padNonZeroTotal: number;
    compared: number;
  };
  transformsUnmoved: boolean;
  plainCarriesNoColour: boolean;
  deterministic: boolean;
  holding: { detachedBuffers: number; detachedBytes: number };
  afterDispose: PoolSnap;
  headGpu: number[];
  headCpu: number[];
}

/**
 * Compose-TRS parity budget, measured on the reference adapter (nvidia
 * blackwell RTX 5090, D3D12, Dawn) over 4096 varied transforms.
 *
 * The kernel is a line-for-line port of `composeTRS`, so the only
 * divergence is that the CPU keeps an f64 interior across the eleven
 * quaternion products and the scale multiply while WGSL computes them in
 * f32 (and may contract into FMA). Measured on the full sample:
 * max |cpu - gpu| = 4.768e-7 over basis entries spanning [-3, 1e6], i.e.
 * 1.70e-8 of the basis range and 0.143 f32-ULP at the top of it; 49748
 * of 65536 elements (76%) are BIT-identical.
 *
 * Two parts carry no slack at all and are asserted at byte equality
 * rather than budgeted: the translation column is a straight copy of P,
 * and the constant rows (3, 7, 11 = 0 and 15 = 1) are literals.
 * Likewise the whole `noRot`/`pOnly` variants, where the compiled-out
 * identity quaternion makes every product exact in f32.
 */
const BASIS_MAX_ABS = 1e-6;
/** Basis deviation as a fraction of the basis range (measured 1.70e-8). */
const BASIS_RANGE_REL = 5e-8;

/**
 * The fused chain's own budget: orientAlongVector's quaternion
 * construction and transformPoints' multiply-add chain in f32 stacked on
 * top of the compose kernel, against an all-f64 CPU. Measured 5.14e-8 of
 * the range (0.431 f32-ULP); the raw 0.102 max-abs is that relative
 * error at the sample's deliberately extreme 1e6 scale point.
 */
const CHAIN_RANGE_REL = 2e-7;

function runScenario(): ScenarioOutput {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, "..", "..", "node_modules", ".cache", "pcg-ts-device");
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, `instances-${process.pid}.mjs`);
  try {
    buildSync({
      entryPoints: [join(here, "instances.testsupport.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node18",
      external: ["webgpu"],
      outfile,
      logLevel: "silent",
    });
    const stdout = execFileSync(process.execPath, [outfile], {
      encoding: "utf8",
      maxBuffer: 1 << 26,
      timeout: 300_000,
    });
    return JSON.parse(stdout) as ScenarioOutput;
  } finally {
    rmSync(outfile, { force: true });
  }
}

const variantOf = (s: ScenarioOutput, name: string): Variant => {
  const v = s.parity.variants.find((x) => x.name === name);
  if (v === undefined) throw new Error(`scenario reported no variant named "${name}"`);
  return v;
};

describe.skipIf(testDevice === null)(
  deviceSuiteName("device-resident instance transforms"),
  () => {
    let scenario: ScenarioOutput;
    beforeAll(() => {
      scenario = runScenario();
    }, DEVICE_HOOK_TIMEOUT_MS);

    it("scenario ran to completion", () => {
      expect(scenario.error, scenario.error).toBeUndefined();
      expect(scenario.ok).toBe(true);
    });

    // -----------------------------------------------------------------
    // 1. the transforms really are device-resident

    it("the spawner emits a device batch whose transforms live in a GPU buffer", () => {
      // Pin the loop count: an empty variant list would make every
      // for-of assertion in this suite pass vacuously.
      expect([...scenario.parity.variants].map((v) => v.name).sort()).toEqual([
        "full",
        "noRot",
        "noScale",
        "pOnly",
      ]);
      for (const v of scenario.parity.variants) {
        expect(v.residency, v.name).toBe("device");
        expect(v.backend, v.name).toBe("webgpu");
        expect(v.assetId, v.name).toBe("tree");
        expect(v.count, v.name).toBe(4096);
        // 16 f32 per instance, and the handle reports the LOGICAL length.
        expect(v.byteLength, v.name).toBe(4096 * 64);
        // Read straight out of the handle's buffer: 65536 floats compared.
        expect(v.parity.n, v.name).toBe(4096 * 16);
      }
    });

    it("the same graph composes byte-identical transforms twice", () => {
      expect(scenario.parity.deterministic).toBe(true);
    });

    // -----------------------------------------------------------------
    // 2. kernel parity vs composeTRS

    it("matches composeTRS within the documented f32 tolerance (dense sample)", () => {
      const v = variantOf(scenario, "full");
      expect(v.basis.maxAbs).toBeLessThanOrEqual(BASIS_MAX_ABS);
      expect(v.basis.rangeRel).toBeLessThanOrEqual(BASIS_RANGE_REL);
      // Most of the sample is exact even so; a collapse here would mean
      // the port drifted structurally, not just in width.
      expect(v.parity.bitEqual / v.parity.n).toBeGreaterThan(0.7);
    });

    it("the translation column and the constant rows carry no slack", () => {
      for (const v of scenario.parity.variants) {
        // Translation is a straight copy of P: byte-identical, always.
        expect(v.translation.maxAbs, v.name).toBe(0);
        expect(v.translation.bitEqual, v.name).toBe(v.translation.n);
        // Rows 3/7/11 are exactly 0 and row 15 exactly 1.
        expect(v.padExact, v.name).toBe(true);
      }
    });

    it("absent rot/scale compile to identity/one and are BIT-EXACT", () => {
      // The CPU defaults are 0,0,0,1 and 1,1,1; with those compiled in as
      // literals every product is exact in f32, so this must be equality,
      // not tolerance — the strongest available check on the layout.
      for (const name of ["noRot", "pOnly"]) {
        const v = variantOf(scenario, name);
        expect(v.parity.maxAbs, name).toBe(0);
        expect(v.parity.bitEqual, name).toBe(v.parity.n);
      }
      // With rot present but scale absent, only the quaternion products
      // round; measured max |cpu - gpu| = 1.19e-7.
      const noScale = variantOf(scenario, "noScale");
      expect(noScale.parity.maxAbs).toBeLessThanOrEqual(BASIS_MAX_ABS);
    });

    it("holds on every degenerate transform", () => {
      const v = variantOf(scenario, "full");
      const edge = (name: string) => {
        const e = v.edges.find((x) => x.name === name);
        if (e === undefined) throw new Error(`no edge case "${name}"`);
        return e;
      };
      // Exact by construction: every operand is an exact binary fraction
      // or a small integer, so f32 and f64 agree bit for bit.
      for (const name of [
        "identity",
        "zeroScale",
        "negativeScale",
        "negativeScaleRotated",
        "unnormalizedQuat",
        "zeroQuat",
      ]) {
        expect(edge(name).parity.maxAbs, name).toBe(0);
        expect(edge(name).parity.bitEqual, name).toBe(16);
      }
      // Identity in, identity out (and P straight through).
      expect(edge("identity").gpu.slice(0, 12)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
      expect(edge("identity").gpu[15]).toBe(1);
      // Zero scale collapses the basis but keeps the translation.
      expect(edge("zeroScale").gpu.slice(0, 12).every((x) => x === 0)).toBe(true);
      expect(edge("zeroScale").gpu.slice(12, 15)).toEqual(edge("zeroScale").cpu.slice(12, 15));
      // Negative scale negates whole columns — no abs(), no clamping.
      expect(edge("negativeScale").gpu.slice(0, 12)).toEqual([
        -1, 0, 0, 0, 0, -2, 0, 0, 0, 0, -3, 0,
      ]);
      // An unnormalized quaternion is used as given, exactly like the CPU
      // (composeTRS never normalizes).
      expect(edge("unnormalizedQuat").gpu).toEqual(edge("unnormalizedQuat").cpu);
      // A zero quaternion degenerates to the identity basis on both.
      expect(edge("zeroQuat").gpu.slice(0, 11)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

      // Rounding-sensitive: a huge/tiny scale mix (measured exact here)
      // and an exact 90-degree rotation whose two "should be zero" basis
      // entries cancel differently in f32 (6.85e-8 vs 1.19e-7).
      expect(edge("tinyHugeScale").parity.maxAbs).toBeLessThanOrEqual(BASIS_MAX_ABS);
      expect(edge("exact90").parity.maxAbs).toBeLessThanOrEqual(BASIS_MAX_ABS);
    });

    // -----------------------------------------------------------------
    // 3. fusion and the skipped readback

    it("fuses the whole chain into the spawner and skips the readback entirely", () => {
      const c = scenario.chain;
      expect(c.fusedStats.residentRuns).toBe(1);
      expect(c.fusedStats.fusedNodes).toBe(3); // transform + orient + spawn
      // Nothing reads "points", so NO readback ran: one saved per member,
      // where an ordinary run saves members - 1.
      expect(c.fusedStats.readbacksSaved).toBe(3);
      expect(c.pointsProducedWhenUnread).toBe(true);
      expect(c.fusedStats.fallbacks).toEqual({});
      expect(c.parityVsCpuChain.n).toBeGreaterThan(0);
      expect(c.parityVsCpuChain.rangeRel).toBeLessThanOrEqual(CHAIN_RANGE_REL);
    });

    it("declaring the points output brings the readback back, and both agree", () => {
      const c = scenario.chain;
      expect(c.withGeoStats.residentRuns).toBe(1);
      expect(c.withGeoStats.fusedNodes).toBe(3);
      expect(c.withGeoStats.readbacksSaved).toBe(2); // members - 1: one readback ran
      expect(c.pointsProducedWhenDeclared).toBe(true);
      // The materialized geometry composed on the CPU and the retained
      // device buffer describe the same transforms — the compose kernel
      // read exactly the bytes the readback returned.
      expect(c.parityMaterializedVsDevice.n).toBeGreaterThan(0);
      expect(c.parityMaterializedVsDevice.rangeRel).toBeLessThanOrEqual(BASIS_RANGE_REL);
    });

    it("a lone spawner with a read points pin materializes with no readback to do", () => {
      // The run must materialize the geometry (someone reads it) yet no
      // member wrote an attribute — the staging buffer and the map are
      // skipped rather than issued at zero length.
      const c = scenario.chain;
      expect(c.bareStats.residentRuns).toBe(1);
      expect(c.bareStats.fusedNodes).toBe(1);
      expect(c.bareStats.readbacksSaved).toBe(0); // members - 1
      expect(c.bareStats.dispatches).toBe(1); // just the compose kernel
      // The passed-through geometry is the input, byte for byte.
      expect(c.bareGeoUnchanged).toBe(true);
      expect(c.bareParity.n).toBeGreaterThan(0);
      expect(c.bareParity.rangeRel).toBeLessThanOrEqual(BASIS_RANGE_REL);
    });

    // -----------------------------------------------------------------
    // 4. ownership and lifetime on real device memory

    it("a cook transfers exactly one buffer out of the pool, and dispose returns it", () => {
      const o = scenario.ownership;
      expect(o.before).toMatchObject({ detachedBuffers: 0, detachedBytes: 0, inFlight: 0 });
      expect(o.afterCook.detachedBuffers).toBe(1);
      expect(o.afterCook.detachedBytes).toBe(o.expectedBytes);
      expect(o.afterCook.inFlight).toBe(1); // outstanding, and counted as such
      expect(o.readable).toBe(true);
      expect(o.afterDispose).toMatchObject({
        detachedBuffers: 0,
        detachedBytes: 0,
        inFlight: 0,
      });
    });

    it("dispose is idempotent and a disposed handle refuses to hand out its buffer", () => {
      expect(scenario.ownership.disposedTwiceThrew).toBeNull();
      expect(scenario.ownership.resourceAfterDispose).toMatch(/was disposed/);
      expect(scenario.ownership.resourceAfterDispose).toMatch(/re-cook to obtain a fresh one/);
    });

    it("cook → retain → dispose → recook cycles do not grow retained device memory", () => {
      const o = scenario.ownership;
      // Pin the cycle count: an empty list would make the loop vacuous.
      expect(o.cycles).toHaveLength(12);
      // Every cycle peaks at exactly one outstanding buffer, never two.
      for (const [i, c] of o.cycles.entries()) {
        expect(c.detachedBuffers, `cycle ${i}`).toBe(1);
        expect(c.detachedBytes, `cycle ${i}`).toBe(o.expectedBytes);
        expect(c.inFlight, `cycle ${i}`).toBe(1);
      }
      expect(o.afterCycles).toMatchObject({ detachedBuffers: 0, detachedBytes: 0, inFlight: 0 });
      // The counter is a real measure, not a constant: holding four
      // handles accumulates four buffers, and releasing returns to zero.
      expect(o.holding.detachedBuffers).toBe(4);
      expect(o.holding.detachedBytes).toBe(o.expectedBytes * 4);
      expect(o.afterRelease).toMatchObject({ detachedBuffers: 0, detachedBytes: 0, inFlight: 0 });
    });

    it("evaluator dispose leaves an outstanding handle alive and usable", () => {
      // The rule: `GpuFieldEvaluator.dispose()` drops the pool's IDLE
      // buffers. It never touches a detached one — destroying a buffer a
      // renderer is still drawing from would be a use-after-free — so the
      // handle stays bindable and readable, and freeing it is still the
      // owner's job.
      const o = scenario.ownership;
      expect(o.afterEvaluatorDispose.detachedBuffers).toBe(1);
      expect(o.afterEvaluatorDispose.detachedBytes).toBe(o.expectedBytes);
      expect(o.usableAfterEvaluatorDispose).toBe(true);
      expect(o.readableAfterEvaluatorDispose).toBe(true);
      expect(o.final).toMatchObject({ detachedBuffers: 0, detachedBytes: 0, inFlight: 0 });
    });

    it("cancellation strands nothing: the transfer happens after the last check", () => {
      const c = scenario.cancellation;
      expect(c.isCookCancelled).toBe(true);
      expect(c.cancelledName).toBe("CookCancelledError");
      expect(c.afterAbort).toMatchObject({
        detachedBuffers: 0,
        detachedBytes: 0,
        inFlight: 0,
      });
      // ...and the evaluator still works afterwards.
      expect(c.duringRecovery.detachedBuffers).toBe(1);
      expect(c.after).toMatchObject({ detachedBuffers: 0, detachedBytes: 0, inFlight: 0 });
    });

    // -----------------------------------------------------------------
    // 5. multi-asset grouping (phase 29)

    it("assetAttr composes on the device, one batch per asset, in the CPU order", () => {
      const g = scenario.grouping;
      // The reason v0.7 counted here is retired: nothing falls back.
      expect(g.stats.fallbacks).toEqual({});
      expect(g.stats.residentRuns).toBe(1);
      expect(g.deviceBatchesPresent).toBe(true);

      // Batch order is FIRST OCCURRENCE — pinned literally, not merely
      // compared against the CPU, so a shared bug in both would show.
      // Not lexicographic (fern < pine < rock < tree), not table order
      // (see tableEntries below), and "ghost" — interned but worn by no
      // point — produces no batch at all.
      expect(g.grouped.shapes).toEqual([
        ["pine", 102], // point 5 lost to the out-of-range index below
        ["rock", 103],
        ["tree", 205], // "" (102) + literal "tree" (102) + the out-of-range point
        ["fern", 102],
      ]);
      expect(g.tableEntries).toEqual(["", "ghost", "rock", "pine", "tree", "fern"]);
      expect(g.grouped.shapes.reduce((n, s) => n + s[1], 0)).toBe(512);
      expect(g.grouped.shapesMatchCpu).toBe(true);
      expect(g.cpuShapes).toEqual(g.grouped.shapes);
    });

    it("every batch's matrices come from the right points, within the compose tolerance", () => {
      const g = scenario.grouping;
      expect(g.grouped.perBatch).toHaveLength(4);
      for (const b of g.grouped.perBatch) {
        expect(b.lengthsAgree, `batch ${b.assetId}`).toBe(true);
        expect(b.byteLength, `batch ${b.assetId}`).toBe(b.count * 64);
        expect(b.parity.n, `batch ${b.assetId}`).toBe(b.count * 16);
        // A wrongly-permuted source point is a WHOLE different matrix,
        // orders of magnitude outside this budget — this is the assertion
        // that catches a bad `base` or a bad permutation upload.
        expect(b.parity.rangeRel, `batch ${b.assetId}`).toBeLessThanOrEqual(BASIS_RANGE_REL);
      }
      expect(g.grouped.parity.n).toBe(512 * 16);
      expect(g.grouped.parity.rangeRel).toBeLessThanOrEqual(BASIS_RANGE_REL);
    });

    it("batch order does not follow the string table, and is stable across recooks", () => {
      const g = scenario.grouping;
      // Same per-point ids, a table interned in a different order.
      expect(g.permutedTableShapes).toEqual(g.grouped.shapes);
      // And three recooks produce the same bytes, not merely the same
      // shapes: the permutation is buffer content, never a pipeline key.
      expect(g.identicalAcrossCooks).toBe(true);
    });

    it("reads component 0 of a wide key column, and handles a single-asset column", () => {
      const g = scenario.grouping;
      // Component 1 holds decoys; grouping must be identical to the
      // tupleSize-1 fixture.
      expect(g.wide.shapes).toEqual(g.grouped.shapes);
      expect(g.wide.shapesMatchCpu).toBe(true);
      expect(g.wide.parity.rangeRel).toBeLessThanOrEqual(BASIS_RANGE_REL);
      // N = 1: still one batch, still every point.
      expect(g.solo.shapes).toEqual([["only", 64]]);
      expect(g.solo.perBatch[0].byteLength).toBe(64 * 64);
      expect(g.solo.parity.rangeRel).toBeLessThanOrEqual(BASIS_RANGE_REL);
    });

    it("N buffers out and N back, across cook → evict → recook", () => {
      const g = scenario.grouping;
      expect(g.holding.detachedBuffers).toBe(4); // one per asset
      expect(g.holdingBytesMatchCounts).toBe(true);
      expect(g.afterDispose).toMatchObject({ detachedBuffers: 0, detachedBytes: 0, inFlight: 0 });
      for (const [i, c] of g.cycles.entries()) {
        expect(c.batches, `cycle ${i}`).toBe(4);
        expect(c.detachedBuffers, `cycle ${i}`).toBe(4);
        expect(c.detachedBytes, `cycle ${i}`).toBeGreaterThan(0);
      }
      expect(g.afterCycles).toMatchObject({ detachedBuffers: 0, detachedBytes: 0, inFlight: 0 });
    });

    it("a chain in front now fuses WITH the multi-asset spawner, not up to it", () => {
      const c = scenario.groupingChain;
      expect(c.stats.fallbacks).toEqual({});
      expect(c.stats.residentRuns).toBe(1);
      expect(c.stats.fusedNodes).toBe(3); // transform + orient + spawn
      // Nothing materializes, so every member's readback is saved.
      expect(c.stats.readbacksSaved).toBe(3);
      // transformPoints apply + orient field kernel + orient apply, then
      // one compose dispatch PER ASSET.
      expect(c.batchCount).toBe(4);
      expect(c.stats.dispatches).toBe(3 + c.batchCount);
      expect(c.observed.shapesMatchCpu).toBe(true);
      expect(c.observed.parity.n).toBe(256 * 16);
      expect(c.observed.parity.rangeRel).toBeLessThanOrEqual(CHAIN_RANGE_REL);
    });

    // -----------------------------------------------------------------
    // 6. per-instance colour (phase 45)

    const colourCase = (name: string): ColourCase => {
      const c = scenario.colour.cases.find((x) => x.name === name);
      if (c === undefined) throw new Error(`scenario reported no colour case "${name}"`);
      return c;
    };

    it("a coloured spawn FUSES — the interim opt-out is gone, nothing falls back", () => {
      // Before this phase a `colorAttr` spawn declined device fusion with
      // the reason "instance-color": residentRuns 0, fusedNodes 0, and
      // CPU batches out. Every one of those numbers has to have moved,
      // and the reason must not appear anywhere.
      expect(scenario.colour.cases.map((c) => c.name)).toEqual([
        "rgba",
        "rgb",
        "grouped",
        "chained",
      ]);
      for (const c of scenario.colour.cases) {
        expect(c.stats.residentRuns, c.name).toBe(1);
        expect(c.stats.fallbacks, c.name).toEqual({});
        expect(Object.keys(c.stats.fallbacks), c.name).not.toContain("instance-color");
      }
      // Fusion still reaches THROUGH the spawner: the chained case fuses
      // transform + orient + spawn and reads nothing back at all.
      expect(colourCase("chained").stats.fusedNodes).toBe(3);
      expect(colourCase("chained").stats.readbacksSaved).toBe(3);
    });

    it("the device colours equal the CPU colours BIT FOR BIT, not approximately", () => {
      // A colour is a GATHER. There is no arithmetic in it and therefore
      // no ULP budget to hide a layout bug behind: any difference at all
      // means an instance took its colour from the wrong point, or the
      // stride is wrong. Compared with Object.is, so -0 does not pass as
      // 0 either.
      for (const c of scenario.colour.cases) {
        expect(
          c.colors.mismatchTotal,
          `${c.name}: first mismatches ${JSON.stringify(
            c.colors.perBatch.flatMap((b) => b.agreement?.mismatches ?? []),
          )}`,
        ).toBe(0);
        // Pin the sample size: a zero mismatch count over zero
        // comparisons would be the classic vacuous pass.
        expect(c.colors.compared, c.name).toBe(1024 * 3);
        expect(c.colors.perBatch.length, c.name).toBe(c.batchCount);
        for (const b of c.colors.perBatch) {
          expect(b.missing, `${c.name}/${b.assetId}`).toBeUndefined();
          expect(b.backend, `${c.name}/${b.assetId}`).toBe("webgpu");
        }
      }
      // The pinned edge rows, in the buffer: signed zero, out-of-gamut
      // and negative components, f32 extremes and SUBNORMALS all survived
      // the round trip unchanged — measured, not assumed, because a
      // flush-to-zero on load would have shown up here and nowhere else.
      const rgba = colourCase("rgba");
      expect(rgba.headGpu.slice(0, 4)).toEqual([0, 0, 0, 0]);
      expect(rgba.headGpu.slice(4, 8)).toEqual([1, 1, 1, 0]);
      expect(rgba.headGpu.slice(12, 16)).toEqual([-1.5, 2.75, 1.0000000116860974e-7, 0]);
    });

    it("the device buffer is 4 floats per instance, and the pad is 0 — never the alpha", () => {
      // The layout hazard, asserted rather than trusted: WGSL gives
      // `array<vec3<f32>>` a 16-byte stride, so a 3-float buffer would
      // shift every colour by a growing offset. `floatsPerInstance` is
      // derived from the handle's own byteLength, so this checks the
      // producer, not a constant.
      for (const c of scenario.colour.cases) {
        for (const b of c.colors.perBatch) {
          expect(b.agreement?.floatsPerInstance, `${c.name}/${b.assetId}`).toBe(4);
          expect(b.byteLength, `${c.name}/${b.assetId}`).toBe((b.count ?? -1) * 16);
          // Alpha is DROPPED, not padded through: the source's fourth
          // component is non-zero on most rows, so writing it into the
          // pad slot would light this up immediately.
          expect(b.agreement?.padNonZero, `${c.name}/${b.assetId}`).toBe(0);
        }
        expect(c.colors.padNonZeroTotal, c.name).toBe(0);
      }
    });

    it("colour rides the transform's own source index, through the grouping too", () => {
      // The structural claim: one kernel, one `src`, so an instance's
      // colour cannot come from a different point than its matrix did.
      // The multi-asset case is where a second traversal would break —
      // batch order is first-occurrence and within-batch order is the
      // host permutation, so a colour gathered in point order instead
      // would mismatch almost everywhere.
      for (const name of ["grouped", "chained"]) {
        const c = colourCase(name);
        expect(c.batchCount, name).toBe(4);
        expect(c.shapes, name).toEqual(c.cpuShapes);
        expect(c.colors.mismatchTotal, name).toBe(0);
      }
    });

    it("asking for colour does not move a transform byte, and not asking carries none", () => {
      for (const c of scenario.colour.cases) {
        expect(c.transformsUnmoved, c.name).toBe(true);
        expect(c.plainCarriesNoColour, c.name).toBe(true);
        expect(c.deterministic, c.name).toBe(true);
      }
    });

    it("a coloured batch retains TWO buffers, and both come back", () => {
      // The colour buffer is a second allocation behind a second handle.
      // Nothing in the library frees it, so a binding that retained only
      // `transforms` would leak one buffer per batch per cook.
      for (const c of scenario.colour.cases) {
        expect(c.holding.detachedBuffers, c.name).toBeGreaterThanOrEqual(c.batchCount * 2);
        expect(c.afterDispose, c.name).toMatchObject({
          detachedBuffers: 0,
          detachedBytes: 0,
          inFlight: 0,
        });
      }
      expect(colourCase("rgba").holding.detachedBuffers).toBe(5); // 2 + 2 + 1 uncoloured
      expect(colourCase("grouped").holding.detachedBuffers).toBe(20); // (4*2) * 2 + 4
    });

    // -----------------------------------------------------------------
    // 7. the spawner's budget, on the device path

    it("an over-budget spawn raises THE message — the identical string, not a device copy", () => {
      const b = scenario.budget;
      expect(b.max).toBe(1_048_576);
      // Character for character. The device path raises no diagnostic of
      // its own: it rejects the run with PlanFail, the members cook
      // per-node, and the CPU spawner says the one thing there is to say.
      // Two wordings of one refusal is the failure this pins.
      expect(b.deviceMessage).toBe(b.cpuMessage);
      expect(b.deviceMessage).toMatch(/would spawn 1048577 instances/);
      expect(b.deviceMessage).toMatch(/over the budget of 1048576/);
      expect(b.deviceMessage).toMatch(/64 MiB of matrices/);
      expect(b.deviceMessage).toMatch(/per COOK, not per world/);
      // And nothing device-flavoured leaked into it.
      expect(b.deviceMessage).not.toMatch(/resident run|GpuFieldEvaluator|PlanFail/);
      // The rejection allocates nothing and strands nothing.
      expect(b.detachedAfterFailure).toMatchObject({
        detachedBuffers: 0,
        detachedBytes: 0,
        inFlight: 0,
      });
    });

    it("the budget's own boundary still fuses: 2^20 instances, 64 MiB retained", () => {
      // A ceiling that also refused the largest legal cook would be a
      // silent off-by-one, so the boundary is composed for real.
      const b = scenario.budget;
      expect(b.limitDeviceResident).toBe(true);
      expect(b.limitStats.residentRuns).toBe(1);
      expect(b.limitStats.fallbacks).toEqual({});
      expect(b.limitShape).toEqual([["tree", 1_048_576, 1_048_576 * 64]]);
      expect(b.afterLimit).toMatchObject({ detachedBuffers: 0, detachedBytes: 0 });
    });

    it("without the opt-in the spawner is exactly what it was in v0.6.1", () => {
      const o = scenario.optOut;
      expect(o.residentTerminals).toEqual([]);
      expect(o.deviceBatchesPresent).toBe(false);
      expect(o.batchCount).toBe(256);
      // The chain in front still fuses, with the pre-phase-26 identity
      // readbacksSaved === fusedNodes - residentRuns intact.
      expect(o.stats.residentRuns).toBe(1);
      expect(o.stats.fusedNodes).toBe(2);
      expect(o.stats.readbacksSaved).toBe(o.stats.fusedNodes - o.stats.residentRuns);
      expect(o.stats.fallbacks).toEqual({});
      // No device buffer was ever retained on this path.
      expect(o.detachedBuffers).toBe(0);
      expect(o.parityVsCpuOnly.n).toBeGreaterThan(0);
      expect(o.parityVsCpuOnly.rangeRel).toBeLessThanOrEqual(CHAIN_RANGE_REL);
    });
  },
);
