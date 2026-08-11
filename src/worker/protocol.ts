/**
 * The cook worker wire protocol: message shapes and the output/error
 * codecs shared by the pool (main side) and the worker host.
 *
 * Design constraints, in order:
 * - Everything crossing the boundary is structured-clone-safe, and every
 *   typed array rides the transfer list — a cooked cell moves as buffer
 *   ownership, not as a copy.
 * - Cook outputs alias live memo caches (see `CookResult`), so the worker
 *   must never transfer the arrays it holds: `encodeOutputs` slices each
 *   column once (the one unavoidable copy) and transfers the slices.
 * - Errors cross as (name, message, nodeId) and are rehydrated into the
 *   library's own error classes, so `instanceof` checks and the
 *   node-naming message contract survive the boundary.
 */
import { Geometry, type AttrData, type AttrType, type AttributeSet } from "../data/index.js";
import {
  CookCancelledError,
  GraphCycleError,
  GraphError,
  GraphValidationError,
  NodeExecutionError,
  makeGeometryItem,
  makeInstancesItem,
  makeValueItem,
  type DataCollection,
  type DataValue,
  type InstanceBatch,
} from "../graph/index.js";
import { GraphSerializationError, type SerializedGraph } from "../nodes/serialize.js";
import type { CellOutputs, ParamPatch } from "../runtime/types.js";

/** One encoded attribute column (length = count * tupleSize, exactly). */
export interface EncodedAttr {
  readonly name: string;
  readonly type: AttrType;
  readonly tupleSize: number;
  /** Per-element default (tuple for numeric types, string for "string"). */
  readonly default: readonly number[] | string;
  /**
   * The full string table, in interning order, for `"string"` attributes.
   * Carried verbatim (and re-interned in the same order on decode) so the
   * u32 indices in `data` stay byte-identical to the cooked originals.
   */
  readonly stringTable?: readonly string[];
  readonly data: AttrData;
}

/** One domain of a geometry: element count plus columns in insertion order. */
export interface EncodedDomain {
  readonly count: number;
  readonly attrs: readonly EncodedAttr[];
}

/** A geometry item in wire form. */
export interface EncodedGeometryItem {
  readonly kind: "geometry";
  readonly tags: readonly string[];
  readonly point: EncodedDomain;
  readonly vertex: EncodedDomain;
  readonly primitive: EncodedDomain;
  readonly detail: EncodedDomain;
  readonly vertexToPoint: Uint32Array;
  readonly primVertexStart: Uint32Array;
  readonly primVertexCount: Uint32Array;
}

/** A value item in wire form. */
export interface EncodedValueItem {
  readonly kind: "value";
  readonly tags: readonly string[];
  readonly value: DataValue;
}

/** One instance batch in wire form (CPU batches only). */
export interface EncodedInstanceBatch {
  readonly assetId: string;
  readonly count: number;
  readonly transforms: Float32Array;
  readonly colors?: Float32Array;
}

/** An instances item in wire form. */
export interface EncodedInstancesItem {
  readonly kind: "instances";
  readonly tags: readonly string[];
  readonly batches: readonly EncodedInstanceBatch[];
}

/** Any data item in wire form. */
export type EncodedDataItem = EncodedGeometryItem | EncodedValueItem | EncodedInstancesItem;

/** A cook's declared outputs in wire form, keyed by output name. */
export type EncodedOutputs = Record<string, readonly EncodedDataItem[]>;

/** An error in wire form; see {@link decodeError} for the rehydration. */
export interface EncodedError {
  readonly name: string;
  readonly message: string;
  /** Present when the source was a `NodeExecutionError`. */
  readonly nodeId?: string;
}

/** Worker-side timing and cache counters for one cook. */
export interface WorkerCookStats {
  /** Nodes whose execute ran (see `CookStats.cooked`). */
  readonly cooked: number;
  /** Nodes served from their memo cache. */
  readonly cached: number;
  /** Wall time of the cook itself, on the worker. */
  readonly cookMs: number;
  /** Wall time of `encodeOutputs`, on the worker. */
  readonly encodeMs: number;
}

