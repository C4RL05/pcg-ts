/**
 * Level 1's first three stages, as a graph.
 *
 * WHAT LEVEL 1 IS, AND WHY IT HAS TO BECOME NODES. Level 0 decides the
 * placement LIST once per track — a station, an asset, a lateral, a
 * height, and which recorded pose of that asset to draw. Level 1 owns the
 * GEOMETRY: turning each of those rows into oriented boxes, keeping them
 * out of the corridor, and measuring what the result does to the lap.
 * That is the half a game streams per cell, so it is the half that has to
 * cook, cache, partition and lower like everything else in this library
 * rather than being a synchronous pass a page runs once.
 *
 * THREE STAGES AND NO MORE, DELIBERATELY. Box building, Z-1, and the
 * enclosure measurement are PURE functions of the placement list: none of
 * them moves a placement in response to another, so each is a chain of
 * nodes and the three compose by wiring. Everything after them in
 * `dressLap` — the sightline cull, the false-edge detector, the cover
 * tiler, the band mix — is a FIXED POINT over the whole population, where
 * each repair invalidates the measurement the next one reads. A fixed
 * point is expressible as a graph too, and it is not expressible as THIS
 * graph; putting one stage of it here would produce something that looked
 * finished and answered a different question. `dress.ts` keeps running
 * exactly as it did and nothing calls this but its test.
 *
 * THE ENTRY POINT IS SPLIT IN TWO, AND THE SPLIT IS THE ANSWER TO THE
 * STRUCTURAL PROBLEM. The rules `dress.ts` states are synchronous
 * functions over a cooked `Lap`; a graph must be COOKED, which is async.
 * Making the rules async would turn every caller of `resolveCorridor`
 * into an await and break the repair loop, which is the one change that
 * breaks everything at once. So:
 *
 *   - {@link buildDressGraph} is SYNCHRONOUS and returns a `Graph`. The
 *     page already draws a read-only picture of the graph behind it
 *     (`shared/graph/`), and a picture must not require a cook.
 *   - {@link dressLapByGraph} is the only async thing here: it builds,
 *     cooks, and reads the columns back into plain arrays.
 *
 * Nothing in `dress.ts` is imported except `frameLookup`, and that one on
 * purpose: the pose at a station is level 0's coordinate system, and a
 * second derivation of it here is a second chance to disagree with the
 * geometry being compared against.
 *
 * WHAT THE HOST STILL HAS TO HAND IN, AND WHY IT IS NOT A SHORTCUT. Each
 * placement arrives carrying the lap's pose at its own station — the
 * centreline point and the three axes. That is not the rule being dodged;
 * it is a capability the node library does not have. `pathPointAt`
 * evaluates a polyline at an arbitrary parameter, but only for points
 * that are ALREADY ON that polyline, and it writes only `tangent` and
 * `curveU`. There is no node that samples a path's frame at a per-point
 * arc length for a foreign cloud, so the interpolation `poseAt` does
 * cannot be stated here. It is reported rather than worked around.
 */
import {
  Graph,
  type DataCollection,
  type Geometry,
  type NodeHandle,
  abs,
  add,
  attribute,
  copyToPoints,
  cook,
  createPointCloud,
  dataInput,
  div,
  eq,
  filterByExpression,
  firstGeometry,
  ge,
  gt,
  lt,
  makeGeometryItem,
  max,
  mul,
  orientAlongVector,
  pathCoverage,
  select,
  setAttribute,
  sub,
  vec,
} from "pcg-ts";
import { rand } from "./rand.js";
import { frameLookup } from "./dress.js";
import { TRACK_FRAME } from "./graph.js";
import type { Kit } from "./kit.js";
import type { Lap } from "./lap.js";
import type { StationedPlacement } from "./legibility.js";
import { SAME_PLACE_W } from "./tolerance.js";
import { CORRIDOR } from "./zones.js";

/** The named outputs a cook of this graph produces. */
export const DRESS_OUTPUTS = {
  /** One point per placed box: P the world centre, rot the track frame, scale the world extents. */
  boxes: "boxes",
  /** One point per placement, after Z-1 and lifted into the world. */
  placements: "placements",
  /** The lap's frames, one column wider: `covered` and `coverHits`. */
  coverage: "coverage",
} as const;

/**
 * L-6's numbers, restated a THIRD time, and the repetition is the point.
 *
 * `enclosure.ts` already argues why its copy is restated rather than
 * imported from `zones.ts`: those are placement rules that may be
 * retuned, this is a measurement whose whole value is that a figure taken
 * today compares with one taken upstream, and a measurement that moves
 * when a rule is tuned measures the tuning. `pathCoverage`'s own `far`
 * description makes the same argument from the library's side — "prefer
 * restating the number here to importing it from whatever placed the
 * boxes".
 *
 * So this file states them again rather than importing `ENCLOSURE`, and
 * `tests/racetrackDressGraph.test.ts` pins the two tables equal. Two
 * independent statements of one measurement that are CHECKED equal is a
 * different thing from one statement read twice: the check is what would
 * catch a hand edit here, and the independence is what keeps a later
 * retune of `zones.ts` from silently moving both.
 *
 * The units are half-widths. `pathCoverage` wants world distances, so
 * every one of them is multiplied by the lap's own half-width where it
 * is wired in — which is also what makes these numbers a statement about
 * any track rather than about this one.
 */
