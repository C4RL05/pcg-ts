/**
 * The halo contract, exercised through the real runtime.
 *
 * A cell DERIVES what lies outside it from world coordinates; it never
 * fetches it from a sibling. `World` exposes no sibling accessor and
 * neighbours are LRU-evictable, so a fetched halo could not be correct
 * anyway — these tests pin the positive half: a level built on
 * `pointScatterInWorld` reproduces, from inside one cell, exactly the
 * points a neighbouring cell owns, whether or not that neighbour exists.
 *
 * The plumbing under test is `CellContext.worldSeed` / `levelSeed`: a
 * cell-INVARIANT seed. The last test is the negative control — binding
 * the per-cell `ctx.seed` instead turns the same graph back into an
 * unanchored per-cell scatter, and every property here fails.
 */
import { describe, expect, it } from "vitest";
import type { Geometry } from "../data/index.js";
import { Graph, cook } from "../graph/index.js";
import { pointScatterInWorld } from "../nodes/sources.js";
import type { CellContext, CellOutputs, LevelDef } from "./types.js";
import { World } from "./world.js";

const WORLD_SEED = 4242;
const CELL_SIZE = 16;
/** The node's own lattice spacing — deliberately NOT the level's cellSize. */
const LATTICE = 3;
const DENSITY = 0.08;

/** One emitted point, flattened for order- and byte-exact comparison. */
interface Pt {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly seed: number;
}

function pointsOf(geo: Geometry): Pt[] {
  const P = geo.attrs.point.require("P");
  const s = geo.attrs.point.require("seed");
  const out: Pt[] = [];
  for (let i = 0; i < geo.pointCount; i++) {
    out.push({ x: P.get(i, 0), y: P.get(i, 1), z: P.get(i, 2), seed: s.get(i) });
  }
  return out;
}

function pointsIn(outputs: CellOutputs, name: string): Pt[] {
  const out: Pt[] = [];
  for (const item of outputs[name] ?? []) {
    if (item.kind === "geometry") out.push(...pointsOf(item.geo));
  }
  return out;
}

const keyOf = (p: Pt): string => `${p.x},${p.y},${p.z},${p.seed}`;
const sortedKeys = (pts: readonly Pt[]): string[] => pts.map(keyOf).sort();

/** How a level seeds the world-anchored source. */
type SeedMode = "worldSeed" | "levelSeed" | "cellSeed";

/**
 * A level whose whole content is one world-anchored scatter. Bind writes
 * the cell's window and a seed chosen by `mode`; `haloWidth` widens the
 * window on every side, which is the only thing a halo ever is here.
 */
function anchoredLevel(opts: {
  name: string;
  cellSize: number;
  generationRadius: number;
  mode: SeedMode;
  haloWidth?: number;
}): LevelDef {
  const graph = new Graph(1);
  const scatter = graph.add(pointScatterInWorld, {
    density: DENSITY,
    cellSize: LATTICE,
    latticeMode: "xz",
    height: 0,
  });
  graph.output(scatter, "out", "points");
  const halo = opts.haloWidth ?? 0;
  return {
    name: opts.name,
    cellSize: opts.cellSize,
    generationRadius: opts.generationRadius,
    graph,
    bind(g, ctx: CellContext) {
      if (ctx.cellMode !== "xz") throw new Error("expected an xz level");
      g.setParam(scatter, "boundsMin", [ctx.min[0] - halo, 0, ctx.min[1] - halo]);
      g.setParam(scatter, "boundsMax", [ctx.max[0] + halo, 0, ctx.max[1] + halo]);
      g.setParam(
        scatter,
        "seed",
        opts.mode === "worldSeed"
          ? ctx.worldSeed
          : opts.mode === "levelSeed"
            ? ctx.levelSeed
            : ctx.seed,
      );
    },
  };
}

/** The same scatter cooked once over an arbitrary window, outside any World. */
async function wholeRegion(
  seed: number,
  min: readonly [number, number],
  max: readonly [number, number],
): Promise<Pt[]> {
  const graph = new Graph(1);
  const scatter = graph.add(pointScatterInWorld, {
    density: DENSITY,
    cellSize: LATTICE,
    latticeMode: "xz",
    height: 0,
    boundsMin: [min[0], 0, min[1]],
    boundsMax: [max[0], 0, max[1]],
    seed,
  });
  graph.output(scatter, "out", "points");
  const result = await cook(graph);
  return pointsIn(result.outputs, "points");
}

