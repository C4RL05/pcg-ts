/**
 * Device-resident run planner and executor for `GpuFieldEvaluator`:
 * fuses a linear chain of resident-capable nodes (setAttribute numeric
 * point mode, transformPoints, jitterPoints, orientAlongVector) into
 * one device round trip — attribute columns live in storage buffers
 * across member kernels and a single readback at the terminal
 * materializes only the attributes some member wrote; untouched
 * attributes pass through from the input geometry via the same
 * cloneGeometry the CPU path starts from.
 *
 * Data-flow design (in place, not ping-pong): attribute buffers are
 * bound read_write and mutated in place by apply kernels, because
 * - every kernel touches only element i's slots (no cross-element
 *   reads/writes), so lanes never race within a dispatch;
 * - member field columns are materialized into separate temp buffers
 *   BEFORE the member's apply kernel dispatches — the CPU order
 *   (resolve all params, then mutate) — so a param column can never
 *   alias the attribute buffer its apply kernel writes;
 * - WebGPU guarantees write visibility between consecutive dispatches
 *   (each dispatch is its own usage scope, synchronized by the
 *   implementation), so a later member's field kernel reading an
 *   attribute an earlier member wrote sees the post-write bytes —
 *   the CPU ordering. The one exception is setAttribute, which writes
 *   its target into a FRESH buffer (full overwrite, never reads the
 *   old bytes): that sidesteps mid-run shape changes (replace can
 *   retype an attribute) and keeps earlier readers of the old epoch
 *   valid.
 * - Chunked dispatch reuses the evaluator's partition plan
 *   ({@link chunkCapacity}): non-final chunks are exact workgroup
 *   multiples, so chunks partition the element range and no element is
 *   ever written twice.
 *
 * Constant params (phase 25): a param that is a plain number or number
 * tuple compiles to neither a column nor a field kernel — the planner
 * allocates a slot in the apply kernel's own uniform and the executor
 * writes the values there per chunk. That removes `count * tupleSize *
 * 4` bytes and one dispatch per constant param from the working set
 * (transformPoints with three constants at 1M points: 36 MB and three
 * dispatches), without moving an output byte: a JS number written
 * through a `Float32Array` uniform rounds exactly as the `wgslF32`
 * literal the constant column's kernel stored. The one exception is a
 * constant that is `-0` or subnormal, which a WGSL front end may flush
 * to `+0` as a literal but never as a uniform load — those now match
 * the CPU's bytes where the column did not (see applyKernels.ts).
 *
 * Memory bound: a run's working set — resident attribute buffers
 * (every epoch) + field temp columns (held for the whole run) + the
 * readback staging buffer — is computed at plan time and compared
 * against the evaluator's `maxResidentBytes` (default 512 MiB);
 * over-budget runs return null (`run-too-large`) and the per-node path
 * serves. The bound counts logical bytes: pow2 pool bucketing can
 * allocate up to 2x, and the per-chunk uniforms (12 bytes, or 16 + 16
 * per constant slot) are not counted.
 *
 * Device-resident spawner terminal (phase 26): when the chain's last
 * member is a `spawnInstances` the run appends a compose-TRS kernel that
 * writes one column-major 4x4 matrix per point into a buffer it then
 * transfers OUT of the pool (`BufferPool.detach`) and hands back as a
 * `DeviceTransformsHandle` — the transforms never touch host memory. If
 * nothing in the cook reads the terminal's geometry
 * (`ctx.needsGeometry === false`) the run also skips the readback
 * entirely: no `mapAsync`, no staging buffer, no CPU copy of P/rot/scale.
 *
 * Multi-asset spawner terminals (phase 29): a spawner driven by
 * `assetAttr` composes on the device too, with NO device-side sort. A
 * resident run always starts from a host `Geometry` and no resident node
 * can produce a string attribute, so the per-point asset key is host
 * resident by construction. The host therefore plans the grouping with
 * `groupPointsByAsset` — the exact function the CPU spawner
 * (`buildInstanceBatches`) calls, so the ordering spec has one
 * implementation and cannot drift — uploads its permutation as a u32
 * column, and dispatches the compose kernel once per asset with a `base`
 * uniform selecting that batch's slice (`src = perm[base + i]`, the
 * destination staying `i`). One output buffer and one dispatch per asset;
 * `count * 64` transform bytes in total either way.
 *
 * Pool discipline: every buffer is released in a `finally` (never
 * mapped — the readback unmaps in its own `finally`), on success,
 * failure, and cancellation alike. The one exception is the retained
 * transform buffers, and it is an exception by construction rather than
 * by omission: ownership transfers in the very last loop before the
 * result is built, after the final cancellation check, so every earlier
 * failure path still reclaims them — and a failure after (or partway
 * through) the transfer disposes the handles built so far in the
 * `catch`, exactly once each. The `finally` skips exactly the buffers it
 * no longer owns; releasing a detached buffer would throw.
 */
import type { AttrType, Geometry } from "../data/index.js";
import {
  isField,
  type DeviceInstanceBatch,
  type DeviceTransformsHandle,
  type GpuCookStats,
  type ResidentMemberDesc,
  type ResidentRunContext,
  type ResidentRunInput,
  type ResidentRunResult,
} from "../fields/index.js";
import { cloneGeometry } from "../graph/clone.js";
import { CookCancelledError } from "../graph/errors.js";
import { getFieldSpec, type FieldSpecArg } from "../nodes/fieldJson.js";
import { hashCombine } from "../random/index.js";
import { groupPointsByAsset } from "../spawn/grouping.js";
import {
  APPLY_CONST_COMPONENTS,
  APPLY_CONST_OFFSET,
  MAX_APPLY_CONST_SLOTS,
  makeComposeInstancesApply,
  makeJitterPointsApply,
  makeOrientApply,
  makeSetAttributeApply,
  makeTransformPointsApply,
  type ApplyConstRef,
  type ApplyKernel,
  type ApplyParamRef,
} from "./applyKernels.js";
import { compileFieldSpec } from "./compile.js";
import {
  BUFFER_USAGE,
  MAP_MODE,
  type GpuBufferLike,
  type GpuComputePipelineLike,
  type GpuDeviceLike,
} from "./device.js";
import { makeDeviceTransformsHandle } from "./deviceTransforms.js";
import type { BufferPool } from "./pool.js";
import type { CompiledFieldKernel, FieldKernelAttr, GpuScalarType } from "./types.js";

