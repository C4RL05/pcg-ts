/**
 * `transferByIndex`: the gather that asks its question in the SOURCE'S
 * ORDER.
 *
 * Every expectation here is hand-computed from a table small enough to
 * read — four or five source points carrying values that spell out which
 * one was read — rather than recorded from a run, because the whole claim
 * of the node is that a stated index lands on a stated point. A recorded
 * expectation would move with the code and prove nothing.
 */
import { describe, expect, it } from "vitest";
import { Geometry, createPointCloud } from "../data/index.js";
import { attribute, constant, div } from "../fields/index.js";
import { makeGeometryItem, type DataCollection } from "../graph/index.js";
import { transferByIndex } from "./transferByIndex.js";
import {
  firstGeo,
  permutePoints,
  positionsOf,
  runNode,
  shuffledOrder,
} from "./nodes.testsupport.js";

/** The message a node refused with, or a failure if it did not refuse. */
async function rejection(run: Promise<unknown>): Promise<string> {
  const err: unknown = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof Error)) throw new Error("expected the node to throw an Error");
  return err.message;
}

/** One point column as a plain array of its elements' tuples flattened. */
function col(geo: Geometry, name: string): number[] {
  const a = geo.attrs.point.require(name);
  return Array.from(a.data.slice(0, geo.attrs.point.count * a.tupleSize));
}

/** One string point column as an array of its resolved values. */
function strings(geo: Geometry, name: string): string[] {
  const a = geo.attrs.point.require(name);
  const out: string[] = [];
  for (let i = 0; i < geo.attrs.point.count; i++) out.push(a.getString(i));
  return out;
}

/** A source table: one numeric point attribute, one value per entry. */
function table(name: string, values: readonly number[], tupleSize = 1, defaultValue = 0): Geometry {
  const geo = createPointCloud(values.length / tupleSize);
  const attr = geo.attrs.point.add(name, "f32", tupleSize, defaultValue);
  attr.data.set(values);
  return geo;
}

/** A destination cloud carrying one index per point under `idx`. */
function picks(indices: readonly number[]): Geometry {
  const geo = createPointCloud(indices.length);
  const attr = geo.attrs.point.add("idx", "f32", 1, 0);
  for (let i = 0; i < indices.length; i++) attr.set(i, indices[i]);
  return geo;
}

async function gather(
  dst: Geometry,
  source: Geometry,
  params: Record<string, unknown> = {},
): Promise<Geometry> {
  const outputs = await runNode(transferByIndex, { index: attribute("idx"), ...params }, {
    in: [makeGeometryItem(dst)],
    source: [makeGeometryItem(source)],
  });
  return firstGeo(outputs.out);
}

/** The same run, but returning the promise so a refusal can be inspected. */
function gathering(
  dst: Geometry,
  source: Geometry,
  params: Record<string, unknown> = {},
): Promise<Record<string, DataCollection>> {
  return runNode(transferByIndex, { index: attribute("idx"), ...params }, {
    in: [makeGeometryItem(dst)],
    source: [makeGeometryItem(source)],
  });
}

/**
 * The reference table: five entries whose `v` spells out which one was
 * read, so 30 in the output means "source point 3" with nothing to work
 * out.
 */
const TABLE = () => table("v", [0, 10, 20, 30, 40]);

