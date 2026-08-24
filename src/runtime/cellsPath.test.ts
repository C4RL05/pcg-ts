/**
 * `cellMode: "path"` cells: arc-length sectors along a curve, addressed
 * by one sector index, positioned by `UpdateOptions.anchors` rather than
 * by the viewpoint.
 *
 * Everything here runs on TWO NUMBERS — a table length and a closed flag
 * — because that is the whole of what the World needs to cut sectors. No
 * curve appears in this suite, deliberately: if a test needed one, the
 * runtime would have become content-aware.
 */
import { describe, expect, it } from "vitest";
import { Graph } from "../graph/index.js";
import { pointScatterInBounds } from "../nodes/sources.js";
import { hashCombine } from "../random/index.js";
import { childEchoLevel, coordKeys, outputsDiff, scatterLevel } from "./runtime.testsupport.js";
import type { CellContext, LevelDef } from "./types.js";
import { World, WorldValidationError } from "./world.js";

/** A 100-unit table cut into ten 10-unit sectors (0..9). */
function trackLevel(opts: {
  name?: string;
  closed: boolean;
  cellSize?: number;
  length?: number;
  generationRadius: number;
  retainRadius?: number;
  jitter?: boolean;
}): LevelDef {
  return scatterLevel({
    name: opts.name ?? "track",
    cellSize: opts.cellSize ?? 10,
    cellMode: "path",
    path: { length: opts.length ?? 100, closed: opts.closed },
    generationRadius: opts.generationRadius,
    retainRadius: opts.retainRadius,
    jitter: opts.jitter,
  }).def;
}

/** A level that only records the contexts it is handed. */
function recordingLevel(opts: {
  name: string;
  cellSize: number;
  length: number;
  closed: boolean;
  generationRadius: number;
  seen: CellContext[];
}): LevelDef {
  const graph = new Graph(1);
  const scatter = graph.add(pointScatterInBounds, {
    count: 2,
    boundsMin: [0, 0, 0],
    boundsMax: [10, 0, 10],
  });
  graph.output(scatter, "out", "points");
  return {
    name: opts.name,
    cellSize: opts.cellSize,
    cellMode: "path",
    path: { length: opts.length, closed: opts.closed },
    generationRadius: opts.generationRadius,
    retainRadius: 1e6,
    graph,
    bind(g, ctx) {
      opts.seen.push(ctx);
      g.setParam(scatter, "seed", ctx.seed);
    },
  };
}

