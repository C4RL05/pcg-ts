/**
 * `pointScatterOnPath`: the arc-length scatter.
 *
 * Every geometric expectation here is re-derived from the raw point
 * coordinates by hand — {@link positionAtArc} and {@link distanceToPath}
 * walk the chords themselves rather than calling the library's own arc
 * table — because the node's whole claim is that its arc coordinate is
 * the one every other path node uses. An expectation recorded from a run
 * would move with the code and prove nothing.
 */
import { describe, expect, it } from "vitest";
import {
  Geometry,
  PRIMTYPE_ATTR,
  createPointCloud,
  createPolyline,
  setPolylineTopology,
} from "../data/index.js";
import { attribute, constant, div, index as indexField, mul } from "../fields/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { hashCombine } from "../random/index.js";
import { pointScatterOnPath } from "./pointScatterOnPath.js";
import { firstGeo, runNode, snapshotGeometry } from "./nodes.testsupport.js";

// ---------------------------------------------------------------------------
// Harness

/** The message a node refused with, or a failure if it did not refuse. */
async function rejection(run: Promise<unknown>): Promise<string> {
  const err: unknown = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof Error)) throw new Error("expected the node to throw an Error");
  return err.message;
}

async function scatter(
  path: Geometry,
  params: Record<string, unknown> = {},
  seed = 1,
): Promise<Geometry> {
  const outputs = await runNode(pointScatterOnPath, params, { path: [makeGeometryItem(path)] }, seed);
  return firstGeo(outputs.out);
}

/** One point column as a plain array of its elements' tuples flattened. */
function col(geo: Geometry, name: string): number[] {
  const a = geo.attrs.point.require(name);
  return Array.from(a.data.slice(0, geo.attrs.point.count * a.tupleSize));
}

/** Point `i` as [x, y, z]. */
function pointAt(geo: Geometry, i: number): [number, number, number] {
  const P = geo.attrs.point.require("P");
  return [P.get(i, 0), P.get(i, 1), P.get(i, 2)];
}

// ---------------------------------------------------------------------------
// Independent arc-length re-derivation
//
// The chord walk, written out here rather than imported, so a change to
// the library's own table shows up as a red test instead of moving both
// sides of the comparison at once.

/** The walk's positions, with the closing chord appended when closed. */
function walkOf(positions: readonly number[], closed: boolean): number[] {
  return closed ? [...positions, positions[0], positions[1], positions[2]] : [...positions];
}

