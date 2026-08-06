/**
 * Structural typing for exactly the WebGPU surface the evaluator uses.
 * Deliberately NOT `@webgpu/types`: these interfaces keep the published
 * `.d.ts` dependency-free while accepting both a browser `GPUDevice` and
 * Node WebGPU bindings (method-position parameters are bivariant, so the
 * real, richer signatures are assignable). Usage/map-mode flags are the
 * WebGPU-specified constant values, defined locally so no global
 * `GPUBufferUsage`/`GPUMapMode` objects are required at runtime.
 */

/** Subset of `GPUAdapterInfo` used to derive the evaluator's cache salt. */
export interface GpuAdapterInfoLike {
  readonly vendor?: string;
  readonly architecture?: string;
  readonly device?: string;
  readonly description?: string;
}

/** One diagnostic from WGSL front-end compilation. */
export interface GpuCompilationMessageLike {
  readonly type: string;
  readonly message: string;
  readonly lineNum?: number;
  readonly linePos?: number;
}

/** Result of `GPUShaderModule.getCompilationInfo()`. */
export interface GpuCompilationInfoLike {
  readonly messages: readonly GpuCompilationMessageLike[];
}

/** Structural `GPUShaderModule`. */
export interface GpuShaderModuleLike {
  getCompilationInfo(): Promise<GpuCompilationInfoLike>;
}

/** Structural `GPUBindGroupLayout` (opaque here). */
export type GpuBindGroupLayoutLike = object;

/** Structural `GPUComputePipeline`. */
export interface GpuComputePipelineLike {
  getBindGroupLayout(index: number): GpuBindGroupLayoutLike;
}

/**
 * Structural `GPUBuffer` (the mapping surface used for readback).
 * `mapAsync`/`getMappedRange` take the optional offset/size the real API
 * has: pooled buffers can be larger than the live range, so readback
 * always maps and slices the exact byte length it needs.
 */
export interface GpuBufferLike {
  mapAsync(mode: number, offset?: number, size?: number): Promise<unknown>;
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

/** Structural `GPUBindGroup` (opaque here). */
export type GpuBindGroupLike = object;

/**
 * Structural `GPUComputePassEncoder`. `setBindGroup` admits null (as
 * the real signature does) so a `GPUDevice` stays structurally
 * assignable; the evaluator always passes a bind group.
 */
export interface GpuComputePassLike {
  setPipeline(pipeline: GpuComputePipelineLike): void;
  setBindGroup(index: number, bindGroup: GpuBindGroupLike | null): void;
  dispatchWorkgroups(x: number): void;
  end(): void;
}

/** Structural `GPUCommandBuffer` (opaque here). */
export type GpuCommandBufferLike = object;

/** Structural `GPUCommandEncoder`. */
export interface GpuCommandEncoderLike {
  beginComputePass(): GpuComputePassLike;
  copyBufferToBuffer(
    source: GpuBufferLike,
    sourceOffset: number,
    destination: GpuBufferLike,
    destinationOffset: number,
    size: number,
  ): void;
  finish(): GpuCommandBufferLike;
}

/** Structural `GPUQueue`. */
export interface GpuQueueLike {
  writeBuffer(buffer: GpuBufferLike, bufferOffset: number, data: ArrayBufferView): void;
  submit(commandBuffers: readonly GpuCommandBufferLike[]): void;
}

/**
 * Structural `GPUDevice`: exactly the members the evaluator touches. A
 * browser `GPUDevice` and Node WebGPU binding devices both satisfy it.
 */
export interface GpuDeviceLike {
  readonly queue: GpuQueueLike;
  /** Present on spec-current devices; used for the default cache salt. */
  readonly adapterInfo?: GpuAdapterInfoLike;
  createShaderModule(descriptor: { code: string }): GpuShaderModuleLike;
  /**
   * `layout` is `"auto" | object` (not just `"auto"`) and `entryPoint`
   * is optional so a real `GPUDevice`'s richer signature stays
   * structurally assignable; the evaluator always passes `"auto"` and an
   * explicit entry point.
   */
  createComputePipeline(descriptor: {
    layout: "auto" | object;
    compute: { module: GpuShaderModuleLike; entryPoint?: string };
  }): GpuComputePipelineLike;
  createBuffer(descriptor: { size: number; usage: number }): GpuBufferLike;
  /**
   * `resource` is typed `object` (not `{ buffer }`) so a real
   * `GPUDevice` — whose entries also admit sampler/texture resources —
   * stays structurally assignable; the evaluator only ever passes
   * `{ buffer }` bindings.
   */
  createBindGroup(descriptor: {
    layout: GpuBindGroupLayoutLike;
    entries: readonly { binding: number; resource: object }[];
  }): GpuBindGroupLike;
  createCommandEncoder(): GpuCommandEncoderLike;
}

/**
 * WebGPU-specified buffer usage flag values (`GPUBufferUsage`), local so
 * the evaluator never needs the global constants object.
 */
export const BUFFER_USAGE = {
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
} as const;

/** WebGPU-specified map mode flag values (`GPUMapMode`). */
export const MAP_MODE = {
  READ: 0x0001,
} as const;
