/**
 * `compose/*` — combine two point sets.
 *
 * Thin on purpose. The library has exactly two ways to combine point
 * clouds — concatenate (`mergePoints`) and cross-product
 * (`copyToPoints`) — and both are already single-purpose, so anything
 * further would be a rename. Composition is where the node set is
 * COMPLETE, not where it is lacking.
 */
import { definePrimitive } from "./define.js";

/** Register every `compose/*` primitive. Call once, from the family index. */
export function registerComposePrimitives(): void {
  definePrimitive("compose/merge-tagged", {
    title: "Merge two clouds and remember which is which",
    description:
      "Concatenates two point clouds and stamps a string attribute on each side first, so the result remembers where every point came from — then `partitionByAttribute` can route them apart again, or the spawner can read the same attribute and give each source a different asset. ONE knob names the attribute on both sides, which is the point: a hand-written version has the same string typed twice and drifts the first time one is edited. Note that merging unions the attribute sets and FAILS when the two inputs disagree on a name's type, so a scratch column left on one side can break a merge that used to work. Fully deterministic. Writes the kind attribute; carries every other attribute through.",
    tags: ["merge", "routing"],
    nodes: [
      {
        id: "tagA",
        type: "setAttribute",
        params: {
          name: "kind",
          domain: "point",
          type: "string",
          tupleSize: 1,
          value: 0,
          values: [],
          stringValue: "a",
        },
      },
      {
        id: "tagB",
        type: "setAttribute",
        params: {
          name: "kind",
          domain: "point",
          type: "string",
          tupleSize: 1,
          value: 0,
          values: [],
          stringValue: "b",
        },
      },
      { id: "merge", type: "mergePoints", params: {} },
    ],
    connections: [
      { from: ["tagA", "out"], to: ["merge", "in"] },
      { from: ["tagB", "out"], to: ["merge", "in"] },
    ],
    inputs: [
      { name: "a", node: "tagA", pin: "in" },
      { name: "b", node: "tagB", pin: "in" },
    ],
    outputs: [{ name: "out", node: "merge", pin: "out" }],
    params: [
      {
        name: "kindAttr",
        targets: [
          { node: "tagA", param: "name" },
          { node: "tagB", param: "name" },
        ],
        description:
          "Name of the string point attribute stamped on both sides. One knob writes both, so the two labels always land on the same attribute.",
      },
      {
        name: "nameA",
        targets: [{ node: "tagA", param: "stringValue" }],
        description: "Label written on every point arriving at `a`.",
      },
      {
        name: "nameB",
        targets: [{ node: "tagB", param: "stringValue" }],
        description: "Label written on every point arriving at `b`.",
      },
    ],
  });

  definePrimitive("compose/scatter-copies", {
    title: "Copy a whole cloud onto every target point",
    description:
      "Copies the entire `source` cloud onto every point of `target`, composing the transforms per copy, then jitters the result so the repeated copies do not read as stamped. COUNT: the output is source x target points — 20 onto 500 is 10,000, and it multiplies fast. The transforms compose rather than overwrite: each copy is placed by the target's position, turned by the target's rotation and sized by the target's scale, so a target cloud carrying `rot` and `scale` lays its copies out already varied. VARIATION: yes — the jitter is context-seeded, so two instances differ, and `seed` re-rolls one explicitly. Reads and writes `P`; carries every source attribute through.",
    tags: ["copy", "clusters"],
    nodes: [
      { id: "copy", type: "copyToPoints", params: {} },
      { id: "jit", type: "jitterPoints", params: { amount: [0.5, 0, 0.5], seed: 0 } },
    ],
    connections: [{ from: ["copy", "out"], to: ["jit", "in"] }],
    inputs: [
      { name: "source", node: "copy", pin: "source" },
      { name: "target", node: "copy", pin: "target" },
    ],
    outputs: [{ name: "out", node: "jit", pin: "out" }],
    params: [
      {
        name: "jitter",
        targets: [{ node: "jit", param: "amount" }],
        description:
          "Random offset per axis, in world units, uniform and SYMMETRIC: each copy moves somewhere in -jitter..+jitter on each axis independently, so the spread is 2 * jitter wide, not jitter, and the measured extremes sit on the bound exactly. What makes copied clusters look placed rather than stamped. The default [0.5,0,0.5] jitters in the ground plane only — the zero on Y is what keeps copies from sinking through a surface. Set it to [0,0,0] for exact copies.",
        acceptsField: true,
      },
      {
        name: "seed",
        targets: [{ node: "jit", param: "seed" }],
        description: "Re-rolls the jitter. Two instances already differ without it.",
      },
    ],
  });
}
