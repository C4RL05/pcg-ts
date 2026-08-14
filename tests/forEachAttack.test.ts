/**
 * `forEach` under attack: the claims the feature makes, tested by trying to
 * break them rather than by demonstrating them.
 *
 * Written as an adversarial pass over the two commits that shipped the node
 * and kept as a suite, because five of the things it went looking for were
 * there. Each one is now a regression test, and the shape of each is worth
 * keeping: the cases that BREAK a rule are the ones a demonstration suite
 * never writes.
 *
 *  - CANCELLATION had to be observed inside an inner cook, not at the loop
 *    top. Aborting between iterations always worked; aborting during one —
 *    where the time actually goes — was wrapped into a NodeExecutionError,
 *    so `World` and the worker protocol, which both key on the error's
 *    identity, saw a broken graph where the caller had simply stopped.
 *  - THE REGISTRY records a body and its exposed pins and NOT which wrapper
 *    cooks them, so a `subgraph` node pointed at a loop body was the one
 *    route left to a silent one-pass cook.
 *  - IDENTITY COLLISIONS are refused, and the refusal had to stop claiming
 *    the two items were identical — an identity reads positions, `seed` and
 *    tags, so colliding items can differ in a column the body reads.
 *  - THE INNER SEED was not restored, and for a forEach the residue depends
 *    on which collection cooked, so the shared graph's serialized bytes
 *    depended on cook history.
 *
 * Reorder-safety, budget metering, serialization round-trips and the
 * iteration ceiling survived the pass unchanged; the tests that establish
 * that are here too, because a claim nobody has tried to break is a claim
 * with no evidence behind it.
 */
import { describe, expect, it } from "vitest";
import {
  CookCancelledError,
  Graph,
  cook,
  createPointCloud,
  deserializeGraph,
  forEachNode,
  getSubgraphSpec,
  jitterPoints,
  makeGeometryItem,
  mergePoints,
  partitionByAttribute,
  registerSubgraph,
  serializeGraph,
  subgraphNode,
  transformPoints,
  type DataCollection,
  type Geometry,
  type GeometryItem,
  type NodeHandle,
} from "../src/index.js";
import { defineNode } from "../src/graph/node.js";
import { slowNode } from "../src/graph/testNodes.js";
import { dataInput } from "../src/runtime/index.js";
import { pointRows } from "./support/pointMultiset.js";

function cloudAt(positions: number[][]): Geometry {
  const geo = createPointCloud(positions.length);
  const P = geo.attrs.point.require("P");
  positions.forEach((p, i) => P.setTuple(i, p));
  return geo;
}

function groups(k: number): GeometryItem[] {
  return Array.from({ length: k }, (_, g) =>
    makeGeometryItem(
      cloudAt([
        [g * 10, 0, 0],
        [g * 10 + 1, 0, 0],
      ]),
      [`district=${g}`],
    ),
  );
}

function rows(coll: DataCollection): string[] {
  return coll.map((item) =>
    item.kind === "geometry"
      ? `[${[...item.tags].sort().join("|")}] ${pointRows(item.geo).join(" ; ")}`
      : item.kind,
  );
}

function feed(g: Graph, items: DataCollection): void {
  g.setParam({ id: "src" } as NodeHandle<{ items: DataCollection }>, "items", items);
}

/** A graph: dataInput("src") -> forEach("fe") -> output "out". */
function loopGraph(def: ReturnType<typeof forEachNode>, items: DataCollection, pin = "each"): Graph {
  const g = new Graph(11);
  const src = g.add(dataInput, { items: [...items] }, "src");
  const fe = g.add(def, undefined, "fe");
  g.connect(src, "out", fe, pin);
  g.output(fe, "out", "out");
  return g;
}

/** forEach body = jitterPoints. */
function jitterLoop(pin: "each" | "eachPoint" = "each"): ReturnType<typeof forEachNode> {
  const inner = new Graph(4);
  const j = inner.add(jitterPoints, { amount: [1, 1, 1] }, "j");
  return forEachNode(inner, [{ name: pin, node: j, pin: "in" }], [
    { name: "out", node: j, pin: "out" },
  ]);
}

