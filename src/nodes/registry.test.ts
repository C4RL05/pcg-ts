import { describe, expect, it } from "vitest";
import { getNodeType, hasNodeType, listNodeTypes, standardNode } from "./index.js";

const STANDARD_TYPES = [
  "pointGrid",
  "pointLine",
  "pointScatterInBounds",
  "surfaceSample",
  "splineSample",
  "volumeSample",
  "transformPoints",
  "jitterPoints",
  "copyToPoints",
  "mergePoints",
  "setBounds",
  "filterByDensity",
  "filterByBounds",
  "filterByAttribute",
  "selfPrune",
  "projectToPlane",
  "setAttribute",
  "promoteAttribute",
  "transferAttribute",
  "partitionByAttribute",
  "valueConstant",
];

describe("standardNode validation", () => {
  it("rejects an empty node description", () => {
    expect(() =>
      standardNode<{ x: number }>({
        type: "__test_noDesc",
        description: "  ",
        inputs: [],
        outputs: [],
        params: { x: { type: "f32", default: 0, description: "x" } },
        execute: () => ({}),
      }),
    ).toThrow(/non-empty description/);
  });

  it("rejects a param without a description", () => {
    expect(() =>
      standardNode<{ x: number }>({
        type: "__test_noParamDesc",
        description: "test",
        inputs: [],
        outputs: [],
        params: { x: { type: "f32", default: 0, description: "" } },
        execute: () => ({}),
      }),
    ).toThrow(/param "x".*description/);
  });

  it("rejects defaults that do not match the schema type", () => {
    expect(() =>
      standardNode<{ x: number }>({
        type: "__test_badDefault",
        description: "test",
        inputs: [],
        outputs: [],
        params: {
          x: { type: "f32", default: "nope" as unknown as number, description: "x" },
        },
        execute: () => ({}),
      }),
    ).toThrow(/param "x".*finite number/);
    expect(() =>
      standardNode<{ v: number[] }>({
        type: "__test_badVec",
        description: "test",
        inputs: [],
        outputs: [],
        params: { v: { type: "vec3", default: [1, 2], description: "v" } },
        execute: () => ({}),
      }),
    ).toThrow(/param "v".*3 finite numbers/);
    expect(() =>
      standardNode<{ n: number }>({
        type: "__test_badInt",
        description: "test",
        inputs: [],
        outputs: [],
        params: { n: { type: "i32", default: 1.5, description: "n" } },
        execute: () => ({}),
      }),
    ).toThrow(/param "n".*integer/);
  });

  it("rejects an enum default outside the enum list", () => {
    expect(() =>
      standardNode<{ m: string }>({
        type: "__test_badEnum",
        description: "test",
        inputs: [],
        outputs: [],
        params: {
          m: { type: "enum", enum: ["a", "b"], default: "c", description: "m" },
        },
        execute: () => ({}),
      }),
    ).toThrow(/one of: a, b/);
  });

  it("rejects defaults outside min/max", () => {
    expect(() =>
      standardNode<{ x: number }>({
        type: "__test_belowMin",
        description: "test",
        inputs: [],
        outputs: [],
        params: { x: { type: "f32", default: -1, min: 0, description: "x" } },
        execute: () => ({}),
      }),
    ).toThrow(/below min 0/);
  });

  it("throws on duplicate type names", () => {
    standardNode<{ x: number }>({
      type: "__test_dup",
      description: "test",
      inputs: [],
      outputs: [],
      params: { x: { type: "f32", default: 0, description: "x" } },
      execute: () => ({}),
    });
    expect(() =>
      standardNode<{ x: number }>({
        type: "__test_dup",
        description: "test again",
        inputs: [],
        outputs: [],
        params: { x: { type: "f32", default: 0, description: "x" } },
        execute: () => ({}),
      }),
    ).toThrow(/already registered/);
  });

  it("builds defaultParams from the schemas", () => {
    const def = getNodeType("pointGrid").def;
    expect(def.defaultParams).toEqual({
      countX: 10,
      countY: 1,
      countZ: 10,
      spacing: [1, 1, 1],
      origin: [0, 0, 0],
    });
  });
});

describe("registry metadata", () => {
  it("registers every standard node type", () => {
    for (const type of STANDARD_TYPES) {
      expect(hasNodeType(type), `missing ${type}`).toBe(true);
    }
  });

  it("every listed type has a non-empty description and complete param schemas", () => {
    // Skip the __test_* fixtures this file registers.
    const types = listNodeTypes().filter((t) => !t.type.startsWith("__test_"));
    expect(types.length).toBeGreaterThanOrEqual(STANDARD_TYPES.length);
    for (const info of types) {
      expect(info.description.trim().length, `${info.type} description`).toBeGreaterThan(10);
      const def = getNodeType(info.type).def;
      const paramKeys = Object.keys(info.params).sort();
      expect(paramKeys).toEqual(Object.keys(def.defaultParams as object).sort());
      for (const [name, schema] of Object.entries(info.params)) {
        expect(schema.description.trim().length, `${info.type}.${name} description`).toBeGreaterThan(5);
        if (schema.type === "enum") {
          expect(schema.enum && schema.enum.length, `${info.type}.${name} enum`).toBeTruthy();
        }
      }
    }
  });

  it("listNodeTypes is JSON-serializable and detached from the registry", () => {
    const types = listNodeTypes();
    const roundTripped: unknown = JSON.parse(JSON.stringify(types));
    expect(roundTripped).toEqual(types);
    // Mutating the copy must not affect a fresh listing.
    (types[0] as { description: string }).description = "clobbered";
    expect(listNodeTypes()[0].description).not.toBe("clobbered");
  });

  it("getNodeType names valid types on error", () => {
    expect(() => getNodeType("noSuchNode")).toThrow(/unknown node type "noSuchNode"/);
    expect(() => getNodeType("noSuchNode")).toThrow(/pointGrid/);
  });
});
