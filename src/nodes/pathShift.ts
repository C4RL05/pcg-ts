/**
 * THE ORDINAL NEIGHBOUR ALONG A PATH: for each point of a polyline, read
 * that path's own point attributes from the point `offset` positions
 * further along the WALK, and write each into a column of its own. Lead and
 * lag on a path — "what does the next station carry", "what did the
 * previous one carry".
 *
 * WHY IT IS NOT A PARAM ON `pathScan` (or `pathRuns`). Those are PREFIX
 * SUMS. A scan answers "how much lies behind me along the curve", and the
 * next point's value is not a function of any accumulation of the values
 * before it — no reading of a running total recovers a single neighbour's
 * entry, in either direction. They are also ADDERS, so they are numeric by
 * construction: an asset id, a lane name, a string archetype has no partial
 * sum and cannot travel through one at all. What the two operations share
 * is the walk, which this node imports (`polylineWalks`) rather than
 * rebuilds; everything else about them is different, and a node whose param
 * list decided whether it was accumulating or gathering would be one node
 * in name only — `pathScan`'s `mode`, `pathRuns`' `boundary`, `direction`
 * and `wrap` mean nothing to a shift, and `outNames` and `outOfRange` mean
 * nothing to a scan.
 *
 * WHY IT IS NOT A MODE ON `transferByIndex`. That node gathers at an
 * ABSOLUTE point index — a position in the source's STORAGE array — and the
 * storage order is not the walk order. `pointsToPath` builds topology over
 * the points where they already lie and never reorders them, so with
 * `orderAttr` set the path can visit point 7 after point 2 while both sit
 * wherever the scatter left them. "The next point along the path" therefore
 * has no expression as "index + 1", and the rank that WOULD let a caller
 * spell it as an index is itself only obtainable by walking the polyline —
 * which is this node. The two are one family (the vocabulary below is
 * deliberately `transferByIndex`'s, down to the spelling of `outOfRange`
 * and the polarity of `hitAttr`) precisely because each keeps its own
 * question intact.
 *
 * WHY IT IS NOT `transferAlongPath`. That one reads at an ARC POSITION and
 * INTERPOLATES between the two bracketing points. An ordinal neighbour is
 * not a distance: stations are unevenly spaced, so "the next one" sits at
 * no fixed arc offset and there is no number to hand that param. And an
 * interpolated value arrives as f32 whatever it started as, which destroys
 * exactly the discrete ids — an i32 lane, a string asset — that a
 * neighbour query is usually asked for. `pathSegments` is no substitute
 * either: it emits a SEPARATE one-point-per-segment cloud and deliberately
 * carries none of the input's point attributes.
 *
 * WHY THE LIBRARY NEEDED IT. A GAP RING. On a closed path of stations
 * ordered by arc position, `gap = shift(station, +1) - station` (corrected
 * across the seam by the lap length) is the distance to the next station,
 * and shifting that gap by -1 hands every station the gap BEHIND it as
 * well. Nothing in the library could produce either number: the transfers
 * ask their questions in space, along the arc, or in storage order, and the
 * scans accumulate. Differences, moving windows and every chain rule
 * between adjacent elements of a sequence have that same shape, and all of
 * them start here.
 *
 * THE RING IS N POINTS, NOT N+1. `pointsToPath(closed: true)` over 5 points
 * produces 5 POINTS and 6 vertices: the trailing vertex revisits point 0,
 * because closure in this library is structural. That repeat is the
 * CLOSURE, not a place — counting it would give the first point a second,
 * contradictory source and leave one point unread — so the ring walked here
 * drops it, exactly as `pathScan` drops it from its sum.
 *
 * WHY A PATHLESS INPUT IS NOT REFUSED, where every other path node refuses
 * one. `pathScan` has nothing to scan and `pathResample` nothing to
 * resample, so a throw is the only honest answer they have. This node has a
 * different answer available, and its own per-point rule already promises
 * it: a point on no polyline keeps its default and flags a miss. A geometry
 * with no polyline is simply the case where EVERY point is that point, so
 * refusing it would answer one question two ways depending on whether the
 * count of stranded points happened to equal the total — a rule nobody
 * could predict from the description, and the kind of seam that only shows
 * up in production. `pointsToPath` with `shortGroups: "skip"` produces
 * exactly that geometry whenever a group is too small for the path being
 * asked for, so a graph shifting over the result must settle to "nobody has
 * a neighbour" rather than crash on a lap that happened to hold two
 * placements. What is still refused is MALFORMED input rather than EMPTY
 * input: a missing pin, an attribute that does not exist, a param that
 * contradicts itself.
 */
