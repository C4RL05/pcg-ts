import type { AttrType } from "../data/index.js";

/** Scalar element types a GPU buffer can hold. */
export type GpuScalarType = "f32" | "i32" | "u32";

/**
 * One attribute column available to a kernel: its stored type and tuple
 * size. `type` uses the data-model attribute types; `"bool"` columns are
 * marshalled as u32 storage buffers holding 0/1 and read as f32 inside
 * the kernel (mirroring the CPU bool→f32 rule for attribute fields).
 * `"string"` columns bind as u32 too, because that is what they already
 * are — indices into the attribute's string table. `attributeIs` is the
 * one fn that reads one, and it compares indices; `attribute` still
 * refuses a string column, which has no numeric value to read.
 */
export interface FieldKernelAttr {
  readonly type: AttrType;
  readonly tupleSize: number;
}

/**
 * One (attribute, string literal) pair, and so one uniform constant slot:
 * the slot holds that literal's index in the string table of the geometry
 * the kernel is dispatched over. See
 * {@link CompiledFieldKernel.attrIsSlots} for why the index is not here.
 *
 * TWO fns mint these, and they share the pool: an `attributeIs` literal
 * and each of a `byAttribute`'s case KEYS. Keyed by the pair rather than
 * by the fn, so an `attributeIs("part", "rod")` and a `byAttribute` case
 * `"rod"` on the same attribute occupy ONE slot — one index is one index,
 * whichever fn asked for it.
 */
export interface AttrIsSlot {
  /** The string attribute the predicate tests or the case set selects on. */
  readonly attr: string;
  /** The literal it is compared against — a test literal or a case key. */
  readonly value: string;
}

/**
 * The concrete evaluation context a compiled kernel is specialized to:
 * which attribute columns exist, by name, with their type and tuple
 * size. Position is the attribute `P` (f32, tupleSize 3 in the standard
 * data model); `index` needs no column (it derives from the invocation
 * id). Only the subset of attributes the spec actually reads becomes
 * kernel inputs (and participates in the specialization key).
 */
export interface FieldKernelLayout {
  readonly attributes: Readonly<Record<string, FieldKernelAttr>>;
}

/**
 * One input binding of a compiled kernel: the attribute name, the
 * element type of the storage buffer as bound (`bool` layout columns
 * bind as `u32`), the tuple size, and the bind-group binding index.
 * Buffers are tightly packed SoA scalar arrays (`count * tupleSize`
 * elements, no vec3 padding), exactly the CPU column layout.
 */
export interface KernelInput {
  readonly name: string;
  readonly type: GpuScalarType;
  readonly tupleSize: number;
  readonly binding: number;
}

/**
 * A compiled WGSL field kernel. Pure data — nothing here touches a GPU
 * device; the runtime creates the pipeline from `wgsl`, binds buffers
 * per `inputs`/`bindings`, and dispatches on one dimension in chunks of
 * up to 65535 workgroups: each chunk runs
 * `ceil(chunkElements / workgroupSize)` workgroups with its start index
 * in the `chunkOffset` uniform member (0 for the common single-chunk
 * case), so element counts are unbounded by the per-dispatch workgroup
 * limit.
 */
export interface CompiledFieldKernel {
  /** Complete WGSL module text. Deterministic: same spec + layout → same text. */
  readonly wgsl: string;
  /** Compute entry point name. */
  readonly entryPoint: string;
  /** 1D workgroup size the entry point was generated with. */
  readonly workgroupSize: number;
  /** Tuple size of the output column. */
  readonly outTupleSize: number;
  /**
   * Element type of the output buffer, mirroring the CPU column type:
   * `index` at the root → u32; `attribute` at the root → the attribute's
   * own type (bool → f32, as on CPU); everything else f32.
   */
  readonly outType: GpuScalarType;
  /** Input bindings in binding-index order (attributes sorted by name). */
  readonly inputs: readonly KernelInput[];
  /** Fixed bindings: the uniform struct and the output storage buffer. */
  readonly bindings: { readonly uniforms: number; readonly output: number };
  /**
   * Uniform constant slots this kernel's `PcgParams` declares — one
   * `vec4<f32>` each, 0 when it declares none. One per distinct `param`
   * name the spec references, then one per distinct `attributeIs` pair
   * ({@link paramNames} and {@link attrIsSlots} in that order). Either
   * kind costs a uniform slot and NO storage buffer, which is what makes
   * a `param` cheaper than the attribute idiom it replaces.
   */
  readonly constSlots: number;
  /**
   * The `param` names the leading slots hold, in SLOT ORDER (sorted by
   * name, mirroring the attribute pre-pass, so codegen is deterministic).
   * Values are deliberately absent: they are written into the uniform at
   * dispatch, never baked, so one compiled kernel serves every value the
   * names are bound to. Use `paramConstValues` to turn a spec's bindings
   * into the slot payload.
   */
  readonly paramNames: readonly string[];
  /**
   * The `attributeIs` (attribute, literal) pairs the REMAINING slots
   * hold, in slot order (sorted, after the `param` slots), each carrying
   * that literal's index in the string table of the geometry the kernel
   * is dispatched over.
   *
   * The pair and never the index, for the same reason values are absent
   * above and a stronger one: a string table is insertion-ordered and
   * rebuilt by clone, filter and merge, so two geometries hold the same
   * literal at different indices — while this kernel's cache key carries
   * no table contents and would happily serve both. The index is resolved
   * per dispatch by `constSlotValues`, which takes the geometry's
   * attribute set; `paramConstValues` declines a kernel with any of these
   * rather than write a payload it cannot know.
   */
  readonly attrIsSlots: readonly AttrIsSlot[];
  /**
   * Byte size of this kernel's `PcgParams` uniform: the 12-byte scalar
   * header, or the padded 16-byte header plus 16 bytes per constant slot
   * (the layout `applyUniformBytes` computes for apply kernels — one
   * uniform tail, shared).
   */
  readonly uniformBytes: number;
  /**
   * Whether the kernel reads the evaluation-context seed uniform
   * (`randomField` does; noise fields don't — their seeds are baked in).
   * The uniform struct always carries a seed member; when this is false
   * its value never affects the output.
   */
  readonly usesSeed: boolean;
  /**
   * Stable specialization key: a deterministic function of the canonical
   * spec (structural field key — spec JSON key order and defaulted
   * options do not matter) and the layout subset actually used. Two
   * compilations with the same key produce byte-identical `wgsl`;
   * phase 20 uses it as the pipeline cache key.
   *
   * VALUE-FREE where `param` is concerned: the spec key is taken from the
   * UNBOUND field, and the params contribute their names and arities
   * only. Rebinding a name must hit this key, or the pipeline cache would
   * gain an entry per value — see the two-keys note in `evaluator.ts`.
   */
  readonly key: string;
}

/**
 * Error raised for specs the WGSL compiler cannot lower: unsupported
 * fns, layout mismatches, string attributes, tuple sizes above 4.
 * Spec-validity errors (malformed JSON specs) surface as
 * `FieldJsonError` from the shared validator instead.
 */
export class GpuCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GpuCompileError";
  }
}
