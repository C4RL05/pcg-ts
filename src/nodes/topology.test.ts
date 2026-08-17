import { describe, expect, it } from "vitest";
import { createPointCloud, setPolylineTopology, type Geometry } from "../data/index.js";
import { primitiveIdentities } from "../data/identity.js";
import { attribute, constant } from "../fields/index.js";
import { Graph, cook, makeGeometryItem, type NodeHandle } from "../graph/index.js";
import { dataInput, type DataInputParams } from "../runtime/index.js";
import {
  connectPoints,
  deserializeGraph,
  filterByBounds,
  filterPrimitivesByBounds,
  serializeGraph,
} from "./index.js";
import {
  firstGeo,
  permutePoints,
  runNode,
  shuffledOrder,
  snapshotGeometry,
} from "./nodes.testsupport.js";
import { gatherPoints } from "./util.js";

// ---------------------------------------------------------------------------
// Fixtures and readers

/**
 * A cloud at the given positions. Seeds are derived from the POSITION, not
 * from the array index, so a reordered cloud is the same set of points —
 * an index-derived seed would change every point's identity under a
 * shuffle and make the permutation cases test nothing.
 */
function cloud(points: readonly (readonly number[])[]): Geometry {
  const geo = createPointCloud(points.length);
  const P = geo.attrs.point.require("P");
  const seed = geo.attrs.point.require("seed");
  points.forEach((p, i) => {
    P.setTuple(i, [p[0], p[1], p[2]]);
    seed.set(i, ((Math.imul(p[0] * 1000 + 7, 2654435761) ^ (p[2] * 1000 + 13)) >>> 0) % 65521);
  });
  return geo;
}

/** Deterministic PRNG (never Math.random). */
function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A pseudo-random cloud on a lattice, so knife-edge distances are common. */
function latticeCloud(n: number, seed: number, step: number, span = 12): Geometry {
  const rnd = lcg(seed);
  const seen = new Set<string>();
  const pts: number[][] = [];
  while (pts.length < n) {
    const p = [
      Math.round(rnd() * span - span / 2) * step,
      0,
      Math.round(rnd() * span - span / 2) * step,
    ];
    const key = p.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    pts.push(p);
  }
  return cloud(pts);
}

/** Edges as pairs of point indices, in primitive order. */
function edgeIndices(geo: Geometry): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let p = 0; p < geo.primitiveCount; p++) {
    const s = geo.primVertexStart[p];
    expect(geo.primVertexCount[p]).toBe(2);
    out.push([geo.vertexToPoint[s], geo.vertexToPoint[s + 1]]);
  }
  return out;
}

/**
 * Edges named by POSITION rather than by index, in primitive order, with
 * the first vertex first. This is the form that survives a reordering and
 * a repartitioning, so it is what every equivalence below compares.
 */
function edgeKeys(geo: Geometry): string[] {
  const P = geo.attrs.point.require("P");
  const at = (i: number) => `${P.get(i, 0)},${P.get(i, 1)},${P.get(i, 2)}`;
  return edgeIndices(geo).map(([a, b]) => `${at(a)}->${at(b)}`);
}

/** Run connectPoints and return the output geometry. */
async function connect(
  geo: Geometry,
  params: Partial<{ mode: string; radius: unknown; degreeAttr: string; lengthAttr: string }>,
): Promise<Geometry> {
  const out = await runNode(connectPoints, params, { in: [makeGeometryItem(geo)] });
  return firstGeo(out.out);
}

// ---------------------------------------------------------------------------
// The edge set

