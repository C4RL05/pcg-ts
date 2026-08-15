/**
 * Memo-key provenance and threading tests (CPU-only, run everywhere):
 * a stub resolver — implementing the core GpuFieldResolver contract
 * over the CPU evaluator — drives cache surgery across the gpu toggle,
 * stats plumbing, subgraph forwarding, and World threading without any
 * device. The real-device equivalents live in
 * integration.device.test.ts.
 */
import { describe, expect, it } from "vitest";
import { randomField, type GpuFieldResolver } from "../fields/index.js";
import { Graph, cook, makeGeometryItem, subgraphNode } from "../graph/index.js";
import { setAttribute } from "../nodes/index.js";
import { acceptsDerivedSpecs } from "../fields/spec.js";
import { fieldFromJson } from "../fields/fieldJson.js";
import { dataInput } from "../runtime/index.js";
import { World } from "../runtime/world.js";
import { makeParityGeometry } from "./testGeometry.js";
import { cpuResolveField, opaqueField } from "./testHelpers.js";

const SPEC = { fn: "mul", args: [{ fn: "attribute", name: "density" }, { fn: "randomField", key: "jitter" }] };

/**
 * Stub resolver: eligible fields "resolve on the GPU" by evaluating on
 * the CPU into a fresh column (honoring the freshness contract);
 * ineligible ones fall back with the production reason. The gate is the
 * production predicate driven by the flag the stub advertises, so the
 * double resolves exactly the population the executor salts.
 */
function stubResolver(
  salt: string,
  opts: { acceptDerivedSpecs?: boolean } = {},
): GpuFieldResolver & { calls: number } {
  const accept = acceptsDerivedSpecs(opts);
  const stub: GpuFieldResolver & { calls: number } = {
    calls: 0,
    cacheSalt: salt,
    acceptDerivedSpecs: accept,
    resolveField(field, ctx, stats) {
      stub.calls++;
      return cpuResolveField(field, ctx, stats, accept);
    },
  };
  return stub;
}

function makeSetAttributeGraph(value: unknown): Graph {
  const g = new Graph(7);
  const din = g.add(dataInput);
  g.setParam(din, "items", [makeGeometryItem(makeParityGeometry(50))]);
  const sa = g.add(setAttribute);
  g.setParam(sa, "name", "d");
  g.setParam(sa, "value", value as number);
  g.connect(din, "out", sa, "in");
  g.output(sa, "out", "out");
  return g;
}

function outAttrBytes(result: Awaited<ReturnType<typeof cook>>): Uint8Array {
  const item = result.outputs.out[0];
  if (item.kind !== "geometry") throw new Error("expected geometry");
  const attr = item.geo.attrs.point.require("d");
  const n = item.geo.attrs.point.count * attr.tupleSize;
  return new Uint8Array(attr.data.buffer, attr.data.byteOffset, n * attr.data.BYTES_PER_ELEMENT);
}

