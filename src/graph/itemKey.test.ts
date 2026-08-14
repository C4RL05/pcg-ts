/**
 * Item identity: the piece `forEach` seeds every iteration on, and the one
 * piece of that feature that cannot be changed later without re-rolling
 * every graph that uses it.
 *
 * The property under test throughout is the one `src/data/identity.ts`
 * establishes for points and this raises to items: a name that belongs to
 * the CONTENT, so no reordering — of the collection, or of the points
 * inside one item — moves it.
 */
import { describe, expect, it } from "vitest";
import { createPointCloud, type Geometry } from "../data/index.js";
import { hashCombine } from "../random/hash.js";
import { makeGeometryItem, makeInstancesItem, makeValueItem } from "./data.js";
import { makeDeviceInstancesItem } from "./data.js";
import { itemKey, pointIdentityColumn, pointItemKey } from "./itemKey.js";

function cloudAt(positions: number[][], seeds?: number[]): Geometry {
  const geo = createPointCloud(positions.length);
  const P = geo.attrs.point.require("P");
  positions.forEach((p, i) => P.setTuple(i, p));
  if (seeds !== undefined) {
    // `createPointCloud` already carries the standard `seed` column.
    const seed = geo.attrs.point.require("seed");
    seeds.forEach((s, i) => {
      seed.data[i] = s;
    });
  }
  return geo;
}

const A = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
];

describe("itemKey — geometry", () => {
  it("is a function of content, not of the item's rev", () => {
    // Two separately-minted items over the same points. Their revs differ
    // by construction (nextRev is monotonic), so a rev-keyed identity
    // would separate them; a content-keyed one must not.
    const first = makeGeometryItem(cloudAt(A));
    const second = makeGeometryItem(cloudAt(A));
    expect(first.rev).not.toBe(second.rev);
    expect(itemKey(first, "t")).toBe(itemKey(second, "t"));
  });

  it("ignores the order of the points inside the item", () => {
    const straight = makeGeometryItem(cloudAt(A));
    const shuffled = makeGeometryItem(cloudAt([A[2], A[0], A[1]]));
    expect(itemKey(shuffled, "t")).toBe(itemKey(straight, "t"));
  });

  it("separates items that differ in one coordinate", () => {
    const base = makeGeometryItem(cloudAt(A));
    const moved = makeGeometryItem(cloudAt([A[0], A[1], [7, 8, 9.5]]));
    expect(itemKey(moved, "t")).not.toBe(itemKey(base, "t"));
  });

  it("counts duplicates rather than cancelling them", () => {
    // The reason the fold is a sequence hash over sorted identities and
    // not an XOR: XOR of a pair of equal identities is zero, so a cloud of
    // two coincident points would key like an empty one.
    const one = makeGeometryItem(cloudAt([[0, 0, 0]]));
    const two = makeGeometryItem(
      cloudAt([
        [0, 0, 0],
        [0, 0, 0],
      ]),
    );
    const four = makeGeometryItem(
      cloudAt([
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]),
    );
    expect(new Set([itemKey(one, "t"), itemKey(two, "t"), itemKey(four, "t")]).size).toBe(3);
  });

  it("reads the seed attribute, so same-position points stay distinguishable", () => {
    const zero = makeGeometryItem(cloudAt(A, [0, 0, 0]));
    const seeded = makeGeometryItem(cloudAt(A, [1, 2, 3]));
    expect(itemKey(seeded, "t")).not.toBe(itemKey(zero, "t"));
  });

  it("keys an empty geometry, and apart from a one-point one", () => {
    const empty = makeGeometryItem(createPointCloud(0));
    const single = makeGeometryItem(cloudAt([[0, 0, 0]]));
    expect(() => itemKey(empty, "t")).not.toThrow();
    expect(itemKey(empty, "t")).not.toBe(itemKey(single, "t"));
  });
});

describe("itemKey — tags", () => {
  it("participates, so partitionByAttribute's group value reaches the key", () => {
    const bare = makeGeometryItem(cloudAt(A));
    const pine = makeGeometryItem(cloudAt(A), ["species=pine"]);
    const oak = makeGeometryItem(cloudAt(A), ["species=oak"]);
    expect(itemKey(pine, "t")).not.toBe(itemKey(bare, "t"));
    expect(itemKey(pine, "t")).not.toBe(itemKey(oak, "t"));
  });

  it("ignores the order tags were added in", () => {
    const forward = makeGeometryItem(cloudAt(A), ["a", "b", "c"]);
    const backward = makeGeometryItem(cloudAt(A), ["c", "b", "a"]);
    expect(itemKey(backward, "t")).toBe(itemKey(forward, "t"));
  });
});

