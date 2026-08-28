/**
 * The halo guard: `LevelDef.halo` read against what the level's graph
 * actually asks for.
 *
 * The bug being guarded is silent by construction, so the last describe
 * block here does not assert on an error at all — it cooks the same
 * content three ways and shows the wrong answer arriving with nothing
 * thrown. That is the case the guard exists for, and a test that only
 * checked the message would not have shown it is a real one.
 */
import { describe, expect, it } from "vitest";
import { constant, randomField } from "../fields/index.js";
import { Graph, cook, subgraphNode, type NodeHandle } from "../graph/index.js";
import type { Geometry } from "../data/index.js";
import { transferAttribute } from "../nodes/attributes.js";
import { filterByBounds, selfPrune } from "../nodes/filtering.js";
import { pointNeighborhood, sampleNearestPoint } from "../nodes/neighborhood.js";
import { pointScatterInWorld, type PointScatterInWorldParams } from "../nodes/sources.js";
import { connectPoints } from "../nodes/topology.js";
import { occlusionCull } from "../nodes/visibility.js";
import { EXEMPLAR_LIMIT, neighborReach } from "./reach.js";
import type { CellOutputs, LevelDef } from "./types.js";
import { World, WorldValidationError } from "./world.js";

/** A cloud plus a neighbour count over it, with the radius under test. */
function counting(radius: unknown): {
  graph: Graph;
  scatter: NodeHandle<PointScatterInWorldParams>;
} {
  const graph = new Graph(1);
  const scatter = graph.add(pointScatterInWorld, { density: 0.3, cellSize: 4, latticeMode: "xz" });
  const count = graph.add(pointNeighborhood, { radius: radius as number, countAttr: "n" });
  graph.connect(scatter, "out", count, "in");
  graph.output(count, "out", "points");
  return { graph, scatter };
}

const countingGraph = (radius: unknown): Graph => counting(radius).graph;

/**
 * Wrap `graph` as a subgraph node exposing one output and one param named
 * "reach", wired to `param` on the node `nodeId`. Wrapping a graph whose
 * own reach node is itself a wrapper is how an exposure CHAINS.
 */
function exposeReach(
  graph: Graph,
  nodeId: string,
  param = "radius",
): ReturnType<typeof subgraphNode> {
  return subgraphNode(
    graph,
    [],
    [{ name: "out", node: { id: nodeId }, pin: "out" }],
    [
      {
        name: "reach",
        targets: [{ node: { id: nodeId }, param, acceptsField: true }],
        schema: {
          type: "f32",
          default: 1,
          min: 0,
          acceptsField: true,
          description: "Exposed neighbourhood radius.",
        },
      },
    ],
  );
}

