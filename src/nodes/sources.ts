/**
 * Source nodes: create point clouds from nothing (no geometry inputs).
 * All emit standard point clouds (P, rot, scale, density, bounds, color,
 * seed) with per-point seeds derived from the node seed.
 */
import { createPointCloud } from "../data/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import { standardNode } from "./registry.js";

/** Params of {@link pointGrid}. */
export interface PointGridParams {
  countX: number;
  countY: number;
  countZ: number;
  spacing: readonly number[];
  origin: readonly number[];
}

/**
 * Regular grid of points: `countX * countY * countZ` points starting at
 * `origin`, stepped by `spacing`. X varies fastest, then Y, then Z.
 */
export const pointGrid = standardNode<PointGridParams>({
  type: "pointGrid",
  category: "source",
  description:
    "Creates a regular grid of points: countX * countY * countZ points starting at origin, stepped by spacing per axis. Point order is X fastest, then Y, then Z. Emits a standard point cloud; per-point seed is hashed from the node seed and point index.",
  inputs: [],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    countX: { type: "i32", default: 10, min: 1, description: "Number of points along X. Minimum 1." },
    countY: { type: "i32", default: 1, min: 1, description: "Number of points along Y. Minimum 1." },
    countZ: { type: "i32", default: 10, min: 1, description: "Number of points along Z. Minimum 1." },
    spacing: {
      type: "vec3",
      default: [1, 1, 1],
      description: "Distance between neighboring points along each axis, in world units.",
    },
    origin: {
      type: "vec3",
      default: [0, 0, 0],
      description: "World position of the first point (index 0,0,0).",
    },
  },
  execute({ params, seed }) {
    const { countX, countY, countZ } = params;
    const [sx, sy, sz] = params.spacing;
    const [ox, oy, oz] = params.origin;
    const n = countX * countY * countZ;
    const geo = createPointCloud(n);
    const P = geo.attrs.point.require("P").data;
    const seeds = geo.attrs.point.require("seed").data;
    let i = 0;
    for (let z = 0; z < countZ; z++) {
      for (let y = 0; y < countY; y++) {
        for (let x = 0; x < countX; x++) {
          P[i * 3] = ox + x * sx;
          P[i * 3 + 1] = oy + y * sy;
          P[i * 3 + 2] = oz + z * sz;
          seeds[i] = hashCombine(seed, i);
          i++;
        }
      }
    }
    return { out: [makeGeometryItem(geo)] };
  },
});

/** Params of {@link pointLine}. */
export interface PointLineParams {
  count: number;
  start: readonly number[];
  end: readonly number[];
  includeEnd: boolean;
}

/** Evenly spaced points on the segment from `start` to `end`. */
export const pointLine = standardNode<PointLineParams>({
  type: "pointLine",
  category: "source",
  description:
    "Creates `count` evenly spaced points on the straight segment from start to end. By default both endpoints are included, so the last point sits exactly on end; set includeEnd false to sample the half-open range instead, stopping one step short of end — which is what a sweep that wraps back on itself needs so its first and last samples are not the same place. count 1 places a single point at start in either mode. Emits a standard point cloud; per-point seed is hashed from the node seed and point index.",
  inputs: [],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    count: { type: "i32", default: 10, min: 1, description: "Number of points to place. Minimum 1." },
    start: { type: "vec3", default: [0, 0, 0], description: "World position of the first point." },
    end: { type: "vec3", default: [10, 0, 0], description: "World position of the last point." },
    includeEnd: {
      type: "bool",
      default: true,
      description:
        "Whether `end` is one of the emitted positions. true (the default) samples the closed range [start, end]: `count` points stepping (end - start) / (count - 1), the first on start and the last exactly on end — use it for a run of points with both ends pinned, such as a fence between two posts. false samples the half-open range [start, end): `count` points stepping (end - start) / count, the last one step short of end — use it when the segment is a parameter that wraps, so a closed shape gets `count` distinct positions and no duplicate seam. count 1 emits a single point at start in both modes; count 0 emits nothing.",
    },
  },
  execute({ params, seed }) {
    const n = params.count;
    const [ax, ay, az] = params.start;
    const [bx, by, bz] = params.end;
    const geo = createPointCloud(n);
    const P = geo.attrs.point.require("P").data;
    const seeds = geo.attrs.point.require("seed").data;
    // Inclusive divides by the number of GAPS (n - 1), so the last point
    // lands on `end`; exclusive divides by the number of SAMPLES (n), so
    // the last point stops one step short. Only the inclusive branch can
    // divide by zero, and it keeps its original n === 1 guard so its
    // output is bit-identical to the pre-includeEnd node.
    for (let i = 0; i < n; i++) {
      const t = params.includeEnd ? (n === 1 ? 0 : i / (n - 1)) : i / n;
      P[i * 3] = ax + (bx - ax) * t;
      P[i * 3 + 1] = ay + (by - ay) * t;
      P[i * 3 + 2] = az + (bz - az) * t;
      seeds[i] = hashCombine(seed, i);
    }
    return { out: [makeGeometryItem(geo)] };
  },
});

