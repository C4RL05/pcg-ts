/**
 * Corpus integrity (CPU-only, runs everywhere): the minimal corpus
 * tracks the grammar exactly (drift pin, mirroring the phase-19
 * MINIMAL_SPECS pin) and every corpus spec compiles against the corpus
 * layout — so the device validation suite can never silently shrink.
 *
 * Plus the twin pins: every measured parity family has a code-authored
 * counterpart whose DERIVED spec compiles to the byte-identical kernel
 * the authored spec compiles to. That equivalence is what makes it
 * legitimate for `parity.device.test.ts` to measure the derived forms
 * against the authored forms' budgets — and it makes a mis-written twin
 * fail here, loudly, instead of quietly measuring a different
 * expression on the device.
 */
import { describe, expect, it } from "vitest";
import { deviceSpec } from "../fields/spec.js";
import { getFieldSpec, listFieldFns } from "../nodes/fieldJson.js";
import { compileFieldSpec } from "./compile.js";
import {
  CORPUS_LAYOUT,
  DERIVED_FIELDS,
  MINIMAL_SPECS,
  PARITY_CASES,
  corpusSpecs,
} from "./corpus.testsupport.js";

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

describe("code-authored twins of the parity corpus", () => {
  it("the twin set and the parity table name exactly the same families (drift pin)", () => {
    // Bidirectional: an unmeasured twin is dead weight, and a family
    // without a twin would silently drop out of the derived-spec
    // measurement.
    expect(Object.keys(DERIVED_FIELDS).sort()).toEqual(
      PARITY_CASES.map((pc) => pc.name).sort(),
    );
  });

  it("parity family names are unique", () => {
    // The twin pairing is by name; a duplicate would map two families
    // onto one twin and hide the second.
    expect(new Set(PARITY_CASES.map((pc) => pc.name)).size).toBe(PARITY_CASES.length);
  });

  it("every twin carries a DERIVED spec (the population the flag admits)", () => {
    for (const pc of PARITY_CASES) {
      const field = DERIVED_FIELDS[pc.name]();
      expect(getFieldSpec(field), `${pc.name}: derived spec`).toBeDefined();
      // Derived, not authored: ineligible for the device by default,
      // eligible only under `acceptDerivedSpecs`.
      expect(deviceSpec(field, false), `${pc.name}: must not be authored`).toBeUndefined();
      expect(deviceSpec(field, true), `${pc.name}: must be device-eligible when accepted`).toBeDefined();
    }
  });

  it("each twin's derived spec compiles to the authored spec's exact kernel", () => {
    for (const pc of PARITY_CASES) {
      const derived = getFieldSpec(DERIVED_FIELDS[pc.name]());
      expect(derived, `${pc.name}: derived spec`).toBeDefined();
      const authoredKernel = compileFieldSpec(pc.spec, CORPUS_LAYOUT);
      const derivedKernel = compileFieldSpec(derived!, CORPUS_LAYOUT);
      // The key is the specialization identity (codegen version, the
      // spec's canonical structural key, the bound layout): equal keys
      // mean the two forms would share a pipeline cache entry.
      expect(derivedKernel.key, `${pc.name}: kernel key`).toBe(authoredKernel.key);
      // ...and the emitted source is identical text, not merely
      // equivalent, so nothing about the dispatch can differ.
      expect(derivedKernel.wgsl, `${pc.name}: wgsl`).toBe(authoredKernel.wgsl);
    }
  });

  it("the corpus layout carries every attribute the twins read", () => {
    // `normal` was added to CORPUS_LAYOUT (and makeCorpusGeometry) so
    // the examples-forest slope field could be carried verbatim; this pins
    // that the layout is not quietly narrowed back.
    expect(Object.keys(CORPUS_LAYOUT.attributes).sort()).toEqual([
      "P",
      "active",
      "density",
      "id",
      "material",
      "normal",
      "uv",
    ]);
  });
});
