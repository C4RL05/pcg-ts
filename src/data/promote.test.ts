import { describe, expect, it } from "vitest";
import type { Geometry } from "./geometry.js";
import { createTriangleMesh } from "./geometry.js";
import { promote } from "./promote.js";

/**
 * Test mesh: unit quad split into two triangles sharing the edge (p1, p2).
 *
 *   vertexToPoint = [0,1,2, 2,1,3]
 *   prim 0 -> vertices 0,1,2 -> points 0,1,2
 *   prim 1 -> vertices 3,4,5 -> points 2,1,3
 */
function quad(): Geometry {
  return createTriangleMesh([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], [0, 1, 2, 2, 1, 3]);
}

/** Quad with point attr val = [10, 20, 30, 40]. */
function quadWithPointVal(): Geometry {
  const geo = quad();
  const val = geo.attrs.point.add("val", "f32");
  val.data.set([10, 20, 30, 40]);
  return geo;
}

/** Quad with vertex attr w = [1, 2, 3, 4, 5, 6]. */
function quadWithVertexW(): Geometry {
  const geo = quad();
  const w = geo.attrs.vertex.add("w", "f32", 1, 99);
  w.data.set([1, 2, 3, 4, 5, 6]);
  return geo;
}

function values(geo: Geometry, domain: "point" | "vertex" | "primitive" | "detail", name: string) {
  const attr = geo.attrs[domain].require(name);
  return Array.from(attr.data.subarray(0, geo.attrs[domain].count * attr.tupleSize));
}

describe("promote point -> vertex", () => {
  it("copies each vertex's point value (all modes agree)", () => {
    for (const mode of ["first", "average", "sum", "min", "max"] as const) {
      const geo = quadWithPointVal();
      promote(geo, "val", "point", "vertex", mode);
      expect(values(geo, "vertex", "val"), mode).toEqual([10, 20, 30, 30, 20, 40]);
    }
  });
});

describe("promote vertex -> point", () => {
  // point0 <- v0 [1]; point1 <- v1,v4 [2,5]; point2 <- v2,v3 [3,4]; point3 <- v5 [6]
  const expected = {
    first: [1, 2, 3, 6],
    sum: [1, 7, 7, 6],
    average: [1, 3.5, 3.5, 6],
    min: [1, 2, 3, 6],
    max: [1, 5, 4, 6],
  } as const;

  for (const [mode, want] of Object.entries(expected)) {
    it(`computes ${mode}`, () => {
      const geo = quadWithVertexW();
      promote(geo, "w", "vertex", "point", mode as keyof typeof expected);
      expect(values(geo, "point", "w")).toEqual([...want]);
    });
  }

  it("leaves points with no vertices at the source default", () => {
    // Fifth point never referenced by a triangle.
    const geo = createTriangleMesh(
      [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 9, 9, 9],
      [0, 1, 2, 2, 1, 3],
    );
    const w = geo.attrs.vertex.add("w", "f32", 1, 99);
    w.data.set([1, 2, 3, 4, 5, 6]);
    promote(geo, "w", "vertex", "point", "sum");
    expect(values(geo, "point", "w")).toEqual([1, 7, 7, 6, 99]);
  });

  it("truncates integer averages via typed-array conversion", () => {
    const geo = quad();
    const w = geo.attrs.vertex.add("w", "u32");
    w.data.set([1, 2, 3, 4, 5, 6]);
    promote(geo, "w", "vertex", "point", "average");
    // point1 average = (2+5)/2 = 3.5 -> 3; point2 = (3+4)/2 = 3.5 -> 3
    expect(values(geo, "point", "w")).toEqual([1, 3, 3, 6]);
  });
});

describe("promote vertex <-> primitive", () => {
  it("gathers vertex -> primitive per mode", () => {
    const expected = {
      first: [1, 4],
      sum: [6, 15],
      average: [2, 5],
      min: [1, 4],
      max: [3, 6],
    } as const;
    for (const [mode, want] of Object.entries(expected)) {
      const geo = quadWithVertexW();
      promote(geo, "w", "vertex", "primitive", mode as keyof typeof expected);
      expect(values(geo, "primitive", "w"), mode).toEqual([...want]);
    }
  });

  it("broadcasts primitive -> vertex", () => {
    const geo = quad();
    const pv = geo.attrs.primitive.add("pv", "f32");
    pv.data.set([100, 200]);
    promote(geo, "pv", "primitive", "vertex", "first");
    expect(values(geo, "vertex", "pv")).toEqual([100, 100, 100, 200, 200, 200]);
  });
});

