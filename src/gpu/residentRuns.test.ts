/**
 * Device-resident run tests (CPU-only, run everywhere): maximal-run
 * detection with every boundary rule, the fused-run cache contract
 * (terminal-only entries, interior-edit surgery, split-on-output,
 * gpu-off isolation, salt provenance), stats/onNodeDone semantics, and
 * clean degradation for v0.5-style resolvers without run methods. Two
 * fakes drive the executor: a recording resolver whose planRun always
 * rejects (pinning detection and the per-node fallback), and a
 * CPU-backed resolver whose executeRun cooks the members' own execute
 * functions sequentially — byte-identical to the per-node path by
 * construction, so cache behavior is observable without a device. The
 * real-device equivalents live in resident.device.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  makeField,
  randomField,
  type GpuCookStats,
  type GpuFieldResolver,
  type ResidentMemberDesc,
  type ResidentRunContext,
} from "../fields/index.js";
import {
  CookCancelledError,
  Graph,
  NodeExecutionError,
  cook,
  makeGeometryItem,
  subgraphNode,
  type DataItem,
  type NodeDoneInfo,
} from "../graph/index.js";
import {
  getNodeType,
  jitterPoints,
  mergePoints,
  orientAlongVector,
  setAttribute,
  setBounds,
  transformPoints,
} from "../nodes/index.js";
import { acceptsDerivedSpecs } from "../fields/spec.js";
import { fieldFromJson } from "../fields/fieldJson.js";
import { dataInput } from "../runtime/index.js";
import { World } from "../runtime/world.js";
import type { Geometry } from "../data/index.js";
import { makeCorpusGeometry } from "./testGeometry.js";
// `cpuResolveField` is the eligibility gate both fakes share (and the
// other gpu suites' doubles with them): `accept` is the flag the fake
// advertises, read through the production predicate, so a fake can never
// resolve a field the executor did not salt.
import { cpuResolveField } from "./testHelpers.js";
import { planResidentRun } from "./run.js";

function countFallback(stats: GpuCookStats | undefined, reason: string): null {
  if (stats !== undefined) stats.fallbacks[reason] = (stats.fallbacks[reason] ?? 0) + 1;
  return null;
}

interface FakeResolver extends GpuFieldResolver {
  /** Member id lists planRun received, in call order. */
  planned: string[][];
  /**
   * Member id lists executeRun actually ran, in call order. Distinct from
   * `planned` since the suffix retry: planning a member list no longer
   * implies running it, and "which members really fused" is the question
   * the identity-after-P-write hazard turns on.
   */
  executed: string[][];
  executeRuns: number;
}

/** planRun always rejects (run-plan-failed): pins detection + fallback. */
function recordingResolver(salt: string, opts: { acceptDerivedSpecs?: boolean } = {}): FakeResolver {
  const accept = acceptsDerivedSpecs(opts);
  const fake: FakeResolver = {
    planned: [],
    executed: [],
    executeRuns: 0,
    cacheSalt: salt,
    acceptDerivedSpecs: accept,
    resolveField: (field, ctx, stats) => cpuResolveField(field, ctx, stats, accept),
    planRun(members, _ctx, stats) {
      fake.planned.push(members.map((m) => m.id));
      return countFallback(stats, "run-plan-failed");
    },
    executeRun() {
      throw new Error("recordingResolver.executeRun must never be called (planRun rejects)");
    },
  };
  return fake;
}

/**
 * Fully functional fake: executeRun cooks the members' own CPU execute
 * functions sequentially (looked up in the registry by type), so fused
 * output bytes are the per-node CPU bytes by construction and cache
 * semantics are observable without a device.
 */
function cpuRunResolver(
  salt: string,
  opts: {
    acceptDerivedSpecs?: boolean;
    /**
     * Planning verdict for a candidate member list: a fallback reason to
     * reject with, or null to accept. Absent means "accept everything",
     * which is what every test written before the suffix retry existed
     * wants. {@link plannerReject} plugs the REAL planner in here.
     */
    reject?: (members: readonly ResidentMemberDesc[], ctx: ResidentRunContext) => string | null;
  } = {},
): FakeResolver {
  const accept = acceptsDerivedSpecs(opts);
  const fake: FakeResolver = {
    planned: [],
    executed: [],
    executeRuns: 0,
    cacheSalt: salt,
    acceptDerivedSpecs: accept,
    resolveField: (field, ctx, stats) => cpuResolveField(field, ctx, stats, accept),
    planRun(members, ctx, stats) {
      fake.planned.push(members.map((m) => m.id));
      const reason = opts.reject?.(members, ctx) ?? null;
      if (reason !== null) return countFallback(stats, reason);
      return { members: [...members] };
    },
    async executeRun(plan, input, stats) {
      fake.executeRuns++;
      const members = (plan as { members: readonly ResidentMemberDesc[] }).members;
      fake.executed.push(members.map((m) => m.id));
      let item: DataItem = makeGeometryItem(input.geo);
      for (const m of members) {
        if (input.signal?.aborted) throw new CookCancelledError();
        const def = getNodeType(m.type).def;
        const outputs = await def.execute({
          inputs: { in: [item] },
          params: m.params as Record<string, unknown>,
          seed: m.seed,
          signal: input.signal,
          budgetMs: input.budgetMs,
          checkCancelled() {
            if (input.signal?.aborted) throw new CookCancelledError();
          },
        });
        item = outputs.out[0];
      }
      if (item.kind !== "geometry") throw new Error("fake executeRun: expected geometry");
      if (stats !== undefined) {
        stats.residentRuns++;
        stats.fusedNodes += members.length;
        stats.readbacksSaved += members.length - 1;
      }
      return { geo: item.geo };
    },
  };
  return fake;
}

// Handle types are inferred from the node defs rather than annotated:
// widening them to `ReturnType<Graph["add"]>` erases each node's param
// type, which makes `setParam`'s key parameter `never` at call sites.

