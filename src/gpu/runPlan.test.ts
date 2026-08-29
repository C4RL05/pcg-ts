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
import { fieldFromJson, getFieldSpec, type FieldSpec } from "../fields/fieldJson.js";
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
  readonly colorAttr: string;
  readonly colorTupleSize: number;
  readonly count: number;
  readonly bytes: number;
  readonly colorBytes: number;
  readonly channels: readonly {
    readonly name: string;
    readonly type: string;
    readonly itemSize: number;
    readonly components: number;
    readonly byteStride: number;
  }[];
  readonly channelBytes: number;
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
 * The shipped fused chain (graphs/examples-gpu-fields.json):
 * setAttribute → jitterPoints → transformPoints(three constants) →
 * setAttribute → setAttribute, over a scattered point cloud.
 *
 * A STAND-IN, and knowingly so: the shipped `tint` and `psize` carry
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

/**
 * The contrast with `attributeIs` below, and the reason it is asserted
 * rather than assumed: a node-derived noise seed needs the same
 * per-dispatch `seed` uniform every `KernelStep` already carries, and a
 * `param` variant needs a const slot `paramConstValues` already fills
 * from a stamp. Neither is a per-dispatch string table and neither wants
 * a geometry, so a run containing one stays FUSED — the feature does not
 * make a node CPU-only.
 */
describe("resident run planning: a node-derived noise seed stays fused", () => {
  const noise = (seed: unknown): FieldSpec =>
    ({ fn: "perlinNoise", opts: { seed, frequency: 0.045 } }) as unknown as FieldSpec;

  it("fuses a member whose field derives its seed from the node", () => {
    const p = plan(
      [
        member(
          "setAttribute",
          { name: "h", type: "f32", tupleSize: 1, value: field(noise({ from: "node", variant: 3 })) },
          "sa",
        ),
      ],
      32,
    );
    expect(p.members).toHaveLength(1);
    // The recorded reason is absent, not merely the output equal: a
    // decline would have thrown out of `plan` above.
    expect(stepCount(p)).toBe(2); // one field kernel, one apply
  });

  it("fuses a param variant onto a uniform slot", () => {
    const p = plan(
      [
        member(
          "setAttribute",
          {
            name: "h",
            type: "f32",
            tupleSize: 1,
            value: field(noise({ from: "node", variant: { fn: "param", name: "v", value: 4 } })),
          },
          "sa",
        ),
      ],
      32,
    );
    expect(p.members).toHaveLength(1);
    // The value rides the step's const payload, exactly as any other
    // param's does — one slot, four components, the variant in `x`.
    expect(p.members[0].steps[0].consts).toEqual([4, 0, 0, 0]);
  });
});

describe("resident run planning: attributeIs needs a geometry a plan does not have", () => {
  /** A cloud carrying a string column, which is the only thing this needs. */
  const STRING_LAYOUT: ResidentRunContext["attributes"] = {
    P: { type: "f32", tupleSize: 3 },
    species: { type: "string", tupleSize: 1 },
  };

  it("declines the run and says so, rather than baking an index it cannot know", () => {
    const isPine = field({ fn: "attributeIs", name: "species", value: "pine" });
    // The kernel is not the problem, and this is the line that says so:
    // the identical spec compiles against the identical layout. What a
    // plan cannot do is FILL the uniform slot the kernel reads, because
    // the value in it is the literal's index in the string table of a
    // geometry — and `ResidentRunContext` carries attribute descriptors
    // and a count, never data. The per-node path dispatches this same
    // kernel and fills the slot from the geometry it is handed.
    const kernel = compileFieldSpec(getFieldSpec(isPine) as FieldSpec, { attributes: STRING_LAYOUT });
    expect(kernel.attrIsSlots).toEqual([{ attr: "species", value: "pine" }]);
    expect(kernel.wgsl).toContain("params.consts[0].x");

    expect(
      rejection(
        [
          member(
            "setAttribute",
            { name: "isPine", type: "f32", tupleSize: 1, value: isPine },
            "sa",
          ),
        ],
        32,
        STRING_LAYOUT,
      ),
    ).toBe("run-plan-failed");
  });

  it("rejects the whole run, not just the member that carries it", () => {
    // The same rule every other plan failure follows: a run is planned or
    // it is not, so a partially fused plan can never be left behind.
    const members = [
      member("transformPoints", { translate: [1, 0, 0], rotateEuler: [0, 0, 0], scale: [1, 1, 1] }, "xf"),
      member(
        "setAttribute",
        {
          name: "isPine",
          type: "f32",
          tupleSize: 1,
          value: field({ fn: "attributeIs", name: "species", value: "pine" }),
        },
        "sa",
      ),
    ];
    expect(rejection(members, 32, STRING_LAYOUT)).toBe("run-plan-failed");
    // ...and the same chain WITHOUT the predicate plans as one run, so
    // nothing above can be explained by the chain's shape.
    const ok = [
      members[0],
      member(
        "setAttribute",
        { name: "isPine", type: "f32", tupleSize: 1, value: field({ fn: "fraction" }) },
        "sa",
      ),
    ];
    expect(plan(ok, 32, STRING_LAYOUT).members).toHaveLength(2);
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
  member("spawnInstances", { assetId: "tree", assetAttr: "", colorAttr: "", ...params }, "spawn");

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
      colorAttr: "", // no colour asked for: no buffer, no binding
      colorTupleSize: 0,
      count: 1000,
      bytes: 64_000,
      colorBytes: 0,
      channels: [], // no channels asked for: no kernel, no buffer
      channelBytes: 0,
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
      colorAttr: "",
      colorTupleSize: 0,
      count: 1000,
      bytes: 64_000,
      colorBytes: 0,
      channels: [],
      channelBytes: 0,
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
    // added `permBytes`, so it moved to /4; phase 45 added the colour
    // output (`colorAttr`, `colorTupleSize`, `colorBytes`) and the
    // `colorOut` buffer ref, taking it to /5; named per-instance channels
    // added `channels`, `channelBytes` and the indexed `channelOut` ref,
    // so it is at /6. Change the plan's shape and
    // this must move with it — an unbumped tag is a stale-plan bug, not
    // a cosmetic slip, and nothing else in the suite notices a revert.
    const p = plan(
      [member("transformPoints", { translate: [1, 2, 3], rotateEuler: [0, 90, 0], scale: [2, 2, 2] })],
      8,
    );
    expect((p as unknown as { readonly format: string }).format).toBe("pcg-resident-run/6");
  });
});

