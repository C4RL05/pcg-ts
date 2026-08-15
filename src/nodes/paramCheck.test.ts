/**
 * `Graph.add` and `Graph.setParam` check a plain param value against the
 * schema that declares it.
 *
 * The schema used to be enforced only at the SERIALIZATION boundary —
 * `serializeGraph` / `deserializeGraph` — which meant a graph built,
 * patched and cooked entirely in memory (a host, the sandbox, a test, an
 * agent driving the API) never met the check at all. A value the JSON
 * reader would refuse cooked happily, and the damage surfaced at some
 * node downstream, or in a renderer, or never. These tests pin the check
 * at the mutation that introduces the value, and pin the four shapes that
 * are legal in a live graph and NOT in JSON, which is why the rule is a
 * function of its own (`liveParamValueError`) rather than the serializer's.
 */
import { describe, expect, it } from "vitest";
import { fieldFromJson } from "../fields/fieldJson.js";
import { constant } from "../fields/index.js";
import { Graph, GraphValidationError, makeGeometryItem } from "../graph/index.js";
import { createPointCloud } from "../data/index.js";
import { dataInput } from "../runtime/dataInput.js";
import { filterByBounds } from "./filtering.js";
import { setAttribute } from "./attributes.js";
import { serializeGraph } from "./serialize.js";
import { pointScatterInBounds, pointScatterInWorld } from "./sources.js";
import { transformPoints } from "./pointOps.js";

describe("setParam checks the declared schema", () => {
  it("refuses a value below the declared minimum, naming node, type, param, value and bound", () => {
    const g = new Graph(1);
    const s = g.add(pointScatterInBounds, {}, "scatter");
    expect(() => g.setParam(s, "count", -5)).toThrow(GraphValidationError);
    expect(() => g.setParam(s, "count", -5)).toThrow(
      /^setParam: node "scatter" \(type "pointScatterInBounds"\) param "count": -5 is below the minimum 0$/,
    );
  });

  it("refuses a non-integer on an integer param, and a value outside an enum", () => {
    const g = new Graph(1);
    const s = g.add(pointScatterInBounds, {}, "scatter");
    expect(() => g.setParam(s, "count", 1.5)).toThrow(
      /param "count": expected an integer, got 1.5/,
    );
    const f = g.add(filterByBounds, {}, "clip");
    expect(() => g.setParam(f, "mode", "sideways")).toThrow(
      /param "mode": expected one of "inside", "outside", got "sideways"/,
    );
  });

  it("refuses a Field on a param that is not field-capable", () => {
    const g = new Graph(1);
    const s = g.add(pointScatterInBounds, {}, "scatter");
    expect(() => g.setParam(s, "count", constant(3) as never)).toThrow(
      /param "count": holds a Field but the param is not field-capable/,
    );
  });

  it("leaves the value it refused unwritten, and the version unbumped", () => {
    const g = new Graph(1);
    const s = g.add(pointScatterInBounds, { count: 12 }, "scatter");
    const before = g.version;
    expect(() => g.setParam(s, "count", -1)).toThrow(GraphValidationError);
    expect(g.getParams(s).count).toBe(12);
    expect(g.version).toBe(before);
  });

  it("does not check a param name the def does not declare", () => {
    // Unchanged behaviour, and deliberately so: an unknown param name is
    // serialization's complaint to make (it can list the ones that exist),
    // and a bare `setParam` has no schema to check the value against.
    const g = new Graph(1);
    const s = g.add(pointScatterInBounds, {}, "scatter");
    expect(() => g.setParam(s, "bogus" as never, -5 as never)).not.toThrow();
  });

  it("does not check a def that declares no schemas", async () => {
    // A hand-rolled `defineNode` has nothing to check against, so its
    // params behave exactly as they did before the check existed. Proven
    // through a registered def's param list rather than a fake one: the
    // registry is what publishes schemas (see paramSchemaLink.ts).
    const { defineNode } = await import("../graph/index.js");
    const bare = defineNode<{ count: number }>({
      type: "bareParamCheck",
      inputs: [],
      outputs: [{ name: "out", kind: "geometry" }],
      defaultParams: { count: 1 },
      execute: () => ({ out: [] }),
    });
    const g = new Graph(1);
    const h = g.add(bare, { count: -999 });
    expect(g.getParams(h).count).toBe(-999);
    expect(() => g.setParam(h, "count", Number.NaN)).not.toThrow();
  });
});

describe("add checks the declared schema", () => {
  it("refuses an overriding param the same way setParam does", () => {
    const g = new Graph(1);
    expect(() => g.add(pointScatterInBounds, { count: -5 }, "scatter")).toThrow(
      /^add: node "scatter" \(type "pointScatterInBounds"\) param "count": -5 is below the minimum 0$/,
    );
  });

  it("adds nothing and does not advance the auto-id counter when it refuses", () => {
    const g = new Graph(1);
    const before = g.version;
    expect(() => g.add(pointScatterInBounds, { count: -5 })).toThrow(GraphValidationError);
    expect(g.version).toBe(before);
    expect(g.describe().nodes).toHaveLength(0);
    // The refused add would have taken `pointScatterInBounds_0`; the next
    // successful one still gets it, so a caught error leaves no trace in
    // the id sequence a graph's determinism is built on.
    expect(g.add(pointScatterInBounds, {}).id).toBe("pointScatterInBounds_0");
  });

  it("does not recheck the defaults, which the registry already validated", () => {
    const g = new Graph(1);
    expect(() => g.add(pointScatterInBounds)).not.toThrow();
  });
});

