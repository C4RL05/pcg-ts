/**
 * THE STATION PROCESS AS A GRAPH: where the placements go, decided by
 * nodes rather than by the TypeScript in `stations.ts`.
 *
 * WHAT THIS IS FOR. The lap level's graph is built FROM an already-cooked
 * lap today, because `dressGraph` needs a placement list that only
 * TypeScript can produce. That prelude is the reason a game cannot
 * generate a track from a serialized graph and a spline alone, and this
 * module is the first half of removing it — the half that decides how
 * many placements there are and where along the lap each one sits.
 *
 * IT DOES NOT REPRODUCE `makeStationsDetailed` BIT FOR BIT, and it cannot.
 * That function runs on ONE sequential PCG32 stream: the super positions,
 * then one draw per super for a stochastic rounding, then two per cluster,
 * then three per instance, then one per background placement, all in
 * written order. Change how many draws any stage takes and every station
 * after it moves. A field draws from `randomField`, which is keyed on a
 * point's IDENTITY rather than on a position in a stream — and that is
 * precisely the property that makes a cook independent of order, budget
 * and partition, which is a hard invariant of this library. A node that
 * consumed a shared sequential stream would be a node whose output
 * depended on how many points some other node had already asked about.
 *
 * So this produces a DIFFERENT lap, not a worse one, and every measured
 * figure downstream re-baselines with it. That is affordable only because
 * `racetrackStations.test.ts` was written as DISTRIBUTIONAL gates rather
 * than golden values — the process was fitted to a published curve, so
 * what has to survive is the curve, the exact budget and D-4's floor, not
 * a particular draw. `PLAN.md` records those gates as this port's
 * acceptance criteria.
 *
 * EVERYTHING HERE IS IN HALF-WIDTHS, like every other rule in this demo,
 * while the path's own arc coordinate is in WORLD UNITS. The conversion
 * happens once, at the point where a scattered arc position becomes a
 * `station`, and `halfWidth` is a graph-construction constant rather than
 * a cooked value — the same standing this demo already gives it in
 * `buildDressingGraph`.
 */
import {
  type ExposedPin,
  type Geometry,
  type Field,
  Graph,
  type NodeHandle,
  add,
  attribute,
  attributeReduce,
  cook,
  copyToPoints,
  createPolyline,
  dataInput,
  cos,
  eq,
  filterByExpression,
  floor,
  gt,
  index,
  log,
  lt,
  makeGeometryItem,
  max,
  mergePoints,
  min,
  mod,
  mul,
  pathShift,
  pointLine,
  pointScatterOnPath,
  pointsToPath,
  promoteAttribute,
  randomField,
  removeAttribute,
  repeatUntilNode,
  select,
  setAttribute,
  sqrt,
  sub,
  transferByIndex,
} from "pcg-ts";
import { COVERAGE, FITTED, type StationParams, type StationStats } from "./stations.js";
import { CORNER_MODEL } from "./graph.js";
import type { Lap } from "./lap.js";

/**
 * The smallest uniform a gaussian may take the log of.
 *
 * `randomField` returns EXACTLY ZERO with probability 2^-24 — `hashFloat`
 * is `(h >>> 8) * 2^-24`, so any hash below 256 lands on it, and that is
 * about one draw in 16.7 million rather than never. `log(0)` is
 * -Infinity, and a non-finite field value propagates silently through
 * `evaluateField` until `resolveOn` refuses the whole column. So an
 * unguarded Box-Muller does not draw a wild number once in a while: it
 * turns a one-in-16.7-million draw into a hard cook failure on a lap that
 * worked yesterday. The clamp costs two field nodes and distorts nothing
 * measurable — `sqrt(-2 * log(1e-7))` is 5.68 sigma, past which the
 * normal has about 1.3e-8 of its mass, so the tail this cuts is smaller
 * than the event it is guarding against.
 *
 * `stations.ts` clamps at 1e-12 for the same reason. The two numbers need
 * not agree: that one guards `Math.random`-grade f64 draws and this one
 * guards 24-bit f32 draws, and neither lap is the other's.
 */
const GAUSS_FLOOR = 1e-7;

/** 2π, for Box-Muller's angle. */
const TWO_PI = 2 * Math.PI;

/**
 * A standard normal, as a field, from two independent uniforms.
 *
 * BOX-MULLER, COS BRANCH ONLY, which is what `stations.ts` uses and is
 * what makes the two comparable in distribution even though they cannot
 * be compared draw for draw. The sin branch is thrown away rather than
 * cached: a field has nowhere to keep the second value, and a normal that
 * came from a cache would depend on who asked first.
 *
 * THE TWO KEYS MUST DIFFER, and the caller supplies both so the collision
 * is visible at the call site rather than hidden in here. `randomField`
 * keys separate streams at the same point: distinct keys give
 * independent values (measured at r = 7.6e-4 over 200,000 points), and
 * the SAME key twice gives the identical number — which would make this
 * `sqrt(-2 log u) * cos(2π u)`, a bounded, badly-shaped curve rather than
 * a normal, and it would look plausible enough on a histogram to ship.
 *
 * @param keyA - stream for the radius. Must differ from `keyB`.
 * @param keyB - stream for the angle. Must differ from `keyA`.
 */
