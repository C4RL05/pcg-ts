/**
 * WHICH asset stands at each station, decided by a graph.
 *
 * WHAT THIS REPLACES. `placeAsset` (`assets.ts`) makes four independent
 * draws per station off one sequential stream: which asset, from a
 * weighted pick whose weights depend on the curvature THERE; how far
 * across, from that asset's own measured lateral distribution; how high,
 * from its height distribution; and which side, from its own measured
 * lean. This module is those four draws as nodes, so the lap level needs
 * no TypeScript prelude to decide what a placement IS — only what
 * `stationGraph` already decided about where placements GO.
 *
 * IT RE-BASES, LIKE THE STATION PORT DID, for the reason spelled out in
 * `stationGraph`'s header: the TypeScript draws from `rand(seed, index,
 * salt)` where `index` is the station's rank in SORTED order, and a graph
 * draws from `randomField`, which keys on a point's identity so a cook is
 * order-independent and partitionable. Rank is now computable in-graph —
 * `pathScan` exclusive over a constant on the ordered ring — but
 * reproducing it would buy nothing except a number that matched the old
 * one, at the cost of the property the whole campaign is for. So the four
 * salts become four `randomField` keys, the lap that comes out is a
 * different lap, and the suites that judge it are distributional.
 *
 * THE ONE STEP THAT COSTS ANYTHING is the weighted pick, because a
 * per-point weighted draw over a table is not a node the library has:
 * `setAttribute`'s `weights` is a cook-constant literal list, and there
 * is no per-element categorical sampler anywhere. What there IS, and what
 * this uses, is the inverse-CDF recipe `pathScan`'s own description
 * prescribes — stamp the table onto every station with `copyToPoints`,
 * weigh each copy, scan the weights into a CDF per station, keep the copy
 * whose bracket contains a uniform draw. It materialises stations x
 * assets intermediate points, about 354 x 229 = 81,000 on this lap, which
 * is affordable on a level that cooks ONCE and would not be on one that
 * cooks per cell.
 *
 * WHAT WOULD MAKE IT CHEAP, written down so the next person need not
 * re-derive it: a per-point BRACKET SEARCH over a grouped cumulative
 * column — O(N log R) instead of N x R. That is the primitive to buy when
 * a track is long enough to make 81,000 false, and not before.
 */
import {
  type Field,
  type Geometry,
  Graph,
  type NodeHandle,
  abs,
  add,
  attribute,
  cook,
  copyToPoints,
  createPointCloud,
  dataInput,
  div,
  filterByExpression,
  ge,
  le,
  lt,
  makeGeometryItem,
  mul,
  pathScan,
  pointsToPath,
  promoteAttribute,
  randomField,
  select,
  setAttribute,
  sub,
  transferAlongPath,
} from "pcg-ts";
import type { PlaceableAsset } from "./assets.js";
import {
  addCornerLanguage,
  readCornerLanguage,
} from "./cornerGraph.js";
import { CORNER_MODEL } from "./graph.js";
import { CORRIDOR } from "./zones.js";
import { SAME_PLACE_W } from "./tolerance.js";
import type { DrawnCornerLanguage, MarkerKit } from "./legibility.js";
import type { Lap } from "./lap.js";
import {
  STATION_LENGTH_ATTR,
  addCoverageRepair,
  addStationStage,
  lapAsPath,
  longestGapOf,
} from "./stationGraph.js";
import type { StationParams, StationStats } from "./stations.js";

/**
 * The columns the asset table becomes.
 *
 * A KIT IS RECORDS AND A GEOMETRY IS COLUMNS. `DataValue` has no record
 * kind and no ragged kind, so `Record<CurvatureBucket, number>` and
 * `{ median, p10, p90 }` have to be flattened before a graph can read
 * them. Four affinity columns rather than one f32x4 because the bucket is
 * chosen by a comparison ladder, and a ladder over four NAMED scalars
 * reads as the rule it transcribes; selecting a tuple component by an
 * index the ladder computes would be the same arithmetic spelled so that
 * nobody could check it against `bucketOf`.
 */
export const ASSET = {
  /** Index into the pool this cloud was built from. The answer's identity. */
  ord: "assetOrd",
  /**
   * The kit's OWN id for the asset, carried so the answer can be checked.
   *
   * A CHOICE IS AN INDEX, and an index into the wrong pool is not an
   * error — it is a different asset, silently. `reserveFor` answers a
   * pool of the SAME LENGTH for every seed and varies only its
   * membership, so a range check cannot see the mistake: cooking against
   * seed 1's pool and dressing at seed 2 was measured to name a different
   * asset at 23 of 329 placements with every index in range. The id
   * travels with the choice so `dressLap` can compare it against the
   * asset it is about to resolve, which turns that into a throw.
   */
  id: "assetId",
  /** How often the asset appeared on the circuit it was measured on. */
  instances: "assetInst",
  affStraight: "affStraight",
  affEasy: "affEasy",
  affMedium: "affMedium",
  affTight: "affTight",
  latP10: "latP10",
  latMed: "latMed",
  latP90: "latP90",
  hgtP10: "hgtP10",
  hgtMed: "hgtMed",
  hgtP90: "hgtP90",
  /** Share of the asset's instances that were right of travel. */
  right: "assetRight",
  /**
   * The asset's own extents, which Z-1 reads and nothing else does.
   *
   * WIDTH AND HEIGHT ONLY. `resolveCorridor` asks two questions of a
   * piece -- is it SMALL, by `across < 1 && tall < 1.5`, and how far must
   * its NEAR FACE move to clear the corridor edge, by `across / 2` -- and
   * the along-track extent answers neither.
   */
  across: "assetAcross",
  tall: "assetTall",
} as const;

