import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import { hashCombine, hashFloat, hashString } from "../random/index.js";
import { capture } from "./capture.js";
import { add, mul } from "./combinators.js";
import { attribute, constant, fraction, index, position, randomField, resolveField } from "./inputs.js";
import {
  type Column,
  type EvalContext,
  type Field,
  elementCount,
  evaluateField,
  isField,
  makeField,
} from "./types.js";

function pointCtx(count: number, seed = 0): EvalContext {
  return { geo: createPointCloud(count), domain: "point", seed };
}

describe("inputs", () => {
  it("constant broadcasts a scalar over all elements", () => {
    const col = evaluateField(constant(2.5), pointCtx(4));
    expect(col.tupleSize).toBe(1);
    expect(Array.from(col.data)).toEqual([2.5, 2.5, 2.5, 2.5]);
  });

  it("constant supports tuples", () => {
    const col = evaluateField(constant([1, 2, 3]), pointCtx(2));
    expect(col.tupleSize).toBe(3);
    expect(Array.from(col.data)).toEqual([1, 2, 3, 1, 2, 3]);
  });

  it("position reads the P attribute", () => {
    const ctx = pointCtx(2);
    ctx.geo.attrs.point.require("P").data.set([1, 2, 3, 4, 5, 6]);
    const col = evaluateField(position(), ctx);
    expect(col.tupleSize).toBe(3);
    expect(Array.from(col.data)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("index yields 0..n-1", () => {
    const col = evaluateField(index(), pointCtx(5));
    expect(col.data).toBeInstanceOf(Uint32Array);
    expect(Array.from(col.data)).toEqual([0, 1, 2, 3, 4]);
  });

  it("fraction spans [0, 1] inclusive: index / (count - 1)", () => {
    // The CLOSED convention, matching `pointLine`'s default
    // `includeEnd: true`: both endpoints are hit exactly, so a ramp with
    // stops at 0 and 1 reaches both ends of the cloud.
    const col = evaluateField(fraction(), pointCtx(5));
    expect(col.data).toBeInstanceOf(Float32Array);
    expect(Array.from(col.data)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    // Exactly 0 and exactly 1 at the ends, at a count whose steps are not
    // representable in binary.
    const odd = evaluateField(fraction(), pointCtx(7));
    expect(odd.data[0]).toBe(0);
    expect(odd.data[6]).toBe(1);
  });

  it("fraction handles the degenerate counts without dividing by zero", () => {
    // count 1: no span to normalize over, so the lone element takes the
    // START of the span — the same answer `pointLine` gives at count 1,
    // and the reason the divisor is `max(n - 1, 1)` rather than `n - 1`.
    const one = evaluateField(fraction(), pointCtx(1));
    expect(Array.from(one.data)).toEqual([0]);
    expect(Number.isNaN(one.data[0])).toBe(false);
    // count 0: an empty column of the same type, never a NaN lane.
    const none = evaluateField(fraction(), pointCtx(0));
    expect(none.data).toBeInstanceOf(Float32Array);
    expect(none.data.length).toBe(0);
    expect(none.tupleSize).toBe(1);
    // The detail domain is always exactly one element, so it takes the
    // count-1 branch too rather than reading a point-domain count.
    const detail: EvalContext = { geo: createPointCloud(9), domain: "detail", seed: 0 };
    expect(Array.from(evaluateField(fraction(), detail).data)).toEqual([0]);
  });

  it("fraction is index / (count - 1) lane for lane", () => {
    // The identity the name promises, at a count with no exact binary
    // steps: the field must be reproducible from `index` and the count
    // alone, so an agent can predict it without cooking.
    const ctx = pointCtx(1000);
    const frac = evaluateField(fraction(), ctx);
    const idx = evaluateField(index(), ctx);
    for (let i = 0; i < 1000; i++) {
      expect(frac.data[i]).toBe(Math.fround(idx.data[i] / 999));
    }
  });

  it("attribute validates tuple size and rejects strings", () => {
    const ctx = pointCtx(3);
    expect(() => evaluateField(attribute("density", 3), ctx)).toThrow(/tupleSize/);
    expect(() => evaluateField(attribute("missing"), ctx)).toThrow(/not found/);
    ctx.geo.attrs.point.add("label", "string");
    expect(() => evaluateField(attribute("label"), { ...ctx })).toThrow(/string/);
  });

  it("attribute converts bool columns to 0/1 floats", () => {
    const ctx = pointCtx(3);
    const flag = ctx.geo.attrs.point.add("flag", "bool");
    flag.set(1, 1);
    const col = evaluateField(attribute("flag"), ctx);
    expect(col.data).toBeInstanceOf(Float32Array);
    expect(Array.from(col.data)).toEqual([0, 1, 0]);
  });

  it("evaluates on the detail domain (one element)", () => {
    const ctx: EvalContext = { geo: createPointCloud(9), domain: "detail", seed: 0 };
    expect(elementCount(ctx)).toBe(1);
    const col = evaluateField(constant([4, 5]), ctx);
    expect(Array.from(col.data)).toEqual([4, 5]);
  });

  it("resolveField wraps numbers and arrays, passes fields through", () => {
    expect(resolveField(3).key).toBe("const(3)");
    expect(resolveField([1, 2]).key).toBe("const(1,2)");
    const f = constant(1);
    expect(resolveField(f)).toBe(f);
    expect(isField(f)).toBe(true);
    expect(isField(3)).toBe(false);
  });
});

describe("randomField", () => {
  it("is deterministic and matches the documented hash", () => {
    const a = evaluateField(randomField(5), pointCtx(64, 42));
    const b = evaluateField(randomField(5), pointCtx(64, 42));
    expect(a.data).toEqual(b.data);
    for (let i = 0; i < 64; i++) {
      expect(a.data[i]).toBe(hashFloat(hashCombine(42, 5, i)));
    }
  });

  it("stays in [0, 1)", () => {
    const col = evaluateField(randomField(), pointCtx(5000, 1));
    for (let i = 0; i < 5000; i++) {
      expect(col.data[i]).toBeGreaterThanOrEqual(0);
      expect(col.data[i]).toBeLessThan(1);
    }
  });

  it("varies with context seed and key", () => {
    const base = evaluateField(randomField(0), pointCtx(32, 1));
    expect(evaluateField(randomField(0), pointCtx(32, 2)).data).not.toEqual(base.data);
    expect(evaluateField(randomField(1), pointCtx(32, 1)).data).not.toEqual(base.data);
  });

  it("hashes string keys", () => {
    const byString = evaluateField(randomField("wind"), pointCtx(8, 3));
    const byHash = evaluateField(randomField(hashString("wind")), pointCtx(8, 3));
    expect(byString.data).toEqual(byHash.data);
  });
});

describe("structural keys", () => {
  it("is injection-proof for attribute names embedded in combinator keys", () => {
    // With naive string joins both trees would serialize identically.
    const a = add(attribute('a");attr("b'), attribute("c"));
    const b = add(attribute("a"), attribute('b");attr("c'));
    expect(a.key).not.toBe(b.key);
  });

  it("distinguishes -0 from 0 in constants", () => {
    expect(constant(-0).key).not.toBe(constant(0).key);
    // The columns really do differ: Float32Array stores the sign.
    const negZero = evaluateField(constant(-0), pointCtx(1));
    expect(Object.is(negZero.data[0], -0)).toBe(true);
  });

  it("keeps nesting unambiguous via length-prefixed child keys", () => {
    const x = constant(1);
    const y = constant(2);
    const z = constant(3);
    expect(add(add(x, y), z).key).not.toBe(add(x, add(y, z)).key);
  });
});

describe("memoization", () => {
  function countingField(): { field: Field; calls: () => number } {
    let calls = 0;
    const field = makeField("counting", 1, (ctx): Column => {
      calls++;
      return { data: new Float32Array(elementCount(ctx)).fill(1), tupleSize: 1 };
    });
    return { field, calls: () => calls };
  }

  it("evaluates a shared field instance once per evaluation context", () => {
    const { field, calls } = countingField();
    const root = add(field, mul(field, 2));
    const ctx = pointCtx(4);
    const col = evaluateField(root, ctx);
    expect(Array.from(col.data)).toEqual([3, 3, 3, 3]);
    expect(calls()).toBe(1);

    // Same context object: everything is cached, including the root.
    expect(evaluateField(root, ctx)).toBe(col);
    expect(calls()).toBe(1);

    // A fresh context re-evaluates.
    evaluateField(root, pointCtx(4));
    expect(calls()).toBe(2);
  });

  it("caches by instance within a context", () => {
    const ctx = pointCtx(3);
    const f = randomField(9);
    expect(evaluateField(f, ctx)).toBe(evaluateField(f, ctx));
  });
});

describe("capture", () => {
  it("round-trips a field through an anonymous attribute", () => {
    const geo = createPointCloud(4);
    geo.attrs.point.require("P").data.set([1, 0, 0, 0, 2, 0, 0, 0, 3, 1, 1, 1]);
    const field = mul(position(), 2);
    const name = capture(geo, "point", field, 0);
    expect(name).toBe("__anon_0");
    const ctx: EvalContext = { geo, domain: "point", seed: 0 };
    const captured = evaluateField(attribute(name), ctx);
    const direct = evaluateField(field, ctx);
    expect(captured.tupleSize).toBe(3);
    expect(Array.from(captured.data)).toEqual(Array.from(direct.data));
  });

  it("assigns deterministic counter-based names", () => {
    const geo = createPointCloud(2);
    expect(capture(geo, "point", constant(1))).toBe("__anon_0");
    expect(capture(geo, "point", constant(2))).toBe("__anon_1");
    // A different domain has its own namespace.
    expect(capture(geo, "detail", constant(3))).toBe("__anon_0");
  });

  it("preserves the column's storage type", () => {
    const geo = createPointCloud(3);
    const name = capture(geo, "point", index());
    const attr = geo.attrs.point.require(name);
    expect(attr.type).toBe("u32");
    expect(Array.from(attr.data.subarray(0, 3))).toEqual([0, 1, 2]);
  });

  it("accepts raw values via resolveField", () => {
    const geo = createPointCloud(2);
    const name = capture(geo, "point", [7, 8]);
    const attr = geo.attrs.point.require(name);
    expect(attr.tupleSize).toBe(2);
    expect(Array.from(attr.data.subarray(0, 4))).toEqual([7, 8, 7, 8]);
  });
});
