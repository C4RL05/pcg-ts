/**
 * Order-insensitive, float-exact comparison of EDGE SETS, keyed on the
 * two endpoints' full point records.
 *
 * `pointMultiset.ts` answers "are these the same points?". Once
 * `connectPoints` ships, a partitioned cook has a second thing to
 * conserve that the point comparator cannot see at all: a set of
 * 2-vertex `polyline` primitives over shared points. Nothing in a point
 * multiset changes when every edge disappears.
 *
 * WHAT AN EDGE'S NAME CAN AND CANNOT BE.
 *
 * - NOT the primitive index. It is a rank inside one cook's array, and
 *   two windows over the same world hold different numbers of edges, so
 *   the same road is primitive 12 in one and primitive 3 in the other.
 * - NOT the endpoints' POINT indices either, for the same reason one
 *   node earlier: a halo adds points, a filter removes them, and every
 *   index downstream shifts. `connectPoints` stores exactly that — a
 *   pair of point indices — which is why an edge has no usable stored
 *   name and one has to be derived.
 * - The endpoints' POINT KEYS, which is what `pointMultiset.ts` already
 *   builds: identity (position bits + `seed`) plus a float-exact
 *   rendering of every point attribute. An edge is named by the two
 *   things it joins, so it keeps its name under any window that holds
 *   both of them, and it changes its name the moment either endpoint
 *   moves or measures differently. The primitive's own attributes
 *   (`primtype`, and a `lengthAttr` when one is asked for) join the key
 *   for the same reason the point row does: identity groups, the full
 *   record decides.
 *
 * ORIENTATION IS DELIBERATELY NOT IN THE KEY. `connectPoints` writes the
 * lower-keyed endpoint first, and a caller's ownership clip reads that
 * first vertex — so orientation is not a value to compare, it is the
 * thing the ownership rule is a function OF. Canonicalizing the pair
 * (the two endpoint keys sorted, which is a fixed rule over two strings
 * and not a rank over a population) keeps the comparator a set
 * comparison, and lets an orientation bug surface where it actually
 * bites: as a duplicate or a gap in the partition report. Where the
 * emitted orientation itself is the claim — permutation equivariance —
 * use {@link orientedEdgeKeys}.
 */
import type { Geometry } from "../../src/data/index.js";
import { attributeRows, keyMultisetDiff, pointKeys } from "./pointMultiset.js";

/** One emitted edge, with everything a suite needs to judge it. */
export interface EdgeRecord {
  /** Point index of the emitted FIRST vertex — what an ownership clip reads. */
  readonly firstPoint: number;
  /** Point index of the emitted second vertex. */
  readonly secondPoint: number;
  /** Full point key of the first vertex's point. */
  readonly first: string;
  /** Full point key of the second vertex's point. */
  readonly second: string;
  /** Float-exact rendering of this edge's primitive attributes. */
  readonly prim: string;
  /** Canonical, orientation-insensitive name: both endpoints plus `prim`. */
  readonly key: string;
}

/**
 * Every edge of `geo`, in emission order. Refuses anything that is not an
 * edge network: a primitive with any vertex count but 2 means the input
 * came from somewhere other than `connectPoints`, and silently skipping
 * it would let a suite compare two empty sets and pass.
 */
export function edgeRecords(geo: Geometry, who: string): EdgeRecord[] {
  const pts = pointKeys(geo, who);
  const prims = attributeRows(geo.attrs.primitive);
  const out: EdgeRecord[] = [];
  for (let p = 0; p < geo.primitiveCount; p++) {
    const count = geo.primVertexCount[p];
    if (count !== 2) {
      throw new Error(
        `${who}: primitive ${p} has ${count} vertices, but an edge set is 2-vertex polylines only; ` +
          `something between connectPoints and here rebuilt the topology (a point-removing filter drops it outright)`,
      );
    }
    const start = geo.primVertexStart[p];
    const a = geo.vertexToPoint[start];
    const b = geo.vertexToPoint[start + 1];
    const first = pts[a];
    const second = pts[b];
    const ends = first <= second ? `${first} — ${second}` : `${second} — ${first}`;
    out.push({
      firstPoint: a,
      secondPoint: b,
      first,
      second,
      prim: prims[p],
      key: `${ends} :: ${prims[p]}`,
    });
  }
  return out;
}

/** The canonical name of every edge, in emission order. */
export function edgeKeys(geo: Geometry, who: string): string[] {
  return edgeRecords(geo, who).map((e) => e.key);
}

/**
 * Every edge named WITH its emitted orientation, in emission order. The
 * strongest thing a cook can be asked to reproduce: same edges, same
 * first vertex on each, same sequence.
 */
export function orientedEdgeKeys(geo: Geometry, who: string): string[] {
  return edgeRecords(geo, who).map((e) => `${e.first} -> ${e.second} :: ${e.prim}`);
}

/**
 * Whether two cooks hold the same edges between the same points with the
 * same per-edge values, in any order. Null when they agree, else the
 * first difference.
 */
export function edgeMultisetDiff(
  a: Geometry,
  b: Geometry,
  labelA: string,
  labelB: string,
): string | null {
  return keyMultisetDiff(edgeKeys(a, labelA), edgeKeys(b, labelB), labelA, labelB, "edges");
}
