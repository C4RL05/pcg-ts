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
  type Field,
  type Graph,
  type NodeHandle,
  add,
  attribute,
  attributeReduce,
  copyToPoints,
  cos,
  filterByExpression,
  floor,
  index,
  log,
  lt,
  max,
  mergePoints,
  mod,
  mul,
  pointLine,
  pointScatterOnPath,
  promoteAttribute,
  randomField,
  removeAttribute,
  setAttribute,
  sqrt,
  sub,
  transferByIndex,
} from "pcg-ts";
import { FITTED, type StationParams } from "./stations.js";

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
