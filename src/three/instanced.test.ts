import { BoxGeometry, Color, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import { buildInstanceBatches } from "../spawn/instances.js";
import { toInstancedMeshes, type AssetMap } from "./instanced.js";

function assets(...ids: string[]): AssetMap {
  const map: AssetMap = {};
  for (const id of ids) {
    map[id] = { geometry: new BoxGeometry(), material: new MeshBasicMaterial() };
  }
  return map;
}

describe("toInstancedMeshes", () => {
  it("per-instance matrices match three's own Matrix4.compose", () => {
    // Arbitrary transforms; quaternions built by three itself.
    const rows: Array<{ p: Vector3; q: Quaternion; s: Vector3 }> = [
      {
        p: new Vector3(1, 2, 3),
        q: new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.7),
        s: new Vector3(2, 0.5, 1.25),
      },
      {
        p: new Vector3(-4, 0.25, 9),
        q: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2),
        s: new Vector3(1, 1, 1),
      },
      {
        p: new Vector3(0, -1, 0.5),
        q: new Quaternion().setFromAxisAngle(new Vector3(-2, 1, 5).normalize(), 2.4),
        s: new Vector3(0.1, 3, 0.7),
      },
    ];
    const geo = createPointCloud(rows.length);
    const P = geo.attrs.point.require("P");
    const rot = geo.attrs.point.require("rot");
    const scale = geo.attrs.point.require("scale");
    rows.forEach(({ p, q, s }, i) => {
      P.setTuple(i, [p.x, p.y, p.z]);
      rot.setTuple(i, [q.x, q.y, q.z, q.w]);
      scale.setTuple(i, [s.x, s.y, s.z]);
    });

    const batches = buildInstanceBatches(geo, { defaultAssetId: "a" });
    const [mesh] = toInstancedMeshes(batches, assets("a"));
    expect(mesh.count).toBe(rows.length);
    expect(mesh.name).toBe("a");
    expect(mesh.instanceMatrix.array).toHaveLength(rows.length * 16);

    const got = new Matrix4();
    rows.forEach(({ p, q, s }, i) => {
      mesh.getMatrixAt(i, got);
      const expected = new Matrix4().compose(p, q, s);
      // Expected is f64; ours went through f32 storage — compare within 1e-6.
      got.elements.forEach((v, k) => {
        expect(Math.abs(v - expected.elements[k]), `instance ${i} element ${k}`).toBeLessThan(1e-6);
      });
    });
  });

  it("builds one mesh per batch, sharing asset geometry and material", () => {
    const geo = createPointCloud(3);
    const attr = geo.attrs.point.add("asset", "string", 1, "");
    attr.setString(0, "tree");
    attr.setString(1, "rock");
    attr.setString(2, "tree");
    const batches = buildInstanceBatches(geo, { defaultAssetId: "d", assetAttr: "asset" });
    const map = assets("tree", "rock");
    const meshes = toInstancedMeshes(batches, map);
    expect(meshes.map((m) => m.name)).toEqual(["tree", "rock"]);
    expect(meshes.map((m) => m.count)).toEqual([2, 1]);
    expect(meshes[0].geometry).toBe(map.tree.geometry);
    expect(meshes[0].material).toBe(map.tree.material);
  });

  it("unknown assetId throws, listing the known ids", () => {
    const batches = buildInstanceBatches(createPointCloud(1), { defaultAssetId: "bush" });
    expect(() => toInstancedMeshes(batches, assets("tree", "rock"))).toThrow(
      /unknown assetId "bush".*rock, tree/,
    );
    expect(() => toInstancedMeshes(batches, {})).toThrow(/\(none\)/);
  });

  it("rejects a batch whose transform length disagrees with its count", () => {
    expect(() =>
      toInstancedMeshes(
        [{ assetId: "a", count: 2, transforms: new Float32Array(16) }],
        assets("a"),
      ),
    ).toThrow(/count \* 16/);
  });
});

describe("toInstancedMeshes per-instance colour", () => {
  /** Cloud of `n` points at x = i, red channel encoding i / 10. */
  function paintedCloud(n: number) {
    const geo = createPointCloud(n);
    const P = geo.attrs.point.require("P");
    const color = geo.attrs.point.require("color");
    for (let i = 0; i < n; i++) {
      P.setTuple(i, [i, 0, 0]);
      color.setTuple(i, [i / 10, 0.25, 0.5, 0.75]);
    }
    return geo;
  }

  it("leaves instanceColor null when the batch carries no colour", () => {
    // Every cloud has a `color` attribute at [1,1,1,1]; a spawn that did
    // not ask for it must not flip three's instancing-colour variant.
    const batches = buildInstanceBatches(paintedCloud(3), { defaultAssetId: "a" });
    const [mesh] = toInstancedMeshes(batches, assets("a"));
    expect(mesh.instanceColor).toBeNull();
  });

  it("writes instanceColor from a batch that carries colour", () => {
    const batches = buildInstanceBatches(paintedCloud(3), {
      defaultAssetId: "a",
      colorAttr: "color",
    });
    const [mesh] = toInstancedMeshes(batches, assets("a"));
    const instanceColor = mesh.instanceColor;
    if (!instanceColor) throw new Error("expected an instanceColor attribute");
    expect(instanceColor.itemSize).toBe(3);
    expect(instanceColor.count).toBe(3);
    const got = new Color();
    for (let i = 0; i < 3; i++) {
      mesh.getColorAt(i, got);
      expect(got.r).toBeCloseTo(i / 10, 6);
      expect(got.g).toBeCloseTo(0.25, 6);
      expect(got.b).toBeCloseTo(0.5, 6);
    }
  });

  it("copies the colours: the mesh does not alias the batch's buffer", () => {
    const batches = buildInstanceBatches(paintedCloud(2), {
      defaultAssetId: "a",
      colorAttr: "color",
    });
    const [mesh] = toInstancedMeshes(batches, assets("a"));
    (mesh.instanceColor?.array as Float32Array)[0] = 42;
    expect(batches[0].colors?.[0]).toBe(0);
  });

  it("rejects a batch whose colour length disagrees with its count", () => {
    expect(() =>
      toInstancedMeshes(
        [
          {
            assetId: "a",
            count: 2,
            transforms: new Float32Array(32),
            colors: new Float32Array(3),
          },
        ],
        assets("a"),
      ),
    ).toThrow(/count \* 3/);
  });
});
