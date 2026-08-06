import { describe, expect, it } from "vitest";
import { FieldJsonError } from "../nodes/fieldJson.js";
import { GpuCompileError, compileFieldSpec } from "./index.js";
import type { FieldKernelLayout } from "./index.js";

const LAYOUT: FieldKernelLayout = {
  attributes: {
    P: { type: "f32", tupleSize: 3 },
    density: { type: "f32", tupleSize: 1 },
    uv: { type: "f32", tupleSize: 2 },
    tag: { type: "string", tupleSize: 1 },
    wide: { type: "f32", tupleSize: 6 },
  },
};

function compileError(spec: unknown, layout: FieldKernelLayout = LAYOUT): Error {
  try {
    compileFieldSpec(spec as never, layout);
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected compileFieldSpec to throw");
}

describe("spec validity errors (shared validator)", () => {
  it("unknown fn lists the valid fns", () => {
    const e = compileError({ fn: "nope" });
    expect(e).toBeInstanceOf(FieldJsonError);
    expect(e.message).toContain('unknown field fn "nope"');
    expect(e.message).toContain("valid fns:");
    expect(e.message).toContain("perlinNoise");
  });

  it("static tuple mismatches surface from the CPU broadcast rule", () => {
    const e = compileError({ fn: "add", args: [[1, 2], [1, 2, 3]] });
    expect(e.message).toContain("add: incompatible tuple sizes 2 and 3");
  });

  it("bad fbm base names the valid bases", () => {
    const e = compileError({ fn: "fbm", base: "sineNoise" });
    expect(e).toBeInstanceOf(FieldJsonError);
    expect(e.message).toContain("fbm base must be one of: valueNoise, perlinNoise, simplexNoise, worleyNoise");
  });
});

describe("layout and GPU-constraint errors", () => {
  it("missing attribute names it and lists the layout", () => {
    const e = compileError({ fn: "attribute", name: "missing" });
    expect(e).toBeInstanceOf(GpuCompileError);
    expect(e.message).toContain('attribute "missing" is not in the kernel layout');
    expect(e.message).toContain('"P"');
    expect(e.message).toContain('"density"');
  });

  it("missing attribute against an empty layout says so", () => {
    const e = compileError({ fn: "attribute", name: "x" }, { attributes: {} });
    expect(e.message).toContain("the layout declares no attributes");
  });

  it("string attributes are CPU-only", () => {
    const e = compileError({ fn: "attribute", name: "tag" });
    expect(e).toBeInstanceOf(GpuCompileError);
    expect(e.message).toContain('attribute "tag"');
    expect(e.message).toContain("string attributes");
    expect(e.message).toContain("CPU-only");
  });

  it("attribute tupleSize mismatch names both sizes", () => {
    const e = compileError({ fn: "attribute", name: "P", tupleSize: 2 });
    expect(e).toBeInstanceOf(GpuCompileError);
    expect(e.message).toContain('attribute "P": expected tupleSize 2, got 3');
  });

  it("position requires P in the layout", () => {
    const e = compileError({ fn: "position" }, { attributes: {} });
    expect(e).toBeInstanceOf(GpuCompileError);
    expect(e.message).toContain("position reads attribute \"P\"");
    expect(e.message).toContain("not in the kernel layout");
  });

  it("attribute-driven tuple mismatches name the op and both sizes", () => {
    const e = compileError({
      fn: "add",
      args: [
        { fn: "attribute", name: "uv" },
        { fn: "attribute", name: "P" },
      ],
    });
    expect(e).toBeInstanceOf(GpuCompileError);
    expect(e.message).toContain("add: incompatible tuple sizes 2 and 3");
    expect(e.message).toContain("$");
  });

  it("tuple sizes above 4 are rejected with guidance (constant)", () => {
    const e = compileError({ fn: "constant", value: [1, 2, 3, 4, 5] });
    expect(e).toBeInstanceOf(GpuCompileError);
    expect(e.message).toContain("tupleSize 5");
    expect(e.message).toContain("tuple sizes 1 to 4");
    expect(e.message).toContain("CPU");
  });

  it("tuple sizes above 4 are rejected (vec concatenation)", () => {
    const e = compileError({ fn: "vec", args: [{ fn: "position" }, { fn: "attribute", name: "uv" }] });
    expect(e).toBeInstanceOf(GpuCompileError);
    expect(e.message).toContain("vec result has tupleSize 5");
  });

  it("tuple sizes above 4 are rejected (wide attribute)", () => {
    const e = compileError({ fn: "attribute", name: "wide" });
    expect(e).toBeInstanceOf(GpuCompileError);
    expect(e.message).toContain('attribute "wide" has tupleSize 6');
  });

  it("component out of range mirrors the CPU message", () => {
    const e = compileError({ fn: "component", args: [{ fn: "attribute", name: "uv" }], index: 3 });
    expect(e).toBeInstanceOf(GpuCompileError);
    expect(e.message).toContain("component: index 3 out of range for tupleSize 2");
  });

  it("ramp rejects non-scalar inputs", () => {
    const e = compileError({ fn: "ramp", args: [{ fn: "position" }], stops: [[0, 0], [1, 1]] });
    expect(e).toBeInstanceOf(GpuCompileError);
    expect(e.message).toContain("ramp: input must be scalar, got tupleSize 3");
  });

  it("noise position inputs must be tuple 3", () => {
    const e = compileError({ fn: "perlinNoise", opts: { position: { fn: "attribute", name: "uv" } } });
    expect(e).toBeInstanceOf(GpuCompileError);
    expect(e.message).toContain("$.opts.position");
    expect(e.message).toContain("position field must have tupleSize 3, got 2");
  });

  it("fbm position inputs must be tuple 3", () => {
    const e = compileError({ fn: "fbm", base: "valueNoise", opts: { position: { fn: "attribute", name: "uv" } } });
    expect(e).toBeInstanceOf(GpuCompileError);
    expect(e.message).toContain("fbm: position field must have tupleSize 3, got 2");
  });

  it("values outside f32 range are rejected", () => {
    const e = compileError({ fn: "constant", value: 1e39 });
    expect(e).toBeInstanceOf(GpuCompileError);
    expect(e.message).toContain("not representable as a finite f32");
  });

  it("layout validation rejects unknown types and bad tuple sizes", () => {
    const badType = compileError(
      { fn: "constant", value: 1 },
      { attributes: { x: { type: "f64" as never, tupleSize: 1 } } },
    );
    expect(badType).toBeInstanceOf(GpuCompileError);
    expect(badType.message).toContain('kernel layout attribute "x"');
    expect(badType.message).toContain('valid types: "f32", "i32", "u32", "bool"');
    const badTs = compileError(
      { fn: "constant", value: 1 },
      { attributes: { x: { type: "f32", tupleSize: 0 } } },
    );
    expect(badTs.message).toContain("tupleSize must be a positive integer, got 0");
  });

  it("errors carry the spec path of the offending node", () => {
    const e = compileError({
      fn: "add",
      args: [1, { fn: "mul", args: [{ fn: "attribute", name: "missing" }, 2] }],
    });
    expect(e.message).toContain("$.args[1].args[0]");
  });
});
