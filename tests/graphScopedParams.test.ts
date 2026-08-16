/**
 * ONE VALUE, READ BY SEVERAL NODES — a graph-scoped param, checked across
 * the three layers it has to cross: the format reads it, the grammar binds
 * it into every expression that names it, and the executor cannot tell the
 * result from a graph with the number written out longhand.
 *
 * That last claim is the load-bearing one and the reason this file is in
 * `tests/` rather than beside any one module. Binding SUBSTITUTES when the
 * field is built, so a declared value lands inside `Field.key` and
 * therefore inside the node's memo key. If it did not, a knob turn would
 * cook the previous value's bytes — the failure a unit test of the reader
 * cannot see, because the reader would look right either way.
 */
import { describe, expect, it } from "vitest";
import {
  type Geometry,
  Graph,
  cook,
  deserializeGraph,
  describeGraphParams,
  serializeGraph,
} from "../src/index.js";

/**
 * A grid lifted by `position * lift`, where `lift` reaches TWO nodes — the
 * shape the feature exists for. `declared` writes it as a graph param;
 * otherwise each node carries the literal, which is what the corpus does
 * today and what the two must agree with byte for byte.
 */
function graphText(opts: { declared: boolean; lift?: number; inline?: boolean }): string {
  const lift = opts.lift ?? 2;
  const ref = opts.declared
    ? opts.inline === true
      ? { fn: "param", name: "lift", value: 99 }
      : { fn: "param", name: "lift" }
    : lift;
  const scaleBy = (node: string): Record<string, unknown> => ({
    id: node,
    type: "transformPoints",
    params: { translate: { fn: "mul", args: [{ fn: "position" }, ref] } },
  });
  return JSON.stringify({
    formatVersion: 1,
    seed: 5,
    ...(opts.declared
      ? {
          params: [
            { name: "lift", value: lift, min: 0, max: 9, description: "How high." },
          ],
        }
      : {}),
    nodes: [
      { id: "grid", type: "pointGrid", params: { countX: 3, countZ: 3 } },
      scaleBy("dunesA"),
      scaleBy("dunesB"),
    ],
    connections: [
      { from: ["grid", "out"], to: ["dunesA", "in"] },
      { from: ["dunesA", "out"], to: ["dunesB", "in"] },
    ],
    outputs: [{ id: "dunesB", pin: "out", name: "points" }],
  });
}

/** Every point position of the one declared output, in order. */
async function positions(graph: Graph): Promise<number[]> {
  const result = await cook(graph);
  const items = [...result.outputs.points];
  const geo = (items[0] as { kind: "geometry"; geo: Geometry }).geo;
  return [...(geo.attrs.point.require("P").data as Float32Array)];
}

describe("a graph-scoped param is the literal it stands for", () => {
  it("cooks byte-identically to the same graph with the number written out", async () => {
    const declared = await positions(deserializeGraph(JSON.parse(graphText({ declared: true }))));
    const longhand = await positions(deserializeGraph(JSON.parse(graphText({ declared: false }))));
    expect(declared).toEqual(longhand);
    // Control: the comparison can fail. A suite whose check has never been
    // seen to reject anything proves nothing.
    const moved = await positions(
      deserializeGraph(JSON.parse(graphText({ declared: false, lift: 2.5 }))),
    );
    expect(moved).not.toEqual(longhand);
  });

  it("round-trips through the format, values and prose intact", () => {
    const graph = deserializeGraph(JSON.parse(graphText({ declared: true })));
    expect(graph.graphParams).toEqual([
      { name: "lift", value: 2, min: 0, max: 9, description: "How high." },
    ]);
    const written = serializeGraph(graph);
    expect(written.params).toEqual([
      { name: "lift", value: 2, min: 0, max: 9, description: "How high." },
    ]);
    // And the re-read is the same graph, not merely a similar one.
    expect(serializeGraph(deserializeGraph(written))).toEqual(written);
  });

  it("writes no key at all when a graph declares none", () => {
    const written = serializeGraph(deserializeGraph(JSON.parse(graphText({ declared: false }))));
    expect("params" in written).toBe(false);
  });
});

describe("setGraphParam", () => {
  it("moves every reader and cooks the new value", async () => {
    const graph = deserializeGraph(JSON.parse(graphText({ declared: true })));
    const before = await positions(graph);
    graph.setGraphParam("lift", 3);
    expect(graph.graphParams[0].value).toBe(3);
    const after = await positions(graph);
    expect(after).not.toEqual(before);
    // The value reached BOTH readers, so it agrees with the longhand graph
    // written at the new value — not merely with something different.
    const longhand = await positions(
      deserializeGraph(JSON.parse(graphText({ declared: false, lift: 3 }))),
    );
    expect(after).toEqual(longhand);
  });

  it("re-keys the readers and nothing else", async () => {
    const graph = deserializeGraph(JSON.parse(graphText({ declared: true })));
    await cook(graph);
    const cooked: string[] = [];
    const served: string[] = [];
    graph.setGraphParam("lift", 3);
    await cook(graph, {
      onNodeDone: (info) => void (info.cached ? served : cooked).push(info.id),
    });
    // `grid` reads nothing and is upstream of both readers, so it is served
    // from cache; the two readers recook because their `Field.key` moved.
    expect(served).toEqual(["grid"]);
    expect(cooked).toEqual(["dunesA", "dunesB"]);
  });

  it("refuses a name the graph does not declare, listing what it does", () => {
    const graph = deserializeGraph(JSON.parse(graphText({ declared: true })));
    expect(() => graph.setGraphParam("drop", 1)).toThrow(
      /declares no param "drop"; declared: lift/,
    );
  });

  it("refuses a value the param's own bounds exclude", () => {
    const graph = deserializeGraph(JSON.parse(graphText({ declared: true })));
    // The bound is declared on the GRAPH, so the graph enforces it. An
    // inline `param` declares its range inside the spec and the grammar
    // refuses there; a hoisted one has no spec of its own to be refused by,
    // and a knob that could write past its own declared max would make the
    // range decoration rather than a rule.
    expect(() => graph.setGraphParam("lift", 99)).toThrow(
      /graph param "lift" is 99, outside its declared range 0\.\.9/,
    );
  });
});

