import { describe, expect, it } from "vitest";
import {
  PRIMTYPE_ATTR,
  createPointCloud,
  createPolyline,
  createTriangleMesh,
  setPolylineTopology,
  type Geometry,
} from "../data/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { hashCombine } from "../random/index.js";
import { fieldFromJson, splineSample, surfaceSample, volumeSample } from "./index.js";
import { firstGeo, positionsOf, runNode, snapshotGeometry } from "./nodes.testsupport.js";

/** Unit square in the XY plane at z = 0, two CCW triangles. */
function unitSquare() {
  return createTriangleMesh(
    [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    [0, 1, 2, 0, 2, 3],
  );
}

/**
 * Two unit right triangles in ONE mesh, one in the z = 0 plane and one in
 * z = 1, so a sample's own z says which primitive it came from without
 * any index column having to say it.
 */
function twoPlanes() {
  return createTriangleMesh(
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1],
    [0, 1, 2, 3, 4, 5],
  );
}

/**
 * Two straight roads in ONE geometry, each 10 long: (0,0,0)->(10,0,0) and
 * (0,10,0)->(10,10,0). The shape a road network has, and the only shape a
 * PER-EDGE value means anything on.
 */
function twoRoads(): Geometry {
  const geo = createPointCloud(4);
  const P = geo.attrs.point.require("P");
  P.setTuple(0, [0, 0, 0]);
  P.setTuple(1, [10, 0, 0]);
  P.setTuple(2, [0, 10, 0]);
  P.setTuple(3, [10, 10, 0]);
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

describe("surfaceSample", () => {
  it("places exactly count points on the mesh with density 1", async () => {
    const mesh = unitSquare();
    const geo = firstGeo(
      (await runNode(surfaceSample, { count: 500 }, { in: [makeGeometryItem(mesh)] })).out,
    );
    expect(geo.pointCount).toBe(500);
    for (const [x, y, z] of positionsOf(geo)) {
      // On the square: inside XY bounds and exactly in the z=0 plane
      // (barycentric residual).
      expect(Math.abs(z)).toBeLessThan(1e-6);
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(x).toBeLessThanOrEqual(1 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(-1e-6);
      expect(y).toBeLessThanOrEqual(1 + 1e-6);
    }
    const normal = geo.attrs.point.require("normal");
    for (let i = 0; i < geo.pointCount; i++) {
      expect(normal.getTuple(i)).toEqual([0, 0, 1]);
    }
    const seeds = geo.attrs.point.require("seed");
    expect(new Set(Array.from(seeds.data.subarray(0, geo.pointCount))).size).toBe(geo.pointCount);
  });

  it("weights triangle choice by area", async () => {
    // A tiny and a huge triangle: expect samples overwhelmingly on the
    // huge one (area ratio 10000:1 in x extent).
    const mesh = createTriangleMesh(
      [0, 0, 0, 0.01, 0, 0, 0, 0.01, 0, 10, 0, 5, 110, 0, 5, 10, 100, 5],
      [0, 1, 2, 3, 4, 5],
    );
    const geo = firstGeo(
      (await runNode(surfaceSample, { count: 1000 }, { in: [makeGeometryItem(mesh)] })).out,
    );
    let onBig = 0;
    for (const [, , z] of positionsOf(geo)) if (Math.abs(z - 5) < 1e-5) onBig++;
    expect(onBig).toBeGreaterThan(990);
  });

  it("applies the density field on candidates and hits proportions", async () => {
    const mesh = unitSquare();
    // density = 1 where x < 0.5, else 0.
    const density = fieldFromJson({
      fn: "lt",
      args: [{ fn: "component", args: [{ fn: "position" }], index: 0 }, 0.5],
    });
    const geo = firstGeo(
      (
        await runNode(
          surfaceSample,
          { count: 1000, densityField: density },
          { in: [makeGeometryItem(mesh)] },
        )
      ).out,
    );
    expect(geo.pointCount).toBeGreaterThan(300);
    expect(geo.pointCount).toBeLessThan(700);
    for (const [x] of positionsOf(geo)) expect(x).toBeLessThan(0.5);
    // Scalar density 0 keeps nothing; 0.5 keeps roughly half.
    const none = firstGeo(
      (await runNode(surfaceSample, { count: 200, densityField: 0 }, { in: [makeGeometryItem(mesh)] }))
        .out,
    );
    expect(none.pointCount).toBe(0);
    const half = firstGeo(
      (
        await runNode(
          surfaceSample,
          { count: 1000, densityField: 0.5 },
          { in: [makeGeometryItem(mesh)] },
        )
      ).out,
    );
    expect(half.pointCount).toBeGreaterThan(400);
    expect(half.pointCount).toBeLessThan(600);
  });

  it("is deterministic per seed and differs across the seed param", async () => {
    const mesh = unitSquare();
    const run = (seedParam: number) =>
      runNode(surfaceSample, { count: 64, seed: seedParam }, { in: [makeGeometryItem(mesh)] }, 3);
    expect(snapshotGeometry(firstGeo((await run(0)).out))).toEqual(
      snapshotGeometry(firstGeo((await run(0)).out)),
    );
    expect(snapshotGeometry(firstGeo((await run(0)).out))).not.toEqual(
      snapshotGeometry(firstGeo((await run(1)).out)),
    );
  });

  it("errors actionably without triangles", async () => {
    const cloud = createPointCloud(4);
    await expect(
      runNode(surfaceSample, {}, { in: [makeGeometryItem(cloud)] }),
    ).rejects.toThrow(/no triangles/);
    await expect(runNode(surfaceSample, {}, {})).rejects.toThrow(/input pin "in"/);
  });

  it("carries the sampled triangle's primitive attributes onto its points", async () => {
    const mesh = withPrimString(withPrimValue(twoPlanes(), "material", [10, 20]), "surfaceKind", [
      "stone",
      "grass",
    ]);
    const geo = firstGeo(
      (await runNode(surfaceSample, { count: 300 }, { in: [makeGeometryItem(mesh)] })).out,
    );
    expect(geo.pointCount).toBe(300);
    const material = geo.attrs.point.require("material");
    const kind = geo.attrs.point.require("surfaceKind");
    const seen = new Set<number>();
    for (let i = 0; i < geo.pointCount; i++) {
      const z = geo.attrs.point.require("P").get(i, 2);
      const onFirst = Math.abs(z) < 1e-6;
      expect(material.get(i)).toBe(onFirst ? 10 : 20);
      expect(kind.getString(i)).toBe(onFirst ? "stone" : "grass");
      seen.add(material.get(i));
    }
    // Both triangles were actually hit, so the equality above is not
    // passing because everything landed on one of them.
    expect(seen).toEqual(new Set([10, 20]));
    // The type tag is not a value and does not ride along.
    expect(geo.attrs.point.has(PRIMTYPE_ATTR)).toBe(false);
  });

  it("refuses a primitive attribute that would clobber one it writes itself", async () => {
    const mesh = withPrimValue(twoPlanes(), "density", [1, 1]);
    const msg = await rejection(runNode(surfaceSample, {}, { in: [makeGeometryItem(mesh)] }));
    expect(msg).toContain("surfaceSample");
    expect(msg).toContain('"density"');
    expect(msg).toContain("removeAttribute");
    // NOT the bare AttributeSet message, which names neither node nor fix.
    expect(msg).not.toBe('attribute "density" already exists');
  });
});

describe("splineSample", () => {
  it("count mode spans the arc length uniformly with tangent and curveU", async () => {
    // L-shaped polyline: 10 along X then 10 along Y; length 20.
    const line = createPolyline([0, 0, 0, 10, 0, 0, 10, 10, 0]);
    const geo = firstGeo(
      (await runNode(splineSample, { mode: "count", count: 5 }, { in: [makeGeometryItem(line)] })).out,
    );
    expect(positionsOf(geo)).toEqual([
      [0, 0, 0],
      [5, 0, 0],
      [10, 0, 0],
      [10, 5, 0],
      [10, 10, 0],
    ]);
    const curveU = geo.attrs.point.require("curveU");
    expect([0, 1, 2, 3, 4].map((i) => curveU.get(i))).toEqual([0, 0.25, 0.5, 0.75, 1]);
    const tangent = geo.attrs.point.require("tangent");
    expect(tangent.getTuple(0)).toEqual([1, 0, 0]);
    expect(tangent.getTuple(4)).toEqual([0, 1, 0]);
  });

  it("spacing mode steps by arc length and drops the duplicate end on closed curves", async () => {
    // Closed unit square: perimeter 4.
    const square = createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], { closed: true });
    const geo = firstGeo(
      (
        await runNode(splineSample, { mode: "spacing", spacing: 1 }, { in: [makeGeometryItem(square)] })
      ).out,
    );
    expect(positionsOf(geo)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ]);
    // Open curve keeps the endpoint.
    const open = createPolyline([0, 0, 0, 2, 0, 0]);
    const openGeo = firstGeo(
      (await runNode(splineSample, { mode: "spacing", spacing: 1 }, { in: [makeGeometryItem(open)] }))
        .out,
    );
    expect(positionsOf(openGeo)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
  });

  it("closed curves in count mode avoid duplicating the start", async () => {
    const square = createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], { closed: true });
    const geo = firstGeo(
      (await runNode(splineSample, { mode: "count", count: 4 }, { in: [makeGeometryItem(square)] })).out,
    );
    expect(positionsOf(geo)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ]);
  });

  it("errors actionably without polyline primitives", async () => {
    await expect(
      runNode(splineSample, {}, { in: [makeGeometryItem(unitSquare())] }),
    ).rejects.toThrow(/no polyline primitives/);
  });

  it("carries each sample's own polyline's primitive attributes", async () => {
    const roads = withPrimString(withPrimValue(twoRoads(), "roadWidth", [2, 7]), "roadKind", [
      "avenue",
      "lane",
    ]);
    // Total length 20, so spacing 4 lands 3 samples on each road and none
    // on the join (where the tie goes to the LATER polyline).
    const geo = firstGeo(
      (await runNode(splineSample, { mode: "spacing", spacing: 4 }, { in: [makeGeometryItem(roads)] }))
        .out,
    );
    expect(positionsOf(geo)).toEqual([
      [0, 0, 0],
      [4, 0, 0],
      [8, 0, 0],
      [2, 10, 0],
      [6, 10, 0],
      [10, 10, 0],
    ]);
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
    expect(geo.attrs.point.has(PRIMTYPE_ATTR)).toBe(false);
  });

  it("refuses a primitive attribute that would clobber one it writes itself", async () => {
    const roads = withPrimValue(twoRoads(), "curveU", [0, 0]);
    const msg = await rejection(runNode(splineSample, {}, { in: [makeGeometryItem(roads)] }));
    expect(msg).toContain("splineSample");
    expect(msg).toContain('"curveU"');
    expect(msg).toContain("removeAttribute");
    expect(msg).not.toBe('attribute "curveU" already exists');
  });
});

