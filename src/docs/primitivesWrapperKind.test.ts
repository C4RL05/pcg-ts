/**
 * The primitive catalog on a recipe whose body was written for a LOOP.
 *
 * THE DEFECT THIS GUARDS is the sibling of the one in
 * `src/cli/primitiveRunWrapperKind.test.ts`, and it is literally the same
 * defect: `describePrimitive` probed every registry entry with a hardcoded
 * `type: "subgraph"`, so a body exposing a reserved pin name was refused by
 * the reserved-name guard. Two call sites had it; a fix demonstrated
 * through one of them is half a fix, which is why this file exists as well
 * as that one.
 *
 * It matters more here than "the docs would be missing an entry". This
 * probe is how the catalog reads the DERIVED param schemas — the half a
 * recipe deliberately does not carry — so it is also the check that every
 * registered primitive still loads. One loop-body primitive in the shipped
 * vocabulary would have taken down the whole `npm run docs` chain, and the
 * message would have named a node called "probe" that exists nowhere.
 *
 * Verified to fail before the fix: `describePrimitive` on the repeatUntil
 * body threw `node "probe": a "subgraph" node cannot expose input "carry"
 * ...`, and on the forEach body the `each` equivalent.
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
const FOR_EACH = registerForEachBody("test/per-item");
const REPEAT = registerRepeatUntilBody("test/relax");
const PLAIN = registerPlainBody("test/plain");

describe("describePrimitive — the probe's node type is inferred, not assumed", () => {
  it("describes a forEach body instead of refusing it", () => {
    // Before the fix this threw, and nothing about the recipe was wrong:
    // the probe's type was.
    const info = describePrimitive(FOR_EACH);
    expect(info.name).toBe("test/per-item");
    // The pin KINDS are the half a recipe does not carry, re-derived from
    // the live instance — which is the whole reason this probe exists, so
    // they are asserted rather than just the names.
    expect(info.inputs).toEqual([{ name: "each", kind: "geometry" }]);
    expect(info.outputs).toEqual([{ name: "out", kind: "geometry" }]);
  });

  it("describes a repeatUntil body instead of refusing it", () => {
    const info = describePrimitive(REPEAT);
    expect(info.name).toBe("test/relax");
    expect(info.inputs).toEqual([{ name: "carry", kind: "geometry" }]);
    // The recipe exposes one output; the node HAS three. `rounds` and
    // `converged` are the loop's own report and are catalogued as such —
    // see primitivesSynthesizedPins.test.ts, which is about that alone.
    expect(info.outputs).toEqual([
      { name: "carry", kind: "geometry" },
      { name: "rounds", kind: "value", synthesized: true },
      { name: "converged", kind: "value", synthesized: true },
    ]);
  });

  it("still describes an ordinary primitive", () => {
    // The control: a probe that stopped writing "subgraph" altogether
    // would satisfy the two cases above and break every shipped entry.
    const info = describePrimitive(PLAIN);
    expect(info.inputs.map((p) => p.name)).toEqual(["pts"]);
    expect(info.outputs.map((p) => p.name)).toEqual(["out"]);
  });

  it("renders all three into one catalog, so the whole chain survives a loop body", () => {
    // The generator maps describePrimitive over the WHOLE registry, so one
    // unprobeable entry took the entire catalog with it rather than
    // degrading to a missing section.
    const infos = [FOR_EACH, PLAIN, REPEAT].map(describePrimitive);
    const catalog = renderPrimitiveCatalog(infos);
    for (const name of ["test/per-item", "test/plain", "test/relax"]) {
      expect(catalog.markdown).toContain(name);
      expect(catalog.json).toContain(name);
    }
    // Valid JSON, not just a string containing the names.
    expect(Array.isArray(JSON.parse(catalog.json))).toBe(true);
  });
});