// ---------------------------------------------------------------------------
// 1. CANCELLATION
// ---------------------------------------------------------------------------

describe("forEach: cancellation", () => {
  it("ATTACK: aborting while an inner cook runs rejects with CookCancelledError", async () => {
    const inner = new Graph(4);
    const s = inner.add(slowNode(120), undefined, "slow");
    const def = forEachNode(inner, [{ name: "each", node: s, pin: "in" }], [
      { name: "out", node: s, pin: "out" },
    ]);
    const g = loopGraph(def, groups(4));
    const ac = new AbortController();
    const pending = cook(g, { signal: ac.signal });
    setTimeout(() => ac.abort(), 30);
    // The same assertion src/graph/subgraph.test.ts makes for the other
    // wrapper ("propagates cancellation out of the inner cook").
    await expect(pending).rejects.toBeInstanceOf(CookCancelledError);
  });

  it("control: the subgraph wrapper does propagate CookCancelledError", async () => {
    const inner = new Graph(4);
    const s = inner.add(slowNode(120), undefined, "slow");
    const def = subgraphNode(inner, [{ name: "in", node: s, pin: "in" }], [
      { name: "out", node: s, pin: "out" },
    ]);
    const g = new Graph(11);
    const src = g.add(dataInput, { items: groups(4) }, "src");
    const sg = g.add(def, undefined, "sg");
    g.connect(src, "out", sg, "in");
    g.output(sg, "out", "res");
    const ac = new AbortController();
    const pending = cook(g, { signal: ac.signal });
    setTimeout(() => ac.abort(), 30);
    await expect(pending).rejects.toBeInstanceOf(CookCancelledError);
  });

  it("restores exposed params on the inner graph after a cancelled cook", async () => {
    const inner = new Graph(4);
    const s = inner.add(slowNode(120), undefined, "slow");
    const t = inner.add(transformPoints, { translate: [0, 1, 0] }, "t");
    inner.connect(s, "out", t, "in");
    const exposed = {
      name: "lift",
      targets: [{ node: { id: "t" }, param: "translate", acceptsField: true }],
      schema: {
        type: "vec3" as const,
        default: [0, 1, 0],
        description: "lift",
        acceptsField: true,
      },
    };
    const def = forEachNode(
      inner,
      [{ name: "each", node: s, pin: "in" }],
      [{ name: "out", node: t, pin: "out" }],
      [exposed],
    );
    const g = loopGraph(def, groups(4));
    g.setParam({ id: "fe" } as NodeHandle<Record<string, unknown>>, "lift", [9, 9, 9]);
    const ac = new AbortController();
    const pending = cook(g, { signal: ac.signal });
    setTimeout(() => ac.abort(), 30);
    await pending.catch(() => undefined);
    expect(inner.require("t").params.translate).toEqual([0, 1, 0]);
  });
});

// ---------------------------------------------------------------------------
// 2. BUDGET
// ---------------------------------------------------------------------------

describe("forEach: budget metering across iterations", () => {
  it("ATTACK: reaches the event loop between iterations that each fit the slice", async () => {
    let timerFired = false;
    const sawTimer: boolean[] = [];
    const busy = defineNode<Record<string, never>>({
      type: "busyForEach",
      inputs: [{ name: "in", kind: "any" }],
      outputs: [{ name: "out", kind: "any" }],
      defaultParams: {},
      execute({ inputs }) {
        sawTimer.push(timerFired);
        const end = performance.now() + 10;
        while (performance.now() < end) {
          // spin
        }
        return { out: inputs.in };
      },
    });
    const inner = new Graph(4);
    const b = inner.add(busy, undefined, "b");
    const def = forEachNode(inner, [{ name: "each", node: b, pin: "in" }], [
      { name: "out", node: b, pin: "out" },
    ]);
    const g = loopGraph(def, groups(6));
    setTimeout(() => {
      timerFired = true;
    }, 0);
    // 10 ms per iteration under a 16 ms slice: no INNER cook ever exceeds its
    // own budget, so any yield observed here came from forEach's own clock.
    await cook(g, { budgetMs: 16 });
    expect(sawTimer).toHaveLength(6);
    expect(sawTimer[0], "non-vacuity: the timer had not fired yet").toBe(false);
    expect(sawTimer, "the loop yielded at least once").toContain(true);
  });
});

