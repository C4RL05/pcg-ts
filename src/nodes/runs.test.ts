import { describe, expect, it } from "vitest";
import { createPointCloud, createPolyline, setPolylineTopology, type Geometry } from "../data/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { arcTile, runFit } from "./runs.js";
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

/** One scalar point column as a plain array. */
function col(geo: Geometry, name: string): number[] {
  const a = geo.attrs.point.require(name);
  return Array.from(a.data.slice(0, geo.pointCount * a.tupleSize));
}

/** A cloud with a scalar f32 point attribute set per point. */
function withAttr(geo: Geometry, name: string, values: readonly number[]): Geometry {
  const attr = geo.attrs.point.add(name, "f32", 1, 0);
  for (let i = 0; i < values.length; i++) attr.set(i, values[i]);
  return geo;
}

describe("runFit", () => {
  async function fit(params: Record<string, unknown>, src: Geometry): Promise<Geometry> {
    return firstGeo((await runNode(runFit, params, { in: [makeGeometryItem(src)] })).out);
  }

  /**
   * An OPEN path whose points sit at the given x positions, so the
   * measured arc length of vertex k is exactly `xs[k] - xs[0]`, carrying
   * one value per point under "v".
   */
  function line(xs: readonly number[], values: readonly number[]): Geometry {
    const pos: number[] = [];
    for (const x of xs) pos.push(x, 0, 0);
    return withAttr(createPolyline(pos), "v", values);
  }

  const P = { valueAttr: "v", gap: 3 };
  const ALL = {
    ...P,
    idAttr: "runId",
    indexAttr: "runIndex",
    countAttr: "runCount",
    startAttr: "runStart",
    interceptAttr: "runIntercept",
  };

  it("fits one run exactly when its members lie on a line", async () => {
    // v = 2s + 1 at s = 0, 1, 2, 3. The slope is a whole number and the
    // residual is a true zero, not a small one: the fit is rebased on the
    // run's own start, so nothing here is a difference of large numbers.
    const out = await fit(ALL, line([0, 1, 2, 3], [1, 3, 5, 7]));
    expect(col(out, "runSlope")).toEqual([2, 2, 2, 2]);
    expect(col(out, "runResidual")).toEqual([0, 0, 0, 0]);
    expect(col(out, "runSpan")).toEqual([3, 3, 3, 3]);
    expect(col(out, "runId")).toEqual([0, 0, 0, 0]);
    expect(col(out, "runIndex")).toEqual([0, 1, 2, 3]);
    expect(col(out, "runCount")).toEqual([4, 4, 4, 4]);
    expect(col(out, "runStart")).toEqual([0, 0, 0, 0]);
    // The line's value at the run's own start, which is where the
    // intercept is measured — not extrapolated back to arc zero.
    expect(col(out, "runIntercept")).toEqual([1, 1, 1, 1]);
  });

  it("cuts a new run at every gap of at least `gap`", async () => {
    // Three groups: 0,1,2 then 10,11,12 then 20. The gaps of 8 break; the
    // gaps of 1 do not.
    const out = await fit(ALL, line([0, 1, 2, 10, 11, 12, 20], [0, 1, 2, 5, 5, 5, 9]));
    expect(col(out, "runId")).toEqual([0, 0, 0, 1, 1, 1, 2]);
    expect(col(out, "runSlope")).toEqual([1, 1, 1, 0, 0, 0, 0]);
    expect(col(out, "runSpan")).toEqual([2, 2, 2, 2, 2, 2, 0]);
    expect(col(out, "runStart")).toEqual([0, 0, 0, 10, 10, 10, 20]);
    expect(col(out, "runIndex")).toEqual([0, 1, 2, 0, 1, 2, 0]);
  });

  it("reports a lone member as a run of one, with nothing fitted through it", async () => {
    // A gap smaller than every spacing puts each point in its own run. A
    // single point has no slope, no span and, truthfully, no residual —
    // and the count is what says not to read anything into the zero.
    const out = await fit({ ...ALL, gap: 0.5 }, line([0, 1, 2], [4, 9, 16]));
    expect(col(out, "runId")).toEqual([0, 1, 2]);
    expect(col(out, "runCount")).toEqual([1, 1, 1]);
    expect(col(out, "runSlope")).toEqual([0, 0, 0]);
    expect(col(out, "runResidual")).toEqual([0, 0, 0]);
    expect(col(out, "runSpan")).toEqual([0, 0, 0]);
    // A two-member run fits EXACTLY, which is the trap countAttr exists
    // for: perfectly straight and worth nothing as evidence.
    const two = await fit({ ...ALL, gap: 1.5 }, line([0, 1, 5], [4, 9, 16]));
    expect(col(two, "runCount")).toEqual([2, 2, 1]);
    expect(col(two, "runResidual")).toEqual([0, 0, 0]);
    expect(col(two, "runSlope")).toEqual([5, 5, 0]);
  });

  it("reports the worst member off the line, not an average of them", async () => {
    // v alternates 0, 1 at s = 0..3. The least-squares line is
    // 0.2 + 0.2s, and the furthest member is 0.6 away from it — an RMS
    // would have reported less than half of that.
    const out = await fit(P, line([0, 1, 2, 3], [0, 1, 0, 1]));
    expect(col(out, "runSlope")[0]).toBeCloseTo(0.2, 6);
    expect(col(out, "runResidual")[0]).toBeCloseTo(0.6, 6);
    expect(new Set(col(out, "runResidual")).size).toBe(1);
  });

  it("keeps a run whole across a closed path's seam, and cuts it without wrap", async () => {
    // A closed loop whose chords are 1, 5, 1, 5 and whose closing chord
    // is 2: the seam is the SHORT gap, and the break is elsewhere. With
    // gap 3 the run 4 -> 0 -> 1 straddles the start line.
    const loop = (): Geometry =>
      withAttr(
        createPolyline([0, 0, 0, 1, 0, 0, 1, 0, 5, 2, 0, 5, 2, 0, 0], { closed: true }),
        "v",
        [2, 2.5, 0, 0, 1],
      );
    const wrapped = await fit(ALL, loop());
    expect(wrapped.pointCount).toBe(5);
    // Points 4, 0 and 1 are ONE run, in that walk order, at run-local
    // arcs 0, 2 and 3 — so the line through them has slope 0.5.
    expect(col(wrapped, "runId")).toEqual([1, 1, 0, 0, 1]);
    expect(col(wrapped, "runIndex")).toEqual([1, 2, 0, 1, 0]);
    expect(col(wrapped, "runSpan")).toEqual([3, 3, 1, 1, 3]);
    expect(col(wrapped, "runSlope")).toEqual([0.5, 0.5, 0, 0, 0.5]);
    // Collinear to the last bit the arithmetic has: the means here are
    // not exactly representable, so this is rounding noise rather than a
    // deviation — see the exact case above, where they are.
    for (const r of col(wrapped, "runResidual")) expect(r).toBeCloseTo(0, 6);
    // Reported in the path's own coordinate: the run begins at arc 12,
    // where point 4 sits, not at the unwrapped 12 + a lap.
    expect(col(wrapped, "runStart")).toEqual([12, 12, 6, 6, 12]);

    // Unwrapped, the seam is a break: the same three points come back as
    // a run of one and a run of two, and the run of two now reports the
    // exact fit of any two points.
    const unwrapped = await fit({ ...ALL, wrap: false }, loop());
    expect(col(unwrapped, "runId")).toEqual([0, 0, 1, 1, 2]);
    expect(col(unwrapped, "runSpan")).toEqual([1, 1, 1, 1, 0]);
    expect(col(unwrapped, "runCount")).toEqual([2, 2, 2, 2, 1]);
  });

  it("falls back to the seam on a closed path with no gap anywhere", async () => {
    // Nothing to rotate onto, so wrapping is a no-op rather than an
    // error — the same answer pathRuns gives when nothing is flagged.
    const loop = (): Geometry =>
      withAttr(
        createPolyline([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1], { closed: true }),
        "v",
        [0, 1, 2, 3],
      );
    const wrapped = await fit({ ...ALL, gap: 5 }, loop());
    const unwrapped = await fit({ ...ALL, gap: 5, wrap: false }, loop());
    expect(col(wrapped, "runId")).toEqual([0, 0, 0, 0]);
    expect(col(wrapped, "runSlope")).toEqual(col(unwrapped, "runSlope"));
    expect(col(wrapped, "runStart")).toEqual(col(unwrapped, "runStart"));
  });

  it("fits against the arc attribute rather than the path's own geometry", async () => {
    // The points zig-zag laterally, so the CHORDS between them are longer
    // than the along-road distance the run is really spaced on. With an
    // arc column the gaps are the road's; without one they are the
    // zig-zag's, and the run breaks where the road has no gap at all.
    const pos = [0, 0, 0, 1, 0, 4, 2, 0, 0, 3, 0, 4];
    const geo = withAttr(withAttr(createPolyline(pos), "v", [1, 2, 3, 4]), "s", [0, 1, 2, 3]);
    const onArc = await fit({ ...ALL, arcAttr: "s", gap: 2 }, geo);
    expect(col(onArc, "runId")).toEqual([0, 0, 0, 0]);
    expect(col(onArc, "runSlope")).toEqual([1, 1, 1, 1]);
    const onChords = await fit({ ...ALL, gap: 2 }, geo);
    expect(col(onChords, "runId")).toEqual([0, 1, 2, 3]);
  });

  it("gives the same slope and residual wherever the run sits on the arc", async () => {
    // Translation invariance, which is the property the run-local rebase
    // exists to make EXACT rather than approximate: the same four values
    // at arc 0 and at arc 1000 must agree bit for bit.
    const at = async (base: number): Promise<Geometry> => {
      const geo = withAttr(
        withAttr(createPolyline([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]), "v", [0, 1, 0, 1]),
        "s",
        [base, base + 1, base + 2, base + 3],
      );
      return await fit({ ...ALL, arcAttr: "s" }, geo);
    };
    const near = await at(0);
    const far = await at(1_000_000);
    expect(col(far, "runSlope")).toEqual(col(near, "runSlope"));
    expect(col(far, "runResidual")).toEqual(col(near, "runResidual"));
    expect(col(far, "runSpan")).toEqual(col(near, "runSpan"));
    // The intercept is at the run's own start, so it moves with it in
    // neither direction: the same number at both offsets.
    expect(col(far, "runIntercept")).toEqual(col(near, "runIntercept"));
    expect(col(far, "runStart")).toEqual([1_000_000, 1_000_000, 1_000_000, 1_000_000]);
  });

  it("excludes a NaN value from the fit without letting it cut the run", async () => {
    // The NaN member keeps its place along the arc — the run is still one
    // run — and the count says the line was fitted through three points.
    const out = await fit(ALL, line([0, 1, 2, 3], [1, NaN, 5, 7]));
    expect(col(out, "runId")).toEqual([0, 0, 0, 0]);
    expect(col(out, "runCount")).toEqual([3, 3, 3, 3]);
    expect(col(out, "runSlope")).toEqual([2, 2, 2, 2]);
    for (const r of col(out, "runResidual")) expect(r).toBeCloseTo(0, 6);
  });

  it("leaves points in no polyline alone and keeps the path a path", async () => {
    const geo = createPointCloud(4);
    const pos = geo.attrs.point.require("P");
    pos.setTuple(0, [0, 0, 0]);
    pos.setTuple(1, [1, 0, 0]);
    pos.setTuple(2, [2, 0, 0]);
    pos.setTuple(3, [9, 9, 9]); // in no polyline
    setPolylineTopology(geo, [0, 1, 2], [0], [3]);
    withAttr(geo, "v", [1, 3, 5, 99]);
    const out = await fit(ALL, geo);
    expect(col(out, "runId")).toEqual([0, 0, 0, -1]);
    expect(col(out, "runIndex")).toEqual([0, 1, 2, -1]);
    expect(col(out, "runSlope")).toEqual([2, 2, 2, 0]);
    expect(Array.from(out.vertexToPoint)).toEqual([0, 1, 2]);
    expect(Array.from(out.primVertexCount)).toEqual([3]);
    expect(out.attrs.primitive.count).toBe(1);
  });

  it("refuses an input with nothing to walk", async () => {
    // Nothing connected at all.
    expect(await rejection(runNode(runFit, P, {}))).toContain(
      'input pin "in" has no geometry connected',
    );
    // A cloud that never had a path built over it. The message is the
    // shared one, so it also names the nodes that eat topology.
    const cloud = withAttr(createPointCloud(3), "v", [1, 2, 3]);
    expect(
      await rejection(runNode(runFit, P, { in: [makeGeometryItem(cloud)] })),
    ).toContain("no polyline primitives");
  });

  it("refuses an arc coordinate it cannot cut runs on", async () => {
    const bad = (values: readonly number[]): Geometry =>
      withAttr(
        withAttr(createPolyline([0, 0, 0, 1, 0, 0, 2, 0, 0]), "v", [1, 2, 3]),
        "s",
        values,
      );
    expect(
      await rejection(
        runNode(runFit, { ...P, arcAttr: "s" }, { in: [makeGeometryItem(bad([0, NaN, 2])) ] }),
      ),
    ).toContain("cannot be put in a run");
    expect(
      await rejection(
        runNode(runFit, { ...P, arcAttr: "s" }, { in: [makeGeometryItem(bad([0, 5, 2]))] }),
      ),
    ).toContain("decreases along the path");
  });

  it("refuses a period smaller than the coordinate it wraps", async () => {
    // The curveU trap, caught from the one side it can be caught from: a
    // 0..1 coordinate with a period of 0.5 puts the seam gap below zero.
    const loop = withAttr(
      withAttr(
        createPolyline([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1], { closed: true }),
        "v",
        [0, 1, 2, 3],
      ),
      "s",
      [0, 0.25, 0.5, 0.75],
    );
    const msg = await rejection(
      runNode(
        runFit,
        { ...P, arcAttr: "s", period: 0.5, gap: 0.1 },
        { in: [makeGeometryItem(loop)] },
      ),
    );
    expect(msg).toContain('"period"');
    expect(msg).toContain("wraps at 1");
  });

  /**
   * THE OTHER SIDE OF THE SAME TRAP, AND THE ONE ARITHMETIC CANNOT SEE.
   *
   * A period SMALLER than the coordinate's extent drives the seam gap
   * negative and the test above catches it. A period LARGER than it just
   * inflates the gap, so a break appears at the seam, the run that
   * straddled it splits, and BOTH HALVES ARE WELL-FORMED — same slope,
   * residual zero, nothing in any column complaining. That is what the
   * default 0 does to a named `arcAttr`, since 0 means "the path's own
   * measured length" and a custom coordinate is not obliged to be in
   * world units.
   *
   * Found by writing `graphs/basics-fit-runs.json`, whose seam row is
   * exactly this arrangement, so it is refused rather than documented.
   */
  it("refuses a named arc coordinate that never says what it wraps at", async () => {
    const loop = withAttr(
      withAttr(
        createPolyline([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1], { closed: true }),
        "v",
        [0, 1, 2, 3],
      ),
      "s",
      [0, 0.25, 0.5, 0.75],
    );
    const msg = await rejection(
      runNode(runFit, { ...P, arcAttr: "s", gap: 0.1 }, { in: [makeGeometryItem(loop)] }),
    );
    expect(msg).toContain('"period"');
    expect(msg).toContain('"s"');
    // Names all three ways out rather than only the one it prefers.
    expect(msg).toContain("wrap");
    expect(msg).toContain("arcAttr");

    // And the same path is fine the moment the period is stated...
    await expect(
      runNode(
        runFit,
        { ...P, arcAttr: "s", period: 1, gap: 0.1 },
        { in: [makeGeometryItem(loop)] },
      ),
    ).resolves.toBeDefined();
    // ...or the seam is declared a break, which needs no period at all.
    await expect(
      runNode(
        runFit,
        { ...P, arcAttr: "s", wrap: false, gap: 0.1 },
        { in: [makeGeometryItem(loop)] },
      ),
    ).resolves.toBeDefined();
    // ...or the measured arc is used, where 0 is the right answer.
    await expect(
      runNode(runFit, { ...P, gap: 0.1 }, { in: [makeGeometryItem(loop)] }),
    ).resolves.toBeDefined();
  });

  it("refuses the names and params that would quietly produce nonsense", async () => {
    const src = line([0, 1, 2], [1, 2, 3]);
    const inputs = { in: [makeGeometryItem(src)] };
    expect(await rejection(runNode(runFit, { ...P, valueAttr: "" }, inputs))).toContain(
      'param "valueAttr" must be a non-empty',
    );
    expect(await rejection(runNode(runFit, { ...P, valueAttr: "nope" }, inputs))).toContain(
      "does not exist on the input",
    );
    expect(await rejection(runNode(runFit, { ...P, slopeAttr: "" }, inputs))).toContain(
      "a runFit that writes no fit",
    );
    expect(await rejection(runNode(runFit, { ...P, slopeAttr: "P" }, inputs))).toContain(
      'cannot be "P"',
    );
    expect(await rejection(runNode(runFit, { ...P, slopeAttr: "v" }, inputs))).toContain(
      "written over the column it was fitted through",
    );
    const withArc = withAttr(line([0, 1, 2], [1, 2, 3]), "s", [0, 1, 2]);
    expect(
      await rejection(
        runNode(
          runFit,
          { ...P, arcAttr: "s", spanAttr: "s" },
          { in: [makeGeometryItem(withArc)] },
        ),
      ),
    ).toContain("written over the arc coordinate");
    expect(
      await rejection(runNode(runFit, { ...P, slopeAttr: "same", spanAttr: "same" }, inputs)),
    ).toContain("two different values and need two attributes");
    expect(await rejection(runNode(runFit, { ...P, gap: 0 }, inputs))).toContain(
      'param "gap" must be > 0',
    );
    expect(await rejection(runNode(runFit, { ...P, period: -1 }, inputs))).toContain(
      'param "period" must be >= 0',
    );
    // A wider column is refused rather than having a component picked.
    const wide = line([0, 1, 2], [1, 2, 3]);
    wide.attrs.point.add("v2", "f32", 2, [0, 0]);
    expect(
      await rejection(
        runNode(runFit, { ...P, valueAttr: "v2" }, { in: [makeGeometryItem(wide)] }),
      ),
    ).toContain("tupleSize 2");
    // And a differently shaped column under an output name is refused
    // rather than deleted and re-added.
    const clash = line([0, 1, 2], [1, 2, 3]);
    clash.attrs.point.add("runSlope", "f32", 3, [0, 0, 0]);
    expect(
      await rejection(runNode(runFit, P, { in: [makeGeometryItem(clash)] })),
    ).toContain("would DELETE");
  });

  it("is deterministic across fresh runs", async () => {
    const src = line([0, 1, 2, 10, 11], [1, 2, 4, 8, 16]);
    const once = async (): Promise<Record<string, unknown>> => snapshotGeometry(await fit(ALL, src));
    expect(await once()).toEqual(await once());
  });
});

