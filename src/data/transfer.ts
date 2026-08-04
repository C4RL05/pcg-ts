import type { Attribute, AttributeSet } from "./attribute.js";
import type { Geometry } from "./geometry.js";
import type { AttrData, AttrDefault } from "./types.js";

/** Options for {@link transferNearest}. */
export interface TransferNearestOptions {
  /**
   * Uniform grid cell size. Derived from the source bounds and point count
   * when omitted. Treated as a hint: raised if it would make the grid
   * exceed its maximum resolution.
   */
  cellSize?: number;
  /** Position attribute name on both geometries (default "P", f32, tupleSize >= 3). */
  positionAttr?: string;
  /**
   * Source point counts below this use the brute-force path (default 32).
   * Pass 0 to force the grid path.
   */
  bruteForceThreshold?: number;
}

/** Grid resolution cap per axis; keeps linear cell keys exact in float64. */
const MAX_DIM = 2048;

function requirePosition(
  set: AttributeSet,
  name: string,
  label: string,
): { data: Float32Array; stride: number } {
  const attr = set.get(name);
  if (!attr) {
    throw new Error(`transferNearest: ${label} is missing position attribute "${name}"`);
  }
  if (attr.type !== "f32" || attr.tupleSize < 3) {
    throw new Error(
      `transferNearest: ${label} position attribute "${name}" must be f32 with tupleSize >= 3`,
    );
  }
  return { data: attr.data as Float32Array, stride: attr.tupleSize };
}

/** Pick a cell size targeting a few points per occupied cell. */
function deriveCellSize(ex: number, ey: number, ez: number, count: number): number {
  let volume = 1;
  let axes = 0;
  for (const e of [ex, ey, ez]) {
    if (e > 0) {
      volume *= e;
      axes++;
    }
  }
  if (axes === 0) return 1;
  const cell = Math.pow(volume / count, 1 / axes) * 2;
  return Number.isFinite(cell) && cell > 0 ? cell : 1;
}

function nearestBrute(
  sp: Float32Array,
  ss: number,
  ns: number,
  dp: Float32Array,
  ds: number,
  nd: number,
): Uint32Array {
  const result = new Uint32Array(nd);
  for (let j = 0; j < nd; j++) {
    const qx = dp[j * ds];
    const qy = dp[j * ds + 1];
    const qz = dp[j * ds + 2];
    let best = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < ns; i++) {
      const dx = sp[i * ss] - qx;
      const dy = sp[i * ss + 1] - qy;
      const dz = sp[i * ss + 2] - qz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) {
        best = d2;
        bestIdx = i;
      }
    }
    result[j] = bestIdx;
  }
  return result;
}

