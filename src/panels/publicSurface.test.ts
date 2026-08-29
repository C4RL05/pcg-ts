/**
 * Pins the public surface of `pcg-ts/panels`. See
 * ../publicSurface.testsupport.ts for the rationale and the failure
 * playbook.
 *
 * This entry went unpinned longer than the others and the reason it now
 * is: `index.ts` re-exports `spec.ts` with a STAR, on the stated ground
 * that the module is the format and there is nothing in it a caller
 * should not see. That is true of the types, and it made the value
 * surface follow whatever `spec.ts` happened to export — which was
 * nothing at all until the matching rules shipped beside them. A star
 * over a file that grows helpers is how a name reaches consumers without
 * anyone deciding to publish it, which is exactly the drift the nine
 * withdrawals in ../publicSurface.test.ts were.
 *
 * `smoke-dist.mjs` still does not import this subpath, so nothing checks
 * that these names survive the BUILD the way it does for the root, gpu
 * and three entries.
 */
import { describe, expect, it } from "vitest";

import * as panels from "./index.js";
import { surfaceDiff, surfaceOf } from "../publicSurface.testsupport.js";

const PANELS_SURFACE = [
  // The parser, and the error it raises.
  "PanelSpecError", "parsePanelSpec",
  // The matching rules, published so a host renders an authored panel the
  // way its author saw it rather than reimplementing the semantics — and
  // so that "every entry must hold, a list means any of, values match
  // strictly" has ONE implementation rather than one per host.
  "isPanelConditionValue", "panelConditionHolds", "panelGateHolds", "panelRowVisible",
] as const;

describe("public surface: pcg-ts/panels", () => {
  it("exports exactly the reviewed set", () => {
    const drift = surfaceDiff(surfaceOf(panels), PANELS_SURFACE);
    expect(drift, drift).toBe("");
  });
});
