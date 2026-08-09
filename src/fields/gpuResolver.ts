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
 * - `"no-spec"` — the field carries no serializable spec at all, so
 *   nothing can be compiled: its evaluator is an arbitrary closure
 *   (`makeField`), it is built over one, or its expression nests deeper
 *   than the grammar's cap.
 * - `"derived-spec"` — the field DOES describe itself, but that
 *   description was derived from the combinator API rather than authored
 *   through `fieldFromJson`, and this resolver does not advertise
 *   `acceptDerivedSpecs`. The remedy is a flag, not a rewrite: construct
 *   the evaluator with `acceptDerivedSpecs: true` (or author the field
 *   via `fieldFromJson`) and the same expression resolves on the device.
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
 * One per-run reason is NOT a fallback, and is counted separately
 * because it reports a partial success rather than a lost run:
 *
 * - `"run-partially-fused"` — a member was rejected, so the planner
 *   retried the SUFFIX after it and fused what remained. Counted once
 *   per chain per cook, and the dropped members cooked per-node. Note
 *   the asymmetry: only a suffix is ever retried, never a prefix.
 *   Fusing the prefix would compute `P` on the device and hand the
 *   drifted bits to the identity-keyed member one node later — the
 *   same hazard the rejection exists to prevent, with the boundary
 *   moved rather than removed.
 *
 * Node-level opt-out reasons (a node that declares `resident` but whose
 * `eligible` predicate returned a reason string — see `ResidentDesc`;
 * counted once per cook per such node, whether or not a run formed
 * around it) are part of this vocabulary, but the standard node library
 * declares none: every reason a standard node stays off the device today
 * is one of the per-field or per-run reasons above. (v0.7's
 * `"spawn-asset-attr"` was the only one, and v0.8 retired it —
 * `spawnInstances` is device-resident with `assetAttr` set as well,
 * since the grouping needs no device-side sort.)
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
   *
   * A multi-asset spawner terminal is the one kernel that counts more
   * than once: it dispatches once per asset present in the input, over
   * that asset's element range and into that asset's output buffer, and
   * each counts. These are distinct dispatches over disjoint ranges, not
   * chunks of one range, so counting them once each keeps the number a
   * measure of device work. A constant-`assetId` spawner has exactly one
   * asset and so still counts one.
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
   * Readbacks avoided by fusion: the per-node path reads back once per
   * member, a run reads back once at its terminal — so an ordinary run
   * contributes `members - 1` and the identity
   * `readbacksSaved === fusedNodes - residentRuns` holds. A run ending
   * in a DEVICE-RESIDENT terminal whose geometry nobody reads performs
   * no readback at all and contributes `members`, which is the one case
   * that identity does not cover.
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
  /**
   * Does this cook need the terminal's geometry output? False only when
   * the terminal member's geometry pin is neither connected nor declared
   * as a graph output — the run may then skip materializing the chain's
   * geometry entirely (no readback at all), which is what makes a
   * device-resident spawner terminal a true zero-round-trip path. True
   * for every terminal whose geometry someone reads, including every
   * single-geometry-output terminal, so the pre-existing behavior is
   * unchanged.
   */
  readonly needsGeometry: boolean;
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

/**
 * Opaque, disposable handle to a device-resident buffer produced by a
 * resident run. Core code (graph, fields, nodes, runtime) only ever sees
 * this interface — never a WebGPU type — so nothing outside `src/gpu`
 * gains a device dependency; `pcg-ts/gpu`'s `deviceTransformsBuffer()`
 * narrows {@link resource} back to a device buffer for a renderer
 * adapter.
 *
 * Ownership. The handle is created the moment the producing buffer's
 * ownership leaves the evaluator's buffer pool, and from then on
 * **whoever receives the handle owns the memory**: nothing in the
 * library — not the pool, not the node memo cache, not
 * `GpuFieldEvaluator.dispose()` — will free it. Exactly one party must
 * call {@link dispose}, and the device memory is not reclaimed until it
 * does. Handles are never memo-cached and never handed to two owners:
 * every cook that produces device-resident output produces a *fresh*
 * handle (see `CookOptions.gpu`), so an owner may dispose its handle as
 * soon as it stops rendering from it.
 *
 * Failure modes are all defined and none of them are silent:
 * - `dispose()` twice (or after the owning evaluator was disposed) is a
 *   no-op, never a double free.
 * - reading {@link resource} after `dispose()` throws instead of handing
 *   out a destroyed buffer.
 * - a handle that is never disposed is a leak, and a bounded, visible
 *   one: its bytes stay counted in `GpuFieldEvaluator.poolStats`
 *   (`detachedBuffers` / `detachedBytes`) until it is disposed.
 */