describe("path wanted set", () => {
  it("cooks exactly the hand-computed wanted set on a straight table", async () => {
    // Ten 10-unit sectors, anchor 52, radius 15: the window [37, 67]
    // touches sectors 3..6, at arc distances 12, 2, 0 and 8.
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: false, generationRadius: 15 })],
    });
    const stats = await world.update([0, 0, 0], { anchors: { track: 52 } });
    expect(coordKeys(stats.cooked).sort()).toEqual(["3", "4", "5", "6"]);
    expect(stats.pending).toBe(0);
    expect(stats.evicted).toEqual([]);
  });

  it("cooks nearest-first along the track, with a deterministic sector tie-break", async () => {
    // Anchor exactly on the 40/50 boundary: sectors 4 and 5 are both at
    // arc distance 0 (the lower index wins), then 3 and 6 at 10 each.
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: false, generationRadius: 15 })],
    });
    const stats = await world.update([0, 0, 0], { anchors: { track: 50 } });
    expect(coordKeys(stats.cooked)).toEqual(["4", "5", "3", "6"]);
  });

  it("treats the seam as a hard boundary when the table is open", async () => {
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: false, generationRadius: 15 })],
    });
    // Anchor 5: the window reaches back past s = 0, and nothing is there.
    // Sector 2 sits exactly 15 away and is kept (the radius is inclusive).
    const near = await world.update([0, 0, 0], { anchors: { track: 5 } });
    expect(coordKeys(near.cooked)).toEqual(["0", "1", "2"]);

    // Anchor 95: the window runs past the end of the table, and sector 0
    // is 85 units away by arc length, not adjacent.
    const far = await world.update([0, 0, 0], { anchors: { track: 95 } });
    expect(coordKeys(far.cooked)).toEqual(["9", "8"]);
  });

  it("wraps across the seam when the table is closed", async () => {
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: true, generationRadius: 15 })],
    });
    // Anchor 5 on a closed table: sector 9 ends at the seam, so it is 5
    // units behind — tied with sector 1, and the tie-break orders by
    // sector index.
    const stats = await world.update([0, 0, 0], { anchors: { track: 5 } });
    expect(coordKeys(stats.cooked)).toEqual(["0", "1", "9", "2"]);
  });

  it("wants every sector exactly once when the window is a full lap", async () => {
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: true, generationRadius: 60 })],
    });
    const stats = await world.update([0, 0, 0], { anchors: { track: 0 } });
    expect(coordKeys(stats.cooked).sort()).toEqual(
      ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].sort(),
    );
    expect(world.cells("track")).toHaveLength(10);
  });

  it("wraps the anchor itself on a closed table", async () => {
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: true, generationRadius: 15 })],
    });
    // 105 is 5, one lap on: the same wanted set, in the same order.
    const stats = await world.update([0, 0, 0], { anchors: { track: 105 } });
    expect(coordKeys(stats.cooked)).toEqual(["0", "1", "9", "2"]);
  });

  it("rounds cellSize to whole sectors, so the seam lands exactly at s = 0", async () => {
    const seen: CellContext[] = [];
    const world = new World({
      seed: 1,
      levels: [
        recordingLevel({
          name: "track",
          cellSize: 30,
          length: 100,
          closed: true,
          generationRadius: 100,
          seen,
        }),
      ],
    });
    await world.update([0, 0, 0], { anchors: { track: 0 } });
    // round(100 / 30) = 3 sectors of 100/3 each, not three 30s plus a
    // 10-unit runt before the seam.
    expect(world.cells("track")).toHaveLength(3);
    const bounds = seen
      .map((ctx) => (ctx.cellMode === "path" ? ([ctx.coord[0], ctx.sMin, ctx.sMax] as const) : null))
      .filter((b): b is readonly [number, number, number] => b !== null)
      .sort((a, b) => a[0] - b[0]);
    expect(bounds[0][1]).toBe(0);
    expect(bounds[2][2]).toBe(100);
    expect(bounds[0][2]).toBe(bounds[1][1]);
    expect(bounds[1][2]).toBe(bounds[2][1]);
  });
});

describe("path retention", () => {
  it("keeps sectors inside the arc hysteresis band and evicts beyond it", async () => {
    const evictedLog: string[] = [];
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: false, generationRadius: 5, retainRadius: 20 })],
      onCellEvicted: (_level, coord) => evictedLog.push(String(coord[0])),
    });

    const first = await world.update([0, 0, 0], { anchors: { track: 25 } });
    expect(coordKeys(first.cooked)).toEqual(["2", "3"]);

    // Anchor 55: sector 2 ends 25 arc units back (outside retain 20),
    // sector 3 only 15 (inside) — one evicts, one is kept.
    const second = await world.update([0, 0, 0], { anchors: { track: 55 } });
    expect(coordKeys(second.cooked)).toEqual(["5", "6"]);
    expect(coordKeys(second.evicted)).toEqual(["2"]);
    expect(coordKeys(world.cells("track"))).toEqual(["3", "5", "6"]);

    // Anchor 85: sectors 3 (45 back) and 5 (25 back) exit retain, 6 (15)
    // stays.
    const third = await world.update([0, 0, 0], { anchors: { track: 85 } });
    expect(coordKeys(third.cooked)).toEqual(["8", "9"]);
    expect(coordKeys(third.evicted)).toEqual(["3", "5"]);
    expect(evictedLog).toEqual(["2", "3", "5"]);
    expect(coordKeys(world.cells("track"))).toEqual(["6", "8", "9"]);
  });

  it("retains across the seam on a closed table, by the same cyclic metric", async () => {
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: true, generationRadius: 4, retainRadius: 20 })],
    });
    const first = await world.update([0, 0, 0], { anchors: { track: 95 } });
    expect(coordKeys(first.cooked)).toEqual(["9"]);

    // Anchor 5 is 5 arc units past the seam: sector 9 is 5 behind, well
    // inside retain, and would have been 85 away without wrapping.
    const second = await world.update([0, 0, 0], { anchors: { track: 5 } });
    expect(coordKeys(second.cooked)).toEqual(["0"]);
    expect(second.evicted).toEqual([]);
    expect(coordKeys(world.cells("track"))).toEqual(["9", "0"]);
  });
});

