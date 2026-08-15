/**
 * Real-device scenario for phase 26: device-resident instance
 * transforms. Composes 4x4 instance matrices on the GPU inside a fused
 * run, retains the buffer, and measures it against `composeTRS` — the
 * CPU reference — over a dense sample plus the degenerate cases
 * (identity, zero scale, negative scale, unnormalized and zero
 * quaternions). Then exercises the ownership model on real device
 * memory: detach accounting, dispose (including twice), evaluator
 * dispose with an outstanding handle, cook→dispose→recook cycles, and
 * cancellation. Then pins the CPU fallback: an `assetAttr` spawner
 * produces bytes identical to a CPU-only cook, with the reason counted.
 *
 * Phase 45 adds two cases with a different bar. `instanceColour` compares
 * device colours against the CPU batch's at BYTE equality — colour is a
 * gather, not arithmetic, so there is no tolerance to spend — over a
 * sample whose head pins signed zero, subnormals, the f32 extremes and
 * out-of-gamut components, and it checks the 4-float device stride and
 * the zeroed pad slot the CPU's 3-float array has no room for. `budget`
 * cooks over `MAX_INSTANCES` on both paths and reports both whole error
 * messages, so the test can compare them character for character rather
 * than pattern-match each separately.
 *
 * Test-only: bundled by instances.device.test.ts (esbuild) and executed
 * in a plain Node child process — Dawn is unstable inside vitest workers
 * (see deviceRunner.mjs) — reporting JSON observations on stdout.
 */
import { create } from "webgpu";
import { Geometry } from "../data/index.js";
import { CookCancelledError, Graph, cook, makeGeometryItem } from "../graph/index.js";
import type { CookResult, InstancesItem } from "../graph/index.js";
import type { DeviceInstanceBatch, DeviceTransformsHandle } from "../fields/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import { dataInput } from "../runtime/dataInput.js";
import { orientAlongVector, transformPoints } from "../nodes/index.js";
import { fieldFromJson, type FieldSpec } from "../fields/fieldJson.js";
import { MAX_INSTANCES, buildInstanceBatches, spawnInstances } from "../spawn/index.js";
import { BUFFER_USAGE, MAP_MODE, type GpuDeviceLike } from "./device.js";
import { deviceTransformsBuffer } from "./deviceTransforms.js";
import { GpuFieldEvaluator } from "./evaluator.js";

const field = (s: object) => fieldFromJson(s as FieldSpec);

// ---------------------------------------------------------------------------
// fixtures

/**
 * A dense, deterministic transform sample: hash-derived P in [-40, 40],
 * quaternions from hash-derived axis/angle (so genuinely unit, to the
 * precision of the CPU's own f64 normalize), and scale in [0.05, 4].
 * Points 0..7 are pinned degenerate cases the parity numbers must cover
 * explicitly rather than by luck.
 */
function makeTransformSample(count: number): Geometry {
  const geo = new Geometry();
  const set = geo.attrs.point;
  const P = set.add("P", "f32", 3);
  const rot = set.add("rot", "f32", 4);
  const scale = set.add("scale", "f32", 3);
  set.resize(count);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) P.data[i * 3 + k] = (hashFloat(hashCombine(11, i, k)) - 0.5) * 80;
    // Axis-angle → unit quaternion, in f64 exactly as the CPU nodes do.
    const ax = hashFloat(hashCombine(22, i, 0)) - 0.5;
    const ay = hashFloat(hashCombine(22, i, 1)) - 0.5;
    const az = hashFloat(hashCombine(22, i, 2)) - 0.5;
    const len = Math.hypot(ax, ay, az) || 1;
    const angle = hashFloat(hashCombine(33, i)) * Math.PI * 2;
    const s = Math.sin(angle / 2);
    rot.data[i * 4] = (ax / len) * s;
    rot.data[i * 4 + 1] = (ay / len) * s;
    rot.data[i * 4 + 2] = (az / len) * s;
    rot.data[i * 4 + 3] = Math.cos(angle / 2);
    for (let k = 0; k < 3; k++) scale.data[i * 3 + k] = 0.05 + hashFloat(hashCombine(44, i, k)) * 3.95;
  }
  const setQuat = (i: number, q: readonly number[], sc: readonly number[]): void => {
    for (let k = 0; k < 4; k++) rot.data[i * 4 + k] = q[k];
    for (let k = 0; k < 3; k++) scale.data[i * 3 + k] = sc[k];
  };
  if (count > 7) {
    setQuat(0, [0, 0, 0, 1], [1, 1, 1]); // identity, unit scale
    setQuat(1, [0, 0, 0, 1], [0, 0, 0]); // zero scale
    setQuat(2, [0, 0, 0, 1], [-1, -2, -3]); // negative scale
    setQuat(3, [0.5, 0.5, 0.5, 0.5], [-1, 1, -1]); // negative scale + rotation
    setQuat(4, [1, 2, 3, 4], [1, 1, 1]); // grossly unnormalized quaternion
    setQuat(5, [0, 0, 0, 0], [1, 1, 1]); // zero quaternion (degenerate)
    setQuat(6, [1e-8, 1e-8, 1e-8, 1], [1e-6, 1e6, 1]); // tiny/huge scale
    setQuat(7, [0.7071067811865476, 0, 0, 0.7071067811865476], [2, 2, 2]); // exact 90 deg
  }
  return geo;
}

/** The degenerate rows, by index, for per-case parity reporting. */
const EDGE_CASES: readonly { readonly name: string; readonly index: number }[] = [
  { name: "identity", index: 0 },
  { name: "zeroScale", index: 1 },
  { name: "negativeScale", index: 2 },
  { name: "negativeScaleRotated", index: 3 },
  { name: "unnormalizedQuat", index: 4 },
  { name: "zeroQuat", index: 5 },
  { name: "tinyHugeScale", index: 6 },
  { name: "exact90", index: 7 },
];

/** Same sample with `rot`/`scale` removed: the identity/one defaults. */
function stripRotScale(src: Geometry, dropRot: boolean, dropScale: boolean): Geometry {
  const geo = new Geometry();
  const set = geo.attrs.point;
  const P = set.add("P", "f32", 3);
  const rot = dropRot ? undefined : set.add("rot", "f32", 4);
  const scale = dropScale ? undefined : set.add("scale", "f32", 3);
  const n = src.attrs.point.count;
  set.resize(n);
  P.data.set(src.attrs.point.require("P").data.subarray(0, n * 3));
  if (rot !== undefined) rot.data.set(src.attrs.point.require("rot").data.subarray(0, n * 4));
  if (scale !== undefined) scale.data.set(src.attrs.point.require("scale").data.subarray(0, n * 3));
  return geo;
}

