import { describe, expect, it } from "vitest";
import { add, constant, makeField, mul, position } from "../fields/index.js";
import { perlinNoise } from "../noise/index.js";
import { type FieldSpec, fieldFromJson, getFieldSpec } from "../fields/fieldJson.js";
import { compileFieldSpec } from "./index.js";

describe("getFieldSpec", () => {
  it("returns the spec for JSON-authored fields", () => {
    const spec: FieldSpec = {
      fn: "mul",
      args: [{ fn: "perlinNoise", opts: { seed: 3 } }, 2],
    };
    const field = fieldFromJson(spec);
    expect(getFieldSpec(field)).toEqual(spec);
  });

  it("returns a derived spec for code-authored fields, and compiles it", () => {
    // Was a pinned negative: code-authored fields used to carry nothing.
    // They now derive a spec from their inputs', and because the derived
    // spec is a grammar spec it compiles to WGSL like any other.
    expect(getFieldSpec(constant(1))).toEqual({ fn: "constant", value: 1 });
    expect(getFieldSpec(add(position(), 1))).toEqual({
      fn: "add",
      args: [{ fn: "position" }, { fn: "constant", value: 1 }],
    });
    const noiseSpec = getFieldSpec(mul(perlinNoise({ seed: 3 }), 2));
    expect(noiseSpec).toEqual({
      fn: "mul",
      args: [
        { fn: "perlinNoise", opts: { seed: 3, frequency: 1, offset: [0, 0, 0] } },
        { fn: "constant", value: 2 },
      ],
    });
    expect(() => compileFieldSpec(noiseSpec!, { attributes: { P: { type: "f32", tupleSize: 3 } } })).not.toThrow();
  });

  it("returns undefined for fields whose evaluator is an opaque closure", () => {
    const opaque = makeField("opaque", 1, (ctx) => ({
      data: new Float32Array(ctx.geo.attrs[ctx.domain].count),
      tupleSize: 1,
    }));
    expect(getFieldSpec(opaque)).toBeUndefined();
    // ...and undefined propagates through every combinator above it.
    expect(getFieldSpec(add(opaque, 1))).toBeUndefined();
    expect(getFieldSpec(mul(perlinNoise({ position: opaque }), 2))).toBeUndefined();
  });

  it("returns a defensive copy", () => {
    const field = fieldFromJson({ fn: "add", args: [1, 2] });
    const first = getFieldSpec(field);
    expect(first).toBeDefined();
    const mutable = first as unknown as { fn: string; args: unknown[] };
    mutable.fn = "mul";
    mutable.args[0] = 99;
    expect(getFieldSpec(field)).toEqual({ fn: "add", args: [1, 2] });
  });

  it("bridges live fields to the WGSL compiler", () => {
    const field = fieldFromJson({ fn: "perlinNoise", opts: { frequency: 0.25 } });
    const spec = getFieldSpec(field);
    expect(spec).toBeDefined();
    const kernel = compileFieldSpec(spec as FieldSpec, {
      attributes: { P: { type: "f32", tupleSize: 3 } },
    });
    expect(kernel.wgsl).toContain("pcg_perlin_noise");
    // The spec half of the specialization key is the field's own key.
    expect(kernel.key).toContain(field.key);
  });
});
