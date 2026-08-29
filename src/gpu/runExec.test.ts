/**
 * Resident-run EXECUTOR tests for the multi-asset spawner terminal,
 * against a recording fake device — no Dawn, no vitest worker touching a
 * real driver (see deviceRunner.mjs for why that rule exists). What a
 * fake device CAN prove is everything outside the shader: how many output
 * buffers the run allocates and how big each is, what it uploads as the
 * grouping permutation, which `(count, base)` each per-asset dispatch
 * carries and which buffer it writes, how many handles come out, and —
 * the part v0.7's audit cared about — that no failure path strands device
 * memory. The composed matrix VALUES are the device suite's job
 * (instances.device.test.ts).
 */
import { describe, expect, it } from "vitest";
import { Geometry } from "../data/index.js";
import { CookCancelledError } from "../graph/errors.js";
import type {
  DeviceInstanceBatch,
  ResidentMemberDesc,
  ResidentRunContext,
} from "../fields/index.js";
import { createGpuCookStats, deviceInstanceAttributesOf } from "../fields/index.js";
import { buildInstanceBatches } from "../spawn/index.js";
import type {
  GpuBindGroupLike,
  GpuBufferLike,
  GpuCommandBufferLike,
  GpuComputePassLike,
  GpuDeviceLike,
} from "./device.js";
import { BufferPool, type GpuPoolStats } from "./pool.js";
import { executeResidentRun, planResidentRun, type RunExecEnv } from "./run.js";

// ---------------------------------------------------------------------------
// recording fake device

interface FakeBuffer extends GpuBufferLike {
  readonly id: number;
  readonly size: number;
  readonly usage: number;
  readonly bytes: Uint8Array;
  destroys: number;
}

interface DispatchRecord {
  /** Buffer id per binding index, as the bind group saw them. */
  readonly bound: ReadonlyMap<number, FakeBuffer>;
  /** The uniform's {count, seed, chunkOffset, base?} at dispatch time. */
  readonly uniform: readonly number[];
  readonly workgroups: number;
}

interface FakeDevice extends GpuDeviceLike {
  readonly buffers: FakeBuffer[];
  readonly dispatches: DispatchRecord[];
  readonly submits: number[];
  /** Called at `queue.submit`, for injecting mid-run events. */
  onSubmit?: () => void;
}

function fakeDevice(): FakeDevice {
  let nextId = 0;
  const buffers: FakeBuffer[] = [];
  const dispatches: DispatchRecord[] = [];
  const submits: number[] = [];
  // Bind groups are opaque to the executor, so carry the entries on them.
  const groups = new Map<GpuBindGroupLike, ReadonlyMap<number, FakeBuffer>>();
  let current: ReadonlyMap<number, FakeBuffer> | undefined;

  const device: FakeDevice = {
    buffers,
    dispatches,
    submits,
    queue: {
      writeBuffer(buffer, offset, data): void {
        const buf = buffer as FakeBuffer;
        const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        if (offset + src.byteLength > buf.size) {
          throw new Error(`fake device: writeBuffer overruns buffer ${buf.id}`);
        }
        buf.bytes.set(src, offset);
      },
      submit(list): void {
        submits.push(list.length);
        device.onSubmit?.();
      },
    },
    createShaderModule: () => ({ getCompilationInfo: () => Promise.resolve({ messages: [] }) }),
    createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBuffer({ size, usage }): GpuBufferLike {
      const buf: FakeBuffer = {
        id: nextId++,
        size,
        usage,
        bytes: new Uint8Array(size),
        destroys: 0,
        mapAsync: () => Promise.resolve(undefined),
        getMappedRange: (offset = 0, len = size) => buf.bytes.slice(offset, offset + len).buffer,
        unmap() {},
        destroy() {
          buf.destroys++;
        },
      };
      buffers.push(buf);
      return buf;
    },
    createBindGroup({ entries }): GpuBindGroupLike {
      const group = {};
      const map = new Map<number, FakeBuffer>();
      for (const e of entries) {
        map.set(e.binding, (e.resource as { buffer: FakeBuffer }).buffer);
      }
      groups.set(group, map);
      return group;
    },
    createCommandEncoder() {
      const pass: GpuComputePassLike = {
        setPipeline() {},
        setBindGroup(_index, bindGroup): void {
          current = bindGroup === null ? undefined : groups.get(bindGroup);
        },
        dispatchWorkgroups(x): void {
          if (current === undefined) throw new Error("fake device: dispatch with no bind group");
          const uniformBuf = current.get(0);
          if (uniformBuf === undefined) throw new Error("fake device: no uniform at binding 0");
          dispatches.push({
            bound: current,
            uniform: Array.from(
              new Uint32Array(
                uniformBuf.bytes.buffer,
                uniformBuf.bytes.byteOffset,
                Math.floor(uniformBuf.size / 4),
              ),
            ),
            workgroups: x,
          });
        },
        end() {},
      };
      return {
        beginComputePass: () => pass,
        copyBufferToBuffer(): void {},
        finish: (): GpuCommandBufferLike => ({}),
      };
    },
  };
  return device;
}

function envFor(device: FakeDevice, pool: BufferPool): RunExecEnv {
  return {
    device,
    pool,
    maxElementsPerDispatch: undefined,
    getPipeline: () => ({ getBindGroupLayout: () => ({}) }),
  };
}

/** Buffers the pool handed out and has not taken back or detached. */
function inFlight(s: GpuPoolStats): number {
  return s.buffersCreated + s.buffersReused - s.buffersDestroyed - s.pooledBuffers - s.detachedBuffers;
}

