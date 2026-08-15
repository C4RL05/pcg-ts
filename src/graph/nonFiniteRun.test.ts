/**
 * The fused-run half of the non-finite guard: what a device-resident run
 * REPORTS into `CookStats.gpu.nonFinite`, and — the half that matters more
 * — what it DECLARES it could not look at.
 *
 * Device-free, and deliberately so. A stub resolver implements
 * `planRun`/`executeRun`/`residentTerminals` and hands back a geometry
 * this file wrote by hand, which is what makes every number below exact:
 * the counts are a property of bytes written here, not of a kernel. The
 * real-device equivalents live in the `src/gpu` device suites.
 *
 * The param seam THROWS (see `src/nodes/util.ts`); this seam never does. A
 * run has fused several nodes into one pipeline, so no param can be named,
 * and the members' params never reached the checked seam at all — which is
 * why `unchecked` is written on EVERY run, clean or not. Absence of a
 * finding must never be readable as "checked and clean".
 */
import { describe, expect, it } from "vitest";
import { Geometry } from "../data/index.js";
import type {
  DeviceInstanceBatch,
  DeviceTransformsHandle,
  GpuFieldResolver,
  ResidentRunResult,
} from "../fields/index.js";
import { setAttribute } from "../nodes/index.js";
import { dataInput } from "../runtime/index.js";
import { spawnInstances } from "../spawn/index.js";
import { makeGeometryItem } from "./data.js";
import { cook } from "./execute.js";
import { Graph } from "./graph.js";

// ---------------------------------------------------------------------------
// the stub resolver

interface RunStub extends GpuFieldResolver {
  /** Member id lists `planRun` received, in call order. */
  planned: string[][];
  executeRuns: number;
}

/**
 * A resolver whose `planRun` accepts every chain it is offered and whose
 * `executeRun` returns `produce()` verbatim. Nothing about it is a device
 * model: it exists so the run terminal is handed a result whose contents
 * the test chose, which is the only way an assertion on a COUNT can be an
 * equality rather than a range.
 */
function runStub(produce: () => ResidentRunResult, terminals: readonly string[] = []): RunStub {
  const stub: RunStub = {
    planned: [],
    executeRuns: 0,
    cacheSalt: "stub|nonFiniteRun",
    residentTerminals: terminals,
    resolveField: () => null,
    planRun(members) {
      stub.planned.push(members.map((m) => m.id));
      return { members: [...members] };
    },
    executeRun(_plan, _input, stats) {
      stub.executeRuns++;
      if (stats !== undefined) {
        stats.residentRuns++;
      }
      return Promise.resolve(produce());
    },
  };
  return stub;
}

// ---------------------------------------------------------------------------
// fixtures

/** A minimal non-empty point cloud: fusion is skipped for empty inputs. */
function inputCloud(count = 4): Geometry {
  const geo = new Geometry();
  const set = geo.attrs.point;
  const P = set.add("P", "f32", 3);
  set.resize(count);
  for (let i = 0; i < count; i++) P.setTuple(i, [i, 0, i]);
  return geo;
}

/**
 * dataInput → setAttribute("a") → setAttribute("b"), "out" declared. Two
 * fusable members, so the detector forms one run whose terminal is `b`.
 */
function chainGraph(): { g: Graph; terminal: string } {
  const g = new Graph(7);
  const din = g.add(dataInput);
  g.setParam(din, "items", [makeGeometryItem(inputCloud())]);
  const a = g.add(setAttribute, { name: "a", value: 1 });
  const b = g.add(setAttribute, { name: "b", value: 2 });
  g.connect(din, "out", a, "in");
  g.connect(a, "out", b, "in");
  g.output(b, "out", "out");
  return { g, terminal: b.id };
}

/** The `nonFinite` record of a cook that carried a resolver. */
function report(result: Awaited<ReturnType<typeof cook>>): {
  counts: Record<string, number>;
  unchecked: Record<string, string>;
} {
  const gpu = result.stats.gpu;
  if (gpu === undefined) throw new Error("expected stats.gpu on a cook with a resolver");
  return gpu.nonFinite;
}

/**
 * A readback geometry with a broken `P`: element 0 has all three
 * components NaN, element 2 has exactly one +Infinity component, and
 * elements 1 and 3 are finite. Two ELEMENTS are non-finite; four SCALARS
 * are. The report quotes the former.
 */
function brokenReadback(): Geometry {
  const geo = new Geometry();
  const set = geo.attrs.point;
  const P = set.add("P", "f32", 3);
  const clean = set.add("clean", "f32", 1);
  set.resize(4);
  for (let i = 0; i < 4; i++) {
    P.setTuple(i, [i, i, i]);
    clean.setTuple(i, [i]);
  }
  P.setTuple(0, [NaN, NaN, NaN]);
  P.setTuple(2, [1, Infinity, 3]);
  return geo;
}

