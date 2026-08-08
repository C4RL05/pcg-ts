/**
 * Real-device integration scenario for `GpuFieldEvaluator` + cook/World
 * threading. Test-only: bundled by integration.device.test.ts (esbuild)
 * and executed in a plain Node child process — the Dawn bindings are
 * unstable inside vitest workers (see deviceRunner.mjs), and this
 * scenario needs the real evaluator, graph executor, and World, so it
 * runs the whole stack out of process and reports observations as JSON
 * on stdout for the vitest side to assert.
 */
import { create } from "webgpu";
import {
  captureAsync,
  capture,
  createGpuCookStats,
  evaluateField,
  makeField,
  randomField,
  type Column,
  type GpuFieldResolver,
} from "../fields/index.js";
import { resolverView } from "../fields/spec.js";
import { Graph, cook, makeGeometryItem, subgraphNode, type CookResult } from "../graph/index.js";
import { setAttribute } from "../nodes/attributes.js";
import { fieldFromJson } from "../nodes/fieldJson.js";
import { dataInput } from "../runtime/dataInput.js";
import { World } from "../runtime/world.js";
import type { GpuDeviceLike } from "./device.js";
import { GpuFieldEvaluator } from "./evaluator.js";
import { makeCorpusGeometry } from "./testGeometry.js";

function bytesEqual(a: Column, b: Column): boolean {
  if (a.tupleSize !== b.tupleSize) return false;
  if (a.data.constructor !== b.data.constructor) return false;
  const ab = new Uint8Array(a.data.buffer, a.data.byteOffset, a.data.byteLength);
  const bb = new Uint8Array(b.data.buffer, b.data.byteOffset, b.data.byteLength);
  if (ab.length !== bb.length) return false;
  for (let i = 0; i < ab.length; i++) if (ab[i] !== bb[i]) return false;
  return true;
}

/** The bit-exact workhorse spec used across the cook scenarios. */
const SPEC = { fn: "mul", args: [{ fn: "attribute", name: "density" }, { fn: "randomField", key: "jitter" }] };

function attrColumn(result: CookResult, name: string): Column {
  const item = result.outputs.out[0];
  if (item.kind !== "geometry") throw new Error("scenario: expected a geometry item");
  const attr = item.geo.attrs.point.require(name);
  const n = item.geo.attrs.point.count * attr.tupleSize;
  return { data: attr.data.subarray(0, n) as Column["data"], tupleSize: attr.tupleSize };
}

