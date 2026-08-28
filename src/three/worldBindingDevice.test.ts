/**
 * Lifetime tests for `WorldThreeBinding`'s device-resident branch.
 *
 * Nothing here needs a GPU or three's WebGPU build: a device batch is
 * just an `assetId`/`count` and a disposable handle, and the adapter is
 * an interface. What is under test is ownership — every way a World can
 * hand the binding a device handle and every way that handle can stop
 * being reachable.
 *
 * The cases are the disposal sites of `src/runtime/world.ts`, named in
 * the test titles: new record, recook overwrite (the highest-frequency
 * one), stale cascades, radius-exit eviction, LRU trim, the unbounded
 * level that never evicts, a throwing `onCellReady`, `onCellEvicted`
 * arriving with no outputs, teardown, and — the sharpest — `parentFor`
 * aliasing a parent cell's outputs into its children, where the SAME
 * handle object is reachable from two live cells and disposing on
 * parent eviction would be a use-after-free.
 */
import {
  BoxGeometry,
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  Points,
  type BufferGeometry,
  type PointsMaterial,
} from "three";
import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import type { DeviceInstanceBatch, DeviceTransformsHandle } from "../fields/index.js";
import {
  Graph,
  makeGeometryItem,
  makeInstancesItem,
  type DataItem,
} from "../graph/index.js";
import { makeDeviceInstancesItem } from "../graph/data.js";
import { dataInput, World } from "../runtime/index.js";
import type { CellCoord, CellOutputs, LevelDef } from "../runtime/types.js";
import { buildInstanceBatches } from "../spawn/instances.js";
import { WorldThreeBinding, type DeviceInstanceAdapter } from "./worldBinding.js";

// -- fakes -----------------------------------------------------------------

interface FakeHandle extends DeviceTransformsHandle {
  readonly disposeCalls: number;
}

/** A handle with the real contract: idempotent dispose, throwing resource. */
function makeHandle(count: number, label = "h", bytesPer = 64): FakeHandle {
  let disposed = false;
  let disposeCalls = 0;
  return {
    backend: "webgpu",
    byteLength: count * bytesPer,
    get disposed() {
      return disposed;
    },
    get disposeCalls() {
      return disposeCalls;
    },
    get resource() {
      if (disposed) throw new Error(`${label} disposed`);
      return { label };
    },
    dispose() {
      disposeCalls++;
      disposed = true;
    },
  };
}

function makeBatch(assetId: string, count: number, handle?: FakeHandle): DeviceInstanceBatch {
  return {
    residency: "device",
    assetId,
    count,
    transforms: handle ?? makeHandle(count, assetId),
  };
}

/**
 * A coloured batch: TWO handles, and a colour buffer at 16 bytes per
 * instance (the WGSL `array<vec3<f32>>` stride) so a mis-accounted one
 * shows up in `deviceHandleBytes` as a wrong number rather than a wrong
 * multiple of 64.
 */
function makeColouredBatch(
  assetId: string,
  count: number,
  transforms?: FakeHandle,
  colors?: FakeHandle,
): DeviceInstanceBatch & { transforms: FakeHandle; colors: FakeHandle } {
  return {
    residency: "device",
    assetId,
    count,
    transforms: transforms ?? makeHandle(count, assetId),
    colors: colors ?? makeHandle(count, `${assetId}-colour`, 16),
  };
}

function deviceOutputs(...batches: DeviceInstanceBatch[]): CellOutputs {
  return { main: [makeDeviceInstancesItem(batches)] };
}

interface FakeAdapter extends DeviceInstanceAdapter {
  /** Objects built, in order. */
  readonly built: Object3D[];
  /** Objects released, in order. */
  readonly released: Object3D[];
  /** Handles seen as already-disposed at release time — must stay empty. */
  readonly releasedAfterDispose: string[];
  /** Bounds each build saw, keyed by cell. */
  readonly boundsSeen: (string | undefined)[];
  /** Throw from `build` for this asset id. */
  failBuild?: string;
  /** Throw from `release` for this asset id. */
  failRelease?: string;
}

function makeAdapter(): FakeAdapter {
  const handles = new WeakMap<Object3D, DeviceTransformsHandle>();
  const adapter: FakeAdapter = {
    built: [],
    released: [],
    releasedAfterDispose: [],
    boundsSeen: [],
    build(batch, ctx) {
      adapter.boundsSeen.push(
        ctx.bounds === undefined ? undefined : `${ctx.bounds.center.join(",")}@${ctx.bounds.radius}`,
      );
      if (adapter.failBuild === batch.assetId) {
        throw new Error(`adapter build failed for "${batch.assetId}"`);
      }
      // Reading `resource` is what a real adapter does first; a disposed
      // handle must never reach here.
      void batch.transforms.resource;
      const object = new Object3D();
      object.name = `${ctx.levelName}|${ctx.coord.join(",")}/${batch.assetId}`;
      handles.set(object, batch.transforms);
      adapter.built.push(object);
      return object;
    },
    release(object) {
      adapter.released.push(object);
      const handle = handles.get(object);
      // Ordering invariant: three-side teardown happens while the buffer
      // is still alive, never after it has been destroyed.
      if (handle?.disposed === true) adapter.releasedAfterDispose.push(object.name);
      if (adapter.failRelease !== undefined && object.name.endsWith(`/${adapter.failRelease}`)) {
        throw new Error(`adapter release failed for "${object.name}"`);
      }
    },
  };
  return adapter;
}

function makeBinding(adapter: DeviceInstanceAdapter, bounds?: WorldBounds) {
  const root = new Group();
  const binding = new WorldThreeBinding({
    group: root,
    assets: {},
    deviceInstances: bounds === undefined ? { adapter } : { adapter, bounds },
  });
  return { root, binding };
}

type WorldBounds = NonNullable<
  ConstructorParameters<typeof WorldThreeBinding>[0]["deviceInstances"]
>["bounds"];

// -- site 1: a new cell record ---------------------------------------------

describe("device batches: first cook (world.ts cookCell, new record)", () => {
  it("builds one object per batch, retains every handle, disposes none", () => {
    const adapter = makeAdapter();
    const { root, binding } = makeBinding(adapter);
    const a = makeHandle(4, "a");
    const b = makeHandle(6, "b");
    binding.cellReady("rocks", [1, 2], deviceOutputs(makeBatch("x", 4, a), makeBatch("y", 6, b)));

    expect(binding.cellCount).toBe(1);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].children).toHaveLength(2);
    expect(adapter.built.map((o) => o.name)).toEqual(["rocks|1,2/x", "rocks|1,2/y"]);
    expect(binding.deviceHandleCount).toBe(2);
    expect(binding.deviceHandleBytes).toBe(4 * 64 + 6 * 64);
    expect(a.disposed).toBe(false);
    expect(b.disposed).toBe(false);
  });

  it("passes the cell's out-of-band bounds through to the adapter", () => {
    const adapter = makeAdapter();
    // `?? 0` because a CellCoord may now be a 1-tuple (a `"path"` level's
    // sector index). Every cell in this suite is an `"xz"` cell, so the
    // fallback is unreachable — it is here to keep the narrowing local
    // rather than to handle a case these tests exercise.
    const { binding } = makeBinding(adapter, (level, coord) =>
      level === "rocks"
        ? { center: [coord[0] * 10, 0, (coord[1] ?? 0) * 10], radius: 9 }
        : undefined,
    );
    binding.cellReady("rocks", [2, 3], deviceOutputs(makeBatch("x", 2)));
    binding.cellReady("landmarks", [0, 0], deviceOutputs(makeBatch("y", 2)));
    expect(adapter.boundsSeen).toEqual(["20,0,30@9", undefined]);
  });

  it("a batch with no instances still has its handle owned and released", () => {
    const adapter = makeAdapter();
    const { binding } = makeBinding(adapter);
    const empty = makeHandle(0, "empty");
    binding.cellReady("rocks", [0, 0], deviceOutputs(makeBatch("x", 0, empty)));
    expect(binding.deviceHandleCount).toBe(1);
    binding.cellEvicted("rocks", [0, 0]);
    expect(empty.disposed).toBe(true);
  });
});

// -- phase 45: a coloured batch carries a SECOND handle ---------------------

/**
 * The device path has no GC. A batch's colour buffer is a separate
 * allocation behind a separate handle, so every ownership rule the
 * transforms handle gets — retain up front, refcount by identity,
 * dispose at zero, release on every failure path — has to apply to it as
 * well, and a binding that retained only `transforms` would leak exactly
 * one buffer per coloured batch per cook. Silently: nothing else in the
 * library will ever free one.
 */
