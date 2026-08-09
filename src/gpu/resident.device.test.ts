/**
 * Real-device suite for phase 23: device-resident (fused) runs. Pushes
 * every apply-kernel variant the codegen can emit through the WGSL front
 * end, then asserts three-way parity (CPU / per-node GPU / fused) over
 * chains of 2-8 fusable nodes, the ported node semantics, run-to-run
 * determinism, chunk-seam byte equality, budget slicing, cancellation
 * without resource leaks, the resident memory bound, and stats /
 * pipeline-cache semantics. Bundles residentScenario.ts with esbuild and
 * executes it in a plain Node child process (see deviceRunner.mjs for
 * why no vitest worker may touch Dawn). Skips visibly without an adapter.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import { deviceSuiteName, testDevice } from "./testDevice.js";

interface AttrCompare {
  name: string;
  type: string;
  tupleSize: number;
  equalCpu: boolean;
  equalPerNode: boolean;
  rangeUlpCpu?: number;
  maxUlpCpu?: number;
  rangeUlpPerNode?: number;
  minQuatDotCpu?: number;
}

interface GpuStats {
  residentRuns: number;
  fusedNodes: number;
  readbacksSaved: number;
  dispatches: number;
  pipelinesCompiled: number;
  pipelineCacheHits: number;
  fallbacks: Record<string, number>;
  cooked: number;
}

interface ChainResult {
  name: string;
  count: number;
  members: number;
  bitExact: boolean;
  namesCpu: string[];
  namesPerNode: string[];
  namesFused: string[];
  stats: GpuStats;
  perNodeStats: GpuStats;
  inputUnmutated: boolean;
  crossChecks: Array<{ pair: string; equal: boolean }>;
  attrs: AttrCompare[];
}

interface ScenarioOutput {
  ok: boolean;
  error?: string;
  salt: string;
  validation: {
    variants: number;
    errors: Array<{ key: string; message: string; lineNum: number; linePos: number }>;
    warnings: number;
    pipelines: number;
    pipelineErrors: string[];
    constVariantsByKind: Record<string, number>;
    maxConstSlots: number;
  };
  chains: ChainResult[];
  semantics: {
    transform: Array<{
      name: string;
      residentRuns: number;
      maxAbsDiff: number;
      cpuP: number[];
      fusedP: number[];
    }>;
    orient: {
      axes: Array<{ axis: string; residentRuns: number; minQuatDot: number; bytesEqual: boolean }>;
      ups: Array<{ up: number[]; residentRuns: number; minQuatDot: number }>;
      intDir: { residentRuns: number; zeroLanes: number; minQuatDot: number };
      zero: Array<{
        withRot: boolean;
        residentRuns: number;
        zeroLanes: number;
        zeroLanesMatchCpu: number;
        zeroLanesMatchPrior: number;
        minQuatDot: number;
      }>;
    };
    jitter: { residentRuns: number; elements: number; mismatches: number };
  };
  determinism: { firstEqualsSecond: boolean; firstEqualsThird: boolean; attrs: string[] };
  chunking: {
    seams: Array<{
      count: number;
      chunk128EqualsUnchunked: boolean;
      chunk64EqualsUnchunked: boolean;
      sameAttrShapes: boolean;
    }>;
    big: {
      count: number;
      ms: number;
      residentRuns: number;
      fallbacks: Record<string, number>;
      equalsCpu: boolean;
    };
  };
  rejections: Array<{
    name: string;
    cpuThrew: boolean;
    fusedThrew: boolean;
    sameMessage: boolean;
    fallbacks: Record<string, number>;
    residentRuns: number;
    equalsCpu: boolean | null;
  }>;
  passthrough: {
    residentRuns: number;
    pointAttrsEqual: boolean;
    names: string[];
    vertexEqual: boolean;
    primitiveEqual: boolean;
    detailEqual: boolean;
    topoEqual: boolean;
    labelsEqual: boolean;
  };
  budget: { residentRuns: number; equalsUnsliced: boolean };
  cancellation: {
    planned: boolean;
    cancelledName: string;
    isCookCancelled: boolean;
    statsAfterAbort: { residentRuns: number; fusedNodes: number; readbacksSaved: number };
    inFlightBefore: number;
    inFlightAfterAbort: number;
    inFlightAfterRecovery: number;
    recoveredEqualsFusedCook: boolean;
    cookCancelledName: string;
    isCookLevelCancelled: boolean;
    postCancelCookEqualsFused: boolean;
  };
  memoryBound: {
    totalBytes: number;
    fitsStats: GpuStats;
    rejectedStats: GpuStats;
    rejectedEqualsPerNode: boolean;
    fitsEqualsRejected: boolean;
  };
  stats: {
    singleStats: GpuStats;
    cacheAfterSingle: number;
    fusedStats: GpuStats;
    cacheAfterFused: number;
    twoRunStats: GpuStats;
    twoRunEqualsCpu: boolean;
  };
  constantEdges: {
    cpuWords: string[];
    uniformWords: string[];
    literalWords: string[];
    uniformEqualsCpu: boolean;
    literalEqualsCpu: boolean;
  };
  constantEdits: {
    firstStats: GpuStats;
    editStats: GpuStats;
    upEditStats: GpuStats;
    cacheAfterFirst: number;
    cacheAfterEdit: number;
    cacheAfterUp: number;
    editChangedP: boolean;
    upEditChangedRot: boolean;
    editMatchesFresh: boolean;
    upEditMatchesFresh: boolean;
  };
}

/**
 * Expected fused-run shape per chain: member count and the number of
 * dispatched member kernels — one apply kernel per member, plus one
 * field kernel per param that is a Field. Since phase 25 a param that
 * is a plain constant costs NO kernel (it rides the apply kernel's
 * uniform), so a member's dispatches are 1 + its Field params: an
 * all-constant transformPoints is 1 where it used to be 4, and the
 * counts below are the post-phase-25 (lower) numbers.
 */
