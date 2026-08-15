/**
 * `shape/*` — a point set describing a region or skeleton, with no input.
 *
 * Every one is built at UNIT SIZE around the origin and placed by a
 * trailing `transformPoints`, because neither route a knob has into a body
 * can turn a `radius` into the pair of corners `[-r,0,-r]` and `[r,0,r]`
 * that a bounds-based construction would need: fan-out writes one
 * identical value with no arithmetic in between, and the field expression
 * that COULD do the arithmetic cannot stand in a bounds slot, which is a
 * plain `vec3` that refuses a field. The trailing transform does the
 * arithmetic neither mechanism can, and it is why `size`, `rotate` and
 * `center` are the same three knobs on all four.
 *
 * Two mechanisms are shared and neither is obvious:
 *
 * - **`scale: [0,0,0]` turns `transformPoints` into "set the position from
 *   a field"**, because the field resolves on the INPUT positions while
 *   the scaled input contributes nothing. That is how a straight line
 *   becomes a circle: the line's own parameterisation supplies the angle,
 *   so `count` stays exposable (a constant angular step would have had to
 *   know the count, which nothing inside a field can read).
 * - **`transformPoints` also multiplies the per-point `scale` ATTRIBUTE**,
 *   so a shape placed at size 8 would hand every point a scale of 8 and
 *   spawn assets eight times too big — and the `scale: [0,0,0]` trick
 *   would zero it outright, spawning nothing at all. Each recipe therefore
 *   ends by resetting `scale` to 1. Placement is layout, not asset size.
 *
 * Two of them emit a PATH rather than a point cloud — polyline topology
 * over the points, built by a trailing `pointsToPath`. They are the
 * family's answer to "where does a curve come from in a saved graph", and
 * they carry the `curve` tag, which on this catalog means exactly one
 * thing: the OUTPUT carries polyline topology. `shape/ring` and
 * `shape/spiral` trace a curve's outline as loose points and do not.
 */
import type { SerializedNode } from "../index.js";
import { TAU, call, component, constant, param, position, tunableFbm, vec } from "./expr.js";
import { type PrimitiveParamDecl, definePrimitive } from "./define.js";

/** Reset the per-point `scale` attribute after placement. See the header. */
function resetScale(): SerializedNode {
  return {
    id: "reset",
    type: "setAttribute",
    params: {
      name: "scale",
      domain: "point",
      type: "f32",
      tupleSize: 3,
      value: constant([1, 1, 1]),
    },
  };
}

/** The trailing placement transform every shape ends with. */
function place(): SerializedNode {
  return {
    id: "place",
    type: "transformPoints",
    params: { scale: [8, 8, 8], rotateEuler: [0, 0, 0], translate: [0, 0, 0] },
  };
}

/**
 * The three placement knobs, identical across the family. `sizeDescription`
 * overrides the first one where "radius" is the wrong word for the shape.
 */
function placementParams(sizeDescription?: string): PrimitiveParamDecl[] {
  return [
    {
      name: "size",
      targets: [{ node: "place", param: "scale" }],
      description:
        sizeDescription ??
        'Size of the shape in world units — a radius for the round ones. A bare number is not accepted here: pass three numbers [8,8,8], or {"fn":"constant","value":8} for a uniform one. Unequal components give an ellipse or an ellipsoid.',
      acceptsField: true,
    },
    {
      name: "rotate",
      targets: [{ node: "place", param: "rotateEuler" }],
      description:
        "Rotation in degrees per world axis, applied about the origin before the shape is moved into place.",
      acceptsField: true,
    },
    {
      name: "center",
      targets: [{ node: "place", param: "translate" }],
      description: "Where the shape sits, in world units.",
      acceptsField: true,
    },
  ];
}

/**
 * The line's own parameter. `pointLine` runs 0 -> 1 along x, so `P.x` IS
 * the normalized position along the shape, and every angle below derives
 * from it rather than from a step the field would have to compute from
 * `count` — which nothing inside a field can read.
 */
function u(): Record<string, unknown> {
  return component(position(), 0);
}

