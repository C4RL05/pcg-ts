/**
 * Exposed params read by name from inside a body's field expressions,
 * end to end: registered node types, the serialized form, a registered
 * recipe's content hash, and the same mechanism under `forEach`.
 *
 * What the graph layer proves about substitution and restoring, these
 * tests take as given. What they add is that the declaration survives a
 * save/load round trip unchanged (`formatVersion` stays 1 — nothing new
 * is authored, a `targets` list is simply allowed to be empty), and that
 * the loop wrapper binds exactly like the single-cook one.
 */
import { describe, expect, it } from "vitest";
import { createPointCloud, type Geometry } from "../data/index.js";
import { type DataCollection, makeGeometryItem } from "../graph/data.js";
import {
  Graph,
  cook,
  describeSubgraphParams,
  type NodeHandle,
  subgraphNode,
} from "../graph/index.js";
import { dataInput } from "../runtime/dataInput.js";
import { fieldFromJson, fieldToJson, type FieldSpec } from "../fields/fieldJson.js";
import type { Field } from "../fields/index.js";
import { forEachNode } from "./forEach.js";
import { pointGrid, setAttribute } from "./index.js";
import {
  deserializeGraph,
  serializeGraph,
  type SerializedGraph,
  type SerializedNode,
} from "./serialize.js";
import { __resetSubgraphRegistry, registerSubgraph, subgraphContentHash } from "./subgraphRegistry.js";
import { resolveExposedParam } from "./subgraphParams.js";

/** `amp * index`: a ramp whose slope is the exposed param. */
const RAMP: FieldSpec = { fn: "mul", args: [{ fn: "param", name: "amp" }, { fn: "index" }] };

/** Every value of the "amp" attribute, in point order. */
function amps(collection: DataCollection | undefined): number[] {
  const out: number[] = [];
  for (const item of collection ?? []) {
    if (item.kind !== "geometry") continue;
    const attr = item.geo.attrs.point.require("amp");
    for (let i = 0; i < item.geo.pointCount; i++) out.push(attr.get(i));
  }
  return out;
}

/** A three-point body writing `amp * index` into an attribute. */
function rampBody(): Graph {
  const inner = new Graph(11);
  const grid = inner.add(pointGrid, { countX: 3, countY: 1, countZ: 1 }, "grid");
  const sa = inner.add(setAttribute, { name: "amp", value: fieldFromJson(RAMP) }, "sa");
  inner.connect(grid, "out", sa, "in");
  return inner;
}

function rampDef(inner: Graph) {
  return subgraphNode(inner, [], [{ name: "out", node: { id: "sa" }, pin: "out" }], [
    resolveExposedParam(inner, {
      name: "amp",
      targets: [],
      description: "Slope of the index ramp written into the amp attribute.",
      default: 1,
      min: 0,
    }),
  ]);
}

