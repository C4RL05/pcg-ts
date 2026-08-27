/**
 * {@link inferWrapperKind} — the one answer to "which wrapper was this
 * recipe written for", shared by the three places that MATERIALIZE a
 * registered recipe: `registerSubgraph`'s canonicalizing probe, `pcg run`'s
 * synthesized wrapper, and the primitive catalog's probe.
 *
 * It is unit-tested here, apart from those three, because it is the piece
 * that has no other way to be wrong. The call sites can only demonstrate
 * the answers a recipe they happen to hold produces; this file states the
 * whole function, including the `carry`-beats-`each` precedence, which no
 * shipped recipe reaches and which reversed would send an author to the
 * wrong pin.
 */
import { describe, expect, it } from "vitest";

import { CARRIED_PIN_NAMES, ITERATED_PIN_NAMES, inferWrapperKind } from "./subgraph.js";

const pins = (...names: string[]): { readonly name: string }[] => names.map((name) => ({ name }));

describe("inferWrapperKind", () => {
  it("reads a plain subgraph when no reserved name appears", () => {
    expect(inferWrapperKind({ inputs: pins("pts", "mask"), outputs: pins("out") })).toBe("subgraph");
    expect(inferWrapperKind({ inputs: [], outputs: [] })).toBe("subgraph");
  });

  it("reads forEach from every iterated name, on the input side only", () => {
    // Driven off the exported set rather than a literal list, so adding a
    // third spelling to ITERATED_PIN_NAMES cannot leave this behind.
    for (const name of ITERATED_PIN_NAMES) {
      expect(inferWrapperKind({ inputs: pins(name), outputs: pins("out") })).toBe("forEach");
    }
    // The iterated names are reserved on the INPUT side. An output called
    // "each" is a body that emits something the author named badly, not a
    // forEach body, and reading it as one would refuse a legal recipe.
    expect(inferWrapperKind({ inputs: pins("pts"), outputs: pins("each") })).toBe("subgraph");
  });

  it("reads repeatUntil from a carried name on either side", () => {
    for (const name of CARRIED_PIN_NAMES) {
      expect(inferWrapperKind({ inputs: pins(name), outputs: pins("out") })).toBe("repeatUntil");
      // Reserved on BOTH sides, because the loop matches its carried
      // output to its carried input by name: an output called "carry" on
      // any other wrapper is a body written for this loop.
      expect(inferWrapperKind({ inputs: pins("pts"), outputs: pins(name) })).toBe("repeatUntil");
    }
  });

  it("lets the carried name win over the iterated one, so the refusal names the collision", () => {
    // A body carrying "carry" AND "each" is neither loop, and it is the
    // repeatUntil probe whose refusal says so by name. The other order
    // would report the same body as a malformed forEach and point the
    // author at the wrong pin.
    expect(inferWrapperKind({ inputs: pins("each", "carry"), outputs: pins("out") })).toBe(
      "repeatUntil",
    );
    expect(inferWrapperKind({ inputs: pins("each"), outputs: pins("carry") })).toBe("repeatUntil");
  });

  it("is a pure function of the NAMES, and reads nothing else", () => {
    // The callers hold three different spellings of an exposed pin —
    // SerializedExposedPin, DescribedSubgraphPin, and the CLI's bare name
    // list — so anything read beyond `name` would make one of them
    // uncallable. Extra keys must be inert.
    const rich = { inputs: [{ name: "each", node: "xf", pin: "in", kind: "geometry" }], outputs: [] };
    expect(inferWrapperKind(rich)).toBe("forEach");
  });
});
