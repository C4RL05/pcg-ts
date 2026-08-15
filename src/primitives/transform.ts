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
import { type Spec, attr, call, param, position, tunableFbm, vec } from "./expr.js";
import { definePrimitive } from "./define.js";

/** Fewest bins `transform/gather-on-path` will cut a path into. */
const MIN_BINS = 1;

/** Smallest grid pitch `transform/snap-to-grid` will divide a position by. */
const MIN_CELL_SIZE = 1e-6;

/**
 * A knob that is about to be DIVIDED BY, clamped to the same bound its
 * schema declares.
 *
 * A declared `min` binds a PLAIN value only — `paramValueError` says so:
 * a field value is the caller's business, and `serializeParamValue` never
 * reaches the range check for one. So a bound alone is a promise the
 * implementation does not keep the moment a knob is flipped to field
 * mode, and both divisors below used to take whatever came: a `bins` of 0
 * sent every point of a path to the same infinite parameter, and a
 * `cellSize` of 0 snapped every position to NaN, each under a cook
 * reporting success. Guarding the divisor at the point of use is what
 * makes the bound true of every value that can arrive, however it is
 * spelled — the property the bound was only pretending to provide.
 */
function guarded(name: string, least: number): Spec {
  return call("max", param(name), least);
}

/**
 * Where a point of a path is heading when it gathers: the centre of the
 * bin its own `curveU` falls in.
 *
 * `bins` is the primitive's own knob, read straight out of the exposed
 * param by name. `curveU` stays an ATTRIBUTE because it genuinely is one —
 * it varies per point, and it is the input this expression is about. The
 * two are the whole distinction the grammar draws: a value that varies per
 * element is an attribute, a value uniform over the cook is a param.
 */
const BIN_CENTRE: Spec = call(
  "div",
  call("add", call("floor", call("mul", attr("curveU", 1), guarded("bins", MIN_BINS))), 0.5),
  guarded("bins", MIN_BINS),
);

