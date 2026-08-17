/**
 * Topology nodes: build EDGES over a point cloud.
 *
 * There is no edge domain in this library and there does not need to be —
 * the primitive domain already is one. A 2-vertex `polyline` over shared
 * points IS an edge: `setPolylineTopology` lets one point appear in many
 * primitives, so a point with degree 5 is expressible today. Per-edge
 * values then come from nodes that already ship: `promoteAttribute`
 * point -> primitive (`min` for a road's width, `first` for its kind),
 * `setAttribute` on `domain: "primitive"`, and the return trip
 * primitive -> point (`max`) for a junction's size.
 *
 * That is also why {@link connectPoints} emits its edges over the SAME
 * input points rather than through a separate edges-to-polylines sink: no
 * edge payload ever crosses a pin, a junction is genuinely the same point
 * on every road that meets there, and the adjacency index is built and
 * consumed inside one node body — the staleness argument in
 * `src/spatial/adjacency.ts` is satisfied structurally rather than
 * defended.
 *
 * Topology is fragile downstream, and the rule is REMOVING POINTS, not the
 * node's category: filterByDensity, filterByBounds, filterByAttribute,
 * filterByExpression, selfPrune, partitionByAttribute and mergePoints all
 * rebuild the point domain and drop topology with it, so a network routed
 * through one arrives as a plain cloud. Only cloneGeometry preserves it,
 * which is what this node uses. Joining two networks is `mergePrimitives`
 * (`pointOps.ts`), the union that renumbers topology instead of discarding
 * it — `mergePoints` is the points-only twin and stays that way.
 *
 * The nodes that CUT a network down without destroying it are
 * `filterPrimitivesByBounds` and `filterPrimitivesByAttribute`
 * (`filtering.ts`), which filter the PRIMITIVE domain instead — the first
 * is what turns the partitioning recipe below from a procedure a caller
 * performs in TypeScript into a graph that serializes, and the second is
 * how a per-edge value this node wrote (`lengthAttr`) thins the network
 * while it is still a network.
 */
import { PRIMTYPE_ATTR, setPolylineTopology } from "../data/index.js";
import { canonicalPointRanks } from "../data/identity.js";
import { cloneGeometry, makeGeometryItem } from "../graph/index.js";
import { adjacencyFor, type Adjacency } from "../spatial/index.js";
import { standardNode } from "./registry.js";
import {
  positionView,
  requireGeometry,
  requireReportSlot,
  requireTuple,
  resolveOn,
  type FieldParam,
} from "./util.js";

/**
 * Ceiling on the edges one {@link connectPoints} may build. The radius is
 * a number the author typed, but the edge count it implies is not: pairs
 * grow with the SQUARE of the point count, so a radius that looks
 * reasonable on a sparse cloud allocates gigabytes on a dense one. Bounded
 * for the same reason and in the same shape as `MAX_RESAMPLE_POINTS` in
 * `paths.ts`, and enforced DURING the neighbour scan, so a runaway fails
 * before it allocates rather than after.
 */
const MAX_EDGES = 1_048_576;

/**
 * Stand-ins for the edge buffers on the paths that build no edges (no
 * points, or radius 0). Never written: the scan replaces them before it
 * emits anything, and every reader is bounded by the edge count, which is
 * 0 here.
 */
const EMPTY_U32 = new Uint32Array(0);
const EMPTY_F64 = new Float64Array(0);

/** How to get under {@link MAX_EDGES}, appended to the overflow message. */
const MAX_EDGES_HINT =
  "Lower `radius` (the pair count grows with radius^2 over a surface and radius^3 through a volume), " +
  "thin the cloud upstream with selfPrune or filterByDensity, or cook the region in cells. " +
  "Switching mode to 'relativeNeighborhood' does NOT help: it keeps far fewer edges, but it " +
  "SELECTS them from the same radius neighbourhood, which is what this limit measures.";

/** Params of {@link connectPoints}. */
export interface ConnectPointsParams {
  mode: string;
  radius: FieldParam;
  degreeAttr: string;
  lengthAttr: string;
}