/** The columns the choice stage writes on, or carries to, a station. */
export const CHOICE = {
  /** Curvature at the station, in 1/W. Exactly zero on a straight. */
  curveK: "stationK",
  /** The four independent uniforms, one per draw `placeAsset` makes. */
  uPick: "uPick",
  uLat: "uLat",
  uHgt: "uHgt",
  uSide: "uSide",
  /** Which station a surviving copy belongs to, by the station's point index. */
  stationIdx: "stationIdx",
  /** The weight a copy carries at its own station's curvature. */
  weight: "pickW",
  /** Running weight below this copy, and through it. The pick's bracket. */
  cumBelow: "pickCumLo",
  cumThrough: "pickCumHi",
  /** Every asset's weight at this station, summed. */
  weightTotal: "pickTotal",
  /** The uniform scaled into the station's own weight range. */
  draw: "pickDraw",
  /** Signed offset across the track in W, positive RIGHT of travel. */
  t: "placeT",
  /** Height in W, on whatever datum the source's `where.height` used. */
  h: "placeH",
} as const;

/**
 * The world-unit arc column `transferAlongPath` reads on the stations.
 *
 * The same name `pointScatterOnPath` writes, and deliberately: this stage
 * OVERWRITES it rather than adding a second arc column, so there is one
 * answer to "where is this station" on the cloud rather than a fresh one
 * and a stale one for a reader to pick between.
 */
const ARC_ATTR = "arcW";

/**
 * {@link bucketOf}'s cuts, as curvature rather than radius.
 *
 * WHY THE RECIPROCAL. `bucketOf` cuts on RADIUS, which is Infinity on a
 * straight — an honest value that compares correctly against every
 * threshold, and one that cannot be INTERPOLATED. Interpolation is
 * exactly what reading a frame column at a station between two frames is:
 * `transferAlongPath` has no nearest mode, and blending Infinity with a
 * finite radius gives Infinity or NaN across the whole neighbourhood of
 * every straight. Curvature is the same measurement with its degenerate
 * value at the other end — a straight is exactly 0, it blends, and the
 * cuts inverted are the same cuts.
 *
 * THE CUTS ARE ROUNDED TO f32, and that is not decoration. The column
 * holds `f32(1 / f32(R))`, and comparing it against the f64 reciprocal
 * gets the boundary itself WRONG in a stated direction rather than an
 * arbitrary one: `f32(1/40)` is 0.02500000037, above `1/40`, so a radius
 * of exactly 40 W fails `le` and lands in EASY where `bucketOf(40)`
 * answers straight — measured, along with a sliver above each cut
 * (`[40, 40.0000016]`, `[15, 15.00000045]`, `[7, 7.00000021]`) that goes
 * one bucket tighter than it should. Rounding the constant the same way
 * the column was rounded makes the cut itself exact and halves what is
 * left, which is a relative width of about 4e-8 on the OTHER side.
 *
 * WHAT ACTUALLY MOVES TRACK IS THE TRANSFER, NOT THE LADDER, and the two
 * should not be confused. `bucketOf(radiusAtW(lap, s))` reads the NEAREST
 * frame; this reads an interpolation between two. On the shipped lap at
 * seed 1 that puts 12 of 329 stations (3.6%) in a different bucket —
 * easy/straight 5, medium/easy 3, medium/tight 4 — against histograms
 * that are otherwise nearly identical. Interpolation is the more
 * defensible reading of "the curvature THERE", and the port re-bases
 * anyway, so this is a difference rather than an error. It is written
 * down because "the cuts inverted are the same cuts" is a claim about
 * the LADDER, and reading it as "the same stations get the same bucket"
 * would be wrong by two orders of magnitude.
 */
const CURVE_CUT = {
  /** At or below this, a straight: radius >= 40 W. */
  straight: Math.fround(1 / 40),
  /** At or below this, an easy bend: radius >= 15 W. */
  easy: Math.fround(1 / 15),
  /** At or below this, a medium corner: radius >= 7 W. */
  medium: Math.fround(1 / 7),
} as const;

