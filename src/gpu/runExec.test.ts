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
import type { DeviceInstanceBatch, ResidentMemberDesc } from "../fields/index.js";
import { createGpuCookStats } from "../fields/index.js";
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
function speciesCloud(ids: readonly string[]): Geometry {
  const geo = new Geometry();
  const set = geo.attrs.point;
  const P = set.add("P", "f32", 3);
  const rot = set.add("rot", "f32", 4);
  const scale = set.add("scale", "f32", 3);
  const species = set.add("species", "string", 1, "");
  set.resize(ids.length);
  ids.forEach((id, i) => {
    P.setTuple(i, [i, i * 2, i * 3]);
    rot.setTuple(i, [0, 0, 0, 1]);
    scale.setTuple(i, [1, 1, 1]);
    species.setString(i, id);
  });
  return geo;
}

const spawnMember = (params: Record<string, unknown>): ResidentMemberDesc => ({
  id: "spawn",
  type: "spawnInstances",
  kind: "spawnInstances",
  params: { assetId: "tree", assetAttr: "", ...params },
  seed: 99,
});

function planFor(geo: Geometry, params: Record<string, unknown>) {
  const attributes: Record<string, { type: never; tupleSize: number }> = {};
  for (const attr of geo.attrs.point) {
    attributes[attr.name] = { type: attr.type as never, tupleSize: attr.tupleSize };
  }
  const outcome = planResidentRun(
    [spawnMember(params)],
    { attributes, count: geo.attrs.point.count, needsGeometry: false },
    Number.MAX_SAFE_INTEGER,
    false,
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

describe("resident run executor: ownership under failure", () => {
  /** A pool whose `detach` throws on the `failAt`-th call (1-based). */
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
