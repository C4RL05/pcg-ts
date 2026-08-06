/**
 * Real-device scenario for phase 23: device-resident (fused) runs. Every
 * apply-kernel variant the codegen can emit is pushed through the WGSL
 * front end, then chains of 2-8 fusable nodes are cooked three ways (CPU
 * / per-node GPU / fused) and compared attribute by attribute, plus
 * semantic spot-checks, determinism, chunk seams, budget slicing,
 * cancellation, plan rejections, passthrough fidelity, the resident
 * memory bound, and stats/pipeline-cache semantics.
 *
 * Test-only: bundled by resident.device.test.ts (esbuild) and executed
 * in a plain Node child process — Dawn is unstable inside vitest workers
 * (see deviceRunner.mjs) — reporting JSON observations on stdout for the
 * vitest side to assert.
 */
import { create } from "webgpu";
import { Geometry, createTriangleMesh, type AttrType } from "../data/index.js";
import {
  CookCancelledError,
  Graph,
  cook,
  makeGeometryItem,
  type CookResult,
  type NodeDef,
} from "../graph/index.js";
import { deriveNodeSeed } from "../graph/graph.js";
import type {
  Field,
  GpuCookStats,
  GpuFieldResolver,
  ResidentMemberDesc,
} from "../fields/index.js";
import { createGpuCookStats } from "../fields/index.js";
import { fieldFromJson, type FieldSpec } from "../nodes/fieldJson.js";
import {
  jitterPoints,
  orientAlongVector,
  setAttribute,
  setBounds,
  transformPoints,
} from "../nodes/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import { dataInput } from "../runtime/dataInput.js";
import {
  makeJitterPointsApply,
  makeOrientApply,
  makeSetAttributeApply,
  makeTransformPointsApply,
  type ApplyColRef,
  type ApplyConstRef,
  type ApplyKernel,
  type ApplyParamRef,
} from "./applyKernels.js";
import type { GpuDeviceLike } from "./device.js";
import { GpuFieldEvaluator } from "./evaluator.js";
import { planResidentRun } from "./run.js";
import { makeCorpusGeometry } from "./testGeometry.js";
import type { GpuScalarType } from "./types.js";

// ---------------------------------------------------------------------------
// generic helpers

const SCALARS: readonly GpuScalarType[] = ["f32", "i32", "u32"];
const ORIENT_AXES = ["+x", "-x", "+y", "-y", "+z", "-z"] as const;

interface AttrSnapshot {
  readonly name: string;
  readonly type: AttrType;
  readonly tupleSize: number;
  readonly bytes: Uint8Array;
  readonly data: ArrayLike<number>;
}

function snapshot(result: CookResult, output = "out"): Map<string, AttrSnapshot> {
  const item = result.outputs[output][0];
  if (item.kind !== "geometry") throw new Error("scenario: expected a geometry item");
  return snapshotGeo(item.geo);
}

function snapshotGeo(geo: Geometry): Map<string, AttrSnapshot> {
  const set = geo.attrs.point;
  const out = new Map<string, AttrSnapshot>();
  for (const name of set.names()) {
    const attr = set.require(name);
    const n = set.count * attr.tupleSize;
    const view = attr.data;
    out.set(name, {
      name,
      type: attr.type,
      tupleSize: attr.tupleSize,
      bytes: new Uint8Array(
        view.buffer,
        view.byteOffset,
        n * (view as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT,
      ).slice(),
      data: (view as unknown as { subarray(a: number, b: number): ArrayLike<number> }).subarray(0, n),
    });
  }
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** f32 ULP distance (0 for bit-equal / both-NaN, Infinity for NaN vs number). */
function ulpDistance(a: number, b: number): number {
  if (Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b))) return 0;
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  const f = new Float32Array([a, b]);
  if (f[0] === f[1]) return 0;
  const u = new Uint32Array(f.buffer);
  const ord = (x: number): number => (x >>> 31 ? 0x80000000 - (x & 0x7fffffff) : 0x80000000 + x);
  return Math.abs(ord(u[0]) - ord(u[1]));
}

/** rangeUlp/maxUlp parity of `b` vs the reference `a` (see parity.device.test.ts). */
function measureParity(a: ArrayLike<number>, b: ArrayLike<number>): { maxUlp: number; rangeUlp: number } {
  let range = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Math.abs(a[i]);
    if (x > range && Number.isFinite(x)) range = x;
  }
  const unit = 2 ** -23 * (range === 0 ? 1 : range);
  let maxUlp = 0;
  let rangeUlp = 0;
  for (let i = 0; i < a.length; i++) {
    const c = a[i];
    const g = b[i];
    const d = ulpDistance(c, g);
    if (d > maxUlp) maxUlp = d;
    const abs =
      Number.isNaN(c) || Number.isNaN(g)
        ? Number.isNaN(c) && Number.isNaN(g)
          ? 0
          : Number.POSITIVE_INFINITY
        : Math.abs(c - g) / unit;
    if (abs > rangeUlp) rangeUlp = abs;
  }
  return { maxUlp, rangeUlp };
}

/** Minimum per-lane |dot| between unit quaternions (1 = same rotation). */
function minQuatDot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let min = 1;
  const n = a.length / 4;
  for (let i = 0; i < n; i++) {
    let dot = 0;
    for (let k = 0; k < 4; k++) dot += a[i * 4 + k] * b[i * 4 + k];
    const abs = Math.abs(dot);
    if (abs < min) min = abs;
  }
  return min;
}

// ---------------------------------------------------------------------------
// fixtures

interface XformShape {
  /** "quat" adds rot as f32x4; "bad" adds it as f32x3 (wrong shape). */
  readonly rot?: "quat" | "bad";
  readonly scale?: boolean;
}

/** Corpus cloud plus the requested transform attributes. */
function makeXformGeometry(count: number, shape: XformShape): Geometry {
  const geo = makeCorpusGeometry(count);
  const set = geo.attrs.point;
  const rot =
    shape.rot === "quat"
      ? set.add("rot", "f32", 4, [0, 0, 0, 1])
      : shape.rot === "bad"
        ? set.add("rot", "f32", 3, [0, 0, 0])
        : undefined;
  const scale = shape.scale === true ? set.add("scale", "f32", 3, [1, 1, 1]) : undefined;
  set.resize(count);
  for (let i = 0; i < count; i++) {
    if (rot !== undefined && shape.rot === "quat") {
      // Unit quaternion from a hashed axis-angle (deterministic, varied).
      const ax = hashFloat(hashCombine(707, i, 0)) - 0.5;
      const ay = hashFloat(hashCombine(707, i, 1)) - 0.5;
      const az = hashFloat(hashCombine(707, i, 2)) - 0.5;
      const ang = hashFloat(hashCombine(708, i)) * Math.PI * 2;
      const len = Math.hypot(ax, ay, az) || 1;
      const s = Math.sin(ang / 2);
      rot.data[i * 4] = (ax / len) * s;
      rot.data[i * 4 + 1] = (ay / len) * s;
      rot.data[i * 4 + 2] = (az / len) * s;
      rot.data[i * 4 + 3] = Math.cos(ang / 2);
    } else if (rot !== undefined) {
      for (let k = 0; k < 3; k++) rot.data[i * 3 + k] = hashFloat(hashCombine(710, i, k));
    }
    if (scale !== undefined) {
      for (let k = 0; k < 3; k++) scale.data[i * 3 + k] = 0.5 + hashFloat(hashCombine(709, i, k));
    }
  }
  return geo;
}

/** Corpus cloud plus non-identity `rot` (f32x4) and `scale`. */
function makeTransformGeometry(count: number): Geometry {
  return makeXformGeometry(count, { rot: "quat", scale: true });
}

/** Points-only cloud with just `P` and a dense f32 `density` (large counts). */
function leanGeometry(count: number): Geometry {
  const geo = new Geometry();
  const set = geo.attrs.point;
  const P = set.add("P", "f32", 3);
  const density = set.add("density", "f32", 1);
  set.resize(count);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) P.data[i * 3 + k] = (hashFloat(hashCombine(101, i, k)) - 0.5) * 16;
    density.data[i] = hashFloat(hashCombine(202, i));
  }
  return geo;
}

/** Corpus cloud with a `mask` attribute that is exactly 0 on every 4th point. */
function makeMaskGeometry(count: number, withRot: boolean): Geometry {
  const geo = withRot ? makeTransformGeometry(count) : makeCorpusGeometry(count);
  const set = geo.attrs.point;
  const mask = set.add("mask", "f32", 1, 0);
  set.resize(count);
  for (let i = 0; i < count; i++) mask.data[i] = i % 4 === 0 ? 0 : 1;
  return geo;
}

/** Node defs erased to a common param shape so chains can be data-driven. */
type AnyNodeDef = NodeDef<Record<string, unknown>>;
const anyDef = (def: unknown): AnyNodeDef => def as AnyNodeDef;

interface ChainStep {
  readonly def: AnyNodeDef;
  readonly params: Record<string, unknown>;
}

/** dataInput(geo) → step0 → … → stepN → output "out". */
function chainGraph(
  geo: Geometry,
  steps: readonly ChainStep[],
  graphSeed = 7,
): { g: Graph; ids: string[] } {
  const g = new Graph(graphSeed);
  const din = g.add(dataInput);
  g.setParam(din, "items", [makeGeometryItem(geo)]);
  let prev = din.id;
  const ids: string[] = [];
  for (const step of steps) {
    const n = g.add(step.def, step.params);
    g.connect({ id: prev }, "out", n, "in");
    prev = n.id;
    ids.push(n.id);
  }
  g.output({ id: prev }, "out", "out");
  return { g, ids };
}