import { PRIMTYPE_ATTR } from "../data/index.js";
import type { AttrData, AttrDefault, Attribute, Geometry } from "../data/index.js";
import { cloneGeometry, makeGeometryItem } from "../graph/index.js";
import { standardNode } from "./registry.js";
import { CANCEL_STRIDE, polylineWalks, requireGeometry, requireReportSlot } from "./util.js";

/**
 * The three readings of a position that ran off the end of a path, in
 * `transferByIndex`'s vocabulary and with its meanings. The ORDER differs
 * from that node's only because the default does: a path is far more often
 * a ring than a table with ends.
 */
const OUT_OF_RANGE = ["wrap", "clamp", "miss"] as const;

/** Params of {@link pathShift}. */
export interface PathShiftParams {
  attributes: string[];
  outNames: string[];
  offset: number;
  outOfRange: string;
  hitAttr: string;
}

/**
 * Refuse a list param holding an empty entry or a repeat, with the wording
 * `transferAlongPath` and `transferByIndex` share and for their reason: a
 * name appearing twice is two decisions about one column and only one of
 * them can be right.
 */
function requireDistinctNames(names: readonly string[], param: string, role: string): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (name === "") {
      throw new Error(`pathShift: param "${param}" holds an empty name; every entry must name ${role}`);
    }
    if (seen.has(name)) {
      throw new Error(
        `pathShift: param "${param}" names "${name}" twice; a name appearing twice is two decisions about one column and this node cannot tell which of them you meant — take one of them out`,
      );
    }
    seen.add(name);
  }
}


/** One shifted column, resolved once before a single point is read. */
interface Shifted {
  /** The input's storage for the attribute being read. */
  readonly srcData: AttrData;
  /** The output column it is written into (same type and tuple size). */
  readonly dstData: AttrData;
  /** Components per element, shared by both sides. */
  readonly ts: number;
  /**
   * Non-null for a STRING column: its values are indices into a
   * per-attribute table, so they are re-interned rather than copied.
   */
  readonly strings: { readonly table: readonly string[]; readonly dst: Attribute } | null;
}

