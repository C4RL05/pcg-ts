/**
 * Neighborhood nodes: per-point statistics over a cloud's own points, and
 * nearest-point lookup against a second cloud.
 *
 * Both are backed by the deterministic uniform grid in `src/spatial`,
 * whose contracts they rely on rather than restate: a query never depends
 * on hash-map iteration order, `queryRadius` returns ascending point
 * indices, `nearest` breaks distance ties toward the lowest index, and a
 * point with a non-finite coordinate can never satisfy a distance
 * predicate (so it is nobody's neighbor and has no neighbors itself).
 *
 * Where those contracts hand back a POINT INDEX to order by,
 * `pointNeighborhood` orders by point IDENTITY instead (position bits
 * plus the `seed` attribute — see `src/data/identity.ts`). Float addition
 * is order-dependent and a cap has to break distance ties somehow, so
 * both are determinism surfaces; keyed on index they are also surfaces
 * that move when the cloud is merely reordered, which nothing upstream is
 * supposed to be able to do. `sampleNearestPoint` still leans on the
 * grid's own lowest-index tie rule: the tie there is between points of a
 * SECOND cloud and lives in `src/spatial`, not here.
 */
import type { AttrDefault, Attribute, Geometry } from "../data/index.js";
import type { Column } from "../fields/index.js";
import { pointIdentities } from "../data/identity.js";
import { cloneGeometry, makeGeometryItem } from "../graph/index.js";
import { UniformGrid, type PositionView } from "../spatial/index.js";
import { standardNode } from "./registry.js";
import {
  positionView,
  requireGeometry,
  requireReportSlot,
  requireTuple,
  resolveOn,
  resolveOnAllowingNonFinite,
  type FieldParam,
} from "./util.js";

/**
 * Cell size for a grid over `view`: roughly two mean point spacings over
 * the occupied axes, the same policy `src/data/transferMapping.ts` uses.
 * Only the SPEED of a query depends on it — `nearest` returns the same
 * point at any cell size — so this never enters the result.
 */
function deriveCellSize(view: PositionView): number {
  const { data, stride, count } = view;
  if (count === 0) return 1;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    const x = data[o];
    const y = data[o + 1];
    const z = data[o + 2];
    // Non-finite coordinates are excluded, exactly as the grid excludes
    // them from its occupied-cell bounds.
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (minX > maxX) return 1; // no finite point
  let volume = 1;
  let axes = 0;
  for (const extent of [maxX - minX, maxY - minY, maxZ - minZ]) {
    if (extent > 0) {
      volume *= extent;
      axes++;
    }
  }
  if (axes === 0) return 1;
  const cell = Math.pow(volume / count, 1 / axes) * 2;
  return Number.isFinite(cell) && cell > 0 ? cell : 1;
}

/**
 * `pointNeighborhood.radius` as one number per point.
 *
 * Deliberately NOT guarded against non-finite values (see
 * `resolveOnAllowingNonFinite`): a NaN radius reaches nothing, exactly as
 * 0 does, and an infinite one reaches the whole cloud. Both are stated in
 * the param description and pinned by tests, so rejecting them here would
 * contradict the documented behaviour rather than protect anything.
 */
function neighborhoodRadiusColumn(geo: Geometry, value: FieldParam, seed: number): Column {
  const col = resolveOnAllowingNonFinite(geo, "point", value, seed);
  if (col.tupleSize !== 1) {
    throw new Error(
      `pointNeighborhood: param "radius" must evaluate to ONE number per point (tupleSize 1), got tupleSize ${col.tupleSize} — a radius is a single number, and fields broadcast elementwise, so a vec3 such as attribute("scale") yields three numbers per point. Reduce it to a scalar first, e.g. component(attribute("scale"), 0).`,
    );
  }
  return col;
}

/** Params of {@link pointNeighborhood}. */
export interface PointNeighborhoodParams {
  radius: FieldParam;
  maxCount: number;
  includeSelf: boolean;
  countAttr: string;
  averageAttr: string;
  averageOutAttr: string;
}

