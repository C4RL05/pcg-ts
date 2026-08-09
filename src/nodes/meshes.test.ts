/**
 * meshPrimitive — the library's only serializable source of mesh
 * geometry. The tests below check the three things downstream nodes
 * actually depend on: triangle topology they can read, a normal
 * direction they can trust, and uvs that cover the surface.
 */
import { describe, expect, it } from "vitest";
import { PRIMTYPE_ATTR, type Geometry } from "../data/index.js";
import { makeGeometryItem } from "../graph/index.js";
import {
  meshPrimitive,
  surfaceSample,
  transferAttribute,
  type MeshPrimitiveParams,
} from "./index.js";
import { firstGeo, runNode, snapshotGeometry } from "./testSupport.js";

async function mesh(params: Partial<MeshPrimitiveParams> = {}): Promise<Geometry> {
  return firstGeo((await runNode(meshPrimitive, params)).out);
}

/** Unit normal of triangle `t`, from the winding. */
function triangleNormal(geo: Geometry, t: number): number[] {
  const P = geo.attrs.point.require("P");
  const v = geo.primVertexStart[t];
  const [a, b, c] = [0, 1, 2].map((k) => P.getTuple(geo.vertexToPoint[v + k]));
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const len = Math.hypot(n[0], n[1], n[2]);
  // `+ 0` canonicalizes -0, which the sign of a zero component is free to
  // be and which deep equality distinguishes.
  return n.map((c2) => c2 / len + 0);
}

/** Sum of triangle areas. */
function surfaceArea(geo: Geometry): number {
  const P = geo.attrs.point.require("P");
  let total = 0;
  for (let t = 0; t < geo.primitiveCount; t++) {
    const v = geo.primVertexStart[t];
    const [a, b, c] = [0, 1, 2].map((k) => P.getTuple(geo.vertexToPoint[v + k]));
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    total +=
      Math.hypot(
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ) / 2;
  }
  return total;
}

describe("meshPrimitive plane", () => {
  it("is one quad of two triangles by default, sized and centered as asked", async () => {
    const geo = await mesh({ size: [4, 0, 6] });
    expect(geo.pointCount).toBe(4);
    expect(geo.primitiveCount).toBe(2);
    expect(geo.vertexCount).toBe(6);
    const P = geo.attrs.point.require("P");
    expect([0, 1, 2, 3].map((i) => P.getTuple(i))).toEqual([
      [-2, 0, -3],
      [2, 0, -3],
      [-2, 0, 3],
      [2, 0, 3],
    ]);
    expect(geo.attrs.primitive.require(PRIMTYPE_ATTR).getString(0)).toBe("poly");
  });

  it("subdivides per world axis, u fastest", async () => {
    const geo = await mesh({ size: [2, 0, 2], subdivisions: [2, 1, 3] });
    // 3 columns along x, 4 rows along z.
    expect(geo.pointCount).toBe(3 * 4);
    expect(geo.primitiveCount).toBe(2 * 3 * 2);
    const P = geo.attrs.point.require("P");
    expect(P.getTuple(0)).toEqual([-1, 0, -1]);
    expect(P.getTuple(1)).toEqual([0, 0, -1]);
    expect(P.getTuple(2)).toEqual([1, 0, -1]);
    // Row 1 is one third of the way along z.
    expect(P.getTuple(3)[2]).toBeCloseTo(-1 + 2 / 3, 6);
    // Area is preserved by subdivision.
    expect(surfaceArea(geo)).toBeCloseTo(4, 5);
  });

  it("faces the positive third axis in every orientation, and flip reverses it", async () => {
    for (const [orientation, normal] of [
      ["xz", [0, 1, 0]],
      ["xy", [0, 0, 1]],
      ["yz", [1, 0, 0]],
    ] as const) {
      const geo = await mesh({ orientation, subdivisions: [2, 2, 2] });
      for (let t = 0; t < geo.primitiveCount; t++) {
        expect(triangleNormal(geo, t), `${orientation} tri ${t}`).toEqual(normal);
      }
      const flipped = await mesh({ orientation, subdivisions: [2, 2, 2], flip: true });
      for (let t = 0; t < flipped.primitiveCount; t++) {
        expect(triangleNormal(flipped, t), `${orientation} flipped tri ${t}`).toEqual(
          normal.map((c) => -c || 0),
        );
      }
    }
  });

  it("writes uvs covering 0..1 in both directions", async () => {
    const geo = await mesh({ subdivisions: [2, 1, 2] });
    const uv = geo.attrs.point.require("uv");
    expect(uv.type).toBe("f32");
    expect(uv.tupleSize).toBe(2);
    expect(uv.getTuple(0)).toEqual([0, 0]);
    expect(uv.getTuple(geo.pointCount - 1)).toEqual([1, 1]);
    expect(uv.getTuple(1)).toEqual([0.5, 0]);
  });

  it("the plane's normal-axis size component is ignored", async () => {
    const a = await mesh({ size: [4, 0, 6] });
    const b = await mesh({ size: [4, 99, 6] });
    expect(snapshotGeometry(b)).toEqual(snapshotGeometry(a));
  });
});