/**
 * A resolver that resolves fields on the device exactly like the
 * evaluator but always refuses to fuse (`planRun` → null): the per-node
 * GPU reference leg of the three-way comparison. `executeRun` exists
 * only so the executor's run detection engages (and must never run).
 */
function perNodeResolver(ev: GpuFieldEvaluator): GpuFieldResolver {
  return {
    cacheSalt: `${ev.cacheSalt}|per-node`,
    resolveField: (field, ctx, stats) => ev.resolveField(field, ctx, stats),
    planRun: (_members, _ctx, stats) => {
      if (stats !== undefined) {
        stats.fallbacks["run-plan-failed"] = (stats.fallbacks["run-plan-failed"] ?? 0) + 1;
      }
      return null;
    },
    executeRun: () => Promise.reject(new Error("perNodeResolver.executeRun must never be called")),
  };
}

// ---------------------------------------------------------------------------
// 1. WGSL front-end validation of every apply-kernel variant

interface KernelDiag {
  readonly key: string;
  readonly message: string;
  readonly lineNum: number;
  readonly linePos: number;
}

/**
 * A param source before slot assignment: either a bound column or a
 * constant of the given tuple size. Slots are assigned in param order,
 * exactly as the planner assigns them.
 */
type ParamShape = { readonly col: ApplyColRef } | { readonly constTuple: number };

/** Resolve param shapes to refs, numbering constant slots in order. */
function assignSlots(shapes: readonly ParamShape[]): ApplyParamRef[] {
  let slot = 0;
  return shapes.map((s) =>
    "col" in s ? s.col : ({ kind: "const", tupleSize: s.constTuple, slot: slot++ } as ApplyParamRef),
  );
}

/** Every apply-kernel variant the planner can generate. */
function allApplyKernels(): ApplyKernel[] {
  const kernels: ApplyKernel[] = [];
  const col = (type: GpuScalarType, tupleSize: number): ApplyColRef => ({
    kind: "column",
    type,
    tupleSize,
  });
  const konst = (tupleSize: number, slot: number): ApplyConstRef => ({
    kind: "const",
    tupleSize,
    slot,
  });

  // setAttribute: full cross product. The planner allows a value source
  // of tuple 1 (broadcast) or exactly the target tuple size, as a column
  // of any scalar type or as an f32 uniform constant.
  for (const targetType of ["f32", "i32", "u32", "bool"] as const) {
    for (let ts = 1; ts <= 4; ts++) {
      const valueTuples = ts === 1 ? [1] : [1, ts];
      for (const vt of valueTuples) {
        for (const colType of SCALARS) {
          kernels.push(makeSetAttributeApply(col(colType, vt), targetType, ts));
        }
        kernels.push(makeSetAttributeApply(konst(vt, 0), targetType, ts));
      }
    }
  }

  // transformPoints: each param shape in each role (others f32x3
  // columns) crossed with the rot/scale composition flags, plus the
  // all-same diagonal and every two-constant pairing — a covering design
  // over the shape space that also exercises each binding remap a
  // constant param causes (one, two or three params declaring no
  // storage binding, in every position).
  const shapes: ParamShape[] = [];
  for (const t of SCALARS) for (const ts of [1, 3]) shapes.push({ col: col(t, ts) });
  for (const ts of [1, 3]) shapes.push({ constTuple: ts });
  const base: ParamShape = { col: col("f32", 3) };
  const xform = (a: ParamShape, b: ParamShape, c: ParamShape, hasRot: boolean, hasScale: boolean): void => {
    const [t, r, s] = assignSlots([a, b, c]);
    kernels.push(makeTransformPointsApply(t, r, s, hasRot, hasScale));
  };
  for (const hasRot of [false, true]) {
    for (const hasScale of [false, true]) {
      for (const shape of shapes) {
        xform(shape, base, base, hasRot, hasScale);
        xform(base, shape, base, hasRot, hasScale);
        xform(base, base, shape, hasRot, hasScale);
        xform(shape, shape, shape, hasRot, hasScale);
      }
      // Two constants, one column, in all three arrangements.
      for (const ts of [1, 3]) {
        const k: ParamShape = { constTuple: ts };
        xform(k, k, base, hasRot, hasScale);
        xform(k, base, k, hasRot, hasScale);
        xform(base, k, k, hasRot, hasScale);
      }
    }
  }

  // jitterPoints: one kernel per amount shape.
  for (const shape of shapes) kernels.push(makeJitterPointsApply(assignSlots([shape])[0]));

  // orientAlongVector: every axis x every direction shape. The up hint
  // rides a uniform slot (after the direction's, when that is constant
  // too), so its VALUE no longer specializes the kernel — the up
  // variants that used to multiply this space now collapse into one
  // pipeline, which is the point.
  for (const axis of ORIENT_AXES) {
    for (const shape of shapes) {
      const refs = assignSlots([shape, { constTuple: 3 }]);
      kernels.push(makeOrientApply(refs[0], axis, refs[1] as ApplyConstRef));
    }
  }

  // Deduplicate by specialization key: identical keys must be identical
  // text (a codegen invariant worth checking here too).
  const byKey = new Map<string, ApplyKernel>();
  for (const k of kernels) {
    const seen = byKey.get(k.key);
    if (seen !== undefined) {
      if (seen.wgsl !== k.wgsl) {
        throw new Error(`apply codegen: key "${k.key}" maps to two different WGSL texts`);
      }
      continue;
    }
    byKey.set(k.key, k);
  }
  return [...byKey.values()];
}

/** The error-scope surface (not part of {@link GpuDeviceLike}). */
interface ErrorScopes {
  pushErrorScope(filter: "validation"): void;
  popErrorScope(): Promise<{ message?: string } | null>;
}

async function validateKernels(
  device: GpuDeviceLike,
  scopes: ErrorScopes,
): Promise<{
  variants: number;
  errors: KernelDiag[];
  warnings: number;
  pipelines: number;
  pipelineErrors: string[];
  constVariantsByKind: Record<string, number>;
  maxConstSlots: number;
}> {
  const kernels = allApplyKernels();
  // Constant-carrying variants per node kind (the key's second field),
  // so "every kind compiles with constants" is counted, not assumed.
  const constVariantsByKind: Record<string, number> = {};
  let maxConstSlots = 0;
  for (const k of kernels) {
    if (k.constSlots === 0) continue;
    const kind = k.key.split("|")[1];
    constVariantsByKind[kind] = (constVariantsByKind[kind] ?? 0) + 1;
    maxConstSlots = Math.max(maxConstSlots, k.constSlots);
  }
  const errors: KernelDiag[] = [];
  const pipelineErrors: string[] = [];
  let warnings = 0;
  let pipelines = 0;
  for (const kernel of kernels) {
    scopes.pushErrorScope("validation");
    const module = device.createShaderModule({ code: kernel.wgsl });
    const info = await module.getCompilationInfo();
    for (const m of info.messages) {
      if (m.type === "error") {
        errors.push({
          key: kernel.key,
          message: m.message,
          lineNum: m.lineNum ?? 0,
          linePos: m.linePos ?? 0,
        });
      } else if (m.type === "warning") {
        warnings++;
      }
    }
    // A module that compiles can still fail pipeline creation (binding
    // layout problems), so create the pipeline too.
    device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: kernel.entryPoint } });
    pipelines++;
    const err = await scopes.popErrorScope();
    if (err !== null && err !== undefined) {
      pipelineErrors.push(`${kernel.key}: ${err.message ?? String(err)}`);
    }
  }
  return {
    variants: kernels.length,
    errors,
    warnings,
    pipelines,
    pipelineErrors,
    constVariantsByKind,
    maxConstSlots,
  };
}

// ---------------------------------------------------------------------------
// 2. three-way parity over fused chains

const NOISE = (seed: number): FieldSpec =>
  ({ fn: "perlinNoise", opts: { seed, frequency: 0.35, normalized: true } }) as unknown as FieldSpec;

const spec = (s: object): Field => fieldFromJson(s as FieldSpec);

interface ChainCase {
  readonly name: string;
  readonly bitExact: boolean;
  readonly count: number;
  readonly geo: (count: number) => Geometry;
  readonly steps: readonly ChainStep[];
  /** Attribute pairs the fused output must hold byte-identical. */
  readonly crossChecks?: readonly (readonly [string, string])[];
}

interface AttrCompare {
  name: string;
  type: AttrType;
  tupleSize: number;
  equalCpu: boolean;
  equalPerNode: boolean;
  rangeUlpCpu?: number;
  maxUlpCpu?: number;
  rangeUlpPerNode?: number;
  minQuatDotCpu?: number;
}

function statsOf(r: CookResult): Record<string, unknown> {
  const s = r.stats.gpu;
  return {
    residentRuns: s?.residentRuns ?? 0,
    fusedNodes: s?.fusedNodes ?? 0,
    readbacksSaved: s?.readbacksSaved ?? 0,
    dispatches: s?.dispatches ?? 0,
    pipelinesCompiled: s?.pipelinesCompiled ?? 0,
    pipelineCacheHits: s?.pipelineCacheHits ?? 0,
    fallbacks: s?.fallbacks ?? {},
    cooked: r.stats.cooked,
  };
}