export function gaussianField(keyA: string, keyB: string): Field {
  if (keyA === keyB) {
    throw new Error(
      `stationGraph.gaussianField: both uniforms were given the key "${keyA}", so they would draw the SAME number at every point and the result would not be a normal. Give the radius and the angle different keys (for example "${keyA}.r" and "${keyA}.theta").`,
    );
  }
  return mul(
    sqrt(mul(-2, log(max(randomField(keyA), GAUSS_FLOOR)))),
    cos(mul(TWO_PI, randomField(keyB))),
  );
}

/**
 * `Math.round` as a field expression.
 *
 * The grammar has `floor` and no `round`, and the difference matters at a
 * half: `floor(x + 0.5)` rounds a half toward +Infinity, which is what
 * `Math.round` does and therefore what every count in `stations.ts` does.
 * Spelling it once here keeps the three budget expressions from each
 * inventing their own rounding.
 */
export function roundField(value: Field | number): Field {
  return floor(add(value, 0.5));
}

/**
 * A count field reading the path's own length, in the units the rules use.
 *
 * THE PATH MEASURES ITSELF IN WORLD UNITS AND THE RULES SPEAK IN W, so
 * every population in this demo is `rate * lengthW` where
 * `lengthW = length / halfWidth`. Folding the division into the rate
 * keeps one multiply in the expression rather than a divide the reader
 * has to re-derive, and it keeps `halfWidth` where it belongs — a
 * construction constant, applied once.
 *
 * `lengthAttr` names the PRIMITIVE-domain column carrying that length.
 * The racetrack's road graph already writes it as "lapLen"
 * (`graph.ts`'s `pathResample`), which is why this port needs no new node
 * upstream to measure a curve that has already been measured.
 *
 * @param ratePerW - placements per half-width of lap.
 */
export function countPerW(
  ratePerW: number,
  halfWidth: number,
  lengthAttr: string,
): Field {
  return roundField(mul(ratePerW / halfWidth, attribute(lengthAttr)));
}

/**
 * How many child slots each super gets before the cut.
 *
 * `k = floor(clustersPerSuper + u)` with `u` in [0,1) takes exactly two
 * values, `floor(c)` and `floor(c) + 1`, so that second one is the most
 * any super can ask for and a template of that size can never truncate a
 * draw. Over-generating is what the library's shape forces here — no
 * `count` param is field-capable on a node that fans out per point, so
 * the number of children cannot be computed and then allocated — but the
 * over-generation is one slot per super, not a safety factor.
 */
function clusterSlots(clustersPerSuper: number): number {
  return Math.floor(clustersPerSuper) + 1;
}

/** What {@link addStationStage} appends, and what it hands back. */
export interface StationStage {
  /** The node whose "out" carries the finished station cloud. */
  readonly out: NodeHandle;
  /** The point attribute each station's arc position lives in, in W. */
  readonly stationAttr: string;
  /** How many child slots each super was given before the cut. */
  readonly slotsPerSuper: number;
}

/** Knobs {@link addStationStage} takes. */
export interface StationStageOptions {
  /** Half the road width in world units — the scale W is measured in. */
  readonly halfWidth: number;
  /** The fitted process constants. Defaults to {@link FITTED}. */
  readonly params?: StationParams;
  /** Multiplies `density` only, the way `dressLap`'s knob does. */
  readonly densityScale?: number;
  /**
   * The PRIMITIVE-domain column carrying the path's own length, in world
   * units. The racetrack's road graph writes it as "lapLen".
   */
  readonly lengthAttr?: string;
  /** Where the finished arc position is written, in W. */
  readonly stationAttr?: string;
  /** Prefix for every node id this adds, so two stages can coexist. */
  readonly prefix?: string;
}

/**
 * Append the station process to a graph, reading a path and producing a
 * cloud of stations.
 *
 * THE FOUR POPULATIONS, in the order `stations.ts` writes them and for
 * the same reasons:
 *
 * 1. SUPERS, uniform on the lap, `round(superRate * lapW)` of them. This
 *    is the one step the library could not express at all until
 *    `pointScatterOnPath`: the count is a property of the curve, and no
 *    source node can read one.
 * 2. CLUSTERS, gaussian about their super. A per-parent VARIABLE child
 *    count has no direct spelling, so each super is given
 *    `floor(clustersPerSuper) + 1` slots and the surplus is cut by a
 *    predicate. The per-super draw that decides `k` is computed ON THE
 *    SUPER and carried down by `targetNames`, so every slot of one super
 *    agrees about how many of them survive — computing it per slot would
 *    give each slot its own opinion and the count would be binomial
 *    rather than the two-valued stochastic rounding it is meant to be.
 * 3. INSTANCES, gaussian about a cluster drawn UNIFORMLY WITH
 *    REPLACEMENT. The draw is `floor(u * clusterCount)` gathered with
 *    `transferByIndex`; with replacement is what makes the cluster SIZES
 *    vary, and `stations.ts` argues that the size distribution is most
 *    of what the dispersion curve is made of.
 * 4. BACKGROUND, uniform on the lap, `round(total * background)` of them.
 *
 * THE BUDGET IS EXACT, NOT POISSON, deliberately: `stations.ts` says
 * letting the total float "adds variance at the lap scale, which is the
 * one place the source has none". So `total` is `round(density * lapW)`
 * and the clustered population is `total - round(total * background)` —
 * arithmetic on the path's own length, resolved on its primitive domain.
 *
 * THE INSTANCE CLOUD IS SCATTERED AND THEN OVERWRITTEN, which looks
 * wasteful and is not. It needs `wantClustered` points that each have a
 * DISTINCT identity, because `randomField` keys on a point's stored
 * position and seed — a cloud of coincident points draws one number and
 * hands it to all of them. Scattering on the path is the cheapest way to
 * get that many distinct, well-spread identities; the arc positions it
 * draws are then replaced by the cluster gather, and only the identities
 * are kept.
 */