/**
 * Byte size of the field-kernel uniform struct {count, seed,
 * chunkOffset}. Apply kernels carrying constant slots declare a larger
 * `PcgParams` (see `applyUniformBytes`); every step carries its own
 * `uniformBytes`.
 */
export const UNIFORM_BYTES = 12;

/**
 * Baseline WebGPU limit `maxComputeWorkgroupsPerDimension`: one
 * `dispatchWorkgroups` call covers at most `65535 * workgroupSize`
 * elements; larger counts split into chunked dispatches.
 */
export const MAX_WORKGROUPS = 65535;

/**
 * Baseline WebGPU limit `maxStorageBuffersPerShaderStage`: kernels
 * needing more storage buffers (inputs + output) are ineligible.
 */
export const MAX_STORAGE_BUFFERS = 8;

/**
 * Default bound on a resident run's working set (see the module doc).
 * 512 MiB keeps multi-million-point chains fusable while staying far
 * below baseline device memory even after pow2 bucketing.
 */
export const DEFAULT_MAX_RESIDENT_BYTES = 512 * 1024 * 1024;

/**
 * Elements one chunk covers for a kernel of the given workgroup size:
 * `min(override, 65535 * wg)` floored to a workgroup multiple (minimum
 * one workgroup). The partition invariant lives here: every non-final
 * chunk covers exactly this many elements — an exact workgroup count,
 * so no lane strays into the next chunk's range and each element is
 * computed by exactly one invocation for any override.
 */
export function chunkCapacity(workgroupSize: number, maxElementsPerDispatch: number | undefined): number {
  const cap = MAX_WORKGROUPS * workgroupSize;
  const requested = Math.min(maxElementsPerDispatch ?? cap, cap);
  return Math.max(workgroupSize, Math.floor(requested / workgroupSize) * workgroupSize);
}

// ---------------------------------------------------------------------------
// plan representation

type BufRef =
  | { readonly kind: "slot"; readonly index: number }
  | { readonly kind: "col"; readonly index: number }
  /**
   * The retained instance-transform buffer of the batch currently being
   * dispatched (spawner terminal). Plural since phase 29: the plan
   * cannot name an index, because how many batches there are — and how
   * large each is — depends on the run's DATA, not its layout, and the
   * planner never sees the data. The executor resolves this ref per
   * batch against the grouping it computes at execute time.
   */
  | { readonly kind: "out" }
  /**
   * The uploaded grouping permutation (attribute-mode spawner only): one
   * u32 source point index per instance slot, batches concatenated.
   */
  | { readonly kind: "perm" };

interface KernelStep {
  /** Pipeline-cache key. */
  readonly key: string;
  readonly wgsl: string;
  readonly entryPoint: string;
  readonly workgroupSize: number;
  /** Uniform seed for this kernel (u32-coerced at dispatch). */
  readonly seed: number;
  readonly uniformsBinding: number;
  /** Byte size of this step's uniform struct. */
  readonly uniformBytes: number;
  /**
   * Constant slot values: {@link APPLY_CONST_COMPONENTS} f32 per slot
   * (zero-padded), in slot order, written into the uniform after the
   * scalar header. Empty for field kernels and constant-free applies.
   */
  readonly consts: readonly number[];
  /**
   * Dispatch this step ONCE PER INSTANCE BATCH — over that batch's
   * element range, with the uniform's `count` set to the batch's size and
   * `base` to its offset into the permutation — instead of once over the
   * whole element range. Only the indexed compose kernel of a
   * multi-asset spawner terminal sets it; every other step, and every
   * plan a v0.7 build could produce, is `false`.
   */
  readonly perBatch: boolean;
  readonly bindings: readonly { readonly binding: number; readonly ref: BufRef }[];
}

interface PlannedMember {
  readonly id: string;
  readonly type: string;
  /** Field kernels (in param order) followed by the apply kernel. */
  readonly steps: readonly KernelStep[];
}

/** A resident attribute buffer (one per attribute shape epoch). */
interface SlotDesc {
  readonly bytes: number;
  /**
   * "attr": upload the named input attribute's live prefix (bool
   * widened to u32); "quat-default": fill with [0, 0, 0, 1] per element
   * (a freshly created rot the CPU path would default-fill);
   * "none": fully written by an apply kernel before any read.
   */
  readonly init: "attr" | "quat-default" | "none";
  readonly name: string;
}

/** CPU-side layout op replayed on the cloned output geometry, member order. */
type LayoutOp =
  | { readonly op: "replace"; readonly name: string; readonly type: AttrType; readonly tupleSize: number }
  | { readonly op: "ensure-rot" };

/** Bytes one instance's column-major 4x4 f32 matrix occupies. */
export const INSTANCE_MATRIX_BYTES = 64;

/**
 * The device-resident instance output a spawner terminal produces.
 *
 * This describes the GROUPING, not the batches: how many batches there
 * are, which assets they carry, and how big each is depends on the
 * per-point asset column's contents, and the planner sees only the
 * attribute LAYOUT. The executor resolves it into concrete batches with
 * {@link groupPointsByAsset} — the CPU spawner's own ordering code — and
 * allocates one retained buffer per batch.
 *
 * The byte totals are data-independent, which is why the run's memory
 * bound can still be decided at plan time: the batches partition the
 * points, so their transform bytes always sum to
 * `count * INSTANCE_MATRIX_BYTES` however the grouping falls.
 */
