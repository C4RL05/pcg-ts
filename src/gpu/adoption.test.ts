/**
 * Per-node GPU-adoption tests (CPU-only, run everywhere) for the phase
 * 22 adopters: transformPoints, jitterPoints, orientAlongVector,
 * surfaceSample, volumeSample. A stub resolver (CPU-backed, honoring
 * the freshness contract) drives, for each node: memo-key provenance
 * surgery across the gpu toggle, byte-exact fallback equivalence for
 * spec-less fields, and cache survival for plain-value params. The
 * real-device equivalents live in pervasive.device.test.ts.
 */
import { describe, expect, it } from "vitest";
import { createTriangleMesh } from "../data/index.js";
import {
  evaluateField,
  makeField,
  randomField,
  type FieldLike,
  type GpuFieldResolver,
} from "../fields/index.js";
import { Graph, cook, makeGeometryItem } from "../graph/index.js";
import {
  jitterPoints,
  orientAlongVector,
  surfaceSample,
  transformPoints,
  volumeSample,
} from "../nodes/index.js";
import { acceptsDerivedSpecs, deviceSpec, specFallbackReason } from "../fields/spec.js";
import { fieldFromJson } from "../nodes/fieldJson.js";
import { dataInput } from "../runtime/index.js";
import { makeCorpusGeometry } from "./testGeometry.js";

/**
 * CPU-backed stub resolver (same contract as provenance.test.ts). Its
 * eligibility gate is the production one — `deviceSpec` with the flag it
 * advertises — so the double cannot accept a set the executor did not
 * salt, which is the property under test in this file.
 */
function stubResolver(salt: string, opts: { acceptDerivedSpecs?: boolean } = {}): GpuFieldResolver & { calls: number } {
  const accept = acceptsDerivedSpecs(opts);
  const stub: GpuFieldResolver & { calls: number } = {
    calls: 0,
    cacheSalt: salt,
    acceptDerivedSpecs: accept,
    resolveField(field, ctx, stats) {
      stub.calls++;
      if (deviceSpec(field, accept) === undefined) {
        const reason = specFallbackReason(field);
        if (stats !== undefined) stats.fallbacks[reason] = (stats.fallbacks[reason] ?? 0) + 1;
        return null;
      }
      if (stats !== undefined) stats.dispatches++;
      const column = evaluateField(field, ctx);
      return Promise.resolve({ data: column.data.slice() as typeof column.data, tupleSize: column.tupleSize });
    },
  };
  return stub;
}

/**
 * A field no spec can ever name — an arbitrary closure — computing the
 * same bytes as `randomField("authored")`, so the two populations
 * ("indescribable" and "described but code-authored") differ only in
 * provenance and their fallback reason, never in what they evaluate to.
 */
const opaqueField = (): FieldLike =>
  makeField("opaque", 1, (ctx) => evaluateField(randomField("authored"), ctx));

/** Unit square in the XY plane, two triangles (surfaceSample fixture). */
function unitSquare(): ReturnType<typeof createTriangleMesh> {
  return createTriangleMesh([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3]);
}

interface AdoptionCase {
  readonly name: string;
  /** Output point attribute whose bytes pin the node's result. */
  readonly attr: string;
  /** Spec'd Field for the node's field-capable param. */
  readonly specField: () => FieldLike;
  /** Graph: [dataInput →] node → output "out"; `value` fills the field param. */
  readonly build: (value: FieldLike) => Graph;
}

const CASES: AdoptionCase[] = [
  {
    name: "transformPoints",
    attr: "P",
    specField: () => fieldFromJson({ fn: "mul", args: [{ fn: "position" }, [0.1, 0.2, 0.3]] }),
    build: (value) => {
      const g = new Graph(7);
      const din = g.add(dataInput);
      g.setParam(din, "items", [makeGeometryItem(makeCorpusGeometry(50))]);
      const n = g.add(transformPoints);
      g.setParam(n, "translate", value as never);
      g.connect(din, "out", n, "in");
      g.output(n, "out", "out");
      return g;
    },
  },
  {
    name: "jitterPoints",
    attr: "P",
    specField: () => fieldFromJson({ fn: "attribute", name: "density" }),
    build: (value) => {
      const g = new Graph(7);
      const din = g.add(dataInput);
      g.setParam(din, "items", [makeGeometryItem(makeCorpusGeometry(50))]);
      const n = g.add(jitterPoints);
      g.setParam(n, "amount", value as never);
      g.connect(din, "out", n, "in");
      g.output(n, "out", "out");
      return g;
    },
  },
  {
    name: "orientAlongVector",
    attr: "rot",
    specField: () => fieldFromJson({ fn: "position" }),
    build: (value) => {
      const g = new Graph(7);
      const din = g.add(dataInput);
      g.setParam(din, "items", [makeGeometryItem(makeCorpusGeometry(50))]);
      const n = g.add(orientAlongVector);
      g.setParam(n, "direction", value as never);
      g.connect(din, "out", n, "in");
      g.output(n, "out", "out");
      return g;
    },
  },
  {
    name: "surfaceSample",
    attr: "P",
    // Evaluated over the internally built candidate cloud (reads its P).
    specField: () =>
      fieldFromJson({ fn: "clamp", args: [{ fn: "component", args: [{ fn: "position" }], index: 0 }, 0, 1] }),
    build: (value) => {
      const g = new Graph(7);
      const din = g.add(dataInput);
      g.setParam(din, "items", [makeGeometryItem(unitSquare())]);
      const n = g.add(surfaceSample);
      g.setParam(n, "count", 200);
      g.setParam(n, "densityField", value as never);
      g.connect(din, "out", n, "in");
      g.output(n, "out", "out");
      return g;
    },
  },
  {
    name: "volumeSample",
    attr: "P",
    // Evaluated on the un-jittered grid centers of the internal cloud.
    specField: () => fieldFromJson({ fn: "randomField", key: "j" }),
    build: (value) => {
      const g = new Graph(7);
      const n = g.add(volumeSample);
      g.setParam(n, "boundsMin", [0, 0, 0]);
      g.setParam(n, "boundsMax", [2, 2, 2]);
      g.setParam(n, "cellSize", 0.5);
      g.setParam(n, "jitter", value as never);
      g.output(n, "out", "out");
      return g;
    },
  },
];