async function main(): Promise<void> {
  const gpu = create([]);
  const adapter = await gpu.requestAdapter();
  if (adapter === null) {
    process.stdout.write(JSON.stringify({ ok: false, error: "no WebGPU adapter" }));
    return;
  }
  const device = await adapter.requestDevice();
  // Compile-time check (tsc --noEmit): a real GPUDevice satisfies the
  // structural device typing the evaluator is written against.
  const structural: GpuDeviceLike = device;
  const evaluator = new GpuFieldEvaluator(structural, { adapterInfo: adapter.info });
  const out: Record<string, unknown> = { ok: true, salt: evaluator.cacheSalt };

  // -- evaluator basics ------------------------------------------------------
  {
    const geo = makeCorpusGeometry(65);
    const ctx = { geo, domain: "point" as const, seed: 5 };
    const field = fieldFromJson(SPEC);
    const stats1 = createGpuCookStats();
    const pending = evaluator.resolveField(field, ctx, stats1);
    const col = pending === null ? null : await pending;
    const cpu = evaluateField(field, ctx);
    const stats2 = createGpuCookStats();
    const again = await evaluator.resolveField(field, ctx, stats2)!;

    const emptyStats = createGpuCookStats();
    const emptyCol = await evaluator.resolveField(
      field,
      { geo: makeCorpusGeometry(0), domain: "point", seed: 5 },
      emptyStats,
    )!;

    // Two distinct ineligible populations: a field that cannot be
    // described at all, and one that describes itself but was authored in
    // code. They must report different reasons, and the second must flip
    // to eligible under `acceptDerivedSpecs`.
    const noSpecStats = createGpuCookStats();
    const opaque = makeField("opaque", 1, (c) => evaluateField(randomField("code-authored"), c));
    const noSpec = evaluator.resolveField(opaque, ctx, noSpecStats);

    const derivedStats = createGpuCookStats();
    const derivedField = randomField("code-authored");
    const derivedRes = evaluator.resolveField(derivedField, ctx, derivedStats);

    const wideEvaluator = new GpuFieldEvaluator(structural, {
      adapterInfo: adapter.info,
      acceptDerivedSpecs: true,
    });
    const wideStats = createGpuCookStats();
    const widePending = wideEvaluator.resolveField(derivedField, ctx, wideStats);
    const wideCol = widePending === null ? null : await widePending;
    const wideCpu = evaluateField(derivedField, ctx);
    const wideOpaqueStats = createGpuCookStats();
    const wideOpaque = wideEvaluator.resolveField(opaque, ctx, wideOpaqueStats);

    const strGeo = makeCorpusGeometry(8);
    strGeo.attrs.point.add("label", "string", 1);
    const strStats = createGpuCookStats();
    const strField = fieldFromJson({ fn: "attribute", name: "label" });
    const strRes = evaluator.resolveField(strField, { geo: strGeo, domain: "point", seed: 0 }, strStats);

    const u32Field = fieldFromJson({ fn: "attribute", name: "id" });
    const u32Gpu = await evaluator.resolveField(u32Field, ctx)!;
    const u32Cpu = evaluateField(u32Field, ctx);
    const idxField = fieldFromJson({ fn: "index" });
    const idxGpu = await evaluator.resolveField(idxField, ctx)!;
    const idxCpu = evaluateField(idxField, ctx);
    const boolField = fieldFromJson({ fn: "attribute", name: "active" });
    const boolGpu = await evaluator.resolveField(boolField, ctx)!;
    const boolCpu = evaluateField(boolField, ctx);

    out.basics = {
      resolved: col !== null,
      bitExact: col !== null && bytesEqual(cpu, col),
      secondBitExact: bytesEqual(cpu, again),
      stats1,
      stats2,
      pipelineCacheSize: evaluator.pipelineCacheSize,
      empty: { length: emptyCol.data.length, type: emptyCol.data.constructor.name, stats: emptyStats },
      noSpec: { isNull: noSpec === null, stats: noSpecStats },
      derivedSpec: { isNull: derivedRes === null, stats: derivedStats },
      derivedAccepted: {
        resolved: wideCol !== null,
        bitExact: wideCol !== null && bytesEqual(wideCpu, wideCol),
        stats: wideStats,
        advertised: wideEvaluator.acceptDerivedSpecs,
        defaultAdvertised: evaluator.acceptDerivedSpecs,
        opaqueStillNull: wideOpaque === null,
        opaqueStats: wideOpaqueStats,
      },
      stringAttr: { isNull: strRes === null, stats: strStats },
      u32Root: { type: u32Gpu.data.constructor.name, bitExact: bytesEqual(u32Cpu, u32Gpu) },
      indexRoot: { type: idxGpu.data.constructor.name, bitExact: bytesEqual(idxCpu, idxGpu) },
      boolAttr: { type: boolGpu.data.constructor.name, bitExact: bytesEqual(boolCpu, boolGpu) },
    };
  }

  // -- captureAsync ----------------------------------------------------------
  {
    const gpuGeo = makeCorpusGeometry(100);
    const cpuGeo = makeCorpusGeometry(100);
    const field = fieldFromJson(SPEC);
    const stats = createGpuCookStats();
    const gpuName = await captureAsync(gpuGeo, "point", field, 9, evaluator, stats);
    const cpuName = capture(cpuGeo, "point", field, 9);
    const gpuAttr = gpuGeo.attrs.point.require(gpuName);
    const cpuAttr = cpuGeo.attrs.point.require(cpuName);
    out.captureAsync = {
      sameName: gpuName === cpuName,
      bitExact: bytesEqual(
        { data: cpuAttr.data.subarray(0, 100) as Column["data"], tupleSize: cpuAttr.tupleSize },
        { data: gpuAttr.data.subarray(0, 100) as Column["data"], tupleSize: gpuAttr.tupleSize },
      ),
      stats,
    };
  }

  // -- cook provenance + fallback equivalence --------------------------------
  {
    const g = new Graph(7);
    const din = g.add(dataInput);
    g.setParam(din, "items", [makeGeometryItem(makeCorpusGeometry(100))]);
    const sa = g.add(setAttribute);
    g.setParam(sa, "name", "d");
    g.setParam(sa, "value", fieldFromJson(SPEC));
    g.connect(din, "out", sa, "in");
    g.output(sa, "out", "out");

    const r1 = await cook(g);
    const r2 = await cook(g, { gpu: evaluator });
    const r3 = await cook(g, { gpu: evaluator });
    const r4 = await cook(g);
    const colCpu = attrColumn(r1, "d");
    out.cookProvenance = {
      cpu: { cooked: r1.stats.cooked, cached: r1.stats.cached, hasGpuStats: r1.stats.gpu !== undefined },
      gpuFirst: { cooked: r2.stats.cooked, cached: r2.stats.cached, gpu: r2.stats.gpu, bitExact: bytesEqual(colCpu, attrColumn(r2, "d")) },
      gpuSecond: { cooked: r3.stats.cooked, cached: r3.stats.cached, gpu: r3.stats.gpu },
      cpuAgain: { cooked: r4.stats.cooked, cached: r4.stats.cached, bitExact: bytesEqual(colCpu, attrColumn(r4, "d")) },
    };

    // Plain-value param: no provenance marker, cache survives the toggle.
    const g2 = new Graph(7);
    const din2 = g2.add(dataInput);
    g2.setParam(din2, "items", [makeGeometryItem(makeCorpusGeometry(50))]);
    const sa2 = g2.add(setAttribute);
    g2.setParam(sa2, "name", "d");
    g2.setParam(sa2, "value", 3);
    g2.connect(din2, "out", sa2, "in");
    g2.output(sa2, "out", "out");
    const p1 = await cook(g2);
    const p2 = await cook(g2, { gpu: evaluator });
    out.plainValue = {
      first: { cooked: p1.stats.cooked },
      toggled: { cooked: p2.stats.cooked, cached: p2.stats.cached, gpu: p2.stats.gpu },
    };

    // Fallback equivalence: a code-authored (no-spec) field under a gpu
    // cook must produce byte-identical output to a CPU-only cook, with
    // the reason counted.
    const g3 = new Graph(7);
    const din3 = g3.add(dataInput);
    g3.setParam(din3, "items", [makeGeometryItem(makeCorpusGeometry(50))]);
    const sa3 = g3.add(setAttribute);
    g3.setParam(sa3, "name", "d");
    g3.setParam(sa3, "value", randomField("code-authored"));
    g3.connect(din3, "out", sa3, "in");
    g3.output(sa3, "out", "out");
    const f1 = await cook(g3, { gpu: evaluator });
    const f1Col = attrColumn(f1, "d");
    const g4 = new Graph(7);
    const din4 = g4.add(dataInput);
    g4.setParam(din4, "items", [makeGeometryItem(makeCorpusGeometry(50))]);
    const sa4 = g4.add(setAttribute);
    g4.setParam(sa4, "name", "d");
    g4.setParam(sa4, "value", randomField("code-authored"));
    g4.connect(din4, "out", sa4, "in");
    g4.output(sa4, "out", "out");
    const f2 = await cook(g4);
    out.fallbackEquivalence = {
      gpuCookStats: f1.stats.gpu,
      bitExact: bytesEqual(f1Col, attrColumn(f2, "d")),
    };

    // ...and with the gate ON the same graph resolves on the device AND
    // gains the salt: cooking it CPU-only afterwards must recook rather
    // than serve the device bytes back.
    const wide = new GpuFieldEvaluator(structural, {
      adapterInfo: adapter.info,
      acceptDerivedSpecs: true,
    });
    const g5 = new Graph(7);
    const din5 = g5.add(dataInput);
    g5.setParam(din5, "items", [makeGeometryItem(makeCorpusGeometry(50))]);
    const sa5 = g5.add(setAttribute);
    g5.setParam(sa5, "name", "d");
    g5.setParam(sa5, "value", randomField("code-authored"));
    g5.connect(din5, "out", sa5, "in");
    g5.output(sa5, "out", "out");
    const w1 = await cook(g5, { gpu: wide });
    const w1Col = attrColumn(w1, "d");
    const w2 = await cook(g5, { gpu: wide });
    const w3 = await cook(g5);
    out.derivedAdoption = {
      gpuCookStats: w1.stats.gpu,
      // The hash stream is a bit-exact port, so this expression is one of
      // the populations that does not move at all on the device.
      bitExact: bytesEqual(w1Col, attrColumn(f2, "d")),
      cachedSecondCook: w2.stats.cached,
      recookedWithoutResolver: w3.stats.cooked,
    };
  }

  // -- subgraph forwarding ---------------------------------------------------
  {
    const inner = new Graph(3);
    const din = inner.add(dataInput);
    inner.setParam(din, "items", [makeGeometryItem(makeCorpusGeometry(40))]);
    const sa = inner.add(setAttribute);
    inner.setParam(sa, "name", "d");
    inner.setParam(sa, "value", fieldFromJson(SPEC));
    inner.connect(din, "out", sa, "in");
    const sub = subgraphNode(inner, [], [{ name: "out", node: sa, pin: "out" }]);
    const outer = new Graph(11);
    const wrapped = outer.add(sub);
    outer.output(wrapped, "out", "out");

    const s1 = await cook(outer, { gpu: evaluator });
    const s2 = await cook(outer); // CPU-cooked result must not be served... and vice versa
    const s3 = await cook(outer, { gpu: evaluator });
    const s4 = await cook(outer, { gpu: evaluator });
    out.subgraph = {
      gpuFirst: { cooked: s1.stats.cooked, gpu: s1.stats.gpu, bitExact: bytesEqual(attrColumn(s2, "d"), attrColumn(s1, "d")) },
      cpuToggle: { cooked: s2.stats.cooked },
      gpuAgain: { cooked: s3.stats.cooked, gpu: s3.stats.gpu },
      gpuCached: { cooked: s4.stats.cooked, cached: s4.stats.cached, gpu: s4.stats.gpu },
    };
  }

  // -- World threading -------------------------------------------------------
  {
    const counts = { world: 0, update: 0 };
    // Through `resolverView`, never a hand-written object literal: a
    // wrapper that drops the evaluator's `acceptDerivedSpecs`
    // advertisement would resolve the wide population under narrow keys.
    const countingResolver = (key: keyof typeof counts): GpuFieldResolver =>
      resolverView(evaluator, {
        cacheSalt: evaluator.cacheSalt,
        resolveField: (field, ctx, stats) => {
          counts[key]++;
          return evaluator.resolveField(field, ctx, stats);
        },
      });
    const graph = new Graph(1);
    const din = graph.add(dataInput);
    graph.setParam(din, "items", [makeGeometryItem(makeCorpusGeometry(30))]);
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
          bind: (levelGraph, ctx) => {
            levelGraph.setParam(sa, "seed", ctx.seed);
          },
        },
      ],
      gpu: countingResolver("world"),
    });
    const u1 = await world.update([5, 0, 5]);
    const afterFirst = { world: counts.world, update: counts.update };
    // Second update on a NEW cell (fresh coord → fresh per-cell seed →
    // fresh memo key) with an update-level resolver: it must win over
    // the world-level one. A recook of an unchanged cell would be served
    // from the graph memo cache without consulting any resolver.
    const u2 = await world.update([15, 0, 5], { gpu: countingResolver("update") });
    out.world = {
      firstCooked: u1.cooked.length,
      afterFirst,
      secondCooked: u2.cooked.length,
      afterSecond: { world: counts.world, update: counts.update },
      // Cell [0, 0] was evicted when the viewpoint moved (retain radius);
      // the second update's cell [1, 0] must be stored.
      cellHasAttr: world.getCell("base", [1, 0]) !== undefined,
    };
  }

  process.stdout.write(JSON.stringify(out));
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stdout.write(
      JSON.stringify({ ok: false, error: String(err instanceof Error ? err.stack : err) }),
    );
    process.exit(0);
  },
);
