/**
 * Real-device scenario for `{"fn":"attributeIs"}`: the claim that a
 * literal tested against a STRING column produces the CPU's bytes
 * EXACTLY, and — the half that is not about arithmetic at all — that the
 * literal's string-table index reaches the kernel through a uniform
 * rather than through the WGSL.
 *
 * Four things are measured here and nowhere else:
 *
 * 1. **Exactness, not tolerance.** Both sides compare an integer and emit
 *    0 or 1, so there is no rounding for a budget to absorb and no budget
 *    is offered. Bytes, or the lowering is wrong.
 * 2. **Soundness across two string tables.** The kernel cache key is the
 *    spec key plus each attribute's name/type/tupleSize — it carries no
 *    table CONTENTS — so two geometries with the same attribute signature
 *    SHARE one compiled kernel. This scenario builds two whose tables
 *    order the same literals differently, on purpose, and asserts the
 *    disagreement before asserting the results ignore it. It is the whole
 *    reason the index rides a uniform: a baked one would be the first
 *    geometry's, served silently to the second.
 * 3. **The two ways a lane legitimately says zero.** A literal the table
 *    does not hold (`-1` in the slot, which no index equals) and a literal
 *    the table DOES hold but only at component 1 of a tuple column (the
 *    stride). The first must also leave the table untouched: resolving a
 *    field must never edit the geometry it reads, which is why the fill
 *    calls `lookupString` and not `internString`.
 * 4. **The fused run declining.** Plan time has no geometry, so there is
 *    no table to resolve an index against; the run rejects with the
 *    existing `"run-plan-failed"` reason and its members cook per-node,
 *    where the same field DOES resolve on the device. Declining loudly is
 *    the pillar; producing something else quietly is what it forbids.
 *
 * Test-only: bundled by attributeIs.device.test.ts with esbuild and
 * executed in a plain Node child process (see deviceRunner.mjs for why no
 * vitest worker may touch Dawn), reporting observations as JSON on
 * stdout.
 */
import { create } from "webgpu";
import { Geometry } from "../data/index.js";
import { type Column, createGpuCookStats, evaluateField } from "../fields/index.js";
import { fieldFromJson, type FieldSpec } from "../fields/fieldJson.js";
import { type CookResult, Graph, cook, makeGeometryItem } from "../graph/index.js";
import { setAttribute } from "../nodes/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import { dataInput } from "../runtime/dataInput.js";
import type { GpuDeviceLike } from "./device.js";
import { GpuFieldEvaluator } from "./evaluator.js";
import { makeParityGeometry } from "./testGeometry.js";

const EXACT_COUNT = 4096;
const CELL_COUNT = 2048;
const TAGS_COUNT = 1024;
const FUSED_COUNT = 4096;
const SEED = 11;

/**
 * A point cloud whose `species` column is written in element order, so
 * the callback fixes the string table's index order (first encounter
 * wins) as well as the data — the same freedom a filter or a merge
 * exercises upstream, which is what {@link main}'s soundness case needs.
 *
 * `P` is hash-derived rather than absent so the geometry is a plausible
 * one and the kernel layout is more than a single column; it is never
 * read by the fields here. No `Math.random`: determinism is a hard
 * invariant, fixtures included.
 */
function speciesCell(count: number, species: (i: number) => string): Geometry {
  const geo = new Geometry();
  const set = geo.attrs.point;
  const P = set.add("P", "f32", 3);
  const attr = set.add("species", "string", 1);
  set.resize(count);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) P.data[i * 3 + k] = (hashFloat(hashCombine(707, i, k)) - 0.5) * 8;
    attr.setString(i, species(i));
  }
  return geo;
}

/**
 * A TUPLE-valued string column: component 0 carries part names, component
 * 1 seasons, and no value appears in both. The predicate reads component
 * 0 only (as `Attribute.getString` does), so a season is the case a
 * stride-free kernel gets wrong on every second lane — while being a real
 * table entry, which is what separates this from the absent-literal case.
 */
function tagsGeometry(count: number): Geometry {
  const geo = new Geometry();
  const set = geo.attrs.point;
  const P = set.add("P", "f32", 3);
  const tags = set.add("tags", "string", 2);
  set.resize(count);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) P.data[i * 3 + k] = (hashFloat(hashCombine(808, i, k)) - 0.5) * 8;
    tags.setString(i, i % 2 === 0 ? "trunk" : "branch", 0);
    tags.setString(i, i % 3 === 0 ? "summer" : "winter", 1);
  }
  return geo;
}