// ---------------------------------------------------------------------------
// phase 45: per-instance colour, and the spawner's budget

/** TRS layout plus the two colour-shaped columns and one that is not. */
const COLOUR_LAYOUT: ResidentRunContext["attributes"] = {
  ...TRS_LAYOUT,
  color: { type: "f32", tupleSize: 4 },
  tint: { type: "f32", tupleSize: 3 },
  species: { type: "string", tupleSize: 1 },
  height: { type: "f32", tupleSize: 1 },
  flags: { type: "u32", tupleSize: 4 },
};

describe("resident run planning: instance colour", () => {
  it("gathers colour in the SAME kernel as the transform, from the same source", () => {
    // The structural guarantee, read off the generated body: one `i`,
    // one set of reads, no second traversal. A colour written by a kernel
    // of its own could drift from the matrix ordering; this cannot.
    const p = plan([spawn({ colorAttr: "color" })], 1000, COLOUR_LAYOUT, Number.MAX_SAFE_INTEGER, false);
    expect(p.members).toHaveLength(1);
    expect(p.members[0].steps).toHaveLength(1); // still ONE dispatch, not two
    const apply = applyOf(p, 0);
    expect(apply.key).toBe("apply2|spawnInstances|rot=1|scl=1|color=4");
    // The colour bindings come last, so P/rot/scale/transforms keep the
    // indices every earlier variant gave them.
    expect(apply.bindings).toEqual([
      { binding: 1, ref: { kind: "slot", index: 0 } },
      { binding: 2, ref: { kind: "slot", index: 1 } },
      { binding: 3, ref: { kind: "slot", index: 2 } },
      { binding: 4, ref: { kind: "out" } },
      { binding: 5, ref: { kind: "slot", index: 3 } }, // the colour column
      { binding: 6, ref: { kind: "colorOut" } },
    ]);
    // Read at the source's own tuple stride, written at 4.
    expect(apply.wgsl).toContain("let cs = i * 4u;");
    expect(apply.wgsl).toContain("let co = i * 4u;");
    expect(apply.wgsl).toContain("b6[co] = b5[cs];");
    expect(apply.wgsl).toContain("b6[co + 1u] = b5[cs + 1u];");
    expect(apply.wgsl).toContain("b6[co + 2u] = b5[cs + 2u];");
    // Alpha is DROPPED: the pad slot is a literal 0, never `b5[cs + 3u]`.
    expect(apply.wgsl).toContain("b6[co + 3u] = 0f;");
    expect(apply.wgsl).not.toContain("b5[cs + 3u]");
    expect(p.written).toEqual([]); // a spawner still mutates nothing
  });

  it("reads a 3-tuple source at ITS stride, and still writes 4 floats out", () => {
    // The two strides are independent: the source tuple is whatever the
    // attribute is, the destination is always the WGSL vec3 stride.
    const apply = applyOf(
      plan([spawn({ colorAttr: "tint" })], 8, COLOUR_LAYOUT, Number.MAX_SAFE_INTEGER, false),
      0,
    );
    expect(apply.key).toBe("apply2|spawnInstances|rot=1|scl=1|color=3");
    expect(apply.wgsl).toContain("let cs = i * 3u;");
    expect(apply.wgsl).toContain("let co = i * 4u;");
  });

  it("gathers through the permutation when the spawn is multi-asset", () => {
    const p = plan(
      [spawn({ assetAttr: "species", colorAttr: "color" })],
      1000,
      COLOUR_LAYOUT,
      Number.MAX_SAFE_INTEGER,
      false,
    );
    const apply = applyOf(p, 0);
    expect(apply.key).toBe("apply2|spawnInstances|rot=1|scl=1|perm|color=4");
    expect(apply.perBatch).toBe(true);
    // THE line that makes ordering structural: the colour's source index
    // is the same `src` the matrix read, not `i`.
    expect(apply.wgsl).toContain("let src = b5[params.base + i];");
    expect(apply.wgsl).toContain("let cs = src * 4u;");
    // ...and the destination is still dense, so no two lanes collide.
    expect(apply.wgsl).toContain("let co = i * 4u;");
    expect(p.instances).toEqual({
      assetId: "tree",
      assetAttr: "species",
      colorAttr: "color",
      colorTupleSize: 4,
      count: 1000,
      bytes: 64_000,
      colorBytes: 16_000, // 16 bytes per instance, not 12
      channels: [],
      channelBytes: 0,
      permBytes: 4000,
    });
  });

  it("sizes the colour buffer at 16 bytes per instance and counts it against the bound", () => {
    // 12 on the CPU, 16 here: `array<vec3<f32>>` has a 16-byte stride, so
    // this number is the renderer's, not ours. Getting it wrong shifts
    // every colour by a growing offset instead of failing.
    // Slots P(12) + rot(16) + scale(12) + the colour source color(16) =
    // 56 B/pt, plus 64 retained transform and 16 retained colour.
    const exact = 8 * (56 + 64 + 16);
    const p = plan([spawn({ colorAttr: "color" })], 8, COLOUR_LAYOUT, exact, false);
    expect(p.instances?.colorBytes).toBe(8 * 16);
    expect(p.totalBytes).toBe(exact);
    expect(rejection([spawn({ colorAttr: "color" })], 8, COLOUR_LAYOUT, exact - 1, false)).toBe(
      "run-too-large",
    );
  });

  it("leaves every colourless variant's key, bindings and text exactly as they were", () => {
    // The colour bindings are declared last precisely so this holds —
    // it is what lets APPLY_VERSION stay at apply2 and keeps every
    // cached pipeline and every memoized byte valid.
    for (const [params, key, bindings] of [
      [{}, "apply2|spawnInstances|rot=1|scl=1", 4],
      [{ assetAttr: "species" }, "apply2|spawnInstances|rot=1|scl=1|perm", 5],
    ] as const) {
      const apply = applyOf(
        plan([spawn(params)], 8, COLOUR_LAYOUT, Number.MAX_SAFE_INTEGER, false),
        0,
      );
      expect(apply.key).toBe(key);
      expect(apply.bindings).toHaveLength(bindings);
      expect(apply.wgsl).not.toContain("colors");
      expect(apply.wgsl).not.toContain("let co =");
    }
  });

  it("rejects the shapes the CPU spawner throws on, so the CPU raises them", () => {
    // Missing, wrong type, too narrow, and a non-string param value. All
    // four reject as run-plan-failed — the EXISTING reason — so the
    // per-node path surfaces requireRgbSource's message, which names the
    // param, the shape it found, and the attributes that would fit.
    for (const colorAttr of ["absent", "species", "height", 7]) {
      expect(rejection([spawn({ colorAttr })], 16, COLOUR_LAYOUT), String(colorAttr)).toBe(
        "run-plan-failed",
      );
    }
    // u32x4 is wide enough but the wrong element type.
    expect(rejection([spawn({ colorAttr: "flags" })], 16, COLOUR_LAYOUT)).toBe("run-plan-failed");
  });

  it("reads the LATEST epoch of a colour an earlier member wrote", () => {
    // setAttribute replaces `tint` mid-run, so the spawner must bind that
    // member's fresh slot — the same "whatever the chain produced" the
    // CPU spawner sees when it reads the chain's output geometry.
    const p = plan(
      [
        member("setAttribute", { name: "tint", type: "f32", tupleSize: 3, value: 0.5, seed: 0 }, "sa"),
        spawn({ colorAttr: "tint" }),
      ],
      64,
      COLOUR_LAYOUT,
      Number.MAX_SAFE_INTEGER,
      false,
    );
    const written = p.written.map((w) => w.name);
    expect(written).toEqual(["tint"]);
    const colourRef = applyOf(p, 1).bindings[4].ref as { kind: string; index: number };
    const targetRef = applyOf(p, 0).bindings[0].ref as { kind: string; index: number };
    expect(colourRef.kind).toBe("slot");
    // The very slot setAttribute wrote, not the input epoch.
    expect(colourRef.index).toBe(targetRef.index);
  });
});

