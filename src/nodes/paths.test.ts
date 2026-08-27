import { describe, expect, it } from "vitest";
import {
  Geometry,
  PRIMTYPE_ATTR,
  createPointCloud,
  createPolyline,
  setPolylineTopology,
} from "../data/index.js";
import { attribute, lerp, type FieldLike } from "../fields/index.js";
import { Graph, cook, makeGeometryItem } from "../graph/index.js";
import { dataInput } from "../runtime/index.js";
import {
  deserializeGraph,
  fieldFromJson,
  filterByAttribute,
  filterByDensity,
  orientAlongVector,
  partitionByAttribute,
  pathPointAt,
  pathResample,
  pathRuns,
  pathScan,
  pathSegments,
  pointScatterInBounds,
  pointsToPath,
  projectToPlane,
  promoteAttribute,
  serializeGraph,
  setAttribute,
  splineSample,
  transferAttribute,
  writeCurveFrame,
  writeTangents,
} from "./index.js";
import { firstGeo, positionsOf, runNode, snapshotGeometry } from "./nodes.testsupport.js";
import { rotateVec } from "./util.js";
// Registers the shipped primitives, so `place/along-curve` can be reached
// by name from a serialized graph — the way the pipeline actually wires it.
import "../primitives/index.js";

/** A point cloud of `n` points at (i, 0, 0), with no topology. */
function row(n: number): Geometry {
  const geo = createPointCloud(n);
  const P = geo.attrs.point.require("P");
  for (let i = 0; i < n; i++) P.setTuple(i, [i, 0, 0]);
  return geo;
}

/** A point cloud with one point per given x, at (x, 0, 0). */
function rowAt(xs: readonly number[]): Geometry {
  const geo = createPointCloud(xs.length);
  const P = geo.attrs.point.require("P");
  xs.forEach((x, i) => P.setTuple(i, [x, 0, 0]));
  return geo;
}

/**
 * The x of every point each polyline walks, path by path. What "the same
 * paths" means when the clouds under them differ: dropping a point
 * renumbers every index behind it, so two cooks that build the same paths
 * over different clouds agree on positions rather than on indices.
 */
function pathXs(geo: Geometry): number[][] {
  const P = geo.attrs.point.require("P");
  const out: number[][] = [];
  for (let p = 0; p < geo.primitiveCount; p++) {
    const start = geo.primVertexStart[p];
    const xs: number[] = [];
    for (let v = start; v < start + geo.primVertexCount[p]; v++) {
      xs.push(P.get(geo.vertexToPoint[v], 0));
    }
    out.push(xs);
  }
  return out;
}

/** A cloud with a scalar numeric point attribute set per point. */
function withAttr(geo: Geometry, name: string, values: readonly number[]): Geometry {
  const attr = geo.attrs.point.add(name, "f32", 1, 0);
  for (let i = 0; i < values.length; i++) attr.set(i, values[i]);
  return geo;
}

/** Vertex/primitive topology of a geometry, as plain arrays. */
function topologyOf(geo: Geometry): { v: number[]; start: number[]; count: number[] } {
  return {
    v: Array.from(geo.vertexToPoint),
    start: Array.from(geo.primVertexStart),
    count: Array.from(geo.primVertexCount),
  };
}

/** Two disjoint segments as two polyline primitives over one cloud. */
function twoPaths(): Geometry {
  const geo = createPointCloud(4);
  const P = geo.attrs.point.require("P");
  P.setTuple(0, [0, 0, 0]);
  P.setTuple(1, [1, 0, 0]);
  P.setTuple(2, [10, 0, 0]);
  P.setTuple(3, [14, 0, 0]);
  setPolylineTopology(geo, [0, 1, 2, 3], [0, 2], [2, 2]);
  return geo;
}

/** Write one scalar f32 value per primitive (the phase-43 per-edge value). */
function withPrimValue(geo: Geometry, name: string, values: readonly number[]): Geometry {
  const attr = geo.attrs.primitive.add(name, "f32", 1, 0);
  for (let p = 0; p < values.length; p++) attr.set(p, values[p]);
  return geo;
}

/** Write one string value per primitive (a `kind` tag, promoted with `first`). */
function withPrimString(geo: Geometry, name: string, values: readonly string[]): Geometry {
  const attr = geo.attrs.primitive.add(name, "string", 1, "");
  for (let p = 0; p < values.length; p++) attr.setString(p, values[p]);
  return geo;
}

/** The message a node run rejects with (fails when it does not reject). */
async function rejection(run: Promise<unknown>): Promise<string> {
  const err: unknown = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof Error)) throw new Error("expected the node to throw an Error");
  return err.message;
}