/** Params of {@link pointScatterInBounds}. */
export interface PointScatterInBoundsParams {
  count: number;
  boundsMin: readonly number[];
  boundsMax: readonly number[];
  seed: number;
}

/** Uniform random points inside an axis-aligned box, hash-seeded. */
export const pointScatterInBounds = standardNode<PointScatterInBoundsParams>({
  type: "pointScatterInBounds",
  category: "source",
  description:
    "Scatters `count` points uniformly inside the axis-aligned box [boundsMin, boundsMax]. Each coordinate is an independent deterministic hash of (seed, point index, axis) — same seed always reproduces the same points, independent of evaluation order. Emits a standard point cloud.",
  inputs: [],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    count: { type: "i32", default: 100, min: 0, description: "Number of points to scatter. Minimum 0." },
    boundsMin: {
      type: "vec3",
      default: [0, 0, 0],
      description: "Minimum corner of the box, in world units.",
    },
    boundsMax: {
      type: "vec3",
      default: [1, 1, 1],
      description: "Maximum corner of the box, in world units. Should be >= boundsMin per component.",
    },
    seed: {
      type: "u32",
      default: 0,
      description: "Extra seed folded into the node seed; change it to re-roll the scatter.",
    },
  },
  execute({ params, seed: nodeSeed }) {
    const seed = hashCombine(nodeSeed, params.seed);
    const n = params.count;
    const [ax, ay, az] = params.boundsMin;
    const [bx, by, bz] = params.boundsMax;
    const geo = createPointCloud(n);
    const P = geo.attrs.point.require("P").data;
    const seeds = geo.attrs.point.require("seed").data;
    for (let i = 0; i < n; i++) {
      P[i * 3] = ax + (bx - ax) * hashFloat(hashCombine(seed, i, 0));
      P[i * 3 + 1] = ay + (by - ay) * hashFloat(hashCombine(seed, i, 1));
      P[i * 3 + 2] = az + (bz - az) * hashFloat(hashCombine(seed, i, 2));
      seeds[i] = hashCombine(seed, i, 3);
    }
    return { out: [makeGeometryItem(geo)] };
  },
});

/**
 * Ceiling on the lattice cells one query may visit. Not a semantic limit
 * — it changes no point the node emits — but a guard against a window
 * that would take unbounded time to walk (a kilometre-wide query at a
 * centimetre lattice). Raising it later is always compatible; the error
 * names the numbers so an author can fix the query instead.
 */
const MAX_LATTICE_CELLS = 1 << 22;

/**
 * Ceiling on the points one query may generate before clipping. Same
 * character as {@link MAX_LATTICE_CELLS}: a guard on the allocation, not
 * on the model.
 */
const MAX_LATTICE_POINTS = 1 << 22;

/** Params of {@link pointScatterInWorld}. */
export interface PointScatterInWorldParams {
  density: number;
  cellSize: number;
  latticeMode: string;
  height: number;
  boundsMin: readonly number[];
  boundsMax: readonly number[];
  seed: number;
}

