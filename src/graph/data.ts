import type { Geometry } from "../data/index.js";

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
 */
export interface InstanceBatch {
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
}

/** An instance-batch payload flowing through the graph (spawner terminal). */
export interface InstancesItem {
  readonly kind: "instances";
  readonly batches: readonly InstanceBatch[];
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
