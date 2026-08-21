/**
 * The vocabulary a track-dressing graph places, and the presets that
 * weight it.
 *
 * This is DATA, deliberately: the graph in `dressing.ts` reads every
 * number here through `byAttribute` field lookups keyed on an archetype
 * name, so changing the kit changes no wiring. That is the property the
 * technique this implements rests on — a "theme" is a weighting over one
 * vocabulary, never a different vocabulary, and a "preset" is a weighting
 * over one set of placement rules, never a different set of rules.
 *
 * Every length is in W, the track half-width, which is the unit that lets
 * one rule dress a narrow circuit and a wide one without rescaling.
 * Distances ALONG the lap use the lap's median W; lateral offsets use the
 * local one. Here they are the same because the generated centreline has
 * a constant half-width.
 */

/** How an archetype's rate responds to how tight the track is under it. */
export type AffinityProfile = "flat" | "built" | "clustered";

/** One kind of thing that gets placed, and where it is allowed to sit. */
export interface Archetype {
  readonly id: string;
  /** Which lateral/height band this belongs to: Z2..Z8 of the zone model. */
  readonly zone: string;
  readonly profile: AffinityProfile;
  /** Camera-facing quad or real geometry. A preset may convert them. */
  readonly kind: "sprite" | "mesh";
  /** Signed lateral offset from the centreline, in W, as [min, max] of |t|. */
  readonly lateralW: readonly [number, number];
  /** Height above the local track surface, in W. */
  readonly heightW: readonly [number, number];
  readonly footprintW: readonly [number, number];
  readonly tallnessW: readonly [number, number];
  readonly polygons: number;
  /** Placements per 100W of lap, before preset weighting. */
  readonly rate: number;
  /** Mean geometric cluster size. 1 means it always stands alone. */
  readonly cluster: number;
  /** Share placed on the outside of a bend. 0.5 is indifferent. */
  readonly outsideBias: number;
}

/**
 * The kit. Nineteen archetypes across six lateral bands.
 *
 * The `profile` column is the one that has to be a small closed set
 * rather than a per-archetype curve: the graph builds ONE cumulative
 * distribution per profile and every archetype sharing a profile is drawn
 * from the same one, so three profiles cost three scans and nineteen
 * would cost nineteen. The loss is real and bounded — an archetype gets
 * its profile's response to curvature rather than its own — and it is the
 * trade that keeps the placement pass a fixed-size graph instead of one
 * that grows a branch per archetype.
 */
