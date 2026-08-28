/**
 * THE PATH-PARAMETRIC TRANSFER: read a path's attributes at arbitrary arc
 * positions and write them onto a cloud that is not the path's.
 *
 * WHY IT IS NOT CALLED A GATHER, which it otherwise would be. The
 * shipped primitive `transform/gather-on-path` already owns that phrase
 * and means very nearly the opposite thing: it slides a path's OWN points
 * along the curve they already sit on, toward the centre of their bin, to
 * turn an even distribution into clumps. Nothing crosses between two
 * geometries there. Two unrelated operations sharing a name is a bad
 * trade anywhere and a worse one here, where a node's description IS the
 * interface an agent reads: the wrong one would be picked from a catalog
 * listing by a reader who did nothing wrong.
 *
 * WHY THIS IS NOT IN `paths.ts`. Everything in that file operates on a
 * path's OWN points — it builds the topology, resamples it, slides its
 * points along it, writes tangents and frames at them — and every one of
 * those nodes takes one geometry in and hands the same geometry back. This
 * one takes TWO, and the geometry it hands back is the one that is not the
 * path. Its shape is the transfer family's, not the path-authoring
 * family's: `transferAttribute` reads a source geometry and writes onto a
 * destination, and so does this. What it shares with the path nodes is the
 * arc table, which it imports rather than rebuilds.
 *
 * WHY IT IS NOT A MAPPING ON `transferAttribute`. That node's three
 * mappings all answer a question asked in SPACE: which source point is
 * nearest, which triangle contains this UV, what does this ray hit. This
 * one is asked in the path's own ARC COORDINATE, which is a different
 * question with a different answer, and the gap between the two opens
 * exactly where a curve folds. Two stations tens of units apart along a
 * lap are centimetres apart in world space at a hairpin, so a nearest-point
 * gather there reads the far side of the corner and reports it as success.
 * A node whose param list decided which of two incompatible questions was
 * being asked would be one node in name only.
 *
 * THE ARC COORDINATE IS THE CHORD ONE. Distance along a path in this
 * library is the running sum of the straight-line distances between
 * consecutive points, closing segment included when the polyline is
 * closed — that is what {@link polylineArcTables} measures, what
 * `pathResample` steps, what `pathPointAt`'s 'distance' mode reads and
 * what `arcTile` tiles over. It is NOT the length of any curve fitted
 * through those points, and it is shorter than one: a polyline is what the
 * library stores and the chord table is the honest measurement of it.
 * Sharing the table is the whole reason the numbers agree — two nodes
 * measuring the same path twice is how they come to disagree about where
 * the halfway point is.
 */
import type { AttrData, Attribute } from "../data/index.js";
import { cloneGeometry, makeGeometryItem } from "../graph/index.js";
import { standardNode } from "./registry.js";
import {
  CANCEL_STRIDE,
  locateOnArcLength,
  polylineArcTables,
  requireGeometry,
  requireReportSlot,
  TRANSFER_BOOKKEEPING,
} from "./util.js";


/** Params of {@link transferAlongPath}. */
export interface TransferAlongPathParams {
  arcAttr: string;
  attributes: string[];
  wrap: boolean;
  normalize: string[];
}

/**
 * Refuse a list param holding an empty entry or a repeat, with the wording
 * both of this node's list params share. A repeated name is refused rather
 * than deduplicated because the two entries are evidence of two different
 * intentions about the same column and only one of them can be right.
 */
function requireDistinctNames(names: readonly string[], param: string): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (name === "") {
      throw new Error(
        `transferAlongPath: param "${param}" holds an empty name; every entry must name a point attribute of the path input`,
      );
    }
    if (seen.has(name)) {
      throw new Error(
        `transferAlongPath: param "${param}" names "${name}" twice; a name appearing twice is two decisions about one column and this node cannot tell which of them you meant — take one of them out`,
      );
    }
    seen.add(name);
  }
}