interface InstancesDesc {
  /** `spawnInstances`' `assetId`: the id every unset/empty point resolves to. */
  readonly assetId: string;
  /**
   * String point attribute holding per-point asset ids, or `""` for
   * constant mode (exactly one batch, no permutation, and a compose
   * kernel byte-identical to v0.7's).
   */
  readonly assetAttr: string;
  /** Points the terminal composes (always `plan.count`). */
  readonly count: number;
  /** Retained transform bytes across every batch: `count * INSTANCE_MATRIX_BYTES`. */
  readonly bytes: number;
  /** Permutation upload: `count * 4` in attribute mode, 0 in constant mode. */
  readonly permBytes: number;
}

const PLAN_FORMAT = "pcg-resident-run/4";

/** Opaque (to the executor) compiled run plan. */
export interface ResidentRunPlan {
  readonly format: typeof PLAN_FORMAT;
  readonly count: number;
  readonly members: readonly PlannedMember[];
  readonly slots: readonly SlotDesc[];
  /** Temp field-column byte sizes, by col index. */
  readonly cols: readonly number[];
  /** Attributes some member wrote: final slot per name, first-write order. */
  readonly written: readonly { readonly name: string; readonly slot: number }[];
  readonly layoutOps: readonly LayoutOp[];
  /**
   * Read `written` back and build the terminal's output geometry. False
   * only when the cook asked for no geometry AND the run has another
   * output to produce ({@link instances}) — the run then performs no
   * readback at all, which is the whole point of a device-resident
   * terminal. A run with nothing else to produce always materializes, so
   * every pre-existing plan shape is unchanged.
   */
  readonly materialize: boolean;
  /** Device-resident instance batch to retain, or null for an ordinary run. */
  readonly instances: InstancesDesc | null;
  /** Logical working-set bytes (slots + cols + readback staging + retained). */
  readonly totalBytes: number;
}

/** Narrow an unknown plan back to this module's plan shape. */
export function asResidentRunPlan(plan: object): ResidentRunPlan | null {
  return (plan as { format?: unknown }).format === PLAN_FORMAT ? (plan as ResidentRunPlan) : null;
}

// ---------------------------------------------------------------------------
// planner

/** Planner failure: the fallback reason to count. */
export interface PlanRejection {
  readonly reason: "run-plan-failed" | "run-too-large";
}

export type PlanOutcome = { readonly plan: ResidentRunPlan } | PlanRejection;

const REJECT: PlanRejection = { reason: "run-plan-failed" };

const ORIENT_AXES = ["+x", "-x", "+y", "-y", "+z", "-z"] as const;
type OrientAxis = (typeof ORIENT_AXES)[number];

function isVec3(v: unknown): v is readonly [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));
}

/** Internal planning failure signal (never escapes planResidentRun). */
class PlanFail extends Error {}

/** Shared empty constant list for steps carrying no uniform slots. */
const NO_CONSTS: readonly number[] = [];

/**
 * Plan a resident run: synchronous, device-free. Simulates the chain's
 * attribute-layout evolution member by member, compiles each member's
 * field kernels against the layout at that point (so a field reading an
 * attribute an earlier member wrote binds that member's output buffer),
 * generates the apply kernels, and records the CPU-side layout ops the
 * materialization replays. Any semantic the resident pipeline does not
 * model — unknown kinds, non-f32x3 P, field compile errors, tuple
 * mismatches the CPU would reject (the per-node path then surfaces the
 * identical error), out-of-range tuple sizes — rejects with
 * `run-plan-failed`; an over-budget working set rejects with
 * `run-too-large`.
 */
