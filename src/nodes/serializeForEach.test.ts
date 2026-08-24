/**
 * `forEach` through the serialized format.
 *
 * The first test here is the one that matters. Both wrappers record a spec
 * and the writer dispatches on the spec's PRESENCE, so a writer that names
 * the type as a literal emits a forEach as a plain `subgraph` — which
 * round-trips, validates, and cooks ONE pass over the concatenated
 * collection instead of one pass per item. Nothing else in the suite would
 * have caught it: the JSON is well-formed, the graph loads, the cook
 * succeeds, and the answer is wrong.
 */
import { describe, expect, it } from "vitest";
import { createPointCloud, type Geometry } from "../data/index.js";
import { makeGeometryItem, type DataCollection, type GeometryItem } from "../graph/data.js";
import { cook } from "../graph/execute.js";
import { Graph, type NodeHandle } from "../graph/graph.js";
import { getSubgraphSpec } from "../graph/subgraph.js";
import { dataInput } from "../runtime/dataInput.js";
import { forEachNode } from "./forEach.js";
import { transformPoints } from "./index.js";
import { deserializeGraph, serializeGraph } from "./serialize.js";
import { resolveExposedParam } from "./subgraphParams.js";

function cloudAt(positions: number[][]): Geometry {
  const geo = createPointCloud(positions.length);
  const P = geo.attrs.point.require("P");
  positions.forEach((p, i) => P.setTuple(i, p));
  return geo;
}

function carriers(k: number): GeometryItem[] {
  return Array.from({ length: k }, (_, i) =>
    makeGeometryItem(cloudAt([[i, 0, 0]]), [`group=${i}`]),
  );
}

/**
 * Re-bind the carriers a deserialized graph cannot carry: `dataInput`
 * items are runtime-injected and never survive serialization, so the
 * reloaded graph is handed the same K items by hand. A NodeHandle is just
 * an id, so one can be named directly.
 */
function feedCarriers(g: Graph, k: number): void {
  g.setParam({ id: "src" } as NodeHandle<{ items: DataCollection }>, "items", carriers(k));
}

/** A graph whose forEach shifts every carrier up by one unit. */
function graphWithForEach(pin: "each" | "eachPoint" = "each"): Graph {
  const inner = new Graph(4);
  const t = inner.add(transformPoints, { translate: [0, 1, 0] }, "t");
  const def = forEachNode(inner, [{ name: pin, node: t, pin: "in" }], [
    { name: "out", node: t, pin: "out" },
  ]);
  const g = new Graph(7);
  const src = g.add(dataInput, { items: carriers(3) }, "src");
  const fe = g.add(def, undefined, "fe");
  g.connect(src, "out", fe, pin);
  g.output(fe, "out", "out");
  return g;
}

