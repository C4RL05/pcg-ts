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
 * Per-instance colour (phase 45): with `colorAttr` set, the SAME compose
 * kernel gathers components 0-2 of that attribute into a second retained
 * buffer per batch, from the same source index that placed the matrix.
 * Sharing the index is the correctness argument and it mirrors the CPU
 * spawner's single loop; and because a colour is COPIED rather than
 * computed, the device bytes must equal the CPU batch's exactly — there
 * is no ULP class here to spend, unlike compose-TRS. The one thing not
 * shared with the CPU batch is the stride: the device buffer holds
 * {@link INSTANCE_COLOR_BYTES} per instance where the CPU array packs 12,
 * because a renderer binds it as `array<vec3<f32>>`.
 *
 * The spawner's `MAX_INSTANCES` budget is enforced here too, as a
 * `PlanFail`: the run is rejected, its members cook per-node, and the CPU
 * spawner raises the single diagnostic. Same mechanism an unsupported
 * `assetAttr` already uses, so no new fallback reason exists and the two
 * paths cannot word the refusal differently.
 *
 * Pool discipline: every buffer is released in a `finally` (never
 * mapped — the readback unmaps in its own `finally`), on success,
 * failure, and cancellation alike. The one exception is the retained
 * transform and colour buffers, and it is an exception by construction
 * rather than by omission: ownership transfers in the very last loop before the
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
import { deviceSpec, type FieldSpecArg } from "../fields/spec.js";
import { hashCombine } from "../random/index.js";
import { groupPointsByAsset } from "../spawn/grouping.js";
import { MAX_INSTANCES } from "../spawn/instances.js";
import {
  APPLY_CONST_COMPONENTS,
  APPLY_CONST_OFFSET,
  INSTANCE_COLOR_COMPONENTS,
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
   * The retained instance-COLOUR buffer of the batch being dispatched
   * (spawner terminal with `colorAttr` set). Per batch for exactly the
   * reasons `out` is: the batch shapes are data, and the renderer seam
   * binds a whole buffer.
   */
  | { readonly kind: "colorOut" }
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
   * multi-asset spawner terminal sets it; every other step is `false`.
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
 * Bytes one instance's device-resident RGB occupies: **16**, not 12.
 *
 * The CPU batch packs colour at 3 floats per instance; the device buffer
 * carries a fourth, zeroed. That is the WGSL `array<vec3<f32>>` stride a
 * renderer binds this buffer as, not a rounding-up of our own — see
 * {@link INSTANCE_COLOR_COMPONENTS}. Keeping the two numbers apart in the
 * source (12 there, 16 here) is the point: a single shared "colour bytes"
 * constant would be wrong for one of the two paths.
 */
export const INSTANCE_COLOR_BYTES = INSTANCE_COLOR_COMPONENTS * 4;

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
   * constant mode (exactly one batch, no permutation, and the
   * non-indexed compose kernel).
   */
  readonly assetAttr: string;
  /**
   * f32 point attribute (tupleSize >= 3) whose components 0-2 the compose
   * kernel gathers as each instance's RGB, or `""` for no colour — in
   * which case no colour buffer is allocated, no colour binding exists,
   * and the kernel text is what it always was.
   */
  readonly colorAttr: string;
  /** Tuple size of that attribute (the kernel's stride into it); 0 when uncoloured. */
  readonly colorTupleSize: number;
  /** Points the terminal composes (always `plan.count`). */
  readonly count: number;
  /** Retained transform bytes across every batch: `count * INSTANCE_MATRIX_BYTES`. */
  readonly bytes: number;
  /** Retained colour bytes across every batch: `count * INSTANCE_COLOR_BYTES`, or 0. */
  readonly colorBytes: number;
  /** Permutation upload: `count * 4` in attribute mode, 0 in constant mode. */
  readonly permBytes: number;
}

const PLAN_FORMAT = "pcg-resident-run/5";

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

