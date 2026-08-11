/**
 * The phase-37 node wave, exercised the way the vocabulary will use it:
 * as one graph that cooks FROM JSON with no runtime injection at all.
 *
 * That last clause is the point. Before `meshPrimitive` existed, any
 * pipeline touching a surface had to receive it through `dataInput`,
 * whose items a serialized graph does not carry — so the pipeline could
 * be built in code and never loaded from a file. The round trip below is
 * therefore a capability test, not just a format test.
 */
import { describe, expect, it } from "vitest";
import { Graph, cook } from "../graph/index.js";
import {
  attributeReduce,
  attributeRemap,
  deserializeGraph,
  fieldFromJson,
  filterByExpression,
  meshPrimitive,
  pointNeighborhood,
  pointScatterInBounds,
  removeAttribute,
  sampleNearestPoint,
  serializeGraph,
  surfaceSample,
} from "./index.js";
import { firstGeo, snapshotGeometry } from "./nodes.testsupport.js";

/**
 * mesh -> surface scatter -> crowding -> normalized density -> keep the
 * uncrowded half -> distance to a second cloud -> drop the scratch column.
 * Every node type of the wave appears except attributeReduce, which is
 * measured separately below because its result lives on the detail domain.
 */
function buildWave(seed: number): Graph {
  const g = new Graph(seed);
  const surface = g.add(
    meshPrimitive,
    { size: [20, 0, 20], subdivisions: [4, 1, 4] },
    "surface",
  );
  const scatter = g.add(surfaceSample, { count: 300 }, "scatter");
  const nbr = g.add(pointNeighborhood, { radius: 2, countAttr: "nbrCount" }, "nbr");
  const norm = g.add(
    attributeRemap,
    { name: "nbrCount", outName: "crowding", mode: "fit" },
    "norm",
  );
  const keep = g.add(
    filterByExpression,
    {
      predicate: fieldFromJson({
        fn: "lt",
        args: [{ fn: "attribute", name: "crowding", tupleSize: 1 }, 0.5],
      }),
    },
    "keep",
  );
  const landmarks = g.add(
    pointScatterInBounds,
    { count: 5, boundsMin: [-10, 0, -10], boundsMax: [10, 0, 10], seed: 3 },
    "landmarks",
  );
  const near = g.add(sampleNearestPoint, { distanceAttr: "nearDist" }, "near");
  const clean = g.add(removeAttribute, { names: ["crowding", "nbrCount"] }, "clean");
  g.connect(surface, "out", scatter, "in");
  g.connect(scatter, "out", nbr, "in");
  g.connect(nbr, "out", norm, "in");
  g.connect(norm, "out", keep, "in");
  g.connect(keep, "out", near, "in");
  g.connect(landmarks, "out", near, "source");
  g.connect(near, "out", clean, "in");
  g.output(clean, "out", "world");
  return g;
}

describe("the phase-37 node wave as one graph", () => {
  it("cooks a plausible result with the scratch columns gone", async () => {
    const world = firstGeo((await cook(buildWave(2026))).outputs.world);
    expect(world.pointCount).toBeGreaterThan(20);
    expect(world.pointCount).toBeLessThan(300);
    expect(world.attrs.point.has("nearDist")).toBe(true);
    // The debris removeAttribute exists to clear.
    expect(world.attrs.point.has("crowding")).toBe(false);
    expect(world.attrs.point.has("nbrCount")).toBe(false);
    // Every survivor sat on the plane and found a landmark.
    const P = world.attrs.point.require("P");
    const dist = world.attrs.point.require("nearDist");
    for (let i = 0; i < world.pointCount; i++) {
      expect(P.get(i, 1)).toBe(0);
      expect(Number.isFinite(dist.get(i))).toBe(true);
    }
  });

  it("is deterministic across fresh graphs and across a re-cook", async () => {
    const a = await cook(buildWave(11));
    const b = await cook(buildWave(11));
    expect(snapshotGeometry(firstGeo(b.outputs.world))).toEqual(
      snapshotGeometry(firstGeo(a.outputs.world)),
    );
    const g = buildWave(11);
    const first = await cook(g);
    const again = await cook(g);
    expect(again.stats.cooked).toBe(0);
    expect(snapshotGeometry(firstGeo(again.outputs.world))).toEqual(
      snapshotGeometry(firstGeo(first.outputs.world)),
    );
  });

  it("round-trips through JSON and cooks byte-identically — no dataInput anywhere", async () => {
    const json = serializeGraph(buildWave(7));
    // The whole graph is authoring data: nothing here waits for a live
    // item to be bound after loading.
    expect(JSON.stringify(json)).not.toContain("dataInput");
    const reloaded = deserializeGraph(JSON.parse(JSON.stringify(json)) as typeof json);
    expect(serializeGraph(reloaded)).toEqual(json);
    const fromJson = firstGeo((await cook(reloaded)).outputs.world);
    const fromCode = firstGeo((await cook(buildWave(7))).outputs.world);
    expect(snapshotGeometry(fromJson)).toEqual(snapshotGeometry(fromCode));
    expect(fromJson.pointCount).toBeGreaterThan(0);
  });

  it("every new type survives a JSON round trip at its registered defaults", async () => {
    // The defaults are what an agent gets by naming a type and nothing
    // else, so they have to be loadable — including attributeReduce, which
    // the pipeline above leaves out because its result lives on detail.
    const g = new Graph(4);
    const src = g.add(meshPrimitive, {}, "src");
    const a = g.add(pointNeighborhood, {}, "a");
    const b = g.add(sampleNearestPoint, {}, "b");
    const c = g.add(attributeReduce, {}, "c");
    const d = g.add(attributeRemap, {}, "d");
    const e = g.add(filterByExpression, {}, "e");
    const f = g.add(removeAttribute, {}, "f");
    g.connect(src, "out", a, "in");
    g.connect(a, "out", b, "in");
    g.connect(src, "out", b, "source");
    g.connect(b, "out", c, "in");
    g.connect(c, "out", d, "in");
    g.connect(d, "out", e, "in");
    g.connect(e, "out", f, "in");
    g.output(f, "out", "out");
    const json = serializeGraph(g);
    const again = serializeGraph(deserializeGraph(JSON.parse(JSON.stringify(json)) as typeof json));
    expect(again).toEqual(json);
    // Defaults are present in the payload, not silently dropped.
    const types = json.nodes.map((n) => n.type).sort();
    expect(types).toEqual([
      "attributeReduce",
      "attributeRemap",
      "filterByExpression",
      "meshPrimitive",
      "pointNeighborhood",
      "removeAttribute",
      "sampleNearestPoint",
    ]);
  });

  it("a different graph seed moves the result", async () => {
    const a = firstGeo((await cook(buildWave(1))).outputs.world);
    const b = firstGeo((await cook(buildWave(2))).outputs.world);
    expect(snapshotGeometry(a)).not.toEqual(snapshotGeometry(b));
  });
});
