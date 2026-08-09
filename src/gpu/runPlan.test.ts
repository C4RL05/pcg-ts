/**
 * Resident-run PLANNER tests (CPU-only, device-free): `planResidentRun`
 * is synchronous and never touches a device, so the plan's shape — which
 * params become device columns, which ride the apply kernel's uniform,
 * the resulting working-set bytes and dispatch count, the binding
 * indices the role mapping produces, and the specialization keys — is
 * fully observable here. The device-side proof that these plans execute
 * to the same bytes lives in resident.device.test.ts.
 */
import { describe, expect, it } from "vitest";
import { mul, position, type ResidentMemberDesc, type ResidentRunContext } from "../fields/index.js";
import { fieldFromJson, getFieldSpec, type FieldSpec } from "../nodes/fieldJson.js";
import { compileFieldSpec } from "./compile.js";
import { planResidentRun } from "./run.js";

const field = (s: object) => fieldFromJson(s as FieldSpec);

/** Point layout of the demo rig's scattered cloud. */
const POINT_LAYOUT: ResidentRunContext["attributes"] = { P: { type: "f32", tupleSize: 3 } };

interface StepShape {
  readonly uniformBytes: number;
  readonly consts: readonly number[];
  readonly perBatch: boolean;
  readonly bindings: readonly { readonly binding: number; readonly ref: unknown }[];
  readonly wgsl: string;
  readonly key: string;
}

interface InstancesShape {
  readonly assetId: string;
  readonly assetAttr: string;
  readonly count: number;
  readonly bytes: number;
  readonly permBytes: number;
}

interface PlanShape {
  readonly totalBytes: number;
  readonly cols: readonly number[];
  readonly members: readonly { readonly steps: readonly StepShape[] }[];
  readonly materialize: boolean;
  readonly written: readonly { readonly name: string }[];
  readonly instances: InstancesShape | null;
}

function plan(
  members: readonly ResidentMemberDesc[],
  count: number,
  attributes = POINT_LAYOUT,
  maxBytes = Number.MAX_SAFE_INTEGER,
  needsGeometry = true,
  acceptDerived = false,
): PlanShape {
  const outcome = planResidentRun(
    members,
    { attributes, count, needsGeometry },
    maxBytes,
    acceptDerived,
  );
  if (!("plan" in outcome)) throw new Error(`expected a plan, got ${outcome.reason}`);
  return outcome.plan as unknown as PlanShape;
}

function rejection(
  members: readonly ResidentMemberDesc[],
  count: number,
  attributes = POINT_LAYOUT,
  maxBytes = Number.MAX_SAFE_INTEGER,
  needsGeometry = true,
  acceptDerived = false,
): string {
  const outcome = planResidentRun(
    members,
    { attributes, count, needsGeometry },
    maxBytes,
    acceptDerived,
  );
  if ("plan" in outcome) throw new Error("expected a rejection, got a plan");
  return outcome.reason;
}

const member = (kind: string, params: Record<string, unknown>, id = kind): ResidentMemberDesc => ({
  id,
  type: kind,
  kind,
  params,
  seed: 12345,
});

/** All member kernels the plan dispatches (field kernels + applies). */
const stepCount = (p: PlanShape): number => p.members.reduce((n, m) => n + m.steps.length, 0);

/** The apply kernel of member `i` (always its last step). */
const applyOf = (p: PlanShape, i: number): StepShape => {
  const steps = p.members[i].steps;
  return steps[steps.length - 1];
};

/**
 * The demo rig's fused chain (examples/08-gpu-fields): setAttribute →
 * jitterPoints → transformPoints(three constants) → setAttribute →
 * setAttribute, over a scattered point cloud.
 *
 * A STAND-IN, and knowingly so: the real demo's `tint` and `psize` carry
 * a `randomField` term, and this fixture uses plain perlin instead. The
 * difference is not cosmetic — the real chain DOES NOT PLAN AS ONE RUN
 * (the planner declines the identity-keyed `tint` because jitterPoints
 * and transformPoints have already rewritten P; see `specKeysOnIdentity`
 * in run.ts), while this one plans all five members. The executor
 * recovers the real chain's TAIL by re-planning suffixes — it fuses
 * [tint, psize], two members of five, measured in
 * resident.device.test.ts — but this file never sees that, because it
 * calls the planner directly. Everything below therefore measures the
 * byte and dispatch accounting of a five-member chain, which is what it
 * is for, and NOTHING below is evidence about what the shipped demo
 * does. Do not "restore fidelity" by adding randomField here without
 * moving these budgets — and if you do, the numbers stop describing a
 * fusable chain at all.
 */
