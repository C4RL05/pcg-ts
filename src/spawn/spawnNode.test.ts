import { describe, expect, it } from "vitest";
import { createPointCloud, type Geometry } from "../data/index.js";
import {
  Graph,
  cook,
  defineNode,
  filterByTag,
  makeGeometryItem,
  makeInstancesItem,
  makeValueItem,
  type DataItem,
  type GeometryItem,
} from "../graph/index.js";
import { fieldFromJson, setAttribute } from "../nodes/index.js";
import { getNodeType } from "../nodes/registry.js";
import { snapshotGeometry } from "../nodes/testSupport.js";
import { spawnInstances } from "./spawnNode.js";

/** Source emitting one fixed geometry item (stable rev across cooks). */
function sourceOf(item: GeometryItem) {
  return defineNode<Record<string, never>>({
    type: "testSource",
    inputs: [],
    outputs: [{ name: "out", kind: "geometry" }],
    defaultParams: {},
    execute: () => ({ out: [item] }),
  });
}

function testCloud(n = 3): Geometry {
  const geo = createPointCloud(n);
  const P = geo.attrs.point.require("P");
  for (let i = 0; i < n; i++) P.setTuple(i, [i, 2 * i, 3 * i]);
  return geo;
}

describe("spawnInstances registry metadata", () => {
  it("registers with instances/points output pins and string params", () => {
    const info = getNodeType("spawnInstances").info;
    expect(info.inputs).toEqual([{ name: "in", kind: "geometry", multi: false }]);
    expect(info.outputs).toEqual([
      { name: "instances", kind: "instances", multi: false },
      { name: "points", kind: "geometry", multi: false },
    ]);
    expect(info.params.assetId.type).toBe("string");
    expect(info.params.assetAttr.type).toBe("string");
    expect(info.params.assetAttr.default).toBe("");
  });
});

describe("spawnInstances cook", () => {
  function buildGraph(item: GeometryItem, assetId = "tree") {
    const graph = new Graph(7);
    const src = graph.add(sourceOf(item));
    const spawn = graph.add(spawnInstances, { assetId });
    graph.connect(src, "out", spawn, "in");
    graph.output(spawn, "instances", "instances");
    graph.output(spawn, "points", "points");
    return { graph, src, spawn };
  }

  it("emits one instances item and passes the input points through by rev", async () => {
    const item = makeGeometryItem(testCloud(), ["veg"]);
    const { graph } = buildGraph(item);
    const result = await cook(graph);
    const out = result.outputs.instances;
    expect(out).toHaveLength(1);
    const inst = out[0];
    if (inst.kind !== "instances") throw new Error("expected an instances item");
    expect(inst.batches).toHaveLength(1);
    expect(inst.batches[0].assetId).toBe("tree");
    expect(inst.batches[0].count).toBe(3);
    // Instance 1 carries point 1's translation (1, 2, 3).
    expect(Array.from(inst.batches[0].transforms.subarray(28, 31))).toEqual([1, 2, 3]);
    // Tags carry over from the input geometry item.
    expect(inst.tags.has("veg")).toBe(true);
    // Pass-through keeps the exact input item (same rev).
    expect(result.outputs.points[0]).toBe(item);
  });

  it("is memoized by input rev: a re-cook serves the cache and keeps the item", async () => {
    const { graph } = buildGraph(makeGeometryItem(testCloud()));
    const first = await cook(graph);
    expect(first.stats.cooked).toBe(2);
    const second = await cook(graph);
    expect(second.stats.cooked).toBe(0);
    expect(second.stats.cached).toBe(2);
    expect(second.outputs.instances[0]).toBe(first.outputs.instances[0]);
  });

  it("recooks on a param change and emits a fresh rev", async () => {
    const { graph, spawn } = buildGraph(makeGeometryItem(testCloud()));
    const first = await cook(graph);
    graph.setParam(spawn, "assetId", "rock");
    const second = await cook(graph);
    const item = second.outputs.instances[0];
    if (item.kind !== "instances") throw new Error("expected an instances item");
    expect(item.batches[0].assetId).toBe("rock");
    expect(item.rev).toBeGreaterThan(first.outputs.instances[0].rev);
  });

  it("does not mutate the input geometry (purity)", async () => {
    const geo = testCloud();
    const before = snapshotGeometry(geo);
    const { graph } = buildGraph(makeGeometryItem(geo));
    await cook(graph);
    expect(snapshotGeometry(geo)).toEqual(before);
  });

  it("throws an actionable error without a connected geometry", async () => {
    const graph = new Graph();
    const spawn = graph.add(spawnInstances);
    graph.output(spawn, "instances");
    await expect(cook(graph)).rejects.toThrow(/no geometry connected/);
  });
});

