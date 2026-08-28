/**
 * `WorldThreeBinding.retainCellHandles` must not be able to strand a
 * device handle when the pass it runs THROWS.
 *
 * The pass is deliberately up front — retain every handle in the whole
 * cell before any build runs — so that `cellReady`'s catch can release
 * everything the cell carried whatever fails downstream. Since the
 * per-instance channel shipped, the pass itself has a throw in it:
 * `deviceInstanceAttributesOf` refuses a batch whose two colour
 * spellings (`attributes.color.handle` and the plain `colors`) hold
 * DIFFERENT handles, because it cannot pick a winner without silently
 * dropping the other buffer and its owner obligation.
 *
 * That refusal is correct. What it must not do is take buffers with it.
 * The binding is the owner of last resort — `World` frees nothing and
 * the graph transferred ownership at delivery — so a handle the pass
 * never retained is a device buffer nothing in the process can ever
 * free, leaked once per cook for as long as the malformed batch keeps
 * arriving.
 *
 * Three ways it could strand one, one test each:
 *  - the refused batch's own `transforms` (retained AFTER the refusing
 *    call, before the fix),
 *  - the refused batch's colour buffers, which have no normalized record
 *    to be enumerated through once the normalizer has refused,
 *  - every handle of every batch and item the pass had not reached yet.
 */
import { Group } from "three";
import { describe, expect, it } from "vitest";
import type {
  DeviceInstanceAttribute,
  DeviceInstanceBatch,
  DeviceTransformsHandle,
} from "../fields/index.js";
import { makeDeviceInstancesItem } from "../graph/data.js";
import type { CellOutputs } from "../runtime/types.js";
import { WorldThreeBinding, type DeviceInstanceAdapter } from "./worldBinding.js";

interface FakeHandle extends DeviceTransformsHandle {
  readonly disposeCalls: number;
}

