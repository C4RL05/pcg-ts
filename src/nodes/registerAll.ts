/**
 * Evaluation-order anchor for the standard node library.
 *
 * Every standard node registers itself as a top-level side effect of its
 * defining module (`export const x = standardNode({...})`). Under plain
 * ES-module semantics, `import "../nodes/index.js"` is enough to run all
 * of them — but bundler code splitting builds cross-chunk import edges
 * from the *symbols* a chunk actually uses, and a side-effect-only
 * dependency can be re-emitted after code that needs the registry
 * populated. That exact failure shipped once: in the built package, the
 * chunk holding the primitive registrations (whose recipes name standard
 * node types, resolved eagerly by `registerSubgraph`) evaluated before
 * the chunk holding the standard-node modules, so importing
 * `pcg-ts/primitives` (or the CLI, or the docs tooling) alone crashed
 * with `unknown node type "setAttribute"`.
 *
 * Importing one exported *value* from each standard-node module — and
 * using it below, so no tree shaker drops the import — turns that
 * ordering into symbol edges, which code splitting does preserve. Any
 * top-level code that needs standard node types resolvable (today: the
 * primitive registrations in `src/primitives/index.ts`) must call
 * {@link ensureStandardNodesRegistered} first.
 */
import { setAttribute } from "./attributes.js";
import { filterByDensity } from "./filtering.js";
import { valueConstant } from "./mathNodes.js";
import { meshPrimitive } from "./meshes.js";
import { pointNeighborhood } from "./neighborhood.js";
import { pointsToPath } from "./paths.js";
import { transformPoints } from "./pointOps.js";
import { hasNodeType } from "./registry.js";
import { surfaceSample } from "./samplers.js";
import { pointGrid } from "./sources.js";
import { sweepProfile } from "./surfaces.js";
import { connectPoints } from "./topology.js";
import { occlusionCull } from "./visibility.js";
import { pathCoverage } from "./coverage.js";
import { runFit } from "./runs.js";

/**
 * One value per standard-node module. Keep this list in sync with the
 * module list in `./index.ts`: a module missing here can legally be
 * evaluated *after* the caller, resurrecting the ordering bug for the
 * node types it defines.
 */
const MODULE_WITNESSES: readonly { readonly type: string }[] = [
  pointGrid, // sources.ts
  meshPrimitive, // meshes.ts
  sweepProfile, // surfaces.ts
  surfaceSample, // samplers.ts
  pointsToPath, // paths.ts
  connectPoints, // topology.ts
  pointNeighborhood, // neighborhood.ts
  transformPoints, // pointOps.ts
  filterByDensity, // filtering.ts
  setAttribute, // attributes.ts
  valueConstant, // mathNodes.ts
  occlusionCull, // visibility.ts
  pathCoverage, // coverage.ts
  runFit, // runs.ts
];

/**
 * Assert that every standard-node module has evaluated (and therefore
 * registered its node types). Because this module imports a value from
 * each of them, the assertion cannot fire under correct module ordering;
 * if it does fire, the build's chunking broke evaluation order and the
 * fix belongs in the bundler config, not the caller.
 */
export function ensureStandardNodesRegistered(): void {
  for (const witness of MODULE_WITNESSES) {
    if (!hasNodeType(witness.type)) {
      throw new Error(
        `standard node type "${witness.type}" is missing from the registry even though its defining module was imported — ` +
          "the build reordered module evaluation (a code-splitting bug); rebuild with a config that preserves " +
          "symbol-level import order, and check dist entry chunks with the dist smoke test (scripts/smoke-dist.mjs)",
      );
    }
  }
}
