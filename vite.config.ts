import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { type Plugin, defineConfig } from "vite";

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * Serve the landing page at `/` on the dev server, as the built site does.
 *
 * The two roots agree on every path but this one. Published, `docs/` IS
 * the site root, so the hand-written landing page is at `/pcg-ts/` and a
 * demo two levels below it at `/pcg-ts/demos/<id>/`. On the dev server the
 * root is the repository, the same demo is at `/demos/<id>/` — two levels
 * down again — but two levels up is the repository root, where there is no
 * page at all.
 *
 * That one difference used to be a branch in `shared/wordmark.ts`, which
 * had to work out at runtime which root it was in. Every way of asking is
 * a bad one: the pathname no longer carries a marker now that the build
 * emits the same paths the dev server does, guessing at `/pcg-ts/` breaks
 * on a fork or a custom domain, and `import.meta.env.PROD` is not the
 * build's own answer — vite folds `NODE_ENV` into it, so a shell exporting
 * `NODE_ENV=development` makes a production build claim it is a dev one.
 * That is a silently wrong link in a committed artifact, which is worse
 * than any of the alternatives.
 *
 * So instead of teaching the pages about the difference, remove it. A
 * REDIRECT rather than serving the file at `/`, because the landing page's
 * own links are relative to `docs/`: served under `/` its thumbnails and
 * its logo would 404, and the address bar would lie about where the page
 * is.
 */
function landingPageAtRoot(): Plugin {
  return {
    name: "pcg-landing-page-at-root",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== "/" && req.url !== "/index.html") return next();
        res.writeHead(302, { Location: "/docs/index.html" });
        res.end();
      });
    },
  };
}

// The repository root is the vite project root, because the pages it serves
// no longer share a parent: the editor is a tool (`editor/`), the demos are
// hosts for things that need one (`demos/*/`), and the preview page is a
// render target for `scripts/preview.mjs` (`preview/`). Source is imported
// directly (no build step) via aliases so every page exercises the current
// src/.
export default defineConfig({
  root: here("."),
  plugins: [svelte(), landingPageAtRoot()],
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
    // The site GitHub Pages serves. The built pages land BESIDE the
    // hand-written ones, so a demo is published at `/pcg-ts/demos/<id>/`
    // and the editor at `/pcg-ts/editor/` — the same paths the dev server
    // uses. This was `docs/pages` once, which put a segment in every
    // published URL that named the build step rather than the thing, and
    // made the two roots' paths differ for no reason a reader could see.
    //
    // NOT vite's default of `<root>/dist`: the root is the repository
    // root, so the default would point at the LIBRARY's dist/ and — the
    // path being inside the root — empty it. Naming the output here means
    // that is never reachable.
    //
    // The output MIRRORS THE REPO, because vite roots at the repository
    // root: `editor/index.html` becomes `docs/editor/`, `demos/galaxy/`
    // becomes `docs/demos/galaxy/`. So this can never be named after a
    // source directory — an outDir of `docs/demos` put the galaxy at
    // `docs/demos/demos/galaxy`.
    outDir: "docs",
    // `docs/` also holds the landing page, the manual, the generated
    // catalogs, the thumbnails and the logo, none of which this build
    // produces. Emptying it would delete the site in order to publish the
    // site. `scripts/clean-pages.mjs` removes exactly the directories this
    // build owns instead, which is what keeps stale hashed assets from
    // accumulating.
    emptyOutDir: false,
    rollupOptions: {
      input: {
        // No root entry: the demo shelf that used to live here is gone,
        // and the landing page it was a lesser copy of is `docs/index.html`,
        // hand-written rather than built. The build has one page per thing
        // that actually needs building — and now that the output IS `docs/`,
        // a root entry would overwrite that landing page with a generated
        // one, so there must never be one.
        editor: here("editor/index.html"),
        "infinite-world": here("demos/infinite-world/index.html"),
        galaxy: here("demos/galaxy/index.html"),
        "gpu-world": here("demos/gpu-world/index.html"),
        road: here("demos/road/index.html"),
        "simple-road": here("demos/simple-road/index.html"),
      },
    },
  },
});
