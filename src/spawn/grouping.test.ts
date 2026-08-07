/**
 * The asset-grouping ordering spec — the single normative source both
 * the CPU spawner and the device-resident run consume. Every case here
 * is a rule the device path inherits verbatim, so a regression here is a
 * regression in device batch order too.
 *
 * `buildInstanceBatches`' own behavioural spec stays pinned in
 * instances.test.ts; this file pins the grouping primitive underneath it,
 * including the cases a matrix-level test cannot see (the permutation
 * itself, out-of-range table indices, tuple sizes above one).
 */
import { describe, expect, it } from "vitest";
import { Geometry, createPointCloud } from "../data/index.js";
import { buildInstanceBatches } from "./instances.js";
import { groupPointsByAsset, type AssetGrouping } from "./grouping.js";

/** Point cloud with a string "asset" attribute set from `ids`. */
function tagged(ids: readonly string[], tupleSize = 1): Geometry {
  const geo = createPointCloud(ids.length);
  const attr = geo.attrs.point.add("asset", "string", tupleSize, "");
  const P = geo.attrs.point.require("P");
  ids.forEach((id, i) => {
    attr.setString(i, id);
    P.setTuple(i, [i, 0, 0]);
  });
  return geo;
}

/** The grouping as plain data, for readable assertions. */
function shape(g: AssetGrouping): {
  order: readonly string[];
  counts: number[];
  offsets: number[];
  perm: number[];
} {
  return {
    order: g.order,
    counts: Array.from(g.counts),
    offsets: Array.from(g.offsets),
    perm: Array.from(g.perm),
  };
}

/** Batch j's point indices, read out of the permutation. */
function members(g: AssetGrouping, j: number): number[] {
  return Array.from(g.perm.subarray(g.offsets[j], g.offsets[j] + g.counts[j]));
}

const BY_ASSET = { defaultAssetId: "d", assetAttr: "asset" } as const;

describe("groupPointsByAsset: batch order", () => {
  it("orders batches by ascending FIRST-OCCURRENCE point index", () => {
    // Not lexicographic ("a" < "b"), not intern order (b interned first
    // here, but see the next case where it is not).
    const g = groupPointsByAsset(tagged(["b", "a", "b"]), BY_ASSET);
    expect(shape(g)).toEqual({
      order: ["b", "a"],
      counts: [2, 1],
      offsets: [0, 2],
      perm: [0, 2, 1],
    });
  });

  it("ignores string-table order: a table interned in reverse gives the same batches", () => {
    // Intern "z" and "y" into the table BEFORE any point uses them, in
    // the opposite order to their first occurrence. A table-index-keyed
    // implementation would emit ["y", "z"] here; the spec says ["z","y"].
    const geo = createPointCloud(4);
    const attr = geo.attrs.point.add("asset", "string", 1, "");
    attr.internString("y");
    attr.internString("z");
    expect(attr.stringTable).toEqual(["", "y", "z"]);
    ["z", "y", "z", "y"].forEach((id, i) => attr.setString(i, id));

    const g = groupPointsByAsset(geo, BY_ASSET);
    expect(g.order).toEqual(["z", "y"]);
    expect(members(g, 0)).toEqual([0, 2]);
    expect(members(g, 1)).toEqual([1, 3]);
  });

  it("keeps within-batch instances in ascending point index", () => {
    const g = groupPointsByAsset(tagged(["a", "b", "a", "b", "a"]), BY_ASSET);
    expect(g.order).toEqual(["a", "b"]);
    expect(members(g, 0)).toEqual([0, 2, 4]);
    expect(members(g, 1)).toEqual([1, 3]);
  });

  it("emits a permutation: every point index appears exactly once", () => {
    const ids = Array.from({ length: 97 }, (_, i) => `asset${i % 7}`);
    const g = groupPointsByAsset(tagged(ids), BY_ASSET);
    expect(g.order).toHaveLength(7);
    expect(Array.from(g.counts).reduce((a, b) => a + b, 0)).toBe(97);
    const seen = new Uint8Array(97);
    for (const i of g.perm) seen[i]++;
    expect(Array.from(seen).every((c) => c === 1)).toBe(true);
    // offsets are the exclusive prefix sum of counts, not an alias of it.
    let acc = 0;
    for (let j = 0; j < g.order.length; j++) {
      expect(g.offsets[j]).toBe(acc);
      acc += g.counts[j];
    }
  });
});

