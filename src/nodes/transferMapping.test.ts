import { describe, expect, it } from "vitest";
import { createPointCloud, createTriangleMesh, transferNearest, type Geometry } from "../data/index.js";
import { Graph, cook, makeGeometryItem, type NodeHandle } from "../graph/index.js";
import { dataInput, type DataInputParams } from "../runtime/dataInput.js";
import {
  deserializeGraph,
  getNodeType,
  serializeGraph,
  transferAttribute,
  type TransferAttributeParams,
} from "./index.js";
import { firstGeo, runNode, snapshotGeometry } from "./nodes.testsupport.js";

/** Ground quad on y=0 spanning [0,10]^2 in xz; uv = xz/10; val, id attrs. */
function quadSource(): Geometry {
  const geo = createTriangleMesh(
    [0, 0, 0, 10, 0, 0, 10, 0, 10, 0, 0, 10],
    [0, 1, 2, 0, 2, 3],
  );
  geo.attrs.point.add("uv", "f32", 2).data.set([0, 0, 1, 0, 1, 1, 0, 1]);
  geo.attrs.point.add("val", "f32", 1).data.set([10, 20, 30, 40]);
  geo.attrs.point.add("id", "i32", 1).data.set([0, 1, 2, 3]);
  return geo;
}

/** Point cloud with positions and a point-domain uv lookup attribute. */
function dstCloud(rows: { p: number[]; uv: number[] }[]): Geometry {
  const geo = createPointCloud(rows.length);
  const P = geo.attrs.point.require("P");
  const uv = geo.attrs.point.add("uv", "f32", 2);
  rows.forEach((r, i) => {
    P.setTuple(i, r.p);
    uv.setTuple(i, r.uv);
  });
  return geo;
}

describe("transferAttribute registry metadata", () => {
  it("exposes the full mapping param surface with documented schemas", () => {
    const info = getNodeType("transferAttribute").info;
    expect(Object.keys(info.params).sort()).toEqual([
      "attrDomain",
      "direction",
      "directionAttr",
      "hitAttr",
      "mapping",
      "maxDistance",
      "missCountAttr",
      "name",
      "uvAttr",
    ]);
    expect(info.params.mapping.enum).toEqual(["nearest", "uv", "raycast"]);
    expect(info.params.mapping.default).toBe("nearest");
    expect(info.params.attrDomain.enum).toEqual(["point", "vertex", "primitive"]);
    expect(info.params.attrDomain.default).toBe("point");
    expect(info.params.uvAttr.default).toBe("uv");
    expect(info.params.direction.type).toBe("vec3");
    expect(info.params.direction.default).toEqual([0, -1, 0]);
    expect(info.params.directionAttr.default).toBe("");
    expect(info.params.maxDistance.default).toBe(0);
    expect(info.params.maxDistance.min).toBe(0);
    expect(info.params.missCountAttr.default).toBe("");
    expect(info.params.hitAttr.default).toBe("");
    // A silently inverted boolean is the bug this param is most likely to
    // grow, so the schema has to state its polarity in words an agent can
    // read: which value means found, which means missed.
    expect(info.params.hitAttr.description).toMatch(/1 means this point found a source/);
    expect(info.params.hitAttr.description).toMatch(/0 means it missed/);
    expect(info.params.hitAttr.description).toMatch(/bool/);
    // Param descriptions carry the policies (tie rules, misses, types).
    for (const [name, schema] of Object.entries(info.params)) {
      expect(schema.description.trim().length, `${name} description`).toBeGreaterThan(20);
    }
    expect(info.description).toMatch(/lowest source primitive index/);
    expect(info.description).toMatch(/miss/);
  });
});

