/**
 * `transferAlongPath`: the path-parametric gather.
 *
 * Every number checked here is hand-computed from the chord table rather
 * than recorded from a run, because the whole claim of the node is that
 * its arc coordinate is the one every other path node uses — a recorded
 * expectation would move with the code and prove nothing.
 */
import { describe, expect, it } from "vitest";
import { Geometry, createPointCloud, createPolyline } from "../data/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { transferAlongPath } from "./transferAlongPath.js";
import { firstGeo, positionsOf, runNode, snapshotGeometry } from "./nodes.testsupport.js";

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

/** A path with one numeric point attribute of the given tuple size per point. */
function pathWith(
  positions: readonly number[],
  name: string,
  values: readonly number[],
  tupleSize = 1,
  closed = false,
): Geometry {
  const geo = createPolyline(positions, { closed });
  const attr = geo.attrs.point.add(name, "f32", tupleSize, 0);
  attr.data.set(values);
  return geo;
}

/** A station cloud: one point per arc position, under the given column. */
function stations(values: readonly number[], name = "station"): Geometry {
  const geo = createPointCloud(values.length);
  const attr = geo.attrs.point.add(name, "f32", 1, 0);
  for (let i = 0; i < values.length; i++) attr.set(i, values[i]);
  return geo;
}

async function gather(
  path: Geometry,
  at: Geometry,
  params: Record<string, unknown> = {},
): Promise<Geometry> {
  const outputs = await runNode(transferAlongPath, params, {
    path: [makeGeometryItem(path)],
    at: [makeGeometryItem(at)],
  });
  return firstGeo(outputs.out);
}

/**
 * The OPEN reference path. Points at x = 0, 1, 3, 6, so the chords are
 * 1, 2 and 3 and the arc table is [0, 1, 3, 6] — every expectation below
 * is read straight off that. `v` climbs by ten times the arc so a
 * fraction of a segment is a whole number.
 */
const OPEN = () => pathWith([0, 0, 0, 1, 0, 0, 3, 0, 0, 6, 0, 0], "v", [0, 10, 30, 60]);

/**
 * The CLOSED reference path: a 10-unit square walked anticlockwise, so
 * every chord is 10 and the arc table is [0, 10, 20, 30, 40] INCLUDING
 * the closing chord from the last point back to the first — the table
 * `readLap` builds in demos/racetrack/lap.ts, which is the agreement this
 * node exists to keep.
 */
const CLOSED = () =>
  pathWith(
    [0, 0, 0, 10, 0, 0, 10, 0, 10, 0, 0, 10],
    "v",
    [0, 1, 2, 3],
    1,
    true,
  );

