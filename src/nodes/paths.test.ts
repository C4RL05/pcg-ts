import { describe, expect, it } from "vitest";
import { Geometry, createPointCloud, createPolyline, setPolylineTopology } from "../data/index.js";
import { Graph, cook, makeGeometryItem } from "../graph/index.js";
import {
  deserializeGraph,
  fieldFromJson,
  filterByDensity,
  orientAlongVector,
  pathResample,
  pointScatterInBounds,
  pointsToPath,
  serializeGraph,
  splineSample,
  writeTangents,
} from "./index.js";
import { firstGeo, positionsOf, runNode, snapshotGeometry } from "./testSupport.js";

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
    ).rejects.toThrow(/no polyline primitives \(build one in-graph with pointsToPath/);
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
