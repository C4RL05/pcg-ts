import { Object3D } from "three";
import { describe, expect, it } from "vitest";
import type { DeviceInstanceBatch, DeviceTransformsHandle } from "../fields/index.js";
import { toDeviceInstanceObjects, type DeviceInstanceAdapter } from "./deviceInstances.js";

/**
 * The unwind, which is the only part of this module with an ownership
 * obligation in it: objects built for earlier batches must not outlive a
 * later batch's failure, and one throwing `release` must not take the
 * rest of them with it.
 */
describe("toDeviceInstanceObjects unwind", () => {
  function handle(): DeviceTransformsHandle {
    return { backend: "test", byteLength: 32, disposed: false, resource: null, dispose(): void {} };
  }

  function batch(assetId: string): DeviceInstanceBatch {
    return { residency: "device", assetId, count: 2, transforms: handle() };
  }

  /**
   * An adapter that fails to build the named asset, and optionally
   * throws when releasing the object built for another one.
   */
  function makeAdapter(failBuild: string, failRelease?: string): {
    adapter: DeviceInstanceAdapter;
    released: string[];
  } {
    const released: string[] = [];
    const adapter: DeviceInstanceAdapter = {
      build(b): Object3D {
        if (b.assetId === failBuild) throw new Error(`build failed for "${b.assetId}"`);
        const object = new Object3D();
        object.name = b.assetId;
        return object;
      },
      release(object): void {
        released.push(object.name);
        if (object.name === failRelease) throw new Error(`release failed for "${object.name}"`);
      },
    };
    return { adapter, released };
  }

  it("releases every earlier object when a later batch fails to build", () => {
    const { adapter, released } = makeAdapter("c");
    expect(() => toDeviceInstanceObjects([batch("a"), batch("b"), batch("c")], adapter)).toThrow(
      'build failed for "c"',
    );
    expect(released).toEqual(["a", "b"]);
  });

  // The regression: an unguarded loop abandoned every object AFTER the
  // one whose release threw — their meshes never disposed and the
  // adapter's live-instance meter permanently high, for a failure in a
  // batch that had nothing to do with them.
  it("releases the objects after a throwing release, and still reports the BUILD error", () => {
    const { adapter, released } = makeAdapter("d", "a");
    expect(() =>
      toDeviceInstanceObjects([batch("a"), batch("b"), batch("c"), batch("d")], adapter),
    ).toThrow('build failed for "d"');
    expect(released).toEqual(["a", "b", "c"]);
  });

  it("returns one object per batch when every build succeeds", () => {
    const { adapter, released } = makeAdapter("none");
    const objects = toDeviceInstanceObjects([batch("a"), batch("b")], adapter);
    expect(objects.map((o) => o.name)).toEqual(["a", "b"]);
    expect(released).toEqual([]);
  });
});
