/**
 * Domain-constant folding. The claim under test is narrow and absolute:
 * the fold changes what a resolve COSTS and never what it produces, so
 * most of these are equality-of-bytes and identity-of-field assertions
 * rather than assertions about speed. The corpus-wide version of the same
 * claim is `tests/graphs.test.ts`, which diffs 50 graphs against a golden
 * that this optimization must not move.
 */
import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import { resolveOn } from "../nodes/util.js";
import { fieldFromJson, fieldToJson, type FieldSpec } from "./fieldJson.js";
import { foldDomainConstants } from "./fold.js";
import { type EvalContext, type Field, evaluateField, makeField } from "./types.js";

const SEED = 0x9e3779b9;

/** 2^-32, the scale the seed-shift idiom reads the seed's high bits with. */
const INV_2_32 = 2.3283064365386963e-10;

/**
 * The seed-shift idiom `graphs/examples-gpu-fields` writes, verbatim:
 * `A * (fract(nodeSeed * 2^-32 * K) - W0)`. Six arithmetic nodes whose
 * value is one number for the whole domain — the shape this fold exists
 * for.
 */
function seedShift(k: number, w0: number, a: number): FieldSpec {
  const scaled: FieldSpec = {
    fn: "mul",
    args: [{ fn: "mul", args: [{ fn: "nodeSeed" }, INV_2_32] }, k],
  };
  return {
    fn: "mul",
    args: [{ fn: "sub", args: [{ fn: "sub", args: [scaled, { fn: "floor", args: [scaled] }] }, w0] }, a],
  };
}

/**
 * The same expression staged through `Math.fround`, ONE ROUNDING PER
 * NODE. Written out rather than as a single f64 expression because that
 * is the whole claim: the fold re-emits the f32 a chain already produced,
 * and an f64 answer would agree with it only by luck.
 */
function seedShiftStaged(seed: number, k: number, w0: number, a: number): number {
  // The LITERALS round too: a number in an argument position becomes a
  // `constant`, whose column is f32, so `0.61` enters the chain as
  // `fround(0.61)`. Writing the f64 literal here instead agrees for some
  // constants and disagrees by an ulp for others — which is what this
  // helper caught the first time it was written.
  const s = Math.fround(seed >>> 0);
  const scaled = Math.fround(Math.fround(s * Math.fround(INV_2_32)) * Math.fround(k));
  const fract = Math.fround(scaled - Math.fround(Math.floor(scaled)));
  return Math.fround(Math.fround(fract - Math.fround(w0)) * Math.fround(a));
}

/** A cloud whose points are at distinct positions, so a collapse shows. */
function spreadCtx(count: number, seed = SEED): EvalContext {
  const geo = createPointCloud(count);
  const P = geo.attrs.point.require("P");
  for (let i = 0; i < count; i++) P.setTuple(i, [i, i * 2, i * 3]);
  return { geo, domain: "point", seed };
}

function values(field: Field, ctx: EvalContext): number[] {
  return Array.from(evaluateField(field, ctx).data);
}

