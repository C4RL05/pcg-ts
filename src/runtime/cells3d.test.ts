/**
 * 3D ("xyz") grid cells: cube addressing, the XYZ distance metric for
 * generation/retention, three-coordinate per-cell seed hashing (with the
 * 2D chain locked byte-identical), nesting across modes, and the same
 * determinism guarantees the 2D suites prove (cook-order independence,
 * eviction/regeneration byte-identity, seam independence at cube
 * borders).
 */
import { describe, expect, it } from "vitest";
import { Graph, firstGeometry } from "../graph/index.js";
import { pointScatterInBounds } from "../nodes/sources.js";
import { hashCombine } from "../random/index.js";
import { childEchoLevel, coordKeys, outputsDiff, scatterLevel } from "./testSupport.js";
import type { CellCoord, LevelDef } from "./types.js";
import { World, WorldValidationError } from "./world.js";

function storedCoords(world: World, level: string): string[] {
  return coordKeys(world.cells(level)).sort();
}

describe("3D wanted set and distance metric", () => {
  it("wants exactly the cubes whose centers lie within the XYZ radius", async () => {
    // cellSize 10, viewpoint origin: the eight candidate centers sit at
    // (+-5, +-5, +-5), dist^2 = 75. Radius 9 (81) wants all eight...
    const world = new World({
      seed: 1,
      levels: [
        scatterLevel({ name: "vox", cellSize: 10, generationRadius: 9, cellMode: "xyz" }).def,
      ],
    });
    const stats = await world.update([0, 0, 0]);
    expect(coordKeys(stats.cooked).sort()).toEqual(
      [
        "-1,-1,-1",
        "-1,-1,0",
        "-1,0,-1",
        "-1,0,0",
        "0,-1,-1",
        "0,-1,0",
        "0,0,-1",
        "0,0,0",
      ].sort(),
    );
    expect(stats.pending).toBe(0);
    for (const cell of world.cells("vox")) {
      expect(firstGeometry(cell.outputs.points)?.attrs.point.count).toBe(4);
    }

    // ...while radius 8 (64 < 75) wants none — the same radius that wants
    // four cells in 2D, so the Y term demonstrably enters the metric.
    const tight = new World({
      seed: 1,
      levels: [
        scatterLevel({ name: "vox", cellSize: 10, generationRadius: 8, cellMode: "xyz" }).def,
      ],
    });
    const none = await tight.update([0, 0, 0]);
    expect(none.cooked).toEqual([]);
  });

  it("cooks nearest-first with a deterministic (cx, cy, cz) tie-break", async () => {
    // Viewpoint (1,1,1): dist^2 to the eight centers — 48; 68 x3 (tie
    // broken cx, then cy, then cz); 88 x3; 108.
    const world = new World({
      seed: 1,
      levels: [
        scatterLevel({ name: "vox", cellSize: 10, generationRadius: 14, cellMode: "xyz" }).def,
      ],
    });
    const stats = await world.update([1, 1, 1]);
    expect(coordKeys(stats.cooked)).toEqual([
      "0,0,0",
      "-1,0,0",
      "0,-1,0",
      "0,0,-1",
      "-1,-1,0",
      "-1,0,-1",
      "0,-1,-1",
      "-1,-1,-1",
    ]);
  });

  it("enters, retains, and exits cells along Y with the usual hysteresis", async () => {
    const world = new World({
      seed: 1,
      levels: [
        scatterLevel({
          name: "vox",
          cellSize: 10,
          generationRadius: 9,
          retainRadius: 12,
          cellMode: "xyz",
        }).def,
      ],
    });
    const first = await world.update([0, 0, 0]);
    expect(first.cooked).toHaveLength(8);

    // Rise a little: the cy=-1 layer (dist^2 114) leaves the generation
    // radius (81) but stays inside retain (144) — nothing cooks or evicts.
    const mid = await world.update([0, 3, 0]);
    expect(mid.cooked).toEqual([]);
    expect(mid.evicted).toEqual([]);
    expect(world.cells("vox")).toHaveLength(8);

    // Far up in Y only: every old cell exits retain; a fresh 2x2x2 block
    // cooks around y=30 (cy 2..3).
    const far = await world.update([0, 30, 0]);
    expect(far.evicted).toHaveLength(8);
    expect(far.cooked).toHaveLength(8);
    for (const cell of world.cells("vox")) {
      expect([2, 3]).toContain(cell.coord[1]);
    }
  });
});

