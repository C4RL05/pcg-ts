/**
 * `shape/*` — a point set describing a region or skeleton, with no input.
 *
 * Every one is built at UNIT SIZE around the origin and placed by a
 * trailing `transformPoints`, because an exposed param is pure fan-out of
 * one identical value: no arithmetic can turn a `radius` into the pair of
 * corners `[-r,0,-r]` and `[r,0,r]` that a bounds-based construction would
 * need. The trailing transform does the arithmetic the param mechanism
 * cannot, and it is why `size`, `rotate` and `center` are the same three
 * knobs on all four.
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
 */
import type { SerializedNode } from "../index.js";
import { TAU, attr, call, component, constant, position, vec } from "./expr.js";
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

/** The three placement knobs, identical across the family. */
function placementParams(): PrimitiveParamDecl[] {
  return [
    {
      name: "size",
      targets: [{ node: "place", param: "scale" }],
      description:
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
      "Places points evenly around a circle in the XZ plane, optionally sweeping only part of the way round, then sizes, rotates and moves the result. COUNT: `count` is the number of sample positions across the sweep with both ends included, so a full sweep drops the duplicate seam point and yields count - 1 points, while a partial sweep keeps all of them. Fully deterministic: two instances with the same params are identical, which is what a ring should be. Writes `P`; leaves the per-point `scale` attribute at 1 so the ring's size does not become the asset's size.",
    tags: ["curve", "radial"],
    nodes: [
      { id: "line", type: "pointLine", params: { count: 24, start: [0, 0, 0], end: [1, 0, 0] } },
      {
        id: "sweepAttr",
        type: "setAttribute",
        params: { name: "sweep", domain: "point", type: "f32", tupleSize: 1, value: 1 },
      },
      {
        id: "seam",
        type: "filterByExpression",
        params: {
          // Keep everything on a partial sweep; on a full one drop the
          // last sample, which sits exactly on the first.
          predicate: call("max", call("lt", u(), 1), call("lt", attr("sweep"), 1)),
          seed: 0,
        },
      },
      {
        id: "ring",
        type: "transformPoints",
        params: {
          scale: [0, 0, 0],
          rotateEuler: [0, 0, 0],
          translate: vec(
            call("cos", call("mul", call("mul", u(), attr("sweep")), TAU)),
            0,
            call("sin", call("mul", call("mul", u(), attr("sweep")), TAU)),
          ),
        },
      },
      place(),
      resetScale(),
      { id: "cleanup", type: "removeAttribute", params: { names: ["sweep"], domain: "point", strict: true } },
    ],
    connections: [
      { from: ["line", "out"], to: ["sweepAttr", "in"] },
      { from: ["sweepAttr", "out"], to: ["seam", "in"] },
      { from: ["seam", "out"], to: ["ring", "in"] },
      { from: ["ring", "out"], to: ["place", "in"] },
      { from: ["place", "out"], to: ["reset", "in"] },
      { from: ["reset", "out"], to: ["cleanup", "in"] },
    ],
    outputs: [{ name: "out", node: "cleanup", pin: "out" }],
    params: [
      {
        name: "count",
        targets: [{ node: "line", param: "count" }],
        description: "Sample positions across the sweep, both ends included. A full sweep drops the duplicate seam, so it yields count - 1 points.",
        min: 1,
      },
      {
        name: "sweep",
        targets: [{ node: "sweepAttr", param: "value" }],
        description: "How far round to go: 1 is a closed circle, 0.5 a half-circle, 0.25 a quarter arc.",
        min: 0,
        max: 1,
        acceptsField: true,
      },
      ...placementParams(),
    ],
  });

  definePrimitive("shape/spiral", {
    title: "Points winding outward over a number of turns",
    description:
      "Winds points outward from the origin over a given number of turns in the XZ plane — an Archimedean spiral, evenly spaced in angle — then sizes, rotates and moves the result. `size` is the OUTER radius: the innermost point sits at the centre. Fully deterministic: two instances with the same params are identical. Writes `P`; leaves the per-point `scale` attribute at 1.",
    tags: ["curve", "radial"],
    nodes: [
      { id: "line", type: "pointLine", params: { count: 160, start: [0, 0, 0], end: [1, 0, 0] } },
      {
        id: "turnsAttr",
        type: "setAttribute",
        params: { name: "turns", domain: "point", type: "f32", tupleSize: 1, value: 3 },
      },
      {
        id: "spiral",
        type: "transformPoints",
        params: {
          scale: [0, 0, 0],
          rotateEuler: [0, 0, 0],
          translate: vec(
            call("mul", u(), call("cos", call("mul", call("mul", u(), attr("turns")), TAU))),
            0,
            call("mul", u(), call("sin", call("mul", call("mul", u(), attr("turns")), TAU))),
          ),
        },
      },
      place(),
      resetScale(),
      { id: "cleanup", type: "removeAttribute", params: { names: ["turns"], domain: "point", strict: true } },
    ],
    connections: [
      { from: ["line", "out"], to: ["turnsAttr", "in"] },
      { from: ["turnsAttr", "out"], to: ["spiral", "in"] },
      { from: ["spiral", "out"], to: ["place", "in"] },
      { from: ["place", "out"], to: ["reset", "in"] },
      { from: ["reset", "out"], to: ["cleanup", "in"] },
    ],
    outputs: [{ name: "out", node: "cleanup", pin: "out" }],
    params: [
      {
        name: "count",
        targets: [{ node: "line", param: "count" }],
        description: "Points along the spiral, evenly spaced in angle (so they crowd near the centre).",
        min: 1,
      },
      {
        name: "turns",
        targets: [{ node: "turnsAttr", param: "value" }],
        description: "How many full revolutions the spiral makes between the centre and the outer radius.",
        min: 0,
        acceptsField: true,
      },
      ...placementParams(),
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
