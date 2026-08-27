/**
 * THE ARC-LENGTH SCATTER: N random points ON a path, with N read PER
 * PATH.
 *
 * WHY IT IS NOT A MODE ON A SOURCE NODE, which is where a "scatter" would
 * otherwise belong. Every one of the four sources — `pointGrid`,
 * `pointLine`, `pointScatterInBounds`, `pointScatterInWorld` — takes NO
 * geometry, and that single fact is why not one of their counts is
 * field-capable: a source builds its elements FROM its params, so the
 * count is read before any domain exists to resolve a field against
 * (`docs/authoring.md`, "There must already be elements to evaluate
 * against"). This node takes a PATH, so there IS an element per reading —
 * the polyline primitive — and `count` resolves on the input's own
 * primitive domain, one number per road. That is not a nicety bolted onto
 * a scatter; it is the entire operation. `mul(0.05, attribute("length"))`
 * puts one prop every twenty metres on every road of a network in ONE
 * cook, whatever their lengths, and no source node can be taught to do it
 * because none of them has a road to ask.
 *
 * WHY IT IS NOT A MODE ON `pathResample` OR `splineSample`. Those place
 * samples EVENLY, and the difference is not the draw but what comes out:
 * `pathResample` rebuilds polyline topology over its samples and emits a
 * PATH, because evenly-spaced samples of a curve still describe that
 * curve. Randomly-ordered samples do not describe anything, so this node
 * emits a plain CLOUD and the two could not share an output contract even
 * if they shared a param. Their field-capable param is `spacing`, which a
 * random placement does not have: the gap between two neighbours here is
 * a consequence of the draw, not an input to it.
 *
 * WHY IT IS NOT `pointScatterInBounds` + `transferAlongPath`, which is
 * the idiom it replaces. That pair works — scatter N points in a box,
 * write a station column on them by hand, gather `P` along the path —
 * and it fails at exactly three places. The station has to be authored in
 * WORLD UNITS, so the author needs the path's length before they can
 * write the expression, and no field can walk a polyline's vertices to
 * find it. N is one global number that cannot follow a per-path length,
 * because the box has no primitives to resolve a field over. And
 * `transferAlongPath` refuses an input holding more than one polyline, on
 * purpose, so the idiom cannot address a network AT ALL. Three nodes, one
 * hand-measured literal, and a hard ceiling of one road.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. No lateral offset and no tangent:
 * `writeTangents` and `writeCurveFrame` own the frame, and
 * `transferAlongPath` owns reading anything else off the curve at a
 * station — including a half-width to push a point sideways by. A second
 * node computing a tangent is a second node free to disagree about which
 * way the road points, which is the whole reason the arc table is shared
 * rather than rebuilt.
 *
 * THE ARC COORDINATE IS THE CHORD ONE, and it is shared rather than
 * measured again: {@link polylineArcTables} and {@link locateOnArcLength}
 * are what `pathResample` steps, what `pathPointAt`'s 'distance' mode
 * reads, what `arcTile` tiles over and what `transferAlongPath` gathers
 * on. Two nodes measuring the same path twice is how they come to
 * disagree about where the halfway point is, so this one measures it
 * zero times.
 */
import { createPointCloud } from "../data/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import { standardNode } from "./registry.js";
import {
  CANCEL_STRIDE,
  type FieldParam,
  carryPrimitiveAttributes,
  locateOnArcLength,
  polylineArcTables,
  requireFinitePlainParam,
  requireGeometry,
  requireReportSlot,
  requireScalarColumn,
  resolveOn,
} from "./util.js";

/**
 * Ceiling on the points one `pointScatterOnPath` may emit, across the
 * whole input.
 *
 * Not a semantic limit — it changes no point the node places — but the
 * post-resolution check a fielded allocation param owes, in the words
 * `docs/authoring.md` uses for exactly this case: a PLAIN count is
 * bounded by a number the author typed, and a field is not, so
 * `mul(1e6, attribute("length"))` on a lap would ask for an allocation
 * nothing can serve and the cook would die without a message. Checked on
 * the TOTAL rather than per path, for `pathResample`'s reason: a per-path
 * cap would pass ten paths of a million points each. Raising it later is
 * always compatible; the error names the numbers so an author can bound
 * the expression instead.
 */