// ---------------------------------------------------------------------------
// Named per-instance channels with the opt-in OFF — the default, and the
// only behaviour that existed before the flag. The library promises that a
// path which cannot run on the GPU falls back with a machine-readable
// reason rather than silently doing something else, and a resident run
// that composed the transforms while dropping the channels would be
// exactly the silent something else, since the host is about to bind those
// columns by name. So the planner refuses the run, the terminal falls back
// per-node, and the CPU spawner produces the transforms AND the channels
// together.
//
// Every assertion below is the pre-flag behaviour held in place: default
// off has to be the old path byte for byte, or the flag is not opt-in. The
// opt-in ON is a describe of its own, further down.

/** TRS layout plus channel-shaped columns: a u32 id, an f32x2, a string. */
const CHANNEL_LAYOUT: ResidentRunContext["attributes"] = {
  ...TRS_LAYOUT,
  color: { type: "f32", tupleSize: 4 },
  tint: { type: "f32", tupleSize: 3 },
  plantId: { type: "u32", tupleSize: 1 },
  phase: { type: "f32", tupleSize: 2 },
  species: { type: "string", tupleSize: 1 },
};

describe("resident run planning: the spawner's per-instance channels", () => {
  /**
   * The outcome of ONE spawn as a plain string, planned or rejected.
   *
   * `rejection()` THROWS when the planner hands back a plan, which is the
   * right shape for a lone assertion and the wrong one inside a loop: the
   * throw happens before `expect()` runs, so vitest never renders the
   * message argument and the report names a line rather than the value
   * that tripped it. Returning "planned" instead makes the ASSERTION the
   * thing that fails, so its label survives.
   */
  const outcomeOf = (instanceAttrs: unknown): string => {
    const outcome = planResidentRun(
      [spawn({ instanceAttrs })],
      { attributes: CHANNEL_LAYOUT, count: 16, needsGeometry: true },
      Number.MAX_SAFE_INTEGER,
      false,
    );
    return "plan" in outcome ? "planned" : outcome.reason;
  };

  it("rejects a spawn naming ANY channel, with the EXISTING reason", () => {
    // One channel is enough, and the reason is assetAttr's and the
    // budget's — no new fallback vocabulary. A caller observes the
    // counter key and nothing else: `PlanRejection` carries only
    // `reason`, so the planner's own sentence ("instanceAttrs names N
    // per-instance channel(s) and this resolver did not opt in...") never
    // leaves planResidentRun. There is nothing else here to assert, and
    // asserting a message would pin a string no cook can ever hand back.
    expect(rejection([spawn({ instanceAttrs: ["plantId"] })], 16, CHANNEL_LAYOUT)).toBe(
      "run-plan-failed",
    );
    for (const instanceAttrs of [["phase"], ["plantId", "phase"], ["tint", "plantId", "phase"]]) {
      expect(outcomeOf(instanceAttrs), instanceAttrs.join("+")).toBe("run-plan-failed");
    }
  });

  it("rejects on the CHANNEL, not on anything wrong with it", () => {
    // With the flag off the gate fires BEFORE any lookup, so a perfectly
    // good, device-eligible u32 column rejects exactly as a nonexistent
    // name does — the two are indistinguishable here, which is the point.
    // Turning the flag on separates them (the u32 plans, the nonexistent
    // name still rejects); that is the opt-in describe's job, and these
    // cases stay here to pin that OFF really is one undifferentiated no.
    expect(rejection([spawn({ instanceAttrs: ["plantId"] })], 16, CHANNEL_LAYOUT)).toBe(
      "run-plan-failed",
    );
    expect(rejection([spawn({ instanceAttrs: ["absent"] })], 16, CHANNEL_LAYOUT)).toBe(
      "run-plan-failed",
    );
    // A string channel is the CPU spawner's own refusal (its column is
    // indices into a table that does not travel). It rejects here too,
    // so the per-node path raises that message rather than this planner
    // wording a second copy of it.
    expect(rejection([spawn({ instanceAttrs: ["species"] })], 16, CHANNEL_LAYOUT)).toBe(
      "run-plan-failed",
    );
    // Not an array at all is not a valid graph either, and the shapes
    // split in a way worth keeping apart rather than looping over as one
    // list. A STRING is caught by the LENGTH check ("plantId".length is
    // 8), so it pins nothing about the Array.isArray guard on its own —
    // it is here for the param contract, not for the guard.
    expect(outcomeOf("plantId"), "string").toBe("run-plan-failed");
    // These are what pin the guard. Each has NO length, so with
    // Array.isArray gone they read as 0 channels and PLAN — handing back
    // a device-resident spawner with the channels silently dropped, the
    // one outcome this rejection exists to prevent. Verified by mutation:
    // remove the guard and every one of these turns into "planned".
    for (const instanceAttrs of [{}, 7, true, null]) {
      expect(outcomeOf(instanceAttrs), `lengthless: ${JSON.stringify(instanceAttrs)}`).toBe(
        "run-plan-failed",
      );
    }
  });

  it("decides on the channels ALONE: a spawn that would otherwise plan still rejects", () => {
    // `tint` is f32x3 and plans as colour on its own (asserted just
    // below). Naming a channel alongside it still rejects, so the
    // channel list is decisive rather than one input among several.
    expect(
      rejection([spawn({ colorAttr: "tint", instanceAttrs: ["plantId"] })], 16, CHANNEL_LAYOUT),
    ).toBe("run-plan-failed");
  });

  it("EMPTY costs the device path nothing: the spawn plans, colour included", () => {
    // The load-bearing boundary. `instanceAttrs` defaults to `[]` on
    // every graph in the corpus, so an empty list that rejected would
    // take the whole device-resident spawner off the table for everyone
    // — the param would have silently ended the feature it shipped
    // beside. Absent (a graph serialized before the param existed) has
    // to plan for the same reason.
    const empty = plan([spawn({ instanceAttrs: [] })], 16, CHANNEL_LAYOUT);
    expect(empty.instances?.count).toBe(16);
    expect(empty.instances?.bytes).toBe(16 * 64);

    const absent = plan([spawn()], 16, CHANNEL_LAYOUT);
    expect(absent.instances).toEqual(empty.instances);

    // And an empty list does not disturb the colour path it sits next to.
    const coloured = plan([spawn({ colorAttr: "tint", instanceAttrs: [] })], 16, CHANNEL_LAYOUT);
    expect(coloured.instances?.colorAttr).toBe("tint");
    expect(coloured.instances?.colorTupleSize).toBe(3);
    expect(coloured.instances?.colorBytes).toBe(16 * 16);
  });
});

