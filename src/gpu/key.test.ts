import { describe, expect, it } from "vitest";
import { compileFieldSpec } from "./index.js";
import type { FieldKernelLayout } from "./index.js";

const LAYOUT: FieldKernelLayout = {
  attributes: {
    P: { type: "f32", tupleSize: 3 },
    density: { type: "f32", tupleSize: 1 },
    unusedA: { type: "i32", tupleSize: 4 },
  },
};

describe("specialization key", () => {
  it("is identical for the same spec and layout", () => {
    const spec = { fn: "mul", args: [{ fn: "attribute", name: "density" }, { fn: "perlinNoise" }] };
    const a = compileFieldSpec(spec, LAYOUT);
    const b = compileFieldSpec(structuredClone(spec), LAYOUT);
    expect(b.key).toBe(a.key);
    expect(b.wgsl).toBe(a.wgsl);
  });

  it("ignores spec JSON key order", () => {
    const a = compileFieldSpec({ fn: "attribute", name: "density", tupleSize: 1 }, LAYOUT);
    const shuffled = JSON.parse('{"tupleSize":1,"name":"density","fn":"attribute"}') as never;
    const b = compileFieldSpec(shuffled, LAYOUT);
    expect(b.key).toBe(a.key);
  });

  it("ignores explicitly spelled-out defaults", () => {
    const a = compileFieldSpec({ fn: "valueNoise" }, LAYOUT);
    const b = compileFieldSpec({ fn: "valueNoise", opts: { seed: 0, frequency: 1, offset: [0, 0, 0] } }, LAYOUT);
    expect(b.key).toBe(a.key);
  });

  it("differs when a used attribute's tuple size differs", () => {
    const spec = { fn: "length", args: [{ fn: "attribute", name: "density" }] };
    const a = compileFieldSpec(spec, LAYOUT);
    const b = compileFieldSpec(spec, {
      attributes: { ...LAYOUT.attributes, density: { type: "f32", tupleSize: 3 } },
    });
    expect(b.key).not.toBe(a.key);
  });

  it("differs when a used attribute's type differs", () => {
    const spec = { fn: "attribute", name: "density" };
    const a = compileFieldSpec(spec, LAYOUT);
    const b = compileFieldSpec(spec, {
      attributes: { ...LAYOUT.attributes, density: { type: "bool", tupleSize: 1 } },
    });
    expect(b.key).not.toBe(a.key);
  });

  it("ignores layout attributes the spec does not read", () => {
    const spec = { fn: "attribute", name: "density" };
    const a = compileFieldSpec(spec, LAYOUT);
    const b = compileFieldSpec(spec, {
      attributes: { density: LAYOUT.attributes.density, other: { type: "u32", tupleSize: 2 } },
    });
    expect(b.key).toBe(a.key);
    expect(b.wgsl).toBe(a.wgsl);
  });

  it("differs between distinct specs", () => {
    const a = compileFieldSpec({ fn: "constant", value: 1 }, LAYOUT);
    const b = compileFieldSpec({ fn: "constant", value: 2 }, LAYOUT);
    expect(b.key).not.toBe(a.key);
  });
});