describe("3D per-cell seeds", () => {
  /** Fixed-bounds level so cell content varies only through ctx.seed. */
  function fixedBoundsLevel(seeds: Map<string, number>): LevelDef {
    const graph = new Graph(1);
    const scatter = graph.add(pointScatterInBounds, {
      count: 5,
      boundsMin: [0, 0, 0],
      boundsMax: [10, 10, 10],
    });
    graph.output(scatter, "out", "points");
    return {
      name: "vox",
      cellSize: 10,
      cellMode: "xyz",
      generationRadius: 15,
      retainRadius: 1000,
      graph,
      bind(g, ctx) {
        seeds.set(ctx.coord.join(","), ctx.seed);
        g.setParam(scatter, "seed", ctx.seed);
      },
    };
  }

  it("hashes all three coords through the documented chain and differs across Y layers", async () => {
    const seeds = new Map<string, number>();
    const world = new World({ seed: 2, levels: [fixedBoundsLevel(seeds)] });
    await world.update([5, 5, 5]);

    // Exact chain: hashCombine(worldSeed, levelIndex, cx, cy, cz).
    expect(seeds.get("0,0,0")).toBe(hashCombine(2, 0, 0, 0, 0));
    expect(seeds.get("0,1,0")).toBe(hashCombine(2, 0, 0, 1, 0));
    expect(seeds.get("0,-1,0")).toBe(hashCombine(2, 0, 0, -1, 0));

    // Y alone separates seeds — and, with fixed bounds, the content.
    expect(seeds.get("0,0,0")).not.toBe(seeds.get("0,1,0"));
    expect(seeds.get("0,0,0")).not.toBe(seeds.get("0,-1,0"));
    expect(seeds.get("0,1,0")).not.toBe(seeds.get("0,-1,0"));
    const at = (c: CellCoord) => world.getCell("vox", c)?.outputs ?? {};
    expect(outputsDiff(at([0, 0, 0]), at([0, 1, 0]))).not.toBeNull();
  });

  it("keeps the 2D chain byte-identical: hashCombine(worldSeed, levelIndex, cx, cz)", async () => {
    const seeds = new Map<string, number>();
    const graph = new Graph(1);
    const scatter = graph.add(pointScatterInBounds, { count: 1 });
    graph.output(scatter, "out", "points");
    const level: LevelDef = {
      name: "chunk",
      cellSize: 10,
      generationRadius: 8,
      graph,
      bind(g, ctx) {
        seeds.set(ctx.coord.join(","), ctx.seed);
        g.setParam(scatter, "seed", ctx.seed);
      },
    };
    const world = new World({ seed: 42, levels: [level] });
    await world.update([0, 0, 0]);
    expect(seeds.get("0,0")).toBe(hashCombine(42, 0, 0, 0));
    expect(seeds.get("-1,0")).toBe(hashCombine(42, 0, -1, 0));
    expect(seeds.get("0,-1")).toBe(hashCombine(42, 0, 0, -1));
    expect(seeds.get("-1,-1")).toBe(hashCombine(42, 0, -1, -1));
  });
});