/** Messages the pool sends to a worker. */
export type MainToWorkerMessage =
  | {
      /** Register a serialized graph under a key; cached until released. */
      readonly t: "graph";
      readonly key: string;
      readonly graph: SerializedGraph;
    }
  | {
      /** Cook a registered graph with per-cook patches. */
      readonly t: "cook";
      readonly id: number;
      readonly key: string;
      readonly patches: readonly ParamPatch[];
      readonly seed?: number;
      readonly outputs?: readonly string[];
    }
  | {
      /** Drop a registered graph (and its warm caches). */
      readonly t: "release";
      readonly key: string;
    };

/** Messages a worker sends back to the pool. */
export type WorkerToMainMessage =
  | {
      readonly t: "ok";
      readonly id: number;
      readonly outputs: EncodedOutputs;
      readonly stats: WorkerCookStats;
    }
  | {
      readonly t: "err";
      readonly id: number;
      readonly error: EncodedError;
    };

function encodeDomain(set: AttributeSet, transfer: ArrayBuffer[]): EncodedDomain {
  const attrs: EncodedAttr[] = [];
  for (const attr of set) {
    // Slice to the logical length: the backing store is capacity-sized and
    // ALIASES the live memo cache — transferring it would detach the
    // worker's own cache. The slice is the encode path's one copy.
    const data = attr.data.slice(0, set.count * attr.tupleSize);
    transfer.push(data.buffer as ArrayBuffer);
    attrs.push({
      name: attr.name,
      type: attr.type,
      tupleSize: attr.tupleSize,
      default:
        typeof attr.defaultValue === "string" ? attr.defaultValue : [...attr.defaultValue],
      ...(attr.type === "string" ? { stringTable: [...attr.stringTable] } : {}),
      data,
    });
  }
  return { count: set.count, attrs };
}

function decodeDomain(set: AttributeSet, enc: EncodedDomain): void {
  for (const a of enc.attrs) {
    if (a.type === "string") {
      // Rebuild the string table in interning order so the u32 indices in
      // `data` mean the same strings. `table[0]` is whatever the source
      // interned first (its construction-time default); the CURRENT
      // default may differ (`AttributeSet.replace` can reset it), so it is
      // restored separately after the table is in place.
      const table = a.stringTable ?? [];
      const attr = set.add(a.name, "string", a.tupleSize, table[0] ?? "");
      for (let i = 1; i < table.length; i++) attr.internString(table[i]);
      attr._setDefault(a.default as string);
    } else {
      set.add(a.name, a.type, a.tupleSize, a.default as number[]);
    }
  }
  set.resize(enc.count);
  for (const a of enc.attrs) {
    set.require(a.name).data.set(a.data);
  }
}

function encodeGeometry(geo: Geometry, transfer: ArrayBuffer[]): Omit<EncodedGeometryItem, "kind" | "tags"> {
  const vertexToPoint = geo.vertexToPoint.slice();
  const primVertexStart = geo.primVertexStart.slice();
  const primVertexCount = geo.primVertexCount.slice();
  transfer.push(
    vertexToPoint.buffer as ArrayBuffer,
    primVertexStart.buffer as ArrayBuffer,
    primVertexCount.buffer as ArrayBuffer,
  );
  return {
    point: encodeDomain(geo.attrs.point, transfer),
    vertex: encodeDomain(geo.attrs.vertex, transfer),
    primitive: encodeDomain(geo.attrs.primitive, transfer),
    detail: encodeDomain(geo.attrs.detail, transfer),
    vertexToPoint,
    primVertexStart,
    primVertexCount,
  };
}

function decodeGeometry(enc: EncodedGeometryItem): Geometry {
  const geo = new Geometry();
  decodeDomain(geo.attrs.point, enc.point);
  // The topology arrays arrived through the transfer list, so this side
  // owns them exclusively: adopt them instead of re-validating what a
  // trusted cook already validated (`setTopology` would copy and
  // re-check every reference).
  geo.vertexToPoint = enc.vertexToPoint;
  geo.primVertexStart = enc.primVertexStart;
  geo.primVertexCount = enc.primVertexCount;
  decodeDomain(geo.attrs.vertex, enc.vertex);
  decodeDomain(geo.attrs.primitive, enc.primitive);
  decodeDomain(geo.attrs.detail, enc.detail);
  return geo;
}