function compareAttrs(
  cpu: Map<string, AttrSnapshot>,
  perNode: Map<string, AttrSnapshot>,
  fused: Map<string, AttrSnapshot>,
): AttrCompare[] {
  const out: AttrCompare[] = [];
  for (const [name, f] of fused) {
    const c = cpu.get(name);
    const p = perNode.get(name);
    const entry: AttrCompare = {
      name,
      type: f.type,
      tupleSize: f.tupleSize,
      equalCpu: c !== undefined && c.type === f.type && c.tupleSize === f.tupleSize && bytesEqual(c.bytes, f.bytes),
      equalPerNode: p !== undefined && bytesEqual(p.bytes, f.bytes),
    };
    if (c !== undefined && f.type === "f32") {
      const vs = measureParity(c.data, f.data);
      entry.rangeUlpCpu = vs.rangeUlp;
      entry.maxUlpCpu = vs.maxUlp;
      if (p !== undefined) entry.rangeUlpPerNode = measureParity(p.data, f.data).rangeUlp;
      if (name === "rot" && f.tupleSize === 4) entry.minQuatDotCpu = minQuatDot(c.data, f.data);
    }
    out.push(entry);
  }
  return out;
}

async function runChainCase(
  c: ChainCase,
  ev: GpuFieldEvaluator,
  perNode: GpuFieldResolver,
): Promise<Record<string, unknown>> {
  const cpuGeo = c.geo(c.count);
  const perNodeGeo = c.geo(c.count);
  const fusedGeo = c.geo(c.count);
  const inputP = fusedGeo.attrs.point.require("P").data.slice();

  const cpu = await cook(chainGraph(cpuGeo, c.steps).g);
  const pn = await cook(chainGraph(perNodeGeo, c.steps).g, { gpu: perNode });
  const fu = await cook(chainGraph(fusedGeo, c.steps).g, { gpu: ev });

  const cpuSnap = snapshot(cpu);
  const pnSnap = snapshot(pn);
  const fuSnap = snapshot(fu);
  const crossChecks = (c.crossChecks ?? []).map(([a, b]) => ({
    pair: `${a}=${b}`,
    equal: bytesEqual(fuSnap.get(a)!.bytes, fuSnap.get(b)!.bytes),
  }));
  return {
    crossChecks,
    name: c.name,
    count: c.count,
    members: c.steps.length,
    bitExact: c.bitExact,
    namesCpu: [...cpuSnap.keys()],
    namesPerNode: [...pnSnap.keys()],
    namesFused: [...fuSnap.keys()],
    stats: statsOf(fu),
    perNodeStats: statsOf(pn),
    // The run's input geometry aliases upstream cache internals: the
    // executor must never write through it.
    inputUnmutated: bytesEqual(
      new Uint8Array(inputP.buffer, inputP.byteOffset, inputP.byteLength),
      new Uint8Array(
        fusedGeo.attrs.point.require("P").data.buffer,
        fusedGeo.attrs.point.require("P").data.byteOffset,
        inputP.byteLength,
      ),
    ),
    attrs: compareAttrs(cpuSnap, pnSnap, fuSnap),
  };
}

