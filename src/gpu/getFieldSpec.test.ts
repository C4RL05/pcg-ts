import { describe, expect, it } from "vitest";
import { add, constant, mul, position } from "../fields/index.js";
import { perlinNoise } from "../noise/index.js";
import { type FieldSpec, fieldFromJson, getFieldSpec } from "../nodes/fieldJson.js";
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

  it("returns undefined for code-authored fields", () => {
    expect(getFieldSpec(constant(1))).toBeUndefined();
    expect(getFieldSpec(add(position(), 1))).toBeUndefined();
    expect(getFieldSpec(mul(perlinNoise({ seed: 3 }), 2))).toBeUndefined();
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