describe("neighborReach", () => {
  it("reads a literal radius off the graph without cooking it", () => {
    const reach = neighborReach(countingGraph(4));
    expect(reach.width).toBe(4);
    expect(reach.sources).toEqual([
      { node: reach.sources[0].node, type: "pointNeighborhood", param: "radius", reach: 4 },
    ]);
    expect(reach.unbounded).toEqual([]);
    expect(reach.unpartitionable).toEqual([]);
  });

  it("takes the widest reach when several nodes query", () => {
    const graph = countingGraph(4);
    const edges = graph.add(connectPoints, { radius: 7 });
    graph.output(edges, "out", "edges");
    const reach = neighborReach(graph);
    expect(reach.width).toBe(7);
    expect(reach.sources.map((s) => `${s.type}:${s.reach}`).sort()).toEqual([
      "connectPoints:7",
      "pointNeighborhood:4",
    ]);
  });

  it("reports a Field radius as unreadable rather than guessing a number", () => {
    // A field's bound is the global maximum it can return ANYWHERE, which
    // is derived from the expression and cannot be measured from a cell
    // whose cloud the halo has already clipped. Reporting 0 here would be
    // the unsafe kind of wrong. It must be a field that READS something —
    // a `constant` is a graph literal and resolves to its number, which is
    // the distinction the next assertion pins.
    const reach = neighborReach(countingGraph(randomField()));
    expect(reach.width).toBe(0);
    expect(reach.sources).toEqual([]);
    expect(reach.unbounded).toHaveLength(1);
    expect(reach.unbounded[0].type).toBe("pointNeighborhood");
    expect(reach.unbounded[0].param).toBe("radius");
    expect(reach.unbounded[0].why).toMatch(/Field/);
    expect(reach.unbounded[0].why).toMatch(/GLOBAL MAXIMUM/);

    // The line: authored literal versus data. `constant(5)` is the same
    // graph as a plain 5 and reads as 5.
    const literal = neighborReach(countingGraph(constant(5)));
    expect(literal.width).toBe(5);
    expect(literal.unbounded).toEqual([]);
  });

  it("reads sampleNearestPoint's 0 as UNLIMITED, not as no reach", () => {
    const graph = new Graph(1);
    const a = graph.add(pointScatterInWorld, { density: 0.3, cellSize: 4, latticeMode: "xz" });
    const b = graph.add(pointScatterInWorld, { density: 0.1, cellSize: 8, latticeMode: "xz" });
    const near = graph.add(sampleNearestPoint, { maxDistance: 0 });
    graph.connect(a, "out", near, "in");
    graph.connect(b, "out", near, "source");
    graph.output(near, "out", "points");
    const reach = neighborReach(graph);
    expect(reach.width).toBe(0);
    expect(reach.unbounded).toHaveLength(1);
    expect(reach.unbounded[0].why).toMatch(/UNLIMITED/);
    // ... and a positive one IS a reach.
    graph.setParam(near, "maxDistance", 6);
    expect(neighborReach(graph).width).toBe(6);
    expect(neighborReach(graph).unbounded).toEqual([]);
  });

  it("treats a switched-off query as no reach at all", () => {
    const reach = neighborReach(countingGraph(0));
    expect(reach.width).toBe(0);
    expect(reach.sources).toEqual([]);
    expect(reach.unbounded).toEqual([]);
  });

  it("reads a constant field as the literal it is, so a legitimate level is not refused", async () => {
    // selfPrune resolves `minDistance` through its own staticScalar before
    // anything else, so a plain 0 and a constant field of 0 are one graph
    // written two ways. Reading the field spelling as "a Field, therefore
    // unbounded, therefore a greedy prune no halo fixes" refused a level
    // that cooks identically to one that constructs — and told its author
    // to change `mode`, which was not the fix.
    const build = (minDistance: unknown): { graph: Graph; level: LevelDef } => {
      const { graph, scatter } = counting(1);
      const prune = graph.add(selfPrune, { minDistance: minDistance as number, mode: "greedy" });
      graph.connect(scatter, "out", prune, "in");
      graph.output(prune, "out", "pruned");
      return {
        graph,
        level: {
          name: "ground",
          cellSize: 16,
          generationRadius: 20,
          halo: 50,
          graph,
          bind(g, ctx) {
            if (ctx.cellMode !== "xz") throw new Error("expected an xz level");
            g.setParam(scatter, "boundsMin", [ctx.haloMin[0], 0, ctx.haloMin[1]]);
            g.setParam(scatter, "boundsMax", [ctx.haloMax[0], 0, ctx.haloMax[1]]);
          },
        },
      };
    };
    const plain = build(0);
    const field = build(constant(0));
    // The two really are one graph: same survivors, same positions.
    const pointsOf = async (graph: Graph): Promise<number[]> => {
      const out: number[] = [];
      for (const item of (await cook(graph)).outputs["pruned"] ?? []) {
        if (item.kind !== "geometry") continue;
        const P = item.geo.attrs.point.require("P");
        for (let i = 0; i < item.geo.pointCount; i++) out.push(P.get(i, 0), P.get(i, 2));
      }
      return out;
    };
    const a = await pointsOf(plain.graph);
    expect(a.length).toBeGreaterThan(100);
    expect(await pointsOf(field.graph)).toEqual(a);
    // So neither spelling may be refused, and neither is.
    expect(neighborReach(plain.graph).unpartitionable).toEqual([]);
    expect(neighborReach(field.graph).unpartitionable).toEqual([]);
    expect(() => new World({ seed: 7, levels: [plain.level] })).not.toThrow();
    expect(() => new World({ seed: 7, levels: [field.level] })).not.toThrow();
    // A constant ABOVE 0 is still a reach, and still greedy.
    expect(neighborReach(build(constant(3)).graph).unpartitionable).toHaveLength(1);
  });

  it("separates greedy selfPrune, which no halo width can fix, from its minDistance", () => {
    const graph = new Graph(1);
    const scatter = graph.add(pointScatterInWorld, {
      density: 0.3,
      cellSize: 4,
      latticeMode: "xz",
    });
    const prune = graph.add(selfPrune, { minDistance: 3, mode: "greedy" });
    graph.connect(scatter, "out", prune, "in");
    graph.output(prune, "out", "points");
    const greedy = neighborReach(graph);
    expect(greedy.width).toBe(0);
    expect(greedy.sources).toEqual([]);
    expect(greedy.unpartitionable).toHaveLength(1);
    expect(greedy.unpartitionable[0].why).toMatch(/localMaximum/);

    graph.setParam(prune, "mode", "localMaximum");
    const local = neighborReach(graph);
    expect(local.unpartitionable).toEqual([]);
    expect(local.width).toBe(3);

    // Off at minDistance 0, in either mode: nothing chains and nothing is
    // queried, so it is neither a reach nor a blocker.
    graph.setParam(prune, "mode", "greedy");
    graph.setParam(prune, "minDistance", 0);
    expect(neighborReach(graph).unpartitionable).toEqual([]);
    expect(neighborReach(graph).width).toBe(0);
  });

  it("reports transferAttribute, whose default mapping caps nothing", () => {
    // Not a "neighbour query" by filing or by imports, and the widest
    // reach in the table: mapping "nearest" assigns EVERY point from the
    // closest source point however far away, so a cell holding half the
    // source transfers from a different point than the whole region does.
    const graph = new Graph(1);
    const dst = graph.add(pointScatterInWorld, { density: 0.3, cellSize: 4, latticeMode: "xz" });
    const src = graph.add(pointScatterInWorld, { density: 0.1, cellSize: 8, latticeMode: "xz" });
    const xfer = graph.add(transferAttribute, { name: "seed" });
    graph.connect(dst, "out", xfer, "in");
    graph.connect(src, "out", xfer, "source");
    graph.output(xfer, "out", "points");
    const nearest = neighborReach(graph);
    expect(nearest.width).toBe(0);
    expect(nearest.unbounded).toHaveLength(1);
    expect(nearest.unbounded[0].type).toBe("transferAttribute");
    expect(nearest.unbounded[0].why).toMatch(/NO distance cap/);

    graph.setParam(xfer, "mapping", "uv");
    expect(neighborReach(graph).unbounded[0].why).toMatch(/UV space/);

    // Raycast is the one bounded mapping — with the same inverted 0.
    graph.setParam(xfer, "mapping", "raycast");
    graph.setParam(xfer, "maxDistance", 12);
    expect(neighborReach(graph).width).toBe(12);
    expect(neighborReach(graph).unbounded).toEqual([]);
    graph.setParam(xfer, "maxDistance", 0);
    expect(neighborReach(graph).width).toBe(0);
    expect(neighborReach(graph).unbounded[0].why).toMatch(/UNLIMITED sentinel/);
  });

  it("turns occlusionCull from a gap into a blocker at pushClearance above 0", () => {
    const graph = new Graph(1);
    const boxes = graph.add(pointScatterInWorld, { density: 0.3, cellSize: 4, latticeMode: "xz" });
    const cull = graph.add(occlusionCull);
    graph.connect(boxes, "out", cull, "in");
    graph.output(cull, "out", "points");
    // Default pushClearance 0: a wide query whose width is derived from
    // geometry, but nothing chains.
    const still = neighborReach(graph);
    expect(still.unpartitionable).toEqual([]);
    expect(still.unbounded).toHaveLength(1);
    expect(still.unbounded[0].why).toMatch(/lookAhead \+ pushMax/);

    graph.setParam(cull, "pushClearance", 2);
    const greedy = neighborReach(graph);
    expect(greedy.unbounded).toEqual([]);
    expect(greedy.unpartitionable).toHaveLength(1);
    expect(greedy.unpartitionable[0].param).toBe("pushClearance");
    expect(greedy.unpartitionable[0].why).toMatch(/GREEDY/);

    // A constant 0 is the literal 0: the node builds its settled-points
    // grid only above 0, so this is not greedy and must not be refused.
    graph.setParam(cull, "pushClearance", constant(0));
    expect(neighborReach(graph).unpartitionable).toEqual([]);
    // A field that could VARY still reads as greedy — it is evaluated per
    // point and cannot be shown to be 0 at all of them.
    graph.setParam(cull, "pushClearance", randomField());
    expect(neighborReach(graph).unpartitionable).toHaveLength(1);
    expect(neighborReach(graph).unpartitionable[0].why).toMatch(/varying field/);
  });

  it("sees a query hidden inside a subgraph node, and its exposed override", () => {
    const inner = countingGraph(4);
    const innerCount = [...inner._nodes.values()].find((n) => n.def.type === "pointNeighborhood")!;
    const outer = new Graph(9);
    const plain = subgraphNode(inner, [], [{ name: "out", node: { id: innerCount.id }, pin: "out" }]);
    const sn = outer.add(plain);
    outer.output(sn, "out", "points");
    const nested = neighborReach(outer);
    expect(nested.width).toBe(4);
    // The id locates the node through the wrapper rather than shadowing it.
    expect(nested.sources[0].node).toBe(`${sn.id}/${innerCount.id}`);

    // An exposed param is written into its inner target at cook time, so
    // the INSTANCE's value is the one that will be queried with. A fresh
    // inner graph: wrapping adds portal outputs to the graph it wraps, so
    // one graph cannot back two wrappers built here.
    const inner2 = countingGraph(4);
    const count2 = [...inner2._nodes.values()].find((n) => n.def.type === "pointNeighborhood")!;
    const exposing = subgraphNode(
      inner2,
      [],
      [{ name: "out", node: { id: count2.id }, pin: "out" }],
      [
        {
          name: "reach",
          targets: [{ node: { id: count2.id }, param: "radius", acceptsField: true }],
          schema: {
            type: "f32",
            default: 1,
            min: 0,
            acceptsField: true,
            description: "Exposed neighbourhood radius.",
          },
        },
      ],
    );
    const outer2 = new Graph(9);
    const sn2 = outer2.add(exposing, { reach: 9 });
    outer2.output(sn2, "out", "points");
    expect(neighborReach(outer2).width).toBe(9);
  });

  it("walks both instances of one shared inner graph, not just the first", () => {
    // Instances of a def share `spec.graph` BY REFERENCE (subgraph.ts:
    // "instances of one definition share the inner graph"), so a visited
    // set that never forgets skips every instance after the first — and
    // the one it skips is the one asking for the wider reach.
    const inner = countingGraph(4);
    const leaf = [...inner._nodes.values()].find((n) => n.def.type === "pointNeighborhood")!;
    const def = exposeReach(inner, leaf.id);
    const outer = new Graph(3);
    const small = outer.add(def, { reach: 2 });
    const big = outer.add(def, { reach: 25 });
    outer.output(small, "out", "small");
    outer.output(big, "out", "big");
    const reach = neighborReach(outer);
    expect(reach.sources).toHaveLength(2);
    expect(reach.sources.map((s) => s.reach).sort((a, b) => a - b)).toEqual([2, 25]);
    expect(reach.width).toBe(25);
  });

  /** The widest neighbour count a graph's "points" output carries. */
  async function maxCount(graph: Graph): Promise<number> {
    const result = await cook(graph);
    let max = 0;
    for (const item of result.outputs["points"] ?? []) {
      if (item.kind !== "geometry") continue;
      const n = item.geo.attrs.point.require("n");
      for (let i = 0; i < item.geo.pointCount; i++) max = Math.max(max, n.get(i));
    }
    return max;
  }

  it("cannot meet a containment cycle, because Graph.add refuses to build one", () => {
    // The walk's `seen` set is NOT what makes a cycle terminate — this is.
    // Pinned here because the walk's path-scoping was chosen on the
    // strength of it: if either refusal were ever relaxed, this test fails
    // and says so, instead of `neighborReach` hanging.
    const ga = new Graph(1);
    const leafA = counting(4);
    const ca = [...leafA.graph._nodes.values()].find((n) => n.def.type === "pointNeighborhood")!;
    const defA = subgraphNode(leafA.graph, [], [{ name: "out", node: { id: ca.id }, pin: "out" }]);
    // Direct: the def wrapping its own inner graph, added back into it.
    expect(() => leafA.graph.add(defA)).toThrow(/wraps this very graph/);

    // Transitive: A's graph holds a B whose graph holds an A.
    const leafB = counting(11);
    const cb = [...leafB.graph._nodes.values()].find((n) => n.def.type === "pointNeighborhood")!;
    leafB.graph.add(defA);
    const defB = subgraphNode(leafB.graph, [], [{ name: "out", node: { id: cb.id }, pin: "out" }]);
    expect(() => leafA.graph.add(defB)).toThrow(/reaches back to this one/);

    // And the reachable half still reads: B's graph really does hold an A.
    ga.add(defB);
    const reach = neighborReach(ga);
    expect(reach.sources.map((s) => s.reach).sort((a, b) => a - b)).toEqual([4, 11]);
  });

  it("follows a chained exposure to the value the OUTER instance sets", async () => {
    // outer(25) -> middle's own exposed param -> the leaf's radius, built
    // with 4 and overridden twice. Reading the middle instance's stored
    // value reports a number the cook will never use.
    const inner = countingGraph(4);
    const leaf = [...inner._nodes.values()].find((n) => n.def.type === "pointNeighborhood")!;
    const leafDef = exposeReach(inner, leaf.id);
    const middle = new Graph(4);
    const mid = middle.add(leafDef, { reach: 3 });
    const midDef = exposeReach(middle, mid.id, "reach");
    const outer = new Graph(5);
    const top = outer.add(midDef, { reach: 25 });
    outer.output(top, "out", "points");
    expect(neighborReach(outer).width).toBe(25);

    // With nothing set on the outer instance the answer is the WRAPPER'S
    // DECLARED DEFAULT, not the middle's 3 and not the leaf's 4: Graph.add
    // seeds one params key per exposed param, so an outer instance always
    // carries a value and the outermost one always wins. Pinned against
    // the cook rather than against that reasoning — the point of a static
    // read is that it agrees with what cooks.
    const outer2 = new Graph(6);
    const top2 = outer2.add(midDef);
    outer2.output(top2, "out", "points");
    expect(neighborReach(outer2).width).toBe(1);
    expect(await maxCount(outer)).toBe(await maxCount(countingGraph(25)));
    expect(await maxCount(outer2)).toBe(await maxCount(countingGraph(1)));
    // The controls that make those equalities mean something: the cook
    // must be distinguishable at all three radii, and outer2 must be
    // ruled out as the MIDDLE's 3 rather than merely shown to equal 1.
    expect(await maxCount(countingGraph(25))).not.toBe(await maxCount(countingGraph(1)));
    expect(await maxCount(countingGraph(3))).not.toBe(await maxCount(countingGraph(1)));
    expect(await maxCount(outer2)).not.toBe(await maxCount(countingGraph(3)));
  });

  it("stays linear in DISTINCT graphs when a wrapper chain doubles per level", () => {
    // A def that instantiates the def below it twice has 2^depth leaf
    // instances. Walking per PATH is what the shared-inner-graph fix cost:
    // depth 22 measured four million visits and several seconds, depth 26
    // does not finish — inside the World constructor, so a build-time
    // hang. Memoizing on (graph, overrides) collapses it to one walk per
    // DISTINCT graph, of which there are `DEPTH`.
    //
    // Asserted on the COUNT, never on the clock: the count is exact and
    // deterministic, and a machine having a bad minute cannot fail it.
    // Removing the memo does not make this assertion wrong — it makes the
    // test never finish, which vitest reports just as loudly.
    const DEPTH = 24;
    const leaf = counting(4);
    const leafNode = [...leaf.graph._nodes.values()].find(
      (n) => n.def.type === "pointNeighborhood",
    )!;
    let def = subgraphNode(leaf.graph, [], [{ name: "out", node: { id: leafNode.id }, pin: "out" }]);
    for (let level = 0; level < DEPTH; level++) {
      const g = new Graph(100 + level);
      const a = g.add(def);
      g.add(def);
      def = subgraphNode(g, [], [{ name: "out", node: { id: a.id }, pin: "out" }]);
    }
    const top = new Graph(999);
    const instance = top.add(def);
    top.output(instance, "out", "points");

    const reach = neighborReach(top);
    // 2^24 leaf instances, all genuinely distinct nodes — the count is
    // exact even though only EXEMPLAR_LIMIT of them are named.
    expect(reach.sourceCount).toBe(2 ** DEPTH);
    expect(reach.sources).toHaveLength(EXEMPLAR_LIMIT);
    expect(reach.width).toBe(4);
    // Every named exemplar is a real path through the wrappers.
    expect(reach.sources[0].node.split("/")).toHaveLength(DEPTH + 2);
  });
});