/**
 * `splineSample`'s arc-length table moved out into the shared
 * `polylineArcTables` helper so the path nodes could measure a curve the
 * same way. The goldens above are the first proof that the move changed
 * nothing; this is the second, and the sharper one — they only pin a
 * handful of round numbers, while a floating-point regression in the
 * concatenation would hide in the digits they never look at.
 *
 * `legacySplineSample` is the execute body EXACTLY as it stood before the
 * extraction, frozen. It must never be "kept up to date": the moment it
 * tracks the node it stops being evidence. If it ever disagrees with the
 * node, the extraction is wrong — not this oracle.
 */
function legacySplineSample(
  geo: Geometry,
  params: { mode: string; count: number; spacing: number },
  seed: number,
): Geometry {
  const P = geo.attrs.point.get("P");
  if (!P || P.type !== "f32" || P.tupleSize < 3) {
    throw new Error('splineSample: input needs a point attribute "P" (f32, tupleSize >= 3)');
  }
  const pd = P.data;
  const ps = P.tupleSize;
  const v2p = geo.vertexToPoint;
  const starts = geo.primVertexStart;
  const counts = geo.primVertexCount;
  const primType = geo.attrs.primitive.get(PRIMTYPE_ATTR);

  const segAx: number[] = [];
  const segDir: number[] = [];
  const cum: number[] = [0];
  let closedCount = 0;
  let polylineCount = 0;
  for (let p = 0; p < geo.primitiveCount; p++) {
    const nv = counts[p];
    if (nv < 2) continue;
    if (primType && primType.getString(p) !== "polyline") continue;
    polylineCount++;
    const v0 = starts[p];
    if (v2p[v0] === v2p[v0 + nv - 1]) closedCount++;
    for (let v = v0; v < v0 + nv - 1; v++) {
      const a = v2p[v] * ps;
      const b = v2p[v + 1] * ps;
      const dx = pd[b] - pd[a];
      const dy = pd[b + 1] - pd[a + 1];
      const dz = pd[b + 2] - pd[a + 2];
      segAx.push(pd[a], pd[a + 1], pd[a + 2]);
      segDir.push(dx, dy, dz);
      cum.push(cum[cum.length - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
  }
  if (polylineCount === 0) {
    throw new Error(
      "splineSample: input has no polyline primitives (build them with createPolyline)",
    );
  }
  const nSeg = segDir.length / 3;
  const L = cum[nSeg];
  const allClosed = closedCount === polylineCount;

  const positions: number[] = [];
  if (params.mode === "count") {
    const n = params.count;
    const denom = allClosed ? n : Math.max(1, n - 1);
    for (let i = 0; i < n; i++) positions.push((i * L) / denom);
  } else {
    const sp = params.spacing;
    if (!(sp > 0)) {
      throw new Error(`splineSample: spacing must be > 0 in 'spacing' mode, got ${sp}`);
    }
    const eps = sp * 1e-6;
    for (let s = 0; s <= L + eps; s += sp) {
      if (allClosed && s >= L - eps && positions.length > 0) break;
      positions.push(Math.min(s, L));
    }
  }

  const n = positions.length;
  const out = createPointCloud(n);
  const op = out.attrs.point.require("P").data;
  const tangent = out.attrs.point.add("tangent", "f32", 3, [0, 0, 0]).data;
  const curveU = out.attrs.point.add("curveU", "f32", 1, 0).data;
  const seeds = out.attrs.point.require("seed").data;
  for (let i = 0; i < n; i++) {
    const s = positions[i];
    let lo = 0;
    let hi = nSeg - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid + 1] > s) hi = mid;
      else lo = mid + 1;
    }
    const segLen = cum[lo + 1] - cum[lo];
    const t = segLen > 0 ? Math.min((s - cum[lo]) / segLen, 1) : 0;
    const dx = segDir[lo * 3];
    const dy = segDir[lo * 3 + 1];
    const dz = segDir[lo * 3 + 2];
    op[i * 3] = segAx[lo * 3] + dx * t;
    op[i * 3 + 1] = segAx[lo * 3 + 1] + dy * t;
    op[i * 3 + 2] = segAx[lo * 3 + 2] + dz * t;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len > 0) {
      tangent[i * 3] = dx / len;
      tangent[i * 3 + 1] = dy / len;
      tangent[i * 3 + 2] = dz / len;
    }
    curveU[i] = L > 0 ? s / L : 0;
    seeds[i] = hashCombine(seed, i);
  }
  return out;
}

