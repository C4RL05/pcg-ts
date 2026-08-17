import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import { Pcg32 } from "../random/index.js";
import {
  add,
  atan2,
  attribute,
  component,
  constant,
  cos,
  cross,
  evaluateField,
  fraction,
  makeField,
  mul,
  nodeSeed,
  position,
  pow,
  remap,
  sin,
  sqrt,
  step,
  vec,
  type EvalContext,
  type Field,
} from "./index.js";
import {
  deviceSpec,
  paramSpecOf,
  paramValue,
  peekFieldSpec,
  specFallbackReason,
} from "./spec.js";
import {
  NOISE_RAW_RANGES,
  fbm,
  noiseOutputRange,
  perlinNoise,
  simplexNoise,
  worleyNoise,
} from "../noise/index.js";
import {
  FieldJsonError,
  fieldFromJson,
  fieldFromJsonValueFree,
  fieldToJson,
  fnVariation,
  listFieldFnInfos,
  listFieldFns,
  inlineParamMetaOf,
  inlineParamValuesOf,
  paramNamesOf,
  unboundParamNamesOf,
  withInlineParamValue,
  type FieldSpec,
} from "./fieldJson.js";

function testCloud(n = 16): EvalContext {
  const geo = createPointCloud(n);
  const P = geo.attrs.point.require("P");
  for (let i = 0; i < n; i++) {
    P.setTuple(i, [i * 0.37, Math.sin(i) * 2, i % 5]);
  }
  return { geo, domain: "point", seed: 7 };
}

