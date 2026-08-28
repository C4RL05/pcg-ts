import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import {
  abs,
  acos,
  add,
  asin,
  atan,
  atan2,
  clamp,
  component,
  cos,
  cross,
  div,
  distance,
  dot,
  eq,
  exp,
  exp2,
  floor,
  fract,
  ge,
  gt,
  le,
  length,
  lerp,
  lt,
  log,
  log2,
  max,
  min,
  mul,
  mod,
  ne,
  normalize,
  pow,
  ramp,
  rem,
  smoothstep,
  remap,
  select,
  sin,
  sign,
  sqrt,
  step,
  sub,
  tan,
  trunc,
  vec,
} from "./combinators.js";
import { attribute, constant, position } from "./inputs.js";
import { type EvalContext, evaluateField } from "./types.js";

/** Point cloud with P set from a flat xyz array. */
function cloudCtx(positions: number[], seed = 0): EvalContext {
  const geo = createPointCloud(positions.length / 3);
  geo.attrs.point.require("P").data.set(positions);
  return { geo, domain: "point", seed };
}

const asArray = (ctx: EvalContext, field: Parameters<typeof evaluateField>[0]) =>
  Array.from(evaluateField(field, ctx).data);

describe("arithmetic and broadcasting", () => {
  it("composition equals a hand-computed eager result", () => {
    const positions = [0.1, -2.7, 3.3, 4.25, 0, -0.5, 100.125, 7.75, -9.875];
    const ctx = cloudCtx(positions);
    // (P * [2, 0.5, 1]) + 1, computed lazily...
    const field = add(mul(position(), [2, 0.5, 1]), 1);
    const col = evaluateField(field, ctx);
    expect(col.tupleSize).toBe(3);
    // ...must equal the eager f32 loop.
    const scale = [2, 0.5, 1];
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < 3; k++) {
        const p = Math.fround(positions[i * 3 + k]);
        const expected = Math.fround(Math.fround(p * scale[k]) + 1);
        expect(col.data[i * 3 + k], `elem ${i} comp ${k}`).toBe(expected);
      }
    }
  });

  it("broadcasts scalars against tuples on both sides", () => {
    const ctx = cloudCtx([1, 2, 3, 4, 5, 6]);
    expect(asArray(ctx, add(position(), 10))).toEqual([11, 12, 13, 14, 15, 16]);
    expect(asArray(ctx, sub(10, position()))).toEqual([9, 8, 7, 6, 5, 4]);
    expect(asArray(ctx, mul(2, 3))).toEqual([6, 6]);
  });

  it("rejects incompatible tuple sizes at construction when known", () => {
    expect(() => add(constant([1, 2]), constant([1, 2, 3]))).toThrow(/tuple/);
    expect(() => dot(constant([1, 2]), constant([1, 2, 3]))).toThrow(/tuple/);
  });

  it("rejects incompatible tuple sizes discovered at evaluation", () => {
    const ctx = cloudCtx([1, 2, 3]);
    ctx.geo.attrs.point.add("uv", "f32", 2);
    // attribute() without a declared size has unknown static tuple size.
    expect(() => evaluateField(add(attribute("uv"), position()), ctx)).toThrow(/tuple/);
  });

  it("covers the elementwise operator set", () => {
    const ctx = cloudCtx([4, -9, 2.5]);
    expect(asArray(ctx, div(position(), 2))).toEqual([2, -4.5, 1.25]);
    expect(asArray(ctx, min(position(), 0))).toEqual([0, -9, 0]);
    expect(asArray(ctx, max(position(), 0))).toEqual([4, 0, 2.5]);
    expect(asArray(ctx, abs(position()))).toEqual([4, 9, 2.5]);
    expect(asArray(ctx, floor(position()))).toEqual([4, -9, 2]);
    expect(asArray(ctx, clamp(position(), -1, 1))).toEqual([1, -1, 1]);
    expect(asArray(ctx, lerp(0, position(), 0.5))).toEqual([2, -4.5, 1.25]);
  });

  it("remaps ranges, mapping degenerate input ranges to outMin", () => {
    const ctx = cloudCtx([-1, 0, 1]);
    expect(asArray(ctx, remap(position(), -1, 1, 0, 10))).toEqual([0, 5, 10]);
    expect(asArray(ctx, remap(position(), 2, 2, 3, 7))).toEqual([3, 3, 3]);
  });
});

