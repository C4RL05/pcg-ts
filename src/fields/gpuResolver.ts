/**
 * Core-side contract for GPU field resolution. This module deliberately
 * contains no WebGPU types and no imports beyond core data/field types:
 * the graph executor, nodes, and runtime thread a {@link GpuFieldResolver}
 * through cooks without ever depending on `pcg-ts/gpu`. The concrete
 * implementation (`GpuFieldEvaluator`) lives in `pcg-ts/gpu` and is
 * injected by the caller via `CookOptions.gpu` / `WorldOptions.gpu`.
 */
import type { AttrType, Geometry } from "../data/index.js";
import type { Column, EvalContext, Field } from "./types.js";

/**
 * Mutable per-cook GPU counters, reported in `CookStats.gpu` (present
 * exactly when a cook was given a resolver). `fallbacks` counts CPU
 * fallbacks by machine-readable reason; the standard vocabulary:
 *
 * Per-field reasons ({@link GpuFieldResolver.resolveField}):
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
 * Per-run reasons ({@link GpuFieldResolver.planRun}; each counts once
 * per run that falls back, and every member of that run then cooks on
 * the per-node path):
 *
 * - `"run-plan-failed"` — some member of the run cannot be compiled
 *   into the resident pipeline (unknown resident kind, field compile
 *   error, tuple-size or layout mismatch, missing standard attribute,
 *   over the storage-buffer limit, ...). The per-node path serves —
 *   including surfacing the identical CPU error when the params are
 *   genuinely invalid.
 * - `"run-too-large"` — the run's resident working set (element count ×
 *   resident attribute strides + field temporaries + readback) exceeds
 *   the evaluator's resident memory bound.
 *
 * Element count is never a fallback reason: counts beyond one
 * dispatch's coverage split into chunked dispatches.
 */
export interface GpuCookStats {
  /**
   * Compute kernels executed: one per resolved field column on the
   * per-node path, and one per member kernel (field kernels plus the
   * member's apply kernel) inside fused runs. Chunking never multiplies
   * this — a kernel split across N chunked `dispatchWorkgroups` calls
   * still counts once.
   */
  dispatches: number;
  /** Pipelines compiled because no cached pipeline matched the kernel key. */
  pipelinesCompiled: number;
  /** Dispatches served by an already-compiled pipeline. */
  pipelineCacheHits: number;
  /**
   * Device-resident runs executed via {@link GpuFieldResolver.executeRun}
   * (a run served from the terminal's memo cache does no device work and
   * counts nothing).
   */
  residentRuns: number;
  /** Total member nodes across executed resident runs. */
  fusedNodes: number;
  /**
   * Readbacks avoided by fusion: `fusedNodes - residentRuns` (each run
   * reads back once at its terminal where the per-node path would read
   * back once per member).
   */
  readbacksSaved: number;
  /** CPU fallbacks by machine-readable reason (see the vocabulary above). */
  fallbacks: Record<string, number>;
}

/** A fresh all-zero {@link GpuCookStats}. */
export function createGpuCookStats(): GpuCookStats {
  return {
    dispatches: 0,
    pipelinesCompiled: 0,
    pipelineCacheHits: 0,
    residentRuns: 0,
    fusedNodes: 0,
    readbacksSaved: 0,
    fallbacks: {},
  };
}

/**
 * One member of a prospective device-resident run, in chain order. The
 * executor builds these from the graph: `kind` comes from the node
 * def's `resident` descriptor, `seed` is the exact per-node seed the
 * CPU execute would receive (`deriveNodeSeed(graph.seed, id)`), and
 * `params` are the node's live params (treat as immutable).
 */
export interface ResidentMemberDesc {
  /** Node instance id (for error messages and diagnostics). */
  readonly id: string;
  /** Node type name. */
  readonly type: string;
  /** Resident kind from the node def's descriptor. */
  readonly kind: string;
  /** Live node params (immutable; may hold Field values). */
  readonly params: Readonly<Record<string, unknown>>;
  /** Seed the CPU execute would receive for this node instance. */
  readonly seed: number;
}

/** Shape of one attribute column in a {@link ResidentRunContext}. */
export interface ResidentAttrDesc {
  readonly type: AttrType;
  readonly tupleSize: number;
}

/**
 * The concrete evaluation context a run is planned against: the point
 * domain's attribute layout of the run's input geometry and its element
 * count. Planning is synchronous and device-free; everything the
 * planner needs is here and in the member descriptors.
 */
export interface ResidentRunContext {
  readonly attributes: Readonly<Record<string, ResidentAttrDesc>>;
  /** Point count of the input geometry (always > 0; the executor skips fusion for empty inputs). */
  readonly count: number;
}

/** Input to {@link GpuFieldResolver.executeRun}. */
export interface ResidentRunInput {
  /**
   * The run's input geometry (the first member's sole geometry input).
   * Immutable — it aliases upstream cache internals; the resolver reads
   * attribute columns for upload and must never mutate it.
   */
  readonly geo: Geometry;
  /** Cook-scoped abort signal; checked between member kernels. */
  readonly signal?: AbortSignal;
  /** Soft time budget of the enclosing cook (member-granularity slicing). */
  readonly budgetMs?: number;
}

/** Result of {@link GpuFieldResolver.executeRun}. */
export interface ResidentRunResult {
  /**
   * The terminal member's output geometry: structurally
   * indistinguishable from cooking the members sequentially on the
   * per-node path — same attribute set, shapes, defaults, insertion
   * order, string tables, and topology; attributes no member wrote pass
   * through from the input byte-identically.
   */
  readonly geo: Geometry;
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
 *
 * Resident runs (optional): a resolver may additionally implement
 * `planRun`/`executeRun` (both or neither — the executor only fuses
 * when both are present; a resolver without them gets exactly the
 * per-node behavior). Planning is synchronous and device-free; `null`
 * means the run cannot be fused (reason counted in `stats.fallbacks`,
 * see the vocabulary on {@link GpuCookStats}) and every member cooks on
 * the per-node path. A non-null plan is opaque to the executor and is
 * passed back verbatim to `executeRun`, which commits to device
 * execution: a rejection is an error (never a silent fallback), except
 * the standard cancellation error when the input's signal aborted.
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
  /**
   * Plan a device-resident run over `members` (chain order) against the
   * input layout in `ctx`. Synchronous and device-free. Returns an
   * opaque plan, or `null` when the run cannot be fused — the reason is
   * counted in `stats.fallbacks` and the caller cooks the members
   * per-node.
   */
  planRun?(
    members: readonly ResidentMemberDesc[],
    ctx: ResidentRunContext,
    stats?: GpuCookStats,
  ): object | null;
  /**
   * Execute a plan produced by this resolver's `planRun` over the run's
   * input geometry, materializing the terminal member's output with a
   * single readback. `stats`, when given, receives dispatch/pipeline
   * counters plus the resident-run counters (`residentRuns`,
   * `fusedNodes`, `readbacksSaved`).
   */
  executeRun?(
    plan: object,
    input: ResidentRunInput,
    stats?: GpuCookStats,
  ): Promise<ResidentRunResult>;
}
