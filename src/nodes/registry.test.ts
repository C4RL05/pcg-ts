import { describe, expect, it } from "vitest";
import type { DataItem } from "../graph/index.js";
// Side-effect imports: register the standard types living outside
// src/nodes (spawnInstances, dataInput) so the category sweep sees the
// whole standard library.
import "../runtime/index.js";
import "../spawn/index.js";
import { getNodeType, hasNodeType, listNodeTypes, standardNode } from "./index.js";

const STANDARD_TYPES = [
  "pointGrid",
  "pointLine",
  "pointScatterInBounds",
  "meshPrimitive",
  "sweepProfile",
  "extrudePolygon",
  "surfaceSample",
  "splineSample",
  "volumeSample",
  "transformPoints",
  "jitterPoints",
  "copyToPoints",
  "mergePoints",
  "mergePrimitives",
  "setBounds",
  "filterByDensity",
  "filterByBounds",
  "filterByAttribute",
  "selfPrune",
  "projectToPlane",
  "filterByExpression",
  "filterPrimitivesByAttribute",
  "setAttribute",
  "promoteAttribute",
  "transferAttribute",
  "partitionByAttribute",
  "attributeReduce",
  "attributeRemap",
  "removeAttribute",
  "pointNeighborhood",
  "sampleNearestPoint",
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

  it("rejects a param name containing a dot, which a panel key could not survive", () => {
    // A panel addresses a param as "<nodeId>.<paramKey>", and a literal
    // inside its field spec as "<nodeId>.<paramKey>.<fieldParamName>", both
    // read from the right. Every registered name is dot-free today; this is
    // what keeps it a rule rather than an observation.
    expect(() =>
      standardNode<{ "a.b": number }>({
        type: "__test_dottedParam",
        description: "test",
        inputs: [],
        outputs: [],
        params: { "a.b": { type: "f32", default: 0, description: "x" } },
        execute: () => ({}),
      }),
    ).toThrow(/param "a\.b" contains a "\."/);
  });

  it("every registered param name is dot-free", () => {
    const dotted = listNodeTypes().flatMap((info) =>
      Object.keys(info.params)
        .filter((name) => name.includes("."))
        .map((name) => `${info.type}.${name}`),
    );
    expect(dotted).toEqual([]);
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

  it("validates item-list schemas: empty default, no bounds, no fields", () => {
    expect(() =>
      standardNode<{ items: readonly DataItem[] }>({
        type: "__test_itemsBadDefault",
        description: "test",
        inputs: [],
        outputs: [],
        params: { items: { type: "items", default: [1], description: "items" } },
        execute: () => ({}),
      }),
    ).toThrow(/param "items".*empty array/);
    expect(() =>
      standardNode<{ items: readonly DataItem[] }>({
        type: "__test_itemsBounds",
        description: "test",
        inputs: [],
        outputs: [],
        params: { items: { type: "items", default: [], min: 0, description: "items" } },
        execute: () => ({}),
      }),
    ).toThrow(/param "items".*min\/max/);
    expect(() =>
      standardNode<{ items: readonly DataItem[] }>({
        type: "__test_itemsField",
        description: "test",
        inputs: [],
        outputs: [],
        params: {
          items: { type: "items", default: [], acceptsField: true, description: "items" },
        },
        execute: () => ({}),
      }),
    ).toThrow(/param "items".*cannot accept fields/);
    const def = standardNode<{ items: readonly DataItem[] }>({
      type: "__test_itemsOk",
      description: "test",
      inputs: [],
      outputs: [],
      params: { items: { type: "items", default: [], description: "items to emit" } },
      execute: () => ({}),
    });
    expect(def.defaultParams).toEqual({ items: [] });
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

describe("stringList schemas", () => {
  it("validates string-list schemas: string-array default, no bounds, no fields", () => {
    expect(() =>
      standardNode<{ list: readonly string[] }>({
        type: "__test_slBadDefault",
        description: "test",
        inputs: [],
        outputs: [],
        params: {
          list: { type: "stringList", default: "a" as unknown as string[], description: "list" },
        },
        execute: () => ({}),
      }),
    ).toThrow(/param "list".*array of strings/);
    expect(() =>
      standardNode<{ list: readonly string[] }>({
        type: "__test_slBadEntry",
        description: "test",
        inputs: [],
        outputs: [],
        params: {
          list: { type: "stringList", default: [1] as unknown as string[], description: "list" },
        },
        execute: () => ({}),
      }),
    ).toThrow(/param "list".*array of strings/);
    expect(() =>
      standardNode<{ list: readonly string[] }>({
        type: "__test_slBounds",
        description: "test",
        inputs: [],
        outputs: [],
        params: { list: { type: "stringList", default: [], min: 0, description: "list" } },
        execute: () => ({}),
      }),
    ).toThrow(/param "list".*min\/max/);
    expect(() =>
      standardNode<{ list: readonly string[] }>({
        type: "__test_slField",
        description: "test",
        inputs: [],
        outputs: [],
        params: {
          list: { type: "stringList", default: [], acceptsField: true, description: "list" },
        },
        execute: () => ({}),
      }),
    ).toThrow(/param "list".*cannot accept fields/);
  });

  it("derives defaultParams as a detached copy of the default list", () => {
    const source = ["a", "b"];
    const def = standardNode<{ list: readonly string[] }>({
      type: "__test_slOk",
      description: "test",
      inputs: [],
      outputs: [],
      params: { list: { type: "stringList", default: source, description: "list of names" } },
      execute: () => ({}),
    });
    expect(def.defaultParams).toEqual({ list: ["a", "b"] });
    source.push("clobbered");
    expect(def.defaultParams).toEqual({ list: ["a", "b"] });
    // Registry metadata carries the schema, JSON-safe.
    const info = getNodeType("__test_slOk").info;
    expect(info.params.list.type).toBe("stringList");
    expect(info.params.list.default).toEqual(["a", "b"]);
  });
});

describe("category metadata", () => {
  it("rejects an empty or non-string category", () => {
    expect(() =>
      standardNode<{ x: number }>({
        type: "__test_catEmpty",
        description: "test",
        category: "  ",
        inputs: [],
        outputs: [],
        params: { x: { type: "f32", default: 0, description: "x" } },
        execute: () => ({}),
      }),
    ).toThrow(/category, when present, must be a non-empty string/);
    expect(() =>
      standardNode<{ x: number }>({
        type: "__test_catNonString",
        description: "test",
        category: 5 as unknown as string,
        inputs: [],
        outputs: [],
        params: { x: { type: "f32", default: 0, description: "x" } },
        execute: () => ({}),
      }),
    ).toThrow(/category, when present, must be a non-empty string/);
  });

  it("an absent category stays valid and absent from the metadata", () => {
    standardNode<{ x: number }>({
      type: "__test_noCat",
      description: "an uncategorized third-party node",
      inputs: [],
      outputs: [],
      params: { x: { type: "f32", default: 0, description: "x" } },
      execute: () => ({}),
    });
    expect(getNodeType("__test_noCat").info.category).toBeUndefined();
    const listed = listNodeTypes().find((t) => t.type === "__test_noCat");
    expect(listed).toBeDefined();
    expect(listed && "category" in listed).toBe(false);
  });

  it("surfaces a declared category through getNodeType and listNodeTypes", () => {
    standardNode<{ x: number }>({
      type: "__test_cat",
      description: "a categorized node",
      category: "test things",
      inputs: [],
      outputs: [],
      params: { x: { type: "f32", default: 0, description: "x" } },
      execute: () => ({}),
    });
    expect(getNodeType("__test_cat").info.category).toBe("test things");
    expect(listNodeTypes().find((t) => t.type === "__test_cat")?.category).toBe("test things");
  });

  it("categorizes the entire standard library", () => {
    const expected: Record<string, string> = {
      pointGrid: "source",
      pointLine: "source",
      pointScatterInBounds: "source",
      pointScatterInWorld: "source",
      meshPrimitive: "source",
      surfaceSample: "sampler",
      splineSample: "sampler",
      volumeSample: "sampler",
      pathResample: "sampler",
      pathSegments: "sampler",
      arcTile: "sampler",
      transformPoints: "point op",
      jitterPoints: "point op",
      copyToPoints: "point op",
      mergePoints: "point op",
      mergePrimitives: "point op",
      orientAlongVector: "point op",
      setBounds: "point op",
      pointsToPath: "point op",
      pathPointAt: "point op",
      connectPoints: "point op",
      filterByDensity: "filter",
      filterByBounds: "filter",
      filterByAttribute: "filter",
      selfPrune: "filter",
      occlusionCull: "filter",
      projectToPlane: "filter",
      filterByExpression: "filter",
      filterPrimitivesByBounds: "filter",
      filterPrimitivesByAttribute: "filter",
      setAttribute: "attribute",
      promoteAttribute: "attribute",
      transferAttribute: "attribute",
      writeCurveFrame: "attribute",
      partitionByAttribute: "attribute",
      attributeReduce: "attribute",
      pathRuns: "attribute",
      pathScan: "attribute",
      pathCoverage: "attribute",
      runFit: "attribute",
      attributeRemap: "attribute",
      removeAttribute: "attribute",
      pointNeighborhood: "attribute",
      sampleNearestPoint: "attribute",
      writeTangents: "attribute",
      sweepProfile: "surface",
      extrudePolygon: "surface",
      valueConstant: "value",
      spawnInstances: "spawn",
      dataInput: "io",
      subgraph: "composite",
      forEach: "composite",
      repeatUntil: "composite",
    };
    for (const [type, category] of Object.entries(expected)) {
      expect(getNodeType(type).info.category, type).toBe(category);
    }
    // Nothing in the standard library is left uncategorized.
    for (const info of listNodeTypes()) {
      if (info.type.startsWith("__test_")) continue;
      expect(info.category, `${info.type} category`).toBeDefined();
      expect(expected[info.type], `${info.type} category is part of the scheme`).toBe(
        info.category,
      );
    }
  });
});
