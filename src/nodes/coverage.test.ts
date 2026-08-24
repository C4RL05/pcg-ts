import { describe, expect, it } from "vitest";
import { type Geometry, createPointCloud, setPolylineTopology } from "../data/index.js";
import { attribute, vec } from "../fields/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { pathCoverage, type PathCoverageParams } from "./coverage.js";
import { firstGeo, runNode, snapshotGeometry } from "./nodes.testsupport.js";
import { quatFromEulerDeg } from "./util.js";

/** A path of `n` points at (i, 0, 0), as one polyline primitive. */
function straightPath(n: number): Geometry {
  const geo = createPointCloud(n);
  const P = geo.attrs.point.require("P");
  for (let i = 0; i < n; i++) P.setTuple(i, [i, 0, 0]);
  setPolylineTopology(
    geo,
    Array.from({ length: n }, (_, i) => i),
    [0],
    [n],
  );
  return geo;
}

/** The same points, with no topology at all. */
function bareCloud(pts: readonly (readonly [number, number, number])[]): Geometry {
  const geo = createPointCloud(pts.length);
  const P = geo.attrs.point.require("P");
  for (let i = 0; i < pts.length; i++) P.setTuple(i, pts[i]);
  return geo;
}

/**
 * A hairpin: out along +X at z = 0, a half turn of radius 1 about
 * (10, 0, 1), then back along -X at z = 2.
 *
 * The two legs are 2 apart in the WORLD and most of a lap apart in ARC
 * LENGTH, which is the whole point — see the fold-back test.
 */
function hairpinPath(): { geo: Geometry; leg: ("out" | "turn" | "back")[] } {
  const pts: [number, number, number][] = [];
  const leg: ("out" | "turn" | "back")[] = [];
  for (let x = 0; x <= 10; x += 0.5) {
    pts.push([x, 0, 0]);
    leg.push("out");
  }
  for (let k = 1; k < 8; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / 8;
    pts.push([10 + Math.cos(a), 0, 1 + Math.sin(a)]);
    leg.push("turn");
  }
  for (let x = 10; x >= 0; x -= 0.5) {
    pts.push([x, 0, 2]);
    leg.push("back");
  }
  const geo = createPointCloud(pts.length);
  const P = geo.attrs.point.require("P");
  for (let i = 0; i < pts.length; i++) P.setTuple(i, pts[i]);
  setPolylineTopology(
    geo,
    Array.from({ length: pts.length }, (_, i) => i),
    [0],
    [pts.length],
  );
  return { geo, leg };
}

interface BoxSpec {
  /** World centre. */
  readonly p: readonly [number, number, number];
  /** World size, written to `scale` (boxSize defaults to the unit cube). */
  readonly size: readonly [number, number, number];
  /** Extrinsic XYZ Euler degrees, written to `rot`. */
  readonly rotDeg?: readonly [number, number, number];
}

/** A box cloud carrying the standard transform attributes. */
function boxCloud(specs: readonly BoxSpec[]): Geometry {
  const geo = createPointCloud(specs.length);
  const P = geo.attrs.point.require("P");
  const scale = geo.attrs.point.require("scale");
  const rot = geo.attrs.point.require("rot");
  const q: number[] = [0, 0, 0, 1];
  for (let i = 0; i < specs.length; i++) {
    P.setTuple(i, specs[i].p);
    scale.setTuple(i, specs[i].size);
    const e = specs[i].rotDeg ?? [0, 0, 0];
    quatFromEulerDeg(q, e[0], e[1], e[2]);
    rot.setTuple(i, q);
  }
  return geo;
}

/** Run pathCoverage and read both report columns back. */
async function cover(
  path: Geometry,
  boxes: Geometry,
  params: Partial<PathCoverageParams> = {},
): Promise<{ geo: Geometry; hits: number[]; covered: boolean[] }> {
  const geo = firstGeo(
    (
      await runNode(pathCoverage, { hitsAttr: "coverHits", ...params }, {
        path: [makeGeometryItem(path)],
        boxes: [makeGeometryItem(boxes)],
      })
    ).out,
  );
  const coveredName = params.coveredAttr ?? "covered";
  const hitsName = params.hitsAttr ?? "coverHits";
  const hitsAttr = hitsName === "" ? undefined : geo.attrs.point.require(hitsName);
  const coveredAttr = coveredName === "" ? undefined : geo.attrs.point.require(coveredName);
  return {
    geo,
    hits: Array.from({ length: geo.pointCount }, (_, i) => hitsAttr?.get(i) ?? -1),
    covered: Array.from({ length: geo.pointCount }, (_, i) => (coveredAttr?.get(i) ?? 0) === 1),
  };
}