export function addStationStage(
  g: Graph,
  path: { readonly node: NodeHandle; readonly pin: string },
  opts: StationStageOptions,
): StationStage {
  const p = opts.params ?? FITTED;
  const halfWidth = opts.halfWidth;
  const lengthAttr = opts.lengthAttr ?? "lapLen";
  const stationAttr = opts.stationAttr ?? "stationW";
  const pre = opts.prefix ?? "st";
  const density = p.density * (opts.densityScale ?? 1);
  const slots = clusterSlots(p.clustersPerSuper);

  if (!(halfWidth > 0) || !Number.isFinite(halfWidth)) {
    throw new Error(
      `addStationStage: halfWidth must be a finite number > 0, got ${halfWidth}. It is the world-unit scale a station's W is measured in, and every population here is a rate per W.`,
    );
  }

  // Populations, all as expressions over the path's own length. `lapW` is
  // `length / halfWidth`, so a rate per W becomes a rate per world unit
  // by dividing once, here, rather than in four places below.
  const lapLen = attribute(lengthAttr);
  const totalCount = roundField(mul(density / halfWidth, lapLen));
  const backgroundCount = roundField(mul(p.background, totalCount));
  const clusteredCount = sub(totalCount, backgroundCount);

  // ---- 1. supers -------------------------------------------------------
  const supers = g.add(
    pointScatterOnPath,
    {
      count: roundField(mul(p.superRate / halfWidth, lapLen)),
      arcAttr: "arcW",
      seed: 0x5001,
    },
    `${pre}Supers`,
  );
  g.connect(path.node, path.pin, supers, "path");

  // The per-super draw that decides how many clusters it gets. Computed
  // HERE, on the super, so it is one number per super rather than one per
  // slot -- see the header for why that distinction is the whole rule.
  const superK = g.add(
    setAttribute,
    { name: "kU", tupleSize: 1, value: randomField("cluster.k") },
    `${pre}SuperK`,
  );
  g.connect(supers, "out", superK, "in");

  const superStation = g.add(
    setAttribute,
    { name: stationAttr, tupleSize: 1, value: mul(1 / halfWidth, attribute("arcW")) },
    `${pre}SuperStation`,
  );
  g.connect(superK, "out", superStation, "in");

  // ---- 2. clusters -----------------------------------------------------
  // The template exists only to give each super `slots` children, and its
  // points are SPREAD rather than coincident on purpose: copyToPoints
  // offsets each copy by its template point, and `randomField` keys on a
  // point's position and seed, so a one-point template repeated would
  // hand every child of a super the same "random" offset.
  const slotTemplate = g.add(
    pointLine,
    {
      mode: "endpoints",
      count: slots,
      start: [0, 0, 0],
      end: [slots - 1, 0, 0],
      includeEnd: true,
    },
    `${pre}Slots`,
  );

  const slotted = g.add(
    copyToPoints,
    { targetNames: [stationAttr, "kU"], targetIndexAttr: "superIdx" },
    `${pre}Slotted`,
  );
  g.connect(slotTemplate, "out", slotted, "source");
  g.connect(superStation, "out", slotted, "target");

  // Copy `s` of target `t` lands at output index `t * slots + s`, so a
  // copy's rank WITHIN its super is `index() mod slots` -- no second
  // column needed to carry it.
  const kept = g.add(
    filterByExpression,
    {
      predicate: lt(mod(index(), slots), floor(add(p.clustersPerSuper, attribute("kU")))),
    },
    `${pre}ClusterCut`,
  );
  g.connect(slotted, "out", kept, "in");

  const clusterStation = g.add(
    setAttribute,
    {
      name: stationAttr,
      tupleSize: 1,
      value: add(
        attribute(stationAttr),
        mul(p.superSpreadW, gaussianField("cluster.r", "cluster.theta")),
      ),
    },
    `${pre}ClusterStation`,
  );
  g.connect(kept, "out", clusterStation, "in");

  // How many clusters there are, made readable as a field on a DIFFERENT
  // cloud: reduce to the detail domain, promote it onto every cluster
  // point, then gather point 0's copy. A detail attribute is invisible
  // both to a point field and to transferByIndex, so the promote is not
  // decoration.
  const clusterCount = g.add(
    attributeReduce,
    { name: "", mode: "count", domain: "point", outName: "clusterCount" },
    `${pre}ClusterCount`,
  );
  g.connect(clusterStation, "out", clusterCount, "in");

  const clusterCountOnPoints = g.add(
    promoteAttribute,
    { name: "clusterCount", from: "detail", to: "point", mode: "first" },
    `${pre}ClusterCountPt`,
  );
  g.connect(clusterCount, "out", clusterCountOnPoints, "in");

  // ---- 3. instances ----------------------------------------------------
  const instanceSeeds = g.add(
    pointScatterOnPath,
    { count: clusteredCount, arcAttr: "arcW", seed: 0x5002 },
    `${pre}InstanceSeeds`,
  );
  g.connect(path.node, path.pin, instanceSeeds, "path");

  // Every instance learns how many clusters there are, by reading cluster
  // point 0 -- the column is constant across the cloud, so which point it
  // reads is arbitrary and index 0 is the one that always exists.
  const withCount = g.add(
    transferByIndex,
    { index: 0, attributes: ["clusterCount"], outOfRange: "clamp" },
    `${pre}InstanceCount`,
  );
  g.connect(instanceSeeds, "out", withCount, "in");
  g.connect(clusterCountOnPoints, "out", withCount, "source");

  const pick = g.add(
    setAttribute,
    {
      name: "pick",
      tupleSize: 1,
      value: floor(mul(randomField("instance.pick"), attribute("clusterCount"))),
    },
    `${pre}InstancePick`,
  );
  g.connect(withCount, "out", pick, "in");

  // WITH REPLACEMENT, which is the whole character of the process: two
  // instances may draw the same cluster, and that is what makes cluster
  // SIZES vary instead of every cluster getting an equal share.
  const gathered = g.add(
    transferByIndex,
    { index: attribute("pick"), attributes: [stationAttr], outOfRange: "clamp" },
    `${pre}InstanceGather`,
  );
  g.connect(pick, "out", gathered, "in");
  g.connect(clusterCountOnPoints, "out", gathered, "source");

  const instanceStation = g.add(
    setAttribute,
    {
      name: stationAttr,
      tupleSize: 1,
      value: add(
        attribute(stationAttr),
        mul(p.clusterSpreadW, gaussianField("instance.r", "instance.theta")),
      ),
    },
    `${pre}InstanceStation`,
  );
  g.connect(gathered, "out", instanceStation, "in");

  // Strip everything the instance half accumulated, so the merge below
  // joins two clouds carrying the SAME columns. mergePoints default-fills
  // a one-sided attribute silently, with the source column's own default
  // rather than zero, and a silent default is exactly the kind of thing
  // that reads as data three stages later.
  const instancesClean = g.add(
    removeAttribute,
    { names: ["arcW", "clusterCount", "pick", "superIdx", "kU"], domain: "point", strict: false },
    `${pre}InstanceClean`,
  );
  g.connect(instanceStation, "out", instancesClean, "in");

  // ---- 4. background ---------------------------------------------------
  const background = g.add(
    pointScatterOnPath,
    { count: backgroundCount, arcAttr: "arcW", seed: 0x5003 },
    `${pre}Background`,
  );
  g.connect(path.node, path.pin, background, "path");

  const backgroundStation = g.add(
    setAttribute,
    { name: stationAttr, tupleSize: 1, value: mul(1 / halfWidth, attribute("arcW")) },
    `${pre}BackgroundStation`,
  );
  g.connect(background, "out", backgroundStation, "in");

  const backgroundClean = g.add(
    removeAttribute,
    { names: ["arcW"], domain: "point", strict: false },
    `${pre}BackgroundClean`,
  );
  g.connect(backgroundStation, "out", backgroundClean, "in");

  // ---- 5. merge and wrap ----------------------------------------------
  const merged = g.add(mergePoints, {}, `${pre}Merge`);
  g.connect(instancesClean, "out", merged, "in");
  g.connect(backgroundClean, "out", merged, "in");

  // WRAPPED THE EUCLIDEAN WAY, spelled out rather than trusted to `mod`:
  // a cluster gaussian easily pushes a station past either end, and a
  // remainder that keeps the sign of the dividend would leave a negative
  // station that every downstream rule reads as a position before the
  // start line. `((x % L) + L) % L` is what `stations.ts` writes.
  const lapW = mul(1 / halfWidth, attribute(lengthAttr));
  const wrapped = g.add(
    setAttribute,
    {
      name: stationAttr,
      tupleSize: 1,
      value: mod(add(mod(attribute(stationAttr), lapW), lapW), lapW),
    },
    `${pre}Wrap`,
  );
  g.connect(merged, "out", wrapped, "in");

  return { out: wrapped, stationAttr, slotsPerSuper: slots };
}