describe("meshPrimitive box", () => {
  it("closes six faces with unshared points and outward normals", async () => {
    const geo = await mesh({ shape: "box", size: [2, 2, 2] });
    expect(geo.pointCount).toBe(6 * 4);
    expect(geo.primitiveCount).toBe(6 * 2);
    expect(surfaceArea(geo)).toBeCloseTo(24, 5);
    // Every face normal points away from the center.
    const P = geo.attrs.point.require("P");
    for (let t = 0; t < geo.primitiveCount; t++) {
      const n = triangleNormal(geo, t);
      const v = geo.primVertexStart[t];
      const a = P.getTuple(geo.vertexToPoint[v]);
      expect(n[0] * a[0] + n[1] * a[1] + n[2] * a[2], `tri ${t} faces outward`).toBeGreaterThan(0);
    }
  });

  it("flip turns it inward", async () => {
    const geo = await mesh({ shape: "box", size: [2, 2, 2], flip: true });
    const P = geo.attrs.point.require("P");
    for (let t = 0; t < geo.primitiveCount; t++) {
      const n = triangleNormal(geo, t);
      const a = P.getTuple(geo.vertexToPoint[geo.primVertexStart[t]]);
      expect(n[0] * a[0] + n[1] * a[1] + n[2] * a[2], `tri ${t} faces inward`).toBeLessThan(0);
    }
  });

  it("subdivides every face by the two axes that span it", async () => {
    const geo = await mesh({ shape: "box", size: [2, 2, 2], subdivisions: [2, 3, 4] });
    // +-x faces span (y, z): 3*4 quads; +-y span (z, x): 4*2; +-z span (x, y): 2*3.
    expect(geo.primitiveCount).toBe(2 * 2 * (3 * 4 + 4 * 2 + 2 * 3));
    expect(surfaceArea(geo)).toBeCloseTo(24, 5);
    expect(geo.pointCount).toBe(2 * (4 * 5 + 5 * 3 + 3 * 4));
  });

  it("centers where asked", async () => {
    const geo = await mesh({ shape: "box", size: [2, 2, 2], center: [10, 20, 30] });
    const P = geo.attrs.point.require("P");
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < geo.pointCount; i++) {
      minX = Math.min(minX, P.get(i, 0));
      maxX = Math.max(maxX, P.get(i, 0));
    }
    expect([minX, maxX]).toEqual([9, 11]);
  });
});

describe("meshPrimitive contracts", () => {
  it("is deterministic and seed-independent", async () => {
    const params: Partial<MeshPrimitiveParams> = {
      shape: "box",
      size: [3, 1, 2],
      subdivisions: [2, 2, 2],
    };
    const a = firstGeo((await runNode(meshPrimitive, params, {}, 1)).out);
    const b = firstGeo((await runNode(meshPrimitive, params, {}, 1)).out);
    const c = firstGeo((await runNode(meshPrimitive, params, {}, 999999)).out);
    expect(snapshotGeometry(b)).toEqual(snapshotGeometry(a));
    expect(snapshotGeometry(c)).toEqual(snapshotGeometry(a));
  });

  it("rejects fractional subdivision counts, naming the axis and the fix", async () => {
    await expect(runNode(meshPrimitive, { subdivisions: [1, 1, 2.5] })).rejects.toThrow(
      /subdivisions\.z is 2\.5.*whole numbers >= 1.*use 3/s,
    );
  });

  it("a zero extent still builds, with zero-area triangles", async () => {
    const geo = await mesh({ orientation: "xy", size: [0, 4, 0] });
    expect(geo.primitiveCount).toBe(2);
    expect(surfaceArea(geo)).toBe(0);
  });

  it("feeds surfaceSample, the reason it exists", async () => {
    const surface = await mesh({ size: [10, 0, 10], subdivisions: [4, 1, 4] });
    const sampled = firstGeo(
      (await runNode(surfaceSample, { count: 200 }, { in: [makeGeometryItem(surface)] })).out,
    );
    expect(sampled.pointCount).toBe(200);
    const P = sampled.attrs.point.require("P");
    for (let i = 0; i < sampled.pointCount; i++) {
      expect(P.get(i, 1)).toBe(0);
      expect(Math.abs(P.get(i, 0))).toBeLessThanOrEqual(5);
      expect(Math.abs(P.get(i, 2))).toBeLessThanOrEqual(5);
    }
    // The flat normal is the plane's own.
    expect(sampled.attrs.point.require("normal").getTuple(0).map((c) => c + 0)).toEqual([0, 1, 0]);
  });

  it("feeds transferAttribute's raycast mapping — the drop-to-surface path", async () => {
    const surface = await mesh({ size: [10, 0, 10], center: [0, -3, 0] });
    const points = firstGeo(
      (await runNode(meshPrimitive, { size: [4, 0, 4], subdivisions: [3, 1, 3] })).out,
    );
    const dropped = firstGeo(
      (
        await runNode(
          transferAttribute,
          { name: "P", mapping: "raycast", direction: [0, -1, 0] },
          { in: [makeGeometryItem(points)], source: [makeGeometryItem(surface)] },
        )
      ).out,
    );
    const P = dropped.attrs.point.require("P");
    for (let i = 0; i < dropped.pointCount; i++) {
      expect(P.get(i, 1), `point ${i} landed on the surface`).toBeCloseTo(-3, 5);
    }
  });
});