// ---------------------------------------------------------------------------
// Named per-instance channels with the opt-in ON. The flag is the whole
// difference: the same spawn, the same layout, and now the channels are
// gathered on the device into buffers the HOST binds. Everything below is
// unreachable without `deviceInstanceAttrs`, which is what makes the
// describe above the default and this one the widening.

/** CHANNEL_LAYOUT plus the shapes only the device has an opinion about. */
const WIDE_CHANNEL_LAYOUT: ResidentRunContext["attributes"] = {
  ...CHANNEL_LAYOUT,
  flag: { type: "bool", tupleSize: 1 },
  offset: { type: "i32", tupleSize: 4 },
  basis: { type: "f32", tupleSize: 9 },
};

/** Plan with the channel opt-in ON. */
function planCh(
  members: readonly ResidentMemberDesc[],
  count: number,
  attributes = WIDE_CHANNEL_LAYOUT,
  maxBytes = Number.MAX_SAFE_INTEGER,
  needsGeometry = true,
): PlanShape {
  const outcome = planResidentRun(members, { attributes, count, needsGeometry }, maxBytes, false, {
    deviceInstanceAttrs: true,
  });
  if (!("plan" in outcome)) throw new Error(`expected a plan, got ${outcome.reason}`);
  return outcome.plan as unknown as PlanShape;
}

