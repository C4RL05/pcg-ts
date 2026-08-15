/**
 * Real-device suite for `{"fn":"attributeIs"}` — the grammar node whose
 * value is not a number at all but an index into a string table that
 * belongs to ONE geometry. Asserts bit-exact (never budgeted) CPU parity,
 * that two geometries whose tables order the same literals differently
 * share a single compiled kernel and still each get their own answer,
 * that an absent literal is zeros rather than an error and leaves the
 * table untouched, that the tuple stride is applied, and that a fused run
 * declines with a recorded reason. Bundles attributeIs.testsupport.ts
 * with esbuild and executes it in a plain Node child process (see
 * deviceRunner.mjs for why no vitest worker may touch Dawn). Skips
 * visibly without an adapter.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import { DEVICE_HOOK_TIMEOUT_MS, deviceSuiteName, testDevice } from "./gpuDevice.testsupport.js";

interface ColumnCase {
  resolved: boolean;
  bitExact: boolean;
  allZeros: boolean;
  gpuOnes: number;
  cpuOnes: number;
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
    gpuOnes: number;
    cpuOnes: number;
  };
  soundness: {
    pineIndexA: number;
    pineIndexB: number;
    tableA: string[];
    tableB: string[];
    resolvedA: boolean;
    resolvedB: boolean;
    aBitExact: boolean;
    bBitExact: boolean;
    devicesDiffer: boolean;
    aOnes: number;
    bOnes: number;
    kernelCacheSize: number;
    pipelineCacheSize: number;
    pipelinesCompiled: number;
    dispatches: number;
    fallbacks: Record<string, number>;
  };
  absent: {
    resolved: boolean;
    threw: string | null;
    bitExact: boolean;
    allZeros: boolean;
    cpuAllZeros: boolean;
    fallbacks: Record<string, number>;
    tableBefore: string[];
    tableAfterDevice: string[];
    tableAfterCpu: string[];
  };
  stride: {
    componentOneValueInTable: boolean;
    componentOne: ColumnCase;
    componentZero: ColumnCase;
    expectedComponentZeroOnes: number;
    table: string[];
    count: number;
    fallbacks: Record<string, number>;
  };
  fused: {
    residentRuns: number;
    fusedNodes: number;
    fallbacks: Record<string, number>;
    isPineBitExact: boolean;
    scaledBitExact: boolean;
    isPineOnes: number;
    count: number;
  };
}

function runScenario(): ScenarioOutput {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, "..", "..", "node_modules", ".cache", "pcg-ts-device");
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, `attribute-is-${process.pid}.mjs`);
  try {
    buildSync({
      entryPoints: [join(here, "attributeIs.testsupport.ts")],
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

describe.skipIf(testDevice === null)(deviceSuiteName("attributeIs string tables"), () => {
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
    // Both sides compare integers and emit 0 or 1, so there is nothing
    // for a ULP budget to absorb: the bytes match or the lowering is
    // wrong. No budget may be introduced here later.
    expect(e.bitExact).toBe(true);
    // And the predicate actually selected something. The parity fixture
    // cycles pine/oak/birch from element 0, so the pines are the lanes
    // where i % 3 === 0 — an all-zero column would satisfy every byte
    // comparison above with the CPU agreeing.
    expect(e.gpuOnes).toBe(e.cpuOnes);
    expect(e.gpuOnes).toBe(Math.ceil(e.count / 3));
  });

  it("two geometries whose tables disagree share one kernel and still each get their own answer", () => {
    const s = scenario.soundness;
    // The premise, asserted before anything is concluded from it: the two
    // tables really do hold "pine" at different indices. A is written
    // oak-first and B pine-first, so after the default "" at index 0 they
    // land at 2 and 1. If these ever coincided the case would pass while
    // testing nothing.
    expect(s.tableA).toEqual(["", "oak", "pine"]);
    expect(s.tableB).toEqual(["", "pine", "oak"]);
    expect(s.pineIndexA).toBe(2);
    expect(s.pineIndexB).toBe(1);
    expect(s.pineIndexA).not.toBe(s.pineIndexB);

    expect(s.resolvedA).toBe(true);
    expect(s.resolvedB).toBe(true);
    expect(s.fallbacks).toEqual({});
    expect(s.dispatches).toBe(2);
    // They genuinely shared one compiled kernel: the cache key is the
    // spec key plus each attribute's name/type/tupleSize and carries no
    // table CONTENTS, and these two geometries have the same signature.
    expect(s.kernelCacheSize).toBe(1);
    expect(s.pipelineCacheSize).toBe(1);
    expect(s.pipelinesCompiled).toBe(1);
    // THE DISCRIMINATING PAIR. With the index baked into the WGSL the
    // three cache numbers above would be exactly the same — one kernel,
    // one pipeline, one compile — and B would have been answered with A's
    // constant, which in B's table names "oak". So B's parity is what
    // fails in that world, and it can only pass because the index is
    // resolved per dispatch against the geometry in hand.
    expect(s.aBitExact).toBe(true);
    expect(s.bBitExact).toBe(true);
    // The two hold different species per element, so identical columns
    // would mean one was answered with the other's state.
    expect(s.devicesDiffer).toBe(true);
    expect(s.aOnes).toBeGreaterThan(0);
    expect(s.bOnes).toBeGreaterThan(0);
    expect(s.aOnes).not.toBe(s.bOnes);
  });

  it("a literal the table does not hold is zeros, not an error, and does not touch the table", () => {
    const a = scenario.absent;
    expect(a.threw, a.threw ?? undefined).toBeNull();
    expect(a.resolved).toBe(true);
    expect(a.fallbacks).toEqual({});
    expect(a.allZeros).toBe(true);
    expect(a.cpuAllZeros).toBe(true);
    expect(a.bitExact).toBe(true);
    // The premise: "birch" was never in this cell's table to begin with.
    expect(a.tableBefore).toEqual(["", "pine", "oak"]);
    // And resolving on the device did not put it there. `internString`
    // INSERTS on miss, so a fill that used it would append an entry no
    // element uses — invisible until the next `copyFrom` compacts the
    // table and renumbers everything after it, at which point two cells
    // of one world disagree for no reason a caller could see.
    expect(a.tableAfterDevice).toEqual(a.tableBefore);
    expect(a.tableAfterCpu).toEqual(a.tableBefore);
  });

  it("applies the tuple stride: a value that only sits at component 1 matches nothing", () => {
    const s = scenario.stride;
    // The distinction this case exists to make: "summer" IS in the table,
    // so its zeros are the stride's doing rather than an absent literal's.
    // The two are indistinguishable in the output column.
    expect(s.componentOneValueInTable).toBe(true);
    expect(s.table).toEqual(["", "trunk", "summer", "branch", "winter"]);
    expect(s.fallbacks).toEqual({});

    expect(s.componentOne.resolved).toBe(true);
    expect(s.componentOne.allZeros).toBe(true);
    expect(s.componentOne.bitExact).toBe(true);
    expect(s.componentOne.cpuOnes).toBe(0);

    // The other half, without which "all zeros" would also be satisfied
    // by a kernel that matched nothing at all.
    expect(s.componentZero.resolved).toBe(true);
    expect(s.componentZero.bitExact).toBe(true);
    expect(s.componentZero.gpuOnes).toBe(s.expectedComponentZeroOnes);
    expect(s.componentZero.cpuOnes).toBe(s.expectedComponentZeroOnes);
  });

  it("a fused run declines with a recorded reason, and its members still cook correctly", () => {
    const f = scenario.fused;
    // Plan time carries attribute descriptors and a count, not data, so
    // there is no string table to resolve an index against and the run
    // rejects whole. The reason is the existing vocabulary rather than a
    // new one — the pillar is that a path which cannot run on the device
    // says why, machine-readably, instead of doing something else.
    expect(f.fallbacks["run-plan-failed"] ?? 0).toBeGreaterThanOrEqual(1);
    expect(f.residentRuns).toBe(0);
    expect(f.fusedNodes).toBe(0);
    // ...and declining costs nothing but residency: the members cook on
    // the per-node device path, where the same field DOES resolve, and
    // land on the CPU cook's bytes exactly.
    expect(f.isPineBitExact).toBe(true);
    expect(f.scaledBitExact).toBe(true);
    expect(f.isPineOnes).toBe(Math.ceil(f.count / 3));
  });
});
