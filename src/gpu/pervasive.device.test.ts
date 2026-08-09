/**
 * Real-device suite for phase 22: per-node adoption parity
 * (transformPoints, jitterPoints, orientAlongVector, surfaceSample,
 * volumeSample under a real GpuFieldEvaluator cook), chunk-seam
 * byte-equality (incl. one realistic beyond-single-dispatch resolve),
 * and buffer-pool reuse safety. Bundles pervasiveScenario.ts with
 * esbuild and executes it in a plain Node child process (see
 * deviceRunner.mjs for why no vitest worker may touch Dawn). Skips
 * visibly without an adapter.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import { DEVICE_HOOK_TIMEOUT_MS, deviceSuiteName, testDevice } from "./testDevice.js";

interface BitExact {
  dispatches: number;
  fallbacks: Record<string, number>;
  recooked: number;
  equal: boolean;
}
interface NoiseParity {
  dispatches: number;
  maxUlp?: number;
  rangeUlp?: number;
  minQuatDot?: number;
}
interface PoolStats {
  buffersCreated: number;
  buffersReused: number;
  buffersDestroyed: number;
  pooledBuffers: number;
  pooledBytes: number;
}

interface ScenarioOutput {
  ok: boolean;
  error?: string;
  salt: string;
  adoption: Record<string, { bitExact: BitExact; noise?: NoiseParity }> & {
    surfaceSampleNoise: { cpuAccepted: number; gpuAccepted: number; symDiff: number; dispatches: number };
  };
  chunking: {
    seams: Record<string, { chunkedEqualsUnchunked: boolean; flooredEqualsUnchunked: boolean; equalsCpu: boolean }>;
    big: { count: number; equalsCpu: boolean; length: number; ms: number };
  };
  pooling: {
    steps: Array<{ name: string; equalsFresh: boolean; equalsCpu: boolean }>;
    stats: PoolStats;
    unpooledStats: PoolStats;
    chunked: { equal: boolean; equalsCpu: boolean; afterFirst: PoolStats; afterSecond: PoolStats };
    dispose: { afterDispose: PoolStats; postDisposeEqualsCpu: boolean; finalStats: PoolStats };
  };
}

const ADOPTED = [
  "transformPoints",
  "jitterPoints",
  "orientAlongVector",
  "surfaceSample",
  "volumeSample",
] as const;

/**
 * Noise-driven parity budgets per node output column, in rangeUlp
 * (error in f32-ULP units at the top of the output's range; see
 * parity.device.test.ts). Measured on the reference adapter (RTX 5090,
 * D3D12, Dawn) over 10 000/8 000 points and rounded up minimally — the
 * GPU-resolved field obeys the perlin-normalized field budget and the
 * node math runs on the CPU in both cooks, so output error stays in the
 * same class; the output range (positions in world units) is larger
 * than the field range, which is why these come out below the field's
 * own budget. A different adapter exceeding one is a finding, not
 * noise. Measured (rangeUlp, raw maxUlp): transformPoints 0.92, 9728;
 * jitterPoints 0.93, 1676; volumeSample 0.50, 2 (maxUlp spikes sit at
 * output zero-crossings, as in the field-level parity suite).
 */
const NOISE_BUDGETS: Record<string, number> = {
  transformPoints: 2,
  jitterPoints: 2,
  volumeSample: 1,
};
/**
 * orientAlongVector: min per-lane |dot(q_cpu, q_gpu)| (1 = identical
 * rotation; |dot| tolerates a sign/branch flip in quatFromBasis).
 * Measured 0.999999933 on the reference adapter.
 */
const MIN_QUAT_DOT = 0.9999999;