/**
 * dataInput → setAttribute("d", randomField spec) → jitterPoints(plain
 * amount) → transformPoints(translate = attribute("d"), exercising a
 * field that reads an attribute an earlier member wrote) →
 * orientAlongVector(direction = position) → output "out".
 */
function buildChain(geo: Geometry) {
  const g = new Graph(7);
  const din = g.add(dataInput);
  g.setParam(din, "items", [makeGeometryItem(geo)]);
  const sa = g.add(setAttribute);
  g.setParam(sa, "name", "d");
  g.setParam(sa, "value", fieldFromJson({ fn: "randomField", key: "k" }));
  const jit = g.add(jitterPoints);
  g.setParam(jit, "amount", [0.2, 0.2, 0.2]);
  const tr = g.add(transformPoints);
  g.setParam(tr, "translate", fieldFromJson({ fn: "attribute", name: "d" }));
  const or = g.add(orientAlongVector);
  g.setParam(or, "direction", fieldFromJson({ fn: "position" }));
  g.connect(din, "out", sa, "in");
  g.connect(sa, "out", jit, "in");
  g.connect(jit, "out", tr, "in");
  g.connect(tr, "out", or, "in");
  g.output(or, "out", "out");
  return { g, ids: { din, sa, jit, tr, or } };
}

function outBytes(result: Awaited<ReturnType<typeof cook>>, attr: string, output = "out"): Uint8Array {
  const item = result.outputs[output][0];
  if (item.kind !== "geometry") throw new Error("expected geometry");
  const a = item.geo.attrs.point.require(attr);
  const n = item.geo.attrs.point.count * a.tupleSize;
  return new Uint8Array(a.data.buffer, a.data.byteOffset, n * a.data.BYTES_PER_ELEMENT).slice();
}

const nodeCache = (g: Graph, id: ReturnType<Graph["add"]>) => g._nodes.get(id.id)?.cache;

