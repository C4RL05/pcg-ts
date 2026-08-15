/**
 * `filter/*` — remove points, never move them. `P` is untouched, and the
 * only column any of these adds is one it DOCUMENTS adding:
 * `filter/thin-by-density` leaves the `density` it thinned by, and that is
 * the whole list. Every scratch attribute a recipe needs to reach its
 * decision — `__radial`, `__nearDist`, `__nbrCount` — is deleted again
 * before the result leaves, and the two noise filters need none at all now
 * that their knobs are read by name rather than carried in a column.
 *
 * The distinction an agent must understand lives in this family: a
 * THRESHOLD on a noise field gives connected regions with hard edges,
 * while a PROBABILITY drawn against a density gives soft-edged clouds of
 * individual points. `filter/mask-by-noise` and `filter/thin-by-density`
 * are the same field with those two readings, and each description points
 * at the other.
 */
import { attr, call, param, position, tunableFbm } from "./expr.js";
import { definePrimitive } from "./define.js";

/** Register every `filter/*` primitive. Call once, from the family index. */
export function registerFilterPrimitives(): void {
  definePrimitive("filter/thin-by-density", {
    title: "Thin a point cloud by a noise density",
    description:
      "Writes a normalized noise field into the standard `density` attribute and keeps each point with a probability equal to its density, so dense regions stay full and sparse ones fade out. The result is SOFT-EDGED: individual points thin out gradually, with no boundary. For hard-edged regions with a visible coastline, use `filter/mask-by-noise` instead. VARIATION: which points survive varies per instance (the draw is context-seeded), but the PATTERN does not — a noise field's seed lives in its `opts`, read as a plain number rather than as an argument position, so no reference of any kind can stand there and no knob can move it — two instances thin the same blobs unless their `variant` differs. Writes `density`; reads `P`.",
    tags: ["noise", "density"],
    nodes: [
      {
        id: "densityAttr",
        type: "setAttribute",
        params: {
          name: "density",
          domain: "point",
          type: "f32",
          tupleSize: 1,
          value: tunableFbm("frequency", "variant"),
        },
      },
      { id: "thin", type: "filterByDensity", params: { mode: "probabilistic", threshold: 0.5, seed: 0 } },
    ],
    connections: [{ from: ["densityAttr", "out"], to: ["thin", "in"] }],
    inputs: [{ name: "in", node: "densityAttr", pin: "in" }],
    outputs: [{ name: "out", node: "thin", pin: "out" }],
    params: [
      {
        name: "frequency",
        targets: [],
        default: 0.02,
        description:
          "Feature size: the noise sample position is multiplied by this, so smaller means broader clumps. 0.02 gives clumps tens of world units across.",
        acceptsField: true,
      },
      {
        name: "variant",
        targets: [],
        default: 0,
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
      "Keeps only the points where a normalized noise field rises above a threshold — a HARD mask, giving connected regions with visible edges, the way a coastline separates land from sea. For a soft, gradual fade instead, use `filter/thin-by-density`. On normalized noise a threshold of 0.5 keeps roughly half the area, and higher keeps less — but the usable band is only about 0.32 to 0.68, not the full 0..1 the param's range suggests; the `threshold` description gives the measured table. VARIATION: none by default — noise carries its own seed inside its field spec, so two instances mask IDENTICALLY unless their `variant` differs. Reads `P`; writes nothing at all — the whole test is one field expression, so no scratch column is created to be cleaned up.",
    tags: ["noise", "mask"],
    nodes: [
      {
        id: "mask",
        type: "filterByExpression",
        params: { predicate: call("ge", tunableFbm("frequency", "variant"), param("threshold")), seed: 0 },
      },
    ],
    connections: [],
    inputs: [{ name: "in", node: "mask", pin: "in" }],
    outputs: [{ name: "out", node: "mask", pin: "out" }],
    params: [
      {
        name: "threshold",
        targets: [],
        default: 0.5,
        description:
          "Where the cut falls on the 0..1 noise — but the noise only reaches the MIDDLE of that range, so the whole knob lives between about 0.32 (keeps everything) and 0.68 (keeps nothing). Four octaves of normalized fBm come out bell-shaped around 0.5 with a standard deviation near 0.065, never at the ends: the theoretical 0..1 is the nominal range of the term, not the values it takes. Measured on a wide 2D spread: 0.42 keeps ~89%, 0.46 ~75%, 0.50 ~50%, 0.55 ~23%, 0.59 ~9%. So a threshold of 0.8 does not keep a fifth, it keeps NOTHING, and 0.2 does not keep four fifths, it keeps everything. `frequency`, `variant` and how widely the points sample the field move the two ends by a few hundredths.",
        min: 0,
        max: 1,
        acceptsField: true,
      },
      {
        name: "frequency",
        targets: [],
        default: 0.02,
        description: "Feature size: the noise sample position is multiplied by this, so smaller means larger regions.",
        acceptsField: true,
      },
      {
        name: "variant",
        targets: [],
        default: 0,
        description:
          "Offset added to the noise sample position — the per-instance re-roll. Two instances with the same value mask identically.",
        acceptsField: true,
      },
    ],
  });

  definePrimitive("filter/inside-radius", {
    title: "Keep the points within a radius of a centre",
    description:
      "Keeps the points whose distance to a centre satisfies a comparison — 'le' for a circular district, 'ge' for an exclusion zone around a landmark. The distance is the true 3D distance, not a squared one and not a planar one, which are the two ways a hand-written version goes wrong. Fully deterministic. Reads `P`; writes nothing (the scratch distance column is removed again).",
    tags: ["spatial", "mask"],
    nodes: [
      {
        id: "distAttr",
        type: "setAttribute",
        params: {
          name: "__radial",
          domain: "point",
          type: "f32",
          tupleSize: 1,
          value: call("length", call("sub", position(), param("center"))),
        },
      },
      { id: "keep", type: "filterByAttribute", params: { attribute: "__radial", comparison: "le", value: 10, stringValue: "" } },
      {
        id: "cleanup",
        type: "removeAttribute",
        params: { names: ["__radial"], domain: "point", strict: true },
      },
    ],
    connections: [
      { from: ["distAttr", "out"], to: ["keep", "in"] },
      { from: ["keep", "out"], to: ["cleanup", "in"] },
    ],
    inputs: [{ name: "in", node: "distAttr", pin: "in" }],
    outputs: [{ name: "out", node: "cleanup", pin: "out" }],
    params: [
      {
        name: "center",
        targets: [],
        default: [0, 0, 0],
        description:
          "World position the distance is measured from, as three numbers [x, y, z]. It is read straight into the distance expression, so the whole triple is set at once — a bare number is not accepted, and the origin is [0, 0, 0]. Field-capable, and resolved on the incoming points: a field moves the centre PER POINT, so distance can be measured from a per-cluster origin rather than from one place. A field may be scalar and broadcasts across all three axes when it is; a plain [x, y, z] is the ordinary case.",
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

  // Declared after `filter/by-distance-to`: it references it by name, and
  // a referenced primitive must already be registered when this recipe is
  // canonicalized.
  definePrimitive("filter/by-distance-to-curve", {
    title: "Keep points by how far they are from a curve",
    description:
      "Measures each point's distance to the supplied `curve` and keeps or drops it by that distance — a clearance either side of a road, a band of reeds along a river, a strip of lamps beside a path. The densification is the content: a polyline's own points can be tens of metres apart, and measuring to THEM instead of to the curve reports huge distances mid-segment and cuts scalloped bites out of the result. The curve is therefore sampled every `resolution` units first, and the measurement is against those samples, so `resolution` is the accuracy of the answer. PRECONDITION: `curve` must carry polyline topology (`shape/path-loop`, `shape/path-meander`, or a `pointsToPath` node) — a point cloud is rejected as having no polylines. Several separate paths are all measured against; the nearest one wins. Fully deterministic. Reads `P` on both inputs; writes nothing.",
    // `path` but NOT `curve`: it reads a curve and emits the plain point
    // cloud its `in` pin was given, minus points. Nothing downstream can
    // treat the result as a path.
    tags: ["path", "spatial", "proximity"],
    nodes: [
      {
        id: "dense",
        type: "splineSample",
        params: { mode: "spacing", count: 10, spacing: 1 },
      },
      { id: "dist", type: "subgraph", params: {}, ref: { name: "filter/by-distance-to" } },
    ],
    connections: [{ from: ["dense", "out"], to: ["dist", "features"] }],
    inputs: [
      { name: "in", node: "dist", pin: "in" },
      { name: "curve", node: "dense", pin: "in" },
    ],
    outputs: [{ name: "out", node: "dist", pin: "out" }],
    params: [
      {
        name: "distance",
        targets: [{ node: "dist", param: "distance" }],
        description: "The band edge, in world units — how far from the curve the decision flips.",
        min: 0,
      },
      {
        name: "comparison",
        targets: [{ node: "dist", param: "comparison" }],
        description: "'ge' keeps what is far from the curve (a clearance either side of it), 'le' keeps what runs alongside it (a band).",
      },
      {
        name: "resolution",
        targets: [{ node: "dense", param: "spacing" }],
        description:
          "How finely the curve is sampled before distances are measured, in world units. It is the accuracy of the measurement, and it only ever UNDERSTATES the band — sampling a curve sparsely puts every point further from the nearest sample than it is from the curve, so points are lost from the edges, never gained. Measured against a 5-unit band on a straight curve: resolution 1 (a fifth of `distance`) loses 0.2% of the points, 2 loses 0.7%, 5 (equal to `distance`) loses 4%, 10 loses 18% and 20 loses half. A fifth of `distance` is the practical floor; below that it only costs sample points, one more per step along every path.",
        min: 0,
      },
    ],
  });
}