function chainCases(): ChainCase[] {
  const randomD: ChainStep = {
    def: anyDef(setAttribute),
    params: { name: "d", value: spec({ fn: "randomField", key: "k" }) },
  };
  return [
    {
      // Pure hash + power-of-two jitter amounts: every arithmetic step is
      // exact in f32, so fused output must be BIT-EXACT vs the CPU.
      name: "hash2",
      bitExact: true,
      count: 2000,
      geo: makeCorpusGeometry,
      steps: [randomD, { def: anyDef(jitterPoints), params: { amount: [0.25, 0.5, 0.125], seed: 3 } }],
    },
    {
      name: "hash4",
      bitExact: true,
      count: 1500,
      geo: makeCorpusGeometry,
      steps: [
        randomD,
        { def: anyDef(jitterPoints), params: { amount: [0.25, 0.5, 0.125] } },
        {
          def: anyDef(setAttribute),
          params: { name: "n", type: "u32", tupleSize: 1, value: spec({ fn: "index" }) },
        },
        {
          def: anyDef(jitterPoints),
          params: { amount: [0.0625, 0.03125, 0.015625], seed: 11 },
        },
      ],
    },
    {
      // Mid-run retype: "q" is created u32x1 then replaced f32x3.
      name: "retype3",
      bitExact: true,
      count: 1200,
      geo: makeCorpusGeometry,
      steps: [
        {
          def: anyDef(setAttribute),
          params: { name: "q", type: "u32", tupleSize: 1, value: spec({ fn: "index" }) },
        },
        {
          def: anyDef(setAttribute),
          params: { name: "q", type: "f32", tupleSize: 3, value: spec({ fn: "position" }) },
        },
        { def: anyDef(jitterPoints), params: { amount: [0.25, 0.25, 0.25], seed: 4 } },
      ],
    },
    {
      // Float-carrying 4-member chain over a cloud that already has rot
      // and scale, so transformPoints exercises both composition paths.
      name: "float4",
      bitExact: false,
      count: 3000,
      geo: makeTransformGeometry,
      steps: [
        { def: anyDef(setAttribute), params: { name: "d", value: spec(NOISE(3)) } },
        { def: anyDef(orientAlongVector), params: { direction: spec({ fn: "position" }) } },
        {
          def: anyDef(transformPoints),
          params: {
            translate: spec({ fn: "attribute", name: "d" }),
            rotateEuler: [15, 25, 35],
            scale: [1.25, 0.75, 1.5],
          },
        },
        {
          def: anyDef(jitterPoints),
          params: { amount: spec({ fn: "attribute", name: "d" }), seed: 5 },
        },
      ],
    },
    {
      // Every setAttribute store conversion the planner can emit, in one
      // run: bool from a 0/1 float, i32 from an in-range float, a u32
      // column broadcast into tuple 2, a scalar broadcast into tuple 4,
      // and a u32 attribute read back as an f32 field.
      name: "types5",
      bitExact: true,
      count: 900,
      geo: makeCorpusGeometry,
      steps: [
        {
          def: anyDef(setAttribute),
          params: {
            name: "flag",
            type: "bool",
            tupleSize: 1,
            value: spec({
              fn: "floor",
              args: [{ fn: "mul", args: [{ fn: "attribute", name: "density" }, 2] }],
            }),
          },
        },
        {
          def: anyDef(setAttribute),
          params: {
            name: "iv",
            type: "i32",
            tupleSize: 1,
            value: spec({
              fn: "floor",
              args: [{ fn: "mul", args: [{ fn: "attribute", name: "density" }, 100] }],
            }),
          },
        },
        {
          def: anyDef(setAttribute),
          params: { name: "u2", type: "u32", tupleSize: 2, value: spec({ fn: "index" }) },
        },
        {
          def: anyDef(setAttribute),
          params: {
            name: "c4",
            type: "f32",
            tupleSize: 4,
            value: spec({ fn: "attribute", name: "density" }),
          },
        },
        {
          // Reads the u32 attribute an earlier member created.
          def: anyDef(setAttribute),
          params: { name: "back", type: "f32", tupleSize: 2, value: spec({ fn: "attribute", name: "u2" }) },
        },
        {
          // Reads the BOOL attribute an earlier member created (resident
          // bool columns ride as u32 0/1 and read back as f32).
          def: anyDef(setAttribute),
          params: { name: "fb", type: "f32", tupleSize: 1, value: spec({ fn: "attribute", name: "flag" }) },
        },
      ],
    },
    {
      // SSA epochs: a member reading the attribute it rewrites, a later
      // member reading an earlier epoch, and a retype after that read.
      name: "selfRetype5",
      bitExact: true,
      count: 850,
      geo: makeCorpusGeometry,
      steps: [
        {
          def: anyDef(setAttribute),
          params: {
            name: "density",
            type: "f32",
            tupleSize: 1,
            value: spec({ fn: "mul", args: [{ fn: "attribute", name: "density" }, 2] }),
          },
        },
        {
          def: anyDef(setAttribute),
          params: { name: "q", type: "u32", tupleSize: 1, value: spec({ fn: "index" }) },
        },
        {
          def: anyDef(setAttribute),
          params: { name: "r", type: "f32", tupleSize: 1, value: spec({ fn: "attribute", name: "q" }) },
        },
        {
          def: anyDef(setAttribute),
          params: { name: "q", type: "f32", tupleSize: 3, value: spec({ fn: "position" }) },
        },
        {
          def: anyDef(setAttribute),
          params: { name: "ab", type: "f32", tupleSize: 1, value: spec({ fn: "attribute", name: "active" }) },
        },
      ],
    },
    {
      // Bit-exact transformPoints: identity rotation and power-of-two
      // scale keep every step exact in f32, so rot/scale composition and
      // the i32 translate column are pinned at byte equality. The third
      // member reads P back through `position` — the cross-member
      // visibility check with no float slack.
      name: "exactTransform3",
      bitExact: true,
      count: 1024,
      geo: makeTransformGeometry,
      crossChecks: [["h", "P"]],
      steps: [
        {
          def: anyDef(transformPoints),
          params: {
            translate: spec({ fn: "attribute", name: "material" }),
            rotateEuler: [0, 0, 0],
            scale: [2, 0.5, 4],
          },
        },
        {
          def: anyDef(setAttribute),
          params: { name: "h", type: "f32", tupleSize: 3, value: spec({ fn: "position" }) },
        },
        {
          def: anyDef(setAttribute),
          params: { name: "t", type: "u32", tupleSize: 1, value: spec({ fn: "index" }) },
        },
      ],
    },
    {
      // rot present, scale absent (binding b5 is rot).
      name: "rotOnly2",
      bitExact: true,
      count: 800,
      geo: (n) => makeXformGeometry(n, { rot: "quat" }),
      steps: [
        {
          def: anyDef(transformPoints),
          params: { translate: [0.5, 0.25, 0.125], rotateEuler: [0, 0, 0], scale: [1, 1, 1] },
        },
        { def: anyDef(jitterPoints), params: { amount: [0.25, 0.5, 0.125] } },
      ],
    },
    {
      // scale present, rot absent (binding b5 is the scale attribute).
      name: "scaleOnly2",
      bitExact: true,
      count: 800,
      geo: (n) => makeXformGeometry(n, { scale: true }),
      steps: [
        {
          def: anyDef(transformPoints),
          params: { translate: [0.5, 0.25, 0.125], rotateEuler: [0, 0, 0], scale: [2, 0.5, 4] },
        },
        { def: anyDef(jitterPoints), params: { amount: [0.25, 0.5, 0.125] } },
      ],
    },
    {
      // The translate column IS the P attribute (a zero-copy view on the
      // CPU): P' must be exactly 2P, proving no read-after-write hazard.
      name: "aliasTranslate2",
      bitExact: true,
      count: 700,
      geo: makeCorpusGeometry,
      steps: [
        {
          def: anyDef(transformPoints),
          params: { translate: spec({ fn: "position" }), rotateEuler: [0, 0, 0], scale: [1, 1, 1] },
        },
        {
          def: anyDef(setAttribute),
          params: { name: "t", type: "u32", tupleSize: 1, value: spec({ fn: "index" }) },
        },
      ],
    },
    {
      // setAttribute replacing "P" itself, from a field that views P.
      name: "replaceP2",
      bitExact: true,
      count: 700,
      geo: makeCorpusGeometry,
      steps: [
        {
          def: anyDef(setAttribute),
          params: { name: "P", type: "f32", tupleSize: 3, value: spec({ fn: "position" }) },
        },
        { def: anyDef(jitterPoints), params: { amount: [0.25, 0.5, 0.125], seed: 9 } },
      ],
    },
    {
      // SSA epoch discrimination. replaceP2's replacement value IS the
      // attribute it replaces (position → P), so it cannot tell "member 2
      // reads the new epoch" from "member 2 reads the pre-replacement
      // buffer". Here member 1 registers P's resident slot, member 2
      // replaces P with a DIFFERENT value (density broadcast across the
      // tuple), and member 3 reads and writes P again — it must see the
      // replacement epoch. A planner that failed to rebind the slot after
      // freshSlot() would silently jitter the pre-replacement buffer.
      name: "epochP3",
      bitExact: true,
      count: 700,
      geo: makeCorpusGeometry,
      steps: [
        { def: anyDef(jitterPoints), params: { amount: [0.25, 0.5, 0.125], seed: 3 } },
        {
          def: anyDef(setAttribute),
          params: {
            name: "P",
            type: "f32",
            tupleSize: 3,
            value: spec({ fn: "attribute", name: "density" }),
          },
        },
        { def: anyDef(jitterPoints), params: { amount: [0.25, 0.5, 0.125], seed: 9 } },
      ],
    },
    {
      // A wrong-shaped rot (f32x3) must be removed and re-added as f32x4
      // — the layout-op replay has to reproduce the attribute ORDER too.
      name: "badRot2",
      bitExact: false,
      count: 600,
      geo: (n) => makeXformGeometry(n, { rot: "bad" }),
      steps: [
        { def: anyDef(orientAlongVector), params: { direction: spec({ fn: "position" }) } },
        {
          def: anyDef(setAttribute),
          params: { name: "t", type: "u32", tupleSize: 1, value: spec({ fn: "index" }) },
        },
      ],
    },
    {
      // Per-member seed plumbing: setAttribute's nonzero `seed` param
      // (hashCombine(nodeSeed, seed), where 0 means the node seed
      // unchanged) and transformPoints' node seed, both feeding
      // randomField — a wrong seed anywhere produces different bytes.
      // Identity rotation and unit scale keep the chain exact.
      name: "seeds3",
      bitExact: true,
      count: 900,
      geo: makeCorpusGeometry,
      steps: [
        {
          def: anyDef(setAttribute),
          params: { name: "d", value: spec({ fn: "randomField", key: "k" }), seed: 42 },
        },
        {
          def: anyDef(transformPoints),
          params: {
            translate: spec({ fn: "randomField", key: "t" }),
            rotateEuler: [0, 0, 0],
            scale: [1, 1, 1],
          },
        },
        {
          def: anyDef(setAttribute),
          params: { name: "t", type: "u32", tupleSize: 1, value: spec({ fn: "index" }) },
        },
      ],
    },
    {
      // orientAlongVector's node seed, via a hash-derived direction.
      name: "orientSeed2",
      bitExact: false,
      count: 900,
      geo: makeCorpusGeometry,
      steps: [
        {
          def: anyDef(orientAlongVector),
          params: {
            direction: spec({
              fn: "vec",
              args: [
                { fn: "randomField", key: "ox" },
                { fn: "randomField", key: "oy" },
                { fn: "add", args: [{ fn: "randomField", key: "oz" }, 1] },
              ],
            }),
          },
        },
        {
          def: anyDef(setAttribute),
          params: { name: "t", type: "u32", tupleSize: 1, value: spec({ fn: "index" }) },
        },
      ],
    },
    {
      // A long run: 8 members, so every intermediate field column is
      // held device-side for the whole run and the plan's slot/column
      // bookkeeping is exercised well past the two-member case.
      name: "long8",
      bitExact: true,
      count: 640,
      geo: makeCorpusGeometry,
      steps: Array.from({ length: 8 }, (_, i) =>
        i % 2 === 0
          ? {
              def: anyDef(setAttribute),
              params: {
                name: `s${i}`,
                type: "f32",
                tupleSize: 1,
                value: spec({ fn: "randomField", key: `k${i}` }),
              },
            }
          : { def: anyDef(jitterPoints), params: { amount: [0.25, 0.5, 0.125], seed: i } },
      ),
    },
    {
      // orientAlongVector CREATES rot mid-run; the transformPoints that
      // follows must see it in the evolving layout and compose with it
      // (a non-identity euler makes a missing composition visible).
      name: "orientThenTransform2",
      bitExact: false,
      count: 900,
      geo: makeCorpusGeometry,
      steps: [
        { def: anyDef(orientAlongVector), params: { direction: spec({ fn: "position" }) } },
        {
          def: anyDef(transformPoints),
          params: { translate: [1, 2, 4], rotateEuler: [0, 0, 90], scale: [1, 1, 1] },
        },
      ],
    },
    {
      // Binding remap: constant params declare no storage binding, so
      // the attribute bindings shift. Member 2 puts its only column in
      // the MIDDLE role (const, column, const) and member 4 puts it
      // LAST (const, const, column) — the two arrangements a positional
      // binding assumption would mis-bind. Every constant is a power of
      // two (or a sum of them) and every rotation is the identity, so
      // the whole chain stays exact in f32.
      name: "remapConst5",
      bitExact: true,
      count: 800,
      geo: makeTransformGeometry,
      steps: [
        {
          def: anyDef(setAttribute),
          params: { name: "z3", type: "f32", tupleSize: 3, value: [0, 0, 0] },
        },
        {
          def: anyDef(transformPoints),
          params: {
            translate: [0.5, 0.25, 0.125],
            rotateEuler: spec({ fn: "attribute", name: "z3" }),
            scale: [2, 0.5, 4],
          },
        },
        {
          def: anyDef(setAttribute),
          params: { name: "two3", type: "f32", tupleSize: 3, value: [2, 0.5, 4] },
        },
        {
          def: anyDef(transformPoints),
          params: {
            translate: [0, 0, 0],
            rotateEuler: [0, 0, 0],
            scale: spec({ fn: "attribute", name: "two3" }),
          },
        },
        {
          // A scalar constant broadcast across a wider target.
          def: anyDef(setAttribute),
          params: { name: "q4", type: "f32", tupleSize: 4, value: 0.25 },
        },
      ],
    },
    {
      // Constant STORES of every target type, including values that do
      // not round-trip a decimal exactly: a store is a copy, so the
      // f32-rounded uniform value must land byte-for-byte on the CPU's.
      name: "constStores4",
      bitExact: true,
      count: 256,
      geo: makeCorpusGeometry,
      steps: [
        {
          def: anyDef(setAttribute),
          params: { name: "cf", type: "f32", tupleSize: 3, value: [0.1, 1 / 3, 12345.6789] },
        },
        { def: anyDef(setAttribute), params: { name: "ci", type: "i32", tupleSize: 1, value: -7 } },
        // A scalar constant broadcast into a wider integer target.
        { def: anyDef(setAttribute), params: { name: "cu", type: "u32", tupleSize: 2, value: 9 } },
        { def: anyDef(setAttribute), params: { name: "cb", type: "bool", tupleSize: 1, value: 3 } },
      ],
    },
    {
      // A CONSTANT direction: orientAlongVector's kernel then binds only
      // rot, with both the direction and the up hint in uniform slots.
      name: "constDir2",
      bitExact: false,
      count: 600,
      geo: makeCorpusGeometry,
      steps: [
        {
          def: anyDef(orientAlongVector),
          params: { direction: [1, 0, 0], axis: "+z", up: [0, 1, 0] },
        },
        {
          def: anyDef(setAttribute),
          params: { name: "t", type: "u32", tupleSize: 1, value: spec({ fn: "index" }) },
        },
      ],
    },
    {
      // Plain-value params only (uniform constant slots) + a fresh rot.
      name: "const3",
      bitExact: false,
      count: 1000,
      geo: makeCorpusGeometry,
      steps: [
        {
          def: anyDef(transformPoints),
          params: { translate: [1, 2, 3], rotateEuler: [0, 90, 0], scale: [2, 2, 2] },
        },
        {
          def: anyDef(orientAlongVector),
          params: { direction: spec({ fn: "position" }), axis: "+y", up: [0, 0, 1] },
        },
        {
          def: anyDef(setAttribute),
          params: { name: "h", value: spec({ fn: "length", args: [{ fn: "position" }] }) },
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// 3. semantic spot-checks against the CPU reference

/** Six points on the unit axes: analytic transform expectations. */
function axisGeometry(): Geometry {
  const geo = new Geometry();
  const set = geo.attrs.point;
  const P = set.add("P", "f32", 3);
  set.resize(6);
  const pts = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [-1, 0, 0],
    [0, -1, 0],
    [0, 0, -1],
  ];
  for (let i = 0; i < 6; i++) for (let k = 0; k < 3; k++) P.data[i * 3 + k] = pts[i][k];
  return geo;
}

async function transformSemantics(
  ev: GpuFieldEvaluator,
): Promise<Array<Record<string, unknown>>> {
  const cases: Array<{ name: string; rotateEuler: number[]; scale: number[]; translate: number[] }> = [
    { name: "zRot90", rotateEuler: [0, 0, 90], scale: [2, 1, 0.5], translate: [0, 0, 0] },
    { name: "xRot90", rotateEuler: [90, 0, 0], scale: [1, 2, 4], translate: [0, 0, 0] },
    { name: "yRot90", rotateEuler: [0, 90, 0], scale: [1, 1, 1], translate: [1, -2, 3] },
    { name: "xyz", rotateEuler: [30, 45, 60], scale: [2, 0.5, 1.5], translate: [1, 1, 1] },
  ];
  const out: Array<Record<string, unknown>> = [];
  for (const c of cases) {
    const steps: ChainStep[] = [
      {
        def: anyDef(transformPoints),
        params: { translate: c.translate, rotateEuler: c.rotateEuler, scale: c.scale },
      },
      {
        def: anyDef(setAttribute),
        params: { name: "t", type: "u32", tupleSize: 1, value: spec({ fn: "index" }) },
      },
    ];
    const cpu = await cook(chainGraph(axisGeometry(), steps).g);
    const fused = await cook(chainGraph(axisGeometry(), steps).g, { gpu: ev });
    const cpuP = snapshot(cpu).get("P")!;
    const fuP = snapshot(fused).get("P")!;
    let maxAbs = 0;
    for (let i = 0; i < cpuP.data.length; i++) {
      maxAbs = Math.max(maxAbs, Math.abs(cpuP.data[i] - fuP.data[i]));
    }
    out.push({
      name: c.name,
      residentRuns: fused.stats.gpu!.residentRuns,
      maxAbsDiff: maxAbs,
      cpuP: Array.from(cpuP.data),
      fusedP: Array.from(fuP.data),
    });
  }
  return out;
}

async function orientSemantics(ev: GpuFieldEvaluator): Promise<Record<string, unknown>> {
  const axes: Array<Record<string, unknown>> = [];
  for (const axis of ORIENT_AXES) {
    const steps: ChainStep[] = [
      {
        def: anyDef(orientAlongVector),
        params: { direction: spec({ fn: "position" }), axis, up: [0, 1, 0] },
      },
      {
        def: anyDef(setAttribute),
        params: { name: "t", type: "u32", tupleSize: 1, value: spec({ fn: "index" }) },
      },
    ];
    const cpu = await cook(chainGraph(makeCorpusGeometry(2000), steps).g);
    const fused = await cook(chainGraph(makeCorpusGeometry(2000), steps).g, { gpu: ev });
    const c = snapshot(cpu).get("rot")!;
    const f = snapshot(fused).get("rot")!;
    axes.push({
      axis,
      residentRuns: fused.stats.gpu!.residentRuns,
      minQuatDot: minQuatDot(c.data, f.data),
      bytesEqual: bytesEqual(c.bytes, f.bytes),
    });
  }

  // Up-hint variants, including the degenerate zero hint (which
  // normalizes to (0,0,0) and always takes the parallel fallback).
  const ups: Array<Record<string, unknown>> = [];
  for (const up of [
    [0, 0, 0],
    [0, -2, 0],
    [1, 1, 1],
    [0, 0, 1],
  ] as const) {
    const steps: ChainStep[] = [
      {
        def: anyDef(orientAlongVector),
        params: { direction: spec({ fn: "position" }), axis: "+z", up: [...up] },
      },
      {
        def: anyDef(setAttribute),
        params: { name: "t", type: "u32", tupleSize: 1, value: spec({ fn: "index" }) },
      },
    ];
    const cpu = await cook(chainGraph(makeCorpusGeometry(1500), steps).g);
    const fused = await cook(chainGraph(makeCorpusGeometry(1500), steps).g, { gpu: ev });
    ups.push({
      up: [...up],
      residentRuns: fused.stats.gpu!.residentRuns,
      minQuatDot: minQuatDot(snapshot(cpu).get("rot")!.data, snapshot(fused).get("rot")!.data),
    });
  }

  // An integer direction column (i32, tuple 1, broadcast): some lanes
  // are exactly 0 → the zero-direction branch, on the integer path.
  const intDir = await (async (): Promise<Record<string, unknown>> => {
    const steps: ChainStep[] = [
      {
        def: anyDef(orientAlongVector),
        params: { direction: spec({ fn: "attribute", name: "material" }) },
      },
      {
        def: anyDef(setAttribute),
        params: { name: "t", type: "u32", tupleSize: 1, value: spec({ fn: "index" }) },
      },
    ];
    const count = 4000;
    const input = makeCorpusGeometry(count);
    const material = input.attrs.point.require("material").data;
    let zeroLanes = 0;
    for (let i = 0; i < count; i++) if (material[i] === 0) zeroLanes++;
    const cpu = await cook(chainGraph(makeCorpusGeometry(count), steps).g);
    const fused = await cook(chainGraph(makeCorpusGeometry(count), steps).g, { gpu: ev });
    const c = snapshot(cpu).get("rot")!;
    const f = snapshot(fused).get("rot")!;
    return {
      residentRuns: fused.stats.gpu!.residentRuns,
      zeroLanes,
      minQuatDot: minQuatDot(c.data, f.data),
    };
  })();

  // Zero-length directions: every 4th point's direction is exactly
  // (0,0,0) (mask * position), so the CPU keeps that point's prior rot.
  const zero: Array<Record<string, unknown>> = [];
  for (const withRot of [true, false]) {
    const count = 512;
    const dirSpec = {
      fn: "mul",
      args: [{ fn: "attribute", name: "mask" }, { fn: "position" }],
    };
    const steps: ChainStep[] = [
      { def: anyDef(orientAlongVector), params: { direction: spec(dirSpec), axis: "+z" } },
      {
        def: anyDef(setAttribute),
        params: { name: "t", type: "u32", tupleSize: 1, value: spec({ fn: "index" }) },
      },
    ];
    const input = makeMaskGeometry(count, withRot);
    const priorRot = withRot
      ? (input.attrs.point.require("rot").data.slice() as Float32Array)
      : undefined;
    const cpu = await cook(chainGraph(makeMaskGeometry(count, withRot), steps).g);
    const fused = await cook(chainGraph(makeMaskGeometry(count, withRot), steps).g, { gpu: ev });
    const c = snapshot(cpu).get("rot")!;
    const f = snapshot(fused).get("rot")!;
    let zeroLanes = 0;
    let zeroLanesMatchCpu = 0;
    let zeroLanesMatchPrior = 0;
    for (let i = 0; i < count; i++) {
      if (i % 4 !== 0) continue;
      zeroLanes++;
      let sameCpu = true;
      let samePrior = true;
      for (let k = 0; k < 4; k++) {
        if (!Object.is(c.data[i * 4 + k], f.data[i * 4 + k])) sameCpu = false;
        const want = priorRot !== undefined ? priorRot[i * 4 + k] : k === 3 ? 1 : 0;
        if (!Object.is(f.data[i * 4 + k], want)) samePrior = false;
      }
      if (sameCpu) zeroLanesMatchCpu++;
      if (samePrior) zeroLanesMatchPrior++;
    }
    zero.push({
      withRot,
      residentRuns: fused.stats.gpu!.residentRuns,
      zeroLanes,
      zeroLanesMatchCpu,
      zeroLanesMatchPrior,
      minQuatDot: minQuatDot(c.data, f.data),
    });
  }
  return { axes, ups, intDir, zero };
}

async function jitterSemantics(ev: GpuFieldEvaluator): Promise<Record<string, unknown>> {
  const count = 777;
  const amount = [0.25, 0.5, 0.125];
  const extraSeed = 17;
  const steps: ChainStep[] = [
    {
      def: anyDef(setAttribute),
      params: { name: "d", value: spec({ fn: "randomField", key: "k" }) },
    },
    { def: anyDef(jitterPoints), params: { amount, seed: extraSeed } },
  ];
  const input = makeCorpusGeometry(count);
  const built = chainGraph(makeCorpusGeometry(count), steps);
  const fused = await cook(built.g, { gpu: ev });
  const f = snapshot(fused).get("P")!;

  // Recompute the documented chain independently: the jitter member's
  // seed is hashCombine(deriveNodeSeed(graphSeed, id), params.seed) and
  // each axis draws hashFloat(hashCombine(seed, i, k)).
  const jitterSeed = hashCombine(deriveNodeSeed(built.g.seed, built.ids[1]), extraSeed);
  const expected = new Float32Array(count * 3);
  const src = input.attrs.point.require("P").data;
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      expected[i * 3 + k] =
        Math.fround(src[i * 3 + k] + (hashFloat(hashCombine(jitterSeed, i, k)) * 2 - 1) * amount[k]);
    }
  }
  let mismatches = 0;
  for (let i = 0; i < expected.length; i++) {
    if (!Object.is(expected[i], f.data[i])) mismatches++;
  }
  return {
    residentRuns: fused.stats.gpu!.residentRuns,
    elements: expected.length,
    mismatches,
  };
}

// ---------------------------------------------------------------------------
// 4-8. determinism, chunk seams, cancellation, memory bound, stats

/** A mixed chain touching all four fusable kinds, over a rot/scale cloud. */
function mixedChain(): ChainStep[] {
  return [
    { def: anyDef(setAttribute), params: { name: "d", value: spec(NOISE(9)) } },
    {
      def: anyDef(transformPoints),
      params: {
        translate: spec({ fn: "attribute", name: "d" }),
        rotateEuler: [12, 34, 56],
        scale: [1.25, 0.75, 1.5],
      },
    },
    { def: anyDef(jitterPoints), params: { amount: [0.25, 0.5, 0.125], seed: 7 } },
    { def: anyDef(orientAlongVector), params: { direction: spec({ fn: "position" }), axis: "+z" } },
  ];
}

/** Byte-equality of every point attribute between two cooked results. */
function allAttrsEqual(a: Map<string, AttrSnapshot>, b: Map<string, AttrSnapshot>): boolean {
  if (a.size !== b.size) return false;
  for (const [name, x] of a) {
    const y = b.get(name);
    if (y === undefined || x.type !== y.type || x.tupleSize !== y.tupleSize) return false;
    if (!bytesEqual(x.bytes, y.bytes)) return false;
  }
  return true;
}

async function determinism(ev: GpuFieldEvaluator): Promise<Record<string, unknown>> {
  const steps = mixedChain();
  const first = snapshot(await cook(chainGraph(makeTransformGeometry(2048), steps).g, { gpu: ev }));
  const second = snapshot(await cook(chainGraph(makeTransformGeometry(2048), steps).g, { gpu: ev }));
  const third = snapshot(await cook(chainGraph(makeTransformGeometry(2048), steps).g, { gpu: ev }));
  return {
    firstEqualsSecond: allAttrsEqual(first, second),
    firstEqualsThird: allAttrsEqual(first, third),
    attrs: [...first.keys()],
  };
}

async function chunkSeams(
  structural: GpuDeviceLike,
  adapterInfo: { vendor?: string },
): Promise<Record<string, unknown>> {
  const steps = mixedChain();
  const unchunked = new GpuFieldEvaluator(structural, { adapterInfo });
  const forced128 = new GpuFieldEvaluator(structural, { adapterInfo, maxElementsPerDispatch: 128 });
  // Not a workgroup multiple: floors to 64.
  const forced100 = new GpuFieldEvaluator(structural, { adapterInfo, maxElementsPerDispatch: 100 });
  const seams: Array<Record<string, unknown>> = [];
  for (const count of [1, 63, 64, 65, 127, 128, 129, 255, 256, 257, 1000]) {
    const base = snapshot(await cook(chainGraph(makeTransformGeometry(count), steps).g, { gpu: unchunked }));
    const c128 = snapshot(await cook(chainGraph(makeTransformGeometry(count), steps).g, { gpu: forced128 }));
    const c100 = snapshot(await cook(chainGraph(makeTransformGeometry(count), steps).g, { gpu: forced100 }));
    const cpu = snapshot(await cook(chainGraph(makeTransformGeometry(count), steps).g));
    seams.push({
      count,
      chunk128EqualsUnchunked: allAttrsEqual(base, c128),
      chunk64EqualsUnchunked: allAttrsEqual(base, c100),
      // A float chain never matches the CPU bit-for-bit; the CPU leg is
      // here only to prove the attribute SHAPES survive chunking.
      sameAttrShapes: [...cpu.keys()].join(",") === [...base.keys()].join(","),
    });
  }
  // One naturally-chunked fused run: 4.3M > 65535 * 64 = 4,194,240, so
  // the DEFAULT evaluator must split every member kernel into two
  // dispatches. The chain is in the bit-exact family, so the bytes must
  // match the CPU cook exactly.
  const bigCount = 4_300_000;
  const bigSteps: ChainStep[] = [
    {
      def: anyDef(setAttribute),
      params: { name: "r", value: spec({ fn: "randomField", key: "big" }) },
    },
    { def: anyDef(jitterPoints), params: { amount: [0.25, 0.5, 0.125], seed: 6 } },
  ];
  const started = performance.now();
  const bigFused = await cook(chainGraph(leanGeometry(bigCount), bigSteps).g, { gpu: unchunked });
  const bigMs = Math.round(performance.now() - started);
  const bigCpu = await cook(chainGraph(leanGeometry(bigCount), bigSteps).g);
  const big = {
    count: bigCount,
    ms: bigMs,
    residentRuns: bigFused.stats.gpu!.residentRuns,
    fallbacks: bigFused.stats.gpu!.fallbacks,
    equalsCpu: allAttrsEqual(snapshot(bigCpu), snapshot(bigFused)),
  };
  return { seams, big };
}

/**
 * Runs the planner genuinely cannot model: the per-node path must serve,
 * surfacing exactly the bytes (or exactly the error) a CPU-only cook
 * would, with `run-plan-failed` counted once.
 */
async function planRejections(ev: GpuFieldEvaluator): Promise<Array<Record<string, unknown>>> {
  const cases: Array<{ name: string; steps: ChainStep[]; geo: () => Geometry }> = [
    {
      // A tuple-3 value into a tuple-1 attribute: the CPU throws, and
      // the fused path must surface the identical error.
      name: "tupleMismatch",
      geo: () => makeCorpusGeometry(300),
      steps: [
        {
          def: anyDef(setAttribute),
          params: { name: "x", type: "f32", tupleSize: 1, value: spec({ fn: "position" }) },
        },
        { def: anyDef(jitterPoints), params: { amount: [0.25, 0.25, 0.25] } },
      ],
    },
    {
      // A field reading a string attribute never lowers to WGSL: the
      // run is rejected, and the per-node path resolves on the CPU.
      name: "stringAttrField",
      geo: () => {
        const geo = makeCorpusGeometry(300);
        const label = geo.attrs.point.add("label", "string", 1, "");
        label.fill("x", 0, 300);
        return geo;
      },
      steps: [
        {
          def: anyDef(setAttribute),
          params: { name: "s", type: "f32", tupleSize: 1, value: spec({ fn: "attribute", name: "label" }) },
        },
        { def: anyDef(jitterPoints), params: { amount: [0.25, 0.25, 0.25] } },
      ],
    },
    {
      // A kernel needing more storage buffers than the baseline limit
      // guarantees: the run is rejected, every member cooks per-node,
      // and the CPU serves the field — a SUCCESSFUL fallback.
      name: "tooManyBuffers",
      geo: () => {
        const geo = makeCorpusGeometry(400);
        const set = geo.attrs.point;
        const cols = Array.from({ length: 8 }, (_, a) => set.add(`a${a}`, "f32", 1, 0));
        set.resize(400);
        for (let i = 0; i < 400; i++) {
          for (let a = 0; a < 8; a++) cols[a].data[i] = hashFloat(hashCombine(900 + a, i));
        }
        return geo;
      },
      steps: [
        {
          def: anyDef(setAttribute),
          params: {
            name: "sum",
            type: "f32",
            tupleSize: 1,
            // 8 attribute inputs + 1 output > the baseline 8 storage buffers.
            value: spec(
              Array.from({ length: 7 }, (_, a) => ({ fn: "attribute", name: `a${a + 1}` })).reduce<
                Record<string, unknown>
              >((acc, cur) => ({ fn: "add", args: [acc, cur] }), { fn: "attribute", name: "a0" }),
            ),
          },
        },
        { def: anyDef(jitterPoints), params: { amount: [0.25, 0.25, 0.25] } },
      ],
    },
  ];
  const out: Array<Record<string, unknown>> = [];
  for (const c of cases) {
    const cpu = await cook(chainGraph(c.geo(), c.steps).g).then(
      (r) => ({ result: r, err: null as unknown }),
      (e: unknown) => ({ result: null, err: e }),
    );
    const fused = await cook(chainGraph(c.geo(), c.steps).g, { gpu: ev }).then(
      (r) => ({ result: r, err: null as unknown }),
      (e: unknown) => ({ result: null, err: e }),
    );
    out.push({
      name: c.name,
      cpuThrew: cpu.err !== null,
      fusedThrew: fused.err !== null,
      sameMessage:
        cpu.err instanceof Error && fused.err instanceof Error
          ? cpu.err.message === fused.err.message
          : cpu.err === null && fused.err === null,
      fallbacks: fused.result?.stats.gpu?.fallbacks ?? {},
      residentRuns: fused.result?.stats.gpu?.residentRuns ?? -1,
      equalsCpu:
        cpu.result !== null && fused.result !== null
          ? allAttrsEqual(snapshot(cpu.result), snapshot(fused.result))
          : null,
    });
  }
  return out;
}

/**
 * Passthrough fidelity: a fused run must carry everything it does not
 * touch — topology, other domains, string attributes and their tables,
 * wide tuples — exactly as the per-node clone chain would.
 */
async function passthrough(ev: GpuFieldEvaluator): Promise<Record<string, unknown>> {
  const build = (): Geometry => {
    const geo = createTriangleMesh([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3]);
    const set = geo.attrs.point;
    const wide = set.add("wide", "f32", 5, [0, 0, 0, 0, 0]);
    const label = set.add("label", "string", 1, "");
    const density = set.add("density", "f32", 1, 0);
    set.resize(4);
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < 5; k++) wide.data[i * 5 + k] = hashFloat(hashCombine(811, i, k));
      density.data[i] = hashFloat(hashCombine(812, i));
    }
    label.fill("alpha", 0, 2);
    label.fill("beta", 2, 2);
    geo.attrs.primitive.add("pid", "u32", 1, 0);
    geo.attrs.primitive.require("pid").data[1] = 7;
    geo.attrs.detail.add("note", "f32", 1, 0.5);
    return geo;
  };
  const steps: ChainStep[] = [
    { def: anyDef(setAttribute), params: { name: "d", value: spec({ fn: "randomField", key: "p" }) } },
    { def: anyDef(jitterPoints), params: { amount: [0.25, 0.5, 0.125], seed: 21 } },
  ];
  const cpu = await cook(chainGraph(build(), steps).g);
  const fused = await cook(chainGraph(build(), steps).g, { gpu: ev });
  const geoOf = (r: CookResult): Geometry => {
    const item = r.outputs.out[0];
    if (item.kind !== "geometry") throw new Error("passthrough: expected geometry");
    return item.geo;
  };
  const a = geoOf(cpu);
  const b = geoOf(fused);
  const domainEqual = (domain: "vertex" | "primitive" | "detail"): boolean =>
    allAttrsEqual(domainSnapshot(a, domain), domainSnapshot(b, domain));
  const topoEqual =
    bytesEqual(new Uint8Array(a.vertexToPoint.buffer.slice(0)), new Uint8Array(b.vertexToPoint.buffer.slice(0))) &&
    a.primitiveCount === b.primitiveCount &&
    a.vertexCount === b.vertexCount;
  const labelA = a.attrs.point.require("label");
  const labelB = b.attrs.point.require("label");
  const labelsEqual = [0, 1, 2, 3].every((i) => labelA.getString(i) === labelB.getString(i));
  return {
    residentRuns: fused.stats.gpu!.residentRuns,
    pointAttrsEqual: allAttrsEqual(snapshot(cpu), snapshot(fused)),
    names: [...snapshot(fused).keys()],
    vertexEqual: domainEqual("vertex"),
    primitiveEqual: domainEqual("primitive"),
    detailEqual: domainEqual("detail"),
    topoEqual,
    labelsEqual,
  };
}

