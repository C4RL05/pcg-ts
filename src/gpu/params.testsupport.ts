/**
 * Real-device scenario for `{"fn":"param"}`: the claim that a named
 * value lowered to a UNIFORM SLOT produces the bytes the CPU produces
 * for the literal it stands for, on both device paths, without the
 * pipeline cache noticing the value.
 *
 * Three things are measured here and nowhere else:
 *
 * 1. **Parity, per field.** Every case is bit-exact rather than
 *    budgeted: a param contributes a value, never an operation, so it
 *    cannot introduce rounding of its own. `-0` and a subnormal are in
 *    the table on purpose — a WGSL front end may flush those as a
 *    LITERAL (the D3D12 back end does) but never as a uniform load, so
 *    they are exactly where a slot beats a baked constant.
 * 2. **Parity, fused.** A `param` inside a field param of a resident-run
 *    member rides `step.consts` through the run executor, which was
 *    written for apply-kernel constants and never exercised by a field
 *    kernel before. Same bytes as the CPU cook, or the plumbing is wrong.
 * 3. **Cache stability.** Fifty values through one field expression must
 *    leave one kernel and one pipeline behind. `field.key` carries the
 *    value (the CPU memo contract), so a cache keyed on it would grow
 *    once per value — and both caches are unbounded Maps.
 *
 * Test-only: bundled by params.device.test.ts with esbuild and executed
 * in a plain Node child process (see deviceRunner.mjs for why no vitest
 * worker may touch Dawn), reporting observations as JSON on stdout.
 */
import { create } from "webgpu";
import { type Column, createGpuCookStats, evaluateField } from "../fields/index.js";
import { type CookResult, Graph, cook, makeGeometryItem } from "../graph/index.js";
import { fieldFromJson, type FieldSpec } from "../nodes/fieldJson.js";
import { setAttribute } from "../nodes/index.js";
import { dataInput } from "../runtime/dataInput.js";
import type { GpuDeviceLike } from "./device.js";
import { GpuFieldEvaluator } from "./evaluator.js";
import { makeCorpusGeometry } from "./testGeometry.js";

interface Bindings {
  readonly [name: string]: number | readonly number[];
}

interface ParityCase {
  readonly name: string;
  readonly spec: FieldSpec;
  readonly bindings: Bindings;
  /**
   * The same expression with the value written as a LITERAL. Comparing
   * the two GPU columns isolates the claim this suite is about — a slot
   * carries the bits a literal would — from the rounding of whatever ops
   * surround it, which is measured by the parity suite and budgeted
   * there. Omitted for the two values a literal cannot faithfully carry.
   */
  readonly literal?: FieldSpec;
  /**
   * Whether the surrounding ops are bit-exact against the CPU (+ − × and
   * plain copies are, by double-rounding innocuousness; division and the
   * noise interior are not — see the compile.ts module doc). Where they
   * are not, this scenario measures a relative bound instead and leaves
   * the ULP budgets to the parity suite.
   */
  readonly cpuExact: boolean;
}

const COUNT = 4096;
const SEED = 11;

const CASES: ParityCase[] = [
  {
    name: "scalar param scaling an attribute",
    spec: { fn: "mul", args: [{ fn: "attribute", name: "density" }, { fn: "param", name: "amp" }] },
    literal: { fn: "mul", args: [{ fn: "attribute", name: "density" }, 0.375] },
    bindings: { amp: 0.375 },
    cpuExact: true,
  },
  {
    name: "vec3 param offsetting position",
    spec: { fn: "add", args: [{ fn: "position" }, { fn: "param", name: "off" }] },
    literal: { fn: "add", args: [{ fn: "position" }, [1, -2, 0.5]] },
    bindings: { off: [1, -2, 0.5] },
    cpuExact: true,
  },
  {
    name: "two names in one expression",
    spec: {
      fn: "remap",
      args: [{ fn: "attribute", name: "density" }, 0, 1, { fn: "param", name: "lo" }, { fn: "param", name: "hi" }],
    },
    literal: { fn: "remap", args: [{ fn: "attribute", name: "density" }, 0, 1, -3, 7] },
    bindings: { lo: -3, hi: 7 },
    cpuExact: false, // remap divides
  },
  {
    name: "one name read twice shares its slot",
    spec: {
      fn: "add",
      args: [{ fn: "param", name: "a" }, { fn: "mul", args: [{ fn: "param", name: "a" }, 2] }],
    },
    literal: { fn: "add", args: [1.5, { fn: "mul", args: [1.5, 2] }] },
    bindings: { a: 1.5 },
    cpuExact: true,
  },
  {
    name: "param inside opts.position",
    spec: {
      fn: "perlinNoise",
      opts: { position: { fn: "mul", args: [{ fn: "position" }, { fn: "param", name: "freq" }] } },
    },
    literal: {
      fn: "perlinNoise",
      opts: { position: { fn: "mul", args: [{ fn: "position" }, 0.25] } },
    },
    bindings: { freq: 0.25 },
    cpuExact: false, // the noise interior rounds in f32
  },
  {
    name: "param alone at the root",
    spec: { fn: "param", name: "v" },
    literal: { fn: "constant", value: 2.5 },
    bindings: { v: 2.5 },
    cpuExact: true,
  },
  // The two values a baked literal does NOT carry faithfully: a WGSL
  // front end may flush a `-0` or subnormal literal to `+0` (the D3D12
  // back end does) and never a uniform load. No `literal` twin, because
  // the point is that the twin would be a different number.
  { name: "negative zero", spec: { fn: "param", name: "z" }, bindings: { z: -0 }, cpuExact: true },
  { name: "subnormal", spec: { fn: "param", name: "s" }, bindings: { s: 1e-45 }, cpuExact: true },
];