/** Register every `shape/*` primitive. Call once, from the family index. */
export function registerShapePrimitives(): void {
  definePrimitive("shape/ring", {
    title: "Points evenly around a circle or an arc",
    description:
      "Places points evenly around a circle in the XZ plane, optionally sweeping only part of the way round, then sizes, rotates and moves the result. COUNT: `count` is exactly the number of points emitted, whatever `sweep` and `includeEnd` are. The seam is handled by `includeEnd`, not by deleting a point: left false (the default) the samples divide the sweep and the last one stops one step short, which is what a full circle needs — the end of a full sweep IS its start. Set it true for an arc that must touch both ends. Emits a loose point CLOUD, not a path: for polyline topology use `shape/path-loop`, which is this primitive plus the closure. Fully deterministic: two instances with the same params are identical, which is what a ring should be. Writes `P`; leaves the per-point `scale` attribute at 1 so the ring's size does not become the asset's size.",
    tags: ["radial", "outline"],
    nodes: [
      {
        id: "line",
        type: "pointLine",
        // includeEnd false is the seam fix: sampling [0, 1) gives `count`
        // distinct angles round a full sweep with no duplicate at the
        // start, where the old recipe sampled [0, 1] and then paid a
        // whole filter node to delete the duplicate — which also made
        // `count` mean "count - 1".
        params: { count: 24, start: [0, 0, 0], end: [1, 0, 0], includeEnd: false },
      },
      {
        id: "ring",
        type: "transformPoints",
        params: {
          scale: [0, 0, 0],
          rotateEuler: [0, 0, 0],
          translate: vec(
            call("cos", call("mul", call("mul", u(), param("sweep")), TAU)),
            0,
            call("sin", call("mul", call("mul", u(), param("sweep")), TAU)),
          ),
        },
      },
      place(),
      resetScale(),
    ],
    connections: [
      { from: ["line", "out"], to: ["ring", "in"] },
      { from: ["ring", "out"], to: ["place", "in"] },
      { from: ["place", "out"], to: ["reset", "in"] },
    ],
    outputs: [{ name: "out", node: "reset", pin: "out" }],
    params: [
      {
        name: "count",
        targets: [{ node: "line", param: "count" }],
        description: "How many points to place, and exactly how many come out — the sweep is divided into this many samples.",
        min: 1,
      },
      {
        name: "sweep",
        targets: [],
        default: 1,
        description: "How far round to go: 1 is a closed circle, 0.5 a half-circle, 0.25 a quarter arc.",
        min: 0,
        max: 1,
        acceptsField: true,
      },
      {
        name: "includeEnd",
        targets: [{ node: "line", param: "includeEnd" }],
        description:
          "Whether the last point lands exactly on the end of the sweep. Leave it false for a full circle: the end is the start, so a point there would sit on top of the first one. Set it true for a partial sweep pinned at both ends (a quarter arc whose corners must be occupied). It never changes how many points come out, only where the last one sits.",
      },
      ...placementParams(),
    ],
  });

  definePrimitive("shape/spiral", {
    title: "Points winding outward over a number of turns",
    description:
      "Winds points outward from the origin over a given number of turns in the XZ plane — an Archimedean spiral, evenly spaced in angle — then sizes, rotates and moves the result. `size` is the OUTER radius: the innermost point sits at the centre and the outermost exactly on the rim. Emits a loose point CLOUD, not a path. Fully deterministic: two instances with the same params are identical. Writes `P`; leaves the per-point `scale` attribute at 1.",
    tags: ["radial", "outline"],
    nodes: [
      // includeEnd stays true, unlike `shape/ring`: a spiral's end is a
      // real endpoint on the outer rim, not a seam that meets its start.
      { id: "line", type: "pointLine", params: { count: 160, start: [0, 0, 0], end: [1, 0, 0], includeEnd: true } },
      {
        id: "spiral",
        type: "transformPoints",
        params: {
          scale: [0, 0, 0],
          rotateEuler: [0, 0, 0],
          translate: vec(
            call("mul", u(), call("cos", call("mul", call("mul", u(), param("turns")), TAU))),
            0,
            call("mul", u(), call("sin", call("mul", call("mul", u(), param("turns")), TAU))),
          ),
        },
      },
      place(),
      resetScale(),
    ],
    connections: [
      { from: ["line", "out"], to: ["spiral", "in"] },
      { from: ["spiral", "out"], to: ["place", "in"] },
      { from: ["place", "out"], to: ["reset", "in"] },
    ],
    outputs: [{ name: "out", node: "reset", pin: "out" }],
    params: [
      {
        name: "count",
        targets: [{ node: "line", param: "count" }],
        description: "Points along the spiral, evenly spaced in angle (so they crowd near the centre).",
        min: 1,
      },
      {
        name: "turns",
        targets: [],
        default: 3,
        description: "How many full revolutions the spiral makes between the centre and the outer radius.",
        min: 0,
        acceptsField: true,
      },
      ...placementParams(),
    ],
  });

  definePrimitive("shape/path-loop", {
    title: "A closed path around a circle",
    description:
      "Builds a CLOSED PATH — polyline topology, not a loose point cloud — around a circle in the XZ plane, then sizes, rotates and moves it. This is the curve source a saved graph reaches for: feed it to `place/along-curve`, `filter/by-distance-to-curve`, `write/orient-along-path` or the `splineSample` / `pathResample` nodes, which all report finding no polylines when handed a point cloud. COUNT: `count` is the number of corner points and exactly the number of points emitted; closure is structural (a trailing vertex back to the first point), so there is no duplicated seam point to trip over. Built on `shape/ring`, so the points also carry `scale` at 1. Fully deterministic. TOPOLOGY IS FRAGILE: anything that can REMOVE points destroys it — the `filter/*` family, `partitionByAttribute` (categorised `attribute`, not `filter`) and `mergePoints` — so whatever must see a path has to come before them. The category is not the rule: `projectToPlane` is a `filter` that PRESERVES topology because it clones rather than gathers, and `filterByAttribute` drops it even when its predicate keeps every point.",
    tags: ["curve", "path", "radial"],
    nodes: [
      // sweep 1 and includeEnd false are the closed-loop pairing, and they
      // are authored rather than exposed: a partial sweep would need
      // `closed` false as well, and one exposed param cannot derive the
      // other (fan-out carries one identical value, with no arithmetic and
      // no negation). An open arc is a different primitive, not a flag.
      {
        id: "ring",
        type: "subgraph",
        params: { count: 24, sweep: 1, includeEnd: false },
        ref: { name: "shape/ring" },
      },
      {
        id: "path",
        type: "pointsToPath",
        params: { closed: true, groupAttr: "", orderAttr: "" },
      },
    ],
    connections: [{ from: ["ring", "out"], to: ["path", "in"] }],
    outputs: [{ name: "out", node: "path", pin: "out" }],
    params: [
      {
        name: "count",
        targets: [{ node: "ring", param: "count" }],
        description: "Corner points around the loop. At least 3 — two points cannot enclose anything — and higher counts make the polygon read as a circle.",
        min: 3,
      },
      {
        name: "size",
        targets: [{ node: "ring", param: "size" }],
        description:
          'Radius of the loop in world units. A bare number is not accepted here: pass three numbers [8,8,8], or {"fn":"constant","value":8} for a uniform one. Unequal components give an ellipse.',
        acceptsField: true,
      },
      {
        name: "rotate",
        targets: [{ node: "ring", param: "rotate" }],
        description: "Rotation in degrees per world axis, applied about the origin before the loop is moved into place.",
        acceptsField: true,
      },
      {
        name: "center",
        targets: [{ node: "ring", param: "center" }],
        description: "Where the loop sits, in world units.",
        acceptsField: true,
      },
    ],
  });

  definePrimitive("shape/path-meander", {
    title: "A wandering open path between two ends",
    description:
      "Builds an open PATH — polyline topology — that runs along X and wanders off the straight line by a noise field, then evens the spacing out again by arc length. The resampling is the content: displacing a polyline sideways stretches the segments where the wander is steep, so points placed along it afterwards would bunch on the straight parts, and the fix cannot be seen in a picture until something is spawned on it. Use it for a road, a river, a fence line or a trail. COUNT: `count` is both the number of corners the wander is built from and the number of points emitted, evenly spaced along the finished curve. VARIATION: none by default — noise carries its own seed inside its field spec, so two instances wander IDENTICALLY unless their `variant` differs. Writes `P`, the unit `tangent` and `curveU` (0..1 along the path) on points the resample creates, so the recipe writes no working column at all and the per-point `scale` is 1. TOPOLOGY IS FRAGILE: anything that can REMOVE points destroys it — the `filter/*` family, `partitionByAttribute` and `mergePoints` — so a path has to reach its consumer before them. Being a `filter` is not the rule: `projectToPlane` PRESERVES topology (it clones), while `filterByAttribute` drops it even when its predicate keeps every point.",
    tags: ["curve", "path", "noise"],
    nodes: [
      // Unit space: a line from -0.5 to +0.5 along X, wandering in Z, with
      // the trailing `place` doing the arithmetic exposed params cannot.
      {
        id: "line",
        type: "pointLine",
        params: { count: 33, start: [-0.5, 0, 0], end: [0.5, 0, 0], includeEnd: true },
      },
      {
        id: "wander",
        type: "transformPoints",
        params: {
          scale: [1, 1, 1],
          rotateEuler: [0, 0, 0],
          // Sideways (Z) at scale 1: a delta, so nothing else is touched.
          translate: vec(
            0,
            0,
            call("mul", param("wander"), call("remap", tunableFbm("frequency", "variant"), 0, 1, -1, 1)),
          ),
        },
      },
      // The family's trailing placement transform, at a road's scale
      // rather than a prop's: 40 units end to end.
      {
        id: "place",
        type: "transformPoints",
        params: { scale: [40, 1, 40], rotateEuler: [0, 0, 0], translate: [0, 0, 0] },
      },
      { id: "path", type: "pointsToPath", params: { closed: false, groupAttr: "", orderAttr: "" } },
      // No `scale` reset: pathResample builds NEW points carrying the
      // standard attributes plus `tangent` and `curveU`, so the
      // placement's scale never reaches the output. The tests assert
      // exactly that.
      { id: "even", type: "pathResample", params: { mode: "count", count: 33, spacing: 1 } },
    ],
    connections: [
      { from: ["line", "out"], to: ["wander", "in"] },
      { from: ["wander", "out"], to: ["place", "in"] },
      { from: ["place", "out"], to: ["path", "in"] },
      { from: ["path", "out"], to: ["even", "in"] },
    ],
    outputs: [{ name: "out", node: "even", pin: "out" }],
    params: [
      {
        name: "count",
        targets: [
          { node: "line", param: "count" },
          { node: "even", param: "count" },
        ],
        description:
          "Points along the path, and the number of corners the wander is drawn from. A dozen or more before the wander reads as a curve rather than a zig-zag.",
        min: 2,
      },
      {
        name: "wander",
        targets: [],
        default: 0.15,
        description:
          "How far the path strays from the straight line between its ends. 0 is a straight line; above that the peak deviation is about 0.22 * wander * `size.z`, exactly linear in both — so at the default `size` [40,1,40], 0.15 strays about 1.3 units to each side and 0.5 about 4.4. Inverted, for a peak of a fraction f of `size.z`, ask for wander around 4.6 * f. This is a FRACTION OF A NOMINAL RANGE, not of the deviation you get: the value scales a noise term whose range is +/-1 in principle, but four octaves of normalized fBm sampled along one line only cover part of it, and `frequency` and `variant` move that coverage (measured 0.13 to 0.31 of wander * `size.z` across the usable range). The wander is sideways only — the path is a height field along X, so it NEVER doubles back on itself at any wander; for a curve that turns back, build the corners yourself and run `pointsToPath` over them.",
        acceptsField: true,
      },
      {
        name: "frequency",
        targets: [],
        default: 3,
        description:
          "How many bends over the length of the path, roughly: the noise sample position is multiplied by this, so smaller means longer, lazier curves.",
        acceptsField: true,
      },
      {
        name: "variant",
        targets: [],
        default: 0,
        description:
          "Offset added to the noise sample position — the per-instance re-roll, and the ONLY one: no seed can move a noise field.",
        acceptsField: true,
      },
      ...placementParams(
        'Extent in world units: X is the end-to-end length, Z scales the wander. A bare number is not accepted here: pass three numbers [40,1,40], or {"fn":"constant","value":40}.',
      ),
    ],
  });

  definePrimitive("shape/disc", {
    title: "Points scattered uniformly inside a circle",
    description:
      "Scatters points uniformly inside a disc in the XZ plane by scattering a square and rejecting the corners — the circular counterpart to scattering a box, and the right answer when scattering a square and hoping is wrong. COUNT: `count` is the number of CANDIDATES; the disc keeps about 78.5% of them, so asking for 1000 gives roughly 785 points. VARIATION: yes — two instances in one graph scatter differently, and `seed` re-rolls one explicitly. Writes `P`; leaves the per-point `scale` attribute at 1.",
    tags: ["scatter", "radial"],
    nodes: [
      {
        id: "scatter",
        type: "pointScatterInBounds",
        params: { count: 600, boundsMin: [-1, 0, -1], boundsMax: [1, 0, 1], seed: 0 },
      },
      {
        id: "keep",
        type: "filterByExpression",
        params: { predicate: call("le", call("length", position()), 1), seed: 0 },
      },
      place(),
      resetScale(),
    ],
    connections: [
      { from: ["scatter", "out"], to: ["keep", "in"] },
      { from: ["keep", "out"], to: ["place", "in"] },
      { from: ["place", "out"], to: ["reset", "in"] },
    ],
    outputs: [{ name: "out", node: "reset", pin: "out" }],
    params: [
      {
        name: "count",
        targets: [{ node: "scatter", param: "count" }],
        description: "Candidates scattered before the corners are rejected. About 78.5% survive.",
        min: 0,
      },
      {
        name: "seed",
        targets: [{ node: "scatter", param: "seed" }],
        description: "Re-rolls the scatter. Two instances already differ without it.",
      },
      ...placementParams(),
    ],
  });

  definePrimitive("shape/sphere-points", {
    title: "Points scattered uniformly on a sphere",
    description:
      "Scatters points uniformly over the surface of a sphere, by rejecting a cube scatter down to the ball first and then pushing every survivor out to the surface. The rejection step is the content: normalizing a cube scatter directly piles points up toward the eight corner directions, and the result looks wrong without looking obviously wrong. COUNT: `count` is the number of CANDIDATES; the ball keeps about 52.4% of them. VARIATION: yes — two instances in one graph scatter differently, and `seed` re-rolls one explicitly. Writes `P`; leaves the per-point `scale` attribute at 1.",
    tags: ["scatter", "radial"],
    nodes: [
      {
        id: "scatter",
        type: "pointScatterInBounds",
        params: { count: 800, boundsMin: [-1, -1, -1], boundsMax: [1, 1, 1], seed: 0 },
      },
      {
        id: "keep",
        type: "filterByExpression",
        params: { predicate: call("le", call("length", position()), 1), seed: 0 },
      },
      {
        id: "shell",
        type: "transformPoints",
        params: { scale: [0, 0, 0], rotateEuler: [0, 0, 0], translate: call("normalize", position()) },
      },
      place(),
      resetScale(),
    ],
    connections: [
      { from: ["scatter", "out"], to: ["keep", "in"] },
      { from: ["keep", "out"], to: ["shell", "in"] },
      { from: ["shell", "out"], to: ["place", "in"] },
      { from: ["place", "out"], to: ["reset", "in"] },
    ],
    outputs: [{ name: "out", node: "reset", pin: "out" }],
    params: [
      {
        name: "count",
        targets: [{ node: "scatter", param: "count" }],
        description: "Candidates scattered in the cube before rejection to the ball. About 52.4% survive.",
        min: 0,
      },
      {
        name: "seed",
        targets: [{ node: "scatter", param: "seed" }],
        description: "Re-rolls the scatter. Two instances already differ without it.",
      },
      ...placementParams(),
    ],
  });
}
