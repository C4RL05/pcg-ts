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
    alias: {
      "pcg-ts/three": here("../src/three/index.ts"),
      "pcg-ts": here("../src/index.ts"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: here("index.html"),
        "01-scatter-basic": here("01-scatter-basic/index.html"),
        "02-forest": here("02-forest/index.html"),
        "03-spline-fence": here("03-spline-fence/index.html"),
        "04-infinite-world": here("04-infinite-world/index.html"),
        "05-fields-playground": here("05-fields-playground/index.html"),
      },
    },
  },
});