describe("powers and roots", () => {
  // 0, 4, 2.25 and -9: every value and every answer below is exact in f32,
  // so these are hand-computed rather than pinned from the implementation.
  const ctx = cloudCtx([0, 0, 0, 4, 0, 0, 2.25, 0, 0, -9, 0, 0]);
  const x = component(position(), 0);

  it("takes square roots, zero included, and NaN below zero", () => {
    expect(asArray(ctx, sqrt(x))).toEqual([0, 2, 1.5, NaN]);
    // NaN propagates like any other elementwise result — no clamping to 0,
    // the same rule asin/acos follow outside their domain.
    expect(asArray(ctx, add(sqrt(x), 1)).at(-1)).toBe(NaN);
  });

  it("takes square roots componentwise over a tuple", () => {
    const col = evaluateField(sqrt([9, 0.25, 16]), ctx);
    expect(col.tupleSize).toBe(3);
    expect(Array.from(col.data.subarray(0, 3))).toEqual([3, 0.5, 4]);
  });

  it("raises to whole, fractional and negative exponents", () => {
    expect(asArray(ctx, pow(x, 2))).toEqual([0, 16, 5.0625, NaN]);
    expect(asArray(ctx, pow(x, 0.5))).toEqual([0, 2, 1.5, NaN]);
    // A negative EXPONENT is ordinary — it is the base whose sign is
    // narrowed, and only the base.
    expect(asArray(ctx, pow(2, -3))).toEqual([0.125, 0.125, 0.125, 0.125]);
    expect(asArray(ctx, pow(0.5, -2))).toEqual([4, 4, 4, 4]);
  });

  it("gives NaN for a NEGATIVE BASE, where the host language gives a number", () => {
    // The deliberate divergence: the device leaves a negative base
    // indeterminate, so one NaN on both paths beats two different answers
    // over a whole quadrant. The host's own answer, for contrast:
    expect(Math.pow(-2, 2)).toBe(4);
    expect(asArray(ctx, pow(-2, 2))).toEqual([NaN, NaN, NaN, NaN]);
    // Not just the exponents with a real signed answer — every one of them.
    expect(asArray(ctx, pow(-2, 3))).toEqual([NaN, NaN, NaN, NaN]);
    expect(asArray(ctx, pow(x, 2)).at(-1)).toBe(NaN);
    // And the documented workaround really does restore the signed power.
    expect(asArray(ctx, mul(normalize(-2), pow(abs(-2), 3)))).toEqual([-8, -8, -8, -8]);
  });

  it("gives NaN for `x` to the 0 wherever the base is off the positive axis", () => {
    // The other half of the narrowed domain, and the same reason: the
    // device is `exp2(b * log2(a))`, so a base whose log2 is not finite
    // makes `b * log2(a)` a NaN — including at b = 0, where JS answers 1
    // for every base at all.
    expect(Math.pow(0, 0)).toBe(1);
    expect(asArray(ctx, pow(0, 0))).toEqual([NaN, NaN, NaN, NaN]);
    expect(asArray(ctx, pow(-9, 0))).toEqual([NaN, NaN, NaN, NaN]);
    expect(asArray(ctx, pow(x, 0))).toEqual([NaN, 1, 1, NaN]);
    // A positive finite base keeps the ordinary answer, at any exponent.
    expect(asArray(ctx, pow(2, 0))).toEqual([1, 1, 1, 1]);
  });
});

describe("trigonometry", () => {
  // Six probe inputs, stored as f32 by the P attribute (π rounds to
  // 3.1415927410125732); each combinator computes in f64 and stores f32.
  const INPUTS = [0, 0.5, 1, -1.25, 2.5, Math.PI];
  const trigCtx = () => cloudCtx(INPUTS.flatMap((v) => [v, 0, 0]));
  const x = () => component(position(), 0);

  it("matches pinned golden values (engine fdlibm determinism canary)", () => {
    // fround(Math.fn(fround(input))), pinned from this implementation.
    // Trig Math functions are fdlibm-derived in every major engine but,
    // unlike Math.sqrt, not spec-mandated to be correctly rounded — a
    // mismatch here means the running engine diverged from that norm.
    const ctx = trigCtx();
    expect(asArray(ctx, sin(x()))).toEqual([
      0, 0.4794255495071411, 0.8414709568023682, -0.9489846229553223, 0.5984721183776855,
      -8.742277657347586e-8,
    ]);
    expect(asArray(ctx, cos(x()))).toEqual([
      1, 0.8775825500488281, 0.5403022766113281, 0.3153223693370819, -0.8011435866355896, -1,
    ]);
    expect(asArray(ctx, tan(x()))).toEqual([
      0, 0.5463024973869324, 1.5574077367782593, -3.0095696449279785, -0.747022271156311,
      8.742277657347586e-8,
    ]);
    expect(asArray(ctx, atan(x()))).toEqual([
      0, 0.46364760398864746, 0.7853981852531433, -0.8960554003715515, 1.1902899742126465,
      1.2626272439956665,
    ]);
  });

  it("matches pinned atan2 goldens over (y, x) pairs including negative quadrants", () => {
    const pairs = [
      [0, 1],
      [1, 0],
      [-1, -1],
      [0.5, -2],
      [3, 4],
    ];
    const ctx = cloudCtx(pairs.flatMap(([y, xv]) => [y, xv, 0]));
    const field = atan2(component(position(), 0), component(position(), 1));
    expect(asArray(ctx, field)).toEqual([
      0, 1.5707963705062866, -2.356194496154785, 2.8966140747070312, 0.6435011029243469,
    ]);
  });

  it("propagates NaN for asin/acos outside [-1, 1] like other combinators (no clamping)", () => {
    const ctx = trigCtx();
    // Inputs -1.25, 2.5, and π are outside the domain; in-domain values pin.
    expect(asArray(ctx, asin(x()))).toEqual([
      0, 0.5235987901687622, 1.5707963705062866, NaN, NaN, NaN,
    ]);
    expect(asArray(ctx, acos(x()))).toEqual([
      1.5707963705062866, 1.0471975803375244, 0, NaN, NaN, NaN,
    ]);
    // NaN inputs propagate through downstream combinators unchanged.
    expect(asArray(ctx, add(asin(x()), 1)).slice(3)).toEqual([NaN, NaN, NaN]);
  });

  it("broadcasts scalars against tuples like the other elementwise combinators", () => {
    const ctx = cloudCtx([0, 0.5, 1]);
    // Unary over a tuple: componentwise.
    expect(asArray(ctx, sin(position()))).toEqual(
      [0, 0.5, 1].map((v) => Math.fround(Math.sin(v))),
    );
    // Binary with a broadcast scalar on either side.
    expect(asArray(ctx, atan2(position(), 1))).toEqual(
      [0, 0.5, 1].map((v) => Math.fround(Math.atan2(v, 1))),
    );
    expect(asArray(ctx, atan2(1, position()))).toEqual(
      [0, 0.5, 1].map((v) => Math.fround(Math.atan2(1, v))),
    );
    // Static tuple mismatch throws at construction, same as add.
    expect(() => atan2(constant([1, 2]), constant([1, 2, 3]))).toThrow(/tuple/);
  });

  it("builds structural keys equal across identical constructions (memoization-friendly)", () => {
    expect(sin(component(position(), 0)).key).toBe(sin(component(position(), 0)).key);
    expect(atan2(position(), 2).key).toBe(atan2(position(), 2).key);
    expect(sin(position()).key).not.toBe(cos(position()).key);
  });
});

