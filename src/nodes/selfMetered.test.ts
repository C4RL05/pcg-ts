/**
 * `selfMetered`: the one fact that keeps a budgeted timing honest.
 *
 * The executor's budget check sits between nodes, so an ordinary node's
 * `NodeDoneInfo.elapsedMs` is an uninterrupted block. Three types break
 * that by metering `budgetMs` inside their own execute, and the number
 * they report then spans yield LATENCY, not work — under a 1 ms budget a
 * `repeatUntil` measured 450.7 ms against a real longest block of ~4.7 ms,
 * which is the setting that makes the graph most launchable reporting as
 * the worst. Consumers cannot see inside an execute, so before this fact
 * was published the only way to read those timings correctly was to
 * hardcode our type names — a second model of our scheduler, free to
 * drift from ours.
 *
 * These tests pin both halves of the fix: the catalog names the set
 * (no cooking required), and the def a factory builds agrees with the
 * catalog entry that describes it. `src/graph/schedule.test.ts` pins the
 * executor half — that the flag is read off the def rather than off a
 * list of names.
 */
import { describe, expect, it } from "vitest";
// Side-effect imports: register the standard types living outside
// src/nodes, so the sweep below sees the whole standard library.
import "../runtime/index.js";
import "../spawn/index.js";
import { cook, type NodeDoneInfo } from "../graph/execute.js";
import { Graph } from "../graph/graph.js";
import { defineNode, type NodeDef } from "../graph/node.js";
import { subgraphNode } from "../graph/subgraph.js";
import { dataInput } from "../runtime/dataInput.js";
import { makeValueItem } from "../graph/data.js";
import { forEachNode } from "./forEach.js";
import { repeatUntilNode } from "./repeatUntil.js";
import { getNodeType, listNodeTypes } from "./index.js";

/**
 * The whole set, written once. A fourth wrapper — or a leaf that starts
 * yielding on the budget — belongs here, and every assertion below then
 * says where it is missing.
 */
const SELF_METERING = ["forEach", "repeatUntil", "subgraph"];

/** A leaf that just passes its input through; never self-metering. */
const passthrough = defineNode<Record<string, never>>({
  type: "smPassthrough",
  inputs: [{ name: "in", kind: "any" }],
  outputs: [{ name: "out", kind: "any" }],
  defaultParams: {},
  execute: ({ inputs }) => ({ out: inputs.in }),
});

/** A fresh inner graph per wrapper: each factory injects its own portals. */
function passthroughGraph(): { g: Graph; node: ReturnType<Graph["add"]> } {
  const g = new Graph();
  const node = g.add(passthrough, undefined, "p");
  return { g, node };
}

/** One instance of each wrapper kind, built through its public factory. */
function wrapperDefs(): Record<string, NodeDef<Record<string, unknown>>> {
  const sub = passthroughGraph();
  const each = passthroughGraph();
  const rep = passthroughGraph();
  return {
    subgraph: subgraphNode(sub.g, [], [{ name: "res", node: sub.node, pin: "out" }]),
    forEach: forEachNode(
      each.g,
      [{ name: "each", node: each.node, pin: "in" }],
      [{ name: "res", node: each.node, pin: "out" }],
    ),
    repeatUntil: repeatUntilNode(
      rep.g,
      [{ name: "carry", node: rep.node, pin: "in" }],
      [{ name: "carry", node: rep.node, pin: "out" }],
    ),
  };
}

describe("selfMetered: the catalog names the set", () => {
  it("publishes exactly the three composites, and nothing else", () => {
    const flagged = listNodeTypes()
      .filter((t) => t.selfMetered === true)
      .map((t) => t.type)
      .sort();
    expect(flagged).toEqual([...SELF_METERING].sort());
  });

  it("omits the key entirely on every other type, the way `category` is omitted", () => {
    // Absence and `false` mean the same thing to a reader, and absence
    // is what keeps `docs/nodes.json` and `pcg nodes --json` byte-
    // identical for every type that does not self-meter — only the three
    // below gain a key.
    const carrying = listNodeTypes().filter((t) => "selfMetered" in t);
    expect(carrying.map((t) => t.type).sort()).toEqual([...SELF_METERING].sort());
    expect(carrying.every((t) => t.selfMetered === true)).toBe(true);
  });

  it("a consumer can answer the question from the catalog alone, without cooking", () => {
    // The whole point: no lookup table on the consumer's side.
    const byType = new Map(listNodeTypes().map((t) => [t.type, t.selfMetered === true]));
    expect(byType.get("repeatUntil")).toBe(true);
    expect(byType.get("forEach")).toBe(true);
    expect(byType.get("subgraph")).toBe(true);
    expect(byType.get("pointGrid")).toBe(false);
    expect(byType.get("setAttribute")).toBe(false);
    expect(byType.get("spawnInstances")).toBe(false);
  });
});

describe("selfMetered: the def and the catalog entry cannot drift", () => {
  it("every wrapper factory builds a def that declares what its entry publishes", () => {
    // These are two DIFFERENT defs. The registry entry is metadata-only
    // and cannot cook; the def that cooks is built per instance by the
    // factory and never reaches the registry. Nothing but this test makes
    // the two say the same thing.
    for (const [type, def] of Object.entries(wrapperDefs())) {
      expect(def.type).toBe(type);
      expect(def.selfMetered).toBe(true);
      expect(getNodeType(type).info.selfMetered).toBe(def.selfMetered);
      expect(getNodeType(type).def.selfMetered).toBe(def.selfMetered);
    }
  });
});

describe("selfMetered: what a cook reports", () => {
  it("flags a subgraph node and not the leaf beside it", async () => {
    const inner = passthroughGraph();
    const def = subgraphNode(inner.g, [], [{ name: "res", node: inner.node, pin: "out" }]);
    const g = new Graph();
    const sub = g.add(def, undefined, "sub");
    const leaf = g.add(passthrough, undefined, "leaf");
    g.connect(sub, "res", leaf, "in");
    g.output(leaf, "out", "out");

    const seen: NodeDoneInfo[] = [];
    await cook(g, { budgetMs: 1, onNodeDone: (i) => seen.push(i) });
    expect(seen.map((i) => [i.id, i.selfMetered])).toEqual([
      ["sub", true],
      ["leaf", false],
    ]);
  });

  it("flags a forEach node, whose iterations really do yield on the budget", async () => {
    const inner = passthroughGraph();
    const def = forEachNode(
      inner.g,
      [{ name: "each", node: inner.node, pin: "in" }],
      [{ name: "res", node: inner.node, pin: "out" }],
    );
    const g = new Graph();
    const src = g.add(
      dataInput,
      { items: [makeValueItem(1), makeValueItem(2), makeValueItem(3)] },
      "src",
    );
    const fe = g.add(def, undefined, "fe");
    g.connect(src, "out", fe, "each");
    g.output(fe, "res", "out");

    const seen: NodeDoneInfo[] = [];
    // budgetMs 0 makes every iteration boundary a yield, which is exactly
    // the setting whose timings used to read as catastrophic.
    await cook(g, { budgetMs: 0, onNodeDone: (i) => seen.push(i) });
    const fromForEach = seen.find((i) => i.id === "fe")!;
    const fromSource = seen.find((i) => i.id === "src")!;
    expect(fromForEach.selfMetered).toBe(true);
    expect(fromSource.selfMetered).toBe(false);
  });
});