/** A level whose bind spends the halo the runtime hands it. */
function countingLevel(opts: { radius: number; halo?: number; cellSize?: number }): LevelDef {
  const { graph, scatter } = counting(opts.radius);
  return {
    name: "ground",
    cellSize: opts.cellSize ?? 16,
    generationRadius: 20,
    ...(opts.halo !== undefined ? { halo: opts.halo } : {}),
    graph,
    bind(g, ctx) {
      if (ctx.cellMode !== "xz") throw new Error("expected an xz level");
      // The widening is the runtime's arithmetic now, not the level's.
      g.setParam(scatter, "boundsMin", [ctx.haloMin[0], 0, ctx.haloMin[1]]);
      g.setParam(scatter, "boundsMax", [ctx.haloMax[0], 0, ctx.haloMax[1]]);
      g.setParam(scatter, "seed", ctx.worldSeed);
    },
  };
}

describe("World halo validation", () => {
  it("refuses a halo narrower than the reach its own graph asks for", () => {
    const build = (): World =>
      new World({ seed: 7, levels: [countingLevel({ radius: 4, halo: 2 })] });
    expect(build).toThrow(WorldValidationError);
    // Names the level, the halo it has, the node and reach it needs, and
    // both fixes — the agent-facing error contract.
    expect(build).toThrow(/level 0 \("ground"\)/);
    expect(build).toThrow(/halo 2 is narrower/);
    expect(build).toThrow(/\(pointNeighborhood\) queries radius 4/);
    expect(build).toThrow(/Raise halo to at least 4/);
    expect(build).toThrow(/bring the reach down to 2 or less/);
  });

  it("stops refusing once the halo is at least the reach", () => {
    expect(
      () => new World({ seed: 7, levels: [countingLevel({ radius: 4, halo: 4 })] }),
    ).not.toThrow();
    expect(
      () => new World({ seed: 7, levels: [countingLevel({ radius: 4, halo: 9 })] }),
    ).not.toThrow();
  });

  it("checks nothing on a level that declares no halo", () => {
    // The honest limit of the guard, pinned so it cannot regress into a
    // surprise: a level that states no halo is not making a claim, and the
    // World has no way to derive one from a bind's arithmetic.
    expect(() => new World({ seed: 7, levels: [countingLevel({ radius: 4 })] })).not.toThrow();
  });

  it("refuses a greedy selfPrune under any halo", () => {
    const level = countingLevel({ radius: 1, halo: 50 });
    const prune = level.graph.add(selfPrune, { minDistance: 3, mode: "greedy" });
    level.graph.output(prune, "out", "pruned");
    const build = (): World => new World({ seed: 7, levels: [level] });
    expect(build).toThrow(/no halo width reproduces/);
    expect(build).toThrow(/widening it is not the fix/);
    level.graph.setParam(prune, "mode", "localMaximum");
    expect(build).not.toThrow();
  });

  it("refuses a halo on an unbounded level and on a path level", () => {
    const unbounded: LevelDef = { ...countingLevel({ radius: 1, halo: 2 }), cellSize: "unbounded" };
    expect(() => new World({ seed: 7, levels: [unbounded] })).toThrow(/ONE global cell/);
    const path: LevelDef = {
      ...countingLevel({ radius: 1, halo: 2 }),
      cellMode: "path",
      path: { length: 100, closed: true },
    };
    expect(() => new World({ seed: 7, levels: [path] })).toThrow(/ARC LENGTH/);
  });

  it("refuses a halo that is not a finite number >= 0", () => {
    for (const bad of [-1, Infinity, NaN]) {
      expect(() => new World({ seed: 7, levels: [countingLevel({ radius: 1, halo: bad })] })).toThrow(
        /halo must be a finite number >= 0/,
      );
    }
  });

  it("hands bind the cell box grown by the declared halo, and the plain box without one", async () => {
    const seen: { min: readonly number[]; halo: readonly number[] }[] = [];
    const spy = (halo?: number): LevelDef => {
      const level = countingLevel({ radius: 1, halo, cellSize: 16 });
      const inner = level.bind!;
      return {
        ...level,
        bind(g, ctx) {
          inner(g, ctx);
          if (ctx.cellMode === "xz") seen.push({ min: ctx.min, halo: ctx.haloMin });
        },
      };
    };
    await new World({ seed: 7, levels: [spy(3)] }).update([0, 0, 0]);
    expect(seen.every((s) => s.halo[0] === s.min[0] - 3 && s.halo[1] === s.min[1] - 3)).toBe(true);
    seen.length = 0;
    await new World({ seed: 7, levels: [spy()] }).update([0, 0, 0]);
    expect(seen.every((s) => s.halo[0] === s.min[0] && s.halo[1] === s.min[1])).toBe(true);
  });
});

