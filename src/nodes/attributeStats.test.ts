/**
 * attributeReduce, attributeRemap, removeAttribute — the three nodes that
 * measure, rescale, and clean up attributes.
 */
import { describe, expect, it } from "vitest";
import { createPointCloud, createTriangleMesh } from "../data/index.js";
import { makeGeometryItem } from "../graph/index.js";
import {
  attributeReduce,
  attributeRemap,
  removeAttribute,
  type AttributeReduceParams,
  type AttributeRemapParams,
  type RemoveAttributeParams,
} from "./index.js";
import { firstGeo, runNode, snapshotGeometry } from "./nodes.testsupport.js";

/** Point cloud with a scalar `v` attribute holding the given values. */
function withValues(values: readonly number[], tupleSize = 1): ReturnType<typeof createPointCloud> {
  const geo = createPointCloud(values.length / tupleSize);
  const attr = geo.attrs.point.add("v", "f32", tupleSize, 0);
  for (let i = 0; i < values.length; i++) attr.data[i] = values[i];
  return geo;
}

async function reduce(
  geo: ReturnType<typeof createPointCloud>,
  params: Partial<AttributeReduceParams>,
): Promise<ReturnType<typeof createPointCloud>> {
  return firstGeo(
    (await runNode(attributeReduce, params, { in: [makeGeometryItem(geo)] })).out,
  ) as ReturnType<typeof createPointCloud>;
}

async function remap(
  geo: ReturnType<typeof createPointCloud>,
  params: Partial<AttributeRemapParams>,
): Promise<number[]> {
  const out = firstGeo(
    (await runNode(attributeRemap, params, { in: [makeGeometryItem(geo)] })).out,
  );
  const name = params.outName || params.name || "density";
  const attr = out.attrs.point.require(name);
  return Array.from(attr.data.subarray(0, out.pointCount * attr.tupleSize));
}