describe("transferByIndex: the gather", () => {
  it("reads the source point the index names", async () => {
    const out = await gather(picks([0, 2, 4, 1]), TABLE(), { attributes: ["v"] });
    expect(col(out, "v")).toEqual([0, 20, 40, 10]);
  });

  it("takes a plain number as one index shared by every point", async () => {
    const out = await gather(picks([9, 9, 9]), TABLE(), { attributes: ["v"], index: 3 });
    expect(col(out, "v")).toEqual([30, 30, 30]);
  });

  it("spends an index a field computed rather than one an attribute held", async () => {
    // idx/2 truncated: 0, 1, 2, 3 for indices 1, 3, 5, 7.
    const out = await gather(picks([1, 3, 5, 7]), TABLE(), {
      attributes: ["v"],
      index: div(attribute("idx"), constant(2)),
    });
    expect(col(out, "v")).toEqual([0, 10, 20, 30]);
  });

  it("keeps the destination's count, order and its own columns", async () => {
    const dst = picks([4, 0]);
    const out = await gather(dst, TABLE(), { attributes: ["v"] });
    expect(out.attrs.point.count).toBe(2);
    expect(col(out, "idx")).toEqual([4, 0]);
    expect(positionsOf(out)).toEqual(positionsOf(dst));
  });

  it("copies rather than blends, so an integer column stays an integer", async () => {
    const src = createPointCloud(3);
    const lane = src.attrs.point.add("lane", "i32", 1, 0);
    lane.set(0, 1);
    lane.set(1, 2);
    lane.set(2, 3);
    const out = await gather(picks([2, 0]), src, { attributes: ["lane"] });
    expect(out.attrs.point.require("lane").type).toBe("i32");
    expect(col(out, "lane")).toEqual([3, 1]);
  });

  it("keeps the tuple size and copies every component of the same entry", async () => {
    // Three entries of vec3: 0,1,2 / 10,11,12 / 20,21,22.
    const src = table("uvw", [0, 1, 2, 10, 11, 12, 20, 21, 22], 3);
    const out = await gather(picks([2, 0, 1]), src, { attributes: ["uvw"] });
    expect(out.attrs.point.require("uvw").tupleSize).toBe(3);
    expect(col(out, "uvw")).toEqual([20, 21, 22, 0, 1, 2, 10, 11, 12]);
  });

  it("gathers a string attribute intact", async () => {
    // The racetrack's case: an asset id picked out of a roster.
    const src = createPointCloud(3);
    const asset = src.attrs.point.add("asset", "string", 1, "");
    asset.setString(0, "rock");
    asset.setString(1, "tree");
    asset.setString(2, "sign");
    const out = await gather(picks([1, 0, 1, 2]), src, { attributes: ["asset"] });
    expect(out.attrs.point.require("asset").type).toBe("string");
    expect(strings(out, "asset")).toEqual(["tree", "rock", "tree", "sign"]);
  });

  it("gathers several named attributes in one pass", async () => {
    const src = TABLE();
    const w = src.attrs.point.add("w", "f32", 1, 0);
    w.data.set([100, 101, 102, 103, 104]);
    const out = await gather(picks([3, 1]), src, { attributes: ["v", "w"] });
    expect(col(out, "v")).toEqual([30, 10]);
    expect(col(out, "w")).toEqual([103, 101]);
  });

  it("places the destination onto the source's positions when P is named", async () => {
    const src = createPointCloud(2);
    src.attrs.point.require("P").data.set([10, 0, 0, 20, 0, 0]);
    const out = await gather(picks([1, 0, 1]), src, { attributes: ["P"] });
    expect(positionsOf(out)).toEqual([
      [20, 0, 0],
      [10, 0, 0],
      [20, 0, 0],
    ]);
  });
});

