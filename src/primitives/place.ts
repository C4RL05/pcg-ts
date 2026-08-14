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
import { TAU, type Spec, attr, call, param, randomField } from "./expr.js";
import { definePrimitive } from "./define.js";

/**
 * A random angle around the curve, in radians, scaled by the recipe's own
 * `spread` knob.
 *
 * The knob reaches the expression by NAME: every exposed param binds into
 * its body's field scope, so `{ fn: "param", name: "spread" }` reads
 * whatever the instance holds. It used to travel as an attribute a
 * `setAttribute` wrote and a `removeAttribute` took away again, because
 * fan-out into an inner param slot was the only route in and a field spec
 * has no slot. Same change as `expr.ts`'s `noisePosition`.
 */
const RADIAL_ANGLE: Spec = call(
  "mul",
  randomField("radial"),
  call("mul", TAU, param("spread")),
);

/**
 * The unit vector at {@link RADIAL_ANGLE} in the plane perpendicular to
 * the tangent, fed to `orientAlongVector` as a per-point `up`.
 *
 * `cos(a) * curveNormal + sin(a) * curveBinormal` is the whole idea: for
 * axis '+z' the `up` hint IS the roll, so aiming the fan needs no change
 * to the direction at all. A constant world up cannot express this, which
 * is why `up` is field-capable and why `writeCurveFrame` exists.
 */
const RADIAL_UP: Spec = call(
  "add",
  call("mul", call("cos", RADIAL_ANGLE), attr("curveNormal", 3)),
  call("mul", call("sin", RADIAL_ANGLE), attr("curveBinormal", 3)),
);

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
      "Casts a ray from every point along a direction, moves each one to where it hits the mesh, and DISCARDS the ones that hit nothing — which is what turns any flat scatter into a terrain-aware one. THREE nodes casting ONE ray: the transfer moves `P` to the hit AND reports per point whether it found anything, so the filter that discards the misses reads the outcome of the very ray that did the moving. It used to be five nodes and two rays, the second cast only to recover what the first already knew; there is nothing left to get out of order. A miss keeps its prior position and is filtered out. Fully deterministic. Reads and writes `P`; the internal `__onSurface` flag column (bool, tuple 1) is removed again. PRECONDITION: the input must not already carry `__onSurface` under a different shape — the hit flag refuses to delete an existing column, so it stops instead of cooking something plausible; an input holding the name as a bool is harmless, since every point is rewritten.",
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
      "Places points at even arc-length steps along every path of the supplied `curve` and turns each one to face the way the curve is going — fence posts, streetlights, bollards, sleepers. Each path is measured and resampled on its OWN length, so several paths in one input stay separate and each gets its own run of points; `splineSample` would treat them as one concatenated curve instead. PRECONDITION: `curve` must carry polyline topology — `shape/path-loop`, `shape/path-meander` or a `pointsToPath` node, never a bare point cloud, and never anything that has been through a step that can REMOVE points: the `filter/*` family, `partitionByAttribute` and `mergePoints` all destroy topology, and `filterByAttribute` does so even when its predicate keeps every point. Category is not the rule — `projectToPlane` is a `filter` that preserves it, because it clones. The points are NEW: they carry `P`, the unit `tangent`, `curveU` (0..1 along their own path) and `rot`, plus the standard attributes at their defaults. Nothing written on the curve's own POINTS survives, which is what `write/orient-along-path` is for — but every PRIMITIVE attribute does: a post placed along a road carries that road's `roadWidth` and `roadKind`, because a sample inherits the primitive it was taken from. The output is still a path, so it can be resampled again. Fully deterministic.",
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

  definePrimitive("place/radial-on-curve", {
    title: "Place points along a curve and aim them radially",
    description:
      "Places points at even arc-length steps along every path of the supplied `curve`, then rolls each one to a random angle AROUND the curve — spikes on a mace, bristles on a brush, brackets round a mast, leaves up a stem, buds on a branch. It is deliberately distinct from `place/along-curve`, which spaces points the same way but aims them ALONG the tangent with a CONSTANT world `up`: that fixes every asset in the same world orientation, and it flips them a half turn wherever the curve turns over. Here the up hint is per point — cos(a) * `curveNormal` + sin(a) * `curveBinormal`, the unit vector at a random angle a in the plane perpendicular to the tangent, taken from the rotation-minimizing frame `write/curve-frame` describes — so the assets fan out around the path and the fan follows the path however it bends. A constant up simply cannot express that, which is the whole reason to reach for this one. GEOMETRY: the asset's local +z runs along the curve and its local +y is the radial direction, so a prop that must stick OUT of the path wants its length on +y. The points are NEW: they carry `P`, the unit `tangent`, `curveU`, `curveNormal`, `curveBinormal` and `rot`, plus the standard attributes at their defaults, and nothing written on the curve's own POINTS survives — use `write/curve-frame` and an `orientAlongVector` of your own if it must. Every PRIMITIVE attribute does survive, since a sample inherits the polyline it was taken from. PRECONDITION: `curve` must carry polyline topology and must not have been through anything that can REMOVE points — the `filter/*` family, `partitionByAttribute` and `mergePoints` all destroy it, and `filterByAttribute` does so even when its predicate keeps every point. VARIATION: yes — the angle is drawn from the evaluation context, so two instances in one graph fan differently on their own; there is no seed knob, so an explicit re-roll means a different `spread`. A CLOSED path does not come back seamless: the frame is transported around the loop and returns rotated by that curve's residual angle, so the fan does not line up across the seam. The output is still a path and can be resampled again.",
    tags: ["curve", "path", "instancing"],
    nodes: [
      { id: "resample", type: "pathResample", params: { mode: "count", count: 24, spacing: 1 } },
      // AFTER the resample, never before: pathResample builds new points
      // and does not carry the input's point attributes, so a frame
      // written upstream would be dropped right here.
      {
        id: "frame",
        type: "writeCurveFrame",
        params: {
          tangentName: "tangent",
          normalName: "curveNormal",
          binormalName: "curveBinormal",
        },
      },
      {
        id: "orient",
        type: "orientAlongVector",
        params: { direction: attr("tangent", 3), up: RADIAL_UP, axis: "+z" },
      },
    ],
    connections: [
      { from: ["resample", "out"], to: ["frame", "in"] },
      { from: ["frame", "out"], to: ["orient", "in"] },
    ],
    inputs: [{ name: "curve", node: "resample", pin: "in" }],
    outputs: [{ name: "out", node: "orient", pin: "out" }],
    params: [
      {
        name: "count",
        targets: [{ node: "resample", param: "count" }],
        description:
          "Points per path: exactly this many come out whatever the path's length, evenly spaced at length / (count - 1), and both ends are always occupied. At least 2 (3 on a closed path). For a fixed pitch in world units instead, resample with `place/along-curve` in 'spacing' mode first and feed the result in here.",
        min: 2,
      },
      {
        name: "spread",
        targets: [],
        default: 1,
        description:
          "How much of a full turn around the curve the fan covers, as a fraction: 1 spreads uniformly over the whole circle, 0.25 over a quarter turn, and 0 aims every point the same way — straight along the transported `curveNormal`, which is a smooth ribbon rather than a fan, and the one setting that does NOT vary between two instances. The angle is drawn uniformly over 0..spread turns, so it is one-sided: the fan opens from the normal in one direction only, and a spread of 0.5 covers a half turn from it rather than a quarter turn either side. Values above 1 wrap and buy nothing.",
        min: 0,
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