describe("fieldFromJson", () => {
  it("builds a nested expression that matches the hand-built field", () => {
    const spec: FieldSpec = {
      fn: "remap",
      args: [
        {
          fn: "fbm",
          base: "perlinNoise",
          opts: { seed: 3, frequency: 0.5, octaves: 3 },
        },
        -1,
        1,
        0,
        1,
      ],
    };
    const fromJson = fieldFromJson(spec);
    const handBuilt = remap(fbm(perlinNoise, { seed: 3, frequency: 0.5, octaves: 3 }), -1, 1, 0, 1);
    expect(fromJson.key).toBe(handBuilt.key);
    const ctx = testCloud();
    const a = evaluateField(fromJson, ctx);
    const b = evaluateField(handBuilt, ctx);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it("wraps plain numbers and arrays into constants", () => {
    const f = fieldFromJson({ fn: "add", args: [[1, 2, 3], 1] });
    const handBuilt = add([1, 2, 3], 1);
    expect(f.key).toBe(handBuilt.key);
    const col = evaluateField(f, testCloud(2));
    expect(Array.from(col.data)).toEqual([2, 3, 4, 2, 3, 4]);
  });

  it("supports attribute, randomField, worley output, component, ramp, vec", () => {
    const ctx = testCloud(8);
    const specs: FieldSpec[] = [
      { fn: "attribute", name: "density" },
      { fn: "randomField", key: "salt" },
      { fn: "worleyNoise", opts: { seed: 1, output: "f2-f1" } },
      { fn: "component", args: [{ fn: "position" }], index: 2 },
      { fn: "ramp", args: [{ fn: "index" }], stops: [[0, 0], [7, 1]] },
      { fn: "vec", args: [{ fn: "index" }, 0, { fn: "randomField" }] },
      { fn: "select", args: [{ fn: "gt", args: [{ fn: "index" }, 3] }, 1, 0] },
      { fn: "fraction" },
      { fn: "nodeSeed" },
    ];
    for (const spec of specs) {
      const field = fieldFromJson(spec);
      const col = evaluateField(field, ctx);
      expect(col.data.length).toBe(8 * col.tupleSize);
    }
  });

  it("fraction round-trips and spans [0, 1] inclusive through the grammar", () => {
    const spec: FieldSpec = { fn: "fraction" };
    const field = fieldFromJson(spec);
    expect(fieldToJson(field)).toEqual(spec);
    expect(field.key).toBe(fraction().key);
    const col = evaluateField(field, testCloud(5));
    expect(Array.from(col.data)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    // It takes no keys, so a stray one is refused by name.
    expect(() => fieldFromJson({ fn: "fraction", args: [1] } as unknown as FieldSpec)).toThrow(
      /unknown key "args" for fn "fraction"/,
    );
  });

  it("nodeSeed round-trips and reads the evaluation context's seed", () => {
    const spec: FieldSpec = { fn: "nodeSeed" };
    const field = fieldFromJson(spec);
    expect(fieldToJson(field)).toEqual(spec);
    expect(field.key).toBe(nodeSeed().key);
    const ctx = testCloud(5);
    expect(Array.from(evaluateField(field, ctx).data)).toEqual([7, 7, 7, 7, 7]);
    // A different context, same field object: the value follows the
    // SEED, not the field — which is the whole feature.
    const moved = { ...ctx, seed: 99 };
    expect(Array.from(evaluateField(field, moved).data)).toEqual([99, 99, 99, 99, 99]);
    expect(() => fieldFromJson({ fn: "nodeSeed", args: [1] } as unknown as FieldSpec)).toThrow(
      /unknown key "args" for fn "nodeSeed"/,
    );
  });

  it("nodeSeed's key carries no seed, and must not", () => {
    // `Field.key` is fixed at construction while the seed arrives at
    // evaluation, so the seed CANNOT be in the key. Invalidation is
    // exact anyway: the executor's node memo key already carries the
    // node seed verbatim, so every node recooks when the graph seed
    // moves (pinned in `src/graph/execute.test.ts`). Asserted here
    // because a future "improvement" that folded a seed into this key
    // would look like a fix and would silently key on whichever seed
    // happened to build the field.
    const composed = fieldFromJson({ fn: "mul", args: [{ fn: "nodeSeed" }, 2] });
    const before = composed.key;
    const ctx = testCloud(4);
    const a = Array.from(evaluateField(composed, { ...ctx, seed: 11 }).data);
    const b = Array.from(evaluateField(composed, { ...ctx, seed: 12 }).data);
    // The value tracked the seed; the key did not move with it.
    expect(a).toEqual([22, 22, 22, 22]);
    expect(b).toEqual([24, 24, 24, 24]);
    expect(composed.key).toBe(before);
    expect(nodeSeed().key).toBe("nodeSeed");
  });

  it("nodeSeed reads the seed as a uint32, matching what the device paths write", () => {
    // The GPU uniform is written as `ctx.seed >>> 0` on both device
    // paths, so the CPU has to read it the same way or the two disagree
    // for any node that hands its own param through as a seed.
    const ctx = testCloud(3);
    const field = fieldFromJson({ fn: "nodeSeed" });
    expect(Array.from(evaluateField(field, { ...ctx, seed: -7 }).data)).toEqual([
      4294967296, 4294967296, 4294967296,
    ]);
    // ...and the f32 column is why: 4294967289 is not representable, so
    // both sides land on the same nearest f32 rather than on two.
    expect(Math.fround(-7 >>> 0)).toBe(4294967296);
  });

  it("a domain with no elements yields an empty nodeSeed column", () => {
    const geo = createPointCloud(0);
    const col = evaluateField(fieldFromJson({ fn: "nodeSeed" }), {
      geo,
      domain: "point",
      seed: 3,
    });
    expect(col.data.length).toBe(0);
    expect(col.tupleSize).toBe(1);
  });

  it("round-trips: fieldToJson returns the original spec, and rebuilding evaluates identically", () => {
    const spec: FieldSpec = {
      fn: "mul",
      args: [{ fn: "simplexNoise", opts: { seed: 11, frequency: 2 } }, 0.5],
    };
    const field = fieldFromJson(spec);
    const json = fieldToJson(field);
    expect(json).toEqual(spec);
    const rebuilt = fieldFromJson(json);
    const ctx = testCloud();
    expect(Array.from(evaluateField(rebuilt, ctx).data)).toEqual(
      Array.from(evaluateField(field, ctx).data),
    );
  });

  it("builds trig expressions matching the hand-built combinators, with round-trip", () => {
    const spec: FieldSpec = {
      fn: "atan2",
      args: [
        { fn: "sin", args: [{ fn: "component", args: [{ fn: "position" }], index: 0 }] },
        { fn: "cos", args: [0.5] },
      ],
    };
    const fromJson = fieldFromJson(spec);
    const handBuilt = atan2(sin(component(position(), 0)), cos(0.5));
    expect(fromJson.key).toBe(handBuilt.key);
    const ctx = testCloud();
    const col = evaluateField(fromJson, ctx);
    expect(col.tupleSize).toBe(1);
    expect(Array.from(col.data)).toEqual(Array.from(evaluateField(handBuilt, ctx).data));
    // Round-trips losslessly and rebuilds to identical values.
    expect(fieldToJson(fromJson)).toEqual(spec);
    const rebuilt = fieldFromJson(fieldToJson(fromJson));
    expect(Array.from(evaluateField(rebuilt, ctx).data)).toEqual(Array.from(col.data));
    // Every trig fn parses with its arity; wrong arity is named.
    for (const name of ["sin", "cos", "tan", "asin", "acos", "atan"]) {
      expect(fieldFromJson({ fn: name, args: [0.25] }).tupleSize).toBe(1);
      expect(() => fieldFromJson({ fn: name, args: [] })).toThrow(/expects exactly 1 arg/);
    }
    expect(() => fieldFromJson({ fn: "atan2", args: [1] })).toThrow(/expects exactly 2 args/);
  });

  it("builds sqrt/pow/step matching the hand-built combinators, with round-trip", () => {
    const spec: FieldSpec = {
      fn: "step",
      args: [
        0.5,
        {
          fn: "pow",
          args: [
            { fn: "sqrt", args: [{ fn: "component", args: [{ fn: "position" }], index: 0 }] },
            3,
          ],
        },
      ],
    };
    const fromJson = fieldFromJson(spec);
    const handBuilt = step(0.5, pow(sqrt(component(position(), 0)), 3));
    expect(fromJson.key).toBe(handBuilt.key);
    const ctx = testCloud();
    const col = evaluateField(fromJson, ctx);
    expect(col.tupleSize).toBe(1);
    expect(Array.from(col.data)).toEqual(Array.from(evaluateField(handBuilt, ctx).data));
    expect(fieldToJson(fromJson)).toEqual(spec);
    const rebuilt = fieldFromJson(fieldToJson(fromJson));
    expect(Array.from(evaluateField(rebuilt, ctx).data)).toEqual(Array.from(col.data));
    // Each parses at its own arity, and a wrong count is named.
    expect(fieldFromJson({ fn: "sqrt", args: [0.25] }).tupleSize).toBe(1);
    expect(() => fieldFromJson({ fn: "sqrt", args: [] })).toThrow(/"sqrt" expects exactly 1 arg/);
    expect(() => fieldFromJson({ fn: "pow", args: [2] })).toThrow(/"pow" expects exactly 2 args/);
    expect(() => fieldFromJson({ fn: "step", args: [0, 1, 2] })).toThrow(
      /"step" expects exactly 2 args/,
    );
    // `pow`'s narrowed domain is a property of the FN, not of the
    // constructor, so it survives the trip through JSON unchanged.
    const negativeBase = fieldFromJson({ fn: "pow", args: [-2, 2] });
    expect(Array.from(evaluateField(negativeBase, ctx).data)).toEqual(new Array(16).fill(NaN));
  });

  it("builds cross, and enforces its width rule on the JSON path too", () => {
    const spec: FieldSpec = { fn: "cross", args: [{ fn: "position" }, { fn: "vec", args: [0, 1, 0] }] };
    const fromJson = fieldFromJson(spec);
    const handBuilt = cross(position(), vec(0, 1, 0));
    expect(fromJson.key).toBe(handBuilt.key);
    expect(fromJson.tupleSize).toBe(3);
    const ctx = testCloud();
    const col = evaluateField(fromJson, ctx);
    expect(col.tupleSize).toBe(3);
    expect(Array.from(col.data)).toEqual(Array.from(evaluateField(handBuilt, ctx).data));
    expect(fieldToJson(fromJson)).toEqual(spec);
    expect(() => fieldFromJson({ fn: "cross", args: [{ fn: "position" }] })).toThrow(
      /"cross" expects exactly 2 args/,
    );
    // A scalar is a width error rather than a broadcast here, and the
    // author of the JSON gets the constructor's refusal verbatim.
    expect(() => fieldFromJson({ fn: "cross", args: [{ fn: "position" }, 1] })).toThrow(
      /cross: argument `b` has width 1, but a cross product is defined for width 3 only\./,
    );
  });

  it("accepts normalized on noise specs and matches the factory-built field", () => {
    const spec: FieldSpec = { fn: "simplexNoise", opts: { seed: 11, normalized: true } };
    const fromJson = fieldFromJson(spec);
    expect(fromJson.key).toBe(simplexNoise({ seed: 11, normalized: true }).key);
    expect(fieldToJson(fromJson)).toEqual(spec);
    const ctx = testCloud();
    const values = evaluateField(fromJson, ctx).data;
    const handBuilt = evaluateField(simplexNoise({ seed: 11, normalized: true }), ctx).data;
    expect(Array.from(values)).toEqual(Array.from(handBuilt));
    // fbm accepts it too (shared noise opts).
    const fbmSpec: FieldSpec = {
      fn: "fbm",
      base: "perlinNoise",
      opts: { seed: 2, octaves: 2, normalized: true },
    };
    const fbmField = fieldFromJson(fbmSpec);
    expect(fbmField.key).toBe(fbm(perlinNoise, { seed: 2, octaves: 2, normalized: true }).key);
    expect(fieldToJson(fbmField)).toEqual(fbmSpec);
    // Non-boolean normalized is rejected with a path.
    expect(() => fieldFromJson({ fn: "perlinNoise", opts: { normalized: 1 } })).toThrow(
      /normalized must be a boolean/,
    );
  });

  it("accepts exact on worley specs (only), matching the factory-built field", () => {
    const spec: FieldSpec = {
      fn: "worleyNoise",
      opts: { seed: 3, output: "f2", exact: true, normalized: true },
    };
    const fromJson = fieldFromJson(spec);
    expect(fromJson.key).toBe(
      worleyNoise({ seed: 3, output: "f2", exact: true, normalized: true }).key,
    );
    expect(fieldToJson(fromJson)).toEqual(spec);
    const ctx = testCloud();
    const values = evaluateField(fromJson, ctx).data;
    const handBuilt = evaluateField(
      worleyNoise({ seed: 3, output: "f2", exact: true, normalized: true }),
      ctx,
    ).data;
    expect(Array.from(values)).toEqual(Array.from(handBuilt));
    expect(() => fieldFromJson({ fn: "worleyNoise", opts: { exact: "yes" } })).toThrow(
      /exact must be a boolean/,
    );
    // exact is worley-only: other noises reject it as unknown.
    expect(() => fieldFromJson({ fn: "perlinNoise", opts: { exact: true } })).toThrow(
      /unknown noise option "exact"/,
    );
  });

  it("rejects unknown fns, listing valid ones", () => {
    expect(() => fieldFromJson({ fn: "warble" })).toThrow(FieldJsonError);
    expect(() => fieldFromJson({ fn: "warble" })).toThrow(/unknown field fn "warble"/);
    expect(() => fieldFromJson({ fn: "warble" })).toThrow(/perlinNoise/);
  });

  it("rejects wrong arg counts, naming the fn and expectation", () => {
    expect(() => fieldFromJson({ fn: "add", args: [1] })).toThrow(/"add" expects exactly 2 args, got 1/);
    expect(() => fieldFromJson({ fn: "lerp", args: [1, 2] })).toThrow(/expects exactly 3 args/);
    expect(() => fieldFromJson({ fn: "add" })).toThrow(/requires an "args" array/);
  });

  it("rejects unknown keys and bad nested args with a path", () => {
    expect(() => fieldFromJson({ fn: "position", extra: 1 })).toThrow(/unknown key "extra"/);
    expect(() => fieldFromJson({ fn: "add", args: [{ fn: "nope" }, 1] })).toThrow(/\$\.args\[0\]/);
    expect(() => fieldFromJson({ fn: "perlinNoise", opts: { volume: 3 } })).toThrow(
      /unknown noise option "volume"/,
    );
  });

  it("rejects cyclic specs with an actionable FieldJsonError", () => {
    const s: Record<string, unknown> = { fn: "abs" };
    s.args = [s];
    expect(() => fieldFromJson(s as unknown as FieldSpec)).toThrow(FieldJsonError);
    expect(() => fieldFromJson(s as unknown as FieldSpec)).toThrow(/cyclic field spec/);
    // Indirect (two-object) cycle.
    const a: Record<string, unknown> = { fn: "abs" };
    const b: Record<string, unknown> = { fn: "abs", args: [a] };
    a.args = [b];
    expect(() => fieldFromJson(a as unknown as FieldSpec)).toThrow(/cyclic field spec/);
    // Diamond sharing (same object twice as siblings) is NOT a cycle.
    const leaf: FieldSpec = { fn: "index" };
    expect(() => fieldFromJson({ fn: "add", args: [leaf, leaf] })).not.toThrow();
  });

  it("rejects nesting past the depth cap with an actionable error", () => {
    let spec: FieldSpec = { fn: "index" };
    for (let i = 0; i < 400; i++) spec = { fn: "abs", args: [spec] };
    expect(() => fieldFromJson(spec)).toThrow(FieldJsonError);
    expect(() => fieldFromJson(spec)).toThrow(/deeper than 256 levels/);
  });

  it("rejects a bad fbm base, listing valid bases", () => {
    expect(() => fieldFromJson({ fn: "fbm", base: "linen" })).toThrow(
      /fbm base must be one of: valueNoise, perlinNoise, simplexNoise, worleyNoise/,
    );
  });

  it("covers every advertised fn name", () => {
    const fns = listFieldFns();
    for (const name of [
      "constant",
      "attribute",
      "attributeIs",
      "position",
      "index",
      "fraction",
      "nodeSeed",
      "randomField",
      "add",
      "sub",
      "mul",
      "div",
      "min",
      "max",
      "abs",
      "floor",
      "sqrt",
      "pow",
      "step",
      "clamp",
      "lerp",
      "remap",
      "select",
      "lt",
      "le",
      "gt",
      "ge",
      "eq",
      "ne",
      "dot",
      "cross",
      "length",
      "normalize",
      "sin",
      "cos",
      "tan",
      "asin",
      "acos",
      "atan",
      "atan2",
      "vec",
      "component",
      "ramp",
      "valueNoise",
      "perlinNoise",
      "simplexNoise",
      "worleyNoise",
      "fbm",
    ]) {
      expect(fns, `missing fn ${name}`).toContain(name);
    }
  });
});

describe("fieldToJson", () => {
  it("serializes code-authored fields through their derived spec", () => {
    // Was a pinned negative: this used to throw. A combinator field now
    // derives its spec from its inputs', so it serializes — and the JSON
    // rebuilds the identical field.
    const codeAuthored = mul(position(), 2);
    const json = fieldToJson(codeAuthored);
    expect(json).toEqual({
      fn: "mul",
      args: [{ fn: "position" }, { fn: "constant", value: 2 }],
    });
    expect(fieldFromJson(json).key).toBe(codeAuthored.key);
  });

  it("rejects non-field values", () => {
    expect(() => fieldToJson({ key: "fake", tupleSize: 1 } as never)).toThrow(/not a Field/);
  });
});

/**
 * The refusal names the ONE cause that applied, and the offender.
 *
 * Derivation withholds by returning a bare `undefined`, so the reason is
 * recorded at the withhold site and read back here. What each of these
 * tests actually pins is that the recorded reason SURVIVED to the
 * message: an assertion on the shared prefix ("carries no JSON spec")
 * would pass for every cause and could not tell whether discrimination
 * happened at all, which is why each one also asserts the message does
 * NOT read like the other causes.
 */
describe("fieldToJson refusals name their cause", () => {
  /** `makeField`'s evaluator is an arbitrary closure. Structural key: "opaque". */
  function opaque(tupleSize = 1): Field {
    return makeField("opaque", tupleSize, (ctx) => ({
      data: new Float32Array(ctx.geo.attrs[ctx.domain].count * tupleSize),
      tupleSize,
    }));
  }

  it("blames makeField itself when the field IS the closure", () => {
    // The permanent spec-less case, and the deliberate escape hatch. It
    // is also the one that records no reason — nothing WITHHELD a spec,
    // there was simply never one to attach — so this pins the fallback
    // too: no reason recorded must still produce the right accusation,
    // not a generic shrug.
    expect(() => fieldToJson(opaque())).toThrow(FieldJsonError);
    expect(() => fieldToJson(opaque())).toThrow(/It was built by makeField/);
    expect(() => fieldToJson(opaque())).toThrow(/Rebuild it with grammar constructors/);
    // Not blamed on a sub-expression, a depth cap, or a bad argument.
    expect(() => fieldToJson(opaque())).not.toThrow(/sub-expression|256 levels|parser does not/);
  });

  it("names the ROOT leaf of a deep tree, not the immediate argument", () => {
    // The case the old enumerating message could not localize at all: one
    // `makeField` buried under twelve combinator levels. Every level
    // withholds, and each inherits the leaf recorded below it — so the
    // key reported must be the closure's, never the key of whatever node
    // happened to sit next to the constructor that noticed.
    const buried = mul(
      add(
        component(
          remap(
            atan2(cos(sin(add(mul(opaque(), 2), 1))), 3),
            0,
            1,
            0,
            10,
          ),
          0,
        ),
        4,
      ),
      5,
    );
    expect(() => fieldToJson(buried)).toThrow(FieldJsonError);
    expect(() => fieldToJson(buried)).toThrow(/The sub-expression `opaque` carries none of its own/);
    expect(() => fieldToJson(buried)).toThrow(/composed over it inherits that/);
    // The immediate argument of the outermost `mul` is the `add` below
    // it, whose key is long and starts with "add(" — naming THAT would be
    // the "the thing next to me" failure this test exists to exclude.
    expect(() => fieldToJson(buried)).not.toThrow(/sub-expression `add\(/);
    // And the tree is not deep enough to be a depth-cap refusal.
    expect(() => fieldToJson(buried)).not.toThrow(/256 levels/);

    // Control: the identical tree over a describable leaf serializes, so
    // what is refused is the leaf, not the twelve levels above it.
    const same = mul(
      add(
        component(remap(atan2(cos(sin(add(mul(position(), 2), 1))), 3), 0, 1, 0, 10), 0),
        4,
      ),
      5,
    );
    expect(() => fieldToJson(same)).not.toThrow();
  });

  it("blames the depth cap, and keeps blaming it further up the tree", () => {
    // `position()` is level 1, so 256 adds reach level 257 — one past what
    // `fieldFromJson` will parse back, so derivation refuses to produce
    // it. Nothing here is opaque.
    const chain = (levels: number): Field => {
      let f: Field = position();
      for (let i = 1; i < levels; i++) f = add(f, 1);
      return f;
    };
    expect(() => fieldToJson(chain(256))).not.toThrow(); // at the cap
    for (const levels of [257, 258, 300]) {
      const deep = chain(levels);
      expect(() => fieldToJson(deep), `${levels} levels`).toThrow(FieldJsonError);
      expect(() => fieldToJson(deep), `${levels} levels`).toThrow(
        /nests deeper than the grammar's cap of 256 levels/,
      );
      expect(() => fieldToJson(deep), `${levels} levels`).toThrow(/Flatten the expression/);
      // Above the cap every level withholds because its ARGUMENT has no
      // spec, which is also how an opaque leaf propagates. Reporting the
      // argument's key here would accuse a `makeField` that does not
      // exist — so the too-deep reason has to be inherited, not restated.
      expect(() => fieldToJson(deep), `${levels} levels`).not.toThrow(/makeField|sub-expression/);
    }
  });

  it("names the offending option when a constructor is looser than the grammar", () => {
    // `perlinNoise` coerces the seed with `>>> 0`, so 1.5 builds a
    // perfectly good field — but the grammar's parser requires an
    // integer, and a spec it would reject is worse than none. The message
    // must say WHICH option, since nothing about the field looks opaque.
    const fractionalSeed = perlinNoise({ seed: 1.5 });
    expect(() => fieldToJson(fractionalSeed)).toThrow(FieldJsonError);
    expect(() => fieldToJson(fractionalSeed)).toThrow(/`seed` must be an integer/);
    expect(() => fieldToJson(fractionalSeed)).not.toThrow(/makeField|256 levels/);

    // A different option, so the detail is read from the reason rather
    // than hard-coded into one message.
    expect(() => fieldToJson(worleyNoise({ frequency: Infinity }))).toThrow(
      /worleyNoise's `frequency` must be finite/,
    );
    // And an fbm option the octave tree could only blame indirectly.
    expect(() => fieldToJson(fbm(perlinNoise, { lacunarity: Infinity }))).toThrow(
      /fbm's `lacunarity` must be finite/,
    );
  });

  it("keeps blaming the option when the ungrammatical leaf is nested", () => {
    // An ungrammatical leaf is NOT opaque: `constant`, `attribute` and
    // `perlinNoise` are grammar constructors, and the value handed to
    // them is what the parser rejects. Composing over one must inherit
    // that reason rather than downgrade it to "some sub-expression of
    // yours is a makeField closure" — which would be false, and would
    // send the reader looking for a closure that does not exist.
    const nested: Array<[Field, RegExp]> = [
      [mul(constant(NaN), 2), /constant's `value` must be finite/],
      [add(mul(attribute(""), 2), 1), /attribute's `name` must not be empty/],
      [sin(mul(perlinNoise({ seed: 1.5 }), 2)), /perlinNoise's `seed` must be an integer/],
    ];
    for (const [field, detail] of nested) {
      expect(() => fieldToJson(field)).toThrow(detail);
      // The accusation the old rule produced, and the reason this test
      // exists: nothing here is a makeField closure.
      expect(() => fieldToJson(field)).not.toThrow(/makeField|sub-expression/);
    }
  });

  it("follows an opaque position through the noise factories to its leaf", () => {
    // The noise paths withhold for reasons of their own, and a spec-less
    // `position` is the one that is NOT ungrammatical: it is the same
    // opaque-leaf case as a combinator's, and must report the same leaf.
    for (const build of [
      () => perlinNoise({ position: opaque(3) }),
      () => simplexNoise({ position: opaque(3), normalized: true }),
      () => fbm(perlinNoise, { position: opaque(3) }),
    ]) {
      expect(() => fieldToJson(build())).toThrow(
        /The sub-expression `opaque` carries none of its own/,
      );
    }
  });
});

/**
 * `param` — a named value standing where a literal would. The whole
 * design turns on one asymmetry: the VALUE goes into `Field.key` (by
 * substitution, so memoization needs no new machinery) while the
 * REFERENCE stays in the spec (so the graph serializes what was
 * authored). These pin both halves and the seam between them.
 */
describe("param bindings", () => {
  const AMP: FieldSpec = { fn: "param", name: "amp" };

  it("binds by substitution: the field IS the field the literal builds", () => {
    // Byte-identical to the literal, key included — which is the point.
    // `Field.key` is the memo contract (`stableValueHash` hashes a field
    // as `F(${key})`), so a value that reached the field any later than
    // construction could never move a node's param hash.
    const bound = fieldFromJson(AMP, { amp: 1.25 });
    expect(bound.key).toBe(constant(1.25).key);

    const ctx = testCloud();
    expect(Array.from(evaluateField(bound, ctx).data)).toEqual(
      Array.from(evaluateField(constant(1.25), ctx).data),
    );
  });

  it("a rebind moves the key exactly as editing the literal would", () => {
    expect(fieldFromJson(AMP, { amp: 1 }).key).not.toBe(fieldFromJson(AMP, { amp: 2 }).key);
    // ...and two names bound to one value share a key legitimately: they
    // produce the same bytes, so a shared cache entry is correct.
    expect(fieldFromJson({ fn: "param", name: "other" }, { other: 2 }).key).toBe(
      fieldFromJson(AMP, { amp: 2 }).key,
    );
  });

  it("binds an array as the matching vector", () => {
    const bound = fieldFromJson({ fn: "param", name: "offset" }, { offset: [1, 2, 3] });
    expect(bound.key).toBe(constant([1, 2, 3]).key);
    expect(bound.tupleSize).toBe(3);
  });

  it("round-trips the REFERENCE, never the value it stood for", () => {
    const bound = fieldFromJson(
      { fn: "mul", args: [{ fn: "position" }, AMP] },
      { amp: 0.5 },
    );
    expect(fieldToJson(bound)).toEqual({ fn: "mul", args: [{ fn: "position" }, { fn: "param", name: "amp" }] });
    // A serialized graph therefore reopens as a reference and must be
    // bound again — the value is not smuggled through the JSON.
    expect(JSON.stringify(fieldToJson(bound))).not.toContain("0.5");
  });

  it("is buildable but not evaluable when nothing binds it", () => {
    const unbound = fieldFromJson(AMP);
    expect(unbound.key).toBe('param("amp")');
    expect(() => evaluateField(unbound, testCloud())).toThrow(FieldJsonError);
    // The refusal names the param and states the fix — it is the message
    // a cook surfaces when a graph forgot a binding.
    expect(() => evaluateField(unbound, testCloud())).toThrow(/param "amp": nothing bound this name/);
    expect(() => evaluateField(unbound, testCloud())).toThrow(/fieldFromJson\(spec, \{ "amp": /);
  });

  it("an unbound param still round-trips and still nests", () => {
    const spec: FieldSpec = { fn: "add", args: [AMP, 1] };
    expect(fieldToJson(fieldFromJson(spec))).toEqual(spec);
    expect(fieldFromJson(spec).key).toBe(fieldFromJson(spec).key);
  });

  it("binds inside opts.position, which is an argument position like any other", () => {
    const spec: FieldSpec = {
      fn: "perlinNoise",
      opts: { position: { fn: "mul", args: [{ fn: "position" }, { fn: "param", name: "freq" }] } },
    };
    const bound = fieldFromJson(spec, { freq: 0.25 });
    expect(bound.key).toBe(perlinNoise({ position: mul(position(), 0.25) }).key);
    expect(fieldToJson(bound)).toEqual(spec);
  });

  it("rejects a malformed name and unknown keys the way every other fn does", () => {
    expect(() => fieldFromJson({ fn: "param" } as unknown as FieldSpec)).toThrow(
      /param requires a non-empty string name/,
    );
    expect(() => fieldFromJson({ fn: "param", name: "" })).toThrow(/non-empty string name/);
    expect(() => fieldFromJson({ fn: "param", name: "a", nmae: 1 } as unknown as FieldSpec)).toThrow(
      /unknown key "nmae" for fn "param"/,
    );
  });

  it("rejects a binding the grammar could not have accepted as a literal", () => {
    expect(() => fieldFromJson(AMP, { amp: Number.NaN })).toThrow(/bound to NaN; a binding must be finite/);
    expect(() => fieldFromJson(AMP, { amp: [] })).toThrow(
      /must be a finite\s+number .* a non-empty array of finite numbers .* or a Field/s,
    );
    expect(() => fieldFromJson(AMP, { amp: "big" as unknown as number })).toThrow(
      /param "amp" is bound to a string/,
    );
    expect(() => fieldFromJson(AMP, [1, 2] as unknown as Record<string, number>)).toThrow(
      /bindings must be an object/,
    );
  });

  it("names the bindings when an arity does not fit its use site", () => {
    // The combinator raises the tuple error and cannot know a param
    // stood there; `fieldFromJson` is the only frame that still knows.
    expect(() =>
      fieldFromJson({ fn: "add", args: [AMP, [1, 2]] }, { amp: [1, 2, 3] }),
    ).toThrow(/incompatible tuple sizes/);
    expect(() =>
      fieldFromJson({ fn: "add", args: [AMP, [1, 2]] }, { amp: [1, 2, 3] }),
    ).toThrow(/this spec binds "amp" = a 3-tuple; check each binding's arity/);
  });

  it("a binding for a name the spec never references is inert", () => {
    const spec: FieldSpec = { fn: "add", args: [1, 2] };
    expect(fieldFromJson(spec, { unused: 9 }).key).toBe(fieldFromJson(spec).key);
  });

  it("does not read binding names off Object.prototype", () => {
    // `{}.toString` exists on every object; a param named `toString` is
    // unbound unless something bound it as an OWN key.
    const spec: FieldSpec = { fn: "param", name: "toString" };
    expect(fieldFromJson(spec, { amp: 1 }).key).toBe('param("toString")');
  });

  it("is a leaf for the depth cap, like position", () => {
    const deep = (n: number): FieldSpec => {
      let spec: FieldSpec = AMP;
      for (let i = 1; i < n; i++) spec = { fn: "add", args: [spec, 1] };
      return spec;
    };
    expect(() => fieldFromJson(deep(256), { amp: 1 })).not.toThrow();
    expect(() => fieldFromJson(deep(257), { amp: 1 })).toThrow(/nesting deeper than 256 levels/);
  });
});

/**
 * The third way a name gets a value: written INTO the spec node. A `param`
 * that carries its own `value` is self-supplied, which is what makes a
 * plain node's expression tunable without a subgraph wrapped around it
 * purely to hold the number.
 *
 * The whole feature is a precedence and a key. The precedence — binding,
 * then splice, then inline, then the refusal — is what keeps a self-tuned
 * node still wrappable. The key is the sharp part: an inline value must
 * reach `Field.key` exactly as a binding's does, because `evaluateField`
 * memoizes per context ON THE KEY, so two values that keyed alike would be
 * handed each other's columns.
 */
describe("param — an inline value", () => {
  const AMP: FieldSpec = { fn: "param", name: "amp" };
  const inline = (value: number | readonly number[]): FieldSpec => ({
    fn: "param",
    name: "amp",
    value,
  });

  it("omitting the key preserves the unbound refusal, word for word", () => {
    // The premise of "strictly additive": every graph that has no `value`
    // in it behaves as it did, including the exact text of the error. This
    // is asserted rather than assumed because the handler now has a branch
    // that could have swallowed it.
    const unbound = fieldFromJson(AMP);
    expect(unbound.key).toBe('param("amp")');
    expect(() => evaluateField(unbound, testCloud())).toThrow(FieldJsonError);
    expect(() => evaluateField(unbound, testCloud())).toThrow(
      /^param "amp": nothing bound this name, so the field has no value to evaluate\. Build it with fieldFromJson\(spec, \{ "amp": <number \| number\[\] \| Field> \}\); an unbound param is buildable — its key and its GPU kernel need only the name — but never evaluable$/,
    );
    // An explicit `undefined` is the absence of the key, not a value: JSON
    // has no way to write one, but a spec assembled in code does.
    expect(fieldFromJson({ fn: "param", name: "amp", value: undefined }).key).toBe('param("amp")');
  });

  it("supplies itself: the field IS the field the literal builds", () => {
    const self = fieldFromJson(inline(1.25));
    expect(self.key).toBe(constant(1.25).key);
    const ctx = testCloud();
    expect(Array.from(evaluateField(self, ctx).data)).toEqual(
      Array.from(evaluateField(constant(1.25), ctx).data),
    );
    // A tuple stands as the matching vector, exactly as a binding's does.
    const vec = fieldFromJson(inline([1, 2, 3]));
    expect(vec.key).toBe(constant([1, 2, 3]).key);
    expect(vec.tupleSize).toBe(3);
  });

  it("carries the value into Field.key, so two values cannot collide", () => {
    // THE correctness point. `evaluateField` memoizes per context keyed on
    // `field.key`, so if these two keyed alike the second lookup would be
    // served the first's column — silently, and only when both appear in
    // one cook.
    const a = fieldFromJson(inline(0.05));
    const b = fieldFromJson(inline(0.1));
    expect(a.key).not.toBe(b.key);

    // Demonstrated as the bug it would be, not just as a string
    // inequality: one context, both fields, and the columns must differ.
    const ctx = testCloud();
    expect(evaluateField(a, ctx).data[0]).toBeCloseTo(0.05, 6);
    expect(evaluateField(b, ctx).data[0]).toBeCloseTo(0.1, 6);

    // And the same holds nested, where the key is composed rather than the
    // whole of it — a node's memo key is what this ultimately moves.
    const nest = (v: number): FieldSpec => ({ fn: "mul", args: [{ fn: "position" }, inline(v)] });
    expect(fieldFromJson(nest(0.05)).key).not.toBe(fieldFromJson(nest(0.1)).key);
  });

  it("an outer binding wins, and the inline value is the fallback", () => {
    const spec = inline(0.05);
    expect(fieldFromJson(spec, { amp: 2 }).key).toBe(constant(2).key);
    expect(fieldFromJson(spec, { amp: [1, 2, 3] }).key).toBe(constant([1, 2, 3]).key);
    // A binding for some OTHER name leaves this one on its own value.
    expect(fieldFromJson(spec, { other: 2 }).key).toBe(constant(0.05).key);
    // A spliced FIELD wins too, and stays won: the spec records the
    // splice, so a later value-free rebuild follows the expression rather
    // than falling back to the number underneath it.
    const spliced = fieldFromJson(spec, { amp: fraction() });
    expect(spliced.key).toBe(fraction().key);
    expect(fieldFromJson(peekFieldSpec(spliced) as FieldSpec).key).toBe(fraction().key);
  });

  it("round-trips the value, which a binding's cannot", () => {
    // The property worth naming: an inline value is written IN the spec,
    // where a binding's lives beside it in a side table — so this one
    // survives a save and reopens supplying itself.
    const spec: FieldSpec = { fn: "mul", args: [{ fn: "position" }, inline(0.05)] };
    const built = fieldFromJson(spec);
    expect(fieldToJson(built)).toEqual(spec);
    const reloaded = fieldFromJson(JSON.parse(JSON.stringify(fieldToJson(built))) as FieldSpec);
    expect(reloaded.key).toBe(built.key);
    // ...where the same expression bound from outside reopens unbound.
    const bound = fieldFromJson({ fn: "mul", args: [{ fn: "position" }, AMP] }, { amp: 0.05 });
    expect(fieldFromJson(fieldToJson(bound)).key).not.toBe(bound.key);
  });

  it("is stamped as a binding is, so paramValue sees it", () => {
    // The one line that buys the GPU uniform payload and the
    // domain-constant fold: both read `paramValue`, and neither knows
    // where the number came from.
    const node = (peekFieldSpec(fieldFromJson(inline(0.05))) as FieldSpec) ;
    expect(paramValue(node)).toBe(0.05);
    const tuple = peekFieldSpec(fieldFromJson(inline([1, 2, 3]))) as FieldSpec;
    expect(paramValue(tuple)).toEqual([1, 2, 3]);
    // Copied, never referenced — the key was fixed from these numbers.
    const source: number[] = [1, 2, 3];
    const stamped = peekFieldSpec(fieldFromJson(inline(source))) as FieldSpec;
    source[0] = 99;
    expect(paramValue(stamped)).toEqual([1, 2, 3]);
    // A binding still wins in the stamp too, or the device would write the
    // value the CPU did not use.
    const overridden = peekFieldSpec(fieldFromJson(inline(0.05), { amp: 2 })) as FieldSpec;
    expect(paramValue(overridden)).toBe(2);
    // And a spliced field records a SPEC rather than a number, unchanged.
    const splicedNode = peekFieldSpec(fieldFromJson(inline(0.05), { amp: fraction() })) as FieldSpec;
    expect(paramValue(splicedNode)).toBeUndefined();
    expect(paramSpecOf(splicedNode)).toEqual({ fn: "fraction" });
  });

  it("is not stamped where a spliced field outranked it", () => {
    // The stamp must describe the field that came OUT, and the handler
    // prefers a field an earlier call spliced onto this node. A spec
    // carrying both — the reference bound to a Field, and a `value` the
    // author wrote as its standalone fallback — rebuilds as the spliced
    // expression, so stamping the literal would tell the WGSL compiler to
    // write a number into a uniform this kernel never reads, and tell the
    // fold to bake a per-element expression into a constant.
    const built = fieldFromJson(inline(1), { amp: fraction() });
    const rebuilt = fieldFromJson(peekFieldSpec(built) as FieldSpec);
    expect(rebuilt.key).toBe(fraction().key);
    expect(paramValue(peekFieldSpec(rebuilt) as FieldSpec)).toBeUndefined();

    // Nested, where the mistake would be a wrong column rather than a
    // wrong root: the rebuild varies per element, so nothing may fold it.
    const spec: FieldSpec = { fn: "mul", args: [inline(1), 2] };
    const nested = fieldFromJson(spec, { amp: fraction() });
    const nestedAgain = fieldFromJson(peekFieldSpec(nested) as FieldSpec);
    expect(nestedAgain.key).toBe(fieldFromJson({ fn: "mul", args: [{ fn: "fraction" }, 2] }).key);
    const col = evaluateField(nestedAgain, testCloud(4));
    expect(Array.from(col.data)).toEqual([0, 2 / 3, 4 / 3, 2].map(Math.fround));
    // The literal it must NOT have become is `1 * 2` everywhere.
    expect(col.data[0]).not.toBe(col.data[1]);
  });

  it("stays out of the value-free rebuild, which keys the GPU kernel", () => {
    // One kernel serves every value of a name (the value rides a uniform
    // slot), so the key a kernel cache uses must not move with it. A bound
    // value never reached that rebuild — it lives beside the node — but an
    // inline one is IN the node, so it has to be told.
    expect(fieldFromJsonValueFree(inline(0.05)).key).toBe(fieldFromJsonValueFree(inline(0.1)).key);
    expect(fieldFromJsonValueFree(inline(0.05)).key).toBe('param("amp")');
    // ...while an ordinary build still substitutes.
    expect(fieldFromJson(inline(0.05)).key).toBe(constant(0.05).key);
  });

  it("refuses a value the grammar could not have written as a literal", () => {
    expect(() => fieldFromJson(inline(Number.NaN))).toThrow(/\$\.value: param "amp": an inline value/);
    expect(() => fieldFromJson({ fn: "param", name: "amp", value: [] })).toThrow(
      /an inline value must be a finite number .* or a non-empty array of finite numbers/s,
    );
    expect(() => fieldFromJson({ fn: "param", name: "amp", value: "0.5" })).toThrow(
      /omit the key entirely for a param that only a binder supplies/,
    );
    // Validated even when a binding overrides it: a spec that parses only
    // while something happens to shadow it breaks the day it is unwrapped.
    expect(() => fieldFromJson(inline(Number.POSITIVE_INFINITY), { amp: 1 })).toThrow(
      /an inline value must be a finite number/,
    );
  });

  it("refuses a dot in a param name", () => {
    // A panel addresses a field-spec param as
    // "<nodeId>.<paramKey>.<fieldParamName>", so a dot inside the name
    // would split that address somewhere nothing can put back together.
    // No registered node param name contains one today, which is a fact
    // about current data — this is what makes it a rule.
    expect(() => fieldFromJson({ fn: "param", name: "a.b" })).toThrow(
      /\$\.name: param name "a\.b" contains a "\."/,
    );
    expect(() => fieldFromJson({ fn: "param", name: "a.b" })).toThrow(
      /"<nodeId>\.<paramKey>\.<fieldParamName>".*rename the param without a dot/s,
    );
    // Refused wherever it appears, and whatever it carries.
    expect(() =>
      fieldFromJson({ fn: "mul", args: [{ fn: "position" }, { fn: "param", name: "a.b", value: 1 }] }),
    ).toThrow(/\$\.args\[1\]\.name: param name "a\.b"/);
    expect(() => fieldFromJson({ fn: "param", name: "a.b" }, { "a.b": 1 })).toThrow(/contains a "\."/);
    // A name with no dot is untouched, dots elsewhere included.
    expect(() => fieldFromJson({ fn: "attributeIs", name: "species", value: "a.b" })).not.toThrow();
  });

  it("unboundParamNamesOf lists only what a binder must still supply", () => {
    const spec: FieldSpec = {
      fn: "add",
      args: [{ fn: "param", name: "amp", value: 1 }, { fn: "param", name: "freq" }],
    };
    expect(paramNamesOf(spec)).toEqual(["amp", "freq"]);
    expect(unboundParamNamesOf(spec)).toEqual(["freq"]);
    // One name mentioned twice, once bare, is still owed: the bare
    // reference is as unbound as it ever was.
    const mixed: FieldSpec = {
      fn: "add",
      args: [{ fn: "param", name: "amp", value: 1 }, { fn: "param", name: "amp" }],
    };
    expect(unboundParamNamesOf(mixed)).toEqual(["amp"]);
  });
});

/**
 * The binding that is not a literal. A `Field` is SPLICED in where the
 * reference stands, which is what lets a named value vary per element —
 * the capability the per-point attribute column used to buy at the cost
 * of three nodes and a storage buffer.
 *
 * Everything the value bindings promise has to keep holding: the key
 * composes (so invalidation stays exact), the attached spec keeps the
 * REFERENCE (so a save cannot bake the field in), and provenance still
 * decides device eligibility — now for the spliced sub-expression too,
 * which lives beside the spec rather than inside it.
 */
describe("param bindings — a Field", () => {
  const AMP: FieldSpec = { fn: "param", name: "amp" };
  const SCALED: FieldSpec = { fn: "mul", args: [{ fn: "position" }, AMP] };

  it("splices the field in, so the result is the expression written around it", () => {
    const bound = fieldFromJson({ fn: "attribute", name: "density" });
    const spliced = fieldFromJson(SCALED, { amp: bound });
    expect(spliced.key).toBe(mul(position(), bound).key);

    const ctx = testCloud();
    expect(Array.from(evaluateField(spliced, ctx).data)).toEqual(
      Array.from(evaluateField(mul(position(), bound), ctx).data),
    );
  });

  it("carries the bound field's key, so a rebind moves the memo key", () => {
    const a = fieldFromJson({ fn: "fraction" });
    const b = fieldFromJson({ fn: "index" });
    expect(fieldFromJson(SCALED, { amp: a }).key).not.toBe(fieldFromJson(SCALED, { amp: b }).key);
    expect(fieldFromJson(SCALED, { amp: a }).key).toContain(a.key);
    // Content-addressed, exactly as a value binding is: two structurally
    // equal fields are one key and share a cache entry legitimately.
    expect(fieldFromJson(SCALED, { amp: a }).key).toBe(
      fieldFromJson(SCALED, { amp: fieldFromJson({ fn: "fraction" }) }).key,
    );
  });

  it("a constant-valued field binds as the VALUE, slot and all", () => {
    // The bridge between the two kinds of binding, and the reason the
    // route can replace the attribute idiom without moving a byte: a
    // field that happens not to vary is the scalar case, and is recorded
    // as one — which is what keeps a panel dragging a slider in "field"
    // mode (its editor seeds `{fn:"constant",value:…}`) on ONE kernel
    // instead of specializing a pipeline per tick.
    const viaField = fieldFromJson(AMP, { amp: fieldFromJson({ fn: "constant", value: 1.25 }) });
    expect(viaField.key).toBe(fieldFromJson(AMP, { amp: 1.25 }).key);
    const spec = peekFieldSpec(viaField) as FieldSpec;
    expect(paramValue(spec)).toBe(1.25);
    expect(paramSpecOf(spec)).toBeUndefined();
    // A tuple constant the same way, and a real expression NOT this way.
    const vecSpec = peekFieldSpec(
      fieldFromJson(AMP, { amp: fieldFromJson({ fn: "constant", value: [1, 2, 3] }) }),
    ) as FieldSpec;
    expect(paramValue(vecSpec)).toEqual([1, 2, 3]);
    const exprSpec = peekFieldSpec(
      fieldFromJson(AMP, { amp: fieldFromJson({ fn: "fraction" }) }),
    ) as FieldSpec;
    expect(paramValue(exprSpec)).toBeUndefined();
    expect(paramSpecOf(exprSpec)).toEqual({ fn: "fraction" });
  });

  it("round-trips the REFERENCE, never the field it stood for", () => {
    const bound = fieldFromJson({ fn: "fbm", base: "perlinNoise", opts: { frequency: 0.5 } });
    const spliced = fieldFromJson(SCALED, { amp: bound });
    expect(fieldToJson(spliced)).toEqual(SCALED);
    expect(JSON.stringify(fieldToJson(spliced))).not.toContain("fbm");
  });

  it("splices into opts.position too, the other field-valued position", () => {
    const spec: FieldSpec = { fn: "perlinNoise", opts: { position: AMP } };
    const bound = fieldFromJson({ fn: "mul", args: [{ fn: "position" }, 3] });
    expect(fieldFromJson(spec, { amp: bound }).key).toBe(perlinNoise({ position: bound }).key);
  });

  it("keeps the arity failure legible, naming the Field that did not fit", () => {
    const bound = fieldFromJson({ fn: "vec", args: [1, 2, 3] });
    expect(() => fieldFromJson({ fn: "add", args: [AMP, [1, 2]] }, { amp: bound })).toThrow(
      /incompatible tuple sizes/,
    );
    expect(() => fieldFromJson({ fn: "add", args: [AMP, [1, 2]] }, { amp: bound })).toThrow(
      /this spec binds "amp" = a Field of tuple size 3/,
    );
  });

  it("inherits the bound field's provenance, so the device gate still holds", () => {
    // An AUTHORED field spliced into an authored spec stays authored: the
    // whole expression is describable, so it may lower.
    const authored = fieldFromJson({ fn: "fraction" });
    expect(deviceSpec(fieldFromJson(SCALED, { amp: authored }), false)).toEqual(SCALED);

    // A field the CONSTRUCTORS composed is admitted only on the flag —
    // the same rule a code-composed root gets, applied through the
    // splice, so a graph that never asked for the device does not get it.
    const derived = mul(fraction(), 2);
    const withDerived = fieldFromJson(SCALED, { amp: derived });
    expect(deviceSpec(withDerived, false)).toBeUndefined();
    expect(specFallbackReason(withDerived)).toBe("derived-spec");
    expect(deviceSpec(withDerived, true)).toEqual(SCALED);

    // And a field nothing can name makes the whole expression unnameable,
    // exactly as an opaque leaf inside a derived tree does.
    const opaque = makeField("opaque", 1, (ctx) => ({
      data: new Float32Array(ctx.geo.attrs[ctx.domain].count).fill(2),
      tupleSize: 1,
    }));
    const withOpaque = fieldFromJson(SCALED, { amp: opaque });
    expect(deviceSpec(withOpaque, false)).toBeUndefined();
    expect(deviceSpec(withOpaque, true)).toBeUndefined();
    expect(specFallbackReason(withOpaque)).toBe("no-spec");
    // It still COOKS: an undescribable binding is a CPU cook, not a refusal.
    expect(Array.from(evaluateField(withOpaque, testCloud(2)).data)).toEqual(
      Array.from(evaluateField(mul(position(), opaque), testCloud(2)).data),
    );
  });

  it("inherits provenance THROUGH a spliced field's own bindings", () => {
    // The walk must not stop one level down. Both roots below are
    // authored, and only the innermost binding is not — if that did not
    // propagate, a code-composed expression would reach the device on a
    // resolver that never advertised the flag.
    const inner = fieldFromJson({ fn: "mul", args: [{ fn: "param", name: "j" }, 2] }, {
      j: mul(fraction(), 2),
    });
    const outer = fieldFromJson(SCALED, { amp: inner });
    expect(deviceSpec(outer, false)).toBeUndefined();
    expect(specFallbackReason(outer)).toBe("derived-spec");
    expect(deviceSpec(outer, true)).toEqual(SCALED);

    // And opaque outranks derived through the same chain.
    const opaqueInner = fieldFromJson({ fn: "param", name: "j" }, {
      j: makeField("opaque_nested", 1, (ctx) => ({
        data: new Float32Array(ctx.geo.attrs[ctx.domain].count),
        tupleSize: 1,
      })),
    });
    const opaqueOuter = fieldFromJson(SCALED, { amp: opaqueInner });
    expect(deviceSpec(opaqueOuter, true)).toBeUndefined();
    expect(specFallbackReason(opaqueOuter)).toBe("no-spec");
  });
});

describe("paramNamesOf", () => {
  it("lists every referenced name, sorted and deduplicated", () => {
    expect(
      paramNamesOf({
        fn: "add",
        args: [
          { fn: "mul", args: [{ fn: "param", name: "b" }, { fn: "param", name: "a" }] },
          { fn: "param", name: "b" },
        ],
      }),
    ).toEqual(["a", "b"]);
  });

  it("walks opts.position, which no `args` traversal would reach", () => {
    expect(
      paramNamesOf({
        fn: "fbm",
        base: "perlinNoise",
        opts: { position: { fn: "mul", args: [{ fn: "position" }, { fn: "param", name: "freq" }] } },
      }),
    ).toEqual(["freq"]);
  });

  it("reads rather than validates, and survives a cyclic spec", () => {
    expect(paramNamesOf({ fn: "add", args: [1, 2] })).toEqual([]);
    expect(paramNamesOf({ fn: "param" } as unknown as FieldSpec)).toEqual([]);
    const cyclic = { fn: "add", args: [{ fn: "param", name: "a" }] } as Record<string, unknown>;
    (cyclic.args as unknown[]).push(cyclic);
    expect(paramNamesOf(cyclic as unknown as FieldSpec)).toEqual(["a"]);
  });
});

describe("inlineParamValuesOf / withInlineParamValue — the panel's two halves", () => {
  const dunes: FieldSpec = {
    fn: "mul",
    args: [
      {
        fn: "fbm",
        base: "perlinNoise",
        opts: {
          position: {
            fn: "mul",
            args: [{ fn: "position" }, { fn: "param", name: "frequency", value: 0.06 }],
          },
        },
      },
      { fn: "param", name: "amplitude", value: 18 },
    ],
  };

  it("lists every name that supplies its own value, opts.position included", () => {
    expect(inlineParamValuesOf(dunes)).toEqual({ amplitude: 18, frequency: 0.06 });
  });

  it("omits a name with no inline value — an unbound reference is an error, not a control", () => {
    const spec: FieldSpec = {
      fn: "add",
      args: [{ fn: "param", name: "bound", value: 2 }, { fn: "param", name: "unbound" }],
    };
    expect(inlineParamValuesOf(spec)).toEqual({ bound: 2 });
    expect(unboundParamNamesOf(spec)).toEqual(["unbound"]);
    // Both halves see the same reference: it is listed as bindable, and
    // listed as something a binder must still supply.
    expect(paramNamesOf(spec)).toEqual(["bound", "unbound"]);
  });

  it("reads a tuple, and copies it out of the spec", () => {
    const spec: FieldSpec = { fn: "param", name: "centre", value: [1, 2, 3] };
    const read = inlineParamValuesOf(spec).centre as number[];
    read[0] = 99;
    expect(inlineParamValuesOf(spec).centre).toEqual([1, 2, 3]);
  });

  it("rewrites one name and leaves the spec it was handed alone", () => {
    const next = withInlineParamValue(dunes, "amplitude", 30);
    expect(inlineParamValuesOf(next)).toEqual({ amplitude: 30, frequency: 0.06 });
    expect(inlineParamValuesOf(dunes)).toEqual({ amplitude: 18, frequency: 0.06 });
  });

  it("rewrites a name that appears twice, and each copy is its own array", () => {
    const twice: FieldSpec = {
      fn: "add",
      args: [
        { fn: "param", name: "offset", value: [0, 0, 0] },
        { fn: "param", name: "offset", value: [1, 1, 1] },
      ],
    };
    const next = withInlineParamValue(twice, "offset", [5, 6, 7]);
    const args = next.args as Record<string, unknown>[];
    expect(args[0].value).toEqual([5, 6, 7]);
    expect(args[1].value).toEqual([5, 6, 7]);
    expect(args[0].value).not.toBe(args[1].value);
  });

  it("LEAVES a value-free reference value-free — a knob must not delete a binding point", () => {
    const spec: FieldSpec = {
      fn: "add",
      args: [{ fn: "param", name: "freq", value: 0.1 }, { fn: "param", name: "freq" }],
    };
    const next = withInlineParamValue(spec, "freq", 0.2);
    const args = next.args as Record<string, unknown>[];
    expect(args[0].value).toBe(0.2);
    expect(args[1].value).toBeUndefined();
    expect(unboundParamNamesOf(next)).toEqual(["freq"]);
  });

  it("the rewritten spec cooks to the new value", () => {
    const ctx = testCloud(4);
    const before = fieldFromJson({ fn: "param", name: "a", value: 2 });
    const after = fieldFromJson(withInlineParamValue({ fn: "param", name: "a", value: 2 }, "a", 7));
    expect(Array.from(evaluateField(before, ctx).data)).toEqual([2, 2, 2, 2]);
    expect(Array.from(evaluateField(after, ctx).data)).toEqual([7, 7, 7, 7]);
    // The value is substituted at construction, so the two fields key
    // differently — which is what makes a node's memo miss on a knob turn.
    expect(after.key).not.toBe(before.key);
  });

  it("refuses a value the grammar would not accept, naming the param", () => {
    expect(() =>
      withInlineParamValue({ fn: "param", name: "a", value: 1 }, "a", Number.NaN),
    ).toThrow(/withInlineParamValue: value for param "a"/);
  });

  it("REFUSES a name that supplies nothing, rather than reporting a write it did not make", () => {
    // The caller believes it is moving a value. A silent no-op is a knob
    // that turns and does nothing, which is the one failure a panel cannot
    // see — so the two cases are told apart and both named.
    expect(() => withInlineParamValue(dunes, "nosuch", 1)).toThrow(
      /no param "nosuch" in this spec supplies its own value.*Names this spec supplies: frequency, amplitude/s,
    );
    expect(() => withInlineParamValue({ fn: "param", name: "outer" }, "outer", 1)).toThrow(
      /The name IS referenced, but with no "value" of its own/,
    );
  });

  it("carries a name the prototype chain would otherwise swallow", () => {
    // `__proto__` is a legal param name — non-empty and dot-free — and on a
    // plain object it is a setter, so a bare {} would drop it and let a
    // tuple value re-prototype the record the caller iterates.
    const spec: FieldSpec = { fn: "param", name: "__proto__", value: [1, 2, 3] };
    const values = inlineParamValuesOf(spec);
    expect(Object.keys(values)).toEqual(["__proto__"]);
    expect(values.__proto__).toEqual([1, 2, 3]);
    expect(inlineParamValuesOf(withInlineParamValue(spec, "__proto__", 4)).__proto__).toBe(4);
  });
});

describe("inlineParamMetaOf — the schema an inline param carries in the graph", () => {
  const described: FieldSpec = {
    fn: "param",
    name: "amplitude",
    value: 1.2,
    min: 0,
    max: 8,
    description: "How far the spine wanders up and down, in world units.",
  };

  it("reads the three optional keys, and reports nothing for a param without them", () => {
    expect(inlineParamMetaOf(described)).toEqual({
      amplitude: {
        min: 0,
        max: 8,
        description: "How far the spine wanders up and down, in world units.",
      },
    });
    expect(inlineParamMetaOf({ fn: "param", name: "plain", value: 1 })).toEqual({});
  });

  it("round-trips through fieldToJson unchanged", () => {
    // The metadata is written IN the node, so it survives serialization the
    // way the inline value does and for the same reason.
    expect(fieldToJson(fieldFromJson(described))).toEqual(described);
  });

  it("NEVER reaches Field.key — the per-evaluation cache is content-keyed on it", () => {
    // Two fields with equal keys are handed each other's columns, so a key
    // that carried prose would stop two equal values sharing a column and
    // would make editing a sentence recook the graph.
    const bare: FieldSpec = { fn: "param", name: "amplitude", value: 1.2 };
    const other: FieldSpec = {
      fn: "param",
      name: "amplitude",
      value: 1.2,
      min: -100,
      max: 100,
      description: "Entirely different prose, entirely different bounds.",
    };
    expect(fieldFromJson(described).key).toBe(fieldFromJson(bare).key);
    expect(fieldFromJson(other).key).toBe(fieldFromJson(bare).key);
    // And it is the key the literal itself builds, which is the property the
    // inline value was given in the first place.
    expect(fieldFromJson(bare).key).toBe(constant(1.2).key);
    // The VALUE still moves it, because the value is what changes the answer.
    expect(fieldFromJson({ ...described, value: 1.3 }).key).not.toBe(
      fieldFromJson(bare).key,
    );
    const ctx = testCloud(3);
    // Same column, to the last bit of the f32 the value rounds to.
    expect(Array.from(evaluateField(fieldFromJson(described), ctx).data)).toEqual(
      Array.from(evaluateField(fieldFromJson(bare), ctx).data),
    );
  });

  it("survives a knob turn: the range describes the param, not the number in it", () => {
    const next = withInlineParamValue(described, "amplitude", 5);
    expect(inlineParamValuesOf(next)).toEqual({ amplitude: 5 });
    expect(inlineParamMetaOf(next)).toEqual(inlineParamMetaOf(described));
  });

  it("documents a twice-read name once, wherever its author wrote it", () => {
    // The rig's `wanderScale` reaches two noises. One name is one knob, so
    // neither reference is the privileged one and the first DEFINITION of
    // each key wins.
    const twice: FieldSpec = {
      fn: "add",
      args: [
        { fn: "param", name: "scale", value: 1, max: 8 },
        { fn: "param", name: "scale", value: 1, min: 0.1, max: 99, description: "Both noises." },
      ],
    };
    expect(inlineParamMetaOf(twice)).toEqual({
      scale: { min: 0.1, max: 8, description: "Both noises." },
    });
  });

  it("refuses a range nothing can satisfy, naming the param", () => {
    expect(() => fieldFromJson({ fn: "param", name: "a", value: 1, min: 4, max: 2 })).toThrow(
      /param "a": min 4 is above max 2/,
    );
    expect(() => fieldFromJson({ fn: "param", name: "a", value: 1, min: 2 })).toThrow(
      /param "a": the inline value 1 is below its own min 2/,
    );
    expect(() => fieldFromJson({ fn: "param", name: "a", value: 9, max: 2 })).toThrow(
      /param "a": the inline value 9 is above its own max 2/,
    );
    // Componentwise for a tuple, which is what `ParamSchema.min` means for a
    // vec — so one bad axis is enough.
    expect(() =>
      fieldFromJson({ fn: "param", name: "a", value: [1, 2, 9], min: 0, max: 3 }),
    ).toThrow(/param "a": the inline value 9 is above its own max 3/);
    expect(() =>
      fieldFromJson({ fn: "param", name: "a", value: [1, 2, 3], min: 0, max: 3 }),
    ).not.toThrow();
  });

  it("refuses metadata with no value to describe, and says where the prose belongs", () => {
    expect(() => fieldFromJson({ fn: "param", name: "a", description: "..." })).toThrow(
      /param "a": description describes an inline value, and this reference carries none/,
    );
    expect(() => fieldFromJson({ fn: "param", name: "a", min: 0, max: 1 })).toThrow(
      /a subgraph's exposed param declares its own description, min and max/,
    );
  });

  it("refuses a bound or a description the schema vocabulary would not accept", () => {
    expect(() => fieldFromJson({ fn: "param", name: "a", value: 1, min: "0" })).toThrow(
      /param "a": min must be a finite number/,
    );
    expect(() => fieldFromJson({ fn: "param", name: "a", value: 1, max: Number.NaN })).toThrow(
      /param "a": max must be a finite number/,
    );
    expect(() => fieldFromJson({ fn: "param", name: "a", value: 1, description: "  " })).toThrow(
      /param "a": description must be a non-empty string/,
    );
  });

  it("still refuses a key the grammar does not know", () => {
    // The keys are admitted by NAME, not by "anything beside a param node is
    // fine": a typo stays an error that names the allowed set.
    expect(() => fieldFromJson({ fn: "param", name: "a", value: 1, step: 0.1 })).toThrow(
      /unknown key "step" for fn "param"; allowed keys: fn, name, value, min, max, description/,
    );
  });

  it("checks the spec even when a binding overrides the value", () => {
    // A graph that parses only while something happens to bind it is a graph
    // that breaks the day the binding goes away.
    expect(() =>
      fieldFromJson({ fn: "param", name: "a", value: 1, min: 4, max: 2 }, { a: 3 }),
    ).toThrow(/param "a": min 4 is above max 2/);
  });
});

describe("param binding immutability", () => {
  it("a tuple binding is copied, so mutating the caller's array cannot desync it", () => {
    // The field's key was fixed from the value at construction. If the
    // recorded binding were the caller's array, a later mutation would
    // leave the key and the recorded value describing different numbers —
    // and the GPU reads the recording while the memo cache reads the key.
    const off = [1, 2, 3];
    const field = fieldFromJson({ fn: "param", name: "off" }, { off });
    const before = fieldToJson(field);
    off[0] = 99;
    expect(field.key).toBe(constant([1, 2, 3]).key);
    expect(fieldToJson(field)).toEqual(before);
    expect(Array.from(evaluateField(field, testCloud(2)).data)).toEqual([1, 2, 3, 1, 2, 3]);
  });
});

describe("variation classification", () => {
  /**
   * The fns whose value can differ between two elements of the same
   * domain. Pinned by NAME rather than counted, because the cost of a
   * wrong answer is asymmetric: classifying a per-element fn as uniform
   * makes the domain-constant fold collapse a whole column to whatever it
   * happened to evaluate to on one synthetic point, silently and with no
   * error anywhere. Adding a fn to this list is a decision a reviewer
   * should see, so it fails here until someone writes it down.
   */
  const PER_ELEMENT = [
    "attribute", "attributeIs", "byAttribute", "fbm", "fraction", "index", "param", "perlinNoise",
    "position", "randomField", "simplexNoise", "valueNoise", "worleyNoise",
  ];

  it("every registered fn carries an explicit answer", () => {
    const unclassified = listFieldFns().filter(
      (fn) => !["per-element", "uniform"].includes(fnVariation(fn) as string),
    );
    expect(unclassified, `unclassified fns: ${unclassified.join(", ")}`).toEqual([]);
  });

  it("classifies exactly the reviewed set as per-element", () => {
    const perElement = listFieldFns().filter((fn) => fnVariation(fn) === "per-element");
    expect(perElement).toEqual(PER_ELEMENT);
  });

  it("has no answer for a name the grammar does not know", () => {
    expect(fnVariation("notAFn")).toBeUndefined();
  });
});

/**
 * `opts.seed`: an integer, or the one tagged form. The position is closed
 * on purpose — a seed has no tolerance, so an arbitrary expression there
 * would resolve to a different u32 on the GPU and cook a different noise
 * — and every refusal has to say which of the two shapes was wanted,
 * because an agent reading only the message has to be able to write the
 * fix.
 */
describe("opts.seed — the node-seed ref", () => {
  function seedSpec(seed: unknown): FieldSpec {
    return { fn: "perlinNoise", opts: { seed, frequency: 0.045 } } as unknown as FieldSpec;
  }

  it("round-trips the tagged form unchanged", () => {
    const spec = seedSpec({ from: "node", variant: 3 });
    expect(fieldToJson(fieldFromJson(spec))).toEqual(spec);
  });

  it("round-trips a param variant, metadata intact", () => {
    const spec: FieldSpec = {
      fn: "fbm",
      base: "perlinNoise",
      opts: {
        seed: {
          from: "node",
          variant: { fn: "param", name: "ridgeVariant", value: 4, min: 0, max: 16, description: "which draw" },
        },
        octaves: 3,
      },
    } as unknown as FieldSpec;
    expect(fieldToJson(fieldFromJson(spec))).toEqual(spec);
  });

  it("an integer seed is untouched", () => {
    const spec = seedSpec(12345);
    expect(fieldToJson(fieldFromJson(spec))).toEqual(spec);
  });

  // `normalized` wraps the noise in a fresh field that has to be given a
  // MIRRORED spec, so the ref has to survive that copy too.
  it("round-trips under normalized: true", () => {
    const spec = {
      fn: "worleyNoise",
      opts: { seed: { from: "node", variant: 2 }, output: "f2-f1", normalized: true },
    } as unknown as FieldSpec;
    expect(fieldToJson(fieldFromJson(spec))).toEqual(spec);
  });

  // Legal, and asserted as legal: the discriminator alone is a complete
  // ref, and `variant` defaults to 0.
  it("a ref with no variant parses, as variant 0", () => {
    const field = fieldFromJson(seedSpec({ from: "node" }));
    const ctx = testCloud();
    expect(Array.from(evaluateField(field, ctx).data)).toEqual(
      Array.from(evaluateField(fieldFromJson(seedSpec({ from: "node", variant: 0 })), ctx).data),
    );
  });

  it("the variant is the number a param binds, not the one written in the node", () => {
    const spec = seedSpec({ from: "node", variant: { fn: "param", name: "v", value: 1 } });
    const ctx = testCloud();
    const bound = evaluateField(fieldFromJson(spec, { v: 9 }), ctx).data;
    const literal = evaluateField(fieldFromJson(seedSpec({ from: "node", variant: 9 })), ctx).data;
    expect(Array.from(bound)).toEqual(Array.from(literal));
  });

  it.each([
    [1.5, /variant must be an integer, got 1\.5/],
    [-1, /variant must be 0 or greater, got -1/],
    [2 ** 24 + 1, /variant must be at most 16777216 \(2\^24\), got 16777217/],
  ])("refuses a variant of %s", (variant, message) => {
    expect(() => fieldFromJson(seedSpec({ from: "node", variant }))).toThrow(message);
  });

  it("refuses an unknown `from`", () => {
    expect(() => fieldFromJson(seedSpec({ from: "cell", variant: 1 }))).toThrow(
      /"from" must be "node", the one seed a noise can derive from today; got "cell"/,
    );
  });

  it("refuses an unknown key inside the ref", () => {
    expect(() => fieldFromJson(seedSpec({ from: "node", variant: 1, zeroAt: 40100 }))).toThrow(
      /unknown key "zeroAt" in a node-seed ref/,
    );
  });

  it("refuses a non-integer seed, naming both legal forms", () => {
    expect(() => fieldFromJson(seedSpec(1.5))).toThrow(
      /seed must be an integer, or the tagged form \{"from": "node", "variant": <integer 0 to 16777216>\}/,
    );
  });

  it("refuses a spec at opts.seed", () => {
    expect(() => fieldFromJson(seedSpec({ fn: "nodeSeed" }))).toThrow(
      /unknown key "fn" in a node-seed ref/,
    );
  });

  it("refuses a non-param spec at the variant", () => {
    expect(() =>
      fieldFromJson(seedSpec({ from: "node", variant: { fn: "mul", args: [{ fn: "nodeSeed" }, 3] } })),
    ).toThrow(/variant takes an integer, or an inline \{"fn": "param"/);
  });

  it("refuses a Field bound to the variant", () => {
    const spec = seedSpec({ from: "node", variant: { fn: "param", name: "v", value: 1 } });
    expect(() => fieldFromJson(spec, { v: perlinNoise({ seed: 1 }) })).toThrow(
      /stands at a noise seed's variant and is bound to a Field/,
    );
  });

  it("refuses a tuple bound to the variant", () => {
    const spec = seedSpec({ from: "node", variant: { fn: "param", name: "v", value: 1 } });
    expect(() => fieldFromJson(spec, { v: [1, 2] })).toThrow(
      /stands at a noise seed's variant and is a 2-tuple/,
    );
  });

  // Unlike an ordinary param, there is no later moment to supply this
  // one: the seed decides `Field.key`, which is fixed at construction.
  it("refuses a variant param with neither a value nor a binding", () => {
    expect(() => fieldFromJson(seedSpec({ from: "node", variant: { fn: "param", name: "v" } }))).toThrow(
      /stands at a noise seed's variant with no "value" of its own and nothing bound to it/,
    );
  });

  // Presence, not truthiness: an explicit undefined IS a binding, and
  // falling back to the inline value would let a binder miss silently.
  it("refuses a variant param bound to undefined rather than falling back", () => {
    const spec = seedSpec({ from: "node", variant: { fn: "param", name: "v", value: 1 } });
    expect(() => fieldFromJson(spec, { v: undefined } as never)).toThrow(
      /stands at a noise seed's variant and is bound to undefined/,
    );
  });

  it("refuses an out-of-range param value", () => {
    expect(() =>
      fieldFromJson(seedSpec({ from: "node", variant: { fn: "param", name: "v", value: -3 } })),
    ).toThrow(/variant must be 0 or greater, got -3/);
  });

  // The four walkers that route through `specChildren` all have to reach
  // it: this is what allocates the uniform slot, reports the address to a
  // panel, and recovers the value for the domain-constant rebuild.
  it("a variant param is reachable to every spec walker", () => {
    const spec = seedSpec({
      from: "node",
      variant: { fn: "param", name: "ridgeVariant", value: 4, min: 0, max: 16, description: "which draw" },
    });
    expect(paramNamesOf(spec)).toEqual(["ridgeVariant"]);
    expect(unboundParamNamesOf(spec)).toEqual([]);
    expect(inlineParamValuesOf(spec)).toEqual({ ridgeVariant: 4 });
    expect(inlineParamMetaOf(spec)).toEqual({
      ridgeVariant: { min: 0, max: 16, description: "which draw" },
    });
    // The field's OWN spec object, not `fieldToJson`'s defensive copy:
    // the value rides a side table keyed on the node, and that is where
    // the GPU's uniform filler and the fold both read it from.
    const stamped = peekFieldSpec(fieldFromJson(spec)) as unknown as {
      opts: { seed: { variant: FieldSpec } };
    };
    expect(paramValue(stamped.opts.seed.variant)).toBe(4);
  });

  it("a knob turn rewrites the variant and the field follows", () => {
    const spec = seedSpec({ from: "node", variant: { fn: "param", name: "v", value: 1 } });
    const turned = withInlineParamValue(spec, "v", 9);
    const ctx = testCloud();
    expect(Array.from(evaluateField(fieldFromJson(turned), ctx).data)).toEqual(
      Array.from(evaluateField(fieldFromJson(seedSpec({ from: "node", variant: 9 })), ctx).data),
    );
  });

  // One kernel serves every variant, so the value-free rebuild that keys
  // it must not carry the number — while an INTEGER variant is spec text
  // and stays in the key, as it always has been.
  it("the value-free rebuild drops a param variant and keeps a literal one", () => {
    const paramSpec = seedSpec({ from: "node", variant: { fn: "param", name: "v", value: 5 } });
    expect(fieldFromJsonValueFree(paramSpec).key).toBe(
      fieldFromJsonValueFree(seedSpec({ from: "node", variant: { fn: "param", name: "v", value: 6 } })).key,
    );
    expect(fieldFromJsonValueFree(seedSpec({ from: "node", variant: 5 })).key).not.toBe(
      fieldFromJsonValueFree(seedSpec({ from: "node", variant: 6 })).key,
    );
  });
});

describe("opts.frequency stays a literal", () => {
  // Rejected because it already exists: the sample point is
  // `p * frequency + offset`, so scaling the POSITION computes the same
  // point through the one option that does take a spec. The refusal has
  // to say so — it is the answer, not a consolation.
  it("names the position equivalent", () => {
    expect(() =>
      fieldFromJson({
        fn: "perlinNoise",
        opts: { frequency: { fn: "attribute", name: "density" } },
      } as unknown as FieldSpec),
    ).toThrow(
      /frequency must be a finite number; it is not a field position[\s\S]*"position": \{"fn": "mul"/,
    );
  });

  it("and the equivalent it names computes the same field", () => {
    const ctx = testCloud();
    const scaled = fieldFromJson({
      fn: "perlinNoise",
      opts: {
        seed: 3,
        position: { fn: "mul", args: [{ fn: "position" }, 0.25] },
        frequency: 1,
      },
    } as unknown as FieldSpec);
    const literal = fieldFromJson({
      fn: "perlinNoise",
      opts: { seed: 3, frequency: 0.25 },
    } as unknown as FieldSpec);
    const a = evaluateField(scaled, ctx).data;
    const b = evaluateField(literal, ctx).data;
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], 5);
  });
});

/**
 * The catalog `pcg fields` prints and `listFieldFnInfos()` returns. These
 * tests exist because the field grammar's catalog once published a type
 * signature and nothing else — `args: [arg0, arg1, arg2]` for `select`,
 * no output range on any noise — so an agent authoring the half of the
 * language where the interesting work happens had to build a probe graph
 * to learn what it was writing. What is asserted here is what stops that
 * from coming back.
 */
describe("listFieldFnInfos — the field-fn catalog", () => {
  const infos = listFieldFnInfos();

  it("describes every registered fn, and only registered fns", () => {
    expect(infos.map((i) => i.fn)).toEqual(listFieldFns());
    for (const info of infos) {
      // Non-empty and actually prose: a description equal to the name, or
      // to the usage sketch, is the gap this field closes wearing a
      // different hat.
      expect(info.description.trim(), info.fn).not.toBe("");
      expect(info.description, info.fn).not.toBe(info.fn);
      expect(info.description, info.fn).not.toBe(info.usage);
      expect(info.description.length, info.fn).toBeGreaterThan(20);
    }
  });

  it("names every args position, and never publishes arg0", () => {
    for (const info of infos) {
      // `arg0..argN` was the whole defect: a length is not a signature.
      expect(info.usage, info.fn).not.toMatch(/\barg\d/);
      const takesArgs = info.keys.includes("args");
      expect(info.args !== undefined, `${info.fn} keys=${info.keys.join(",")}`).toBe(takesArgs);
      if (info.args === undefined) continue;
      const names = info.args.map((a) => a.name);
      expect(new Set(names).size, info.fn).toBe(names.length);
      for (const a of info.args) {
        expect(a.name.trim(), info.fn).not.toBe("");
        expect(a.description.trim(), `${info.fn}.${a.name}`).not.toBe("");
      }
      // The usage sketch, the arity check and the published names are one
      // declaration — a fn cannot advertise three names and accept four.
      // A REPEATED position (a name ending in `…`) is the one exemption:
      // `vec` has no fixed arity, so its sketch shows an example instead.
      if (names.some((n) => n.endsWith("…"))) continue;
      expect(info.usage, info.fn).toContain(`args: [${names.join(", ")}]`);
    }
  });

  it("publishes ranges that are ordered and finite wherever it publishes any", () => {
    for (const info of infos) {
      if (info.outputRange === undefined) continue;
      expect(info.outputRange.length, info.fn).toBeGreaterThan(0);
      for (const r of info.outputRange) {
        expect(Number.isFinite(r.min) && Number.isFinite(r.max), info.fn).toBe(true);
        expect(r.min, info.fn).toBeLessThan(r.max);
      }
    }
  });

  it("returns a fresh copy, so a caller cannot edit the registry", () => {
    const first = listFieldFnInfos().find((i) => i.fn === "select");
    (first as unknown as { args: { name: string }[] }).args[0].name = "clobbered";
    expect(listFieldFnInfos().find((i) => i.fn === "select")?.args?.[0].name).toBe("cond");
  });

  /**
   * The ranges are read off `NOISE_RAW_RANGES`, the one table the noise
   * factories are built against, so the catalog cannot advertise a range
   * the field does not have. Checked against a BUILT field rather than
   * against the table alone: `noiseOutputRange` is what the library
   * records on the actual column, and the two agreeing is the claim.
   */
  it("publishes each noise's real output range, taken from the built field", () => {
    const published = (fn: string): readonly { min: number; max: number; note?: string }[] => {
      const range = infos.find((i) => i.fn === fn)?.outputRange;
      expect(range, `${fn} publishes no output range`).toBeDefined();
      return range as readonly { min: number; max: number; note?: string }[];
    };
    for (const fn of ["valueNoise", "perlinNoise", "simplexNoise"] as const) {
      const [first] = published(fn);
      expect([first.min, first.max], fn).toEqual([...NOISE_RAW_RANGES[fn]]);
      expect(noiseOutputRange(fieldFromJson({ fn })), fn).toEqual([...NOISE_RAW_RANGES[fn]]);
    }
    // Worley has one range per `output`, which is exactly why the entries
    // carry a note: one pair of numbers would be a wrong answer for two of
    // the three.
    const worley = published("worleyNoise");
    for (const output of ["f1", "f2", "f2-f1"] as const) {
      const entry = worley.find((r) => r.note?.includes(`"${output}"`));
      expect(entry, `worleyNoise has no entry for output ${output}`).toBeDefined();
      const real = noiseOutputRange(
        fieldFromJson({ fn: "worleyNoise", opts: { output } } as unknown as FieldSpec),
      );
      expect([entry?.min, entry?.max], output).toEqual([...(real as readonly number[])]);
    }
    // fbm's range is per-configuration; the published one is the default
    // (4 octaves, gain 0.5) over perlin, so it moves if those defaults do.
    const [fbmDefault] = published("fbm");
    expect([fbmDefault.min, fbmDefault.max]).toEqual([
      ...(noiseOutputRange(fieldFromJson({ fn: "fbm", base: "perlinNoise" })) as readonly number[]),
    ]);
    // Every noise's `normalized: true` entry, checked against the wrapper.
    for (const fn of ["valueNoise", "perlinNoise", "simplexNoise", "worleyNoise"] as const) {
      const normalized = published(fn).find((r) => r.note === "opts.normalized: true");
      if (normalized === undefined) continue;
      expect([normalized.min, normalized.max], fn).toEqual([
        ...(noiseOutputRange(
          fieldFromJson({ fn, opts: { normalized: true } } as unknown as FieldSpec),
        ) as readonly number[]),
      ]);
    }
  });
});

/**
 * 40 points at unit spacing from [0,0,0] to [39,0,0] — the most natural
 * thing an author writes (`pointGrid` at its default spacing), and the
 * arrangement on which perlin is silently dead.
 */
function unitLine(n = 40): EvalContext {
  const geo = createPointCloud(n);
  const P = geo.attrs.point.require("P");
  for (let i = 0; i < n; i++) P.setTuple(i, [i, 0, 0]);
  return { geo, domain: "point", seed: 7 };
}

function extremes(field: Field, ctx: EvalContext): { min: number; max: number } {
  const data = Array.from(evaluateField(field, ctx).data);
  return { min: Math.min(...data), max: Math.max(...data) };
}

describe("the integer-lattice trap the catalog documents", () => {
  const ctx = unitLine();

  it("is real: perlin at a whole-number frequency on a unit lattice is all zeros", () => {
    for (const frequency of [1, 2, 3]) {
      const { min, max } = extremes(fieldFromJson({ fn: "perlinNoise", opts: { frequency } }), ctx);
      expect([min, max], `frequency ${frequency}`).toEqual([0, 0]);
    }
    // Nothing throws anywhere along the way, which is the whole problem:
    // the failure is a dead attribute, not an exception.
    expect(() => fieldFromJson({ fn: "perlinNoise", opts: { frequency: 1 } })).not.toThrow();
  });

  it("is fixed by a fractional frequency, and NOT by an integer offset", () => {
    const half = extremes(fieldFromJson({ fn: "perlinNoise", opts: { frequency: 0.5 } }), ctx);
    expect(half.min).toBeCloseTo(-0.408248, 5);
    expect(half.max).toBeCloseTo(0.408248, 5);
    // The remedy the description names has to be the one that works: an
    // integer offset only moves the samples onto other lattice points.
    const integerOffset = extremes(
      fieldFromJson({ fn: "perlinNoise", opts: { frequency: 1, offset: [3, 4, 5] } }),
      ctx,
    );
    expect([integerOffset.min, integerOffset.max]).toEqual([0, 0]);
    const fractionalOffset = extremes(
      fieldFromJson({ fn: "perlinNoise", opts: { frequency: 1, offset: [0.37, 0.11, 0.23] } }),
      ctx,
    );
    expect(fractionalOffset.max).toBeGreaterThan(0.1);
    expect(fractionalOffset.min).toBeLessThan(-0.1);
  });

  it("reaches every octave of an fbm over perlin, and no other noise", () => {
    // `lacunarity` defaults to 2, so every octave lands on the lattice
    // together — the trap is worse under fbm, not diluted by it.
    const dead = extremes(
      fieldFromJson({ fn: "fbm", base: "perlinNoise", opts: { frequency: 1 } }),
      ctx,
    );
    expect([dead.min, dead.max]).toEqual([0, 0]);
    // Value noise returns the lattice point's own random value, and
    // simplex's lattice is skewed, so neither is degenerate here. The
    // catalog says so and has to keep being right about it.
    for (const fn of ["valueNoise", "simplexNoise"] as const) {
      const { min, max } = extremes(fieldFromJson({ fn, opts: { frequency: 1 } }), ctx);
      expect(max - min, fn).toBeGreaterThan(0.5);
    }
  });

  it("is named, with its remedy, in the descriptions of both fns it bites", () => {
    // The measurement above is worth nothing if the catalog stops saying
    // it. Both fns must name the lattice AND a fix an author can apply.
    for (const fn of ["perlinNoise", "fbm"] as const) {
      const description = listFieldFnInfos().find((i) => i.fn === fn)?.description ?? "";
      expect(description, fn).toMatch(/lattice/i);
      expect(description, fn).toMatch(/fractional/i);
    }
  });
});

/**
 * 40,000 pseudo-random points in a 1000-unit cube, from a fixed PCG32
 * seed so the numbers below are the same on every run and platform. This
 * is the sample the `perlinNoise` and `simplexNoise` descriptions quote.
 */
function scatteredCloud(n = 40000): EvalContext {
  const geo = createPointCloud(n);
  const P = geo.attrs.point.require("P");
  const rng = new Pcg32(20260817);
  for (let i = 0; i < n; i++) {
    P.setTuple(i, [rng.range(-500, 500), rng.range(-500, 500), rng.range(-500, 500)]);
  }
  return { geo, domain: "point", seed: 7 };
}

/**
 * The catalog tells authors the published bound is a BOUND and not an
 * amplitude, and quotes numbers for how far short of it the noises fall.
 * An unpinned number in a doc goes stale silently, and a stale number here
 * is the same defect the whole change exists to remove — so the claim is
 * asserted as a bracket, wide enough not to be a change detector and tight
 * enough to fail if the amplitude actually moves.
 */
describe("the practical noise amplitudes the catalog quotes", () => {
  const ctx = scatteredCloud();

  it("keeps perlin near ±0.75 and simplex near ±0.94, both inside the published bound", () => {
    const perlin = extremes(fieldFromJson({ fn: "perlinNoise", opts: { frequency: 0.07 } }), ctx);
    expect(perlin.min).toBeGreaterThan(-0.85);
    expect(perlin.min).toBeLessThan(-0.65);
    expect(perlin.max).toBeLessThan(0.85);
    expect(perlin.max).toBeGreaterThan(0.65);

    const simplex = extremes(fieldFromJson({ fn: "simplexNoise", opts: { frequency: 0.07 } }), ctx);
    expect(simplex.min).toBeGreaterThan(-1);
    expect(simplex.min).toBeLessThan(-0.85);
    expect(simplex.max).toBeLessThan(1);
    expect(simplex.max).toBeGreaterThan(0.85);

    // The point the description is making: simplex swings wider than
    // perlin over the same points, and neither reaches the bound.
    expect(simplex.max - simplex.min).toBeGreaterThan(perlin.max - perlin.min);
  });

  it("says so in the descriptions, with the bound named as a bound", () => {
    const infos = listFieldFnInfos();
    const perlin = infos.find((i) => i.fn === "perlinNoise")?.description ?? "";
    expect(perlin).toContain("BOUND and not an");
    expect(perlin).toContain("0.75");
    const simplex = infos.find((i) => i.fn === "simplexNoise")?.description ?? "";
    expect(simplex).toContain("0.94");
  });
});
