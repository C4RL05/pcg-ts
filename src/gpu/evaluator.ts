/**
 * Device runtime for compiled WGSL field kernels: `GpuFieldEvaluator`
 * implements the core-side `GpuFieldResolver` contract over a
 * structurally-typed WebGPU device ({@link GpuDeviceLike}), so it works
 * with both a browser `GPUDevice` and Node WebGPU bindings without any
 * type dependency.
 *
 * Resolution pipeline per field: eligibility gate (spec present, layout
 * compiles, baseline storage-buffer limit holds) → pipeline cache lookup
 * by the kernel's specialization key → SoA column marshalling into
 * tightly packed storage buffers → a 1D dispatch, chunked across
 * multiple `dispatchWorkgroups` calls when the element count exceeds
 * what 65535 workgroups cover (each chunk carries its start index in
 * the `chunkOffset` uniform member, so counts are unbounded) → async
 * readback into a fresh Column of the kernel's output type.
 * Ineligibility returns null synchronously (the caller falls back to
 * the CPU `evaluateField`) with a machine-readable reason counted in
 * the stats sink; a device failure after commitment rejects the
 * returned promise (an error, never a silent fallback).
 *
 * Buffers come from a per-evaluator size-bucketed pool ({@link
 * BufferPool}): storage/uniform/readback buffers are reused across
 * dispatches instead of created and destroyed per resolve. Reuse is
 * observationally invisible — kernels never touch lanes past the live
 * count, uploads cover the full read range, and readback slices the
 * exact byte length. `poolStats` introspects it; {@link dispose}
 * releases the pooled device memory.
 *
 * Determinism: the kernel bakes all spec constants, the seed uniform is
 * `ctx.seed >>> 0` (exactly the CPU coercion), buffers are written and
 * read back without reordering — same field, layout, inputs, and seed
 * produce byte-identical columns run to run on one device. Cross-device
 * bytes may differ within the documented float tolerances, which is why
 * {@link GpuFieldEvaluator.cacheSalt} folds the adapter identity into
 * cook memo keys.
 */
import type {
  Column,
  EvalContext,
  Field,
  GpuCookStats,
  GpuFieldResolver,
  ResidentMemberDesc,
  ResidentRunContext,
  ResidentRunInput,
  ResidentRunResult,
} from "../fields/index.js";
import { getFieldSpec } from "../nodes/fieldJson.js";
import { compileFieldSpec } from "./compile.js";
import {
  BUFFER_USAGE,
  MAP_MODE,
  type GpuAdapterInfoLike,
  type GpuBufferLike,
  type GpuComputePipelineLike,
  type GpuDeviceLike,
} from "./device.js";
import { BufferPool, type GpuPoolStats } from "./pool.js";
import {
  DEFAULT_MAX_RESIDENT_BYTES,
  MAX_STORAGE_BUFFERS,
  MAX_WORKGROUPS,
  UNIFORM_BYTES,
  asResidentRunPlan,
  chunkCapacity,
  executeResidentRun,
  planResidentRun,
} from "./run.js";
import type { CompiledFieldKernel, FieldKernelAttr, GpuScalarType } from "./types.js";

/**
 * Marshalling/runtime format version folded into {@link cacheSalt}.
 * Bump when the codegen or the marshalling contract changes in a way
 * that can change produced bytes, so memo caches never serve stale
 * device output across library versions.
 *
 * `gpu2` (constant params moved to uniform slots): the bytes a fused
 * run produces are unchanged for every ordinary value, but a `-0` or
 * subnormal constant is no longer flushed to `+0` — a baked WGSL
 * literal was, a uniform load is not — so those cases now match the
 * CPU reference where they previously did not. That is a byte change,
 * so the rule above applies even though it moved output toward the
 * reference rather than away from it.
 */
const SALT_VERSION = "gpu2";

/**
 * Default bound on bytes RETAINED by the buffer pool (idle buffers
 * only; in-flight buffers are unbounded exactly as without pooling).
 * 256 MiB comfortably holds the working set of repeated multi-million-
 * element dispatches while staying far below typical device memory.
 */
const DEFAULT_MAX_POOLED_BYTES = 256 * 1024 * 1024;

const OUT_CTORS: Record<GpuScalarType, new (buffer: ArrayBuffer) => Column["data"]> = {
  f32: Float32Array,
  i32: Int32Array,
  u32: Uint32Array,
};

const EMPTY_CTORS: Record<GpuScalarType, new (length: number) => Column["data"]> = {
  f32: Float32Array,
  i32: Int32Array,
  u32: Uint32Array,
};