/**
 * Encode a cook's outputs for `postMessage`, returning the message body
 * and the transfer list (every typed array's buffer, freshly sliced so
 * the live cook caches keep their storage). CPU items only: an item
 * carrying device-resident batches has no host bytes to move and is
 * refused with the fix.
 */
export function encodeOutputs(outputs: CellOutputs): {
  encoded: EncodedOutputs;
  transfer: ArrayBuffer[];
} {
  const transfer: ArrayBuffer[] = [];
  const encoded: Record<string, EncodedDataItem[]> = {};
  for (const [name, collection] of Object.entries(outputs)) {
    encoded[name] = collection.map((item): EncodedDataItem => {
      const tags = [...item.tags];
      if (item.kind === "value") {
        const value = item.value;
        return { kind: "value", tags, value: Array.isArray(value) ? [...value] : value };
      }
      if (item.kind === "geometry") {
        return { kind: "geometry", tags, ...encodeGeometry(item.geo, transfer) };
      }
      if (item.deviceBatches !== undefined) {
        throw new GraphValidationError(
          `output "${name}": instances item is device-resident, so its transforms live in GPU buffers with no host bytes to post across a thread; cook without a GPU resolver (worker cooks are CPU-only) to get transferable CPU batches`,
        );
      }
      return {
        kind: "instances",
        tags,
        batches: item.batches.map((b): EncodedInstanceBatch => {
          const transforms = b.transforms.slice();
          transfer.push(transforms.buffer as ArrayBuffer);
          const colors = b.colors?.slice();
          if (colors !== undefined) transfer.push(colors.buffer as ArrayBuffer);
          return {
            assetId: b.assetId,
            count: b.count,
            transforms,
            ...(colors !== undefined ? { colors } : {}),
          };
        }),
      };
    });
  }
  return { encoded, transfer };
}

/**
 * Rehydrate encoded outputs into the shapes `cook()` returns: geometry
 * items with rebuilt `Geometry` containers, instance batches adopting the
 * transferred arrays directly (no copy), value items, tags preserved.
 * Items get fresh revs, exactly like any newly produced data.
 */
export function decodeOutputs(encoded: EncodedOutputs): CellOutputs {
  const outputs: Record<string, DataCollection> = {};
  for (const [name, collection] of Object.entries(encoded)) {
    outputs[name] = collection.map((item) => {
      if (item.kind === "value") return makeValueItem(item.value, item.tags);
      if (item.kind === "geometry") return makeGeometryItem(decodeGeometry(item), item.tags);
      return makeInstancesItem(
        item.batches.map(
          (b): InstanceBatch => ({
            assetId: b.assetId,
            count: b.count,
            transforms: b.transforms,
            ...(b.colors !== undefined ? { colors: b.colors } : {}),
          }),
        ),
        item.tags,
      );
    });
  }
  return outputs;
}

/** Flatten an error for the wire, keeping name, message, and node id. */
export function encodeError(err: unknown): EncodedError {
  if (err instanceof NodeExecutionError) {
    return { name: err.name, message: err.message, nodeId: err.nodeId };
  }
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { name: "Error", message: String(err) };
}

/**
 * Rehydrate a wire error into the library class its name says it was, so
 * `instanceof CookCancelledError` (and friends) keep working across the
 * thread boundary. Messages cross verbatim — the node/pin/param naming
 * contract is carried by the message text. Unknown names become a plain
 * `Error` with the name restored.
 */
export function decodeError(e: EncodedError): Error {
  switch (e.name) {
    case "NodeExecutionError":
      return new NodeExecutionError(e.nodeId ?? "(unknown)", undefined, e.message);
    case "CookCancelledError":
      return new CookCancelledError(e.message);
    case "GraphValidationError":
      return new GraphValidationError(e.message);
    case "GraphCycleError":
      return new GraphCycleError(e.message);
    case "GraphSerializationError":
      return new GraphSerializationError(e.message);
    case "GraphError":
      return new GraphError(e.message);
    default: {
      const err = new Error(e.message);
      err.name = e.name;
      return err;
    }
  }
}
