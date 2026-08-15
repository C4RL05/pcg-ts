import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import { pointIdentities } from "../data/identity.js";
import { hashCombine, hashFloat, hashString } from "../random/index.js";
import { capture } from "./capture.js";
import { add, mul } from "./combinators.js";
import { fieldFromJson } from "./fieldJson.js";
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

/**
 * A point cloud whose points are actually DISTINCT — distinct positions
 * and distinct per-point seeds. `createPointCloud` alone gives every
 * point the origin and seed 0, which is one point repeated as far as
 * identity is concerned, and identity-keyed randomness over it is
 * constant by construction.
 */
function identityCtx(count: number, seed = 0): EvalContext {
  const geo = createPointCloud(count);
  const P = geo.attrs.point.require("P");
  const seeds = geo.attrs.point.require("seed");
  for (let i = 0; i < count; i++) {
    P.setTuple(i, [
      hashFloat(hashCombine(13, i, 0)) * 8,
      hashFloat(hashCombine(13, i, 1)) * 8,
      hashFloat(hashCombine(13, i, 2)) * 8,
    ]);
    seeds.set(i, hashCombine(0x5eed, i));
  }
  return { geo, domain: "point", seed };
}

/** The same cloud with its points reordered, and the order used. */
function permutedCtx(ctx: EvalContext, order: number[]): EvalContext {
  const src = ctx.geo.attrs.point;
  const geo = createPointCloud(order.length);
  const dst = geo.attrs.point;
  for (const attr of src) {
    const target = dst.require(attr.name);
    order.forEach((from, to) => target.copyFrom(attr, from, to, 1));
  }
  return { geo, domain: ctx.domain, seed: ctx.seed };
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
    const ctx = identityCtx(64, 42);
    const a = evaluateField(randomField(5), ctx);
    const b = evaluateField(randomField(5), identityCtx(64, 42));
    expect(a.data).toEqual(b.data);
    const ident = pointIdentities(ctx.geo, "test");
    for (let i = 0; i < 64; i++) {
      expect(a.data[i]).toBe(hashFloat(hashCombine(42, 5, ident[i])));
    }
  });

  it("stays in [0, 1)", () => {
    const col = evaluateField(randomField(), identityCtx(5000, 1));
    for (let i = 0; i < 5000; i++) {
      expect(col.data[i]).toBeGreaterThanOrEqual(0);
      expect(col.data[i]).toBeLessThan(1);
    }
  });

  it("varies with context seed and key", () => {
    const base = evaluateField(randomField(0), identityCtx(32, 1));
    expect(evaluateField(randomField(0), identityCtx(32, 2)).data).not.toEqual(base.data);
    expect(evaluateField(randomField(1), identityCtx(32, 1)).data).not.toEqual(base.data);
  });

  it("hashes string keys", () => {
    const byString = evaluateField(randomField("wind"), identityCtx(8, 3));
    const byHash = evaluateField(randomField(hashString("wind")), identityCtx(8, 3));
    expect(byString.data).toEqual(byHash.data);
  });

  it("travels with the point when the cloud is reordered", () => {
    // On the point domain the draw is keyed on IDENTITY — position bits
    // plus the seed attribute — so a shuffle permutes the values and
    // changes none of them. Keyed on element index, every point would get
    // whatever the point now sitting at its slot used to get.
    const ctx = identityCtx(64, 7);
    const order = Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 64);
    const straight = evaluateField(randomField("wind"), ctx);
    const shuffled = evaluateField(randomField("wind"), permutedCtx(ctx, order));
    expect(Array.from(shuffled.data)).toEqual(order.map((from) => straight.data[from]));
    // Not a constant column, which would satisfy the above trivially.
    expect(new Set(Array.from(straight.data)).size).toBeGreaterThan(50);
  });

  it("reads BOTH halves of the identity", () => {
    const base = identityCtx(48, 2);
    const moved = permutedCtx(base, Array.from({ length: 48 }, (_, i) => i));
    const movedP = moved.geo.attrs.point.require("P");
    for (let i = 0; i < 48; i++) movedP.set(i, movedP.get(i, 0) + 0.25, 0);
    const reseeded = permutedCtx(base, Array.from({ length: 48 }, (_, i) => i));
    reseeded.geo.attrs.point.require("seed").fill(0, 0, 48);
    const straight = Array.from(evaluateField(randomField(1), base).data);
    expect(Array.from(evaluateField(randomField(1), moved).data)).not.toEqual(straight);
    expect(Array.from(evaluateField(randomField(1), reseeded).data)).not.toEqual(straight);
  });

  it("falls back to the element index off the point domain", () => {
    // Vertices, primitives and detail carry no position and no seed, so
    // there is no identity to key on and the index is the only name an
    // element has.
    const geo = createPointCloud(0);
    geo.attrs.primitive.add("dummy", "f32", 1, 0);
    geo.attrs.primitive.resize(16);
    const col = evaluateField(randomField(4), { geo, domain: "primitive", seed: 6 });
    for (let i = 0; i < 16; i++) expect(col.data[i]).toBe(hashFloat(hashCombine(6, 4, i)));
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
  function countingField(key = "counting", fill = 1): { field: Field; calls: () => number } {
    let calls = 0;
    const field = makeField(key, 1, (ctx): Column => {
      calls++;
      return { data: new Float32Array(elementCount(ctx)).fill(fill), tupleSize: 1 };
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

  it("returns the same column for a repeated instance", () => {
    const ctx = pointCtx(3);
    const f = randomField(9);
    expect(evaluateField(f, ctx)).toBe(evaluateField(f, ctx));
  });

  it("caches by KEY, so two equal-keyed instances evaluate once", () => {
    // The property that matters, and the one instance-keying did not
    // give: a tree parsed from JSON shares no instances at all, because
    // `fieldFromJson` constructs a fresh combinator per occurrence. Two
    // separately built copies of the same expression are this pair.
    const ctx = pointCtx(3);
    const a = countingField("shared");
    const b = countingField("shared");
    const first = evaluateField(a.field, ctx);
    expect(evaluateField(b.field, ctx)).toBe(first);
    expect(a.calls()).toBe(1);
    expect(b.calls()).toBe(0);
  });

  it("does not share across different keys", () => {
    const ctx = pointCtx(3);
    const a = countingField("left", 1);
    const b = countingField("right", 2);
    expect(Array.from(evaluateField(a.field, ctx).data)).toEqual([1, 1, 1]);
    expect(Array.from(evaluateField(b.field, ctx).data)).toEqual([2, 2, 2]);
    expect(a.calls()).toBe(1);
    expect(b.calls()).toBe(1);
  });

  it("shares a duplicated subexpression built twice from JSON", () => {
    // The motivating case, end to end: the serialized seed-shift idiom
    // computes `x - floor(x)` with `x` spelled out on both sides, so the
    // multiply chain under it exists twice in the spec. Deduping it is
    // what halved the cook of `graphs/examples-gpu-fields`.
    const seed = 123456789;
    const x = { fn: "mul", args: [{ fn: "mul", args: [{ fn: "nodeSeed" }, 2 ** -32] }, 1021] };
    const field = fieldFromJson({ fn: "sub", args: [x, { fn: "floor", args: [x] }] });
    const col = evaluateField(field, pointCtx(4, seed));

    // Rounded step by step, because every combinator computes in f64 and
    // stores f32 — collapsing this into one f64 expression would assert a
    // number the field never produces. The seed is chosen so the product
    // exceeds 1 and `floor` actually has something to take off.
    const scaled = Math.fround(Math.fround(Math.fround(seed) * 2 ** -32) * 1021);
    expect(scaled).toBeGreaterThan(1);
    const expected = Math.fround(scaled - Math.fround(Math.floor(scaled)));
    expect(Array.from(col.data)).toEqual([expected, expected, expected, expected]);
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
