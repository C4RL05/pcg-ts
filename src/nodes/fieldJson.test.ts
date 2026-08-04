import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import { add, evaluateField, mul, position, remap, type EvalContext } from "../fields/index.js";
import { fbm, perlinNoise } from "../noise/index.js";
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
  it("throws an actionable error for code-authored fields", () => {
    const codeAuthored = mul(position(), 2);
    expect(() => fieldToJson(codeAuthored)).toThrow(FieldJsonError);
    expect(() => fieldToJson(codeAuthored)).toThrow(/construct it via fieldFromJson/);
  });

  it("rejects non-field values", () => {
    expect(() => fieldToJson({ key: "fake", tupleSize: 1 } as never)).toThrow(/not a Field/);
  });
});
