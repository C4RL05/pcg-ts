/**
 * Instance batches → THREE.InstancedMesh. The renderer-side half of the
 * core spawner protocol.
 */
import {
  InstancedBufferAttribute,
  InstancedMesh,
  type BufferGeometry,
  type Material,
} from "three";
import type { InstanceBatch } from "../graph/data.js";

/** One renderable asset shared by every instance of an asset id. */
export interface InstancedAsset {
  readonly geometry: BufferGeometry;
  readonly material: Material | Material[];
}

/** Asset id → renderable, the lookup instance batches resolve against. */
export type AssetMap = Record<string, InstancedAsset>;

/**
 * Clone an asset's material slot for one mesh.
 *
 * Every mesh gets its OWN material instance on purpose, and the reason is
 * three's renderer bookkeeping, not appearance: `WebGPURenderer` keys an
 * instanced mesh's render state (its `RenderObject`, built shaders,
 * pipeline and uniform buffers) per mesh — `RenderObject.
 * getMaterialCacheKey()` appends `object.uuid` for instanced meshes — and
 * releases ALL of it through exactly one signal, the `dispose` event of
 * the material that mesh rendered with. A shared asset material never
 * fires that event mid-session, so in a streaming world every evicted
 * mesh's render state would stay cached forever (measured: three's
 * program count climbing ~15 per cooked cell and never returning).
 * A per-mesh clone gives each mesh a material whose `dispose()` releases
 * precisely that mesh's render state and nobody else's. The clone is
 * shallow where it matters: textures and node graphs are shared by
 * reference, so no GPU resource is duplicated.
 *
 * `renderStateRelease.test.ts` pins the three internals this leans on.
 */
export function cloneAssetMaterial(material: Material | Material[]): Material | Material[] {
  return Array.isArray(material) ? material.map((m) => m.clone()) : material.clone();
}

/** A mesh's material slot as a list, whichever shape it has. */
export function materialListOf(material: Material | Material[]): readonly Material[] {
  return Array.isArray(material) ? material : [material];
}

/**
 * Create one `THREE.InstancedMesh` per batch, resolving each batch's
 * `assetId` in `assets` (unknown ids throw, listing the known ids).
 * Batch transforms are already in `Matrix4.elements` layout, so they are
 * copied straight into `instanceMatrix`. Each mesh is named after its
 * asset id and gets its bounding sphere computed over the instances so
 * frustum culling is correct.
 *
 * A batch carrying `colors` also gets an `instanceColor`, which three
 * multiplies into the material's own colour with no material change
 * needed (`instanceColor !== null` is what defines `USE_INSTANCING_COLOR`
 * for the program). A batch WITHOUT colour leaves `instanceColor` at
 * `null`, so a spawn that never asked for colour draws through exactly
 * the shader variant it always did.
 *
 * Ownership: each mesh's MATERIAL is a per-mesh clone of the asset's
 * (see {@link cloneAssetMaterial} for why: it is the one lever that lets
 * three's renderer release the mesh's cached render state). Dispose it
 * with the mesh:
 *
 * ```ts
 * mesh.dispose(); // per-mesh GPU state (the instance-matrix buffer)
 * for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
 * ```
 *
 * `WorldThreeBinding` does exactly this on every release path. The asset
 * GEOMETRY (and any textures the material references) stays shared by
 * reference — dispose those with the asset map, never per mesh. If a
 * batch mid-list fails validation, the materials already cloned for
 * earlier batches are disposed before the error propagates, so a
 * throwing build mints nothing that outlives it.
 */
export function toInstancedMeshes(
  batches: readonly InstanceBatch[],
  assets: AssetMap,
): InstancedMesh[] {
  const meshes: InstancedMesh[] = [];
  try {
    for (const batch of batches) {
      const asset = assets[batch.assetId];
      if (!asset) {
        const known = Object.keys(assets).sort().join(", ");
        throw new Error(
          `toInstancedMeshes: unknown assetId "${batch.assetId}"; known assets: ` +
            (known === "" ? "(none)" : known),
        );
      }
      if (batch.transforms.length !== batch.count * 16) {
        throw new Error(
          `toInstancedMeshes: batch "${batch.assetId}" has ${batch.transforms.length} transform ` +
            `floats, expected count * 16 = ${batch.count * 16}`,
        );
      }
      if (batch.colors && batch.colors.length !== batch.count * 3) {
        throw new Error(
          `toInstancedMeshes: batch "${batch.assetId}" has ${batch.colors.length} colour ` +
            `floats, expected count * 3 = ${batch.count * 3} (rgb per instance; alpha is dropped ` +
            `at the spawner)`,
        );
      }
      const mesh = new InstancedMesh(asset.geometry, cloneAssetMaterial(asset.material), batch.count);
      (mesh.instanceMatrix.array as Float32Array).set(batch.transforms);
      mesh.instanceMatrix.needsUpdate = true;
      if (batch.colors) {
        // Copied, like the transforms: the batch belongs to a cached graph
        // item that may back several meshes, and three writes through
        // `setColorAt` into whatever array it is given.
        mesh.instanceColor = new InstancedBufferAttribute(batch.colors.slice(), 3);
        mesh.instanceColor.needsUpdate = true;
      }
      mesh.name = batch.assetId;
      mesh.computeBoundingSphere();
      meshes.push(mesh);
    }
  } catch (err) {
    // A later batch's validation failure discards the earlier batches'
    // meshes — they are local to this call and the caller never sees
    // them, so their material clones must not outlive it. None has been
    // rendered yet, so disposal here is inert bookkeeping, not GPU work.
    for (const mesh of meshes) {
      mesh.dispose();
      for (const material of materialListOf(mesh.material)) material.dispose();
    }
    throw err;
  }
  return meshes;
}
