import type { AttrData, Geometry } from "../data/index.js";
import type { DeviceInstanceBatch } from "../fields/gpuResolver.js";

/** Plain values a value item can carry. */
export type DataValue = number | readonly number[] | string | boolean;

/** A geometry payload flowing through the graph. */
export interface GeometryItem {
  readonly kind: "geometry";
  readonly geo: Geometry;
  /** Free-form routing/filtering tags. */
  readonly tags: ReadonlySet<string>;
  /**
   * Unique, monotonically-assigned revision id. A node producing a new or
   * modified item gets a fresh rev; unchanged items keep theirs. The memo
   * cache keys on revs — data is never deep-hashed.
   */
  readonly rev: number;
}

/** A plain-value payload flowing through the graph. */
export interface ValueItem {
  readonly kind: "value";
  readonly value: DataValue;
  /** Free-form routing/filtering tags. */
  readonly tags: ReadonlySet<string>;
  /** Unique revision id; see {@link GeometryItem.rev}. */
  readonly rev: number;
}

/**
 * Named per-instance attribute columns riding a spawner batch: channel
 * name → one tightly packed SoA column of `count * itemSize` elements,
 * instance `k` occupying `k * itemSize .. k * itemSize + itemSize - 1`.
 *
 * This is the whole per-instance ABI between a graph and its host. The
 * field grammar has no time input on purpose — a graph produces
 * STRUCTURE and the host animates it — so everything the host needs to
 * drive per-instance behaviour at runtime (a phase offset, a species
 * index, a stable id, an RGBA tint) has to arrive as graph-authored data
 * on this channel. `transforms` and `colors` were the only two things
 * that could cross before, which is why anything else had to be
 * re-derived host-side from a position and stopped being deterministic.
 *
 * **itemSize is DERIVED, not carried**: `column.length / count`. There
 * is no second place for it to be wrong, and a producer that packs the
 * wrong number of components fails a length check at the adapter instead
 * of drawing a skew. At `count === 0` the item size is UNRECOVERABLE
 * (there is nothing to divide by), so a zero-instance batch's columns
 * carry no shape information: an adapter binds none of them and requires
 * each to be empty. The spawner never produces such a batch — grouping
 * builds batches from points — so this is a rule for hand-built ones.
 *
 * **Dtype is PRESERVED, never widened to f32.** The column is the
 * attribute storage's own array class ({@link AttrData} — `Float32Array`
 * / `Int32Array` / `Uint32Array` / `Uint8Array` for `bool`), because f32
 * silently loses integer ids past 2^24 and an instance id is exactly the
 * channel a host asks for first. `THREE.InstancedBufferAttribute` takes
 * any typed array, so nothing downstream needs the widening either. The
 * dtype vocabulary is `src/data`'s (`AttrType` / `ATTR_CTORS`) and not a
 * second one: a channel is a point attribute that crossed the spawner,
 * with the same element type it had on the point domain.
 *
 * `string` columns cannot ride this channel — their data is indices into
 * a per-attribute string table that does not cross with them, so a
 * renderer would receive meaningless integers. The spawner refuses one by
 * name; per-point asset ids have their own route (`assetAttr`).
 */
export type InstanceAttributes = Readonly<Record<string, AttrData>>;

/**
 * The one reserved channel name: per-instance linear RGB.
 *
 * `InstanceBatch.colors` IS this channel — see the field's docs. Reserved
 * because a renderer treats it structurally rather than generically
 * (three hangs it on `InstancedMesh.instanceColor`, a MESH property that
 * flips the shader variant, not a geometry attribute), so a channel that
 * merely happened to be called `color` would be uploaded twice and mean
 * two things. `spawnInstances` refuses to route an instance attribute to
 * this name and says to use `colorAttr` instead.
 */
export const INSTANCE_COLOR_CHANNEL = "color";

/**
 * One batch of instanced-asset transforms — the render-agnostic spawner
 * protocol's payload. A renderer maps `assetId` to an actual renderable
 * (e.g. the three adapter's asset map → `THREE.InstancedMesh`).
 *
 * This is the CPU (host-memory) batch and the reference form: its
 * transforms are composed by `composeTRS` in an f64 interior. A
 * `DeviceInstanceBatch` is the same protocol with the transforms left in
 * a device buffer; the two are discriminated by `residency`, which is
 * absent (or `"cpu"`) here and `"device"` there.
 */