describe("transferAttribute uv mapping", () => {
  it("interpolates by UV and records misses in a detail attribute", async () => {
    const src = quadSource();
    const dst = dstCloud([
      { p: [0, 0, 0], uv: [0.5, 0.5] }, // shared diagonal -> triangle 0 -> 20
      { p: [1, 0, 0], uv: [3, 3] }, // outside -> miss
    ]);
    const out = firstGeo(
      (
        await runNode(
          transferAttribute,
          { name: "val", mapping: "uv", missCountAttr: "missed" },
          { in: [makeGeometryItem(dst)], source: [makeGeometryItem(src)] },
        )
      ).out,
    );
    const val = out.attrs.point.require("val");
    expect([val.get(0), val.get(1)]).toEqual([20, 0]);
    const missed = out.attrs.detail.require("missed");
    expect(missed.type).toBe("u32");
    expect(missed.get(0)).toBe(1);
    // Purity: the input destination is untouched.
    expect(dst.attrs.point.has("val")).toBe(false);
    expect(dst.attrs.detail.has("missed")).toBe(false);
  });

  it("reads vertex-domain attributes when attrDomain is 'vertex'", async () => {
    const src = quadSource();
    src.attrs.vertex.add("cv", "f32", 1).data.set([1, 2, 3, 4, 5, 6]);
    const dst = dstCloud([{ p: [0, 0, 0], uv: [0.5, 0.5] }]);
    const out = firstGeo(
      (
        await runNode(
          transferAttribute,
          { name: "cv", mapping: "uv", attrDomain: "vertex" },
          { in: [makeGeometryItem(dst)], source: [makeGeometryItem(src)] },
        )
      ).out,
    );
    // Triangle 0 wins on the diagonal: w = (0.5, 0, 0.5) over 1,2,3.
    expect(out.attrs.point.require("cv").get(0)).toBe(2);
  });

  it("reads primitive-domain attributes when attrDomain is 'primitive'", async () => {
    const src = quadSource();
    src.attrs.primitive.add("roadWidth", "f32", 1).data.set([7, 9]);
    // uv (0.75, 0.25) is inside triangle 0, (0.25, 0.75) inside triangle 1.
    const dst = dstCloud([
      { p: [0, 0, 0], uv: [0.75, 0.25] },
      { p: [0, 0, 0], uv: [0.25, 0.75] },
      { p: [0, 0, 0], uv: [2, 2] },
    ]);
    const out = firstGeo(
      (
        await runNode(
          transferAttribute,
          {
            name: "roadWidth",
            mapping: "uv",
            attrDomain: "primitive",
            missCountAttr: "missed",
            hitAttr: "__hit",
          },
          { in: [makeGeometryItem(dst)], source: [makeGeometryItem(src)] },
        )
      ).out,
    );
    const got = out.attrs.point.require("roadWidth");
    expect([got.get(0), got.get(1), got.get(2)]).toEqual([7, 9, 0]);
    expect(out.attrs.detail.require("missed").get(0)).toBe(1);
    const hit = out.attrs.point.require("__hit");
    expect([hit.get(0), hit.get(1), hit.get(2)]).toEqual([1, 1, 0]);
  });
});

describe("transferAttribute raycast mapping", () => {
  it("casts along the constant direction with an optional distance cap", async () => {
    const src = quadSource();
    const dst = dstCloud([
      { p: [5, 7, 2.5], uv: [0, 0] }, // hits at t = 7 -> 17.5
      { p: [50, 7, 50], uv: [0, 0] }, // off the mesh -> miss
    ]);
    const run = async (maxDistance: number): Promise<Geometry> =>
      firstGeo(
        (
          await runNode(
            transferAttribute,
            { name: "val", mapping: "raycast", maxDistance, missCountAttr: "missed" },
            { in: [makeGeometryItem(dst)], source: [makeGeometryItem(src)] },
          )
        ).out,
      );
    const unlimited = await run(0); // 0 = unlimited
    expect([unlimited.attrs.point.require("val").get(0), unlimited.attrs.point.require("val").get(1)]).toEqual([17.5, 0]);
    expect(unlimited.attrs.detail.require("missed").get(0)).toBe(1);
    const capped = await run(5); // hit at t = 7 is beyond the cap
    expect(capped.attrs.point.require("val").get(0)).toBe(0);
    expect(capped.attrs.detail.require("missed").get(0)).toBe(2);
  });

  it("uses per-point directions when directionAttr is set", async () => {
    const src = quadSource();
    const dst = dstCloud([
      { p: [5, 7, 2.5], uv: [0, 0] }, // aims down -> hit
      { p: [5, 7, 2.5], uv: [0, 0] }, // aims up -> miss
    ]);
    dst.attrs.point.add("rayDir", "f32", 3).data.set([0, -1, 0, 0, 1, 0]);
    const out = firstGeo(
      (
        await runNode(
          transferAttribute,
          {
            name: "val",
            mapping: "raycast",
            directionAttr: "rayDir",
            direction: [1, 0, 0], // must be ignored
            missCountAttr: "missed",
          },
          { in: [makeGeometryItem(dst)], source: [makeGeometryItem(src)] },
        )
      ).out,
    );
    const val = out.attrs.point.require("val");
    expect([val.get(0), val.get(1)]).toEqual([17.5, 0]);
    expect(out.attrs.detail.require("missed").get(0)).toBe(1);
  });
});

