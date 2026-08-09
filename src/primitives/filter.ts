/**
 * `filter/*` — remove points, never move them. `P` is untouched and the
 * output carries no column the input did not have: every scratch attribute
 * these recipes need to reach a decision is deleted again before the
 * result leaves.
 *
 * The distinction an agent must understand lives in this family: a
 * THRESHOLD on a noise field gives connected regions with hard edges,
 * while a PROBABILITY drawn against a density gives soft-edged clouds of
 * individual points. `filter/mask-by-noise` and `filter/thin-by-density`
 * are the same field with those two readings, and each description points
 * at the other.
 */
import { attr, call, position, tunableFbm } from "./expr.js";
import { definePrimitive } from "./define.js";

/** Register every `filter/*` primitive. Call once, from the family index. */
export function registerFilterPrimitives(): void {
  definePrimitive("filter/thin-by-density", {
    title: "Thin a point cloud by a noise density",
    description:
      "Writes a normalized noise field into the standard `density` attribute and keeps each point with a probability equal to its density, so dense regions stay full and sparse ones fade out. The result is SOFT-EDGED: individual points thin out gradually, with no boundary. For hard-edged regions with a visible coastline, use `filter/mask-by-noise` instead. VARIATION: which points survive varies per instance (the draw is context-seeded), but the PATTERN does not — noise carries its own seed inside its field spec, where no exposed param can reach, so two instances thin the same blobs unless their `variant` differs. Writes `density`; reads `P`.",
    tags: ["noise", "density"],
    nodes: [
      {
        id: "variantAttr",
        type: "setAttribute",
        params: { name: "variant", domain: "point", type: "f32", tupleSize: 1, value: 0 },
      },
      {
        id: "freqAttr",
        type: "setAttribute",
        params: { name: "freq", domain: "point", type: "f32", tupleSize: 1, value: 0.02 },
      },
      {
        id: "densityAttr",
        type: "setAttribute",
        params: {
          name: "density",
          domain: "point",
          type: "f32",
          tupleSize: 1,
          value: tunableFbm("freq", "variant"),
        },
      },
      { id: "thin", type: "filterByDensity", params: { mode: "probabilistic", threshold: 0.5, seed: 0 } },
      { id: "cleanup", type: "removeAttribute", params: { names: ["variant", "freq"], domain: "point", strict: true } },
    ],
    connections: [
      { from: ["variantAttr", "out"], to: ["freqAttr", "in"] },
      { from: ["freqAttr", "out"], to: ["densityAttr", "in"] },
      { from: ["densityAttr", "out"], to: ["thin", "in"] },
      { from: ["thin", "out"], to: ["cleanup", "in"] },
    ],
    inputs: [{ name: "in", node: "variantAttr", pin: "in" }],
    outputs: [{ name: "out", node: "cleanup", pin: "out" }],
    params: [
      {
        name: "frequency",
        targets: [{ node: "freqAttr", param: "value" }],
        description:
          "Feature size: the noise sample position is multiplied by this, so smaller means broader clumps. 0.02 gives clumps tens of world units across.",
        acceptsField: true,
      },
      {
        name: "variant",
        targets: [{ node: "variantAttr", param: "value" }],
        description:
          "Offset added to the noise sample position — the only way to give two instances different PATTERNS. Any two different values are unrelated; the same value always reproduces.",
        acceptsField: true,
      },
      {
        name: "seed",
        targets: [{ node: "thin", param: "seed" }],
        description:
          "Re-rolls which points survive within the same pattern. It does NOT move the pattern; `variant` does that.",
      },
    ],
  });

  definePrimitive("filter/mask-by-noise", {
    title: "Keep the points where a noise field is above a threshold",
    description:
      "Keeps only the points where a normalized noise field rises above a threshold — a HARD mask, giving connected regions with visible edges, the way a coastline separates land from sea. For a soft, gradual fade instead, use `filter/thin-by-density`. On normalized noise a threshold of 0.5 keeps roughly half the area, and higher keeps less. VARIATION: none by default — noise carries its own seed inside its field spec, so two instances mask IDENTICALLY unless their `variant` differs. Reads `P`; writes nothing (every scratch column is removed again).",
    tags: ["noise", "mask"],
    nodes: [
      {
        id: "variantAttr",
        type: "setAttribute",
        params: { name: "variant", domain: "point", type: "f32", tupleSize: 1, value: 0 },
      },
      {
        id: "freqAttr",
        type: "setAttribute",
        params: { name: "freq", domain: "point", type: "f32", tupleSize: 1, value: 0.02 },
      },
      {
        id: "threshAttr",
        type: "setAttribute",
        params: { name: "threshold", domain: "point", type: "f32", tupleSize: 1, value: 0.5 },
      },
      {
        id: "mask",
        type: "filterByExpression",
        params: { predicate: call("ge", tunableFbm("freq", "variant"), attr("threshold")), seed: 0 },
      },
      {
        id: "cleanup",
        type: "removeAttribute",
        params: { names: ["variant", "freq", "threshold"], domain: "point", strict: true },
      },
    ],
    connections: [
      { from: ["variantAttr", "out"], to: ["freqAttr", "in"] },
      { from: ["freqAttr", "out"], to: ["threshAttr", "in"] },
      { from: ["threshAttr", "out"], to: ["mask", "in"] },
      { from: ["mask", "out"], to: ["cleanup", "in"] },
    ],
    inputs: [{ name: "in", node: "variantAttr", pin: "in" }],
    outputs: [{ name: "out", node: "cleanup", pin: "out" }],
    params: [
      {
        name: "threshold",
        targets: [{ node: "threshAttr", param: "value" }],
        description: "Where the cut falls on the 0..1 noise. 0.5 keeps about half; 1 keeps nothing and 0 keeps everything.",
        min: 0,
        max: 1,
        acceptsField: true,
      },
      {
        name: "frequency",
        targets: [{ node: "freqAttr", param: "value" }],
        description: "Feature size: the noise sample position is multiplied by this, so smaller means larger regions.",
        acceptsField: true,
      },
      {
        name: "variant",
        targets: [{ node: "variantAttr", param: "value" }],
        description:
          "Offset added to the noise sample position — the per-instance re-roll. Two instances with the same value mask identically.",
        acceptsField: true,
      },
    ],
  });

  definePrimitive("filter/inside-radius", {
    title: "Keep the points within a radius of a centre",
    description:
      "Keeps the points whose distance to a centre satisfies a comparison — 'le' for a circular district, 'ge' for an exclusion zone around a landmark. The distance is the true 3D distance, not a squared one and not a planar one, which are the two ways a hand-written version goes wrong. Fully deterministic. Reads `P`; writes nothing (both scratch columns are removed again).",
    tags: ["spatial", "mask"],
    nodes: [
      {
        id: "centerAttr",
        type: "setAttribute",
        params: { name: "__center", domain: "point", type: "f32", tupleSize: 3, value: 0 },
      },
      {
        id: "distAttr",
        type: "setAttribute",
        params: {
          name: "__radial",
          domain: "point",
          type: "f32",
          tupleSize: 1,
          value: call("length", call("sub", position(), attr("__center", 3))),
        },
      },
      { id: "keep", type: "filterByAttribute", params: { attribute: "__radial", comparison: "le", value: 10, stringValue: "" } },
      {
        id: "cleanup",
        type: "removeAttribute",
        params: { names: ["__center", "__radial"], domain: "point", strict: true },
      },
    ],
    connections: [
      { from: ["centerAttr", "out"], to: ["distAttr", "in"] },
      { from: ["distAttr", "out"], to: ["keep", "in"] },
      { from: ["keep", "out"], to: ["cleanup", "in"] },
    ],
    inputs: [{ name: "in", node: "centerAttr", pin: "in" }],
    outputs: [{ name: "out", node: "cleanup", pin: "out" }],
    params: [
      {
        name: "center",
        targets: [{ node: "centerAttr", param: "value" }],
        description:
          'World position the distance is measured from. A plain number broadcasts to all three axes, so 0 is the origin; for anywhere else pass a field spec: {"fn":"constant","value":[x,y,z]}.',
        acceptsField: true,
      },
      {
        name: "radius",
        targets: [{ node: "keep", param: "value" }],
        description: "The distance the comparison is made against, in world units.",
        min: 0,
      },
      {
        name: "comparison",
        targets: [{ node: "keep", param: "comparison" }],
        description: "How the distance is tested: 'le' keeps what is inside the radius, 'ge' keeps what is outside it.",
      },
    ],
  });

  definePrimitive("filter/by-distance-to", {
    title: "Keep points by how far they are from another cloud",
    description:
      "Measures each point's distance to the nearest point of a second cloud and keeps or drops it by that distance — 'no trees within 20m of the road', or 'cabins only near the lake'. This is the only way to ask how far anything is from anything: transferring the nearest value copies it but never reveals the distance. A point that finds nothing (an empty `features` cloud) is at distance Infinity, so 'le' drops it and 'ge' keeps it. Fully deterministic. Reads `P` on both inputs; writes nothing (the distance column is removed again).",
    tags: ["spatial", "proximity"],
    nodes: [
      {
        id: "near",
        type: "sampleNearestPoint",
        params: {
          distanceAttr: "__nearDist",
          indexAttr: "",
          attribute: "",
          outAttribute: "",
          maxDistance: 0,
        },
      },
      {
        id: "keep",
        type: "filterByAttribute",
        params: { attribute: "__nearDist", comparison: "ge", value: 5, stringValue: "" },
      },
      { id: "cleanup", type: "removeAttribute", params: { names: ["__nearDist"], domain: "point", strict: true } },
    ],
    connections: [
      { from: ["near", "out"], to: ["keep", "in"] },
      { from: ["keep", "out"], to: ["cleanup", "in"] },
    ],
    inputs: [
      { name: "in", node: "near", pin: "in" },
      { name: "features", node: "near", pin: "source" },
    ],
    outputs: [{ name: "out", node: "cleanup", pin: "out" }],
    params: [
      {
        name: "distance",
        targets: [{ node: "keep", param: "value" }],
        description: "The band edge, in world units.",
        min: 0,
      },
      {
        name: "comparison",
        targets: [{ node: "keep", param: "comparison" }],
        description: "'ge' keeps what is far from the features (a clearance), 'le' keeps what is near them (a band).",
      },
    ],
  });

  definePrimitive("filter/by-neighbor-count", {
    title: "Keep points by how crowded they are",
    description:
      "Counts each point's neighbours within a radius and keeps or drops it by that count — 'ge' removes lonely outliers and finds cluster cores, 'le' thins the dense middle out. Fully deterministic: it measures whatever arrives. Reads `P`; writes nothing (the count column is removed again).",
    tags: ["neighborhood", "spatial"],
    nodes: [
      {
        id: "nbr",
        type: "pointNeighborhood",
        params: {
          radius: 5,
          maxCount: 0,
          includeSelf: false,
          countAttr: "__nbrCount",
          averageAttr: "",
          averageOutAttr: "nbrAvg",
        },
      },
      {
        id: "keep",
        type: "filterByAttribute",
        params: { attribute: "__nbrCount", comparison: "ge", value: 2, stringValue: "" },
      },
      { id: "cleanup", type: "removeAttribute", params: { names: ["__nbrCount"], domain: "point", strict: true } },
    ],
    connections: [
      { from: ["nbr", "out"], to: ["keep", "in"] },
      { from: ["keep", "out"], to: ["cleanup", "in"] },
    ],
    inputs: [{ name: "in", node: "nbr", pin: "in" }],
    outputs: [{ name: "out", node: "cleanup", pin: "out" }],
    params: [
      {
        name: "radius",
        targets: [{ node: "nbr", param: "radius" }],
        description: "How far around each point counts as its neighbourhood, in world units.",
        min: 0,
      },
      {
        name: "count",
        targets: [{ node: "keep", param: "value" }],
        description: "How many neighbours the comparison is made against. The point itself is not counted.",
        min: 0,
      },
      {
        name: "comparison",
        targets: [{ node: "keep", param: "comparison" }],
        description: "'ge' keeps the crowded points (cluster cores), 'le' keeps the isolated ones.",
      },
    ],
  });
}
