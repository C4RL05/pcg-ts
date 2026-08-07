/**
 * Device-resident spawner terminals, CPU-only (runs everywhere): the
 * relaxed fusion rule and its boundaries in BOTH directions, the
 * terminal opt-in at the resolver seam, `needsGeometry`, the
 * multi-asset `assetAttr` terminal and its plan-time rejections, the
 * device-instances item (including its deliberately throwing `batches`),
 * and the memo-cache policy — device handles are delivered but never
 * memoized, so retained device bytes stay bounded across many cooks.
 *
 * A fake resolver stands in for the device: it advertises resident
 * terminals, cooks the members' own CPU execute functions, and wraps the
 * CPU-composed transforms in a fake `DeviceTransformsHandle` with the
 * same ownership semantics the real one has (idempotent dispose,
 * throwing `resource` after dispose). The real-device equivalents —
 * kernel parity, pool detach, readback skipping — live in
 * instances.device.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { Geometry } from "../data/index.js";
import type {
  DeviceInstanceBatch,
  DeviceTransformsHandle,
  GpuFieldResolver,
  ResidentMemberDesc,
  ResidentRunContext,
} from "../fields/index.js";
import {
  Graph,
  cook,
  defineNode,
  makeGeometryItem,
  type DataItem,
  type InstancesItem,
} from "../graph/index.js";
import { CookCancelledError } from "../graph/errors.js";
import { getNodeType, setAttribute, transformPoints } from "../nodes/index.js";
import { dataInput } from "../runtime/index.js";
import { buildInstanceBatches, spawnInstances } from "../spawn/index.js";
import { makeCorpusGeometry } from "./testGeometry.js";

// ---------------------------------------------------------------------------
// fakes

/** A fake device handle with the real ownership semantics. */
interface FakeHandleBook {
  /** Handles created, cumulative. */
  created: number;
  /** Handles not yet disposed. */
  live: number;
  /** Bytes not yet disposed (the "retained device bytes" the policy bounds). */
  liveBytes: number;
  /** dispose() calls, including the no-op repeats. */
  disposeCalls: number;
  /** Underlying frees; must never exceed `created`. */
  frees: number;
}

function newBook(): FakeHandleBook {
  return { created: 0, live: 0, liveBytes: 0, disposeCalls: 0, frees: 0 };
}

function fakeHandle(book: FakeHandleBook, payload: Float32Array): DeviceTransformsHandle {
  book.created++;
  book.live++;
  book.liveBytes += payload.byteLength;
  let disposed = false;
  return {
    backend: "fake",
    byteLength: payload.byteLength,
    get disposed(): boolean {
      return disposed;
    },
    get resource(): unknown {
      if (disposed) throw new Error("fake handle: disposed");
      return payload;
    },
    dispose(): void {
      book.disposeCalls++;
      if (disposed) return;
      disposed = true;
      book.frees++;
      book.live--;
      book.liveBytes -= payload.byteLength;
    },
  };
}

interface FakeResolver extends GpuFieldResolver {
  planned: string[][];
  /** `needsGeometry` of every planRun call, in order. */
  needsGeometry: boolean[];
  executeRuns: number;
  book: FakeHandleBook;
}

/**
 * Resolver that fuses for real on the CPU: members cook through their own
 * `execute`, and a `spawnInstances` terminal produces DEVICE batches
 * (CPU-composed transforms behind a fake handle), skipping the geometry
 * exactly as the device executor does when nothing reads it.
 */