describe("groupPointsByAsset: key resolution", () => {
  it('merges "" into defaultAssetId', () => {
    const g = groupPointsByAsset(tagged(["x", "", "x"]), BY_ASSET);
    expect(g.order).toEqual(["x", "d"]);
    expect(members(g, 1)).toEqual([1]);
  });

  it('merges "" with a LITERAL entry equal to defaultAssetId into one batch', () => {
    // Two distinct string-table indices resolving to the same asset id.
    // The batch's position is the first occurrence of EITHER of them.
    const g = groupPointsByAsset(tagged(["", "q", "d", "", "d"]), BY_ASSET);
    expect(g.order).toEqual(["d", "q"]);
    expect(members(g, 0)).toEqual([0, 2, 3, 4]);
    expect(members(g, 1)).toEqual([1]);
  });

  it("folds every out-of-range table index into defaultAssetId, not into new assets", () => {
    const geo = tagged(["p", "p", "p", "p"]);
    const attr = geo.attrs.point.require("asset");
    // Two different indices past the end of the table: getString reads
    // both as "", so both resolve to defaultAssetId and share ONE batch.
    const past = attr.stringTable.length;
    attr.data[1] = past;
    attr.data[3] = past + 5;
    const g = groupPointsByAsset(geo, BY_ASSET);
    expect(g.order).toEqual(["p", "d"]);
    expect(members(g, 0)).toEqual([0, 2]);
    expect(members(g, 1)).toEqual([1, 3]);
  });

  it("reads component 0 only when the key attribute has tupleSize > 1", () => {
    const geo = tagged(["a", "b", "a"], 2);
    const attr = geo.attrs.point.require("asset");
    // Component 1 says something else entirely; grouping must not see it.
    attr.setString(0, "zzz", 1);
    attr.setString(1, "zzz", 1);
    attr.setString(2, "yyy", 1);
    const g = groupPointsByAsset(geo, BY_ASSET);
    expect(g.order).toEqual(["a", "b"]);
    expect(members(g, 0)).toEqual([0, 2]);
  });
});

describe("groupPointsByAsset: edge cases", () => {
  it("zero points produce zero batches — in constant mode too", () => {
    expect(shape(groupPointsByAsset(createPointCloud(0), { defaultAssetId: "a" }))).toEqual({
      order: [],
      counts: [],
      offsets: [],
      perm: [],
    });
    expect(groupPointsByAsset(tagged([]), BY_ASSET).order).toEqual([]);
  });

  it("an asset in the string table but on no point produces no batch", () => {
    const geo = tagged(["a", "a"]);
    const attr = geo.attrs.point.require("asset");
    attr.internString("ghost");
    expect(attr.stringTable).toContain("ghost");
    expect(groupPointsByAsset(geo, BY_ASSET).order).toEqual(["a"]);
  });

  it("constant mode is one batch in point order, with the identity permutation", () => {
    const g = groupPointsByAsset(tagged(["b", "a", "b"]), { defaultAssetId: "solo" });
    expect(shape(g)).toEqual({
      order: ["solo"],
      counts: [3],
      offsets: [0],
      perm: [0, 1, 2],
    });
    // An empty assetAttr means the same as none at all.
    expect(shape(groupPointsByAsset(tagged(["b", "a"]), { defaultAssetId: "s", assetAttr: "" }))).toEqual(
      shape(groupPointsByAsset(tagged(["b", "a"]), { defaultAssetId: "s" })),
    );
  });

  it("all points empty-string is ONE batch named defaultAssetId", () => {
    const g = groupPointsByAsset(tagged(["", "", ""]), BY_ASSET);
    expect(shape(g)).toEqual({ order: ["d"], counts: [3], offsets: [0], perm: [0, 1, 2] });
  });

  it("is pure and repeatable: identical output, input untouched", () => {
    const geo = tagged(["b", "a", "b", "", "c"]);
    const before = Array.from(geo.attrs.point.require("asset").data);
    const first = shape(groupPointsByAsset(geo, BY_ASSET));
    const second = shape(groupPointsByAsset(geo, BY_ASSET));
    expect(second).toEqual(first);
    expect(Array.from(geo.attrs.point.require("asset").data)).toEqual(before);
  });
});