/**
 * The four `randomField` keys, one per draw, replacing four hash salts.
 *
 * INDEPENDENT, MEASURED: pairwise |r| over 20,000 points runs 1.3e-4 to
 * 9.5e-3 against a noise floor of 1/sqrt(n) = 7.1e-3, with controls that
 * report r = 1 for a field against itself, -1 against its complement, and
 * 0.035 for a deliberate 3.5% blend — so the estimator can see a
 * correlation of the size these would have to be failing at.
 *
 * THE NAMES ARE NOT WHAT MAKES THEM INDEPENDENT, which is worth stating
 * because the obvious reading is wrong. `randomField` hashes
 * `(ctx.seed, keyHash, pointIdentity)` and `ctx.seed` is the NODE's
 * derived seed, so these four draws are four streams because they are on
 * four nodes — the same key written twice under two names measures
 * r = -0.0009, not 1. The names buy readability and stability of intent:
 * a fifth draw added later cannot silently mean the same thing as an
 * existing one, and a graph that is re-serialised keeps saying which
 * draw is which.
 */
const KEY = {
  pick: "asset.pick",
  lateral: "asset.lateral",
  height: "asset.height",
  side: "asset.side",
} as const;

/**
 * The kit's placeable assets, flattened onto a point cloud.
 *
 * THE POINT ORDER IS THE POOL ORDER, and that is the whole contract: the
 * `ord` column is a point's own index, so the number a cooked placement
 * carries indexes straight back into the array the caller passed. Nothing
 * downstream sorts, and `copyToPoints` lays its copies out in contiguous
 * per-target blocks in source order, so the pick's bracket walks the pool
 * in the order `placeAsset`'s loop walks it.
 *
 * WHAT IS SANITISED HERE AND WHAT IS NOT. `weightAt` guards a non-finite
 * affinity to zero, and that guard is applied to the COLUMN rather than
 * to the field that reads it: a NaN in the measured JSON is a defect in
 * the input, and clamping it once where the input becomes data is honest,
 * whereas a NaN test inside the weight expression would be the graph
 * carrying a workaround for someone else's file. The RULE — instances
 * times the affinity of the bucket the station is in — stays in the
 * graph, which is the half that has to be checkable against `weightAt`.
 *
 * An asset with no `where` gets all-zero columns, so it carries zero
 * weight in every bucket and can never be picked. That is `weightAt`
 * answering 0 for the same asset, spelled as data.
 */
export function assetCloud(pool: readonly PlaceableAsset[]): Geometry {
  const geo = createPointCloud(pool.length);
  const f32 = (name: string) => geo.attrs.point.add(name, "f32", 1);
  const ord = geo.attrs.point.add(ASSET.ord, "i32", 1);
  const id = geo.attrs.point.add(ASSET.id, "i32", 1);
  const inst = f32(ASSET.instances);
  const aff = [
    f32(ASSET.affStraight),
    f32(ASSET.affEasy),
    f32(ASSET.affMedium),
    f32(ASSET.affTight),
  ];
  const lat = [f32(ASSET.latP10), f32(ASSET.latMed), f32(ASSET.latP90)];
  const hgt = [f32(ASSET.hgtP10), f32(ASSET.hgtMed), f32(ASSET.hgtP90)];
  const right = f32(ASSET.right);
  const across = f32(ASSET.across);
  const tall = f32(ASSET.tall);

  const clean = (v: number): number => (Number.isFinite(v) ? Math.max(0, v) : 0);
  for (let i = 0; i < pool.length; i++) {
    const a = pool[i];
    ord.set(i, i);
    id.set(i, a.id);
    const w = a.where;
    if (!w) continue;
    // `instances` IS CLEANED TOO, which `weightAt` does not do — and the
    // reason is that a graph cannot survive what a loop shrugs off. A
    // negative count makes one weight negative, the running scan stops
    // being monotonic, and the brackets stop tiling: a pool of
    // [1, -0.5, 1] over 500 stations was measured to leave 182 of them
    // holding TWO survivors. `placeAsset`'s subtraction loop merely picks
    // oddly in the same case. A count below zero is a defect in the
    // measured file either way, and this is the honest place to say so.
    inst.set(i, clean(a.instances));
    across.set(i, a.size.across);
    tall.set(i, a.size.tall);
    aff[0].set(i, clean(w.affinity.straight));
    aff[1].set(i, clean(w.affinity.easy));
    aff[2].set(i, clean(w.affinity.medium));
    aff[3].set(i, clean(w.affinity.tight));
    lat[0].set(i, w.lateral.p10);
    lat[1].set(i, w.lateral.median);
    lat[2].set(i, w.lateral.p90);
    hgt[0].set(i, w.height.p10);
    hgt[1].set(i, w.height.median);
    hgt[2].set(i, w.height.p90);
    right.set(i, w.rightOfTravel);
  }
  return geo;
}

/**
 * `drawQuantile`, as a field — and it is TWO lines, not four.
 *
 * The TypeScript states four branches, and the outer two are
 * algebraically the same lines as their neighbours: below p10 it
 * continues the p10-to-median segment's slope, which IS that segment
 * evaluated outside its range, and above p90 it continues the
 * median-to-p90 slope likewise. So the piecewise-linear inverse CDF has
 * exactly two pieces, and they meet at the median where both give the
 * median exactly. Writing it as two makes the extrapolation that header
 * promises visible instead of merely stated: there is no clamp here
 * because there is no third case to clamp.
 */
