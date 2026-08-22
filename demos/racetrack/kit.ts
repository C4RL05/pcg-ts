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

/**
 * Which vocabulary a kit or a preset speaks.
 *
 * "named" is the earlier games' art, described by what the objects are.
 * "geometry" is the late one's, described by where they sit and how much
 * room they take, because its objects are not named after anything.
 */
export type Vocabulary = "named" | "geometry";

/** How an archetype's rate responds to how tight the track is under it. */
export type AffinityProfile = "flat" | "built" | "clustered";

/** One kind of thing that gets placed, and where it is allowed to sit. */
export interface Archetype {
  readonly id: string;
  /** Which lateral/height band this belongs to: Z2..Z8 of the zone model. */
  readonly zone: string;
  /**
   * Which of the two vocabularies this archetype belongs to. Absent means
   * "named" — the kit as it stood before the second one arrived.
   *
   * A preset draws from exactly one. They are not alternative spellings
   * of the same thing: the named kit describes the earlier games' art,
   * which was named after what it is, and the geometry kit describes the
   * late one's, which was not. Mixing them would dress a lap from two
   * eras at once.
   */
  readonly vocabulary?: Vocabulary;
  /**
   * The measured curvature affinity: a multiplier on the rate for
   * straight, easy, medium and tight track.
   *
   * Carried as data even though the graph reads `profile` instead, and
   * the gap between the two is a known approximation. The graph builds
   * ONE cumulative distribution per profile — three scans serve every
   * archetype — so an archetype gets its profile's response to curvature
   * rather than its own. Each row here is assigned to the profile whose
   * curve fits it best in least squares, which is close for `near-prop`
   * (0.012) and a coin toss for `far-mass` (0.262 against 0.296), whose
   * vector sits between two curves rather than on either. Recording the
   * measurement is what makes the approximation visible, and what a
   * per-archetype distribution would be built from.
   */
  readonly affinity?: readonly [number, number, number, number];
  readonly profile: AffinityProfile;
  /** Camera-facing quad or real geometry. A preset may convert them. */
  readonly kind: "sprite" | "mesh";
  /** Signed lateral offset from the centreline, in W, as [min, max] of |t|. */
  readonly lateralW: readonly [number, number];
  /**
   * The same offset as a LADDER: the measured value at each of the
   * thirteen percentiles in `LADDER_P`. Where this is present it is what
   * gets drawn, by interpolating between the bracketing pair.
   *
   * IT IS NOT A MODEL OF THE DISTRIBUTION, IT IS THE DISTRIBUTION, and
   * that is the point. Two bounded parametric shapes were tried over this
   * kit and neither reaches the verge band, because the verge is a SEAM
   * rather than a home: no archetype is centred on 1.0–1.5W, and of the
   * source's 599 objects there, 216 arrive from BELOW their own p10 —
   * inboard tails of trackside mass — and 69 from ABOVE their own p90,
   * outboard tails of things that otherwise sit on the centreline. Any
   * bounded per-archetype envelope cuts both tails and loses the band. A
   * triangular draw over the quartiles measures 0.7% there, over p10–p90
   * 1.7%, uniform over p10–p90 3.9%, and the ladder 7.5% against a
   * measured 8.1%.
   *
   * THE LADDERS REPRODUCE EACH MARGINAL EXACTLY AND NOT THE JOINTS. The
   * corridor predicate is a statement about `|t|` and `across` together,
   * and drawing them independently scores about four points high on its
   * horizontal half. Do not chase that with an offset on either ladder:
   * moving a marginal to fix a joint is what put a spelling artefact in
   * the band mix the last time it was tried.
   */
  readonly lateralLadder?: readonly number[];
  /** The across extent's ladder, on the same percentiles. */
  readonly acrossLadder?: readonly number[];
  /** Height above the local track surface, in W. */
  readonly heightW: readonly [number, number];
  /**
   * Where the archetype's LOWEST geometry sits relative to the deck, as
   * the measured interquartile range — and, where present, the thing that
   * actually seats it.
   *
   * S-3 of the size contract, and the part most likely to catch art from
   * another source. The pivot is the centre of the bounds, so the base is
   * `heightW - tallnessW / 2` — but the published `heightW` envelopes are
   * rounded authored ranges and do not reproduce the measurement. A
   * camera post's h of 1.3–1.7 with a tallness of 0.3–0.6 implies a base
   * at 1.0–1.55W, where the measurement says 0.30–1.52W: it FLOATS clear
   * of the deck, and by more than the envelope admits. A chevron board's
   * base is under the surface. Where the two disagree the measurement
   * wins, and art seated base-to-ground lands wrong for every row here.
   *
   * Present on three archetypes. Everywhere else the `heightW` envelope
   * is the seating, because nothing measured contradicts it.
   */
  readonly baseW?: readonly [number, number];
  readonly footprintW: readonly [number, number];
  /**
   * The two horizontal extents, measured separately: ALONG the lap and
   * ACROSS it, as a box axis-aligned to the TRACK frame rather than to the
   * art's own.
   *
   * WHY BOTH, when `footprintW` is one number. It turned out to be
   * `max(along, across)` with the identity of the larger one discarded,
   * and which of the two it reported varies per instance rather than per
   * archetype. Aspect ratios in the source material run from 32:1 to 1:7,
   * so no single scalar describes the kit: reading it as a width puts a
   * wall panel across the racing line, reading it as a length makes a
   * billboard face the wrong way, and both readings are correct for part
   * of the kit and wrong for the rest.
   *
   * `footprintW` STAYS AUTHORITATIVE and is not re-derived from these.
   * Every metric is stated on it, the reconciliation is approximate
   * (seventeen archetypes of nineteen), and four archetypes are recorded
   * as pooling source families whose real sizes disagree by thirty times —
   * so a computed footprint would move the score for reasons that have
   * nothing to do with the score.
   *
   * Absent means unmeasured: treat the archetype as square at its
   * published footprint, which is what the kit said before the extents
   * were separated.
   */
  readonly alongW?: readonly [number, number];
  readonly acrossW?: readonly [number, number];
  /**
   * How strongly this archetype's lateral offset moves WITH its across
   * extent, as the measured Pearson correlation.
   *
   * The artists pushed a wide piece outboard and tucked a narrow one in,
   * so the near face stayed clear at both sizes. Drawing offset and size
   * from independent streams loses that and manufactures the one
   * combination the source material never made — wide AND near — which is
   * the largest single source of art over the track in a generated lap
   * once real extents are in play.
   *
   * Absent or zero means independent, which is what the kit did before it
   * was measured.
   */
  readonly offsetSizeR?: number;
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
// THERE IS NO DISTANT ARCHETYPE, and the absence is measured rather than
// an omission. A `skyline` row sat here once, invented to fill the
// outermost band; upstream searched the source material for sky, horizon,
// backdrop, distant and mountain stems across all three games and found
// nothing. The band is real — 0.4% to 1.0% of placements — but it is
// terrain and water planes at a median of about 15W, not a kind of
// object. `terrain-shell`'s own ladder reaches 17.29W at p100, which is
// exactly where they sit, so the band fills itself from a tail that was
// already measured.
const NAMED_ARCHETYPES: readonly Archetype[] = [
  { id: "terrain-shell", zone: "Z4", profile: "flat", kind: "mesh", lateralW: [3.4, 4.7], lateralLadder: [0.0, 0.88, 1.53, 2.37, 2.82, 3.29, 3.85, 4.33, 4.84, 5.62, 7.05, 9.7, 17.29], heightW: [0.6, 2.3], baseW: [-1.76, 0.02], footprintW: [8, 9.5], tallnessW: [4, 6], alongW: [4.5, 9.0], acrossW: [3.8, 7.7], acrossLadder: [0.97, 2.35, 2.78, 3.52, 4.45, 5.28, 6.21, 6.91, 7.74, 8.73, 10.56, 12.05, 19.51], offsetSizeR: 0.59, polygons: 38, rate: 12, cluster: 1.8, outsideBias: 0.68 },
  { id: "ground-detail", zone: "Z3", profile: "flat", kind: "mesh", lateralW: [1.5, 2.5], lateralLadder: [0.78, 1.37, 1.48, 1.7, 1.8, 1.89, 2.07, 2.22, 2.46, 2.96, 4.22, 6.51, 9.06], heightW: [0.1, 0.4], footprintW: [4, 7], tallnessW: [0.4, 0.8], alongW: [5.1, 6.5], acrossW: [0.8, 2.0], acrossLadder: [0.1, 0.28, 0.39, 0.7, 0.9, 1.15, 1.4, 1.6, 1.82, 2.59, 3.36, 4.51, 6.07], offsetSizeR: 0.43, polygons: 18, rate: 10, cluster: 1.7, outsideBias: 0.62 },
  { id: "bush", zone: "Z5", profile: "clustered", kind: "sprite", lateralW: [2.6, 4.6], lateralLadder: [1.1, 2.57, 2.98, 4.01, 4.12, 4.6, 4.78, 5.22, 6.18, 6.51, 6.96, 7.36, 9.34], heightW: [1.2, 1.8], footprintW: [1.0, 1.3], tallnessW: [1.4, 1.9], alongW: [0.7, 1.4], acrossW: [0.5, 1.7], acrossLadder: [0.13, 0.17, 0.2, 0.3, 0.67, 1.06, 1.29, 1.53, 1.86, 1.94, 2.5, 2.72, 3.41], offsetSizeR: -0.03, polygons: 1, rate: 9, cluster: 2.8, outsideBias: 0.75 },
  { id: "tree-group", zone: "Z5", profile: "clustered", kind: "sprite", lateralW: [5.0, 8.0], lateralLadder: [0.01, 2.1, 2.44, 3.12, 3.84, 4.59, 5.73, 6.57, 7.65, 8.76, 10.42, 10.66, 14.35], heightW: [1.6, 2.2], footprintW: [1.0, 1.4], tallnessW: [2.0, 2.5], alongW: [0.5, 1.7], acrossW: [0.7, 2.4], acrossLadder: [0.02, 0.17, 0.21, 0.5, 0.97, 1.35, 1.6, 1.93, 2.04, 2.67, 5.16, 6.99, 16.16], offsetSizeR: -0.22, polygons: 1, rate: 5, cluster: 3.4, outsideBias: 0.75 },
  { id: "tree", zone: "Z5", profile: "clustered", kind: "mesh", lateralW: [5.0, 7.0], lateralLadder: [0.24, 2.69, 3.51, 3.88, 4.51, 5.62, 6.11, 6.51, 7.15, 7.41, 7.72, 8.92, 9.33], heightW: [2.0, 2.6], footprintW: [1.0, 1.3], tallnessW: [2.1, 2.7], alongW: [0.9, 1.6], acrossW: [0.3, 1.5], acrossLadder: [0.06, 0.13, 0.19, 0.2, 0.25, 0.48, 0.68, 1.07, 1.36, 1.47, 1.64, 1.83, 2.0], offsetSizeR: 0.13, polygons: 30, rate: 5, cluster: 2.4, outsideBias: 0.75 },
  { id: "set-piece", zone: "Z3", profile: "built", kind: "mesh", lateralW: [1.6, 2.4], lateralLadder: [0.0, 0.15, 0.77, 1.38, 1.56, 1.78, 2.05, 2.16, 2.37, 2.69, 3.14, 3.87, 6.8], heightW: [1.0, 1.5], footprintW: [5, 7], tallnessW: [1.8, 2.6], alongW: [3.8, 7.7], acrossW: [1.6, 3.7], acrossLadder: [0.24, 0.72, 0.84, 1.16, 1.62, 1.85, 2.29, 2.75, 3.17, 3.96, 5.33, 6.14, 13.93], offsetSizeR: 0.36, polygons: 38, rate: 7, cluster: 1.4, outsideBias: 0.72 },
  { id: "wall-panel", zone: "Z4", profile: "built", kind: "mesh", lateralW: [2.6, 4.2], lateralLadder: [0.0, 0.46, 1.51, 1.82, 2.03, 2.16, 2.3, 2.6, 2.89, 3.84, 6.85, 9.16, 18.86], heightW: [1.6, 2.4], footprintW: [7, 10], tallnessW: [5, 8], alongW: [3.0, 8.3], acrossW: [1.9, 5.3], acrossLadder: [0.09, 0.29, 0.42, 0.86, 1.72, 2.29, 3.2, 4.9, 5.32, 6.1, 6.86, 6.96, 10.32], offsetSizeR: -0.16, polygons: 28, rate: 5, cluster: 2.0, outsideBias: 0.75 },
  { id: "overhead-sign", zone: "Z7", profile: "flat", kind: "mesh", lateralW: [0.0, 0.5], lateralLadder: [0.0, 0.02, 0.04, 0.07, 0.1, 0.12, 0.17, 0.27, 2.58, 3.53, 4.72, 4.84, 8.47], heightW: [1.6, 2.0], footprintW: [3, 4], tallnessW: [1.4, 2.0], alongW: [0.4, 3.0], acrossW: [2.7, 5.2], acrossLadder: [0.47, 1.66, 1.94, 2.43, 2.72, 3.29, 3.57, 4.11, 4.57, 5.36, 5.98, 6.61, 8.69], offsetSizeR: -0.38, polygons: 28, rate: 5, cluster: 1.1, outsideBias: 0.5 },
  { id: "chevron-board", zone: "Z3", profile: "clustered", kind: "mesh", lateralW: [1.6, 2.4], lateralLadder: [1.22, 1.69, 1.74, 1.94, 1.95, 2.03, 2.12, 2.84, 3.34, 4.66, 5.71, 5.74, 5.76], heightW: [0.4, 0.9], baseW: [-0.55, -0.36], footprintW: [1.5, 2.5], tallnessW: [1.5, 2.5], alongW: [1.3, 2.3], acrossW: [0.4, 2.3], acrossLadder: [0.31, 0.32, 0.34, 0.4, 0.42, 0.47, 0.84, 1.72, 2.03, 2.29, 2.31, 2.31, 2.32], offsetSizeR: 0.8, polygons: 10, rate: 4, cluster: 2.2, outsideBias: 0.8 },
  { id: "tower", zone: "Z4", profile: "built", kind: "mesh", lateralW: [2.6, 3.6], lateralLadder: [0.2, 0.48, 1.65, 2.36, 2.96, 2.98, 2.99, 3.69, 3.72, 3.73, 6.93, 8.23, 9.01], heightW: [2.8, 3.5], footprintW: [1.6, 2.2], tallnessW: [1.0, 1.5], alongW: [1.6, 4.1], acrossW: [1.5, 3.1], acrossLadder: [0.55, 0.96, 1.06, 1.17, 1.47, 1.92, 2.2, 2.33, 2.5, 3.33, 6.87, 6.95, 7.58], offsetSizeR: 0.55, polygons: 30, rate: 3, cluster: 1.3, outsideBias: 0.7 },
  { id: "pipe-run", zone: "Z3", profile: "built", kind: "mesh", lateralW: [1.7, 2.5], lateralLadder: [0.06, 1.33, 1.84, 2.31, 2.42, 2.56, 2.77, 2.81, 3.55, 4.18, 5.36, 7.66, 12.72], heightW: [0.9, 1.3], footprintW: [1.6, 2.2], tallnessW: [0.4, 0.7], alongW: [1.9, 5.4], acrossW: [0.3, 4.1], acrossLadder: [0.0, 0.0, 0.0, 0.02, 0.3, 0.32, 0.6, 2.87, 3.54, 4.13, 4.87, 5.26, 7.69], offsetSizeR: 0.3, polygons: 30, rate: 4, cluster: 2.6, outsideBias: 0.66 },
  { id: "billboard", zone: "Z5", profile: "flat", kind: "mesh", lateralW: [5.2, 7.0], lateralLadder: [0.01, 0.02, 0.06, 0.15, 0.36, 3.17, 3.73, 4.53, 5.07, 5.3, 7.59, 7.79, 7.84], heightW: [2.4, 3.2], footprintW: [5, 7], tallnessW: [6, 7.5], alongW: [0.6, 2.8], acrossW: [3.1, 5.2], acrossLadder: [0.18, 0.78, 2.25, 2.98, 3.82, 4.32, 4.65, 4.69, 5.1, 5.48, 7.23, 7.35, 12.37], offsetSizeR: -0.13, polygons: 24, rate: 2, cluster: 1.2, outsideBias: 0.78 },
  { id: "lamp-arm", zone: "Z7", profile: "built", kind: "mesh", lateralW: [0.6, 0.9], lateralLadder: [0.28, 0.35, 0.49, 0.57, 0.77, 1.37, 1.6, 1.82, 1.96, 2.03, 2.5, 3.39, 8.05], heightW: [1.4, 1.9], footprintW: [2.0, 2.8], tallnessW: [2.6, 3.4], alongW: [0.3, 1.8], acrossW: [1.0, 2.3], acrossLadder: [0.31, 0.39, 0.4, 0.92, 0.95, 0.96, 1.08, 1.89, 2.23, 2.29, 2.33, 2.33, 2.38], offsetSizeR: -0.09, polygons: 26, rate: 3.5, cluster: 1.6, outsideBias: 0.5 },
  { id: "camera-post", zone: "Z2", profile: "clustered", kind: "mesh", lateralW: [1.05, 1.3], lateralLadder: [0.01, 0.08, 0.16, 0.33, 0.72, 0.98, 1.28, 1.47, 1.6, 2.12, 2.68, 3.91, 7.24], heightW: [1.3, 1.7], baseW: [0.3, 1.52], footprintW: [0.5, 0.9], tallnessW: [0.3, 0.6], alongW: [0.7, 0.9], acrossW: [0.6, 1.1], acrossLadder: [0.38, 0.44, 0.52, 0.63, 0.64, 0.71, 0.78, 0.95, 0.95, 2.01, 2.6, 2.65, 3.22], offsetSizeR: -0.09, polygons: 16, rate: 5.5, cluster: 1.0, outsideBias: 0.42 },
  { id: "dome", zone: "Z5", profile: "built", kind: "mesh", lateralW: [5.6, 7.4], lateralLadder: [0.56, 0.56, 0.91, 0.91, 1.92, 7.3, 7.64, 7.64, 7.92, 8.01, 8.53, 8.53, 8.53], heightW: [4.2, 5.0], footprintW: [5, 6.5], tallnessW: [3.2, 4.2], alongW: [3.0, 6.6], acrossW: [3.5, 6.5], acrossLadder: [2.85, 2.85, 2.86, 2.86, 3.56, 4.91, 5.67, 5.67, 6.55, 6.65, 7.34, 7.34, 7.34], offsetSizeR: 0.68, polygons: 32, rate: 2, cluster: 1.1, outsideBias: 0.7 },
  // NO UPSTREAM MEASUREMENT, and the only row in either kit without one
  // now that `skyline` is gone. It is the full-width banner that spans
  // the track: real, but ten instances of one family in one game, below
  // the twelve-per-game threshold the contract table publishes at. It
  // also shares its name with a small piece of trackside furniture in the
  // later game that has nothing else in common with it, so a published
  // row would pool two unrelated things — the defect that makes
  // `verge-rail` unscoreable. Kept because a banner over the track is
  // worth having in a demo about layout and because saying where it came
  // from costs one comment; not to be treated as measured.
  { id: "banner", zone: "Z7", profile: "flat", kind: "mesh", lateralW: [0, 0.2], heightW: [1.7, 2.1], footprintW: [10, 13], tallnessW: [4, 5.5], alongW: [0.6, 1.2], acrossW: [13.2, 13.6], polygons: 14, rate: 1.5, cluster: 1.0, outsideBias: 0.5 },
  { id: "enclosure-shell", zone: "Z7", profile: "flat", kind: "mesh", lateralW: [0, 0.6], lateralLadder: [0.0, 0.05, 0.06, 0.23, 0.29, 0.79, 0.89, 1.18, 1.31, 1.39, 2.43, 7.31, 19.03], heightW: [1.4, 2.6], footprintW: [9, 13], tallnessW: [6, 13], alongW: [0.5, 3.3], acrossW: [0.7, 5.1], acrossLadder: [0.46, 0.49, 0.54, 0.58, 0.61, 0.64, 0.65, 0.76, 0.78, 6.43, 12.28, 12.91, 13.09], offsetSizeR: 0.26, polygons: 44, rate: 3, cluster: 3.0, outsideBias: 0.5 },
  { id: "verge-rail", zone: "Z2", profile: "flat", kind: "mesh", lateralW: [1.05, 1.45], lateralLadder: [0.0, 0.0, 0.02, 0.09, 0.24, 0.51, 2.21, 2.71, 2.91, 3.02, 3.27, 3.39, 3.82], heightW: [0.2, 0.6], footprintW: [2.5, 4.5], tallnessW: [0.6, 1.2], alongW: [0.3, 2.0], acrossW: [1.7, 3.7], acrossLadder: [0.01, 0.16, 1.1, 1.71, 1.87, 2.7, 2.99, 3.32, 3.49, 3.72, 4.86, 5.08, 6.66], offsetSizeR: 0.04, polygons: 12, rate: 4, cluster: 2.4, outsideBias: 0.6 },
];

/** Placed by RULE rather than by density: no rate, no cumulative draw. */
/**
 * THE SECOND VOCABULARY, derived from geometry rather than from names.
 *
 * The named kit above matches 46.9% of the earlier games' placements and
 * only 14.1% of the late one's, because that game's artists stopped
 * naming objects after what they are: its largest families are
 * modelling-tool primitives carrying LOD and scene suffixes, 3,014
 * families over 7,371 objects against 306 over 7,132 for the earlier
 * pair. No name rule recovers a vocabulary from that.
 *
 * What survives is the geometry. Clustering every object on measured
 * position, both horizontal extents, height and polygon count gives these
 * twelve, covering 100% of the 7,372 objects.
 *
 * REGENERATED FROM CORRECTED GEOMETRY, and this table shares no row with
 * the one it replaces. The late game's scenery vertex array had been read
 * as plain triples where it is 12-byte PAIRS with the second vertex's z
 * leading — a misreading that leaves every index in range and every
 * vertex referenced, so nothing downstream complained while the geometry
 * was scrambled. Quad planarity is what separates the two readings: 96.6%
 * of 76,899 quads are flat read as pairs against 10.8% read as triples,
 * with the earlier game's own quads at 88.8% for what "flat" is worth.
 * Every bounding box a scrambled quad had stretched was too big, so the
 * clustering re-partitioned from scratch. Twelve again is the fixed `k`
 * and not a partition that survived: some old rows split, some merged,
 * and no migration from the previous ids is meaningful. It was replaced,
 * not amended.
 *
 * THE NAMES DESCRIBE WHAT WAS MEASURED — position and mass — and not what
 * the objects are. Nothing in the data says whether `mid-mass` is a rock,
 * a hangar or a stack of containers; that is a theme decision and stays
 * one. They are derived from the measurement rather than assigned by
 * hand, because k-means renumbers arbitrarily and a hand-maintained id
 * moves under the table whenever the input does. Where two clusters land
 * on the same description the second is suffixed — `near-detail-2`,
 * `mid-mass-2`, `near-prop-2` — which is honest about them being alike in
 * position and mass while differing elsewhere, and `near-detail-2` shows
 * how far elsewhere can go: it sits in Z7 at a base of 0.18–2.07W, over
 * the track rather than beside it.
 *
 * Each cluster carries a label voted by the minority of its members whose
 * names the named rules recognise, and those are hints with a stated
 * support rather than identifications, which is why they are not encoded
 * here as ids. Read `mid-mass-2 / terrain-shell / 97% / 23%` as "of the
 * 23% of this cluster that carries a name the rules know, 97% are terrain
 * families" — good evidence there, and thin for `enclosure` at 38% of
 * 10%. The votes, as label/support/named-share: `near-prop` wall-panel
 * 46%/13%, `near-detail` set-piece 46%/9%, `mid-mass` terrain-shell
 * 65%/24%, `enclosure` enclosure-shell 38%/10%, `near-detail-2` bush
 * 63%/12%, `mid-mass-2` terrain-shell 97%/23%, `tall-mass` terrain-shell
 * 79%/11%, `near-prop-2` lamp-arm 38%/17%, `high-detail` pipe-run
 * 45%/13%, `far-mass` terrain-shell 67%/17%, `high-mass` terrain-shell
 * 46%/8%, `under-deck` terrain-shell 86%/8%.
 *
 * `profile` IS OURS AND NOT MEASURED. There is no such column for this
 * vocabulary and upstream declines to invent one, correctly: it
 * classifies what a thing IS, and this vocabulary exists because that
 * game's objects are not named after what they are. Each row is assigned
 * here to the profile whose curve fits its measured `affinity` best in
 * least squares, which is reproducible from the two arrays. The fits are
 * clean for `near-prop` (0.012), `mid-mass` (0.044) and `near-prop-2`
 * (0.052), and a coin toss for `far-mass` (flat 0.262, built 0.296) and
 * `high-detail` (built 0.275, flat 0.306), where the vector sits between
 * two curves rather than on either. NOTHING LANDS ON `clustered`. That is
 * the table talking: this era's affinities run mild and straight-biased,
 * and the rising-into-tight-corners shape the named kit needs has no
 * member here. Where a row's fit is poor the graph is applying a curve
 * the archetype does not have, and `affinity` is the column that says so.
 *
 * `rate` is placements per 100W of lap. The twelve sum to 93.1, i.e. 0.93
 * per W against the 0.97 measured directly; the difference is objects
 * carrying no vertices, which are skipped rather than placed.
 *
 * `cluster` is the mean number of instances of THAT ONE archetype within
 * 1.5W of each other, which is not the pooled 3–5 the cluster ruleset
 * quotes — different statistic, different population, and reading one as
 * the other is how a constructed-clump generator goes three times too
 * dispersed. Note how flat the column is: nine of the twelve sit between
 * 1.1 and 2.0, because this era clumps far less than the earlier ones.
 *
 * NO `offsetSizeR` HERE, and the reason has changed. It used to be that
 * the correlation was measured at -0.21 to +0.18 and was nothing to
 * apply. That measurement was taken on the scrambled geometry and has not
 * been re-published, so the honest state is UNKNOWN rather than zero. The
 * structural argument for expecting it near zero still stands — these
 * archetypes are k-means clusters cut on position and both extents
 * together, so conditioning on membership has already removed most of the
 * covariance `offsetSizeR` measures — but an argument is not a
 * measurement, and this comment is the difference.
 *
 * SHAPE MODES EXIST UPSTREAM AND ARE NOT CONSUMED HERE. Each archetype is
 * split into modes on surface occupancy — `slab`, `shell`, `ring`,
 * `frame`, `wedge` — and eight of the twelve are a single `slab`. The
 * splits worth having are `enclosure` finding its bore (ring 28%),
 * `far-mass` (frame 19%), `near-detail` (wedge 25%) and `near-prop`
 * (shell 34%). Nothing here can use them: a mode describes where the
 * SURFACE is inside the bounding box, and this kit places boxes. They
 * become load-bearing when placements are meshes, which is the same point
 * at which the corridor rule needs a boolean subtract rather than a box
 * predicate.
 */
const GEOMETRY_ARCHETYPES: readonly Archetype[] = [
  { id: "near-prop", zone: "Z3", profile: "flat", kind: "mesh", vocabulary: "geometry", lateralW: [1.77, 2.71], lateralLadder: [0.14, 0.95, 1.25, 1.68, 1.86, 2.04, 2.17, 2.33, 2.57, 2.83, 3.24, 3.63, 5.21], heightW: [0.91, 1.66], baseW: [-0.23, 0.06], footprintW: [2.89, 4.2], alongW: [2.91, 4.27], acrossW: [1.33, 2.46], acrossLadder: [0.0, 0.57, 0.85, 1.22, 1.45, 1.66, 1.87, 2.08, 2.35, 2.62, 3.01, 3.33, 4.67], tallnessW: [2.19, 3.46], polygons: 20, rate: 14.1, cluster: 1.6, outsideBias: 0.52, affinity: [0.99, 0.93, 1.04, 1.07] },
  { id: "near-detail", zone: "Z3", profile: "flat", kind: "mesh", vocabulary: "geometry", lateralW: [1.45, 2.07], lateralLadder: [0.0, 0.39, 0.88, 1.29, 1.55, 1.67, 1.75, 1.85, 1.99, 2.18, 2.51, 2.96, 6.42], heightW: [0.18, 0.96], baseW: [0.02, 0.5], footprintW: [2.46, 3.89], alongW: [2.51, 3.8], acrossW: [0.45, 1.22], acrossLadder: [0.0, 0.02, 0.09, 0.28, 0.55, 0.73, 0.89, 1.03, 1.17, 1.36, 1.75, 2.02, 5.01], tallnessW: [0.24, 1.04], polygons: 6, rate: 12.9, cluster: 1.96, outsideBias: 0.59, affinity: [1.13, 1.31, 0.7, 0.62] },
  { id: "mid-mass", zone: "Z4", profile: "flat", kind: "mesh", vocabulary: "geometry", lateralW: [3.35, 5.42], lateralLadder: [0.82, 2.23, 2.74, 3.19, 3.5, 3.83, 4.16, 4.6, 5.14, 5.75, 7.46, 8.76, 18.74], heightW: [0.85, 2.26], baseW: [-1.23, 0.05], footprintW: [4.63, 6.91], alongW: [3.56, 5.91], acrossW: [3.83, 6.13], acrossLadder: [1.43, 2.71, 3.03, 3.66, 4.02, 4.47, 4.86, 5.27, 5.79, 6.59, 7.81, 8.63, 16.63], tallnessW: [2.72, 5.68], polygons: 28, rate: 9.1, cluster: 1.34, outsideBias: 0.72, affinity: [0.89, 1.03, 1.13, 1.12] },
  { id: "enclosure", zone: "Z7", profile: "built", kind: "mesh", vocabulary: "geometry", lateralW: [0.03, 0.2], lateralLadder: [0.0, 0.0, 0.01, 0.02, 0.03, 0.05, 0.08, 0.11, 0.16, 0.27, 0.49, 0.78, 1.91], heightW: [0.57, 1.84], baseW: [-0.74, 0.41], footprintW: [3.76, 6.25], alongW: [0.66, 3.25], acrossW: [3.58, 6.25], acrossLadder: [1.87, 2.63, 2.94, 3.42, 3.76, 4.2, 4.58, 4.93, 5.64, 6.48, 7.4, 8.56, 16.47], tallnessW: [1.53, 3.85], polygons: 39, rate: 8.7, cluster: 1.16, outsideBias: 0.65, affinity: [1.33, 0.87, 0.69, 0.6] },
  { id: "near-detail-2", zone: "Z7", profile: "flat", kind: "mesh", vocabulary: "geometry", lateralW: [0.58, 1.9], lateralLadder: [0.0, 0.02, 0.09, 0.28, 1.02, 1.24, 1.44, 1.64, 1.81, 1.98, 2.56, 2.91, 5.05], heightW: [0.73, 2.52], baseW: [0.18, 2.07], footprintW: [0.31, 1.51], alongW: [0.1, 0.52], acrossW: [0.27, 1.43], acrossLadder: [0.0, 0.07, 0.12, 0.23, 0.3, 0.44, 0.55, 0.8, 1.09, 1.84, 2.81, 3.43, 9.06], tallnessW: [0.35, 1.27], polygons: 4, rate: 8.4, cluster: 2.43, outsideBias: 0.56, affinity: [1.23, 0.72, 0.92, 0.78] },
  { id: "mid-mass-2", zone: "Z4", profile: "flat", kind: "mesh", vocabulary: "geometry", lateralW: [2.64, 4.03], lateralLadder: [0.18, 2.1, 2.33, 2.58, 2.8, 2.97, 3.16, 3.47, 3.77, 4.32, 4.85, 5.67, 20.43], heightW: [0.05, 0.67], baseW: [-0.22, 0.06], footprintW: [3.57, 5.49], alongW: [3.07, 4.47], acrossW: [2.99, 5.11], acrossLadder: [1.17, 2.17, 2.4, 2.79, 3.15, 3.4, 3.66, 4.02, 4.6, 5.52, 6.76, 7.51, 14.03], tallnessW: [0.38, 1.4], polygons: 15, rate: 8.4, cluster: 1.46, outsideBias: 0.66, affinity: [1.02, 1.08, 1.07, 0.68] },
  { id: "tall-mass", zone: "Z4", profile: "flat", kind: "mesh", vocabulary: "geometry", lateralW: [2.55, 4.6], lateralLadder: [0.12, 1.75, 2.03, 2.43, 2.85, 3.14, 3.47, 3.74, 4.31, 4.93, 6.21, 7.2, 11.03], heightW: [1.49, 3.35], baseW: [-2.75, 0.05], footprintW: [2.39, 3.61], alongW: [1.83, 3.18], acrossW: [0.71, 2.52], acrossLadder: [0.0, 0.02, 0.1, 0.48, 0.92, 1.37, 1.66, 2.02, 2.34, 2.76, 3.53, 4.13, 7.37], tallnessW: [5.53, 8.53], polygons: 12, rate: 8.0, cluster: 1.76, outsideBias: 0.75, affinity: [1.0, 1.18, 0.83, 1.04] },
  { id: "near-prop-2", zone: "Z3", profile: "flat", kind: "mesh", vocabulary: "geometry", lateralW: [1.71, 3.17], lateralLadder: [0.74, 1.19, 1.45, 1.65, 1.79, 2.08, 2.36, 2.65, 3.03, 3.37, 4.0, 5.07, 8.23], heightW: [0.69, 1.5], baseW: [-0.28, 0.28], footprintW: [0.96, 2.15], alongW: [0.64, 1.54], acrossW: [0.88, 2.11], acrossLadder: [0.0, 0.39, 0.53, 0.79, 0.92, 1.06, 1.26, 1.58, 1.9, 2.47, 3.43, 4.0, 7.46], tallnessW: [1.57, 2.88], polygons: 16, rate: 6.5, cluster: 1.41, outsideBias: 0.72, affinity: [1.05, 1.04, 0.81, 1.11] },
  { id: "high-detail", zone: "Z4", profile: "built", kind: "mesh", vocabulary: "geometry", lateralW: [2.65, 4.55], lateralLadder: [0.23, 1.39, 1.6, 2.31, 2.88, 3.15, 3.44, 3.81, 4.39, 4.75, 5.92, 8.02, 15.59], heightW: [2.56, 5.23], baseW: [1.65, 4.14], footprintW: [0.97, 2.71], alongW: [0.61, 2.33], acrossW: [0.19, 1.44], acrossLadder: [0.0, 0.01, 0.03, 0.14, 0.26, 0.52, 0.77, 0.96, 1.24, 1.71, 2.13, 3.34, 6.58], tallnessW: [0.66, 2.0], polygons: 3, rate: 6.1, cluster: 1.98, outsideBias: 0.79, affinity: [1.31, 0.83, 0.72, 0.68] },
  { id: "far-mass", zone: "Z5", profile: "flat", kind: "mesh", vocabulary: "geometry", lateralW: [5.13, 7.91], lateralLadder: [2.21, 3.64, 4.08, 4.86, 5.28, 6.06, 6.56, 7.05, 7.59, 8.39, 9.4, 10.93, 19.83], heightW: [0.77, 2.53], baseW: [-0.19, 1.57], footprintW: [2.91, 4.61], alongW: [2.13, 3.98], acrossW: [1.82, 3.77], acrossLadder: [0.0, 0.9, 1.19, 1.57, 1.94, 2.44, 2.85, 3.25, 3.6, 4.11, 5.09, 6.31, 8.63], tallnessW: [0.94, 2.92], polygons: 8, rate: 4.7, cluster: 1.56, outsideBias: 0.84, affinity: [1.28, 0.87, 0.76, 0.67] },
  { id: "high-mass", zone: "Z4", profile: "flat", kind: "mesh", vocabulary: "geometry", lateralW: [2.51, 5.97], lateralLadder: [0.01, 0.77, 1.72, 2.12, 2.92, 3.51, 4.18, 4.85, 5.47, 6.89, 7.96, 9.71, 17.16], heightW: [5.45, 7.87], baseW: [0.05, 4.11], footprintW: [3.64, 6.53], alongW: [2.73, 5.15], acrossW: [0.88, 4.67], acrossLadder: [0.0, 0.0, 0.05, 0.7, 1.32, 2.03, 2.74, 3.46, 4.47, 5.23, 6.93, 7.6, 14.28], tallnessW: [4.92, 11.55], polygons: 18, rate: 4.0, cluster: 1.69, outsideBias: 0.82, affinity: [1.29, 0.69, 0.79, 0.86] },
  { id: "under-deck", zone: "Z8", profile: "built", kind: "mesh", vocabulary: "geometry", lateralW: [1.85, 4.53], lateralLadder: [0.08, 0.31, 0.6, 1.3, 2.03, 2.43, 3.01, 3.77, 4.3, 5.02, 6.05, 6.82, 17.93], heightW: [-4.82, -2.56], baseW: [-9.68, -5.58], footprintW: [2.42, 4.43], alongW: [1.71, 3.11], acrossW: [1.18, 3.83], acrossLadder: [0.0, 0.02, 0.21, 0.82, 1.45, 2.11, 2.13, 2.79, 3.36, 4.07, 4.82, 5.32, 10.54], tallnessW: [2.86, 10.47], polygons: 6, rate: 2.3, cluster: 2.06, outsideBias: 0.31, affinity: [1.46, 0.85, 0.43, 0.63] },
];

/**
 * Both vocabularies, in one list. A preset selects between them with
 * `vocabulary`; nothing draws from the union.
 */
export const ARCHETYPES: readonly Archetype[] = [...NAMED_ARCHETYPES, ...GEOMETRY_ARCHETYPES];

/** The archetypes a preset actually draws from. */
export function archetypesFor(vocabulary: Vocabulary): readonly Archetype[] {
  return ARCHETYPES.filter((a) => (a.vocabulary ?? "named") === vocabulary);
}

export const RULE_ARCHETYPES: readonly Archetype[] = [
  { id: "corner-marker", zone: "Z3", profile: "flat", kind: "mesh", lateralW: [1.6, 2.2], heightW: [1.0, 1.6], footprintW: [1.2, 1.8], tallnessW: [1.8, 2.4], alongW: [1.2, 1.8], acrossW: [1.2, 1.8], polygons: 18, rate: 0, cluster: 1, outsideBias: 1 },
  { id: "braking-reference", zone: "Z3", profile: "flat", kind: "mesh", lateralW: [1.6, 2.4], heightW: [0.8, 1.2], footprintW: [0.6, 1.0], tallnessW: [1.4, 2.0], alongW: [0.6, 1.0], acrossW: [0.6, 1.0], polygons: 10, rate: 0, cluster: 1, outsideBias: 1 },
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

/**
 * The thirteen percentiles every ladder in this kit is measured at.
 *
 * Denser at the ends than in the middle on purpose: the tails are where
 * the interesting placements are and where a parametric shape goes wrong,
 * so the ladder spends its resolution there. The last segment, p95 to
 * p100, is a straight line out to a single extreme object and will
 * over-produce the outermost band slightly. That is a known and small
 * cost of carrying the real maximum rather than a trimmed one.
 */
export const LADDER_P: readonly number[] = [
  0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1,
];

/**
 * Read a ladder at quantile `u`, interpolating between the bracketing
 * percentiles. The graph does the same thing as a field expression; this
 * is for the host, which has to model the same draw when it fits.
 */
export function sampleLadder(ladder: readonly number[], u: number): number {
  const t = Math.min(1, Math.max(0, u));
  for (let i = 1; i < LADDER_P.length; i++) {
    if (t <= LADDER_P[i]) {
      const span = LADDER_P[i] - LADDER_P[i - 1];
      const f = span > 0 ? (t - LADDER_P[i - 1]) / span : 0;
      return ladder[i - 1] + (ladder[i] - ladder[i - 1]) * f;
    }
  }
  return ladder[ladder.length - 1];
}

/**
 * A symmetric triangular quantile on [0, 1]: the value `tri` would draw
 * at uniform `u`.
 *
 * The host needs this because the two kits are drawn with different
 * SHAPES. Where a ladder exists the draw is uniform in `u` and the ladder
 * carries the shape; where there is only an interquartile pair the draw
 * is triangular across it, for the reason `tri` states in the graph. A
 * fitter that models both as one thing is the same class of bug as
 * reading a published envelope while the graph draws a different one.
 */
function triQuantile(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return t < 0.5 ? Math.sqrt(t / 2) : 1 - Math.sqrt((1 - t) / 2);
}

/**
 * The `|t|` an archetype draws at quantile `u` — the ladder where one is
 * measured, and a triangular draw across the published interquartile pair
 * where there is not.
 *
 * THE CORRIDOR IS NOT DEFENDED HERE any more, and that is the correction
 * that matters. An earlier version floored a widened envelope at the
 * corridor's edge, which kept anchors out of the driver's way by moving
 * them ASIDE. The source moves them UP: of the archetypes whose geometry
 * reaches over the corridor, the ones that belong there clear the ceiling
 * while the ground-hugging ones are merely beside it. So the offset is
 * drawn as measured and the HEIGHT carries the rule; see where `heightW`
 * is set in the graph. A lateral floor would throw away exactly the mass
 * below 1.0W that puts anything in the verge band at all.
 *
 * THE PER-ARCHETYPE EVIDENCE FOR THIS WAS MEASURED ON A SUPERSEDED
 * CLUSTERING and has not been re-published. It read: `micro-detail`
 * inside `|t|` of 1W had a median base 1.76W above the deck against 0.95W
 * for the same archetype outboard — it rose as it came inboard — and it
 * was the single largest contributor to the verge band. That archetype
 * does not exist in the regenerated vocabulary. What the current table
 * shows in its place is `near-detail-2`, which sits in Z7 with a lateral
 * ladder reaching 0.28W at p20 and a base of 0.18–2.07W: inboard, and
 * lifted clear. The rule stands on the table it is applied to; the two
 * figures above are history and are kept because a rule whose evidence
 * quietly vanished is worse than one that says where its evidence went.
 */
export function lateralAt(a: Archetype, u: number): number {
  if (a.lateralLadder) return sampleLadder(a.lateralLadder, u);
  const [lo, hi] = a.lateralW;
  return lo + (hi - lo) * triQuantile(u);
}

/**
 * The blend weights that reproduce a stated correlation `r` WITHOUT
 * changing the spread: `[sqrt(r), sqrt(1 - r)]` on the shared and the
 * independent stream.
 *
 * The obvious weighting — `w` and `1 - w` chosen so the correlation comes
 * out right — is wrong, and wrong in a way that hides. Blending two
 * independent streams of equal variance at those weights leaves
 * `sqrt(w^2 + (1-w)^2)` of the spread, a 28% narrowing at the largest
 * correlation this kit carries. That is a third of the distance between
 * two adjacent bands, and it was the third instance in this project of
 * one quantity having two spellings — the fitter integrating a draw the
 * graph does not make. Squared weights summing to one fixes it: the
 * variance is held exactly and the correlation is still `r`.
 *
 * IT IS INERT FOR EVERY ARCHETYPE THE KIT SHIPS, and still worth having
 * right. Every row upstream has measured carries ladders, and the ladder
 * path draws from a single stream where no correlation applies; the four
 * rows without one — `banner` and the three rule-placed families — carry
 * no `offsetSizeR`, so the weights come out `[0, 1]` and the blend is
 * bit-identical to an independent draw. It exists for the archetype a
 * user adds with a published pair and a measured correlation.
 *
 * A correlated LADDER draw is a Gaussian copula rather than a blend, and
 * upstream has measured that it buys nothing here: at each archetype's
 * measured rank correlation it moves corridor intrusion by half a point
 * on one kit and not at all on the other, because the median |r| is only
 * 0.20 and 0.13. Three to four points of over-intrusion is the
 * irreducible price of holding art as marginals.
 */
export function correlationWeights(r: number): readonly [number, number] {
  const clamped = Math.min(1, Math.max(0, Math.abs(r)));
  return [Math.sqrt(clamped), Math.sqrt(1 - clamped)];
}

/**
 * An archetype's horizontal extents, along the lap and across it.
 *
 * The fallback is the square the kit described before the two were
 * separated, so an unmeasured archetype draws and tests exactly as it did.
 */
export function extentsOf(a: Archetype): {
  readonly along: readonly [number, number];
  readonly across: readonly [number, number];
} {
  return { along: a.alongW ?? a.footprintW, across: a.acrossW ?? a.footprintW };
}

/** The three profiles, in the order the graph lays them out in lanes. */
export const PROFILES: readonly AffinityProfile[] = ["flat", "built", "clustered"];

/**
 * Corner-radius thresholds in W, separating the four curvature buckets.
 * A straight is R >= 40W; tight is R < 7W.
 */
export const BUCKET_EDGES = { easy: 40, medium: 15, tight: 7 } as const;

/** A corner is smoothed curvature tighter than this radius, in W. */
export const CORNER_RADIUS_W = 12;

/**
 * Is this band the one that means "over the track" or "under it"?
 *
 * Both readers need it and they hold the zone differently — the kit
 * writes it as a label like `Z7`, and a placement carries the digit — so
 * this takes either. Spelled once because it decides two rules that have
 * to agree: which archetypes the corridor rule exempts, and which
 * placements the side-of-corner and corridor metrics skip. Something on
 * the centreline has no side, and a tunnel bore is anchored on the racing
 * line because a bore surrounds it.
 */
export function isOverOrUnderTrack(zone: string | number): boolean {
  const n = typeof zone === "number" ? zone : Number(zone.replace(/^Z/, ""));
  return n === 7 || n === 8;
}

/**
 * How many stretches the lap is divided into for the per-tenth metrics.
 *
 * Named here because `tenthOf` below divides by it and two scorers bucket
 * against it, so three places have to agree on what a tenth is.
 */
export const TENTHS = 10;

/** One era's weighting over the kit, and the targets it is scored on. */
export interface Preset {
  /** Which vocabulary this preset dresses from. */
  readonly vocabulary: Vocabulary;
  /**
   * The gap-CV band for a repeating family: clumped, but not clumped into
   * uselessness.
   *
   * Per preset because the floor has to sit below the LOWEST gap CV
   * MEASURED in the vocabulary it scores — any higher and the metric
   * fails a faithful reproduction of a real archetype. The named kit's
   * lowest puts that floor at 1.2. The geometry kit's is `enclosure` at
   * 1.12, measured over 592 objects, so the same rule puts its floor at
   * 1.0.
   *
   * That is the whole argument, and it is deliberately NOT "where our
   * sampler lands": a floor that follows the implementation cannot fail
   * it. What the rule excludes is METRONOMIC placement, which sits below
   * 0.4. Everything above the vocabulary's own measured minimum is a
   * rhythm something in the source material actually has.
   *
   * THE FLOOR IS NOT THE TARGET, which is the mistake this band invited
   * once already. The like-for-like target is the PER-ARCHETYPE median
   * gap CV, 1.78 for the geometry kit over a spread of 1.12 to 2.63. It
   * is not the 2.21 this comment used to quote: that figure is measured
   * per source name-family over 3,014 families, and a family is a sparse
   * subset of an archetype, so its gaps are longer and more variable.
   * Different granularity, not a different answer.
   *
   * The sampler reaches it now. `CV = sqrt(2m - 1)` caps near 1.41 at the
   * measured cluster sizes and that formula is right — it just describes
   * a HOMOGENEOUS process, and the source material is not homogeneous.
   * The density envelope supplies the rest; see `envelope`, which reads
   * 1.81 against the measured 1.78 over thirty seeds. This band stays
   * wide because it scores a distribution and not a point, but nothing
   * in this kit is leaning on its floor any more.
   */
  readonly gapCvAccept: readonly [number, number];
  /**
   * Archetypes excluded from the corridor-art score.
   *
   * Four rows of the named kit pool source families whose measured
   * position or size disagree with each other, so their published
   * envelope describes no real family. A `verge-rail` mixes an overhead
   * gantry that intrudes on 96% of its instances at `|t|` 0.08–0.58W with
   * a `zig` at 20% and 2.65–3.18W and a `zigzag` at 0%. Scoring a chimera
   * against a rate measured from real objects is comparing two different
   * things, so the rows upstream records as defective are left out of
   * this metric — and only this one. They are still placed, still drawn,
   * and still counted everywhere else.
   *
   * IT IS THE POOLING THAT JUSTIFIES THIS, NOT THE INTRUSION RATE, and
   * the difference matters because the rate argument was wrong twice.
   * `verge-rail` was reported as intruding on 23 of 23 instances and then
   * as "cannot not intrude"; it measures 52%, and both earlier figures
   * came from a draw over a bounded envelope or from arithmetic done in
   * the wrong half-width. `camera-post` looked worse still at 90% and is
   * NOT here, because it measures 61% and its ladder reproduces 61%
   * exactly — cameras sit at the verge, which is what they are. Across
   * all nineteen rows the quartile envelopes carry 16.0 points of mean
   * absolute error against measured intrusion and the ladders 6.3, so a
   * row that looks impossible under an envelope is usually a sampling
   * artefact rather than a defect. Check the ladder before excluding
   * anything.
   */
  readonly corridorArtExclude?: readonly string[];
  /**
   * The share of placements allowed to put their BOX in the driver's slab
   * inside one half-width — the corridor-clear-of-art band.
   *
   * The originals' own rate, not zero, because the originals do this and a
   * target of zero rejects a faithful reproduction. It is a BOX figure and
   * must stay one: the same predicate measured on real polygons reads
   * about half, and scoring a template — which carries extents and no
   * geometry — against the polygon figure marks it wrong by 2x.
   *
   * Which band a preset takes follows from its sprite share, which is the
   * cleanest discriminator between the eras: the late recipe contains no
   * camera-facing quads at all, where the earlier two spend a quarter of
   * their placements on them.
   */
  readonly corridorArtAccept: number;

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
  /**
   * Mean geometric cluster size across the kit.
   *
   * WHAT THE PUBLISHED CLUSTER TABLES ARE, since it cost a rewrite to
   * find out. The spec quotes clusters per 100W, mean instances per
   * cluster and a size distribution, all found by grouping placements at
   * a 1.5W threshold. At roughly one placement per W that threshold
   * chains most neighbours together whatever the process produced, so a
   * homogeneous Poisson process at the same density reproduces almost the
   * whole table on its own: 21.3 clusters per 100W against a measured
   * 19.3 for the late era, mean 4.38 against 4.90, single-instance
   * clusters 24% against 23%.
   *
   * They are VALIDATION statistics, not a specification. Constructing a
   * generator from them double-counts — explicit clumps are placed and
   * then the threshold finds those plus the merging it would have done
   * anyway — and a generator built that way reads an index of dispersion
   * of about 4.2 at a 2W window against a measured 1.36. Both teams
   * measured that number independently and got the same answer.
   *
   * The information in the tables is the EXCESS over the Poisson null,
   * which is small and lives in the gaps rather than in the counts. The
   * generative target is the dispersion curve.
   */
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
  /**
   * The STEP between a cluster's members along the lap, in W.
   *
   * Measured, and it took two corrections to get right. It began as one
   * constant of 0.55W for every era. Then it was set to the median
   * cluster SPAN — 0.23, 0.45 and 0.61W — which is a different quantity:
   * a span is a step times one less than the size, and the pooled median
   * span is dominated by two-member clusters, so using it as a step
   * happened to be close and for the wrong reason. Broken out by size,
   * the span grows linearly and the step is stable: 0.37W in the
   * earliest era, 0.54 in the sparsest and 0.48 in the latest.
   *
   * A step rather than a span is also the right shape for a linear
   * offset, which is what the graph applies. The two agree at size two
   * and diverge everywhere else, which is exactly where the earlier
   * version was wrong without looking wrong.
   */
  readonly clusterSpanW: number;
  /**
   * Depth of the periodic density envelope. Zero is flat and 1 is as deep
   * as the harmonic sum goes before it would ask for a negative density;
   * past that it is still meaningful and clips against the floor under
   * the intensity, which is where the late preset sits and why the cost
   * of that is spelled out below.
   *
   * It is also the term that carries the gap rhythm, which is not obvious
   * from the name. A cluster process with exponential gaps and a
   * geometric cluster size gives `CV = sqrt(2m - 1)`, which at the
   * geometry kit's measured m of about 1.5 caps near 1.41 — short of that
   * kit's measured per-archetype median of 1.78. The formula is right and
   * describes a HOMOGENEOUS process; the source material is not
   * homogeneous, and the density varying along the lap contributes gap CV
   * of its own. Clustering gets most of the way and this depth carries
   * the rest.
   *
   * MEASURED ON THE LATE PRESET, thirty seeds per point, correction loop
   * on, everything else held: depth 1.0 gives a gap CV of 1.32 and a
   * per-tenth density CV of 0.25; 1.4 gives 1.54 and 0.31; 1.8 gives 1.81
   * and 0.37. Monotone in both, so here the depth is the knob and the
   * cluster size is not.
   *
   * WHY THAT PRESET SITS AT 1.8. The depth is a free parameter of this
   * sampler — nothing measures it, and upstream's own figures are in its
   * generator's normalisation rather than in ours — while the gap CV is
   * measured. So the depth goes where the measurement comes out: that
   * kit's per-archetype median gap CV is 1.78 and this reads 1.81. The
   * per-tenth density CV lands at 0.37, mid-band against the 0.25–0.6
   * the source material measures, where at 0.7 this preset read 0.20 and
   * was shallower than the thing it reproduces.
   *
   * WHAT IT COSTS is stated rather than hidden. The harmonic sum reaches
   * a peak amplitude of 1, so any depth past 1.0 asks for a negative
   * density somewhere and meets the floor under the intensity instead.
   * At 1.8 that is about a ninth of the lap sitting at the floor. The
   * two coverage metrics are the guard and they hold with room: 94% of
   * the lap stays within 2W of a placement and the longest empty stretch
   * runs 5.7W against a limit of 34W, because the fill pass closes
   * anything past 12W.
   *
   * WHY IT SURVIVED D-5 BEING WITHDRAWN. The rule this knob was first
   * justified by is gone: the source has no density envelope, and the
   * lumpiness D-5 measured is the clustering rule's, at a coarser scale.
   * The arithmetic that keeps it is the between-cluster gap CV. Group any
   * lap's placements at the 1.5W threshold and the gaps that survive are
   * all longer than 1.5W, so for a Poisson anchor process the gap CV
   * cannot exceed `1 - 1.5 / meanGap` — about 0.74 at the measured
   * cluster rate of roughly 19 per 100W. This lap reads 0.73, which is
   * that ceiling. The source reads 1.02 and 1.06.
   *
   * A Poisson process cannot produce those, so something in the material
   * spaces its clusters more variably than chance, and an envelope on the
   * anchor intensity is the cheapest thing that does. The knob is not
   * reproducing a measured envelope — there is none — it stands in for
   * whatever produces that over-dispersion, and it is set where the gap
   * CV per archetype comes out right.
   *
   * THE DEPTH RESONATES WITH THE TRACK, which is worth knowing before
   * anyone nudges this. Left/right balance is clean over thirty seeds at
   * 1.0, 1.4 and 1.8 and fails on a third to a half of them at 1.2 and
   * 1.6 — a deterministic function of depth with seed noise on top, not
   * noise. A deeper envelope concentrates placements into fewer arcs of
   * the lap, and which corners those arcs land on is fixed by the track,
   * so some depths pile onto same-handed bends faster than the balance
   * pass can answer. Move this knob and re-measure metric 9; do not read
   * a nearby value as equivalent.
   *
   * THE TWO NAMED PRESETS ARE LEFT SHALLOW, and it is a known shortfall
   * rather than a judgement that they are fine. Over six seeds they read
   * 0.23 and 0.22 per tenth, just under that same 0.25 floor. Deepening
   * is not the fix for them: swept over 0.6 to 1.15 the sparse preset
   * reads 0.23, 0.32, 0.26, 0.28, 0.28 — no monotone at all, so whatever
   * governs its density variation is not this. Finding out what is comes
   * before turning a knob that demonstrably does not move it.
   */
  readonly envelope: number;
  /** Per-archetype rate multipliers: the era's taste. */
  readonly kitBias: Readonly<Record<string, number>>;
  /** Per-archetype multipliers on the lateral envelope. */
  readonly lateralPush: Readonly<Record<string, number>>;
}

/**
 * The named kit's rows whose published envelope pools source families
 * that disagree, so it describes no real object.
 *
 * A property of the VOCABULARY rather than of any preset that draws from
 * it — both named presets exclude exactly these, and the geometry preset
 * cannot. Named once so the two lists cannot drift apart when a row is
 * renamed or a fifth defect is found. See `corridorArtExclude` for what
 * the exclusion buys and what it deliberately does not.
 */
export const NAMED_POOLED_ROWS: readonly string[] = [
  "verge-rail",
  "pipe-run",
  "billboard",
  "enclosure-shell",
];

/**
 * Three presets. The numbers are placement statistics, not art: what
 * changes between them is how much gets placed, how far out, how tightly
 * grouped and how much the kit leans on one part of itself.
 */
export const PRESETS: Readonly<Record<string, Preset>> = {
  sparse: {
    clusterSpanW: 0.54,
    gapCvAccept: [1.2, 2.6],
    corridorArtExclude: NAMED_POOLED_ROWS,
    vocabulary: "named",
    // 15.5% and not 17.1%: the era's rate re-derived after a
    // normalisation bug upstream, where three measurement scripts each
    // divided a lateral offset by a different half-width and one anchored
    // objects at their own origin rather than their bounds centre.
    //
    // This preset missed it by five points for one commit, and the two
    // archetypes that looked responsible were neither defective nor
    // cornered: `camera-post` measures 61% intrusion and its LADDER
    // reproduces 61%, where the bounded envelope produced 90%. The whole
    // shortfall was the sampler. It reads 14.4% now.
    corridorArtAccept: 0.155,
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
    clusterSpanW: 0.37,
    gapCvAccept: [1.2, 2.6],
    corridorArtExclude: NAMED_POOLED_ROWS,
    vocabulary: "named",
    corridorArtAccept: 0.155,
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
    clusterSpanW: 0.48,
    gapCvAccept: [1.0, 2.6],
    vocabulary: "geometry",
    // 0.13 and not 0.322, which is the single largest correction this
    // preset has taken. The era's scenery vertex array was being read as
    // plain triples where it is 12-byte PAIRS, so every bounding box a
    // scrambled quad had stretched was too big and every corridor figure
    // taken through one was inflated. Corrected, this era intrudes on the
    // corridor LESS than the earlier pair — 11.1% against 15.5% — which
    // is the opposite of what the inflated boxes said, and the ceiling
    // was roughly three times too generous. Real geometry in the driver's
    // slab reads 6.2% and not 17.8%.
    //
    // EXPECT THIS TO SCORE RED, and read it as the joint rather than as a
    // regression. The ladders are marginals: drawing `|t|` and `across`
    // independently puts about 24.9% of side placements over the corridor
    // against a measured 14.8%, a ten-point excess where the inflated
    // extents had suggested three or four. A 0.13 ceiling does not
    // accommodate that and should not be widened to. The fix is a boolean
    // subtract against the swept corridor volume, which trims the art
    // rather than moving the anchor; until the library has one, the
    // honest lever is the corridor-height rule and not either ladder,
    // because moving a marginal to fix a joint is what put a spelling
    // artefact in the band mix the last time it was tried.
    corridorArtAccept: 0.13,
    spriteShare: 0.0,
    spriteAccept: [0, 0.05],
    polysPerW: 18.8,
    polysAccept: 15,
    familiesAccept: [60, 160],
    largestFamilyCap: 0.15,
    minInstances: 3,
    density: 0.97,
    densityAccept: [0.8, 1.25],
    // Measured over all 7,372 objects of the era this preset reproduces,
    // where these used to be the EARLIER era's authored targets — the one
    // place a geometry-vocabulary preset was still fitted against a named
    // -vocabulary number.
    //
    // Re-derived twice: once after a normalisation bug upstream, where an
    // object's position in the track frame is its lateral offset over a
    // half-width and three measurement scripts each picked a different
    // one, and again after the vertex-array misreading that regenerated
    // the whole vocabulary. The band mix moved far less than the corridor
    // rate did under the second correction — tenths of a point, against a
    // factor of three — because a band is decided by where a thing is
    // ANCHORED and the misreading distorted how big it is.
    //
    // Exact counts over 7,372: over 1130, verge 562, near 2129, mid 2583,
    // far 930, distant 38. Carried to five places because they sum to
    // 1.00000 that way and to 0.999 rounded, and the fitter reads the sum.
    bands: { over: 0.15328, verge: 0.07623, near: 0.2888, mid: 0.35038, far: 0.12615, distant: 0.00515 },
    clusterMean: 1.18,
    coverageFloor: 0.85,
    maxGapW: 25,
    maxFillGapW: 8,
    outsideShare: 0.61,
    outsideAccept: [0.55, 0.72],
    bankMaxDeg: 14.3,
    referenceRadiusW: 7,
    envelope: 1.8,
    // EMPTY, and that is the correction rather than an omission. This
    // preset carried seven `kitBias` entries and five `lateralPush` ones,
    // and not one of the twelve had ever applied: both are read as
    // `[a.id] ?? 1`, keyed by archetype id, and every key in them named a
    // NAMED-vocabulary row — `terrain-shell`, `set-piece`, `wall-panel`,
    // `tree-group`, `bush`, `tree`, `verge-rail`, `billboard`, `dome` —
    // while this preset draws from the geometry vocabulary and never sees
    // any of them. Twelve numbers that read as tuning and were a
    // fall-through to 1.
    //
    // The same class as the band targets above, found the same way and
    // one round later: a geometry-vocabulary preset still spelled in the
    // named vocabulary. Nothing replaces them, because nothing measured
    // says the corrected clustering wants a per-archetype weighting, and
    // an honest absence beats seven invented numbers.
    kitBias: {},
    lateralPush: {},
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

/**
 * How many times the closed loop generates before it keeps the best.
 *
 * Three, and the number is a measurement rather than a taste: the first
 * pass is reliably off, the second answers most of it, and the third is
 * where the remainder either lands or turns out to be noise. A harder
 * track can want more — the different-track suite runs five, because a
 * twistier lap pins more placements inside bends and the balance pass
 * needs longer to lean a stretch far enough to register.
 */
export const REFINE_PASSES = 3;

export const CORRIDOR = {
  /**
   * How small a piece has to be for "inside the corridor" to describe it
   * rather than "around it". Larger art whose bounds centre lands on the
   * racing line is a wall across it; smaller art is the furniture the
   * source really does put over the track, and it rises instead.
   */
  smallAcrossW: 1,
  smallTallW: 1.5,
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
  return Math.min(TENTHS - 1, Math.floor(lapMod(station, lapW) / (lapW / TENTHS)));
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
