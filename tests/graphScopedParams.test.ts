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
  type NodeHandle,
  cook,
  deserializeGraph,
  describeGraphParams,
  serializeGraph,
  strandedGraphParamValues,
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
      readings: 2,
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

/**
 * TARGETS — the half of the format an expression cannot reach.
 *
 * Every field-capable param in the registry is `f32`, `vec3` or `vec4`, so
 * a value that travels by SUBSTITUTION can only ever be a number. A
 * declaration with `targets` travels by being WRITTEN instead, which is
 * what lets one name drive an `i32` count, an `enum` mode or a `bool`.
 */
describe("a graph param with targets", () => {
  const withTargets = (value: unknown, targets: unknown, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      formatVersion: 1,
      seed: 5,
      params: [{ name: "sides", value, targets, ...extra }],
      nodes: [
        { id: "a", type: "pointGrid", params: { countX: 2, countZ: 2 } },
        { id: "b", type: "pointGrid", params: { countX: 2, countZ: 2 } },
      ],
      connections: [],
      outputs: [{ id: "a", pin: "out", name: "points" }],
    });

  it("writes an i32 into every target and types itself from them", () => {
    const graph = deserializeGraph(
      JSON.parse(
        withTargets(7, [
          { node: "a", param: "countX" },
          { node: "b", param: "countX" },
        ]),
      ),
    );
    // Written, not merely declared — this is the whole difference.
    for (const id of ["a", "b"]) {
      expect(graph.getParams({ id } as NodeHandle<{ countX: number }>).countX, id).toBe(7);
    }
    const described = describeGraphParams(graph)[0];
    expect(described.key).toBe("$sides");
    // i32, from the TARGETS — a value's own shape would have said f32, and
    // an f32 knob writing 7.5 into a count is exactly what that would cost.
    expect(described.schema.type).toBe("i32");
    expect(described.scope === "graph" && described.readers).toEqual(["a.countX", "b.countX"]);
  });

  it("reaches an enum, which no expression can", () => {
    const graph = deserializeGraph(
      JSON.parse(
        JSON.stringify({
          formatVersion: 1,
          seed: 1,
          params: [
            {
              name: "placement",
              value: "spacing",
              targets: [
                { node: "r1", param: "mode" },
                { node: "r2", param: "mode" },
              ],
            },
          ],
          nodes: [
            { id: "line", type: "pointLine", params: { count: 4 } },
            { id: "path", type: "pointsToPath", params: {} },
            { id: "r1", type: "pathResample", params: {} },
            { id: "r2", type: "pathResample", params: {} },
          ],
          connections: [
            { from: ["line", "out"], to: ["path", "in"] },
            { from: ["path", "out"], to: ["r1", "in"] },
            { from: ["r1", "out"], to: ["r2", "in"] },
          ],
          outputs: [{ id: "r2", pin: "out", name: "points" }],
        }),
      ),
    );
    for (const id of ["r1", "r2"]) {
      expect(graph.getParams({ id } as NodeHandle<{ mode: string }>).mode, id).toBe("spacing");
    }
    const schema = describeGraphParams(graph)[0].schema;
    expect(schema.type).toBe("enum");
    expect(schema.enum).toEqual(["count", "spacing"]);
    // And the enum is enforced, from the targets' own declaration.
    expect(() => graph.setGraphParam("placement", "sideways")).toThrow(/count|spacing/);
  });

  it("turning it moves every target", () => {
    const graph = deserializeGraph(
      JSON.parse(
        withTargets(7, [
          { node: "a", param: "countX" },
          { node: "b", param: "countX" },
        ]),
      ),
    );
    graph.setGraphParam("sides", 9);
    for (const id of ["a", "b"]) {
      expect(graph.getParams({ id } as NodeHandle<{ countX: number }>).countX, id).toBe(9);
    }
  });

  it("refuses a value its targets would reject, naming the bound", () => {
    // `pointGrid.countX` is i32 with min 1. The merged schema carries that,
    // so the declaration cannot smuggle a 0 past the param it drives.
    expect(() =>
      deserializeGraph(JSON.parse(withTargets(0, [{ node: "a", param: "countX" }]))),
    ).toThrow(/1/);
    expect(() =>
      deserializeGraph(JSON.parse(withTargets(2.5, [{ node: "a", param: "countX" }]))),
    ).toThrow(/integer/i);
  });

  it("refuses targets that disagree on type", () => {
    expect(() =>
      deserializeGraph(
        JSON.parse(
          withTargets(2, [
            { node: "a", param: "countX" },
            { node: "a", param: "spacing" },
          ]),
        ),
      ),
    ).toThrow(/disagree on type/);
  });

  it("names an unknown node or param rather than ignoring it", () => {
    expect(() =>
      deserializeGraph(JSON.parse(withTargets(2, [{ node: "nope", param: "countX" }]))),
    ).toThrow(/unknown inner node "nope"/);
    expect(() =>
      deserializeGraph(JSON.parse(withTargets(2, [{ node: "a", param: "nope" }]))),
    ).toThrow(/nope/);
  });

  it("round-trips its targets, and not its derived schema", () => {
    const text = withTargets(7, [{ node: "a", param: "countX" }], { description: "Sides." });
    const written = serializeGraph(deserializeGraph(JSON.parse(text)));
    expect(written.params).toEqual([
      { name: "sides", value: 7, targets: [{ node: "a", param: "countX" }], description: "Sides." },
    ]);
    // The schema is re-derived on every load from the registry, so writing
    // it would be a second copy of a truth that already has an owner.
    expect(JSON.stringify(written.params)).not.toContain("i32");
    expect(serializeGraph(deserializeGraph(written))).toEqual(written);
  });
});