const CHAIN_SHAPE: Record<string, { members: number; dispatches: number }> = {
  hash2: { members: 2, dispatches: 3 },
  hash4: { members: 4, dispatches: 7 },
  retype3: { members: 3, dispatches: 5 },
  float4: { members: 4, dispatches: 8 },
  types5: { members: 6, dispatches: 12 },
  selfRetype5: { members: 5, dispatches: 10 },
  long8: { members: 8, dispatches: 15 },
  seeds3: { members: 3, dispatches: 6 },
  orientSeed2: { members: 2, dispatches: 4 },
  exactTransform3: { members: 3, dispatches: 6 },
  rotOnly2: { members: 2, dispatches: 2 },
  scaleOnly2: { members: 2, dispatches: 2 },
  aliasTranslate2: { members: 2, dispatches: 4 },
  replaceP2: { members: 2, dispatches: 3 },
  epochP3: { members: 3, dispatches: 4 },
  badRot2: { members: 2, dispatches: 4 },
  orientThenTransform2: { members: 2, dispatches: 3 },
  const3: { members: 3, dispatches: 5 },
  remapConst5: { members: 5, dispatches: 7 },
  constStores4: { members: 4, dispatches: 4 },
  constDir2: { members: 2, dispatches: 3 },
};

/**
 * Float-carrying chains: measured parity vs the CPU reference on the
 * reference adapter (RTX 5090, D3D12, Dawn), rounded up minimally. The
 * budget applies to every non-quaternion f32 attribute in rangeUlp
 * (error in f32-ULP units at the top of the attribute's range — see
 * parity.device.test.ts); `rot` columns are judged by the minimum
 * per-lane |dot(q_cpu, q_gpu)| instead, which tolerates the sign and
 * branch flips quatFromBasis can take at knife-edge traces. Composed
 * budgets: these chains stack a GPU-resolved noise field, an f32
 * quaternion construction, and an f32 multiply-add chain where the CPU
 * keeps an f64 interior throughout. Measured (rangeUlp / minQuatDot):
 * float4 P 4.83, d 4.27, rot 0.99999957; const3 P 1.69, h 1.71, rot
 * 0.99999986; badRot2 rot 0.99999990; orientThenTransform2 P 1.33, rot
 * 0.99999980; constDir2 rot 0.99999997. A different adapter exceeding
 * one is a finding, not noise.
 *
 * Phase 25 moved constant params (and orientAlongVector's up hint) from
 * device columns into the kernel uniform: every one of these measured
 * values is unchanged to full printed precision, which is what "no
 * output byte moved" looks like for the chains that carry float slack.
 */
