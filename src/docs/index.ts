/**
 * Build tooling: renderers that turn registry metadata and the example
 * corpus into the generated catalogs under `docs/`, plus the corpus CI's
 * shared cook-and-reduce path. This is a build entry (see tsup.config.ts)
 * so `scripts/` has a built path to import; it is deliberately absent
 * from `src/index.ts` and from package.json's `exports` map, so none of
 * it is public API. See node-reference.ts for the full rationale.
 *
 * Note that importing this module registers the shipped primitives, as a
 * side effect of `corpus.ts` (which needs them to resolve `ref` nodes).
 * Harmless for the catalog generators — they read their own registries —
 * and it is what lets `scripts/gen-corpus-golden.mjs` be I/O only.
 */
export * from "./node-reference.js";
export * from "./primitives.js";
export * from "./examples.js";
export * from "./corpus.js";
