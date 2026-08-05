/**
 * Level declaration options added in phase 11: unbounded levels no
 * longer need a dummy generationRadius (optional, and still accepted +
 * ignored when passed), bounded levels keep requiring one with an
 * actionable error, and a level can restrict its per-cell cook to a
 * subset of the graph's declared outputs via `cookOutputs`.
 */
import { describe, expect, it } from "vitest";
import { Graph, firstGeometry } from "../graph/index.js";
import { jitterPoints } from "../nodes/pointOps.js";
import { pointScatterInBounds } from "../nodes/sources.js";
import { hashCombine } from "../random/index.js";
import { childEchoLevel, geometryDiff, outputsDiff, scatterLevel } from "./testSupport.js";
import type { LevelDef } from "./types.js";
import { World, WorldValidationError } from "./world.js";

describe("unbounded levels without generationRadius", () => {
  it("works end-to-end, alone and as a parent", async () => {
    const planet = scatterLevel({ name: "planet", cellSize: "unbounded", count: 3 });
    expect(planet.def.generationRadius).toBeUndefined();
    const world = new World({
      seed: 5,
      levels: [planet.def, childEchoLevel({ name: "chunk", cellSize: 10, generationRadius: 9 }).def],
    });
    const stats = await world.update([0, 0, 0]);
    expect(stats.cooked[0]).toEqual({ level: "planet", coord: [0, 0] });
    expect(stats.pending).toBe(0);
    const planetPoints = world.getCell("planet", [0, 0])?.outputs.points;
    expect(firstGeometry(planetPoints ?? [])?.attrs.point.count).toBe(3);
    for (const cell of world.cells("chunk")) {
      expect(cell.outputs.parentEcho[0]).toBe(planetPoints?.[0]);
    }
    // Quiescent on a repeat update, like any unbounded level.
    const again = await world.update([0, 0, 0]);
    expect(again.cooked).toEqual([]);
  });

  it("still accepts a generationRadius on an unbounded level and ignores it (byte-identical)", async () => {
    const withRadius = new World({
      seed: 5,
      levels: [
        scatterLevel({ name: "planet", cellSize: "unbounded", generationRadius: 1, count: 3 }).def,
      ],
    });
    const without = new World({
      seed: 5,
      levels: [scatterLevel({ name: "planet", cellSize: "unbounded", count: 3 }).def],
    });
    await withRadius.update([0, 0, 0]);
    await without.update([0, 0, 0]);
    expect(
      outputsDiff(
        withRadius.getCell("planet", [0, 0])?.outputs ?? {},
        without.getCell("planet", [0, 0])?.outputs ?? {},
      ),
    ).toBeNull();
  });

  it("keeps requiring generationRadius on bounded levels, with an actionable error", () => {
    const def = scatterLevel({ name: "chunk", cellSize: 10 }).def;
    expect(() => new World({ seed: 1, levels: [def] })).toThrow(WorldValidationError);
    expect(() => new World({ seed: 1, levels: [def] })).toThrow(
      /level 0 \("chunk"\): a bounded level requires generationRadius \(a positive finite number\); only an unbounded level may omit it/,
    );
  });
});

describe("LevelDef.cookOutputs", () => {
  /** Scatter -> jitter graph declaring both stages as outputs. */
  function stagedLevel(cookOutputs?: readonly string[]): LevelDef {
    const graph = new Graph(1);
    const scatter = graph.add(pointScatterInBounds, { count: 4 });
    const jitter = graph.add(jitterPoints, { amount: [0.5, 0, 0.5] });
    graph.connect(scatter, "out", jitter, "in");
    graph.output(scatter, "out", "raw");
    graph.output(jitter, "out", "points");
    return {
      name: "chunk",
      cellSize: 10,
      generationRadius: 8,
      cookOutputs,
      graph,
      bind(g, ctx) {
        g.setParam(scatter, "boundsMin", [ctx.min[0], 0, ctx.min[1]]);
        g.setParam(scatter, "boundsMax", [ctx.max[0], 0, ctx.max[1]]);
        g.setParam(scatter, "seed", ctx.seed);
        g.setParam(jitter, "seed", hashCombine(ctx.seed, 1));
      },
    };
  }

  it("cooks and stores only the selected outputs, byte-identical to a full cook's same output", async () => {
    const partial = new World({ seed: 7, levels: [stagedLevel(["raw"])] });
    const full = new World({ seed: 7, levels: [stagedLevel()] });
    await partial.update([0, 0, 0]);
    await full.update([0, 0, 0]);

    const partialCell = partial.getCell("chunk", [0, 0]);
    const fullCell = full.getCell("chunk", [0, 0]);
    expect(Object.keys(partialCell?.outputs ?? {})).toEqual(["raw"]);
    expect(Object.keys(fullCell?.outputs ?? {})).toEqual(["raw", "points"]);

    const partialRaw = firstGeometry(partialCell?.outputs.raw ?? []);
    const fullRaw = firstGeometry(fullCell?.outputs.raw ?? []);
    expect(partialRaw).toBeDefined();
    if (partialRaw && fullRaw) expect(geometryDiff(partialRaw, fullRaw)).toBeNull();
  });

  it("rejects unknown cookOutputs names at construction, listing the graph's declared outputs", () => {
    expect(() => new World({ seed: 1, levels: [stagedLevel(["nope"])] })).toThrow(
      WorldValidationError,
    );
    expect(() => new World({ seed: 1, levels: [stagedLevel(["nope"])] })).toThrow(
      /level 0 \("chunk"\): cookOutputs names unknown output "nope"; the level graph declares: "raw", "points"/,
    );
  });

  it("rejects an empty cookOutputs list at construction, stating the fix", () => {
    expect(() => new World({ seed: 1, levels: [stagedLevel([])] })).toThrow(WorldValidationError);
    expect(() => new World({ seed: 1, levels: [stagedLevel([])] })).toThrow(
      /level 0 \("chunk"\): cookOutputs is an empty list.*omit cookOutputs to cook all declared outputs, or name at least one/,
    );
  });
});