describe("transferByIndex: which attributes", () => {
  it("takes every non-bookkeeping point attribute when the list is empty", async () => {
    const src = createPointCloud(2);
    src.attrs.point.add("v", "f32", 1, 0).data.set([10, 20]);
    const tag = src.attrs.point.add("tag", "string", 1, "");
    tag.setString(0, "a");
    tag.setString(1, "b");
    const out = await gather(picks([1, 0]), src, {});
    expect(col(out, "v")).toEqual([20, 10]);
    // Strings are INCLUDED by the empty rule here, unlike transferAlongPath:
    // this node copies, and a copied string is just a string.
    expect(strings(out, "tag")).toEqual(["b", "a"]);
  });

  it("excludes the eight bookkeeping columns from the empty-list default", async () => {
    const src = createPointCloud(2);
    src.attrs.point.add("v", "f32", 1, 0).data.set([10, 20]);
    // Every standard column made unmistakably the source's.
    src.attrs.point.require("P").data.set([9, 9, 9, 9, 9, 9]);
    src.attrs.point.require("rot").data.set([9, 9, 9, 9, 9, 9, 9, 9]);
    src.attrs.point.require("scale").data.set([9, 9, 9, 9, 9, 9]);
    src.attrs.point.require("density").data.set([9, 9]);
    src.attrs.point.require("boundsMin").data.set([9, 9, 9, 9, 9, 9]);
    src.attrs.point.require("boundsMax").data.set([9, 9, 9, 9, 9, 9]);
    src.attrs.point.require("color").data.set([9, 9, 9, 9, 9, 9, 9, 9]);
    src.attrs.point.require("seed").data.set([77, 77]);

    const dst = picks([0, 1]);
    const out = await gather(dst, src, {});
    expect(col(out, "v")).toEqual([10, 20]);
    for (const name of ["P", "rot", "scale", "density", "boundsMin", "boundsMax", "color", "seed"]) {
      expect(col(out, name)).toEqual(col(dst, name));
    }
  });

  it("lifts the exclusion when a bookkeeping column is named", async () => {
    const src = createPointCloud(2);
    src.attrs.point.require("density").data.set([0.25, 0.75]);
    const out = await gather(picks([1, 1]), src, { attributes: ["density"] });
    expect(col(out, "density")).toEqual([0.75, 0.75]);
  });

  it("refuses an attribute the source does not have, listing what it does", async () => {
    const msg = await rejection(gathering(picks([0]), TABLE(), { attributes: ["nope"] }));
    expect(msg).toContain('transferByIndex: param "attributes" names point attribute "nope"');
    expect(msg).toContain("v");
  });

  it("refuses an empty name and a repeated one", async () => {
    expect(await rejection(gathering(picks([0]), TABLE(), { attributes: [""] }))).toContain(
      "holds an empty name",
    );
    expect(await rejection(gathering(picks([0]), TABLE(), { attributes: ["v", "v"] }))).toContain(
      'names "v" twice',
    );
  });

  it("refuses a source with nothing left after the exclusions", async () => {
    // A bare standard cloud: every column it has is bookkeeping.
    const msg = await rejection(gathering(picks([0]), createPointCloud(3), {}));
    expect(msg).toContain('param "attributes" is empty');
    expect(msg).toContain("the source has none left");
  });

  it("overwrites a destination column of another shape, as a copy does", async () => {
    // transferAttribute's rule, not the reporting-slot rule: the shape is
    // the source's and overwriting is what a copy IS.
    const dst = picks([1, 0]);
    dst.attrs.point.add("v", "i32", 1, 0).data.set([5, 6]);
    const src = table("v", [0, 1, 2, 3, 10, 11], 2);
    const out = await gather(dst, src, { attributes: ["v"] });
    const v = out.attrs.point.require("v");
    expect(v.type).toBe("f32");
    expect(v.tupleSize).toBe(2);
    expect(col(out, "v")).toEqual([2, 3, 0, 1]);
  });

  it("refuses to reshape the destination's own P", async () => {
    const src = new Geometry();
    src.attrs.point.add("P", "f32", 4, [0, 0, 0, 0]);
    src.attrs.point.resize(2);
    const msg = await rejection(gathering(picks([0, 1]), src, { attributes: ["P"] }));
    expect(msg).toContain('transferByIndex: param "attributes" names "P"');
    expect(msg).toContain("f32[4]");
    expect(msg).toContain("f32[3]");
  });
});