export const COVER = {
  /** Rays span `-corridorW .. +corridorW`. */
  corridorW: 1.5,
  /** How many, endpoints included. */
  rays: 6,
  /** Below this a box is scenery beside the road, not cover over it. */
  floorW: 1.2,
  /** Above this it is sky. Without a ceiling the skybox is a tunnel. */
  ceilingW: 6,
  /** At least half. */
  minHits: 3,
} as const;

/** The columns this graph reads off the placement cloud it is handed. */
const PLACEMENT = {
  /** Centreline point at the placement's station, world units. */
  framePos: "framePos",
  /** The three axes there. Named apart from `TRACK_FRAME` on purpose — see below. */
  across: "frameAcross",
  along: "frameAlong",
  up: "frameUp",
  /** Signed lateral in W. Positive RIGHT of travel. */
  t: "trackT",
  /**
   * Z-1's answer for the lateral, before it replaces `trackT`.
   *
   * A COLUMN RATHER THAN A WIRE, because a `setAttribute` chain has no
   * other way to hold a value that must not be visible to the node in
   * between. It survives onto the placement output, where it is harmless
   * and honest: it says what the corridor rule decided, next to what the
   * placement ended up with.
   */
  tNext: "trackTResolved",
  /** Height of the placement's CENTRE above the surface, in W. */
  h: "trackH",
  /** The asset's own extents, in W — what Z-1 resolves the corridor BY. */
  sizeAcross: "sizeAcross",
  sizeTall: "sizeTall",
  /** 1 on an L-6 cover piece, which Z-1 must not touch. */
  cover: "cover",
  /** Which entry of the pose library this placement draws its boxes from. */
  pose: "placementPose",
  /**
   * Arc length from the start line, in W.
   *
   * ON THE CLOUD BUT NOT CARRIED ONTO THE BOXES, and the restraint is
   * deliberate: every column named in `targetNames` is written once per
   * COPY, and the copy count here is the whole pose library times the
   * whole placement list. A column that costs a million writes to answer
   * a question `placementIndex` already answers by lookup is a column
   * that should not be carried. It stays here because the placement cloud
   * is an output in its own right and a placement with no station is not
   * a placement.
   */
  station: "stationW",
} as const;

/** The columns the pose library carries, one point per box of one pose. */
const BOX = {
  /** Which pose this box belongs to, matched against `PLACEMENT.pose`. */
  pose: "boxPose",
  /** panel / leg / post / span / head / mass — the kit's own label. */
  role: "boxRole",
  /** RMS departure from the box's own best-fit plane, in W. See `kit.ts`. */
  thickness: "boxThickness",
  /** Index of the placement this box decomposes, written by `copyToPoints`. */
  placement: "placementIndex",
} as const;

/**
 * The smallest world extent a box may have. `dress.ts`'s own floor.
 *
 * Three quarters of a measured kit is single-sided surface, so a box's
 * depth is frequently exactly zero. A zero extent is a degenerate slab
 * that the ray test answers containment for rather than crossing, and it
 * draws as nothing — so `buildBoxes` floors it, and this has to floor it
 * at the same value or every sheet in the vocabulary lands somewhere else.
 */
const MIN_EXTENT_WORLD = 1e-3;

/** What {@link dressLapByGraph} answers with. */
export interface GraphDressing {
  /** One point per box, in `buildBoxes`' own order: placement, then pose box. */
  readonly boxes: Geometry;
  /** The placement cloud after Z-1, lifted into the world. */
  readonly placements: Geometry;
  /** Per lap frame: is it under cover? */
  readonly covered: boolean[];
  /** Per lap frame: how many of the six rays hit anything. */
  readonly hits: Uint32Array;
  /** Covered arc length over lap length. */
  readonly share: number;
  /**
   * How many copies the box build stamped before the filter, which is
   * the pose library times the placement count.
   *
   * REPORTED BECAUSE IT IS THE COST OF A MISSING NODE CAPABILITY rather
   * than a property of the dressing. `writeBoxes` argues it at length:
   * `copyToPoints` stamps one source on every target, so a vocabulary
   * where each asset has its own decomposition has to be broadcast whole
   * and selected from. The ratio of this to `boxes.pointCount` is what
   * a per-target source selector would save, and a number nobody prints
   * is a number nobody notices growing.
   */
  readonly stamped: number;
  /** The graph itself, for the page's read-only picture. */
  readonly graph: Graph;
  readonly cookMs: number;
}

/** What the graph needs to be built at all. */
export interface DressGraphInput {
  readonly kit: Kit;
  readonly lap: Lap;
  /**
   * The cooked level-0 frames, as `buildRoadGraph` produced them.
   *
   * HANDED IN RATHER THAN RE-COOKED. `lap` is a READING of this geometry
   * (`readLap`), so cooking the road graph again here would give the
   * enclosure measurement a second copy of the path that agrees with the
   * first only as long as nobody changes a seed. `pathCoverage` wants the
   * path itself — it reads the polyline topology and the published
   * `across` column — so the caller passes the same object it read the
   * lap from and the two cannot drift.
   */
  readonly frames: Geometry;
  readonly placements: readonly StationedPlacement[];
  /** The stream `buildBoxes` draws poses from. Must match, or the boxes do not. */
  readonly seed: number;
}

