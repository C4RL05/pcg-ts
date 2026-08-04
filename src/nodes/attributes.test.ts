import { describe, expect, it } from "vitest";
import { createPointCloud, createTriangleMesh } from "../data/index.js";
import { makeGeometryItem, type GeometryItem } from "../graph/index.js";
import {
  fieldFromJson,
  partitionByAttribute,
  promoteAttribute,
  setAttribute,
  transferAttribute,
} from "./index.js";
import { firstGeo, runNode } from "./testSupport.js";

function cloudAt(positions: number[][]): ReturnType<typeof createPointCloud> {
  const geo = createPointCloud(positions.length);
  const P = geo.attrs.point.require("P");
  positions.forEach((p, i) => P.setTuple(i, p));
  return geo;
}

describe("setAttribute", () => {
  it("creates a scalar attribute from a field on the point domain", async () => {
    const cloud = cloudAt([
      [0, 3, 0],
      [0, 7, 0],
    ]);
    const height = fieldFromJson({ fn: "component", args: [{ fn: "position" }], index: 1 });
    const geo = firstGeo(
      (
        await runNode(setAttribute, { name: "height", value: height }, { in: [makeGeometryItem(cloud)] })
      ).out,
    );
    const attr = geo.attrs.point.require("height");
    expect(attr.type).toBe("f32");
    expect([attr.get(0), attr.get(1)]).toEqual([3, 7]);
  });

  it("converts to i32 (truncation) and bool (nonzero -> 1)", async () => {
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    const item = makeGeometryItem(cloud);
    const truncated = firstGeo(
      (await runNode(setAttribute, { name: "n", type: "i32", value: 2.7 }, { in: [item] })).out,
    );
    expect(truncated.attrs.point.require("n").get(1)).toBe(2);
    const flags = firstGeo(
      (
        await runNode(
          setAttribute,
          { name: "flag", type: "bool", value: fieldFromJson({ fn: "index" }) },
          { in: [item] },
        )
      ).out,
    );
    const flag = flags.attrs.point.require("flag");
    expect([flag.get(0), flag.get(1), flag.get(2)]).toEqual([0, 1, 1]);
  });

  it("writes tuples and other domains (detail)", async () => {
    const cloud = cloudAt([[4, 5, 6]]);
    const copied = firstGeo(
      (
        await runNode(
          setAttribute,
          { name: "P2", tupleSize: 3, value: fieldFromJson({ fn: "position" }) },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    expect(copied.attrs.point.require("P2").getTuple(0)).toEqual([4, 5, 6]);
    const detail = firstGeo(
      (
        await runNode(
          setAttribute,
          { name: "globalScale", domain: "detail", value: 2.5 },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    expect(detail.attrs.detail.require("globalScale").get(0)).toBeCloseTo(2.5, 6);
  });

  it("self-copy via attribute(name) preserves values (aliasing regression)", async () => {
    // value = attribute("density") returns a zero-copy view of the very
    // storage replace() resets; without the aliasing snapshot this reads
    // back defaults instead of the original values.
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    const density = cloud.attrs.point.require("density");
    density.set(0, 0.25);
    density.set(1, 0.5);
    density.set(2, 0.75);
    const geo = firstGeo(
      (
        await runNode(
          setAttribute,
          { name: "density", value: fieldFromJson({ fn: "attribute", name: "density" }) },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    const out = geo.attrs.point.require("density");
    expect([out.get(0), out.get(1), out.get(2)]).toEqual([0.25, 0.5, 0.75]);
  });

  it("writing P from position() preserves positions (aliasing regression)", async () => {
    const cloud = cloudAt([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    const geo = firstGeo(
      (
        await runNode(
          setAttribute,
          { name: "P", tupleSize: 3, value: fieldFromJson({ fn: "position" }) },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    const P = geo.attrs.point.require("P");
    expect([P.getTuple(0), P.getTuple(1)]).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("rejects tuple mismatches actionably", async () => {
    const cloud = cloudAt([[0, 0, 0]]);
    await expect(
      runNode(
        setAttribute,
        { name: "x", tupleSize: 2, value: fieldFromJson({ fn: "position" }) },
        { in: [makeGeometryItem(cloud)] },
      ),
    ).rejects.toThrow(/tuple size 3.*neither 1.*tupleSize 2/);
  });
});

describe("promoteAttribute", () => {
  it("averages point P onto primitives (centroids)", async () => {
    const mesh = createTriangleMesh(
      [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
      [0, 1, 2, 0, 2, 3],
    );
    const geo = firstGeo(
      (
        await runNode(
          promoteAttribute,
          { name: "P", from: "point", to: "primitive", mode: "average" },
          { in: [makeGeometryItem(mesh)] },
        )
      ).out,
    );
    const attr = geo.attrs.primitive.require("P");
    const c0 = attr.getTuple(0);
    expect(c0[0]).toBeCloseTo(2 / 3, 5);
    expect(c0[1]).toBeCloseTo(1 / 3, 5);
    const c1 = attr.getTuple(1);
    expect(c1[0]).toBeCloseTo(1 / 3, 5);
    expect(c1[1]).toBeCloseTo(2 / 3, 5);
  });

  it("propagates promote errors (missing attribute)", async () => {
    const mesh = createTriangleMesh([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
    await expect(
      runNode(promoteAttribute, { name: "ghost" }, { in: [makeGeometryItem(mesh)] }),
    ).rejects.toThrow(/"ghost" not found/);
  });
});

describe("transferAttribute", () => {
  it("copies the nearest source point's value", async () => {
    const dst = cloudAt([
      [0, 0, 0],
      [10, 0, 0],
    ]);
    const src = cloudAt([
      [1, 0, 0],
      [9, 0, 0],
    ]);
    src.attrs.point.require("density").set(0, 5);
    src.attrs.point.require("density").set(1, 7);
    const geo = firstGeo(
      (
        await runNode(transferAttribute, { name: "density" }, {
          in: [makeGeometryItem(dst)],
          source: [makeGeometryItem(src)],
        })
      ).out,
    );
    const density = geo.attrs.point.require("density");
    expect([density.get(0), density.get(1)]).toEqual([5, 7]);
    // Input dst is untouched (purity).
    expect(dst.attrs.point.require("density").get(0)).toBe(1);
  });
});

describe("partitionByAttribute", () => {
  it("splits by i32 value in first-occurrence order with tags", async () => {
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [4, 0, 0],
    ]);
    const grp = cloud.attrs.point.add("grp", "i32", 1, 0);
    [2, 1, 2, 3, 1].forEach((v, i) => grp.set(i, v));
    const out = (
      await runNode(partitionByAttribute, { name: "grp" }, { in: [makeGeometryItem(cloud)] })
    ).out as GeometryItem[];
    expect(out).toHaveLength(3);
    expect(out.map((item) => item.geo.pointCount)).toEqual([2, 2, 1]);
    expect(out.map((item) => [...item.tags][0])).toEqual(["grp=2", "grp=1", "grp=3"]);
    // Points routed to the right groups, attributes carried.
    expect(out[0].geo.attrs.point.require("P").get(0, 0)).toBe(0);
    expect(out[0].geo.attrs.point.require("P").get(1, 0)).toBe(2);
    expect(out[2].geo.attrs.point.require("grp").get(0)).toBe(3);
  });

  it("splits by string value", async () => {
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    const species = cloud.attrs.point.add("species", "string", 1, "");
    ["fir", "oak", "fir"].forEach((v, i) => species.setString(i, v));
    const out = (
      await runNode(partitionByAttribute, { name: "species" }, { in: [makeGeometryItem(cloud)] })
    ).out as GeometryItem[];
    expect(out.map((item) => [...item.tags][0])).toEqual(["species=fir", "species=oak"]);
    expect(out[0].geo.pointCount).toBe(2);
  });

  it("rejects float attributes actionably", async () => {
    const cloud = cloudAt([[0, 0, 0]]);
    await expect(
      runNode(partitionByAttribute, { name: "density" }, { in: [makeGeometryItem(cloud)] }),
    ).rejects.toThrow(/must be i32, u32, or string/);
  });
});