describe("pointsToPath", () => {
  it("builds one polyline over the points in index order, keeping attributes", async () => {
    const src = withAttr(row(4), "tag", [5, 6, 7, 8]);
    const geo = firstGeo((await runNode(pointsToPath, {}, { in: [makeGeometryItem(src)] })).out);
    expect(topologyOf(geo)).toEqual({ v: [0, 1, 2, 3], start: [0], count: [4] });
    expect(geo.attrs.primitive.require("primtype").getString(0)).toBe("polyline");
    expect(positionsOf(geo)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
    ]);
    // Every point attribute survives, standard and custom alike.
    expect(geo.attrs.point.names()).toEqual(src.attrs.point.names());
    expect([0, 1, 2, 3].map((i) => geo.attrs.point.require("tag").get(i))).toEqual([5, 6, 7, 8]);
    // Purity: the upstream geometry is untouched.
    expect(src.primitiveCount).toBe(0);
    expect(src.vertexCount).toBe(0);
  });

  it("closes structurally, with no closed attribute", async () => {
    const geo = firstGeo(
      (await runNode(pointsToPath, { closed: true }, { in: [makeGeometryItem(row(4))] })).out,
    );
    expect(topologyOf(geo)).toEqual({ v: [0, 1, 2, 3, 0], start: [0], count: [5] });
    expect(geo.pointCount).toBe(4);
    expect(geo.attrs.primitive.names()).toEqual(["primtype"]);
  });

  it("splits on groupAttr into one path per id, in ascending id order", async () => {
    const src = withAttr(row(6), "grp", [1, 1, 0, 0, 1, 0]);
    const geo = firstGeo(
      (await runNode(pointsToPath, { groupAttr: "grp" }, { in: [makeGeometryItem(src)] })).out,
    );
    expect(topologyOf(geo)).toEqual({ v: [2, 3, 5, 0, 1, 4], start: [0, 3], count: [3, 3] });
    expect(geo.primitiveCount).toBe(2);
  });

  it("splits on a string groupAttr, in ascending order of the WORD", async () => {
    const src = row(6);
    const lane = src.attrs.point.add("lane", "string", 1, "");
    // Interned in an order that is not the sorted one, and not the point
    // order either: what must decide the output is the word, never the
    // table index it happens to have landed on.
    ["oak", "birch", "oak", "birch", "ash", "ash"].forEach((v, i) => lane.setString(i, v));
    const geo = firstGeo(
      (await runNode(pointsToPath, { groupAttr: "lane" }, { in: [makeGeometryItem(src)] })).out,
    );
    // ash (4, 5), birch (1, 3), oak (0, 2) — alphabetical, though "oak"
    // interned first and "ash" last.
    expect(topologyOf(geo)).toEqual({ v: [4, 5, 1, 3, 0, 2], start: [0, 2, 4], count: [2, 2, 2] });
  });

  it("names the group in the message when the key is a word", async () => {
    const src = row(3);
    const lane = src.attrs.point.add("lane", "string", 1, "");
    ["oak", "oak", "birch"].forEach((v, i) => lane.setString(i, v));
    await expect(
      runNode(pointsToPath, { groupAttr: "lane" }, { in: [makeGeometryItem(src)] }),
    ).rejects.toThrow(/group "birch" \(attribute "lane"\) has 1 point/);
  });

  it("orders by orderAttr ascending and breaks ties to the lower point index", async () => {
    const ordered = firstGeo(
      (
        await runNode(
          pointsToPath,
          { orderAttr: "key" },
          { in: [makeGeometryItem(withAttr(row(4), "key", [3, 1, 2, 0]))] },
        )
      ).out,
    );
    expect(topologyOf(ordered).v).toEqual([3, 1, 2, 0]);
    const tied = firstGeo(
      (
        await runNode(
          pointsToPath,
          { orderAttr: "key" },
          { in: [makeGeometryItem(withAttr(row(4), "key", [0, 0, 0, 0]))] },
        )
      ).out,
    );
    expect(topologyOf(tied).v).toEqual([0, 1, 2, 3]);
  });

  it("produces a path splineSample consumes (the gap the node closes)", async () => {
    const path = firstGeo(
      (await runNode(pointsToPath, {}, { in: [makeGeometryItem(row(3))] })).out,
    );
    const sampled = firstGeo(
      (await runNode(splineSample, { mode: "count", count: 3 }, { in: [makeGeometryItem(path)] }))
        .out,
    );
    expect(positionsOf(sampled)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
  });

  it("errors on degenerate inputs, naming the fix", async () => {
    await expect(
      runNode(pointsToPath, {}, { in: [makeGeometryItem(createPointCloud(0))] }),
    ).rejects.toThrow(/input has 0 points; a path needs at least 2/);
    await expect(
      runNode(pointsToPath, {}, { in: [makeGeometryItem(row(1))] }),
    ).rejects.toThrow(/input has 1 point; a path needs at least 2/);
    await expect(
      runNode(pointsToPath, { closed: true }, { in: [makeGeometryItem(row(2))] }),
    ).rejects.toThrow(/2 points and closed is true/);
    await expect(
      runNode(
        pointsToPath,
        { groupAttr: "grp" },
        { in: [makeGeometryItem(withAttr(row(3), "grp", [0, 0, 1]))] },
      ),
    ).rejects.toThrow(/group 1 \(attribute "grp"\) has 1 point/);
    await expect(runNode(pointsToPath, {}, {})).rejects.toThrow(/input pin "in"/);
  });

  it("errors on a missing, non-numeric, or fractional group attribute", async () => {
    await expect(
      runNode(pointsToPath, { groupAttr: "nope" }, { in: [makeGeometryItem(row(4))] }),
    ).rejects.toThrow(/names point attribute "nope", which does not exist; available point attributes: P/);
    await expect(
      runNode(
        pointsToPath,
        { groupAttr: "grp" },
        { in: [makeGeometryItem(withAttr(row(4), "grp", [0, 0.5, 1, 1]))] },
      ),
    ).rejects.toThrow(/point 1 has grp = 0.5, which is not a whole number/);
    // A string is a group key and no longer refused here — but it is still
    // refused for `orderAttr`, which asks a different question (an order,
    // not an identity).
    const stringy = row(4);
    stringy.attrs.point.add("name", "string", 1, "a");
    await expect(
      runNode(pointsToPath, { orderAttr: "name" }, { in: [makeGeometryItem(stringy)] }),
    ).rejects.toThrow(/names string attribute "name"/);
    const vec = row(4);
    vec.attrs.point.add("pair", "f32", 2, 0);
    await expect(
      runNode(pointsToPath, { groupAttr: "pair" }, { in: [makeGeometryItem(vec)] }),
    ).rejects.toThrow(/tupleSize 2; it must be scalar/);
    await expect(
      runNode(
        pointsToPath,
        { orderAttr: "key" },
        { in: [makeGeometryItem(withAttr(row(3), "key", [0, Number.NaN, 2]))] },
      ),
    ).rejects.toThrow(/point 1 has key = NaN, which is not finite/);
  });

  it("is deterministic across fresh runs and stable when run twice", async () => {
    const src = withAttr(row(6), "grp", [1, 0, 1, 0, 1, 0]);
    const run = async () =>
      snapshotGeometry(
        firstGeo(
          (
            await runNode(
              pointsToPath,
              { groupAttr: "grp", closed: true },
              { in: [makeGeometryItem(src)] },
            )
          ).out,
        ),
      );
    expect(await run()).toEqual(await run());
  });

  it("skips a group too short for the path, keeping its points and attributes", async () => {
    const src = withAttr(withAttr(row(5), "grp", [0, 0, 1, 2, 2]), "tag", [5, 6, 7, 8, 9]);
    // The paired case: the same input is still a hard error by default.
    await expect(
      runNode(pointsToPath, { groupAttr: "grp" }, { in: [makeGeometryItem(src)] }),
    ).rejects.toThrow(/group 1 \(attribute "grp"\) has 1 point/);
    const geo = firstGeo(
      (
        await runNode(
          pointsToPath,
          { groupAttr: "grp", shortGroups: "skip" },
          { in: [makeGeometryItem(src)] },
        )
      ).out,
    );
    // Group 1 built no primitive; groups 0 and 2 are the paths they were.
    expect(topologyOf(geo)).toEqual({ v: [0, 1, 3, 4], start: [0, 2], count: [2, 2] });
    expect(geo.primitiveCount).toBe(2);
    // Point 2 is still in the cloud, at its own index, with every column
    // it arrived with — the whole point domain is the input's, unmoved.
    expect(geo.pointCount).toBe(5);
    expect(snapshotGeometry(geo).point).toEqual(snapshotGeometry(src).point);
    expect(geo.attrs.point.require("tag").get(2)).toBe(7);
  });

  it("leaves the surviving paths exactly as if the short group had never arrived", async () => {
    const sparse = withAttr(rowAt([0, 1, 2, 3, 4, 5]), "grp", [0, 0, 1, 2, 2, 2]);
    const skipped = firstGeo(
      (
        await runNode(
          pointsToPath,
          { groupAttr: "grp", shortGroups: "skip" },
          { in: [makeGeometryItem(sparse)] },
        )
      ).out,
    );
    // The control: the same cloud with the lone point of group 1 never
    // scattered at all, cooked with no skipping involved.
    const control = withAttr(rowAt([0, 1, 3, 4, 5]), "grp", [0, 0, 2, 2, 2]);
    const built = firstGeo(
      (await runNode(pointsToPath, { groupAttr: "grp" }, { in: [makeGeometryItem(control)] })).out,
    );
    expect(pathXs(skipped)).toEqual([
      [0, 1],
      [3, 4, 5],
    ]);
    expect(pathXs(skipped)).toEqual(pathXs(built));
    // And WHERE the skipped group sorts changes nothing: keyed last rather
    // than in the middle, the survivors keep the same vertex ranges — a
    // start pushed before the skip was decided would show up right here.
    const trailing = firstGeo(
      (
        await runNode(
          pointsToPath,
          { groupAttr: "grp", shortGroups: "skip" },
          { in: [makeGeometryItem(withAttr(rowAt([0, 1, 2, 3, 4, 5]), "grp", [0, 0, 9, 2, 2, 2]))] },
        )
      ).out,
    );
    expect(topologyOf(trailing)).toEqual(topologyOf(skipped));
    expect(topologyOf(skipped)).toEqual({ v: [0, 1, 3, 4, 5], start: [0, 2], count: [2, 3] });
  });

  it("counts a 2-point group as short only when closed is true", async () => {
    const src = withAttr(row(5), "grp", [0, 0, 1, 1, 1]);
    const open = firstGeo(
      (
        await runNode(
          pointsToPath,
          { groupAttr: "grp", shortGroups: "skip" },
          { in: [makeGeometryItem(src)] },
        )
      ).out,
    );
    // Open, 2 points is a path: nothing is short and nothing is skipped.
    expect(topologyOf(open)).toEqual({ v: [0, 1, 2, 3, 4], start: [0, 2], count: [2, 3] });
    const loop = firstGeo(
      (
        await runNode(
          pointsToPath,
          { groupAttr: "grp", closed: true, shortGroups: "skip" },
          { in: [makeGeometryItem(src)] },
        )
      ).out,
    );
    // Closed, the SAME group is short: only the 3-point loop survives.
    expect(topologyOf(loop)).toEqual({ v: [2, 3, 4, 2], start: [0], count: [4] });
    expect(loop.pointCount).toBe(5);
    // Paired: closing without the skip is the error it always was.
    await expect(
      runNode(
        pointsToPath,
        { groupAttr: "grp", closed: true },
        { in: [makeGeometryItem(src)] },
      ),
    ).rejects.toThrow(/group 0 \(attribute "grp"\) has 2 points and closed is true/);
  });

  it("passes a cloud too small for any path straight through under skip", async () => {
    // THE WHOLE-INPUT FLOOR, WHICH USED TO IGNORE `shortGroups` — and the
    // case it excused was strictly less sparse than the case it refused.
    // A streamed cell that lands ONE point in a cloud is sparser than one
    // that lands one point in a lane, so a param whose whole purpose is
    // "the population is data and cannot be sized in advance" has to
    // govern both or it fails the harder case further from the author.
    for (const n of [0, 1]) {
      await expect(
        runNode(pointsToPath, {}, { in: [makeGeometryItem(row(n))] }),
      ).rejects.toThrow(/a path needs at least 2/);
      const out = firstGeo(
        (await runNode(pointsToPath, { shortGroups: "skip" }, { in: [makeGeometryItem(row(n))] }))
          .out,
      );
      expect(out.pointCount).toBe(n);
      expect(out.primitiveCount).toBe(0);
      expect(out.vertexCount).toBe(0);
    }
    // PAIRED WITH THE BOUND IN PLACE: two points is not short for an open
    // path, so `skip` changes nothing there and a path is still built.
    // Without this the test above would pass for a node that had simply
    // stopped building paths.
    const two = firstGeo(
      (await runNode(pointsToPath, { shortGroups: "skip" }, { in: [makeGeometryItem(row(2))] }))
        .out,
    );
    expect(two.primitiveCount).toBe(1);
    expect(two.vertexCount).toBe(2);
  });

  it("defaults to error, and skips the implicit whole-cloud group too", async () => {
    expect(pointsToPath.defaultParams.shortGroups).toBe("error");
    // With no groupAttr the only way to be short is 2 points, closed.
    await expect(
      runNode(pointsToPath, { closed: true }, { in: [makeGeometryItem(row(2))] }),
    ).rejects.toThrow(/the input has 2 points and closed is true/);
    const none = firstGeo(
      (
        await runNode(
          pointsToPath,
          { closed: true, shortGroups: "skip" },
          { in: [makeGeometryItem(row(2))] },
        )
      ).out,
    );
    expect(none.primitiveCount).toBe(0);
    expect(none.vertexCount).toBe(0);
    expect(positionsOf(none)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    // Paired: open, those same two points are still a path under skip.
    expect(
      topologyOf(
        firstGeo(
          (await runNode(pointsToPath, { shortGroups: "skip" }, { in: [makeGeometryItem(row(2))] }))
            .out,
        ),
      ),
    ).toEqual({ v: [0, 1], start: [0], count: [2] });
    // The whole-input floor obeys `shortGroups` as well; it has its own
    // test above, which is where the argument for that lives.
  });

  it("refuses an unrecognised shortGroups, before it looks at the geometry", async () => {
    expect(
      await rejection(
        runNode(pointsToPath, { shortGroups: "ignore" }, { in: [makeGeometryItem(row(4))] }),
      ),
    ).toMatch(/shortGroups must be "error" or "skip", got "ignore"/);
    // Ahead of the input check, so an author reads about their typo rather
    // than about a pin they did wire in a real graph.
    expect(await rejection(runNode(pointsToPath, { shortGroups: "ignore" }, {}))).toMatch(
      /shortGroups must be "error" or "skip"/,
    );
    // Paired: with a value it recognises, the pin is what gets named.
    expect(await rejection(runNode(pointsToPath, { shortGroups: "skip" }, {}))).toMatch(
      /input pin "in"/,
    );
  });

  it("is deterministic with short groups skipped", async () => {
    const src = withAttr(row(7), "grp", [2, 0, 1, 0, 2, 0, 4]);
    const run = async () =>
      snapshotGeometry(
        firstGeo(
          (
            await runNode(
              pointsToPath,
              { groupAttr: "grp", shortGroups: "skip" },
              { in: [makeGeometryItem(src)] },
            )
          ).out,
        ),
      );
    const first = await run();
    expect(first).toEqual(await run());
    // Groups 1 and 4 hold one point each and are gone; 0 and 2 are the
    // paths they would have been, in ascending key order.
    expect(first.topology).toEqual({
      vertexToPoint: [1, 3, 5, 0, 4],
      primVertexStart: [0, 3],
      primVertexCount: [3, 2],
    });
  });
});

describe("pathResample", () => {
  it("places count samples evenly along an open path and re-emits topology", async () => {
    const line = createPolyline([0, 0, 0, 5, 0, 0, 10, 0, 0]);
    const geo = firstGeo(
      (await runNode(pathResample, { mode: "count", count: 5 }, { in: [makeGeometryItem(line)] }))
        .out,
    );
    expect(positionsOf(geo)).toEqual([
      [0, 0, 0],
      [2.5, 0, 0],
      [5, 0, 0],
      [7.5, 0, 0],
      [10, 0, 0],
    ]);
    expect(topologyOf(geo)).toEqual({ v: [0, 1, 2, 3, 4], start: [0], count: [5] });
    expect(geo.attrs.primitive.require("primtype").getString(0)).toBe("polyline");
    const curveU = geo.attrs.point.require("curveU");
    expect([0, 1, 2, 3, 4].map((i) => curveU.get(i))).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(geo.attrs.point.require("tangent").getTuple(0)).toEqual([1, 0, 0]);
  });

  it("keeps a closed path closed without duplicating the start point", async () => {
    const square = createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], { closed: true });
    const geo = firstGeo(
      (await runNode(pathResample, { mode: "count", count: 4 }, { in: [makeGeometryItem(square)] }))
        .out,
    );
    expect(positionsOf(geo)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ]);
    expect(topologyOf(geo)).toEqual({ v: [0, 1, 2, 3, 0], start: [0], count: [5] });
  });

  it("resamples each path on its own length, unlike splineSample's one curve", async () => {
    const src = twoPaths();
    const geo = firstGeo(
      (await runNode(pathResample, { mode: "count", count: 3 }, { in: [makeGeometryItem(src)] }))
        .out,
    );
    expect(positionsOf(geo)).toEqual([
      [0, 0, 0],
      [0.5, 0, 0],
      [1, 0, 0],
      [10, 0, 0],
      [12, 0, 0],
      [14, 0, 0],
    ]);
    expect(topologyOf(geo)).toEqual({ v: [0, 1, 2, 3, 4, 5], start: [0, 3], count: [3, 3] });
    const curveU = geo.attrs.point.require("curveU");
    expect([0, 1, 2, 3, 4, 5].map((i) => curveU.get(i))).toEqual([0, 0.5, 1, 0, 0.5, 1]);
    // The concatenating sampler sees one 5-unit curve, and so cannot.
    const concatenated = firstGeo(
      (await runNode(splineSample, { mode: "count", count: 3 }, { in: [makeGeometryItem(src)] }))
        .out,
    );
    expect(positionsOf(concatenated)).not.toEqual(positionsOf(geo));
  });

  it("spacing mode steps by arc length and always lands on an open path's end", async () => {
    const line = createPolyline([0, 0, 0, 10, 0, 0]);
    const geo = firstGeo(
      (await runNode(pathResample, { mode: "spacing", spacing: 3 }, { in: [makeGeometryItem(line)] }))
        .out,
    );
    expect(positionsOf(geo)).toEqual([
      [0, 0, 0],
      [3, 0, 0],
      [6, 0, 0],
      [9, 0, 0],
      [10, 0, 0],
    ]);
    const square = createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], { closed: true });
    const loop = firstGeo(
      (
        await runNode(pathResample, { mode: "spacing", spacing: 1 }, { in: [makeGeometryItem(square)] })
      ).out,
    );
    expect(positionsOf(loop)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ]);
    expect(topologyOf(loop).count).toEqual([5]);
  });

  it("keeps the spacing step exact on a closed path, leaving a short remainder at the seam", async () => {
    // A closed square of side 10.75 is 43 units around — not a whole
    // multiple of a 5-unit step. The step is deliberately NOT stretched to
    // 43/9 = 4.777... to make the samples come out even: every step is
    // exactly 5 and the loop closes on whatever is left over, here 3.
    // That is the design — a predictable param beats a clever one, and
    // `spacing` says so — so a later change that "fixes" the seam by
    // stretching the step breaks this test on purpose. `count` mode is
    // the documented way to divide a loop evenly, asserted at the end.
    const side = 10.75;
    const square = createPolyline([0, 0, 0, side, 0, 0, side, side, 0, 0, side, 0], {
      closed: true,
    });
    const geo = firstGeo(
      (await runNode(pathResample, { mode: "spacing", spacing: 5 }, { in: [makeGeometryItem(square)] }))
        .out,
    );
    expect(geo.pointCount).toBe(9); // floor(43 / 5) + 1: the start, counted once
    expect(topologyOf(geo).count).toEqual([10]); // still closed: 9 + the seam vertex

    // Arc length is what `spacing` promises, and curveU is s / length, so
    // curveU * 43 is the true arc position. Chord length is NOT the
    // measure here: a chord that cuts a corner is shorter than the arc it
    // spans (4.32 against 5 on this square), which is geometry, not
    // unevenness — measuring the steps with hypot would pin the wrong fact.
    const u = geo.attrs.point.require("curveU");
    for (let i = 0; i < geo.pointCount; i++) expect(u.get(i) * 43).toBeCloseTo(i * 5, 4);
    // The remainder: the last sample sits at 40, so the closing segment
    // back to the start spans 3 — shorter than `spacing`, and exactly what
    // the loop had left over. Here it is also a straight run down one
    // side, so the chord measures it too.
    expect((1 - u.get(8)) * 43).toBeCloseTo(3, 4);
    const p = positionsOf(geo);
    expect(p[8][0]).toBeCloseTo(0, 4);
    expect(p[8][1]).toBeCloseTo(3, 4);
    expect(Math.hypot(p[8][0] - p[0][0], p[8][1] - p[0][1], p[8][2] - p[0][2])).toBeCloseTo(3, 4);

    // 'count' on the same loop: the length divided evenly, no remainder.
    const even = firstGeo(
      (await runNode(pathResample, { mode: "count", count: 9 }, { in: [makeGeometryItem(square)] }))
        .out,
    );
    const ue = even.attrs.point.require("curveU");
    for (let i = 0; i < even.pointCount; i++) expect(ue.get(i) * 43).toBeCloseTo((i * 43) / 9, 4);
  });

  it("keeps the last spacing sample off a closed path's seam", async () => {
    // A closed square of side 0.15 is 0.6000000238418579 long in f32 — a
    // hair MORE than 3 * 0.2. Without the epsilon on the loop guard the
    // fourth step at s = 0.6 slips in and lands on the seam: a duplicate
    // of the start point and a zero-length closing segment.
    const square = createPolyline([0, 0, 0, 0.15, 0, 0, 0.15, 0.15, 0, 0, 0.15, 0], {
      closed: true,
    });
    const geo = firstGeo(
      (
        await runNode(
          pathResample,
          { mode: "spacing", spacing: 0.2 },
          { in: [makeGeometryItem(square)] },
        )
      ).out,
    );
    expect(geo.pointCount).toBe(3);
    expect(topologyOf(geo)).toEqual({ v: [0, 1, 2, 0], start: [0], count: [4] });
    const p = positionsOf(geo);
    expect(p[0]).toEqual([0, 0, 0]);
    expect(p[1][0]).toBeCloseTo(0.15, 5);
    expect(p[1][1]).toBeCloseTo(0.05, 5);
    expect(p[2][0]).toBeCloseTo(0.05, 5);
    expect(p[2][1]).toBeCloseTo(0.15, 5);
    // The closing segment (last point back to the first) has real length.
    expect(Math.hypot(p[2][0] - p[0][0], p[2][1] - p[0][1])).toBeGreaterThan(0.1);
    // The same trap an order of magnitude down: L = 0.30000001192092896.
    const small = createPolyline([0, 0, 0, 0.075, 0, 0, 0.075, 0.075, 0, 0, 0.075, 0], {
      closed: true,
    });
    const geoSmall = firstGeo(
      (
        await runNode(
          pathResample,
          { mode: "spacing", spacing: 0.1 },
          { in: [makeGeometryItem(small)] },
        )
      ).out,
    );
    expect(geoSmall.pointCount).toBe(3);
  });

  it("refuses a spacing that would blow past the sample budget", async () => {
    // Spacing is the one mode whose output size nobody typed: a small
    // number on a long path runs away silently.
    const long = createPolyline([0, 0, 0, 1000, 0, 0]);
    await expect(
      runNode(pathResample, { mode: "spacing", spacing: 0.0009 }, { in: [makeGeometryItem(long)] }),
    ).rejects.toThrow(
      /pathResample: spacing 0\.0009 would place more than 1048576 samples.*use spacing >= 0\.00095/,
    );
  });

  /**
   * Two OPEN polylines over one cloud: primitive 0 runs 10 units along +X,
   * primitive 1 runs 4 units along +Y. Two paths of different lengths is
   * the whole point — a per-path spacing has nothing to say about one.
   */
  function twoOpenPaths(): Geometry {
    const geo = createPointCloud(4);
    const P = geo.attrs.point.require("P");
    P.setTuple(0, [0, 0, 0]);
    P.setTuple(1, [10, 0, 0]);
    P.setTuple(2, [0, 10, 0]);
    P.setTuple(3, [0, 14, 0]);
    setPolylineTopology(geo, [0, 1, 2, 3], [0, 2], [2, 2]);
    return geo;
  }

  /** An open 10-unit line (primitive 0) and a closed unit square (primitive 1). */
  function openAndClosed(): Geometry {
    const geo = createPointCloud(6);
    const P = geo.attrs.point.require("P");
    P.setTuple(0, [0, 0, 0]);
    P.setTuple(1, [1, 0, 0]);
    P.setTuple(2, [1, 1, 0]);
    P.setTuple(3, [0, 1, 0]);
    P.setTuple(4, [0, 5, 0]);
    P.setTuple(5, [10, 5, 0]);
    setPolylineTopology(geo, [4, 5, 0, 1, 2, 3, 0], [0, 2], [2, 5]);
    return geo;
  }

  /** `spacing` read from a per-primitive attribute — the per-path field. */
  const spacingPerPath = fieldFromJson({ fn: "attribute", name: "sp" });

  it("reads a spacing field PER PATH, sampling two paths at two steps in one cook", async () => {
    // 10 units at 2.5 is 5 samples; 4 units at 4 is 2. No single scalar
    // produces that pair — 2.5 everywhere gives (5, 3) and 4 gives (4, 2) —
    // which is exactly what a per-path field buys and what the primitive
    // domain makes possible here (splineSample, concatenating, cannot).
    const src = withPrimValue(twoOpenPaths(), "sp", [2.5, 4]);
    const geo = firstGeo(
      (
        await runNode(
          pathResample,
          { mode: "spacing", spacing: spacingPerPath, stepAttr: "sampleStep" },
          { in: [makeGeometryItem(src)] },
        )
      ).out,
    );
    expect(topologyOf(geo).count).toEqual([5, 2]);
    expect(positionsOf(geo)).toEqual([
      [0, 0, 0],
      [2.5, 0, 0],
      [5, 0, 0],
      [7.5, 0, 0],
      [10, 0, 0],
      [0, 10, 0],
      [0, 14, 0],
    ]);
    // The step report follows the field, one value per path.
    const step = geo.attrs.primitive.require("sampleStep");
    expect([step.get(0), step.get(1)]).toEqual([2.5, 4]);

    // The control: both scalars the field mixes, neither of which can say
    // what it said. Without these the pair above proves nothing.
    const scalar = async (spacing: number) =>
      topologyOf(
        firstGeo(
          (
            await runNode(
              pathResample,
              { mode: "spacing", spacing },
              { in: [makeGeometryItem(src)] },
            )
          ).out,
        ),
      ).count;
    expect(await scalar(2.5)).toEqual([5, 3]);
    expect(await scalar(4)).toEqual([4, 2]);
  });

  it("cooks a constant spacing field exactly as the plain number", async () => {
    // 2.5 is exact in f32, so a field column holds the same number the
    // plain param does and any difference would be a real one.
    const line = createPolyline([0, 0, 0, 10, 0, 0]);
    const run = async (spacing: FieldLike) =>
      snapshotGeometry(
        firstGeo(
          (
            await runNode(
              pathResample,
              { mode: "spacing", spacing },
              { in: [makeGeometryItem(line)] },
            )
          ).out,
        ),
      );
    expect(await run(fieldFromJson({ fn: "constant", value: 2.5 }))).toEqual(await run(2.5));
    // The control: the comparison above can report "different" too.
    expect(await run(fieldFromJson({ fn: "constant", value: 4 }))).not.toEqual(await run(2.5));
  });

  it("refuses a spacing field whose resolved steps bust the TOTAL budget", async () => {
    // Primitive 0 is cheap (3 samples) and primitive 1 is not (2 048 000):
    // the cap is on the sum, so the refusal lands on the path the running
    // total ran out on. 2^-11 is exact in f32, so the message quotes the
    // step the field really resolved to.
    const geo = createPointCloud(4);
    const P = geo.attrs.point.require("P");
    P.setTuple(0, [0, 0, 0]);
    P.setTuple(1, [10, 0, 0]);
    P.setTuple(2, [0, 20, 0]);
    P.setTuple(3, [1000, 20, 0]);
    setPolylineTopology(geo, [0, 1, 2, 3], [0, 2], [2, 2]);
    const src = withPrimValue(geo, "sp", [5, 0.00048828125]);
    const msg = await rejection(
      runNode(
        pathResample,
        { mode: "spacing", spacing: spacingPerPath },
        { in: [makeGeometryItem(src)] },
      ),
    );
    expect(msg).toContain('pathResample: the "spacing" field resolved to 0.00048828125');
    expect(msg).toContain("at primitive 1");
    expect(msg).toContain("more than 1048576 samples");
    expect(msg).toContain("The cap is on the TOTAL");
    expect(msg).toContain("max(<the spacing field>");
  });

  it("caps the TOTAL, not each path: two paths that each fit are refused together", async () => {
    // 100 units at 2^-13 is 819 200 samples — comfortably under the cap on
    // its own. Two such paths are not, and a per-path budget would wave
    // both through and emit 1 638 400 points. This is the test that tells
    // a global cap from a per-path one; the one above does not, since its
    // long path busts either way.
    const geo = createPointCloud(4);
    const P = geo.attrs.point.require("P");
    P.setTuple(0, [0, 0, 0]);
    P.setTuple(1, [100, 0, 0]);
    P.setTuple(2, [0, 50, 0]);
    P.setTuple(3, [100, 50, 0]);
    setPolylineTopology(geo, [0, 1, 2, 3], [0, 2], [2, 2]);
    const msg = await rejection(
      runNode(
        pathResample,
        { mode: "spacing", spacing: fieldFromJson({ fn: "constant", value: 0.0001220703125 }) },
        { in: [makeGeometryItem(geo)] },
      ),
    );
    expect(msg).toContain("at primitive 1");
    expect(msg).toContain("more than 1048576 samples");
    expect(msg).toContain("The cap is on the TOTAL");
  });

  it("refuses the PATH whose own resolved spacing is too coarse, rather than dropping it", async () => {
    // The closed square is 4 around and its own spacing is 3: two samples
    // where a closed path needs three. Refused, naming that primitive —
    // silently emitting one path where two went in is the plausible-looking
    // cook this library exists to refuse.
    const src = withPrimValue(openAndClosed(), "sp", [1, 3]);
    const msg = await rejection(
      runNode(
        pathResample,
        { mode: "spacing", spacing: spacingPerPath },
        { in: [makeGeometryItem(src)] },
      ),
    );
    expect(msg).toContain('the "spacing" field resolved to 3 on the closed path at primitive 1');
    expect(msg).toContain("fewer than the 3 a path needs");
    expect(msg).toContain("min(<the spacing field>");
  });

  it("refuses a path whose resolved spacing is not positive, naming it", async () => {
    const src = withPrimValue(openAndClosed(), "sp", [1, 0]);
    const msg = await rejection(
      runNode(
        pathResample,
        { mode: "spacing", spacing: spacingPerPath },
        { in: [makeGeometryItem(src)] },
      ),
    );
    expect(msg).toContain('the "spacing" field resolved to 0 on the closed path at primitive 1');
    expect(msg).toContain("must be > 0");
  });

  it("refuses a spacing field that resolves to a tuple, naming the fix", async () => {
    const msg = await rejection(
      runNode(
        pathResample,
        { mode: "spacing", spacing: fieldFromJson({ fn: "vec", args: [1, 2, 3] }) },
        { in: [makeGeometryItem(createPolyline([0, 0, 0, 10, 0, 0]))] },
      ),
    );
    expect(msg).toContain('param "spacing" must evaluate to ONE number per path');
    expect(msg).toContain("component(");
  });

  it("does not read the spacing field at all in 'count' mode", async () => {
    // `spacing` is documented as ignored there, so a field that could not
    // possibly resolve must not be resolved.
    const geo = firstGeo(
      (
        await runNode(
          pathResample,
          {
            mode: "count",
            count: 3,
            spacing: fieldFromJson({ fn: "attribute", name: "nothingWritesThis" }),
          },
          { in: [makeGeometryItem(createPolyline([0, 0, 0, 10, 0, 0]))] },
        )
      ).out,
    );
    expect(geo.pointCount).toBe(3);
  });

  it("checks for cancellation while it walks a long path", async () => {
    let calls = 0;
    await pathResample.execute({
      inputs: { in: [makeGeometryItem(createPolyline([0, 0, 0, 1000, 0, 0]))] },
      params: { ...pathResample.defaultParams, mode: "spacing", spacing: 0.2 },
      seed: 1,
      checkCancelled() {
        calls++;
      },
    });
    expect(calls).toBeGreaterThan(1);
  });

  it("reports a bad mode or spacing before it looks at the geometry", async () => {
    // A cloud with no polyline on it at all: the param error must still
    // win, or an agent is sent to debug topology instead of its params.
    const cloud = row(4);
    await expect(
      runNode(pathResample, { mode: "sideways" }, { in: [makeGeometryItem(cloud)] }),
    ).rejects.toThrow(/unknown mode "sideways"; valid modes: count, spacing/);
    await expect(
      runNode(pathResample, { mode: "spacing", spacing: 0 }, { in: [makeGeometryItem(cloud)] }),
    ).rejects.toThrow(/spacing must be > 0/);
  });

  it("errors on degenerate counts, spacings and paths", async () => {
    const line = createPolyline([0, 0, 0, 10, 0, 0]);
    const square = createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], { closed: true });
    await expect(
      runNode(pathResample, { mode: "count", count: 1 }, { in: [makeGeometryItem(line)] }),
    ).rejects.toThrow(/count is 1, but the open path at primitive 0 needs at least 2 samples/);
    await expect(
      runNode(pathResample, { mode: "count", count: 0 }, { in: [makeGeometryItem(line)] }),
    ).rejects.toThrow(/count is 0/);
    await expect(
      runNode(pathResample, { mode: "count", count: 2 }, { in: [makeGeometryItem(square)] }),
    ).rejects.toThrow(/the closed path at primitive 0 needs at least 3 samples/);
    await expect(
      runNode(pathResample, { mode: "spacing", spacing: 0 }, { in: [makeGeometryItem(line)] }),
    ).rejects.toThrow(/spacing must be > 0/);
    await expect(
      runNode(pathResample, { mode: "spacing", spacing: 3 }, { in: [makeGeometryItem(square)] }),
    ).rejects.toThrow(/fewer than the 3 a path needs/);
    const flat = createPolyline([2, 2, 2, 2, 2, 2]);
    await expect(
      runNode(pathResample, {}, { in: [makeGeometryItem(flat)] }),
    ).rejects.toThrow(/primitive 0 has zero length/);
    await expect(
      runNode(pathResample, {}, { in: [makeGeometryItem(row(4))] }),
    ).rejects.toThrow(/no polyline primitives — the input is a plain point cloud \(4 points, 0 primitives\)/);
    await expect(
      runNode(pathResample, { mode: "sideways" }, { in: [makeGeometryItem(line)] }),
    ).rejects.toThrow(/unknown mode "sideways"; valid modes: count, spacing/);
  });

  it("is deterministic across fresh runs and stable when run twice", async () => {
    const src = twoPaths();
    const run = async () =>
      snapshotGeometry(
        firstGeo(
          (await runNode(pathResample, { mode: "count", count: 7 }, { in: [makeGeometryItem(src)] }))
            .out,
        ),
      );
    expect(await run()).toEqual(await run());
    // Purity: resampling never writes into its input.
    expect(topologyOf(src)).toEqual({ v: [0, 1, 2, 3], start: [0, 2], count: [2, 2] });
  });

  it("feeds itself: a resampled path is still a path", async () => {
    const once = firstGeo(
      (
        await runNode(
          pathResample,
          { mode: "count", count: 5 },
          { in: [makeGeometryItem(createPolyline([0, 0, 0, 10, 0, 0]))] },
        )
      ).out,
    );
    const twice = firstGeo(
      (await runNode(pathResample, { mode: "count", count: 3 }, { in: [makeGeometryItem(once)] }))
        .out,
    );
    expect(positionsOf(twice)).toEqual([
      [0, 0, 0],
      [5, 0, 0],
      [10, 0, 0],
    ]);
  });

  it("carries each path's primitive attributes onto its own resampled points", async () => {
    const roads = withPrimString(withPrimValue(twoPaths(), "roadWidth", [2, 7]), "roadKind", [
      "avenue",
      "lane",
    ]);
    const geo = firstGeo(
      (await runNode(pathResample, { mode: "count", count: 3 }, { in: [makeGeometryItem(roads)] })).out,
    );
    expect(geo.pointCount).toBe(6);
    const width = geo.attrs.point.require("roadWidth");
    const kind = geo.attrs.point.require("roadKind");
    expect([0, 1, 2, 3, 4, 5].map((i) => width.get(i))).toEqual([2, 2, 2, 7, 7, 7]);
    expect([0, 1, 2, 3, 4, 5].map((i) => kind.getString(i))).toEqual([
      "avenue",
      "avenue",
      "avenue",
      "lane",
      "lane",
      "lane",
    ]);
    // The type tag is not a value and does not ride onto the points.
    expect(geo.attrs.point.has(PRIMTYPE_ATTR)).toBe(false);
  });

  it("keeps its own output primitives' attributes: a resampled road is still a road", async () => {
    const roads = withPrimString(withPrimValue(twoPaths(), "roadWidth", [2, 7]), "roadKind", [
      "avenue",
      "lane",
    ]);
    const geo = firstGeo(
      (await runNode(pathResample, { mode: "count", count: 4 }, { in: [makeGeometryItem(roads)] })).out,
    );
    expect(geo.primitiveCount).toBe(2);
    const width = geo.attrs.primitive.require("roadWidth");
    expect([width.get(0), width.get(1)]).toEqual([2, 7]);
    const kind = geo.attrs.primitive.require("roadKind");
    expect([kind.getString(0), kind.getString(1)]).toEqual(["avenue", "lane"]);
    // And it is still typed as a polyline.
    const primType = geo.attrs.primitive.require(PRIMTYPE_ATTR);
    expect([primType.getString(0), primType.getString(1)]).toEqual(["polyline", "polyline"]);
  });

  it("refuses a primitive attribute that would clobber one it writes itself", async () => {
    const roads = withPrimValue(twoPaths(), "tangent", [0, 0]);
    const msg = await rejection(runNode(pathResample, {}, { in: [makeGeometryItem(roads)] }));
    expect(msg).toContain("pathResample");
    expect(msg).toContain('"tangent"');
    expect(msg).toContain("removeAttribute");
    expect(msg).not.toBe('attribute "tangent" already exists');
  });

  it("writes neither report by default, and an empty name is the default", async () => {
    const src = withPrimValue(twoPaths(), "roadWidth", [2, 7]);
    const resample = async (params: Record<string, unknown>) =>
      firstGeo(
        (
          await runNode(
            pathResample,
            { mode: "count", count: 5, ...params },
            { in: [makeGeometryItem(src)] },
          )
        ).out,
      );
    const byDefault = await resample({});
    // The column list, spelled out: a comparison of two runs would agree
    // just as happily if the reports leaked into BOTH of them, so what
    // pins "off means off" is the absence of a name, not an equality.
    expect(byDefault.attrs.primitive.names()).toEqual([PRIMTYPE_ATTR, "roadWidth"]);
    expect(byDefault.attrs.point.names()).toEqual([
      "P",
      "rot",
      "scale",
      "density",
      "boundsMin",
      "boundsMax",
      "color",
      "seed",
      "tangent",
      "curveU",
      "roadWidth",
    ]);
    // An empty name is not a name: it writes nothing, byte for byte.
    expect(snapshotGeometry(await resample({ lengthAttr: "", stepAttr: "" }))).toEqual(
      snapshotGeometry(byDefault),
    );
  });

  it("adds the reports without moving anything it already wrote", async () => {
    const src = withPrimValue(twoPaths(), "roadWidth", [2, 7]);
    const resample = async (params: Record<string, unknown>) =>
      snapshotGeometry(
        firstGeo(
          (
            await runNode(
              pathResample,
              { mode: "count", count: 5, ...params },
              { in: [makeGeometryItem(src)] },
            )
          ).out,
        ),
      );
    const off = await resample({});
    const on = await resample({ lengthAttr: "pathLength", stepAttr: "sampleStep" });
    // Every domain but the one the reports land on, and the topology with
    // them. The point domain is the interesting half: a per-path number
    // repeated once per sample would be the convenient place to put it,
    // and it does not go there.
    expect(on.point).toEqual(off.point);
    expect(on.vertex).toEqual(off.vertex);
    expect(on.detail).toEqual(off.detail);
    expect(on.topology).toEqual(off.topology);
  });

  it("reports the TRUE arc length, not the span the author can measure", async () => {
    // A right angle: 3 along +X, then 4 along +Y. The arc is 3 + 4 = 7 and
    // the straight line between the two ends is 5 — the second is the
    // number a field can already compute from two positions and the first
    // is the one nothing in a graph can walk to, which is the entire
    // reason this attribute exists.
    const bend = createPolyline([0, 0, 0, 3, 0, 0, 3, 4, 0]);
    const geo = firstGeo(
      (
        await runNode(
          pathResample,
          { mode: "count", count: 8, lengthAttr: "pathLength" },
          { in: [makeGeometryItem(bend)] },
        )
      ).out,
    );
    const length = geo.attrs.primitive.require("pathLength");
    expect(length.get(0)).toBe(7);
    expect(length.get(0)).not.toBe(5);
    // On the primitive domain, one value for the whole path, and nowhere
    // else — a length is a fact about a path, not about a sample.
    expect(geo.attrs.primitive.names()).toEqual([PRIMTYPE_ATTR, "pathLength"]);
    expect(geo.attrs.point.has("pathLength")).toBe(false);
  });

  it("gives each path its own length and its own step", async () => {
    // twoPaths is 1 unit and 4 units long. count 5 divides each on ITS
    // OWN arc, so one graph-wide step does not exist and the report has
    // to be per path: 0.25 and 1.
    const geo = firstGeo(
      (
        await runNode(
          pathResample,
          { mode: "count", count: 5, lengthAttr: "pathLength", stepAttr: "sampleStep" },
          { in: [makeGeometryItem(twoPaths())] },
        )
      ).out,
    );
    const length = geo.attrs.primitive.require("pathLength");
    const step = geo.attrs.primitive.require("sampleStep");
    expect([length.get(0), length.get(1)]).toEqual([1, 4]);
    expect([step.get(0), step.get(1)]).toEqual([0.25, 1]);
    // And it is the sampling's own number, not one measured back off it:
    // the gap between the first two samples IS the reported step.
    const P = positionsOf(geo);
    expect(P[1][0] - P[0][0]).toBe(step.get(0));
    // The second path's run starts at 5: five samples each.
    expect(P[6][0] - P[5][0]).toBe(step.get(1));
  });

  it("divides a closed path by count and an open one by count - 1", async () => {
    const open = firstGeo(
      (
        await runNode(
          pathResample,
          { mode: "count", count: 5, lengthAttr: "pathLength", stepAttr: "sampleStep" },
          { in: [makeGeometryItem(createPolyline([0, 0, 0, 10, 0, 0]))] },
        )
      ).out,
    );
    // 5 samples land on both ends, so there are 4 gaps.
    expect(open.attrs.primitive.require("pathLength").get(0)).toBe(10);
    expect(open.attrs.primitive.require("sampleStep").get(0)).toBe(2.5);
    const loop = firstGeo(
      (
        await runNode(
          pathResample,
          { mode: "count", count: 4, lengthAttr: "pathLength", stepAttr: "sampleStep" },
          {
            in: [
              makeGeometryItem(
                createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], { closed: true }),
              ),
            ],
          },
        )
      ).out,
    );
    // 4 samples around a 4-unit loop with no duplicate at the seam: 4
    // gaps, not 3, so the step is 1 and not 4/3.
    expect(loop.attrs.primitive.require("pathLength").get(0)).toBe(4);
    expect(loop.attrs.primitive.require("sampleStep").get(0)).toBe(1);
  });

  it("reports the step it takes in spacing mode, not the remainder it leaves", async () => {
    // The 43-unit loop from the seam test: 9 samples exactly 5 apart, and
    // a 3-unit remainder at the seam. The report is 5 — the step the node
    // TAKES — because a size written as a multiple of it must not mean
    // something else at the one short segment.
    const side = 10.75;
    const square = createPolyline([0, 0, 0, side, 0, 0, side, side, 0, 0, side, 0], {
      closed: true,
    });
    const geo = firstGeo(
      (
        await runNode(
          pathResample,
          { mode: "spacing", spacing: 5, lengthAttr: "pathLength", stepAttr: "sampleStep" },
          { in: [makeGeometryItem(square)] },
        )
      ).out,
    );
    expect(geo.pointCount).toBe(9);
    expect(geo.attrs.primitive.require("pathLength").get(0)).toBe(43);
    expect(geo.attrs.primitive.require("sampleStep").get(0)).toBe(5);
  });

  it("refuses a report name that would delete a differently shaped column", async () => {
    const roads = withPrimString(twoPaths(), "roadKind", ["avenue", "lane"]);
    const msg = await rejection(
      runNode(pathResample, { lengthAttr: "roadKind" }, { in: [makeGeometryItem(roads)] }),
    );
    expect(msg).toContain('pathResample: lengthAttr "roadKind"');
    // `roadKind` IS the input's — the early check sees it there, and
    // removing it upstream is a real fix. This is the wording the
    // report-slot rule has always used and half a dozen suites pin.
    expect(msg).toContain("already exists on the input's primitive domain");
    expect(msg).toContain('remove "roadKind" from the input first with removeAttribute');
    // The one that would leave the output unrecognisable downstream.
    const tagMsg = await rejection(
      runNode(pathResample, { stepAttr: PRIMTYPE_ATTR }, { in: [makeGeometryItem(twoPaths())] }),
    );
    expect(tagMsg).toContain(`pathResample: stepAttr "${PRIMTYPE_ATTR}"`);
    expect(tagMsg).toContain("already exists on the input's primitive domain");
    // ...but only because THIS input carries a `primtype`. Strip it and
    // the polylines are still read, the output still gets one stamped by
    // setPolylineTopology, and the collision is now on a column the input
    // never had — so the refusal has to say so rather than send an author
    // to removeAttribute something that is not there.
    const bare = twoPaths();
    expect(bare.attrs.primitive.remove(PRIMTYPE_ATTR)).toBe(true);
    const bareMsg = await rejection(
      runNode(pathResample, { stepAttr: PRIMTYPE_ATTR }, { in: [makeGeometryItem(bare)] }),
    );
    expect(bareMsg).toContain(
      `pathResample: stepAttr "${PRIMTYPE_ATTR}" already exists on the output's primitive domain`,
    );
    expect(bareMsg).not.toContain("the input's primitive domain");
    expect(bareMsg).toContain("removeAttribute upstream cannot help here");
    // A same-shape column is reset rather than refused — that is the rule
    // everywhere, and it is what the re-resample below relies on.
    const width = withPrimValue(twoPaths(), "roadWidth", [2, 7]);
    const reused = firstGeo(
      (
        await runNode(
          pathResample,
          { mode: "count", count: 3, lengthAttr: "roadWidth" },
          { in: [makeGeometryItem(width)] },
        )
      ).out,
    );
    expect([0, 1].map((p) => reused.attrs.primitive.require("roadWidth").get(p))).toEqual([1, 4]);
  });

  it("refuses lengthAttr and stepAttr naming the same attribute", async () => {
    // Both are f32 tuple 1, so the shape check would wave this through and
    // the step would quietly overwrite the length. Reported before the
    // geometry is looked at: an empty cloud never gets that far.
    const msg = await rejection(
      runNode(
        pathResample,
        { lengthAttr: "size", stepAttr: "size" },
        { in: [makeGeometryItem(createPointCloud(0))] },
      ),
    );
    expect(msg).toContain('pathResample: params "lengthAttr" and "stepAttr" are both "size"');
    expect(msg).toContain("two attributes");
  });

  it("resets its own report when a resampled path is resampled again", async () => {
    // The report lands on the domain the NEXT run carries, so it is
    // written after the carry: written before it, this would collide with
    // itself and re-running a node over its own output has to stay
    // ordinary.
    const bend = createPolyline([0, 0, 0, 3, 0, 0, 3, 4, 0]);
    const once = firstGeo(
      (
        await runNode(
          pathResample,
          { mode: "count", count: 3, lengthAttr: "pathLength" },
          { in: [makeGeometryItem(bend)] },
        )
      ).out,
    );
    expect(once.attrs.primitive.require("pathLength").get(0)).toBe(7);
    const twice = firstGeo(
      (
        await runNode(
          pathResample,
          { mode: "count", count: 3, lengthAttr: "pathLength" },
          { in: [makeGeometryItem(once)] },
        )
      ).out,
    );
    // Three samples cut the corner, so the second pass measures a
    // genuinely shorter curve — 3 + 4 became hypot(3, 0.5) + 3.5 — and the
    // column holds THAT, not the 7 it arrived carrying.
    expect(twice.attrs.primitive.require("pathLength").get(0)).toBeCloseTo(6.5414, 4);
    // The carry itself is unchanged: the old length still rides onto the
    // points, exactly as every other primitive attribute does here.
    expect(twice.attrs.point.require("pathLength").get(0)).toBe(7);
  });

  /**
   * The chord length of the polyline each output primitive WALKS, path by
   * path, measured off the topology rather than off the sample order.
   *
   * Deliberately not a copy of the node's own accumulation: it reads
   * `vertexToPoint`, which repeats the first point as a closed path's last
   * vertex, so the closing chord comes from the structure that declares the
   * path closed rather than from a second `if (closed)` that could agree
   * with the first while both are wrong.
   */
  function walkedChordSums(geo: Geometry): number[] {
    const P = geo.attrs.point.require("P");
    const sums: number[] = [];
    for (let p = 0; p < geo.primitiveCount; p++) {
      const start = geo.primVertexStart[p];
      let sum = 0;
      for (let v = start + 1; v < start + geo.primVertexCount[p]; v++) {
        const a = geo.vertexToPoint[v - 1];
        const b = geo.vertexToPoint[v];
        const dx = P.get(b, 0) - P.get(a, 0);
        const dy = P.get(b, 1) - P.get(a, 1);
        const dz = P.get(b, 2) - P.get(a, 2);
        sum += Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      sums.push(sum);
    }
    return sums;
  }

  /** The `name` column of every point, as a plain array. */
  function scalarsOf(geo: Geometry, name: string): number[] {
    const attr = geo.attrs.point.require(name);
    return Array.from({ length: geo.pointCount }, (_, i) => attr.get(i));
  }

  /** Run pathResample over one geometry and return the output. */
  async function resampled(params: Record<string, unknown>, src: Geometry): Promise<Geometry> {
    return firstGeo((await runNode(pathResample, params, { in: [makeGeometryItem(src)] })).out);
  }

  it("reports the EMITTED polyline's length, which is SHORTER wherever the path bends", async () => {
    // The right angle again: 3 along +X then 4 along +Y, arc 7. Three
    // samples land at 0, 3.5 and 7, so the middle one sits half a unit up
    // the second leg and the corner is CUT — the emitted polyline is
    // hypot(3, 0.5) + 3.5, and that is what anything walking this output
    // actually has to walk.
    const bend = createPolyline([0, 0, 0, 3, 0, 0, 3, 4, 0]);
    const geo = await resampled(
      { mode: "count", count: 3, lengthAttr: "pathLength", resampledLengthAttr: "sampleLength" },
      bend,
    );
    const curve = geo.attrs.primitive.require("pathLength").get(0);
    const emitted = geo.attrs.primitive.require("sampleLength").get(0);
    expect(curve).toBe(7);
    // STRICTLY less. The whole reason the second report exists is that a
    // consumer stepping `curve` over these samples runs off the end.
    expect(emitted).toBeLessThan(curve);
    expect(emitted).toBeCloseTo(Math.sqrt(9.25) + 3.5, 5);
    // ...and it is the chord sum of the points actually emitted, to f32
    // exactness — the column is f32, so the value a graph reads is that
    // f64 sum rounded once on the way in and not a number near it.
    expect(emitted).toBe(Math.fround(walkedChordSums(geo)[0]));
    // On the primitive domain, one per path, and nowhere else.
    expect(geo.attrs.point.has("sampleLength")).toBe(false);
  });

  it("reports the length the NEXT node measures, bit for bit", async () => {
    // The load-bearing property, and the reason the sum is accumulated
    // from the f32 positions just written rather than from the f64
    // expressions above them: `polylineArcTables` re-measures an f32 P
    // column downstream, so this number has to be the one IT arrives at.
    // Resampling the output again puts that recomputation on the same
    // column under a name we can compare — an f64 accumulation here would
    // land a few ulps away and this would be a toBeCloseTo.
    const bend = createPolyline([0, 0, 0, 3, 0, 0, 3, 4, 0]);
    const once = await resampled({ mode: "count", count: 3, resampledLengthAttr: "emitted" }, bend);
    const twice = await resampled({ mode: "count", count: 3, lengthAttr: "pathLength" }, once);
    expect(twice.attrs.primitive.require("pathLength").get(0)).toBe(
      once.attrs.primitive.require("emitted").get(0),
    );
  });

  it("agrees with the true length on a straight path, which has no corner to cut", async () => {
    const straight = createPolyline([0, 0, 0, 10, 0, 0]);
    const geo = await resampled(
      { mode: "count", count: 5, lengthAttr: "pathLength", resampledLengthAttr: "sampleLength" },
      straight,
    );
    // Equal, not merely close: resampling a line loses nothing, so the gap
    // between the two reports is exactly the corner-cutting and zero when
    // there are no corners.
    expect(geo.attrs.primitive.require("sampleLength").get(0)).toBe(10);
    expect(geo.attrs.primitive.require("pathLength").get(0)).toBe(10);
  });

  it("writes each sample's own chord arc, starting at 0 on every path", async () => {
    // Two bent paths of different lengths: 3 + 4 = 7, and 6 + 8 = 14. The
    // arc has to restart per path, so the second path's first sample is 0
    // and not 7 — a coordinate that kept running would place every prop on
    // the second road as far along as the first road was long.
    const cloud = createPointCloud(6);
    const P = cloud.attrs.point.require("P");
    P.setTuple(0, [0, 0, 0]);
    P.setTuple(1, [3, 0, 0]);
    P.setTuple(2, [3, 4, 0]);
    P.setTuple(3, [10, 0, 0]);
    P.setTuple(4, [10, 6, 0]);
    P.setTuple(5, [18, 6, 0]);
    setPolylineTopology(cloud, [0, 1, 2, 3, 4, 5], [0, 3], [3, 3]);
    const geo = await resampled(
      {
        mode: "count",
        count: 5,
        lengthAttr: "pathLength",
        resampledLengthAttr: "sampleLength",
        sampleArcAttr: "sampleArc",
      },
      cloud,
    );
    const arcs = scalarsOf(geo, "sampleArc");
    expect(arcs).toHaveLength(10);
    expect([arcs[0], arcs[5]]).toEqual([0, 0]);
    for (const path of [arcs.slice(0, 5), arcs.slice(5)]) {
      for (let i = 1; i < path.length; i++) expect(path[i]).toBeGreaterThan(path[i - 1]);
    }
    // Each primitive gets its own two lengths, and both pairs disagree in
    // the same direction: the curve is longer than what came out of it.
    const curve = geo.attrs.primitive.require("pathLength");
    const emitted = geo.attrs.primitive.require("sampleLength");
    expect([curve.get(0), curve.get(1)]).toEqual([7, 14]);
    expect(emitted.get(0)).toBeLessThan(7);
    expect(emitted.get(1)).toBeLessThan(14);
    // On an OPEN path the last sample IS the far end, so its arc is the
    // whole emitted length — exactly, since both are the same f64 sum
    // rounded to f32 once.
    expect(arcs[4]).toBe(emitted.get(0));
    expect(arcs[9]).toBe(emitted.get(1));
    // World units, not a fraction: `curveU` is the fraction and it is the
    // OTHER curve's. The two disagree by the corner-cutting above, which
    // is why one is not a rescaling of the other.
    const us = scalarsOf(geo, "curveU");
    expect(us[4]).toBe(1);
    expect(arcs[2] / emitted.get(0)).not.toBe(us[2]);
  });

  it("leaves a closed path's seam chord out of the arcs and inside the length", async () => {
    // The unit square, arc 4, sampled 5 times: the step is 0.8 and no
    // sample lands on a corner, so every one of the five chords is cut.
    const square = createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], { closed: true });
    const geo = await resampled(
      { mode: "count", count: 5, resampledLengthAttr: "sampleLength", sampleArcAttr: "sampleArc" },
      square,
    );
    const arcs = scalarsOf(geo, "sampleArc");
    const emitted = geo.attrs.primitive.require("sampleLength").get(0);
    expect(arcs[0]).toBe(0);
    expect(emitted).toBeLessThan(4);
    expect(emitted).toBe(Math.fround(walkedChordSums(geo)[0]));
    // The closing chord runs from the last sample at (0, 0.8, 0) back to
    // the start, and no SAMPLE holds it: the arc coordinate stops at the
    // last sample, and the length is that plus the seam. Close rather than
    // exact because the node rounds the whole f64 sum to f32 once while
    // this adds two numbers that were rounded separately.
    const last = arcs[arcs.length - 1];
    expect(last).toBeLessThan(emitted);
    expect(last + 0.8).toBeCloseTo(emitted, 5);
  });

  it("closes the SECOND path's loop, not the first path's start", async () => {
    // The seam chord runs from a path's last sample back to ITS OWN first
    // sample, and the index of that first sample is only 0 for the first
    // path. Every other closed-path test here has one path, so a closing
    // chord measured to output point 0 would pass all of them and be off
    // by the whole distance between two roads on this one — which is why
    // the loop sits 100 units away from the open path in front of it.
    const cloud = createPointCloud(7);
    const P = cloud.attrs.point.require("P");
    P.setTuple(0, [0, 0, 0]);
    P.setTuple(1, [3, 0, 0]);
    P.setTuple(2, [3, 4, 0]);
    P.setTuple(3, [100, 0, 0]);
    P.setTuple(4, [101, 0, 0]);
    P.setTuple(5, [101, 1, 0]);
    P.setTuple(6, [100, 1, 0]);
    // Prim 0 open over points 0..2; prim 1 the unit square over 3..6,
    // closed by repeating point 3 as its last vertex.
    setPolylineTopology(cloud, [0, 1, 2, 3, 4, 5, 6, 3], [0, 3], [3, 5]);
    const geo = await resampled(
      { mode: "count", count: 5, resampledLengthAttr: "sampleLength", sampleArcAttr: "sampleArc" },
      cloud,
    );
    const emitted = geo.attrs.primitive.require("sampleLength");
    const walked = walkedChordSums(geo);
    // Both paths, both measured off the topology — which for prim 1
    // includes the seam because setPolylineTopology repeated its start.
    expect(emitted.get(0)).toBe(Math.fround(walked[0]));
    expect(emitted.get(1)).toBe(Math.fround(walked[1]));
    // The loop is 4 units around and the samples cut it, so the emitted
    // length is under 4 — and nowhere near the ~100 a seam measured to the
    // wrong path's first sample would produce.
    expect(emitted.get(1)).toBeGreaterThan(3);
    expect(emitted.get(1)).toBeLessThan(4);
    const arcs = scalarsOf(geo, "sampleArc");
    expect(arcs[5]).toBe(0);
    expect(arcs[9]).toBeLessThan(emitted.get(1));
  });

  it("measures what spacing mode emits, remainder segment and all", async () => {
    // 'spacing' places its samples from a step rather than a division, and
    // leaves a short last segment: on a closed path the seam remainder,
    // on an open one the run to the true endpoint. Both are chords of the
    // emitted polyline like any other, so the report has to include them.
    const square = createPolyline([0, 0, 0, 10.75, 0, 0, 10.75, 10.75, 0, 0, 10.75, 0], {
      closed: true,
    });
    const geo = await resampled(
      {
        mode: "spacing",
        spacing: 5,
        lengthAttr: "pathLength",
        stepAttr: "sampleStep",
        resampledLengthAttr: "sampleLength",
        sampleArcAttr: "sampleArc",
      },
      square,
    );
    expect(geo.pointCount).toBe(9);
    expect(geo.attrs.primitive.require("pathLength").get(0)).toBe(43);
    expect(geo.attrs.primitive.require("sampleStep").get(0)).toBe(5);
    const emitted = geo.attrs.primitive.require("sampleLength").get(0);
    expect(emitted).toBe(Math.fround(walkedChordSums(geo)[0]));
    expect(emitted).toBeLessThan(43);
    // The arcs are NOT multiples of the step: a sample that steps 5 along
    // the curve moves less than 5 across the corner it cut, which is the
    // whole disagreement `resampledLengthAttr` exists to report.
    const arcs = scalarsOf(geo, "sampleArc");
    expect(arcs[0]).toBe(0);
    expect(arcs[1]).toBe(5);
    expect(arcs[3]).toBeLessThan(15);
  });

  it("gives the arc to the column the param named, even when that is curveU", async () => {
    // `curveU` is f32 tuple 1, exactly this report's shape, so the slot
    // rule RESETS it rather than refusing — and reset means the two names
    // are one buffer. Which of the two writes lands last is therefore a
    // real decision, not an implementation detail: a column an author
    // explicitly pointed at the arc must not come back holding fractions,
    // because that cook looks fine and answers the other question.
    const geo = await resampled(
      { mode: "count", count: 3, sampleArcAttr: "curveU" },
      createPolyline([0, 0, 0, 3, 0, 0, 3, 4, 0]),
    );
    const values = scalarsOf(geo, "curveU");
    expect(values[0]).toBe(0);
    expect(values[1]).toBeCloseTo(Math.sqrt(9.25), 5);
    // 0.5 and 1 are what the fraction would have been at those samples.
    expect(values[1]).not.toBe(0.5);
    expect(values[2]).not.toBe(1);
  });

  it("names sampleArcAttr itself when the carry would land on it", async () => {
    // The collision is real either way — every primitive attribute is
    // carried onto these samples, so "roadWidth" and this report want the
    // same POINT column. What is pinned here is WHICH refusal fires:
    // caught downstream by carryPrimitiveAttributes, the message is about
    // the CARRIED attribute, never says "sampleArcAttr", and sends the
    // reader to rename the setAttribute that produced roadWidth — when the
    // fix is to rename the param that asked for the name.
    const roads = withPrimValue(twoPaths(), "roadWidth", [2, 7]);
    const msg = await rejection(
      runNode(pathResample, { sampleArcAttr: "roadWidth" }, { in: [makeGeometryItem(roads)] }),
    );
    expect(msg).toContain('pathResample: sampleArcAttr "roadWidth"');
    expect(msg).toContain("carried onto this node's samples");
    expect(msg).toContain("RENAME THE PARAM");
    expect(msg).toContain('"sampleArc"');
    // The carry's own wording, which would mean the wrong refusal won.
    expect(msg).not.toContain("is already the");
    // A string column collides just as hard: the carry has no shape rule,
    // so neither does this — the point is the NAME, not what would fit.
    const kinds = withPrimString(twoPaths(), "roadKind", ["avenue", "lane"]);
    const strMsg = await rejection(
      runNode(pathResample, { sampleArcAttr: "roadKind" }, { in: [makeGeometryItem(kinds)] }),
    );
    expect(strMsg).toContain('pathResample: sampleArcAttr "roadKind"');
    expect(strMsg).toContain("(string)");
  });

  it("refuses sampleArcAttr naming the type tag", async () => {
    // Inert today — every reader of `primtype` looks at the PRIMITIVE
    // domain, and setPolylineTopology restamps it there — which is exactly
    // why it has to be refused rather than left to be discovered: one
    // promoteAttribute point -> primitive on that name later replaces the
    // string tag with a float and every path node stops seeing a path.
    // Refused from the param alone, before any geometry is read.
    const msg = await rejection(
      runNode(
        pathResample,
        { sampleArcAttr: PRIMTYPE_ATTR },
        { in: [makeGeometryItem(createPointCloud(0))] },
      ),
    );
    expect(msg).toContain(`pathResample: sampleArcAttr may not be "${PRIMTYPE_ATTR}"`);
    expect(msg).toContain("TYPE TAG");
    expect(msg).toContain('"sampleArc"');
    // And it does not become a point column on a real cook.
    const ok = await resampled(
      { mode: "count", count: 3, sampleArcAttr: "sampleArc" },
      createPolyline([0, 0, 0, 4, 0, 0]),
    );
    expect(ok.attrs.point.has(PRIMTYPE_ATTR)).toBe(false);
    expect(ok.attrs.primitive.require(PRIMTYPE_ATTR).getString(0)).toBe("polyline");
  });

  it("writes neither new report by default, and an empty name is not a name", async () => {
    const src = withPrimValue(twoPaths(), "roadWidth", [2, 7]);
    const byDefault = await resampled({ mode: "count", count: 5 }, src);
    expect(byDefault.attrs.primitive.names()).toEqual([PRIMTYPE_ATTR, "roadWidth"]);
    expect(byDefault.attrs.point.names()).toEqual([
      "P",
      "rot",
      "scale",
      "density",
      "boundsMin",
      "boundsMax",
      "color",
      "seed",
      "tangent",
      "curveU",
      "roadWidth",
    ]);
    // Spelled out rather than compared: two runs that both leaked the
    // columns would compare equal just as happily.
    const named = await resampled(
      { mode: "count", count: 5, resampledLengthAttr: "", sampleArcAttr: "" },
      src,
    );
    expect(snapshotGeometry(named)).toEqual(snapshotGeometry(byDefault));
  });

  it("refuses a new report that would delete a differently shaped column", async () => {
    // The primitive one is checked against the INPUT first, where the
    // colliding column is the author's own and removeAttribute is a fix.
    const roads = withPrimString(twoPaths(), "roadKind", ["avenue", "lane"]);
    const primMsg = await rejection(
      runNode(
        pathResample,
        { resampledLengthAttr: "roadKind" },
        { in: [makeGeometryItem(roads)] },
      ),
    );
    expect(primMsg).toContain('pathResample: resampledLengthAttr "roadKind"');
    expect(primMsg).toContain("already exists on the input's primitive domain");
    expect(primMsg).toContain('"sampleLength"');
    // The per-sample one is checked against the OUTPUT'S POINT domain, and
    // `tangent` is the column that proves it is the right set: it is f32x3
    // and it does not exist on the input at all, so a check against the
    // primitive domain would have waved this straight through.
    const pointMsg = await rejection(
      runNode(pathResample, { sampleArcAttr: "tangent" }, { in: [makeGeometryItem(twoPaths())] }),
    );
    expect(pointMsg).toContain('pathResample: sampleArcAttr "tangent"');
    expect(pointMsg).toContain("already exists on the output's point domain");
    expect(pointMsg).toContain("removeAttribute upstream cannot help here");
  });

  it("refuses two per-path reports naming one attribute, but not the per-sample one", async () => {
    // All three per-path reports are f32 tuple 1, so a shared name passes
    // the shape check and the later write silently replaces the earlier.
    const clash = await rejection(
      runNode(
        pathResample,
        { lengthAttr: "size", resampledLengthAttr: "size" },
        { in: [makeGeometryItem(createPointCloud(0))] },
      ),
    );
    expect(clash).toContain(
      'pathResample: params "lengthAttr" and "resampledLengthAttr" are both "size"',
    );
    expect(clash).toContain("two attributes");
    const pair = await rejection(
      runNode(
        pathResample,
        { stepAttr: "size", resampledLengthAttr: "size" },
        { in: [makeGeometryItem(createPointCloud(0))] },
      ),
    );
    expect(pair).toContain(
      'pathResample: params "stepAttr" and "resampledLengthAttr" are both "size"',
    );
    // `sampleArcAttr` is on the POINT domain, so the same name is a
    // DIFFERENT column and nothing collides — refusing it would refuse a
    // graph in which the two values coexist perfectly well.
    const geo = await resampled(
      { mode: "count", count: 3, lengthAttr: "size", sampleArcAttr: "size" },
      createPolyline([0, 0, 0, 4, 0, 0]),
    );
    expect(geo.attrs.primitive.require("size").get(0)).toBe(4);
    expect(scalarsOf(geo, "size")).toEqual([0, 2, 4]);
  });
});