function domainSnapshot(geo: Geometry, domain: "vertex" | "primitive" | "detail"): Map<string, AttrSnapshot> {
  const set = geo.attrs[domain];
  const out = new Map<string, AttrSnapshot>();
  for (const name of set.names()) {
    const attr = set.require(name);
    const n = set.count * attr.tupleSize;
    const view = attr.data;
    out.set(name, {
      name,
      type: attr.type,
      tupleSize: attr.tupleSize,
      bytes: new Uint8Array(
        view.buffer,
        view.byteOffset,
        n * (view as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT,
      ).slice(),
      data: (view as unknown as { subarray(a: number, b: number): ArrayLike<number> }).subarray(0, n),
    });
  }
  return out;
}

/** budgetMs slices the run between member kernels; bytes must not move. */
async function budgetSlicing(ev: GpuFieldEvaluator): Promise<Record<string, unknown>> {
  const steps = mixedChain();
  const plain = snapshot(await cook(chainGraph(makeTransformGeometry(3000), steps).g, { gpu: ev }));
  const sliced = await cook(chainGraph(makeTransformGeometry(3000), steps).g, {
    gpu: ev,
    budgetMs: 0, // every member boundary yields to the event loop
  });
  return {
    residentRuns: sliced.stats.gpu!.residentRuns,
    equalsUnsliced: allAttrsEqual(plain, snapshot(sliced)),
  };
}

/** Member descriptors for a built chain, exactly as the executor builds them. */
function membersOf(g: Graph, ids: readonly string[]): ResidentMemberDesc[] {
  return ids.map((id) => {
    const node = g.require(id);
    return {
      id,
      type: node.def.type,
      kind: node.def.resident!.kind,
      params: node.params as Readonly<Record<string, unknown>>,
      seed: deriveNodeSeed(g.seed, id),
    };
  });
}

function attrDescs(geo: Geometry): Record<string, { type: AttrType; tupleSize: number }> {
  const attributes: Record<string, { type: AttrType; tupleSize: number }> = {};
  for (const attr of geo.attrs.point) {
    attributes[attr.name] = { type: attr.type, tupleSize: attr.tupleSize };
  }
  return attributes;
}

async function cancellation(ev: GpuFieldEvaluator): Promise<Record<string, unknown>> {
  const count = 4096;
  const steps = mixedChain();
  const geo = makeTransformGeometry(count);
  const built = chainGraph(makeTransformGeometry(count), steps);
  const members = membersOf(built.g, built.ids);
  const ctx = { attributes: attrDescs(geo), count };

  const inFlight = (): number => {
    const s = ev.poolStats;
    return s.buffersCreated - s.buffersDestroyed - s.pooledBuffers;
  };
  const before = inFlight();

  // Abort between member kernels: the signal reports aborted from its
  // second read, which lands inside executeRun's per-member check.
  const plan = ev.planRun(members, ctx);
  let reads = 0;
  const signal = {
    get aborted(): boolean {
      return ++reads > 1;
    },
  } as unknown as AbortSignal;
  const stats: GpuCookStats = createGpuCookStats();
  const failure = await ev.executeRun!(plan!, { geo, signal }, stats).then(
    () => null,
    (e: unknown) => e,
  );
  const afterAbort = inFlight();

  // The evaluator must still work: the same plan, no signal, matching
  // the per-node/CPU chain output shapes and the fused cook bytes.
  const recovered = await ev.executeRun!(plan!, { geo }, createGpuCookStats());
  const fusedCook = snapshot(await cook(chainGraph(makeTransformGeometry(count), steps).g, { gpu: ev }));
  const afterRecovery = inFlight();

  // Cook-level cancellation: abort while the run's readback is pending.
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 0);
  const cookErr = await cook(chainGraph(makeTransformGeometry(count), steps).g, {
    gpu: ev,
    signal: controller.signal,
  }).then(
    () => null,
    (e: unknown) => e,
  );
  const postCook = snapshot(await cook(chainGraph(makeTransformGeometry(count), steps).g, { gpu: ev }));

  return {
    planned: plan !== null,
    cancelledName: failure instanceof Error ? failure.name : String(failure),
    isCookCancelled: failure instanceof CookCancelledError,
    statsAfterAbort: {
      residentRuns: stats.residentRuns,
      fusedNodes: stats.fusedNodes,
      readbacksSaved: stats.readbacksSaved,
    },
    inFlightBefore: before,
    inFlightAfterAbort: afterAbort,
    inFlightAfterRecovery: afterRecovery,
    recoveredEqualsFusedCook: allAttrsEqual(snapshotGeo(recovered.geo), fusedCook),
    cookCancelledName: cookErr instanceof Error ? cookErr.name : String(cookErr),
    isCookLevelCancelled: cookErr instanceof CookCancelledError,
    postCancelCookEqualsFused: allAttrsEqual(postCook, fusedCook),
  };
}

