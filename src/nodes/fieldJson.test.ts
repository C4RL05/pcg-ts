import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import {
  add,
  atan2,
  component,
  cos,
  evaluateField,
  makeField,
  mul,
  position,
  remap,
  sin,
  type EvalContext,
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

  it("throws an actionable error for fields with no derivable spec", () => {
    // `makeField`'s evaluator is an arbitrary closure: no spec can
    // describe it, and none is invented. This is the permanent
    // spec-less case, and the error must name THAT cause — "authored in
    // code" stopped being the reason when code-authored fields started
    // carrying specs, and a regex matching only "fieldFromJson" could
    // not see the drift.
    const opaque = makeField("opaque", 1, (ctx) => ({
      data: new Float32Array(ctx.geo.attrs[ctx.domain].count),
      tupleSize: 1,
    }));
    expect(() => fieldToJson(opaque)).toThrow(FieldJsonError);
    for (const field of [opaque, mul(opaque, 2)]) {
      expect(() => fieldToJson(field)).toThrow(/carries no JSON spec/);
      // The two real causes, and the fix for each.
      expect(() => fieldToJson(field)).toThrow(/makeField closure can never be named/);
      expect(() => fieldToJson(field)).toThrow(/at most 256 levels deep/);
      expect(() => fieldToJson(field)).toThrow(/Replace the opaque part|flatten a deeper tree/);
      // The old message blamed "authored in code", which is now false:
      // `mul(position(), 2)` is authored in code and serializes fine.
      expect(() => fieldToJson(field)).not.toThrow(/authored in code/);
    }
  });

  it("rejects non-field values", () => {
    expect(() => fieldToJson({ key: "fake", tupleSize: 1 } as never)).toThrow(/not a Field/);
  });
});