// ---------------------------------------------------------------------------
// graph rigs

interface SpawnRig {
  readonly g: Graph;
  readonly ids: Record<string, string>;
}

/** dataInput → [chain] → spawnInstances; "instances" is the only output. */
function spawnRig(
  geo: Geometry,
  opts: {
    chain?: boolean;
    assetAttr?: string;
    colorAttr?: string;
    declarePoints?: boolean;
  } = {},
): SpawnRig {
  const g = new Graph(7);
  const din = g.add(dataInput, { items: [makeGeometryItem(geo)] });
  let tail: { id: string } = din;
  const ids: Record<string, string> = { din: din.id };
  if (opts.chain === true) {
    const xf = g.add(transformPoints, { translate: [1, 2, 3], rotateEuler: [0, 30, 0], scale: [2, 2, 2] });
    g.connect(tail, "out", xf, "in");
    ids.xf = xf.id;
    tail = xf;
    const or = g.add(orientAlongVector, { direction: field({ fn: "position" }) });
    g.connect(tail, "out", or, "in");
    ids.or = or.id;
    tail = or;
  }
  const sp = g.add(spawnInstances, {
    assetId: "tree",
    ...(opts.assetAttr !== undefined ? { assetAttr: opts.assetAttr } : {}),
    ...(opts.colorAttr !== undefined ? { colorAttr: opts.colorAttr } : {}),
  });
  g.connect(tail, "out", sp, "in");
  g.output(sp, "instances", "instances");
  if (opts.declarePoints === true) g.output(sp, "points", "points");
  ids.sp = sp.id;
  return { g, ids };
}

function instancesOf(result: CookResult, name = "instances"): InstancesItem {
  const item = result.outputs[name][0];
  if (item.kind !== "instances") throw new Error("scenario: expected an instances item");
  return item;
}

// ---------------------------------------------------------------------------
// device readback of a retained handle (what phase 27 will bind instead)

async function readHandle(
  device: GpuDeviceLike,
  handle: DeviceTransformsHandle,
): Promise<Float32Array> {
  const src = deviceTransformsBuffer(handle);
  const staging = device.createBuffer({
    size: handle.byteLength,
    usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(src, 0, staging, 0, handle.byteLength);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(MAP_MODE.READ, 0, handle.byteLength);
  const copy = staging.getMappedRange(0, handle.byteLength).slice(0);
  staging.unmap();
  staging.destroy();
  return new Float32Array(copy);
}

// ---------------------------------------------------------------------------
// parity measurement

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

interface Parity {
  /** Elements compared. */
  n: number;
  /** max |cpu - gpu|. */
  maxAbs: number;
  /** max |cpu - gpu| / max|cpu| over the sample (relative to the range). */
  rangeRel: number;
  /** max |cpu - gpu| in f32 ULP units at the top of the range. */
  rangeUlp: number;
  /** Raw max ULP distance (spikes at zero crossings; reported, not budgeted). */
  maxUlp: number;
  /** Elements that are bit-identical to the CPU. */
  bitEqual: number;
  /** Index of the worst absolute deviation. */
  worstAt: number;
}

function measure(cpu: ArrayLike<number>, gpu: ArrayLike<number>): Parity {
  let range = 0;
  for (let i = 0; i < cpu.length; i++) {
    const x = Math.abs(cpu[i]);
    if (x > range && Number.isFinite(x)) range = x;
  }
  const unit = 2 ** -23 * (range === 0 ? 1 : range);
  let maxAbs = 0;
  let maxUlp = 0;
  let bitEqual = 0;
  let worstAt = -1;
  for (let i = 0; i < cpu.length; i++) {
    const d = Math.abs(cpu[i] - gpu[i]);
    // NaN comparisons are FALSE, so a bare `d > maxAbs` would silently
    // report a perfect score for an all-NaN (or short) GPU buffer. A
    // mismatched non-finite is the worst possible deviation, not the
    // best: make it Infinity so every tolerance budget rejects it.
    if (Number.isNaN(d) && !Object.is(cpu[i], gpu[i])) {
      maxAbs = Number.POSITIVE_INFINITY;
      worstAt = i;
    } else if (d > maxAbs) {
      maxAbs = d;
      worstAt = i;
    }
    const u = ulpDistance(cpu[i], gpu[i]);
    if (u > maxUlp) maxUlp = u;
    if (u === 0) bitEqual++;
  }
  return {
    n: cpu.length,
    maxAbs,
    rangeRel: range === 0 ? 0 : maxAbs / range,
    rangeUlp: maxAbs / unit,
    maxUlp,
    bitEqual,
    worstAt,
  };
}

/** `composeTRS` over a geometry — the CPU reference, in the batch layout. */
function cpuTransforms(geo: Geometry, assetId: string): Float32Array {
  const batches = buildInstanceBatches(geo, { defaultAssetId: assetId });
  if (batches.length !== 1) throw new Error("scenario: expected exactly one CPU batch");
  return batches[0].transforms;
}

// ---------------------------------------------------------------------------
// cases

async function kernelParity(
  device: GpuDeviceLike,
  adapterInfo: { vendor?: string },
): Promise<Record<string, unknown>> {
  const count = 4096;
  const sample = makeTransformSample(count);
  const ev = new GpuFieldEvaluator(device, { adapterInfo, deviceInstances: true });

  const variants: Array<Record<string, unknown>> = [];
  for (const [name, dropRot, dropScale] of [
    ["full", false, false],
    ["noRot", true, false],
    ["noScale", false, true],
    ["pOnly", true, true],
  ] as const) {
    const geo = stripRotScale(sample, dropRot, dropScale);
    const rig = spawnRig(geo);
    const result = await cook(rig.g, { gpu: ev });
    const item = instancesOf(result);
    const batch = item.deviceBatches![0];
    const gpu = await readHandle(device, batch.transforms);
    const cpu = cpuTransforms(geo, "tree");
    const parity = measure(cpu, gpu);
    // Per-element-slot parity: the four matrix columns behave
    // differently (translation is a straight copy and must be EXACT).
    const slot = (start: number, len: number): Parity => {
      const c: number[] = [];
      const g: number[] = [];
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < len; k++) {
          c.push(cpu[i * 16 + start + k]);
          g.push(gpu[i * 16 + start + k]);
        }
      }
      return measure(c, g);
    };
    variants.push({
      name,
      count: batch.count,
      assetId: batch.assetId,
      byteLength: batch.transforms.byteLength,
      residency: batch.residency,
      backend: batch.transforms.backend,
      parity,
      basis: slot(0, 3),
      translation: slot(12, 3),
      // Rows 3/7/11 are literal 0 and row 15 literal 1 — pin them exactly.
      padExact:
        (() => {
          for (let i = 0; i < count; i++) {
            for (const k of [3, 7, 11]) if (gpu[i * 16 + k] !== 0) return false;
            if (gpu[i * 16 + 15] !== 1) return false;
          }
          return true;
        })(),
      edges: EDGE_CASES.map((c) => ({
        name: c.name,
        cpu: Array.from(cpu.subarray(c.index * 16, c.index * 16 + 16)),
        gpu: Array.from(gpu.subarray(c.index * 16, c.index * 16 + 16)),
        parity: measure(
          Array.from(cpu.subarray(c.index * 16, c.index * 16 + 16)),
          Array.from(gpu.subarray(c.index * 16, c.index * 16 + 16)),
        ),
      })),
    });
    batch.transforms.dispose();
  }

  // Determinism: the same graph twice produces byte-identical transforms.
  const rigA = spawnRig(sample);
  const a = instancesOf(await cook(rigA.g, { gpu: ev })).deviceBatches![0].transforms;
  const bytesA = await readHandle(device, a);
  a.dispose();
  const rigB = spawnRig(sample);
  const b = instancesOf(await cook(rigB.g, { gpu: ev })).deviceBatches![0].transforms;
  const bytesB = await readHandle(device, b);
  b.dispose();
  let identical = bytesA.length === bytesB.length;
  for (let i = 0; identical && i < bytesA.length; i++) {
    identical = Object.is(bytesA[i], bytesB[i]);
  }

  ev.dispose();
  return { variants, deterministic: identical };
}

