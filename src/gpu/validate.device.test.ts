/**
 * Device front-end validation: every representative spec the phase-19
 * compiler can produce must be accepted by a real WGSL front end with
 * zero error-severity diagnostics (closing the `var<private>`-acceptance
 * risk flagged by the phase-19 audit). Executed in the plain-Node device
 * runner (see deviceRunner.mjs); skips visibly without an adapter.
 */
import { describe, expect, it } from "vitest";
import { compileFieldSpec } from "./compile.js";
import { CORPUS_LAYOUT, corpusSpecs } from "./corpus.js";
import { runDeviceTasks } from "./runnerClient.js";
import { deviceSuiteName, testDevice } from "./testDevice.js";

describe.skipIf(testDevice === null)(deviceSuiteName("WGSL front-end validation"), () => {
  it("accepts every representative kernel with zero errors", () => {
    const specs = corpusSpecs();
    const tasks = specs.map(({ name, spec }) => ({
      name,
      mode: "validate" as const,
      wgsl: compileFieldSpec(spec, CORPUS_LAYOUT).wgsl,
    }));
    const results = runDeviceTasks(tasks);
    expect(results.length).toBe(specs.length);
    const failures = results
      .filter((r) => r.errors.length > 0)
      .map((r) => `${r.name}: ${r.errors.join(" | ")}`);
    expect(failures, "kernels rejected by the device front end").toEqual([]);
  });
});
