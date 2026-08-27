/**
 * Sampler nodes: derive point clouds from other geometry — triangle mesh
 * surfaces, polyline splines, and bounded volumes.
 */
import { PRIMTYPE_ATTR, type AttributeSet, createPointCloud } from "../data/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import { standardNode } from "./registry.js";
import {
  type FieldParam,
  carryPrimitiveAttributes,
  gatherPoints,
  locateOnArcLength,
  optionalGeometry,
  polylineArcTables,
  requireGeometry,
  requireReportSlot,
  requireTuple,
  resolveOnMaybeGpu,
} from "./util.js";

/** Params of {@link surfaceSample}. */
export interface SurfaceSampleParams {
  count: number;
  seed: number;
  densityField: FieldParam;
}

/**
 * Area-weighted triangle-mesh surface sampling with optional density
 * acceptance.
 */
export const surfaceSample = standardNode<SurfaceSampleParams>({
  type: "surfaceSample",
  category: "sampler",
  description:
    "Scatters points on a triangle mesh: each of `count` candidates picks a triangle with probability proportional to its area, then a uniform position on it (uniform barycentric placement). densityField (0..1) is then evaluated once over the candidate cloud and each candidate is accepted when a per-candidate hashed random < density — so the output count is at most `count` and exactly `count` when density is 1. Output points carry P, a flat per-triangle `normal` (f32 tuple 3), density 1, and a hashed per-point seed. They ALSO carry every attribute of the triangle's own PRIMITIVE, gathered onto each sample — a per-face value written upstream survives the sampling instead of dying at it. `primtype` is the one exception, being a type tag rather than a value, and there is no opt-out: a carried name that collides with one this node writes is refused with an error naming the attribute and the fix.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    count: {
      type: "i32",
      default: 100,
      min: 0,
      description: "Number of candidate samples to place before density acceptance. Minimum 0.",
    },
    seed: {
      type: "u32",
      default: 0,
      description: "Extra seed folded into the node seed; change it to re-roll the sampling.",
    },
    densityField: {
      type: "f32",
      default: 1,
      min: 0,
      max: 1,
      acceptsField: true,
      description:
        "Acceptance probability in [0, 1] per candidate, evaluated on the candidate points after placement (so it can read P or noise). 1 keeps every candidate; 0 keeps none.",
    },
  },
  // `densityField` may resolve on the GPU. It is evaluated over the
  // internally built candidate cloud (the standard point-cloud
  // attributes plus `normal`) with the sampling-derived seed — the
  // resolver receives exactly the EvalContext the CPU `resolveOn` call
  // would ({ geo: candidates, domain: "point", seed }), after candidate
  // placement and before any acceptance, so fallback equivalence stays
  // byte-exact.
  gpu: "fields",
  async execute({ inputs, params, seed: nodeSeed, gpu }) {
    const geo = requireGeometry(inputs, "in", "surfaceSample");
    const seed = hashCombine(nodeSeed, params.seed);
    const P = geo.attrs.point.get("P");
    if (!P || P.type !== "f32" || P.tupleSize < 3) {
      throw new Error('surfaceSample: input needs a point attribute "P" (f32, tupleSize >= 3)');
    }
    const pd = P.data;
    const ps = P.tupleSize;
    const v2p = geo.vertexToPoint;
    const starts = geo.primVertexStart;
    const counts = geo.primVertexCount;
    const primType = geo.attrs.primitive.get(PRIMTYPE_ATTR);

    // Collect triangles (3-vertex "poly" primitives) and their areas.
    // `tris` holds each triangle's START VERTEX, which is what the
    // placement loop reads; `triPrim` holds the PRIMITIVE it came from,
    // which is what its attributes are keyed by. The two are not the same
    // number and neither derives from the other once non-triangles are
    // skipped.
    const tris: number[] = [];
    const triPrim: number[] = [];
    const cumArea: number[] = [];
    const normals: number[] = [];
    let total = 0;
    for (let p = 0; p < geo.primitiveCount; p++) {
      if (counts[p] !== 3) continue;
      if (primType && primType.getString(p) !== "poly") continue;
      const v = starts[p];
      const a = v2p[v] * ps;
      const b = v2p[v + 1] * ps;
      const c = v2p[v + 2] * ps;
      const abx = pd[b] - pd[a];
      const aby = pd[b + 1] - pd[a + 1];
      const abz = pd[b + 2] - pd[a + 2];
      const acx = pd[c] - pd[a];
      const acy = pd[c + 1] - pd[a + 1];
      const acz = pd[c + 2] - pd[a + 2];
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      const twiceArea = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (twiceArea <= 0) continue;
      tris.push(v);
      triPrim.push(p);
      total += twiceArea / 2;
      cumArea.push(total);
      const inv = 1 / twiceArea;
      normals.push(nx * inv, ny * inv, nz * inv);
    }
    if (tris.length === 0 || total <= 0) {
      throw new Error(
        "surfaceSample: input has no triangles with non-zero area (needs 3-vertex poly primitives; build meshes with createTriangleMesh)",
      );
    }

    // Place candidates: area-weighted triangle, uniform barycentric point.
    const n = params.count;
    const candidates = createPointCloud(n);
    const cp = candidates.attrs.point.require("P").data;
    const cn = candidates.attrs.point.add("normal", "f32", 3, [0, 1, 0]).data;
    const cs = candidates.attrs.point.require("seed").data;
    // Which triangle's PRIMITIVE each candidate landed on, so the mesh's
    // per-primitive values can be gathered onto the samples below.
    const candPrim = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const r = hashFloat(hashCombine(seed, i, 0)) * total;
      // First triangle whose cumulative area exceeds r.
      let lo = 0;
      let hi = cumArea.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumArea[mid] > r) hi = mid;
        else lo = mid + 1;
      }
      const v = tris[lo];
      const a = v2p[v] * ps;
      const b = v2p[v + 1] * ps;
      const c = v2p[v + 2] * ps;
      let u = hashFloat(hashCombine(seed, i, 1));
      let w = hashFloat(hashCombine(seed, i, 2));
      if (u + w > 1) {
        u = 1 - u;
        w = 1 - w;
      }
      for (let k = 0; k < 3; k++) {
        cp[i * 3 + k] = pd[a + k] + u * (pd[b + k] - pd[a + k]) + w * (pd[c + k] - pd[a + k]);
      }
      cn[i * 3] = normals[lo * 3];
      cn[i * 3 + 1] = normals[lo * 3 + 1];
      cn[i * 3 + 2] = normals[lo * 3 + 2];
      cs[i] = hashCombine(seed, i, 3);
      candPrim[i] = triPrim[lo];
    }

    // Accept candidates by density (evaluated once over the candidate cloud).
    //
    // Deliberately keyed on the candidate INDEX, not on point identity,
    // and it is the one site in this file where index is the right key.
    // Everywhere else index is a name the ARRAY gives a point, so it moves
    // when the array is reordered; here the candidates do not exist until
    // this node manufactures them, and `i` is the name it assigns. Nothing
    // upstream can permute them, growing `count` appends rather than
    // renumbers (candidate i draws from (seed, i, ...) alone), and an
    // identity key would be a strictly weaker version of the same thing —
    // the identity of candidate i is itself a function of (seed, i), since
    // both its position and its seed are. Note what this does NOT buy:
    // surfaceSample is not permutation-equivariant in its INPUT, because
    // the area CDF is built in primitive order, and no keying of the
    // acceptance draw could make it so.
    const density = requireTuple(
      await resolveOnMaybeGpu(gpu, candidates, "point", params.densityField, seed, "surfaceSample", "densityField"),
      [1],
      "surfaceSample",
      "densityField",
    );
    const accepted: number[] = [];
    for (let i = 0; i < n; i++) {
      if (hashFloat(hashCombine(seed, i, 4)) < density.data[i]) accepted.push(i);
    }
    // The mesh's per-primitive values, onto the candidates — `gatherPoints`
    // then carries the new columns to the survivors for free.
    //
    // AFTER the density resolve, not before, and that ordering is
    // load-bearing rather than incidental: the GPU resolver keys its
    // kernel cache on the domain's whole ATTRIBUTE LAYOUT and compiles
    // against it, so widening the candidate cloud first would change
    // eligibility and could bounce a mesh carrying a string primitive
    // attribute off the device entirely. `densityField` therefore sees
    // exactly the layout it saw before this phase, on both paths. Adding
    // columns here cannot disturb the resolved `density` either: the
    // candidate count is unchanged, so nothing is resized and no existing
    // column moves.
    carryPrimitiveAttributes(
      geo.attrs.primitive,
      candidates.attrs.point,
      candPrim,
      "surfaceSample",
      "point",
    );
    return { out: [makeGeometryItem(gatherPoints(candidates, accepted))] };
  },
});