/** A fused chain that ends at the spawner: transforms compose the chain's work. */
async function fusedChain(
  device: GpuDeviceLike,
  adapterInfo: { vendor?: string },
): Promise<Record<string, unknown>> {
  const count = 2048;
  const geo = makeTransformSample(count);
  const ev = new GpuFieldEvaluator(device, { adapterInfo, deviceInstances: true });

  // Fused: the whole chain plus the compose kernel, no readback.
  const rig = spawnRig(geo, { chain: true });
  const fused = await cook(rig.g, { gpu: ev });
  const batch = instancesOf(fused).deviceBatches![0];
  const gpu = await readHandle(device, batch.transforms);

  // Reference: cook the same chain WITHOUT the spawner on the CPU, then
  // composeTRS its output — the exact bytes v0.6.1 would have produced.
  const refGraph = new Graph(7);
  const din = refGraph.add(dataInput, { items: [makeGeometryItem(geo)] }, rig.ids.din);
  const xf = refGraph.add(
    transformPoints,
    { translate: [1, 2, 3], rotateEuler: [0, 30, 0], scale: [2, 2, 2] },
    rig.ids.xf,
  );
  const or = refGraph.add(orientAlongVector, { direction: field({ fn: "position" }) }, rig.ids.or);
  refGraph.connect(din, "out", xf, "in");
  refGraph.connect(xf, "out", or, "in");
  refGraph.output(or, "out", "out");
  const refCook = await cook(refGraph);
  const refItem = refCook.outputs.out[0];
  if (refItem.kind !== "geometry") throw new Error("scenario: expected geometry");
  const cpu = cpuTransforms(refItem.geo, "tree");

  // And the geometry-materializing variant of the same fused run.
  const declared = spawnRig(geo, { chain: true, declarePoints: true });
  const withGeo = await cook(declared.g, { gpu: ev });
  const geoItem = withGeo.outputs.points[0];
  const geoBatch = instancesOf(withGeo).deviceBatches![0];
  const gpuWithGeo = await readHandle(device, geoBatch.transforms);
  const cpuFromMaterialized =
    geoItem.kind === "geometry" ? cpuTransforms(geoItem.geo, "tree") : new Float32Array(0);

  // A LONE spawner whose points output is declared: the run materializes
  // geometry, but no member wrote an attribute, so there is nothing to
  // read back at all (a zero-length map would be invalid).
  const bare = spawnRig(geo, { declarePoints: true });
  const bareCook = await cook(bare.g, { gpu: ev });
  const bareItem = bareCook.outputs.points[0];
  const bareBatch = instancesOf(bareCook).deviceBatches![0];
  const bareGpu = await readHandle(device, bareBatch.transforms);
  const bareParity = measure(cpuTransforms(geo, "tree"), bareGpu);
  const bareGeoUnchanged =
    bareItem.kind === "geometry" &&
    (() => {
      const a = geo.attrs.point;
      const b = bareItem.geo.attrs.point;
      if (a.count !== b.count || a.names().join() !== b.names().join()) return false;
      for (const name of a.names()) {
        const x = a.require(name).data;
        const y = b.require(name).data;
        if (x.length !== y.length) return false;
        for (let i = 0; i < a.count * a.require(name).tupleSize; i++) {
          if (!Object.is(x[i], y[i])) return false;
        }
      }
      return true;
    })();
  bareBatch.transforms.dispose();

  const out = {
    fusedStats: statsOf(fused),
    withGeoStats: statsOf(withGeo),
    bareStats: statsOf(bareCook),
    bareParity,
    bareGeoUnchanged,
    pointsProducedWhenUnread: fused.outputs.points === undefined,
    pointsProducedWhenDeclared: geoItem.kind === "geometry",
    parityVsCpuChain: measure(cpu, gpu),
    // The materialized geometry and the retained buffer must agree: the
    // compose kernel read the same device bytes the readback returned.
    parityMaterializedVsDevice: measure(cpuFromMaterialized, gpuWithGeo),
  };
  batch.transforms.dispose();
  geoBatch.transforms.dispose();
  ev.dispose();
  return out;
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

function statsOf(r: CookResult): StatsShape {
  const g = r.stats.gpu!;
  return {
    residentRuns: g.residentRuns,
    fusedNodes: g.fusedNodes,
    readbacksSaved: g.readbacksSaved,
    dispatches: g.dispatches,
    fallbacks: { ...g.fallbacks },
    cooked: r.stats.cooked,
    cached: r.stats.cached,
  };
}

/** Pool accounting across the whole ownership lifecycle. */
async function ownership(
  device: GpuDeviceLike,
  adapterInfo: { vendor?: string },
): Promise<Record<string, unknown>> {
  const count = 512;
  const geo = makeTransformSample(count);
  const ev = new GpuFieldEvaluator(device, { adapterInfo, deviceInstances: true });
  const bytes = count * 64;
  const snap = () => {
    const s = ev.poolStats;
    return {
      detachedBuffers: s.detachedBuffers,
      detachedBytes: s.detachedBytes,
      buffersDetached: s.buffersDetached,
      inFlight: s.buffersCreated - s.buffersDestroyed - s.pooledBuffers,
    };
  };

  const before = snap();
  const rig = spawnRig(geo);
  const handle = instancesOf(await cook(rig.g, { gpu: ev })).deviceBatches![0].transforms;
  const afterCook = snap();
  // The handle is live and readable while owned.
  const readable = (await readHandle(device, handle)).length === count * 16;
  handle.dispose();
  const afterDispose = snap();
  const disposedTwiceThrew = ((): string | null => {
    try {
      handle.dispose();
      handle.dispose();
      return null;
    } catch (err) {
      return String(err);
    }
  })();
  const resourceAfterDispose = ((): string | null => {
    try {
      deviceTransformsBuffer(handle);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  })();

  // cook → retain → dispose → recook cycles: nothing may grow.
  const cycles: Array<{ detachedBuffers: number; detachedBytes: number; inFlight: number }> = [];
  for (let i = 0; i < 12; i++) {
    const r = await cook(spawnRig(geo).g, { gpu: ev });
    const h = instancesOf(r).deviceBatches![0].transforms;
    cycles.push(snap());
    h.dispose();
  }
  const afterCycles = snap();

  // Holding N handles at once accumulates exactly N buffers' worth, then
  // returns to zero — the accounting is a real measure, not a constant.
  const held: DeviceTransformsHandle[] = [];
  for (let i = 0; i < 4; i++) {
    held.push(instancesOf(await cook(spawnRig(geo).g, { gpu: ev })).deviceBatches![0].transforms);
  }
  const holding = snap();
  for (const h of held) h.dispose();
  const afterRelease = snap();

  // Evaluator dispose with an OUTSTANDING handle: the pool drops its idle
  // buffers, the handle keeps working, and disposing it afterwards frees it.
  const outstanding = instancesOf(await cook(spawnRig(geo).g, { gpu: ev })).deviceBatches![0]
    .transforms;
  ev.dispose();
  const afterEvaluatorDispose = snap();
  const usableAfterEvaluatorDispose = ((): boolean => {
    try {
      deviceTransformsBuffer(outstanding);
      return !outstanding.disposed;
    } catch {
      return false;
    }
  })();
  const readableAfterEvaluatorDispose = (await readHandle(device, outstanding)).length === count * 16;
  outstanding.dispose();
  const final = snap();

  return {
    expectedBytes: bytes,
    before,
    afterCook,
    readable,
    afterDispose,
    disposedTwiceThrew,
    resourceAfterDispose,
    cycles,
    afterCycles,
    holding,
    afterRelease,
    afterEvaluatorDispose,
    usableAfterEvaluatorDispose,
    readableAfterEvaluatorDispose,
    final,
  };
}

/** Cancellation must not strand the retained buffer. */
async function cancellation(
  device: GpuDeviceLike,
  adapterInfo: { vendor?: string },
): Promise<Record<string, unknown>> {
  const geo = makeTransformSample(1024);
  const ev = new GpuFieldEvaluator(device, { adapterInfo, deviceInstances: true });
  const snap = () => {
    const s = ev.poolStats;
    return {
      detachedBuffers: s.detachedBuffers,
      detachedBytes: s.detachedBytes,
      inFlight: s.buffersCreated - s.buffersDestroyed - s.pooledBuffers,
    };
  };
  const before = snap();
  // A signal that reports aborted from its second read: the abort lands
  // inside the run, before ownership transfers.
  let reads = 0;
  const signal = {
    get aborted(): boolean {
      return ++reads > 1;
    },
  } as unknown as AbortSignal;
  const err = await cook(spawnRig(geo, { chain: true }).g, { gpu: ev, signal }).then(
    () => null,
    (e: unknown) => e,
  );
  const afterAbort = snap();
  // Recovery: the same graph cooks cleanly afterwards.
  const h = instancesOf(await cook(spawnRig(geo, { chain: true }).g, { gpu: ev })).deviceBatches![0]
    .transforms;
  const duringRecovery = snap();
  h.dispose();
  const after = snap();
  ev.dispose();
  return {
    cancelledName: err instanceof Error ? err.name : String(err),
    isCookCancelled: err instanceof CookCancelledError,
    before,
    afterAbort,
    duringRecovery,
    after,
  };
}

/**
 * The phase-29 fixture: a species column exercising the whole ordering
 * edge matrix in one geometry.
 *
 * - "ghost" is interned into the string table but worn by no point, and
 *   "rock"/"pine" are interned in the OPPOSITE order to their first
 *   occurrence — so table order, intern order and lexicographic order
 *   all differ from the spec's first-occurrence order.
 * - point 2 is the empty string and point 3 is the literal "tree": two
 *   distinct table indices that must merge into ONE batch.
 * - point 5 carries an out-of-range table index, which reads as "" and
 *   must merge into that same batch rather than opening a new one.
 *
 * Expected batch order: pine, rock, tree, fern.
 */
function makeSpeciesSample(count: number, tupleSize = 1): Geometry {
  const geo = makeTransformSample(count);
  const species = geo.attrs.point.add("species", "string", tupleSize, "");
  species.internString("ghost");
  species.internString("rock");
  species.internString("pine");
  for (let i = 0; i < count; i++) {
    const m = i % 5;
    species.setString(
      i,
      m === 0 ? "pine" : m === 1 ? "rock" : m === 2 ? "" : m === 3 ? "tree" : "fern",
    );
    // A decoy in component 1 that grouping must never read.
    if (tupleSize > 1) species.setString(i, m === 0 ? "fern" : "ghost", 1);
  }
  // Point 5 would be "pine"; an out-of-range index makes it "" instead.
  species.data[5 * tupleSize] = species.stringTable.length + 3;
  return geo;
}

/** Every batch of a device instances item, read back and measured vs the CPU. */
async function batchObservations(
  device: GpuDeviceLike,
  batches: readonly DeviceInstanceBatch[],
  cpu: readonly { assetId: string; count: number; transforms: Float32Array }[],
): Promise<Record<string, unknown>> {
  const shapes = batches.map((b) => [b.assetId, b.count] as const);
  const cpuShapes = cpu.map((b) => [b.assetId, b.count] as const);
  const perBatch: Array<Record<string, unknown>> = [];
  const flatCpu: number[] = [];
  const flatGpu: number[] = [];
  for (let j = 0; j < batches.length; j++) {
    const gpu = await readHandle(device, batches[j].transforms);
    const ref = cpu[j]?.transforms ?? new Float32Array(0);
    perBatch.push({
      assetId: batches[j].assetId,
      count: batches[j].count,
      byteLength: batches[j].transforms.byteLength,
      // Length equality is part of the oracle: a short GPU buffer would
      // otherwise be compared against a truncated CPU reference.
      lengthsAgree: gpu.length === ref.length,
      parity: measure(ref, gpu),
    });
    for (let i = 0; i < ref.length; i++) flatCpu.push(ref[i]);
    for (let i = 0; i < gpu.length; i++) flatGpu.push(gpu[i]);
  }
  return {
    shapes,
    shapesMatchCpu: JSON.stringify(shapes) === JSON.stringify(cpuShapes),
    perBatch,
    // One aggregate parity over every instance of every batch, so a
    // single wrongly-sourced matrix anywhere shows up.
    parity: measure(flatCpu, flatGpu),
  };
}

/**
 * assetAttr on the device: one batch per asset, in the CPU spawner's
 * order, composed from the host-planned permutation.
 */
async function assetAttrGrouping(
  device: GpuDeviceLike,
  adapterInfo: { vendor?: string },
): Promise<Record<string, unknown>> {
  const count = 512;
  const geo = makeSpeciesSample(count);
  const opts = { defaultAssetId: "tree", assetAttr: "species" } as const;
  const cpu = buildInstanceBatches(geo, opts);

  const ev = new GpuFieldEvaluator(device, { adapterInfo, deviceInstances: true });
  const gpuCook = await cook(spawnRig(geo, { assetAttr: "species" }).g, { gpu: ev });
  const item = instancesOf(gpuCook);
  const batches = item.deviceBatches!;
  const grouped = await batchObservations(device, batches, cpu);

  // Ownership: one detached buffer per asset, out and back.
  const holding = {
    detachedBuffers: ev.poolStats.detachedBuffers,
    detachedBytes: ev.poolStats.detachedBytes,
  };
  const holdingBytesMatchCounts =
    batches.reduce((n, b) => n + b.count, 0) * 64 ===
    cpu.reduce((n, b) => n + b.transforms.length * 4, 0);
  for (const b of batches) b.transforms.dispose();
  const afterDispose = {
    detachedBuffers: ev.poolStats.detachedBuffers,
    detachedBytes: ev.poolStats.detachedBytes,
    inFlight: ev.poolStats.buffersCreated - ev.poolStats.buffersDestroyed - ev.poolStats.pooledBuffers,
  };

  // Recook → evict → recook: the same N buffers out and back each time,
  // and byte-identical transforms every time (the permutation is data,
  // never a cached pipeline input).
  const cycles: Array<Record<string, number>> = [];
  let identicalAcrossCooks = true;
  let firstBytes: number[] | undefined;
  for (let c = 0; c < 3; c++) {
    const r = await cook(spawnRig(geo, { assetAttr: "species" }).g, { gpu: ev });
    const bs = instancesOf(r).deviceBatches!;
    cycles.push({
      batches: bs.length,
      detachedBuffers: ev.poolStats.detachedBuffers,
      detachedBytes: ev.poolStats.detachedBytes,
    });
    const bytes: number[] = [];
    for (const b of bs) bytes.push(...(await readHandle(device, b.transforms)));
    if (firstBytes === undefined) firstBytes = bytes;
    else {
      identicalAcrossCooks &&= firstBytes.length === bytes.length;
      for (let i = 0; identicalAcrossCooks && i < bytes.length; i++) {
        identicalAcrossCooks = Object.is(firstBytes[i], bytes[i]);
      }
    }
    for (const b of bs) b.transforms.dispose();
  }
  const afterCycles = {
    detachedBuffers: ev.poolStats.detachedBuffers,
    detachedBytes: ev.poolStats.detachedBytes,
    inFlight: ev.poolStats.buffersCreated - ev.poolStats.buffersDestroyed - ev.poolStats.pooledBuffers,
  };

  // Batch order must not follow the string table: a geometry whose table
  // was interned in a DIFFERENT order (same per-point ids) groups the
  // same way. Nothing about the plan or the pipeline may key on it.
  const permuted = makeTransformSample(count);
  const alt = permuted.attrs.point.add("species", "string", 1, "");
  alt.internString("fern");
  alt.internString("tree");
  alt.internString("pine");
  for (let i = 0; i < count; i++) {
    alt.setString(i, geo.attrs.point.require("species").getString(i));
  }
  const permCook = await cook(spawnRig(permuted, { assetAttr: "species" }).g, { gpu: ev });
  const permBatches = instancesOf(permCook).deviceBatches!;
  const permShapes = permBatches.map((b) => [b.assetId, b.count] as const);
  for (const b of permBatches) b.transforms.dispose();

  // tupleSize 2: component 0 only, decoy in component 1.
  const wide = makeSpeciesSample(count, 2);
  const wideCook = await cook(spawnRig(wide, { assetAttr: "species" }).g, { gpu: ev });
  const wideBatches = instancesOf(wideCook).deviceBatches!;
  const wideObs = await batchObservations(
    device,
    wideBatches,
    buildInstanceBatches(wide, opts),
  );
  for (const b of wideBatches) b.transforms.dispose();

  // A single-asset column: the N = 1 boundary of the indexed path.
  const solo = makeTransformSample(64);
  const soloAttr = solo.attrs.point.add("species", "string", 1, "");
  for (let i = 0; i < 64; i++) soloAttr.setString(i, "only");
  const soloCook = await cook(spawnRig(solo, { assetAttr: "species" }).g, { gpu: ev });
  const soloBatches = instancesOf(soloCook).deviceBatches!;
  const soloObs = await batchObservations(device, soloBatches, buildInstanceBatches(solo, opts));
  for (const b of soloBatches) b.transforms.dispose();

  const out = {
    stats: statsOf(gpuCook),
    deviceBatchesPresent: item.deviceBatches !== undefined,
    grouped,
    cpuShapes: cpu.map((b) => [b.assetId, b.count] as const),
    tableEntries: [...geo.attrs.point.require("species").stringTable],
    holding,
    holdingBytesMatchCounts,
    afterDispose,
    cycles,
    afterCycles,
    identicalAcrossCooks,
    permutedTableShapes: permShapes,
    wide: wideObs,
    solo: soloObs,
  };
  ev.dispose();
  return out;
}

/** A fusable chain in front of a MULTI-ASSET spawner: one run, all of it. */
async function assetAttrChain(
  device: GpuDeviceLike,
  adapterInfo: { vendor?: string },
): Promise<Record<string, unknown>> {
  const count = 256;
  const geo = makeSpeciesSample(count);
  const ev = new GpuFieldEvaluator(device, { adapterInfo, deviceInstances: true });

  const rig = spawnRig(geo, { chain: true, assetAttr: "species" });
  const fused = await cook(rig.g, { gpu: ev });
  const batches = instancesOf(fused).deviceBatches!;

  // Reference: the same chain cooked on the CPU without the spawner,
  // then grouped and composed by the CPU spawner.
  const refGraph = new Graph(7);
  const din = refGraph.add(dataInput, { items: [makeGeometryItem(geo)] }, rig.ids.din);
  const xf = refGraph.add(
    transformPoints,
    { translate: [1, 2, 3], rotateEuler: [0, 30, 0], scale: [2, 2, 2] },
    rig.ids.xf,
  );
  const or = refGraph.add(orientAlongVector, { direction: field({ fn: "position" }) }, rig.ids.or);
  refGraph.connect(din, "out", xf, "in");
  refGraph.connect(xf, "out", or, "in");
  refGraph.output(or, "out", "out");
  const refItem = (await cook(refGraph)).outputs.out[0];
  if (refItem.kind !== "geometry") throw new Error("scenario: expected geometry");
  const cpu = buildInstanceBatches(refItem.geo, { defaultAssetId: "tree", assetAttr: "species" });

  const observed = await batchObservations(device, batches, cpu);
  for (const b of batches) b.transforms.dispose();
  const out = { stats: statsOf(fused), observed, batchCount: batches.length };
  ev.dispose();
  return out;
}

// ---------------------------------------------------------------------------
// per-instance colour (phase 45)

/**
 * Colour rows a COPY must survive unchanged, pinned at the head of the
 * sample rather than hoped for. A gather has no arithmetic in it, so
 * every one of these is a byte-equality claim, not a tolerance one:
 *
 * - signed zero, whose sign bit only survives a genuine copy;
 * - out-of-gamut and negative components (nothing clamps anywhere);
 * - the f32 extremes and the smallest normal;
 * - SUBNORMALS, the one class a device could plausibly flush to zero —
 *   the same hazard the constant-slot work measured for `-0` literals, on
 *   the load/store path this time;
 * - ordinary decimals that are not exactly representable, so the stored
 *   f32 is an arbitrary bit pattern rather than a tidy fraction.
 *
 * Alpha is deliberately non-zero on most rows: it is what a kernel that
 * wrote the source's fourth component into the pad slot — instead of the
 * literal 0 — would leak, and it must never appear in the buffer.
 */
const COLOR_EDGES: readonly (readonly number[])[] = [
  [0, 0, 0, 0.5],
  [1, 1, 1, 1],
  [-0, -0, -0, 0.25],
  [-1.5, 2.75, 1e-7, 0.75],
  [3.4028234663852886e38, -3.4028234663852886e38, 1.1754943508222875e-38, 1],
  [1.401298464324817e-45, 5.877471754111438e-39, 7.006492321624085e-46, 1],
  [0.1, 0.2, 0.3, 0.4],
  [123456.78, 0.000123456, 65504, 0.875],
];

/**
 * The transform sample plus two colour columns: the standard f32x4
 * `color` (alpha to be dropped) and a hand-written f32x3 `tint`, which
 * the extraction rule must read identically. Optionally a `species`
 * column so the gather can be checked THROUGH the grouping permutation.
 */
function makeColourSample(count: number, withSpecies: boolean): Geometry {
  const geo = withSpecies ? makeSpeciesSample(count) : makeTransformSample(count);
  const set = geo.attrs.point;
  const color = set.add("color", "f32", 4);
  const tint = set.add("tint", "f32", 3);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 4; k++) color.data[i * 4 + k] = hashFloat(hashCombine(55, i, k));
    for (let k = 0; k < 3; k++) tint.data[i * 3 + k] = (hashFloat(hashCombine(66, i, k)) - 0.5) * 3;
  }
  for (let e = 0; e < COLOR_EDGES.length && e < count; e++) {
    for (let k = 0; k < 4; k++) color.data[e * 4 + k] = COLOR_EDGES[e][k];
    for (let k = 0; k < 3; k++) tint.data[e * 3 + k] = COLOR_EDGES[e][k];
  }
  return geo;
}