function bytesOf(col: Column): Uint8Array {
  return new Uint8Array(col.data.buffer, col.data.byteOffset, col.data.byteLength);
}

/** Byte-for-byte column equality, element type and tuple size included. */
function bytesEqual(a: Column, b: Column): boolean {
  if (a.tupleSize !== b.tupleSize) return false;
  if (a.data.constructor !== b.data.constructor) return false;
  const ab = bytesOf(a);
  const bb = bytesOf(b);
  if (ab.length !== bb.length) return false;
  for (let i = 0; i < ab.length; i++) if (ab[i] !== bb[i]) return false;
  return true;
}

function attrBytesEqual(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  const ab = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const bb = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < ab.length; i++) if (ab[i] !== bb[i]) return false;
  return true;
}

/**
 * Lanes that came back 1. Reported so a column of all zeros — which every
 * bit-exactness check here would happily accept, since the CPU would
 * agree — cannot pass for a working predicate.
 */
function countOnes(data: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < data.length; i++) if (data[i] === 1) n++;
  return n;
}

function allZeros(data: ArrayLike<number>): boolean {
  for (let i = 0; i < data.length; i++) if (data[i] !== 0) return false;
  return true;
}

const isPineSpec: FieldSpec = { fn: "attributeIs", name: "species", value: "pine" };