describe("what a listing and a refusal now say", () => {
  it("counts READINGS as well as slots", () => {
    // One expression, one slot, two readings of the same name — which is
    // the whole case for hoisting it. A slot count alone reports "1".
    const graph = deserializeGraph(
      JSON.parse(
        JSON.stringify({
          formatVersion: 1,
          seed: 2,
          params: [{ name: "k", value: 3 }],
          nodes: [
            { id: "grid", type: "pointGrid", params: { countX: 2, countZ: 2 } },
            {
              id: "t",
              type: "transformPoints",
              params: {
                translate: {
                  fn: "mul",
                  args: [
                    { fn: "mul", args: [{ fn: "position" }, { fn: "param", name: "k" }] },
                    { fn: "param", name: "k" },
                  ],
                },
              },
            },
          ],
          connections: [{ from: ["grid", "out"], to: ["t", "in"] }],
          outputs: [{ id: "t", pin: "out", name: "points" }],
        }),
      ),
    );
    const p = describeGraphParams(graph)[0];
    expect(p.scope === "graph" && p.readers).toEqual(["t.translate"]);
    expect(p.scope === "graph" && p.readings).toBe(2);
  });

  it("tells an author what to do when a field spec lands on an i32", () => {
    // The bare "expected an integer" left them guessing. The rule they
    // cannot know is that NO i32 is field-capable, and the route that works
    // is a targeted graph param.
    const json = {
      formatVersion: 1,
      seed: 1,
      nodes: [
        { id: "g", type: "pointGrid", params: { countX: { fn: "param", name: "n" } } },
      ],
      connections: [],
      outputs: [{ id: "g", pin: "out", name: "points" }],
    };
    expect(() => deserializeGraph(json)).toThrow(/never field-capable/);
    expect(() => deserializeGraph(json)).toThrow(/declare a graph param with "targets"/);
    // And it still says what was actually wrong, first.
    expect(() => deserializeGraph(json)).toThrow(/expected an integer/);
  });

  it("says nothing extra when the value is simply the wrong number", () => {
    // The advice is gated on the value LOOKING like a field spec; a plain
    // bad number must not collect a paragraph about expressions.
    const json = {
      formatVersion: 1,
      seed: 1,
      nodes: [{ id: "g", type: "pointGrid", params: { countX: 2.5 } }],
      connections: [],
      outputs: [{ id: "g", pin: "out", name: "points" }],
    };
    expect(() => deserializeGraph(json)).toThrow(/expected an integer/);
    expect(() => deserializeGraph(json)).not.toThrow(/field-capable/);
  });
});

/**
 * THE LINT FOR THE CLASS OF BUG A SUBGRAPH BOUNDARY HIDES.
 *
 * A body is bound by its wrapper and by nothing else, so a constant in a
 * body that is a copy of a declared graph param keeps cooking correctly and
 * desyncs the moment the knob moves. It happened in the rig. Nothing could
 * report it: `--params` sees addresses and a constant is not one, the
 * fingerprint sees the default cook and that is unchanged, and a text
 * migration stops at the boundary.
 */
