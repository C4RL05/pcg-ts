/**
 * Real-device scenario for phase 22: pervasive node adoption
 * (transformPoints, jitterPoints, orientAlongVector, surfaceSample,
 * volumeSample), chunked dispatch, and buffer pooling. Test-only:
 * bundled by pervasive.device.test.ts (esbuild) and executed in a plain
 * Node child process — Dawn is unstable inside vitest workers (see
 * deviceRunner.mjs) — reporting JSON observations on stdout for the
 * vitest side to assert.
 */
import { create } from "webgpu";
import { Geometry, createTriangleMesh } from "../data/index.js";
import { evaluateField, type Column, type EvalContext, type Field } from "../fields/index.js";
import { Graph, cook, makeGeometryItem, type CookResult, type NodeDef } from "../graph/index.js";
import { fieldFromJson, type FieldSpec } from "../fields/fieldJson.js";
import {
  jitterPoints,
  orientAlongVector,
  surfaceSample,
  transformPoints,
  volumeSample,
} from "../nodes/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import { dataInput } from "../runtime/dataInput.js";
import type { GpuDeviceLike } from "./device.js";
import { GpuFieldEvaluator } from "./evaluator.js";
import { makeCorpusGeometry } from "./testGeometry.js";

// ---------------------------------------------------------------------------
// helpers

function bytesEqual(a: Column, b: Column): boolean {
  if (a.tupleSize !== b.tupleSize) return false;
  if (a.data.constructor !== b.data.constructor) return false;
  const ab = new Uint8Array(a.data.buffer, a.data.byteOffset, a.data.byteLength);
  const bb = new Uint8Array(b.data.buffer, b.data.byteOffset, b.data.byteLength);
  if (ab.length !== bb.length) return false;
  for (let i = 0; i < ab.length; i++) if (ab[i] !== bb[i]) return false;
  return true;
}

function attrColumn(result: CookResult, name: string): Column {
  const item = result.outputs.out[0];
  if (item.kind !== "geometry") throw new Error("scenario: expected a geometry item");
  const attr = item.geo.attrs.point.require(name);
  const n = item.geo.attrs.point.count * attr.tupleSize;
  return { data: attr.data.subarray(0, n) as Column["data"], tupleSize: attr.tupleSize };
}

/** f32 ULP distance (0 for bit-equal / both-NaN, Infinity for NaN vs number). */
function ulpDistance(a: number, b: number): number {
  if (Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b))) return 0;
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  const f = new Float32Array([a, b]);
  if (f[0] === f[1]) return 0;
  const u = new Uint32Array(f.buffer);
  const ord = (x: number): number => (x >>> 31 ? 0x80000000 - (x & 0x7fffffff) : 0x80000000 + x);
  return Math.abs(ord(u[0]) - ord(u[1]));
}

/** rangeUlp/maxUlp parity of `gpu` vs the CPU reference (see parity suite). */
function measureParity(cpu: Column, gpu: Column): { maxUlp: number; rangeUlp: number } {
  let range = 0;
  for (let i = 0; i < cpu.data.length; i++) {
    const a = Math.abs(cpu.data[i]);
    if (a > range && Number.isFinite(a)) range = a;
  }
  const unit = 2 ** -23 * (range === 0 ? 1 : range);
  let maxUlp = 0;
  let rangeUlp = 0;
  for (let i = 0; i < cpu.data.length; i++) {
    const c = cpu.data[i];
    const g = gpu.data[i];
    const d = ulpDistance(c, g);
    if (d > maxUlp) maxUlp = d;
    const abs =
      Number.isNaN(c) || Number.isNaN(g)
        ? Number.isNaN(c) && Number.isNaN(g)
          ? 0
          : Number.POSITIVE_INFINITY
        : Math.abs(c - g) / unit;
    if (abs > rangeUlp) rangeUlp = abs;
  }
  return { maxUlp, rangeUlp };
}

/** Minimum per-lane |dot| between unit quaternions (1 = same rotation). */
function minQuatDot(cpu: Column, gpu: Column): number {
  let min = 1;
  const n = cpu.data.length / 4;
  for (let i = 0; i < n; i++) {
    let dot = 0;
    for (let k = 0; k < 4; k++) dot += cpu.data[i * 4 + k] * gpu.data[i * 4 + k];
    const abs = Math.abs(dot);
    if (abs < min) min = abs;
  }
  return min;
}

