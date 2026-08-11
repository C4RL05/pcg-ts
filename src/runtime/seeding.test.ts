/**
 * Per-cell seeding determinism: the setAttribute `seed` param and the
 * sanctioned graph.setSeed-in-bind pattern both keep cell content a pure
 * function of (world seed, level, coord) — independent of cook order,
 * viewpoint path, and eviction history — including string attributes,
 * whose comparison resolves through the string tables.
 */
import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import { mul, randomField } from "../fields/index.js";
import { Graph } from "../graph/index.js";
import { setAttribute } from "../nodes/attributes.js";
import { pointScatterInBounds } from "../nodes/sources.js";
import { hashCombine } from "../random/index.js";
import { geometryDiff, outputsDiff } from "./runtime.testsupport.js";
import type { CellOutputs, LevelDef } from "./types.js";
import { World } from "./world.js";

/**
 * A level scattering points per cell and stamping a string `species`
 * attribute from a random selector. `seedParam` mode wires ctx.seed into
 * the nodes' seed params; `setSeed` mode reseeds the whole graph in bind
 * (the documented alternative pattern).
 */
function speciesLevel(opts: {
  name: string;
  mode: "seedParam" | "setSeed";
  generationRadius?: number;
  retainRadius?: number;
}): LevelDef {
  const graph = new Graph(1);
  const scatter = graph.add(pointScatterInBounds, { count: 6 });
  const species = graph.add(setAttribute, {
    name: "species",
    type: "string",
    values: ["pine", "bush", "rock"],
    // randomField reads the evaluation seed, so the per-cell seed decides
    // the species pattern; the node floors + clamps the selector.
    value: mul(randomField(5), 3),
  });
  graph.connect(scatter, "out", species, "in");
  graph.output(species, "out", "points");
  return {
    name: opts.name,
    cellSize: 10,
    generationRadius: opts.generationRadius ?? 12,
    retainRadius: opts.retainRadius,
    graph,
    bind(g, ctx) {
      g.setParam(scatter, "boundsMin", [ctx.min[0], 0, ctx.min[1]]);
      g.setParam(scatter, "boundsMax", [ctx.max[0], 0, ctx.max[1]]);
      if (opts.mode === "setSeed") {
        g.setSeed(hashCombine(ctx.seed, 7));
      } else {
        g.setParam(scatter, "seed", ctx.seed);
        g.setParam(species, "seed", hashCombine(ctx.seed, 1));
      }
    },
  };
}

function makeWorld(mode: "seedParam" | "setSeed"): World {
  // Large retainRadius keeps every generated cell around, so worlds that
  // walked opposite paths hold comparable cell sets.
  return new World({
    seed: 42,
    levels: [speciesLevel({ name: "chunk", mode, retainRadius: 1000 })],
  });
}

function speciesOf(outputs: CellOutputs): string[] {
  const item = outputs.points[0];
  if (item === undefined || item.kind !== "geometry") {
    throw new Error("expected a geometry item on the points output");
  }
  const attr = item.geo.attrs.point.require("species");
  return Array.from({ length: item.geo.pointCount }, (_, i) => attr.getString(i));
}

/** Assert every cell of `a` exists in `b` with byte-identical outputs. */
function expectCellsIdentical(a: World, b: World, level: string): void {
  const cells = a.cells(level);
  expect(cells.length).toBeGreaterThan(4);
  for (const cell of cells) {
    const other = b.getCell(level, cell.coord);
    expect(other, `cell ${cell.coord[0]},${cell.coord[1]} missing`).toBeDefined();
    expect(outputsDiff(cell.outputs, other?.outputs ?? {})).toBeNull();
  }
}

describe("setAttribute seed param in a World", () => {
  it("different viewpoint paths produce byte-identical cells (string attrs included)", async () => {
    const a = makeWorld("seedParam");
    const b = makeWorld("seedParam");
    await a.update([-15, 0, 0]);
    await a.update([15, 0, 0]);
    await b.update([15, 0, 0]);
    await b.update([-15, 0, 0]);
    expectCellsIdentical(a, b, "chunk");

    // The per-cell seed actually varies content: the selector spreads over
    // several species, and neighbouring cells get different patterns.
    const cells = a.cells("chunk");
    const union = new Set(cells.flatMap((c) => speciesOf(c.outputs)));
    expect(union.size).toBeGreaterThan(1);
    expect(speciesOf(cells[0].outputs)).not.toEqual(speciesOf(cells[1].outputs));
  });

  it("an evicted then regenerated cell is byte-identical", async () => {
    const world = new World({
      seed: 42,
      levels: [
        speciesLevel({ name: "chunk", mode: "seedParam", generationRadius: 8, retainRadius: 8 }),
      ],
    });
    await world.update([0, 0, 0]);
    const before = world.getCell("chunk", [0, 0]);
    expect(before).toBeDefined();

    await world.update([200, 0, 0]);
    expect(world.getCell("chunk", [0, 0])).toBeUndefined();

    await world.update([0, 0, 0]);
    const after = world.getCell("chunk", [0, 0]);
    expect(after).toBeDefined();
    expect(outputsDiff(before?.outputs ?? {}, after?.outputs ?? {})).toBeNull();
  });
});

describe("graph.setSeed inside bind (sanctioned pattern)", () => {
  it("different viewpoint paths produce byte-identical cells", async () => {
    const a = makeWorld("setSeed");
    const b = makeWorld("setSeed");
    await a.update([-15, 0, 0]);
    await a.update([15, 0, 0]);
    await b.update([15, 0, 0]);
    await b.update([-15, 0, 0]);
    expectCellsIdentical(a, b, "chunk");

    const cells = a.cells("chunk");
    expect(speciesOf(cells[0].outputs)).not.toEqual(speciesOf(cells[1].outputs));
  });

  it("causes no phantom staleness: a repeat update recooks nothing", async () => {
    const world = makeWorld("setSeed");
    await world.update([0, 0, 0]);
    // bind's setSeed bumped the graph version, but the runtime re-baselines
    // after its own writes — the same viewpoint again must be all cache.
    const again = await world.update([0, 0, 0]);
    expect(again.cooked).toHaveLength(0);
    expect(again.pending).toBe(0);
  });
});

describe("geometryDiff string awareness", () => {
  it("sees differing string values behind identical table indices", () => {
    const a = createPointCloud(1);
    a.attrs.point.add("s", "string", 1, "x");
    const b = createPointCloud(1);
    b.attrs.point.add("s", "string", 1, "y");
    // Both store index 0; only the tables differ.
    expect(a.attrs.point.require("s").data[0]).toBe(b.attrs.point.require("s").data[0]);
    expect(geometryDiff(a, b)).toMatch(/point\.s\[0\]: "x" vs "y"/);
    const c = createPointCloud(1);
    c.attrs.point.add("s", "string", 1, "x");
    expect(geometryDiff(a, c)).toBeNull();
  });
});