/** Build an edge network over a point cloud. */
export const connectPoints = standardNode<ConnectPointsParams>({
  type: "connectPoints",
  category: "point op",
  description:
    "Connects a point cloud into a NETWORK: one 2-vertex `polyline` primitive per edge, built over the SAME points that arrived, so every point attribute survives and a junction is genuinely one point shared by every edge that meets there. This is how you get roads between district centres, a trail net between camps, or a triangulated-looking scaffold to displace. There is no edge domain and none is needed — per-edge values come from promoteAttribute point->primitive (`min` for a width, `first` for a kind) and setAttribute on domain 'primitive', and per-junction values from promoteAttribute primitive->point (`max`). mode 'radius' connects every pair closer than `radius`. mode 'relativeNeighborhood' keeps such a pair ONLY when no third point is closer to BOTH of its endpoints than they are to each other (the lune test): that thins a dense blob into a road-like net that still CONTAINS a minimum spanning tree — so the network stays connected wherever the radius does — while leaving the cycles a road layout wants and a tree does not have. Distances are 3D over P and the test is STRICT (d < radius), which is what makes this node's answer independent of how the cloud was windowed: a pair at exactly `radius` is not an edge. Edges come out in a canonical order fixed by the POINTS (identity, then position bits, then seed) and never by the order they arrived in, and each edge's FIRST vertex is its lower-keyed endpoint — reorder the input and you get the same network, permuted. PARTITIONING: an edge reads two stored positions and no third point, so a cell that also holds every point within `radius` of its own rectangle decides its edges exactly; emit an edge from the cell that owns its FIRST vertex under the half-open rule (filterByBounds' 'halfOpen'), and the cells tile the network with no duplicate and no gap. The wiring is three NODES, so a partitioned network cook is a serializable graph and needs no host code: widen the cell's rectangle by `radius` — or, when `radius` is a field, by the GLOBAL MAXIMUM it can return anywhere in the world — and clip the cloud to it with filterByBounds ('halfOpen'), run this node, then run filterPrimitivesByBounds on the UNWIDENED rectangle with vertex 'first' and the same 'halfOpen' boundary — that node keeps the primitives whose FIRST vertex lies back inside the cell, and it is one of the two filters in the library that trim topology instead of dropping it. The relativeNeighborhood witness lies inside the pair's own neighbourhood, so it needs no wider halo. Any existing topology on the input is REPLACED, and its vertex and primitive attributes drop with it. Downstream, any node that can REMOVE points drops topology — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute — and so does mergePoints, so a network that passes through one stops being a network — use mergePrimitives to combine this node's output with another network, an authored path or a mesh, which concatenates points, vertices AND primitives and renumbers the references; category is not the rule, since projectToPlane is categorised `filter` and PRESERVES topology, and so do filterPrimitivesByBounds and filterPrimitivesByAttribute, which filter the PRIMITIVE domain and are the nodes to reach for when a network has to be cut down rather than a cloud — the second tests a primitive attribute, so a network thinned by its own `lengthAttr` (or by a promoted or setAttribute-authored per-edge value) stays a network, and the thinning happens before anything downstream pays for the edges it removes. degreeAttr and lengthAttr are reporting slots whose shape this node picks, so pointing either at an existing attribute of a DIFFERENT shape is refused rather than silently deleting it.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    mode: {
      type: "enum",
      default: "radius",
      enum: ["radius", "relativeNeighborhood"],
      description:
        "Which pairs become edges. 'radius' connects every pair closer than `radius` — dense, and the count grows with the square of the point count. 'relativeNeighborhood' additionally requires that no third point is closer to BOTH endpoints than they are to each other, which keeps a sparse, road-like net (it contains a minimum spanning tree, so it does not disconnect what the radius reached, and it keeps cycles, so it is a network rather than a tree). Both modes read the same radius neighbourhood, so 'relativeNeighborhood' costs at least as much to compute and is bounded by the same edge limit.",
    },
    radius: {
      type: "f32",
      default: 1,
      min: 0,
      acceptsField: true,
      description:
        "Largest distance that can become an edge, in world units, tested STRICTLY: a pair at exactly `radius` is NOT connected. That strictness is deliberate and is what makes a partitioned cook exact — a neighbour lying exactly on a cell's far face is excluded from the cell by the half-open ownership rule, and under a strict test it is not an edge of anything that cell owns either, so the two conventions cannot disagree. 0 builds no edges. As a FIELD it is a PER-POINT REACH, and a pair becomes an edge when it is closer than the LARGER of the two reaches — the same rule selfPrune's minDistance uses, and for the same reason: the SMALLER would let a big point be crowded by a small one, and the SUM would double the spacing of an evenly-sized cloud, so neither agrees with the same number passed plainly. That rule is what keeps the relation SYMMETRIC. Without one a per-point radius makes 'A is near B' and 'B is near A' two different tests and an edge depends on which endpoint asked, which is why a field here needs a stated pair rule and not merely a column. A per-point reach of 0, negative or NaN connects that point to nothing, though a bigger neighbour can still reach IT. TWO COSTS travel with a field, both cost and neither correctness. The candidate scan runs at the WIDEST reach in the cloud, since either endpoint may be the larger, so the edge ceiling is measured on those candidates rather than on the edges that survive. And under a partitioned cook the halo is no longer `radius` but the GLOBAL MAXIMUM this field can return anywhere in the world — a bound to be derived rather than measured, because the cloud a cell sees has already been clipped by the halo being sized. Take a constant times the range of whatever drives it (a noise is in [-1, 1], so `2 + 3 * noise` maxes at 5) and widen by that; underestimating does not throw, it drops the long edges at the seams only.",
    },
    degreeAttr: {
      type: "string",
      default: "",
      description:
        "Name of a u32 point attribute receiving each point's DEGREE — how many emitted edges touch it (0 for an isolated point). Empty (the default) writes none. Use it to size junctions, or to find the dead ends of a network with filterByAttribute. The shape is this node's to pick (u32, tuple 1), so a name the input already holds under a DIFFERENT shape is REFUSED, not overwritten: writing it would delete that column outright and the cook would still look fine (degreeAttr \"P\" would leave a cloud with no positions). A same-shape column IS reused and reset, so re-running this node over its own output is fine.",
    },
    lengthAttr: {
      type: "string",
      default: "",
      description:
        "Name of an f32 PRIMITIVE attribute receiving each edge's length in world units. Empty (the default) writes none. Handy as a width or cost driver, and as a filter key once the network is promoted. The shape is this node's to pick (f32, tuple 1), so a name already present on the output's primitive domain under a different shape is REFUSED — which in practice means `primtype`, the string attribute that marks these primitives as polylines and without which nothing downstream would recognise them. Note that the input's own primitive attributes are dropped by the topology replacement before this is written.",
    },
  },
  execute({ inputs, params, checkCancelled, seed: nodeSeed }) {
    // Params before geometry: a bad mode reported as a geometry problem
    // sends the author to debug the wrong thing entirely.
    const mode = params.mode;
    if (mode !== "radius" && mode !== "relativeNeighborhood") {
      throw new Error(
        `connectPoints: unknown mode "${mode}"; valid modes: radius, relativeNeighborhood`,
      );
    }
    const uniformRadius = typeof params.radius === "number" ? params.radius : undefined;
    if (
      uniformRadius !== undefined &&
      (!(uniformRadius >= 0) || !Number.isFinite(uniformRadius))
    ) {
      throw new Error(
        `connectPoints: radius must be a finite number >= 0, got ${uniformRadius}; 0 builds no edges, and an unbounded radius would connect every pair`,
      );
    }
    const src = requireGeometry(inputs, "in", "connectPoints");
    // Reporting slots are checked before any work: a refusal must cost
    // nothing. degreeAttr lands on the point domain, which survives the
    // clone untouched, so the input's own columns are the ones at risk.
    if (params.degreeAttr !== "") {
      requireReportSlot({
        attrs: src.attrs.point,
        nodeType: "connectPoints",
        param: "degreeAttr",
        name: params.degreeAttr,
        type: "u32",
        tupleSize: 1,
        domain: "point",
        suggestion: "degree",
      });
    }
    // lengthAttr lands on the primitive domain, which this node REBUILDS —
    // so the only column it can collide with is the one the rebuild itself
    // creates. Named here rather than after the build for the same
    // "refusal costs nothing" reason; the general check runs again below,
    // where the primitive set actually exists.
    if (params.lengthAttr === PRIMTYPE_ATTR) {
      throw new Error(
        `connectPoints: lengthAttr "${PRIMTYPE_ATTR}" is the string attribute that marks these primitives as polylines; writing an f32 length there would delete it and leave primitives nothing downstream recognises. Name the length something else (e.g. "edgeLength").`,
      );
    }

    // Read from the INPUT, write into a clone. The input's `P` buffer is
    // the upstream node's cached output, so it survives between cooks and
    // the adjacency cache can actually hit — a clone's buffer is new every
    // time, which would make every lookup a miss. Nothing here writes
    // through `src`, which is what makes reading it safe.
    const n = src.pointCount;
    const view = positionView(src, "connectPoints", "in");
    const pd = view.data;
    const ps = view.stride;
    const wantLength = params.lengthAttr !== "";

    // A FIELD radius is a per-point REACH, and a pair is an edge when it
    // is closer than the LARGER of the two — the rule selfPrune already
    // uses, and for its reason: the smaller would let a big point be
    // crowded by a small one, and the sum would double the spacing of an
    // evenly-sized cloud, so neither agrees with the same number passed
    // plainly. That rule is what makes the relation symmetric again;
    // without one, "A is near B" and "B is near A" are two tests and an
    // edge would depend on which endpoint asked.
    const radii =
      uniformRadius === undefined
        ? requireTuple(
            resolveOn(src, "point", params.radius, nodeSeed, "connectPoints", "radius"),
            [1],
            "connectPoints",
            "radius",
          )
        : undefined;
    // The candidate scan runs at the WIDEST reach, because a pair is
    // decided by the larger of its two radii and either endpoint may be
    // the larger. Cost is what that costs — MAX_EDGES is measured on the
    // candidates — and correctness is not, since every candidate is then
    // tested against its own pair's limit.
    let widest = 0;
    if (radii !== undefined) {
      for (let i = 0; i < n; i++) {
        const v = radii.data[i];
        if (v > widest) widest = v; // 0, negative and NaN reach nothing
      }
    }
    const radius = uniformRadius ?? widest;

    // Built once and used twice: to pick each edge's `A`, and to order the
    // edges. Both must be the SAME order, or the first vertex of an edge
    // would stop agreeing with the key the edges were sorted by. The one
    // thing the order's index fallback can move is which end of a
    // ZERO-LENGTH edge between two indistinguishable points is written
    // first — see `canonicalPointRanks` for why nothing else can.
    const ranks = n > 0 && radius > 0 ? canonicalPointRanks(src, "connectPoints") : undefined;
    // Endpoints and squared lengths of the emitted edges, written through a
    // counter into storage sized up front rather than pushed onto arrays
    // that grow to as many as MAX_EDGES entries. `neighbors.length >>> 1` is
    // the EXACT edge count in 'radius' mode — the relation is symmetric, so
    // each pair occupies two CSR entries and exactly one of the two visits
    // emits it — and a tight ceiling in 'relativeNeighborhood', which keeps
    // a subset of the same pairs.
    let edgeA = EMPTY_U32;
    let edgeB = EMPTY_U32;
    let edgeD2 = EMPTY_F64;
    let count = 0;
    if (ranks !== undefined) {
      const adj = adjacencyFor(view, radius, {
        who: "connectPoints",
        maxEdges: MAX_EDGES,
        hint: MAX_EDGES_HINT,
        checkCancelled,
      });
      const { offsets, neighbors } = adj;
      const cap = neighbors.length >>> 1;
      edgeA = new Uint32Array(cap);
      edgeB = new Uint32Array(cap);
      // Only lengthAttr reads the distances, and it is not the default.
      if (wantLength) edgeD2 = new Float64Array(cap);
      for (let i = 0; i < n; i++) {
        // Polled tighter than the usual 1023: one point costs O(degree)
        // pairs here, and O(degree^2) in relativeNeighborhood.
        if ((i & 63) === 0) checkCancelled();
        const oi = i * ps;
        const ax = pd[oi];
        const ay = pd[oi + 1];
        const az = pd[oi + 2];
        const end = offsets[i + 1];
        for (let k = offsets[i]; k < end; k++) {
          const j = neighbors[k];
          // Each unordered pair is visited from BOTH endpoints (the
          // relation is symmetric); it is emitted once, from the
          // lower-keyed end, which is also the end a partitioned cook
          // assigns ownership by.
          if (ranks[i] > ranks[j]) continue;
          const oj = j * ps;
          const dx = pd[oj] - ax;
          const dy = pd[oj + 1] - ay;
          const dz = pd[oj + 2] - az;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (radii !== undefined) {
            // The candidates came back at the widest reach; this is the
            // test that belongs to THIS pair. Strict, and negated so a
            // NaN limit connects nothing, exactly as the scalar path's
            // membership test in `src/spatial/adjacency.ts` is.
            const ri = radii.data[i];
            const rj = radii.data[j];
            const limit = ri > rj ? ri : rj;
            if (!(d2 < limit * limit)) continue;
          }
          if (mode === "relativeNeighborhood" && hasLuneWitness(adj, pd, ps, i, j, d2)) {
            continue;
          }
          edgeA[count] = i;
          edgeB[count] = j;
          if (wantLength) edgeD2[count] = d2;
          count++;
        }
      }
    }

    // Canonical edge ORDER: by the endpoints' keys, never by the order the
    // scan happened to reach them in. (rank[A], rank[B]) is unique per
    // pair, so this is a strict total order and the primitive index of an
    // edge is a property of the points.
    const order = new Uint32Array(count);
    for (let e = 0; e < count; e++) order[e] = e;
    if (count > 0 && ranks !== undefined) {
      order.sort((a, b) => ranks[edgeA[a]] - ranks[edgeA[b]] || ranks[edgeB[a]] - ranks[edgeB[b]]);
    }

    // cloneGeometry is the only helper that preserves topology, and it is
    // what keeps this node pure: the input is a cached upstream object.
    // Cloned only now, so a refusal above costs nothing.
    const geo = cloneGeometry(src);
    const pointIndices = new Uint32Array(count * 2);
    const primVertexStart = new Uint32Array(count);
    const primVertexCount = new Uint32Array(count);
    // The degree column IS the tally, so nothing stages it first: `replace`
    // zero-fills, it lands on the CLONE and never on `src`, and
    // setPolylineTopology below rebuilds the vertex and primitive domains
    // while leaving point attributes untouched.
    const degrees =
      params.degreeAttr !== ""
        ? geo.attrs.point.replace(params.degreeAttr, "u32", 1, 0).data
        : undefined;
    for (let e = 0; e < count; e++) {
      const s = order[e];
      const a = edgeA[s];
      const b = edgeB[s];
      pointIndices[e * 2] = a;
      pointIndices[e * 2 + 1] = b;
      primVertexStart[e] = e * 2;
      primVertexCount[e] = 2;
      if (degrees) {
        degrees[a]++;
        degrees[b]++;
      }
    }
    setPolylineTopology(geo, pointIndices, primVertexStart, primVertexCount);

    if (wantLength) {
      // The primitive domain exists only now, and holds exactly the
      // primtype column setPolylineTopology just stamped — so this is an
      // OUTPUT-side collision, and the message must not tell an author to
      // remove the attribute "from the input" where it never was.
      //
      // Unreachable today: the only column here is `primtype`, and the
      // guard above catches that name first with a message of its own.
      // Marked anyway, because the guard above is what makes it
      // unreachable, and a later edit that relaxes it would otherwise turn
      // this into a refusal that names the wrong geometry.
      requireReportSlot({
        attrs: geo.attrs.primitive,
        on: "output",
        nodeType: "connectPoints",
        param: "lengthAttr",
        name: params.lengthAttr,
        type: "f32",
        tupleSize: 1,
        domain: "primitive",
        suggestion: "edgeLength",
      });
      const attr = geo.attrs.primitive.replace(params.lengthAttr, "f32", 1, 0);
      const data = attr.data;
      // Straight into the column, in edge order: the same sqrt of the same
      // d2, rounded to f32 once instead of buffered through an f64 array
      // first, so every stored value is bit-identical.
      for (let e = 0; e < count; e++) data[e] = Math.sqrt(edgeD2[order[e]]);
    }
    return { out: [makeGeometryItem(geo)] };
  },
});