// ---------------------------------------------------------------------------
// fixtures

/** Point cloud with P/rot/scale and a "species" string column from `ids`. */
function speciesCloud(ids: readonly string[], withColour = false): Geometry {
  const geo = new Geometry();
  const set = geo.attrs.point;
  const P = set.add("P", "f32", 3);
  const rot = set.add("rot", "f32", 4);
  const scale = set.add("scale", "f32", 3);
  const species = set.add("species", "string", 1, "");
  const color = withColour ? set.add("color", "f32", 4) : undefined;
  set.resize(ids.length);
  ids.forEach((id, i) => {
    P.setTuple(i, [i, i * 2, i * 3]);
    rot.setTuple(i, [0, 0, 0, 1]);
    scale.setTuple(i, [1, 1, 1]);
    species.setString(i, id);
    color?.setTuple(i, [i / 10, 0.25, 0.5, 0.75]);
  });
  return geo;
}

const spawnMember = (params: Record<string, unknown>): ResidentMemberDesc => ({
  id: "spawn",
  type: "spawnInstances",
  kind: "spawnInstances",
  params: { assetId: "tree", assetAttr: "", colorAttr: "", ...params },
  seed: 99,
});

function planFor(geo: Geometry, params: Record<string, unknown>, deviceInstanceAttrs = false) {
  const attributes: Record<string, { type: never; tupleSize: number }> = {};
  for (const attr of geo.attrs.point) {
    attributes[attr.name] = { type: attr.type as never, tupleSize: attr.tupleSize };
  }
  const outcome = planResidentRun(
    [spawnMember(params)],
    { attributes, count: geo.attrs.point.count, needsGeometry: false },
    Number.MAX_SAFE_INTEGER,
    false,
    { deviceInstanceAttrs },
  );
  if (!("plan" in outcome)) throw new Error(`expected a plan, got ${outcome.reason}`);
  return outcome.plan;
}

/**
 * A grouping with three distinct orders in play at once: lexicographic
 * ("a","b","c","tree"), string-table intern order ("", "b","a","c") and
 * the SPEC's first-occurrence order ("b","a","tree","c"). Only the third
 * may come out. Index 3 and 7 are empty, so they merge into "tree".
 */
const MIXED = ["b", "a", "b", "", "a", "c", "b", ""] as const;
const MIXED_ORDER = ["b", "a", "tree", "c"];
const MIXED_COUNTS = [3, 2, 2, 1];
const MIXED_PERM = [0, 2, 6, 1, 4, 3, 7, 5];

// ---------------------------------------------------------------------------