export const ARCHETYPES: readonly Archetype[] = [
  { id: "terrain-shell", zone: "Z4", profile: "flat", kind: "mesh", lateralW: [2.3, 3.8], heightW: [0.6, 2.3], footprintW: [8, 9.5], tallnessW: [4, 6], polygons: 38, rate: 12, cluster: 1.8, outsideBias: 0.68 },
  { id: "ground-detail", zone: "Z3", profile: "flat", kind: "mesh", lateralW: [1.5, 2.5], heightW: [0.1, 0.4], footprintW: [4, 7], tallnessW: [0.4, 0.8], polygons: 18, rate: 10, cluster: 1.7, outsideBias: 0.62 },
  { id: "bush", zone: "Z5", profile: "clustered", kind: "sprite", lateralW: [2.6, 4.6], heightW: [1.2, 1.8], footprintW: [1.0, 1.3], tallnessW: [1.4, 1.9], polygons: 1, rate: 9, cluster: 2.8, outsideBias: 0.75 },
  { id: "tree-group", zone: "Z5", profile: "clustered", kind: "sprite", lateralW: [5.0, 8.0], heightW: [1.6, 2.2], footprintW: [1.0, 1.4], tallnessW: [2.0, 2.5], polygons: 1, rate: 5, cluster: 3.4, outsideBias: 0.75 },
  { id: "tree", zone: "Z5", profile: "clustered", kind: "mesh", lateralW: [5.0, 7.0], heightW: [2.0, 2.6], footprintW: [1.0, 1.3], tallnessW: [2.1, 2.7], polygons: 30, rate: 5, cluster: 2.4, outsideBias: 0.75 },
  { id: "set-piece", zone: "Z3", profile: "built", kind: "mesh", lateralW: [1.6, 2.4], heightW: [1.0, 1.5], footprintW: [5, 7], tallnessW: [1.8, 2.6], polygons: 38, rate: 7, cluster: 1.4, outsideBias: 0.72 },
  { id: "wall-panel", zone: "Z4", profile: "built", kind: "mesh", lateralW: [2.6, 4.2], heightW: [1.6, 2.4], footprintW: [7, 10], tallnessW: [5, 8], polygons: 28, rate: 5, cluster: 2.0, outsideBias: 0.75 },
  { id: "overhead-sign", zone: "Z7", profile: "flat", kind: "mesh", lateralW: [0.0, 0.5], heightW: [1.6, 2.0], footprintW: [3, 4], tallnessW: [1.4, 2.0], polygons: 28, rate: 5, cluster: 1.1, outsideBias: 0.5 },
  { id: "chevron-board", zone: "Z3", profile: "clustered", kind: "mesh", lateralW: [1.6, 2.4], heightW: [0.4, 0.9], footprintW: [1.5, 2.5], tallnessW: [1.5, 2.5], polygons: 10, rate: 4, cluster: 2.2, outsideBias: 0.8 },
  { id: "tower", zone: "Z4", profile: "built", kind: "mesh", lateralW: [2.6, 3.6], heightW: [2.8, 3.5], footprintW: [1.6, 2.2], tallnessW: [1.0, 1.5], polygons: 30, rate: 3, cluster: 1.3, outsideBias: 0.7 },
  { id: "pipe-run", zone: "Z3", profile: "built", kind: "mesh", lateralW: [1.7, 2.5], heightW: [0.9, 1.3], footprintW: [1.6, 2.2], tallnessW: [0.4, 0.7], polygons: 30, rate: 4, cluster: 2.6, outsideBias: 0.66 },
  { id: "billboard", zone: "Z5", profile: "flat", kind: "mesh", lateralW: [5.2, 7.0], heightW: [2.4, 3.2], footprintW: [5, 7], tallnessW: [6, 7.5], polygons: 24, rate: 2, cluster: 1.2, outsideBias: 0.78 },
  { id: "lamp-arm", zone: "Z7", profile: "built", kind: "mesh", lateralW: [0.6, 0.9], heightW: [1.4, 1.9], footprintW: [2.0, 2.8], tallnessW: [2.6, 3.4], polygons: 26, rate: 3.5, cluster: 1.6, outsideBias: 0.5 },
  { id: "camera-post", zone: "Z2", profile: "clustered", kind: "mesh", lateralW: [1.05, 1.3], heightW: [1.3, 1.7], footprintW: [0.5, 0.9], tallnessW: [0.3, 0.6], polygons: 16, rate: 5.5, cluster: 1.0, outsideBias: 0.42 },
  { id: "dome", zone: "Z5", profile: "built", kind: "mesh", lateralW: [5.6, 7.4], heightW: [4.2, 5.0], footprintW: [5, 6.5], tallnessW: [3.2, 4.2], polygons: 32, rate: 2, cluster: 1.1, outsideBias: 0.7 },
  { id: "skyline", zone: "Z6", profile: "built", kind: "mesh", lateralW: [13, 20], heightW: [1, 4], footprintW: [6, 10], tallnessW: [2.5, 4], polygons: 40, rate: 0.5, cluster: 2.0, outsideBias: 0.6 },
  { id: "banner", zone: "Z7", profile: "flat", kind: "mesh", lateralW: [0, 0.2], heightW: [1.7, 2.1], footprintW: [10, 13], tallnessW: [4, 5.5], polygons: 14, rate: 1.5, cluster: 1.0, outsideBias: 0.5 },
  { id: "enclosure-shell", zone: "Z7", profile: "flat", kind: "mesh", lateralW: [0, 0.6], heightW: [1.4, 2.6], footprintW: [9, 13], tallnessW: [6, 13], polygons: 44, rate: 3, cluster: 3.0, outsideBias: 0.5 },
  { id: "verge-rail", zone: "Z2", profile: "flat", kind: "mesh", lateralW: [1.05, 1.45], heightW: [0.2, 0.6], footprintW: [2.5, 4.5], tallnessW: [0.6, 1.2], polygons: 12, rate: 4, cluster: 2.4, outsideBias: 0.6 },
];

