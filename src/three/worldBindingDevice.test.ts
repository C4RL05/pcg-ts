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
import { BoxGeometry, Group, MeshBasicMaterial, Object3D } from "three";
import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import type { DeviceInstanceBatch, DeviceTransformsHandle } from "../fields/index.js";
import {
  Graph,
  makeDeviceInstancesItem,
  makeGeometryItem,
  makeInstancesItem,
  type DataItem,
} from "../graph/index.js";
import { dataInput, World } from "../runtime/index.js";
import type { CellCoord, CellOutputs, LevelDef } from "../runtime/types.js";
import { buildInstanceBatches } from "../spawn/instances.js";
import { WorldThreeBinding, type DeviceInstanceAdapter } from "./worldBinding.js";

// -- fakes -----------------------------------------------------------------

interface FakeHandle extends DeviceTransformsHandle {
  readonly disposeCalls: number;
}

/** A handle with the real contract: idempotent dispose, throwing resource. */
function makeHandle(count: number, label = "h"): FakeHandle {
  let disposed = false;
  let disposeCalls = 0;
  return {
    backend: "webgpu",
    byteLength: count * 64,
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
    const { binding } = makeBinding(adapter, (level, coord) =>
      level === "rocks" ? { center: [coord[0] * 10, 0, coord[1] * 10], radius: 9 } : undefined,
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
  /** The handle minted for each coarse cell, keyed by its coord. */
  readonly handles: Map<string, FakeHandle>;
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
 */
function makeAliasWorld(): AliasWorld {
  const adapter = makeAdapter();
  const root = new Group();
  const binding = new WorldThreeBinding({
    group: root,
    assets: {},
    deviceInstances: { adapter },
  });

  const handles = new Map<string, FakeHandle>();
  const coarseItems = new Map<string, readonly DataItem[]>();
  function coarseItemsFor(coord: CellCoord): readonly DataItem[] {
    const key = coord.join(",");
    let items = coarseItems.get(key);
    if (items === undefined) {
      const handle = makeHandle(8, `region-${key}`);
      handles.set(key, handle);
      items = [makeDeviceInstancesItem([makeBatch(`mega-${key}`, 8, handle)])];
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

  return { world, binding, adapter, handles, trace };
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