describe("transferByIndex: out of range", () => {
  it("clamps an index past either end", async () => {
    const out = await gather(picks([-1, -100, 5, 999, 2]), TABLE(), {
      attributes: ["v"],
      outOfRange: "clamp",
    });
    expect(col(out, "v")).toEqual([0, 0, 40, 40, 20]);
  });

  it("clamps by default", async () => {
    const out = await gather(picks([-3, 9]), TABLE(), { attributes: ["v"] });
    expect(col(out, "v")).toEqual([0, 40]);
  });

  it("wraps by EUCLIDEAN modulo, so a negative index reads from the end", async () => {
    // -1 -> 4, -5 -> 0, -6 -> 4, 5 -> 0, 7 -> 2. JavaScript's own %
    // returns -1, -0, -1, 0 and 2 for those, and -1 is not a point.
    const out = await gather(picks([-1, -5, -6, 5, 7]), TABLE(), {
      attributes: ["v"],
      outOfRange: "wrap",
    });
    expect(col(out, "v")).toEqual([40, 0, 40, 0, 20]);
  });

  it("wraps a long way out in one step", async () => {
    const out = await gather(picks([-5000, 5003]), TABLE(), {
      attributes: ["v"],
      outOfRange: "wrap",
    });
    expect(col(out, "v")).toEqual([0, 30]);
  });

  it("misses an index outside the source and keeps the prior value", async () => {
    const dst = picks([0, 5, -1]);
    dst.attrs.point.add("v", "f32", 1, 0).data.set([7, 8, 9]);
    const out = await gather(dst, TABLE(), { attributes: ["v"], outOfRange: "miss" });
    expect(col(out, "v")).toEqual([0, 8, 9]);
  });

  it("gives a miss the source attribute's default when the column had to be created", async () => {
    const src = table("v", [10, 20], 1, 5);
    const out = await gather(picks([0, 7]), src, { attributes: ["v"], outOfRange: "miss" });
    expect(col(out, "v")).toEqual([10, 5]);
  });

  it("refuses an outOfRange it does not know, naming the three it does", async () => {
    const msg = await rejection(
      gathering(picks([0]), TABLE(), { attributes: ["v"], outOfRange: "nearest" }),
    );
    expect(msg).toContain('unknown outOfRange "nearest"');
    expect(msg).toContain("clamp, wrap, miss");
  });
});

describe("transferByIndex: truncation", () => {
  it("truncates toward zero rather than flooring", async () => {
    // 3.9 -> 3 and 0.5 -> 0 are the same under either rule; -0.5 -> -0 is
    // the case that separates them, and it lands on entry 0.
    const out = await gather(picks([3.9, 0.5, -0.5, 2.999]), TABLE(), {
      attributes: ["v"],
      outOfRange: "miss",
    });
    expect(col(out, "v")).toEqual([30, 0, 0, 20]);
  });

  it("truncates before the range policy, so -0.5 wraps to entry 0 and not to the end", async () => {
    const out = await gather(picks([-0.5, -1.5]), TABLE(), {
      attributes: ["v"],
      outOfRange: "wrap",
    });
    expect(col(out, "v")).toEqual([0, 40]);
  });
});

describe("transferByIndex: an empty source", () => {
  /** A source that carries the column but holds no entries. */
  const empty = () => {
    const geo = createPointCloud(0);
    geo.attrs.point.add("v", "f32", 1, 3);
    return geo;
  };

  for (const outOfRange of ["clamp", "wrap", "miss"]) {
    it(`misses every point under "${outOfRange}" — there is no index to reach for`, async () => {
      const dst = picks([0, 1, 2]);
      dst.attrs.point.add("v", "f32", 1, 0).data.set([7, 8, 9]);
      const out = await gather(dst, empty(), {
        attributes: ["v"],
        outOfRange,
        hitAttr: "__hit",
        missCountAttr: "__missed",
      });
      expect(col(out, "v")).toEqual([7, 8, 9]);
      expect(col(out, "__hit")).toEqual([0, 0, 0]);
      expect(out.attrs.detail.require("__missed").get(0)).toBe(3);
    });
  }

  it("still creates the gathered column, so the output's shape does not depend on the source", async () => {
    const out = await gather(picks([0, 1]), empty(), { attributes: ["v"] });
    expect(out.attrs.point.has("v")).toBe(true);
    // The source attribute's default, which is what a miss keeps.
    expect(col(out, "v")).toEqual([3, 3]);
  });
});

