import { describe, expect, it } from "vitest";
import { createPointCloud, setPolylineTopology, type Geometry } from "../data/index.js";
import { pointIdentities } from "../data/identity.js";
import { attribute, constant, position, randomField, vec } from "../fields/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import {
  filterByAttribute,
  type FilterByAttributeParams,
  filterByBounds,
  type FilterByBoundsParams,
  filterByDensity,
  type FilterByDensityParams,
  filterByExpression,
  filterPrimitivesByAttribute,
  type FilterPrimitivesByAttributeParams,
  filterPrimitivesByBounds,
  type FilterPrimitivesByBoundsParams,
  pointGrid,
  projectToPlane,
  type ProjectToPlaneParams,
  selfPrune,
} from "./index.js";
import { gatherPrimitives } from "./util.js";
import {
  firstGeo,
  permutePoints,
  pointRecords,
  positionsOf,
  runNode,
  shuffledOrder,
  snapshotGeometry,
} from "./nodes.testsupport.js";

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

// filterPrimitivesByAttribute: the same comparison, one domain up

/** `networkAt` plus the f32 PRIMITIVE column this filter tests. */
function networkWithEdgeLengths(
  positions: number[][],
  prims: number[][],
  lengths: number[],
): Geometry {
  const geo = networkAt(positions, prims);
  const attr = geo.attrs.primitive.add("edgeLength", "f32", 1, 0);
  lengths.forEach((v, p) => attr.set(p, v));
  return geo;
}

