/**
 * Instance batches → THREE.InstancedMesh. The renderer-side half of the
 * core spawner protocol.
 */
import { InstancedBufferAttribute, InstancedMesh, type BufferGeometry, type Material } from "three";
import type { InstanceBatch } from "../graph/data.js";

/** One renderable asset shared by every instance of an asset id. */
export interface InstancedAsset {
  readonly geometry: BufferGeometry;
  readonly material: Material | Material[];
}

/** Asset id → renderable, the lookup instance batches resolve against. */
export type AssetMap = Record<string, InstancedAsset>;

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
 * Ownership: the meshes share the asset geometry/material by reference —
 * dispose those with the assets, not per mesh. Per-mesh GPU state (the
 * instance-matrix buffer) is released by `InstancedMesh.dispose()`.
 */
export function toInstancedMeshes(
  batches: readonly InstanceBatch[],
  assets: AssetMap,
): InstancedMesh[] {
  const meshes: InstancedMesh[] = [];
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
    const mesh = new InstancedMesh(asset.geometry, asset.material, batch.count);
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
  return meshes;
}
