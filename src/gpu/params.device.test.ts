/**
 * Real-device suite for `{"fn":"param"}` — the grammar node whose value
 * rides a uniform slot instead of a WGSL literal. Asserts bit-exact CPU
 * parity on both device paths (per-field and fused), that rebinding does
 * not grow the kernel or pipeline caches, and that an unbound reference
 * never reaches the device. Bundles params.testsupport.ts with esbuild and
 * executes it in a plain Node child process (see deviceRunner.mjs for why
 * no vitest worker may touch Dawn). Skips visibly without an adapter.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import { DEVICE_HOOK_TIMEOUT_MS, deviceSuiteName, testDevice } from "./gpuDevice.testsupport.js";

interface ScenarioOutput {
  ok: boolean;
  error?: string;
  parity: Array<{
    name: string;
    resolved: boolean;
    bitExact: boolean;
    cpuExact: boolean;
    maxRelDiff: number;
    literalCompared: boolean;
    equalsLiteral: boolean;
    params: number;
  }>;
  sweep: {
    distinctFieldKeys: number;
    bitExact: boolean;
    kernelCacheSize: number;
    pipelineCacheSize: number;
    pipelinesCompiled: number;
    pipelineCacheHits: number;
    dispatches: number;
    fallbacks: Record<string, number>;
  };
  fused: {
    residentRuns: number;
    fusedNodes: number;
    fallbacks: Record<string, number>;
    scaledBitExact: boolean;
    flatBitExact: boolean;
    rebindScaledBitExact: boolean;
    rebindFlatBitExact: boolean;
    rebindChangedBytes: boolean;
  };
  chunked: { resolved: boolean; bitExact: boolean };
  unbound: { declined: boolean; fallbacks: Record<string, number>; cpuThrew: boolean };
}

function runScenario(): ScenarioOutput {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, "..", "..", "node_modules", ".cache", "pcg-ts-device");
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, `params-${process.pid}.mjs`);
  try {
    buildSync({
      entryPoints: [join(here, "params.testsupport.ts")],
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

describe.skipIf(testDevice === null)(deviceSuiteName("param uniform slots"), () => {
  let scenario: ScenarioOutput;
  beforeAll(() => {
    scenario = runScenario();
  }, DEVICE_HOOK_TIMEOUT_MS);

  it("scenario ran to completion", () => {
    expect(scenario.error, scenario.error).toBeUndefined();
    expect(scenario.ok).toBe(true);
  });

  it("every case resolved on the device and carried at least one param", () => {
    const declined = scenario.parity.filter((c) => !c.resolved).map((c) => c.name);
    expect(declined, declined.join(", ")).toEqual([]);
    expect(scenario.parity.length).toBeGreaterThanOrEqual(8);
    expect(scenario.parity.every((c) => c.params >= 1)).toBe(true);
  });

  it("substituting a param for the literal does not move a single GPU byte", () => {
    // THE claim, isolated: the same expression written with the value
    // baked in produces the same column. It is asked separately from CPU
    // parity because the surrounding ops round on their own (remap
    // divides, the noise interior is f32) — that rounding is the parity
    // suite's business, and it would otherwise mask this.
    const differing = scenario.parity
      .filter((c) => c.literalCompared && !c.equalsLiteral)
      .map((c) => c.name);
    expect(differing, differing.join(", ")).toEqual([]);
    // ...and enough cases actually made the comparison for it to mean
    // something (the -0/subnormal pair deliberately does not).
    expect(scenario.parity.filter((c) => c.literalCompared).length).toBeGreaterThanOrEqual(6);
  });

  it("is bit-exact against the CPU wherever the surrounding ops are", () => {
    // A param contributes a value, never an operation, so an expression
    // of + − × over one is bit-exact end to end — no budget needed.
    const failures = scenario.parity
      .filter((c) => c.cpuExact && !c.bitExact)
      .map((c) => `${c.name}: bytes differ from the CPU`);
    expect(failures, failures.join("\n")).toEqual([]);
    // Where they are not, this only asserts the value ARRIVED. The bound
    // is deliberately loose — the measured worst here is 1.5e-6 relative,
    // which is the f32 noise interior and belongs to the parity suite's
    // per-family ULP budgets — because the failure it guards against is
    // not a rounding one: a slot carrying the wrong bits makes a
    // different number, and the error is O(1), not O(1e-6).
    for (const c of scenario.parity.filter((p) => !p.cpuExact)) {
      expect(c.maxRelDiff, `${c.name}: relative error`).toBeLessThan(1e-4);
    }
  });

  it("carries -0 and subnormal bindings, which a baked literal loses", () => {
    // The named cases from the table, called out because they are the
    // ones the uniform path wins rather than merely matches: a WGSL front
    // end may flush either as a LITERAL and never as a uniform load.
    for (const name of ["negative zero", "subnormal"]) {
      const c = scenario.parity.find((p) => p.name === name);
      expect(c, `missing parity case "${name}"`).toBeDefined();
      expect(c?.bitExact, name).toBe(true);
    }
  });

  it("fifty values compile one kernel and one pipeline", () => {
    const s = scenario.sweep;
    // The premise first: every value really did produce a distinct field
    // key, so the caches were genuinely offered fifty different fields.
    expect(s.distinctFieldKeys).toBe(50);
    expect(s.bitExact).toBe(true);
    expect(s.fallbacks).toEqual({});
    expect(s.dispatches).toBe(50);
    // ...and the caches saw one of everything. Both Maps are unbounded,
    // so this is a memory contract, not a performance nicety.
    expect(s.kernelCacheSize).toBe(1);
    expect(s.pipelineCacheSize).toBe(1);
    expect(s.pipelinesCompiled).toBe(1);
    expect(s.pipelineCacheHits).toBe(49);
  });

  it("a fused run carries param slots through step.consts, bit-exactly", () => {
    const f = scenario.fused;
    expect(f.fallbacks).toEqual({});
    expect(f.residentRuns).toBe(1);
    expect(f.fusedNodes).toBe(2);
    expect(f.scaledBitExact, "field kernel with an input AND a const slot").toBe(true);
    expect(f.flatBitExact, "field kernel with a const slot and no input").toBe(true);
  });

  it("a rebound run recooks to the new value's bytes", () => {
    const f = scenario.fused;
    expect(f.rebindChangedBytes, "the two bindings must actually differ").toBe(true);
    expect(f.rebindScaledBitExact).toBe(true);
    expect(f.rebindFlatBitExact).toBe(true);
  });

  it("survives a chunk seam: the slots are written once, chunkOffset per chunk", () => {
    // Both live in one uniform, and the dispatch loop rewrites only the
    // offset between chunks — through a view over the same bytes the
    // slots were written into.
    expect(scenario.chunked.resolved).toBe(true);
    expect(scenario.chunked.bitExact).toBe(true);
  });

  it("an unbound param declines rather than dispatching a zero", () => {
    const u = scenario.unbound;
    expect(u.declined).toBe(true);
    expect(u.fallbacks).toEqual({ "param-bindings": 1 });
    // And the CPU it falls back to is what raises the actionable error —
    // which is the whole reason declining is the right move.
    expect(u.cpuThrew).toBe(true);
  });
});
