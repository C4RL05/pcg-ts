/**
 * Exposed params, at the layer that stores and cooks them. Schemas arrive
 * already resolved (the registry lives above this layer), so these tests
 * hand-build them — which is also the only way to check that this layer
 * validates what it can validate on its own: that every target exists.
 *
 * The properties under test are the two the design turns on. Values live
 * in the WRAPPING INSTANCE's params record, so the executor's existing
 * param hashing keys each instance's cache on its own values with no
 * change to the executor. And the inward write is QUIET, so it does not
 * bump the inner graph's version — a loud one would change the wrapper's
 * transitive version key on every cook and the wrapper would never serve
 * its cache at all.
 */
import { describe, expect, it } from "vitest";
import { constant, isField } from "../fields/index.js";
import { type DataCollection, makeValueItem } from "./data.js";
import { GraphValidationError } from "./errors.js";
import { cook } from "./execute.js";
import { Graph } from "./graph.js";
import { defineNode } from "./node.js";
import type { ParamSchema } from "./params.js";
import { describeSubgraphParams, getSubgraphSpec, subgraphNode } from "./subgraph.js";

/** Readable form of whatever a probe cooked with, Fields included. */
function show(value: unknown): string {
  return isField(value) ? `F(${value.key})` : JSON.stringify(value);
}

/**
 * A node with one param that records every value it cooked with and
 * passes it on, so a test can see exactly which inner nodes ran and what
 * reached them.
 */
function probeNode(type: string) {
  const seen: string[] = [];
  const def = defineNode<{ amount: unknown }>({
    type,
    inputs: [],
    outputs: [{ name: "out", kind: "value" }],
    defaultParams: { amount: 0 },
    execute({ params }) {
      seen.push(show(params.amount));
      return { out: [makeValueItem(show(params.amount))] };
    },
  });
  return { def, seen };
}

/**
 * A probe that refuses one particular value, so a cook can fail AFTER the
 * wrapper has written its exposed values inward.
 */
function refusingNode(type: string, refuses: unknown) {
  const seen: string[] = [];
  const def = defineNode<{ amount: unknown }>({
    type,
    inputs: [],
    outputs: [{ name: "out", kind: "value" }],
    defaultParams: { amount: 0 },
    execute({ params }) {
      if (params.amount === refuses) throw new Error(`${type}: refuses ${show(refuses)}`);
      seen.push(show(params.amount));
      return { out: [makeValueItem(show(params.amount))] };
    },
  });
  return { def, seen };
}

const f32: ParamSchema = { type: "f32", default: 0, description: "A number." };
const f32Field: ParamSchema = { ...f32, acceptsField: true };

function valueOf(collection: DataCollection | undefined): unknown {
  const item = collection?.[0];
  return item?.kind === "value" ? item.value : undefined;
}

