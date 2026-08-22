/**
 * Which measured circuit the demo dresses from.
 *
 * WHY THIS IS A NAMED CHOICE AND NOT A PATH IN A TEST. The first exemplar
 * was picked for reuse and coherence and never checked against the
 * population on anything else, and it turned out to sit at or beyond the
 * edge on six separate figures — straightness above p90, density above
 * the median, the worst band mix of twenty-two, and a curvature response
 * twice as steep as typical. Every caveat that arrived for a week was a
 * symptom of that one decision.
 *
 * So the circuit a generator learns from is a decision worth naming,
 * recording the reason for, and being able to change in one place.
 */

/** The kits available, and what each is good and bad at. */
export const KITS = {
  /**
   * A vegetation circuit — palms, bushes, trees. Second-best band mix of
   * the twenty-two, a curvature response of 1.06 straight-to-tight
   * against a population 1.33, and all four affinity buckets inside the
   * per-circuit band. Lower reuse (1.58) and fewer repeats than
   * `street`, which costs a little vocabulary depth.
   */
  vegetation: "vegetation-kit.json",
  /**
   * Street furniture, and a richer kit at 2.15 reuse — but the most
   * atypical circuit of the twenty-two on band mix, and a straight-to-
   * tight of 2.97 against a population 1.33. Kept for comparison, and
   * because work was done against it, NOT as the thing to learn from.
   */
  street: "street-kit.json",
  /**
   * The most ENCLOSED of the twenty-two, at 43% of its lap running under
   * cover against a population median of 10.5%.
   *
   * Here because neither of the others can exercise L-6 at all: vegetation
   * is 2% enclosed with a longest covered stretch of 0.9W, and its eight
   * overhead objects are thin arches — CURLY_SURROUND is 3.9W across and
   * 0.43W along. A rule cannot be developed against a circuit that never
   * triggers it, and a validator scoring vegetation for enclosure is
   * measuring the exemplar, not the generator.
   *
   * Atypical in the other direction, and the same caution applies to it
   * as to the others: 43% is above the rule's own 10-25% ceiling. It is
   * the circuit L-6 is BUILT against, not the one its target comes from.
   *
   * ITS COVER IS NOT AN ASSET. 126 separate objects hold it up and the
   * largest single one is 5.9% of it; HPIP62 is 4.59 x 5.83 x 2.05W and
   * appears 22 times. Enclosure here is a placement PATTERN — a run of
   * repeated pieces over a station range — which is why L-6 is built as
   * one and not as a search for a tunnel model.
   */
  enclosed: "enclosed-kit.json",
} as const;

/** The one the demo and its gates use. See KITS for why. */
export const DEFAULT_KIT: keyof typeof KITS = "vegetation";

/**
 * The one L-6 is developed and gated against.
 *
 * SEPARATE FROM `DEFAULT_KIT` ON PURPOSE. Every other rule here is tested
 * on the circuit the demo actually dresses, which is the honest way round
 * — but enclosure cannot be, because that circuit has almost none. Naming
 * the exception is better than quietly switching the default and moving
 * every other figure in the suite along with it.
 */
export const ENCLOSURE_KIT: keyof typeof KITS = "enclosed";
