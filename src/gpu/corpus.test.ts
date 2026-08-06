/**
 * Corpus integrity (CPU-only, runs everywhere): the minimal corpus
 * tracks the grammar exactly (drift pin, mirroring the phase-19
 * MINIMAL_SPECS pin) and every corpus spec compiles against the corpus
 * layout — so the device validation suite can never silently shrink.
 */
import { describe, expect, it } from "vitest";
import { listFieldFns } from "../nodes/fieldJson.js";
import { compileFieldSpec } from "./compile.js";
import { CORPUS_LAYOUT, MINIMAL_SPECS, corpusSpecs } from "./corpus.js";

describe("device-test corpus", () => {
  it("minimal corpus covers every grammar fn (drift pin)", () => {
    expect(Object.keys(MINIMAL_SPECS).sort()).toEqual(listFieldFns());
  });

  it("every corpus spec compiles against the corpus layout", () => {
    for (const { name, spec } of corpusSpecs()) {
      const kernel = compileFieldSpec(spec, CORPUS_LAYOUT);
      expect(kernel.wgsl, name).toContain("@compute");
    }
  });
});