export function quantileField(p10: Field, median: Field, p90: Field, u: Field): Field {
  // 1/0.4 is 2.5 exactly, so neither slope carries a division.
  const lower = add(p10, mul(mul(sub(u, 0.1), 2.5), sub(median, p10)));
  const upper = add(median, mul(mul(sub(u, 0.5), 2.5), sub(p90, median)));
  return select(le(u, 0.5), lower, upper);
}

/** Write one scalar column and return the node, to keep the chain flat. */
function put(
  g: Graph,
  from: { readonly node: NodeHandle; readonly pin: string },
  name: string,
  value: Field | number,
  id: string,
): NodeHandle {
  const n = g.add(setAttribute, { name, tupleSize: 1, value }, id);
  g.connect(from.node, from.pin, n, "in");
  return n;
}

/** What {@link addAssetChoiceStage} leaves behind. */
export interface AssetChoiceStage {
  /**
   * One point per station that drew an asset, carrying {@link CHOICE}'s
   * `stationIdx`, `t` and `h` and {@link ASSET}'s `ord`.
   */
  readonly out: NodeHandle;
}

export interface AssetChoiceOptions {
  /** World units per half-width — the scale a station's W is measured in. */
  readonly halfWidth: number;
  /** How many assets the table has. Refused below 2; see the stage. */
  readonly assetCount: number;
  /** Node id prefix, so two stages can share one graph. */
  readonly prefix?: string;
  /** The station column on the incoming cloud. */
  readonly stationAttr?: string;
}

/**
 * The four draws `placeAsset` makes, as nodes.
 *
 * THE UNIFORMS ARE DRAWN ON THE STATION, NOT ON THE COPY, and that is
 * load-bearing rather than tidy. `copyToPoints` gives each copy the seed
 * `hashCombine(sourceSeed, targetSeed)`, so the 229 copies of one station
 * hold 229 distinct identities and `randomField` draws 229 DIFFERENT
 * numbers on them. A pick that read its uniform off the copy would be
 * comparing a different `u` against every bracket, which is not a draw
 * from anything. Drawing on the station and carrying the value through
 * `targetNames` gives every copy of a station the same `u`, which is what
 * an inverse-CDF pick means — and it leaves the lateral, height and side
 * draws independent of WHICH asset won, exactly as they are in the
 * TypeScript, where they come off one index with different salts.
 *
 * THE BRACKET IS TWO SCANS, NOT A SCAN AND AN ADDITION, and the reason
 * is a GUARANTEE rather than an observed bug — which is worth saying
 * plainly, because the obvious spelling was tried and nothing caught it.
 * `cum <= x < cum + w` computes a bracket's top from two numbers
 * `pathScan` has already rounded to f32, while its successor's bottom is
 * the f64 partial sum rounded once. The two disagree by a rounding
 * error, so the brackets do not tile: they overlap at some boundaries
 * (two survivors) and part at others (none). Scanning the same column
 * twice, exclusive and inclusive, makes both bounds the SAME f64 partial
 * sum rounded at the same place, so every bracket's top IS its
 * successor's bottom, to the bit.
 *
 * SUBSTITUTING THE NAIVE FORM PASSES ALL SIXTEEN TESTS IN
 * `racetrackAssetGraph`, measured, including the duplicate guard in
 * `cookLapPlacements` over six laps of this vocabulary. That is the
 * honest report and it is also the argument: the gap or overlap at a
 * boundary is about 1e-7 of the station's total, so it decides roughly
 * one draw in ten million, and a suite of a few thousand draws cannot
 * tell the two apart. A rule that is right by construction and one that
 * is right nearly always cost the same single node here, and only one of
 * them stays right on a kit whose weights are spread more widely.
 *
 * Exactly one copy per station survives whenever that station's total is
 * positive, and a zero-weight asset gets an empty bracket and can never
 * be picked — which is `weightAt` returning 0, enforced by construction
 * rather than tested for.
 *
 * A STATION WHOSE ASSETS ALL WEIGH ZERO KEEPS NO COPY, and that is not an
 * error: `placeAsset` answers `undefined` in exactly that case and
 * `dressLap` skips the station. The survivor cloud is therefore allowed
 * to be shorter than the station cloud, which is why every survivor
 * carries `stationIdx` rather than being matched by position.
 */
