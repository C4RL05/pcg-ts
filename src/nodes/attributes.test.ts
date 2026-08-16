import { describe, expect, it } from "vitest";
import { createPointCloud, createTriangleMesh } from "../data/index.js";
import { evaluateField, randomField } from "../fields/index.js";
import { makeGeometryItem, type GeometryItem } from "../graph/index.js";
import { hashCombine } from "../random/index.js";
import {
  fieldFromJson,
  partitionByAttribute,
  promoteAttribute,
  setAttribute,
  transferAttribute,
} from "./index.js";
import { firstGeo, runNode } from "./nodes.testsupport.js";

function cloudAt(positions: number[][]): ReturnType<typeof createPointCloud> {
  const geo = createPointCloud(positions.length);
  const P = geo.attrs.point.require("P");
  positions.forEach((p, i) => P.setTuple(i, p));
  return geo;
}

describe("setAttribute", () => {
  it("creates a scalar attribute from a field on the point domain", async () => {
    const cloud = cloudAt([
      [0, 3, 0],
      [0, 7, 0],
    ]);
    const height = fieldFromJson({ fn: "component", args: [{ fn: "position" }], index: 1 });
    const geo = firstGeo(
      (
        await runNode(setAttribute, { name: "height", value: height }, { in: [makeGeometryItem(cloud)] })
      ).out,
    );
    const attr = geo.attrs.point.require("height");
    expect(attr.type).toBe("f32");
    expect([attr.get(0), attr.get(1)]).toEqual([3, 7]);
  });

  it("converts to i32 (truncation) and bool (nonzero -> 1)", async () => {
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    const item = makeGeometryItem(cloud);
    const truncated = firstGeo(
      (await runNode(setAttribute, { name: "n", type: "i32", value: 2.7 }, { in: [item] })).out,
    );
    expect(truncated.attrs.point.require("n").get(1)).toBe(2);
    const flags = firstGeo(
      (
        await runNode(
          setAttribute,
          { name: "flag", type: "bool", value: fieldFromJson({ fn: "index" }) },
          { in: [item] },
        )
      ).out,
    );
    const flag = flags.attrs.point.require("flag");
    expect([flag.get(0), flag.get(1), flag.get(2)]).toEqual([0, 1, 1]);
  });

  it("writes tuples and other domains (detail)", async () => {
    const cloud = cloudAt([[4, 5, 6]]);
    const copied = firstGeo(
      (
        await runNode(
          setAttribute,
          { name: "P2", tupleSize: 3, value: fieldFromJson({ fn: "position" }) },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    expect(copied.attrs.point.require("P2").getTuple(0)).toEqual([4, 5, 6]);
    const detail = firstGeo(
      (
        await runNode(
          setAttribute,
          { name: "globalScale", domain: "detail", value: 2.5 },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    expect(detail.attrs.detail.require("globalScale").get(0)).toBeCloseTo(2.5, 6);
  });

  it("self-copy via attribute(name) preserves values (aliasing regression)", async () => {
    // value = attribute("density") returns a zero-copy view of the very
    // storage replace() resets; without the aliasing snapshot this reads
    // back defaults instead of the original values.
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    const density = cloud.attrs.point.require("density");
    density.set(0, 0.25);
    density.set(1, 0.5);
    density.set(2, 0.75);
    const geo = firstGeo(
      (
        await runNode(
          setAttribute,
          { name: "density", value: fieldFromJson({ fn: "attribute", name: "density" }) },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    const out = geo.attrs.point.require("density");
    expect([out.get(0), out.get(1), out.get(2)]).toEqual([0.25, 0.5, 0.75]);
  });

  it("writing P from position() preserves positions (aliasing regression)", async () => {
    const cloud = cloudAt([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    const geo = firstGeo(
      (
        await runNode(
          setAttribute,
          { name: "P", tupleSize: 3, value: fieldFromJson({ fn: "position" }) },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    const P = geo.attrs.point.require("P");
    expect([P.getTuple(0), P.getTuple(1)]).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("rejects tuple mismatches actionably", async () => {
    const cloud = cloudAt([[0, 0, 0]]);
    await expect(
      runNode(
        setAttribute,
        { name: "x", tupleSize: 2, value: fieldFromJson({ fn: "position" }) },
        { in: [makeGeometryItem(cloud)] },
      ),
    ).rejects.toThrow(/tuple size 3.*neither 1.*tupleSize 2/);
  });
});

describe("setAttribute string attributes", () => {
  it("writes a constant string to every element (constant mode)", async () => {
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    const geo = firstGeo(
      (
        await runNode(
          setAttribute,
          { name: "species", type: "string", stringValue: "pine" },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    const attr = geo.attrs.point.require("species");
    expect(attr.type).toBe("string");
    expect([attr.getString(0), attr.getString(1), attr.getString(2)]).toEqual([
      "pine",
      "pine",
      "pine",
    ]);
    // One interned entry per distinct string: all elements share an index.
    expect(attr.data[0]).toBe(attr.data[1]);
  });

  it("selects from the value list with a constant selector", async () => {
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    const geo = firstGeo(
      (
        await runNode(
          setAttribute,
          { name: "species", type: "string", values: ["pine", "bush", "rock"], value: 1 },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    const attr = geo.attrs.point.require("species");
    expect([attr.getString(0), attr.getString(1)]).toEqual(["bush", "bush"]);
  });

  it("selects per element with a field selector, clamping past the end", async () => {
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    const geo = firstGeo(
      (
        await runNode(
          setAttribute,
          {
            name: "species",
            type: "string",
            values: ["pine", "bush"],
            value: fieldFromJson({ fn: "index" }),
          },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    const attr = geo.attrs.point.require("species");
    // Index 2 clamps to the last entry.
    expect([attr.getString(0), attr.getString(1), attr.getString(2)]).toEqual([
      "pine",
      "bush",
      "bush",
    ]);
  });

  it("applies the total floor+clamp selector (negatives, fractions, NaN)", async () => {
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [4, 0, 0],
    ]);
    const sel = cloud.attrs.point.add("sel", "f32", 1, 0);
    [-5, 0.9, 1.5, 7, Number.NaN].forEach((v, i) => sel.set(i, v));
    const geo = firstGeo(
      (
        await runNode(
          setAttribute,
          {
            name: "kind",
            type: "string",
            values: ["a", "b", "c"],
            value: fieldFromJson({ fn: "attribute", name: "sel" }),
          },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    const attr = geo.attrs.point.require("kind");
    expect(
      [0, 1, 2, 3, 4].map((i) => attr.getString(i)),
    ).toEqual(["a", "a", "b", "c", "a"]);
  });

  it("broadcasts a scalar selector across string tuples", async () => {
    const cloud = cloudAt([[0, 0, 0]]);
    const geo = firstGeo(
      (
        await runNode(
          setAttribute,
          { name: "pair", type: "string", tupleSize: 2, values: ["x", "y"], value: 1 },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    const attr = geo.attrs.point.require("pair");
    expect([attr.getString(0, 0), attr.getString(0, 1)]).toEqual(["y", "y"]);
  });

  it("replaces a numeric attribute the selector reads (aliasing safety)", async () => {
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    const density = cloud.attrs.point.require("density");
    [0, 1, 0].forEach((v, i) => density.set(i, v));
    const geo = firstGeo(
      (
        await runNode(
          setAttribute,
          {
            name: "density",
            type: "string",
            values: ["off", "on"],
            value: fieldFromJson({ fn: "attribute", name: "density" }),
          },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    const attr = geo.attrs.point.require("density");
    expect(attr.type).toBe("string");
    expect([attr.getString(0), attr.getString(1), attr.getString(2)]).toEqual([
      "off",
      "on",
      "off",
    ]);
  });

  it("rejects values/stringValue on numeric types actionably", async () => {
    const item = makeGeometryItem(cloudAt([[0, 0, 0]]));
    await expect(
      runNode(setAttribute, { name: "x", values: ["a"] }, { in: [item] }),
    ).rejects.toThrow(/"values".*only used when type is "string".*got type "f32"/);
    await expect(
      runNode(setAttribute, { name: "x", stringValue: "a" }, { in: [item] }),
    ).rejects.toThrow(/"stringValue".*only used when type is "string"/);
  });

  it("rejects selector tuple mismatches for string attributes", async () => {
    const cloud = cloudAt([[0, 0, 0]]);
    await expect(
      runNode(
        setAttribute,
        {
          name: "s",
          type: "string",
          tupleSize: 2,
          values: ["a", "b"],
          value: fieldFromJson({ fn: "position" }),
        },
        { in: [makeGeometryItem(cloud)] },
      ),
    ).rejects.toThrow(/tuple size 3.*neither 1.*tupleSize 2/);
  });
});

describe("setAttribute weighted string tables", () => {
  // The rig's own table (graphs/examples-rig.json, node `partPart`): nine
  // rows spelling a 4:2:1:2 mix, selected by an index scaled by the table's
  // own length.
  const RIG_REPEATED = ["rod", "rod", "rod", "rod", "bar", "bar", "panel", "clamp", "clamp"];
  const RIG_KINDS = ["rod", "bar", "panel", "clamp"];
  const RIG_WEIGHTS = [4, 2, 1, 2];

  function line(n: number): number[][] {
    return Array.from({ length: n }, (_, i) => [i * 0.5, 0, 0]);
  }

  function countStrings(geo: ReturnType<typeof createPointCloud>, name: string): Record<string, number> {
    const attr = geo.attrs.point.require(name);
    const counts: Record<string, number> = {};
    for (let i = 0; i < geo.pointCount; i++) {
      const s = attr.getString(i);
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }

  /** A per-point f32 column of exactly these selector values. */
  function cloudWithSelector(selectors: number[]): ReturnType<typeof createPointCloud> {
    const cloud = cloudAt(line(selectors.length));
    const sel = cloud.attrs.point.add("sel", "f32", 1, 0);
    selectors.forEach((v, i) => sel.set(i, v));
    return cloud;
  }

  it("leaves the pre-weights cook byte-identical when weights and select are absent", async () => {
    // GOLDEN: captured by running this exact fixture against setAttribute as
    // it stood BEFORE `weights`/`select` existed, then pasted here. It is
    // the control for the whole feature — the corpus's string setAttribute
    // nodes look like this one, and they must not move by a single table
    // index. (Mutation-checked: turning the index selector's floor into a
    // round turns this red.)
    const cloud = cloudAt(line(900));
    const geo = firstGeo(
      (
        await runNode(
          setAttribute,
          {
            name: "part",
            type: "string",
            values: RIG_REPEATED,
            value: fieldFromJson({ fn: "mul", args: [{ fn: "randomField", key: "part" }, 9] }),
          },
          { in: [makeGeometryItem(cloud)] },
          7,
        )
      ).out,
    );
    const attr = geo.attrs.point.require("part");
    expect(Array.from(attr.data.subarray(0, 20))).toEqual([
      2, 1, 3, 1, 2, 2, 1, 1, 1, 4, 1, 1, 4, 1, 1, 4, 3, 1, 1, 4,
    ]);
    expect(countStrings(geo, "part")).toEqual({ rod: 402, bar: 211, panel: 109, clamp: 178 });
  });

  it("draws the rig's mix from four values and four weights, with no length in the selector", async () => {
    // The same 900 points and the same draw, said the way gap 5 asks for:
    // four kinds, a 4:2:1:2 weighting, and a selector that knows nothing
    // about the table (`randomField` is already in [0, 1), so the `mul(…, 9)`
    // is gone). The two spellings agree ELEMENT FOR ELEMENT here, which is a
    // measurement rather than a guarantee: the index spelling floors an f32
    // product and this one floors an f64 one, so a selector sitting within
    // an f32 ulp of a bucket edge could disagree. What is guaranteed is the
    // table — integer weights are the repeated rows, so the two tables cut
    // [0, 1) at exactly the same nine places.
    const cloud = cloudAt(line(900));
    const item = makeGeometryItem(cloud);
    const repeated = firstGeo(
      (
        await runNode(
          setAttribute,
          {
            name: "part",
            type: "string",
            values: RIG_REPEATED,
            value: fieldFromJson({ fn: "mul", args: [{ fn: "randomField", key: "part" }, 9] }),
          },
          { in: [item] },
          7,
        )
      ).out,
    );
    const weighted = firstGeo(
      (
        await runNode(
          setAttribute,
          {
            name: "part",
            type: "string",
            values: RIG_KINDS,
            weights: RIG_WEIGHTS,
            select: fieldFromJson({ fn: "randomField", key: "part" }),
          },
          { in: [item] },
          7,
        )
      ).out,
    );
    expect(countStrings(weighted, "part")).toEqual(countStrings(repeated, "part"));
    const a = repeated.attrs.point.require("part");
    const b = weighted.attrs.point.require("part");
    expect(Array.from(b.data.subarray(0, 900))).toEqual(Array.from(a.data.subarray(0, 900)));
  });

  it("produces the declared proportions over a large sample", async () => {
    // 9000 points, weights 4:2:1:2 (total 9). The draw is a deterministic
    // hash, so this test cannot flake — the same 9000 selectors come back
    // every run on every platform. The tolerance is therefore not a
    // flakiness allowance but a statement about the HASH: 4 standard
    // deviations of the binomial the draw approximates, which is what
    // "randomField is uniform enough to weight a table with" means. Any
    // break in the bucket mapping (an off-by-one end, a lost weight, a
    // clamp where the wrap belongs) moves a count by hundreds or thousands,
    // far outside it.
    const n = 9000;
    const cloud = cloudAt(line(n));
    const geo = firstGeo(
      (
        await runNode(
          setAttribute,
          {
            name: "part",
            type: "string",
            values: RIG_KINDS,
            weights: RIG_WEIGHTS,
            select: fieldFromJson({ fn: "randomField", key: "part" }),
          },
          { in: [makeGeometryItem(cloud)] },
          11,
        )
      ).out,
    );
    const counts = countStrings(geo, "part");
    const shares: Record<string, number> = { rod: 4 / 9, bar: 2 / 9, panel: 1 / 9, clamp: 2 / 9 };
    for (const kind of RIG_KINDS) {
      const p = shares[kind];
      const tolerance = 4 * Math.sqrt(n * p * (1 - p));
      expect(Math.abs((counts[kind] ?? 0) - n * p)).toBeLessThan(tolerance);
    }
    // Every point got one of the four, and nothing outside the table.
    expect(Object.keys(counts).sort()).toEqual([...RIG_KINDS].sort());
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(n);
  });

  it("cuts the table into equal shares when weights are absent", async () => {
    // The half of gap 5 that is not about weighting at all: a fraction
    // selector removes the retyped `values.length` even from an unweighted
    // table.
    const n = 4000;
    const cloud = cloudAt(line(n));
    const geo = firstGeo(
      (
        await runNode(
          setAttribute,
          {
            name: "kind",
            type: "string",
            values: ["a", "b", "c", "d"],
            select: fieldFromJson({ fn: "randomField", key: "kind" }),
          },
          { in: [makeGeometryItem(cloud)] },
          3,
        )
      ).out,
    );
    const counts = countStrings(geo, "kind");
    const tolerance = 4 * Math.sqrt(n * 0.25 * 0.75);
    for (const kind of ["a", "b", "c", "d"]) {
      expect(Math.abs((counts[kind] ?? 0) - n / 4)).toBeLessThan(tolerance);
    }
  });

  it("cuts buckets at exact boundaries (no floating-point drift)", async () => {
    // Weights 4:4 over two entries: total 8, so a selector of exactly 0.5
    // is the first slot of the second entry and the largest float below it
    // is the last slot of the first. Both products are exact in binary
    // (0.5 * 8 = 4), so this pins the boundary itself rather than a
    // rounding of it.
    const belowHalf = Math.fround(0.5 - Math.pow(2, -25));
    const cloud = cloudWithSelector([0, 0.25, belowHalf, 0.5, 0.75, 0.9999999]);
    const geo = firstGeo(
      (
        await runNode(
          setAttribute,
          {
            name: "kind",
            type: "string",
            values: ["a", "b"],
            weights: [4, 4],
            select: fieldFromJson({ fn: "attribute", name: "sel" }),
          },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    const attr = geo.attrs.point.require("kind");
    expect([0, 1, 2, 3, 4, 5].map((i) => attr.getString(i))).toEqual([
      "a",
      "a",
      "a",
      "b",
      "b",
      "b",
    ]);
  });

  it("is total: non-finite and out-of-range selectors land on defined entries", async () => {
    // The property the index selector documents, kept: no per-element
    // throw, ever. NaN and -Infinity take the first entry, +Infinity the
    // last; a finite selector outside [0, 1) contributes its fractional
    // part, so 1.25 draws what 0.25 draws and -0.25 draws what 0.75 does.
    const cloud = cloudWithSelector([
      Number.NaN,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      1.25,
      0.25,
      -0.25,
      0.75,
      1e20,
    ]);
    const geo = firstGeo(
      (
        await runNode(
          setAttribute,
          {
            name: "kind",
            type: "string",
            values: ["a", "b", "c", "d"],
            select: fieldFromJson({ fn: "attribute", name: "sel" }),
          },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    const attr = geo.attrs.point.require("kind");
    const got = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => attr.getString(i));
    expect(got).toEqual(["a", "a", "d", "b", "b", "d", "d", "a"]);
  });

  it("never draws a zero-weighted entry, including at the ends of the table", async () => {
    // A weight of 0 switches an entry off without taking it out of the
    // table, so "first" and "last" in the non-finite rule have to mean the
    // first and last SELECTABLE entry — otherwise a NaN would resurrect a
    // switched-off kind.
    const cloud = cloudWithSelector([
      Number.NaN,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      0,
      0.5,
      0.99,
    ]);
    const geo = firstGeo(
      (
        await runNode(
          setAttribute,
          {
            name: "kind",
            type: "string",
            values: ["off1", "on", "off2"],
            weights: [0, 3, 0],
            select: fieldFromJson({ fn: "attribute", name: "sel" }),
          },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    const attr = geo.attrs.point.require("kind");
    expect([0, 1, 2, 3, 4, 5].map((i) => attr.getString(i))).toEqual([
      "on",
      "on",
      "on",
      "on",
      "on",
      "on",
    ]);
  });

  it("broadcasts a scalar fraction selector across string tuples", async () => {
    const cloud = cloudAt([[0, 0, 0]]);
    const geo = firstGeo(
      (
        await runNode(
          setAttribute,
          {
            name: "pair",
            type: "string",
            tupleSize: 2,
            values: ["x", "y"],
            weights: [1, 1],
            select: 0.75,
          },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    const attr = geo.attrs.point.require("pair");
    expect([attr.getString(0, 0), attr.getString(0, 1)]).toEqual(["y", "y"]);
  });

  it("rejects a weights length that disagrees with values", async () => {
    const item = makeGeometryItem(cloudAt([[0, 0, 0]]));
    await expect(
      runNode(
        setAttribute,
        { name: "k", type: "string", values: ["a", "b", "c"], weights: [1, 2], select: 0.5 },
        { in: [item] },
      ),
    ).rejects.toThrow(/"weights" has 2 entries but "values" has 3.*one weight per value/s);
  });

  it("rejects weights that are not whole counts (fractional, negative, junk)", async () => {
    const item = makeGeometryItem(cloudAt([[0, 0, 0]]));
    // A numberList admits any finite number, so what a WEIGHT additionally
    // refuses is what this covers: fractions and negatives. The list type
    // already refuses NaN and Infinity, and there is no longer a text
    // spelling for a weight to be junk in.
    for (const bad of [[1, 1.5], [1, -2], [1, 0.5], [1, -0.001]]) {
      await expect(
        runNode(
          setAttribute,
          { name: "k", type: "string", values: ["a", "b"], weights: bad, select: 0.5 },
          { in: [item] },
        ),
      ).rejects.toThrow(/entry 1 is .*not a whole count.*\[7, 3\]/s);
    }
  });

  it("rejects an all-zero weighting", async () => {
    const item = makeGeometryItem(cloudAt([[0, 0, 0]]));
    await expect(
      runNode(
        setAttribute,
        { name: "k", type: "string", values: ["a", "b"], weights: [0, 0], select: 0.5 },
        { in: [item] },
      ),
    ).rejects.toThrow(/sums to 0.*nothing left to select/s);
  });

  it("rejects a weight sum past exact integer range", async () => {
    const item = makeGeometryItem(cloudAt([[0, 0, 0]]));
    await expect(
      runNode(
        setAttribute,
        {
          name: "k",
          type: "string",
          values: ["a", "b"],
          weights: [9007199254740991, 2],
          select: 0.5,
        },
        { in: [item] },
      ),
    ).rejects.toThrow(/sums past 9007199254740991 at entry 1.*scale the whole list down/s);
  });

  it("rejects weights under the index selector, naming the fraction selector", async () => {
    // The convention guard: `weights` cannot quietly change what a number
    // already sitting in `value` means.
    const item = makeGeometryItem(cloudAt([[0, 0, 0]]));
    await expect(
      runNode(
        setAttribute,
        {
          name: "k",
          type: "string",
          values: ["rod", "bar", "panel", "clamp"],
          weights: RIG_WEIGHTS,
          value: fieldFromJson({ fn: "mul", args: [{ fn: "randomField", key: "part" }, 4] }),
        },
        { in: [item] },
      ),
    ).rejects.toThrow(/"weights" is set but the table is still selected by "value".*mul\(randomField\(\.\.\.\), 4\) becomes randomField\(\.\.\.\)/s);
  });

  it("rejects both selectors at once", async () => {
    const item = makeGeometryItem(cloudAt([[0, 0, 0]]));
    await expect(
      runNode(
        setAttribute,
        { name: "k", type: "string", values: ["a", "b"], value: 1, select: 0.5 },
        { in: [item] },
      ),
    ).rejects.toThrow(/"value" and "select" are both set.*two different conventions/s);
  });

  it("rejects weights and select on numeric types actionably", async () => {
    const item = makeGeometryItem(cloudAt([[0, 0, 0]]));
    await expect(
      runNode(setAttribute, { name: "x", weights: [1] }, { in: [item] }),
    ).rejects.toThrow(/"weights" \(1 entries\).*only used when type is "string".*got type "f32"/s);
    await expect(
      runNode(setAttribute, { name: "x", select: 0.5 }, { in: [item] }),
    ).rejects.toThrow(/"select" is only used when type is "string".*got type "f32"/s);
  });

  it("rejects weights and select when there is no table to select from", async () => {
    const item = makeGeometryItem(cloudAt([[0, 0, 0]]));
    await expect(
      runNode(
        setAttribute,
        { name: "k", type: "string", stringValue: "rod", weights: [1] },
        { in: [item] },
      ),
    ).rejects.toThrow(/"weights" is set but "values" is empty.*no table to weight/s);
    await expect(
      runNode(
        setAttribute,
        { name: "k", type: "string", stringValue: "rod", select: 0.5 },
        { in: [item] },
      ),
    ).rejects.toThrow(/"select" is set but "values" is empty.*nothing to select among/s);
  });

  it("rejects fraction-selector tuple mismatches", async () => {
    const cloud = cloudAt([[0, 0, 0]]);
    await expect(
      runNode(
        setAttribute,
        {
          name: "s",
          type: "string",
          tupleSize: 2,
          values: ["a", "b"],
          select: fieldFromJson({ fn: "position" }),
        },
        { in: [makeGeometryItem(cloud)] },
      ),
    ).rejects.toThrow(/select evaluates to tuple size 3.*neither 1.*tupleSize 2/);
  });
});

describe("setAttribute seed param", () => {
  const positions = [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [3, 0, 0],
  ];

  it("seed 0 evaluates value with the node's derived seed unchanged (regression)", async () => {
    const cloud = cloudAt(positions);
    const geo = firstGeo(
      (
        await runNode(
          setAttribute,
          { name: "r", value: randomField(3) },
          { in: [makeGeometryItem(cloud)] },
          5,
        )
      ).out,
    );
    // Pre-seed-param behavior: the field saw the raw node seed. seed 0
    // (the default) must reproduce it bit for bit.
    const expected = evaluateField(randomField(3), { geo: cloud, domain: "point", seed: 5 });
    const attr = geo.attrs.point.require("r");
    expect(Array.from(attr.data.subarray(0, 4))).toEqual(
      Array.from(expected.data.subarray(0, 4)),
    );
  });

  it("nonzero seed folds via hashCombine(nodeSeed, seed) like sampler nodes", async () => {
    const cloud = cloudAt(positions);
    const geo = firstGeo(
      (
        await runNode(
          setAttribute,
          { name: "r", value: randomField(3), seed: 9 },
          { in: [makeGeometryItem(cloud)] },
          5,
        )
      ).out,
    );
    const attr = geo.attrs.point.require("r");
    const got = Array.from(attr.data.subarray(0, 4));
    const folded = evaluateField(randomField(3), {
      geo: cloud,
      domain: "point",
      seed: hashCombine(5, 9),
    });
    expect(got).toEqual(Array.from(folded.data.subarray(0, 4)));
    const unfolded = evaluateField(randomField(3), { geo: cloud, domain: "point", seed: 5 });
    expect(got).not.toEqual(Array.from(unfolded.data.subarray(0, 4)));
  });
});

describe("promoteAttribute", () => {
  it("averages point P onto primitives (centroids)", async () => {
    const mesh = createTriangleMesh(
      [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
      [0, 1, 2, 0, 2, 3],
    );
    const geo = firstGeo(
      (
        await runNode(
          promoteAttribute,
          { name: "P", from: "point", to: "primitive", mode: "average" },
          { in: [makeGeometryItem(mesh)] },
        )
      ).out,
    );
    const attr = geo.attrs.primitive.require("P");
    const c0 = attr.getTuple(0);
    expect(c0[0]).toBeCloseTo(2 / 3, 5);
    expect(c0[1]).toBeCloseTo(1 / 3, 5);
    const c1 = attr.getTuple(1);
    expect(c1[0]).toBeCloseTo(1 / 3, 5);
    expect(c1[1]).toBeCloseTo(2 / 3, 5);
  });

  it("propagates promote errors (missing attribute)", async () => {
    const mesh = createTriangleMesh([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
    await expect(
      runNode(promoteAttribute, { name: "ghost" }, { in: [makeGeometryItem(mesh)] }),
    ).rejects.toThrow(/"ghost" not found/);
  });
});

describe("transferAttribute", () => {
  it("copies the nearest source point's value", async () => {
    const dst = cloudAt([
      [0, 0, 0],
      [10, 0, 0],
    ]);
    const src = cloudAt([
      [1, 0, 0],
      [9, 0, 0],
    ]);
    src.attrs.point.require("density").set(0, 5);
    src.attrs.point.require("density").set(1, 7);
    const geo = firstGeo(
      (
        await runNode(transferAttribute, { name: "density" }, {
          in: [makeGeometryItem(dst)],
          source: [makeGeometryItem(src)],
        })
      ).out,
    );
    const density = geo.attrs.point.require("density");
    expect([density.get(0), density.get(1)]).toEqual([5, 7]);
    // Input dst is untouched (purity).
    expect(dst.attrs.point.require("density").get(0)).toBe(1);
  });
});

describe("partitionByAttribute", () => {
  it("splits by i32 value in first-occurrence order with tags", async () => {
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [4, 0, 0],
    ]);
    const grp = cloud.attrs.point.add("grp", "i32", 1, 0);
    [2, 1, 2, 3, 1].forEach((v, i) => grp.set(i, v));
    const out = (
      await runNode(partitionByAttribute, { name: "grp" }, { in: [makeGeometryItem(cloud)] })
    ).out as GeometryItem[];
    expect(out).toHaveLength(3);
    expect(out.map((item) => item.geo.pointCount)).toEqual([2, 2, 1]);
    expect(out.map((item) => [...item.tags][0])).toEqual(["grp=2", "grp=1", "grp=3"]);
    // Points routed to the right groups, attributes carried.
    expect(out[0].geo.attrs.point.require("P").get(0, 0)).toBe(0);
    expect(out[0].geo.attrs.point.require("P").get(1, 0)).toBe(2);
    expect(out[2].geo.attrs.point.require("grp").get(0)).toBe(3);
  });

  it("splits by string value", async () => {
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    const species = cloud.attrs.point.add("species", "string", 1, "");
    ["fir", "oak", "fir"].forEach((v, i) => species.setString(i, v));
    const out = (
      await runNode(partitionByAttribute, { name: "species" }, { in: [makeGeometryItem(cloud)] })
    ).out as GeometryItem[];
    expect(out.map((item) => [...item.tags][0])).toEqual(["species=fir", "species=oak"]);
    expect(out[0].geo.pointCount).toBe(2);
  });

  it("rejects float attributes actionably", async () => {
    const cloud = cloudAt([[0, 0, 0]]);
    await expect(
      runNode(partitionByAttribute, { name: "density" }, { in: [makeGeometryItem(cloud)] }),
    ).rejects.toThrow(/must be i32, u32, or string/);
  });
});