/** Unit square mesh (surfaceSample fixture). */
function unitSquare(): Geometry {
  return createTriangleMesh([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3]);
}

/**
 * Points-only geometry with a dense f32 `density` column and the `P` the
 * workhorse spec needs: `randomField` keys on point IDENTITY, which is
 * the position bits hashed with the `seed` attribute, so a cloud with no
 * positions has no identity to key on. `seed` is deliberately left out —
 * a missing seed column contributes 0 on both the CPU and the device, so
 * this fixture also covers that half of the identity path.
 */
function leanDensityGeometry(count: number): Geometry {
  const geo = new Geometry();
  const P = geo.attrs.point.add("P", "f32", 3);
  const density = geo.attrs.point.add("density", "f32", 1);
  geo.attrs.point.resize(count);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) P.data[i * 3 + k] = (hashFloat(hashCombine(808, i, k)) - 0.5) * 16;
    density.data[i] = hashFloat(hashCombine(909, i));
  }
  return geo;
}

/** dataInput(geo) → node → output "out"; params applied to the node. */
function nodeGraph<P>(
  def: NodeDef<P>,
  params: Record<string, unknown>,
  inputGeo: Geometry | undefined,
): Graph {
  const g = new Graph(7);
  const n = g.add(def);
  if (inputGeo !== undefined) {
    const din = g.add(dataInput);
    g.setParam(din, "items", [makeGeometryItem(inputGeo)]);
    g.connect(din, "out", n, "in");
  }
  for (const [name, value] of Object.entries(params)) {
    g.setParam(n, name as keyof P & string, value as never);
  }
  g.output(n, "out", "out");
  return g;
}

/** The bit-exact workhorse spec (mul is bit-exact, randomField is a hash). */
const SPEC: FieldSpec = {
  fn: "mul",
  args: [{ fn: "attribute", name: "density" }, { fn: "randomField", key: "jitter" }],
};