export function addAssetChoiceStage(
  g: Graph,
  stations: { readonly node: NodeHandle; readonly pin: string },
  assets: { readonly node: NodeHandle; readonly pin: string },
  path: { readonly node: NodeHandle; readonly pin: string },
  opts: AssetChoiceOptions,
): AssetChoiceStage {
  const pre = opts.prefix ?? "ac";
  const stationAttr = opts.stationAttr ?? "stationW";
  const { halfWidth, assetCount } = opts;
  if (!(halfWidth > 0) || !Number.isFinite(halfWidth)) {
    throw new Error(
      `addAssetChoiceStage: halfWidth must be a finite number > 0, got ${halfWidth}. It converts a station in W into the world-unit arc length transferAlongPath reads.`,
    );
  }
  // THE PICK IS A PATH PER STATION and a path needs two points, so a
  // table of one asset has no CDF to scan. Refused here, naming the
  // alternative, rather than skipped by `pointsToPath` and discovered
  // downstream as an empty result: a pick over one asset is that asset,
  // and the caller who has one should say so instead of asking for a
  // draw. Two is enough even when the second can never win — a
  // zero-weight row gets an empty bracket by construction.
  if (!Number.isInteger(assetCount) || assetCount < 2) {
    throw new Error(
      `addAssetChoiceStage: assetCount must be a whole number >= 2, got ${assetCount}. The weighted pick scans one path per station over the asset table, and a path needs two points; a pool of one asset is not a draw, so place it directly instead.`,
    );
  }

  // ---- 1. the curvature at each station --------------------------------
  // THE RECIPROCAL IS TAKEN ON THE PATH, once per frame, not on the
  // station after transfer. Interpolating 1/R and reciprocating the
  // interpolation are different numbers: a station halfway between a
  // straight and a corner would read the harmonic mean of two radii
  // rather than the mean of two curvatures, and on the straight side that
  // mean is Infinity.
  const pathK = put(
    g,
    path,
    CHOICE.curveK,
    div(1, attribute(CORNER_MODEL.radius)),
    `${pre}PathK`,
  );

  // The arc position is RECOMPUTED rather than reused. `pointScatterOnPath`
  // wrote `arcW` when it drew the station, and D-4's repair then moved
  // some stations by rewriting the station column alone — so the scatter's
  // `arcW` is stale for exactly the placements the repair touched, which
  // are the ones whose curvature matters most.
  const arc = put(
    g,
    stations,
    ARC_ATTR,
    mul(halfWidth, attribute(stationAttr)),
    `${pre}Arc`,
  );

  const atK = g.add(
    transferAlongPath,
    { arcAttr: ARC_ATTR, attributes: [CHOICE.curveK] },
    `${pre}StationK`,
  );
  g.connect(pathK, "out", atK, "path");
  g.connect(arc, "out", atK, "at");

  // ---- 2. the four uniforms, on the station ----------------------------
  const uPick = put(g, { node: atK, pin: "out" }, CHOICE.uPick, randomField(KEY.pick), `${pre}UPick`);
  const uLat = put(g, { node: uPick, pin: "out" }, CHOICE.uLat, randomField(KEY.lateral), `${pre}ULat`);
  const uHgt = put(g, { node: uLat, pin: "out" }, CHOICE.uHgt, randomField(KEY.height), `${pre}UHgt`);
  const uSide = put(g, { node: uHgt, pin: "out" }, CHOICE.uSide, randomField(KEY.side), `${pre}USide`);

  // ---- 3. the table, stamped on every station --------------------------
  const stamped = g.add(
    copyToPoints,
    {
      targetNames: [CHOICE.curveK, CHOICE.uPick, CHOICE.uLat, CHOICE.uHgt, CHOICE.uSide],
      targetIndexAttr: CHOICE.stationIdx,
      topology: "drop",
    },
    `${pre}Stamp`,
  );
  g.connect(assets.node, assets.pin, stamped, "source");
  g.connect(uSide, "out", stamped, "target");

  // `weightAt`, transcribed: the asset's natural frequency, modulated by
  // its affinity for the curvature bucket the station is in. The ladder
  // is `le` rather than `ge` on radius so that a NaN curvature — a frame
  // whose measurement failed — falls through every test to TIGHT, which
  // is where `bucketOf` puts it too.
  const k = attribute(CHOICE.curveK);
  const affinity = select(
    le(k, CURVE_CUT.straight),
    attribute(ASSET.affStraight),
    select(
      le(k, CURVE_CUT.easy),
      attribute(ASSET.affEasy),
      select(le(k, CURVE_CUT.medium), attribute(ASSET.affMedium), attribute(ASSET.affTight)),
    ),
  );
  const weighed = put(
    g,
    { node: stamped, pin: "out" },
    CHOICE.weight,
    mul(attribute(ASSET.instances), affinity),
    `${pre}Weigh`,
  );

  // ---- 4. one CDF per station, and the bracket -------------------------
  // The group key is the target index `copyToPoints` already wrote, which
  // is the case `pointsToPath`'s own description names. `shortGroups` is
  // 'skip' because these groups are DATA rather than authored: a station
  // that somehow reached this with too few copies belongs to no path,
  // reads a zero scan, and drops — rather than refusing the cook.
  const grouped = g.add(
    pointsToPath,
    { groupAttr: CHOICE.stationIdx, closed: false, shortGroups: "skip" },
    `${pre}PerStation`,
  );
  g.connect(weighed, "out", grouped, "in");

  const below = g.add(
    pathScan,
    { name: CHOICE.weight, outName: CHOICE.cumBelow, mode: "exclusive" },
    `${pre}CumLo`,
  );
  g.connect(grouped, "out", below, "in");

  const through = g.add(
    pathScan,
    {
      name: CHOICE.weight,
      outName: CHOICE.cumThrough,
      mode: "inclusive",
      totalAttr: CHOICE.weightTotal,
    },
    `${pre}CumHi`,
  );
  g.connect(below, "out", through, "in");

  // A total is a fact about a PATH, so `pathScan` reports it on the
  // primitive domain; a field reads the point domain. One point of each
  // path is in exactly one path, so 'first' is not a choice between
  // candidates — it is the only candidate.
  const total = g.add(
    promoteAttribute,
    { name: CHOICE.weightTotal, from: "primitive", to: "point", mode: "first" },
    `${pre}Total`,
  );
  g.connect(through, "out", total, "in");

  const draw = put(
    g,
    { node: total, pin: "out" },
    CHOICE.draw,
    mul(attribute(CHOICE.uPick), attribute(CHOICE.weightTotal)),
    `${pre}Draw`,
  );

  // `randomField` answers [0, 1), so the draw is strictly below the total
  // and the last bracket is reachable while nothing lands past it. A
  // station whose total is zero draws zero into a bracket of [0, 0),
  // which is empty, so it keeps nothing — see the header.
  const x = attribute(CHOICE.draw);
  const picked = g.add(
    filterByExpression,
    {
      predicate: mul(le(attribute(CHOICE.cumBelow), x), lt(x, attribute(CHOICE.cumThrough))),
      topology: "drop",
    },
    `${pre}Pick`,
  );
  g.connect(draw, "out", picked, "in");

  // ---- 5. where it stands, from its own measurements -------------------
  const tMag = quantileField(
    attribute(ASSET.latP10),
    attribute(ASSET.latMed),
    attribute(ASSET.latP90),
    attribute(CHOICE.uLat),
  );
  // The asset's own side lean, not an even coin: a barrier that only ever
  // faced the track keeps facing it, and an asset with no lean sits at
  // 0.5, where this is a fair flip.
  const rightward = lt(attribute(CHOICE.uSide), attribute(ASSET.right));
  const placedT = put(
    g,
    { node: picked, pin: "out" },
    CHOICE.t,
    select(rightward, abs(tMag), mul(-1, abs(tMag))),
    `${pre}Lateral`,
  );

  const placedH = put(
    g,
    { node: placedT, pin: "out" },
    CHOICE.h,
    quantileField(
      attribute(ASSET.hgtP10),
      attribute(ASSET.hgtMed),
      attribute(ASSET.hgtP90),
      attribute(CHOICE.uHgt),
    ),
    `${pre}Height`,
  );

  return { out: addCorridorStage(g, { node: placedH, pin: "out" }, pre) };
}

