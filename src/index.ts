export const VERSION = "0.17.0";

export * from "./data/index.js";
export * from "./random/index.js";
export * from "./fields/index.js";
export * from "./noise/index.js";
// src/spatial is deliberately NOT re-exported: it is the shared index the
// spatial nodes are built on, not a promise to callers. Exporting it later
// costs nothing; un-exporting it would be a breaking change, so it stays
// internal until something outside the library actually needs it.
export * from "./graph/index.js";
export * from "./nodes/index.js";
export * from "./spawn/index.js";
export * from "./runtime/index.js";
// Named rather than starred through `./nodes/index.js`, because it is the
// one node-layer module that reads BOTH sides of the spawner seam: the graph
// walk lives with the other graph reports, and the question it answers is a
// spawn question. The names are the whole module, so a star would say the
// same thing with one less place to notice it.
export {
  type AssetIdOrigin,
  type DescribedSpawner,
  // Named even though `DescribedSpawner` is the entry point: `open`'s
  // element type is what a consumer branches on, and a field whose type
  // cannot be written down is a field that gets copied into a local
  // interface instead of read.
  type OpenAssetSet,
  describeGraphAssets,
} from "./nodes/graphAssets.js";