/** One sampled column, resolved once before a single point is read. */
interface Sampled {
  readonly name: string;
  /** The path's storage for it. */
  readonly src: AttrData;
  /** Components per element in `src`. */
  readonly srcTuple: number;
  /** The destination storage on the output cloud. */
  readonly dst: AttrData;
  /** Components per element in `dst`. */
  readonly dstTuple: number;
  /** How many leading components are interpolated (3 for "P", else the whole tuple). */
  readonly comps: number;
  /** Whether `normalize` named it. */
  readonly unit: boolean;
}

/** Interpolate a path's attributes onto a cloud of arc positions. */
export const transferAlongPath = standardNode<TransferAlongPathParams>({
  type: "transferAlongPath",
  category: "attribute",
  description:
    "Reads a path's point attributes AT ARBITRARY ARC POSITIONS and writes them onto a second, independent point cloud — N stations against an M-point path, with N and M unrelated. The `at` cloud comes back with its count, its order, its identities and its topology untouched, plus one column per sampled attribute. This is the operation the library had no node for. pathPointAt slides the path's OWN points, so its output carries the path's point count and topology and can only answer questions about the path itself; writeCurveFrame evaluates only where a path already has a point; transferAttribute is the NEAREST-POINT gather, which asks its question in space rather than along the arc, and the two answers part company exactly where a curve folds — two stations tens of units apart along a lap are centimetres apart in world space at a hairpin, and a nearest-point gather there reads the far side of the corner and reports it as a hit. This is the arc-parametric sibling of that node, and the pair covers 'what is near me' and 'what is at this distance along'. THE ARC COORDINATE IS THE CHORD ONE: the running sum of the straight-line distances between consecutive path points, including the closing segment when the polyline is closed, which is the same table pathResample steps, pathPointAt's 'distance' mode reads and arcTile tiles over. INTERPOLATION IS LINEAR between the two bracketing path points, componentwise, one tuple size in and the same tuple size out. It is not a spline and does not pretend to be: a polyline is a sequence of segments, and inventing curvature between two of its samples would put values on the cloud that the path never held anywhere. EVERY SAMPLED COLUMN ARRIVES AS f32 whatever the path stored it as, because an interpolated value is a real number — a lane index blended half way between lane 1 and lane 2 is 1.5, and an integer column would round that to a value neither neighbour holds and destroy the one fact the query was asking for. A value that must stay discrete is not an interpolation and belongs on transferAttribute's 'nearest' mapping. WHICH ATTRIBUTES: name them in `attributes`, or leave that empty to take every NUMERIC point attribute of the path except the eight standard bookkeeping columns (P, rot, scale, density, boundsMin, boundsMax, color, seed) — see that param for the argument. Naming one LIFTS the exclusion — the eight are skipped by the default rule, not forbidden — and P is the case that earns the design: sample P and every point moves to its own arc position, which is how a cloud of stations becomes a set of positions on a road. Lifting the exclusion is not a promise that the write lands: a sample arrives as f32, so the library's reporting-slot rule refuses a name the `at` cloud already carries in ANOTHER shape rather than deleting it, and `seed` therefore never lands on an ordinary cloud, whose own seed is u32 — which is the right answer, since an interpolated identity is not one. P is exempt from that rule because it is written into the cloud's own column. String attributes cannot be interpolated at all; the default rule skips them and naming one is refused. WRAPPING FOLLOWS THE PATH'S OWN CLOSED FLAG, in `pathRuns`' words and with its semantics: on a CLOSED path `wrap` (the default) takes the arc position modulo the path's length, correcting a negative, so any real number is a legal station and a lap counter that has passed the line four times still lands in the right place; with it off, and on an OPEN path where it does nothing, positions outside the path CLAMP to its ends. Either way the closing segment of a closed path is a segment like any other, so a position between the last point and the first interpolates round to the first rather than falling off the end. NORMALIZE re-lengthens a direction the blend shortened, and is opt-in for the reason the param gives. DETERMINISM IS STRUCTURAL HERE, not a promise about a seed: each point of `at` is answered from its own arc value and the path alone, there is no reduction over the cloud and no randomness of any kind, so the same station gets the same answer in a cloud of one and a cloud of a million, in any order, and shuffling the input shuffles the output and changes nothing else. ONE POLYLINE ONLY: a path input holding several is refused rather than resolved to the first, because gathering off the wrong road is a cook that looks entirely fine. The output's topology is the `at` cloud's — this node removes no point, so a path handed to `at` comes back a path.",
  inputs: [
    { name: "path", kind: "geometry" },
    { name: "at", kind: "geometry" },
  ],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    arcAttr: {
      type: "string",
      default: "station",
      description:
        "POINT attribute on the `at` input (tuple 1, numeric) holding each point's position along the path, as an arc length in WORLD UNITS — the same coordinate pathPointAt's 'distance' mode reads and arcTile's `startAttr` carries. Must exist; a string column and a column wider than one are both refused, the second because which component was meant is not a question this node answers for you (extract it first with setAttribute and a component() field). THE UNITS ARE THE TRAP, not the name. A track measured in half-widths, a route measured in fractions of the whole and a scan measured in samples are all called a station by somebody, and all three land somewhere wrong here without being obviously wrong anywhere: multiply by the half-width, by the path's length, or by the sample pitch with setAttribute first, and gather on the world-unit column. A NON-FINITE value is refused, naming the point — a station that could not be computed has nowhere to be, and writing the value at arc 0 onto it would hand a real position to a point whose position is unknown, which is the failure this refusal exists to prevent rather than to disguise. Drop such points upstream with filterByExpression, or give them a station with setAttribute.",
    },
    attributes: {
      type: "stringList",
      default: [],
      description:
        "Path POINT attributes to interpolate onto the cloud, in any order. AN EXPLICIT LIST IS WHAT TO WRITE WHEN THE ANSWER MATTERS: every name here is sampled, and naming one of the eight standard bookkeeping columns lifts the exclusion the empty list applies — they are skipped by that rule, never forbidden by it. EMPTY (the default) means every NUMERIC point attribute of the path EXCEPT P, rot, scale, density, boundsMin, boundsMax, color and seed. Those eight are excluded because they are the point domain's own bookkeeping — written on every cloud in the library before anyone has decided anything — and each of them describes the path's POINTS rather than the curve: blending seed produces an identity that is neither of its neighbours and then drives randomness as though it meant something; P moves the whole cloud; rot and scale overwrite the transform the cloud arrived with; boundsMin/boundsMax its extent. What is left is exactly what somebody wrote onto the path deliberately — tangent, up, across, curveU, a half-width, a banking angle, a lane count — which is what a station wants. STRING ATTRIBUTES are skipped by the empty-list rule and REFUSED when named, because there is no value between two strings; move one across with transferAttribute's 'nearest' mapping instead. NAMING P IS THE PLACEMENT IDIOM and the reason the eight are excluded rather than forbidden: sample P and every point of the cloud moves onto the curve at its own arc position, which is how a scattered set of stations becomes a set of positions on the road. P is written into the cloud's OWN P column, three components, and that column is never reshaped. THE OTHER SEVEN ARE STILL SUBJECT TO THE REPORTING-SLOT RULE, because a sample lands as f32 and the column on the `at` cloud is the author's: `rot`, `scale`, `density`, `boundsMin`, `boundsMax` and `color` are f32 there too and land; `seed` is u32, so it is refused on any ordinary cloud rather than replacing an identity column with a blend of two identities. Sample it under another name if you really want the number — rename it on the PATH first with setAttribute — and read the refusal as the answer it is. A path with none of its attributes left after the exclusions is refused rather than cooking to a cloud with nothing added, which would look like success.",
    },
    wrap: {
      type: "bool",
      default: true,
      description:
        "Whether an arc position may run off the end of a CLOSED path and come back. True (the default) takes the position modulo the path's length and corrects a negative, so any real number is a legal station — a counter that has passed the start line four times, or a marker placed 3 units BEFORE it at -3, both land where they should. False treats the path's arc as an interval and CLAMPS to its ends. No effect on an OPEN path, which has no seam to cross and always clamps, so the default follows the path's own closed flag and nothing has to be set for the ordinary case. This is not about the closing segment, which exists on a closed path either way: a position between the last point and the first interpolates round to the first under both settings. It is only about what happens outside [0, length].",
    },
    normalize: {
      type: "stringList",
      default: [],
      description:
        "Sampled attributes to rescale to unit length after interpolation (l = the tuple's length, or 1 when that is zero, then divide). OPT-IN because it is a correction, not a default: INTERPOLATING A DIRECTION SHORTENS IT, by an amount that depends on the angle between the two path points' values, so it is worst exactly where the path turns hardest and the shortfall is invisible until something reads the length. A caller sampling `tangent`, `up` and `across` almost always wants all three back at unit length, and one that sampled a velocity or a gradient wants the length left exactly as it came out. NORMALISING THREE AXES INDEPENDENTLY DOES NOT RE-ORTHOGONALISE THEM: each comes back unit length and the angles between them are still the blended ones, which are not right angles wherever the frame twisted between the two path points. A frame that must be orthonormal has to be rebuilt from two of its axes with a cross product (setAttribute and a cross() field), and this param is not that. The same caveat covers `rot`: a componentwise blend of two quaternions normalised afterwards is a shortest-path interpolation of nearly-aligned ones and nothing useful for a pair that are far apart or opposite in sign. Every name must be one this node actually sampled — a name that is not in `attributes`, or that the empty-list rule left out, is refused rather than ignored, since a normalisation that silently did not happen is the failure this param exists to fix. A tuple size of 1 is refused (unit length on one component is the sign, which is what a sign() field is for) and so is P, whose unit length would put the whole cloud on a sphere around the origin.",
    },
  },
  execute({ inputs, params, checkCancelled }) {
    // Params before geometry, as everywhere in this family: a bad name
    // reported as "no polyline primitives" sends the author to debug
    // topology that is fine.
    if (params.arcAttr === "") {
      throw new Error(
        'transferAlongPath: param "arcAttr" must be a non-empty attribute name (the default is "station"); it is the point attribute on the `at` input holding where along the path each point sits, and there is no such thing as gathering at no position',
      );
    }
    requireDistinctNames(params.attributes, "attributes");
    requireDistinctNames(params.normalize, "normalize");
    for (const name of params.normalize) {
      if (name === "P") {
        throw new Error(
          'transferAlongPath: param "normalize" names "P"; rescaling a position to unit length would put every point of the cloud on a sphere of radius 1 about the origin. Normalize a direction (tangent, up, across) instead — P is a place, not a heading.',
        );
      }
    }

    const path = requireGeometry(inputs, "path", "transferAlongPath");
    const at = requireGeometry(inputs, "at", "transferAlongPath");
    // Refuses an empty input, a cloud with no topology, and a "path" of a
    // single point (a polyline needs two vertices), all with the one
    // message that tells the author which node upstream ate the topology.
    const tables = polylineArcTables(path, "transferAlongPath");
    if (tables.length > 1) {
      throw new Error(
        `transferAlongPath: the path input holds ${tables.length} polylines (primitives ${tables.map((t) => t.prim).join(", ")}), and an arc position means a different place on each of them. This is refused rather than resolved to the first, because gathering off the wrong road is a cook that looks entirely fine. Reduce the input to ONE polyline — filterPrimitivesByAttribute, or partitionByAttribute upstream of pointsToPath so each path cooks in its own item.`,
      );
    }
    const table = tables[0];
    const L = table.length;
    if (!(L > 0)) {
      throw new Error(
        `transferAlongPath: the path at primitive ${table.prim} has zero length (all of its points sit at the same position), so there is no arc to gather along and every station would resolve to the same place. Move its points apart, or drop it upstream.`,
      );
    }

    const atSet = at.attrs.point;
    const arc = atSet.get(params.arcAttr);
    if (!arc) {
      throw new Error(
        `transferAlongPath: param "arcAttr" names point attribute "${params.arcAttr}", which does not exist on the \`at\` input; available point attributes there: ${atSet.names().join(", ") || "(none)"}. Write it with setAttribute (an arc length in world units), or point this param at the column that already holds one.`,
      );
    }
    if (arc.type === "string") {
      throw new Error(
        `transferAlongPath: param "arcAttr" names string attribute "${params.arcAttr}" on the \`at\` input; it must name a numeric attribute (f32/i32/u32/bool) — an arc position is measured, not spelled`,
      );
    }
    if (arc.tupleSize !== 1) {
      throw new Error(
        `transferAlongPath: param "arcAttr" names attribute "${params.arcAttr}" on the \`at\` input with tupleSize ${arc.tupleSize}; it must be scalar (tupleSize 1), and which component was meant is not a question this node answers for you — extract it first with setAttribute and a component() field`,
      );
    }

    // WHICH COLUMNS, resolved on the PATH before anything is cloned: a
    // refusal costs nothing here and the clone does.
    const pathSet = path.attrs.point;
    const sources: Attribute[] = [];
    if (params.attributes.length > 0) {
      for (const name of params.attributes) {
        const src = pathSet.get(name);
        if (!src) {
          throw new Error(
            `transferAlongPath: param "attributes" names point attribute "${name}", which the path input does not have; its point attributes are: ${pathSet.names().join(", ") || "(none)"}`,
          );
        }
        if (src.type === "string") {
          throw new Error(
            `transferAlongPath: param "attributes" names string attribute "${name}" on the path input; there is no value between two strings, so an interpolation cannot produce one. Move it across with transferAttribute (mapping 'nearest'), which copies rather than blends, or convert it to a numeric index upstream.`,
          );
        }
        sources.push(src);
      }
    } else {
      for (const src of pathSet) {
        if (src.type === "string") continue;
        if (TRANSFER_BOOKKEEPING.has(src.name)) continue;
        sources.push(src);
      }
      if (sources.length === 0) {
        throw new Error(
          `transferAlongPath: param "attributes" is empty, so this node samples every numeric point attribute of the path except the standard bookkeeping ones (${[...TRANSFER_BOOKKEEPING].join(", ")}) — and the path has none left. Its point attributes are: ${pathSet.names().join(", ") || "(none)"}. Write what you want to gather onto the path first (writeTangents, writeCurveFrame, pathScan, setAttribute), or name one of the excluded columns explicitly in "attributes" — naming P is how a cloud of stations is placed onto the curve.`,
        );
      }
    }

    const wanted = new Set(sources.map((s) => s.name));
    for (const name of params.normalize) {
      if (!wanted.has(name)) {
        throw new Error(
          `transferAlongPath: param "normalize" names "${name}", which this node is not sampling; it can only rescale a column it wrote. Sampling: ${[...wanted].join(", ")}. Add "${name}" to "attributes" (an explicit list always works), or take it out of "normalize".`,
        );
      }
    }
    const unitNames = new Set(params.normalize);
    for (const src of sources) {
      if (unitNames.has(src.name) && src.tupleSize < 2) {
        throw new Error(
          `transferAlongPath: param "normalize" names "${src.name}", which the path carries with tupleSize ${src.tupleSize}; unit length on a single component is its sign and nothing more, which is what a sign() field says clearly. Normalize a vector, or drop the name.`,
        );
      }
    }

    const out = cloneGeometry(at);
    const outSet = out.attrs.point;
    const outP = outSet.get("P");
    const samples: Sampled[] = [];
    let widest = 1;
    for (const src of sources) {
      if (src.name === "P") {
        // P is written into the cloud's OWN column rather than a fresh one
        // of the path's shape. Reshaping P is not a thing this node may do
        // — every downstream node reads it — and removeAttribute cannot
        // clear the way for it either, since it refuses to remove P at all.
        // So the requirement is stated here, in its own words.
        if (!outP || outP.type !== "f32" || outP.tupleSize < 3) {
          throw new Error(
            `transferAlongPath: param "attributes" names "P", but the \`at\` input's own P is ${outP ? `${outP.type}[${outP.tupleSize}]` : "missing"} and this node writes three f32 components into it. A point cloud from createPointCloud (or any node in this library) carries P as f32[3]; an input whose P is anything else was not built here, and reshaping it is not something this node may do, because every downstream node reads it.`,
          );
        }
        samples.push({
          name: "P",
          src: src.data,
          srcTuple: src.tupleSize,
          dst: outP.data,
          dstTuple: outP.tupleSize,
          comps: 3,
          unit: false,
        });
        widest = Math.max(widest, 3);
        continue;
      }
      // Every other sampled column is this node's to write, so a
      // differently shaped one already under that name is refused rather
      // than deleted and re-added — the library's reporting-slot rule.
      requireReportSlot({
        attrs: outSet,
        nodeType: "transferAlongPath",
        param: "the sampled attribute",
        name: src.name,
        type: "f32",
        tupleSize: src.tupleSize,
        domain: "point",
        suggestion: `${src.name}OnPath`,
      });
      const dst = outSet.replace(src.name, "f32", src.tupleSize, 0);
      samples.push({
        name: src.name,
        src: src.data,
        srcTuple: src.tupleSize,
        dst: dst.data,
        dstTuple: src.tupleSize,
        comps: src.tupleSize,
        unit: unitNames.has(src.name),
      });
      widest = Math.max(widest, src.tupleSize);
    }

    const n = outSet.count;
    const arcData = arc.data;
    const cum = table.cum;
    const pts = table.points;
    const wrapping = params.wrap && table.closed;
    const found = [0, 0]; // scratch [segment, t], reused by every point
    const blend = new Float64Array(widest); // scratch tuple, same reason
    const nSamples = samples.length;

    for (let i = 0; i < n; i++) {
      if ((i & (CANCEL_STRIDE - 1)) === 0) checkCancelled();
      const raw = arcData[i];
      if (!Number.isFinite(raw)) {
        throw new Error(
          `transferAlongPath: point ${i} of the \`at\` input has arc position ${raw} in "${params.arcAttr}"; a station that could not be computed has nowhere on the path to be, and writing the value at arc 0 onto it would give a real answer to a point whose question is unknown. Drop it upstream with filterByExpression, or give it a position with setAttribute.`,
        );
      }
      let d: number;
      if (wrapping) {
        d = raw % L;
        if (d < 0) d += L;
        // A tiny negative can round to exactly L on the correction above.
        if (d >= L) d = 0;
      } else {
        d = raw < 0 ? 0 : raw > L ? L : raw;
      }
      // The library's one arc-length locate, shared with pathPointAt and
      // pathResample: first segment whose end is past `d`, clamped to the
      // last, with t = 0 on a zero-length segment.
      locateOnArcLength(found, cum, d);
      const seg = found[0];
      const t = found[1];
      // On a CLOSED path the walk's last vertex is the first point again,
      // so the closing segment's far end wraps round with no special case.
      const a = pts[seg];
      const b = pts[seg + 1];

      for (let k = 0; k < nSamples; k++) {
        const s = samples[k];
        const src = s.src;
        const comps = s.comps;
        const ao = a * s.srcTuple;
        const bo = b * s.srcTuple;
        const o = i * s.dstTuple;
        const dst = s.dst;
        if (s.unit) {
          let sq = 0;
          for (let c = 0; c < comps; c++) {
            const v = src[ao + c] + (src[bo + c] - src[ao + c]) * t;
            blend[c] = v;
            sq += v * v;
          }
          // `Math.sqrt` of the sum of squares rather than `Math.hypot`,
          // for the reason `pointLine` gives about its own unit
          // direction: sqrt is correctly rounded by IEEE-754 everywhere
          // and hypot is implementation-defined, and determinism across
          // platforms is not negotiable. `|| 1` catches both a zero
          // length and a NaN one, leaving the blended tuple as it came
          // out rather than turning it into three NaNs.
          const len = Math.sqrt(sq) || 1;
          for (let c = 0; c < comps; c++) dst[o + c] = blend[c] / len;
        } else {
          for (let c = 0; c < comps; c++) {
            dst[o + c] = src[ao + c] + (src[bo + c] - src[ao + c]) * t;
          }
        }
      }
    }

    return { out: [makeGeometryItem(out)] };
  },
});
