import { describe, expect, it } from "vitest";
import { Graph, cook, makeValueItem } from "../graph/index.js";
import { hasNodeType } from "../nodes/registry.js";
import { dataInput } from "./dataInput.js";
import { coordKeys, scatterLevel } from "./runtime.testsupport.js";
import type { LevelDef } from "./types.js";
import { World, WorldValidationError } from "./world.js";

function lvl(over: {
  name?: string;
  cellSize?: number | "unbounded";
  generationRadius?: number;
  retainRadius?: number;
}): LevelDef {
  return scatterLevel({
    name: over.name ?? "a",
    cellSize: over.cellSize ?? 10,
    generationRadius: over.generationRadius ?? 8,
    retainRadius: over.retainRadius,
  }).def;
}

describe("World validation", () => {
  it("requires at least one level", () => {
    expect(() => new World({ seed: 1, levels: [] })).toThrow(WorldValidationError);
    expect(() => new World({ seed: 1, levels: [] })).toThrow(/at least one level/);
  });

  it("rejects an unbounded level that is not first", () => {
    const levels = [lvl({ name: "a", cellSize: 10 }), lvl({ name: "b", cellSize: "unbounded" })];
    expect(() => new World({ seed: 1, levels })).toThrow(/must be the first/);
  });

  it("rejects two unbounded levels", () => {
    const levels = [
      lvl({ name: "a", cellSize: "unbounded" }),
      lvl({ name: "b", cellSize: "unbounded" }),
    ];
    expect(() => new World({ seed: 1, levels })).toThrow(/only one unbounded level/);
  });

  it("rejects non-positive or non-finite cell sizes", () => {
    expect(() => new World({ seed: 1, levels: [lvl({ cellSize: 0 })] })).toThrow(
      /cellSize must be a positive finite number/,
    );
    expect(() => new World({ seed: 1, levels: [lvl({ cellSize: -5 })] })).toThrow(/cellSize/);
    expect(() => new World({ seed: 1, levels: [lvl({ cellSize: Infinity })] })).toThrow(/cellSize/);
  });

  it("rejects bounded levels that do not strictly decrease in cell size", () => {
    const ascending = [lvl({ name: "a", cellSize: 10 }), lvl({ name: "b", cellSize: 20 })];
    expect(() => new World({ seed: 1, levels: ascending })).toThrow(/strictly smaller/);
    const equal = [lvl({ name: "a", cellSize: 10 }), lvl({ name: "b", cellSize: 10 })];
    expect(() => new World({ seed: 1, levels: equal })).toThrow(/strictly smaller/);
  });

  it("rejects bad radii", () => {
    expect(() => new World({ seed: 1, levels: [lvl({ generationRadius: 0 })] })).toThrow(
      /generationRadius must be a positive finite number/,
    );
    expect(
      () => new World({ seed: 1, levels: [lvl({ generationRadius: 8, retainRadius: 5 })] }),
    ).toThrow(/retainRadius \(5\) must be a finite number >= generationRadius \(8\)/);
  });

  it("rejects duplicate level names", () => {
    const levels = [lvl({ name: "a", cellSize: 20 }), lvl({ name: "a", cellSize: 10 })];
    expect(() => new World({ seed: 1, levels })).toThrow(/duplicate level name "a"/);
  });

  it("rejects two levels sharing one Graph instance", () => {
    const shared = scatterLevel({ name: "a", cellSize: 20, generationRadius: 8 });
    const b: LevelDef = { ...shared.def, name: "b", cellSize: 10 };
    expect(() => new World({ seed: 1, levels: [shared.def, b] })).toThrow(
      /levels "a" and "b" share one Graph instance/,
    );
  });

  it("rejects a non-positive LRU cap", () => {
    expect(() => new World({ seed: 1, levels: [lvl({})], maxCellsPerLevel: 0 })).toThrow(
      /maxCellsPerLevel/,
    );
  });

  it("names valid levels when an accessor gets an unknown level", () => {
    const world = new World({ seed: 1, levels: [lvl({ name: "chunk" })] });
    expect(() => world.getCell("nope", [0, 0])).toThrow(/unknown level "nope"; levels: chunk/);
    expect(() => world.cells("nope")).toThrow(WorldValidationError);
    expect(() => world.invalidate("nope")).toThrow(/unknown level/);
  });
});

