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
 * which is what this node uses.
 *
 * The one node that CUTS a network down without destroying it is
 * `filterPrimitivesByBounds` (`filtering.ts`), which filters the PRIMITIVE
 * domain instead — it is what turns the partitioning recipe below from a
 * procedure a caller performs in TypeScript into a graph that serializes.
 */
import {
  PRIMTYPE_ATTR,
  setPolylineTopology,
  type Geometry,
} from "../data/index.js";
import { f32Bits, pointIdentities } from "../data/identity.js";
import { cloneGeometry, makeGeometryItem } from "../graph/index.js";
import { adjacencyFor, type Adjacency, type PositionView } from "../spatial/index.js";
import { standardNode } from "./registry.js";
import { requireGeometry, requireReportSlot } from "./util.js";

/**
 * The `P` attribute as a {@link PositionView}, with the failures a spatial
 * query would otherwise hit deep inside the index reported here instead,
 * naming the node the author has to fix.
 *
 * Deliberate near-duplicate of the helper in `neighborhood.ts`: lifting it
 * into `util.ts` is the right home and is a separate, mechanical edit
 * across two node files.
 */
function positionView(geo: Geometry, nodeType: string, pin: string): PositionView {
  const P = geo.attrs.point.get("P");
  if (!P) {
    throw new Error(
      `${nodeType}: input "${pin}" has no point attribute "P"; every point cloud in this library carries one — available: ${geo.attrs.point.names().join(", ") || "(none)"}`,
    );
  }
  if (P.type === "string") {
    throw new Error(
      `${nodeType}: input "${pin}" has a string attribute "P"; positions must be numeric (f32, tupleSize 3)`,
    );
  }
  if (P.tupleSize < 3) {
    throw new Error(
      `${nodeType}: input "${pin}" has point attribute "P" with tupleSize ${P.tupleSize}, but distances need x, y and z (tupleSize 3); something upstream overwrote P with a narrower attribute`,
    );
  }
  return { data: P.data, stride: P.tupleSize, count: geo.pointCount };
}

/**
 * CANONICAL POINT ORDER: rank `r[i]` is point `i`'s position in an order
 * fixed by the POINTS, not by the array they arrived in. It answers the
 * two questions an edge set cannot leave to arrival order — which endpoint
 * is the edge's `A`, and what order the edges come out in.
 *
 * The key is identity (`hashCombine` of the position bits and the `seed`
 * attribute), then the raw position bits per axis, then `seed`, then — only
 * for two points that agree on ALL of that — the array index.
 *
 * `comparePruneOrder` in `filtering.ts` is deliberately NOT reused. Its
 * fallback to the index is reached on any 32-bit identity COLLISION, and a
 * collision is independent of position: two windows that hold a colliding
 * pair at different array indices would disagree about which of them is
 * `A`, and the edge would be emitted twice or not at all across the seam.
 * Adding the position bits and `seed` after the hash removes that: the
 * order is now total except between points that are byte-identical in
 * position AND seed, which this library already treats as the SAME point
 * (see `src/data/identity.ts`). Such a pair is necessarily coincident, so
 * one window owns both and the index fallback cannot straddle a seam. The
 * only thing it can move is which end of a ZERO-LENGTH edge between two
 * indistinguishable points is written first.
 */
function canonicalRanks(geo: Geometry, view: PositionView, who: string): Uint32Array {
  const n = view.count;
  const ident = pointIdentities(geo, who);
  const bx = new Uint32Array(n);
  const by = new Uint32Array(n);
  const bz = new Uint32Array(n);
  const pd = view.data;
  const ps = view.stride;
  for (let i = 0; i < n; i++) {
    const o = i * ps;
    bx[i] = f32Bits(pd[o]);
    by[i] = f32Bits(pd[o + 1]);
    bz[i] = f32Bits(pd[o + 2]);
  }
  const seedAttr = geo.attrs.point.get("seed");
  // A missing seed column contributes 0 for every point, exactly as it
  // does inside pointIdentities: no seeds and all-zero seeds are the same
  // cloud, and both rest their order on position.
  const sd = seedAttr && seedAttr.type !== "string" ? seedAttr.data : undefined;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort(
    (a, b) =>
      ident[a] - ident[b] ||
      bx[a] - bx[b] ||
      by[a] - by[b] ||
      bz[a] - bz[b] ||
      (sd === undefined ? 0 : (sd[a] >>> 0) - (sd[b] >>> 0)) ||
      a - b,
  );
  const rank = new Uint32Array(n);
  for (let k = 0; k < n; k++) rank[order[k]] = k;
  return rank;
}

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

