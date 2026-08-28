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
import {
  Group,
  type BufferGeometry,
  type InstancedMesh,
  type Object3D,
  type Points,
  type PointsMaterial,
} from "three";
import {
  deviceInstanceAttributesOf,
  type DeviceInstanceBatch,
  type DeviceTransformsHandle,
} from "../fields/index.js";
import { isDeviceResidentInstances } from "../graph/data.js";
import type { CellCoord, CellOutputs } from "../runtime/types.js";
import { toPointsObject } from "./debug.js";
import type {
  DeviceCellBounds,
  DeviceInstanceAdapter,
  DeviceInstanceContext,
} from "./deviceInstances.js";
import { materialListOf, ownsGeometry, toInstancedMeshes, type AssetMap } from "./instanced.js";
import { attempt, type TeardownFailure } from "./teardown.js";

/**
 * The device-instancing seam itself lives in `./deviceInstances.ts`,
 * because a World is one way to drive it and not the only one — see that
 * module's header. Re-exported here so an import of these three from the
 * World binding, which is where they were first published, still works.
 */
export type {
  DeviceCellBounds,
  DeviceInstanceAdapter,
  DeviceInstanceContext,
} from "./deviceInstances.js";

/** Device-resident instancing configuration for {@link WorldThreeBinding}. */
export interface DeviceInstanceBinding {
  /** Turns device batches into scene objects. */
  readonly adapter: DeviceInstanceAdapter;
  /**
   * Bounding sphere for one asset's batch in a cell, used instead of
   * `computeBoundingSphere()`. Returning undefined disables frustum
   * culling for that batch's object — correct but slower, and always
   * preferable to a sphere that is too small.
   *
   * Called **once per batch**, not once per cell. A resident spawn
   * driven by `assetAttr` puts several assets in one cell, and the
   * sphere has to cover the instances' own extent as well as the cell's:
   * with one sphere per cell every asset inherits the padding of the
   * tallest one, so a cell containing both a 200-unit landmark and
   * ground cover would draw the ground cover with a 200-unit skirt and
   * effectively stop culling it. `assetId` is the lever that fixes that
   * — pad by the radius of *that* asset. Ignoring the third argument is
   * fine and keeps the old per-cell behaviour (a two-parameter callback
   * still type-checks).
   */
  readonly bounds?: (
    levelName: string,
    coord: CellCoord,
    assetId: string,
  ) => DeviceCellBounds | undefined;
}

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
  /**
   * Opt-in support for device-resident instances items (produced by a
   * `GpuFieldEvaluator` constructed with `deviceInstances: true`).
   * Absent, such an item is an error naming both fixes rather than a
   * cell that silently draws nothing. The CPU path is unaffected either
   * way.
   */
  readonly deviceInstances?: DeviceInstanceBinding;
}