/** Lowest lattice cell index whose slab can hold a point at or above `v`. */
function latticeLo(v: number, size: number): number {
  return Math.floor(v / size);
}

/**
 * Highest lattice cell index whose slab can hold a point strictly below
 * `v`. `ceil - 1` rather than `floor` so a window ending exactly on a
 * cell boundary does not walk a cell whose every point the half-open clip
 * would discard.
 */
function latticeHi(v: number, size: number): number {
  return Math.ceil(v / size) - 1;
}

/**
 * How far a coordinate can move on its way into the f32 column the cloud
 * stores it in, anywhere in a window spanning `lo`..`hi`.
 *
 * The clip below compares the value it is about to STORE, so the stored
 * position is always inside the window — but that same rounding can carry
 * a point OUT of the lattice slab it was generated in. A point whose
 * unrounded X sits a hair below a cell boundary can store as the boundary
 * itself, which belongs to the next cell along; the window that owns it
 * would never have visited the cell that generates it, and the point would
 * vanish from every window in the world. So the cell range is widened by
 * this margin and the per-point clip, which is exact, does the deciding.
 *
 * `ulp(v) <= |v| * 2^-23` for every normal f32, so one ulp at the larger
 * endpoint bounds the whole window. That is twice the half-ulp a round-to-
 * nearest can actually move a value, and the slack also absorbs the f64
 * rounding in computing the position itself.
 *
 * What it costs: nothing at all when a face lands strictly inside a
 * lattice cell, because floor/ceil of a value moved by a whisker is the
 * same cell — and one extra cell on that face when the window is aligned
 * to the lattice, which round numbers often are. That is a boundary cost,
 * so it fades as the window grows (a 24x24-cell window pays ~17%, a
 * 100x100 one ~4%), and almost every point it generates is discarded by
 * one comparison. Near the origin the margin is a whisker and buys
 * nothing measurable; a few million units out, where the f32 spacing
 * approaches the lattice spacing, it is the difference between a
 * partition and a leak.
 */
function f32ClipMargin(lo: number, hi: number): number {
  return Math.max(Math.abs(lo), Math.abs(hi)) * 2 ** -23;
}

/**
 * Points as a pure function of world position, queried through a window:
 * the world-anchored counterpart of {@link pointScatterInBounds}.
 */