describe("what the format refuses", () => {
  const read = (json: unknown): Graph => deserializeGraph(json);

  it("a duplicate name, because a reference names one value", () => {
    const json = JSON.parse(graphText({ declared: true })) as { params: unknown[] };
    json.params.push({ name: "lift", value: 4 });
    expect(() => read(json)).toThrow(/duplicate graph param "lift"/);
  });

  it("an inline value shadowing a declared name", () => {
    expect(() => read(JSON.parse(graphText({ declared: true, inline: true })))).toThrow(
      /carries its own "value", but the graph declares "lift"/,
    );
  });

  it("a name whose shape would break the address", () => {
    for (const [name, message] of [
      ["a.b", /contains a "\."/],
      ["$x", /starts with "\$"/],
    ] as const) {
      const json = JSON.parse(graphText({ declared: false })) as Record<string, unknown>;
      json.params = [{ name, value: 1 }];
      expect(() => read(json), name).toThrow(message);
    }
  });

  it("a tuple width the param vocabulary cannot name", () => {
    // Stricter than an inline value on purpose: the grammar takes any run
    // of numbers inside a spec, but a DECLARATION that no schema can
    // describe is one no knob listing can show, so it would bind silently
    // and then be invisible.
    for (const width of [[1, 2], [1, 2, 3, 4, 5]]) {
      const json = JSON.parse(graphText({ declared: false })) as Record<string, unknown>;
      json.params = [{ name: "lift", value: width }];
      expect(() => read(json), String(width.length)).toThrow(
        /which the param vocabulary cannot name/,
      );
    }
    // 3 and 4 are fine, and so is a plain number.
    for (const width of [[1, 2, 3], [1, 2, 3, 4]]) {
      const json = JSON.parse(graphText({ declared: false })) as Record<string, unknown>;
      json.params = [{ name: "lift", value: width }];
      expect(() => read(json), String(width.length)).not.toThrow();
    }
  });

  it("a value that is not a number or a tuple of them", () => {
    const json = JSON.parse(graphText({ declared: false })) as Record<string, unknown>;
    json.params = [{ name: "lift", value: "two" }];
    expect(() => read(json)).toThrow(/must hold a finite number or a non-empty array/);
  });

  it("an object instead of an array, naming the reason it is an array", () => {
    const json = JSON.parse(graphText({ declared: false })) as Record<string, unknown>;
    json.params = { lift: 2 };
    expect(() => read(json)).toThrow(/JSON.parse collapses duplicate object keys/);
  });

  it("a declaration inside a subgraph payload, naming the right home", () => {
    const json = {
      formatVersion: 1,
      seed: 1,
      nodes: [
        {
          id: "wrapped",
          type: "subgraph",
          params: {},
          subgraph: {
            graph: {
              formatVersion: 1,
              seed: 0,
              params: [{ name: "lift", value: 2 }],
              nodes: [{ id: "grid", type: "pointGrid", params: { countX: 2 } }],
              connections: [],
              outputs: [{ id: "grid", pin: "out", name: "out" }],
            },
            inputs: [],
            outputs: [{ name: "out", node: "grid", pin: "out" }],
          },
        },
      ],
      connections: [],
      outputs: [{ id: "wrapped", pin: "out", name: "points" }],
    };
    expect(() => read(json)).toThrow(/a subgraph payload's graph cannot declare "params"/);
  });
});

describe("addressing", () => {
  it("puts graph params first, with a $ and the slots that read them", () => {
    const params = describeGraphParams(
      deserializeGraph(JSON.parse(graphText({ declared: true }))),
    );
    expect(params[0]).toEqual({
      key: "$lift",
      scope: "graph",
      name: "lift",
      readers: ["dunesA.translate", "dunesB.translate"],
      schema: { type: "f32", default: 2, description: "How high.", min: 0, max: 9 },
      value: 2,
      holdsField: false,
      exposed: true,
    });
    // The node addresses still follow, unchanged in shape.
    expect(params.slice(1).every((p) => p.scope === "node")).toBe(true);
    expect(params.map((p) => p.key)).toContain("dunesA.translate");
  });

  it("reports a declaration nothing reads, which is what a rename leaves", () => {
    const json = JSON.parse(graphText({ declared: false })) as Record<string, unknown>;
    json.params = [{ name: "unread", value: 1 }];
    const first = describeGraphParams(deserializeGraph(json))[0];
    expect(first.scope === "graph" && first.readers).toEqual([]);
  });
});