/**
 * One entry of the pose library: the boxes of one recorded instance.
 *
 * A POSE IS THE UNIT, NOT AN ASSET, and that is the whole reason this
 * table exists. The kit format stores no rotation, so an asset carries
 * one representative box set and stamping every copy from it faces every
 * object the same way round the lap. Every recorded INSTANCE carries its
 * own correct boxes, though — on the shipped vocabulary 362 instances
 * give 361 distinct sets — so the yaw the format never stored survives in
 * the shapes, and a placement draws one of them. `buildBoxes` says the
 * same thing at greater length; this restates it because `kitIndex` is
 * private to `dress.ts` and the two derivations have to agree. That they
 * do is what the box comparison in the test actually proves.
 */
interface PoseLibrary {
  /** Asset id -> the pose ids recorded for it, in the kit's own order. */
  readonly posesOf: Map<number, number[]>;
  /** Pose id -> its boxes. Index IS the id. */
  readonly boxes: LooseBoxes[];
}

/**
 * A box set as this file READS one, which is looser than `KitBox`.
 *
 * `KitBox` fixes `min`/`max` as three-tuples, and the catalogue entries a
 * kit may carry alongside its instances are typed only as arrays — the
 * same widening `dress.ts` does at its own kit index. Reading through a
 * shape that asks for no more than the three components are indexed by
 * keeps one `as` at the seam instead of one per use.
 */
type LooseBoxes = readonly {
  readonly min: ArrayLike<number>;
  readonly max: ArrayLike<number>;
  readonly role?: string;
  readonly thickness?: number;
}[];

function poseLibrary(kit: Kit): PoseLibrary {
  const posesOf = new Map<number, number[]>();
  const boxes: LooseBoxes[] = [];
  const push = (asset: number, set: LooseBoxes): void => {
    const id = boxes.length;
    boxes.push(set);
    const list = posesOf.get(asset) ?? [];
    list.push(id);
    posesOf.set(asset, list);
  };

  // The kit's own instance order, so pose k here is pose k in `kitIndex`.
  // The order is not cosmetic: `buildBoxes` indexes this list by a hash of
  // the station, so a different order draws different poses and every box
  // on the lap moves.
  for (const pl of kit.placements ?? []) {
    if (!pl.boxes?.length) continue;
    push(pl.asset, pl.boxes);
  }

  // The catalogue's own fallbacks, in `buildBoxes`' order of preference:
  // an asset with recorded instances never reaches these, and one without
  // has only these. Registered under ids of their own so that the pose a
  // placement selects is always one lookup into one table.
  //
  // TWO CATALOGUE ENTRIES SHARING AN ID resolve FIRST-wins here and
  // LAST-wins in `dress.ts`'s `assetById`, which is a difference worth
  // naming and not worth removing: a kit whose asset ids are not unique
  // has no defined meaning on either side, and matching the accident
  // would only make the disagreement harder to notice if one ever mattered.
  for (const a of kit.assets as unknown as {
    id: number;
    boxes?: LooseBoxes;
    poses?: LooseBoxes[];
  }[]) {
    if (posesOf.has(a.id)) continue;
    if (a.poses?.length) for (const set of a.poses) push(a.id, set);
    else if (a.boxes?.length) push(a.id, a.boxes);
  }
  return { posesOf, boxes };
}

/**
 * Which pose a placement draws, as `buildBoxes` draws it.
 *
 * -1 WHEN THE VOCABULARY HAS NOTHING FOR THE ASSET, which is a real case
 * rather than an error: `buildBoxes` falls through to an empty box set and
 * the placement contributes no geometry. No source box carries -1, so the
 * copy-and-select below drops every copy of that placement and the two
 * paths produce the same nothing.
 */
function poseFor(lib: PoseLibrary, p: StationedPlacement, seed: number): number {
  const ids = lib.posesOf.get(p.asset.id);
  if (!ids || ids.length === 0) return -1;
  const k = p.pose ?? Math.floor(rand(seed, Math.round(p.station * 97), 0x7053) * ids.length);
  return ids[k % ids.length];
}

/**
 * The pose library as a point cloud — the SOURCE of the copy.
 *
 * Each point is one box of one pose, positioned at that box's centre and
 * scaled to its extents, both IN HALF-WIDTHS. Keeping the library in the
 * kit's own units is what makes it a library rather than a fitting: the
 * track's scale arrives on the target's `scale`, so the same cloud
 * dresses a lap of any width without being rebuilt.
 */
function poseCloud(lib: PoseLibrary, halfWidth: number): Geometry {
  let n = 0;
  for (const set of lib.boxes) n += set.length;
  const geo = createPointCloud(n);
  const pts = geo.attrs.point;
  const P = pts.require("P");
  const scale = pts.require("scale");
  const pose = pts.add(BOX.pose, "f32", 1);
  const role = pts.add(BOX.role, "string", 1);
  const thickness = pts.add(BOX.thickness, "f32", 1);

  // The floor is stated on the WORLD extent (`buildBoxes` clamps after
  // multiplying by W), so it has to be divided back out here — the target
  // multiplies by W again downstream and lands on the same number to
  // within the f32 spacing of it.
  const minExtentW = MIN_EXTENT_WORLD / halfWidth;

  let i = 0;
  for (let id = 0; id < lib.boxes.length; id++) {
    for (const b of lib.boxes[id]) {
      P.setTuple(i, [
        (b.min[0] + b.max[0]) / 2,
        (b.min[1] + b.max[1]) / 2,
        (b.min[2] + b.max[2]) / 2,
      ]);
      scale.setTuple(i, [
        Math.max(b.max[0] - b.min[0], minExtentW),
        Math.max(b.max[1] - b.min[1], minExtentW),
        Math.max(b.max[2] - b.min[2], minExtentW),
      ]);
      pose.set(i, id);
      role.setString(i, b.role ?? "mass");
      thickness.set(i, b.thickness ?? 0);
      i++;
    }
  }
  return geo;
}

