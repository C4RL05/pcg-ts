/**
 * Real-device scenario for `{"fn":"byAttribute"}`: the N-way form of
 * `attributeIs`, whose case KEYS are not numbers at all but indices into a
 * string table that belongs to ONE geometry — N of them now, one uniform
 * slot each, drawn from the same `AttrIsSlot` plan under the same
 * `attrIsKey`.
 *
 * Seven things are measured here and nowhere else:
 *
 * 1. **Exactness, not tolerance.** Both sides compare an integer and then
 *    SELECT between values; there is no arithmetic interior for a budget
 *    to absorb and none is offered. Bytes, or the lowering is wrong. The
 *    case values are distinct constants precisely so the output column
 *    names, per lane, which branch fired.
 * 2. **Soundness across two string tables that disagree in MEMBERSHIP and
 *    in INDEX ORDER.** The kernel cache key is the spec key plus each
 *    attribute's name/type/tupleSize — no table CONTENTS — so two
 *    geometries with the same attribute signature SHARE one compiled
 *    kernel. This scenario builds the disagreement on purpose and asserts
 *    it before concluding anything from it. It is the whole reason each
 *    key's index rides a uniform: baked ones would be the first geometry's
 *    N constants, served silently to the second.
 * 3. **An absent case key takes the DEFAULT.** Not zeros, not an error:
 *    each cell of a partitioned world cooks its own geometry, so a cell
 *    holding no birches legitimately has no `"birch"` in its table and the
 *    slot takes -1, which no index equals. And resolving must not EDIT the
 *    geometry it reads, so the table is captured before and after.
 * 4. **The tuple stride.** A tuple-valued string column is read at
 *    component 0 (as `Attribute.getString` defaults), so a value that only
 *    ever sits at component 1 matches nothing and every lane takes the
 *    default — while being a genuine table entry, which is what separates
 *    this from case 3. This is the exact defect `attributeIs` had in its
 *    first sketch.
 * 5. **Scalar-default broadcast against tuple cases.** The output width is
 *    a property of the EXPRESSION, never of which case fired, so a scalar
 *    default under vec3 cases must come back splatted to vec3.
 * 6. **The fused run declining.** Plan time carries descriptors and a
 *    count, not data, so there is no table to resolve N indices against;
 *    the run rejects with the existing `"run-plan-failed"` reason and its
 *    members cook per-node, where the same field DOES resolve.
 * 7. **Slot sharing.** A `byAttribute` case and an `attributeIs` on the
 *    same (attribute, literal) pair are ONE slot, because both go into the
 *    same map under the same key. Measured against the two halves compiled
 *    alone, so "2" is a saving rather than a coincidence.
 *
 * Test-only: bundled by byAttribute.device.test.ts with esbuild and
 * executed in a plain Node child process (see deviceRunner.mjs for why no
 * vitest worker may touch Dawn), reporting observations as JSON on stdout.
 */
import { create } from "webgpu";
import { Geometry } from "../data/index.js";
import { type Column, createGpuCookStats, evaluateField } from "../fields/index.js";
import { type FieldSpec, fieldFromJson } from "../fields/fieldJson.js";
import { type CookResult, Graph, cook, makeGeometryItem } from "../graph/index.js";
import { setAttribute } from "../nodes/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import { dataInput } from "../runtime/dataInput.js";
import { compileFieldSpec } from "./compile.js";
import type { GpuDeviceLike } from "./device.js";
import { GpuFieldEvaluator } from "./evaluator.js";
import { makeParityGeometry } from "./testGeometry.js";
import type { FieldKernelLayout } from "./types.js";

const EXACT_COUNT = 4096;
const CELL_COUNT = 2048;
const TAGS_COUNT = 1024;
const WIDTH_COUNT = 1536;
const FUSED_COUNT = 4096;
const SEED = 11;

/**
 * A point cloud whose `species` column is written in element order, so the
 * callback fixes the string table's index order (first encounter wins) as
 * well as the data — the same freedom a filter or a merge exercises
 * upstream, which is what {@link main}'s soundness case needs.
 *
 * `P` is hash-derived rather than absent so the geometry is a plausible
 * one and the kernel layout is more than a single column; it is never read
 * by the fields here. No `Math.random`: determinism is a hard invariant,
 * fixtures included.
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
 * 1 seasons, and no value appears in both. `byAttribute` selects on
 * component 0 only, so a case set keyed by SEASONS must fall through to
 * the default on every lane — while every one of its keys is a real table
 * entry, which is what separates this from the absent-key case.
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
 * How many lanes carry each distinct value. Reported instead of a bare
 * "not all zeros" because the case values here are distinct constants: the
 * histogram says which BRANCH fired on how many lanes, so a kernel that
 * selected the default everywhere — which every bit-exactness check would
 * accept if the CPU agreed — cannot pass for a working selection.
 */