function outAttrBytes(result: Awaited<ReturnType<typeof cook>>, name: string): Uint8Array {
  const item = result.outputs.out[0];
  if (item.kind !== "geometry") throw new Error("expected geometry");
  const attr = item.geo.attrs.point.require(name);
  const n = item.geo.attrs.point.count * attr.tupleSize;
  return new Uint8Array(attr.data.buffer, attr.data.byteOffset, n * attr.data.BYTES_PER_ELEMENT);
}

describe.each(CASES)("gpu adoption: $name", (c) => {
  it("toggling gpu recooks the node and never serves bytes across provenance", async () => {
    const g = c.build(c.specField());
    const stub = stubResolver("stub|deviceA");
    const nodesInGraph = c.name === "volumeSample" ? 1 : 2;

    const r1 = await cook(g);
    expect(r1.stats.cooked).toBe(nodesInGraph);
    expect(r1.stats.gpu).toBeUndefined();
    const cpuBytes = outAttrBytes(r1, c.attr);
    expect(cpuBytes.length).toBeGreaterThan(0);

    // Toggle on: only the adopting node recooks (provenance marker).
    const r2 = await cook(g, { gpu: stub });
    expect(r2.stats.cooked).toBe(1);
    expect(r2.stats.cached).toBe(nodesInGraph - 1);
    expect(r2.stats.gpu!.dispatches).toBe(1); // exactly the one field param
    expect(r2.stats.gpu!.fallbacks).toEqual({});
    expect(outAttrBytes(r2, c.attr)).toEqual(cpuBytes); // stub is CPU-backed

    // Same provenance: fully cached, resolver untouched.
    const callsBefore = stub.calls;
    const r3 = await cook(g, { gpu: stub });
    expect(r3.stats.cooked).toBe(0);
    expect(r3.stats.gpu!.dispatches).toBe(0);
    expect(stub.calls).toBe(callsBefore);

    // Toggle off: marker removed, recooks on CPU, bytes identical.
    const r4 = await cook(g);
    expect(r4.stats.cooked).toBe(1);
    expect(outAttrBytes(r4, c.attr)).toEqual(cpuBytes);
  });

  it("spec-less field under gpu falls back to byte-identical CPU bytes", async () => {
    const stub = stubResolver("stub|deviceA");
    const gpuRun = await cook(c.build(opaqueField()), { gpu: stub });
    expect(gpuRun.stats.gpu!.dispatches).toBe(0);
    expect(gpuRun.stats.gpu!.fallbacks).toEqual({ "no-spec": 1 });
    const cpuRun = await cook(c.build(opaqueField()));
    expect(outAttrBytes(gpuRun, c.attr)).toEqual(outAttrBytes(cpuRun, c.attr));
  });

  it("code-authored field falls back as derived-spec, not no-spec", async () => {
    // Same node, same param, a field that DOES describe itself but was
    // built in code: the reason has to name the flag that would admit it,
    // not claim the field is indescribable.
    const stub = stubResolver("stub|deviceA");
    const gpuRun = await cook(c.build(randomField("authored")), { gpu: stub });
    expect(gpuRun.stats.gpu!.dispatches).toBe(0);
    expect(gpuRun.stats.gpu!.fallbacks).toEqual({ "derived-spec": 1 });
    const cpuRun = await cook(c.build(randomField("authored")));
    expect(outAttrBytes(gpuRun, c.attr)).toEqual(outAttrBytes(cpuRun, c.attr));
  });

  it("acceptDerivedSpecs admits the same code-authored field", async () => {
    const stub = stubResolver("stub|deviceA", { acceptDerivedSpecs: true });
    const g = c.build(randomField("authored"));
    const gpuRun = await cook(g, { gpu: stub });
    expect(gpuRun.stats.gpu!.dispatches).toBe(1);
    expect(gpuRun.stats.gpu!.fallbacks).toEqual({});
    // ...and the widened acceptance is salted: a CPU cook of the same
    // graph recooks rather than serving the device-resolved entry.
    const cpuRun = await cook(g);
    expect(cpuRun.stats.cooked).toBe(1);
    // Still a genuinely spec-less field's answer, flag or no flag.
    const opaque = await cook(c.build(opaqueField()), { gpu: stub });
    expect(opaque.stats.gpu!.fallbacks).toEqual({ "no-spec": 1 });
  });

  it("plain-value params keep their cache across the gpu toggle", async () => {
    const g = c.build(c.name === "surfaceSample" || c.name === "volumeSample" ? 0.5 : [0.1, 0.1, 0.1]);
    await cook(g);
    const stub = stubResolver("stub|deviceA");
    const toggled = await cook(g, { gpu: stub });
    expect(toggled.stats.cooked).toBe(0); // no spec'd Field → no marker
    expect(stub.calls).toBe(0); // plain values never reach the resolver
  });
});
