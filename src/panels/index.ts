/**
 * `pcg-ts/panels` — the panel spec format: a graph's control panel,
 * authored as a sidecar and validated here.
 *
 * Its own subpath, and not part of `import "pcg-ts"`, for the reason every
 * subpath here has one: nothing in the core cooks a graph any differently
 * because a panel exists, and a consumer that only generates content should
 * not carry a format only a host that RENDERS knobs can use.
 *
 * The one entry that is provably pure. There is no module-scope call, no
 * registration and no mutable module state anywhere under `src/panels`, so
 * `./dist/panels/index.js` is deliberately absent from package.json's
 * `sideEffects` array — a bundler is free to drop it when nothing is
 * imported from it. `tests/packaging.test.ts` re-derives that claim from
 * the source rather than trusting this comment, the same way it does for
 * `./three`.
 *
 * Everything in `spec.ts` is public, so a star: the module is the format,
 * and there is nothing in it a caller should not see.
 */
export * from "./spec.js";
