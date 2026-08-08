/**
 * The noise grammar's shared tables: the names a JSON spec may use for a
 * noise factory, and the worley outputs it may name.
 *
 * ONE table, read by both ends of the round trip — the spec DERIVERS
 * (`fbm`, and the factories themselves through `makeNoiseField`) and the
 * spec PARSER (`src/nodes/fieldJson.ts`). Two copies could drift, and a
 * deriver that accepts a name the parser does not produces a spec
 * `fieldFromJson` rejects: a graph that saves and cannot be reopened.
 *
 * Import direction is one-way — this module imports the four samplers,
 * and no sampler imports it — so there is no cycle. {@link WORLEY_OUTPUTS}
 * is therefore defined in `worley.ts` (next to the union it mirrors) and
 * re-exported here, so consumers outside `src/noise` still have a single
 * import site for both tables.
 */
import { perlinNoise } from "./perlin.js";
import { simplexNoise } from "./simplex.js";
import type { NoiseFactory } from "./util.js";
import { valueNoise } from "./value.js";
import { worleyNoise } from "./worley.js";

export { WORLEY_OUTPUTS } from "./worley.js";

/**
 * The noise factories the grammar names, keyed by the name it uses. A base
 * outside this table cannot be named in a spec, so an `fbm` over one
 * derives no `fbm` spec of its own.
 *
 * The key is also each factory's own `NoiseSpecInfo.fn` (its `listFieldFns`
 * entry); `noise.test.ts` pins that correspondence, which is what lets
 * `fbm` recover a base's grammar name from the spec its field carries.
 */
export const NOISE_BASES: Readonly<Record<string, NoiseFactory>> = {
  valueNoise,
  perlinNoise,
  simplexNoise,
  worleyNoise,
};
