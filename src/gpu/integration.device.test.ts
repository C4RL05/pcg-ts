/**
 * Real-device integration of the evaluator with cook, subgraphs, the
 * World, and captureAsync: bundles deviceScenario.ts with esbuild (a
 * transitive dev dependency via vite) and executes it in a plain Node
 * child process (see deviceRunner.mjs for why no vitest worker may
 * touch Dawn), asserting on its JSON observations. Skips visibly
 * without an adapter.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import { DEVICE_HOOK_TIMEOUT_MS, deviceSuiteName, testDevice } from "./testDevice.js";

interface ScenarioOutput {
  ok: boolean;
  error?: string;
  salt: string;
  basics: {
    resolved: boolean;
    bitExact: boolean;
    secondBitExact: boolean;
    stats1: { dispatches: number; pipelinesCompiled: number; pipelineCacheHits: number; fallbacks: Record<string, number> };
    stats2: { dispatches: number; pipelinesCompiled: number; pipelineCacheHits: number; fallbacks: Record<string, number> };
    pipelineCacheSize: number;
    empty: { length: number; type: string; stats: { dispatches: number; fallbacks: Record<string, number> } };
    noSpec: { isNull: boolean; stats: { fallbacks: Record<string, number> } };
    derivedSpec: { isNull: boolean; stats: { fallbacks: Record<string, number> } };
    derivedAccepted: {
      resolved: boolean;
      bitExact: boolean;
      stats: { dispatches: number; fallbacks: Record<string, number> };
      advertised: boolean;
      defaultAdvertised: boolean;
      opaqueStillNull: boolean;
      opaqueStats: { fallbacks: Record<string, number> };
    };
    stringAttr: { isNull: boolean; stats: { fallbacks: Record<string, number> } };
    u32Root: { type: string; bitExact: boolean };
    indexRoot: { type: string; bitExact: boolean };
    boolAttr: { type: string; bitExact: boolean };
  };
  captureAsync: { sameName: boolean; bitExact: boolean; stats: { dispatches: number } };
  cookProvenance: {
    cpu: { cooked: number; cached: number; hasGpuStats: boolean };
    gpuFirst: { cooked: number; cached: number; gpu: { dispatches: number; fallbacks: Record<string, number> }; bitExact: boolean };
    gpuSecond: { cooked: number; cached: number; gpu: { dispatches: number } };
    cpuAgain: { cooked: number; cached: number; bitExact: boolean };
  };
  plainValue: {
    first: { cooked: number };
    toggled: { cooked: number; cached: number; gpu: { dispatches: number; fallbacks: Record<string, number> } };
  };
  fallbackEquivalence: {
    gpuCookStats: { dispatches: number; fallbacks: Record<string, number> };
    bitExact: boolean;
  };
  derivedAdoption: {
    gpuCookStats: { dispatches: number; fallbacks: Record<string, number> };
    bitExact: boolean;
    cachedSecondCook: number;
    recookedWithoutResolver: number;
  };
  subgraph: {
    gpuFirst: { cooked: number; gpu: { dispatches: number }; bitExact: boolean };
    cpuToggle: { cooked: number };
    gpuAgain: { cooked: number; gpu: { dispatches: number } };
    gpuCached: { cooked: number; cached: number; gpu: { dispatches: number } };
  };
  world: {
    firstCooked: number;
    afterFirst: { world: number; update: number };
    secondCooked: number;
    afterSecond: { world: number; update: number };
    cellHasAttr: boolean;
  };
}

function runScenario(): ScenarioOutput {
  const here = dirname(fileURLToPath(import.meta.url));
  // Bundle into node_modules/.cache so the child resolves the external
  // "webgpu" specifier against this repo's node_modules.
  const outDir = join(here, "..", "..", "node_modules", ".cache", "pcg-ts-device");
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, `scenario-${process.pid}.mjs`);
  try {
    buildSync({
      entryPoints: [join(here, "deviceScenario.ts")],
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
      timeout: 180_000,
    });
    return JSON.parse(stdout) as ScenarioOutput;
  } finally {
    rmSync(outfile, { force: true });
  }
}

describe.skipIf(testDevice === null)(deviceSuiteName("evaluator + cook integration"), () => {
  let scenario: ScenarioOutput;
  beforeAll(() => {
    scenario = runScenario();
  }, DEVICE_HOOK_TIMEOUT_MS);

  it("scenario ran to completion", () => {
    expect(scenario.error, scenario.error).toBeUndefined();
    expect(scenario.ok).toBe(true);
  });

  it("cache salt carries the format version and adapter identity", () => {
    expect(scenario.salt.startsWith("gpu2|")).toBe(true);
    expect(scenario.salt.split("|").length).toBe(5);
  });

  it("evaluator resolves a spec'd field bit-exactly and caches the pipeline", () => {
    const b = scenario.basics;
    expect(b.resolved).toBe(true);
    expect(b.bitExact).toBe(true);
    expect(b.secondBitExact).toBe(true);
    expect(b.stats1).toEqual({ dispatches: 1, pipelinesCompiled: 1, pipelineCacheHits: 0, residentRuns: 0, fusedNodes: 0, readbacksSaved: 0, fallbacks: {} });
    expect(b.stats2).toEqual({ dispatches: 1, pipelinesCompiled: 0, pipelineCacheHits: 1, residentRuns: 0, fusedNodes: 0, readbacksSaved: 0, fallbacks: {} });
    expect(b.pipelineCacheSize).toBeGreaterThanOrEqual(1);
  });

  it("count 0 returns an empty column without dispatching", () => {
    const e = scenario.basics.empty;
    expect(e.length).toBe(0);
    expect(e.type).toBe("Float32Array");
    expect(e.stats.dispatches).toBe(0);
    expect(e.stats.fallbacks).toEqual({});
  });

  it("ineligible fields return null with machine-readable reasons", () => {
    expect(scenario.basics.noSpec.isNull).toBe(true);
    expect(scenario.basics.noSpec.stats.fallbacks).toEqual({ "no-spec": 1 });
    expect(scenario.basics.stringAttr.isNull).toBe(true);
    expect(scenario.basics.stringAttr.stats.fallbacks).toEqual({ "compile-error": 1 });
    // A code-authored field is a different population from an
    // indescribable one, and says so.
    expect(scenario.basics.derivedSpec.isNull).toBe(true);
    expect(scenario.basics.derivedSpec.stats.fallbacks).toEqual({ "derived-spec": 1 });
  });

  it("acceptDerivedSpecs resolves the code-authored field on the real device", () => {
    const d = scenario.basics.derivedAccepted;
    expect(d.defaultAdvertised).toBe(false); // the shipped default
    expect(d.advertised).toBe(true);
    expect(d.resolved).toBe(true);
    expect(d.stats.dispatches).toBe(1);
    expect(d.stats.fallbacks).toEqual({});
    // `randomField` is a bit-exact hash port, so widening eligibility
    // moved this field onto the device without moving a single byte.
    expect(d.bitExact).toBe(true);
    // The flag widens exactly one population: a makeField closure is
    // still indescribable and still says "no-spec".
    expect(d.opaqueStillNull).toBe(true);
    expect(d.opaqueStats.fallbacks).toEqual({ "no-spec": 1 });
  });

  it("output column types mirror the CPU: u32/index/bool roots", () => {
    expect(scenario.basics.u32Root).toEqual({ type: "Uint32Array", bitExact: true });
    expect(scenario.basics.indexRoot).toEqual({ type: "Uint32Array", bitExact: true });
    expect(scenario.basics.boolAttr).toEqual({ type: "Float32Array", bitExact: true });
  });

  it("captureAsync matches capture byte for byte and reports stats", () => {
    expect(scenario.captureAsync.sameName).toBe(true);
    expect(scenario.captureAsync.bitExact).toBe(true);
    expect(scenario.captureAsync.stats.dispatches).toBe(1);
  });

  it("gpu toggle changes provenance: recooks, never serves bytes across", () => {
    const c = scenario.cookProvenance;
    expect(c.cpu.cooked).toBe(2);
    expect(c.cpu.hasGpuStats).toBe(false);
    // Toggle on: only the adopting node recooks; bytes identical (bit-exact spec).
    expect(c.gpuFirst.cooked).toBe(1);
    expect(c.gpuFirst.cached).toBe(1);
    expect(c.gpuFirst.gpu.dispatches).toBe(1);
    expect(c.gpuFirst.gpu.fallbacks).toEqual({});
    expect(c.gpuFirst.bitExact).toBe(true);
    // Same-provenance recook: fully cached, zero dispatches.
    expect(c.gpuSecond.cooked).toBe(0);
    expect(c.gpuSecond.cached).toBe(2);
    expect(c.gpuSecond.gpu.dispatches).toBe(0);
    // Toggle off: recooks again on CPU, bytes identical.
    expect(c.cpuAgain.cooked).toBe(1);
    expect(c.cpuAgain.bitExact).toBe(true);
  });

  it("plain-value params keep their cache across the gpu toggle", () => {
    expect(scenario.plainValue.first.cooked).toBe(2);
    expect(scenario.plainValue.toggled.cooked).toBe(0);
    expect(scenario.plainValue.toggled.cached).toBe(2);
    expect(scenario.plainValue.toggled.gpu.dispatches).toBe(0);
  });

  it("ineligible field under a gpu cook is byte-identical to a CPU cook", () => {
    expect(scenario.fallbackEquivalence.bitExact).toBe(true);
    expect(scenario.fallbackEquivalence.gpuCookStats.dispatches).toBe(0);
    expect(scenario.fallbackEquivalence.gpuCookStats.fallbacks).toEqual({ "derived-spec": 1 });
  });

  it("an adopted code-authored field is salted as well as dispatched", () => {
    const d = scenario.derivedAdoption;
    expect(d.gpuCookStats.dispatches).toBe(1);
    expect(d.gpuCookStats.fallbacks).toEqual({});
    expect(d.bitExact).toBe(true);
    // Same provenance twice: fully cached (2 nodes).
    expect(d.cachedSecondCook).toBe(2);
    // Drop the resolver and the node MUST recook — proof the widened
    // acceptance widened the memo key with it, on real hardware.
    expect(d.recookedWithoutResolver).toBe(1);
  });

  it("subgraphs forward the resolver and carry conservative provenance", () => {
    const s = scenario.subgraph;
    // Inner dispatch counted in the OUTER cook's stats (sink routing).
    expect(s.gpuFirst.gpu.dispatches).toBe(1);
    expect(s.gpuFirst.bitExact).toBe(true);
    // A gpu-cooked subgraph is not served to a CPU cook, and vice versa.
    expect(s.cpuToggle.cooked).toBe(1);
    expect(s.gpuAgain.cooked).toBe(1);
    // Same provenance again: cached, no dispatches.
    expect(s.gpuCached.cooked).toBe(0);
    expect(s.gpuCached.cached).toBe(1);
    expect(s.gpuCached.gpu.dispatches).toBe(0);
  });

  it("World threads WorldOptions.gpu and UpdateOptions.gpu (update wins)", () => {
    const w = scenario.world;
    expect(w.firstCooked).toBeGreaterThan(0);
    expect(w.afterFirst.world).toBeGreaterThan(0);
    expect(w.afterFirst.update).toBe(0);
    expect(w.secondCooked).toBeGreaterThan(0);
    // The update-level resolver took over; the world-level one saw no new calls.
    expect(w.afterSecond.world).toBe(w.afterFirst.world);
    expect(w.afterSecond.update).toBeGreaterThan(0);
    expect(w.cellHasAttr).toBe(true);
  });
});