function demoChain(): ResidentMemberDesc[] {
  const band = (seed: number): object => ({
    fn: "perlinNoise",
    opts: { seed, frequency: 0.35, normalized: true },
  });
  // The demo's wobble/tint are tuple-3 `vec` assemblies; psize is scalar.
  const noise = (seed: number): object => ({
    fn: "vec",
    args: [band(seed), band(seed + 1), band(seed + 2)],
  });
  return [
    member("setAttribute", { name: "wobble", type: "f32", tupleSize: 3, value: field(noise(1)) }, "wobble"),
    member("jitterPoints", { amount: field({ fn: "attribute", name: "wobble" }), seed: 7 }, "jitter"),
    member("transformPoints", { translate: [0, 0, 0], rotateEuler: [0, 14, 0], scale: [1, 0.92, 1] }, "xform"),
    member("setAttribute", { name: "tint", type: "f32", tupleSize: 3, value: field(noise(4)) }, "tint"),
    member("setAttribute", { name: "psize", type: "f32", tupleSize: 1, value: field(band(7)) }, "psize"),
  ];
}

/**
 * Working-set bytes of the demo chain at 1M points, before phase 25
 * moved constants into the uniform. Slots P/wobble/tint/psize = 10
 * f32/pt, readback the same 10, and columns 3 (wobble) + 3 (jitter
 * amount) + 3x3 (the transform constants) + 3 (tint) + 1 (psize) = 19
 * f32/pt: (10 + 19 + 10) * 4 = 156 bytes/pt. The three constant columns
 * alone were 36 of those 156 bytes — 36 MB at this count.
 */
const DEMO_BYTES_BEFORE_PHASE25 = 156_000_000;
/** ...and 12 member kernels: 5 applies + 7 field kernels. */
const DEMO_DISPATCHES_BEFORE_PHASE25 = 12;