describe("splineSample arc-length extraction", () => {
  /** Two polylines over one cloud, so the concatenation is exercised. */
  function pair(a: readonly number[], b: readonly number[], closeB: boolean): Geometry {
    const na = a.length / 3;
    const nb = b.length / 3;
    const geo = createPointCloud(na + nb);
    const P = geo.attrs.point.require("P").data;
    P.set(a, 0);
    P.set(b, na * 3);
    const indices: number[] = [];
    for (let i = 0; i < na; i++) indices.push(i);
    for (let i = 0; i < nb; i++) indices.push(na + i);
    if (closeB) indices.push(na);
    setPolylineTopology(
      geo,
      indices,
      [0, na],
      [na, nb + (closeB ? 1 : 0)],
    );
    return geo;
  }

  /** Deliberately awkward geometry: diagonals, tiny and huge segments. */
  const IRRATIONAL = [0, 0, 0, 1, 1, 1, -3.7, 2.5, 0.001, 900.25, -0.5, 17, 900.25, -0.5, 17];
  const CASES: Array<[string, Geometry]> = [
    ["open L", createPolyline([0, 0, 0, 10, 0, 0, 10, 10, 0])],
    ["closed square", createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], { closed: true })],
    ["irrational 3D", createPolyline(IRRATIONAL)],
    ["irrational closed", createPolyline(IRRATIONAL, { closed: true })],
    ["two open", pair([0, 0, 0, 3, 4, 0], IRRATIONAL, false)],
    ["open + closed", pair(IRRATIONAL, [0, 0, 0, 2, 0, 0, 2, 2, 0], true)],
    ["repeated points", createPolyline([0, 0, 0, 0, 0, 0, 5, 0, 0, 5, 0, 0, 5, 9, 0])],
  ];
  const PARAMS: Array<{ mode: string; count: number; spacing: number }> = [
    { mode: "count", count: 1, spacing: 1 },
    { mode: "count", count: 2, spacing: 1 },
    { mode: "count", count: 5, spacing: 1 },
    { mode: "count", count: 37, spacing: 1 },
    { mode: "spacing", count: 10, spacing: 0.3 },
    { mode: "spacing", count: 10, spacing: 1.7 },
    { mode: "spacing", count: 10, spacing: 7 },
  ];

  for (const [name, geo] of CASES) {
    it(`matches the pre-extraction implementation byte for byte: ${name}`, async () => {
      for (const params of PARAMS) {
        const live = firstGeo(
          (await runNode(splineSample, params, { in: [makeGeometryItem(geo)] }, 9)).out,
        );
        const legacy = legacySplineSample(geo, params, 9);
        expect(snapshotGeometry(live), `${name} / ${JSON.stringify(params)}`).toEqual(
          snapshotGeometry(legacy),
        );
        expect(live.pointCount).toBeGreaterThan(0);
      }
    });
  }
});

