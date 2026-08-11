import { describe, expect, it } from "vitest";
import { firstGeometry } from "../graph/index.js";
import { childEchoLevel, coordKeys, scatterLevel } from "./runtime.testsupport.js";
import type { CellCoord } from "./types.js";
import { World } from "./world.js";

describe("streaming lifecycle", () => {
  it("cooks exactly the hand-computed wanted set", async () => {
    // cellSize 10, radius 8, viewpoint origin: only the four cells whose
    // centers (+-5, +-5) lie within 8 (dist^2 = 50 <= 64).
    const world = new World({
      seed: 1,
      levels: [scatterLevel({ name: "chunk", cellSize: 10, generationRadius: 8 }).def],
    });
    const stats = await world.update([0, 0, 0]);
    expect(coordKeys(stats.cooked)).toEqual(["-1,-1", "-1,0", "0,-1", "0,0"]);
    expect(stats.pending).toBe(0);
    expect(stats.evicted).toEqual([]);
    for (const cell of world.cells("chunk")) {
      const geo = firstGeometry(cell.outputs.points);
      expect(geo?.attrs.point.count).toBe(4);
    }
  });

  it("cooks nearest-first with a deterministic (cx, cz) tie-break", async () => {
    // Viewpoint (1, 1): dist^2 to centers — (0,0): 32, (-1,0) and (0,-1):
    // 52 (tie broken by cx), (-1,-1): 72.
    const world = new World({
      seed: 1,
      levels: [scatterLevel({ name: "chunk", cellSize: 10, generationRadius: 12 }).def],
    });
    const stats = await world.update([1, 0, 1]);
    expect(coordKeys(stats.cooked)).toEqual(["0,0", "-1,0", "0,-1", "-1,-1"]);
  });

  it("keeps cells in the hysteresis band and evicts beyond retainRadius", async () => {
    const evictedLog: string[] = [];
    const world = new World({
      seed: 1,
      levels: [
        scatterLevel({ name: "chunk", cellSize: 10, generationRadius: 8, retainRadius: 20 }).def,
      ],
      onCellEvicted: (_level, coord) => evictedLog.push(`${coord[0]},${coord[1]}`),
    });

    const first = await world.update([5, 0, 5]);
    expect(coordKeys(first.cooked)).toEqual(["0,0"]);

    // Cell (0,0) center is 12 from the new viewpoint: outside generation,
    // inside retain — kept.
    const second = await world.update([17, 0, 5]);
    expect(coordKeys(second.cooked)).toEqual(["1,0", "2,0"]);
    expect(second.evicted).toEqual([]);
    expect(coordKeys(world.cells("chunk"))).toEqual(["0,0", "1,0", "2,0"]);

    // From (40, 5): centers (5,5) at 35 and (15,5) at 25 exit retain 20;
    // (25,5) at 15 stays.
    const third = await world.update([40, 0, 5]);
    expect(coordKeys(third.cooked)).toEqual(["3,0", "4,0"]);
    expect(coordKeys(third.evicted)).toEqual(["0,0", "1,0"]);
    expect(evictedLog).toEqual(["0,0", "1,0"]);
    expect(coordKeys(world.cells("chunk"))).toEqual(["2,0", "3,0", "4,0"]);
  });

  it("LRU-trims to maxCellsPerLevel, least-recently-used first", async () => {
    const world = new World({
      seed: 1,
      levels: [
        scatterLevel({ name: "chunk", cellSize: 10, generationRadius: 8, retainRadius: 1000 }).def,
      ],
      maxCellsPerLevel: 2,
    });
    const stats = await world.update([0, 0, 0]);
    expect(coordKeys(stats.cooked)).toEqual(["-1,-1", "-1,0", "0,-1", "0,0"]);
    // The two earliest-cooked cells fall to the LRU trim.
    expect(coordKeys(stats.evicted)).toEqual(["-1,-1", "-1,0"]);
    expect(coordKeys(world.cells("chunk"))).toEqual(["0,-1", "0,0"]);
  });

  it("never evicts the unbounded cell", async () => {
    const world = new World({
      seed: 1,
      levels: [
        scatterLevel({ name: "planet", cellSize: "unbounded", generationRadius: 1 }).def,
        scatterLevel({ name: "chunk", cellSize: 10, generationRadius: 8 }).def,
      ],
      maxCellsPerLevel: 1,
    });
    const first = await world.update([0, 0, 0]);
    expect(first.cooked[0]).toEqual({ level: "planet", coord: [0, 0] });
    const second = await world.update([1000, 0, 0]);
    expect(second.evicted.every((c) => c.level === "chunk")).toBe(true);
    expect(world.cells("planet")).toHaveLength(1);
    expect(world.getCell("planet", [0, 0])).toBeDefined();
  });

  it("fires onCellReady and onCellEvicted to match the stats", async () => {
    const ready: string[] = [];
    const evicted: string[] = [];
    const world = new World({
      seed: 1,
      levels: [
        scatterLevel({ name: "chunk", cellSize: 10, generationRadius: 8, retainRadius: 8 }).def,
      ],
      onCellReady: (level, coord, outputs) => {
        expect(level).toBe("chunk");
        expect(firstGeometry(outputs.points)).toBeDefined();
        ready.push(`${coord[0]},${coord[1]}`);
      },
      onCellEvicted: (_level, coord) => evicted.push(`${coord[0]},${coord[1]}`),
    });
    const first = await world.update([0, 0, 0]);
    expect(ready).toEqual(coordKeys(first.cooked));
    const second = await world.update([200, 0, 0]);
    expect(evicted).toEqual(coordKeys(second.evicted));
    expect(evicted).toHaveLength(4);
  });
});