/** Options for {@link GpuFieldEvaluator}. */
export interface GpuFieldEvaluatorOptions {
  /**
   * Adapter identity used for the cache salt, overriding the device's
   * own `adapterInfo` (pass the requesting adapter's `info` when the
   * device does not expose one).
   */
  readonly adapterInfo?: GpuAdapterInfoLike;
  /**
   * Maximum elements a single `dispatchWorkgroups` call covers; larger
   * counts split into that many chunks. Rounded down to a multiple of
   * the kernel workgroup size (minimum one workgroup) and capped at the
   * baseline `65535 * workgroupSize`. Chunking is byte-invisible — the
   * produced column is identical for any setting — so this exists for
   * tests forcing chunk seams at small counts; production code should
   * leave it unset.
   */
  readonly maxElementsPerDispatch?: number;
  /**
   * Bound on bytes the buffer pool retains across dispatches (idle
   * buffers only; a release past the bound destroys the buffer
   * instead). Default 256 MiB; 0 disables retention entirely (every
   * buffer is destroyed on release — the pre-pooling behavior).
   */
  readonly maxPooledBytes?: number;
  /**
   * Bound on the working set of a single device-resident run (resident
   * attribute buffers across every epoch, field temporaries held for
   * the run, and the readback staging buffer). Runs planning above the
   * bound are rejected (`run-too-large`) and cook per-node instead.
   * Default 512 MiB.
   */
  readonly maxResidentBytes?: number;
}

function saltFrom(info: GpuAdapterInfoLike | undefined): string {
  const part = (v: string | undefined): string => (v !== undefined && v !== "" ? v : "?");
  return [
    SALT_VERSION,
    part(info?.vendor),
    part(info?.architecture),
    part(info?.device),
    part(info?.description),
  ].join("|");
}

function countFallback(stats: GpuCookStats | undefined, reason: string): null {
  if (stats !== undefined) {
    stats.fallbacks[reason] = (stats.fallbacks[reason] ?? 0) + 1;
  }
  return null;
}

/**
 * GPU implementation of the core `GpuFieldResolver` contract. One
 * evaluator wraps one device and owns a pipeline cache keyed by the
 * compiled kernel's specialization key, persisting across cooks —
 * repeated cooks of the same field expressions skip both codegen and
 * pipeline creation. Construct once per device and pass it to
 * `cook(graph, { gpu })`, `World` (`WorldOptions.gpu` /
 * `UpdateOptions.gpu`), or `captureAsync`.
 */
export class GpuFieldEvaluator implements GpuFieldResolver {
  /**
   * Device/backend identity (format version + adapter vendor,
   * architecture, device, description) folded into cook memo keys so
   * bytes from different devices — or GPU vs CPU cooks — never serve
   * each other.
   */
  readonly cacheSalt: string;

  private readonly device: GpuDeviceLike;
  /** Compiled kernels (or compile failures) by field key + full layout. */
  private readonly kernels = new Map<string, CompiledFieldKernel | Error>();
  /**
   * Pipelines by kernel specialization key; persists across cooks and
   * is shared with resident runs (whose apply kernels are keyed the
   * same way), so a chain reuses whatever the per-node path compiled.
   */
  private readonly pipelines = new Map<string, GpuComputePipelineLike>();
  /** Size-bucketed reuse of uniform/storage/readback buffers. */
  private readonly pool: BufferPool;
  private readonly maxElementsPerDispatch: number | undefined;
  private readonly maxResidentBytes: number;

  constructor(device: GpuDeviceLike, opts: GpuFieldEvaluatorOptions = {}) {
    if (opts.maxElementsPerDispatch !== undefined && !Number.isFinite(opts.maxElementsPerDispatch)) {
      // A non-finite override would make the chunk plan NaN and skip
      // every dispatch, silently returning uncomputed bytes.
      throw new Error(
        `GpuFieldEvaluator: maxElementsPerDispatch must be a finite number, got ${opts.maxElementsPerDispatch}; leave it unset to use the device maximum`,
      );
    }
    this.device = device;
    this.cacheSalt = saltFrom(opts.adapterInfo ?? device.adapterInfo);
    this.pool = new BufferPool(device, opts.maxPooledBytes ?? DEFAULT_MAX_POOLED_BYTES);
    this.maxElementsPerDispatch = opts.maxElementsPerDispatch;
    this.maxResidentBytes = opts.maxResidentBytes ?? DEFAULT_MAX_RESIDENT_BYTES;
  }

  /** Number of cached pipelines (introspection for tools and tests). */
  get pipelineCacheSize(): number {
    return this.pipelines.size;
  }

  /** Buffer-pool counters (created/reused/destroyed, retained bytes). */
  get poolStats(): GpuPoolStats {
    return this.pool.stats;
  }

  /**
   * Destroy every pooled device buffer. The evaluator stays usable —
   * later dispatches recreate buffers on demand — so call this when a
   * burst of GPU work is over and the retained memory should go back to
   * the device. Pipeline and kernel caches are unaffected (pipelines
   * hold no destroyable resources).
   */
  dispose(): void {
    this.pool.dispose();
  }