/**
 * The placement list as a point cloud — the TARGET of the copy.
 *
 * TRACK COORDINATES AND THE FRAME, SIDE BY SIDE. `trackT` and `trackH`
 * are what Z-1 resolves; the four frame columns are what the resolved
 * pair is then lifted through. They are named apart from `TRACK_FRAME`'s
 * `across`/`up` deliberately: those columns are a fact about a point OF
 * the lap, and these are the lap's frame carried to a point that is not
 * on it. One name for both would make a cloud that had been lifted
 * indistinguishable from the path it was lifted off.
 */
function placementCloudInTrackFrame(
  lap: Lap,
  placements: readonly StationedPlacement[],
  lib: PoseLibrary,
  seed: number,
): Geometry {
  const geo = createPointCloud(placements.length);
  const pts = geo.attrs.point;
  const P = pts.require("P");
  const framePos = pts.add(PLACEMENT.framePos, "f32", 3);
  const across = pts.add(PLACEMENT.across, "f32", 3);
  const along = pts.add(PLACEMENT.along, "f32", 3);
  const up = pts.add(PLACEMENT.up, "f32", 3);
  const t = pts.add(PLACEMENT.t, "f32", 1);
  const h = pts.add(PLACEMENT.h, "f32", 1);
  const sizeAcross = pts.add(PLACEMENT.sizeAcross, "f32", 1);
  const sizeTall = pts.add(PLACEMENT.sizeTall, "f32", 1);
  const cover = pts.add(PLACEMENT.cover, "f32", 1);
  const pose = pts.add(PLACEMENT.pose, "f32", 1);
  const station = pts.add(PLACEMENT.station, "f32", 1);

  // The lap's own lookup, not a second one. `frameLookup` is exactly what
  // `buildBoxes` calls, so the frame a box is built in here is the frame
  // it is built in there, to the bit.
  const frameAt = frameLookup(lap);
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    // At the placement's station and at LATERAL AND HEIGHT ZERO: the
    // frame is a property of the station alone, and asking for it at the
    // placement's own offsets would bake in the very numbers Z-1 is about
    // to change.
    const f = frameAt(p.station, 0, 0);
    // P starts on the centreline. The lift writes the real one; until it
    // does, a placement is where its station is, which is a truthful
    // intermediate rather than a placeholder.
    P.setTuple(i, f.p);
    framePos.setTuple(i, f.p);
    across.setTuple(i, f.across);
    along.setTuple(i, f.dir);
    up.setTuple(i, f.up);
    t.set(i, p.t);
    h.set(i, p.h);
    sizeAcross.set(i, p.asset.size.across);
    sizeTall.set(i, p.asset.size.tall);
    cover.set(i, p.cover === true ? 1 : 0);
    pose.set(i, poseFor(lib, p, seed));
    station.set(i, p.station);
  }
  return geo;
}

/**
 * Z-1, as field expressions on the placement cloud.
 *
 * THE RULE RESOLVES TWO WAYS BY SIZE and that is the whole of it: small
 * art rises to the ceiling keeping its lateral, large art stands off to
 * the corridor edge keeping its band. Clamping everything to the edge
 * costs the verge band, because the archetypes that reach inside 1W are
 * the same ones that fill 1.0-1.5W; lifting everything is worse than
 * either. `zones.ts` argues both at length.
 *
 * THE EDGE IS THE OBJECT'S, NOT ITS CENTRE'S. `1 + across/2` puts the
 * near FACE on the corridor edge; `1` would leave half the piece's width
 * over the road, which on a 13W slab is 6.7W of structure across the
 * racing line at whatever height it was.
 *
 * THE COMPARISONS ARE `lt` AND `ge` WHERE `inCorridor` WRITES `<` AND
 * `>=`, rather than the `1 - lt` idiom `graph.ts` argues for. That idiom
 * exists to put a NaN on the side of a threshold where an unmeasurable
 * frame does least harm, and it is the wrong tool for a REPAIR. `graph.ts`
 * is classifying — a NaN there would enter a corner nobody chose and be
 * marked — whereas this rule only ever MOVES something, so the harmless
 * answer for a placement whose lateral failed to compute is to leave it
 * alone rather than to teleport it to a stand-off computed from a NaN.
 * Every comparison against a NaN is false, so `lt`/`ge` give exactly that,
 * and it is also what `resolveCorridor` does — which is the other half of
 * the reason: the graph must not be MORE opinionated than the rule it is
 * mirroring, or the disagreement shows up as a placement that only one of
 * the two paths moved.
 *
 * THE SIGN IS `1 - 2*lt(t, 0)` AND NOT `sign(t)`. The rule reads
 * `Math.sign(t || 1)`, which answers +1 for a lateral of exactly zero —
 * a piece dead on the centreline has to go somewhere and right is as good
 * as left. `sign(0)` is 0, and multiplying the stand-off distance by it
 * would leave that piece exactly where it was, inside the corridor,
 * having been "resolved".
 */
