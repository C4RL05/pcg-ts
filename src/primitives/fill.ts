/**
 * `fill/*` — turn a region into a distribution of points.
 *
 * The line against `shape` is: `shape` decides where the region IS,
 * `fill` decides how densely and how evenly it is populated. This is the
 * family an agent reaches for most.
 *
 * Bounds arrive as two corners rather than one extent, in every entry
 * here, and that is forced rather than chosen: an exposed param writes one
 * identical value into its targets with no arithmetic in between, so a
 * single `size` could never produce `[-s,0,-s]` and `[s,0,s]`.
 */
import { attr, call, constant, tunableFbm } from "./expr.js";
import { definePrimitive } from "./define.js";

/** Register every `fill/*` primitive. Call once, from the family index. */
export function registerFillPrimitives(): void {
  definePrimitive("fill/scatter-even", {
    title: "Scatter points with a guaranteed minimum spacing",
    description:
      "Scatters candidates through a box and then removes any that fall closer than a minimum distance, giving evenly spaced points with no visible clumping — for anything with physical extent: trees, rocks, buildings. COUNT: over-scatter deliberately. The output count is EMERGENT, capped by the area divided by minDistance squared, so raising `count` past that point adds nothing and the way to get more points is a smaller `minDistance`. The scan is a deterministic greedy pass in index order, not a Poisson-disc sample, so the count is not controllable and looping to hit a target count will not converge. VARIATION: yes — two instances in one graph scatter differently, and `seed` re-rolls one explicitly.",
    tags: ["scatter", "spacing"],
    nodes: [
      {
        id: "scatter",
        type: "pointScatterInBounds",
        params: { count: 4000, boundsMin: [0, 0, 0], boundsMax: [50, 0, 50], seed: 0 },
      },
      { id: "prune", type: "selfPrune", params: { minDistance: 2 } },
    ],
    connections: [{ from: ["scatter", "out"], to: ["prune", "in"] }],
    outputs: [{ name: "out", node: "prune", pin: "out" }],
    params: [
      {
        name: "count",
        targets: [{ node: "scatter", param: "count" }],
        description:
          "Candidates scattered before pruning. Over-scatter: the survivors are however many fit at `minDistance`, never more.",
        min: 0,
      },
      {
        name: "minDistance",
        targets: [{ node: "prune", param: "minDistance" }],
        description: "Closest two kept points may be, in world units. This is the real knob.",
        min: 0,
      },
      {
        name: "boundsMin",
        targets: [{ node: "scatter", param: "boundsMin" }],
        description: "Minimum corner of the box to fill, in world units.",
      },
      {
        name: "boundsMax",
        targets: [{ node: "scatter", param: "boundsMax" }],
        description: "Maximum corner of the box to fill, in world units.",
      },
      {
        name: "seed",
        targets: [{ node: "scatter", param: "seed" }],
        description: "Re-rolls the scatter. Two instances already differ without it.",
      },
    ],
  });

  definePrimitive("fill/scatter-by-density", {
    title: "Scatter points into noise-driven clumps",
    description:
      "Scatters candidates through a box and keeps each one with a probability read from a noise field, so the points arrive in soft clumps instead of spread evenly — the single most common authoring situation in the library. COUNT: about `count` x 0.5 survive, since the normalized pattern averages 0.5. VARIATION: this is the MIXED case and the one an agent gets wrong. Which candidates survive varies per instance, but the PATTERN does not, so two instances put different points in the SAME clumps unless their `variant` differs. Writes `density`; reads nothing. Built on `filter/thin-by-density`, which is the same thinning applied to a cloud you already have.",
    tags: ["scatter", "noise", "density"],
    nodes: [
      {
        id: "scatter",
        type: "pointScatterInBounds",
        params: { count: 4000, boundsMin: [0, 0, 0], boundsMax: [100, 0, 100], seed: 0 },
      },
      { id: "thin", type: "subgraph", params: {}, ref: { name: "filter/thin-by-density" } },
    ],
    connections: [{ from: ["scatter", "out"], to: ["thin", "in"] }],
    outputs: [{ name: "out", node: "thin", pin: "out" }],
    params: [
      {
        name: "count",
        targets: [{ node: "scatter", param: "count" }],
        description: "Candidates scattered before thinning. Roughly half survive.",
        min: 0,
      },
      {
        name: "boundsMin",
        targets: [{ node: "scatter", param: "boundsMin" }],
        description: "Minimum corner of the box to fill, in world units.",
      },
      {
        name: "boundsMax",
        targets: [{ node: "scatter", param: "boundsMax" }],
        description: "Maximum corner of the box to fill, in world units.",
      },
      {
        name: "frequency",
        targets: [{ node: "thin", param: "frequency" }],
        description: "Feature size of the clumps: smaller means broader clumps.",
        acceptsField: true,
      },
      {
        name: "variant",
        targets: [{ node: "thin", param: "variant" }],
        description:
          "Offset added to the noise sample position — the only way to give two instances different CLUMPS rather than different points in the same clumps.",
        acceptsField: true,
      },
      {
        name: "seed",
        targets: [
          { node: "scatter", param: "seed" },
          { node: "thin", param: "seed" },
        ],
        description:
          "Re-rolls both the candidate positions and which of them survive. It does NOT move the clumps; `variant` does that.",
      },
    ],
  });

  definePrimitive("fill/scatter-clustered", {
    title: "Scatter points in groups rather than spread out",
    description:
      "Scatters a few cluster centres through a box, then copies a small local cloud onto each one, so points arrive in groups — villages, groves, boulder fields, star clusters. COUNT: the output is clusters x perCluster, which multiplies fast. VARIATION: yes — both scatters are context-seeded, so two instances differ, and `seed` re-rolls both explicitly. The local cloud's own `scale` is reset before copying, so `spread` sizes the cluster and not the assets in it.",
    tags: ["scatter", "clusters"],
    nodes: [
      {
        id: "centres",
        type: "pointScatterInBounds",
        params: { count: 24, boundsMin: [0, 0, 0], boundsMax: [100, 0, 100], seed: 0 },
      },
      {
        id: "local",
        type: "pointScatterInBounds",
        params: { count: 12, boundsMin: [-1, 0, -1], boundsMax: [1, 0, 1], seed: 0 },
      },
      {
        id: "spread",
        type: "transformPoints",
        params: { scale: [4, 4, 4], rotateEuler: [0, 0, 0], translate: [0, 0, 0] },
      },
      {
        id: "reset",
        type: "setAttribute",
        params: { name: "scale", domain: "point", type: "f32", tupleSize: 3, value: constant([1, 1, 1]) },
      },
      { id: "copy", type: "copyToPoints", params: {} },
    ],
    connections: [
      { from: ["local", "out"], to: ["spread", "in"] },
      { from: ["spread", "out"], to: ["reset", "in"] },
      { from: ["reset", "out"], to: ["copy", "source"] },
      { from: ["centres", "out"], to: ["copy", "target"] },
    ],
    outputs: [{ name: "out", node: "copy", pin: "out" }],
    params: [
      {
        name: "clusters",
        targets: [{ node: "centres", param: "count" }],
        description: "How many groups to place.",
        min: 0,
      },
      {
        name: "perCluster",
        targets: [{ node: "local", param: "count" }],
        description: "How many points each group holds. The output count is clusters x this.",
        min: 0,
      },
      {
        name: "spread",
        targets: [{ node: "spread", param: "scale" }],
        description:
          'How far a group reaches from its centre, in world units. A bare number is not accepted: pass [4,4,4], or {"fn":"constant","value":4} for a round cluster.',
        acceptsField: true,
      },
      {
        name: "boundsMin",
        targets: [{ node: "centres", param: "boundsMin" }],
        description: "Minimum corner of the box the group centres can land in, in world units.",
      },
      {
        name: "boundsMax",
        targets: [{ node: "centres", param: "boundsMax" }],
        description: "Maximum corner of the box the group centres can land in, in world units.",
      },
      {
        name: "seed",
        targets: [
          { node: "centres", param: "seed" },
          { node: "local", param: "seed" },
        ],
        description: "Re-rolls both the group positions and the shape of the group. Two instances already differ without it.",
      },
    ],
  });

  definePrimitive("fill/volume-by-noise", {
    title: "Carve connected volumes out of a solid box",
    description:
      "Fills a box with a jittered grid of points and keeps only the cells where a 3D noise field rises above a threshold, carving connected volumes out of solid — caves, clouds, asteroid interiors, floating islands. COUNT: the grid is extent cubed over cellSize cubed, so this is the one primitive here that can blow up; halving `cellSize` costs eight times as many points before the threshold takes any away. Connect the `in` pin and the bounds come from that geometry's own extents instead of the params, which is the library's only 'adapt to whatever arrives' mechanism. VARIATION: the jitter varies per instance but the CARVE PATTERN does not, so two instances hollow out the same shape unless their `variant` differs.",
    tags: ["noise", "volume"],
    nodes: [
      {
        id: "vol",
        type: "volumeSample",
        params: { boundsMin: [0, 0, 0], boundsMax: [32, 32, 32], cellSize: 2, jitter: 0.5, seed: 0 },
      },
      {
        id: "variantAttr",
        type: "setAttribute",
        params: { name: "variant", domain: "point", type: "f32", tupleSize: 1, value: 0 },
      },
      {
        id: "freqAttr",
        type: "setAttribute",
        params: { name: "freq", domain: "point", type: "f32", tupleSize: 1, value: 0.05 },
      },
      {
        id: "threshAttr",
        type: "setAttribute",
        params: { name: "threshold", domain: "point", type: "f32", tupleSize: 1, value: 0.5 },
      },
      {
        id: "carve",
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
      { from: ["vol", "out"], to: ["variantAttr", "in"] },
      { from: ["variantAttr", "out"], to: ["freqAttr", "in"] },
      { from: ["freqAttr", "out"], to: ["threshAttr", "in"] },
      { from: ["threshAttr", "out"], to: ["carve", "in"] },
      { from: ["carve", "out"], to: ["cleanup", "in"] },
    ],
    inputs: [{ name: "in", node: "vol", pin: "in" }],
    outputs: [{ name: "out", node: "cleanup", pin: "out" }],
    params: [
      {
        name: "cellSize",
        targets: [{ node: "vol", param: "cellSize" }],
        description: "Grid resolution in world units. Halving it costs eight times as many candidate points.",
      },
      {
        name: "jitter",
        targets: [{ node: "vol", param: "jitter" }],
        description: "How far each point may wander inside its own cell: 0 is a hard lattice, 1 is fully irregular.",
        min: 0,
        max: 1,
        acceptsField: true,
      },
      {
        name: "threshold",
        targets: [{ node: "threshAttr", param: "value" }],
        description: "Where the cut falls on the 0..1 noise. Higher leaves less material.",
        min: 0,
        max: 1,
        acceptsField: true,
      },
      {
        name: "frequency",
        targets: [{ node: "freqAttr", param: "value" }],
        description: "Feature size: smaller means larger, smoother caverns.",
        acceptsField: true,
      },
      {
        name: "variant",
        targets: [{ node: "variantAttr", param: "value" }],
        description: "Offset added to the noise sample position — the per-instance re-roll of the carve pattern.",
        acceptsField: true,
      },
      {
        name: "boundsMin",
        targets: [{ node: "vol", param: "boundsMin" }],
        description: "Minimum corner of the box to fill. IGNORED when the `in` pin is connected.",
      },
      {
        name: "boundsMax",
        targets: [{ node: "vol", param: "boundsMax" }],
        description: "Maximum corner of the box to fill. IGNORED when the `in` pin is connected.",
      },
      {
        name: "seed",
        targets: [{ node: "vol", param: "seed" }],
        description: "Re-rolls the per-cell jitter. It does NOT move the carve pattern; `variant` does that.",
      },
    ],
  });
}