describe("device batches: per-instance colour (a second handle per batch)", () => {
  it("retains both handles, and evicting disposes both exactly once", () => {
    const adapter = makeAdapter();
    const { binding } = makeBinding(adapter);
    const t = makeHandle(4, "t");
    const c = makeHandle(4, "c", 16);
    binding.cellReady("rocks", [1, 2], deviceOutputs(makeColouredBatch("x", 4, t, c)));

    // Two distinct handles from ONE batch, both counted.
    expect(binding.deviceHandleCount).toBe(2);
    expect(binding.deviceHandleBytes).toBe(4 * 64 + 4 * 16);
    expect(t.disposed).toBe(false);
    expect(c.disposed).toBe(false);

    binding.cellEvicted("rocks", [1, 2]);
    expect(t.disposed).toBe(true);
    expect(c.disposed).toBe(true);
    expect(t.disposeCalls).toBe(1);
    expect(c.disposeCalls).toBe(1);
    expect(binding.deviceHandleCount).toBe(0);
    expect(binding.deviceHandleBytes).toBe(0);
  });

  it("a recook disposes the previous colour buffer too, and does not climb", () => {
    const adapter = makeAdapter();
    const { binding } = makeBinding(adapter);
    const handles: FakeHandle[] = [];
    for (let i = 0; i < 20; i++) {
      const t = makeHandle(3, `t${i}`);
      const c = makeHandle(3, `c${i}`, 16);
      handles.push(t, c);
      binding.cellReady("landmarks", [0, 0], deviceOutputs(makeColouredBatch("x", 3, t, c)));
      // Steady state at two, never four: a leaked colour handle would
      // make this climb by one per cook.
      expect(binding.deviceHandleCount, `cook ${i}`).toBe(2);
      expect(binding.deviceHandleBytes, `cook ${i}`).toBe(3 * 64 + 3 * 16);
    }
    expect(handles.slice(0, 38).every((h) => h.disposed)).toBe(true);
    binding.dispose();
    expect(handles.every((h) => h.disposed && h.disposeCalls === 1)).toBe(true);
  });

  it("refcounts the colour handle on its own identity, like the transforms one", () => {
    // Parent/child aliasing: two live cells hold the same batch object,
    // so BOTH handles are shared and neither may be freed while either
    // cell is alive. A colour handle counted per cell instead of per
    // identity would be destroyed under a live child.
    const adapter = makeAdapter();
    const { binding } = makeBinding(adapter);
    const batch = makeColouredBatch("x", 5);
    const outputs = deviceOutputs(batch);
    binding.cellReady("region", [0, 0], outputs);
    binding.cellReady("detail", [0, 0], outputs);
    expect(binding.deviceHandleCount).toBe(2); // two handles, two cells each

    binding.cellEvicted("region", [0, 0]);
    expect(batch.transforms.disposed, "the child still draws from it").toBe(false);
    expect(batch.colors.disposed, "...and from its colours").toBe(false);
    expect(binding.deviceHandleCount).toBe(2);

    binding.cellEvicted("detail", [0, 0]);
    expect(batch.transforms.disposed).toBe(true);
    expect(batch.colors.disposed).toBe(true);
    expect(batch.colors.disposeCalls).toBe(1);
  });

  it("a build that throws mid-cell still releases the colour buffers it retained", () => {
    // Retention is per CELL and happens before any build, so a later
    // batch's failure cannot strand an earlier batch's colour buffer —
    // or its own.
    const adapter = makeAdapter();
    const { binding } = makeBinding(adapter);
    adapter.failBuild = "bad";
    const good = makeColouredBatch("good", 4);
    const bad = makeColouredBatch("bad", 4);
    expect(() =>
      binding.cellReady("rocks", [0, 0], deviceOutputs(good, bad)),
    ).toThrow(/adapter build failed for "bad"/);
    for (const h of [good.transforms, good.colors, bad.transforms, bad.colors]) {
      expect(h.disposed).toBe(true);
      expect(h.disposeCalls).toBe(1);
    }
    expect(binding.deviceHandleCount).toBe(0);
  });

  it("frees both even when no adapter is configured to draw them", () => {
    // An unrenderable buffer is still a buffer. The misconfigured case
    // throws, and the throw must not be the reason a colour buffer leaks.
    const root = new Group();
    const binding = new WorldThreeBinding({ group: root, assets: {} });
    const batch = makeColouredBatch("x", 4);
    expect(() => binding.cellReady("rocks", [0, 0], deviceOutputs(batch))).toThrow(
      /no `deviceInstances` adapter is configured/,
    );
    expect(batch.transforms.disposed).toBe(true);
    expect(batch.colors.disposed).toBe(true);
    expect(binding.deviceHandleCount).toBe(0);
  });

  it("an uncoloured batch is unchanged: one handle, and none invented", () => {
    const adapter = makeAdapter();
    const { binding } = makeBinding(adapter);
    const batch = makeBatch("x", 4);
    binding.cellReady("rocks", [0, 0], deviceOutputs(batch));
    expect(batch.colors).toBeUndefined();
    expect(binding.deviceHandleCount).toBe(1);
    expect(binding.deviceHandleBytes).toBe(4 * 64);
  });
});

// -- sites 2, 3, 5, 12: recook overwrite and stale cascades -----------------

describe("device batches: recook (world.ts cookCell rec.outputs overwrite)", () => {
  it("onCellReady firing again disposes the previous handles and keeps one live set", () => {
    const adapter = makeAdapter();
    const { root, binding } = makeBinding(adapter);
    const first = makeHandle(4, "first");
    binding.cellReady("rocks", [0, 0], deviceOutputs(makeBatch("x", 4, first)));
    const second = makeHandle(9, "second");
    binding.cellReady("rocks", [0, 0], deviceOutputs(makeBatch("x", 9, second)));

    expect(first.disposed).toBe(true);
    expect(first.disposeCalls).toBe(1);
    expect(second.disposed).toBe(false);
    expect(binding.cellCount).toBe(1);
    expect(binding.deviceHandleCount).toBe(1);
    expect(binding.deviceHandleBytes).toBe(9 * 64);
    expect(root.children).toHaveLength(1);
    expect(adapter.released).toHaveLength(1);
    expect(adapter.releasedAfterDispose).toEqual([]);
  });

  it("repeated recooks of one cell stay at a steady state (the unbounded level, which never evicts)", () => {
    const adapter = makeAdapter();
    const { binding } = makeBinding(adapter);
    const handles: FakeHandle[] = [];
    for (let i = 0; i < 40; i++) {
      const h = makeHandle(3, `u${i}`);
      handles.push(h);
      binding.cellReady("landmarks", [0, 0], deviceOutputs(makeBatch("x", 3, h)));
      // Never more than one cook's worth retained, at any point.
      expect(binding.deviceHandleCount).toBe(1);
    }
    expect(handles.slice(0, 39).every((h) => h.disposed)).toBe(true);
    expect(handles[39].disposed).toBe(false);
    binding.dispose();
    expect(handles.every((h) => h.disposed && h.disposeCalls === 1)).toBe(true);
  });

  it("a recook that delivers the SAME handle object does not destroy it in the swap", () => {
    // Build-then-swap ordering: the new content retains before the old
    // content releases, so a handle common to both survives.
    const adapter = makeAdapter();
    const { binding } = makeBinding(adapter);
    const shared = makeHandle(5, "shared");
    binding.cellReady("rocks", [0, 0], deviceOutputs(makeBatch("x", 5, shared)));
    binding.cellReady("rocks", [0, 0], deviceOutputs(makeBatch("x", 5, shared)));
    expect(shared.disposed).toBe(false);
    expect(binding.deviceHandleCount).toBe(1);
    binding.cellEvicted("rocks", [0, 0]);
    expect(shared.disposed).toBe(true);
    expect(shared.disposeCalls).toBe(1);
  });
});

// -- site 16: parentFor aliases a parent's outputs into its children --------

