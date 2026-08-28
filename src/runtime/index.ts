/**
 * Hierarchical runtime: viewpoint-driven streaming of grid-level cells
 * with budgeted, cancellable, deterministic cooking. Importing this
 * module registers the `dataInput` node type.
 */
export * from "./types.js";
export * from "./dataInput.js";
export * from "./patches.js";
// reach.js is deliberately NOT re-exported. `neighborReach` is worth
// having on the public surface — it is the read a test writes by hand
// today — but publishing it is a reviewed act here (src/publicSurface
// pins the root surface name by name), and un-exporting is breaking where
// exporting later is free. The World's own halo validation imports it
// directly, and so can a test.
export * from "./world.js";