describe("attributeReduce", () => {
  it("reduces sum, min, max, average and count", async () => {
    const geo = withValues([1, 4, 10, -2]);
    for (const [mode, expected] of [
      ["sum", 13],
      ["min", -2],
      ["max", 10],
      ["average", 3.25],
      ["count", 4],
    ] as const) {
      const out = await reduce(geo, { name: "v", mode, outName: "r" });
      expect(out.attrs.detail.require("r").get(0), mode).toBe(expected);
    }
  });

  it("count writes u32 and the others f32", async () => {
    const geo = withValues([1, 2]);
    expect((await reduce(geo, { name: "v", mode: "count", outName: "r" })).attrs.detail.require("r").type).toBe("u32");
    expect((await reduce(geo, { name: "v", mode: "sum", outName: "r" })).attrs.detail.require("r").type).toBe("f32");
  });

  it("reduces tuples componentwise, keeping the tuple size", async () => {
    const geo = withValues([1, 10, 100, 3, 20, 50], 3);
    const out = await reduce(geo, { name: "v", mode: "max", outName: "r" });
    const r = out.attrs.detail.require("r");
    expect(r.tupleSize).toBe(3);
    expect(r.getTuple(0)).toEqual([3, 20, 100]);
  });

  it("skips NaN instead of propagating it, and averages over what is left", async () => {
    const geo = withValues([2, NaN, 6]);
    expect((await reduce(geo, { name: "v", mode: "min", outName: "r" })).attrs.detail.require("r").get(0)).toBe(2);
    expect((await reduce(geo, { name: "v", mode: "max", outName: "r" })).attrs.detail.require("r").get(0)).toBe(6);
    expect((await reduce(geo, { name: "v", mode: "sum", outName: "r" })).attrs.detail.require("r").get(0)).toBe(8);
    expect((await reduce(geo, { name: "v", mode: "average", outName: "r" })).attrs.detail.require("r").get(0)).toBe(4);
  });

  it("holds a min AND a max at once, which promoting cannot", async () => {
    const geo = withValues([3, 9]);
    const lo = await reduce(geo, { name: "v", mode: "min", outName: "vMin" });
    const both = await reduce(lo, { name: "v", mode: "max", outName: "vMax" });
    expect(both.attrs.detail.require("vMin").get(0)).toBe(3);
    expect(both.attrs.detail.require("vMax").get(0)).toBe(9);
  });

  it("over an empty domain: sum 0, average 0, min Infinity, max -Infinity, count 0", async () => {
    const geo = withValues([]);
    expect((await reduce(geo, { name: "v", mode: "sum", outName: "r" })).attrs.detail.require("r").get(0)).toBe(0);
    expect((await reduce(geo, { name: "v", mode: "average", outName: "r" })).attrs.detail.require("r").get(0)).toBe(0);
    expect((await reduce(geo, { name: "v", mode: "min", outName: "r" })).attrs.detail.require("r").get(0)).toBe(Infinity);
    expect((await reduce(geo, { name: "v", mode: "max", outName: "r" })).attrs.detail.require("r").get(0)).toBe(-Infinity);
    expect((await reduce(geo, { name: "v", mode: "count", outName: "r" })).attrs.detail.require("r").get(0)).toBe(0);
  });

  it("reduces a single element to itself", async () => {
    const geo = withValues([7]);
    for (const mode of ["sum", "min", "max", "average"] as const) {
      expect((await reduce(geo, { name: "v", mode, outName: "r" })).attrs.detail.require("r").get(0), mode).toBe(7);
    }
  });

  it("mode count ignores `name` and counts the chosen domain", async () => {
    const mesh = createTriangleMesh([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1], [0, 1, 2, 1, 3, 2]);
    const out = firstGeo(
      (
        await runNode(
          attributeReduce,
          { name: "", mode: "count", domain: "primitive", outName: "prims" },
          { in: [makeGeometryItem(mesh)] },
        )
      ).out,
    );
    expect(out.attrs.detail.require("prims").get(0)).toBe(2);
  });

  it("outName defaults to `name`", async () => {
    const out = await reduce(withValues([5, 7]), { name: "v", mode: "sum" });
    expect(out.attrs.detail.require("v").get(0)).toBe(12);
    // The point attribute is untouched.
    expect(out.attrs.point.require("v").get(1)).toBe(7);
  });

  it("names the offender and the fix on misuse", async () => {
    const geo = [makeGeometryItem(withValues([1]))];
    await expect(runNode(attributeReduce, { name: "nope" }, { in: geo })).rejects.toThrow(
      /point attribute "nope" not found; available: P, /,
    );
    await expect(
      runNode(attributeReduce, { name: "", mode: "count", outName: "" }, { in: geo }),
    ).rejects.toThrow(/no output name/);
    const strings = createPointCloud(1);
    strings.attrs.point.add("s", "string", 1, "");
    await expect(
      runNode(attributeReduce, { name: "s" }, { in: [makeGeometryItem(strings)] }),
    ).rejects.toThrow(/string attribute and cannot be reduced/);
  });

  it("refuses an outName that would delete a differently-shaped detail column", async () => {
    // outName is a reporting slot: the shape is this node's to pick (f32 at
    // the source tuple size, u32 for count), so `replace` DELETES a column
    // of any other shape and re-adds it — silently, into a cook that still
    // looks fine. Only the destructive case is refused.
    const geo = withValues([1, 2]);
    geo.attrs.detail.add("label", "f32", 3, 0).setTuple(0, [1, 2, 3]);
    await expect(
      runNode(
        attributeReduce,
        { name: "v", mode: "max", outName: "label" },
        { in: [makeGeometryItem(geo)] },
      ),
    ).rejects.toThrow(
      /attributeReduce: outName "label" already exists on the input's detail domain as f32x3, but outName is written as f32.*would DELETE.*label_max/s,
    );
    // Mode count reads no attribute at all, so nothing about it is in place.
    await expect(
      runNode(
        attributeReduce,
        { name: "", mode: "count", outName: "label" },
        { in: [makeGeometryItem(geo)] },
      ),
    ).rejects.toThrow(/attributeReduce: outName "label".*written as u32.*would DELETE/s);
    // The refusal costs nothing: it happens before any write.
    expect(geo.attrs.detail.require("label").tupleSize).toBe(3);
  });

  it("reuses a same-shaped detail column, and reducing detail into itself is in place", async () => {
    const geo = withValues([1, 2]);
    geo.attrs.detail.add("v", "f32", 1, 0).set(0, 99);
    // outName defaults to `name`, which here already exists on detail with
    // the shape this reduction writes: reset, not deleted.
    expect((await reduce(geo, { name: "v", mode: "sum" })).attrs.detail.require("v").get(0)).toBe(3);
    // Reducing a DETAIL attribute into its own name replaces the very
    // column it read, converting it to f32. Nothing is destroyed that was
    // not about to be rewritten from its own value, so it stays allowed.
    const one = createPointCloud(1);
    one.attrs.detail.add("n", "i32", 1, 0).set(0, 7);
    const out = firstGeo(
      (
        await runNode(
          attributeReduce,
          { name: "n", domain: "detail", mode: "sum" },
          { in: [makeGeometryItem(one)] },
        )
      ).out,
    );
    expect(out.attrs.detail.require("n").type).toBe("f32");
    expect(out.attrs.detail.require("n").get(0)).toBe(7);
  });

  it("is deterministic and seed-independent", async () => {
    const geo = withValues([1, 2, 3, 4]);
    const a = await reduce(geo, { name: "v", mode: "average", outName: "r" });
    const b = firstGeo(
      (
        await runNode(
          attributeReduce,
          { name: "v", mode: "average", outName: "r" },
          { in: [makeGeometryItem(geo)] },
          31337,
        )
      ).out,
    );
    expect(snapshotGeometry(b)).toEqual(snapshotGeometry(a));
  });
});