const NOISE = (seed: number): FieldSpec =>
  ({ fn: "perlinNoise", opts: { seed, frequency: 0.3, normalized: true } }) as unknown as FieldSpec;

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const gpu = create([]);
  const adapter = await gpu.requestAdapter();
  if (adapter === null) {
    process.stdout.write(JSON.stringify({ ok: false, error: "no WebGPU adapter" }));
    return;
  }
  const device = await adapter.requestDevice();
  const structural: GpuDeviceLike = device;
  const evaluator = new GpuFieldEvaluator(structural, { adapterInfo: adapter.info });
  const out: Record<string, unknown> = { ok: true, salt: evaluator.cacheSalt };

  // -- per-node adoption parity ---------------------------------------------
  {
    interface NodeCase {
      readonly name: string;
      readonly attr: string;
      readonly bitExact: () => Graph;
      readonly noise?: () => Graph;
    }
    const cloud = (): Geometry => makeCorpusGeometry(10_000);
    const cases: NodeCase[] = [
      {
        name: "transformPoints",
        attr: "P",
        bitExact: () => nodeGraph(transformPoints, { translate: fieldFromJson(SPEC) }, cloud()),
        noise: () => nodeGraph(transformPoints, { translate: fieldFromJson(NOISE(3)) }, cloud()),
      },
      {
        name: "jitterPoints",
        attr: "P",
        bitExact: () => nodeGraph(jitterPoints, { amount: fieldFromJson(SPEC) }, cloud()),
        noise: () => nodeGraph(jitterPoints, { amount: fieldFromJson(NOISE(5)) }, cloud()),
      },
      {
        name: "orientAlongVector",
        attr: "rot",
        bitExact: () => nodeGraph(orientAlongVector, { direction: fieldFromJson(SPEC) }, cloud()),
        noise: () =>
          nodeGraph(
            orientAlongVector,
            {
              // Varied directions in the positive octant, offset away
              // from zero so the up-parallel fallback knife edge is
              // unreachable (see the report for the branch-flip note).
              direction: fieldFromJson({
                fn: "vec",
                args: [
                  { fn: "add", args: [NOISE(1), 0.05] },
                  NOISE(2),
                  { fn: "add", args: [NOISE(4), 0.05] },
                ],
              } as unknown as FieldSpec),
            },
            cloud(),
          ),
      },
      {
        name: "surfaceSample",
        attr: "P",
        bitExact: () =>
          nodeGraph(
            surfaceSample,
            { count: 4096, densityField: fieldFromJson({ fn: "randomField", key: "d" }) },
            unitSquare(),
          ),
      },
      {
        name: "volumeSample",
        attr: "P",
        bitExact: () =>
          nodeGraph(
            volumeSample,
            {
              boundsMin: [0, 0, 0],
              boundsMax: [2, 2, 2],
              cellSize: 0.1,
              jitter: fieldFromJson(SPEC),
            },
            undefined,
          ),
        noise: () =>
          nodeGraph(
            volumeSample,
            {
              boundsMin: [0, 0, 0],
              boundsMax: [2, 2, 2],
              cellSize: 0.1,
              jitter: fieldFromJson(NOISE(7)),
            },
            undefined,
          ),
      },
    ];

    const adoption: Record<string, unknown> = {};
    for (const c of cases) {
      const entry: Record<string, unknown> = {};
      {
        const g = c.bitExact();
        const cpu = await cook(g);
        const dev = await cook(g, { gpu: evaluator });
        entry.bitExact = {
          dispatches: dev.stats.gpu!.dispatches,
          fallbacks: dev.stats.gpu!.fallbacks,
          recooked: dev.stats.cooked,
          equal: bytesEqual(attrColumn(cpu, c.attr), attrColumn(dev, c.attr)),
        };
      }
      if (c.noise !== undefined) {
        const g = c.noise();
        const cpu = await cook(g);
        const dev = await cook(g, { gpu: evaluator });
        const cpuCol = attrColumn(cpu, c.attr);
        const devCol = attrColumn(dev, c.attr);
        entry.noise =
          c.attr === "rot"
            ? { dispatches: dev.stats.gpu!.dispatches, minQuatDot: minQuatDot(cpuCol, devCol) }
            : { dispatches: dev.stats.gpu!.dispatches, ...measureParity(cpuCol, devCol) };
      }
      adoption[c.name] = entry;
    }

    // surfaceSample under a noise density: acceptance is a knife edge
    // (hash < density), so compare the accepted candidate SETS via the
    // per-candidate hashed seed attribute instead of raw bytes.
    {
      const build = (): Graph =>
        nodeGraph(
          surfaceSample,
          { count: 4096, densityField: fieldFromJson(NOISE(11)) },
          unitSquare(),
        );
      const cpu = await cook(build());
      const dev = await cook(build(), { gpu: evaluator });
      const seedsOf = (r: CookResult): Set<number> => {
        const col = attrColumn(r, "seed");
        return new Set(Array.from(col.data as Uint32Array));
      };
      const a = seedsOf(cpu);
      const b = seedsOf(dev);
      let symDiff = 0;
      for (const s of a) if (!b.has(s)) symDiff++;
      for (const s of b) if (!a.has(s)) symDiff++;
      adoption.surfaceSampleNoise = {
        cpuAccepted: a.size,
        gpuAccepted: b.size,
        symDiff,
        dispatches: dev.stats.gpu!.dispatches,
      };
    }
    out.adoption = adoption;
  }

  // -- chunked dispatch ------------------------------------------------------
  {
    const field = fieldFromJson(SPEC);
    const forced128 = new GpuFieldEvaluator(structural, {
      adapterInfo: adapter.info,
      maxElementsPerDispatch: 128,
    });
    const forced100 = new GpuFieldEvaluator(structural, {
      adapterInfo: adapter.info,
      maxElementsPerDispatch: 100, // not a workgroup multiple: floors to 64
    });
    const seams: Record<string, unknown> = {};
    for (const count of [127, 128, 129, 1000]) {
      const geo = makeCorpusGeometry(count);
      const ctx: EvalContext = { geo, domain: "point", seed: 5 };
      const cpu = evaluateField(field, ctx);
      const unchunked = await evaluator.resolveField(field, ctx)!;
      const chunked = await forced128.resolveField(field, ctx)!;
      const floored = await forced100.resolveField(field, ctx)!;
      seams[`c${count}`] = {
        chunkedEqualsUnchunked: bytesEqual(unchunked, chunked),
        flooredEqualsUnchunked: bytesEqual(unchunked, floored),
        equalsCpu: bytesEqual(cpu, unchunked),
      };
    }
    // One realistic beyond-single-dispatch resolve: 4.3M elements is
    // above 65535 * 64 = 4,194,240, so the default evaluator must split
    // into two chunks — and the bytes must match the CPU exactly
    // (the spec is in the bit-exact family).
    const bigCount = 4_300_000;
    const bigGeo = leanDensityGeometry(bigCount);
    const bigCtx: EvalContext = { geo: bigGeo, domain: "point", seed: 12 };
    const started = performance.now();
    const bigGpu = await evaluator.resolveField(field, bigCtx)!;
    const bigMs = performance.now() - started;
    const bigCpu = evaluateField(field, bigCtx);
    out.chunking = {
      seams,
      big: {
        count: bigCount,
        equalsCpu: bytesEqual(bigCpu, bigGpu),
        length: bigGpu.data.length,
        ms: Math.round(bigMs),
      },
    };
  }

  // -- buffer pooling --------------------------------------------------------
  {
    const pooled = new GpuFieldEvaluator(structural, { adapterInfo: adapter.info });
    const unpooled = new GpuFieldEvaluator(structural, {
      adapterInfo: adapter.info,
      maxPooledBytes: 0, // retains nothing: the pre-pooling behavior
    });
    const fields: Record<string, Field> = {
      spec: fieldFromJson(SPEC),
      index: fieldFromJson({ fn: "index" }),
      position: fieldFromJson({ fn: "position" }),
    };
    // Interleaved shapes: grow/shrink/grow across counts, tuple sizes
    // (1 and 3) and out types (f32, u32) — later dispatches land in
    // buckets earlier ones populated, with different live ranges.
    const steps: Array<{ field: keyof typeof fields; count: number }> = [
      { field: "spec", count: 10_000 },
      { field: "spec", count: 12_000 },
      { field: "index", count: 12_000 },
      { field: "position", count: 3_000 },
      { field: "spec", count: 2_000 },
      { field: "spec", count: 10_000 },
      { field: "position", count: 12_000 },
      { field: "index", count: 50 },
    ];
    const stepResults: Array<Record<string, unknown>> = [];
    for (const step of steps) {
      const geo = makeCorpusGeometry(step.count);
      const ctx: EvalContext = { geo, domain: "point", seed: 21 };
      const a = await pooled.resolveField(fields[step.field], ctx)!;
      const b = await unpooled.resolveField(fields[step.field], ctx)!;
      const cpu = evaluateField(fields[step.field], ctx);
      stepResults.push({
        name: `${step.field}@${step.count}`,
        equalsFresh: bytesEqual(b, a),
        equalsCpu: bytesEqual(cpu, a),
      });
    }
    const statsAfter = pooled.poolStats;
    const unpooledStats = unpooled.poolStats;

    // Chunked + pooled: per-chunk uniform buffers are pooled and reused
    // on the next resolve.
    const chunkedPooled = new GpuFieldEvaluator(structural, {
      adapterInfo: adapter.info,
      maxElementsPerDispatch: 128,
    });
    const geo1000 = makeCorpusGeometry(1000);
    const ctx1000: EvalContext = { geo: geo1000, domain: "point", seed: 33 };
    const first = await chunkedPooled.resolveField(fields.spec, ctx1000)!;
    const afterFirst = chunkedPooled.poolStats;
    const second = await chunkedPooled.resolveField(fields.spec, ctx1000)!;
    const afterSecond = chunkedPooled.poolStats;

    // dispose(): pooled memory is released; the evaluator stays usable.
    pooled.dispose();
    const afterDispose = pooled.poolStats;
    const postDispose = await pooled.resolveField(fields.spec, ctx1000)!;
    const cpu1000 = evaluateField(fields.spec, ctx1000);

    out.pooling = {
      steps: stepResults,
      stats: statsAfter,
      unpooledStats,
      chunked: {
        equal: bytesEqual(first, second),
        equalsCpu: bytesEqual(cpu1000, first),
        afterFirst,
        afterSecond,
      },
      dispose: {
        afterDispose,
        postDisposeEqualsCpu: bytesEqual(cpu1000, postDispose),
        finalStats: pooled.poolStats,
      },
    };
  }

  process.stdout.write(JSON.stringify(out));
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stdout.write(
      JSON.stringify({ ok: false, error: String(err instanceof Error ? err.stack : err) }),
    );
    process.exit(0);
  },
);
