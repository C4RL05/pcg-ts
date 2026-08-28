import { describe, expect, it } from "vitest";
import { INSTANCE_COLOR_CHANNEL } from "../graph/data.js";
import {
  deviceInstanceAttributesOf,
  makeDeviceInstanceBatch,
  type DeviceInstanceAttribute,
  type DeviceInstanceBatch,
  type DeviceTransformsHandle,
} from "./gpuResolver.js";

/**
 * The device twin of `instanceAttributesOf`'s suite in
 * `src/graph/data.test.ts`. Colour lost here costs more than a wrong
 * picture: the handle is an owner obligation, and one nothing enumerates
 * is one nothing disposes.
 */
describe("deviceInstanceAttributesOf", () => {
  /** A stand-in device buffer; nothing here touches the device. */
  function handle(name: string): DeviceTransformsHandle {
    return {
      backend: "test",
      byteLength: 32,
      disposed: false,
      resource: name,
      dispose(): void {},
    };
  }

  const transforms = handle("transforms");
  const colors = handle("colors");
  const phase: DeviceInstanceAttribute = { handle: handle("phase"), type: "f32", itemSize: 1 };

  /** A batch as a HOST writes one: a plain object literal, no accessor. */
  function handBuilt(rest: Partial<DeviceInstanceBatch>): DeviceInstanceBatch {
    return { residency: "device", assetId: "rock", count: 2, transforms, ...rest };
  }

  it("returns the empty record for a batch with neither spelling", () => {
    expect(deviceInstanceAttributesOf(handBuilt({}))).toEqual({});
  });

  it("returns the record itself when there is no plain colors", () => {
    const attributes = { phase };
    expect(deviceInstanceAttributesOf(handBuilt({ attributes }))).toBe(attributes);
  });

  it("lifts a plain colors when the batch carries no attributes at all", () => {
    expect(deviceInstanceAttributesOf(handBuilt({ colors }))).toEqual({
      color: { handle: colors, type: "f32", itemSize: 3 },
    });
  });

  // The regression: an empty record is not a record that says "no
  // colour", and a presence test used to read it as one.
  it("lifts a plain colors past an EMPTY attributes record", () => {
    const channels = deviceInstanceAttributesOf(handBuilt({ attributes: {}, colors }));
    expect(channels.color?.handle).toBe(colors);
    expect(channels.color?.itemSize).toBe(3);
    expect(Object.keys(channels)).toEqual(["color"]);
  });

  it("lifts a plain colors beside other channels, keeping both", () => {
    const channels = deviceInstanceAttributesOf(handBuilt({ attributes: { phase }, colors }));
    expect(channels.color?.handle).toBe(colors);
    expect(channels.phase).toBe(phase);
    expect(Object.keys(channels).sort()).toEqual(["color", "phase"]);
  });

  it("counts one handle, not two, when both spellings are the same buffer", () => {
    const color: DeviceInstanceAttribute = { handle: colors, type: "f32", itemSize: 3 };
    const batch = makeDeviceInstanceBatch("rock", 2, transforms, { color, phase });
    expect(batch.colors).toBe(colors);
    const channels = deviceInstanceAttributesOf(batch);
    expect(channels).toBe(batch.attributes);
    // One entry per handle: disposing this record frees `colors` once.
    const handles = Object.values(channels).map((c) => c.handle);
    expect(handles.filter((h) => h === colors)).toHaveLength(1);
  });

  it("throws, naming both spellings, when they hold DIFFERENT handles", () => {
    const other: DeviceInstanceAttribute = { handle: handle("other"), type: "f32", itemSize: 3 };
    expect(() =>
      deviceInstanceAttributesOf(handBuilt({ attributes: { color: other }, colors })),
    ).toThrow(/batch "rock".*attributes\["color"\]\.handle.*colors/s);
  });
});

describe("deviceInstanceAttributesOf: the reserved name, and records a caller cannot enumerate", () => {
  function handle(name: string): DeviceTransformsHandle {
    return { backend: "test", byteLength: 32, disposed: false, resource: name, dispose(): void {} };
  }
  const transforms = handle("transforms");
  const colors = handle("colors");
  const other: DeviceInstanceAttribute = { handle: handle("other"), type: "f32", itemSize: 3 };

  // This module spells the reserved channel `"color"` by hand: it cannot
  // import the constant from `src/graph` without pointing the dependency
  // backwards, so the two spellings are kept in step by this assertion
  // and nothing else.
  it("spells the reserved channel exactly as INSTANCE_COLOR_CHANNEL does", () => {
    expect(INSTANCE_COLOR_CHANNEL).toBe("color");
  });

  it("lifts colors past a `color` reachable only through the prototype", () => {
    const attributes = Object.create({ color: other }) as Record<string, DeviceInstanceAttribute>;
    const channels = deviceInstanceAttributesOf({
      residency: "device",
      assetId: "rock",
      count: 2,
      transforms,
      attributes,
      colors,
    });
    expect(channels.color?.handle).toBe(colors);
    expect(Object.keys(channels)).toEqual(["color"]);
  });

  it("lifts colors past a NON-ENUMERABLE own `color`", () => {
    const attributes: Record<string, DeviceInstanceAttribute> = {};
    Object.defineProperty(attributes, "color", { value: other, enumerable: false });
    const channels = deviceInstanceAttributesOf({
      residency: "device",
      assetId: "rock",
      count: 2,
      transforms,
      attributes,
      colors,
    });
    expect(channels.color?.handle).toBe(colors);
  });
});