interface ColorAgreement {
  /** Components compared (`count * 3`). */
  n: number;
  /** Components not bit-identical to the CPU batch. */
  mismatchCount: number;
  /** The first few, for a failure that names values rather than a count. */
  mismatches: Array<{ instance: number; component: number; cpu: number; gpu: number }>;
  /** Instances whose pad slot (float 3 of 4) is not exactly +0. */
  padNonZero: number;
  /** Device floats per instance, derived from the buffer, not assumed. */
  floatsPerInstance: number;
}

/**
 * Byte equality between one CPU batch's `colors` (3 floats per instance)
 * and the device buffer (4, the WGSL vec3 stride). `Object.is` rather
 * than `===`, so -0 does NOT pass as 0 and a NaN would compare equal to
 * itself; there is no tolerance parameter here on purpose.
 */
function compareColors(
  cpu: Float32Array | undefined,
  gpu: Float32Array,
  count: number,
): ColorAgreement {
  const out: ColorAgreement = {
    n: count * 3,
    mismatchCount: 0,
    mismatches: [],
    padNonZero: 0,
    floatsPerInstance: count === 0 ? 0 : gpu.length / count,
  };
  if (cpu === undefined || cpu.length !== count * 3) {
    out.mismatchCount = count * 3;
    return out;
  }
  for (let k = 0; k < count; k++) {
    for (let c = 0; c < 3; c++) {
      const a = cpu[k * 3 + c];
      const b = gpu[k * 4 + c];
      if (Object.is(a, b)) continue;
      out.mismatchCount++;
      if (out.mismatches.length < 8) {
        out.mismatches.push({ instance: k, component: c, cpu: a, gpu: b });
      }
    }
    if (!Object.is(gpu[k * 4 + 3], 0)) out.padNonZero++;
  }
  return out;
}