/** One opted-in spawn's outcome as a plain string (see `outcomeOf` above). */
const chOutcome = (params: Record<string, unknown>, count = 16): string => {
  const outcome = planResidentRun(
    [spawn(params)],
    { attributes: WIDE_CHANNEL_LAYOUT, count, needsGeometry: true },
    Number.MAX_SAFE_INTEGER,
    false,
    { deviceInstanceAttrs: true },
  );
  return "plan" in outcome ? "planned" : outcome.reason;
};

/** A device-resident spawn, planned with channels on and no geometry read. */
const chPlan = (params: Record<string, unknown>, count = 16, attributes = WIDE_CHANNEL_LAYOUT): PlanShape =>
  planCh([spawn(params)], count, attributes, Number.MAX_SAFE_INTEGER, false);

describe("resident run planning: per-instance channels, opted in", () => {
  it("plans a valid u32 channel: its own kernel, its own retained bytes", () => {
    const p = chPlan({ instanceAttrs: ["plantId"] });
    // Two steps in the one member: compose, then one gather.
    expect(p.members[0].steps).toHaveLength(2);
    expect(p.members[0].steps[1].key).toBe("apply2|instanceChannel|ts=1|c=1");
    // The dtype is deliberately ABSENT from the key: every channel is a
    // word gather, so f32x1 and u32x1 are one kernel and one pipeline.
    expect(p.members[0].steps[1].key).not.toContain("u32");
    expect(p.instances?.channels).toEqual([
      { name: "plantId", type: "u32", itemSize: 1, components: 1, byteStride: 4 },
    ]);
    // 16 instances x 4 bytes, and it is its own line in the accounting.
    expect(p.instances?.channelBytes).toBe(16 * 4);
    expect(p.instances?.colorBytes).toBe(0);
    // Three bindings at most: source, out, and (here) no permutation.
    expect(p.members[0].steps[1].bindings).toEqual([
      // plantId's slot, allocated after P/rot/scale by the compose kernel.
      { binding: 1, ref: { kind: "slot", index: 3 } },
      { binding: 2, ref: { kind: "channelOut", index: 0 } },
    ]);
    // A spawner still mutates nothing, channels or not.
    expect(p.written).toEqual([]);
  });

  it("carries the dtype and the item size through unchanged, and pads only 3", () => {
    // The ABI: the point attribute's own type and tuple size, never
    // widened to f32 — and a device buffer that differs from the CPU
    // column exactly where deviceInstanceAttributeLayout says it does.
    const p = chPlan({ instanceAttrs: ["plantId", "phase", "tint", "offset", "flag"] }, 10);
    expect(p.instances?.channels).toEqual([
      { name: "plantId", type: "u32", itemSize: 1, components: 1, byteStride: 4 },
      { name: "phase", type: "f32", itemSize: 2, components: 2, byteStride: 8 },
      // The one that pads: 3 components, 4 slots, 16 bytes — the WGSL
      // array<vec3<T>> stride, the same rule colour has always followed.
      { name: "tint", type: "f32", itemSize: 3, components: 4, byteStride: 16 },
      { name: "offset", type: "i32", itemSize: 4, components: 4, byteStride: 16 },
      // bool declares bool and spends a u32 word: not host-shareable in
      // WGSL, so it rides as 0/1 exactly as every other bool binding does.
      { name: "flag", type: "bool", itemSize: 1, components: 1, byteStride: 4 },
    ]);
    expect(p.instances?.channelBytes).toBe(10 * (4 + 8 + 16 + 16 + 4));
    // One kernel each, in the order the param listed them.
    expect(p.members[0].steps).toHaveLength(6);
    expect(p.members[0].steps.slice(1).map((st) => st.key)).toEqual([
      "apply2|instanceChannel|ts=1|c=1",
      "apply2|instanceChannel|ts=2|c=2",
      "apply2|instanceChannel|ts=3|c=4",
      "apply2|instanceChannel|ts=4|c=4",
      "apply2|instanceChannel|ts=1|c=1",
    ]);
    // ...and a distinct output index each, in that same order.
    expect(p.members[0].steps.slice(1).map((st) => st.bindings[1].ref)).toEqual(
      [0, 1, 2, 3, 4].map((index) => ({ kind: "channelOut", index })),
    );
    // f32x1 and u32x1 share a key AND therefore a pipeline: `plantId` and
    // `flag` are the same kernel, which is the point of dropping the dtype.
    expect(p.members[0].steps[1].key).toBe(p.members[0].steps[5].key);
  });

  it("reads the LATEST epoch, exactly as colour does", () => {
    // A channel an earlier member wrote must be gathered from THAT
    // member's output buffer, not the input epoch — the same bytes the
    // CPU spawner sees when it reads the chain's output geometry.
    const p = planCh(
      [
        member("setAttribute", { name: "phase", type: "f32", tupleSize: 2, value: 0.5, seed: 0 }, "sa"),
        spawn({ instanceAttrs: ["phase"] }),
      ],
      8,
      WIDE_CHANNEL_LAYOUT,
      Number.MAX_SAFE_INTEGER,
      false,
    );
    const target = applyOf(p, 0).bindings[0].ref as { kind: string; index: number };
    const source = p.members[1].steps[1].bindings[0].ref as { kind: string; index: number };
    expect(source.kind).toBe("slot");
    expect(source.index).toBe(target.index);
  });

  it("gathers through the SAME permutation the matrix did, per batch", () => {
    const p = chPlan({ assetAttr: "species", instanceAttrs: ["plantId"] }, 100);
    const gather = p.members[0].steps[1];
    // perm is declared last, so it is binding 3 here — and the ref is the
    // same `perm` kind the compose kernel binds, i.e. one uploaded
    // permutation shared by every kernel of the terminal.
    expect(gather.bindings.map((b) => b.ref)).toEqual([
      { kind: "slot", index: expect.any(Number) },
      { kind: "channelOut", index: 0 },
      { kind: "perm" },
    ]);
    // One dispatch per asset batch, with `base` in the uniform: the
    // gather runs exactly as the compose does, or the two would disagree
    // about which point fills instance slot i.
    expect(gather.perBatch).toBe(true);
    expect(gather.uniformBytes).toBe(16); // header + base
    expect(p.members[0].steps[0].perBatch).toBe(true); // and so does the compose
    // Constant mode drops both, and pays 12 bytes of uniform again.
    const constant = chPlan({ instanceAttrs: ["plantId"] }, 100);
    expect(constant.members[0].steps[1].perBatch).toBe(false);
    expect(constant.members[0].steps[1].uniformBytes).toBe(12);
    expect(constant.members[0].steps[1].bindings).toHaveLength(2);
  });

  it("colour and channels coexist: the reserved name is still colorAttr's", () => {
    const p = chPlan({ colorAttr: "tint", instanceAttrs: ["plantId", "phase"] });
    expect(p.instances?.colorAttr).toBe("tint");
    expect(p.instances?.colorBytes).toBe(16 * 16);
    expect(p.instances?.channels.map((c) => c.name)).toEqual(["plantId", "phase"]);
    expect(p.instances?.channelBytes).toBe(16 * (4 + 8));
    // compose (which carries colour) + two gathers.
    expect(p.members[0].steps).toHaveLength(3);
  });

  it("still rejects every channel the CPU spawner would refuse", () => {
    // The CPU rules from resolveInstanceAttrs, mirrored. Each REJECTS
    // rather than throws, so the terminal falls back per-node and that
    // function raises THE message — the one naming the node, the param,
    // the channel and the way out. A second wording here would be a
    // second thing to drift, and a PlanRejection carries only a reason.
    const cases: readonly (readonly [string, unknown])[] = [
      ["reserved colour name", ["color"]],
      ["empty name", [""]],
      ["duplicate", ["plantId", "plantId"]],
      ["not on the point domain", ["absent"]],
      ["string column", ["species"]],
      ["entry is not a string", [7]],
      ["entry is null", [null]],
      ["one bad name among good ones", ["plantId", "species"]],
      ["not an array", "plantId"],
      ["lengthless object", {}],
    ];
    for (const [label, instanceAttrs] of cases) {
      expect(chOutcome({ instanceAttrs }), label).toBe("run-plan-failed");
    }
  });

  it("rejects a channel WIDER than a vec4 — a device narrowing, not a disagreement", () => {
    // The CPU carries a 9-component channel happily; WGSL has no vector
    // wider than 4, so this one goes back to it. Falling back is the
    // right answer and there is no error to raise at all.
    expect(chOutcome({ instanceAttrs: ["basis"] })).toBe("run-plan-failed");
    // And it is the WIDTH, not the name: 4 is fine.
    expect(chOutcome({ instanceAttrs: ["offset"] })).toBe("planned");
  });

  it("REJECTS rather than throws, for every channel shape — whatever the order of the checks", () => {
    // The invariant behind the rule above, stated so it cannot be lost to
    // a refactor. `deviceInstanceAttributeLayout` raises a PLAIN Error for
    // an out-of-range item size, and a plain Error escapes
    // planResidentRun's catch (which converts only PlanFail) — it would
    // surface as a hard failure on a graph the CPU cooks fine, turning a
    // designed fallback into a crash. Today the width check runs first
    // AND the layout call is caught; this pins the outcome rather than
    // either mechanism, so reordering the validation cannot break it
    // silently. Verified by mutation: drop the width check and remove the
    // try/catch and this reports a thrown error instead of a reason.
    const wide: ResidentRunContext["attributes"] = {
      P: { type: "f32", tupleSize: 3 },
      basis: { type: "f32", tupleSize: 9 },
      zero: { type: "f32", tupleSize: 0 },
      fractional: { type: "f32", tupleSize: 2.5 },
      huge: { type: "u32", tupleSize: 1024 },
      negative: { type: "i32", tupleSize: -1 },
      ok: { type: "u32", tupleSize: 1 },
    };
    for (const name of ["basis", "zero", "fractional", "huge", "negative", "ok"]) {
      let outcome: ReturnType<typeof planResidentRun>;
      expect(() => {
        outcome = planResidentRun(
          [spawn({ instanceAttrs: [name] })],
          { attributes: wide, count: 8, needsGeometry: false },
          Number.MAX_SAFE_INTEGER,
          false,
          { deviceInstanceAttrs: true },
        );
      }, `${name} must not throw`).not.toThrow();
      // Only the one valid shape plans; every other is a counted reason.
      expect("plan" in outcome! ? "planned" : outcome!.reason, name).toBe(
        name === "ok" ? "planned" : "run-plan-failed",
      );
    }
  });

  it("EMPTY and ABSENT plan identically with the flag on and with it off", () => {
    // The flag widens what a NAMED channel does and nothing else: a spawn
    // that names none must produce the same plan either way, or the
    // default is not really the default.
    const on = chPlan({ instanceAttrs: [] });
    const off = plan([spawn({ instanceAttrs: [] })], 16, WIDE_CHANNEL_LAYOUT, Number.MAX_SAFE_INTEGER, false);
    expect(on.instances).toEqual(off.instances);
    expect(on.instances?.channels).toEqual([]);
    expect(on.instances?.channelBytes).toBe(0);
    expect(on.totalBytes).toBe(off.totalBytes);
    expect(on.members[0].steps).toHaveLength(1);
    // Absent is the same case, for graphs serialized before the param.
    expect(chPlan({}).instances).toEqual(off.instances);
  });

  it("channel bytes count against the memory bound like any other allocation", () => {
    const layout: ResidentRunContext["attributes"] = {
      P: { type: "f32", tupleSize: 3 },
      plantId: { type: "u32", tupleSize: 1 },
    };
    // 8 points: P slot (12/pt) + plantId slot (4/pt) + retained
    // transforms (64/pt) + retained channel (4/pt). needsGeometry false,
    // so there is no readback staging in the sum.
    const withChannel = 8 * (12 + 4 + 64 + 4);
    expect(chPlan({ instanceAttrs: ["plantId"] }, 8, layout).totalBytes).toBe(withChannel);
    const budget = (maxBytes: number, params: Record<string, unknown>): string => {
      const outcome = planResidentRun(
        [spawn(params)],
        { attributes: layout, count: 8, needsGeometry: false },
        maxBytes,
        false,
        { deviceInstanceAttrs: true },
      );
      return "plan" in outcome ? "planned" : outcome.reason;
    };
    // Exactly on the bound plans; one byte under is `run-too-large`, and
    // that is the reason — not `run-plan-failed`, so a caller can still
    // tell a run that did not FIT from one that could not be built.
    expect(budget(withChannel, { instanceAttrs: ["plantId"] })).toBe("planned");
    expect(budget(withChannel - 1, { instanceAttrs: ["plantId"] })).toBe("run-too-large");
    // ...and the channel is what pushed it over: the same spawn without
    // one fits in the smaller budget.
    expect(budget(withChannel - 1, {})).toBe("planned");
  });

  it("counts a padded channel at its PADDED stride, not its item size", () => {
    // The bound must count what the buffer costs. An itemSize-3 channel
    // spends 16 bytes per instance, and budgeting 12 would let a run plan
    // that cannot allocate.
    const layout: ResidentRunContext["attributes"] = {
      P: { type: "f32", tupleSize: 3 },
      tint: { type: "f32", tupleSize: 3 },
    };
    const p = chPlan({ instanceAttrs: ["tint"] }, 8, layout);
    expect(p.instances?.channelBytes).toBe(8 * 16);
    expect(p.totalBytes).toBe(8 * (12 + 12 + 64 + 16)); // P slot, tint slot, transforms, channel
  });

  it("the gather kernel is a raw WORD copy, pinned verbatim", () => {
    // The bit-exactness argument lives in this text and nowhere else:
    // both sides bind as array<u32>, so the kernel moves 4-byte words and
    // never a value — no conversion to round, no arithmetic to contract,
    // no float path to canonicalize a NaN payload. Pinned in full for the
    // widest variant (padded and indexed); the body alone for the rest.
    const indexed = chPlan({ assetAttr: "species", instanceAttrs: ["tint"] }, 8).members[0].steps[1];
    expect(indexed.wgsl).toBe(`// Generated by pcg-ts resident-run apply codegen.
// Dispatch: 1D, chunked; element index i = chunkOffset + gid.x, one
// invocation per element; only element i's slots are accessed.

struct PcgParams {
  count: u32,
  seed: u32,
  chunkOffset: u32,
  base: u32,
}

@group(0) @binding(0) var<uniform> params: PcgParams;
@group(0) @binding(1) var<storage, read> b1: array<u32>; // channel source: 3 word(s) per point
@group(0) @binding(2) var<storage, read_write> b2: array<u32>; // out: 4 word(s) per instance (vec3 storage stride, [3] = 0 pad)
@group(0) @binding(3) var<storage, read> b3: array<u32>; // grouping permutation: source point index per slot

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x + params.chunkOffset;
  if (i >= params.count) {
    return;
  }
  let src = b3[params.base + i];
  let s = src * 3u;
  let o = i * 4u;
  b2[o] = b1[s];
  b2[o + 1u] = b1[s + 1u];
  b2[o + 2u] = b1[s + 2u];
  b2[o + 3u] = 0u;
}
`);
    // The other item sizes, non-indexed. Note what is NOT here: a
    // bitcast, an f32() call, a select, or a second traversal.
    const bodyOf = (name: string): string => {
      const { wgsl } = chPlan({ instanceAttrs: [name] }, 8).members[0].steps[1];
      return wgsl.slice(wgsl.indexOf("  }\n") + 4, wgsl.lastIndexOf("}\n"));
    };
    expect(bodyOf("plantId")).toBe("  b2[i] = b1[i];\n");
    expect(bodyOf("phase")).toBe(
      "  let s = i * 2u;\n  let o = i * 2u;\n  b2[o] = b1[s];\n  b2[o + 1u] = b1[s + 1u];\n",
    );
    expect(bodyOf("offset")).toBe(
      "  let s = i * 4u;\n  let o = i * 4u;\n  b2[o] = b1[s];\n  b2[o + 1u] = b1[s + 1u];\n" +
        "  b2[o + 2u] = b1[s + 2u];\n  b2[o + 3u] = b1[s + 3u];\n",
    );
    // A bool channel emits the identical text a u32 one does: it entered
    // the resident slot already widened to u32 0/1.
    expect(bodyOf("flag")).toBe(bodyOf("plantId"));
  });

  it("costs three storage bindings whatever the channel is, so nothing bounds their number", () => {
    // The reason channels are their own kernel: the compose kernel's
    // widest form binds seven of the baseline eight, and folding them in
    // would have bought exactly ONE. Here the compose is at its widest
    // and four channels ride beside it at three bindings each.
    const p = chPlan({
      assetAttr: "species",
      colorAttr: "tint",
      instanceAttrs: ["plantId", "phase", "offset", "flag"],
    });
    expect(p.members[0].steps[0].bindings).toHaveLength(7); // the widest compose
    const gathers = p.members[0].steps.slice(1);
    expect(gathers).toHaveLength(4);
    for (const step of gathers) expect(step.bindings).toHaveLength(3);
  });
});