describe("filterPrimitivesByAttribute", () => {
  const line = [
    [-2, 0, 0],
    [-1, 0, 0],
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
  ];
  const roads = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [2, 4, 0],
  ];
  /** One length per road, chosen so every comparison has a distinct answer. */
  const lengths = [1, 2, 3, 4, 5];

  /** Run the node and return the output geometry. */
  async function kept(
    geo: Geometry,
    params: Partial<FilterPrimitivesByAttributeParams>,
  ): Promise<Geometry> {
    const out = await runNode(filterPrimitivesByAttribute, params, { in: [makeGeometryItem(geo)] });
    return firstGeo(out.out);
  }

  it("compares a numeric primitive attribute with every operator", async () => {
    const geo = networkWithEdgeLengths(line, roads, lengths);
    const answer = async (comparison: string, value: number) =>
      kindsOf(await kept(geo, { attribute: "edgeLength", comparison, value }));
    expect(await answer("eq", 3)).toEqual(["road2"]);
    expect(await answer("ne", 3)).toEqual(["road0", "road1", "road3", "road4"]);
    expect(await answer("lt", 3)).toEqual(["road0", "road1"]);
    expect(await answer("le", 3)).toEqual(["road0", "road1", "road2"]);
    expect(await answer("gt", 3)).toEqual(["road3", "road4"]);
    expect(await answer("ge", 3)).toEqual(["road2", "road3", "road4"]);
  });

  it("answers exactly what filterByAttribute answers, one domain down", async () => {
    // The property that makes the two nodes one idea: promote the primitive
    // column onto the points it covers and the point filter agrees, road
    // for road. Anything else means moving a filter between domains
    // silently changes what a graph means.
    const geo = networkWithEdgeLengths(line, roads, lengths);
    for (const comparison of ["eq", "ne", "lt", "le", "gt", "ge"]) {
      const prims = kindsOf(await kept(geo, { attribute: "edgeLength", comparison, value: 3 }));
      const asPoints: string[] = [];
      const edge = geo.attrs.primitive.require("edgeLength");
      const kind = geo.attrs.primitive.require("roadKind");
      // The same comparison, spelled by hand on a one-point-per-primitive
      // cloud, is what filterByAttribute would decide about each road.
      const cloud = cloudWith(
        Array.from({ length: geo.primitiveCount }, (_, p) => [p, 0, 0]),
        { edgeLength: Array.from({ length: geo.primitiveCount }, (_, p) => edge.get(p)) },
      );
      const survivors = await runNode(
        filterByAttribute,
        { attribute: "edgeLength", comparison, value: 3 },
        { in: [makeGeometryItem(cloud)] },
      );
      for (const [x] of positionsOf(firstGeo(survivors.out))) asPoints.push(kind.getString(x));
      expect(prims).toEqual(asPoints);
    }
  });

  it("keeps the topology, and every vertex, primitive and detail column with it", async () => {
    const geo = networkWithEdgeLengths(line, roads, lengths);
    const out = await kept(geo, { attribute: "edgeLength", comparison: "ge", value: 3 });
    expect(kindsOf(out)).toEqual(["road2", "road3", "road4"]);
    expect(out.primitiveCount).toBe(3);
    expect(out.vertexCount).toBe(7); // 2 + 2 + 3
    expect(Array.from(out.primVertexStart)).toEqual([0, 2, 4]);
    expect(Array.from(out.primVertexCount)).toEqual([2, 2, 3]);
    const sourceVertex = out.attrs.vertex.require("sourceVertex");
    expect(Array.from({ length: out.vertexCount }, (_, v) => sourceVertex.get(v))).toEqual([
      4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(primXs(out)).toEqual([
      [0, 1],
      [1, 2],
      [0, 2, -2],
    ]);
    expect(out.attrs.detail.require("region").getString(0)).toBe("north");
    // NO identity column rides along: the output's primitive domain holds
    // exactly what the input's did, so no per-partition number can leak
    // into a fingerprint.
    expect(out.attrs.primitive.names()).toEqual(geo.attrs.primitive.names());
  });

  it("reads every numeric column type, and NaN passes only 'ne'", async () => {
    const geo = networkWithEdgeLengths(line, roads, lengths);
    // A bool and a signed column, because "f32/i32/u32/bool" is a promise
    // and one f32 fixture would not tell a real read from a coincidence.
    const paved = geo.attrs.primitive.add("paved", "bool", 1, 0);
    [1, 0, 1, 0, 1].forEach((v, p) => paved.set(p, v));
    const grade = geo.attrs.primitive.add("grade", "i32", 1, 0);
    [-3, -1, 0, 2, 4].forEach((v, p) => grade.set(p, v));
    expect(await kindsOfKept({ attribute: "paved", comparison: "ge", value: 1 })).toEqual([
      "road0",
      "road2",
      "road4",
    ]);
    expect(await kindsOfKept({ attribute: "paved", comparison: "eq", value: 0 })).toEqual([
      "road1",
      "road3",
    ]);
    expect(await kindsOfKept({ attribute: "grade", comparison: "lt", value: 0 })).toEqual([
      "road0",
      "road1",
    ]);
    // -0 and 0 are the same number to ===, which is the one place f32
    // equality surprises an author.
    expect(await kindsOfKept({ attribute: "grade", comparison: "eq", value: -0 })).toEqual([
      "road2",
    ]);

    async function kindsOfKept(params: Partial<FilterPrimitivesByAttributeParams>) {
      return kindsOf(await kept(geo, params));
    }

    // A NaN satisfies no comparison, so it survives 'ne' alone — the same
    // rule filterByExpression states for a predicate that fails to compute.
    const withNaN = networkWithEdgeLengths(line, roads, [1, Number.NaN, 3, 4, 5]);
    for (const comparison of ["eq", "lt", "le", "gt", "ge"]) {
      expect(kindsOf(await kept(withNaN, { attribute: "edgeLength", comparison, value: 2 })))
        .not.toContain("road1");
    }
    expect(kindsOf(await kept(withNaN, { attribute: "edgeLength", comparison: "ne", value: 2 })))
      .toContain("road1");
  });

  it("filters by primtype, which is the one primitive attribute always present", async () => {
    // A mixed geometry, so 'eq polyline' has to actually READ the column
    // rather than be constantly true or constantly false.
    const geo = networkAt(line, roads);
    const primtype = geo.attrs.primitive.require("primtype");
    primtype.setString(1, "poly");
    primtype.setString(3, "poly");
    expect(kindsOf(await kept(geo, { attribute: "primtype", comparison: "eq", stringValue: "polyline" }))).toEqual([
      "road0",
      "road2",
      "road4",
    ]);
    expect(kindsOf(await kept(geo, { attribute: "primtype", comparison: "ne", stringValue: "polyline" }))).toEqual([
      "road1",
      "road3",
    ]);
    await expect(
      kept(geo, { attribute: "primtype", comparison: "lt", stringValue: "poly" }),
    ).rejects.toThrow(/only comparisons "eq" and "ne"/);
  });

  it("leaves the point domain untouched by default and drops leftovers on request", async () => {
    const geo = networkWithEdgeLengths(line, roads, lengths);
    const before = snapshotGeometry(geo);
    const untouched = await kept(geo, { attribute: "edgeLength", comparison: "ge", value: 3 });
    expect(positionsOf(untouched)).toEqual(positionsOf(geo));
    expect(Array.from(untouched.vertexToPoint)).toEqual([2, 3, 3, 4, 2, 4, 0]);
    expect(snapshotGeometry(geo)).toEqual(before);

    const dropped = await kept(geo, {
      attribute: "edgeLength",
      comparison: "ge",
      value: 3,
      unreferencedPoints: "drop",
    });
    // Point 1 (x = -1) is referenced only by road0 and road1, both gone.
    expect(positionsOf(dropped)).toEqual([
      [-2, 0, 0],
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    expect(Array.from(dropped.vertexToPoint)).toEqual([1, 2, 2, 3, 1, 3, 0]);
    expect(primXs(dropped)).toEqual([
      [0, 1],
      [1, 2],
      [0, 2, -2],
    ]);
  });

  it("'drop' also takes points that never had a primitive, as documented", async () => {
    // The cost the param description names: a cloud carrying both a
    // network and unrelated scatter loses the scatter.
    const withScatter = networkWithEdgeLengths([...line, [9, 0, 9]], roads, lengths);
    const pick = { attribute: "edgeLength", comparison: "ge", value: 0 };
    const keepAll = await kept(withScatter, pick);
    expect(positionsOf(keepAll)).toContainEqual([9, 0, 9]);
    const dropped = await kept(withScatter, { ...pick, unreferencedPoints: "drop" });
    expect(dropped.primitiveCount).toBe(5);
    expect(positionsOf(dropped)).not.toContainEqual([9, 0, 9]);
  });

  it("splits equal whole: cells filter their own primitives to the same set", async () => {
    // The partition question. Ownership is assigned by first vertex under
    // halfOpen, exactly as connectPoints prescribes; each cell then runs
    // THIS node over what it owns. The union must be the whole-region
    // answer, road for road and value for value, because the test reads a
    // primitive's own column and never its index or its neighbours — a
    // polyline whose points span two cells is emitted whole by the one
    // cell owning its start, so it is compared exactly once.
    const geo = networkWithEdgeLengths(line, roads, lengths);
    const pick = { attribute: "edgeLength", comparison: "gt", value: 1 };
    const whole = await kept(geo, pick);

    const cellOf = async (min: number, max: number) => {
      const owned = firstGeo(
        (
          await runNode(
            filterPrimitivesByBounds,
            { boundsMin: [min, -10, -10], boundsMax: [max, 10, 10], vertex: "first" },
            { in: [makeGeometryItem(geo)] },
          )
        ).out,
      );
      return kept(owned, pick);
    };
    const left = await cellOf(-3, 0);
    const right = await cellOf(0, 3);
    // Concatenated rather than sorted, because the left cell's primitives
    // precede the right cell's in input order and each cell preserves that
    // order: the two cells reproduce the whole-region ORDER, not merely
    // the whole-region set.
    expect([...kindsOf(left), ...kindsOf(right)]).toEqual(kindsOf(whole));
    const lengthsOf = (g: Geometry) => {
      const a = g.attrs.primitive.require("edgeLength");
      return Array.from({ length: g.primitiveCount }, (_, p) => a.get(p));
    };
    expect([...lengthsOf(left), ...lengthsOf(right)]).toEqual(lengthsOf(whole));
  });

  it("is unmoved by the order the points arrived in", async () => {
    // Permuting the cloud permutes nothing the test reads, so the same
    // roads survive in the same order.
    const geo = networkWithEdgeLengths(line, roads, lengths);
    const order = shuffledOrder(line.length, 7);
    const permuted = networkWithEdgeLengths(
      Array.from(order, (i) => line[i]),
      roads.map((pr) => pr.map((p) => order.indexOf(p))),
      lengths,
    );
    const pick = { attribute: "edgeLength", comparison: "ge", value: 3 };
    expect(kindsOf(await kept(permuted, pick))).toEqual(kindsOf(await kept(geo, pick)));
  });

  it("passes a primitive-less input through as an empty result rather than failing", async () => {
    const cloud = cloudAt(line);
    cloud.attrs.primitive.add("edgeLength", "f32", 1, 0);
    const out = await kept(cloud, { attribute: "edgeLength", comparison: "ge", value: 0 });
    expect(out.primitiveCount).toBe(0);
    expect(out.pointCount).toBe(5);
  });

  it("names the node, the attribute, the domain and the way out when the name is a POINT attribute", async () => {
    // The near-miss this node exists to end: the graph that filtered a
    // primitive column after a sampler flattened it onto points.
    const geo = networkWithEdgeLengths(line, roads, lengths);
    const chordPick = geo.attrs.point.add("chordPick", "f32", 1, 0);
    chordPick.set(0, 0.5);
    await expect(kept(geo, { attribute: "chordPick" })).rejects.toThrow(
      /filterPrimitivesByAttribute: primitive attribute "chordPick" not found; available: primtype, roadKind, edgeLength — but "chordPick" IS a f32 POINT attribute here, which is the likeliest mix-up/,
    );
    await expect(kept(geo, { attribute: "chordPick" })).rejects.toThrow(
      /promoteAttribute \(name "chordPick", from "point", to "primitive"\).*filterByAttribute/s,
    );
    // And the mirror, so the pair reads as one idea from either side.
    await expect(
      runNode(filterByAttribute, { attribute: "edgeLength" }, { in: [makeGeometryItem(geo)] }),
    ).rejects.toThrow(
      /filterByAttribute: point attribute "edgeLength" not found;.*IS a f32 PRIMITIVE attribute here.*filterPrimitivesByAttribute/s,
    );
  });

  it("names the param, the value and the way out on every bad param", async () => {
    const geo = networkWithEdgeLengths(line, roads, lengths);
    await expect(kept(geo, { attribute: "nowhere" })).rejects.toThrow(
      /filterPrimitivesByAttribute: primitive attribute "nowhere" not found; available: primtype, roadKind, edgeLength$/,
    );
    await expect(kept(geo, { attribute: "edgeLength", comparison: "GT" })).rejects.toThrow(
      /filterPrimitivesByAttribute: comparison must be one of eq, ne, lt, le, gt, ge, got "GT"/,
    );
    await expect(
      kept(geo, { attribute: "edgeLength", unreferencedPoints: "maybe" }),
    ).rejects.toThrow(
      /filterPrimitivesByAttribute: unreferencedPoints must be "keep" or "drop", got "maybe"/,
    );
    // A vector column is not a decision, on either domain.
    geo.attrs.primitive.add("midpoint", "f32", 3, 0);
    await expect(kept(geo, { attribute: "midpoint" })).rejects.toThrow(
      /filterPrimitivesByAttribute: primitive attribute "midpoint" has tuple size 3 \(f32x3\)/,
    );
  });

  it("diagnoses a dropped topology rather than reporting a missing name", async () => {
    // A filter one node too late reads a primitive domain that a
    // point-removing node emptied, and "not found" alone would send the
    // author looking for a typo.
    const cloud = cloudAt(line);
    await expect(kept(cloud, { attribute: "edgeLength" })).rejects.toThrow(
      /primitive attribute "edgeLength" not found; available: \(none\) — and this geometry has no primitives at all, so either none was ever built .* or a node between the builder and here removed points and the topology went with them/,
    );
  });

  it("refuses an unknown comparison on the point filter too, instead of answering as ge", async () => {
    // It used to fall through the chain and quietly mean "ge".
    const cloud = cloudWith([[0, 0, 0]], { level: [1] });
    await expect(
      runNode(
        filterByAttribute,
        { attribute: "level", comparison: "greaterThan" },
        { in: [makeGeometryItem(cloud)] },
      ),
    ).rejects.toThrow(
      /filterByAttribute: comparison must be one of eq, ne, lt, le, gt, ge, got "greaterThan"/,
    );
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

  it("spells minDistance 0 the same plainly and as a constant field", async () => {
    // The pass-through is a property of the VALUE, so both spellings of
    // the same literal have to reach it. A constant field is a graph
    // literal like any other — it is not data — so honouring it here
    // leaves the invariant it looks like it breaks exactly where it was:
    // no field whose values COULD vary takes this path, and what the
    // output IS still never depends on the numbers that came back.
    const path = networkAt(
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [3, 0, 0],
      ],
      [[0, 1, 2, 3]],
    );
    const run = async (minDistance: number | ReturnType<typeof attribute>): Promise<Geometry> =>
      firstGeo(
        (await runNode(selfPrune, { minDistance } as never, { in: [makeGeometryItem(path)] })).out,
      );
    const plain = await run(0);
    expect([plain.pointCount, plain.vertexCount, plain.primitiveCount]).toEqual([4, 4, 1]);
    expect(snapshotGeometry(await run(constant(0))), "constant field").toEqual(
      snapshotGeometry(plain),
    );
    // A field that could vary still outputs a point cloud, whatever the
    // numbers turn out to be: this one is 0 everywhere and the topology
    // goes anyway, because the shape of the output must not be a
    // function of the data.
    const varying = await run(attribute("seed"));
    expect([varying.pointCount, varying.vertexCount, varying.primitiveCount]).toEqual([4, 0, 0]);
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
  // demos/infinite-world: cooked in cells of 20 and of 40, a greedy
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

// ---------------------------------------------------------------------------
// The field-capable params of this file: nine values read PER ELEMENT
//
// Two assertions per param, and the PAIR is what makes either worth having:
//
//   1. a field produces an answer NO single scalar could, so the column is
//      shown to be read per element rather than once;
//   2. a CONSTANT field equals the plain number exactly, so the extension is
//      shown to be pure — with a CONTROL that differs beside it, so the
//      comparison is demonstrated able to report both answers.
//
// Every constant below is f32-exact (0, ±1, 0.25, 0.5, 2, 2.5, 3, 5): a field
// column is f32, so a bar of 0.1 would disagree with the plain 0.1 for a real
// reason and prove nothing about this code.
//
// The two `filterPrimitives*` nodes carry a third assertion each, because
// their fields land on the PRIMITIVE domain: an attribute of the SAME NAME is
// planted on the point domain with an answer-changing value, so reading the
// wrong domain cannot pass.

describe("filterByDensity.threshold as a field", () => {
  /** Four points with rising density, plus a per-point bar to test against. */
  function bars(values: number[]): ReturnType<typeof createPointCloud> {
    const geo = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
    ]);
    const density = geo.attrs.point.require("density");
    [0.25, 0.5, 0.75, 1].forEach((d, i) => density.set(i, d));
    const bar = geo.attrs.point.add("bar", "f32", 1, 0);
    values.forEach((v, i) => bar.set(i, v));
    return geo;
  }

  const survivors = async (
    geo: ReturnType<typeof createPointCloud>,
    threshold: FilterByDensityParams["threshold"],
  ): Promise<number[]> =>
    positionsOf(
      firstGeo(
        (await runNode(filterByDensity, { threshold }, { in: [makeGeometryItem(geo)] })).out,
      ),
    ).map((p) => p[0]);

  it("tests each point against ITS OWN bar, which no single threshold can", async () => {
    // Densities rise 0.25, 0.5, 0.75, 1 along x; the bars zigzag, so the
    // survivors are the 2nd and 4th points. A plain threshold keeps a
    // SUFFIX of a rising column — it cannot skip the 3rd and keep the 4th.
    const geo = bars([0.5, 0.25, 1, 0.5]);
    expect(await survivors(geo, attribute("bar"))).toEqual([1, 3]);
    for (const t of [0, 0.25, 0.5, 0.75, 1, 1.5]) {
      expect(await survivors(geo, t), `plain ${t}`).not.toEqual([1, 3]);
    }
  });

  it("is the plain number when the field is a constant, and can tell 0.5 from 0.75", async () => {
    const geo = bars([0, 0, 0, 0]);
    const plain = await survivors(geo, 0.5);
    expect(plain).toEqual([1, 2, 3]);
    expect(await survivors(geo, constant(0.5)), "constant field").toEqual(plain);
    // The control: the same comparison run against a different number does
    // report a different answer, so the equality above is not vacuous.
    expect(await survivors(geo, 0.75), "control").not.toEqual(plain);
  });

  it("never evaluates the field in probabilistic mode, where the param is ignored", async () => {
    const geo = bars([0, 0, 0, 0]);
    geo.attrs.point.require("density").fill(1, 0, 4);
    const out = firstGeo(
      (
        await runNode(
          filterByDensity,
          { mode: "probabilistic", threshold: attribute("nope") },
          { in: [makeGeometryItem(geo)] },
        )
      ).out,
    );
    expect(out.pointCount).toBe(4);
    // And the same field really would have thrown had the mode read it —
    // otherwise the pass above is a test of nothing.
    await expect(
      runNode(
        filterByDensity,
        { mode: "threshold", threshold: attribute("nope") },
        { in: [makeGeometryItem(geo)] },
      ),
    ).rejects.toThrow(/"nope"/);
  });
});

describe("filterByBounds bounds as fields", () => {
  /** Four points along x at 0, 1, 2, 3, each carrying its own box floor and ceiling. */
  function withFloors(lo: number[], hi = [10, 10, 10, 10]): ReturnType<typeof createPointCloud> {
    return cloudWith(
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [3, 0, 0],
      ],
      { lo, hi },
    );
  }

  const survivors = async (
    geo: ReturnType<typeof createPointCloud>,
    params: Partial<FilterByBoundsParams>,
  ): Promise<number[]> =>
    positionsOf(
      firstGeo((await runNode(filterByBounds, params, { in: [makeGeometryItem(geo)] })).out),
    ).map((p) => p[0]);

  it("gives each point its own box, which no single box could", async () => {
    // Points 1 and 3 are handed a floor above their own x, so the survivors
    // are 0 and 2 — a gap. One box keeps an INTERVAL of x, so any box
    // holding both 0 and 2 holds 1 as well, which the control shows.
    const geo = withFloors([-1, 5, -1, 5], [10, -5, 10, -5]);
    expect(
      await survivors(geo, {
        boundsMin: vec(attribute("lo"), -1, -1),
        boundsMax: [10, 1, 1],
      }),
      "a per-point floor",
    ).toEqual([0, 2]);
    // The same gap from the other corner: each point's own CEILING, with a
    // plain floor. Both corners are read per point, so both are shown to be.
    expect(
      await survivors(geo, {
        boundsMin: [-1, -1, -1],
        boundsMax: vec(attribute("hi"), 1, 1),
      }),
      "a per-point ceiling",
    ).toEqual([0, 2]);
    expect(
      await survivors(geo, { boundsMin: [0, -1, -1], boundsMax: [2.5, 1, 1] }),
      "the tightest plain box around the survivors",
    ).toEqual([0, 1, 2]);
  });

  it("is the plain box when both corners are constants, and can tell two boxes apart", async () => {
    const geo = withFloors([0, 0, 0, 0]);
    const plain = await survivors(geo, { boundsMin: [0, -1, -1], boundsMax: [2.5, 1, 1] });
    expect(plain).toEqual([0, 1, 2]);
    expect(
      await survivors(geo, { boundsMin: constant([0, -1, -1]), boundsMax: constant([2.5, 1, 1]) }),
      "constant fields",
    ).toEqual(plain);
    // Mixed spellings are legal, and equal too: a field min with a plain max.
    expect(
      await survivors(geo, { boundsMin: constant([0, -1, -1]), boundsMax: [2.5, 1, 1] }),
      "field min, plain max",
    ).toEqual(plain);
    expect(
      await survivors(geo, { boundsMin: constant([1, -1, -1]), boundsMax: constant([2.5, 1, 1]) }),
      "control",
    ).not.toEqual(plain);
  });

  it("reads ±Infinity and NaN from a field rather than refusing them", async () => {
    // These params document an infinite bound as the way to leave an axis
    // unbounded, so the field seam here is the UNGUARDED one. A NaN corner
    // satisfies no comparison, exactly as a NaN coordinate does not.
    const geo = withFloors([0, 0, 0, 0]);
    expect(
      await survivors(geo, {
        boundsMin: constant([-Infinity, -Infinity, -Infinity]),
        boundsMax: constant([Infinity, Infinity, Infinity]),
      }),
    ).toEqual([0, 1, 2, 3]);
    expect(await survivors(geo, { boundsMin: constant([NaN, -1, -1]), boundsMax: [10, 1, 1] })).toEqual(
      [],
    );
    expect(
      await survivors(geo, {
        boundsMin: constant([NaN, -1, -1]),
        boundsMax: [10, 1, 1],
        mode: "outside",
      }),
      "a point that is never inside lands in outside",
    ).toEqual([0, 1, 2, 3]);
  });

  it("broadcasts a scalar field to all three axes, and names the fix for any other width", async () => {
    const geo = withFloors([0, 0, 0, 0]);
    expect(
      await survivors(geo, { boundsMin: constant(-1), boundsMax: [2.5, 1, 1] }),
      "one number, all three axes",
    ).toEqual([0, 1, 2]);
    await expect(
      runNode(
        filterByBounds,
        { boundsMin: constant([0, -1]) },
        { in: [makeGeometryItem(geo)] },
      ),
    ).rejects.toThrow(/boundsMin.*tupleSize 3.*vec\(x, y, z\)/s);
  });
});

describe("filterPrimitivesByBounds bounds as fields", () => {
  /**
   * Three two-vertex roads over four points on the x axis, with the box
   * floor written on the PRIMITIVE domain — and a DIFFERENT column of the
   * same name on the point domain, which reading the wrong domain would
   * pick up.
   */
  function roads(
    primFloors: number[],
    pointFloors: number[],
    primCeilings = [10, 10, 10],
    pointCeilings = [10, 10, 10, 10],
  ): Geometry {
    const geo = networkAt(
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [3, 0, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    );
    const prim = geo.attrs.primitive.add("lo", "f32", 1, 0);
    primFloors.forEach((v, p) => prim.set(p, v));
    const point = geo.attrs.point.add("lo", "f32", 1, 0);
    pointFloors.forEach((v, i) => point.set(i, v));
    const primHi = geo.attrs.primitive.add("hi", "f32", 1, 0);
    primCeilings.forEach((v, p) => primHi.set(p, v));
    const pointHi = geo.attrs.point.add("hi", "f32", 1, 0);
    pointCeilings.forEach((v, i) => pointHi.set(i, v));
    return geo;
  }

  const survivors = async (
    geo: Geometry,
    params: Partial<FilterPrimitivesByBoundsParams>,
  ): Promise<string[]> =>
    kindsOf(
      firstGeo(
        (
          await runNode(
            filterPrimitivesByBounds,
            { vertex: "all", ...params },
            { in: [makeGeometryItem(geo)] },
          )
        ).out,
      ),
    );

  it("gives each PRIMITIVE its own box, read on the primitive domain", async () => {
    // road1 is handed a floor above its own vertices, so roads 0 and 2
    // survive with a gap between them — which no single box can produce,
    // since a box holding road0 and road2 entirely holds road1 too. The
    // point column of the same name would keep nothing at all, so a field
    // resolved on the wrong domain cannot pass this.
    const geo = roads([-1, 5, -1], [5, 5, 5, 5], [10, -5, 10], [-5, -5, -5, -5]);
    expect(
      await survivors(geo, { boundsMin: vec(attribute("lo"), -1, -1), boundsMax: [10, 1, 1] }),
      "a per-primitive floor",
    ).toEqual(["road0", "road2"]);
    // The same gap from the other corner, so both corners are shown to be
    // read per primitive rather than only the min.
    expect(
      await survivors(geo, { boundsMin: [-1, -1, -1], boundsMax: vec(attribute("hi"), 1, 1) }),
      "a per-primitive ceiling",
    ).toEqual(["road0", "road2"]);
    expect(
      await survivors(geo, { boundsMin: [-1, -1, -1], boundsMax: [10, 1, 1] }),
      "the plain box that holds road0 and road2",
    ).toEqual(["road0", "road1", "road2"]);
  });

  it("is the plain box when both corners are constants, and can tell two boxes apart", async () => {
    const geo = roads([0, 0, 0], [0, 0, 0, 0]);
    const plain = await survivors(geo, { boundsMin: [0, -1, -1], boundsMax: [2.5, 1, 1] });
    expect(plain).toEqual(["road0", "road1"]);
    expect(
      await survivors(geo, { boundsMin: constant([0, -1, -1]), boundsMax: constant([2.5, 1, 1]) }),
      "constant fields",
    ).toEqual(plain);
    expect(
      await survivors(geo, { boundsMin: constant([0, -1, -1]), boundsMax: constant([1.5, 1, 1]) }),
      "control",
    ).not.toEqual(plain);
  });
});

describe("filterByAttribute.value as a field", () => {
  /** Three points carrying a rising `level` and a per-point bar to clear. */
  function levels(bar: number[]): ReturnType<typeof createPointCloud> {
    return cloudWith(
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
      { level: [1, 2, 3], bar },
    );
  }

  const survivors = async (
    geo: ReturnType<typeof createPointCloud>,
    value: FilterByAttributeParams["value"],
  ): Promise<number[]> =>
    positionsOf(
      firstGeo(
        (
          await runNode(
            filterByAttribute,
            { attribute: "level", comparison: "ge", value },
            { in: [makeGeometryItem(geo)] },
          )
        ).out,
      ),
    ).map((p) => p[0]);

  it("compares each point against ITS OWN right-hand side, which no single number can", async () => {
    // level rises 1, 2, 3; the bar is high only for the middle point, so
    // the survivors skip it. A plain right-hand side keeps a SUFFIX of a
    // rising column, never a gap — the two controls are the neighbours of
    // the only cut that could have tried.
    const geo = levels([0, 5, 0]);
    expect(await survivors(geo, attribute("bar"))).toEqual([0, 2]);
    for (const v of [0, 1, 2, 3, 4]) {
      expect(await survivors(geo, v), `plain ${v}`).not.toEqual([0, 2]);
    }
  });

  it("is the plain number when the field is a constant, and can tell 2 from 3", async () => {
    const geo = levels([0, 0, 0]);
    const plain = await survivors(geo, 2);
    expect(plain).toEqual([1, 2]);
    expect(await survivors(geo, constant(2)), "constant field").toEqual(plain);
    expect(await survivors(geo, 3), "control").not.toEqual(plain);
  });

  it("never evaluates the field against a STRING attribute, where the param is ignored", async () => {
    const geo = levels([0, 0, 0]);
    const species = geo.attrs.point.add("species", "string", 1, "");
    ["oak", "fir", "oak"].forEach((s, i) => species.setString(i, s));
    const out = firstGeo(
      (
        await runNode(
          filterByAttribute,
          { attribute: "species", comparison: "eq", stringValue: "oak", value: attribute("nope") },
          { in: [makeGeometryItem(geo)] },
        )
      ).out,
    );
    expect(positionsOf(out).map((p) => p[0])).toEqual([0, 2]);
    // The same field against the NUMERIC column does throw, so the pass
    // above is about the string path and not about a field that never fails.
    await expect(survivors(geo, attribute("nope"))).rejects.toThrow(/"nope"/);
  });

  it("refuses a non-finite right-hand side, naming the param", async () => {
    // The GUARDED seam: unlike the bounds params, a comparison's right-hand
    // side has no documented meaning for NaN, so it is a broken expression.
    await expect(survivors(levels([0, 0, 0]), constant(NaN))).rejects.toThrow(
      /filterByAttribute: param "value" resolved to NaN/,
    );
  });
});

describe("filterPrimitivesByAttribute.value as a field", () => {
  /**
   * Three roads with rising edge lengths and a per-primitive limit — plus a
   * `limit` column on the POINT domain that would keep nothing, so reading
   * the wrong domain cannot pass.
   */
  function roads(limits: number[], pointLimits: number[]): Geometry {
    const geo = networkWithEdgeLengths(
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [3, 0, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
      [1, 2, 3],
    );
    const prim = geo.attrs.primitive.add("limit", "f32", 1, 0);
    limits.forEach((v, p) => prim.set(p, v));
    const point = geo.attrs.point.add("limit", "f32", 1, 0);
    pointLimits.forEach((v, i) => point.set(i, v));
    return geo;
  }

  const survivors = async (
    geo: Geometry,
    value: FilterPrimitivesByAttributeParams["value"],
  ): Promise<string[]> =>
    kindsOf(
      firstGeo(
        (
          await runNode(
            filterPrimitivesByAttribute,
            { attribute: "edgeLength", comparison: "le", value },
            { in: [makeGeometryItem(geo)] },
          )
        ).out,
      ),
    );

  it("compares each PRIMITIVE against its own limit, read on the primitive domain", async () => {
    // Lengths rise 1, 2, 3; only the middle road is given a limit under its
    // own length, so the survivors skip it — a gap no single limit produces
    // over a rising column. The point column of the same name is 0
    // everywhere and would keep nothing.
    const geo = roads([5, 0, 5], [0, 0, 0, 0]);
    expect(await survivors(geo, attribute("limit"))).toEqual(["road0", "road2"]);
    for (const v of [0, 1, 2, 3, 4]) {
      expect(await survivors(geo, v), `plain ${v}`).not.toEqual(["road0", "road2"]);
    }
  });

  it("is the plain number when the field is a constant, and can tell 2 from 3", async () => {
    const geo = roads([0, 0, 0], [0, 0, 0, 0]);
    const plain = await survivors(geo, 2);
    expect(plain).toEqual(["road0", "road1"]);
    expect(await survivors(geo, constant(2)), "constant field").toEqual(plain);
    expect(await survivors(geo, 3), "control").not.toEqual(plain);
  });

  it("refuses a non-finite right-hand side, naming the node and the param", async () => {
    await expect(survivors(roads([0, 0, 0], [0, 0, 0, 0]), constant(NaN))).rejects.toThrow(
      /filterPrimitivesByAttribute: param "value" resolved to NaN/,
    );
  });
});

describe("projectToPlane origin and normal as fields", () => {
  /** Two points, each carrying its own plane normal and plane origin. */
  function planes(normals: number[][], origins: number[][]): ReturnType<typeof createPointCloud> {
    const geo = cloudAt([
      [1, 5, 2],
      [3, -1, 4],
    ]);
    const N = geo.attrs.point.add("N", "f32", 3, 0);
    normals.forEach((v, i) => N.setTuple(i, v));
    const O = geo.attrs.point.add("orig", "f32", 3, 0);
    origins.forEach((v, i) => O.setTuple(i, v));
    return geo;
  }

  const projected = async (
    geo: ReturnType<typeof createPointCloud>,
    params: Partial<ProjectToPlaneParams>,
  ): Promise<Geometry> =>
    firstGeo(
      (
        await runNode(
          projectToPlane,
          { keepOffset: true, ...params },
          { in: [makeGeometryItem(geo)] },
        )
      ).out,
    );

  const offsetsOf = (geo: Geometry): number[] => {
    const off = geo.attrs.point.require("planeOffset");
    return Array.from({ length: geo.pointCount }, (_, i) => off.get(i));
  };

  it("projects each point along ITS OWN normal, which one plane cannot", async () => {
    // One point flattens in y and the other in x. A single normal moves
    // every point along the same axis, so no plain vector reproduces this —
    // the control is the y plane, which leaves point 1's x alone.
    const geo = planes(
      [
        [0, 1, 0],
        [1, 0, 0],
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
      ],
    );
    const out = await projected(geo, { normal: attribute("N") });
    expect(positionsOf(out)).toEqual([
      [1, 0, 2],
      [0, -1, 4],
    ]);
    expect(offsetsOf(out)).toEqual([5, 3]);
    expect(positionsOf(await projected(geo, { normal: [0, 1, 0] })), "control").toEqual([
      [1, 0, 2],
      [3, 0, 4],
    ]);
  });

  it("projects each point onto ITS OWN plane origin, which one plane cannot", async () => {
    // Same normal, two different planes: each point lands on the height it
    // was given, which is the per-point offset a terraced flatten needs.
    const geo = planes(
      [
        [0, 1, 0],
        [0, 1, 0],
      ],
      [
        [0, 2, 0],
        [0, -4, 0],
      ],
    );
    const out = await projected(geo, { normal: [0, 1, 0], origin: attribute("orig") });
    expect(positionsOf(out)).toEqual([
      [1, 2, 2],
      [3, -4, 4],
    ]);
    expect(offsetsOf(out)).toEqual([3, 3]);
    expect(positionsOf(await projected(geo, { normal: [0, 1, 0], origin: [0, 2, 0] })), "control").toEqual([
      [1, 2, 2],
      [3, 2, 4],
    ]);
  });

  it("leaves a point whose own normal is zero exactly where it stands", async () => {
    // A field's zero normal is a per-point answer — that point has no plane
    // — where a PLAIN zero is still refused outright, since one plane that
    // does not exist is an authoring mistake with nothing to salvage.
    const geo = planes(
      [
        [0, 1, 0],
        [0, 0, 0],
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
      ],
    );
    const out = await projected(geo, { normal: attribute("N") });
    expect(positionsOf(out)).toEqual([
      [1, 0, 2],
      [3, -1, 4],
    ]);
    // It moved nothing, and says so: offset 0 rather than a hole.
    expect(offsetsOf(out)).toEqual([5, 0]);
    await expect(projected(geo, { normal: [0, 0, 0] })).rejects.toThrow(/non-zero/);
  });

  it("is the plain plane when both are constants, and can tell two planes apart", async () => {
    const geo = planes(
      [
        [0, 1, 0],
        [0, 1, 0],
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
      ],
    );
    const plain = await projected(geo, { normal: [0, 1, 0], origin: [0, 2, 0] });
    expect(
      snapshotGeometry(
        await projected(geo, { normal: constant([0, 1, 0]), origin: constant([0, 2, 0]) }),
      ),
      "constant fields",
    ).toEqual(snapshotGeometry(plain));
    expect(
      snapshotGeometry(await projected(geo, { normal: constant([0, 1, 0]), origin: [0, 2, 0] })),
      "field normal, plain origin",
    ).toEqual(snapshotGeometry(plain));
    expect(
      snapshotGeometry(
        await projected(geo, { normal: constant([1, 0, 0]), origin: constant([0, 2, 0]) }),
      ),
      "control",
    ).not.toEqual(snapshotGeometry(plain));
  });

  it("refuses a non-finite plane, naming the offending param", async () => {
    // The GUARDED seam, and the reason it is guarded: a NaN normal
    // normalizes to NaN and sends every coordinate of that point to NaN,
    // which draws nothing downstream and blames nobody.
    const geo = planes(
      [
        [0, 1, 0],
        [0, 1, 0],
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
      ],
    );
    await expect(projected(geo, { normal: constant([NaN, 1, 0]) })).rejects.toThrow(
      /projectToPlane: param "normal" resolved to NaN/,
    );
    await expect(
      projected(geo, { normal: [0, 1, 0], origin: constant([0, Infinity, 0]) }),
    ).rejects.toThrow(/projectToPlane: param "origin" resolved to \+Infinity/);
  });
});

// ---------------------------------------------------------------------------
// topology "keep": the point filters that leave a network a network
//
// ONE block for all five, because it is one decision shared by five nodes
// (PLAN-filter-topology.md) — a per-node copy of these assertions is how
// the five would drift on what a filtered geometry IS.

/**
 * Seven points on the X axis at x = 0..6, plus a LOOSE eighth at x = 1 that
 * belongs to no primitive, and five primitives chosen so that every arm of
 * the survival rule has a case:
 *
 *   road0 [0,1,2]  every point survives the box below      -> kept
 *   road1 [2,3]    every point survives                    -> kept
 *   road2 [4,5,6]  no point survives                       -> dropped
 *   road3 [3,4]    point 3 survives, point 4 does not      -> DROPPED
 *
 * road3 is the one the rule is actually about: a primitive is dropped for
 * losing ONE point, however many it keeps.
 *
 * No empty primitive here — setPolylineTopology refuses a polyline with
 * fewer than two vertices, so that case needs bare setTopology and gets its
 * own fixture below.
 */
function xNetwork(): Geometry {
  return networkAt(
    [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [4, 0, 0],
      [5, 0, 0],
      [6, 0, 0],
      [1, 0, 0],
    ],
    [[0, 1, 2], [2, 3], [4, 5, 6], [3, 4]],
  );
}

/** The box that keeps x <= 3: points 0, 1, 2, 3 and the loose 7. */
const HALF_BOX = { boundsMin: [-1, -1, -1], boundsMax: [3.5, 1, 1] } as const;

async function boundsFiltered(geo: Geometry, topology: string): Promise<Geometry> {
  return firstGeo(
    (await runNode(filterByBounds, { ...HALF_BOX, topology }, { in: [makeGeometryItem(geo)] })).out,
  );
}

describe('point filters: topology "keep"', () => {
  it('drops every primitive by default, and "drop" says the same thing explicitly', async () => {
    for (const params of [{ ...HALF_BOX }, { ...HALF_BOX, topology: "drop" }]) {
      const out = firstGeo(
        (await runNode(filterByBounds, params, { in: [makeGeometryItem(xNetwork())] })).out,
      );
      expect(out.pointCount).toBe(5);
      expect(out.primitiveCount).toBe(0);
      expect(out.vertexCount).toBe(0);
      // A point cloud has no room for the detail domain either.
      expect(out.attrs.detail.names()).toEqual([]);
    }
  });

  it("keeps only the primitives that lose no point", async () => {
    const out = await boundsFiltered(xNetwork(), "keep");
    expect(kindsOf(out)).toEqual(["road0", "road1"]);
    // road3 kept point 3 and lost point 4, so it is gone: a partially
    // surviving polyline has no truncation that means anything.
    expect(kindsOf(out)).not.toContain("road3");
    expect(primXs(out)).toEqual([
      [0, 1, 2],
      [2, 3],
    ]);
  });

  it("renumbers the topology onto the surviving points", async () => {
    const out = await boundsFiltered(xNetwork(), "keep");
    expect(Array.from(out.vertexToPoint)).toEqual([0, 1, 2, 2, 3]);
    expect(Array.from(out.primVertexStart)).toEqual([0, 3]);
    expect(Array.from(out.primVertexCount)).toEqual([3, 2]);
  });

  it("keeps a primitive with no vertices: it has no point to lose", async () => {
    // Only bare setTopology can build one — setPolylineTopology refuses a
    // polyline under two vertices — and the rule never SHORTENS a primitive,
    // so this can only come out if it went in. filterPrimitivesByBounds
    // writes down the opposite vacuous answer for the same case and the two
    // agree: "where is it" has no answer for a primitive that is nowhere,
    // while "did it lose a point" does.
    const geo = cloudAt([
      [0, 0, 0],
      [9, 0, 0],
    ]);
    geo.setTopology(new Uint32Array([0]), new Uint32Array([0, 1]), new Uint32Array([1, 0]));
    const out = await boundsFiltered(geo, "keep");
    expect(out.pointCount).toBe(1);
    expect(Array.from(out.primVertexCount)).toEqual([1, 0]);
  });

  it("carries the vertex, primitive and detail domains", async () => {
    const out = await boundsFiltered(xNetwork(), "keep");
    // sourceVertex names each vertex's index in the INPUT, so this is the
    // proof that vertex values travelled with the primitive that owns them
    // rather than with a position in the array.
    const sv = out.attrs.vertex.require("sourceVertex");
    expect(Array.from({ length: out.vertexCount }, (_, v) => sv.get(v))).toEqual([0, 1, 2, 3, 4]);
    expect(out.attrs.primitive.require("primtype").getString(0)).toBe("polyline");
    expect(out.attrs.detail.require("region").getString(0)).toBe("north");
  });

  it("emits the same POINT domain under both settings", async () => {
    const geo = xNetwork();
    const dropped = snapshotGeometry(await boundsFiltered(geo, "drop"));
    const kept = snapshotGeometry(await boundsFiltered(geo, "keep"));
    // Same points, same order, same attributes: `topology` only ever ADDS.
    expect(kept.point).toEqual(dropped.point);
    expect(kept.topology).not.toEqual(dropped.topology);
  });

  it("keeps a surviving point that belongs to no primitive", async () => {
    const out = await boundsFiltered(xNetwork(), "keep");
    // Point 7 (x = 1) is in no primitive. gatherPrimitives' "referenced"
    // rule would have dropped it; the explicit selection must not.
    expect(positionsOf(out).map((p) => p[0])).toEqual([0, 1, 2, 3, 1]);
  });

  it("reproduces the input exactly when the predicate keeps every point", async () => {
    const geo = xNetwork();
    const before = snapshotGeometry(geo);
    const out = firstGeo(
      (
        await runNode(
          filterByBounds,
          { boundsMin: [-99, -99, -99], boundsMax: [99, 99, 99], topology: "keep" },
          { in: [makeGeometryItem(geo)] },
        )
      ).out,
    );
    expect(snapshotGeometry(out)).toEqual(before);
  });

  it("outputs an empty topology, not a bare cloud, when the input has none", async () => {
    const out = await boundsFiltered(
      cloudAt([
        [0, 0, 0],
        [9, 0, 0],
      ]),
      "keep",
    );
    // What the output IS depends on the graph, never on the data.
    expect(out.pointCount).toBe(1);
    expect(out.primitiveCount).toBe(0);
    expect(Array.from(out.primVertexStart)).toEqual([]);
  });

  it("is the same decision on all five point filters", async () => {
    const geo = xNetwork();
    const density = geo.attrs.point.require("density");
    const mark = geo.attrs.point.add("mark", "f32", 1, 0);
    const P = geo.attrs.point.require("P");
    for (let i = 0; i < geo.pointCount; i++) {
      // The same survivor set the box picks: x <= 3, plus the loose point.
      const keep = P.get(i, 0) <= 3.5 ? 1 : 0;
      mark.set(i, keep);
      density.set(i, keep);
    }
    const [box, dens, attr, expr, prune] = await Promise.all([
      boundsFiltered(geo, "keep"),
      runNode(
        filterByDensity,
        { mode: "threshold", threshold: 0.5, topology: "keep" },
        { in: [makeGeometryItem(geo)] },
      ).then((r) => firstGeo(r.out)),
      runNode(
        filterByAttribute,
        { attribute: "mark", comparison: "gt", value: 0.5, topology: "keep" },
        { in: [makeGeometryItem(geo)] },
      ).then((r) => firstGeo(r.out)),
      runNode(
        filterByExpression,
        { predicate: attribute("mark"), topology: "keep" },
        { in: [makeGeometryItem(geo)] },
      ).then((r) => firstGeo(r.out)),
      // selfPrune at a radius nothing can violate keeps the whole cloud, so
      // every primitive must come back — including road4.
      runNode(
        selfPrune,
        { minDistance: 0.0001, topology: "keep" },
        { in: [makeGeometryItem(geo)] },
      ).then((r) => firstGeo(r.out)),
    ]);
    for (const out of [dens, attr, expr]) expect(kindsOf(out)).toEqual(kindsOf(box));
    expect(kindsOf(box)).toEqual(["road0", "road1"]);
    expect(kindsOf(prune)).toEqual(["road0", "road1", "road2", "road3"]);
  });

  it("refuses a misspelled value on every one of the five, naming the node", async () => {
    const cases: [string, Promise<unknown>][] = [
      ["filterByBounds", runNode(filterByBounds, { topology: "Keep" }, item())],
      ["filterByDensity", runNode(filterByDensity, { topology: "Keep" }, item())],
      ["filterByAttribute", runNode(filterByAttribute, { topology: "Keep" }, item())],
      ["filterByExpression", runNode(filterByExpression, { topology: "Keep" }, item())],
      // selfPrune checks ABOVE its own off-switch, so a typo is still an
      // error at a minDistance that would have passed the input through.
      ["selfPrune", runNode(selfPrune, { minDistance: 0, topology: "Keep" }, item())],
    ];
    for (const [who, ran] of cases) {
      await expect(ran).rejects.toThrow(
        new RegExp(
          `^${who}: topology must be "drop" or "keep", got "Keep"; .*loses one point is dropped whole`,
          "s",
        ),
      );
    }
  });

  it("refuses a primitive selection the point selection cannot support", () => {
    // The precondition of gatherPrimitives' explicit point rule. No shipped
    // caller can reach it — the filters select the primitives from the same
    // survivor mask — which is exactly why it is tested directly: without
    // the guard the stale index passes setTopology's bounds check and names
    // the WRONG point, silently.
    expect(() => gatherPrimitives(xNetwork(), [3], [0, 1, 2, 3, 7])).toThrow(
      /gatherPrimitives: source primitive 3 references point 4, which is not in the explicit point selection/,
    );
  });

  it("refuses a point selection that names a point twice", () => {
    // The other half of the same precondition: a repeated index would win
    // with its LAST slot and every vertex naming that point would land on a
    // copy the caller did not mean — silently, since the count still adds up.
    expect(() => gatherPrimitives(xNetwork(), [0], [0, 1, 1, 2])).toThrow(
      /gatherPrimitives: point 1 appears more than once in the explicit point selection \(at indices 1 and 2\)/,
    );
  });
});

/** A fresh single-geometry input pin over {@link xNetwork}. */
function item(): { in: ReturnType<typeof makeGeometryItem>[] } {
  return { in: [makeGeometryItem(xNetwork())] };
}

describe("a constant field is f32, and the plain param is not", () => {
  // NOT a defect, and pinned so nobody "fixes" it into a promise the
  // format cannot keep. A field resolves into an f32 COLUMN; a plain
  // param stays the f64 the author wrote. `constant(0.7)` is therefore
  // 0.699999988079071, and a datum sitting between the two lands on
  // different sides of them. This is clause 1 of the capability rule —
  // "the column is f32" — showing through at the one place it is
  // observable, and it is why every equivalence test in this file uses
  // an f32-exact bar on purpose.
  const keptAt = async (threshold: unknown): Promise<number[]> => {
    const cloud = cloudAt([[0, 0, 0]]);
    // Exactly the f32 value `constant(0.7)` resolves to, which is BELOW
    // the f64 0.7 — so the plain bar rejects it and the field bar keeps it.
    cloud.attrs.point.require("density").set(0, Math.fround(0.7));
    const geo = firstGeo(
      (
        await runNode(filterByDensity, { mode: "threshold", threshold } as never, {
          in: [makeGeometryItem(cloud)],
        })
      ).out,
    );
    return positionsOf(geo).map((p) => p[0]);
  };

  it("differs from the plain number at an f32-INEXACT bar", async () => {
    expect(Math.fround(0.7)).not.toBe(0.7);
    expect(await keptAt(0.7)).toEqual([]);
    expect(await keptAt(constant(0.7))).toEqual([0]);
  });

  it("agrees with it at an f32-exact bar, which is why the others use one", async () => {
    // CONTROL for the test above: the divergence is the literal's, not
    // the field path's, so an exactly-representable bar must agree.
    expect(await keptAt(0.5)).toEqual([0]);
    expect(await keptAt(constant(0.5))).toEqual([0]);
  });
});