/**
 * Z-1, resolved by what the piece IS.
 *
 * THE LAST PURELY PER-PLACEMENT RULE, and the reason it belongs here
 * rather than with the repairs: it reads one placement's lateral, height
 * and extents and answers from those alone. Nothing about the lap enters
 * it. Measured across eight seeds it fires 19 to 33 times a lap, which
 * makes it the only rule left outside `dressLap`'s repair loop that does
 * real work.
 *
 * THE TWO EXITS ARE DIFFERENT, and that is the whole rule. Clamping
 * everything to the corridor edge satisfies Z-1 and costs the verge band,
 * because the archetypes reaching inside 1 W are the same ones filling
 * 1.0 to 1.5 W; lifting everything is worse than either. Small art RISES,
 * keeping its lateral; large art STANDS OFF, keeping its band.
 *
 * ITS EDGE GOES TO THE EDGE, NOT ITS CENTRE. Moving the centre to
 * |t| = 1 W leaves half the object's width over the road, and the wider
 * the piece the worse it is -- `zones.ts` calls that the fifth time in
 * this demo that a centre was used where an extent was meant.
 *
 * THE DATUM IS THE BASE, NOT THE CENTRE, and this is where a port could
 * quietly go wrong: the choice stage draws `h` as the placement's CENTRE
 * height, and `inCorridor` tests the BASE. So the base is derived, tested
 * and resolved, and only then turned back into a centre -- exactly the
 * round trip `dressLap` does by hand, and the one whose f32 residue the
 * slice-2 notes flagged as a convergence hazard for `moved()`.
 */
