/**
 * `forEach`: the loop the graph did not have.
 *
 * The properties that matter, in the order they matter: it runs the body
 * once per element, it seeds each run on the element's CONTENT so a
 * reordered collection is still the same K answers, and it refuses the
 * shapes that would silently mean something else.
 */
import { describe, expect, it } from "vitest";
import { createPointCloud, type Geometry } from "../data/index.js";
import { GraphValidationError } from "../graph/errors.js";
import { cook } from "../graph/execute.js";
import { Graph } from "../graph/graph.js";
import {
  type DataCollection,
  type GeometryItem,
  makeGeometryItem,
  makeInstancesItem,
  makeValueItem,
} from "../graph/data.js";
import { subgraphNode } from "../graph/subgraph.js";
import { dataInput } from "../runtime/dataInput.js";
import { forEachNode } from "./forEach.js";
import { jitterPoints, mergePoints, transformPoints } from "./index.js";

function cloudAt(positions: number[][]): Geometry {
  const geo = createPointCloud(positions.length);
  const P = geo.attrs.point.require("P");
  positions.forEach((p, i) => P.setTuple(i, p));
  return geo;
}

/** K carrier items, each one point, each distinctly placed and tagged. */
function carriers(k: number): GeometryItem[] {
  return Array.from({ length: k }, (_, i) =>
    makeGeometryItem(cloudAt([[i, 0, 0]]), [`group=${i}`]),
  );
}

/** Every P row of a collection, in item order, as flat numbers. */
function rows(coll: DataCollection): number[][] {
  const out: number[][] = [];
  for (const item of coll) {
    if (item.kind !== "geometry") continue;
    const P = item.geo.attrs.point.require("P");
    for (let i = 0; i < item.geo.pointCount; i++) {
      out.push([P.get(i, 0), P.get(i, 1), P.get(i, 2)]);
    }
  }
  return out;
}

/** A body that jitters whatever it is handed — randomness, so seeds show. */
function jitterBody(): { inner: Graph; def: ReturnType<typeof forEachNode> } {
  const inner = new Graph();
  const j = inner.add(jitterPoints, { amount: [1, 1, 1] }, "j");
  const def = forEachNode(inner, [{ name: "each", node: j, pin: "in" }], [
    { name: "out", node: j, pin: "out" },
  ]);
  return { inner, def };
}

/** Cook `items` through a forEach def, in the given order. */
async function runOver(
  def: ReturnType<typeof forEachNode>,
  items: readonly GeometryItem[],
  pin: "each" | "eachPoint" = "each",
): Promise<DataCollection> {
  const g = new Graph(7);
  const src = g.add(dataInput, { items: [...items] }, "src");
  const fe = g.add(def, undefined, "fe");
  g.connect(src, "out", fe, pin);
  g.output(fe, "out", "out");
  return (await cook(g)).outputs.out;
}

describe("forEachNode — the loop", () => {
  it("cooks the body once per item and concatenates in input order", async () => {
    const inner = new Graph();
    const t = inner.add(transformPoints, { translate: [10, 0, 0] }, "t");
    const def = forEachNode(inner, [{ name: "each", node: t, pin: "in" }], [
      { name: "out", node: t, pin: "out" },
    ]);
    const out = await runOver(def, carriers(4));
    expect(out).toHaveLength(4);
    expect(rows(out)).toEqual([
      [10, 0, 0],
      [11, 0, 0],
      [12, 0, 0],
      [13, 0, 0],
    ]);
  });

  it("gives each iteration its own randomness", async () => {
    const { def } = jitterBody();
    const out = await runOver(def, carriers(4));
    // Four one-point clouds jittered off four distinct carriers. If every
    // iteration shared a seed the offsets would be identical, and the four
    // points would sit at exactly 0,1,2,3 apart on x.
    const offsets = rows(out).map((r, i) => [r[0] - i, r[1], r[2]]);
    const distinct = new Set(offsets.map((o) => o.join(",")));
    expect(distinct.size).toBe(4);
  });

  it("emits nothing for an empty collection rather than cooking once", async () => {
    const inner = new Graph();
    const t = inner.add(transformPoints, { translate: [1, 0, 0] }, "t");
    const def = forEachNode(inner, [{ name: "each", node: t, pin: "in" }], [
      { name: "out", node: t, pin: "out" },
    ]);
    expect(await runOver(def, [])).toEqual([]);
  });

  it("broadcasts every pin that is not the iterated one", async () => {
    // `each` gets one carrier per iteration; `all` gets the whole thing
    // every time. mergePoints takes both on its multi pin, so the point
    // count is the proof of what each iteration actually saw.
    const inner = new Graph();
    const m = inner.add(mergePoints, {}, "m");
    const def = forEachNode(
      inner,
      [
        { name: "each", node: m, pin: "in" },
        { name: "all", node: m, pin: "in" },
      ],
      [{ name: "out", node: m, pin: "out" }],
    );
    const g = new Graph(7);
    const src = g.add(dataInput, { items: carriers(3) }, "src");
    const fe = g.add(def, undefined, "fe");
    g.connect(src, "out", fe, "each");
    g.connect(src, "out", fe, "all");
    g.output(fe, "out", "out");
    // Three iterations, each seeing its own carrier plus all three on the
    // broadcast pin: four points per iteration, twelve in all.
    expect(rows((await cook(g)).outputs.out)).toHaveLength(12);
  });

  it("propagates the iterated item's tags onto what the iteration emits", async () => {
    const inner = new Graph();
    const t = inner.add(transformPoints, { translate: [1, 0, 0] }, "t");
    const def = forEachNode(inner, [{ name: "each", node: t, pin: "in" }], [
      { name: "out", node: t, pin: "out" },
    ]);
    const out = await runOver(def, carriers(3));
    expect(out.map((i) => [...i.tags])).toEqual([["group=0"], ["group=1"], ["group=2"]]);
  });
});

