/**
 * `dataInput`: a source node emitting exactly the data items in its
 * `items` param — the bridge for injecting externally produced data into
 * a graph, e.g. parent-cell outputs in the hierarchical runtime.
 */
import type { DataItem } from "../graph/index.js";
import { standardNode } from "../nodes/registry.js";

/** Params of {@link dataInput}. */
export interface DataInputParams {
  /** Data items to emit, set programmatically via `graph.setParam`. */
  items: readonly DataItem[];
}

function isDataItem(v: unknown): v is DataItem {
  if (typeof v !== "object" || v === null) return false;
  const it = v as { kind?: unknown; rev?: unknown };
  return (it.kind === "geometry" || it.kind === "value") && typeof it.rev === "number";
}

/**
 * Emits exactly `params.items` on its `out` pin. Items keep their revs, and
 * revs are what param hashing keys on, so the memo cache stays correct:
 * re-injecting the same items is a cache hit, injecting fresh ones recooks.
 */
export const dataInput = standardNode<DataInputParams>({
  type: "dataInput",
  description:
    "Emits exactly the data items in its `items` param, unchanged — the bridge for injecting externally produced data (for example parent-cell outputs in the hierarchical runtime) into a graph. Items hash by rev in memo keys, so caching stays correct as items are swapped.",
  inputs: [],
  outputs: [{ name: "out", kind: "any" }],
  params: {
    items: {
      type: "string",
      default: "",
      description:
        "The DataItem array to emit, set programmatically via graph.setParam. The declared schema type is a placeholder (the registry has no item-list param type); the actual default is an empty list and the value is not JSON-serializable.",
    },
  },
  execute({ params }) {
    const items = params.items;
    if (!Array.isArray(items)) {
      throw new Error(
        `dataInput param "items" must be an array of DataItems (got ${typeof items}); set it with graph.setParam(node, "items", [...])`,
      );
    }
    for (let i = 0; i < items.length; i++) {
      if (!isDataItem(items[i])) {
        throw new Error(
          `dataInput param "items"[${i}] is not a DataItem (expected a geometry or value item; see makeGeometryItem/makeValueItem)`,
        );
      }
    }
    return { out: items };
  },
});

// The registry's param schema types cannot express an item list, so the
// spec above declares a placeholder; the real default is an empty list.
const NO_ITEMS: readonly DataItem[] = Object.freeze([]);
(dataInput.defaultParams as { items: readonly DataItem[] }).items = NO_ITEMS;
