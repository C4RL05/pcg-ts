/**
 * Sparse uniform grid hash over point positions.
 *
 * A cell-hashed acceleration structure for proximity queries: points are
 * bucketed by `floor(coordinate / cellSize)` in a sparse map, so memory
 * follows the occupied cells rather than the bounding box and coordinates
 * are unbounded in every direction.
 *
 * Determinism (a hard invariant of this library) is structural here: cell
 * assignment is a pure function of the coordinate and the cell size, every
 * scan visits a fixed cell order, and every query that can return several
 * candidates defines its own total order (`queryRadius` sorts by ascending
 * point index; `nearest` breaks distance ties toward the lowest index). No
 * result depends on hash-map iteration order or on the order points were
 * inserted. `queryRadiusUnordered` is the one query that returns a SET and no
 * order, and it says so in its name: it moves the ordering obligation to a
 * caller that was going to order the result anyway, and never removes it.
 */

/**
 * Read-only structure-of-arrays view of point positions: point `i` is at
 * `data[i * stride]`, `+1`, `+2`. Matches a `P` attribute's `data` and
 * `tupleSize` directly; nothing is copied, so see the reuse contract on
 * {@link UniformGrid}.
 */
export interface PositionView {
  /** Packed coordinates, at least `count * stride` long. */
  readonly data: ArrayLike<number>;
  /** Elements per point; must be >= 3 (x, y, z are the first three). */
  readonly stride: number;
  /** Number of points addressable through this view. */
  readonly count: number;
}

/**
 * Uniform grid hash for radius and nearest-point queries over a
 * {@link PositionView}.
 *
 * **Cell assignment.** A coordinate `v` lands in cell
 * `Math.floor(v * (1 / cellSize))` on each axis, and a cell is keyed by its
 * three integer coordinates. The reciprocal is computed once and multiplied
 * (never divided per point), which is what the original `selfPrune` grid
 * did; keeping that arithmetic identical is why its published output is
 * unchanged by this extraction.
 *
 * **Non-finite positions.** Points with a NaN or infinite coordinate are
 * still indexed (they occupy degenerate cells) but can never satisfy a
 * distance predicate, because every comparison against a NaN distance is
 * false. They are excluded from the occupied-cell bounds so one bad point
 * cannot widen the search box.
 *
 * **Reuse contract.** The grid holds a *reference* to the position view and
 * re-reads coordinates at query time; it never copies them. It is therefore
 * valid exactly as long as `(view.data, view.stride, view.count, cellSize)`
 * describe the same points:
 * - Build once, query any number of times, from any number of callers.
 * - The owner (a node, a cook cache, a caller) must rebuild when positions
 *   are written, when the point count changes, when the underlying buffer is
 *   reallocated (a resize can swap the typed array), or when a different
 *   cell size is wanted. Nothing here detects those; a cache should key on
 *   buffer identity plus count, stride and cell size.
 * - Queries never mutate the grid, so a built grid is safe to share.
 * - {@link insert} is the only mutator and only ever adds; a grid built
 *   incrementally (as `selfPrune` does, indexing survivors as it scans) is a
 *   partial index of the same view and follows the same rules.
 */
export class UniformGrid {
  /** The indexed positions (referenced, never copied). */
  readonly positions: PositionView;
  /** Edge length of one cell, in world units. */
  readonly cellSize: number;
  /** `1 / cellSize`, precomputed: cell coordinates multiply by this. */
  readonly inverseCellSize: number;

  private readonly cells = new Map<string, number[]>();
  private indexed = 0;
  private minCx = Infinity;
  private minCy = Infinity;
  private minCz = Infinity;
  private maxCx = -Infinity;
  private maxCy = -Infinity;
  private maxCz = -Infinity;