describe("resident run planning: the spawner's instance budget", () => {
  const P_ONLY: ResidentRunContext["attributes"] = { P: { type: "f32", tupleSize: 3 } };
  const MAX = 1_048_576;

  it("rejects an over-budget spawn with the EXISTING reason, adding no new vocabulary", () => {
    // The device path does not raise the diagnostic. It rejects the run;
    // the members cook per-node; `buildInstanceBatches` says the one
    // thing. A new fallback reason here would be a second way to phrase
    // one refusal — exactly what reusing assetAttr's mechanism avoids.
    expect(rejection([spawn()], MAX + 1, P_ONLY, Number.MAX_SAFE_INTEGER, false)).toBe(
      "run-plan-failed",
    );
  });

  it("plans the boundary itself, so the ceiling is not off by one", () => {
    const p = plan([spawn()], MAX, P_ONLY, Number.MAX_SAFE_INTEGER, false);
    expect(p.instances?.count).toBe(MAX);
    expect(p.instances?.bytes).toBe(MAX * 64);
  });

  it("is decided per SPAWN, not per run: a chain with no spawner is unaffected", () => {
    // The budget bounds instances, not points. A huge cloud that never
    // reaches a spawner is a memory question (`run-too-large`), not a
    // budget one, and must still plan.
    const p = plan(
      [member("transformPoints", { translate: [1, 0, 0], rotateEuler: [0, 0, 0], scale: [1, 1, 1] }, "xf")],
      MAX + 1,
      P_ONLY,
      Number.MAX_SAFE_INTEGER,
      true,
    );
    expect(p.instances).toBeNull();
    expect(p.members).toHaveLength(1);
  });
});