describe("resident run executor: multi-asset spawner", () => {
  it("allocates one output buffer per asset and dispatches once into each", async () => {
    const geo = speciesCloud(MIXED);
    const device = fakeDevice();
    const pool = new BufferPool(device, 1 << 20);
    const stats = createGpuCookStats();
    const plan = planFor(geo, { assetAttr: "species" });

    const result = await executeResidentRun(envFor(device, pool), plan, { geo }, stats);
    const batches = result.deviceBatches as readonly DeviceInstanceBatch[];

    // 1. Batches are the CPU spawner's batches, in its order.
    const cpu = buildInstanceBatches(geo, { defaultAssetId: "tree", assetAttr: "species" });
    expect(batches.map((b) => b.assetId)).toEqual(MIXED_ORDER);
    expect(batches.map((b) => b.count)).toEqual(MIXED_COUNTS);
    expect(batches.map((b) => [b.assetId, b.count])).toEqual(cpu.map((b) => [b.assetId, b.count]));
    expect(batches.every((b) => b.residency === "device")).toBe(true);

    // 2. One handle per batch, each sized for ITS batch (not the run).
    expect(batches.map((b) => b.transforms.byteLength)).toEqual(MIXED_COUNTS.map((n) => n * 64));
    expect(new Set(batches.map((b) => b.transforms)).size).toBe(4);

    // 3. Four dispatches, one per asset, each with its own (count, base)
    //    and its own output buffer at the transforms binding.
    expect(device.dispatches).toHaveLength(4);
    expect(stats.dispatches).toBe(4);
    const permBuf = device.dispatches[0].bound.get(5);
    expect(permBuf).toBeDefined();
    device.dispatches.forEach((d, j) => {
      expect(d.uniform[0], `batch ${j} element count`).toBe(MIXED_COUNTS[j]);
      expect(d.uniform[2], `batch ${j} chunkOffset`).toBe(0);
      expect(d.bound.get(5), `batch ${j} perm`).toBe(permBuf); // one shared perm
      expect(d.workgroups).toBe(1);
    });

    // 4. The permutation was uploaded verbatim (the pool buckets the
    //    allocation up, so read exactly the live prefix).
    expect(Array.from(new Uint32Array(permBuf!.bytes.buffer, 0, 8))).toEqual(MIXED_PERM);
    // Bases are the exclusive prefix sum, and the four output buffers are
    // four DISTINCT buffers written once each.
    expect(device.dispatches.map((d) => d.uniform[3])).toEqual([0, 3, 5, 7]);
    const outs = device.dispatches.map((d) => d.bound.get(4)!);
    expect(new Set(outs).size).toBe(4);
    expect(outs.map((b) => b.size)).toEqual(MIXED_COUNTS.map((n) => Math.max(256, 2 ** Math.ceil(Math.log2(n * 64)))));

    // 5. One submit, and the pool handed out exactly four buffers it
    //    never got back — the four the caller now owns.
    expect(device.submits).toEqual([1]);
    expect(pool.stats.detachedBuffers).toBe(4);
    expect(inFlight(pool.stats)).toBe(0);
    for (const b of batches) b.transforms.dispose();
    expect(pool.stats).toMatchObject({ detachedBuffers: 0, detachedBytes: 0 });
    expect(device.buffers.every((b) => b.destroys <= 1)).toBe(true);
  });

  it("a single-asset column still yields one batch, and no asset is dropped", async () => {
    // The N=1 boundary: it must behave like the constant path in shape
    // while still going through the permutation machinery.
    const geo = speciesCloud(["pine", "pine", "pine"]);
    const device = fakeDevice();
    const pool = new BufferPool(device, 1 << 20);
    const result = await executeResidentRun(
      envFor(device, pool),
      planFor(geo, { assetAttr: "species" }),
      { geo },
      undefined,
    );
    const batches = result.deviceBatches!;
    expect(batches.map((b) => [b.assetId, b.count])).toEqual([["pine", 3]]);
    expect(device.dispatches).toHaveLength(1);
    expect(device.dispatches[0].uniform.slice(0, 4)).toEqual([3, 0, 0, 0]);
    for (const b of batches) b.transforms.dispose();
  });

  it("constant mode is untouched: one buffer, one dispatch, no permutation upload", async () => {
    const geo = speciesCloud(MIXED);
    const device = fakeDevice();
    const pool = new BufferPool(device, 1 << 20);
    const stats = createGpuCookStats();
    const result = await executeResidentRun(
      envFor(device, pool),
      planFor(geo, {}),
      { geo },
      stats,
    );
    const batches = result.deviceBatches!;
    expect(batches.map((b) => [b.assetId, b.count])).toEqual([["tree", 8]]);
    expect(stats.dispatches).toBe(1);
    expect(device.dispatches).toHaveLength(1);
    // The v0.7 uniform: {count, seed, chunkOffset}, no perm binding. The
    // fourth word is never written here (the pool's bucket is larger than
    // the 12-byte struct, so anything past it is not the kernel's).
    expect(device.dispatches[0].uniform.slice(0, 3)).toEqual([8, 0, 0]);
    expect(device.dispatches[0].bound.has(5)).toBe(false);
    expect(pool.stats.detachedBuffers).toBe(1);
    batches[0].transforms.dispose();
    expect(pool.stats.detachedBuffers).toBe(0);
  });

  it("chunking partitions each batch's range, not the run's", async () => {
    // A batch LARGER than one chunk is the case that separates the three
    // indices: `chunkOffset` walks within the batch and restarts at 0 for
    // every batch, `count` is the batch size (so the kernel's bounds
    // check clamps inside the batch), and `base` indexes the permutation
    // and is chunk-invariant. `chunkCapacity` floors to the workgroup
    // size, so 64 is the smallest chunk obtainable — batch A must exceed
    // it to be chunked at all.
    const ids = [...Array<string>(150).fill("a"), ...Array<string>(40).fill("b")];
    const geo = speciesCloud(ids);
    const device = fakeDevice();
    const pool = new BufferPool(device, 1 << 20);
    const stats = createGpuCookStats();
    const env: RunExecEnv = { ...envFor(device, pool), maxElementsPerDispatch: 64 };
    const result = await executeResidentRun(env, planFor(geo, { assetAttr: "species" }), { geo }, stats);

    // Batch "a" spans three chunks, batch "b" one. chunkOffset restarts;
    // base does not move within a batch and jumps to 150 for the next.
    expect(device.dispatches.map((d) => [d.uniform[0], d.uniform[2], d.uniform[3]])).toEqual([
      [150, 0, 0],
      [150, 64, 0],
      [150, 128, 0],
      [40, 0, 150],
    ]);
    // Workgroups cover 64 + 64 + 22 = 150 and 40: the chunks partition
    // each batch exactly, with no lane straying past its batch.
    expect(device.dispatches.map((d) => d.workgroups)).toEqual([1, 1, 1, 1]);
    // ...and chunking still does not multiply the dispatch counter: two
    // assets, two counted dispatches, four encoded chunks.
    expect(stats.dispatches).toBe(2);
    expect(result.deviceBatches!.map((b) => [b.assetId, b.count])).toEqual([
      ["a", 150],
      ["b", 40],
    ]);
    for (const b of result.deviceBatches!) b.transforms.dispose();
  });
});