describe("resident run detection (recording resolver)", () => {
  it("fuses a maximal chain into one run and serves per-node bytes on plan rejection", async () => {
    const { g, ids } = buildChain(makeCorpusGeometry(40));
    const cpu = await cook(buildChain(makeCorpusGeometry(40)).g);
    const rec = recordingResolver("fake|A");
    const r = await cook(g, { gpu: rec });
    // The maximal chain first, then the suffix retry narrowing it one
    // member at a time — this resolver rejects every plan, so the search
    // runs to its end. It stops at [tr, or]: the next suffix would be the
    // lone chain node `or`, which is not a run.
    expect(rec.planned).toEqual([
      [ids.sa.id, ids.jit.id, ids.tr.id, ids.or.id],
      [ids.jit.id, ids.tr.id, ids.or.id],
      [ids.tr.id, ids.or.id],
    ]);
    // ...and the three rejections are ONE fallback: the counter says
    // "this chain fused nothing", which is what it has always said.
    expect(r.stats.gpu!.fallbacks).toEqual({ "run-plan-failed": 1 });
    expect(r.stats.gpu!.residentRuns).toBe(0);
    expect(r.stats.cooked).toBe(5); // per-node fallback cooks every node
    for (const attr of ["P", "rot", "d"]) {
      expect(outBytes(r, attr)).toEqual(outBytes(cpu, attr));
    }
    // The fallback caches per-node keys: a repeat cook re-plans (the
    // terminal holds a per-node key, not a run key) and then serves
    // every member from its per-node cache.
    const r2 = await cook(g, { gpu: rec });
    expect(rec.planned.length).toBe(6);
    expect(r2.stats.cooked).toBe(0);
    expect(r2.stats.cached).toBe(5);
  });

  it("a declared output on an interior member splits the run", async () => {
    const { g, ids } = buildChain(makeCorpusGeometry(20));
    g.output(ids.jit, "out", "tap");
    const rec = recordingResolver("fake|A");
    await cook(g, { gpu: rec });
    expect(rec.planned).toEqual([
      [ids.sa.id, ids.jit.id],
      [ids.tr.id, ids.or.id],
    ]);
  });

  it("a multi-consumer tap splits the run", async () => {
    const { g, ids } = buildChain(makeCorpusGeometry(20));
    const tap = g.add(setBounds);
    g.connect(ids.jit, "out", tap, "in");
    g.output(tap, "out", "bounds");
    const rec = recordingResolver("fake|A");
    await cook(g, { gpu: rec });
    expect(rec.planned).toEqual([
      [ids.sa.id, ids.jit.id],
      [ids.tr.id, ids.or.id],
    ]);
  });

  it("a non-fusable interior node bounds runs on both sides", async () => {
    const geo = makeCorpusGeometry(20);
    const g = new Graph(7);
    const din = g.add(dataInput);
    g.setParam(din, "items", [makeGeometryItem(geo)]);
    const sa = g.add(setAttribute, { name: "d", value: fieldFromJson({ fn: "randomField", key: "k" }) });
    const jit = g.add(jitterPoints, { amount: [0.1, 0.1, 0.1] });
    const sb = g.add(setBounds); // no resident descriptor
    const tr = g.add(transformPoints, { translate: [1, 0, 0] });
    const or = g.add(orientAlongVector, { direction: fieldFromJson({ fn: "position" }) });
    g.connect(din, "out", sa, "in");
    g.connect(sa, "out", jit, "in");
    g.connect(jit, "out", sb, "in");
    g.connect(sb, "out", tr, "in");
    g.connect(tr, "out", or, "in");
    g.output(or, "out", "out");
    const rec = recordingResolver("fake|A");
    await cook(g, { gpu: rec });
    expect(rec.planned).toEqual([
      [sa.id, jit.id],
      [tr.id, or.id],
    ]);
  });

  it("a code-authored Field param excludes the member (and short runs stay per-node)", async () => {
    const { g, ids } = buildChain(makeCorpusGeometry(20));
    g.setParam(ids.jit, "amount", randomField("authored")); // code-authored: derived spec
    const rec = recordingResolver("fake|A");
    const r = await cook(g, { gpu: rec });
    // sa alone is not a run; jit is excluded; [tr, or] remains.
    expect(rec.planned).toEqual([[ids.tr.id, ids.or.id]]);
    expect(r.stats.gpu!.fallbacks["derived-spec"]).toBe(1); // jit's per-node resolve fell back
    expect(r.stats.gpu!.fallbacks["no-spec"]).toBeUndefined(); // ...as "derived", not "no-spec"
  });

  it("a spec-less Field param excludes the member and still counts no-spec", async () => {
    // The compensating negative for the relabel above: `derived-spec` is a
    // NEW population, not a rename of `no-spec`. A `makeField` closure can
    // never be compiled on any setting of the flag, so it must keep
    // breaking the run and keep counting the original reason — otherwise
    // a regression collapsing the two words would go unnoticed here.
    const { g, ids } = buildChain(makeCorpusGeometry(20));
    g.setParam(ids.jit, "amount", makeField("opaque", 3, () => ({ data: new Float32Array(60), tupleSize: 3 })));
    const rec = recordingResolver("fake|A");
    const r = await cook(g, { gpu: rec });
    expect(rec.planned).toEqual([[ids.tr.id, ids.or.id]]);
    expect(r.stats.gpu!.fallbacks["no-spec"]).toBe(1);
    expect(r.stats.gpu!.fallbacks["derived-spec"]).toBeUndefined();

    // ...and not even the wide gate admits it: `acceptDerivedSpecs`
    // widens the population that HAS a spec, it does not invent one.
    const { g: g2, ids: ids2 } = buildChain(makeCorpusGeometry(20));
    g2.setParam(ids2.jit, "amount", makeField("opaque", 3, () => ({ data: new Float32Array(60), tupleSize: 3 })));
    const wide = recordingResolver("fake|A", { acceptDerivedSpecs: true });
    const r2 = await cook(g2, { gpu: wide });
    expect(wide.planned).toEqual([[ids2.tr.id, ids2.or.id]]);
    expect(r2.stats.gpu!.fallbacks["no-spec"]).toBe(1);
  });

  it("acceptDerivedSpecs admits that same member to the run", async () => {
    // The fusion gate reads the same flag as the per-field seam: widen
    // one and the member joins the chain instead of breaking it.
    const { g, ids } = buildChain(makeCorpusGeometry(20));
    g.setParam(ids.jit, "amount", randomField("authored"));
    const rec = recordingResolver("fake|A", { acceptDerivedSpecs: true });
    const r = await cook(g, { gpu: rec });
    // The detected run is the first attempt; the rest is this resolver's
    // blanket rejection walking the suffix retry down (see above).
    expect(rec.planned[0]).toEqual([ids.sa.id, ids.jit.id, ids.tr.id, ids.or.id]);
    expect(r.stats.gpu!.fallbacks["derived-spec"]).toBeUndefined();
  });

  it("string-mode and non-point-domain setAttribute never fuse", async () => {
    const geo = makeCorpusGeometry(20);
    const g = new Graph(7);
    const din = g.add(dataInput);
    g.setParam(din, "items", [makeGeometryItem(geo)]);
    const saStr = g.add(setAttribute, { name: "s", type: "string", values: ["a", "b"], value: 0 });
    const saDet = g.add(setAttribute, { name: "meta", domain: "detail", value: 1 });
    const sa = g.add(setAttribute, { name: "d", value: 2 });
    const jit = g.add(jitterPoints, { amount: [0.1, 0.1, 0.1] });
    g.connect(din, "out", saStr, "in");
    g.connect(saStr, "out", saDet, "in");
    g.connect(saDet, "out", sa, "in");
    g.connect(sa, "out", jit, "in");
    g.output(jit, "out", "out");
    const rec = recordingResolver("fake|A");
    await cook(g, { gpu: rec });
    expect(rec.planned).toEqual([[sa.id, jit.id]]);
  });

  it("a fan-out/rejoin diamond never fuses across the split", async () => {
    // din → sa → {jit, tr} → mergePoints → or: `sa` has two consumers,
    // so no run may contain it, and the rejoin node is not fusable.
    const build = (): { g: Graph; ids: Record<string, string> } => {
      const g = new Graph(7);
      const din = g.add(dataInput);
      g.setParam(din, "items", [makeGeometryItem(makeCorpusGeometry(40))]);
      const sa = g.add(setAttribute, { name: "d", value: fieldFromJson({ fn: "randomField", key: "k" }) });
      const jit = g.add(jitterPoints, { amount: [0.2, 0.2, 0.2] });
      const tr = g.add(transformPoints, { translate: [1, 0, 0] });
      const mg = g.add(mergePoints);
      const or = g.add(orientAlongVector, { direction: fieldFromJson({ fn: "position" }) });
      g.connect(din, "out", sa, "in");
      g.connect(sa, "out", jit, "in");
      g.connect(sa, "out", tr, "in");
      g.connect(jit, "out", mg, "in");
      g.connect(tr, "out", mg, "in");
      g.connect(mg, "out", or, "in");
      g.output(or, "out", "out");
      return { g, ids: { sa: sa.id } };
    };
    const cpu = await cook(build().g);
    const { g, ids } = build();
    const fake = cpuRunResolver("fake|A");
    const r = await cook(g, { gpu: fake });
    for (const planned of fake.planned) expect(planned).not.toContain(ids.sa);
    for (const attr of ["P", "rot", "d"]) {
      expect(outBytes(r, attr)).toEqual(outBytes(cpu, attr));
    }
  });

  it("a consumer outside this cook's selection ends the run at the selected tail", async () => {
    const build = (): { g: Graph; ids: Record<string, string> } => {
      const g = new Graph(7);
      const din = g.add(dataInput);
      g.setParam(din, "items", [makeGeometryItem(makeCorpusGeometry(40))]);
      const sa = g.add(setAttribute, { name: "d", value: fieldFromJson({ fn: "randomField", key: "k" }) });
      const jit = g.add(jitterPoints, { amount: [0.2, 0.2, 0.2] });
      const tr = g.add(transformPoints, { translate: [1, 0, 0] });
      const or = g.add(orientAlongVector, { direction: fieldFromJson({ fn: "position" }) });
      g.connect(din, "out", sa, "in");
      g.connect(sa, "out", jit, "in");
      g.connect(jit, "out", tr, "in");
      g.connect(tr, "out", or, "in");
      g.output(tr, "out", "mid");
      g.output(or, "out", "out");
      return { g, ids: { sa: sa.id, jit: jit.id, tr: tr.id } };
    };
    // Cooking only "mid" leaves `or` out of the order: the run stops at
    // `tr` rather than walking into an unvisited consumer.
    const cpu = await cook(build().g, { outputs: ["mid"] });
    const { g, ids } = build();
    const fake = cpuRunResolver("fake|A");
    const r = await cook(g, { gpu: fake, outputs: ["mid"] });
    expect(fake.planned).toEqual([[ids.sa, ids.jit, ids.tr]]);
    for (const attr of ["P", "d"]) {
      expect(outBytes(r, attr, "mid")).toEqual(outBytes(cpu, attr, "mid"));
    }
  });

  it("a single fusable node never plans a run", async () => {
    const geo = makeCorpusGeometry(20);
    const g = new Graph(7);
    const din = g.add(dataInput);
    g.setParam(din, "items", [makeGeometryItem(geo)]);
    const sa = g.add(setAttribute, { name: "d", value: fieldFromJson({ fn: "randomField", key: "k" }) });
    g.connect(din, "out", sa, "in");
    g.output(sa, "out", "out");
    const rec = recordingResolver("fake|A");
    const r = await cook(g, { gpu: rec });
    expect(rec.planned).toEqual([]);
    expect(r.stats.gpu!.dispatches).toBe(1); // the ordinary per-node resolve
  });

  it("an empty input geometry skips planning and cooks per-node", async () => {
    const { g } = buildChain(makeCorpusGeometry(0));
    const rec = recordingResolver("fake|A");
    const r = await cook(g, { gpu: rec });
    expect(rec.planned).toEqual([]);
    expect(r.stats.cooked).toBe(5);
  });

  it("a missing geometry input surfaces the identical per-node CPU error", async () => {
    const build = (): Graph => {
      const g = new Graph(7);
      const sa = g.add(setAttribute, { name: "d", value: fieldFromJson({ fn: "randomField", key: "k" }) });
      const jit = g.add(jitterPoints, { amount: [0.1, 0.1, 0.1] });
      g.connect(sa, "out", jit, "in");
      g.output(jit, "out", "out");
      return g;
    };
    const cpuErr = await cook(build()).then(
      () => undefined,
      (err: unknown) => err,
    );
    const gpuErr = await cook(build(), { gpu: cpuRunResolver("fake|A") }).then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(cpuErr).toBeInstanceOf(NodeExecutionError);
    expect(gpuErr).toBeInstanceOf(NodeExecutionError);
    expect((gpuErr as Error).message).toBe((cpuErr as Error).message);
    expect((cpuErr as Error).message).toContain('input pin "in" has no geometry connected');
  });

  it("several geometries on the head input skip fusion and raise the CPU error", async () => {
    // Fusion reads the head's first item and drops the rest before any
    // member execute runs, so without the decline this cook would throw
    // on the CPU and silently truncate to one group on the GPU.
    const build = (): Graph => {
      const g = new Graph(7);
      const din = g.add(dataInput);
      g.setParam(
        din,
        "items",
        [0, 1, 2, 3].map(() => makeGeometryItem(makeCorpusGeometry(4))),
      );
      const sa = g.add(setAttribute, { name: "d", value: fieldFromJson({ fn: "randomField", key: "k" }) });
      const jit = g.add(jitterPoints, { amount: [0.1, 0.1, 0.1] });
      g.connect(din, "out", sa, "in");
      g.connect(sa, "out", jit, "in");
      g.output(jit, "out", "out");
      return g;
    };
    const cpuErr = await cook(build()).then(
      () => undefined,
      (err: unknown) => err,
    );
    const rec = cpuRunResolver("fake|A");
    const gpuErr = await cook(build(), { gpu: rec }).then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(cpuErr).toBeInstanceOf(NodeExecutionError);
    expect(gpuErr).toBeInstanceOf(NodeExecutionError);
    // No divergence: same error, and fusion was never planned.
    expect((gpuErr as Error).message).toBe((cpuErr as Error).message);
    expect((cpuErr as Error).message).toContain("received 4 geometries");
    expect(rec.planned).toEqual([]);
  });

  it("a v0.5-style resolver without run methods degrades to per-node behavior", async () => {
    const { g } = buildChain(makeCorpusGeometry(30));
    const cpu = await cook(buildChain(makeCorpusGeometry(30)).g);
    const runless: GpuFieldResolver = {
      cacheSalt: "fake|A",
      resolveField: (field, ctx, stats) => cpuResolveField(field, ctx, stats, false),
    };
    const r = await cook(g, { gpu: runless });
    expect(r.stats.cooked).toBe(5);
    expect(r.stats.gpu!.residentRuns).toBe(0);
    expect(r.stats.gpu!.dispatches).toBe(3); // sa value, tr translate, or direction
    for (const attr of ["P", "rot", "d"]) {
      expect(outBytes(r, attr)).toEqual(outBytes(cpu, attr));
    }
  });
});

