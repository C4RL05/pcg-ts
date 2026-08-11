import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CookCancelledError, Graph, type NodeHandle } from "../graph/index.js";
import { jitterPoints, type JitterPointsParams } from "../nodes/pointOps.js";
import { pointScatterInBounds, type PointScatterInBoundsParams } from "../nodes/sources.js";
import { hashCombine } from "../random/index.js";
import { CookWorkerPool } from "../worker/pool.js";
import { bundleWorkerEntry, type BundledEntry } from "../worker/testSupport.js";
import { dataInput } from "./dataInput.js";
import { coordKeys, outputsDiff, scatterLevel } from "./testSupport.js";
import type { LevelDef, ParamPatch } from "./types.js";
import { World, WorldValidationError, type UpdateStats } from "./world.js";

let entry: BundledEntry;
let pool: CookWorkerPool;

beforeAll(async () => {
  entry = await bundleWorkerEntry();
  pool = new CookWorkerPool({ workers: 2, createWorker: entry.createWorker });
}, 120_000);

afterAll(async () => {
  await pool.close();
  entry.cleanup();
});

/** The bindPatches twin of testSupport's scatterLevel: same graph, same values, patch form. */
function patchScatterLevel(opts: {
  name: string;
  cellSize: number | "unbounded";
  generationRadius?: number;
  retainRadius?: number;
  count?: number;
  jitter?: boolean;
  /** Return the { patches, seed } form with this per-cell graph seed salt. */
  graphSeedSalt?: number;
}): {
  def: LevelDef;
  graph: Graph;
  scatter: NodeHandle<PointScatterInBoundsParams>;
  jitter?: NodeHandle<JitterPointsParams>;
} {
  const graph = new Graph(1);
  const scatter = graph.add(pointScatterInBounds, { count: opts.count ?? 4 });
  let jitter: NodeHandle<JitterPointsParams> | undefined;
  if (opts.jitter === true) {
    jitter = graph.add(jitterPoints, { amount: [0.5, 0, 0.5] });
    graph.connect(scatter, "out", jitter, "in");
    graph.output(jitter, "out", "points");
  } else {
    graph.output(scatter, "out", "points");
  }
  const unbounded = opts.cellSize === "unbounded";
  const def: LevelDef = {
    name: opts.name,
    cellSize: opts.cellSize,
    generationRadius: opts.generationRadius,
    retainRadius: opts.retainRadius,
    graph,
    bindPatches(ctx) {
      const patches: ParamPatch[] = [];
      if (unbounded) {
        patches.push(
          { node: scatter.id, param: "boundsMin", value: [0, 0, 0] },
          { node: scatter.id, param: "boundsMax", value: [100, 0, 100] },
        );
      } else {
        patches.push(
          { node: scatter.id, param: "boundsMin", value: [ctx.min[0], 0, ctx.min[1]] },
          { node: scatter.id, param: "boundsMax", value: [ctx.max[0], 0, ctx.max[1]] },
        );
      }
      patches.push({ node: scatter.id, param: "seed", value: ctx.seed });
      if (jitter !== undefined) {
        patches.push({ node: jitter.id, param: "seed", value: hashCombine(ctx.seed, 1) });
      }
      return opts.graphSeedSalt !== undefined
        ? { patches, seed: hashCombine(ctx.seed, opts.graphSeedSalt) }
        : patches;
    },
  };
  return { def, graph, scatter, jitter };
}

/** A bind level matching patchScatterLevel({ graphSeedSalt }) byte-for-byte. */
function bindScatterLevelWithSetSeed(opts: {
  name: string;
  cellSize: number;
  generationRadius: number;
  count?: number;
  graphSeedSalt: number;
}): { def: LevelDef; graph: Graph } {
  const graph = new Graph(1);
  const scatter = graph.add(pointScatterInBounds, { count: opts.count ?? 4 });
  graph.output(scatter, "out", "points");
  const def: LevelDef = {
    name: opts.name,
    cellSize: opts.cellSize,
    generationRadius: opts.generationRadius,
    graph,
    bind(g, ctx) {
      g.setParam(scatter, "boundsMin", [ctx.min[0], 0, ctx.min[1]]);
      g.setParam(scatter, "boundsMax", [ctx.max[0], 0, ctx.max[1]]);
      g.setParam(scatter, "seed", ctx.seed);
      g.setSeed(hashCombine(ctx.seed, opts.graphSeedSalt));
    },
  };
  return { def, graph };
}

const PATH: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [12, 0, 0],
  [25, 0, 6],
];

/** Drive a world along PATH, returning per-update stats. */
async function drive(world: World): Promise<UpdateStats[]> {
  const stats: UpdateStats[] = [];
  for (const vp of PATH) stats.push(await world.update(vp));
  return stats;
}

