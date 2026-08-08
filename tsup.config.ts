import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/three/index.ts",
    "src/gpu/index.ts",
    "src/cli/index.ts",
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