/**
 * Does this spec key on POINT IDENTITY? `randomField` hashes the stored
 * BIT PATTERN of P (see `src/data/identity.ts`), so once a resident run
 * has rewritten P with device float math, an ulp of drift from the CPU's
 * f64 is no longer a small error in the answer — it is a different key
 * and an unrelated random number. The doctrine is explicit: an ulp is
 * acceptable where it perturbs a magnitude and never where it decides a
 * key, so an identity-keyed step after a device P write declines the run
 * rather than spend the tolerance it cannot honour.
 *
 * The amplification is measured, not feared. Nudging every P component of
 * a scattered cloud by exactly ONE ulp and re-evaluating the 08-gpu-fields
 * tint field moves it by up to 2.1e-1 (mean 2.7e-2), on 99.5% of
 * components — about 2.2e6 range-ULP. Zero the one `randomField` term in
 * that same field and the identical nudge moves it by 7.8e-7, or 8.2
 * range-ULP, inside the 24-ULP noise budget. That six-order-of-magnitude
 * gap between "reads position" and "keys on position" is the whole reason
 * this predicate exists.
 *
 * Stated as an invariant, because "identity-keyed chains cannot be
 * device-resident" is the wrong lesson and the tempting one: a run may
 * REWRITE P, or it may KEY ON IDENTITY, but not in that order within one
 * run. Identity-keyed members are perfectly fusable — `[tint, psize]` of
 * the 08-gpu-fields chain plans as a two-member run on its own — and a
 * chain that hits this rule usually fuses in full once the identity-keyed
 * members are ordered AHEAD of the P writers (measured: the demo's
 * wobble → tint → psize → jitter → xform ordering plans all five). That
 * reordering changes what the graph MEANS, so it is an authoring choice,
 * never something the planner may do on the author's behalf.
 *
 * Two properties of this rule are load-bearing. Both cost real fusion —
 * the 08-gpu-fields chain (setAttribute → jitterPoints → transformPoints
 * → setAttribute(tint) → setAttribute(psize), where tint and psize carry
 * `randomField`) fused as one five-member run before identity keying and
 * plans as NO run at all after it (the executor recovers its last two
 * members; see the note on the executor's suffix retry below) — so both
 * will look like something to optimize. They are not.
 *
 * WHY THE WHOLE RUN, NOT JUST THE MEMBER. `PlanFail` rejects the entire
 * run (see the catch at the end of `planResidentRun`); the planner never
 * truncates in front of the offending member and never hands back a
 * fusable PREFIX. Declining only this member — or truncating the run in
 * front of it — would leave the P-WRITING members fused. The device would
 * still compute P (`transformPoints` builds its quaternion from euler
 * degrees with WGSL `sin`/`cos`, a tolerance-bounded op family and not a
 * bit-exact one), materialize the drifted bits, and the identity-keyed
 * member would hash them one node later instead of one kernel later: the
 * same unrelated random number, the same divergence from the CPU
 * reference, with only the boundary moved. Rejecting the run is what
 * pushes the P ARITHMETIC back onto the CPU, and that is the whole
 * benefit — a prefix-truncating planner would keep none of it.
 *
 * What the EXECUTOR does with the rejection is the mirror image, and it
 * is safe for the same reason this one is not: it re-offers the chain
 * minus its FIRST member (`narrowRun` in src/graph/execute.ts), repeating
 * until a suffix plans. Dropping from the front is what returns the P
 * arithmetic to the CPU; every surviving suffix is planned here from
 * scratch, against the layout and the CPU-produced bytes entering its own
 * first member, so this rule decides it exactly as it decides any other
 * run. The 08-gpu-fields chain narrows three times and fuses [tint,
 * psize]. A run that merely did not FIT is not narrowed — see
 * RESOURCE_REJECTION there for why a memory bound must not decide bits.
 *
 * WHY IT IS NOT NARROWER. "Decline only when the member actually reads
 * the P the run rewrote" is this same rule: `randomField` always reads P
 * (`collectAttrNames` in compile.ts lists P and `seed` for it
 * unconditionally), so no admitted spec keys on identity without reading
 * the resident P. "Decline only when the rewrite was not provably
 * bit-exact" would need a proof, per member and per constant value, that
 * the device's f32 expression rounds identically to the CPU node's f64
 * arithmetic stored once to f32. That proof does not exist for euler
 * rotation at all, and for the exact cases (identity rotation,
 * power-of-two scale) it would lapse silently the first time either side
 * reorders its arithmetic. Narrowing needs that proof mechanized against
 * both implementations, not asserted at the call site.
 *
 * Scope, so it is not mistaken for a guarantee it does not give. This
 * guards the P half of the identity WITHIN one run, and nothing wider.
 * Three holes are known and open:
 *   - the `seed` half is not checked at all (a fused `setAttribute`
 *     writing the `seed` attribute is admitted today);
 *   - a run BOUNDARY — a tap, a declared output — still hands a
 *     device-written P to an identity-keyed node cooking behind it;
 *   - the PER-FIELD path reaches P too. `jitterPoints` moves P by an
 *     `amount` that may itself have been resolved on the device, and
 *     measured on this adapter the 08-gpu-fields `wobble` field
 *     (perlin + remap) is NOT bit-exact — 17.8 range-ULP — so a
 *     CPU-applied jitter over a device-resolved amount already lands P on
 *     different bits than a pure-CPU cook, with the amplification above.
 * So this rule shrinks the CPU/GPU divergence on identity-keyed values;
 * it does not close it. Closing it needs a rule one level up, about which
 * values are allowed to reach a P write, not about run membership.
 */
