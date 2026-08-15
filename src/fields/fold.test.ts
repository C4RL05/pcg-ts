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
import { fieldFromJson, fieldToJson, fnVariation, listFieldFns, type FieldSpec } from "./fieldJson.js";
import { foldDomainConstants } from "./fold.js";
import { type Column, type EvalContext, type Field, evaluateField, makeField } from "./types.js";

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

/**
 * Element count handed to the fold in tests that are about WHAT it
 * folds rather than when. The real seam passes the domain's own count
 * and declines under `MIN_ELEMENTS_TO_FOLD`, so every case below would
 * otherwise be testing the threshold by accident on its 2-to-7 point
 * fixtures. The threshold has its own describe block.
 */
const FOLD_ANY_SIZE = 1 << 20;

describe("domain-constant folding", () => {
  it("replaces a domain-constant chain with the literal it evaluates to", () => {
    const field = fieldFromJson(seedShift(1021, 0.245422363, 1600));
    const folded = foldDomainConstants(field, SEED, FOLD_ANY_SIZE);

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
    const folded = foldDomainConstants(field, SEED, FOLD_ANY_SIZE);

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
    const folded = foldDomainConstants(field, SEED, FOLD_ANY_SIZE);

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

    expect(foldDomainConstants(field, SEED, FOLD_ANY_SIZE)).toBe(field);
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

    expect(foldDomainConstants(field, SEED, FOLD_ANY_SIZE)).toBe(field);
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
    expect(foldDomainConstants(field, SEED, FOLD_ANY_SIZE)).toBe(field);
  });

  it("leaves a field with no spec alone", () => {
    const opaque = makeField("opaque", 1, (ctx) => ({
      data: Float32Array.from({ length: ctx.geo.attrs.point.count }, (_, i) => i),
      tupleSize: 1,
    }));

    expect(foldDomainConstants(opaque, SEED, FOLD_ANY_SIZE)).toBe(opaque);
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

    expect(foldDomainConstants(field, SEED, FOLD_ANY_SIZE)).toBe(field);
    expect(() => values(foldDomainConstants(field, SEED, FOLD_ANY_SIZE), spreadCtx(2))).not.toThrow();
  });

  it("folds per seed, and remembers the answer per (field, seed)", () => {
    const field = fieldFromJson(seedShift(1021, 0.245422363, 1600));

    const a = foldDomainConstants(field, 11, FOLD_ANY_SIZE);
    const b = foldDomainConstants(field, 12, FOLD_ANY_SIZE);
    expect(fieldToJson(a)).toEqual({ fn: "constant", value: seedShiftStaged(11, 1021, 0.245422363, 1600) });
    expect(fieldToJson(b)).toEqual({ fn: "constant", value: seedShiftStaged(12, 1021, 0.245422363, 1600) });
    expect(a).not.toBe(b);

    // Cached: the same seed hands back the same rewritten field rather
    // than re-walking and re-parsing on every resolve.
    expect(foldDomainConstants(field, 11, FOLD_ANY_SIZE)).toBe(a);
    expect(foldDomainConstants(field, 12, FOLD_ANY_SIZE)).toBe(b);
  });

  it("bounds what it remembers per field", () => {
    // A hierarchical cook derives a seed per cell, so the seed is a value
    // that MOVES; the cache must not grow with the number of cells a world
    // has streamed. Eviction is observable only as a rebuild, which must
    // still produce an equal answer.
    const field = fieldFromJson(seedShift(1021, 0.245422363, 1600));
    const first = foldDomainConstants(field, 1, FOLD_ANY_SIZE);
    for (let seed = 2; seed <= 40; seed++) foldDomainConstants(field, seed, FOLD_ANY_SIZE);
    const again = foldDomainConstants(field, 1, FOLD_ANY_SIZE);

    expect(again).not.toBe(first);
    expect(fieldToJson(again)).toEqual(fieldToJson(first));
  });
});

/**
 * The claim the fold rests on, attacked from the outside rather than
 * re-argued: the reference is `evaluateField(field, ctx)` — literally the
 * expression the resolve seam evaluated before the fold existed — and the
 * subject is the same evaluation of the folded field. Anything the fold
 * changes shows up here as a byte difference or a different throw.
 */
