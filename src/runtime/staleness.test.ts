import { describe, expect, it } from "vitest";
import { firstGeometry } from "../graph/index.js";
import { childEchoLevel, coordKeys, outputsDiff, scatterLevel } from "./testSupport.js";
import { World } from "./world.js";

/** Unbounded "planet" + bounded "chunk", with handles kept for edits. */
function makeWorld() {
  const planet = scatterLevel({
    name: "planet",
    cellSize: "unbounded",
    generationRadius: 1,
    count: 3,
  });
  const chunk = scatterLevel({
    name: "chunk",
    cellSize: 10,
    generationRadius: 8,
    retainRadius: 100,
  });
  const world = new World({ seed: 3, levels: [planet.def, chunk.def] });
  return { world, planet, chunk };
}

describe("staleness", () => {
  it("cooks nothing on a second update with no edits", async () => {
    const { world } = makeWorld();
    const first = await world.update([0, 0, 0]);
    expect(first.cooked).toHaveLength(5);
    const second = await world.update([0, 0, 0]);
    expect(second.cooked).toEqual([]);
    expect(second.pending).toBe(0);
    expect(second.evicted).toEqual([]);
  });

  it("recooks a level's wanted cells after a user param edit", async () => {
    const { world, chunk } = makeWorld();
    await world.update([0, 0, 0]);
    chunk.graph.setParam(chunk.scatter, "count", 7);
    const stats = await world.update([0, 0, 0]);
    // Only the edited level recooks; the planet stays cached.
    expect(stats.cooked.every((c) => c.level === "chunk")).toBe(true);
    expect(stats.cooked).toHaveLength(4);
    for (const cell of world.cells("chunk")) {
      expect(firstGeometry(cell.outputs.points)?.attrs.point.count).toBe(7);
    }
  });

  it("recooks with new content after setSeed", async () => {
    const { world, chunk } = makeWorld();
    await world.update([0, 0, 0]);
    const before = world.getCell("chunk", [0, 0]);
    chunk.graph.setSeed(123);
    const stats = await world.update([0, 0, 0]);
    expect(stats.cooked).toHaveLength(4);
    const after = world.getCell("chunk", [0, 0]);
    expect(outputsDiff(before?.outputs ?? {}, after?.outputs ?? {})).not.toBeNull();
  });

  it("invalidate(level, coord) recooks exactly one cell, byte-identically", async () => {
    const { world } = makeWorld();
    await world.update([0, 0, 0]);
    const before = world.getCell("chunk", [0, 0]);
    world.invalidate("chunk", [0, 0]);
    const stats = await world.update([0, 0, 0]);
    expect(stats.cooked).toEqual([{ level: "chunk", coord: [0, 0] }]);
    const after = world.getCell("chunk", [0, 0]);
    expect(after?.cookedAt).toBeGreaterThan(before?.cookedAt ?? 0);
    // Nothing changed, so the regenerated cell is byte-identical.
    expect(outputsDiff(before?.outputs ?? {}, after?.outputs ?? {})).toBeNull();
  });

  it("invalidate(level) recooks that level; invalidate() recooks everything", async () => {
    const { world } = makeWorld();
    await world.update([0, 0, 0]);
    world.invalidate("chunk");
    const levelStats = await world.update([0, 0, 0]);
    expect(levelStats.cooked.every((c) => c.level === "chunk")).toBe(true);
    expect(levelStats.cooked).toHaveLength(4);
    world.invalidate();
    const allStats = await world.update([0, 0, 0]);
    expect(allStats.cooked).toHaveLength(5);
    expect(allStats.cooked[0].level).toBe("planet");
  });

  it("a stale cell outside the wanted set waits until it is wanted again", async () => {
    const { world } = makeWorld();
    await world.update([0, 0, 0]);
    const before = world.getCell("chunk", [0, 0]);
    world.invalidate("chunk", [0, 0]);
    // Viewpoint far enough that (0,0) is not wanted, near enough to retain.
    const away = await world.update([30, 0, 5]);
    expect(coordKeys(away.cooked)).toEqual(["2,0", "3,0"]);
    expect(world.getCell("chunk", [0, 0])?.cookedAt).toBe(before?.cookedAt);
    // Back in range: only the stale cell recooks.
    const back = await world.update([0, 0, 0]);
    expect(back.cooked).toEqual([{ level: "chunk", coord: [0, 0] }]);
  });

  it("recooking a parent cascades to its stored children", async () => {
    const planet = scatterLevel({
      name: "planet",
      cellSize: "unbounded",
      generationRadius: 1,
      count: 3,
    });
    const chunk = childEchoLevel({
      name: "chunk",
      cellSize: 10,
      generationRadius: 9,
      retainRadius: 100,
    });
    const world = new World({ seed: 3, levels: [planet.def, chunk.def] });
    await world.update([0, 0, 0]);
    for (const cell of world.cells("chunk")) {
      expect(firstGeometry(cell.outputs.parentEcho)?.attrs.point.count).toBe(3);
    }

    // Edit the parent level: the planet recooks, and every stored chunk
    // recooks against the new parent content.
    planet.graph.setParam(planet.scatter, "count", 5);
    const stats = await world.update([0, 0, 0]);
    expect(stats.cooked[0].level).toBe("planet");
    expect(stats.cooked).toHaveLength(5);
    for (const cell of world.cells("chunk")) {
      expect(firstGeometry(cell.outputs.parentEcho)?.attrs.point.count).toBe(5);
    }
  });
});