function writeCorridor(g: Graph, target: NodeHandle, tag: string): NodeHandle {
  const t = attribute(PLACEMENT.t);
  const h = attribute(PLACEMENT.h);
  const tall = attribute(PLACEMENT.sizeTall);
  const acrossW = attribute(PLACEMENT.sizeAcross);

  // A placement stores its CENTRE height; the corridor is stated on its
  // BASE. The round trip through `base = h - tall/2` and back is the one
  // `moved` warns about — in f32 it leaves about 1e-7 behind, a hundred
  // times the residue the f64 rule was sized against — which is exactly
  // why the no-op gate below is not optional here.
  const baseH = sub(h, div(tall, 2));

  // EVERY EDGE OF THE VOLUME CARRIES `SAME_PLACE_W`, AND THAT IS A REAL
  // DIFFERENCE FROM `inCorridor`, NOT A TRANSCRIPTION SLIP.
  //
  // `inCorridor` tests `|t| < 1`, `h >= 0` and `h < 1.2` with no
  // tolerance at all, and it is the one boundary test in this demo's
  // ladder without one — its sibling `bandOf`, which asks the same
  // question of an already-placed lateral, spells every rung as
  // `a < limit - SAME_PLACE_W`. `tolerance.ts` states the intent this
  // file is applying: the boundaries here are hit EXACTLY, by
  // construction rather than by luck, and a rule whose own placer lands
  // on its own boundary has to agree with itself.
  //
  // WITHOUT IT THIS GRAPH MOVES EVERY GANTRY OFF THE ROAD, and that is
  // measured rather than feared. Z-3's `over` band takes its height from
  // the band, so an overhead placement's base is EXACTLY the corridor
  // ceiling and it is stored as a centre: `h = 1.2 + tall/2`. Recovering
  // the base as `h - tall/2` in f64 returns 1.2 and `1.2 < 1.2` is false,
  // so the rule correctly leaves a gantry spanning the corridor. In f32
  // the same round trip lands a few parts in ten million BELOW 1.2, the
  // test passes, and the piece is stood off to the verge — on seed 1 that
  // was two placements and six boxes, one of them a 9.6W span moved 5.8W
  // sideways. `moved` cannot catch it, because this is not a phantom
  // no-op fix: it is a phantom REAL one.
  //
  // Each rung is slacked in the direction that keeps the f64 answer for a
  // value sitting exactly on it — `1.2 < 1.2 - eps` is false as `1.2 <
  // 1.2` is, `0 >= -eps` is true as `0 >= 0` is — so on any population
  // where nothing sits INSIDE the slack the two statements agree, and
  // `SAME_PLACE_W` is sized so that nothing does.
  const inCorridor = mul(
    mul(
      lt(abs(t), CORRIDOR.halfWidthW - SAME_PLACE_W),
      ge(baseH, CORRIDOR.floorW - SAME_PLACE_W),
    ),
    lt(baseH, CORRIDOR.ceilingW - SAME_PLACE_W),
  );
  // L-6's cover is placed clear by construction; standing a tunnel rib off
  // to the corridor edge puts a hole in the roof over the racing line.
  const fires = mul(inCorridor, sub(1, attribute(PLACEMENT.cover)));
  // THE SIZE CUT TAKES NO TOLERANCE, and the asymmetry with the volume
  // above is the point rather than an oversight. A height reaches its
  // comparison through `h - tall/2`, a subtraction of two stored values
  // that is not the number either of them started as; an EXTENT is read
  // off the catalogue and stored once, so the only error it carries is
  // the f32 rounding of a single value, six parts in a hundred million.
  // Slack applied where there is no round trip is slack in the rule, and
  // `tolerance.ts` is explicit that these are not that.
  const small = mul(lt(acrossW, 1), lt(tall, 1.5));

  const signT = sub(1, mul(2, lt(t, 0)));
  const standOff = mul(signT, add(CORRIDOR.halfWidthW, div(acrossW, 2)));

  const wantT = select(mul(fires, sub(1, small)), standOff, t);
  const wantBase = select(mul(fires, small), CORRIDOR.ceilingW, baseH);

  // THE NO-OP GATE, and it is a rule about the REPAIR LOOP rather than
  // about the corridor. `dressLap` runs Z-1 once a round and stops when
  // no round moves anything; a fix that cannot recognise its own no-op
  // fires forever. There are only two real fixes and both are jumps —
  // small art rises to the ceiling from wherever under it it was, large
  // art goes from inside 1W to at least half its own width beyond it — so
  // nothing this threshold swallows was ever a fix. See `moved`.
  const moved = max(
    gt(abs(sub(wantT, t)), SAME_PLACE_W),
    gt(abs(sub(wantBase, baseH)), SAME_PLACE_W),
  );

  // THE LATERAL LANDS IN A COLUMN OF ITS OWN AND IS MOVED ACROSS LAST,
  // AND WITHOUT THAT THIS IS A RULE THAT READS ITS OWN OUTPUT.
  //
  // A `setAttribute` chain is sequential: whatever the second node reads
  // is what the first one left. Z-1's two answers are computed from the
  // SAME four inputs — the lateral, the base, the extent and the width —
  // so a node that overwrote `trackT` and then let the height node
  // recompute `inCorridor` would be asking the question of a placement
  // that had already been moved out of the corridor, and would get the
  // answer "nothing to do" for a piece that had only had its lateral
  // fixed. On today's rule that happens to come out right, because the
  // two exits are exclusive and the one that moves the lateral never
  // touches the height — which is exactly the kind of accident that
  // survives until somebody adds a third exit.
  //
  // So the resolved lateral is parked under its own name, the height is
  // written from the ORIGINAL pair, and the lateral is copied over last
  // from a column nothing else reads. Every node then reads inputs no
  // earlier node in this stage has written, which is a property that can
  // be checked by looking rather than by case analysis.
  const nextT = g.add(
    setAttribute,
    { name: PLACEMENT.tNext, tupleSize: 1, value: select(moved, wantT, t) },
    `${tag}_corridorT`,
  );
  g.connect(target, "out", nextT, "in");

  // Back to a centre height, through the same `base + tall/2` the rule
  // uses — so a placement the gate found unmoved keeps the `h` it came in
  // with rather than the f32 round trip of it.
  const outH = g.add(
    setAttribute,
    {
      name: PLACEMENT.h,
      tupleSize: 1,
      value: select(moved, add(wantBase, div(tall, 2)), h),
    },
    `${tag}_corridorH`,
  );
  g.connect(nextT, "out", outH, "in");

  const outT = g.add(
    setAttribute,
    { name: PLACEMENT.t, tupleSize: 1, value: attribute(PLACEMENT.tNext) },
    `${tag}_corridorApply`,
  );
  g.connect(outH, "out", outT, "in");
  return outT;
}

