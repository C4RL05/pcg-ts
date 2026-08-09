import { describe, expect, it } from "vitest";
import { createPointCloud, setPolylineTopology, type Geometry } from "../data/index.js";
import { pointIdentities } from "../data/identity.js";
import { attribute, constant, position, randomField } from "../fields/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import {
  filterByAttribute,
  filterByBounds,
  filterByDensity,
  filterPrimitivesByBounds,
  type FilterPrimitivesByBoundsParams,
  pointGrid,
  projectToPlane,
  selfPrune,
} from "./index.js";
import {
  firstGeo,
  permutePoints,
  pointRecords,
  positionsOf,
  runNode,
  shuffledOrder,
  snapshotGeometry,
} from "./testSupport.js";

function cloudAt(positions: number[][]): ReturnType<typeof createPointCloud> {
  const geo = createPointCloud(positions.length);
  const P = geo.attrs.point.require("P");
  positions.forEach((p, i) => P.setTuple(i, p));
  return geo;
}

/**
 * `cloudAt` plus a genuine per-point `seed`, which is half of a point's
 * identity: a cloud straight out of createPointCloud has every seed at 0
 * and rests its identity on position alone.
 */
function seededCloudAt(positions: number[][]): ReturnType<typeof createPointCloud> {
  const geo = cloudAt(positions);
  const seed = geo.attrs.point.require("seed");
  for (let i = 0; i < positions.length; i++) seed.set(i, hashCombine(0x5eed, i));
  return geo;
}

/** A deterministic scatter that owes nothing to the library's own sources. */
function scatter(count: number, seed: number, extent = 8): number[][] {
  return Array.from({ length: count }, (_, i) => [
    hashFloat(hashCombine(seed, i, 0)) * extent,
    hashFloat(hashCombine(seed, i, 1)) * extent,
    hashFloat(hashCombine(seed, i, 2)) * extent,
  ]);
}

/** A cloud plus one scalar f32 point attribute per named value list. */
function cloudWith(
  positions: number[][],
  attrs: Record<string, number[]>,
): ReturnType<typeof createPointCloud> {
  const geo = cloudAt(positions);
  for (const [name, values] of Object.entries(attrs)) {
    const attr = geo.attrs.point.add(name, "f32", 1, 0);
    values.forEach((v, i) => attr.set(i, v));
  }
  return geo;
}

describe("filterByDensity", () => {
  it("threshold mode keeps density >= threshold", async () => {
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    const density = cloud.attrs.point.require("density");
    density.set(0, 0.2);
    density.set(1, 0.5);
    density.set(2, 0.9);
    const geo = firstGeo(
      (
        await runNode(filterByDensity, { mode: "threshold", threshold: 0.5 }, {
          in: [makeGeometryItem(cloud)],
        })
      ).out,
    );
    expect(positionsOf(geo).map((p) => p[0])).toEqual([1, 2]);
  });

  it("probabilistic mode keeps a density-proportional, deterministic subset", async () => {
    const cloud = cloudAt(Array.from({ length: 1000 }, (_, i) => [i, 0, 0]));
    cloud.attrs.point.require("density").fill(0.3, 0, 1000);
    const run = () =>
      runNode(filterByDensity, { mode: "probabilistic" }, { in: [makeGeometryItem(cloud)] }, 5);
    const a = firstGeo((await run()).out);
    const b = firstGeo((await run()).out);
    expect(snapshotGeometry(a)).toEqual(snapshotGeometry(b));
    expect(a.pointCount).toBeGreaterThan(200);
    expect(a.pointCount).toBeLessThan(400);
    // Survivors are a subset of the input positions.
    const inputXs = new Set(positionsOf(cloud).map((p) => p[0]));
    for (const [x] of positionsOf(a)) expect(inputXs.has(x)).toBe(true);
    // density 0 never survives, density 1 always does.
    cloud.attrs.point.require("density").fill(0, 0, 1000);
    expect(firstGeo((await run()).out).pointCount).toBe(0);
    cloud.attrs.point.require("density").fill(1, 0, 1000);
    expect(firstGeo((await run()).out).pointCount).toBe(1000);
  });

  it("probabilistic mode is permutation-equivariant", async () => {
    // The acceptance draw is keyed on each point's IDENTITY, so shuffling
    // the input can only shuffle the output: the same points survive.
    const cloud = seededCloudAt(scatter(400, 21));
    cloud.attrs.point.require("density").fill(0.4, 0, 400);
    const order = shuffledOrder(400, 9);
    const run = (geo: ReturnType<typeof createPointCloud>) =>
      runNode(filterByDensity, { mode: "probabilistic" }, { in: [makeGeometryItem(geo)] }, 5);
    const straight = firstGeo((await run(cloud)).out);
    const shuffled = firstGeo((await run(permutePoints(cloud, order))).out);
    // The filter really filtered — an all-survive run proves nothing.
    expect(straight.pointCount).toBeGreaterThan(100);
    expect(straight.pointCount).toBeLessThan(300);
    expect(pointRecords(shuffled).sort()).toEqual(pointRecords(straight).sort());
  });

  it("probabilistic mode reads BOTH halves of a point's identity", async () => {
    // Neither half can be dropped: seeds alone default to 0 on hand-built
    // clouds, and positions alone collide on coincident points. Each half
    // is shown to matter by moving ONLY it and watching the survivor set
    // change — which is also what makes this fail against index keying,
    // where neither half is read at all.
    const positions = scatter(200, 3);
    const ordered = (geo: ReturnType<typeof createPointCloud>) => {
      const ord = geo.attrs.point.add("ord", "f32", 1, 0);
      for (let i = 0; i < geo.pointCount; i++) ord.set(i, i);
      geo.attrs.point.require("density").fill(0.5, 0, geo.pointCount);
      return geo;
    };
    const survivors = async (geo: ReturnType<typeof createPointCloud>): Promise<number[]> => {
      const out = firstGeo(
        (await runNode(filterByDensity, { mode: "probabilistic" }, { in: [makeGeometryItem(geo)] }, 5)).out,
      );
      const ord = out.attrs.point.require("ord");
      return Array.from({ length: out.pointCount }, (_, i) => ord.get(i, 0));
    };
    const seeded = await survivors(ordered(seededCloudAt(positions)));
    const unseeded = await survivors(ordered(cloudAt(positions)));
    const moved = await survivors(
      ordered(seededCloudAt(positions.map(([x, y, z]) => [x + 0.5, y, z]))),
    );
    expect(seeded.length).toBeGreaterThan(50);
    expect(seeded).not.toEqual(unseeded); // the seed attribute is read
    expect(seeded).not.toEqual(moved); // the position bits are read
  });

  it("errors actionably when density is missing", async () => {
    const geo = createPointCloud(1);
    geo.attrs.point.remove("density");
    await expect(
      runNode(filterByDensity, {}, { in: [makeGeometryItem(geo)] }),
    ).rejects.toThrow(/"density".*setAttribute/);
  });
});