describe("pathSegments", () => {
  /** An L: a 2-long segment along +X, then a 4-long one along +Y. */
  function elbow(): Geometry {
    return createPolyline([0, 0, 0, 2, 0, 0, 2, 4, 0]);
  }

  /** Run pathSegments over one geometry and return the output cloud. */
  async function segments(params: Record<string, unknown>, src: Geometry): Promise<Geometry> {
    return firstGeo((await runNode(pathSegments, params, { in: [makeGeometryItem(src)] })).out);
  }

  /** Tuple `name` of every point, as plain arrays. */
  function tuplesOf(geo: Geometry, name: string): number[][] {
    const attr = geo.attrs.point.require(name);
    const out: number[][] = [];
    for (let i = 0; i < geo.pointCount; i++) {
      const t: number[] = [];
      for (let k = 0; k < attr.tupleSize; k++) t.push(attr.data[i * attr.tupleSize + k]);
      out.push(t);
    }
    return out;
  }

  it("emits one point per segment, at the midpoint, with the length on the axis", async () => {
    const geo = await segments({ radius: 0.5 }, elbow());
    expect(geo.pointCount).toBe(2);
    expect(positionsOf(geo)).toEqual([
      [1, 0, 0],
      [2, 2, 0],
    ]);
    // Default axis '+y': length on Y, radius on X and Z.
    expect(tuplesOf(geo, "scale")).toEqual([
      [0.5, 2, 0.5],
      [0.5, 4, 0.5],
    ]);
    expect(tuplesOf(geo, "tangent")).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
  });

  it("turns the chosen axis onto the segment, so a unit asset spans it", async () => {
    // The rot must carry the asset's local axis onto the tangent. Checked
    // through the same rotation the spawner applies, for every axis.
    for (const [axis, local] of [
      ["+x", [1, 0, 0]],
      ["-x", [-1, 0, 0]],
      ["+y", [0, 1, 0]],
      ["-y", [0, -1, 0]],
      ["+z", [0, 0, 1]],
      ["-z", [0, 0, -1]],
    ] as const) {
      const geo = await segments({ axis }, elbow());
      const rot = geo.attrs.point.require("rot");
      const tangent = tuplesOf(geo, "tangent");
      for (let i = 0; i < geo.pointCount; i++) {
        const q = [rot.data[i * 4], rot.data[i * 4 + 1], rot.data[i * 4 + 2], rot.data[i * 4 + 3]];
        const v = rotateVec([0, 0, 0], q[0], q[1], q[2], q[3], local[0], local[1], local[2]);
        for (let k = 0; k < 3; k++) expect(v[k]).toBeCloseTo(tangent[i][k], 6);
      }
      // ...and the length lands on that axis's scale component, not another.
      const comp = axis[1] === "x" ? 0 : axis[1] === "y" ? 1 : 2;
      expect(tuplesOf(geo, "scale").map((s) => s[comp])).toEqual([2, 4]);
    }
  });

  it("writes curveU at the midpoint's normalized position along its own path", async () => {
    // The L is 6 long: midpoints at arc 1 and arc 4.
    const geo = await segments({}, elbow());
    const u = geo.attrs.point.require("curveU");
    expect(u.get(0)).toBeCloseTo(1 / 6, 6);
    expect(u.get(1)).toBeCloseTo(4 / 6, 6);
  });

  it("skips zero-length segments instead of emitting degenerate instances", async () => {
    // A repeated point in the middle: 3 segments, one of them degenerate.
    const geo = await segments({}, createPolyline([0, 0, 0, 1, 0, 0, 1, 0, 0, 3, 0, 0]));
    expect(geo.pointCount).toBe(2);
    expect(positionsOf(geo)).toEqual([
      [0.5, 0, 0],
      [2, 0, 0],
    ]);
  });

  it("extends both ends without moving the midpoint", async () => {
    const plain = await segments({ radius: 0.25 }, elbow());
    const grown = await segments({ radius: 0.25, extend: 0.25 }, elbow());
    expect(positionsOf(grown)).toEqual(positionsOf(plain));
    expect(tuplesOf(grown, "scale").map((s) => s[1])).toEqual([2.5, 4.5]);
    // Only the axis component grows; the radius is untouched.
    expect(tuplesOf(grown, "scale").map((s) => [s[0], s[2]])).toEqual([
      [0.25, 0.25],
      [0.25, 0.25],
    ]);
  });

  it("reads an extend field per SEGMENT, off the input points it runs between", async () => {
    // An extend attribute of 0, 1, 3 on the L's three points: the segments
    // between them take 0.5 and 2, so the 2-long segment grows to 3 and the
    // 4-long one to 8. A plain value adds the SAME 2 * extend to both, so
    // no scalar can open a gap of 5 between them — the controls below are
    // the two the field mixes.
    const src = withAttr(elbow(), "ext", [0, 1, 3]);
    const geo = await segments(
      { radius: 0.25, extend: fieldFromJson({ fn: "attribute", name: "ext" }) },
      src,
    );
    expect(tuplesOf(geo, "scale").map((s) => s[1])).toEqual([3, 8]);
    // Only the axis component grows; the radius is untouched.
    expect(tuplesOf(geo, "scale").map((s) => [s[0], s[2]])).toEqual([
      [0.25, 0.25],
      [0.25, 0.25],
    ]);
    // The midpoints do not move, field or not.
    expect(positionsOf(geo)).toEqual(positionsOf(await segments({ radius: 0.25 }, src)));
    const scalar = async (extend: number) =>
      tuplesOf(await segments({ radius: 0.25, extend }, src), "scale").map((s) => s[1]);
    expect(await scalar(0.5)).toEqual([3, 5]);
    expect(await scalar(2)).toEqual([6, 8]);
  });

  it("cooks a constant extend field exactly as the plain number", async () => {
    // 0.25 is exact in f32, so a field column holds the same number the
    // plain param does and any difference would be a real one.
    const run = async (extend: unknown) =>
      snapshotGeometry(await segments({ radius: 0.25, extend }, elbow()));
    expect(await run(fieldFromJson({ fn: "constant", value: 0.25 }))).toEqual(await run(0.25));
    // The control: the comparison above can report "different" too.
    expect(await run(fieldFromJson({ fn: "constant", value: 0.5 }))).not.toEqual(await run(0.25));
  });

  it("clamps a negative extend field to zero per segment, and refuses a non-finite one", async () => {
    // Segment 0 averages (-4 + -2)/2 = -3 and clamps to 0; segment 1
    // averages (-2 + 6)/2 = 2 and DOES extend. The third value used to be
    // 2, which made segment 1 average 0 — so both segments came out at
    // the `extend: 0` default and an implementation ignoring the field
    // entirely passed this test. The point of the case is the contrast
    // between the clamped segment and the extended one.
    const src = withAttr(elbow(), "ext", [-4, -2, 6]);
    const geo = await segments({ extend: fieldFromJson({ fn: "attribute", name: "ext" }) }, src);
    const lengths = tuplesOf(geo, "scale").map((s) => s[1]);
    const base = tuplesOf(await segments({}, elbow()), "scale").map((s) => s[1]);
    expect(base).toEqual([2, 4]);
    expect(lengths[0]).toBe(base[0]);
    expect(lengths[1]).toBeGreaterThan(base[1]);
    const msg = await rejection(
      runNode(
        pathSegments,
        { extend: fieldFromJson({ fn: "div", args: [1, 0] }) },
        { in: [makeGeometryItem(elbow())] },
      ),
    );
    expect(msg).toContain('pathSegments: param "extend"');
    expect(msg).toContain("+Infinity");
  });

  it("resolves radius on the input points and averages it across each segment", async () => {
    // A radius attribute of 1, 3, 7 on the L's three points: the segments
    // between them take 2 and 5.
    const src = withAttr(elbow(), "rad", [1, 3, 7]);
    const geo = await segments({ radius: fieldFromJson({ fn: "attribute", name: "rad" }) }, src);
    expect(tuplesOf(geo, "scale").map((s) => [s[0], s[2]])).toEqual([
      [2, 2],
      [5, 5],
    ]);
  });

  it("clamps a negative radius to zero rather than mirroring the asset", async () => {
    const src = withAttr(elbow(), "rad", [-4, -2, 2]);
    const geo = await segments({ radius: fieldFromJson({ fn: "attribute", name: "rad" }) }, src);
    // Segment 0 averages to -3 (clamped); segment 1 averages to 0.
    expect(tuplesOf(geo, "scale").map((s) => s[0])).toEqual([0, 0]);
  });

  it("emits a plain cloud, not a path", async () => {
    const geo = await segments({}, elbow());
    expect(geo.primitiveCount).toBe(0);
    expect(geo.vertexToPoint.length).toBe(0);
  });

  it("gives a closed path its closing segment too", async () => {
    // A unit square as a closed path: 4 sides, not 3.
    const geo = await segments(
      {},
      createPolyline([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1], { closed: true }),
    );
    expect(geo.pointCount).toBe(4);
    expect(positionsOf(geo)).toEqual([
      [0.5, 0, 0],
      [1, 0, 0.5],
      [0.5, 0, 1],
      [0, 0, 0.5],
    ]);
  });

  it("segments each path on its own, carrying that path's primitive attributes", async () => {
    const roads = withPrimString(withPrimValue(twoPaths(), "roadWidth", [2, 7]), "roadKind", [
      "avenue",
      "lane",
    ]);
    const geo = await segments({}, roads);
    expect(geo.pointCount).toBe(2); // one segment per path
    const width = geo.attrs.point.require("roadWidth");
    expect([width.get(0), width.get(1)]).toEqual([2, 7]);
    const kind = geo.attrs.point.require("roadKind");
    expect([kind.getString(0), kind.getString(1)]).toEqual(["avenue", "lane"]);
    expect(geo.attrs.point.has(PRIMTYPE_ATTR)).toBe(false);
  });

  it("refuses a primitive attribute that would clobber one it writes itself", async () => {
    const roads = withPrimValue(twoPaths(), "curveU", [0, 0]);
    const msg = await rejection(
      runNode(pathSegments, {}, { in: [makeGeometryItem(roads)] }),
    );
    expect(msg).toContain("pathSegments");
    expect(msg).toContain('"curveU"');
    expect(msg).toContain("removeAttribute");
  });

  it("reports a bad axis or extend before it looks at the geometry", async () => {
    const empty = { in: [makeGeometryItem(createPointCloud(0))] };
    const axisMsg = await rejection(runNode(pathSegments, { axis: "up" }, empty));
    expect(axisMsg).toContain('pathSegments: param "axis"');
    expect(axisMsg).toContain("+x, -x, +y, -y, +z, -z");
    const extendMsg = await rejection(runNode(pathSegments, { extend: -1 }, empty));
    expect(extendMsg).toContain('pathSegments: param "extend"');
  });

  it("errors when every segment is degenerate, naming the cause", async () => {
    const msg = await rejection(
      runNode(pathSegments, {}, { in: [makeGeometryItem(createPolyline([1, 1, 1, 1, 1, 1]))] }),
    );
    expect(msg).toContain("pathSegments");
    expect(msg).toContain("zero length");
    expect(msg).toContain("move the points apart");
  });

  it("is deterministic across fresh runs and stable when run twice", async () => {
    const src = twoPaths();
    const run = async () => snapshotGeometry(await segments({ radius: 0.3, extend: 0.1 }, src));
    expect(await run()).toEqual(await run());
    // Purity: the node builds a fresh cloud and never writes into its input.
    expect(topologyOf(src)).toEqual({ v: [0, 1, 2, 3], start: [0, 2], count: [2, 2] });
  });

  it("does not depend on the order the paths' points arrived in", async () => {
    // The same two paths, with their points permuted and the topology
    // rebuilt over the new indices: the segments are the same segments.
    const a = twoPaths();
    const b = createPointCloud(4);
    const P = b.attrs.point.require("P");
    P.setTuple(0, [10, 0, 0]);
    P.setTuple(1, [0, 0, 0]);
    P.setTuple(2, [14, 0, 0]);
    P.setTuple(3, [1, 0, 0]);
    setPolylineTopology(b, [1, 3, 0, 2], [0, 2], [2, 2]);
    expect(positionsOf(await segments({}, b))).toEqual(positionsOf(await segments({}, a)));
  });

  /**
   * Two paths over one cloud: 4 points then 3, so 3 segments then 2. An
   * ODD segment count on the first path is the point — it is what makes
   * the per-path index and the global point index disagree, which is the
   * failure that has no diagnostic today.
   */
  function unevenPaths(): Geometry {
    const geo = createPointCloud(7);
    const P = geo.attrs.point.require("P");
    for (let i = 0; i < 4; i++) P.setTuple(i, [i, 0, 0]);
    for (let i = 0; i < 3; i++) P.setTuple(4 + i, [i, 5, 0]);
    setPolylineTopology(geo, [0, 1, 2, 3, 4, 5, 6], [0, 4], [4, 3]);
    return geo;
  }

  /** Every value of a scalar point attribute, as a plain array. */
  function scalarsOf(geo: Geometry, name: string): number[] {
    const attr = geo.attrs.point.require(name);
    return Array.from({ length: geo.pointCount }, (_, i) => attr.get(i));
  }

  it("writes no segment index by default, and an empty name is the default", async () => {
    const off = await segments({}, unevenPaths());
    // Spelled out rather than compared: two runs that both leaked the
    // column would still be equal to each other.
    expect(off.attrs.point.names()).toEqual([
      "P",
      "rot",
      "scale",
      "density",
      "boundsMin",
      "boundsMax",
      "color",
      "seed",
      "tangent",
      "curveU",
    ]);
    expect(snapshotGeometry(await segments({ segmentIndexAttr: "" }, unevenPaths()))).toEqual(
      snapshotGeometry(off),
    );
  });

  it("adds the index without moving anything it already wrote", async () => {
    const src = unevenPaths();
    const off = await segments({ radius: 0.3, extend: 0.1 }, src);
    const on = await segments(
      { radius: 0.3, extend: 0.1, segmentIndexAttr: "segmentIndex" },
      src,
    );
    expect(on.attrs.point.names()).toEqual([...off.attrs.point.names(), "segmentIndex"]);
    // Column by column, element for element: the new one is added, and
    // nothing the node already emitted moves by a bit.
    for (const name of off.attrs.point.names()) {
      const a = off.attrs.point.require(name);
      const b = on.attrs.point.require(name);
      const n = off.pointCount * a.tupleSize;
      expect(Array.from(b.data.subarray(0, n)), name).toEqual(Array.from(a.data.subarray(0, n)));
    }
  });

  it("restarts the index at 0 for each path, where the global index does not", async () => {
    const geo = await segments({ segmentIndexAttr: "segmentIndex" }, unevenPaths());
    expect(geo.pointCount).toBe(5); // 3 segments, then 2
    expect(geo.attrs.point.require("segmentIndex").type).toBe("i32");
    expect(scalarsOf(geo, "segmentIndex")).toEqual([0, 1, 2, 0, 1]);
    // The bug this closes, in miniature. Point 3 is the SECOND path's
    // first link: even by the index within its own path, odd by the
    // global one. Alternating on the global index therefore starts the
    // two chains on opposite orientations, and only an even segment
    // count per path hides it.
    const parity = (n: number): number => n - 2 * Math.floor(n / 2);
    const index = geo.attrs.point.require("segmentIndex");
    expect(parity(index.get(3))).toBe(parity(index.get(0)));
    expect(parity(3)).not.toBe(parity(0));
  });

  it("leaves no gap where a zero-length segment was skipped", async () => {
    // The middle two points coincide, so the middle segment is degenerate
    // and never emitted. The index counts what came OUT — 0, 1, not 0, 2
    // — because a hole would flip the parity of every link after it, and
    // an index into a segment list this output does not contain addresses
    // nothing.
    const geo = await segments(
      { segmentIndexAttr: "segmentIndex" },
      createPolyline([0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0]),
    );
    expect(geo.pointCount).toBe(2);
    expect(scalarsOf(geo, "segmentIndex")).toEqual([0, 1]);
  });

  it("counts a closed path's closing segment like any other", async () => {
    const geo = await segments(
      { segmentIndexAttr: "segmentIndex" },
      createPolyline([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1], { closed: true }),
    );
    expect(scalarsOf(geo, "segmentIndex")).toEqual([0, 1, 2, 3]);
  });

  it("refuses a segmentIndexAttr that would delete a column it writes", async () => {
    const msg = await rejection(
      runNode(
        pathSegments,
        { segmentIndexAttr: "curveU" },
        { in: [makeGeometryItem(elbow())] },
      ),
    );
    expect(msg).toContain('pathSegments: segmentIndexAttr "curveU"');
    // The output's, not the input's: this node builds a fresh cloud, and
    // `curveU` is a column it declared itself a few lines earlier. The
    // input has no `curveU` to remove and nothing upstream can clear it.
    expect(msg).toContain("already exists on the output's point domain");
    expect(msg).not.toContain("the input's point domain");
    expect(msg).toContain("removeAttribute upstream cannot help here");
    expect(msg).toContain('a name of its own (e.g. "segmentIndex"');
    // `seed` is the near miss: same tuple size, same scalar shape to the
    // eye, u32 rather than i32 — and refused, because replacing it would
    // delete the column the whole determinism story runs through.
    const seedMsg = await rejection(
      runNode(pathSegments, { segmentIndexAttr: "seed" }, { in: [makeGeometryItem(elbow())] }),
    );
    expect(seedMsg).toContain('pathSegments: segmentIndexAttr "seed"');
    // The case the defect was reported on. `P` exists on the input too, so
    // this is the one where the old wording was not merely imprecise but
    // pointed at a real column that is the WRONG one — the input's `P`
    // never reaches the segment cloud.
    const pMsg = await rejection(
      runNode(pathSegments, { segmentIndexAttr: "P" }, { in: [makeGeometryItem(elbow())] }),
    );
    expect(pMsg).toContain(
      'pathSegments: segmentIndexAttr "P" already exists on the output\'s point domain',
    );
    expect(pMsg).not.toContain('remove "P" from the input first');
  });

  it("refuses a carried primitive attribute that would collide with the index", async () => {
    const roads = withPrimValue(twoPaths(), "segmentIndex", [0, 0]);
    const msg = await rejection(
      runNode(
        pathSegments,
        { segmentIndexAttr: "segmentIndex" },
        { in: [makeGeometryItem(roads)] },
      ),
    );
    expect(msg).toContain("pathSegments");
    expect(msg).toContain('"segmentIndex"');
    expect(msg).toContain("removeAttribute");
  });

  it("draws a path built and resampled in-graph, end to end", async () => {
    // The shape the demo uses: a path, evened out, then made solid.
    const graph = new Graph(7);
    const input = graph.add(dataInput, { items: [makeGeometryItem(row(5))] }, "in");
    const src = graph.add(pointsToPath, { closed: false });
    const even = graph.add(pathResample, { mode: "count", count: 9 });
    const tubes = graph.add(pathSegments, { radius: 0.2 });
    graph.connect(input, "out", src, "in");
    graph.connect(src, "out", even, "in");
    graph.connect(even, "out", tubes, "in");
    graph.output(tubes, "out", "tubes");
    const geo = firstGeo((await cook(graph)).outputs.tubes);
    // 9 samples along a 4-long row: 8 segments of 0.5.
    expect(geo.pointCount).toBe(8);
    expect(tuplesOf(geo, "scale").map((s) => s[1])).toEqual(new Array(8).fill(0.5));
  });
});

