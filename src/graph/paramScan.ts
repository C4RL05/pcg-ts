/**
 * What a graph's field expressions read BY NAME, computed once per edit.
 *
 * Two mechanisms bind a `{"fn":"param","name":…}` reference and both need
 * the same walk: a subgraph wrapper binding its body's expressions at cook
 * time (`subgraph.ts`), and a graph-scoped param binding its own graph's at
 * deserialize and on every knob turn (`graph.ts`). The walk was written for
 * the first and hoisted here when the second arrived — one scan, so a fn
 * that puts a spec somewhere new is taught once.
 *
 * Only AUTHORED specs are bindable. A field composed in TypeScript on top
 * of one — `mul(fieldFromJson(spec), 3)` — carries a DERIVED spec, and
 * rebuilding from that would hand the field an authored spec it never had,
 * moving it onto the device for a graph that never asked (see `deviceSpec`).
 * Those are collected separately so each caller can refuse them with the
 * message its own vocabulary calls for: a body slot reading a name its
 * wrapper declares, or a node slot reading a name its graph declares, would
 * otherwise keep the value it was built with while every authored
 * expression took the new one.
 */
import { isField } from "../fields/index.js";
import { type FieldSpec, isDerivedSpec, peekFieldSpec } from "../fields/spec.js";
import { paramNamesOf, unboundParamNamesOf } from "../fields/fieldJson.js";
import type { Graph } from "./graph.js";

/** One node param holding a field expression that reads at least one name. */
export interface ParamFieldRef {
  readonly node: string;
  readonly param: string;
  /**
   * The AUTHORED spec, which is the reference and not what a binding
   * substituted into it: `fieldFromJson` clones the spec and stamps the
   * clone on the rebuilt field, so the reference is still what a re-scan
   * (or a save) sees while a rebuild is installed.
   */
  readonly spec: FieldSpec;
  /** Names this spec references, sorted and deduplicated. */
  readonly names: readonly string[];
  /**
   * The subset of {@link names} this spec does NOT supply itself — the ones
   * a `param` node mentions without carrying an inline value. Those are
   * what a binder must declare; a self-supplied name is bindable but not
   * required, so it is bound when declared and left to its own value when
   * not.
   */
  readonly needs: readonly string[];
}

/** What one graph's field expressions read, as of one {@link Graph.version}. */
export interface ParamScan {
  readonly version: number;
  /** Slots holding an AUTHORED spec: the ones a rebuild can reach. */
  readonly refs: readonly ParamFieldRef[];
  /** Slots reading a name through a DERIVED spec, which cannot be rebuilt. */
  readonly derivedRefs: readonly ParamFieldRef[];
  /** Every name any of `refs` reads. */
  readonly names: ReadonlySet<string>;
}

const scans = new WeakMap<Graph, ParamScan>();

/**
 * What `graph` reads by name, computed once per edit of it.
 *
 * Version-keyed rather than frozen at wrap time, because a graph is not
 * frozen at wrap time: `getSubgraphSpec(def).graph` is the sanctioned door
 * back to a body, and setting a field on a node after wrapping is an
 * ordinary edit. Every such edit bumps {@link Graph.version} (the quiet
 * writes `subgraph.ts` makes deliberately do not), and that same counter is
 * already in a wrapper's `memoKey` through `transitiveVersionKey` — so a
 * body whose scan moved is a body whose wrapper recooks anyway.
 *
 * Keyed per GRAPH rather than per def: one body can back several wrappers,
 * and what it reads is a fact about the graph alone.
 *
 * **Take the scan BEFORE the first write.** `setParam` bumps the version,
 * which invalidates this memo mid-loop; a cold re-scan would then read a
 * graph the caller has already substituted into, and bind the substituted
 * value a second time.
 */
export function paramScan(graph: Graph): ParamScan {
  const cached = scans.get(graph);
  if (cached !== undefined && cached.version === graph.version) return cached;
  const refs: ParamFieldRef[] = [];
  const derivedRefs: ParamFieldRef[] = [];
  const names = new Set<string>();
  for (const state of graph._nodes.values()) {
    for (const [param, value] of Object.entries(state.params)) {
      if (!isField(value)) continue;
      const spec = peekFieldSpec(value);
      if (spec === undefined) continue;
      const read = paramNamesOf(spec);
      if (read.length === 0) continue;
      const ref: ParamFieldRef = {
        node: state.id,
        param,
        spec,
        names: read,
        needs: unboundParamNamesOf(spec),
      };
      if (isDerivedSpec(spec)) {
        derivedRefs.push(ref);
        continue;
      }
      refs.push(ref);
      for (const name of read) names.add(name);
    }
  }
  const scan: ParamScan = { version: graph.version, refs, derivedRefs, names };
  scans.set(graph, scan);
  return scan;
}

/** `"nodeId".param`, the way these errors name a slot. */
export function refLabel(ref: ParamFieldRef): string {
  return `"${ref.node}".${ref.param}`;
}
