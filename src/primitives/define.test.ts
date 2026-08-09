/**
 * `definePrimitive` itself: the four things it adds over
 * `registerSubgraph`, each tested by showing it going RED.
 *
 * A helper whose checks are only ever exercised by inputs that pass them
 * is indistinguishable from a helper with no checks at all — and every
 * shipped primitive passes, so the catalog cannot demonstrate any of this.
 * The registrations below therefore use names outside the seven families
 * wherever they are meant to fail, and `check/` names when they must
 * succeed. Vitest gives each test file its own module registry, so
 * nothing here reaches the catalog drift test or the shipped catalog.
 */
import { describe, expect, it } from "vitest";
import type { SerializedNode } from "../index.js";
import { PRIMITIVE_FAMILIES, definePrimitive, primitiveFamily } from "./define.js";

/** A trivial two-node recipe: a scatter into a jitter. */
function recipe(): { nodes: SerializedNode[]; connections: { from: [string, string]; to: [string, string] }[] } {
  return {
    nodes: [
      {
        id: "scatter",
        type: "pointScatterInBounds",
        params: { count: 20, boundsMin: [0, 0, 0], boundsMax: [4, 0, 4], seed: 0 },
      },
      { id: "jit", type: "jitterPoints", params: { amount: [0.2, 0, 0.2], seed: 0 } },
      { id: "prune", type: "selfPrune", params: { minDistance: 0.1 } },
    ],
    connections: [
      { from: ["scatter", "out"], to: ["jit", "in"] },
      { from: ["jit", "out"], to: ["prune", "in"] },
    ],
  };
}

let unique = 0;
/** A fresh `fill/` name, since the registry refuses duplicates. */
function freshName(): string {
  unique += 1;
  return `fill/check-${unique}`;
}

function define(name: string, params?: Parameters<typeof definePrimitive>[1]["params"]) {
  const { nodes, connections } = recipe();
  return definePrimitive(name, {
    title: "A check fixture",
    description: "A throwaway recipe registered by the definePrimitive unit tests, long enough to be legal.",
    nodes,
    connections,
    outputs: [{ name: "out", node: "prune", pin: "out" }],
    ...(params !== undefined ? { params } : {}),
  });
}

describe("the name is checked against the closed family set", () => {
  it("accepts <family>/<kebab-case> for every family", () => {
    for (const family of PRIMITIVE_FAMILIES) expect(primitiveFamily(`${family}/a-b2-c`)).toBe(family);
  });

  it("refuses a name with no slash, listing the families", () => {
    expect(() => primitiveFamily("scatterEven")).toThrow(/has no "\/"/);
    expect(() => primitiveFamily("scatterEven")).toThrow(/shape, fill, transform, compose, filter, place, write/);
  });

  it("refuses an invented family, naming it", () => {
    expect(() => primitiveFamily("scatter/grid")).toThrow(/"scatter" is not one of the seven families/);
  });

  it("refuses camelCase after the slash, which is how node types are spelled", () => {
    expect(() => primitiveFamily("fill/scatterEven")).toThrow(/is not kebab-case/);
    expect(() => primitiveFamily("fill/-leading")).toThrow(/is not kebab-case/);
    expect(() => primitiveFamily("fill/trailing-")).toThrow(/is not kebab-case/);
    expect(() => primitiveFamily("fill/double--dash")).toThrow(/is not kebab-case/);
    expect(() => primitiveFamily("fill/Upper")).toThrow(/is not kebab-case/);
  });

  it("refuses the empty leaf and the empty family", () => {
    expect(() => primitiveFamily("fill/")).toThrow(/is not kebab-case/);
    expect(() => primitiveFamily("/scatter-even")).toThrow(/not one of the seven families/);
  });
});

