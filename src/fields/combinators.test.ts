import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import {
  abs,
  add,
  clamp,
  component,
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
  normalize,
  ramp,
  remap,
  select,
  sub,
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

describe("compare and select", () => {
  const ctx = cloudCtx([1, 0, 0, 0.5, 0, 0, -1, 0, 0]);
  const x = component(position(), 0);

  it("compares to 0/1", () => {
    expect(asArray(ctx, lt(x, 0.5))).toEqual([0, 0, 1]);
    expect(asArray(ctx, le(x, 0.5))).toEqual([0, 1, 1]);
    expect(asArray(ctx, gt(x, 0.5))).toEqual([1, 0, 0]);
    expect(asArray(ctx, ge(x, 0.5))).toEqual([1, 1, 0]);
    expect(asArray(ctx, eq(x, 0.5))).toEqual([0, 1, 0]);
  });

  it("selects elementwise with broadcasting", () => {
    expect(asArray(ctx, select(ge(x, 0.5), 10, 20))).toEqual([10, 10, 20]);
    expect(asArray(ctx, select(gt(x, 0), position(), [0, 0, 0]))).toEqual([
      1, 0, 0, 0.5, 0, 0, 0, 0, 0,
    ]);
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