/** Per-point neighbor count and neighbor attribute average. */
export const pointNeighborhood = standardNode<PointNeighborhoodParams>({
  type: "pointNeighborhood",
  category: "attribute",
  description:
    "Measures each point's neighborhood inside the same cloud and writes the result as point attributes: countAttr receives how many other points lie within radius (u32), and averageAttr/averageOutAttr average a numeric point attribute over those neighbors (f32, same tuple size — averaging \"P\" gives each point the centroid of its neighbors, which is one Lloyd relaxation step away from even spacing). Distances are 3D over P and boundary-inclusive. A point with no neighbors gets count 0 and keeps its OWN value as the average, so a displacement built from the average is zero for isolated points instead of undefined. Points with a non-finite coordinate are nobody's neighbor and have none themselves. Both places where this node has to pick an order — which neighbors a maxCount cap keeps, and the order their values are summed — are keyed on point IDENTITY (position bits plus the `seed` point attribute), never on the array index, so reordering the input cannot move a count, a kept set, or a single bit of an average. Uses a uniform spatial grid, so it stays fast well beyond a few thousand points. Output is the input with the new attributes added; nothing is moved or removed — countAttr and averageOutAttr are reporting slots whose shape this node picks, so pointing either at an existing attribute of a DIFFERENT shape is refused rather than silently deleting it (a same-shape column is reused and reset).",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    radius: {
      type: "f32",
      default: 1,
      min: 0,
      acceptsField: true,
      description:
        "Neighborhood radius in world units, boundary included. 0 searches nothing: every count is 0 and every average falls back to the point's own value, and a radius that is negative or NaN is read the same way. As a FIELD it is a PER-POINT radius, evaluated on the input's points, so each point measures the neighborhood it asks for — a count of what is within reach of THIS point rather than within one distance shared by the cloud. The reading it enables is 'how crowded am I, at my own scale': a radius read from an attribute lets a big point survey a big neighborhood and a small one a small neighborhood in the same cook. NEIGHBORHOOD IS THEN NOT SYMMETRIC, and that is the point rather than a defect — with a per-point radius, B lying inside A's radius does NOT put A inside B's, so `countAttr` counts what each point can see and two points can disagree about whether they are neighbors. That asymmetry is exactly what a per-point radius means, and it is why this param can be a field where connectPoints' radius cannot: an EDGE is one thing shared by two points and would have to depend on which endpoint asked, while a count is one point's own measurement. Cost, not correctness, is what a mixed set of radii affects: the grid is sized from the largest FINITE radius, and a query wider than that scans more cells rather than returning a different answer. An infinite radius is legal and means the whole cloud — the query falls back to a full scan, so it is O(n) per point. Under a partitioned cook the halo a cell needs is the GLOBAL MAXIMUM this field can return anywhere in the world, which is a bound to be derived and not measured: the cloud a cell sees has already been clipped by the halo being sized, so the far neighbor that would have set it is the one it cannot see. Take a constant times the range of whatever drives it (a noise field is in [-1, 1], so `2 + 3 * noise` maxes at 5) and pass that. Underestimating does not throw — it silently misses neighbors, at the seams only.",
    },
    maxCount: {
      type: "i32",
      default: 0,
      min: 0,
      description:
        "Cap on how many neighbors each point keeps: the nearest maxCount of them, distance ties resolved toward the lower point IDENTITY (a hash of the neighbor's position bits and its `seed` attribute) so the kept set is a property of the points and not of the order they arrived in. 0 (the default) keeps every neighbor within the radius. Use it to bound the cost in dense clouds.",
    },
    includeSelf: {
      type: "bool",
      default: false,
      description:
        "Count the point itself as one of its neighbors (and include its own value in the average). False (the default) measures the OTHER points, so an isolated point counts 0.",
    },
    countAttr: {
      type: "string",
      default: "nbrCount",
      description:
        "Name of the u32 point attribute receiving the neighbor count. Empty writes no count (then averageAttr must be set). The shape is this node's to pick (u32, tuple 1), so a name the input already holds under a DIFFERENT shape is REFUSED, not overwritten: writing it would delete that column outright and the cook would still look fine (countAttr \"P\" would leave a point cloud with no positions). An existing u32 tuple-1 column of the same name IS reused and reset, so re-running this node over its own output is fine. To write over something of another shape, removeAttribute it first, or pick another name.",
    },
    averageAttr: {
      type: "string",
      default: "",
      description:
        "Numeric point attribute (tuple 1..4) to average over each point's neighbors, for example \"P\". Empty (the default) computes no average.",
    },
    averageOutAttr: {
      type: "string",
      default: "nbrAvg",
      description:
        "Name of the f32 point attribute receiving the neighbor average; it takes averageAttr's tuple size. Required when averageAttr is set, ignored otherwise. Naming it the same as averageAttr overwrites in place — allowed whenever that attribute is ALREADY f32 at the same tuple size, which \"P\" is. Otherwise the shape is this node's to pick, and a name the input holds under a DIFFERENT shape is REFUSED rather than deleted and re-added: averaging an i32, u32 or bool attribute needs an output name of its own, since the average is always f32. An existing column of the matching f32 shape IS reused and reset.",
    },
  },
  execute({ inputs, params, checkCancelled, seed: nodeSeed }) {
    const geo = cloneGeometry(requireGeometry(inputs, "in", "pointNeighborhood"));
    const wantCount = params.countAttr !== "";
    const wantAverage = params.averageAttr !== "";
    if (!wantCount && !wantAverage) {
      throw new Error(
        'pointNeighborhood: nothing to write — set countAttr (the neighbor count) or averageAttr (the attribute to average), or both; both are currently empty',
      );
    }
    if (wantAverage && params.averageOutAttr === "") {
      throw new Error(
        `pointNeighborhood: averageAttr is "${params.averageAttr}" but averageOutAttr is empty; name the point attribute the average should be written to`,
      );
    }
    const n = geo.pointCount;
    const set = geo.attrs.point;
    // Checked before any work: a refusal must cost nothing, and neither
    // slot's shape depends on anything read below (averageOutAttr's tuple
    // size does, so its check waits for `ts`).
    if (wantCount) {
      requireReportSlot({
        attrs: set,
        nodeType: "pointNeighborhood",
        param: "countAttr",
        name: params.countAttr,
        type: "u32",
        tupleSize: 1,
        domain: "point",
        suggestion: "nbrCount",
      });
    }
    const view = positionView(geo, "pointNeighborhood", "in");

    let source: Attribute | undefined;
    let ts = 0;
    if (wantAverage) {
      const attr = set.get(params.averageAttr);
      if (!attr) {
        throw new Error(
          `pointNeighborhood: point attribute "${params.averageAttr}" not found; available: ${set.names().join(", ") || "(none)"}`,
        );
      }
      if (attr.type === "string") {
        throw new Error(
          `pointNeighborhood: attribute "${params.averageAttr}" is a string attribute and cannot be averaged; average a numeric attribute (f32/i32/u32/bool)`,
        );
      }
      if (attr.tupleSize > 4) {
        throw new Error(
          `pointNeighborhood: attribute "${params.averageAttr}" has tupleSize ${attr.tupleSize}; averaging supports tuple sizes 1 to 4`,
        );
      }
      source = attr;
      ts = attr.tupleSize;
      // Same shape as averageAttr passes, which is what keeps averaging an
      // f32 attribute into its own name an in-place overwrite; an i32 or
      // bool source needs a distinct output name, because the average is
      // always f32.
      requireReportSlot({
        attrs: set,
        nodeType: "pointNeighborhood",
        param: "averageOutAttr",
        name: params.averageOutAttr,
        type: "f32",
        tupleSize: ts,
        domain: "point",
        suggestion: "nbrAvg",
      });
    }

    const counts = wantCount ? new Uint32Array(n) : undefined;
    const means = source ? new Float64Array(n * ts) : undefined;
    const maxCount = params.maxCount;

    // A plain number keeps the scalar path exactly as it was; a field
    // resolves to one radius per point. Non-finite values are deliberately
    // NOT rejected here (see resolveOnAllowingNonFinite): NaN reads as
    // "search nothing", the same as 0, and Infinity reads as "the whole
    // cloud" — both stated in the param description and pinned by tests.
    const uniformRadius = typeof params.radius === "number" ? params.radius : undefined;
    const radii =
      uniformRadius === undefined
        ? neighborhoodRadiusColumn(geo, params.radius, nodeSeed)
        : undefined;

    // The cell size, and whether there is anything to do at all. For a
    // field both answers need the resolved column: a cloud whose radii are
    // all <= 0 has no work in it, and one with mixed radii has no single
    // query width to size cells by.
    let cellSize = 0;
    let anyReach = false;
    if (radii === undefined) {
      cellSize = uniformRadius as number;
      anyReach = cellSize > 0;
    } else {
      let widest = 0;
      for (let i = 0; i < n; i++) {
        const v = radii.data[i];
        if (!(v > 0)) continue; // 0, negative and NaN all reach nothing
        anyReach = true;
        if (v > widest && v < Number.POSITIVE_INFINITY) widest = v;
      }
      // Cell size never decides an answer, only how many cells a query
      // touches — the distance tests are exact whatever it is. The largest
      // FINITE radius makes the usual case (radii within a small factor of
      // each other) a 3x3x3 block; an all-infinite set has no informative
      // size, so 1 stands in and every query full-scans anyway.
      cellSize = widest > 0 ? widest : 1;
    }

    if (anyReach && n > 0) {
      // One cell per query radius, so the candidates for a point are the
      // 3x3x3 block around its cell — the policy selfPrune uses.
      const grid = UniformGrid.build(view, cellSize);
      const pd = view.data;
      const ps = view.stride;
      const src = source?.data;
      // Scratch reused across every point: the hot loop allocates nothing.
      const nbr: number[] = [];
      const d2 = maxCount > 0 ? new Float64Array(n) : undefined;
      // Point IDENTITY (position bits + the `seed` attribute) replaces the
      // point index in BOTH orderings below — which neighbours a cap keeps,
      // and the order their values are added up. Index is a name the array
      // gives a point, not a name the point has: reorder the cloud and a
      // cap keeps a different set and a sum lands on different bits. Only
      // built when one of those orderings actually runs; a count-only cook
      // does not care what order it counted in.
      const ident =
        maxCount > 0 || means !== undefined ? pointIdentities(geo, "pointNeighborhood") : undefined;
      const byIdentity =
        ident === undefined ? undefined : (a: number, b: number) => ident[a] - ident[b] || a - b;
      for (let i = 0; i < n; i++) {
        if ((i & 1023) === 0) checkCancelled();
        const o = i * ps;
        const x = pd[o];
        const y = pd[o + 1];
        const z = pd[o + 2];
        // A point whose own radius reaches nothing skips the query rather
        // than running one at 0: `queryRadius` is boundary-INCLUSIVE, so a
        // radius of 0 would still collect anything exactly coincident,
        // and "0 searches nothing" has to mean the same thing whether it
        // arrived as the plain param or as one value of a field.
        const reach = radii === undefined ? (uniformRadius as number) : radii.data[i];
        if (!(reach > 0)) {
          nbr.length = 0;
        } else {
          grid.queryRadius(x, y, z, reach, nbr);
          // An INFINITE reach is the one case where the grid's "a
          // non-finite coordinate satisfies no distance predicate" stops
          // holding: the test is `d2 <= limit`, and at limit = Infinity a
          // point at +Infinity passes it, because `Infinity <= Infinity`.
          // That would make a non-finite point everybody's neighbour and
          // poison a finite point's average, contradicting this node's own
          // documented contract — and it would make the ANSWER depend on
          // cell size, which nothing else here does. Restored at the only
          // radius that can break it, so the ordinary path pays nothing.
          if (reach === Number.POSITIVE_INFINITY) {
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
              nbr.length = 0;
            } else {
              let w = 0;
              for (let r = 0; r < nbr.length; r++) {
                const oj = nbr[r] * ps;
                if (
                  Number.isFinite(pd[oj]) &&
                  Number.isFinite(pd[oj + 1]) &&
                  Number.isFinite(pd[oj + 2])
                ) {
                  nbr[w++] = nbr[r];
                }
              }
              nbr.length = w;
            }
          }
        }
        if (!params.includeSelf) {
          // Compact in place rather than splice: no per-point allocation.
          let w = 0;
          for (let r = 0; r < nbr.length; r++) {
            if (nbr[r] !== i) nbr[w++] = nbr[r];
          }
          nbr.length = w;
        }
        if (d2 !== undefined && ident !== undefined && nbr.length > maxCount) {
          for (let r = 0; r < nbr.length; r++) {
            const j = nbr[r];
            const oj = j * ps;
            const dx = pd[oj] - x;
            const dy = pd[oj + 1] - y;
            const dz = pd[oj + 2] - z;
            d2[j] = dx * dx + dy * dy + dz * dz;
          }
          nbr.sort((a, b) => d2[a] - d2[b] || ident[a] - ident[b] || a - b);
          nbr.length = maxCount;
        }
        // Accumulate in identity order, capped or not. Float addition is
        // order-dependent, so the average has to be summed in an order the
        // POINTS fix — otherwise the same neighbourhood lands on different
        // bits depending on which slots its members happen to occupy, and
        // whether the cap bound.
        if (byIdentity !== undefined && means !== undefined) nbr.sort(byIdentity);
        const k = nbr.length;
        if (counts) counts[i] = k;
        if (means && src) {
          const mo = i * ts;
          if (k === 0) {
            // No neighbors: the point's own value, so a displacement built
            // from (own - average) is exactly zero.
            const so = i * ts;
            for (let c = 0; c < ts; c++) means[mo + c] = src[so + c];
          } else {
            for (let r = 0; r < k; r++) {
              const so = nbr[r] * ts;
              for (let c = 0; c < ts; c++) means[mo + c] += src[so + c];
            }
            for (let c = 0; c < ts; c++) means[mo + c] /= k;
          }
        }
      }
    } else if (means && source) {
      // Radius 0 (or an empty cloud): every neighborhood is empty, so every
      // average is the point's own value.
      const src = source.data;
      for (let i = 0; i < n * ts; i++) means[i] = src[i];
    }

    // Written only after every read: the target may be the very attribute
    // that was averaged (or even "P"), and replace() reuses storage.
    if (counts) {
      const attr = set.replace(params.countAttr, "u32", 1, 0);
      const data = attr.data;
      for (let i = 0; i < n; i++) data[i] = counts[i];
    }
    if (means) {
      const attr = set.replace(params.averageOutAttr, "f32", ts, 0);
      const data = attr.data;
      for (let i = 0; i < n * ts; i++) data[i] = means[i];
    }
    return { out: [makeGeometryItem(geo)] };
  },
});