export function planResidentRun(
  members: readonly ResidentMemberDesc[],
  ctx: ResidentRunContext,
  maxResidentBytes: number,
): PlanOutcome {
  const count = ctx.count;
  const layout = new Map<string, FieldKernelAttr>(Object.entries(ctx.attributes));
  const slots: SlotDesc[] = [];
  const slotByName = new Map<string, number>();
  const cols: number[] = [];
  const written = new Map<string, number>();
  const layoutOps: LayoutOp[] = [];
  const planned: PlannedMember[] = [];
  let instances: InstancesDesc | null = null;

  const layoutObj = (): Record<string, FieldKernelAttr> => Object.fromEntries(layout);

  /** Slot for reading (and possibly writing) the attribute's current epoch. */
  const slotFor = (name: string): number => {
    const existing = slotByName.get(name);
    if (existing !== undefined) return existing;
    const attr = layout.get(name);
    if (attr === undefined || attr.type === "string") throw new PlanFail(name);
    const index = slots.length;
    slots.push({ bytes: count * attr.tupleSize * 4, init: "attr", name });
    slotByName.set(name, index);
    return index;
  };

  /** Fresh SSA slot for a (re)created attribute epoch. */
  const freshSlot = (name: string, tupleSize: number, init: "quat-default" | "none"): number => {
    const index = slots.length;
    slots.push({ bytes: count * tupleSize * 4, init, name });
    slotByName.set(name, index);
    return index;
  };

  const expectAttr = (name: string, type: AttrType, tupleSize: number): void => {
    const attr = layout.get(name);
    if (attr === undefined || attr.type !== type || attr.tupleSize !== tupleSize) throw new PlanFail(name);
  };

  /**
   * Allocate a uniform constant slot for `values` in the apply kernel's
   * accumulating `consts` array (4 f32 per slot, zero-padded). Values
   * are stored as authored: the executor's `Float32Array` write rounds
   * them exactly as the `wgslF32` literal a constant column would have.
   */
  const constSlot = (values: readonly number[], consts: number[], kind: string): ApplyConstRef => {
    const slot = consts.length / APPLY_CONST_COMPONENTS;
    if (slot >= MAX_APPLY_CONST_SLOTS) {
      throw new Error(
        `resident run: "${kind}" needs more than ${MAX_APPLY_CONST_SLOTS} uniform constant slots ` +
          "for its constant params; raise MAX_APPLY_CONST_SLOTS in applyKernels.ts (each slot " +
          "costs 16 bytes of the per-chunk uniform and nothing else)",
      );
    }
    for (let k = 0; k < APPLY_CONST_COMPONENTS; k++) consts.push(k < values.length ? values[k] : 0);
    return { kind: "const", tupleSize: values.length, slot };
  };

  /**
   * Compile one field-capable param. A Field with a spec becomes a field
   * kernel step writing a temp column (returning that column's buffer
   * ref); a plain number or number tuple becomes a uniform constant slot
   * — no column, no kernel, no dispatch, and so no buffer ref.
   */
  const compileParam = (
    value: unknown,
    seed: number,
    steps: KernelStep[],
    allowedTuples: readonly number[] | null,
    consts: number[],
    kind: string,
  ): { param: ApplyParamRef; ref: BufRef | null } => {
    let spec: FieldSpecArg;
    if (isField(value)) {
      const s = getFieldSpec(value);
      if (s === undefined) throw new PlanFail("no spec");
      spec = s;
    } else if (typeof value === "number" || (Array.isArray(value) && value.every((x) => typeof x === "number"))) {
      // Same acceptance as the constant column this replaces: tuple 1-4
      // (wider constants never compiled) and every component finite as
      // an f32 (`wgslF32` rejected the rest, rejecting the whole run).
      const values: readonly number[] = typeof value === "number" ? [value] : (value as readonly number[]);
      if (values.length < 1 || values.length > APPLY_CONST_COMPONENTS) throw new PlanFail("tuple");
      if (allowedTuples !== null && !allowedTuples.includes(values.length)) throw new PlanFail("tuple");
      for (const v of values) {
        if (!Number.isFinite(Math.fround(v))) throw new PlanFail("f32 range");
      }
      return { param: constSlot(values, consts, kind), ref: null };
    } else {
      throw new PlanFail("bad param value");
    }
    let kernel: CompiledFieldKernel;
    try {
      kernel = compileFieldSpec(spec, { attributes: layoutObj() });
    } catch {
      throw new PlanFail("compile");
    }
    if (kernel.inputs.length + 1 > MAX_STORAGE_BUFFERS) throw new PlanFail("buffers");
    if (allowedTuples !== null && !allowedTuples.includes(kernel.outTupleSize)) throw new PlanFail("tuple");
    const colIndex = cols.length;
    cols.push(count * kernel.outTupleSize * 4);
    steps.push({
      key: kernel.key,
      wgsl: kernel.wgsl,
      entryPoint: kernel.entryPoint,
      workgroupSize: kernel.workgroupSize,
      seed,
      uniformsBinding: kernel.bindings.uniforms,
      uniformBytes: UNIFORM_BYTES,
      consts: NO_CONSTS,
      perBatch: false,
      bindings: [
        ...kernel.inputs.map((inp) => ({ binding: inp.binding, ref: { kind: "slot", index: slotFor(inp.name) } as BufRef })),
        { binding: kernel.bindings.output, ref: { kind: "col", index: colIndex } },
      ],
    });
    return {
      param: { kind: "column", type: kernel.outType, tupleSize: kernel.outTupleSize },
      ref: { kind: "col", index: colIndex },
    };
  };

  /**
   * Apply-kernel step from a generated kernel + role→buffer mapping.
   * Binding indices are positional and constant params declare none, so
   * the mapping is by role, never by position; a role the kernel
   * declares but the planner did not map is a codegen/planner
   * disagreement, not a user input, and rejects the run.
   */
  const applyStep = (
    kernel: ApplyKernel,
    seed: number,
    refs: Record<string, BufRef>,
    consts: readonly number[],
    perBatch = false,
  ): KernelStep => {
    if (kernel.constSlots * APPLY_CONST_COMPONENTS !== consts.length) {
      throw new Error(
        `resident run: apply kernel "${kernel.key}" declares ${kernel.constSlots} constant slots ` +
          `but the planner allocated ${consts.length / APPLY_CONST_COMPONENTS}`,
      );
    }
    return {
      key: kernel.key,
      wgsl: kernel.wgsl,
      entryPoint: kernel.entryPoint,
      workgroupSize: kernel.workgroupSize,
      seed,
      uniformsBinding: 0,
      uniformBytes: kernel.uniformBytes,
      consts,
      perBatch,
      bindings: kernel.bindings.map((b) => {
        const ref = refs[b.role];
        if (ref === undefined) throw new PlanFail(`unmapped role ${b.role}`);
        return { binding: b.binding, ref };
      }),
    };
  };

  try {
    for (const m of members) {
      const isLast = m === members[members.length - 1];
      const steps: KernelStep[] = [];
      // Uniform constant slots for THIS member's apply kernel, filled in
      // param order by compileParam.
      const consts: number[] = [];
      const p = m.params;
      switch (m.kind) {
        case "setAttribute": {
          const name = p.name;
          const type = p.type;
          const ts = p.tupleSize;
          if (typeof name !== "string") throw new PlanFail("name");
          if (type !== "f32" && type !== "i32" && type !== "u32" && type !== "bool") throw new PlanFail("type");
          if (typeof ts !== "number" || !Number.isInteger(ts) || ts < 1 || ts > 4) throw new PlanFail("tupleSize");
          const extraSeed = typeof p.seed === "number" ? p.seed : Number.NaN;
          const seed = extraSeed === 0 ? m.seed : hashCombine(m.seed, extraSeed);
          // The CPU accepts a value tuple of 1 (broadcast) or exactly ts.
          const { param, ref } = compileParam(p.value, seed, steps, ts === 1 ? [1] : [1, ts], consts, m.kind);
          const target = freshSlot(name, ts, "none");
          layout.set(name, { type, tupleSize: ts });
          written.set(name, target);
          layoutOps.push({ op: "replace", name, type, tupleSize: ts });
          const refs: Record<string, BufRef> = { target: { kind: "slot", index: target } };
          if (ref !== null) refs.value = ref;
          steps.push(applyStep(makeSetAttributeApply(param, type, ts), 0, refs, consts));
          break;
        }
        case "transformPoints": {
          expectAttr("P", "f32", 3);
          const t = compileParam(p.translate, m.seed, steps, [1, 3], consts, m.kind);
          const r = compileParam(p.rotateEuler, m.seed, steps, [1, 3], consts, m.kind);
          const s = compileParam(p.scale, m.seed, steps, [1, 3], consts, m.kind);
          const rotAttr = layout.get("rot");
          const hasRot = rotAttr !== undefined && rotAttr.type === "f32" && rotAttr.tupleSize === 4;
          const sclAttr = layout.get("scale");
          const hasScale = sclAttr !== undefined && sclAttr.type === "f32" && sclAttr.tupleSize === 3;
          const pSlot = slotFor("P");
          written.set("P", pSlot);
          const refs: Record<string, BufRef> = { P: { kind: "slot", index: pSlot } };
          if (t.ref !== null) refs.translate = t.ref;
          if (r.ref !== null) refs.rotateEuler = r.ref;
          if (s.ref !== null) refs.scale = s.ref;
          if (hasRot) {
            const rotSlot = slotFor("rot");
            written.set("rot", rotSlot);
            refs.rot = { kind: "slot", index: rotSlot };
          }
          if (hasScale) {
            const sclSlot = slotFor("scale");
            written.set("scale", sclSlot);
            refs.scaleAttr = { kind: "slot", index: sclSlot };
          }
          steps.push(
            applyStep(
              makeTransformPointsApply(t.param, r.param, s.param, hasRot, hasScale),
              0,
              refs,
              consts,
            ),
          );
          break;
        }
        case "jitterPoints": {
          expectAttr("P", "f32", 3);
          const extraSeed = typeof p.seed === "number" ? p.seed : Number.NaN;
          const seed = hashCombine(m.seed, extraSeed);
          const a = compileParam(p.amount, seed, steps, [1, 3], consts, m.kind);
          const pSlot = slotFor("P");
          written.set("P", pSlot);
          const refs: Record<string, BufRef> = { P: { kind: "slot", index: pSlot } };
          if (a.ref !== null) refs.amount = a.ref;
          steps.push(applyStep(makeJitterPointsApply(a.param), seed, refs, consts));
          break;
        }
        case "orientAlongVector": {
          const axis = p.axis;
          if (!(ORIENT_AXES as readonly unknown[]).includes(axis)) throw new PlanFail("axis");
          if (!isVec3(p.up)) throw new PlanFail("up");
          const d = compileParam(p.direction, m.seed, steps, [1, 3], consts, m.kind);
          // The up hint normalizes in f64 exactly as the CPU node does;
          // the f32 rounding then happens once, in the uniform write.
          const up = p.up;
          const upLenSq = up[0] * up[0] + up[1] * up[1] + up[2] * up[2];
          const upInv = upLenSq > 0 ? 1 / Math.sqrt(upLenSq) : 0;
          const upUnit = [up[0] * upInv, up[1] * upInv, up[2] * upInv];
          for (const v of upUnit) {
            if (!Number.isFinite(Math.fround(v))) throw new PlanFail("up range");
          }
          const upRef = constSlot(upUnit, consts, m.kind);
          const rotAttr = layout.get("rot");
          const keepExisting = rotAttr !== undefined && rotAttr.type === "f32" && rotAttr.tupleSize === 4;
          const rotSlot = keepExisting ? slotFor("rot") : freshSlot("rot", 4, "quat-default");
          layout.set("rot", { type: "f32", tupleSize: 4 });
          written.set("rot", rotSlot);
          layoutOps.push({ op: "ensure-rot" });
          const refs: Record<string, BufRef> = { rot: { kind: "slot", index: rotSlot } };
          if (d.ref !== null) refs.direction = d.ref;
          steps.push(
            applyStep(makeOrientApply(d.param, axis as OrientAxis, upRef), 0, refs, consts),
          );
          break;
        }
        case "spawnInstances": {
          // Terminal-only by construction (`ResidentDesc.terminal`), but
          // a plan is a public artifact: reject a spawner anywhere but
          // last rather than composing from a mid-chain epoch.
          if (!isLast) throw new PlanFail("spawnInstances must be the run's last member");
          const assetId = p.assetId;
          if (typeof assetId !== "string" || assetId === "") throw new PlanFail("assetId");
          expectAttr("P", "f32", 3);
          const rawAttr = p.assetAttr;
          if (rawAttr !== undefined && typeof rawAttr !== "string") throw new PlanFail("assetAttr");
          const assetAttr = rawAttr === undefined ? "" : rawAttr;
          if (assetAttr !== "") {
            // The two conditions `buildInstanceBatches` throws on. The
            // resident descriptor's `eligible` predicate sees params only
            // and cannot inspect the geometry, so the check lives here —
            // and REJECTS rather than throws, so the per-node path serves
            // and raises the CPU spawner's identical, actionable message
            // (which attribute, and which string attributes exist).
            const key = layout.get(assetAttr);
            if (key === undefined) throw new PlanFail(`assetAttr "${assetAttr}" not on the point domain`);
            if (key.type !== "string") throw new PlanFail(`assetAttr "${assetAttr}" is ${key.type}, not string`);
          }
          const rotAttr = layout.get("rot");
          const hasRot = rotAttr !== undefined && rotAttr.type === "f32" && rotAttr.tupleSize === 4;
          const sclAttr = layout.get("scale");
          const hasScale =
            sclAttr !== undefined && sclAttr.type === "f32" && sclAttr.tupleSize === 3;
          const refs: Record<string, BufRef> = {
            P: { kind: "slot", index: slotFor("P") },
            transforms: { kind: "out" },
          };
          if (hasRot) refs.rot = { kind: "slot", index: slotFor("rot") };
          if (hasScale) refs.scaleAttr = { kind: "slot", index: slotFor("scale") };
          // Multi-asset spawns compose through a host-planned permutation
          // — one dispatch and one output buffer per asset. The asset key
          // is a host-resident string column by construction (no resident
          // node can produce one), so there is nothing to sort on device.
          const indexed = assetAttr !== "";
          if (indexed) refs.perm = { kind: "perm" };
          // Reads only: a spawner never writes an attribute, so nothing
          // joins `written` and the geometry is untouched.
          steps.push(
            applyStep(makeComposeInstancesApply(hasRot, hasScale, indexed), 0, refs, consts, indexed),
          );
          instances = {
            assetId,
            assetAttr,
            count,
            bytes: count * INSTANCE_MATRIX_BYTES,
            permBytes: indexed ? count * 4 : 0,
          };
          break;
        }
        default:
          throw new PlanFail(`unknown kind ${m.kind}`);
      }
      planned.push({ id: m.id, type: m.type, steps });
    }
  } catch (err) {
    if (err instanceof PlanFail) return REJECT;
    throw err;
  }

  const writtenList = [...written].map(([name, slot]) => ({ name, slot }));
  // A run with no other output must materialize whatever it wrote, so
  // ordinary (pre-existing) plans always read back exactly as before.
  const materialize = ctx.needsGeometry || instances === null;
  const slotBytes = slots.reduce((acc, s) => acc + s.bytes, 0);
  const colBytes = cols.reduce((acc, b) => acc + b, 0);
  const readbackBytes = materialize
    ? writtenList.reduce((acc, w) => acc + slots[w.slot].bytes, 0)
    : 0;
  // The retained buffers count against the run's bound like any other
  // allocation, even though they outlive the run: they are device memory
  // the run must be able to allocate. Their total is grouping-independent
  // (the batches partition the points), so this stays a plan-time number.
  const totalBytes =
    slotBytes + colBytes + readbackBytes + (instances?.bytes ?? 0) + (instances?.permBytes ?? 0);
  if (totalBytes > maxResidentBytes) return { reason: "run-too-large" };

  return {
    plan: {
      format: PLAN_FORMAT,
      count,
      members: planned,
      slots,
      cols,
      written: writtenList,
      layoutOps,
      materialize,
      instances,
      totalBytes,
    },
  };
}

