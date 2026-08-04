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
  return (
    (it.kind === "geometry" || it.kind === "value" || it.kind === "instances") &&
    typeof it.rev === "number"
  );
}

/**
 * Emits exactly `params.items` on its `out` pin. Items keep their revs, and
 * revs are what param hashing keys on, so the memo cache stays correct:
 * re-injecting the same items is a cache hit, injecting fresh ones recooks.
 *
 * Aliasing contract: the emitted collection IS the bound array — cook
 * results (and any cell store holding them) alias it. Treat the array as
 * frozen once bound: mutating it in place changes stored "content" without
 * any rev or staleness signal. To change the data, bind a fresh array
 * (fresh item revs) or invalidate the affected cells. Outside production
 * (`NODE_ENV !== "production"`), execute freezes the array so an in-place
 * mutation throws instead of silently diverging.
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
          `dataInput param "items"[${i}] is not a DataItem (expected a geometry, value or instances item; see makeGeometryItem/makeValueItem/makeInstancesItem)`,
        );
      }
    }
    // Dev-mode guard for the aliasing contract (see the doc above): the
    // emitted collection aliases the bound array, so late in-place
    // mutation must fail loudly rather than tear stored outputs.
    const env = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
      .process?.env?.NODE_ENV;
    if (env !== "production") {
      Object.freeze(items);
    }
    return { out: items };
  },
});

// The registry's param schema types cannot express an item list, so the
// spec above declares a placeholder; the real default is an empty list.
const NO_ITEMS: readonly DataItem[] = Object.freeze([]);
(dataInput.defaultParams as { items: readonly DataItem[] }).items = NO_ITEMS;