describe("CellContext cell-invariant seeds", () => {
  it("exposes the world seed and a per-level seed alongside the per-cell one", async () => {
    const seen: CellContext[] = [];
    // One Graph per level: the World rejects sharing (staleness is tracked
    // per level), which is unrelated to what this test is about.
    const level = (name: string, cellSize: number | "unbounded"): LevelDef => {
      const graph = new Graph(1);
      graph.output(graph.add(pointScatterInWorld, { boundsMax: [1, 0, 1] }), "out", "points");
      return {
        name,
        cellSize,
        generationRadius: 24,
        graph,
        bind(_g, ctx) {
          seen.push(ctx);
        },
      };
    };
    const world = new World({
      seed: WORLD_SEED,
      levels: [level("top", "unbounded"), level("mid", 32), level("fine", CELL_SIZE)],
    });
    await world.update([0, 0, 0]);

    expect(seen.length).toBeGreaterThan(4);
    // The world seed is the configured one, in every cell of every level.
    expect(new Set(seen.map((c) => c.worldSeed))).toEqual(new Set([WORLD_SEED]));
    // The level seed is constant within a level and distinct between them.
    const byLevel = new Map<string, Set<number>>();
    for (const ctx of seen) {
      const set = byLevel.get(ctx.levelName) ?? new Set<number>();
      set.add(ctx.levelSeed);
      byLevel.set(ctx.levelName, set);
    }
    expect([...byLevel.values()].map((s) => s.size)).toEqual([1, 1, 1]);
    const levelSeeds = [...byLevel.values()].map((s) => [...s][0]);
    expect(new Set(levelSeeds).size).toBe(3);
    // The per-cell seed still varies per cell, and for the unbounded level
    // — which has no coordinates to fold — it IS the level seed.
    const fine = seen.filter((c) => c.levelName === "fine");
    expect(new Set(fine.map((c) => c.seed)).size).toBe(fine.length);
    const top = seen.filter((c) => c.levelName === "top");
    expect(top.every((c) => c.seed === c.levelSeed)).toBe(true);
    expect(top.every((c) => c.seed !== c.worldSeed)).toBe(true);
  });
});