/**
 * Track coordinates to a world transform, on the placement cloud.
 *
 * `P` IS `placeAt` WRITTEN AS A FIELD: the centreline point plus the
 * lateral along `across` plus the height along `up`, both scaled out of
 * half-widths by the lap's own half-width. Nothing here is a new
 * derivation — it is the same three lines `lap.ts` runs, evaluated in
 * attribute columns instead of in a loop.
 *
 * `rot` IS `orientAlongVector` WITH AXIS `+y`, WHICH IS NOT A PREFERENCE.
 * The frame a box has to be axis-aligned in is (across, along, up) as the
 * matrix's columns — local X across, local Y along, local Z up — because
 * that is the frame the kit measured its boxes in. `+y` puts the local Y
 * on `direction`, and for the ±y axes the node's own contract is that
 * local +Z takes the up hint. So `direction: along` and `up: up` give
 * exactly those three columns, and the node's up-hint construction
 * recovers `across` as `-(up x along)` rather than reading the stored
 * column: an ORTHONORMAL frame, where the stored triple is orthogonal
 * only to about 1.9e-4 over four laps (`poseAt` renormalizes each axis
 * independently, so a pose interpolated between two frames is a rotation
 * plus a small shear). A quaternion cannot carry a shear, which is the
 * right answer and not a lossy one — `tests/racetrackSpawn.test.ts` found
 * the same difference from the other side, measured it at 1.6e-4 on one
 * of those laps, and pinned it rather than absorbing it into a bound.
 *
 * AND THE PER-POINT `up` COSTS THE DEVICE PATH, WHICH IS A PRICE WORTH
 * NAMING RATHER THAN DISCOVERING. `orientAlongVector` bakes a constant up
 * into its apply kernel, so a FIELD up makes the node ineligible for a
 * device-resident run and the cook reports it under that name in its
 * fallbacks. There is no version of this rule that takes a constant: a
 * lap with relief banks, the road is swept on the surface normal, and a
 * literal [0, 1, 0] here would roll every prop off the road it is
 * standing beside on every banked corner. So level 1 orients on the CPU
 * until the kernel can carry a roll, and the fallback line in the stats
 * is the true reason rather than a mystery.
 *
 * `scale` IS THE TRACK'S SCALE, NOT AN ASSET'S. It is the one place the
 * half-width enters the box build: the pose library is in half-widths, the
 * copy multiplies the source's offset and extents by this, and the boxes
 * come out in world units. It is also why the same library dresses a lap
 * of any width.
 */
function writeWorldTransform(
  g: Graph,
  target: NodeHandle,
  halfWidth: number,
  tag: string,
): NodeHandle {
  const P = g.add(
    setAttribute,
    {
      name: "P",
      tupleSize: 3,
      value: add(
        attribute(PLACEMENT.framePos, 3),
        add(
          mul(attribute(PLACEMENT.across, 3), mul(attribute(PLACEMENT.t), halfWidth)),
          mul(attribute(PLACEMENT.up, 3), mul(attribute(PLACEMENT.h), halfWidth)),
        ),
      ),
    },
    `${tag}_lift`,
  );
  g.connect(target, "out", P, "in");

  const scale = g.add(
    setAttribute,
    { name: "scale", tupleSize: 3, value: vec(halfWidth, halfWidth, halfWidth) },
    `${tag}_trackScale`,
  );
  g.connect(P, "out", scale, "in");

  const rot = g.add(
    orientAlongVector,
    {
      direction: attribute(PLACEMENT.along, 3),
      up: attribute(PLACEMENT.up, 3),
      axis: "+y",
    },
    `${tag}_frame`,
  );
  g.connect(scale, "out", rot, "in");
  return rot;
}