async function memoryBound(
  structural: GpuDeviceLike,
  adapterInfo: { vendor?: string },
  perNode: GpuFieldResolver,
): Promise<Record<string, unknown>> {
  const count = 4096;
  const steps = mixedChain();
  const geo = makeTransformGeometry(count);
  const built = chainGraph(makeTransformGeometry(count), steps);
  const outcome = planResidentRun(membersOf(built.g, built.ids), {
    attributes: attrDescs(geo),
    count,
  }, Number.MAX_SAFE_INTEGER);
  if (!("plan" in outcome)) throw new Error(`memoryBound: reference plan rejected (${outcome.reason})`);
  const totalBytes = outcome.plan.totalBytes;

  const exact = new GpuFieldEvaluator(structural, { adapterInfo, maxResidentBytes: totalBytes });
  const tooSmall = new GpuFieldEvaluator(structural, {
    adapterInfo,
    maxResidentBytes: totalBytes - 1,
  });
  const fits = await cook(chainGraph(makeTransformGeometry(count), steps).g, { gpu: exact });
  const rejected = await cook(chainGraph(makeTransformGeometry(count), steps).g, { gpu: tooSmall });
  const viaPerNode = await cook(chainGraph(makeTransformGeometry(count), steps).g, { gpu: perNode });

  return {
    totalBytes,
    fitsStats: statsOf(fits),
    rejectedStats: statsOf(rejected),
    rejectedEqualsPerNode: allAttrsEqual(snapshot(rejected), snapshot(viaPerNode)),
    fitsEqualsRejected: allAttrsEqual(snapshot(fits), snapshot(rejected)),
  };
}

