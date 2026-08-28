/**
 * Pins the public surface of `pcg-ts/three`. Lives inside src/three
 * because noThreeInCore.test.ts forbids any core file from reaching three,
 * directly or through this module. See ../publicSurface.testsupport.ts for
 * the rationale and the failure playbook.
 */
import { describe, expect, it } from "vitest";

import * as three from "./index.js";
import { surfaceDiff, surfaceOf } from "../publicSurface.testsupport.js";

const THREE_SURFACE = [
  "WorldThreeBinding", "checkAdoptionSeam", "createWebGpuInstanceAdapter",
  "fromBufferGeometry", "fromCurve",
  // Half of `toInstancedMeshes`' disposal contract: a batch carrying
  // named per-instance channels gets a GEOMETRY CLONE (a channel is a
  // geometry attribute, so it cannot be shared), and only the caller
  // disposing the mesh can dispose that clone. A caller writing its own
  // teardown instead of using WorldThreeBinding has to be able to ask.
  "ownsGeometry",
  "toBufferGeometry", "toDeviceInstanceObjects",
  "toInstancedMeshes", "toLineGeometry", "toPointsObject",
] as const;

describe("public surface: pcg-ts/three", () => {
  it("exports exactly the reviewed set", () => {
    const drift = surfaceDiff(surfaceOf(three), THREE_SURFACE);
    expect(drift, drift).toBe("");
  });
});