function valueCounts(data: ArrayLike<number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < data.length; i++) {
    const k = String(data[i]);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** The `size` components of element `i`, for a splat / width assertion. */
function elementAt(col: Column, i: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < col.tupleSize; k++) out.push(col.data[i * col.tupleSize + k]);
  return out;
}

/** `attr == value` per slot, sorted, so the pair set can be asserted directly. */
function describeSlots(slots: readonly { attr: string; value: string }[]): string[] {
  return slots.map((s) => `${s.attr}==${s.value}`).sort();
}

/** pine 10, oak 20, everything else 99 — three constants, three answers. */
const KIND_SPEC: FieldSpec = {
  fn: "byAttribute",
  name: "species",
  cases: { pine: 10, oak: 20 },
  default: 99,
};

async function main(): Promise<void> {
  const gpu = create([]);
  const adapter = await gpu.requestAdapter();
  if (adapter === null) {
    process.stdout.write(JSON.stringify({ ok: false, error: "no WebGPU adapter" }));
    return;
  }
  const device = (await adapter.requestDevice()) as unknown as GpuDeviceLike;

  // -- a. exactness, on the shared parity fixture ---------------------------
  // The fixture cycles pine/oak/birch from element 0, so all three branches
  // fire: pine -> 10, oak -> 20, birch -> the default 99. Distinct
  // constants, so the column is a per-lane transcript of which branch the
  // kernel chose and the histogram below cannot be satisfied by a kernel
  // that always picked one.
  const exactEv = new GpuFieldEvaluator(device);
  const exactStats = createGpuCookStats();
  const exactGeo = makeParityGeometry(EXACT_COUNT);
  const exactCtx = { geo: exactGeo, domain: "point" as const, seed: SEED };
  const exactField = fieldFromJson(KIND_SPEC);
  const exactPromise = exactEv.resolveField(exactField, exactCtx, exactStats);
  const exactCpu = evaluateField(exactField, exactCtx);
  const exactGpu = exactPromise === null ? null : await exactPromise;
  const exact = {
    resolved: exactPromise !== null,
    // No tolerance, deliberately: an integer comparison feeding a select
    // between constants has nothing to round, so anything but the same
    // bytes is a defect.
    bitExact: exactGpu !== null && bytesEqual(exactCpu, exactGpu),
    dispatches: exactStats.dispatches,
    fallbacks: exactStats.fallbacks,
    count: EXACT_COUNT,
    gpuCounts: exactGpu === null ? {} : valueCounts(exactGpu.data),
    cpuCounts: valueCounts(exactCpu.data),
  };

  // -- b. the soundness case: two tables that disagree ----------------------
  // Built to disagree rather than hoped to, in BOTH ways that matter:
  //
  //   A = ["", "oak", "pine", "spruce"]   (no "cedar"; oak 1, pine 2)
  //   B = ["", "pine", "cedar", "oak"]    (no "spruce"; pine 1, oak 3)
  //
  // MEMBERSHIP differs (each holds a species the other does not) and INDEX
  // ORDER differs (every shared species sits at a different index). The
  // attribute SIGNATURE — P f32x3, species stringx1 — and the element
  // count stay identical, which is exactly the condition under which the
  // two share one cached kernel. The per-element species differ too, so
  // the two correct answers differ and "B got A's column" is not a way to
  // pass.
  const cellA = speciesCell(CELL_COUNT, (i) =>
    i % 3 === 0 ? "oak" : i % 3 === 1 ? "pine" : "spruce",
  );
  const cellB = speciesCell(CELL_COUNT, (i) =>
    i % 3 === 0 ? "pine" : i % 3 === 1 ? "cedar" : "oak",
  );
  const tableA = [...cellA.attrs.point.require("species").stringTable];
  const tableB = [...cellB.attrs.point.require("species").stringTable];
  const ctxA = { geo: cellA, domain: "point" as const, seed: SEED };
  const ctxB = { geo: cellB, domain: "point" as const, seed: SEED };
  // ONE evaluator and ONE field object, so the second resolve can only
  // reach the device through the kernel the first one cached.
  const cellEv = new GpuFieldEvaluator(device);
  const cellStats = createGpuCookStats();
  // Three cases and a default over two tables that agree about none of
  // them: "cedar" is absent from A entirely, and pine/oak swap places.
  const cellField = fieldFromJson({
    fn: "byAttribute",
    name: "species",
    cases: { pine: 10, oak: 20, cedar: 30 },
    default: 99,
  });
  const promiseA = cellEv.resolveField(cellField, ctxA, cellStats);
  const gpuA = promiseA === null ? null : await promiseA;
  const promiseB = cellEv.resolveField(cellField, ctxB, cellStats);
  const gpuB = promiseB === null ? null : await promiseB;
  const cpuA = evaluateField(cellField, ctxA);
  const cpuB = evaluateField(cellField, ctxB);
  // The counterfactual, MEASURED rather than argued: the column B would
  // have come back with had the case keys been resolved once against A's
  // table and baked into the WGSL. A holds pine at 2 and oak at 1 and has
  // no cedar at all, so those constants applied to B's indices route B's
  // cedars (2) to pine's value, B's pines (1) to oak's, and B's oaks (3)
  // to the default. Computed here so the test can assert it DIFFERS from
  // what the device returned — without it, "the uniform is per-dispatch"
  // rests on the argument that a baked one would be wrong instead of on
  // the demonstration that it would.
  const bakedForB = (() => {
    const raw = cellB.attrs.point.require("species").data;
    const byIndex = new Map<number, number>([
      [tableA.indexOf("pine"), 10],
      [tableA.indexOf("oak"), 20],
      // "cedar" resolves to -1 against A and matches no index in B.
      [tableA.indexOf("cedar"), 30],
    ]);
    const out = new Float32Array(CELL_COUNT);
    for (let i = 0; i < CELL_COUNT; i++) out[i] = byIndex.get(raw[i]) ?? 99;
    return { data: out, tupleSize: 1 } as Column;
  })();
  const soundness = {
    // The premise, asserted rather than assumed: if these tables ever
    // agreed the case would pass while testing nothing.
    tableA,
    tableB,
    pineIndexA: tableA.indexOf("pine"),
    pineIndexB: tableB.indexOf("pine"),
    oakIndexA: tableA.indexOf("oak"),
    oakIndexB: tableB.indexOf("oak"),
    cedarIndexA: tableA.indexOf("cedar"),
    cedarIndexB: tableB.indexOf("cedar"),
    resolvedA: promiseA !== null,
    resolvedB: promiseB !== null,
    aBitExact: gpuA !== null && bytesEqual(cpuA, gpuA),
    bBitExact: gpuB !== null && bytesEqual(cpuB, gpuB),
    // The geometries hold different data, so identical columns would mean
    // one of them was answered with the other's kernel state.
    devicesDiffer: gpuA !== null && gpuB !== null && !bytesEqual(gpuA, gpuB),
    aCounts: gpuA === null ? {} : valueCounts(gpuA.data),
    bCounts: gpuB === null ? {} : valueCounts(gpuB.data),
    // A baked lowering is not merely suspected of being wrong here, it is
    // shown to be: this is the column it would have produced, and it is
    // not the one that came back.
    bakedBCounts: valueCounts(bakedForB.data),
    bakedBWouldDiffer: gpuB !== null && !bytesEqual(bakedForB, gpuB),
    // The sharing itself. WITH the indices baked into the WGSL these
    // numbers would be exactly the same — one kernel, one pipeline, one
    // compile — and B would have been answered with A's three constants,
    // failing `bBitExact` instead. That pairing is what makes the case
    // discriminating: the cache assertions establish that the kernel was
    // genuinely shared, so the parity assertions can only be satisfied by
    // per-dispatch indices.
    kernelCacheSize: cellEv.kernelCacheSize,
    pipelineCacheSize: cellEv.pipelineCacheSize,
    pipelinesCompiled: cellStats.pipelinesCompiled,
    dispatches: cellStats.dispatches,
    fallbacks: cellStats.fallbacks,
    count: CELL_COUNT,
  };

  // -- c. a case key the table does not hold --------------------------------
  // The DEFAULT, not zeros and not an error. This geometry holds pine and
  // oak; the case set names pine and birch, so every oak lane falls
  // through to 99 and no lane ever reads 20. `-1` in birch's slot is an
  // index nothing equals, which is the whole mechanism.
  const absentGeo = speciesCell(CELL_COUNT, (i) => (i % 2 === 0 ? "pine" : "oak"));
  const absentAttr = absentGeo.attrs.point.require("species");
  const absentCtx = { geo: absentGeo, domain: "point" as const, seed: SEED };
  const absentField = fieldFromJson({
    fn: "byAttribute",
    name: "species",
    cases: { pine: 10, birch: 20 },
    default: 99,
  });
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
  // `internString` creeping onto this path, whose damage is invisible
  // until the next `copyFrom` compacts and renumbers.
  const absentAfterDevice = [...absentAttr.stringTable];
  const absentCpu = evaluateField(absentField, absentCtx);
  const absent = {
    resolved: absentResolved,
    threw: absentThrew,
    bitExact: absentGpu !== null && bytesEqual(absentCpu, absentGpu),
    fallbacks: absentStats.fallbacks,
    gpuCounts: absentGpu === null ? {} : valueCounts(absentGpu.data),
    cpuCounts: valueCounts(absentCpu.data),
    tableBefore: absentBefore,
    tableAfterDevice: absentAfterDevice,
    tableAfterCpu: [...absentAttr.stringTable],
    count: CELL_COUNT,
  };

  // -- d. the stride --------------------------------------------------------
  const tagsGeo = tagsGeometry(TAGS_COUNT);
  const tagsCtx = { geo: tagsGeo, domain: "point" as const, seed: SEED };
  const tagsTable = [...tagsGeo.attrs.point.require("tags").stringTable];
  const tagsEv = new GpuFieldEvaluator(device);
  const tagsStats = createGpuCookStats();
  const readTags = async (cases: Record<string, number>) => {
    const field = fieldFromJson({ fn: "byAttribute", name: "tags", cases, default: 99 });
    const promise = tagsEv.resolveField(field, tagsCtx, tagsStats);
    const gpuColumn = promise === null ? null : await promise;
    const cpuColumn = evaluateField(field, tagsCtx);
    return {
      resolved: promise !== null,
      bitExact: gpuColumn !== null && bytesEqual(cpuColumn, gpuColumn),
      gpuCounts: gpuColumn === null ? {} : valueCounts(gpuColumn.data),
      cpuCounts: valueCounts(cpuColumn.data),
    };
  };
  const stride = {
    // The distinction this case exists to make: both season keys ARE table
    // entries, so their fall-through is the stride's doing and not an
    // absent key's. The two are indistinguishable in the output column.
    seasonsInTable: tagsTable.includes("summer") && tagsTable.includes("winter"),
    table: tagsTable,
    // Keyed by component 1's vocabulary: must match NOTHING.
    componentOne: await readTags({ summer: 5, winter: 6 }),
    // The other half, without which "all default" would also be satisfied
    // by a kernel that matched nothing at all.
    componentZero: await readTags({ trunk: 5, branch: 6 }),
    expectedTrunk: Math.ceil(TAGS_COUNT / 2),
    expectedBranch: Math.floor(TAGS_COUNT / 2),
    count: TAGS_COUNT,
    fallbacks: tagsStats.fallbacks,
  };

  // -- e. scalar default broadcast against tuple cases ----------------------
  // The output width is a property of the EXPRESSION and never of the
  // data, so the scalar default must come back SPLATTED to vec3 rather
  // than as a scalar column or a (7,0,0).
  const widthGeo = makeParityGeometry(WIDTH_COUNT);
  const widthCtx = { geo: widthGeo, domain: "point" as const, seed: SEED };
  const widthField = fieldFromJson({
    fn: "byAttribute",
    name: "species",
    cases: { pine: [1, 2, 3], oak: [4, 5, 6] },
    default: 7,
  });
  const widthEv = new GpuFieldEvaluator(device);
  const widthStats = createGpuCookStats();
  const widthPromise = widthEv.resolveField(widthField, widthCtx, widthStats);
  const widthGpu = widthPromise === null ? null : await widthPromise;
  const widthCpu = evaluateField(widthField, widthCtx);
  // The fixture cycles pine/oak/birch from element 0, so lanes 0/1/2 are
  // one of each: the first two name a tuple case, the third falls through.
  const width = {
    resolved: widthPromise !== null,
    bitExact: widthGpu !== null && bytesEqual(widthCpu, widthGpu),
    fallbacks: widthStats.fallbacks,
    gpuTupleSize: widthGpu === null ? -1 : widthGpu.tupleSize,
    cpuTupleSize: widthCpu.tupleSize,
    gpuLength: widthGpu === null ? -1 : widthGpu.data.length,
    pineLane: widthGpu === null ? [] : elementAt(widthGpu, 0),
    oakLane: widthGpu === null ? [] : elementAt(widthGpu, 1),
    defaultLane: widthGpu === null ? [] : elementAt(widthGpu, 2),
    count: WIDTH_COUNT,
  };

  // -- f. the fused run declines --------------------------------------------
  // A chain that fuses when its field params are ordinary (two
  // setAttribute members over a dataInput is the shape the param suite
  // measures a resident run with), made unfusable by one thing only: every
  // case key's index is a property of the geometry, and plan time has none.
  const fusedGraph = (): Graph => {
    const g = new Graph(5);
    const din = g.add(dataInput);
    g.setParam(din, "items", [makeGeometryItem(makeParityGeometry(FUSED_COUNT))]);
    const a = g.add(setAttribute, { name: "kind", value: fieldFromJson(KIND_SPEC) });
    const b = g.add(setAttribute, {
      name: "scaled",
      value: fieldFromJson({
        fn: "mul",
        args: [
          { fn: "attribute", name: "density" },
          { fn: "byAttribute", name: "species", cases: { oak: 2, birch: 3 }, default: 1 },
        ],
      }),
    });
    g.connect(din, "out", a, "in");
    g.connect(a, "out", b, "in");
    g.output(b, "out", "out");
    return g;
  };
  const readAttrs = (result: CookResult): Record<string, Float32Array> => {
    const item = result.outputs.out[0];
    if (item.kind !== "geometry") throw new Error("byAttribute scenario: expected a geometry item");
    const set = item.geo.attrs.point;
    return {
      kind: (set.require("kind").data as Float32Array).slice(0, FUSED_COUNT),
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
    kindBitExact: attrBytesEqual(cpuRun.kind, gpuRun.kind),
    scaledBitExact: attrBytesEqual(cpuRun.scaled, gpuRun.scaled),
    kindCounts: valueCounts(gpuRun.kind),
    count: FUSED_COUNT,
  };

  // -- g. slot sharing ------------------------------------------------------
  // `computeParamPlan` files a `byAttribute` case and an `attributeIs`
  // under the same `attrIsKey(name, value)`, so the (species, pine) pair
  // costs ONE slot however many fns want it. Compiled alone alongside the
  // combined spec, so 2 reads as a saving against 1 + 2 rather than as a
  // number that happens to be right.
  const slotLayout: FieldKernelLayout = {
    attributes: { species: { type: "string", tupleSize: 1 } },
  };
  const isPineSpec: FieldSpec = { fn: "attributeIs", name: "species", value: "pine" };
  const sharedSpec: FieldSpec = { fn: "add", args: [isPineSpec, KIND_SPEC] };
  const sharedKernel = compileFieldSpec(sharedSpec, slotLayout);
  const isPineKernel = compileFieldSpec(isPineSpec, slotLayout);
  const byAttrKernel = compileFieldSpec(KIND_SPEC, slotLayout);
  const slots = {
    sharedCount: sharedKernel.attrIsSlots.length,
    sharedPairs: describeSlots(sharedKernel.attrIsSlots),
    sharedConstSlots: sharedKernel.constSlots,
    attributeIsAloneCount: isPineKernel.attrIsSlots.length,
    byAttributeAloneCount: byAttrKernel.attrIsSlots.length,
    // The WGSL must carry no table index: the slot numbers appear, the
    // resolved indices never do. Reported so the test can look.
    sharedWgslMentionsConsts: sharedKernel.wgsl.includes("params.consts["),
  };

  process.stdout.write(
    JSON.stringify({ ok: true, exact, soundness, absent, stride, width, fused, slots }),
  );
}

main().catch((err: unknown) => {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: err instanceof Error ? `${err.message}\n${err.stack}` : String(err),
    }),
  );
});