/** Every column finite: the case whose `unchecked` key still has to appear. */
function cleanReadback(): Geometry {
  const geo = new Geometry();
  const set = geo.attrs.point;
  const P = set.add("P", "f32", 3);
  set.resize(4);
  for (let i = 0; i < 4; i++) P.setTuple(i, [i, i * 2, i * 3]);
  return geo;
}

/** A device handle with the real ownership semantics, minus a device. */
function fakeHandle(byteLength: number): DeviceTransformsHandle {
  let disposed = false;
  return {
    backend: "stub",
    byteLength,
    get disposed(): boolean {
      return disposed;
    },
    get resource(): unknown {
      if (disposed) throw new Error("stub handle: disposed");
      return null;
    },
    dispose(): void {
      disposed = true;
    },
  };
}

// ---------------------------------------------------------------------------

describe("fused-run non-finite reporting: counts", () => {
  it("reports a broken readback into cook stats and does NOT fail the cook", async () => {
    // The whole point of this seam. A fused run cannot name the offending
    // param, and a throw that cannot say which knob to turn would fail
    // cooks the per-node CPU path completes — so it counts and carries on.
    const { g, terminal } = chainGraph();
    const stub = runStub(() => ({ geo: brokenReadback() }));
    const r = await cook(g, { gpu: stub });

    expect(stub.executeRuns).toBe(1);
    expect(r.stats.gpu!.residentRuns).toBe(1);
    // 2, not 4: an element with three NaN components is ONE non-finite
    // element, because "2 of 4 points" is what an author can act on and
    // "4 of 12 scalars" is not. The clean column is absent rather than
    // present-and-zero, so a key means a finding.
    expect(report(r).counts).toEqual({ [`${terminal}:P`]: 2 });
    // ...and the cook really did succeed, with the run's geometry
    // delivered on the terminal's pin.
    expect(r.outputs.out[0].kind).toBe("geometry");
  });

  it("scans every f32 column, keyed by terminal and attribute name", async () => {
    const { g, terminal } = chainGraph();
    const stub = runStub(() => {
      const geo = brokenReadback();
      const set = geo.attrs.point;
      const second = set.add("wobble", "f32", 2);
      // One element of a vec2 column, so the two keys carry different
      // numbers and neither could be the other's.
      second.setTuple(1, [NaN, 0]);
      return { geo };
    });
    const r = await cook(g, { gpu: stub });
    expect(report(r).counts).toEqual({ [`${terminal}:P`]: 2, [`${terminal}:wobble`]: 1 });
  });
});

describe("fused-run non-finite reporting: the coverage declaration", () => {
  it("declares the members' params unchecked on a run whose readback is CLEAN", async () => {
    // The load-bearing case. Nothing was found, and the record still says
    // the params were never looked at — otherwise an empty report would
    // read as "checked and clean" on precisely the path that checks least.
    const { g, terminal } = chainGraph();
    const stub = runStub(() => ({ geo: cleanReadback() }));
    const r = await cook(g, { gpu: stub });

    expect(stub.executeRuns).toBe(1);
    expect(report(r).counts).toEqual({});
    expect(report(r).unchecked).toEqual({ [`${terminal}:params`]: "fused-run" });
  });

  it("declares it on a dirty run too: the two records are independent", async () => {
    const { g, terminal } = chainGraph();
    const r = await cook(g, { gpu: runStub(() => ({ geo: brokenReadback() })) });
    expect(report(r).unchecked).toEqual({ [`${terminal}:params`]: "fused-run" });
    expect(report(r).counts).toEqual({ [`${terminal}:P`]: 2 });
  });

  it("declares it WARM as well as cold, while the counts stay cold-only", async () => {
    // Which params reach the checked seam is a property of the GRAPH, not
    // of the cache state: a run served from its terminal's memo entry
    // checked nothing this cook either. The counts beside it are a record
    // of device work, like `residentRuns`, so they do not repeat.
    const { g, terminal } = chainGraph();
    const stub = runStub(() => ({ geo: brokenReadback() }));
    const cold = await cook(g, { gpu: stub });
    expect(report(cold).counts).toEqual({ [`${terminal}:P`]: 2 });

    const warm = await cook(g, { gpu: stub });
    expect(stub.executeRuns).toBe(1); // served from the terminal's entry
    expect(warm.stats.cooked).toBe(0);
    expect(report(warm).unchecked).toEqual({ [`${terminal}:params`]: "fused-run" });
    expect(report(warm).counts).toEqual({});
  });

  it("declares device-resident transforms unchecked when a run produces batches", async () => {
    // Instance transforms that never come back cannot be scanned at any
    // price the feature would survive: checking them means the `count * 16`
    // readback the device-resident path exists to remove. Declared, not
    // paid for.
    const g = new Graph(7);
    const din = g.add(dataInput);
    g.setParam(din, "items", [makeGeometryItem(inputCloud())]);
    const sp = g.add(spawnInstances, { assetId: "tree" });
    g.connect(din, "out", sp, "in");
    g.output(sp, "instances", "instances");

    const batch: DeviceInstanceBatch = {
      residency: "device",
      assetId: "tree",
      count: 4,
      transforms: fakeHandle(4 * 64),
    };
    const stub = runStub(() => ({ deviceBatches: [batch] }), ["spawnInstances"]);
    const r = await cook(g, { gpu: stub });

    expect(stub.planned).toEqual([[sp.id]]);
    expect(report(r).unchecked).toEqual({
      [`${sp.id}:params`]: "fused-run",
      [`${sp.id}:transforms`]: "device-resident",
    });
    // No geometry came back, so there was nothing to scan — and the empty
    // record is honest only because the declaration above stands beside it.
    expect(report(r).counts).toEqual({});

    const item = r.outputs.instances[0];
    if (item.kind !== "instances") throw new Error("expected an instances item");
    item.deviceBatches![0].transforms.dispose();
  });
});