export interface InstanceBatch {
  /**
   * Discriminant against `DeviceInstanceBatch`. Optional and defaulting
   * to CPU so every existing literal `{ assetId, count, transforms }`
   * stays a valid batch; test it as `batch.residency === "device"` to
   * narrow, never as `=== "cpu"`.
   */
  readonly residency?: "cpu";
  /** Which asset every instance in this batch renders; resolved by the renderer. */
  readonly assetId: string;
  /** Number of instances in the batch. */
  readonly count: number;
  /**
   * Packed world transforms: 16 floats per instance
   * (`transforms.length === count * 16`), each block a column-major 4x4
   * matrix laid out exactly like `THREE.Matrix4.elements` — floats 0-3 are
   * the matrix's first column, translation sits at offsets 12-14, and
   * offset 15 is 1. Composed as `T(P) * R(rot) * S(scale)` from the
   * standard point attributes.
   */
  readonly transforms: Float32Array;
  /**
   * Named per-instance columns — the host ABI. See
   * {@link InstanceAttributes} for the layout and why the dtype is kept.
   *
   * **Instance order is the invariant everything else rests on**:
   * `attributes[name]`'s slot `k` and `transforms`' slot `k` are the same
   * instance, for every channel, on every path. The spawner writes them
   * in ONE loop from ONE source index, so there is no second traversal to
   * fall out of step; `tests/instanceAttributes.test.ts` pins it anyway,
   * because a host cannot check it and every consumer assumes it.
   *
   * Absent when the spawn named no channels, exactly as `colors` is
   * absent when it named no colour.
   */
  readonly attributes?: InstanceAttributes;
  /**
   * Optional per-instance linear RGB: 3 floats per instance
   * (`colors.length === count * 3`), instance `k` at offsets `3k..3k+2`,
   * in the SAME instance order as {@link transforms} — the two are
   * written in one loop from one index, so slot `k` of each always
   * describes the same point.
   *
   * **This is SUGAR over {@link attributes}, not a sibling of it.** On a
   * batch this library builds, `colors` is an accessor returning
   * `attributes[`{@link INSTANCE_COLOR_CHANNEL}`]` — one buffer, two
   * spellings, and the second one exists only so consumers written
   * against the older shape keep working. It is deliberately NOT a second
   * mechanism: an adapter reads {@link instanceAttributesOf} and handles
   * the reserved colour channel there, so it never has to serve two
   * spellings of one thing. A hand-built batch may still set `colors` as
   * a plain property — with no `attributes`, with an empty record, or
   * beside other channels — and {@link instanceAttributesOf} lifts it
   * into the reserved channel in every one of those cases, so that batch
   * takes the identical path. Setting BOTH spellings to different
   * buffers is the one shape that throws there.
   *
   * Three floats and not four: both three adapters take RGB, so the
   * spawner drops alpha rather than carrying a component no renderer can
   * use. That narrowing stays. The general channel above is how an RGBA
   * (or an HSV, or a two-colour gradient) reaches a host — widening
   * `colors` to 4 components would break every renderer that reads it and
   * would serve only the one case the general channel already serves.
   * Packed like {@link transforms} for the same reason — the batch is a
   * render-agnostic protocol, but the layout it commits to is the one a
   * renderer can upload without touching it.
   *
   * ABSENT is meaningful and is the default: a spawn that was not asked
   * for colour (`spawnInstances`' `colorAttr`) allocates nothing here,
   * and a renderer must then leave its instance-colour channel alone —
   * writing an all-white buffer instead would flip three's shader
   * variant and recompile a program for zero pixels changed.
   */
  readonly colors?: Float32Array;
}

/** No channels: the shared empty record every channel-less batch reads as. */
const NO_INSTANCE_ATTRIBUTES: InstanceAttributes = Object.freeze({});

/**
 * Does this record carry `name` the way its CONSUMERS see it — as an own,
 * enumerable key, which is what `Object.keys` / `Object.entries` /
 * spreading report and what every adapter loops?
 *
 * A plain `record[name]` would also find an inherited or non-enumerable
 * one, and answering "present" for a channel nothing downstream can
 * enumerate is how the colour a caller DID supply gets dropped for one it
 * cannot use.
 */
function hasChannel<T>(
  record: Readonly<Record<string, T>> | undefined,
  name: string,
): record is Readonly<Record<string, T>> {
  return record !== undefined && Object.prototype.propertyIsEnumerable.call(record, name);
}