describe("gpu memo-key provenance (stub resolver)", () => {
  it("toggling gpu recooks adopting nodes and never serves bytes across provenance", async () => {
    const g = makeSetAttributeGraph(fieldFromJson(SPEC));
    const stub = stubResolver("stub|deviceA");

    const r1 = await cook(g);
    expect(r1.stats.cooked).toBe(2);
    expect(r1.stats.gpu).toBeUndefined();

    const r2 = await cook(g, { gpu: stub });
    expect(r2.stats.cooked).toBe(1); // only setAttribute (provenance marker)
    expect(r2.stats.cached).toBe(1); // dataInput untouched by the toggle
    expect(r2.stats.gpu).toEqual({
      dispatches: 1,
      pipelinesCompiled: 0,
      pipelineCacheHits: 0,
      residentRuns: 0,
      fusedNodes: 0,
      readbacksSaved: 0,
      fallbacks: {},
      nonFinite: { counts: {}, unchecked: {} },
    });
    expect(outAttrBytes(r2)).toEqual(outAttrBytes(r1)); // stub is CPU-backed

    const r3 = await cook(g, { gpu: stub });
    expect(r3.stats.cooked).toBe(0); // same provenance → fully cached
    expect(r3.stats.gpu!.dispatches).toBe(0);

    const r4 = await cook(g);
    expect(r4.stats.cooked).toBe(1); // marker removed → recook on CPU
    expect(outAttrBytes(r4)).toEqual(outAttrBytes(r1));
  });

  it("bytes from one device salt are never served to another", async () => {
    const g = makeSetAttributeGraph(fieldFromJson(SPEC));
    await cook(g, { gpu: stubResolver("stub|deviceA") });
    const other = await cook(g, { gpu: stubResolver("stub|deviceB") });
    expect(other.stats.cooked).toBe(1); // salt differs → recook
    const same = await cook(g, { gpu: stubResolver("stub|deviceB") });
    expect(same.stats.cooked).toBe(0); // same salt → cached
  });

  it("plain-value params keep their cache across the toggle", async () => {
    const g = makeSetAttributeGraph(3);
    const first = await cook(g);
    expect(first.stats.cooked).toBe(2);
    const stub = stubResolver("stub|deviceA");
    const toggled = await cook(g, { gpu: stub });
    expect(toggled.stats.cooked).toBe(0);
    expect(toggled.stats.cached).toBe(2);
    // stats.gpu present (cook had a resolver) but untouched.
    expect(toggled.stats.gpu).toEqual({
      dispatches: 0,
      pipelinesCompiled: 0,
      pipelineCacheHits: 0,
      residentRuns: 0,
      fusedNodes: 0,
      readbacksSaved: 0,
      fallbacks: {},
      nonFinite: { counts: {}, unchecked: {} },
    });
    expect(stub.calls).toBe(0); // plain values never reach the resolver
  });

  it("code-authored field params take no provenance marker", async () => {
    const g = makeSetAttributeGraph(randomField("authored"));
    await cook(g);
    const stub = stubResolver("stub|deviceA");
    const toggled = await cook(g, { gpu: stub });
    // Derived spec, gate off → no marker → cache hit; the resolver is
    // never consulted for a cached node.
    expect(toggled.stats.cooked).toBe(0);
    expect(stub.calls).toBe(0);
  });

  it("acceptDerivedSpecs puts the marker on the same code-authored param", async () => {
    // The mirror image of the test above, and the whole point of "one
    // predicate": widening the resolver's acceptance MUST widen the memo
    // key, or a CPU entry would be served to a device cook.
    const g = makeSetAttributeGraph(randomField("authored"));
    await cook(g);
    const stub = stubResolver("stub|deviceA", { acceptDerivedSpecs: true });
    const toggled = await cook(g, { gpu: stub });
    expect(toggled.stats.cooked).toBe(1);
    expect(stub.calls).toBe(1);
    expect(toggled.stats.gpu!.dispatches).toBe(1);
  });

  it("a fresh cook of a code-authored field under gpu counts derived-spec and matches CPU bytes", async () => {
    const gGpu = makeSetAttributeGraph(randomField("authored"));
    const stub = stubResolver("stub|deviceA");
    const gpuRun = await cook(gGpu, { gpu: stub });
    expect(gpuRun.stats.gpu).toEqual({
      dispatches: 0,
      pipelinesCompiled: 0,
      pipelineCacheHits: 0,
      residentRuns: 0,
      fusedNodes: 0,
      readbacksSaved: 0,
      fallbacks: { "derived-spec": 1 },
      nonFinite: { counts: {}, unchecked: {} },
    });
    const gCpu = makeSetAttributeGraph(randomField("authored"));
    const cpuRun = await cook(gCpu);
    expect(outAttrBytes(gpuRun)).toEqual(outAttrBytes(cpuRun));
  });

  it("a genuinely indescribable field still counts no-spec, flag or no flag", async () => {
    // `no-spec` keeps its original meaning: a makeField closure can never
    // be named, so no flag admits it.
    for (const accept of [false, true]) {
      const opaque = opaqueField();
      const stub = stubResolver("stub|deviceA", { acceptDerivedSpecs: accept });
      const run = await cook(makeSetAttributeGraph(opaque), { gpu: stub });
      expect(run.stats.gpu!.fallbacks, `accept=${accept}`).toEqual({ "no-spec": 1 });
      expect(run.stats.gpu!.dispatches, `accept=${accept}`).toBe(0);
    }
  });

  it("subgraph nodes carry the marker whenever a resolver is present", async () => {
    const inner = new Graph(3);
    const din = inner.add(dataInput);
    inner.setParam(din, "items", [makeGeometryItem(makeParityGeometry(20))]);
    const sa = inner.add(setAttribute);
    inner.setParam(sa, "name", "d");
    inner.setParam(sa, "value", fieldFromJson(SPEC));
    inner.connect(din, "out", sa, "in");
    const sub = subgraphNode(inner, [], [{ name: "out", node: sa, pin: "out" }]);
    const outer = new Graph(11);
    outer.output(outer.add(sub), "out", "out");

    const stub = stubResolver("stub|deviceA");
    const cpuFirst = await cook(outer);
    expect(cpuFirst.stats.cooked).toBe(1);
    // A CPU-cooked subgraph result must not be served to a gpu cook.
    const gpuNext = await cook(outer, { gpu: stub });
    expect(gpuNext.stats.cooked).toBe(1);
    // Inner dispatch counted in the OUTER cook's stats (view routing).
    expect(gpuNext.stats.gpu!.dispatches).toBe(1);
    expect(outAttrBytes(gpuNext)).toEqual(outAttrBytes(cpuFirst));
    // Same provenance again → cached, resolver untouched.
    const callsBefore = stub.calls;
    const gpuAgain = await cook(outer, { gpu: stub });
    expect(gpuAgain.stats.cooked).toBe(0);
    expect(gpuAgain.stats.gpu!.dispatches).toBe(0);
    expect(stub.calls).toBe(callsBefore);
  });

  it("nested cook stats views route counts to the outermost sink only", async () => {
    // The subgraph test above proves the outer sink receives inner
    // dispatches; here we additionally pin that the outer cook's stats
    // object is the one exposed, with the inner cook's discarded.
    const inner = new Graph(3);
    const din = inner.add(dataInput);
    inner.setParam(din, "items", [makeGeometryItem(makeParityGeometry(10))]);
    const sa = inner.add(setAttribute);
    inner.setParam(sa, "name", "d");
    inner.setParam(sa, "value", fieldFromJson(SPEC));
    inner.connect(din, "out", sa, "in");
    const sub = subgraphNode(inner, [], [{ name: "out", node: sa, pin: "out" }]);
    const outer = new Graph(5);
    outer.output(outer.add(sub), "out", "out");
    const result = await cook(outer, { gpu: stubResolver("stub|x") });
    expect(result.stats.gpu).toEqual({
      dispatches: 1,
      pipelinesCompiled: 0,
      pipelineCacheHits: 0,
      residentRuns: 0,
      fusedNodes: 0,
      readbacksSaved: 0,
      fallbacks: {},
      nonFinite: { counts: {}, unchecked: {} },
    });
  });
});