describe("groupPointsByAsset: rejected inputs", () => {
  it("names the missing attribute and lists the string attributes present", () => {
    const geo = tagged(["a"]);
    expect(() => groupPointsByAsset(geo, { defaultAssetId: "d", assetAttr: "nope" })).toThrow(
      /assetAttr "nope".*string point attributes present: asset/s,
    );
  });

  it("reports (none) when no string attribute exists at all", () => {
    expect(() =>
      groupPointsByAsset(createPointCloud(1), { defaultAssetId: "d", assetAttr: "nope" }),
    ).toThrow(/string point attributes present: \(none\)/);
  });

  it("rejects a non-string attribute, naming its type", () => {
    expect(() =>
      groupPointsByAsset(createPointCloud(1), { defaultAssetId: "d", assetAttr: "density" }),
    ).toThrow(/must be a string attribute, got f32/);
  });
});

/**
 * An INDEPENDENT reference implementation of the spec — deliberately the
 * naive `Map<string, number[]>` form the v0.7 spawner used, written out
 * again here rather than imported, so the tests below are a real oracle
 * and not a comparison of the implementation with itself.
 */
function referenceGroups(ids: readonly string[], defaultAssetId: string): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  ids.forEach((raw, i) => {
    const id = raw === "" ? defaultAssetId : raw;
    let group = groups.get(id);
    if (!group) groups.set(id, (group = []));
    group.push(i);
  });
  return groups;
}

describe("groupPointsByAsset against an independent reference", () => {
  const CASES: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["first-occurrence", ["b", "a", "b"]],
    ["empty merge", ["", "q", "d", "", "d"]],
    ["single asset", ["only", "only"]],
    ["all distinct", ["a", "b", "c"]],
    ["long interleave", Array.from({ length: 60 }, (_, i) => ["x", "", "y", "d", "z"][i % 5])],
  ];

  it.each(CASES)("matches the naive Map grouping (%s)", (_name, ids) => {
    const grouping = groupPointsByAsset(tagged(ids), BY_ASSET);
    const ref = referenceGroups(ids, "d");
    expect([...grouping.order]).toEqual([...ref.keys()]);
    expect(Array.from(grouping.counts)).toEqual([...ref.values()].map((g) => g.length));
    [...ref.values()].forEach((indices, j) => {
      expect(members(grouping, j)).toEqual(indices);
    });
  });

  /**
   * ...and the CPU spawner really consumes the grouping in order, which
   * is what makes the device path — composing from `perm` — equivalent.
   * x encodes the point index, so `transforms[k * 16 + 12]` names the
   * source point of instance k, checked against the reference rather
   * than against the grouping.
   */
  it.each(CASES)("buildInstanceBatches sources each instance the same way (%s)", (_name, ids) => {
    const batches = buildInstanceBatches(tagged(ids), BY_ASSET);
    const ref = [...referenceGroups(ids, "d")];
    expect(batches.map((b) => b.assetId)).toEqual(ref.map(([id]) => id));
    batches.forEach((batch, j) => {
      const sources = Array.from({ length: batch.count }, (_, k) => batch.transforms[k * 16 + 12]);
      expect(sources).toEqual(ref[j][1]);
    });
  });
});