/** Placed by RULE rather than by density: no rate, no cumulative draw. */
export const RULE_ARCHETYPES: readonly Archetype[] = [
  { id: "corner-marker", zone: "Z3", profile: "flat", kind: "mesh", lateralW: [1.6, 2.2], heightW: [1.0, 1.6], footprintW: [1.2, 1.8], tallnessW: [1.8, 2.4], polygons: 18, rate: 0, cluster: 1, outsideBias: 1 },
  { id: "braking-reference", zone: "Z3", profile: "flat", kind: "mesh", lateralW: [1.6, 2.4], heightW: [0.8, 1.2], footprintW: [0.6, 1.0], tallnessW: [1.4, 2.0], polygons: 10, rate: 0, cluster: 1, outsideBias: 1 },
  // One per tenth of the lap, each under a family of its own. A landmark
  // reads as one because it is BIGGER than its neighbours, not because it
  // is odd — hence a Z5 silhouette at 1.5x the footprint and 1.6x the
  // tallness of the mass around it, rather than a shape nothing else has.
  { id: "landmark", zone: "Z5", profile: "flat", kind: "mesh", lateralW: [5.5, 9.0], heightW: [2.0, 4.0], footprintW: [7.5, 12], tallnessW: [5, 8], polygons: 48, rate: 0, cluster: 1, outsideBias: 0.6 },
];

/** How many tenths of the lap the landmark pass covers. */
export const LANDMARK_STRETCHES = 10;

/**
 * How many families the passes OUTSIDE the density draw contribute, which
 * the variety budget has to subtract before it distributes what is left.
 * Three corner-marker severities, one braking reference, and one family
 * per landmark — a landmark that shared a family with another landmark
 * would not be a landmark.
 */
export const AUXILIARY_FAMILIES = 3 + 1 + LANDMARK_STRETCHES;

/** Every archetype the graph can emit, density-placed and rule-placed. */
export const ALL_ARCHETYPES: readonly Archetype[] = [...ARCHETYPES, ...RULE_ARCHETYPES];

/** A rate multiplier per curvature bucket, one row per profile. */
export const AFFINITY: Record<AffinityProfile, readonly [number, number, number, number]> = {
  // straight, easy, medium, tight
  flat: [1, 1, 1, 1],
  built: [1, 0.6, 0.45, 0.45],
  clustered: [0.8, 1, 1.3, 2.0],
};

/** The three profiles, in the order the graph lays them out in lanes. */
export const PROFILES: readonly AffinityProfile[] = ["flat", "built", "clustered"];

/**
 * Corner-radius thresholds in W, separating the four curvature buckets.
 * A straight is R >= 40W; tight is R < 7W.
 */
export const BUCKET_EDGES = { easy: 40, medium: 15, tight: 7 } as const;

/** A corner is smoothed curvature tighter than this radius, in W. */
export const CORNER_RADIUS_W = 12;

/** One era's weighting over the kit, and the targets it is scored on. */
export interface Preset {
  /** Target placements per W of lap. */
  readonly density: number;
  readonly densityAccept: readonly [number, number];
  /** Share of placements that are camera-facing quads. 0 converts them. */
  readonly spriteShare: number;
  readonly spriteAccept: readonly [number, number];
  /** Polygon budget per W of lap; the kit's counts are scaled to hit it. */
  readonly polysPerW: number;
  readonly polysAccept: number;
  /** Distinct art variants per lap, auxiliary families included. */
  readonly familiesAccept: readonly [number, number];
  /** No one family may exceed this share of placements. */
  readonly largestFamilyCap: number;
  /** An archetype expected to place fewer than this is pruned. */
  readonly minInstances: number;
  /** Target share of placements per lateral band, keyed by band name. */
  readonly bands: Readonly<Record<string, number>>;
  /** Mean geometric cluster size across the kit. */
  readonly clusterMean: number;
  /** Share of the lap within 2W of a placement. */
  readonly coverageFloor: number;
  /** Longest tolerable empty stretch, in W. */
  readonly maxGapW: number;
  /** The coverage pass fills any gap longer than this. */
  readonly maxFillGapW: number;
  /** Target share of in-bend placements on the outside. */
  readonly outsideShare: number;
  readonly outsideAccept: readonly [number, number];
  /** Peak roll in degrees, reached asymptotically at referenceRadiusW. */
  readonly bankMaxDeg: number;
  readonly referenceRadiusW: number;
  /** Depth of the periodic density envelope, 0..1. */
  readonly envelope: number;
  /** Per-archetype rate multipliers: the era's taste. */
  readonly kitBias: Readonly<Record<string, number>>;
  /** Per-archetype multipliers on the lateral envelope. */
  readonly lateralPush: Readonly<Record<string, number>>;
}

