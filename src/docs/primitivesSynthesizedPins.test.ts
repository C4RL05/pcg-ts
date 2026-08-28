/**
 * The outputs a `repeatUntil` primitive has that its RECIPE does not.
 *
 * `repeatUntil` declares two output pins on top of whatever the body
 * exposes — `rounds` (how many times it cooked) and `converged` (did the
 * settle signal reach zero, or did it hit `maxRounds`). The body cannot
 * declare them; it cannot see how many times it has run. They are the only
 * way to tell a settled result from a truncated one, which is why the node
 * has them at all.
 *
 * `describeSubgraphPins` reported the EXPOSED pins and only those, so those
 * two never reached `PrimitiveInfo` and never reached the catalog. The
 * failure is not "the docs are thin": the catalog is what an agent reads to
 * find out what a primitive can be wired to, and it was stating a smaller
 * interface than the node has — an agent following it would conclude there
 * is no way to ask whether the relaxation converged, and wire around the
 * absence.
 *
 * They are reported as ORDINARY outputs carrying a `synthesized` flag rather
 * than in a separate list, and the flag is present-or-absent rather than
 * true-or-false. Both halves of the fact are load-bearing — it can be read,
 * and it is not the body's, so it will not be found among the recipe's
 * exposed outputs and does not move when those are renamed — and one flagged
 * entry says both without making every consumer join two arrays to ask "what
 * can I read off this node".
 *
 * `forEach` is the control that keeps the rule honest in the other
 * direction: it synthesizes NOTHING (its outputs are exactly
 * `prepareWrapper`'s), so it must gain no flagged pin. Nor may a plain
 * `subgraph`. Nothing in the shipped vocabulary is a loop body — all 37
 * registered primitives are plain subgraphs — so the fixtures are built
 * here, as they are for the wrapper-kind suite next door.
 *
 * REGISTRY ISOLATION: vitest gives each test file its own module registry,
 * so the `test/` names below never reach primitives.test.ts, whose drift
 * check renders the committed catalog from whatever is registered.
 */
import { describe, expect, it } from "vitest";

import {
  registerForEachBody,
  registerPlainBody,
  registerRepeatUntilBody,
} from "../nodes/loopBodyRecipe.testsupport.js";
import { describePrimitive, renderPrimitiveCatalog } from "./primitives.js";

// Registered once, at module scope: the registry has no public unregister.
const REPEAT = registerRepeatUntilBody("test/relax");
const FOR_EACH = registerForEachBody("test/per-item");
const PLAIN = registerPlainBody("test/plain");

describe("describePrimitive — wrapper-synthesized outputs reach the catalog", () => {
  it("reports repeatUntil's rounds and converged, flagged and after the body's", () => {
    const info = describePrimitive(REPEAT);
    expect(info.outputs).toEqual([
      // The body's own, unflagged, with the kind resolved from the inner pin.
      { name: "carry", kind: "geometry" },
      // The loop's, in the order the def declares them.
      { name: "rounds", kind: "value", synthesized: true },
      { name: "converged", kind: "value", synthesized: true },
    ]);
    // Inputs are untouched: no wrapper in the library synthesizes one.
    expect(info.inputs).toEqual([{ name: "carry", kind: "geometry" }]);
  });

  it("flags nothing on a forEach or a plain subgraph", () => {
    // The control. A rule that appended every declared pin not found among
    // the exposed ones would be indistinguishable from the right one on the
    // repeatUntil case alone — these two are where it would show.
    for (const entry of [FOR_EACH, PLAIN]) {
      const info = describePrimitive(entry);
      expect(info.inputs.some((p) => p.synthesized === true)).toBe(false);
      expect(info.outputs.some((p) => p.synthesized === true)).toBe(false);
      // Absent, not `false`: an ordinary pin still deep-equals { name, kind }.
      for (const pin of [...info.inputs, ...info.outputs]) {
        expect(Object.hasOwn(pin, "synthesized")).toBe(false);
      }
    }
    expect(describePrimitive(FOR_EACH).outputs).toEqual([{ name: "out", kind: "geometry" }]);
    expect(describePrimitive(PLAIN).outputs).toEqual([{ name: "out", kind: "geometry" }]);
  });

  it("renders the flag into both catalog files", () => {
    const catalog = renderPrimitiveCatalog([REPEAT, FOR_EACH, PLAIN].map(describePrimitive));
    // Markdown says WHO declared the pin, in the reader's words.
    expect(catalog.markdown).toContain(
      "**Outputs:** `carry` (geometry), `rounds` (value, wrapper), `converged` (value, wrapper)",
    );
    // The plain entry's line is unchanged — no empty parenthetical, no
    // trailing comma, nothing added to an entry that synthesizes nothing.
    expect(catalog.markdown).toContain("**Outputs:** `out` (geometry)");

    const parsed = JSON.parse(catalog.json) as {
      name: string;
      outputs: { name: string; kind: string; synthesized?: boolean }[];
    }[];
    const relax = parsed.find((p) => p.name === "test/relax");
    expect(relax?.outputs).toEqual([
      { name: "carry", kind: "geometry" },
      { name: "rounds", kind: "value", synthesized: true },
      { name: "converged", kind: "value", synthesized: true },
    ]);
    // And the key is absent from an ordinary pin in the JSON too, which is
    // what keeps every committed catalog entry byte-identical: no shipped
    // primitive is a loop body, so none of them gains a key.
    const plain = parsed.find((p) => p.name === "test/plain");
    expect(plain?.outputs).toEqual([{ name: "out", kind: "geometry" }]);
  });
});
