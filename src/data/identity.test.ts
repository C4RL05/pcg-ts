import { describe, expect, it } from "vitest";
import { createPointCloud, type Geometry } from "./index.js";
import { pointIdentities, primitiveIdentities } from "./identity.js";

/**
 * A cloud at the given positions, each with its own `seed`, so no two points
 * collide by accident. Seeds come from the POSITION and not from the array
 * index: an index-derived seed would change every identity under a reorder
 * and make the permutation cases below test nothing.
 */
function cloud(points: readonly (readonly [number, number, number])[]): Geometry {
  const geo = createPointCloud(points.length);
  const P = geo.attrs.point.require("P");
  const seed = geo.attrs.point.require("seed");
  points.forEach((p, i) => {
    P.setTuple(i, [p[0], p[1], p[2]]);
    seed.set(i, (Math.imul(p[0] * 1000 + 7, 2654435761) ^ (p[2] * 1000 + 13)) >>> 0);
  });
  return geo;
}

/** Topology from a list of primitives, each named by its point indices. */
function withPrimitives(geo: Geometry, prims: readonly (readonly number[])[]): Geometry {
  const flat: number[] = [];
  const start: number[] = [];
  const count: number[] = [];
  for (const prim of prims) {
    start.push(flat.length);
    count.push(prim.length);
    flat.push(...prim);
  }
  geo.setTopology(Uint32Array.from(flat), Uint32Array.from(start), Uint32Array.from(count));
  return geo;
}

describe("primitiveIdentities", () => {
  it("gives an edge and its reverse the same identity", () => {
    // The case the order-independent fold exists for. connectPoints emits
    // each edge's lower-keyed endpoint first, but nothing downstream is
    // obliged to, and A->B and B->A are one edge.
    const geo = withPrimitives(
      cloud([
        [0, 0, 0],
        [1, 0, 0],
      ]),
      [
        [0, 1],
        [1, 0],
      ],
    );
    const ident = primitiveIdentities(geo, "test");
    expect(ident[0]).toBe(ident[1]);
  });

  it("names a primitive by its OWN points, so it survives a reordering", () => {
    const points = cloud([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
    ]);
    const straight = primitiveIdentities(
      withPrimitives(points, [
        [0, 1],
        [1, 2],
        [2, 3],
      ]),
      "test",
    );
    // Same points, same slots, primitives emitted back to front.
    const reversed = primitiveIdentities(
      withPrimitives(points, [
        [2, 3],
        [1, 2],
        [0, 1],
      ]),
      "test",
    );
    expect(Array.from(reversed)).toEqual(Array.from(straight).reverse());
    expect(new Set(straight).size).toBe(3);
  });

  it("moves when one of its points moves, and only then", () => {
    // Identity IS position bits plus `seed`, one level down, so a primitive
    // inherits exactly that: the two edges touching the moved point change,
    // the third does not.
    const before = primitiveIdentities(
      withPrimitives(
        cloud([
          [0, 0, 0],
          [1, 0, 0],
          [2, 0, 0],
          [3, 0, 0],
        ]),
        [
          [0, 1],
          [1, 2],
          [2, 3],
        ],
      ),
      "test",
    );
    const moved = withPrimitives(
      cloud([
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [3, 0, 0],
      ]),
      [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    );
    moved.attrs.point.require("P").set(1, 1.5, 0);
    const after = primitiveIdentities(moved, "test");
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[2]).toBe(before[2]);
  });

  it("collides two primitives over the same point SET in different vertex order", () => {
    // The documented limitation, pinned rather than left implicit: this
    // identity is the multiset of a primitive's points, so a quad ABCD and
    // a quad ABDC — genuinely different polygons — are one primitive here.
    // The stronger answer is a canonical cyclic sequence, deferred until a
    // caller needs it; see the note on primitiveIdentities.
    const geo = withPrimitives(
      cloud([
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 1],
        [0, 0, 1],
      ]),
      [
        [0, 1, 2, 3],
        [0, 1, 3, 2],
      ],
    );
    const ident = primitiveIdentities(geo, "test");
    expect(ident[0]).toBe(ident[1]);
  });

  it("does not let coincident points CANCEL, which is why the fold is not XOR", () => {
    // snapToGrid manufactures coincident points deliberately, and two
    // coincident points are the same point as far as identity is concerned.
    // Under an XOR fold every primitive below would digest to 0 and all
    // three would be one primitive.
    const geo = withPrimitives(
      cloud([
        [0, 0, 0],
        [0, 0, 0],
        [5, 0, 0],
        [5, 0, 0],
      ]),
      [
        [0, 1],
        [2, 3],
        [0, 1, 2, 3],
      ],
    );
    const p = pointIdentities(geo, "test");
    // The premise: the pairs really are coincident, so they really are the
    // same point and their identities really would cancel.
    expect(p[0]).toBe(p[1]);
    expect(p[2]).toBe(p[3]);
    const ident = primitiveIdentities(geo, "test");
    expect(new Set(ident).size).toBe(3);
    for (const h of ident) expect(h).not.toBe(0);
  });

  it("distinguishes a longer primitive that agrees on a prefix", () => {
    // The count seeds the fold, so [A, B] and [A, B, C] cannot collide even
    // when the sorted runs agree as far as they go.
    const geo = withPrimitives(
      cloud([
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ]),
      [
        [0, 1],
        [0, 1, 2],
      ],
    );
    const ident = primitiveIdentities(geo, "test");
    expect(ident[0]).not.toBe(ident[1]);
  });

  it("is empty for a geometry with no primitives", () => {
    expect(primitiveIdentities(createPointCloud(4), "test").length).toBe(0);
  });
});
