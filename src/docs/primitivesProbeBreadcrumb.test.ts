/**
 * What a REFUSAL reached through the catalog says.
 *
 * `describePrimitive` materializes each registry entry by wrapping it in a
 * one-node graph it synthesizes, and the loader leads every failure with the
 * offending node's id. For a node the caller wrote, that id is the most
 * useful word in the message. For this one it is the least: the node is
 * called "probe", it is built and thrown away inside the function, and it
 * appears in no recipe, no saved graph and no catalog. So the message opened
 * by naming something the reader could not find and could not act on —
 * the exact inverse of the rule in CLAUDE.md that an error names the
 * offending node, pin or param.
 *
 * The registry's own probe had TWO THIRDS of the answer (`canonicalize`
 * strips its breadcrumb before re-framing under `registerSubgraph
 * "<name>"`), and the catalog's had none of it. Two thirds, not all, and the
 * shortfall is the argument for one helper rather than two copies of a
 * regexp: the old pattern matched `node "recipe": ` and `node "recipe" inner
 * graph: ` and nothing else, so every message qualified by WHICH exposed
 * declaration failed still leaked. Sharing it fixed that leak in
 * `registerSubgraph` too — pinned in subgraphRegistry.test.ts, which had
 * only ever asserted the useful half of that message. The rule is not
 * obvious enough to be re-derived correctly twice: it drops `inner graph`
 * along with the id (the message behind it already names the inner node) and
 * keeps every other qualifier, which is the author's own content.
 *
 * MEASURED BEFORE THE FIX, all three through this same file:
 *   node "probe": repeatUntil: no carried output. ...
 *   node "probe": unknown subgraph "test/never-registered"; ...
 *   node "probe" subgraph inputs[0] ("pts"): unknown inner node "nope"; ...
 *
 * WHY THE FIXTURES USE THE UNCHECKED DOOR. Two of the three shapes need a
 * registry entry that does not materialize, and `registerSubgraph` refuses
 * exactly those at registration — it canonicalizes through the same probe
 * and infers the same wrapper, so a recipe that survives registration
 * survives description. That is not a reason to leave the path unguarded:
 * the catalog's probe is also the check that every registered primitive
 * still LOADS (see the header of primitives.ts), so this is the channel by
 * which a broken primitive is reported, and it is the message a `npm run
 * docs` failure would print. The third shape needs no door at all —
 * `describePrimitive` takes a `RegisteredSubgraph` value, and one whose name
 * is not in the registry is reachable through the public API alone.
 *
 * REGISTRY ISOLATION: vitest gives each test file its own module registry,
 * so the `test/` names below never reach primitives.test.ts, whose drift
 * check renders the committed catalog from whatever is registered.
 */
import { describe, expect, it } from "vitest";

import { Graph } from "../graph/index.js";
import { transformPoints } from "../nodes/pointOps.js";
import { serializeGraph } from "../nodes/serialize.js";
import { __defineSubgraphUnchecked, getRegisteredSubgraph } from "../nodes/subgraphRegistry.js";
import { describePrimitive } from "./primitives.js";

/** A one-node body, serialized — the smallest thing a recipe can wrap. */
function body(): ReturnType<typeof serializeGraph> {
  const inner = new Graph(5);
  inner.add(transformPoints, { translate: [1, 0, 0] }, "t");
  return serializeGraph(inner);
}

/** The message `describePrimitive` threw, or a failure if it did not throw. */
function refusalFor(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected describePrimitive to refuse, but it returned");
}

describe("describePrimitive — a refusal names the primitive, never the probe", () => {
  it("re-frames a structural refusal under the primitive's name", () => {
    // A body exposing "carry" on the input side only. `inferWrapperKind`
    // reads it as a repeatUntil, and `repeatUntilNode` then refuses it for
    // having no carried OUTPUT — a real structural complaint about the
    // recipe, arriving with the probe's id in front of it.
    __defineSubgraphUnchecked("test/half-carry", {
      graph: body(),
      inputs: [{ name: "carry", node: "t", pin: "in" }],
      outputs: [{ name: "out", node: "t", pin: "out" }],
    });
    const message = refusalFor(() => describePrimitive(getRegisteredSubgraph("test/half-carry")));

    // Nothing in the message may name the scaffolding.
    expect(message).not.toContain("probe");
    // It leads with the handle the caller HAS — the registered name.
    expect(message).toMatch(/^describePrimitive\("test\/half-carry"\): repeatUntil: no carried output\./);
    // And the loader's own advice survives the re-framing intact: the
    // stripper takes the breadcrumb, not the diagnosis.
    expect(message).toContain('Exactly one exposed output must be named "carry"');
    expect(message).toContain('Exposed outputs here: "out"');
  });

  it("re-frames an unresolvable name, reachable with no test door", () => {
    const message = refusalFor(() =>
      describePrimitive({
        name: "test/never-registered",
        subgraph: { graph: body(), inputs: [], outputs: [{ name: "out", node: "t", pin: "out" }] },
        hash: "0000000000000000",
      }),
    );
    expect(message).not.toContain("probe");
    // Not an exact match: the tail lists whatever is registered, which is a
    // function of how far this file has run.
    expect(message).toMatch(
      /^describePrimitive\("test\/never-registered"\): unknown subgraph "test\/never-registered"; registered subgraphs: /,
    );
  });

  it("keeps the qualifier that names the caller's own declaration", () => {
    // The half of the breadcrumb that is NOT scaffolding. `subgraph
    // inputs[0] ("pts")` says which exposed declaration is at fault, and it
    // is the author's content, so it stays — only the `node "probe"` token
    // in front of it goes. A stripper that ate the whole first segment
    // would fix the leak by deleting the answer.
    __defineSubgraphUnchecked("test/bad-pin", {
      graph: body(),
      inputs: [{ name: "pts", node: "nope", pin: "in" }],
      outputs: [{ name: "out", node: "t", pin: "out" }],
    });
    const message = refusalFor(() => describePrimitive(getRegisteredSubgraph("test/bad-pin")));
    expect(message).not.toContain("probe");
    expect(message).toBe(
      'describePrimitive("test/bad-pin"): subgraph inputs[0] ("pts"): unknown inner node "nope"; ' +
        "inner nodes: t",
    );
  });

  it("keeps the original refusal as the cause", () => {
    // Re-framing is a message change, not a loss: the loader's own error
    // object is still reachable, so a caller that wants the type or the
    // stack has it.
    __defineSubgraphUnchecked("test/half-carry-2", {
      graph: body(),
      inputs: [{ name: "carry", node: "t", pin: "in" }],
      outputs: [{ name: "out", node: "t", pin: "out" }],
    });
    let caught: unknown;
    try {
      describePrimitive(getRegisteredSubgraph("test/half-carry-2"));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const cause = (caught as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    // The cause is the UNSTRIPPED original — it is evidence, not a duplicate
    // of the message above.
    expect((cause as Error).message).toContain('node "probe"');
  });
});
