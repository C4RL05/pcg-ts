/**
 * The panel end of the inline field-spec param: a `param` reference that
 * carries its own value becomes a knob, and turning it rewrites the value
 * inside the spec.
 *
 * Lives in `tests/` rather than beside the sandbox because the browser
 * pages are outside vitest's `src/**` include, and because this crosses
 * three modules: the grammar's rewrite helpers, the editor controller that
 * enumerates and writes, and the panel builder that turns the result into
 * widgets. What it protects is the failure mode a screenshot cannot show —
 * a knob that renders and moves but never reaches the cook.
 */
import { describe, expect, it } from "vitest";
import type { Field } from "pcg-ts";
import { EditorController } from "../sandbox/controller.js";
import { buildKnobPanel, type GraphPanelSpec, type Knob } from "../shared/graphUi.js";

/** Silent hooks: nothing here is looking at a render or a stats line. */
const controller = (): EditorController =>
  new EditorController({ render: () => {}, status: () => {} });

/**
 * A plain `transformPoints` whose `translate` spec names two values and
 * supplies both — the shape the wrapper-with-exposed-params graph collapses
 * to. `unbound` is the third reference, deliberately value-free.
 */
function graphText(opts: { nodeId?: string; unbound?: boolean } = {}): string {
  const id = opts.nodeId ?? "dunes";
  const lift: Record<string, unknown> = {
    fn: "mul",
    args: [
      {
        fn: "mul",
        args: [{ fn: "position" }, { fn: "param", name: "frequency", value: 0.06 }],
      },
      { fn: "param", name: "amplitude", value: 18 },
    ],
  };
  const translate = {
    fn: "vec",
    args: [
      0,
      opts.unbound === true
        ? { fn: "mul", args: [lift, { fn: "param", name: "unbound" }] }
        : lift,
      0,
    ],
  };
  return JSON.stringify({
    formatVersion: 1,
    seed: 7,
    nodes: [
      { id: "grid", type: "pointGrid", params: { countX: 4, countZ: 4 } },
      { id, type: "transformPoints", params: { translate } },
    ],
    connections: [{ from: ["grid", "out"], to: [id, "in"] }],
    outputs: [{ id, pin: "out", name: "points" }],
  });
}

const byKey = (knobs: readonly Knob[], key: string): Knob | undefined =>
  knobs.find((k) => k.key === key);

describe("knobs() reaches into a field spec", () => {
  it("offers one knob per `param` that carries its own value", () => {
    const c = controller();
    expect(c.importText(graphText())).not.toHaveProperty("error");
    const knobs = c.knobs();

    const amplitude = byKey(knobs, "dunes.translate.amplitude");
    expect(amplitude).toMatchObject({
      node: "dunes",
      name: "translate",
      fieldParam: "amplitude",
      value: 18,
      // The node param holds a Field; this knob holds the literal inside
      // it, which is the constant a widget can represent.
      isField: false,
      exposed: true,
    });
    expect(amplitude?.schema).toMatchObject({ type: "f32", default: 18 });
    expect(byKey(knobs, "dunes.translate.frequency")?.value).toBe(0.06);

    // The node param itself is still listed, and still unrepresentable.
    expect(byKey(knobs, "dunes.translate")).toMatchObject({ isField: true, exposed: false });
  });

  it("offers NOTHING for a reference with no inline value", () => {
    // An unbound param refuses to evaluate: it is an error state waiting
    // for a binder, not a control. A widget for it would write a literal
    // where its author deliberately left none.
    const c = controller();
    expect(c.importText(graphText({ unbound: true }))).not.toHaveProperty("error");
    const keys = c.knobs().map((k) => k.key);
    expect(keys).toContain("dunes.translate.amplitude");
    expect(keys).not.toContain("dunes.translate.unbound");
  });

  it("keys a node id that contains dots, readable from the RIGHT", () => {
    // Nothing splits a key — every consumer looks the whole thing up in a
    // map built from this list — but the shape still has to be unambiguous
    // for a human reading it, and it is: the field param name is dot-free
    // (fieldJson refuses one) and so is the node param key (standardNode
    // refuses one), so everything before the last two dots is the node id.
    const c = controller();
    expect(c.importText(graphText({ nodeId: "a.b.c" }))).not.toHaveProperty("error");
    const knob = byKey(c.knobs(), "a.b.c.translate.amplitude");
    expect(knob).toMatchObject({ scope: "node" as const, node: "a.b.c", name: "translate", fieldParam: "amplitude" });
    expect(knob?.key.split(".").slice(-2).join(".")).toBe("translate.amplitude");
  });
});

