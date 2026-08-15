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
 * `getFieldSpec(field)` (exported from the package root) answers "can
 * this field be DESCRIBED", not "will it run on the device": both
 * JSON-authored and code-authored fields carry a compilable spec, and a
 * derived one compiles to WGSL just as an authored one does.
 *
 * Device eligibility is the narrower rule, and it is a flag: by default a
 * Field param resolves on the device only when its spec was AUTHORED —
 * built by `fieldFromJson` — and a field built from the combinator API
 * stays on the CPU even though it describes itself, counting a
 * `"derived-spec"` fallback. Construct the evaluator with
 * `{ acceptDerivedSpecs: true }` and code-authored fields resolve on the
 * device too. The CPU is the bit-exact reference, so moving an existing
 * graph's fields onto the device is an opt-in change, not a side effect
 * of a field learning to describe itself.
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
  type AttrIsSlot,
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
 * exactly `handle.byteLength` bytes from offset 0.
 *
 * Ownership is split, and the adapter is not the owner: the adapter owns
 * only the renderer-side objects it creates from the buffer, while the
 * holder that retained the handle owns the handle itself and disposes it
 * once no live consumer references it. An adapter must never call
 * `handle.dispose()` — one handle can back several cells at once (parent
 * outputs alias into children), so holders refcount by handle identity
 * and an adapter-side dispose would free a buffer still being drawn.
 * `WorldThreeBinding` is that holder for the streaming path; see
 * `DeviceInstanceAdapter` in `pcg-ts/three` for the same split stated
 * from the renderer side.
 */
export { deviceTransformsBuffer, WEBGPU_BACKEND } from "./deviceTransforms.js";