const WORLD_SEED = 31337;
const RADIUS = 3;
const CELL = 16;

/** Every kept point's neighbour count, keyed by position. */
function countsOf(outputs: CellOutputs, into: Map<string, number>): void {
  for (const item of outputs["points"] ?? []) {
    if (item.kind !== "geometry") continue;
    const geo: Geometry = item.geo;
    const P = geo.attrs.point.require("P");
    const n = geo.attrs.point.require("n");
    for (let i = 0; i < geo.pointCount; i++) {
      into.set(`${P.get(i, 0)},${P.get(i, 2)}`, n.get(i));
    }
  }
}

/**
 * The level the content proof streams: a world-anchored cloud, a
 * neighbour count over whatever the query window caught, then the
 * ownership clip back to the cell. `haloWidth` is spent BY HAND, the way
 * every level in this repo spent it before `LevelDef.halo` existed —
 * which is exactly why the undersized case below can be built at all.
 */
function clippedLevel(haloWidth: number, declare: boolean): LevelDef {
  const graph = new Graph(5);
  const scatter = graph.add(pointScatterInWorld, {
    density: 0.3,
    cellSize: 4,
    latticeMode: "xz",
    height: 0,
    seed: WORLD_SEED,
  });
  const count = graph.add(pointNeighborhood, { radius: RADIUS, countAttr: "n" });
  const clip = graph.add(filterByBounds);
  graph.connect(scatter, "out", count, "in");
  graph.connect(count, "out", clip, "in");
  graph.output(clip, "out", "points");
  return {
    name: "ground",
    cellSize: CELL,
    generationRadius: 20,
    ...(declare ? { halo: haloWidth } : {}),
    graph,
    bind(g, ctx) {
      if (ctx.cellMode !== "xz") throw new Error("expected an xz level");
      g.setParam(scatter, "boundsMin", [ctx.min[0] - haloWidth, -1, ctx.min[1] - haloWidth]);
      g.setParam(scatter, "boundsMax", [ctx.max[0] + haloWidth, 1, ctx.max[1] + haloWidth]);
      g.setParam(clip, "boundsMin", [ctx.min[0], -1, ctx.min[1]]);
      g.setParam(clip, "boundsMax", [ctx.max[0], 1, ctx.max[1]]);
    },
  };
}

