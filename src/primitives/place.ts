/**
 * `place/*` — put points on or against supplied geometry. Every entry has
 * a geometry input pin for the host it works against: a `surface` mesh for
 * the terrain ones, a `curve` for the path one.
 *
 * Until phase 37 the family could not exist in a saved graph at all:
 * `dataInput` was the only door for a mesh and its items are injected at
 * runtime, so a serialized graph carried none. `meshPrimitive` is the
 * mesh source that changes that — a plane or a box, built in-graph, with
 * the uv and triangle topology `surfaceSample` and the raycast mapping
 * need. Feed one into `surface` and everything here cooks from JSON.
 *
 * `place/along-curve` was CUT in that phase for exactly the same reason on
 * the curve side, and `pointsToPath` (and `shape/path-loop` over it) is
 * what brings it back.
 */
import { attr } from "./expr.js";
import { definePrimitive } from "./define.js";

/** Register every `place/*` primitive. Call once, from the family index. */
export function registerPlacePrimitives(): void {
  definePrimitive("place/on-surface", {
    title: "Scatter points across a mesh with height and slope",
    description:
      "Scatters points over a triangle mesh with probability proportional to triangle area, then stamps the two standard terrain quantities — `height` (world Y) and `slope` (1 - normal.y) — so downstream filters have something to test without re-deriving it. The points also carry the flat per-triangle `normal` the sampler writes. COUNT: `count` is the number of CANDIDATES; with the default density of 1 every one is kept, and a lower `density` keeps proportionally fewer. VARIATION: yes — two instances in one graph sample differently, and `seed` re-rolls one explicitly. Writes `height`, `slope`, `normal`, `density`.",
    tags: ["surface", "terrain", "scatter"],
    nodes: [
      { id: "sample", type: "surfaceSample", params: { count: 1000, seed: 0, densityField: 1 } },
      { id: "terrain", type: "subgraph", params: {}, ref: { name: "write/height-slope" } },
    ],
    connections: [{ from: ["sample", "out"], to: ["terrain", "in"] }],
    inputs: [{ name: "surface", node: "sample", pin: "in" }],
    outputs: [{ name: "out", node: "terrain", pin: "out" }],
    params: [
      {
        name: "count",
        targets: [{ node: "sample", param: "count" }],
        description: "Candidates placed on the mesh before density acceptance.",
        min: 0,
      },
      {
        name: "density",
        targets: [{ node: "sample", param: "densityField" }],
        description:
          "Acceptance probability per candidate, 0..1 — where sampling is allowed at all. Pass a field spec to make it vary across the surface.",
        acceptsField: true,
      },
      {
        name: "seed",
        targets: [{ node: "sample", param: "seed" }],
        description: "Re-rolls the sampling. Two instances already differ without it.",
      },
    ],
  });

  definePrimitive("place/plantable", {
    title: "Scatter points only where vegetation could grow",
    description:
      "Scatters points on a mesh and keeps only the ones on gentle enough ground below a height limit — the standard 'where can vegetation go' test, and the shape every forest in the demo corpus is built from. `maxSlope` is on the 0..1 scale `place/on-surface` writes, where 0 is dead flat: 0.3 is about a 45-degree limit. VARIATION: yes, through the scatter. Built on `place/on-surface`, so the output carries `height`, `slope`, `normal` and `density` too.",
    tags: ["surface", "terrain", "vegetation"],
    nodes: [
      { id: "pts", type: "subgraph", params: {}, ref: { name: "place/on-surface" } },
      {
        id: "slope",
        type: "filterByAttribute",
        params: { attribute: "slope", comparison: "le", value: 0.3, stringValue: "" },
      },
      {
        id: "height",
        type: "filterByAttribute",
        params: { attribute: "height", comparison: "le", value: 60, stringValue: "" },
      },
    ],
    connections: [
      { from: ["pts", "out"], to: ["slope", "in"] },
      { from: ["slope", "out"], to: ["height", "in"] },
    ],
    inputs: [{ name: "surface", node: "pts", pin: "surface" }],
    outputs: [{ name: "out", node: "height", pin: "out" }],
    params: [
      {
        name: "count",
        targets: [{ node: "pts", param: "count" }],
        description: "Candidates placed on the mesh before the slope and height tests.",
        min: 0,
      },
      {
        name: "density",
        targets: [{ node: "pts", param: "density" }],
        description: "Acceptance probability per candidate, 0..1. Pass a field spec to make it vary across the surface.",
        acceptsField: true,
      },
      {
        name: "seed",
        targets: [{ node: "pts", param: "seed" }],
        description: "Re-rolls the sampling. Two instances already differ without it.",
      },
      {
        name: "maxSlope",
        targets: [{ node: "slope", param: "value" }],
        description:
          "Steepest ground still plantable, on the `slope` scale `write/height-slope` writes — which is 1 - cos(angle), NOT a fraction of 90 degrees, so it is heavily compressed at the flat end and half the scale already covers two thirds of the range of real slopes. The default 0.3 is therefore a 45-degree limit, not the 27-degree one a linear reading gives. The anchors, measured: 10 degrees is 0.015, 20 is 0.060, 30 is 0.134, 45 is 0.293, 60 is 0.500, 75 is 0.741, 90 is 1. Inverted, for a limit of A degrees pass 1 - cos(A).",
      },
      {
        name: "maxHeight",
        targets: [{ node: "height", param: "value" }],
        description: "Highest world Y still plantable — a tree line.",
      },
    ],
  });

  definePrimitive("place/drop-to-surface", {
    title: "Drop points onto a mesh and discard the misses",
    description:
      "Casts a ray from every point along a direction, moves each one to where it hits the mesh, and DISCARDS the ones that hit nothing — which is what turns any flat scatter into a terrain-aware one. ONE ray is cast: the transfer moves `P` to the hit and reports per point whether it found anything, so the discard reads the outcome of the very ray that did the moving. A miss keeps its prior position and is filtered out. Fully deterministic. Reads and writes `P`; the internal `__onSurface` flag column is removed again.",
    tags: ["surface", "raycast", "terrain"],
    // THREE nodes, and the count is load-bearing. This used to stamp a
    // marker on the surface and cast a SECOND ray purely to recover which
    // points the first one hit — the per-point answer existed inside the
    // transfer and was thrown away, so it was queried again. Phase 37's
    // mutation testing found a real bug living in exactly that gap: swap
    // the two passes and every test still passed until the surface was
    // TILTED, at which point snapping first left the second, forward-only
    // ray starting a hair below the plane and discarding points that had
    // genuinely landed. `transferAttribute.hitAttr` deletes the second ray
    // and the bug's entire surface area with it. Do not reintroduce a
    // second raycast here; if a hit flag is needed, it comes off the
    // transfer that moved the point.
    nodes: [
      {
        id: "snap",
        type: "transferAttribute",
        params: {
          name: "P",
          mapping: "raycast",
          attrDomain: "point",
          uvAttr: "uv",
          direction: [0, -1, 0],
          directionAttr: "",
          maxDistance: 0,
          missCountAttr: "",
          hitAttr: "__onSurface",
        },
      },
      {
        id: "keep",
        type: "filterByAttribute",
        params: { attribute: "__onSurface", comparison: "eq", value: 1, stringValue: "" },
      },
      {
        id: "cleanup",
        type: "removeAttribute",
        params: { names: ["__onSurface"], domain: "point", strict: true },
      },
    ],
    connections: [
      { from: ["snap", "out"], to: ["keep", "in"] },
      { from: ["keep", "out"], to: ["cleanup", "in"] },
    ],
    inputs: [
      { name: "points", node: "snap", pin: "in" },
      { name: "surface", node: "snap", pin: "source" },
    ],
    outputs: [{ name: "out", node: "cleanup", pin: "out" }],
    params: [
      {
        name: "direction",
        targets: [{ node: "snap", param: "direction" }],
        description:
          "Which way the ray travels. [0,-1,0] drops straight down; rays are forward-only, so points below the surface miss.",
      },
      {
        name: "maxDistance",
        targets: [{ node: "snap", param: "maxDistance" }],
        description: "Longest drop that still counts as a landing, in world units. 0 means unlimited.",
        min: 0,
      },
    ],
  });

  definePrimitive("place/along-curve", {
    title: "Space points along a curve and turn them to follow it",
    description:
      "Places points at even arc-length steps along every path of the supplied `curve` and turns each one to face the way the curve is going — fence posts, streetlights, bollards, sleepers. Each path is measured and resampled on its OWN length, so several paths in one input stay separate and each gets its own run of points; `splineSample` would treat them as one concatenated curve instead. PRECONDITION: `curve` must carry polyline topology — `shape/path-loop`, `shape/path-meander` or a `pointsToPath` node, never a bare point cloud, and never anything that has been through a step that can REMOVE points: the `filter/*` family, `partitionByAttribute` and `mergePoints` all destroy topology, and `filterByAttribute` does so even when its predicate keeps every point. Category is not the rule — `projectToPlane` is a `filter` that preserves it, because it clones. The points are NEW: they carry `P`, the unit `tangent`, `curveU` (0..1 along their own path) and `rot`, plus the standard attributes at their defaults — nothing written on the curve's own points survives, which is what `write/orient-along-path` is for. The output is still a path, so it can be resampled again. Fully deterministic.",
    tags: ["curve", "path", "instancing"],
    nodes: [
      { id: "resample", type: "pathResample", params: { mode: "count", count: 24, spacing: 1 } },
      {
        id: "orient",
        type: "orientAlongVector",
        // The tangent pathResample just wrote, read back by name. This
        // coupling is the primitive: the sampler's output attribute and
        // the orienting field have to agree, and nothing else states it.
        params: { direction: attr("tangent", 3), up: [0, 1, 0], axis: "+z" },
      },
    ],
    connections: [{ from: ["resample", "out"], to: ["orient", "in"] }],
    inputs: [{ name: "curve", node: "resample", pin: "in" }],
    outputs: [{ name: "out", node: "orient", pin: "out" }],
    params: [
      {
        name: "mode",
        targets: [{ node: "resample", param: "mode" }],
        description:
          "'count' puts exactly `count` points on each path whatever its length; 'spacing' steps every `spacing` world units, so longer paths get more points — the right one for evenly pitched props.",
      },
      {
        name: "count",
        targets: [{ node: "resample", param: "count" }],
        description:
          "Points per path in 'count' mode: exactly this many come out, whatever the path's length, and they are evenly spaced at length / (count - 1) — so a 40-unit path at count 5 pitches them every 10 units, and the two ends are always occupied. At least 2 (3 on a closed path); ignored in 'spacing' mode.",
        min: 2,
      },
      {
        name: "spacing",
        targets: [{ node: "resample", param: "spacing" }],
        description:
          "Distance between points in world units in 'spacing' mode — exact for every step except the LAST, which is the leftover. The walk starts at the beginning of each path, steps `spacing` until another step would overshoot, then puts a final point exactly on the end: a 40-unit path at spacing 7 comes out with gaps 7, 7, 7, 7, 7, 5. So the count per path is floor(length / spacing) + 2, or length / spacing + 1 when it divides exactly, and the far end is always the short one. For props that must be evenly pitched the whole way, pick a `spacing` that divides the path length. Must be greater than 0 and short enough to leave 2 points on the shortest path; ignored in 'count' mode.",
        min: 0,
      },
      {
        name: "axis",
        targets: [{ node: "orient", param: "axis" }],
        description: "Which local axis of the asset points along the curve. '+z' is the forward axis assets face by convention.",
      },
      {
        name: "up",
        targets: [{ node: "orient", param: "up" }],
        description: "Up hint fixing the roll around the curve; leave it at world up for props that stand on the ground.",
      },
    ],
  });

  definePrimitive("place/align-to-surface", {
    title: "Stand each point up along the surface under it",
    description:
      "Casts a ray from every point onto a mesh, reads the surface `normal` where it lands, and turns the point so its chosen local axis stands along that normal — props lying on slopes instead of standing upright through them. PRECONDITION: the `surface` must carry a `normal` point attribute (f32, tuple 3); a mesh built by `meshPrimitive` carries uv and topology but no normal, so stamp one on it first. A point whose ray misses keeps the previous normal it had, and a zero-length one keeps its existing rotation. Fully deterministic. Writes `rot` and `normal`; `P` is not moved — pair it with `place/drop-to-surface` for that.",
    tags: ["surface", "raycast", "instancing"],
    nodes: [
      {
        id: "normal",
        type: "transferAttribute",
        params: {
          name: "normal",
          mapping: "raycast",
          attrDomain: "point",
          uvAttr: "uv",
          direction: [0, -1, 0],
          directionAttr: "",
          maxDistance: 0,
          missCountAttr: "",
          hitAttr: "",
        },
      },
      {
        id: "orient",
        type: "orientAlongVector",
        params: { direction: attr("normal", 3), up: [0, 1, 0], axis: "+y" },
      },
    ],
    connections: [{ from: ["normal", "out"], to: ["orient", "in"] }],
    inputs: [
      { name: "points", node: "normal", pin: "in" },
      { name: "surface", node: "normal", pin: "source" },
    ],
    outputs: [{ name: "out", node: "orient", pin: "out" }],
    params: [
      {
        name: "axis",
        targets: [{ node: "orient", param: "axis" }],
        description: "Which local axis of the asset stands along the surface normal. '+y' is upright.",
      },
      {
        name: "up",
        targets: [{ node: "orient", param: "up" }],
        description: "Up hint fixing the roll around the normal.",
      },
      {
        name: "direction",
        targets: [{ node: "normal", param: "direction" }],
        description: "Which way the ray travels to find the surface. [0,-1,0] looks straight down.",
      },
      {
        name: "maxDistance",
        targets: [{ node: "normal", param: "maxDistance" }],
        description: "Longest ray that still counts as a find, in world units. 0 means unlimited.",
        min: 0,
      },
    ],
  });
}
