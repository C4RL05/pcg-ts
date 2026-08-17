/**
 * Placeholder instancing assets keyed by assetId, plus a stand-in for any
 * id nobody registered.
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
 *    that pivot. The primitives (`cone`, `box`, `sphere`), all the
 *    scenery (`pine`, `birch`, `willow`, `bush`, `boulder`, `house`,
 *    `hall`, `barn`, `post`, `lamp`), `rod`, and every invented fallback
 *    are these.
 *  - SPANNING assets are centred on the origin and one unit long on +Y,
 *    because `pathSegments` emits one oriented point per segment with a
 *    scale that stretches its asset to bridge the gap. A standing asset
 *    used this way is drawn half a segment off and cannot reach. `tube`
 *    and `chainLink` are these.
 *
 * A few are centred but not span-scaled — `bar`, `panel`, `clamp`, `log`
 * — which is the right pivot for something MOUNTED on a surface and
 * aimed, where the point is the middle of the fixture rather than its
 * foot. These lie along +Z, `orientAlongVector`'s default axis, unlike
 * the spanning pair above; a driftwood log aimed at a bank and a brace
 * aimed at a chord are the same problem.
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
  IcosahedronGeometry,
  LatheGeometry,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
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

/**
 * A surface of revolution from `[radius, height]` pairs, bottom to top.
 *
 * The vegetation's shape language. A tree placeholder wants a trunk AND a
 * crown, which two primitives could give — but an `InstancedAsset` is one
 * geometry and one material, so two primitives would mean merging them or
 * accepting two draws per tree. A profile spun about +Y is both at once,
 * and it lands with its base already on y = 0, which is the pivot every
 * standing asset here owes its caller.
 */
function lathe(
  profile: readonly (readonly [number, number])[],
  segments: number,
  phiStart = 0,
): BufferGeometry {
  return new LatheGeometry(
    profile.map(([radius, height]) => new Vector2(radius, height)),
    segments,
    phiStart,
  );
}

/**
 * The vocabulary as DATA, so it can be listed without building geometry.
 *
 * `createPlaceholderAssets` returns live three.js meshes, which makes the
 * only existing answer to "what ids does this viewer know?" require a
 * WebGL-capable context to ask. That is the wrong shape for the question:
 * `pcg assets <graph.json>` reports the ids a graph NEEDS, and the useful
 * follow-up is comparing that list against this one — from a script, from
 * a test, from a terminal.
 *
 * Kept honest by `tests/sharedAssets.test.ts` rather than by care: the
 * map below is asserted to hold exactly these keys, in both directions,
 * so an asset added to one and not the other is a failure rather than a
 * silent omission.
 */
export const PLACEHOLDER_ASSET_IDS: readonly string[] = [
  "cone",
  "box",
  "sphere",
  "tube",
  "chainLink",
  "rod",
  "bar",
  "panel",
  "clamp",
  "pine",
  "birch",
  "bush",
  "boulder",
  "house",
  "hall",
  "barn",
  "post",
  "lamp",
  "willow",
  "log",
];

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
   *
   * NO CALLER TODAY. It covers the primitives (`cone`, `box`, `sphere`),
   * the scenery (`pine`, `birch`, `willow`, `bush`, `boulder`, `house`,
   * `hall`, `barn`, `post`, `lamp`) and the invented ramp. The RIG'S
   * FIXTURES keep their hues either way — `tube`, `chainLink`, `rod`,
   * `bar`, `panel`, `clamp`, `log` — which is not the standing/mounted
   * split it looks like (`rod` stands and is still a fixture) but a
   * different one: scenery reads by SILHOUETTE and survives losing its
   * hue, while a fixture on a truss is told from its neighbours mostly by
   * colour. The greyscale in this page is the CHROME; the scene is meant
   * to have colour in it. Each grey is chosen for brightness separation
   * rather than converted from its hue — a luminance conversion collapses
   * `cone` and `box` to within a few percent of each other, and would do
   * the same to `pine` against `bush`.
   */
  mono?: boolean;
}

