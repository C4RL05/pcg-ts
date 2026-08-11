import { describe, expect, it } from "vitest";
import { createPointCloud, type Geometry } from "../data/index.js";
import { component, ge, position } from "../fields/index.js";
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
  type InstanceBatch,
} from "../graph/index.js";
import { fieldFromJson, filterByExpression, setAttribute } from "../nodes/index.js";
import { getNodeType } from "../nodes/registry.js";
import { snapshotGeometry } from "../nodes/nodes.testsupport.js";
import { spawnInstances, type SpawnInstancesParams } from "./spawnNode.js";

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
    expect(info.params.colorAttr.type).toBe("string");
    expect(info.params.colorAttr.default).toBe("");
    // The one behaviour an author cannot discover from the data: alpha
    // never reaches the renderer. It has to be in the description.
    expect(info.params.colorAttr.description).toMatch(/alpha is dropped/i);
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

describe("spawnInstances colour", () => {
  /** Cloud whose point `i` sits at x = i with red = i / 10. */
  function paintedCloud(n: number): Geometry {
    const geo = createPointCloud(n);
    const P = geo.attrs.point.require("P");
    const color = geo.attrs.point.require("color");
    for (let i = 0; i < n; i++) {
      P.setTuple(i, [i, 0, 0]);
      color.setTuple(i, [i / 10, 0.25, 0.5, 0.75]);
    }
    return geo;
  }

  async function spawnWith(
    geo: Geometry,
    params: Partial<SpawnInstancesParams>,
  ): Promise<readonly InstanceBatch[]> {
    const graph = new Graph(7);
    const src = graph.add(sourceOf(makeGeometryItem(geo)));
    const spawn = graph.add(spawnInstances, params);
    graph.connect(src, "out", spawn, "in");
    graph.output(spawn, "instances", "instances");
    const item = (await cook(graph)).outputs.instances[0];
    if (item.kind !== "instances") throw new Error("expected an instances item");
    return item.batches;
  }

  it("carries rgb per instance when colorAttr names an attribute", async () => {
    const batches = await spawnWith(paintedCloud(3), { assetId: "a", colorAttr: "color" });
    const colors = batches[0].colors;
    if (!colors) throw new Error("expected colours on the batch");
    expect(Array.from(colors).map((v) => Math.round(v * 100) / 100)).toEqual([
      0, 0.25, 0.5, 0.1, 0.25, 0.5, 0.2, 0.25, 0.5,
    ]);
  });

  it("carries none by default, even though every cloud has a color attribute", async () => {
    const batches = await spawnWith(paintedCloud(3), { assetId: "a" });
    expect(batches[0].colors).toBeUndefined();
  });

  it("survives a filter that renumbers the points: each colour keeps its own point", async () => {
    // Drop every point with x < 2, so the surviving instances are points
    // 2..5 of the input under fresh indices 0..3.
    const graph = new Graph(7);
    const src = graph.add(sourceOf(makeGeometryItem(paintedCloud(6))));
    const cut = graph.add(filterByExpression, {
      predicate: ge(component(position(), 0), 2),
    });
    const spawn = graph.add(spawnInstances, { assetId: "a", colorAttr: "color" });
    graph.connect(src, "out", cut, "in");
    graph.connect(cut, "out", spawn, "in");
    graph.output(spawn, "instances", "instances");
    const item = (await cook(graph)).outputs.instances[0];
    if (item.kind !== "instances") throw new Error("expected an instances item");
    const batch = item.batches[0];
    expect(batch.count).toBe(4);
    const colors = batch.colors;
    if (!colors) throw new Error("expected colours on the batch");
    for (let k = 0; k < batch.count; k++) {
      // x still encodes the ORIGINAL point index; so must red.
      expect(colors[k * 3]).toBeCloseTo(batch.transforms[k * 16 + 12] / 10, 6);
    }
  });

  it("fuses on the device for every param combination — no eligibility gate at all", () => {
    // The interim gate that declined a COLOURED spawn ("instance-color")
    // is gone: the compose kernel gathers colour beside the matrix, so
    // there is no combination left where fusing would render the graph
    // differently. A gate reappearing here is a shipped restriction, and
    // the reason string would show up in `CookStats.gpu.fallbacks`.
    const resident = getNodeType("spawnInstances").def.resident;
    expect(resident?.terminal).toBe(true);
    expect(resident?.eligible).toBeUndefined();
  });

  it("a bad colorAttr fails the cook with a message naming the param", async () => {
    await expect(spawnWith(paintedCloud(1), { assetId: "a", colorAttr: "seed" })).rejects.toThrow(
      /colorAttr "seed"/,
    );
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