describe("resident run cache contract (CPU-backed run resolver)", () => {
  it("executes fused, caches at the terminal only, and serves repeat cooks", async () => {
    const { g, ids } = buildChain(makeCorpusGeometry(40));
    const cpu = await cook(buildChain(makeCorpusGeometry(40)).g);
    const fake = cpuRunResolver("fake|A");

    const done: NodeDoneInfo[] = [];
    const r1 = await cook(g, { gpu: fake, onNodeDone: (info) => done.push(info) });
    expect(fake.planned).toEqual([[ids.sa.id, ids.jit.id, ids.tr.id, ids.or.id]]);
    expect(fake.executeRuns).toBe(1);
    expect(r1.stats.cooked).toBe(5);
    expect(r1.stats.cached).toBe(0);
    expect(r1.stats.gpu!.residentRuns).toBe(1);
    expect(r1.stats.gpu!.fusedNodes).toBe(4);
    expect(r1.stats.gpu!.readbacksSaved).toBe(3);
    for (const attr of ["P", "rot", "d"]) {
      expect(outBytes(r1, attr)).toEqual(outBytes(cpu, attr));
    }
    // onNodeDone: every member once, chain order, after the dataInput.
    expect(done.map((d) => d.id)).toEqual([ids.din.id, ids.sa.id, ids.jit.id, ids.tr.id, ids.or.id]);
    expect(done.every((d) => !d.cached)).toBe(true);

    // Terminal-only caching: interiors hold no entries; the terminal's
    // key is a run key.
    expect(nodeCache(g, ids.sa)).toBeUndefined();
    expect(nodeCache(g, ids.jit)).toBeUndefined();
    expect(nodeCache(g, ids.tr)).toBeUndefined();
    expect(nodeCache(g, ids.or)?.key).toMatch(/^run1\|gpu:fake\|A\|/);

    // Repeat cook: the whole run (and the input) serve from cache; no
    // device work, so the resident counters stay zero.
    const done2: NodeDoneInfo[] = [];
    const r2 = await cook(g, { gpu: fake, onNodeDone: (info) => done2.push(info) });
    expect(fake.executeRuns).toBe(1);
    expect(r2.stats.cooked).toBe(0);
    expect(r2.stats.cached).toBe(5);
    expect(r2.stats.gpu!.residentRuns).toBe(0);
    expect(done2.every((d) => d.cached)).toBe(true);
  });

  it("interior members hold no entry even when an earlier per-node cook left one", async () => {
    const { g, ids } = buildChain(makeCorpusGeometry(40));
    await cook(g); // CPU-only first: every member gains a per-node entry
    expect(nodeCache(g, ids.sa)).toBeDefined();
    expect(nodeCache(g, ids.jit)).toBeDefined();
    expect(nodeCache(g, ids.tr)).toBeDefined();

    const fake = cpuRunResolver("fake|A");
    await cook(g, { gpu: fake });
    // Terminal-only caching is absolute, not just true for fresh graphs:
    // stale per-node entries on interior members are dropped when the
    // run fuses (they are unreachable while fused and would otherwise
    // retain a full geometry each).
    expect(nodeCache(g, ids.sa)).toBeUndefined();
    expect(nodeCache(g, ids.jit)).toBeUndefined();
    expect(nodeCache(g, ids.tr)).toBeUndefined();
    expect(nodeCache(g, ids.or)?.key).toMatch(/^run1\|gpu:fake\|A\|/);

    // ...and again when the run is served from the terminal's cache.
    await cook(g);
    expect(nodeCache(g, ids.sa)).toBeDefined();
    await cook(g, { gpu: fake });
    await cook(g, { gpu: fake });
    expect(nodeCache(g, ids.sa)).toBeUndefined();
  });

  it("an interior param edit recooks exactly the run; siblings and upstream stay cached", async () => {
    const { g, ids } = buildChain(makeCorpusGeometry(40));
    const sibling = g.add(setBounds);
    g.connect(ids.din, "out", sibling, "in");
    g.output(sibling, "out", "bounds");
    const fake = cpuRunResolver("fake|A");
    await cook(g, { gpu: fake });
    const before = await cook(g, { gpu: fake });
    expect(before.stats.cached).toBe(6);

    g.setParam(ids.jit, "seed", 99); // interior edit
    const r = await cook(g, { gpu: fake });
    expect(r.stats.cooked).toBe(4); // exactly the run's members
    expect(r.stats.cached).toBe(2); // dataInput + sibling branch
    expect(r.stats.gpu!.residentRuns).toBe(1);
    expect(fake.executeRuns).toBe(2);
  });

  it("declaring an interior output splits the run with downstream bytes unchanged", async () => {
    const { g, ids } = buildChain(makeCorpusGeometry(40));
    const fake = cpuRunResolver("fake|A");
    const r1 = await cook(g, { gpu: fake });
    const terminalBytes = ["P", "rot", "d"].map((a) => outBytes(r1, a));

    g.output(ids.jit, "out", "tap");
    const r2 = await cook(g, { gpu: fake });
    // Two runs now: [sa, jit] and [tr, or]; both recook (new keys).
    expect(fake.planned).toEqual([
      [ids.sa.id, ids.jit.id, ids.tr.id, ids.or.id],
      [ids.sa.id, ids.jit.id],
      [ids.tr.id, ids.or.id],
    ]);
    expect(r2.stats.cooked).toBe(4);
    expect(r2.stats.gpu!.residentRuns).toBe(2);
    expect(r2.stats.gpu!.readbacksSaved).toBe(2);
    ["P", "rot", "d"].forEach((a, i) => expect(outBytes(r2, a)).toEqual(terminalBytes[i]));
    // The tap materializes the previous interior value (CPU reference).
    const cpu = await cook(
      (() => {
        const twin = buildChain(makeCorpusGeometry(40));
        twin.g.output(twin.ids.jit, "out", "tap");
        return twin.g;
      })(),
    );
    for (const attr of ["P", "d"]) {
      expect(outBytes(r2, attr, "tap")).toEqual(outBytes(cpu, attr, "tap"));
    }
  });

  it("gpu-off cooks never serve run entries, and the toggle round-trips", async () => {
    const { g, ids } = buildChain(makeCorpusGeometry(40));
    const fake = cpuRunResolver("fake|A");
    const r1 = await cook(g, { gpu: fake });
    const bytes = outBytes(r1, "P");

    const off = await cook(g);
    expect(off.stats.cooked).toBe(4); // the four members; dataInput stays cached
    expect(outBytes(off, "P")).toEqual(bytes);
    expect(nodeCache(g, ids.or)?.key.startsWith("run1|")).toBe(false);

    const on = await cook(g, { gpu: fake });
    expect(on.stats.cooked).toBe(4); // run recooks; per-node entries don't match run keys
    expect(on.stats.gpu!.residentRuns).toBe(1);
    expect(outBytes(on, "P")).toEqual(bytes);
  });

  it("run keys carry the resolver salt", async () => {
    const { g } = buildChain(makeCorpusGeometry(30));
    await cook(g, { gpu: cpuRunResolver("fake|A") });
    const b = await cook(g, { gpu: cpuRunResolver("fake|B") });
    expect(b.stats.cooked).toBe(4); // different device: never serve A's bytes
    const a2Resolver = cpuRunResolver("fake|A");
    const a2 = await cook(g, { gpu: a2Resolver });
    expect(a2.stats.cooked).toBe(4); // single cache slot now holds B's run
    const a3 = await cook(g, { gpu: cpuRunResolver("fake|A") });
    expect(a3.stats.cooked).toBe(0); // same salt: served, resolver identity irrelevant
  });

  it("cancellation from executeRun propagates as the standard cancellation error", async () => {
    const { g } = buildChain(makeCorpusGeometry(30));
    let reads = 0;
    const signal = {
      get aborted(): boolean {
        return ++reads > 2; // pass the pre-run checks, abort mid-run
      },
    } as unknown as AbortSignal;
    await expect(cook(g, { gpu: cpuRunResolver("fake|A"), signal })).rejects.toBeInstanceOf(
      CookCancelledError,
    );
  });

  it("a non-cancellation executeRun failure is an error naming the terminal", async () => {
    const { g, ids } = buildChain(makeCorpusGeometry(30));
    const fake = cpuRunResolver("fake|A");
    fake.executeRun = () => Promise.reject(new Error("device lost"));
    const err = await cook(g, { gpu: fake }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NodeExecutionError);
    expect((err as Error).message).toContain(ids.or.id);
    expect((err as Error).message).toContain("device lost");
  });

  it("fuses inside subgraph cooks with counters routed to the outermost sink", async () => {
    const geo = makeCorpusGeometry(25);
    const inner = new Graph(3);
    const din = inner.add(dataInput);
    inner.setParam(din, "items", [makeGeometryItem(geo)]);
    const sa = inner.add(setAttribute, { name: "d", value: fieldFromJson({ fn: "randomField", key: "k" }) });
    const jit = inner.add(jitterPoints, { amount: [0.3, 0.3, 0.3] });
    inner.connect(din, "out", sa, "in");
    inner.connect(sa, "out", jit, "in");
    const sub = subgraphNode(inner, [], [{ name: "out", node: jit, pin: "out" }]);
    const outer = new Graph(11);
    outer.output(outer.add(sub), "out", "out");

    const cpu = await cook(outer);
    const cpuBytes = outBytes(cpu, "P");
    const fake = cpuRunResolver("fake|A");
    const r = await cook(outer, { gpu: fake });
    expect(fake.planned).toEqual([[sa.id, jit.id]]);
    expect(r.stats.gpu!.residentRuns).toBe(1); // inner run counted in the outer sink
    expect(r.stats.gpu!.fusedNodes).toBe(2);
    expect(outBytes(r, "P")).toEqual(cpuBytes);
  });

  it("World cell cooks fuse and match the CPU-only World byte-for-byte", async () => {
    const makeWorld = (gpu?: GpuFieldResolver): { world: World; bytes: Uint8Array[] } => {
      const graph = new Graph(5);
      const din = graph.add(dataInput);
      graph.setParam(din, "items", [makeGeometryItem(makeCorpusGeometry(30))]);
      const sa = graph.add(setAttribute, { name: "d", value: fieldFromJson({ fn: "randomField", key: "w" }) });
      const jit = graph.add(jitterPoints, { amount: [0.2, 0.2, 0.2] });
      graph.connect(din, "out", sa, "in");
      graph.connect(sa, "out", jit, "in");
      graph.output(jit, "out", "out");
      const bytes: Uint8Array[] = [];
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
        ...(gpu !== undefined ? { gpu } : {}),
        onCellReady: (_level, _coord, outputs) => {
          const item = outputs.out[0];
          if (item.kind !== "geometry") throw new Error("expected geometry");
          const attr = item.geo.attrs.point.require("P");
          bytes.push(
            new Uint8Array(attr.data.buffer, attr.data.byteOffset, attr.data.byteLength).slice(),
          );
        },
      });
      return { world, bytes };
    };
    const cpu = makeWorld();
    await cpu.world.update([5, 0, 5]);
    const fake = cpuRunResolver("fake|A");
    const dev = makeWorld(fake);
    await dev.world.update([5, 0, 5]);
    expect(fake.executeRuns).toBeGreaterThan(0);
    expect(dev.bytes.length).toBe(cpu.bytes.length);
    expect(dev.bytes).toEqual(cpu.bytes);
  });
});