// ---------------------------------------------------------------------------
// 3. REORDER SAFETY, beyond the two mechanisms the shipped suite covers
// ---------------------------------------------------------------------------

/** One cloud whose `dist` attribute makes K groups; `order` permutes its points. */
function districts(order: readonly number[]): Geometry {
  const n = order.length;
  const geo = createPointCloud(n);
  const P = geo.attrs.point.require("P");
  const dist = geo.attrs.point.add("dist", "i32", 1);
  order.forEach((src, i) => {
    P.setTuple(i, [src, src * 2, 0]);
    dist.data[i] = src % 4;
  });
  return geo;
}

describe("forEach: reorder safety", () => {
  it("ATTACK: a permuted SOURCE CLOUD reorders partitionByAttribute's groups without re-rolling them", async () => {
    const build = async (order: readonly number[]): Promise<string[]> => {
      const def = jitterLoop();
      const g = new Graph(11);
      const src = g.add(dataInput, { items: [makeGeometryItem(districts(order))] }, "src");
      const part = g.add(partitionByAttribute, { name: "dist" }, "part");
      const fe = g.add(def, undefined, "fe");
      g.connect(src, "out", part, "in");
      g.connect(part, "out", fe, "each");
      g.output(fe, "out", "out");
      const out = (await cook(g)).outputs.out;
      // Compared as a MULTISET of point rows: permuting the source moves
      // groups AND points within them, so only the set of cooked points is
      // comparable — and it must be identical, point for point.
      return out
        .flatMap((item) => (item.kind === "geometry" ? pointRows(item.geo) : []))
        .sort();
    };
    const straight = [...Array(12).keys()];
    const shuffled = [3, 7, 0, 11, 5, 1, 9, 2, 8, 4, 10, 6];
    expect(await build(shuffled)).toEqual(await build(straight));
  });

  it("ATTACK: re-feeding the SAME node a permuted collection does not serve the stale order", async () => {
    // The shipped equivariance suite builds a fresh Graph per order, so it
    // never asks whether the node's memo key notices a permutation.
    const items = groups(5);
    const g = loopGraph(jitterLoop(), items);
    const before = rows((await cook(g)).outputs.out);
    const order = [3, 1, 4, 0, 2];
    feed(g, order.map((i) => items[i]));
    const after = rows((await cook(g)).outputs.out);
    expect(after).toEqual(order.map((i) => before[i]));
  });

  it("ATTACK: a nested subgraph in the body gets the per-iteration seed", async () => {
    const innermost = new Graph(2);
    const j = innermost.add(jitterPoints, { amount: [1, 1, 1] }, "j");
    const sub = subgraphNode(innermost, [{ name: "in", node: j, pin: "in" }], [
      { name: "out", node: j, pin: "out" },
    ]);
    const inner = new Graph(4);
    const s = inner.add(sub, undefined, "s");
    const def = forEachNode(inner, [{ name: "each", node: s, pin: "in" }], [
      { name: "out", node: s, pin: "out" },
    ]);
    const items = groups(4);
    const g = loopGraph(def, items);
    const before = rows((await cook(g)).outputs.out);
    // Every block distinct: the seed rotation reached through the nested
    // wrapper rather than being swallowed by its persistent inner caches.
    expect(new Set(before).size).toBe(4);
    const order = [2, 0, 3, 1];
    const g2 = loopGraph(def, order.map((i) => items[i]));
    expect(rows((await cook(g2)).outputs.out)).toEqual(order.map((i) => before[i]));
  });
});

// ---------------------------------------------------------------------------
// 4. ITEM IDENTITY: the documented collisions, and what forEach does with them
// ---------------------------------------------------------------------------

