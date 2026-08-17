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
import { getFieldSpec, listFieldFns } from "../fields/fieldJson.js";
import { compileFieldSpec } from "./compile.js";
import {
  PARITY_LAYOUT,
  DERIVED_FIELDS,
  MINIMAL_SPECS,
  PARITY_CASES,
  PARITY_COUNT,
  PARITY_SWEEP_COUNTS,
  paritySpecs,
} from "./parity.testsupport.js";

/** Grammar fns whose output is a hash lattice — the count-sensitive ones. */
const NOISE_FNS = new Set(["valueNoise", "perlinNoise", "simplexNoise", "worleyNoise", "fbm"]);
import { dispatchTask } from "./runnerClient.js";
import { makeParityGeometry } from "./testGeometry.js";

describe("device-test corpus", () => {
  it("minimal corpus covers every grammar fn (drift pin)", () => {
    expect(Object.keys(MINIMAL_SPECS).sort()).toEqual(listFieldFns());
  });

  it("every corpus spec compiles against the corpus layout", () => {
    for (const { name, spec } of paritySpecs()) {
      const kernel = compileFieldSpec(spec, PARITY_LAYOUT);
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
      const authoredKernel = compileFieldSpec(pc.spec, PARITY_LAYOUT);
      const derivedKernel = compileFieldSpec(derived!, PARITY_LAYOUT);
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
    // `normal` was added to PARITY_LAYOUT (and makeParityGeometry) so
    // the examples-forest slope field could be carried verbatim, and
    // `species` so the corpus could carry `attributeIs` — which cannot be
    // compiled against a layout holding no string column at all. This
    // pins that the layout is not quietly narrowed back.
    expect(Object.keys(PARITY_LAYOUT.attributes).sort()).toEqual([
      "P",
      "active",
      "density",
      "id",
      "material",
      "normal",
      "species",
      "uv",
    ]);
  });
});

describe("parity budget shape", () => {
  /** True when `spec` reads any noise anywhere in its tree. */
  function usesNoise(spec: unknown): boolean {
    if (Array.isArray(spec)) return spec.some(usesNoise);
    if (spec === null || typeof spec !== "object") return false;
    const node = spec as { fn?: unknown; args?: unknown; base?: unknown };
    if (typeof node.fn === "string" && NOISE_FNS.has(node.fn)) return true;
    return usesNoise(node.args);
  }

  it("every family reading a noise is marked countSensitive", () => {
    // The defect this flag exists for: a noise family's worst lane is an
    // extreme-value statistic that climbs with the element count, so a
    // budget measured at one count is a statement about that cloud size
    // and not about the family. Five noise budgets were exceeded that
    // way by an unchanged compiler. Adding a noise family without
    // sweeping it would re-open exactly that hole, so the pin is
    // structural rather than a list someone has to remember to extend.
    const missing = PARITY_CASES.filter(
      (pc) => pc.exact !== true && usesNoise(pc.spec) && pc.countSensitive !== true,
    ).map((pc) => pc.name);
    expect(missing, "noise families missing countSensitive").toEqual([]);
  });

  it("the countSensitive set is exactly the measured growing families", () => {
    // The structural pin above covers the noise families. Five more grow
    // with count WITHOUT reading a noise (measured 10k → 1M: ramp +17%,
    // sin/cos +10%, tan +15%, pow +17%, length/normalize +33%), and
    // nothing about their specs says so — so they are pinned by name. Dropping the flag
    // from one of them would silently do two things at once: remove it
    // from the count sweep, and relax its budget derivation from 1.5x
    // headroom to 1.25x. Neither would fail any other test.
    expect(PARITY_CASES.filter((pc) => pc.countSensitive === true).map((pc) => pc.name).sort()).toEqual(
      [
        "composite",
        "fbm perlin",
        "fbm simplex",
        "fbm value",
        "fbm worley",
        "length/normalize",
        "perlinNoise normalized",
        "perlinNoise raw",
        "pow",
        "ramp",
        "simplexNoise normalized",
        "simplexNoise raw",
        "sin/cos",
        "tan",
        "valueNoise normalized",
        "valueNoise raw",
        "worley exact f2-f1",
        "worley f1",
        "worley f2",
        "worley f2-f1 normalized",
      ].sort(),
    );
  });

  it("every non-exact family carries both budgets, and exact families carry neither", () => {
    // `rangeUlp` and `meanAbs` are asserted together because they fail
    // for different reasons (a deeper tail vs a shifted interior); a
    // family with only one of them is half-measured. A zero `meanAbs` on
    // a non-exact family would also be an un-meetable knife edge.
    for (const pc of PARITY_CASES) {
      if (pc.exact === true) {
        expect(pc.budget, `${pc.name}: exact family budget`).toBe(0);
        expect(pc.meanAbs, `${pc.name}: exact family meanAbs`).toBe(0);
      } else {
        expect(pc.budget, `${pc.name}: rangeUlp budget`).toBeGreaterThan(0);
        expect(pc.meanAbs, `${pc.name}: meanAbs budget`).toBeGreaterThan(0);
      }
    }
  });

  it("the swept counts bracket the pinned count", () => {
    // The sweep exists to move the measurement OFF a single cloud size.
    // Counts that all sat below PARITY_COUNT (or all above it) would
    // leave the pinned count on the edge of the measured range instead
    // of inside it.
    expect(Math.min(...PARITY_SWEEP_COUNTS)).toBeLessThan(PARITY_COUNT);
    expect(Math.max(...PARITY_SWEEP_COUNTS)).toBeGreaterThan(PARITY_COUNT);
  });
});

describe("device runner protocol", () => {
  it("refuses to dispatch a kernel whose uniform it cannot write", () => {
    // The runner hardcodes the bare 12-byte {count, seed, chunkOffset}
    // uniform. The corpus now carries a `param` spec — for front-end
    // VALIDATION, which needs no uniform — so a dispatch of one is one
    // line away, and would bind 12 bytes to a 16 + 16n struct and read
    // whatever the driver left past the header.
    const kernel = compileFieldSpec(MINIMAL_SPECS.param, PARITY_LAYOUT);
    expect(kernel.constSlots).toBe(1);
    expect(() => dispatchTask("min:param", kernel, makeParityGeometry(4), 4, 0)).toThrow(
      /uniform constant slot\(s\) for param\(s\) "amplitude".*cannot carry their values/s,
    );
  });

  it("...and still dispatches every param-free corpus kernel", () => {
    const geo = makeParityGeometry(4);
    for (const { name, spec } of paritySpecs()) {
      const kernel = compileFieldSpec(spec, PARITY_LAYOUT);
      if (kernel.constSlots > 0) continue;
      expect(() => dispatchTask(name, kernel, geo, 4, 0), name).not.toThrow();
    }
  });
});
