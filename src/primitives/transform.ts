/**
 * `transform/*` — change `P`, keep the count, keep everything else.
 *
 * None of these uses the `scale: [0,0,0]` position-set trick the `shape`
 * family relies on, and that is deliberate: `transformPoints` multiplies
 * the per-point `scale` ATTRIBUTE by its `scale` param, so zeroing it
 * would silently zero the size of every asset the points later spawn. A
 * transform that must preserve what it did not come to change therefore
 * moves points by a DELTA at scale 1 — `translate = target - position()` —
 * which leaves `scale` and `rot` exactly as they arrived.
 */
import { attr, call, position, tunableFbm, vec } from "./expr.js";
import { definePrimitive } from "./define.js";

/** Register every `transform/*` primitive. Call once, from the family index. */
export function registerTransformPrimitives(): void {
  definePrimitive("transform/displace-by-noise", {
    title: "Push points up and down by a noise field",
    description:
      "Displaces every point along +Y by a noise field centred on zero, so a flat scatter becomes a rolling one. The displacement runs from -amount to +amount, so the average height does not move. LIMITATION: +Y only — the direction lives inside the field structure, not in a param slot, so displacing along another axis means rotating the whole result. VARIATION: none by default — noise carries its own seed inside its field spec, so two instances displace IDENTICALLY unless their `variant` differs, and this is the primitive most likely to be used twice in one graph. Reads and writes `P`; leaves every other attribute alone.",
    tags: ["noise", "terrain"],
    nodes: [
      {
        id: "freqAttr",
        type: "setAttribute",
        params: { name: "freq", domain: "point", type: "f32", tupleSize: 1, value: 0.05 },
      },
      {
        id: "variantAttr",
        type: "setAttribute",
        params: { name: "variant", domain: "point", type: "f32", tupleSize: 1, value: 0 },
      },
      {
        id: "ampAttr",
        type: "setAttribute",
        params: { name: "amp", domain: "point", type: "f32", tupleSize: 1, value: 4 },
      },
      {
        id: "displace",
        type: "transformPoints",
        params: {
          scale: [1, 1, 1],
          rotateEuler: [0, 0, 0],
          translate: vec(
            0,
            call("mul", attr("amp"), call("remap", tunableFbm("freq", "variant"), 0, 1, -1, 1)),
            0,
          ),
        },
      },
      {
        id: "cleanup",
        type: "removeAttribute",
        params: { names: ["freq", "variant", "amp"], domain: "point", strict: true },
      },
    ],
    connections: [
      { from: ["freqAttr", "out"], to: ["variantAttr", "in"] },
      { from: ["variantAttr", "out"], to: ["ampAttr", "in"] },
      { from: ["ampAttr", "out"], to: ["displace", "in"] },
      { from: ["displace", "out"], to: ["cleanup", "in"] },
    ],
    inputs: [{ name: "in", node: "freqAttr", pin: "in" }],
    outputs: [{ name: "out", node: "cleanup", pin: "out" }],
    params: [
      {
        name: "amount",
        targets: [{ node: "ampAttr", param: "value" }],
        description: "Peak displacement in world units: points move between -amount and +amount.",
        acceptsField: true,
      },
      {
        name: "frequency",
        targets: [{ node: "freqAttr", param: "value" }],
        description:
          "Feature size: the noise sample position is multiplied by this, so smaller means longer, gentler waves.",
        acceptsField: true,
      },
      {
        name: "variant",
        targets: [{ node: "variantAttr", param: "value" }],
        description:
          "Offset added to the noise sample position — the per-instance re-roll, and the ONLY one: no seed can move a noise field.",
        acceptsField: true,
      },
    ],
  });

  definePrimitive("transform/snap-to-grid", {
    title: "Move every point to the nearest grid corner",
    description:
      "Snaps every point to the nearest corner of a regular 3D grid of the given pitch, so scattered positions become tile-aligned. Note that snapping can land two points on the SAME corner: follow it with `selfPrune` at a distance just under the pitch if the duplicates matter. Fully deterministic. Reads and writes `P`; leaves every other attribute alone, including `scale`.",
    tags: ["grid", "align"],
    nodes: [
      {
        id: "cellAttr",
        type: "setAttribute",
        params: { name: "cell", domain: "point", type: "f32", tupleSize: 1, value: 4 },
      },
      {
        id: "snap",
        type: "transformPoints",
        params: {
          scale: [1, 1, 1],
          rotateEuler: [0, 0, 0],
          // The DELTA to the nearest corner, not the corner itself: at
          // scale 1 this leaves the `scale` and `rot` attributes alone.
          translate: call(
            "sub",
            call(
              "mul",
              call("floor", call("add", call("div", position(), attr("cell")), 0.5)),
              attr("cell"),
            ),
            position(),
          ),
        },
      },
      { id: "cleanup", type: "removeAttribute", params: { names: ["cell"], domain: "point", strict: true } },
    ],
    connections: [
      { from: ["cellAttr", "out"], to: ["snap", "in"] },
      { from: ["snap", "out"], to: ["cleanup", "in"] },
    ],
    inputs: [{ name: "in", node: "cellAttr", pin: "in" }],
    outputs: [{ name: "out", node: "cleanup", pin: "out" }],
    params: [
      {
        name: "cellSize",
        targets: [{ node: "cellAttr", param: "value" }],
        description: "Grid pitch in world units, the same on all three axes. Must be greater than 0.",
        acceptsField: true,
      },
    ],
  });

  definePrimitive("transform/relax-spacing", {
    title: "Even out spacing without deleting anything",
    description:
      "Nudges every point away from the centroid of its neighbours, so crowded regions spread out and the spacing evens up while the COUNT stays exactly the same. This is the alternative to `selfPrune`, which enforces spacing by deleting: use this one when the count is fixed (a fleet, a crowd, a fixed budget of props). A strength near 0.5 is one relaxation step; run the primitive twice for a stronger effect rather than pushing the strength past 1, which overshoots and oscillates. Isolated points do not move. Fully deterministic. Reads and writes `P`; leaves every other attribute alone.",
    tags: ["neighborhood", "spacing"],
    nodes: [
      {
        id: "nbr",
        type: "pointNeighborhood",
        params: {
          radius: 4,
          maxCount: 0,
          includeSelf: false,
          countAttr: "",
          averageAttr: "P",
          averageOutAttr: "__nbrP",
        },
      },
      {
        id: "strAttr",
        type: "setAttribute",
        params: { name: "__str", domain: "point", type: "f32", tupleSize: 1, value: 0.5 },
      },
      {
        id: "push",
        type: "transformPoints",
        params: {
          scale: [1, 1, 1],
          rotateEuler: [0, 0, 0],
          translate: call("mul", attr("__str"), call("sub", position(), attr("__nbrP", 3))),
        },
      },
      {
        id: "cleanup",
        type: "removeAttribute",
        params: { names: ["__nbrP", "__str"], domain: "point", strict: true },
      },
    ],
    connections: [
      { from: ["nbr", "out"], to: ["strAttr", "in"] },
      { from: ["strAttr", "out"], to: ["push", "in"] },
      { from: ["push", "out"], to: ["cleanup", "in"] },
    ],
    inputs: [{ name: "in", node: "nbr", pin: "in" }],
    outputs: [{ name: "out", node: "cleanup", pin: "out" }],
    params: [
      {
        name: "radius",
        targets: [{ node: "nbr", param: "radius" }],
        description:
          "How far around each point counts as its neighbourhood, in world units. Points with nothing inside it do not move.",
        min: 0,
      },
      {
        name: "strength",
        targets: [{ node: "strAttr", param: "value" }],
        description: "How far along the push each point travels: 0 changes nothing, 0.5 is one relaxation step.",
        acceptsField: true,
      },
    ],
  });
}
