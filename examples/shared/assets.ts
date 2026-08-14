/**
 * Placeholder instancing assets: cone / box / sphere keyed by assetId,
 * plus a stand-in for any id nobody registered.
 *
 * That stand-in is the point. `spawnInstances` can take asset ids from a
 * per-point string attribute (`assetAttr`), so a graph can name assets a
 * viewer has never heard of — and a viewer whose job is to show you an
 * ARBITRARY graph must draw something rather than refuse the whole cook,
 * which is what `toInstancedMeshes` does on an unknown id.
 *
 * **One shared fallback is not enough**, and the corpus proves it: a
 * graph that spawns by species emits several batches at once, and drawing
 * them all as the same magenta box makes the species MIX — the only thing
 * such a graph is about — invisible. So each unknown id gets its own
 * shape and hue, derived by hashing the id with the library's own
 * `hashString`. Same id, same look, every run and every machine: the
 * comparison between two renders stays about the graph.
 *
 * Every geometry is translated so its base sits on y = 0, which is the
 * pivot convention `place/drop-to-surface` assumes.
 */
import { hashString, type InstanceBatch } from "pcg-ts";
import type { AssetMap, InstancedAsset } from "pcg-ts/three";
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";

/** The named placeholder assets plus a factory for unrecognised ids. */
export interface PlaceholderAssets {
  readonly known: AssetMap;
  /** A deterministic stand-in for `assetId`, memoized per id. */
  fallbackFor(assetId: string): InstancedAsset;
}

/** Options for {@link createPlaceholderAssets}. */
export interface PlaceholderOptions {
  /**
   * Drop all hue: placeholders come out as greys told apart by
   * BRIGHTNESS rather than by colour.
   *
   * The distinctness is the point, not the palette. An invented asset's
   * colour is hashed from its id so two species never collide, and with
   * hue gone that whole job falls to lightness — which is why this is a
   * flag here rather than a saturation of 0 applied at the call site.
   */
  mono?: boolean;
}

/** Build the placeholder assets (geometry base sits on y = 0). */
export function createPlaceholderAssets(opts: PlaceholderOptions = {}): PlaceholderAssets {
  const mono = opts.mono === true;
  const mat = (color: number): MeshStandardMaterial =>
    new MeshStandardMaterial({ color, roughness: 0.75 });
  // Three greys far enough apart to read as three things under one light.
  const known: AssetMap = {
    cone: {
      geometry: new ConeGeometry(0.22, 0.9, 10).translate(0, 0.45, 0),
      material: mat(mono ? 0xb0b0b0 : 0x7fc79a),
    },
    box: {
      geometry: new BoxGeometry(0.42, 0.42, 0.42).translate(0, 0.21, 0),
      material: mat(mono ? 0xe4e4e4 : 0x6fb1ff),
    },
    sphere: {
      geometry: new SphereGeometry(0.3, 14, 10).translate(0, 0.3, 0),
      material: mat(mono ? 0x8a8a8a : 0xf4d35e),
    },
  };

  // Memoized: a viewer re-cooks on every edit, and minting a material per
  // batch per cook leaks one GPU program each time.
  const invented = new Map<string, InstancedAsset>();
  const shapes: ((h: number) => BufferGeometry)[] = [
    (h) => new ConeGeometry(0.18 + 0.1 * h, 0.7 + 0.6 * h, 9).translate(0, (0.7 + 0.6 * h) / 2, 0),
    (h) => new BoxGeometry(0.34, 0.5 + 0.5 * h, 0.34).translate(0, (0.5 + 0.5 * h) / 2, 0),
    (h) => new SphereGeometry(0.22 + 0.14 * h, 12, 8).translate(0, 0.22 + 0.14 * h, 0),
  ];

  return {
    known,
    fallbackFor(assetId) {
      const cached = invented.get(assetId);
      if (cached !== undefined) return cached;
      // hashString is the library's own seed hash, so this is stable
      // across runs, platforms and cook orders like everything else here.
      const hash = hashString(assetId);
      const unit = ((hash >>> 8) & 0xffff) / 0xffff;
      // The same hashed byte either picks a hue or picks a lightness. In
      // mono the range stops well short of both ends: pure black loses the
      // silhouette against the floor, pure white loses the shading that
      // says which way the geometry faces.
      const tone = ((hash >>> 4) & 0xff) / 0xff;
      const asset: InstancedAsset = {
        geometry: shapes[hash % shapes.length](unit),
        material: new MeshStandardMaterial({
          color: mono
            ? new Color().setHSL(0, 0, 0.42 + 0.46 * tone)
            : new Color().setHSL(tone, 0.55, 0.55),
          roughness: 0.75,
        }),
      };
      invented.set(assetId, asset);
      return asset;
    },
  };
}

/**
 * Asset map for one render pass: every batch's assetId resolves — known
 * ids to their placeholder, unknown ids to their own invented stand-in.
 */
export function resolveAssets(
  batches: readonly InstanceBatch[],
  assets: PlaceholderAssets,
): AssetMap {
  const map: AssetMap = {};
  for (const b of batches) {
    map[b.assetId] = assets.known[b.assetId] ?? assets.fallbackFor(b.assetId);
  }
  return map;
}