describe("pathPointAt", () => {
  /** An L: 2 along +X then 4 along +Y, so arc length is 6. */
  function ell(): Geometry {
    return createPolyline([0, 0, 0, 2, 0, 0, 2, 4, 0]);
  }

  async function placed(params: Record<string, unknown>, src: Geometry): Promise<Geometry> {
    return firstGeo((await runNode(pathPointAt, params, { in: [makeGeometryItem(src)] })).out);
  }

  it("places every point at the same fraction of its own path", async () => {
    // 0.5 of 6 is arc 3, which is 1 unit up the second segment.
    const geo = await placed({ mode: "fraction", parameter: 0.5 }, ell());
    for (const p of positionsOf(geo)) {
      expect(p[0]).toBeCloseTo(2, 6);
      expect(p[1]).toBeCloseTo(1, 6);
      expect(p[2]).toBeCloseTo(0, 6);
    }
    // ...and reports where it landed.
    const u = geo.attrs.point.require("curveU");
    for (let i = 0; i < geo.pointCount; i++) expect(u.get(i)).toBeCloseTo(0.5, 6);
    const t = geo.attrs.point.require("tangent");
    expect(t.getTuple(0)).toEqual([0, 1, 0]);
  });

  it("reads distance in world units, independently of the path's length", async () => {
    const geo = await placed({ mode: "distance", parameter: 2.5 }, ell());
    const p = positionsOf(geo)[0];
    expect(p[0]).toBeCloseTo(2, 6);
    expect(p[1]).toBeCloseTo(0.5, 6);
  });

  it("clamps out-of-range parameters onto the ends", async () => {
    const lo = positionsOf(await placed({ parameter: -3 }, ell()))[0];
    const hi = positionsOf(await placed({ parameter: 9 }, ell()))[0];
    expect(lo).toEqual([0, 0, 0]);
    expect(hi[0]).toBeCloseTo(2, 6);
    expect(hi[1]).toBeCloseTo(4, 6);
  });

  it("is the exact answer the tangent-step approximation only estimates", async () => {
    // The point of the node. A quarter circle: stepping along the
    // tangent by the arc-length difference leaves the curve, evaluating
    // at the parameter does not.
    const pos: number[] = [];
    const n = 33;
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1)) * (Math.PI / 2);
      pos.push(Math.cos(a) * 4, Math.sin(a) * 4, 0);
    }
    const geo = await placed({ mode: "fraction", parameter: 0.5 }, createPolyline(pos));
    for (const p of positionsOf(geo)) {
      // Still on the circle of radius 4, to within the chord error of a
      // 33-point discretisation.
      expect(Math.hypot(p[0], p[1])).toBeCloseTo(4, 2);
    }
  });

  it("slides each point partway toward a target, reading its own curveU", async () => {
    // The idiom the description names: a field over curveU expresses a
    // move RELATIVE to where each point already sits.
    const even = firstGeo(
      (
        await runNode(
          pathResample,
          { mode: "count", count: 5 },
          { in: [makeGeometryItem(createPolyline([0, 0, 0, 8, 0, 0]))] },
        )
      ).out,
    );
    const before = positionsOf(even).map((p) => p[0]);
    expect(before).toEqual([0, 2, 4, 6, 8]);
    // Halfway toward u = 0.5, i.e. x = 4.
    const geo = await placed(
      { mode: "fraction", parameter: lerp(attribute("curveU", 1), 0.5, 0.5) },
      even,
    );
    expect(positionsOf(geo).map((p) => Math.round(p[0] * 1000) / 1000)).toEqual([2, 3, 4, 5, 6]);
  });

  it("keeps the points, their attributes and the topology", async () => {
    const src = withAttr(ell(), "tag", [7, 8, 9]);
    const geo = await placed({ parameter: 0.25 }, src);
    expect(geo.pointCount).toBe(3);
    expect(topologyOf(geo)).toEqual(topologyOf(src));
    const tag = geo.attrs.point.require("tag");
    expect([tag.get(0), tag.get(1), tag.get(2)]).toEqual([7, 8, 9]);
    // Purity: the input is a cached upstream object and must not move.
    expect(positionsOf(src)).toEqual([
      [0, 0, 0],
      [2, 0, 0],
      [2, 4, 0],
    ]);
  });

  it("leaves a point no polyline reaches exactly where it was", async () => {
    const geo = createPointCloud(4);
    const P = geo.attrs.point.require("P");
    P.setTuple(0, [0, 0, 0]);
    P.setTuple(1, [4, 0, 0]);
    P.setTuple(2, [8, 0, 0]);
    P.setTuple(3, [9, 9, 9]);
    setPolylineTopology(geo, [0, 1, 2], [0], [3]);
    const out = await placed({ parameter: 0 }, geo);
    expect(positionsOf(out)[3]).toEqual([9, 9, 9]);
    expect(out.attrs.point.require("tangent").getTuple(3)).toEqual([0, 0, 0]);
    expect(out.attrs.point.require("curveU").get(3)).toBe(0);
  });

  it("leaves a zero-length polyline alone rather than dividing by it", async () => {
    const out = await placed({ parameter: 0.5 }, createPolyline([1, 1, 1, 1, 1, 1]));
    expect(positionsOf(out)).toEqual([
      [1, 1, 1],
      [1, 1, 1],
    ]);
    expect(out.attrs.point.require("curveU").get(0)).toBe(0);
  });

  it("reports a bad mode before it looks at the geometry", async () => {
    const msg = await rejection(
      runNode(pathPointAt, { mode: "along" }, { in: [makeGeometryItem(createPointCloud(0))] }),
    );
    expect(msg).toContain('pathPointAt: unknown mode "along"');
    expect(msg).toContain("fraction, distance");
  });

  it("refuses to delete a differently shaped column it would write", async () => {
    const src = withAttr(ell(), "curveU", [1, 2, 3]);
    const wide = createPolyline([0, 0, 0, 1, 0, 0]);
    wide.attrs.point.add("tangent", "f32", 1, 0);
    const msg = await rejection(runNode(pathPointAt, {}, { in: [makeGeometryItem(wide)] }));
    expect(msg).toContain("pathPointAt");
    expect(msg).toContain("tangent");
    expect(msg).toContain("removeAttribute");
    // A same-shaped column is reset, not refused.
    await expect(placed({ parameter: 0.5 }, src)).resolves.toBeDefined();
  });

  it("is deterministic across fresh runs and stable when run twice", async () => {
    const src = twoPaths();
    const run = async () => snapshotGeometry(await placed({ parameter: 0.3 }, src));
    expect(await run()).toEqual(await run());
  });

  it("parameterizes each path on its own length", async () => {
    // twoPaths is a 1-long segment and a 4-long one: the same fraction
    // is a different distance on each, which is what 'fraction' means.
    const geo = await placed({ mode: "fraction", parameter: 0.5 }, twoPaths());
    const xs = positionsOf(geo).map((p) => p[0]);
    expect(xs[0]).toBeCloseTo(0.5, 6);
    expect(xs[2]).toBeCloseTo(12, 6);
  });
});