export const pointScatterInWorld = standardNode<PointScatterInWorldParams>({
  type: "pointScatterInWorld",
  category: "source",
  description:
    "Scatters points over an INFINITE lattice anchored to world coordinates, then returns the ones inside the query window [boundsMin, boundsMax). A point's position and per-point seed are a pure function of (seed, latticeMode, cellSize) and its own lattice cell and index — never of the window, and density only decides how many points a cell holds — so the same world position always yields the same point under ANY query. Note what is NOT in that list: the graph seed. Alone among the nodes here, this one ignores it (see the `seed` param), because a lattice that moved with the graph seed could be de-anchored silently by an author reseeding a level graph per cell. That is what makes a halo just a wider query, lets a region cooked whole and the same region cooked in pieces agree byte for byte, and lets two cells on a boundary agree on what is there; pointScatterInBounds computes positions from the bounds and can promise none of it. Expected population is exactly `density * area` of the window in \"xz\" mode and `density * volume` in \"xyz\" mode, so an author can predict the count without cooking. Points are ordered by lattice cell (Z outer, then Y, then X) and by index within a cell, so any two windows list their shared points in the same relative order. Windows need not align to the lattice: partial cells are generated whole and clipped per point. The clip is half-open — a point on the min face belongs to this window, a point on the max face belongs to the next one — so abutting windows partition the world with no gap and no duplicate. The coordinate the clip tests is the f32 the point cloud STORES, not the wider intermediate it was computed from, so \"inside the window\" is a statement about the position you can actually read back: far from the origin, where the f32 spacing grows toward the lattice spacing, the two differ, and testing the intermediate would emit points whose stored position lies outside the window and have two abutting windows both disown the same point. Emits a standard point cloud.",
  inputs: [],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    density: {
      type: "f32",
      default: 0.01,
      min: 0,
      description:
        "Points per square world unit in \"xz\" mode, per cubic world unit in \"xyz\" mode. The expected number of points in a window is exactly density * area (or density * volume), for any window: a cell holds floor(lambda) points plus one more with probability frac(lambda), where lambda = density * cellSize^2 (or ^3). Raising density only ADDS points — the ones already there keep their positions and their per-point seeds — so it is safe to tune against a fixed layout. 0 emits nothing.",
    },
    cellSize: {
      type: "f32",
      default: 10,
      min: 0,
      description:
        "Edge length, in world units, of this node's own lattice cell — the patch over which the point count is quantized. It controls clumping, not population: population is set by density alone, while cellSize decides how evenly the points are spread (small cells spread them out, large cells let counts vary more). Must be > 0. Set it from the content's scale and NEVER from a World level's cellSize: tying the two would make the generated content a function of the runtime's partitioning, so re-tuning a level's streaming, or cooking the same region at two levels, would change the world.",
    },
    latticeMode: {
      type: "enum",
      default: "xz",
      enum: ["xz", "xyz"],
      description:
        "\"xz\" (default): a 2D lattice on the XZ plane, every point at Y = height, with the Y components of boundsMin/boundsMax IGNORED (they may be infinite, matching an \"xz\" World cell, which is unbounded in Y). \"xyz\": a 3D lattice, with Y coming from the lattice and the full box clipped. The two modes are independent point sets, not slices of one — switching modes re-rolls the layout.",
    },
    height: {
      type: "f32",
      default: 0,
      description:
        "World Y of every point in \"xz\" mode. Ignored in \"xyz\" mode. The 2D lattice is deliberately flat rather than spread over the query's Y range: deriving Y from the window is exactly what makes a source non-anchored. To put points on a surface, displace Y afterwards from a position-anchored field (e.g. setAttribute on P with a noise field) — that stays a function of world position, so it survives any query window.",
    },
    boundsMin: {
      type: "vec3",
      default: [0, 0, 0],
      acceptsInfinite: true,
      description:
        "Minimum corner of the query window, in world units — INCLUSIVE. Read only to choose which lattice cells to visit and to clip; it never moves a point. In \"xz\" mode the Y component is ignored, and -Infinity is the honest thing to write there: a World \"xz\" cell is a column with no vertical extent. An axis this mode DOES read must still be finite — the window chooses which cells to visit, so it has to be bounded — and an infinity never survives JSON, so a graph that must serialize needs a finite window.",
    },
    boundsMax: {
      type: "vec3",
      default: [100, 100, 100],
      acceptsInfinite: true,
      description:
        "Maximum corner of the query window, in world units — EXCLUSIVE, so abutting windows neither drop nor duplicate a point on their shared face. Read only to choose which lattice cells to visit and to clip. In \"xz\" mode the Y component is ignored and may be +Infinity, subject to the notes on boundsMin. A window with max <= min on a read axis emits nothing.",
    },
    seed: {
      type: "u32",
      default: 0,
      description:
        "THE seed of the world this node lays down, and its ONLY source of randomness: the graph seed does not reach it, which is unlike every other node in this library and is the point. Change THIS to re-roll the world; changing the graph seed, calling graph.setSeed inside a level's bind, passing a CLI seed override, or renaming the node all leave the lattice byte-identical, so anchoring cannot be lost by accident. It must be the SAME for every query that has to agree — in a World, bind it from the cell-INVARIANT `ctx.worldSeed` or `ctx.levelSeed`, never from the per-cell `ctx.seed`, which would make each cell an unrelated world and the guarantee empty. The cost of all this, which you have to plan for: two nodes of this type with identical params scatter IDENTICAL points, exactly as two noise fields with one spec are one field — so give each layer its own value here (e.g. hashCombine(ctx.worldSeed, 1) for trees and hashCombine(ctx.worldSeed, 2) for rocks) rather than relying on the node id to separate them.",
    },
  },
  execute({ params, checkCancelled }) {
    const mode = params.latticeMode;
    if (mode !== "xz" && mode !== "xyz") {
      throw new Error(
        `pointScatterInWorld: latticeMode must be "xz" or "xyz", got ${JSON.stringify(mode)}`,
      );
    }
    const dims = mode === "xyz" ? 3 : 2;
    const cellSize = params.cellSize;
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new Error(
        `pointScatterInWorld: cellSize must be a positive finite number, got ${cellSize}; it is this node's own lattice spacing in world units (set it from the content's scale, never from a World level's cellSize)`,
      );
    }
    const density = params.density;
    if (!Number.isFinite(density) || density < 0) {
      throw new Error(
        `pointScatterInWorld: density must be a finite number >= 0, got ${density}; it is points per square world unit in "xz" mode and per cubic world unit in "xyz" mode`,
      );
    }
    // Expected points per lattice cell. Split into a guaranteed part and a
    // probability, so the population is exactly density * area in
    // expectation for ANY lambda, not just integral ones.
    const lambda = density * cellSize ** dims;
    if (!Number.isFinite(lambda)) {
      throw new Error(
        `pointScatterInWorld: density ${density} at cellSize ${cellSize} overflows (density * cellSize^${dims} is not finite); lower one of them`,
      );
    }
    const kBase = Math.floor(lambda);
    const kFrac = lambda - kBase;

    const [minX, minY, minZ] = params.boundsMin;
    const [maxX, maxY, maxZ] = params.boundsMax;
    // Only the axes this mode actually reads are required to be finite:
    // an "xz" World cell is unbounded in Y and binds ±Infinity there.
    const axes: readonly (readonly [string, number, number])[] =
      mode === "xyz"
        ? [
            ["x", minX, maxX],
            ["y", minY, maxY],
            ["z", minZ, maxZ],
          ]
        : [
            ["x", minX, maxX],
            ["z", minZ, maxZ],
          ];
    for (const [axis, lo, hi] of axes) {
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        throw new Error(
          `pointScatterInWorld: boundsMin/boundsMax ${axis} must be finite in "${mode}" mode, got ${lo} and ${hi}; the window selects which lattice cells to visit, so it must be bounded${mode === "xz" ? " (only the Y components are ignored in this mode)" : ""}`,
        );
      }
    }

    // Widened by the f32 rounding margin on each face: a cell just outside
    // the window can still hold a point that STORES inside it, and the
    // per-point clip below discards whatever does not. See f32ClipMargin.
    const mx = f32ClipMargin(minX, maxX);
    const mz = f32ClipMargin(minZ, maxZ);
    const c0x = latticeLo(minX - mx, cellSize);
    const c1x = latticeHi(maxX + mx, cellSize);
    const c0z = latticeLo(minZ - mz, cellSize);
    const c1z = latticeHi(maxZ + mz, cellSize);
    // The 2D lattice still hashes a Y coordinate, pinned to 0, so the two
    // modes share one hashing scheme; `dims` in the seed keeps their point
    // sets independent anyway.
    const my = mode === "xyz" ? f32ClipMargin(minY, maxY) : 0;
    const c0y = mode === "xyz" ? latticeLo(minY - my, cellSize) : 0;
    const c1y = mode === "xyz" ? latticeHi(maxY + my, cellSize) : 0;
    const nx = c1x - c0x + 1;
    const ny = c1y - c0y + 1;
    const nz = c1z - c0z + 1;
    if (nx <= 0 || ny <= 0 || nz <= 0) return { out: [makeGeometryItem(createPointCloud(0))] };
    const cells = nx * ny * nz;
    if (cells > MAX_LATTICE_CELLS) {
      throw new Error(
        `pointScatterInWorld: the window spans ${cells} lattice cells (${nx}x${ny}x${nz}), over the ${MAX_LATTICE_CELLS} limit; raise cellSize or query a smaller window`,
      );
    }

    // The node seed is DELIBERATELY not an input here, and this is the
    // only node in the library that ignores it. A node seed is
    // hashCombine(graphSeed, nodeId), so anything that moves the graph
    // seed — `graph.setSeed` inside a level's bind (a sanctioned per-cell
    // variation pattern), a CLI --seed override, renaming the node —
    // would re-roll the lattice. Every window would still be internally
    // consistent and still deterministic; it would simply be a DIFFERENT
    // world from the one the neighbouring cell derived, so halos and
    // seams stop agreeing while the cook succeeds and the output still
    // looks plausible. Making the lattice a function of this node's own
    // params is what turns that from documented into impossible. The
    // lattice is a field, and fields carry their seeds in their specs.
    //
    // Lattice cell coordinates are always integers here (Math.floor /
    // Math.ceil of a finite quotient), which hashCombine requires — it
    // truncates floats toward zero, which would alias neighbouring cells.
    // `dims` decorrelates the two lattice modes.
    const seed = hashCombine(params.seed, dims);

    // Pass one counts the points the visited cells hold before clipping,
    // so the cloud is allocated once. It repeats the per-cell hash in pass
    // two rather than storing a count per cell: one extra hash per cell is
    // cheaper than an array as wide as the window.
    let total = 0;
    let sinceCheck = 0;
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cy = c0y; cy <= c1y; cy++) {
        for (let cx = c0x; cx <= c1x; cx++) {
          const h = hashCombine(seed, cx, cy, cz);
          total += kBase + (hashFloat(hashCombine(h, 0)) < kFrac ? 1 : 0);
        }
      }
      if ((sinceCheck += nx * ny) >= 4096) {
        sinceCheck = 0;
        checkCancelled();
      }
    }
    if (total > MAX_LATTICE_POINTS) {
      throw new Error(
        `pointScatterInWorld: the window would generate ${total} points before clipping, over the ${MAX_LATTICE_POINTS} limit; lower density (expected count = density * ${dims === 2 ? "area" : "volume"} of the window) or query a smaller window`,
      );
    }

    // Pass two places the points and clips them. Positions depend on
    // (cell, index) only — the window decides which cells are visited and
    // which points survive, never where a point is. The cloud is sized to
    // the pre-clip total and shrunk once at the end (resize down keeps the
    // written prefix), so the survivors are written in place.
    const geo = createPointCloud(total);
    const px = geo.attrs.point.require("P").data;
    const ps = geo.attrs.point.require("seed").data;
    let n = 0;
    sinceCheck = 0;
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cy = c0y; cy <= c1y; cy++) {
        for (let cx = c0x; cx <= c1x; cx++) {
          const h = hashCombine(seed, cx, cy, cz);
          const k = kBase + (hashFloat(hashCombine(h, 0)) < kFrac ? 1 : 0);
          for (let j = 0; j < k; j++) {
            // Rounded to f32 BEFORE the clip, so the value tested is the
            // value stored — clip the bytes you keep. Testing the f64 and
            // storing its rounding lets the two straddle a face: far from
            // the origin (where the f32 spacing grows to lattice scale)
            // that emitted points whose STORED position was outside the
            // window they were asked for, and abutting windows both
            // disowned the same point.
            const x = Math.fround((cx + hashFloat(hashCombine(h, j, 0))) * cellSize);
            const z = Math.fround((cz + hashFloat(hashCombine(h, j, 2))) * cellSize);
            if (x < minX || x >= maxX || z < minZ || z >= maxZ) continue;
            let y = Math.fround(params.height);
            if (mode === "xyz") {
              y = Math.fround((cy + hashFloat(hashCombine(h, j, 1))) * cellSize);
              if (y < minY || y >= maxY) continue;
            }
            px[n * 3] = x;
            px[n * 3 + 1] = y;
            px[n * 3 + 2] = z;
            ps[n] = hashCombine(h, j, 3);
            n++;
          }
        }
      }
      if ((sinceCheck += nx * ny) >= 4096) {
        sinceCheck = 0;
        checkCancelled();
      }
    }

    geo.attrs.point.resize(n);
    return { out: [makeGeometryItem(geo)] };
  },
});