/** Build the placeholder assets (see the two pivot conventions above). */
export function createPlaceholderAssets(opts: PlaceholderOptions = {}): PlaceholderAssets {
  const mono = opts.mono === true;
  const mat = (color: number): MeshStandardMaterial =>
    new MeshStandardMaterial({ color, roughness: 0.75 });
  // Three greys far enough apart to read as three things under one light.
  const known: AssetMap = {
    // Standing: base on y = 0, for a prop placed AT a point.
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

    // Standing, and the three the corpus asks for most often — `pine` in
    // eight graphs, `birch` in six, `bush` in five. Every one of them drew
    // as an invented stand-in until now, which made a scatter BY SPECIES
    // read as confetti: the mix is the whole subject of those graphs and
    // three hashed blobs cannot show it.
    //
    // Lathes rather than a cone and two spheres, because what has to
    // survive is the SILHOUETTE at distance, where a placeholder is four
    // pixels tall — tiered and pointed, round on a bare stem, low and
    // stemless. Colour alone does not survive that, and the three read
    // apart on the horizon as well as underfoot. One profile of
    // revolution is also still ONE geometry and ONE material, so these
    // cost the renderer exactly what the primitives above do.
    pine: {
      geometry: lathe(
        [
          [0, 0],
          [0.05, 0],
          [0.04, 0.18],
          [0.3, 0.22],
          [0.2, 0.46],
          [0.26, 0.49],
          [0.15, 0.73],
          [0.19, 0.76],
          [0, 1.15],
        ],
        9,
      ),
      material: mat(mono ? 0x9a9a9a : 0x2e7d5b),
    },
    birch: {
      geometry: lathe(
        [
          [0, 0],
          [0.04, 0],
          [0.028, 0.42],
          [0.06, 0.47],
          [0.24, 0.62],
          [0.26, 0.76],
          [0.17, 0.93],
          [0, 1.0],
        ],
        10,
      ),
      material: mat(mono ? 0xd0d0d0 : 0xa8cf6b),
    },
    bush: {
      geometry: lathe(
        [
          [0, 0],
          [0.22, 0.02],
          [0.3, 0.13],
          [0.27, 0.25],
          [0.15, 0.32],
          [0, 0.35],
        ],
        10,
      ),
      material: mat(mono ? 0x767676 : 0x5aa34a),
    },
    // Broad and low-slung where `birch` is tight and high — the crown
    // springs from a short trunk and hangs, which is the whole difference
    // between the two at any distance where colour has stopped working.
    willow: {
      geometry: lathe(
        [
          [0, 0],
          [0.045, 0],
          [0.035, 0.28],
          [0.3, 0.34],
          [0.36, 0.55],
          [0.3, 0.75],
          [0.16, 0.88],
          [0, 0.95],
        ],
        10,
      ),
      material: mat(mono ? 0xbcbcbc : 0x7fae78),
    },
    // Faceted rather than a squashed sphere: a rock reads by its FLAT
    // faces catching the light at different angles, and a smooth dome
    // reads as a bubble. Detail 0 is 20 faces, which is the whole budget
    // a thing this size deserves. Scaled off-round so it does not sit
    // like a ball, and sunk slightly, which is what a rock does.
    boulder: {
      geometry: new IcosahedronGeometry(0.32, 0).scale(1, 0.7, 0.86).translate(0, 0.2, 0),
      material: mat(mono ? 0x8e8e8e : 0x8c8578),
    },

    // Buildings, and the trick that makes them buildings: a lathe of FOUR
    // segments is a square plan, so one profile of revolution gives walls
    // AND a pitched roof in a single geometry. `phiStart` of a quarter
    // turn puts the walls square to the axes instead of standing on a
    // corner. The three differ by proportion and roof pitch rather than
    // by colour alone — a settlement scatter has to read as a MIX from
    // above, where hue is most of what survives, and as three different
    // buildings at eye level, where the silhouette is.
    house: {
      geometry: lathe([[0, 0], [0.42, 0], [0.42, 0.5], [0.56, 0.53], [0, 0.95]], 4, Math.PI / 4),
      material: mat(mono ? 0xc8c8c8 : 0xd8b892),
    },
    hall: {
      geometry: lathe([[0, 0], [0.46, 0], [0.46, 0.78], [0.6, 0.82], [0, 1.5]], 4, Math.PI / 4)
        .scale(1.5, 1, 1),
      material: mat(mono ? 0xa8a8a8 : 0xc9cbd0),
    },
    barn: {
      geometry: lathe([[0, 0], [0.44, 0], [0.44, 0.34], [0.52, 0.37], [0, 0.78]], 4, Math.PI / 4)
        .scale(1.7, 1, 0.95),
      material: mat(mono ? 0x707070 : 0xa4533f),
    },
    // A stake, not a column: square section, tapering, and short enough
    // that a fence line of them does not read as a colonnade.
    post: {
      geometry: lathe([[0, 0], [0.055, 0], [0.045, 0.86], [0, 0.9]], 4, Math.PI / 4),
      material: mat(mono ? 0x9c9c9c : 0x8a6a45),
    },
    // Stem, then a shade that flares — the shade is what says "lamp"
    // rather than "post", so it is deliberately wider than the ratio a
    // real one would use.
    lamp: {
      geometry: lathe(
        [
          [0, 0],
          [0.05, 0],
          [0.03, 1.02],
          [0.16, 1.08],
          [0.15, 1.2],
          [0.05, 1.24],
          [0, 1.26],
        ],
        7,
      ),
      material: mat(mono ? 0xdcdcdc : 0xe8c25a),
    },

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
    // A fallen log, along +Z like `bar` because that is the axis
    // `orientAlongVector` defaults to and what aims one at a bank. Built
    // along Y as every three.js cylinder is, then turned once here rather
    // than asking every graph to turn it. Lifted by its own radius AFTER
    // that turn, so it rests on the ground instead of half through it —
    // the lift stays vertical under the aiming rotation because that
    // rotation keeps local +Y up for a horizontal heading.
    log: {
      geometry: new CylinderGeometry(0.11, 0.085, 1, 7)
        .rotateX(Math.PI / 2)
        .translate(0, 0.1, 0),
      material: mat(0x8a6f52),
    },
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
