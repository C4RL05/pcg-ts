/**
 * `pcg-ts/primitives` — the shipped vocabulary. **Importing this module
 * registers every primitive**, which is why it is its own subpath export
 * rather than part of `pcg-ts`: a corpus that registers on import would
 * otherwise be unshakeable weight in every bundle, and `import "pcg-ts"`
 * must keep costing nothing.
 *
 * ```ts
 * import "pcg-ts/primitives";           // registers them
 * import { deserializeGraph } from "pcg-ts";
 * deserializeGraph(graphReferencing("fill/scatter-even"));
 * ```
 *
 * The CLI (`pcg run`, `pcg validate`, `pcg cook`) and the catalog
 * generator import it for exactly that reason: names are resolved inside
 * `deserializeGraph`, which reads a global registry, so a tool that does
 * not import this module reports an empty registry while the primitives
 * sit unreachable in the package.
 *
 * **Registration order is a dependency order, not a stylistic one.** A
 * recipe that references another primitive by name is canonicalized at
 * registration, which materializes the reference — so the referenced name
 * must already be registered. Five primitives nest today, three across
 * family modules (which fixes the call order below) and two within one
 * module (which fixes the order of the `definePrimitive` calls inside it):
 * `place/on-surface` -> `write/height-slope`, `place/plantable` ->
 * `place/on-surface`, `fill/scatter-by-density` ->
 * `filter/thin-by-density`, `filter/by-distance-to-curve` ->
 * `filter/by-distance-to`, and `shape/path-loop` -> `shape/ring`.
 */
import { ensureStandardNodesRegistered } from "../nodes/registerAll.js";
import { registerComposePrimitives } from "./compose.js";
import { registerFillPrimitives } from "./fill.js";
import { registerFilterPrimitives } from "./filter.js";
import { registerPlacePrimitives } from "./place.js";
import { registerShapePrimitives } from "./shape.js";
import { registerTransformPrimitives } from "./transform.js";
import { registerWritePrimitives } from "./write.js";

export {
  PRIMITIVE_FAMILIES,
  type PrimitiveFamily,
  type PrimitiveParamDecl,
  type PrimitiveSpec,
  definePrimitive,
  primitiveFamily,
} from "./define.js";

// The recipes below name standard node types, and definePrimitive resolves
// those names eagerly (registerSubgraph validates them at registration).
// This call is a symbol-level dependency on every standard-node module, so
// bundler code splitting cannot evaluate this module first — a bare
// side-effect import can be reordered, a used symbol cannot. See
// src/nodes/registerAll.ts for the shipped failure this prevents.
ensureStandardNodesRegistered();
// write first: place/on-surface references write/height-slope.
registerWritePrimitives();
// filter next: fill/scatter-by-density references filter/thin-by-density.
registerFilterPrimitives();
registerShapePrimitives();
registerFillPrimitives();
registerTransformPrimitives();
registerComposePrimitives();
// place last: it references write/height-slope through place/on-surface.
registerPlacePrimitives();