/**
 * A sentinel that loses every `min` against a real candidate.
 *
 * NOT INFINITY, deliberately. A field param is guarded against non-finite
 * values, so an Infinity here would be refused at the resolve rather than
 * losing a comparison. It only has to beat an index (bounded by the point
 * count) and a gap (bounded by the lap), and 1e9 is past both by orders
 * of magnitude on any track anyone will build.
 */
const LOSES = 1e9;

/**
 * Rounds the coverage repair may take before it gives up and says so.
 *
 * `stations.ts` bounds its own loop at `ceil(lapW / maxGapW) + 2` — one
 * pass can close at most one gap, and a lap cannot hold more than
 * `lapW / 25` gaps that wide. That is 14 to 20 rounds over this demo's
 * 286-443 W range. This is a graph-construction constant and cannot read
 * the lap, so it is the top of that range with headroom rather than the
 * exact bound, and being generous costs nothing: the loop stops the round
 * it stops moving, not when it runs out.
 */
const REPAIR_MAX_ROUNDS = 32;

/** The detail scalar `repeatUntil` reads: zero means settled. */
const REPAIR_SETTLE_ATTR = "d4Moves";

/** Euclidean remainder, spelled so it holds whichever way `mod` rounds. */
function wrapTo(value: Field | number, modulus: Field | number): Field {
  return mod(add(mod(value, modulus), modulus), modulus);
}