/**
 * The batch's channels in the ONE form an adapter should read: the named
 * columns, with a plain `colors` lifted into
 * {@link INSTANCE_COLOR_CHANNEL} whenever the record does not already
 * carry that channel.
 *
 * This function is why `colors` costs nothing to keep. Every renderer
 * adapter loops this record and special-cases exactly one name (the
 * reserved colour channel, which three hangs on the mesh rather than the
 * geometry); none of them reads `batch.colors`, so the two spellings
 * never become two code paths. Hosts writing their own adapter should
 * start here for the same reason.
 *
 * **The lift is keyed on the CHANNEL, never on whether `attributes` is
 * present.** A hand-built batch is the whole reason `colors` still
 * exists, and `{ attributes: {}, colors }` — what a host writes when it
 * fills the record generically and finds nothing to put in it — is
 * exactly the shape a presence test drops on the floor. `attributes:
 * { phase }` beside a plain `colors` is the same defect one channel
 * later. Both are honoured here: the record decides only what colour
 * merges INTO, so an empty one and an absent one converge, and there is
 * no emptiness case anywhere.
 *
 * The one shape that cannot be honoured is two DIFFERENT colour buffers,
 * one under each spelling: they are one thing spelled twice, so nothing
 * here could pick a winner without silently discarding the other. It
 * throws instead. A batch from {@link makeInstanceBatch} can never hit
 * that — its `colors` is an accessor over the channel, so the two are
 * the same array by construction, and the identity test below passes.
 */
export function instanceAttributesOf(batch: InstanceBatch): InstanceAttributes {
  const { attributes, colors } = batch;
  if (colors === undefined) return attributes ?? NO_INSTANCE_ATTRIBUTES;
  // OWN AND ENUMERABLE, which is what `Object.keys`/`Object.entries`
  // report and therefore the only thing a consumer of this record can
  // see. A `color` reachable only through a prototype (a host layering
  // its channels over a defaults object) or hidden as non-enumerable is
  // invisible to every caller, so counting it as present would drop the
  // plain `colors` in favour of something nothing downstream can read.
  const channel = hasChannel(attributes, INSTANCE_COLOR_CHANNEL)
    ? attributes[INSTANCE_COLOR_CHANNEL]
    : undefined;
  // Spreading `undefined` is `{}` — and a spread copies own enumerable
  // keys, the same set — so absent / empty / populated `attributes` are
  // one case here and not three.
  if (channel === undefined) return { ...attributes, [INSTANCE_COLOR_CHANNEL]: colors };
  if (channel !== colors) {
    throw new Error(
      `instanceAttributesOf: batch "${batch.assetId}" carries two different colour buffers — ` +
        `attributes["${INSTANCE_COLOR_CHANNEL}"] (${channel.length} elements) and colors ` +
        `(${colors.length} floats). \`colors\` is sugar for the reserved ` +
        `"${INSTANCE_COLOR_CHANNEL}" channel and not a second buffer, so there is no rule for ` +
        "which one a renderer should draw. Set exactly one of them: keep the channel and omit " +
        "`colors`, or keep the plain `colors` and drop the " +
        `"${INSTANCE_COLOR_CHANNEL}" entry from attributes. (Batches the library mints install ` +
        "`colors` as an accessor over the channel, so the two can never disagree there.)",
    );
  }
  return attributes as InstanceAttributes;
}

/**
 * Build a CPU instance batch, installing `colors` as an accessor over the
 * reserved colour channel so the two can never hold different buffers.
 *
 * The spawner and the worker's decode both mint batches through here.
 * A caller with no channels can still write the plain literal
 * `{ assetId, count, transforms }` — that has always been a valid batch
 * and stays one.
 */
export function makeInstanceBatch(
  assetId: string,
  count: number,
  transforms: Float32Array,
  attributes?: InstanceAttributes,
): InstanceBatch {
  if (attributes === undefined || Object.keys(attributes).length === 0) {
    return { assetId, count, transforms };
  }
  const batch: InstanceBatch = { assetId, count, transforms, attributes };
  if (attributes[INSTANCE_COLOR_CHANNEL] !== undefined) {
    // An accessor, not a copied reference: `colors` is a VIEW of the
    // channel and there is no assignment that could leave the two
    // disagreeing. Enumerable so structured clone still carries it — the
    // clone algorithm memoizes by reference, so the colour array survives
    // as ONE array reachable under both names, exactly as it is here.
    Object.defineProperty(batch, "colors", {
      get(this: InstanceBatch): Float32Array | undefined {
        return this.attributes?.[INSTANCE_COLOR_CHANNEL] as Float32Array | undefined;
      },
      enumerable: true,
      configurable: true,
    });
  }
  return batch;
}

/** Either residency of a spawner batch; narrow on `residency`. */
export type AnyInstanceBatch = InstanceBatch | DeviceInstanceBatch;

/** Is this batch device-resident (transforms in a device buffer)? */
export function isDeviceInstanceBatch(batch: AnyInstanceBatch): batch is DeviceInstanceBatch {
  return batch.residency === "device";
}

