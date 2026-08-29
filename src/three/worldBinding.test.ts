import { BoxGeometry, Group, InstancedMesh, MeshBasicMaterial, Points, type Material } from "three";
import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import { makeGeometryItem, makeInstancesItem, makeValueItem } from "../graph/index.js";
import { buildInstanceBatches } from "../spawn/instances.js";
import { ownsMaterial } from "./instanced.js";
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

/**
 * Per-mesh material lifecycle. Each instanced mesh's material is a clone
 * `toInstancedMeshes` mints, and its `dispose` event is the ONE signal
 * three's renderer accepts to drop that mesh's cached render state
 * (render object, built shaders, pipeline, uniform buffers — see
 * renderStateRelease.test.ts for the pinned three internals). These
 * tests pin that the binding fires it on every release path — evict,
 * recook swap, partial build failure, teardown — exactly once per minted
 * material, and never at the asset map's own material.
 */
describe("WorldThreeBinding per-mesh material lifecycle", () => {
  /** An asset map whose material records every clone it mints and every dispose those clones receive. */
  function trackedAssets() {
    const material = new MeshBasicMaterial();
    const minted: Material[] = [];
    const disposed: Material[] = [];
    const originalClone = material.clone.bind(material);
    material.clone = () => {
      const clone = originalClone();
      minted.push(clone);
      clone.addEventListener("dispose", () => disposed.push(clone));
      return clone;
    };
    let assetDisposed = 0;
    material.addEventListener("dispose", () => assetDisposed++);
    return {
      assets: { tree: { geometry: new BoxGeometry(), material } },
      minted,
      disposed,
      assetDisposeCount: () => assetDisposed,
    };
  }

  function treeOutputs(points = 3) {
    const cloud = createPointCloud(points);
    return { main: [makeInstancesItem(buildInstanceBatches(cloud, { defaultAssetId: "tree" }))] };
  }

  it("evict disposes each mesh's material exactly once, and never the asset's", () => {
    const { assets, minted, disposed, assetDisposeCount } = trackedAssets();
    const binding = new WorldThreeBinding({ group: new Group(), assets });
    binding.cellReady("ground", [0, 0], treeOutputs());
    binding.cellReady("ground", [1, 0], treeOutputs());
    expect(minted).toHaveLength(2);
    expect(disposed).toHaveLength(0);

    binding.cellEvicted("ground", [0, 0]);
    expect(disposed).toEqual([minted[0]]);

    binding.cellEvicted("ground", [1, 0]);
    expect(disposed).toEqual(minted);
    // Exactly once each: a double dispose would appear as a repeat.
    expect(new Set(disposed).size).toBe(disposed.length);
    expect(assetDisposeCount(), "the asset map's material is the caller's").toBe(0);
  });

  it("a recook swap disposes the outgoing meshes' materials and keeps the incoming alive", () => {
    const { assets, minted, disposed } = trackedAssets();
    const binding = new WorldThreeBinding({ group: new Group(), assets });
    binding.cellReady("ground", [2, 2], treeOutputs());
    binding.cellReady("ground", [2, 2], treeOutputs());
    expect(minted).toHaveLength(2);
    expect(disposed, "only the replaced cook's material").toEqual([minted[0]]);
    binding.dispose();
    expect(disposed).toEqual(minted);
  });

  it("a partial build failure disposes the materials of the meshes it already built", () => {
    const { assets, minted, disposed, assetDisposeCount } = trackedAssets();
    const binding = new WorldThreeBinding({ group: new Group(), assets });
    const outputs = {
      main: [
        makeInstancesItem(buildInstanceBatches(createPointCloud(2), { defaultAssetId: "tree" })),
        makeInstancesItem(buildInstanceBatches(createPointCloud(1), { defaultAssetId: "missing" })),
      ],
    };
    expect(() => binding.cellReady("ground", [0, 0], outputs)).toThrow(/unknown assetId/);
    expect(minted, "the first item's mesh was built before the second threw").toHaveLength(1);
    expect(disposed, "…and its material must not outlive the failed cell").toEqual(minted);
    expect(binding.cellCount).toBe(0);
    expect(assetDisposeCount()).toBe(0);
  });

  it("binding.dispose() disposes every live cell's mesh materials", () => {
    const { assets, minted, disposed, assetDisposeCount } = trackedAssets();
    const binding = new WorldThreeBinding({ group: new Group(), assets });
    for (const coord of [
      [0, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      binding.cellReady("ground", coord, treeOutputs());
    }
    expect(minted).toHaveLength(3);
    binding.dispose();
    expect(disposed).toEqual(minted);
    expect(new Set(disposed).size).toBe(3);
    expect(assetDisposeCount()).toBe(0);
  });

  it("a sustained cook/evict churn disposes one material per cook — nothing accumulates", () => {
    const { assets, minted, disposed } = trackedAssets();
    const binding = new WorldThreeBinding({ group: new Group(), assets });
    for (let i = 0; i < 60; i++) {
      const coord: [number, number] = [i % 5, 0];
      binding.cellReady("ground", coord, treeOutputs(2));
      if (i >= 5) binding.cellEvicted("ground", [(i - 5) % 5, 0]);
    }
    binding.dispose();
    expect(minted).toHaveLength(60);
    // Every minted material disposed exactly once — recook swaps and
    // evictions interleave, so the order differs from mint order.
    expect(disposed).toHaveLength(60);
    expect(new Set(disposed).size).toBe(60);
    expect(new Set(disposed)).toEqual(new Set(minted));
  });
});

/**
 * Host-supplied materials, forwarded (`materialFor`).
 *
 * The binding is where the leak the per-mesh clone exists to prevent was
 * MEASURED, so it is also where the escape hatch has to be honoured: a
 * host that supplies its own pooled material keeps its lifetime, and a
 * cell going out of radius must not fire `dispose` on a material every
 * live cell is still drawing through — that would drop their render
 * state, not just its own.
 *
 * `materialFor` is the ONLY `ToInstancedMeshesOptions` field forwarded
 * here. `requireChannels` is one all-or-nothing list across every batch,
 * which a heterogeneous world cannot state; a per-batch callback has the
 * per-asset lever it is missing.
 */
describe("WorldThreeBinding materialFor", () => {
  /** Asset map recording every clone minted and every dispose those clones took. */
  function trackedAssets(...ids: string[]) {
    const map: Record<string, { geometry: BoxGeometry; material: Material }> = {};
    const minted: Material[] = [];
    const disposed: Material[] = [];
    for (const id of ids) {
      const material = new MeshBasicMaterial();
      const originalClone = material.clone.bind(material);
      material.clone = () => {
        const clone = originalClone();
        minted.push(clone);
        clone.addEventListener("dispose", () => disposed.push(clone));
        return clone;
      };
      map[id] = { geometry: new BoxGeometry(), material };
    }
    return { assets: map, minted, disposed };
  }

  function pooledMaterial() {
    const material = new MeshBasicMaterial();
    const disposed: Material[] = [];
    material.addEventListener("dispose", () => disposed.push(material));
    return { material, disposed };
  }

  const itemFor = (assetId: string, n = 2) =>
    makeInstancesItem(buildInstanceBatches(createPointCloud(n), { defaultAssetId: assetId }));

  it("forwards the callback: the cell's mesh draws the host's material and no clone is minted", () => {
    const { assets, minted } = trackedAssets("tree");
    const { material: pooled } = pooledMaterial();
    const root = new Group();
    const binding = new WorldThreeBinding({ group: root, assets, materialFor: () => pooled });
    binding.cellReady("ground", [0, 0], { main: [itemFor("tree")] });
    const mesh = root.children[0].children[0] as InstancedMesh;
    expect(mesh.material).toBe(pooled);
    expect(ownsMaterial(mesh)).toBe(false);
    expect(minted, "the binding minted nothing").toHaveLength(0);
  });

  it("never disposes it on evict, recook, a failed build or teardown", () => {
    const { assets, minted } = trackedAssets("tree");
    const { material: pooled, disposed } = pooledMaterial();
    const root = new Group();
    const binding = new WorldThreeBinding({ group: root, assets, materialFor: () => pooled });
    /**
     * Every leg below asserts the pooled material was NOT disposed, and
     * that is only meaningful once this cell is proved to be drawing it:
     * a binding that forwarded nothing would mint clones, never touch
     * `pooled`, and pass the same assertions saying nothing at all.
     */
    const built = (coord: readonly [number, number]) => {
      const cell = root.children.find((c) => c.name === `ground|${coord.join(",")}`);
      const mesh = cell?.children.find((c) => c instanceof InstancedMesh) as InstancedMesh;
      expect(mesh.material, "the precondition: this mesh really draws the pooled material").toBe(
        pooled,
      );
      expect(ownsMaterial(mesh)).toBe(false);
      return mesh;
    };

    // evict
    binding.cellReady("ground", [0, 0], { main: [itemFor("tree")] });
    built([0, 0]);
    binding.cellEvicted("ground", [0, 0]);
    expect(disposed, "evict").toEqual([]);
    // recook swap
    binding.cellReady("ground", [1, 0], { main: [itemFor("tree")] });
    binding.cellReady("ground", [1, 0], { main: [itemFor("tree")] });
    built([1, 0]);
    expect(disposed, "recook swap").toEqual([]);
    // partial build failure: the first item builds, the second throws,
    // and the failed cell's teardown runs over a mesh drawing `pooled`.
    expect(() =>
      binding.cellReady("ground", [2, 0], { main: [itemFor("tree"), itemFor("missing", 1)] }),
    ).toThrow(/unknown assetId/);
    expect(disposed, "partial build failure").toEqual([]);
    // teardown
    binding.dispose();
    expect(disposed, "dispose()").toEqual([]);
    expect(binding.cellCount).toBe(0);
    expect(minted, "not one clone was minted along the way").toHaveLength(0);
  });

  it("still disposes the clones of the batches the callback passed on", () => {
    // Both behaviours in ONE binding, which is the shape a real host has:
    // pooled for the assets its shader knows, the default clone for the
    // rest. Getting this wrong in either direction is silent.
    const { assets, minted, disposed } = trackedAssets("tree", "rock");
    const { material: pooled, disposed: pooledDisposed } = pooledMaterial();
    const root = new Group();
    const binding = new WorldThreeBinding({
      group: root,
      assets,
      materialFor: (batch) => (batch.assetId === "tree" ? pooled : undefined),
    });
    binding.cellReady("ground", [0, 0], { main: [itemFor("tree"), itemFor("rock", 1)] });
    expect(minted, "one clone, for the rock batch only").toHaveLength(1);
    const meshes = root.children[0].children.filter(
      (c): c is InstancedMesh => c instanceof InstancedMesh,
    );
    expect(meshes.map((m) => ownsMaterial(m))).toEqual([false, true]);

    binding.cellEvicted("ground", [0, 0]);
    expect(disposed, "the minted clone is released as it always was").toEqual(minted);
    expect(pooledDisposed, "the host's material is not").toEqual([]);
  });

  it("a binding with no materialFor behaves exactly as before", () => {
    const { assets, minted, disposed } = trackedAssets("tree");
    const binding = new WorldThreeBinding({ group: new Group(), assets });
    binding.cellReady("ground", [0, 0], { main: [itemFor("tree")] });
    expect(minted).toHaveLength(1);
    binding.dispose();
    expect(disposed).toEqual(minted);
  });
});