/** The refusal, or "" when the call succeeded. */
async function refusal(path: Geometry, boxes: Geometry, params: Partial<PathCoverageParams>) {
  try {
    await cover(path, boxes, params);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

/** A roof over the whole straight path, well inside the default fan. */
const ROOF: BoxSpec = { p: [4.5, 5, 0], size: [20, 1, 20] };
/** Far enough away to touch nothing. */
const ELSEWHERE: BoxSpec = { p: [100, 5, 0], size: [4, 1, 4] };

describe("pathCoverage: the basic decision", () => {
  it("reports a path fully under one big box as covered everywhere", async () => {
    const { hits, covered } = await cover(straightPath(10), boxCloud([ROOF]));
    expect(hits).toEqual(new Array(10).fill(6));
    expect(covered).toEqual(new Array(10).fill(true));
  });

  it("reports a path under nothing as covered nowhere", async () => {
    const { hits, covered } = await cover(straightPath(10), boxCloud([ELSEWHERE]));
    expect(hits).toEqual(new Array(10).fill(0));
    expect(covered.some((c) => c)).toBe(false);
  });

  it("accepts an empty box cloud and answers false for every point", async () => {
    const { hits, covered } = await cover(straightPath(6), createPointCloud(0));
    expect(hits).toEqual(new Array(6).fill(0));
    expect(covered).toEqual(new Array(6).fill(false));
  });

  it("does not count a box beside the path as cover over it", async () => {
    // Same height as ROOF, but pushed 5 across — beyond the 1.5 fan.
    const beside = boxCloud([{ p: [4.5, 5, 5], size: [20, 1, 4] }]);
    const { hits } = await cover(straightPath(10), beside);
    expect(hits).toEqual(new Array(10).fill(0));
  });
});

describe("pathCoverage: the fold-back case it exists to prevent", () => {
  /**
   * A box over the OUTBOUND leg only, right at the hairpin. Its world
   * bounds sit 2 from the return leg and its arc-length footprint — read
   * off a folded centreline — would span the turn and the start of the way
   * back, which is exactly the artefact that inflated the withdrawn figure.
   */
  const OVER_OUT: BoxSpec = { p: [9, 5, 0], size: [2, 1, 1.2] };

  it("covers the leg under the box and not the leg beside it", async () => {
    const { geo, leg } = hairpinPath();
    const { hits, covered } = await cover(geo, boxCloud([OVER_OUT]), {
      rayCount: 3,
      spread: 0.5,
      minHits: 2,
    });
    const P = geo.attrs.point.require("P");
    let outCovered = 0;
    for (let i = 0; i < geo.pointCount; i++) {
      const x = P.get(i, 0);
      if (leg[i] === "out" && x >= 8.5 && x <= 9.5) {
        expect(covered[i]).toBe(true);
        outCovered++;
      }
      if (leg[i] === "back") {
        // THE DEFECT: not merely "not covered" but not hit at all.
        expect(hits[i]).toBe(0);
        expect(covered[i]).toBe(false);
      }
    }
    expect(outCovered).toBeGreaterThan(1);
  });

  it("has a return leg genuinely near the box, so the test is not passing by distance", async () => {
    const { geo, leg } = hairpinPath();
    const P = geo.attrs.point.require("P");
    let nearest = Infinity;
    let farthestStationGap = 0;
    let outStation = -1;
    for (let i = 0; i < geo.pointCount; i++) {
      if (leg[i] === "out" && Math.abs(P.get(i, 0) - 9) < 0.26) outStation = i;
      if (leg[i] !== "back") continue;
      const d = Math.hypot(P.get(i, 0) - 9, P.get(i, 1) - 5, P.get(i, 2) - 0);
      if (d < nearest) nearest = d;
      if (outStation >= 0 && d < 6) farthestStationGap = Math.max(farthestStationGap, i - outStation);
    }
    // Metres apart in the world...
    expect(nearest).toBeLessThan(6);
    // ...and a long way apart along the path, which is the trap.
    expect(farthestStationGap).toBeGreaterThan(10);
  });
});

describe("pathCoverage: the threshold", () => {
  /**
   * Spans z from -2 to 0, so it takes exactly the three rays at -1.5, -0.9
   * and -0.3 and misses the three at +0.3, +0.9 and +1.5.
   */
  const HALF_ROOF: BoxSpec = { p: [4.5, 5, -1], size: [20, 1, 2] };

  it("counts exactly three of six rays for a half roof", async () => {
    const { hits } = await cover(straightPath(4), boxCloud([HALF_ROOF]));
    expect(hits).toEqual([3, 3, 3, 3]);
  });

  it("is inclusive at the boundary: three hits passes minHits 3 and fails minHits 4", async () => {
    const at3 = await cover(straightPath(4), boxCloud([HALF_ROOF]), { minHits: 3 });
    expect(at3.covered).toEqual([true, true, true, true]);
    const at4 = await cover(straightPath(4), boxCloud([HALF_ROOF]), { minHits: 4 });
    expect(at4.covered).toEqual([false, false, false, false]);
    expect(at4.hits).toEqual([3, 3, 3, 3]);
  });

  it("counts distinct rays, not boxes over the same ray", async () => {
    const stacked = boxCloud([
      HALF_ROOF,
      { p: [4.5, 7, -1], size: [20, 1, 2] },
      { p: [4.5, 9, -1], size: [20, 1, 2] },
    ]);
    const { hits } = await cover(straightPath(4), stacked, { far: 20 });
    expect(hits).toEqual([3, 3, 3, 3]);
  });
});

describe("pathCoverage: the fan", () => {
  /** Only 1 wide across the path: the outer rays of a wide fan miss it. */
  const NARROW: BoxSpec = { p: [4.5, 5, 0], size: [20, 1, 1] };

  it("spread decides how much of the corridor is asked about", async () => {
    const wide = await cover(straightPath(4), boxCloud([NARROW]), { spread: 1.5 });
    expect(wide.hits).toEqual([2, 2, 2, 2]);
    const tight = await cover(straightPath(4), boxCloud([NARROW]), { spread: 0.2 });
    expect(tight.hits).toEqual([6, 6, 6, 6]);
  });

  it("rayCount sets the fan's size, and 1 ray ignores spread", async () => {
    const three = await cover(straightPath(4), boxCloud([ROOF]), { rayCount: 3, minHits: 3 });
    expect(three.hits).toEqual([3, 3, 3, 3]);
    const one = await cover(straightPath(4), boxCloud([NARROW]), {
      rayCount: 1,
      minHits: 1,
      spread: 1000,
    });
    expect(one.hits).toEqual([1, 1, 1, 1]);
    expect(one.covered).toEqual([true, true, true, true]);
  });

  it("spread 0 collapses the fan onto the centre line", async () => {
    const { hits } = await cover(straightPath(4), boxCloud([NARROW]), { spread: 0, minHits: 6 });
    expect(hits).toEqual([6, 6, 6, 6]);
  });

  it("takes spread as a field, per point", async () => {
    const path = straightPath(4);
    const halfW = path.attrs.point.add("halfW", "f32", 1, 0);
    for (let i = 0; i < 4; i++) halfW.set(i, i < 2 ? 0.2 : 1.5);
    const { hits } = await cover(path, boxCloud([NARROW]), { spread: attribute("halfW") });
    expect(hits).toEqual([6, 6, 2, 2]);
  });
});

describe("pathCoverage: the cast direction", () => {
  it("near and far are a real floor and a real ceiling", async () => {
    const low = boxCloud([{ p: [4.5, 1, 0], size: [20, 1, 20] }]);
    expect((await cover(straightPath(3), low, { near: 2 })).hits).toEqual([0, 0, 0]);
    expect((await cover(straightPath(3), low, { near: 0 })).hits).toEqual([6, 6, 6]);
    const high = boxCloud([{ p: [4.5, 8, 0], size: [20, 1, 20] }]);
    expect((await cover(straightPath(3), high, { far: 3 })).hits).toEqual([0, 0, 0]);
    expect((await cover(straightPath(3), high, { far: 20 })).hits).toEqual([6, 6, 6]);
  });

  it("casts along any axis, not only up", async () => {
    // A wall beside the path, asked about by casting sideways.
    const wall = boxCloud([{ p: [4.5, 0, 4], size: [20, 20, 1] }]);
    const up = await cover(straightPath(3), wall);
    expect(up.hits).toEqual([0, 0, 0]);
    const across = await cover(straightPath(3), wall, { direction: [0, 0, 1] });
    expect(across.hits).toEqual([6, 6, 6]);
  });

  it("takes direction as a field, per point", async () => {
    const path = straightPath(4);
    const flip = path.attrs.point.add("flip", "f32", 1, 0);
    for (let i = 0; i < 4; i++) flip.set(i, i < 2 ? 1 : -1);
    const above = boxCloud([{ p: [1.5, 5, 0], size: [20, 1, 20] }]);
    const { hits } = await cover(path, above, { direction: vec(0, attribute("flip"), 0) });
    expect(hits).toEqual([6, 6, 0, 0]);
  });
});

describe("pathCoverage: boxes are oriented, and sized by boxSize times scale", () => {
  it("runs the slab test in the box's own frame, not a world AABB", async () => {
    // A long thin beam laid diagonally in XZ: its world AABB spans the whole
    // fan, but only the innermost rays are actually inside the box.
    const beam = boxCloud([{ p: [5, 5, 0], size: [8, 0.5, 0.5], rotDeg: [0, 45, 0] }]);
    const { hits } = await cover(bareCloudPath([5, 0, 0]), beam, { acrossAttr: "" });
    expect(hits).toEqual([2]);
  });

  it("multiplies boxSize by scale, and the default boxSize makes scale the size", async () => {
    // scale [20, 1, 1] with boxSize [1, 1, 1] is the NARROW roof (2 hits);
    // boxSize [1, 1, 2] doubles it across and takes four rays.
    const narrow = boxCloud([{ p: [4.5, 5, 0], size: [20, 1, 1] }]);
    expect((await cover(straightPath(2), narrow)).hits).toEqual([2, 2]);
    expect((await cover(straightPath(2), narrow, { boxSize: [1, 1, 2] })).hits).toEqual([4, 4]);
  });

  it("reads boxSize as a field on the BOXES cloud, not the path", async () => {
    const boxes = boxCloud([
      { p: [1, 5, 0], size: [2, 1, 1] },
      { p: [3, 5, 0], size: [2, 1, 1] },
    ]);
    const w = boxes.attrs.point.add("w", "f32", 1, 0);
    w.set(0, 1);
    w.set(1, 4);
    const { hits } = await cover(straightPath(5), boxes, {
      boxSize: vec(1, 1, attribute("w")),
    });
    // The box at x = 1 stays 1 across (2 rays); the one at x = 3 becomes 4
    // across (all 6). x = 0, 2 and 4 are outside both boxes' 2-long span.
    expect(hits[1]).toBe(2);
    expect(hits[3]).toBe(6);
  });
});

/** One-point "path" carrying an explicit across direction. */
function bareCloudPath(p: readonly [number, number, number]): Geometry {
  const geo = bareCloud([p]);
  setPolylineTopology(geo, [0, 0], [0], [2]);
  return geo;
}

describe("pathCoverage: where across comes from", () => {
  it("derives across from the polyline tangent", async () => {
    // A path running along +Z instead of +X: the fan turns with it, so the
    // roof that is narrow across an +X path is wide across this one.
    const geo = createPointCloud(4);
    const P = geo.attrs.point.require("P");
    for (let i = 0; i < 4; i++) P.setTuple(i, [0, 0, i]);
    setPolylineTopology(geo, [0, 1, 2, 3], [0], [4]);
    const narrowInX = boxCloud([{ p: [0, 5, 1.5], size: [1, 1, 20] }]);
    expect((await cover(geo, narrowInX)).hits).toEqual([2, 2, 2, 2]);
  });

  it("takes an explicit across attribute, and then needs no topology", async () => {
    const cloud = bareCloud([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    const across = cloud.attrs.point.add("across", "f32", 3, 0);
    for (let i = 0; i < 2; i++) across.setTuple(i, [0, 0, 1]);
    const narrow = boxCloud([{ p: [0.5, 5, 0], size: [20, 1, 1] }]);
    const { hits } = await cover(cloud, narrow, { acrossAttr: "across" });
    expect(hits).toEqual([2, 2]);
  });

  it("agrees with the derived tangent when the attribute says the same thing", async () => {
    const path = straightPath(4);
    const across = path.attrs.point.add("across", "f32", 3, 0);
    for (let i = 0; i < 4; i++) across.setTuple(i, [0, 0, 1]);
    const narrow = boxCloud([{ p: [1.5, 5, 0], size: [20, 1, 1] }]);
    const derived = await cover(path, narrow);
    const explicit = await cover(path, narrow, { acrossAttr: "across" });
    expect(explicit.hits).toEqual(derived.hits);
  });

  it("projects the across attribute perpendicular to the cast direction", async () => {
    // Deliberately tilted 45 degrees into the cast: only its perpendicular
    // part survives, so the fan is the same one [0, 0, 1] would give.
    const path = straightPath(4);
    const tilted = path.attrs.point.add("tilted", "f32", 3, 0);
    for (let i = 0; i < 4; i++) tilted.setTuple(i, [0, 1, 1]);
    const narrow = boxCloud([{ p: [1.5, 5, 0], size: [20, 1, 1] }]);
    const straight = path.attrs.point.add("across", "f32", 3, 0);
    for (let i = 0; i < 4; i++) straight.setTuple(i, [0, 0, 1]);
    const a = await cover(path, narrow, { acrossAttr: "tilted" });
    const b = await cover(path, narrow, { acrossAttr: "across" });
    expect(a.hits).toEqual(b.hits);
  });
});

describe("pathCoverage: it adds a column and removes nothing", () => {
  it("preserves points, topology and every existing attribute", async () => {
    const path = createPointCloud(6);
    const P = path.attrs.point.require("P");
    for (let i = 0; i < 6; i++) P.setTuple(i, [i, 0, 0]);
    const tag = path.attrs.point.add("tag", "f32", 1, 0);
    for (let i = 0; i < 6; i++) tag.set(i, i * 3);
    // Two polylines over one cloud, so the primitive domain is non-trivial.
    setPolylineTopology(path, [0, 1, 2, 3, 4, 5], [0, 3], [3, 3]);
    path.attrs.primitive.add("lane", "f32", 1, 0).set(1, 7);
    path.attrs.detail.add("note", "f32", 1, 0).set(0, 42);
    const before = snapshotGeometry(path);

    const { geo } = await cover(path, boxCloud([ROOF]));
    expect(geo.pointCount).toBe(6);
    expect(Array.from(geo.vertexToPoint)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(Array.from(geo.primVertexStart)).toEqual([0, 3]);
    expect(Array.from(geo.primVertexCount)).toEqual([3, 3]);
    expect(geo.attrs.point.names()).toEqual([...path.attrs.point.names(), "covered", "coverHits"]);

    // Every domain and every pre-existing column, byte for byte.
    const after = snapshotGeometry(geo);
    const strip = (snap: Record<string, unknown>) => {
      const point = snap.point as { count: number; attrs: { name: string }[] };
      return {
        ...snap,
        point: {
          count: point.count,
          attrs: point.attrs.filter((a) => a.name !== "covered" && a.name !== "coverHits"),
        },
      };
    };
    expect(strip(after)).toEqual(strip(before));
    // ...and the input itself was never touched.
    expect(snapshotGeometry(path)).toEqual(before);
  });

  it("re-runs over its own output, resetting the columns it owns", async () => {
    const path = straightPath(4);
    const once = await cover(path, boxCloud([ROOF]));
    const twice = await cover(once.geo, boxCloud([ELSEWHERE]));
    expect(twice.hits).toEqual([0, 0, 0, 0]);
    expect(twice.covered).toEqual([false, false, false, false]);
    expect(twice.geo.attrs.point.names()).toEqual(once.geo.attrs.point.names());
  });

  it("writes only the column it was asked for", async () => {
    const flagOnly = firstGeo(
      (
        await runNode(pathCoverage, { hitsAttr: "" }, {
          path: [makeGeometryItem(straightPath(3))],
          boxes: [makeGeometryItem(boxCloud([ROOF]))],
        })
      ).out,
    );
    expect(flagOnly.attrs.point.names()).toContain("covered");
    expect(flagOnly.attrs.point.names()).not.toContain("coverHits");
    const countOnly = firstGeo(
      (
        await runNode(pathCoverage, { coveredAttr: "", hitsAttr: "n" }, {
          path: [makeGeometryItem(straightPath(3))],
          boxes: [makeGeometryItem(boxCloud([ROOF]))],
        })
      ).out,
    );
    expect(countOnly.attrs.point.names()).not.toContain("covered");
    expect(countOnly.attrs.point.require("n").get(0)).toBe(6);
  });
});

describe("pathCoverage: determinism", () => {
  it("gives the same answer whatever order the boxes arrive in", async () => {
    // Four overlapping roofs of different widths, plus one far away that
    // is too big to bin — so the answer runs through the whole range and
    // through both tiers of the index.
    const specs: BoxSpec[] = [
      { p: [1, 5, 0], size: [2.4, 1, 4] },
      { p: [3, 5, -1], size: [2.4, 1, 2] },
      { p: [400, 5, 0], size: [400, 1, 400] },
      { p: [5, 5, 0], size: [2.4, 1, 1] },
      { p: [7, 5, 0], size: [2.4, 1, 3.2] },
    ];
    const forward = await cover(straightPath(10), boxCloud(specs));
    expect(forward.hits).toEqual([6, 6, 6, 3, 4, 2, 6, 6, 6, 0]);
    const backward = await cover(straightPath(10), boxCloud([...specs].reverse()));
    expect(backward.hits).toEqual(forward.hits);
    expect(backward.covered).toEqual(forward.covered);
  });

  it("is unaffected by boxes that cannot reach the path", async () => {
    const near: BoxSpec[] = [{ p: [3, 5, -1], size: [4, 1, 2] }];
    const bare = await cover(straightPath(8), boxCloud(near));
    const padded = await cover(
      straightPath(8),
      boxCloud([
        ...near,
        { p: [0, 500, 0], size: [1000, 1, 1000] },
        { p: [0, -50, 0], size: [1000, 1, 1000] },
        { p: [-400, 5, 0], size: [4, 1, 4] },
      ]),
    );
    expect(padded.hits).toEqual(bare.hits);
  });

  it("repeats byte for byte across runs", async () => {
    const specs: BoxSpec[] = [
      { p: [2, 5, 0], size: [3, 1, 2] },
      { p: [6, 4, 0.5], size: [3, 1, 1.5], rotDeg: [0, 30, 0] },
    ];
    const a = await cover(straightPath(12), boxCloud(specs));
    const b = await cover(straightPath(12), boxCloud(specs));
    expect(snapshotGeometry(b.geo)).toEqual(snapshotGeometry(a.geo));
  });
});

describe("pathCoverage: refusals", () => {
  it("refuses to write nothing", async () => {
    const message = await refusal(straightPath(2), boxCloud([ROOF]), {
      coveredAttr: "",
      hitsAttr: "",
    });
    expect(message).toContain("pathCoverage: nothing to write");
    expect(message).toContain("coveredAttr");
    expect(message).toContain("hitsAttr");
  });

  it("refuses a threshold no fan could ever reach", async () => {
    const message = await refusal(straightPath(2), boxCloud([ROOF]), {
      rayCount: 4,
      minHits: 5,
    });
    expect(message).toContain("minHits is 5 but rayCount is only 4");
    expect(message).toContain("at most 4");
  });

  it("refuses a fan with no rays in it", async () => {
    const message = await refusal(straightPath(2), boxCloud([ROOF]), { rayCount: 0, minHits: 1 });
    expect(message).toContain("rayCount is 0");
    expect(message).toContain("at least one ray");
  });

  it("refuses a report slot that would delete an existing column", async () => {
    const message = await refusal(straightPath(2), boxCloud([ROOF]), { coveredAttr: "P" });
    expect(message).toContain('pathCoverage: coveredAttr "P" already exists');
    expect(message).toContain("would DELETE");
    expect(message).toContain("covered");
    const count = await refusal(straightPath(2), boxCloud([ROOF]), { hitsAttr: "P" });
    expect(count).toContain('pathCoverage: hitsAttr "P" already exists');
  });

  it("refuses an acrossAttr that is not there", async () => {
    const message = await refusal(straightPath(2), boxCloud([ROOF]), { acrossAttr: "banana" });
    expect(message).toContain('acrossAttr "banana" is not a point attribute of the path');
    expect(message).toContain("available:");
    expect(message).toContain("leave acrossAttr empty");
  });

  it("refuses an acrossAttr of the wrong shape", async () => {
    const path = straightPath(2);
    path.attrs.point.add("flat", "f32", 1, 0);
    const message = await refusal(path, boxCloud([ROOF]), { acrossAttr: "flat" });
    expect(message).toContain('acrossAttr "flat" is f32');
    expect(message).toContain("three numbers per point");
  });

  it("refuses a path with no polyline topology when across must be derived", async () => {
    const message = await refusal(
      bareCloud([
        [0, 0, 0],
        [1, 0, 0],
      ]),
      boxCloud([ROOF]),
      {},
    );
    expect(message).toContain("pathCoverage: input has no polyline primitives");
    expect(message).toContain("pointsToPath");
  });

  it("refuses a zero-length cast direction, naming the point", async () => {
    const path = straightPath(3);
    const dir = path.attrs.point.add("dir", "f32", 3, 0);
    dir.setTuple(0, [0, 1, 0]);
    dir.setTuple(1, [0, 0, 0]);
    dir.setTuple(2, [0, 1, 0]);
    const message = await refusal(path, boxCloud([ROOF]), { direction: attribute("dir") });
    expect(message).toContain('param "direction" is zero-length at path point 1');
    expect(message).toContain("vec(0, 1, 0)");
  });

  it("names the pin when a geometry is missing", async () => {
    const noBoxes = await (async () => {
      try {
        await runNode(pathCoverage, {}, { path: [makeGeometryItem(straightPath(2))] });
        return "";
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(noBoxes).toBe('pathCoverage: input pin "boxes" has no geometry connected');
    const noPath = await (async () => {
      try {
        await runNode(pathCoverage, {}, { boxes: [makeGeometryItem(boxCloud([ROOF]))] });
        return "";
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(noPath).toBe('pathCoverage: input pin "path" has no geometry connected');
  });

  it("names the boxes pin when it carries no positions", async () => {
    const boxes = createPointCloud(3);
    boxes.attrs.point.remove("P");
    const message = await refusal(straightPath(2), boxes, {});
    expect(message).toContain('pathCoverage: input "boxes" has no point attribute "P"');
  });

  it("refuses a direction field of the wrong width", async () => {
    const message = await refusal(straightPath(2), boxCloud([ROOF]), {
      direction: vec(1, 0, 0, 0),
    });
    expect(message).toContain('pathCoverage: param "direction" must evaluate to three components');
  });
});

describe("pathCoverage: scale", () => {
  it("handles many boxes against a long path", async () => {
    // 1200 kit boxes along a 400-point path, plus two enormous ones that
    // cannot be binned — the two-tier index has to survive both.
    const specs: BoxSpec[] = [];
    for (let k = 0; k < 1200; k++) {
      specs.push({ p: [k * 0.3, 5, k % 3 === 0 ? 0 : 6], size: [0.4, 0.6, 3] });
    }
    specs.push({ p: [180, 400, 0], size: [4000, 2, 4000] });
    specs.push({ p: [180, -400, 0], size: [4000, 2, 4000] });
    const path = straightPath(400);
    const { hits } = await cover(path, boxCloud(specs));
    // Every third box sits over the path; the rest are 6 across and unseen.
    expect(hits.filter((h) => h > 0).length).toBeGreaterThan(50);
    expect(Math.max(...hits)).toBe(6);
  });
});
