/**
 * Phase 16 — World interplay with graph mutation: removing a node from a
 * bound graph between updates bumps the graph version, so the level's
 * baseline detects it exactly like a setParam edit — stored cells recook
 * (and only that level's), determinism is preserved, and the baseline
 * heals so the edit is charged once.
 */
import { describe, expect, it } from "vitest";
import type { Geometry } from "../data/index.js";
import { Graph, firstGeometry, type DataCollection, type NodeHandle } from "../graph/index.js";
import { jitterPoints, type JitterPointsParams } from "../nodes/pointOps.js";
import { pointScatterInBounds, type PointScatterInBoundsParams } from "../nodes/sources.js";
import { geometryDiff, scatterLevel } from "./runtime.testsupport.js";
import type { LevelDef } from "./types.js";
import { World } from "./world.js";

function mustGeo(coll: DataCollection | undefined): Geometry {
  const geo = firstGeometry(coll ?? []);
  if (!geo) throw new Error("expected a geometry item");
  return geo;
}

/** Bounded level: scatter -> jitter, outputs "points" (scatter) and "jittered" (jitter). */
function jitterChunk(): {
  def: LevelDef;
  graph: Graph;
  scatter: NodeHandle<PointScatterInBoundsParams>;
  jit: NodeHandle<JitterPointsParams>;
} {
  const graph = new Graph(1);
  const scatter = graph.add(pointScatterInBounds, { count: 4 }, "scatter");
  const jit = graph.add(jitterPoints, { amount: [0.5, 0, 0.5], seed: 7 }, "jit");
  graph.connect(scatter, "out", jit, "in");
  graph.output(scatter, "out", "points");
  graph.output(jit, "out", "jittered");
  const def: LevelDef = {
    name: "chunk",
    cellSize: 10,
    generationRadius: 8,
    graph,
    // Bind touches only the scatter, so it stays valid after the jitter
    // node is removed mid-test.
    bind(g, ctx) {
      g.setParam(scatter, "boundsMin", [ctx.min[0], 0, ctx.min[1]]);
      g.setParam(scatter, "boundsMax", [ctx.max[0], 0, ctx.max[1]]);
      g.setParam(scatter, "seed", ctx.seed);
    },
  };
  return { def, graph, scatter, jit };
}

describe("World staleness under graph mutation", () => {
  it("a node removed between updates recooks that level's cells deterministically", async () => {
    const planet = scatterLevel({
      name: "planet",
      cellSize: "unbounded",
      generationRadius: 1,
      count: 3,
    });
    const chunk = jitterChunk();
    const world = new World({ seed: 3, levels: [planet.def, chunk.def] });

    const first = await world.update([0, 0, 0]);
    expect(first.cooked).toHaveLength(5); // planet + 4 chunk cells
    const cellBefore = world.getCell("chunk", [0, 0]);
    expect(cellBefore?.outputs.jittered).toBeDefined();
    const pointsBefore = mustGeo(cellBefore?.outputs.points);

    // The mutation: removing the jitter node cascades away its "jittered"
    // output and its connection, and bumps the version — which the World
    // must treat exactly like a setParam edit.
    chunk.graph.removeNode(chunk.jit);
    const second = await world.update([0, 0, 0]);
    expect(second.cooked).toHaveLength(4);
    expect(second.cooked.every((c) => c.level === "chunk")).toBe(true); // planet stays cached

    // Recooked cells reflect the cascade (no more "jittered") while the
    // untouched scatter branch reproduces byte-identical points.
    const cellAfter = world.getCell("chunk", [0, 0]);
    expect(cellAfter?.outputs.jittered).toBeUndefined();
    expect(geometryDiff(mustGeo(cellAfter?.outputs.points), pointsBefore)).toBeNull();

    // The baseline healed: the edit is charged exactly once.
    const third = await world.update([0, 0, 0]);
    expect(third.cooked).toEqual([]);
    expect(third.pending).toBe(0);
  });
});