describe("a targetless exposed param feeding a body's field expression", () => {
  it("cooks the value the instance carries", async () => {
    const def = rampDef(rampBody());
    const graph = new Graph(7);
    const sub = graph.add(def, { amp: 2 }, "sub");
    graph.output(sub, "out", "out");

    expect(amps((await cook(graph)).outputs.out)).toEqual([0, 2, 4]);
    graph.setParam(sub, "amp", 0.5);
    expect(amps((await cook(graph)).outputs.out)).toEqual([0, 0.5, 1]);
  });

  it("reports itself through describeSubgraphParams, with no targets", () => {
    const def = rampDef(rampBody());
    expect(describeSubgraphParams(def)).toEqual([
      {
        name: "amp",
        schema: {
          type: "f32",
          default: 1,
          min: 0,
          // Derived rather than authored: a targetless param is read by
          // the body's field expressions, and a Field splices into one.
          acceptsField: true,
          description: "Slope of the index ramp written into the amp attribute.",
        },
        targets: [],
      },
    ]);
  });

  it("round-trips through the serialized form, reference and all", async () => {
    const def = rampDef(rampBody());
    const graph = new Graph(7);
    graph.output(graph.add(def, { amp: 2 }, "sub"), "out", "out");

    const json = serializeGraph(graph);
    expect(json.formatVersion).toBe(1);
    const node = json.nodes[0];
    expect(node.subgraph?.params).toEqual([
      {
        name: "amp",
        targets: [],
        description: "Slope of the index ramp written into the amp attribute.",
        default: 1,
        min: 0,
      },
    ]);
    // The VALUE rides on the instance; the body keeps the REFERENCE, not
    // whatever was last bound into it.
    expect(node.params).toEqual({ amp: 2 });
    const body = node.subgraph?.graph.nodes.find((n: SerializedNode) => n.id === "sa");
    expect(body?.params.value).toEqual(RAMP);

    const reloaded = deserializeGraph(json);
    expect(amps((await cook(reloaded)).outputs.out)).toEqual([0, 2, 4]);
    // A fixed point: saving what was loaded gives the same bytes.
    expect(serializeGraph(reloaded)).toEqual(json);
  });

  it("round-trips a FIELD bound to a targetless knob, as a spec on the instance", async () => {
    // The capability the knob advertises has to survive a save: the
    // VALUE is a field expression on the instance, the body still keeps
    // the reference, and reloading cooks the same numbers.
    const def = rampDef(rampBody());
    const graph = new Graph(7);
    const bound: FieldSpec = { fn: "add", args: [{ fn: "fraction" }, 1] };
    graph.output(graph.add(def, { amp: fieldFromJson(bound) }, "sub"), "out", "out");

    const json = serializeGraph(graph);
    expect(json.nodes[0].params).toEqual({ amp: bound });
    const body = json.nodes[0].subgraph?.graph.nodes.find((n: SerializedNode) => n.id === "sa");
    expect(body?.params.value).toEqual(RAMP);

    const before = amps((await cook(graph)).outputs.out);
    // index * (fraction + 1) over three points: 0, 1.5, 4.
    expect(before).toEqual([0, 1.5, 4]);
    expect(amps((await cook(deserializeGraph(json))).outputs.out)).toEqual(before);
    expect(serializeGraph(deserializeGraph(json))).toEqual(json);
  });

  it("hashes stably as a registered recipe, and cooks through a pinned ref", async () => {
    const recipe = {
      graph: rampBody(),
      outputs: [{ name: "out", node: "sa", pin: "out" }],
      params: [
        {
          name: "amp",
          targets: [],
          description: "Slope of the index ramp.",
          default: 1,
        },
      ],
    };
    __resetSubgraphRegistry();
    const first = registerSubgraph("ramp", recipe);
    __resetSubgraphRegistry();
    const second = registerSubgraph("ramp", { ...recipe, graph: rampBody() });
    expect(second.hash).toBe(first.hash);
    expect(subgraphContentHash(second.subgraph)).toBe(first.hash);
    // An omitted `targets` is the same recipe as an empty one.
    __resetSubgraphRegistry();
    const omitted = registerSubgraph("ramp", {
      ...recipe,
      graph: rampBody(),
      params: [{ name: "amp", description: "Slope of the index ramp.", default: 1 }],
    });
    expect(omitted.hash).toBe(first.hash);

    const json: SerializedGraph = {
      formatVersion: 1,
      seed: 7,
      nodes: [{ id: "sub", type: "subgraph", params: { amp: 3 }, ref: { name: "ramp", hash: first.hash } }],
      connections: [],
      outputs: [{ id: "sub", pin: "out", name: "out" }],
    };
    expect(amps((await cook(deserializeGraph(json))).outputs.out)).toEqual([0, 3, 6]);
    __resetSubgraphRegistry();
  });
});

