/**
 * `opts.seed: {from:"node", variant}` on a real adapter.
 *
 * The claim is EXACTNESS, not a budget, and the whole suite is arranged
 * to isolate it. A noise interior rounds in f32 and has published
 * tolerances (see `parity.device.test.ts`); a SEED has none, because a
 * one-bit disagreement there is not a rounding error in the output but
 * `hashCombine` avalanching to an unrelated u32 and the two paths cooking
 * different noise fields.
 *
 * So nothing here compares a GPU noise against a CPU noise. Each case
 * dispatches TWO kernels on the same device: one whose seed the kernel
 * derives from `params.seed`, and one whose seed is the literal
 * `hashCombine(graphSeed, variant)` the CPU computed in JS and the
 * compiler baked. The interior is the identical program in both, so its
 * rounding cancels exactly and a differing byte can only be the
 * derivation. The CPU pair is asserted the same way, as the control.
 */
import { describe, expect, it } from "vitest";
import { type Column, evaluateField } from "../fields/index.js";
import { type FieldSpec, fieldFromJson } from "../fields/fieldJson.js";
import { hashCombine } from "../random/hash.js";
import { compileFieldSpec } from "./compile.js";
import { PARITY_LAYOUT } from "./parity.testsupport.js";
import { type RunnerTask, decodeRun, dispatchTask, runDeviceTasks } from "./runnerClient.js";
import { deviceSuiteName, testDevice } from "./gpuDevice.testsupport.js";
import { makeParityGeometry } from "./testGeometry.js";

const COUNT = 16_384;
/** Two graph seeds, both past 2^24 so an f32 round trip could not carry them. */
const SEEDS = [0x51ed9a3b, 0xc0ffee01];
const VARIANT = 7;

/** One family: the ref form, and the literal seed it must be identical to. */
interface Family {
  readonly name: string;
  ref(): FieldSpec;
  literal(seed: number): FieldSpec;
}

const FAMILIES: Family[] = [
  ...["valueNoise", "perlinNoise", "simplexNoise"].map((fn) => ({
    name: fn,
    ref: () =>
      ({ fn, opts: { seed: { from: "node", variant: VARIANT }, frequency: 0.4 } }) as unknown as FieldSpec,
    literal: (seed: number) =>
      ({ fn, opts: { seed: hashCombine(seed, VARIANT), frequency: 0.4 } }) as unknown as FieldSpec,
  })),
  {
    name: "worleyNoise f2-f1 exact",
    ref: () =>
      ({
        fn: "worleyNoise",
        opts: { seed: { from: "node", variant: VARIANT }, frequency: 0.6, output: "f2-f1", exact: true },
      }) as unknown as FieldSpec,
    literal: (seed: number) =>
      ({
        fn: "worleyNoise",
        opts: { seed: hashCombine(seed, VARIANT), frequency: 0.6, output: "f2-f1", exact: true },
      }) as unknown as FieldSpec,
  },
  // Five octaves, so five derived seeds per lane: this is the row that
  // says the hoisted node half and the per-octave hash agree with the
  // CPU's `hashCombine(seed, o)` chain at every octave and not just the
  // first, which a single-octave case could not tell.
  {
    name: "fbm(perlin) x5",
    ref: () =>
      ({
        fn: "fbm",
        base: "perlinNoise",
        opts: {
          seed: { from: "node", variant: VARIANT },
          octaves: 5,
          frequency: 0.3,
          lacunarity: 2.1,
          gain: 0.45,
        },
      }) as unknown as FieldSpec,
    literal: (seed: number) =>
      ({
        fn: "fbm",
        base: "perlinNoise",
        opts: {
          seed: hashCombine(seed, VARIANT),
          octaves: 5,
          frequency: 0.3,
          lacunarity: 2.1,
          gain: 0.45,
        },
      }) as unknown as FieldSpec,
  },
  // A ref-seeded noise composed under ordinary arithmetic, so the seed
  // path is exercised where it is not the root of the kernel.
  {
    name: "composed",
    ref: () =>
      ({
        fn: "add",
        args: [
          { fn: "perlinNoise", opts: { seed: { from: "node", variant: VARIANT }, frequency: 0.5 } },
          { fn: "mul", args: [{ fn: "attribute", name: "density" }, 0.25] },
        ],
      }) as unknown as FieldSpec,
    literal: (seed: number) =>
      ({
        fn: "add",
        args: [
          { fn: "perlinNoise", opts: { seed: hashCombine(seed, VARIANT), frequency: 0.5 } },
          { fn: "mul", args: [{ fn: "attribute", name: "density" }, 0.25] },
        ],
      }) as unknown as FieldSpec,
  },
];

