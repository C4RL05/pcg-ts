/**
 * Adjacency SIDE-CAR: which points lie near which, in CSR form.
 *
 * A side-car is a derived index that lives BESIDE the data it was derived
 * from and never inside it. That is the whole design: an adjacency stored
 * as geometry — an edge list, a per-point neighbour column — is a second
 * copy of a fact the positions already state, free to disagree with them
 * the moment anything moves a point, and nothing in the type system
 * notices. Held here instead, an adjacency is either rebuilt or evicted;
 * it can never be stale AND believed at the same time.
 *
 * That is also why this file stores neither distances nor identities:
 *
 * - **No distances.** A distance is a pure function of two stored
 *   positions, so caching it duplicates the positions — exactly the
 *   staleness class the side-car exists to avoid. Consumers recompute it
 *   from `P` (one subtract and one multiply per axis), which is cheaper
 *   than the cache miss it would otherwise have to reason about.
 * - **No identities.** A point's identity depends on its `seed` column
 *   (see `src/data/identity.ts`), and adjacency never reads `seed`. Two
 *   clouds that differ only in `seed` have the SAME adjacency, so folding
 *   identity in here would split the cache on a column the answer does not
 *   depend on, and would make this file's cache key wrong the day a node
 *   rewrites `seed` in place.
 *
 * **Determinism** (a hard invariant of this library) is inherited rather
 * than argued: the neighbour scan reads
 * {@link UniformGrid.queryRadiusUnordered}, whose SET is a function of the
 * positions and the radius alone — never of hash-map iteration order — and
 * each CSR row is then sorted, so the order is a function of that set alone.
 * Sorting per row rather than per query is not a weakening: the membership
 * test reads only the candidate's own position, so filtering a set and then
 * sorting it yields exactly the sequence that sorting it and then filtering
 * would. The row is the only place the order is ever observed.
 */
import { UniformGrid, type PositionView } from "./uniformGrid.js";

/**
 * Neighbour relation over `count` points, compressed sparse row.
 *
 * Row `i` is `neighbors[offsets[i] .. offsets[i + 1])`, holding every OTHER
 * point strictly within {@link radius}, in ascending point index. The
 * relation is symmetric: `j` is in row `i` exactly when `i` is in row `j`
 * (the predicate reads the same two positions and sums the same three
 * squares either way, so the two tests agree bit for bit).
 *
 * **The membership predicate is STRICT: `d² < radius²`.** This is the one
 * decision in the file that a caller must not re-litigate, because it is
 * what makes an adjacency computable from a WINDOW of the cloud:
 *
 * - Edge existence reads two stored positions and no third point, so it is
 *   a ZERO-HOP property. A window that holds every point within `radius`
 *   of the region it owns can therefore decide every edge that region
 *   owns, with no iteration and no second pass.
 * - The window is a HALF-OPEN box widened by the halo, and a point exactly
 *   on its far face is EXCLUDED (`filterByBounds`'s `halfOpen` rule, which
 *   is what makes abutting cells tile without duplicates). With a strict
 *   predicate a neighbour ON that face is not a neighbour of anything the
 *   window owns, so excluding it costs nothing. With the inclusive `d <=
 *   radius` the two boundary conventions have to cancel exactly for the
 *   answer to survive — an argument that holds only while ownership stays
 *   half-open at the max face and closed at the min face. Strictness makes
 *   the property independent of that convention instead of contingent on
 *   it, which is worth one excluded knife-edge pair.
 *
 * The grid's radius query is INCLUSIVE (`d <= radius`), so it is used as a
 * candidate superset and the strict test is applied on top of it. Querying
 * strictly and keeping strictly would be wrong for the opposite reason: the
 * grid's block bound is derived from the inclusive radius, and narrowing the
 * query is how a knife-edge neighbour gets lost before the predicate ever
 * sees it.
 *
 * An inclusive variant, if one is ever needed, is a new field on this
 * structure AND a new component of the cache key — never a reinterpretation
 * of `radius`.
 *
 * **Non-finite positions.** A point with a NaN or infinite coordinate has
 * an empty row and appears in nobody else's, inherited from the grid: every
 * comparison against a NaN distance is false.
 *
 * **Reuse contract**, identical to {@link UniformGrid}'s and for the same
 * reason — this structure is derived from positions it does not own:
 * - Build once, read any number of times, from any number of callers.
 *   Nothing here mutates, so a built adjacency is safe to share.
 * - It is valid exactly as long as `(view.data, view.count, view.stride)`
 *   describe the same points. Rebuild when positions are written, when the
 *   count changes, or when the buffer is reallocated.
 * - {@link adjacencyFor} detects all of those EXCEPT ONE: an in-place
 *   rewrite of `P` into the SAME buffer at the same count and stride. That
 *   is the exact gap `UniformGrid` documents, and it is closed in practice
 *   by the same discipline — every node clones its input geometry before
 *   writing (`cloneGeometry`), so a rewritten `P` is a different buffer.
 *   A caller that deliberately writes through a live `P.data` must call
 *   {@link buildAdjacency} directly.
 */