  /**
   * Create an empty grid over `positions`. Index points with
   * {@link insert}, or use {@link UniformGrid.build} to index all of them.
   *
   * `cellSize` should be the radius the queries will use (one cell per
   * query radius makes the scan a 3x3x3 block); when radii vary, the mean
   * point spacing is the usual choice.
   */
  constructor(positions: PositionView, cellSize: number) {
    if (!(cellSize > 0)) {
      throw new Error(
        `UniformGrid: cellSize must be a positive number (got ${cellSize}); pass the query radius, or the mean point spacing when radii vary`,
      );
    }
    if (!(positions.stride >= 3)) {
      throw new Error(
        `UniformGrid: positions.stride must be >= 3 (got ${positions.stride}); x, y, z are read at index * stride`,
      );
    }
    if (!(positions.count >= 0)) {
      throw new Error(`UniformGrid: positions.count must be >= 0 (got ${positions.count})`);
    }
    this.positions = positions;
    this.cellSize = cellSize;
    this.inverseCellSize = 1 / cellSize;
  }

  /** Build a grid over every point of `positions`, in ascending index order. */
  static build(positions: PositionView, cellSize: number): UniformGrid {
    const grid = new UniformGrid(positions, cellSize);
    for (let i = 0; i < positions.count; i++) grid.insert(i);
    return grid;
  }

  /** Number of indexed points. */
  get size(): number {
    return this.indexed;
  }

  /** Number of occupied cells. */
  get cellCount(): number {
    return this.cells.size;
  }

  /** Cell coordinate of a world coordinate on any axis. */
  cellCoordOf(v: number): number {
    return Math.floor(v * this.inverseCellSize);
  }

  /**
   * Chebyshev cell radius whose block of cells covers everything within
   * `distance` of a query point: `ceil(distance / cellSize)`, so a distance
   * equal to the cell size scans the 3x3x3 block around the query cell.
   * Returns 0 for a non-positive distance and `Infinity` when the ratio
   * overflows (callers switch to a full scan there).
   */
  cellRadiusFor(distance: number): number {
    if (!(distance > 0)) return 0;
    // Exact for equal values, including cellSize === distance === Infinity,
    // where the ratio itself would be NaN.
    if (distance === this.cellSize) return 1;
    const rings = Math.ceil(distance / this.cellSize);
    return Number.isFinite(rings) ? rings : Number.POSITIVE_INFINITY;
  }