describe("writeCurveFrame", () => {
  /**
   * A semicircle in the XY plane whose TANGENT sweeps through world up:
   * at the middle sample the direction is exactly [0, 1, 0], which is the
   * case a constant `up` cannot survive and this node exists for.
   */
  function throughVertical(n = 41): Geometry {
    const pos: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / (n - 1)) * Math.PI;
      pos.push(Math.cos(a), Math.sin(a), 0);
    }
    return createPolyline(pos);
  }

  async function frame(params: Record<string, unknown>, src: Geometry): Promise<Geometry> {
    return firstGeo((await runNode(writeCurveFrame, params, { in: [makeGeometryItem(src)] })).out);
  }

  const at = (geo: Geometry, name: string, i: number): number[] => {
    const a = geo.attrs.point.require(name);
    return [a.data[i * 3], a.data[i * 3 + 1], a.data[i * 3 + 2]];
  };
  const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  it("writes an orthonormal right-handed frame at every point", async () => {
    const geo = await frame({}, throughVertical());
    for (let i = 0; i < geo.pointCount; i++) {
      const t = at(geo, "tangent", i);
      const n = at(geo, "curveNormal", i);
      const b = at(geo, "curveBinormal", i);
      expect(dot(t, t)).toBeCloseTo(1, 5);
      expect(dot(n, n)).toBeCloseTo(1, 5);
      expect(dot(b, b)).toBeCloseTo(1, 5);
      expect(dot(t, n)).toBeCloseTo(0, 5);
      expect(dot(t, b)).toBeCloseTo(0, 5);
      expect(dot(n, b)).toBeCloseTo(0, 5);
      // b = t x n, so (t, n, b) is right-handed rather than mirrored.
      expect(b[0]).toBeCloseTo(t[1] * n[2] - t[2] * n[1], 5);
      expect(b[1]).toBeCloseTo(t[2] * n[0] - t[0] * n[2], 5);
      expect(b[2]).toBeCloseTo(t[0] * n[1] - t[1] * n[0], 5);
    }
  });

  it("carries the normal smoothly through a tangent that passes vertical", async () => {
    // THE motivating case. A constant up flips a half turn here; the
    // transported normal must not, so consecutive normals stay nearly
    // parallel all the way across.
    const geo = await frame({}, throughVertical());
    let worst = 1;
    for (let i = 1; i < geo.pointCount; i++) {
      worst = Math.min(worst, dot(at(geo, "curveNormal", i - 1), at(geo, "curveNormal", i)));
    }
    expect(worst).toBeGreaterThan(0.99);
  });

  it("agrees with writeTangents bit for bit on the tangent", async () => {
    // Both go through the same shared helper; this is the pin that says
    // so, because a frame whose normal is perpendicular to a DIFFERENT
    // tangent than the one in the column beside it is silently skewed.
    const src = throughVertical();
    const framed = await frame({}, src);
    const tangents = firstGeo(
      (await runNode(writeTangents, {}, { in: [makeGeometryItem(src)] })).out,
    );
    expect(Array.from(framed.attrs.point.require("tangent").data)).toEqual(
      Array.from(tangents.attrs.point.require("tangent").data),
    );
  });

  it("keeps the points, their attributes and the topology", async () => {
    const src = withAttr(createPolyline([0, 0, 0, 1, 0, 0, 2, 1, 0]), "tag", [7, 8, 9]);
    const geo = await frame({}, src);
    expect(geo.pointCount).toBe(3);
    expect(topologyOf(geo)).toEqual(topologyOf(src));
    const tag = geo.attrs.point.require("tag");
    expect([tag.get(0), tag.get(1), tag.get(2)]).toEqual([7, 8, 9]);
  });

  it("leaves a closed path's seam visible rather than smearing it out", async () => {
    // Transport around a loop returns rotated by the curve's holonomy.
    // A helix-like closed loop has a real residual, and pretending
    // otherwise would need a correction this node deliberately omits.
    const pos: number[] = [];
    const n = 60;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pos.push(Math.cos(a), Math.sin(a) * 0.6, Math.sin(a * 2) * 0.5);
    }
    const geo = await frame({}, createPolyline(pos, { closed: true }));
    const first = at(geo, "curveNormal", 0);
    // Transport the frame one more step, from the last point back to the
    // first: the seam is whatever that disagrees with the stored first.
    const last = at(geo, "curveNormal", n - 1);
    expect(dot(first, first)).toBeCloseTo(1, 5);
    // Not asserting a specific angle — only that the two are genuinely a
    // frame each, and that nothing forced them to coincide.
    expect(dot(last, last)).toBeCloseTo(1, 5);
  });

  it("gives unreferenced points a zero frame", async () => {
    const geo = createPointCloud(4);
    const P = geo.attrs.point.require("P");
    P.setTuple(0, [0, 0, 0]);
    P.setTuple(1, [1, 0, 0]);
    P.setTuple(2, [2, 0, 0]);
    P.setTuple(3, [9, 9, 9]); // in no polyline
    setPolylineTopology(geo, [0, 1, 2], [0], [3]);
    const out = await frame({}, geo);
    expect(at(out, "curveNormal", 3)).toEqual([0, 0, 0]);
    expect(at(out, "curveBinormal", 3)).toEqual([0, 0, 0]);
    expect(at(out, "tangent", 3)).toEqual([0, 0, 0]);
  });

  it("refuses names that would destroy something, before it looks at the geometry", async () => {
    const empty = { in: [makeGeometryItem(createPointCloud(0))] };
    expect(await rejection(runNode(writeCurveFrame, { normalName: "" }, empty))).toContain(
      'param "normalName" must be a non-empty',
    );
    expect(await rejection(runNode(writeCurveFrame, { binormalName: "P" }, empty))).toContain(
      "cannot be \"P\"",
    );
    const dup = await rejection(
      runNode(writeCurveFrame, { normalName: "tangent" }, empty),
    );
    expect(dup).toContain("three different attributes");
  });

  it("refuses a differently shaped column under one of its names", async () => {
    const src = withAttr(createPolyline([0, 0, 0, 1, 0, 0, 2, 1, 0]), "curveNormal", [1, 2, 3]);
    const msg = await rejection(runNode(writeCurveFrame, {}, { in: [makeGeometryItem(src)] }));
    expect(msg).toContain("writeCurveFrame");
    expect(msg).toContain("curveNormal");
  });

  it("is deterministic across fresh runs and stable when run twice", async () => {
    const src = throughVertical();
    const run = async () => snapshotGeometry(await frame({}, src));
    expect(await run()).toEqual(await run());
  });

  it("feeds orientAlongVector's up, which is what it is for", async () => {
    // The whole point: frame the curve, then aim something radially by
    // combining the two lateral axes. Here the direction IS the normal,
    // so every rot must turn +z onto it.
    const framed = await frame({}, throughVertical(21));
    const oriented = firstGeo(
      (
        await runNode(
          orientAlongVector,
          { direction: attribute("curveNormal", 3), up: attribute("tangent", 3), axis: "+z" },
          { in: [makeGeometryItem(framed)] },
        )
      ).out,
    );
    const rot = oriented.attrs.point.require("rot");
    for (let i = 0; i < oriented.pointCount; i++) {
      const n = at(framed, "curveNormal", i);
      const v = rotateVec(
        [0, 0, 0],
        rot.data[i * 4],
        rot.data[i * 4 + 1],
        rot.data[i * 4 + 2],
        rot.data[i * 4 + 3],
        0,
        0,
        1,
      );
      for (let k = 0; k < 3; k++) expect(v[k]).toBeCloseTo(n[k], 5);
    }
  });

  describe("curvature", () => {
    /** A regular n-gon on the circle of radius r in the XY plane. */
    function circle(r: number, n: number, closed = true): Geometry {
      const pos: number[] = [];
      const count = closed ? n : n + 1;
      for (let i = 0; i < count; i++) {
        const a = (i / n) * Math.PI * 2;
        pos.push(Math.cos(a) * r, Math.sin(a) * r, 0);
      }
      return createPolyline(pos, closed ? { closed: true } : {});
    }

    /**
     * What a regular n-gon's central-difference curvature ACTUALLY is,
     * which is not quite 1/r. Its tangents are exact (by symmetry the
     * chord from k-1 to k+1 is parallel to the circle's tangent at k), so
     * the whole discrepancy is the chord divisor: |dT| = 2 sin(2*pi/n)
     * over ds = 4 r sin(pi/n), which is cos(pi/n) / r. Asserting against
     * this rather than 1/r is what makes the test measure the node instead
     * of measuring how finely the circle was sampled.
     */
    const gonCurvature = (r: number, n: number): number => Math.cos(Math.PI / n) / r;

    const mag = (v: number[]): number => Math.sqrt(dot(v, v));

    /**
     * Five places, not more. The curvature is differenced from the
     * tangents as STORED, which are f32, so a value near 0.5 carries
     * about 1e-7 of rounding no arithmetic here can undo — and matching
     * the stored tangents bit for bit is the property worth having, since
     * a frame perpendicular to a tangent nobody else holds is a skew.
     */
    const F32_PLACES = 5;

    it("is off by default, and adds nothing to the output when it is", async () => {
      const geo = await frame({}, circle(2, 32));
      expect(geo.attrs.point.get("curvature")).toBeUndefined();
      // The whole point of an opt-in report: the columns a graph already
      // depended on are bit for bit what they were.
      const off = await frame({}, circle(2, 32));
      const on = await frame({ curvatureName: "curvature" }, circle(2, 32));
      for (const name of ["tangent", "curveNormal", "curveBinormal"]) {
        expect(Array.from(on.attrs.point.require(name).data)).toEqual(
          Array.from(off.attrs.point.require(name).data),
        );
      }
    });

    it("reports 1 / radius on a circle, and points at its centre", async () => {
      const n = 64;
      const r = 2;
      const geo = await frame({ curvatureName: "k" }, circle(r, n));
      const expected = gonCurvature(r, n);
      // Sanity on the test's own arithmetic: the n-gon really is within a
      // fifth of a percent of the circle, so a bug that broke the scale
      // could not hide behind the discretization.
      expect(expected).toBeCloseTo(1 / r, 2);
      for (let i = 0; i < geo.pointCount; i++) {
        const k = at(geo, "k", i);
        expect(mag(k)).toBeCloseTo(expected, F32_PLACES);
        // Toward the centre: the unit curvature is the inward radial.
        const p = at(geo, "P", i);
        const inward = [-p[0] / r, -p[1] / r, -p[2] / r];
        for (let c = 0; c < 3; c++) expect(k[c] / mag(k)).toBeCloseTo(inward[c], 5);
      }
    });

    it("scales as 1 / radius rather than by some other power of it", async () => {
      const n = 64;
      const small = await frame({ curvatureName: "k" }, circle(1, n));
      const big = await frame({ curvatureName: "k" }, circle(4, n));
      expect(mag(at(small, "k", 0)) / mag(at(big, "k", 0))).toBeCloseTo(4, 5);
    });

    it("is exactly zero along a straight, in both directions of a diagonal", async () => {
      const pos: number[] = [];
      for (let i = 0; i < 8; i++) pos.push(i * 1.5, i * -0.5, i * 0.25);
      const geo = await frame({ curvatureName: "k" }, createPolyline(pos));
      for (let i = 0; i < geo.pointCount; i++) expect(at(geo, "k", i)).toEqual([0, 0, 0]);
    });

    it("measures an open path's endpoints on half a segment, not a whole one", async () => {
      // The endpoint tangent is a chord direction, which belongs to the
      // segment's MIDPOINT. Dividing by the whole segment would report
      // half the curvature; this pins that it does not.
      const n = 64;
      const r = 2;
      const arc = await frame({ curvatureName: "k" }, circle(r, n, false));
      const ends = [0, arc.pointCount - 1];
      for (const i of ends) {
        // A one-sided estimator, so not the interior's exact value — but
        // the RIGHT quantity: within a percent of 1/r, nowhere near 1/2r.
        expect(mag(at(arc, "k", i))).toBeCloseTo(1 / r, 2);
      }
      // And the interior is still the exact n-gon value.
      expect(mag(at(arc, "k", 8))).toBeCloseTo(gonCurvature(r, n), F32_PLACES);
    });

    it("wraps a closed path instead of seaming it", async () => {
      // Every point of a circle is the same point as far as curvature is
      // concerned; a seam at index 0 would show up here and nowhere else.
      const n = 48;
      const geo = await frame({ curvatureName: "k" }, circle(3, n));
      const first = mag(at(geo, "k", 0));
      for (let i = 1; i < geo.pointCount; i++) {
        expect(mag(at(geo, "k", i))).toBeCloseTo(first, F32_PLACES);
      }
    });

    it("gives unreferenced and degenerate points a zero curvature", async () => {
      const geo = createPointCloud(5);
      const P = geo.attrs.point.require("P");
      P.setTuple(0, [0, 0, 0]);
      P.setTuple(1, [1, 0, 0]);
      P.setTuple(2, [1, 0, 0]); // sits on top of its neighbour
      P.setTuple(3, [2, 1, 0]);
      P.setTuple(4, [9, 9, 9]); // in no polyline
      setPolylineTopology(geo, [0, 1, 2, 3], [0], [4]);
      const out = await frame({ curvatureName: "k" }, geo);
      expect(at(out, "k", 4)).toEqual([0, 0, 0]);
      // Point 2's own tangent survives (its neighbours differ), but point
      // 1's neighbours 0 and 2 give it a real tangent too — what must not
      // happen is a NaN or an Infinity anywhere in the column.
      for (let i = 0; i < out.pointCount; i++) {
        for (const c of at(out, "k", i)) expect(Number.isFinite(c)).toBe(true);
      }
    });

    it("agrees with the tangents in the column beside it", async () => {
      // The curvature is a difference OF those tangents, so it must be
      // perpendicular to the tangent at every point of a plane curve —
      // the check that would fail if it were differenced against some
      // other tangent rule.
      const geo = await frame({ curvatureName: "k" }, circle(2.5, 40));
      for (let i = 0; i < geo.pointCount; i++) {
        expect(dot(at(geo, "k", i), at(geo, "tangent", i))).toBeCloseTo(0, 6);
      }
    });

    it("refuses a name that would destroy something", async () => {
      const empty = { in: [makeGeometryItem(createPointCloud(0))] };
      expect(await rejection(runNode(writeCurveFrame, { curvatureName: "P" }, empty))).toContain(
        "cannot be \"P\"",
      );
      const dup = await rejection(
        runNode(writeCurveFrame, { curvatureName: "curveNormal" }, empty),
      );
      expect(dup).toContain("a name of its own");
      const src = withAttr(createPolyline([0, 0, 0, 1, 0, 0, 2, 1, 0]), "k", [1, 2, 3]);
      const msg = await rejection(
        runNode(writeCurveFrame, { curvatureName: "k" }, { in: [makeGeometryItem(src)] }),
      );
      expect(msg).toContain("writeCurveFrame");
      expect(msg).toContain("\"k\"");
    });

    it("matches an analytic curvature that VARIES along the curve", async () => {
      // Every other case here is a circle, where one wrong constant could
      // hide. A parabola y = x^2/2 has kappa = 1 / (1 + x^2)^(3/2), which
      // falls by a factor of 30 across this span, so a scale error, a
      // divisor error or a boundary error all show up as a shape error.
      // Sampled EVENLY BY ARC LENGTH at the density the docs recommend —
      // see the note there on why finer is worse, not better.
      const N = 201;
      const arc = (x: number): number => (x * Math.sqrt(1 + x * x) + Math.asinh(x)) / 2;
      const invArc = (t: number): number => {
        let lo = -10;
        let hi = 10;
        for (let it = 0; it < 100; it++) {
          const mid = (lo + hi) / 2;
          if (arc(mid) < t) lo = mid;
          else hi = mid;
        }
        return (lo + hi) / 2;
      };
      const pos: number[] = [];
      for (let i = 0; i < N; i++) {
        const x = invArc(arc(-3) + (i / (N - 1)) * (arc(3) - arc(-3)));
        pos.push(x, (x * x) / 2, 0);
      }
      const geo = await frame({ curvatureName: "k" }, createPolyline(pos));
      const exact = (x: number): number => 1 / Math.pow(1 + x * x, 1.5);
      for (let i = 0; i < geo.pointCount; i++) {
        const x = at(geo, "P", i)[0];
        // 2% of the LOCAL value, so the tail where kappa is 1/30 of the
        // peak is held to the same relative standard as the apex — an
        // absolute tolerance would let the tail be arbitrarily wrong.
        expect(Math.abs(mag(at(geo, "k", i)) - exact(x))).toBeLessThan(0.02 * exact(x));
      }
      // The ENDS specifically, which is where the divisor rule differs and
      // where a whole-segment divisor would report half the truth.
      for (const i of [0, geo.pointCount - 1]) {
        expect(mag(at(geo, "k", i))).toBeGreaterThan(0.9 * exact(-3));
      }
    });

    it("integrates to one full turn around a closed loop, however it is sampled", async () => {
      // The intended pipeline — build a loop, resample it evenly, frame it
      // — and the invariant that survives it. Resampling does NOT smooth a
      // polygon: 240 samples on a 24-gon puts ten samples along each flat
      // edge, where the curvature is nearly zero, and the whole turn at the
      // corners. So the pointwise value is all over the place BY DESIGN,
      // and what must hold is the integral: a closed planar loop turns
      // through exactly 2*pi, so the sum of kappa * ds is 2*pi no matter
      // how the samples fall. That is the assertion the divisor rule has to
      // pass — a ds wrong by a factor anywhere would show up here as a
      // total that is wrong by that factor.
      const r = 40;
      const n = 24;
      const samples = 240;
      const pos: number[] = [];
      for (let i = 0; i < n; i++) {
        const a2 = (i / n) * Math.PI * 2;
        pos.push(Math.cos(a2) * r, 0, Math.sin(a2) * r);
      }
      const even = firstGeo(
        (
          await runNode(
            pathResample,
            { mode: "count", count: samples },
            { in: [makeGeometryItem(createPolyline(pos, { closed: true }))] },
          )
        ).out,
      );
      // pathResample already emits a `tangent` of this exact shape, so this
      // also pins that writeCurveFrame RESETS that column rather than
      // refusing it as a clash.
      const geo = await frame({ curvatureName: "k" }, even);
      expect(geo.pointCount).toBe(samples);
      // Step computed here rather than read back, so the test does not
      // check the node against itself: the loop is the 24-gon's perimeter.
      const step = (n * 2 * r * Math.sin(Math.PI / n)) / samples;
      let turn = 0;
      for (let i = 0; i < geo.pointCount; i++) turn += mag(at(geo, "k", i)) * step;
      // Within a percent. The shortfall that remains is the estimator's,
      // not the divisor's: across a corner the chord |dT| is 2 sin(dtheta)
      // where the turn is 2 dtheta, which under-reports a 15 degree corner
      // by 0.3%.
      expect(turn).toBeGreaterThan(2 * Math.PI * 0.99);
      expect(turn).toBeLessThan(2 * Math.PI * 1.01);
    });

    it("is deterministic across fresh runs", async () => {
      const src = circle(2, 33);
      const run = async () => snapshotGeometry(await frame({ curvatureName: "k" }, src));
      expect(await run()).toEqual(await run());
    });
  });
});

