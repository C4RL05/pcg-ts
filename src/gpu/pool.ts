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
 *
 * Ownership has exactly three states and every transition is explicit:
 *
 *     created/pooled --acquire--> IN FLIGHT --release--> pooled or destroyed
 *                                     |
 *                                  detach
 *                                     v
 *                                 DETACHED (caller-owned)
 *                                     |
 *                     DetachedBuffer.destroy() --> destroyed
 *
 * A DETACHED buffer has left the pool for good: the pool will never hand
 * it out again, never reclaim it, and `dispose()` does not touch it —
 * only the {@link DetachedBuffer} the detach returned can destroy it,
 * idempotently. Passing a detached buffer back to {@link release} is a
 * bug and throws a message that says so, distinct from the "never
 * acquired here" message, so the two mistakes are never confused. The
 * pool keeps counting detached bytes (`detachedBuffers`/`detachedBytes`)
 * until they are destroyed, so an un-destroyed handle is a *visible*
 * leak rather than an invisible one.
 */
import type { GpuBufferLike, GpuDeviceLike } from "./device.js";

/** Snapshot of a {@link BufferPool}'s counters. */
export interface GpuPoolStats {
  /** Buffers created because no pooled buffer matched (usage, bucket). */
  buffersCreated: number;
  /** Acquisitions served by a pooled buffer. */
  buffersReused: number;
  /**
   * Buffers destroyed: evicted over the byte bound, destroyed by
   * `dispose()`, or destroyed by their owner after {@link
   * BufferPool.detach}. Together with `buffersCreated` and
   * `pooledBuffers` this keeps the in-flight identity
   * `created - destroyed - pooled` honest — a detached buffer counts as
   * outstanding until its owner destroys it.
   */
  buffersDestroyed: number;
  /** Idle buffers currently held by the pool. */
  pooledBuffers: number;
  /** Total bucket bytes of the idle buffers (bounded by maxPooledBytes). */
  pooledBytes: number;
  /** Buffers whose ownership has left the pool via `detach`, cumulative. */
  buffersDetached: number;
  /** Detached buffers not yet destroyed by their owner (a live-handle count). */
  detachedBuffers: number;
  /** Bucket bytes of the not-yet-destroyed detached buffers. */
  detachedBytes: number;
}

/**
 * Ownership record for a buffer that left the pool via
 * {@link BufferPool.detach}: the holder — and only the holder — destroys
 * it. Nothing else in the library will, including `BufferPool.dispose()`
 * and the run executor's `finally`.
 */
export interface DetachedBuffer {
  /** The buffer now owned by the holder. */
  readonly buffer: GpuBufferLike;
  /**
   * Bucket bytes this owns. The pool buckets to powers of two, so this
   * can exceed the bytes the caller asked for; the payload's logical
   * length is the caller's business.
   */
  readonly bytes: number;
  /** True once {@link destroy} has run. */
  readonly destroyed: boolean;
  /** Destroy the buffer and clear the pool's outstanding accounting. Idempotent. */
  destroy(): void;
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
  /**
   * Buffers whose ownership left via `detach`. Weak so a detached buffer
   * the owner dropped can be collected; its only purpose is telling
   * "you detached this" apart from "this was never mine" in `release`.
   */
  private readonly detachedSet = new WeakSet<GpuBufferLike>();
  private idleBytes = 0;
  private idleCount = 0;
  private created = 0;
  private reused = 0;
  private destroyed = 0;
  private detachedTotal = 0;
  private detachedLive = 0;
  private detachedLiveBytes = 0;

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
      if (this.detachedSet.has(buf)) {
        throw new Error(
          "BufferPool.release: buffer was detached from this pool, so the pool no longer owns " +
            "it and cannot reclaim it; destroy it through the DetachedBuffer that detach() " +
            "returned (or the handle wrapping it) and stop releasing it",
        );
      }
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

  /**
   * Transfer ownership of an acquired buffer OUT of the pool. The buffer
   * stops being the pool's business entirely: it is not pooled on
   * release (release now throws for it), not destroyed by
   * {@link dispose}, and never handed out by {@link acquire} again. The
   * returned {@link DetachedBuffer} is the sole way to free it.
   *
   * Detaching a buffer that this pool did not hand out — or detaching
   * the same buffer twice — throws, naming which of the two happened.
   * A mapped buffer must not be detached (same rule as release).
   */
  detach(buf: GpuBufferLike): DetachedBuffer {
    const m = this.meta.get(buf);
    if (m === undefined) {
      throw new Error(
        this.detachedSet.has(buf)
          ? "BufferPool.detach: buffer was already detached from this pool; ownership can only " +
            "leave once — reuse the DetachedBuffer the first detach() returned"
          : "BufferPool.detach: buffer was not acquired from this pool",
      );
    }
    this.meta.delete(buf);
    this.detachedSet.add(buf);
    this.detachedTotal++;
    this.detachedLive++;
    this.detachedLiveBytes += m.bytes;
    let destroyed = false;
    const pool = this;
    return {
      buffer: buf,
      bytes: m.bytes,
      get destroyed(): boolean {
        return destroyed;
      },
      destroy(): void {
        // Idempotent by design: the handle wrapping this is public API
        // and a double dispose must be a no-op, never a double free.
        if (destroyed) return;
        destroyed = true;
        pool.detachedLive--;
        pool.detachedLiveBytes -= m.bytes;
        pool.destroyed++;
        buf.destroy();
      },
    };
  }

  /** Counter snapshot (a fresh object; safe to hold across operations). */
  get stats(): GpuPoolStats {
    return {
      buffersCreated: this.created,
      buffersReused: this.reused,
      buffersDestroyed: this.destroyed,
      pooledBuffers: this.idleCount,
      pooledBytes: this.idleBytes,
      buffersDetached: this.detachedTotal,
      detachedBuffers: this.detachedLive,
      detachedBytes: this.detachedLiveBytes,
    };
  }

  /**
   * Destroy every pooled (idle) buffer and forget it. Buffers currently
   * acquired stay valid; releasing them afterwards pools (or destroys)
   * them under the normal bound. Detached buffers are likewise
   * untouched — the pool does not own them, and destroying a buffer a
   * renderer is still drawing from would be a use-after-free; their
   * owners dispose them, and `stats.detachedBuffers` reports any that
   * outlive the pool. The pool remains usable.
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