describe("compare and select", () => {
  const ctx = cloudCtx([1, 0, 0, 0.5, 0, 0, -1, 0, 0]);
  const x = component(position(), 0);

  it("compares to 0/1", () => {
    expect(asArray(ctx, lt(x, 0.5))).toEqual([0, 0, 1]);
    expect(asArray(ctx, le(x, 0.5))).toEqual([0, 1, 1]);
    expect(asArray(ctx, gt(x, 0.5))).toEqual([1, 0, 0]);
    expect(asArray(ctx, ge(x, 0.5))).toEqual([1, 1, 0]);
    expect(asArray(ctx, eq(x, 0.5))).toEqual([0, 1, 0]);
    expect(asArray(ctx, ne(x, 0.5))).toEqual([1, 0, 1]);
  });

  it("ne is the exact complement of eq", () => {
    // The contract `filterByExpression` advertises: `ne` is not an
    // independent near-equality test with its own tolerance, it is
    // `1 - eq` on every input, including the ones that make float
    // comparison interesting.
    const pairs: Array<[number, number]> = [
      [0.5, 0.5],
      [0.5, 0.500001],
      [0, -0],
      [1e-30, 0],
      [1 / 3, 0.3333333333333333],
      [16777216, 16777217], // both round to the same f32
      [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
      [Number.NaN, Number.NaN],
      [Number.NaN, 1],
    ];
    for (const [a, b] of pairs) {
      const same = asArray(ctx, eq(a, b));
      const opposite = asArray(ctx, ne(a, b));
      expect(opposite, `ne(${a}, ${b})`).toEqual(same.map((v) => 1 - v));
    }
  });

  it("ne complements eq elementwise over a whole domain", () => {
    const lhs = component(position(), 0);
    const rhss: Array<number | ReturnType<typeof component>> = [
      0.5,
      -1,
      0,
      component(position(), 1),
    ];
    for (const rhs of rhss) {
      const same = asArray(ctx, eq(lhs, rhs));
      const opposite = asArray(ctx, ne(lhs, rhs));
      expect(opposite).toEqual(same.map((v) => 1 - v));
    }
  });

  it("selects elementwise with broadcasting", () => {
    expect(asArray(ctx, select(ge(x, 0.5), 10, 20))).toEqual([10, 10, 20]);
    expect(asArray(ctx, select(gt(x, 0), position(), [0, 0, 0]))).toEqual([
      1, 0, 0, 0.5, 0, 0, 0, 0, 0,
    ]);
  });
});

describe("step", () => {
  // Values either side of the edge, one exactly ON it, and a NaN — the
  // input that makes "at or above" a three-way question.
  const ctx = cloudCtx([-1, 0, 0, 0.25, 0, 0, 0.5, 0, 0, 0.75, 0, 0, NaN, 0, 0]);
  const x = component(position(), 0);

  it("is 1 AT the edge, not only above it", () => {
    expect(asArray(ctx, step(0.5, x))).toEqual([0, 0, 1, 1, 0]);
  });

  it("takes the threshold FIRST, so the two arguments are not interchangeable", () => {
    // The order is the shader convention, and getting it backwards is a
    // silently inverted mask rather than an error.
    expect(asArray(ctx, step(x, 0.5))).toEqual([1, 1, 1, 0, 0]);
  });

  it("gives 0 for a NaN on either side of the comparison", () => {
    // A NaN is neither above nor below the edge, and `>=` answers false
    // both ways round — so it lands OUTSIDE the mask, whichever operand
    // carries it.
    expect(asArray(ctx, step(0, x)).at(-1)).toBe(0);
    expect(asArray(ctx, step(x, 0)).at(-1)).toBe(0);
    expect(asArray(ctx, step(NaN, 0))).toEqual([0, 0, 0, 0, 0]);
  });

  it("is exactly ge with the arguments reversed, NaN case included", () => {
    // The registry documents `step(edge, x)` as `ge(x, edge)` — a familiar
    // NAME rather than new expressive power — so the two spellings must
    // not drift apart. Pinned elementwise over the whole domain, both
    // orders, including the edges that sit exactly on a sample.
    for (const edge of [-1, 0, 0.25, 0.5, 0.75, NaN]) {
      expect(asArray(ctx, step(edge, x)), `step(${edge}, x)`).toEqual(asArray(ctx, ge(x, edge)));
      expect(asArray(ctx, step(x, edge)), `step(x, ${edge})`).toEqual(asArray(ctx, ge(edge, x)));
    }
  });

  it("broadcasts a scalar edge across a tuple", () => {
    const col = evaluateField(step(0.5, position()), cloudCtx([0.25, 0.5, 1]));
    expect(col.tupleSize).toBe(3);
    expect(Array.from(col.data)).toEqual([0, 1, 1]);
  });
});

describe("vector operations", () => {
  const ctx = cloudCtx([1, 2, 2, 3, 0, 4, 0, 0, 0]);

  it("computes dot, length, normalize", () => {
    expect(asArray(ctx, dot(position(), position()))).toEqual([9, 25, 0]);
    expect(asArray(ctx, dot(position(), [1, 1, 1]))).toEqual([5, 7, 0]);
    expect(asArray(ctx, dot(2, 3))).toEqual([6, 6, 6]);
    expect(asArray(ctx, length(position()))).toEqual([3, 5, 0]);
    const n = asArray(ctx, normalize(position()));
    expect(n[0]).toBeCloseTo(1 / 3, 6);
    expect(n[1]).toBeCloseTo(2 / 3, 6);
    expect(n[2]).toBeCloseTo(2 / 3, 6);
    expect(n[3]).toBeCloseTo(0.6, 6);
    expect(n[5]).toBeCloseTo(0.8, 6);
    expect(n.slice(6)).toEqual([0, 0, 0]); // zero vector stays zero
  });

  it("builds tuples with vec and extracts with component", () => {
    const xy = vec(component(position(), 0), component(position(), 1));
    const col = evaluateField(xy, ctx);
    expect(col.tupleSize).toBe(2);
    expect(Array.from(col.data)).toEqual([1, 2, 3, 0, 0, 0]);
    // Tuple inputs contribute all components.
    const col2 = evaluateField(vec(position(), 7), ctx);
    expect(col2.tupleSize).toBe(4);
    expect(Array.from(col2.data.subarray(0, 4))).toEqual([1, 2, 2, 7]);
    expect(() => evaluateField(component(position(), 3), ctx)).toThrow(/out of range/);
  });
});

describe("cross", () => {
  // Three points whose components are exact in f32, so the nine products
  // below are hand-computed. The middle one is parallel to B.
  const B = [1, 4, -2];
  const ctx = cloudCtx([2, -3, 0.5, 1, 4, -2, -1, 0.5, 3]);

  /** The first tuple of a column, which is where the basis cases read. */
  const head = (field: Parameters<typeof evaluateField>[0]) =>
    Array.from(evaluateField(field, ctx).data.subarray(0, 3));

  it("is right-handed: x cross y is +z, all the way round the cycle", () => {
    expect(head(cross([1, 0, 0], [0, 1, 0]))).toEqual([0, 0, 1]);
    expect(head(cross([0, 1, 0], [0, 0, 1]))).toEqual([1, 0, 0]);
    expect(head(cross([0, 0, 1], [1, 0, 0]))).toEqual([0, 1, 0]);
  });

  it("anti-commutes: swapping the operands negates every component", () => {
    const A = [2, -3, 0.5];
    const ab = asArray(ctx, cross(A, B));
    expect(ab.slice(0, 3)).toEqual([4, 4.5, 11]);
    expect(asArray(ctx, cross(B, A))).toEqual(ab.map((v) => -v));
  });

  it("collapses parallel and anti-parallel inputs to zero", () => {
    // Zero rather than a direction, which is the property `normalize(cross(
    // tangent, up))` fails on when the tangent points straight up — the
    // case the registry entry tells authors to guard.
    expect(head(cross([1, 2, 3], [2, 4, 6]))).toEqual([0, 0, 0]);
    expect(head(cross([1, 2, 3], [-2, -4, -6]))).toEqual([0, 0, 0]);
  });

  it("computes per element, and is width 3 in and width 3 out", () => {
    const field = cross(position(), B);
    expect(field.tupleSize, "static width").toBe(3);
    const col = evaluateField(field, ctx);
    expect(col.tupleSize, "evaluated width").toBe(3);
    // Point 2 is B itself, so its cross is the zero the case above pins.
    expect(Array.from(col.data)).toEqual([4, 4.5, 11, 0, 0, 0, -13, 1, -4.5]);
  });

  it("refuses a non-3 width at construction, naming the argument and its width", () => {
    // The grammar's ONLY width-specific fn: a scalar does NOT broadcast
    // into a vec3 here, because a cross against [1, 1, 1] is never what
    // was meant. The message has to say which operand and what it was.
    expect(() => cross(constant(0.5), constant([1, 2, 3]))).toThrow(
      /^cross: argument `a` has width 1, but a cross product is defined for width 3 only\./,
    );
    expect(() => cross(constant([1, 2, 3]), 1)).toThrow(/argument `b` has width 1/);
    expect(() => cross(constant([1, 2]), position())).toThrow(/argument `a` has width 2/);
    expect(() => cross(position(), constant([1, 2]))).toThrow(/argument `b` has width 2/);
    // ...and then what to write instead, which is the half an agent acts on.
    expect(() => cross(position(), 1)).toThrow(/build a vec3 with `vec\(x, y, z\)`/);
    expect(() => cross(position(), 1)).toThrow(/use `dot` for a product that works at any width/);
  });

  it("refuses a width discovered at evaluation in the same words", () => {
    const uvCtx = cloudCtx([1, 2, 3]);
    uvCtx.geo.attrs.point.add("uv", "f32", 2);
    // attribute() with no declared size has no static width, so the check
    // lands at evaluation instead — and must phrase the refusal identically.
    expect(() => evaluateField(cross(attribute("uv"), position()), uvCtx)).toThrow(
      /^cross: argument `a` has width 2, but a cross product is defined for width 3 only\./,
    );
    // A width-3 attribute passes both checks.
    uvCtx.geo.attrs.point.add("N", "f32", 3);
    expect(() => evaluateField(cross(attribute("N"), position()), uvCtx)).not.toThrow();
  });
});

describe("ramp", () => {
  const ctx = cloudCtx([-1, 0, 0, 0, 0, 0, 0.25, 0, 0, 0.5, 0, 0, 2, 0, 0, 3, 0, 0]);
  const x = component(position(), 0);

  it("interpolates piecewise-linearly and clamps at the edges", () => {
    const r = ramp(x, [
      [0, 0],
      [0.5, 1],
      [2, -2],
    ]);
    expect(asArray(ctx, r)).toEqual([
      0, // below first stop: clamps
      0,
      0.5, // halfway 0 -> 0.5
      1, // exactly on a stop
      -2, // exactly on the last stop
      -2, // beyond last stop: clamps
    ]);
  });

  it("supports a single stop as a constant", () => {
    expect(asArray(ctx, ramp(x, [[1, 42]]))).toEqual([42, 42, 42, 42, 42, 42]);
  });

  it("validates stops and input arity", () => {
    expect(() => ramp(x, [])).toThrow(/at least one/);
    expect(() =>
      ramp(x, [
        [1, 0],
        [1, 2],
      ]),
    ).toThrow(/ascending/);
    expect(() => evaluateField(ramp(position(), [[0, 1]]), ctx)).toThrow(/scalar/);
  });
});

describe("fract", () => {
  // Either side of zero and two exact integers, because the whole reason
  // this fn exists is what it does on the negative side.
  const ctx = cloudCtx([2.75, 0, 0, -0.25, 0, 0, -3, 0, 0, 5, 0, 0, Infinity, 0, 0]);
  const x = component(position(), 0);

  it("is NON-NEGATIVE below zero, which is what makes it tile", () => {
    // -0.25 gives 0.75, NOT -0.25. A truncated fractional part would give
    // the latter and mirror the tile across the origin.
    expect(asArray(ctx, fract(x)).slice(0, 4)).toEqual([0.75, 0.75, 0, 0]);
  });

  it("is exactly mod(x, 1)", () => {
    // The registry says so; if the two ever disagree one of them is wrong.
    expect(asArray(ctx, fract(x))).toEqual(asArray(ctx, mod(x, 1)));
  });

  it("has no fractional part for a non-finite input", () => {
    expect(asArray(ctx, fract(x)).at(-1)).toBeNaN();
  });
});

describe("mod", () => {
  const ctx = cloudCtx([-1, 0, 0, 9, 0, 0, -9, 0, 0, 8, 0, 0, 0, 0, 0]);
  const x = component(position(), 0);

  it("is FLOORED: the sign follows the divisor, not the dividend", () => {
    // mod(-1, 8) is 7 and not -1 — the decision this fn documents forever.
    expect(asArray(ctx, mod(x, 8))).toEqual([7, 1, 7, 0, 0]);
  });

  it("follows a NEGATIVE divisor down instead", () => {
    // The mirror of the clause above: with y < 0 every result is <= 0.
    expect(asArray(ctx, mod(x, -8))).toEqual([-1, -7, -1, 0, 0]);
  });

  it("differs from a truncated remainder exactly where it should", () => {
    // Pinned as a DIFFERENCE, so a lowering that quietly emitted WGSL's
    // `%` would redden this rather than passing on the positive half.
    const floored = asArray(ctx, mod(x, 8));
    const truncated = [-1, 9, -9, 8, 0].map((v) => v % 8);
    expect(floored).not.toEqual(truncated);
    expect(floored.slice(1, 2)).toEqual(truncated.slice(1, 2)); // agree above zero
  });

  it("is NaN for a zero divisor", () => {
    expect(asArray(ctx, mod(x, 0)).every(Number.isNaN)).toBe(true);
  });
});

describe("trunc", () => {
  // Either side of zero, two exact integers and a non-finite, because the
  // whole reason this fn exists is what it does on the negative side.
  const ctx = cloudCtx([-1.5, 0, 0, 2.75, 0, 0, -3, 0, 0, 5, 0, 0, -0.5, 0, 0, Infinity, 0, 0]);
  const x = component(position(), 0);

  it("rounds TOWARD ZERO, where floor rounds toward -Infinity", () => {
    // -1.5 gives -1 and not -2. They part company on exactly the negative
    // NON-integers — a negative integer, a positive value and a non-finite
    // all come back the same from both — which is what makes reaching for
    // the wrong one silent.
    expect(asArray(ctx, trunc(x)).slice(0, 4)).toEqual([-1, 2, -3, 5]);
    expect(asArray(ctx, floor(x)).slice(0, 4)).toEqual([-2, 2, -3, 5]);
  });

  it("returns an exact integer unchanged, on both signs", () => {
    // Rows 2 and 3 are -3 and 5: no rounding to do, so nothing to get wrong.
    expect(asArray(ctx, trunc(x)).slice(2, 4)).toEqual([-3, 5]);
  });

  it("keeps the sign of a value that truncates to zero", () => {
    // -0.5 gives -0, not +0. `abs` then `floor` would give +0, and the two
    // are only distinguishable by Object.is — which is why it is asserted
    // that way rather than with toEqual.
    expect(Object.is(asArray(ctx, trunc(x)).at(4), -0)).toBe(true);
  });

  it("returns a non-finite input as it came", () => {
    expect(asArray(ctx, trunc(x)).at(5)).toBe(Infinity);
  });
});

describe("rem against mod", () => {
  // The same cloud both fns read, spanning both signs of the dividend.
  const ctx = cloudCtx([-1, 0, 0, 9, 0, 0, -9, 0, 0, 8, 0, 0, 0, 0, 0]);
  const x = component(position(), 0);

  it("is TRUNCATED: the sign follows the dividend, not the divisor", () => {
    // Hand-derived rather than computed, because computing them with
    // `x - y * trunc(x / y)` would be asserting the implementation against
    // itself: -1 - 8 * trunc(-0.125) is -1 - 8 * 0, which is -1.
    expect(asArray(ctx, rem(x, 8))).toEqual([-1, 1, -1, 0, 0]);
  });

  it("differs from mod on EVERY negative dividend and on none of the rest", () => {
    // The pair, written out side by side. This is the whole hazard: above
    // zero they are the same number, so a graph built on the wrong one
    // works until a coordinate crosses the origin.
    const floored = asArray(ctx, mod(x, 8));
    const truncated = asArray(ctx, rem(x, 8));
    expect(floored).toEqual([7, 1, 7, 0, 0]);
    expect(truncated).toEqual([-1, 1, -1, 0, 0]);
    // Rows 0 and 2 hold -1 and -9; rows 1, 3 and 4 hold 9, 8 and 0.
    expect([floored[0] === truncated[0], floored[2] === truncated[2]]).toEqual([false, false]);
    expect([
      floored[1] === truncated[1],
      floored[3] === truncated[3],
      floored[4] === truncated[4],
    ]).toEqual([true, true, true]);
  });

  it("ignores the DIVISOR's sign, where mod is decided by it", () => {
    // The mirror of the clause above, and the sharpest statement of the
    // difference: a negative divisor moves every one of mod's answers and
    // none of rem's. mod(9, -8) is -7 where rem(9, -8) is 1.
    expect(asArray(ctx, rem(x, -8))).toEqual([-1, 1, -1, 0, 0]);
    expect(asArray(ctx, rem(x, -8))).toEqual(asArray(ctx, rem(x, 8)));
    expect(asArray(ctx, mod(x, -8))).toEqual([-1, -7, -1, 0, 0]);
  });

  it("is NaN for a zero divisor, exactly as mod is", () => {
    expect(asArray(ctx, rem(x, 0)).every(Number.isNaN)).toBe(true);
    expect(asArray(ctx, mod(x, 0)).every(Number.isNaN)).toBe(true);
  });

  it("is the EXPANSION and not fmod, which part company past a 2^24 quotient", () => {
    // `rem` is `x - y * trunc(x / y)` with every step rounded to f32, which
    // is what the kernel runs. A true fmod (JS `%`, C's `fmod`) is exact for
    // any operands and answers 1 here; the expansion cannot hold a quotient
    // of 333333333 in f32 and answers 0. The dividend is exactly
    // representable and so is the divisor — this is the QUOTIENT's limit,
    // not an input's. Pinned so the lowering cannot be "simplified" to a
    // builtin fmod and quietly change the answer on the device.
    const big = cloudCtx([1e9, 0, 0, -8, 0, 0]);
    const bx = component(position(), 0);
    expect(asArray(big, rem(bx, 3))[0]).toBe(0);
    expect(1e9 % 3).toBe(1);
    // And it is an INHERITED limit rather than this fn's: `mod` does the
    // same thing with the same divisor, which is why the docs put the 2^24
    // caveat on both.
    expect(asArray(big, mod(bx, 3))[0]).toBe(0);
    // The other, smaller divergence from JS `%`: a zero result comes out +0
    // here, where fmod gives it the dividend's sign. `-8 % 8` is -0 in JS.
    expect(Object.is(asArray(big, rem(bx, 8))[1], 0)).toBe(true);
    expect(Object.is(-8 % 8, -0)).toBe(true);
  });
});

describe("exp2 and log2", () => {
  const ctx = cloudCtx([0, 0, 0, 1, 0, 0, 10, 0, 0, -1, 0, 0, 0.5, 0, 0]);
  const x = component(position(), 0);

  it("exp2 is exact on whole exponents, positive and negative", () => {
    // A power of two is an f32 with a zero mantissa, so there is nothing
    // for either path to round. 2^0, 2^1, 2^10, 2^-1.
    expect(asArray(ctx, exp2(x)).slice(0, 4)).toEqual([1, 2, 1024, 0.5]);
  });

  it("exp2 has an interior, and at x = 0.5 it is the square root of two", () => {
    expect(asArray(ctx, exp2(x)).at(4)).toBe(Math.fround(Math.SQRT2));
  });

  it("exp2's range is f32's exponent range, not exp's", () => {
    // 2^127 is finite, 2^128 is past f32's largest value, 2^-149 is the
    // smallest subnormal and 2^-150 is nothing. `exp` gives up at 88.7 and
    // -103.9 — the same two limits expressed in the wrong base.
    const wide = cloudCtx([127, 0, 0, 128, 0, 0, -149, 0, 0, -150, 0, 0]);
    const w = component(position(), 0);
    expect(asArray(wide, exp2(w))).toEqual([
      Math.fround(1.7014118346046923e38),
      Infinity,
      Math.fround(1.401298464324817e-45),
      0,
    ]);
  });

  it("log2 is exact on powers of two, above and below one", () => {
    const p = cloudCtx([1, 0, 0, 8, 0, 0, 0.5, 0, 0, 1024, 0, 0]);
    expect(asArray(p, log2(component(position(), 0)))).toEqual([0, 3, -1, 10]);
  });

  it("log2(0) is -Infinity and a negative input is NaN, as for log", () => {
    const out = asArray(cloudCtx([0, 0, 0, -1, 0, 0]), log2(component(position(), 0)));
    expect(out[0]).toBe(-Infinity);
    expect(out[1]).toBeNaN();
  });

  it("log2 of a non-power-of-two is the base-2 logarithm rounded to f32", () => {
    // Written out rather than composed: `div(log(3), log(2))` is the
    // spelling this fn replaces, and on the device it is a different
    // number — 1.30 rangeUlp against this lowering's 0.65.
    const out = asArray(cloudCtx([3, 0, 0]), log2(component(position(), 0)));
    expect(out[0]).toBe(Math.fround(1.5849624872207642));
    expect(out[0]).toBeCloseTo(Math.log2(3), 6);
  });

  it("round-trips through each other on whole exponents", () => {
    expect(asArray(ctx, log2(exp2(x))).slice(0, 4)).toEqual([0, 1, 10, -1]);
  });

  it("agrees with pow(2, x) on the CPU, which is where the synonym question ENDS", () => {
    // Honest about what this pins and what it does not. The CPU exp2 IS
    // `Math.pow(2, x)`, so this holds by construction and is a consistency
    // check rather than evidence. The reason to have both fns is a DEVICE
    // fact and is measured there, not here: the device runs `pow(a, b)` as
    // `exp2(b * log2(a))`, so `pow(2, x)` is this fn with two operations in
    // front of it and is billed at 8 rangeUlp against this one's 1. See the
    // exp2 row in parity.testsupport.ts for the measurement that decides it.
    expect(asArray(ctx, exp2(x)).slice(0, 4)).toEqual(asArray(ctx, pow(2, x)).slice(0, 4));
  });
});

describe("sign", () => {
  const ctx = cloudCtx([-2, 0, 0, 0, 0, 0, 3, 0, 0, NaN, 0, 0, -0, 0, 0]);
  const x = component(position(), 0);

  it("is -1, 0 or +1", () => {
    expect(asArray(ctx, sign(x)).slice(0, 3)).toEqual([-1, 0, 1]);
  });

  it("answers 0 for a NaN, where Math.sign answers NaN", () => {
    // Deliberate: the definition is a pair of comparisons, and a NaN is
    // neither greater nor less than zero. Both paths execute that exactly.
    expect(asArray(ctx, sign(x)).at(3)).toBe(0);
    expect(Number.isNaN(Math.sign(NaN))).toBe(true);
  });

  it("answers +0 for a negative zero, where Math.sign answers -0", () => {
    expect(Object.is(asArray(ctx, sign(x)).at(4), 0)).toBe(true);
    expect(Object.is(Math.sign(-0), -0)).toBe(true);
  });

  it("agrees with normalize on a scalar, which is the fn it renames", () => {
    // Except on the two inputs above, where normalize inherits the host's
    // answers and this one does not.
    expect(asArray(ctx, sign(x)).slice(0, 3)).toEqual(asArray(ctx, normalize(x)).slice(0, 3));
  });
});

describe("exp and log", () => {
  const ctx = cloudCtx([0, 0, 0, 1, 0, 0, -1, 0, 0]);
  const x = component(position(), 0);

  it("exp(0) is 1 and exp(1) is e, rounded to f32", () => {
    expect(asArray(ctx, exp(x)).slice(0, 2)).toEqual([1, Math.fround(Math.E)]);
  });

  it("log is NATURAL: log(1) is 0, and log(e) is 1 as closely as f32 allows", () => {
    // NOT exactly 1: `e` is stored as f32 first, and the natural log of the
    // nearest f32 to e is 0.9999999403953552. Asserting 1 here would be
    // asserting that the column is f64, which no column in this library is.
    const out = asArray(cloudCtx([1, 0, 0, Math.E, 0, 0]), log(component(position(), 0)));
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(Math.fround(Math.log(Math.fround(Math.E))));
    expect(out[1]).toBeCloseTo(1, 6);
  });

  it("log(0) is -Infinity and a negative input is NaN", () => {
    const out = asArray(cloudCtx([0, 0, 0, -1, 0, 0]), log(component(position(), 0)));
    expect(out[0]).toBe(-Infinity);
    expect(out[1]).toBeNaN();
  });

  it("round-trips through each other within f32", () => {
    const out = asArray(ctx, log(exp(x)));
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(1, 5);
    expect(out[2]).toBeCloseTo(-1, 5);
  });
});

describe("smoothstep", () => {
  const ctx = cloudCtx([-1, 0, 0, 0, 0, 0, 0.25, 0, 0, 0.5, 0, 0, 1, 0, 0, 2, 0, 0]);
  const x = component(position(), 0);

  it("is flat outside the edges and 0.5 in the middle", () => {
    expect(asArray(ctx, smoothstep(0, 1, x))).toEqual([0, 0, 0.15625, 0.5, 1, 1]);
  });

  it("leaves both ends FLAT, which is the whole difference from lerp", () => {
    // The first step away from each edge is much smaller than a straight
    // line's would be: that is the property a mask is bought for.
    const out = asArray(cloudCtx([0, 0, 0, 0.05, 0, 0, 0.5, 0, 0]), smoothstep(0, 1, component(position(), 0)));
    expect(out[1]).toBeLessThan(0.05 / 2);
  });

  it("degenerates to a step when the edges coincide, rather than dividing by zero", () => {
    // Guarded on both paths, mirroring what remap does with a zero input
    // span — the limit the curve is approaching, not a NaN.
    expect(asArray(ctx, smoothstep(0.5, 0.5, x))).toEqual(asArray(ctx, step(0.5, x)));
  });

  it("runs backwards when edge0 is above edge1", () => {
    expect(asArray(ctx, smoothstep(1, 0, x))).toEqual([1, 1, 0.84375, 0.5, 0, 0]);
  });
});

describe("distance", () => {
  const ctx = cloudCtx([3, 4, 0, -1, -1, -1, 0, 0, 0]);

  it("is the Euclidean distance between two tuples", () => {
    expect(asArray(ctx, distance(position(), vec(0, 0, 0)))).toEqual([5, Math.fround(Math.sqrt(3)), 0]);
  });

  it("is EXACTLY length(sub(a, b)), not merely close to it", () => {
    // The fused spelling rounds the difference to f32 before squaring for
    // this reason: it is what `sub` stores and what the device subtracts,
    // so the two spellings cannot drift apart.
    for (const other of [vec(0, 0, 0), vec(-2.5, 7.25, 0.125), position(), vec(1e-7, 1e7, 3)]) {
      expect(asArray(ctx, distance(position(), other))).toEqual(
        asArray(ctx, length(sub(position(), other))),
      );
    }
  });

  it("is the absolute difference on scalars", () => {
    const x = component(position(), 0);
    expect(asArray(ctx, distance(x, 1))).toEqual([2, 2, 1]);
  });

  it("is symmetric", () => {
    const a = position();
    const b = vec(1.5, -2.25, 8);
    expect(asArray(ctx, distance(a, b))).toEqual(asArray(ctx, distance(b, a)));
  });
});
