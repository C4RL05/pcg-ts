/**
 * Wire a hierarchical-runtime World to a three.js scene graph: one child
 * Group per live cell, holding instanced meshes (from instances items)
 * and optional debug points (from geometry items).
 *
 * The binding deliberately does not import the runtime — pass its methods
 * into the World's callbacks yourself:
 *
 * ```ts
 * const binding = new WorldThreeBinding({ group, assets });
 * const world = new World({
 *   ...,
 *   onCellReady: (level, coord, outputs) => binding.cellReady(level, coord, outputs),
 *   onCellEvicted: (level, coord) => binding.cellEvicted(level, coord),
 * });
 * ```
 */
import { Group, type InstancedMesh, type BufferGeometry, type Points, type PointsMaterial } from "three";
import type { CellCoord, CellOutputs } from "../runtime/types.js";
import { toPointsObject } from "./debug.js";
import { toInstancedMeshes, type AssetMap } from "./instanced.js";

/** Options for {@link WorldThreeBinding}. */
export interface WorldThreeBindingOptions {
  /** Parent group all per-cell groups are added under. */
  readonly group: Group;
  /** Asset lookup for instances items (see {@link toInstancedMeshes}). */
  readonly assets: AssetMap;
  /** Also render geometry items as debug THREE.Points (default false). */
  readonly debugPoints?: boolean;
  /** Debug point size in world units (default 0.1). */
  readonly debugPointSize?: number;
}

interface CellEntry {
  readonly group: Group;
  readonly instanced: InstancedMesh[];
  readonly debug: Points<BufferGeometry, PointsMaterial>[];
}

/**
 * Per-cell scene-graph lifecycle for a World.
 *
 * `cellReady` builds a child Group named `level|cx,cz` from the cell's
 * outputs (replacing any previous group for the same cell on recook);
 * `cellEvicted` removes it and releases GPU resources.
 *
 * Disposal contract: debug-point geometry and material are created per
 * cell and are disposed on evict. Instanced meshes have their
 * per-instance buffers released via `InstancedMesh.dispose()`, but the
 * asset geometry and material they reference are shared across cells and
 * are NOT disposed — they belong to the caller's asset map.
 */
export class WorldThreeBinding {
  private readonly opts: WorldThreeBindingOptions;
  private readonly cells = new Map<string, CellEntry>();

  constructor(opts: WorldThreeBindingOptions) {
    this.opts = opts;
  }

  /** Number of live cell groups (diagnostics/tests). */
  get cellCount(): number {
    return this.cells.size;
  }

  /**
   * Build (or rebuild) the scene-graph content of a cooked cell. Pass
   * this into `WorldOptions.onCellReady`.
   *
   * Swap semantics: the replacement group is built completely before the
   * previous one is removed, so a throwing rebuild (e.g. an unknown
   * assetId on recook) leaves the cell's existing content visible and
   * registered — the error is rethrown after disposing whatever partial
   * resources the failed build created.
   */
  cellReady(levelName: string, coord: CellCoord, outputs: CellOutputs): void {
    const key = cellKey(levelName, coord);
    const group = new Group();
    group.name = key;
    const entry: CellEntry = { group, instanced: [], debug: [] };
    try {
      for (const name of Object.keys(outputs)) {
        for (const item of outputs[name]) {
          if (item.kind === "instances") {
            for (const mesh of toInstancedMeshes(item.batches, this.opts.assets)) {
              entry.instanced.push(mesh);
              group.add(mesh);
            }
          } else if (item.kind === "geometry" && this.opts.debugPoints === true) {
            const points = toPointsObject(item.geo, {
              size: this.opts.debugPointSize ?? 0.1,
            });
            entry.debug.push(points);
            group.add(points);
          }
        }
      }
    } catch (err) {
      this.disposeEntry(entry);
      throw err;
    }
    this.removeCell(key); // Only now replace the previous content, if any.
    this.opts.group.add(group);
    this.cells.set(key, entry);
  }

  /**
   * Remove an evicted cell's group and release its GPU resources (see the
   * class docs for what is and is not disposed). Pass this into
   * `WorldOptions.onCellEvicted`. Unknown cells are ignored.
   */
  cellEvicted(levelName: string, coord: CellCoord): void {
    this.removeCell(cellKey(levelName, coord));
  }

  /** Remove and dispose every live cell (e.g. on teardown). */
  dispose(): void {
    for (const key of [...this.cells.keys()]) this.removeCell(key);
  }

  private removeCell(key: string): void {
    const entry = this.cells.get(key);
    if (!entry) return;
    this.cells.delete(key);
    this.opts.group.remove(entry.group);
    this.disposeEntry(entry);
  }

  private disposeEntry(entry: CellEntry): void {
    // Releases the per-mesh instance buffers; shared asset geometry and
    // material are intentionally left alone.
    for (const mesh of entry.instanced) mesh.dispose();
    // Debug points own their geometry and material — created per cell.
    for (const points of entry.debug) {
      points.geometry.dispose();
      points.material.dispose();
    }
  }
}

function cellKey(levelName: string, coord: CellCoord): string {
  return `${levelName}|${coord.join(",")}`;
}