/**
 * The two length reports, which exist because this node used to measure on
 * the analytic CURVE while EMITTING a polyline through the samples and
 * report no length at all — so a consumer had no way to get the ruler that
 * matched the geometry it was handed, and any consumer deriving one from
 * `curveU` was silently mixing two rulers that agree on straights and
 * diverge wherever the spline bends.
 *
 * EVERY CHECK HERE IS PER SAMPLE, and that is deliberate rather than
 * thorough. The disagreement between the two rulers TELESCOPES: the ring of
 * per-sample differences sums to the same total under either coordinate, so
 * a total-only check passes just as happily against a `curveU * length`
 * implementation as against a chord walk and has zero diagnostic power for
 * this whole class of bug. The tests below therefore compare each sample's
 * own value against a chord walk re-derived from the emitted positions, and
 * one of them asserts outright that `curveU * total` is NOT what the column
 * holds.
 */
describe("splineSample length reports", () => {
  /** Run splineSample over one geometry and return the output cloud. */
  async function sampled(params: Record<string, unknown>, src: Geometry): Promise<Geometry> {
    return firstGeo((await runNode(splineSample, params, { in: [makeGeometryItem(src)] })).out);
  }

  /** The `name` point column of every sample, as a plain array. */
  function scalarsOf(geo: Geometry, name: string): number[] {
    const attr = geo.attrs.point.require(name);
    return Array.from({ length: geo.pointCount }, (_, i) => attr.get(i));
  }

  /**
   * The chord walk over an output cloud's own positions, re-derived here in
   * f64 exactly the way the node does it: cumulative straight-line distances
   * between consecutive samples in emission order, and the closing chord
   * back to sample 0 reported separately because no SAMPLE holds it.
   *
   * Independent of the node in the only sense that matters — it reads the
   * emitted `P` column and nothing the node computed — so it is an oracle
   * for the reports rather than a restatement of them.
   */
  function chordWalk(geo: Geometry): { arcs: number[]; closing: number } {
    const P = geo.attrs.point.require("P");
    const arcs: number[] = [];
    let arc = 0;
    for (let i = 0; i < geo.pointCount; i++) {
      if (i > 0) {
        const dx = P.get(i, 0) - P.get(i - 1, 0);
        const dy = P.get(i, 1) - P.get(i - 1, 1);
        const dz = P.get(i, 2) - P.get(i - 1, 2);
        arc += Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      arcs.push(arc);
    }
    const last = geo.pointCount - 1;
    let closing = 0;
    if (last > 0) {
      const dx = P.get(0, 0) - P.get(last, 0);
      const dy = P.get(0, 1) - P.get(last, 1);
      const dz = P.get(0, 2) - P.get(last, 2);
      closing = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return { arcs, closing };
  }

  /** The unit square, closed: perimeter 4 with four corners to cut. */
  function square(): Geometry {
    return createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], { closed: true });
  }

  it("writes each sample's OWN chord arc, which is not the curve fraction rescaled", async () => {
    // THE TEST THE BUG HAD TO FAIL. The unit square sampled three times
    // lands at curve stations 0, 4/3 and 8/3 — (0,0), (1,1/3) and (1/3,1) —
    // so the three emitted chords are 1.05409, 0.94281 and (closing)
    // 1.05409: WILDLY uneven, because each one cuts a different amount of
    // corner. Under `curveU * length` all three would be 1.01700, the ring
    // would still sum to the same total, and only a per-sample check can
    // tell the two apart.
    const geo = await sampled(
      { mode: "count", count: 3, sampledLengthAttr: "sampleLength", sampleArcAttr: "sampleArc" },
      square(),
    );
    expect(positionsOf(geo)).toEqual([
      [0, 0, 0],
      [1, Math.fround(1 / 3), 0],
      [Math.fround(1 / 3), 1, 0],
    ]);
    const arcs = scalarsOf(geo, "sampleArc");
    const walk = chordWalk(geo);
    // Bit-exact against the oracle: the node accumulates in f64 over the
    // f32 positions it just wrote and rounds once into the f32 column, so
    // this is an equality and not a toBeCloseTo.
    expect(arcs).toEqual(walk.arcs.map((v) => Math.fround(v)));
    expect(arcs[0]).toBe(0);
    expect(arcs[1]).toBeCloseTo(Math.sqrt(1 + 1 / 9), 5);
    expect(arcs[2]).toBeCloseTo(Math.sqrt(1 + 1 / 9) + Math.sqrt(8 / 9), 5);
    // The teeth. `curveU` is the CURVE's fraction, and rescaling it by the
    // emitted length is precisely the wrong fix the two rulers exist to
    // rule out: it lands 0.037 away on a square of side 1, and it accrues
    // entirely over the bends.
    const total = geo.attrs.detail.require("sampleLength").get(0);
    const us = scalarsOf(geo, "curveU");
    expect(us).toEqual([0, Math.fround(1 / 3), Math.fround(2 / 3)]);
    expect(Math.abs(us[1] * total - arcs[1])).toBeGreaterThan(0.03);
    expect(Math.abs(us[2] * total - arcs[2])).toBeGreaterThan(0.03);
    // And the per-sample steps are UNEVEN, which is the property that
    // telescopes away in a total: a coordinate that gave every sample the
    // same step would pass any sum-only check ever written.
    const steps = [arcs[1] - arcs[0], arcs[2] - arcs[1], total - arcs[2]];
    expect(steps[0]).toBeGreaterThan(steps[1] + 0.1);
    expect(steps[2]).toBeGreaterThan(steps[1] + 0.1);
  });

  it("makes the two rulers one: the per-sample arcs sum to the reported total", async () => {
    // Many samples, an irregular closed curve and a spacing that divides
    // nothing evenly, so the walk has a remainder at the seam and every
    // chord is a different length. The identity has to hold sample by
    // sample and then close.
    const wiggle = createPolyline(
      [0, 0, 0, 7.25, 1.5, 0, 9, 8.75, -2, 3.5, 11, 1, -2.75, 6, 0.5],
      { closed: true },
    );
    for (const params of [
      { mode: "count", count: 17 },
      { mode: "count", count: 4 },
      { mode: "spacing", spacing: 1.7 },
      { mode: "spacing", spacing: 0.3 },
    ]) {
      const geo = await sampled(
        { ...params, sampledLengthAttr: "sampleLength", sampleArcAttr: "sampleArc" },
        wiggle,
      );
      const arcs = scalarsOf(geo, "sampleArc");
      const walk = chordWalk(geo);
      const label = JSON.stringify(params);
      // Per sample first: the total below is only meaningful once every
      // station under it is the right one.
      expect(arcs, label).toEqual(walk.arcs.map((v) => Math.fround(v)));
      const total = geo.attrs.detail.require("sampleLength").get(0);
      // The total IS the walk plus the seam chord, to the bit — one f64 sum
      // rounded once into an f32 column, which is what the node does.
      expect(total, label).toBe(Math.fround(walk.arcs[walk.arcs.length - 1] + walk.closing));
      // ...and it is the sum of the steps the column publishes. Summed from
      // the f32 arcs rather than from the node's f64 accumulator, so this
      // one is a tolerance and not an equality: each of the ~35 partial sums
      // was rounded to f32 separately on the way into the column. The bound
      // is generous by two orders of magnitude and still far under the
      // 0.037 the wrong ruler misses by above.
      let stepped = 0;
      for (let i = 1; i < arcs.length; i++) stepped += arcs[i] - arcs[i - 1];
      stepped += total - arcs[arcs.length - 1];
      expect(Math.abs(stepped - total), label).toBeLessThan(total * 1e-5);
      // The seam chord is in the LENGTH and on no sample.
      expect(arcs[arcs.length - 1], label).toBeLessThan(total);
    }
  });

  it("closes the ring only when the whole input is closed", async () => {
    // Closed: the samples divide the curve without duplicating the start, so
    // the last sample is a point before a seam and the chord back to sample
    // 0 is as real as any other.
    //
    // FIVE samples rather than four, and the count is the whole point of the
    // case. Four on the unit square land exactly ON its corners, where
    // nothing is cut and BOTH rulers read [0, 1, 2, 3] — a check written
    // there passes against a `curveU * length` implementation just as
    // happily as against a chord walk, which is no check at all. At five the
    // step is 0.8, no sample lands on a corner, and every chord is cut.
    const closed = await sampled(
      { mode: "count", count: 5, sampledLengthAttr: "sampleLength", sampleArcAttr: "sampleArc" },
      square(),
    );
    const closedArcs = scalarsOf(closed, "sampleArc");
    const closedTotal = closed.attrs.detail.require("sampleLength").get(0);
    const closedWalk = chordWalk(closed);
    expect(closedArcs).toEqual(closedWalk.arcs.map((v) => Math.fround(v)));
    // The seam chord is in the LENGTH and on no sample, and the length is
    // the walk plus it — which is what makes the last sample's arc strictly
    // less than the total on a closed input.
    expect(closedTotal).toBe(Math.fround(closedWalk.arcs[4] + closedWalk.closing));
    expect(closedArcs[4]).toBeLessThan(closedTotal);
    expect(closedTotal).toBeLessThan(4);
    // ...and the ruler is NOT the curve fraction rescaled. Stated here as
    // well as in the per-sample test above because this is the case named
    // for the closing chord, and the chord is where a length-only reading of
    // the two rulers looks most convincing.
    const closedUs = scalarsOf(closed, "curveU");
    expect(Math.abs(closedUs[1] * closedTotal - closedArcs[1])).toBeGreaterThan(0.01);
    // The corners-exactly case belongs here too, as the OTHER half of the
    // same statement: where there is no corner to cut the two rulers agree
    // exactly, so the gap above is the corner-cutting and nothing else.
    const onCorners = await sampled(
      { mode: "count", count: 4, sampledLengthAttr: "sampleLength", sampleArcAttr: "sampleArc" },
      square(),
    );
    expect(onCorners.attrs.detail.require("sampleLength").get(0)).toBe(4);
    expect(scalarsOf(onCorners, "sampleArc")).toEqual([0, 1, 2, 3]);
    // OPEN: the last sample is an END, not a point before a seam, so its arc
    // IS the whole emitted length and there is no closing chord to add.
    const open = await sampled(
      { mode: "count", count: 3, sampledLengthAttr: "sampleLength", sampleArcAttr: "sampleArc" },
      createPolyline([0, 0, 0, 3, 0, 0, 3, 4, 0]),
    );
    const openArcs = scalarsOf(open, "sampleArc");
    const openTotal = open.attrs.detail.require("sampleLength").get(0);
    expect(openArcs[0]).toBe(0);
    expect(openArcs[2]).toBe(openTotal);
    // The corner IS cut here: the curve is 7 long and the polyline through
    // three samples is hypot(3, 0.5) + 3.5, which is what a consumer
    // stepping over this output actually has to walk.
    expect(openTotal).toBeLessThan(7);
    expect(openTotal).toBeCloseTo(Math.sqrt(9.25) + 3.5, 5);
    expect(openTotal).toBe(Math.fround(chordWalk(open).arcs[2]));
  });

  it("runs ONE arc across the join, because the polylines are one curve here", async () => {
    // This node concatenates every polyline and `curveU` is a fraction of
    // that whole, so the arc is one running coordinate too — a sample on the
    // second road does NOT restart at 0. (pathResample restarts per path
    // because it never concatenates anything; the two nodes disagree here on
    // purpose.) The jump between the two roads is a chord of the emitted
    // sequence like any other and is inside both reports.
    const geo = await sampled(
      {
        mode: "spacing",
        spacing: 4,
        sampledLengthAttr: "sampleLength",
        sampleArcAttr: "sampleArc",
      },
      twoRoads(),
    );
    expect(positionsOf(geo)).toEqual([
      [0, 0, 0],
      [4, 0, 0],
      [8, 0, 0],
      [2, 10, 0],
      [6, 10, 0],
      [10, 10, 0],
    ]);
    const arcs = scalarsOf(geo, "sampleArc");
    const walk = chordWalk(geo);
    expect(arcs).toEqual(walk.arcs.map((v) => Math.fround(v)));
    // 0, 4, 8, then the jump from (8,0,0) to (2,10,0) — hypot(6, 10) —
    // rather than a restart at 0 or a step of 4.
    expect(arcs.slice(0, 3)).toEqual([0, 4, 8]);
    expect(arcs[3]).toBeCloseTo(8 + Math.sqrt(136), 4);
    // Mixed open input, so nothing closes: the last sample's arc is the
    // whole reported length.
    expect(geo.attrs.detail.require("sampleLength").get(0)).toBe(arcs[5]);
  });

  it("writes neither report by default, and an empty name is not a name", async () => {
    const src = withPrimValue(twoRoads(), "roadWidth", [2, 7]);
    const byDefault = await sampled({ mode: "count", count: 5 }, src);
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
    expect(byDefault.attrs.detail.names()).toEqual([]);
    const named = await sampled(
      { mode: "count", count: 5, sampledLengthAttr: "", sampleArcAttr: "" },
      src,
    );
    expect(snapshotGeometry(named)).toEqual(snapshotGeometry(byDefault));
  });

  it("changes nothing about the cook it reports on", async () => {
    // The addition has to be PURE: turning the reports on may add columns
    // and must move nothing that was already there. Compared column by
    // column rather than by snapshot, since the snapshots differ by exactly
    // the two new columns and a diff of everything else is the claim.
    const src = withPrimValue(twoRoads(), "roadWidth", [2, 7]);
    const plain = await sampled({ mode: "spacing", spacing: 3 }, src);
    const reported = await sampled(
      {
        mode: "spacing",
        spacing: 3,
        sampledLengthAttr: "sampleLength",
        sampleArcAttr: "sampleArc",
      },
      src,
    );
    expect(reported.pointCount).toBe(plain.pointCount);
    for (const name of plain.attrs.point.names()) {
      const a = plain.attrs.point.require(name);
      const b = reported.attrs.point.require(name);
      const n = plain.pointCount * a.tupleSize;
      expect(Array.from(b.data.subarray(0, n)), name).toEqual(
        Array.from(a.data.subarray(0, n)),
      );
    }
    // The one visible difference, and it is a difference in ORDER as well as
    // in content: the report's column is created BEFORE the primitive carry,
    // because the slot check has to run while the only columns present are
    // the ones this node writes itself. So `sampleArc` lands ahead of the
    // carried `roadWidth` rather than after it — the data is untouched
    // either way, which the loop above is what actually checks.
    expect(reported.attrs.point.names()).toEqual([
      ...plain.attrs.point.names().filter((n) => n !== "roadWidth"),
      "sampleArc",
      "roadWidth",
    ]);
  });

  it("refuses a report that would delete a differently shaped column", async () => {
    // `tangent` is the column that proves the per-sample report is checked
    // against the OUTPUT'S POINT domain: it is f32x3, it does not exist on
    // the input at all, and a check against any other set would have waved
    // it straight through.
    const msg = await rejection(
      runNode(splineSample, { sampleArcAttr: "tangent" }, { in: [makeGeometryItem(twoRoads())] }),
    );
    expect(msg).toContain('splineSample: sampleArcAttr "tangent"');
    expect(msg).toContain("already exists on the output's point domain");
    expect(msg).toContain("removeAttribute upstream cannot help here");
  });

  it("names sampleArcAttr itself when the carry would land on it", async () => {
    // The collision is real either way — every primitive attribute is
    // carried onto these samples, so "roadWidth" and this report want the
    // same POINT column. What is pinned here is WHICH refusal fires: caught
    // downstream by carryPrimitiveAttributes, the message is about the
    // CARRIED attribute, never says "sampleArcAttr", and sends the reader
    // after the setAttribute that wrote the input's column — the right
    // refusal with the wrong fix.
    const roads = withPrimValue(twoRoads(), "roadWidth", [2, 7]);
    const msg = await rejection(
      runNode(splineSample, { sampleArcAttr: "roadWidth" }, { in: [makeGeometryItem(roads)] }),
    );
    expect(msg).toContain('splineSample: sampleArcAttr "roadWidth"');
    expect(msg).toContain("RENAME THE PARAM");
    expect(msg).toContain('"sampleArc"');
  });

  it("refuses EITHER report naming the type tag", async () => {
    // Latent rather than live here — this node emits no topology, so
    // nothing stamps the tag on its output — which is exactly why it has to
    // be refused rather than left to be discovered: one promoteAttribute
    // onto the primitive domain later replaces a string tag with a float and
    // every path node stops seeing a path. Refused from the param alone,
    // before any geometry is read.
    const arcMsg = await rejection(
      runNode(
        splineSample,
        { sampleArcAttr: PRIMTYPE_ATTR },
        { in: [makeGeometryItem(createPointCloud(0))] },
      ),
    );
    expect(arcMsg).toContain(`splineSample: sampleArcAttr may not be "${PRIMTYPE_ATTR}"`);
    expect(arcMsg).toContain("TYPE TAG");
    expect(arcMsg).toContain('"sampleArc"');
    // AND the detail one, which is the half no general rule catches. The
    // per-path equivalent on pathResample gets this refusal for free — that
    // report lands on the primitive domain, where `primtype` already exists
    // as a string, so the shape check refuses it without anyone naming it.
    // The detail domain holds no such column, so without this the cook would
    // succeed and write a float under the tag's name in silence.
    const lenMsg = await rejection(
      runNode(
        splineSample,
        { sampledLengthAttr: PRIMTYPE_ATTR },
        { in: [makeGeometryItem(createPointCloud(0))] },
      ),
    );
    expect(lenMsg).toContain(`splineSample: sampledLengthAttr may not be "${PRIMTYPE_ATTR}"`);
    expect(lenMsg).toContain("TYPE TAG");
    expect(lenMsg).toContain('"sampleLength"');
    // Not a live column either way: a real cook under proper names leaves
    // the tag off both domains this node writes.
    const ok = await sampled(
      { mode: "count", count: 3, sampledLengthAttr: "sampleLength", sampleArcAttr: "sampleArc" },
      createPolyline([0, 0, 0, 4, 0, 0]),
    );
    expect(ok.attrs.point.has(PRIMTYPE_ATTR)).toBe(false);
    expect(ok.attrs.detail.has(PRIMTYPE_ATTR)).toBe(false);
  });

  it("gives the arc to the column the param named, even when that is curveU", async () => {
    // `curveU` is f32 tuple 1, exactly this report's shape, so the slot rule
    // RESETS it rather than refusing — and reset means the two names are one
    // buffer. Which write lands last is therefore a real decision: a column
    // an author explicitly pointed at the arc must not come back holding
    // fractions, because that cook looks fine and answers the other
    // question. It is also the sharpest statement that the two are different
    // numbers at all.
    const geo = await sampled(
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

  it("lets the two reports share a name, since they are on different domains", async () => {
    // Nothing collides: one lands on the detail domain and one on the point
    // domain, so refusing this would refuse a graph in which the two values
    // coexist perfectly well.
    const geo = await sampled(
      { mode: "count", count: 3, sampledLengthAttr: "len", sampleArcAttr: "len" },
      createPolyline([0, 0, 0, 4, 0, 0]),
    );
    expect(geo.attrs.detail.require("len").get(0)).toBe(4);
    expect(scalarsOf(geo, "len")).toEqual([0, 2, 4]);
  });
});

describe("volumeSample", () => {
  it("fills bounds with cell centers when jitter is 0", async () => {
    const geo = firstGeo(
      (
        await runNode(volumeSample, {
          boundsMin: [0, 0, 0],
          boundsMax: [2, 1, 1],
          cellSize: 1,
          jitter: 0,
        })
      ).out,
    );
    expect(positionsOf(geo)).toEqual([
      [0.5, 0.5, 0.5],
      [1.5, 0.5, 0.5],
    ]);
  });

  it("keeps jittered points inside their cells", async () => {
    const geo = firstGeo(
      (
        await runNode(volumeSample, {
          boundsMin: [0, 0, 0],
          boundsMax: [4, 4, 4],
          cellSize: 1,
          jitter: 1,
        })
      ).out,
    );
    expect(geo.pointCount).toBe(64);
    const centers = firstGeo(
      (
        await runNode(volumeSample, {
          boundsMin: [0, 0, 0],
          boundsMax: [4, 4, 4],
          cellSize: 1,
          jitter: 0,
        })
      ).out,
    );
    const jittered = positionsOf(geo);
    const base = positionsOf(centers);
    for (let i = 0; i < 64; i++) {
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(jittered[i][k] - base[i][k])).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it("derives bounds from a connected geometry", async () => {
    const cloud = createPointCloud(2);
    cloud.attrs.point.require("P").setTuple(0, [0, 0, 0]);
    cloud.attrs.point.require("P").setTuple(1, [2, 1, 1]);
    const geo = firstGeo(
      (
        await runNode(
          volumeSample,
          { boundsMin: [99, 99, 99], boundsMax: [100, 100, 100], cellSize: 1, jitter: 0 },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    expect(positionsOf(geo)).toEqual([
      [0.5, 0.5, 0.5],
      [1.5, 0.5, 0.5],
    ]);
  });

  it("rejects non-positive cell sizes and oversized grids", async () => {
    await expect(runNode(volumeSample, { cellSize: 0 })).rejects.toThrow(/cellSize must be > 0/);
    await expect(
      runNode(volumeSample, { boundsMin: [0, 0, 0], boundsMax: [1e4, 1e4, 1e4], cellSize: 1 }),
    ).rejects.toThrow(/increase cellSize/);
  });
});