/**
 * A `{"fn":"param"}` inside a member's FIELD param. The apply kernel's
 * constant slots and the field kernel's param slots are the same uniform
 * tail written by the same executor line, so what the planner has to get
 * right is only that the field STEP carries its values and its (larger)
 * uniform size — which is exactly what this reads back.
 */
describe("param slots in a member's field kernel", () => {
  const bound = (spec: object, bindings: Record<string, number | readonly number[]>) =>
    fieldFromJson(spec as FieldSpec, bindings);

  it("carries the values on the field step, sized for its slots", () => {
    const p = plan(
      [
        member("setAttribute", {
          name: "d",
          type: "f32",
          tupleSize: 1,
          value: bound(
            { fn: "mul", args: [{ fn: "component", args: [{ fn: "position" }], index: 1 }, { fn: "param", name: "amp" }] },
            { amp: 0.5 },
          ),
        }),
      ],
      64,
    );
    const fieldStep = p.members[0].steps[0];
    // 4 f32 per slot, zero-padded — the apply kernels' slot payload.
    expect(fieldStep.consts).toEqual([0.5, 0, 0, 0]);
    // Padded 16-byte header + one 16-byte slot, not the bare 12.
    expect(fieldStep.uniformBytes).toBe(32);
    expect(fieldStep.wgsl).toContain("consts: array<vec4<f32>, 1>,");
    // The key carries the name and arity; the VALUE is only in `consts`,
    // so a rebind reuses this pipeline.
    expect(fieldStep.key).toContain('|params=["amp":1]');
    expect(fieldStep.key).not.toContain("0.5");
  });

  it("a param-free field step is untouched: no slots, the bare header", () => {
    const p = plan(
      [
        member("setAttribute", {
          name: "d",
          type: "f32",
          tupleSize: 1,
          value: field({ fn: "component", args: [{ fn: "position" }], index: 1 }),
        }),
      ],
      64,
    );
    const fieldStep = p.members[0].steps[0];
    expect(fieldStep.consts).toEqual([]);
    expect(fieldStep.uniformBytes).toBe(12);
  });

  it("rebinding changes the values and nothing else", () => {
    const spec = { fn: "mul", args: [{ fn: "position" }, { fn: "param", name: "amp" }] };
    const stepFor = (amp: number) =>
      plan(
        [
          member("setAttribute", {
            name: "d",
            type: "f32",
            tupleSize: 3,
            value: bound(spec, { amp }),
          }),
        ],
        64,
      ).members[0].steps[0];
    const a = stepFor(1);
    const b = stepFor(2);
    expect(b.consts).toEqual([2, 0, 0, 0]);
    expect(b.key).toBe(a.key);
    expect(b.wgsl).toBe(a.wgsl);
  });

  it("declines a run whose param nothing bound", () => {
    // Not a compile failure — the kernel compiles fine — but the values
    // are missing, so the members cook per-node and the CPU raises the
    // refusal that names the param.
    expect(
      rejection(
        [
          member("setAttribute", {
            name: "d",
            type: "f32",
            tupleSize: 1,
            value: field({ fn: "param", name: "amp" }),
          }),
        ],
        64,
      ),
    ).toBe("run-plan-failed");
  });
});