describe("attributeRemap", () => {
  it("range mode rescales linearly and extrapolates by default", async () => {
    expect(
      await remap(withValues([-1, 0, 1, 2]), {
        name: "v",
        inMin: -1,
        inMax: 1,
        outMin: 0,
        outMax: 1,
      }),
    ).toEqual([0, 0.5, 1, 1.5]);
  });

  it("clamp holds the result inside the output range, both ways round", async () => {
    expect(
      await remap(withValues([-3, 0, 3]), {
        name: "v",
        inMin: -1,
        inMax: 1,
        outMin: 0,
        outMax: 1,
        clamp: true,
      }),
    ).toEqual([0, 0.5, 1]);
    // A reversed output range inverts, and still clamps to the same span.
    expect(
      await remap(withValues([-3, 0, 3]), {
        name: "v",
        inMin: -1,
        inMax: 1,
        outMin: 1,
        outMax: 0,
        clamp: true,
      }),
    ).toEqual([1, 0.5, 0]);
  });

  it("fit mode measures the attribute's own range", async () => {
    expect(await remap(withValues([4, 6, 8]), { name: "v", mode: "fit" })).toEqual([0, 0.5, 1]);
    // ... and ignores inMin/inMax entirely.
    expect(
      await remap(withValues([4, 6, 8]), { name: "v", mode: "fit", inMin: -100, inMax: 100 }),
    ).toEqual([0, 0.5, 1]);
  });

  it("fit mode ignores NaN when measuring, and leaves NaN as NaN", async () => {
    const out = await remap(withValues([0, NaN, 10]), { name: "v", mode: "fit" });
    expect(out[0]).toBe(0);
    expect(out[1]).toBeNaN();
    expect(out[2]).toBe(1);
  });

  it("an empty input range sends everything to outMin, like the remap field", async () => {
    expect(
      await remap(withValues([5, 5, 5]), { name: "v", inMin: 2, inMax: 2, outMin: 7, outMax: 9 }),
    ).toEqual([7, 7, 7]);
    // Fitting a constant attribute is the same empty range.
    expect(await remap(withValues([5, 5]), { name: "v", mode: "fit", outMin: 7 })).toEqual([7, 7]);
    // Fitting a single point, likewise.
    expect(await remap(withValues([5]), { name: "v", mode: "fit", outMin: 7 })).toEqual([7]);
  });

  it("writes to outName without touching the source, or in place when empty", async () => {
    const geo = withValues([0, 1]);
    const out = firstGeo(
      (
        await runNode(
          attributeRemap,
          { name: "v", outName: "w", inMin: 0, inMax: 1, outMin: 10, outMax: 20 },
          { in: [makeGeometryItem(geo)] },
        )
      ).out,
    );
    expect(Array.from(out.attrs.point.require("w").data.subarray(0, 2))).toEqual([10, 20]);
    expect(Array.from(out.attrs.point.require("v").data.subarray(0, 2))).toEqual([0, 1]);
    expect(await remap(geo, { name: "v", inMin: 0, inMax: 1, outMin: 10, outMax: 20 })).toEqual([
      10, 20,
    ]);
  });

  it("converts an integer attribute to f32 in place — the nbrCount to density path", async () => {
    const geo = createPointCloud(3);
    const counts = geo.attrs.point.add("nbrCount", "u32", 1, 0);
    counts.data.set([0, 2, 4]);
    const out = firstGeo(
      (
        await runNode(
          attributeRemap,
          { name: "nbrCount", outName: "density", mode: "fit" },
          { in: [makeGeometryItem(geo)] },
        )
      ).out,
    );
    const density = out.attrs.point.require("density");
    expect(density.type).toBe("f32");
    expect(Array.from(density.data.subarray(0, 3))).toEqual([0, 0.5, 1]);
    expect(out.attrs.point.require("nbrCount").type).toBe("u32");
  });

  it("remaps tuples componentwise against one shared range", async () => {
    expect(
      await remap(withValues([0, 5, 10, 10, 0, 5], 3), {
        name: "v",
        mode: "fit",
      }),
    ).toEqual([0, 0.5, 1, 1, 0, 0.5]);
  });

  it("handles an empty domain", async () => {
    const out = firstGeo(
      (
        await runNode(
          attributeRemap,
          { name: "v", mode: "fit" },
          { in: [makeGeometryItem(withValues([]))] },
        )
      ).out,
    );
    expect(out.pointCount).toBe(0);
    expect(out.attrs.point.require("v").type).toBe("f32");
  });

  it("fitting an attribute that is entirely NaN degrades to the empty range", async () => {
    // Nothing measurable, so the range is empty rather than
    // [+Infinity, -Infinity] — which would make every output NaN and hide
    // the difference between 'no data' and 'bad data' downstream.
    const out = await remap(withValues([NaN, NaN]), { name: "v", mode: "fit", outMin: 7 });
    expect(out).toEqual([NaN, NaN]);
    // A non-NaN element carried alongside lands on outMin, not on NaN.
    const mixed = await remap(withValues([NaN, 5]), { name: "v", mode: "fit", outMin: 7 });
    expect(mixed[0]).toBeNaN();
    expect(mixed[1]).toBe(7);
  });

  it("names the offender and the fix on misuse", async () => {
    await expect(
      runNode(attributeRemap, { name: "nope" }, { in: [makeGeometryItem(withValues([1]))] }),
    ).rejects.toThrow(/point attribute "nope" not found; available: P, /);
    const strings = createPointCloud(1);
    strings.attrs.point.add("s", "string", 1, "");
    await expect(
      runNode(attributeRemap, { name: "s" }, { in: [makeGeometryItem(strings)] }),
    ).rejects.toThrow(/string attribute and has no numeric range/);
  });

  it("refuses an outName that would delete another column, but not the in-place rewrite", async () => {
    // The narrower rule this node needs: the result is always f32, so the
    // blanket "refuse a differently-shaped existing column" would outlaw the
    // DOCUMENTED in-place integer conversion (outName empty, i32/u32 source).
    // What is refused is a differently-shaped column that is NOT the source.
    const geo = withValues([0, 1]);
    await expect(
      runNode(attributeRemap, { name: "v", outName: "P" }, { in: [makeGeometryItem(geo)] }),
    ).rejects.toThrow(
      /attributeRemap: outName "P" already exists on the input's point domain as f32x3, but outName is written as f32.*would DELETE.*P_remap/s,
    );
    expect(geo.attrs.point.require("P").tupleSize).toBe(3);
    // Same tuple size, different type, and not the source: an i32 column
    // under another name is destroyed by the write, so it is refused too.
    const tagged = withValues([0, 1]);
    tagged.attrs.point.add("id", "i32", 1, 0).data.set([5, 6]);
    await expect(
      runNode(attributeRemap, { name: "v", outName: "id" }, { in: [makeGeometryItem(tagged)] }),
    ).rejects.toThrow(
      /attributeRemap: outName "id" already exists on the input's point domain as i32.*would DELETE/s,
    );
    expect(tagged.attrs.point.require("id").type).toBe("i32");
    // The identical shape change IS allowed when the column is the source:
    // an in-place u32 -> f32 remap, which outName's own doc promises.
    const counts = createPointCloud(3);
    counts.attrs.point.add("nbrCount", "u32", 1, 0).data.set([0, 2, 4]);
    const out = firstGeo(
      (
        await runNode(
          attributeRemap,
          { name: "nbrCount", mode: "fit" },
          { in: [makeGeometryItem(counts)] },
        )
      ).out,
    );
    const remapped = out.attrs.point.require("nbrCount");
    expect(remapped.type).toBe("f32");
    expect(Array.from(remapped.data.subarray(0, 3))).toEqual([0, 0.5, 1]);
  });

  it("is deterministic and seed-independent", async () => {
    const geo = withValues([1, 5, 9]);
    const run = (seed: number) =>
      runNode(attributeRemap, { name: "v", mode: "fit" }, { in: [makeGeometryItem(geo)] }, seed);
    expect(snapshotGeometry(firstGeo((await run(2)).out))).toEqual(
      snapshotGeometry(firstGeo((await run(2)).out)),
    );
    expect(snapshotGeometry(firstGeo((await run(90210)).out))).toEqual(
      snapshotGeometry(firstGeo((await run(2)).out)),
    );
  });
});

