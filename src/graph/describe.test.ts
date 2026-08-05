/**
 * Phase 16 — Graph introspection: `describe()` snapshots (deterministic
 * order, frozen, seed-accurate, cheap) and the frozen `getParams`
 * snapshot, plus agreement with the serialized-JSON structure.
 */
import { describe, expect, it } from "vitest";
import { constant } from "../fields/index.js";
import {
  deserializeGraph,
  jitterPoints,
  pointScatterInBounds,
  serializeGraph,
  transformPoints,
} from "../nodes/index.js";
import { makeValueItem } from "./data.js";
import { cook } from "./execute.js";
import { Graph } from "./graph.js";
import { defineNode } from "./node.js";
import { subgraphNode } from "./subgraph.js";
import { makePointsNode, mergeNode, transformNode } from "./testNodes.js";

describe("Graph.describe", () => {
  it("reports nodes, connections, and outputs in insertion order, stable across calls", () => {
    const g = new Graph(7);
    const p = g.add(makePointsNode(), undefined, "pts");
    const t = g.add(transformNode(), undefined, "t");
    const m = g.add(mergeNode(), undefined, "m");
    g.connect(p, "out", t, "in");
    g.connect(t, "out", m, "in");
    g.connect(p, "out", m, "in");
    g.output(m, "out", "res");
    g.output(p, "out", "src");

    const d = g.describe();
    expect(d.nodes.map((n) => n.id)).toEqual(["pts", "t", "m"]);
    expect(d.nodes.map((n) => n.defType)).toEqual(["points", "transform", "merge"]);
    expect(d.connections).toEqual([
      { from: ["pts", "out"], to: ["t", "in"] },
      { from: ["t", "out"], to: ["m", "in"] },
      { from: ["pts", "out"], to: ["m", "in"] },
    ]);
    expect(d.outputs).toEqual([
      { id: "m", pin: "out", name: "res" },
      { id: "pts", pin: "out", name: "src" },
    ]);
    expect(g.describe()).toEqual(d);
  });

  it("node seeds match the seed execute receives, and track setSeed", async () => {
    let seen: number | undefined;
    const probe = defineNode<Record<string, never>>({
      type: "probe",
      inputs: [],
      outputs: [{ name: "out", kind: "value" }],
      defaultParams: {},
      execute({ seed }) {
        seen = seed;
        return { out: [makeValueItem(seed)] };
      },
    });
    const g = new Graph(11);
    const h = g.add(probe, undefined, "probe");
    g.output(h, "out", "res");
    await cook(g);
    expect(g.describe().nodes[0].seed).toBe(seen);

    g.setSeed(12);
    await cook(g);
    expect(g.describe().nodes[0].seed).toBe(seen);
  });

  it("snapshots are frozen at every level and cannot mutate graph state", () => {
    const g = new Graph();
    const p = g.add(makePointsNode(), undefined, "pts");
    const t = g.add(transformNode(), undefined, "t");
    g.connect(p, "out", t, "in");
    g.output(t, "out", "res");
    const before = g.version;
    const d = g.describe();
    expect(g.version).toBe(before); // describing is not an edit

    expect(Object.isFrozen(d)).toBe(true);
    expect(Object.isFrozen(d.nodes)).toBe(true);
    expect(Object.isFrozen(d.nodes[0])).toBe(true);
    expect(Object.isFrozen(d.connections)).toBe(true);
    expect(Object.isFrozen(d.connections[0])).toBe(true);
    expect(Object.isFrozen(d.connections[0].from)).toBe(true);
    expect(Object.isFrozen(d.outputs)).toBe(true);
    expect(Object.isFrozen(d.outputs[0])).toBe(true);
    expect(() => {
      (d.nodes as unknown as unknown[]).push("rogue");
    }).toThrow(TypeError);
    expect(() => {
      (d.outputs[0] as { name: string }).name = "hijack";
    }).toThrow(TypeError);
    expect(g.describe()).toEqual(d);
    expect(g.version).toBe(before);
  });

  it("surfaces undefined for a def without a usable type string instead of throwing", () => {
    const anonymous = defineNode<Record<string, never>>({
      type: "",
      inputs: [],
      outputs: [{ name: "out", kind: "value" }],
      defaultParams: {},
      execute: () => ({ out: [] }),
    });
    const g = new Graph();
    g.add(anonymous, undefined, "anon");
    g.add(makePointsNode(), undefined, "pts"); // ad-hoc but typed
    const d = g.describe();
    expect(d.nodes.map((n) => n.defType)).toEqual([undefined, "points"]);
  });

  it("agrees with the serialized JSON of a nontrivial graph, including subgraph nodes", () => {
    const inner = new Graph();
    const ixf = inner.add(transformPoints, { translate: [0, 1, 0] }, "ixf");
    const def = subgraphNode(
      inner,
      [{ name: "in", node: ixf, pin: "in" }],
      [{ name: "out", node: ixf, pin: "out" }],
    );
    const g = new Graph(3);
    const scatter = g.add(
      pointScatterInBounds,
      { count: 20, boundsMin: [0, 0, 0], boundsMax: [5, 1, 5] },
      "scatter",
    );
    const jit = g.add(jitterPoints, { amount: [0.1, 0, 0.1] }, "jit");
    const sub = g.add(def, {}, "sub");
    g.connect(scatter, "out", jit, "in");
    g.connect(jit, "out", sub, "in");
    g.output(sub, "out", "result");
    g.output(scatter, "out", "raw");

    const json = serializeGraph(g);
    for (const graph of [g, deserializeGraph(JSON.parse(JSON.stringify(json)))]) {
      const d = graph.describe();
      expect(d.nodes.map((n) => [n.id, n.defType])).toEqual(
        json.nodes.map((n) => [n.id, n.type]),
      );
      expect(d.connections).toEqual(json.connections);
      expect(d.outputs).toEqual(json.outputs);
    }
  });
});

describe("Graph.getParams snapshots", () => {
  it("returns a frozen copy; field params come back by reference", () => {
    const g = new Graph();
    const offset = constant([1, 2, 3]);
    const t = g.add(transformNode(), { offset }, "t");
    const snap = g.getParams(t);
    expect(Object.isFrozen(snap)).toBe(true);
    expect(snap.offset).toBe(offset); // Fields are immutable by contract
    expect(() => {
      (snap as { offset: unknown }).offset = [9, 9, 9];
    }).toThrow(TypeError);
    // The failed write neither edited the graph nor bumped the version.
    expect(g.getParams(t).offset).toBe(offset);
  });

  it("is a point-in-time snapshot: later setParam calls need a fresh read", () => {
    const g = new Graph();
    const p = g.add(makePointsNode(4), undefined, "pts");
    const before = g.getParams(p);
    const version = g.version;
    g.setParam(p, "count", 9);
    expect(g.version).toBeGreaterThan(version);
    expect(before.count).toBe(4);
    expect(g.getParams(p).count).toBe(9);
  });
});