function addCorridorStage(
  g: Graph,
  from: { readonly node: NodeHandle; readonly pin: string },
  pre: string,
): NodeHandle {
  const baseH = sub(attribute(CHOICE.h), mul(0.5, attribute(ASSET.tall)));
  const t = attribute(CHOICE.t);
  // `inCorridor`, transcribed, epsilon included: a placement sitting
  // exactly on an edge is OUTSIDE, so the rule does not fire on the
  // pieces it has already moved there.
  const inside = mul(
    lt(abs(t), CORRIDOR.halfWidthW - SAME_PLACE_W),
    mul(
      ge(baseH, CORRIDOR.floorW - SAME_PLACE_W),
      lt(baseH, CORRIDOR.ceilingW - SAME_PLACE_W),
    ),
  );
  const small = mul(
    lt(attribute(ASSET.across), 1),
    lt(attribute(ASSET.tall), 1.5),
  );

  // `Math.sign(t || 1)`: a placement at exactly zero stands off to the
  // RIGHT, because `0 || 1` is 1. Spelled as a `ge` so that zero takes
  // the positive branch, which is the same answer by a different route
  // and does not depend on JavaScript's falsiness.
  const stood = put(
    g,
    from,
    CHOICE.t,
    select(
      mul(inside, sub(1, small)),
      mul(
        select(ge(t, 0), 1, -1),
        add(CORRIDOR.halfWidthW, mul(0.5, attribute(ASSET.across))),
      ),
      t,
    ),
    `${pre}Z1Lateral`,
  );
  // SMALL ART RISES TO THE CEILING, as a BASE, so the centre it is stored
  // as is the ceiling plus half the piece.
  return put(
    g,
    { node: stood, pin: "out" },
    CHOICE.h,
    select(
      mul(inside, small),
      add(CORRIDOR.ceilingW, mul(0.5, attribute(ASSET.tall))),
      attribute(CHOICE.h),
    ),
    `${pre}Z1Height`,
  );
}

/** One station's asset, as an index into the pool the cook was given. */
export interface AssetChoice {
  /** Index into that pool. `pool[assetIndex]` is the asset. */
  readonly assetIndex: number;
  /**
   * The kit's own id for that asset — see {@link ASSET.id}.
   *
   * Carried so the index can be CHECKED rather than trusted: it is what
   * lets `dressLap` refuse a pool that is not the one this was cooked
   * against, instead of quietly dressing the lap with different objects.
   */
  readonly assetId: number;
  /** Signed offset across the track, positive RIGHT of travel, in W. */
  readonly t: number;
  /** Height in W, on whatever datum the source's `where.height` used. */
  readonly h: number;
}

/** What one cook of the lap level decides. */
export interface LapPlacements {
  /** Exactly what `makeStationsDetailed` answers, so it is a drop-in. */
  readonly stations: StationStats;
  /**
   * Parallel to `stations.stations`: entry `i` is the asset for the i-th
   * station in ASCENDING station order, or undefined where every asset
   * weighed zero — which is `placeAsset`'s own `undefined`.
   */
  readonly choices: readonly (AssetChoice | undefined)[];
  /**
   * Where L-2's markers and L-3's ruler marks go — `DressOptions.language`.
   *
   * Absent when no {@link MarkerKit} was handed in, which is the case
   * `reserveMarkers` reports when a kit has fewer than three verticals to
   * reserve: there is no corner language to place, and `dressLap` already
   * answers that by placing none.
   */
  readonly language?: DrawnCornerLanguage;
}

/**
 * Run the whole lap level — stations, D-4's repair, and asset choice — as
 * ONE graph, and hand back what `dressLap` needs.
 *
 * ONE GRAPH RATHER THAN TWO COOKS, because the endpoint of this campaign
 * is a lap LEVEL, and a level is one graph. Cooking the stations, reading
 * them into TypeScript and cooking again would give the same numbers
 * today and would have to be undone to reach that endpoint.
 *
 * THE POOL IS THE CALLER'S, and it must be the same array `dressLap` will
 * dress from, because a choice is an INDEX into it. `reserveFor` in
 * `dress.ts` is the one definition of what that pool is; call it once and
 * pass its `pool` to both.
 */
