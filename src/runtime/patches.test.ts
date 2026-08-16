import { describe, expect, it } from "vitest";
import type { Geometry } from "../data/index.js";
import { Graph, GraphValidationError, cook, subgraphNode, type NodeHandle } from "../graph/index.js";
import { fieldFromJson, type FieldSpec } from "../fields/fieldJson.js";
import { transformPoints, type TransformPointsParams } from "../nodes/pointOps.js";
import { pointScatterInBounds, type PointScatterInBoundsParams } from "../nodes/sources.js";
import { filterByBounds } from "../nodes/filtering.js";
import { resolveExposedParam } from "../nodes/subgraphParams.js";
import { dataInput } from "./dataInput.js";
import { applyParamPatches } from "./patches.js";
import { geometryDiff } from "./runtime.testsupport.js";
import type { ParamPatch } from "./types.js";

function scatterGraph(): { graph: Graph; scatter: NodeHandle<PointScatterInBoundsParams> } {
  const graph = new Graph(11);
  const scatter = graph.add(pointScatterInBounds, { count: 16 }, "scatter");
  graph.output(scatter, "out", "points");
  return { graph, scatter };
}

function warpGraph(): { graph: Graph; warp: NodeHandle<TransformPointsParams> } {
  const graph = new Graph(11);
  const scatter = graph.add(pointScatterInBounds, { count: 16 }, "scatter");
  const warp = graph.add(transformPoints, {}, "warp");
  graph.connect(scatter, "out", warp, "in");
  graph.output(warp, "out", "points");
  return { graph, warp };
}

async function pointsOf(graph: Graph): Promise<Geometry> {
  const result = await cook(graph);
  const item = result.outputs["points"][0];
  if (item.kind !== "geometry") throw new Error("expected geometry");
  return item.geo;
}

describe("applyParamPatches", () => {
  it("is byte-identical to the setParam calls it stands for", async () => {
    const a = scatterGraph();
    const b = scatterGraph();
    a.graph.setParam(a.scatter, "boundsMin", [5, 0, 5]);
    a.graph.setParam(a.scatter, "boundsMax", [15, 0, 15]);
    a.graph.setParam(a.scatter, "seed", 77);
    applyParamPatches(b.graph, [
      { node: "scatter", param: "boundsMin", value: [5, 0, 5] },
      { node: "scatter", param: "boundsMax", value: [15, 0, 15] },
      { node: "scatter", param: "seed", value: 77 },
    ]);
    expect(geometryDiff(await pointsOf(a.graph), await pointsOf(b.graph))).toBeNull();
  });

  it("bumps the graph version like the setParam calls it stands for", () => {
    const { graph } = scatterGraph();
    const before = graph.version;
    applyParamPatches(graph, [{ node: "scatter", param: "seed", value: 1 }]);
    expect(graph.version).toBe(before + 1);
  });

  it("interprets a plain object on a field-capable param as a FieldSpec", async () => {
    const spec: FieldSpec = {
      fn: "fbm",
      base: "perlinNoise",
      opts: { seed: 3, frequency: 0.2, octaves: 3 },
    };
    const a = warpGraph();
    a.graph.setParam(a.warp, "translate", fieldFromJson(spec));
    const b = warpGraph();
    applyParamPatches(b.graph, [{ node: "warp", param: "translate", value: spec }]);
    expect(geometryDiff(await pointsOf(a.graph), await pointsOf(b.graph))).toBeNull();
  });

  it("broadcasts a scalar onto a field-capable vec param, like serialization does", async () => {
    const a = warpGraph();
    applyParamPatches(a.graph, [{ node: "warp", param: "translate", value: [2, 2, 2] }]);
    const b = warpGraph();
    applyParamPatches(b.graph, [{ node: "warp", param: "translate", value: 2 }]);
    expect(geometryDiff(await pointsOf(a.graph), await pointsOf(b.graph))).toBeNull();
  });

  it("patches a subgraph node's exposed param through its derived schema", async () => {
    const mkWrapped = (): { graph: Graph; wrapped: NodeHandle<Record<string, unknown>> } => {
      const inner = new Graph(1);
      const scatter = inner.add(pointScatterInBounds, { count: 4 }, "inner-scatter");
      const def = subgraphNode(
        inner,
        [],
        [{ name: "out", node: scatter, pin: "out" }],
        [
          resolveExposedParam(inner, {
            name: "count",
            targets: [{ node: scatter, param: "count" }],
            description: "exposed scatter count",
          }),
        ],
      );
      const outer = new Graph(2);
      const wrapped = outer.add(def, {}, "wrapped");
      outer.output(wrapped, "out", "points");
      return { graph: outer, wrapped };
    };
    const a = mkWrapped();
    a.graph.setParam(a.wrapped, "count", 9);
    const b = mkWrapped();
    applyParamPatches(b.graph, [{ node: "wrapped", param: "count", value: 9 }]);
    expect(geometryDiff(await pointsOf(a.graph), await pointsOf(b.graph))).toBeNull();
  });

  it("names the node and lists this graph's ids for an unknown node", () => {
    const { graph } = scatterGraph();
    expect(() =>
      applyParamPatches(graph, [{ node: "nope", param: "seed", value: 1 }], "test patches"),
    ).toThrow(/test patches: unknown node "nope"; this graph has: scatter/);
  });

  it("names the param and lists the valid ones for an unknown param", () => {
    const { graph } = scatterGraph();
    expect(() =>
      applyParamPatches(graph, [{ node: "scatter", param: "nope", value: 1 }]),
    ).toThrow(/node "scatter" \(type "pointScatterInBounds"\) has no param "nope"; valid params:/);
  });

  it("refuses items params, naming the bind alternative", () => {
    const graph = new Graph(1);
    graph.add(dataInput, {}, "input");
    expect(() =>
      applyParamPatches(graph, [{ node: "input", param: "items", value: [] }]),
    ).toThrow(/live DataItems.*bind them in-place with LevelDef\.bind/);
  });

  it("rejects an invalid value with the schema's own message", () => {
    const { graph } = scatterGraph();
    const bad: ParamPatch = { node: "scatter", param: "boundsMin", value: "north" };
    expect(() => applyParamPatches(graph, [bad])).toThrow(GraphValidationError);
    expect(() => applyParamPatches(graph, [bad])).toThrow(/node "scatter" param "boundsMin"/);
  });

  it("applies patches in order and stops at the first invalid one", () => {
    const { graph, scatter } = scatterGraph();
    expect(() =>
      applyParamPatches(graph, [
        { node: "scatter", param: "seed", value: 123 },
        { node: "scatter", param: "nope", value: 1 },
      ]),
    ).toThrow(/no param "nope"/);
    // The valid patch before the failure did apply (documented in-order semantics).
    expect(graph.getParams(scatter).seed).toBe(123);
  });
});

