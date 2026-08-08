/**
 * The temporary-output mechanism `inspect` and `render` stand on: pointing
 * the CLI at an interior node declares an output, cooks exactly that
 * induced subgraph, and undeclares it again. The graph the caller handed
 * in has to come back the way it went in — on success, on a cook that
 * throws, and on a cook that was cancelled. Nothing else in the suite
 * holds that down, and a CLI that permanently mutates the caller's graph
 * would pass every other test in this directory.
 */
import { describe, expect, it } from "vitest";
import {
  CookCancelledError,
  type DataCollection,
  Graph,
  type NodeDef,
  createPointCloud,
  defineNode,
  makeGeometryItem,
} from "../index.js";
import { cookTarget, resolvePin } from "./graphSource.js";

/** A source with TWO output pins, each carrying a distinguishable cloud. */
function twoPinNode(): NodeDef<Record<string, never>> {
  return defineNode<Record<string, never>>({
    type: "twoPin",
    inputs: [],
    outputs: [
      { name: "a", kind: "geometry" },
      { name: "b", kind: "geometry" },
    ],
    defaultParams: {},
    execute() {
      const make = (count: number): DataCollection => [makeGeometryItem(createPointCloud(count))];
      return { a: make(3), b: make(7) };
    },
  });
}

function throwingNode(): NodeDef<Record<string, never>> {
  return defineNode<Record<string, never>>({
    type: "boom",
    inputs: [],
    outputs: [{ name: "out", kind: "geometry" }],
    defaultParams: {},
    execute() {
      throw new Error("boom: deliberate failure");
    },
  });
}

function cancellingNode(controller: AbortController): NodeDef<Record<string, never>> {
  return defineNode<Record<string, never>>({
    type: "cancel",
    inputs: [],
    outputs: [{ name: "out", kind: "geometry" }],
    defaultParams: {},
    execute({ checkCancelled }) {
      controller.abort();
      checkCancelled();
      return { out: [] };
    },
  });
}

/** Everything about the graph the CLI promises not to disturb. */
function snapshot(graph: Graph): unknown {
  const described = graph.describe();
  return {
    outputs: described.outputs.map((o) => ({ name: o.name, id: o.id, pin: o.pin })),
    nodes: described.nodes.map((n) => ({ id: n.id, seed: n.seed })),
    seed: graph.seed,
  };
}

describe("cookTarget", () => {
  it("leaves the declared outputs exactly as it found them, on success", async () => {
    const graph = new Graph(11);
    graph.add(twoPinNode(), {}, "src");
    graph.output({ id: "src" }, "a", "kept");
    const before = snapshot(graph);

    const target = await cookTarget(graph, { node: "src", pin: "b" });
    expect(target.collection).toHaveLength(1);
    expect(snapshot(graph)).toEqual(before);
    expect(graph.describe().outputs.map((o) => o.name)).toEqual(["kept"]);
  });

  it("removes the temporary output when the cook throws", async () => {
    const graph = new Graph(11);
    graph.add(throwingNode(), {}, "bad");
    graph.output({ id: "bad" }, "out", "kept");
    const before = snapshot(graph);

    await expect(cookTarget(graph, { node: "bad" })).rejects.toThrow(
      'node "bad" failed: boom: deliberate failure',
    );
    expect(snapshot(graph)).toEqual(before);
  });

  it("removes the temporary output when the cook is cancelled", async () => {
    const controller = new AbortController();
    const graph = new Graph(11);
    graph.add(cancellingNode(controller), {}, "stop");
    graph.output({ id: "stop" }, "out", "kept");
    const before = snapshot(graph);

    await expect(
      cookTarget(graph, { node: "stop" }, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(CookCancelledError);
    expect(snapshot(graph)).toEqual(before);
  });

  it("preserves the order of the outputs it declared around", async () => {
    const graph = new Graph(3);
    graph.add(twoPinNode(), {}, "src");
    graph.output({ id: "src" }, "a", "first");
    graph.output({ id: "src" }, "b", "second");
    await cookTarget(graph, { node: "src", pin: "a" });
    expect(graph.describe().outputs.map((o) => o.name)).toEqual(["first", "second"]);
  });

  it("defaults to the first output pin and honours --pin for the rest", async () => {
    const graph = new Graph(5);
    graph.add(twoPinNode(), {}, "src");

    expect(resolvePin(graph, "src")).toBe("a");
    expect(resolvePin(graph, "src", "b")).toBe("b");

    const first = await cookTarget(graph, { node: "src" });
    const second = await cookTarget(graph, { node: "src", pin: "b" });
    expect(first.label).toBe('node "src" pin "a"');
    expect(second.label).toBe('node "src" pin "b"');
    const points = (collection: DataCollection): number =>
      collection[0].kind === "geometry" ? collection[0].geo.pointCount : -1;
    // Different pins, different data: a resolver that ignored --pin would
    // hand back the same three points twice.
    expect(points(first.collection)).toBe(3);
    expect(points(second.collection)).toBe(7);
  });

  it("names the pins on a miss, and the nodes when the node itself is unknown", () => {
    const graph = new Graph(0);
    graph.add(twoPinNode(), {}, "src");
    expect(() => resolvePin(graph, "src", "c")).toThrow(
      'node "src" has no output pin "c"; its output pins: a, b',
    );
    expect(() => resolvePin(graph, "nope")).toThrow(
      'unknown node "nope"; nodes in this graph: src',
    );
  });

  it("steps around a graph that already declares the temporary name", async () => {
    const graph = new Graph(9);
    graph.add(twoPinNode(), {}, "src");
    graph.output({ id: "src" }, "a", "__pcg_cli");
    graph.output({ id: "src" }, "b", "__pcg_cli_1");
    const before = snapshot(graph);

    const target = await cookTarget(graph, { node: "src", pin: "b" });
    expect(target.collection).toHaveLength(1);
    // Both pre-existing outputs survive, in order: the temporary one took
    // __pcg_cli_2 and was removed again.
    expect(graph.describe().outputs.map((o) => o.name)).toEqual(["__pcg_cli", "__pcg_cli_1"]);
    expect(snapshot(graph)).toEqual(before);
  });

  it("reads a declared output, and every declared output at once", async () => {
    const graph = new Graph(1);
    graph.add(twoPinNode(), {}, "src");
    graph.output({ id: "src" }, "a", "first");
    graph.output({ id: "src" }, "b", "second");

    const one = await cookTarget(graph, { output: "second" });
    expect(one.label).toBe('output "second"');
    expect(one.collection).toHaveLength(1);

    const all = await cookTarget(graph, {});
    expect(all.label).toBe("all declared outputs");
    expect(all.collection).toHaveLength(2);
  });
});
