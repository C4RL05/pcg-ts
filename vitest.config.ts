import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    passWithNoTests: true,
    /**
     * SIXTY SECONDS, BECAUSE FIVE WAS A CLAIM ABOUT UNIT TESTS AND THIS
     * SUITE IS NOT ONLY THAT.
     *
     * Vitest defaults to 5 s. Most of this suite finishes in single-digit
     * milliseconds and never notices. But `tests/` cooks procedural
     * geometry — a racetrack lap is a spline, a station process, eight
     * repair rules run to a fixed point and a few thousand boxes — and the
     * slowest test WITHOUT its own timeout takes 7.7 s alone. `src/gpu`'s
     * device suites round-trip real buffers through a real adapter.
     *
     * WHAT THAT PRODUCED IS A RED SUITE ON A GREEN TREE. A full run puts
     * 205 files across parallel workers on one machine; a test needing
     * 1.5 s alone gets a fraction of a core and blows the 5 s bound.
     *
     * AND THE MACHINE IS NOT DEDICATED, which is the half that makes a
     * tight bound untenable rather than merely unlucky. A developer box
     * runs the suite while its owner is using it — a browser with WebGPU
     * live is the case to picture, since this repo's own demos are exactly
     * that and contend for the same adapter the device suites need. CI is
     * no better: a shared runner's neighbours are invisible. So the
     * available CPU is not a property of the test, and a bound tuned to a
     * quiet machine is a bound that fails on a real one. The
     * failures read `Error: Test timed out in 5000ms` — the assertion
     * never ran, so nothing was ever wrong with the code — and they move
     * between runs, so the same commit passes and fails. Three were known
     * and treated as folklore: `src/gpu/parity.device.test.ts`'s
     * hash/u32 streams, `racetrackAssetGraph`'s vocabulary check and
     * `racetrackCornerBookkeeping`'s double-take check. All three are this
     * and nothing else.
     *
     * A flake nobody can fix teaches everyone to re-run without looking,
     * which is how a real failure gets waved through.
     *
     * WHY NOT A TIMEOUT PER SLOW TEST, which was the first plan: it fixes
     * the tests that are slow TODAY and the next lap-cooking test written
     * lands straight back here. The bound belongs where the workload is
     * described, not sprinkled over forty call sites.
     *
     * THE COST, STATED: a test that genuinely hangs now takes 60 s to say
     * so instead of 5. That is the trade, and it is the right way round —
     * a hang is a bug someone will investigate either way, where a
     * spurious timeout is a bug nobody can investigate at all. Tests that
     * are legitimately long still declare their own bound and are stricter
     * than this (`racetrackBlockFill` asks for 300 s, `racetrackLevels`
     * for 120 s); this is the floor under everything that has no opinion.
     */
    testTimeout: 60_000,
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