describe("domain-constant folding", () => {
  it("replaces a domain-constant chain with the literal it evaluates to", () => {
    const field = fieldFromJson(seedShift(1021, 0.245422363, 1600));
    const folded = foldDomainConstants(field, SEED);

    expect(folded).not.toBe(field);
    expect(fieldToJson(folded)).toEqual({
      fn: "constant",
      value: seedShiftStaged(SEED, 1021, 0.245422363, 1600),
    });
  });

  it("is bit-exact for a chain that rounds at every step", () => {
    const spec = seedShift(3067, 0.61, 1600);
    const ctx = spreadCtx(4);
    const field = fieldFromJson(spec);
    const folded = foldDomainConstants(field, SEED);

    const expected = seedShiftStaged(SEED, 3067, 0.61, 1600);
    expect(values(folded, spreadCtx(4))).toEqual([expected, expected, expected, expected]);
    // And the same bytes the unfolded chain produces, which is the claim
    // the golden diff enforces over 50 graphs.
    expect(values(folded, spreadCtx(4))).toEqual(values(field, ctx));
  });

  it("folds inside a noise's position without folding the noise", () => {
    const spec: FieldSpec = {
      fn: "perlinNoise",
      opts: {
        frequency: 0.05,
        position: { fn: "add", args: [{ fn: "position" }, seedShift(8191, 0.1, 1600)] },
      },
    };
    const field = fieldFromJson(spec);
    const folded = foldDomainConstants(field, SEED);

    const rewritten = fieldToJson(folded) as {
      fn: string;
      opts: { position: { args: [unknown, unknown] } };
    };
    expect(rewritten.fn).toBe("perlinNoise");
    expect(rewritten.opts.position.args[0]).toEqual({ fn: "position" });
    expect(rewritten.opts.position.args[1]).toEqual({
      fn: "constant",
      value: seedShiftStaged(SEED, 8191, 0.1, 1600),
    });
    // The noise still varies, and by exactly what it varied by before.
    expect(values(folded, spreadCtx(8))).toEqual(values(field, spreadCtx(8)));
  });

  it("does not fold a varying leaf under a constant-looking parent", () => {
    // `add` is uniform and `1` is a literal, so everything about this node
    // says constant except the one argument that decides it.
    const field = fieldFromJson({ fn: "add", args: [1, { fn: "position" }] });

    expect(foldDomainConstants(field, SEED)).toBe(field);
    expect(values(field, spreadCtx(3))).toEqual([1, 1, 1, 2, 3, 4, 3, 5, 7]);
  });

  it("declines a fold that would produce a non-finite value", () => {
    // Division by zero. Folding it would make `fieldFromJson` throw from
    // inside an optimization; declining leaves the finiteness guard at the
    // resolve seam to report it, with the message it was written to give.
    const field = fieldFromJson({
      fn: "div",
      args: [{ fn: "mul", args: [{ fn: "nodeSeed" }, 2] }, 0],
    });

    expect(foldDomainConstants(field, SEED)).toBe(field);
    expect(() => resolveOn(createPointCloud(4), "point", field, SEED, "setAttribute", "value"))
      .toThrow(/param "value" resolved to \+Infinity at element 0/);
  });

  it("declines a fold that would produce -0", () => {
    // `keyNum` keeps -0 apart from 0 because their columns differ, and
    // `JSON.stringify(-0)` is "0" — a literal the grammar would not carry
    // back unchanged is not a literal this may emit.
    const field = fieldFromJson({
      fn: "mul",
      args: [{ fn: "mul", args: [{ fn: "nodeSeed" }, 0] }, -1],
    });

    expect(Object.is(evaluateField(field, spreadCtx(1)).data[0], -0)).toBe(true);
    expect(foldDomainConstants(field, SEED)).toBe(field);
  });

  it("leaves a field with no spec alone", () => {
    const opaque = makeField("opaque", 1, (ctx) => ({
      data: Float32Array.from({ length: ctx.geo.attrs.point.count }, (_, i) => i),
      tupleSize: 1,
    }));

    expect(foldDomainConstants(opaque, SEED)).toBe(opaque);
  });

  it("leaves a spec that references a param alone", () => {
    // The binding rides OUTSIDE the spec, keyed on the spec node, so a
    // rebuild without it would produce an unbound param — a field that
    // refuses to evaluate at all. The chain beside the reference is
    // foldable; the reference is what makes the whole field untouchable.
    const field = fieldFromJson(
      { fn: "mul", args: [seedShift(1021, 0.2, 1600), { fn: "param", name: "amp" }] },
      { amp: 3 },
    );

    expect(foldDomainConstants(field, SEED)).toBe(field);
    expect(() => values(foldDomainConstants(field, SEED), spreadCtx(2))).not.toThrow();
  });

  it("folds per seed, and remembers the answer per (field, seed)", () => {
    const field = fieldFromJson(seedShift(1021, 0.245422363, 1600));

    const a = foldDomainConstants(field, 11);
    const b = foldDomainConstants(field, 12);
    expect(fieldToJson(a)).toEqual({ fn: "constant", value: seedShiftStaged(11, 1021, 0.245422363, 1600) });
    expect(fieldToJson(b)).toEqual({ fn: "constant", value: seedShiftStaged(12, 1021, 0.245422363, 1600) });
    expect(a).not.toBe(b);

    // Cached: the same seed hands back the same rewritten field rather
    // than re-walking and re-parsing on every resolve.
    expect(foldDomainConstants(field, 11)).toBe(a);
    expect(foldDomainConstants(field, 12)).toBe(b);
  });

  it("bounds what it remembers per field", () => {
    // A hierarchical cook derives a seed per cell, so the seed is a value
    // that MOVES; the cache must not grow with the number of cells a world
    // has streamed. Eviction is observable only as a rebuild, which must
    // still produce an equal answer.
    const field = fieldFromJson(seedShift(1021, 0.245422363, 1600));
    const first = foldDomainConstants(field, 1);
    for (let seed = 2; seed <= 40; seed++) foldDomainConstants(field, seed);
    const again = foldDomainConstants(field, 1);

    expect(again).not.toBe(first);
    expect(fieldToJson(again)).toEqual(fieldToJson(first));
  });
});