describe("captureAsync (stub resolver)", () => {
  it("without a resolver it matches capture byte for byte", async () => {
    const { capture, captureAsync } = await import("../fields/index.js");
    const a = makeParityGeometry(20);
    const b = makeParityGeometry(20);
    const field = fieldFromJson(SPEC);
    const nameSync = capture(a, "point", field, 4);
    const nameAsync = await captureAsync(b, "point", field, 4);
    expect(nameAsync).toBe(nameSync);
    const attrA = a.attrs.point.require(nameSync);
    const attrB = b.attrs.point.require(nameAsync);
    expect(Array.from(attrB.data.subarray(0, 20))).toEqual(Array.from(attrA.data.subarray(0, 20)));
  });

  it("with a resolver it resolves through it and reports stats", async () => {
    const { capture, captureAsync, createGpuCookStats } = await import("../fields/index.js");
    const a = makeParityGeometry(20);
    const b = makeParityGeometry(20);
    const field = fieldFromJson(SPEC);
    const stub = stubResolver("stub|cap");
    const stats = createGpuCookStats();
    const nameSync = capture(a, "point", field, 4);
    const nameAsync = await captureAsync(b, "point", field, 4, stub, stats);
    expect(nameAsync).toBe(nameSync);
    expect(stub.calls).toBe(1);
    expect(stats.dispatches).toBe(1);
    const attrA = a.attrs.point.require(nameSync);
    const attrB = b.attrs.point.require(nameAsync);
    expect(Array.from(attrB.data.subarray(0, 20))).toEqual(Array.from(attrA.data.subarray(0, 20)));
  });
});

describe("World gpu threading (stub resolver)", () => {
  function makeWorld(worldStub: GpuFieldResolver): { world: World; sa: ReturnType<Graph["add"]> } {
    const graph = new Graph(1);
    const din = graph.add(dataInput);
    graph.setParam(din, "items", [makeGeometryItem(makeParityGeometry(16))]);
    const sa = graph.add(setAttribute);
    graph.setParam(sa, "name", "d");
    graph.setParam(sa, "value", fieldFromJson(SPEC));
    graph.connect(din, "out", sa, "in");
    graph.output(sa, "out", "out");
    const world = new World({
      seed: 42,
      levels: [
        {
          name: "base",
          cellSize: 10,
          generationRadius: 5,
          graph,
          bind: (g, ctx) => {
            g.setParam(sa, "seed", ctx.seed);
          },
        },
      ],
      gpu: worldStub,
    });
    return { world, sa };
  }

  it("WorldOptions.gpu reaches cell cooks; UpdateOptions.gpu wins per update", async () => {
    const worldStub = stubResolver("stub|world");
    const { world } = makeWorld(worldStub);
    const u1 = await world.update([5, 0, 5]);
    expect(u1.cooked.length).toBe(1);
    expect(worldStub.calls).toBeGreaterThan(0);
    const afterFirst = worldStub.calls;
    // New cell + update-level resolver: it takes over for that update.
    const updateStub = stubResolver("stub|update");
    const u2 = await world.update([15, 0, 5], { gpu: updateStub });
    expect(u2.cooked.length).toBe(1);
    expect(updateStub.calls).toBeGreaterThan(0);
    expect(worldStub.calls).toBe(afterFirst);
  });

  it("a CPU-cooked cell graph is not served to a gpu cell cook (and vice versa)", async () => {
    // Same graph node keys as the world cook: toggling the world's gpu
    // between updates changes adopting nodes' memo keys, so a recook of
    // the same cell recomputes rather than serving cross-provenance
    // bytes.
    const worldStub = stubResolver("stub|world");
    const { world } = makeWorld(worldStub);
    await world.update([5, 0, 5]);
    const before = worldStub.calls;
    world.invalidate();
    // Same cell, same params, same salt → memo cache serves; resolver
    // not consulted again.
    await world.update([5, 0, 5]);
    expect(worldStub.calls).toBe(before);
  });
});