/**
 * The one input class where phase 25 MOVES bytes, isolated and pinned.
 * A WGSL front end may flush an f32 LITERAL that is `-0` or subnormal to
 * `+0` (the D3D12 back end does), so the constant column a run used to
 * materialize from `wgslF32(v)` carried `+0` where the CPU carries the
 * true bits. A value read from a uniform buffer is not a literal and is
 * not flushed, so the same constant now survives — the fused chain moves
 * ONTO the CPU reference rather than away from it.
 *
 * Both halves are measured here on identical values: the plain param
 * (uniform slot) and the same constant authored as a Field (still a
 * baked-literal column, the pre-phase-25 path, unchanged by this phase).
 */
async function constantEdges(ev: GpuFieldEvaluator): Promise<Record<string, unknown>> {
  // -0, a subnormal, and the smallest positive subnormal f32.
  const EDGE = [-0, 1e-40, 1.401298464324817e-45];
  const chain = (value: unknown): ChainStep[] => [
    { def: anyDef(setAttribute), params: { name: "edge", type: "f32", tupleSize: 3, value } },
    {
      def: anyDef(setAttribute),
      params: { name: "t", type: "u32", tupleSize: 1, value: spec({ fn: "index" }) },
    },
  ];
  const words = (snap: Map<string, AttrSnapshot>): string[] => {
    const bytes = snap.get("edge")!.bytes;
    const u32 = new Uint32Array(bytes.buffer, bytes.byteOffset, 3);
    return [...u32].map((w) => `0x${w.toString(16).padStart(8, "0")}`);
  };
  const count = 64;
  const cpu = snapshot(await cook(chainGraph(makeCorpusGeometry(count), chain([...EDGE])).g));
  const uniform = snapshot(
    await cook(chainGraph(makeCorpusGeometry(count), chain([...EDGE])).g, { gpu: ev }),
  );
  const literal = snapshot(
    await cook(
      chainGraph(makeCorpusGeometry(count), chain(spec({ fn: "constant", value: [...EDGE] }))).g,
      { gpu: ev },
    ),
  );
  return {
    cpuWords: words(cpu),
    uniformWords: words(uniform),
    literalWords: words(literal),
    uniformEqualsCpu: allAttrsEqual(cpu, uniform),
    literalEqualsCpu: allAttrsEqual(cpu, literal),
  };
}

