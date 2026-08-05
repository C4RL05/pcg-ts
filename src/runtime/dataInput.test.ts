import { describe, expect, it } from "vitest";
import { Graph, cook, firstGeometry, makeValueItem, type NodeHandle } from "../graph/index.js";
import { deserializeGraph, getNodeType, serializeGraph } from "../nodes/index.js";
import { dataInput, type DataInputParams } from "./dataInput.js";
import { childEchoLevel, scatterLevel } from "./testSupport.js";
import type { LevelDef } from "./types.js";
import { World } from "./world.js";

describe("dataInput serialization", () => {
  it("declares a real item-list schema stating the runtime-injection contract", () => {
    const entry = getNodeType("dataInput");
    const schema = entry.info.params.items;
    expect(schema.type).toBe("items");
    expect(schema.default).toEqual([]);
    expect(schema.description).toMatch(/never serialized/);
    expect(schema.description).toMatch(/graph\.setParam/);
    expect(entry.def.defaultParams).toEqual({ items: [] });
  });

  it("serializes with an empty item list regardless of the live items", () => {
    const g = new Graph(1);
    const node = g.add(dataInput, undefined, "input");
    g.output(node, "out", "echo");
    g.setParam(node, "items", [makeValueItem(42), makeValueItem("live")]);
    const json = serializeGraph(g);
    expect(json.nodes).toEqual([{ id: "input", type: "dataInput", params: { items: [] } }]);
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  it("round-trips into a graph the runtime can bind items into as before", async () => {
    const g = new Graph(1);
    const node = g.add(dataInput, undefined, "input");
    g.output(node, "out", "echo");
    g.setParam(node, "items", [makeValueItem("live-only")]);

    const rebuilt = deserializeGraph(JSON.parse(JSON.stringify(serializeGraph(g))));
    // Fresh from JSON: no items until the runtime binds them.
    const empty = await cook(rebuilt);
    expect(empty.outputs.echo).toEqual([]);

    // World-style bind: setParam on the deserialized node by id.
    const a = makeValueItem(1);
    const b = makeValueItem("two");
    rebuilt.setParam({ id: "input" } as NodeHandle<DataInputParams>, "items", [a, b]);
    const r = await cook(rebuilt);
    expect(r.outputs.echo[0]).toBe(a);
    expect(r.outputs.echo[1]).toBe(b);
  });

  it("the World binds parent outputs into a deserialized child graph", async () => {
    const original = childEchoLevel({ name: "chunk", cellSize: 10, generationRadius: 9 });
    const rebuiltGraph = deserializeGraph(
      JSON.parse(JSON.stringify(serializeGraph(original.graph))),
    );
    const input = { id: original.input.id } as NodeHandle<DataInputParams>;
    const level: LevelDef = {
      name: "chunk",
      cellSize: 10,
      generationRadius: 9,
      graph: rebuiltGraph,
      bind(g, ctx) {
        g.setParam(input, "items", ctx.parent?.outputs["points"] ?? []);
      },
    };
    const world = new World({
      seed: 9,
      levels: [
        scatterLevel({ name: "planet", cellSize: "unbounded", generationRadius: 1, count: 3 }).def,
        level,
      ],
    });
    await world.update([0, 0, 0]);
    const planetPoints = world.getCell("planet", [0, 0])?.outputs.points;
    expect(planetPoints).toHaveLength(1);
    const chunks = world.cells("chunk");
    expect(chunks.length).toBeGreaterThan(0);
    for (const cell of chunks) {
      // dataInput emits exactly the injected items: identical references.
      expect(cell.outputs.parentEcho[0]).toBe(planetPoints?.[0]);
      expect(firstGeometry(cell.outputs.parentEcho)?.attrs.point.count).toBe(3);
    }
  });

  it("rejects non-empty item lists in JSON, naming node and param with the fix", () => {
    expect(() =>
      deserializeGraph({
        formatVersion: 1,
        seed: 0,
        nodes: [
          { id: "d", type: "dataInput", params: { items: [{ kind: "value", value: 1, rev: 1 }] } },
        ],
        connections: [],
        outputs: [],
      }),
    ).toThrow(
      /node "d" param "items": item lists are not serialized.*graph\.setParam after deserializing/,
    );
    expect(() =>
      deserializeGraph({
        formatVersion: 1,
        seed: 0,
        nodes: [{ id: "d", type: "dataInput", params: { items: "nope" } }],
        connections: [],
        outputs: [],
      }),
    ).toThrow(/node "d" param "items".*expected an empty array \[\]/);
  });

  it("rejects serializing a non-array items value, naming node and param", () => {
    const g = new Graph();
    const node = g.add(dataInput, undefined, "input");
    g.output(node, "out", "echo");
    g.setParam(node, "items", "nope" as never);
    expect(() => serializeGraph(g)).toThrow(
      /node "input" param "items": expected an array of DataItems/,
    );
  });
});