/**
 * The REAL planner's accept/reject verdict, so the suffix-retry tests
 * exercise the production rule — "a run may rewrite P, or key on
 * identity, but not in that order" — instead of a hand-written stand-in
 * that could drift from it. Execution still happens on the CPU through
 * the members' own `execute`, which is what makes the byte comparisons
 * below a DIFFERENTIAL (fused vs per-node, same machine, same math)
 * rather than a device measurement; the device half lives in
 * resident.device.test.ts.
 */
const plannerReject =
  (maxBytes = Number.MAX_SAFE_INTEGER) =>
  (members: readonly ResidentMemberDesc[], ctx: ResidentRunContext): string | null => {
    const outcome = planResidentRun(members, ctx, maxBytes, false);
    return "plan" in outcome ? null : outcome.reason;
  };

const NOISE = (seed: number): object => ({
  fn: "perlinNoise",
  opts: { seed, frequency: 0.35, normalized: true },
});
const VEC3 = (s: object): object => ({ fn: "vec", args: [s, s, s] });

/**
 * The shipped gpu-fields chain in its authored order: setAttribute
 * ("wobble", noise) → jitterPoints(amount = attribute("wobble")) →
 * transformPoints(constants) → setAttribute("tint", identity-keyed) →
 * setAttribute("psize", identity-keyed). Two members rewrite P and the
 * two behind them hash it, which is the exact shape the planner declines.
 */