function deviceInstanceResolver(terminals: readonly string[]): FakeResolver {
  const fake: FakeResolver = {
    planned: [],
    needsGeometry: [],
    executeRuns: 0,
    book: newBook(),
    cacheSalt: "fake|A",
    residentTerminals: terminals,
    resolveField: () => null,
    planRun(members, ctx: ResidentRunContext, stats) {
      fake.planned.push(members.map((m) => m.id));
      fake.needsGeometry.push(ctx.needsGeometry);
      // Unknown kinds reject, exactly like the real planner.
      const known = new Set(["setAttribute", "transformPoints", "jitterPoints", "orientAlongVector", "spawnInstances"]);
      // ...and so do the two conditions buildInstanceBatches throws on,
      // which the real planner also decides from the LAYOUT alone, so
      // the per-node path serves and raises the identical message.
      const badAssetAttr = members.some((m) => {
        if (m.kind !== "spawnInstances") return false;
        const name = m.params.assetAttr;
        if (typeof name !== "string" || name === "") return false;
        return ctx.attributes[name]?.type !== "string";
      });
      if (badAssetAttr || members.some((m) => !known.has(m.kind))) {
        if (stats !== undefined) {
          stats.fallbacks["run-plan-failed"] = (stats.fallbacks["run-plan-failed"] ?? 0) + 1;
        }
        return null;
      }
      return { members: [...members], needsGeometry: ctx.needsGeometry };
    },
    async executeRun(plan, input, stats) {
      fake.executeRuns++;
      const { members, needsGeometry } = plan as {
        members: readonly ResidentMemberDesc[];
        needsGeometry: boolean;
      };
      let item: DataItem = makeGeometryItem(input.geo);
      let deviceBatches: readonly DeviceInstanceBatch[] | undefined;
      for (const m of members) {
        if (m.kind === "spawnInstances") {
          if (item.kind !== "geometry") throw new Error("fake executeRun: expected geometry");
          const assetAttr = m.params.assetAttr;
          const batches = buildInstanceBatches(item.geo, {
            defaultAssetId: m.params.assetId as string,
            ...(typeof assetAttr === "string" && assetAttr !== "" ? { assetAttr } : {}),
          });
          deviceBatches = batches.map((b) => ({
            residency: "device" as const,
            assetId: b.assetId,
            count: b.count,
            transforms: fakeHandle(fake.book, b.transforms),
          }));
          continue;
        }
        const def = getNodeType(m.type).def;
        const outputs = await def.execute({
          inputs: { in: [item] },
          params: m.params as Record<string, unknown>,
          seed: m.seed,
          checkCancelled() {},
        });
        item = outputs.out[0];
      }
      if (item.kind !== "geometry") throw new Error("fake executeRun: expected geometry");
      if (stats !== undefined) {
        stats.residentRuns++;
        stats.fusedNodes += members.length;
        stats.readbacksSaved += members.length - (needsGeometry ? 1 : 0);
      }
      return deviceBatches === undefined
        ? { geo: item.geo }
        : needsGeometry
          ? { geo: item.geo, deviceBatches }
          : { deviceBatches };
    },
  };
  return fake;
}

// ---------------------------------------------------------------------------
// boundary node defs: every shape the relaxed rule must accept or refuse

/** terminal:true, one geometry + one non-geometry output — the admitted shape. */
const flaggedTerminal = defineNode<Record<string, never>>({
  type: "flaggedTerminal",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [
    { name: "out", kind: "geometry" },
    { name: "info", kind: "value" },
  ],
  defaultParams: {},
  execute({ inputs }) {
    return { out: [...inputs.in], info: [] };
  },
  resident: { kind: "flagged", terminal: true },
});

/** Same pins, but no `terminal` flag — must stay unfusable (today's rule). */
const unflaggedMulti = defineNode<Record<string, never>>({
  type: "unflaggedMulti",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [
    { name: "out", kind: "geometry" },
    { name: "info", kind: "value" },
  ],
  defaultParams: {},
  execute({ inputs }) {
    return { out: [...inputs.in], info: [] };
  },
  resident: { kind: "unflagged" },
});

/** terminal:true with a plain chain shape — still opt-in, no exception. */
const flaggedSingleOut = defineNode<Record<string, never>>({
  type: "flaggedSingleOut",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  defaultParams: {},
  execute({ inputs }) {
    return { out: [...inputs.in] };
  },
  resident: { kind: "flaggedSingle", terminal: true },
});

/** terminal:true but TWO geometry outputs — a run materializes one, so refuse. */
const twoGeoTerminal = defineNode<Record<string, never>>({
  type: "twoGeoTerminal",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [
    { name: "a", kind: "geometry" },
    { name: "b", kind: "geometry" },
  ],
  defaultParams: {},
  execute({ inputs }) {
    return { a: [...inputs.in], b: [...inputs.in] };
  },
  resident: { kind: "twoGeo", terminal: true },
});

/** terminal:true but a MULTI geometry input — refuse (chain shape broken). */
const multiInTerminal = defineNode<Record<string, never>>({
  type: "multiInTerminal",
  inputs: [{ name: "in", kind: "geometry", multi: true }],
  outputs: [
    { name: "out", kind: "geometry" },
    { name: "info", kind: "value" },
  ],
  defaultParams: {},
  execute({ inputs }) {
    return { out: [...inputs.in], info: [] };
  },
  resident: { kind: "multiIn", terminal: true },
});