export interface Adjacency {
  /** Number of rows: the point count this was built over. */
  readonly count: number;
  /** The strict radius the relation was built at (`d² < radius²`). */
  readonly radius: number;
  /** Row bounds, length `count + 1`; `offsets[0]` is 0 and never moves. */
  readonly offsets: Uint32Array;
  /** Neighbour point indices, ascending within each row. */
  readonly neighbors: Uint32Array;
}

/** Options for {@link buildAdjacency} and {@link adjacencyFor}. */
export interface AdjacencyOptions {
  /**
   * Grid cell size. Defaults to `radius`, which makes each query a 3x3x3
   * block — the policy `selfPrune` and `pointNeighborhood` use. It affects
   * only SPEED: a radius query returns the same set at any positive cell
   * size, which is why it is deliberately NOT part of the cache key.
   */
  readonly cellSize?: number;
  /**
   * Ceiling on the UNORDERED pairs the relation may hold, enforced during
   * the scan so a runaway radius cannot allocate first and fail second.
   * Defaults to unbounded; a node passes its own published constant.
   */
  readonly maxEdges?: number;
  /** Name used in error messages — pass the NODE the author has to fix. */
  readonly who?: string;
  /** Sentence appended to a {@link maxEdges} error, naming the way out. */
  readonly hint?: string;
  /** Cooperative cancellation, polled during the scan. */
  readonly checkCancelled?: () => void;
}

/** Default name in error messages when a caller passes no `who`. */
const DEFAULT_WHO = "buildAdjacency";

/**
 * Build the CSR relation over every point of `positions`.
 *
 * Not cached — use {@link adjacencyFor} unless you are deliberately
 * bypassing the cache (see the reuse contract on {@link Adjacency}).
 */
export function buildAdjacency(
  positions: PositionView,
  radius: number,
  options: AdjacencyOptions = {},
): Adjacency {
  const who = options.who ?? DEFAULT_WHO;
  if (!(radius >= 0) || !Number.isFinite(radius)) {
    throw new Error(
      `${who}: adjacency radius must be a finite number >= 0 (got ${radius}); 0 builds an empty relation, and an unbounded radius would connect every pair — bound it and raise maxEdges instead`,
    );
  }
  const n = positions.count;
  const offsets = new Uint32Array(n + 1);
  if (n === 0 || radius === 0) {
    return { count: n, radius, offsets, neighbors: new Uint32Array(0) };
  }
  const cellSize = options.cellSize ?? radius;
  const maxEdges = options.maxEdges ?? Number.POSITIVE_INFINITY;
  // Each unordered pair occupies two CSR entries, one per endpoint's row.
  const maxEntries = maxEdges * 2;
  const grid = UniformGrid.build(positions, cellSize);
  const data = positions.data;
  const stride = positions.stride;
  const limit = radius * radius;
  const checkCancelled = options.checkCancelled;
  // One entry per point to start with: `offsets` is already `n + 1`, so this
  // is not the allocation that decides the footprint, and it is close enough
  // that a real cloud doubles a handful of times instead of a dozen.
  let neighbors = new Uint32Array(Math.max(16, n));
  let written = 0;
  const hits: number[] = []; // scratch reused by every query
  for (let i = 0; i < n; i++) {
    if ((i & 255) === 0) checkCancelled?.();
    const o = i * stride;
    const x = data[o];
    const y = data[o + 1];
    const z = data[o + 2];
    const rowStart = written;
    // Inclusive candidates, strict membership — see {@link Adjacency}. The
    // candidates come back unordered because CSR only ever exposes the order
    // WITHIN a row, and that row is sorted below.
    grid.queryRadiusUnordered(x, y, z, radius, hits);
    for (let h = 0; h < hits.length; h++) {
      const j = hits[h];
      if (j === i) continue; // a point is not its own neighbour
      const q = j * stride;
      const dx = data[q] - x;
      const dy = data[q + 1] - y;
      const dz = data[q + 2] - z;
      // Negated so a NaN distance (a non-finite point) is excluded.
      if (!(dx * dx + dy * dy + dz * dz < limit)) continue;
      if (written === neighbors.length) {
        const grown = new Uint32Array(Math.max(16, neighbors.length * 2));
        grown.set(neighbors);
        neighbors = grown;
      }
      neighbors[written++] = j;
    }
    // Order the row, over the entries that SURVIVED rather than over every
    // candidate offered. No comparator: a typed array sorts numerically by
    // default, where a plain array would sort lexicographically and need one.
    // A row of 0 or 1 is already ordered and not worth a view to say so.
    if (written - rowStart > 1) neighbors.subarray(rowStart, written).sort();
    if (written > maxEntries) {
      throw overflowError(who, radius, maxEdges, written, i + 1, n, options.hint);
    }
    offsets[i + 1] = written;
  }
  // `slice`, not `subarray`: a view would keep the whole doubling buffer
  // alive for as long as anything holds the adjacency, and after the last
  // doubling that is up to twice the bytes the relation actually needs. The
  // cache pins several of these per position buffer, so the copy is paid once
  // and the slack is returned.
  return { count: n, radius, offsets, neighbors: neighbors.slice(0, written) };
}

