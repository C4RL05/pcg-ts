import { describe, expect, it } from "vitest";
import { firstGeometry } from "../graph/index.js";
import { childEchoLevel, coordKeys, outputsDiff, scatterLevel } from "./runtime.testsupport.js";
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

  it("a stale retained parent blocks wanted children until it recooks", async () => {
    const region = scatterLevel({ name: "region", cellSize: 20, generationRadius: 6, retainRadius: 30 });
    const chunk = childEchoLevel({ name: "chunk", cellSize: 10, generationRadius: 4, retainRadius: 100 });
    const world = new World({ seed: 5, levels: [region.def, chunk.def] });

    // Region (0,0) (center (10,10)) and chunk (0,0) cook.
    const first = await world.update([7, 0, 7]);
    expect(first.cooked).toEqual([
      { level: "region", coord: [0, 0] },
      { level: "chunk", coord: [0, 0] },
    ]);

    // Edit the parent graph, then move to (17,17): region (0,0) is now
    // retained-not-wanted (distance ~9.9, between 6 and 30) and stale;
    // wanted chunk (1,1) must wait rather than cook pre-edit content.
    region.graph.setParam(region.scatter, "count", 5);
    const blocked = await world.update([17, 0, 17]);
    expect(blocked.cooked).toEqual([]);
    expect(blocked.pending).toBe(1);
    expect(world.getCell("chunk", [1, 1])).toBeUndefined();

    // Back where the region is wanted: it recooks first, and the chunk
    // cooks in the same update against post-edit parent content.
    const healed = await world.update([13, 0, 13]);
    expect(healed.cooked).toEqual([
      { level: "region", coord: [0, 0] },
      { level: "chunk", coord: [1, 1] },
    ]);
    const echo = world.getCell("chunk", [1, 1]);
    expect(firstGeometry(echo?.outputs.parentEcho ?? [])?.attrs.point.count).toBe(5);
  });

  it("an edit inside onCellReady marks the level and heals next update", async () => {
    let edited = false;
    const chunk = scatterLevel({ name: "chunk", cellSize: 10, generationRadius: 8, retainRadius: 100 });
    const world = new World({
      seed: 3,
      levels: [chunk.def],
      onCellReady: () => {
        if (!edited) {
          edited = true;
          chunk.graph.setParam(chunk.scatter, "count", 6);
        }
      },
    });

    // The edit fires after the first cell cooks: later cells cook with
    // the new params; the pre-edit cell is charged as stale.
    const first = await world.update([0, 0, 0]);
    expect(first.cooked).toHaveLength(4);
    const preEdit = world.getCell("chunk", [-1, -1]);
    expect(firstGeometry(preEdit?.outputs.points ?? [])?.attrs.point.count).toBe(4);
    expect(firstGeometry(world.getCell("chunk", [0, 0])?.outputs.points ?? [])?.attrs.point.count).toBe(6);

    // Next update recooks exactly the pre-edit cell.
    const second = await world.update([0, 0, 0]);
    expect(second.cooked).toEqual([{ level: "chunk", coord: [-1, -1] }]);
    expect(firstGeometry(world.getCell("chunk", [-1, -1])?.outputs.points ?? [])?.attrs.point.count).toBe(6);

    // And then it is quiescent again.
    const third = await world.update([0, 0, 0]);
    expect(third.cooked).toEqual([]);
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