const CHAIN_BUDGETS: Record<string, number> = {
  float4: 6,
  orientSeed2: 3,
  const3: 3,
  badRot2: 3,
  orientThenTransform2: 3,
  constDir2: 3,
};

/** Minimum per-lane |dot| between the CPU and fused rot quaternions. */
const MIN_QUAT_DOT = 0.9999995;

function runScenario(): ScenarioOutput {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, "..", "..", "node_modules", ".cache", "pcg-ts-device");
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, `resident-${process.pid}.mjs`);
  try {
    buildSync({
      entryPoints: [join(here, "residentScenario.ts")],
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

const chainOf = (s: ScenarioOutput, name: string): ChainResult => {
  const c = s.chains.find((x) => x.name === name);
  if (c === undefined) throw new Error(`scenario reported no chain named "${name}"`);
  return c;
};

/** Every point on `actual` within `eps` of `expected` (analytic checks). */
function closeTo(actual: readonly number[], expected: readonly number[], eps: number): string | null {
  if (actual.length !== expected.length) return `length ${actual.length} !== ${expected.length}`;
  for (let i = 0; i < actual.length; i++) {
    if (Math.abs(actual[i] - expected[i]) > eps) {
      return `component ${i}: ${actual[i]} vs expected ${expected[i]}`;
    }
  }
  return null;
}

describe.skipIf(testDevice === null)(deviceSuiteName("device-resident runs"), () => {
  let scenario: ScenarioOutput;
  beforeAll(() => {
    scenario = runScenario();
  });

  it("scenario ran to completion", () => {
    expect(scenario.error, scenario.error).toBeUndefined();
    expect(scenario.ok).toBe(true);
  });

  it("every apply-kernel variant compiles and builds a pipeline with zero error diagnostics", () => {
    const v = scenario.validation;
    expect(
      v.errors,
      v.errors.map((e) => `${e.key} @${e.lineNum}:${e.linePos} ${e.message}`).join("\n"),
    ).toEqual([]);
    expect(v.pipelineErrors, v.pipelineErrors.join("\n")).toEqual([]);
    // All four kinds x every column/constant/attribute shape they
    // support, including the binding remaps constant params cause.
    expect(v.variants).toBeGreaterThanOrEqual(300);
    expect(v.pipelines).toBe(v.variants);
    // Every kind compiles with uniform constants, up to the three slots
    // an all-constant transformPoints takes.
    for (const kind of ["setAttribute", "transformPoints", "jitterPoints", "orientAlongVector"]) {
      expect(v.constVariantsByKind[kind], `${kind}: constant-carrying variants`).toBeGreaterThan(0);
    }
    expect(v.maxConstSlots).toBe(3);
  });

  it("every chain fuses into exactly one run with the expected member kernels", () => {
    for (const c of scenario.chains) {
      const shape = CHAIN_SHAPE[c.name];
      expect(shape, `${c.name}: no expected shape pinned`).toBeDefined();
      expect(c.members, `${c.name}: members`).toBe(shape.members);
      expect(c.stats.residentRuns, `${c.name}: residentRuns`).toBe(1);
      expect(c.stats.fusedNodes, `${c.name}: fusedNodes`).toBe(shape.members);
      expect(c.stats.readbacksSaved, `${c.name}: readbacksSaved`).toBe(shape.members - 1);
      expect(c.stats.dispatches, `${c.name}: member kernels dispatched`).toBe(shape.dispatches);
      expect(c.stats.fallbacks, `${c.name}: fallbacks`).toEqual({});
      // The per-node leg refuses to fuse and cooks each member itself.
      expect(c.perNodeStats.residentRuns, `${c.name}: per-node leg must not fuse`).toBe(0);
      expect(c.perNodeStats.fallbacks["run-plan-failed"], `${c.name}: per-node leg`).toBe(1);
      expect(c.stats.cooked, `${c.name}: cooked`).toBe(shape.members + 1);
    }
  });

  it("fused output is structurally indistinguishable from the per-node cook", () => {
    for (const c of scenario.chains) {
      // Same attribute set, same insertion order, same shapes — the
      // layout-op replay (incl. mid-run retype and rot re-creation).
      expect(c.namesFused, `${c.name}: attribute order vs CPU`).toEqual(c.namesCpu);
      expect(c.namesFused, `${c.name}: attribute order vs per-node GPU`).toEqual(c.namesPerNode);
      expect(c.inputUnmutated, `${c.name}: the run must not mutate its input geometry`).toBe(true);
      for (const check of c.crossChecks) {
        expect(check.equal, `${c.name}: ${check.pair}`).toBe(true);
      }
    }
  });

  it("hash-only chains are BIT-EXACT vs the CPU cook, attribute for attribute", () => {
    const exact = scenario.chains.filter((c) => c.bitExact);
    // The phase-25 acceptance bar: every chain that was bit-exact before
    // constants moved into the uniform is still bit-exact, byte for
    // byte, plus `remapConst5` (constant-heavy binding remaps) and
    // `constStores4` (a constant stored into every target type).
    expect(exact.length).toBeGreaterThanOrEqual(15);
    for (const c of exact) {
      for (const a of c.attrs) {
        expect(a.equalCpu, `${c.name}.${a.name} (${a.type}x${a.tupleSize}) vs CPU bytes`).toBe(true);
        expect(a.equalPerNode, `${c.name}.${a.name} vs per-node GPU bytes`).toBe(true);
      }
    }
  });

  it("float-carrying chains stay inside the composed parity budgets", () => {
    const lines: string[] = [];
    for (const c of scenario.chains.filter((x) => !x.bitExact)) {
      const budget = CHAIN_BUDGETS[c.name];
      expect(budget, `${c.name}: no budget pinned`).toBeDefined();
      for (const a of c.attrs) {
        if (a.name === "rot") {
          lines.push(`${c.name}.rot: minQuatDot=${a.minQuatDotCpu}`);
          expect(a.minQuatDotCpu, `${c.name}.rot: rotation closeness vs CPU`).toBeGreaterThanOrEqual(
            MIN_QUAT_DOT,
          );
          continue;
        }
        if (a.type !== "f32") {
          // Integer/bool attributes never carry float slack.
          expect(a.equalCpu, `${c.name}.${a.name} (${a.type}) vs CPU bytes`).toBe(true);
          continue;
        }
        if (a.equalCpu) continue;
        lines.push(`${c.name}.${a.name}: rangeUlp=${a.rangeUlpCpu!.toFixed(2)} maxUlp=${a.maxUlpCpu} (budget ${budget})`);
        expect(a.rangeUlpCpu, `${c.name}.${a.name}: rangeUlp vs CPU`).toBeLessThanOrEqual(budget);
      }
    }
    console.log(`[resident parity ${testDevice!.label}]\n${lines.join("\n")}`);
  });

  it("transformPoints applies scale before rotation and composes euler extrinsically", () => {
    const byName = new Map(scenario.semantics.transform.map((t) => [t.name, t]));
    for (const t of scenario.semantics.transform) {
      expect(t.residentRuns, `${t.name}: fused`).toBe(1);
      expect(t.maxAbsDiff, `${t.name}: max |fused - cpu|`).toBeLessThanOrEqual(1e-5);
    }
    // Analytic: P' = Rz(90) * ([2,1,0.5] * P) over the six unit axes.
    expect(
      closeTo(
        byName.get("zRot90")!.fusedP,
        [0, 2, 0, -1, 0, 0, 0, 0, 0.5, 0, -2, 0, 1, 0, 0, 0, 0, -0.5],
        1e-5,
      ),
      "zRot90",
    ).toBeNull();
    // Analytic: P' = Ry(90) * P + [1, -2, 3].
    expect(
      closeTo(
        byName.get("yRot90")!.fusedP,
        [1, -2, 2, 1, -1, 3, 2, -2, 3, 1, -2, 4, 1, -3, 3, 0, -2, 3],
        1e-5,
      ),
      "yRot90",
    ).toBeNull();
  });

  it("orientAlongVector reproduces the CPU rotation for every axis and up hint", () => {
    for (const a of scenario.semantics.orient.axes) {
      expect(a.residentRuns, `${a.axis}: fused`).toBe(1);
      expect(a.minQuatDot, `axis ${a.axis}: |dot(q_cpu, q_gpu)|`).toBeGreaterThanOrEqual(MIN_QUAT_DOT);
    }
    for (const u of scenario.semantics.orient.ups) {
      expect(u.minQuatDot, `up ${JSON.stringify(u.up)}: |dot|`).toBeGreaterThanOrEqual(MIN_QUAT_DOT);
    }
    // An i32 direction column, broadcast — and some lanes exactly zero.
    const int = scenario.semantics.orient.intDir;
    expect(int.residentRuns).toBe(1);
    expect(int.zeroLanes, "integer direction column: zero-direction lanes present").toBeGreaterThan(0);
    expect(int.minQuatDot).toBeGreaterThanOrEqual(MIN_QUAT_DOT);
  });

  it("orientAlongVector leaves zero-length-direction points on their prior rot", () => {
    for (const z of scenario.semantics.orient.zero) {
      expect(z.residentRuns, `withRot=${z.withRot}: fused`).toBe(1);
      expect(z.zeroLanes, `withRot=${z.withRot}: zero lanes`).toBe(128);
      // Byte-for-byte: skipped lanes are pure passthrough, so no float
      // slack is admissible here.
      expect(z.zeroLanesMatchCpu, `withRot=${z.withRot}: zero lanes vs CPU`).toBe(z.zeroLanes);
      expect(
        z.zeroLanesMatchPrior,
        `withRot=${z.withRot}: zero lanes keep the prior rot (identity when freshly created)`,
      ).toBe(z.zeroLanes);
      expect(z.minQuatDot).toBeGreaterThanOrEqual(MIN_QUAT_DOT);
    }
  });

  it("jitterPoints reproduces hashFloat(hashCombine(seed, i, k)) per axis exactly", () => {
    const j = scenario.semantics.jitter;
    expect(j.residentRuns).toBe(1);
    expect(j.elements).toBeGreaterThan(2000);
    expect(j.mismatches, "offsets recomputed from the documented hash chain").toBe(0);
  });

  it("the same fused run is byte-identical across repeats", () => {
    const d = scenario.determinism;
    expect(d.attrs.length).toBeGreaterThanOrEqual(9);
    expect(d.firstEqualsSecond).toBe(true);
    expect(d.firstEqualsThird).toBe(true);
  });

  it("chunked fused runs are byte-identical to unchunked ones across seam counts", () => {
    expect(scenario.chunking.seams.length).toBeGreaterThanOrEqual(11);
    for (const s of scenario.chunking.seams) {
      expect(s.chunk128EqualsUnchunked, `count ${s.count}: forced 128-element chunks`).toBe(true);
      expect(s.chunk64EqualsUnchunked, `count ${s.count}: non-multiple override floors to 64`).toBe(true);
      expect(s.sameAttrShapes, `count ${s.count}: attribute shapes`).toBe(true);
    }
  });

  it("a fused run past the single-dispatch limit chunks naturally and matches the CPU exactly", () => {
    const b = scenario.chunking.big;
    expect(b.count).toBe(4_300_000); // > 65535 * 64 = 4,194,240
    expect(b.residentRuns).toBe(1);
    expect(b.fallbacks).toEqual({});
    expect(b.equalsCpu, "bit-exact family at 4.3M points").toBe(true);
    console.log(`[resident big-run ${testDevice!.label}] ${b.count} points fused in ${b.ms}ms`);
  });

  it("runs the planner cannot model fall back to the per-node path, error for error", () => {
    const byName = new Map(scenario.rejections.map((r) => [r.name, r]));
    expect([...byName.keys()].sort()).toEqual(["stringAttrField", "tooManyBuffers", "tupleMismatch"]);
    // Invalid params: the fused cook must surface the CPU error verbatim.
    for (const name of ["tupleMismatch", "stringAttrField"]) {
      const r = byName.get(name)!;
      expect(r.cpuThrew, `${name}: CPU-only cook throws`).toBe(true);
      expect(r.fusedThrew, `${name}: fused cook throws`).toBe(true);
      expect(r.sameMessage, `${name}: identical error message`).toBe(true);
    }
    // A kernel over the storage-buffer limit: the run is rejected and
    // the per-node path serves the CPU bytes.
    const many = byName.get("tooManyBuffers")!;
    expect(many.cpuThrew).toBe(false);
    expect(many.fusedThrew).toBe(false);
    expect(many.residentRuns).toBe(0);
    expect(many.fallbacks).toEqual({ "run-plan-failed": 1, "too-many-buffers": 1 });
    expect(many.equalsCpu, "per-node fallback bytes").toBe(true);
  });

  it("a fused run carries topology, other domains, string tables and wide tuples through", () => {
    const p = scenario.passthrough;
    expect(p.residentRuns).toBe(1);
    expect(p.names).toEqual(["P", "wide", "label", "density", "d"]);
    expect(p.pointAttrsEqual, "point attributes (incl. f32x5 and string indices)").toBe(true);
    expect(p.vertexEqual).toBe(true);
    expect(p.primitiveEqual).toBe(true);
    expect(p.detailEqual).toBe(true);
    expect(p.topoEqual).toBe(true);
    expect(p.labelsEqual, "string table entries").toBe(true);
  });

  it("budget slicing between member kernels does not move a byte", () => {
    expect(scenario.budget.residentRuns).toBe(1);
    expect(scenario.budget.equalsUnsliced).toBe(true);
  });

  it("cancelling mid-run raises the standard error, leaks nothing, and leaves the evaluator usable", () => {
    const c = scenario.cancellation;
    expect(c.planned).toBe(true);
    expect(c.cancelledName).toBe("CookCancelledError");
    expect(c.isCookCancelled).toBe(true);
    // A cancelled run counts no resident-run work.
    expect(c.statsAfterAbort).toEqual({ residentRuns: 0, fusedNodes: 0, readbacksSaved: 0 });
    // Every acquired buffer went back to the pool (never left mapped).
    expect(c.inFlightBefore).toBe(0);
    expect(c.inFlightAfterAbort, "buffers still checked out after the abort").toBe(0);
    expect(c.inFlightAfterRecovery).toBe(0);
    expect(c.recoveredEqualsFusedCook, "the same plan re-executes correctly").toBe(true);
    // And through a cook: aborting during the run's readback.
    expect(c.cookCancelledName).toBe("CookCancelledError");
    expect(c.isCookLevelCancelled).toBe(true);
    expect(c.postCancelCookEqualsFused, "the next cook still produces the fused bytes").toBe(true);
  });

  it("a run over the resident memory bound falls back to the per-node path", () => {
    const m = scenario.memoryBound;
    expect(m.totalBytes).toBeGreaterThan(0);
    // Exactly at the bound the run still fuses...
    expect(m.fitsStats.residentRuns).toBe(1);
    expect(m.fitsStats.fallbacks).toEqual({});
    // ...one byte under it, the plan is rejected and per-node serves.
    expect(m.rejectedStats.residentRuns).toBe(0);
    expect(m.rejectedStats.fallbacks).toEqual({ "run-too-large": 1 });
    expect(m.rejectedEqualsPerNode, "rejected run yields the per-node bytes").toBe(true);
  });

  it("resident-run counters and the shared pipeline cache behave as documented", () => {
    const s = scenario.stats;
    // A single fusable node never becomes a run.
    expect(s.singleStats.residentRuns).toBe(0);
    expect(s.singleStats.dispatches).toBe(1);
    expect(s.cacheAfterSingle).toBe(1);
    // The fused run reuses the pipeline that per-node cook compiled.
    expect(s.fusedStats.residentRuns).toBe(1);
    expect(s.fusedStats.pipelineCacheHits, "shared pipeline cache hit").toBeGreaterThanOrEqual(1);
    expect(s.cacheAfterFused).toBe(s.cacheAfterSingle + s.fusedStats.pipelinesCompiled);
    // Two runs split by a non-fusable node in one cook.
    expect(s.twoRunStats.residentRuns).toBe(2);
    expect(s.twoRunStats.fusedNodes).toBe(4);
    expect(s.twoRunStats.readbacksSaved).toBe(2);
    expect(s.twoRunStats.cooked).toBe(6);
    expect(s.twoRunEqualsCpu, "both runs match the CPU cook byte-for-byte").toBe(true);
  });

  it("carries -0 and subnormal constants that a baked literal loses", () => {
    // The one class where phase 25 moved bytes — onto the CPU reference,
    // not away from it. A `-0`/subnormal f32 LITERAL is flushed to `+0`
    // by (at least) the D3D12 back end, so the constant column a run used
    // to materialize carried `+0`; a uniform load is not a literal and
    // keeps the bits. The contract asserted here is the CPU one.
    const e = scenario.constantEdges;
    expect(e.uniformWords, "uniform constants vs the CPU bit pattern").toEqual(e.cpuWords);
    expect(e.uniformEqualsCpu, "the whole fused output matches the CPU").toBe(true);
    console.log(
      `[constant edges ${testDevice!.label}] cpu=${e.cpuWords.join(" ")} ` +
        `uniform=${e.uniformWords.join(" ")} bakedLiteral=${e.literalWords.join(" ")} ` +
        `(literal path matches CPU: ${e.literalEqualsCpu})`,
    );
  });

  it("editing a constant param rebinds a uniform and NEVER recompiles a pipeline", () => {
    const c = scenario.constantEdits;
    // The first cook compiles the run's kernels...
    expect(c.firstStats.residentRuns).toBe(1);
    expect(c.firstStats.pipelinesCompiled).toBe(c.firstStats.dispatches);
    // ...and an edited constant re-executes the whole run with zero
    // compiles: every kernel is a pipeline-cache hit, because the apply
    // key encodes which params are constant, never their values.
    expect(c.editStats.residentRuns).toBe(1);
    expect(c.editStats.pipelinesCompiled, "a constant edit must not compile").toBe(0);
    expect(c.editStats.pipelineCacheHits).toBe(c.editStats.dispatches);
    expect(c.cacheAfterEdit).toBe(c.cacheAfterFirst);
    // Same for orientAlongVector's up hint, a baked WGSL literal before
    // phase 25 and a uniform slot since.
    expect(c.upEditStats.residentRuns).toBe(1);
    expect(c.upEditStats.pipelinesCompiled, "an up-hint edit must not compile").toBe(0);
    expect(c.upEditStats.pipelineCacheHits).toBe(c.upEditStats.dispatches);
    expect(c.cacheAfterUp).toBe(c.cacheAfterFirst);
    // The rebound uniforms carry the NEW values: the output changes, to
    // exactly the bytes a graph built with those values produces.
    expect(c.editChangedP, "the edited constant must change the output").toBe(true);
    expect(c.upEditChangedRot, "the edited up hint must change the output").toBe(true);
    expect(c.editMatchesFresh, "edited run bytes vs a fresh build of the same params").toBe(true);
    expect(c.upEditMatchesFresh, "up-edited run bytes vs a fresh build").toBe(true);
  });
});