describe("device batches: parent/child output aliasing (world.ts parentFor)", () => {
  it("evicting the parent does NOT dispose a handle a live child still draws from", () => {
    const adapter = makeAdapter();
    const { binding } = makeBinding(adapter);
    // `parentFor` puts the parent record's `outputs` object into the
    // child's CellContext by reference, and `dataInput` forwards items by
    // reference too — so a child that passes its parent's instances item
    // through carries the very same handle object.
    const shared = makeHandle(8, "shared");
    binding.cellReady("landmarks", [0, 0], deviceOutputs(makeBatch("mega", 8, shared)));
    binding.cellReady("rocks", [3, 4], deviceOutputs(makeBatch("mega", 8, shared)));
    expect(binding.deviceHandleCount).toBe(1);

    binding.cellEvicted("landmarks", [0, 0]);
    expect(shared.disposed, "the child still binds this buffer").toBe(false);
    expect(binding.deviceHandleCount).toBe(1);

    binding.cellEvicted("rocks", [3, 4]);
    expect(shared.disposed).toBe(true);
    expect(shared.disposeCalls).toBe(1);
    expect(binding.deviceHandleCount).toBe(0);
  });

  it("counts references, not cells: three children plus a parent release in any order", () => {
    const adapter = makeAdapter();
    const { binding } = makeBinding(adapter);
    const shared = makeHandle(2, "shared");
    binding.cellReady("landmarks", [0, 0], deviceOutputs(makeBatch("m", 2, shared)));
    for (const coord of [
      [0, 0],
      [0, 1],
      [1, 0],
    ] as const) {
      binding.cellReady("rocks", coord, deviceOutputs(makeBatch("m", 2, shared)));
    }
    expect(binding.deviceHandleCount).toBe(1);
    binding.cellEvicted("rocks", [0, 1]);
    binding.cellEvicted("landmarks", [0, 0]);
    binding.cellEvicted("rocks", [1, 0]);
    expect(shared.disposed).toBe(false);
    binding.cellEvicted("rocks", [0, 0]);
    expect(shared.disposed).toBe(true);
    expect(shared.disposeCalls).toBe(1);
  });

  it("a handle appearing twice in ONE cell's outputs balances its releases", () => {
    const adapter = makeAdapter();
    const { binding } = makeBinding(adapter);
    const shared = makeHandle(2, "twice");
    const item = makeDeviceInstancesItem([makeBatch("a", 2, shared), makeBatch("b", 2, shared)]);
    binding.cellReady("rocks", [0, 0], { main: [item], also: [item] });
    expect(binding.deviceHandleCount).toBe(1);
    expect(adapter.built).toHaveLength(4);
    binding.cellEvicted("rocks", [0, 0]);
    expect(shared.disposed).toBe(true);
    expect(shared.disposeCalls).toBe(1);
    expect(adapter.released).toHaveLength(4);
  });
});

// -- site 16 again, but driven by a REAL World -----------------------------

/** One eviction, sampled from inside the World's own eviction pass. */
interface EvictionSample {
  /** `"level|coord"` of the cell that was just released. */
  readonly cell: string;
  /** Coarse-cell keys whose handle is disposed at this instant. */
  readonly disposedAfter: string[];
  /** Distinct handles the binding still owns at this instant. */
  readonly liveHandles: number;
}

/** A two-level World whose fine graph forwards its parent cell's outputs. */
interface AliasWorld {
  readonly world: World;
  readonly binding: WorldThreeBinding;
  readonly adapter: FakeAdapter;
  /** The FIRST handle minted for each coarse cell, keyed by its coord. */
  readonly handles: Map<string, FakeHandle>;
  /** Every handle minted for each coarse cell, in batch order. */
  readonly handleSets: Map<string, FakeHandle[]>;
  readonly trace: EvictionSample[];
}

/** `"level|cx,cz"` for each reported cell id, in report order. */
function cellIds(list: readonly { level: string; coord: CellCoord }[]): string[] {
  return list.map((c) => `${c.level}|${c.coord.join(",")}`);
}

/** The transforms handle carried by a device-resident instances item. */
function handleOf(item: DataItem | undefined): DeviceTransformsHandle | undefined {
  if (item === undefined || item.kind !== "instances") return undefined;
  return item.deviceBatches?.[0]?.transforms;
}

/** The handle a coarse cell minted, or a hard failure if it never cooked. */
function coarseHandle(fixture: AliasWorld, key: string): FakeHandle {
  const handle = fixture.handles.get(key);
  if (handle === undefined) throw new Error(`coarse cell "${key}" never cooked — test is vacuous`);
  return handle;
}

/** Every handle a coarse cell minted, or a hard failure if it never cooked. */
function coarseHandles(fixture: AliasWorld, key: string): FakeHandle[] {
  const set = fixture.handleSets.get(key);
  if (set === undefined) throw new Error(`coarse cell "${key}" never cooked — test is vacuous`);
  return set;
}

/**
 * A real World with a 100-unit coarse level and a 50-unit fine level,
 * wired the way an app wires one. The coarse graph is a `dataInput`
 * emitting a device-resident instances item minted ONCE per coarse cell
 * (a fresh handle per cook would mask a leak instead of exposing it),
 * the fine graph is a `dataInput` bound to `ctx.parent.outputs`, and the
 * World's cell callbacks go straight to the binding.
 *
 * Radii are picked so the two levels' retain rings can be crossed
 * independently — that is what makes BOTH eviction orders reachable:
 * from (50,0,50) all five cells are inside; (75,0,110) is outside the
 * coarse ring (65 > 60) yet still inside one fine cell's (35 < 40); and
 * (50,0,108) is the reverse (58 < 60, 41.4 > 40).
 *
 * `batchesPerCoarseCell` is the v0.8 axis: a resident spawn driven by
 * `assetAttr` delivers one batch (and so one handle) per asset, and the
 * aliased item carries all of them, so a single fine cell can hold
 * several buffers that several other cells also hold.
 */
function makeAliasWorld(batchesPerCoarseCell = 1): AliasWorld {
  const adapter = makeAdapter();
  const root = new Group();
  const binding = new WorldThreeBinding({
    group: root,
    assets: {},
    deviceInstances: { adapter },
  });

  const handles = new Map<string, FakeHandle>();
  const handleSets = new Map<string, FakeHandle[]>();
  const coarseItems = new Map<string, readonly DataItem[]>();
  function coarseItemsFor(coord: CellCoord): readonly DataItem[] {
    const key = coord.join(",");
    let items = coarseItems.get(key);
    if (items === undefined) {
      const set: FakeHandle[] = [];
      const batches: DeviceInstanceBatch[] = [];
      for (let a = 0; a < batchesPerCoarseCell; a++) {
        // Distinct sizes so a mis-accounted buffer shows up in
        // `deviceHandleBytes` as a wrong number, not a wrong multiple.
        const handle = makeHandle(8 + a, `region-${key}-a${a}`);
        set.push(handle);
        batches.push(makeBatch(`mega${a}-${key}`, 8 + a, handle));
      }
      handleSets.set(key, set);
      handles.set(key, set[0]);
      items = [makeDeviceInstancesItem(batches)];
      coarseItems.set(key, items);
    }
    return items;
  }

  const coarseGraph = new Graph(1);
  const coarseSource = coarseGraph.add(dataInput);
  coarseGraph.output(coarseSource, "out", "mega");
  const region: LevelDef = {
    name: "region",
    cellSize: 100,
    generationRadius: 60,
    retainRadius: 60,
    graph: coarseGraph,
    bind(g, ctx) {
      g.setParam(coarseSource, "items", coarseItemsFor(ctx.coord));
    },
  };

  const fineGraph = new Graph(2);
  const fineSource = fineGraph.add(dataInput);
  fineGraph.output(fineSource, "out", "mega");
  const detail: LevelDef = {
    name: "detail",
    cellSize: 50,
    generationRadius: 40,
    retainRadius: 40,
    graph: fineGraph,
    bind(g, ctx) {
      g.setParam(fineSource, "items", ctx.parent?.outputs["mega"] ?? []);
    },
  };

  const trace: EvictionSample[] = [];
  const world = new World({
    seed: 11,
    levels: [region, detail],
    onCellReady: (level, coord, outputs) => {
      binding.cellReady(level, coord, outputs);
    },
    onCellEvicted: (level, coord) => {
      binding.cellEvicted(level, coord);
      // Sampled INSIDE the eviction loop: what matters is the state at
      // the instant of each release, not the state once the dust settles.
      trace.push({
        cell: `${level}|${coord.join(",")}`,
        disposedAfter: [...handles].filter(([, h]) => h.disposed).map(([k]) => k),
        liveHandles: binding.deviceHandleCount,
      });
    },
  });

  return { world, binding, adapter, handles, handleSets, trace };
}

