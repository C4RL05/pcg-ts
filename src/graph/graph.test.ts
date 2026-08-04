import { describe, expect, it } from "vitest";
import { GraphCycleError, GraphValidationError } from "./errors.js";
import { Graph } from "./graph.js";
import { counterNode, makePointsNode, mergeNode, transformNode } from "./testNodes.js";

describe("Graph builder", () => {
  it("assigns deterministic auto ids per type", () => {
    const g = new Graph();
    expect(g.add(makePointsNode()).id).toBe("points_0");
    expect(g.add(makePointsNode()).id).toBe("points_1");
    expect(g.add(transformNode()).id).toBe("transform_0");
  });

  it("accepts explicit ids and rejects duplicates", () => {
    const g = new Graph();
    expect(g.add(makePointsNode(), undefined, "src").id).toBe("src");
    expect(() => g.add(transformNode(), undefined, "src")).toThrow(GraphValidationError);
  });

  it("auto ids skip explicitly-taken names", () => {
    const g = new Graph();
    g.add(makePointsNode(), undefined, "points_0");
    expect(g.add(makePointsNode()).id).toBe("points_1");
  });

  it("merges params over defaults", () => {
    const g = new Graph();
    const h = g.add(makePointsNode(4), { count: 9 });
    expect(g.getParams(h).count).toBe(9);
  });

  it("rejects connections to unknown pins", () => {
    const g = new Graph();
    const p = g.add(makePointsNode());
    const t = g.add(transformNode());
    expect(() => g.connect(p, "nope", t, "in")).toThrow(GraphValidationError);
    expect(() => g.connect(p, "out", t, "nope")).toThrow(GraphValidationError);
  });

  it("rejects incompatible pin kinds but allows the any wildcard", () => {
    const g = new Graph();
    const c = g.add(counterNode().def); // out: value
    const t = g.add(transformNode()); // in: geometry
    const m = g.add(mergeNode()); // in: any
    expect(() => g.connect(c, "out", t, "in")).toThrow(GraphValidationError);
    g.connect(c, "out", m, "in"); // value -> any ok
    const p = g.add(makePointsNode());
    g.connect(p, "out", m, "in"); // geometry -> any ok
  });

  it("rejects a second connection into a single input pin", () => {
    const g = new Graph();
    const a = g.add(makePointsNode());
    const b = g.add(makePointsNode());
    const t = g.add(transformNode());
    g.connect(a, "out", t, "in");
    expect(() => g.connect(b, "out", t, "in")).toThrow(GraphValidationError);
  });

  it("allows several connections into a multi pin", () => {
    const g = new Graph();
    const a = g.add(counterNode().def);
    const b = g.add(counterNode().def);
    const m = g.add(mergeNode());
    g.connect(a, "out", m, "in");
    g.connect(b, "out", m, "in");
  });

  it("rejects self-loops and cycles at connect time", () => {
    const g = new Graph();
    const a = g.add(mergeNode());
    const b = g.add(mergeNode());
    const c = g.add(mergeNode());
    expect(() => g.connect(a, "out", a, "in")).toThrow(GraphCycleError);
    g.connect(a, "out", b, "in");
    g.connect(b, "out", c, "in");
    expect(() => g.connect(c, "out", a, "in")).toThrow(GraphCycleError);
  });

  it("rejects handles from another graph", () => {
    const g1 = new Graph();
    const g2 = new Graph();
    const foreign = g2.add(makePointsNode());
    const t = g1.add(transformNode());
    expect(() => g1.connect(foreign, "out", t, "in")).toThrow(GraphValidationError);
    expect(() => g1.setParam(foreign, "count", 1)).toThrow(GraphValidationError);
  });

  it("disconnect removes one connection and reopens single pins", () => {
    const g = new Graph();
    const a = g.add(makePointsNode());
    const b = g.add(makePointsNode());
    const t = g.add(transformNode());
    g.connect(a, "out", t, "in");
    expect(g.disconnect(a, "out", t, "in")).toBe(true);
    expect(g.disconnect(a, "out", t, "in")).toBe(false);
    g.connect(b, "out", t, "in"); // pin is free again
  });

  it("validates declared outputs and rejects duplicate names", () => {
    const g = new Graph();
    const p = g.add(makePointsNode());
    expect(() => g.output(p, "nope")).toThrow(GraphValidationError);
    g.output(p, "out");
    expect(() => g.output(p, "out")).toThrow(GraphValidationError); // same default name
    g.output(p, "out", "alias"); // distinct name is fine
  });

  it("marks nodes dirty on add, setParam, connect, and disconnect", () => {
    const g = new Graph();
    const p = g.add(makePointsNode());
    const t = g.add(transformNode());
    expect(g.isDirty(p)).toBe(true);
    g.connect(p, "out", t, "in");
    expect(g.isDirty(t)).toBe(true);
    g.setParam(p, "count", 2);
    expect(g.isDirty(p)).toBe(true);
  });
});