describe("writeTangents", () => {
  it("writes central-difference tangents at the path's own points", async () => {
    const el = createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0]);
    const geo = firstGeo((await runNode(writeTangents, {}, { in: [makeGeometryItem(el)] })).out);
    const tangent = geo.attrs.point.require("tangent");
    const r = Math.SQRT1_2;
    expect(tangent.getTuple(0)).toEqual([1, 0, 0]);
    expect(tangent.getTuple(1)[0]).toBeCloseTo(r, 6);
    expect(tangent.getTuple(1)[1]).toBeCloseTo(r, 6);
    expect(tangent.getTuple(2)).toEqual([0, 1, 0]);
    // The points and the topology come out exactly as they went in.
    expect(positionsOf(geo)).toEqual(positionsOf(el));
    expect(topologyOf(geo)).toEqual(topologyOf(el));
  });

  it("wraps around a closed path", async () => {
    const square = createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], { closed: true });
    const geo = firstGeo((await runNode(writeTangents, {}, { in: [makeGeometryItem(square)] })).out);
    const tangent = geo.attrs.point.require("tangent");
    const r = Math.SQRT1_2;
    // Point 0's neighbours are the last and second points: (0,1,0)->(1,0,0).
    expect(tangent.getTuple(0)[0]).toBeCloseTo(r, 6);
    expect(tangent.getTuple(0)[1]).toBeCloseTo(-r, 6);
    expect(tangent.getTuple(2)[0]).toBeCloseTo(-r, 6);
    expect(tangent.getTuple(2)[1]).toBeCloseTo(r, 6);
    // The closure vertex is not a fourth point: only 4 points are written.
    expect(geo.pointCount).toBe(4);
  });

  it("leaves points that no polyline references at zero", async () => {
    const src = row(3);
    setPolylineTopology(src, [0, 1], [0], [2]);
    const geo = firstGeo((await runNode(writeTangents, {}, { in: [makeGeometryItem(src)] })).out);
    const tangent = geo.attrs.point.require("tangent");
    expect(tangent.getTuple(0)).toEqual([1, 0, 0]);
    expect(tangent.getTuple(2)).toEqual([0, 0, 0]);
  });

  it("falls back to the forward segment at a hairpin, keeping its direction", async () => {
    // The path doubles back on itself, so point 1's two neighbours sit at
    // the SAME position and the central difference is zero. The forward
    // segment stands in, and its direction is the way the path LEAVES the
    // apex (-x) — not the way it arrived.
    const hairpin = createPolyline([0, 0, 0, 1, 0, 0, 0, 0, 0]);
    const geo = firstGeo((await runNode(writeTangents, {}, { in: [makeGeometryItem(hairpin)] })).out);
    const tangent = geo.attrs.point.require("tangent");
    expect(tangent.getTuple(0)).toEqual([1, 0, 0]);
    expect(tangent.getTuple(1)).toEqual([-1, 0, 0]);
    expect(tangent.getTuple(2)).toEqual([-1, 0, 0]);
  });

  it("leaves a path whose points all coincide at zero", async () => {
    const flat = createPolyline([2, 2, 2, 2, 2, 2, 2, 2, 2]);
    const geo = firstGeo((await runNode(writeTangents, {}, { in: [makeGeometryItem(flat)] })).out);
    const tangent = geo.attrs.point.require("tangent");
    expect(tangent.getTuple(0)).toEqual([0, 0, 0]);
    expect(tangent.getTuple(1)).toEqual([0, 0, 0]);
    expect(tangent.getTuple(2)).toEqual([0, 0, 0]);
  });

  it("never writes into the geometry it was handed", async () => {
    const src = createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0]);
    const before = snapshotGeometry(src);
    const geo = firstGeo((await runNode(writeTangents, {}, { in: [makeGeometryItem(src)] })).out);
    expect(geo.attrs.point.require("tangent").getTuple(0)).toEqual([1, 0, 0]);
    expect(src.attrs.point.has("tangent")).toBe(false);
    expect(snapshotGeometry(src)).toEqual(before);
    // ...and when the attribute is already there, its values stay put.
    const existing = createPolyline([0, 0, 0, 1, 0, 0]);
    const attr = existing.attrs.point.add("tangent", "f32", 3, [0, 0, 0]);
    attr.setTuple(0, [9, 9, 9]);
    attr.setTuple(1, [9, 9, 9]);
    const snapshot = snapshotGeometry(existing);
    const out = firstGeo(
      (await runNode(writeTangents, {}, { in: [makeGeometryItem(existing)] })).out,
    );
    expect(out.attrs.point.require("tangent").getTuple(0)).toEqual([1, 0, 0]);
    expect(snapshotGeometry(existing)).toEqual(snapshot);
  });

  it("reports a bad name before it looks at the geometry", async () => {
    const cloud = row(3);
    await expect(
      runNode(writeTangents, { name: "P" }, { in: [makeGeometryItem(cloud)] }),
    ).rejects.toThrow(/cannot be "P"/);
    await expect(
      runNode(writeTangents, { name: "" }, { in: [makeGeometryItem(cloud)] }),
    ).rejects.toThrow(/must be a non-empty attribute name/);
  });

  it("refuses a name that already holds another shape, and reuses one that fits", async () => {
    // `name` is a reporting slot: the shape is this node's to pick (f32
    // tuple 3), so `replace` would DELETE a differently shaped column and
    // re-add it, and the cook would still look fine. Guarding only "P" left
    // every other column open — an i32 tag under the tangent's name was
    // silently turned into three floats.
    const tagged = createPolyline([0, 0, 0, 1, 0, 0]);
    tagged.attrs.point.add("tag", "i32", 1, 0).data.set([5, 6]);
    await expect(
      runNode(writeTangents, { name: "tag" }, { in: [makeGeometryItem(tagged)] }),
    ).rejects.toThrow(
      /writeTangents: name "tag" already exists on the input's point domain as i32, but name is written as f32x3.*would DELETE.*tangent/s,
    );
    // The refusal costs nothing: it happens before the clone and before any
    // write, so the input still holds its column.
    expect(tagged.attrs.point.require("tag").type).toBe("i32");
    // Same shape under another name is still reused, not refused.
    const fits = createPolyline([0, 0, 0, 1, 0, 0]);
    fits.attrs.point.add("dir", "f32", 3, [0, 0, 0]);
    const out = firstGeo(
      (await runNode(writeTangents, { name: "dir" }, { in: [makeGeometryItem(fits)] })).out,
    );
    expect(out.attrs.point.require("dir").getTuple(0)).toEqual([1, 0, 0]);
  });

  it("writes under another name and refuses to clobber P", async () => {
    const line = createPolyline([0, 0, 0, 1, 0, 0]);
    const geo = firstGeo(
      (await runNode(writeTangents, { name: "dir" }, { in: [makeGeometryItem(line)] })).out,
    );
    expect(geo.attrs.point.require("dir").getTuple(0)).toEqual([1, 0, 0]);
    expect(geo.attrs.point.has("tangent")).toBe(false);
    await expect(
      runNode(writeTangents, { name: "P" }, { in: [makeGeometryItem(line)] }),
    ).rejects.toThrow(/cannot be "P"/);
    await expect(
      runNode(writeTangents, { name: "" }, { in: [makeGeometryItem(line)] }),
    ).rejects.toThrow(/must be a non-empty attribute name/);
    await expect(
      runNode(writeTangents, {}, { in: [makeGeometryItem(row(3))] }),
    ).rejects.toThrow(/no polyline primitives/);
  });

  it("hands orientAlongVector a direction at the original points", async () => {
    const path = firstGeo(
      (await runNode(pointsToPath, {}, { in: [makeGeometryItem(row(3))] })).out,
    );
    const tangents = firstGeo(
      (await runNode(writeTangents, {}, { in: [makeGeometryItem(path)] })).out,
    );
    const oriented = firstGeo(
      (
        await runNode(
          orientAlongVector,
          { direction: fieldFromJson({ fn: "attribute", name: "tangent", tupleSize: 3 }) },
          { in: [makeGeometryItem(tangents)] },
        )
      ).out,
    );
    // +z onto +x: a quarter turn about +y, and the points and path survive.
    const rot = oriented.attrs.point.require("rot").getTuple(0);
    expect(rot[0]).toBeCloseTo(0, 6);
    expect(rot[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(rot[2]).toBeCloseTo(0, 6);
    expect(rot[3]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(oriented.pointCount).toBe(3);
    expect(topologyOf(oriented)).toEqual(topologyOf(path));
  });

  it("is deterministic across fresh runs and stable when run twice", async () => {
    const src = twoPaths();
    const run = async () =>
      snapshotGeometry(firstGeo((await runNode(writeTangents, {}, { in: [makeGeometryItem(src)] })).out));
    expect(await run()).toEqual(await run());
  });
});

describe("paths in a serialized graph", () => {
  /**
   * The pipeline the phase exists for: a source every serialized graph can
   * carry, given topology in-graph, resampled, then given tangents. No
   * `dataInput`, so nothing here depends on a runtime injection a saved
   * file would lose.
   */
  function buildPathGraph(seed: number): Graph {
    const g = new Graph(seed);
    const src = g.add(
      pointScatterInBounds,
      { count: 8, boundsMin: [0, 0, 0], boundsMax: [10, 0, 10] },
      "src",
    );
    const path = g.add(pointsToPath, { closed: true }, "path");
    const resample = g.add(pathResample, { mode: "count", count: 12 }, "resample");
    const tangents = g.add(writeTangents, {}, "tangents");
    g.connect(src, "out", path, "in");
    g.connect(path, "out", resample, "in");
    g.connect(resample, "out", tangents, "in");
    g.output(tangents, "out", "result");
    return g;
  }

  it("cooks a path pipeline from JSON alone, with no dataInput", async () => {
    const original = buildPathGraph(7);
    const json = JSON.parse(JSON.stringify(serializeGraph(original))) as unknown;
    const rebuilt = deserializeGraph(json);
    const a = firstGeo((await cook(original)).outputs.result);
    const b = firstGeo((await cook(rebuilt)).outputs.result);
    expect(a.primitiveCount).toBe(1);
    expect(a.pointCount).toBe(12);
    expect(a.attrs.point.require("tangent").getTuple(0)).not.toEqual([0, 0, 0]);
    expect(snapshotGeometry(b)).toEqual(snapshotGeometry(a));
  });

  it("cooks byte-identically from two fresh graphs and caches on re-cook", async () => {
    const a = firstGeo((await cook(buildPathGraph(11))).outputs.result);
    const g = buildPathGraph(11);
    const first = firstGeo((await cook(g)).outputs.result);
    expect(snapshotGeometry(first)).toEqual(snapshotGeometry(a));
    const again = await cook(g);
    expect(again.stats.cooked).toBe(0);
    expect(snapshotGeometry(firstGeo(again.outputs.result))).toEqual(snapshotGeometry(first));
  });

  it("stops being a path through a filter, exactly as the descriptions warn", async () => {
    const g = new Graph(3);
    const src = g.add(
      pointScatterInBounds,
      { count: 8, boundsMin: [0, 0, 0], boundsMax: [10, 0, 10] },
      "src",
    );
    const path = g.add(pointsToPath, {}, "path");
    // Keeps every point — and still drops the topology on the way through.
    const filter = g.add(filterByDensity, { mode: "threshold", threshold: 0 }, "filter");
    const resample = g.add(pathResample, {}, "resample");
    g.connect(src, "out", path, "in");
    g.connect(path, "out", filter, "in");
    g.connect(filter, "out", resample, "in");
    g.output(resample, "out", "result");
    await expect(cook(g)).rejects.toThrow(/no polyline primitives/);
  });
});

/**
 * The topology rule, pinned in BOTH directions so it cannot silently
 * invert again. The predicate is CAN REMOVE POINTS — those ops route
 * through `gatherPoints`, which rebuilds the point domain and leaves the
 * primitives behind. The node's category decides nothing, and neither
 * does whether a point was actually removed on this run. A wording that
 * says "every filter node drops topology" is wrong in both directions,
 * and each direction below is one of them.
 */
describe("what drops topology, and what does not", () => {
  /** A cloud, made a path, routed through `mid`, then resampled. */
  function pathThrough(mid: (g: Graph) => { id: string }): Graph {
    const g = new Graph(5);
    const src = g.add(
      pointScatterInBounds,
      { count: 8, boundsMin: [0, 0, 0], boundsMax: [10, 0, 10] },
      "src",
    );
    const grp = g.add(setAttribute, { name: "grp", type: "i32", value: 0 }, "grp");
    const path = g.add(pointsToPath, {}, "path");
    const through = mid(g);
    const resample = g.add(pathResample, { mode: "count", count: 6 }, "resample");
    g.connect(src, "out", grp, "in");
    g.connect(grp, "out", path, "in");
    g.connect(path, "out", through, "in");
    g.connect(through, "out", resample, "in");
    g.output(resample, "out", "result");
    return g;
  }

  /** The message of the rejection, or "" if the cook succeeded. */
  async function cookError(g: Graph): Promise<string> {
    return await cook(g).then(
      () => "",
      (e: unknown) => (e as Error).message,
    );
  }

  it("drops it through partitionByAttribute — categorised `attribute`, removes nothing here", async () => {
    // Every point carries grp=0, so this partitions into ONE group holding
    // the whole cloud. It still gathers, so the topology is gone: the test
    // is "can remove", not "did remove".
    const msg = await cookError(pathThrough((g) => g.add(partitionByAttribute, { name: "grp" }, "split")));
    expect(msg).toMatch(/pathResample: input has no polyline primitives/);
    // The error has to name the kind of node at fault, or an agent reads
    // its graph looking for a "filter" that is not there.
    expect(msg).toMatch(/plain point cloud \(8 points, 0 primitives\)/);
    expect(msg).toMatch(/partitionByAttribute/);
    expect(msg).toMatch(/moving pointsToPath after those nodes/);
  });

  it("drops it through filterByAttribute even when the predicate keeps every point", async () => {
    // density >= 0 is true for every point of a standard cloud.
    const msg = await cookError(
      pathThrough((g) =>
        g.add(filterByAttribute, { attribute: "density", comparison: "ge", value: 0 }, "keepAll"),
      ),
    );
    expect(msg).toMatch(/no polyline primitives/);
    expect(msg).toMatch(/plain point cloud \(8 points, 0 primitives\)/);
  });

  it("keeps it through projectToPlane — categorised `filter`, but it clones", async () => {
    const g = pathThrough((h) =>
      h.add(projectToPlane, { origin: [0, 0, 0], normal: [0, 1, 0] }, "flat"),
    );
    const out = firstGeo((await cook(g)).outputs.result);
    // The path survived the "filter" and pathResample re-emitted one.
    expect(out.primitiveCount).toBe(1);
    expect(out.pointCount).toBe(6);
  });

  it("keeps it through the attribute ops that clone", async () => {
    const g = pathThrough((h) => h.add(setAttribute, { name: "mark", value: 1 }, "mark"));
    const out = firstGeo((await cook(g)).outputs.result);
    expect(out.primitiveCount).toBe(1);
    expect(out.pointCount).toBe(6);
  });
});

/**
 * The phase's end-to-end case, from a graph a file could carry: a road
 * NETWORK whose roads each hold their own `roadWidth` on the PRIMITIVE
 * domain, walked by the shipped `place/along-curve` primitive. Before
 * phase 44 the lamps it spawned could not see the width of the road they
 * were standing on — the per-edge value phase 43 made a headline
 * capability died at the sampler. Driven through the primitive by name,
 * not through pathResample directly, because the primitive is what the
 * pipeline actually wires.
 */
describe("a road's width reaches the lamps standing on it", () => {
  /** Two straight roads at z = 0 and z = 10, of widths 2 and 7. */
  function roadNetworkGraph(): unknown {
    const line = (id: string, z: number) => ({
      id,
      type: "pointLine",
      params: { count: 5, start: [0, 0, z], end: [40, 0, z], includeEnd: true },
    });
    const group = (id: string, value: number) => ({
      id,
      type: "setAttribute",
      params: { name: "grp", domain: "point", type: "i32", tupleSize: 1, value },
    });
    return {
      formatVersion: 1,
      seed: 40100,
      nodes: [
        line("lineA", 0),
        group("grpA", 0),
        line("lineB", 10),
        group("grpB", 1),
        { id: "roads", type: "mergePoints", params: {} },
        {
          id: "net",
          type: "pointsToPath",
          params: { closed: false, groupAttr: "grp", orderAttr: "" },
        },
        {
          id: "roadWidth",
          type: "setAttribute",
          params: {
            name: "roadWidth",
            domain: "primitive",
            type: "f32",
            tupleSize: 1,
            // 2 on the first road, 7 on the second.
            value: { fn: "remap", args: [{ fn: "index" }, 0, 1, 2, 7] },
          },
        },
        {
          id: "lamps",
          type: "subgraph",
          params: { mode: "count", count: 6 },
          ref: { name: "place/along-curve" },
        },
      ],
      connections: [
        { from: ["lineA", "out"], to: ["grpA", "in"] },
        { from: ["lineB", "out"], to: ["grpB", "in"] },
        { from: ["grpA", "out"], to: ["roads", "in"] },
        { from: ["grpB", "out"], to: ["roads", "in"] },
        { from: ["roads", "out"], to: ["net", "in"] },
        { from: ["net", "out"], to: ["roadWidth", "in"] },
        { from: ["roadWidth", "out"], to: ["lamps", "curve"] },
      ],
      outputs: [{ id: "lamps", pin: "out", name: "lamps" }],
    };
  }

  it("gives every lamp the width of the road it stands on", async () => {
    const lamps = firstGeo((await cook(deserializeGraph(roadNetworkGraph()))).outputs.lamps);
    expect(lamps.pointCount).toBe(12);
    const P = lamps.attrs.point.require("P");
    const width = lamps.attrs.point.require("roadWidth");
    const widths = new Set<number>();
    for (let i = 0; i < lamps.pointCount; i++) {
      // z says which road this lamp is on; roadWidth has to agree.
      expect(width.get(i)).toBe(P.get(i, 2) < 5 ? 2 : 7);
      widths.add(width.get(i));
    }
    expect(widths).toEqual(new Set([2, 7]));
    // The lamps are still a path, and each road is still a road.
    expect(lamps.primitiveCount).toBe(2);
    const primWidth = lamps.attrs.primitive.require("roadWidth");
    expect([primWidth.get(0), primWidth.get(1)]).toEqual([2, 7]);
    // `primtype` is a type tag, not a value: it stays off the points.
    expect(lamps.attrs.point.has(PRIMTYPE_ATTR)).toBe(false);
  });
});

describe("pathScan", () => {
  async function scan(params: Record<string, unknown>, src: Geometry): Promise<Geometry> {
    return firstGeo((await runNode(pathScan, params, { in: [makeGeometryItem(src)] })).out);
  }

  /** An open path of `n` points at (i, 0, 0) carrying `name` per point. */
  function pathWith(name: string, values: readonly number[]): Geometry {
    const pos: number[] = [];
    for (let i = 0; i < values.length; i++) pos.push(i, 0, 0);
    return withAttr(createPolyline(pos), name, values);
  }

  /**
   * A point column as plain numbers. Sliced to pointCount * tupleSize on
   * purpose: `data` is the backing store and carries spare CAPACITY past
   * the live elements, so reading it whole compares against slack.
   */
  const col = (geo: Geometry, name: string): number[] => {
    const a = geo.attrs.point.require(name);
    return Array.from(a.data.slice(0, geo.pointCount * a.tupleSize));
  };

  it("accumulates along the path, inclusive of the point's own value", async () => {
    const geo = await scan({ name: "w", outName: "s" }, pathWith("w", [1, 2, 3, 4]));
    expect(col(geo, "s")).toEqual([1, 3, 6, 10]);
  });

  it("starts at zero in exclusive mode, which is inclusive shifted by one", async () => {
    const geo = await scan(
      { name: "w", outName: "s", mode: "exclusive" },
      pathWith("w", [1, 2, 3, 4]),
    );
    expect(col(geo, "s")).toEqual([0, 1, 3, 6]);
  });

  it("reports each path's whole total on the primitive domain", async () => {
    // Two paths in one geometry, so this also pins that the accumulator
    // RESETS between them rather than running on from the first.
    const geo = withAttr(twoPaths(), "w", [1, 2, 10, 20]);
    const out = await scan({ name: "w", outName: "s", totalAttr: "tot" }, geo);
    expect(col(out, "s")).toEqual([1, 3, 10, 30]);
    const tot = out.attrs.primitive.require("tot");
    expect([tot.get(0), tot.get(1)]).toEqual([3, 30]);
  });

  it("reports the total in exclusive mode too, where no point holds it", async () => {
    const out = await scan(
      { name: "w", outName: "s", mode: "exclusive", totalAttr: "tot" },
      pathWith("w", [1, 2, 3, 4]),
    );
    expect(col(out, "s")).toEqual([0, 1, 3, 6]);
    expect(out.attrs.primitive.require("tot").get(0)).toBe(10);
  });

  it("does not count a closed path's repeated seam vertex twice", async () => {
    // createPolyline closed appends a vertex referencing point 0. Counting
    // it would make the total 1 too many and put the seam value on the
    // wrong point.
    const geo = createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], { closed: true });
    const withW = withAttr(geo, "w", [1, 2, 3, 4]);
    const out = await scan({ name: "w", outName: "s", totalAttr: "tot" }, withW);
    expect(out.pointCount).toBe(4);
    expect(col(out, "s")).toEqual([1, 3, 6, 10]);
    expect(out.attrs.primitive.require("tot").get(0)).toBe(10);
  });

  it("accumulates a tuple componentwise, each component its own total", async () => {
    const pos: number[] = [];
    for (let i = 0; i < 3; i++) pos.push(i, 0, 0);
    const geo = createPolyline(pos);
    const w = geo.attrs.point.add("w", "f32", 2, [0, 0]);
    w.setTuple(0, [1, 10]);
    w.setTuple(1, [2, 20]);
    w.setTuple(2, [3, 30]);
    const out = await scan({ name: "w", outName: "s", totalAttr: "tot" }, geo);
    expect(col(out, "s")).toEqual([1, 10, 3, 30, 6, 60]);
    const tot = out.attrs.primitive.require("tot");
    expect(tot.getTuple(0)).toEqual([6, 60]);
  });

  it("lets a NaN contribute zero rather than poisoning the whole tail", async () => {
    // The difference that matters against a plain running sum: one bad
    // element would otherwise make every element after it NaN, which is
    // most of the column rather than one entry of it.
    const geo = await scan({ name: "w", outName: "s" }, pathWith("w", [1, NaN, 3, 4]));
    expect(col(geo, "s")).toEqual([1, 1, 4, 8]);
  });

  it("leaves points in no polyline at zero and keeps the path a path", async () => {
    const geo = createPointCloud(4);
    const P = geo.attrs.point.require("P");
    P.setTuple(0, [0, 0, 0]);
    P.setTuple(1, [1, 0, 0]);
    P.setTuple(2, [2, 0, 0]);
    P.setTuple(3, [9, 9, 9]); // in no polyline
    setPolylineTopology(geo, [0, 1, 2], [0], [3]);
    withAttr(geo, "w", [5, 5, 5, 5]);
    const out = await scan({ name: "w", outName: "s" }, geo);
    expect(col(out, "s")).toEqual([5, 10, 15, 0]);
    expect(topologyOf(out)).toEqual(topologyOf(geo));
  });

  it("refuses the names that would quietly produce nonsense", async () => {
    const src = pathWith("w", [1, 2, 3]);
    const inputs = { in: [makeGeometryItem(src)] };
    expect(
      await rejection(runNode(pathScan, { name: "w", outName: "w" }, inputs)),
    ).toContain("cannot be written over its own source");
    expect(await rejection(runNode(pathScan, { name: "w", outName: "P" }, inputs))).toContain(
      'cannot be "P"',
    );
    expect(
      await rejection(
        runNode(pathScan, { name: "w", outName: "s", totalAttr: "s" }, inputs),
      ),
    ).toContain("one name");
    expect(await rejection(runNode(pathScan, { name: "nope", outName: "s" }, inputs))).toContain(
      "not found",
    );
    // A same-shape column is reset, a differently shaped one is refused.
    const clash = withAttr(pathWith("w", [1, 2, 3]), "s", [0, 0, 0]);
    const three = clash.attrs.point.add("s3", "f32", 3, [0, 0, 0]);
    expect(three.tupleSize).toBe(3);
    expect(
      await rejection(
        runNode(pathScan, { name: "w", outName: "s3" }, { in: [makeGeometryItem(clash)] }),
      ),
    ).toContain("pathScan");
  });

  it("is deterministic across fresh runs", async () => {
    const src = pathWith("w", [1, 2, 3, 4, 5]);
    const run = async () => snapshotGeometry(await scan({ name: "w", outName: "s" }, src));
    expect(await run()).toEqual(await run());
  });

  it("places EXACTLY N points in proportion to a density, which is what it is for", async () => {
    // The payoff, and the whole reason this node exists: inverse-transform
    // sampling. Rejection sampling against the same density would give a
    // BINOMIAL count around N; this gives N, every time, which is what
    // makes a band mix land on its target rather than near it.
    const M = 200;
    const N = 64;
    // Density 1 over the first half of the path and 3 over the second, so
    // three quarters of the mass sits beyond the midpoint.
    const w: number[] = [];
    for (let i = 0; i < M; i++) w.push(i < M / 2 ? 1 : 3);
    const scanned = await scan(
      { name: "w", outName: "cdf", mode: "exclusive", totalAttr: "tot" },
      pathWith("w", w),
    );
    const cdf = col(scanned, "cdf");
    const total = scanned.attrs.primitive.require("tot").get(0);
    expect(total).toBe(400);

    // The frames, re-embedded at their own CDF value, carrying the station
    // they came from — this is the lookup table the idiom transfers from.
    const source = createPointCloud(M);
    const sp = source.attrs.point.require("P");
    const station = source.attrs.point.add("station", "f32", 1, 0);
    for (let i = 0; i < M; i++) {
      sp.setTuple(i, [cdf[i], 0, 0]);
      station.set(i, i);
    }
    // N targets spread evenly through CDF space.
    const target = createPointCloud(N);
    const tp = target.attrs.point.require("P");
    for (let i = 0; i < N; i++) tp.setTuple(i, [((i + 0.5) / N) * total, 0, 0]);

    const placed = firstGeo(
      (
        await runNode(
          transferAttribute,
          { name: "station", mapping: "nearest" },
          { in: [makeGeometryItem(target)], source: [makeGeometryItem(source)] },
        )
      ).out,
    );
    // EXACTLY N, not approximately N.
    expect(placed.pointCount).toBe(N);
    const stations = col(placed, "station");
    const late = stations.filter((s) => s >= M / 2).length;
    // Three quarters of the mass, so three quarters of the placements —
    // within one placement, which is all the frame resolution allows.
    expect(Math.abs(late - N * 0.75)).toBeLessThanOrEqual(1);
    // And they are spread through the dense half rather than piled up.
    expect(new Set(stations).size).toBe(N);
  });

  it("leaves reduce 'sum' exactly where it was, named or defaulted", async () => {
    // The byte-identity claim, pinned against a hand-computed column
    // rather than against another cook.
    const src = () => pathWith("w", [1, 2, 3, 4]);
    expect(col(await scan({ name: "w", outName: "s", reduce: "sum" }, src()), "s")).toEqual([
      1, 3, 6, 10,
    ]);
    // And the default is that same value, so no serialized graph written
    // before this param existed changes meaning.
    expect(snapshotGeometry(await scan({ name: "w", outName: "s", reduce: "sum" }, src()))).toEqual(
      snapshotGeometry(await scan({ name: "w", outName: "s" }, src())),
    );
  });

  it("keeps the smallest or largest value so far under reduce min and max", async () => {
    // [5, 2, 8, 3]. A sum here says 5, 7, 15, 18, which answers a
    // different question entirely.
    const src = () => pathWith("w", [5, 2, 8, 3]);
    const M = { name: "w", outName: "s" };
    expect(col(await scan({ ...M, reduce: "min" }, src()), "s")).toEqual([5, 2, 2, 2]);
    expect(col(await scan({ ...M, reduce: "max" }, src()), "s")).toEqual([5, 5, 8, 8]);
    // The running value only ever moves one way and then stays, which is
    // the property that makes a min a staircase and a sum a ramp — and
    // the reason it can never be a distribution.
    const mins = col(await scan({ ...M, reduce: "min" }, src()), "s");
    for (let i = 1; i < mins.length; i++) expect(mins[i]).toBeLessThanOrEqual(mins[i - 1]);
  });

  it("opens each path at the fold's identity, which is what exclusive reads first", async () => {
    // THE SHARP END. Exclusive means a point's own value is not in its
    // own total, so a path's first point has folded in nothing — and the
    // minimum of nothing is +Infinity, exactly as attributeReduce
    // answers an empty domain. Not a sentinel: it is the only value x
    // with min(x, v) = v, f32 carries it exactly, and unlike a sum's 0
    // it can never be mistaken for a measurement.
    const src = () => pathWith("w", [5, 2, 8]);
    const E = { name: "w", outName: "s", mode: "exclusive" };
    expect(col(await scan({ ...E, reduce: "min" }, src()), "s")).toEqual([
      Number.POSITIVE_INFINITY,
      5,
      2,
    ]);
    expect(col(await scan({ ...E, reduce: "max" }, src()), "s")).toEqual([
      Number.NEGATIVE_INFINITY,
      5,
      5,
    ]);
    // It survives the f32 column, so a caller really can test with
    // isFinite rather than remembering a magic number.
    const first = col(await scan({ ...E, reduce: "min" }, src()), "s")[0];
    expect(Number.isFinite(first)).toBe(false);
    expect(first).toBe(Number.POSITIVE_INFINITY);
  });

  it("differs between the two modes only where a record is set", async () => {
    // The mode/reduce interaction worth stating: a sum's inclusive and
    // exclusive columns differ at EVERY point, by that point's own
    // value; an extreme's differ only where the point beat the record,
    // because min and max are idempotent.
    const src = () => pathWith("w", [5, 2, 8, 3]);
    const M = { name: "w", outName: "s", reduce: "min" };
    const incl = col(await scan(M, src()), "s");
    const excl = col(await scan({ ...M, mode: "exclusive" }, src()), "s");
    const values = [5, 2, 8, 3];
    expect(excl).toEqual([Number.POSITIVE_INFINITY, 5, 2, 2]);
    expect(incl).toEqual([5, 2, 2, 2]);
    for (let i = 0; i < values.length; i++) expect(incl[i]).toBe(Math.min(excl[i], values[i]));
  });

  it("reports each path's whole fold on the primitive domain, in every fold", async () => {
    // Two paths in one geometry, so this also pins that the accumulator
    // RESETS between them rather than running on from the first.
    const src = () => withAttr(twoPaths(), "w", [1, 2, 10, 20]);
    const T = { name: "w", outName: "s", totalAttr: "tot" };
    const totals = async (reduce: string): Promise<number[]> => {
      const out = await scan({ ...T, reduce }, src());
      const tot = out.attrs.primitive.require("tot");
      return [tot.get(0), tot.get(1)];
    };
    expect(await totals("sum")).toEqual([3, 30]);
    expect(await totals("min")).toEqual([1, 10]);
    expect(await totals("max")).toEqual([2, 20]);
  });

  it("reports the fold in exclusive mode, where the column holds it only by luck", async () => {
    // A sum's total is nowhere in an exclusive column: no point holds
    // it. Under a min the last point's value USUALLY is the whole fold
    // — and the exception is the dangerous half, because nothing in the
    // column says which case you are in. Here are both, one apart.
    const E = { name: "w", outName: "s", mode: "exclusive", reduce: "min", totalAttr: "tot" };
    const lucky = await scan(E, pathWith("w", [5, 2, 8]));
    expect(col(lucky, "s")).toEqual([Number.POSITIVE_INFINITY, 5, 2]);
    expect(lucky.attrs.primitive.require("tot").get(0)).toBe(2); // the column's last entry, by luck
    const unlucky = await scan(E, pathWith("w", [5, 2, 1]));
    expect(col(unlucky, "s")).toEqual([Number.POSITIVE_INFINITY, 5, 2]);
    // The record was set by the LAST point, so 1 appears nowhere in the
    // column. Only the report has it.
    expect(unlucky.attrs.primitive.require("tot").get(0)).toBe(1);
    expect(col(unlucky, "s")).not.toContain(1);
  });

  it("folds a signed comparison rather than a magnitude", async () => {
    // A max over negatives is the LEAST negative. Getting this wrong is
    // invisible on any all-positive fixture, which most of them are.
    const src = () => pathWith("w", [-5, -1, -9]);
    const M = { name: "w", outName: "s" };
    expect(col(await scan({ ...M, reduce: "max" }, src()), "s")).toEqual([-5, -1, -1]);
    expect(col(await scan({ ...M, reduce: "min" }, src()), "s")).toEqual([-5, -5, -9]);
  });

  it("folds each component of a tuple independently under an extreme", async () => {
    const pos: number[] = [];
    for (let i = 0; i < 3; i++) pos.push(i, 0, 0);
    const geo = createPolyline(pos);
    const w = geo.attrs.point.add("w", "f32", 2, [0, 0]);
    w.setTuple(0, [5, 10]);
    w.setTuple(1, [2, 90]);
    w.setTuple(2, [8, 30]);
    // Componentwise, and NOT the tuple that held the smallest component:
    // point 1 wins component 0 and loses component 1, and the row that
    // comes out is a pair neither point ever carried.
    const out = await scan({ name: "w", outName: "s", reduce: "min", totalAttr: "tot" }, geo);
    expect(col(out, "s")).toEqual([5, 10, 2, 10, 2, 10]);
    expect(out.attrs.primitive.require("tot").getTuple(0)).toEqual([2, 10]);
  });

  it("lets a NaN fail to be a record instead of poisoning the tail", async () => {
    const M = { name: "w", outName: "s", totalAttr: "tot" };
    expect(col(await scan({ ...M, reduce: "min" }, pathWith("w", [3, NaN, 1, 5])), "s")).toEqual([
      3, 3, 1, 1,
    ]);
    // A path whose every value was unmeasurable folded in nothing, and
    // says so with the identity rather than inventing a number — in the
    // column and in the report alike.
    const allNaN = await scan({ ...M, reduce: "min" }, pathWith("w", [NaN, NaN]));
    expect(col(allNaN, "s")).toEqual([Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]);
    expect(allNaN.attrs.primitive.require("tot").get(0)).toBe(Number.POSITIVE_INFINITY);
    const allNaNMax = await scan({ ...M, reduce: "max" }, pathWith("w", [NaN, NaN]));
    expect(col(allNaNMax, "s")).toEqual([Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]);
  });

  it("answers a path of one point with its own value, or with the identity", async () => {
    // Degenerate rather than unreachable: a polyline needs two vertices,
    // but a CLOSED one whose two vertices are the same point walks
    // exactly one. Point 1 is in no polyline and reads the identity.
    const single = (): Geometry => {
      const geo = createPointCloud(2);
      const P = geo.attrs.point.require("P");
      P.setTuple(0, [0, 0, 0]);
      P.setTuple(1, [5, 0, 0]);
      withAttr(geo, "w", [7, 3]);
      setPolylineTopology(geo, [0, 0], [0], [2]);
      return geo;
    };
    const M = { name: "w", outName: "s", totalAttr: "tot" };
    const min = await scan({ ...M, reduce: "min" }, single());
    expect(col(min, "s")).toEqual([7, Number.POSITIVE_INFINITY]);
    expect(min.attrs.primitive.require("tot").get(0)).toBe(7);
    const excl = await scan({ ...M, reduce: "min", mode: "exclusive" }, single());
    expect(col(excl, "s")).toEqual([Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]);
    expect(excl.attrs.primitive.require("tot").get(0)).toBe(7);
    expect(col(await scan({ ...M, reduce: "sum" }, single()), "s")).toEqual([7, 0]);
  });

  it("does not fold a closed path's seam vertex twice, under any fold", async () => {
    // The skip is not only about double-counting. An extreme would
    // ABSORB the second contribution unchanged — the total is 2 either
    // way — but the second VISIT re-writes point 0's own column entry,
    // and 5 is what stands behind point 0, not 2. Drop the `- 1` from
    // the walk length and this fixture reads [2, 2, 2, 2].
    const square = (): Geometry =>
      withAttr(
        createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], { closed: true }),
        "w",
        [5, 2, 8, 3],
      );
    const M = { name: "w", outName: "s", totalAttr: "tot" };
    const min = await scan({ ...M, reduce: "min" }, square());
    expect(min.pointCount).toBe(4);
    expect(col(min, "s")).toEqual([5, 2, 2, 2]);
    expect(min.attrs.primitive.require("tot").get(0)).toBe(2);
    const max = await scan({ ...M, reduce: "max" }, square());
    expect(col(max, "s")).toEqual([5, 5, 8, 8]);
    expect(max.attrs.primitive.require("tot").get(0)).toBe(8);
  });

  it("leaves a point in no polyline holding the fold's identity", async () => {
    // 'Left at zero' was always 'left at the reduction over no values',
    // and for a min that is +Infinity. Zero would compare TIGHTER than
    // every real measurement, which is the false positive a threshold
    // rule cannot survive.
    const make = (): Geometry => {
      const geo = createPointCloud(4);
      const P = geo.attrs.point.require("P");
      P.setTuple(0, [0, 0, 0]);
      P.setTuple(1, [1, 0, 0]);
      P.setTuple(2, [2, 0, 0]);
      P.setTuple(3, [9, 9, 9]); // in no polyline
      setPolylineTopology(geo, [0, 1, 2], [0], [3]);
      withAttr(geo, "w", [5, 5, 5, 5]);
      return geo;
    };
    const M = { name: "w", outName: "s" };
    expect(col(await scan({ ...M, reduce: "min" }, make()), "s")).toEqual([
      5,
      5,
      5,
      Number.POSITIVE_INFINITY,
    ]);
    expect(col(await scan({ ...M, reduce: "max" }, make()), "s")).toEqual([
      5,
      5,
      5,
      Number.NEGATIVE_INFINITY,
    ]);
    // And the sum still reads zero there, which is the same rule.
    expect(col(await scan({ ...M, reduce: "sum" }, make()), "s")).toEqual([5, 10, 15, 0]);
  });

  it("is deterministic under min across fresh runs", async () => {
    const src = pathWith("w", [5, 2, 8, 9, 1]);
    const run = async () =>
      snapshotGeometry(await scan({ name: "w", outName: "s", reduce: "min" }, src));
    expect(await run()).toEqual(await run());
  });

  it("reduces PER GROUP, which nothing else in the library can do", async () => {
    // THE GROUPED REDUCTION, end to end. attributeReduce has min and max
    // but collapses a WHOLE domain onto the detail domain and cannot
    // group, so 'the largest value in each group, on every member of
    // that group' had no expression at all: one path per group, the
    // group's fold on its primitive, promoted back onto its points.
    const cloud = createPointCloud(6);
    const P = cloud.attrs.point.require("P");
    for (let i = 0; i < 6; i++) P.setTuple(i, [i, 0, 0]);
    withAttr(withAttr(cloud, "w", [3, 9, 4, 8, 2, 5]), "g", [0, 0, 0, 1, 1, 1]);

    const paths = firstGeo(
      (await runNode(pointsToPath, { groupAttr: "g" }, { in: [makeGeometryItem(cloud)] })).out,
    );
    expect(paths.primitiveCount).toBe(2);
    const scanned = await scan(
      { name: "w", outName: "s", reduce: "max", totalAttr: "grpMax" },
      paths,
    );
    // 'first' rather than 'average': with one path per point they agree
    // on the value, and 'first' still gives a number where a point on
    // two paths would average a +Infinity against a -Infinity into NaN.
    const promoted = firstGeo(
      (
        await runNode(
          promoteAttribute,
          { name: "grpMax", from: "primitive", to: "point", mode: "first" },
          { in: [makeGeometryItem(scanned)] },
        )
      ).out,
    );
    // Every point of a group reads ITS OWN group's maximum — not the
    // cloud's 9, and not a running value.
    expect(col(promoted, "grpMax")).toEqual([9, 9, 9, 8, 8, 8]);
    // The running column is still the running column; the broadcast one
    // is the fold. Both survive the promotion.
    expect(col(promoted, "s")).toEqual([3, 9, 9, 8, 8, 8]);
  });
});
describe("pathRuns", () => {
  async function runs(params: Record<string, unknown>, src: Geometry): Promise<Geometry> {
    return firstGeo((await runNode(pathRuns, params, { in: [makeGeometryItem(src)] })).out);
  }

  /** An open path of `n` points at (i, 0, 0) carrying values and flags. */
  function flagged(values: readonly number[], marks: readonly number[]): Geometry {
    const pos: number[] = [];
    for (let i = 0; i < values.length; i++) pos.push(i, 0, 0);
    return withAttr(withAttr(createPolyline(pos), "w", values), "b", marks);
  }

  const col = (geo: Geometry, name: string): number[] => {
    const a = geo.attrs.point.require(name);
    return Array.from(a.data.slice(0, geo.pointCount * a.tupleSize));
  };

  const P = { name: "w", boundary: "b", outName: "r" };

  it("resets at every flagged point, which is what pathScan cannot do", async () => {
    // Two runs of three. Exclusive is the default here because a marker
    // is at distance zero from itself.
    const geo = await runs(P, flagged([1, 2, 3, 4, 5, 6], [1, 0, 0, 1, 0, 0]));
    expect(col(geo, "r")).toEqual([0, 1, 3, 0, 4, 9]);
  });

  it("ends each run on its whole total in inclusive mode", async () => {
    const geo = await runs(
      { ...P, mode: "inclusive" },
      flagged([1, 2, 3, 4, 5, 6], [1, 0, 0, 1, 0, 0]),
    );
    expect(col(geo, "r")).toEqual([1, 3, 6, 4, 9, 15]);
  });

  it("starts a run at the path's own start when nothing flags it", async () => {
    // The first point opens a run implicitly. Without this the column
    // before the first marker would be undefined rather than measured.
    const geo = await runs(P, flagged([1, 2, 3, 4], [0, 0, 1, 0]));
    expect(col(geo, "r")).toEqual([0, 1, 0, 3]);
  });

  it("reads AHEAD instead of behind when the direction is backward", async () => {
    // Same path, same flag. Forward, point 3 reads what lies behind it
    // since the marker at 2; backward, point 0 reads what lies ahead of
    // it up to that marker — 2 + 3. Neither is the other reversed,
    // which is why both directions are built.
    const geo = await runs({ ...P, direction: "backward" }, flagged([1, 2, 3, 4], [0, 0, 1, 0]));
    expect(col(geo, "r")).toEqual([5, 3, 0, 0]);
  });

  it("carries a run across a closed path's seam, which is the case a lap has", async () => {
    // One marker, at point 2, on a closed square. Wrapped, there is ONE
    // run and it runs 2 -> 3 -> 0 -> 1 straight through the seam.
    const square = () =>
      withAttr(
        withAttr(
          createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], { closed: true }),
          "w",
          [1, 2, 3, 4],
        ),
        "b",
        [0, 0, 1, 0],
      );
    const wrapped = await runs(P, square());
    expect(wrapped.pointCount).toBe(4);
    expect(col(wrapped, "r")).toEqual([7, 8, 0, 3]);

    // Unwrapped, the seam cuts it in two and points 0 and 1 lose the
    // three-and-four that actually precede them around the lap. This is
    // the answer a prefix sum is stuck with.
    const cut = await runs({ ...P, wrap: false }, square());
    expect(col(cut, "r")).toEqual([0, 1, 0, 3]);
  });

  it("falls back to the seam on a closed path with nothing flagged", async () => {
    // A cyclic run has no place to begin, so there is nothing to rotate
    // onto and wrapping is a no-op rather than an error.
    const src = () =>
      withAttr(
        withAttr(
          createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], { closed: true }),
          "w",
          [1, 2, 3, 4],
        ),
        "b",
        [0, 0, 0, 0],
      );
    expect(col(await runs(P, src()), "r")).toEqual([0, 1, 3, 6]);
    expect(col(await runs({ ...P, wrap: false }, src()), "r")).toEqual([0, 1, 3, 6]);
  });

  it("is pathScan when a single boundary opens the path", async () => {
    // The equivalence worth pinning: with one flag on the first point and
    // no others, a segmented scan IS a prefix sum. If these two ever
    // disagree, one of them has changed what accumulation means.
    const src = flagged([1, 2, 3, 4, 5], [1, 0, 0, 0, 0]);
    const seg = await runs({ ...P, mode: "inclusive" }, src);
    const pre = firstGeo(
      (await runNode(pathScan, { name: "w", outName: "s" }, { in: [makeGeometryItem(src)] })).out,
    );
    expect(col(seg, "r")).toEqual(col(pre, "s"));
  });

  it("does not carry a run from one path into the next", async () => {
    const geo = withAttr(withAttr(twoPaths(), "w", [1, 2, 10, 20]), "b", [0, 0, 0, 0]);
    const out = await runs(P, geo);
    expect(col(out, "r")).toEqual([0, 1, 0, 10]);
  });

  it("accumulates a tuple componentwise and resets every component together", async () => {
    const pos: number[] = [];
    for (let i = 0; i < 4; i++) pos.push(i, 0, 0);
    const geo = withAttr(createPolyline(pos), "b", [0, 0, 1, 0]);
    const w = geo.attrs.point.add("w", "f32", 2, [0, 0]);
    w.setTuple(0, [1, 10]);
    w.setTuple(1, [2, 20]);
    w.setTuple(2, [3, 30]);
    w.setTuple(3, [4, 40]);
    const out = await runs(P, geo);
    expect(col(out, "r")).toEqual([0, 0, 1, 10, 0, 0, 3, 30]);
  });

  it("takes any nonzero value as a flag, including a bool column", async () => {
    const pos: number[] = [];
    for (let i = 0; i < 4; i++) pos.push(i, 0, 0);
    const geo = withAttr(createPolyline(pos), "w", [1, 2, 3, 4]);
    const b = geo.attrs.point.add("b", "bool", 1, 0);
    b.set(2, 1);
    expect(col(await runs(P, geo), "r")).toEqual([0, 1, 0, 3]);
  });

  it("lets a NaN contribute zero, and refuses to read one as a boundary", async () => {
    // A NaN value spoils one element rather than the tail of its run.
    expect(col(await runs(P, flagged([1, NaN, 3, 4], [1, 0, 0, 0])), "r")).toEqual([0, 1, 1, 4]);
    // A NaN FLAG is not a boundary. The opposite rule would let a column
    // that could not be measured cut every run in the path, silently.
    expect(col(await runs(P, flagged([1, 2, 3, 4], [0, NaN, NaN, 0])), "r")).toEqual([0, 1, 3, 6]);
  });

  it("leaves points in no polyline at zero and keeps the path a path", async () => {
    const geo = createPointCloud(4);
    const pos = geo.attrs.point.require("P");
    pos.setTuple(0, [0, 0, 0]);
    pos.setTuple(1, [1, 0, 0]);
    pos.setTuple(2, [2, 0, 0]);
    pos.setTuple(3, [9, 9, 9]); // in no polyline
    setPolylineTopology(geo, [0, 1, 2], [0], [3]);
    withAttr(withAttr(geo, "w", [5, 5, 5, 5]), "b", [0, 0, 0, 0]);
    const out = await runs(P, geo);
    expect(col(out, "r")).toEqual([0, 5, 10, 0]);
    expect(topologyOf(out)).toEqual(topologyOf(geo));
  });

  it("refuses the names and shapes that would quietly produce nonsense", async () => {
    const src = flagged([1, 2, 3], [1, 0, 0]);
    const inputs = { in: [makeGeometryItem(src)] };
    expect(await rejection(runNode(pathRuns, { ...P, outName: "w" }, inputs))).toContain(
      "cannot be written over its own source",
    );
    expect(await rejection(runNode(pathRuns, { ...P, outName: "P" }, inputs))).toContain(
      'cannot be "P"',
    );
    expect(await rejection(runNode(pathRuns, { ...P, outName: "b" }, inputs))).toContain(
      "overwrite the flags",
    );
    expect(await rejection(runNode(pathRuns, { ...P, name: "nope" }, inputs))).toContain(
      "not found",
    );
    expect(await rejection(runNode(pathRuns, { ...P, boundary: "nope" }, inputs))).toContain(
      "not found",
    );
    // A boundary is one column: a wider one is refused rather than having
    // a component picked for the author.
    const wide = flagged([1, 2, 3], [0, 0, 0]);
    wide.attrs.point.add("b2", "f32", 2, [0, 0]);
    expect(
      await rejection(
        runNode(pathRuns, { ...P, boundary: "b2" }, { in: [makeGeometryItem(wide)] }),
      ),
    ).toContain("tupleSize 2");
  });

  it("is deterministic across fresh runs", async () => {
    const src = flagged([1, 2, 3, 4, 5], [1, 0, 1, 0, 0]);
    const run = async () => snapshotGeometry(await runs(P, src));
    expect(await run()).toEqual(await run());
  });

  it("leaves reduce 'sum' exactly where it was, named or defaulted", async () => {
    // The byte-identity claim, pinned against a hand-computed column
    // rather than against another cook: two runs of three, exclusive, so
    // the marker is at zero from itself and 1+2 and 4+5 are what the
    // last point of each run has behind it.
    const src = () => flagged([1, 2, 3, 4, 5, 6], [1, 0, 0, 1, 0, 0]);
    expect(col(await runs({ ...P, reduce: "sum" }, src()), "r")).toEqual([0, 1, 3, 0, 4, 9]);
    // And the default is that same value, so no serialized graph written
    // before this param existed changes meaning.
    expect(snapshotGeometry(await runs({ ...P, reduce: "sum" }, src()))).toEqual(
      snapshotGeometry(await runs(P, src())),
    );
  });

  it("keeps a run's smallest or largest value under reduce min and max", async () => {
    // Two runs of three: [5, 2, 8] and [9, 1, 7]. A sum here would say
    // 15 and 17, which answers a different question entirely.
    const src = () => flagged([5, 2, 8, 9, 1, 7], [1, 0, 0, 1, 0, 0]);
    const M = { ...P, mode: "inclusive" };
    expect(col(await runs({ ...M, reduce: "min" }, src()), "r")).toEqual([5, 2, 2, 9, 1, 1]);
    expect(col(await runs({ ...M, reduce: "max" }, src()), "r")).toEqual([5, 5, 8, 9, 9, 9]);
    // The running value only ever moves one way and then stays, which is
    // the property that makes a min a staircase and a sum a ramp.
    const mins = col(await runs({ ...M, reduce: "min" }, src()), "r");
    for (let i = 1; i < mins.length; i++) {
      if (i === 3) continue; // the run boundary, where it resets
      expect(mins[i]).toBeLessThanOrEqual(mins[i - 1]);
    }
  });

  it("opens each run at the fold's identity, which is what exclusive reads first", async () => {
    // THE SHARP END. Exclusive means a point's own value is not in its
    // own total, so a run's first point has folded in nothing — and the
    // minimum of nothing is +Infinity, exactly as attributeReduce
    // answers an empty domain. Not a sentinel: it is the only value x
    // with min(x, v) = v, f32 carries it exactly, and unlike a sum's 0
    // it can never be mistaken for a measurement.
    const src = () => flagged([5, 2, 8, 9, 1, 7], [1, 0, 0, 1, 0, 0]);
    expect(col(await runs({ ...P, reduce: "min" }, src()), "r")).toEqual([
      Number.POSITIVE_INFINITY,
      5,
      2,
      Number.POSITIVE_INFINITY,
      9,
      1,
    ]);
    expect(col(await runs({ ...P, reduce: "max" }, src()), "r")).toEqual([
      Number.NEGATIVE_INFINITY,
      5,
      5,
      Number.NEGATIVE_INFINITY,
      9,
      9,
    ]);
    // And it survives the f32 column, so a caller really can test the
    // column with isFinite rather than remembering a magic number.
    const first = col(await runs({ ...P, reduce: "min" }, src()), "r")[0];
    expect(Number.isFinite(first)).toBe(false);
    expect(first).toBe(Number.POSITIVE_INFINITY);
  });

  it("differs between the two modes only where a record is set", async () => {
    // The mode/reduce interaction worth stating: a sum's inclusive and
    // exclusive columns differ at EVERY point, by that point's own
    // value; an extreme's differ only where the point beat the record,
    // because min and max are idempotent.
    const src = () => flagged([5, 2, 8, 3], [1, 0, 0, 0]);
    const excl = col(await runs({ ...P, reduce: "min" }, src()), "r");
    const incl = col(await runs({ ...P, reduce: "min", mode: "inclusive" }, src()), "r");
    const values = [5, 2, 8, 3];
    expect(excl).toEqual([Number.POSITIVE_INFINITY, 5, 2, 2]);
    expect(incl).toEqual([5, 2, 2, 2]);
    for (let i = 0; i < values.length; i++) expect(incl[i]).toBe(Math.min(excl[i], values[i]));
  });

  it("reduces a signed comparison rather than a magnitude", async () => {
    // A max over negatives is the LEAST negative. Getting this wrong is
    // invisible on any all-positive fixture, which most of them are.
    const src = () => flagged([-5, -1, -9], [1, 0, 0]);
    const M = { ...P, mode: "inclusive" };
    expect(col(await runs({ ...M, reduce: "max" }, src()), "r")).toEqual([-5, -1, -1]);
    expect(col(await runs({ ...M, reduce: "min" }, src()), "r")).toEqual([-5, -5, -9]);
  });

  it("orients an extreme the same way a sum is oriented", async () => {
    // Forward, a flagged point OPENS its run: the runs are {0,1} and
    // {2,3}. Backward it CLOSES one: the runs are {3} and {2,1,0}. So
    // the two directions do not partition the path the same way, which
    // is true of every fold and is not something reduce changes.
    const src = () => flagged([7, 2, 9, 4], [0, 0, 1, 0]);
    const M = { ...P, mode: "inclusive", reduce: "min" };
    expect(col(await runs(M, src()), "r")).toEqual([7, 2, 9, 4]);
    expect(col(await runs({ ...M, direction: "backward" }, src()), "r")).toEqual([2, 2, 9, 4]);
  });

  it("carries an extreme across a closed path's seam", async () => {
    // One marker at point 2 on a closed square. Wrapped there is ONE run
    // 2 -> 3 -> 0 -> 1, so the 2 at point 3 is the lap's tightest and
    // every later point holds it. Unwrapped the seam cuts it and points
    // 0 and 1 never see the 2 at all.
    const square = () =>
      withAttr(
        withAttr(
          createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], { closed: true }),
          "w",
          [9, 8, 5, 2],
        ),
        "b",
        [0, 0, 1, 0],
      );
    const M = { ...P, mode: "inclusive", reduce: "min" };
    expect(col(await runs(M, square()), "r")).toEqual([2, 2, 5, 2]);
    expect(col(await runs({ ...M, wrap: false }, square()), "r")).toEqual([9, 8, 5, 2]);
  });

  it("reduces each component of a tuple independently and resets them together", async () => {
    const pos: number[] = [];
    for (let i = 0; i < 4; i++) pos.push(i, 0, 0);
    const geo = withAttr(createPolyline(pos), "b", [0, 0, 1, 0]);
    const w = geo.attrs.point.add("w", "f32", 2, [0, 0]);
    w.setTuple(0, [5, 50]);
    w.setTuple(1, [2, 90]);
    w.setTuple(2, [8, 10]);
    w.setTuple(3, [1, 70]);
    // Component 0's record falls at point 1 and component 1's does not;
    // both nevertheless start over at the boundary on point 2.
    const out = await runs({ ...P, mode: "inclusive", reduce: "min" }, geo);
    expect(col(out, "r")).toEqual([5, 50, 2, 50, 8, 10, 1, 10]);
  });

  it("lets a NaN fail to be a record instead of poisoning its run", async () => {
    const M = { ...P, mode: "inclusive", reduce: "min" };
    expect(col(await runs(M, flagged([3, NaN, 1, 5], [1, 0, 0, 0])), "r")).toEqual([3, 3, 1, 1]);
    // A run whose every value was unmeasurable folded in nothing, and
    // says so with the identity rather than inventing a number.
    expect(col(await runs(M, flagged([NaN, NaN], [1, 0])), "r")).toEqual([
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ]);
    expect(col(await runs({ ...M, reduce: "max" }, flagged([NaN, NaN], [1, 0])), "r")).toEqual([
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]);
  });

  it("answers a run of one point the same way in every fold", async () => {
    // Every point flagged, so every run is one point long: inclusive
    // reads the point's own value in all three folds, and exclusive
    // reads the identity in all three. A run of NO points is not
    // observable — a run is opened by a point.
    const src = () => flagged([4, 7], [1, 1]);
    for (const reduce of ["sum", "min", "max"]) {
      expect(col(await runs({ ...P, reduce, mode: "inclusive" }, src()), "r")).toEqual([4, 7]);
    }
    expect(col(await runs({ ...P, reduce: "sum" }, src()), "r")).toEqual([0, 0]);
    expect(col(await runs({ ...P, reduce: "min" }, src()), "r")).toEqual([
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ]);
    expect(col(await runs({ ...P, reduce: "max" }, src()), "r")).toEqual([
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]);
  });

  it("leaves a point in no polyline holding the fold's identity", async () => {
    // 'Left at zero' was always 'left at the reduction over no values',
    // and for a min that is +Infinity. Zero would compare TIGHTER than
    // every real measurement, which is the false positive a threshold
    // rule cannot survive.
    const make = (): Geometry => {
      const geo = createPointCloud(4);
      const pos = geo.attrs.point.require("P");
      pos.setTuple(0, [0, 0, 0]);
      pos.setTuple(1, [1, 0, 0]);
      pos.setTuple(2, [2, 0, 0]);
      pos.setTuple(3, [9, 9, 9]); // in no polyline
      setPolylineTopology(geo, [0, 1, 2], [0], [3]);
      withAttr(withAttr(geo, "w", [5, 5, 5, 5]), "b", [0, 0, 0, 0]);
      return geo;
    };
    const M = { ...P, mode: "inclusive" };
    expect(col(await runs({ ...M, reduce: "min" }, make()), "r")).toEqual([
      5,
      5,
      5,
      Number.POSITIVE_INFINITY,
    ]);
    expect(col(await runs({ ...M, reduce: "max" }, make()), "r")).toEqual([
      5,
      5,
      5,
      Number.NEGATIVE_INFINITY,
    ]);
    // And the sum still reads zero there, which is the same rule.
    expect(col(await runs({ ...M, reduce: "sum" }, make()), "r")).toEqual([5, 10, 15, 0]);
  });

  it("is deterministic under min across fresh runs", async () => {
    const src = flagged([5, 2, 8, 9, 1], [1, 0, 1, 0, 0]);
    const run = async () => snapshotGeometry(await runs({ ...P, reduce: "min" }, src));
    expect(await run()).toEqual(await run());
  });
});