describe("a targetless exposed param under forEach", () => {
  /** K one-point carriers, each distinctly placed and tagged. */
  function carriers(k: number): DataCollection {
    return Array.from({ length: k }, (_, i) => {
      const geo: Geometry = createPointCloud(1);
      geo.attrs.point.require("P").setTuple(0, [i, 0, 0]);
      return makeGeometryItem(geo, [`group=${i}`]);
    });
  }

  /** A body writing `amp * random` per point, so the loop's seed shows. */
  function noisyBody(): Graph {
    const inner = new Graph(11);
    inner.add(
      setAttribute,
      {
        name: "amp",
        value: fieldFromJson({
          fn: "mul",
          args: [{ fn: "param", name: "amp" }, { fn: "randomField" }],
        }),
      },
      "sa",
    );
    return inner;
  }

  function loopDef(inner: Graph) {
    return forEachNode(
      inner,
      [{ name: "each", node: { id: "sa" }, pin: "in" }],
      [{ name: "out", node: { id: "sa" }, pin: "out" }],
      [
        resolveExposedParam(inner, {
          name: "amp",
          targets: [],
          description: "Scale on the per-point random value.",
          default: 1,
        }),
      ],
    );
  }

  it("binds once for the whole loop, leaving the per-iteration seed alone", async () => {
    const def = loopDef(noisyBody());
    const graph = new Graph(7);
    const src = graph.add(dataInput, { items: carriers(3) }, "src");
    const loop = graph.add(def, { amp: 1 }, "loop");
    graph.connect(src, "out", loop, "each");
    graph.output(loop, "out", "out");

    const ones = amps((await cook(graph)).outputs.out);
    expect(ones).toHaveLength(3);
    // Each iteration rotates the inner seed on its element's content, so
    // the three values differ — the binding must not flatten that.
    expect(new Set(ones).size).toBe(3);

    graph.setParam(loop, "amp", 2);
    const twos = amps((await cook(graph)).outputs.out);
    // Exactly twice, component for component: one binding, applied to
    // every iteration, with the same randomness underneath.
    expect(twos).toEqual(ones.map((v) => v * 2));
  });

  it("binds a FIELD once for the whole loop, resolved per iteration", async () => {
    // The loop wraps its WHOLE run in one `withExposedParams`, so a
    // spliced field is installed once — but it RESOLVES against each
    // iteration's own geometry, which is what makes a per-element binding
    // mean anything under a loop. Each carrier holds one point at a
    // different x, so a field over position gives each iteration its own
    // scale from one binding.
    const def = loopDef(noisyBody());
    const graph = new Graph(7);
    const src = graph.add(dataInput, { items: carriers(3) }, "src");
    const loop = graph.add(def, { amp: 1 }, "loop");
    graph.connect(src, "out", loop, "each");
    graph.output(loop, "out", "out");
    const ones = amps((await cook(graph)).outputs.out);

    // `x + 1` over carriers at x = 0, 1, 2: scales of 1, 2, 3.
    graph.setParam(
      loop,
      "amp",
      fieldFromJson({
        fn: "add",
        args: [{ fn: "component", args: [{ fn: "position" }], index: 0 }, 1],
      }),
    );
    const scaled = amps((await cook(graph)).outputs.out);
    // `fround` because a field column is f32: the expectation is computed
    // in f64 here and stored in f32 there, which is the storage type and
    // not the binding.
    expect(scaled).toEqual(ones.map((v, i) => Math.fround(v * (i + 1))));
    // The body is left holding the reference, exactly as after a scalar.
    expect(serializeGraph(graph).nodes.find((n: SerializedNode) => n.id === "loop")?.params).toEqual({
      amp: { fn: "add", args: [{ fn: "component", args: [{ fn: "position" }], index: 0 }, 1] },
    });
  });

  it("round-trips as a forEach payload and cooks identically", async () => {
    const def = loopDef(noisyBody());
    const graph = new Graph(7);
    const src = graph.add(dataInput, { items: carriers(3) }, "src");
    const loop = graph.add(def, { amp: 2 }, "loop");
    graph.connect(src, "out", loop, "each");
    graph.output(loop, "out", "out");
    const before = amps((await cook(graph)).outputs.out);

    const json = serializeGraph(graph);
    expect(json.nodes.find((n: SerializedNode) => n.id === "loop")?.subgraph?.params?.[0].targets).toEqual(
      [],
    );
    const reloaded = deserializeGraph(json);
    // Item lists are runtime-injected and serialize as [], so the reloaded
    // source needs the same carriers put back on it.
    const src2: NodeHandle<{ items: DataCollection }> = { id: "src" };
    reloaded.setParam(src2, "items", carriers(3));
    expect(amps((await cook(reloaded)).outputs.out)).toEqual(before);
  });
});

/**
 * The same knob without a wrapper: a `param` node carrying its own
 * `value`, which is what makes a PLAIN node's field expression tunable.
 * The wrapper existed only to hold a number, and a spec that holds its own
 * needs none — while a wrapper that does exist still wins, so the two
 * mechanisms compose in the one order that makes sense.
 */
