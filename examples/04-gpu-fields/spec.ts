/**
 * Field-expression JSON for the GPU fields demo. Both specs are built as
 * declarative FieldSpec trees (`fieldFromJson`) so they carry a
 * serializable spec — the precondition for the `pcg-ts/gpu` compiler to
 * lower them to one WGSL compute kernel each. They are deliberately
 * chunky: fbm(simplex) + worley + randomField + ramps + arithmetic, so
 * the dispatched kernel is nontrivial and the CPU/GPU wall-time gap is
 * visible at large point counts.
 */
import type { FieldSpec } from "pcg-ts";

/**
 * Scalar "shade" in [0, 1]: 5-octave simplex fbm blended with a worley
 * ridge term and a per-point random sparkle. Shared by the three tint
 * ramps below — the compiler dedups the shared subtree, so it is
 * computed once per point on the GPU.
 */
function shadeSpec(frequency: number): FieldSpec {
  return {
    fn: "clamp",
    args: [
      {
        fn: "add",
        args: [
          {
            fn: "add",
            args: [
              {
                fn: "mul",
                args: [
                  { fn: "fbm", base: "simplexNoise", opts: { frequency, octaves: 5, normalized: true } },
                  0.62,
                ],
              },
              {
                fn: "mul",
                args: [
                  {
                    fn: "worleyNoise",
                    opts: { frequency: frequency * 2.1, output: "f2-f1", normalized: true },
                  },
                  0.3,
                ],
              },
            ],
          },
          { fn: "mul", args: [{ fn: "randomField", key: "sparkle" }, 0.08] },
        ],
      },
      0,
      1,
    ],
  };
}

/**
 * Per-point color (tuple 3): the shared shade drives three color ramps
 * (deep indigo → blue → cyan → amber → warm white), assembled with
 * `vec`. One GPU dispatch produces the whole f32x3 column.
 */
export function tintSpec(frequency: number): FieldSpec {
  const shade = shadeSpec(frequency);
  return {
    fn: "vec",
    args: [
      { fn: "ramp", args: [shade], stops: [[0, 0.02], [0.3, 0.05], [0.55, 0.1], [0.75, 0.95], [1, 1]] },
      { fn: "ramp", args: [shade], stops: [[0, 0.03], [0.3, 0.25], [0.55, 0.75], [0.75, 0.7], [1, 0.97]] },
      { fn: "ramp", args: [shade], stops: [[0, 0.1], [0.3, 0.55], [0.55, 0.8], [0.75, 0.25], [1, 0.9]] },
    ],
  };
}

/**
 * Per-axis jitter amount (tuple 3): three low-frequency perlin bands,
 * one per axis, remapped into [0, 0.9] so some regions of the cloud
 * wobble far more than others.
 *
 * This one is written to a `wobble` attribute by the first member of
 * the fused chain and read straight back by `jitterPoints` through
 * `{ fn: "attribute", name: "wobble" }`. That is the device-resident
 * case worth showing: a later member reading an attribute an earlier
 * member wrote, with no readback in between — on the per-node path the
 * same two nodes cost two full column round trips.
 */
export function wobbleSpec(frequency: number): FieldSpec {
  const axis = (seed: number, offset: [number, number, number]): FieldSpec => ({
    fn: "remap",
    args: [
      { fn: "perlinNoise", opts: { seed, frequency: frequency * 0.8, offset, normalized: true } },
      0,
      1,
      0,
      0.9,
    ],
  });
  return {
    fn: "vec",
    args: [axis(11, [0, 0, 0]), axis(23, [37, 5, -19]), axis(47, [-11, 61, 5])],
  };
}

/**
 * Per-point size (scalar): points near worley feature centers grow
 * (clumpy starfield look), plus a hashed per-point jitter.
 */
export function sizeSpec(frequency: number): FieldSpec {
  return {
    fn: "add",
    args: [
      0.35,
      {
        fn: "add",
        args: [
          { fn: "mul", args: [{ fn: "randomField", key: "size" }, 0.5] },
          {
            fn: "mul",
            args: [
              {
                fn: "ramp",
                args: [
                  {
                    fn: "worleyNoise",
                    opts: { frequency: frequency * 1.4, output: "f1", normalized: true },
                  },
                ],
                stops: [[0, 1], [0.4, 0.35], [1, 0.05]],
              },
              1.6,
            ],
          },
        ],
      },
    ],
  };
}