function bytesOf(col: Column): Uint8Array {
  return new Uint8Array(col.data.buffer, col.data.byteOffset, col.data.byteLength);
}

function firstDifferingByte(a: Column, b: Column): number {
  const ab = bytesOf(a);
  const bb = bytesOf(b);
  if (ab.length !== bb.length) return 0;
  for (let i = 0; i < ab.length; i++) if (ab[i] !== bb[i]) return i;
  return -1;
}

describe.skipIf(testDevice === null)(deviceSuiteName("node-derived noise seeds"), () => {
  it("the device derives exactly the seed the CPU derives", () => {
    const geo = makeParityGeometry(COUNT);
    const tasks: RunnerTask[] = [];
    const kernels = new Map<string, ReturnType<typeof compileFieldSpec>>();
    for (const family of FAMILIES) {
      for (const seed of SEEDS) {
        for (const [form, spec] of [
          ["ref", family.ref()],
          ["lit", family.literal(seed)],
        ] as const) {
          const name = `${family.name}|${form}|${seed}`;
          const kernel = compileFieldSpec(spec, PARITY_LAYOUT);
          kernels.set(name, kernel);
          tasks.push(dispatchTask(name, kernel, geo, COUNT, seed));
        }
      }
    }
    const results = runDeviceTasks(tasks);
    expect(results.every((r) => r.errors.length === 0)).toBe(true);
    const columns = new Map<string, Column>();
    for (const result of results) {
      columns.set(result.name, decodeRun(kernels.get(result.name)!, result.runs![0]));
    }
    for (const family of FAMILIES) {
      for (const seed of SEEDS) {
        const label = `${family.name} at seed ${seed}`;
        const ref = columns.get(`${family.name}|ref|${seed}`)!;
        const lit = columns.get(`${family.name}|lit|${seed}`)!;
        expect(firstDifferingByte(ref, lit), `${label}: first differing byte`).toBe(-1);
        // The CPU control, asserted the same way. Without it, a device
        // that ignored `params.seed` entirely and a CPU that did the same
        // would agree with each other and pass.
        const cpuRef = evaluateField(fieldFromJson(family.ref()), { geo, domain: "point", seed });
        const cpuLit = evaluateField(fieldFromJson(family.literal(seed)), {
          geo,
          domain: "point",
          seed,
        });
        expect(firstDifferingByte(cpuRef, cpuLit), `${label}: CPU control`).toBe(-1);
      }
    }
    // And the measurement can tell: one kernel at two graph seeds must
    // produce two different columns, or every equality above would be
    // vacuous.
    for (const family of FAMILIES) {
      const a = columns.get(`${family.name}|ref|${SEEDS[0]}`)!;
      const b = columns.get(`${family.name}|ref|${SEEDS[1]}`)!;
      expect(firstDifferingByte(a, b), `${family.name}: two graph seeds`).not.toBe(-1);
    }
  });

  it("one pipeline serves every graph seed", () => {
    // The regression a baked seed would cause, and the one an output
    // comparison cannot see: the kernel key is a function of the SPEC,
    // and the ref form puts no seed in it.
    const keys = new Set(
      SEEDS.map(() => compileFieldSpec(FAMILIES[1].ref(), PARITY_LAYOUT).key),
    );
    expect(keys.size).toBe(1);
    const baked = new Set(SEEDS.map((s) => compileFieldSpec(FAMILIES[1].literal(s), PARITY_LAYOUT).key));
    expect(baked.size).toBe(SEEDS.length);
  });
});