// ---------------------------------------------------------------------------
// executor

/** Device services the evaluator lends the run executor. */
export interface RunExecEnv {
  readonly device: GpuDeviceLike;
  readonly pool: BufferPool;
  readonly maxElementsPerDispatch: number | undefined;
  /** Pipeline for a kernel key, compiling `wgsl` on miss; counts into `stats`. */
  getPipeline(key: string, wgsl: string, entryPoint: string, stats?: GpuCookStats): GpuComputePipelineLike;
}

const ATTR_CTORS: Partial<Record<AttrType, new (b: ArrayBuffer, o: number, l: number) => Float32Array | Int32Array | Uint32Array>> = {
  f32: Float32Array,
  i32: Int32Array,
  u32: Uint32Array,
};

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Execute a compiled run plan: acquire and initialize resident buffers,
 * encode every member's kernels (field kernels, then the apply kernel)
 * as ordered dispatches in one compute pass, submit once, read back the
 * written attributes with a single map, and materialize the terminal's
 * output geometry exactly as the CPU chain would (clone + replayed
 * layout ops + column writes).
 *
 * Cancellation and budget are honored at member granularity between
 * kernel encodings: cancellation throws the standard
 * `CookCancelledError` (buffers release un-mapped in `finally`);
 * budgetMs yields to the event loop mirroring the executor's slice
 * policy. Once submitted, the single readback await completes and a
 * late cancellation surfaces before materialization.
 */