/**
 * Three presets. The numbers are placement statistics, not art: what
 * changes between them is how much gets placed, how far out, how tightly
 * grouped and how much the kit leans on one part of itself.
 */
export const PRESETS: Readonly<Record<string, Preset>> = {
  sparse: {
    spriteShare: 0.25,
    spriteAccept: [0.15, 0.35],
    polysPerW: 13.8,
    polysAccept: 11,
    familiesAccept: [12, 38],
    largestFamilyCap: 0.28,
    minInstances: 5,
    density: 0.59,
    densityAccept: [0.45, 0.8],
    bands: { over: 0.231, verge: 0.054, near: 0.234, mid: 0.318, far: 0.159, distant: 0.004 },
    clusterMean: 1.35,
    coverageFloor: 0.68,
    maxGapW: 34,
    maxFillGapW: 12,
    outsideShare: 0.62,
    outsideAccept: [0.55, 0.72],
    bankMaxDeg: 11.4,
    referenceRadiusW: 7,
    envelope: 0.6,
    kitBias: { "terrain-shell": 0.35, "ground-detail": 0.9, "set-piece": 1.4, "wall-panel": 1.3, "pipe-run": 1.3, "camera-post": 1.6, "enclosure-shell": 0.5, tower: 1.2 },
    lateralPush: { "tree-group": 0.9, bush: 0.9 },
  },
  lush: {
    spriteShare: 0.28,
    spriteAccept: [0.18, 0.38],
    polysPerW: 18.9,
    polysAccept: 15,
    familiesAccept: [24, 44],
    largestFamilyCap: 0.22,
    minInstances: 4,
    density: 0.89,
    densityAccept: [0.7, 1.1],
    bands: { over: 0.211, verge: 0.06, near: 0.152, mid: 0.308, far: 0.26, distant: 0.01 },
    clusterMean: 1.55,
    coverageFloor: 0.8,
    maxGapW: 22,
    maxFillGapW: 8,
    outsideShare: 0.63,
    outsideAccept: [0.55, 0.72],
    bankMaxDeg: 10.1,
    referenceRadiusW: 7,
    envelope: 0.65,
    kitBias: { "terrain-shell": 1.25, "ground-detail": 1.2, "tree-group": 1.3, bush: 1.2, "verge-rail": 0.8 },
    lateralPush: { "tree-group": 1.15, bush: 1.1 },
  },
  dense: {
    spriteShare: 0.0,
    spriteAccept: [0, 0.05],
    polysPerW: 18.8,
    polysAccept: 15,
    familiesAccept: [60, 160],
    largestFamilyCap: 0.15,
    minInstances: 3,
    density: 0.97,
    densityAccept: [0.8, 1.25],
    bands: { over: 0.154, verge: 0.079, near: 0.292, mid: 0.345, far: 0.125, distant: 0.005 },
    clusterMean: 1.18,
    coverageFloor: 0.85,
    maxGapW: 25,
    maxFillGapW: 8,
    outsideShare: 0.61,
    outsideAccept: [0.55, 0.72],
    bankMaxDeg: 14.3,
    referenceRadiusW: 7,
    envelope: 0.7,
    kitBias: { "terrain-shell": 0.8, "set-piece": 1.3, "wall-panel": 1.2, "tree-group": 0.5, bush: 0.6, tree: 0.8, "verge-rail": 1.4 },
    lateralPush: { "tree-group": 0.7, bush: 0.75, billboard: 0.85, dome: 0.85, "wall-panel": 0.85 },
  },
};

/**
 * The sightline rule's thresholds, in half-widths.
 *
 * Here rather than beside either implementation, because there are TWO —
 * the graph culls against a sampled chord and the metric scores against
 * the exact segment, deliberately different algorithms so that one
 * checks the other. Different algorithms, same rule: retyping the numbers
 * in both is how a test starts failing for a reason that has nothing to
 * do with the code under test.
 */
