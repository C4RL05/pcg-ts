/**
 * The graph: where the lanterns hang, and the one integer each carries.
 *
 * FIVE NODES, and the fourth is the whole lesson. A scatter lays a sheet
 * of points, a displacement lifts it into relief, a size varies them, and
 * the spawn hands the renderer two named channels. Nothing here knows
 * what a lantern looks like, what colour it is, or that time exists —
 * that is `main.ts`, and the split is the point.
 *
 * THE ID IS NOT COMPUTED, IT IS CARRIED. Every point cloud in this
 * library already has a `seed`: a full-range u32 identity hash, the same
 * value for the same point on any machine, and the currency the whole
 * determinism claim is denominated in. Nearly every one of those values
 * sits past 2^24, which is exactly where f32 stops representing
 * consecutive integers — so an id like this cannot be COMPUTED in a
 * field either, because field evaluation is f32 too and `index +
 * 16777216` already returns the same number for the first two points. It
 * has to arrive in an integer column. `instanceAttrs` is that column's
 * way out, and `seed` reaching the shader as a `uint` rather than as a
 * float that lost its low bits is the design decision this demo exists
 * to show.
 *
 * SO THE `widen` NODE IS DELIBERATE DAMAGE. It stores the same id into
 * an f32 attribute, which is what a channel would look like if dtype
 * were not preserved — and it is also the shape of the reasonable-looking
 * shortcut ("I'll just carry it as a float"), which is exact right up
 * until the values pass 2^24 and then silently is not. Both columns ride
 * the same spawn, land on the same instances in the same order, and the
 * page draws whichever one the panel asks for. The difference is not an
 * argument; it is on screen.
 */
import {
  Graph,
  add,
  attribute,
  fbm,
  perlinNoise,
  pointScatterInBounds,
  position,
  randomField,
  remap,
  setAttribute,
  spawnInstances,
  vec,
} from "pcg-ts";

/** The named outputs a cook of this graph produces. */
export const OUTPUTS = {
  /** The instance batches, carrying both id channels. */
  instances: "instances",
} as const;

/** The one asset id this graph spawns; the page binds a geometry to it. */
export const ASSET_ID = "lantern";

/** The u32 channel: the point's own identity hash, dtype intact. */
export const CHANNEL_EXACT = "seed";

/**
 * The f32 channel: the SAME id, stored through a float. Named for what
 * happened to it rather than for what it holds, because what it holds is
 * no longer quite the id.
 */
export const CHANNEL_WIDENED = "seedWidened";

/** What the page can turn without rebuilding the graph's shape. */
export interface LanternOptions {
  /** Graph seed. Everything random downstream derives from it. */
  readonly seed?: number;
  /** Lanterns to hang. One instance per point. */
  readonly count?: number;
  /** Half-width of the field, in world units. */
  readonly extent?: number;
  /** Peak-to-trough of the relief the lanterns hang along. */
  readonly relief?: number;
}

/**
 * Build the lantern field.
 *
 * The relief is `fbm` remapped from the middle of its normalized range
 * rather than from [0, 1]: a normalized fBm spends almost all of its
 * output in the middle two fifths, so remapping the full range flattens
 * the result to a gentle swell. [0.28, 0.72] is where the signal
 * actually lives, and the overshoot outside it is welcome — those are
 * the few lanterns that break the ceiling and the floor.
 */
export function buildLanternGraph(opts: LanternOptions = {}): Graph {
  const { seed = 7, count = 6000, extent = 90, relief = 30 } = opts;
  const g = new Graph(seed);

  // A flat sheet. The interesting shape arrives in the next node, which
  // keeps this one honest: the density is uniform, so nothing about the
  // final silhouette is smuggled in by the sampler.
  const scatter = g.add(
    pointScatterInBounds,
    {
      count,
      boundsMin: [-extent, 0, -extent],
      boundsMax: [extent, 0, extent],
    },
    "scatter",
  );

  // The relief, plus a per-lantern hover so the sheet reads as a cloud
  // rather than as a surface. The noise seed is a REF to the node's own
  // seed, not a literal: a literal would freeze the landscape and the
  // seed box in the panel would move the points around inside a shape
  // that never changed.
  const height = add(
    remap(
      fbm(perlinNoise, {
        seed: { from: "node", variant: 0 },
        frequency: 0.011,
        octaves: 4,
        gain: 0.5,
        normalized: true,
      }),
      0.28,
      0.72,
      0,
      relief,
    ),
    remap(randomField("hover"), 0, 1, 0, 9),
  );
  const lift = g.add(
    setAttribute,
    { name: "P", type: "f32", tupleSize: 3, value: add(position(), vec(0, height, 0)) },
    "lift",
  );

  // Size is the graph's too. It has to be: a lantern that changed size
  // with the clock would be the page animating STRUCTURE, which is the
  // one thing the split forbids.
  const s = remap(randomField("size"), 0, 1, 0.55, 1.5);
  const size = g.add(
    setAttribute,
    { name: "scale", type: "f32", tupleSize: 3, value: vec(s, s, s) },
    "size",
  );

  // The damage, in one node. `attribute("seed")` reads the u32 column
  // itself — the field machinery hands back the storage, unconverted —
  // and the widening happens on the way INTO this f32 attribute, at the
  // store. Which is the honest place for it: this is what an f32-only
  // channel would have done to every id, silently, at the boundary.
  const widen = g.add(
    setAttribute,
    { name: CHANNEL_WIDENED, type: "f32", tupleSize: 1, value: attribute(CHANNEL_EXACT) },
    "widen",
  );

  // Two channels, one order. Instance k of `seed`, instance k of
  // `seedWidened` and `transforms[k]` are the same lantern — that is the
  // invariant the whole ABI rests on, and it is why the page can draw
  // one column against the other without matching anything up.
  const spawn = g.add(
    spawnInstances,
    { assetId: ASSET_ID, instanceAttrs: [CHANNEL_EXACT, CHANNEL_WIDENED] },
    "spawn",
  );

  g.connect(scatter, "out", lift, "in");
  g.connect(lift, "out", size, "in");
  g.connect(size, "out", widen, "in");
  g.connect(widen, "out", spawn, "in");
  g.output(spawn, "instances", OUTPUTS.instances);
  return g;
}
