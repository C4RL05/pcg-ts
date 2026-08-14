/**
 * The second route an exposed param takes into a body: the NAME, read by
 * the body's field expressions as `{"fn": "param", "name": …}`.
 *
 * The property every test here turns on is that binding SUBSTITUTES. The
 * field a body node holds is rebuilt from its authored spec with the
 * value in it, so `Field.key` carries that value — which is what the
 * executor hashes into the body node's memo key. A value arriving any
 * later would be a value the memo cannot see, and the body would serve
 * the previous one's bytes.
 *
 * These tests live at the graph layer, with hand-built schemas, because
 * that is the layer that stores the declarations, scans the body and does
 * the rebuild — and because a probe node can then report the exact field
 * key it cooked with.
 */
import { describe, expect, it } from "vitest";
import { constant, isField, mul } from "../fields/index.js";
import { fieldFromJson } from "../nodes/fieldJson.js";
import { type DataCollection, makeValueItem } from "./data.js";
import { CookCancelledError } from "./errors.js";
import { cook } from "./execute.js";
import { Graph } from "./graph.js";
import { defineNode } from "./node.js";
import type { ParamSchema } from "./params.js";
import { subgraphNode } from "./subgraph.js";

const f32: ParamSchema = { type: "f32", default: 0, description: "A number." };
const vec3: ParamSchema = { type: "vec3", default: [0, 0, 0], description: "A vector." };
const str: ParamSchema = { type: "string", default: "x", description: "A word." };

/** Readable form of whatever a probe cooked with, Fields included. */
function show(value: unknown): string {
  return isField(value) ? `F(${value.key})` : JSON.stringify(value);
}

/** A node that records the value of its `amount` param on every cook. */
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

function valueOf(collection: DataCollection | undefined): unknown {
  const item = collection?.[0];
  return item?.kind === "value" ? item.value : undefined;
}

/** `amount` holds `mul(param("amp"), 10)`, so the cooked key shows the binding. */
const AMP_SPEC = { fn: "mul", args: [{ fn: "param", name: "amp" }, 10] } as const;

/** The key that expression has once `amp` is bound to `v`. */
function ampKey(v: number): string {
  return `F(${fieldFromJson(AMP_SPEC, { amp: v }).key})`;
}

/** A body whose one probe reads `amp` inside a field expression. */
function ampBody(type: string) {
  const inner = new Graph(3);
  const probe = probeNode(type);
  const h = inner.add(probe.def, undefined, "p");
  const authored = fieldFromJson(AMP_SPEC);
  inner.setParam(h, "amount", authored);
  return { inner, probe, h, authored };
}