function bytesOf(col: Column): Uint8Array {
  return new Uint8Array(col.data.buffer, col.data.byteOffset, col.data.byteLength);
}

/** Byte-for-byte column equality, element type and tuple size included. */
function bytesEqual(a: Column, b: Column): boolean {
  if (a.tupleSize !== b.tupleSize) return false;
  if (a.data.constructor !== b.data.constructor) return false;
  const ab = bytesOf(a);
  const bb = bytesOf(b);
  if (ab.length !== bb.length) return false;
  for (let i = 0; i < ab.length; i++) if (ab[i] !== bb[i]) return false;
  return true;
}

/**
 * Largest per-lane error relative to the column's own magnitude — the
 * coarse "did the value arrive at all" check for the families whose
 * surrounding ops round. The ULP budgets are the parity suite's job; a
 * slot that carried the wrong bits would be off by orders of magnitude,
 * not by ULPs.
 */
function maxRelDiff(cpu: Column, gpu: Column): number {
  if (cpu.data.length !== gpu.data.length) return Number.POSITIVE_INFINITY;
  let scale = 0;
  for (let i = 0; i < cpu.data.length; i++) {
    const a = Math.abs(cpu.data[i]);
    if (a > scale && Number.isFinite(a)) scale = a;
  }
  if (scale === 0) scale = 1;
  let worst = 0;
  for (let i = 0; i < cpu.data.length; i++) {
    const d = Math.abs(cpu.data[i] - gpu.data[i]) / scale;
    if (d > worst) worst = d;
  }
  return worst;
}

function attrBytesEqual(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  const ab = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const bb = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < ab.length; i++) if (ab[i] !== bb[i]) return false;
  return true;
}

