import { beforeEach, describe, expect, it } from "vitest";
import { Graph, cook, getSubgraphSpec, type NodeHandle } from "../graph/index.js";
import {
  GraphSerializationError,
  deserializeGraph,
  jitterPoints,
  pointScatterInBounds,
  registerSubgraph,
  resolveExposedParam,
  serializeGraph,
  subgraphContentHash,
  transformPoints,
  type SerializedGraph,
  type SerializedNode,
  type SerializedSubgraph,
} from "./index.js";
import { subgraphNode } from "../graph/index.js";
import { __defineSubgraphUnchecked, __resetSubgraphRegistry, listSubgraphs } from "./subgraphRegistry.js";
import { firstGeo, snapshotGeometry } from "./nodes.testsupport.js";

/**
 * An outer graph holding ONE subgraph node ("sub") with an embedded
 * payload: a two-node inner graph with one exposed input, one exposed
 * output and two exposed params, one of which the outer node overrides.
 * Everything below is derived from this, so the by-name and embedded forms
 * under test are the same recipe by construction.
 */
function buildEmbedded(seed = 7): SerializedGraph {
  const inner = new Graph(11);
  const jit = inner.add(jitterPoints, { amount: [0.2, 0, 0.2], seed: 3 }, "jit");
  const xf = inner.add(transformPoints, { translate: [1, 0, 0] }, "xf");
  inner.connect(jit, "out", xf, "in");
  inner.setMeta({ title: "Jittered", description: "jitter, then transform", tags: ["test"] });
  const def = subgraphNode(
    inner,
    [{ name: "pts", node: jit, pin: "in" }],
    [{ name: "out", node: xf, pin: "out" }],
    [
      resolveExposedParam(inner, {
        name: "amount",
        targets: [{ node: jit, param: "amount" }],
        description: "How far each point may move.",
      }),
      resolveExposedParam(inner, {
        name: "spin",
        targets: [{ node: xf, param: "rotateEuler" }],
        description: "Rotation applied after jittering.",
      }),
    ],
  );
  const g = new Graph(seed);
  const scatter = g.add(pointScatterInBounds, { count: 24, seed: 5 }, "scatter");
  const sub = g.add(def, { amount: [0.5, 0, 0.5] }, "sub");
  g.connect(scatter, "out", sub, "pts");
  g.output(sub, "out", "result");
  return serializeGraph(g);
}

/** The `subgraph` payload of the embedded form — the recipe to register. */
function recipeOf(embedded: SerializedGraph, id = "sub"): SerializedSubgraph {
  const node = embedded.nodes.find((n) => n.id === id);
  if (node?.subgraph === undefined) throw new Error(`no subgraph payload on "${id}"`);
  return node.subgraph;
}

/** The same graph with node `id`'s embedded payload replaced by a reference. */
function refForm(embedded: SerializedGraph, name: string, hash?: string, id = "sub"): SerializedGraph {
  return {
    ...embedded,
    nodes: embedded.nodes.map((n): SerializedNode =>
      n.id === id
        ? {
            id: n.id,
            type: n.type,
            params: n.params,
            ref: { name, ...(hash !== undefined ? { hash } : {}) },
          }
        : n,
    ),
  };
}

/**
 * The embedded form with extra keys merged into its FIRST exposed-param
 * declaration ("amount") — the near-miss shape an author writes when they
 * assume the declaration carries a `ParamSchema`.
 */
function withExposedParams(patch: Record<string, unknown>): unknown {
  const embedded = buildEmbedded();
  const recipe = recipeOf(embedded);
  const params = (recipe.params ?? []).map((p, i) => (i === 0 ? { ...p, ...patch } : p));
  return {
    ...embedded,
    nodes: embedded.nodes.map((n) =>
      n.id === "sub" ? { ...n, subgraph: { ...recipe, params } } : n,
    ),
  };
}

/** A one-node graph JSON whose single node is a reference. */
function refGraph(name: string, params: Record<string, unknown> = {}, id = "s"): SerializedGraph {
  return {
    formatVersion: 1,
    seed: 3,
    nodes: [{ id, type: "subgraph", params, ref: { name } }],
    connections: [],
    outputs: [],
  };
}

const bytes = (v: unknown): string => JSON.stringify(v);

function memoKeyOf(graph: Graph, id: string): string | undefined {
  return graph.require(id).def.memoKey?.();
}

describe("registering a primitive built in code", () => {
  beforeEach(() => __resetSubgraphRegistry());

  /** A live inner graph plus the handles `graph.add` returned. */
  function buildLive(): { inner: Graph; scatter: NodeHandle; jit: NodeHandle } {
    const inner = new Graph(4242);
    const scatter = inner.add(pointScatterInBounds, { count: 50 }, "scatter");
    const jit = inner.add(jitterPoints, { amount: [0.4, 0, 0.4] }, "jit");
    inner.connect(scatter, "out", jit, "in");
    return { inner, scatter, jit };
  }

  it("accepts node handles as well as ids, and canonicalizes them identically", () => {
    // A primitive built in code already holds handles — the very shape
    // subgraphNode takes. Requiring ids here would mean restating every
    // declaration in a second shape just to register what you just built.
    const a = buildLive();
    const byHandle = registerSubgraph("test/by-handle", {
      graph: a.inner,
      outputs: [{ name: "out", node: a.jit, pin: "out" }],
      params: [
        {
          name: "count",
          targets: [{ node: a.scatter, param: "count" }],
          description: "How many points.",
          default: 50,
        },
      ],
    });

    const b = buildLive();
    const byId = registerSubgraph("test/by-id", {
      graph: b.inner,
      outputs: [{ name: "out", node: "jit", pin: "out" }],
      params: [
        {
          name: "count",
          targets: [{ node: "scatter", param: "count" }],
          description: "How many points.",
          default: 50,
        },
      ],
    });

    // Normalized before hashing, so the two doors cannot produce recipes
    // that differ only in how the author spelled a node reference.
    expect(byHandle.hash).toBe(byId.hash);
    expect(byHandle.subgraph.outputs).toEqual([{ name: "out", node: "jit", pin: "out" }]);
    expect(byHandle.subgraph.params?.[0].targets).toEqual([{ node: "scatter", param: "count" }]);
  });

  it("still names an unknown inner node when a handle points nowhere", () => {
    const { inner } = buildLive();
    expect(() =>
      registerSubgraph("test/bad-handle", {
        graph: inner,
        outputs: [{ name: "out", node: { id: "ghost" }, pin: "out" }],
      }),
    ).toThrow(/ghost/);
  });
});