describe("forEach serialization", () => {
  it("does NOT save as a subgraph node", () => {
    const json = serializeGraph(graphWithForEach());
    const fe = json.nodes.find((n) => n.id === "fe");
    expect(fe?.type).toBe("forEach");
    // Stated as its own assertion because this is the regression: a
    // forEach written as "subgraph" loads as one and cooks once.
    expect(fe?.type).not.toBe("subgraph");
  });

  it("carries the same payload shape a subgraph does", () => {
    const json = serializeGraph(graphWithForEach());
    const fe = json.nodes.find((n) => n.id === "fe");
    expect(Object.keys(fe?.subgraph ?? {}).sort()).toEqual(["graph", "inputs", "outputs"]);
    // The loop is named by the pin, not by a field: nothing in the payload
    // says "forEach" except the node's own type.
    expect(fe?.subgraph?.inputs.map((p) => p.name)).toEqual(["each"]);
  });

  it("round-trips to the same cooked bytes", async () => {
    const original = graphWithForEach();
    const before = await cook(original);
    const reloaded = deserializeGraph(serializeGraph(original));
    // dataInput items never survive serialization, so the reloaded graph is
    // fed the same carriers by hand — the point under test is the wrapper,
    // not the binding.
    feedCarriers(reloaded, 3);
    const after = await cook(reloaded);
    expect(rowsOf(after)).toEqual(rowsOf(before));
    expect(rowsOf(after)).toHaveLength(3);
  });

  it("rebuilds as a forEach, not as a subgraph, and still loops", async () => {
    const reloaded = deserializeGraph(serializeGraph(graphWithForEach()));
    feedCarriers(reloaded, 3);
    const spec = getSubgraphSpec(reloaded.require("fe").def);
    expect(spec?.wrapper).toBe("forEach");
    // Three ITEMS out, not one: the loop survived the round trip. A forEach
    // rebuilt as a subgraph would emit a single item here.
    expect((await cook(reloaded)).outputs.out).toHaveLength(3);
  });

  it("round-trips the eachPoint mode by its pin name alone", () => {
    const json = serializeGraph(graphWithForEach("eachPoint"));
    expect(json.nodes.find((n) => n.id === "fe")?.subgraph?.inputs.map((p) => p.name)).toEqual([
      "eachPoint",
    ]);
    const back = serializeGraph(deserializeGraph(json));
    expect(back).toEqual(json);
  });

  it("re-serializes byte-identically", () => {
    const json = serializeGraph(graphWithForEach());
    expect(serializeGraph(deserializeGraph(json))).toEqual(json);
  });

  it("carries exposed params like any wrapper", async () => {
    const inner = new Graph(4);
    const t = inner.add(transformPoints, { translate: [0, 1, 0] }, "t");
    const exposed = resolveExposedParam(inner, {
      name: "lift",
      targets: [{ node: { id: "t" }, param: "translate" }],
      description: "how far each iteration lifts its element",
    });
    const def = forEachNode(
      inner,
      [{ name: "each", node: t, pin: "in" }],
      [{ name: "out", node: t, pin: "out" }],
      [exposed],
    );
    const g = new Graph(7);
    const src = g.add(dataInput, { items: carriers(2) }, "src");
    const fe = g.add(def, { lift: [0, 5, 0] }, "fe");
    g.connect(src, "out", fe, "each");
    g.output(fe, "out", "out");

    const json = serializeGraph(g);
    const node = json.nodes.find((n) => n.id === "fe");
    expect(node?.type).toBe("forEach");
    expect(node?.params).toEqual({ lift: [0, 5, 0] });
    expect(node?.subgraph?.params?.map((p) => p.name)).toEqual(["lift"]);

    const reloaded = deserializeGraph(json);
    feedCarriers(reloaded, 2);
    expect(rowsOf(await cook(reloaded))).toEqual([
      [0, 5, 0],
      [1, 5, 0],
    ]);
  });

  it("refuses a payload whose exposed inputs name no iterated pin", () => {
    const json = serializeGraph(graphWithForEach());
    const broken = structuredClone(json) as unknown as {
      nodes: { id: string; subgraph?: { inputs: { name: string }[] } }[];
    };
    const fe = broken.nodes.find((n) => n.id === "fe");
    fe!.subgraph!.inputs[0].name = "geo";
    expect(() => deserializeGraph(broken)).toThrow(/exactly one exposed input must be named "each"/i);
  });

  it("refuses the wrapper keys on a type that wraps nothing", () => {
    const json = serializeGraph(graphWithForEach());
    const broken = structuredClone(json) as unknown as { nodes: Record<string, unknown>[] };
    const src = broken.nodes.find((n) => n.id === "src")!;
    src.ref = { name: "whatever" };
    expect(() => deserializeGraph(broken)).toThrow(
      /"dataInput" wraps no inner graph.*only "subgraph", "forEach" and "repeatUntil"/s,
    );
  });

  it("refuses a forEach def that was not built by forEachNode", () => {
    // A hand-rolled def claiming the type would otherwise fall through to
    // the standard-node path and fail with something about the registry.
    const g = new Graph(7);
    const bogus = {
      type: "forEach",
      inputs: [],
      outputs: [{ name: "out", kind: "geometry" as const }],
      defaultParams: {},
      execute: () => ({ out: [] }),
    };
    g.add(bogus as never, undefined, "fake");
    expect(() => serializeGraph(g)).toThrow(/was not created by forEachNode/);
  });
});

/** Every P row of a cook's `out`, in item order. */
function rowsOf(result: Awaited<ReturnType<typeof cook>>): number[][] {
  const out: number[][] = [];
  for (const item of result.outputs.out ?? []) {
    if (item.kind !== "geometry") continue;
    const P = item.geo.attrs.point.require("P");
    for (let i = 0; i < item.geo.pointCount; i++) {
      out.push([P.get(i, 0), P.get(i, 1), P.get(i, 2)]);
    }
  }
  return out;
}