describe("device batches: a real World aliasing parent outputs into children", () => {
  it("parentFor passes the parent record's outputs by reference, so ONE handle object serves five live cells", async () => {
    const fixture = makeAliasWorld();
    const stats = await fixture.world.update([50, 0, 50]);
    // Non-vacuous: the exact hierarchy has to exist before anything is
    // claimed about it — one coarse cell and the four fine cells inside it.
    expect(cellIds(stats.cooked)).toEqual([
      "region|0,0",
      "detail|0,0",
      "detail|0,1",
      "detail|1,0",
      "detail|1,1",
    ]);
    expect(stats.pending).toBe(0);

    const parentItem = fixture.world.getCell("region", [0, 0])?.outputs["mega"][0];
    expect(parentItem).toBeDefined();
    const shared = coarseHandle(fixture, "0,0");
    expect(handleOf(parentItem)).toBe(shared);

    // The claim the whole refcounting design rests on: the World hands
    // the child the very same item — and the very same handle — object,
    // never a clone.
    for (const coord of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ] as const) {
      const childItem = fixture.world.getCell("detail", coord)?.outputs["mega"][0];
      expect(childItem, `detail|${coord.join(",")} must have cooked`).toBeDefined();
      expect(childItem).toBe(parentItem);
      expect(handleOf(childItem)).toBe(shared);
    }

    // Five cells, five adapter objects, one buffer.
    expect(fixture.binding.cellCount).toBe(5);
    expect(fixture.adapter.built).toHaveLength(5);
    expect(fixture.binding.deviceHandleCount).toBe(1);
    expect(fixture.binding.deviceHandleBytes).toBe(8 * 64);
    expect(shared.disposed).toBe(false);
  });

  it("the coarse level evicting first (world.ts evicts levels coarse to fine) never frees a buffer a live child still draws", async () => {
    const fixture = makeAliasWorld();
    await fixture.world.update([50, 0, 50]);
    const shared = coarseHandle(fixture, "0,0");
    expect(fixture.binding.deviceHandleCount, "the handle must be shared, not merely alive").toBe(1);
    expect(fixture.binding.cellCount).toBe(5);

    // `maxCooksPerUpdate: 0` makes this a pure eviction pass: every
    // wanted cell is reported pending, nothing recooks, and the radius
    // sweep is the only thing that runs — so the order is exact.
    const away = await fixture.world.update([75, 0, 110], { maxCooksPerUpdate: 0 });
    expect(cellIds(away.evicted)).toEqual([
      "region|0,0",
      "detail|0,0",
      "detail|0,1",
      "detail|1,0",
    ]);
    // The parent went first, and nothing was disposed at any of the four
    // releases — one child is still holding the buffer.
    expect(fixture.trace).toHaveLength(4);
    expect(fixture.trace[0].cell).toBe("region|0,0");
    expect(fixture.trace.map((e) => e.disposedAfter)).toEqual([[], [], [], []]);
    expect(fixture.trace.map((e) => e.liveHandles)).toEqual([1, 1, 1, 1]);
    expect(shared.disposed, "detail|1,1 still binds this buffer").toBe(false);
    expect(fixture.binding.cellCount).toBe(1);
    // And that survivor genuinely still reaches the same object.
    expect(handleOf(fixture.world.getCell("detail", [1, 1])?.outputs["mega"][0])).toBe(shared);

    const gone = await fixture.world.update([1000, 0, 1000], { maxCooksPerUpdate: 0 });
    expect(cellIds(gone.evicted)).toEqual(["detail|1,1"]);
    expect(shared.disposed).toBe(true);
    expect(shared.disposeCalls).toBe(1);
    expect(fixture.binding.deviceHandleCount).toBe(0);
    expect(fixture.binding.cellCount).toBe(0);
    expect(fixture.adapter.released).toHaveLength(5);
    expect(fixture.adapter.releasedAfterDispose).toEqual([]);
  });

  it("children evicting first and the parent last disposes the buffer once, only at the final release", async () => {
    const fixture = makeAliasWorld();
    await fixture.world.update([50, 0, 50]);
    const shared = coarseHandle(fixture, "0,0");
    expect(handleOf(fixture.world.getCell("detail", [0, 0])?.outputs["mega"][0])).toBe(shared);
    expect(fixture.binding.deviceHandleCount).toBe(1);
    expect(fixture.binding.cellCount).toBe(5);

    // Inside the coarse retain ring (58 < 60), outside every fine one
    // (41.4 > 40): the four children release before their parent does.
    const kids = await fixture.world.update([50, 0, 108], { maxCooksPerUpdate: 0 });
    expect(cellIds(kids.evicted)).toEqual([
      "detail|0,0",
      "detail|0,1",
      "detail|1,0",
      "detail|1,1",
    ]);
    expect(shared.disposed, "the parent cell still owns this buffer").toBe(false);
    expect(fixture.binding.deviceHandleCount).toBe(1);
    expect(fixture.binding.cellCount).toBe(1);
    expect(handleOf(fixture.world.getCell("region", [0, 0])?.outputs["mega"][0])).toBe(shared);

    const parentGone = await fixture.world.update([1000, 0, 1000], { maxCooksPerUpdate: 0 });
    expect(cellIds(parentGone.evicted)).toEqual(["region|0,0"]);
    // Disposal at the fifth release and at no earlier one.
    expect(fixture.trace.map((e) => e.disposedAfter)).toEqual([[], [], [], [], ["0,0"]]);
    expect(fixture.trace.map((e) => e.liveHandles)).toEqual([1, 1, 1, 1, 0]);
    expect(shared.disposed).toBe(true);
    expect(shared.disposeCalls).toBe(1);
    expect(fixture.binding.cellCount).toBe(0);
    expect(fixture.adapter.released).toHaveLength(5);
    expect(fixture.adapter.releasedAfterDispose).toEqual([]);
  });

  it("three assets per cell: the coarse level evicting first frees none of the three buffers", async () => {
    const fixture = makeAliasWorld(3);
    await fixture.world.update([50, 0, 50]);
    const shared = coarseHandles(fixture, "0,0");
    expect(shared).toHaveLength(3);
    // Five live cells, three buffers, fifteen scene objects — the shape
    // every claim below depends on.
    expect(fixture.binding.cellCount).toBe(5);
    expect(fixture.adapter.built).toHaveLength(15);
    expect(fixture.binding.deviceHandleCount).toBe(3);
    expect(fixture.binding.deviceHandleBytes).toBe((8 + 9 + 10) * 64);

    const away = await fixture.world.update([75, 0, 110], { maxCooksPerUpdate: 0 });
    expect(cellIds(away.evicted)).toEqual([
      "region|0,0",
      "detail|0,0",
      "detail|0,1",
      "detail|1,0",
    ]);
    // Four of the five holders gone, all three buffers still alive at
    // every one of those four release points.
    expect(fixture.trace.map((e) => e.liveHandles)).toEqual([3, 3, 3, 3]);
    expect(shared.map((h) => h.disposed)).toEqual([false, false, false]);
    expect(fixture.binding.deviceHandleBytes).toBe((8 + 9 + 10) * 64);

    const gone = await fixture.world.update([1000, 0, 1000], { maxCooksPerUpdate: 0 });
    expect(cellIds(gone.evicted)).toEqual(["detail|1,1"]);
    expect(shared.map((h) => h.disposeCalls)).toEqual([1, 1, 1]);
    expect(fixture.binding.deviceHandleCount).toBe(0);
    expect(fixture.binding.deviceHandleBytes).toBe(0);
    expect(fixture.adapter.released).toHaveLength(15);
    expect(fixture.adapter.releasedAfterDispose).toEqual([]);
  });

  it("three assets per cell: the children evicting first frees all three only at the parent's release", async () => {
    const fixture = makeAliasWorld(3);
    await fixture.world.update([50, 0, 50]);
    const shared = coarseHandles(fixture, "0,0");
    expect(fixture.binding.deviceHandleCount).toBe(3);
    expect(fixture.binding.cellCount).toBe(5);

    const kids = await fixture.world.update([50, 0, 108], { maxCooksPerUpdate: 0 });
    expect(cellIds(kids.evicted)).toEqual([
      "detail|0,0",
      "detail|0,1",
      "detail|1,0",
      "detail|1,1",
    ]);
    expect(shared.map((h) => h.disposed)).toEqual([false, false, false]);
    expect(fixture.binding.deviceHandleCount).toBe(3);

    const parentGone = await fixture.world.update([1000, 0, 1000], { maxCooksPerUpdate: 0 });
    expect(cellIds(parentGone.evicted)).toEqual(["region|0,0"]);
    // The whole trio crosses from 3 live to 0 at the fifth release and
    // at no earlier one, in the opposite eviction order to the test above.
    expect(fixture.trace.map((e) => e.liveHandles)).toEqual([3, 3, 3, 3, 0]);
    expect(shared.map((h) => h.disposeCalls)).toEqual([1, 1, 1]);
    expect(fixture.binding.deviceHandleBytes).toBe(0);
    expect(fixture.adapter.released).toHaveLength(15);
    expect(fixture.adapter.releasedAfterDispose).toEqual([]);
  });
});

// -- sites 6, 7, 8, 13: eviction -------------------------------------------