/** Params of {@link sampleNearestPoint}. */
export interface SampleNearestPointParams {
  distanceAttr: string;
  indexAttr: string;
  attribute: string;
  outAttribute: string;
  maxDistance: FieldParam;
}

/** Nearest point of a second cloud: its distance, index, and attributes. */
export const sampleNearestPoint = standardNode<SampleNearestPointParams>({
  type: "sampleNearestPoint",
  category: "attribute",
  description:
    "For every point of `in`, finds the nearest point of the `source` cloud in 3D (positions from P, ties resolved toward the lowest source index) and records what it found on the output's point domain: distanceAttr gets the distance (f32), indexAttr the source point index (i32), and `attribute`/`outAttribute` copy one of the source's point attributes across. This is the node that answers HOW FAR — transferAttribute's 'nearest' mapping copies a value but never reveals the distance, so banding by proximity to a road, a river or a set of landmarks needs this one. A point that finds nothing (an empty source, a non-finite position, or nothing within maxDistance) is a miss: its distance is Infinity, its index is -1, and a copied attribute keeps its prior value (the attribute default when it did not exist), so a miss is testable per point rather than only as a total. distanceAttr and indexAttr are reporting slots whose shape this node picks, so pointing either at an existing attribute of a DIFFERENT shape is refused rather than silently deleting it (a same-shape column is reused and reset); `outAttribute` is exempt, since a copy takes its shape from the source. Uses a uniform spatial grid, so large clouds are fine.",
  inputs: [
    { name: "in", kind: "geometry" },
    { name: "source", kind: "geometry" },
  ],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    distanceAttr: {
      type: "string",
      default: "nearDist",
      description:
        "Name of the f32 point attribute receiving the distance to the nearest source point, in world units (Infinity on a miss). Empty writes no distance. The shape is this node's to pick (f32, tuple 1), so a name the input already holds under a DIFFERENT shape is REFUSED, not overwritten — writing it would delete that column and the cook would still look fine. A same-shape column IS reused and reset; to write over another shape, removeAttribute it first or pick another name.",
    },
    indexAttr: {
      type: "string",
      default: "",
      description:
        "Name of the i32 point attribute receiving the nearest source point's index, or -1 on a miss. Empty (the default) writes no index. Same rule as distanceAttr: the shape is this node's to pick (i32, tuple 1), so a name the input holds under a DIFFERENT shape is REFUSED rather than deleted and re-added, while a same-shape column is reused and reset. `attribute`/`outAttribute` are exempt — a copy takes its shape from the source and overwriting is the point.",
    },
    attribute: {
      type: "string",
      default: "",
      description:
        "Point attribute of the `source` geometry to copy from the nearest source point. Empty (the default) copies nothing. Any type, including string.",
    },
    outAttribute: {
      type: "string",
      default: "",
      description:
        "Name to store the copied attribute under on the output. Empty (the default) reuses `attribute`'s own name. Ignored when `attribute` is empty.",
    },
    maxDistance: {
      type: "f32",
      default: 0,
      min: 0,
      acceptsField: true,
      description:
        "Largest distance that still counts as a find, in world units. 0 (the default) means unlimited; beyond it a point is a miss. As a FIELD it is PER POINT, evaluated on the points being sampled rather than on the source, so each point can accept a find at its own reach — a small prop giving up on a far road while a large one still finds it, in one cook. The unlimited sentinel is per point too, and it is 0 OR LESS: a field returning 0 — or a negative, which a subtraction easily produces — makes THOSE points unlimited rather than making them miss. So 'find nothing' is a small POSITIVE distance, never 0 and never a negative one, which would do the opposite of what it looks like. This param does not size the spatial index — cell size comes from the source cloud — so a mixed set of reaches costs nothing extra and changes no answer.",
    },
  },
  execute({ inputs, params, checkCancelled, seed: nodeSeed }) {
    const dst = cloneGeometry(requireGeometry(inputs, "in", "sampleNearestPoint"));
    const src = requireGeometry(inputs, "source", "sampleNearestPoint");
    const wantDistance = params.distanceAttr !== "";
    const wantIndex = params.indexAttr !== "";
    const wantCopy = params.attribute !== "";
    if (!wantDistance && !wantIndex && !wantCopy) {
      throw new Error(
        'sampleNearestPoint: nothing to write — set distanceAttr, indexAttr, or `attribute` (the source attribute to copy); all three are currently empty',
      );
    }
    // Before any query: a refusal must cost nothing. `outAttribute` is not
    // checked — see requireReportSlot for why a copy target is exempt.
    if (wantDistance) {
      requireReportSlot({
        attrs: dst.attrs.point,
        nodeType: "sampleNearestPoint",
        param: "distanceAttr",
        name: params.distanceAttr,
        type: "f32",
        tupleSize: 1,
        domain: "point",
        suggestion: "nearDist",
      });
    }
    if (wantIndex) {
      requireReportSlot({
        attrs: dst.attrs.point,
        nodeType: "sampleNearestPoint",
        param: "indexAttr",
        name: params.indexAttr,
        type: "i32",
        tupleSize: 1,
        domain: "point",
        suggestion: "nearIndex",
      });
    }
    const n = dst.pointCount;
    const dstView = positionView(dst, "sampleNearestPoint", "in");
    const srcView = positionView(src, "sampleNearestPoint", "source");

    let sourceAttr: Attribute | undefined;
    if (wantCopy) {
      const attr = src.attrs.point.get(params.attribute);
      if (!attr) {
        throw new Error(
          `sampleNearestPoint: point attribute "${params.attribute}" not found on the source geometry; available: ${src.attrs.point.names().join(", ") || "(none)"}`,
        );
      }
      sourceAttr = attr;
    }

    // Nearest indices first, attributes after: a written attribute may
    // share storage with one that is still being read.
    const found = new Int32Array(n);
    const distances = wantDistance ? new Float64Array(n) : undefined;
    const grid = UniformGrid.build(srcView, deriveCellSize(srcView));
    // 0 means unlimited, per point as well as plainly: a field returning
    // 0 somewhere makes THOSE points unlimited rather than making them
    // miss. Resolved on `dst`, the cloud being sampled, because the
    // reach belongs to the point doing the asking and not to the source.
    const uniformMax = typeof params.maxDistance === "number" ? params.maxDistance : undefined;
    const reaches =
      uniformMax === undefined
        ? requireTuple(
            resolveOn(dst, "point", params.maxDistance, nodeSeed, "sampleNearestPoint", "maxDistance"),
            [1],
            "sampleNearestPoint",
            "maxDistance",
          )
        : undefined;
    const maxRadius =
      uniformMax !== undefined && uniformMax > 0 ? uniformMax : Number.POSITIVE_INFINITY;
    const pd = dstView.data;
    const ps = dstView.stride;
    const sd = srcView.data;
    const ss = srcView.stride;
    for (let i = 0; i < n; i++) {
      if ((i & 1023) === 0) checkCancelled();
      const o = i * ps;
      const x = pd[o];
      const y = pd[o + 1];
      const z = pd[o + 2];
      const reach =
        reaches === undefined
          ? maxRadius
          : reaches.data[i] > 0
            ? reaches.data[i]
            : Number.POSITIVE_INFINITY;
      const j = grid.nearest(x, y, z, reach);
      found[i] = j;
      if (distances) {
        if (j < 0) {
          distances[i] = Number.POSITIVE_INFINITY;
        } else {
          const oj = j * ss;
          const dx = sd[oj] - x;
          const dy = sd[oj + 1] - y;
          const dz = sd[oj + 2] - z;
          distances[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
      }
    }

    const set = dst.attrs.point;
    if (distances) {
      const attr = set.replace(params.distanceAttr, "f32", 1, 0);
      const data = attr.data;
      for (let i = 0; i < n; i++) data[i] = distances[i];
    }
    if (wantIndex) {
      const attr = set.replace(params.indexAttr, "i32", 1, -1);
      const data = attr.data;
      for (let i = 0; i < n; i++) data[i] = found[i];
    }
    if (sourceAttr) {
      const name = params.outAttribute !== "" ? params.outAttribute : params.attribute;
      // Misses keep the prior value, so a matching column is kept as it is
      // rather than reset; a mismatched one is rebuilt from the source's
      // own shape and default.
      const existing = set.get(name);
      let target = existing;
      if (
        target === undefined ||
        target.type !== sourceAttr.type ||
        target.tupleSize !== sourceAttr.tupleSize
      ) {
        if (existing) set.remove(name);
        target = set.add(
          name,
          sourceAttr.type,
          sourceAttr.tupleSize,
          sourceAttr.defaultValue as AttrDefault,
        );
      }
      // copyFrom re-interns string values into the target's own table, so
      // one path covers every attribute type.
      for (let i = 0; i < n; i++) {
        const j = found[i];
        if (j < 0) continue;
        target.copyFrom(sourceAttr, j, i, 1);
      }
    }
    return { out: [makeGeometryItem(dst)] };
  },
});