/** Params of {@link splineSample}. */
export interface SplineSampleParams {
  mode: string;
  count: number;
  spacing: number;
  sampledLengthAttr: string;
  sampleArcAttr: string;
}

/**
 * The two refusals {@link splineSample}'s `sampleArcAttr` owes that
 * {@link requireReportSlot} cannot give it, both about columns that are not
 * on the output's point domain YET when the slot is checked. The same pair
 * `pathResample` owes, for the same two reasons — this node builds a fresh
 * cloud and carries the input's primitive columns onto it exactly as that
 * one does — with one difference stated below.
 *
 * The INPUT'S PRIMITIVE columns are all CARRIED onto these samples, so they
 * end up on the output's POINT domain, where this report lands. The
 * point-domain `requireReportSlot` runs BEFORE the carry — it has to, since
 * the carry must find the column already there to refuse it — so without
 * this pre-check the collision is caught inside `carryPrimitiveAttributes`,
 * whose message is about the CARRIED attribute: it never names
 * `sampleArcAttr`, it sends the reader to the setAttribute or
 * promoteAttribute that produced the input's column, and it says the name
 * "is already the attribute this node writes itself" when that is only true
 * because this param asked for it. Right refusal, wrong fix, and error
 * messages are part of this library's agent API.
 */
function requireSplineArcSlot(attrs: AttributeSet, params: SplineSampleParams): void {
  const name = params.sampleArcAttr;
  if (name === "") return;
  const carried = attrs.get(name);
  if (carried === undefined) return;
  const shape = carried.tupleSize === 1 ? carried.type : `${carried.type}x${carried.tupleSize}`;
  throw new Error(
    `splineSample: sampleArcAttr "${name}" is also a PRIMITIVE attribute of the input (${shape}), and every primitive attribute is carried onto this node's samples — both would land on the same POINT column, and the one written second would take it. Primitive attributes come along automatically and there is no opt-out, so the fix here is to RENAME THE PARAM: give sampleArcAttr a name of its own (e.g. "sampleArc"). Renaming the input's column instead, or dropping it upstream with removeAttribute (domain "primitive", names ["${name}"]) if it is genuinely dead, works too — but it moves the author's own value to make room for a report, which is the wrong way round.`,
  );
}

