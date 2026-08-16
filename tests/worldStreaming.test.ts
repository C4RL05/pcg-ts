/**
 * A SERIALIZED graph, streamed by a `World`, partitioned in SPACE and in
 * TIME at once.
 *
 * Everything already in the tree covers one axis of that and stops:
 *
 * - `src/runtime/determinism.test.ts` pins cook-order independence,
 *   concurrent updates, and evict-then-regenerate — over a level graph
 *   built in TypeScript by `scatterLevel`, with no budget anywhere.
 * - `src/runtime/worldAnchored.test.ts` pins the halo contract (split
 *   equals whole, a halo derived from world coordinates, a per-cell
 *   reseed that cannot reach the lattice) — again over a hand-built
 *   graph, and again unbudgeted.
 * - `tests/crossPartition.test.ts` partitions in SPACE only, and says so
 *   at its head: "NO `budgetMs` ANYWHERE HERE, deliberately … These
 *   suites partition in SPACE."
 * - `tests/graphs.test.ts` partitions in TIME only: it cooks every corpus
 *   graph unbudgeted and again at `budgetMs: 0` and compares. One cook,
 *   no `World`.
 * - `src/runtime/streaming.test.ts` drives `budgetMs` through a `World`
 *   but asserts LIFECYCLE (what cooks, what is left pending), never that
 *   the bytes came out the same.
 *
 * So the cross-product is what is missing, and it is what this file is:
 * BUDGET x CELL ORDER x WORLD, plus the fact that none of the above ever
 * streams a graph that came off disk. The level here is
 * `graphs/examples-streamed-terrain.json`, deserialized and bound through
 * `bindPatches` — the serializable path, so every per-cell value crosses
 * as plain JSON exactly as it would to a worker.
 *
 * What this file deliberately does NOT re-test: permutation equivariance
 * (crossPartition), seam ownership of a point lying exactly on a face
 * (crossPartition), cancellation (determinism), pooled-vs-local
 * equivalence (worldPool), and that a patch equals the `setParam` calls
 * it stands for (patches). Those are covered where they belong.
 *
 * Negative controls are permanent and cook every run, in the house style
 * crossPartition sets: an equality never seen to fail is worth nothing.
 * Here they are a halo of zero AND a halo one unit short of the radius
 * (so what is pinned is the WIDTH the one-hop rung states, not merely
 * that some halo exists), a per-cell whole-graph reseed (which cannot
 * move the anchored lattice but moves everything downstream of it), and a
 * moved world seed (which proves the byte comparator fires at all). The
 * order test asserts its own premise too — that the walk away really
 * evicted the region — since otherwise it would quietly decay into
 * cooking the same viewpoint three times.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type BindPatches,
  type CellContext,
  type CellCoord,
  type CellOutputs,
  type Graph,
  type LevelDef,
  World,
  deserializeGraph,
  hashCombine,
} from "../src/index.js";
import { outputsDiff } from "../src/runtime/runtime.testsupport.js";
import { keyMultisetDiff, pointKeys } from "./support/pointMultiset.js";

const SOURCE = readFileSync(
  fileURLToPath(new URL("../graphs/examples-streamed-terrain.json", import.meta.url)),
  "utf8",
);

/**
 * One `Graph` per level: a `World` tracks staleness per level and refuses
 * a shared graph, and re-parsing keeps each level's params independent.
 */
function levelGraph(): Graph {
  return deserializeGraph(JSON.parse(SOURCE));
}

