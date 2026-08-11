import { describe, expect, it } from "vitest";
import {
  Geometry,
  PRIMTYPE_ATTR,
  createPointCloud,
  createPolyline,
  setPolylineTopology,
} from "../data/index.js";
import { Graph, cook, makeGeometryItem } from "../graph/index.js";
import {
  deserializeGraph,
  fieldFromJson,
  filterByAttribute,
  filterByDensity,
  orientAlongVector,
  partitionByAttribute,
  pathResample,
  pointScatterInBounds,
  pointsToPath,
  projectToPlane,
  serializeGraph,
  setAttribute,
  splineSample,
  writeTangents,
} from "./index.js";
import { firstGeo, positionsOf, runNode, snapshotGeometry } from "./nodes.testsupport.js";
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
    const stringy = row(4);
    stringy.attrs.point.add("name", "string", 1, "a");
    await expect(
      runNode(pointsToPath, { groupAttr: "name" }, { in: [makeGeometryItem(stringy)] }),
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