describe("3D determinism", () => {
  /** Unbounded planet above a jittered 3D voxel level. */
  function makeWorld3(): World {
    return new World({
      seed: 42,
      levels: [
        scatterLevel({ name: "planet", cellSize: "unbounded", generationRadius: 1, count: 3 }).def,
        scatterLevel({
          name: "vox",
          cellSize: 10,
          cellMode: "xyz",
          generationRadius: 12,
          retainRadius: 1000,
          jitter: true,
        }).def,
      ],
    });
  }

  it("different viewpoint paths (including Y motion) produce byte-identical cells", async () => {
    const a = makeWorld3();
    const b = makeWorld3();
    await a.update([-15, -6, 0]);
    await a.update([15, 6, 0]);
    await b.update([15, 6, 0]);
    await b.update([-15, -6, 0]);

    expect(storedCoords(a, "vox")).toEqual(storedCoords(b, "vox"));
    expect(storedCoords(a, "vox").length).toBeGreaterThan(4);
    for (const cell of a.cells("vox")) {
      const other = b.getCell("vox", cell.coord);
      expect(other, `cell ${cell.coord.join(",")} missing in B`).toBeDefined();
      expect(outputsDiff(cell.outputs, other?.outputs ?? {})).toBeNull();
    }
  });

  it("an evicted then regenerated cube is byte-identical", async () => {
    const world = new World({
      seed: 42,
      levels: [
        scatterLevel({
          name: "vox",
          cellSize: 10,
          cellMode: "xyz",
          generationRadius: 9,
          retainRadius: 9,
          jitter: true,
        }).def,
      ],
    });
    await world.update([0, 0, 0]);
    const before = world.getCell("vox", [0, 0, 0]);
    expect(before).toBeDefined();

    const away = await world.update([200, 200, 0]);
    expect(coordKeys(away.evicted)).toContain("0,0,0");
    expect(world.getCell("vox", [0, 0, 0])).toBeUndefined();

    await world.update([0, 0, 0]);
    const after = world.getCell("vox", [0, 0, 0]);
    expect(after).toBeDefined();
    // Fresh cook (new item objects), identical bytes.
    expect(after?.outputs.points[0]).not.toBe(before?.outputs.points[0]);
    expect(outputsDiff(before?.outputs ?? {}, after?.outputs ?? {})).toBeNull();
  });

  it("a cube's content is independent of which neighbours exist (seam determinism)", async () => {
    const make = () =>
      new World({
        seed: 4,
        levels: [
          scatterLevel({
            name: "vox",
            cellSize: 10,
            cellMode: "xyz",
            generationRadius: 9,
            retainRadius: 1000,
            jitter: true,
          }).def,
        ],
      });
    // A generates (0,0,0) with all seven sibling cubes; B generates it
    // alone. Content at the shared borders cannot differ.
    const a = make();
    await a.update([0, 0, 0]);
    expect(a.cells("vox")).toHaveLength(8);
    const b = make();
    await b.update([4, 4, 4]);
    expect(coordKeys(b.cells("vox"))).toEqual(["0,0,0"]);
    expect(
      outputsDiff(
        a.getCell("vox", [0, 0, 0])?.outputs ?? {},
        b.getCell("vox", [0, 0, 0])?.outputs ?? {},
      ),
    ).toBeNull();
  });
});

