/**
 * Pins the public surface of `pcg-ts/gpu`. Lives inside src/gpu because
 * noGpuInCore.test.ts forbids any core file from importing this module —
 * only tests in here may. See ../publicSurface.testsupport.ts for the
 * rationale and the failure playbook.
 */
import { describe, expect, it } from "vitest";

import * as gpu from "./index.js";
import { surfaceDiff, surfaceOf } from "../publicSurface.testsupport.js";

const GPU_SURFACE = [
  "BUFFER_USAGE", "GpuCompileError", "GpuFieldEvaluator", "MAP_MODE", "WEBGPU_BACKEND",
  "compileFieldSpec", "deviceTransformsBuffer", "supportedGpuFieldFns",
] as const;

describe("public surface: pcg-ts/gpu", () => {
  it("exports exactly the reviewed set", () => {
    const drift = surfaceDiff(surfaceOf(gpu), GPU_SURFACE);
    expect(drift, drift).toBe("");
  });
});
