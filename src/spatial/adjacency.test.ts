import { describe, expect, it } from "vitest";
import { adjacencyFor, buildAdjacency, adjacencyDegree, type Adjacency } from "./adjacency.js";
import type { PositionView } from "./uniformGrid.js";

/** Deterministic PRNG for the property cases (never Math.random). */
function lcg(seed: number): () => number {
  let s = (seed * 1664525 + 1013904223) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Pack positions into an f32 SoA view, optionally with padding per point. */
function view(pts: readonly (readonly number[])[], stride = 3): PositionView {
  const data = new Float32Array(pts.length * stride);
  pts.forEach((p, i) => {
    data[i * stride] = p[0];
    data[i * stride + 1] = p[1];
    data[i * stride + 2] = p[2];
  });
  return { data, stride, count: pts.length };
}

/** A pseudo-random cloud in a box, snapped to f32. */
function cloud(n: number, seed: number, extent = 10): PositionView {
  const rnd = lcg(seed);
  const pts: number[][] = [];
  for (let i = 0; i < n; i++) {
    pts.push([rnd() * extent - extent / 2, rnd() * extent - extent / 2, rnd() * extent - extent / 2]);
  }
  return view(pts);
}

/**
 * Brute-force reference. Reads through the same view with the same
 * expression order as the builder, so any disagreement is a search bug and
 * never a floating-point difference.
 */
function refRows(v: PositionView, radius: number, inclusive = false): number[][] {
  const limit = radius * radius;
  const rows: number[][] = [];
  for (let i = 0; i < v.count; i++) {
    const o = i * v.stride;
    const x = v.data[o];
    const y = v.data[o + 1];
    const z = v.data[o + 2];
    const row: number[] = [];
    for (let j = 0; j < v.count; j++) {
      if (j === i) continue;
      const q = j * v.stride;
      const dx = v.data[q] - x;
      const dy = v.data[q + 1] - y;
      const dz = v.data[q + 2] - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (inclusive ? d2 <= limit : d2 < limit) row.push(j);
    }
    rows.push(row);
  }
  return rows;
}

/** Rows of an adjacency as plain arrays. */
function rowsOf(adj: Adjacency): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < adj.count; i++) {
    rows.push(Array.from(adj.neighbors.subarray(adj.offsets[i], adj.offsets[i + 1])));
  }
  return rows;
}

