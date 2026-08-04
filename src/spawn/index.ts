/**
 * Spawner protocol: render-agnostic instance batches built from point
 * clouds, plus the spawnInstances graph terminal. The `InstanceBatch` and
 * `InstancesItem` types themselves live in `src/graph/data.ts` (they are
 * part of the graph's data-item union) and are re-exported from the graph
 * module. Importing this module registers the spawnInstances node type.
 */
export * from "./instances.js";
export * from "./spawnNode.js";