/** Every batch's colours, read back and compared against the CPU batches. */
async function colorObservations(
  device: GpuDeviceLike,
  batches: readonly DeviceInstanceBatch[],
  cpu: readonly { assetId: string; count: number; colors?: Float32Array }[],
): Promise<Record<string, unknown>> {
  const perBatch: Array<Record<string, unknown>> = [];
  let mismatchTotal = 0;
  let padNonZeroTotal = 0;
  let compared = 0;
  for (let j = 0; j < batches.length; j++) {
    const handle = batches[j].colors;
    if (handle === undefined) {
      perBatch.push({ assetId: batches[j].assetId, missing: true });
      mismatchTotal += batches[j].count * 3;
      continue;
    }
    const gpu = await readHandle(device, handle);
    const agreement = compareColors(cpu[j]?.colors, gpu, batches[j].count);
    mismatchTotal += agreement.mismatchCount;
    padNonZeroTotal += agreement.padNonZero;
    compared += agreement.n;
    perBatch.push({
      assetId: batches[j].assetId,
      count: batches[j].count,
      byteLength: handle.byteLength,
      backend: handle.backend,
      agreement,
    });
  }
  return { perBatch, mismatchTotal, padNonZeroTotal, compared };
}

/** Flatten a device batch list's transform bytes, in batch order. */
async function flatTransforms(
  device: GpuDeviceLike,
  batches: readonly DeviceInstanceBatch[],
): Promise<number[]> {
  const out: number[] = [];
  for (const b of batches) out.push(...(await readHandle(device, b.transforms)));
  return out;
}