describe("forEachNode — construction", () => {
  it("refuses a wrapper with no iterated pin, naming the two reserved names", () => {
    const inner = new Graph();
    const t = inner.add(transformPoints, {}, "t");
    expect(() =>
      forEachNode(inner, [{ name: "geo", node: t, pin: "in" }], [
        { name: "out", node: t, pin: "out" },
      ]),
    ).toThrow(/exactly one exposed input must be named "each".*"eachPoint"/is);
  });

  it("refuses two iterated pins", () => {
    const inner = new Graph();
    const t = inner.add(transformPoints, {}, "t");
    expect(() =>
      forEachNode(
        inner,
        [
          { name: "each", node: t, pin: "in" },
          { name: "eachPoint", node: t, pin: "in" },
        ],
        [{ name: "out", node: t, pin: "out" }],
      ),
    ).toThrow(/a loop runs over one thing/);
  });

  it("declares the iterated pin single-valued, whatever the inner pin accepts", () => {
    const inner = new Graph();
    const t = inner.add(transformPoints, {}, "t");
    const def = forEachNode(inner, [{ name: "each", node: t, pin: "in" }], [
      { name: "out", node: t, pin: "out" },
    ]);
    expect(def.inputs.find((p) => p.name === "each")?.multi).toBeUndefined();
  });
});

describe("forEachNode — what it refuses at cook time", () => {
  it("refuses an instances item, because there is nothing in one to iterate", async () => {
    const { def } = jitterBody();
    const g = new Graph(7);
    const src = g.add(
      dataInput,
      { items: [makeInstancesItem([{ assetId: "a", count: 1, transforms: new Float32Array(16) }])] },
      "src",
    );
    const fe = g.add(def, undefined, "fe");
    g.connect(src, "out", fe, "each");
    g.output(fe, "out", "out");
    await expect(cook(g)).rejects.toThrow(/terminal render payload/);
  });

  it("refuses two items that are the same item", async () => {
    const { def } = jitterBody();
    const twin = () => makeGeometryItem(cloudAt([[1, 2, 3]]), ["g=1"]);
    await expect(runOver(def, [twin(), twin()])).rejects.toThrow(
      /are the same item — identical content and identical tags/,
    );
  });

  it("names the iteration when the body fails", async () => {
    const inner = new Graph();
    // jitterPoints needs P; a value item reaching the body cannot supply it.
    const j = inner.add(jitterPoints, { amount: [1, 1, 1] }, "j");
    const def = forEachNode(inner, [{ name: "each", node: j, pin: "in" }], [
      { name: "out", node: j, pin: "out" },
    ]);
    const g = new Graph(7);
    const src = g.add(
      dataInput,
      { items: [makeGeometryItem(cloudAt([[0, 0, 0]]), ["a"]), makeValueItem(1, ["b"])] },
      "src",
    );
    const fe = g.add(def, undefined, "fe");
    g.connect(src, "out", fe, "each");
    g.output(fe, "out", "out");
    await expect(cook(g)).rejects.toThrow(/iteration 1 \(key [0-9a-f]{8}, b\)/);
  });
});

describe("forEachNode — eachPoint", () => {
  it("cooks the body once per point, each seeing a one-point cloud", async () => {
    const inner = new Graph();
    const t = inner.add(transformPoints, { translate: [0, 5, 0] }, "t");
    const def = forEachNode(inner, [{ name: "eachPoint", node: t, pin: "in" }], [
      { name: "out", node: t, pin: "out" },
    ]);
    const cloud = makeGeometryItem(
      cloudAt([
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ]),
    );
    const out = await runOver(def, [cloud], "eachPoint");
    expect(out).toHaveLength(3);
    expect(rows(out)).toEqual([
      [0, 5, 0],
      [1, 5, 0],
      [2, 5, 0],
    ]);
  });

  it("gives each point its own randomness", async () => {
    const inner = new Graph();
    const j = inner.add(jitterPoints, { amount: [1, 1, 1] }, "j");
    const def = forEachNode(inner, [{ name: "eachPoint", node: j, pin: "in" }], [
      { name: "out", node: j, pin: "out" },
    ]);
    const cloud = makeGeometryItem(
      cloudAt([
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [3, 0, 0],
      ]),
    );
    const offsets = rows(await runOver(def, [cloud], "eachPoint")).map((r, i) => [r[0] - i, r[1], r[2]].join(","));
    expect(new Set(offsets).size).toBe(4);
  });

  it("refuses more than one geometry, and says which pin name iterates items", async () => {
    const inner = new Graph();
    const t = inner.add(transformPoints, {}, "t");
    const def = forEachNode(inner, [{ name: "eachPoint", node: t, pin: "in" }], [
      { name: "out", node: t, pin: "out" },
    ]);
    await expect(runOver(def, carriers(2), "eachPoint")).rejects.toThrow(/iterates the points of ONE geometry/);
  });

  it("refuses a non-geometry item", async () => {
    const inner = new Graph();
    const t = inner.add(transformPoints, {}, "t");
    const def = forEachNode(inner, [{ name: "eachPoint", node: t, pin: "in" }], [
      { name: "out", node: t, pin: "out" },
    ]);
    const g = new Graph(7);
    const src = g.add(dataInput, { items: [makeValueItem(1)] }, "src");
    const fe = g.add(def, undefined, "fe");
    g.connect(src, "out", fe, "eachPoint");
    g.output(fe, "out", "out");
    await expect(cook(g)).rejects.toThrow(/carries a value item/);
  });
});