/** Assert two worlds streamed identically: order, evictions, and bytes. */
function expectWorldsEqual(
  a: { world: World; stats: readonly UpdateStats[] },
  b: { world: World; stats: readonly UpdateStats[] },
  levels: readonly string[],
): void {
  expect(a.stats.length).toBe(b.stats.length);
  for (let i = 0; i < a.stats.length; i++) {
    expect(coordKeys(b.stats[i].cooked)).toEqual(coordKeys(a.stats[i].cooked));
    expect(coordKeys(b.stats[i].evicted)).toEqual(coordKeys(a.stats[i].evicted));
    expect(b.stats[i].pending).toBe(a.stats[i].pending);
  }
  for (const level of levels) {
    const cellsA = a.world.cells(level);
    const cellsB = b.world.cells(level);
    expect(coordKeys(cellsB)).toEqual(coordKeys(cellsA));
    for (const cell of cellsA) {
      const other = b.world.getCell(level, cell.coord);
      expect(other).toBeDefined();
      expect(
        outputsDiff(cell.outputs, (other as NonNullable<typeof other>).outputs),
        `${level} ${cell.coord.join(",")}`,
      ).toBeNull();
    }
  }
}

describe("World with bindPatches", () => {
  it("cooks byte-identically to bind when no pool is configured (local fallback)", async () => {
    const bindWorld = new World({
      seed: 42,
      levels: [scatterLevel({ name: "l", cellSize: 10, generationRadius: 15, jitter: true }).def],
    });
    const patchWorld = new World({
      seed: 42,
      levels: [
        patchScatterLevel({ name: "l", cellSize: 10, generationRadius: 15, jitter: true }).def,
      ],
    });
    const a = { world: bindWorld, stats: await drive(bindWorld) };
    const b = { world: patchWorld, stats: await drive(patchWorld) };
    expect(a.stats[0].cooked.length).toBeGreaterThan(0);
    expectWorldsEqual(a, b, ["l"]);
  });

  it("streams cells through the pool byte-identical to the no-pool world", async () => {
    const bindWorld = new World({
      seed: 42,
      levels: [scatterLevel({ name: "l", cellSize: 10, generationRadius: 15, jitter: true }).def],
    });
    const pooledWorld = new World({
      seed: 42,
      levels: [
        patchScatterLevel({ name: "l", cellSize: 10, generationRadius: 15, jitter: true }).def,
      ],
      pool,
    });
    const a = { world: bindWorld, stats: await drive(bindWorld) };
    const b = { world: pooledWorld, stats: await drive(pooledWorld) };
    expect(a.stats.some((s) => s.evicted.length > 0)).toBe(true); // the path really streams
    expectWorldsEqual(a, b, ["l"]);
  });

  it("carries the { patches, seed } form through the pool like bind's setSeed", async () => {
    const bindWorld = new World({
      seed: 7,
      levels: [
        bindScatterLevelWithSetSeed({
          name: "l",
          cellSize: 10,
          generationRadius: 12,
          graphSeedSalt: 5,
        }).def,
      ],
    });
    const pooledWorld = new World({
      seed: 7,
      levels: [
        patchScatterLevel({ name: "l", cellSize: 10, generationRadius: 12, graphSeedSalt: 5 })
          .def,
      ],
      pool,
    });
    const a = { world: bindWorld, stats: await drive(bindWorld) };
    const b = { world: pooledWorld, stats: await drive(pooledWorld) };
    expectWorldsEqual(a, b, ["l"]);
  });

  it("mixes pooled and local levels: a bind child echoes pool-cooked parent outputs", async () => {
    const mkChild = (): { def: LevelDef } => {
      const graph = new Graph(2);
      const input = graph.add(dataInput);
      graph.output(input, "out", "parentEcho");
      const def: LevelDef = {
        name: "child",
        cellSize: 5,
        generationRadius: 8,
        graph,
        bind(g, ctx) {
          g.setParam(input, "items", ctx.parent?.outputs["points"] ?? []);
        },
      };
      return { def };
    };
    const mkWorld = (usePool: boolean): World =>
      new World({
        seed: 9,
        levels: [
          usePool
            ? patchScatterLevel({ name: "parent", cellSize: 10, generationRadius: 15 }).def
            : scatterLevel({ name: "parent", cellSize: 10, generationRadius: 15 }).def,
          mkChild().def,
        ],
        ...(usePool ? { pool } : {}),
      });
    const local = mkWorld(false);
    const pooled = mkWorld(true);
    const a = { world: local, stats: await drive(local) };
    const b = { world: pooled, stats: await drive(pooled) };
    expect(a.world.cells("child").length).toBeGreaterThan(0);
    expectWorldsEqual(a, b, ["parent", "child"]);
    // Coarse-before-fine held within each update.
    for (const s of b.stats) {
      const names = s.cooked.map((c) => c.level);
      const lastParent = names.lastIndexOf("parent");
      const firstChild = names.indexOf("child");
      if (lastParent >= 0 && firstChild >= 0) expect(lastParent).toBeLessThan(firstChild);
    }
  });

  it("recooks pooled cells after a user edit, matching the no-pool world", async () => {
    const mk = (): ReturnType<typeof patchScatterLevel> =>
      patchScatterLevel({ name: "l", cellSize: 10, generationRadius: 12 });
    const localLevel = mk();
    const pooledLevel = mk();
    const local = new World({ seed: 3, levels: [localLevel.def] });
    const pooled = new World({ seed: 3, levels: [pooledLevel.def], pool });
    await local.update([0, 0, 0]);
    await pooled.update([0, 0, 0]);
    // A user edit between updates: both worlds must detect it, recook,
    // and agree on the new bytes (the pool re-serializes the graph).
    localLevel.graph.setParam(localLevel.scatter, "count", 9);
    pooledLevel.graph.setParam(pooledLevel.scatter, "count", 9);
    const sa = await local.update([0, 0, 0]);
    const sb = await pooled.update([0, 0, 0]);
    expect(sa.cooked.length).toBeGreaterThan(0);
    expect(coordKeys(sb.cooked)).toEqual(coordKeys(sa.cooked));
    for (const cell of local.cells("l")) {
      const other = pooled.getCell("l", cell.coord);
      expect(outputsDiff(cell.outputs, (other as NonNullable<typeof other>).outputs)).toBeNull();
      // The edit is really in the bytes: 9 points per cell now.
      const item = cell.outputs["points"][0];
      expect(item.kind === "geometry" && item.geo.pointCount === 9).toBe(true);
    }
  });

  it("honors budgetMs 0 (dispatches nothing) and maxCooksPerUpdate on pooled levels", async () => {
    const world = new World({
      seed: 4,
      levels: [patchScatterLevel({ name: "l", cellSize: 10, generationRadius: 12 }).def],
      pool,
    });
    const none = await world.update([0, 0, 0], { budgetMs: 0 });
    expect(none.cooked.length).toBe(0);
    expect(none.pending).toBeGreaterThan(0);
    const capped = await world.update([0, 0, 0], { maxCooksPerUpdate: 2 });
    expect(capped.cooked.length).toBe(2);
    expect(capped.pending).toBeGreaterThan(0);
    const rest = await world.update([0, 0, 0]);
    expect(rest.pending).toBe(0);
  });

  it("rejects with CookCancelledError on an aborted signal and resumes next update", async () => {
    const level = patchScatterLevel({ name: "l", cellSize: 10, generationRadius: 12 });
    const world = new World({ seed: 5, levels: [level.def], pool });
    const controller = new AbortController();
    controller.abort();
    await expect(world.update([0, 0, 0], { signal: controller.signal })).rejects.toBeInstanceOf(
      CookCancelledError,
    );
    // Resumes cleanly, matching an undisturbed no-pool world.
    const reference = new World({
      seed: 5,
      levels: [patchScatterLevel({ name: "l", cellSize: 10, generationRadius: 12 }).def],
    });
    await reference.update([0, 0, 0]);
    const stats = await world.update([0, 0, 0]);
    expect(stats.cooked.length).toBeGreaterThan(0);
    for (const cell of reference.cells("l")) {
      const other = world.getCell("l", cell.coord);
      expect(outputsDiff(cell.outputs, (other as NonNullable<typeof other>).outputs)).toBeNull();
    }
  });

  it("refuses a level with both bind and bindPatches, or neither", () => {
    const both = patchScatterLevel({ name: "l", cellSize: 10, generationRadius: 12 });
    expect(
      () =>
        new World({
          seed: 1,
          levels: [{ ...both.def, bind: () => undefined } as unknown as LevelDef],
        }),
    ).toThrow(WorldValidationError);
    expect(
      () =>
        new World({
          seed: 1,
          levels: [{ ...both.def, bind: () => undefined } as unknown as LevelDef],
        }),
    ).toThrow(/both bind and bindPatches/);
    const neither = scatterLevel({ name: "l", cellSize: 10, generationRadius: 12 });
    const def = { ...neither.def } as { bind?: unknown };
    delete def.bind;
    expect(() => new World({ seed: 1, levels: [def as unknown as LevelDef] })).toThrow(
      /neither bind nor bindPatches/,
    );
  });
});