describe("forEach: item identity", () => {
  it("refuses two items that share an identity but differ in another attribute", async () => {
    // An identity reads positions, `seed` and tags and nothing else, so two
    // clouds at the same places carrying different `val` columns collide —
    // one source cloud through two setAttribute branches, assembled onto one
    // pin, is the plainest way to build it. Refused rather than run with
    // correlated seeds, and the message must NOT claim they are identical:
    // they differ in a column the body can read.
    const build = (v: number): GeometryItem => {
      const geo = cloudAt([
        [0, 0, 0],
        [1, 0, 0],
      ]);
      geo.attrs.point.add("val", "f32", 1).fill(v);
      return makeGeometryItem(geo);
    };
    const g = loopGraph(jitterLoop(), [build(1), build(2)]);
    const err = (await cook(g).catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/have the same IDENTITY/);
    expect(err.message).toMatch(/any other attribute they carry is not part of it/);
    // The three things that decide an identity, so the fix is one edit.
    expect(err.message).toMatch(/positions, their "seed" attribute and their tags/);
  });

  it("refuses eachPoint over coincident points, and names the seed attribute", async () => {
    // `snapToGrid` manufactures coincident points deliberately. The ITEM key
    // survives them (the fold counts duplicates); the per-POINT key cannot,
    // because two points at one place with one seed ARE one point. Refused,
    // and the message has to name `seed` — that is the column such a cloud
    // is missing, and writing it is the whole fix.
    const geo = cloudAt([
      [0, 0, 0],
      [0, 0, 0],
      [1, 0, 0],
    ]);
    const g = loopGraph(jitterLoop("eachPoint"), [makeGeometryItem(geo)], "eachPoint");
    const err = (await cook(g).catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/have the same IDENTITY/);
    expect(err.message).toMatch(/Two points share an identity/);
    expect(err.message).toMatch(/a hand-built or snapped cloud may not/);
  });

  it("refuses two genuinely identical items — the case the rule exists for", async () => {
    // K identical carriers would emit the same block K times: the silent
    // wrong answer the refusal is there to catch.
    const one = makeGeometryItem(cloudAt([[0, 0, 0]]));
    const two = makeGeometryItem(cloudAt([[0, 0, 0]]));
    const g = loopGraph(jitterLoop(), [one, two]);
    await expect(cook(g)).rejects.toThrow(/have the same IDENTITY/);
  });

  it("accepts the same two items once they are told apart by a tag", async () => {
    // The escape hatch the message names, exercised — a refusal with no way
    // out is a wall, not a diagnostic.
    const one = makeGeometryItem(cloudAt([[0, 0, 0]]), ["g=a"]);
    const two = makeGeometryItem(cloudAt([[0, 0, 0]]), ["g=b"]);
    const g = loopGraph(jitterLoop(), [one, two]);
    const out = rows((await cook(g)).outputs.out);
    expect(out).toHaveLength(2);
    // And the two now draw different randomness, which is the point of
    // telling them apart in the first place.
    expect(out[0]).not.toEqual(out[1]);
  });
});

// ---------------------------------------------------------------------------
// 5. THE ITERATION CEILING
// ---------------------------------------------------------------------------

describe("forEach: the 4096-iteration ceiling", () => {
  it("is enforced on the each path", async () => {
    const items = Array.from({ length: 4097 }, (_, i) => makeGeometryItem(cloudAt([[i, 0, 0]])));
    const g = loopGraph(jitterLoop(), items);
    await expect(cook(g)).rejects.toThrow(/4097 items on "each" exceeds the 4096-iteration ceiling/);
  });

  it("is enforced on the eachPoint path", async () => {
    const geo = cloudAt(Array.from({ length: 4097 }, (_, i) => [i, 0, 0]));
    const g = loopGraph(jitterLoop("eachPoint"), [makeGeometryItem(geo)], "eachPoint");
    await expect(cook(g)).rejects.toThrow(
      /4097 points of the geometry on "eachPoint" exceeds the 4096-iteration ceiling/,
    );
  });
});

// ---------------------------------------------------------------------------
// 6. SERIALIZATION FIDELITY
// ---------------------------------------------------------------------------

