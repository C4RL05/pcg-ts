/**
 * Device runtime for compiled WGSL field kernels: `GpuFieldEvaluator`
 * implements the core-side `GpuFieldResolver` contract over a
 * structurally-typed WebGPU device ({@link GpuDeviceLike}), so it works
 * with both a browser `GPUDevice` and Node WebGPU bindings without any
 * type dependency.
 *
 * Resolution pipeline per field: eligibility gate (spec present, layout
 * compiles, baseline device limits hold) → pipeline cache lookup by the
 * kernel's specialization key → SoA column marshalling into tightly
 * packed storage buffers → one 1D dispatch → async readback into a
 * fresh Column of the kernel's output type. Ineligibility returns null
 * synchronously (the caller falls back to the CPU `evaluateField`) with
 * a machine-readable reason counted in the stats sink; a device failure
 * after commitment rejects the returned promise (an error, never a
 * silent fallback).
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
} from "../fields/index.js";
import { getFieldSpec } from "../nodes/fieldJson.js";
import { compileFieldSpec } from "./compile.js";
import {
  BUFFER_USAGE,
  MAP_MODE,
  type GpuAdapterInfoLike,
  type GpuBufferLike,
  type GpuDeviceLike,
} from "./device.js";
import type { CompiledFieldKernel, FieldKernelAttr, GpuScalarType } from "./types.js";

/**
 * Marshalling/runtime format version folded into {@link cacheSalt}.
 * Bump when the codegen or the marshalling contract changes in a way
 * that can change produced bytes, so memo caches never serve stale
 * device output across library versions.
 */
const SALT_VERSION = "gpu1";

/**
 * Baseline WebGPU limit `maxStorageBuffersPerShaderStage`: kernels
 * needing more storage buffers (inputs + output) fall back to the CPU
 * rather than risking device-dependent validation errors.
 */
const MAX_STORAGE_BUFFERS = 8;

/**
 * Baseline WebGPU limit `maxComputeWorkgroupsPerDimension`: the kernel
 * dispatches on one dimension, so element counts above
 * `65535 * workgroupSize` fall back to the CPU.
 */
const MAX_WORKGROUPS = 65535;

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

interface PipelineEntry {
  readonly pipeline: ReturnType<GpuDeviceLike["createComputePipeline"]>;
  readonly kernel: CompiledFieldKernel;
}

/** Options for {@link GpuFieldEvaluator}. */
export interface GpuFieldEvaluatorOptions {
  /**
   * Adapter identity used for the cache salt, overriding the device's
   * own `adapterInfo` (pass the requesting adapter's `info` when the
   * device does not expose one).
   */
  readonly adapterInfo?: GpuAdapterInfoLike;
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
  /** Pipelines by kernel specialization key; persists across cooks. */
  private readonly pipelines = new Map<string, PipelineEntry>();

  constructor(device: GpuDeviceLike, opts: GpuFieldEvaluatorOptions = {}) {
    this.device = device;
    this.cacheSalt = saltFrom(opts.adapterInfo ?? device.adapterInfo);
  }

  /** Number of cached pipelines (introspection for tools and tests). */
  get pipelineCacheSize(): number {
    return this.pipelines.size;
  }

  /**
   * Resolve `field` over the context's domain on the device, or return
   * null (synchronously) when it is ineligible — no serializable spec,
   * the spec does not compile against the geometry's attribute layout,
   * or a baseline device limit would be exceeded. See
   * `GpuFieldResolver.resolveField` for the full contract and
   * `GpuCookStats` for the fallback-reason vocabulary.
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
    if (Math.ceil(count / kernel.workgroupSize) > MAX_WORKGROUPS) {
      return countFallback(stats, "dispatch-too-large");
    }
    if (count === 0) {
      // Nothing to dispatch; mirror the CPU's empty column of the same type.
      return Promise.resolve({ data: new EMPTY_CTORS[kernel.outType](0), tupleSize: kernel.outTupleSize });
    }

    let entry = this.pipelines.get(kernel.key);
    if (entry === undefined) {
      const module = this.device.createShaderModule({ code: kernel.wgsl });
      const pipeline = this.device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: kernel.entryPoint },
      });
      entry = { pipeline, kernel };
      this.pipelines.set(kernel.key, entry);
      if (stats !== undefined) stats.pipelinesCompiled++;
    } else if (stats !== undefined) {
      stats.pipelineCacheHits++;
    }

    if (stats !== undefined) stats.dispatches++;
    return this.dispatch(field, ctx, kernel, entry, count);
  }

  private async dispatch(
    field: Field,
    ctx: EvalContext,
    kernel: CompiledFieldKernel,
    entry: PipelineEntry,
    count: number,
  ): Promise<Column> {
    const device = this.device;
    const buffers: GpuBufferLike[] = [];
    try {
      // Uniforms: { count, seed } — seed coerced exactly as the CPU
      // hash chain coerces ctx.seed (>>> 0).
      const uniformBuf = device.createBuffer({
        size: 8,
        usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST,
      });
      buffers.push(uniformBuf);
      device.queue.writeBuffer(uniformBuf, 0, new Uint32Array([count, ctx.seed >>> 0]));

      const bindEntries: { binding: number; resource: { buffer: GpuBufferLike } }[] = [
        { binding: kernel.bindings.uniforms, resource: { buffer: uniformBuf } },
      ];

      // Input columns: tightly packed SoA scalars, exactly the CPU
      // attribute storage prefix. Bool columns bind as u32 0/1 per the
      // kernel layout contract.
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
        const buf = device.createBuffer({
          size: n * 4,
          usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST,
        });
        buffers.push(buf);
        device.queue.writeBuffer(buf, 0, data);
        bindEntries.push({ binding: input.binding, resource: { buffer: buf } });
      }

      const outBytes = count * kernel.outTupleSize * 4;
      const outBuf = device.createBuffer({
        size: outBytes,
        usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC,
      });
      buffers.push(outBuf);
      bindEntries.push({ binding: kernel.bindings.output, resource: { buffer: outBuf } });

      const readBuf = device.createBuffer({
        size: outBytes,
        usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.MAP_READ,
      });
      buffers.push(readBuf);

      const bindGroup = device.createBindGroup({
        layout: entry.pipeline.getBindGroupLayout(0),
        entries: bindEntries,
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(entry.pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(count / kernel.workgroupSize));
      pass.end();
      encoder.copyBufferToBuffer(outBuf, 0, readBuf, 0, outBytes);
      device.queue.submit([encoder.finish()]);

      await readBuf.mapAsync(MAP_MODE.READ);
      const copy = readBuf.getMappedRange().slice(0);
      readBuf.unmap();
      return { data: new OUT_CTORS[kernel.outType](copy), tupleSize: kernel.outTupleSize };
    } catch (err) {
      throw new Error(
        `GpuFieldEvaluator: dispatch failed for field ${field.key} ` +
          `(${count} elements on the ${ctx.domain} domain): ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    } finally {
      for (const buf of buffers) buf.destroy();
    }
  }
}