/**
 * The box build: every pose stamped on every placement, then the ones
 * that belong kept.
 *
 * WHY IT IS A BROADCAST AND A FILTER RATHER THAN A LOOKUP, which is the
 * one thing about this file that should not be copied without reading
 * this paragraph. `copyToPoints` composes exactly the transform
 * `buildBoxes` writes by hand —
 * `P = targetP + targetRot * (targetScale * sourceP)`, `rot = targetRot *
 * sourceRot`, `scale = targetScale * sourceScale` — with the target the
 * placement and the source its boxes. What it has no way to express is
 * that DIFFERENT TARGETS TAKE DIFFERENT SOURCES: the source pin is one
 * cloud, stamped on every target. A vocabulary in which each asset has
 * its own decomposition is exactly the case that needs per-target source
 * selection, and there is none — not on this node, and not through
 * `forEach`, whose non-iterated pins broadcast, so it cannot pair the k-th
 * pose with the k-th group of placements either.
 *
 * So the whole library is stamped and the wrong copies are dropped. It is
 * correct, and it is the right ORDER: `copyToPoints` lays its copies out
 * in contiguous per-target blocks and the filter preserves order, so the
 * survivors come out as placement, then that placement's own boxes, which
 * is `buildBoxes`' order exactly.
 *
 * WHAT IT COSTS, MEASURED. `poses x placements` intermediate points where
 * the answer is a couple of thousand: on the shipped vocabulary, 2200
 * library boxes times about 350 placements is 776,000 copies stamped to
 * keep 1,900 — one survivor in four hundred, at about 140ms a lap. The
 * number is stated here rather than hidden behind a pre-trimmed library,
 * because it IS the finding: trimming the library on the host is the
 * per-target selection this node is missing, done by hand and one level
 * up. A `sourceIndexAttr` on `copyToPoints` — take the source point (or
 * primitive) the target names, instead of all of them — would make this
 * stage linear in the answer. Until there is one, a cell of level 1 pays
 * for every asset in the vocabulary it does not use.
 */
function writeBoxes(
  g: Graph,
  poses: NodeHandle,
  placements: NodeHandle,
  tag: string,
): NodeHandle {
  const copies = g.add(
    copyToPoints,
    {
      // ONE CARRIED COLUMN, AND ONLY BECAUSE THE FILTER CANNOT WORK
      // WITHOUT IT. `cover` was here too, on the reasoning that a box has
      // to know whether it is structure or scenery before an asset map can
      // name it — and that is true and is still not a reason to carry it,
      // for the reason `PLACEMENT.station` is not carried either: it is a
      // fact about the PLACEMENT, `placementIndex` names the placement, and
      // a column written once per copy costs a write per copy. Three
      // quarters of a million of them per lap to save a lookup is the
      // wrong trade, and `boxAssetId` can take the same route every other
      // per-placement fact takes.
      targetNames: [PLACEMENT.pose],
      // WHICH PLACEMENT A BOX BELONGS TO, written by the node that
      // already knows. `spawn.ts` argues that the placement is the
      // granularity real art binds to and the boxes are a decomposition
      // of it; a decomposition that cannot say what it decomposed is a
      // cloud. It is also what lets anything downstream regroup the boxes
      // of one object — `pointsToPath`'s `groupAttr` and
      // `partitionByAttribute` both key on exactly this column.
      targetIndexAttr: BOX.placement,
      topology: "drop",
    },
    `${tag}_stamp`,
  );
  g.connect(poses, "out", copies, "source");
  g.connect(placements, "out", copies, "target");

  // Exact equality on two small integers, which is the one comparison f32
  // makes safe: pose ids run to a few hundred and every integer below
  // 2^24 is exact, so this is an identity test rather than a tolerance.
  const mine = g.add(
    filterByExpression,
    { predicate: eq(attribute(BOX.pose), attribute(PLACEMENT.pose)) },
    `${tag}_ownBoxes`,
  );
  g.connect(copies, "out", mine, "in");
  return mine;
}

/**
 * L-6's measurement: how much of the lap runs under cover.
 *
 * SIX VERTICAL RAYS FROM 1.2W TO 6W ACROSS -1.5W..+1.5W, AT LEAST HALF OF
 * THEM HITTING. `pathCoverage` is that definition as a node, down to the
 * default ray count and threshold, and its own description carries the
 * argument for why it has to be world-space rays: three cheaper proxies
 * gave 7.9%, 32.3% and 50.3% for one circuit, and the 32.3% was published
 * and withdrawn because a bounds projection onto a folded centreline
 * cannot tell "above the road here" from "near the road twice".
 *
 * `direction` IS THE FRAME'S OWN `up`, NOT WORLD UP. This lap has relief
 * and the road banks on the surface normal the placements hang off; a
 * literal [0, 1, 0] would ask what is vertically above a banked frame,
 * which is not what is over the road there.
 *
 * `acrossAttr` IS THE PUBLISHED COLUMN FOR THE SAME REASON THE RAYS ARE
 * BUILT THROUGH `placeAt` IN THE TYPESCRIPT. Left empty the node derives
 * across from the path's polyline topology, which is a second way of
 * computing the axis the boxes were placed along — and the node's own
 * description says it: a second derivation is a second chance to disagree
 * with the geometry being measured, and the disagreement reads as a
 * plausible number rather than as a bug.
 */
function writeCoverage(
  g: Graph,
  path: NodeHandle,
  boxes: NodeHandle,
  halfWidth: number,
  tag: string,
): NodeHandle {
  const cover = g.add(
    pathCoverage,
    {
      direction: attribute(TRACK_FRAME.up, 3),
      near: COVER.floorW * halfWidth,
      far: COVER.ceilingW * halfWidth,
      rayCount: COVER.rays,
      spread: COVER.corridorW * halfWidth,
      minHits: COVER.minHits,
      acrossAttr: TRACK_FRAME.across,
      // The boxes arrive as unit cubes scaled to their extents, which is
      // what `boxCloud` produces and what the default asks for: the world
      // half-extent is 0.5 * boxSize * scale, so leaving boxSize at
      // [1, 1, 1] means `scale` IS the size. Scaling twice reports a
      // tunnel over the whole lap and forgetting `scale` reports no cover
      // anywhere, and both finish cleanly.
      coveredAttr: "covered",
      hitsAttr: "coverHits",
    },
    `${tag}_enclosure`,
  );
  g.connect(path, "out", cover, "path");
  g.connect(boxes, "out", cover, "boxes");
  return cover;
}