// ---------------------------------------------------------------------------
// helpers

/** dataInput → [members...] → spawnInstances, "instances" declared. */
function spawnGraph(
  geo: Geometry,
  opts: {
    chain?: boolean;
    assetAttr?: string;
    declarePoints?: boolean;
    connectPoints?: boolean;
  } = {},
) {
  const g = new Graph(7);
  const din = g.add(dataInput);
  g.setParam(din, "items", [makeGeometryItem(geo)]);
  let tail: ReturnType<Graph["add"]> = din;
  let tailPin = "out";
  const tr = opts.chain === true ? g.add(transformPoints, { translate: [1, 2, 3] }) : undefined;
  if (tr !== undefined) {
    g.connect(tail, tailPin, tr, "in");
    tail = tr;
    tailPin = "out";
  }
  const sp = g.add(spawnInstances, {
    assetId: "tree",
    ...(opts.assetAttr !== undefined ? { assetAttr: opts.assetAttr } : {}),
  });
  g.connect(tail, tailPin, sp, "in");
  g.output(sp, "instances", "instances");
  if (opts.declarePoints === true) g.output(sp, "points", "points");
  if (opts.connectPoints === true) {
    const sink = g.add(setAttribute, { name: "z", value: 1 });
    g.connect(sp, "points", sink, "in");
    g.output(sink, "out", "sink");
  }
  return { g, ids: { din, tr, sp } };
}

function instancesOf(result: Awaited<ReturnType<typeof cook>>, name = "instances"): InstancesItem {
  const item = result.outputs[name][0];
  if (item.kind !== "instances") throw new Error("expected an instances item");
  return item;
}

// ---------------------------------------------------------------------------

