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
 *   geometry's attribute layout (missing attribute, a string attribute
 *   read as a value by `attribute` rather than tested by `attributeIs`,
 *   tuple size above 4, non-finite f32 constant, ...).
 * - `"too-many-buffers"` — the kernel would need more storage buffers
 *   than the baseline WebGPU limit guarantees (more than 7 attribute
 *   inputs plus the output).
 * - `"param-bindings"` — the spec's `{"fn":"param"}` references cannot
 *   be resolved to one value per name: a name nothing bound, or two
 *   references to one name bound to different VALUES in a single
 *   expression. The kernel compiles either way (a param lowers to a
 *   uniform slot, which needs only the name), but the values it would
 *   write are missing or contradictory, so the CPU path runs instead —
 *   and raises the refusal that names the param. Two references bound at
 *   different ARITIES are a different failure and report
 *   `"compile-error"`: one slot cannot be both a scalar and a vector, so
 *   there is no kernel to compile rather than no value to write. A fused
 *   run declines for either as `"run-plan-failed"`, like every other
 *   plan-time refusal, and its members then take the per-node path where
 *   the reason above is counted.
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
 *   genuinely invalid. `attributeIs` declines here for a reason worth
 *   distinguishing from the rest: its kernel compiles and DISPATCHES
 *   fine, and the per-node path runs it on the device. What a plan
 *   cannot supply is the uniform it reads — the literal's index in the
 *   string table of the geometry being cooked, where plan time has only
 *   attribute descriptors and a count. So the run declines and its
 *   members cook per-node, where the same field is device-resolved.
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
 * declares none: every reason a standard node stays off the device is one
 * of the per-field or per-run reasons above. `spawnInstances` in
 * particular is device-resident with `assetAttr` set as well, since the
 * grouping needs no device-side sort.
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
   *
   * A spawner terminal is also the one member that can carry SEVERAL
   * apply kernels: the compose kernel, plus one gather kernel per named
   * per-instance channel when the resolver opted in to producing them
   * (`GpuFieldEvaluatorOptions.deviceInstanceAttrs`). Each of those
   * dispatches per asset too, so a 4-asset spawn with 3 channels counts
   * 16. Colour is not among them — it rides the compose kernel.
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
  /** Non-finite findings and blind spots on the device path. */
  nonFinite: NonFiniteReport;
}

/**
 * What the non-finite guard FOUND on the device path, and — the half that
 * matters more — what it could not look at.
 *
 * A field-capable param that resolves to NaN or ±Infinity is refused where
 * it lands on a domain, naming the node and the param (`resolveOn` in
 * `src/nodes/util.ts`). A FUSED device-resident run never reaches that
 * seam: its members' field columns stay in storage buffers and only the
 * written attributes come back, so the guard that throws on the CPU would
 * be silent on a run-fusing device — the CPU is the reference, and a path
 * that quietly checks less than the reference is exactly what the
 * determinism pillar forbids. The run terminal therefore scans what it
 * DOES have (the readback geometry) and declares what it does not.
 *
 * Both records are empty on a cook where nothing fused, which is an honest
 * silence: no run means no site bypassed the guarded seam. They are never
 * absent while `CookStats.gpu` is present, so an agent can tell "clean"
 * from "not looked at" without knowing which cook shape produced them.
 */