/**
 * Reduce a point column to one number and hand it back to every point.
 *
 * `attributeReduce` writes to the DETAIL domain, where a point field
 * cannot see it, so the promote is not decoration — without it the next
 * expression fails with "attribute not found". Every use here is the same
 * shape: take a lap-wide extremum, then let each point compare itself
 * against it.
 */
function broadcast(
  g: Graph,
  from: NodeHandle,
  column: string,
  mode: "min" | "max" | "sum",
  outName: string,
  tag: string,
): NodeHandle {
  const reduced = g.add(
    attributeReduce,
    { name: column, domain: "point", mode, outName },
    `${tag}Reduce`,
  );
  g.connect(from, "out", reduced, "in");
  const promoted = g.add(
    promoteAttribute,
    { name: outName, from: "detail", to: "point", mode: "first" },
    `${tag}Bcast`,
  );
  g.connect(reduced, "out", promoted, "in");
  return promoted;
}

/** Write one scalar column and return the node, to keep the chain flat. */
function put(
  g: Graph,
  from: NodeHandle,
  name: string,
  value: Field | number,
  id: string,
): NodeHandle {
  const n = g.add(setAttribute, { name, tupleSize: 1, value }, id);
  g.connect(from, "out", n, "in");
  return n;
}

/**
 * ONE ROUND of D-4: close the widest gap by moving the most redundant
 * placement into it.
 *
 * THE RULE, TRANSCRIBED FROM `repairPlacementCoverage` RATHER THAN
 * REINVENTED. Sort the stations round the lap and take the gap ring —
 * every gap between neighbours, the wrap included, because a lap has no
 * end for a gap to fall off. While the widest gap exceeds
 * `COVERAGE.maxGapW`, find the DONOR: the placement whose nearest
 * neighbour is closest, anywhere on the lap, excluding the two placements
 * that bound the gap being filled. Move it to the gap's midpoint. Never
 * add, never drop — the count is D-1's and this rule does not get to
 * spend it.
 *
 * WHY THE DONOR IS LAP-GLOBAL AND WHY THAT IS FINE HERE. It reads the
 * whole ring to find one point, so it is exactly the kind of rule a cell
 * cannot run. It lives on the unbounded level, which has one cell, and
 * `dressGraph`'s own note says the same thing about why D-4 was left out
 * of the per-cell repair loop.
 *
 * THE RING IS ARITHMETIC, NOT GEOMETRY, and that distinction is load-
 * bearing. `pointsToPath` orders the stations and `pathShift` reads each
 * one's successor, so a gap is a subtraction of two arc positions. The
 * tempting alternative — build the ordered polyline and let
 * `pathSegments` measure it — returns CHORDS, which on a 350 W lap run
 * about 0.8% short of the arc at a 25 W threshold. A rule stated as an
 * exact bound cannot be tested with a measurement that is quietly 0.8%
 * optimistic.
 *
 * TIES BREAK TO THE LOWEST POINT INDEX, everywhere, and are resolved by a
 * second reduction rather than by hoping floats differ: the first pass
 * finds the extreme VALUE, the second finds the smallest index holding
 * it. Two gaps of identical width, or two placements equally redundant,
 * are ordinary on a lap built from f32 columns, and a rule that picked
 * "whichever the reduction happened to see first" would not be
 * reproducible across cook orders.
 */