describe("filterByBounds", () => {
  const positions = [
    [0.5, 0.5, 0.5],
    [2, 0.5, 0.5],
    [1, 1, 1], // exactly on the max face
    [0, 0.5, 0.5], // exactly on the min face
  ];

  /** Run the node over a cloud and read back the survivors' positions. */
  const boxed = async (
    cloud: ReturnType<typeof createPointCloud>,
    params: Record<string, unknown>,
  ): Promise<number[][]> =>
    positionsOf(firstGeo((await runNode(filterByBounds, params, { in: [makeGeometryItem(cloud)] })).out));

  it("defaults to half-open: the min face is in, the max face is out", async () => {
    // The default decides ownership, so it is asserted as a default and
    // not merely as behavior: half-open is what `floor(p / cellSize)`
    // means, and it is the rule pointScatterInWorld's window and a World
    // cell rectangle already use.
    expect(filterByBounds.defaultParams.boundary).toBe("halfOpen");
    const kept = await boxed(cloudAt(positions), {
      boundsMin: [0, 0, 0],
      boundsMax: [1, 1, 1],
      mode: "inside",
    });
    expect(kept).toEqual([
      [0.5, 0.5, 0.5],
      [0, 0.5, 0.5],
    ]);
  });

  it("gives a point on a shared face to exactly one of two abutting boxes", async () => {
    // The ownership case. Two boxes meeting at x = 1, and a point sitting
    // exactly on the seam: under the inclusive rule both boxes emit it,
    // which is what makes an inclusive test unusable as an ownership rule
    // for partitioned generation.
    const cloud = cloudAt(positions);
    const left = await boxed(cloud, { boundsMin: [0, 0, 0], boundsMax: [1, 2, 2] });
    const right = await boxed(cloud, { boundsMin: [1, 0, 0], boundsMax: [2, 2, 2] });
    const seam = (pts: number[][]): number[][] => pts.filter((p) => p[0] === 1);
    expect(seam(left)).toEqual([]);
    expect(seam(right)).toEqual([[1, 1, 1]]);
    // And the two together hold every point of the union box, once each.
    const union = await boxed(cloud, { boundsMin: [0, 0, 0], boundsMax: [2, 2, 2] });
    expect([...left, ...right].map(String).sort()).toEqual(union.map(String).sort());
  });

  it("keeps inside and outside an exact partition under BOTH boundary rules", async () => {
    // The property most likely to rot: whichever rule is active, `outside`
    // is its exact complement — no point lost, no point emitted twice.
    // Face-exact points are included deliberately, since they are the only
    // ones the two rules disagree about.
    const cloud = cloudAt([
      ...scatter(120, 17),
      [2, 4, 4], // on the min face
      [6, 4, 4], // on the max face
      [4, 2, 6],
      [4, 6, 2],
      [NaN, 4, 4], // never inside, and never lost either
    ]);
    const all = pointRecords(cloud).sort();
    const insideCounts: number[] = [];
    for (const boundary of ["halfOpen", "inclusive"]) {
      const box = { boundsMin: [2, 2, 2], boundsMax: [6, 6, 6], boundary };
      const inside = firstGeo(
        (
          await runNode(
            filterByBounds,
            { ...box, mode: "inside" },
            { in: [makeGeometryItem(cloud)] },
          )
        ).out,
      );
      const outside = firstGeo(
        (
          await runNode(
            filterByBounds,
            { ...box, mode: "outside" },
            { in: [makeGeometryItem(cloud)] },
          )
        ).out,
      );
      // Both halves are non-trivial, or the partition proves nothing.
      expect(inside.pointCount).toBeGreaterThan(5);
      expect(outside.pointCount).toBeGreaterThan(5);
      expect(inside.pointCount + outside.pointCount).toBe(cloud.pointCount);
      expect([...pointRecords(inside), ...pointRecords(outside)].sort()).toEqual(all);
      // A NaN coordinate is not inside under either rule, and the
      // complement is where it has to turn up — a `!(x < min || x > max)`
      // spelling of `outside` would drop it from both halves.
      expect(positionsOf(inside).some((p) => Number.isNaN(p[0]))).toBe(false);
      expect(positionsOf(outside).some((p) => Number.isNaN(p[0]))).toBe(true);
      insideCounts.push(inside.pointCount);
    }
    // The loop really ran two different rules: the max-face points are in
    // one and not the other.
    expect(insideCounts[1]).toBeGreaterThan(insideCounts[0]);
  });

  it("tiles space into cells that claim every point exactly once", async () => {
    // Ownership over a whole grid rather than one seam, at a cell size
    // that is NOT exactly representable — 0.1, where `floor(p / size)`
    // and the box `[c*size, (c+1)*size)` disagree about points near a
    // boundary. The tiling is exact anyway, and this is why: two abutting
    // boxes are built from the same endpoint VALUE, so whatever that
    // value rounds to, one box's `< max` and the next's `>= min` are the
    // same comparison against the same number.
    const size = 0.1;
    const edge = (c: number): number => c * size;
    const cloud = cloudAt([
      ...scatter(200, 41, 1),
      // Points sitting exactly ON an internal boundary, which is where a
      // rule can double-count. 0.5 is used because it is the one interior
      // edge of this grid that survives the f32 store unchanged: it is
      // exact in both formats, so the stored coordinate really does equal
      // the box endpoint rather than landing a ulp off it.
      [0.5, 0.5, 0.5],
      [0.5, 0.25, 0.75],
      [0.75, 0.5, 0.25],
    ]);
    const claimed: string[] = [];
    for (let cx = 0; cx < 10; cx++) {
      for (let cy = 0; cy < 10; cy++) {
        for (let cz = 0; cz < 10; cz++) {
          const kept = await boxed(cloud, {
            boundsMin: [edge(cx), edge(cy), edge(cz)],
            boundsMax: [edge(cx + 1), edge(cy + 1), edge(cz + 1)],
          });
          claimed.push(...kept.map(String));
        }
      }
    }
    const covered = positionsOf(cloud).filter((p) => p.every((v) => v >= 0 && v < 1));
    expect(covered.length).toBeGreaterThan(150);
    expect(claimed.sort()).toEqual(covered.map(String).sort());
  });

  it("agrees with floor(p / cellSize) at an exactly representable cell size", async () => {
    // The arithmetic form of the same rule, which holds when `c * size`
    // is exact (integers, powers of two) — stated with that condition
    // because it is NOT a general identity: floor(67.8 / 0.1) is 677
    // while 678 * 0.1 is exactly 67.8, so an ownership test written as a
    // recomputed index can disagree with the box it is meant to match.
    const size = 2;
    const pts = [
      ...scatter(150, 29, 12).map(([x, y, z]) => [x - 6, y - 6, z - 6]),
      [0, 0, 0],
      [2, -2, 4],
      [-2, 0, -4],
      [-4, 2, 2],
    ];
    const cloud = cloudAt(pts);
    const cellOf = (p: number[]): string => p.map((v) => Math.floor(v / size)).join(",");
    const seen: string[] = [];
    for (let cx = -3; cx < 3; cx++) {
      for (let cy = -3; cy < 3; cy++) {
        for (let cz = -3; cz < 3; cz++) {
          const kept = await boxed(cloud, {
            boundsMin: [cx * size, cy * size, cz * size],
            boundsMax: [(cx + 1) * size, (cy + 1) * size, (cz + 1) * size],
          });
          for (const p of kept) expect(cellOf(p)).toBe(`${cx},${cy},${cz}`);
          seen.push(...kept.map(String));
        }
      }
    }
    // Every point of the covered region was claimed exactly once. The
    // comparison runs over STORED positions, since P is f32 and the cells
    // are decided on what was stored, not on the float64 input.
    const covered = positionsOf(cloud).filter((p) => p.every((v) => v >= -6 && v < 6));
    expect(covered.length).toBeGreaterThan(100);
    expect(seen.sort()).toEqual(covered.map(String).sort());
  });

  it("keeps working with infinite bounds, so an xz column needs no extra param", async () => {
    // `y < +Infinity` holds for every finite y, so the half-open rule
    // spells an unbounded axis with the same two params a World's "xz"
    // cell already binds.
    // Powers of two, so the f32 store is exact and the Y values compared
    // below are the ones written.
    const far = 2 ** 30;
    const cloud = cloudAt([
      [0.5, -far, 0.5],
      [0.5, far, 0.5],
      [1, 0, 0.5], // on the max X face: still owned by the next column
      [-0.5, 0, 0.5],
    ]);
    const kept = await boxed(cloud, {
      boundsMin: [0, -Infinity, 0],
      boundsMax: [1, Infinity, 1],
    });
    expect(kept).toEqual([
      [0.5, -far, 0.5],
      [0.5, far, 0.5],
    ]);
  });

  it("inclusive keeps both faces, and really is a different rule", async () => {
    // The opt-in rule, for selecting a box whose faces carry points on
    // purpose (a pointGrid's last row, an authored extent). Asserted
    // against the default run over the same cloud, so the two names
    // cannot quietly become one behavior.
    const box = { boundsMin: [0, 0, 0], boundsMax: [1, 1, 1] };
    const kept = await boxed(cloudAt(positions), { ...box, boundary: "inclusive" });
    expect(kept).toEqual([
      [0.5, 0.5, 0.5],
      [1, 1, 1],
      [0, 0.5, 0.5],
    ]);
    expect(kept).not.toEqual(await boxed(cloudAt(positions), box));
  });

  it("names the param and the valid values on an unknown mode or boundary", async () => {
    const cloud = cloudAt(positions);
    await expect(
      runNode(filterByBounds, { boundary: "closed" }, { in: [makeGeometryItem(cloud)] }),
    ).rejects.toThrow(/boundary must be "halfOpen" or "inclusive", got "closed"/);
    await expect(
      runNode(filterByBounds, { mode: "Inside" }, { in: [makeGeometryItem(cloud)] }),
    ).rejects.toThrow(/mode must be "inside" or "outside", got "Inside"/);
    // A 2D bound is the mistake a World "xz" level invites, and every
    // comparison against the missing component would be false — so the
    // box would silently hold nothing instead of saying what is wrong.
    await expect(
      runNode(filterByBounds, { boundsMin: [0, 0] }, { in: [makeGeometryItem(cloud)] }),
    ).rejects.toThrow(/boundsMin needs three components \[x, y, z\], got 2;.*ctx\.min/s);
    await expect(
      runNode(filterByBounds, { boundsMax: [1, 1] }, { in: [makeGeometryItem(cloud)] }),
    ).rejects.toThrow(/boundsMax needs three components/);
  });
});

