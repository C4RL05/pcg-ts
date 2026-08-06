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
 * Memory bound: a run's working set — resident attribute buffers
 * (every epoch) + field temp columns (held for the whole run) + the
 * readback staging buffer — is computed at plan time and compared
 * against the evaluator's `maxResidentBytes` (default 512 MiB);
 * over-budget runs return null (`run-too-large`) and the per-node path
 * serves. The bound counts logical bytes: pow2 pool bucketing can
 * allocate up to 2x, and per-chunk 12-byte uniforms are not counted.
 *
 * Pool discipline: every buffer is released in a `finally` (never
 * mapped — the readback unmaps in its own `finally`), on success,
 * failure, and cancellation alike.
 */
import type { AttrType, Geometry } from "../data/index.js";
import {
  isField,
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
import {
  makeJitterPointsApply,
  makeOrientApply,
  makeSetAttributeApply,
  makeTransformPointsApply,
  type ApplyColRef,
  type ApplyKernel,
} from "./applyKernels.js";
import { compileFieldSpec } from "./compile.js";
import {
  BUFFER_USAGE,
  MAP_MODE,
  type GpuBufferLike,
  type GpuComputePipelineLike,
  type GpuDeviceLike,
} from "./device.js";
import type { BufferPool } from "./pool.js";
import type { CompiledFieldKernel, FieldKernelAttr, GpuScalarType } from "./types.js";

/** Byte size of the kernel uniform struct {count, seed, chunkOffset}. */
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

type BufRef = { readonly kind: "slot"; readonly index: number } | { readonly kind: "col"; readonly index: number };

interface KernelStep {
  /** Pipeline-cache key. */
  readonly key: string;
  readonly wgsl: string;
  readonly entryPoint: string;
  readonly workgroupSize: number;
  /** Uniform seed for this kernel (u32-coerced at dispatch). */
  readonly seed: number;
  readonly uniformsBinding: number;
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

const PLAN_FORMAT = "pcg-resident-run/1";

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
  /** Logical working-set bytes (slots + cols + readback staging). */
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
   * Compile one field-capable param into a field kernel step writing a
   * temp column; plain values compile as constants. Returns the column
   * ref for the apply kernel.
   */
  const compileParam = (
    value: unknown,
    seed: number,
    steps: KernelStep[],
    allowedTuples: readonly number[] | null,
  ): { col: ApplyColRef; ref: BufRef } => {
    let spec: FieldSpecArg;
    if (isField(value)) {
      const s = getFieldSpec(value);
      if (s === undefined) throw new PlanFail("no spec");
      spec = s;
    } else if (typeof value === "number" || (Array.isArray(value) && value.every((x) => typeof x === "number"))) {
      spec = value as FieldSpecArg;
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
      bindings: [
        ...kernel.inputs.map((inp) => ({ binding: inp.binding, ref: { kind: "slot", index: slotFor(inp.name) } as BufRef })),
        { binding: kernel.bindings.output, ref: { kind: "col", index: colIndex } },
      ],
    });
    return { col: { type: kernel.outType, tupleSize: kernel.outTupleSize }, ref: { kind: "col", index: colIndex } };
  };

  /** Apply-kernel step from a generated kernel + role→buffer mapping. */
  const applyStep = (kernel: ApplyKernel, seed: number, refs: Record<string, BufRef>): KernelStep => ({
    key: kernel.key,
    wgsl: kernel.wgsl,
    entryPoint: kernel.entryPoint,
    workgroupSize: kernel.workgroupSize,
    seed,
    uniformsBinding: 0,
    bindings: kernel.bindings.map((b) => {
      const ref = refs[b.role];
      if (ref === undefined) throw new PlanFail(`unmapped role ${b.role}`);
      return { binding: b.binding, ref };
    }),
  });

  try {
    for (const m of members) {
      const steps: KernelStep[] = [];
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
          // The CPU accepts col tuple 1 (broadcast) or exactly ts.
          const { col, ref } = compileParam(p.value, seed, steps, ts === 1 ? [1] : [1, ts]);
          const target = freshSlot(name, ts, "none");
          layout.set(name, { type, tupleSize: ts });
          written.set(name, target);
          layoutOps.push({ op: "replace", name, type, tupleSize: ts });
          steps.push(
            applyStep(makeSetAttributeApply(col, type, ts), 0, {
              value: ref,
              target: { kind: "slot", index: target },
            }),
          );
          break;
        }
        case "transformPoints": {
          expectAttr("P", "f32", 3);
          const t = compileParam(p.translate, m.seed, steps, [1, 3]);
          const r = compileParam(p.rotateEuler, m.seed, steps, [1, 3]);
          const s = compileParam(p.scale, m.seed, steps, [1, 3]);
          const rotAttr = layout.get("rot");
          const hasRot = rotAttr !== undefined && rotAttr.type === "f32" && rotAttr.tupleSize === 4;
          const sclAttr = layout.get("scale");
          const hasScale = sclAttr !== undefined && sclAttr.type === "f32" && sclAttr.tupleSize === 3;
          const pSlot = slotFor("P");
          written.set("P", pSlot);
          const refs: Record<string, BufRef> = {
            translate: t.ref,
            rotateEuler: r.ref,
            scale: s.ref,
            P: { kind: "slot", index: pSlot },
          };
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
          steps.push(applyStep(makeTransformPointsApply(t.col, r.col, s.col, hasRot, hasScale), 0, refs));
          break;
        }
        case "jitterPoints": {
          expectAttr("P", "f32", 3);
          const extraSeed = typeof p.seed === "number" ? p.seed : Number.NaN;
          const seed = hashCombine(m.seed, extraSeed);
          const a = compileParam(p.amount, seed, steps, [1, 3]);
          const pSlot = slotFor("P");
          written.set("P", pSlot);
          steps.push(
            applyStep(makeJitterPointsApply(a.col), seed, {
              amount: a.ref,
              P: { kind: "slot", index: pSlot },
            }),
          );
          break;
        }
        case "orientAlongVector": {
          const axis = p.axis;
          if (!(ORIENT_AXES as readonly unknown[]).includes(axis)) throw new PlanFail("axis");
          if (!isVec3(p.up)) throw new PlanFail("up");
          const d = compileParam(p.direction, m.seed, steps, [1, 3]);
          const rotAttr = layout.get("rot");
          const keepExisting = rotAttr !== undefined && rotAttr.type === "f32" && rotAttr.tupleSize === 4;
          const rotSlot = keepExisting ? slotFor("rot") : freshSlot("rot", 4, "quat-default");
          layout.set("rot", { type: "f32", tupleSize: 4 });
          written.set("rot", rotSlot);
          layoutOps.push({ op: "ensure-rot" });
          steps.push(
            applyStep(makeOrientApply(d.col, axis as OrientAxis, p.up), 0, {
              direction: d.ref,
              rot: { kind: "slot", index: rotSlot },
            }),
          );
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
  const slotBytes = slots.reduce((acc, s) => acc + s.bytes, 0);
  const colBytes = cols.reduce((acc, b) => acc + b, 0);
  const readbackBytes = writtenList.reduce((acc, w) => acc + slots[w.slot].bytes, 0);
  const totalBytes = slotBytes + colBytes + readbackBytes;
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
    const bufFor = (ref: BufRef): GpuBufferLike => (ref.kind === "slot" ? slotBufs[ref.index] : colBufs[ref.index]);

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
        if (stats !== undefined) stats.dispatches++;
        pass.setPipeline(pipeline);
        // Chunk plan (shared with the per-node path): non-final chunks
        // are exact workgroup multiples — chunks partition the range.
        const chunk = chunkCapacity(step.workgroupSize, env.maxElementsPerDispatch);
        const chunkCount = Math.ceil(count / chunk);
        for (let c = 0; c < chunkCount; c++) {
          const uniformBuf = acquire(UNIFORM_BYTES, BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST);
          device.queue.writeBuffer(uniformBuf, 0, new Uint32Array([count, step.seed >>> 0, c * chunk]));
          const bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
              { binding: step.uniformsBinding, resource: { buffer: uniformBuf } },
              ...step.bindings.map((b) => ({ binding: b.binding, resource: { buffer: bufFor(b.ref) } })),
            ],
          });
          const elements = Math.min(chunk, count - c * chunk);
          pass.setBindGroup(0, bindGroup);
          pass.dispatchWorkgroups(Math.ceil(elements / step.workgroupSize));
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
    const readbackBytes = plan.written.reduce((acc, w) => acc + plan.slots[w.slot].bytes, 0);
    const readBuf = acquire(readbackBytes, BUFFER_USAGE.COPY_DST | BUFFER_USAGE.MAP_READ);
    const offsets: number[] = [];
    let offset = 0;
    for (const w of plan.written) {
      const bytes = plan.slots[w.slot].bytes;
      encoder.copyBufferToBuffer(slotBufs[w.slot], 0, readBuf, offset, bytes);
      offsets.push(offset);
      offset += bytes;
    }
    device.queue.submit([encoder.finish()]);

    await readBuf.mapAsync(MAP_MODE.READ, 0, readbackBytes);
    let copy: ArrayBuffer;
    try {
      copy = readBuf.getMappedRange(0, readbackBytes).slice(0);
    } finally {
      // Never release a mapped buffer into the pool (phase-22 contract).
      readBuf.unmap();
    }
    checkCancelled();

    // Materialize the terminal output: clone the input (untouched
    // attributes and topology pass through exactly as every CPU member
    // would carry them), replay the layout ops in member order (same
    // replace/remove/add calls, so shapes, defaults, and attribute
    // insertion order match the per-node path), then write the read
    // back columns.
    const out = cloneGeometry(geo);
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
      const attr = outSet.require(w.name);
      const n = count * attr.tupleSize;
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

    if (stats !== undefined) {
      stats.residentRuns++;
      stats.fusedNodes += plan.members.length;
      stats.readbacksSaved += plan.members.length - 1;
    }
    return { geo: out };
  } catch (err) {
    if (err instanceof CookCancelledError) throw err;
    throw new Error(
      `GpuFieldEvaluator: resident run failed (${plan.members.length} fused nodes ` +
        `[${plan.members.map((m) => `"${m.id}"`).join(", ")}], ${count} points): ` +
        `${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  } finally {
    for (const buf of acquired) pool.release(buf);
  }
}