describe("update argument validation", () => {
  function make(): World {
    return new World({ seed: 1, levels: [lvl({ name: "chunk" })] });
  }

  it("rejects non-finite viewpoint components, naming the axis", async () => {
    await expect(make().update([NaN, 0, 0])).rejects.toThrow(/viewpoint x must be a finite number/);
    await expect(make().update([0, -Infinity, 0])).rejects.toThrow(/viewpoint y/);
    await expect(make().update([0, 0, Infinity])).rejects.toThrow(WorldValidationError);
  });

  it("rejects invalid budgetMs (negative or NaN)", async () => {
    const world = make();
    await expect(world.update([0, 0, 0], { budgetMs: -1 })).rejects.toThrow(
      /budgetMs must be a finite number >= 0, got -1/,
    );
    await expect(world.update([0, 0, 0], { budgetMs: NaN })).rejects.toThrow(WorldValidationError);
  });

  it("rejects invalid maxCooksPerUpdate (negative, fractional, or NaN)", async () => {
    const world = make();
    await expect(world.update([0, 0, 0], { maxCooksPerUpdate: -1 })).rejects.toThrow(
      /maxCooksPerUpdate must be a non-negative integer/,
    );
    await expect(world.update([0, 0, 0], { maxCooksPerUpdate: 1.5 })).rejects.toThrow(
      WorldValidationError,
    );
    await expect(world.update([0, 0, 0], { maxCooksPerUpdate: NaN })).rejects.toThrow(
      WorldValidationError,
    );
  });

  it("maxCooksPerUpdate 0 cooks nothing and reports everything pending", async () => {
    const world = make();
    const stats = await world.update([0, 0, 0], { maxCooksPerUpdate: 0 });
    expect(stats.cooked).toEqual([]);
    expect(stats.pending).toBe(4);
    expect(world.cells("chunk")).toHaveLength(0);
  });
});

describe("dataInput node", () => {
  it("is registered and defaults to emitting no items", async () => {
    expect(hasNodeType("dataInput")).toBe(true);
    const graph = new Graph();
    const node = graph.add(dataInput);
    graph.output(node, "out", "out");
    const result = await cook(graph);
    expect(result.outputs.out).toEqual([]);
  });

  it("emits exactly the injected items and caches by rev", async () => {
    const graph = new Graph();
    const node = graph.add(dataInput);
    graph.output(node, "out", "out");
    const a = makeValueItem(1);
    const b = makeValueItem("two");
    graph.setParam(node, "items", [a, b]);
    const first = await cook(graph);
    expect(first.outputs.out[0]).toBe(a);
    expect(first.outputs.out[1]).toBe(b);
    expect(first.stats.cooked).toBe(1);

    // Re-injecting the same items (same revs) is a cache hit.
    graph.setParam(node, "items", [a, b]);
    const second = await cook(graph);
    expect(second.stats.cached).toBe(1);
    expect(second.stats.cooked).toBe(0);

    // A fresh item (new rev) recooks.
    graph.setParam(node, "items", [a, makeValueItem("two")]);
    const third = await cook(graph);
    expect(third.stats.cooked).toBe(1);
  });

  it("freezes the bound array outside production so late mutation throws", async () => {
    const graph = new Graph();
    const node = graph.add(dataInput);
    graph.output(node, "out", "out");
    const items = [makeValueItem(1)];
    graph.setParam(node, "items", items);
    const result = await cook(graph);
    expect(result.outputs.out).toBe(items);
    // The emitted collection aliases the bound array; mutating it in
    // place must fail loudly (aliasing contract) rather than silently
    // changing stored outputs.
    expect(() => items.push(makeValueItem(2))).toThrow(TypeError);
  });

  it("rejects non-item values with a precise error", async () => {
    const graph = new Graph();
    const node = graph.add(dataInput);
    graph.output(node, "out", "out");
    graph.setParam(node, "items", "nope" as never);
    await expect(cook(graph)).rejects.toThrow(/must be an array of DataItems/);
    graph.setParam(node, "items", [{ bogus: true } as never]);
    await expect(cook(graph)).rejects.toThrow(/"items"\[0\] is not a DataItem/);
  });
});

describe("World accessors", () => {
  it("getCell, cells, and stats reflect the store deterministically", async () => {
    const world = new World({
      seed: 7,
      levels: [lvl({ name: "chunk", cellSize: 10, generationRadius: 8 })],
    });
    const stats = await world.update([0, 0, 0]);
    expect(coordKeys(stats.cooked)).toEqual(["-1,-1", "-1,0", "0,-1", "0,0"]);

    const cell = world.getCell("chunk", [0, 0]);
    expect(cell).toBeDefined();
    expect(Object.keys(cell?.outputs ?? {})).toEqual(["points"]);
    expect(cell?.cookedAt).toBeGreaterThan(0);
    expect(world.getCell("chunk", [99, 99])).toBeUndefined();

    // cells() iterates in insertion order == cook order here.
    expect(coordKeys(world.cells("chunk"))).toEqual(coordKeys(stats.cooked));

    expect(world.stats()).toEqual({
      levels: [{ name: "chunk", cellCount: 4 }],
      totalCooked: 4,
      totalEvicted: 0,
    });
  });
});