async function main(): Promise<void> {
  const gpu = create([]);
  const adapter = await gpu.requestAdapter();
  if (adapter === null) {
    process.stdout.write(JSON.stringify({ ok: false, error: "no WebGPU adapter" }));
    return;
  }
  const device = (await adapter.requestDevice()) as unknown as GpuDeviceLike;

  // -- a. exactness, on the shared parity fixture ---------------------------
  // `makeParityGeometry` cycles pine/oak/birch, so a third of the lanes
  // match and the mismatching two thirds are a mix rather than all one
  // value — a column of zeros or of ones would be indistinguishable from
  // a broken predicate that the CPU happened to agree with.
  const exactEv = new GpuFieldEvaluator(device);
  const exactStats = createGpuCookStats();
  const exactGeo = makeParityGeometry(EXACT_COUNT);
  const exactCtx = { geo: exactGeo, domain: "point" as const, seed: SEED };
  const exactField = fieldFromJson(isPineSpec);
  const exactPromise = exactEv.resolveField(exactField, exactCtx, exactStats);
  const exactCpu = evaluateField(exactField, exactCtx);
  const exactGpu = exactPromise === null ? null : await exactPromise;
  const exact = {
    resolved: exactPromise !== null,
    // No tolerance, deliberately: an integer comparison emitting 0 or 1
    // has nothing to round, so anything but the same bytes is a defect.
    bitExact: exactGpu !== null && bytesEqual(exactCpu, exactGpu),
    dispatches: exactStats.dispatches,
    fallbacks: exactStats.fallbacks,
    count: EXACT_COUNT,
    gpuOnes: exactGpu === null ? -1 : countOnes(exactGpu.data),
    cpuOnes: countOnes(exactCpu.data),
  };

  // -- b. the soundness case: two tables that disagree ----------------------
  // Built to disagree rather than hoped to: A writes an oak first and B a
  // pine, so "pine" interns at a different index in each while the
  // attribute SIGNATURE (P f32x3, species stringx1) and the element count
  // stay identical — which is exactly the condition under which the two
  // share one cached kernel. The per-element species differ too, so the
  // two correct answers differ and "B got A's column" is not a way to
  // pass.
  const cellA = speciesCell(CELL_COUNT, (i) => (i % 2 === 0 ? "oak" : "pine"));
  const cellB = speciesCell(CELL_COUNT, (i) => (i % 3 === 0 ? "pine" : "oak"));
  const tableA = [...cellA.attrs.point.require("species").stringTable];
  const tableB = [...cellB.attrs.point.require("species").stringTable];
  const ctxA = { geo: cellA, domain: "point" as const, seed: SEED };
  const ctxB = { geo: cellB, domain: "point" as const, seed: SEED };
  // ONE evaluator and ONE field object, so the second resolve can only
  // reach the device through the kernel the first one cached.
  const cellEv = new GpuFieldEvaluator(device);
  const cellStats = createGpuCookStats();
  const cellField = fieldFromJson(isPineSpec);
  const promiseA = cellEv.resolveField(cellField, ctxA, cellStats);
  const gpuA = promiseA === null ? null : await promiseA;
  const promiseB = cellEv.resolveField(cellField, ctxB, cellStats);
  const gpuB = promiseB === null ? null : await promiseB;
  const cpuA = evaluateField(cellField, ctxA);
  const cpuB = evaluateField(cellField, ctxB);
  const soundness = {
    // The premise, asserted rather than assumed: if these two indices
    // ever coincide the case has stopped testing the thing it exists for.
    pineIndexA: tableA.indexOf("pine"),
    pineIndexB: tableB.indexOf("pine"),
    tableA,
    tableB,
    resolvedA: promiseA !== null,
    resolvedB: promiseB !== null,
    aBitExact: gpuA !== null && bytesEqual(cpuA, gpuA),
    bBitExact: gpuB !== null && bytesEqual(cpuB, gpuB),
    // The geometries hold different data, so identical columns would mean
    // one of them was answered with the other's kernel state.
    devicesDiffer: gpuA !== null && gpuB !== null && !bytesEqual(gpuA, gpuB),
    aOnes: gpuA === null ? -1 : countOnes(gpuA.data),
    bOnes: gpuB === null ? -1 : countOnes(gpuB.data),
    // The sharing itself. WITH the index baked into the WGSL these
    // numbers would be exactly the same — one kernel, one pipeline, one
    // compile — and B would have been answered with A's constant, failing
    // `bBitExact` instead. That pairing is what makes the case
    // discriminating: the cache assertions establish that the kernel was
    // genuinely shared, so the parity assertions can only be satisfied by
    // a per-dispatch index.
    kernelCacheSize: cellEv.kernelCacheSize,
    pipelineCacheSize: cellEv.pipelineCacheSize,
    pipelinesCompiled: cellStats.pipelinesCompiled,
    dispatches: cellStats.dispatches,
    fallbacks: cellStats.fallbacks,
  };

  // -- c. a literal the table does not hold ---------------------------------
  // Zeros, not an error: each cell of a partitioned world cooks its own
  // geometry, so a cell holding no birches legitimately has no "birch" in
  // its table, and the slot takes -1 (no index equals it).
  const absentGeo = speciesCell(CELL_COUNT, (i) => (i % 2 === 0 ? "pine" : "oak"));
  const absentAttr = absentGeo.attrs.point.require("species");
  const absentCtx = { geo: absentGeo, domain: "point" as const, seed: SEED };
  const absentField = fieldFromJson({ fn: "attributeIs", name: "species", value: "birch" });
  const absentBefore = [...absentAttr.stringTable];
  const absentEv = new GpuFieldEvaluator(device);
  const absentStats = createGpuCookStats();
  let absentThrew: string | null = null;
  let absentGpu: Column | null = null;
  let absentResolved = false;
  try {
    const promise = absentEv.resolveField(absentField, absentCtx, absentStats);
    absentResolved = promise !== null;
    if (promise !== null) absentGpu = await promise;
  } catch (err: unknown) {
    absentThrew = err instanceof Error ? err.message : String(err);
  }
  // Captured between the two evaluations so the device fill is the only
  // thing that could have edited the table — the guard against
  // `internString` creeping back onto this path, whose damage is
  // invisible until the next `copyFrom` compacts and renumbers.
  const absentAfterDevice = [...absentAttr.stringTable];
  const absentCpu = evaluateField(absentField, absentCtx);
  const absent = {
    resolved: absentResolved,
    threw: absentThrew,
    bitExact: absentGpu !== null && bytesEqual(absentCpu, absentGpu),
    allZeros: absentGpu !== null && allZeros(absentGpu.data),
    cpuAllZeros: allZeros(absentCpu.data),
    fallbacks: absentStats.fallbacks,
    tableBefore: absentBefore,
    tableAfterDevice: absentAfterDevice,
    tableAfterCpu: [...absentAttr.stringTable],
  };

  // -- d. the stride --------------------------------------------------------
  const tagsGeo = tagsGeometry(TAGS_COUNT);
  const tagsCtx = { geo: tagsGeo, domain: "point" as const, seed: SEED };
  const tagsTable = [...tagsGeo.attrs.point.require("tags").stringTable];
  const tagsEv = new GpuFieldEvaluator(device);
  const tagsStats = createGpuCookStats();
  const readTags = async (value: string) => {
    const field = fieldFromJson({ fn: "attributeIs", name: "tags", value });
    const promise = tagsEv.resolveField(field, tagsCtx, tagsStats);
    const gpuColumn = promise === null ? null : await promise;
    const cpuColumn = evaluateField(field, tagsCtx);
    return {
      resolved: promise !== null,
      bitExact: gpuColumn !== null && bytesEqual(cpuColumn, gpuColumn),
      allZeros: gpuColumn !== null && allZeros(gpuColumn.data),
      gpuOnes: gpuColumn === null ? -1 : countOnes(gpuColumn.data),
      cpuOnes: countOnes(cpuColumn.data),
    };
  };
  const stride = {
    // "summer" is a genuine table entry that only ever sits at component
    // 1, so its zeros are the stride's doing and not an absent literal's —
    // the two look identical in the output column and must not be
    // conflated.
    componentOneValueInTable: tagsTable.includes("summer"),
    componentOne: await readTags("summer"),
    componentZero: await readTags("trunk"),
    // Every second element carries "trunk" at component 0.
    expectedComponentZeroOnes: Math.ceil(TAGS_COUNT / 2),
    table: tagsTable,
    count: TAGS_COUNT,
    fallbacks: tagsStats.fallbacks,
  };

  // -- e. the fused run declines --------------------------------------------
  // A chain that fuses when its field params are ordinary (two
  // setAttribute members over a dataInput is the shape the param suite
  // measures a resident run with), made unfusable by one thing only: the
  // literal's index is a property of the geometry, and plan time has none.
  const fusedGraph = (): Graph => {
    const g = new Graph(5);
    const din = g.add(dataInput);
    g.setParam(din, "items", [makeGeometryItem(makeParityGeometry(FUSED_COUNT))]);
    const a = g.add(setAttribute, { name: "isPine", value: fieldFromJson(isPineSpec) });
    const b = g.add(setAttribute, {
      name: "scaled",
      value: fieldFromJson({
        fn: "mul",
        args: [{ fn: "attribute", name: "density" }, { fn: "attributeIs", name: "species", value: "oak" }],
      }),
    });
    g.connect(din, "out", a, "in");
    g.connect(a, "out", b, "in");
    g.output(b, "out", "out");
    return g;
  };
  const readAttrs = (result: CookResult): Record<string, Float32Array> => {
    const item = result.outputs.out[0];
    if (item.kind !== "geometry") throw new Error("attributeIs scenario: expected a geometry item");
    const set = item.geo.attrs.point;
    return {
      isPine: (set.require("isPine").data as Float32Array).slice(0, FUSED_COUNT),
      scaled: (set.require("scaled").data as Float32Array).slice(0, FUSED_COUNT),
    };
  };
  const fusedEv = new GpuFieldEvaluator(device);
  const fusedCook = await cook(fusedGraph(), { gpu: fusedEv });
  const fusedStats = fusedCook.stats.gpu ?? createGpuCookStats();
  const cpuRun = readAttrs(await cook(fusedGraph()));
  const gpuRun = readAttrs(fusedCook);
  const fused = {
    residentRuns: fusedStats.residentRuns,
    fusedNodes: fusedStats.fusedNodes,
    // The machine-readable reason, which is the point: it declines and
    // SAYS SO, rather than silently computing something else.
    fallbacks: fusedStats.fallbacks,
    // ...and the members still cook, on the per-node device path, where
    // the same field resolves against the geometry in hand.
    isPineBitExact: attrBytesEqual(cpuRun.isPine, gpuRun.isPine),
    scaledBitExact: attrBytesEqual(cpuRun.scaled, gpuRun.scaled),
    isPineOnes: countOnes(gpuRun.isPine),
    count: FUSED_COUNT,
  };

  process.stdout.write(JSON.stringify({ ok: true, exact, soundness, absent, stride, fused }));
}

main().catch((err: unknown) => {
  process.stdout.write(
    JSON.stringify({ ok: false, error: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) }),
  );
});