describe("transferByIndex: reporting", () => {
  it("flags the hits with 1 and the misses with 0", async () => {
    const out = await gather(picks([0, 1, 5, -1]), table("v", [10, 20]), {
      attributes: ["v"],
      outOfRange: "miss",
      hitAttr: "__hit",
      missCountAttr: "__missed",
    });
    const hit = out.attrs.point.require("__hit");
    expect(hit.type).toBe("bool");
    expect(hit.tupleSize).toBe(1);
    expect(col(out, "__hit")).toEqual([1, 1, 0, 0]);
    expect(out.attrs.detail.require("__missed").get(0)).toBe(2);
  });

  it("flags every point a hit under clamp, and counts no misses", async () => {
    const out = await gather(picks([-9, 9]), TABLE(), {
      attributes: ["v"],
      outOfRange: "clamp",
      hitAttr: "__hit",
      missCountAttr: "__missed",
    });
    expect(col(out, "__hit")).toEqual([1, 1]);
    expect(out.attrs.detail.require("__missed").get(0)).toBe(0);
  });

  it("resets a hit flag it inherited, so it describes THIS gather only", async () => {
    const dst = picks([0, 7]);
    dst.attrs.point.add("__hit", "bool", 1, 0).data.set([1, 1]);
    const out = await gather(dst, table("v", [10, 20]), {
      attributes: ["v"],
      outOfRange: "miss",
      hitAttr: "__hit",
    });
    expect(col(out, "__hit")).toEqual([1, 0]);
  });

  it("refuses a hit flag that would overwrite a gathered column", async () => {
    const msg = await rejection(
      gathering(picks([0]), TABLE(), { attributes: ["v"], hitAttr: "v" }),
    );
    expect(msg).toContain('hitAttr "v" is also being gathered');
    expect(msg).toContain('it is named in "attributes"');
  });

  it("refuses a hit flag the empty-list default would gather", async () => {
    const msg = await rejection(gathering(picks([0]), TABLE(), { hitAttr: "v" }));
    expect(msg).toContain('the empty "attributes" default selects it');
  });

  it("refuses a hit flag pointed at a differently shaped column, rather than deleting it", async () => {
    const msg = await rejection(
      gathering(picks([0]), TABLE(), { attributes: ["v"], hitAttr: "P" }),
    );
    expect(msg).toContain('transferByIndex: hitAttr "P" already exists');
    expect(msg).toContain("DELETE");
    expect(msg).toContain("__hit");
  });

  it("reuses a same-shape hit column rather than refusing it", async () => {
    const dst = picks([0]);
    dst.attrs.point.add("__hit", "bool", 1, 0);
    const out = await gather(dst, TABLE(), { attributes: ["v"], hitAttr: "__hit" });
    expect(col(out, "__hit")).toEqual([1]);
  });

  it("refuses a miss count pointed at a differently shaped detail column", async () => {
    const dst = picks([0]);
    dst.attrs.detail.add("n", "f32", 1, 0);
    const msg = await rejection(
      gathering(dst, TABLE(), { attributes: ["v"], missCountAttr: "n" }),
    );
    expect(msg).toContain('transferByIndex: missCountAttr "n" already exists');
    expect(msg).toContain("detail domain");
    expect(msg).toContain("__missed");
  });

  it("writes neither slot when both are empty", async () => {
    const out = await gather(picks([0]), TABLE(), { attributes: ["v"] });
    expect(out.attrs.point.names()).not.toContain("__hit");
    expect(out.attrs.detail.names()).toEqual([]);
  });
});