describe("device batches: eviction (radius exit and LRU trim both land here)", () => {
  it("cellEvicted disposes the cell's handles although it receives no outputs", () => {
    const adapter = makeAdapter();
    const { root, binding } = makeBinding(adapter);
    const a = makeHandle(3, "a");
    const b = makeHandle(3, "b");
    binding.cellReady("rocks", [0, 0], deviceOutputs(makeBatch("x", 3, a)));
    binding.cellReady("rocks", [1, 0], deviceOutputs(makeBatch("x", 3, b)));
    expect(binding.deviceHandleCount).toBe(2);

    binding.cellEvicted("rocks", [0, 0]);
    expect(a.disposed).toBe(true);
    expect(b.disposed).toBe(false);
    expect(root.children).toHaveLength(1);
    expect(binding.deviceHandleCount).toBe(1);

    // Evicting an unknown cell stays a no-op.
    binding.cellEvicted("rocks", [99, 99]);
    expect(binding.deviceHandleCount).toBe(1);
  });

  it("a sustained cook/evict churn returns to zero and never accumulates", () => {
    const adapter = makeAdapter();
    const { root, binding } = makeBinding(adapter);
    const live = new Set<string>();
    let peak = 0;
    const handles: FakeHandle[] = [];
    for (let i = 0; i < 400; i++) {
      const coord: [number, number] = [i % 7, Math.floor(i / 7) % 7];
      const key = coord.join(",");
      const h = makeHandle(2, `c${i}`);
      handles.push(h);
      binding.cellReady("rocks", coord, deviceOutputs(makeBatch("x", 2, h)));
      live.add(key);
      if (i % 3 === 0 && live.size > 4) {
        const victim = [...live][0].split(",").map(Number) as [number, number];
        binding.cellEvicted("rocks", victim);
        live.delete(victim.join(","));
      }
      peak = Math.max(peak, binding.deviceHandleCount);
    }
    // Bounded by the number of live cells, not by the number of cooks.
    expect(peak).toBeLessThanOrEqual(49);
    binding.dispose();
    expect(binding.deviceHandleCount).toBe(0);
    expect(binding.deviceHandleBytes).toBe(0);
    expect(root.children).toHaveLength(0);
    expect(handles.filter((h) => !h.disposed)).toEqual([]);
    expect(handles.filter((h) => h.disposeCalls !== 1)).toEqual([]);
    expect(adapter.built).toHaveLength(400);
    expect(adapter.released).toHaveLength(400);
    expect(adapter.releasedAfterDispose).toEqual([]);
  });
});

// -- site 11: onCellReady throwing -----------------------------------------

describe("device batches: a failing build (world.ts onCellReady throws)", () => {
  it("releases every handle the partial build retained and leaves the old cell intact", () => {
    const adapter = makeAdapter();
    const { root, binding } = makeBinding(adapter);
    const good = makeHandle(3, "good");
    binding.cellReady("rocks", [0, 0], deviceOutputs(makeBatch("ok", 3, good)));
    const oldCell = root.children[0];

    const first = makeHandle(3, "new-first");
    const second = makeHandle(3, "new-second");
    adapter.failBuild = "boom";
    expect(() =>
      binding.cellReady(
        "rocks",
        [0, 0],
        deviceOutputs(makeBatch("fine", 3, first), makeBatch("boom", 3, second)),
      ),
    ).toThrow(/adapter build failed for "boom"/);

    // Both new handles are gone (the one that built and the one that did
    // not), the previous content is still registered and visible, and
    // its handle is untouched.
    expect(first.disposed).toBe(true);
    expect(second.disposed).toBe(true);
    expect(good.disposed).toBe(false);
    expect(binding.cellCount).toBe(1);
    expect(root.children).toHaveLength(1);
    expect(root.children[0]).toBe(oldCell);
    expect(binding.deviceHandleCount).toBe(1);

    // A later good cook still replaces it.
    adapter.failBuild = undefined;
    const third = makeHandle(3, "third");
    binding.cellReady("rocks", [0, 0], deviceOutputs(makeBatch("ok", 3, third)));
    expect(good.disposed).toBe(true);
    expect(binding.deviceHandleCount).toBe(1);
  });

  it("a CPU item throwing BEFORE a device item still releases the device handles", () => {
    // The retain pass must cover the WHOLE cell, not just the device
    // item it is standing on: `toInstancedMeshes` throws on an unknown
    // assetId, and if that happens while walking an earlier output the
    // later device item's handles would never be retained — and nothing
    // else in the library frees them (World disposes nothing, and the
    // graph transferred ownership at delivery).
    const adapter = makeAdapter();
    const root = new Group();
    const binding = new WorldThreeBinding({
      group: root,
      assets: {},
      deviceInstances: { adapter },
    });
    const stranded = makeHandle(7, "stranded");
    const cloud = createPointCloud(2);
    expect(() =>
      binding.cellReady("rocks", [0, 0], {
        // Insertion order matters: the CPU item is visited first.
        cpu: [makeInstancesItem(buildInstanceBatches(cloud, { defaultAssetId: "missing" }))],
        gpu: [makeDeviceInstancesItem([makeBatch("x", 7, stranded)])],
      }),
    ).toThrow(/unknown assetId "missing"/);
    expect(stranded.disposed, "the device handle must not be stranded").toBe(true);
    expect(stranded.disposeCalls).toBe(1);
    expect(binding.deviceHandleCount).toBe(0);
    expect(binding.cellCount).toBe(0);
  });

  it("a failing build never disposes a handle the previous cook still shares", () => {
    const adapter = makeAdapter();
    const { binding } = makeBinding(adapter);
    const shared = makeHandle(3, "shared");
    binding.cellReady("landmarks", [0, 0], deviceOutputs(makeBatch("m", 3, shared)));
    adapter.failBuild = "boom";
    expect(() =>
      binding.cellReady(
        "rocks",
        [0, 0],
        deviceOutputs(makeBatch("m", 3, shared), makeBatch("boom", 1)),
      ),
    ).toThrow(/adapter build failed/);
    expect(shared.disposed).toBe(false);
    expect(binding.deviceHandleCount).toBe(1);
  });

  it("a throwing adapter.release still frees the handles (the release runs in a finally)", () => {
    const adapter = makeAdapter();
    const { binding } = makeBinding(adapter);
    const a = makeHandle(3, "a");
    const b = makeHandle(3, "b");
    binding.cellReady("rocks", [0, 0], deviceOutputs(makeBatch("bad", 3, a), makeBatch("ok", 3, b)));
    adapter.failRelease = "bad";
    expect(() => binding.cellEvicted("rocks", [0, 0])).toThrow(/adapter release failed/);
    expect(a.disposed).toBe(true);
    expect(b.disposed).toBe(true);
    expect(binding.deviceHandleCount).toBe(0);
  });
});

// -- no adapter configured -------------------------------------------------

describe("device batches with no adapter configured", () => {
  it("throws an error naming both fixes rather than drawing an empty cell", () => {
    const root = new Group();
    const binding = new WorldThreeBinding({ group: root, assets: {} });
    const handle = makeHandle(5, "orphan");
    expect(() =>
      binding.cellReady("rocks", [2, 2], deviceOutputs(makeBatch("x", 5, handle))),
    ).toThrow(/device-resident instances item \(1 batch\(es\), 5 instances\)/);
    expect(() =>
      binding.cellReady("rocks", [2, 2], deviceOutputs(makeBatch("x", 5, handle))),
    ).toThrow(/deviceInstances.*createWebGpuInstanceAdapter|GpuFieldEvaluator/s);
    // The handle is still released — it was retained before the throw.
    expect(handle.disposed).toBe(true);
    expect(binding.cellCount).toBe(0);
    expect(binding.deviceHandleCount).toBe(0);
  });

  it("reading `batches` is never what fails: residency is checked first", () => {
    // `makeDeviceInstancesItem` gives `batches` a throwing accessor. If
    // the binding tested `item.batches` before residency the message
    // would be the core one, not the actionable binding one.
    const root = new Group();
    const binding = new WorldThreeBinding({ group: root, assets: {} });
    expect(() => binding.cellReady("rocks", [0, 0], deviceOutputs(makeBatch("x", 1)))).toThrow(
      /WorldThreeBinding/,
    );
  });
});

// -- mixed outputs ---------------------------------------------------------

describe("device and CPU instances items side by side", () => {
  it("a cell holding both renders both and disposes each with its own contract", () => {
    const adapter = makeAdapter();
    const root = new Group();
    const assets = {
      tree: { geometry: new BoxGeometry(), material: new MeshBasicMaterial() },
    };
    const binding = new WorldThreeBinding({
      group: root,
      assets,
      debugPoints: true,
      deviceInstances: { adapter },
    });
    const cloud = createPointCloud(3);
    const handle = makeHandle(4, "dev");
    binding.cellReady("rocks", [0, 0], {
      cpu: [
        makeInstancesItem(buildInstanceBatches(cloud, { defaultAssetId: "tree" })),
        makeGeometryItem(cloud),
      ],
      gpu: [makeDeviceInstancesItem([makeBatch("x", 4, handle)])],
    });
    // 1 InstancedMesh + 1 debug Points + 1 adapter object.
    expect(root.children[0].children).toHaveLength(3);
    expect(binding.deviceHandleCount).toBe(1);

    binding.cellEvicted("rocks", [0, 0]);
    expect(handle.disposed).toBe(true);
    expect(adapter.released).toHaveLength(1);
    expect(root.children).toHaveLength(0);
  });
});

// -- v0.8: N batches per cell ----------------------------------------------

/**
 * Until v0.8 a device-resident cell carried at most one batch, because
 * only a constant `assetId` could fuse. A spawn driven by `assetAttr`
 * now delivers one batch — one buffer, one handle — per asset present in
 * the cell, so every ownership claim above has to hold at N as well as
 * at 1. What changes at N is not the rule but the number of ways it can
 * be broken half-way through: a build that throws on batch 3 of 5, a
 * release that throws on batch 1 of 5, and a cell whose handles are
 * partly its own and partly its parent's.
 */