  /** Elements one chunk covers for `kernel` (multiple of its workgroup size). */
  private chunkElements(kernel: CompiledFieldKernel): number {
    const cap = MAX_WORKGROUPS * kernel.workgroupSize;
    const requested = Math.min(this.maxElementsPerDispatch ?? cap, cap);
    return Math.max(
      kernel.workgroupSize,
      Math.floor(requested / kernel.workgroupSize) * kernel.workgroupSize,
    );
  }

  /**
   * Resolve `field` over the context's domain on the device, or return
   * null (synchronously) when it is ineligible — no serializable spec,
   * the spec does not compile against the geometry's attribute layout,
   * or the kernel needs more storage buffers than the baseline limit
   * guarantees. Element count never disqualifies: large counts dispatch
   * in chunks. See `GpuFieldResolver.resolveField` for the full
   * contract and `GpuCookStats` for the fallback-reason vocabulary.
   */
  resolveField(field: Field, ctx: EvalContext, stats?: GpuCookStats): Promise<Column> | null {
    const spec = getFieldSpec(field);
    if (spec === undefined) return countFallback(stats, "no-spec");

    const set = ctx.geo.attrs[ctx.domain];
    const attrs: Record<string, FieldKernelAttr> = {};
    const sigParts: string[] = [];
    for (const name of set.names().sort()) {
      const attr = set.get(name);
      if (attr === undefined) continue;
      attrs[name] = { type: attr.type, tupleSize: attr.tupleSize };
      sigParts.push(`${JSON.stringify(name)}:${attr.type}x${attr.tupleSize}`);
    }
    const cacheKey = `${field.key.length}#${field.key}|${sigParts.join(",")}`;

    let kernel = this.kernels.get(cacheKey);
    if (kernel === undefined) {
      try {
        kernel = compileFieldSpec(spec, { attributes: attrs });
      } catch (err) {
        kernel = err instanceof Error ? err : new Error(String(err));
      }
      this.kernels.set(cacheKey, kernel);
    }
    if (kernel instanceof Error) return countFallback(stats, "compile-error");

    if (kernel.inputs.length + 1 > MAX_STORAGE_BUFFERS) {
      return countFallback(stats, "too-many-buffers");
    }
    const count = set.count;
    if (count === 0) {
      // Nothing to dispatch; mirror the CPU's empty column of the same type.
      return Promise.resolve({ data: new EMPTY_CTORS[kernel.outType](0), tupleSize: kernel.outTupleSize });
    }

    const pipeline = this.getPipeline(kernel.key, kernel.wgsl, kernel.entryPoint, stats);
    if (stats !== undefined) stats.dispatches++;
    return this.dispatch(field, ctx, kernel, pipeline, count);
  }