describe("resident run planning: constant params ride the uniform", () => {
  it("allocates no column and no field kernel for a constant param", () => {
    const p = plan([member("transformPoints", { translate: [1, 2, 3], rotateEuler: [0, 90, 0], scale: [2, 2, 2] })], 100);
    expect(p.cols).toEqual([]); // no device columns at all
    expect(p.members[0].steps.length).toBe(1); // the apply kernel only
    const apply = applyOf(p, 0);
    // Three slots of vec4<f32> after a 16-byte-aligned scalar header.
    expect(apply.uniformBytes).toBe(16 + 3 * 16);
    expect(apply.consts).toEqual([1, 2, 3, 0, 0, 90, 0, 0, 2, 2, 2, 0]);
    // Only P binds; the working set is P plus its readback.
    expect(apply.bindings).toEqual([{ binding: 1, ref: { kind: "slot", index: 0 } }]);
    expect(p.totalBytes).toBe(100 * 3 * 4 * 2);
  });

  it("keeps a Field param on a column and a plain param in the uniform, in both orders", () => {
    // Column in the MIDDLE role: the only storage binding is b1, so P
    // shifts from b4 (all-column) down to b2.
    const middle = plan(
      [
        member("transformPoints", {
          translate: [0.5, 0.25, 0.125],
          rotateEuler: field({ fn: "position" }),
          scale: [2, 0.5, 4],
        }),
      ],
      64,
    );
    expect(middle.cols).toEqual([64 * 3 * 4]);
    const mApply = applyOf(middle, 0);
    expect(mApply.bindings).toEqual([
      { binding: 1, ref: { kind: "col", index: 0 } },
      { binding: 2, ref: { kind: "slot", index: 0 } },
    ]);
    expect(mApply.wgsl).toContain("@binding(1) var<storage, read> b1: array<f32>; // rotateEuler column");
    expect(mApply.wgsl).toContain("@binding(2) var<storage, read_write> b2: array<f32>; // attribute P");
    // Constant slots number in PARAM order, not binding order.
    expect(mApply.consts).toEqual([0.5, 0.25, 0.125, 0, 2, 0.5, 4, 0]);
    expect(mApply.wgsl).toContain("params.consts[0].x");
    expect(mApply.wgsl).toContain("params.consts[1].z");

    // Column FIRST: the same kernel shape with the roles swapped.
    const first = plan(
      [
        member("transformPoints", {
          translate: field({ fn: "position" }),
          rotateEuler: [0, 0, 0],
          scale: [2, 0.5, 4],
        }),
      ],
      64,
    );
    const fApply = applyOf(first, 0);
    expect(fApply.bindings).toEqual([
      { binding: 1, ref: { kind: "col", index: 0 } },
      { binding: 2, ref: { kind: "slot", index: 0 } },
    ]);
    expect(fApply.wgsl).toContain("@binding(1) var<storage, read> b1: array<f32>; // translate column");
    expect(fApply.key).not.toBe(mApply.key); // different specialization
  });

  it("shifts attribute bindings past every constant param, rot and scale included", () => {
    const attributes: ResidentRunContext["attributes"] = {
      P: { type: "f32", tupleSize: 3 },
      rot: { type: "f32", tupleSize: 4 },
      scale: { type: "f32", tupleSize: 3 },
    };
    const allConst = applyOf(
      plan(
        [member("transformPoints", { translate: [1, 1, 1], rotateEuler: [0, 0, 0], scale: [1, 1, 1] })],
        32,
        attributes,
      ),
      0,
    );
    // P, rot, scale take bindings 1..3 (they took 4..6 with columns).
    expect(allConst.bindings.map((b) => b.binding)).toEqual([1, 2, 3]);
    expect(allConst.wgsl).toContain("@binding(1) var<storage, read_write> b1: array<f32>; // attribute P");
    expect(allConst.wgsl).toContain("@binding(2) var<storage, read_write> b2: array<f32>; // attribute rot");
    expect(allConst.wgsl).toContain("@binding(3) var<storage, read_write> b3: array<f32>; // attribute scale");
    expect(allConst.wgsl).toContain("b1[i * 3u] = v.x + params.consts[0].x;");
  });

  it("broadcasts a scalar constant across a wider target exactly as a tuple-1 column does", () => {
    const apply = applyOf(
      plan([member("setAttribute", { name: "q", type: "f32", tupleSize: 4, value: 0.25 })], 16),
      0,
    );
    expect(apply.consts).toEqual([0.25, 0, 0, 0]);
    // Every component reads slot 0's x — the tuple-1 broadcast rule.
    for (const k of ["b1[i * 4u]", "b1[i * 4u + 1u]", "b1[i * 4u + 2u]", "b1[i * 4u + 3u]"]) {
      expect(apply.wgsl).toContain(`${k} = params.consts[0].x;`);
    }
  });

  it("puts orientAlongVector's up hint in a slot, f64-normalized once", () => {
    const apply = applyOf(
      plan([member("orientAlongVector", { direction: field({ fn: "position" }), axis: "+z", up: [0, -2, 0] })], 16),
      0,
    );
    expect(apply.consts).toEqual([0, -1, 0, 0]); // normalized, not [0,-2,0]
    expect(apply.uniformBytes).toBe(16 + 16);
    expect(apply.wgsl).toContain("let up = vec3<f32>(params.consts[0].x, params.consts[0].y, params.consts[0].z);");
    // A constant direction consumes slot 0, pushing up to slot 1.
    const constDir = applyOf(
      plan([member("orientAlongVector", { direction: [1, 0, 0], axis: "+z", up: [0, 1, 0] })], 16),
      0,
    );
    expect(constDir.consts).toEqual([1, 0, 0, 0, 0, 1, 0, 0]);
    expect(constDir.bindings).toEqual([{ binding: 1, ref: { kind: "slot", index: 0 } }]);
  });

  it("keys on WHICH params are constant, never on their values", () => {
    const a = plan(
      [
        member("transformPoints", { translate: [1, 2, 3], rotateEuler: [0, 0, 0], scale: [1, 1, 1] }, "x"),
        member("orientAlongVector", { direction: field({ fn: "position" }), axis: "+z", up: [0, 1, 0] }, "o"),
      ],
      8,
    );
    const b = plan(
      [
        member("transformPoints", { translate: [-7, 0.5, 99], rotateEuler: [0, 0, 0], scale: [1, 1, 1] }, "x"),
        member("orientAlongVector", { direction: field({ fn: "position" }), axis: "+z", up: [1, 0, 0] }, "o"),
      ],
      8,
    );
    // Same pipelines (keys AND text), different uniform payloads: a
    // constant edit rebinds a uniform, it never recompiles.
    for (const i of [0, 1]) {
      expect(applyOf(a, i).key).toBe(applyOf(b, i).key);
      expect(applyOf(a, i).wgsl).toBe(applyOf(b, i).wgsl);
      expect(applyOf(a, i).consts).not.toEqual(applyOf(b, i).consts);
    }
    // ...and no value ever reaches the WGSL text.
    expect(applyOf(b, 0).wgsl).not.toContain("99");
    expect(applyOf(b, 0).wgsl).not.toContain("0.5");
  });

  it("rejects a constant the constant column could not have carried", () => {
    const bad = (translate: unknown): string =>
      rejection([member("transformPoints", { translate, rotateEuler: [0, 0, 0], scale: [1, 1, 1] })], 8);
    expect(bad([1, Number.POSITIVE_INFINITY, 0])).toBe("run-plan-failed"); // not finite as f32
    expect(bad([1, Number.NaN, 0])).toBe("run-plan-failed");
    expect(bad([1, 1e39, 0])).toBe("run-plan-failed"); // overflows f32
    expect(bad([1, 2])).toBe("run-plan-failed"); // tuple 2 where 1 or 3 is required
    expect(bad([])).toBe("run-plan-failed");
    expect(bad([1, 2, 3, 4, 5])).toBe("run-plan-failed");
    expect(bad("nope")).toBe("run-plan-failed");
    // The largest finite f32 still plans (the column carried it too).
    expect(
      applyOf(
        plan(
          [member("transformPoints", { translate: [3.4028234663852886e38, 0, 0], rotateEuler: [0, 0, 0], scale: [1, 1, 1] })],
          8,
        ),
        0,
      ).consts[0],
    ).toBe(3.4028234663852886e38);
  });
});