describe("path per-cell seeds", () => {
  it("hashes the sector through the documented one-tuple chain", async () => {
    const seen: CellContext[] = [];
    const world = new World({
      seed: 7,
      levels: [
        recordingLevel({
          name: "track",
          cellSize: 10,
          length: 100,
          closed: false,
          generationRadius: 15,
          seen,
        }),
      ],
    });
    await world.update([0, 0, 0], { anchors: { track: 52 } });
    const seeds = new Map(seen.map((ctx) => [ctx.coord.join(","), ctx.seed]));

    // Exact chain: hashCombine(worldSeed, levelIndex, cs).
    expect(seeds.get("3")).toBe(hashCombine(7, 0, 3));
    expect(seeds.get("4")).toBe(hashCombine(7, 0, 4));
    expect(seeds.get("5")).toBe(hashCombine(7, 0, 5));
    expect(seeds.get("3")).not.toBe(seeds.get("4"));

    // The chain's length prefix keeps arities apart for free: the sector
    // chain never collides with the 2D or 3D chain at the same numbers.
    expect(hashCombine(7, 0, 3)).not.toBe(hashCombine(7, 0, 3, 0));
    expect(hashCombine(7, 0, 3)).not.toBe(hashCombine(7, 0, 3, 0, 0));
  });

  it("exposes the table's own facts on every cell context", async () => {
    const seen: CellContext[] = [];
    const world = new World({
      seed: 3,
      levels: [
        recordingLevel({
          name: "track",
          cellSize: 10,
          length: 100,
          closed: true,
          generationRadius: 2,
          seen,
        }),
      ],
    });
    await world.update([0, 0, 0], { anchors: { track: 33 } });
    expect(world.cells("track")).toHaveLength(1);
    const ctx = seen[0];
    expect(ctx.cellMode).toBe("path");
    if (ctx.cellMode !== "path") throw new Error("expected a path cell context");
    expect(ctx.coord).toEqual([3]);
    expect(ctx.sMin).toBe(30);
    expect(ctx.sMax).toBe(40);
    expect(ctx.pathLength).toBe(100);
    expect(ctx.closed).toBe(true);
    expect(ctx.levelSeed).toBe(hashCombine(3, 0));
    expect(ctx.worldSeed).toBe(3);
  });
});

