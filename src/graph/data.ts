import type { Geometry } from "../data/index.js";
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
   * Optional per-instance linear RGB: 3 floats per instance
   * (`colors.length === count * 3`), instance `k` at offsets `3k..3k+2`,
   * in the SAME instance order as {@link transforms} — the two are
   * written in one loop from one index, so slot `k` of each always
   * describes the same point.
   *
   * Three floats and not four: both three adapters take RGB, so the
   * spawner drops alpha rather than carrying a component no renderer can
   * use. Packed like {@link transforms} for the same reason — the batch
   * is a render-agnostic protocol, but the layout it commits to is the
   * one a renderer can upload without touching it.
   *
   * ABSENT is meaningful and is the default: a spawn that was not asked
   * for colour (`spawnInstances`' `colorAttr`) allocates nothing here,
   * and a renderer must then leave its instance-colour channel alone —
   * writing an all-white buffer instead would flip three's shader
   * variant and recompile a program for zero pixels changed.
   */
  readonly colors?: Float32Array;
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
