/**
 * One inner graph can back several wrapper instances — the same def used
 * twice, or (once primitives are named) the same primitive referenced
 * from two different graphs. Those wrappers can be cooked concurrently,
 * and the inner graph is shared MUTABLE state: the wrapper writes its
 * seed and portal inputs into it and then awaits a cook of it.
 *
 * Serializing only the cook is not enough, because it leaves the writes
 * outside the guard. These tests pin the property that matters — a cook's
 * result never depends on what else was cooking at the time — against the
 * exact shapes that broke it: an inner chain long enough to yield
 * mid-cook, and a portal input carrying data.
 */
import { describe, expect, it } from "vitest";
import { Graph } from "./graph.js";
import { type CookResult, cook } from "./execute.js";
import { type DataCollection, makeValueItem } from "./data.js";
import { defineNode } from "./node.js";
import { subgraphNode } from "./subgraph.js";

/**
 * A node that yields before producing, so a concurrent cook has a real
 * chance to interleave here. It folds its own derived seed into the value
 * it passes on, which makes any foreign seed visible in the result.
 */
function foldingNode(type: string, withInput: boolean) {
  return defineNode<Record<string, never>>({
    type,
    inputs: withInput ? [{ name: "in", kind: "value" as const }] : [],
    outputs: [{ name: "out", kind: "value" as const }],
    defaultParams: {},
    async execute({ seed, inputs }) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const upstream = withInput ? readValue(inputs.in) : 0;
      return { out: [makeValueItem((upstream ^ seed) >>> 0)] };
    },
  });
}

/** First value item of a collection as a number (0 when there is none). */
function readValue(collection: DataCollection | undefined): number {
  const item = collection?.[0];
  return item?.kind === "value" ? Number(item.value) : 0;
}

/** An inner graph of `length` chained folding nodes, wrapped as one def. */
function chainDef(length: number) {
  const inner = new Graph(11);
  let previous = inner.add(foldingNode("chain_head", false));
  for (let i = 1; i < length; i++) {
    const next = inner.add(foldingNode(`chain_${i}`, true));
    inner.connect(previous, "out", next, "in");
    previous = next;
  }
  return subgraphNode(inner, [], [{ name: "out", node: previous, pin: "out" }]);
}

/** An outer graph whose single node is an instance of `def`. */
function outerGraph(def: ReturnType<typeof chainDef>, seed: number): Graph {
  const graph = new Graph(seed);
  const node = graph.add(def);
  graph.output(node, "out", "v");
  return graph;
}

const valueOf = (result: CookResult): number => readValue(result.outputs.v);

describe("concurrent cooks over one shared inner graph", () => {
  it("gives each outer graph the result it gets when cooked alone", async () => {
    // The reference: each graph cooked by itself, on its own def, so
    // nothing else can have touched the inner graph.
    const alone3 = valueOf(await cook(outerGraph(chainDef(3), 3)));
    const alone4 = valueOf(await cook(outerGraph(chainDef(3), 4)));
    expect(alone3).not.toBe(alone4);

    // The same two cooks, sharing one def, started together. Without an
    // exclusive section this returned a value belonging to NEITHER graph:
    // some inner nodes ran against the other outer graph's seed.
    const shared = chainDef(3);
    const [got3, got4] = (
      await Promise.all([cook(outerGraph(shared, 3)), cook(outerGraph(shared, 4))])
    ).map(valueOf);
    expect(got3).toBe(alone3);
    expect(got4).toBe(alone4);
  });

  it("holds for many wrappers of one def cooked at once", async () => {
    const shared = chainDef(4);
    const seeds = [1, 2, 3, 4, 5, 6];
    const alone: number[] = [];
    for (const seed of seeds) alone.push(valueOf(await cook(outerGraph(chainDef(4), seed))));
    // Distinct references, or the test could pass on a renderer that
    // returned the same answer to everyone.
    expect(new Set(alone).size).toBe(seeds.length);

    const together = (
      await Promise.all(seeds.map((seed) => cook(outerGraph(shared, seed))))
    ).map(valueOf);
    expect(together).toEqual(alone);
  });

  it("keeps portal inputs with the cook that supplied them", async () => {
    // The other half of the shared state: items written into the portal
    // nodes. A wrapper must never cook against another's inputs.
    const inner = new Graph(5);
    const portalSource = defineNode<Record<string, never>>({
      type: "concurrency_passthrough",
      inputs: [{ name: "in", kind: "value" as const }],
      outputs: [{ name: "out", kind: "value" as const }],
      defaultParams: {},
      async execute({ inputs }) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { out: [makeValueItem(readValue(inputs.in) * 10)] };
      },
    });
    const passthrough = inner.add(portalSource);
    const def = subgraphNode(
      inner,
      [{ name: "feed", node: passthrough, pin: "in" }],
      [{ name: "out", node: passthrough, pin: "out" }],
    );

    const constantNode = (value: number) =>
      defineNode<Record<string, never>>({
        type: `concurrency_const_${value}`,
        inputs: [],
        outputs: [{ name: "out", kind: "value" as const }],
        defaultParams: {},
        execute: () => ({ out: [makeValueItem(value)] }),
      });

    const build = (value: number): Graph => {
      const graph = new Graph(1);
      const source = graph.add(constantNode(value));
      const wrapper = graph.add(def);
      graph.connect(source, "out", wrapper, "feed");
      graph.output(wrapper, "out", "v");
      return graph;
    };

    const inputs = [1, 2, 3, 4];
    const together = (await Promise.all(inputs.map((v) => cook(build(v))))).map(valueOf);
    expect(together).toEqual(inputs.map((v) => v * 10));
  });

  it("still serializes plain overlapping cooks of one graph", async () => {
    // The pre-existing guarantee the section is layered on top of: two
    // cooks of the SAME graph do not interleave.
    const graph = new Graph(2);
    const node = graph.add(foldingNode("chain_head", false));
    graph.output(node, "out", "v");
    const [first, second] = (await Promise.all([cook(graph), cook(graph)])).map(valueOf);
    expect(first).toBe(second);
  });
});
