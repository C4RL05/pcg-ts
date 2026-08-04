import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// examples/ is the vite project root; source is imported directly (no build
// step) via aliases so examples always exercise the current src/.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      "pcg-ts/three": fileURLToPath(new URL("../src/three/index.ts", import.meta.url)),
      "pcg-ts": fileURLToPath(new URL("../src/index.ts", import.meta.url)),
    },
  },
});