function runScenario(): ScenarioOutput {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, "..", "..", "node_modules", ".cache", "pcg-ts-device");
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, `pervasive-${process.pid}.mjs`);
  try {
    buildSync({
      entryPoints: [join(here, "pervasiveScenario.ts")],
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

describe.skipIf(testDevice === null)(deviceSuiteName("pervasive adoption + chunking + pooling"), () => {
  let scenario: ScenarioOutput;
  beforeAll(() => {
    scenario = runScenario();
  }, DEVICE_HOOK_TIMEOUT_MS);

  it("scenario ran to completion", () => {
    expect(scenario.error, scenario.error).toBeUndefined();
    expect(scenario.ok).toBe(true);
  });

  it("every adopted node resolves its field on the device and matches CPU bytes exactly (bit-exact family)", () => {
    for (const name of ADOPTED) {
      const b = scenario.adoption[name].bitExact;
      expect(b.dispatches, `${name}: dispatches`).toBe(1);
      expect(b.fallbacks, `${name}: fallbacks`).toEqual({});
      expect(b.recooked, `${name}: gpu toggle recooks the node`).toBe(1);
      expect(b.equal, `${name}: byte equality vs CPU cook`).toBe(true);
    }
  });

  it("noise-driven params stay within the measured per-node budgets", () => {
    const lines: string[] = [];
    for (const [name, budget] of Object.entries(NOISE_BUDGETS)) {
      const n = scenario.adoption[name].noise!;
      lines.push(`${name}: rangeUlp=${n.rangeUlp!.toFixed(2)} maxUlp=${n.maxUlp} (budget ${budget})`);
      expect(n.dispatches, `${name}: dispatches`).toBe(1);
      expect(n.rangeUlp, `${name}: rangeUlp budget`).toBeLessThanOrEqual(budget);
    }
    const orient = scenario.adoption.orientAlongVector.noise!;
    lines.push(`orientAlongVector: minQuatDot=${orient.minQuatDot}`);
    expect(orient.minQuatDot, "orientAlongVector: rotation closeness").toBeGreaterThanOrEqual(MIN_QUAT_DOT);
    console.log(`[pervasive parity ${testDevice!.label}]\n${lines.join("\n")}`);
  });

  it("surfaceSample under a noise density accepts nearly the same candidate set", () => {
    const s = scenario.adoption.surfaceSampleNoise;
    // Acceptance compares a hash against the density — a knife edge, so
    // lanes whose density differs within the float budget may flip.
    // The sets must agree on all but a handful of 4096 candidates.
    expect(s.dispatches).toBe(1);
    expect(s.symDiff, `accepted-set symmetric difference (cpu ${s.cpuAccepted} vs gpu ${s.gpuAccepted})`).toBeLessThanOrEqual(8);
    expect(Math.abs(s.cpuAccepted - s.gpuAccepted)).toBeLessThanOrEqual(8);
  });

  it("chunked dispatch is byte-identical to unchunked across seam counts", () => {
    for (const [name, seam] of Object.entries(scenario.chunking.seams)) {
      expect(seam.chunkedEqualsUnchunked, `${name}: forced 128-element chunks`).toBe(true);
      expect(seam.flooredEqualsUnchunked, `${name}: non-multiple override floors to the workgroup size`).toBe(true);
      expect(seam.equalsCpu, `${name}: CPU reference`).toBe(true);
    }
  });

  it("a beyond-single-dispatch count resolves on device and matches the CPU exactly", () => {
    const b = scenario.chunking.big;
    expect(b.count).toBe(4_300_000);
    expect(b.length).toBe(4_300_000);
    expect(b.equalsCpu).toBe(true);
    console.log(`[pervasive big-dispatch ${testDevice!.label}] ${b.count} elements in ${b.ms}ms`);
  });

  it("pooled-buffer reuse is observationally invisible across interleaved shapes", () => {
    for (const step of scenario.pooling.steps) {
      expect(step.equalsFresh, `${step.name}: pooled vs fresh-buffer evaluator`).toBe(true);
      expect(step.equalsCpu, `${step.name}: CPU reference`).toBe(true);
    }
    const s = scenario.pooling.stats;
    expect(s.buffersReused, "reuse actually happened").toBeGreaterThanOrEqual(8);
    expect(s.pooledBytes).toBeLessThanOrEqual(256 * 1024 * 1024);
    // maxPooledBytes: 0 retains nothing — the pre-pooling behavior.
    const u = scenario.pooling.unpooledStats;
    expect(u.buffersReused).toBe(0);
    expect(u.pooledBuffers).toBe(0);
    expect(u.buffersDestroyed).toBe(u.buffersCreated);
  });

  it("chunked dispatches pool their per-chunk uniforms and stay byte-stable", () => {
    const c = scenario.pooling.chunked;
    expect(c.equal).toBe(true);
    expect(c.equalsCpu).toBe(true);
    // The second identical resolve reuses the first's buffers (8 chunk
    // uniforms + input/output/readback).
    expect(c.afterSecond.buffersReused - c.afterFirst.buffersReused).toBeGreaterThanOrEqual(11);
    expect(c.afterSecond.buffersCreated).toBe(c.afterFirst.buffersCreated);
  });

  it("dispose() releases pooled memory and leaves the evaluator usable", () => {
    const d = scenario.pooling.dispose;
    expect(d.afterDispose.pooledBuffers).toBe(0);
    expect(d.afterDispose.pooledBytes).toBe(0);
    expect(d.postDisposeEqualsCpu).toBe(true);
    expect(d.finalStats.pooledBuffers).toBeGreaterThan(0); // pool refills after dispose
  });
});