/** Register every `transform/*` primitive. Call once, from the family index. */
export function registerTransformPrimitives(): void {
  definePrimitive("transform/displace-by-noise", {
    title: "Push points up and down by a noise field",
    description:
      "Displaces every point along +Y by a noise field centred on zero, so a flat scatter becomes a rolling one. The displacement is centred: the mean height does not move, and the peak is a FRACTION of `amount` — about 0.42 on a wide cloud and as little as 0.25 on a small patch, never `amount` itself. See that param for the law. LIMITATION: +Y only — the direction lives inside the field structure, not in a param slot, so displacing along another axis means rotating the whole result. VARIATION: none by default — noise carries its own seed inside its field spec, so two instances displace IDENTICALLY unless their `variant` differs, and this is the primitive most likely to be used twice in one graph. Reads and writes `P`; leaves every other attribute alone.",
    tags: ["noise", "terrain"],
    nodes: [
      {
        id: "displace",
        type: "transformPoints",
        params: {
          scale: [1, 1, 1],
          rotateEuler: [0, 0, 0],
          translate: vec(
            0,
            call("mul", param("amount"), call("remap", tunableFbm("frequency", "variant"), 0, 1, -1, 1)),
            0,
          ),
        },
      },
    ],
    connections: [],
    inputs: [{ name: "in", node: "displace", pin: "in" }],
    outputs: [{ name: "out", node: "displace", pin: "out" }],
    params: [
      {
        name: "amount",
        targets: [],
        default: 4,
        description:
          "How far points move along Y. It SCALES the displacement but does not bound it: on a cloud spanning many noise periods the peak is about 0.42 * amount, so the default 4 lifts and drops by roughly 1.7 units, and for a peak of h world units ask for amount around 2.4 * h. Exactly linear in amount — doubling it doubles every displacement — and the mean stays within 1% of 0, so the average height does not move. This is a FRACTION OF A NOMINAL RANGE, not of the displacement you get: the value scales a noise term whose range is +/-1 in principle, and four octaves of normalized fBm only ever reach the middle of it. How much of it depends on how much FIELD the cloud spans — extent x `frequency`, not the point count. Measured at amount 4: a 600-unit spread peaks at 0.42 to 0.49 of amount at every frequency from 0.01 up, while a 30-unit patch at the default frequency 0.05 spans barely one period and peaks at only 0.25, whether it holds 100 points or 20,000. On a small patch, either raise `frequency` or scale `amount` up to compensate.",
        acceptsField: true,
      },
      {
        name: "frequency",
        targets: [],
        default: 0.05,
        description:
          "Feature size: the noise sample position is multiplied by this, so smaller means longer, gentler waves.",
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
    ],
  });

  definePrimitive("transform/snap-to-grid", {
    title: "Move every point to the nearest grid corner",
    description:
      "Snaps every point to the nearest corner of a regular 3D grid of the given pitch, so scattered positions become tile-aligned. Note that snapping can land two points on the SAME corner: follow it with `selfPrune` at a distance just under the pitch if the duplicates matter. Fully deterministic. Reads and writes `P`; leaves every other attribute alone, including `scale`.",
    tags: ["grid", "align"],
    nodes: [
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
              call(
                "floor",
                call("add", call("div", position(), guarded("cellSize", MIN_CELL_SIZE)), 0.5),
              ),
              guarded("cellSize", MIN_CELL_SIZE),
            ),
            position(),
          ),
        },
      },
    ],
    connections: [],
    inputs: [{ name: "in", node: "snap", pin: "in" }],
    outputs: [{ name: "out", node: "snap", pin: "out" }],
    params: [
      {
        name: "cellSize",
        targets: [],
        default: 4,
        description: `Grid pitch in world units, the same on all three axes. It is the DIVISOR of the snap, so it must be greater than 0 — declared as well as said: a plain value below ${MIN_CELL_SIZE} is refused by name, and a FIELD delivering one — which no declared bound can refuse — is clamped to ${MIN_CELL_SIZE} at the point of use rather than dividing by it. That clamp is the limit the pitch was heading for anyway: a millionth-of-a-unit grid moves a point by at most half of that, so a pitch of 0 or less leaves the cloud where it is instead of snapping every position to NaN. The clamp is a floor and nothing more: a field that returns NaN still snaps to NaN, because there is no value to floor it to.`,
        acceptsField: true,
        min: MIN_CELL_SIZE,
      },
    ],
  });

  definePrimitive("transform/gather-on-path", {
    title: "Gather a path's own points into clumps along it",
    description:
      "Slides every point of a path along the curve it already sits on, toward the centre of its own bin, so an even distribution becomes clumps with bare runs between them — hedgerows, rock piles, bundled cables, knots in a crowd. Nothing is created or deleted: the count, the attributes and the polyline topology all survive, and each point is RE-EVALUATED on the curve rather than stepped along its tangent, so it stays exactly on the path however hard the path bends. Each point's target is the centre of the bin its own `curveU` falls into — `bins` equal bins per path — and `amount` is how far of the way there it travels, so 0 changes nothing and 1 collapses every bin onto a single spot. PRECONDITION: the input must carry `curveU` (f32, tuple 1) as well as polyline topology, so it has to have come from a sampler that writes one — `pathResample`, `splineSample`, `place/along-curve`, `place/radial-on-curve` or `shape/path-meander`. A path built straight out of `pointsToPath` has no parameterization to gather along, and the cook fails naming `curveU` rather than guessing one. The point sitting exactly at the end of a path does not move: its bin centre lies past the end and clamps back onto it. `curveU` and `tangent` are rewritten to where each point LANDS, so a second gather bins the new positions and not the old ones. Fully deterministic: two instances with the same params clump identically, and there is no seed — the clumps are where the bins are, not where a draw put them. Reads and writes `P`; every other attribute arrives untouched.",
    tags: ["curve", "path", "spacing"],
    nodes: [
      {
        id: "slide",
        type: "pathPointAt",
        params: {
          mode: "fraction",
          // The idiom `parameter` is built for: it resolves on the INPUT
          // points before any of them move, so `curveU` still reads where
          // this point started and the move can be expressed relative to
          // it. A target alone would place every point of a bin on top of
          // its neighbours; the lerp is what makes `amount` a dial.
          parameter: call("lerp", attr("curveU", 1), BIN_CENTRE, param("amount")),
        },
      },
    ],
    connections: [],
    inputs: [{ name: "in", node: "slide", pin: "in" }],
    outputs: [{ name: "out", node: "slide", pin: "out" }],
    params: [
      {
        name: "bins",
        targets: [],
        default: 6,
        description:
          "How many clumps each path gets: its 0..1 parameter is cut into this many equal bins and every point heads for the centre of its own. Fewer bins means fewer, fatter clumps further apart, and the clumps land at (i + 0.5) / bins along each path — a fixed lattice, not a random one, so two paths of different lengths clump at the same RELATIVE places. It is per path rather than per world unit, so a long path and a short one both get `bins` clumps; for a fixed clump pitch, resample to a `spacing` first and scale this with the length. A fractional value leaves a short last bin at the far end. Field-capable like every knob here, but keep it UNIFORM unless you mean otherwise: a bin count that varies per point stops partitioning the path, because neighbouring points then head for the centres of bins that do not line up. A field over something constant along each path — a per-path attribute, say — is the coherent way to vary it; a field over `curveU` or position is not. Guarded at the point of use, because it is the DIVISOR that turns a 0..1 parameter into a bin: anything below the declared minimum of 1 is read as exactly 1 — one bin, the whole path gathering onto a single spot — and that covers the values a bound cannot refuse, since a field's are never range-checked. A plain value below 1 is still an error rather than a clamp.",
        min: 1,
        acceptsField: true,
      },
      {
        name: "amount",
        targets: [],
        default: 0.7,
        description:
          "How far of the way to its bin centre each point travels, 0..1: 0 leaves the distribution exactly as it arrived, 1 collapses every bin onto a single point, and the travel is exactly linear in between — 0.5 halves every gap to the centre. Field-capable, resolved on the points BEFORE they move, so a field over `curveU` can gather one end of a path harder than the other.",
        min: 0,
        max: 1,
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
        id: "push",
        type: "transformPoints",
        params: {
          scale: [1, 1, 1],
          rotateEuler: [0, 0, 0],
          translate: call("mul", param("strength"), call("sub", position(), attr("__nbrP", 3))),
        },
      },
      {
        id: "cleanup",
        type: "removeAttribute",
        params: { names: ["__nbrP"], domain: "point", strict: true },
      },
    ],
    connections: [
      { from: ["nbr", "out"], to: ["push", "in"] },
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
        targets: [],
        default: 0.5,
        description:
          "How far along the push each point travels: the point moves exactly strength * (its own position - the mean position of its neighbours inside `radius`), so 0 changes nothing and the travel is exactly linear in strength. It is a fraction of a LOCAL offset, not a world distance, so `radius` sets the scale and this sets the fraction of it: measured on 300 points in a 30x30 box, strength 0.5 moves the average point 0.42 units at radius 4 and 1.5 units at radius 12, and strength 1 moves it exactly twice as far. 0.5 is one relaxation step; run the primitive twice rather than pushing past 1, which overshoots and oscillates.",
        acceptsField: true,
      },
    ],
  });
}
