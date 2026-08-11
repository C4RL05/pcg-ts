import { describe, expect, it } from "vitest";
import { CookCancelledError } from "../graph/index.js";
import { coordKeys, outputsDiff, scatterLevel } from "./runtime.testsupport.js";
import type { CellCoord } from "./types.js";
import { World, type WorldOptions } from "./world.js";

/** Fresh world with an unbounded level and a jittered scatter level. */
function makeWorld(extra?: Partial<WorldOptions>): World {
  return new World({
    seed: 42,
    levels: [
      scatterLevel({ name: "planet", cellSize: "unbounded", generationRadius: 1, count: 3 }).def,
      scatterLevel({
        name: "chunk",
        cellSize: 10,
        generationRadius: 12,
        retainRadius: 1000,
        jitter: true,
      }).def,
    ],
    ...extra,
  });
}

function storedCoords(world: World, level: string): string[] {
  return coordKeys(world.cells(level)).sort();
}

describe("cook-order independence", () => {
  it("different viewpoint paths produce byte-identical cells", async () => {
    const a = makeWorld();
    const b = makeWorld();
    // West-to-east vs east-to-west.
    await a.update([-15, 0, 0]);
    await a.update([15, 0, 0]);
    await b.update([15, 0, 0]);
    await b.update([-15, 0, 0]);

    expect(storedCoords(a, "chunk")).toEqual(storedCoords(b, "chunk"));
    expect(storedCoords(a, "chunk").length).toBeGreaterThan(4);
    for (const cell of a.cells("chunk")) {
      const other = b.getCell("chunk", cell.coord);
      expect(other, `cell ${cell.coord[0]},${cell.coord[1]} missing in B`).toBeDefined();
      expect(outputsDiff(cell.outputs, other?.outputs ?? {})).toBeNull();
    }
    expect(
      outputsDiff(
        a.getCell("planet", [0, 0])?.outputs ?? {},
        b.getCell("planet", [0, 0])?.outputs ?? {},
      ),
    ).toBeNull();
  });

  it("identical paths produce identical cooked lists (stats determinism)", async () => {
    const a = makeWorld();
    const b = makeWorld();
    const sa = await a.update([3, 0, -2]);
    const sb = await b.update([3, 0, -2]);
    expect(sa.cooked).toEqual(sb.cooked);
    expect(sa.evicted).toEqual(sb.evicted);
    expect(sa.pending).toBe(sb.pending);
  });

  it("overlapping update calls serialize and match a sequential run byte for byte", async () => {
    // Fire-and-forget concurrency: both updates are started without
    // awaiting. Without per-World serialization, update B's binds would
    // interleave with update A's suspended cooks and tear cells.
    const concurrent = makeWorld();
    const [ra, rb] = await Promise.all([
      concurrent.update([-15, 0, 0]),
      concurrent.update([15, 0, 0]),
    ]);

    const sequential = makeWorld();
    const sa = await sequential.update([-15, 0, 0]);
    const sb = await sequential.update([15, 0, 0]);

    expect(ra.cooked).toEqual(sa.cooked);
    expect(rb.cooked).toEqual(sb.cooked);
    expect(storedCoords(concurrent, "chunk")).toEqual(storedCoords(sequential, "chunk"));
    for (const cell of sequential.cells("chunk")) {
      const other = concurrent.getCell("chunk", cell.coord);
      expect(other).toBeDefined();
      expect(outputsDiff(cell.outputs, other?.outputs ?? {})).toBeNull();
    }
    expect(
      outputsDiff(
        concurrent.getCell("planet", [0, 0])?.outputs ?? {},
        sequential.getCell("planet", [0, 0])?.outputs ?? {},
      ),
    ).toBeNull();
  });

  it("an evicted then regenerated cell is byte-identical", async () => {
    const world = new World({
      seed: 42,
      levels: [
        scatterLevel({
          name: "chunk",
          cellSize: 10,
          generationRadius: 8,
          retainRadius: 8,
          jitter: true,
        }).def,
      ],
    });
    await world.update([0, 0, 0]);
    // Cook results are immutable, so holding the outputs across eviction
    // is safe.
    const before = world.getCell("chunk", [0, 0]);
    expect(before).toBeDefined();

    const away = await world.update([200, 0, 0]);
    expect(coordKeys(away.evicted)).toContain("0,0");
    expect(world.getCell("chunk", [0, 0])).toBeUndefined();

    await world.update([0, 0, 0]);
    const after = world.getCell("chunk", [0, 0]);
    expect(after).toBeDefined();
    // Fresh cook (new item objects), identical bytes.
    expect(after?.outputs.points[0]).not.toBe(before?.outputs.points[0]);
    expect(outputsDiff(before?.outputs ?? {}, after?.outputs ?? {})).toBeNull();
  });
});

describe("cancellation", () => {
  it("aborting mid-update keeps the store consistent and resumes to a byte-identical state", async () => {
    const controller = new AbortController();
    let readyCount = 0;
    const interrupted = makeWorld({
      onCellReady: (level) => {
        // Abort after the first two cell cooks (planet + one chunk).
        if (level === "chunk" && ++readyCount === 1) controller.abort();
      },
    });
    await expect(
      interrupted.update([0, 0, 0], { signal: controller.signal }),
    ).rejects.toThrow(CookCancelledError);
    // Completed cells are stored; the aborted remainder is not.
    expect(interrupted.cells("planet")).toHaveLength(1);
    expect(interrupted.cells("chunk")).toHaveLength(1);

    // Resume without the signal: the remaining cells cook.
    const resumed = await interrupted.update([0, 0, 0]);
    expect(resumed.pending).toBe(0);
    expect(resumed.cooked.length).toBeGreaterThan(0);

    // Final state matches an uninterrupted run, byte for byte.
    const uninterrupted = makeWorld();
    await uninterrupted.update([0, 0, 0]);
    expect(storedCoords(interrupted, "chunk")).toEqual(storedCoords(uninterrupted, "chunk"));
    for (const cell of uninterrupted.cells("chunk")) {
      const other = interrupted.getCell("chunk", cell.coord as CellCoord);
      expect(other).toBeDefined();
      expect(outputsDiff(cell.outputs, other?.outputs ?? {})).toBeNull();
    }
  });
});