describe("the family becomes a derived tag", () => {
  it("prepends the family and keeps the authored tags", () => {
    const { nodes, connections } = recipe();
    const entry = definePrimitive("place/check-tags", {
      title: "Tagged",
      description: "Checks that the family tag is derived from the name rather than authored beside it.",
      tags: ["surface"],
      nodes,
      connections,
      outputs: [{ name: "out", node: "prune", pin: "out" }],
    });
    expect(entry.meta?.tags).toEqual(["place", "surface"]);
  });

  it("requires a title, a description and an output pin", () => {
    const { nodes, connections } = recipe();
    const base = {
      title: "Fine",
      description: "Long enough to be legal for the purposes of this check, which only cares that it is not empty.",
      nodes,
      connections,
      outputs: [{ name: "out", node: "prune", pin: "out" } as const],
    };
    expect(() => definePrimitive("fill/check-no-title", { ...base, title: "  " })).toThrow(
      /needs a non-empty title/,
    );
    expect(() => definePrimitive("fill/check-no-desc", { ...base, description: "" })).toThrow(
      /needs a non-empty description/,
    );
    expect(() => definePrimitive("fill/check-no-out", { ...base, outputs: [] })).toThrow(
      /declares no output pin/,
    );
  });
});

describe("acceptsField is asserted, not assumed", () => {
  it("registers a field-capable target that asserts it", () => {
    const entry = define(freshName(), [
      {
        name: "amount",
        targets: [{ node: "jit", param: "amount" }],
        description: "How far each point may move.",
        acceptsField: true,
      },
    ]);
    expect(entry.subgraph.params?.[0].name).toBe("amount");
  });

  it("REFUSES a plain target that asserts it, naming the target", () => {
    expect(() =>
      define(freshName(), [
        {
          name: "spacing",
          targets: [{ node: "prune", param: "minDistance" }],
          description: "Minimum spacing.",
          acceptsField: true,
        },
      ]),
    ).toThrow(/"prune"\.minDistance does not accept fields/);
  });

  it("REFUSES a fan-out that would silently AND the capability away", () => {
    // The exact hazard the assertion exists for: one field-capable target
    // plus one plain one registers cleanly WITHOUT the assertion, and the
    // knob quietly stops taking fields.
    const params = [
      {
        name: "amount",
        targets: [
          { node: "jit", param: "seed" },
          { node: "scatter", param: "seed" },
        ],
        description: "Re-roll.",
      },
    ];
    expect(() => define(freshName(), params)).not.toThrow();

    expect(() =>
      define(freshName(), [
        {
          name: "size",
          targets: [
            { node: "jit", param: "amount" },
            { node: "scatter", param: "boundsMax" },
          ],
          description: "Both are vec3, but only one takes a field.",
          acceptsField: true,
        },
      ]),
    ).toThrow(/"scatter"\.boundsMax does not accept fields/);

    // ...and without the assertion the same declaration registers, having
    // lost the capability. That is the whole reason the assertion exists.
    const quiet = define(freshName(), [
      {
        name: "size",
        targets: [
          { node: "jit", param: "amount" },
          { node: "scatter", param: "boundsMax" },
        ],
        description: "Both are vec3, but only one takes a field.",
      },
    ]);
    expect(quiet.subgraph.params?.[0].name).toBe("size");
  });

  it("prefixes every declaration failure with the primitive's name", () => {
    expect(() =>
      define("fill/check-bad-target", [
        { name: "nope", targets: [{ node: "scatter", param: "notAParam" }], description: "x" },
      ]),
    ).toThrow(/definePrimitive "fill\/check-bad-target": .*has no param "notAParam"/s);
  });

  it("reports a structural fault in the recipe with the primitive's name on it", () => {
    expect(() =>
      definePrimitive("fill/check-bad-node", {
        title: "Broken",
        description: "A recipe naming a node type that does not exist, to prove the recipe is validated here.",
        nodes: [{ id: "n", type: "noSuchNodeType", params: {} }],
        connections: [],
        outputs: [{ name: "out", node: "n", pin: "out" }],
        params: [{ name: "p", targets: [{ node: "n", param: "x" }], description: "x" }],
      }),
    ).toThrow(/noSuchNodeType/);
  });
});

describe("the assertion is not stored in the recipe", () => {
  it("registers, and the stored declaration carries only the authored half", () => {
    const entry = define(freshName(), [
      {
        name: "amount",
        targets: [{ node: "jit", param: "amount" }],
        description: "How far each point may move.",
        acceptsField: true,
        min: 0,
      },
    ]);
    const stored = entry.subgraph.params?.[0] as unknown as Record<string, unknown>;
    // `acceptsField` in a serialized exposed param is a hard error on
    // load ("derived from the targets' registered schemas; remove it"),
    // so a helper that passed it through would produce a recipe that
    // registers and can never be deserialized again.
    expect(Object.keys(stored).sort()).toEqual(["default", "description", "min", "name", "targets"]);
  });
});