function specKeysOnIdentity(v: unknown): boolean {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const spec = v as Record<string, unknown>;
  if (spec.fn === "randomField") return true;
  const args = spec.args;
  if (Array.isArray(args)) {
    for (const a of args) if (specKeysOnIdentity(a)) return true;
  }
  const opts = spec.opts;
  if (typeof opts === "object" && opts !== null) {
    if (specKeysOnIdentity((opts as Record<string, unknown>).position)) return true;
  }
  return false;
}

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
 *
 * `acceptDerivedSpecs` is the calling evaluator's advertised flag and is
 * required rather than defaulted: this seam is defence in depth (the
 * executor's fusion gate already filters members by the same predicate),
 * and a default would let a caller silently plan against a narrower rule
 * than the one whose memo keys were salted.
 */
export function planResidentRun(
  members: readonly ResidentMemberDesc[],
  ctx: ResidentRunContext,
  maxResidentBytes: number,
  acceptDerivedSpecs: boolean,
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
      // THE eligibility predicate again, with the flag the caller was
      // constructed with — so a run never fuses what the per-field path
      // would decline, and never declines what it would accept.
      const s = deviceSpec(value, acceptDerivedSpecs);
      if (s === undefined) throw new PlanFail("no spec");
      // See specKeysOnIdentity: a resident P that device math has already
      // rewritten is not the P the CPU would hash.
      if (written.has("P") && specKeysOnIdentity(s)) throw new PlanFail("identity after P write");
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
          // The offset is keyed on the incoming position BITS, so this
          // may only run on a P the device has not rewritten yet — the
          // uploaded one is bit-identical to the CPU's; one that a fused
          // transformPoints or an earlier jitter has moved is not. See
          // specKeysOnIdentity.
          if (written.has("P")) throw new PlanFail("identity after P write");
          const extraSeed = typeof p.seed === "number" ? p.seed : Number.NaN;
          const seed = hashCombine(m.seed, extraSeed);
          const a = compileParam(p.amount, seed, steps, [1, 3], consts, m.kind);
          // The offset is keyed on point identity, so the `seed` attribute
          // is an input here. Absent, it contributes 0 exactly as the CPU
          // substitutes; present in any other shape than the standard u32
          // scalar, the run declines rather than guess at the bits.
          const seedAttr = layout.get("seed");
          const hasSeedAttr = seedAttr !== undefined;
          if (hasSeedAttr && (seedAttr.type !== "u32" || seedAttr.tupleSize !== 1)) {
            throw new PlanFail("seed attribute shape");
          }
          const pSlot = slotFor("P");
          written.set("P", pSlot);
          const refs: Record<string, BufRef> = { P: { kind: "slot", index: pSlot } };
          if (a.ref !== null) refs.amount = a.ref;
          if (hasSeedAttr) refs.seed = { kind: "slot", index: slotFor("seed") };
          steps.push(applyStep(makeJitterPointsApply(a.param, hasSeedAttr), seed, refs, consts));
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
          // The spawner's per-cook budget, decided on BOTH paths or the
          // graph throws on one and cooks on the other. It rejects rather
          // than throws, for the same reason the assetAttr checks below
          // do: the run falls back per-node and `buildInstanceBatches`
          // raises THE message — the one naming the count, the ceiling,
          // the 64 MiB it stands for, and the four ways out. There is no
          // second wording of it to drift, and no new fallback reason.
          if (count > MAX_INSTANCES) throw new PlanFail(`${count} instances over MAX_INSTANCES`);
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
          const rawColor = p.colorAttr;
          if (rawColor !== undefined && typeof rawColor !== "string") throw new PlanFail("colorAttr");
          const colorAttr = rawColor === undefined ? "" : rawColor;
          let colorTupleSize = 0;
          if (colorAttr !== "") {
            // The shape rule of `requireRgbSource`, decided from the
            // LAYOUT (all this planner sees) and rejecting rather than
            // throwing — so a mis-shaped colorAttr reaches the CPU
            // spawner, which explains it and lists what would fit.
            const col = layout.get(colorAttr);
            if (col === undefined) throw new PlanFail(`colorAttr "${colorAttr}" not on the point domain`);
            if (col.type !== "f32" || col.tupleSize < 3) {
              throw new PlanFail(`colorAttr "${colorAttr}" is ${col.type}x${col.tupleSize}`);
            }
            colorTupleSize = col.tupleSize;
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
          if (colorTupleSize > 0) {
            // Read through `slotFor`, so a colour an earlier member WROTE
            // is read from that member's epoch — the same "latest bytes"
            // the CPU spawner sees when it reads the chain's output.
            refs.color = { kind: "slot", index: slotFor(colorAttr) };
            refs.colors = { kind: "colorOut" };
          }
          // Reads only: a spawner never writes an attribute, so nothing
          // joins `written` and the geometry is untouched.
          steps.push(
            applyStep(
              makeComposeInstancesApply(hasRot, hasScale, indexed, colorTupleSize),
              0,
              refs,
              consts,
              indexed,
            ),
          );
          instances = {
            assetId,
            assetAttr,
            colorAttr,
            colorTupleSize,
            count,
            bytes: count * INSTANCE_MATRIX_BYTES,
            colorBytes: colorTupleSize > 0 ? count * INSTANCE_COLOR_BYTES : 0,
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
    slotBytes +
    colBytes +
    readbackBytes +
    (instances?.bytes ?? 0) +
    (instances?.colorBytes ?? 0) +
    (instances?.permBytes ?? 0);
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
   * instance-transform buffers (one per asset batch) and, when the
   * spawner asked for colour, the instance-colour buffers beside them.
   * The `finally` below must not release them — the pool no longer owns
   * them and would throw — and a failure after the transfer must destroy
   * them through their handle, so a broken run never leaks device memory.
   */
  const retained = new Set<GpuBufferLike>();
  /**
   * Handles minted this run, in batch order (transforms then colours
   * within a batch). Every buffer whose ownership left the pool is either
   * destroyed on the spot (the one failure window below) or reachable
   * through exactly one entry here, so the `catch` frees each exactly
   * once — `dispose()` is idempotent, and no two entries wrap the same
   * `DetachedBuffer`.
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
    const RETAINED_USAGE =
      BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST | BUFFER_USAGE.COPY_SRC | BUFFER_USAGE.VERTEX;
    const outBufs: GpuBufferLike[] =
      grouping === undefined
        ? []
        : Array.from(grouping.counts, (n) => acquire(n * INSTANCE_MATRIX_BYTES, RETAINED_USAGE));
    // Instance colours: a SECOND retained buffer per batch, allocated
    // with the same flags because a renderer binds it the same way. 16
    // bytes per instance, not 12 — see INSTANCE_COLOR_BYTES.
    const colorOutBufs: GpuBufferLike[] =
      grouping === undefined || plan.instances === null || plan.instances.colorBytes === 0
        ? []
        : Array.from(grouping.counts, (n) => acquire(n * INSTANCE_COLOR_BYTES, RETAINED_USAGE));
    const bufFor = (ref: BufRef, batch: number): GpuBufferLike => {
      if (ref.kind === "slot") return slotBufs[ref.index];
      if (ref.kind === "col") return colBufs[ref.index];
      if (ref.kind === "colorOut") {
        const colorOut = colorOutBufs[batch];
        if (colorOut === undefined) {
          throw new Error(
            "resident run: a kernel binds a retained instance-colour buffer but the plan " +
              "declares no colour output (plan and kernels disagree)",
          );
        }
        return colorOut;
      }
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
      const wantsColor = plan.instances.colorBytes > 0;
      if (
        grouping === undefined ||
        outBufs.length !== grouping.order.length ||
        colorOutBufs.length !== (wantsColor ? grouping.order.length : 0)
      ) {
        throw new Error(
          "resident run: the plan declares an instances output but the acquired transform " +
            "buffers do not match the grouping (library bug: plan.instances, the grouping, and " +
            "the acquired buffers must agree)",
        );
      }
      /**
       * Detach one retained buffer and wrap it, freeing it on the spot if
       * the wrap fails — that is the ONE window where neither the pool
       * nor a handle can reach it. Every handle it returns is pushed to
       * `retainedHandles` by the caller, so the `catch` frees it exactly
       * once if a LATER batch (or a later buffer of this batch) throws.
       */
      const retain = (buf: GpuBufferLike, bytes: number, label: string): DeviceTransformsHandle => {
        const detached = pool.detach(buf);
        // From this instant the pool no longer owns the buffer, so the
        // `finally` must skip it (releasing a detached buffer throws).
        retained.add(buf);
        try {
          return makeDeviceTransformsHandle(detached, bytes, label);
        } catch (err) {
          detached.destroy();
          throw err;
        }
      };
      const batches: DeviceInstanceBatch[] = [];
      for (let j = 0; j < grouping.order.length; j++) {
        const assetId = grouping.order[j];
        const batchCount = grouping.counts[j];
        const handle = retain(
          outBufs[j],
          batchCount * INSTANCE_MATRIX_BYTES,
          `${batchCount} instances of "${assetId}"`,
        );
        retainedHandles.push(handle);
        if (!wantsColor) {
          batches.push({ residency: "device", assetId, count: batchCount, transforms: handle });
          continue;
        }
        const colors = retain(
          colorOutBufs[j],
          batchCount * INSTANCE_COLOR_BYTES,
          `${batchCount} instance colours of "${assetId}"`,
        );
        retainedHandles.push(colors);
        batches.push({
          residency: "device",
          assetId,
          count: batchCount,
          transforms: handle,
          colors,
        });
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