describe("world-anchored level", () => {
  it("cooks in cells to exactly what the region cooks as one piece", async () => {
    // Split-equals-whole through the runtime: every cell binds only its
    // own window, and the union is the single-query result — same points,
    // same per-point seeds, each exactly once.
    const world = new World({
      seed: WORLD_SEED,
      levels: [anchoredLevel({ name: "ground", cellSize: CELL_SIZE, generationRadius: 30, mode: "worldSeed" })],
    });
    await world.update([0, 0, 0]);
    const cells = world.cells("ground");
    expect(cells.length).toBeGreaterThan(8);

    const fromCells: Pt[] = [];
    let lo = Infinity;
    let hi = -Infinity;
    for (const cell of cells) {
      fromCells.push(...pointsIn(cell.outputs, "points"));
      for (const c of cell.coord) {
        lo = Math.min(lo, c * CELL_SIZE);
        hi = Math.max(hi, (c + 1) * CELL_SIZE);
      }
    }
    // The wanted set is a disc, so compare over a box strictly inside it
    // rather than over the ragged union.
    const box = { min: lo / 2, max: hi / 2 };
    const inBox = (p: Pt): boolean =>
      p.x >= box.min && p.x < box.max && p.z >= box.min && p.z < box.max;
    const whole = await wholeRegion(WORLD_SEED, [box.min, box.min], [box.max, box.max]);
    expect(whole.length).toBeGreaterThan(20);
    expect(sortedKeys(fromCells.filter(inBox))).toEqual(sortedKeys(whole));
  });

  it("derives a halo from world coordinates, matching a neighbour that never cooked", async () => {
    // One cell, cooked alone, with a halo two lattice cells wide. Its halo
    // ring must equal what the neighbouring cells own — and the world is
    // configured so those neighbours are outside the generation radius and
    // never cook at all, which is the whole point: nothing was fetched.
    const halo = LATTICE * 2;
    const world = new World({
      seed: WORLD_SEED,
      levels: [
        anchoredLevel({
          name: "ground",
          cellSize: CELL_SIZE,
          generationRadius: 1,
          mode: "worldSeed",
          haloWidth: halo,
        }),
      ],
    });
    // A viewpoint at a cell centre wants that cell only (radius 1).
    await world.update([CELL_SIZE / 2, 0, CELL_SIZE / 2]);
    const cells = world.cells("ground");
    expect(cells.map((c) => c.coord.join(","))).toEqual(["0,0"]);

    const withHalo = pointsIn(cells[0].outputs, "points");
    const interior = (p: Pt): boolean =>
      p.x >= 0 && p.x < CELL_SIZE && p.z >= 0 && p.z < CELL_SIZE;
    const ring = withHalo.filter((p) => !interior(p));
    expect(ring.length).toBeGreaterThan(5);
    // The ring, re-derived independently over the same annulus.
    const expected = (
      await wholeRegion(
        WORLD_SEED,
        [-halo, -halo],
        [CELL_SIZE + halo, CELL_SIZE + halo],
      )
    ).filter((p) => !interior(p));
    expect(sortedKeys(ring)).toEqual(sortedKeys(expected));
    // And the cell's own content is unaffected by having asked for a halo.
    const bare = await wholeRegion(WORLD_SEED, [0, 0], [CELL_SIZE, CELL_SIZE]);
    expect(withHalo.filter(interior)).toEqual(bare);
  });

  it("keeps cell content identical across cook order, eviction, and recook", async () => {
    // Same world, two viewpoint paths that cook the cells in different
    // orders and evict some in between. Anchored content cannot notice.
    const build = (): World =>
      new World({
        seed: WORLD_SEED,
        levels: [
          anchoredLevel({
            name: "ground",
            cellSize: CELL_SIZE,
            generationRadius: 20,
            mode: "worldSeed",
          }),
        ],
        maxCellsPerLevel: 4,
      });
    const a = build();
    await a.update([0, 0, 0]);
    const direct = new Map(
      a.cells("ground").map((c) => [c.coord.join(","), sortedKeys(pointsIn(c.outputs, "points"))]),
    );

    const b = build();
    await b.update([200, 0, 200]);
    await b.update([-200, 0, -200]);
    await b.update([0, 0, 0]);
    const roundabout = new Map(
      b.cells("ground").map((c) => [c.coord.join(","), sortedKeys(pointsIn(c.outputs, "points"))]),
    );

    expect([...roundabout.keys()].sort()).toEqual([...direct.keys()].sort());
    for (const [key, pts] of direct) expect(roundabout.get(key), key).toEqual(pts);
  });

  it("gives two levels running the same graph identical content from worldSeed and unrelated content from levelSeed", async () => {
    // Why both anchors exist. worldSeed is the anchor two levels must
    // share to agree; levelSeed is the anchor they use to differ while
    // each stays seamless within itself.
    const shared = new World({
      seed: WORLD_SEED,
      levels: [
        anchoredLevel({ name: "coarse", cellSize: 32, generationRadius: 80, mode: "worldSeed" }),
        anchoredLevel({ name: "fine", cellSize: CELL_SIZE, generationRadius: 60, mode: "worldSeed" }),
      ],
    });
    await shared.update([0, 0, 0]);
    const gather = (w: World, name: string): Pt[] => {
      const out: Pt[] = [];
      for (const cell of w.cells(name)) out.push(...pointsIn(cell.outputs, "points"));
      return out;
    };
    const inCore = (p: Pt): boolean => p.x >= 0 && p.x < 16 && p.z >= 0 && p.z < 16;
    const coarseCore = gather(shared, "coarse").filter(inCore);
    expect(coarseCore.length).toBeGreaterThan(5);
    expect(sortedKeys(gather(shared, "fine").filter(inCore))).toEqual(sortedKeys(coarseCore));

    const split = new World({
      seed: WORLD_SEED,
      levels: [
        anchoredLevel({ name: "coarse", cellSize: 32, generationRadius: 80, mode: "levelSeed" }),
        anchoredLevel({ name: "fine", cellSize: CELL_SIZE, generationRadius: 60, mode: "levelSeed" }),
      ],
    });
    await split.update([0, 0, 0]);
    const splitCoarse = new Set(sortedKeys(gather(split, "coarse").filter(inCore)));
    const splitFine = sortedKeys(gather(split, "fine").filter(inCore));
    expect(splitFine.length).toBeGreaterThan(5);
    expect(splitFine.filter((k) => splitCoarse.has(k))).toEqual([]);
  });

  it("loses anchoring the moment the per-cell seed is bound instead", async () => {
    // The negative control. Identical graph, identical windows; only the
    // seed changes from cell-invariant to per-cell, and the halo stops
    // reproducing the neighbour. If this ever passes, worldSeed/levelSeed
    // are no longer load-bearing and the tests above prove nothing.
    const halo = LATTICE * 2;
    const world = new World({
      seed: WORLD_SEED,
      levels: [
        anchoredLevel({
          name: "ground",
          cellSize: CELL_SIZE,
          generationRadius: 30,
          mode: "cellSeed",
          haloWidth: halo,
        }),
      ],
    });
    await world.update([0, 0, 0]);
    const byCoord = new Map(
      world.cells("ground").map((c) => [c.coord.join(","), pointsIn(c.outputs, "points")]),
    );
    const own = byCoord.get("1,0");
    const neighbour = byCoord.get("0,0");
    expect(own).toBeDefined();
    expect(neighbour).toBeDefined();
    // The strip of cell (0,0) that cell (1,0)'s halo reaches into.
    const strip = (p: Pt): boolean => p.x >= CELL_SIZE - halo && p.x < CELL_SIZE;
    const fromHalo = sortedKeys((own ?? []).filter(strip));
    const fromOwner = sortedKeys((neighbour ?? []).filter(strip));
    expect(fromHalo.length).toBeGreaterThan(0);
    expect(fromOwner.length).toBeGreaterThan(0);
    expect(fromHalo).not.toEqual(fromOwner);
  });
});