describe("promote point <-> primitive (via vertices)", () => {
  it("gathers point -> primitive per mode", () => {
    // prim0 <- points 0,1,2 [10,20,30]; prim1 <- points 2,1,3 [30,20,40]
    const expected = {
      first: [10, 30],
      sum: [60, 90],
      average: [20, 30],
      min: [10, 20],
      max: [30, 40],
    } as const;
    for (const [mode, want] of Object.entries(expected)) {
      const geo = quadWithPointVal();
      promote(geo, "val", "point", "primitive", mode as keyof typeof expected);
      expect(values(geo, "primitive", "val"), mode).toEqual([...want]);
    }
  });

  it("gathers primitive -> point per mode (one contribution per vertex reference)", () => {
    // point0 <- prim0; point1 <- prim0,prim1; point2 <- prim0,prim1; point3 <- prim1
    const expected = {
      first: [100, 100, 100, 200],
      sum: [100, 300, 300, 200],
      average: [100, 150, 150, 200],
      min: [100, 100, 100, 200],
      max: [100, 200, 200, 200],
    } as const;
    for (const [mode, want] of Object.entries(expected)) {
      const geo = quad();
      const pv = geo.attrs.primitive.add("pv", "f32");
      pv.data.set([100, 200]);
      promote(geo, "pv", "primitive", "point", mode as keyof typeof expected);
      expect(values(geo, "point", "pv"), mode).toEqual([...want]);
    }
  });
});

describe("promote detail", () => {
  it("reduces any -> detail per mode", () => {
    const expected = {
      first: [10],
      sum: [100],
      average: [25],
      min: [10],
      max: [40],
    } as const;
    for (const [mode, want] of Object.entries(expected)) {
      const geo = quadWithPointVal();
      promote(geo, "val", "point", "detail", mode as keyof typeof expected);
      expect(values(geo, "detail", "val"), mode).toEqual([...want]);
    }
  });

  it("broadcasts detail -> any", () => {
    const geo = quad();
    const d = geo.attrs.detail.add("d", "f32");
    d.data[0] = 7;
    promote(geo, "d", "detail", "point", "first");
    expect(values(geo, "point", "d")).toEqual([7, 7, 7, 7]);
    promote(geo, "d", "detail", "vertex", "average");
    expect(values(geo, "vertex", "d")).toEqual([7, 7, 7, 7, 7, 7]);
    promote(geo, "d", "detail", "primitive", "sum");
    expect(values(geo, "primitive", "d")).toEqual([7, 7]);
  });
});

describe("promote tuples and strings", () => {
  it("promotes tuple attributes componentwise", () => {
    const geo = quad();
    const uv = geo.attrs.point.add("uv", "f32", 2);
    uv.data.set([0, 0, 1, 0, 0, 1, 1, 1]);
    promote(geo, "uv", "point", "primitive", "average");
    const got = values(geo, "primitive", "uv");
    // prim0 = mean of (0,0),(1,0),(0,1); prim1 = mean of (0,1),(1,0),(1,1)
    const want = [1 / 3, 1 / 3, 2 / 3, 2 / 3];
    got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 6));
  });

  it("promotes string attributes with first", () => {
    const geo = quad();
    const name = geo.attrs.point.add("name", "string");
    ["a", "b", "c", "d"].forEach((s, i) => name.setString(i, s));
    promote(geo, "name", "point", "vertex", "first");
    const vName = geo.attrs.vertex.require("name");
    expect([0, 1, 2, 3, 4, 5].map((v) => vName.getString(v))).toEqual([
      "a",
      "b",
      "c",
      "c",
      "b",
      "d",
    ]);
    promote(geo, "name", "point", "primitive", "first");
    const pName = geo.attrs.primitive.require("name");
    expect([pName.getString(0), pName.getString(1)]).toEqual(["a", "c"]);
  });

  it("rejects aggregate modes for string attributes", () => {
    const geo = quad();
    geo.attrs.point.add("name", "string");
    expect(() => promote(geo, "name", "point", "vertex", "average")).toThrow(/only "first"/);
  });
});

describe("promote bookkeeping", () => {
  it("overwrites an existing target attribute, even of a different type", () => {
    const geo = quadWithPointVal();
    const stale = geo.attrs.primitive.add("val", "u32", 2, 5);
    expect(stale.tupleSize).toBe(2);
    const promoted = promote(geo, "val", "point", "primitive", "sum");
    expect(geo.attrs.primitive.require("val")).toBe(promoted);
    expect(promoted.type).toBe("f32");
    expect(promoted.tupleSize).toBe(1);
    expect(values(geo, "primitive", "val")).toEqual([60, 90]);
    // Promoting again with a different mode overwrites again.
    promote(geo, "val", "point", "primitive", "max");
    expect(values(geo, "primitive", "val")).toEqual([30, 40]);
  });

  it("returns the source attribute unchanged for same-domain promotes", () => {
    const geo = quadWithPointVal();
    const src = geo.attrs.point.require("val");
    expect(promote(geo, "val", "point", "point", "sum")).toBe(src);
    expect(values(geo, "point", "val")).toEqual([10, 20, 30, 40]);
  });

  it("throws for missing source attributes", () => {
    const geo = quad();
    expect(() => promote(geo, "nope", "point", "vertex", "first")).toThrow(/not found/);
  });
});