describe("resident run executor: instance colour", () => {
  it("acquires a second buffer per batch, sized at 16 bytes per instance", async () => {
    const geo = speciesCloud(MIXED, true);
    const device = fakeDevice();
    const pool = new BufferPool(device, 1 << 20);
    const stats = createGpuCookStats();
    const plan = planFor(geo, { assetAttr: "species", colorAttr: "color" });

    const result = await executeResidentRun(envFor(device, pool), plan, { geo }, stats);
    const batches = result.deviceBatches as readonly DeviceInstanceBatch[];

    expect(batches.map((b) => [b.assetId, b.count])).toEqual(
      MIXED_ORDER.map((a, j) => [a, MIXED_COUNTS[j]]),
    );
    // 16 per instance, not 12. The handle reports the LOGICAL length, so
    // this is the producer's claim about the layout, not the pool's
    // bucket size.
    expect(batches.map((b) => b.colors?.byteLength)).toEqual(MIXED_COUNTS.map((n) => n * 16));
    // Distinct buffers, distinct handles: eight in total for four
    // batches, none aliased.
    expect(new Set(batches.map((b) => b.colors)).size).toBe(4);
    expect(new Set([...batches.map((b) => b.transforms), ...batches.map((b) => b.colors)]).size).toBe(8);

    // Still ONE dispatch per asset — colour rides the compose kernel
    // rather than adding a pass of its own.
    expect(device.dispatches).toHaveLength(4);
    expect(stats.dispatches).toBe(4);
    // Binding order in indexed mode: 1 P, 2 rot, 3 scale, 4 transforms,
    // 5 perm, then 6 the colour SOURCE (one shared slot buffer) and 7
    // this batch's colour OUT. Colour is declared last precisely so
    // every earlier binding index is where it always was.
    const source = device.dispatches[0].bound.get(6);
    expect(source).toBeDefined();
    const colourOuts = device.dispatches.map((d) => d.bound.get(7)!);
    device.dispatches.forEach((d, j) => {
      expect(d.bound.get(6), `batch ${j} colour source`).toBe(source);
      // The colour out must NOT be the transforms out.
      expect(colourOuts[j], `batch ${j}`).not.toBe(d.bound.get(4));
    });
    expect(new Set(colourOuts).size).toBe(4);
    expect(colourOuts.map((b) => b.size)).toEqual(
      MIXED_COUNTS.map((n) => Math.max(256, 2 ** Math.ceil(Math.log2(n * 16)))),
    );

    // Eight buffers left the pool, and eight disposes bring it to zero.
    expect(pool.stats.detachedBuffers).toBe(8);
    expect(inFlight(pool.stats)).toBe(0);
    for (const b of batches) {
      b.transforms.dispose();
      b.colors!.dispose();
    }
    expect(pool.stats).toMatchObject({ detachedBuffers: 0, detachedBytes: 0 });
    expect(device.buffers.every((b) => b.destroys <= 1)).toBe(true);
  });

  it("carries no colour handle at all when colorAttr is empty", async () => {
    // Absent, not present-and-empty: the renderer then leaves its
    // instance-colour channel untouched instead of binding a zero buffer.
    const geo = speciesCloud(MIXED, true);
    const device = fakeDevice();
    const pool = new BufferPool(device, 1 << 20);
    const result = await executeResidentRun(
      envFor(device, pool),
      planFor(geo, { assetAttr: "species" }),
      { geo },
      undefined,
    );
    const batches = result.deviceBatches!;
    expect(batches.every((b) => b.colors === undefined)).toBe(true);
    expect(pool.stats.detachedBuffers).toBe(4); // transforms only
    // The colour column exists on the geometry and is still never bound:
    // the indexed kernel stops at binding 5 (perm).
    expect(device.dispatches.every((d) => !d.bound.has(6))).toBe(true);
    for (const b of batches) b.transforms.dispose();
  });

  it("the constant-assetId path carries colour too, with no permutation", async () => {
    const geo = speciesCloud(MIXED, true);
    const device = fakeDevice();
    const pool = new BufferPool(device, 1 << 20);
    const result = await executeResidentRun(
      envFor(device, pool),
      planFor(geo, { colorAttr: "color" }),
      { geo },
      undefined,
    );
    const batches = result.deviceBatches!;
    expect(batches.map((b) => [b.assetId, b.count])).toEqual([["tree", 8]]);
    expect(batches[0].colors?.byteLength).toBe(8 * 16);
    expect(device.dispatches).toHaveLength(1);
    // No permutation, so the colour bindings sit one lower than in the
    // indexed case: 5 is the source and 6 the out, with nothing between.
    // Same evidence, different offsets — which is why the planner maps
    // bindings by ROLE and never by position.
    expect(device.dispatches[0].bound.get(5)).toBeDefined();
    expect(device.dispatches[0].bound.get(6)).toBeDefined();
    expect(device.dispatches[0].bound.get(7)).toBeUndefined();
    expect(device.dispatches[0].bound.get(6)).not.toBe(device.dispatches[0].bound.get(4));
    expect(device.dispatches[0].uniform.slice(0, 3)).toEqual([8, 0, 0]);
    expect(pool.stats.detachedBuffers).toBe(2);
    batches[0].transforms.dispose();
    batches[0].colors!.dispose();
    expect(pool.stats.detachedBuffers).toBe(0);
  });
});

/**
 * A pool whose `detach` throws on the `failAt`-th call (1-based). At
 * module scope because both the transform/colour ownership suite and the
 * channel one need it, and a second copy is a second thing to drift.
 */
class FlakyPool extends BufferPool {
  private calls = 0;
  constructor(
    device: GpuDeviceLike,
    maxBytes: number,
    private readonly failAt: number,
  ) {
    super(device, maxBytes);
  }
  override detach(buf: GpuBufferLike): ReturnType<BufferPool["detach"]> {
    this.calls++;
    if (this.calls === this.failAt) throw new Error("simulated detach failure");
    return super.detach(buf);
  }
}

