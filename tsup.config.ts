import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/three/index.ts",
    "src/gpu/index.ts",
    "src/cli/index.ts",
    // The shipped vocabulary. Its own entry because importing it
    // REGISTERS every primitive: a corpus that registers on import must
    // not be unshakeable weight in `import "pcg-ts"`.
    "src/primitives/index.ts",
    // Off-thread cooking. The pool (worker/index) must be its own entry
    // so its `new URL("./entryNode.js", import.meta.url)` default keeps
    // resolving next to it in dist/worker/, and the two worker entries
    // must be real files a `Worker(url)` can load directly.
    "src/worker/index.ts",
    "src/worker/entryNode.ts",
    "src/worker/entryBrowser.ts",
    // Build tooling, not public API: `scripts/gen-node-reference.mjs` is
    // plain ESM and needs a built path to import the doc renderers from.
    // Absent from package.json's `exports` map on purpose.
    "src/docs/index.ts",
  ],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["three"],
});