describe("path nesting", () => {
  it("maps a child sector to the parent sector containing its arc midpoint", async () => {
    const table = { length: 100, closed: false };
    const parent = scatterLevel({
      name: "track",
      cellSize: 20,
      cellMode: "path",
      path: table,
      generationRadius: 30,
      retainRadius: 1000,
      count: 3,
    });
    const child = childEchoLevel({
      name: "dressing",
      cellSize: 5,
      cellMode: "path",
      path: table,
      generationRadius: 3,
      retainRadius: 1000,
    });
    const world = new World({ seed: 9, levels: [parent.def, child.def] });
    const stats = await world.update([0, 0, 0], {
      anchors: { track: 37.5, dressing: 37.5 },
    });
    expect(stats.pending).toBe(0);
    expect(coordKeys(stats.cooked.filter((c) => c.level === "dressing"))).toEqual(["7", "6", "8"]);

    // Sectors 6 ([30, 35)) and 7 ([35, 40)) have midpoints 32.5 and 37.5,
    // both inside parent sector 1 ([20, 40)); sector 8's midpoint 42.5
    // falls in parent sector 2.
    const p1 = world.getCell("track", [1])?.outputs.points;
    const p2 = world.getCell("track", [2])?.outputs.points;
    expect(world.getCell("dressing", [6])?.outputs.parentEcho[0]).toBe(p1?.[0]);
    expect(world.getCell("dressing", [7])?.outputs.parentEcho[0]).toBe(p1?.[0]);
    expect(world.getCell("dressing", [8])?.outputs.parentEcho[0]).toBe(p2?.[0]);
  });

  it("streams a path level under an unbounded parent from one update call", async () => {
    const world = new World({
      seed: 5,
      levels: [
        scatterLevel({ name: "planet", cellSize: "unbounded", count: 3 }).def,
        childEchoLevel({
          name: "track",
          cellSize: 10,
          cellMode: "path",
          path: { length: 100, closed: true },
          generationRadius: 4,
        }).def,
      ],
    });
    // One call: the world point drives the unbounded level, the anchor
    // drives the path level.
    const stats = await world.update([12, 0, -8], { anchors: { track: 25 } });
    expect(stats.cooked[0]).toEqual({ level: "planet", coord: [0, 0] });
    expect(coordKeys(stats.cooked.filter((c) => c.level === "track"))).toEqual(["2"]);
    expect(stats.pending).toBe(0);
    const planetPoints = world.getCell("planet", [0, 0])?.outputs.points;
    expect(world.getCell("track", [2])?.outputs.parentEcho[0]).toBe(planetPoints?.[0]);
  });
});

describe("path determinism", () => {
  function makeWorld(): World {
    return new World({
      seed: 42,
      levels: [trackLevel({ closed: true, generationRadius: 12, retainRadius: 1000, jitter: true })],
    });
  }

  it("different anchor paths produce byte-identical sectors", async () => {
    const a = makeWorld();
    const b = makeWorld();
    // A walks forward over the seam; B arrives from the other direction.
    await a.update([0, 0, 0], { anchors: { track: 5 } });
    await a.update([0, 0, 0], { anchors: { track: 55 } });
    await b.update([0, 0, 0], { anchors: { track: 55 } });
    await b.update([0, 0, 0], { anchors: { track: 105 } });

    const coordsA = coordKeys(a.cells("track")).sort();
    expect(coordsA).toEqual(coordKeys(b.cells("track")).sort());
    expect(coordsA).toHaveLength(6);
    for (const cell of a.cells("track")) {
      const other = b.getCell("track", cell.coord);
      expect(other, `sector ${cell.coord.join(",")} missing in B`).toBeDefined();
      expect(outputsDiff(cell.outputs, other?.outputs ?? {})).toBeNull();
    }
  });

  it("an evicted then regenerated sector is byte-identical", async () => {
    const world = new World({
      seed: 42,
      levels: [trackLevel({ closed: true, generationRadius: 5, retainRadius: 5, jitter: true })],
    });
    await world.update([0, 0, 0], { anchors: { track: 25 } });
    const before = world.getCell("track", [2])?.outputs;
    expect(before).toBeDefined();

    await world.update([0, 0, 0], { anchors: { track: 75 } });
    expect(world.getCell("track", [2])).toBeUndefined();

    await world.update([0, 0, 0], { anchors: { track: 25 } });
    const after = world.getCell("track", [2])?.outputs;
    expect(outputsDiff(before ?? {}, after ?? {})).toBeNull();
  });

  it("a partial cook resumes to the same bytes a whole one produces", async () => {
    const budgeted = new World({
      seed: 42,
      levels: [trackLevel({ closed: true, generationRadius: 12, retainRadius: 1000, jitter: true })],
    });
    const whole = makeWorld();
    const first = await budgeted.update([0, 0, 0], {
      anchors: { track: 5 },
      maxCooksPerUpdate: 1,
    });
    expect(coordKeys(first.cooked)).toEqual(["0"]);
    expect(first.pending).toBe(2);
    await budgeted.update([0, 0, 0], { anchors: { track: 5 } });
    await whole.update([0, 0, 0], { anchors: { track: 5 } });

    expect(coordKeys(budgeted.cells("track")).sort()).toEqual(
      coordKeys(whole.cells("track")).sort(),
    );
    for (const cell of whole.cells("track")) {
      const other = budgeted.getCell("track", cell.coord);
      expect(outputsDiff(cell.outputs, other?.outputs ?? {})).toBeNull();
    }
  });
});

