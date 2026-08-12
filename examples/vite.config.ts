import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

// examples/ is the vite project root; source is imported directly (no build
// step) via aliases so examples always exercise the current src/.
export default defineConfig({
  root: here("."),
  plugins: [svelte()],
  resolve: {
    // One entry per subpath in package.json#exports that a page can
    // import, longest first: these are prefix matches, so a bare "pcg-ts"
    // above the others would swallow every subpath and resolve
    // `pcg-ts/primitives` to `src/index.ts/primitives`.
    alias: {
      "pcg-ts/primitives": here("../src/primitives/index.ts"),
      "pcg-ts/three": here("../src/three/index.ts"),
      "pcg-ts/gpu": here("../src/gpu/index.ts"),
      "pcg-ts": here("../src/index.ts"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: here("index.html"),
        "01-sandbox": here("01-sandbox/index.html"),
        "02-infinite-world": here("02-infinite-world/index.html"),
        "03-galaxy": here("03-galaxy/index.html"),
        "04-gpu-fields": here("04-gpu-fields/index.html"),
        "05-gpu-world": here("05-gpu-world/index.html"),
        "06-rig-playground": here("06-rig-playground/index.html"),
      },
    },
  },
});
