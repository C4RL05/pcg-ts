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
} as const;

/** The one the demo and its gates use. See KITS for why. */
export const DEFAULT_KIT: keyof typeof KITS = "vegetation";