/** A handle with the real contract: idempotent dispose, throwing resource. */
function makeHandle(label: string, bytes = 64): FakeHandle {
  let disposed = false;
  let disposeCalls = 0;
  return {
    backend: "webgpu",
    byteLength: bytes,
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

function channel(handle: DeviceTransformsHandle): DeviceInstanceAttribute {
  return { handle, type: "f32", itemSize: 3 };
}

/**
 * The one shape `deviceInstanceAttributesOf` refuses: the reserved
 * `"color"` channel and the plain `colors` holding different handles.
 * Written as a literal on purpose — `makeDeviceInstanceBatch` installs
 * `colors` as an accessor over the channel, so a batch this library
 * builds can never reach this state and only a hand-built one can.
 */
function conflictingBatch(
  assetId: string,
  transforms: DeviceTransformsHandle,
  channelColour: DeviceTransformsHandle,
  plainColour: DeviceTransformsHandle,
): DeviceInstanceBatch {
  return {
    residency: "device",
    assetId,
    count: 4,
    transforms,
    attributes: { color: channel(channelColour) },
    colors: plainColour,
  };
}

function plainBatch(assetId: string, transforms: DeviceTransformsHandle): DeviceInstanceBatch {
  return { residency: "device", assetId, count: 4, transforms };
}

function outputsOf(...items: DeviceInstanceBatch[][]): CellOutputs {
  const outputs: Record<string, ReturnType<typeof makeDeviceInstancesItem>[]> = {};
  items.forEach((batches, i) => {
    outputs[`pin${i}`] = [makeDeviceInstancesItem(batches)];
  });
  return outputs;
}

function makeAdapter(): DeviceInstanceAdapter {
  return {
    build() {
      return new Group();
    },
    release() {},
  };
}

function makeBinding(): WorldThreeBinding {
  return new WorldThreeBinding({
    group: new Group(),
    // No CPU assets: every item under test is device-resident.
    assets: {},
    deviceInstances: { adapter: makeAdapter() },
  });
}

describe("retainCellHandles: a refused batch strands nothing", () => {
  it("refuses the malformed batch, naming it and both spellings", () => {
    const binding = makeBinding();
    const batch = conflictingBatch(
      "rock",
      makeHandle("rock-transforms"),
      makeHandle("rock-channel-colour", 16),
      makeHandle("rock-plain-colour", 16),
    );

    expect(() => binding.cellReady("main", [0, 0], outputsOf([batch]))).toThrow(
      /deviceInstanceAttributesOf: batch "rock" carries two different colour handles/,
    );
  });

  it("retains and frees the refused batch's transforms", () => {
    const binding = makeBinding();
    const transforms = makeHandle("rock-transforms");
    const batch = conflictingBatch(
      "rock",
      transforms,
      makeHandle("rock-channel-colour", 16),
      makeHandle("rock-plain-colour", 16),
    );

    expect(() => binding.cellReady("main", [0, 0], outputsOf([batch]))).toThrow();

    // The whole hazard in one assertion: the check that noticed the batch
    // was malformed must not carry its largest buffer off with it.
    expect(transforms.disposed).toBe(true);
    expect(transforms.disposeCalls).toBe(1);
    expect(binding.deviceHandleCount).toBe(0);
    expect(binding.deviceHandleBytes).toBe(0);
    expect(binding.cellCount).toBe(0);
  });

  it("frees the colour buffers under BOTH spellings of the refused batch", () => {
    const binding = makeBinding();
    const channelColour = makeHandle("rock-channel-colour", 16);
    const plainColour = makeHandle("rock-plain-colour", 16);
    const batch = conflictingBatch("rock", makeHandle("rock-transforms"), channelColour, plainColour);

    expect(() => binding.cellReady("main", [0, 0], outputsOf([batch]))).toThrow();

    // Two different buffers is exactly what the refusal says, so both are
    // real allocations and neither has another owner.
    expect(channelColour.disposed).toBe(true);
    expect(plainColour.disposed).toBe(true);
    expect(channelColour.disposeCalls).toBe(1);
    expect(plainColour.disposeCalls).toBe(1);
    expect(binding.deviceHandleCount).toBe(0);
  });

  it("still retains and frees every batch AFTER the refused one", () => {
    const binding = makeBinding();
    const later = makeHandle("moss-transforms");
    const bad = conflictingBatch(
      "rock",
      makeHandle("rock-transforms"),
      makeHandle("rock-channel-colour", 16),
      makeHandle("rock-plain-colour", 16),
    );

    expect(() =>
      binding.cellReady("main", [0, 0], outputsOf([bad, plainBatch("moss", later)])),
    ).toThrow(/two different colour handles/);

    expect(later.disposed).toBe(true);
    expect(binding.deviceHandleCount).toBe(0);
  });

  it("still retains and frees every ITEM after the refused one", () => {
    const binding = makeBinding();
    const later = makeHandle("moss-transforms");
    const bad = conflictingBatch(
      "rock",
      makeHandle("rock-transforms"),
      makeHandle("rock-channel-colour", 16),
      makeHandle("rock-plain-colour", 16),
    );

    expect(() =>
      binding.cellReady("main", [0, 0], outputsOf([bad], [plainBatch("moss", later)])),
    ).toThrow(/two different colour handles/);

    expect(later.disposed).toBe(true);
    expect(binding.deviceHandleCount).toBe(0);
  });

  it("propagates the FIRST refusal when several batches are malformed", () => {
    const binding = makeBinding();
    const second = makeHandle("moss-transforms");
    const bad1 = conflictingBatch(
      "rock",
      makeHandle("rock-transforms"),
      makeHandle("rock-channel-colour", 16),
      makeHandle("rock-plain-colour", 16),
    );
    const bad2 = conflictingBatch(
      "moss",
      second,
      makeHandle("moss-channel-colour", 16),
      makeHandle("moss-plain-colour", 16),
    );

    expect(() => binding.cellReady("main", [0, 0], outputsOf([bad1, bad2]))).toThrow(
      /batch "rock" carries two different colour handles/,
    );
    expect(second.disposed).toBe(true);
    expect(binding.deviceHandleCount).toBe(0);
  });

  it("leaves a handle a LIVE cell also holds alone", () => {
    const binding = makeBinding();
    const shared = makeHandle("shared-transforms");

    binding.cellReady("main", [0, 0], outputsOf([plainBatch("rock", shared)]));
    expect(binding.deviceHandleCount).toBe(1);

    // The failed cell aliases the live cell's transforms handle — the
    // parent-forwarding shape. Releasing the failed cell's retains must
    // decrement it, never dispose it.
    const bad = conflictingBatch(
      "rock",
      shared,
      makeHandle("rock-channel-colour", 16),
      makeHandle("rock-plain-colour", 16),
    );
    expect(() => binding.cellReady("main", [1, 0], outputsOf([bad]))).toThrow();

    expect(shared.disposed).toBe(false);
    expect(binding.deviceHandleCount).toBe(1);
  });
});

describe("retainCellHandles: the well-formed paths are unchanged", () => {
  it("counts a colour channel and its `colors` accessor as ONE handle", () => {
    const binding = makeBinding();
    const transforms = makeHandle("rock-transforms");
    const colour = makeHandle("rock-colour", 16);
    // What `makeDeviceInstanceBatch` produces: `colors` is an accessor
    // over the reserved channel, so the two spellings are one handle.
    const batch: DeviceInstanceBatch = {
      residency: "device",
      assetId: "rock",
      count: 4,
      transforms,
      attributes: { color: channel(colour) },
      get colors() {
        return colour;
      },
    };

    binding.cellReady("main", [0, 0], outputsOf([batch]));
    expect(binding.deviceHandleCount).toBe(2);
    expect(binding.deviceHandleBytes).toBe(80);

    binding.dispose();
    expect(transforms.disposeCalls).toBe(1);
    expect(colour.disposeCalls).toBe(1);
    expect(binding.deviceHandleCount).toBe(0);
  });

  it("lifts a plain `colors` beside other channels and retains both", () => {
    const binding = makeBinding();
    const transforms = makeHandle("reed-transforms");
    const colour = makeHandle("reed-colour", 16);
    const phase = makeHandle("reed-phase", 4);
    // `{ attributes: { phase }, colors }` — the shape a presence-keyed
    // lift used to drop on the floor, which here would have leaked the
    // colour handle rather than merely drawing it wrong.
    const batch: DeviceInstanceBatch = {
      residency: "device",
      assetId: "reed",
      count: 4,
      transforms,
      attributes: { phase: { handle: phase, type: "f32", itemSize: 1 } },
      colors: colour,
    };

    binding.cellReady("main", [0, 0], outputsOf([batch]));
    expect(binding.deviceHandleCount).toBe(3);

    binding.dispose();
    expect(transforms.disposeCalls).toBe(1);
    expect(colour.disposeCalls).toBe(1);
    expect(phase.disposeCalls).toBe(1);
  });
});