describe("named subgraph registry", () => {
  beforeEach(() => {
    __resetSubgraphRegistry();
  });

  // ---------------------------------------------------------------- exit

  it("cooks a by-name reference byte-identically to the embedded form", async () => {
    const embedded = buildEmbedded();
    registerSubgraph("test/jitter", recipeOf(embedded));
    const byRef = refForm(embedded, "test/jitter");

    const ge = deserializeGraph(embedded);
    const gr = deserializeGraph(byRef);
    const re = await cook(ge);
    const rr = await cook(gr);

    expect(bytes(snapshotGeometry(firstGeo(rr.outputs.result)))).toBe(
      bytes(snapshotGeometry(firstGeo(re.outputs.result))),
    );
    // Not just the same values: the same cache decisions, which is what a
    // byte-compared cook report would show. Both forms travel one
    // construction route, so the transitive version key matches too.
    expect({ cooked: rr.stats.cooked, cached: rr.stats.cached }).toEqual({
      cooked: re.stats.cooked,
      cached: re.stats.cached,
    });
    expect(memoKeyOf(gr, "sub")).toBe(memoKeyOf(ge, "sub"));
  });

  it("round-trips both forms as fixed points", () => {
    const embedded = buildEmbedded();
    registerSubgraph("test/jitter", recipeOf(embedded));
    const byRef = refForm(embedded, "test/jitter");

    expect(serializeGraph(deserializeGraph(embedded))).toEqual(embedded);
    // The reference is written back out AS a reference — no re-embedding,
    // and no hash invented for a ref that carried none.
    const out = serializeGraph(deserializeGraph(byRef));
    expect(out).toEqual(byRef);
    const node = out.nodes.find((n) => n.id === "sub");
    expect(node?.ref).toEqual({ name: "test/jitter" });
    expect(node?.subgraph).toBeUndefined();
    expect(node?.params).toEqual(recipeParams(embedded));
  });

  it("still round-trips a reference after cooking it", async () => {
    // Cooking writes the outer node's exposed values and a derived seed
    // into the shared inner graph. Both are undone (values restored, seed
    // taken from the recorded wrap-time one), so the reference still
    // matches the registered recipe — otherwise the divergence check below
    // would fire on a graph nobody edited.
    const embedded = buildEmbedded();
    registerSubgraph("test/jitter", recipeOf(embedded));
    const byRef = refForm(embedded, "test/jitter");
    const g = deserializeGraph(byRef);
    await cook(g);
    expect(serializeGraph(g)).toEqual(byRef);
  });

  it("keeps a pinned reference's hash across the round trip", () => {
    const embedded = buildEmbedded();
    const entry = registerSubgraph("test/jitter", recipeOf(embedded));
    const byRef = refForm(embedded, "test/jitter", entry.hash);
    expect(serializeGraph(deserializeGraph(byRef))).toEqual(byRef);
  });

  it("carries exposed-param values through the reference unchanged", async () => {
    const embedded = buildEmbedded();
    registerSubgraph("test/jitter", recipeOf(embedded));
    // A value the recipe's default does not carry: it must reach the inner
    // node through the reference exactly as it does through the payload.
    const withValues = (g: SerializedGraph): SerializedGraph => ({
      ...g,
      nodes: g.nodes.map((n) =>
        n.id === "sub" ? { ...n, params: { ...n.params, amount: [2, 0, 2], spin: [0, 90, 0] } } : n,
      ),
    });
    const ge = deserializeGraph(withValues(embedded));
    const gr = deserializeGraph(withValues(refForm(embedded, "test/jitter")));
    expect(ge.require("sub").params).toEqual(gr.require("sub").params);
    const re = await cook(ge);
    const rr = await cook(gr);
    expect(bytes(snapshotGeometry(firstGeo(rr.outputs.result)))).toBe(
      bytes(snapshotGeometry(firstGeo(re.outputs.result))),
    );
    // ... and differs from the un-overridden cook, so the values are load-bearing.
    const plain = await cook(deserializeGraph(refForm(embedded, "test/jitter")));
    expect(bytes(snapshotGeometry(firstGeo(rr.outputs.result)))).not.toBe(
      bytes(snapshotGeometry(firstGeo(plain.outputs.result))),
    );
  });

  // ------------------------------------------------------------ registry

  it("canonicalizes a sparsely authored recipe to the embedded payload", () => {
    const embedded = buildEmbedded();
    const canonical = recipeOf(embedded);
    // The same primitive, authored the way a human would: params omitted.
    const sparse: SerializedSubgraph = {
      graph: {
        formatVersion: 1,
        seed: 11,
        meta: { title: "Jittered", description: "jitter, then transform", tags: ["test"] },
        nodes: [
          { id: "jit", type: "jitterPoints", params: { amount: [0.2, 0, 0.2], seed: 3 } },
          { id: "xf", type: "transformPoints", params: { translate: [1, 0, 0] } },
        ],
        connections: [{ from: ["jit", "out"], to: ["xf", "in"] }],
        outputs: [],
      },
      inputs: canonical.inputs,
      outputs: canonical.outputs,
      params: canonical.params,
    };
    expect(sparse.graph.nodes[1].params).not.toEqual(canonical.graph.nodes[1].params);
    const entry = registerSubgraph("test/sparse", sparse);
    expect(entry.subgraph).toEqual(canonical);
    expect(entry.hash).toBe(subgraphContentHash(canonical));
    expect(entry.meta).toEqual({
      title: "Jittered",
      description: "jitter, then transform",
      tags: ["test"],
    });
  });

  it("is a fixed point on an already canonical recipe, and freezes what it stores", () => {
    const canonical = recipeOf(buildEmbedded());
    const entry = registerSubgraph("test/jitter", canonical);
    expect(entry.subgraph).toEqual(canonical);
    expect(Object.isFrozen(entry.subgraph)).toBe(true);
    expect(Object.isFrozen(entry.subgraph.graph.nodes[0].params)).toBe(true);
  });

  it("accepts a live Graph and never holds on to it", async () => {
    const inner = new Graph(4);
    const xf = inner.add(transformPoints, { translate: [3, 0, 0] }, "xf");
    registerSubgraph("test/live", {
      graph: inner,
      inputs: [{ name: "pts", node: "xf", pin: "in" }],
      outputs: [{ name: "out", node: "xf", pin: "out" }],
    });
    // The registry serialized the graph; later edits to the live object
    // cannot reach a reference resolved from the stored recipe.
    inner.setParam(xf, "translate", [99, 0, 0]);
    const g = deserializeGraph({
      formatVersion: 1,
      seed: 1,
      nodes: [
        { id: "src", type: "pointScatterInBounds", params: { count: 3, seed: 1 } },
        { id: "s", type: "subgraph", params: {}, ref: { name: "test/live" } },
      ],
      connections: [{ from: ["src", "out"], to: ["s", "pts"] }],
      outputs: [{ id: "s", pin: "out", name: "result" }],
    });
    const inner2 = getSubgraphSpec(g.require("s").def)?.graph;
    expect(inner2?.require("xf").params.translate).toEqual([3, 0, 0]);
    await expect(cook(g)).resolves.toBeDefined();
  });

  it("rejects a duplicate name", () => {
    const recipe = recipeOf(buildEmbedded());
    registerSubgraph("test/jitter", recipe);
    expect(() => registerSubgraph("test/jitter", recipe)).toThrow(
      /registerSubgraph "test\/jitter": a subgraph with this name is already registered/,
    );
  });

  it("rejects an empty name", () => {
    expect(() => registerSubgraph("  ", recipeOf(buildEmbedded()))).toThrow(
      /registerSubgraph: name must be a non-empty string/,
    );
  });

  it("validates the recipe at registration, with the author's stack", () => {
    const recipe = recipeOf(buildEmbedded());
    const broken: SerializedSubgraph = {
      ...recipe,
      graph: {
        ...recipe.graph,
        nodes: [{ id: "nope", type: "notARealNode", params: {} }],
        connections: [],
      },
    };
    expect(() => registerSubgraph("test/broken", broken)).toThrow(
      /registerSubgraph "test\/broken": node "nope": unknown node type "notARealNode"; registered types: /,
    );
    // The scaffolding node the canonicalizer wraps the recipe in is not
    // mentioned: the message names the offending inner node and nothing else.
    expect(() => registerSubgraph("test/broken2", broken)).not.toThrow(/"recipe"/);
    expect(listSubgraphs()).toHaveLength(0);
  });

  it("reports registrations in registration order", () => {
    const recipe = recipeOf(buildEmbedded());
    registerSubgraph("z/one", recipe);
    registerSubgraph("a/two", recipe);
    expect(listSubgraphs().map((s) => s.name)).toEqual(["z/one", "a/two"]);
  });

  // ------------------------------------------------------------ unknowns

  it("names an unknown subgraph and lists what IS registered, sorted", () => {
    const recipe = recipeOf(buildEmbedded());
    registerSubgraph("scatter/grid", recipe);
    registerSubgraph("fill/rows", recipe);
    expect(() => deserializeGraph(refGraph("scater/grid"))).toThrow(
      /node "s": unknown subgraph "scater\/grid"; registered subgraphs: fill\/rows, scatter\/grid/,
    );
  });

  it("says so when nothing is registered at all", () => {
    expect(() => deserializeGraph(refGraph("scatter/grid"))).toThrow(
      /node "s": unknown subgraph "scatter\/grid" — no subgraphs are registered; call registerSubgraph\(name, spec\) before loading a graph that references one/,
    );
  });

  // ---------------------------------------------------------------- hash

  it("hard-errors on a hash mismatch, naming both hashes and both fixes", () => {
    const embedded = buildEmbedded();
    registerSubgraph("test/jitter", recipeOf(embedded));
    const stale = "0123456789abcdef";
    expect(() => deserializeGraph(refForm(embedded, "test/jitter", stale))).toThrow(
      GraphSerializationError,
    );
    expect(() => deserializeGraph(refForm(embedded, "test/jitter", stale))).toThrow(
      /node "sub": subgraph "test\/jitter" is pinned to content hash 0123456789abcdef, but the registered one hashes [0-9a-f]{16} — the primitive changed since this graph was written\. Re-save the graph to adopt the new version, or remove "hash" from the ref to follow the registry\./,
    );
  });

  it("lets a name-only reference follow a changed registry, and refuses a pinned one", async () => {
    const v1 = buildEmbedded();
    const v1Entry = registerSubgraph("test/jitter", recipeOf(v1));
    const unpinned = refForm(v1, "test/jitter");
    const pinned = refForm(v1, "test/jitter", v1Entry.hash);
    await expect(cook(deserializeGraph(unpinned))).resolves.toBeDefined();
    await expect(cook(deserializeGraph(pinned))).resolves.toBeDefined();

    // The library improves the primitive: same name, different content.
    __resetSubgraphRegistry();
    const improved = recipeOf(v1);
    const v2 = registerSubgraph("test/jitter", {
      ...improved,
      graph: {
        ...improved.graph,
        nodes: improved.graph.nodes.map((n) =>
          n.id === "xf" ? { ...n, params: { ...n.params, translate: [4, 0, 0] } } : n,
        ),
      },
    });
    expect(v2.hash).not.toBe(v1Entry.hash);

    // Unpinned: loads and cooks the new version, no friction, no warning.
    const after = await cook(deserializeGraph(unpinned));
    const before = await cook(deserializeGraph(unpinned));
    expect(bytes(snapshotGeometry(firstGeo(after.outputs.result)))).toBe(
      bytes(snapshotGeometry(firstGeo(before.outputs.result))),
    );
    // Pinned: the author asked for exactly what they authored against.
    expect(() => deserializeGraph(pinned)).toThrow(/is pinned to content hash/);
  });

  it("hashes what changes the cook, and nothing else", () => {
    const recipe = recipeOf(buildEmbedded());
    const base = subgraphContentHash(recipe);
    expect(base).toMatch(/^[0-9a-f]{16}$/);

    const withGraph = (graph: SerializedGraph): SerializedSubgraph => ({ ...recipe, graph });

    // Excluded: meta at every level, graph seed, exposed-param descriptions.
    expect(
      subgraphContentHash(
        withGraph({ ...recipe.graph, meta: { title: "renamed", description: "other", tags: [] } }),
      ),
    ).toBe(base);
    expect(subgraphContentHash(withGraph({ ...recipe.graph, seed: 987654 }))).toBe(base);
    expect(
      subgraphContentHash({
        ...recipe,
        params: recipe.params?.map((p) => ({ ...p, description: "reworded" })),
      }),
    ).toBe(base);

    // Included: a node param value, a connection, an exposed pin mapping,
    // an exposed param's default and its bounds.
    expect(
      subgraphContentHash(
        withGraph({
          ...recipe.graph,
          nodes: recipe.graph.nodes.map((n) =>
            n.id === "xf" ? { ...n, params: { ...n.params, translate: [1, 0, 0.5] } } : n,
          ),
        }),
      ),
    ).not.toBe(base);
    expect(subgraphContentHash(withGraph({ ...recipe.graph, connections: [] }))).not.toBe(base);
    expect(
      subgraphContentHash({ ...recipe, outputs: [{ name: "other", node: "xf", pin: "out" }] }),
    ).not.toBe(base);
    expect(
      subgraphContentHash({
        ...recipe,
        params: recipe.params?.map((p) => (p.name === "spin" ? { ...p, default: [0, 5, 0] } : p)),
      }),
    ).not.toBe(base);
    expect(
      subgraphContentHash({
        ...recipe,
        params: recipe.params?.map((p) => (p.name === "spin" ? { ...p, min: -1 } : p)),
      }),
    ).not.toBe(base);
  });

  it("mixes two independently salted folds into the 64-bit hash", () => {
    // The two halves are separate folds of one string. Were they the same
    // fold, the value would be 16 hex digits carrying 32 bits — a birthday
    // bound around 65k, needlessly tight for something written into user
    // files — while looking twice as wide as it is.
    const h = subgraphContentHash(recipeOf(buildEmbedded()));
    expect(h.slice(0, 8)).not.toBe(h.slice(8));
  });

  it("hashes WHICH named primitive a nested reference resolves to", () => {
    const shell = (ref: string): SerializedSubgraph => ({
      graph: {
        formatVersion: 1,
        seed: 0,
        nodes: [{ id: "n", type: "subgraph", params: {}, ref: { name: ref } }],
        connections: [],
        outputs: [],
      },
      inputs: [],
      outputs: [],
    });
    expect(subgraphContentHash(shell("test/leaf"))).not.toBe(
      subgraphContentHash(shell("test/other")),
    );
    // ... and a pinned nested reference is distinct from an unpinned one.
    const pinned: SerializedSubgraph = {
      ...shell("test/leaf"),
      graph: {
        ...shell("test/leaf").graph,
        nodes: [
          { id: "n", type: "subgraph", params: {}, ref: { name: "test/leaf", hash: "abcdef0123456789" } },
        ],
      },
    };
    expect(subgraphContentHash(pinned)).not.toBe(subgraphContentHash(shell("test/leaf")));
  });

  it("does not depend on param key order", () => {
    const recipe = recipeOf(buildEmbedded());
    const reordered: SerializedSubgraph = {
      ...recipe,
      graph: {
        ...recipe.graph,
        nodes: recipe.graph.nodes.map((n) => ({
          ...n,
          params: Object.fromEntries(Object.entries(n.params).reverse()),
        })),
      },
    };
    expect(bytes(reordered.graph.nodes[0].params)).not.toBe(bytes(recipe.graph.nodes[0].params));
    expect(subgraphContentHash(reordered)).toBe(subgraphContentHash(recipe));
  });

  // -------------------------------------------------------------- cycles

  it("refuses a recipe that references the subgraph being registered", () => {
    const recipe = recipeOf(buildEmbedded());
    const selfish: SerializedSubgraph = {
      ...recipe,
      graph: {
        ...recipe.graph,
        nodes: [
          ...recipe.graph.nodes,
          { id: "me", type: "subgraph", params: {}, ref: { name: "test/selfish" } },
        ],
      },
    };
    expect(() => registerSubgraph("test/selfish", selfish)).toThrow(
      /registerSubgraph "test\/selfish": its recipe references "test\/selfish", the subgraph being registered — named subgraph references must be acyclic/,
    );
  });

  it("finds a self-reference buried in an embedded payload inside the recipe", () => {
    const recipe = recipeOf(buildEmbedded());
    const nested: SerializedSubgraph = {
      ...recipe,
      graph: {
        ...recipe.graph,
        nodes: [
          ...recipe.graph.nodes,
          {
            id: "wrapper",
            type: "subgraph",
            params: {},
            subgraph: {
              graph: {
                formatVersion: 1,
                seed: 0,
                nodes: [{ id: "me", type: "subgraph", params: {}, ref: { name: "test/nested" } }],
                connections: [],
                outputs: [],
              },
              inputs: [],
              outputs: [],
            },
          },
        ],
      },
    };
    expect(() => registerSubgraph("test/nested", nested)).toThrow(
      /registerSubgraph "test\/nested": its recipe references "test\/nested", the subgraph being registered/,
    );
  });

  it("refuses a mutual name cycle at resolution rather than recursing forever", () => {
    // Unconstructible through registerSubgraph — canonicalization
    // materializes every nested ref, so "a" would have to be registered
    // before "b" and "b" before "a" — so the guard is exercised past the
    // door that makes it unreachable.
    const shell = (ref: string): SerializedSubgraph => ({
      graph: {
        formatVersion: 1,
        seed: 0,
        nodes: [{ id: "n", type: "subgraph", params: {}, ref: { name: ref } }],
        connections: [],
        outputs: [],
      },
      inputs: [],
      outputs: [],
    });
    __defineSubgraphUnchecked("a", shell("b"));
    __defineSubgraphUnchecked("b", shell("a"));
    expect(() => deserializeGraph(refGraph("a"))).toThrow(
      /subgraph reference cycle "a" -> "b" -> "a"; named subgraph references must be acyclic/,
    );
  });

  it("still refuses a self-referencing payload object (the other cycle guard)", () => {
    const payload: Record<string, unknown> = { inputs: [], outputs: [] };
    payload.graph = {
      formatVersion: 1,
      seed: 0,
      nodes: [{ id: "inner", type: "subgraph", params: {}, subgraph: payload }],
      connections: [],
      outputs: [],
    };
    expect(() =>
      deserializeGraph({
        formatVersion: 1,
        seed: 0,
        nodes: [{ id: "s", type: "subgraph", params: {}, subgraph: payload }],
        connections: [],
        outputs: [],
      }),
    ).toThrow(/node "inner".*payload cycle/);
  });

  // --------------------------------------------------- ref/subgraph keys

  it("refuses a node carrying both ref and subgraph", () => {
    const embedded = buildEmbedded();
    registerSubgraph("test/jitter", recipeOf(embedded));
    const both: SerializedGraph = {
      ...embedded,
      nodes: embedded.nodes.map((n) =>
        n.id === "sub" ? { ...n, ref: { name: "test/jitter" } } : n,
      ),
    };
    expect(() => deserializeGraph(both)).toThrow(
      /node "sub": carries both "ref" and "subgraph"; a subgraph node either references a registered subgraph by name \("ref"\) or embeds its inner graph \("subgraph"\), never both/,
    );
  });

  it("refuses a subgraph node carrying neither, naming both routes", () => {
    expect(() =>
      deserializeGraph({
        formatVersion: 1,
        seed: 0,
        nodes: [{ id: "s", type: "subgraph", params: {} }],
        connections: [],
        outputs: [],
      }),
    ).toThrow(/node "s": a "subgraph" node needs a "subgraph" payload object .* or a "ref" \{ name \} naming a registered one/);
  });

  it("refuses a malformed ref and an unknown key inside it", () => {
    registerSubgraph("test/jitter", recipeOf(buildEmbedded()));
    const withRef = (ref: unknown): unknown => ({
      formatVersion: 1,
      seed: 0,
      nodes: [{ id: "s", type: "subgraph", params: {}, ref }],
      connections: [],
      outputs: [],
    });
    expect(() => deserializeGraph(withRef(7))).toThrow(
      /node "s": "ref" must be an object \{ name, hash\? \} naming a registered subgraph, got 7/,
    );
    expect(() => deserializeGraph(withRef({ name: "" }))).toThrow(
      /node "s": "ref"\.name must be a non-empty string/,
    );
    expect(() => deserializeGraph(withRef({ name: "test/jitter", hash: 4 }))).toThrow(
      /node "s": "ref"\.hash must be a string when present/,
    );
    // The typo that would otherwise turn a pinned ref into an unpinned one.
    expect(() => deserializeGraph(withRef({ name: "test/jitter", hsh: "abc" }))).toThrow(
      /node "s" ref: unknown key "hsh"; valid keys: name, hash/,
    );
  });

  it("refuses ref or subgraph on a node that wraps no inner graph", () => {
    registerSubgraph("test/jitter", recipeOf(buildEmbedded()));
    for (const key of ["ref", "subgraph"]) {
      expect(() =>
        deserializeGraph({
          formatVersion: 1,
          seed: 0,
          nodes: [
            { id: "p", type: "pointScatterInBounds", params: {}, [key]: { name: "test/jitter" } },
          ],
          connections: [],
          outputs: [],
        }),
      ).toThrow(
        new RegExp(
          `node "p": type "pointScatterInBounds" wraps no inner graph, so it cannot carry "${key}"; ` +
            `only "subgraph" and "forEach" nodes wrap one`,
        ),
      );
    }
  });

  // -------------------------------------------------------- unknown keys

  it("refuses an unknown key on a node object — the typo that used to cook", () => {
    registerSubgraph("test/jitter", recipeOf(buildEmbedded()));
    expect(() =>
      deserializeGraph({
        formatVersion: 1,
        seed: 0,
        nodes: [{ id: "s", type: "subgraph", params: {}, refs: { name: "test/jitter" } }],
        connections: [],
        outputs: [],
      }),
    ).toThrow(
      /node "s": unknown key "refs"; valid keys: id, type, params, subgraph, ref\. The format is closed .* There is no annotation key: descriptive text belongs in the graph's "meta" block/s,
    );
  });

  it("refuses an unknown key at the top level of a graph", () => {
    expect(() =>
      deserializeGraph({
        formatVersion: 1,
        seed: 0,
        note: "a comment",
        nodes: [],
        connections: [],
        outputs: [],
      }),
    ).toThrow(
      /deserializeGraph: unknown key "note"; valid keys: formatVersion, seed, meta, params, nodes, connections, outputs/,
    );
  });

  it("refuses an unknown key inside a subgraph payload", () => {
    const embedded = buildEmbedded();
    const typo: SerializedGraph = {
      ...embedded,
      nodes: embedded.nodes.map((n) =>
        n.id === "sub" ? { ...n, subgraph: { ...recipeOf(embedded), prams: [] } } : n,
      ),
    } as SerializedGraph;
    expect(() => deserializeGraph(typo)).toThrow(
      /node "sub" subgraph payload: unknown key "prams"; valid keys: graph, inputs, outputs, params/,
    );
  });

  it("refuses an unknown key inside a nested inner graph too", () => {
    const embedded = buildEmbedded();
    const typo: SerializedGraph = {
      ...embedded,
      nodes: embedded.nodes.map((n) => {
        if (n.id !== "sub" || n.subgraph === undefined) return n;
        return { ...n, subgraph: { ...n.subgraph, graph: { ...n.subgraph.graph, notes: 1 } } };
      }),
    } as SerializedGraph;
    expect(() => deserializeGraph(typo)).toThrow(
      /node "sub" inner graph: deserializeGraph: unknown key "notes"/,
    );
  });

  // The closure is only worth anything if it is total. A lenient NESTED
  // object is the same near-miss one level down, and the nested positions
  // are where the plausible typos actually live.

  it("refuses an unknown key on a connection", () => {
    expect(() =>
      deserializeGraph({
        formatVersion: 1,
        seed: 0,
        nodes: [
          { id: "a", type: "pointScatterInBounds", params: {} },
          { id: "b", type: "jitterPoints", params: {} },
        ],
        connections: [{ from: ["a", "out"], to: ["b", "in"], label: "scatter -> jitter" }],
        outputs: [],
      }),
    ).toThrow(/connections\[0\]: unknown key "label"; valid keys: from, to\. The format is closed/s);
  });

  it("refuses an unknown key on a declared output — the annotation that does not exist", () => {
    expect(() =>
      deserializeGraph({
        formatVersion: 1,
        seed: 0,
        nodes: [{ id: "a", type: "pointScatterInBounds", params: {} }],
        connections: [],
        outputs: [{ id: "a", pin: "out", name: "pts", description: "the scattered points" }],
      }),
    ).toThrow(
      /outputs\[0\]: unknown key "description"; valid keys: id, pin, name\..*There is no annotation key: descriptive text belongs in the graph's "meta" block/s,
    );
  });

  it("refuses an unknown key on an exposed pin declaration", () => {
    const embedded = buildEmbedded();
    const recipe = recipeOf(embedded);
    const typo = {
      ...embedded,
      nodes: embedded.nodes.map((n) =>
        n.id === "sub"
          ? {
              ...n,
              subgraph: { ...recipe, inputs: recipe.inputs.map((p) => ({ ...p, kind: "geometry" })) },
            }
          : n,
      ),
    };
    expect(() => deserializeGraph(typo)).toThrow(
      /node "sub" subgraph inputs\[0\]: unknown key "kind"; valid keys: name, node, pin/,
    );
  });

  it("refuses an unknown key on an exposed-param declaration", () => {
    expect(() => deserializeGraph(withExposedParams({ maximum: 5 }))).toThrow(
      /node "sub" subgraph params\[0\] \("amount"\): unknown key "maximum"; valid keys: name, targets, description, default, min, max\..*Prose about this param belongs in its "description"/s,
    );
  });

  // These three are not typos — they are real ParamSchema field names an
  // author or an agent reaches for, and they are the exact keys the schema
  // is RE-DERIVED from the targets instead of reading. Refusing them as
  // merely "unknown" would teach the wrong lesson, so they say why.
  for (const key of ["type", "enum", "acceptsField"] as const) {
    it(`refuses the re-derived exposed-param key "${key}", with the reason`, () => {
      const value = key === "type" ? "vec3" : key === "enum" ? ["a", "b"] : true;
      expect(() => deserializeGraph(withExposedParams({ [key]: value }))).toThrow(
        new RegExp(
          `node "sub" subgraph params\\[0\\] \\("amount"\\): key "${key}" cannot be authored — it is derived from the targets' registered schemas; remove it\\. Valid keys: name, targets, description, default, min, max`,
        ),
      );
    });
  }

  it("refuses an unknown key on an exposed-param target", () => {
    expect(() =>
      deserializeGraph(withExposedParams({ targets: [{ node: "jit", param: "amount", label: "x" }] })),
    ).toThrow(
      /node "sub" subgraph params\[0\] \("amount"\) targets\[0\]: unknown key "label"; valid keys: node, param/,
    );
  });

  // -------------------------------------------------------- invalidation

  it("gives each reference its own inner graph, cache and invalidation", async () => {
    const embedded = buildEmbedded();
    registerSubgraph("test/jitter", recipeOf(embedded));
    const json: SerializedGraph = {
      formatVersion: 1,
      seed: 9,
      nodes: [
        { id: "src", type: "pointScatterInBounds", params: { count: 12, seed: 2 } },
        { id: "s1", type: "subgraph", params: {}, ref: { name: "test/jitter" } },
        { id: "s2", type: "subgraph", params: {}, ref: { name: "test/jitter" } },
      ],
      connections: [
        { from: ["src", "out"], to: ["s1", "pts"] },
        { from: ["src", "out"], to: ["s2", "pts"] },
      ],
      outputs: [
        { id: "s1", pin: "out", name: "a" },
        { id: "s2", pin: "out", name: "b" },
      ],
    };
    const g = deserializeGraph(json);
    const g1 = getSubgraphSpec(g.require("s1").def)?.graph;
    const g2 = getSubgraphSpec(g.require("s2").def)?.graph;
    expect(g1).toBeDefined();
    expect(g1).not.toBe(g2); // one materialization per reference

    const r1 = await cook(g);
    // Different outer node ids derive different inner seeds — the jitter
    // differs, which is correct, not a bug.
    expect(bytes(snapshotGeometry(firstGeo(r1.outputs.a)))).not.toBe(
      bytes(snapshotGeometry(firstGeo(r1.outputs.b)))
    );
    expect(r1.stats.cooked).toBe(3);
    const r2 = await cook(g);
    expect({ cooked: r2.stats.cooked, cached: r2.stats.cached }).toEqual({ cooked: 0, cached: 3 });

    // transitiveVersionKey needs no extension: it reads the live graph,
    // so an edit through one reference moves only that reference's key.
    const before1 = memoKeyOf(g, "s1");
    const before2 = memoKeyOf(g, "s2");
    expect(before1).toBe(before2);
    g1?.setParam({ id: "xf" } as NodeHandle<Record<string, unknown>>, "translate", [6, 0, 0]);
    expect(memoKeyOf(g, "s1")).not.toBe(before1);
    expect(memoKeyOf(g, "s2")).toBe(before2);
    const r3 = await cook(g);
    expect(r3.stats.cooked).toBe(1);
    expect(r3.stats.cached).toBe(2);
  });

  it("nests named primitives, and invalidates the outer one on the deepest edit", async () => {
    const leaf: SerializedSubgraph = {
      graph: {
        formatVersion: 1,
        seed: 2,
        nodes: [{ id: "xf", type: "transformPoints", params: { translate: [1, 0, 0] } }],
        connections: [],
        outputs: [],
      },
      inputs: [{ name: "in", node: "xf", pin: "in" }],
      outputs: [{ name: "out", node: "xf", pin: "out" }],
    };
    registerSubgraph("test/leaf", leaf);
    registerSubgraph("test/branch", {
      graph: {
        formatVersion: 1,
        seed: 5,
        nodes: [{ id: "l", type: "subgraph", params: {}, ref: { name: "test/leaf" } }],
        connections: [],
        outputs: [],
      },
      inputs: [{ name: "in", node: "l", pin: "in" }],
      outputs: [{ name: "out", node: "l", pin: "out" }],
    });

    const g = deserializeGraph({
      formatVersion: 1,
      seed: 1,
      nodes: [
        { id: "src", type: "pointScatterInBounds", params: { count: 5, seed: 1 } },
        { id: "s", type: "subgraph", params: {}, ref: { name: "test/branch" } },
      ],
      connections: [{ from: ["src", "out"], to: ["s", "in"] }],
      outputs: [{ id: "s", pin: "out", name: "result" }],
    });
    const key = memoKeyOf(g, "s");
    expect(key).toMatch(/^\d+\/\d+$/); // one segment per nesting level
    await expect(cook(g)).resolves.toBeDefined();

    const branchGraph = getSubgraphSpec(g.require("s").def)?.graph;
    const leafGraph = getSubgraphSpec(branchGraph?.require("l").def ?? { defaultParams: {} } as never)?.graph;
    expect(leafGraph).toBeDefined();
    leafGraph?.setParam({ id: "xf" } as NodeHandle<Record<string, unknown>>, "translate", [8, 0, 0]);
    expect(memoKeyOf(g, "s")).not.toBe(key);
    const after = await cook(g);
    expect(after.stats.cooked).toBe(1); // the wrapper recooked; the source did not
  });

  it("cooks a NESTED reference byte-identically to its fully embedded expansion", async () => {
    const leaf = registerSubgraph("test/leaf", {
      graph: {
        formatVersion: 1,
        seed: 2,
        nodes: [{ id: "xf", type: "transformPoints", params: { translate: [1, 2, 3] } }],
        connections: [],
        outputs: [],
      },
      inputs: [{ name: "in", node: "xf", pin: "in" }],
      outputs: [{ name: "out", node: "xf", pin: "out" }],
    });
    const branch = registerSubgraph("test/branch", {
      graph: {
        formatVersion: 1,
        seed: 5,
        nodes: [
          { id: "l", type: "subgraph", params: {}, ref: { name: "test/leaf" } },
          { id: "j", type: "jitterPoints", params: { amount: [0.3, 0, 0.3], seed: 4 } },
        ],
        connections: [{ from: ["l", "out"], to: ["j", "in"] }],
        outputs: [],
      },
      inputs: [{ name: "in", node: "l", pin: "in" }],
      outputs: [{ name: "out", node: "j", pin: "out" }],
    });
    const outer = (sub: SerializedNode): SerializedGraph => ({
      formatVersion: 1,
      seed: 13,
      nodes: [{ id: "src", type: "pointScatterInBounds", params: { count: 9, seed: 6 } }, sub],
      connections: [{ from: ["src", "out"], to: ["s", "in"] }],
      outputs: [{ id: "s", pin: "out", name: "result" }],
    });
    // Expand BOTH levels by hand: the outer ref becomes the branch recipe,
    // and the nested ref inside it becomes the leaf recipe.
    const expanded: SerializedNode = {
      id: "s",
      type: "subgraph",
      params: {},
      subgraph: {
        ...branch.subgraph,
        graph: {
          ...branch.subgraph.graph,
          nodes: branch.subgraph.graph.nodes.map((n) =>
            n.id === "l" ? { id: n.id, type: n.type, params: n.params, subgraph: leaf.subgraph } : n,
          ),
        },
      },
    };
    const byRef = deserializeGraph(outer({ id: "s", type: "subgraph", params: {}, ref: { name: "test/branch" } }));
    const byValue = deserializeGraph(outer(expanded));
    const rr = await cook(byRef);
    const rv = await cook(byValue);
    expect(bytes(snapshotGeometry(firstGeo(rr.outputs.result)))).toBe(
      bytes(snapshotGeometry(firstGeo(rv.outputs.result))),
    );
    expect({ cooked: rr.stats.cooked, cached: rr.stats.cached }).toEqual({
      cooked: rv.stats.cooked,
      cached: rv.stats.cached,
    });
    expect(memoKeyOf(byRef, "s")).toBe(memoKeyOf(byValue, "s"));
  });

  it("round-trips a graph nesting named primitives, references and all", () => {
    registerSubgraph("test/leaf", {
      graph: {
        formatVersion: 1,
        seed: 2,
        nodes: [{ id: "xf", type: "transformPoints", params: { translate: [1, 0, 0] } }],
        connections: [],
        outputs: [],
      },
      inputs: [{ name: "in", node: "xf", pin: "in" }],
      outputs: [{ name: "out", node: "xf", pin: "out" }],
    });
    const branch = registerSubgraph("test/branch", {
      graph: {
        formatVersion: 1,
        seed: 5,
        nodes: [{ id: "l", type: "subgraph", params: {}, ref: { name: "test/leaf" } }],
        connections: [],
        outputs: [],
      },
      inputs: [{ name: "in", node: "l", pin: "in" }],
      outputs: [{ name: "out", node: "l", pin: "out" }],
    });
    // The nested reference survives canonicalization AS a reference.
    expect(branch.subgraph.graph.nodes[0].ref).toEqual({ name: "test/leaf" });
    expect(branch.subgraph.graph.nodes[0].subgraph).toBeUndefined();

    const json = refGraph("test/branch");
    expect(serializeGraph(deserializeGraph(json))).toEqual(json);
  });

  // ------------------------------------------------------- writer honesty

  it("refuses to write a reference back out after its inner graph was edited", () => {
    const embedded = buildEmbedded();
    registerSubgraph("test/jitter", recipeOf(embedded));
    const g = deserializeGraph(refForm(embedded, "test/jitter"));
    expect(() => serializeGraph(g)).not.toThrow();
    getSubgraphSpec(g.require("sub").def)?.graph.setParam(
      { id: "xf" } as NodeHandle<Record<string, unknown>>,
      "translate",
      [5, 5, 5],
    );
    expect(() => serializeGraph(g)).toThrow(
      /cannot serialize node "sub": it references the registered subgraph "test\/jitter", but its inner graph no longer matches the registered recipe — writing the reference back out would silently discard the edit/,
    );
  });

  it("says so when the referenced subgraph is gone from the registry", () => {
    const embedded = buildEmbedded();
    registerSubgraph("test/jitter", recipeOf(embedded));
    const g = deserializeGraph(refForm(embedded, "test/jitter"));
    __resetSubgraphRegistry();
    expect(() => serializeGraph(g)).toThrow(
      /cannot serialize node "sub": it was loaded from the registered subgraph "test\/jitter", which is no longer registered/,
    );
  });
});