export async function executeResidentRun(
  env: RunExecEnv,
  plan: ResidentRunPlan,
  input: ResidentRunInput,
  stats: GpuCookStats | undefined,
): Promise<ResidentRunResult> {
  const { device, pool } = env;
  const { geo, signal, budgetMs } = input;
  const count = plan.count;
  if (geo.attrs.point.count !== count) {
    throw new Error(
      `resident run: plan was built for ${count} points but the input geometry has ` +
        `${geo.attrs.point.count}; plans are single-cook artifacts — re-plan for new inputs`,
    );
  }
  const checkCancelled = (): void => {
    if (signal?.aborted) throw new CookCancelledError();
  };

  const acquired: GpuBufferLike[] = [];
  const acquire = (size: number, usage: number): GpuBufferLike => {
    const buf = pool.acquire(size, usage);
    acquired.push(buf);
    return buf;
  };
  /**
   * Buffers whose ownership has left the pool this run: the retained
   * instance-transform buffers, one per asset batch. The `finally` below
   * must not release them — the pool no longer owns them and would
   * throw — and a failure after the transfer must destroy them through
   * their handle, so a broken run never leaks device memory.
   */
  const retained = new Set<GpuBufferLike>();
  /**
   * Handles minted this run, in batch order. Every buffer whose
   * ownership left the pool is either destroyed on the spot (the one
   * failure window below) or reachable through exactly one entry here,
   * so the `catch` frees each exactly once — `dispose()` is idempotent,
   * and no two entries wrap the same `DetachedBuffer`.
   */
  const retainedHandles: DeviceTransformsHandle[] = [];

  try {
    // Resident attribute buffers. Uploads cover the full live range any
    // kernel reads (count * tupleSize scalars), so pooled stale bytes
    // are unreachable; "none" slots are fully overwritten before any
    // read by construction (setAttribute targets).
    const set = geo.attrs.point;
    const slotBufs = plan.slots.map((slot) => {
      const buf = acquire(slot.bytes, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST | BUFFER_USAGE.COPY_SRC);
      if (slot.init === "attr") {
        const attr = set.require(slot.name);
        const n = slot.bytes / 4;
        if (attr.data instanceof Uint8Array) {
          const widened = new Uint32Array(n);
          for (let i = 0; i < n; i++) widened[i] = attr.data[i];
          device.queue.writeBuffer(buf, 0, widened);
        } else {
          device.queue.writeBuffer(buf, 0, attr.data.subarray(0, n));
        }
      } else if (slot.init === "quat-default") {
        const fill = new Float32Array(slot.bytes / 4);
        for (let i = 3; i < fill.length; i += 4) fill[i] = 1;
        device.queue.writeBuffer(buf, 0, fill);
      }
      return buf;
    });
    const colBufs = plan.cols.map((bytes) =>
      acquire(bytes, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST | BUFFER_USAGE.COPY_SRC),
    );

    // Grouping. Computed HERE, on the host, by the very function the CPU
    // spawner calls — so device batch order, membership, and within-batch
    // order are the CPU spec by construction, not by resemblance. The
    // asset key is always a host string column (no resident node can
    // produce one), so this needs no readback and no device-side sort.
    const grouping =
      plan.instances === null
        ? undefined
        : groupPointsByAsset(geo, {
            defaultAssetId: plan.instances.assetId,
            ...(plan.instances.assetAttr !== "" ? { assetAttr: plan.instances.assetAttr } : {}),
          });
    const permBuf =
      plan.instances !== null && plan.instances.permBytes > 0
        ? acquire(plan.instances.permBytes, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST)
        : undefined;
    if (permBuf !== undefined && grouping !== undefined) {
      device.queue.writeBuffer(permBuf, 0, grouping.perm);
    }
    // Retained instance transforms, ONE BUFFER PER ASSET. VERTEX so a
    // renderer can bind them as instance data without a copy, COPY_SRC so
    // they can be read back for verification, STORAGE because the compose
    // kernel writes them. N whole buffers rather than sub-ranges of one:
    // the renderer seam binds a buffer with no offset or size, and
    // identity-keyed handle refcounting stays correct only when each
    // batch carries its own buffer.
    const outBufs: GpuBufferLike[] =
      grouping === undefined
        ? []
        : Array.from(grouping.counts, (n) =>
            acquire(
              n * INSTANCE_MATRIX_BYTES,
              BUFFER_USAGE.STORAGE |
                BUFFER_USAGE.COPY_DST |
                BUFFER_USAGE.COPY_SRC |
                BUFFER_USAGE.VERTEX,
            ),
          );
    const bufFor = (ref: BufRef, batch: number): GpuBufferLike => {
      if (ref.kind === "slot") return slotBufs[ref.index];
      if (ref.kind === "col") return colBufs[ref.index];
      if (ref.kind === "perm") {
        if (permBuf === undefined) {
          throw new Error(
            "resident run: a kernel binds the grouping permutation but the plan declares no " +
              "per-point asset attribute (plan and kernels disagree)",
          );
        }
        return permBuf;
      }
      const out = outBufs[batch];
      if (out === undefined) {
        throw new Error(
          "resident run: a kernel binds a retained instance-transform buffer but the plan " +
            "declares no instances output (plan and kernels disagree)",
        );
      }
      return out;
    };

    // One compute pass; consecutive dispatches have implicit write
    // visibility (per-dispatch usage scopes), which is the run's
    // member-ordering guarantee.
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    let sliceStart = performance.now();
    for (const member of plan.members) {
      checkCancelled();
      for (const step of member.steps) {
        const pipeline = env.getPipeline(step.key, step.wgsl, step.entryPoint, stats);
        pass.setPipeline(pipeline);
        // Chunk plan (shared with the per-node path): non-final chunks
        // are exact workgroup multiples — chunks partition the range.
        const chunk = chunkCapacity(step.workgroupSize, env.maxElementsPerDispatch);
        // Element ranges this step dispatches over. Ordinary steps cover
        // the whole domain once; the multi-asset compose kernel covers
        // one batch per range, `base` selecting that batch's slice of the
        // permutation. Batches partition the points, so the union of the
        // ranges is still exactly [0, count) and every output slot of
        // every buffer is written by exactly one invocation.
        const ranges =
          step.perBatch && grouping !== undefined
            ? Array.from(grouping.counts, (n, j) => ({
                batch: j,
                elements: n,
                base: grouping.offsets[j],
              }))
            : // Batch 0 is the only batch a non-per-batch step can mean:
              // constant mode has exactly one, and in attribute mode the
              // compose kernel — the only step that binds `out` at all —
              // is always per-batch.
              [{ batch: 0, elements: count, base: 0 }];
        for (const range of ranges) {
          // One dispatch counted per range: chunking never multiplies the
          // counter, but per-asset dispatches are genuinely distinct
          // kernels over distinct ranges and each counts once.
          if (stats !== undefined) stats.dispatches++;
          // Uniform bytes for this step: the scalar header (plus `base`
          // when the kernel indexes through a permutation), plus the
          // step's constant slots when it has any. Constants are
          // chunk-invariant, so only chunkOffset changes between writes;
          // the f32 view rounds each value exactly once, matching the
          // constant column these slots replace.
          const uniformData = new ArrayBuffer(step.uniformBytes);
          const uniformBytes = new Uint8Array(uniformData);
          const header = new Uint32Array(uniformData, 0, step.uniformBytes >= 16 ? 4 : 3);
          header[0] = range.elements;
          header[1] = step.seed >>> 0;
          if (step.perBatch) header[3] = range.base;
          if (step.consts.length > 0) {
            new Float32Array(uniformData, APPLY_CONST_OFFSET, step.consts.length).set(step.consts);
          }
          const chunkCount = Math.ceil(range.elements / chunk);
          for (let c = 0; c < chunkCount; c++) {
            const uniformBuf = acquire(step.uniformBytes, BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST);
            header[2] = c * chunk;
            device.queue.writeBuffer(uniformBuf, 0, uniformBytes);
            const bindGroup = device.createBindGroup({
              layout: pipeline.getBindGroupLayout(0),
              entries: [
                { binding: step.uniformsBinding, resource: { buffer: uniformBuf } },
                ...step.bindings.map((b) => ({
                  binding: b.binding,
                  resource: { buffer: bufFor(b.ref, range.batch) },
                })),
              ],
            });
            const elements = Math.min(chunk, range.elements - c * chunk);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(Math.ceil(elements / step.workgroupSize));
          }
        }
      }
      if (budgetMs !== undefined && performance.now() - sliceStart > budgetMs) {
        await yieldToEventLoop();
        checkCancelled();
        sliceStart = performance.now();
      }
    }
    pass.end();

    // Single readback: every written attribute's final buffer copied
    // into one staging buffer at consecutive offsets, one mapAsync.
    // Skipped entirely when the plan materializes no geometry — the
    // device-resident terminal case, where nothing crosses to the CPU.
    const offsets: number[] = [];
    let readBuf: GpuBufferLike | undefined;
    // A materializing run whose members wrote NOTHING (a spawner
    // terminal whose geometry someone reads) has nothing to read back:
    // no staging buffer, no zero-length map, just the cloned input.
    const readbackBytes = plan.materialize
      ? plan.written.reduce((acc, w) => acc + plan.slots[w.slot].bytes, 0)
      : 0;
    if (readbackBytes > 0) {
      readBuf = acquire(readbackBytes, BUFFER_USAGE.COPY_DST | BUFFER_USAGE.MAP_READ);
      let offset = 0;
      for (const w of plan.written) {
        const bytes = plan.slots[w.slot].bytes;
        encoder.copyBufferToBuffer(slotBufs[w.slot], 0, readBuf, offset, bytes);
        offsets.push(offset);
        offset += bytes;
      }
    }
    device.queue.submit([encoder.finish()]);

    let out: Geometry | undefined;
    if (plan.materialize) {
      let copy: ArrayBuffer | undefined;
      if (readBuf !== undefined) {
        await readBuf.mapAsync(MAP_MODE.READ, 0, readbackBytes);
        try {
          copy = readBuf.getMappedRange(0, readbackBytes).slice(0);
        } finally {
          // Never release a mapped buffer into the pool (phase-22 contract).
          readBuf.unmap();
        }
      }
      checkCancelled();

      // Materialize the terminal output: clone the input (untouched
      // attributes and topology pass through exactly as every CPU member
      // would carry them), replay the layout ops in member order (same
      // replace/remove/add calls, so shapes, defaults, and attribute
      // insertion order match the per-node path), then write the read
      // back columns.
      out = cloneGeometry(geo);
      const outSet = out.attrs.point;
      for (const op of plan.layoutOps) {
        if (op.op === "replace") {
          outSet.replace(op.name, op.type, op.tupleSize);
        } else {
          // orientAlongVector's rot (re)creation, verbatim from the node.
          const rotAttr = outSet.get("rot");
          if (!rotAttr || rotAttr.type !== "f32" || rotAttr.tupleSize !== 4) {
            if (rotAttr) outSet.remove("rot");
            outSet.add("rot", "f32", 4, [0, 0, 0, 1]);
          }
        }
      }
      plan.written.forEach((w, wi) => {
        const attr = outSet!.require(w.name);
        const n = count * attr.tupleSize;
        if (copy === undefined) throw new Error("resident run: readback missing for a written attribute");
        if (attr.data instanceof Uint8Array) {
          // bool attributes ride as u32 0/1; narrow back.
          const wide = new Uint32Array(copy, offsets[wi], n);
          for (let i = 0; i < n; i++) attr.data[i] = wide[i];
        } else {
          const Ctor = ATTR_CTORS[attr.type];
          if (Ctor === undefined) {
            throw new Error(`resident run: cannot materialize attribute "${w.name}" of type ${attr.type}`);
          }
          attr.data.set(new Ctor(copy, offsets[wi], n));
        }
      });
    } else {
      checkCancelled();
    }

    // Ownership transfer, LAST and after the final cancellation check —
    // the WHOLE loop, not just its first iteration: up to here every
    // retained buffer is still the pool's and the `finally` reclaims it
    // on any failure, cancellation included. From each detach on, that
    // buffer belongs to its handle, and therefore to whoever receives the
    // result.
    let deviceBatches: readonly DeviceInstanceBatch[] | undefined;
    if (plan.instances !== null) {
      if (grouping === undefined || outBufs.length !== grouping.order.length) {
        throw new Error(
          "resident run: the plan declares an instances output but the acquired transform " +
            "buffers do not match the grouping (library bug: plan.instances, the grouping, and " +
            "the acquired buffers must agree)",
        );
      }
      const batches: DeviceInstanceBatch[] = [];
      for (let j = 0; j < grouping.order.length; j++) {
        const assetId = grouping.order[j];
        const batchCount = grouping.counts[j];
        const detached = pool.detach(outBufs[j]);
        // From this instant the pool no longer owns the buffer, so the
        // `finally` must skip it (releasing a detached buffer throws).
        retained.add(outBufs[j]);
        let handle: DeviceTransformsHandle;
        try {
          handle = makeDeviceTransformsHandle(
            detached,
            batchCount * INSTANCE_MATRIX_BYTES,
            `${batchCount} instances of "${assetId}"`,
          );
        } catch (err) {
          // Nothing else can reach this buffer now: neither the pool nor
          // a handle holds it. Free it here or it is stranded for good.
          detached.destroy();
          throw err;
        }
        retainedHandles.push(handle);
        batches.push({ residency: "device", assetId, count: batchCount, transforms: handle });
      }
      deviceBatches = batches;
    }

    if (stats !== undefined) {
      stats.residentRuns++;
      stats.fusedNodes += plan.members.length;
      // One readback per member on the per-node path; this run did one
      // (materializing) or none (device-resident terminal).
      stats.readbacksSaved += plan.members.length - (plan.materialize ? 1 : 0);
    }
    const result: { geo?: Geometry; deviceBatches?: readonly DeviceInstanceBatch[] } = {};
    if (out !== undefined) result.geo = out;
    if (deviceBatches !== undefined) result.deviceBatches = deviceBatches;
    return result;
  } catch (err) {
    // A failure after a transfer would otherwise strand that buffer:
    // nobody holds its handle yet, so free it here. Exactly once per
    // buffer — one handle per detach, and `dispose()` is idempotent — so
    // a partial build that detached 3 of 5 frees those 3 and leaves the
    // other 2 to the `finally` reclaim.
    for (const handle of retainedHandles) handle.dispose();
    if (err instanceof CookCancelledError) throw err;
    throw new Error(
      `GpuFieldEvaluator: resident run failed (${plan.members.length} fused nodes ` +
        `[${plan.members.map((m) => `"${m.id}"`).join(", ")}], ${count} points): ` +
        `${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  } finally {
    for (const buf of acquired) {
      if (!retained.has(buf)) pool.release(buf);
    }
  }
}
