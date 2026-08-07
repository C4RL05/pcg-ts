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
import type { ResidentMemberDesc, ResidentRunContext } from "../fields/index.js";
import { fieldFromJson, type FieldSpec } from "../nodes/fieldJson.js";
import { planResidentRun } from "./run.js";

const field = (s: object) => fieldFromJson(s as FieldSpec);

/** Point layout of the demo rig's scattered cloud. */
const POINT_LAYOUT: ResidentRunContext["attributes"] = { P: { type: "f32", tupleSize: 3 } };

interface StepShape {
  readonly uniformBytes: number;
  readonly consts: readonly number[];
  readonly bindings: readonly { readonly binding: number; readonly ref: unknown }[];
  readonly wgsl: string;
  readonly key: string;
}

interface PlanShape {
  readonly totalBytes: number;
  readonly cols: readonly number[];
  readonly members: readonly { readonly steps: readonly StepShape[] }[];
  readonly materialize: boolean;
  readonly written: readonly { readonly name: string }[];
  readonly instances: { readonly assetId: string; readonly count: number; readonly bytes: number } | null;
}

function plan(
  members: readonly ResidentMemberDesc[],
  count: number,
  attributes = POINT_LAYOUT,
  maxBytes = Number.MAX_SAFE_INTEGER,
  needsGeometry = true,
): PlanShape {
  const outcome = planResidentRun(members, { attributes, count, needsGeometry }, maxBytes);
  if (!("plan" in outcome)) throw new Error(`expected a plan, got ${outcome.reason}`);
  return outcome.plan as unknown as PlanShape;
}

function rejection(
  members: readonly ResidentMemberDesc[],
  count: number,
  attributes = POINT_LAYOUT,
  maxBytes = Number.MAX_SAFE_INTEGER,
  needsGeometry = true,
): string {
  const outcome = planResidentRun(members, { attributes, count, needsGeometry }, maxBytes);
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
    expect(p.instances).toEqual({ assetId: "tree", count: 1000, bytes: 64_000 });
    expect(p.materialize).toBe(false);
    // Slots P(12) + rot(16) + scale(12) = 40 B/pt, plus 64 B/pt retained,
    // and NO readback staging at all.
    expect(p.totalBytes).toBe(1000 * (40 + 64));
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
    const p = plan(
      [
        member("jitterPoints", { amount: [1, 1, 1], seed: 0 }, "j"),
        member("jitterPoints", { amount: [2, 2, 2], seed: 1 }, "j2"),
      ],
      64,
      POINT_LAYOUT,
      Number.MAX_SAFE_INTEGER,
      false,
    );
    expect(p.materialize).toBe(true);
    expect(p.instances).toBeNull();
  });

  it("rejects a spawner that is not the last member, or that carries assetAttr", () => {
    expect(
      rejection(
        [spawn(), member("jitterPoints", { amount: [1, 1, 1], seed: 0 }, "j")],
        16,
        TRS_LAYOUT,
      ),
    ).toBe("run-plan-failed");
    expect(rejection([spawn({ assetAttr: "kind" })], 16, TRS_LAYOUT)).toBe("run-plan-failed");
    expect(rejection([spawn({ assetId: "" })], 16, TRS_LAYOUT)).toBe("run-plan-failed");
  });

  it("counts the retained buffer against the run's memory bound", () => {
    const exact = 8 * (40 + 64);
    expect(plan([spawn()], 8, TRS_LAYOUT, exact, false).totalBytes).toBe(exact);
    expect(rejection([spawn()], 8, TRS_LAYOUT, exact - 1, false)).toBe("run-too-large");
  });
});