/** One device item carrying a batch per `[assetId, count]` pair. */
function multiBatchOutputs(
  specs: readonly (readonly [string, number])[],
  handles: readonly FakeHandle[],
): CellOutputs {
  return deviceOutputs(...specs.map(([id, n], i) => makeBatch(id, n, handles[i])));
}

/** A distinct handle per spec, sized from the spec's instance count. */
function handlesFor(
  specs: readonly (readonly [string, number])[],
  tag: string,
): FakeHandle[] {
  return specs.map(([id, n]) => makeHandle(n, `${tag}/${id}`));
}

describe("device batches: N per cell (a multi-asset resident spawn)", () => {
  // The phase-29 grouping fixture's shape: four assets, uneven counts,
  // in first-occurrence order.
  const FOREST = [
    ["pine", 102],
    ["rock", 103],
    ["tree", 205],
    ["fern", 102],
  ] as const;

  it("retains, builds and frees one handle per asset", () => {
    const adapter = makeAdapter();
    const { root, binding } = makeBinding(adapter);
    const handles = handlesFor(FOREST, "c");
    binding.cellReady("rocks", [0, 0], multiBatchOutputs(FOREST, handles));

    // One scene object per batch, in batch order.
    expect(adapter.built.map((o) => o.name)).toEqual(
      FOREST.map(([id]) => `rocks|0,0/${id}`),
    );
    expect(root.children[0].children).toHaveLength(4);
    expect(binding.deviceHandleCount).toBe(4);
    expect(binding.deviceHandleBytes).toBe((102 + 103 + 205 + 102) * 64);

    binding.cellEvicted("rocks", [0, 0]);
    expect(handles.map((h) => h.disposeCalls)).toEqual([1, 1, 1, 1]);
    expect(binding.deviceHandleCount).toBe(0);
    expect(binding.deviceHandleBytes).toBe(0);
    expect(root.children).toHaveLength(0);
    // Three-side teardown always precedes buffer destruction.
    expect(adapter.releasedAfterDispose).toEqual([]);
  });

  it("a build that throws on batch 3 of 5 strands nothing", () => {
    const adapter = makeAdapter();
    const { root, binding } = makeBinding(adapter);
    const specs = [
      ["pine", 1],
      ["rock", 2],
      ["boom", 3],
      ["fern", 4],
      ["moss", 5],
    ] as const;
    const handles = handlesFor(specs, "cell");
    adapter.failBuild = "boom";
    expect(() => binding.cellReady("rocks", [4, 4], multiBatchOutputs(specs, handles))).toThrow(
      /adapter build failed for "boom"/,
    );

    // Two objects built, both released; the loop stopped where it threw.
    expect(adapter.built.map((o) => o.name)).toEqual(["rocks|4,4/pine", "rocks|4,4/rock"]);
    expect(adapter.released.map((o) => o.name)).toEqual(["rocks|4,4/pine", "rocks|4,4/rock"]);
    // THE claim: all five buffers are freed exactly once — including the
    // two belonging to batches 4 and 5, which the build never reached and
    // which nothing else in the library would ever free.
    expect(handles.map((h) => h.disposeCalls)).toEqual([1, 1, 1, 1, 1]);
    expect(binding.deviceHandleCount).toBe(0);
    expect(binding.deviceHandleBytes).toBe(0);
    expect(binding.cellCount).toBe(0);
    expect(root.children).toHaveLength(0);
    expect(adapter.releasedAfterDispose).toEqual([]);
  });

  it("a release that throws on batch 1 of 5 still releases the other four objects", () => {
    const adapter = makeAdapter();
    const { binding } = makeBinding(adapter);
    const specs = [
      ["bad", 2],
      ["pine", 2],
      ["rock", 2],
      ["fern", 2],
      ["moss", 2],
    ] as const;
    const handles = handlesFor(specs, "cell");
    binding.cellReady("rocks", [0, 0], multiBatchOutputs(specs, handles));

    adapter.failRelease = "bad"; // the FIRST object the teardown reaches
    expect(() => binding.cellEvicted("rocks", [0, 0])).toThrow(
      /adapter release failed for "rocks\|0,0\/bad"/,
    );
    // Teardown ran to completion: every object was handed back to the
    // adapter. Aborting at the first throw would leak four meshes and
    // leave the adapter's live-instance meter permanently high.
    expect(adapter.released.map((o) => o.name)).toEqual(
      specs.map(([id]) => `rocks|0,0/${id}`),
    );
    // And every buffer is still freed exactly once.
    expect(handles.map((h) => h.disposeCalls)).toEqual([1, 1, 1, 1, 1]);
    expect(binding.deviceHandleCount).toBe(0);
    expect(binding.deviceHandleBytes).toBe(0);
  });

  it("evicting one multi-asset cell frees its own handles and no neighbour's", () => {
    const adapter = makeAdapter();
    const { binding } = makeBinding(adapter);
    const coords = [
      [0, 0],
      [1, 0],
      [2, 0],
    ] as const;
    const perCell = new Map<string, FakeHandle[]>();
    for (const coord of coords) {
      const handles = handlesFor(FOREST, coord.join(","));
      perCell.set(coord.join(","), handles);
      binding.cellReady("rocks", coord, multiBatchOutputs(FOREST, handles));
    }
    expect(binding.deviceHandleCount).toBe(12);

    binding.cellEvicted("rocks", [1, 0]);
    expect(perCell.get("1,0")?.map((h) => h.disposeCalls)).toEqual([1, 1, 1, 1]);
    const survivors = [...(perCell.get("0,0") ?? []), ...(perCell.get("2,0") ?? [])];
    expect(survivors).toHaveLength(8);
    expect(survivors.filter((h) => h.disposed)).toEqual([]);
    expect(binding.deviceHandleCount).toBe(8);
    expect(binding.deviceHandleBytes).toBe(2 * (102 + 103 + 205 + 102) * 64);
  });

  it("a handle shared by three multi-asset cells is freed once, by whichever releases last", () => {
    // The parent/child aliasing case at N: each cell holds two handles of
    // its own plus one the other two also hold. Every eviction order must
    // free the shared buffer exactly once, and only at the last release.
    const orders = [
      ["parent", "childA", "childB"],
      ["childB", "childA", "parent"],
      ["childA", "parent", "childB"],
    ] as const;
    const cellOf: Record<string, readonly [string, CellCoord]> = {
      parent: ["landmarks", [0, 0]],
      childA: ["rocks", [0, 0]],
      childB: ["rocks", [1, 0]],
    };
    for (const order of orders) {
      const adapter = makeAdapter();
      const { binding } = makeBinding(adapter);
      const shared = makeHandle(8, "shared");
      const own = new Map<string, FakeHandle[]>();
      for (const name of ["parent", "childA", "childB"]) {
        const [level, coord] = cellOf[name];
        const a = makeHandle(3, `${name}-pine`);
        const b = makeHandle(5, `${name}-fern`);
        own.set(name, [a, b]);
        binding.cellReady(
          level,
          coord,
          deviceOutputs(
            makeBatch("pine", 3, a),
            makeBatch("mega", 8, shared),
            makeBatch("fern", 5, b),
          ),
        );
      }
      // 3 cells x 2 private + 1 shared, and nine scene objects.
      expect(binding.deviceHandleCount, order.join(">")).toBe(7);
      expect(binding.deviceHandleBytes).toBe((3 * (3 + 5) + 8) * 64);
      expect(adapter.built).toHaveLength(9);

      for (const [i, name] of order.entries()) {
        const [level, coord] = cellOf[name];
        binding.cellEvicted(level, coord);
        expect(own.get(name)?.map((h) => h.disposeCalls), `${name} private handles`).toEqual([1, 1]);
        expect(shared.disposed, `shared after ${name} (${i + 1}/3, order ${order.join(">")})`).toBe(
          i === order.length - 1,
        );
      }
      expect(shared.disposeCalls, order.join(">")).toBe(1);
      expect(binding.deviceHandleCount).toBe(0);
      expect(binding.deviceHandleBytes).toBe(0);
      expect(adapter.released).toHaveLength(9);
      expect(adapter.releasedAfterDispose).toEqual([]);
    }
  });

  it("sustained churn over multi-asset cells tracks a live-set model and returns to zero", () => {
    const adapter = makeAdapter();
    const { root, binding } = makeBinding(adapter);
    // An independent model of what SHOULD be retained: the handles of the
    // cells currently live. Comparing against it after every step is a
    // real oracle — it reddens both on a retained buffer that should have
    // gone and on a freed buffer a live cell still holds — where a
    // final-state-only check would pass on a leak that happens to be
    // cleaned up by `dispose()`.
    const live = new Map<string, FakeHandle[]>();
    const all: FakeHandle[] = [];
    let builds = 0;
    let maxAssets = 0;
    let seed = 1;
    // An LCG's low bits have a very short period, so take the high ones.
    const rand = (m: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 16) % m;
    };
    for (let i = 0; i < 300; i++) {
      const coord: [number, number] = [i % 9, Math.floor(i / 9) % 9];
      const key = coord.join(",");
      const assets = 1 + rand(6);
      maxAssets = Math.max(maxAssets, assets);
      const handles: FakeHandle[] = [];
      const batches: DeviceInstanceBatch[] = [];
      for (let a = 0; a < assets; a++) {
        const count = 1 + rand(40);
        const handle = makeHandle(count, `c${i}-a${a}`);
        handles.push(handle);
        all.push(handle);
        batches.push(makeBatch(`asset${a}`, count, handle));
      }
      binding.cellReady("rocks", coord, deviceOutputs(...batches));
      // A recook of a live cell replaces its handles; the model must
      // forget the previous set exactly as the binding does.
      live.set(key, handles);
      builds += assets;
      if (i % 3 === 0 && live.size > 5) {
        const victim = [...live.keys()][rand(live.size)];
        binding.cellEvicted("rocks", victim.split(",").map(Number) as [number, number]);
        live.delete(victim);
      }
      const expected = [...live.values()].flat();
      expect(binding.deviceHandleCount, `handles after cook ${i}`).toBe(expected.length);
      expect(binding.deviceHandleBytes, `bytes after cook ${i}`).toBe(
        expected.reduce((b, h) => b + h.byteLength, 0),
      );
    }
    // Non-vacuous: the churn really did produce multi-asset cells.
    expect(maxAssets).toBe(6);
    expect(builds).toBeGreaterThan(600);

    binding.dispose();
    expect(binding.deviceHandleCount).toBe(0);
    expect(binding.deviceHandleBytes).toBe(0);
    expect(root.children).toHaveLength(0);
    expect(all.filter((h) => h.disposeCalls !== 1)).toEqual([]);
    expect(adapter.built).toHaveLength(builds);
    expect(adapter.released).toHaveLength(builds);
    expect(adapter.releasedAfterDispose).toEqual([]);
  });

  it("asks `bounds` per asset, so a short asset is not padded by the tallest one's radius", () => {
    const adapter = makeAdapter();
    // The v0.8 reason this matters: a cell holding a 210-unit landmark
    // and 3-unit ground cover would, with one sphere per cell, draw the
    // ground cover with a 210-unit skirt and effectively stop culling it.
    const radii: Record<string, number> = { pine: 12, rock: 3, tower: 210 };
    const calls: string[] = [];
    const { binding } = makeBinding(adapter, (levelName, coord, assetId) => {
      calls.push(`${levelName}|${coord.join(",")}/${assetId}`);
      return { center: [coord[0], 0, coord[1] ?? 0], radius: radii[assetId] ?? -1 };
    });
    binding.cellReady(
      "rocks",
      [2, 5],
      deviceOutputs(makeBatch("pine", 1), makeBatch("rock", 1), makeBatch("tower", 1)),
    );
    expect(calls).toEqual(["rocks|2,5/pine", "rocks|2,5/rock", "rocks|2,5/tower"]);
    // Each object saw ITS asset's sphere — not the first asset's, which
    // is what hoisting the call out of the batch loop produces.
    expect(adapter.boundsSeen).toEqual(["2,0,5@12", "2,0,5@3", "2,0,5@210"]);
  });

  it("a two-parameter bounds callback still compiles and is asked once per asset", () => {
    // Back-compat: `assetId` is a third parameter, so a caller written
    // against v0.7 keeps working and keeps getting the cell sphere.
    const adapter = makeAdapter();
    let calls = 0;
    // The radius counts the invocations, so `boundsSeen` discriminates:
    // a hoisted call would put ONE sphere on all three objects, and a
    // constant radius here would score that as a pass.
    const { binding } = makeBinding(adapter, (_level, coord) => {
      calls++;
      return { center: [coord[0], 0, coord[1] ?? 0], radius: 40 + calls };
    });
    binding.cellReady(
      "rocks",
      [1, 1],
      deviceOutputs(makeBatch("pine", 1), makeBatch("rock", 1), makeBatch("fern", 1)),
    );
    expect(calls).toBe(3);
    expect(adapter.boundsSeen).toEqual(["1,0,1@41", "1,0,1@42", "1,0,1@43"]);
  });

  it("teardown never abandons a cell: a throwing release in the first cell still frees the rest", () => {
    // `dispose()` is the owner of last resort's last resort. If a
    // throwing `adapter.release` aborted the cell loop, every later
    // cell's buffers would be leaked with nothing left to free them —
    // strictly worse than the undisposed mesh the per-object guard in
    // `disposeEntry` covers.
    const adapter = makeAdapter();
    const { root, binding } = makeBinding(adapter);
    const perCell = new Map<string, FakeHandle[]>();
    for (const coord of [
      [0, 0],
      [1, 0],
      [2, 0],
    ] as const) {
      const key = coord.join(",");
      const handles = handlesFor(FOREST, key);
      perCell.set(key, handles);
      binding.cellReady("rocks", coord, multiBatchOutputs(FOREST, handles));
    }
    expect(binding.deviceHandleCount).toBe(12);

    // "pine" is the first batch of every cell, so the very first release
    // of the very first cell throws.
    adapter.failRelease = "pine";
    expect(() => binding.dispose()).toThrow(/adapter release failed for "rocks\|0,0\/pine"/);

    // Every cell was torn down, every buffer freed exactly once, and the
    // scene graph emptied.
    const all = [...perCell.values()].flat();
    expect(all).toHaveLength(12);
    expect(all.filter((h) => h.disposeCalls !== 1)).toEqual([]);
    expect(binding.deviceHandleCount).toBe(0);
    expect(binding.deviceHandleBytes).toBe(0);
    expect(binding.cellCount).toBe(0);
    expect(root.children).toHaveLength(0);
    // All twelve objects were offered back to the adapter, not just the
    // one that threw.
    expect(adapter.released).toHaveLength(12);
  });
});

