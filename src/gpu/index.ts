/**
 * `pcg-ts/gpu` — WGSL compiler for the serializable field-expression
 * grammar. Phase 19 scope: pure codegen. `compileFieldSpec` turns a
 * field JSON spec (see `fieldFromJson`) plus a concrete attribute
 * layout into a complete WGSL compute kernel with a bind-layout plan
 * and a stable specialization key; nothing in this subpath touches a
 * GPU device, imports WebGPU types, or imports three.
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