describe("a body field expression reading an exposed param — declaration", () => {
  it("accepts a param with no targets when the body reads its name", () => {
    const { inner, h } = ampBody("bind_decl_ok");
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
      { name: "amp", targets: [], schema: f32 },
    ]);
    expect(def.defaultParams.amp).toBe(0);
  });

  it("names both routes, and what the body reads, when a param takes neither", () => {
    const { inner, h } = ampBody("bind_decl_neither");
    expect(() =>
      subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
        { name: "amp", targets: [], schema: f32 },
        { name: "amount", targets: [], schema: f32 },
      ]),
    ).toThrow(
      /exposed param "amount": needs at least one inner target \{ node, param \} to write into, or a field expression in the body reading it as \{"fn": "param", "name": "amount"\}.*names the body's field expressions do read: "amp"/s,
    );
  });

  it("refuses a body reading a name nothing declares, listing what is declared", () => {
    const { inner, h } = ampBody("bind_decl_undeclared");
    expect(() =>
      subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
        { name: "other", targets: [{ node: h, param: "amount" }], schema: f32 },
      ]),
    ).toThrow(
      /the body's field expression at "p"\.amount reads \{"fn": "param", "name": "amp"\}, but this wrapper exposes no param "amp" to supply it; exposed params: "other"/,
    );
  });

  it("refuses a type no literal position can hold", () => {
    const { inner, h } = ampBody("bind_decl_type");
    // A real inner target, so the schema is not the derived kind — the
    // refusal is about the TYPE reaching a field expression, not about
    // where the schema came from.
    const g = inner.add(probeNode("bind_decl_type_target").def, undefined, "q");
    expect(() =>
      subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
        { name: "amp", targets: [{ node: g, param: "amount" }], schema: str },
      ]),
    ).toThrow(
      /exposed param "amp" is read by the body's field expression at "p"\.amount, but its type "string" cannot be substituted into one/,
    );
  });

  it("refuses fanning a value into the very slot holding the expression", () => {
    const { inner, h } = ampBody("bind_decl_conflict");
    expect(() =>
      subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
        { name: "amp", targets: [{ node: h, param: "amount" }], schema: f32 },
      ]),
    ).toThrow(
      /exposed param "amp" writes to the inner slot "p"\.amount, which holds a field expression reading "amp" — the write would replace the whole expression/,
    );
  });

  it("refuses a body field that reads a declared name through a COMPOSED spec", () => {
    const inner = new Graph(3);
    const probe = probeNode("bind_decl_derived");
    const h = inner.add(probe.def, undefined, "p");
    // Composed with the constructors on top of an authored param spec: the
    // spec is derived, so a rebuild would change its provenance and this
    // expression would keep the 1 it was built with.
    inner.setParam(h, "amount", mul(fieldFromJson({ fn: "param", name: "amp" }, { amp: 1 }), 3));
    expect(() =>
      subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
        { name: "amp", targets: [], schema: f32 },
      ]),
    ).toThrow(
      /the body's field at "p"\.amount reads the exposed param "amp", but it was COMPOSED with the field constructors/,
    );
    // A composed spec reading a name nothing exposes is left alone — it
    // can only be a value the author already baked in. (A fresh body: a
    // live graph can be wrapped exactly once.)
    const other = new Graph(3);
    const oh = other.add(probeNode("bind_decl_derived_ok").def, undefined, "p");
    other.setParam(oh, "amount", mul(fieldFromJson({ fn: "param", name: "amp" }, { amp: 1 }), 3));
    expect(() =>
      subgraphNode(other, [], [{ name: "out", node: oh, pin: "out" }], [
        { name: "other", targets: [{ node: oh, param: "amount" }], schema: f32 },
      ]),
    ).not.toThrow();
  });

  it("refuses a targetless param whose type no default shape could have produced", () => {
    const { inner, h } = ampBody("bind_decl_targetless_type");
    expect(() =>
      subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
        { name: "amp", targets: [], schema: { type: "i32", default: 1, description: "A count." } },
      ]),
    ).toThrow(
      /exposed param "amp" has no targets and type "i32"; a targetless param's schema is derived from the SHAPE of its default, which yields f32, vec3, vec4 and nothing else/,
    );
  });

  it("refuses a targetless param claiming field capability", () => {
    const { inner, h } = ampBody("bind_decl_targetless_field");
    expect(() =>
      subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
        { name: "amp", targets: [], schema: { ...f32, acceptsField: true } },
      ]),
    ).toThrow(/exposed param "amp" has no targets and claims to accept a Field/);
  });

  it("still refuses a targetless param when nothing in the body reads anything", () => {
    const inner = new Graph(3);
    const probe = probeNode("bind_decl_no_fields");
    inner.add(probe.def, undefined, "p");
    expect(() => subgraphNode(inner, [], [], [{ name: "amp", targets: [], schema: f32 }])).toThrow(
      /names the body's field expressions do read: \(none\)/,
    );
  });
});

