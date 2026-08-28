/**
 * Spawner protocol: render-agnostic instance batches built from point
 * clouds, plus the spawnInstances graph terminal. The `InstanceBatch` and
 * `InstancesItem` types themselves live in `src/graph/data.ts` (they are
 * part of the graph's data-item union) and are re-exported from the graph
 * module. Importing this module registers the spawnInstances node type.
 */
// Named rather than `export *`: instances.js also exports MAX_INSTANCES,
// the per-cook instance cap. It is exported from its own module for two
// internal readers — `spawnInstances`' description, which quotes the
// live number rather than repeating a literal, and the GPU run planner
// (src/gpu/run.ts), which enforces the same budget so the fallback
// raises the identical message. Neither is a caller outside the library,
// and the two caps of the same value and same purpose — `MAX_EDGES` in
// src/nodes/topology.ts and `MAX_RESAMPLE_POINTS` in src/nodes/paths.ts
// — are plain module-private consts. Publishing one of the three said
// the wrong thing about which limits are API. See publicSurface.test.ts.
export {
  type BuildInstanceBatchesOptions,
  buildInstanceBatches,
  composeTRS,
} from "./instances.js";
export * from "./spawnNode.js";