/**
 * The measured overflow message: what was asked for, what it already cost,
 * and where it was heading. `scanned` of `total` points have produced
 * `entries` CSR entries, i.e. `entries / 2` pairs.
 */
function overflowError(
  who: string,
  radius: number,
  maxEdges: number,
  entries: number,
  scanned: number,
  total: number,
  hint: string | undefined,
): Error {
  const meanDegree = entries / scanned;
  const projected = Math.round((meanDegree * total) / 2);
  return new Error(
    `${who}: radius ${radius} connects more than ${maxEdges} pairs over ${total} points — ` +
      `after ${scanned} of them there are already ${Math.floor(entries / 2)} pairs ` +
      `(mean degree ${meanDegree.toFixed(1)}, projecting about ${projected} in total). ` +
      (hint ??
        "Lower the radius (the pair count grows with radius^2 over a surface and radius^3 through a volume), or thin the cloud upstream."),
  );
}

/**
 * Cached relations, keyed on the position BUFFER's identity. A WeakMap
 * gives free eviction: when the geometry holding `P` is collected, so is
 * every adjacency derived from it, with no cache-invalidation call for a
 * caller to forget.
 *
 * The inner key is `count | stride | radius`, and **`cellSize` is
 * deliberately absent**: `queryRadius` returns the same set at any
 * positive cell size, so two calls that differ only in cell size ask the
 * same question and must share one answer. Including it would multiply
 * the cache by a parameter that cannot change a single bit of the result.
 */
const CACHE = new WeakMap<ArrayLike<number>, Map<string, Adjacency>>();

/**
 * Relations kept per buffer. A caller sweeping a radius (an animated
 * parameter) would otherwise pin one CSR per distinct value for as long as
 * the geometry lives. Eviction is least-recently-USED, not least recently
 * built, so one hot radius interleaved with a sweep of cold ones survives the
 * sweep instead of being evicted once per cycle. Either way eviction can
 * never change a result — this is a pure memo, and a miss simply rebuilds.
 */
const MAX_CACHED_RADII = 4;

/**
 * {@link buildAdjacency}, memoized on the position buffer. See the reuse
 * contract on {@link Adjacency} for the one staleness this cannot detect.
 */
export function adjacencyFor(
  positions: PositionView,
  radius: number,
  options: AdjacencyOptions = {},
): Adjacency {
  const key = `${positions.count}|${positions.stride}|${radius}`;
  let byKey = CACHE.get(positions.data);
  const hit = byKey?.get(key);
  if (byKey !== undefined && hit !== undefined) {
    // Re-checked on a hit: the limit belongs to the CALLER, and an entry
    // built under a looser one must not slip past a tighter one. The count
    // is exact here, so the message is too.
    const maxEdges = options.maxEdges ?? Number.POSITIVE_INFINITY;
    if (hit.neighbors.length > maxEdges * 2) {
      throw overflowError(
        options.who ?? DEFAULT_WHO,
        radius,
        maxEdges,
        hit.neighbors.length,
        hit.count,
        hit.count,
        options.hint,
      );
    }
    // Re-insert to move it to the end: a Map iterates in insertion order, so
    // deleting and re-setting is what makes the eviction below LRU rather
    // than FIFO. Reading an entry is what keeps it, not building it.
    byKey.delete(key);
    byKey.set(key, hit);
    return hit;
  }
  const built = buildAdjacency(positions, radius, options);
  if (byKey === undefined) {
    byKey = new Map();
    CACHE.set(positions.data, byKey);
  }
  byKey.set(key, built);
  if (byKey.size > MAX_CACHED_RADII) {
    const coldest = byKey.keys().next(); // first in iteration order = least recently used
    if (!coldest.done) byKey.delete(coldest.value);
  }
  return built;
}
