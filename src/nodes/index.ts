/**
 * Standard node library: registry and authoring layer, declarative field
 * JSON, graph JSON serialization, and the standard nodes (sources,
 * samplers, point ops, filtering, attribute ops, value plumbing).
 * Importing this module registers every standard node type.
 */
export * from "./registry.js";
export * from "./fieldJson.js";
export * from "./subgraphParams.js";
export * from "./serialize.js";
// The factory only: `ITERATION_MODE`/`MAX_ITERATIONS` and the internals
// beside it are this module's business, not the package's.
export { forEachNode } from "./forEach.js";
// Named exports rather than `export *`: the registry's test doors
// (`__resetSubgraphRegistry`, `__defineSubgraphUnchecked`) and its
// serialization-internal helpers are deliberately not part of the package.
export {
  getRegisteredSubgraph,
  hasRegisteredSubgraph,
  listSubgraphs,
  registerSubgraph,
  subgraphContentHash,
  type RegisteredSubgraph,
  // The element types of a SubgraphRegistrationSpec. Exported so a caller
  // can NAME them — build a `RegistrationPin[]` in a helper, type a
  // parameter — rather than only pass matching object literals inline.
  type RegistrationNodeRef,
  type RegistrationParam,
  type RegistrationPin,
  type SubgraphRegistrationSpec,
} from "./subgraphRegistry.js";
export * from "./sources.js";
export * from "./meshes.js";
export * from "./surfaces.js";
export * from "./samplers.js";
export * from "./paths.js";
export * from "./topology.js";
export * from "./neighborhood.js";
export * from "./pointOps.js";
export * from "./filtering.js";
export * from "./attributes.js";
export * from "./mathNodes.js";