interface CellEntry {
  readonly group: Group;
  readonly instanced: InstancedMesh[];
  readonly debug: Points<BufferGeometry, PointsMaterial>[];
  /** Adapter-built objects for device-resident batches. */
  readonly device: Object3D[];
  /**
   * One entry per retain this cell took out — repeated if the same
   * handle appears twice in the cell's outputs, so releases balance. A
   * device batch contributes its transforms plus ONE handle per named
   * per-instance channel (a coloured batch has one channel, the reserved
   * `color`, so two handles in all), each refcounted on its own identity.
   */
  readonly handles: DeviceTransformsHandle[];
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
 * per-instance buffers released via `InstancedMesh.dispose()` AND their
 * material disposed — the material is a per-mesh clone `toInstancedMeshes`
 * mints, and its `dispose` event is the one signal three's renderer
 * accepts to drop the mesh's cached render state (render object, built
 * shaders, pipeline, uniform buffers; see `cloneAssetMaterial` and
 * `renderStateRelease.test.ts`). Without it a streaming world's renderer
 * caches grow by every mesh ever cooked. The asset GEOMETRY (and any
 * textures) stays shared across cells and is NOT disposed — it belongs to
 * the caller's asset map, and the clone shares those by reference. The
 * ONE exception is a mesh whose batch carried named per-instance
 * channels: those become attributes of the geometry, so
 * `toInstancedMeshes` gives that mesh a geometry clone of its own and
 * `ownsGeometry(mesh)` is true — the clone is disposed here, with the
 * mesh, because nothing else can ever reach it.
 *
 * Device-resident batches add a second disposal contract. `World` never
 * frees a `DeviceTransformsHandle` and the graph refuses to own one, so
 * this binding is the owner of last resort: it **reference-counts
 * handles by identity** across live cells and disposes a handle only
 * when the last cell holding it goes away. Identity counting is not
 * decoration — a child cell that forwards its parent's outputs
 * (`CellContext.parent.outputs` is passed by reference) holds the *same
 * handle object* as the parent cell, and disposing it when the parent
 * evicts would destroy a buffer the live child still draws from.
 *
 * The four ways a cell's handles are released:
 * - **evict** (`cellEvicted`, from radius exit or LRU trim),
 * - **recook** (`cellReady` for a cell that already has content — the
 *   new handles are retained before the old ones are released, so a
 *   handle common to both survives the swap),
 * - **partial build failure** (every handle the failed build retained is
 *   released before the error is rethrown — including the case where no
 *   `deviceInstances` adapter is configured at all), and
 * - **teardown** (`dispose`).
 *
 * What it deliberately does NOT do: free anything on a cook that never
 * reached `cellReady` (the graph's cook owns those), or free the outputs
 * `World.getCell`/`World.cells` hand out by reference — those are views
 * of a live cell, not transfers of ownership.
 */
export class WorldThreeBinding {
  private readonly opts: WorldThreeBindingOptions;
  private readonly cells = new Map<string, CellEntry>();
  /**
   * Live references per device handle, keyed by handle identity. A
   * handle reaches 0 exactly once and is disposed there; see the class
   * docs for why identity (not per-cell ownership) is the right key.
   */
  private readonly handleRefs = new Map<DeviceTransformsHandle, number>();

  constructor(opts: WorldThreeBindingOptions) {
    this.opts = opts;
  }

  /** Number of live cell groups (diagnostics/tests). */
  get cellCount(): number {
    return this.cells.size;
  }

  /**
   * Distinct device transform handles this binding currently holds — a
   * live leak meter for a streaming world. Over a sustained fly-through
   * this must reach a steady state, not climb.
   */
  get deviceHandleCount(): number {
    return this.handleRefs.size;
  }

  /**
   * Total **logical** bytes of the retained device buffers — the sum of
   * `handle.byteLength` over every distinct handle held: `instances * 64`
   * of transforms per batch, plus `instances * 16` of colour for a
   * coloured one (4 f32 per instance, the WGSL `array<vec3<f32>>`
   * stride).
   *
   * This is a lower bound on device occupancy, and a loose one. The
   * evaluator's buffer pool buckets allocations to powers of
   * two with a 256-byte floor, and a multi-asset spawn takes one buffer
   * per asset (two with colour), so a cell with four small batches pays
   * four roundings instead of one: a 3-instance batch is 192 logical
   * bytes in a 256-byte bucket, and a 20-instance batch is 1280 in 2048.
   * Use this to check that retained bytes return to zero and stay
   * bounded — that property is exact — not to read off how much VRAM is
   * in use.
   */
  get deviceHandleBytes(): number {
    let bytes = 0;
    for (const handle of this.handleRefs.keys()) bytes += handle.byteLength;
    return bytes;
  }

  /**
   * Build (or rebuild) the scene-graph content of a cooked cell. Pass
   * this into `WorldOptions.onCellReady`.
   *
   * Swap semantics: the replacement group is built completely before the
   * previous one is removed, so a throwing rebuild (e.g. an unknown
   * assetId on recook) leaves the cell's existing content visible and
   * registered — the error is rethrown after disposing whatever partial
   * resources the failed build created, with any secondary failure from
   * that cleanup attached as its `cause`.
   *
   * The mirror case is guaranteed too: if releasing the *previous*
   * content throws (a throwing `adapter.release`), the new content is
   * still registered and visible before the error propagates, so its
   * buffers stay reachable by `cellEvicted` and `dispose`.
   */
  cellReady(levelName: string, coord: CellCoord, outputs: CellOutputs): void {
    const key = cellKey(levelName, coord);
    const group = new Group();
    group.name = key;
    const entry: CellEntry = { group, instanced: [], debug: [], device: [], handles: [] };
    try {
      // Inside the guard, not before it: a retain pass that threw
      // half-way (a hostile `outputs` object, a getter with an opinion)
      // would otherwise strand exactly the handles it had already taken
      // out, with no entry in `cells` to reach them through.
      this.retainCellHandles(entry, outputs);
      for (const name of Object.keys(outputs)) {
        for (const item of outputs[name]) {
          if (item.kind === "instances") {
            // Device residency first: reading `batches` on a device item
            // throws by design, so this branch must precede it.
            if (isDeviceResidentInstances(item)) {
              this.buildDeviceBatches(entry, levelName, coord, item.deviceBatches ?? []);
            } else {
              for (const mesh of toInstancedMeshes(item.batches, this.opts.assets)) {
                entry.instanced.push(mesh);
                group.add(mesh);
              }
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
      // The build failure is the diagnosis ("unknown assetId ..."); a
      // failure while cleaning up after it is a downstream symptom. Let
      // the actionable one propagate and hang the other off it, rather
      // than replacing the cause with the consequence.
      const cleanup = attempt(undefined, () => {
        this.disposeEntry(entry);
      });
      if (cleanup !== undefined && err instanceof Error && err.cause === undefined) {
        err.cause = cleanup.err;
      }
      throw err;
    }
    // The swap is where ownership transfers, so it must not be skippable.
    // Releasing the OUTGOING cell can throw (a throwing `adapter.release`
    // propagates out of `removeCell`), and an escape here would leave the
    // INCOMING cell — every handle already retained, every object already
    // built — registered nowhere: `cellEvicted` and `dispose()` both look
    // in `cells`, so its buffers could never be freed by anything. Commit
    // first, rethrow after.
    const failure = attempt(undefined, () => {
      this.removeCell(key); // Only now replace the previous content, if any.
    });
    this.opts.group.add(group);
    this.cells.set(key, entry);
    if (failure !== undefined) throw failure.err;
  }

  /**
   * Remove an evicted cell's group and release its GPU resources (see the
   * class docs for what is and is not disposed). Pass this into
   * `WorldOptions.onCellEvicted`. Unknown cells are ignored.
   */
  cellEvicted(levelName: string, coord: CellCoord): void {
    this.removeCell(cellKey(levelName, coord));
  }

  /**
   * Remove and dispose every live cell (e.g. on teardown).
   *
   * Per cell, exactly as {@link disposeEntry} is per object, and for a
   * sharper reason: `removeCell` can throw (a throwing
   * `adapter.release` propagates out of it), and a cell abandoned at
   * teardown is an abandoned device buffer that nothing will ever free
   * — the binding is the owner of last resort and this is the last
   * resort. Every cell is torn down; the first failure is rethrown
   * afterwards.
   */
  dispose(): void {
    let failure: TeardownFailure;
    for (const key of [...this.cells.keys()]) {
      failure = attempt(failure, () => {
        this.removeCell(key);
      });
    }
    if (failure !== undefined) throw failure.err;
  }

  /**
   * Retain every device handle in the WHOLE cell before any build runs.
   *
   * Scope is the point: retaining per item, as each device item is
   * reached, strands a later item's handles whenever an earlier one
   * throws — `toInstancedMeshes` throws on an unknown assetId or a
   * transform-length mismatch, and the debug-points branch can throw
   * too. Nothing else in the library would ever free them: `World`
   * stores outputs and disposes nothing, and the graph transferred
   * ownership at delivery. Retaining up front means the catch in
   * `cellReady` releases every handle the cell carried, whatever failed
   * and wherever. That includes the misconfigured case (no
   * `deviceInstances` adapter) — an unrenderable buffer is still a
   * buffer, and leaking one per cook is worse than freeing one that was
   * never going to be drawn.
   *
   * **The pass itself can throw, and must not abandon what it has not
   * reached yet.** `deviceInstanceAttributesOf` refuses a batch whose two
   * colour spellings hold DIFFERENT handles (see the per-instance channel
   * section of `docs/authoring.md`), so a single malformed hand-built
   * batch used to end the pass where it stood — stranding its own
   * transforms and every handle of every batch and item after it. That is
   * the same invariant `./teardown.ts` states for the release paths, read
   * in the other direction: every step runs, the bookkeeping is
   * committed, and only then does the first failure propagate to
   * `cellReady`'s catch, which releases everything the pass retained.
   */
  private retainCellHandles(entry: CellEntry, outputs: CellOutputs): void {
    let failure: TeardownFailure;
    for (const name of Object.keys(outputs)) {
      for (const item of outputs[name]) {
        // Residency first: reading `batches` on a device item throws by
        // design, so this test must precede any other item access.
        if (item.kind !== "instances" || !isDeviceResidentInstances(item)) continue;
        for (const batch of item.deviceBatches ?? []) {
          failure = attempt(failure, () => {
            this.retainBatchHandles(entry, batch);
          });
        }
      }
    }
    if (failure !== undefined) throw failure.err;
  }

  /**
   * Retain every handle of ONE device batch.
   *
   * Every handle the batch carries, not just the transforms: each
   * per-instance channel is a separate allocation with a separate handle,
   * and the device path has no GC behind it. Missing one here leaks a
   * buffer per channel per batch per cook — silently, because nothing
   * else in the library will ever free it. The channels are enumerated
   * through `deviceInstanceAttributesOf` and NOT alongside
   * `batch.colors`: colour is a channel IN that record (an accessor over
   * it), so counting both would retain one handle twice.
   *
   * **`transforms` is retained BEFORE that call, and the order is the
   * point.** The normalizer throws on a batch carrying two different
   * colour handles, and `transforms` is reachable without asking it
   * anything — retained after, a refused batch's largest buffer would be
   * stranded by the very check that noticed the batch was malformed.
   */
  private retainBatchHandles(entry: CellEntry, batch: DeviceInstanceBatch): void {
    this.retainOne(entry, batch.transforms);
    let handles: readonly DeviceTransformsHandle[];
    try {
      handles = Object.values(deviceInstanceAttributesOf(batch)).map((c) => c.handle);
    } catch (err) {
      // Refused: there is no normalized record, so fall back to the raw
      // reachable set (see `reachableHandles`) to keep the batch's colour
      // buffers freeable. That sweep is itself guarded — a hostile
      // `attributes` getter must not replace the diagnosis with the
      // symptom — and the refusal is what propagates either way.
      attempt(undefined, () => {
        for (const handle of reachableHandles(batch)) this.retainOne(entry, handle);
      });
      throw err;
    }
    for (const handle of handles) this.retainOne(entry, handle);
  }

  /** Record one retain against the cell, so `disposeEntry` can balance it. */
  private retainOne(entry: CellEntry, handle: DeviceTransformsHandle): void {
    entry.handles.push(handle);
    this.retainHandle(handle);
  }

  /** Build the adapter objects for one device item's batches. */
  private buildDeviceBatches(
    entry: CellEntry,
    levelName: string,
    coord: CellCoord,
    batches: readonly DeviceInstanceBatch[],
  ): void {
    const dev = this.opts.deviceInstances;
    if (dev === undefined) {
      const count = batches.reduce((n, b) => n + b.count, 0);
      throw new Error(
        `WorldThreeBinding: cell "${cellKey(levelName, coord)}" produced a device-resident ` +
          `instances item (${batches.length} batch(es), ${count} instances) but no ` +
          "`deviceInstances` adapter is configured. Pass `deviceInstances: { adapter, bounds }` " +
          "(see createWebGpuInstanceAdapter) to draw from the device buffers, or construct the " +
          "GpuFieldEvaluator without `deviceInstances: true` to get CPU batches back",
      );
    }
    for (const batch of batches) {
      // Per batch, not hoisted: `bounds` is asked per asset so a cell
      // holding several assets can cull each by its own extent. N is the
      // asset count of one cell (single digits), so the extra calls are
      // not a hot path.
      const ctx: DeviceInstanceContext = {
        levelName,
        coord,
        bounds: dev.bounds?.(levelName, coord, batch.assetId),
      };
      const object = dev.adapter.build(batch, ctx);
      entry.device.push(object);
      entry.group.add(object);
    }
  }

  private retainHandle(handle: DeviceTransformsHandle): void {
    this.handleRefs.set(handle, (this.handleRefs.get(handle) ?? 0) + 1);
  }

  /** Drop one reference; dispose at zero. Never disposes a shared handle. */
  private releaseHandle(handle: DeviceTransformsHandle): void {
    const refs = this.handleRefs.get(handle);
    if (refs === undefined) return;
    if (refs > 1) {
      this.handleRefs.set(handle, refs - 1);
      return;
    }
    this.handleRefs.delete(handle);
    // Idempotent by contract, but skipping an already-disposed handle
    // keeps a caller-side dispose from looking like a double free.
    if (!handle.disposed) handle.dispose();
  }

  private removeCell(key: string): void {
    const entry = this.cells.get(key);
    if (!entry) return;
    this.cells.delete(key);
    this.opts.group.remove(entry.group);
    this.disposeEntry(entry);
  }

  private disposeEntry(entry: CellEntry): void {
    // Every step below is attempted and none is skippable: an entry only
    // reaches this function once it is already unreachable from `cells`,
    // so anything an early throw skipped is a resource nothing in the
    // process could ever free. The first failure is rethrown at the end;
    // the rest are suppressed, since only one error can propagate and the
    // first is the one with a live cause.
    let failure: TeardownFailure;
    // Releases the per-mesh instance buffers AND the per-mesh material
    // clones; shared asset geometry is intentionally left alone. The
    // material dispose is not optional hygiene: firing its `dispose`
    // event is the only way three's renderer releases the mesh's cached
    // render state (render object, node builder state, pipeline,
    // programs, uniform buffers) — skip it and a streaming world's
    // renderer caches climb by ~one shader program per mesh per cook,
    // forever. Every step is guarded for the same reason the device
    // section below is: `InstancedMesh.dispose()` and
    // `Material.dispose()` each dispatch a `dispose` event before doing
    // anything else, and a listener (three's own renderer bookkeeping,
    // or a caller's) may throw — which would otherwise abort teardown
    // *above* the device section and strand every one of the cell's GPU
    // buffers.
    for (const mesh of entry.instanced) {
      failure = attempt(failure, () => mesh.dispose());
      for (const material of materialListOf(mesh.material)) {
        failure = attempt(failure, () => material.dispose());
      }
      // ONLY a per-batch geometry clone, which `toInstancedMeshes` mints
      // for a batch carrying named per-instance channels because those
      // become attributes of the geometry (see `ownsGeometry`). The
      // asset map's shared geometry is left alone — disposing it would
      // break every other cell drawing the same asset. Its own guarded
      // step for the reason the whole block is guarded: a `dispose`
      // listener that throws must not strand the device buffers below.
      if (ownsGeometry(mesh)) failure = attempt(failure, () => mesh.geometry.dispose());
    }
    // Debug points own their geometry and material — created per cell.
    for (const points of entry.debug) {
      failure = attempt(failure, () => points.geometry.dispose());
      failure = attempt(failure, () => points.material.dispose());
    }
    entry.instanced.length = 0;
    entry.debug.length = 0;
    // Device batches: the renderer-side objects go first (destroying a
    // buffer a live bind group still points at would fault on the next
    // draw), and the handle releases run in a `finally` so a throwing
    // adapter can never strand a device buffer.
    //
    // Each object is released in its own attempt. A cell holds one object
    // per asset, so with a multi-asset spawn a single throwing release
    // would otherwise abandon every *later* batch's object — their
    // buffers still freed by the `finally`, but their meshes never
    // disposed and the adapter's live-instance meter permanently high.
    const dev = this.opts.deviceInstances;
    const objects = entry.device.splice(0, entry.device.length);
    const handles = entry.handles.splice(0, entry.handles.length);
    try {
      if (dev !== undefined) {
        for (const object of objects) {
          failure = attempt(failure, () => dev.adapter.release(object));
        }
      }
    } finally {
      for (const handle of handles) this.releaseHandle(handle);
    }
    if (failure !== undefined) throw failure.err;
  }
}

function cellKey(levelName: string, coord: CellCoord): string {
  return `${levelName}|${coord.join(",")}`;
}

/**
 * Every device handle the batch REACHES, deduplicated by identity — the
 * raw set, not the normalized one.
 *
 * Only for the path where {@link deviceInstanceAttributesOf} refused the
 * batch and there is therefore no normalized record to enumerate. The
 * normalizer is still the authority everywhere else, and deliberately so:
 * it counts the reserved colour channel exactly once, which is the whole
 * reason a caller must not walk `attributes` and `colors` side by side.
 *
 * Here the two spellings are known to disagree (that is what the refusal
 * says), so walking both is not double-counting: the `Set` collapses them
 * whenever they are the same object and keeps both when they are not.
 * The batch is being discarded either way — a buffer nothing in this
 * process will ever free is worse than one freed a moment early.
 */
function reachableHandles(batch: DeviceInstanceBatch): DeviceTransformsHandle[] {
  const seen = new Set<DeviceTransformsHandle>();
  if (batch.colors !== undefined) seen.add(batch.colors);
  for (const channel of Object.values(batch.attributes ?? {})) seen.add(channel.handle);
  return [...seen];
}