/** A forEach whose body contains a subgraph node. */
function forEachOverSubgraph(): Graph {
  const innermost = new Graph(2);
  const t = innermost.add(transformPoints, { translate: [0, 0, 1] }, "t");
  const sub = subgraphNode(innermost, [{ name: "in", node: t, pin: "in" }], [
    { name: "out", node: t, pin: "out" },
  ]);
  const inner = new Graph(4);
  const s = inner.add(sub, undefined, "s");
  const def = forEachNode(inner, [{ name: "each", node: s, pin: "in" }], [
    { name: "out", node: s, pin: "out" },
  ]);
  return loopGraph(def, groups(3));
}

/** A forEach whose body contains another forEach. */
function forEachInForEach(): Graph {
  const innermost = new Graph(2);
  const t = innermost.add(transformPoints, { translate: [0, 0, 1] }, "t");
  const nested = forEachNode(innermost, [{ name: "eachPoint", node: t, pin: "in" }], [
    { name: "out", node: t, pin: "out" },
  ]);
  const inner = new Graph(4);
  const n = inner.add(nested, undefined, "n");
  const def = forEachNode(inner, [{ name: "each", node: n, pin: "eachPoint" }], [
    { name: "out", node: n, pin: "out" },
  ]);
  return loopGraph(def, groups(3));
}