describe("arcTile", () => {
  async function tile(
    params: Record<string, unknown>,
    path: Geometry,
    ranges: Geometry,
  ): Promise<Geometry> {
    return firstGeo(
      (
        await runNode(arcTile, params, {
          path: [makeGeometryItem(path)],
          ranges: [makeGeometryItem(ranges)],
        })
      ).out,
    );
  }

  /** An open path along +x, one point per unit, of the given length. */
  function straight(length: number): Geometry {
    const pos: number[] = [];
    for (let i = 0; i <= length; i++) pos.push(i, 0, 0);
    return createPolyline(pos);
  }

  /** A closed square of side 3 (arc length 12), starting at the origin. */
  function square(): Geometry {
    return createPolyline([0, 0, 0, 3, 0, 0, 3, 3, 0, 0, 3, 0], { closed: true });
  }

  /** A ranges cloud: one point per [start, length] pair. */
  function ranges(spec: readonly (readonly [number, number])[]): Geometry {
    const geo = createPointCloud(spec.length);
    const start = geo.attrs.point.add("runStart", "f32", 1, 0);
    const len = geo.attrs.point.add("runSpan", "f32", 1, 0);
    for (let i = 0; i < spec.length; i++) {
      start.set(i, spec[i][0]);
      len.set(i, spec[i][1]);
    }
    return geo;
  }

  const xs = (geo: Geometry): number[] => positionsOf(geo).map((p) => p[0]);

  it("places exactly ceil(length / spacing) tiles at the centres of equal steps", async () => {
    // 10 units at a spacing of 3 is four tiles, not three: the pitch is
    // rounded UP to 2.5 so the pieces abut, where rounding to nearest
    // would have left a gap the size of the remainder.
    const out = await tile({ spacing: 3 }, straight(12), ranges([[0, 10]]));
    expect(out.pointCount).toBe(4);
    expect(xs(out)).toEqual([1.25, 3.75, 6.25, 8.75]);
    // A range shorter than its own spacing still gets its piece, once.
    const one = await tile({ spacing: 5 }, straight(12), ranges([[2, 2]]));
    expect(xs(one)).toEqual([3]);
    // And the tiles carry the frame the path had there.
    expect(Array.from(one.attrs.point.require("tangent").data.slice(0, 3))).toEqual([1, 0, 0]);
    expect(one.attrs.point.require("curveU").get(0)).toBeCloseTo(3 / 12, 6);
  });

  it("tiles one range atomically from one upstream choice", async () => {
    // The piece is chosen ONCE, on the range, and copied onto every tile
    // of it — which is what a per-tile draw cannot promise. Two ranges,
    // two pieces, and no tile of either holds the other's.
    const rs = ranges([
      [0, 4],
      [6, 4],
    ]);
    const piece = rs.attrs.point.add("piece", "i32", 1, 0);
    piece.set(0, 7);
    piece.set(1, 9);
    const out = await tile(
      { spacing: 1, rangeNames: ["piece"], rangeIndexAttr: "rangeIndex", tileIndexAttr: "tileIndex" },
      straight(12),
      rs,
    );
    expect(out.pointCount).toBe(8);
    expect(col(out, "piece")).toEqual([7, 7, 7, 7, 9, 9, 9, 9]);
    expect(col(out, "rangeIndex")).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(col(out, "tileIndex")).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    // The tiles of one range keep their own seeds when a DIFFERENT range
    // changes: only the range's index, its seed and the tile's index go
    // into them.
    const moved = ranges([
      [0, 4],
      [6, 6],
    ]);
    const movedPiece = moved.attrs.point.add("piece", "i32", 1, 0);
    movedPiece.set(0, 7);
    movedPiece.set(1, 9);
    const after = await tile({ spacing: 1, rangeNames: ["piece"] }, straight(12), moved);
    expect(col(after, "seed").slice(0, 4)).toEqual(col(out, "seed").slice(0, 4));
  });

  it("wraps a range across a closed path's seam", async () => {
    // The range starts at arc 11 on a loop of 12 and runs 2 units, so its
    // second tile is past the start line — one range, not two.
    const out = await tile({ spacing: 1 }, square(), ranges([[11, 2]]));
    expect(out.pointCount).toBe(2);
    const p = positionsOf(out);
    // Arc 11.5 is on the closing edge, half a unit above the origin.
    expect(p[0][0]).toBeCloseTo(0, 5);
    expect(p[0][1]).toBeCloseTo(0.5, 5);
    // Arc 12.5 wraps to 0.5, half a unit along the first edge.
    expect(p[1][0]).toBeCloseTo(0.5, 5);
    expect(p[1][1]).toBeCloseTo(0, 5);
    // A start outside [0, length) is normalized rather than refused.
    const wrappedStart = await tile({ spacing: 1 }, square(), ranges([[-1, 2]]));
    expect(positionsOf(wrappedStart)[0][1]).toBeCloseTo(0.5, 5);
  });

  it("opens the mouths and reports the ramp that opened them", async () => {
    const out = await tile(
      { spacing: 1, flare: 1, taper: 3, flareAttr: "flare" },
      straight(12),
      ranges([[0, 4]]),
    );
    expect(out.pointCount).toBe(4);
    // Tiles at 0.5, 1.5, 2.5, 3.5: the two outer ones sit half a unit
    // from their nearer mouth, the two inner ones beyond the flare.
    expect(col(out, "flare")).toEqual([0.5, 0, 0, 0.5]);
    // The default axis is +z, so the taper opens x and y and leaves the
    // length along the path alone.
    const scale = Array.from(out.attrs.point.require("scale").data.slice(0, 12));
    expect(scale).toEqual([2, 2, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1]);
  });

  it("carries the path's primitive attributes onto the tiles", async () => {
    const path = straight(12);
    path.attrs.primitive.add("roadWidth", "f32", 1, 0).set(0, 8);
    const out = await tile({ spacing: 2 }, path, ranges([[0, 4]]));
    expect(col(out, "roadWidth")).toEqual([8, 8]);
  });

  it("emits nothing for no ranges rather than refusing", async () => {
    const out = await tile({ spacing: 1 }, straight(12), ranges([]));
    expect(out.pointCount).toBe(0);
    expect(out.primitiveCount).toBe(0);
  });

  it("refuses every range it cannot tile, and says which one", async () => {
    const path = straight(12);
    const run = async (
      params: Record<string, unknown>,
      rs: Geometry,
      p: Geometry = path,
    ): Promise<string> =>
      await rejection(
        runNode(arcTile, params, {
          path: [makeGeometryItem(p)],
          ranges: [makeGeometryItem(rs)],
        }),
      );

    expect(await run({ spacing: 1 }, ranges([[0, 0]]))).toContain("must have length > 0");
    expect(await run({ spacing: 1 }, ranges([[0, NaN]]))).toContain("must have length > 0");
    expect(await run({ spacing: 1 }, ranges([[NaN, 2]]))).toContain("nowhere to be tiled");
    // An open path does not wrap, and a range past its end is refused
    // rather than clamped to a shorter run reported as a success.
    const over = await run({ spacing: 1 }, ranges([[10, 4]]));
    expect(over).toContain("refused rather than clamped");
    expect(await run({ spacing: 1 }, ranges([[-1, 2]]))).toContain("does not wrap");
    // A closed path refuses a range that would lap it.
    expect(await run({ spacing: 1 }, ranges([[0, 13]]), square())).toContain("lap the loop");
    // The budget is on the total.
    expect(await run({ spacing: 1e-6 }, ranges([[0, 10]]))).toContain("more than 1048576 tiles");
    // Params.
    expect(await run({ spacing: 0 }, ranges([[0, 2]]))).toContain('param "spacing" must be > 0');
    expect(await run({ spacing: 1, flare: -1 }, ranges([[0, 2]]))).toContain(
      'param "flare" must be >= 0',
    );
    expect(await run({ spacing: 1, taper: -1 }, ranges([[0, 2]]))).toContain(
      'param "taper" must be >= 0',
    );
    expect(await run({ spacing: 1, axis: "up" }, ranges([[0, 2]]))).toContain(
      'param "axis" must be one of',
    );
    expect(await run({ spacing: 1, startAttr: "" }, ranges([[0, 2]]))).toContain(
      'param "startAttr" must be a non-empty',
    );
    expect(await run({ spacing: 1, lengthAttr: "" }, ranges([[0, 2]]))).toContain(
      'param "lengthAttr" must be a non-empty',
    );
    expect(
      await run({ spacing: 1, startAttr: "runSpan", lengthAttr: "runSpan" }, ranges([[0, 2]])),
    ).toContain("one column cannot hold both");
    expect(await run({ spacing: 1, startAttr: "nope" }, ranges([[0, 2]]))).toContain(
      "does not exist on the ranges input",
    );
  });

  it("refuses a range list that does not say which path it tiles", async () => {
    const two = createPointCloud(4);
    const pos = two.attrs.point.require("P");
    pos.setTuple(0, [0, 0, 0]);
    pos.setTuple(1, [4, 0, 0]);
    pos.setTuple(2, [0, 0, 5]);
    pos.setTuple(3, [4, 0, 5]);
    setPolylineTopology(two, [0, 1, 2, 3], [0, 2], [2, 2]);
    const rs = ranges([[0, 2]]);
    const missing = await rejection(
      runNode(
        arcTile,
        { spacing: 1 },
        { path: [makeGeometryItem(two)], ranges: [makeGeometryItem(rs)] },
      ),
    );
    expect(missing).toContain("has to say which one it tiles");

    // Naming one works, and naming a primitive that is not a polyline
    // does not.
    const withPath = ranges([[0, 2]]);
    withPath.attrs.point.add("whichPath", "i32", 1, 0).set(0, 1);
    const out = firstGeo(
      (
        await runNode(
          arcTile,
          { spacing: 1, pathAttr: "whichPath" },
          { path: [makeGeometryItem(two)], ranges: [makeGeometryItem(withPath)] },
        )
      ).out,
    );
    expect(positionsOf(out)[0][2]).toBeCloseTo(5, 5);

    const badPath = ranges([[0, 2]]);
    badPath.attrs.point.add("whichPath", "i32", 1, 0).set(0, 7);
    expect(
      await rejection(
        runNode(
          arcTile,
          { spacing: 1, pathAttr: "whichPath" },
          { path: [makeGeometryItem(two)], ranges: [makeGeometryItem(badPath)] },
        ),
      ),
    ).toContain("is not a polyline of the path input");
  });

  it("refuses a carry that would delete what it just wrote", async () => {
    const path = straight(12);
    const run = async (names: string[]): Promise<string> =>
      await rejection(
        runNode(
          arcTile,
          { spacing: 1, rangeNames: names },
          { path: [makeGeometryItem(path)], ranges: [makeGeometryItem(ranges([[0, 2]]))] },
        ),
      );
    expect(await run(["P"])).toContain("already a column this node writes");
    expect(await run(["nope"])).toContain("does not have");
    expect(await run(["runStart", "runStart"])).toContain("twice");
    expect(await run([""])).toContain("empty name");
    // Two opt-in reports may not share a name either.
    expect(
      await rejection(
        runNode(
          arcTile,
          { spacing: 1, flareAttr: "same", tileIndexAttr: "same" },
          { path: [makeGeometryItem(path)], ranges: [makeGeometryItem(ranges([[0, 2]]))] },
        ),
      ),
    ).toContain("two different values and need two attributes");
    // And a report may not land on a column the node writes anyway.
    expect(
      await rejection(
        runNode(
          arcTile,
          { spacing: 1, flareAttr: "P" },
          { path: [makeGeometryItem(path)], ranges: [makeGeometryItem(ranges([[0, 2]]))] },
        ),
      ),
    ).toContain("would DELETE");
  });

  it("refuses an input with no path, and one with no ranges pin", async () => {
    expect(
      await rejection(
        runNode(arcTile, { spacing: 1 }, { path: [makeGeometryItem(straight(4))] }),
      ),
    ).toContain('input pin "ranges" has no geometry connected');
    expect(
      await rejection(
        runNode(arcTile, { spacing: 1 }, { ranges: [makeGeometryItem(ranges([[0, 2]]))] }),
      ),
    ).toContain('input pin "path" has no geometry connected');
    expect(
      await rejection(
        runNode(arcTile, { spacing: 1 }, {
          path: [makeGeometryItem(createPointCloud(3))],
          ranges: [makeGeometryItem(ranges([[0, 2]]))],
        }),
      ),
    ).toContain("no polyline primitives");
  });

  it("is deterministic across fresh runs", async () => {
    const path = straight(12);
    const rs = ranges([
      [0, 4],
      [6, 5],
    ]);
    const once = async (): Promise<Record<string, unknown>> =>
      snapshotGeometry(
        await tile({ spacing: 1.5, flare: 1, taper: 2, flareAttr: "flare" }, path, rs),
      );
    expect(await once()).toEqual(await once());
  });
});