/**
 * Colour on the device. Composed by the SAME kernel as the matrix, from
 * the same source index, so the two cannot disagree about which point an
 * instance came from — and because a colour is copied rather than
 * computed, the bar is byte equality with the CPU batch, not a tolerance.
 */
async function instanceColour(
  device: GpuDeviceLike,
  adapterInfo: { vendor?: string },
): Promise<Record<string, unknown>> {
  const count = 1024;
  const ev = new GpuFieldEvaluator(device, { adapterInfo, deviceInstances: true });
  const cases: Array<Record<string, unknown>> = [];

  for (const [name, colorAttr, assetAttr, chain] of [
    // f32x4 `color`: alpha must be dropped, not padded through.
    ["rgba", "color", "", false],
    // f32x3 `tint`: the same extraction over a narrower column.
    ["rgb", "tint", "", false],
    // Through the grouping permutation — the case where a colour read in
    // a second pass would silently pick up the wrong point.
    ["grouped", "color", "species", false],
    // And behind a fused chain, so colour rides a run of three members.
    ["chained", "tint", "species", true],
  ] as const) {
    const geo = makeColourSample(count, assetAttr !== "");
    const rig = spawnRig(geo, {
      colorAttr,
      ...(assetAttr !== "" ? { assetAttr } : {}),
      ...(chain ? { chain: true } : {}),
    });
    const cooked = await cook(rig.g, { gpu: ev });
    const batches = instancesOf(cooked).deviceBatches!;

    // The CPU reference. For the chained case it must be the CPU cook of
    // the same chain, so the comparison is spawner-vs-spawner rather
    // than device-chain-vs-input.
    let source = geo;
    if (chain) {
      const refGraph = new Graph(7);
      const din = refGraph.add(dataInput, { items: [makeGeometryItem(geo)] }, rig.ids.din);
      const xf = refGraph.add(
        transformPoints,
        { translate: [1, 2, 3], rotateEuler: [0, 30, 0], scale: [2, 2, 2] },
        rig.ids.xf,
      );
      const or = refGraph.add(orientAlongVector, { direction: field({ fn: "position" }) }, rig.ids.or);
      refGraph.connect(din, "out", xf, "in");
      refGraph.connect(xf, "out", or, "in");
      refGraph.output(or, "out", "out");
      const refItem = (await cook(refGraph)).outputs.out[0];
      if (refItem.kind !== "geometry") throw new Error("scenario: expected geometry");
      source = refItem.geo;
    }
    const cpu = buildInstanceBatches(source, {
      defaultAssetId: "tree",
      ...(assetAttr !== "" ? { assetAttr } : {}),
      colorAttr,
    });

    const colors = await colorObservations(device, batches, cpu);
    // The head of batch 0's buffers, so the pinned edge rows are readable
    // in a failure message rather than only counted. Batch 0 is the whole
    // cloud in point order when no assetAttr is set, which is where the
    // COLOR_EDGES rows sit.
    const headGpu = Array.from((await readHandle(device, batches[0].colors!)).subarray(0, 32));
    const headCpu = Array.from((cpu[0].colors ?? new Float32Array(0)).subarray(0, 24));
    // Colour must not have moved a TRANSFORM byte: the same graph
    // without colorAttr composes the identical matrices.
    const withColour = await flatTransforms(device, batches);
    const plainRig = spawnRig(geo, {
      ...(assetAttr !== "" ? { assetAttr } : {}),
      ...(chain ? { chain: true } : {}),
    });
    const plainCook = await cook(plainRig.g, { gpu: ev });
    const plainBatches = instancesOf(plainCook).deviceBatches!;
    const withoutColour = await flatTransforms(device, plainBatches);
    let transformsUnmoved = withColour.length === withoutColour.length;
    for (let i = 0; transformsUnmoved && i < withColour.length; i++) {
      transformsUnmoved = Object.is(withColour[i], withoutColour[i]);
    }
    const plainCarriesNoColour = plainBatches.every((b) => b.colors === undefined);

    // Determinism: a second cook of a fresh graph gathers the same bytes.
    const againBatches = instancesOf(
      await cook(
        spawnRig(makeColourSample(count, assetAttr !== ""), {
          colorAttr,
          ...(assetAttr !== "" ? { assetAttr } : {}),
          ...(chain ? { chain: true } : {}),
        }).g,
        { gpu: ev },
      ),
    ).deviceBatches!;
    const first: number[] = [];
    const second: number[] = [];
    for (const b of batches) first.push(...(await readHandle(device, b.colors!)));
    for (const b of againBatches) second.push(...(await readHandle(device, b.colors!)));
    let deterministic = first.length === second.length;
    for (let i = 0; deterministic && i < first.length; i++) {
      deterministic = Object.is(first[i], second[i]);
    }

    // Ownership: two detached buffers per batch while held, none after.
    const holding = {
      detachedBuffers: ev.poolStats.detachedBuffers,
      detachedBytes: ev.poolStats.detachedBytes,
    };
    for (const b of [...batches, ...againBatches, ...plainBatches]) {
      b.transforms.dispose();
      b.colors?.dispose();
    }
    const afterDispose = {
      detachedBuffers: ev.poolStats.detachedBuffers,
      detachedBytes: ev.poolStats.detachedBytes,
      inFlight:
        ev.poolStats.buffersCreated - ev.poolStats.buffersDestroyed - ev.poolStats.pooledBuffers,
    };

    cases.push({
      name,
      colorAttr,
      assetAttr,
      stats: statsOf(cooked),
      batchCount: batches.length,
      cpuShapes: cpu.map((b) => [b.assetId, b.count] as const),
      shapes: batches.map((b) => [b.assetId, b.count] as const),
      colors,
      transformsUnmoved,
      plainCarriesNoColour,
      deterministic,
      holding,
      afterDispose,
      headGpu,
      headCpu,
    });
  }
  ev.dispose();
  return { cases };
}