describe("multi-asset spawn from a graph-written string attribute", () => {
  it("points -> setAttribute(string) -> spawnInstances batches keyed per point, no escape hatch", async () => {
    const graph = new Graph(7);
    const src = graph.add(sourceOf(makeGeometryItem(testCloud(4))));
    // Per-point species from the element index: 0 -> pine, 1+ -> bush
    // (indices past the list clamp to the last entry).
    const species = graph.add(setAttribute, {
      name: "species",
      type: "string",
      values: ["pine", "bush"],
      value: fieldFromJson({ fn: "index" }),
    });
    const spawn = graph.add(spawnInstances, { assetId: "fallback", assetAttr: "species" });
    graph.connect(src, "out", species, "in");
    graph.connect(species, "out", spawn, "in");
    graph.output(spawn, "instances", "instances");
    const result = await cook(graph);
    const item = result.outputs.instances[0];
    if (item.kind !== "instances") throw new Error("expected an instances item");
    // One batch per asset id, first-occurrence order; every point matched
    // its string value, so the fallback assetId never appears.
    expect(item.batches.map((b) => b.assetId)).toEqual(["pine", "bush"]);
    expect(item.batches.map((b) => b.count)).toEqual([1, 3]);
    // Instances carry the right points: bush batch starts at point 1
    // (translation 1, 2, 3 in the transform's last column).
    expect(Array.from(item.batches[1].transforms.subarray(12, 15))).toEqual([1, 2, 3]);
  });

  it("empty per-point values fall back to assetId (numeric-path contract intact)", async () => {
    const graph = new Graph(7);
    const src = graph.add(sourceOf(makeGeometryItem(testCloud(3))));
    // "" for index 0, "bush" for the rest: the empty string defers to assetId.
    const species = graph.add(setAttribute, {
      name: "species",
      type: "string",
      values: ["", "bush"],
      value: fieldFromJson({ fn: "index" }),
    });
    const spawn = graph.add(spawnInstances, { assetId: "pine", assetAttr: "species" });
    graph.connect(src, "out", species, "in");
    graph.connect(species, "out", spawn, "in");
    graph.output(spawn, "instances", "instances");
    const result = await cook(graph);
    const item = result.outputs.instances[0];
    if (item.kind !== "instances") throw new Error("expected an instances item");
    expect(item.batches.map((b) => b.assetId)).toEqual(["pine", "bush"]);
    expect(item.batches.map((b) => b.count)).toEqual([1, 2]);
  });
});

describe("instances pin kind", () => {
  const instancesSink = defineNode<Record<string, never>>({
    type: "instancesSink",
    inputs: [{ name: "in", kind: "instances" }],
    outputs: [{ name: "n", kind: "value" }],
    defaultParams: {},
    execute: ({ inputs }) => {
      let batches = 0;
      for (const item of inputs.in) {
        if (item.kind === "instances") batches += item.batches.length;
      }
      return { n: [makeValueItem(batches)] };
    },
  });
  const geometrySink = defineNode<Record<string, never>>({
    type: "geometrySink",
    inputs: [{ name: "in", kind: "geometry" }],
    outputs: [],
    defaultParams: {},
    execute: () => ({}),
  });

  it("instances outputs connect to instances and any pins, not geometry pins", async () => {
    const graph = new Graph();
    const src = graph.add(sourceOf(makeGeometryItem(testCloud())));
    const spawn = graph.add(spawnInstances);
    graph.connect(src, "out", spawn, "in");
    const sink = graph.add(instancesSink);
    graph.connect(spawn, "instances", sink, "in");
    const geoSink = graph.add(geometrySink);
    expect(() => graph.connect(spawn, "instances", geoSink, "in")).toThrow(
      /instances.*geometry/,
    );
    graph.output(sink, "n", "n");
    const result = await cook(graph);
    const n = result.outputs.n[0];
    expect(n.kind === "value" && n.value).toBe(1);
  });
});

describe("instances data items in the graph core", () => {
  it("filterByTag and tag plumbing work on instances items", () => {
    const tagged = makeInstancesItem([], ["a"]);
    const plain = makeInstancesItem([]);
    const other: DataItem = makeValueItem(1, ["a"]);
    expect(filterByTag([tagged, plain, other], "a")).toEqual([tagged, other]);
    expect(plain.tags.size).toBe(0);
    expect(plain.rev).toBeGreaterThan(tagged.rev);
  });

  it("params holding instances items hash by rev, not by content", async () => {
    const itemHolder = defineNode<{ items: readonly DataItem[] }>({
      type: "itemHolder",
      inputs: [],
      outputs: [{ name: "out", kind: "instances" }],
      defaultParams: { items: [] },
      execute: ({ params }) => ({ out: [...params.items] }),
    });
    const batch = { assetId: "a", count: 0, transforms: new Float32Array(0) };
    const graph = new Graph();
    const node = graph.add(itemHolder, { items: [makeInstancesItem([batch])] });
    graph.output(node, "out", "out");
    const first = await cook(graph);
    expect(first.stats.cooked).toBe(1);
    // Re-setting the same item (same rev) is a cache hit...
    graph.setParam(node, "items", [...graph.getParams(node).items]);
    expect((await cook(graph)).stats.cached).toBe(1);
    // ...while an identical-content item with a fresh rev forces a recook.
    graph.setParam(node, "items", [makeInstancesItem([batch])]);
    const third = await cook(graph);
    expect(third.stats.cooked).toBe(1);
  });
});