describe("fused-run non-finite reporting: the empty and absent cases", () => {
  it("a cook with a resolver but no fused run leaves both records empty", async () => {
    // A lone fusable node is not a run. Empty here means "nothing fused",
    // never "not looked at" — the distinction the `unchecked` record is
    // there to make, and it can only be read if this case really is empty.
    const g = new Graph(7);
    const din = g.add(dataInput);
    g.setParam(din, "items", [makeGeometryItem(inputCloud())]);
    const sa = g.add(setAttribute, { name: "a", value: 1 });
    g.connect(din, "out", sa, "in");
    g.output(sa, "out", "out");

    const stub = runStub(() => {
      throw new Error("executeRun must not be called: a lone node is not a run");
    });
    const r = await cook(g, { gpu: stub });
    expect(stub.planned).toEqual([]);
    expect(stub.executeRuns).toBe(0);
    expect(report(r)).toEqual({ counts: {}, unchecked: {} });
  });

  it("a CPU-only cook carries no stats.gpu at all", async () => {
    // `nonFinite` is never absent while `stats.gpu` is present, and
    // `stats.gpu` is present exactly when the cook carried a resolver — so
    // an agent can tell "clean" from "not looked at" without knowing which
    // cook shape produced the stats.
    const { g } = chainGraph();
    const r = await cook(g);
    expect(r.stats.gpu).toBeUndefined();
  });
});

describe("fused-run non-finite reporting: what the scan may read", () => {
  it("never counts an int or bool column, whatever bits it holds", async () => {
    // A correctness rule, not an optimization (see `src/fields/finite.ts`):
    // an Int32Array/Uint32Array/Uint8Array cannot HOLD a non-finite value,
    // and the float-to-int store that produced one from a non-finite f32 is
    // documented GIGO on the device and explicitly not matched against the
    // CPU. So these columns carry the BIT PATTERNS of NaN and +Infinity:
    // a scan that reinterpreted the bytes as f32 would read them as
    // findings, and the guard's answer would start depending on which path
    // ran. The f32 column beside them is the positive control.
    const { g, terminal } = chainGraph();
    const stub = runStub(() => {
      const geo = new Geometry();
      const set = geo.attrs.point;
      const P = set.add("P", "f32", 3);
      const material = set.add("material", "i32", 1); // Int32Array
      const id = set.add("id", "u32", 1); // Uint32Array
      const active = set.add("active", "bool", 1); // Uint8Array
      set.resize(4);
      for (let i = 0; i < 4; i++) {
        P.setTuple(i, [i, i, i]);
        material.data[i] = 0x7fc00000; // f32 bits of NaN
        id.data[i] = 0x7f800000; // f32 bits of +Infinity
        active.data[i] = 0xff;
      }
      P.setTuple(1, [0, NaN, 0]);
      return { geo };
    });
    const r = await cook(g, { gpu: stub });
    expect(report(r).counts).toEqual({ [`${terminal}:P`]: 1 });
  });

  it("reads the live elements only, never the dead capacity tail", async () => {
    // Attribute storage is `capacity * tupleSize` long and its tail holds
    // elements the geometry does not have. Scanning it would let dead
    // storage decide a live answer — a geometry that shrank would start
    // reporting findings nothing downstream can see.
    const { g, terminal } = chainGraph();
    let tailScalars = 0;
    const stub = runStub(() => {
      const geo = new Geometry();
      const set = geo.attrs.point;
      const P = set.add("P", "f32", 3);
      const tail = set.add("tail", "f32", 1);
      set.resize(4);
      for (let i = 0; i < 4; i++) {
        P.setTuple(i, [i, i, i]);
        tail.data[i] = i;
      }
      // Past `count`, inside `capacity`: unreachable through the geometry.
      tailScalars = tail.data.length - set.count * tail.tupleSize;
      for (let i = set.count * tail.tupleSize; i < tail.data.length; i++) tail.data[i] = NaN;
      P.setTuple(3, [NaN, 0, 0]);
      return { geo };
    });
    const r = await cook(g, { gpu: stub });
    // The fixture is only a test while the tail actually exists.
    expect(tailScalars).toBeGreaterThan(0);
    expect(report(r).counts).toEqual({ [`${terminal}:P`]: 1 });
  });
});
