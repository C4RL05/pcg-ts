/**
 * Pins the TYPE surface of `pcg-ts/three` — the interop entry's
 * interfaces and type aliases, which `publicSurface.test.ts` beside it
 * cannot see.
 *
 * WHAT THE VALUE PIN IS BLIND TO. `surfaceOf` reads `Object.keys` of the
 * imported namespace, and an `interface` leaves nothing there to key. Six
 * of the sixteen names below are the OPTIONS OBJECTS a host hands these
 * functions, and the rest are what it hands them or gets back — an
 * `AssetMap` to instance from, a `WebGpuRendererLike` to adopt buffers
 * into. Every one of them is a name a consumer writes the moment it puts
 * such a value in a variable, so withdrawing one breaks that consumer's
 * build while every assertion in the value pin still passes. See
 * ../publicTypeSurface.testsupport.ts for the root-entry case where that
 * actually happened.
 *
 * WHY IT IS HERE AND NOT BESIDE THE ROOT ONE. `noThreeInCore.test.ts`
 * forbids any file outside src/three from reaching three, and reading this
 * entry's values means importing it. The root type test could name
 * src/three/index.ts as a program entry without importing it — but not
 * without giving up the cross-check below, which is the assertion that
 * makes either pin trustworthy. One file per entry point, for the same
 * reason the value pins are one per entry point.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";

import * as three from "./index.js";
import { surfaceDiff, surfaceOf } from "../publicSurface.testsupport.js";
import { entryPointSurface } from "../publicTypeSurface.testsupport.js";

/**
 * Every interface and type alias `pcg-ts/three` publishes.
 *
 * Sorted, and generated FROM the checker rather than typed by hand —
 * re-generate with the same call the test makes rather than editing an
 * entry in place, so the list cannot drift into a shape the checker never
 * produces.
 *
 * Adding a name here is the same decision as adding one to THREE_SURFACE:
 * say why in the barrel that exports it, not only here.
 */
const THREE_TYPE_SURFACE = [
  "AssetMap", "DeviceCellBounds", "DeviceInstanceAdapter", "DeviceInstanceBinding",
  "DeviceInstanceContext", "InstancedAsset", "ToBufferGeometryOptions",
  "ToInstancedMeshesOptions", "ToPointsOptions", "ToThreeGeometryOptions",
  "WebGpuInstanceAdapter", "WebGpuInstanceAdapterOptions", "WebGpuInstanceAdapterStats",
  "WebGpuRendererLike", "WorldThreeBinding", "WorldThreeBindingOptions",
] as const;

/**
 * What this entry exports as a type AND a value: the one `class` here.
 *
 * Kept beside the type list because it is a SUBSET of it, not a third
 * surface -- it already appears in THREE_TYPE_SURFACE and in the value
 * pin.
 *
 * A single entry is not a reason to assert the count instead. The pin is
 * what catches `WorldThreeBinding` being demoted to an interface, which
 * removes `new WorldThreeBinding()` from the API — the only way a host
 * ever obtains one — while both name lists stay identical.
 */
const DUAL_SURFACE = ["WorldThreeBinding"] as const;

/** Building a program is seconds, not milliseconds. */
const PROGRAM_MS = 120_000;

describe("public type surface: pcg-ts/three", () => {
  it(
    "publishes exactly the types this list names",
    () => {
      const surface = entryPointSurface(
        path.join(process.cwd(), "src/three/index.ts"),
        path.join(process.cwd(), "tsconfig.json"),
      );
      const diff = surfaceDiff([...surface.types], THREE_TYPE_SURFACE);
      expect(diff, diff).toBe("");
    },
    PROGRAM_MS,
  );

  /**
   * THE CROSS-CHECK, and the reason this file pins one list rather than
   * two. The checker and `Object.keys` are two independent readings of
   * the same entry point, so if they disagree about the VALUES then one
   * of them is wrong about the types too and neither pin can be trusted.
   * Asserting the equivalence live — rather than pinning a second copy of
   * the value list here — means there is still exactly ONE list of value
   * names per entry point, and this test proves the mechanism that reads
   * the types agrees with the mechanism that has been guarding the values
   * all along.
   */
  it(
    "agrees with Object.keys about which names are values",
    () => {
      const surface = entryPointSurface(
        path.join(process.cwd(), "src/three/index.ts"),
        path.join(process.cwd(), "tsconfig.json"),
      );
      expect(
        [...surface.values],
        "the checker and the module object disagree about the value surface, so one of them " +
          "is also wrong about the types and neither pin means anything until it is resolved",
      ).toEqual(surfaceOf(three));
    },
    PROGRAM_MS,
  );

  it(
    "names exactly the exports that are both a type and a value",
    () => {
      const surface = entryPointSurface(
        path.join(process.cwd(), "src/three/index.ts"),
        path.join(process.cwd(), "tsconfig.json"),
      );
      const both = surface.types.filter((n) => surface.values.includes(n));
      const diff = surfaceDiff(both, DUAL_SURFACE);
      expect(diff, diff).toBe("");
    },
    PROGRAM_MS,
  );
});
