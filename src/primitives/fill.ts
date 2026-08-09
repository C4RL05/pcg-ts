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
      "Scatters candidates through a box and then removes any that fall closer than a minimum distance, giving evenly spaced points with no visible clumping — for anything with physical extent: trees, rocks, buildings. COUNT: over-scatter deliberately. The output count is EMERGENT and approaches a ceiling of about 0.7 x area / minDistance squared from BELOW — the default 4000 candidates reach only about 85% of it — so raising `count` keeps adding a few points for a long time, while the way to get materially more is a smaller `minDistance`. The scan is a deterministic greedy pass in index order, not a Poisson-disc sample, so the count is not controllable and looping to hit a target count will not converge. VARIATION: yes — two instances in one graph scatter differently, and `seed` re-rolls one explicitly.",
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
          "Candidates scattered before pruning. Over-scatter, and expect to over-scatter HARD: the survivor count climbs slowly toward saturation instead of reaching it, so this knob still moves the result long after it looks like it should not. Saturation is about 0.7 * area / minDistance^2 — roughly 440 points in the default 50x50 box at minDistance 2 — and it takes on the order of 150 candidates per surviving point to get within a few percent of it. Measured in that box at minDistance 2: 4000 candidates give 373 (85% of saturation), 16000 give 414, 64000 give 435, 200000 give 442. Each 4x costs the next ~5%. Nothing here ever produces MORE than saturation, so a target count above it is unreachable at any `count`.",
        min: 0,
      },
      {
        name: "minDistance",
        targets: [{ node: "prune", param: "minDistance" }],
        description:
          "Closest two kept points may be, in world units — and it is exact, not approximate: the measured nearest pair sits at minDistance to within a rounding error. This is the real knob, because the count follows it as an inverse square: the achievable maximum is about 0.7 * area / minDistance^2, so halving it makes room for four times as many points (and needs four times the `count` to find them).",
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
      "Scatters a few cluster centres through a box, then copies a small local cloud onto each one, so points arrive in groups — villages, groves, boulder fields. COUNT: the output is clusters x perCluster exactly, which multiplies fast. SHAPE: a group is a BOX running -spread to +spread around its centre and all three components of `spread` are live. It ships flat — the default is [4, 0, 4], a ground-plane patch, because that is what a village or a grove is — so raise `spread.y` to make the group volumetric (a swarm, an asteroid field, a cave's boulders) rather than reaching for a box scatter. The groups OVERHANG the bounds by up to `spread`, deliberately and unclamped: `boundsMin`/`boundsMax` place the CENTRES, and a group straddling the edge is a whole group rather than a clipped one — inset the bounds by `spread` if the points themselves have to stay inside a region. VARIATION: yes — both scatters are context-seeded, so two instances differ, and `seed` re-rolls both explicitly. The local cloud's own `scale` is reset before copying, so `spread` sizes the cluster and not the assets in it.",
    tags: ["scatter", "clusters"],
    nodes: [
      {
        id: "centres",
        type: "pointScatterInBounds",
        params: { count: 24, boundsMin: [0, 0, 0], boundsMax: [100, 0, 100], seed: 0 },
      },
      {
        id: "local",
        // A unit CUBE, not a unit square: the local cloud has to carry
        // extent on every axis for `spread` to have three live components.
        // Y is then flattened by the default `spread` rather than by the
        // recipe, so a group is flat because it was asked to be.
        type: "pointScatterInBounds",
        params: { count: 12, boundsMin: [-1, -1, -1], boundsMax: [1, 1, 1], seed: 0 },
      },
      {
        id: "spread",
        type: "transformPoints",
        params: { scale: [4, 0, 4], rotateEuler: [0, 0, 0], translate: [0, 0, 0] },
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
        description:
          "How many points each group holds. The output count is clusters x this. One local cloud is scattered and then copied onto every centre, so every group is the SAME arrangement translated — this is also how finely a group's shape is sampled, and two groups differ by position, not by shape.",
        min: 0,
      },
      {
        name: "spread",
        targets: [{ node: "spread", param: "scale" }],
        description:
          'Half-extent of one group, per axis, in world units: its points land uniformly in a BOX running -spread to +spread around the centre, so a group measures 2 * spread across and the reach is exactly linear in the value. The peak sits just under `spread` because it is `perCluster` uniform draws deep, not because the bound is different: measured 0.88 to 0.96 of it at the default 12 points per group, 0.995 at 300. All three axes are live, Y included. It DEFAULTS to [4, 0, 4] — a flat ground patch, where every point of a group shares its centre\'s Y exactly — because the common group stands on the ground; [4, 4, 4] gives a cube-shaped group instead, and [4, 12, 4] a column. The box bounds the POINTS while `boundsMin`/`boundsMax` bound only the CENTRES, so the result overhangs the box by up to `spread` on each side, on Y as well once the group has height. Nothing clamps that, on purpose — inset the bounds by `spread` when the points must stay inside a region. A bare number is not accepted: pass [4, 0, 4], or {"fn":"constant","value":4} for equal reach on all three axes.',
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
      "Fills a box with a jittered grid of points and keeps only the cells where a 3D noise field rises above a threshold, carving connected volumes out of solid — caves, clouds, asteroid interiors, floating islands. COUNT: the grid is extent cubed over cellSize cubed, so this is the one primitive here that can blow up; halving `cellSize` costs eight times as many points in a three-dimensional region (four over a flat one) before the threshold takes any away. Connect the `in` pin and the bounds come from that geometry's own extents instead of the params, which is the library's only 'adapt to whatever arrives' mechanism. VARIATION: the jitter varies per instance but the CARVE PATTERN does not, so two instances hollow out the same shape unless their `variant` differs.",
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
        description:
          "Grid resolution in world units. The candidate count is floor(extent / cellSize) per axis — at least 1, whole cells only, no partial cell at the far edge — multiplied together, so halving it costs EIGHT times as many points only where the region is fully three-dimensional: over a flat region — a plane, or any scatter with a constant Y — it is four times, and along a line twice. Measured on the default 32-unit box: cellSize 8 gives 64 candidates, 4 gives 512, 2 gives 4096, 1 gives 32768, exactly 8x per halving because 32 divides by all of them. Measured on the same box arriving through the `in` pin, where a scatter's extent lands just under 32 and every axis loses its last whole cell: 27, 343, 3375, 29791 (3, 7, 15 and 31 per axis), with the ratios running 12.7x, 9.8x, 8.8x down toward 8. The threshold then takes some away; this is the count BEFORE it.",
      },
      {
        name: "jitter",
        targets: [{ node: "vol", param: "jitter" }],
        description:
          "How far each point may wander from its own lattice node: 0 is a hard lattice, 1 is fully irregular. The offset is uniform on each axis, exactly linear in the value, and bounded by HALF A CELL structurally rather than statistically — a point never leaves the cell it was generated in, at any jitter, so neighbours keep their grid order, never cross, and stay at least (1 - jitter) * cell apart. Build non-overlap on that. What that bound is NOT is half of the `cellSize` you typed, and the difference surprises: the grid divides the extent into floor(extent / `cellSize`) whole cells, so the real cell is extent / that — equal to `cellSize` only when the extent is a whole multiple of it, wider otherwise. Measured on the default 32-unit box at cellSize 2 (16 whole cells of exactly 2): +/-1.0 at jitter 1. Measured with the bounds taken from the `in` pin, where the extent lands just under 32 and leaves 15 cells of 2.13: +/-1.066 — 0.53 of the number typed, and still exactly half of its own cell.",
        min: 0,
        max: 1,
        acceptsField: true,
      },
      {
        name: "threshold",
        targets: [{ node: "threshAttr", param: "value" }],
        description:
          "Where the cut falls on the 0..1 noise. Higher leaves less material, but the noise only reaches the MIDDLE of that range, so the whole knob lives between about 0.35 (solid) and 0.68 (empty) — four octaves of normalized fBm are bell-shaped around 0.5 and never near the ends. Measured on the default 32-unit box at cellSize 2: 0.3 keeps 100% of the grid, 0.45 keeps 85%, 0.5 keeps 65%, 0.55 keeps 41%, 0.6 keeps 18%, 0.65 keeps 3.6%, 0.7 keeps nothing. The centre of that band is NOT fixed at 0.5 the way the flat filters' is: the box times `frequency` decides how much of the field is sampled, and a small window sits wherever its own patch of noise happens to sit (the same box read as a 2D spread has 0.5 keeping half rather than two thirds). Sweep in steps of 0.02, not 0.1.",
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