/**
 * A fixed, hand-authored recipe over a shipped node type. Deliberately
 * covers every hashed position at once — a node id, a node type, a param
 * value, a declared output, both exposed pin directions, and an exposed
 * param with targets, a default and a bound — so the golden below moves
 * for a change anywhere in the pipeline, not just in one branch.
 */
const GOLDEN_RECIPE = {
  graph: {
    formatVersion: 1,
    seed: 0,
    nodes: [{ id: "xf", type: "transformPoints", params: { translate: [1, 2, 3] } }],
    connections: [],
    outputs: [{ id: "xf", pin: "out", name: "out" }],
  },
  inputs: [{ name: "pts", node: "xf", pin: "in" }],
  outputs: [{ name: "out", node: "xf", pin: "out" }],
  params: [
    {
      name: "shift",
      targets: [{ node: "xf", param: "translate" }],
      description: "How far to move the points.",
      default: [1, 2, 3],
      max: 100,
    },
  ],
} as const;

/**
 * `ref.hash` is not an internal value: it is written into user files, and a
 * mismatch against the registry is a hard error rather than a warning. So
 * an injective RELABELING of the hash — a different salt, a reworked
 * `fold`, a different key order or separator out of `stableStringify` —
 * invalidates every pin any user has already saved, while leaving every
 * other test in this file green, because they all compare hashes to other
 * hashes computed the same way.
 *
 * This is the one test that compares a hash to something outside the
 * program. It is the same reason `src/version.test.ts` pins a literal.
 *
 * **If it fails, updating the constant is not the fix.** The literal moving
 * means saved pins broke, and the response is a release decision: bump
 * `formatVersion` (or the library's major/minor with the break announced)
 * and only then re-pin. The hash is documented as stable within a build and
 * NOT across versions, so a registry schema change that moves it is a real,
 * intended break — this test is what makes it visible rather than silent.
 */
describe("the content hash is a persisted contract", () => {
  beforeEach(() => __resetSubgraphRegistry());

  it("hashes a fixed recipe to a pinned literal", () => {
    const entry = registerSubgraph("golden/nudge", GOLDEN_RECIPE);
    expect(entry.hash).toBe("7e37be5cb5e14967");
    // The exported function agrees with what registration stored, so the
    // literal pins the public entry point too, not only the private path.
    expect(subgraphContentHash(entry.subgraph)).toBe(entry.hash);
  });
});

/** The exposed-param values the embedded form's `sub` node carries. */
function recipeParams(embedded: SerializedGraph): Record<string, unknown> {
  const node = embedded.nodes.find((n) => n.id === "sub");
  if (node === undefined) throw new Error("no sub node");
  return node.params;
}