describe("transferByIndex: a non-finite index", () => {
  /** A destination whose index column holds `value` at every point. */
  const broken = (value: number) => {
    const geo = createPointCloud(2);
    const attr = geo.attrs.point.add("idx", "f32", 1, 0);
    attr.set(0, 0);
    attr.set(1, value);
    return geo;
  };

  for (const outOfRange of ["clamp", "wrap", "miss"]) {
    it(`is refused under "${outOfRange}" rather than read as anything`, async () => {
      const msg = await rejection(
        gathering(broken(Number.NaN), TABLE(), { attributes: ["v"], outOfRange }),
      );
      expect(msg).toContain('transferByIndex: param "index" resolved to NaN');
      expect(msg).toContain("element 1");
    });
  }

  it("refuses an infinite index too, and says which infinity", async () => {
    const msg = await rejection(
      gathering(broken(Number.POSITIVE_INFINITY), TABLE(), { attributes: ["v"] }),
    );
    expect(msg).toContain('param "index" resolved to +Infinity');
  });

  it("refuses a vec index rather than reading one component of it", async () => {
    const dst = picks([0, 1]);
    dst.attrs.point.add("pair", "f32", 2, 0);
    const msg = await rejection(
      gathering(dst, TABLE(), { attributes: ["v"], index: attribute("pair") }),
    );
    expect(msg).toContain('param "index" must evaluate to ONE number per point');
  });
});

/**
 * The same refusal, asked of a PLAIN value rather than of a field.
 *
 * These are a separate block because they exercise a DIFFERENT GUARD. The
 * column check `resolveOn` applies is gated on `isField`, so it only ever
 * sees what a field produced; a plain number never becomes a field and
 * used to reach the walk untouched. What happened then was not an error
 * but a plausible-looking cook: `Math.trunc(NaN)` is NaN, NaN fails the
 * `< 0` and `>= m` tests that every one of the three outOfRange settings
 * is written in terms of, so no branch fired, the source was read at
 * `[NaN]` — `undefined`, which stores as NaN in an f32 column and as 0 in
 * an i32, u32 or bool one — and the point was then FLAGGED AS A HIT with
 * a miss count of zero. Every mode is covered because every mode was
 * wrong, and each in its own way.
 */