describe("removeAttribute", () => {
  async function remove(
    geo: ReturnType<typeof createPointCloud>,
    params: Partial<RemoveAttributeParams>,
  ): Promise<ReturnType<typeof createPointCloud>> {
    return firstGeo(
      (await runNode(removeAttribute, params, { in: [makeGeometryItem(geo)] })).out,
    ) as ReturnType<typeof createPointCloud>;
  }

  it("removes the named attributes and leaves the rest in order", async () => {
    const geo = withValues([1, 2]);
    geo.attrs.point.add("scratch", "f32", 1, 0);
    const out = await remove(geo, { names: ["v", "scratch"] });
    expect(out.attrs.point.has("v")).toBe(false);
    expect(out.attrs.point.has("scratch")).toBe(false);
    expect(out.attrs.point.names()).toEqual(
      geo.attrs.point.names().filter((n) => n !== "v" && n !== "scratch"),
    );
    expect(out.pointCount).toBe(2);
  });

  it("leaves the input alone (nodes never mutate their inputs)", async () => {
    const geo = withValues([1, 2]);
    await remove(geo, { names: ["v"] });
    expect(geo.attrs.point.has("v")).toBe(true);
  });

  it("removes from any domain", async () => {
    const geo = withValues([1]);
    geo.attrs.detail.add("stat", "f32", 1, 0);
    const out = await remove(geo, { names: ["stat"], domain: "detail" });
    expect(out.attrs.detail.has("stat")).toBe(false);
  });

  it("an empty list removes nothing and is not an error", async () => {
    const geo = withValues([1, 2]);
    expect(snapshotGeometry(await remove(geo, { names: [] }))).toEqual(snapshotGeometry(geo));
  });

  it("errors on an unknown name by default, and skips it when strict is off", async () => {
    const geo = withValues([1]);
    await expect(remove(geo, { names: ["ghost"] })).rejects.toThrow(
      /point attribute "ghost" not found; available: P, .*set strict false/s,
    );
    const out = await remove(geo, { names: ["ghost", "v"], strict: false });
    expect(out.attrs.point.has("v")).toBe(false);
  });

  it("refuses to remove P", async () => {
    await expect(remove(withValues([1]), { names: ["P"] })).rejects.toThrow(
      /refusing to remove the point attribute "P"/,
    );
    // ... but a same-named attribute on another domain is fine.
    const geo = withValues([1]);
    geo.attrs.detail.add("P", "f32", 3, 0);
    expect((await remove(geo, { names: ["P"], domain: "detail" })).attrs.detail.has("P")).toBe(
      false,
    );
  });

  it("is deterministic and seed-independent", async () => {
    const geo = withValues([1, 2, 3]);
    const run = (seed: number) =>
      runNode(removeAttribute, { names: ["v"] }, { in: [makeGeometryItem(geo)] }, seed);
    expect(snapshotGeometry(firstGeo((await run(1)).out))).toEqual(
      snapshotGeometry(firstGeo((await run(1)).out)),
    );
    expect(snapshotGeometry(firstGeo((await run(77777)).out))).toEqual(
      snapshotGeometry(firstGeo((await run(1)).out)),
    );
  });
});