async function main(): Promise<void> {
  const gpu = create([]);
  const adapter = await gpu.requestAdapter();
  if (adapter === null) {
    process.stdout.write(JSON.stringify({ ok: false, error: "no WebGPU adapter" }));
    return;
  }
  const device = (await adapter.requestDevice()) as unknown as GpuDeviceLike;
  const ev = new GpuFieldEvaluator(device);

  const geo = makeCorpusGeometry(COUNT);
  const ctx = { geo, domain: "point" as const, seed: SEED };

  // -- 1. per-field parity -------------------------------------------------
  const parity: Array<{
    name: string;
    resolved: boolean;
    bitExact: boolean;
    cpuExact: boolean;
    maxRelDiff: number;
    literalCompared: boolean;
    equalsLiteral: boolean;
    params: number;
  }> = [];
  for (const c of CASES) {
    const field = fieldFromJson(c.spec, c.bindings);
    const promise = ev.resolveField(field, ctx);
    if (promise === null) {
      parity.push({
        name: c.name,
        resolved: false,
        bitExact: false,
        cpuExact: c.cpuExact,
        maxRelDiff: Number.POSITIVE_INFINITY,
        literalCompared: false,
        equalsLiteral: false,
        params: 0,
      });
      continue;
    }
    const gpuColumn = await promise;
    const cpuColumn = evaluateField(field, ctx);
    let equalsLiteral = true;
    if (c.literal !== undefined) {
      const literalPromise = ev.resolveField(fieldFromJson(c.literal), ctx);
      equalsLiteral = literalPromise !== null && bytesEqual(await literalPromise, gpuColumn);
    }
    parity.push({
      name: c.name,
      resolved: true,
      bitExact: bytesEqual(cpuColumn, gpuColumn),
      cpuExact: c.cpuExact,
      maxRelDiff: maxRelDiff(cpuColumn, gpuColumn),
      literalCompared: c.literal !== undefined,
      equalsLiteral,
      // Reported so a case that silently stopped carrying a param (a
      // rewritten spec, say) cannot pass by measuring nothing.
      params: Object.keys(c.bindings).length,
    });
  }

  // -- 2. cache stability across values ------------------------------------
  const cacheEv = new GpuFieldEvaluator(device);
  const sweepSpec: FieldSpec = {
    fn: "mul",
    args: [{ fn: "attribute", name: "density" }, { fn: "param", name: "amp" }],
  };
  const sweepStats = createGpuCookStats();
  const fieldKeys = new Set<string>();
  let sweepBitExact = true;
  for (let i = 0; i < 50; i++) {
    const value = i * 0.017;
    const field = fieldFromJson(sweepSpec, { amp: value });
    fieldKeys.add(field.key);
    const promise = cacheEv.resolveField(field, ctx, sweepStats);
    if (promise === null) {
      sweepBitExact = false;
      break;
    }
    if (!bytesEqual(evaluateField(field, ctx), await promise)) sweepBitExact = false;
  }
  const sweep = {
    distinctFieldKeys: fieldKeys.size,
    bitExact: sweepBitExact,
    kernelCacheSize: cacheEv.kernelCacheSize,
    pipelineCacheSize: cacheEv.pipelineCacheSize,
    pipelinesCompiled: sweepStats.pipelinesCompiled,
    pipelineCacheHits: sweepStats.pipelineCacheHits,
    dispatches: sweepStats.dispatches,
    fallbacks: sweepStats.fallbacks,
  };

  // -- 3. fused-run parity -------------------------------------------------
  // Two setAttribute members so the chain is a run rather than a lone
  // node, each with a param-carrying field value: the first also reads an
  // attribute (a field kernel with a storage input AND a const slot), the
  // second is the param alone (const slot, no input at all).
  const fusedGraph = (target: number): Graph => {
    const g = new Graph(5);
    const din = g.add(dataInput);
    g.setParam(din, "items", [makeGeometryItem(makeCorpusGeometry(COUNT))]);
    const a = g.add(setAttribute, {
      name: "scaled",
      value: fieldFromJson(
        { fn: "mul", args: [{ fn: "attribute", name: "density" }, { fn: "param", name: "amp" }] },
        { amp: target },
      ),
    });
    const b = g.add(setAttribute, {
      name: "flat",
      value: fieldFromJson({ fn: "param", name: "amp" }, { amp: target }),
    });
    g.connect(din, "out", a, "in");
    g.connect(a, "out", b, "in");
    g.output(b, "out", "out");
    return g;
  };
  const readAttrs = (result: CookResult): Record<string, Float32Array> => {
    const item = result.outputs.out[0];
    if (item.kind !== "geometry") throw new Error("params scenario: expected a geometry item");
    const set = item.geo.attrs.point;
    return {
      scaled: (set.require("scaled").data as Float32Array).slice(0, COUNT),
      flat: (set.require("flat").data as Float32Array).slice(0, COUNT),
    };
  };
  const gpuCook = await cook(fusedGraph(0.375), { gpu: ev });
  const fusedStats = gpuCook.stats.gpu ?? createGpuCookStats();
  const cpuRun = readAttrs(await cook(fusedGraph(0.375)));
  const gpuRun = readAttrs(gpuCook);
  // A second value through the same expression: the run must recook
  // (the field key moved) and must still match the CPU.
  const cpuRun2 = readAttrs(await cook(fusedGraph(-1.25)));
  const gpuRun2 = readAttrs(await cook(fusedGraph(-1.25), { gpu: ev }));

  const fused = {
    residentRuns: fusedStats.residentRuns,
    fusedNodes: fusedStats.fusedNodes,
    fallbacks: fusedStats.fallbacks,
    scaledBitExact: attrBytesEqual(cpuRun.scaled, gpuRun.scaled),
    flatBitExact: attrBytesEqual(cpuRun.flat, gpuRun.flat),
    rebindScaledBitExact: attrBytesEqual(cpuRun2.scaled, gpuRun2.scaled),
    rebindFlatBitExact: attrBytesEqual(cpuRun2.flat, gpuRun2.flat),
    // The premise of the rebind check: the two values really do differ.
    rebindChangedBytes: !attrBytesEqual(gpuRun.scaled, gpuRun2.scaled),
  };

  // -- 3b. chunked dispatch ------------------------------------------------
  // The slot values are chunk-invariant and written once, while
  // `chunkOffset` is rewritten per chunk through a view over the SAME
  // uniform bytes. That interleaving is the one thing this change added
  // to the dispatch loop, so it is worth forcing a seam over.
  const chunkedEv = new GpuFieldEvaluator(device, { maxElementsPerDispatch: 128 });
  const chunkedField = fieldFromJson(
    { fn: "add", args: [{ fn: "position" }, { fn: "param", name: "off" }] },
    { off: [1, -2, 0.5] },
  );
  const chunkedPromise = chunkedEv.resolveField(chunkedField, ctx);
  const chunked = {
    resolved: chunkedPromise !== null,
    bitExact:
      chunkedPromise !== null && bytesEqual(evaluateField(chunkedField, ctx), await chunkedPromise),
  };

  // -- 4. an unbound param never reaches the device ------------------------
  const unboundStats = createGpuCookStats();
  const unbound = ev.resolveField(fieldFromJson(sweepSpec), ctx, unboundStats);
  let unboundCpuThrew = false;
  try {
    evaluateField(fieldFromJson(sweepSpec), ctx);
  } catch {
    unboundCpuThrew = true;
  }

  process.stdout.write(
    JSON.stringify({
      ok: true,
      parity,
      sweep,
      fused,
      chunked,
      unbound: {
        declined: unbound === null,
        fallbacks: unboundStats.fallbacks,
        cpuThrew: unboundCpuThrew,
      },
    }),
  );
}

main().catch((err: unknown) => {
  process.stdout.write(
    JSON.stringify({ ok: false, error: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) }),
  );
});