describe("resident run planning: the demo chain's working set", () => {
  it("drops the three constant columns and their dispatches", () => {
    const p = plan(demoChain(), 1_000_000);
    // 4 field columns remain (wobble, jitter amount, tint, psize); the
    // three transformPoints constants are gone.
    expect(p.cols).toEqual([12_000_000, 12_000_000, 12_000_000, 4_000_000]);
    expect(p.totalBytes).toBe(120_000_000);
    expect(stepCount(p)).toBe(9);
    // The pinned before/after: 36 MB and 3 dispatches removed, 23% of
    // the working set, at no cost in produced bytes.
    expect(DEMO_BYTES_BEFORE_PHASE25 - p.totalBytes).toBe(36_000_000);
    expect(DEMO_DISPATCHES_BEFORE_PHASE25 - stepCount(p)).toBe(3);
    // transformPoints is now a single dispatch with no columns.
    expect(p.members.map((m) => m.steps.length)).toEqual([2, 2, 1, 2, 2]);
  });

  it("moves the run-too-large boundary down by exactly the constants' bytes", () => {
    const members = demoChain();
    const count = 1_000_000;
    // Exactly at the new working set it fuses; one byte under it does not.
    expect(plan(members, count, POINT_LAYOUT, 120_000_000).totalBytes).toBe(120_000_000);
    expect(rejection(members, count, POINT_LAYOUT, 119_999_999)).toBe("run-too-large");
    // A bound that rejected before phase 25 (one byte under the old
    // working set) now fits with room to spare.
    expect(plan(members, count, POINT_LAYOUT, DEMO_BYTES_BEFORE_PHASE25 - 1).totalBytes).toBe(120_000_000);
  });
});

// ---------------------------------------------------------------------------
// phase 32: the planner's own eligibility gate