describe("a body field expression reading an exposed param — cooking", () => {
  it("substitutes the instance's value, so the field's key carries it", async () => {
    const { inner, probe, h } = ampBody("bind_cook_value");
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
      { name: "amp", targets: [], schema: f32 },
    ]);
    const graph = new Graph(7);
    const sub = graph.add(def, { amp: 2.5 }, "sub");
    graph.output(sub, "out", "out");

    expect(valueOf((await cook(graph)).outputs.out)).toBe(ampKey(2.5));
    // The value is IN the key: the expression's key is byte-identical to
    // the one the same expression with the literal written in produces,
    // which is the whole memoization contract.
    expect(probe.seen).toEqual([`F(${fieldFromJson({ fn: "mul", args: [2.5, 10] }).key})`]);

    graph.setParam(sub, "amp", 4);
    expect(valueOf((await cook(graph)).outputs.out)).toBe(ampKey(4));
    expect(probe.seen).toEqual([ampKey(2.5), ampKey(4)]);
  });

  it("binds a vec3 as the tuple the same literal would have made", async () => {
    const inner = new Graph(3);
    const probe = probeNode("bind_cook_vec");
    const h = inner.add(probe.def, undefined, "p");
    inner.setParam(h, "amount", fieldFromJson({ fn: "param", name: "offset" }));
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
      { name: "offset", targets: [], schema: vec3 },
    ]);
    const graph = new Graph(7);
    const sub = graph.add(def, { offset: [1, 2, 3] }, "sub");
    graph.output(sub, "out", "out");

    expect(valueOf((await cook(graph)).outputs.out)).toBe(`F(${constant([1, 2, 3]).key})`);
  });

  it("drives a name that also fans out into a plain param slot", async () => {
    const { inner, probe, h } = ampBody("bind_cook_both");
    const plain = probeNode("bind_cook_both_plain");
    const g = inner.add(plain.def, undefined, "q");
    const def = subgraphNode(
      inner,
      [],
      [
        { name: "out", node: h, pin: "out" },
        { name: "plain", node: g, pin: "out" },
      ],
      [{ name: "amp", targets: [{ node: g, param: "amount" }], schema: f32 }],
    );
    const graph = new Graph(7);
    const sub = graph.add(def, { amp: 3 }, "sub");
    graph.output(sub, "out", "out");
    graph.output(sub, "plain", "plain");

    const outputs = (await cook(graph)).outputs;
    // One knob, both routes: the target slot gets the value itself, the
    // expression gets it substituted.
    expect(valueOf(outputs.plain)).toBe("3");
    expect(valueOf(outputs.out)).toBe(ampKey(3));
    expect(probe.seen).toEqual([ampKey(3)]);
    expect(plain.seen).toEqual(["3"]);
  });

  it("feeds every body field that reads the name, from one knob", async () => {
    const { inner, probe, h } = ampBody("bind_cook_fanin");
    const second = probeNode("bind_cook_fanin_second");
    const g = inner.add(second.def, undefined, "q");
    inner.setParam(g, "amount", fieldFromJson({ fn: "add", args: [{ fn: "param", name: "amp" }, 1] }));
    const def = subgraphNode(
      inner,
      [],
      [
        { name: "out", node: h, pin: "out" },
        { name: "other", node: g, pin: "out" },
      ],
      [{ name: "amp", targets: [], schema: f32 }],
    );
    const graph = new Graph(7);
    const sub = graph.add(def, { amp: 6 }, "sub");
    graph.output(sub, "out", "out");
    graph.output(sub, "other", "other");

    const outputs = (await cook(graph)).outputs;
    expect(valueOf(outputs.out)).toBe(ampKey(6));
    expect(valueOf(outputs.other)).toBe(`F(${fieldFromJson({ fn: "add", args: [6, 1] }).key})`);
    expect(probe.seen).toEqual([ampKey(6)]);
    expect(second.seen).toEqual([`F(${fieldFromJson({ fn: "add", args: [6, 1] }).key})`]);
  });

  it("composes through nesting, each wrapper binding its own scope", async () => {
    // Innermost: one probe reading "amp", exposed with no targets.
    const innermost = ampBody("bind_nested_inner");
    const defInner = subgraphNode(
      innermost.inner,
      [],
      [{ name: "out", node: innermost.h, pin: "out" }],
      [{ name: "amp", targets: [], schema: f32 }],
    );
    // Middle: holds an instance of that def AND a field of its own reading
    // the same NAME. One knob, both routes, two scopes.
    const middle = new Graph(5);
    const nested = middle.add(defInner, { amp: 1 }, "nested");
    const own = probeNode("bind_nested_middle");
    const ownHandle = middle.add(own.def, undefined, "own");
    const ownField = fieldFromJson(AMP_SPEC);
    middle.setParam(ownHandle, "amount", ownField);
    const defMiddle = subgraphNode(
      middle,
      [],
      [
        { name: "out", node: ownHandle, pin: "out" },
        { name: "inner", node: nested, pin: "out" },
      ],
      [{ name: "amp", targets: [{ node: nested, param: "amp" }], schema: f32 }],
    );

    const graph = new Graph(7);
    const sub = graph.add(defMiddle, { amp: 7 }, "sub");
    graph.output(sub, "out", "out");
    graph.output(sub, "inner", "inner");

    const outputs = (await cook(graph)).outputs;
    // The middle's own expression read it directly...
    expect(valueOf(outputs.out)).toBe(ampKey(7));
    // ...and the fan-out carried the same value one level further in,
    // where the inner wrapper substituted it into ITS body.
    expect(valueOf(outputs.inner)).toBe(ampKey(7));
    expect(innermost.probe.seen).toEqual([ampKey(7)]);
    // Both bodies are back to what they held before the cook, at both
    // depths and on both routes.
    expect(middle.getParams(ownHandle).amount).toBe(ownField);
    expect(middle.getParams(nested).amp).toBe(1);
    expect(innermost.inner.getParams(innermost.h).amount).toBe(innermost.authored);
  });

  it("refuses a Field, because a literal position cannot hold one", async () => {
    const { inner, h } = ampBody("bind_cook_field");
    // Field-capable through its TARGET, and read by the body as well: the
    // route that cannot carry a Field is the one that decides.
    const sink = probeNode("bind_cook_field_sink");
    const g = inner.add(sink.def, undefined, "q");
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
      {
        name: "amp",
        targets: [{ node: g, param: "amount", acceptsField: true }],
        schema: { ...f32, acceptsField: true },
      },
    ]);
    const graph = new Graph(7);
    const sub = graph.add(def, { amp: constant(2) }, "sub");
    graph.output(sub, "out", "out");

    await expect(cook(graph)).rejects.toThrow(
      /subgraph exposed param "amp" holds a Field, but the body's field expression at "p"\.amount reads it by name/,
    );
    // Refused BEFORE anything was written: the body is untouched.
    expect(isField(inner.getParams(h).amount)).toBe(true);
    expect(`${inner.getParams(h).amount}`).not.toContain("2");
  });

  it("names the body slot when the value will not build in the position that reads it", async () => {
    const inner = new Graph(3);
    const probe = probeNode("bind_cook_arity");
    const h = inner.add(probe.def, undefined, "p");
    // A 3-tuple substituted against a 2-tuple literal. Unbound it builds
    // fine (the arity is not known until a value arrives), so this can only
    // fail at cook — where the combinator that refuses cannot know which
    // slot held the expression.
    inner.setParam(h, "amount", fieldFromJson({ fn: "add", args: [{ fn: "param", name: "v" }, [1, 2]] }));
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
      { name: "v", targets: [], schema: vec3 },
    ]);
    const graph = new Graph(7);
    graph.output(graph.add(def, { v: [1, 2, 3] }, "sub"), "out", "out");

    await expect(cook(graph)).rejects.toThrow(
      /the body's field expression at "p"\.amount cannot be built with the exposed values it reads \("v"\): .*incompatible tuple sizes/,
    );
  });

  it("follows the body when it is edited after wrapping", async () => {
    const { inner, h } = ampBody("bind_cook_edit");
    const later = probeNode("bind_cook_edit_later");
    const g = inner.add(later.def, undefined, "q");
    const def = subgraphNode(inner, [], [{ name: "out", node: g, pin: "out" }], [
      { name: "amp", targets: [], schema: f32 },
    ]);
    const graph = new Graph(7);
    const sub = graph.add(def, { amp: 5 }, "sub");
    graph.output(sub, "out", "out");

    // "q" holds a plain 0 at wrap time and is not scanned.
    expect(valueOf((await cook(graph)).outputs.out)).toBe("0");

    // An edit to the body bumps its version, which the scan is keyed on
    // AND which the wrapper's memo key already carried.
    inner.setParam(g, "amount", fieldFromJson(AMP_SPEC));
    expect(valueOf((await cook(graph)).outputs.out)).toBe(ampKey(5));

    // The other direction: an edit introducing a name nothing declares
    // fails at cook, with the wrap-time message.
    inner.setParam(g, "amount", fieldFromJson({ fn: "param", name: "nope" }));
    await expect(cook(graph)).rejects.toThrow(
      /the body's field expression at "q"\.amount reads \{"fn": "param", "name": "nope"\}, but this wrapper exposes no param "nope" to supply it; exposed params: "amp"/,
    );
  });
});