// ---------------------------------------------------------------------------
// filterPrimitivesByBounds: the one filter that keeps a network a network

/**
 * A network fixture: a cloud, polyline primitives over it, and one column
 * on each of the vertex, primitive and detail domains — added AFTER
 * setPolylineTopology, which drops whatever the geometry carried there.
 * Every carry assertion below reads them.
 */
function networkAt(positions: number[][], prims: number[][]): Geometry {
  const geo = cloudAt(positions);
  const flat: number[] = [];
  const start: number[] = [];
  const count: number[] = [];
  for (const pr of prims) {
    start.push(flat.length);
    count.push(pr.length);
    flat.push(...pr);
  }
  setPolylineTopology(geo, flat, start, count);
  const vertexOf = geo.attrs.vertex.add("sourceVertex", "u32", 1, 0);
  for (let v = 0; v < geo.vertexCount; v++) vertexOf.set(v, v);
  const kind = geo.attrs.primitive.add("roadKind", "string", 1, "dirt");
  for (let p = 0; p < geo.primitiveCount; p++) kind.setString(p, `road${p}`);
  geo.attrs.detail.add("region", "string", 1, "").setString(0, "north");
  return geo;
}

/** Run filterPrimitivesByBounds and return the output geometry. */
async function keptPrims(
  geo: Geometry,
  params: Partial<FilterPrimitivesByBoundsParams>,
): Promise<Geometry> {
  const out = await runNode(filterPrimitivesByBounds, params, { in: [makeGeometryItem(geo)] });
  return firstGeo(out.out);
}

/** Each surviving primitive's `roadKind`, which names the input primitive. */
function kindsOf(geo: Geometry): string[] {
  const kind = geo.attrs.primitive.require("roadKind");
  return Array.from({ length: geo.primitiveCount }, (_, p) => kind.getString(p));
}

/** Each primitive as the list of its vertices' world x coordinates. */
function primXs(geo: Geometry): number[][] {
  const P = geo.attrs.point.require("P");
  return Array.from({ length: geo.primitiveCount }, (_, p) => {
    const s = geo.primVertexStart[p];
    return Array.from({ length: geo.primVertexCount[p] }, (_, j) =>
      P.get(geo.vertexToPoint[s + j], 0),
    );
  });
}