describe("resident run planning: only AUTHORED specs are fusable", () => {
  /**
   * Since phase 32 a combinator field describes itself, so "has a spec"
   * and "may run on the device" are different questions and the planner
   * must ask the second one. Today `paramsFieldsAllSpecd` already filters
   * derived-spec members out upstream, so this seam is defence in depth —
   * which is exactly why it needs its own alarm: with the gate widened
   * only here, or only there, the two disagree and nothing else notices.
   */
  it("declines a derived-spec field and fuses the byte-identical authored one", () => {
    const derived = mul(position(), 0.1);
    const authored = field({
      fn: "mul",
      args: [{ fn: "position" }, { fn: "constant", value: 0.1 }],
    });
    // Same field and same spec — provenance is the ONLY difference, so
    // nothing below can be explained by the expression itself.
    expect(authored.key).toBe(derived.key);
    expect(getFieldSpec(derived)).toEqual(getFieldSpec(authored));
    // ...and that spec compiles: the planner is not declining something
    // the WGSL backend could not have handled.
    expect(() =>
      compileFieldSpec(getFieldSpec(derived) as FieldSpec, { attributes: POINT_LAYOUT }),
    ).not.toThrow();

    expect(rejection([member("jitterPoints", { amount: derived, seed: 7 })], 16)).toBe(
      "run-plan-failed",
    );
    const p = plan([member("jitterPoints", { amount: authored, seed: 7 })], 16);
    expect(p.cols).toEqual([16 * 3 * 4]); // one field column, one kernel
    expect(p.members[0].steps).toHaveLength(2);
  });

  it("rejects the whole run, not just the member, when one member's field is derived", () => {
    // A run is planned or it is not: a derived-spec param anywhere in the
    // chain must not leave a partially fused plan behind.
    // jitterPoints leads, because it keys on point identity and so may
    // only read a P the device has not rewritten yet (see below).
    const members = [
      member("jitterPoints", { amount: mul(position(), 0.25), seed: 3 }, "jit"),
      member("transformPoints", { translate: [1, 0, 0], rotateEuler: [0, 0, 0], scale: [1, 1, 1] }, "xf"),
    ];
    expect(rejection(members, 32)).toBe("run-plan-failed");
    // Authored, the same two members plan together.
    const ok = [
      member("jitterPoints", { amount: field({ fn: "mul", args: [{ fn: "position" }, 0.25] }), seed: 3 }, "jit"),
      members[1],
    ];
    expect(plan(ok, 32).members).toHaveLength(2);
  });

  it("declines an identity-keyed member once the device has rewritten P", () => {
    // jitterPoints and randomField hash the stored BIT PATTERN of P, so a
    // device-resident P that fused float math already moved is a different
    // KEY, not a value an ulp off. The tolerance the resident path spends
    // on magnitudes cannot be spent here, so the run is declined instead.
    const xform = member(
      "transformPoints",
      { translate: [1, 0, 0], rotateEuler: [0, 0, 0], scale: [1, 1, 1] },
      "xf",
    );
    expect(rejection([xform, member("jitterPoints", { amount: [1, 1, 1], seed: 3 }, "jit")], 32)).toBe(
      "run-plan-failed",
    );
    // Two jitters in a row: the first writes P, so the second declines.
    expect(
      rejection(
        [
          member("jitterPoints", { amount: [1, 1, 1], seed: 0 }, "j"),
          member("jitterPoints", { amount: [2, 2, 2], seed: 1 }, "j2"),
        ],
        32,
      ),
    ).toBe("run-plan-failed");
    // A randomField PARAM after a P write declines for the same reason,
    // while the same chain the other way round plans.
    expect(
      rejection(
        [
          xform,
          member(
            "setAttribute",
            { name: "r", type: "f32", tupleSize: 1, value: field({ fn: "randomField", key: "k" }) },
            "sa",
          ),
        ],
        32,
      ),
    ).toBe("run-plan-failed");
    expect(
      plan(
        [
          member(
            "setAttribute",
            { name: "r", type: "f32", tupleSize: 1, value: field({ fn: "randomField", key: "k" }) },
            "sa",
          ),
          xform,
        ],
        32,
      ).members,
    ).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// phase 26: the device-resident spawner terminal

/** Layout of a cloud carrying the full standard transform triple. */
const TRS_LAYOUT: ResidentRunContext["attributes"] = {
  P: { type: "f32", tupleSize: 3 },
  rot: { type: "f32", tupleSize: 4 },
  scale: { type: "f32", tupleSize: 3 },
};

const spawn = (params: Record<string, unknown> = {}): ResidentMemberDesc =>
  member("spawnInstances", { assetId: "tree", assetAttr: "", ...params }, "spawn");

describe("resident run planning: spawnInstances terminal", () => {
  it("adds one compose kernel, a retained buffer, and writes no attribute", () => {
    const p = plan([spawn()], 1000, TRS_LAYOUT, Number.MAX_SAFE_INTEGER, false);
    expect(p.members).toHaveLength(1);
    expect(p.members[0].steps).toHaveLength(1); // no field params, one apply
    expect(applyOf(p, 0).key).toBe("apply2|spawnInstances|rot=1|scl=1");
    expect(applyOf(p, 0).consts).toEqual([]);
    expect(applyOf(p, 0).uniformBytes).toBe(12); // the plain scalar header
    // P/rot/scale read, transforms written.
    expect(applyOf(p, 0).bindings).toEqual([
      { binding: 1, ref: { kind: "slot", index: 0 } },
      { binding: 2, ref: { kind: "slot", index: 1 } },
      { binding: 3, ref: { kind: "slot", index: 2 } },
      { binding: 4, ref: { kind: "out" } },
    ]);
    expect(p.written).toEqual([]); // a spawner mutates nothing
    expect(p.instances).toEqual({
      assetId: "tree",
      assetAttr: "",
      count: 1000,
      bytes: 64_000,
      permBytes: 0, // constant mode uploads no permutation
    });
    expect(applyOf(p, 0).perBatch).toBe(false); // one dispatch over everything
    expect(p.materialize).toBe(false);
    // Slots P(12) + rot(16) + scale(12) = 40 B/pt, plus 64 B/pt retained,
    // and NO readback staging at all.
    expect(p.totalBytes).toBe(1000 * (40 + 64));
  });

  it("the constant-assetId kernel keeps v0.7's key, header and body verbatim", () => {
    // Phase 29 must not move a byte of the single-asset path, which is
    // why neither APPLY_VERSION nor SALT_VERSION was bumped. The
    // specialization key (which selects the cached pipeline), the whole
    // uniform struct, the binding block and the body's index expressions
    // are pinned literally, so an accidental `base` field, `perm`
    // binding, or `src` indirection leaking into this variant fails here.
    const p = plan([spawn()], 8, TRS_LAYOUT, Number.MAX_SAFE_INTEGER, false);
    const apply = applyOf(p, 0);
    expect(apply.key).toBe("apply2|spawnInstances|rot=1|scl=1");
    expect(apply.uniformBytes).toBe(12);
    expect(apply.perBatch).toBe(false);
    expect(apply.wgsl).not.toContain("base");
    expect(apply.wgsl).not.toContain("perm");
    expect(apply.wgsl).not.toContain("src");
    expect(apply.wgsl).toContain(
      "struct PcgParams {\n  count: u32,\n  seed: u32,\n  chunkOffset: u32,\n}\n",
    );
    expect(apply.wgsl).toContain(
      "@group(0) @binding(0) var<uniform> params: PcgParams;\n" +
        "@group(0) @binding(1) var<storage, read> b1: array<f32>; // attribute P: f32 tupleSize 3\n" +
        "@group(0) @binding(2) var<storage, read> b2: array<f32>; // attribute rot: f32 tupleSize 4\n" +
        "@group(0) @binding(3) var<storage, read> b3: array<f32>; // attribute scale: f32 tupleSize 3\n" +
        "@group(0) @binding(4) var<storage, read_write> b4: array<f32>; // out: 16 f32 per instance\n",
    );
    // Every source read is the raw invocation index, not a permuted one.
    expect(apply.wgsl).toContain(
      "  let q = vec4<f32>(b2[i * 4u], b2[i * 4u + 1u], b2[i * 4u + 2u], b2[i * 4u + 3u]);\n" +
        "  let s = vec3<f32>(b3[i * 3u], b3[i * 3u + 1u], b3[i * 3u + 2u]);\n",
    );
    expect(apply.wgsl).toContain("b4[o + 12u] = b1[i * 3u];");
  });

  it("compiles rot/scale defaults out when the attributes are absent or mis-shaped", () => {
    const noneP = plan([spawn()], 8, { P: { type: "f32", tupleSize: 3 } }, Number.MAX_SAFE_INTEGER, false);
    expect(applyOf(noneP, 0).key).toBe("apply2|spawnInstances|rot=0|scl=0");
    expect(applyOf(noneP, 0).wgsl).toContain("vec4<f32>(0f, 0f, 0f, 1f)");
    expect(applyOf(noneP, 0).wgsl).toContain("vec3<f32>(1f, 1f, 1f)");
    expect(applyOf(noneP, 0).bindings).toHaveLength(2); // P + out

    // Mis-shaped rot/scale are IGNORED exactly as buildInstanceBatches
    // ignores them — never misread at the wrong stride.
    const bad = plan(
      [spawn()],
      8,
      {
        P: { type: "f32", tupleSize: 3 },
        rot: { type: "f32", tupleSize: 3 },
        scale: { type: "i32", tupleSize: 3 },
      },
      Number.MAX_SAFE_INTEGER,
      false,
    );
    expect(applyOf(bad, 0).key).toBe("apply2|spawnInstances|rot=0|scl=0");
  });

  it("still materializes (and reads back) when the cook needs the geometry", () => {
    const members = [
      member("transformPoints", { translate: [1, 0, 0], rotateEuler: [0, 0, 0], scale: [1, 1, 1] }, "xf"),
      spawn(),
    ];
    const withGeo = plan(members, 100, TRS_LAYOUT, Number.MAX_SAFE_INTEGER, true);
    expect(withGeo.materialize).toBe(true);
    expect(withGeo.written.map((w) => w.name)).toEqual(["P", "rot", "scale"]);
    // slots 40 + readback 40 + retained 64 bytes per point.
    expect(withGeo.totalBytes).toBe(100 * (40 + 40 + 64));

    const withoutGeo = plan(members, 100, TRS_LAYOUT, Number.MAX_SAFE_INTEGER, false);
    expect(withoutGeo.materialize).toBe(false);
    expect(withoutGeo.totalBytes).toBe(100 * (40 + 64));
  });

  it("a run with nothing else to produce always materializes", () => {
    // needsGeometry false but no instances output: the plan must still
    // read back, so ordinary plans are untouched by the new flag.
    // jitterPoints then transformPoints, not two jitters: an
    // identity-keyed member declines once the device has rewritten P.
    const p = plan(
      [
        member("jitterPoints", { amount: [1, 1, 1], seed: 0 }, "j"),
        member("transformPoints", { translate: [1, 0, 0], rotateEuler: [0, 0, 0], scale: [1, 1, 1] }, "xf"),
      ],
      64,
      POINT_LAYOUT,
      Number.MAX_SAFE_INTEGER,
      false,
    );
    expect(p.materialize).toBe(true);
    expect(p.instances).toBeNull();
  });

  it("rejects a spawner that is not the last member, or that has no assetId", () => {
    expect(
      rejection(
        [spawn(), member("jitterPoints", { amount: [1, 1, 1], seed: 0 }, "j")],
        16,
        TRS_LAYOUT,
      ),
    ).toBe("run-plan-failed");
    // An assetAttr naming an attribute this layout does not have still
    // rejects — but for the missing attribute, not for being an
    // assetAttr; see the multi-asset suite below.
    expect(rejection([spawn({ assetAttr: "kind" })], 16, TRS_LAYOUT)).toBe("run-plan-failed");
    expect(rejection([spawn({ assetId: "" })], 16, TRS_LAYOUT)).toBe("run-plan-failed");
  });

  it("counts the retained buffer against the run's memory bound", () => {
    const exact = 8 * (40 + 64);
    expect(plan([spawn()], 8, TRS_LAYOUT, exact, false).totalBytes).toBe(exact);
    expect(rejection([spawn()], 8, TRS_LAYOUT, exact - 1, false)).toBe("run-too-large");
  });
});


// ---------------------------------------------------------------------------
// phase 29: host-planned multi-asset grouping

/** TRS layout plus the string asset column the forest's spawner groups by. */
const SPECIES_LAYOUT: ResidentRunContext["attributes"] = {
  ...TRS_LAYOUT,
  species: { type: "string", tupleSize: 1 },
  height: { type: "f32", tupleSize: 1 },
};

describe("resident run planning: multi-asset spawner terminal", () => {
  it("plans the indexed compose kernel: perm binding, base uniform, per-batch dispatch", () => {
    const p = plan(
      [spawn({ assetAttr: "species" })],
      1000,
      SPECIES_LAYOUT,
      Number.MAX_SAFE_INTEGER,
      false,
    );
    const apply = applyOf(p, 0);
    expect(apply.key).toBe("apply2|spawnInstances|rot=1|scl=1|perm");
    // The `base` u32 rides the padding the vec4 alignment already
    // reserved, so the header grows by exactly one word.
    expect(apply.uniformBytes).toBe(16);
    expect(apply.perBatch).toBe(true);
    // P/rot/scale/transforms keep their v0.7 binding indices; perm is
    // appended, and is the ONLY new binding.
    expect(apply.bindings).toEqual([
      { binding: 1, ref: { kind: "slot", index: 0 } },
      { binding: 2, ref: { kind: "slot", index: 1 } },
      { binding: 3, ref: { kind: "slot", index: 2 } },
      { binding: 4, ref: { kind: "out" } },
      { binding: 5, ref: { kind: "perm" } },
    ]);
    expect(p.instances).toEqual({
      assetId: "tree",
      assetAttr: "species",
      count: 1000,
      bytes: 64_000,
      permBytes: 4000,
    });
    // The string column is NEVER uploaded: the host resolves the key.
    expect(p.members[0].steps).toHaveLength(1);
    expect(p.written).toEqual([]);
  });

  it("indirects the SOURCE and leaves the DESTINATION as the invocation index", () => {
    const apply = applyOf(
      plan([spawn({ assetAttr: "species" })], 8, SPECIES_LAYOUT, Number.MAX_SAFE_INTEGER, false),
      0,
    );
    expect(apply.wgsl).toContain("  base: u32,");
    expect(apply.wgsl).toContain("let src = b5[params.base + i];");
    // Reads permuted...
    expect(apply.wgsl).toContain("b1[src * 3u]");
    expect(apply.wgsl).toContain("b2[src * 4u]");
    expect(apply.wgsl).toContain("b3[src * 3u]");
    // ...writes are dense and unpermuted, or two lanes could collide.
    expect(apply.wgsl).toContain("let o = i * 16u;");
    expect(apply.wgsl).not.toContain("src * 16u");
  });

  it("counts the permutation upload against the run's memory bound", () => {
    // 40 B/pt of slots + 64 B/pt retained + 4 B/pt of permutation.
    const exact = 8 * (40 + 64 + 4);
    expect(
      plan([spawn({ assetAttr: "species" })], 8, SPECIES_LAYOUT, exact, false).totalBytes,
    ).toBe(exact);
    expect(rejection([spawn({ assetAttr: "species" })], 8, SPECIES_LAYOUT, exact - 1, false)).toBe(
      "run-too-large",
    );
  });

  it("rejects the two conditions the CPU spawner throws on, so the CPU raises them", () => {
    // Missing attribute, and an attribute of the wrong type. Both reject
    // as run-plan-failed; the per-node path then surfaces
    // buildInstanceBatches' identical, actionable message.
    expect(rejection([spawn({ assetAttr: "absent" })], 16, SPECIES_LAYOUT)).toBe("run-plan-failed");
    expect(rejection([spawn({ assetAttr: "height" })], 16, SPECIES_LAYOUT)).toBe("run-plan-failed");
    // A non-string param value is not a valid graph either.
    expect(rejection([spawn({ assetAttr: 7 })], 16, SPECIES_LAYOUT)).toBe("run-plan-failed");
  });

  it("still rejects a spawner that is not last, or that has no assetId", () => {
    expect(
      rejection(
        [spawn({ assetAttr: "species" }), member("jitterPoints", { amount: [1, 1, 1], seed: 0 }, "j")],
        16,
        SPECIES_LAYOUT,
      ),
    ).toBe("run-plan-failed");
    expect(rejection([spawn({ assetAttr: "species", assetId: "" })], 16, SPECIES_LAYOUT)).toBe(
      "run-plan-failed",
    );
  });

  it("fuses a chain ahead of a multi-asset spawner, terminal included", () => {
    const p = plan(
      [
        member("transformPoints", { translate: [1, 0, 0], rotateEuler: [0, 0, 0], scale: [1, 1, 1] }, "xf"),
        spawn({ assetAttr: "species" }),
      ],
      100,
      SPECIES_LAYOUT,
      Number.MAX_SAFE_INTEGER,
      false,
    );
    expect(p.members).toHaveLength(2);
    expect(applyOf(p, 0).perBatch).toBe(false); // the transform is not per-asset
    expect(applyOf(p, 1).perBatch).toBe(true);
    expect(p.instances?.permBytes).toBe(400);
  });

  it("stamps the plan format, so a shape change cannot silently reuse old plans", () => {
    // The tag is what stops a plan built by one shape of this code from
    // being executed by another. Phase 29 made `instances` plural and
    // added `permBytes`, so it moved to /4. Change the plan's shape and
    // this must move with it — an unbumped tag is a stale-plan bug, not
    // a cosmetic slip, and nothing else in the suite notices a revert.
    const p = plan(
      [member("transformPoints", { translate: [1, 2, 3], rotateEuler: [0, 90, 0], scale: [2, 2, 2] })],
      8,
    );
    expect((p as unknown as { readonly format: string }).format).toBe("pcg-resident-run/4");
  });
});