/**
 * ±INFINITY ACROSS A PATCH, which this file refused until it was measured.
 *
 * The refusal reasoned that "a patch is JSON that must survive
 * `postMessage`". A patch is never stringified: `postMessage` uses
 * STRUCTURED CLONE, which carries ±Infinity exactly. The file rule was
 * being applied to a transport that does not need it, and the one thing it
 * cost is the canonical partition recipe — `filterByBounds` `halfOpen`
 * over an `xz` column, unbounded in Y, which is precisely what
 * `acceptsInfinite` exists for.
 */
describe("an unbounded axis", () => {
  it("survives the transport a patch actually rides", async () => {
    // The premise, measured rather than argued. JSON would give [0,null,0].
    const { MessageChannel } = await import("node:worker_threads");
    const { port1, port2 } = new MessageChannel();
    const round = await new Promise<{ value: number[] }>((resolve) => {
      port2.once("message", (m) => resolve(m as { value: number[] }));
      port1.postMessage({ value: [0, -Infinity, 0] });
    });
    port1.close();
    port2.close();
    expect(round.value[1]).toBe(-Infinity);
    expect(JSON.parse(JSON.stringify([0, -Infinity, 0]))[1]).toBeNull();
  });

  it("applies to a param that declares acceptsInfinite", () => {
    const graph = new Graph(1);
    const scatter = graph.add(pointScatterInBounds, { count: 8 }, "scatter");
    const clip = graph.add(filterByBounds, {}, "clip");
    graph.connect(scatter, "out", clip, "in");
    applyParamPatches(graph, [
      { node: "clip", param: "boundsMin", value: [0, -Infinity, 0] },
      { node: "clip", param: "boundsMax", value: [64, Infinity, 64] },
    ]);
    // The ownership clip a partitioned level actually wants: a window in
    // the plane, unbounded in the column.
    expect(graph.getParams(clip).boundsMin).toEqual([0, -Infinity, 0]);
    expect(graph.getParams(clip).boundsMax).toEqual([64, Infinity, 64]);
  });

  it("is still refused where the schema does not declare it", () => {
    // The live rule is not "anything goes": a param that never admits an
    // infinity still does not, and the message is the schema's own.
    const graph = new Graph(1);
    graph.add(pointScatterInBounds, { count: 8 }, "scatter");
    expect(() =>
      applyParamPatches(graph, [
        { node: "scatter", param: "boundsMin", value: [0, -Infinity, 0] },
      ]),
    ).toThrow(/finite/);
  });

  it("still refuses NaN, which no schema ever admits", () => {
    const graph = new Graph(1);
    const scatter = graph.add(pointScatterInBounds, { count: 8 }, "scatter");
    const clip = graph.add(filterByBounds, {}, "clip");
    graph.connect(scatter, "out", clip, "in");
    expect(() =>
      applyParamPatches(graph, [{ node: "clip", param: "boundsMin", value: [0, NaN, 0] }]),
    ).toThrow();
  });
});
