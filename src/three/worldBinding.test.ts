import { BoxGeometry, Group, InstancedMesh, MeshBasicMaterial, Points } from "three";
import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import { makeGeometryItem, makeInstancesItem, makeValueItem } from "../graph/index.js";
import { buildInstanceBatches } from "../spawn/instances.js";
import { WorldThreeBinding } from "./worldBinding.js";

function makeAssets() {
  return { tree: { geometry: new BoxGeometry(), material: new MeshBasicMaterial() } };
}

function makeOutputs() {
  const cloud = createPointCloud(3);
  const batches = buildInstanceBatches(cloud, { defaultAssetId: "tree" });
  return {
    main: [makeInstancesItem(batches), makeGeometryItem(cloud), makeValueItem(1)],
  };
}

describe("WorldThreeBinding", () => {
  it("cellReady adds one named group with instanced meshes (and debug points when enabled)", () => {
    const root = new Group();
    const binding = new WorldThreeBinding({ group: root, assets: makeAssets(), debugPoints: true });
    binding.cellReady("ground", [2, -3], makeOutputs());
    expect(binding.cellCount).toBe(1);
    expect(root.children).toHaveLength(1);
    const cell = root.children[0];
    expect(cell.name).toBe("ground|2,-3");
    const meshes = cell.children.filter((c) => c instanceof InstancedMesh);
    const points = cell.children.filter((c) => c instanceof Points);
    expect(meshes).toHaveLength(1);
    expect((meshes[0] as InstancedMesh).count).toBe(3);
    expect(points).toHaveLength(1);
  });

  it("ignores geometry items when debugPoints is off", () => {
    const root = new Group();
    const binding = new WorldThreeBinding({ group: root, assets: makeAssets() });
    binding.cellReady("ground", [0, 0], makeOutputs());
    const cell = root.children[0];
    expect(cell.children.filter((c) => c instanceof Points)).toHaveLength(0);
    expect(cell.children.filter((c) => c instanceof InstancedMesh)).toHaveLength(1);
  });

  it("a recook of the same cell replaces its group and disposes the old resources", () => {
    const root = new Group();
    const binding = new WorldThreeBinding({ group: root, assets: makeAssets(), debugPoints: true });
    binding.cellReady("ground", [1, 1], makeOutputs());
    const oldCell = root.children[0];
    const oldPoints = oldCell.children.find((c) => c instanceof Points) as Points;
    let disposed = 0;
    oldPoints.geometry.addEventListener("dispose", () => disposed++);
    binding.cellReady("ground", [1, 1], makeOutputs());
    expect(binding.cellCount).toBe(1);
    expect(root.children).toHaveLength(1);
    expect(root.children[0]).not.toBe(oldCell);
    expect(disposed).toBe(1);
  });

  it("a failing rebuild leaves the previous cell content intact (swap semantics)", () => {
    const root = new Group();
    const assets = makeAssets();
    const binding = new WorldThreeBinding({ group: root, assets, debugPoints: true });
    binding.cellReady("ground", [4, 4], makeOutputs());
    const oldCell = root.children[0];

    // Recook whose outputs reference an unknown asset — after a batch that
    // builds fine, so the partial-build disposal path is exercised too.
    const badOutputs = {
      main: [
        makeInstancesItem(buildInstanceBatches(createPointCloud(2), { defaultAssetId: "tree" })),
        makeInstancesItem([{ assetId: "unknown", count: 0, transforms: new Float32Array(0) }]),
      ],
    };
    expect(() => binding.cellReady("ground", [4, 4], badOutputs)).toThrow(/unknown assetId/);

    // The previous content is still visible and registered.
    expect(binding.cellCount).toBe(1);
    expect(root.children).toHaveLength(1);
    expect(root.children[0]).toBe(oldCell);
    expect(oldCell.children.filter((c) => c instanceof InstancedMesh)).toHaveLength(1);

    // A later successful ready still replaces it.
    binding.cellReady("ground", [4, 4], makeOutputs());
    expect(binding.cellCount).toBe(1);
    expect(root.children).toHaveLength(1);
    expect(root.children[0]).not.toBe(oldCell);
  });

  it("cellEvicted removes the group, disposes per-cell resources, and leaks no children", () => {
    const root = new Group();
    const assets = makeAssets();
    const binding = new WorldThreeBinding({ group: root, assets, debugPoints: true });
    binding.cellReady("ground", [0, 0], makeOutputs());
    binding.cellReady("ground", [1, 0], makeOutputs());
    expect(root.children).toHaveLength(2);

    const cell = root.children[0];
    const mesh = cell.children.find((c) => c instanceof InstancedMesh) as InstancedMesh;
    const points = cell.children.find((c) => c instanceof Points) as Points;
    let meshDisposed = 0;
    let geoDisposed = 0;
    let assetGeoDisposed = 0;
    mesh.addEventListener("dispose", () => meshDisposed++);
    points.geometry.addEventListener("dispose", () => geoDisposed++);
    assets.tree.geometry.addEventListener("dispose", () => assetGeoDisposed++);

    binding.cellEvicted("ground", [0, 0]);
    expect(binding.cellCount).toBe(1);
    expect(root.children).toHaveLength(1);
    expect(meshDisposed).toBe(1);
    expect(geoDisposed).toBe(1);
    // Shared asset geometry must never be disposed by the binding.
    expect(assetGeoDisposed).toBe(0);

    // Evicting an unknown cell is a no-op.
    binding.cellEvicted("ground", [99, 99]);
    expect(binding.cellCount).toBe(1);

    binding.dispose();
    expect(binding.cellCount).toBe(0);
    expect(root.children).toHaveLength(0);
    expect(assetGeoDisposed).toBe(0);
  });
});