describe("path validation", () => {
  it("requires a path table when cellMode is path, and states the fix", () => {
    const def = scatterLevel({ name: "track", cellSize: 10, generationRadius: 8 }).def;
    const bad: LevelDef = { ...def, cellMode: "path" };
    expect(() => new World({ seed: 1, levels: [bad] })).toThrow(WorldValidationError);
    expect(() => new World({ seed: 1, levels: [bad] })).toThrow(
      /level 0 \("track"\): cellMode "path" requires a path table; add path: \{ length: <total arc length of the centreline>, closed: true \| false \}/,
    );
  });

  it("refuses a path table on a level that partitions space", () => {
    const def = scatterLevel({ name: "chunk", cellSize: 10, generationRadius: 8 }).def;
    const bad: LevelDef = { ...def, path: { length: 100, closed: false } };
    expect(() => new World({ seed: 1, levels: [bad] })).toThrow(
      /level 0 \("chunk"\): has a path table but cellMode is "xz".*set cellMode: "path".*or remove the path field/,
    );
  });

  it("rejects a non-positive or non-finite path length", () => {
    const base = trackLevel({ closed: false, generationRadius: 8 });
    for (const length of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const bad: LevelDef = { ...base, path: { length, closed: false } };
      expect(() => new World({ seed: 1, levels: [bad] })).toThrow(
        /level 0 \("track"\): path\.length must be a positive finite number/,
      );
    }
  });

  it("rejects a non-boolean path.closed, saying what closed means", () => {
    const base = trackLevel({ closed: false, generationRadius: 8 });
    const bad: LevelDef = {
      ...base,
      path: { length: 100, closed: "yes" as unknown as boolean },
    };
    expect(() => new World({ seed: 1, levels: [bad] })).toThrow(
      /level 0 \("track"\): path\.closed must be a boolean.*adjacent to sector 0 across the s = 0 seam; got yes/,
    );
  });

  it("rejects a path level under a bounded square parent, naming both", () => {
    const levels = [
      scatterLevel({ name: "region", cellSize: 100, generationRadius: 80 }).def,
      scatterLevel({
        name: "dressing",
        cellSize: 10,
        cellMode: "path",
        path: { length: 100, closed: false },
        generationRadius: 8,
      }).def,
    ];
    expect(() => new World({ seed: 1, levels })).toThrow(WorldValidationError);
    expect(() => new World({ seed: 1, levels })).toThrow(
      /level 1 \("dressing"\) uses "path" cells under the "xz" parent "region": an arc sector is a tube along a curve, so no single square parent cell contains it; make the parent "path" with the same centreline, or make this level "xz"/,
    );
  });

  it("rejects a square level under a bounded path parent, naming both", () => {
    const levels = [
      trackLevel({ name: "track", closed: false, cellSize: 20, generationRadius: 30 }),
      scatterLevel({ name: "dressing", cellSize: 10, generationRadius: 8 }).def,
    ];
    expect(() => new World({ seed: 1, levels })).toThrow(
      /level 1 \("dressing"\) uses "xz" cells under the "path" parent "track": an arc sector is a tube along a curve, so it contains no whole square cell; make this level "path" with the same centreline, or make the parent "xz"/,
    );
  });

  it("rejects nested path levels that do not ride the same table", () => {
    const levels = [
      trackLevel({ name: "track", closed: false, cellSize: 20, generationRadius: 30 }),
      scatterLevel({
        name: "dressing",
        cellSize: 5,
        cellMode: "path",
        path: { length: 120, closed: false },
        generationRadius: 8,
      }).def,
    ];
    expect(() => new World({ seed: 1, levels })).toThrow(
      /level 1 \("dressing"\) declares path \{ length: 120, closed: false \} but its "path" parent "track" declares \{ length: 100, closed: false \}.*give both levels the same path table/,
    );
  });

  it("compares cellSize coarse-to-fine within a mode family, not across", () => {
    // Two path levels are comparable: 40 under 20 is out of order.
    const outOfOrder = [
      trackLevel({ name: "track", closed: false, cellSize: 20, generationRadius: 30 }),
      scatterLevel({
        name: "dressing",
        cellSize: 40,
        cellMode: "path",
        path: { length: 100, closed: false },
        generationRadius: 8,
      }).def,
    ];
    expect(() => new World({ seed: 1, levels: outOfOrder })).toThrow(
      /levels must be ordered coarse to fine: level 1 \("dressing"\) cellSize 40 \(arc length\) must be strictly smaller than "path" level "track" cellSize 20/,
    );

    // An arc length and a world length are not comparable, so a larger
    // arc cellSize under a smaller world one is refused for the REASON it
    // is actually wrong — the nesting — not by a meaningless comparison.
    const crossFamily = [
      scatterLevel({ name: "region", cellSize: 100, generationRadius: 80 }).def,
      scatterLevel({
        name: "dressing",
        cellSize: 500,
        cellMode: "path",
        path: { length: 5000, closed: false },
        generationRadius: 800,
      }).def,
    ];
    expect(() => new World({ seed: 1, levels: crossFamily })).toThrow(
      /uses "path" cells under the "xz" parent "region"/,
    );
  });

  it("rejects a coordinate arity mismatch in the accessors", async () => {
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: false, generationRadius: 15 })],
    });
    await world.update([0, 0, 0], { anchors: { track: 52 } });
    expect(() => world.getCell("track", [0, 0])).toThrow(
      /level "track" uses "path" cells addressed \[cs\] \(one sector index\); got a 2-component coordinate/,
    );
    expect(() => world.invalidate("track", [0, 0, 0])).toThrow(WorldValidationError);
    expect(world.getCell("track", [5])).toBeDefined();
  });
});