describe("transferAlongPath: interpolation", () => {
  it("interpolates linearly between the two bracketing path points", async () => {
    // d = 2 falls in segment 1 (arc 1 to 3) at t = 0.5, so v is halfway
    // between 10 and 30. d = 4.5 falls in segment 2 (arc 3 to 6) at
    // t = 0.5, halfway between 30 and 60.
    const out = await gather(OPEN(), stations([2, 4.5]), { attributes: ["v"] });
    expect(col(out, "v")).toEqual([20, 45]);
  });

  it("reads a path point exactly when the station lands on one", async () => {
    const out = await gather(OPEN(), stations([0, 1, 3, 6]), { attributes: ["v"] });
    expect(col(out, "v")).toEqual([0, 10, 30, 60]);
  });

  it("reads the first and the last point at arc 0 and at the full length", async () => {
    const out = await gather(OPEN(), stations([0, 6]), { attributes: ["v"] });
    expect(col(out, "v")).toEqual([0, 60]);
  });

  it("keeps the tuple size and interpolates componentwise", async () => {
    // Two points, one unit apart, carrying a vec3 each.
    const path = pathWith([0, 0, 0, 1, 0, 0], "v", [0, 10, 100, 2, 30, 200], 3);
    const out = await gather(path, stations([0.25]), { attributes: ["v"] });
    expect(out.attrs.point.require("v").tupleSize).toBe(3);
    expect(col(out, "v")).toEqual([0.5, 15, 125]);
  });

  it("writes an interpolated value as f32 even when the path stored an integer", async () => {
    // A lane index halfway between lane 1 and lane 2 is 1.5, and an i32
    // column would round it to a value neither neighbour holds.
    const path = createPolyline([0, 0, 0, 1, 0, 0]);
    const lane = path.attrs.point.add("lane", "i32", 1, 0);
    lane.set(0, 1);
    lane.set(1, 2);
    const out = await gather(path, stations([0.5]), { attributes: ["lane"] });
    expect(out.attrs.point.require("lane").type).toBe("f32");
    expect(col(out, "lane")).toEqual([1.5]);
  });

  it("interpolates a zero-length segment at t = 0 rather than dividing by it", async () => {
    // Points 1 and 2 coincide, so the middle segment has no length. The
    // library's shared locate reports t = 0 there, which is the only
    // reading a segment with no extent has.
    const path = pathWith([0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0], "v", [0, 5, 9, 12]);
    const out = await gather(path, stations([1]), { attributes: ["v"] });
    // Arc 1 is reached by two segments; the locate skips past the empty
    // one, so the value read is the SECOND coincident point's.
    expect(col(out, "v")).toEqual([9]);
  });
});

describe("transferAlongPath: wrapping and clamping", () => {
  it("interpolates round the closing segment from the last point to the first", async () => {
    // d = 35 is halfway along the closing chord: v runs 3 -> 0.
    const out = await gather(CLOSED(), stations([35]), { attributes: ["v"] });
    expect(col(out, "v")).toEqual([1.5]);
  });

  it("takes a station modulo the length on a closed path", async () => {
    // 85 is two laps and 5; -5 is 35 measured backwards from the line.
    const out = await gather(CLOSED(), stations([85, -5, 45]), { attributes: ["v"] });
    expect(col(out, "v")).toEqual([0.5, 1.5, 0.5]);
  });

  it("clamps on a closed path when wrap is off", async () => {
    // 40 is the very end of the closing chord, which IS the first point.
    const out = await gather(CLOSED(), stations([-5, 85]), {
      attributes: ["v"],
      wrap: false,
    });
    expect(col(out, "v")).toEqual([0, 0]);
  });

  it("clamps on an open path whatever wrap says", async () => {
    const on = await gather(OPEN(), stations([-100, 100]), { attributes: ["v"], wrap: true });
    const off = await gather(OPEN(), stations([-100, 100]), { attributes: ["v"], wrap: false });
    expect(col(on, "v")).toEqual([0, 60]);
    expect(col(off, "v")).toEqual([0, 60]);
  });

  it("wraps a closed path of two distinct points, whose whole arc is out and back", async () => {
    // The smallest closed path there is: three vertices over two points,
    // so the arc table is [0, 4, 8] and the second segment is the return
    // leg. It needs no special case and must not get one.
    const path = pathWith([0, 0, 0, 4, 0, 0], "v", [0, 10], 1, true);
    const out = await gather(path, stations([0, 2, 4, 6, 8, 10, -2]), { attributes: ["v"] });
    expect(col(out, "v")).toEqual([0, 5, 10, 5, 0, 5, 5]);
  });

  it("agrees with the closed path's own chord table, closing segment included", async () => {
    // The four knots and the four midpoints, checked against the table
    // [0, 10, 20, 30, 40] written out by hand.
    const at = stations([0, 5, 10, 15, 20, 25, 30, 35]);
    const out = await gather(CLOSED(), at, { attributes: ["P"] });
    expect(positionsOf(out)).toEqual([
      [0, 0, 0],
      [5, 0, 0],
      [10, 0, 0],
      [10, 0, 5],
      [10, 0, 10],
      [5, 0, 10],
      [0, 0, 10],
      [0, 0, 5],
    ]);
  });
});