/**
 * The rebuild is a WRITE into the shared inner graph, and so is bound by
 * the same invariant as every other one: a cook leaves the graph exactly
 * as it found it. The field a body node holds between cooks is the
 * AUTHORED one — the one carrying `{"fn": "param"}` rather than a value —
 * because that is what `serializeGraph` reads.
 */
describe("a body field expression reading an exposed param — the body after a cook", () => {
  it("puts the authored field back, by identity, and leaves the version alone", async () => {
    const { inner, h, authored } = ampBody("bind_restore");
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
      { name: "amp", targets: [], schema: f32 },
    ]);
    const graph = new Graph(7);
    const sub = graph.add(def, { amp: 2 }, "sub");
    graph.output(sub, "out", "out");
    const versionBefore = inner.version;

    expect(valueOf((await cook(graph)).outputs.out)).toBe(ampKey(2));
    expect(inner.getParams(h).amount).toBe(authored);
    // A loud write would have moved the wrapper's memo key on every cook,
    // and the wrapper would never serve its own cache.
    expect(inner.version).toBe(versionBefore);
    expect((await cook(graph)).stats).toMatchObject({ cooked: 0, cached: 1 });
    expect(inner.getParams(h).amount).toBe(authored);
  });

  it("puts it back when the inner cook throws after the rebuild landed", async () => {
    const inner = new Graph(3);
    const refusing = defineNode<{ amount: unknown }>({
      type: "bind_restore_throw",
      inputs: [],
      outputs: [{ name: "out", kind: "value" }],
      defaultParams: { amount: 0 },
      execute() {
        throw new Error("bind_restore_throw: refuses everything");
      },
    });
    const h = inner.add(refusing, undefined, "p");
    const authored = fieldFromJson(AMP_SPEC);
    inner.setParam(h, "amount", authored);
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
      { name: "amp", targets: [], schema: f32 },
    ]);
    const graph = new Graph(7);
    graph.output(graph.add(def, { amp: 2 }, "sub"), "out", "out");

    await expect(cook(graph)).rejects.toThrow(/refuses everything/);
    expect(inner.getParams(h).amount).toBe(authored);
  });

  it("puts it back when the cook is cancelled mid-body", async () => {
    const inner = new Graph(3);
    let open: () => void = () => {};
    let reached: () => void = () => {};
    const atGate = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const gated = defineNode<Record<string, never>>({
      type: "bind_restore_cancel_gate",
      inputs: [],
      outputs: [{ name: "out", kind: "value" }],
      defaultParams: {},
      async execute() {
        reached();
        await gate;
        return { out: [] };
      },
    });
    // The gate is UPSTREAM of the node holding the expression, so the
    // abort lands between two nodes — where the executor checks — with the
    // rebuilt field already installed and not yet read.
    const gateHandle = inner.add(gated, undefined, "gate");
    const downstream = defineNode<{ amount: unknown }>({
      type: "bind_restore_cancel",
      inputs: [{ name: "in", kind: "value" }],
      outputs: [{ name: "out", kind: "value" }],
      defaultParams: { amount: 0 },
      execute: ({ params }) => ({ out: [makeValueItem(show(params.amount))] }),
    });
    const h = inner.add(downstream, undefined, "p");
    inner.connect(gateHandle, "out", h, "in");
    const authored = fieldFromJson(AMP_SPEC);
    inner.setParam(h, "amount", authored);
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
      { name: "amp", targets: [], schema: f32 },
    ]);
    const graph = new Graph(7);
    graph.output(graph.add(def, { amp: 2 }, "sub"), "out", "out");

    const controller = new AbortController();
    const cooking = cook(graph, { signal: controller.signal });
    await atGate;
    // Mid-cook, with the rebuilt field installed in the body.
    expect(inner.getParams(h).amount).not.toBe(authored);
    controller.abort();
    open();
    await expect(cooking).rejects.toBeInstanceOf(CookCancelledError);
    expect(inner.getParams(h).amount).toBe(authored);
  });

  it("does not let two instances of one def poison each other", async () => {
    const { inner, probe, h } = ampBody("bind_restore_shared");
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
      { name: "amp", targets: [], schema: f32 },
    ]);
    // Two outer graphs over ONE def, so both cooks write into the same
    // inner node's one cache slot.
    const a = new Graph(7);
    const subA = a.add(def, { amp: 1 }, "sub");
    a.output(subA, "out", "out");
    const b = new Graph(8);
    b.output(b.add(def, { amp: 2 }, "sub"), "out", "out");

    expect(valueOf((await cook(a)).outputs.out)).toBe(ampKey(1));
    expect(valueOf((await cook(b)).outputs.out)).toBe(ampKey(2));
    // Re-entering a's body is the point: the shared inner node holds ONE
    // cache slot, and it currently holds b's bytes under b's key.
    a.setParam(subA, "amp",3);
    expect(valueOf((await cook(a)).outputs.out)).toBe(ampKey(3));
    a.setParam(subA, "amp",1);
    expect(valueOf((await cook(a)).outputs.out)).toBe(ampKey(1));
    expect(probe.seen).toEqual([ampKey(1), ampKey(2), ampKey(3), ampKey(1)]);
  });

  it("keeps two instances apart within one graph, cooked in one pass", async () => {
    const { inner, h } = ampBody("bind_restore_siblings");
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
      { name: "amp", targets: [], schema: f32 },
    ]);
    const graph = new Graph(7);
    graph.output(graph.add(def, { amp: 1 }, "one"), "out", "one");
    graph.output(graph.add(def, { amp: 2 }, "two"), "out", "two");

    const outputs = (await cook(graph)).outputs;
    expect(valueOf(outputs.one)).toBe(ampKey(1));
    expect(valueOf(outputs.two)).toBe(ampKey(2));
  });

  it("rejects a value no literal can be made of, before writing anything", async () => {
    const { inner, h, authored } = ampBody("bind_restore_badvalue");
    const def = subgraphNode(inner, [], [{ name: "out", node: h, pin: "out" }], [
      { name: "amp", targets: [], schema: f32 },
    ]);
    const graph = new Graph(7);
    const sub = graph.add(def, { amp: 1 }, "sub");
    graph.output(sub, "out", "out");
    // Past the exposed schema's own check would still leave the binding
    // impossible; both refusals name the reading slot.
    graph.setParam(sub, "amp", Number.NaN);

    // The schema's own check catches it first, and still names the route
    // the value would have taken — an empty target list must not leave the
    // message trailing off into nothing.
    await expect(cook(graph)).rejects.toThrow(
      /subgraph exposed param "amp": expected a finite number, got null; it is read by the body's field expression at "p"\.amount/,
    );
    expect(inner.getParams(h).amount).toBe(authored);
  });
});