// -- teardown that throws must not orphan what it was standing next to --

/**
 * One defect class, every site it can occur at.
 *
 * A teardown here always runs next to a step that decides what is still
 * *reachable*: `cells.set` on the swap, the handle releases in
 * `disposeEntry`, the next cell in `dispose`. An exception that escapes
 * one of those windows does not just fail loudly — it takes the resource
 * out of every index that could later free it, and `dispose()` cannot
 * free what is no longer in `cells`. So each test below asserts on the
 * live set at the instant of the throw, not on the state once the dust
 * settles: a leak that a later `dispose()` happens to mop up is invisible
 * to a final-state check and fatal in a streaming world that never tears
 * down.
 */
describe("device batches: a throwing teardown never orphans the incoming cell", () => {
  it("a recook whose OUTGOING cell fails to release still registers the incoming one", () => {
    const adapter = makeAdapter();
    const { root, binding } = makeBinding(adapter);
    const old = makeHandle(4, "old");
    binding.cellReady("rocks", [0, 0], deviceOutputs(makeBatch("bad", 4, old)));
    const oldGroup = root.children[0];

    adapter.failRelease = "bad"; // the outgoing cell's only object
    const a = makeHandle(3, "newA");
    const b = makeHandle(5, "newB");
    expect(() =>
      binding.cellReady(
        "rocks",
        [0, 0],
        deviceOutputs(makeBatch("pine", 3, a), makeBatch("fern", 5, b)),
      ),
    ).toThrow(/adapter release failed for "rocks\|0,0\/bad"/);

    // The outgoing cell is gone and was torn down completely anyway.
    expect(old.disposeCalls).toBe(1);
    expect(root.children).not.toContain(oldGroup);
    // THE claim: the incoming cell is live, not orphaned — registered,
    // in the scene, and both its buffers still reachable through the
    // binding. Unguarded, the throw escapes before `cells.set` and these
    // two handles can never be found again by anything.
    expect(binding.cellCount).toBe(1);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].name).toBe("rocks|0,0");
    expect(root.children[0].children).toHaveLength(2);
    expect(binding.deviceHandleCount).toBe(2);
    expect(binding.deviceHandleBytes).toBe((3 + 5) * 64);
    expect(a.disposed).toBe(false);
    expect(b.disposed).toBe(false);

    // And the owner of last resort can still free them.
    binding.dispose();
    expect(a.disposeCalls).toBe(1);
    expect(b.disposeCalls).toBe(1);
    expect(binding.deviceHandleCount).toBe(0);
    expect(binding.deviceHandleBytes).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it("churn where every recook's outgoing release throws tracks the live set at every step", () => {
    // The per-iteration model is the whole point. An orphaned cell is
    // invisible to a final assertion (the next cook of that key finds no
    // entry, so the leak only shows up as a count that never comes back
    // down) and invisible to a final `dispose()` too, since `dispose()`
    // walks `cells` and the orphan is exactly what is missing from it.
    const adapter = makeAdapter();
    const { root, binding } = makeBinding(adapter);
    adapter.failRelease = "bad"; // every cell's first batch
    const live = new Map<string, FakeHandle[]>();
    const all: FakeHandle[] = [];
    let recooks = 0;
    let evictions = 0;
    for (let i = 0; i < 60; i++) {
      const coord: [number, number] = [i % 4, Math.floor(i / 4) % 4];
      const key = coord.join(",");
      const handles = [makeHandle(2 + (i % 3), `c${i}-bad`), makeHandle(7, `c${i}-good`)];
      all.push(...handles);
      const outputs = deviceOutputs(
        makeBatch("bad", 2 + (i % 3), handles[0]),
        makeBatch("good", 7, handles[1]),
      );
      const replacing = live.has(key);
      if (replacing) {
        recooks++;
        // Replacing content whose release throws: the error surfaces...
        expect(() => binding.cellReady("rocks", coord, outputs), `recook ${i}`).toThrow(
          /adapter release failed/,
        );
      } else {
        binding.cellReady("rocks", coord, outputs);
      }
      // ...and the new content is live regardless.
      live.set(key, handles);
      if (i % 5 === 4 && live.size > 2) {
        const victim = [...live.keys()][0];
        evictions++;
        expect(() =>
          binding.cellEvicted("rocks", victim.split(",").map(Number) as [number, number]),
        ).toThrow(/adapter release failed/);
        live.delete(victim);
      }
      const expected = [...live.values()].flat();
      expect(binding.cellCount, `cells after cook ${i}`).toBe(live.size);
      expect(root.children, `groups after cook ${i}`).toHaveLength(live.size);
      expect(binding.deviceHandleCount, `handles after cook ${i}`).toBe(expected.length);
      expect(binding.deviceHandleBytes, `bytes after cook ${i}`).toBe(
        expected.reduce((b, h) => b + h.byteLength, 0),
      );
    }
    // Non-vacuous: the loop really did exercise both throwing paths.
    expect(recooks).toBeGreaterThan(20);
    expect(evictions).toBeGreaterThan(5);

    expect(() => binding.dispose()).toThrow(/adapter release failed/);
    expect(binding.deviceHandleCount).toBe(0);
    expect(binding.deviceHandleBytes).toBe(0);
    expect(root.children).toHaveLength(0);
    expect(all.filter((h) => h.disposeCalls !== 1)).toEqual([]);
    expect(adapter.released).toHaveLength(adapter.built.length);
  });

  it("a throwing three `dispose` listener on a CPU mesh does not strand the cell's device buffers", () => {
    // `InstancedMesh.dispose()` dispatches a `dispose` event before it
    // does anything else, and three's own renderer bookkeeping listens on
    // exactly that. A listener that throws used to abort `disposeEntry`
    // above the device section, leaving the cell deleted from `cells`
    // with its handles still retained — unreachable and unfreeable.
    const adapter = makeAdapter();
    const root = new Group();
    const binding = new WorldThreeBinding({
      group: root,
      assets: {
        tree: {
          geometry: new BoxGeometry(),
          material: new MeshBasicMaterial(),
        },
      },
      debugPoints: true,
      deviceInstances: { adapter },
    });
    const cloud = createPointCloud(3);
    const handle = makeHandle(6, "dev");
    binding.cellReady("rocks", [0, 0], {
      cpu: [
        makeInstancesItem(buildInstanceBatches(cloud, { defaultAssetId: "tree" })),
        makeGeometryItem(cloud),
      ],
      gpu: [makeDeviceInstancesItem([makeBatch("x", 6, handle)])],
    });

    const children = root.children[0].children;
    const mesh = children.find((c): c is InstancedMesh => c instanceof InstancedMesh);
    const points = children.find(
      (c): c is Points<BufferGeometry, PointsMaterial> => c instanceof Points,
    );
    expect(mesh, "the CPU mesh must exist for this test to mean anything").toBeDefined();
    expect(points, "the debug points must exist too").toBeDefined();
    const steps: string[] = [];
    mesh?.addEventListener("dispose", () => {
      steps.push("mesh");
      throw new Error("renderer resource listener exploded");
    });
    points?.geometry.addEventListener("dispose", () => steps.push("geometry"));
    points?.material.addEventListener("dispose", () => steps.push("material"));

    expect(() => binding.cellEvicted("rocks", [0, 0])).toThrow(/listener exploded/);

    // Teardown carried on past the throw instead of abandoning the rest.
    expect(steps).toEqual(["mesh", "geometry", "material"]);
    expect(adapter.released.map((o) => o.name)).toEqual(["rocks|0,0/x"]);
    // THE claim: the device buffer is freed, not stranded in a cell that
    // no longer exists.
    expect(handle.disposeCalls).toBe(1);
    expect(binding.deviceHandleCount).toBe(0);
    expect(binding.deviceHandleBytes).toBe(0);
    expect(binding.cellCount).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it("a throwing debug-geometry listener still disposes the material and the device handle", () => {
    const adapter = makeAdapter();
    const root = new Group();
    const binding = new WorldThreeBinding({
      group: root,
      assets: {},
      debugPoints: true,
      deviceInstances: { adapter },
    });
    const cloud = createPointCloud(2);
    const handle = makeHandle(4, "dev");
    binding.cellReady("rocks", [1, 1], {
      cpu: [makeGeometryItem(cloud)],
      gpu: [makeDeviceInstancesItem([makeBatch("x", 4, handle)])],
    });
    const points = root.children[0].children.find(
      (c): c is Points<BufferGeometry, PointsMaterial> => c instanceof Points,
    );
    expect(points).toBeDefined();
    let materialDisposed = false;
    points?.geometry.addEventListener("dispose", () => {
      throw new Error("geometry listener exploded");
    });
    points?.material.addEventListener("dispose", () => {
      materialDisposed = true;
    });

    expect(() => binding.cellEvicted("rocks", [1, 1])).toThrow(/geometry listener exploded/);
    // The material is created per cell and nothing else will ever free it.
    expect(materialDisposed).toBe(true);
    expect(handle.disposeCalls).toBe(1);
    expect(binding.deviceHandleCount).toBe(0);
    expect(binding.cellCount).toBe(0);
  });

  it("a build error is not masked by a release error raised while cleaning up after it", () => {
    // Error messages are part of the API: the caller has to be told what
    // they got wrong, not what broke while the binding tidied up.
    const adapter = makeAdapter();
    const root = new Group();
    const binding = new WorldThreeBinding({
      group: root,
      assets: {},
      deviceInstances: { adapter },
    });
    adapter.failRelease = "bad";
    const handle = makeHandle(6, "dev");
    const cloud = createPointCloud(2);
    let thrown: unknown;
    try {
      binding.cellReady("rocks", [7, 7], {
        // Device item first, so an object exists whose release will fail;
        // the CPU item is what actually fails the build.
        gpu: [makeDeviceInstancesItem([makeBatch("bad", 6, handle)])],
        cpu: [makeInstancesItem(buildInstanceBatches(cloud, { defaultAssetId: "nope" }))],
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown, "the build had to fail for this test to mean anything").toBeInstanceOf(Error);
    const err = thrown as Error;
    expect(err.message).toMatch(/unknown assetId "nope"/);
    expect(err.message).not.toMatch(/adapter release failed/);
    // The secondary failure is preserved rather than silently dropped.
    expect(String(err.cause)).toMatch(/adapter release failed for "rocks\|7,7\/bad"/);
    // Cleanup still completed although it threw.
    expect(handle.disposeCalls).toBe(1);
    expect(binding.deviceHandleCount).toBe(0);
    expect(binding.cellCount).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it("a retain pass that throws half-way releases the handles it had already taken out", () => {
    const adapter = makeAdapter();
    const { binding } = makeBinding(adapter);
    const retained = makeHandle(4, "retained");
    // The retain pass walks the WHOLE cell before any build runs, so a
    // hostile output object can abort it after some handles are counted
    // and before the entry exists to reach them through.
    const hostile = {
      kind: "instances",
      get deviceBatches(): readonly DeviceInstanceBatch[] {
        throw new Error("outputs walk exploded");
      },
      tags: new Set<string>(),
      rev: -1,
    } as unknown as DataItem;
    expect(() =>
      binding.cellReady("rocks", [0, 0], {
        first: [makeDeviceInstancesItem([makeBatch("x", 4, retained)])],
        second: [hostile],
      }),
    ).toThrow(/outputs walk exploded/);
    expect(retained.disposeCalls).toBe(1);
    expect(binding.deviceHandleCount).toBe(0);
    expect(binding.deviceHandleBytes).toBe(0);
    expect(binding.cellCount).toBe(0);
  });
});