export async function cookLapPlacements(opts: {
  readonly lap: Lap;
  readonly seed: number;
  readonly pool: readonly PlaceableAsset[];
  readonly params?: StationParams;
  readonly densityScale?: number;
  /**
   * The three reserved marker assets, when the caller has them.
   *
   * FROM THE SAME `reserveFor` CALL AS `pool`, necessarily: the pool is
   * what is LEFT once these three are held back, so a kit and a seed
   * decide both together and splitting them would let a lap dress from a
   * pool that still contains its own corner markers.
   */
  readonly markers?: MarkerKit;
}): Promise<LapPlacements> {
  const { lap, seed, pool, markers } = opts;
  if (!lap.corner) {
    throw new Error(
      "cookLapPlacements: this lap carries no corner model, and the asset pick is weighted by the curvature at each station. Cook the lap through buildRoadGraph (which writes cornerRadiusW) before dressing it, or use cookStations, which does not read curvature.",
    );
  }

  const g = new Graph(seed);
  const pathIn = g.add(dataInput, {}, "lapPath");
  g.setParam(pathIn, "items", [makeGeometryItem(lapAsPath(lap))]);
  const assetsIn = g.add(dataInput, {}, "assetTable");
  g.setParam(assetsIn, "items", [makeGeometryItem(assetCloud(pool))]);

  const stage = addStationStage(g, { node: pathIn, pin: "out" }, {
    halfWidth: lap.halfWidth,
    params: opts.params,
    densityScale: opts.densityScale,
    lengthAttr: STATION_LENGTH_ATTR,
  });
  const repair = addCoverageRepair(g, { node: stage.out, pin: "out" }, {
    halfWidth: lap.halfWidth,
    stationAttr: stage.stationAttr,
    lengthAttr: STATION_LENGTH_ATTR,
  });
  const choice = addAssetChoiceStage(
    g,
    { node: repair.out, pin: "carry" },
    { node: assetsIn, pin: "out" },
    { node: pathIn, pin: "out" },
    { halfWidth: lap.halfWidth, assetCount: pool.length, stationAttr: stage.stationAttr },
  );

  g.output(stage.out, "out", "raw");
  g.output(repair.out, "carry", "fixed");
  g.output(repair.out, repair.roundsPin, "rounds");
  g.output(repair.out, repair.convergedPin, "converged");
  g.output(choice.out, "out", "chosen");

  // THE CORNER LANGUAGE JOINS THE SAME GRAPH, not a second cook, for the
  // reason this function exists at all: the endpoint is a lap LEVEL, and
  // a level is one graph. It shares the lap path with the stations, so
  // the frames are resampled once and the corner model read once.
  const language =
    markers === undefined
      ? undefined
      : addCornerLanguage(g, { node: pathIn, pin: "out" }, markers, lap, "cl");
  if (language) {
    g.output(language.markers, "out", "l2");
    g.output(language.rulers, "out", "l3");
  }

  const cooked = await cook(g);
  const geoOf = (name: string): Geometry =>
    (cooked.outputs[name][0] as { geo: Geometry }).geo;
  const column = (geo: Geometry, name: string): number[] => {
    const col = geo.attrs.point.require(name);
    const out: number[] = [];
    for (let i = 0; i < geo.attrs.point.count; i++) out.push(col.get(i) as number);
    return out;
  };

  // THE SURVIVORS ARE MATCHED BY `stationIdx`, NOT BY POSITION. They come
  // out in ascending station-index order and there is normally exactly one
  // per station, so position would work — right up until a station whose
  // assets all weighed zero kept none, after which every later pairing
  // would be silently off by one.
  const fixed = geoOf("fixed");
  const stationW = column(fixed, stage.stationAttr);
  const byStation = new Array<AssetChoice | undefined>(stationW.length).fill(undefined);
  const chosen = geoOf("chosen");
  const idx = column(chosen, CHOICE.stationIdx);
  const ord = column(chosen, ASSET.ord);
  const ids = column(chosen, ASSET.id);
  const t = column(chosen, CHOICE.t);
  const h = column(chosen, CHOICE.h);
  for (let i = 0; i < idx.length; i++) {
    // TWO ASSETS AT ONE STATION MEANS THE WEIGHTS WERE NOT ALL
    // NON-NEGATIVE, and it must not be resolved by keeping the last one.
    // With a non-negative weight column the running scan is monotonic and
    // the brackets tile [0, total) exactly, so this cannot fire; the one
    // input that makes it fire is a negative weight, which turns the scan
    // around and lets two windows cover the same draw. `assetCloud`
    // clamps both factors for that reason, so reaching this means a
    // column arrived from somewhere else. Named as the arithmetic it is,
    // because "the brackets overlap" would send the reader to the scan
    // and the scan is not what is wrong.
    if (byStation[idx[i]] !== undefined) {
      throw new Error(
        `cookLapPlacements: station ${idx[i]} kept two assets (pool index ${byStation[idx[i]]?.assetIndex} and ${ord[i]}). The weighted pick needs a non-negative weight at every asset, so that the running scan is monotonic and the brackets tile the station's range exactly once — a negative instances or affinity is what breaks it.`,
      );
    }
    byStation[idx[i]] = { assetIndex: ord[i], assetId: ids[i], t: t[i], h: h[i] };
  }

  // Sorted TOGETHER, because `dressLap` indexes the two lists in lockstep
  // and the station list has always been sorted. Sorting them separately
  // is the pairing bug this shape exists to make unwriteable.
  const rows = stationW.map((s, i) => ({ s, choice: byStation[i] }));
  rows.sort((a, b) => a.s - b.s);

  const raw = column(geoOf("raw"), stage.stationAttr).sort((a, b) => a - b);
  const rounds = (cooked.outputs.rounds[0] as { value: number }).value;
  const converged = (cooked.outputs.converged[0] as { value: number }).value;
  return {
    stations: {
      stations: rows.map((r) => r.s),
      // ONE MOVE PER ROUND, and the last round is the one that found
      // nothing left to move — so moves are one fewer than rounds. When
      // the loop ran out of rounds instead of settling, every round moved
      // something and there is no idle final pass to discount.
      gapRepairs: converged === 1 ? Math.max(0, rounds - 1) : rounds,
      worstGapBeforeW: longestGapOf(raw, lap.lengthW),
      // The per-move log `stations.ts` keeps is not reconstructible from a
      // cooked cloud, and nothing reads it off this path. An empty log is
      // honest; a fabricated one would not be.
      log: [],
    },
    choices: rows.map((r) => r.choice),
    language: language ? readCornerLanguage(cooked) : undefined,
  };
}
