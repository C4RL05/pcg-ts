import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

// The repository root is the vite project root, because the pages it serves
// no longer share a parent: the editor is a tool (`editor/`), the demos are
// hosts for things that need one (`demos/*/`), and the preview page is a
// render target for `scripts/preview.mjs` (`preview/`). Source is imported
// directly (no build step) via aliases so every page exercises the current
// src/.
export default defineConfig({
  root: here("."),
  plugins: [svelte()],
  resolve: {
    // One entry per subpath in package.json#exports that a page can
    // import, longest first: these are prefix matches, so a bare "pcg-ts"
    // above the others would swallow every subpath and resolve
    // `pcg-ts/primitives` to `src/index.ts/primitives`.
    alias: {
      "pcg-ts/primitives": here("./src/primitives/index.ts"),
      "pcg-ts/three": here("./src/three/index.ts"),
      "pcg-ts/gpu": here("./src/gpu/index.ts"),
      "pcg-ts": here("./src/index.ts"),
    },
  },
  build: {
    // NOT vite's default of `<root>/dist`. The root is the repository root,
    // so the default would point at the LIBRARY's dist/ — and because that
    // path is inside the root, `emptyOutDir` defaults to true there: a bare
    // `vite build` would delete the published build. Naming the Pages output
    // here means the destructive default is never reachable.
    // NOT "docs/demos": this holds the editor and the four demos, so
    // naming it after one of the five was wrong twice over. It also cannot be named after any SOURCE directory — vite
    // roots at the repository root, so the output mirrors the repo, and
    // an outDir of `docs/demos` put the galaxy at `docs/demos/demos/galaxy`.
    outDir: "docs/pages",
    rollupOptions: {
      input: {
        // No root entry: the demo shelf that used to live here is gone, and
        // the landing page it was a lesser copy of is hand-written in
        // `docs/` rather than built. So the build has one page per thing
        // that actually needs building, and `/pages/` itself is not a page.
        editor: here("editor/index.html"),
        "infinite-world": here("demos/infinite-world/index.html"),
        galaxy: here("demos/galaxy/index.html"),
        "gpu-world": here("demos/gpu-world/index.html"),
        racetrack: here("demos/racetrack/index.html"),
      },
    },
  },
});