describe("budgets", () => {
  it("honors maxCooksPerUpdate with deterministic priority and pending", async () => {
    const world = new World({
      seed: 1,
      levels: [scatterLevel({ name: "chunk", cellSize: 10, generationRadius: 8 }).def],
    });
    const first = await world.update([0, 0, 0], { maxCooksPerUpdate: 2 });
    expect(coordKeys(first.cooked)).toEqual(["-1,-1", "-1,0"]);
    expect(first.pending).toBe(2);
    const second = await world.update([0, 0, 0], { maxCooksPerUpdate: 2 });
    expect(coordKeys(second.cooked)).toEqual(["0,-1", "0,0"]);
    expect(second.pending).toBe(0);
  });

  it("stops cooking when budgetMs is exhausted and resumes next update", async () => {
    const world = new World({
      seed: 1,
      levels: [scatterLevel({ name: "chunk", cellSize: 10, generationRadius: 8 }).def],
    });
    // A zero budget is exhausted before the first cook: everything
    // stays pending, and the store is untouched.
    const first = await world.update([0, 0, 0], { budgetMs: 0 });
    expect(first.cooked).toEqual([]);
    expect(first.pending).toBe(4);
    expect(world.cells("chunk")).toHaveLength(0);
    const second = await world.update([0, 0, 0]);
    expect(second.cooked).toHaveLength(4);
    expect(second.pending).toBe(0);
  });
});

describe("parent flow", () => {
  it("children receive the parent cell's outputs through dataInput", async () => {
    const world = new World({
      seed: 9,
      levels: [
        scatterLevel({ name: "planet", cellSize: "unbounded", generationRadius: 1, count: 3 }).def,
        childEchoLevel({ name: "chunk", cellSize: 10, generationRadius: 9 }).def,
      ],
    });
    const stats = await world.update([0, 0, 0]);
    expect(stats.cooked[0].level).toBe("planet");
    expect(stats.cooked).toHaveLength(5);
    const planetPoints = world.getCell("planet", [0, 0])?.outputs.points;
    expect(planetPoints).toHaveLength(1);
    for (const cell of world.cells("chunk")) {
      // dataInput emits exactly the injected items: identical references.
      expect(cell.outputs.parentEcho[0]).toBe(planetPoints?.[0]);
      expect(firstGeometry(cell.outputs.parentEcho)?.attrs.point.count).toBe(3);
    }
  });

  it("a wanted cell whose parent cell was never cooked stays pending", async () => {
    // Parent radius deliberately too small: at (95, 95) no region cell is
    // wanted, but one chunk cell is — it must wait for its parent.
    const world = new World({
      seed: 9,
      levels: [
        scatterLevel({ name: "region", cellSize: 100, generationRadius: 10 }).def,
        childEchoLevel({ name: "chunk", cellSize: 10, generationRadius: 9 }).def,
      ],
    });
    const blocked = await world.update([95, 0, 95]);
    expect(blocked.cooked).toEqual([]);
    expect(blocked.pending).toBe(1);
    expect(world.cells("chunk")).toHaveLength(0);

    // Once the parent is wanted it cooks first (coarse to fine), and the
    // chunk cells around the new viewpoint cook in the same update.
    const ok = await world.update([50, 0, 50]);
    expect(ok.cooked[0]).toEqual({ level: "region", coord: [0, 0] });
    expect(ok.cooked.filter((c) => c.level === "chunk")).toHaveLength(4);
    expect(ok.pending).toBe(0);
  });

  it("cooks children the next update when a cap starved the parent level", async () => {
    const world = new World({
      seed: 9,
      levels: [
        scatterLevel({ name: "planet", cellSize: "unbounded", generationRadius: 1, count: 3 }).def,
        childEchoLevel({ name: "chunk", cellSize: 10, generationRadius: 9 }).def,
      ],
    });
    const first = await world.update([0, 0, 0], { maxCooksPerUpdate: 1 });
    expect(first.cooked).toEqual([{ level: "planet", coord: [0, 0] }]);
    expect(first.pending).toBe(4);
    const second = await world.update([0, 0, 0]);
    expect(second.cooked.every((c) => c.level === "chunk")).toBe(true);
    expect(second.cooked).toHaveLength(4);
    expect(second.pending).toBe(0);
  });
});
