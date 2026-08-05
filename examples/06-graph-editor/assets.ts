/**
 * Built-in placeholder assets for the viewport: cone / box / sphere keyed
 * by assetId. Unknown asset ids resolve to a visually distinct fallback so
 * `toInstancedMeshes` never throws on a typo'd id.
 */
import type { InstanceBatch } from "pcg-ts";
import type { AssetMap, InstancedAsset } from "pcg-ts/three";
import { BoxGeometry, ConeGeometry, MeshStandardMaterial, SphereGeometry } from "three";

/** The named placeholder assets plus the unknown-id fallback. */
export interface EditorAssets {
  readonly known: AssetMap;
  readonly fallback: InstancedAsset;
}

/** Build the placeholder assets (geometry base sits on y = 0). */
export function createBaseAssets(): EditorAssets {
  const mat = (color: number): MeshStandardMaterial =>
    new MeshStandardMaterial({ color, roughness: 0.75 });
  return {
    known: {
      cone: { geometry: new ConeGeometry(0.22, 0.9, 10).translate(0, 0.45, 0), material: mat(0x7fc79a) },
      box: { geometry: new BoxGeometry(0.42, 0.42, 0.42).translate(0, 0.21, 0), material: mat(0x6fb1ff) },
      sphere: { geometry: new SphereGeometry(0.3, 14, 10).translate(0, 0.3, 0), material: mat(0xf4d35e) },
    },
    fallback: {
      geometry: new BoxGeometry(0.3, 0.3, 0.3).translate(0, 0.15, 0),
      material: mat(0xd070d8),
    },
  };
}

/**
 * Asset map for one render pass: every batch's assetId resolves — known
 * ids to their placeholder, unknown ids to the fallback.
 */
export function resolveAssets(batches: readonly InstanceBatch[], assets: EditorAssets): AssetMap {
  const map: AssetMap = {};
  for (const b of batches) {
    map[b.assetId] = assets.known[b.assetId] ?? assets.fallback;
  }
  return map;
}