describe("resident run executor: ownership under failure", () => {
  it("a partial build disposes what it detached, exactly once, and strands nothing", async () => {
    const geo = speciesCloud(MIXED);
    const device = fakeDevice();
    // Four batches; blow up on the third detach with two handles built.
    const pool = new FlakyPool(device, 1 << 20, 3);
    await expect(
      executeResidentRun(envFor(device, pool), planFor(geo, { assetAttr: "species" }), { geo }, undefined),
    ).rejects.toThrow(/simulated detach failure/);

    // The two handles built were disposed by the catch; the two buffers
    // never detached went back to the pool by the finally. Nothing is
    // outstanding either way.
    expect(pool.stats.buffersDetached).toBe(2);
    expect(pool.stats).toMatchObject({ detachedBuffers: 0, detachedBytes: 0 });
    expect(inFlight(pool.stats)).toBe(0);
    // Exactly once: a double dispose would show up as destroys === 2.
    expect(device.buffers.map((b) => b.destroys).filter((n) => n > 1)).toEqual([]);
    expect(device.buffers.filter((b) => b.destroys === 1)).toHaveLength(2);
  });

  it("a colour detach failure mid-batch disposes both kinds, exactly once each", async () => {
    // With colour the detach order interleaves — T0, C0, T1, C1, T2, ...
    // — so a failure on the SIXTH call blows up midway through batch 2,
    // with its transforms handle already built and its colour handle not.
    // That handle must be freed by the catch like any other; missing it
    // would leak the one buffer nobody else can reach.
    const geo = speciesCloud(MIXED, true);
    const device = fakeDevice();
    const pool = new FlakyPool(device, 1 << 20, 6);
    await expect(
      executeResidentRun(
        envFor(device, pool),
        planFor(geo, { assetAttr: "species", colorAttr: "color" }),
        { geo },
        undefined,
      ),
    ).rejects.toThrow(/simulated detach failure/);
    expect(pool.stats.buffersDetached).toBe(5);
    expect(pool.stats).toMatchObject({ detachedBuffers: 0, detachedBytes: 0 });
    expect(inFlight(pool.stats)).toBe(0);
    expect(device.buffers.map((b) => b.destroys).filter((n) => n > 1)).toEqual([]);
    expect(device.buffers.filter((b) => b.destroys === 1)).toHaveLength(5);
  });

  it("failing on the FIRST detach leaves every buffer to the pool", async () => {
    const geo = speciesCloud(MIXED);
    const device = fakeDevice();
    const pool = new FlakyPool(device, 1 << 20, 1);
    await expect(
      executeResidentRun(envFor(device, pool), planFor(geo, { assetAttr: "species" }), { geo }, undefined),
    ).rejects.toThrow(/simulated detach failure/);
    expect(pool.stats.buffersDetached).toBe(0);
    expect(inFlight(pool.stats)).toBe(0);
    expect(device.buffers.every((b) => b.destroys === 0)).toBe(true);
  });

  it("a cancellation between submit and the transfer detaches nothing", async () => {
    // The detach loop must sit AFTER the last checkCancelled(): abort at
    // submit time and no buffer may leave the pool.
    const geo = speciesCloud(MIXED);
    const device = fakeDevice();
    const pool = new BufferPool(device, 1 << 20);
    const ctrl = new AbortController();
    device.onSubmit = () => ctrl.abort();
    await expect(
      executeResidentRun(
        envFor(device, pool),
        planFor(geo, { assetAttr: "species" }),
        { geo, signal: ctrl.signal },
        undefined,
      ),
    ).rejects.toBeInstanceOf(CookCancelledError);
    expect(device.submits).toEqual([1]); // it really did get that far
    expect(pool.stats.buffersDetached).toBe(0);
    expect(pool.stats.detachedBuffers).toBe(0);
    expect(inFlight(pool.stats)).toBe(0);
  });

  it("a pre-aborted cook releases everything it acquired", async () => {
    const geo = speciesCloud(MIXED);
    const device = fakeDevice();
    const pool = new BufferPool(device, 1 << 20);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      executeResidentRun(
        envFor(device, pool),
        planFor(geo, { assetAttr: "species" }),
        { geo, signal: ctrl.signal },
        undefined,
      ),
    ).rejects.toBeInstanceOf(CookCancelledError);
    expect(device.dispatches).toHaveLength(0);
    expect(pool.stats.buffersCreated).toBeGreaterThan(0);
    expect(inFlight(pool.stats)).toBe(0);
    expect(pool.stats.detachedBuffers).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Named per-instance channels (opt-in). A fake device cannot run the
// gather shader, so the bit-exactness case below is built the only honest
// way without one: everything that could be wrong OUTSIDE the four copy
// lines — which buffer each dispatch binds, the permutation that was
// uploaded, the (count, base) each per-batch dispatch carries, the stride
// each buffer was sized for — is taken from what the executor ACTUALLY
// did, and only the copy itself is modelled. That model is exactly the
// kernel text `runPlan.test.ts` pins verbatim ("the gather kernel is a raw
// WORD copy"), so the pair covers the whole path. The device suite
// re-derives it against a real adapter.

/** Point cloud carrying one channel column per dtype and tuple size. */
function channelCloud(ids: readonly string[]): Geometry {
  const geo = speciesCloud(ids);
  const set = geo.attrs.point;
  const plantId = set.add("plantId", "u32", 1);
  const phase = set.add("phase", "f32", 2);
  const tint = set.add("tint", "f32", 3);
  const offset = set.add("offset", "i32", 4);
  const flag = set.add("flag", "bool", 1);
  for (let i = 0; i < ids.length; i++) {
    // Values chosen so a wrong stride or a wrong source index cannot
    // coincide with the right one: every component of every point differs.
    plantId.setTuple(i, [0xdead_0000 + i]); // past 2^24, so f32 would lose it
    phase.setTuple(i, [i + 0.125, -(i + 0.25)]);
    tint.setTuple(i, [i / 8, 1 - i / 8, 0.5 + i / 32]);
    offset.setTuple(i, [-i, i * 7, -(i * 11), i * 13]);
    flag.setTuple(i, [i % 2]);
  }
  return geo;
}

/** The channel-carrying shapes `channelCloud` writes, in one place. */
const CHANNEL_SHAPES = [
  { name: "plantId", type: "u32", itemSize: 1, components: 1 },
  { name: "phase", type: "f32", itemSize: 2, components: 2 },
  { name: "tint", type: "f32", itemSize: 3, components: 4 },
  { name: "offset", type: "i32", itemSize: 4, components: 4 },
  { name: "flag", type: "bool", itemSize: 1, components: 1 },
] as const;

const CHANNEL_NAMES = CHANNEL_SHAPES.map((c) => c.name);

/** Words a device channel buffer spends per batch of `n` instances. */
const channelBytes = (n: number, components: number): number => n * components * 4;

describe("resident run executor: named per-instance channels", () => {
  it("acquires one buffer per channel per batch and dispatches one kernel into each", async () => {
    const geo = channelCloud(MIXED);
    const device = fakeDevice();
    const pool = new BufferPool(device, 1 << 22);
    const stats = createGpuCookStats();
    const plan = planFor(geo, { assetAttr: "species", instanceAttrs: [...CHANNEL_NAMES] }, true);

    const result = await executeResidentRun(envFor(device, pool), plan, { geo }, stats);
    const batches = result.deviceBatches as readonly DeviceInstanceBatch[];

    // The batches are still the CPU spawner's, in its order: channels
    // ride the grouping, they do not change it.
    expect(batches.map((b) => [b.assetId, b.count])).toEqual(
      MIXED_ORDER.map((a, j) => [a, MIXED_COUNTS[j]]),
    );

    // One handle per channel per batch, each declaring the AUTHOR's dtype
    // and item size and sized at the buffer's PADDED stride.
    batches.forEach((b, j) => {
      const attrs = deviceInstanceAttributesOf(b);
      expect(Object.keys(attrs), `batch ${j} channel names`).toEqual([...CHANNEL_NAMES]);
      for (const shape of CHANNEL_SHAPES) {
        const ch = attrs[shape.name];
        expect([ch.type, ch.itemSize], `batch ${j} ${shape.name}`).toEqual([
          shape.type,
          shape.itemSize,
        ]);
        expect(ch.handle.byteLength, `batch ${j} ${shape.name} bytes`).toBe(
          channelBytes(MIXED_COUNTS[j], shape.components),
        );
      }
    });
    // 4 batches x 5 channels = 20 distinct handles, plus 4 transforms.
    const handles = batches.flatMap((b) => [
      b.transforms,
      ...Object.values(deviceInstanceAttributesOf(b)).map((c) => c.handle),
    ]);
    expect(handles).toHaveLength(24);
    expect(new Set(handles).size).toBe(24);
    // No colour was asked for, so there is none — a channel record does
    // not conjure the reserved entry.
    expect(batches.every((b) => b.colors === undefined)).toBe(true);

    // Dispatches: compose once per batch, then each gather once per
    // batch. Chunking never multiplies the counter, but these are genuinely
    // distinct kernels over distinct ranges.
    expect(device.dispatches).toHaveLength(4 * 6);
    expect(stats.dispatches).toBe(4 * 6);
    // Every gather binds three buffers: source (shared across batches),
    // its own output, and the ONE uploaded permutation the compose read.
    const composePerm = device.dispatches[0].bound.get(5)!;
    const gathers = device.dispatches.slice(4); // the compose's four come first
    expect(gathers).toHaveLength(20);
    for (const d of gathers) {
      expect(d.bound.size).toBe(4); // uniform + src + out + perm
      expect(d.bound.get(3)).toBe(composePerm);
    }
    // Each channel's source buffer is one slot buffer shared by all four
    // of its dispatches; each output is that batch's own.
    CHANNEL_SHAPES.forEach((shape, ci) => {
      const mine = gathers.filter((_, k) => Math.floor(k / 4) === ci);
      expect(new Set(mine.map((d) => d.bound.get(1))).size, `${shape.name} source`).toBe(1);
      expect(new Set(mine.map((d) => d.bound.get(2))).size, `${shape.name} out`).toBe(4);
      mine.forEach((d, j) => {
        expect(d.uniform[0], `${shape.name} batch ${j} count`).toBe(MIXED_COUNTS[j]);
        // The same `base` the compose kernel used for that batch: one
        // permutation, one slice, so matrix and channel agree on the point.
        expect(d.uniform[3], `${shape.name} batch ${j} base`).toBe(
          device.dispatches[j].uniform[3],
        );
      });
    });

    // 24 buffers left the pool and 24 disposes bring it back to zero.
    expect(pool.stats.detachedBuffers).toBe(24);
    expect(inFlight(pool.stats)).toBe(0);
    for (const h of handles) h.dispose();
    expect(pool.stats).toMatchObject({ detachedBuffers: 0, detachedBytes: 0 });
    // Exactly once each: a double release would show as destroys === 2.
    expect(device.buffers.map((b) => b.destroys).filter((n) => n > 1)).toEqual([]);
    // ...and a second dispose is a no-op, not a second free.
    for (const h of handles) h.dispose();
    expect(device.buffers.map((b) => b.destroys).filter((n) => n > 1)).toEqual([]);
  });

  it("gathers exactly the bytes the CPU spawner would, per dtype and item size", async () => {
    // The reference is `buildInstanceBatches`. A channel is a GATHER, so
    // there is no tolerance class to spend here: every word must match.
    const geo = channelCloud(MIXED);
    const device = fakeDevice();
    const pool = new BufferPool(device, 1 << 22);
    const plan = planFor(geo, { assetAttr: "species", instanceAttrs: [...CHANNEL_NAMES] }, true);
    const result = await executeResidentRun(envFor(device, pool), plan, { geo }, undefined);
    const batches = result.deviceBatches!;
    const cpu = buildInstanceBatches(geo, {
      defaultAssetId: "tree",
      assetAttr: "species",
      instanceAttrs: [...CHANNEL_NAMES],
    });

    // The permutation the executor really uploaded, read back off the
    // device — not the test's idea of one.
    const permBuf = device.dispatches[0].bound.get(5)!;
    const perm = new Uint32Array(permBuf.bytes.buffer, permBuf.bytes.byteOffset, MIXED.length);

    expect(batches.map((b) => b.assetId)).toEqual(cpu.map((b) => b.assetId));
    batches.forEach((batch, j) => {
      const base = device.dispatches[j].uniform[3];
      const attrs = deviceInstanceAttributesOf(batch);
      for (const shape of CHANNEL_SHAPES) {
        // What the CPU batch holds for this channel, as raw words. bool
        // is the one dtype whose CPU column is bytes (Uint8Array) and
        // whose device buffer is u32 words — the documented widening, not
        // a value change, so compare the values it carries.
        const cpuCol = cpu[j].attributes![shape.name];
        // The kernel, modelled: out[i * components + c] = src[perm[base + i] * itemSize + c],
        // with the pad slot written as an explicit zero. Sourced from the
        // POINT column so a wrong permutation cannot be hidden by reading
        // the CPU batch instead.
        const src = geo.attrs.point.require(shape.name).data;
        const expected = new Uint32Array(batch.count * shape.components);
        const srcWords =
          src instanceof Uint8Array
            ? Uint32Array.from(src) // the bool widening the slot upload does
            : new Uint32Array(src.buffer, src.byteOffset, src.length);
        for (let i = 0; i < batch.count; i++) {
          const p = perm[base + i];
          for (let c = 0; c < shape.itemSize; c++) {
            expected[i * shape.components + c] = srcWords[p * shape.itemSize + c];
          }
        }
        // 1. The modelled gather agrees with the CPU spawner's own copy,
        //    word for word, which is what makes it a valid model.
        const cpuWords =
          cpuCol instanceof Uint8Array
            ? Uint32Array.from(cpuCol)
            : new Uint32Array(cpuCol.buffer, cpuCol.byteOffset, cpuCol.length);
        for (let i = 0; i < batch.count; i++) {
          for (let c = 0; c < shape.itemSize; c++) {
            expect(
              expected[i * shape.components + c],
              `batch ${j} ${shape.name}[${i}].${c}`,
            ).toBe(cpuWords[i * shape.itemSize + c]);
          }
        }
        // 2. The device buffer the executor handed out is sized for
        //    exactly those words — a stride the model and the allocation
        //    have to agree on or the comparison above proves nothing. It
        //    is also where the two residencies legitimately differ: the
        //    padded channel spends a third more bytes here than the CPU
        //    column packs, and the bool one spends four times as many.
        expect(attrs[shape.name].handle.byteLength, `${shape.name} bytes`).toBe(expected.byteLength);
        const cpuBytes = shape.name === "flag" ? cpuCol.length : cpuCol.byteLength;
        expect(expected.byteLength >= cpuBytes, `${shape.name} device >= cpu`).toBe(true);
        expect(expected.byteLength).toBe(batch.count * shape.components * 4);
      }
    });
    // A u32 id past 2^24 is the reason the dtype is never widened: it must
    // survive the round trip identically on both paths.
    expect(cpu[0].attributes!.plantId[0]).toBeGreaterThan(0xff_ffff);
    for (const b of batches) {
      b.transforms.dispose();
      for (const ch of Object.values(deviceInstanceAttributesOf(b))) ch.handle.dispose();
    }
  });

  it("carries colour and channels side by side, one handle each", async () => {
    const geo = channelCloud(MIXED);
    geo.attrs.point.add("color", "f32", 3);
    const device = fakeDevice();
    const pool = new BufferPool(device, 1 << 22);
    const result = await executeResidentRun(
      envFor(device, pool),
      planFor(geo, { colorAttr: "color", instanceAttrs: ["plantId", "tint"] }, true),
      { geo },
      undefined,
    );
    const batch = result.deviceBatches![0];
    const attrs = deviceInstanceAttributesOf(batch);
    // Colour is the RESERVED entry, first, with the channels after it —
    // and `batch.colors` is the accessor over that same handle, so an
    // owner looping this record disposes each buffer exactly once.
    expect(Object.keys(attrs)).toEqual(["color", "plantId", "tint"]);
    expect(batch.colors).toBe(attrs.color.handle);
    expect(attrs.color.itemSize).toBe(3);
    expect(attrs.color.handle.byteLength).toBe(8 * 16);
    expect(attrs.plantId.handle.byteLength).toBe(8 * 4);
    expect(attrs.tint.handle.byteLength).toBe(8 * 16);
    // 1 transforms + 1 colour + 2 channels.
    expect(pool.stats.detachedBuffers).toBe(4);
    batch.transforms.dispose();
    for (const ch of Object.values(attrs)) ch.handle.dispose();
    expect(pool.stats).toMatchObject({ detachedBuffers: 0, detachedBytes: 0 });
    expect(device.buffers.map((b) => b.destroys).filter((n) => n > 1)).toEqual([]);
  });

  it("without the opt-in there is no plan at all, so nothing changes", async () => {
    // The regression guard, stated at the seam that matters: the same
    // spawn planned WITHOUT the flag never reaches the executor, so a
    // host rendering CPU batches today keeps rendering them.
    const geo = channelCloud(MIXED);
    expect(() => planFor(geo, { instanceAttrs: ["plantId"] })).toThrow(/run-plan-failed/);
    // ...and a channel-less spawn is untouched by the flag being on.
    const device = fakeDevice();
    const pool = new BufferPool(device, 1 << 22);
    const result = await executeResidentRun(
      envFor(device, pool),
      planFor(geo, {}, true),
      { geo },
      undefined,
    );
    const batch = result.deviceBatches![0];
    expect(batch.attributes).toBeUndefined();
    expect(batch.colors).toBeUndefined();
    expect(pool.stats.detachedBuffers).toBe(1);
    batch.transforms.dispose();
  });

  it("a channel named __proto__ arrives as an own key, not a lost handle", async () => {
    // A channel is named after a point attribute, and an attribute is
    // named by the graph's JSON — `__proto__` included, which an
    // AttributeSet stores like any other name. On an ordinary object
    // literal `record["__proto__"] = h` sets the PROTOTYPE and adds no
    // own key, so the handle would be invisible to
    // `deviceInstanceAttributesOf` (it tests propertyIsEnumerable) and
    // therefore to every owner counting handles to dispose: a leaked GPU
    // buffer, which is the failure mode this whole path guards. The
    // executor builds the record with a null prototype for exactly this.
    // Verified by mutation: swap `Object.create(null)` for `{}` in run.ts
    // and the channel vanishes from the batch and its buffer never frees.
    const geo = speciesCloud(["a", "a"]);
    const weird = geo.attrs.point.add("__proto__", "u32", 1);
    weird.setTuple(0, [11]);
    weird.setTuple(1, [22]);
    // Object.fromEntries defines own properties, so the layout the
    // planner is handed really does carry the name. Note what that
    // implies and do not overclaim it: a COOK cannot reach this today,
    // because `narrowRun` in src/graph/execute.ts builds ctx.attributes
    // as an object literal and drops `__proto__` one seam earlier, so
    // the planner rejects the channel as "not on the point domain". This
    // test therefore pins the executor's own guard as defence in depth —
    // correct if that seam is fixed, and free either way.
    const attributes = Object.fromEntries(
      geo.attrs.point.names().map((n) => {
        const a = geo.attrs.point.require(n);
        return [n, { type: a.type, tupleSize: a.tupleSize }];
      }),
    ) as ResidentRunContext["attributes"];
    const outcome = planResidentRun(
      [spawnMember({ instanceAttrs: ["__proto__"] })],
      { attributes, count: 2, needsGeometry: false },
      Number.MAX_SAFE_INTEGER,
      false,
      { deviceInstanceAttrs: true },
    );
    if (!("plan" in outcome)) throw new Error(`expected a plan, got ${outcome.reason}`);

    const device = fakeDevice();
    const pool = new BufferPool(device, 1 << 20);
    const result = await executeResidentRun(envFor(device, pool), outcome.plan, { geo }, undefined);
    const batch = result.deviceBatches![0];
    const attrs = deviceInstanceAttributesOf(batch);
    expect(Object.keys(attrs)).toEqual(["__proto__"]);
    expect(Object.prototype.propertyIsEnumerable.call(attrs, "__proto__")).toBe(true);
    expect(attrs["__proto__"].handle.byteLength).toBe(2 * 4);
    // Disposing what the enumeration yields really does free everything:
    // the whole point of the channel being reachable is that it is
    // reachable to its OWNER.
    expect(pool.stats.detachedBuffers).toBe(2);
    batch.transforms.dispose();
    for (const ch of Object.values(attrs)) ch.handle.dispose();
    expect(pool.stats).toMatchObject({ detachedBuffers: 0, detachedBytes: 0 });
  });

  it("a detach failure partway through a batch's channels strands nothing", async () => {
    // Detach order within a batch is transforms, colour, then each
    // channel in plan order. Failing on the fourth call blows up inside
    // batch 0's channels with three handles built: they must be freed by
    // the catch, exactly once each, and the rest left to the pool.
    const geo = channelCloud(MIXED);
    geo.attrs.point.add("color", "f32", 3);
    const device = fakeDevice();
    const pool = new FlakyPool(device, 1 << 22, 4);
    await expect(
      executeResidentRun(
        envFor(device, pool),
        planFor(geo, { assetAttr: "species", colorAttr: "color", instanceAttrs: ["plantId", "tint"] }, true),
        { geo },
        undefined,
      ),
    ).rejects.toThrow(/simulated detach failure/);
    expect(pool.stats.buffersDetached).toBe(3);
    expect(pool.stats).toMatchObject({ detachedBuffers: 0, detachedBytes: 0 });
    expect(inFlight(pool.stats)).toBe(0);
    expect(device.buffers.map((b) => b.destroys).filter((n) => n > 1)).toEqual([]);
    expect(device.buffers.filter((b) => b.destroys === 1)).toHaveLength(3);
  });

  it("a cancellation before the transfer detaches no channel buffer either", async () => {
    const geo = channelCloud(MIXED);
    const device = fakeDevice();
    const pool = new BufferPool(device, 1 << 22);
    const ctrl = new AbortController();
    device.onSubmit = () => ctrl.abort();
    await expect(
      executeResidentRun(
        envFor(device, pool),
        planFor(geo, { assetAttr: "species", instanceAttrs: [...CHANNEL_NAMES] }, true),
        { geo, signal: ctrl.signal },
        undefined,
      ),
    ).rejects.toBeInstanceOf(CookCancelledError);
    expect(pool.stats.buffersDetached).toBe(0);
    expect(pool.stats.detachedBuffers).toBe(0);
    expect(inFlight(pool.stats)).toBe(0);
    expect(device.buffers.every((b) => b.destroys === 0)).toBe(true);
  });
});