describe("itemKey — value items", () => {
  it("separates the kinds, so a value and a geometry never collide by luck", () => {
    const value = makeValueItem(0);
    const geometry = makeGeometryItem(createPointCloud(0));
    expect(itemKey(value, "t")).not.toBe(itemKey(geometry, "t"));
  });

  it("keys numbers through their decimal form, so sub-integer values separate", () => {
    // hashCombine truncates toward zero, so a numeric fold would collide
    // every value in (-1, 1) onto the same key. This is the regression.
    const keys = [0, 0.1, 0.2, 0.5, 0.9, -0.5].map((v) => itemKey(makeValueItem(v), "t"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("separates large integers that differ beyond f32 precision", () => {
    const a = itemKey(makeValueItem(2 ** 40 + 1), "t");
    const b = itemKey(makeValueItem(2 ** 40 + 2), "t");
    expect(a).not.toBe(b);
  });

  it("keys strings, booleans and arrays apart from each other", () => {
    const keys = [
      itemKey(makeValueItem("1"), "t"),
      itemKey(makeValueItem(1), "t"),
      itemKey(makeValueItem(true), "t"),
      itemKey(makeValueItem([1]), "t"),
      itemKey(makeValueItem([1, 2]), "t"),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is stable across two items carrying an equal array", () => {
    const first = makeValueItem([1, 2, 3]);
    const second = makeValueItem([1, 2, 3]);
    expect(itemKey(second, "t")).toBe(itemKey(first, "t"));
  });
});

describe("itemKey — instances items", () => {
  it("refuses a CPU instances item, naming the caller and the fix", () => {
    const item = makeInstancesItem([{ assetId: "tree", count: 1, transforms: new Float32Array(16) }]);
    expect(() => itemKey(item, "forEach \"wraps\"")).toThrow(/forEach "wraps"/);
    expect(() => itemKey(item, "t")).toThrow(/terminal render payload/);
    expect(() => itemKey(item, "t")).toThrow(/spawn inside the body/);
  });

  it("says so when the item is device-resident, without touching batches", () => {
    // `batches` is a throwing getter on a device item, so an identity
    // function that reached for it would report the wrong problem.
    const item = makeDeviceInstancesItem([]);
    expect(() => itemKey(item, "t")).toThrow(/device-resident/);
    expect(() => itemKey(item, "t")).not.toThrow(/does not exist/);
  });
});

describe("pointItemKey", () => {
  it("keys each point of a cloud apart", () => {
    const item = makeGeometryItem(cloudAt(A));
    const ids = pointIdentityColumn(item, "t");
    const keys = [...ids].map((id) => pointItemKey(id, item.tags));
    expect(new Set(keys).size).toBe(A.length);
  });

  it("is salted apart from the item key of the same one-point geometry", () => {
    const item = makeGeometryItem(cloudAt([[1, 2, 3]]));
    const ids = pointIdentityColumn(item, "t");
    expect(pointItemKey(ids[0], item.tags)).not.toBe(itemKey(item, "t"));
  });

  it("folds the item's tags, so two identical clouds under different tags differ", () => {
    const pine = makeGeometryItem(cloudAt(A), ["species=pine"]);
    const oak = makeGeometryItem(cloudAt(A), ["species=oak"]);
    const id = pointIdentityColumn(pine, "t")[0];
    expect(pointItemKey(id, pine.tags)).not.toBe(pointItemKey(id, oak.tags));
  });

  it("gives coincident points one key, which is the documented consequence", () => {
    // Same statement identity.ts makes for points, one level up: two
    // points agreeing on position and seed ARE the same point here.
    const item = makeGeometryItem(
      cloudAt([
        [0, 0, 0],
        [0, 0, 0],
      ]),
    );
    const ids = pointIdentityColumn(item, "t");
    expect(pointItemKey(ids[1], item.tags)).toBe(pointItemKey(ids[0], item.tags));
  });
});

describe("itemKey — seeding shape", () => {
  it("is combined with the node seed rather than used raw", () => {
    // Not a property of itemKey itself, but the contract its callers
    // depend on: two nodes iterating the same collection must not draw
    // the same randomness.
    const item = makeGeometryItem(cloudAt(A));
    const key = itemKey(item, "t");
    expect(hashCombine(111, key)).not.toBe(hashCombine(222, key));
  });
});