describe("spawnInstances as a device-resident run terminal", () => {
  it("a lone spawner IS a run when the resolver advertises the terminal", async () => {
    const { g, ids } = spawnGraph(makeCorpusGeometry(32));
    const gpu = deviceInstanceResolver(["spawnInstances"]);
    const r = await cook(g, { gpu });

    expect(gpu.planned).toEqual([[ids.sp.id]]);
    expect(gpu.executeRuns).toBe(1);
    expect(r.stats.gpu!.residentRuns).toBe(1);
    expect(r.stats.gpu!.fusedNodes).toBe(1);
    // Nothing reads "points", so no readback happened at all.
    expect(gpu.needsGeometry).toEqual([false]);
    expect(r.stats.gpu!.readbacksSaved).toBe(1);

    const item = instancesOf(r);
    expect(item.deviceBatches).toHaveLength(1);
    expect(item.deviceBatches![0].residency).toBe("device");
    expect(item.deviceBatches![0].assetId).toBe("tree");
    expect(item.deviceBatches![0].count).toBe(32);
    expect(item.deviceBatches![0].transforms.byteLength).toBe(32 * 64);
    // "points" was never produced (nobody reads it).
    expect(r.outputs.points).toBeUndefined();
  });

  it("reading `batches` on a device-resident item throws with an actionable message", async () => {
    const { g } = spawnGraph(makeCorpusGeometry(8));
    const item = instancesOf(await cook(g, { gpu: deviceInstanceResolver(["spawnInstances"]) }));
    expect(() => item.batches).toThrow(/device-resident/);
    expect(() => item.batches).toThrow(/deviceBatches/);
    expect(() => item.batches).toThrow(/8 instances/);
  });

  it("without the terminal advertised, nothing changes: CPU batches, no run", async () => {
    const geo = makeCorpusGeometry(32);
    const cpu = await cook(spawnGraph(geo).g);
    const { g } = spawnGraph(geo);
    const gpu = deviceInstanceResolver([]); // opt-in withheld
    const r = await cook(g, { gpu });

    expect(gpu.planned).toEqual([]);
    expect(r.stats.gpu!.residentRuns).toBe(0);
    const item = instancesOf(r);
    expect(item.deviceBatches).toBeUndefined();
    expect(item.batches[0].transforms).toEqual(instancesOf(cpu).batches[0].transforms);
  });

  it("fuses a chain THROUGH to the spawner, and materializes geometry only when read", async () => {
    const geo = makeCorpusGeometry(24);
    const { g, ids } = spawnGraph(geo, { chain: true });
    const gpu = deviceInstanceResolver(["spawnInstances"]);
    const r = await cook(g, { gpu });
    expect(gpu.planned).toEqual([[ids.tr!.id, ids.sp.id]]);
    expect(gpu.needsGeometry).toEqual([false]);
    expect(r.stats.gpu!.readbacksSaved).toBe(2); // both members, zero readbacks

    // Declaring "points" makes the geometry needed again: one readback.
    const declared = spawnGraph(geo, { chain: true, declarePoints: true });
    const gpu2 = deviceInstanceResolver(["spawnInstances"]);
    const r2 = await cook(declared.g, { gpu: gpu2 });
    expect(gpu2.needsGeometry).toEqual([true]);
    expect(r2.stats.gpu!.readbacksSaved).toBe(1);
    expect(r2.outputs.points[0].kind).toBe("geometry");

    // So does connecting it downstream.
    const connected = spawnGraph(geo, { chain: true, connectPoints: true });
    const gpu3 = deviceInstanceResolver(["spawnInstances"]);
    await cook(connected.g, { gpu: gpu3 });
    expect(gpu3.needsGeometry).toEqual([true]);
  });

  it("assetAttr FUSES: one device batch per asset, in the CPU spawner's order", async () => {
    // v0.7 opted this node out with the reason "spawn-asset-attr"; v0.8
    // retired both the opt-out and the reason. No fallback may be
    // counted, and the batch list must be the CPU list.
    const geo = makeCorpusGeometry(16);
    geo.attrs.point.add("kind", "string", 1);
    const kind = geo.attrs.point.require("kind");
    // "rock" first-occurs at 1, "pine" at 0, and index 2 is empty so it
    // merges into the default "tree" — a three-batch, order-sensitive mix.
    for (let i = 0; i < 16; i++) kind.setString(i, i % 3 === 0 ? "pine" : i % 3 === 1 ? "rock" : "");

    const cpu = await cook(spawnGraph(geo, { chain: true, assetAttr: "kind" }).g);
    const { g } = spawnGraph(geo, { chain: true, assetAttr: "kind" });
    const gpu = deviceInstanceResolver(["spawnInstances"]);
    const r = await cook(g, { gpu });

    expect(r.stats.gpu!.fallbacks).toEqual({});
    expect(r.stats.gpu!.residentRuns).toBe(1);
    // The chain in front now fuses WITH the spawner rather than stopping
    // at it: one run, both members. In v0.7 this was two separate paths.
    expect(gpu.planned).toEqual([["transformPoints_0", "spawnInstances_0"]]);
    expect(r.stats.gpu!.fusedNodes).toBe(2);

    const item = instancesOf(r);
    const ref = instancesOf(cpu);
    expect(item.deviceBatches).toBeDefined();
    expect(item.deviceBatches!.map((b) => [b.assetId, b.count])).toEqual(
      ref.batches.map((b) => [b.assetId, b.count]),
    );
    // Three assets → three batches → three handles, all the caller's.
    expect(ref.batches).toHaveLength(3);
    expect(gpu.book.created).toBe(3);
    expect(gpu.book.live).toBe(3);
    for (const b of item.deviceBatches!) b.transforms.dispose();
    expect(gpu.book.liveBytes).toBe(0);
  });

  it("a missing or non-string assetAttr rejects at PLAN time, so the CPU raises it", async () => {
    const { g } = spawnGraph(makeCorpusGeometry(4), { assetAttr: "" });
    const gpu = deviceInstanceResolver(["spawnInstances"]);
    const clean = await cook(g, { gpu });
    expect(clean.stats.gpu!.fallbacks).toEqual({});

    // The node is now fusable, so detection DOES plan a run; the planner
    // is what rejects, and the per-node path then surfaces the CPU
    // spawner's identical message.
    const withAttr = spawnGraph(makeCorpusGeometry(4), { assetAttr: "missing" });
    const gpu2 = deviceInstanceResolver(["spawnInstances"]);
    await expect(cook(withAttr.g, { gpu: gpu2 })).rejects.toThrow(/assetAttr "missing" not found/);
    expect(gpu2.planned).toHaveLength(1);

    // Same for an attribute that exists but is not a string one.
    const numeric = makeCorpusGeometry(4);
    const badGraph = spawnGraph(numeric, { assetAttr: "density" });
    const gpu3 = deviceInstanceResolver(["spawnInstances"]);
    await expect(cook(badGraph.g, { gpu: gpu3 })).rejects.toThrow(/must be a string attribute/);
  });
});