function buildCoverageBody(opts: {
  readonly stationAttr: string;
  readonly lengthAttr: string;
  readonly halfWidth: number;
  readonly maxGapW: number;
}): { graph: Graph; inputs: ExposedPin[]; outputs: ExposedPin[] } {
  const { stationAttr, lengthAttr, halfWidth, maxGapW } = opts;
  const g = new Graph(1);

  const lapW = mul(1 / halfWidth, attribute(lengthAttr));
  const station = attribute(stationAttr);

  // The ring. `closed: true` is what makes the wrap gap a gap like any
  // other rather than a special case bolted on afterwards.
  // `shortGroups: "skip"` IS THE DEGENERATE-LAP EXIT. A closed ring needs
  // three points; with fewer, `pointsToPath` would refuse and fail the
  // whole cook. Skipping leaves those points in the cloud with no path
  // over them, every shift below MISSES, nothing becomes eligible, and
  // the round settles having moved nothing -- which is exactly what
  // `repairPlacementCoverage` does at `out.length < 3`: report an
  // un-closable gap rather than spin on it or throw.
  const ring = g.add(
    pointsToPath,
    { closed: true, orderAttr: stationAttr, shortGroups: "skip" },
    "ring",
  );
  // No dataInput here: `repeatUntil` feeds the carry straight into the
  // body's HEAD pin, the way `buildRepairBody` wires its own.

  // Each station learns its successor's arc position, then its own gap.
  const withNext = g.add(
    pathShift,
    {
      attributes: [stationAttr],
      outNames: ["__next"],
      offset: 1,
      outOfRange: "wrap",
      hitAttr: "__hasNext",
    },
    "shiftNext",
  );
  g.connect(ring, "out", withNext, "in");

  // WRAPPED, because the last station's successor is the first and the
  // raw difference is then negative by a lap.
  const gaps = put(
    g,
    withNext,
    "__gap",
    select(attribute("__hasNext"), wrapTo(sub(attribute("__next"), station), lapW), 0),
    "gap",
  );

  // ...and its predecessor's gap, which is what makes "nearest neighbour"
  // a two-sided question.
  const withPrev = g.add(
    pathShift,
    { attributes: ["__gap"], outNames: ["__prevGap"], offset: -1, outOfRange: "wrap" },
    "shiftPrev",
  );
  g.connect(gaps, "out", withPrev, "in");

  const nearest = put(
    g,
    withPrev,
    "__near",
    min(attribute("__gap"), attribute("__prevGap")),
    "near",
  );

  // ---- the gap to fill -------------------------------------------------
  const worstGap = broadcast(g, nearest, "__gap", "max", "__worstGap", "worst");
  // Is there anything to do at all? Every point agrees, since the widest
  // gap is a lap-wide number.
  const needs = put(g, worstGap, "__needs", gt(attribute("__worstGap"), maxGapW), "needs");

  const worstKey = put(
    g,
    needs,
    "__worstKey",
    select(eq(attribute("__gap"), attribute("__worstGap")), index(), LOSES),
    "worstKey",
  );
  const worstIdx = broadcast(g, worstKey, "__worstKey", "min", "__worstIdx", "worstIdx");
  const isWorst = put(g, worstIdx, "__isWorst", eq(index(), attribute("__worstIdx")), "isWorst");

  // The midpoint of that gap, broadcast off the one point that owns it.
  // `max` picks it out because every other point contributes -1, and a
  // station is never negative.
  const midKey = put(
    g,
    isWorst,
    "__midKey",
    select(
      attribute("__isWorst"),
      wrapTo(add(attribute(stationAttr), mul(0.5, attribute("__gap"))), lapW),
      -1,
    ),
    "midKey",
  );
  const mid = broadcast(g, midKey, "__midKey", "max", "__mid", "mid");

  // ---- the donor -------------------------------------------------------
  // The gap is bounded by the worst point and the one AFTER it, and
  // neither may be the donor: moving either would not close the gap, it
  // would move one of its walls. "The point after the worst" is the worst
  // flag read backwards by one.
  const afterWorst = g.add(
    pathShift,
    { attributes: ["__isWorst"], outNames: ["__isAfterWorst"], offset: -1, outOfRange: "wrap" },
    "shiftWorst",
  );
  g.connect(mid, "out", afterWorst, "in");

  const eligible = put(
    g,
    afterWorst,
    "__ok",
    mul(
      mul(attribute("__needs"), attribute("__hasNext")),
      sub(1, max(attribute("__isWorst"), attribute("__isAfterWorst"))),
    ),
    "ok",
  );

  const donorKey = put(
    g,
    eligible,
    "__donorKey",
    select(attribute("__ok"), attribute("__near"), LOSES),
    "donorKey",
  );
  const bestNear = broadcast(g, donorKey, "__donorKey", "min", "__bestNear", "bestNear");

  const donorIdxKey = put(
    g,
    bestNear,
    "__donorIdxKey",
    select(
      mul(attribute("__ok"), eq(attribute("__near"), attribute("__bestNear"))),
      index(),
      LOSES,
    ),
    "donorIdxKey",
  );
  const donorIdx = broadcast(g, donorIdxKey, "__donorIdxKey", "min", "__donorIdx", "donorIdx");

  // NOTHING ELIGIBLE LEAVES `__donorIdx` AT THE SENTINEL, which no real
  // index equals, so the move below is a no-op and the round reports zero
  // moves and settles. That is the graph's spelling of
  // `repairPlacementCoverage`'s "donor < 0" exit: an un-closable gap is
  // REPORTED by the loop's `converged` output, never thrown.
  const isDonor = put(g, donorIdx, "__isDonor", eq(index(), attribute("__donorIdx")), "isDonor");

  const moved = put(
    g,
    isDonor,
    stationAttr,
    select(attribute("__isDonor"), attribute("__mid"), attribute(stationAttr)),
    "apply",
  );

  // Drop this round's scratch columns AND the ring's topology. The carry
  // re-enters the body next round, where `pointsToPath` builds the order
  // again from the stations as they now are -- a repair that moved a
  // placement changed the order, so the ring has to be rebuilt rather
  // than reused. `filterByExpression` with a constant-true predicate is
  // the library's way to say "keep every point, keep no topology".
  const cleaned = g.add(
    removeAttribute,
    {
      names: [
        "__next",
        "__hasNext",
        "__gap",
        "__prevGap",
        "__near",
        "__worstGap",
        "__needs",
        "__worstKey",
        "__worstIdx",
        "__isWorst",
        "__midKey",
        "__mid",
        "__isAfterWorst",
        "__ok",
        "__donorKey",
        "__bestNear",
        "__donorIdxKey",
        "__donorIdx",
      ],
      domain: "point",
      strict: false,
    },
    "clean",
  );
  g.connect(moved, "out", cleaned, "in");

  const untangled = g.add(filterByExpression, { predicate: 1, topology: "drop" }, "untangle");
  g.connect(cleaned, "out", untangled, "in");

  // THE SETTLE SIGNAL IS WRITTEN LAST, AND THE ORDER IS THE POINT. It
  // lands on the DETAIL domain, and every node after it is free to hand
  // back a geometry without that domain's columns -- at which point
  // `repeatUntil` refuses, because an absent signal is deliberately not
  // read as "settled". Reducing after the cleanup means the body's output
  // node is the one that wrote it.
  //
  // `__isDonor` is therefore the one scratch column the cleanup above
  // leaves alone: this reads it. It is overwritten every round, so the
  // carry gains one column rather than accumulating any, and it says
  // which placement the last round moved -- which is worth keeping.
  const settle = g.add(
    attributeReduce,
    { name: "__isDonor", domain: "point", mode: "sum", outName: REPAIR_SETTLE_ATTR },
    "settle",
  );
  g.connect(untangled, "out", settle, "in");

  return {
    graph: g,
    // The name `repeatUntil` reserves for the pin it feeds back.
    inputs: [{ name: "carry", node: ring, pin: "in" }],
    outputs: [{ name: "carry", node: settle, pin: "out" }],
  };
}

