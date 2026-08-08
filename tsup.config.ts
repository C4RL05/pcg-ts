import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/three/index.ts", "src/gpu/index.ts", "src/cli/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["three"],
});