/**
 * The corridor: the volume over the track that nothing may be anchored
 * in, at the height a driver occupies.
 *
 * Here rather than as literals inside the metric for the reason SIGHTLINE
 * gives below — it now has two readers, the score and the demo that draws
 * the result, and two typings of the same number is how a picture starts
 * disagreeing with the card beside it.
 *
 * NOTE WHAT IT MEASURES: the ANCHOR. A placement's `footprintW` is the
 * plan size of the art that will stand there, and nothing stops that
 * footprint reaching over the track from an anchor that is legally
 * outside it — `terrain-shell` is 8..9.5 W across and sits 2.3..3.8 W
 * out, so centred on its anchor it crosses the centreline. The rule is
 * about where a thing is PUT, not about how much room it takes once it is
 * there.
 */
export const CORRIDOR = {
  /** Half-width of the protected volume, in W. */
  halfWidthW: 1,
  /** Anything anchored at or above this clears the driver. */
  ceilingW: 1.2,
} as const;

export const SIGHTLINE = {
  /** How far ahead the centreline must stay visible. */
  lookAheadW: 12,
  /** The cockpit eye height the test is taken from. */
  eyeHeightW: 0.3,
  /** An obstruction radius is the half-footprint capped at this. */
  maxRadiusW: 2,
  /** Anything narrower than this is not an obstruction. */
  minFootprintW: 2,
  /** Anything anchored above this clears the driver's head. */
  maxHeightW: 3,
  /** Zones the test applies to, inclusive: near, mid and far. */
  zones: [3, 5] as const,
} as const;

/** Clamp a scalar. The field grammar has `clamp`; host arithmetic did not. */
export function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A station wrapped into [0, lapW), which is what a lap that closes needs. */
export function lapMod(station: number, lapW: number): number {
  return ((station % lapW) + lapW) % lapW;
}

/** Which tenth of the lap a station falls in, clamped into 0..9. */
export function tenthOf(station: number, lapW: number): number {
  return Math.min(9, Math.floor(lapMod(station, lapW) / (lapW / 10)));
}

/** Which lateral band a |t| in W falls in. The zone model, as a function. */
export function bandOf(lateralW: number, heightW: number): string {
  const t = Math.abs(lateralW);
  if (t < 1.5 && heightW > 1.2) return "over";
  if (t < 1.5) return "verge";
  if (t < 2.5) return "near";
  if (t < 5) return "mid";
  if (t < 13) return "far";
  return "distant";
}

/**
 * The committed-lean table, packed into ONE number.
 *
 * WHY A CODE AND NOT TEN KNOBS. The lean has to be decided per PLACEMENT,
 * because a cluster member is offset along the lap from its anchor and
 * can land in the next stretch. A per-placement decision means the table
 * has to be readable inside a field expression, and the grammar has no
 * array indexing — so the ten entries are packed base 3 and unpacked with
 * the arithmetic the grammar does have. The alternative, an inline
 * `param` per stretch, multiplies by the seven places `placeFromPack` is
 * called from: seventy addresses to set one table.
 *
 * Digits are 0, 1, 2 for left, neutral, right, least-significant first.
 * The largest code is 3^10 - 1 = 59048, and the decode divides by 3^k and
 * floors. That is exact in f32 with room to spare: the smallest fraction
 * the floor has to resolve is 3^-k, the rounding error at that magnitude
 * is 3^(10-k) * 2^-24, and their ratio is 3^10 / 2^-24 either way round —
 * a margin of about 280.
 */
export function encodeCommittedStretches(committed: Readonly<Record<number, number>>): number {
  let code = 0;
  for (let tenth = 0; tenth < LANDMARK_STRETCHES; tenth++) {
    const dir = committed[tenth] ?? 0;
    code += (dir > 0 ? 2 : dir < 0 ? 0 : 1) * 3 ** tenth;
  }
  return code;
}

/** The inverse, for reading a shipped graph's table back. */
export function decodeCommittedStretches(code: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (let tenth = 0; tenth < LANDMARK_STRETCHES; tenth++) {
    const digit = Math.floor(code / 3 ** tenth) % 3;
    if (digit !== 1) out[tenth] = digit === 2 ? 1 : -1;
  }
  return out;
}

/** The code that commits nothing: every stretch neutral. */
export const NO_COMMITTED_STRETCHES = encodeCommittedStretches({});