/**
 * An instance-batch payload flowing through the graph (spawner terminal).
 *
 * Residency. `batches` is the CPU form and is what every renderer
 * adapter reads. When a spawner terminal was fused into a device-resident
 * run its transforms never reached host memory, and the item instead
 * carries {@link deviceBatches}; `batches` then has no meaning and
 * READING IT THROWS — deliberately, because the alternative is a CPU
 * consumer silently drawing nothing. Check {@link deviceBatches} (or
 * `isDeviceResidentInstances`) before touching `batches` in code that can
 * see either.
 */
export interface InstancesItem {
  readonly kind: "instances";
  readonly batches: readonly InstanceBatch[];
  /**
   * Device-resident batches, present exactly when the producing spawner
   * ran inside a device-resident run. The receiver owns every handle in
   * them and must dispose it — see `DeviceTransformsHandle`. Absent on
   * every CPU-spawned item, so existing consumers are unaffected.
   */
  readonly deviceBatches?: readonly DeviceInstanceBatch[];
  /** Free-form routing/filtering tags. */
  readonly tags: ReadonlySet<string>;
  /** Unique revision id; see {@link GeometryItem.rev}. */
  readonly rev: number;
}

/** One payload flowing through a graph connection. */
export type DataItem = GeometryItem | ValueItem | InstancesItem;

/** What a pin carries: an ordered, immutable list of items. */
export type DataCollection = readonly DataItem[];

let revCounter = 0;

/**
 * Allocate the next revision id. Called whenever a node produces a new or
 * modified data item; caching keys on these ids instead of hashing data.
 */
export function nextRev(): number {
  return ++revCounter;
}

const NO_TAGS: ReadonlySet<string> = new Set();

function makeTags(tags: Iterable<string> | undefined): ReadonlySet<string> {
  if (tags === undefined) return NO_TAGS;
  const set = new Set(tags);
  return set.size === 0 ? NO_TAGS : set;
}

/** Wrap a geometry in a data item with a fresh rev. */
export function makeGeometryItem(geo: Geometry, tags?: Iterable<string>): GeometryItem {
  return { kind: "geometry", geo, tags: makeTags(tags), rev: nextRev() };
}

/** Wrap a plain value in a data item with a fresh rev. */
export function makeValueItem(value: DataValue, tags?: Iterable<string>): ValueItem {
  return { kind: "value", value, tags: makeTags(tags), rev: nextRev() };
}

/** Wrap instance batches in a data item with a fresh rev. */
export function makeInstancesItem(
  batches: readonly InstanceBatch[],
  tags?: Iterable<string>,
): InstancesItem {
  return { kind: "instances", batches, tags: makeTags(tags), rev: nextRev() };
}

/**
 * Wrap device-resident instance batches in a data item with a fresh rev.
 *
 * The item's `batches` is an accessor that THROWS: there are no CPU
 * transforms to hand out, and a silently empty list would make a WebGL
 * adapter draw nothing with no explanation. The message names the
 * situation and both fixes (consume `deviceBatches` with a WebGPU
 * adapter, or drop the resolver's device-instance opt-in to get CPU
 * batches back).
 *
 * The caller of the cook that produced these batches owns their handles
 * and must dispose them; the graph never caches or frees one (see
 * `DeviceTransformsHandle`).
 */
export function makeDeviceInstancesItem(
  deviceBatches: readonly DeviceInstanceBatch[],
  tags?: Iterable<string>,
): InstancesItem {
  return {
    kind: "instances",
    get batches(): readonly InstanceBatch[] {
      throw new Error(
        `instances item is device-resident (${deviceBatches.length} batch(es), ` +
          `${deviceBatches.reduce((n, b) => n + b.count, 0)} instances): its transforms live in ` +
          "GPU buffers and were never composed on the CPU, so `batches` does not exist. Read " +
          "`item.deviceBatches` and bind each batch's `transforms` handle with a WebGPU " +
          "renderer, or construct the GpuFieldEvaluator without `deviceInstances: true` to get " +
          "CPU `batches` back.",
      );
    },
    deviceBatches,
    tags: makeTags(tags),
    rev: nextRev(),
  };
}

/**
 * Is this instances item device-resident? True exactly when reading its
 * `batches` would throw and `deviceBatches` carries the payload.
 */
export function isDeviceResidentInstances(item: InstancesItem): boolean {
  return item.deviceBatches !== undefined;
}

/** Items carrying the given tag, in collection order. */
export function filterByTag(collection: DataCollection, tag: string): DataCollection {
  return collection.filter((item) => item.tags.has(tag));
}

/** The first geometry payload in the collection, if any. */
export function firstGeometry(collection: DataCollection): Geometry | undefined {
  for (const item of collection) {
    if (item.kind === "geometry") return item.geo;
  }
  return undefined;
}
