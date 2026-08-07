/**
 * `pcg-ts/gpu` — WGSL compiler and device runtime for the serializable
 * field-expression grammar. `compileFieldSpec` turns a field JSON spec
 * (see `fieldFromJson`) plus a concrete attribute layout into a
 * complete WGSL compute kernel with a bind-layout plan and a stable
 * specialization key. `GpuFieldEvaluator` runs those kernels on a
 * WebGPU device (typed structurally — see {@link GpuDeviceLike} — so
 * this subpath needs no WebGPU type dependency and never imports
 * three): pass one to `cook(graph, { gpu })`, `WorldOptions.gpu`, or
 * `captureAsync` and eligible spec'd Field params resolve on the
 * device, falling back to the CPU otherwise.
 *
 * Use `getFieldSpec(field)` (exported from the package root) to check
 * whether a live Field carries a compilable spec: JSON-authored fields
 * do, code-authored fields return undefined and stay on the CPU.
 *
 * Determinism contract (CPU is the bit-exact reference):
 * - u32 hash/random streams (`randomField`, noise lattice hashing) are
 *   bit-exact ports.
 * - f32 add/sub/mul match CPU bit-for-bit where WGSL mandates correct
 *   rounding; division, sqrt, and transcendentals differ within
 *   tolerances the phase-20 parity suite measures and documents.
 * - Branchy ops (select, compares, ramp segments, worley cell walks)
 *   may flip at knife-edge inputs whose operands differ within
 *   tolerance.
 */
export {
  type CompiledFieldKernel,
  type FieldKernelAttr,
  type FieldKernelLayout,
  GpuCompileError,
  type GpuScalarType,
  type KernelInput,
} from "./types.js";
export { compileFieldSpec, supportedGpuFieldFns } from "./compile.js";
export {
  BUFFER_USAGE,
  MAP_MODE,
  type GpuAdapterInfoLike,
  type GpuBindGroupLayoutLike,
  type GpuBindGroupLike,
  type GpuBufferLike,
  type GpuCommandBufferLike,
  type GpuCommandEncoderLike,
  type GpuCompilationInfoLike,
  type GpuCompilationMessageLike,
  type GpuComputePassLike,
  type GpuComputePipelineLike,
  type GpuDeviceLike,
  type GpuQueueLike,
  type GpuShaderModuleLike,
} from "./device.js";
export { GpuFieldEvaluator, type GpuFieldEvaluatorOptions } from "./evaluator.js";
export { type DetachedBuffer, type GpuPoolStats } from "./pool.js";
/**
 * Device-resident instance transforms (see `GpuFieldEvaluatorOptions`'
 * `deviceInstances`). A renderer adapter receives a core
 * `DeviceTransformsHandle` on each `DeviceInstanceBatch` and turns it
 * into a bindable buffer with `deviceTransformsBuffer(handle)`, binding
 * exactly `handle.byteLength` bytes from offset 0. The adapter owns the
 * handle and must call `handle.dispose()` when it stops drawing from it.
 */
export { deviceTransformsBuffer, WEBGPU_BACKEND } from "./deviceTransforms.js";