interface SourceNode {
  readonly id: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

/**
 * A literal read back OUT of the graph file. The suite's halo and its
 * ownership box have to be the ones the graph declares — hardcoding them
 * here would let the file drift from the graph it exists to stream, and
 * the drift would look like a passing test.
 */
function graphParam(nodeId: string, param: string): unknown {
  const json = JSON.parse(SOURCE) as { readonly nodes: readonly SourceNode[] };
  const node = json.nodes.find((n) => n.id === nodeId);
  if (node === undefined) {
    throw new Error(
      `the graph has no node "${nodeId}"; it has [${json.nodes.map((n) => n.id).join(", ")}]`,
    );
  }
  const value = node.params?.[param];
  if (value === undefined) throw new Error(`node "${nodeId}" declares no param "${param}"`);
  return value;
}

function numberParam(nodeId: string, param: string): number {
  const value = graphParam(nodeId, param);
  if (typeof value !== "number") throw new Error(`"${nodeId}.${param}" is not a number literal`);
  return value;
}

/**
 * The one-hop reach the graph declares, and therefore exactly the halo it
 * needs: `pointNeighborhood` is bounded by its radius, so a halo of the
 * radius reproduces the whole-region result and no larger halo buys
 * anything (docs/authoring.md, "One hop — exact at a stated width").
 */
const HALO = numberParam("crowding", "radius");

/**
 * The finite Y of the ownership box, taken from the graph. An infinity
 * would be the natural bound for an "xz" column and is what an imperative
 * `bind` writes — but `JSON.stringify(Infinity)` is `null`, so a patch
 * cannot carry one and a serialized level has to name a number.
 */
const OWN_Y = ((): number => {
  const value = graphParam("own", "boundsMax");
  if (!Array.isArray(value) || typeof value[1] !== "number") {
    throw new Error(`"own.boundsMax" is not a vec3 literal`);
  }
  return value[1];
})();

const WORLD_SEED = 20260816;
/** Fine cells; the region below is exactly 4x4 of them. */
const CELL = 16;
/** The same region as ONE cell — the unpartitioned reference. */
const REGION = CELL * 4;
/** Wants exactly the 4x4 cells of [0, 64)^2 from the region's center. */
const FINE_RADIUS = 35;
/** Wants exactly the one 64-wide cell [0, 64)^2 from its own center. */
const WHOLE_RADIUS = 40;
const CENTER: readonly [number, number, number] = [REGION / 2, 0, REGION / 2];

const REGION_COORDS: readonly CellCoord[] = (() => {
  const out: CellCoord[] = [];
  for (let cx = 0; cx < 4; cx++) {
    for (let cz = 0; cz < 4; cz++) out.push([cx, cz]);
  }
  return out;
})();

interface BindOptions {
  /** How far outside its own cell a cell queries. */
  readonly halo: number;
  /**
   * Reseed the whole level graph per cell. Sanctioned by `LevelDef.bind`
   * in general and WRONG for this level in particular: it cannot reach
   * `pointScatterInWorld`, but it moves `filterByDensity` and the
   * `randomField` in `size` — "the halo and the neighbour disagree,
   * deterministically and silently" (src/runtime/types.ts).
   */
  readonly reseedPerCell: boolean;
}

/**
 * The whole per-cell binding, as plain JSON. Only the two boxes and the
 * seeds move, and the seeds are cell-INVARIANT: the scatter's lattice is
 * a function of its own `seed`, and everything downstream that has to
 * agree across a seam is salted from `ctx.worldSeed` rather than
 * `ctx.seed`.
 */
function patchesFor(ctx: CellContext, opts: BindOptions): BindPatches {
  if (ctx.cellMode !== "xz") throw new Error("expected an xz level");
  const h = opts.halo;
  const patches = [
    // The query window: the cell grown by the halo, on every side.
    { node: "scatter", param: "boundsMin", value: [ctx.min[0] - h, 0, ctx.min[1] - h] },
    { node: "scatter", param: "boundsMax", value: [ctx.max[0] + h, 0, ctx.max[1] + h] },
    // Cell-invariant, or a widened query stops reproducing the neighbour.
    { node: "scatter", param: "seed", value: ctx.worldSeed },
    { node: "thin", param: "seed", value: hashCombine(ctx.worldSeed, 1) },
    { node: "size", param: "seed", value: hashCombine(ctx.worldSeed, 2) },
    // Ownership: the UNWIDENED cell, compared against as a BOX. Both
    // sides of a seam share the endpoint VALUE, which is what makes the
    // half-open rule exact at any cell size.
    { node: "own", param: "boundsMin", value: [ctx.min[0], -OWN_Y, ctx.min[1]] },
    { node: "own", param: "boundsMax", value: [ctx.max[0], OWN_Y, ctx.max[1]] },
  ];
  return opts.reseedPerCell ? { patches, seed: hashCombine(ctx.seed, 9) } : { patches };
}

function terrainLevel(opts: {
  cellSize: number;
  generationRadius: number;
  retainRadius?: number;
  halo?: number;
  reseedPerCell?: boolean;
}): LevelDef {
  const bind: BindOptions = {
    halo: opts.halo ?? HALO,
    reseedPerCell: opts.reseedPerCell ?? false,
  };
  return {
    name: "terrain",
    cellSize: opts.cellSize,
    generationRadius: opts.generationRadius,
    retainRadius: opts.retainRadius,
    graph: levelGraph(),
    bindPatches: (ctx) => patchesFor(ctx, bind),
  };
}

/** A world of 4x4 fine cells over the region. */
function fineWorld(opts?: {
  seed?: number;
  retainRadius?: number;
  halo?: number;
  reseedPerCell?: boolean;
}): World {
  return new World({
    seed: opts?.seed ?? WORLD_SEED,
    levels: [
      terrainLevel({
        cellSize: CELL,
        generationRadius: FINE_RADIUS,
        retainRadius: opts?.retainRadius,
        halo: opts?.halo,
        reseedPerCell: opts?.reseedPerCell,
      }),
    ],
  });
}

/** The same region as a single cell, through the identical bind path. */
function wholeWorld(opts?: { halo?: number; reseedPerCell?: boolean }): World {
  return new World({
    seed: WORLD_SEED,
    levels: [
      terrainLevel({
        cellSize: REGION,
        generationRadius: WHOLE_RADIUS,
        halo: opts?.halo,
        reseedPerCell: opts?.reseedPerCell,
      }),
    ],
  });
}

function cellOf(world: World, coord: CellCoord): CellOutputs {
  const cell = world.getCell("terrain", coord);
  expect(cell, `cell ${coord.join(",")} is missing`).toBeDefined();
  return cell?.outputs ?? {};
}

/** Identity-plus-every-attribute keys, so equality is byte equality. */
function keysOf(outputs: CellOutputs, name: string, who: string): string[] {
  const keys: string[] = [];
  for (const item of outputs[name] ?? []) {
    if (item.kind === "geometry") keys.push(...pointKeys(item.geo, who));
  }
  return keys;
}

/** Every point the 4x4 cells claim, stitched back into one cloud. */
function stitched(world: World, name: string): string[] {
  const keys: string[] = [];
  for (const coord of REGION_COORDS) {
    keys.push(...keysOf(cellOf(world, coord), name, `cell ${coord.join(",")}`));
  }
  return keys;
}

function wholeOf(world: World, name: string): string[] {
  return keysOf(cellOf(world, [0, 0]), name, "whole region");
}

interface DriveResult {
  readonly updates: number;
  /** Whether any update actually ran out of budget mid-queue. */
  readonly sawPending: boolean;
}

/**
 * Drive a world along a path, re-running each viewpoint until nothing is
 * left pending. A budget small enough to stop the update mid-queue is the
 * whole point of the exercise, so draining is the caller's job here and
 * not the runtime's.
 */
async function drive(
  world: World,
  path: readonly (readonly [number, number, number])[],
  budgetMs?: number,
): Promise<DriveResult> {
  let updates = 0;
  let sawPending = false;
  for (const viewpoint of path) {
    let drained = false;
    for (let guard = 0; guard < 400 && !drained; guard++) {
      const stats =
        budgetMs === undefined
          ? await world.update(viewpoint)
          : await world.update(viewpoint, { budgetMs });
      updates++;
      if (stats.pending === 0) drained = true;
      else sawPending = true;
    }
    if (!drained) {
      throw new Error(
        `viewpoint ${viewpoint.join(",")} never drained at budgetMs ${String(budgetMs)}`,
      );
    }
  }
  return { updates, sawPending };
}

/** Every region cell of `b` must match `a`, byte for byte. */
function expectCellsIdentical(a: World, b: World, labelB: string): void {
  for (const coord of REGION_COORDS) {
    const diff = outputsDiff(cellOf(a, coord), cellOf(b, coord));
    expect(diff, `${labelB}: cell ${coord.join(",")} differs — ${String(diff)}`).toBeNull();
  }
}

describe("a serialized level graph, streamed", () => {
  it("cooks the region identically as one cell and as sixteen", async () => {
    const split = fineWorld();
    const whole = wholeWorld();
    await drive(split, [CENTER]);
    await drive(whole, [CENTER]);

    // The partition really is the one intended: 16 fine cells, 1 coarse.
    expect(split.cells("terrain")).toHaveLength(REGION_COORDS.length);
    expect(whole.cells("terrain")).toHaveLength(1);

    const parts = stitched(split, "points");
    const one = wholeOf(whole, "points");
    // Non-vacuous: a region with points in it, or the comparison below
    // would pass on two empty clouds.
    expect(one.length).toBeGreaterThan(400);
    expect(keyMultisetDiff(parts, one, "16 cells", "1 cell", "points")).toBeNull();
  });

  it("does not agree about a population-relative field, and must not", async () => {
    // `cookRank` is a `fraction` field: it measures the population present
    // in THIS cook, which under a World means the population HERE. It is
    // the unbounded rung — no halo width repairs it — so the contract
    // does not promise agreement and this asserts the disagreement rather
    // than pretending otherwise.
    const split = fineWorld();
    const whole = wholeWorld();
    await drive(split, [CENTER]);
    await drive(whole, [CENTER]);

    const parts = stitched(split, "populationRank");
    const one = wholeOf(whole, "populationRank");
    // The same NUMBER of points, so the disagreement below is `cookRank`
    // moving and not a partition that lost or doubled something. That the
    // points themselves are identical is the previous test's claim.
    expect(parts).toHaveLength(one.length);
    expect(keyMultisetDiff(parts, one, "16 cells", "1 cell", "ranks")).not.toBeNull();
  });

  it("disagrees at a halo narrower than the radius, not merely at none (control)", async () => {
    // Both arms keep every point — narrowing the query window never drops
    // an OWNED point, since ownership is the unwidened cell either way.
    // What moves is `nbrCount`, and `size` with it: a border point
    // measured a neighbourhood that ran out of world. Running 3 as well as
    // 0 is the difference between proving a halo is needed and proving its
    // WIDTH is, which is the actual claim of the one-hop rung.
    for (const halo of [0, HALO - 1]) {
      const split = fineWorld({ halo });
      const whole = wholeWorld({ halo });
      await drive(split, [CENTER]);
      await drive(whole, [CENTER]);

      const parts = stitched(split, "points");
      const one = wholeOf(whole, "points");
      expect(parts, `halo ${halo}`).toHaveLength(one.length);
      expect(
        keyMultisetDiff(parts, one, "16 cells", "1 cell", "points"),
        `halo ${halo} should not reproduce the whole-region measurement`,
      ).not.toBeNull();
    }
  }, 30_000);

  it("disagrees under a per-cell whole-graph reseed (control)", async () => {
    // The mechanism, which this test does NOT discriminate: the reseed
    // cannot touch `pointScatterInWorld` (its lattice is a function of its
    // own `seed` param and never of the graph seed), so it lands one node
    // later, on the probabilistic `filterByDensity` and on the
    // `randomField` inside `size` — both of which hashCombine the node
    // seed with the explicit patch rather than being shielded by it.
    // Isolating WHICH node moved is `worldAnchored.test.ts`'s job; all
    // that is asserted here is that a reseeded level stops agreeing.
    const split = fineWorld({ reseedPerCell: true });
    const whole = wholeWorld({ reseedPerCell: true });
    await drive(split, [CENTER]);
    await drive(whole, [CENTER]);

    const parts = stitched(split, "points");
    const one = wholeOf(whole, "points");
    expect(one.length).toBeGreaterThan(400);
    expect(keyMultisetDiff(parts, one, "16 cells", "1 cell", "points")).not.toBeNull();
  });
});

describe("byte-identical across budgets", () => {
  it("no budget, a large budget and a budget that leaves work pending all agree", async () => {
    const unbudgeted = fineWorld();
    const generous = fineWorld();
    const starved = fineWorld();

    const a = await drive(unbudgeted, [CENTER]);
    const b = await drive(generous, [CENTER], 60_000);
    // Small enough to stop the update mid-queue. `world.ts` also forwards
    // it to each cell cook as that cook's yield budget, so this arm should
    // partition inside a cell as well as between cells — that half is not
    // asserted, because the runtime surfaces no stat for it.
    const c = await drive(starved, [CENTER], 0.5);

    // The arms have to differ in how they ran, or they prove nothing.
    expect(a.sawPending).toBe(false);
    expect(b.sawPending).toBe(false);
    expect(c.sawPending).toBe(true);
    expect(a.updates).toBe(1);
    expect(b.updates).toBe(1);
    // In practice exactly one cell per update, so 16 of them: the budget
    // is spent by the time the first cell has cooked. Asserted loosely
    // because the exact figure is a wall-clock race, but a starved run
    // that finished in two updates would not be testing anything.
    expect(c.updates).toBeGreaterThanOrEqual(4);

    expect(unbudgeted.cells("terrain")).toHaveLength(REGION_COORDS.length);
    expectCellsIdentical(unbudgeted, generous, "budgetMs 60000");
    expectCellsIdentical(unbudgeted, starved, "budgetMs 0.5");
  }, 60_000);

  it("reports a difference when the world seed moves (comparator control)", async () => {
    const here = fineWorld();
    const elsewhere = fineWorld({ seed: WORLD_SEED + 1 });
    await drive(here, [CENTER]);
    await drive(elsewhere, [CENTER], 0.5);

    // Same code path as every equality above; only the world seed moved.
    // If this were null the budget comparisons would be measuring nothing.
    expect(outputsDiff(cellOf(here, [1, 1]), cellOf(elsewhere, [1, 1]))).not.toBeNull();
  }, 30_000);
});

describe("byte-identical across cell orders", () => {
  it("two viewpoint paths, an eviction and a recook all agree", async () => {
    // Retain exactly what is generated, so leaving the region evicts it.
    const reference = fineWorld({ retainRadius: FINE_RADIUS });
    const reversed = fineWorld({ retainRadius: FINE_RADIUS });
    const recooked = fineWorld({ retainRadius: FINE_RADIUS });

    await drive(reference, [[8, 0, 8], [56, 0, 56], CENTER]);
    await drive(reversed, [[56, 0, 56], [8, 0, 8], CENTER]);

    // Cook the region, walk far enough away to evict all of it, come back.
    // The eviction is ASSERTED rather than assumed: without this the test
    // would degenerate into cooking CENTER three times and still pass, so
    // it would stop covering recooks the day eviction broke.
    await drive(recooked, [CENTER]);
    expect(recooked.cells("terrain")).toHaveLength(REGION_COORDS.length);
    await drive(recooked, [[5000, 0, 5000]]);
    // Not "no cells left": the far viewpoint cooks its own wanted set
    // there. What must be gone is every cell of THIS region.
    for (const coord of REGION_COORDS) {
      const survivor = recooked.getCell("terrain", coord);
      expect(survivor, `cell ${coord.join(",")} survived the walk away`).toBeUndefined();
    }
    await drive(recooked, [CENTER]);
    expect(recooked.getCell("terrain", [0, 0])).toBeDefined();
    expectCellsIdentical(reference, reversed, "reversed path");
    expectCellsIdentical(reference, recooked, "evicted then recooked");
  }, 60_000);
});

describe("budget and order together", () => {
  it("a starved budget on one path matches a generous budget on another", async () => {
    // The uncovered product: neither suite that owns one of these axes
    // ever moves the other at the same time.
    const starvedPath = fineWorld({ retainRadius: FINE_RADIUS });
    const generousPath = fineWorld({ retainRadius: FINE_RADIUS });

    const starved = await drive(starvedPath, [[56, 0, 56], [8, 0, 8], CENTER], 0.5);
    await drive(generousPath, [[8, 0, 8], [56, 0, 56], CENTER], 60_000);

    expect(starved.sawPending).toBe(true);
    expectCellsIdentical(generousPath, starvedPath, "starved budget, reversed path");
  }, 90_000);
});
