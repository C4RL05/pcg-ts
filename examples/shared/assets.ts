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
 * TWO PIVOT CONVENTIONS LIVE HERE, and which one an asset uses is decided
 * by the node that spawns it rather than by taste:
 *
 *  - STANDING assets sit with their base on y = 0, because a point
 *    scatter puts a prop AT a point and `place/drop-to-surface` assumes
 *    that pivot. `cone`, `box`, `sphere`, `rod` and every invented
 *    fallback are these.
 *  - SPANNING assets are centred on the origin and one unit long on +Y,
 *    because `pathSegments` emits one oriented point per segment with a
 *    scale that stretches its asset to bridge the gap. A standing asset
 *    used this way is drawn half a segment off and cannot reach. `tube`
 *    and `chainLink` are these.
 *
 * A few are centred but not span-scaled — `bar`, `panel`, `clamp` — which
 * is the right pivot for something MOUNTED on a surface and aimed, where
 * the point is the middle of the fixture rather than its foot.
 *
 * The named set is a small VOCABULARY, not a list of three shapes. It
 * exists so a corpus graph that spawns `tube` gets a tube: an invented
 * stand-in keeps a graph visible, but it cannot keep it recognisable, and
 * a truss drawn out of spheres reads as something the graph never made.
 */
import { hashString, type InstanceBatch } from "pcg-ts";
import type { AssetMap, InstancedAsset } from "pcg-ts/three";
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  Curve,
  CylinderGeometry,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from "three";

/**
 * The outline of a chain link: two straights joined by half-round caps,
 * one unit tall overall so a link scales to the segment it spans.
 *
 * Walked by LENGTH rather than by equal angle steps, so the swept tube's
 * segments stay evenly spaced around the corners instead of bunching.
 */
class StadiumCurve extends Curve<Vector3> {
  /** Half the straight run, and the cap radius (half the width). */
  constructor(
    private readonly half: number,
    private readonly r: number,
  ) {
    super();
  }

  getPoint(t: number, target = new Vector3()): Vector3 {
    const straight = this.half * 2;
    const cap = Math.PI * this.r;
    const total = 2 * straight + 2 * cap;
    let s = t * total;
    if (s < straight) return target.set(this.r, -this.half + s, 0);
    s -= straight;
    if (s < cap) {
      const a = s / this.r;
      return target.set(Math.cos(a) * this.r, this.half + Math.sin(a) * this.r, 0);
    }
    s -= cap;
    if (s < straight) return target.set(-this.r, this.half - s, 0);
    s -= straight;
    const a = s / this.r;
    return target.set(-Math.cos(a) * this.r, -this.half - Math.sin(a) * this.r, 0);
  }
}

/** A link one unit long on +Y, as wide and as thick as these fractions of it. */
const LINK_WIDTH = 0.62;
const LINK_THICKNESS = 0.085;

/** The chord radius the collar is sized against — a rig's default. */
const CLAMP_CHORD = 0.055;

/** The named placeholder assets plus a factory for unrecognised ids. */
export interface PlaceholderAssets {
  readonly known: AssetMap;
  /** A deterministic stand-in for `assetId`, memoized per id. */
  fallbackFor(assetId: string): InstancedAsset;
}

/** Build the placeholder assets (see the two pivot conventions above). */
export function createPlaceholderAssets(): PlaceholderAssets {
  const mat = (color: number): MeshStandardMaterial =>
    new MeshStandardMaterial({ color, roughness: 0.75 });
  const known: AssetMap = {
    // Standing: base on y = 0, for a prop placed AT a point.
    cone: { geometry: new ConeGeometry(0.22, 0.9, 10).translate(0, 0.45, 0), material: mat(0x7fc79a) },
    box: { geometry: new BoxGeometry(0.42, 0.42, 0.42).translate(0, 0.21, 0), material: mat(0x6fb1ff) },
    sphere: { geometry: new SphereGeometry(0.3, 14, 10).translate(0, 0.3, 0), material: mat(0xf4d35e) },

    // Spanning: centred, one unit on +Y, for `pathSegments` to stretch
    // across a segment. `tube` is the workhorse — a chord, a brace, a
    // cable, a swagging drape are all one of these under a scale.
    tube: { geometry: new CylinderGeometry(1, 1, 1, 8), material: mat(0x8a94a6) },
    chainLink: {
      geometry: new TubeGeometry(
        new StadiumCurve(Math.max(0, (1 - LINK_WIDTH) / 2), LINK_WIDTH / 2),
        26,
        // The hole closes once the section is as fat as the cap, and past
        // that the tube turns itself inside out.
        Math.min(LINK_THICKNESS, LINK_WIDTH * 0.42),
        5,
        true,
      ),
      material: mat(0xb0b8c4),
    },

    // Mounted: centred, aimed by the graph rather than stood upright.
    rod: {
      geometry: new CylinderGeometry(0.045, 0.03, 1.6, 6).translate(0, 0.8, 0),
      material: mat(0xe0603c),
    },
    bar: { geometry: new BoxGeometry(0.1, 0.17, 1.5), material: mat(0x46c0a0) },
    panel: { geometry: new BoxGeometry(0.42, 0.3, 0.66), material: mat(0xd9b23c) },
    // A collar gripping one chord, axis +Z — already the direction a
    // chord runs, so it needs no rotation of its own.
    clamp: {
      geometry: new TorusGeometry(CLAMP_CHORD * 2.1, CLAMP_CHORD * 0.8, 5, 12),
      material: mat(0x7a6ce0),
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
      const asset: InstancedAsset = {
        geometry: shapes[hash % shapes.length](unit),
        material: new MeshStandardMaterial({
          color: new Color().setHSL(((hash >>> 4) & 0xff) / 0xff, 0.55, 0.55),
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