describe("transferAlongPath: which attributes", () => {
  it("takes every numeric non-bookkeeping column when the list is empty", async () => {
    const path = OPEN();
    path.attrs.point.add("halfWidth", "f32", 1, 0).data.set([4, 4, 4, 4]);
    // Bookkeeping, deliberately excluded — and given values that would be
    // obvious if they leaked through.
    path.attrs.point.add("seed", "u32", 1, 0).data.set([7, 7, 7, 7]);
    path.attrs.point.add("color", "f32", 4, 0);
    // A string column, which no interpolation can produce a value between.
    path.attrs.point.add("kind", "string", 1, "rib");

    const out = await gather(path, stations([2]));
    expect(col(out, "v")).toEqual([20]);
    expect(col(out, "halfWidth")).toEqual([4]);
    // The at cloud's own seed and color survive untouched at their
    // createPointCloud defaults rather than being blended from the path.
    expect(out.attrs.point.require("seed").type).toBe("u32");
    expect(col(out, "seed")).toEqual([0]);
    expect(col(out, "color")).toEqual([1, 1, 1, 1]);
    expect(out.attrs.point.get("kind")).toBeUndefined();
  });

  it("samples an excluded column when it is named explicitly", async () => {
    const path = OPEN();
    path.attrs.point.add("density", "f32", 1, 0).data.set([1, 2, 3, 4]);
    const out = await gather(path, stations([2]), { attributes: ["density"] });
    expect(col(out, "density")).toEqual([2.5]);
  });

  it("refuses `seed` on an ordinary cloud, whose own seed is u32", async () => {
    // The one bookkeeping column naming CANNOT rescue: a sample lands as
    // f32 and every cloud in the library carries seed as u32, so the
    // reporting-slot rule refuses it rather than replacing an identity
    // with a blend of two identities. Pinned because the description
    // makes exactly this claim about exactly this column.
    const path = OPEN();
    path.attrs.point.add("seed", "u32", 1, 0).data.set([1, 2, 3, 4]);
    const message = await rejection(gather(path, stations([2]), { attributes: ["seed"] }));
    expect(message).toContain('the sampled attribute "seed" already exists');
    expect(message).toContain("would DELETE");
    // The six that ARE f32 on both sides land without complaint.
    const ok = OPEN();
    ok.attrs.point.add("density", "f32", 1, 0).data.set([1, 2, 3, 4]);
    ok.attrs.point.add("color", "f32", 4, 0);
    const out = await gather(ok, stations([2]), { attributes: ["density", "color"] });
    expect(col(out, "density")).toEqual([2.5]);
  });

  it("moves the cloud onto the curve when P is named", async () => {
    // The open reference path runs along x, so its arc coordinate and its
    // x agree and the expectation reads as the stations themselves. The
    // closed square above is where a bend makes the two differ.
    const at = stations([0, 1.5, 6]);
    const out = await gather(OPEN(), at, { attributes: ["P"] });
    expect(positionsOf(out)).toEqual([
      [0, 0, 0],
      [1.5, 0, 0],
      [6, 0, 0],
    ]);
    // The cloud's own P column, not a reshaped one.
    expect(out.attrs.point.require("P").tupleSize).toBe(3);
  });

  it("leaves P alone when it is not named", async () => {
    const at = stations([2]);
    at.attrs.point.require("P").setTuple(0, [9, 9, 9]);
    const out = await gather(OPEN(), at, { attributes: ["v"] });
    expect(positionsOf(out)).toEqual([[9, 9, 9]]);
  });
});