/** The same content cooked in one piece over `[-span, span]^2`. */
async function wholeRegion(span: number): Promise<Map<string, number>> {
  const graph = new Graph(5);
  const scatter = graph.add(pointScatterInWorld, {
    density: 0.3,
    cellSize: 4,
    latticeMode: "xz",
    height: 0,
    seed: WORLD_SEED,
    // Wide enough that every point INSIDE the region has its full
    // neighbourhood present: the reference must not have the very defect
    // it is the reference for.
    boundsMin: [-span - RADIUS, -1, -span - RADIUS],
    boundsMax: [span + RADIUS, 1, span + RADIUS],
  });
  const count = graph.add(pointNeighborhood, { radius: RADIUS, countAttr: "n" });
  const clip = graph.add(filterByBounds, {
    boundsMin: [-span, -1, -span],
    boundsMax: [span, 1, span],
  });
  graph.connect(scatter, "out", count, "in");
  graph.connect(count, "out", clip, "in");
  graph.output(clip, "out", "points");
  const result = await cook(graph);
  const map = new Map<string, number>();
  countsOf(result.outputs, map);
  return map;
}

/** Cells of one update, restricted to the box the reference covers. */
async function streamedCounts(level: LevelDef, span: number): Promise<Map<string, number>> {
  const world = new World({ seed: WORLD_SEED, levels: [level] });
  await world.update([0, 0, 0]);
  const map = new Map<string, number>();
  for (const cell of world.cells("ground")) countsOf(cell.outputs, map);
  for (const key of [...map.keys()]) {
    const [x, z] = key.split(",").map(Number);
    if (x < -span || x >= span || z < -span || z >= span) map.delete(key);
  }
  return map;
}