describe("forEach: serialization fidelity", () => {
  it("round-trips a forEach whose body holds a subgraph", async () => {
    const g = forEachOverSubgraph();
    const json = serializeGraph(g);
    expect(json.nodes.find((n) => n.id === "fe")?.type).toBe("forEach");
    expect(json.nodes.find((n) => n.id === "fe")?.subgraph?.graph.nodes[0].type).toBe("subgraph");
    const back = deserializeGraph(json);
    feed(back, groups(3));
    expect(serializeGraph(back)).toEqual(json);
    expect(rows((await cook(back)).outputs.out)).toEqual(rows((await cook(g)).outputs.out));
  });

  it("round-trips a forEach nested inside a forEach", async () => {
    const g = forEachInForEach();
    const json = serializeGraph(g);
    const outer = json.nodes.find((n) => n.id === "fe");
    expect(outer?.type).toBe("forEach");
    expect(outer?.subgraph?.graph.nodes[0].type).toBe("forEach");
    const back = deserializeGraph(json);
    feed(back, groups(3));
    expect(serializeGraph(back)).toEqual(json);
    expect(getSubgraphSpec(back.require("fe").def)?.wrapper).toBe("forEach");
    expect(rows((await cook(back)).outputs.out)).toEqual(rows((await cook(g)).outputs.out));
  });

  it("refuses a payload carrying BOTH each and eachPoint", () => {
    const json = JSON.parse(JSON.stringify(serializeGraph(forEachOverSubgraph())));
    json.nodes.find((n: { id: string }) => n.id === "fe").subgraph.inputs.push({
      name: "eachPoint",
      node: "s",
      pin: "in",
    });
    expect(() => deserializeGraph(json)).toThrow(/iterated inputs/);
  });

  it("refuses a payload whose iterated pin names a vanished inner node", () => {
    const json = JSON.parse(JSON.stringify(serializeGraph(forEachOverSubgraph())));
    json.nodes.find((n: { id: string }) => n.id === "fe").subgraph.inputs[0].node = "gone";
    expect(() => deserializeGraph(json)).toThrow(/unknown inner node/);
  });

  it("a ref to a registered recipe keeps the forEach kind", async () => {
    const recipe = new Graph(3);
    const t = recipe.add(transformPoints, { translate: [0, 5, 0] }, "t");
    const entry = registerSubgraph("attack/lift", {
      graph: recipe,
      inputs: [{ name: "each", node: t, pin: "in" }],
      outputs: [{ name: "out", node: t, pin: "out" }],
    });
    const g = deserializeGraph({
      formatVersion: 1,
      seed: 7,
      nodes: [
        { id: "src", type: "dataInput", params: { items: [] } },
        { id: "fe", type: "forEach", params: {}, ref: { name: "attack/lift", hash: entry.hash } },
      ],
      connections: [{ from: ["src", "out"], to: ["fe", "each"] }],
      outputs: [{ id: "fe", pin: "out", name: "out" }],
    });
    expect(getSubgraphSpec(g.require("fe").def)?.wrapper).toBe("forEach");
    feed(g, groups(3));
    expect((await cook(g)).outputs.out).toHaveLength(3);
    const back = serializeGraph(g);
    expect(back.nodes.find((n) => n.id === "fe")?.type).toBe("forEach");
    expect(back.nodes.find((n) => n.id === "fe")?.ref).toEqual({
      name: "attack/lift",
      hash: entry.hash,
    });
  });

  it("refuses a subgraph node pointed at a recipe written to be looped over", async () => {
    const recipe = new Graph(3);
    const m = recipe.add(mergePoints, undefined, "m");
    registerSubgraph("attack/merge", {
      graph: recipe,
      inputs: [{ name: "each", node: m, pin: "in" }],
      outputs: [{ name: "out", node: m, pin: "out" }],
    });
    const load = (type: string): Graph =>
      deserializeGraph({
        formatVersion: 1,
        seed: 7,
        nodes: [
          { id: "src", type: "dataInput", params: { items: [] } },
          { id: "fe", type, params: {}, ref: { name: "attack/merge" } },
        ],
        connections: [{ from: ["src", "out"], to: ["fe", "each"] }],
        outputs: [{ id: "fe", pin: "out", name: "out" }],
      });
    // Registering the loop body works: a recipe is wrapper-agnostic, and
    // refusing it here would make a forEach body unregisterable.
    const asLoop = load("forEach");
    feed(asLoop, groups(3));
    expect((await cook(asLoop)).outputs.out).toHaveLength(3);
    // The SAME reference asked for as a "subgraph" is the one way left to
    // reach a silent one-pass cook through well-formed JSON: a recipe
    // records no wrapper kind, so only the node's `type` carries it. Refused
    // at the reference, naming the fix and clearing the recipe of blame.
    expect(() => load("subgraph")).toThrow(/cannot expose "each"/);
    expect(() => load("subgraph")).toThrow(/Change this node's "type" to "forEach"/);
    expect(() => load("subgraph")).toThrow(/the recipe "attack\/merge" itself is fine/);
  });
});

// ---------------------------------------------------------------------------
// 7. THE INNER GRAPH IS LEFT AS FOUND
// ---------------------------------------------------------------------------

describe("forEach: leaves no plumbing behind", () => {
  it("serializes the OUTER graph identically before and after a cook", async () => {
    const g = forEachOverSubgraph();
    const before = serializeGraph(g);
    await cook(g);
    expect(serializeGraph(g)).toEqual(before);
    await cook(g);
    expect(serializeGraph(g)).toEqual(before);
  });

  it("ATTACK: serializes the INNER graph identically before and after a cook", async () => {
    const def = jitterLoop();
    const g = loopGraph(def, groups(3));
    const inner = getSubgraphSpec(def)!.graph;
    const before = serializeGraph(inner);
    await cook(g);
    expect(serializeGraph(inner)).toEqual(before);
  });

  it("ATTACK: the leftover inner seed does not depend on WHICH collection cooked", async () => {
    const def = jitterLoop();
    const inner = getSubgraphSpec(def)!.graph;
    await cook(loopGraph(def, groups(3)));
    const afterA = inner.seed;
    await cook(loopGraph(def, groups(3).reverse()));
    expect(inner.seed).toBe(afterA);
  });

  it("control: the subgraph wrapper's leftover seed is at least collection-independent", async () => {
    const innerG = new Graph(4);
    const j = innerG.add(jitterPoints, { amount: [1, 1, 1] }, "j");
    const def = subgraphNode(innerG, [{ name: "in", node: j, pin: "in" }], [
      { name: "out", node: j, pin: "out" },
    ]);
    const build = (items: DataCollection): Graph => {
      const g = new Graph(11);
      const src = g.add(dataInput, { items: [...items] }, "src");
      const sg = g.add(def, undefined, "sg");
      g.connect(src, "out", sg, "in");
      g.output(sg, "out", "res");
      return g;
    };
    await cook(build([groups(1)[0]]));
    const a = innerG.seed;
    await cook(build([makeGeometryItem(cloudAt([[7, 7, 7]]))]));
    expect(innerG.seed).toBe(a);
  });
});