describe("turning a field-spec knob rewrites the spec", () => {
  it("writes the new value and leaves its neighbour alone", () => {
    const c = controller();
    c.importText(graphText());
    const knob = byKey(c.knobs(), "dunes.translate.amplitude");
    expect(knob).toBeDefined();
    expect(c.setKnob(knob!, 42)).toBeNull();

    // Read back through the SERIALIZER, not through the knob list: what
    // has to have moved is the value in the graph, not a cached view.
    const out = JSON.parse(c.exportText()) as {
      nodes: { id: string; params: Record<string, unknown> }[];
    };
    const spec = JSON.stringify(out.nodes.find((n) => n.id === "dunes")?.params.translate);
    expect(spec).toContain('"name":"amplitude","value":42');
    expect(spec).toContain('"name":"frequency","value":0.06');
    expect(byKey(c.knobs(), "dunes.translate.amplitude")?.value).toBe(42);
  });

  it("leaves the param holding a FIELD, so the expression survives the write", () => {
    const c = controller();
    c.importText(graphText());
    c.setKnob({ scope: "node" as const, node: "dunes", name: "translate", fieldParam: "amplitude" }, 3);
    expect(byKey(c.knobs(), "dunes.translate")?.isField).toBe(true);
  });

  it("MOVES the field's key, which is the whole of reaching the cook", () => {
    // The failure this suite exists for: a knob that renders, moves, and
    // writes, but whose field keys the same as before — the executor hashes
    // `Field.key` into the node's memo, so an unchanged key serves the old
    // columns and the picture never moves. An inline value is substituted at
    // construction precisely so this cannot happen.
    const c = controller();
    c.importText(graphText());
    const keyOf = (): string => (byKey(c.knobs(), "dunes.translate")?.value as Field).key;
    const before = keyOf();
    c.setKnob({ scope: "node" as const, node: "dunes", name: "translate", fieldParam: "amplitude" }, 42);
    const after = keyOf();
    expect(after).not.toBe(before);
    // And it is the key the literal itself builds — the same field an author
    // would have got by typing 42 into the spec, not a name-keyed stand-in.
    const typed = controller();
    typed.importText(graphText().replace('"value":18', '"value":42'));
    expect(after).toBe((byKey(typed.knobs(), "dunes.translate")?.value as Field).key);
  });

  it("re-setting the SAME value leaves the key alone, so it costs no recook", () => {
    const c = controller();
    c.importText(graphText());
    const keyOf = (): string => (byKey(c.knobs(), "dunes.translate")?.value as Field).key;
    const before = keyOf();
    c.setKnob({ scope: "node" as const, node: "dunes", name: "translate", fieldParam: "amplitude" }, 18);
    expect(keyOf()).toBe(before);
  });

  it("applies from a shared link the same way, and reports a key it cannot", () => {
    const c = controller();
    c.importText(graphText());
    const res = c.applyKnobPatch({
      "dunes.translate.amplitude": 9,
      "dunes.translate.nosuch": 1,
    });
    expect(res.applied).toBe(1);
    expect(res.problems).toEqual(["dunes.translate.nosuch: this graph exposes no such knob"]);
    expect(byKey(c.knobs(), "dunes.translate.amplitude")?.value).toBe(9);
  });

  it("refuses a stale fieldParam instead of reporting a write it did not make", () => {
    // The knob list is a snapshot. If the spec is edited in the field
    // editor between enumeration and the slider's release, the name may be
    // gone — and a success that changed nothing is invisible to the panel.
    const c = controller();
    c.importText(graphText());
    const problem = c.setKnob({ scope: "node" as const, node: "dunes", name: "translate", fieldParam: "gone" }, 1);
    expect(problem).toMatch(/node "dunes" param "translate": .*no param "gone"/);
  });

  it("refuses a value the grammar would not take, rather than silently dropping it", () => {
    const c = controller();
    c.importText(graphText());
    const problem = c.setKnob(
      { scope: "node" as const, node: "dunes", name: "translate", fieldParam: "amplitude" },
      "nope" as unknown as number,
    );
    expect(problem).toMatch(/field-spec param "amplitude" takes a number/);
  });

  it("names the NODE when a write falls outside the range the param declares", () => {
    // A widget can offer a value the grammar refuses now that a `param` can
    // declare bounds: a panel row may name a wider range than the graph
    // does. The grammar names the param and the bound; this frame is the
    // only one that knows whose spec it was writing.
    const c = controller();
    const text = graphText().replace(
      '{"fn":"param","name":"amplitude","value":18}',
      JSON.stringify({ fn: "param", name: "amplitude", value: 18, min: 0, max: 20 }),
    );
    expect(c.importText(text)).not.toHaveProperty("error");
    const problem = c.setKnob({ scope: "node" as const, node: "dunes", name: "translate", fieldParam: "amplitude" }, 50);
    expect(problem).toMatch(
      /node "dunes" param "translate": .*param "amplitude": the inline value 50 is above its own max 20/,
    );
    // And the graph still holds what it held: a refused write is not a
    // half-applied one.
    expect(byKey(c.knobs(), "dunes.translate.amplitude")?.value).toBe(18);
  });
});