describe("subgraphNode exposed params — declaration", () => {
  it("rejects a target naming an inner node that does not exist, listing the ones that do", () => {
    const inner = new Graph();
    const a = probeNode("decl_missing_node");
    inner.add(a.def, undefined, "a");
    expect(() =>
      subgraphNode(inner, [], [], [
        { name: "amount", targets: [{ node: { id: "nope" }, param: "amount" }], schema: f32 },
      ]),
    ).toThrow(/exposed param "amount": unknown inner node "nope"; inner nodes: a/);
  });

  it("rejects a target naming a param the inner node does not have, listing its params", () => {
    const inner = new Graph();
    const a = probeNode("decl_missing_param");
    const h = inner.add(a.def, undefined, "a");
    expect(() =>
      subgraphNode(inner, [], [], [
        { name: "amount", targets: [{ node: h, param: "amont" }], schema: f32 },
      ]),
    ).toThrow(
      /exposed param "amount": node "a" \(type "decl_missing_param"\) has no param "amont"; params: amount/,
    );
  });

  it("rejects two exposed params sharing a name", () => {
    const inner = new Graph();
    const a = probeNode("decl_duplicate");
    const h = inner.add(a.def, undefined, "a");
    expect(() =>
      subgraphNode(inner, [], [], [
        { name: "amount", targets: [{ node: h, param: "amount" }], schema: f32 },
        { name: "amount", targets: [{ node: h, param: "amount" }], schema: f32 },
      ]),
    ).toThrow(/duplicate exposed param "amount"/);
  });

  it("rejects an exposed param with no targets", () => {
    const inner = new Graph();
    const a = probeNode("decl_no_targets");
    inner.add(a.def, undefined, "a");
    expect(() => subgraphNode(inner, [], [], [{ name: "amount", targets: [], schema: f32 }])).toThrow(
      /exposed param "amount": needs at least one inner target/,
    );
  });

  it("gives fresh instances the schema default, copied off the authored schema at wrap time", () => {
    const inner = new Graph();
    const a = probeNode("decl_defaults");
    const h = inner.add(a.def, undefined, "a");
    const schema: ParamSchema = { type: "vec3", default: [1, 2, 3], description: "A vector." };
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
      { name: "amount", targets: [{ node: h, param: "amount" }], schema },
    ]);
    // Wrapping COPIES the array off the authored schema, so a later edit
    // to the caller's object cannot reach instances or the recorded spec.
    (schema.default as number[])[0] = 99;

    const g = new Graph();
    const one = g.add(def, undefined, "one");
    const two = g.add(def, undefined, "two");
    expect(g.getParams(one).amount).toEqual([1, 2, 3]);
    expect(describeSubgraphParams(def)?.[0].schema.default).toEqual([1, 2, 3]);

    // Instances SHARE that one array, exactly as they do for a native
    // node's array default — `Graph.add` shallow-merges, so a default is
    // aliased until it is replaced. Asserted rather than wished away: the
    // library-wide rule is that param values are treated as frozen and
    // changed only through setParam, which REPLACES per instance.
    expect(g.getParams(one).amount).toBe(g.getParams(two).amount);
    g.setParam(two, "amount", [9, 9, 9]);
    expect(g.getParams(one).amount).toEqual([1, 2, 3]);
    expect(g.getParams(two).amount).toEqual([9, 9, 9]);
  });

  it("rejects two exposed params bound to one inner slot, naming both and the slot", () => {
    const inner = new Graph();
    const a = probeNode("decl_shared_slot");
    const h = inner.add(a.def, undefined, "a");
    // Accepting this makes "second" win every cook while "first" stays a
    // live-looking knob whose every change forces a recook that cannot
    // change the output.
    const wrap = () =>
      subgraphNode(inner, [], [], [
        { name: "first", targets: [{ node: h, param: "amount" }], schema: f32 },
        { name: "second", targets: [{ node: h, param: "amount" }], schema: f32 },
      ]);
    expect(wrap).toThrow(GraphValidationError);
    expect(wrap).toThrow(
      /exposed params "first" and "second" both write to the inner slot "a"\.amount; one slot holds one value/,
    );
  });

  it("allows two exposed params on two different params of one inner node", () => {
    const inner = new Graph();
    const two = defineNode<{ amount: unknown; other: unknown }>({
      type: "decl_two_slots",
      inputs: [],
      outputs: [{ name: "out", kind: "value" }],
      defaultParams: { amount: 0, other: 0 },
      execute: ({ params }) => ({ out: [makeValueItem(show(params.amount))] }),
    });
    const h = inner.add(two, undefined, "a");
    // The slot is `(node, param)`, not the node: sharing a node is normal.
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
      { name: "first", targets: [{ node: h, param: "amount" }], schema: f32 },
      { name: "second", targets: [{ node: h, param: "other" }], schema: f32 },
    ]);
    expect(describeSubgraphParams(def)?.map((p) => p.name)).toEqual(["first", "second"]);
  });

  it("rejects one exposed param listing the same inner slot twice", () => {
    const inner = new Graph();
    const a = probeNode("decl_repeated_slot");
    const h = inner.add(a.def, undefined, "a");
    expect(() =>
      subgraphNode(inner, [], [], [
        {
          name: "amount",
          targets: [
            { node: h, param: "amount" },
            { node: h, param: "amount" },
          ],
          schema: f32,
        },
      ]),
    ).toThrow(/exposed param "amount" lists the inner slot "a"\.amount twice/);
  });

  it("describes its params, and reports them on the recorded spec", () => {
    const inner = new Graph();
    const a = probeNode("decl_describe_a");
    const b = probeNode("decl_describe_b");
    const ha = inner.add(a.def, undefined, "a");
    const hb = inner.add(b.def, undefined, "b");
    const def = subgraphNode(inner, [], [{ name: "out", node: ha, pin: "out" }], [
      {
        name: "amount",
        targets: [
          { node: ha, param: "amount" },
          { node: hb, param: "amount" },
        ],
        schema: f32,
      },
    ]);
    expect(describeSubgraphParams(def)).toEqual([
      {
        name: "amount",
        schema: f32,
        targets: [
          { node: "a", param: "amount" },
          { node: "b", param: "amount" },
        ],
      },
    ]);
    expect(getSubgraphSpec(def)?.params.map((p) => p.name)).toEqual(["amount"]);
  });

  it("reports no params for a wrapper that exposes none, and undefined for a plain def", () => {
    const inner = new Graph();
    const a = probeNode("decl_describe_none");
    const h = inner.add(a.def, undefined, "a");
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }]);
    expect(describeSubgraphParams(def)).toEqual([]);
    expect(describeSubgraphParams(a.def)).toBeUndefined();
  });

  it("names the exposed param when a later edit removes the inner node it binds", () => {
    const inner = new Graph();
    const a = probeNode("decl_describe_removed");
    const h = inner.add(a.def, undefined, "a");
    const def = subgraphNode(inner, [], [], [
      { name: "amount", targets: [{ node: h, param: "amount" }], schema: f32 },
    ]);
    inner.removeNode(h);
    expect(() => describeSubgraphParams(def)).toThrow(GraphValidationError);
    expect(() => describeSubgraphParams(def)).toThrow(
      /exposed param "amount" writes to inner node "a", which no longer exists/,
    );
  });
});

