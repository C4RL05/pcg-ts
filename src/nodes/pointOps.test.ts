import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import { position, vec, component, constant } from "../fields/index.js";
import { makeGeometryItem } from "../graph/index.js";
import {
  copyToPoints,
  getNodeType,
  jitterPoints,
  mergePoints,
  pointGrid,
  setBounds,
  transformPoints,
} from "./index.js";
import { firstGeo, positionsOf, runNode, snapshotGeometry } from "./testSupport.js";

function cloudAt(positions: number[][]): ReturnType<typeof createPointCloud> {
  const geo = createPointCloud(positions.length);
  const P = geo.attrs.point.require("P");
  positions.forEach((p, i) => P.setTuple(i, p));
  return geo;
}

describe("transformPoints", () => {
  it("translates, rotates (XYZ degrees), and scales positions", async () => {
    const input = cloudAt([[1, 0, 0]]);
    const translated = firstGeo(
      (
        await runNode(transformPoints, { translate: [1, 2, 3] }, { in: [makeGeometryItem(input)] })
      ).out,
    );
    expect(positionsOf(translated)).toEqual([[2, 2, 3]]);

    const rotated = firstGeo(
      (
        await runNode(transformPoints, { rotateEuler: [0, 90, 0] }, { in: [makeGeometryItem(input)] })
      ).out,
    );
    const [x, y, z] = positionsOf(rotated)[0];
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(-1, 5);

    const scaled = firstGeo(
      (await runNode(transformPoints, { scale: [2, 1, 1] }, { in: [makeGeometryItem(input)] })).out,
    );
    expect(positionsOf(scaled)).toEqual([[2, 0, 0]]);
  });

  it("composes with existing rot and scale attributes", async () => {
    const input = cloudAt([[1, 1, 0]]);
    const geo = firstGeo(
      (
        await runNode(
          transformPoints,
          { rotateEuler: [0, 0, 90], scale: [2, 1, 1] },
          { in: [makeGeometryItem(input)] },
        )
      ).out,
    );
    // P: scale -> [2,1,0], rotate Rz90 -> [-1,2,0].
    const [x, y, z] = positionsOf(geo)[0];
    expect(x).toBeCloseTo(-1, 5);
    expect(y).toBeCloseTo(2, 5);
    expect(z).toBeCloseTo(0, 5);
    // scale attr multiplied componentwise; rot attr becomes Rz(90).
    expect(geo.attrs.point.require("scale").getTuple(0)).toEqual([2, 1, 1]);
    const rot = geo.attrs.point.require("rot").getTuple(0);
    expect(rot[0]).toBeCloseTo(0, 5);
    expect(rot[1]).toBeCloseTo(0, 5);
    expect(rot[2]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(rot[3]).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it("accepts field params resolved per point", async () => {
    const input = cloudAt([
      [0, 1, 0],
      [0, 2, 0],
    ]);
    // translate = (y, 0, 0): each point moves in x by its own height.
    const translate = vec(component(position(), 1), constant(0), constant(0));
    const geo = firstGeo(
      (await runNode(transformPoints, { translate }, { in: [makeGeometryItem(input)] })).out,
    );
    expect(positionsOf(geo)).toEqual([
      [1, 1, 0],
      [2, 2, 0],
    ]);
  });

  it("documents rotateEuler as extrinsic XYZ (intrinsic ZYX / three.js 'ZYX')", () => {
    // The math builds R = Rz * Ry * Rx — extrinsic XYZ. The metadata must
    // say so precisely; the three.js interop phase depends on it.
    const info = getNodeType("transformPoints").info;
    expect(info.params.rotateEuler.description).toMatch(/extrinsic/);
    expect(info.params.rotateEuler.description).toMatch(/ZYX/);
    expect(info.description).toMatch(/extrinsic XYZ/);
  });

  it("does not mutate its input (purity)", async () => {
    const input = cloudAt([[1, 0, 0]]);
    const before = snapshotGeometry(input);
    await runNode(transformPoints, { translate: [5, 5, 5] }, { in: [makeGeometryItem(input)] });
    expect(snapshotGeometry(input)).toEqual(before);
  });
});

describe("jitterPoints", () => {
  it("moves each point at most amount per axis, deterministically", async () => {
    const grid = firstGeo((await runNode(pointGrid, { countX: 5, countY: 1, countZ: 5 })).out);
    const run = (seedParam: number) =>
      runNode(jitterPoints, { amount: [0.4, 0, 0.4], seed: seedParam }, { in: [makeGeometryItem(grid)] }, 2);
    const a = firstGeo((await run(0)).out);
    const b = firstGeo((await run(0)).out);
    const c = firstGeo((await run(1)).out);
    expect(snapshotGeometry(a)).toEqual(snapshotGeometry(b));
    expect(snapshotGeometry(a)).not.toEqual(snapshotGeometry(c));
    const base = positionsOf(grid);
    const moved = positionsOf(a);
    for (let i = 0; i < base.length; i++) {
      expect(Math.abs(moved[i][0] - base[i][0])).toBeLessThanOrEqual(0.4);
      expect(moved[i][1]).toBe(base[i][1]);
      expect(Math.abs(moved[i][2] - base[i][2])).toBeLessThanOrEqual(0.4);
    }
  });
});

describe("copyToPoints", () => {
  it("copies source onto each target, composing transforms", async () => {
    const source = cloudAt([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const target = cloudAt([
      [10, 0, 0],
      [0, 10, 0],
    ]);
    target.attrs.point.require("scale").setTuple(0, [2, 2, 2]);
    target.attrs.point.require("rot").setTuple(1, [0, 0, Math.SQRT1_2, Math.SQRT1_2]); // Rz(90)
    const geo = firstGeo(
      (
        await runNode(copyToPoints, {}, {
          source: [makeGeometryItem(source)],
          target: [makeGeometryItem(target)],
        })
      ).out,
    );
    expect(geo.pointCount).toBe(4); // n_src * n_tgt
    const p = positionsOf(geo);
    expect(p[0]).toEqual([12, 0, 0]); // t0 + 2 * (1,0,0)
    expect(p[1]).toEqual([10, 2, 0]); // t0 + 2 * (0,1,0)
    expect(p[2][0]).toBeCloseTo(0, 4); // t1 + Rz90 * (1,0,0) = (0,11,0)
    expect(p[2][1]).toBeCloseTo(11, 4);
    expect(p[3][0]).toBeCloseTo(-1, 4); // t1 + Rz90 * (0,1,0) = (-1,10,0)
    expect(p[3][1]).toBeCloseTo(10, 4);
    // Copied scale composes componentwise.
    expect(geo.attrs.point.require("scale").getTuple(0)).toEqual([2, 2, 2]);
    // Copied rot on the rotated target is Rz(90) (source rot identity).
    const rot = geo.attrs.point.require("rot").getTuple(2);
    expect(rot[2]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(rot[3]).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it("carries source attributes and hashes target seeds into copies", async () => {
    const source = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    source.attrs.point.add("kind", "string", 1, "").setString(0, "oak");
    source.attrs.point.require("kind").setString(1, "fir");
    source.attrs.point.require("seed").set(0, 100);
    source.attrs.point.require("seed").set(1, 200);
    const target = cloudAt([
      [0, 0, 0],
      [5, 0, 0],
    ]);
    target.attrs.point.require("seed").set(0, 1);
    target.attrs.point.require("seed").set(1, 2);
    const geo = firstGeo(
      (
        await runNode(copyToPoints, {}, {
          source: [makeGeometryItem(source)],
          target: [makeGeometryItem(target)],
        })
      ).out,
    );
    const kind = geo.attrs.point.require("kind");
    expect([0, 1, 2, 3].map((i) => kind.getString(i))).toEqual(["oak", "fir", "oak", "fir"]);
    const seeds = geo.attrs.point.require("seed");
    const values = [0, 1, 2, 3].map((i) => seeds.get(i));
    expect(new Set(values).size).toBe(4); // all distinct: hash(srcSeed, tgtSeed)
  });
});

describe("mergePoints", () => {
  it("concatenates inputs and unions attributes with defaults", async () => {
    const a = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    const fooA = a.attrs.point.add("foo", "f32", 1, 7);
    fooA.set(0, 1);
    fooA.set(1, 2);
    const b = cloudAt([
      [2, 0, 0],
      [3, 0, 0],
      [4, 0, 0],
    ]);
    const geo = firstGeo(
      (
        await runNode(mergePoints, {}, {
          in: [makeGeometryItem(a, ["treeA"]), makeGeometryItem(b, ["treeB"])],
        })
      ).out,
    );
    expect(geo.pointCount).toBe(5);
    expect(positionsOf(geo).map((p) => p[0])).toEqual([0, 1, 2, 3, 4]);
    // b lacks foo: its range fills with foo's default (7).
    const foo = geo.attrs.point.require("foo");
    expect([0, 1, 2, 3, 4].map((i) => foo.get(i))).toEqual([1, 2, 7, 7, 7]);
  });

  it("rejects conflicting attribute shapes, naming the attribute", async () => {
    const a = cloudAt([[0, 0, 0]]);
    a.attrs.point.add("bar", "f32", 1, 0);
    const b = cloudAt([[1, 0, 0]]);
    b.attrs.point.add("bar", "i32", 1, 0);
    await expect(
      runNode(mergePoints, {}, { in: [makeGeometryItem(a), makeGeometryItem(b)] }),
    ).rejects.toThrow(/attribute "bar" has conflicting shapes/);
  });

  it("merges zero inputs into an empty cloud", async () => {
    const geo = firstGeo((await runNode(mergePoints, {}, {})).out);
    expect(geo.pointCount).toBe(0);
  });
});

describe("setBounds", () => {
  it("stamps boundsMin/boundsMax on every point", async () => {
    const input = cloudAt([
      [0, 0, 0],
      [1, 1, 1],
    ]);
    const geo = firstGeo(
      (
        await runNode(setBounds, { boundsMin: [-1, -2, -3], boundsMax: [4, 5, 6] }, {
          in: [makeGeometryItem(input)],
        })
      ).out,
    );
    for (let i = 0; i < 2; i++) {
      expect(geo.attrs.point.require("boundsMin").getTuple(i)).toEqual([-1, -2, -3]);
      expect(geo.attrs.point.require("boundsMax").getTuple(i)).toEqual([4, 5, 6]);
    }
  });
});