/** What {@link addCoverageRepair} appends. */
export interface CoverageRepair {
  /** The node whose "carry" pin carries the repaired station cloud. */
  readonly out: NodeHandle;
  /** Its "rounds" pin: how many rounds the loop actually cooked. */
  readonly roundsPin: string;
  /** Its "converged" pin: 1 when it settled, 0 when it ran out of rounds. */
  readonly convergedPin: string;
}

/**
 * Append D-4's coverage repair to a graph, after the station process.
 *
 * The loop is bounded and REPORTS rather than throws when it cannot
 * close a gap — two placements 50 W apart on a lap have no repair, and
 * `stations.ts` answers that by recomputing the worst gap and handing it
 * back rather than spinning on it. Read `converged` to tell the two
 * apart.
 */
export function addCoverageRepair(
  g: Graph,
  upstream: { readonly node: NodeHandle; readonly pin: string },
  opts: {
    readonly stationAttr?: string;
    readonly lengthAttr?: string;
    readonly halfWidth: number;
    readonly maxGapW?: number;
    readonly prefix?: string;
  },
): CoverageRepair {
  const body = buildCoverageBody({
    stationAttr: opts.stationAttr ?? "stationW",
    lengthAttr: opts.lengthAttr ?? "lapLen",
    halfWidth: opts.halfWidth,
    maxGapW: opts.maxGapW ?? COVERAGE.maxGapW,
  });
  const repair = g.add(
    repeatUntilNode(body.graph, body.inputs, body.outputs),
    { maxRounds: REPAIR_MAX_ROUNDS, settleAttr: REPAIR_SETTLE_ATTR },
    `${opts.prefix ?? "d4"}Repair`,
  );
  g.connect(upstream.node, upstream.pin, repair, "carry");
  return { out: repair, roundsPin: "rounds", convergedPin: "converged" };
}

/**
 * The lap's own frames as a path the station graph can scatter on.
 *
 * A `Lap` is columns, not geometry, and `pointScatterOnPath` needs a real
 * polyline. This is that polyline and nothing more: the SAME positions
 * the lap already holds, closed, with the length written where the count
 * fields read it. No resample, because resampling would measure a
 * slightly different curve than the one every other rule in this demo is
 * stated against.
 *
 * THE CHORD TABLES AGREE BY CONSTRUCTION. `lap.s` is the running sum of
 * straight-line distances between consecutive frames, closing segment
 * included, and `polylineArcTables` measures exactly that. So an arc
 * position the scatter draws means the same thing as a station the rules
 * speak in, without a conversion to get wrong.
 */