describe("Adjacency CSR shape", () => {
  it("offsets are monotone, start at 0, and end at the neighbor count", () => {
    const v = cloud(200, 11);
    const adj = buildAdjacency(v, 1.5);
    expect(adj.count).toBe(200);
    expect(adj.radius).toBe(1.5);
    expect(adj.offsets.length).toBe(201);
    expect(adj.offsets[0]).toBe(0);
    for (let i = 0; i < adj.count; i++) {
      expect(adj.offsets[i + 1]).toBeGreaterThanOrEqual(adj.offsets[i]);
    }
    expect(adj.offsets[adj.count]).toBe(adj.neighbors.length);
    expect(adjacencyDegree(adj, 3)).toBe(adj.offsets[4] - adj.offsets[3]);
  });

  it("rows are ascending point indices and never contain the point itself", () => {
    const adj = buildAdjacency(cloud(150, 7), 2);
    let total = 0;
    for (const [i, row] of rowsOf(adj).entries()) {
      expect(row).not.toContain(i);
      expect([...row].sort((a, b) => a - b)).toEqual(row);
      expect(new Set(row).size).toBe(row.length);
      total += row.length;
    }
    expect(total).toBe(adj.neighbors.length);
    expect(total).toBeGreaterThan(0); // the case would be vacuous otherwise
  });

  it("the relation is symmetric: j in row(i) exactly when i in row(j)", () => {
    const adj = buildAdjacency(cloud(300, 23), 1.2);
    const rows = rowsOf(adj);
    let checked = 0;
    for (const [i, row] of rows.entries()) {
      for (const j of row) {
        expect(rows[j], `row ${j} should hold ${i}`).toContain(i);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("matches a brute-force scan at several radii and point counts", () => {
    for (const seed of [1, 2, 3]) {
      for (const radius of [0.4, 1, 2.5, 20]) {
        const v = cloud(120, seed);
        expect(rowsOf(buildAdjacency(v, radius))).toEqual(refRows(v, radius));
      }
    }
  });

  it("reads a padded view through its stride", () => {
    const v = view(
      [
        [0, 0, 0],
        [1, 0, 0],
        [5, 0, 0],
      ],
      6,
    );
    expect(rowsOf(buildAdjacency(v, 2))).toEqual([[1], [0], []]);
  });

  it("an empty cloud and a zero radius both build an empty relation", () => {
    const empty = buildAdjacency(view([]), 1);
    expect(empty.count).toBe(0);
    expect(Array.from(empty.offsets)).toEqual([0]);
    expect(empty.neighbors.length).toBe(0);
    const none = buildAdjacency(cloud(20, 5), 0);
    expect(none.neighbors.length).toBe(0);
    expect(none.offsets.length).toBe(21);
  });

  it("a non-finite point has no neighbors and is nobody's neighbor", () => {
    const v = view([
      [0, 0, 0],
      [0.5, 0, 0],
      [NaN, 0, 0],
      [Infinity, 0, 0],
    ]);
    const rows = rowsOf(buildAdjacency(v, 2));
    expect(rows[2]).toEqual([]);
    expect(rows[3]).toEqual([]);
    expect(rows[0]).toEqual([1]);
    expect(rows[1]).toEqual([0]);
  });

  it("refuses a radius that is not a finite number >= 0, naming the caller", () => {
    for (const bad of [-1, NaN, Number.POSITIVE_INFINITY]) {
      expect(() => buildAdjacency(cloud(4, 1), bad, { who: "connectPoints" })).toThrow(
        /^connectPoints: adjacency radius must be a finite number >= 0/,
      );
    }
  });
});

describe("Adjacency membership is STRICT", () => {
  // The whole point of the strict predicate: a pair at exactly the radius
  // is NOT adjacent, so a neighbour lying exactly on the excluded face of a
  // half-open window is not an edge of anything that window owns.
  it("excludes a pair at exactly the radius and includes one just inside", () => {
    const exact = view([
      [0, 0, 0],
      [2, 0, 0],
    ]);
    expect(rowsOf(buildAdjacency(exact, 2))).toEqual([[], []]);
    // The same pair one f32 step closer IS adjacent, so the exclusion above
    // is the boundary rule and not a search failure.
    const just = view([
      [0, 0, 0],
      [Math.fround(2 - 2 ** -20), 0, 0],
    ]);
    expect(rowsOf(buildAdjacency(just, 2))).toEqual([[1], [0]]);
  });

  it("differs from the inclusive predicate exactly on the boundary shell", () => {
    // A lattice at spacing 1 queried at radius 1: every axis neighbour sits
    // EXACTLY on the boundary, so inclusive keeps 4 per interior point and
    // strict keeps none. If these ever agree the case has gone vacuous.
    const pts: number[][] = [];
    for (let x = 0; x < 4; x++) for (let z = 0; z < 4; z++) pts.push([x, 0, z]);
    const v = view(pts);
    const strict = buildAdjacency(v, 1);
    expect(strict.neighbors.length).toBe(0);
    expect(refRows(v, 1, true).flat().length).toBe(48); // 24 unordered pairs
  });

  it("a coincident pair is adjacent at any positive radius", () => {
    const v = view([
      [3, 3, 3],
      [3, 3, 3],
    ]);
    expect(rowsOf(buildAdjacency(v, 1e-30))).toEqual([[1], [0]]);
  });
});

describe("Adjacency cache", () => {
  it("returns the identical structure for the same buffer, count, stride and radius", () => {
    const v = cloud(50, 3);
    const a = adjacencyFor(v, 1);
    // A second PositionView object over the SAME buffer is the same question.
    const b = adjacencyFor({ data: v.data, stride: v.stride, count: v.count }, 1);
    expect(b).toBe(a);
  });

  it("does NOT key on cellSize — the same question shares one answer", () => {
    const v = cloud(80, 9);
    const a = adjacencyFor(v, 1.5, { cellSize: 1.5 });
    const b = adjacencyFor(v, 1.5, { cellSize: 0.25 });
    const c = adjacencyFor(v, 1.5, { cellSize: 40 });
    expect(b).toBe(a);
    expect(c).toBe(a);
    // And the shared answer is not an accident of caching: built fresh at
    // each cell size, the three relations are identical. queryRadius returns
    // the same set at any positive cell size, which is exactly why cellSize
    // must not enter the key.
    const rows = rowsOf(buildAdjacency(v, 1.5, { cellSize: 1.5 }));
    expect(rowsOf(buildAdjacency(v, 1.5, { cellSize: 0.25 }))).toEqual(rows);
    expect(rowsOf(buildAdjacency(v, 1.5, { cellSize: 40 }))).toEqual(rows);
  });

  it("keys on radius, count, stride and buffer identity", () => {
    const v = cloud(60, 13);
    const base = adjacencyFor(v, 1);
    expect(adjacencyFor(v, 2)).not.toBe(base);
    expect(adjacencyFor({ data: v.data, stride: v.stride, count: 30 }, 1)).not.toBe(base);
    expect(adjacencyFor({ data: v.data, stride: 3, count: 20 }, 1)).not.toBe(
      adjacencyFor({ data: v.data, stride: 6, count: 20 }, 1),
    );
    // A different buffer holding the same numbers is a different cloud as
    // far as the cache is concerned — the identity check is the buffer.
    const copy: PositionView = { data: Float32Array.from(v.data), stride: v.stride, count: v.count };
    expect(adjacencyFor(copy, 1)).not.toBe(base);
    expect(rowsOf(adjacencyFor(copy, 1))).toEqual(rowsOf(base));
  });

  it("bounds what one buffer can pin: an old radius rebuilds rather than accumulating", () => {
    const v = cloud(40, 17);
    const first = adjacencyFor(v, 1);
    for (let k = 2; k <= 64; k++) adjacencyFor(v, k / 8);
    const again = adjacencyFor(v, 1);
    expect(again).not.toBe(first); // evicted
    expect(rowsOf(again)).toEqual(rowsOf(first)); // and rebuilt identically
  });
});

describe("Adjacency edge limit", () => {
  it("reports the measured numbers and the way out, before allocating the whole relation", () => {
    // 200 coincident-ish points inside one radius: 19,900 pairs against a
    // limit of 100.
    const v = cloud(200, 31, 0.5);
    let message = "";
    try {
      buildAdjacency(v, 10, { maxEdges: 100, who: "connectPoints", hint: "Lower `radius`." });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^connectPoints: radius 10 connects more than 100 pairs over 200 points/);
    expect(message).toMatch(/after \d+ of them there are already \d+ pairs/);
    expect(message).toMatch(/mean degree \d+\.\d, projecting about \d+ in total/);
    expect(message).toMatch(/Lower `radius`\.$/);
  });

  it("re-checks a cached relation against the CALLER's limit", () => {
    const v = cloud(120, 37, 1);
    const built = adjacencyFor(v, 10); // unbounded: caches a dense relation
    expect(built.neighbors.length).toBeGreaterThan(200);
    expect(() => adjacencyFor(v, 10, { maxEdges: 100, who: "connectPoints" })).toThrow(
      /connectPoints: radius 10 connects more than 100 pairs/,
    );
  });

  it("allows exactly the limit", () => {
    const v = view([
      [0, 0, 0],
      [0.1, 0, 0],
      [0.2, 0, 0],
    ]);
    expect(() => buildAdjacency(v, 1, { maxEdges: 3 })).not.toThrow();
    expect(() => buildAdjacency(v, 1, { maxEdges: 2 })).toThrow(/more than 2 pairs/);
  });
});
