/**
 * BufferPool unit tests (CPU-only, run everywhere): bucketing, reuse by
 * (usage, bucket), the retained-byte bound, stats, and dispose — over a
 * fake device that records created/destroyed buffers. Device-visible
 * reuse safety is proven in pervasive.device.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { GpuBufferLike, GpuDeviceLike } from "./device.js";
import { BufferPool, bucketBytes } from "./pool.js";

interface FakeBuffer extends GpuBufferLike {
  readonly size: number;
  readonly usage: number;
  destroyed: boolean;
}

function fakeDevice(): { device: GpuDeviceLike; created: FakeBuffer[] } {
  const created: FakeBuffer[] = [];
  const boom = (): never => {
    throw new Error("pool tests only touch createBuffer");
  };
  const device: GpuDeviceLike = {
    queue: { writeBuffer: boom, submit: boom },
    createShaderModule: boom,
    createComputePipeline: boom,
    createBuffer: ({ size, usage }) => {
      const buf: FakeBuffer = {
        size,
        usage,
        destroyed: false,
        mapAsync: boom,
        getMappedRange: boom,
        unmap: boom,
        destroy() {
          buf.destroyed = true;
        },
      };
      created.push(buf);
      return buf;
    },
    createBindGroup: boom,
    createCommandEncoder: boom,
  };
  return { device, created };
}

describe("bucketBytes", () => {
  it("rounds up to the next power of two with a 256-byte floor", () => {
    expect(bucketBytes(1)).toBe(256);
    expect(bucketBytes(256)).toBe(256);
    expect(bucketBytes(257)).toBe(512);
    expect(bucketBytes(40_000)).toBe(65_536);
    expect(bucketBytes(65_536)).toBe(65_536);
    expect(bucketBytes(17_200_000)).toBe(33_554_432);
  });
});

describe("BufferPool", () => {
  it("creates at bucket size and reuses by (usage, bucket)", () => {
    const { device, created } = fakeDevice();
    const pool = new BufferPool(device, 1 << 20);
    const a = pool.acquire(40_000, 0x80) as FakeBuffer;
    expect(a.size).toBe(65_536);
    pool.release(a);
    // Same bucket, different live size: reused.
    const b = pool.acquire(48_000, 0x80);
    expect(b).toBe(a);
    // Same bucket, different usage: NOT reused.
    pool.release(b);
    const c = pool.acquire(48_000, 0x9) as FakeBuffer;
    expect(c).not.toBe(a);
    expect(c.usage).toBe(0x9);
    expect(created.length).toBe(2);
    expect(pool.stats).toEqual({
      buffersCreated: 2,
      buffersReused: 1,
      buffersDestroyed: 0,
      pooledBuffers: 1, // a is idle; c is in flight
      pooledBytes: 65_536,
    });
  });

  it("destroys instead of pooling past the retained-byte bound", () => {
    const { device } = fakeDevice();
    const pool = new BufferPool(device, 65_536); // exactly one 64K bucket
    const a = pool.acquire(40_000, 0x80) as FakeBuffer;
    const b = pool.acquire(40_000, 0x80) as FakeBuffer;
    pool.release(a);
    pool.release(b); // over the bound: destroyed
    expect(a.destroyed).toBe(false);
    expect(b.destroyed).toBe(true);
    expect(pool.stats.pooledBytes).toBe(65_536);
    expect(pool.stats.buffersDestroyed).toBe(1);
  });

  it("a zero bound retains nothing (pre-pooling behavior)", () => {
    const { device } = fakeDevice();
    const pool = new BufferPool(device, 0);
    const a = pool.acquire(100, 0x80) as FakeBuffer;
    pool.release(a);
    expect(a.destroyed).toBe(true);
    expect(pool.stats).toEqual({
      buffersCreated: 1,
      buffersReused: 0,
      buffersDestroyed: 1,
      pooledBuffers: 0,
      pooledBytes: 0,
    });
  });

  it("rejects buffers it did not create", () => {
    const { device } = fakeDevice();
    const pool = new BufferPool(device, 1 << 20);
    const foreign = device.createBuffer({ size: 256, usage: 0x80 });
    expect(() => pool.release(foreign)).toThrow(/not acquired from this pool/);
  });

  it("dispose destroys idle buffers only and the pool stays usable", () => {
    const { device } = fakeDevice();
    const pool = new BufferPool(device, 1 << 20);
    const idle = pool.acquire(1000, 0x80) as FakeBuffer;
    const inFlight = pool.acquire(1000, 0x80) as FakeBuffer;
    pool.release(idle);
    pool.dispose();
    expect(idle.destroyed).toBe(true);
    expect(inFlight.destroyed).toBe(false);
    expect(pool.stats.pooledBuffers).toBe(0);
    expect(pool.stats.pooledBytes).toBe(0);
    // Releasing the in-flight buffer afterwards pools it normally.
    pool.release(inFlight);
    expect(inFlight.destroyed).toBe(false);
    expect(pool.stats.pooledBuffers).toBe(1);
    const again = pool.acquire(1000, 0x80);
    expect(again).toBe(inFlight);
  });
});