describe("subgraphNode exposed params — cooking", () => {
  /**
   * One inner graph: two probes, only the first bound to the exposed
   * param. The second is the control for "nothing else recooks".
   */
  function build(type: string, schema: ParamSchema = f32) {
    const inner = new Graph(3);
    const bound = probeNode(`${type}_bound`);
    const free = probeNode(`${type}_free`);
    const hb = inner.add(bound.def, undefined, "bound");
    const hf = inner.add(free.def, undefined, "free");
    const def = subgraphNode(
      inner,
      [],
      [
        { name: "bound", node: hb, pin: "out" },
        { name: "free", node: hf, pin: "out" },
      ],
      [{ name: "amount", targets: [{ node: hb, param: "amount" }], schema }],
    );
    const graph = new Graph(7);
    const sub = graph.add(def, undefined, "sub");
    graph.output(sub, "bound", "bound");
    graph.output(sub, "free", "free");
    return { graph, sub, bound, free, inner };
  }

  it("writes the value into the inner target at cook time", async () => {
    const { graph, sub } = build("cook_write");
    expect(valueOf((await cook(graph)).outputs.bound)).toBe("0");
    graph.setParam(sub, "amount", 4);
    expect(valueOf((await cook(graph)).outputs.bound)).toBe("4");
  });

  it("recooks on a change, recooks nothing else, and caches on an unchanged re-cook", async () => {
    const { graph, sub, bound, free } = build("cook_cache");

    const first = await cook(graph);
    expect(first.stats.cooked).toBe(1);
    expect(bound.seen).toEqual(["0"]);
    expect(free.seen).toEqual(["0"]);

    // Nothing changed: the wrapper serves its own cache and the inner
    // graph is not entered at all. This is the assertion that reddens if
    // the inward write is made loud — a loud write bumps the inner
    // version, which is folded into the wrapper's memo key.
    const second = await cook(graph);
    expect(second.stats).toMatchObject({ cooked: 0, cached: 1 });
    expect(bound.seen).toEqual(["0"]);
    expect(free.seen).toEqual(["0"]);

    // A new value: the wrapper recooks, and inside, ONLY the node the
    // value reached executes again. The unbound probe stays cached.
    graph.setParam(sub, "amount", 4);
    const third = await cook(graph);
    expect(third.stats).toMatchObject({ cooked: 1, cached: 0 });
    expect(bound.seen).toEqual(["0", "4"]);
    expect(free.seen).toEqual(["0"]);
    expect(valueOf(third.outputs.bound)).toBe("4");
    expect(valueOf(third.outputs.free)).toBe("0");

    // Written again with the value it already holds: a cache hit. The
    // assertion that reddens if the value stopped entering the memo key
    // in a stable way.
    graph.setParam(sub, "amount", 4);
    const fourth = await cook(graph);
    expect(fourth.stats).toMatchObject({ cooked: 0, cached: 1 });
    expect(bound.seen).toEqual(["0", "4"]);
  });

  it("leaves siblings in the outer graph alone when only an exposed param changes", async () => {
    const { graph, sub } = build("cook_sibling");
    const sibling = probeNode("cook_sibling_outer");
    const other = graph.add(sibling.def, undefined, "other");
    graph.output(other, "out", "other");

    await cook(graph);
    expect(sibling.seen).toEqual(["0"]);
    graph.setParam(sub, "amount", 2);
    const after = await cook(graph);
    // Two nodes in the graph; exactly one of them recooked.
    expect(after.stats).toMatchObject({ cooked: 1, cached: 1 });
    expect(sibling.seen).toEqual(["0"]);
  });

  it("keeps two instances of one def on their own values and their own caches", async () => {
    const inner = new Graph(3);
    const p = probeNode("cook_two_instances");
    const h = inner.add(p.def, undefined, "p");
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
      { name: "amount", targets: [{ node: h, param: "amount" }], schema: f32 },
    ]);
    const graph = new Graph(7);
    const one = graph.add(def, { amount: 1 }, "one");
    const two = graph.add(def, { amount: 2 }, "two");
    graph.output(one, "out", "one");
    graph.output(two, "out", "two");
    const r = await cook(graph);
    // A def-level side table could not do this: a def is shared by its
    // instances and memoKey() cannot see which one is cooking.
    expect(valueOf(r.outputs.one)).toBe("1");
    expect(valueOf(r.outputs.two)).toBe("2");
  });

  it("fans one value out to several inner params", async () => {
    const inner = new Graph(3);
    const a = probeNode("cook_fanout_a");
    const b = probeNode("cook_fanout_b");
    const ha = inner.add(a.def, undefined, "a");
    const hb = inner.add(b.def, undefined, "b");
    const def = subgraphNode(
      inner,
      [],
      [
        { name: "a", node: ha, pin: "out" },
        { name: "b", node: hb, pin: "out" },
      ],
      [
        {
          name: "amount",
          targets: [
            { node: ha, param: "amount" },
            { node: hb, param: "amount" },
          ],
          schema: f32,
        },
      ],
    );
    const graph = new Graph(7);
    const sub = graph.add(def, { amount: 5 }, "sub");
    graph.output(sub, "a", "a");
    graph.output(sub, "b", "b");
    const r = await cook(graph);
    expect(valueOf(r.outputs.a)).toBe("5");
    expect(valueOf(r.outputs.b)).toBe("5");
  });

  it("carries one Field to every field-capable target, and hashes it by identity", async () => {
    const inner = new Graph(3);
    const a = probeNode("cook_field_a");
    const b = probeNode("cook_field_b");
    const ha = inner.add(a.def, undefined, "a");
    const hb = inner.add(b.def, undefined, "b");
    const def = subgraphNode(
      inner,
      [],
      [
        { name: "a", node: ha, pin: "out" },
        { name: "b", node: hb, pin: "out" },
      ],
      [
        {
          name: "amount",
          targets: [
            { node: ha, param: "amount", acceptsField: true },
            { node: hb, param: "amount", acceptsField: true },
          ],
          schema: f32Field,
        },
      ],
    );
    const graph = new Graph(7);
    const sub = graph.add(def, undefined, "sub");
    graph.output(sub, "a", "a");
    graph.output(sub, "b", "b");

    const field = constant(0.25);
    graph.setParam(sub, "amount", field);
    const first = await cook(graph);
    expect(valueOf(first.outputs.a)).toBe(`F(${field.key})`);
    expect(valueOf(first.outputs.b)).toBe(`F(${field.key})`);

    // Hashed by the field's stable structural key: the same field
    // re-cooks from cache, a different one does not.
    expect((await cook(graph)).stats).toMatchObject({ cooked: 0, cached: 1 });
    graph.setParam(sub, "amount", constant(0.75));
    const changed = await cook(graph);
    expect(changed.stats.cooked).toBe(1);
    expect(valueOf(changed.outputs.a)).not.toBe(`F(${field.key})`);
  });

  it("rejects a Field bound to a target that takes plain values, before writing anything", async () => {
    const inner = new Graph(3);
    const capable = probeNode("cook_field_reject_ok");
    const plain = probeNode("cook_field_reject_bad");
    const hc = inner.add(capable.def, undefined, "capable");
    const hp = inner.add(plain.def, undefined, "plain");
    const def = subgraphNode(inner, [], [{ name: "out", node: hc, pin: "out" }], [
      {
        name: "amount",
        targets: [
          { node: hc, param: "amount", acceptsField: true },
          { node: hp, param: "amount", acceptsField: false },
        ],
        // acceptsField is ANDed over the targets, so the merged schema is
        // not field-capable even though one target is.
        schema: f32,
      },
    ]);
    const graph = new Graph(7);
    const sub = graph.add(def, undefined, "sub");
    graph.output(sub, "out", "out");

    // Planted through the deliberately unchecked door: `setParam` now
    // refuses a Field on a param that is not field-capable up front. What
    // is under test is the SECOND line — the cook-time refusal at the
    // exposed-param seam, the only one that can name WHICH target refuses.
    graph._setParamQuiet(sub, "amount", constant(0.5));
    await expect(cook(graph)).rejects.toThrow(
      /exposed param "amount" holds a Field, but it is not field-capable: inner target "plain"\.amount takes plain values only; field-capable targets of "amount": "capable"\.amount/,
    );
    // The check runs before the first write, so the inner graph is
    // untouched: no probe ever saw the Field.
    expect(capable.seen).toEqual([]);
    expect(plain.seen).toEqual([]);
    expect(inner.getParams(hp).amount).toBe(0);
  });

  it("names the exposed param when its value violates the merged schema, before writing anything", async () => {
    const inner = new Graph(3);
    const p = probeNode("cook_value_reject");
    const h = inner.add(p.def, undefined, "p");
    inner.setParam(h, "amount", 99);
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
      { name: "amount", targets: [{ node: h, param: "amount" }], schema: { ...f32, min: 0, max: 10 } },
    ]);
    const graph = new Graph(7);
    const sub = graph.add(def, { amount: 4 }, "sub");
    graph.output(sub, "out", "out");

    // Through the unchecked door: `setParam` refuses -5 against the same
    // merged schema now, so reaching the cook-time refusal — the one that
    // names the inner slot the value would have been written to — needs a
    // write that skips it.
    graph._setParamQuiet(sub, "amount", -5);
    // Named at the level the author set it, not as an inner node's
    // complaint about a value it was handed.
    await expect(cook(graph)).rejects.toThrow(
      /subgraph exposed param "amount": -5 is below the minimum 0; it writes to "p"\.amount/,
    );
    expect(inner.getParams(h).amount).toBe(99);
    expect(p.seen).toEqual([]);
  });

  it("takes the live items an item-list exposed param carries, which JSON never may", async () => {
    const inner = new Graph(3);
    const p = probeNode("cook_items");
    const h = inner.add(p.def, undefined, "p");
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
      {
        name: "amount",
        targets: [{ node: h, param: "amount" }],
        schema: { type: "items", default: [], description: "Runtime-injected items." },
      },
    ]);
    const graph = new Graph(7);
    const sub = graph.add(def, undefined, "sub");
    graph.output(sub, "out", "out");

    // The schema rule "an item list must be empty" is a SERIALIZATION
    // rule; live items are exactly what this type carries at cook time.
    graph.setParam(sub, "amount", [makeValueItem(1)]);
    await cook(graph);
    expect(p.seen).toHaveLength(1);
    expect(p.seen[0]).toContain('"value":1');
  });

  it("takes the scalar broadcast a field-capable vec param accepts at runtime", async () => {
    const inner = new Graph(3);
    const p = probeNode("cook_broadcast");
    const h = inner.add(p.def, undefined, "p");
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
      {
        name: "amount",
        targets: [{ node: h, param: "amount", acceptsField: true }],
        schema: { type: "vec3", default: [0, 0, 0], description: "A vector.", acceptsField: true },
      },
    ]);
    const graph = new Graph(7);
    const sub = graph.add(def, { amount: 0.5 }, "sub");
    graph.output(sub, "out", "out");
    expect(valueOf((await cook(graph)).outputs.out)).toBe("0.5");
  });

  it("writes fan-out targets in declaration order, and the failure says which one broke", async () => {
    const inner = new Graph(3);
    const a = probeNode("cook_order_a");
    const b = probeNode("cook_order_b");
    const keep = probeNode("cook_order_keep");
    const ha = inner.add(a.def, undefined, "aaa");
    const hb = inner.add(b.def, undefined, "bbb");
    const hk = inner.add(keep.def, undefined, "keep");
    const def = subgraphNode(inner, [], [{ name: "out", node: hk, pin: "out" }], [
      {
        name: "amount",
        targets: [
          { node: ha, param: "amount" },
          { node: hb, param: "amount" },
        ],
        schema: f32,
      },
    ]);
    const graph = new Graph(7);
    const sub = graph.add(def, { amount: 1 }, "sub");
    graph.output(sub, "out", "out");

    // Removing a bound inner node is unsupported, but it is the one state
    // in which the write ORDER is observable — and it is observable, so
    // reversing the loop is not an equivalent change. Pin the order here
    // rather than argue it away.
    inner.removeNode(ha);
    inner.removeNode(hb);
    const error = await cook(graph).then(
      () => new Error("expected the cook to reject"),
      (err: unknown) => err as Error,
    );
    expect(error.message).toMatch(/unknown node "aaa"/);
    expect(error.message).not.toMatch(/"bbb"/);
  });
});