  /**
   * Index point `index` of the position view. Adding the same index twice
   * lists it twice; callers own uniqueness.
   */
  insert(index: number): void {
    const { data, stride, count } = this.positions;
    if (!(index >= 0 && index < count) || !Number.isInteger(index)) {
      throw new Error(
        `UniformGrid.insert: index ${index} is not a point of the view (expected an integer in [0, ${count}))`,
      );
    }
    const o = index * stride;
    const cx = this.cellCoordOf(data[o]);
    const cy = this.cellCoordOf(data[o + 1]);
    const cz = this.cellCoordOf(data[o + 2]);
    const key = `${cx},${cy},${cz}`;
    let bucket = this.cells.get(key);
    if (!bucket) this.cells.set(key, (bucket = []));
    bucket.push(index);
    this.indexed++;
    // Bounds track finite cells only: a non-finite point is never a valid
    // candidate, and letting it in would stretch every search box.
    if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(cz)) {
      if (cx < this.minCx) this.minCx = cx;
      if (cx > this.maxCx) this.maxCx = cx;
      if (cy < this.minCy) this.minCy = cy;
      if (cy > this.maxCy) this.maxCy = cy;
      if (cz < this.minCz) this.minCz = cz;
      if (cz > this.maxCz) this.maxCz = cz;
    }
  }

  /**
   * Whether any indexed point is *strictly* closer than `distance` to
   * (x, y, z) — the minimum-distance predicate: false means the position is
   * at least `distance` away from every indexed point. Compares squared
   * distances against `distance * distance`. A point at exactly `distance`
   * does not count as closer.
   */
  hasPointCloserThan(x: number, y: number, z: number, distance: number): boolean {
    if (!(distance > 0) || this.indexed === 0) return false;
    const limit = distance * distance;
    const rings = this.cellRadiusFor(distance);
    const { data, stride } = this.positions;
    // Computed once and handed to the guard: the safety test and the block
    // scan must reason about the SAME cell coordinates, so there is only one
    // site that may compute them.
    const cx = this.cellCoordOf(x);
    const cy = this.cellCoordOf(y);
    const cz = this.cellCoordOf(z);
    if (this.useFullScan(rings) || this.blockUnsafe(cx, cy, cz, rings)) {
      for (const bucket of this.cells.values()) {
        for (const j of bucket) {
          const o = j * stride;
          const dx = data[o] - x;
          const dy = data[o + 1] - y;
          const dz = data[o + 2] - z;
          if (dx * dx + dy * dy + dz * dz < limit) return true;
        }
      }
      return false;
    }
    for (let ox = -rings; ox <= rings; ox++) {
      for (let oy = -rings; oy <= rings; oy++) {
        for (let oz = -rings; oz <= rings; oz++) {
          const bucket = this.cells.get(`${cx + ox},${cy + oy},${cz + oz}`);
          if (!bucket) continue;
          for (const j of bucket) {
            const o = j * stride;
            const dx = data[o] - x;
            const dy = data[o + 1] - y;
            const dz = data[o + 2] - z;
            if (dx * dx + dy * dy + dz * dz < limit) return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Indices of every indexed point within `radius` of (x, y, z), boundary
   * included (squared distance <= `radius * radius`).
   *
   * Results are returned in **ascending point index** order, whatever order
   * the cells were visited or the points inserted in, and each indexed point
   * appears at most once. Pass `out` to reuse an array; it is emptied first
   * and returned.
   */
  queryRadius(x: number, y: number, z: number, radius: number, out: number[] = []): number[] {
    return this.queryRadiusUnordered(x, y, z, radius, out).sort(ascending);
  }

  /**
   * {@link queryRadius}'s SET, without its ORDER: the same membership
   * (squared distance <= `radius * radius`, each indexed point at most once)
   * in whatever order the cells happen to be visited.
   *
   * For callers that impose their own order downstream and would otherwise
   * pay for a sort twice — {@link buildAdjacency} sorts each CSR row in a
   * typed array, which is a different (and cheaper) sort than this one.
   * **Everyone else wants {@link queryRadius}**: the order here is a function
   * of the insertion order and of which scan path was taken, so it is not
   * something a result may depend on. Determinism of a downstream result must
   * come from that caller's own ordering, never from this one.
   */
  queryRadiusUnordered(
    x: number,
    y: number,
    z: number,
    radius: number,
    out: number[] = [],
  ): number[] {
    out.length = 0;
    if (!(radius >= 0) || this.indexed === 0) return out;
    const limit = radius * radius;
    const rings = this.cellRadiusFor(radius);
    const { data, stride } = this.positions;
    // Computed once and handed to the guard: the safety test and the block
    // scan must reason about the SAME cell coordinates, so there is only one
    // site that may compute them.
    const cx = this.cellCoordOf(x);
    const cy = this.cellCoordOf(y);
    const cz = this.cellCoordOf(z);
    if (this.useFullScan(rings) || this.blockUnsafe(cx, cy, cz, rings)) {
      for (const bucket of this.cells.values()) {
        for (const j of bucket) {
          const o = j * stride;
          const dx = data[o] - x;
          const dy = data[o + 1] - y;
          const dz = data[o + 2] - z;
          if (dx * dx + dy * dy + dz * dz <= limit) out.push(j);
        }
      }
      return out;
    }
    for (let ox = -rings; ox <= rings; ox++) {
      for (let oy = -rings; oy <= rings; oy++) {
        for (let oz = -rings; oz <= rings; oz++) {
          const bucket = this.cells.get(`${cx + ox},${cy + oy},${cz + oz}`);
          if (!bucket) continue;
          for (const j of bucket) {
            const o = j * stride;
            const dx = data[o] - x;
            const dy = data[o + 1] - y;
            const dz = data[o + 2] - z;
            if (dx * dx + dy * dy + dz * dz <= limit) out.push(j);
          }
        }
      }
    }
    return out;
  }

  /**
   * Index of the indexed point nearest to (x, y, z), or -1 when there is
   * none within `maxRadius` (default unbounded). Equal distances resolve to
   * the **lowest point index**. A query with a non-finite coordinate has no
   * nearest point and returns -1, and neither does a grid holding only
   * non-finite points. -1 means "no candidate", never "the distance
   * overflowed": under an unbounded `maxRadius` a point whose squared
   * distance overflows to Infinity is still returned.
   *
   * Searches cell shells outward from the query cell and stops as soon as
   * the next shell cannot beat the current best, so a query inside a dense
   * cloud touches a handful of cells. Very wide or very sparse searches fall
   * back to scanning every occupied cell, which returns the same point.
   */
  nearest(x: number, y: number, z: number, maxRadius = Number.POSITIVE_INFINITY): number {
    if (this.indexed === 0) return -1;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return -1;
    if (!(maxRadius >= 0)) return -1;
    if (this.minCx > this.maxCx) return -1; // no finite point indexed
    const cx = this.cellCoordOf(x);
    const cy = this.cellCoordOf(y);
    const cz = this.cellCoordOf(z);
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) {
      return this.nearestFullScan(x, y, z, maxRadius);
    }
    // First shell that can hold anything: the Chebyshev cell distance from
    // the query cell to the occupied box. Shells nearer than that are
    // provably empty, so a far-away query does not walk them one by one.
    const startR = Math.max(
      shellGap(cx, this.minCx, this.maxCx),
      shellGap(cy, this.minCy, this.maxCy),
      shellGap(cz, this.minCz, this.maxCz),
    );
    // Last shell that can hold anything: the far corner of the occupied box,
    // clipped to the shells `maxRadius` can reach.
    let endR = Math.max(
      shellSpan(cx, this.minCx, this.maxCx),
      shellSpan(cy, this.minCy, this.maxCy),
      shellSpan(cz, this.minCz, this.maxCz),
    );
    const reach = this.cellRadiusFor(maxRadius);
    if (reach < endR) endR = reach;
    const limit = maxRadius * maxRadius;
    const { data, stride } = this.positions;
    // Cell lookups this search may spend before the full scan is the
    // cheaper answer. Depends only on the grid and the query, never on
    // timing, so the choice of path is deterministic.
    let budget = this.cells.size * 8 + 64;
    let best = Number.POSITIVE_INFINITY;
    let bestIdx = -1;
    for (let r = startR; r <= endR; r++) {
      if (bestIdx >= 0) {
        // Nothing in shell r is closer than (r - 1) cell sizes; stop when
        // that lower bound already loses to the best distance found (a
        // non-strict comparison would drop equal-distance lower indices).
        const bound = (r - 1) * this.cellSize;
        if (bound > 0 && bound * bound > best) break;
      }
      const x0 = Math.max(cx - r, this.minCx);
      const x1 = Math.min(cx + r, this.maxCx);
      const y0 = Math.max(cy - r, this.minCy);
      const y1 = Math.min(cy + r, this.maxCy);
      const z0 = Math.max(cz - r, this.minCz);
      const z1 = Math.min(cz + r, this.maxCz);
      const nx = x1 - x0 + 1;
      const ny = y1 - y0 + 1;
      const nz = z1 - z0 + 1;
      // Every shell spends budget, empty ones included, and a spend that is
      // not a positive number spends everything: termination is then a
      // property of this line alone, not of the bounds being sane or of the
      // shell arithmetic staying finite.
      budget -= Math.max(1, nx * ny * nz);
      if (!(budget >= 0)) return this.nearestFullScan(x, y, z, maxRadius);
      if (nx <= 0 || ny <= 0 || nz <= 0) continue;
      // Counted loops: cell coordinates can be large enough that `+ 1` is a
      // no-op in float64, which would never terminate an ascending loop.
      for (let ix = 0; ix < nx; ix++) {
        const gx = x0 + ix;
        const adx = Math.abs(gx - cx);
        for (let iy = 0; iy < ny; iy++) {
          const gy = y0 + iy;
          const ady = Math.abs(gy - cy);
          for (let iz = 0; iz < nz; iz++) {
            const gz = z0 + iz;
            // Only the shell at Chebyshev distance r; inner cells were
            // visited by earlier shells.
            if (Math.max(adx, ady, Math.abs(gz - cz)) !== r) continue;
            const bucket = this.cells.get(`${gx},${gy},${gz}`);
            if (!bucket) continue;
            for (const j of bucket) {
              const o = j * stride;
              const dx = data[o] - x;
              const dy = data[o + 1] - y;
              const dz = data[o + 2] - z;
              const d2 = dx * dx + dy * dy + dz * dz;
              // Negated so a NaN distance (a non-finite point) is skipped.
              if (!(d2 <= limit)) continue;
              if (bestIdx < 0 || d2 < best || (d2 === best && j < bestIdx)) {
                best = d2;
                bestIdx = j;
              }
            }
          }
        }
      }
    }
    return bestIdx;
  }

  /** Nearest point by scanning every occupied cell; same answer as {@link nearest}. */
  private nearestFullScan(x: number, y: number, z: number, maxRadius: number): number {
    const limit = maxRadius * maxRadius;
    const { data, stride } = this.positions;
    let best = Number.POSITIVE_INFINITY;
    let bestIdx = -1;
    for (const bucket of this.cells.values()) {
      for (const j of bucket) {
        const o = j * stride;
        const dx = data[o] - x;
        const dy = data[o + 1] - y;
        const dz = data[o + 2] - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        // Negated so a NaN distance (a non-finite point) is skipped.
        if (!(d2 <= limit)) continue;
        if (bestIdx < 0 || d2 < best || (d2 === best && j < bestIdx)) {
          best = d2;
          bestIdx = j;
        }
      }
    }
    return bestIdx;
  }

  /**
   * Whether a scan of `rings` cell shells should visit every occupied cell
   * instead. True once the block of cells to look up outgrows the number of
   * cells that exist (and for an unbounded ring count). Never true for the
   * minimal 3x3x3 block: there is nothing cheaper to fall back to, and the
   * two paths must stay interchangeable, not merely equivalent.
   */
  private useFullScan(rings: number): boolean {
    if (rings <= 1) return false;
    if (!Number.isFinite(rings)) return true;
    const side = 2 * rings + 1;
    return side * side * side > this.cells.size;
  }

  /**
   * Whether a block scan around the query cell (`cx`, `cy`, `cz`) cannot be
   * trusted, so the caller must fall back to the full scan. The caller passes
   * the cell coordinates it is about to scan from rather than the world
   * position, so the guard and the scan cannot drift onto different cells —
   * which is the failure this guard exists to catch, and it would be invisible
   * if the two sites computed the coordinates separately.
   *
   * Cell coordinates are floats. Once one exceeds 2^53, `c + 1 === c`: the
   * block's offsets collapse onto the query cell, so the scan visits that
   * one cell many times — returning the same point repeatedly — while the
   * cells that actually hold its neighbours are never visited at all. It is
   * reached when a coordinate is enormous relative to the cell size (a
   * position of 3 at a cell size of 1e-30), and a NaN or infinite query
   * coordinate lands here too, where the full scan gives the same (empty)
   * answer. `nearest` needs no such guard: it walks counted loops and keeps
   * a best, so a repeated cell cannot change what it returns.
   */
  private blockUnsafe(cx: number, cy: number, cz: number, rings: number): boolean {
    return (
      !safeBlockAxis(cx, rings) || !safeBlockAxis(cy, rings) || !safeBlockAxis(cz, rings)
    );
  }
}

/** Whether `c - rings` and `c + rings` are both distinct, exact integers. */
function safeBlockAxis(c: number, rings: number): boolean {
  return Number.isSafeInteger(c - rings) && Number.isSafeInteger(c + rings);
}

/** Numeric ascending comparator (Array#sort is lexicographic by default). */
function ascending(a: number, b: number): number {
  return a - b;
}

/** Cell distance from `c` to the nearest cell of [lo, hi] (0 when inside). */
function shellGap(c: number, lo: number, hi: number): number {
  if (c < lo) return lo - c;
  if (c > hi) return c - hi;
  return 0;
}

/** Cell distance from `c` to the farthest cell of [lo, hi]. */
function shellSpan(c: number, lo: number, hi: number): number {
  return Math.max(Math.abs(c - lo), Math.abs(c - hi));
}