describe("a param that carries its own value", () => {
  /** `amp * index` with the slope written into the reference itself. */
  const selfRamp = (value: number): FieldSpec => ({
    fn: "mul",
    args: [{ fn: "param", name: "amp", value }, { fn: "index" }],
  });

  /** A plain three-point graph, no subgraph anywhere. */
  function plainGraph(spec: FieldSpec): Graph {
    const g = new Graph(7);
    const grid = g.add(pointGrid, { countX: 3, countY: 1, countZ: 1 }, "grid");
    const sa = g.add(setAttribute, { name: "amp", value: fieldFromJson(spec) }, "sa");
    g.connect(grid, "out", sa, "in");
    g.output(sa, "out", "out");
    return g;
  }

  it("cooks standalone, with no wrapper to carry the value", async () => {
    expect(amps((await cook(plainGraph(selfRamp(2)))).outputs.out)).toEqual([0, 2, 4]);
    expect(amps((await cook(plainGraph(selfRamp(0.5)))).outputs.out)).toEqual([0, 0.5, 1]);
  });

  it("survives serialization, where a bound value does not", async () => {
    const json = serializeGraph(plainGraph(selfRamp(2)));
    // Additive: the format is unchanged, and a `value` key is simply
    // allowed inside a `param` node. Bumping would move `hashableGraph`
    // and break every pinned `ref` hash for a purely additive key.
    expect(json.formatVersion).toBe(1);
    const value = (json.nodes.find((n: SerializedNode) => n.id === "sa") as SerializedNode).params
      ?.value as FieldSpec;
    expect(value).toEqual(selfRamp(2));
    // Reloaded from actual JSON text, so nothing rides on object identity.
    const reloaded = deserializeGraph(JSON.parse(JSON.stringify(json)) as SerializedGraph);
    expect(amps((await cook(reloaded)).outputs.out)).toEqual([0, 2, 4]);
  });

  it("produces exactly what the wrapper-with-an-exposed-param produced", async () => {
    // The migration claim: rewriting a graph from "wrap it to carry the
    // number" to "write the number in" is a rewrite of the plumbing and
    // not of the output.
    const wrapped = new Graph(7);
    wrapped.output(wrapped.add(rampDef(rampBody()), { amp: 2 }, "sub"), "out", "out");
    const viaWrapper = amps((await cook(wrapped)).outputs.out);
    const viaInline = amps((await cook(plainGraph(selfRamp(2)))).outputs.out);
    expect(viaInline).toEqual(viaWrapper);
    expect(Object.is(viaInline[1], viaWrapper[1])).toBe(true);
  });

  it("is overridden by a subgraph that exposes the same name", async () => {
    // Precedence, through the real seam: `withExposedParams` rebuilds the
    // body's expression against the instance's value, and the rebuild's
    // binding beats the value written in the spec.
    const inner = new Graph(11);
    const grid = inner.add(pointGrid, { countX: 3, countY: 1, countZ: 1 }, "grid");
    const sa = inner.add(setAttribute, { name: "amp", value: fieldFromJson(selfRamp(2)) }, "sa");
    inner.connect(grid, "out", sa, "in");

    const graph = new Graph(7);
    const sub = graph.add(rampDef(inner), { amp: 10 }, "sub");
    graph.output(sub, "out", "out");
    expect(amps((await cook(graph)).outputs.out)).toEqual([0, 10, 20]);
    graph.setParam(sub, "amp", 3);
    expect(amps((await cook(graph)).outputs.out)).toEqual([0, 3, 6]);
    // And the body is left exactly as it was found: the restore puts the
    // self-supplied expression back, so the inner graph still cooks — and
    // still serializes — as the author wrote it.
    expect(amps((await cook(inner)).outputs.out ?? [])).toEqual([]);
    const restored = inner.require("sa").params.value;
    expect(fieldToJson(restored as Field)).toEqual(selfRamp(2));
  });

  it("needs no declaration when the body supplies itself", async () => {
    // A wrapper that exposes NOTHING must still cook a body whose
    // expression carries its own value: a reference nothing has to supply
    // is not a reference the wrapper forgot. Before inline values, every
    // `param` in a body was a declaration the wrapper owed.
    const inner = new Graph(11);
    const grid = inner.add(pointGrid, { countX: 3, countY: 1, countZ: 1 }, "grid");
    const sa = inner.add(setAttribute, { name: "amp", value: fieldFromJson(selfRamp(2)) }, "sa");
    inner.connect(grid, "out", sa, "in");

    const bare = subgraphNode(inner, [], [{ name: "out", node: { id: "sa" }, pin: "out" }], []);
    const graph = new Graph(7);
    graph.output(graph.add(bare, {}, "sub"), "out", "out");
    expect(amps((await cook(graph)).outputs.out)).toEqual([0, 2, 4]);
  });

  it("still refuses a body reference that supplies nothing", async () => {
    // The refusal is unchanged where it was earned: one reference with a
    // value and one without, and only the bare one is owed a declaration.
    const inner = new Graph(11);
    const grid = inner.add(pointGrid, { countX: 3, countY: 1, countZ: 1 }, "grid");
    const sa = inner.add(
      setAttribute,
      {
        name: "amp",
        value: fieldFromJson({
          fn: "add",
          args: [selfRamp(2), { fn: "param", name: "bias" }],
        }),
      },
      "sa",
    );
    inner.connect(grid, "out", sa, "in");

    expect(() => subgraphNode(inner, [], [{ name: "out", node: { id: "sa" }, pin: "out" }], [])).toThrow(
      /reads \{"fn": "param", "name": "bias"\}, but this wrapper exposes no param "bias"/,
    );
  });
});
