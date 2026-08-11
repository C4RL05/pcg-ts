import { describe, expect, it } from "vitest";
import { Geometry, createPointCloud } from "../data/index.js";
import { attribute, position, vec, component, constant } from "../fields/index.js";
import { Graph, makeGeometryItem } from "../graph/index.js";
import {
  copyToPoints,
  deserializeGraph,
  fieldFromJson,
  getNodeType,
  jitterPoints,
  mergePoints,
  orientAlongVector,
  pointGrid,
  serializeGraph,
  setBounds,
  transformPoints,
} from "./index.js";
import { rotateVec } from "./util.js";
import {
  firstGeo,
  permutePoints,
  positionsOf,
  runNode,
  shuffledOrder,
  snapshotGeometry,
} from "./nodes.testsupport.js";
import { hashCombine, hashFloat } from "../random/index.js";

function cloudAt(positions: number[][]): ReturnType<typeof createPointCloud> {
  const geo = createPointCloud(positions.length);
  const P = geo.attrs.point.require("P");
  positions.forEach((p, i) => P.setTuple(i, p));
  return geo;
}

/** `cloudAt` plus a genuine per-point `seed` — half of a point's identity. */
function seededCloudAt(positions: number[][]): ReturnType<typeof createPointCloud> {
  const geo = cloudAt(positions);
  const seed = geo.attrs.point.require("seed");
  for (let i = 0; i < positions.length; i++) seed.set(i, hashCombine(0x5eed, i));
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

  it("is permutation-equivariant: the offset travels with the point", async () => {
    // The offset is keyed on the point's IDENTITY (its pre-jitter position
    // bits plus its seed), so reordering the input reorders the output and
    // moves nothing. Against index keying every point lands somewhere else.
    const cloud = seededCloudAt(
      Array.from({ length: 120 }, (_, i) => [
        hashFloat(hashCombine(31, i, 0)) * 8,
        hashFloat(hashCombine(31, i, 1)) * 8,
        hashFloat(hashCombine(31, i, 2)) * 8,
      ]),
    );
    const order = shuffledOrder(120, 6);
    const run = (geo: ReturnType<typeof createPointCloud>) =>
      runNode(jitterPoints, { amount: [0.4, 0.4, 0.4] }, { in: [makeGeometryItem(geo)] }, 2);
    const straight = firstGeo((await run(cloud)).out);
    const shuffled = firstGeo((await run(permutePoints(cloud, order))).out);
    // Jitter actually moved things — an amount of 0 would pass trivially.
    expect(positionsOf(straight)).not.toEqual(positionsOf(cloud));
    expect(snapshotGeometry(shuffled)).toEqual(snapshotGeometry(permutePoints(straight, order)));
  });

  it("re-rolls when only the seed attribute changes", async () => {
    // Position bits are not the whole identity: two clouds at the same
    // places with different per-point seeds jitter differently.
    const positions = Array.from({ length: 32 }, (_, i) => [i * 0.5, 0, 0]);
    const run = (geo: ReturnType<typeof createPointCloud>) =>
      runNode(jitterPoints, { amount: [0.4, 0.4, 0.4] }, { in: [makeGeometryItem(geo)] }, 2);
    const seeded = firstGeo((await run(seededCloudAt(positions))).out);
    const unseeded = firstGeo((await run(cloudAt(positions))).out);
    expect(positionsOf(seeded)).not.toEqual(positionsOf(unseeded));
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

describe("orientAlongVector", () => {
  const AXES: ReadonlyArray<[string, [number, number, number]]> = [
    ["+x", [1, 0, 0]],
    ["-x", [-1, 0, 0]],
    ["+y", [0, 1, 0]],
    ["-y", [0, -1, 0]],
    ["+z", [0, 0, 1]],
    ["-z", [0, 0, -1]],
  ];

  async function orient(
    positions: number[][],
    params: Record<string, unknown>,
  ): Promise<number[][]> {
    const input = cloudAt(positions);
    const geo = firstGeo(
      (await runNode(orientAlongVector, params, { in: [makeGeometryItem(input)] })).out,
    );
    const rot = geo.attrs.point.require("rot");
    return positions.map((_, i) => rot.getTuple(i));
  }

  function rotate(q: number[], v: [number, number, number]): number[] {
    return rotateVec([0, 0, 0], q[0], q[1], q[2], q[3], v[0], v[1], v[2]);
  }

  function normalized(v: number[]): number[] {
    const len = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / len, v[1] / len, v[2] / len];
  }

  describe("field-capable up", () => {
    it("gives a plain up and the same up as a constant field identical bytes", async () => {
      // The whole reason the plain path was left untouched: a field
      // resolves through constant(), which stores f32, where the plain
      // path normalizes in f64 over the raw param. For an f32-exact up
      // the two MUST agree, and this is what says so.
      const positions = [
        [1, 0, 0],
        [0, 0, 1],
        [0.3, 0.5, -0.8],
      ];
      const plain = await orient(positions, { direction: position(), up: [0, 1, 0] });
      const field = await orient(positions, { direction: position(), up: constant([0, 1, 0]) });
      expect(field).toEqual(plain);
    });

    it("rolls per point when up is a field", async () => {
      // Same direction everywhere, two different ups: the roll has to
      // differ, which a constant up could never express.
      const positions = [
        [0, 0, 1],
        [0, 0, 1],
      ];
      const input = cloudAt(positions);
      const upAttr = input.attrs.point.add("myUp", "f32", 3, [0, 1, 0]);
      upAttr.setTuple(0, [0, 1, 0]);
      upAttr.setTuple(1, [1, 0, 0]);
      const geo = firstGeo(
        (
          await runNode(
            orientAlongVector,
            { direction: [0, 0, 1], up: attribute("myUp", 3), axis: "+z" },
            { in: [makeGeometryItem(input)] },
          )
        ).out,
      );
      const rot = geo.attrs.point.require("rot");
      const q0 = rot.getTuple(0);
      const q1 = rot.getTuple(1);
      expect(q0).not.toEqual(q1);
      // Both still put +z on the direction; only the roll moved.
      for (const q of [q0, q1]) {
        const f = rotate(q, [0, 0, 1]);
        expect(f[0]).toBeCloseTo(0, 6);
        expect(f[1]).toBeCloseTo(0, 6);
        expect(f[2]).toBeCloseTo(1, 6);
      }
      // With up = +y the local +Y lands on +y; with up = +x it lands on +x.
      expect(rotate(q0, [0, 1, 0])[1]).toBeCloseTo(1, 6);
      expect(rotate(q1, [0, 1, 0])[0]).toBeCloseTo(1, 6);
    });

    it("a zero-length field up falls back exactly as a zero plain up does", async () => {
      const positions = [[0, 0, 1]];
      const plain = await orient(positions, { direction: position(), up: [0, 0, 0] });
      const field = await orient(positions, { direction: position(), up: constant([0, 0, 0]) });
      expect(field).toEqual(plain);
    });

    it("declares itself ineligible for the device when up is a field", () => {
      // Without this gate the apply kernel would bake the DEFAULT up in
      // and quietly produce different bytes on the device path — the one
      // failure this library refuses to have.
      const resident = getNodeType("orientAlongVector").def.resident;
      expect(resident?.eligible).toBeDefined();
      expect(resident?.eligible?.({ direction: [0, 0, 1], up: [0, 1, 0], axis: "+z" })).toBe(true);
      const verdict = resident?.eligible?.({
        direction: [0, 0, 1],
        up: attribute("curveNormal", 3),
        axis: "+z",
      });
      expect(typeof verdict).toBe("string");
      expect(verdict).toContain("up is a field");
    });
  });

  it("maps every axis option onto the direction with a unit quaternion", async () => {
    const dirs: Array<[number, number, number]> = [
      [1, 2, 3],
      [-1, 0.5, 2],
      [0.25, -4, 0.75],
      [5, 0, 0],
    ];
    for (const [axis, axisVec] of AXES) {
      for (const dir of dirs) {
        const [q] = await orient([[0, 0, 0]], { direction: dir, axis });
        expect(Math.hypot(q[0], q[1], q[2], q[3]), `axis ${axis} unit`).toBeCloseTo(1, 5);
        const rotated = rotate(q, axisVec);
        const expected = normalized(dir);
        for (let k = 0; k < 3; k++) {
          expect(rotated[k], `axis ${axis} dir ${dir.join(",")} comp ${k}`).toBeCloseTo(
            expected[k],
            5,
          );
        }
      }
    }
  });

  it("default +z matches the spline-fence tangent yaw convention", async () => {
    // The spline-fence example writes rot = [0, sin(yaw/2), 0, cos(yaw/2)]
    // with yaw = atan2(tangent.x, tangent.z): the asset's +Z faces the
    // tangent. orientAlongVector with defaults must reproduce it.
    const tangents: Array<[number, number, number]> = [
      [1, 0, 1],
      [-0.6, 0, 0.8],
      [0, 0, 1],
      [3, 0, -1],
    ];
    for (const t of tangents) {
      const [q] = await orient([[0, 0, 0]], { direction: t });
      const yaw = Math.atan2(t[0], t[2]);
      const expected = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
      // q and -q encode the same rotation; align signs before comparing.
      const dotQE = q[0] * expected[0] + q[1] * expected[1] + q[2] * expected[2] + q[3] * expected[3];
      const sign = dotQE < 0 ? -1 : 1;
      for (let k = 0; k < 4; k++) {
        expect(sign * q[k], `tangent ${t.join(",")} comp ${k}`).toBeCloseTo(expected[k], 5);
      }
    }
  });

  it("turns the up-following axis toward the up hint", async () => {
    const dir: [number, number, number] = [1, 0.3, -2];
    const up = [0, 1, 0];
    // Expected up-image: the component of up orthogonal to the direction.
    const f = normalized(dir);
    const dotUpF = up[0] * f[0] + up[1] * f[1] + up[2] * f[2];
    const expectedUp = normalized([
      up[0] - dotUpF * f[0],
      up[1] - dotUpF * f[1],
      up[2] - dotUpF * f[2],
    ]);
    for (const axis of ["+x", "-x", "+z", "-z"] as const) {
      const [q] = await orient([[0, 0, 0]], { direction: dir, axis, up });
      const rotY = rotate(q, [0, 1, 0]);
      for (let k = 0; k < 3; k++) {
        expect(rotY[k], `axis ${axis} comp ${k}`).toBeCloseTo(expectedUp[k], 5);
      }
    }
    // For ±y the up-like slot is taken by the direction; +Z follows up.
    for (const axis of ["+y", "-y"] as const) {
      const [q] = await orient([[0, 0, 0]], { direction: dir, axis, up });
      const rotZ = rotate(q, [0, 0, 1]);
      for (let k = 0; k < 3; k++) {
        expect(rotZ[k], `axis ${axis} comp ${k}`).toBeCloseTo(expectedUp[k], 5);
      }
    }
  });

  it("keeps the prior rot for zero-length directions (identity when newly created)", async () => {
    // Per-point directions via an attribute: point 0 zero, point 1 set.
    const input = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    input.attrs.point.add("dir", "f32", 3, [0, 0, 0]);
    input.attrs.point.require("dir").setTuple(1, [1, 0, 0]);
    const custom = [0.5, 0.5, 0.5, 0.5];
    input.attrs.point.require("rot").setTuple(0, custom);
    input.attrs.point.require("rot").setTuple(1, custom);
    const geo = firstGeo(
      (
        await runNode(orientAlongVector, { direction: attribute("dir", 3) }, {
          in: [makeGeometryItem(input)],
        })
      ).out,
    );
    const rot = geo.attrs.point.require("rot");
    expect(rot.getTuple(0)).toEqual(custom); // untouched
    expect(rot.getTuple(1)).not.toEqual(custom); // oriented
    // A geometry without a rot attribute gets identity for zero dirs.
    const bare = new Geometry();
    bare.attrs.point.add("P", "f32", 3, [0, 0, 0]);
    bare.attrs.point.resize(1);
    const out = firstGeo(
      (await runNode(orientAlongVector, { direction: [0, 0, 0] }, { in: [makeGeometryItem(bare)] }))
        .out,
    );
    expect(out.attrs.point.require("rot").getTuple(0)).toEqual([0, 0, 0, 1]);
  });

  it("falls back deterministically when direction is (anti)parallel to up", async () => {
    // Documented fallback chain: up -> [0, 0, 1] -> [1, 0, 0]. For
    // direction +Y with default up, the frame becomes X=(-1,0,0),
    // Y=(0,0,1), Z=(0,1,0); antiparallel flips the direction image.
    const round = (v: number[]): number[] => v.map((x) => Math.round(x * 1e6) / 1e6);
    const [qPar] = await orient([[0, 0, 0]], { direction: [0, 2, 0] });
    expect(round(rotate(qPar, [0, 0, 1]))).toEqual([0, 1, 0]);
    expect(round(rotate(qPar, [0, 1, 0]))).toEqual([0, 0, 1]);
    expect(round(rotate(qPar, [1, 0, 0]))).toEqual([-1, 0, 0]);
    const [qAnti] = await orient([[0, 0, 0]], { direction: [0, -2, 0] });
    expect(round(rotate(qAnti, [0, 0, 1]))).toEqual([0, -1, 0]);
    expect(round(rotate(qAnti, [0, 1, 0]))).toEqual([0, 0, 1]);
    // Up parallel to Z falls through to the [1, 0, 0] fallback.
    const [qz] = await orient([[0, 0, 0]], { direction: [0, 0, 3], up: [0, 0, 1] });
    expect(rotate(qz, [0, 0, 1])[2]).toBeCloseTo(1, 5);
    // Determinism: identical runs produce identical quaternions.
    const [qAgain] = await orient([[0, 0, 0]], { direction: [0, 2, 0] });
    expect(qAgain).toEqual(qPar);
  });

  it("resolves a field direction per point", async () => {
    const input = cloudAt([
      [0, 0, 0],
      [0, 0, 0],
    ]);
    input.attrs.point.add("tangent", "f32", 3, [0, 0, 1]);
    input.attrs.point.require("tangent").setTuple(0, [1, 0, 0]);
    input.attrs.point.require("tangent").setTuple(1, [0, 0, -1]);
    const geo = firstGeo(
      (
        await runNode(orientAlongVector, { direction: attribute("tangent", 3) }, {
          in: [makeGeometryItem(input)],
        })
      ).out,
    );
    const rot = geo.attrs.point.require("rot");
    expect(rotate(rot.getTuple(0), [0, 0, 1])[0]).toBeCloseTo(1, 5);
    expect(rotate(rot.getTuple(1), [0, 0, 1])[2]).toBeCloseTo(-1, 5);
  });

  it("does not mutate its input (purity)", async () => {
    const input = cloudAt([[1, 2, 3]]);
    const before = snapshotGeometry(input);
    await runNode(orientAlongVector, { direction: [1, 1, 0] }, { in: [makeGeometryItem(input)] });
    expect(snapshotGeometry(input)).toEqual(before);
  });

  it("rejects a bad axis or up actionably", async () => {
    const input = cloudAt([[0, 0, 0]]);
    await expect(
      runNode(orientAlongVector, { axis: "z" }, { in: [makeGeometryItem(input)] }),
    ).rejects.toThrow(/"axis" must be one of \+x, -x, \+y, -y, \+z, -z/);
    await expect(
      runNode(orientAlongVector, { up: [0, 1] }, { in: [makeGeometryItem(input)] }),
    ).rejects.toThrow(/"up" must be an array of 3 finite numbers/);
  });

  it("registers complete metadata documenting the conventions and degenerate cases", () => {
    const info = getNodeType("orientAlongVector").info;
    expect(info.description).toMatch(/right-handed/);
    expect(info.description).toMatch(/Matrix4\.compose/);
    expect(info.params.direction.acceptsField).toBe(true);
    expect(info.params.direction.default).toEqual([0, 0, 1]);
    expect(info.params.direction.description).toMatch(/Zero-length/);
    expect(info.params.up.default).toEqual([0, 1, 0]);
    expect(info.params.up.description).toMatch(/\[0, 0, 1\], then \[1, 0, 0\]/);
    expect(info.params.axis.enum).toEqual(["+x", "-x", "+y", "-y", "+z", "-z"]);
    expect(info.params.axis.default).toBe("+z");
  });

  it("serializes and round-trips through graph JSON with a field direction", () => {
    const g = new Graph(5);
    const n = g.add(
      orientAlongVector,
      {
        direction: fieldFromJson({ fn: "attribute", name: "tangent", tupleSize: 3 }),
        up: [0, 0, 1],
        axis: "+x",
      },
      "orient",
    );
    g.output(n, "out", "result");
    const json = serializeGraph(g);
    const rebuilt = deserializeGraph(JSON.parse(JSON.stringify(json)));
    expect(serializeGraph(rebuilt)).toEqual(json);
    const node = json.nodes.find((entry) => entry.id === "orient");
    expect(node?.params.axis).toBe("+x");
    expect(node?.params.up).toEqual([0, 0, 1]);
    expect(node?.params.direction).toEqual({ fn: "attribute", name: "tangent", tupleSize: 3 });
  });
});