/**
 * The uniform-constant payoff: editing a constant param (or the up
 * hint, which also rides the uniform) must rebind a uniform and reuse
 * the pipeline — never recompile — while still producing the bytes the
 * NEW value should produce. A stale uniform would pass the cache
 * assertions alone, so every edit is additionally checked against a
 * fused cook of a graph BUILT with the new value (same node ids, so the
 * same seeds and the same expected bytes). The CPU reference for
 * constants riding the uniform lives in the bit-exact chains
 * (`constStores4`, `remapConst5`) and in `constantEdges`, not here.
 */
async function constantEdits(
  structural: GpuDeviceLike,
  adapterInfo: { vendor?: string },
): Promise<Record<string, unknown>> {
  const ev = new GpuFieldEvaluator(structural, { adapterInfo });
  // Fixed node ids so a rebuilt graph derives the same node seeds and
  // must produce byte-identical output for the same params.
  // Handle types stay inferred: annotating them erases each node's param
  // type and makes `setParam`'s key parameter `never`.
  const build = (translate: readonly number[], up: readonly number[]) => {
    const g = new Graph(7);
    const din = g.add(dataInput, { items: [makeGeometryItem(makeCorpusGeometry(1024))] }, "din");
    const sa = g.add(setAttribute, { name: "d", value: spec({ fn: "randomField", key: "c" }) }, "sa");
    const tr = g.add(
      transformPoints,
      { translate: [...translate], rotateEuler: [0, 90, 0], scale: [2, 2, 2] },
      "tr",
    );
    const jit = g.add(jitterPoints, { amount: [0.25, 0.5, 0.125], seed: 3 }, "jit");
    const or = g.add(
      orientAlongVector,
      { direction: spec({ fn: "position" }), axis: "+z", up: [...up] },
      "or",
    );
    g.connect(din, "out", sa, "in");
    g.connect(sa, "out", tr, "in");
    g.connect(tr, "out", jit, "in");
    g.connect(jit, "out", or, "in");
    g.output(or, "out", "out");
    return { g, tr, or };
  };

  const live = build([1, 2, 3], [0, 1, 0]);
  const first = await cook(live.g, { gpu: ev });
  const firstSnap = snapshot(first);
  const cacheAfterFirst = ev.pipelineCacheSize;

  // Edit a transformPoints constant: same kernels, new uniform values.
  live.g.setParam(live.tr, "translate", [-4.5, 0.25, 7]);
  const edited = await cook(live.g, { gpu: ev });
  const editedSnap = snapshot(edited);
  const cacheAfterEdit = ev.pipelineCacheSize;
  // The authoritative check on the rebound uniform: a graph BUILT with
  // the new value cooks to the same bytes (a stale uniform would not).
  const freshEdited = snapshot(await cook(build([-4.5, 0.25, 7], [0, 1, 0]).g, { gpu: ev }));

  // Edit the up hint (a uniform slot since phase 25, a baked literal
  // before it): also a cache hit now.
  live.g.setParam(live.or, "up", [1, 0, 0]);
  const upEdited = await cook(live.g, { gpu: ev });
  const upSnap = snapshot(upEdited);
  const cacheAfterUp = ev.pipelineCacheSize;
  const freshUpEdited = snapshot(await cook(build([-4.5, 0.25, 7], [1, 0, 0]).g, { gpu: ev }));

  return {
    firstStats: statsOf(first),
    editStats: statsOf(edited),
    upEditStats: statsOf(upEdited),
    cacheAfterFirst,
    cacheAfterEdit,
    cacheAfterUp,
    // The edits must actually change the output...
    editChangedP: !bytesEqual(firstSnap.get("P")!.bytes, editedSnap.get("P")!.bytes),
    upEditChangedRot: !bytesEqual(editedSnap.get("rot")!.bytes, upSnap.get("rot")!.bytes),
    // ...to exactly the bytes the new values produce from scratch.
    editMatchesFresh: allAttrsEqual(freshEdited, editedSnap),
    upEditMatchesFresh: allAttrsEqual(freshUpEdited, upSnap),
  };
}

async function statsSemantics(
  structural: GpuDeviceLike,
  adapterInfo: { vendor?: string },
): Promise<Record<string, unknown>> {
  // A fresh evaluator: first a per-node cook of a single fusable node
  // (never a run), then a fused chain reusing the same field kernel.
  const ev = new GpuFieldEvaluator(structural, { adapterInfo });
  const value = spec({ fn: "randomField", key: "shared" });
  const single = await cook(
    chainGraph(makeCorpusGeometry(1024), [
      { def: anyDef(setAttribute), params: { name: "d", value } },
    ]).g,
    { gpu: ev },
  );
  const cacheAfterSingle = ev.pipelineCacheSize;
  const fused = await cook(
    chainGraph(makeCorpusGeometry(1024), [
      { def: anyDef(setAttribute), params: { name: "d", value } },
      { def: anyDef(jitterPoints), params: { amount: [0.25, 0.5, 0.125] } },
    ]).g,
    { gpu: ev },
  );
  const cacheAfterFused = ev.pipelineCacheSize;

  // Two runs in one cook, split by a non-fusable node in the middle.
  const geo = makeCorpusGeometry(512);
  const g = new Graph(7);
  const din = g.add(dataInput, { items: [makeGeometryItem(geo)] });
  const sa1 = g.add(setAttribute, { name: "a", value });
  const jit1 = g.add(jitterPoints, { amount: [0.25, 0.25, 0.25] });
  const sb = g.add(setBounds);
  const sa2 = g.add(setAttribute, { name: "b", value });
  const jit2 = g.add(jitterPoints, { amount: [0.5, 0.5, 0.5], seed: 2 });
  g.connect(din, "out", sa1, "in");
  g.connect(sa1, "out", jit1, "in");
  g.connect(jit1, "out", sb, "in");
  g.connect(sb, "out", sa2, "in");
  g.connect(sa2, "out", jit2, "in");
  g.output(jit2, "out", "out");
  const two = await cook(g, { gpu: ev });

  const cpuTwo = await cook(
    (() => {
      const h = new Graph(7);
      const d2 = h.add(dataInput, { items: [makeGeometryItem(makeCorpusGeometry(512))] }, din.id);
      const a1 = h.add(setAttribute, { name: "a", value }, sa1.id);
      const j1 = h.add(jitterPoints, { amount: [0.25, 0.25, 0.25] }, jit1.id);
      const b1 = h.add(setBounds, {}, sb.id);
      const a2 = h.add(setAttribute, { name: "b", value }, sa2.id);
      const j2 = h.add(jitterPoints, { amount: [0.5, 0.5, 0.5], seed: 2 }, jit2.id);
      h.connect(d2, "out", a1, "in");
      h.connect(a1, "out", j1, "in");
      h.connect(j1, "out", b1, "in");
      h.connect(b1, "out", a2, "in");
      h.connect(a2, "out", j2, "in");
      h.output(j2, "out", "out");
      return h;
    })(),
  );

  return {
    singleStats: statsOf(single),
    cacheAfterSingle,
    fusedStats: statsOf(fused),
    cacheAfterFused,
    twoRunStats: statsOf(two),
    twoRunEqualsCpu: allAttrsEqual(snapshot(two), snapshot(cpuTwo)),
  };
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const gpu = create([]);
  const adapter = await gpu.requestAdapter();
  if (adapter === null) {
    process.stdout.write(JSON.stringify({ ok: false, error: "no WebGPU adapter" }));
    return;
  }
  const device = await adapter.requestDevice();
  const structural: GpuDeviceLike = device;
  const out: Record<string, unknown> = { ok: true };

  out.validation = await validateKernels(structural, device as unknown as ErrorScopes);

  const evaluator = new GpuFieldEvaluator(structural, { adapterInfo: adapter.info });
  out.salt = evaluator.cacheSalt;
  const perNode = perNodeResolver(evaluator);

  const chains: Array<Record<string, unknown>> = [];
  for (const c of chainCases()) chains.push(await runChainCase(c, evaluator, perNode));
  out.chains = chains;

  out.semantics = {
    transform: await transformSemantics(evaluator),
    orient: await orientSemantics(evaluator),
    jitter: await jitterSemantics(evaluator),
  };

  out.determinism = await determinism(evaluator);
  out.chunking = await chunkSeams(structural, adapter.info);
  out.rejections = await planRejections(evaluator);
  out.passthrough = await passthrough(evaluator);
  out.budget = await budgetSlicing(evaluator);
  out.cancellation = await cancellation(evaluator);
  out.memoryBound = await memoryBound(structural, adapter.info, perNode);
  out.stats = await statsSemantics(structural, adapter.info);
  out.constantEdits = await constantEdits(structural, adapter.info);
  out.constantEdges = await constantEdges(evaluator);

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
