/**
 * @internal The def → wrapped-graph link, in a module of its own.
 *
 * `subgraph.ts` writes it (every def `subgraphNode` creates records its
 * {@link SubgraphSpec} here) and `graph.ts` reads it, so that `Graph.add`
 * can refuse a node whose definition wraps the graph it is being added to
 * — a cycle no cook can survive. `subgraph.ts` already imports `graph.ts`
 * at runtime, so the map cannot live there without an import cycle. This
 * module imports nothing at runtime, so both sides may depend on it.
 */
import type { Graph } from "./graph.js";
import type { SubgraphSpec } from "./subgraph.js";

/** @internal Recorded composition of every def created by `subgraphNode`. */
export const subgraphSpecs = new WeakMap<object, SubgraphSpec>();

/** @internal The graph a def wraps; `undefined` for any other def. */
export function wrappedGraphOf(def: object): Graph | undefined {
  return subgraphSpecs.get(def)?.graph;
}