const MAX_SCATTER_POINTS = 1_048_576;

/** Params of {@link pointScatterOnPath}. */
export interface PointScatterOnPathParams {
  count: FieldParam;
  arcAttr: string;
  seed: number;
}

/** Uniform random points along every polyline of a path, hash-seeded. */
export const pointScatterOnPath = standardNode<PointScatterOnPathParams>({
  type: "pointScatterOnPath",
  category: "sampler",
  description:
    "Scatters `count` points at UNIFORMLY RANDOM ARC POSITIONS along EVERY polyline primitive of the `path` input and emits them as a NEW point cloud lying exactly ON the path. It is the random counterpart of pathResample and splineSample, which place their samples evenly: an even sampler answers 'where do the mile markers go', this one answers 'where do the twenty trees along this road stand'. THE COUNT IS FIELD-CAPABLE AND THAT IS THE WHOLE POINT. The four source nodes (pointGrid, pointLine, pointScatterInBounds, pointScatterInWorld) take no geometry at all, so their counts are read before any domain exists to resolve a field against and can never be fields. This node takes a path, so `count` resolves on the INPUT'S OWN PRIMITIVE DOMAIN — one count per polyline — and mul(0.05, attribute(\"pathLength\")) places one prop per twenty units on every road of a network in ONE cook, whatever their lengths. Feed that column with pathResample's `resampledLengthAttr`, or with connectPoints' `lengthAttr` per edge. THE LENGTH TO FEED IT IS `resampledLengthAttr` AND NOT `lengthAttr`, which is the same distinction the next sentence makes about the coordinate: `lengthAttr` reports the length of the CURVE that was resampled, and this node scatters on the CHORD length of the polyline it is handed, which is shorter wherever that polyline bends. Sizing a population from the first and then placing it on the second means every count is quietly for a path longer than the one the points land on — small, but it accrues entirely over bends and not at all over straights, so it is not a constant a spacing can absorb. THE ARC COORDINATE IS THE CHORD ONE: the running sum of the straight-line distances between consecutive path points, INCLUDING the closing segment when the polyline is closed, which is the same table pathResample steps, pathPointAt's 'distance' mode reads, arcTile tiles over and transferAlongPath gathers on. It is not the length of any curve fitted through those points and is shorter than one. EACH POSITION IS UNIFORM ON THE HALF-OPEN RANGE [0, length): half-open because on a CLOSED path arc 0 and arc `length` are the same place, so a closed range would make the start line twice as likely as anywhere else, and on an OPEN path the far endpoint is one position out of a continuum and no more deserving than any other. Every polyline is scattered ON ITS OWN ARC LENGTH — the polylines are never concatenated into one curve, unlike splineSample — so a long road gets no share of a short road's points. THE COUNT IS ROUNDED TO NEAREST with Math.round (which rounds a half UP, toward +Infinity: 2.5 becomes 3) and then CLAMPED AT 0, so a resolved 99.5 places 100 points and a resolved -3 places none. Rounding is DETERMINISTIC on purpose and is not a stochastic round: a caller who wants 4.3 to mean 'four points, and a fifth three times in ten' writes that themselves as floor(add(<the count field>, randomField())), which says out loud which seed decides it. A count field that resolves to NaN or +/-Infinity is REFUSED naming the param, not read as a meaning — see `count`. WHAT COMES OUT is a standard point cloud (P, rot, scale, density, boundsMin, boundsMax, color, seed) plus the f32 `arcAttr` column holding each point's own arc position, and NOTHING ELSE: no tangent, no frame, no lateral offset. writeTangents and writeCurveFrame own the frame, and transferAlongPath reads anything else the path carries at these stations — including a half-width to push a point sideways by — because a second node computing a tangent is a second node free to disagree about which way the road points. The output has NO TOPOLOGY: it is a cloud, not a path, and a random ordering of positions describes no curve to rebuild one over. Each point ALSO carries every attribute of the polyline PRIMITIVE it landed on, so a per-road `roadWidth` or `kind` survives the scatter; `primtype` is the one exception, being a type tag rather than a value, and there is no opt-out — a carried name colliding with one this node writes is refused with an error naming the attribute and the fix. DETERMINISM IS A HASH, NOT A STREAM: a point's arc position and its per-point seed are hashed from (seed, the SOURCE PRIMITIVE INDEX, its index within that polyline, a channel), never drawn from a running generator, so the same seed reproduces the same points in any cook order, at any budget, on any platform, and raising one polyline's count leaves every point on every OTHER polyline byte-identical. The key is the primitive INDEX, so reordering or filtering the polylines upstream re-rolls the scatter — the same caveat pointScatterInBounds carries about its point index, and the reason pointScatterInWorld exists for content that must be anchored to the world instead. OUTPUT ORDER is grouped by polyline in PRIMITIVE ORDER, then by index within each polyline. EVERY POLYLINE GETS ITS POINTS, including a ZERO-LENGTH one (all of its points at the same position), which places its whole count at that one position rather than being dropped: the arc range is empty, every draw resolves to 0, and the shared locate reports the only place the path has. The emitted count is therefore exactly the sum of the resolved per-polyline counts, always — no path is ever silently missing from a cook that otherwise looks fine. A primitive that is not a polyline, or has fewer than 2 vertices, is not a path and is skipped; an input with no usable polyline at all is REFUSED, naming the node that ate the topology.",
  inputs: [{ name: "path", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    count: {
      type: "f32",
      default: 100,
      min: 0,
      acceptsField: true,
      description:
        `How many points to place on EACH polyline. AS A FIELD IT IS ONE COUNT PER PATH, resolved on the INPUT's PRIMITIVE domain, which is what this param exists for: a wide road and a footpath in one geometry take different counts in ONE COOK, each following its own value. mul(0.05, attribute("pathLength")) is the idiom — a fixed number of props per unit of arc — where "pathLength" is whatever pathResample's \`resampledLengthAttr\` wrote (or connectPoints' \`lengthAttr\`, per edge). On a resampled path it is \`resampledLengthAttr\` and not \`lengthAttr\`: the second measures the curve that was resampled and this node scatters on the chord length of the polyline it is handed, which is shorter wherever that polyline bends. The field sees the PRIMITIVE domain, so what it can read is what a PATH carries: a primitive attribute (setAttribute with domain 'primitive', or promoteAttribute point -> primitive), index() and fraction() over the paths, randomField(), and nodeSeed(). A POINT attribute is not in scope there, and position() is not either — a path has no one position. THE RESOLVED VALUE IS ROUNDED TO NEAREST with Math.round, which rounds a half UP (toward +Infinity), and then CLAMPED AT 0: 99.5 places 100 points, 99.4 places 99, and a negative places none rather than erroring, since "fewer than none" has exactly one reading. The rounding is DETERMINISTIC and deliberately not stochastic. A caller who wants 4.3 points to mean "four, and a fifth three times in ten" writes floor(add(<the count field>, randomField())) themselves, which states out loud which seed decides it — this node inventing that draw would hide a second source of randomness inside a param that reads like arithmetic. A NON-FINITE resolved value is REFUSED, naming this param: a field is not range-checked the way a plain number is (a schema's min binds a number, and a field is a recipe with no number to check until it lands on a domain), so a division by zero or an overflow arrives here as NaN and has no reading as a population. Bound the expression itself — max(<expr>, 0), or a guard under the div. THE CAP IS ON THE TOTAL, not per path: the resolved counts are summed across every polyline and the cook is refused past ${MAX_SCATTER_POINTS} points, because a per-path cap would pass ten paths of a million each. 0 on a path places nothing on it and is not an error — a road with no trees is a road.`,
    },
    arcAttr: {
      type: "string",
      default: "station",
      description:
        "Name of the f32 POINT attribute (tuple 1) each emitted point's ARC POSITION is written to, in WORLD UNITS along its own polyline — the same coordinate pathPointAt's 'distance' mode reads, arcTile's `startAttr` carries, and transferAlongPath's `arcAttr` gathers at, which is what makes this the column you hand straight to that node to read the path's other attributes here. Always written; there is no empty spelling, because a scattered point whose position along the path is unrecoverable is a point nothing downstream can ask a second question about, and recovering it from P would mean measuring the path a second time. THE UNITS ARE THE TRAP, not the name: a track measured in half-widths, a route in fractions of the whole and a scan in samples are all called a station by somebody, and this column is none of those — it is metres (or whatever unit the positions are in) from the start of that polyline. Divide by the path's own length with setAttribute for a fraction. The shape is this node's to pick (f32, tuple 1), so a name already on the OUTPUT's point domain under a different shape is REFUSED rather than deleted and re-added — SEVEN of the eight columns a standard cloud starts with reach that refusal, because their shapes differ from this one: P, scale, boundsMin and boundsMax (f32x3), rot and color (f32x4), and seed (u32). \"density\" is the eighth and the exception — it is f32 tuple 1, exactly this column's shape, so naming it passes the shape check and is RESET rather than refused, silently overwriting a standard column with an arc length. Give it a name of its own. Must be non-empty.",
    },
    seed: {
      type: "u32",
      default: 0,
      description:
        "Extra seed folded into the node seed (hashCombine(nodeSeed, seed)); change it to re-roll the scatter without touching the graph seed or anything upstream. The folded value is what every per-point draw hashes from AND what a `count` field is resolved with, so a randomField() in the count re-rolls with it too — one knob for one node's randomness. Eager by the library's rule: a seed is folded in at cook start, when there is no element in hand to evaluate a field against.",
    },
  },
  execute({ inputs, params, seed: nodeSeed, checkCancelled }) {
    // Params before geometry, as everywhere in this family: a bad param
    // reported as "no polyline primitives" sends the author to debug
    // topology that is fine.
    if (params.arcAttr === "") {
      throw new Error(
        'pointScatterOnPath: param "arcAttr" must be a non-empty attribute name (the default is "station"); it is the point attribute this node writes each scattered point\'s arc position into, and a scatter that records nothing about where along the path it landed cannot be asked a second question by transferAlongPath, arcTile, or anything else',
      );
    }
    // A PLAIN count is checked here, before the geometry is even looked
    // at, the way pathResample checks a plain spacing. A FIELD has no
    // number to check yet: `resolveOn` guards its column below and names
    // the param when it does. The shared helper is what catches the
    // `[NaN]` tuple spelling a `typeof === "number"` test walks past.
    requireFinitePlainParam(
      params.count,
      "pointScatterOnPath",
      "count",
      "A count must be a finite number >= 0 (it is rounded to nearest and clamped at 0). Write a plain count, or bound the expression with max(<expr>, 0).",
    );

    const path = requireGeometry(inputs, "path", "pointScatterOnPath");
    // Refuses an empty input, a cloud with no topology, and a "path" of a
    // single point (a polyline needs two vertices), all with the one
    // message that tells the author which node upstream ate the topology.
    const tables = polylineArcTables(path, "pointScatterOnPath");

    // The folded seed drives BOTH the per-point draws and the `count`
    // resolve, so a randomField() in the count re-rolls with `seed` like
    // everything else this node decides. surfaceSample folds its own the
    // same way before resolving `densityField`.
    const seed = hashCombine(nodeSeed, params.seed);
    // One count per PATH, resolved on the INPUT's primitive domain —
    // `table.prim` is that path's index in it. Guarded (`resolveOn`, not
    // the allowing variant): a NaN population has no documented meaning
    // here, and an infinite one is an allocation nobody can serve.
    const countCol = requireScalarColumn(
      resolveOn(path, "primitive", params.count, seed, "pointScatterOnPath", "count"),
      "pointScatterOnPath",
      "count",
      // The word the message uses for one element, which is "path" here
      // even though the column lands on the primitive domain: that is what
      // a polyline IS to the author of this node.
      "path",
      "a count",
    );

    // Counts first, whole, so the cloud is allocated once and the budget
    // is checked before a byte of it exists. Rounded to nearest and
    // clamped at 0 — see the `count` param for why the rounding is not
    // stochastic.
    const counts = new Uint32Array(tables.length);
    let total = 0;
    for (let ti = 0; ti < tables.length; ti++) {
      const table = tables[ti];
      const raw = countCol.data[table.prim];
      const n = Math.max(0, Math.round(raw));
      if (total + n > MAX_SCATTER_POINTS) {
        throw new Error(
          `pointScatterOnPath: the resolved counts would place more than ${MAX_SCATTER_POINTS} points over the input's ${tables.length} path(s) — "count" resolved to ${raw} on the path at primitive ${table.prim}, and the running total reached ${total + n}. The cap is on the TOTAL, not on one path, so this is the path the total ran out on rather than necessarily the largest offender. A field is not range-checked the way a plain number is, so bound the expression itself — min(<the count field>, <the most points you meant>) — or lower a plain count.`,
        );
      }
      counts[ti] = n;
      total += n;
    }

    const out = createPointCloud(total);
    const outP = out.attrs.point.require("P").data;
    const outSeed = out.attrs.point.require("seed").data;
    // The arc column is a reporting slot whose SHAPE this node picks, so
    // a differently shaped column already under that name is refused
    // rather than deleted and re-added. Checked the moment the columns it
    // must not destroy exist, and no earlier: this node builds a FRESH
    // cloud rather than cloning, so the domain the slot lands on is one it
    // has just declared itself, and the input's point attributes — which
    // never reach the output — are the wrong thing to check against.
    requireReportSlot({
      attrs: out.attrs.point,
      nodeType: "pointScatterOnPath",
      param: "arcAttr",
      name: params.arcAttr,
      type: "f32",
      tupleSize: 1,
      domain: "point",
      suggestion: "station",
      // `out` is this node's own fresh cloud, so the refusal must name it:
      // the input's `P` never reaches here, and "remove it from the input"
      // would be advice about the wrong geometry.
      on: "output",
    });
    const outArc = out.attrs.point.replace(params.arcAttr, "f32", 1, 0).data;
    // Which polyline PRIMITIVE each point landed on, so the road's own
    // per-primitive values can be gathered onto the scatter below.
    const srcPrim = new Uint32Array(total);

    const found = [0, 0]; // scratch [segment, t], reused by every point
    let w = 0;
    for (let ti = 0; ti < tables.length; ti++) {
      const table = tables[ti];
      const n = counts[ti];
      const L = table.length;
      const prim = table.prim;
      const cum = table.cum;
      const segStart = table.segStart;
      const segDir = table.segDir;
      for (let i = 0; i < n; i++) {
        if ((w & (CANCEL_STRIDE - 1)) === 0) checkCancelled();
        // Keyed on (seed, SOURCE PRIMITIVE, index within that polyline),
        // never on the output write index: a point's identity must not
        // move when a neighbouring path's count changes, and the write
        // index would move every point after the one that grew.
        // `hashFloat` is in [0, 1), so the arc position is in [0, L) —
        // half-open, which is what keeps a closed path's seam from being
        // twice as likely as anywhere else on it.
        const s = hashFloat(hashCombine(seed, prim, i, 0)) * L;
        // The library's one arc-length locate, shared with pathPointAt,
        // pathResample and transferAlongPath: first segment whose end is
        // past `s`, clamped to the last, with t = 0 on a zero-length
        // segment — which is also what places a ZERO-LENGTH path's whole
        // count at the one position it has, with no special case here.
        locateOnArcLength(found, cum, s);
        const k = found[0];
        const t = found[1];
        outP[w * 3] = segStart[k * 3] + segDir[k * 3] * t;
        outP[w * 3 + 1] = segStart[k * 3 + 1] + segDir[k * 3 + 1] * t;
        outP[w * 3 + 2] = segStart[k * 3 + 2] + segDir[k * 3 + 2] * t;
        outArc[w] = s;
        outSeed[w] = hashCombine(seed, prim, i, 1);
        srcPrim[w] = prim;
        w++;
      }
    }

    // Each point keeps its OWN polyline's values — the road's width, its
    // kind, the length the count was derived from — because every path is
    // scattered on its own arc length and a point knows which one it came
    // from. Automatic and with no opt-out, for the reason the helper
    // gives: the author who wrote `roadWidth` must get it here without
    // knowing a knob exists.
    carryPrimitiveAttributes(
      path.attrs.primitive,
      out.attrs.point,
      srcPrim,
      "pointScatterOnPath",
      "point",
    );
    return { out: [makeGeometryItem(out)] };
  },
});
