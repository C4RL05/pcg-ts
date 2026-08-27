/**
 * `pcg run <name>` on a primitive whose body was written for a LOOP.
 *
 * THE DEFECT THIS GUARDS. `buildWrapperGraph` used to write `type:
 * "subgraph"` as a literal, so a recipe exposing a reserved pin name was
 * refused by the reserved-name guard before it could cook — with a message
 * naming a node called "main" that the caller never wrote, about a "type"
 * the caller has no way to set. `pcg run` was simply unable to run a
 * `forEach` or `repeatUntil` primitive. It stayed latent because no shipped
 * primitive is a loop body, which is why the fixture is built (see
 * loopBodyRecipe.testsupport.ts) rather than drawn from the corpus.
 *
 * Verified to fail before the fix: both cases below threw
 * `node "main": a "subgraph" node cannot expose "each" ...` and the
 * `carry` equivalent, at the first `deserializeGraph`.
 *
 * The sibling half of this is `src/docs/primitivesWrapperKind.test.ts` —
 * the same bug stood at two call sites, and a fix demonstrated through one
 * of them is half a fix.
 */
import { describe, expect, it } from "vitest";

import { deserializeGraph, getSubgraphSpec } from "../index.js";
import {
  registerForEachBody,
  registerPlainBody,
  registerRepeatUntilBody,
} from "../nodes/loopBodyRecipe.testsupport.js";
import { WRAPPER_NODE_ID, buildWrapperGraph } from "./primitiveRun.js";
import { EXIT_OK, runCli } from "./index.js";
import type { CliIo } from "./io.js";

// Registered once, at module scope: the registry is global module state
// with no public unregister, so a per-test registration would throw on the
// second one. vitest gives each test FILE its own module registry, so these
// names are invisible to every other suite.
const FOR_EACH = registerForEachBody("test/per-item");
const REPEAT = registerRepeatUntilBody("test/relax");
registerPlainBody("test/plain");

/** The wrapper `pcg run` synthesizes for a registered entry, materialized. */
function wrapperFor(name: string, inputs: readonly string[], outputs: readonly string[]) {
  const graph = deserializeGraph(
    buildWrapperGraph({
      name,
      exposedInputs: inputs,
      // Nothing bound, which is the case the bug lived in: the wrapper's
      // TYPE has to come from the full exposed interface, not from what
      // `--in` happened to wire.
      boundInputs: [],
      outputs,
      params: {},
    }),
  );
  return getSubgraphSpec(graph.require(WRAPPER_NODE_ID).def);
}

describe("pcg run — the wrapper's node type is inferred, not assumed", () => {
  it("wraps a forEach body in a forEach, not a subgraph", () => {
    expect(FOR_EACH.subgraph.inputs.map((p) => p.name)).toEqual(["each"]);
    // Before the fix this line threw. After it, the wrapper resolves to the
    // loop the body was written for — the difference between one cook over
    // the concatenated collection and one cook per element.
    expect(wrapperFor("test/per-item", ["each"], ["out"])?.wrapper).toBe("forEach");
  });

  it("wraps a repeatUntil body in a repeatUntil, not a subgraph", () => {
    expect(REPEAT.subgraph.inputs.map((p) => p.name)).toEqual(["carry"]);
    expect(REPEAT.subgraph.outputs.map((p) => p.name)).toEqual(["carry"]);
    expect(wrapperFor("test/relax", ["carry"], ["carry"])?.wrapper).toBe("repeatUntil");
  });

  it("still wraps an ordinary primitive in a plain subgraph", () => {
    // The control. A rule that simply stopped writing "subgraph" would
    // satisfy both cases above and break every primitive that ships.
    expect(wrapperFor("test/plain", ["pts"], ["out"])?.wrapper).toBe("subgraph");
    expect(buildWrapperGraph({
      name: "test/plain",
      exposedInputs: ["pts"],
      boundInputs: [],
      outputs: ["out"],
      params: {},
    }).nodes[0].type).toBe("subgraph");
  });

  it("reads the type off the FULL exposed interface, not the bound subset", () => {
    // `--in` binds a subset, and a forEach primitive run with no --in
    // binds nothing at all. Inferring from `boundInputs` would give
    // "subgraph" in exactly the common case, which is the shape the
    // original bug had.
    const wrapper = buildWrapperGraph({
      name: "test/per-item",
      exposedInputs: ["each"],
      boundInputs: [],
      outputs: ["out"],
      params: {},
    });
    expect(wrapper.nodes[0].type).toBe("forEach");
    expect(wrapper.nodes).toHaveLength(1);
  });

  it("runs one end to end, through the real command", async () => {
    // The unit assertions above go through `buildWrapperGraph` directly.
    // This one goes through argv, so a caller in commands.ts that forgot to
    // pass the exposed inputs would still be caught.
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIo = {
      out: (t) => void out.push(t),
      err: (t) => void err.push(t),
      readFile: () => {
        throw new Error("no file should be read");
      },
      writeFile: () => {
        throw new Error("no file should be written");
      },
    };
    const code = await runCli(["run", "test/per-item", "--json"], io);
    expect(err.join("")).toBe("");
    expect(code).toBe(EXIT_OK);
    const report = JSON.parse(out.join("")) as { outputs: Record<string, unknown[]> };
    // Nothing is bound to `each`, so the loop iterates over an empty
    // collection and emits nothing. The assertion that matters is that it
    // COOKED — before the fix this exited non-zero on the reserved name.
    expect(Object.keys(report.outputs)).toEqual(["out"]);
  });
});
