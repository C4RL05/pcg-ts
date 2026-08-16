/**
 * Real-device suite for `{"fn":"byAttribute"}` — the N-way form of
 * `attributeIs`, whose case keys are not numbers but indices into a string
 * table that belongs to ONE geometry, N of them riding N uniform slots.
 * Asserts bit-exact (never budgeted) CPU parity, that two geometries whose
 * tables disagree in MEMBERSHIP and INDEX ORDER share a single compiled
 * kernel and still each get their own answer, that a case key the table
 * does not hold takes the DEFAULT rather than zeros or an error and leaves
 * the table untouched, that the tuple stride is applied, that a scalar
 * default splats against tuple cases, that a fused run declines with a
 * recorded reason, and that a `byAttribute` case and an `attributeIs` on
 * one (attribute, literal) pair share ONE slot. Bundles
 * byAttribute.testsupport.ts with esbuild and executes it in a plain Node
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

type Counts = Record<string, number>;

interface CaseColumn {
  resolved: boolean;
  bitExact: boolean;
  gpuCounts: Counts;
  cpuCounts: Counts;
}

interface ScenarioOutput {
  ok: boolean;
  error?: string;
  exact: {
    resolved: boolean;
    bitExact: boolean;
    dispatches: number;
    fallbacks: Record<string, number>;
    count: number;
    gpuCounts: Counts;
    cpuCounts: Counts;
  };
  soundness: {
    tableA: string[];
    tableB: string[];
    pineIndexA: number;
    pineIndexB: number;
    oakIndexA: number;
    oakIndexB: number;
    cedarIndexA: number;
    cedarIndexB: number;
    resolvedA: boolean;
    resolvedB: boolean;
    aBitExact: boolean;
    bBitExact: boolean;
    devicesDiffer: boolean;
    aCounts: Counts;
    bCounts: Counts;
    bakedBCounts: Counts;
    bakedBWouldDiffer: boolean;
    kernelCacheSize: number;
    pipelineCacheSize: number;
    pipelinesCompiled: number;
    dispatches: number;
    fallbacks: Record<string, number>;
    count: number;
  };
  absent: {
    resolved: boolean;
    threw: string | null;
    bitExact: boolean;
    fallbacks: Record<string, number>;
    gpuCounts: Counts;
    cpuCounts: Counts;
    tableBefore: string[];
    tableAfterDevice: string[];
    tableAfterCpu: string[];
    count: number;
  };
  stride: {
    seasonsInTable: boolean;
    table: string[];
    componentOne: CaseColumn;
    componentZero: CaseColumn;
    expectedTrunk: number;
    expectedBranch: number;
    count: number;
    fallbacks: Record<string, number>;
  };
  width: {
    resolved: boolean;
    bitExact: boolean;
    fallbacks: Record<string, number>;
    gpuTupleSize: number;
    cpuTupleSize: number;
    gpuLength: number;
    pineLane: number[];
    oakLane: number[];
    defaultLane: number[];
    count: number;
  };
  fused: {
    residentRuns: number;
    fusedNodes: number;
    fallbacks: Record<string, number>;
    kindBitExact: boolean;
    scaledBitExact: boolean;
    kindCounts: Counts;
    count: number;
  };
  slots: {
    sharedCount: number;
    sharedPairs: string[];
    sharedConstSlots: number;
    attributeIsAloneCount: number;
    byAttributeAloneCount: number;
    sharedWgslMentionsConsts: boolean;
  };
}

function runScenario(): ScenarioOutput {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, "..", "..", "node_modules", ".cache", "pcg-ts-device");
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, `by-attribute-${process.pid}.mjs`);
  try {
    buildSync({
      entryPoints: [join(here, "byAttribute.testsupport.ts")],
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

describe.skipIf(testDevice === null)(deviceSuiteName("byAttribute case sets"), () => {
  let scenario: ScenarioOutput;
  beforeAll(() => {
    scenario = runScenario();
  }, DEVICE_HOOK_TIMEOUT_MS);

  it("scenario ran to completion", () => {
    expect(scenario.error, scenario.error).toBeUndefined();
    expect(scenario.ok).toBe(true);
  });

  it("is bit-identical to the CPU, with no tolerance to spend", () => {
    const e = scenario.exact;
    // Resolved ON THE DEVICE first. Everything below compares two
    // Float32Arrays, and a declined field would have this suite measuring
    // the CPU against itself and reporting it as parity.
    expect(e.resolved).toBe(true);
    expect(e.dispatches).toBe(1);
    expect(e.fallbacks).toEqual({});
    // Both sides compare integers and then SELECT between values, so there
    // is nothing for a ULP budget to absorb: the bytes match or the
    // lowering is wrong. No budget may be introduced here later.
    expect(e.bitExact).toBe(true);
    // And every branch actually fired. The parity fixture cycles
    // pine/oak/birch from element 0, so with pine -> 10, oak -> 20 and
    // birch falling through to 99 the histogram is fixed by the fixture:
    // 1366 / 1365 / 1365 over 4096. A kernel that always chose one branch
    // would satisfy every byte comparison above with the CPU agreeing.
    expect(e.count).toBe(4096);
    expect(e.gpuCounts).toEqual({ "10": 1366, "20": 1365, "99": 1365 });
    expect(e.gpuCounts).toEqual(e.cpuCounts);
  });

  it("two geometries whose tables disagree share one kernel and still each get their own answer", () => {
    const s = scenario.soundness;
    // The premise, asserted before anything is concluded from it. The two
    // tables disagree in BOTH ways a table can: MEMBERSHIP (A has no
    // "cedar", B no "spruce") and INDEX ORDER (pine 2 vs 1, oak 1 vs 3).
    // If these ever coincided the case would pass while testing nothing.
    expect(s.tableA).toEqual(["", "oak", "pine", "spruce"]);
    expect(s.tableB).toEqual(["", "pine", "cedar", "oak"]);
    expect(s.pineIndexA).toBe(2);
    expect(s.pineIndexB).toBe(1);
    expect(s.pineIndexA).not.toBe(s.pineIndexB);
    expect(s.oakIndexA).toBe(1);
    expect(s.oakIndexB).toBe(3);
    expect(s.oakIndexA).not.toBe(s.oakIndexB);
    expect(s.cedarIndexA).toBe(-1);
    expect(s.cedarIndexB).toBe(2);

    expect(s.resolvedA).toBe(true);
    expect(s.resolvedB).toBe(true);
    expect(s.fallbacks).toEqual({});
    expect(s.dispatches).toBe(2);
    // They genuinely shared one compiled kernel: the cache key is the spec
    // key plus each attribute's name/type/tupleSize and carries no table
    // CONTENTS, and these two geometries have the same signature.
    expect(s.kernelCacheSize).toBe(1);
    expect(s.pipelineCacheSize).toBe(1);
    expect(s.pipelinesCompiled).toBe(1);

    // THE DISCRIMINATING PAIR — why a baked-literal lowering fails HERE
    // and passes every other case in this file.
    //
    // Suppose the compiler resolved each case key against the geometry in
    // hand and wrote the resulting index into the WGSL as a literal. The
    // three cache numbers above would be EXACTLY the same: the kernel key
    // carries spec text plus attribute descriptors and no table contents,
    // so A's kernel is served to B verbatim — one kernel, one pipeline,
    // one compile. B would then be answered with A's constants: pine
    // baked as 2, which in B's table names "cedar"; oak baked as 1, which
    // in B names "pine"; cedar baked as -1, matching nothing. Every lane
    // of B would take the wrong branch and `bBitExact` is what fails.
    //
    // The other cases in this file cannot catch that. Each dispatches ONE
    // geometry through a freshly built kernel, so a baked literal is
    // resolved against exactly the table it is then used on and is right
    // by construction — bit-exact, correct histogram, correct default,
    // correct stride, correct width. Two tables under one kernel is the
    // only arrangement that separates a per-dispatch uniform from a baked
    // constant, which is why the cache assertions and the parity
    // assertions have to be made together: the first establish that the
    // kernel really was shared, so the second can only be satisfied by
    // indices resolved per dispatch.
    expect(s.aBitExact).toBe(true);
    expect(s.bBitExact).toBe(true);
    // The two hold different species per element, so identical columns
    // would mean one was answered with the other's state.
    expect(s.devicesDiffer).toBe(true);
    // And each got its OWN answer, spelled out: A is oak/pine/spruce, so
    // it reads 20/10/(default 99) and never 30, because it has no cedar.
    // B is pine/cedar/oak, so it reads 10/30/20 and never falls through.
    expect(s.count).toBe(2048);
    expect(s.aCounts).toEqual({ "20": 683, "10": 683, "99": 682 });
    expect(s.bCounts).toEqual({ "10": 683, "30": 683, "20": 682 });

    // The counterfactual, measured rather than argued. `bakedBCounts` is
    // the column B would have come back with under A's baked constants,
    // and it is not B's answer — B's cedars would have read pine's value,
    // B's pines oak's, and B's oaks the default. It also lands on exactly
    // A's histogram, which is the failure stated at its sharpest: the
    // second geometry would have been served the first one's answer.
    expect(s.bakedBCounts).toEqual({ "20": 683, "10": 683, "99": 682 });
    expect(s.bakedBCounts).toEqual(s.aCounts);
    expect(s.bakedBCounts).not.toEqual(s.bCounts);
    expect(s.bakedBWouldDiffer).toBe(true);
  });

  it("a case key the table does not hold takes the default, not zeros, and does not touch the table", () => {
    const a = scenario.absent;
    expect(a.threw, a.threw ?? undefined).toBeNull();
    expect(a.resolved).toBe(true);
    expect(a.fallbacks).toEqual({});
    expect(a.bitExact).toBe(true);
    // The geometry alternates pine/oak; the case set names pine and birch.
    // So the pines read 10, every oak falls through to the DEFAULT 99, and
    // birch's 20 is dead code. Asserted as an exact histogram because the
    // two failure modes this guards against are both silent: a 0 anywhere
    // would be the zeros `attributeIs` yields (wrong fn's answer), and a
    // 20 anywhere would be an absent key matching something.
    expect(a.count).toBe(2048);
    expect(a.gpuCounts).toEqual({ "10": 1024, "99": 1024 });
    expect(a.gpuCounts).toEqual(a.cpuCounts);

    // The premise: "birch" was never in this cell's table to begin with.
    expect(a.tableBefore).toEqual(["", "pine", "oak"]);
    // And resolving on the device did not put it there. `internString`
    // INSERTS on miss, so a fill that used it would append an entry no
    // element uses — invisible until the next `copyFrom` compacts the
    // table and renumbers everything after it, at which point two cells of
    // one world disagree for no reason a caller could see.
    expect(a.tableAfterDevice).toEqual(a.tableBefore);
    expect(a.tableAfterCpu).toEqual(a.tableBefore);
  });

  it("applies the tuple stride: a case set keyed by component 1's values matches nothing", () => {
    const s = scenario.stride;
    // The distinction this case exists to make: "summer" and "winter" ARE
    // table entries, so their fall-through is the stride's doing rather
    // than an absent key's. The two are indistinguishable in the output
    // column, and this is the exact defect `attributeIs` had in its first
    // sketch.
    expect(s.seasonsInTable).toBe(true);
    expect(s.table).toEqual(["", "trunk", "summer", "branch", "winter"]);
    expect(s.fallbacks).toEqual({});
    expect(s.count).toBe(1024);

    expect(s.componentOne.resolved).toBe(true);
    expect(s.componentOne.bitExact).toBe(true);
    // Every lane takes the default; neither season value appears.
    expect(s.componentOne.gpuCounts).toEqual({ "99": 1024 });
    expect(s.componentOne.gpuCounts).toEqual(s.componentOne.cpuCounts);

    // The other half, without which "all default" would also be satisfied
    // by a kernel that matched nothing at all.
    expect(s.componentZero.resolved).toBe(true);
    expect(s.componentZero.bitExact).toBe(true);
    expect(s.componentZero.gpuCounts).toEqual({
      "5": s.expectedTrunk,
      "6": s.expectedBranch,
    });
    expect(s.componentZero.gpuCounts).toEqual(s.componentZero.cpuCounts);
    expect(s.expectedTrunk).toBe(512);
    expect(s.expectedBranch).toBe(512);
  });

  it("broadcasts a scalar default against tuple cases, splatted", () => {
    const w = scenario.width;
    expect(w.resolved).toBe(true);
    expect(w.fallbacks).toEqual({});
    expect(w.bitExact).toBe(true);
    // The width is a property of the EXPRESSION, never of which case
    // fired, so a lane that took the SCALAR default is still three wide.
    expect(w.gpuTupleSize).toBe(3);
    expect(w.cpuTupleSize).toBe(3);
    expect(w.count).toBe(1536);
    expect(w.gpuLength).toBe(1536 * 3);
    // The fixture cycles pine/oak/birch from element 0, so lanes 0/1/2 are
    // one of each: two tuple cases and the fall-through.
    expect(w.pineLane).toEqual([1, 2, 3]);
    expect(w.oakLane).toEqual([4, 5, 6]);
    // The splat itself. A default lowered without it would read (7, 0, 0),
    // which is a plausible-looking column nobody wrote.
    expect(w.defaultLane).toEqual([7, 7, 7]);
  });

  it("a fused run declines with a recorded reason, and its members still cook correctly", () => {
    const f = scenario.fused;
    // Plan time carries attribute descriptors and a count, not data, so
    // there is no string table to resolve N indices against and the run
    // rejects whole. The reason is the existing vocabulary rather than a
    // new one — the pillar is that a path which cannot run on the device
    // says why, machine-readably, instead of doing something else.
    expect(f.fallbacks["run-plan-failed"] ?? 0).toBeGreaterThanOrEqual(1);
    expect(f.residentRuns).toBe(0);
    expect(f.fusedNodes).toBe(0);
    // ...and declining costs nothing but residency: the members cook on
    // the per-node device path, where the same field DOES resolve, and
    // land on the CPU cook's bytes exactly.
    expect(f.kindBitExact).toBe(true);
    expect(f.scaledBitExact).toBe(true);
    expect(f.count).toBe(4096);
    expect(f.kindCounts).toEqual({ "10": 1366, "20": 1365, "99": 1365 });
  });

  it("shares one uniform slot between an attributeIs and a byAttribute case on the same pair", () => {
    const s = scenario.slots;
    // Both fns file their (attribute, literal) pairs into one map under
    // one `attrIsKey`, so `attributeIs("species", "pine")` beside a case
    // set naming pine and oak costs TWO slots, not three: pine is shared.
    expect(s.attributeIsAloneCount).toBe(1);
    expect(s.byAttributeAloneCount).toBe(2);
    // The saving, stated as the number that would be 3 without sharing.
    expect(s.sharedCount).toBe(2);
    expect(s.sharedCount).toBeLessThan(s.attributeIsAloneCount + s.byAttributeAloneCount);
    expect(s.sharedPairs).toEqual(["species==oak", "species==pine"]);
    // No `param` in the spec, so every constant slot is an attrIs slot —
    // the sharing is visible in the uniform's size and not only in the
    // bookkeeping.
    expect(s.sharedConstSlots).toBe(2);
    // And the kernel reads them from the uniform rather than carrying
    // resolved indices in its text.
    expect(s.sharedWgslMentionsConsts).toBe(true);
  });
});