describe("transferByIndex: a plain non-finite index", () => {
  const MODES = ["clamp", "wrap", "miss"] as const;

  for (const outOfRange of MODES) {
    it(`refuses a plain NaN under "${outOfRange}" rather than reading nothing and calling it a hit`, async () => {
      const msg = await rejection(
        gathering(picks([0, 1]), TABLE(), {
          attributes: ["v"],
          index: Number.NaN,
          outOfRange,
          hitAttr: "__hit",
          missCountAttr: "__missed",
        }),
      );
      expect(msg).toContain('transferByIndex: param "index" is NaN');
      expect(msg).toContain("finite number");
    });

    it(`refuses a plain +Infinity under "${outOfRange}"`, async () => {
      // Under 'clamp' this one used to look entirely reasonable — it read
      // the LAST source point — which is why it is refused rather than
      // given the reading one of the three settings happens to have for
      // it. The three do not agree with each other, so none of them is
      // the meaning of an infinite index.
      const msg = await rejection(
        gathering(picks([0, 1]), TABLE(), {
          attributes: ["v"],
          index: Number.POSITIVE_INFINITY,
          outOfRange,
        }),
      );
      expect(msg).toContain('transferByIndex: param "index" is Infinity');
    });

    it(`refuses a plain -Infinity under "${outOfRange}"`, async () => {
      const msg = await rejection(
        gathering(picks([0, 1]), TABLE(), {
          attributes: ["v"],
          index: Number.NEGATIVE_INFINITY,
          outOfRange,
        }),
      );
      expect(msg).toContain('transferByIndex: param "index" is -Infinity');
    });
  }

  it("refuses a NaN written as a one-element tuple, the other plain spelling", async () => {
    // `graph/params.ts` admits a `number[]` for a field-capable scalar, so
    // this is a legal way to write the same broken constant and is still
    // not a Field. A `typeof === "number"` test walks straight past it.
    const msg = await rejection(
      gathering(picks([0, 1]), TABLE(), { attributes: ["v"], index: [Number.NaN] }),
    );
    expect(msg).toContain('transferByIndex: param "index" is NaN');
  });

  it("names the offending component when a tuple index is broken in a later lane", async () => {
    const msg = await rejection(
      gathering(picks([0, 1]), TABLE(), { attributes: ["v"], index: [0, Number.NaN] }),
    );
    expect(msg).toContain('transferByIndex: param "index" (component 1) is NaN');
  });

  it("leaves a FIELD to the column guard, which answers in its own words", async () => {
    // The plain check returns early for a Field. The two guards must both
    // still be reachable, and the wording is what says which one answered.
    const dst = picks([0, 0]);
    dst.attrs.point.require("idx").set(1, Number.NaN);
    const msg = await rejection(gathering(dst, TABLE(), { attributes: ["v"] }));
    expect(msg).toContain('transferByIndex: param "index" resolved to NaN');
    expect(msg).toContain("A FIELD param is not range-checked");
    expect(msg).not.toContain("is NaN, which is not a usable value");
  });

  it("a plain FINITE index is untouched by the new check", async () => {
    // The guard must refuse only what is not a number: the broadcast case
    // this param documents still has to work, including a negative one the
    // range policy is supposed to read.
    const out = await gather(picks([9, 9]), TABLE(), { attributes: ["v"], index: -1 });
    expect(col(out, "v")).toEqual([0, 0]);
    const wrapped = await gather(picks([9, 9]), TABLE(), {
      attributes: ["v"],
      index: -1,
      outOfRange: "wrap",
    });
    expect(col(wrapped, "v")).toEqual([40, 40]);
  });
});

describe("transferByIndex: determinism", () => {
  it("gives the same answer twice", async () => {
    const a = await gather(picks([4, 0, 2, 2]), TABLE(), { attributes: ["v"] });
    const b = await gather(picks([4, 0, 2, 2]), TABLE(), { attributes: ["v"] });
    expect(col(a, "v")).toEqual(col(b, "v"));
  });

  it("does not care what order the destination points arrive in", async () => {
    const dst = picks([4, 0, 2, 1, 3, 3, 0]);
    const order = shuffledOrder(7, 5);
    const straight = await gather(dst, TABLE(), { attributes: ["v"] });
    const shuffled = await gather(permutePoints(dst, order), TABLE(), { attributes: ["v"] });
    const expected = Array.from(order, (j) => col(straight, "v")[j]);
    expect(col(shuffled, "v")).toEqual(expected);
  });

  it("reads the values it was handed when one geometry is wired to both pins", async () => {
    // The clone is deep, so the gather cannot read a value it has already
    // written: point 0 takes point 1's value and point 1 takes point 0's.
    const both = picks([1, 0]);
    both.attrs.point.add("v", "f32", 1, 0).data.set([100, 200]);
    const out = await gather(both, both, { attributes: ["v"] });
    expect(col(out, "v")).toEqual([200, 100]);
  });
});

describe("transferByIndex: cancellation", () => {
  it("checks for cancellation on the per-point walk", async () => {
    const n = 600;
    const dst = picks(new Array<number>(n).fill(1));
    let checks = 0;
    await transferByIndex.execute({
      inputs: {
        in: [makeGeometryItem(dst)],
        source: [makeGeometryItem(TABLE())],
      },
      params: { ...transferByIndex.defaultParams, index: attribute("idx"), attributes: ["v"] },
      seed: 1,
      checkCancelled() {
        checks++;
      },
    });
    // CANCEL_STRIDE is 256, so 600 points check at 0, 256 and 512.
    expect(checks).toBe(3);
  });
});