describe("strandedGraphParamValues", () => {
  const bodyHolding = (constant: number, declaredValue: number): Graph =>
    deserializeGraph(
      JSON.parse(
        JSON.stringify({
          formatVersion: 1,
          seed: 3,
          params: [{ name: "halfWidth", value: declaredValue }],
          nodes: [
            {
              id: "wrap",
              type: "subgraph",
              params: {},
              subgraph: {
                graph: {
                  formatVersion: 1,
                  seed: 0,
                  nodes: [
                    { id: "grid", type: "pointGrid", params: { countX: 2, countZ: 2 } },
                    {
                      id: "move",
                      type: "transformPoints",
                      params: {
                        translate: {
                          fn: "vec",
                          args: [{ fn: "constant", value: constant }, 0, 0],
                        },
                      },
                    },
                  ],
                  connections: [{ from: ["grid", "out"], to: ["move", "in"] }],
                  outputs: [{ id: "move", pin: "out", name: "out" }],
                },
                inputs: [],
                outputs: [{ name: "out", node: "move", pin: "out" }],
              },
            },
          ],
          connections: [],
          outputs: [{ id: "wrap", pin: "out", name: "points" }],
        }),
      ),
    );

  it("catches the rig's actual bug: a half-diagonal frozen in a body", () => {
    // 0.425 * √2 — the relationship, not a coincidence, and the exact
    // number the cable wraps carried while its eighteen siblings went live.
    const found = strandedGraphParamValues(bodyHolding(0.425 * Math.SQRT2, 0.425));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      name: "halfWidth",
      slot: "wrap",
      innerSlot: "move.translate",
      value: 0.425 * Math.SQRT2,
    });
  });

  it("catches a derived-looking exact copy", () => {
    expect(strandedGraphParamValues(bodyHolding(0.6010407640085654, 0.6010407640085654))).toHaveLength(1);
  });

  it("stays quiet on a short round number, which is what a coincidence is", () => {
    // Measured on the rig: reporting every exact match produced exactly one
    // finding and it was a coincidence. A lint nobody believes is worse
    // than no lint, and the cost — a frozen 0.5 goes uncaught — is the
    // trade this makes on purpose.
    expect(strandedGraphParamValues(bodyHolding(0.55, 0.55))).toEqual([]);
    expect(strandedGraphParamValues(bodyHolding(7, 7))).toEqual([]);
  });

  it("stays quiet when the body holds an unrelated number", () => {
    expect(strandedGraphParamValues(bodyHolding(1.2345678901234, 0.425))).toEqual([]);
  });

  it("has nothing to say about a graph that declares no params", () => {
    const graph = deserializeGraph(JSON.parse(graphText({ declared: false })));
    expect(strandedGraphParamValues(graph)).toEqual([]);
  });
});

describe("a target that already holds an expression", () => {
  const drivingAField = (declaredValue: number) =>
    JSON.parse(
      JSON.stringify({
        formatVersion: 1,
        seed: 5,
        params: [{ name: "lift", value: declaredValue, targets: [{ node: "t", param: "translate" }] }],
        nodes: [
          { id: "g", type: "pointGrid", params: { countX: 2, countZ: 2 } },
          {
            id: "t",
            type: "transformPoints",
            params: { translate: { fn: "mul", args: [{ fn: "position" }, 2] } },
          },
        ],
        connections: [{ from: ["g", "out"], to: ["t", "in"] }],
        outputs: [{ id: "t", pin: "out", name: "points" }],
      }),
    );

  it("is refused, because the alternative is a file that lies", () => {
    // Measured before this refusal existed: the declared 3 won, the cook
    // produced a flat 3, and the JSON still showed `mul(position, 2)` — a
    // graph doing something its own text does not say, which is the hazard
    // class the stranded-value lint exists for.
    expect(() => deserializeGraph(drivingAField(3))).toThrow(/holds a FIELD EXPRESSION/);
    // And it names both ways out rather than only the problem.
    expect(() => deserializeGraph(drivingAField(3))).toThrow(/drop the expression|READ the name/);
  });

  it("still allows the same value to reach that param by being READ", () => {
    // The other route the refusal names: no target, and the expression
    // itself references the name. Same one declared value, no dead text.
    const json = drivingAField(3) as {
      params: { targets?: unknown }[];
      nodes: { id: string; params: Record<string, unknown> }[];
    };
    delete json.params[0].targets;
    json.nodes[1].params.translate = {
      fn: "mul",
      args: [{ fn: "position" }, { fn: "param", name: "lift" }],
    };
    const graph = deserializeGraph(json);
    const described = describeGraphParams(graph)[0];
    expect(described.scope === "graph" && described.readers).toEqual(["t.translate"]);
  });
});