describe("transferAlongPath: normalize", () => {
  /** Two points a unit apart carrying two perpendicular unit directions. */
  const DIRS = () => pathWith([0, 0, 0, 1, 0, 0], "dir", [1, 0, 0, 0, 0, 1], 3);

  it("leaves a blended direction short when normalize is empty", async () => {
    const out = await gather(DIRS(), stations([0.5]), { attributes: ["dir"] });
    const [x, y, z] = col(out, "dir");
    expect([x, y, z]).toEqual([0.5, 0, 0.5]);
    expect(Math.hypot(x, y, z)).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("rescales a named column back to unit length", async () => {
    const out = await gather(DIRS(), stations([0.5]), {
      attributes: ["dir"],
      normalize: ["dir"],
    });
    const [x, y, z] = col(out, "dir");
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    expect(x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(z).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("normalizes each named column independently and re-orthogonalises none", async () => {
    // Two axes that are perpendicular at BOTH path points but whose
    // blends at the midpoint are not: 45 degrees apart, not 90. Unit
    // length is restored; the angle between them is not, which is what
    // the param's description says and what a caller must not assume away.
    const path = pathWith([0, 0, 0, 1, 0, 0], "a", [1, 0, 0, 0, 0, 1], 3);
    path.attrs.point.add("b", "f32", 3, 0).data.set([0, 0, 1, -1, 0, 0]);
    const out = await gather(path, stations([0.5]), {
      attributes: ["a", "b"],
      normalize: ["a", "b"],
    });
    const [ax, ay, az] = col(out, "a");
    const [bx, by, bz] = col(out, "b");
    expect(Math.hypot(ax, ay, az)).toBeCloseTo(1, 6);
    expect(Math.hypot(bx, by, bz)).toBeCloseTo(1, 6);
    expect(ax * bx + ay * by + az * bz).toBeCloseTo(0, 6);
    // Perpendicular here only because the two blends happen to be; the
    // frame's third axis is what actually shows the point.
    const path2 = pathWith([0, 0, 0, 1, 0, 0], "a", [1, 0, 0, 0, 0, 1], 3);
    path2.attrs.point.add("b", "f32", 3, 0).data.set([0, 1, 0, 0, 1, 0]);
    const out2 = await gather(path2, stations([0.5]), {
      attributes: ["a", "b"],
      normalize: ["a", "b"],
    });
    const a2 = col(out2, "a");
    const b2 = col(out2, "b");
    // `a` turned 45 degrees while `b` stayed put, so the pair is still
    // orthogonal here but no longer describes the frame either point had.
    expect(a2[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(b2).toEqual([0, 1, 0]);
  });

  it("leaves a zero-length blend alone rather than dividing by zero", async () => {
    // Two directions that cancel exactly at the midpoint.
    const path = pathWith([0, 0, 0, 1, 0, 0], "dir", [1, 0, 0, -1, 0, 0], 3);
    const out = await gather(path, stations([0.5]), {
      attributes: ["dir"],
      normalize: ["dir"],
    });
    expect(col(out, "dir")).toEqual([0, 0, 0]);
  });
});

describe("transferAlongPath: what it refuses", () => {
  it("refuses an empty arcAttr", async () => {
    expect(
      await rejection(gather(OPEN(), stations([0]), { arcAttr: "" })),
    ).toContain('param "arcAttr" must be a non-empty attribute name');
  });

  it("names the available columns when arcAttr is missing", async () => {
    const at = createPointCloud(1);
    const message = await rejection(gather(OPEN(), at, { attributes: ["v"] }));
    expect(message).toContain('point attribute "station", which does not exist on the `at` input');
    expect(message).toContain("boundsMin");
  });

  it("refuses a string arc column", async () => {
    const at = createPointCloud(1);
    at.attrs.point.add("station", "string", 1, "start");
    expect(await rejection(gather(OPEN(), at, { attributes: ["v"] }))).toContain(
      "an arc position is measured, not spelled",
    );
  });

  it("refuses an arc column wider than one component", async () => {
    const at = createPointCloud(1);
    at.attrs.point.add("station", "f32", 3, 0);
    expect(await rejection(gather(OPEN(), at, { attributes: ["v"] }))).toContain(
      "it must be scalar (tupleSize 1)",
    );
  });

  it("refuses a NaN or infinite station, naming the point", async () => {
    const nan = await rejection(
      gather(OPEN(), stations([1, Number.NaN]), { attributes: ["v"] }),
    );
    expect(nan).toContain("point 1 of the `at` input has arc position NaN");
    const inf = await rejection(
      gather(OPEN(), stations([Number.POSITIVE_INFINITY]), { attributes: ["v"] }),
    );
    expect(inf).toContain("point 0 of the `at` input has arc position Infinity");
  });

  it("refuses a path with no polyline, and a path of one point", async () => {
    const bare = await rejection(gather(createPointCloud(4), stations([0])));
    expect(bare).toContain("input has no polyline primitives");
    // createPolyline refuses one point outright, so a single-point cloud
    // with a primitive over it is the shape that reaches this node.
    const lone = createPointCloud(1);
    expect(await rejection(gather(lone, stations([0])))).toContain(
      "a plain point cloud (1 points, 0 primitives)",
    );
  });

  it("refuses a path whose points all coincide", async () => {
    const flat = pathWith([2, 2, 2, 2, 2, 2, 2, 2, 2], "v", [0, 1, 2]);
    expect(await rejection(gather(flat, stations([0])))).toContain("has zero length");
  });

  it("refuses a path input holding more than one polyline", async () => {
    const two = createPolyline([0, 0, 0, 1, 0, 0]);
    const P = two.attrs.point;
    P.resize(4);
    P.require("P").setTuple(2, [0, 5, 0]);
    P.require("P").setTuple(3, [1, 5, 0]);
    two.setTopology(
      Uint32Array.of(0, 1, 2, 3),
      Uint32Array.of(0, 2),
      Uint32Array.of(2, 2),
    );
    two.attrs.primitive.replace("primtype", "string", 1, "polyline");
    const message = await rejection(gather(two, stations([0]), { attributes: ["P"] }));
    expect(message).toContain("holds 2 polylines");
    expect(message).toContain("gathering off the wrong road");
  });

  it("names what the path carries when an attribute is missing", async () => {
    const message = await rejection(gather(OPEN(), stations([0]), { attributes: ["nope"] }));
    expect(message).toContain('names point attribute "nope", which the path input does not have');
    expect(message).toContain("P, v");
  });

  it("refuses a string attribute by name", async () => {
    const path = OPEN();
    path.attrs.point.add("kind", "string", 1, "rib");
    expect(await rejection(gather(path, stations([0]), { attributes: ["kind"] }))).toContain(
      "there is no value between two strings",
    );
  });

  it("refuses an empty or repeated entry in either list", async () => {
    expect(await rejection(gather(OPEN(), stations([0]), { attributes: [""] }))).toContain(
      'param "attributes" holds an empty name',
    );
    expect(
      await rejection(gather(OPEN(), stations([0]), { attributes: ["v", "v"] })),
    ).toContain('param "attributes" names "v" twice');
    expect(
      await rejection(
        gather(OPEN(), stations([0]), { attributes: ["v"], normalize: ["v", "v"] }),
      ),
    ).toContain('param "normalize" names "v" twice');
  });

  it("refuses a normalize name it is not sampling", async () => {
    const message = await rejection(
      gather(OPEN(), stations([0]), { attributes: ["v"], normalize: ["tangent"] }),
    );
    expect(message).toContain('names "tangent", which this node is not sampling');
    expect(message).toContain("Sampling: v");
  });

  it("refuses normalizing a scalar, and refuses normalizing P", async () => {
    expect(
      await rejection(gather(OPEN(), stations([0]), { attributes: ["v"], normalize: ["v"] })),
    ).toContain("unit length on a single component is its sign");
    expect(
      await rejection(gather(OPEN(), stations([0]), { attributes: ["P"], normalize: ["P"] })),
    ).toContain("would put every point of the cloud on a sphere");
  });

  it("refuses to reshape a column the `at` cloud already carries", async () => {
    const path = pathWith([0, 0, 0, 1, 0, 0], "w", [1, 2, 3, 4, 5, 6], 3);
    const at = stations([0.5]);
    at.attrs.point.add("w", "f32", 1, 0);
    const message = await rejection(gather(path, at, { attributes: ["w"] }));
    expect(message).toContain("the sampled attribute");
    expect(message).toContain("would DELETE");
  });

  it("refuses P against an `at` input that has none", async () => {
    // Not a cloud this library builds — createPointCloud always writes P —
    // but a hand-assembled Geometry can arrive without one, and the
    // message has to say so rather than reshaping the column.
    const at = new Geometry();
    at.attrs.point.add("station", "f32", 1, 0);
    at.attrs.point.resize(1);
    expect(await rejection(gather(OPEN(), at, { attributes: ["P"] }))).toContain(
      "the `at` input's own P is missing",
    );
  });

  it("refuses an empty list against a path with nothing left to sample", async () => {
    const message = await rejection(gather(createPolyline([0, 0, 0, 1, 0, 0]), stations([0])));
    expect(message).toContain("the path has none left");
    expect(message).toContain("naming P is how a cloud of stations is placed onto the curve");
  });
});

describe("transferAlongPath: what it preserves", () => {
  it("keeps the cloud's count, order and topology", async () => {
    // The `at` input is itself a path here: this node removes no point,
    // so what arrives a path leaves a path.
    const at = createPolyline([0, 0, 0, 1, 0, 0, 2, 0, 0]);
    at.attrs.point.add("station", "f32", 1, 0).data.set([0, 3, 6]);
    const out = await gather(OPEN(), at, { attributes: ["v"] });
    expect(out.attrs.point.count).toBe(3);
    expect(out.primitiveCount).toBe(1);
    expect(Array.from(out.vertexToPoint)).toEqual([0, 1, 2]);
    expect(col(out, "v")).toEqual([0, 30, 60]);
  });

  it("writes the columns onto an empty cloud without reading the path", async () => {
    // An empty cloud is a legitimate cook result, not a mistake, so the
    // columns still arrive — a downstream node reading them by name must
    // not find them missing merely because nothing survived a filter.
    const out = await gather(OPEN(), stations([]), { attributes: ["v"] });
    expect(out.attrs.point.count).toBe(0);
    expect(out.attrs.point.require("v").type).toBe("f32");
  });

  it("cooks byte-identically twice", async () => {
    const params = { attributes: ["P", "v"], normalize: [] };
    const a = await gather(CLOSED(), stations([0, 7.5, 33, -12, 91]), params);
    const b = await gather(CLOSED(), stations([0, 7.5, 33, -12, 91]), params);
    expect(snapshotGeometry(a)).toEqual(snapshotGeometry(b));
  });

  it("answers each point from its own station and nothing else", async () => {
    // The same five stations in two orders. Every point's answer must
    // follow its own value, so the reversed cook is the reversed result —
    // no reduction over the cloud, no dependence on a neighbour.
    const order = [0, 7.5, 33, -12, 91];
    const forward = await gather(CLOSED(), stations(order), { attributes: ["v"] });
    const backward = await gather(CLOSED(), stations([...order].reverse()), {
      attributes: ["v"],
    });
    expect(col(backward, "v")).toEqual([...col(forward, "v")].reverse());
  });

  it("gives one station the same answer whatever else is in the cloud", async () => {
    const alone = await gather(CLOSED(), stations([33]), { attributes: ["v"] });
    const crowd = await gather(CLOSED(), stations([1, 2, 33, 4, 5]), { attributes: ["v"] });
    expect(col(crowd, "v")[2]).toBe(col(alone, "v")[0]);
  });
});