function buildDemoChain(geo: Geometry, reordered = false) {
  const g = new Graph(9);
  const din = g.add(dataInput);
  g.setParam(din, "items", [makeGeometryItem(geo)]);
  const wobble = g.add(setAttribute, {
    name: "wobble",
    type: "f32",
    tupleSize: 3,
    value: fieldFromJson(VEC3(NOISE(1)) as never),
  });
  const jit = g.add(jitterPoints, { amount: fieldFromJson({ fn: "attribute", name: "wobble" }), seed: 7 });
  const xform = g.add(transformPoints, {
    translate: [0, 0, 0],
    rotateEuler: [0, 14, 0],
    scale: [1, 0.92, 1],
  });
  const tint = g.add(setAttribute, {
    name: "tint",
    type: "f32",
    tupleSize: 3,
    value: fieldFromJson(VEC3({ fn: "randomField", key: "t" }) as never),
  });
  const psize = g.add(setAttribute, {
    name: "psize",
    type: "f32",
    tupleSize: 1,
    value: fieldFromJson({ fn: "randomField", key: "s" }),
  });
  // The authoring fix the planner may never apply on the author's behalf:
  // identity-keyed members AHEAD of the P writers, which plans in full.
  const order = reordered ? [wobble, tint, psize, jit, xform] : [wobble, jit, xform, tint, psize];
  g.connect(din, "out", order[0], "in");
  for (let i = 1; i < order.length; i++) g.connect(order[i - 1], "out", order[i], "in");
  g.output(order[order.length - 1], "out", "out");
  return { g, ids: { din, wobble, jit, xform, tint, psize }, order: order.map((n) => n.id) };
}