describe("what is legal live and not in JSON", () => {
  it("takes the live DataItems an items param carries", () => {
    const g = new Graph(1);
    const d = g.add(dataInput, {}, "in");
    expect(() => g.setParam(d, "items", [makeGeometryItem(createPointCloud(1))])).not.toThrow();
  });

  it("takes a scalar broadcast on a field-capable vec param", () => {
    const g = new Graph(1);
    const t = g.add(transformPoints, {}, "move");
    expect(() => g.setParam(t, "translate", 2 as never)).not.toThrow();
    expect(g.getParams(t).translate).toBe(2);
  });

  it("takes a constant tuple on a field-capable scalar param", () => {
    // `setAttribute.value` declares f32 and writes a `tupleSize`-wide
    // attribute: a plain tuple is the constant spelling of a field of that
    // arity (`FieldLike`), and the NODE checks the arity against the domain.
    const g = new Graph(1);
    const a = g.add(setAttribute, { name: "v", tupleSize: 3 }, "attr");
    expect(() => g.setParam(a, "value", [1, 2, 3] as never)).not.toThrow();
  });

  it("still applies the component rules and the bounds to both of those", () => {
    const g = new Graph(1);
    const a = g.add(setAttribute, { name: "v", tupleSize: 3 }, "attr");
    expect(() => g.setParam(a, "value", [1, Number.NaN, 3] as never)).toThrow(
      /param "value": expected a finite number, got null/,
    );
    expect(() => g.setParam(a, "tupleSize", 9)).toThrow(
      /param "tupleSize": 9 is above the maximum 4/,
    );
  });

  it("takes ±Infinity where the param declares it meaningful, and nowhere else", () => {
    const g = new Graph(1);
    const clip = g.add(filterByBounds, {}, "clip");
    // filterByBounds.boundsMin's own description says to write -Infinity
    // for an axis that should not be bounded — a World "xz" column's Y.
    expect(() =>
      g.setParam(clip, "boundsMin", [0, Number.NEGATIVE_INFINITY, 0]),
    ).not.toThrow();
    expect(() =>
      g.setParam(clip, "boundsMax", [1, Number.POSITIVE_INFINITY, 1]),
    ).not.toThrow();
    // NaN never, on any param: it is not a bound, it is a broken number.
    expect(() => g.setParam(clip, "boundsMin", [0, Number.NaN, 0])).toThrow(
      /param "boundsMin": expected an array of 3 numbers, got \[0,null,0\]/,
    );
    // And a param that does not declare it is unchanged.
    const t = g.add(transformPoints, {}, "move");
    expect(() => g.setParam(t, "translate", [Number.POSITIVE_INFINITY, 0, 0])).toThrow(
      /param "translate": expected an array of 3 finite numbers/,
    );
  });

  it("takes the unbounded axis a World \"xz\" column has, on the node that reads it", () => {
    // pointScatterInWorld's own execute checks finiteness per AXIS and
    // skips the ones its mode does not read, saying so beside the check:
    // an "xz" cell is a column, so its Y window is not a number. The
    // schema has to admit what the node admits, or a level binding a cell
    // rectangle is refused for a value that node deliberately ignores.
    const g = new Graph(1);
    const w = g.add(pointScatterInWorld, {}, "world");
    expect(() =>
      g.setParam(w, "boundsMin", [-64, Number.NEGATIVE_INFINITY, -64]),
    ).not.toThrow();
    expect(() =>
      g.setParam(w, "boundsMax", [64, Number.POSITIVE_INFINITY, 64]),
    ).not.toThrow();
  });

  it("still refuses the infinity at the serialization boundary that cannot carry it", () => {
    // The gap and the feature are the same gap: JSON has no infinity
    // literal, so a graph that saved one would fail to load. The live
    // permission therefore stops exactly at `serializeGraph`.
    const g = new Graph(1);
    const clip = g.add(filterByBounds, {}, "clip");
    g.setParam(clip, "boundsMin", [0, Number.NEGATIVE_INFINITY, 0]);
    g.output(clip, "out", "out");
    expect(() => serializeGraph(g)).toThrow(
      /node "clip" param "boundsMin": expected an array of 3 finite numbers/,
    );
  });

  it("takes a Field on a field-capable param", () => {
    const g = new Graph(1);
    const t = g.add(transformPoints, {
      translate: fieldFromJson({ fn: "position" }),
    });
    expect(() => g.setParam(t, "scale", constant(2) as never)).not.toThrow();
  });
});

describe("_setParamQuiet is deliberately unchecked", () => {
  it("writes a value setParam refuses, which is what the subgraph plumbing needs", () => {
    // The write-cook-restore around an inner graph writes values already
    // validated at the wrapper's own seam, and restores values that were
    // checked on their way in. Re-deriving that per param per cook — per
    // ITERATION in forEach — would be cost for an answer already known.
    const g = new Graph(1);
    const s = g.add(pointScatterInBounds, { count: 3 }, "scatter");
    const before = g.version;
    expect(() => g._setParamQuiet(s, "count", -5)).not.toThrow();
    expect(g.getParams(s).count).toBe(-5);
    expect(g.version).toBe(before);
  });
});