/**
 * Build the graph, with the lap and the placement list already bound in.
 *
 * A GRAPH WITH ITS DATA IN IT COSTS WHAT THE DATA COSTS, which is worth
 * knowing before this is called to draw a picture. `dataInput` binds real
 * geometry, so building carries the whole pose library into a cloud and
 * takes one frame lookup per placement whether or not anything is ever
 * cooked. That is a few milliseconds and it is not free, so a page that
 * wants the picture beside the result should build once and keep it
 * rather than rebuild per frame.
 */
export function buildDressGraph(input: DressGraphInput): Graph {
  return assemble(input).graph;
}

/**
 * The graph, and the one number about it that is not visible from outside.
 *
 * `libraryBoxes` is how many points the copy's SOURCE carries, and it is
 * reported because the broadcast in {@link writeBoxes} costs that times
 * the placement count in intermediate points. A cost that is a product of
 * two numbers, only one of which anyone can see, is a cost nobody
 * measures — so the hidden one comes out.
 */
function assemble(input: DressGraphInput): { graph: Graph; libraryBoxes: number } {
  const { kit, lap, frames, placements, seed } = input;
  const g = new Graph(seed);

  const lib = poseLibrary(kit);
  const library = poseCloud(lib, lap.halfWidth);

  const posesIn = g.add(dataInput, {}, "poseLibrary");
  g.setParam(posesIn, "items", [makeGeometryItem(library)]);

  const placementsIn = g.add(dataInput, {}, "placements");
  g.setParam(placementsIn, "items", [
    makeGeometryItem(placementCloudInTrackFrame(lap, placements, lib, seed)),
  ]);

  const framesIn = g.add(dataInput, {}, "lap");
  g.setParam(framesIn, "items", [makeGeometryItem(frames)]);

  // Z-1 FIRST, IN TRACK COORDINATES, AND THAT ORDERING IS THE RULE. The
  // corridor is stated in half-widths about a centreline; resolving it
  // after the lift would mean recovering a lateral from a world position,
  // which on a lap that folds back on itself has no single answer.
  const resolved = writeCorridor(g, placementsIn, "z1");
  const oriented = writeWorldTransform(g, resolved, lap.halfWidth, "z1");
  const boxes = writeBoxes(g, posesIn, oriented, "dress");
  const coverage = writeCoverage(g, framesIn, boxes, lap.halfWidth, "l6");

  g.output(boxes, "out", DRESS_OUTPUTS.boxes);
  g.output(oriented, "out", DRESS_OUTPUTS.placements);
  g.output(coverage, "out", DRESS_OUTPUTS.coverage);
  return { graph: g, libraryBoxes: library.pointCount };
}

/** The one async thing here: build, cook, and read the columns back. */
export async function dressLapByGraph(input: DressGraphInput): Promise<GraphDressing> {
  const t0 = performance.now();
  const { graph, libraryBoxes } = assemble(input);
  const out = (await cook(graph)).outputs;

  const boxes = requireGeo(out[DRESS_OUTPUTS.boxes], DRESS_OUTPUTS.boxes);
  const placements = requireGeo(out[DRESS_OUTPUTS.placements], DRESS_OUTPUTS.placements);
  const coverage = requireGeo(out[DRESS_OUTPUTS.coverage], DRESS_OUTPUTS.coverage);

  const lap = input.lap;
  const coveredAttr = coverage.attrs.point.require("covered");
  const hitsAttr = coverage.attrs.point.require("coverHits");
  const covered = new Array<boolean>(lap.count);
  const hits = new Uint32Array(lap.count);
  for (let i = 0; i < lap.count; i++) {
    covered[i] = coveredAttr.get(i) !== 0;
    hits[i] = hitsAttr.get(i);
  }

  // COVERED ARC OVER LAP LENGTH, summed in frame order.
  //
  // `measureEnclosure` sums the same lengths GROUPED INTO RUNS, because
  // it also reports how long each run is and how much of the cover sits
  // in the heavy tail. The two totals are the same numbers added in a
  // different order, so they agree to a few f64 ulps and not exactly —
  // which is worth knowing rather than worth chasing, since the quantity
  // is a share of a lap and nobody reads its sixteenth digit. What is NOT
  // an ordering difference is the mask, and that is compared frame by
  // frame in the test.
  let arcW = 0;
  for (let i = 0; i < lap.count; i++) {
    if (covered[i]) arcW += (lap.s[i + 1] - lap.s[i]) / lap.halfWidth;
  }

  return {
    boxes,
    placements,
    covered,
    hits,
    share: arcW / lap.lengthW,
    stamped: libraryBoxes * placements.pointCount,
    graph,
    cookMs: performance.now() - t0,
  };
}

function requireGeo(collection: DataCollection | undefined, name: string): Geometry {
  const geo = firstGeometry(collection ?? []);
  if (!geo) throw new Error(`dressGraph: output "${name}" carried no geometry`);
  return geo;
}