/**
 * The spawner's per-cook budget, from the device side.
 *
 * The device path does not carry its own copy of the diagnostic: an
 * over-budget spawn is a `PlanFail`, which rejects the resident run, puts
 * every member back on the per-node path, and lets the CPU spawner raise
 * THE message. So the observation that matters is not "it throws" but
 * "it throws the identical string a CPU-only cook throws" — captured here
 * as two whole messages the test compares character for character.
 */
async function budget(
  device: GpuDeviceLike,
  adapterInfo: { vendor?: string },
): Promise<Record<string, unknown>> {
  /** A bare P-only cloud of `n` points (no rot/scale: 12 bytes each). */
  const bareCloud = (n: number): Geometry => {
    const geo = new Geometry();
    const set = geo.attrs.point;
    const P = set.add("P", "f32", 3);
    set.resize(n);
    for (let i = 0; i < n; i++) P.data[i * 3] = i;
    return geo;
  };

  const ev = new GpuFieldEvaluator(device, { adapterInfo, deviceInstances: true });
  const over = bareCloud(MAX_INSTANCES + 1);
  const deviceCook = await cook(spawnRig(over).g, { gpu: ev }).then(
    () => null,
    (e: unknown) => e,
  );
  const cpuCook = await cook(spawnRig(over).g).then(
    () => null,
    (e: unknown) => e,
  );
  // A rejected cook returns no CookStats, so the fallback REASON is
  // pinned device-free in runPlan.test.ts (it must stay the existing
  // "run-plan-failed" — a new reason would be a second way to say the
  // same thing). What is observable here is that nothing was allocated
  // and nothing was stranded on the way out.
  const detachedAfterFailure = {
    detachedBuffers: ev.poolStats.detachedBuffers,
    detachedBytes: ev.poolStats.detachedBytes,
    inFlight:
      ev.poolStats.buffersCreated - ev.poolStats.buffersDestroyed - ev.poolStats.pooledBuffers,
  };

  // The boundary below it fuses and composes for real: 2^20 instances,
  // 64 MiB of transforms retained on the device.
  const atLimit = bareCloud(MAX_INSTANCES);
  const limitCook = await cook(spawnRig(atLimit).g, { gpu: ev });
  const limitItem = instancesOf(limitCook);
  const limitBatches = limitItem.deviceBatches;
  const limitShape = limitBatches?.map((b) => [b.assetId, b.count, b.transforms.byteLength]);
  for (const b of limitBatches ?? []) b.transforms.dispose();
  const afterLimit = {
    detachedBuffers: ev.poolStats.detachedBuffers,
    detachedBytes: ev.poolStats.detachedBytes,
  };
  ev.dispose();

  return {
    max: MAX_INSTANCES,
    deviceMessage: deviceCook instanceof Error ? deviceCook.message : String(deviceCook),
    cpuMessage: cpuCook instanceof Error ? cpuCook.message : String(cpuCook),
    detachedAfterFailure,
    limitStats: statsOf(limitCook),
    limitDeviceResident: limitBatches !== undefined,
    limitShape,
    afterLimit,
  };
}