describe("connectPoints radius mode", () => {
  it("emits one 2-vertex polyline per pair, over the SAME points", async () => {
    const square = cloud([
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, 1],
      [1, 0, 1],
    ]);
    const wide = await connect(square, { radius: 1.5 }); // sides and diagonals
    expect(wide.pointCount).toBe(4);
    expect(wide.primitiveCount).toBe(6);
    expect(wide.vertexCount).toBe(12);
    expect(wide.attrs.primitive.require("primtype").getString(0)).toBe("polyline");
    // Point attributes survive untouched — this is the same cloud.
    expect(wide.attrs.point.names()).toEqual(square.attrs.point.names());

    const sides = await connect(square, { radius: 1.1 }); // no diagonals (1.414)
    expect(sides.primitiveCount).toBe(4);
    // A junction really is one point: each corner carries two edges.
    const touched = new Map<number, number>();
    for (const [a, b] of edgeIndices(sides)) {
      touched.set(a, (touched.get(a) ?? 0) + 1);
      touched.set(b, (touched.get(b) ?? 0) + 1);
    }
    expect([...touched.values()]).toEqual([2, 2, 2, 2]);
  });

  it("replaces any topology the input arrived with", async () => {
    const geo = cloud([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    setPolylineTopology(geo, [0, 1, 2], [0], [3]);
    geo.attrs.primitive.add("roadKind", "string", 1, "dirt");
    const out = await connect(geo, { radius: 1.5 });
    expect(out.primitiveCount).toBe(2);
    expect(out.attrs.primitive.names()).toEqual(["primtype"]);
  });

  it("connects nothing at radius 0, and survives 0 and 1 point", async () => {
    for (const geo of [cloud([]), cloud([[0, 0, 0]]), cloud([[0, 0, 0], [1, 0, 0]])]) {
      const none = await connect(geo, { radius: 0 });
      expect(none.primitiveCount).toBe(0);
      expect(none.vertexCount).toBe(0);
      expect(none.pointCount).toBe(geo.pointCount);
    }
  });

  it("refuses an unknown mode and a radius that is not a finite number >= 0", async () => {
    const geo = cloud([[0, 0, 0]]);
    await expect(connect(geo, { mode: "nearest" })).rejects.toThrow(
      /connectPoints: unknown mode "nearest"; valid modes: radius, relativeNeighborhood/,
    );
    for (const bad of [-1, NaN, Number.POSITIVE_INFINITY]) {
      await expect(connect(geo, { radius: bad })).rejects.toThrow(
        /connectPoints: radius must be a finite number >= 0/,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The STRICT predicate, and what it buys

describe("connectPoints uses a STRICT distance test", () => {
  it("does not connect a pair at exactly the radius, and does one step closer", async () => {
    const exact = cloud([
      [0, 0, 0],
      [2, 0, 0],
    ]);
    expect((await connect(exact, { radius: 2 })).primitiveCount).toBe(0);
    const just = cloud([
      [0, 0, 0],
      [Math.fround(2 - 2 ** -20), 0, 0],
    ]);
    expect((await connect(just, { radius: 2 })).primitiveCount).toBe(1);
  });

  /**
   * THE KNIFE EDGE, and the reason the predicate is strict rather than
   * inclusive.
   *
   * A partitioned cook widens a rectangle by the radius to build its halo,
   * and clips that halo half-open — so a point sitting exactly on the
   * halo's far face is NOT in the window. The only pair that face can cut
   * is one at EXACTLY the radius. Under the inclusive test `d <= radius`
   * that pair is an edge of the whole cloud, and the window that owns its
   * first endpoint cannot see the other one: the edge is silently lost.
   * Under the strict test it is not an edge in either cook, so the two
   * agree by construction, whatever ownership rule the caller uses on the
   * rectangle's own faces.
   *
   * Both halves are asserted here: the inclusive reference DOES lose the
   * edge (so the case is real, not hypothetical), and the node does not.
   */
  it("keeps a window and the whole cloud in agreement where the inclusive test cannot", async () => {
    const radius = 2;
    const hi = 10;
    const points = [
      [6, 0, 0],
      [8, 0, 0],
      [hi, 0, 0], // exactly on the rectangle's far face
      [hi + radius, 0, 0], // exactly on the HALO's far face: excluded from it
    ];
    const whole = cloud(points);
    // The window: everything with x < hi + radius, half-open, as
    // filterByBounds' default boundary would clip it.
    const windowed = cloud(points.filter((p) => p[0] < hi + radius));

    // The inclusive reference: every pair with d <= radius.
    const inclusive = (pts: readonly (readonly number[])[]) => {
      const out: string[] = [];
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[j][0] - pts[i][0];
          if (dx * dx <= radius * radius) out.push(`${pts[i][0]}-${pts[j][0]}`);
        }
      return out;
    };
    expect(inclusive(points)).toContain(`${hi}-${hi + radius}`);
    expect(inclusive(points.filter((p) => p[0] < hi + radius))).not.toContain(
      `${hi}-${hi + radius}`,
    );

    // The node: the pair at exactly the radius is nobody's edge, so the
    // window and the whole cloud agree about every edge the window can own.
    const wholeEdges = edgeKeys(await connect(whole, { radius }));
    const windowEdges = edgeKeys(await connect(windowed, { radius }));
    expect(wholeEdges).toEqual(windowEdges);
    expect(wholeEdges).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Kind 1: permutation equivariance

describe("connectPoints is indifferent to the order its points arrive in", () => {
  it("emits the same edges, in the same order, after a shuffle", async () => {
    const geo = latticeCloud(60, 5, 0.5);
    const shuffled = permutePoints(geo, shuffledOrder(geo.pointCount, 99));
    const a = await connect(geo, { radius: 1.2, degreeAttr: "degree" });
    const b = await connect(shuffled, { radius: 1.2, degreeAttr: "degree" });
    expect(b.primitiveCount).toBe(a.primitiveCount);
    expect(a.primitiveCount).toBeGreaterThan(40);
    // Same edges, same orientation, same primitive order — as a SEQUENCE,
    // not a set: the canonical order is a property of the points.
    expect(edgeKeys(b)).toEqual(edgeKeys(a));

    // The case is not vacuous: the raw index pairs really did move.
    expect(edgeIndices(b)).not.toEqual(edgeIndices(a));

    // Degrees travel with their points.
    const degreeAt = (g: Geometry) => {
      const P = g.attrs.point.require("P");
      const d = g.attrs.point.require("degree");
      const map = new Map<string, number>();
      for (let i = 0; i < g.pointCount; i++) {
        map.set(`${P.get(i, 0)},${P.get(i, 2)}`, d.get(i));
      }
      return [...map.entries()].sort();
    };
    expect(degreeAt(b)).toEqual(degreeAt(a));
  });

  it("holds for relativeNeighborhood too", async () => {
    const geo = latticeCloud(80, 12, 0.25);
    const shuffled = permutePoints(geo, shuffledOrder(geo.pointCount, 4242));
    const a = await connect(geo, { mode: "relativeNeighborhood", radius: 2 });
    const b = await connect(shuffled, { mode: "relativeNeighborhood", radius: 2 });
    expect(a.primitiveCount).toBeGreaterThan(30);
    expect(edgeKeys(b)).toEqual(edgeKeys(a));
  });
});

// ---------------------------------------------------------------------------
// Kinds 2 and 3: split-with-halo equals whole, and seam agreement
//
// The node-level equivalents of `tests/crossPartition.test.ts`. A window
// is a half-open rectangle on X; its halo is that rectangle widened by
// `haloWidth` and clipped half-open, which is what filterByBounds' default
// boundary produces. A window emits an edge exactly when it owns the
// edge's FIRST vertex, under the same half-open rule.

interface Window {
  readonly lo: number;
  readonly hi: number;
}

/** Points of `geo` inside the half-open interval [lo, hi) on X. */
function clipX(geo: Geometry, lo: number, hi: number): Geometry {
  const P = geo.attrs.point.require("P");
  const keep: number[] = [];
  for (let i = 0; i < geo.pointCount; i++) {
    const x = P.get(i, 0);
    if (x >= lo && x < hi) keep.push(i);
  }
  return gatherPoints(geo, keep);
}

/** Cook each window with its halo and keep the edges it owns. */
async function cookWindows(
  geo: Geometry,
  windows: readonly Window[],
  haloWidth: number,
  params: Partial<{ mode: string; radius: number }>,
): Promise<string[]> {
  const out: string[] = [];
  for (const w of windows) {
    const halo = clipX(geo, w.lo - haloWidth, w.hi + haloWidth);
    const cooked = await connect(halo, params);
    const P = cooked.attrs.point.require("P");
    for (let p = 0; p < cooked.primitiveCount; p++) {
      const s = cooked.primVertexStart[p];
      const a = cooked.vertexToPoint[s];
      const b = cooked.vertexToPoint[s + 1];
      const ax = P.get(a, 0);
      if (!(ax >= w.lo && ax < w.hi)) continue; // owned by another window
      out.push(
        `${P.get(a, 0)},${P.get(a, 1)},${P.get(a, 2)}->${P.get(b, 0)},${P.get(b, 1)},${P.get(b, 2)}`,
      );
    }
  }
  return out;
}

/**
 * The edges of `whole` that `windows` can actually own — those whose FIRST
 * vertex lands in one of them — sorted. The cloud is wider than the windows
 * tile, and an edge outside them is nobody's business.
 *
 * This is a COMPUTED filter over the node's own output, not a spelled-out
 * expectation: it narrows WHICH edges the comparison covers, it never says
 * what any of them should be. The edges themselves still have to match a
 * separately produced cook.
 */
function ownedEdges(
  geo: Geometry,
  whole: readonly string[],
  windows: readonly Window[],
): string[] {
  const P = geo.attrs.point.require("P");
  const ownedByAny = new Set<string>();
  for (let i = 0; i < geo.pointCount; i++) {
    const x = P.get(i, 0);
    if (windows.some((w) => x >= w.lo && x < w.hi)) {
      ownedByAny.add(`${P.get(i, 0)},${P.get(i, 1)},${P.get(i, 2)}`);
    }
  }
  return whole.filter((k) => ownedByAny.has(k.split("->")[0])).sort();
}

// The fixture the two partitioned-cook blocks below SHARE. The second block
// is meant to be the node-level equivalent of the first — the same recipe
// expressed as a graph rather than in TypeScript — so it has to run over the
// same cloud, radius and windows. If the two drifted apart, the equivalence
// they exist to claim would quietly stop being tested.

const partitionRadius = 1;

/**
 * Cell faces land ON lattice points and the halo faces land on them too, so
 * the boundary cases the property has to survive are dense here rather than
 * accidental.
 */
const partitionWindows: readonly Window[] = [
  { lo: -3, hi: -1 },
  { lo: -1, hi: 1 },
  { lo: 1, hi: 3 },
  { lo: 3, hi: 5 },
];

/** A fresh cloud per call, as each of these cases built for itself. */
const partitionCloud = (): Geometry => latticeCloud(120, 77, 0.5, 16);

describe("connectPoints is halo-exact at haloWidth >= radius", () => {
  for (const mode of ["radius", "relativeNeighborhood"]) {
    it(`split with halo equals whole (${mode})`, async () => {
      const geo = partitionCloud();
      const radius = partitionRadius;
      const whole = edgeKeys(await connect(geo, { mode, radius }));
      expect(whole.length).toBeGreaterThan(60);
      const expected = ownedEdges(geo, whole, partitionWindows);
      expect(expected.length).toBeGreaterThan(20);

      const split = (await cookWindows(geo, partitionWindows, radius, { mode, radius })).sort();
      expect(split).toEqual(expected);
      // Every edge exactly once — the seam claims nothing twice.
      expect(new Set(split).size).toBe(split.length);
    });
  }

  it("a halo narrower than the radius loses edges (the negative control)", async () => {
    // 0.25 is the widest halo this lattice can actually break under: at 0.5
    // the only pairs a narrower window could cut are exactly `radius` apart,
    // and the strict predicate already refuses those.
    const geo = partitionCloud();
    const radius = partitionRadius;
    const whole = edgeKeys(await connect(geo, { radius }));
    const expected = ownedEdges(geo, whole, partitionWindows);
    const narrow = (await cookWindows(geo, partitionWindows, radius * 0.25, { radius })).sort();
    expect(narrow).not.toEqual(expected);
    expect(narrow.length).toBeLessThan(expected.length);
  });

  it("two cells sharing one seam claim every edge exactly once", async () => {
    // Points straddling x = 0, including a pair whose endpoints sit exactly
    // on the seam and on the halo face.
    const geo = cloud([
      [-1.5, 0, 0],
      [-1, 0, 0],
      [-0.5, 0, 0],
      [0, 0, 0], // exactly on the seam: owned by the right cell
      [0.5, 0, 0],
      [1, 0, 0],
      [1.5, 0, 0],
      [-0.5, 0, 0.5],
      [0.5, 0, -0.5],
    ]);
    const seam: Window[] = [
      { lo: -2, hi: 0 },
      { lo: 0, hi: 2 },
    ];
    const whole = edgeKeys(await connect(geo, { radius: 1 })).sort();
    const split = (await cookWindows(geo, seam, 1, { radius: 1 })).sort();
    expect(split).toEqual(whole);
    expect(new Set(split).size).toBe(split.length);
  });
});

// ---------------------------------------------------------------------------
// The relative-neighbourhood mode

describe("connectPoints relativeNeighborhood", () => {
  it("drops an edge whose midpoint region holds a third point", async () => {
    const line = cloud([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    const all = await connect(line, { radius: 3 });
    expect(all.primitiveCount).toBe(3);
    const rng = await connect(line, { mode: "relativeNeighborhood", radius: 3 });
    // The (0, 2) span goes: point 1 is closer to BOTH of its endpoints.
    expect(edgeIndices(rng).map(([a, b]) => `${a}-${b}`).sort()).toEqual(["0-1", "1-2"]);
  });

  it("leaves cycles: a square keeps its four sides and drops both diagonals", async () => {
    // The property that makes this a NETWORK rather than a tree. Each side
    // survives because the far corners sit at exactly the side length from
    // one of its endpoints, and the witness test is strict; each diagonal
    // goes because a corner is strictly closer to both of its ends.
    const square = cloud([
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, 1],
      [1, 0, 1],
    ]);
    const rng = await connect(square, { mode: "relativeNeighborhood", radius: 2 });
    expect(rng.primitiveCount).toBe(4); // 4 edges over 4 points: a cycle
    const spans = edgeIndices(rng)
      .map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`)
      .sort();
    expect(spans).toEqual(["0-1", "0-2", "1-3", "2-3"]);
  });

  it("is a subset of the radius network and keeps it just as connected", async () => {
    const geo = latticeCloud(150, 314, 0.25, 20);
    const radius = 2;
    const full = await connect(geo, { radius });
    const rng = await connect(geo, { mode: "relativeNeighborhood", radius });
    const fullSet = new Set(edgeKeys(full));
    for (const key of edgeKeys(rng)) expect(fullSet.has(key)).toBe(true);
    expect(rng.primitiveCount).toBeLessThan(full.primitiveCount);

    // It CONTAINS a minimum spanning tree of the radius network, so it can
    // never disconnect what the radius reached. Counting components is the
    // observable form of that.
    const components = (g: Geometry): number => {
      const parent = Array.from({ length: g.pointCount }, (_, i) => i);
      const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      for (const [a, b] of edgeIndices(g)) parent[find(a)] = find(b);
      return new Set(Array.from({ length: g.pointCount }, (_, i) => find(i))).size;
    };
    expect(components(rng)).toBe(components(full));
  });
});

// ---------------------------------------------------------------------------
// Reporting slots

describe("connectPoints reporting slots", () => {
  it("writes per-point degree and per-edge length", async () => {
    const geo = cloud([
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [9, 0, 9],
    ]);
    const out = await connect(geo, { radius: 1.1, degreeAttr: "degree", lengthAttr: "edgeLength" });
    const degree = out.attrs.point.require("degree");
    expect(degree.type).toBe("u32");
    expect([0, 1, 2, 3].map((i) => degree.get(i))).toEqual([1, 2, 1, 0]);
    const length = out.attrs.primitive.require("edgeLength");
    expect(length.type).toBe("f32");
    expect(out.primitiveCount).toBe(2);
    for (let p = 0; p < out.primitiveCount; p++) expect(length.get(p)).toBeCloseTo(1, 6);
  });

  /**
   * The VALUE of `lengthAttr`, on a fixture that can actually see it.
   *
   * The case above pins nothing: its two edges are both exactly 1 long,
   * and 1 is a FIXED POINT of squaring, of halving-and-doubling, and of
   * every other plausible slip in a one-line distance expression — so
   * emitting `d2` in place of `sqrt(d2)` passed it, and passed the whole
   * suite (the corpus golden stores counts, attribute names and POINT
   * bounds, never a primitive attribute's values). A length fixture has
   * to avoid 0 and 1 for the same reason a scale fixture does.
   *
   * These three lengths are 1.2, 1.5 and sqrt(3.69) = 1.9209...: none of
   * them 0 or 1, none of them equal to its own square, one of them
   * irrational so a missing square root cannot coincide with a rounding
   * tolerance. Expected values are written out as literals rather than
   * recomputed from the output's own positions, which would only restate
   * whatever the node did.
   */
  it("measures each edge's LENGTH, not its square", async () => {
    const geo = cloud([
      [0, 0, 0],
      [1.5, 0, 0],
      [0, 0, 1.2],
    ]);
    const out = await connect(geo, { radius: 2, lengthAttr: "edgeLength" });
    expect(out.primitiveCount).toBe(3);
    const P = out.attrs.point.require("P");
    const length = out.attrs.primitive.require("edgeLength");
    // Keyed by the endpoints' positions, because the edges come out in the
    // canonical order and not in the order the fixture lists its points.
    const at = (i: number) => `${P.get(i, 0).toFixed(3)}/${P.get(i, 2).toFixed(3)}`;
    const byEndpoints = new Map<string, number>();
    for (const [p, [a, b]] of edgeIndices(out).entries()) {
      byEndpoints.set([at(a), at(b)].sort().join(" "), length.get(p));
    }
    expect([...byEndpoints.keys()].sort()).toEqual([
      "0.000/0.000 0.000/1.200",
      "0.000/0.000 1.500/0.000",
      "0.000/1.200 1.500/0.000",
    ]);
    expect(byEndpoints.get("0.000/0.000 0.000/1.200")).toBeCloseTo(1.2, 5);
    expect(byEndpoints.get("0.000/0.000 1.500/0.000")).toBeCloseTo(1.5, 5);
    // sqrt(1.5^2 + 1.2^2) = sqrt(3.69), and 3.69 is what the squared form
    // would write here.
    expect(byEndpoints.get("0.000/1.200 1.500/0.000")).toBeCloseTo(1.920937, 5);
  });

  it("refuses a degreeAttr that would delete a differently shaped column", async () => {
    const geo = cloud([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    await expect(connect(geo, { radius: 2, degreeAttr: "P" })).rejects.toThrow(
      /connectPoints: degreeAttr "P" already exists on the input's point domain as f32x3.*DELETE/s,
    );
    // A same-shape column is reused and reset, so re-running is ordinary.
    const once = await connect(geo, { radius: 2, degreeAttr: "degree" });
    const twice = await connect(once, { radius: 2, degreeAttr: "degree" });
    expect(twice.attrs.point.require("degree").get(0)).toBe(1);
  });

  it("refuses a lengthAttr that would delete the primitive type column", async () => {
    const geo = cloud([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    await expect(connect(geo, { radius: 2, lengthAttr: "primtype" })).rejects.toThrow(
      /connectPoints: lengthAttr "primtype" is the string attribute that marks these primitives as polylines/,
    );
  });
});

// ---------------------------------------------------------------------------
// The edge ceiling

describe("connectPoints edge limit", () => {
  it("refuses a radius that would build more edges than the ceiling, with the numbers", async () => {
    // 1500 points inside one radius: 1,124,250 pairs against a 1,048,576
    // ceiling. The guard fires DURING the scan, so this never allocates the
    // whole relation.
    const rnd = lcg(7);
    const pts: number[][] = [];
    for (let i = 0; i < 1500; i++) pts.push([rnd(), rnd(), rnd()]);
    await expect(connect(cloud(pts), { radius: 10 })).rejects.toThrow(
      /connectPoints: radius 10 connects more than 1048576 pairs over 1500 points/,
    );
    await expect(connect(cloud(pts), { radius: 10 })).rejects.toThrow(
      /Lower `radius`.*relativeNeighborhood' does NOT help/s,
    );
  });
});

// ---------------------------------------------------------------------------
// Determinism and graph plumbing

describe("connectPoints in a graph", () => {
  const buildGraph = (): { graph: Graph; geo: Geometry } => {
    const geo = latticeCloud(70, 19, 0.5);
    const graph = new Graph(4242);
    const input = graph.add(dataInput, { items: [makeGeometryItem(geo)] }, "in");
    const edges = graph.add(
      connectPoints,
      { radius: 1.25, degreeAttr: "degree", lengthAttr: "edgeLength" },
      "edges",
    );
    graph.connect(input, "out", edges, "in");
    graph.output(edges, "out", "network");
    return { graph, geo };
  };

  it("two fresh cooks are byte-identical, and a re-cook serves the cache", async () => {
    const a = await cook(buildGraph().graph);
    const b = await cook(buildGraph().graph);
    const geoA = firstGeo(a.outputs.network);
    expect(geoA.primitiveCount).toBeGreaterThan(40);
    expect(snapshotGeometry(geoA)).toEqual(snapshotGeometry(firstGeo(b.outputs.network)));

    const g = buildGraph().graph;
    await cook(g);
    const again = await cook(g);
    expect(again.stats.cooked).toBe(0);
  });

  it("survives a serialization round trip", async () => {
    const graph = new Graph();
    graph.add(connectPoints, { mode: "relativeNeighborhood", radius: 3 }, "edges");
    const round = deserializeGraph(serializeGraph(graph));
    const cooked = await cook(round);
    expect(cooked.stats.cooked).toBeGreaterThanOrEqual(0);
    expect(serializeGraph(round).nodes[0].params).toMatchObject({
      mode: "relativeNeighborhood",
      radius: 3,
    });
  });
});

// ---------------------------------------------------------------------------
// The partitioned network cook, as a GRAPH
//
// `cookWindows` above proves the halo property, but it performs the last
// step of the recipe — keep the primitives this cell owns — in TypeScript,
// because for a while no node could. That made the recipe this node's
// description prescribes unreachable from a serialized graph: every filter
// in the library rebuilds the point domain and drops the topology with it.
// filterPrimitivesByBounds is the missing step, and this is the proof that
// the whole recipe now fits in nodes.

describe("the partitioned network cook is expressible entirely in nodes", () => {
  /**
   * One cell of the recipe as a standalone graph:
   *
   *   dataInput -> filterByBounds (rectangle WIDENED by the radius, halfOpen)
   *             -> connectPoints
   *             -> filterPrimitivesByBounds (UNWIDENED rectangle, halfOpen,
   *                                          on the edge's FIRST vertex)
   *
   * Serialized and rebuilt from JSON before it cooks, so what runs is the
   * graph a file could hold rather than the objects this test built. Only
   * the live input items are re-bound afterwards — they are what dataInput
   * exists to inject and the one thing JSON cannot carry.
   *
   * The Y and Z bounds are finite rather than the ±Infinity the params
   * document, for the same reason: an infinity does not survive JSON.
   */
  async function cookCell(
    geo: Geometry,
    w: Window,
    radius: number,
    unreferencedPoints = "keep",
  ): Promise<Geometry> {
    const FAR = 1e6;
    const graph = new Graph(4242);
    const input = graph.add(dataInput, undefined, "in");
    const halo = graph.add(
      filterByBounds,
      {
        boundsMin: [w.lo - radius, -FAR, -FAR],
        boundsMax: [w.hi + radius, FAR, FAR],
        boundary: "halfOpen",
      },
      "halo",
    );
    const edges = graph.add(connectPoints, { radius }, "edges");
    const owned = graph.add(
      filterPrimitivesByBounds,
      {
        boundsMin: [w.lo, -FAR, -FAR],
        boundsMax: [w.hi, FAR, FAR],
        vertex: "first",
        boundary: "halfOpen",
        unreferencedPoints,
      },
      "owned",
    );
    graph.connect(input, "out", halo, "in");
    graph.connect(halo, "out", edges, "in");
    graph.connect(edges, "out", owned, "in");
    graph.output(owned, "out", "cell");

    const rebuilt = deserializeGraph(JSON.parse(JSON.stringify(serializeGraph(graph))));
    rebuilt.setParam({ id: "in" } as NodeHandle<DataInputParams>, "items", [
      makeGeometryItem(geo),
    ]);
    return firstGeo((await cook(rebuilt)).outputs.cell);
  }

  it("tiles the whole-region network exactly, with no host-side clip", async () => {
    const geo = partitionCloud();
    const whole = edgeKeys(await connect(geo, { radius: partitionRadius }));
    expect(whole.length).toBeGreaterThan(60);

    const expected = ownedEdges(geo, whole, partitionWindows);
    expect(expected.length).toBeGreaterThan(20);

    const split: string[] = [];
    for (const w of partitionWindows) {
      split.push(...edgeKeys(await cookCell(geo, w, partitionRadius)));
    }
    expect(split.slice().sort()).toEqual(expected);
    // Every edge exactly once: no seam claims one twice, none drops one.
    expect(new Set(split).size).toBe(split.length);
  });

  it("hands each cell a real network, not a cloud", async () => {
    const geo = partitionCloud();
    const cell = await cookCell(geo, partitionWindows[1], partitionRadius);
    // The output is still a network — primitives, vertices and the
    // primtype column — which is exactly what every point-domain filter
    // destroys and what this step had to preserve.
    expect(cell.primitiveCount).toBeGreaterThan(5);
    expect(cell.vertexCount).toBe(cell.primitiveCount * 2);
    expect(cell.attrs.primitive.require("primtype").getString(0)).toBe("polyline");
    // And the halo is still there: with the default unreferencedPoints
    // "keep", the cell's point domain is the halo's, untouched.
    for (const [a, b] of edgeIndices(cell)) {
      expect(a).toBeLessThan(cell.pointCount);
      expect(b).toBeLessThan(cell.pointCount);
    }
  });

  // -------------------------------------------------------------------------
  // Identity across a seam
  //
  // An edge's IDENTITY — the fold of its own points' identities, which is
  // what primitive-domain randomField draws on — has to be the same number
  // in every cell that derives that edge, or a partitioned cook would
  // randomize a seam edge differently on each side of the seam. It holds for
  // a reason worth naming: halo is authored rather than a runtime concept,
  // so both cells hold both endpoints; identity reads only stored position
  // bits and `seed`; and dropping unreferenced points renumbers the point
  // domain without moving anything in it.

  /** Every edge of `geo`, named by position, with its primitive identity. */
  function identityByEdge(geo: Geometry): Map<string, number> {
    const ident = primitiveIdentities(geo, "test");
    const out = new Map<string, number>();
    edgeKeys(geo).forEach((key, p) => out.set(key, ident[p]));
    return out;
  }

  it("two neighbouring cells agree on every edge both of them derive", async () => {
    // Before the ownership filter picks a winner, the overlap of two halos
    // holds the same edges twice — once per cell, over differently numbered
    // points. These are the seam edges, and this is where the two cells
    // could have disagreed.
    const geo = partitionCloud();
    const radius = partitionRadius;
    const [left, right] = [partitionWindows[1], partitionWindows[2]];
    const a = identityByEdge(
      await connect(clipX(geo, left.lo - radius, left.hi + radius), { radius }),
    );
    const b = identityByEdge(
      await connect(clipX(geo, right.lo - radius, right.hi + radius), { radius }),
    );
    const shared = [...a.keys()].filter((key) => b.has(key));
    expect(shared.length).toBeGreaterThan(5);
    for (const key of shared) expect(a.get(key)).toBe(b.get(key));
    // The halos really do number their points differently, so the agreement
    // above is about the points and not about two identical arrays.
    expect([...a.keys()]).not.toEqual([...b.keys()]);
  });

  it("a cell's edges keep the identities they have in the whole-region network", async () => {
    // The full recipe, through a serialized graph, with unreferencedPoints
    // "drop" so the surviving points are renumbered onto a domain that
    // holds neither the halo nor the whole cloud. Nothing moved, so nothing
    // may re-roll.
    const geo = partitionCloud();
    const whole = identityByEdge(await connect(geo, { radius: partitionRadius }));
    let seen = 0;
    for (const w of partitionWindows) {
      const cell = identityByEdge(await cookCell(geo, w, partitionRadius, "drop"));
      expect(cell.size).toBeGreaterThan(0);
      for (const [key, ident] of cell) {
        expect(whole.get(key)).toBe(ident);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(20);
    // Distinct edges get distinct identities: an all-collide fold would
    // satisfy every equality above and mean nothing.
    expect(new Set(whole.values()).size).toBe(whole.size);
  });
});

describe("connectPoints with a per-point radius", () => {
  /** A cloud carrying a scalar `reach` attribute for a radius field to read. */
  function reachCloud(
    positions: readonly (readonly number[])[],
    reaches: readonly number[],
  ): Geometry {
    const geo = cloud(positions);
    geo.attrs.point.add("reach", "f32", 1, 0).data.set(reaches);
    return geo;
  }
  const reachField = () => attribute("reach");

  it("connects a pair when the LARGER reach spans it, not the smaller", async () => {
    // Two points 2 apart. One reaches 3, the other 1. Under max() they are
    // an edge; under min() or "both must reach" they are not, and under the
    // SUM (4) a pair 3.5 apart would connect, which the third point checks.
    const geo = await connect(
      reachCloud([[0, 0, 0], [2, 0, 0], [5.5, 0, 0]], [3, 1, 1]),
      { radius: reachField() },
    );
    expect(edgeKeys(geo)).toEqual(["0,0,0->2,0,0"]);
    // The far pair is 3.5 apart with reaches 1 and 1: max is 1, no edge.
    // If the rule were the SUM it would be 2 — still no edge — so the
    // discriminating case is the near pair above, where min() says no and
    // max() says yes.
    const minWouldSay = await connect(
      reachCloud([[0, 0, 0], [2, 0, 0]], [1, 1]),
      { radius: reachField() },
    );
    expect(edgeKeys(minWouldSay)).toEqual([]);
  });

  it("does not depend on WHICH endpoint carries the larger reach", async () => {
    // The sharp test, and the one a reordering cannot make. Each pair is
    // visited once, from its lower-RANKED end, and ranks are keyed on
    // point identity rather than array position — so deciding the pair by
    // the visiting endpoint's own reach is still perfectly deterministic
    // and still survives a shuffle. It is nonetheless "the edge depends on
    // which endpoint asked", which is the thing max() exists to prevent.
    // Swapping the two reaches across the SAME geometry is what tells them
    // apart: under max() both spellings connect, under either endpoint's
    // own reach exactly one does.
    const at: number[][] = [[0, 0, 0], [2, 0, 0]];
    const near = await connect(reachCloud(at, [3, 1]), { radius: reachField() });
    const far = await connect(reachCloud(at, [1, 3]), { radius: reachField() });
    expect(edgeKeys(near)).toEqual(["0,0,0->2,0,0"]);
    expect(edgeKeys(far)).toEqual(["0,0,0->2,0,0"]);
  });

  it("is symmetric: the edge set does not depend on the point order", async () => {
    // The whole justification for max() is that it restores symmetry, so
    // the network must be a property of the points and not of the array.
    const at: number[][] = [[0, 0, 0], [2, 0, 0], [3.5, 0, 0], [9, 0, 0]];
    const reaches = [3, 1, 0.5, 4];
    const straight = await connect(reachCloud(at, reaches), { radius: reachField() });
    const order = [3, 1, 0, 2];
    const flipped = await connect(
      reachCloud(order.map((i) => at[i]), order.map((i) => reaches[i])),
      { radius: reachField() },
    );
    expect(new Set(edgeKeys(flipped))).toEqual(new Set(edgeKeys(straight)));
  });

  it("a NEGATIVE reach connects nothing, the same as 0", async () => {
    // The param promises a non-positive reach "connects that point to
    // nothing". Squaring a raw reach loses the sign, so two points that
    // both asked for -1 were compared against max(-1, -2)^2 = 1 and
    // CONNECTED — the promise broken by the arithmetic meant to make it
    // cheap. Points 0.5 apart, so any positive limit would join them.
    const near: number[][] = [[0, 0, 0], [0.5, 0, 0]];
    expect(edgeKeys(await connect(reachCloud(near, [-1, -2]), { radius: reachField() }))).toEqual([]);
    // CONTROL: the same geometry with a real reach on ONE endpoint does
    // connect, so the assertion above is not passing because nothing ever
    // connects. Counted rather than named: which endpoint comes first is
    // a property of point IDENTITY, not of this test.
    expect(edgeKeys(await connect(reachCloud(near, [1, -2]), { radius: reachField() }))).toHaveLength(1);
  });

  it("REFUSES a non-finite reach rather than reading it as nothing", async () => {
    // Unlike pointNeighborhood, which documents NaN and Infinity as
    // meaningful, this param uses the GUARDED resolver — so a NaN never
    // reaches the pair test at all and the cook stops with the offending
    // element named. Pinned because the description used to say NaN
    // "connects nothing", which is a different promise from this one.
    const near: number[][] = [[0, 0, 0], [0.5, 0, 0]];
    await expect(
      connect(reachCloud(near, [Number.NaN, 1]), { radius: reachField() }),
    ).rejects.toThrow(/param "radius" resolved to NaN/);
  });

  it("a reach of 0 connects that point to nothing, but a big neighbour still reaches it", async () => {
    const geo = await connect(
      reachCloud([[0, 0, 0], [1, 0, 0]], [4, 0]),
      { radius: reachField() },
    );
    // Asymmetric reaches, symmetric answer: the larger decides the pair.
    expect(edgeKeys(geo)).toEqual(["0,0,0->1,0,0"]);
    const neither = await connect(
      reachCloud([[0, 0, 0], [1, 0, 0]], [0, 0]),
      { radius: reachField() },
    );
    expect(edgeKeys(neither)).toEqual([]);
  });

  it("a constant field equals the plain radius, with a control that differs", async () => {
    // f32-exact on purpose: a field resolves into an f32 column.
    const at: number[][] = [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]];
    const plain = await connect(cloud(at), { radius: 1.5 });
    const field = await connect(cloud(at), { radius: constant(1.5) });
    expect(edgeKeys(field)).toEqual(edgeKeys(plain));
    expect(edgeKeys(plain).length).toBe(6);
    const control = await connect(cloud(at), { radius: 1.25 });
    expect(edgeKeys(control)).not.toEqual(edgeKeys(plain));
  });

  it("keeps the STRICT test per pair", async () => {
    // A pair at exactly the larger reach is NOT connected, the same way a
    // pair at exactly a plain radius is not.
    const exact = await connect(
      reachCloud([[0, 0, 0], [2, 0, 0]], [2, 1]),
      { radius: reachField() },
    );
    expect(edgeKeys(exact)).toEqual([]);
    const under = await connect(
      reachCloud([[0, 0, 0], [2, 0, 0]], [2.5, 1]),
      { radius: reachField() },
    );
    expect(edgeKeys(under)).toEqual(["0,0,0->2,0,0"]);
  });

  it("relativeNeighborhood still finds its witness under mixed reaches", async () => {
    // The lune test is about DISTANCES, so a witness must still be found
    // even though the candidate scan now runs at the widest reach.
    const at: number[][] = [[0, 0, 0], [4, 0, 0], [2, 0.5, 0]];
    const all = await connect(reachCloud(at, [5, 5, 5]), {
      radius: reachField(),
      mode: "radius",
    });
    expect(all.primitiveCount).toBe(3);
    const thinned = await connect(reachCloud(at, [5, 5, 5]), {
      radius: reachField(),
      mode: "relativeNeighborhood",
    });
    // The middle point witnesses against the long 0->4 edge.
    expect(thinned.primitiveCount).toBe(2);
  });
});