export function lapAsPath(lap: Lap): Geometry {
  const geo = createPolyline(lap.p, { closed: true });
  // f32, because that is what an attribute column is. A lap runs to a few
  // thousand world units, where f32 spacing is under a thousandth, so the
  // budget this feeds -- round(density * length / halfWidth) -- lands on
  // the same integer as the f64 arithmetic except within half a unit of a
  // rounding boundary. That is one placement, on a lap of hundreds, and
  // it is a difference the port already accepts by existing at all.
  geo.attrs.primitive.add(STATION_LENGTH_ATTR, "f32", 1).set(0, lap.length);

  // THE CORNER MODEL COMES ALONG WHEN THE LAP HAS ONE, and this is
  // plumbing rather than arithmetic: `writeCornerModel` computed this
  // column as graph nodes on the frames, `readLap` read it off the cooked
  // geometry, and all that happens here is that it is put back on a
  // geometry so a graph can read it again. Nothing recomputes it, which
  // is the difference between carrying a cooked column forward and a
  // prelude deciding something.
  //
  // OPTIONAL BECAUSE A LAP NEED NOT HAVE BEEN COOKED -- the station
  // suites build synthetic laps that carry no corners, and the station
  // process does not read this. What does read it is the asset choice,
  // which refuses a lap without one rather than pretending the whole
  // circuit is straight.
  const corners = lap.corner;
  if (corners) {
    const col = geo.attrs.point.add(CORNER_MODEL.radius, "f32", 1);
    for (let i = 0; i < lap.count; i++) col.set(i, corners.radiusW[i]);
  }
  return geo;
}

/** The primitive column {@link cookStations} writes the lap's length into. */
export const STATION_LENGTH_ATTR = "lapLen";

/**
 * Run the station process and D-4's repair as a graph, and hand back what
 * `makeStationsDetailed` hands back.
 *
 * THE POINT OF THE SHAPE. It returns a {@link StationStats} so it is a
 * drop-in for the TypeScript process at `dressLap`'s call site — the
 * campaign's goal is a lap level that needs no prelude, and the way there
 * is one seam at a time rather than one commit that moves everything.
 *
 * IT IS ASYNC AND `makeStationsDetailed` IS NOT, which is the whole
 * reason `dressLap` takes stations as an OPTION rather than calling this
 * itself. Cooking is async; `dressLap` is sync and is called from a
 * dozen synchronous tests. Making it async to reach a cook would ripple
 * through all of them for no benefit, whereas passing the list in leaves
 * the source pluggable — which is what this campaign is trying to end up
 * with anyway.
 */
export async function cookStations(opts: {
  readonly lap: Lap;
  readonly seed: number;
  readonly params?: StationParams;
  readonly densityScale?: number;
}): Promise<StationStats> {
  const { lap, seed } = opts;
  const g = new Graph(seed);
  const pathIn = g.add(dataInput, {}, "lapPath");
  g.setParam(pathIn, "items", [makeGeometryItem(lapAsPath(lap))]);

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

  // BOTH SIDES OF THE REPAIR ARE PUBLISHED, because the stat line reports
  // what the repair FOUND as well as what it did, and the widest gap
  // before it ran is not recoverable from the lap after.
  g.output(stage.out, "out", "raw");
  g.output(repair.out, "carry", "fixed");
  g.output(repair.out, repair.roundsPin, "rounds");
  g.output(repair.out, repair.convergedPin, "converged");

  const cooked = await cook(g);
  const read = (name: string): number[] => {
    const geo = (cooked.outputs[name][0] as { geo: Geometry }).geo;
    const col = geo.attrs.point.require(stage.stationAttr);
    const out: number[] = [];
    for (let i = 0; i < geo.attrs.point.count; i++) out.push(col.get(i) as number);
    return out.sort((a, b) => a - b);
  };
  const raw = read("raw");
  const fixed = read("fixed");
  const rounds = (cooked.outputs.rounds[0] as { value: number }).value;

  // ONE MOVE PER ROUND, and the last round is the one that found nothing
  // left to move -- so the count of moves is one fewer than the count of
  // rounds. When the loop ran out of rounds instead of settling, every
  // round moved something and there is no final idle pass to discount.
  const converged = (cooked.outputs.converged[0] as { value: number }).value;
  return {
    stations: fixed,
    gapRepairs: converged === 1 ? Math.max(0, rounds - 1) : rounds,
    worstGapBeforeW: longestGapOf(raw, lap.lengthW),
    // The per-move log `stations.ts` keeps is not reconstructible from a
    // cooked cloud -- the graph moves a placement without recording which
    // one it was before -- and nothing reads it off this path. An empty
    // log is honest; a fabricated one would not be.
    log: [],
  };
}

/** The widest gap on a sorted, wrapped station ring. */
export function longestGapOf(sorted: readonly number[], lapW: number): number {
  if (sorted.length === 0) return lapW;
  let worst = 0;
  for (let i = 0; i < sorted.length; i++) {
    const gap =
      i === sorted.length - 1 ? sorted[0] + lapW - sorted[i] : sorted[i + 1] - sorted[i];
    if (gap > worst) worst = gap;
  }
  return worst;
}