describe("forEachNode — nesting", () => {
  it("is refused as a node of the graph it wraps", () => {
    // The wrap-cycle guard reads the recorded spec, so a wrapper missing
    // from that map is one whose self-nesting is not caught at `add` and
    // hangs at cook time instead. This is the test that it is recorded.
    const inner = new Graph();
    const t = inner.add(transformPoints, { translate: [1, 0, 0] }, "t");
    const def = forEachNode(inner, [{ name: "each", node: t, pin: "in" }], [
      { name: "out", node: t, pin: "out" },
    ]);
    expect(() => inner.add(def, undefined, "self")).toThrow(GraphValidationError);
  });

  it("runs inside a subgraph", async () => {
    const body = new Graph();
    const bt = body.add(transformPoints, { translate: [0, 0, 1] }, "bt");
    const feDef = forEachNode(body, [{ name: "each", node: bt, pin: "in" }], [
      { name: "out", node: bt, pin: "out" },
    ]);
    const mid = new Graph();
    const fe = mid.add(feDef, undefined, "fe");
    const subDef = subgraphNode(mid, [{ name: "in", node: fe, pin: "each" }], [
      { name: "out", node: fe, pin: "out" },
    ]);
    const g = new Graph(7);
    const src = g.add(dataInput, { items: carriers(3) }, "src");
    const s = g.add(subDef, undefined, "s");
    g.connect(src, "out", s, "in");
    g.output(s, "out", "out");
    expect(rows((await cook(g)).outputs.out)).toEqual([
      [0, 0, 1],
      [1, 0, 1],
      [2, 0, 1],
    ]);
  });

  it("runs inside a forEach", async () => {
    // Inner loop: one iteration per POINT of whatever the outer hands it.
    const innerBody = new Graph();
    const it2 = innerBody.add(transformPoints, { translate: [0, 0, 1] }, "t");
    const innerDef = forEachNode(innerBody, [{ name: "eachPoint", node: it2, pin: "in" }], [
      { name: "out", node: it2, pin: "out" },
    ]);
    const outerBody = new Graph();
    const nested = outerBody.add(innerDef, undefined, "nested");
    const outerDef = forEachNode(outerBody, [{ name: "each", node: nested, pin: "eachPoint" }], [
      { name: "out", node: nested, pin: "out" },
    ]);
    // Three carriers of one point each: three outer iterations, one inner
    // iteration apiece.
    expect(rows(await runOver(outerDef, carriers(3)))).toEqual([
      [0, 0, 1],
      [1, 0, 1],
      [2, 0, 1],
    ]);
  });
});

describe("forEachNode — memoization", () => {
  it("caches at the outer level on an unchanged recook", async () => {
    const inner = new Graph();
    const t = inner.add(transformPoints, { translate: [1, 0, 0] }, "t");
    const def = forEachNode(inner, [{ name: "each", node: t, pin: "in" }], [
      { name: "out", node: t, pin: "out" },
    ]);
    const g = new Graph(7);
    const src = g.add(dataInput, { items: carriers(3) }, "src");
    const fe = g.add(def, undefined, "fe");
    g.connect(src, "out", fe, "each");
    g.output(fe, "out", "out");
    await cook(g);
    const second = await cook(g);
    expect(second.stats.cooked).toBe(0);
    expect(second.stats.cached).toBe(2);
  });

  it("leaves the inner graph exactly as it found it", async () => {
    // The shared inner graph is what serializeGraph reads, so a cook that
    // left its own plumbing behind would make the saved bytes depend on
    // cook history.
    const inner = new Graph(99);
    const t = inner.add(transformPoints, { translate: [1, 0, 0] }, "t");
    const def = forEachNode(inner, [{ name: "each", node: t, pin: "in" }], [
      { name: "out", node: t, pin: "out" },
    ]);
    const version = inner.version;
    await runOver(def, carriers(3));
    expect(inner.require("t").params.translate).toEqual([1, 0, 0]);
    expect(inner.version).toBe(version);
  });
});