describe("resident fusion shape rule (boundaries in both directions)", () => {
  /** dataInput → setAttribute → `def` → (optional) setAttribute. */
  function shapeGraph(def: Parameters<Graph["add"]>[0], geoPin: string, tail: boolean) {
    const g = new Graph(7);
    const din = g.add(dataInput);
    g.setParam(din, "items", [makeGeometryItem(makeCorpusGeometry(8))]);
    const sa = g.add(setAttribute, { name: "a", value: 1 });
    const mid = g.add(def);
    g.connect(din, "out", sa, "in");
    g.connect(sa, "out", mid, "in");
    if (tail) {
      const sa2 = g.add(setAttribute, { name: "b", value: 2 });
      g.connect(mid, geoPin, sa2, "in");
      g.output(sa2, "out", "out");
      return { g, ids: { sa, mid, sa2 } };
    }
    g.output(mid, geoPin, "out");
    return { g, ids: { sa, mid, sa2: undefined } };
  }

  it("ADMITS a terminal-only node (one geometry + non-geometry outputs)", async () => {
    const { g, ids } = shapeGraph(flaggedTerminal, "out", false);
    const gpu = deviceInstanceResolver(["flagged"]);
    await cook(g, { gpu });
    expect(gpu.planned).toEqual([[ids.sa.id, ids.mid.id]]);
  });

  it("REFUSES the same pins without `terminal` (the pre-existing rule)", async () => {
    const { g } = shapeGraph(unflaggedMulti, "out", false);
    const gpu = deviceInstanceResolver(["unflagged"]);
    await cook(g, { gpu });
    expect(gpu.planned).toEqual([]); // setAttribute alone is not a run
  });

  it("REFUSES a terminal with two geometry outputs", async () => {
    const { g } = shapeGraph(twoGeoTerminal, "a", false);
    const gpu = deviceInstanceResolver(["twoGeo"]);
    await cook(g, { gpu });
    expect(gpu.planned).toEqual([]);
  });

  it("REFUSES a terminal with a multi geometry input", async () => {
    const { g } = shapeGraph(multiInTerminal, "out", false);
    const gpu = deviceInstanceResolver(["multiIn"]);
    await cook(g, { gpu });
    expect(gpu.planned).toEqual([]);
  });

  it("REFUSES a terminal whose kind the resolver does not advertise", async () => {
    const { g } = shapeGraph(flaggedTerminal, "out", false);
    const gpu = deviceInstanceResolver(["somethingElse"]);
    await cook(g, { gpu });
    expect(gpu.planned).toEqual([]);
  });

  it("applies the opt-in to `terminal` nodes of ANY shape, without exception", async () => {
    // A single-geometry-output node would fuse as an ordinary member —
    // but declaring `terminal` makes it opt-in, so the rule is one rule
    // rather than one rule per pin shape.
    const off = shapeGraph(flaggedSingleOut, "out", false);
    const gpuOff = deviceInstanceResolver([]);
    await cook(off.g, { gpu: gpuOff });
    expect(gpuOff.planned).toEqual([]);

    const on = shapeGraph(flaggedSingleOut, "out", false);
    const gpuOn = deviceInstanceResolver(["flaggedSingle"]);
    await cook(on.g, { gpu: gpuOn });
    expect(gpuOn.planned).toEqual([[on.ids.sa.id, on.ids.mid.id]]);
  });

  it("never continues a chain THROUGH a terminal-only node", async () => {
    const { g, ids } = shapeGraph(flaggedTerminal, "out", true);
    const gpu = deviceInstanceResolver(["flagged"]);
    await cook(g, { gpu });
    // The run stops at the terminal; the downstream setAttribute is a
    // lone fusable node and therefore not a run of its own.
    expect(gpu.planned).toEqual([[ids.sa.id, ids.mid.id]]);
  });
});