  /**
   * Compute pipeline for a kernel key, compiling on miss and counting
   * the compile or hit into `stats`. Shared by the per-field path and
   * the resident-run executor ({@link RunExecEnv}).
   */
  getPipeline(
    key: string,
    wgsl: string,
    entryPoint: string,
    stats?: GpuCookStats,
  ): GpuComputePipelineLike {
    const cached = this.pipelines.get(key);
    if (cached !== undefined) {
      if (stats !== undefined) stats.pipelineCacheHits++;
      return cached;
    }
    const module = this.device.createShaderModule({ code: wgsl });
    const pipeline = this.device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint },
    });
    this.pipelines.set(key, pipeline);
    if (stats !== undefined) stats.pipelinesCompiled++;
    return pipeline;
  }

  /**
   * Plan a device-resident run (synchronous, device-free). Returns the
   * opaque plan, or null with the rejection reason counted in
   * `stats.fallbacks` — the executor then cooks the members per-node.
   */
  planRun(
    members: readonly ResidentMemberDesc[],
    ctx: ResidentRunContext,
    stats?: GpuCookStats,
  ): object | null {
    const outcome = planResidentRun(members, ctx, this.maxResidentBytes);
    if ("plan" in outcome) return outcome.plan;
    if (stats !== undefined) {
      stats.fallbacks[outcome.reason] = (stats.fallbacks[outcome.reason] ?? 0) + 1;
    }
    return null;
  }

  /** Execute a plan from this evaluator's {@link planRun}. */
  executeRun(
    plan: object,
    input: ResidentRunInput,
    stats?: GpuCookStats,
  ): Promise<ResidentRunResult> {
    const compiled = asResidentRunPlan(plan);
    if (compiled === null) {
      return Promise.reject(
        new Error(
          "GpuFieldEvaluator.executeRun: plan was not produced by this library's planRun; " +
            "pass the object returned by planRun on the same resolver",
        ),
      );
    }
    return executeResidentRun(
      {
        device: this.device,
        pool: this.pool,
        maxElementsPerDispatch: this.maxElementsPerDispatch,
        getPipeline: (key, wgsl, entryPoint, s) => this.getPipeline(key, wgsl, entryPoint, s),
      },
      compiled,
      input,
      stats,
    );
  }

  private async dispatch(
    field: Field,
    ctx: EvalContext,
    kernel: CompiledFieldKernel,
    pipeline: GpuComputePipelineLike,
    count: number,
  ): Promise<Column> {
    const device = this.device;
    // Buffers acquired from the pool for this dispatch; released (not
    // destroyed) in `finally`, after all queue work has completed.
    const acquired: GpuBufferLike[] = [];
    const acquire = (size: number, usage: number): GpuBufferLike => {
      const buf = this.pool.acquire(size, usage);
      acquired.push(buf);
      return buf;
    };
    try {
      // Chunk plan: every chunk except the last covers exactly
      // `chunk` elements (a multiple of the workgroup size, so its
      // workgroup count is exact and no lane strays into the next
      // chunk's range); the last chunk's trailing lanes are trimmed by
      // the kernel's `i >= count` guard. Each element is therefore
      // computed by exactly one invocation regardless of chunking.
      const chunk = this.chunkElements(kernel);
      const chunkCount = Math.ceil(count / chunk);

      const bindEntries: { binding: number; resource: { buffer: GpuBufferLike } }[] = [];

      // Input columns: tightly packed SoA scalars, exactly the CPU
      // attribute storage prefix. Bool columns bind as u32 0/1 per the
      // kernel layout contract. Uploads cover the full range any live
      // lane reads, so stale bytes in pooled buffers are unreachable.
      const set = ctx.geo.attrs[ctx.domain];
      for (const input of kernel.inputs) {
        const attr = set.require(input.name);
        const n = count * input.tupleSize;
        let data: ArrayBufferView & { length: number };
        if (attr.data instanceof Uint8Array) {
          const widened = new Uint32Array(n);
          for (let i = 0; i < n; i++) widened[i] = attr.data[i];
          data = widened;
        } else {
          data = attr.data.subarray(0, n);
        }
        const buf = acquire(n * 4, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST);
        device.queue.writeBuffer(buf, 0, data);
        bindEntries.push({ binding: input.binding, resource: { buffer: buf } });
      }

      const outBytes = count * kernel.outTupleSize * 4;
      const outBuf = acquire(outBytes, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC);
      bindEntries.push({ binding: kernel.bindings.output, resource: { buffer: outBuf } });

      const readBuf = acquire(outBytes, BUFFER_USAGE.COPY_DST | BUFFER_USAGE.MAP_READ);

      // Uniforms per chunk: { count, seed, chunkOffset } — seed coerced
      // exactly as the CPU hash chain coerces ctx.seed (>>> 0). One
      // buffer + bind group per chunk; a single submit runs them all.
      const bindGroups: ReturnType<GpuDeviceLike["createBindGroup"]>[] = [];
      for (let c = 0; c < chunkCount; c++) {
        const uniformBuf = acquire(UNIFORM_BYTES, BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST);
        device.queue.writeBuffer(uniformBuf, 0, new Uint32Array([count, ctx.seed >>> 0, c * chunk]));
        bindGroups.push(
          device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
              { binding: kernel.bindings.uniforms, resource: { buffer: uniformBuf } },
              ...bindEntries,
            ],
          }),
        );
      }

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      for (let c = 0; c < chunkCount; c++) {
        const elements = Math.min(chunk, count - c * chunk);
        pass.setBindGroup(0, bindGroups[c]);
        pass.dispatchWorkgroups(Math.ceil(elements / kernel.workgroupSize));
      }
      pass.end();
      encoder.copyBufferToBuffer(outBuf, 0, readBuf, 0, outBytes);
      device.queue.submit([encoder.finish()]);

      // Pooled readback buffers can be larger than the live output:
      // map and slice exactly the bytes this dispatch produced. unmap
      // sits in a finally so an OOM-class failure in getMappedRange or
      // slice can never release a still-mapped buffer into the pool
      // (which would poison every later reuse of its bucket).
      await readBuf.mapAsync(MAP_MODE.READ, 0, outBytes);
      let copy: ArrayBuffer;
      try {
        copy = readBuf.getMappedRange(0, outBytes).slice(0);
      } finally {
        readBuf.unmap();
      }
      return { data: new OUT_CTORS[kernel.outType](copy), tupleSize: kernel.outTupleSize };
    } catch (err) {
      throw new Error(
        `GpuFieldEvaluator: dispatch failed for field ${field.key} ` +
          `(${count} elements on the ${ctx.domain} domain): ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    } finally {
      for (const buf of acquired) this.pool.release(buf);
    }
  }
}