function nearestGrid(
  sp: Float32Array,
  ss: number,
  ns: number,
  dp: Float32Array,
  ds: number,
  nd: number,
  cellSizeHint: number | undefined,
): Uint32Array {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < ns; i++) {
    const x = sp[i * ss];
    const y = sp[i * ss + 1];
    const z = sp[i * ss + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const ex = maxX - minX;
  const ey = maxY - minY;
  const ez = maxZ - minZ;
  let cell = cellSizeHint ?? deriveCellSize(ex, ey, ez, ns);
  if (!Number.isFinite(cell) || cell <= 0) {
    throw new Error("transferNearest: cellSize must be a positive finite number");
  }
  cell = Math.max(cell, ex / MAX_DIM, ey / MAX_DIM, ez / MAX_DIM);
  const nx = Math.floor(ex / cell) + 1;
  const ny = Math.floor(ey / cell) + 1;
  const nz = Math.floor(ez / cell) + 1;

  // Bucket source points by cell (linear key; exact — dims are capped).
  const cells = new Map<number, number[]>();
  for (let i = 0; i < ns; i++) {
    const cx = Math.min(nx - 1, Math.floor((sp[i * ss] - minX) / cell));
    const cy = Math.min(ny - 1, Math.floor((sp[i * ss + 1] - minY) / cell));
    const cz = Math.min(nz - 1, Math.floor((sp[i * ss + 2] - minZ) / cell));
    const key = cx + nx * (cy + ny * cz);
    let bucket = cells.get(key);
    if (!bucket) {
      bucket = [];
      cells.set(key, bucket);
    }
    bucket.push(i);
  }

  const result = new Uint32Array(nd);
  for (let j = 0; j < nd; j++) {
    const qx = dp[j * ds];
    const qy = dp[j * ds + 1];
    const qz = dp[j * ds + 2];
    // Query cell coordinates, deliberately unclamped (queries may lie
    // outside the source bounds).
    const qcx = Math.floor((qx - minX) / cell);
    const qcy = Math.floor((qy - minY) / cell);
    const qcz = Math.floor((qz - minZ) / cell);
    // Chebyshev radius that covers every grid cell from the query cell.
    const maxR = Math.max(
      Math.abs(qcx),
      Math.abs(nx - 1 - qcx),
      Math.abs(qcy),
      Math.abs(ny - 1 - qcy),
      Math.abs(qcz),
      Math.abs(nz - 1 - qcz),
    );
    let best = Infinity;
    let bestIdx = -1;
    for (let r = 0; r <= maxR; r++) {
      if (bestIdx >= 0) {
        // Any point in a ring-r cell is at least (r-1)*cell away; stop
        // once that lower bound strictly exceeds the best distance (>=
        // keeps scanning so equal-distance ties resolve by lowest index).
        const bound = (r - 1) * cell;
        if (bound > 0 && bound * bound > best) break;
      }
      const x0 = Math.max(qcx - r, 0);
      const x1 = Math.min(qcx + r, nx - 1);
      const y0 = Math.max(qcy - r, 0);
      const y1 = Math.min(qcy + r, ny - 1);
      const z0 = Math.max(qcz - r, 0);
      const z1 = Math.min(qcz + r, nz - 1);
      for (let cx = x0; cx <= x1; cx++) {
        const adx = Math.abs(cx - qcx);
        for (let cy = y0; cy <= y1; cy++) {
          const ady = Math.abs(cy - qcy);
          for (let cz = z0; cz <= z1; cz++) {
            // Only the shell at Chebyshev distance r (inner cells were
            // scanned in earlier rings).
            if (Math.max(adx, ady, Math.abs(cz - qcz)) !== r) continue;
            const bucket = cells.get(cx + nx * (cy + ny * cz));
            if (!bucket) continue;
            for (const i of bucket) {
              const dx = sp[i * ss] - qx;
              const dy = sp[i * ss + 1] - qy;
              const dz = sp[i * ss + 2] - qz;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 < best || (d2 === best && i < bestIdx)) {
                best = d2;
                bestIdx = i;
              }
            }
          }
        }
      }
    }
    if (bestIdx < 0) {
      throw new Error("transferNearest: grid search found no point (internal error)");
    }
    result[j] = bestIdx;
  }
  return result;
}

/**
 * Transfer a point-domain attribute from `src` to `dst` by nearest source
 * point in 3D (positions read from the `P` attribute by default). Uses a
 * uniform grid hash for the lookup (brute force below a small source
 * count); distance ties resolve to the lowest source point index. Creates
 * or overwrites the attribute on `dst`'s point domain and returns it.
 */
export function transferNearest(
  dst: Geometry,
  src: Geometry,
  attrName: string,
  options: TransferNearestOptions = {},
): Attribute {
  const positionAttr = options.positionAttr ?? "P";
  const srcPoints = src.attrs.point;
  const dstPoints = dst.attrs.point;
  const srcAttr = srcPoints.get(attrName);
  if (!srcAttr) {
    throw new Error(`transferNearest: attribute "${attrName}" not found on source point domain`);
  }
  const ns = srcPoints.count;
  if (ns === 0) {
    throw new Error("transferNearest: source has no points");
  }
  const nd = dstPoints.count;
  const srcP = requirePosition(srcPoints, positionAttr, "source");
  const dstP = requirePosition(dstPoints, positionAttr, "destination");

  const threshold = options.bruteForceThreshold ?? 32;
  const nearest =
    ns < threshold
      ? nearestBrute(srcP.data, srcP.stride, ns, dstP.data, dstP.stride, nd)
      : nearestGrid(srcP.data, srcP.stride, ns, dstP.data, dstP.stride, nd, options.cellSize);

  const ts = srcAttr.tupleSize;
  // Snapshot source values if replacing the attribute would clobber them
  // (transfer onto the same geometry/attribute).
  let readData: AttrData = srcAttr.data;
  let readStrings: readonly string[] = srcAttr.stringTable;
  if (dstPoints.get(attrName) === srcAttr) {
    readData = srcAttr.data.slice(0, ns * ts);
    readStrings = srcAttr.stringTable.slice();
  }

  const out = dstPoints.replace(
    attrName,
    srcAttr.type,
    srcAttr.tupleSize,
    srcAttr.defaultValue as AttrDefault,
  );
  if (srcAttr.type === "string") {
    for (let j = 0; j < nd; j++) {
      const so = nearest[j] * ts;
      for (let k = 0; k < ts; k++) {
        out.setString(j, readStrings[readData[so + k]] ?? "", k);
      }
    }
    return out;
  }
  const outData = out.data;
  for (let j = 0; j < nd; j++) {
    const so = nearest[j] * ts;
    const dofs = j * ts;
    for (let k = 0; k < ts; k++) outData[dofs + k] = readData[so + k];
  }
  return out;
}