describe("memo-cache policy for device-resident outputs", () => {
  it("delivers handles but never memoizes them: fresh every cook, bounded retention", async () => {
    const { g, ids } = spawnGraph(makeCorpusGeometry(64), { chain: true });
    const gpu = deviceInstanceResolver(["spawnInstances"]);

    const seen: DeviceTransformsHandle[] = [];
    const revs: number[] = [];
    for (let i = 0; i < 8; i++) {
      const r = await cook(g, { gpu });
      const item = instancesOf(r);
      const handle = item.deviceBatches![0].transforms;
      seen.push(handle);
      revs.push(item.rev);
      // Every cook really re-executes the run: its volatile terminal
      // entry is never served, so both members count as cooked (only the
      // upstream dataInput is ever cached).
      expect(gpu.executeRuns).toBe(i + 1);
      expect(r.stats.cooked).toBe(i === 0 ? 3 : 2);
      expect(r.stats.cached).toBe(i === 0 ? 0 : 1);
      // The owner disposes as soon as it is done: retention returns to 0.
      expect(gpu.book.live).toBe(1);
      expect(gpu.book.liveBytes).toBe(64 * 64);
      handle.dispose();
      expect(gpu.book.live).toBe(0);
      expect(gpu.book.liveBytes).toBe(0);
    }

    // Fresh identity and a fresh rev every cook — the graph never hands
    // the same handle to two owners.
    expect(new Set(seen).size).toBe(8);
    expect(new Set(revs).size).toBe(8);
    expect(gpu.book.created).toBe(8);
    expect(gpu.book.frees).toBe(8);
    // Peak retention is one cook's worth regardless of how many cooks ran.
    expect(gpu.book.liveBytes).toBe(0);
    expect(ids.sp).toBeDefined();
  });

  it("bounded across many distinct graphs (the streaming-cell shape)", async () => {
    const gpu = deviceInstanceResolver(["spawnInstances"]);
    let peakBytes = 0;
    for (let cell = 0; cell < 24; cell++) {
      const { g } = spawnGraph(makeCorpusGeometry(16 + cell), { chain: true });
      const item = instancesOf(await cook(g, { gpu }));
      peakBytes = Math.max(peakBytes, gpu.book.liveBytes);
      item.deviceBatches![0].transforms.dispose();
      expect(gpu.book.live).toBe(0);
    }
    expect(gpu.book.created).toBe(24);
    expect(gpu.book.frees).toBe(24);
    expect(gpu.book.liveBytes).toBe(0);
    // One cell in flight at a time, never an accumulation.
    expect(peakBytes).toBe((16 + 23) * 64);
  });

  it("dispose is idempotent and disposed handles refuse to hand out the resource", async () => {
    const { g } = spawnGraph(makeCorpusGeometry(4));
    const gpu = deviceInstanceResolver(["spawnInstances"]);
    const handle = instancesOf(await cook(g, { gpu })).deviceBatches![0].transforms;
    handle.dispose();
    handle.dispose();
    handle.dispose();
    expect(gpu.book.disposeCalls).toBe(3);
    expect(gpu.book.frees).toBe(1);
    expect(handle.disposed).toBe(true);
    expect(() => handle.resource).toThrow();
  });

  it("a cook that fails after producing a handle disposes it instead of stranding it", async () => {
    const boom = defineNode<Record<string, never>>({
      type: "throwsAfterSpawn",
      inputs: [{ name: "in", kind: "geometry" }],
      outputs: [{ name: "out", kind: "geometry" }],
      defaultParams: {},
      execute() {
        throw new Error("downstream boom");
      },
    });
    const { g, ids } = spawnGraph(makeCorpusGeometry(16));
    const sink = g.add(boom);
    g.connect(ids.sp, "points", sink, "in");
    g.output(sink, "out", "sink");
    const gpu = deviceInstanceResolver(["spawnInstances"]);
    await expect(cook(g, { gpu })).rejects.toThrow(/downstream boom/);
    // The caller received nothing, so the handle is unreachable — the
    // cook must have freed it rather than leaving it counted as live.
    expect(gpu.book.created).toBe(1);
    expect(gpu.book.live).toBe(0);
    expect(gpu.book.frees).toBe(1);
  });

  it("a cancelled cook disposes the handles it had already produced", async () => {
    const { g, ids } = spawnGraph(makeCorpusGeometry(16));
    const sink = g.add(setAttribute, { name: "z", value: 1 });
    g.connect(ids.sp, "points", sink, "in");
    g.output(sink, "out", "sink");
    const gpu = deviceInstanceResolver(["spawnInstances"]);
    const ac = new AbortController();
    await expect(
      cook(g, {
        gpu,
        signal: ac.signal,
        onNodeDone: (info) => {
          if (info.type === "spawnInstances") ac.abort();
        },
      }),
    ).rejects.toBeInstanceOf(CookCancelledError);
    expect(gpu.book.created).toBe(1);
    expect(gpu.book.live).toBe(0);
    expect(gpu.book.frees).toBe(1);
  });

  it("a terminal that produced device batches but declares no instances pin does not leak", async () => {
    // A third-party node claiming the advertised kind without the pin
    // that carries the payload: the executor rejects it, and must free
    // the handles the run already minted.
    const rogue = defineNode<Record<string, never>>({
      type: "rogueTerminal",
      inputs: [{ name: "in", kind: "geometry" }],
      outputs: [
        { name: "out", kind: "geometry" },
        { name: "info", kind: "value" },
      ],
      defaultParams: {},
      execute({ inputs }) {
        return { out: [...inputs.in], info: [] };
      },
      resident: { kind: "spawnInstances", terminal: true },
    });
    const g = new Graph(7);
    const din = g.add(dataInput);
    g.setParam(din, "items", [makeGeometryItem(makeCorpusGeometry(16))]);
    const rg = g.add(rogue);
    g.connect(din, "out", rg, "in");
    g.output(rg, "out", "out");
    const gpu = deviceInstanceResolver(["spawnInstances"]);
    await expect(cook(g, { gpu })).rejects.toThrow(/declares no output pin of kind/);
    expect(gpu.book.created).toBe(1);
    expect(gpu.book.live).toBe(0);
    expect(gpu.book.frees).toBe(1);
  });

  it("a handle no delivered collection carries is disposed, not stranded", async () => {
    // The spawner's instances pin is neither connected nor selected, so
    // nothing can ever receive the handle: the cook owns it to the end
    // and frees it. Repeated cooks must not accumulate device memory.
    const { g } = spawnGraph(makeCorpusGeometry(16), { declarePoints: true });
    const gpu = deviceInstanceResolver(["spawnInstances"]);
    for (let i = 0; i < 5; i++) {
      const r = await cook(g, { gpu, outputs: ["points"] });
      expect(r.outputs.points).toHaveLength(1);
      expect(gpu.book.live).toBe(0);
    }
    expect(gpu.book.created).toBe(5);
    expect(gpu.book.frees).toBe(5);
    expect(gpu.book.liveBytes).toBe(0);
  });

  it("a handle a downstream node forwards into a selected output is NOT disposed", async () => {
    const forward = defineNode<Record<string, never>>({
      type: "forwardInstances",
      inputs: [{ name: "in", kind: "instances" }],
      outputs: [{ name: "out", kind: "instances" }],
      defaultParams: {},
      execute({ inputs }) {
        return { out: [...inputs.in] };
      },
    });
    const g = new Graph(7);
    const din = g.add(dataInput);
    g.setParam(din, "items", [makeGeometryItem(makeCorpusGeometry(16))]);
    const sp = g.add(spawnInstances, { assetId: "tree" });
    g.connect(din, "out", sp, "in");
    const fw = g.add(forward);
    g.connect(sp, "instances", fw, "in");
    g.output(fw, "out", "out");
    const gpu = deviceInstanceResolver(["spawnInstances"]);
    const r = await cook(g, { gpu });
    const item = r.outputs.out[0];
    if (item.kind !== "instances") throw new Error("expected an instances item");
    const handle = item.deviceBatches![0].transforms;
    expect(handle.disposed).toBe(false);
    expect(gpu.book.live).toBe(1);
    handle.dispose();
    expect(gpu.book.live).toBe(0);
  });

  it("ordinary geometry runs still memoize normally", async () => {
    const g = new Graph(7);
    const din = g.add(dataInput);
    g.setParam(din, "items", [makeGeometryItem(makeCorpusGeometry(8))]);
    const a = g.add(setAttribute, { name: "a", value: 1 });
    const b = g.add(setAttribute, { name: "b", value: 2 });
    g.connect(din, "out", a, "in");
    g.connect(a, "out", b, "in");
    g.output(b, "out", "out");
    const gpu = deviceInstanceResolver(["spawnInstances"]);
    await cook(g, { gpu });
    const second = await cook(g, { gpu });
    expect(gpu.executeRuns).toBe(1); // the run's terminal cache served
    expect(second.stats.cached).toBe(3);
  });
});