describe("domain-constant folding, differentially", () => {
  /** Byte-for-byte, storage type included, -0 and NaN distinguished. */
  function render(field: Field, ctx: EvalContext): string {
    let col: Column;
    try {
      col = evaluateField(field, ctx);
    } catch (e) {
      return `throw:${String(e)}`;
    }
    const parts = [col.data.constructor.name, String(col.tupleSize), String(col.data.length)];
    for (const v of col.data) parts.push(Object.is(v, -0) ? "-0" : String(v));
    return parts.join(",");
  }

  /** The unfolded answer, from a field the fold has never been handed. */
  function reference(spec: FieldSpec, ctx: EvalContext): string {
    try {
      return render(fieldFromJson(structuredClone(spec) as FieldSpec), ctx);
    } catch (e) {
      return `throw:${String(e)}`;
    }
  }

  function subject(spec: FieldSpec, ctx: EvalContext): string {
    try {
      const field = fieldFromJson(structuredClone(spec) as FieldSpec);
      return render(foldDomainConstants(field, ctx.seed, FOLD_ANY_SIZE), ctx);
    } catch (e) {
      return `throw:${String(e)}`;
    }
  }

  /** A geometry whose every domain is populated and varied. */
  function variedCtx(count: number, domain: EvalContext["domain"], seed: number): EvalContext {
    const geo = createPointCloud(count);
    geo.attrs.vertex.resize(count);
    geo.attrs.primitive.resize(count);
    const P = geo.attrs.point.require("P");
    const w = geo.attrs.point.add("w", "f32", 1);
    for (let i = 0; i < count; i++) {
      P.setTuple(i, [i * 1.5 - 2, i * -0.25, i * 3 + 0.125]);
      w.data[i] = i * 0.5 - 1;
    }
    return { geo, domain, seed };
  }

  /**
   * One legal spec per fn the registry calls UNIFORM, so the claim is
   * re-derived from BEHAVIOR rather than from the table that asserts it.
   * A fn missing from here fails the coverage check below, which is the
   * point: a newly registered uniform fn must be shown to be one.
   */
  const scalar: FieldSpec = { fn: "attribute", name: "w", tupleSize: 1 };
  const triple: FieldSpec = { fn: "position" };
  const UNIFORM_CASES: Record<string, FieldSpec> = {
    constant: { fn: "constant", value: 3 },
    nodeSeed: { fn: "nodeSeed" },
    vec: { fn: "vec", args: [{ fn: "nodeSeed" }, 1, 2] },
    component: { fn: "component", args: [{ fn: "vec", args: [{ fn: "nodeSeed" }, 1, 2] }], index: 2 },
    ramp: { fn: "ramp", args: [{ fn: "nodeSeed" }], stops: [[0, 0.25], [1e9, -3]] },
    dot: { fn: "dot", args: [{ fn: "vec", args: [1, 2, 3] }, { fn: "vec", args: [{ fn: "nodeSeed" }, 5, 6] }] },
    length: { fn: "length", args: [{ fn: "vec", args: [{ fn: "nodeSeed" }, 5, 6] }] },
    normalize: { fn: "normalize", args: [{ fn: "vec", args: [{ fn: "nodeSeed" }, 5, 6] }] },
  };
  for (const fn of ["abs", "floor", "sin", "cos", "tan", "asin", "acos", "atan", "normalize"]) {
    UNIFORM_CASES[fn] ??= { fn, args: [{ fn: "mul", args: [{ fn: "nodeSeed" }, 2.3283064365386963e-10] }] };
  }
  for (const fn of ["add", "sub", "mul", "div", "min", "max", "atan2", "lt", "le", "gt", "ge", "eq", "ne"]) {
    UNIFORM_CASES[fn] ??= { fn, args: [{ fn: "nodeSeed" }, 7] };
  }
  for (const fn of ["clamp", "lerp", "select"]) {
    UNIFORM_CASES[fn] ??= { fn, args: [{ fn: "nodeSeed" }, 7, 9] };
  }
  UNIFORM_CASES.remap ??= { fn: "remap", args: [{ fn: "nodeSeed" }, 0, 1e9, -1, 1] };

  it("covers every fn the registry calls uniform", () => {
    const uniform = listFieldFns().filter((fn) => fnVariation(fn) === "uniform");
    expect(uniform.filter((fn) => UNIFORM_CASES[fn] === undefined)).toEqual([]);
    expect(Object.keys(UNIFORM_CASES).filter((fn) => fnVariation(fn) !== "uniform")).toEqual([]);
  });

  it("every uniform fn really is constant across a varied domain", () => {
    for (const [fn, spec] of Object.entries(UNIFORM_CASES)) {
      const ctx = variedCtx(5, "point", SEED);
      const col = evaluateField(fieldFromJson(structuredClone(spec) as FieldSpec), ctx);
      const ts = col.tupleSize;
      const head = Array.from(col.data.slice(0, ts));
      for (let i = 1; i < 5; i++) {
        expect([fn, i, Array.from(col.data.slice(i * ts, (i + 1) * ts))]).toEqual([fn, i, head]);
      }
    }
    // And the per-element leaves this is the complement of really do vary,
    // so the geometry above is not accidentally uniform.
    for (const spec of [scalar, triple, { fn: "index" }, { fn: "fraction" }, { fn: "randomField" }]) {
      const col = evaluateField(fieldFromJson(spec as FieldSpec), variedCtx(5, "point", SEED));
      const ts = col.tupleSize;
      expect(Array.from(col.data.slice(0, ts))).not.toEqual(Array.from(col.data.slice(ts, ts * 2)));
    }
  });

  it("agrees with the unfolded resolve over 6000 random expressions", () => {
    const NUMS = [
      0, -0, 1, -1, 0.1, 2.3283064365386963e-10, 1021, 1600, 0.245422363, 1e39, -1e39, 1e-45,
      16777217, 4294967295, 3.4028234663852886e38, 1e-8, -7.5, 0.5, 2, 3,
    ];
    const BIN = ["add", "sub", "mul", "div", "min", "max", "atan2", "lt", "le", "gt", "ge", "eq", "ne"];
    const UN = ["abs", "floor", "sin", "cos", "tan", "asin", "acos", "atan"];
    const TRI = ["clamp", "lerp", "select"];
    const NOISES = ["valueNoise", "perlinNoise", "simplexNoise", "worleyNoise"];
    const SEEDS = [0, 1, 0x9e3779b9, 4294967295, -1, 123.75, 2 ** 32, 16777217, 7];

    function rng(s: number): () => number {
      let a = s >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

    function gen(r: () => number, ts: 1 | 3, depth: number): FieldSpec {
      if (depth <= 0) {
        if (ts === 3) return pick(r, [triple, { fn: "attribute", name: "P", tupleSize: 3 },
          { fn: "constant", value: [pick(r, NUMS), pick(r, NUMS), pick(r, NUMS)] }]) as FieldSpec;
        return pick(r, [{ fn: "nodeSeed" }, { fn: "index" }, { fn: "fraction" },
          { fn: "randomField", key: Math.floor(r() * 3) }, scalar,
          { fn: "constant", value: pick(r, NUMS) }]) as FieldSpec;
      }
      const p = r();
      const same = () => gen(r, ts, depth - 1);
      const mixed = (): FieldSpec => (r() < 0.5 ? gen(r, 1, depth - 1) : same());
      if (p < 0.3) return { fn: pick(r, BIN), args: [same(), mixed()] };
      if (p < 0.45) return { fn: pick(r, UN), args: [same()] };
      if (p < 0.6) return { fn: pick(r, TRI), args: [same(), mixed(), mixed()] };
      if (p < 0.68) return { fn: pick(r, BIN), args: [same(), pick(r, NUMS)] };
      if (ts === 3) {
        if (p < 0.85) return { fn: "vec", args: [gen(r, 1, depth - 1), gen(r, 1, depth - 1), gen(r, 1, depth - 1)] };
        return { fn: "normalize", args: [same()] };
      }
      if (p < 0.74) return { fn: "component", args: [gen(r, 3, depth - 1)], index: Math.floor(r() * 3) };
      if (p < 0.79) return { fn: "length", args: [gen(r, 3, depth - 1)] };
      if (p < 0.84) return { fn: "dot", args: [gen(r, 3, depth - 1), gen(r, 3, depth - 1)] };
      if (p < 0.9) {
        return { fn: "ramp", args: [gen(r, 1, depth - 1)], stops: [[-1, 0.25], [0, 0.5], [0.5, -3], [2, 7]] };
      }
      return {
        fn: pick(r, NOISES),
        opts: { frequency: 0.05, seed: 3, position: gen(r, 3, depth - 1), normalized: r() < 0.5 },
      };
    }

    let rewritten = 0;
    const mismatches: string[] = [];
    for (let trial = 0; trial < 6000; trial++) {
      const r = rng(trial * 2654435761 + 17);
      const spec = gen(r, r() < 0.75 ? 1 : 3, 2 + Math.floor(r() * 4));
      try {
        fieldFromJson(structuredClone(spec) as FieldSpec);
      } catch {
        continue; // unbuildable spec: not this fold's business
      }
      const seed = SEEDS[trial % SEEDS.length];
      const ctx = variedCtx([0, 1, 2, 7][trial % 4], "point", seed);
      const probe = fieldFromJson(structuredClone(spec) as FieldSpec);
      if (foldDomainConstants(probe, seed, FOLD_ANY_SIZE) !== probe) rewritten++;
      const ref = reference(spec, ctx);
      const got = subject(spec, ctx);
      if (ref !== got) mismatches.push(`${JSON.stringify(spec)}\n  ref=${ref}\n  fold=${got}`);
      if (mismatches.length > 4) break;
    }
    // A fuzz that folded nothing would pass while proving nothing.
    expect(rewritten).toBeGreaterThan(500);
    expect(mismatches).toEqual([]);
  }, 60000);

  it("agrees on every domain and at every degenerate count", () => {
    const spec: FieldSpec = { fn: "add", args: [seedShift(1021, 0.2, 1600), { fn: "index" }] };
    for (const domain of ["point", "vertex", "primitive", "detail"] as const) {
      for (const count of [0, 1, 5]) {
        const ctx = variedCtx(count, domain, 0xabcdef);
        expect([domain, count, subject(spec, ctx)]).toEqual([domain, count, reference(spec, ctx)]);
      }
    }
  });

  it("reuses one cached fold across domains, geometries and evictions", () => {
    const spec: FieldSpec = { fn: "add", args: [seedShift(3067, 0.2, 1600), { fn: "index" }] };
    const shared = fieldFromJson(structuredClone(spec) as FieldSpec);
    for (const domain of ["point", "detail", "vertex", "point"] as const) {
      for (const seed of [77, 1, 2, 3, 4, 5, 6, 7, 8, 9, 77]) {
        const ctx = variedCtx(3, domain, seed);
        expect([domain, seed, render(foldDomainConstants(shared, seed, FOLD_ANY_SIZE), ctx)]).toEqual([
          domain,
          seed,
          reference(spec, ctx),
        ]);
      }
    }
  });

  it("keeps a non-float column's storage type when a sibling folds", () => {
    const ctx = variedCtx(4, "point", 5);
    const id = ctx.geo.attrs.point.add("id", "u32", 1);
    for (let i = 0; i < 4; i++) id.data[i] = 4000000000 + i;
    const bare: FieldSpec = { fn: "attribute", name: "id", tupleSize: 1 };
    expect(subject(bare, ctx)).toBe(reference(bare, ctx));
    expect(subject(bare, ctx)).toContain("Uint32Array");
    const mixed: FieldSpec = { fn: "add", args: [bare, seedShift(1021, 0.2, 1600)] };
    expect(subject(mixed, ctx)).toBe(reference(mixed, ctx));
  });

  it("refuses a param wherever it hides, including inside a noise's position", () => {
    const hidden: FieldSpec[] = [
      { fn: "param", name: "a" },
      { fn: "mul", args: [{ fn: "param", name: "a" }, 2] },
      { fn: "vec", args: [{ fn: "mul", args: [{ fn: "param", name: "a" }, 2] }, 1, 2] },
      {
        fn: "perlinNoise",
        opts: {
          frequency: 0.1,
          position: { fn: "vec", args: [{ fn: "param", name: "a" }, seedShift(1021, 0.2, 1600), 0] },
        },
      },
      {
        fn: "add",
        args: [
          seedShift(3067, 0.2, 1600),
          {
            fn: "fbm",
            base: "perlinNoise",
            opts: {
              frequency: 0.1,
              position: {
                fn: "add",
                args: [{ fn: "position" }, { fn: "vec", args: [{ fn: "param", name: "a" }, 0, 0] }],
              },
            },
          },
        ],
      },
    ];
    for (const spec of hidden) {
      const field = fieldFromJson(structuredClone(spec) as FieldSpec, { a: 3 });
      expect([JSON.stringify(spec), foldDomainConstants(field, 9, FOLD_ANY_SIZE)]).toEqual([JSON.stringify(spec), field]);
      // And it still evaluates: an unbound param refuses to.
      expect(render(foldDomainConstants(field, 9, FOLD_ANY_SIZE), variedCtx(3, "point", 9))).not.toContain("throw:");
    }
  });

  it("throws what the unfolded resolve throws, and no sooner", () => {
    const bad: FieldSpec[] = [
      { fn: "component", args: [{ fn: "mul", args: [{ fn: "nodeSeed" }, 2] }], index: 2 },
      { fn: "ramp", args: [{ fn: "vec", args: [{ fn: "nodeSeed" }, 1, 2] }], stops: [[0, 0], [1, 1]] },
      {
        fn: "add",
        args: [
          {
            fn: "vec",
            args: [{ fn: "attribute", name: "w" }, { fn: "mul", args: [{ fn: "nodeSeed" }, 2] }],
          },
          { fn: "vec", args: [1, 2, 3] },
        ],
      },
    ];
    for (const spec of bad) {
      for (const count of [0, 3]) {
        const ctx = variedCtx(count, "point", 11);
        expect([JSON.stringify(spec), count, subject(spec, ctx)]).toEqual([
          JSON.stringify(spec),
          count,
          reference(spec, ctx),
        ]);
      }
    }
  });
});

/**
 * The threshold exists because a fold MISS is a fixed ~89 µs while its
 * saving is per element, so under some domain size the optimization
 * costs more than it returns. That size is not exotic — a hierarchical
 * cook derives a seed per cell and the per-field cache holds only a few
 * seeds, so a streamed world misses on essentially every cell. The first
 * version of this module shipped without a threshold and was measured at
 * 16.8x SLOWER on 16-point cells.
 */
describe("the element-count threshold", () => {
  const shift = () => fieldFromJson(seedShift(1021, 0.245422363, 1600));

  it("declines to fold a domain too small to pay for the rewrite", () => {
    const field = shift();
    expect(foldDomainConstants(field, SEED, 16)).toBe(field);
  });

  it("folds once the domain is large enough", () => {
    const field = shift();
    expect(foldDomainConstants(field, SEED, FOLD_ANY_SIZE)).not.toBe(field);
  });

  it("still serves an ALREADY cached fold to a small domain", () => {
    // The threshold guards the expensive miss, not the cheap hit: once
    // the work is done, handing it to a 16-point cell costs a map lookup
    // and the cell still gets the cheaper field.
    const field = shift();
    const folded = foldDomainConstants(field, SEED, FOLD_ANY_SIZE);
    expect(folded).not.toBe(field);
    expect(foldDomainConstants(field, SEED, 16)).toBe(folded);
  });

  it("declining changes nothing about the values", () => {
    // The point of the whole module: below the threshold the caller gets
    // the original field, which must resolve to what the folded one does.
    const ctx = spreadCtx(3);
    const declined = foldDomainConstants(shift(), SEED, 16);
    const taken = foldDomainConstants(shift(), SEED, FOLD_ANY_SIZE);
    expect(values(declined, ctx)).toEqual(values(taken, ctx));
  });
});
