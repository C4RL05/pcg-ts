/**
 * Core-side contract for GPU field resolution. This module deliberately
 * contains no WebGPU types and no imports beyond core field types: the
 * graph executor, nodes, and runtime thread a {@link GpuFieldResolver}
 * through cooks without ever depending on `pcg-ts/gpu`. The concrete
 * implementation (`GpuFieldEvaluator`) lives in `pcg-ts/gpu` and is
 * injected by the caller via `CookOptions.gpu` / `WorldOptions.gpu`.
 */
import type { Column, EvalContext, Field } from "./types.js";

/**
 * Mutable per-cook GPU counters, reported in `CookStats.gpu` (present
 * exactly when a cook was given a resolver). `fallbacks` counts CPU
 * fallbacks by machine-readable reason; the standard vocabulary of
 * {@link GpuFieldResolver.resolveField} reasons:
 *
 * - `"no-spec"` — the field is code-authored and carries no serializable
 *   spec (`getFieldSpec` returned undefined), so it cannot be compiled.
 * - `"compile-error"` — the spec cannot be lowered to WGSL against the
 *   geometry's attribute layout (missing or string attribute, tuple size
 *   above 4, non-finite f32 constant, ...).
 * - `"too-many-buffers"` — the kernel would need more storage buffers
 *   than the baseline WebGPU limit guarantees (more than 7 attribute
 *   inputs plus the output).
 *
 * Element count is never a fallback reason: counts beyond one
 * dispatch's coverage split into chunked dispatches.
 */
export interface GpuCookStats {
  /** Compute dispatches submitted (one per resolved field column). */
  dispatches: number;
  /** Pipelines compiled because no cached pipeline matched the kernel key. */
  pipelinesCompiled: number;
  /** Dispatches served by an already-compiled pipeline. */
  pipelineCacheHits: number;
  /** CPU fallbacks by machine-readable reason (see the vocabulary above). */
  fallbacks: Record<string, number>;
}

/** A fresh all-zero {@link GpuCookStats}. */
export function createGpuCookStats(): GpuCookStats {
  return { dispatches: 0, pipelinesCompiled: 0, pipelineCacheHits: 0, fallbacks: {} };
}

/**
 * Resolves a field to a column on a GPU device. Implemented by
 * `GpuFieldEvaluator` in `pcg-ts/gpu`; expressed here in core types only
 * so nothing outside `src/gpu` references WebGPU.
 *
 * Contract:
 * - `resolveField` decides eligibility synchronously. `null` means the
 *   field cannot be GPU-evaluated (no spec, incompatible layout, ...) —
 *   the caller must fall back to the synchronous CPU `evaluateField`,
 *   and the reason is counted in `stats.fallbacks` when a sink is given.
 * - A non-null return commits to GPU evaluation: the promise resolves to
 *   a freshly allocated column (never a view of attribute storage) with
 *   the same element type and tuple size the CPU evaluation would
 *   produce. A rejection (device failure) propagates to the caller —
 *   it is an error, not a fallback.
 * - `cacheSalt` identifies the device/backend and the marshalling format
 *   version. It participates in cook memo keys so cached bytes produced
 *   with one device are never served to a cook using another (or to a
 *   CPU-only cook).
 */
export interface GpuFieldResolver {
  /** Stable device/backend identity folded into memo keys. */
  readonly cacheSalt: string;
  /**
   * Resolve `field` over the context's domain on the GPU, or return
   * `null` (synchronously) when the field is ineligible. `stats`, when
   * given, receives dispatch/pipeline/fallback counters.
   */
  resolveField(field: Field, ctx: EvalContext, stats?: GpuCookStats): Promise<Column> | null;
}
