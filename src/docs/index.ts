/**
 * Build tooling: renderers that turn registry metadata into the generated
 * catalogs under `docs/`. This is a build entry (see tsup.config.ts) so
 * `scripts/` has a built path to import; it is deliberately absent from
 * `src/index.ts` and from package.json's `exports` map, so none of it is
 * public API. See node-reference.ts for the full rationale.
 */
export * from "./node-reference.js";
export * from "./primitives.js";
