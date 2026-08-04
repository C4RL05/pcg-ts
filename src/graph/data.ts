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

/** One payload flowing through a graph connection. */
export type DataItem = GeometryItem | ValueItem;

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
