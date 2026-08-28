/**
 * `pathShift`: the ordinal neighbour along a path.
 *
 * Every expectation here is hand-computed from a path short enough to read
 * — four or five stations whose `v` spells out which point was read, so 30
 * in the output means "the point carrying 30" with nothing to work out —
 * rather than recorded from a run. The whole claim of the node is that the
 * neighbour it reads is the one the POLYLINE visits next, and a recorded
 * expectation would move with the code and prove nothing.
 *
 * Two fixtures carry most of the weight, because they are the two things a
 * wrong implementation gets subtly right-looking. A CLOSED path's ring must
 * have one entry per point and not one per vertex (the closing vertex is a
 * repeat, not a place), and the walk order must be the POLYLINE'S and not
 * the point array's — `pointsToPath` with `orderAttr` builds a path that
 * visits the points in an order the storage does not have.
 */
import { describe, expect, it } from "vitest";
import {
  Geometry,
  PRIMTYPE_ATTR,
  createPointCloud,
  setPolylineTopology,
} from "../data/index.js";
import { makeGeometryItem, type DataCollection } from "../graph/index.js";
import { pathShift } from "./pathShift.js";
import { pointsToPath } from "./paths.js";
import { firstGeo, runNode, snapshotGeometry } from "./nodes.testsupport.js";

/** The message a node refused with, or a failure if it did not refuse. */
async function rejection(run: Promise<unknown>): Promise<string> {
  const err: unknown = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof Error)) throw new Error("expected the node to throw an Error");
  return err.message;
}

/** One point column as a plain array of its elements' tuples flattened. */
function col(geo: Geometry, name: string): number[] {
  const a = geo.attrs.point.require(name);
  return Array.from(a.data.slice(0, geo.attrs.point.count * a.tupleSize));
}

/** One string point column as an array of its resolved values. */
function strings(geo: Geometry, name: string): string[] {
  const a = geo.attrs.point.require(name);
  const out: string[] = [];
  for (let i = 0; i < geo.attrs.point.count; i++) out.push(a.getString(i));
  return out;
}

/** The point indices each polyline visits, in walk order. */
function walksOf(geo: Geometry): number[][] {
  const out: number[][] = [];
  for (let p = 0; p < geo.primitiveCount; p++) {
    const start = geo.primVertexStart[p];
    const walk: number[] = [];
    for (let v = start; v < start + geo.primVertexCount[p]; v++) walk.push(geo.vertexToPoint[v]);
    out.push(walk);
  }
  return out;
}

/** A cloud of `values.length` points at (i, 0, 0) carrying `v`. */
function cloud(values: readonly number[], defaultValue = 0): Geometry {
  const geo = createPointCloud(values.length);
  const P = geo.attrs.point.require("P");
  const v = geo.attrs.point.add("v", "f32", 1, defaultValue);
  for (let i = 0; i < values.length; i++) {
    P.setTuple(i, [i, 0, 0]);
    v.set(i, values[i]);
  }
  return geo;
}

/**
 * Give a cloud polylines over the given point-index sequences, directly.
 *
 * `pointsToPath` cannot express any of the cases this is used for — a path
 * over PART of a cloud, two paths sharing a point, a closed primitive whose
 * two vertices are the same point — and every one of them is a shape the
 * library's own topology permits and this node has to answer for.
 */
function withPaths(geo: Geometry, prims: readonly (readonly number[])[]): Geometry {
  const vertexToPoint: number[] = [];
  const starts: number[] = [];
  const counts: number[] = [];
  for (const prim of prims) {
    starts.push(vertexToPoint.length);
    for (const p of prim) vertexToPoint.push(p);
    counts.push(prim.length);
  }
  setPolylineTopology(geo, vertexToPoint, starts, counts);
  return geo;
}

/** The cloud with one polyline built over it by the real node. */
async function toPath(geo: Geometry, params: Record<string, unknown> = {}): Promise<Geometry> {
  const outputs = await runNode(pointsToPath, params, { in: [makeGeometryItem(geo)] });
  return firstGeo(outputs.out);
}

async function shift(geo: Geometry, params: Record<string, unknown>): Promise<Geometry> {
  const outputs = await runNode(pathShift, params, { in: [makeGeometryItem(geo)] });
  return firstGeo(outputs.out);
}

/** The same run, but returning the promise so a refusal can be inspected. */
function shifting(
  geo: Geometry,
  params: Record<string, unknown>,
): Promise<Record<string, DataCollection>> {
  return runNode(pathShift, params, { in: [makeGeometryItem(geo)] });
}

/** Read `v`, write `next` — the pair almost every case below uses. */
const V = { attributes: ["v"], outNames: ["next"] };

/** Five stations whose value spells out which point was read. */
const STATIONS = [0, 10, 20, 30, 40];

const openStations = (defaultValue = 0) => toPath(cloud(STATIONS, defaultValue));
const closedStations = (defaultValue = 0) =>
  toPath(cloud(STATIONS, defaultValue), { closed: true });