/** How to get under {@link MAX_EDGES}, appended to the overflow message. */
const MAX_EDGES_HINT =
  "Lower `radius` (the pair count grows with radius^2 over a surface and radius^3 through a volume), " +
  "thin the cloud upstream with selfPrune or filterByDensity, or cook the region in cells. " +
  "Switching mode to 'relativeNeighborhood' does NOT help: it keeps far fewer edges, but it " +
  "SELECTS them from the same radius neighbourhood, which is what this limit measures.";

/** Params of {@link connectPoints}. */
export interface ConnectPointsParams {
  mode: string;
  radius: number;
  degreeAttr: string;
  lengthAttr: string;
}

/** Build an edge network over a point cloud. */
export const connectPoints = standardNode<ConnectPointsParams>({
  type: "connectPoints",
  category: "point op",
  description:
    "Connects a point cloud into a NETWORK: one 2-vertex `polyline` primitive per edge, built over the SAME points that arrived, so every point attribute survives and a junction is genuinely one point shared by every edge that meets there. This is how you get roads between district centres, a trail net between camps, or a triangulated-looking scaffold to displace. There is no edge domain and none is needed — per-edge values come from promoteAttribute point->primitive (`min` for a width, `first` for a kind) and setAttribute on domain 'primitive', and per-junction values from promoteAttribute primitive->point (`max`). mode 'radius' connects every pair closer than `radius`. mode 'relativeNeighborhood' keeps such a pair ONLY when no third point is closer to BOTH of its endpoints than they are to each other (the lune test): that thins a dense blob into a road-like net that still CONTAINS a minimum spanning tree — so the network stays connected wherever the radius does — while leaving the cycles a road layout wants and a tree does not have. Distances are 3D over P and the test is STRICT (d < radius), which is what makes this node's answer independent of how the cloud was windowed: a pair at exactly `radius` is not an edge. Edges come out in a canonical order fixed by the POINTS (identity, then position bits, then seed) and never by the order they arrived in, and each edge's FIRST vertex is its lower-keyed endpoint — reorder the input and you get the same network, permuted. PARTITIONING: an edge reads two stored positions and no third point, so a cell that also holds every point within `radius` of its own rectangle decides its edges exactly; emit an edge from the cell that owns its FIRST vertex under the half-open rule (filterByBounds' 'halfOpen'), and the cells tile the network with no duplicate and no gap. The wiring is three NODES, so a partitioned network cook is a serializable graph and needs no host code: widen the cell's rectangle by `radius` and clip the cloud to it with filterByBounds ('halfOpen'), run this node, then run filterPrimitivesByBounds on the UNWIDENED rectangle with vertex 'first' and the same 'halfOpen' boundary — that node keeps the primitives whose FIRST vertex lies back inside the cell, and it is the one filter in the library that trims topology instead of dropping it. The relativeNeighborhood witness lies inside the pair's own neighbourhood, so it needs no wider halo. Any existing topology on the input is REPLACED, and its vertex and primitive attributes drop with it. Downstream, any node that can REMOVE points drops topology — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute — and so does mergePoints, so a network that passes through one stops being a network; category is not the rule, since projectToPlane is categorised `filter` and PRESERVES topology, and so does filterPrimitivesByBounds, which filters the PRIMITIVE domain and is the node to reach for when a network has to be cut down rather than a cloud. degreeAttr and lengthAttr are reporting slots whose shape this node picks, so pointing either at an existing attribute of a DIFFERENT shape is refused rather than silently deleting it.",
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
      description:
        "Largest distance that can become an edge, in world units, tested STRICTLY: a pair at exactly `radius` is NOT connected. That strictness is deliberate and is what makes a partitioned cook exact — a neighbour lying exactly on a cell's far face is excluded from the cell by the half-open ownership rule, and under a strict test it is not an edge of anything that cell owns either, so the two conventions cannot disagree. 0 builds no edges. This is a plain number and not a field on purpose: a per-point radius would make 'A is near B' disagree with 'B is near A', and an edge would then depend on which endpoint asked.",
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
  execute({ inputs, params, checkCancelled }) {
    // Params before geometry: a bad mode reported as a geometry problem
    // sends the author to debug the wrong thing entirely.
    const mode = params.mode;
    if (mode !== "radius" && mode !== "relativeNeighborhood") {
      throw new Error(
        `connectPoints: unknown mode "${mode}"; valid modes: radius, relativeNeighborhood`,
      );
    }
    const radius = params.radius;
    if (!(radius >= 0) || !Number.isFinite(radius)) {
      throw new Error(
        `connectPoints: radius must be a finite number >= 0, got ${radius}; 0 builds no edges, and an unbounded radius would connect every pair`,
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

    const edgeA: number[] = [];
    const edgeB: number[] = [];
    const edgeD2: number[] = [];
    // Built once and used twice: to pick each edge's `A`, and to order the
    // edges. Both must be the SAME order, or the first vertex of an edge
    // would stop agreeing with the key the edges were sorted by.
    let ranks: Uint32Array | undefined;
    if (n > 0 && radius > 0) {
      const rank = (ranks = canonicalRanks(src, view, "connectPoints"));
      const adj = adjacencyFor(view, radius, {
        who: "connectPoints",
        maxEdges: MAX_EDGES,
        hint: MAX_EDGES_HINT,
        checkCancelled,
      });
      const { offsets, neighbors } = adj;
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
          if (rank[i] > rank[j]) continue;
          const oj = j * ps;
          const dx = pd[oj] - ax;
          const dy = pd[oj + 1] - ay;
          const dz = pd[oj + 2] - az;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (mode === "relativeNeighborhood" && hasLuneWitness(adj, pd, ps, i, j, d2)) {
            continue;
          }
          edgeA.push(i);
          edgeB.push(j);
          edgeD2.push(d2);
        }
      }
    }

    // Canonical edge ORDER: by the endpoints' keys, never by the order the
    // scan happened to reach them in. (rank[A], rank[B]) is unique per
    // pair, so this is a strict total order and the primitive index of an
    // edge is a property of the points.
    const count = edgeA.length;
    const order = new Uint32Array(count);
    for (let e = 0; e < count; e++) order[e] = e;
    if (count > 0 && ranks !== undefined) {
      const rank = ranks;
      order.sort((a, b) => rank[edgeA[a]] - rank[edgeA[b]] || rank[edgeB[a]] - rank[edgeB[b]]);
    }

    // cloneGeometry is the only helper that preserves topology, and it is
    // what keeps this node pure: the input is a cached upstream object.
    // Cloned only now, so a refusal above costs nothing.
    const geo = cloneGeometry(src);
    const pointIndices = new Uint32Array(count * 2);
    const primVertexStart = new Uint32Array(count);
    const primVertexCount = new Uint32Array(count);
    const degrees = params.degreeAttr !== "" ? new Uint32Array(n) : undefined;
    const lengths = params.lengthAttr !== "" ? new Float64Array(count) : undefined;
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
      if (lengths) lengths[e] = Math.sqrt(edgeD2[s]);
    }
    setPolylineTopology(geo, pointIndices, primVertexStart, primVertexCount);

    if (lengths) {
      // The primitive domain exists only now, and holds exactly the
      // primtype column setPolylineTopology just stamped.
      requireReportSlot({
        attrs: geo.attrs.primitive,
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
      for (let e = 0; e < count; e++) data[e] = lengths[e];
    }
    if (degrees) {
      const attr = geo.attrs.point.replace(params.degreeAttr, "u32", 1, 0);
      const data = attr.data;
      for (let i = 0; i < n; i++) data[i] = degrees[i];
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
