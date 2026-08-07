/**
 * The WebGPU side of the core `DeviceTransformsHandle` contract: wraps a
 * buffer whose ownership has left the evaluator's pool
 * (`BufferPool.detach`) in the opaque, disposable handle core hands to
 * whoever consumes a device-resident instance batch.
 *
 * Lifetime, in one line per state: while a resident run is executing the
 * pool owns the buffer; at the instant the run detaches it the handle
 * exists and the RECEIVER owns it; when the receiver calls `dispose()`
 * the buffer is destroyed and the pool's `detachedBytes` accounting
 * drops by its bucket size. Nothing else frees it — not the run's
 * `finally`, not the memo cache, not `GpuFieldEvaluator.dispose()`.
 * `dispose()` twice is a no-op (never a double free), and reading
 * `resource` after dispose throws instead of returning a destroyed
 * buffer.
 */
import type { DeviceTransformsHandle } from "../fields/index.js";
import type { GpuBufferLike } from "./device.js";
import type { DetachedBuffer } from "./pool.js";

/** Backend tag every handle this module creates carries. */
export const WEBGPU_BACKEND = "webgpu";

class WebGpuTransformsHandle implements DeviceTransformsHandle {
  readonly backend = WEBGPU_BACKEND;
  readonly byteLength: number;
  private readonly detached: DetachedBuffer;
  /** For the error message only; never handed out after dispose. */
  private readonly label: string;

  constructor(detached: DetachedBuffer, byteLength: number, label: string) {
    this.detached = detached;
    this.byteLength = byteLength;
    this.label = label;
  }

  get disposed(): boolean {
    return this.detached.destroyed;
  }

  get resource(): unknown {
    if (this.detached.destroyed) {
      throw new Error(
        `device transforms handle (${this.label}) was disposed; its GPU buffer is destroyed and ` +
          "cannot be bound. Dispose a handle only after the last frame that reads it, and re-cook " +
          "to obtain a fresh one (device-resident outputs are never memoized, so every cook " +
          "produces a new handle)",
      );
    }
    return this.detached.buffer;
  }

  dispose(): void {
    this.detached.destroy();
  }
}

/**
 * Wrap a detached pool buffer as a core `DeviceTransformsHandle`.
 * `byteLength` is the LOGICAL payload length (`count * 64` for instance
 * transforms), which can be smaller than the detached bucket size.
 */
export function makeDeviceTransformsHandle(
  detached: DetachedBuffer,
  byteLength: number,
  label: string,
): DeviceTransformsHandle {
  return new WebGpuTransformsHandle(detached, byteLength, label);
}

/**
 * Narrow a core handle back to the WebGPU buffer it wraps — the one
 * supported way for a renderer adapter (`pcg-ts/three`) to bind a
 * device-resident instance batch.
 *
 * Bind exactly `handle.byteLength` bytes from offset 0: the allocation
 * behind it is bucketed to a power of two, so the tail is uninitialized.
 * Throws (naming the backend it got) for a handle from another backend,
 * and throws for a disposed handle rather than returning a destroyed
 * buffer.
 */
export function deviceTransformsBuffer(handle: DeviceTransformsHandle): GpuBufferLike {
  if (handle.backend !== WEBGPU_BACKEND) {
    throw new Error(
      `deviceTransformsBuffer: handle belongs to the "${handle.backend}" backend, not ` +
        `"${WEBGPU_BACKEND}"; only handles produced by a GpuFieldEvaluator carry a WebGPU buffer`,
    );
  }
  return handle.resource as GpuBufferLike;
}