describe("anchor validation", () => {
  function pathWorld(): World {
    return new World({ seed: 1, levels: [trackLevel({ closed: false, generationRadius: 15 })] });
  }

  it("requires an anchor for every path level, showing the call that supplies it", async () => {
    await expect(pathWorld().update([0, 0, 0])).rejects.toThrow(
      /level 0 \("track"\) uses "path" cells and has no arc anchor: pass update\(viewpoint, \{ anchors: \{ "track": s \} \}\) with s the arc length along its centreline/,
    );
    await expect(pathWorld().update([0, 0, 0], { anchors: {} })).rejects.toThrow(
      WorldValidationError,
    );
  });

  it("rejects a non-finite anchor, naming the level", async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(pathWorld().update([0, 0, 0], { anchors: { track: bad } })).rejects.toThrow(
        /anchors\["track"\] must be a finite number \(an arc length along the level's centreline\)/,
      );
    }
  });

  it("rejects an anchor naming an unknown level, listing the levels", async () => {
    await expect(
      pathWorld().update([0, 0, 0], { anchors: { track: 5, trak: 5 } }),
    ).rejects.toThrow(/anchors names unknown level "trak"; levels: track/);
  });

  it("rejects an anchor on a level that follows the viewpoint", async () => {
    const world = new World({
      seed: 1,
      levels: [scatterLevel({ name: "chunk", cellSize: 10, generationRadius: 8 }).def],
    });
    await expect(world.update([0, 0, 0], { anchors: { chunk: 5 } })).rejects.toThrow(
      /anchors names level "chunk", which uses "xz" cells and follows the viewpoint.*drop this entry or give that level cellMode: "path"/,
    );
  });

  it("validates every anchor before any cell cooks", async () => {
    const world = new World({
      seed: 1,
      levels: [
        scatterLevel({ name: "planet", cellSize: "unbounded", count: 3 }).def,
        childEchoLevel({
          name: "track",
          cellSize: 10,
          cellMode: "path",
          path: { length: 100, closed: false },
          generationRadius: 5,
        }).def,
      ],
    });
    await expect(world.update([0, 0, 0])).rejects.toThrow(WorldValidationError);
    // The unbounded level is coarser and would otherwise have cooked
    // before the path level's missing anchor was noticed.
    expect(world.cells("planet")).toHaveLength(0);
  });
});
