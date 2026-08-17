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
  dot,
  eq,
  floor,
  ge,
  gt,
  le,
  length,
  lerp,
  lt,
  max,
  min,
  mul,
  ne,
  normalize,
  pow,
  ramp,
  remap,
  select,
  sin,
  sqrt,
  step,
  sub,
  tan,
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