export interface NonFiniteReport {
  /**
   * Non-finite ELEMENT counts of a fused run's readback geometry, keyed
   * `<terminal node id>:<point attribute>`, SUMMED over every execution of
   * that terminal in this cook (a forEach body cooks once per item into
   * this one sink). Present only for attributes that hold at least one, so
   * an empty record means the scan found nothing — not that it did not
   * run.
   *
   * A REPORT, never a throw. The run has fused several nodes into one
   * pipeline, so the value's param cannot be named, and a throw that
   * cannot say which knob to turn is a worse answer than a count.
   *
   * From runs that EXECUTED on this cook only: a run served from its
   * terminal's memo entry does no device work and re-reports nothing,
   * exactly as `residentRuns` documents. Its `unchecked` declaration below
   * IS reported warm, so a warm cook never reads as fully guarded — read
   * the two together, never one as a restatement of the other.
   */
  counts: Record<string, number>;
  /**
   * Sites the guard did not read, keyed `<node id>:<what>` with a
   * machine-readable reason. The vocabulary:
   *
   * - `"fused-run"` (key `<terminal>:params`) — the run's members never
   *   called the param seam, so no param was checked BY NAME. What the
   *   run wrote is covered by `counts` instead, without attribution.
   * - `"device-resident"` (key `<terminal>:transforms`) — the terminal's
   *   instance transforms live in a GPU buffer that is never read back.
   *   Checking them means a full `count * 16` float readback on the frame
   *   path, reintroducing the transfer the feature exists to remove, so
   *   they are declared unchecked rather than paid for. (The bounds a
   *   caller supplies for such a batch ARE validated, by
   *   `resolveBoundingSphere` in `src/three/webgpuInstances.ts`.)
   */
  unchecked: Record<string, string>;
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
    nonFinite: { counts: {}, unchecked: {} },
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
 * The name says "transforms" because that was the first payload; the
 * contract is about a device BUFFER and its ownership, so a spawner's
 * per-instance colours ride the same handle type
 * ({@link DeviceInstanceBatch.colors}). One handle owns one buffer,
 * whatever is in it.
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
 * Element types a per-instance channel can carry to a device. Every
 * `AttrType` except `"string"`, which cannot cross a spawner on either
 * residency — its column is indices into a per-attribute string table
 * that does not travel with it.
 */
export type DeviceInstanceAttrType = Exclude<AttrType, "string">;

/**
 * One named per-instance channel, device-resident: the twin of a CPU
 * batch's `attributes[name]` (see `InstanceAttributes` in
 * src/graph/data.ts) with the column left in a device buffer.
 *
 * `type` and `itemSize` are the point attribute's own, carried through
 * unchanged — the dtype is the ABI and is never widened to f32, for the
 * same reason on both residencies: a u32 id past 2^24 does not survive
 * one. What the BUFFER holds can still differ from what `type` and
 * `itemSize` say, and never by choice: see
 * {@link deviceInstanceAttributeLayout} for the two WGSL rules that make
 * it differ and for the byte length this handle must have.
 *
 * A handle is an OWNER OBLIGATION. Whoever owns the batch disposes every
 * channel's handle as well as `transforms`; the device path has no GC, so
 * a dropped handle leaks (visibly, in `poolStats`) and a double free
 * crashes. Enumerate them through {@link deviceInstanceAttributesOf} so
 * the reserved colour channel is counted exactly once.
 */
export interface DeviceInstanceAttribute {
  /** The device buffer. Its length must match {@link deviceInstanceAttributeLayout}. */
  readonly handle: DeviceTransformsHandle;
  /** Element type, preserved from the point domain. */
  readonly type: DeviceInstanceAttrType;
  /** Components per instance as the AUTHOR sees them; the buffer may pad. */
  readonly itemSize: number;
}

/** What a device channel actually occupies, and how WGSL names it. */
export interface DeviceInstanceAttributeLayout {
  /** f32-sized slots the buffer spends per instance; `itemSize`, padded. */
  readonly components: number;
  /** Bytes per instance: `components * 4`. */
  readonly byteStride: number;
  /** WGSL element type of the storage array, e.g. `"vec3<f32>"`. */
  readonly wgslType: string;
  /** WGSL scalar the buffer's words are, e.g. `"u32"` for a `bool` channel. */
  readonly wgslScalar: "f32" | "i32" | "u32";
}

/**
 * The device layout of a channel: what a producer must write and what a
 * renderer must expect. **Neither difference from the CPU column is a
 * choice**; both are WGSL's rules, and getting either wrong renders as a
 * growing skew that reads like a shader bug.
 *
 * 1. **A 3-component channel spends FOUR slots.** WGSL gives
 *    `array<vec3<f32>>` a 16-byte element stride (vec3 has 16-byte
 *    alignment in the storage address space), and three's own WebGPU
 *    backend repacks an itemSize-3 storage attribute to 4 components
 *    before upload for exactly that reason. This is the same rule
 *    `DeviceInstanceBatch.colors` has always followed, stated once here
 *    now that colour is one channel among others.
 * 2. **A `bool` channel is `u32` words on the device.** WGSL `bool` is
 *    not host-shareable and cannot appear in a storage buffer at all, so
 *    a bool column is carried as u32 0/1 — which is already how this
 *    library binds bool columns to kernels (`src/gpu/types.ts`). The CPU
 *    column stays `Uint8Array`: one byte per element there, four here.
 *
 * `itemSize` above 4 is refused rather than laid out. WGSL has no vector
 * wider than 4, so a 5-component channel would need an array-of-arrays
 * element and a different binding convention on every renderer — a
 * different ABI, not a bigger one. Split it into two channels.
 */
export function deviceInstanceAttributeLayout(
  type: DeviceInstanceAttrType,
  itemSize: number,
): DeviceInstanceAttributeLayout {
  if (!Number.isInteger(itemSize) || itemSize < 1 || itemSize > 4) {
    throw new Error(
      `deviceInstanceAttributeLayout: itemSize ${itemSize} is out of range; a device instance ` +
        "channel binds as a WGSL storage array of a scalar or a vec2/vec3/vec4, so its item " +
        "size must be a whole number in 1..4. Split a wider attribute into several channels " +
        "(a mat3 as three vec3 channels, say) — WGSL has no wider vector, so carrying one " +
        "would be a different binding convention on every renderer, not a larger buffer.",
    );
  }
  // bool has no host-shareable WGSL spelling: carried as u32 0/1, which
  // is what every other bool binding in this library already does.
  const wgslScalar = type === "bool" ? "u32" : type;
  // The vec3 stride rule. 1, 2 and 4 are their own component counts;
  // only 3 pads, and it pads to 4.
  const components = itemSize === 3 ? 4 : itemSize;
  return {
    components,
    byteStride: components * 4,
    wgslType: itemSize === 1 ? wgslScalar : `vec${itemSize}<${wgslScalar}>`,
    wgslScalar,
  };
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
 *
 * {@link colors} is the exception to that last sentence, deliberately: a
 * colour is GATHERED, never computed, so the device buffer must equal the
 * CPU batch's `colors` bit for bit. There is no tolerance class to spend
 * on a copy.
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
  /**
   * Named per-instance channels, device-resident — the twin of
   * `InstanceBatch.attributes`, in the same instance order as
   * {@link transforms}. See {@link DeviceInstanceAttribute} for the
   * per-channel shape and {@link deviceInstanceAttributeLayout} for the
   * two ways a channel's device buffer differs from its CPU column.
   *
   * Enumerate this through {@link deviceInstanceAttributesOf}, never
   * alongside {@link colors}: colour is a channel IN here, not beside it,
   * so counting both would dispose one handle twice.
   */
  readonly attributes?: Readonly<Record<string, DeviceInstanceAttribute>>;
  /**
   * Per-instance RGB, present exactly when the spawner's `colorAttr`
   * named an attribute — the device twin of `InstanceBatch.colors`, in
   * the same instance order as {@link transforms} (one kernel gathers
   * both from one index, so they cannot drift).
   *
   * **SUGAR over the reserved `"color"` entry of {@link attributes}**,
   * exactly as `InstanceBatch.colors` is over its CPU twin: on a batch
   * this library builds it is an accessor returning that channel's
   * handle, so there is one buffer and one owner obligation, not two
   * spellings of them. A hand-built batch may still set it as a plain
   * property — with no `attributes`, with an empty record, or beside
   * other channels — and {@link deviceInstanceAttributesOf} lifts it
   * into the reserved channel in every one of those cases, so that batch
   * takes the identical path. Setting BOTH spellings to different
   * handles is the one shape that throws there.
   *
   * **The layout differs from the CPU batch's, and it is not a choice.**
   * The CPU array is tightly packed at 3 floats per instance; this buffer
   * holds **4** f32 per instance (`count * 16` bytes), instance `k` at
   * floats `4k..4k+2` with `4k+3` written as 0. WGSL gives
   * `array<vec3<f32>>` a 16-byte stride, which is how a renderer reads an
   * instance-colour storage attribute, and why three's own WebGPU backend
   * pads an itemSize-3 storage attribute to vec4 before uploading one
   * ("WGSL does not support packed vec3 data in storage buffers"). A
   * 3-float device buffer would shift every colour by a growing offset
   * and read like a shader bug rather than a layout one. It is the
   * `itemSize === 3` case of {@link deviceInstanceAttributeLayout} and no
   * longer a rule of its own.
   *
   * A SECOND handle means a second owner obligation: whoever owns the
   * batch disposes this as well as {@link transforms}. The device path
   * has no GC — a dropped handle leaks (visibly, in `poolStats`) and a
   * double free crashes.
   */
  readonly colors?: DeviceTransformsHandle;
}

/** No channels: the shared empty record every channel-less batch reads as. */
const NO_DEVICE_INSTANCE_ATTRIBUTES: Readonly<Record<string, DeviceInstanceAttribute>> =
  Object.freeze({});

/**
 * Does this record carry `name` the way its CONSUMERS see it — as an own,
 * enumerable key, which is what `Object.keys` / `Object.values` /
 * spreading report and what every adapter and handle-counting owner
 * loops? The device twin of the CPU normalizer's helper (src/graph/data.ts),
 * copied rather than imported because this module imports nothing from
 * `src/graph` by design.
 *
 * A plain `record[name]` would also find an inherited or non-enumerable
 * one, and answering "present" for a channel nothing downstream can
 * enumerate means the colour handle a caller DID supply is neither drawn
 * nor disposed.
 */
function hasChannel<T>(
  record: Readonly<Record<string, T>> | undefined,
  name: string,
): record is Readonly<Record<string, T>> {
  return record !== undefined && Object.prototype.propertyIsEnumerable.call(record, name);
}

/**
 * The batch's channels in the ONE form a device adapter — or an owner
 * counting handles to dispose — should read: the named channels, with a
 * plain `colors` lifted into the reserved `"color"` entry whenever the
 * record does not already carry that channel.
 *
 * The mirror of `instanceAttributesOf` for the CPU residency, and it
 * exists for the same two reasons: an adapter that loops this never has
 * to serve two spellings of instance colour, and an owner that loops this
 * disposes every handle exactly once.
 *
 * **The lift is keyed on the CHANNEL, never on whether `attributes` is
 * present** — the same rule as the CPU twin, for the same reason. A
 * hand-built batch is what `colors` is kept for, and
 * `{ attributes: {}, colors }` (what a host writes when it fills the
 * record generically and finds nothing to put in it) would lose its
 * colour to a presence test. Losing it here costs more than a wrong
 * picture: the lost handle is an OWNER OBLIGATION nothing enumerates any
 * more, so it leaks. Two DIFFERENT handles under the two spellings
 * throws, because either choice would silently drop the other's buffer;
 * `makeDeviceInstanceBatch` makes `colors` an accessor over the channel,
 * so a batch this library builds is always the one-handle case.
 */
export function deviceInstanceAttributesOf(
  batch: DeviceInstanceBatch,
): Readonly<Record<string, DeviceInstanceAttribute>> {
  const { attributes, colors } = batch;
  if (colors === undefined) return attributes ?? NO_DEVICE_INSTANCE_ATTRIBUTES;
  // Own and enumerable: the set a caller can actually enumerate. See
  // {@link hasChannel} for why a plain lookup is the wrong test.
  const channel = hasChannel(attributes, "color") ? attributes.color : undefined;
  // Spreading `undefined` is `{}` — and a spread copies own enumerable
  // keys, the same set — so absent / empty / populated `attributes` are
  // one case here and not three.
  if (channel === undefined) {
    return { ...attributes, color: { handle: colors, type: "f32", itemSize: 3 } };
  }
  if (channel.handle !== colors) {
    throw new Error(
      `deviceInstanceAttributesOf: batch "${batch.assetId}" carries two different colour ` +
        "handles — attributes[\"color\"].handle and colors. `colors` is sugar for the reserved " +
        '"color" channel and not a second buffer, so there is no rule for which one a renderer ' +
        "should draw and no way to dispose both exactly once. Set exactly one of them: keep the " +
        "channel and omit `colors`, or keep the plain `colors` and drop the \"color\" entry " +
        "from attributes. (Batches the library mints install `colors` as an accessor over the " +
        "channel, so the two can never disagree there.)",
    );
  }
  return attributes as Readonly<Record<string, DeviceInstanceAttribute>>;
}

/**
 * Build a device instance batch, installing `colors` as an accessor over
 * the reserved colour channel so the two can never hold different
 * handles. The resident run's spawner terminal mints its batches here.
 */
export function makeDeviceInstanceBatch(
  assetId: string,
  count: number,
  transforms: DeviceTransformsHandle,
  attributes?: Readonly<Record<string, DeviceInstanceAttribute>>,
): DeviceInstanceBatch {
  if (attributes === undefined || Object.keys(attributes).length === 0) {
    return { residency: "device", assetId, count, transforms };
  }
  const batch: DeviceInstanceBatch = { residency: "device", assetId, count, transforms, attributes };
  if (attributes.color !== undefined) {
    Object.defineProperty(batch, "colors", {
      get(this: DeviceInstanceBatch): DeviceTransformsHandle | undefined {
        return this.attributes?.color?.handle;
      },
      enumerable: true,
      configurable: true,
    });
  }
  return batch;
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
   * every byte and every memo key is the CPU reference's.
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