export interface DeviceTransformsHandle {
  /** Backend that owns the resource, e.g. `"webgpu"`. */
  readonly backend: string;
  /**
   * Logical byte length of the payload. The underlying allocation can be
   * LARGER (the pool buckets to powers of two) — bind, copy, and read
   * exactly this many bytes; the rest is uninitialized.
   */
  readonly byteLength: number;
  /** True once {@link dispose} has run. */
  readonly disposed: boolean;
  /**
   * The backend resource (a `GPUBuffer` when `backend === "webgpu"`),
   * opaque here. Throws after {@link dispose} rather than returning a
   * destroyed resource.
   */
  readonly resource: unknown;
  /** Release the device memory. Idempotent: a second call does nothing. */
  dispose(): void;
}

/**
 * A device-resident instance batch: the same render-agnostic spawner
 * payload as `InstanceBatch` (see src/graph/data.ts), except that the packed 4x4 transforms
 * live in a device buffer ({@link transforms}) that was composed on the
 * GPU and never crossed to the CPU.
 *
 * The buffer holds `count * 16` f32 in exactly the `InstanceBatch`
 * layout — column-major, translation at floats 12-14, float 15 = 1 —
 * so a renderer can bind it as instance data directly. Composed in f32
 * throughout, where the CPU `composeTRS` keeps an f64 interior: these
 * bytes drive a renderer, not a seed chain, so they are a documented
 * tolerance class rather than a bit-exact port. The CPU path remains the
 * reference.
 */
export interface DeviceInstanceBatch {
  /** Marks this batch device-resident; CPU batches carry `"cpu"` or nothing. */
  readonly residency: "device";
  /** Which asset every instance in this batch renders; resolved by the renderer. */
  readonly assetId: string;
  /** Number of instances in the batch. */
  readonly count: number;
  /** Device buffer of `count * 16` f32; see {@link DeviceTransformsHandle} for who frees it. */
  readonly transforms: DeviceTransformsHandle;
}

/** Result of {@link GpuFieldResolver.executeRun}. */
export interface ResidentRunResult {
  /**
   * The terminal member's output geometry: structurally
   * indistinguishable from cooking the members sequentially on the
   * per-node path — same attribute set, shapes, defaults, insertion
   * order, string tables, and topology; attributes no member wrote pass
   * through from the input byte-identically.
   *
   * Undefined exactly when the run was planned with
   * `ResidentRunContext.needsGeometry === false` and the terminal's
   * device-resident outputs made materializing it unnecessary — the run
   * then performed no readback at all.
   */
  readonly geo?: Geometry;
  /**
   * Device-resident instance batches the terminal member produced (a
   * spawner terminal). The caller wraps them into the terminal's
   * instances output pin and hands them to whoever owns them next; see
   * {@link DeviceTransformsHandle} for the ownership rules.
   */
  readonly deviceBatches?: readonly DeviceInstanceBatch[];
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
   * Resident `kind`s this resolver can run as a run TERMINAL producing
   * device-resident (non-geometry) outputs — see `ResidentDesc.terminal`.
   * Terminal-only nodes join a run only when their kind is listed here,
   * so the feature is opt-in at the device seam: a resolver that omits
   * this (or lists nothing) yields exactly the pre-existing fusion
   * behavior and byte-identical output, and every such node cooks on its
   * normal CPU path. Ordinary single-geometry-output members ignore this
   * list entirely.
   */
  readonly residentTerminals?: readonly string[];
  /**
   * Does this resolver accept fields whose spec was DERIVED by the
   * combinator API (`mul(position(), 0.1)`) rather than AUTHORED through
   * `fieldFromJson`? Omitted or false — the default — means no: such
   * fields evaluate on the CPU and count a `"derived-spec"` fallback, so
   * every byte and every memo key is what a pre-v0.9 cook produced.
   *
   * This advertisement is the SINGLE source of truth for that decision.
   * The executor reads it here to decide whether a node's memo key gains
   * the `|gpu:` salt and whether the node may join a fused run; the
   * resolver must act on exactly the same value when it decides to
   * resolve a field or to plan a run. A resolver whose advertisement
   * disagrees with its own behavior produces GPU bytes under a CPU memo
   * key — see `deviceSpec` in `src/fields/spec.ts`.
   */
  readonly acceptDerivedSpecs?: boolean;
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
   * single readback — or with no readback at all when the plan needs no
   * geometry and produces only device-resident outputs. `stats`, when
   * given, receives dispatch/pipeline counters plus the resident-run
   * counters (`residentRuns`, `fusedNodes`, `readbacksSaved`).
   *
   * Any device-resident handle in the result is handed to the caller
   * already owned by it (see {@link DeviceTransformsHandle}); a
   * rejection or cancellation frees everything the run allocated,
   * including handles it had already built, so a failed run never leaks.
   */
  executeRun?(
    plan: object,
    input: ResidentRunInput,
    stats?: GpuCookStats,
  ): Promise<ResidentRunResult>;
}