/** Cumulative chord length along a walk; `cum[0] === 0`. */
function cumOf(walk: readonly number[]): number[] {
  const cum = [0];
  for (let k = 0; k * 3 + 5 < walk.length; k++) {
    const dx = walk[k * 3 + 3] - walk[k * 3];
    const dy = walk[k * 3 + 4] - walk[k * 3 + 1];
    const dz = walk[k * 3 + 5] - walk[k * 3 + 2];
    cum.push(cum[k] + Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  return cum;
}

/** Total chord length of a polyline, closing segment included when closed. */
function lengthOf(positions: readonly number[], closed = false): number {
  const cum = cumOf(walkOf(positions, closed));
  return cum[cum.length - 1];
}

/** The position at arc `s` along a polyline, by linear walk. */
function positionAtArc(
  positions: readonly number[],
  closed: boolean,
  s: number,
): [number, number, number] {
  const walk = walkOf(positions, closed);
  const cum = cumOf(walk);
  let k = cum.length - 2;
  for (let j = 0; j + 1 < cum.length; j++) {
    if (cum[j + 1] > s) {
      k = j;
      break;
    }
  }
  const segLen = cum[k + 1] - cum[k];
  const t = segLen > 0 ? Math.min((s - cum[k]) / segLen, 1) : 0;
  return [
    walk[k * 3] + (walk[k * 3 + 3] - walk[k * 3]) * t,
    walk[k * 3 + 1] + (walk[k * 3 + 4] - walk[k * 3 + 1]) * t,
    walk[k * 3 + 2] + (walk[k * 3 + 5] - walk[k * 3 + 2]) * t,
  ];
}

/** Shortest distance from a world position to a polyline's chords. */
function distanceToPath(
  positions: readonly number[],
  closed: boolean,
  p: readonly [number, number, number],
): number {
  const walk = walkOf(positions, closed);
  let best = Number.POSITIVE_INFINITY;
  for (let k = 0; k * 3 + 5 < walk.length; k++) {
    const ax = walk[k * 3];
    const ay = walk[k * 3 + 1];
    const az = walk[k * 3 + 2];
    const dx = walk[k * 3 + 3] - ax;
    const dy = walk[k * 3 + 4] - ay;
    const dz = walk[k * 3 + 5] - az;
    const sq = dx * dx + dy * dy + dz * dz;
    let t = sq > 0 ? ((p[0] - ax) * dx + (p[1] - ay) * dy + (p[2] - az) * dz) / sq : 0;
    t = Math.min(1, Math.max(0, t));
    const ex = p[0] - (ax + dx * t);
    const ey = p[1] - (ay + dy * t);
    const ez = p[2] - (az + dz * t);
    best = Math.min(best, Math.sqrt(ex * ex + ey * ey + ez * ez));
  }
  return best;
}

// ---------------------------------------------------------------------------
// Fixtures

/**
 * The OPEN reference path: an L in the XZ plane, (0,0,0) -> (10,0,0) ->
 * (10,0,20). Chords 10 and 20, so the arc table is [0, 10, 30] and the
 * corner is at exactly one third of the way along.
 */
const L_SHAPE = [0, 0, 0, 10, 0, 0, 10, 0, 20];
const OPEN = () => createPolyline(L_SHAPE);

/**
 * The CLOSED reference path: a 10-unit square walked anticlockwise, so
 * every chord is 10 and the arc table is [0, 10, 20, 30, 40] INCLUDING
 * the closing chord from the last point back to the first.
 */
const SQUARE = [0, 0, 0, 10, 0, 0, 10, 0, 10, 0, 0, 10];
const CLOSED = () => createPolyline(SQUARE, { closed: true });

/**
 * Two straight roads in ONE geometry: primitive 0 runs 10 units along X
 * at z = 0, primitive 1 runs 40 units along X at z = 20. A primitive f32
 * `length` column holds their true arc lengths, which is what
 * `pathResample`'s `lengthAttr` writes and what a count field reads.
 */
function twoRoads(): Geometry {
  const geo = createPointCloud(4);
  const P = geo.attrs.point.require("P");
  P.setTuple(0, [0, 0, 0]);
  P.setTuple(1, [10, 0, 0]);
  P.setTuple(2, [0, 0, 20]);
  P.setTuple(3, [40, 0, 20]);
  setPolylineTopology(geo, [0, 1, 2, 3], [0, 2], [2, 2]);
  const len = geo.attrs.primitive.add("length", "f32", 1, 0);
  len.set(0, 10);
  len.set(1, 40);
  return geo;
}

/** Write one scalar f32 value per primitive. */
function withPrimValue(geo: Geometry, name: string, values: readonly number[]): Geometry {
  const attr = geo.attrs.primitive.add(name, "f32", 1, 0);
  for (let p = 0; p < values.length; p++) attr.set(p, values[p]);
  return geo;
}

/**
 * THE ONE FIXTURE WHERE A PATH'S PRIMITIVE INDEX AND ITS POSITION AMONG
 * THE POLYLINES ARE DIFFERENT NUMBERS, and the only kind of input that
 * can tell the two apart.
 *
 * `count` resolves on the input's PRIMITIVE domain, so the resolved
 * column has one entry per PRIMITIVE — including the primitives this node
 * skips. The arc tables, by contrast, hold only the usable polylines, so
 * the Nth table is not in general the Nth primitive. In EVERY OTHER
 * FIXTURE IN THIS FILE every primitive is a polyline, which makes the two
 * numbers equal for every path and hides the difference completely: a
 * count read at the wrong one of them passes all of those tests. This
 * geometry is deliberately mixed so that it cannot.
 *
 * `skip` decides WHY primitive 0 is not a path — either it has a single
 * vertex (the vertex-count filter) or it is tagged `poly` (the primtype
 * filter). Both reasons must produce the same answer.
 *
 * Primitive 0 is not a path. Primitive 1 is a 10-unit road at z = 10 and
 * primitive 2 a 40-unit road at z = 20, so a point's own z says which
 * road it landed on. The per-primitive `cnt` column is [100, 3, 9]: read
 * through the PRIMITIVE index the two roads take 3 and 9 points, and read
 * through the polyline ordinal they would take 100 and 3.
 */
function stubThenTwoRoads(skip: "one-vertex" | "poly" = "one-vertex"): Geometry {
  const oneVertex = skip === "one-vertex";
  // The `poly` spelling needs three vertices to be a triangle rather than
  // a degenerate one; the one-vertex spelling needs exactly one.
  const lead = oneVertex ? 1 : 3;
  const geo = createPointCloud(lead + 4);
  const P = geo.attrs.point.require("P");
  P.setTuple(0, [0, 0, 0]);
  if (!oneVertex) {
    P.setTuple(1, [1, 0, 0]);
    P.setTuple(2, [0, 0, 1]);
  }
  P.setTuple(lead, [0, 0, 10]);
  P.setTuple(lead + 1, [10, 0, 10]);
  P.setTuple(lead + 2, [0, 0, 20]);
  P.setTuple(lead + 3, [40, 0, 20]);
  const verts = Uint32Array.from({ length: lead + 4 }, (_, k) => k);
  geo.setTopology(
    verts,
    Uint32Array.of(0, lead, lead + 2),
    Uint32Array.of(lead, 2, 2),
  );
  if (!oneVertex) {
    const primType = geo.attrs.primitive.add(PRIMTYPE_ATTR, "string", 1, "polyline");
    primType.setString(0, "poly");
    primType.setString(1, "polyline");
    primType.setString(2, "polyline");
  }
  const cnt = geo.attrs.primitive.add("cnt", "f32", 1, 0);
  cnt.set(0, 100);
  cnt.set(1, 3);
  cnt.set(2, 9);
  return geo;
}

/** Each emitted point's z, which names the road it landed on. */
function zOf(geo: Geometry): number[] {
  const out: number[] = [];
  for (let i = 0; i < geo.pointCount; i++) out.push(pointAt(geo, i)[2]);
  return out;
}

// ---------------------------------------------------------------------------

describe("pointScatterOnPath: what comes out", () => {
  it("emits a fresh standard point cloud with the arc column and no topology", async () => {
    const out = await scatter(OPEN(), { count: 6 });
    expect(out.pointCount).toBe(6);
    expect(out.primitiveCount).toBe(0);
    expect(out.attrs.point.names().sort()).toEqual(
      ["P", "boundsMax", "boundsMin", "color", "density", "rot", "scale", "seed", "station"].sort(),
    );
    const station = out.attrs.point.require("station");
    expect(station.type).toBe("f32");
    expect(station.tupleSize).toBe(1);
  });

  it("is not a clone of the input: the path's own points do not come through", async () => {
    // The L has three points; a scatter of two must be two, at positions
    // the input never held unless the draw landed on a vertex.
    const out = await scatter(OPEN(), { count: 2 });
    expect(out.pointCount).toBe(2);
    expect(out.attrs.point.count).toBe(2);
  });

  it("places every point ON the path", async () => {
    const out = await scatter(OPEN(), { count: 200 });
    let worst = 0;
    for (let i = 0; i < out.pointCount; i++) {
      worst = Math.max(worst, distanceToPath(L_SHAPE, false, pointAt(out, i)));
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it("writes the arc position the point actually sits at", async () => {
    const out = await scatter(OPEN(), { count: 100 });
    const arcs = col(out, "station");
    let worst = 0;
    for (let i = 0; i < out.pointCount; i++) {
      const want = positionAtArc(L_SHAPE, false, arcs[i]);
      const got = pointAt(out, i);
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(want[k] - got[k]));
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it("keeps every arc inside [0, length)", async () => {
    const L = lengthOf(L_SHAPE);
    expect(L).toBe(30);
    const arcs = col(await scatter(OPEN(), { count: 500 }), "station");
    expect(Math.min(...arcs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...arcs)).toBeLessThan(L);
  });

  it("groups the output by primitive, in primitive order", async () => {
    // Path 0 takes 2 points, path 1 takes 3: the carried `length` column
    // says which path each point came from, and it must not interleave.
    const out = await scatter(twoRoads(), { count: mul(0.2, attribute("length")) });
    expect(out.pointCount).toBe(2 + 8);
    expect(col(out, "length")).toEqual([10, 10, 40, 40, 40, 40, 40, 40, 40, 40]);
  });

  it("carries the polyline's own primitive attributes onto its points", async () => {
    const roads = withPrimValue(twoRoads(), "roadWidth", [3, 7]);
    const out = await scatter(roads, { count: 2 });
    expect(col(out, "roadWidth")).toEqual([3, 3, 7, 7]);
  });

  it("refuses a carried primitive attribute that would delete a column it writes", async () => {
    const roads = withPrimValue(twoRoads(), "station", [1, 2]);
    const msg = await rejection(scatter(roads, { count: 2 }));
    expect(msg).toContain("pointScatterOnPath");
    expect(msg).toContain('"station"');
  });
});

describe("pointScatterOnPath: the count field", () => {
  it("places a plain count on each polyline", async () => {
    const out = await scatter(twoRoads(), { count: 7 });
    expect(out.pointCount).toBe(14);
    expect(col(out, "length")).toEqual([...Array<number>(7).fill(10), ...Array<number>(7).fill(40)]);
  });

  it("gives each polyline its own count from a per-primitive length field", async () => {
    // 0.5 per unit of arc: the 10-unit road takes 5 and the 40-unit road
    // takes 20 — in ONE cook, which is the whole reason this param is a
    // field and no source node's count can be.
    const out = await scatter(twoRoads(), { count: mul(0.5, attribute("length")) });
    expect(out.pointCount).toBe(25);
    const lengths = col(out, "length");
    expect(lengths.filter((v) => v === 10)).toHaveLength(5);
    expect(lengths.filter((v) => v === 40)).toHaveLength(20);
    // And each group really is on its own road: road 0 is at z = 0, road
    // 1 at z = 20.
    for (let i = 0; i < out.pointCount; i++) {
      expect(pointAt(out, i)[2]).toBe(lengths[i] === 10 ? 0 : 20);
    }
  });

  it("rounds a resolved count to nearest, with a half going up", async () => {
    // 0.25 per unit: road 0 resolves to 2.5 (-> 3) and road 1 to 10.
    const out = await scatter(twoRoads(), { count: mul(0.25, attribute("length")) });
    const lengths = col(out, "length");
    expect(lengths.filter((v) => v === 10)).toHaveLength(3);
    expect(lengths.filter((v) => v === 40)).toHaveLength(10);
  });

  it("rounds a fraction below a half down", async () => {
    // 0.24 per unit: road 0 resolves to 2.4 (-> 2), road 1 to 9.6 (-> 10).
    const out = await scatter(twoRoads(), { count: mul(0.24, attribute("length")) });
    const lengths = col(out, "length");
    expect(lengths.filter((v) => v === 10)).toHaveLength(2);
    expect(lengths.filter((v) => v === 40)).toHaveLength(10);
  });

  it("clamps a negative resolved count at 0 rather than erroring", async () => {
    expect((await scatter(OPEN(), { count: constant(-3) })).pointCount).toBe(0);
    expect((await scatter(OPEN(), { count: -3 })).pointCount).toBe(0);
  });

  it("emits an empty cloud, with the arc column, at count 0", async () => {
    const out = await scatter(OPEN(), { count: 0 });
    expect(out.pointCount).toBe(0);
    expect(out.attrs.point.names()).toContain("station");
  });

  it("scatters only the paths the field gave a count to", async () => {
    // 0.04 per unit: road 0 resolves to 0.4 and rounds to none at all,
    // road 1 to 1.6 and rounds to two. A road with no trees is a road.
    const out = await scatter(twoRoads(), { count: mul(0.04, attribute("length")) });
    expect(col(out, "length")).toEqual([40, 40]);
  });

  it("refuses a count field that resolves to a non-finite value, naming the param", async () => {
    const msg = await rejection(scatter(OPEN(), { count: div(constant(1), constant(0)) }));
    expect(msg).toContain("pointScatterOnPath");
    expect(msg).toContain('param "count"');
    expect(msg).toContain("+Infinity");
  });

  it("refuses a plain non-finite count before it looks at the geometry", async () => {
    const msg = await rejection(scatter(OPEN(), { count: Number.NaN }));
    expect(msg).toContain('pointScatterOnPath: param "count" is NaN');
  });

  // A PLAIN value has two legal spellings on a field-capable scalar param —
  // a number and a one-element tuple (`graph/params.ts` admits both) — and
  // NEITHER is a Field, so `resolveOn`'s guard never sees them. The tuple
  // spelling used to walk past a `typeof === "number"` check, reach
  // `Math.round(NaN)`, defeat the cap (`NaN > cap` is false), and die in
  // `AttributeSet.resize` with a message naming neither this node nor the
  // param the author actually set.
  it("refuses a NaN count written as a one-element tuple, in the NODE's own words", async () => {
    const msg = await rejection(scatter(OPEN(), { count: [Number.NaN] }));
    expect(msg).toContain('pointScatterOnPath: param "count" is NaN');
    expect(msg).toContain("finite number >= 0");
    // The data layer's own refusal, which names no node and no param.
    expect(msg).not.toContain("resize:");
    expect(msg).not.toContain("non-negative integer");
  });

  it("refuses an infinite count written as a one-element tuple", async () => {
    // This one used to be caught, but by the ALLOCATION CAP further down,
    // which reports it as a population too large rather than as a value
    // that is not a population at all.
    const msg = await rejection(scatter(OPEN(), { count: [Number.POSITIVE_INFINITY] }));
    expect(msg).toContain('pointScatterOnPath: param "count" is Infinity');
    expect(msg).not.toContain("1048576");
  });

  it("names the offending component when a tuple count is broken in a later lane", async () => {
    // Every lane is checked rather than the first, so a tuple whose first
    // number is fine does not hide a broken one behind it.
    const msg = await rejection(scatter(OPEN(), { count: [4, Number.NaN, 4] }));
    expect(msg).toContain('pointScatterOnPath: param "count" (component 1) is NaN');
  });

  it("still refuses a NaN a FIELD produced, through the field guard and not the plain one", async () => {
    // The plain check returns early for a Field, so the column guard must
    // still be the thing that answers here — its wording is the proof.
    const msg = await rejection(scatter(OPEN(), { count: div(constant(0), constant(0)) }));
    expect(msg).toContain('pointScatterOnPath: param "count" resolved to NaN');
    expect(msg).toContain("A FIELD param is not range-checked");
    expect(msg).not.toContain("is NaN, which is not a usable value");
  });

  it("refuses a count field that resolves wider than one number per path", async () => {
    const msg = await rejection(scatter(twoRoads(), { count: constant([2, 2, 2]) }));
    expect(msg).toContain('param "count" must evaluate to ONE number per path');
  });

  it("refuses a total over the cap, naming the path the total ran out on", async () => {
    const msg = await rejection(scatter(OPEN(), { count: 2_000_000 }));
    expect(msg).toContain("pointScatterOnPath");
    expect(msg).toContain("1048576");
    expect(msg).toContain("primitive 0");
  });
});

describe("pointScatterOnPath: which path a resolved count belongs to", () => {
  // `count` lands on the PRIMITIVE domain, so the resolved column is
  // indexed by primitive index — never by a path's position among the
  // polylines, which is a different number the moment the input holds a
  // primitive that is not a path. See `stubThenTwoRoads`: an all-polyline
  // input makes the two numbers equal and cannot distinguish them.
  for (const skip of ["one-vertex", "poly"] as const) {
    it(`reads each path's count at its PRIMITIVE index, past a leading ${skip} primitive`, async () => {
      const out = await scatter(stubThenTwoRoads(skip), { count: attribute("cnt") });
      // 3 + 9, the counts at primitives 1 and 2. Reading the column at the
      // polyline ORDINAL instead would take cnt[0] and cnt[1] — 100 and 3.
      expect(out.pointCount).toBe(12);
      expect(zOf(out)).toEqual([10, 10, 10, ...Array<number>(9).fill(20)]);
    });

    it(`carries the right primitive's own attributes past a leading ${skip} primitive`, async () => {
      // The same indexing question asked of the carry rather than of the
      // count: each point must hold ITS road's `cnt`, not the one belonging
      // to the primitive that sits at its ordinal.
      const out = await scatter(stubThenTwoRoads(skip), { count: attribute("cnt") });
      expect(col(out, "cnt")).toEqual([3, 3, 3, ...Array<number>(9).fill(9)]);
    });
  }

  it("resolves index() over every primitive, including the ones it skips", async () => {
    // index() on the primitive domain numbers ALL three primitives, so the
    // two roads take 1 and 2 points. By polyline ordinal they would take 0
    // and 1, which is one point in total rather than three.
    const out = await scatter(stubThenTwoRoads(), { count: indexField() });
    expect(out.pointCount).toBe(3);
    expect(zOf(out)).toEqual([10, 20, 20]);
  });

  it("gives a path the same points whether or not a skipped primitive precedes it", async () => {
    // The draw is keyed on the PRIMITIVE index, so the road at primitive 1
    // must be scattered identically whether primitive 0 is a one-vertex
    // stub or a triangle — the two differ in vertex count and in primtype,
    // and in neither case are they a path.
    const a = await scatter(stubThenTwoRoads("one-vertex"), { count: attribute("cnt") });
    const b = await scatter(stubThenTwoRoads("poly"), { count: attribute("cnt") });
    expect(col(b, "station")).toEqual(col(a, "station"));
    expect(col(b, "P")).toEqual(col(a, "P"));
  });
});

describe("pointScatterOnPath: closed and open", () => {
  it("counts the closing segment as part of a closed path's arc range", async () => {
    // The square's four chords are 10 each, so a CLOSED walk is 40 long
    // and an OPEN walk over the same four points is 30. Both facts are
    // read off the arc column alone.
    expect(lengthOf(SQUARE, true)).toBe(40);
    expect(lengthOf(SQUARE, false)).toBe(30);
    const closed = col(await scatter(CLOSED(), { count: 300 }), "station");
    expect(Math.max(...closed)).toBeGreaterThan(30);
    expect(Math.max(...closed)).toBeLessThan(40);
    const open = col(await scatter(createPolyline(SQUARE), { count: 300 }), "station");
    expect(Math.max(...open)).toBeLessThan(30);
  });

  it("places a point on the closing chord where the arc says it is", async () => {
    const out = await scatter(CLOSED(), { count: 300 });
    const arcs = col(out, "station");
    let onClosing = 0;
    let worst = 0;
    for (let i = 0; i < out.pointCount; i++) {
      const want = positionAtArc(SQUARE, true, arcs[i]);
      const got = pointAt(out, i);
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(want[k] - got[k]));
      if (arcs[i] >= 30) {
        onClosing++;
        // The closing chord runs (0,0,10) -> (0,0,0): x and y are pinned.
        expect(Math.abs(got[0])).toBeLessThan(1e-4);
        expect(Math.abs(got[1])).toBeLessThan(1e-4);
      }
    }
    expect(onClosing).toBeGreaterThan(0);
    expect(worst).toBeLessThan(1e-4);
  });

  it("never lands a closed path's point exactly on the seam twice over", async () => {
    // [0, length) is half-open, so arc 40 — which IS arc 0 — is never
    // drawn and the start line is no likelier than anywhere else.
    const arcs = col(await scatter(CLOSED(), { count: 500 }), "station");
    expect(Math.max(...arcs)).toBeLessThan(40);
  });
});

describe("pointScatterOnPath: determinism", () => {
  it("reproduces the same cloud from the same seed", async () => {
    const a = await scatter(OPEN(), { count: 40 });
    const b = await scatter(OPEN(), { count: 40 });
    expect(snapshotGeometry(a)).toEqual(snapshotGeometry(b));
  });

  it("re-rolls on a different seed param", async () => {
    const a = await scatter(OPEN(), { count: 40, seed: 0 });
    const b = await scatter(OPEN(), { count: 40, seed: 1 });
    expect(a.pointCount).toBe(b.pointCount);
    expect(col(a, "station")).not.toEqual(col(b, "station"));
  });

  it("re-rolls on a different node seed", async () => {
    const a = await scatter(OPEN(), { count: 40 }, 1);
    const b = await scatter(OPEN(), { count: 40 }, 2);
    expect(col(a, "station")).not.toEqual(col(b, "station"));
  });

  it("writes the per-point seed as a hash of (seed, primitive, index)", async () => {
    // The chain is stated, not recorded: seed = hashCombine(nodeSeed,
    // params.seed), then channel 1 for the identity column.
    const out = await scatter(twoRoads(), { count: 2, seed: 5 }, 3);
    const seed = hashCombine(3, 5);
    expect(col(out, "seed")).toEqual([
      hashCombine(seed, 0, 0, 1),
      hashCombine(seed, 0, 1, 1),
      hashCombine(seed, 1, 0, 1),
      hashCombine(seed, 1, 1, 1),
    ]);
  });

  it("gives a point the same place whatever ELSE is in the cook", async () => {
    // Primitive 0 of the two-road geometry is the same 10-unit road as
    // this one-road geometry's only primitive, so its points must be
    // byte-identical: the draw is keyed on (seed, primitive, index) and
    // knows nothing about how many paths came along.
    const alone = await scatter(createPolyline([0, 0, 0, 10, 0, 0]), { count: 6 });
    const together = await scatter(twoRoads(), { count: 6 });
    expect(col(alone, "station")).toEqual(col(together, "station").slice(0, 6));
    expect(col(alone, "P")).toEqual(col(together, "P").slice(0, 18));
    expect(col(alone, "seed")).toEqual(col(together, "seed").slice(0, 6));
  });

  it("appends rather than re-rolls when one path's count grows", async () => {
    const few = col(await scatter(twoRoads(), { count: 3 }), "station");
    const many = col(await scatter(twoRoads(), { count: 5 }), "station");
    // Road 0's first three, and road 1's first three, both survive
    // untouched — only the two new ones per road are new.
    expect(many.slice(0, 3)).toEqual(few.slice(0, 3));
    expect(many.slice(5, 8)).toEqual(few.slice(3, 6));
  });

  it("leaves the OTHER path untouched when only one path's count changes", async () => {
    const a = await scatter(twoRoads(), { count: mul(0.4, attribute("length")) }); // 4 and 16
    const b = await scatter(twoRoads(), { count: mul(0.5, attribute("length")) }); // 5 and 20
    expect(a.pointCount).toBe(20);
    expect(b.pointCount).toBe(25);
    // Road 1's first sixteen are the same points in both cooks, even
    // though road 0 grew by one underneath them.
    expect(col(b, "station").slice(5, 21)).toEqual(col(a, "station").slice(4, 20));
  });
});

describe("pointScatterOnPath: degenerate inputs", () => {
  it("refuses a plain point cloud with no topology", async () => {
    const msg = await rejection(scatter(createPointCloud(5), { count: 4 }));
    expect(msg).toContain("pointScatterOnPath: input has no polyline primitives");
  });

  it("refuses a geometry whose only primitive has a single vertex", async () => {
    const geo = createPointCloud(1);
    geo.attrs.point.require("P").setTuple(0, [1, 2, 3]);
    geo.setTopology(Uint32Array.of(0), Uint32Array.of(0), Uint32Array.of(1));
    const msg = await rejection(scatter(geo, { count: 4 }));
    expect(msg).toContain("pointScatterOnPath: input has no polyline primitives");
  });

  it("skips a single-vertex primitive standing beside a real polyline", async () => {
    const geo = createPointCloud(3);
    const P = geo.attrs.point.require("P");
    P.setTuple(0, [0, 0, 0]);
    P.setTuple(1, [10, 0, 0]);
    P.setTuple(2, [50, 0, 0]);
    // Primitive 0 is a two-vertex polyline; primitive 1 has one vertex
    // and is not a path at all.
    geo.setTopology(Uint32Array.of(0, 1, 2), Uint32Array.of(0, 2), Uint32Array.of(2, 1));
    const out = await scatter(geo, { count: 5 });
    expect(out.pointCount).toBe(5);
    for (let i = 0; i < out.pointCount; i++) {
      const p = pointAt(out, i);
      expect(p[0]).toBeGreaterThanOrEqual(0);
      expect(p[0]).toBeLessThan(10);
    }
  });

  it("places a zero-length polyline's whole count at the one position it has", async () => {
    const out = await scatter(createPolyline([5, 1, 2, 5, 1, 2]), { count: 4 });
    expect(out.pointCount).toBe(4);
    expect(col(out, "P")).toEqual([5, 1, 2, 5, 1, 2, 5, 1, 2, 5, 1, 2]);
    expect(col(out, "station")).toEqual([0, 0, 0, 0]);
  });

  it("keeps a zero-length polyline in the total beside a real one", async () => {
    const geo = createPointCloud(4);
    const P = geo.attrs.point.require("P");
    P.setTuple(0, [0, 0, 0]);
    P.setTuple(1, [10, 0, 0]);
    P.setTuple(2, [7, 7, 7]);
    P.setTuple(3, [7, 7, 7]);
    setPolylineTopology(geo, [0, 1, 2, 3], [0, 2], [2, 2]);
    const out = await scatter(geo, { count: 3 });
    // Six points, not three: no path is ever silently missing.
    expect(out.pointCount).toBe(6);
    expect(col(out, "P").slice(9)).toEqual([7, 7, 7, 7, 7, 7, 7, 7, 7]);
  });
});

describe("pointScatterOnPath: the arc column is a reporting slot", () => {
  it("refuses an empty arcAttr", async () => {
    const msg = await rejection(scatter(OPEN(), { arcAttr: "" }));
    expect(msg).toContain('pointScatterOnPath: param "arcAttr" must be a non-empty attribute name');
  });

  it("refuses arcAttr naming P, which it would replace with a scalar", async () => {
    const msg = await rejection(scatter(OPEN(), { arcAttr: "P" }));
    expect(msg).toContain('pointScatterOnPath: arcAttr "P" already exists');
    expect(msg).toContain("f32x3");
    expect(msg).toContain("the geometry pointScatterOnPath builds for itself");
  });

  it("refuses arcAttr naming the u32 identity column", async () => {
    const msg = await rejection(scatter(OPEN(), { arcAttr: "seed" }));
    expect(msg).toContain('pointScatterOnPath: arcAttr "seed" already exists');
    expect(msg).toContain("u32");
  });

  it("writes the arc under whatever name it is given", async () => {
    const out = await scatter(OPEN(), { count: 5, arcAttr: "lapStation" });
    expect(out.attrs.point.names()).toContain("lapStation");
    expect(out.attrs.point.names()).not.toContain("station");
    expect(col(out, "lapStation")).toHaveLength(5);
  });
});
