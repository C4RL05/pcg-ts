/**
 * `place/*` — put points on or against supplied geometry. Every entry has
 * a geometry input pin for the host's mesh.
 *
 * Until this phase the family could not exist in a saved graph at all:
 * `dataInput` was the only door for a mesh and its items are injected at
 * runtime, so a serialized graph carried none. `meshPrimitive` is the
 * mesh source that changes that — a plane or a box, built in-graph, with
 * the uv and triangle topology `surfaceSample` and the raycast mapping
 * need. Feed one into `surface` and everything here cooks from JSON.
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
        description: "Steepest ground still plantable, on the 0..1 slope scale (0 is flat, 1 is a vertical wall).",
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
      "Casts a ray from every point along a direction, moves each one to where it hits the mesh, and DISCARDS the ones that hit nothing — which is what turns any flat scatter into a terrain-aware one. Two rays are cast, not one, and the second is the content: a miss keeps its prior value rather than reporting itself, so points that hit nothing would otherwise stay floating with no per-point way to find them. A marker stamped on the surface before the transfer comes back as 1 on a hit and 0 on a miss, which is what makes the discard possible at all. Fully deterministic. Reads and writes `P`; the marker column is removed again.",
    tags: ["surface", "raycast", "terrain"],
    nodes: [
      {
        id: "mark",
        type: "setAttribute",
        params: { name: "__onSurface", domain: "point", type: "f32", tupleSize: 1, value: 1 },
      },
      {
        id: "hit",
        type: "transferAttribute",
        params: {
          name: "__onSurface",
          mapping: "raycast",
          attrDomain: "point",
          uvAttr: "uv",
          direction: [0, -1, 0],
          directionAttr: "",
          maxDistance: 0,
          missCountAttr: "",
        },
      },
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
      { from: ["mark", "out"], to: ["hit", "source"] },
      { from: ["mark", "out"], to: ["snap", "source"] },
      { from: ["hit", "out"], to: ["snap", "in"] },
      { from: ["snap", "out"], to: ["keep", "in"] },
      { from: ["keep", "out"], to: ["cleanup", "in"] },
    ],
    inputs: [
      { name: "points", node: "hit", pin: "in" },
      { name: "surface", node: "mark", pin: "in" },
    ],
    outputs: [{ name: "out", node: "cleanup", pin: "out" }],
    params: [
      {
        name: "direction",
        targets: [
          { node: "hit", param: "direction" },
          { node: "snap", param: "direction" },
        ],
        description:
          "Which way the rays travel. [0,-1,0] drops straight down; rays are forward-only, so points below the surface miss.",
      },
      {
        name: "maxDistance",
        targets: [
          { node: "hit", param: "maxDistance" },
          { node: "snap", param: "maxDistance" },
        ],
        description: "Longest drop that still counts as a landing, in world units. 0 means unlimited.",
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
