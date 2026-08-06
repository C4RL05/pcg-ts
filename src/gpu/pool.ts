/**
 * Size-bucketed GPU buffer pool for `GpuFieldEvaluator`. Buffers are
 * created at power-of-two bucket sizes (256-byte floor) and keyed by
 * (usage flags, bucket size), so a released buffer can serve any later
 * acquisition of the same usage whose byte length fits the bucket.
 *
 * Reuse is observationally invisible by construction on the caller's
 * side: kernels guard `i >= count` (stale bytes past the live range are
 * never computed from), input uploads cover the full range the kernel
 * reads, and readback maps/copies the exact byte length — the pool
 * itself never clears memory.
 *
 * Bound: `maxPooledBytes` limits RETAINED (idle) bytes only; a release
 * that would exceed it destroys the buffer instead of pooling it.
 * Buffers in flight are not counted — peak live memory is the same as
 * without pooling. `dispose()` destroys every pooled buffer.
 */
import type { GpuBufferLike, GpuDeviceLike } from "./device.js";

/** Snapshot of a {@link BufferPool}'s counters. */
export interface GpuPoolStats {
  /** Buffers created because no pooled buffer matched (usage, bucket). */
  buffersCreated: number;
  /** Acquisitions served by a pooled buffer. */
  buffersReused: number;
  /** Buffers destroyed (evicted over the byte bound, or via dispose). */
  buffersDestroyed: number;
  /** Idle buffers currently held by the pool. */
  pooledBuffers: number;
  /** Total bucket bytes of the idle buffers (bounded by maxPooledBytes). */
  pooledBytes: number;
}

/** Smallest bucket; sub-256-byte buffers (uniforms) share one bucket. */
const MIN_BUCKET_BYTES = 256;

/** Bucket size for a requested byte length: next power of two, floored. */
export function bucketBytes(size: number): number {
  let b = MIN_BUCKET_BYTES;
  while (b < size) b *= 2;
  return b;
}

interface PooledMeta {
  readonly key: string;
  readonly bytes: number;
}

/** Size-bucketed reuse of device buffers; see the module doc. */
export class BufferPool {
  private readonly device: GpuDeviceLike;
  private readonly maxPooledBytes: number;
  /** Idle buffers by `${usage}|${bucketBytes}`. */
  private readonly free = new Map<string, GpuBufferLike[]>();
  /** Bucket metadata for every live buffer this pool created. */
  private readonly meta = new Map<GpuBufferLike, PooledMeta>();
  private idleBytes = 0;
  private idleCount = 0;
  private created = 0;
  private reused = 0;
  private destroyed = 0;

  constructor(device: GpuDeviceLike, maxPooledBytes: number) {
    this.device = device;
    this.maxPooledBytes = maxPooledBytes;
  }

  /**
   * A buffer of at least `size` bytes with exactly `usage`, either
   * reused from the pool or freshly created at the bucket size. The
   * caller owns it until {@link release}.
   */
  acquire(size: number, usage: number): GpuBufferLike {
    const bytes = bucketBytes(size);
    const key = `${usage}|${bytes}`;
    const list = this.free.get(key);
    const pooled = list?.pop();
    if (pooled !== undefined) {
      this.idleBytes -= bytes;
      this.idleCount--;
      this.reused++;
      return pooled;
    }
    const buf = this.device.createBuffer({ size: bytes, usage });
    this.meta.set(buf, { key, bytes });
    this.created++;
    return buf;
  }

  /**
   * Return an acquired buffer. Pooled for reuse while the retained-byte
   * bound holds; destroyed otherwise. Must not be mapped.
   */
  release(buf: GpuBufferLike): void {
    const m = this.meta.get(buf);
    if (m === undefined) {
      throw new Error("BufferPool.release: buffer was not acquired from this pool");
    }
    if (this.idleBytes + m.bytes > this.maxPooledBytes) {
      this.meta.delete(buf);
      buf.destroy();
      this.destroyed++;
      return;
    }
    let list = this.free.get(m.key);
    if (list === undefined) {
      list = [];
      this.free.set(m.key, list);
    }
    list.push(buf);
    this.idleBytes += m.bytes;
    this.idleCount++;
  }

  /** Counter snapshot (a fresh object; safe to hold across operations). */
  get stats(): GpuPoolStats {
    return {
      buffersCreated: this.created,
      buffersReused: this.reused,
      buffersDestroyed: this.destroyed,
      pooledBuffers: this.idleCount,
      pooledBytes: this.idleBytes,
    };
  }

  /**
   * Destroy every pooled (idle) buffer and forget it. Buffers currently
   * acquired stay valid; releasing them afterwards pools (or destroys)
   * them under the normal bound. The pool remains usable.
   */
  dispose(): void {
    for (const list of this.free.values()) {
      for (const buf of list) {
        this.meta.delete(buf);
        buf.destroy();
        this.destroyed++;
      }
    }
    this.free.clear();
    this.idleBytes = 0;
    this.idleCount = 0;
  }
}