describe("3D nesting", () => {
  it("a 3D child under a 3D parent maps to the containing cube, and recooks cascade", async () => {
    const region = scatterLevel({
      name: "region",
      cellSize: 20,
      cellMode: "xyz",
      generationRadius: 18,
      retainRadius: 1000,
      count: 3,
    });
    const chunk = childEchoLevel({
      name: "chunk",
      cellSize: 10,
      cellMode: "xyz",
      generationRadius: 9,
      retainRadius: 1000,
    });
    const world = new World({ seed: 9, levels: [region.def, chunk.def] });
    const stats = await world.update([15, 15, 15]);
    expect(stats.cooked[0].level).toBe("region");
    expect(stats.pending).toBe(0);

    // Chunk (1,1,1) center (15,15,15) lies in region cube (0,0,0): the
    // echo aliases exactly that parent's items.
    const regionPoints = world.getCell("region", [0, 0, 0])?.outputs.points;
    expect(regionPoints).toHaveLength(1);
    const echo = world.getCell("chunk", [1, 1, 1]);
    expect(echo?.outputs.parentEcho[0]).toBe(regionPoints?.[0]);
    expect(firstGeometry(echo?.outputs.parentEcho ?? [])?.attrs.point.count).toBe(3);

    // Recooking the parent cascades to its stored 3D children.
    region.graph.setParam(region.scatter, "count", 5);
    await world.update([15, 15, 15]);
    const after = world.getCell("chunk", [1, 1, 1]);
    expect(firstGeometry(after?.outputs.parentEcho ?? [])?.attrs.point.count).toBe(5);
  });

  it("a 3D child under a 2D parent maps to the XZ column cell", async () => {
    const region = scatterLevel({
      name: "region",
      cellSize: 20,
      generationRadius: 8,
      retainRadius: 1000,
    });
    const chunk = childEchoLevel({
      name: "chunk",
      cellSize: 10,
      cellMode: "xyz",
      generationRadius: 9,
      retainRadius: 1000,
    });
    const world = new World({ seed: 9, levels: [region.def, chunk.def] });
    // Viewpoint high above the region cell: the chunk cube (1,2,1) is
    // wanted, and its parent is the 2D column (0,0) regardless of cy.
    const stats = await world.update([15, 25, 15]);
    expect(stats.cooked).toEqual([
      { level: "region", coord: [0, 0] },
      { level: "chunk", coord: [1, 2, 1] },
    ]);
    const regionPoints = world.getCell("region", [0, 0])?.outputs.points;
    const echo = world.getCell("chunk", [1, 2, 1]);
    expect(echo?.outputs.parentEcho[0]).toBe(regionPoints?.[0]);
  });

  it("rejects a 2D level under a 3D bounded parent with an actionable error", () => {
    const levels = [
      scatterLevel({ name: "region", cellSize: 20, cellMode: "xyz", generationRadius: 8 }).def,
      scatterLevel({ name: "chunk", cellSize: 10, generationRadius: 8 }).def,
    ];
    expect(() => new World({ seed: 1, levels })).toThrow(WorldValidationError);
    expect(() => new World({ seed: 1, levels })).toThrow(
      /level 1 \("chunk"\) uses 2D "xz" cells under the 3D "xyz" parent "region".*set the parent's cellMode to "xz" or this level's to "xyz"/,
    );
  });
});

describe("3D validation and accessors", () => {
  it("rejects an invalid cellMode, naming the valid alternatives", () => {
    const def = scatterLevel({ name: "vox", cellSize: 10, generationRadius: 8 }).def;
    const bad = { ...def, cellMode: "diagonal" as never };
    expect(() => new World({ seed: 1, levels: [bad] })).toThrow(
      /cellMode must be "xz" or "xyz", got diagonal/,
    );
  });

  it("rejects coordinate arity mismatches in accessors, naming the expected shape", async () => {
    const world3 = new World({
      seed: 1,
      levels: [
        scatterLevel({ name: "vox", cellSize: 10, generationRadius: 9, cellMode: "xyz" }).def,
      ],
    });
    expect(() => world3.getCell("vox", [0, 0])).toThrow(
      /level "vox" uses 3D "xyz" cells addressed \[cx, cy, cz\]; got a 2-component coordinate/,
    );
    expect(() => world3.invalidate("vox", [0, 0])).toThrow(WorldValidationError);

    const world2 = new World({
      seed: 1,
      levels: [scatterLevel({ name: "chunk", cellSize: 10, generationRadius: 8 }).def],
    });
    expect(() => world2.getCell("chunk", [0, 0, 0])).toThrow(
      /level "chunk" uses 2D "xz" cells addressed \[cx, cz\]; got a 3-component coordinate/,
    );
  });
});