/**
 * The `primtype` half of {@link requireSplineArcSlot}, param-only and over
 * BOTH reports.
 *
 * THE ONE PLACE THIS NODE'S RULE IS NOT `pathResample`'S ARGUMENT VERBATIM,
 * and it is worth saying why the answer is the same anyway. `pathResample`
 * emits PATHS, so it stamps `primtype` on its own output and a point column
 * under that name is a second meaning for a name it writes itself. This node
 * emits a CLOUD with no topology at all, so nothing here stamps the tag and
 * an f32 column called `primtype` collides with nothing today. It is refused
 * all the same: `carryPrimitiveAttributes` already refuses to carry the tag
 * for the same reason, the path nodes resolve the name as a TYPE, and one
 * `promoteAttribute` onto the primitive domain later replaces the string tag
 * with a float and leaves every path node downstream unable to find a path.
 * A slot whose only defence is that this node happens not to write topology
 * is a slot that fails the day it does.
 *
 * BOTH REPORTS, and the detail one is the reason this is a loop rather than
 * one `if`. `pathResample` gets its per-path report's refusal for free: that
 * one lands on the PRIMITIVE domain, where `primtype` already exists as a
 * string, so `requireReportSlot`'s shape check refuses it without anyone
 * having to think about the name. The detail domain holds no such column, so
 * nothing catches it there and `sampledLengthAttr: "primtype"` would write a
 * float under the tag's name in silence — the shorter promote away from the
 * same wreckage, and an asymmetry with a stated rationale on one side and
 * nothing on the other.
 */
function requireSplineReportsNotPrimtype(params: SplineSampleParams): void {
  for (const { param, name, domain } of [
    { param: "sampleArcAttr", name: params.sampleArcAttr, domain: "POINT" },
    { param: "sampledLengthAttr", name: params.sampledLengthAttr, domain: "DETAIL" },
  ]) {
    if (name !== PRIMTYPE_ATTR) continue;
    throw new Error(
      `splineSample: ${param} may not be "${PRIMTYPE_ATTR}" — that name is the primitive TYPE TAG, not a report slot. carryPrimitiveAttributes refuses to carry it for the same reason, and the path nodes read it to decide what is a polyline; an f32 ${domain} column under that name would be a second meaning for a name the library resolves as a type, and one promoteAttribute onto the primitive domain would replace the tag with a float and leave every path node downstream unable to find a path. Give ${param} a name of its own (e.g. "${param === "sampleArcAttr" ? "sampleArc" : "sampleLength"}").`,
    );
  }
}

