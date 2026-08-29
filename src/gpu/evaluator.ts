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
import { acceptsDerivedSpecs, deviceSpec, specFallbackReason } from "../fields/spec.js";
import { APPLY_CONST_OFFSET } from "./applyKernels.js";
import { compileFieldSpec, constSlotValues, specKernelKey } from "./compile.js";
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

/**
 * Resident kinds advertised as run terminals when `deviceInstances` is
 * on — the kinds whose apply kernels this runtime can end a run with,
 * producing device-resident output instead of geometry.
 */
const DEVICE_INSTANCE_TERMINALS: readonly string[] = ["spawnInstances"];

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
  /**
   * Opt in to DEVICE-RESIDENT instance transforms. When true this
   * evaluator advertises `spawnInstances` as a resident run terminal, so
   * a fused run composes every 4x4 instance matrix on the device and
   * emits an instances item holding a retained GPU buffer instead of
   * `Float32Array`s — no readback of P/rot/scale and no CPU compose
   * loop. Only useful when the caller can actually draw from a device
   * buffer, i.e. a WebGPU renderer sharing this evaluator's device.
   *
   * A spawner grouping by `assetAttr` is resident too: the host plans the
   * grouping and the device composes ONE BUFFER PER ASSET, so such a cook
   * yields several batches and therefore several handles — all of them
   * the caller's to dispose.
   *
   * The caller then OWNS every handle it receives and must dispose it
   * (see `DeviceTransformsHandle`); handles are never memo-cached, so a
   * device-resident spawner recooks every cook and yields fresh ones.
   *
   * Default false: `spawnInstances` spawns on the CPU exactly as it
   * always has, byte for byte, and a chain feeding it still fuses up to
   * the node before it.
   */
  readonly deviceInstances?: boolean;
  /**
   * Opt in to producing the spawner's NAMED per-instance channels
   * (`spawnInstances`' `instanceAttrs`) on the device as well as its
   * transforms. Requires {@link deviceInstances}, and the constructor
   * refuses the pair without it rather than accepting a flag that could
   * do nothing.
   *
   * Default false, and false is exactly the pre-existing behaviour: a
   * spawn naming any channel declines the resident run
   * (`"run-plan-failed"`), its members cook per-node, and the CPU spawner
   * composes the transforms AND the channels together — a working graph,
   * byte for byte the one it was.
   *
   * Turning it on moves the OBLIGATION to bind those columns to the host.
   * Each channel arrives as `batch.attributes[name]`, an owned handle
   * whose `handle.resource` is the buffer, laid out by
   * `deviceInstanceAttributeLayout` (dtype preserved; an itemSize-3
   * channel spends 4 slots; a `bool` channel is u32 words). The device
   * adapter in `pcg-ts/three` binds the reserved `"color"` channel and
   * REFUSES every other one — it names `handle.resource` as the way out —
   * so a graph rendering through that adapter goes from working to
   * throwing the moment its channels become device-resident. That is the
   * whole reason this is its own flag instead of part of
   * {@link deviceInstances}: only a host that binds the buffers itself
   * should ask for it.
   *
   * Every channel is a GATHER, so its bytes equal the CPU batch's
   * exactly; there is no tolerance class here, unlike the composed
   * transforms.
   */
  readonly deviceInstanceAttrs?: boolean;
  /**
   * Opt in to resolving fields whose spec was DERIVED by the combinator
   * API — `mul(position(), 0.1)`, `ge(randomField("species"), 0.72)` —
   * rather than AUTHORED through `fieldFromJson`. A combinator field
   * describes itself faithfully, so "can this field be described" and
   * "may it run on the device" are different questions; this flag answers
   * the second one.
   *
   * Default false: a code-authored field evaluates on the CPU exactly as
   * it always has, byte for byte, and counts a `"derived-spec"` fallback
   * so the readout says why rather than blaming a missing spec. Turning
   * it on widens the eligible set, moving those params from the CPU (the
   * bit-exact reference) to the GPU (a documented approximation within
   * the measured per-family budgets) — a change of produced bytes for
   * graphs that were already passing a resolver, which is why it is
   * opt-in rather than automatic.
   *
   * Memo keys move with it: the flag is advertised on the resolver, and
   * the executor salts exactly the nodes this evaluator will accept, so
   * cached CPU bytes are never served to a cook that enabled it, nor the
   * reverse.
   */
  readonly acceptDerivedSpecs?: boolean;
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

  /**
   * Resident kinds this evaluator will terminate a run with, producing
   * device-resident outputs. Empty unless `deviceInstances` was set, so
   * the default evaluator behaves exactly as it did before device
   * transforms existed.
   */
  readonly residentTerminals: readonly string[];

  /**
   * Whether this evaluator accepts DERIVED (combinator-authored) field
   * specs — see `GpuFieldEvaluatorOptions.acceptDerivedSpecs`. Advertised
   * because the graph executor must salt memo keys for exactly the set
   * this evaluator will resolve; it is read there, and here, through the
   * same accessor.
   */
  readonly acceptDerivedSpecs: boolean;

  /**
   * Whether a device-resident spawner terminal also produces its named
   * per-instance channels — see
   * `GpuFieldEvaluatorOptions.deviceInstanceAttrs`. Read here rather than
   * advertised on `GpuFieldResolver`: nothing in core decides anything
   * from it (device batches are never memo-cached, so there is no key to
   * salt), and the one consumer that must act on it — the host binding
   * the buffers — reads the batch's `attributes` record instead.
   */
  readonly deviceInstanceAttrs: boolean;

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
    if (opts.deviceInstanceAttrs === true && opts.deviceInstances !== true) {
      // A flag that silently does nothing is worse than one that refuses:
      // without `deviceInstances` no spawner ever terminates a resident
      // run, so there is no batch for a channel to ride on and the setting
      // would read as "on" while every channel still came from the CPU.
      throw new Error(
        "GpuFieldEvaluator: deviceInstanceAttrs requires deviceInstances: true — per-instance " +
          "channels ride on a device-resident spawner terminal, and without deviceInstances no " +
          "spawner is one, so the flag could never take effect. Pass both to produce channels " +
          "on the device (and bind them yourself from batch.attributes[name].handle.resource), " +
          "or drop deviceInstanceAttrs to let the CPU spawner produce transforms and channels " +
          "together.",
      );
    }
    this.device = device;
    this.cacheSalt = saltFrom(opts.adapterInfo ?? device.adapterInfo);
    this.pool = new BufferPool(device, opts.maxPooledBytes ?? DEFAULT_MAX_POOLED_BYTES);
    this.maxElementsPerDispatch = opts.maxElementsPerDispatch;
    this.maxResidentBytes = opts.maxResidentBytes ?? DEFAULT_MAX_RESIDENT_BYTES;
    this.residentTerminals = opts.deviceInstances === true ? DEVICE_INSTANCE_TERMINALS : [];
    this.deviceInstanceAttrs = opts.deviceInstanceAttrs === true;
    // Through the shared accessor, not `opts.acceptDerivedSpecs === true`
    // written out again: the executor interprets the same absent-means-
    // false rule through this function, so there is one reading of the
    // flag in the process rather than one per seam.
    this.acceptDerivedSpecs = acceptsDerivedSpecs(opts);
  }

  /** Number of cached pipelines (introspection for tools and tests). */
  get pipelineCacheSize(): number {
    return this.pipelines.size;
  }

  /**
   * Number of cached compiled kernels. Both caches are unbounded Maps, so
   * what they are KEYED on is a memory contract, not a detail: a `param`
   * rebound a thousand times must leave both of these at the size one
   * value produced (see the two-keys note in `resolveField`), and a test
   * can only pin that by reading them.
   */
  get kernelCacheSize(): number {
    return this.kernels.size;
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
    // THE eligibility predicate — the same call, with the same flag, that
    // salts this node's memo key and admits it to a fused run. A field
    // that describes itself but was authored in code is declined unless
    // `acceptDerivedSpecs` was set, and says so ("derived-spec") rather
    // than claiming it has no spec.
    const spec = deviceSpec(field, this.acceptDerivedSpecs);
    if (spec === undefined) return countFallback(stats, specFallbackReason(field));

    const set = ctx.geo.attrs[ctx.domain];
    const attrs: Record<string, FieldKernelAttr> = {};
    const sigParts: string[] = [];
    for (const name of set.names().sort()) {
      const attr = set.get(name);
      if (attr === undefined) continue;
      attrs[name] = { type: attr.type, tupleSize: attr.tupleSize };
      sigParts.push(`${JSON.stringify(name)}:${attr.type}x${attr.tupleSize}`);
    }
    // TWO KEYS, DELIBERATELY. This cache is keyed on the SPEC's key, not
    // on `field.key`, because a bound `param` puts its VALUE in the field
    // key — the CPU memoization contract, and what makes rebinding
    // invalidate exactly the nodes that read the name — while the kernel
    // it needs is the same kernel for every value (the value rides a
    // uniform). Keying this Map on the field would therefore add an entry
    // per slider tick to a Map with no bound, and `pipelines` with it: a
    // leak on every drag rather than a slowdown. See `specKernelKey`.
    let specKey: string;
    try {
      specKey = specKernelKey(spec, field.key);
    } catch {
      // planParams' contradictions (a name bound at two arities, a tuple
      // wider than a slot) surface here, before anything is cached.
      return countFallback(stats, "compile-error");
    }
    const cacheKey = `${specKey.length}#${specKey}|${sigParts.join(",")}`;

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
    // The other half of the two keys: the values the kernel deliberately
    // does not carry. Decided BEFORE the empty-count shortcut, so a field
    // whose params cannot be resolved falls back on an empty domain too —
    // the CPU refusal names the param, and an empty column would hide it.
    //
    // `set` and not the spec alone, because an `attributeIs` slot holds a
    // string-table index and a table belongs to ONE geometry: this is the
    // point where the geometry is in hand and the same spec legitimately
    // resolves to a different number per cell. Nothing about that number
    // reaches `cacheKey`, which is the whole arrangement — the kernel is
    // table-agnostic and the uniform carries the difference.
    const consts = constSlotValues(spec, kernel, set);
    if ("problem" in consts) return countFallback(stats, "param-bindings");

    const count = set.count;
    if (count === 0) {
      // Nothing to dispatch; mirror the CPU's empty column of the same type.
      return Promise.resolve({ data: new EMPTY_CTORS[kernel.outType](0), tupleSize: kernel.outTupleSize });
    }

    const pipeline = this.getPipeline(kernel.key, kernel.wgsl, kernel.entryPoint, stats);
    if (stats !== undefined) stats.dispatches++;
    return this.dispatch(field, ctx, kernel, pipeline, count, consts.values);
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
    const outcome = planResidentRun(members, ctx, this.maxResidentBytes, this.acceptDerivedSpecs, {
      deviceInstanceAttrs: this.deviceInstanceAttrs,
    });
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
    consts: readonly number[],
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
      // exactly as the CPU hash chain coerces ctx.seed (>>> 0) — followed
      // by the kernel's `param` slots when it has any. The slot values
      // are chunk-invariant, so the f32 view rounds each exactly once
      // (matching the CPU `constant` column they stand in for) and only
      // chunkOffset changes between writes. One buffer + bind group per
      // chunk; a single submit runs them all.
      const uniformData = new ArrayBuffer(kernel.uniformBytes);
      const uniformBytes = new Uint8Array(uniformData);
      const header = new Uint32Array(uniformData, 0, 3);
      header[0] = count;
      header[1] = ctx.seed >>> 0;
      if (consts.length > 0) {
        new Float32Array(uniformData, APPLY_CONST_OFFSET, consts.length).set(consts);
      }
      const bindGroups: ReturnType<GpuDeviceLike["createBindGroup"]>[] = [];
      for (let c = 0; c < chunkCount; c++) {
        const uniformBuf = acquire(kernel.uniformBytes, BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST);
        header[2] = c * chunk;
        device.queue.writeBuffer(uniformBuf, 0, uniformBytes);
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
