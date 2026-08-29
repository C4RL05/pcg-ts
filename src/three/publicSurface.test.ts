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
  // `toInstancedMeshes`' disposal contract, which a caller writing its
  // own teardown instead of using WorldThreeBinding has to be able to
  // run: which slots a mesh's material occupies (`mesh.material` is a
  // union, and casting it away disposes slot 0 and leaks the rest),
  // whether those materials are the library's to dispose at all (false
  // exactly for a `materialFor` result), and whether the geometry is a
  // per-batch CLONE (a named channel is a geometry attribute, so it
  // cannot be shared) rather than the asset map's shared one.
  "materialListOf", "ownsGeometry", "ownsMaterial",
  "toBufferGeometry", "toDeviceInstanceObjects",
  "toInstancedMeshes", "toLineGeometry", "toPointsObject",
] as const;

describe("public surface: pcg-ts/three", () => {
  it("exports exactly the reviewed set", () => {
    const drift = surfaceDiff(surfaceOf(three), THREE_SURFACE);
    expect(drift, drift).toBe("");
  });
});