describe("filterPrimitivesByBounds", () => {
  // Five points on the X axis and five polylines over them, chosen so that
  // every vertex rule has a distinct answer: one primitive entirely
  // outside the box, one entirely inside, and three straddling it in
  // different ways (in-out, out-in, and a 3-vertex path whose first vertex
  // is inside and whose last is not).
  const line = [
    [-2, 0, 0],
    [-1, 0, 0],
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
  ];
  const roads = [
    [0, 1], // road0: both outside
    [1, 2], // road1: first outside, last inside
    [2, 3], // road2: both inside
    [3, 4], // road3: first inside, last outside
    [2, 4, 0], // road4: first inside, last and middle outside
  ];
  /** x in [0, 1.5): points 2 and 3 are inside, 0, 1 and 4 are not. */
  const box = { boundsMin: [0, -10, -10], boundsMax: [1.5, 10, 10] };

  it("keeps the topology, and every vertex, primitive and detail column with it", async () => {
    const geo = networkAt(line, roads);
    const out = await keptPrims(geo, { ...box, vertex: "first" });
    expect(kindsOf(out)).toEqual(["road2", "road3", "road4"]);
    expect(out.primitiveCount).toBe(3);
    expect(out.vertexCount).toBe(7); // 2 + 2 + 3
    expect(Array.from(out.primVertexStart)).toEqual([0, 2, 4]);
    expect(Array.from(out.primVertexCount)).toEqual([2, 2, 3]);
    // The surviving vertices are the input's, in the input's order.
    const sourceVertex = out.attrs.vertex.require("sourceVertex");
    expect(Array.from({ length: out.vertexCount }, (_, v) => sourceVertex.get(v))).toEqual([
      4, 5, 6, 7, 8, 9, 10,
    ]);
    // The geometry each primitive describes is unchanged.
    expect(primXs(out)).toEqual([
      [0, 1],
      [1, 2],
      [0, 2, -2],
    ]);
    expect(out.attrs.primitive.require("primtype").getString(0)).toBe("polyline");
    expect(out.attrs.detail.require("region").getString(0)).toBe("north");
  });

  it("spans the four quantifiers across `vertex` and `mode`", async () => {
    const geo = networkAt(line, roads);
    const answer = async (vertex: string, mode: string) =>
      kindsOf(await keptPrims(geo, { ...box, vertex, mode }));
    // One vertex decides: the ownership rules.
    expect(await answer("first", "inside")).toEqual(["road2", "road3", "road4"]);
    expect(await answer("last", "inside")).toEqual(["road1", "road2"]);
    // Every vertex decides: the selections.
    expect(await answer("all", "inside")).toEqual(["road2"]);
    expect(await answer("any", "inside")).toEqual(["road1", "road2", "road3", "road4"]);
    // 'outside' is the exact complement, which is why "entirely outside"
    // spells as any + outside rather than as all + outside.
    expect(await answer("any", "outside")).toEqual(["road0"]);
    expect(await answer("all", "outside")).toEqual(["road0", "road1", "road3", "road4"]);
    for (const vertex of ["first", "last", "all", "any"]) {
      const both = [...(await answer(vertex, "inside")), ...(await answer(vertex, "outside"))];
      expect(both.sort()).toEqual(["road0", "road1", "road2", "road3", "road4"]);
    }
  });

  it("tiles: abutting boxes claim every primitive exactly once under halfOpen", async () => {
    // The property the partitioned network cook rests on. The shared face
    // is x = 0, where road2 and road4 both START.
    const geo = networkAt(line, roads);
    const left = kindsOf(
      await keptPrims(geo, { boundsMin: [-3, -10, -10], boundsMax: [0, 10, 10] }),
    );
    const right = kindsOf(
      await keptPrims(geo, { boundsMin: [0, -10, -10], boundsMax: [3, 10, 10] }),
    );
    expect(left).toEqual(["road0", "road1"]);
    expect(right).toEqual(["road2", "road3", "road4"]);
    expect([...left, ...right].sort()).toEqual(["road0", "road1", "road2", "road3", "road4"]);

    // 'inclusive' is the selection rule, and the difference is visible:
    // the left box now claims the primitives starting on the shared face
    // as well, so the two boxes overlap.
    const leftInclusive = kindsOf(
      await keptPrims(geo, {
        boundsMin: [-3, -10, -10],
        boundsMax: [0, 10, 10],
        boundary: "inclusive",
      }),
    );
    expect(leftInclusive).toEqual(["road0", "road1", "road2", "road4"]);
  });

  it("leaves the point domain untouched by default", async () => {
    const geo = networkAt(line, roads);
    const before = snapshotGeometry(geo);
    const out = await keptPrims(geo, { ...box, vertex: "first" });
    expect(positionsOf(out)).toEqual(positionsOf(geo));
    expect(out.attrs.point.names()).toEqual(geo.attrs.point.names());
    // Point indices are the input's, so the topology still names them.
    expect(Array.from(out.vertexToPoint)).toEqual([2, 3, 3, 4, 2, 4, 0]);
    // And the input itself is untouched — the node reads it, never writes.
    expect(snapshotGeometry(geo)).toEqual(before);
  });

  it("drops unreferenced points on request and renumbers the topology onto the rest", async () => {
    const geo = networkAt(line, roads);
    const out = await keptPrims(geo, { ...box, vertex: "first", unreferencedPoints: "drop" });
    // Point 1 (x = -1) is referenced only by road0 and road1, both gone.
    expect(positionsOf(out)).toEqual([
      [-2, 0, 0],
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    expect(Array.from(out.vertexToPoint)).toEqual([1, 2, 2, 3, 1, 3, 0]);
    // Renumbering moved indices without moving geometry.
    expect(primXs(out)).toEqual([
      [0, 1],
      [1, 2],
      [0, 2, -2],
    ]);
    expect(kindsOf(out)).toEqual(["road2", "road3", "road4"]);
  });

  it("passes a primitive-less input through as an empty result rather than failing", async () => {
    // A partition cell too sparse to make an edge is a legitimate case, so
    // this cannot be an error.
    const cloud = cloudAt(line);
    const kept = await keptPrims(cloud, box);
    expect(kept.primitiveCount).toBe(0);
    expect(kept.pointCount).toBe(5);
    const dropped = await keptPrims(cloud, { ...box, unreferencedPoints: "drop" });
    expect(dropped.primitiveCount).toBe(0);
    expect(dropped.pointCount).toBe(0);
  });

  it("names the param, the value and the way out on every bad enum", async () => {
    const geo = networkAt(line, roads);
    const run = (params: Partial<FilterPrimitivesByBoundsParams>) =>
      runNode(filterPrimitivesByBounds, params, { in: [makeGeometryItem(geo)] });
    await expect(run({ vertex: "middle" })).rejects.toThrow(
      /filterPrimitivesByBounds: vertex must be "first", "last", "all" or "any", got "middle";.*neither tiles/s,
    );
    await expect(run({ unreferencedPoints: "maybe" })).rejects.toThrow(
      /filterPrimitivesByBounds: unreferencedPoints must be "keep" or "drop", got "maybe"/,
    );
    await expect(run({ mode: "Inside" })).rejects.toThrow(
      /filterPrimitivesByBounds: mode must be "inside" or "outside", got "Inside"/,
    );
    await expect(run({ boundary: "closed" })).rejects.toThrow(
      /filterPrimitivesByBounds: boundary must be "halfOpen" or "inclusive", got "closed"/,
    );
    await expect(run({ boundsMin: [0, 0] })).rejects.toThrow(
      /filterPrimitivesByBounds: boundsMin needs three components \[x, y, z\], got 2;.*ctx\.min/s,
    );
  });

  it("names itself when P is missing or too narrow to hold a position", async () => {
    const missing = networkAt(line, roads);
    missing.attrs.point.remove("P");
    await expect(
      runNode(filterPrimitivesByBounds, box, { in: [makeGeometryItem(missing)] }),
    ).rejects.toThrow(/filterPrimitivesByBounds: input has no point attribute "P"/);
    const narrow = networkAt(line, roads);
    narrow.attrs.point.remove("P");
    narrow.attrs.point.add("P", "f32", 2, 0);
    await expect(
      runNode(filterPrimitivesByBounds, box, { in: [makeGeometryItem(narrow)] }),
    ).rejects.toThrow(
      /filterPrimitivesByBounds: point attribute "P" is f32x2, but a box test needs/,
    );
  });
});

describe("filterByAttribute", () => {
  it("compares numeric attributes with every operator", async () => {
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    const attr = cloud.attrs.point.add("level", "i32", 1, 0);
    attr.set(0, -1);
    attr.set(1, 0);
    attr.set(2, 3);
    const item = makeGeometryItem(cloud);
    const xsFor = async (comparison: string, value: number) =>
      positionsOf(
        firstGeo(
          (
            await runNode(filterByAttribute, { attribute: "level", comparison, value }, { in: [item] })
          ).out,
        ),
      ).map((p) => p[0]);
    expect(await xsFor("eq", 0)).toEqual([1]);
    expect(await xsFor("ne", 0)).toEqual([0, 2]);
    expect(await xsFor("lt", 0)).toEqual([0]);
    expect(await xsFor("le", 0)).toEqual([0, 1]);
    expect(await xsFor("gt", 0)).toEqual([2]);
    expect(await xsFor("ge", 0)).toEqual([1, 2]);
  });

  it("compares string attributes with eq/ne and rejects ordering", async () => {
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    const attr = cloud.attrs.point.add("species", "string", 1, "");
    attr.setString(0, "oak");
    attr.setString(1, "fir");
    const item = makeGeometryItem(cloud);
    const eq = firstGeo(
      (
        await runNode(
          filterByAttribute,
          { attribute: "species", comparison: "eq", stringValue: "oak" },
          { in: [item] },
        )
      ).out,
    );
    expect(positionsOf(eq)).toEqual([[0, 0, 0]]);
    await expect(
      runNode(filterByAttribute, { attribute: "species", comparison: "lt" }, { in: [item] }),
    ).rejects.toThrow(/only comparisons "eq" and "ne"/);
  });

  it("errors actionably on missing or non-scalar attributes", async () => {
    const cloud = cloudAt([[0, 0, 0]]);
    await expect(
      runNode(filterByAttribute, { attribute: "nope" }, { in: [makeGeometryItem(cloud)] }),
    ).rejects.toThrow(/"nope" not found; available: P, rot/);
    await expect(
      runNode(filterByAttribute, { attribute: "P" }, { in: [makeGeometryItem(cloud)] }),
    ).rejects.toThrow(/tuple size 3/);
  });
});

describe("selfPrune", () => {
  it("keeps points pairwise >= minDistance", async () => {
    const grid = firstGeo((await runNode(pointGrid, { countX: 10, countY: 1, countZ: 10 })).out);
    const geo = firstGeo(
      (await runNode(selfPrune, { minDistance: 1.5 }, { in: [makeGeometryItem(grid)] })).out,
    );
    expect(geo.pointCount).toBeGreaterThan(0);
    expect(geo.pointCount).toBeLessThan(100);
    const kept = positionsOf(geo);
    for (let i = 0; i < kept.length; i++) {
      for (let j = i + 1; j < kept.length; j++) {
        const d = Math.hypot(kept[i][0] - kept[j][0], kept[i][1] - kept[j][1], kept[i][2] - kept[j][2]);
        expect(d).toBeGreaterThanOrEqual(1.5);
      }
    }
  });

  it("keeps everything when spacing already satisfies the distance", async () => {
    const grid = firstGeo((await runNode(pointGrid, { countX: 40, countY: 1, countZ: 40 })).out);
    const geo = firstGeo(
      (await runNode(selfPrune, { minDistance: 0.5 }, { in: [makeGeometryItem(grid)] })).out,
    );
    expect(geo.pointCount).toBe(1600);
  });

  it("minDistance 0 passes points through", async () => {
    const grid = firstGeo((await runNode(pointGrid, { countX: 3, countY: 1, countZ: 1 })).out);
    const geo = firstGeo(
      (await runNode(selfPrune, { minDistance: 0 }, { in: [makeGeometryItem(grid)] })).out,
    );
    expect(geo.pointCount).toBe(3);
  });

  describe("permutation equivariance", () => {
    // The visit order is priority DESCENDING then IDENTITY ascending, so
    // reordering the input can only reorder the output. Against the old
    // index-greedy every one of these picks a different survivor set.
    const cloud = seededCloudAt(scatter(300, 77, 6));

    it("holds at a uniform minDistance", async () => {
      const order = shuffledOrder(300, 4);
      const run = (geo: ReturnType<typeof createPointCloud>) =>
        runNode(selfPrune, { minDistance: 1 }, { in: [makeGeometryItem(geo)] }, 3);
      const straight = firstGeo((await run(cloud)).out);
      const shuffled = firstGeo((await run(permutePoints(cloud, order))).out);
      expect(straight.pointCount).toBeGreaterThan(10);
      expect(straight.pointCount).toBeLessThan(300); // it really pruned
      expect(pointRecords(shuffled).sort()).toEqual(pointRecords(straight).sort());
    });

    it("holds with per-point radii and a random priority", async () => {
      const order = shuffledOrder(300, 12);
      const run = (geo: ReturnType<typeof createPointCloud>) =>
        runNode(
          selfPrune,
          { minDistance: constant(1.2), priority: randomField("thin") } as never,
          { in: [makeGeometryItem(geo)] },
          3,
        );
      const straight = firstGeo((await run(cloud)).out);
      const shuffled = firstGeo((await run(permutePoints(cloud, order))).out);
      expect(straight.pointCount).toBeGreaterThan(10);
      expect(straight.pointCount).toBeLessThan(300);
      expect(pointRecords(shuffled).sort()).toEqual(pointRecords(straight).sort());
    });

    it("still emits survivors in ascending INPUT index order", async () => {
      // Identity decides WHO survives; it never decides the output order.
      const geo = firstGeo(
        (await runNode(selfPrune, { minDistance: 1 }, { in: [makeGeometryItem(cloud)] }, 3)).out,
      );
      const seen = positionsOf(cloud).map((p) => p.join(","));
      const kept = positionsOf(geo).map((p) => seen.indexOf(p.join(",")));
      expect(kept).toEqual([...kept].sort((a, b) => a - b));
    });
  });

  /**
   * The visit order the node uses when every point ties on priority:
   * identity ascending, indistinguishable points (same position AND same
   * seed) falling back to the index. Stated here so the reference greedy
   * below can restate the CONTRACT — priority, then identity — without
   * restating the implementation.
   */
  function visitOrder(pts: number[][]): number[] {
    const ident = pointIdentities(cloudAt(pts), "test");
    return Array.from({ length: pts.length }, (_, i) => i).sort(
      (a, b) => ident[a] - ident[b] || a - b,
    );
  }

  /** The single point of `pts` an identity-ordered greedy considers first. */
  function firstVisited(pts: number[][]): number[] {
    return pts[visitOrder(pts)[0]];
  }

  /**
   * The published contract, pinned against its own definition: the grid is
   * an accelerator, so its answers must equal the O(n^2) greedy exactly —
   * including where distances are NaN. Positions are f32-rounded up front so
   * the reference sees the same numbers the geometry stores. Points are
   * CONSIDERED in identity order and RETURNED in input order, which is the
   * node's split between who survives and what order they come out in.
   */
  function greedy(pts: number[][], minDistance: number): number[][] {
    const limit = minDistance * minDistance;
    const kept: number[] = [];
    for (const i of visitOrder(pts)) {
      const p = pts[i];
      let ok = true;
      for (const j of kept) {
        const q = pts[j];
        const dx = q[0] - p[0];
        const dy = q[1] - p[1];
        const dz = q[2] - p[2];
        if (dx * dx + dy * dy + dz * dz < limit) {
          ok = false;
          break;
        }
      }
      if (ok) kept.push(i);
    }
    return kept.sort((a, b) => a - b).map((i) => pts[i]);
  }

  async function prune(pts: number[][], minDistance: number): Promise<number[][]> {
    const out = firstGeo(
      (await runNode(selfPrune, { minDistance }, { in: [makeGeometryItem(cloudAt(pts))] })).out,
    );
    return positionsOf(out);
  }

  it("equals the O(n^2) greedy on lattices, clusters, and duplicates", async () => {
    let state = 12345;
    const rand = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return Math.fround(state / 4294967296);
    };
    const lattice: number[][] = [];
    for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) lattice.push([x, 0, z]);
    const scatter: number[][] = [];
    for (let i = 0; i < 400; i++) scatter.push([rand() * 4, rand() * 4, rand() * 4]);
    const duplicates = Array.from({ length: 20 }, (_, i) => [i % 2, 0, 0]);
    for (const pts of [lattice, scatter, duplicates]) {
      // 1 and 1.5 straddle the lattice spacing, so ties are exercised.
      for (const minDistance of [0.25, 1, 1.5, 3]) {
        expect(await prune(pts, minDistance)).toEqual(greedy(pts, minDistance));
      }
    }
  });

  it("keeps the exact survivors of a 6x6 lattice at minDistance 1.5", async () => {
    const lattice: number[][] = [];
    for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) lattice.push([x, 0, z]);
    // 1.5 rejects the spacing-1 and the diagonal spacing-sqrt(2)
    // neighbours and accepts spacing 2, so 9 of the 36 sites survive. WHICH
    // nine is decided by identity order, not by array order: the answer is
    // a scattered maximal set rather than the every-other-site pattern an
    // index-greedy produces by always starting at the array's front corner.
    expect(await prune(lattice, 1.5)).toEqual([
      [0, 0, 1],
      [0, 0, 3],
      [0, 0, 5],
      [2, 0, 0],
      [2, 0, 5],
      [3, 0, 3],
      [4, 0, 1],
      [4, 0, 5],
      [5, 0, 3],
    ]);
  });

  it("survives a subnormal minDistance", async () => {
    // 5e-324 is positive, so pruning runs, but its square underflows to 0
    // and no pair is ever closer than that: everything survives. The grid is
    // built at that cell size, which is where a scaled cell size would
    // underflow to zero and fail.
    const pts = [
      [0, 0, 0],
      [0, 0, 0],
      [1, 2, 3],
      [-1, -2, -3],
    ];
    expect(await prune(pts, Number.MIN_VALUE)).toEqual(greedy(pts, Number.MIN_VALUE));
    expect(await prune(pts, Number.MIN_VALUE)).toHaveLength(4);
  });

  it("never prunes with a non-finite coordinate, and is never pruned by one", async () => {
    // Every distance involving NaN or an infinity is NaN, which is not less
    // than minDistance, so those points survive and shield nothing.
    const pts = [
      [0, 0, 0],
      [NaN, 1, 2],
      [Infinity, -Infinity, NaN],
      [0.5, 0.5, 0.5], // pruned by point 0
      [-Infinity, 0, 0],
      [Infinity, 0, 0],
      [Infinity, 0, 0], // a duplicate infinity still survives
      [2, 2, 2],
    ];
    const kept = await prune(pts, 1);
    expect(kept).toEqual(greedy(pts, 1));
    expect(kept.length).toBe(7);
    expect(kept[3]).toEqual([-Infinity, 0, 0]);
  });

  /** Survivor positions for one `priority` / `minDistance` configuration. */
  async function survivors(
    geo: ReturnType<typeof createPointCloud>,
    params: Record<string, unknown>,
  ): Promise<number[][]> {
    return positionsOf(
      firstGeo((await runNode(selfPrune, params as never, { in: [makeGeometryItem(geo)] })).out),
    );
  }

  describe("priority", () => {
    // Half a minDistance apart: exactly one of the two can survive, so
    // whichever comes back names the winner with no ambiguity.
    const pair = [
      [0, 0, 0],
      [0.5, 0, 0],
    ];

    it("lets the HIGHER priority win, whatever the index order", async () => {
      const won = (rank: number[]) =>
        survivors(cloudWith(pair, { rank }), { minDistance: 1, priority: attribute("rank") });
      // The later point wins on priority alone — the greedy would keep the first.
      expect(await won([0, 1])).toEqual([[0.5, 0, 0]]);
      // Polarity, stated the other way round: a LOWER value never wins.
      expect(await won([1, 0])).toEqual([[0, 0, 0]]);
      // Equal priority falls back to the tiebreak, which is IDENTITY —
      // and for this pair identity does NOT agree with the index, so the
      // two rules are separated rather than assumed apart.
      expect(firstVisited(pair)).not.toEqual(pair[0]);
      expect(await won([0, 0])).toEqual([firstVisited(pair)]);
      expect(await won([4, 4])).toEqual([firstVisited(pair)]);
    });

    it("ranks NaN lowest", async () => {
      const won = (rank: number[]) =>
        survivors(cloudWith(pair, { rank }), { minDistance: 1, priority: attribute("rank") });
      expect(await won([NaN, 0])).toEqual([[0.5, 0, 0]]);
      expect(await won([0, NaN])).toEqual([[0, 0, 0]]);
      // Two unrankable points still break their tie by identity.
      expect(await won([NaN, NaN])).toEqual([firstVisited(pair)]);
    });

    it("is the same as no priority at all when every point ties", async () => {
      const grid = firstGeo((await runNode(pointGrid, { countX: 10, countY: 1, countZ: 10 })).out);
      const item = makeGeometryItem(grid);
      const base = firstGeo(
        (await runNode(selfPrune, { minDistance: 1.5 }, { in: [item] })).out,
      );
      for (const priority of [0, 5, -3, constant(7), attribute("density")]) {
        const same = firstGeo(
          (await runNode(selfPrune, { minDistance: 1.5, priority } as never, { in: [item] })).out,
        );
        expect(snapshotGeometry(same)).toEqual(snapshotGeometry(base));
      }
    });

    it("decides WHO survives, never the order they come out in", async () => {
      // Index 2 outranks everything, prunes index 0, and index 1 is far
      // enough away to be untouched. Emitting in priority order would put
      // [0.25, 0, 0] first.
      const geo = cloudWith(
        [
          [0, 0, 0],
          [5, 0, 0],
          [0.25, 0, 0],
        ],
        { rank: [0, 0, 9] },
      );
      expect(await survivors(geo, { minDistance: 1, priority: attribute("rank") })).toEqual([
        [5, 0, 0],
        [0.25, 0, 0],
      ]);
    });

    it("is deterministic under a random priority, and re-rolls with the key", async () => {
      const grid = firstGeo((await runNode(pointGrid, { countX: 12, countY: 1, countZ: 12 })).out);
      const item = makeGeometryItem(grid);
      const run = (key: string) =>
        runNode(selfPrune, { minDistance: 1.5, priority: randomField(key) } as never, {
          in: [item],
        }, 5);
      const a = firstGeo((await run("thin")).out);
      const b = firstGeo((await run("thin")).out);
      expect(snapshotGeometry(a)).toEqual(snapshotGeometry(b));
      // The negative half: a different key must actually move the result.
      const c = firstGeo((await run("other")).out);
      expect(snapshotGeometry(c)).not.toEqual(snapshotGeometry(a));
    });
  });

  describe("per-point minDistance", () => {
    it("agrees with the same number passed plainly", async () => {
      const grid = firstGeo((await runNode(pointGrid, { countX: 10, countY: 1, countZ: 10 })).out);
      const item = makeGeometryItem(grid);
      for (const minDistance of [0.5, 1.5, 2]) {
        const plain = firstGeo((await runNode(selfPrune, { minDistance }, { in: [item] })).out);
        const field = firstGeo(
          (
            await runNode(selfPrune, { minDistance: constant(minDistance) } as never, {
              in: [item],
            })
          ).out,
        );
        expect(snapshotGeometry(field)).toEqual(snapshotGeometry(plain));
      }
    });

    it("conflicts a pair on the LARGER of the two radii", async () => {
      // 2 apart: inside the big claim of 3, outside the small claim of 0.5.
      // A rule reading only the candidate's own radius would keep both, so
      // what is under test is that exactly ONE comes back. Which one is the
      // tiebreak's business, and the tiebreak is identity — the same point
      // wins whichever slot each occupies, which the swapped case pins.
      const pts = [
        [0, 0, 0],
        [2, 0, 0],
      ];
      expect(
        await survivors(cloudWith(pts, { crown: [3, 0.5] }), {
          minDistance: attribute("crown"),
        }),
      ).toEqual([firstVisited(pts)]);
      // Swapped slots, swapped radii: the same POSITION survives, because
      // identity does not know where in the array a point sits.
      expect(
        await survivors(
          cloudWith(
            [
              [2, 0, 0],
              [0, 0, 0],
            ],
            { crown: [0.5, 3] },
          ),
          { minDistance: attribute("crown") },
        ),
      ).toEqual([firstVisited(pts)]);
    });

    it("does not add the two radii up", async () => {
      // 1.5 apart, each claiming 1: the max rule keeps both, a sum rule
      // (radii as touching discs) would have pruned one.
      expect(
        await survivors(
          cloudWith(
            [
              [0, 0, 0],
              [1.5, 0, 0],
            ],
            { crown: [1, 1] },
          ),
          { minDistance: attribute("crown") },
        ),
      ).toEqual([
        [0, 0, 0],
        [1.5, 0, 0],
      ]);
    });

    it("treats 0, negative and NaN radii as claiming nothing, but still prunes them", async () => {
      const pts = [
        [0, 0, 0],
        [2, 0, 0],
        [8, 0, 0],
        [8.25, 0, 0],
      ];
      // 8 and 8.25 claim nothing and are a quarter apart, so neither can
      // prune the other and BOTH survive — that is the "claiming nothing"
      // half. The 0/2 pair is inside the claim of 3, so exactly one of
      // them comes back, whichever identity considers first — that is the
      // "still prunes them" half.
      const contested = visitOrder(pts).find((i) => i === 0 || i === 1) as number;
      expect(
        await survivors(cloudWith(pts, { crown: [3, NaN, -1, 0] }), {
          minDistance: attribute("crown"),
        }),
      ).toEqual([pts[contested], [8, 0, 0], [8.25, 0, 0]]);
    });

    it("lets priority beat radius", async () => {
      // The small, high-priority point is placed first and the big one
      // then loses to it — authored beats procedural by saying so.
      expect(
        await survivors(
          cloudWith(
            [
              [0, 0, 0],
              [2, 0, 0],
            ],
            { crown: [3, 0.5], rank: [0, 1] },
          ),
          { minDistance: attribute("crown"), priority: attribute("rank") },
        ),
      ).toEqual([[2, 0, 0]]);
    });

    it("keeps every point when the radii are all zero, as a point cloud", async () => {
      const geo = cloudWith(
        [
          [0, 0, 0],
          [0, 0, 0],
        ],
        { crown: [0, 0] },
      );
      expect(await survivors(geo, { minDistance: attribute("crown") })).toEqual([
        [0, 0, 0],
        [0, 0, 0],
      ]);
    });

    it("names the node and the param when a field is not one number per point", async () => {
      const geo = cloudAt([[0, 0, 0]]);
      await expect(
        runNode(selfPrune, { minDistance: position() } as never, { in: [makeGeometryItem(geo)] }),
      ).rejects.toThrow(/selfPrune: param "minDistance" must evaluate to ONE number per point/);
      await expect(
        runNode(selfPrune, { minDistance: 1, priority: position() } as never, {
          in: [makeGeometryItem(geo)],
        }),
      ).rejects.toThrow(/selfPrune: param "priority" must evaluate to ONE number per point/);
    });
  });

  // -------------------------------------------------------------------------
  // mode: the greedy packs, the local maximum partitions.
  //
  // The gap this suite exists for was found by MEASUREMENT, migrating
  // examples/04-infinite-world: cooked in cells of 20 and of 40, a greedy
  // selfPrune produced different survivor sets and left a seam pair closer
  // than minDistance. It is structural rather than a tuning problem — a
  // greedy point survives because its neighbour did not, which happened
  // because ITS neighbour did, and that chain has no bounded length, so no
  // halo width reproduces it. So these tests re-run the measurement in both
  // directions: the new rule must agree with a whole-region cook at any cell
  // size, and the old one must be SEEN to disagree, or the contrast is
  // asserted rather than demonstrated.
  describe("mode", () => {
    /** One world point: a position and the seed that travels with it. */
    interface WorldPoint {
      readonly p: readonly number[];
      readonly seed: number;
    }

    /**
     * A flat world whose points each carry their own seed, so any WINDOW
     * over it names exactly the points the whole world does — the only way
     * a split-versus-whole comparison can mean anything. (`seededCloudAt`
     * derives its seeds from the ARRAY index, which would rename every
     * point of a subset and make identity order a function of the cell.)
     */
    function flatWorld(count: number, seed: number, extent: number): WorldPoint[] {
      return Array.from({ length: count }, (_, i) => ({
        p: [
          hashFloat(hashCombine(seed, i, 0)) * extent,
          0,
          hashFloat(hashCombine(seed, i, 1)) * extent,
        ],
        seed: hashCombine(seed, i, 2),
      }));
    }

    /** Those points as a cloud, seeds included. */
    function worldCloud(points: readonly WorldPoint[]): ReturnType<typeof createPointCloud> {
      const geo = cloudAt(points.map((w) => [...w.p]));
      const seed = geo.attrs.point.require("seed");
      points.forEach((w, i) => seed.set(i, w.seed));
      return geo;
    }

    /** Survivor positions of one cook over exactly these points. */
    async function survivorsOf(
      points: readonly WorldPoint[],
      params: Record<string, unknown>,
    ): Promise<number[][]> {
      return positionsOf(
        firstGeo(
          (
            await runNode(selfPrune, params as never, {
              in: [makeGeometryItem(worldCloud(points))],
            }, 9)
          ).out,
        ),
      );
    }

    /** Sortable key for a survivor, so two cooks compare as sets. */
    const key = (p: number[]): string => `${p[0]},${p[2]}`;
    const keys = (pts: number[][]): string[] => pts.map(key).sort();

    /**
     * The world cooked in square cells of `size`, each cell deriving a
     * `halo`-wide margin of extra points and then keeping only the
     * survivors it OWNS — half-open on both axes, the ownership rule
     * `filterByBounds` defaults to and a World cell follows. This is the
     * partitioned cook, assembled.
     */
    async function survivorsInCells(
      points: readonly WorldPoint[],
      extent: number,
      size: number,
      halo: number,
      params: Record<string, unknown>,
    ): Promise<number[][]> {
      const out: number[][] = [];
      for (let cx = 0; cx * size < extent; cx++) {
        for (let cz = 0; cz * size < extent; cz++) {
          const x0 = cx * size;
          const z0 = cz * size;
          const x1 = x0 + size;
          const z1 = z0 + size;
          const window = points.filter(
            (w) =>
              w.p[0] >= x0 - halo &&
              w.p[0] < x1 + halo &&
              w.p[2] >= z0 - halo &&
              w.p[2] < z1 + halo,
          );
          for (const p of await survivorsOf(window, params)) {
            if (p[0] >= x0 && p[0] < x1 && p[2] >= z0 && p[2] < z1) out.push(p);
          }
        }
      }
      return out;
    }

    /** Closest pair among survivors, by brute force. */
    function closestPair(pts: number[][]): number {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]);
          if (d < best) best = d;
        }
      }
      return best;
    }

    // 2000 points over 60x60 at minDistance 3: dense enough that pruning
    // does real work (about a tenth survives) and small enough for the
    // O(n^2) checks above.
    const EXTENT = 60;
    const D = 3;
    const WORLD = flatWorld(2000, 4242, EXTENT);

    it("localMaximum reproduces the whole world from cells; greedy provably cannot", async () => {
      for (const mode of ["greedy", "localMaximum"]) {
        const whole = await survivorsOf(WORLD, { mode, minDistance: D });
        // Whole-region, both rules honour the distance they enforce.
        expect(closestPair(whole)).toBeGreaterThanOrEqual(D);
        const wholeKeys = keys(whole);
        const splits: { size: number; split: number[][] }[] = [];
        for (const size of [10, 15, 20, 30]) {
          const split = await survivorsInCells(WORLD, EXTENT, size, D, { mode, minDistance: D });
          // Ownership is exact either way: every survivor is claimed once.
          expect(new Set(keys(split)).size).toBe(split.length);
          splits.push({ size, split });
        }
        if (mode === "localMaximum") {
          // The halo is exactly minDistance, and it is exactly enough — at
          // every cell size, point for point, with no pair closer than the
          // distance anywhere including across the seams.
          for (const { split } of splits) {
            expect(keys(split)).toEqual(wholeKeys);
            expect(closestPair(split)).toBeGreaterThanOrEqual(D);
          }
        } else {
          // The same measurement against the rule it fails on. Of 238
          // whole-region survivors, the cells KEEP points the whole cook
          // pruned (4, 4, 2, 1 of them at cell size 10, 15, 20, 30) and
          // DROP points it kept (7, 5, 2, 3) — every cell size wrong in a
          // different way, and no two agreeing with each other. Three of
          // the four leave a surviving pair closer than the 3 the node was
          // asked to enforce (1.41, 2.18, 1.41), the worst of them under
          // half of it: a seam that is invisible until something renders
          // it, which is how this was found in the first place.
          const extra = splits.map(
            ({ split }) => keys(split).filter((k) => !wholeKeys.includes(k)).length,
          );
          const dropped = splits.map(
            ({ split }) => wholeKeys.filter((k) => !keys(split).includes(k)).length,
          );
          expect(wholeKeys.length).toBe(238);
          expect(extra).toEqual([4, 4, 2, 1]);
          expect(dropped).toEqual([7, 5, 2, 3]);
          for (let i = 1; i < splits.length; i++) {
            expect(keys(splits[i].split)).not.toEqual(keys(splits[i - 1].split));
          }
          // Pinned per cell size, not as an aggregate: the prose quotes
          // each of these, and a minimum alone would let the other three
          // drift unseen.
          const closest = splits.map(({ split }) => closestPair(split));
          expect(closest.map((d) => d < D)).toEqual([true, true, true, false]);
          expect(closest.map((d) => Number(d.toFixed(2)))).toEqual([1.41, 2.18, 1.41, 3]);
          expect(Math.min(...closest)).toBeLessThan(D / 2);
        }
      }
    });

    it("keeps a strict subset of the greedy's survivors — the price of the halo", async () => {
      const greedyKeys = keys(await survivorsOf(WORLD, { minDistance: D }));
      const localKeys = keys(await survivorsOf(WORLD, { mode: "localMaximum", minDistance: D }));
      // Provable, and worth pinning: a point that outranks every neighbour
      // is reached by the greedy before any of them, so it is kept there
      // too. The converse fails, which is exactly the density that is lost.
      for (const k of localKeys) expect(greedyKeys).toContain(k);
      expect(localKeys.length).toBeLessThan(greedyKeys.length);
      // The trade-off as a number the docs can quote: 122 against 238, so
      // roughly half the density, on a world that is one dense scatter.
      expect([localKeys.length, greedyKeys.length]).toEqual([122, 238]);
      expect(localKeys.length / greedyKeys.length).toBeCloseTo(0.51, 2);
    });

    /**
     * The published local-maximum contract, restated against its own
     * definition so the uniform grid is pinned as an accelerator and
     * nothing else: a point survives when NO point it conflicts with
     * outranks it, whether or not that neighbour itself survives. Optional
     * per-point radii use the same max(rA, rB) rule as the greedy.
     */
    function localMaximum(pts: number[][], minDistance: number, radii?: number[]): number[][] {
      const ident = pointIdentities(cloudAt(pts), "test");
      const claim = (i: number): number => {
        const r = radii === undefined ? minDistance : radii[i];
        return r > 0 ? r : 0;
      };
      const out: number[][] = [];
      for (let i = 0; i < pts.length; i++) {
        let survives = true;
        for (let j = 0; j < pts.length && survives; j++) {
          if (j === i) continue;
          const limit = Math.max(claim(i), claim(j));
          const dx = pts[j][0] - pts[i][0];
          const dy = pts[j][1] - pts[i][1];
          const dz = pts[j][2] - pts[i][2];
          if (!(dx * dx + dy * dy + dz * dz < limit * limit)) continue;
          // Outranked by a conflicting neighbour: identity ascending, the
          // index only between points nothing else separates.
          if (ident[j] !== ident[i] ? ident[j] < ident[i] : j < i) survives = false;
        }
        if (survives) out.push(pts[i]);
      }
      return out;
    }

    it("equals the O(n^2) local maximum on lattices, clusters, duplicates and NaN", async () => {
      let state = 999;
      const rand = (): number => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return Math.fround(state / 4294967296);
      };
      const lattice: number[][] = [];
      for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) lattice.push([x, 0, z]);
      const cluster: number[][] = [];
      for (let i = 0; i < 400; i++) cluster.push([rand() * 4, rand() * 4, rand() * 4]);
      const duplicates = Array.from({ length: 20 }, (_, i) => [i % 2, 0, 0]);
      const nonFinite = [
        [0, 0, 0],
        [NaN, 1, 2],
        [Infinity, -Infinity, NaN],
        [0.5, 0.5, 0.5],
        [-Infinity, 0, 0],
        [2, 2, 2],
      ];
      for (const pts of [lattice, cluster, duplicates, nonFinite]) {
        for (const minDistance of [0.25, 1, 1.5, 3]) {
          const geo = cloudAt(pts);
          const out = firstGeo(
            (
              await runNode(selfPrune, { mode: "localMaximum", minDistance } as never, {
                in: [makeGeometryItem(geo)],
              })
            ).out,
          );
          expect(positionsOf(out)).toEqual(localMaximum(pts, minDistance));
        }
      }
    });

    it("honours per-point radii by the same max(rA, rB) rule", async () => {
      const pts = [
        [0, 0, 0],
        [2, 0, 0],
        [8, 0, 0],
        [8.25, 0, 0],
      ];
      const crown = [3, 0.5, -1, 0];
      const geo = cloudWith(pts, { crown });
      const out = firstGeo(
        (
          await runNode(
            selfPrune,
            { mode: "localMaximum", minDistance: attribute("crown") } as never,
            { in: [makeGeometryItem(geo)] },
          )
        ).out,
      );
      // The big claim at 0 reaches 2 (the small point cannot reach back),
      // and 8/8.25 claim nothing at all, so both of those survive.
      expect(positionsOf(out)).toEqual(localMaximum(pts, 0, crown));
      expect(positionsOf(out)).toHaveLength(3);
    });

    it("lets priority beat identity, exactly as the greedy does", async () => {
      // Half a minDistance apart: one of the two survives, and the pair is
      // small enough that both rules must name the same winner.
      const pair = [
        [0, 0, 0],
        [0.5, 0, 0],
      ];
      const won = (rank: number[]) =>
        survivors(cloudWith(pair, { rank }), {
          mode: "localMaximum",
          minDistance: 1,
          priority: attribute("rank"),
        });
      expect(await won([0, 1])).toEqual([[0.5, 0, 0]]);
      expect(await won([1, 0])).toEqual([[0, 0, 0]]);
      expect(await won([0, 0])).toEqual([firstVisited(pair)]);
      expect(await won([NaN, 0])).toEqual([[0.5, 0, 0]]);
    });

    it("is permutation-equivariant, uniform and per-point alike", async () => {
      const cloud = seededCloudAt(scatter(300, 77, 6));
      const order = shuffledOrder(300, 21);
      for (const params of [
        { mode: "localMaximum", minDistance: 1 },
        { mode: "localMaximum", minDistance: constant(1.2), priority: randomField("thin") },
      ]) {
        const run = (geo: ReturnType<typeof createPointCloud>) =>
          runNode(selfPrune, params as never, { in: [makeGeometryItem(geo)] }, 3);
        const straight = firstGeo((await run(cloud)).out);
        const shuffled = firstGeo((await run(permutePoints(cloud, order))).out);
        expect(straight.pointCount).toBeGreaterThan(10);
        expect(straight.pointCount).toBeLessThan(300);
        expect(pointRecords(shuffled).sort()).toEqual(pointRecords(straight).sort());
      }
    });

    it("leaves the greedy default exactly where it was", async () => {
      // Naming the default must be a no-op: the goldens rest on it.
      const grid = firstGeo((await runNode(pointGrid, { countX: 10, countY: 1, countZ: 10 })).out);
      const item = makeGeometryItem(grid);
      for (const minDistance of [1.5, 2]) {
        const implicit = firstGeo((await runNode(selfPrune, { minDistance }, { in: [item] })).out);
        const explicit = firstGeo(
          (await runNode(selfPrune, { mode: "greedy", minDistance } as never, { in: [item] })).out,
        );
        expect(snapshotGeometry(explicit)).toEqual(snapshotGeometry(implicit));
      }
    });

    it("passes points through at minDistance 0 whichever rule is named", async () => {
      const grid = firstGeo((await runNode(pointGrid, { countX: 3, countY: 1, countZ: 1 })).out);
      const geo = firstGeo(
        (
          await runNode(selfPrune, { mode: "localMaximum", minDistance: 0 } as never, {
            in: [makeGeometryItem(grid)],
          })
        ).out,
      );
      expect(geo.pointCount).toBe(3);
    });

    it("refuses an unknown mode, naming both rules and what separates them", async () => {
      const geo = cloudAt([[0, 0, 0]]);
      await expect(
        runNode(selfPrune, { mode: "poisson", minDistance: 1 } as never, {
          in: [makeGeometryItem(geo)],
        }),
      ).rejects.toThrow(/mode must be "greedy" or "localMaximum", got "poisson"/);
      // Even where nothing would have been pruned: a typo is a typo.
      await expect(
        runNode(selfPrune, { mode: "poisson", minDistance: 0 } as never, {
          in: [makeGeometryItem(geo)],
        }),
      ).rejects.toThrow(/halo of minDistance exactly sufficient/);
    });
  });
});

describe("projectToPlane", () => {
  it("projects onto the plane and can keep the signed offset", async () => {
    const cloud = cloudAt([
      [1, 5, 2],
      [3, -1, 4],
    ]);
    const geo = firstGeo(
      (
        await runNode(
          projectToPlane,
          { origin: [0, 2, 0], normal: [0, 2, 0], keepOffset: true },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    expect(positionsOf(geo)).toEqual([
      [1, 2, 2],
      [3, 2, 4],
    ]);
    const offset = geo.attrs.point.require("planeOffset");
    expect(offset.get(0)).toBeCloseTo(3, 5);
    expect(offset.get(1)).toBeCloseTo(-3, 5);
  });

  it("rejects a zero normal", async () => {
    await expect(
      runNode(projectToPlane, { normal: [0, 0, 0] }, { in: [makeGeometryItem(cloudAt([[0, 0, 0]]))] }),
    ).rejects.toThrow(/non-zero/);
  });
});