describe("the panel a field-spec knob gets", () => {
  const knobsOf = (): readonly Knob[] => {
    const c = controller();
    c.importText(graphText());
    return c.knobs();
  };

  it("is usable with NO panel file at all", () => {
    // The whole point of deriving: a graph gets working controls without a
    // second file. No range is declared anywhere, so these are number
    // boxes rather than sliders — usable, just not draggable.
    const panel = buildKnobPanel(knobsOf());
    const controls = panel.sections.flatMap((s) => s.controls);
    expect(controls.map((ctl) => ("label" in ctl ? ctl.label : ""))).toEqual([
      "translate.frequency",
      "translate.amplitude",
    ]);
    expect(controls.every((ctl) => ctl.kind === "number")).toBe(true);
    expect(panel.values["dunes.translate.amplitude"]).toBe(18);
    // The node param HOLDING the expression is not offered: it is a plain
    // node's param, which stays off an unauthored panel like every other,
    // and the field editor in the node inspector is where an expression is
    // edited anyway.
    expect(panel.values).not.toHaveProperty("dunes.translate");
  });

  it("is refined by a panel row naming the three-part key", () => {
    const spec: GraphPanelSpec = {
      sections: [
        {
          title: "dunes",
          controls: [
            {
              param: "dunes.translate.amplitude",
              label: "height",
              description: "Dune height in world units.",
              min: 0,
              max: 50,
              step: 0.5,
            },
          ],
        },
      ],
    };
    const panel = buildKnobPanel(knobsOf(), spec);
    expect(panel.unknown).toEqual([]);
    const control = panel.sections[0].controls[0];
    expect(control).toMatchObject({
      kind: "slider",
      key: "dunes.translate.amplitude",
      label: "height",
      description: "Dune height in world units.",
      min: 0,
      max: 50,
      step: 0.5,
    });
  });
});

describe("a `param` that describes itself needs no panel file", () => {
  /** The same fixture, with the three optional keys on `amplitude`. */
  const described = (): readonly Knob[] => {
    const c = controller();
    const text = graphText().replace(
      '{"fn":"param","name":"amplitude","value":18}',
      JSON.stringify({
        fn: "param",
        name: "amplitude",
        value: 18,
        min: 0,
        max: 50,
        description: "Dune height, before the fBm's ~0.4x normalization.",
      }),
    );
    expect(text).not.toBe(graphText()); // the replace found its target
    expect(c.importText(text)).not.toHaveProperty("error");
    return c.knobs();
  };

  it("carries the range and the prose into the derived schema", () => {
    const amplitude = byKey(described(), "dunes.translate.amplitude");
    expect(amplitude?.schema).toMatchObject({
      type: "f32",
      default: 18,
      min: 0,
      max: 50,
      description: "Dune height, before the fBm's ~0.4x normalization.",
    });
    // The sibling declares nothing and is unaffected — additive is the whole
    // argument for not bumping formatVersion.
    const frequency = byKey(described(), "dunes.translate.frequency");
    expect(frequency?.schema.min).toBeUndefined();
    expect(frequency?.schema.max).toBeUndefined();
  });

  it("renders as a described SLIDER with no panel spec — the regression this closes", () => {
    // Before this, the same graph with its panel file deleted showed a bare
    // number box with placeholder hover text: a graph knew less about itself
    // than the subgraph wrapper it replaced did.
    const panel = buildKnobPanel(described());
    const control = panel.sections
      .flatMap((s) => s.controls)
      .find((ctl) => "key" in ctl && ctl.key === "dunes.translate.amplitude");
    expect(control).toMatchObject({
      kind: "slider",
      description: "Dune height, before the fBm's ~0.4x normalization.",
      min: 0,
      max: 50,
    });
  });

  it("still yields to a panel row, key by key", () => {
    // The relationship a registered schema already had with a panel: the
    // panel refines, and what it leaves out stays the graph's.
    const spec: GraphPanelSpec = {
      sections: [
        {
          title: "dunes",
          controls: [{ param: "dunes.translate.amplitude", label: "height", max: 30 }],
        },
      ],
    };
    const control = buildKnobPanel(described(), spec).sections[0].controls[0];
    expect(control).toMatchObject({
      kind: "slider",
      label: "height",
      min: 0, // the graph's — the row says nothing about it
      max: 30, // the row's
      description: "Dune height, before the fBm's ~0.4x normalization.",
    });
  });
});

describe("the two mechanisms still compose", () => {
  it("an inline value is a Field on the param, so the field editor still owns the expression", () => {
    const c = controller();
    c.importText(graphText());
    const views = c.paramViews("dunes", "transformPoints");
    const translate = views.find((v) => v.key === "translate");
    expect(translate?.mode).toBe("field");
    expect(translate?.specText).toContain('"amplitude"');
    // And the live param really is a Field, not a folded constant.
    expect(byKey(c.knobs(), "dunes.translate")?.isField).toBe(true);
  });
});