/** Arc-length spline sampling over polyline primitives. */
export const splineSample = standardNode<SplineSampleParams>({
  type: "splineSample",
  category: "sampler",
  description:
    "Samples points along polyline primitives by arc length, treating all polylines of the input as one concatenated curve. mode 'count' places exactly `count` samples (endpoints included on open curves; when every polyline is closed the samples divide the total length without duplicating the start). mode 'spacing' places samples every `spacing` world units from the start. Output points carry P, the unit segment `tangent` (f32 tuple 3), and `curveU` (f32) — the normalized arc-length position in [0, 1]. Each sample ALSO carries every attribute of the polyline PRIMITIVE it landed on, even though the polylines are measured as one concatenated curve, so a per-edge value survives the sampling; a sample landing exactly on a join between two polylines takes the LATER one's values. `primtype` is the one exception, being a type tag rather than a value, and there is no opt-out: a carried name that collides with one this node writes is refused with an error naming the attribute and the fix. TWO OPT-IN REPORTS publish the ruler this node's OUTPUT is measured in, which is not the one `curveU` speaks: `curveU` is a fraction of the INPUT CURVE's arc length, while the thing handed downstream is the POLYLINE THROUGH THE SAMPLES, and a sampling CUTS CORNERS — the two agree on straights and diverge wherever the curve bends, so `curveU` times any length is two rulers in one expression and drifts exactly over the bends where a consumer reads it. `sampledLengthAttr` writes the emitted polyline's total chord length to the DETAIL domain (one number: every polyline is one curve here), including the closing chord back to the first sample when every input polyline is closed. `sampleArcAttr` writes each sample's own arc position along that same emitted polyline, in WORLD UNITS, to the POINT domain — the coordinate pathPointAt's 'distance' mode, transferAlongPath and arcTile all read. Both are empty by default and the output is byte-identical to a cook without them. Input polylines come from pointsToPath, pathResample, or createPolyline in TypeScript; the output is a plain point CLOUD with no topology, so it is no longer a path. Topology is fragile upstream too: any node that can REMOVE points drops it — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute — and so does mergePoints, so a path that passes through one stops being a path and this node will report that it found no polylines. Category is not the rule: projectToPlane is categorised `filter` but preserves topology, and filterByAttribute drops it even when its predicate keeps every point.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    mode: {
      type: "enum",
      default: "count",
      enum: ["count", "spacing"],
      description:
        "How samples are placed: 'count' distributes exactly `count` samples over the total arc length; 'spacing' steps every `spacing` units.",
    },
    count: {
      type: "i32",
      default: 10,
      min: 1,
      description: "Number of samples when mode is 'count'. Minimum 1. Ignored in 'spacing' mode.",
    },
    spacing: {
      type: "f32",
      default: 1,
      min: 0,
      description:
        "Distance between samples in world units when mode is 'spacing'. Must be > 0 in that mode. Ignored in 'count' mode.",
    },
    sampledLengthAttr: {
      type: "string",
      default: "",
      description:
        "Name of an f32 DETAIL attribute (tuple 1) receiving the length of the polyline this node EMITS: the sum of the straight-line chords between consecutive samples, plus the closing chord from the last sample back to the first when every input polyline is closed (the case in which the samples divide the curve without duplicating the start, so the emitted sequence is a ring). Empty (the default) writes none. IT IS NOT THE INPUT CURVE'S LENGTH AND THAT IS THE POINT: a sampling CUTS CORNERS, so the polyline through the samples is always SHORTER than the curve it was cut from, and the shortfall is NOT UNIFORM — every unit of it accrues over the bends and none of it over the straights, so no scale factor turns one into the other. A consumer that steps the curve's length over these samples drifts, running off the end or wrapping short of its own seam. This is the number to divide `sampleArcAttr` by for a fraction, and the number to multiply a fraction by to get back to world units; `curveU` times this length is the mistake the pair exists to remove, because that expression mixes the CURVE's parameterization with the CHORD's ruler and the two only agree where the curve is straight. Measured from the f32 positions actually written, in the same order and with the same arithmetic `polylineArcTables` uses to re-measure a cloud downstream, so the number a later pathResample, pathPointAt, arcTile or transferAlongPath computes over these points IS this number rather than a near miss — the column itself is f32, so what a graph reads is that f64 sum rounded once on the way in. IT LANDS ON THE DETAIL DOMAIN, which is where this node's vocabulary differs from pathResample's: that node resamples every polyline ON ITS OWN ARC LENGTH and emits one output path per input path, so its equivalent report (`resampledLengthAttr`) is a fact about a PRIMITIVE, one per path. This node concatenates every polyline into ONE curve and emits a CLOUD with no primitives at all, so there is exactly ONE emitted length and no primitive to hang it on — the detail domain is the library's one-element domain and where attributeReduce already writes a whole-geometry number. Note that a detail attribute is NOT readable from a point-domain field (a field reads the domain it lands on); broadcast it with promoteAttribute (from 'detail', to 'point', mode 'first') when a field needs it per sample, or read it directly from a host. Same reporting-slot rule as every report in the library: the shape is this node's to pick (f32, tuple 1), so a name the output's detail domain already holds under a different shape is REFUSED rather than deleted and re-added, and a same-shape one is RESET. \"primtype\" is refused outright, from the param alone: it is a type tag rather than a value, and an f32 detail column under that name is one promoteAttribute detail → primitive away from replacing the tag with a float and hiding every path from the nodes that read it. The detail domain holds no `primtype` of its own for the shape check to catch, which is exactly why this name needs stating rather than leaving to the general rule.",
    },
    sampleArcAttr: {
      type: "string",
      default: "",
      description:
        "Name of an f32 POINT attribute (tuple 1) receiving each sample's ARC POSITION from the FIRST sample, measured along the EMITTED polyline: sample 0 is 0, and each later sample adds the straight-line chord from the sample before it. Empty (the default) writes none. ONE RUNNING COORDINATE OVER THE WHOLE OUTPUT, not one per polyline, because that is what this node's model already is — every polyline is measured as one concatenated curve, `curveU` is a fraction of that whole, and a sample crossing from one polyline to the next adds the chord that joins them exactly as any other sample adds its own. (pathResample restarts its arc at 0 on every path because it never concatenates anything; if per-path arcs are what a graph wants, that is the node that produces them.) THE UNITS ARE WORLD UNITS, NOT A 0..1 FRACTION, and that is what makes it more than `curveU` under another name: `pathPointAt`'s 'distance' mode, `pointScatterOnPath.arcAttr`, `transferAlongPath.arcAttr` and `arcTile.startAttr` are all world-unit CHORD coordinates, so this column plugs into any of them with no multiply and nothing for the graph to get wrong. The fraction is one divide away (by `sampledLengthAttr`) while going back the other way needs the length anyway, so the coordinate that composes is the one written. `curveU` is still written beside it and still measures the INPUT curve's fraction; the two disagree by exactly the corner-cutting `sampledLengthAttr` reports, which is why `curveU` times a length is not this column and drifts against it over every bend. It lands on the POINT domain because it is a fact about a SAMPLE — a different number for every point — which is what makes it unlike `sampledLengthAttr` and why it is checked against the output's point domain rather than the detail one. THE CLOSING CHORD OF A FULLY CLOSED INPUT IS NOT IN THIS COLUMN: it runs from the last sample back to the first, so no sample holds it — it is in `sampledLengthAttr`, and the last sample's value plus that chord is the emitted length. Otherwise the last sample's value IS the emitted length. The shape is this node's to pick (f32, tuple 1), so a name already on the OUTPUT's point domain under a different shape is REFUSED rather than deleted and re-added — P, scale, boundsMin, boundsMax and `tangent` (f32x3), rot and color (f32x4) and seed (u32) all reach that refusal — while `density` and `curveU` ARE f32 tuple 1, so naming either passes the shape check and RESETS it, silently overwriting a standard column with an arc length — and `curveU` is then gone rather than merely shadowed, since the two columns become one buffer and the arc is what stays in it. Give it a name of its own. TWO MORE NAMES ARE REFUSED OUTRIGHT. A name that is also a PRIMITIVE attribute of the INPUT is refused before the cook starts, whatever its shape: every primitive attribute is carried onto these samples, so it would land on this very column, and the refusal names this param rather than the carried attribute because renaming the report is the fix and moving the author's own value is not. And \"primtype\" is refused because it is a type tag rather than a value — this node emits no topology, so nothing here stamps it and the collision is only latent, but the name is one the library resolves as a TYPE and one promoteAttribute point → primitive away from replacing that tag with a float and hiding every path from the nodes that read it. Naming this report the same as `sampledLengthAttr` is NOT refused: the two land on different domains, so they are different columns and nothing collides.",
    },
  },
  execute({ inputs, params, seed }) {
    // Param-only, so it lands before any geometry is read: a param error
    // reported as "no polyline primitives" sends the author to debug
    // topology, which is the wrong thing entirely.
    requireSplineReportsNotPrimtype(params);
    const geo = requireGeometry(inputs, "in", "splineSample");
    // Against the INPUT's primitive columns, which are the ones about to be
    // carried onto the output's POINT domain where this report lands — see
    // requireSplineArcSlot for why the carry's own refusal is not enough.
    requireSplineArcSlot(geo.attrs.primitive, params);

    // One arc-length table per polyline primitive, then concatenated into
    // a single curve — the node's documented "all polylines as one" rule.
    // Concatenating with the tables' own per-segment lengths keeps the
    // running total accumulated segment by segment in path order, which
    // is what makes this identical to the pre-extraction single pass.
    const tables = polylineArcTables(geo, "splineSample");
    let nSeg = 0;
    for (const table of tables) nSeg += table.segLen.length;
    const segAx = new Float64Array(nSeg * 3);
    const segDir = new Float64Array(nSeg * 3); // per-segment direction (unnormalized)
    const cum = new Float64Array(nSeg + 1); // cumulative length; cum[j] = length before segment j
    // Which polyline PRIMITIVE each concatenated segment came from — the
    // one thing the concatenation used to throw away, and the only thing
    // a sample needs in order to keep its own curve's values.
    const segPrim = new Uint32Array(nSeg);
    let closedCount = 0;
    let j = 0;
    for (const table of tables) {
      if (table.closed) closedCount++;
      for (let k = 0; k < table.segLen.length; k++) {
        for (let c = 0; c < 3; c++) {
          segAx[j * 3 + c] = table.segStart[k * 3 + c];
          segDir[j * 3 + c] = table.segDir[k * 3 + c];
        }
        cum[j + 1] = cum[j] + table.segLen[k];
        segPrim[j] = table.prim;
        j++;
      }
    }
    const L = cum[nSeg];
    const allClosed = closedCount === tables.length;

    // Sample arc-length positions.
    const positions: number[] = [];
    if (params.mode === "count") {
      const n = params.count;
      const denom = allClosed ? n : Math.max(1, n - 1);
      for (let i = 0; i < n; i++) positions.push((i * L) / denom);
    } else {
      const sp = params.spacing;
      if (!(sp > 0)) {
        throw new Error(`splineSample: spacing must be > 0 in 'spacing' mode, got ${sp}`);
      }
      const eps = sp * 1e-6;
      for (let s = 0; s <= L + eps; s += sp) {
        if (allClosed && s >= L - eps && positions.length > 0) break;
        positions.push(Math.min(s, L));
      }
    }

    const n = positions.length;
    const out = createPointCloud(n);
    const op = out.attrs.point.require("P").data;
    const tangent = out.attrs.point.add("tangent", "f32", 3, [0, 0, 0]).data;
    const curveU = out.attrs.point.add("curveU", "f32", 1, 0).data;
    const seeds = out.attrs.point.require("seed").data;
    // The per-sample report's slot, checked the moment the columns it must
    // not destroy exist and BEFORE the carry that can add more. This node
    // builds a FRESH cloud rather than cloning, so the input's point
    // attributes — which never reach the output — are the wrong set to check
    // against, exactly as pointScatterOnPath.arcAttr documents for its own
    // fresh cloud. The input's PRIMITIVE names were checked above, since the
    // carry lands every one of them on this same domain.
    let sampleArc: Float32Array | undefined;
    if (params.sampleArcAttr !== "") {
      requireReportSlot({
        attrs: out.attrs.point,
        nodeType: "splineSample",
        param: "sampleArcAttr",
        name: params.sampleArcAttr,
        type: "f32",
        tupleSize: 1,
        domain: "point",
        suggestion: "sampleArc",
        // The cloud is this node's own, so a refusal must name it: the
        // input's point columns never reach here, and "remove it from the
        // input" would send an author after a geometry it is not on.
        on: "output",
      });
      sampleArc = out.attrs.point.replace(params.sampleArcAttr, "f32", 1, 0).data;
    }
    // The chord walk over the EMITTED samples, which is the whole point of
    // both reports: `curveU` measures the INPUT curve and this measures what
    // came out. Skipped when neither report asks for it, since it costs a
    // square root per sample on top of the one the tangent already takes,
    // and a report nobody named must not slow down the cook that does not
    // use it. The running sum is kept for either report — `sampleArcAttr`
    // alone needs the walk and not the closing chord, and computing a chord
    // nothing reads would be one square root spent on a number thrown away.
    const wantTotal = params.sampledLengthAttr !== "";
    const wantChords = wantTotal || sampleArc !== undefined;
    // Chord distance from the FIRST sample, in f64 over the f32 positions
    // the loop has just written. BOTH halves of that are load-bearing.
    // Reading the values back out of `op` rather than accumulating the f64
    // expressions above them is what makes this number the one
    // `polylineArcTables` recomputes for the same cloud downstream — it
    // measures an f32 P column and nothing else, so an f64 sum here would be
    // a slightly different length that no later node ever agrees with.
    // Summing in f64 rather than in the f32 column is the same rule from the
    // other side: `cum` accumulates in f64 above, so rounding every partial
    // sum to f32 here would drift away from it over a few thousand samples.
    let arc = 0;
    let px = 0;
    let py = 0;
    let pz = 0;
    const samplePrim = new Uint32Array(n);
    const at = [0, 0]; // scratch [segment, t] reused by every sample
    for (let i = 0; i < n; i++) {
      const s = positions[i];
      locateOnArcLength(at, cum, s);
      const lo = at[0];
      const t = at[1];
      const dx = segDir[lo * 3];
      const dy = segDir[lo * 3 + 1];
      const dz = segDir[lo * 3 + 2];
      op[i * 3] = segAx[lo * 3] + dx * t;
      op[i * 3 + 1] = segAx[lo * 3 + 1] + dy * t;
      op[i * 3 + 2] = segAx[lo * 3 + 2] + dz * t;
      if (wantChords) {
        const x = op[i * 3];
        const y = op[i * 3 + 1];
        const z = op[i * 3 + 2];
        if (i > 0) {
          const cx = x - px;
          const cy = y - py;
          const cz = z - pz;
          arc += Math.sqrt(cx * cx + cy * cy + cz * cz);
        }
        px = x;
        py = y;
        pz = z;
      }
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len > 0) {
        tangent[i * 3] = dx / len;
        tangent[i * 3 + 1] = dy / len;
        tangent[i * 3 + 2] = dz / len;
      }
      curveU[i] = L > 0 ? s / L : 0;
      // AFTER `curveU`, and that order is the one case where it matters:
      // `curveU` is f32 tuple 1, so `sampleArcAttr: "curveU"` passes the
      // shape check and `replace` hands back the SAME buffer. Written first,
      // the arc would be overwritten by the fraction one line later and the
      // column an author explicitly asked for the arc in would hold the
      // other number — the exact plausible-looking cook the reporting-slot
      // rule exists to avoid. Written last, the named param means what it
      // says and the standard column is the one lost, which is the trade
      // every same-shape reset in the library already makes.
      if (sampleArc !== undefined) sampleArc[i] = arc;
      seeds[i] = hashCombine(seed, i);
      samplePrim[i] = segPrim[lo];
    }
    // Each sample keeps its OWN polyline's values, even though the node
    // measured every polyline as one concatenated curve. A sample landing
    // exactly on a join takes the LATER polyline, which is the segment
    // `locateOnArcLength` already put it on — one rule, not two.
    carryPrimitiveAttributes(
      geo.attrs.primitive,
      out.attrs.point,
      samplePrim,
      "splineSample",
      "point",
    );
    if (wantTotal) {
      // The closing chord belongs to the LENGTH and to no sample: when every
      // input polyline is closed the sampling divides the curve WITHOUT
      // duplicating the start (the `allClosed` rule above), so the emitted
      // sequence is a ring and the segment from the last sample back to the
      // first is as real as any other — a length that left it out would be
      // short by one side of the seam. It starts at the last sample and ends
      // where the arc coordinate already reads 0, so there is no sample it
      // could be written on. `allClosed` is exactly the right condition and
      // not an approximation of one: it is the same flag that decided
      // whether the last sample duplicates the first, and a mixed input
      // (some closed, some open) is sampled as an OPEN concatenation, whose
      // last sample is an end rather than a point before a seam.
      let closing = 0;
      if (allClosed && n > 0) {
        const cx = op[0] - px;
        const cy = op[1] - py;
        const cz = op[2] - pz;
        closing = Math.sqrt(cx * cx + cy * cy + cz * cz);
      }
      // Checked against the domain actually written and marked "output":
      // this is the cloud the node built, so "remove it from the input"
      // would send an author after a column that is not there. Nothing on a
      // fresh cloud's detail domain can collide today — createPointCloud
      // leaves it empty and nothing between there and here adds to it — so
      // the guard has nothing to refuse yet. It is written anyway, because
      // the day this node carries a detail column across is the day the
      // guard has to already exist rather than be remembered.
      requireReportSlot({
        attrs: out.attrs.detail,
        nodeType: "splineSample",
        param: "sampledLengthAttr",
        name: params.sampledLengthAttr,
        type: "f32",
        tupleSize: 1,
        domain: "detail",
        suggestion: "sampleLength",
        on: "output",
      });
      out.attrs.detail.replace(params.sampledLengthAttr, "f32", 1, 0).set(0, arc + closing);
    }
    return { out: [makeGeometryItem(out)] };
  },
});