describe("what the halo guard is guarding", () => {
  // The reference box is one cell either side of the origin, well inside
  // the disc of cells an update of radius 20 cooks, so every point in it
  // came from a cell whose own neighbours also cooked. Any disagreement
  // is the halo, not a missing cell.
  const SPAN = CELL;

  it("is deterministically wrong, and silent, when the halo is narrower than the radius", async () => {
    const whole = await wholeRegion(SPAN);
    expect(whole.size).toBeGreaterThan(100);

    // Undeclared and undersized: exactly what every level in this repo
    // could express before, and it cooks without a word.
    const narrow = await streamedCounts(clippedLevel(1, false), SPAN);
    expect(narrow.size).toBe(whole.size);
    const wrong = [...whole].filter(([key, n]) => narrow.get(key) !== n);
    expect(wrong.length).toBeGreaterThan(0);
    // Wrong in one direction only: a truncated neighbour set can never
    // count MORE than the whole region did.
    expect(wrong.every(([key, n]) => (narrow.get(key) as number) < n)).toBe(true);
    // ... and repeatable, which is what makes it hard to catch by eye.
    const again = await streamedCounts(clippedLevel(1, false), SPAN);
    expect([...again].sort()).toEqual([...narrow].sort());

    // The same content, with the halo the graph actually asks for.
    const wide = await streamedCounts(clippedLevel(RADIUS, false), SPAN);
    expect([...wide].sort()).toEqual([...whole].sort());
  });

  /**
   * THE REFUSAL NAMES THE NODE THE NUMBER CAME FROM, and this test exists
   * because it once did not. `sources` is capped at EXEMPLAR_LIMIT, and
   * the message used to find its culprit by reducing over that CAP — so on
   * a graph with more than eight queries it named whichever of the first
   * eight happened to be widest. With the widest node last, the thrown
   * sentence named a node whose reach was BELOW the declared halo, called
   * it "the widest of 20", and then told the reader to raise the halo to a
   * number that node had never asked for.
   *
   * A message that points at the wrong node is worse than no message: the
   * author goes and looks at it, finds nothing wrong, and concludes the
   * check is broken. `NeighborReach.widest` is carried unsampled for
   * exactly this, so the id and the number come from one place.
   */
  it("names the widest node even when it is past the exemplar cap", () => {
    const g = new Graph(1);
    const src = g.add(pointScatterInWorld, {
      cellSize: 16,
      pointsPerCell: 4,
    } as Partial<PointScatterInWorldParams>);
    // More queries than the cap, with the widest LAST so a reduce over the
    // first EXEMPLAR_LIMIT cannot reach it. Every other reach is 1, which
    // is under the halo below -- so if the message picks one of those it
    // is provably naming a node that is not the offender.
    const WIDE = 99;
    let last: NodeHandle = src;
    for (let i = 0; i < EXEMPLAR_LIMIT + 12; i++) {
      const n = g.add(pointNeighborhood, {
        radius: i === EXEMPLAR_LIMIT + 11 ? WIDE : 1,
        countAttr: `n${i}`,
      });
      g.connect(last, "out", n, "in");
      last = n;
    }
    g.output(last, "out", "points");

    const reach = neighborReach(g);
    expect(reach.width).toBe(WIDE);
    expect(reach.sourceCount).toBe(EXEMPLAR_LIMIT + 12);
    // The premise: the cap really did drop the widest from the sample, so
    // this test would pass vacuously if the sample happened to hold it.
    expect(reach.sources.length).toBe(EXEMPLAR_LIMIT);
    expect(reach.sources.some((r) => r.reach === WIDE)).toBe(false);
    expect(reach.widest?.reach).toBe(WIDE);

    let message = "";
    try {
      new World({
        seed: WORLD_SEED,
        levels: [{ name: "l", cellSize: 32, halo: 5, graph: g, bind: () => undefined }],
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message, "the level was not refused at all").toContain("halo 5 is narrower");
    // Names the offender...
    expect(message).toContain(`queries radius ${WIDE}`);
    // ...and never a node that is inside the declared halo, which is what
    // the reduce-over-the-sample version did.
    expect(message).not.toMatch(/queries radius 1/);
    // The counts stay exact and the sample is described as a sample.
    expect(message).toContain(`${EXEMPLAR_LIMIT + 12} readable reaches in this graph`);
    expect(message).toContain(`${EXEMPLAR_LIMIT} named here`);
    expect(message).toContain(`Raise halo to at least ${WIDE}`);
  });

  it("throws on the wrong one and constructs the right one, once the halo is declared", async () => {
    expect(() => new World({ seed: WORLD_SEED, levels: [clippedLevel(1, true)] })).toThrow(
      /halo 1 is narrower than the neighbour-query reach/,
    );
    const whole = await wholeRegion(SPAN);
    const declared = await streamedCounts(clippedLevel(RADIUS, true), SPAN);
    expect([...declared].sort()).toEqual([...whole].sort());
  });
});