describe("transferAttribute nearest mapping (unchanged)", () => {
  it("matches transferNearest exactly and reports zero misses", async () => {
    const src = createPointCloud(3);
    (src.attrs.point.require("P").data as Float32Array).set([0, 0, 0, 5, 0, 0, 0, 5, 0]);
    src.attrs.point.require("density").data.set([0.1, 0.2, 0.3]);
    const mkDst = (): Geometry => {
      const d = createPointCloud(2);
      (d.attrs.point.require("P").data as Float32Array).set([4, 0, 0, 0, 4, 0]);
      return d;
    };
    const out = firstGeo(
      (
        await runNode(
          transferAttribute,
          { name: "density", missCountAttr: "missed" },
          { in: [makeGeometryItem(mkDst())], source: [makeGeometryItem(src)] },
        )
      ).out,
    );
    const reference = mkDst();
    transferNearest(reference, src, "density");
    expect(Array.from(out.attrs.point.require("density").data.subarray(0, 2))).toEqual(
      Array.from(reference.attrs.point.require("density").data.subarray(0, 2)),
    );
    expect(out.attrs.detail.require("missed").get(0)).toBe(0);
  });
});

describe("transferAttribute hitAttr (per-point miss flag)", () => {
  /** Run the node over `dst` against the ground quad and return the output. */
  async function run(
    dst: Geometry,
    params: Partial<TransferAttributeParams>,
    src: Geometry = quadSource(),
  ): Promise<Geometry> {
    return firstGeo(
      (
        await runNode(transferAttribute, params, {
          in: [makeGeometryItem(dst)],
          source: [makeGeometryItem(src)],
        })
      ).out,
    );
  }

  /** The flag column as a plain array, so failures print readably. */
  function flags(geo: Geometry, name = "__hit"): number[] {
    const attr = geo.attrs.point.require(name);
    return Array.from({ length: geo.pointCount }, (_, i) => attr.get(i));
  }

  it("is off by default: an unset hitAttr writes no column at all", async () => {
    const dst = dstCloud([
      { p: [0, 0, 0], uv: [0.5, 0.5] },
      { p: [1, 0, 0], uv: [3, 3] },
    ]);
    const before = dst.attrs.point.names();
    const out = await run(dst, { name: "val", mapping: "uv" });
    // The default must stay inert — every graph authored before this param
    // existed has to keep cooking exactly what it always did, so the only
    // new column is the transferred one.
    expect(out.attrs.point.names()).toEqual([...before, "val"]);
    expect(out.attrs.point.has("__hit")).toBe(false);
  });

  it("uv: flags the hits 1 and the misses 0, agreeing with missCountAttr", async () => {
    const out = await run(
      dstCloud([
        { p: [0, 0, 0], uv: [0.5, 0.5] }, // inside triangle 0
        { p: [1, 0, 0], uv: [3, 3] }, // outside every triangle
        { p: [2, 0, 0], uv: [0.9, 0.1] }, // inside triangle 0
        { p: [3, 0, 0], uv: [Number.NaN, 0.5] }, // non-finite uv: a miss
      ]),
      { name: "val", mapping: "uv", hitAttr: "__hit", missCountAttr: "missed" },
    );
    const flag = out.attrs.point.require("__hit");
    expect(flag.type).toBe("bool");
    expect(flag.tupleSize).toBe(1);
    expect(flags(out)).toEqual([1, 0, 1, 0]);
    // The two channels are the same fact at two granularities: the total
    // has to be exactly the number of zeros, or one of them is lying.
    expect(out.attrs.detail.require("missed").get(0)).toBe(
      flags(out).filter((v) => v === 0).length,
    );
  });

  it("raycast: flags exactly the points whose ray landed, cap included", async () => {
    const dst = dstCloud([
      { p: [5, 7, 2.5], uv: [0, 0] }, // hits at t = 7
      { p: [50, 7, 50], uv: [0, 0] }, // off the mesh entirely
      { p: [5, 2, 2.5], uv: [0, 0] }, // hits at t = 2
    ]);
    const unlimited = await run(dst, { name: "val", mapping: "raycast", hitAttr: "__hit" });
    expect(flags(unlimited)).toEqual([1, 0, 1]);
    // A distance cap turns a hit into a miss, and the flag has to follow
    // the same decision the transferred value did.
    const capped = await run(dst, {
      name: "val",
      mapping: "raycast",
      maxDistance: 5,
      hitAttr: "__hit",
    });
    expect(flags(capped)).toEqual([0, 0, 1]);
  });

  it("raycast: a per-point direction pointing away is a miss, and says so", async () => {
    const dst = dstCloud([
      { p: [5, 7, 2.5], uv: [0, 0] },
      { p: [5, 7, 2.5], uv: [0, 0] },
      { p: [5, 7, 2.5], uv: [0, 0] },
    ]);
    dst.attrs.point.add("rayDir", "f32", 3).data.set([0, -1, 0, 0, 1, 0, 0, 0, 0]);
    const out = await run(dst, {
      name: "val",
      mapping: "raycast",
      directionAttr: "rayDir",
      hitAttr: "__hit",
    });
    // Down hits; up is forward-only away from the quad; zero-length misses.
    expect(flags(out)).toEqual([1, 0, 0]);
  });

  it("nearest: every point is assigned, so every flag is 1", async () => {
    const src = createPointCloud(3);
    (src.attrs.point.require("P").data as Float32Array).set([0, 0, 0, 5, 0, 0, 0, 5, 0]);
    src.attrs.point.require("density").data.set([0.1, 0.2, 0.3]);
    const dst = createPointCloud(2);
    (dst.attrs.point.require("P").data as Float32Array).set([4, 0, 0, 0, 4, 0]);
    const out = await run(dst, { name: "density", hitAttr: "__hit", missCountAttr: "missed" }, src);
    expect(flags(out)).toEqual([1, 1]);
    expect(out.attrs.detail.require("missed").get(0)).toBe(0);
  });

  it("nothing to search: a source of only degenerate triangles flags every point 0", async () => {
    // The source has a 3-vertex poly primitive, so it is not the "no
    // triangles" error — it has zero usable AREA, which is the case where
    // the transfer runs and finds nothing. Hit polarity makes that read
    // correctly: nothing was found, so nothing is flagged. Under a miss
    // flag the same column would have to be filled with 1s to say the same
    // thing, and a freshly created column's default 0 would claim success.
    const src = createTriangleMesh([0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 1, 2]);
    src.attrs.point.add("uv", "f32", 2).data.set([0, 0, 0, 0, 0, 0]);
    src.attrs.point.add("val", "f32", 1).data.set([10, 20, 30]);
    const dst = dstCloud([
      { p: [0, 5, 0], uv: [0.5, 0.5] },
      { p: [1, 5, 0], uv: [0.25, 0.25] },
    ]);
    const rayOut = await run(dst, { name: "val", mapping: "raycast", hitAttr: "__hit" }, src);
    expect(flags(rayOut)).toEqual([0, 0]);
    const uvOut = await run(dst, { name: "val", mapping: "uv", hitAttr: "__hit" }, src);
    expect(flags(uvOut)).toEqual([0, 0]);
  });

  it("never inherits a prior value: the flag describes THIS transfer only", async () => {
    // The hazard the flag exists to remove. An internal marker that keeps
    // its previous value on a miss lets a point that hit nothing claim it
    // landed — which is precisely how the old two-ray drop-to-surface
    // recipe could be broken by a name collision on the destination.
    const dst = dstCloud([
      { p: [5, 7, 2.5], uv: [0, 0] }, // hits
      { p: [50, 7, 50], uv: [0, 0] }, // misses
    ]);
    dst.attrs.point.add("__hit", "bool", 1).data.set([1, 1]);
    const sameType = await run(dst, { name: "val", mapping: "raycast", hitAttr: "__hit" });
    expect(flags(sameType)).toEqual([1, 0]);

    // A collision under a DIFFERENT shape used to be resolved the other way
    // — the column was deleted and re-added as the flag — which is the
    // clobber the guard below refuses. The hazard is the same one read from
    // the other side: the node cannot know whether a differently shaped
    // column is a stale flag or the graph's own data, so it stops.
    const wrongType = dstCloud([
      { p: [5, 7, 2.5], uv: [0, 0] },
      { p: [50, 7, 50], uv: [0, 0] },
    ]);
    wrongType.attrs.point.add("__hit", "f32", 3).data.set([9, 9, 9, 9, 9, 9]);
    await expect(
      run(wrongType, { name: "val", mapping: "raycast", hitAttr: "__hit" }),
    ).rejects.toThrow(/hitAttr "__hit" already exists on the input's point domain as f32x3/);
  });

  it("rejects a hitAttr that would overwrite the transferred attribute", async () => {
    await expect(
      run(dstCloud([{ p: [0, 0, 0], uv: [0.5, 0.5] }]), {
        name: "val",
        mapping: "uv",
        hitAttr: "val",
      }),
    ).rejects.toThrow(
      /transferAttribute: hitAttr "val" is the same as name .* give hitAttr a distinct name/s,
    );
  });

  it("refuses to DELETE an existing attribute of another shape, P included", async () => {
    // The worst failure this project can produce is a plausible-looking
    // cook, and this was one: `replace` deletes and re-adds on a shape
    // mismatch, so `hitAttr: "P"` turned every position into a bool flag
    // and returned a geometry that still cooked, still had the right point
    // count, and had lost the positions. The `hitAttr === name` guard could
    // not see it — the collision is with an attribute the transfer never
    // touches. Any existing name of a different shape is refused now, and
    // the message has to name all four things an agent needs: the node, the
    // param, the attribute, and what to do instead.
    const dst = dstCloud([
      { p: [5, 7, 2.5], uv: [0.5, 0.25] },
      { p: [50, 7, 50], uv: [3, 3] },
    ]);
    await expect(run(dst, { name: "val", mapping: "raycast", hitAttr: "P" })).rejects.toThrow(
      /transferAttribute: hitAttr "P" already exists on the input's point domain as f32x3.*would DELETE.*__hit/s,
    );
    // The input is not consumed by the refusal: the node threw before it
    // wrote anything, so P is still P.
    expect(dst.attrs.point.require("P").type).toBe("f32");
    expect(dst.attrs.point.require("P").tupleSize).toBe(3);
  });

  it("refuses the same clobber through missCountAttr, on the detail domain", async () => {
    // Same hole, same `replace`, different domain — a guard that closes one
    // and not the other is an invitation to find the other.
    const dst = dstCloud([{ p: [5, 7, 2.5], uv: [0.5, 0.25] }]);
    dst.attrs.detail.add("label", "f32", 3).setTuple(0, [1, 2, 3]);
    await expect(
      run(dst, { name: "val", mapping: "raycast", missCountAttr: "label" }),
    ).rejects.toThrow(
      /transferAttribute: missCountAttr "label" already exists on the input's detail domain as f32x3.*would DELETE.*__missed/s,
    );
  });

  it("still reuses an existing column of the SAME shape, on both channels", async () => {
    // The refusal must not widen into "never touch an existing name":
    // reusing a correctly shaped column is the documented behaviour both
    // params rely on, and resetting it is what keeps the flag describing
    // THIS transfer only.
    const dst = dstCloud([
      { p: [5, 7, 2.5], uv: [0, 0] }, // hits
      { p: [50, 7, 50], uv: [0, 0] }, // misses
    ]);
    dst.attrs.point.add("__hit", "bool", 1).data.set([1, 1]);
    dst.attrs.detail.add("missed", "u32", 1).set(0, 99);
    const out = await run(dst, {
      name: "val",
      mapping: "raycast",
      hitAttr: "__hit",
      missCountAttr: "missed",
    });
    expect(flags(out)).toEqual([1, 0]);
    expect(out.attrs.detail.require("missed").get(0)).toBe(1);
  });

  it("is per-point, so reordering the destination permutes the flags exactly", async () => {
    // The determinism claim in concrete form: each flag is decided by that
    // point's own query and nothing else, so it cannot depend on how the
    // work is ordered, split or partitioned.
    const rows = [
      { p: [5, 7, 2.5], uv: [0, 0] },
      { p: [50, 7, 50], uv: [0, 0] },
      { p: [1, 7, 1], uv: [0, 0] },
      { p: [-9, 7, 4], uv: [0, 0] },
    ];
    const params = { name: "val", mapping: "raycast", hitAttr: "__hit" };
    const forward = flags(await run(dstCloud(rows), params));
    const reversed = flags(await run(dstCloud([...rows].reverse()), params));
    expect(reversed).toEqual([...forward].reverse());
    expect(forward).toEqual([1, 0, 1, 0]);
  });
});

describe("transferAttribute errors", () => {
  const geoms = (): Record<string, ReturnType<typeof makeGeometryItem>[]> => ({
    in: [makeGeometryItem(dstCloud([{ p: [0, 0, 0], uv: [0.5, 0.5] }]))],
    source: [makeGeometryItem(quadSource())],
  });

  it("rejects attrDomain 'vertex' with mapping 'nearest' actionably", async () => {
    await expect(
      runNode(transferAttribute, { name: "val", attrDomain: "vertex" }, geoms()),
    ).rejects.toThrow(/attrDomain "vertex" is only valid for the "uv" and "raycast" mappings/);
  });

  it("rejects attrDomain 'primitive' with mapping 'nearest' and names the route", async () => {
    await expect(
      runNode(transferAttribute, { name: "val", attrDomain: "primitive" }, geoms()),
    ).rejects.toThrow(
      /attrDomain "primitive" is only valid for the "uv" and "raycast" mappings[\s\S]*promoteAttribute[\s\S]*3-vertex "poly" triangles/,
    );
  });

  it("rejects unknown mappings actionably", async () => {
    await expect(
      runNode(transferAttribute, { name: "val", mapping: "warp" }, geoms()),
    ).rejects.toThrow(/unknown mapping "warp"; valid mappings: nearest, uv, raycast/);
  });

  it("surfaces data-level errors naming the attribute and the fix", async () => {
    const noUv = createPointCloud(1);
    await expect(
      runNode(transferAttribute, { name: "val", mapping: "uv" }, {
        in: [makeGeometryItem(noUv)],
        source: [makeGeometryItem(quadSource())],
      }),
    ).rejects.toThrow(/destination point-domain UV attribute "uv" not found/);
    await expect(
      runNode(
        transferAttribute,
        { name: "val", mapping: "raycast", direction: [0, 0, 0] },
        geoms(),
      ),
    ).rejects.toThrow(/direction must be a finite, non-zero/);
    await expect(
      runNode(transferAttribute, { name: "ghost", mapping: "uv" }, geoms()),
    ).rejects.toThrow(/attribute "ghost" not found on source point domain/);
  });
});

describe("transferAttribute serialization", () => {
  /** dst -> uv transfer -> raycast transfer, sources injected via dataInput. */
  function buildGraph(): Graph {
    const g = new Graph(7);
    const dIn = g.add(dataInput, {}, "dstIn");
    const sIn = g.add(dataInput, {}, "srcIn");
    const uv = g.add(
      transferAttribute,
      { name: "val", mapping: "uv", missCountAttr: "uvMissed" },
      "uv",
    );
    const ray = g.add(
      transferAttribute,
      {
        name: "id",
        mapping: "raycast",
        direction: [0, -1, 0],
        maxDistance: 20,
        missCountAttr: "rayMissed",
      },
      "ray",
    );
    g.connect(dIn, "out", uv, "in");
    g.connect(sIn, "out", uv, "source");
    g.connect(uv, "out", ray, "in");
    g.connect(sIn, "out", ray, "source");
    g.output(ray, "out", "result");
    return g;
  }

  function bind(g: Graph): void {
    const dst = dstCloud([
      { p: [5, 7, 2.5], uv: [0.5, 0.25] }, // uv hit and raycast hit
      { p: [50, 7, 50], uv: [3, 3] }, // uv miss and raycast miss
    ]);
    g.setParam({ id: "dstIn" } as NodeHandle<DataInputParams>, "items", [makeGeometryItem(dst)]);
    g.setParam({ id: "srcIn" } as NodeHandle<DataInputParams>, "items", [
      makeGeometryItem(quadSource()),
    ]);
  }

  it("serializes all mapping params and survives a JSON round trip", () => {
    const json = serializeGraph(buildGraph());
    const uvNode = json.nodes.find((n) => n.id === "uv");
    expect(uvNode?.params).toEqual({
      name: "val",
      mapping: "uv",
      attrDomain: "point",
      uvAttr: "uv",
      direction: [0, -1, 0],
      directionAttr: "",
      maxDistance: 0,
      missCountAttr: "uvMissed",
      hitAttr: "",
    });
    const rayNode = json.nodes.find((n) => n.id === "ray");
    expect(rayNode?.params.mapping).toBe("raycast");
    expect(rayNode?.params.maxDistance).toBe(20);
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    const rebuilt = deserializeGraph(JSON.parse(JSON.stringify(json)));
    expect(serializeGraph(rebuilt)).toEqual(json);
  });

  it("cooks byte-identically after deserialization", async () => {
    const original = buildGraph();
    bind(original);
    const rebuilt = deserializeGraph(serializeGraph(original));
    bind(rebuilt);
    const a = await cook(original);
    const b = await cook(rebuilt);
    const geoA = firstGeo(a.outputs.result);
    const geoB = firstGeo(b.outputs.result);
    // Sanity: the cook really transferred and counted misses.
    expect(geoA.attrs.point.require("val").get(0)).toBeCloseTo(17.5, 5);
    expect(geoA.attrs.detail.require("uvMissed").get(0)).toBe(1);
    expect(geoA.attrs.detail.require("rayMissed").get(0)).toBe(1);
    expect(snapshotGeometry(geoB)).toEqual(snapshotGeometry(geoA));
  });

  it("rejects invalid mapping values at deserialization time", () => {
    const json = JSON.parse(JSON.stringify(serializeGraph(buildGraph()))) as {
      nodes: { id: string; params: Record<string, unknown> }[];
    };
    const uvNode = json.nodes.find((n) => n.id === "uv");
    if (!uvNode) throw new Error("uv node missing from serialized graph");
    uvNode.params.mapping = "teleport";
    expect(() => deserializeGraph(json)).toThrow(
      /node "uv" param "mapping": expected one of "nearest", "uv", "raycast"/,
    );
  });

  it("deserializes legacy params (name only) as the nearest mapping", async () => {
    const src = createPointCloud(2);
    (src.attrs.point.require("P").data as Float32Array).set([0, 0, 0, 9, 0, 0]);
    src.attrs.point.require("density").data.set([0.25, 0.75]);
    const dst = createPointCloud(2);
    (dst.attrs.point.require("P").data as Float32Array).set([1, 0, 0, 8, 0, 0]);
    const g = deserializeGraph({
      formatVersion: 1,
      seed: 0,
      nodes: [
        { id: "d", type: "dataInput", params: {} },
        { id: "s", type: "dataInput", params: {} },
        // Pre-mapping graphs carried only "name": defaults must fill in
        // mapping "nearest" and cook exactly like before.
        { id: "t", type: "transferAttribute", params: { name: "density" } },
      ],
      connections: [
        { from: ["d", "out"], to: ["t", "in"] },
        { from: ["s", "out"], to: ["t", "source"] },
      ],
      outputs: [{ id: "t", pin: "out", name: "result" }],
    });
    g.setParam({ id: "d" } as NodeHandle<DataInputParams>, "items", [makeGeometryItem(dst)]);
    g.setParam({ id: "s" } as NodeHandle<DataInputParams>, "items", [makeGeometryItem(src)]);
    const result = await cook(g);
    const geo = firstGeo(result.outputs.result);
    expect(Array.from(geo.attrs.point.require("density").data.subarray(0, 2))).toEqual([
      0.25, 0.75,
    ]);
  });
});