describe("suffix retry: a rejected member costs its prefix, not the whole run", () => {
  it("recovers the gpu-fields tail instead of fusing nothing", async () => {
    const cpu = await cook(buildDemoChain(makeCorpusGeometry(40)).g);
    const { g, ids } = buildDemoChain(makeCorpusGeometry(40));
    const fake = cpuRunResolver("fake|R", { reject: plannerReject() });
    const r = await cook(g, { gpu: fake });

    // Narrowed three times: [jitter..] and [xform..] each still write P
    // ahead of the identity-keyed tint, which is why ONE jump to the
    // rejecting member would not have found this.
    expect(fake.planned).toEqual([
      [ids.wobble.id, ids.jit.id, ids.xform.id, ids.tint.id, ids.psize.id],
      [ids.jit.id, ids.xform.id, ids.tint.id, ids.psize.id],
      [ids.xform.id, ids.tint.id, ids.psize.id],
      [ids.tint.id, ids.psize.id],
    ]);
    // THE HAZARD CHECK: the members that actually ran on the "device" are
    // exactly the two that write no P. A retry that fused a prefix would
    // show jitterPoints or transformPoints here.
    expect(fake.executed).toEqual([[ids.tint.id, ids.psize.id]]);
    expect(r.stats.gpu!.residentRuns).toBe(1);
    expect(r.stats.gpu!.fusedNodes).toBe(2);
    expect(r.stats.gpu!.readbacksSaved).toBe(1);
    // One reason, and not the one that means "nothing fused".
    expect(r.stats.gpu!.fallbacks).toEqual({ "run-partially-fused": 1 });
    expect(r.stats.cooked).toBe(6); // dataInput + 3 per-node + 2 fused

    // The differential: partial fusion moved no output byte.
    for (const attr of ["P", "wobble", "tint", "psize"]) {
      expect(outBytes(r, attr)).toEqual(outBytes(cpu, attr));
    }
    // Terminal-only caching still holds for a narrowed run.
    expect(nodeCache(g, ids.psize)?.key).toMatch(/^run1\|gpu:fake\|R\|/);
    expect(nodeCache(g, ids.tint)).toBeUndefined();
    expect(nodeCache(g, ids.xform)?.key).toMatch(/^transformPoints\|/);
  });

  it("counts one partial fusion per cook, warm as well as cold", async () => {
    const { g } = buildDemoChain(makeCorpusGeometry(24));
    const fake = cpuRunResolver("fake|R", { reject: plannerReject() });
    await cook(g, { gpu: fake });
    const warm = await cook(g, { gpu: fake });
    // The narrowed run is served from the terminal's entry and every
    // per-node member from its own; nothing re-executes.
    expect(warm.stats.cooked).toBe(0);
    expect(warm.stats.cached).toBe(6);
    expect(fake.executeRuns).toBe(1);
    // The counter describes the GRAPH, so it reads the same warm as cold.
    expect(warm.stats.gpu!.fallbacks).toEqual({ "run-partially-fused": 1 });
  });

  it("declines rather than fuse a P writer with an identity-keyed member", async () => {
    // Two members only: the suffix is the lone `tint`, and a lone chain
    // node is not a run — so the retry gives up and NOTHING fuses. The
    // P arithmetic stays on the CPU, which is the point of the rule.
    const geo = makeCorpusGeometry(20);
    const g = new Graph(9);
    const din = g.add(dataInput);
    g.setParam(din, "items", [makeGeometryItem(geo)]);
    const xform = g.add(transformPoints, { translate: [1, 0, 0] });
    const tint = g.add(setAttribute, { name: "t", value: fieldFromJson({ fn: "randomField", key: "t" }) });
    g.connect(din, "out", xform, "in");
    g.connect(xform, "out", tint, "in");
    g.output(tint, "out", "out");
    const fake = cpuRunResolver("fake|R", { reject: plannerReject() });
    const r = await cook(g, { gpu: fake });
    expect(fake.planned).toEqual([[xform.id, tint.id]]);
    expect(fake.executed).toEqual([]);
    expect(r.stats.gpu!.residentRuns).toBe(0);
    expect(r.stats.gpu!.fallbacks).toEqual({ "run-plan-failed": 1 });
  });

  it("does NOT narrow a run the resolver merely could not fit", async () => {
    // A resolver whose memory bound happens to fit two members and not
    // four. A size rejection is not a modelling failure: narrowing from
    // the front would pick an arbitrary suffix, and `maxResidentBytes`
    // promises the per-node path serves an over-budget run whole. So the
    // chain is planned exactly once and nothing fuses.
    const geo = makeCorpusGeometry(20);
    const g = new Graph(9);
    const din = g.add(dataInput);
    g.setParam(din, "items", [makeGeometryItem(geo)]);
    const ids = ["a", "b", "c", "d"].map((name) => g.add(setAttribute, { name, value: 1 }));
    g.connect(din, "out", ids[0], "in");
    for (let i = 1; i < ids.length; i++) g.connect(ids[i - 1], "out", ids[i], "in");
    g.output(ids[ids.length - 1], "out", "out");
    const fake = cpuRunResolver("fake|R", {
      reject: (members) => (members.length > 2 ? "run-too-large" : null),
    });
    const r = await cook(g, { gpu: fake });
    expect(fake.planned.map((p) => p.length)).toEqual([4]);
    expect(fake.executed).toEqual([]);
    expect(r.stats.gpu!.residentRuns).toBe(0);
    expect(r.stats.gpu!.fallbacks).toEqual({ "run-too-large": 1 });
  });

  it("narrows for a reason it has never heard of", async () => {
    // The rule is "not a size rejection", not a list of known reasons: a
    // resolver reporting its own vocabulary still gets the retry.
    const geo = makeCorpusGeometry(20);
    const g = new Graph(9);
    const din = g.add(dataInput);
    g.setParam(din, "items", [makeGeometryItem(geo)]);
    const ids = ["a", "b", "c", "d"].map((name) => g.add(setAttribute, { name, value: 1 }));
    g.connect(din, "out", ids[0], "in");
    for (let i = 1; i < ids.length; i++) g.connect(ids[i - 1], "out", ids[i], "in");
    g.output(ids[ids.length - 1], "out", "out");
    const fake = cpuRunResolver("fake|R", {
      reject: (members) => (members.length > 2 ? "vendor-quirk" : null),
    });
    const r = await cook(g, { gpu: fake });
    expect(fake.planned.map((p) => p.length)).toEqual([4, 3, 2]);
    expect(fake.executed).toEqual([[ids[2].id, ids[3].id]]);
    expect(r.stats.gpu!.fusedNodes).toBe(2);
    expect(r.stats.gpu!.fallbacks).toEqual({ "run-partially-fused": 1 });
  });

  it("reports a subgraph's partial fusion in the OUTERMOST sink", async () => {
    // A nested cook's own sink is discarded — the resolver view drops it
    // and keeps counting into the outer one — so the retry's bookkeeping
    // has to repair the sink the counts really reach. Repair the wrong
    // one and the outer stats show a `run-plan-failed` per rejected
    // probe while `fusedNodes` says the tail fused: the exact lie the
    // accounting exists to prevent, one subgraph deep.
    const inner = buildDemoChain(makeCorpusGeometry(25)).g;
    const innerNodes = [...inner._nodes.keys()];
    const sub = subgraphNode(
      inner,
      [],
      [{ name: "out", node: { id: innerNodes[innerNodes.length - 1] }, pin: "out" }],
    );
    const outer = new Graph(11);
    outer.output(outer.add(sub), "out", "out");
    const fake = cpuRunResolver("fake|R", { reject: plannerReject() });
    const r = await cook(outer, { gpu: fake });
    expect(fake.executed).toEqual([[innerNodes[4], innerNodes[5]]]); // tint, psize
    expect(r.stats.gpu!.residentRuns).toBe(1);
    expect(r.stats.gpu!.fusedNodes).toBe(2);
    expect(r.stats.gpu!.fallbacks).toEqual({ "run-partially-fused": 1 });
  });

  it("leaves a chain that plans in full exactly as it was", async () => {
    // The reordered demo chain — the authoring fix — plans on the first
    // attempt, so the retry never runs and no fallback is reported.
    const { g, order } = buildDemoChain(makeCorpusGeometry(24), true);
    const fake = cpuRunResolver("fake|R", { reject: plannerReject() });
    const r = await cook(g, { gpu: fake });
    expect(fake.planned).toEqual([order]);
    expect(fake.executed).toEqual([order]);
    expect(r.stats.gpu!.residentRuns).toBe(1);
    expect(r.stats.gpu!.fusedNodes).toBe(5);
    expect(r.stats.gpu!.fallbacks).toEqual({});
  });
});