/** Params of {@link volumeSample}. */
export interface VolumeSampleParams {
  boundsMin: readonly number[];
  boundsMax: readonly number[];
  cellSize: number;
  jitter: FieldParam;
  seed: number;
}

const MAX_VOLUME_POINTS = 16_777_216;

/** Regular jittered grid inside an axis-aligned box. */
export const volumeSample = standardNode<VolumeSampleParams>({
  type: "volumeSample",
  category: "sampler",
  description:
    "Fills an axis-aligned box with a regular grid of points: each axis is divided into floor(extent / cellSize) cells (at least 1) and a point is placed at each cell center, then jittered inside its cell. jitter in [0, 1] scales a deterministic per-cell random offset (0 = exact centers, 1 = anywhere in the cell) and may be a field evaluated on the un-jittered centers. Bounds come from the optional input geometry's P extents when connected, else from boundsMin/boundsMax. Emits a standard point cloud.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    boundsMin: {
      type: "vec3",
      default: [0, 0, 0],
      description: "Minimum corner of the box, in world units. Ignored when a geometry is connected.",
    },
    boundsMax: {
      type: "vec3",
      default: [1, 1, 1],
      description: "Maximum corner of the box, in world units. Ignored when a geometry is connected.",
    },
    cellSize: {
      type: "f32",
      default: 1,
      description:
        "Requested grid cell edge length in world units — a REQUEST, not the cell you get. " +
        "Each axis is divided into max(1, floor(extent / cellSize)) whole cells, so the " +
        "actual cell is extent / that count. When the extent is not a multiple you get a " +
        "LARGER cell (extent 20, cellSize 12 -> one 20-wide cell); when the extent is " +
        "smaller than cellSize you get a SMALLER one (extent 20, cellSize 25 -> one 20-wide " +
        "cell, since an axis always has at least one cell). It equals cellSize exactly when " +
        "the extent divides evenly by it. Must be > 0.",
    },
    jitter: {
      type: "f32",
      default: 0,
      min: 0,
      max: 1,
      acceptsField: true,
      description:
        "Per-cell jitter amount in [0, 1]: fraction of the cell size each point may move from its cell center, per axis. Field-capable (evaluated on the grid centers).",
    },
    seed: {
      type: "u32",
      default: 0,
      description: "Extra seed folded into the node seed; change it to re-roll the jitter.",
    },
  },
  // `jitter` may resolve on the GPU. It is evaluated over the freshly
  // built grid cloud (the standard point-cloud attributes) while P
  // still holds the un-jittered cell centers, with the jitter-derived
  // seed — the resolver receives exactly the EvalContext the CPU
  // `resolveOn` call would, before any point moves, so fallback
  // equivalence stays byte-exact.
  gpu: "fields",
  async execute({ inputs, params, seed: nodeSeed, gpu }) {
    const seed = hashCombine(nodeSeed, params.seed);
    if (!(params.cellSize > 0)) {
      throw new Error(`volumeSample: cellSize must be > 0, got ${params.cellSize}`);
    }
    let [minX, minY, minZ] = params.boundsMin;
    let [maxX, maxY, maxZ] = params.boundsMax;
    // Optional: the connected geometry supplies the bounds, and nothing
    // connected falls back to the params. Several connected is an error,
    // not a first-item pick — the bounds of ONE of four groups is a
    // silently wrong volume, and unioning them would be a different node.
    const source = optionalGeometry(inputs, "in", "volumeSample");
    if (source) {
      const P = source.attrs.point.get("P");
      if (!P || P.type !== "f32" || P.tupleSize < 3 || source.pointCount === 0) {
        throw new Error(
          'volumeSample: connected input needs points with a "P" attribute (f32, tupleSize >= 3); disconnect it to use the bounds params',
        );
      }
      minX = minY = minZ = Infinity;
      maxX = maxY = maxZ = -Infinity;
      const pd = P.data;
      const ps = P.tupleSize;
      for (let i = 0; i < source.pointCount; i++) {
        const x = pd[i * ps];
        const y = pd[i * ps + 1];
        const z = pd[i * ps + 2];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      if (!Number.isFinite(minX)) {
        throw new Error("volumeSample: connected input has no finite point positions");
      }
    }
    const ex = Math.max(0, maxX - minX);
    const ey = Math.max(0, maxY - minY);
    const ez = Math.max(0, maxZ - minZ);
    const nx = Math.max(1, Math.floor(ex / params.cellSize + 1e-9));
    const ny = Math.max(1, Math.floor(ey / params.cellSize + 1e-9));
    const nz = Math.max(1, Math.floor(ez / params.cellSize + 1e-9));
    const total = nx * ny * nz;
    if (total > MAX_VOLUME_POINTS) {
      throw new Error(
        `volumeSample: grid would have ${total} points (max ${MAX_VOLUME_POINTS}); increase cellSize or shrink the bounds`,
      );
    }
    const cellX = nx > 0 ? ex / nx : 0;
    const cellY = ny > 0 ? ey / ny : 0;
    const cellZ = nz > 0 ? ez / nz : 0;

    const geo = createPointCloud(total);
    const P = geo.attrs.point.require("P").data;
    const seeds = geo.attrs.point.require("seed").data;
    let i = 0;
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          P[i * 3] = minX + (x + 0.5) * cellX;
          P[i * 3 + 1] = minY + (y + 0.5) * cellY;
          P[i * 3 + 2] = minZ + (z + 0.5) * cellZ;
          seeds[i] = hashCombine(seed, i);
          i++;
        }
      }
    }
    // Jitter each point inside its cell (field evaluated on the centers).
    const jitter = requireTuple(
      await resolveOnMaybeGpu(gpu, geo, "point", params.jitter, seed, "volumeSample", "jitter"),
      [1],
      "volumeSample",
      "jitter",
    );
    i = 0;
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const j = Math.min(1, Math.max(0, jitter.data[i]));
          if (j > 0) {
            P[i * 3] += (hashFloat(hashCombine(seed, x, y, z, 0)) - 0.5) * j * cellX;
            P[i * 3 + 1] += (hashFloat(hashCombine(seed, x, y, z, 1)) - 0.5) * j * cellY;
            P[i * 3 + 2] += (hashFloat(hashCombine(seed, x, y, z, 2)) - 0.5) * j * cellZ;
          }
          i++;
        }
      }
    }
    return { out: [makeGeometryItem(geo)] };
  },
});