/** With the opt-in withheld, nothing about the spawner changes. */
async function optInWithheld(
  device: GpuDeviceLike,
  adapterInfo: { vendor?: string },
): Promise<Record<string, unknown>> {
  const count = 256;
  const geo = makeTransformSample(count);
  const cpuOnly = await cook(spawnRig(geo, { chain: true }).g);
  const ev = new GpuFieldEvaluator(device, { adapterInfo }); // no deviceInstances
  const gpuCook = await cook(spawnRig(geo, { chain: true }).g, { gpu: ev });
  const item = instancesOf(gpuCook);
  const parity = measure(
    Array.from(instancesOf(cpuOnly).batches[0].transforms),
    Array.from(item.batches[0].transforms),
  );
  const out = {
    residentTerminals: [...ev.residentTerminals],
    deviceBatchesPresent: item.deviceBatches !== undefined,
    batchCount: item.batches[0].count,
    stats: statsOf(gpuCook),
    parityVsCpuOnly: parity,
    detachedBuffers: ev.poolStats.detachedBuffers,
  };
  ev.dispose();
  return out;
}

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
  const out: Record<string, unknown> = { ok: true };

  out.parity = await kernelParity(structural, adapter.info);
  out.chain = await fusedChain(structural, adapter.info);
  out.ownership = await ownership(structural, adapter.info);
  out.cancellation = await cancellation(structural, adapter.info);
  out.grouping = await assetAttrGrouping(structural, adapter.info);
  out.groupingChain = await assetAttrChain(structural, adapter.info);
  out.colour = await instanceColour(structural, adapter.info);
  out.budget = await budget(structural, adapter.info);
  out.optOut = await optInWithheld(structural, adapter.info);

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
