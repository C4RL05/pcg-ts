/**
 * Builds the declarative FieldSpec JSON for the playground's control
 * state. Kept separate from the Svelte panel so the JSON grammar logic is
 * plain TypeScript.
 */
import type { FieldSpec } from "pcg-ts";

/** Control state the panel edits. */
export interface PlaygroundParams {
  noise: string;
  frequency: number;
  octaves: number;
  outMin: number;
  outMax: number;
  seed: number;
}

/** Selectable noises (worley variants and fbm stacks included). */
export const NOISE_OPTIONS: readonly { id: string; label: string }[] = [
  { id: "value", label: "Value" },
  { id: "perlin", label: "Perlin" },
  { id: "simplex", label: "Simplex" },
  { id: "worley-f1", label: "Worley F1" },
  { id: "worley-f2", label: "Worley F2" },
  { id: "worley-f2f1", label: "Worley F2−F1" },
  { id: "fbm-perlin", label: "fBm · Perlin" },
  { id: "fbm-simplex", label: "fBm · Simplex" },
  { id: "fbm-value", label: "fBm · Value" },
];

/** Whether the given noise id layers octaves (enables the octave slider). */
export function isFbm(noise: string): boolean {
  return noise.startsWith("fbm-");
}

/**
 * The full field expression: base noise remapped from its natural output
 * range onto [outMin, outMax]. This exact JSON round-trips through
 * `fieldFromJson` / `fieldToJson`.
 */
export function buildSpec(p: PlaygroundParams): FieldSpec {
  const opts = { seed: p.seed, frequency: p.frequency };
  let base: FieldSpec;
  let inMin: number;
  let inMax: number;
  switch (p.noise) {
    case "value":
      base = { fn: "valueNoise", opts };
      inMin = 0;
      inMax = 1;
      break;
    case "perlin":
      base = { fn: "perlinNoise", opts };
      inMin = -1;
      inMax = 1;
      break;
    case "simplex":
      base = { fn: "simplexNoise", opts };
      inMin = -1;
      inMax = 1;
      break;
    case "worley-f1":
      base = { fn: "worleyNoise", opts: { ...opts, output: "f1" } };
      inMin = 0;
      inMax = 1;
      break;
    case "worley-f2":
      base = { fn: "worleyNoise", opts: { ...opts, output: "f2" } };
      inMin = 0;
      inMax = 1.4;
      break;
    case "worley-f2f1":
      base = { fn: "worleyNoise", opts: { ...opts, output: "f2-f1" } };
      inMin = 0;
      inMax = 1;
      break;
    default: {
      // fbm-<base>: amplitude sum for gain 0.5 is (1 - 0.5^octaves) / 0.5.
      const inner =
        p.noise === "fbm-simplex"
          ? "simplexNoise"
          : p.noise === "fbm-value"
            ? "valueNoise"
            : "perlinNoise";
      base = { fn: "fbm", base: inner, opts: { ...opts, octaves: p.octaves } };
      const amp = (1 - 0.5 ** p.octaves) / 0.5;
      inMin = inner === "valueNoise" ? 0 : -amp;
      inMax = amp;
      break;
    }
  }
  return { fn: "remap", args: [base, inMin, inMax, p.outMin, p.outMax] };
}