/**
 * The relative-neighbourhood (lune) test: is there a third point strictly
 * closer to BOTH `i` and `j` than they are to each other?
 *
 * Every such witness satisfies `d(C, i) < d(i, j) < radius`, so it is
 * necessarily inside `i`'s OWN radius neighbourhood — which is why this
 * mode needs no wider halo than the radius mode, and why the candidate
 * scan can read row `i` of the adjacency rather than a second query.
 *
 * Distances are computed from the two points' stored coordinates with the
 * same expression in every direction — `(a - b)` squares identically to
 * `(b - a)`, and the three squares are always summed x, y, z — so the same
 * triple gives the same verdict whichever endpoint the scan reached first.
 */
function hasLuneWitness(
  adj: Adjacency,
  pd: ArrayLike<number>,
  ps: number,
  i: number,
  j: number,
  d2: number,
): boolean {
  const oi = i * ps;
  const oj = j * ps;
  const ix = pd[oi];
  const iy = pd[oi + 1];
  const iz = pd[oi + 2];
  const jx = pd[oj];
  const jy = pd[oj + 1];
  const jz = pd[oj + 2];
  const end = adj.offsets[i + 1];
  for (let k = adj.offsets[i]; k < end; k++) {
    const c = adj.neighbors[k];
    if (c === j) continue; // rows never contain `i` itself
    const oc = c * ps;
    const cx = pd[oc];
    const cy = pd[oc + 1];
    const cz = pd[oc + 2];
    let dx = cx - ix;
    let dy = cy - iy;
    let dz = cz - iz;
    // Negated so a NaN distance can never witness anything away.
    if (!(dx * dx + dy * dy + dz * dz < d2)) continue;
    dx = cx - jx;
    dy = cy - jy;
    dz = cz - jz;
    if (dx * dx + dy * dy + dz * dz < d2) return true;
  }
  return false;
}