describe("pathShift: the shift", () => {
  it("reads the next point along the path", async () => {
    const out = await shift(await openStations(), { ...V, offset: 1, outOfRange: "clamp" });
    expect(col(out, "next")).toEqual([10, 20, 30, 40, 40]);
  });

  it("reads the previous point when the offset is negative", async () => {
    const out = await shift(await openStations(), { ...V, offset: -1, outOfRange: "clamp" });
    expect(col(out, "next")).toEqual([0, 0, 10, 20, 30]);
  });

  it("reaches further than one position", async () => {
    const out = await shift(await openStations(), { ...V, offset: 2, outOfRange: "clamp" });
    expect(col(out, "next")).toEqual([20, 30, 40, 40, 40]);
  });

  it("copies at offset 0 rather than refusing it", async () => {
    const out = await shift(await closedStations(), { ...V, offset: 0 });
    expect(col(out, "next")).toEqual(STATIONS);
  });

  it("leaves the attribute it read exactly as it found it", async () => {
    const out = await shift(await openStations(), { ...V, offset: 1 });
    expect(col(out, "v")).toEqual(STATIONS);
  });

  it("keeps the count, the point order, the positions and the topology", async () => {
    const path = await closedStations();
    const out = await shift(path, { ...V, offset: 1 });
    expect(out.attrs.point.count).toBe(5);
    expect(col(out, "P")).toEqual(col(path, "P"));
    expect(walksOf(out)).toEqual(walksOf(path));
  });

  it("shifts several attributes in one pass, each into its own column", async () => {
    const geo = cloud(STATIONS);
    geo.attrs.point.add("w", "f32", 1, 0).data.set([100, 101, 102, 103, 104]);
    const out = await shift(await toPath(geo, { closed: true }), {
      attributes: ["v", "w"],
      outNames: ["nextV", "nextW"],
      offset: 1,
    });
    expect(col(out, "nextV")).toEqual([10, 20, 30, 40, 0]);
    expect(col(out, "nextW")).toEqual([101, 102, 103, 104, 100]);
  });

  it("answers the gap ring, which is why it exists", async () => {
    // Stations by arc position on a lap of length 100. `nextStation - station`
    // is the gap to the next one, and the seam is the author's to correct
    // (+100 at the last station) — this node's job is the neighbour.
    const arcs = [0, 10, 25, 60, 80];
    const geo = cloud(arcs);
    const out = await shift(await toPath(geo, { closed: true }), {
      attributes: ["v"],
      outNames: ["nextArc"],
      offset: 1,
    });
    expect(col(out, "nextArc")).toEqual([10, 25, 60, 80, 0]);
    const gaps = col(out, "nextArc").map((next, i) => {
      const raw = next - arcs[i];
      return raw < 0 ? raw + 100 : raw;
    });
    expect(gaps).toEqual([10, 15, 35, 20, 20]);
    expect(gaps.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("reads P, which is how the vector to the next point is built", async () => {
    const out = await shift(await closedStations(), {
      attributes: ["P"],
      outNames: ["nextP"],
      offset: 1,
    });
    const nextP = out.attrs.point.require("nextP");
    expect(nextP.type).toBe("f32");
    expect(nextP.tupleSize).toBe(3);
    // Points sit at (i, 0, 0), so the last one comes round to the origin.
    expect(col(out, "nextP")).toEqual([1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0, 0, 0, 0]);
    // And P itself is untouched.
    expect(col(out, "P")).toEqual([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0]);
  });
});

/**
 * THE CLOSING VERTEX IS NOT A PHANTOM POINT.
 *
 * `pointsToPath(closed: true)` over 5 points emits 5 POINTS and 6 VERTICES:
 * the trailing vertex revisits point 0. An implementation that walks the
 * vertex list instead of the ring reads that repeat as a sixth place, and
 * the damage lands on the FIRST point — the phantom's own shift overwrites
 * the real one — while the last four look perfectly right.
 */
describe("pathShift: a closed path is a ring of points, not of vertices", () => {
  it("the fixture really does have one more vertex than points", async () => {
    const path = await closedStations();
    expect(path.attrs.point.count).toBe(5);
    expect(walksOf(path)).toEqual([[0, 1, 2, 3, 4, 0]]);
  });

  it("takes the last point to the first at +1, and the first point to the second", async () => {
    const out = await shift(await closedStations(), { ...V, offset: 1 });
    expect(col(out, "next")).toEqual([10, 20, 30, 40, 0]);
  });

  it("takes the first point to the last at -1", async () => {
    const out = await shift(await closedStations(), { ...V, offset: -1 });
    expect(col(out, "next")).toEqual([40, 0, 10, 20, 30]);
  });

  it("reads every point exactly once — the shift is a permutation of the ring", async () => {
    const geo = cloud(STATIONS);
    // rank i = i, so the shifted column IS the list of sources.
    geo.attrs.point.add("rank", "i32", 1, -1).data.set([0, 1, 2, 3, 4]);
    const out = await shift(await toPath(geo, { closed: true }), {
      attributes: ["rank"],
      outNames: ["fromRank"],
      offset: 1,
    });
    expect(col(out, "fromRank")).toEqual([1, 2, 3, 4, 0]);
    expect([...col(out, "fromRank")].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it("has no point that reads itself, at any offset that is not a multiple of the ring", async () => {
    for (const offset of [1, 2, 3, 4, -1, -2, 6, -6]) {
      const out = await shift(await closedStations(), { ...V, offset });
      for (let i = 0; i < 5; i++) expect(col(out, "next")[i]).not.toBe(STATIONS[i]);
    }
  });

  it("misses nothing on a closed ring under wrap, and flags every point a hit", async () => {
    const out = await shift(await closedStations(), { ...V, offset: 1, hitAttr: "__hit" });
    expect(col(out, "__hit")).toEqual([1, 1, 1, 1, 1]);
  });
});

/**
 * THE ORDER IS THE POLYLINE'S, NEVER THE POINT ARRAY'S.
 *
 * `pointsToPath` does not reorder the point array: with `orderAttr` set it
 * builds topology that VISITS the points in the key's order while every
 * point stays exactly where it was stored. So the two orders differ, and an
 * implementation that shifts in storage order gets a plausible answer that
 * is wrong at every point.
 */
describe("pathShift: the order is the polyline's", () => {
  /**
   * Four points stored as 0,1,2,3 with v = 0,10,20,30, ordered by a key
   * that makes the path visit them 2, 1, 3, 0.
   */
  async function crossed(closed: boolean): Promise<Geometry> {
    const geo = cloud([0, 10, 20, 30]);
    geo.attrs.point.add("key", "f32", 1, 0).data.set([3, 1, 0, 2]);
    return await toPath(geo, { orderAttr: "key", closed });
  }

  it("the fixture's walk order and storage order really do differ", async () => {
    const path = await crossed(false);
    expect(walksOf(path)).toEqual([[2, 1, 3, 0]]);
    // The point array itself is untouched — this is the premise of the two
    // tests below, and without it they would prove nothing.
    expect(col(path, "v")).toEqual([0, 10, 20, 30]);
  });

  it("follows the walk on an open path, not the storage order", async () => {
    const out = await shift(await crossed(false), { ...V, offset: 1, outOfRange: "clamp" });
    // walk 2->1->3->0: point 2 reads point 1 (10), point 1 reads point 3
    // (30), point 3 reads point 0 (0), point 0 is last and clamps to itself.
    // Storage order would have given [10, 20, 30, 30].
    expect(col(out, "next")).toEqual([0, 30, 10, 0]);
  });

  it("follows the walk round a closed ring too", async () => {
    const out = await shift(await crossed(true), { ...V, offset: 1 });
    // Same walk, now a ring: point 0 is last and reads point 2 (20).
    expect(col(out, "next")).toEqual([20, 30, 10, 0]);
  });
});

describe("pathShift: out of range", () => {
  it("wraps a closed path by Euclidean modulo in both directions", async () => {
    const forward = await shift(await closedStations(), { ...V, offset: 1, outOfRange: "wrap" });
    expect(col(forward, "next")).toEqual([10, 20, 30, 40, 0]);
    const back = await shift(await closedStations(), { ...V, offset: -1, outOfRange: "wrap" });
    expect(col(back, "next")).toEqual([40, 0, 10, 20, 30]);
  });

  it("wraps an OPEN path too, which is the documented divergence from pathRuns", async () => {
    // pathRuns' `wrap` is about a SEAM and has no effect on an open path.
    // This param is transferByIndex's `outOfRange`, a policy for an ordinal
    // that ran off the end of a list, and the list is there either way.
    const forward = await shift(await openStations(), { ...V, offset: 1, outOfRange: "wrap" });
    expect(col(forward, "next")).toEqual([10, 20, 30, 40, 0]);
    const back = await shift(await openStations(), { ...V, offset: -1, outOfRange: "wrap" });
    expect(col(back, "next")).toEqual([40, 0, 10, 20, 30]);
  });

  it("wraps by default", async () => {
    const out = await shift(await openStations(), { ...V, offset: 1 });
    expect(col(out, "next")).toEqual([10, 20, 30, 40, 0]);
  });

  it("clamps to the path's own ends", async () => {
    const out = await shift(await openStations(), { ...V, offset: -2, outOfRange: "clamp" });
    expect(col(out, "next")).toEqual([0, 0, 0, 10, 20]);
  });

  it("clamps on a CLOSED path too — closure changes the count, never the policy", async () => {
    const out = await shift(await closedStations(), { ...V, offset: 1, outOfRange: "clamp" });
    expect(col(out, "next")).toEqual([10, 20, 30, 40, 40]);
  });

  it("misses off the end, leaving the source attribute's default", async () => {
    const out = await shift(await openStations(7), {
      ...V,
      offset: 1,
      outOfRange: "miss",
      hitAttr: "__hit",
    });
    expect(col(out, "next")).toEqual([10, 20, 30, 40, 7]);
    expect(col(out, "__hit")).toEqual([1, 1, 1, 1, 0]);
  });

  it("misses off the START when the offset is negative", async () => {
    const out = await shift(await openStations(7), {
      ...V,
      offset: -1,
      outOfRange: "miss",
      hitAttr: "__hit",
    });
    expect(col(out, "next")).toEqual([7, 0, 10, 20, 30]);
    expect(col(out, "__hit")).toEqual([0, 1, 1, 1, 1]);
  });

  it("misses on a CLOSED path as well, for the same reason clamp does", async () => {
    const out = await shift(await closedStations(7), {
      ...V,
      offset: 1,
      outOfRange: "miss",
      hitAttr: "__hit",
    });
    expect(col(out, "next")).toEqual([10, 20, 30, 40, 7]);
    expect(col(out, "__hit")).toEqual([1, 1, 1, 1, 0]);
  });

  it("refuses an outOfRange it does not know, naming the three it does", async () => {
    const msg = await rejection(
      shifting(await closedStations(), { ...V, outOfRange: "nearest" }),
    );
    expect(msg).toContain('pathShift: unknown outOfRange "nearest"');
    expect(msg).toContain("wrap, clamp, miss");
  });
});

describe("pathShift: an offset larger than the path", () => {
  it("wraps round in one step however far out it is", async () => {
    const out = await shift(await closedStations(), { ...V, offset: 7, outOfRange: "wrap" });
    // 7 mod 5 is 2.
    expect(col(out, "next")).toEqual([20, 30, 40, 0, 10]);
    const back = await shift(await closedStations(), { ...V, offset: -5003, outOfRange: "wrap" });
    // -5003 mod 5 is -3 truncated, 2 Euclidean.
    expect(col(back, "next")).toEqual([20, 30, 40, 0, 10]);
  });

  it("clamps every point onto one end", async () => {
    const far = await shift(await closedStations(), { ...V, offset: 7, outOfRange: "clamp" });
    expect(col(far, "next")).toEqual([40, 40, 40, 40, 40]);
    const back = await shift(await closedStations(), { ...V, offset: -7, outOfRange: "clamp" });
    expect(col(back, "next")).toEqual([0, 0, 0, 0, 0]);
  });

  it("misses every point", async () => {
    const out = await shift(await closedStations(7), {
      ...V,
      offset: 7,
      outOfRange: "miss",
      hitAttr: "__hit",
    });
    expect(col(out, "next")).toEqual([7, 7, 7, 7, 7]);
    expect(col(out, "__hit")).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("pathShift: a ring of one point", () => {
  /** A closed primitive whose two vertices are the same point. */
  const one = () => withPaths(cloud([42], 7), [[0, 0]]);

  it("reads itself at every offset under wrap", async () => {
    for (const offset of [0, 1, 2, -1, -9]) {
      const out = await shift(one(), { ...V, offset, hitAttr: "__hit" });
      expect(col(out, "next")).toEqual([42]);
      expect(col(out, "__hit")).toEqual([1]);
    }
  });

  it("reads itself under clamp too", async () => {
    const out = await shift(one(), { ...V, offset: 3, outOfRange: "clamp" });
    expect(col(out, "next")).toEqual([42]);
  });

  it("hits only at offset 0 under miss", async () => {
    const zero = await shift(one(), { ...V, offset: 0, outOfRange: "miss", hitAttr: "__hit" });
    expect(col(zero, "next")).toEqual([42]);
    expect(col(zero, "__hit")).toEqual([1]);
    const off = await shift(one(), { ...V, offset: 1, outOfRange: "miss", hitAttr: "__hit" });
    expect(col(off, "next")).toEqual([7]);
    expect(col(off, "__hit")).toEqual([0]);
  });
});

describe("pathShift: a point on no polyline", () => {
  /** Three points, but only the first two are on a path. */
  const stranded = () => withPaths(cloud([0, 10, 20], 7), [[0, 1]]);

  for (const outOfRange of ["wrap", "clamp", "miss"]) {
    it(`keeps the default and flags 0 under "${outOfRange}"`, async () => {
      const out = await shift(stranded(), {
        ...V,
        offset: 1,
        outOfRange,
        hitAttr: "__hit",
      });
      expect(col(out, "next")[2]).toBe(7);
      expect(col(out, "__hit")).toEqual([1, outOfRange === "miss" ? 0 : 1, 0]);
    });
  }

  it("still gets nothing at offset 0, where a point ON a path copies itself", async () => {
    // Offset 0 is not a plain attribute copy: a point with no walk has no
    // position 0 to be at.
    const out = await shift(stranded(), { ...V, offset: 0, hitAttr: "__hit" });
    expect(col(out, "next")).toEqual([0, 10, 7]);
    expect(col(out, "__hit")).toEqual([1, 1, 0]);
  });

  it("does not crash on a cloud whose paths cover almost nothing", async () => {
    const geo = cloud([0, 10, 20, 30, 40, 50], 7);
    const out = await shift(withPaths(geo, [[4, 5]]), { ...V, offset: 1, hitAttr: "__hit" });
    expect(col(out, "next")).toEqual([7, 7, 7, 7, 50, 40]);
    expect(col(out, "__hit")).toEqual([0, 0, 0, 0, 1, 1]);
  });
});

describe("pathShift: several polylines", () => {
  it("never reaches out of one path into another", async () => {
    const geo = cloud([0, 10, 20, 30, 40, 50]);
    const out = await shift(
      withPaths(geo, [
        [0, 1, 2],
        [3, 4, 5],
      ]),
      { ...V, offset: 1, outOfRange: "wrap" },
    );
    expect(col(out, "next")).toEqual([10, 20, 0, 40, 50, 30]);
  });

  it("gives a shared point to the LAST polyline in primitive order", async () => {
    // Point 2 is the last of prim 0 (clamping to itself, 20) and the first
    // of prim 1 (reading point 3, 30). The last one decides.
    const geo = cloud([0, 10, 20, 30]);
    const out = await shift(
      withPaths(geo, [
        [0, 1, 2],
        [2, 3],
      ]),
      { ...V, offset: 1, outOfRange: "clamp" },
    );
    expect(col(out, "next")).toEqual([10, 20, 30, 30]);
  });

  it("lets the last polyline's MISS overwrite an earlier polyline's hit", async () => {
    // The rule is "the last polyline decides", not "the last polyline that
    // found something". Point 2 is answered (10) by prim 0, where it sits at
    // rank 1 of 3, and MISSED by prim 1, where it is last. The miss wins.
    const geo = cloud([0, 10, 20, 30], 7);
    const out = await shift(
      withPaths(geo, [
        [0, 2, 1],
        [3, 2],
      ]),
      { ...V, offset: 1, outOfRange: "miss", hitAttr: "__hit" },
    );
    expect(col(out, "next")).toEqual([20, 7, 7, 20]);
    expect(col(out, "__hit")).toEqual([1, 0, 0, 1]);
  });
});

describe("pathShift: attribute types", () => {
  /** The stations' cloud with one extra column, closed into a ring. */
  async function ring(build: (geo: Geometry) => void): Promise<Geometry> {
    const geo = cloud([0, 0, 0]);
    build(geo);
    return await toPath(geo, { closed: true });
  }

  it("keeps an i32 column an i32 column", async () => {
    const path = await ring((geo) => {
      geo.attrs.point.add("lane", "i32", 1, -1).data.set([1, 2, 3]);
    });
    const out = await shift(path, { attributes: ["lane"], outNames: ["nextLane"], offset: 1 });
    const next = out.attrs.point.require("nextLane");
    expect(next.type).toBe("i32");
    expect(col(out, "nextLane")).toEqual([2, 3, 1]);
  });

  it("keeps a u32 column a u32 column", async () => {
    const path = await ring((geo) => {
      geo.attrs.point.add("id", "u32", 1, 0).data.set([7, 8, 9]);
    });
    const out = await shift(path, { attributes: ["id"], outNames: ["nextId"], offset: -1 });
    expect(out.attrs.point.require("nextId").type).toBe("u32");
    expect(col(out, "nextId")).toEqual([9, 7, 8]);
  });

  it("keeps a bool column a bool column", async () => {
    const path = await ring((geo) => {
      geo.attrs.point.add("flag", "bool", 1, 0).data.set([1, 0, 1]);
    });
    const out = await shift(path, { attributes: ["flag"], outNames: ["nextFlag"], offset: 1 });
    expect(out.attrs.point.require("nextFlag").type).toBe("bool");
    expect(col(out, "nextFlag")).toEqual([0, 1, 1]);
  });

  it("shifts a string attribute intact", async () => {
    const path = await ring((geo) => {
      const asset = geo.attrs.point.add("asset", "string", 1, "none");
      asset.setString(0, "rock");
      asset.setString(1, "tree");
      asset.setString(2, "sign");
    });
    const out = await shift(path, { attributes: ["asset"], outNames: ["nextAsset"], offset: 1 });
    expect(out.attrs.point.require("nextAsset").type).toBe("string");
    expect(strings(out, "nextAsset")).toEqual(["tree", "sign", "rock"]);
  });

  it("gives a missed string the source column's default", async () => {
    const geo = cloud([0, 0, 0]);
    const asset = geo.attrs.point.add("asset", "string", 1, "none");
    asset.setString(0, "rock");
    asset.setString(1, "tree");
    asset.setString(2, "sign");
    const out = await shift(await toPath(geo), {
      attributes: ["asset"],
      outNames: ["nextAsset"],
      offset: 1,
      outOfRange: "miss",
    });
    expect(strings(out, "nextAsset")).toEqual(["tree", "sign", "none"]);
  });

  it("takes every component of a tuple from the SAME neighbour", async () => {
    const path = await ring((geo) => {
      geo.attrs.point
        .add("uvw", "f32", 3, [0, 0, 0])
        .data.set([0, 1, 2, 10, 11, 12, 20, 21, 22]);
    });
    const out = await shift(path, { attributes: ["uvw"], outNames: ["nextUvw"], offset: 1 });
    expect(out.attrs.point.require("nextUvw").tupleSize).toBe(3);
    expect(col(out, "nextUvw")).toEqual([10, 11, 12, 20, 21, 22, 0, 1, 2]);
  });

  it("gives a missed tuple every component of the source's default", async () => {
    const geo = cloud([0, 0, 0]);
    geo.attrs.point.add("uvw", "f32", 3, [7, 8, 9]).data.set([0, 1, 2, 10, 11, 12, 20, 21, 22]);
    const out = await shift(await toPath(geo), {
      attributes: ["uvw"],
      outNames: ["nextUvw"],
      offset: 1,
      outOfRange: "miss",
    });
    expect(col(out, "nextUvw")).toEqual([10, 11, 12, 20, 21, 22, 7, 8, 9]);
  });
});

describe("pathShift: the params", () => {
  it("refuses an empty attributes list, saying what to pass", async () => {
    const msg = await rejection(
      shifting(await closedStations(), { attributes: [], outNames: [] }),
    );
    expect(msg).toContain('pathShift: param "attributes" is empty');
    expect(msg).toContain('attributes ["station"] with outNames ["nextStation"]');
  });

  it("refuses an empty name and a repeated one in attributes", async () => {
    expect(
      await rejection(shifting(await closedStations(), { attributes: [""], outNames: ["a"] })),
    ).toContain('param "attributes" holds an empty name');
    expect(
      await rejection(
        shifting(await closedStations(), { attributes: ["v", "v"], outNames: ["a", "b"] }),
      ),
    ).toContain('param "attributes" names "v" twice');
  });

  it("refuses a length mismatch, naming both lengths", async () => {
    const msg = await rejection(
      shifting(await closedStations(), { attributes: ["v", "P"], outNames: ["next"] }),
    );
    expect(msg).toContain('param "outNames" has 1 name but "attributes" has 2');
    expect(msg).toContain("PARALLEL");
  });

  it("refuses an empty name and a repeated one in outNames", async () => {
    expect(
      await rejection(shifting(await closedStations(), { attributes: ["v"], outNames: [""] })),
    ).toContain('param "outNames" holds an empty name');
    expect(
      await rejection(
        shifting(await closedStations(), { attributes: ["v", "P"], outNames: ["a", "a"] }),
      ),
    ).toContain('param "outNames" names "a" twice');
  });

  it("refuses an outName that names a column being read", async () => {
    const msg = await rejection(
      shifting(await closedStations(), { attributes: ["v"], outNames: ["v"] }),
    );
    expect(msg).toContain('param "outNames" names "v", which "attributes" is also reading');
    expect(msg).toContain("nextV");
  });

  it("refuses an outName of P outright", async () => {
    const msg = await rejection(
      shifting(await closedStations(), { attributes: ["v"], outNames: ["P"] }),
    );
    expect(msg).toContain('param "outNames" names "P", which this node never writes');
    expect(msg).toContain("collapse onto the origin");
  });

  it("refuses an attribute the input does not have, listing the ones it does", async () => {
    const msg = await rejection(
      shifting(await closedStations(), { attributes: ["nope"], outNames: ["next"] }),
    );
    expect(msg).toContain('param "attributes" names point attribute "nope"');
    expect(msg).toContain("v");
  });

  it("refuses a fractional or non-finite offset", async () => {
    expect(
      await rejection(shifting(await closedStations(), { ...V, offset: 1.5 })),
    ).toContain('pathShift: param "offset" is 1.5');
    expect(
      await rejection(shifting(await closedStations(), { ...V, offset: Number.NaN })),
    ).toContain('pathShift: param "offset" is NaN');
    expect(
      await rejection(
        shifting(await closedStations(), { ...V, offset: Number.POSITIVE_INFINITY }),
      ),
    ).toContain('pathShift: param "offset" is Infinity');
  });

  it("overwrites an existing outName column of another shape, as a copy does", async () => {
    // The copy-target rule, not the reporting-slot rule: the shape is the
    // source column's and overwriting is what a copy IS.
    const geo = cloud(STATIONS);
    geo.attrs.point.add("next", "i32", 2, 0);
    const out = await shift(await toPath(geo, { closed: true }), { ...V, offset: 1 });
    const next = out.attrs.point.require("next");
    expect(next.type).toBe("f32");
    expect(next.tupleSize).toBe(1);
    expect(col(out, "next")).toEqual([10, 20, 30, 40, 0]);
  });

  it("resets an existing same-shape outName column, so a miss cannot inherit a value", async () => {
    const geo = cloud(STATIONS, 7);
    geo.attrs.point.add("next", "f32", 1, 0).data.set([1, 2, 3, 4, 5]);
    const out = await shift(await toPath(geo), { ...V, offset: 1, outOfRange: "miss" });
    expect(col(out, "next")).toEqual([10, 20, 30, 40, 7]);
  });
});

describe("pathShift: hitAttr", () => {
  it("flags a hit 1 and a miss 0, as a bool tuple 1", async () => {
    const out = await shift(await openStations(7), {
      ...V,
      offset: 2,
      outOfRange: "miss",
      hitAttr: "__hit",
    });
    const hit = out.attrs.point.require("__hit");
    expect(hit.type).toBe("bool");
    expect(hit.tupleSize).toBe(1);
    expect(col(out, "__hit")).toEqual([1, 1, 1, 0, 0]);
    expect(col(out, "next")).toEqual([20, 30, 40, 7, 7]);
  });

  it("resets a flag it inherited, so it describes THIS shift only", async () => {
    const geo = cloud(STATIONS, 7);
    geo.attrs.point.add("__hit", "bool", 1, 0).data.set([1, 1, 1, 1, 1]);
    const out = await shift(await toPath(geo), {
      ...V,
      offset: 1,
      outOfRange: "miss",
      hitAttr: "__hit",
    });
    expect(col(out, "__hit")).toEqual([1, 1, 1, 1, 0]);
  });

  it("refuses a flag that names a column being read", async () => {
    const msg = await rejection(shifting(await closedStations(), { ...V, hitAttr: "v" }));
    expect(msg).toContain('hitAttr "v" is also named in "attributes"');
  });

  it("refuses a flag that names a column being written", async () => {
    const msg = await rejection(shifting(await closedStations(), { ...V, hitAttr: "next" }));
    expect(msg).toContain('hitAttr "next" is also named in "outNames"');
  });

  it("refuses a flag pointed at a differently shaped column, rather than deleting it", async () => {
    const msg = await rejection(shifting(await closedStations(), { ...V, hitAttr: "P" }));
    expect(msg).toContain('pathShift: hitAttr "P" already exists');
    expect(msg).toContain("DELETE");
    expect(msg).toContain("__hit");
  });

  it("reuses a same-shape flag column rather than refusing it", async () => {
    const geo = cloud(STATIONS);
    geo.attrs.point.add("__hit", "bool", 1, 0);
    const out = await shift(await toPath(geo, { closed: true }), { ...V, hitAttr: "__hit" });
    expect(col(out, "__hit")).toEqual([1, 1, 1, 1, 1]);
  });

  it("writes no flag when the name is empty", async () => {
    const out = await shift(await closedStations(), { ...V, offset: 1 });
    expect(out.attrs.point.names()).not.toContain("__hit");
  });
});

/**
 * NO PATH AT ALL IS THE SAME RULE AS NO PATH OVER THIS POINT.
 *
 * Every other path node refuses a pathless input, because a scan with
 * nothing to scan has no answer. This one does have one: its per-point rule
 * already says a point on no polyline keeps its default and flags a miss,
 * and a geometry with no polyline is exactly the case where EVERY point is
 * that point. Refusing it would answer one question two ways depending on
 * whether the number of stranded points happened to equal the total, which
 * is what the comparison test at the end of this block exists to pin.
 */
describe("pathShift: no path at all", () => {
  for (const outOfRange of ["wrap", "clamp", "miss"]) {
    it(`misses every point of a pathless cloud under "${outOfRange}"`, async () => {
      // The mode cannot matter: a point with no walk is not at a position
      // that could be inside or outside a range.
      const out = await shift(cloud(STATIONS, 7), {
        ...V,
        offset: 1,
        outOfRange,
        hitAttr: "__hit",
      });
      expect(col(out, "next")).toEqual([7, 7, 7, 7, 7]);
      expect(col(out, "__hit")).toEqual([0, 0, 0, 0, 0]);
      // And nothing else moved: the cloud came back whole.
      expect(col(out, "v")).toEqual(STATIONS);
      expect(out.attrs.point.count).toBe(5);
    });
  }

  it("misses at offset 0 too, where a point ON a path would copy itself", async () => {
    const out = await shift(cloud(STATIONS, 7), { ...V, offset: 0, hitAttr: "__hit" });
    expect(col(out, "next")).toEqual([7, 7, 7, 7, 7]);
    expect(col(out, "__hit")).toEqual([0, 0, 0, 0, 0]);
  });

  it("settles the cloud pointsToPath legitimately leaves without a path", async () => {
    // The motivating case: a lap holding too few placements to close.
    // `shortGroups: "skip"` emits no primitive for it, and a shift over the
    // result has to report "nobody has a neighbour" rather than throw.
    const path = await toPath(cloud([0, 10], 7), { closed: true, shortGroups: "skip" });
    expect(path.pointCount).toBe(2);
    expect(path.primitiveCount).toBe(0);
    const out = await shift(path, { ...V, offset: 1, hitAttr: "__hit" });
    expect(col(out, "next")).toEqual([7, 7]);
    expect(col(out, "__hit")).toEqual([0, 0]);
  });

  it("treats primitives that are NOT polylines as no path at all", async () => {
    // The clause most likely to drift out of step with polylineWalks': a
    // geometry whose primitives exist but carry the wrong primtype has to
    // answer exactly the way one with no primitives does — not throw, and
    // not walk them.
    const geo = withPaths(cloud(STATIONS, 7), [[0, 1, 2]]);
    geo.attrs.primitive.require(PRIMTYPE_ATTR).setString(0, "mesh");
    const out = await shift(geo, { ...V, offset: 1, hitAttr: "__hit" });
    expect(col(out, "next")).toEqual([7, 7, 7, 7, 7]);
    expect(col(out, "__hit")).toEqual([0, 0, 0, 0, 0]);
  });

  it("cooks a geometry with no points to an empty output, columns and all", async () => {
    const geo = createPointCloud(0);
    geo.attrs.point.add("v", "f32", 1, 0);
    const out = await shift(geo, { ...V, offset: 1, hitAttr: "__hit" });
    expect(out.attrs.point.count).toBe(0);
    // The columns are still created, so the output's shape never depends on
    // what this cook happened to be handed.
    expect(out.attrs.point.has("next")).toBe(true);
    expect(out.attrs.point.has("__hit")).toBe(true);
  });

  it("gives a stranded point the same answer whether SOME of the cloud is pathed or NONE of it is", async () => {
    // The whole point of the rule: point 2 is on no polyline in both, and
    // must not be able to tell the two situations apart.
    const partial = await shift(withPaths(cloud([0, 10, 20], 7), [[0, 1]]), {
      ...V,
      offset: 1,
      hitAttr: "__hit",
    });
    const none = await shift(cloud([0, 10, 20], 7), { ...V, offset: 1, hitAttr: "__hit" });
    expect([col(partial, "next")[2], col(partial, "__hit")[2]]).toEqual([
      col(none, "next")[2],
      col(none, "__hit")[2],
    ]);
    expect(col(partial, "next")).toEqual([10, 0, 7]);
    expect(col(partial, "__hit")).toEqual([1, 1, 0]);
    expect(col(none, "next")).toEqual([7, 7, 7]);
    expect(col(none, "__hit")).toEqual([0, 0, 0]);
  });

  it("refuses a bad param before it ever looks for a path", async () => {
    // A name clash reported as a miss would send the author to debug the
    // wrong thing entirely. Empty input is answered; malformed is refused.
    const msg = await rejection(shifting(cloud(STATIONS), { attributes: [], outNames: [] }));
    expect(msg).toContain('param "attributes" is empty');
  });

  it("still refuses an attribute it cannot find, path or no path", async () => {
    const msg = await rejection(
      shifting(cloud(STATIONS), { attributes: ["nope"], outNames: ["next"] }),
    );
    expect(msg).toContain('param "attributes" names point attribute "nope"');
  });
});

describe("pathShift: determinism", () => {
  it("gives a byte-identical answer twice", async () => {
    const a = await shift(await closedStations(), { ...V, offset: 1, hitAttr: "__hit" });
    const b = await shift(await closedStations(), { ...V, offset: 1, hitAttr: "__hit" });
    expect(snapshotGeometry(a)).toEqual(snapshotGeometry(b));
  });

  it("does not care what order the points were STORED in, only what order the path visits them", async () => {
    const arcs = [0, 10, 25, 60, 80];
    const permuted = [60, 0, 80, 10, 25];
    const straight = await shift(await toPath(cloud(arcs), { orderAttr: "v", closed: true }), {
      attributes: ["v"],
      outNames: ["nextArc"],
      offset: 1,
    });
    const shuffled = await shift(
      await toPath(cloud(permuted), { orderAttr: "v", closed: true }),
      { attributes: ["v"], outNames: ["nextArc"], offset: 1 },
    );
    /** arc -> the arc of the next station, however the cloud was stored. */
    const ring = (geo: Geometry) =>
      Object.fromEntries(col(geo, "v").map((arc, i) => [arc, col(geo, "nextArc")[i]] as const));
    expect(ring(shuffled)).toEqual(ring(straight));
    expect(ring(straight)).toEqual({ 0: 10, 10: 25, 25: 60, 60: 80, 80: 0 });
  });
});

describe("pathShift: cancellation", () => {
  it("checks for cancellation on both walks", async () => {
    const n = 600;
    const path = await toPath(cloud(new Array<number>(n).fill(1)), { closed: true });
    let checks = 0;
    await pathShift.execute({
      inputs: { in: [makeGeometryItem(path)] },
      params: { ...pathShift.defaultParams, ...V, offset: 1 },
      seed: 1,
      checkCancelled() {
        checks++;
      },
    });
    // CANCEL_STRIDE is 256, so 600 positions check at 0, 256 and 512 —
    // once settling which point each point reads, once copying the values.
    expect(checks).toBe(6);
  });
});
