import { describe, expect, it } from "vitest";
import { createPointCloud, createTriangleMesh, transferNearest, type Geometry } from "../data/index.js";
import { Graph, cook, makeGeometryItem, type NodeHandle } from "../graph/index.js";
import { dataInput, type DataInputParams } from "../runtime/dataInput.js";
import { deserializeGraph, getNodeType, serializeGraph, transferAttribute } from "./index.js";
import { firstGeo, runNode, snapshotGeometry } from "./testSupport.js";

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
      "mapping",
      "maxDistance",
      "missCountAttr",
      "name",
      "uvAttr",
    ]);
    expect(info.params.mapping.enum).toEqual(["nearest", "uv", "raycast"]);
    expect(info.params.mapping.default).toBe("nearest");
    expect(info.params.attrDomain.enum).toEqual(["point", "vertex"]);
    expect(info.params.attrDomain.default).toBe("point");
    expect(info.params.uvAttr.default).toBe("uv");
    expect(info.params.direction.type).toBe("vec3");
    expect(info.params.direction.default).toEqual([0, -1, 0]);
    expect(info.params.directionAttr.default).toBe("");
    expect(info.params.maxDistance.default).toBe(0);
    expect(info.params.maxDistance.min).toBe(0);
    expect(info.params.missCountAttr.default).toBe("");
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