/**
 * The inner graph is SHARED — by the instances of one def, and by anyone
 * holding it through `getSubgraphSpec(def).graph`. Cooking writes exposed
 * values into it, so a cook that left them there would make the graph's
 * authored state a function of cook history: `serializeGraph` bytes that
 * depend on whether (and which) cook ran, and a failed cook wedging a
 * foreign value in place with no way back. The wrapper restores every slot
 * it wrote before its exclusive section ends.
 */
describe("subgraphNode exposed params — the inner graph after a cook", () => {
  it("restores every slot it wrote, so a cook leaves the inner graph as it found it", async () => {
    const inner = new Graph(3);
    const p = probeNode("cook_restore");
    const h = inner.add(p.def, undefined, "p");
    inner.setParam(h, "amount", 99); // the inner graph's own authored value
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
      { name: "amount", targets: [{ node: h, param: "amount" }], schema: f32 },
    ]);
    const graph = new Graph(7);
    const sub = graph.add(def, { amount: 4 }, "sub");
    graph.output(sub, "out", "out");

    expect(valueOf((await cook(graph)).outputs.out)).toBe("4");
    expect(inner.getParams(h).amount).toBe(99);

    // Restoring costs no cache: nothing changed, so the wrapper serves
    // its own cache and the inner graph is not entered at all.
    expect((await cook(graph)).stats).toMatchObject({ cooked: 0, cached: 1 });
    expect(inner.getParams(h).amount).toBe(99);

    // And it does not corrupt the inner caches: a new value cooks, and
    // the old one cooks again correctly afterwards. The author's 99 never
    // reaches the probe.
    graph.setParam(sub, "amount", 5);
    expect(valueOf((await cook(graph)).outputs.out)).toBe("5");
    graph.setParam(sub, "amount", 4);
    expect(valueOf((await cook(graph)).outputs.out)).toBe("4");
    expect(p.seen).toEqual(["4", "5", "4"]);
    expect(inner.getParams(h).amount).toBe(99);
  });

  it("restores them even when the inner cook throws after the writes landed", async () => {
    const inner = new Graph(3);
    const p = refusingNode("cook_restore_throw", 13);
    const h = inner.add(p.def, undefined, "p");
    inner.setParam(h, "amount", 99);
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
      { name: "amount", targets: [{ node: h, param: "amount" }], schema: f32 },
    ]);
    const graph = new Graph(7);
    const sub = graph.add(def, { amount: 13 }, "sub");
    graph.output(sub, "out", "out");

    // 13 is legal under the exposed schema, so it IS written inward — the
    // node refuses it only once it runs.
    await expect(cook(graph)).rejects.toThrow(/refuses/);
    expect(inner.getParams(h).amount).toBe(99);

    // A failed cook must not wedge the graph: a legal value cooks, and
    // the inner graph is still the author's afterwards.
    graph.setParam(sub, "amount", 4);
    expect(valueOf((await cook(graph)).outputs.out)).toBe("4");
    expect(inner.getParams(h).amount).toBe(99);
  });

  it("does not let one wrapper's cook rewrite what another wrapper reads", async () => {
    const inner = new Graph(3);
    const p = probeNode("cook_restore_shared");
    const h = inner.add(p.def, undefined, "p");
    inner.setParam(h, "amount", 99);
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
      { name: "amount", targets: [{ node: h, param: "amount" }], schema: f32 },
    ]);
    // Two separate outer graphs over ONE def: the shared inner graph is
    // exactly the object a save would read.
    const a = new Graph(7);
    const subA = a.add(def, { amount: 1 }, "sub");
    a.output(subA, "out", "out");
    const b = new Graph(8);
    const subB = b.add(def, { amount: 2 }, "sub");
    b.output(subB, "out", "out");

    expect(valueOf((await cook(a)).outputs.out)).toBe("1");
    expect(inner.getParams(h).amount).toBe(99);
    expect(valueOf((await cook(b)).outputs.out)).toBe("2");
    expect(inner.getParams(h).amount).toBe(99);
    expect(valueOf((await cook(a)).outputs.out)).toBe("1");
    expect(inner.getParams(h).amount).toBe(99);
  });
});