/** Read a path's own attributes from the point `offset` positions along. */
export const pathShift = standardNode<PathShiftParams>({
  type: "pathShift",
  category: "attribute",
  description:
    "Reads one or more of a path's OWN point attributes from the point `offset` positions further along the polyline's walk order, and writes each into a column of its own — LEAD AND LAG on a path. `attributes` names the columns to read and `outNames` names where each shifted value lands; the two lists are parallel, entry for entry. This is the neighbour query a sequence has and a point cloud does not: 'what does the NEXT station carry', 'what did the PREVIOUS one carry', and every difference and chain rule those make possible. THE MOTIVATING CASE IS A GAP RING: on a closed path of stations ordered by arc position, shift each station's arc coordinate by +1 and subtract, and every point holds the distance to the next station; shift that gap by -1 and every point holds the gap behind it as well. Moving windows, run lengths between adjacent markers, 'is my successor the same archetype as me' — all of them are this shape. WHY NOT ANOTHER NODE: pathScan and pathRuns are PREFIX SUMS, and a neighbour's value is not a function of any accumulation of the values before it, in either direction — they also ADD, so a string or any other discrete id cannot pass through them at all. transferByIndex gathers at an ABSOLUTE point index, a position in the source's storage array, which is NOT the walk order: pointsToPath builds topology over points where they already lie and never reorders them, so with `orderAttr` set a path visits point 7 after point 2 and 'the next point along' has no expression as 'index + 1' — the rank that would let you spell it as one is itself only obtainable by walking the polyline, which is what this node does. transferAlongPath reads at an ARC POSITION and interpolates, a different question with a different answer: stations are unevenly spaced, so 'the next one' is at no fixed distance, and an interpolated value arrives as f32, which destroys exactly the discrete ids an ordinal neighbour is usually asked for. pathSegments emits a SEPARATE one-point-per-segment cloud and deliberately carries none of the input's point attributes. THE ORDER IS THE POLYLINE'S, NEVER THE POINT ARRAY'S. The walk is the primitive's vertex sequence, so `orderAttr` on pointsToPath decides what 'next' means and the storage order decides nothing at all. Two points adjacent in the point array are neighbours here only if the path happens to visit them in that order. A CLOSED PATH IS A RING OF N POINTS, NOT N+1: pointsToPath(closed) appends a trailing VERTEX that revisits the first point, so 5 points become 5 points and 6 vertices, and that repeat is the closure rather than a place. The ring this node walks has one entry per POINT, so on a closed path with `wrap` a +1 shift takes the last point to the first, every point is read exactly once, and no phantom entry reads itself. A POSITION THAT RAN OFF THE END is read by `outOfRange`, in transferByIndex's vocabulary: 'wrap' (the default) takes a EUCLIDEAN modulo over the polyline's point count, so -1 from the first point is the LAST point and not JavaScript's -1; 'clamp' pins to the first or last point of that same polyline; 'miss' leaves the destination column at its DEFAULT and flags the point through hitAttr. CLOSURE CHANGES THE COUNT AND NEVER THE POLICY: dropping the repeated vertex is what a closed path does to the ring's SIZE, and after that only 'wrap' comes round it, so a closed path under 'clamp' or 'miss' still has a first position and a last. WRAP APPLIES TO AN OPEN PATH TOO, which is a deliberate divergence from pathRuns' `wrap` ('no effect on an open path') and is explained in that param: the two share a word and not a question. OFFSET 0 IS LEGAL AND COPIES — it is not refused, because a shift of nothing is a well-defined shift and a graph that computes its offset should not fail when the number comes out zero. A POINT ON NO POLYLINE gets no neighbour: its destination columns keep their default and hitAttr flags it 0, matching pathScan and writeTangents, which leave such points at zero. It is never an error — a path built over part of a cloud is ordinary. A GEOMETRY WITH NO POLYLINE AT ALL IS THAT SAME RULE AND NOT A SECOND ONE: every point is then a point on no polyline, so every point misses, every destination column holds its default, hitAttr is all 0, and nothing throws. This node therefore does NOT refuse a pathless input the way pathScan, pathResample and writeTangents do, and the difference is that they have nothing to say without a path while this one has a defined answer — the one it already gives per point. Refusing would mean answering one question two ways depending on whether the number of stranded points happened to equal the total. It matters in practice: pointsToPath with shortGroups 'skip' legitimately emits no primitive for a group too small for the path being asked for, and a graph that shifts over the result must settle to 'nobody has a neighbour' rather than crash on a lap that held two placements. Neither `outOfRange` nor `offset` can change it — there is no range to be inside or outside of, and offset 0 is a copy only for a point that HAS a walk to be at position 0 of. A geometry with NO POINTS cooks to itself with the destination columns created and empty, so the shape of the output never depends on what this cook happened to be handed. What is still refused is MALFORMED input rather than EMPTY input: a missing pin, an attribute that does not exist, a param that contradicts itself. A POINT ON SEVERAL POLYLINES is answered by the LAST one in primitive order, the convention writeTangents, pathScan, pathRuns and pathPointAt all state; a MISS from that last polyline wins too, replacing an answer an earlier one had found, so the rule is 'the last polyline decides' and not 'the last polyline that found something'. THE VALUES ARE COPIED, NEVER BLENDED: each output column takes the SOURCE column's type, tuple size and default, so an i32 lane stays an i32 lane, a string asset id transfers intact, and every component of a tuple comes from the SAME neighbour rather than from a componentwise mixture. THE OUTPUT IS THE INPUT plus the new columns: same points, same order, same identities, same topology, and P is never written (see `outNames`) — this node moves no point, adds none and removes none, so a path goes in and the same path comes out. DETERMINISM IS STRUCTURAL: there is no randomness of any kind here, and a point's answer depends only on its polyline's own walk, so it does not change with cook order, partitioning, or how many points are in hand.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    attributes: {
      type: "stringList",
      default: [],
      description:
        "POINT attributes of the path to read from the neighbour, in any order. Each must exist on the `in` input. AN EMPTY LIST IS AN ERROR rather than a default, which is where this param parts company with transferAlongPath's and transferByIndex's otherwise identical one: 'everything' cannot work here because every shifted value needs a DESTINATION NAME, and there is no rule that could invent one you would ever be able to grep for; and the one column every cloud carries is P, whose shift — 'the position of the next point' — is almost never what somebody reaching for this node meant. Say what you want: attributes [\"station\"], outNames [\"nextStation\"]. READING P IS ORDINARY and is the second-most common use after an arc coordinate: shift P into 'nextP' and subtract to get the vector to the next point along the path, which is the segment direction at every station without an arc table. Reading the standard bookkeeping columns is likewise allowed — there is no exclusion list here, because there is no 'everything' default for an exclusion list to trim. A name this node cannot find is refused with the input's point attributes listed, and an empty or repeated entry is refused too.",
    },
    outNames: {
      type: "stringList",
      default: [],
      description:
        "Where each shifted value is written, PARALLEL to `attributes`: outNames[i] receives the neighbour's attributes[i]. Must be exactly as long as `attributes` — a mismatch is refused naming both lengths, because a shorter list is either a forgotten name or a name in the wrong slot and this node cannot tell which. EXPLICIT NAMES RATHER THAN A GENERATED PREFIX: a column called 'next_station' that no node in the graph mentions is a name nobody can grep for, and renaming the source silently renames a column three nodes downstream. AN ENTRY MAY NOT NAME A COLUMN `attributes` IS READING. Reading and writing one column in a single pass has two possible meanings — every point sees the values it arrived with, or every point sees whatever the walk has already overwritten — and they differ at the first point of every path, so it is refused rather than resolved. Shift into a new name and removeAttribute the original afterwards if the original is genuinely dead. EACH COLUMN TAKES THE SOURCE'S SHAPE — type, tuple size and default value — so this is a COPY TARGET and not a reporting slot: an existing column of another shape under one of these names is REPLACED rather than refused, exactly as transferAttribute replaces its destination, because overwriting is what a copy IS. 'P' IS THE ONE NAME REFUSED OUTRIGHT, same shape or not, and the reason is this node's miss rule rather than squeamishness: the destination column is RESET before the walk, so every point with no neighbour — a point on no polyline, or any point at all under outOfRange 'miss' — would be left at P's default and the cloud would collapse onto the origin while the cook still looked fine. Shift into a name of your own; if you really do want to move points onto their neighbours' positions, write that name into P deliberately with setAttribute, having decided first what the ends should do.",
    },
    offset: {
      type: "i32",
      default: 1,
      description:
        "How many positions along the path's walk order to look, counted in POINTS and not in distance — the neighbour, not the metre. +1 (the default) is the next point, +2 the one after it. NEGATIVE IS LEGAL and looks BACKWARDS: -1 is the previous point, which is the lag half of the pair and the thing that turns a column of forward gaps into a column of backward ones. 0 IS LEGAL AND COPIES the attribute into its new name unchanged; it is not refused, because a shift of nothing is a well-defined shift and a graph whose offset is computed should not fail the cook when the number comes out zero. Note that even at 0 this is not a plain attribute copy: a point on no polyline still gets the default rather than its own value, because it has no walk to be at position 0 of. AN OFFSET LARGER THAN A PATH'S POINT COUNT is not an error — it is exactly what `outOfRange` is for, and under 'wrap' it comes back round in a single modulo however far out it is. Must be a whole number; a fractional or non-finite offset is refused naming this param, because a position along a walk is an ordinal and there is no point half way between two of them (the value half way between them is transferAlongPath's question, asked in arc length).",
    },
    outOfRange: {
      type: "enum",
      default: "wrap",
      enum: [...OUT_OF_RANGE],
      description:
        "How a position outside [0, pointsInThisPolyline-1] is read. Per POLYLINE, always: each path is its own sequence and nothing ever reaches out of one path into another, whatever this is set to. 'wrap' (the default) takes a EUCLIDEAN modulo over that polyline's point count — the remainder is made non-negative before use, so -1 from the FIRST point is the LAST point rather than the -1 that JavaScript's own % operator returns, and an offset many times the path's length comes back round in one step. On a CLOSED path this is simply the ring, and it is the default because a lap, a loop of stations and a cycle of archetypes are what paths in this library mostly are. ON AN OPEN PATH 'wrap' STILL WRAPS, and that is a deliberate divergence from pathRuns' `wrap`, whose description says 'no effect on an open path': the two share a word and not a question. pathRuns' wrap is about a SEAM — may a run cross the closing segment — and an open path has no seam to cross. This param is transferByIndex's `outOfRange`, a policy for an ORDINAL that ran off the end of a list, and the list is there whether or not a closing segment joins its ends. Reading it as 'clamp' on an open path would give one setting two answers depending on a flag the author may not control, and a clamped value is indistinguishable downstream from a real neighbour. If the ends of an open path should have NO neighbour, say that with 'miss', which is the setting that means it. 'clamp' pins the position to the polyline's first or last point, so the last point of an open path reads itself at +1 and nothing misses; it IGNORES CLOSURE, so a closed path under 'clamp' does not come round to its start — pick it when the vertex order carries meaning of its own and the ends are ends. 'miss' leaves the destination column at its DEFAULT (the source attribute's own default value, since these columns are this node's to create) and flags the point 0 through hitAttr. Use it when running off the end means 'no answer' rather than 'the nearest answer': the other two both invent one. It ignores closure exactly as 'clamp' does. CLOSURE CHANGES THE COUNT, NEVER THE POLICY is the whole rule here: a closed path's repeated last vertex is not a place, so the ring it forms has one entry per point — and after that, only 'wrap' comes round it. A closed path under 'clamp' or 'miss' still has a first position and a last, which is what lets a lap be walked as a sequence when that is what you meant. A polyline of ONE point — a closed primitive whose two vertices are the same point — is a ring of one under 'wrap' and 'clamp' alike, so it reads itself at every offset; under 'miss' it hits only at offset 0. A GEOMETRY WITH NO POLYLINE AT ALL is untouched by this param: every point misses under all three settings, because a point with no walk is not at a position that could be inside or outside a range. That is the same answer a stranded point in a partly-pathed cloud gets, and deliberately so.",
    },
    hitAttr: {
      type: "string",
      default: "",
      description:
        "When non-empty, writes a per-point flag of this name onto the OUTPUT'S POINT DOMAIN (bool, tuple 1). The polarity is the HIT: 1 means this point found a neighbour and received its values, 0 means it did not and its destination columns hold the source attribute's default. A 0 has exactly two causes, and telling them apart is what makes this worth writing: the point belongs to NO polyline (a geometry carrying no polyline at all makes every point that kind), or outOfRange is 'miss' and its neighbour ran off the end of its path. Under 'wrap' and 'clamp' the second cause cannot happen, so a 0 there means the point is on no path at all — which is the only per-point way to find such a point, since a default is a real value and looks like one. Every point is written, so the column never carries a stale value from an earlier cook. Feed it to filterByAttribute (comparison 'eq', value 1) to keep only the points that landed, then removeAttribute to clean it up. Three kinds of name are refused rather than written: any attribute named in `attributes`, which this node READS and the flag would destroy; any name in `outNames`, which the flag would overwrite with a bool after the shift had already written the value; and any point attribute the input already holds under a DIFFERENT shape — the flag's shape is this node's to pick, so writing it there would delete that column and everything in it while the cook still looked fine (hitAttr \"P\" would leave a point cloud with no positions). An existing bool tuple-1 column of the same name IS reused and reset, which is what keeps the flag describing THIS shift only. On a clash, give the flag a name of its own (a \"__\" prefix marks it internal, e.g. \"__hit\") or removeAttribute the existing column first. Empty = don't record.",
    },
  },
  execute({ inputs, params, checkCancelled }) {
    // Params before geometry, as everywhere in this family: a bad name
    // reported as "no polyline primitives" sends the author to debug the
    // wrong thing entirely.
    const { attributes, outNames, offset } = params;
    if (attributes.length === 0) {
      throw new Error(
        'pathShift: param "attributes" is empty, and unlike transferAlongPath and transferByIndex this node has no "everything" default: each shifted value needs a DESTINATION NAME in "outNames", and no rule could invent one worth grepping for — while the one column every cloud carries is P, whose shift is almost never what was meant. Name what to read and where it lands, e.g. attributes ["station"] with outNames ["nextStation"].',
      );
    }
    requireDistinctNames(
      attributes,
      "attributes",
      "a point attribute of the `in` input to read from the neighbour",
    );
    if (outNames.length !== attributes.length) {
      throw new Error(
        `pathShift: param "outNames" has ${outNames.length} name${outNames.length === 1 ? "" : "s"} but "attributes" has ${attributes.length}; the two lists are PARALLEL — outNames[i] is where the neighbour's attributes[i] is written — so they must be the same length. A short list is either a forgotten name or a name in the wrong slot, and this node cannot tell which of those you meant.`,
      );
    }
    requireDistinctNames(outNames, "outNames", "the column one shifted value is written into");
    const reading = new Set(attributes);
    for (const name of outNames) {
      if (name === "P") {
        throw new Error(
          'pathShift: param "outNames" names "P", which this node never writes. The destination column is RESET before the walk, so every point without a neighbour — a point on no polyline, or any point at all under outOfRange "miss" — would be left at P\'s default and the whole cloud would collapse onto the origin while the cook still looked fine. Shift into a name of your own (e.g. "nextP") and, if you really do want the points moved, write that column into P with setAttribute once you have decided what the ends should do.',
        );
      }
      if (reading.has(name)) {
        throw new Error(
          `pathShift: param "outNames" names "${name}", which "attributes" is also reading. Shifting a column onto itself has two possible meanings — every point sees the values it arrived with, or every point sees what the walk has already overwritten — and they differ at the first point of every path, so this node refuses rather than picking one. Shift into a new name (e.g. "next${name.charAt(0).toUpperCase()}${name.slice(1)}") and removeAttribute the original afterwards if it is genuinely dead.`,
        );
      }
    }
    if (!Number.isInteger(offset)) {
      throw new Error(
        `pathShift: param "offset" is ${offset}; a position along a walk is an ORDINAL, so the offset must be a whole number — positive looks forward, negative looks back, and 0 copies. There is no point half way between two points of a polyline; the VALUE half way between them is transferAlongPath's question, asked in arc length rather than in positions.`,
      );
    }
    const mode = params.outOfRange;
    if (mode !== "wrap" && mode !== "clamp" && mode !== "miss") {
      throw new Error(
        `pathShift: unknown outOfRange "${mode}"; valid settings: ${OUT_OF_RANGE.join(", ")} — wrap takes a Euclidean modulo over the polyline's point count, clamp pins to that polyline's first or last point, miss leaves the destination column at its default and flags the point`,
      );
    }

    const src = requireGeometry(inputs, "in", "pathShift");
    const srcSet = src.attrs.point;

    // WHICH COLUMNS, resolved on the INPUT before anything is cloned: a
    // refusal costs nothing here and the clone does.
    const sources: Attribute[] = [];
    for (const name of attributes) {
      const attr = srcSet.get(name);
      if (!attr) {
        throw new Error(
          `pathShift: param "attributes" names point attribute "${name}", which the \`in\` input does not have; its point attributes are: ${srcSet.names().join(", ") || "(none)"}`,
        );
      }
      sources.push(attr);
    }

    // The reporting slot, checked against the INPUT's set (shape-identical
    // to the clone's) so a refusal still costs nothing.
    if (params.hitAttr !== "") {
      if (reading.has(params.hitAttr)) {
        throw new Error(
          `pathShift: hitAttr "${params.hitAttr}" is also named in "attributes" — the flag is written onto the output's point domain, so it would replace the very column this node reads its values from, and the cook would look fine afterwards. Give hitAttr a distinct name (a "__" prefix marks it internal, e.g. "__hit"), or leave it empty to skip the flag.`,
        );
      }
      if (outNames.includes(params.hitAttr)) {
        throw new Error(
          `pathShift: hitAttr "${params.hitAttr}" is also named in "outNames" — the flag would overwrite the shifted value this node had just written, and the cook would look fine afterwards. Give hitAttr a distinct name (a "__" prefix marks it internal, e.g. "__hit"), or leave it empty to skip the flag.`,
        );
      }
      requireReportSlot({
        attrs: srcSet,
        nodeType: "pathShift",
        param: "hitAttr",
        name: params.hitAttr,
        type: "bool",
        tupleSize: 1,
        domain: "point",
        suggestion: "__hit",
      });
    }

    // cloneGeometry is the only helper that preserves topology, and it is
    // also what keeps this node pure: the input is a cached upstream object
    // and must never be mutated. The source columns above stay the INPUT'S,
    // which the deep copy makes safe: nothing written below can be read back
    // as a source value.
    const geo = cloneGeometry(src);
    const outSet = geo.attrs.point;
    // `polylineWalks`, not `polylineArcTables`: a shift reads no distance,
    // and the full table allocates four Float64Arrays per path and takes a
    // square root per segment to produce numbers this node never touches.
    //
    // NO PATH AT ALL IS NOT A REFUSAL HERE — see the header. Every point is
    // then a point on no polyline, which is a case this node already
    // answers, so it takes the answer it already gives rather than a second
    // one that contradicts it. `hasPolyline` exists only to ask that
    // without provoking `polylineWalks`' throw.
    const walks = polylineWalks(geo, "pathShift", "none");

    // The destination columns, created BEFORE the walk and always through
    // `replace`, which resets a same-shape column it found rather than
    // keeping its values. That reset IS the miss rule: a point with no
    // neighbour is left holding the source attribute's default, and a stale
    // value inherited from an earlier cook would otherwise be indis-
    // tinguishable from a value this shift had written.
    const columns: Shifted[] = [];
    for (let i = 0; i < sources.length; i++) {
      const a = sources[i];
      const dst = outSet.replace(outNames[i], a.type, a.tupleSize, a.defaultValue as AttrDefault);
      columns.push({
        srcData: a.data,
        dstData: dst.data,
        ts: a.tupleSize,
        strings: a.type === "string" ? { table: a.stringTable, dst } : null,
      });
    }

    const n = outSet.count;
    // WHICH POINT EACH POINT READS, settled for the whole cloud before a
    // single value moves. -1 means "no neighbour": a point on no polyline,
    // or one whose position ran off the end under 'miss'.
    //
    // Two passes rather than one, and the reason is the multi-polyline rule.
    // "The LAST polyline in primitive order decides" has to hold for a MISS
    // as well — otherwise a point shared by two paths would keep the answer
    // an EARLIER path found whenever the last one missed, and the rule would
    // quietly become "the last polyline that found something". Recording the
    // decision here lets a later walk overwrite an earlier one with -1,
    // which a copy-as-you-go loop cannot express without undoing work.
    const srcOf = new Int32Array(n).fill(-1);
    let step = 0;
    for (const walk of walks) {
      const pts = walk.points;
      // A closed polyline's last vertex REVISITS its first point; the ring
      // has one entry per POINT, not one per vertex. Counting the repeat
      // would give the first point a second, contradictory source and leave
      // one point unread.
      const m = walk.closed ? pts.length - 1 : pts.length;
      for (let k = 0; k < m; k++) {
        if ((step++ & (CANCEL_STRIDE - 1)) === 0) checkCancelled();
        let r = k + offset;
        if (mode === "wrap") {
          // Euclidean, not JavaScript's truncated remainder: -1 % 5 is -1,
          // which is not a position. The correction runs on the remainder,
          // so it is one branch rather than a loop however far out `r` is.
          r = r % m;
          if (r < 0) r += m;
        } else if (mode === "clamp") {
          if (r < 0) r = 0;
          else if (r >= m) r = m - 1;
        } else if (r < 0 || r >= m) {
          srcOf[pts[k]] = -1;
          continue;
        }
        srcOf[pts[k]] = pts[r];
      }
    }

    const hit = params.hitAttr !== "" ? new Uint8Array(n) : null;
    const nCols = columns.length;
    for (let i = 0; i < n; i++) {
      if ((i & (CANCEL_STRIDE - 1)) === 0) checkCancelled();
      const s = srcOf[i];
      // No neighbour: the destination columns already hold their default
      // from `replace`, so a miss is the absence of a write rather than a
      // write of something.
      if (s < 0) continue;
      for (let c = 0; c < nCols; c++) {
        const column = columns[c];
        const ts = column.ts;
        const so = s * ts;
        const doff = i * ts;
        const strings = column.strings;
        if (strings !== null) {
          // A string column's values are indices into a PER-ATTRIBUTE
          // table, so they are re-interned into the destination's rather
          // than copied as numbers — the two tables are unrelated.
          for (let t = 0; t < ts; t++) {
            strings.dst.setString(i, strings.table[column.srcData[so + t]] ?? "", t);
          }
          continue;
        }
        const dstData = column.dstData;
        const srcData = column.srcData;
        for (let t = 0; t < ts; t++) dstData[doff + t] = srcData[so + t];
      }
      if (hit !== null) hit[i] = 1;
    }

    if (hit !== null) {
      // `replace` resets every element to 0 before the fill, so a column
      // this name already held contributes nothing: the flag describes THIS
      // shift only. An inherited 1 is how a point with no path gets to claim
      // it found a neighbour.
      const flag = outSet.replace(params.hitAttr, "bool", 1);
      flag.data.set(hit.subarray(0, n));
    }
    return { out: [makeGeometryItem(geo)] };
  },
});
