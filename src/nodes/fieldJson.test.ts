import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import {
  add,
  atan2,
  attribute,
  component,
  constant,
  cos,
  evaluateField,
  makeField,
  mul,
  position,
  remap,
  sin,
  type EvalContext,
  type Field,
} from "../fields/index.js";
import { fbm, perlinNoise, simplexNoise, worleyNoise } from "../noise/index.js";
import { FieldJsonError, fieldFromJson, fieldToJson, listFieldFns, type FieldSpec } from "./fieldJson.js";

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
    ];
    for (const spec of specs) {
      const field = fieldFromJson(spec);
      const col = evaluateField(field, ctx);
      expect(col.data.length).toBe(8 * col.tupleSize);
    }
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
      "position",
      "index",
      "randomField",
      "add",
      "sub",
      "mul",
      "div",
      "min",
      "max",
      "abs",
      "floor",
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
