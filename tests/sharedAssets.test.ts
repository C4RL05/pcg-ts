/**
 * The viewer's asset vocabulary, listed as data and kept honest.
 *
 * `shared/assets.ts` answers "what can this viewer draw?" twice: once as
 * live three.js meshes, which is what the pages need, and once as
 * `PLACEHOLDER_ASSET_IDS`, which is what a script or a terminal needs so
 * the answer can be compared against `pcg assets <graph.json>` without a
 * rendering context. Two answers to one question drift, so this asserts
 * they are the same set — in BOTH directions, which is what makes it a
 * check rather than a reminder: an id added to the map and not to the
 * list fails, and so does the reverse.
 *
 * Lives in `tests/` for the reason `sandboxKnobs.test.ts` gives: the
 * browser pages sit outside vitest's `src/**` include.
 *
 * It deliberately does NOT assert anything about the corpus. Thirteen of
 * the nineteen asset ids the shipped graphs name have no entry here, and
 * that is BY DESIGN rather than a gap — the module's own header explains
 * why a viewer of arbitrary graphs invents a distinct stand-in instead of
 * refusing an id it does not know. Pinning that number would turn a
 * deliberate fallback into a thing nobody may touch.
 */
import { describe, expect, it } from "vitest";
import { PLACEHOLDER_ASSET_IDS, createPlaceholderAssets } from "../shared/assets.js";

describe("the viewer's asset vocabulary", () => {
  it("lists exactly the ids the asset map registers", () => {
    const built = Object.keys(createPlaceholderAssets().known).sort();
    expect(built).toEqual([...PLACEHOLDER_ASSET_IDS].sort());
  });

  it("names each id once", () => {
    expect(new Set(PLACEHOLDER_ASSET_IDS).size).toBe(PLACEHOLDER_ASSET_IDS.length);
  });

  it("is unaffected by the mono option, which restyles rather than removes", () => {
    const mono = Object.keys(createPlaceholderAssets({ mono: true }).known).sort();
    expect(mono).toEqual([...PLACEHOLDER_ASSET_IDS].sort());
  });
});
