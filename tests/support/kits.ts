/**
 * Which measured circuit a suite draws from, and where to find it.
 *
 * WHY THIS IS A NAMED CHOICE AND NOT A PATH IN A TEST. The first exemplar
 * was picked for reuse and coherence and never checked against the
 * population on anything else, and it turned out to sit at or beyond the
 * edge on six separate figures — straightness above p90, density above
 * the median, the worst band mix of the set, and a curvature response
 * twice as steep as typical. Every caveat that arrived for a week was a
 * symptom of that one decision. So the circuit a generator learns from is
 * worth naming, recording the reason for, and being able to change in one
 * place.
 *
 * AND WHY THE PATHS ARE NOT IN THE REPOSITORY. The kits are measurements
 * of a commercial product, taken locally, and neither their filenames nor
 * the machine they sit on belongs in a public checkout — the filenames
 * name the product and the paths named one developer's D: drive. Both
 * were in tracked test files until this file replaced them.
 *
 * The kits are addressed here by WHAT THEY ARE. A local manifest maps
 * those names to files; without one, every suite that needs a kit skips,
 * which is the case for almost everyone including CI.
 *
 *   road-kits.local.json   (gitignored, at the repository root)
 *   {
 *     "dir": "<absolute directory holding the kit files>",
 *     "vegetation": "<filename>",
 *     "street":     "<filename>",
 *     "enclosed":   "<filename>"
 *   }
 *
 * `ROAD_KITS` overrides the manifest's location if it is somewhere else.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The kits a suite may ask for, and what each is good and bad at. */
export const KITS = {
  /**
   * A vegetation circuit — palms, bushes, trees. Second-best band mix of
   * the set, a curvature response of 1.06 straight-to-tight against a
   * population 1.33, and all four affinity buckets inside the
   * per-circuit band. Lower reuse (1.58) and fewer repeats than
   * `street`, which costs a little vocabulary depth.
   */
  vegetation: "the vegetation circuit",
  /**
   * Street furniture, and a richer kit at 2.15 reuse — but the most
   * atypical circuit of the set on band mix, and a straight-to-tight of
   * 2.97 against a population 1.33. Kept for comparison, and because work
   * was done against it, NOT as the thing to learn from.
   */
  street: "the street-furniture circuit",
  /**
   * The most ENCLOSED of the set, at 43% of its lap running under cover
   * against a population median of 10.5%.
   *
   * Here because neither of the others can exercise L-6 at all: the
   * vegetation circuit is 2% enclosed with a longest covered stretch of
   * 0.9W, and its eight overhead objects are thin arches. A rule cannot
   * be developed against a circuit that never triggers it, and a
   * validator scoring that circuit for enclosure is measuring the
   * exemplar rather than the generator.
   *
   * Atypical in the other direction, and the same caution applies: 43% is
   * above the rule's own 10-25% ceiling. It is the circuit L-6 is BUILT
   * against, not the one its target comes from.
   */
  enclosed: "the enclosed circuit",
} as const;

export type KitKey = keyof typeof KITS;

/** The one the demo and most gates use. See KITS for why. */
export const DEFAULT_KIT: KitKey = "vegetation";

/**
 * The one L-6 is developed and gated against.
 *
 * SEPARATE FROM `DEFAULT_KIT` ON PURPOSE. Every other rule is tested on
 * the circuit the demo actually dresses, which is the honest way round —
 * but enclosure cannot be, because that circuit has almost none. Naming
 * the exception beats quietly switching the default and moving every
 * other figure in the suite with it.
 */
export const ENCLOSURE_KIT: KitKey = "enclosed";

interface Manifest {
  readonly dir?: string;
  readonly [key: string]: string | undefined;
}

let cached: Manifest | null | undefined;

function manifest(): Manifest | null {
  if (cached !== undefined) return cached;
  const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const at = process.env.ROAD_KITS ?? join(root, "road-kits.local.json");
  cached = existsSync(at) ? (JSON.parse(readFileSync(at, "utf8")) as Manifest) : null;
  return cached;
}

/**
 * Where this kit is on THIS machine, or undefined if it is not here.
 *
 * Undefined is the ordinary case and never an error: the kits are not
 * redistributable, so a checkout that has none is the expected one. Every
 * suite that needs a kit is `describe.skipIf(!kitPath(...))`.
 */
export function kitPath(key: KitKey): string | undefined {
  const m = manifest();
  const file = m?.[key];
  if (!m || !file) return undefined;
  const full = m.dir && !isAbsolute(file) ? join(m.dir, file) : file;
  return existsSync(full) ? full : undefined;
}
