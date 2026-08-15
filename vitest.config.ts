import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    passWithNoTests: true,
  },
  // The same aliases `vite.config.ts` gives the browser pages, for the same
  // reason and with the same longest-first ordering: a test that covers a
  // page's own logic has to import the page, and a page imports the library
  // by PACKAGE NAME. Without these the specifier resolves through
  // package.json `exports` to `dist/`, which would make `npm test` depend on
  // a build and test yesterday's library. Nothing under `src/` imports
  // "pcg-ts", so these are inert for every other suite.
  resolve: {
    alias: {
      "pcg-ts/primitives": here("./src/primitives/index.ts"),
      "pcg-ts/three": here("./src/three/index.ts"),
      "pcg-ts/gpu": here("./src/gpu/index.ts"),
      "pcg-ts": here("./src/index.ts"),
    },
  },
});
