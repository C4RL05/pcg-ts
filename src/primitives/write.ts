/**
 * `write/*` — create or set attributes. The count and `P` are untouched;
 * the spawner terminal lives here too.
 *
 * This is the largest family because the point-with-attributes data model
 * puts most of the library's expressiveness in `setAttribute`, and because
 * the standard attribute names are contracts that nothing else states:
 * `filterByDensity` requires `density`, the spawner reads `rot`, `scale`
 * and `color`, and `orientAlongVector` writes `rot`. A primitive that
 * bakes the right name is not a rename of `setAttribute` — it is the only
 * place that coupling is written down.
 */
import { TAU, attr, call, component, position, ramp, randomField, tunableFbm, vec } from "./expr.js";
import { definePrimitive } from "./define.js";

/**
 * One uniform random size, drawn once and used on all three axes.
 * `randomField` is keyed, so the same key is the same stream — writing
 * three DIFFERENT keys here is what would stretch the asset differently
 * per axis, and it is the spelling this primitive exists to replace.
 */
const UNIFORM_SIZE = call("lerp", attr("sMin"), attr("sMax"), randomField("size"));

/** Register every `write/*` primitive. Call once, from the family index. */
export function registerWritePrimitives(): void {
  definePrimitive("write/height-slope", {
    title: "Stamp height and slope from a surface normal",
    description:
      "Writes the two standard terrain quantities onto points that already carry a surface normal: `height` (f32) is the world Y of each point, and `slope` (f32) is 1 - normal.y, so 0 is dead flat and 1 is a vertical wall. That scale is 1 - cos(angle) and so is NOT linear in degrees — it is compressed at the flat end, where 30 degrees is only 0.134 and 45 is 0.293, and half the scale (0.5) is already 60 degrees. Downstream filters can then test ground suitability without re-deriving either. PRECONDITION: the input must carry a `normal` point attribute (f32, tuple 3) — `surfaceSample` writes one, and `place/align-to-surface` transfers one from a mesh; without it the cook fails naming the missing attribute. Fully deterministic: two instances of this primitive produce identical output.",
    tags: ["terrain", "attributes"],
    nodes: [
      {
        id: "height",
        type: "setAttribute",
        params: { name: "height", domain: "point", type: "f32", tupleSize: 1, value: component(position(), 1) },
      },
      {
        id: "slope",
        type: "setAttribute",
        params: {
          name: "slope",
          domain: "point",
          type: "f32",
          tupleSize: 1,
          value: call("sub", 1, component(attr("normal", 3), 1)),
        },
      },
    ],
    connections: [{ from: ["height", "out"], to: ["slope", "in"] }],
    inputs: [{ name: "in", node: "height", pin: "in" }],
    outputs: [{ name: "out", node: "slope", pin: "out" }],
  });

  definePrimitive("write/density-from-noise", {
    title: "Write the standard density attribute from a noise field",
    description:
      "Writes `density` (f32, 0..1) from four octaves of normalized Perlin fBm — the exact input `filterByDensity` and the density-aware samplers expect, separated from applying it so one pattern can drive a thin, a colour and a scale. VARIATION: noise does not vary per instance. Two instances of this primitive with the same params write the IDENTICAL pattern, and no seed can change that — a noise field carries its own seed inside its spec, where no exposed param can reach. Pass a different `variant` to move the sample position to an unrelated part of the field, which is the per-instance re-roll. Writes `density`; reads nothing.",
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
      { id: "cleanup", type: "removeAttribute", params: { names: ["variant", "freq"], domain: "point", strict: true } },
    ],
    connections: [
      { from: ["variantAttr", "out"], to: ["freqAttr", "in"] },
      { from: ["freqAttr", "out"], to: ["densityAttr", "in"] },
      { from: ["densityAttr", "out"], to: ["cleanup", "in"] },
    ],
    inputs: [{ name: "in", node: "variantAttr", pin: "in" }],
    outputs: [{ name: "out", node: "cleanup", pin: "out" }],
    params: [
      {
        name: "frequency",
        targets: [{ node: "freqAttr", param: "value" }],
        description:
          "Feature size: the noise sample position is multiplied by this, so smaller means broader blobs. 0.02 gives features tens of world units across.",
        acceptsField: true,
      },
      {
        name: "variant",
        targets: [{ node: "variantAttr", param: "value" }],
        description:
          "Offset added to the noise sample position. This is the per-instance re-roll: any two different values give unrelated patterns, and the same value always reproduces. There is no seed that can do this.",
        acceptsField: true,
      },
    ],
  });

  definePrimitive("write/random-scale", {
    title: "Write one uniform random size per point",
    description:
      "Writes the standard `scale` attribute (f32, tuple 3) as ONE random size per point, drawn uniformly between min and max — both ends reachable — and written the same on all three axes. It REPLACES `scale` rather than multiplying it, so anything an earlier node wrote there is discarded and two of these in a chain do not compound. The uniformity is the content: a hand-written version reaches for a separate random per axis and gets an asset stretched differently in x, y and z, which reads as a modelling error rather than as variety. VARIATION: yes — the draw comes from the evaluation context, so two instances in one graph differ automatically, and `seed` re-rolls one of them explicitly. Writes `scale`; reads nothing.",
    tags: ["scatter", "instancing"],
    nodes: [
      {
        id: "minAttr",
        type: "setAttribute",
        params: { name: "sMin", domain: "point", type: "f32", tupleSize: 1, value: 0.7 },
      },
      {
        id: "maxAttr",
        type: "setAttribute",
        params: { name: "sMax", domain: "point", type: "f32", tupleSize: 1, value: 1.4 },
      },
      {
        id: "scaleAttr",
        type: "setAttribute",
        params: {
          name: "scale",
          domain: "point",
          type: "f32",
          tupleSize: 3,
          seed: 0,
          value: vec(UNIFORM_SIZE, UNIFORM_SIZE, UNIFORM_SIZE),
        },
      },
      { id: "cleanup", type: "removeAttribute", params: { names: ["sMin", "sMax"], domain: "point", strict: true } },
    ],
    connections: [
      { from: ["minAttr", "out"], to: ["maxAttr", "in"] },
      { from: ["maxAttr", "out"], to: ["scaleAttr", "in"] },
      { from: ["scaleAttr", "out"], to: ["cleanup", "in"] },
    ],
    inputs: [{ name: "in", node: "minAttr", pin: "in" }],
    outputs: [{ name: "out", node: "cleanup", pin: "out" }],
    params: [
      {
        name: "min",
        targets: [{ node: "minAttr", param: "value" }],
        description: "Smallest size a point can get, as a multiple of the asset's own size.",
        acceptsField: true,
      },
      {
        name: "max",
        targets: [{ node: "maxAttr", param: "value" }],
        description: "Largest size a point can get, as a multiple of the asset's own size.",
        acceptsField: true,
      },
      {
        name: "seed",
        targets: [{ node: "scaleAttr", param: "seed" }],
        description: "Re-rolls which point gets which size. 0 uses the node's own derived seed.",
      },
    ],
  });

  definePrimitive("write/random-yaw", {
    title: "Turn each point to face a random direction",
    description:
      "Writes the standard `rot` attribute so every point faces a uniformly random direction around the vertical axis, so repeated assets do not all point the same way. The field is the content: the direction an author reaches for instead — a noise vector — is SPATIALLY CORRELATED, which reads as a combed field rather than randomness and is a bug that is hard to diagnose from the result. VARIATION: yes — the draw comes from the evaluation context, so two instances in one graph differ automatically. Writes `rot`; reads nothing.",
    tags: ["scatter", "instancing"],
    nodes: [
      {
        id: "yaw",
        type: "orientAlongVector",
        params: {
          direction: vec(
            call("cos", call("mul", randomField("yaw"), TAU)),
            0,
            call("sin", call("mul", randomField("yaw"), TAU)),
          ),
          up: [0, 1, 0],
          axis: "+z",
        },
      },
    ],
    connections: [],
    inputs: [{ name: "in", node: "yaw", pin: "in" }],
    outputs: [{ name: "out", node: "yaw", pin: "out" }],
    params: [
      {
        name: "axis",
        targets: [{ node: "yaw", param: "axis" }],
        description: "Which local axis of the asset turns to face the random direction. '+z' is the forward axis assets face by convention.",
      },
      {
        name: "up",
        targets: [{ node: "yaw", param: "up" }],
        description: "Up hint fixing the roll; leave it at world up unless the assets stand along another axis.",
      },
    ],
  });

  definePrimitive("write/orient-along-path", {
    title: "Turn a path's own points to follow the path",
    description:
      "Writes a unit `tangent` along the polyline at every point of a path, then sets `rot` so each point faces that way — the points, their attributes and the topology all arrive and leave untouched. That is the whole difference from `place/along-curve`, which resamples: use this one when the points already mean something (a species, a scale, a colour, a point index other geometry refers to) and must survive being oriented. It is also the only way to orient the points of a path that was hand-built with `pointsToPath`, since a tangent otherwise exists only on points a sampler created. The tangent is the normalized central difference between each point's neighbours along the path, so it stays smooth through corners, and it wraps on a closed path. PRECONDITION: the input must carry polyline topology; a point on no polyline gets a zero tangent and deliberately keeps the `rot` it had. Run it BEFORE anything that can REMOVE points — the `filter/*` family, `partitionByAttribute` and `mergePoints` all drop topology, and this node would then find no paths. Category is not the predicate: `filterByAttribute` drops it even when its predicate keeps every point, while `projectToPlane` is a `filter` that preserves it by cloning. Fully deterministic. Writes `tangent` and `rot`; `P` and the count are untouched.",
    tags: ["curve", "path", "instancing"],
    nodes: [
      { id: "tangents", type: "writeTangents", params: { name: "tangent" } },
      {
        id: "orient",
        type: "orientAlongVector",
        // Reads back exactly what the node above wrote. The attribute NAME
        // is deliberately not exposed: it lives inside this field spec as
        // well as in the param above, and nothing inside a field spec is
        // reachable from an exposed param — a `name` knob would move one
        // half of the pair and silently orient nothing.
        params: { direction: attr("tangent", 3), up: [0, 1, 0], axis: "+z" },
      },
    ],
    connections: [{ from: ["tangents", "out"], to: ["orient", "in"] }],
    inputs: [{ name: "in", node: "tangents", pin: "in" }],
    outputs: [{ name: "out", node: "orient", pin: "out" }],
    params: [
      {
        name: "axis",
        targets: [{ node: "orient", param: "axis" }],
        description: "Which local axis of the asset points along the path. '+z' is the forward axis assets face by convention.",
      },
      {
        name: "up",
        targets: [{ node: "orient", param: "up" }],
        description: "Up hint fixing the roll around the path; leave it at world up for props that stand on the ground.",
      },
    ],
  });

  definePrimitive("write/color-from-attribute", {
    title: "Turn a scalar attribute into a colour gradient",
    description:
      "Rescales any numeric point attribute to 0..1 over its OWN observed range, then maps it through a blue-green-yellow-red heat ramp into the standard `color` attribute (f32, tuple 4, alpha 1). Fitting to the observed range is what makes it work on an invented quantity — a neighbour count, a hand-built score — without knowing its scale in advance. Fully deterministic: two instances produce identical output. Writes `color`; reads the attribute named by `source`, which must exist on the point domain.",
    tags: ["color", "debug"],
    nodes: [
      {
        id: "fit",
        type: "attributeRemap",
        params: {
          name: "density",
          outName: "__t",
          domain: "point",
          mode: "fit",
          inMin: -1,
          inMax: 1,
          outMin: 0,
          outMax: 1,
          clamp: true,
        },
      },
      {
        id: "color",
        type: "setAttribute",
        params: {
          name: "color",
          domain: "point",
          type: "f32",
          tupleSize: 4,
          value: vec(
            ramp(attr("__t"), [
              [0, 0.05],
              [0.4, 0.1],
              [0.7, 0.9],
              [1, 1],
            ]),
            ramp(attr("__t"), [
              [0, 0.1],
              [0.4, 0.7],
              [0.7, 0.9],
              [1, 0.2],
            ]),
            ramp(attr("__t"), [
              [0, 0.5],
              [0.4, 0.4],
              [0.7, 0.1],
              [1, 0.05],
            ]),
            1,
          ),
        },
      },
      { id: "cleanup", type: "removeAttribute", params: { names: ["__t"], domain: "point", strict: true } },
    ],
    connections: [
      { from: ["fit", "out"], to: ["color", "in"] },
      { from: ["color", "out"], to: ["cleanup", "in"] },
    ],
    inputs: [{ name: "in", node: "fit", pin: "in" }],
    outputs: [{ name: "out", node: "cleanup", pin: "out" }],
    params: [
      {
        name: "source",
        targets: [{ node: "fit", param: "name" }],
        description:
          "Numeric point attribute to colour by. It is fitted to its own minimum and maximum, so any scale works — 'density', 'height', 'slope' or anything you computed yourself.",
      },
    ],
  });

  definePrimitive("write/local-density", {
    title: "Write how crowded each point is as a density",
    description:
      "Counts each point's neighbours within a radius and rescales the counts to 0..1 over their own observed range, writing the standard `density` attribute — so crowding can drive size, colour, or a proportional thinning through `filter/thin-by-density`. Fully deterministic: two instances produce identical output, since this measures whatever arrives rather than inventing anything. Writes `density`; reads `P`.",
    tags: ["neighborhood", "density"],
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
        id: "fit",
        type: "attributeRemap",
        params: {
          name: "__nbrCount",
          outName: "density",
          domain: "point",
          mode: "fit",
          inMin: -1,
          inMax: 1,
          outMin: 0,
          outMax: 1,
          clamp: true,
        },
      },
      { id: "cleanup", type: "removeAttribute", params: { names: ["__nbrCount"], domain: "point", strict: true } },
    ],
    connections: [
      { from: ["nbr", "out"], to: ["fit", "in"] },
      { from: ["fit", "out"], to: ["cleanup", "in"] },
    ],
    inputs: [{ name: "in", node: "nbr", pin: "in" }],
    outputs: [{ name: "out", node: "cleanup", pin: "out" }],
    params: [
      {
        name: "radius",
        targets: [{ node: "nbr", param: "radius" }],
        description:
          "How far around each point counts as its neighbourhood, in world units. It changes the ORDERING of the densities, never their range: the counts are refitted to 0..1 over whatever spread they happen to have, so the emptiest point is always exactly 0 and the fullest always exactly 1 at every radius, and even a perfectly uniform scatter comes out spanning the full 0..1 (measured mean 0.56). Two consequences an agent has to plan around: the values are NOT comparable between two clouds, two radii or two cooks with different counts, and a threshold like 0.8 means 'the top of THIS cloud' rather than any absolute crowding. For an absolute measure, read the raw neighbour count with a `pointNeighborhood` node instead.",
        min: 0,
      },
    ],
  });

  definePrimitive("write/instances-by-species", {
    title: "Pick one asset per point and emit the instances",
    description:
      "Chooses an asset id per point from a list and emits the instance batches — the multi-asset spawn. The point of the primitive is the string coupling: one param names BOTH the attribute the choice is written to and the attribute the spawner reads it back from, so the two can never drift apart. The built-in selector spreads uniformly over FOUR entries, so pass exactly four assets and repeat one to weight it (['pine','pine','birch','bush'] is 50/25/25). VARIATION: yes — the choice comes from the evaluation context, so two instances differ automatically, and `seed` re-rolls one explicitly. Writes the species attribute; reads `P`, `rot` and `scale` through the spawner.",
    tags: ["spawn", "instancing"],
    nodes: [
      {
        id: "species",
        type: "setAttribute",
        params: {
          name: "species",
          domain: "point",
          type: "string",
          tupleSize: 1,
          seed: 0,
          value: call("mul", randomField("species"), 4),
          values: ["pine", "pine", "birch", "bush"],
          stringValue: "",
        },
      },
      { id: "spawn", type: "spawnInstances", params: { assetId: "pine", assetAttr: "species" } },
    ],
    connections: [{ from: ["species", "out"], to: ["spawn", "in"] }],
    inputs: [{ name: "in", node: "species", pin: "in" }],
    outputs: [
      { name: "instances", node: "spawn", pin: "instances" },
      { name: "points", node: "spawn", pin: "points" },
    ],
    params: [
      {
        name: "assets",
        targets: [{ node: "species", param: "values" }],
        description:
          "Asset ids to choose among, as four entries. Repeat an entry to weight it; an empty entry falls back to `assetId`.",
      },
      {
        name: "speciesAttr",
        targets: [
          { node: "species", param: "name" },
          { node: "spawn", param: "assetAttr" },
        ],
        description:
          "Name of the string point attribute holding the per-point asset id. One knob writes it and reads it, so the writer and the spawner cannot disagree.",
      },
      {
        name: "assetId",
        targets: [{ node: "spawn", param: "assetId" }],
        description: "Asset id used for any point whose species entry is empty.",
      },
      {
        name: "seed",
        targets: [{ node: "species", param: "seed" }],
        description: "Re-rolls which point gets which asset. 0 uses the node's own derived seed.",
      },
    ],
  });
}
