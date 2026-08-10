/**
 * The spawnInstances node: the graph's render-agnostic spawner terminal.
 * Turns a point cloud into instance batches a renderer adapter (e.g.
 * `pcg-ts/three`'s `toInstancedMeshes`) can draw directly.
 */
import { makeInstancesItem } from "../graph/index.js";
import { standardNode } from "../nodes/registry.js";
import { requireGeometryItem } from "../nodes/util.js";
import { MAX_INSTANCES, buildInstanceBatches } from "./instances.js";

/** Params of {@link spawnInstances}. */
export interface SpawnInstancesParams {
  assetId: string;
  assetAttr: string;
  colorAttr: string;
}

/** Spawner terminal: points → instance batches (plus point pass-through). */
export const spawnInstances = standardNode<SpawnInstancesParams>({
  type: "spawnInstances",
  category: "spawn",
  description:
    "Spawner terminal: converts the input point cloud into render-agnostic instance batches. " +
    "Each point becomes one instance with world matrix T(P) * R(rot) * S(scale) (column-major " +
    "4x4, THREE.Matrix4.elements layout; missing rot/scale attributes are identity). Points are " +
    "grouped into one batch per asset id, in first-occurrence order: assetAttr (when non-empty) " +
    "names a string point attribute holding per-point asset ids — empty per-point values fall " +
    "back to assetId. colorAttr (when non-empty) additionally carries a per-instance RGB read " +
    "from that point attribute, which is how instances of ONE asset id vary in appearance — " +
    "age, health, season, a hue drift — without splitting into more assets. The 'instances' pin " +
    "emits one instances item (input tags carried over); 'points' passes the input geometry " +
    `through unchanged for chaining or debug rendering. One cook may spawn at most ${MAX_INSTANCES} ` +
    "instances (one per input point); a runaway density is refused with a diagnostic rather " +
    "than an allocation failure. That budget is per COOK, not per world, so a streamed world " +
    "cooking one cell at a time may hold many times it across its resident cells.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [
    { name: "instances", kind: "instances" },
    { name: "points", kind: "geometry" },
  ],
  params: {
    assetId: {
      type: "string",
      default: "asset",
      description:
        "Asset id stamped on every instance not overridden per point via assetAttr. The " +
        "renderer resolves it to an actual renderable (e.g. the three adapter's asset map).",
    },
    assetAttr: {
      type: "string",
      default: "",
      description:
        "Optional name of a string point attribute holding per-point asset ids; empty string " +
        "disables the override. Points whose attribute value is empty use assetId instead. " +
        "Errors when the named attribute is missing or not a string attribute. Device-resident " +
        "spawning supports it: the grouping is planned on the CPU (the asset column is always " +
        "host-resident) and the device composes one transform buffer per asset, in the same " +
        "batch order the CPU path produces.",
    },
    colorAttr: {
      type: "string",
      default: "",
      description:
        "Optional name of an f32 point attribute (tupleSize 3 or more) whose components 0, 1 " +
        "and 2 are carried to the renderer as each instance's RGB. ALPHA IS DROPPED — both " +
        "three adapters take RGB, so a fourth component (the standard `color` attribute is " +
        "f32x4) has nowhere to go and is not carried. Empty (the default) carries no colour at " +
        "all, and the renderer then leaves its instance-colour channel untouched. Nothing is " +
        "picked up automatically and nothing scans the values: every point cloud in this " +
        "library already carries `color` at [1,1,1,1], so its presence says nothing about " +
        "intent, and writing an all-white instance-colour buffer would recompile the renderer's " +
        "shader for zero pixels changed. Naming it is what states the intent — which also means " +
        "an attribute written upstream and never named here is silently NOT drawn. Any " +
        "colour-shaped attribute works: `color`, or a `tint`/`speciesColor` written with " +
        "setAttribute. Errors when the named attribute is missing or is not f32 with tupleSize " +
        ">= 3, listing the attributes that would fit.",
    },
  },
  /**
   * Device-resident terminal: a resolver advertising the
   * "spawnInstances" kind composes every instance matrix on the device
   * inside the fused run and emits an instances item holding a retained
   * device buffer instead of `Float32Array`s — no P/rot/scale readback,
   * no CPU compose loop. Terminal-only, so a chain never continues
   * through it; its second output ("points") is a geometry pass-through
   * that the run materializes only when something actually reads it.
   *
   * Inert unless the caller opted in (`GpuFieldEvaluator`'s
   * `deviceInstances`), so the default cook — CPU or GPU — is
   * byte-for-byte what it has always been.
   *
   * No `eligible` gate, and none of the three params earns one. Both
   * `assetId` and `assetAttr` spawns are device-resident: a multi-asset
   * spawn needs no device-side sort, since the asset column is
   * host-resident by construction, so the host plans the grouping (shared
   * code with the CPU spawner, hence identical batch order) and the
   * device composes one buffer per asset. `colorAttr` is device-resident
   * too — the compose kernel gathers the RGB alongside the matrix, from
   * the one source index, into a second retained buffer. A colour is
   * copied rather than computed, so the device bytes equal the CPU
   * batch's exactly and there is nothing for a gate to protect.
   *
   * The param failures the CPU spawner throws on (a missing or non-string
   * `assetAttr`; a missing or non-f32x3+ `colorAttr`) and its
   * `MAX_INSTANCES` budget are rejected by the run planner instead, which
   * puts the node back on this execute so it raises the identical
   * message. That is deliberate: a diagnostic worth writing is worth
   * having exactly one copy of.
   */
  resident: {
    kind: "spawnInstances",
    terminal: true,
  },
  execute({ inputs, params }) {
    // A spawner is a terminal: whatever it drops here never reaches a
    // renderer and nothing downstream can notice. It shares the standard
    // library's single-geometry contract so several connected geometries
    // raise the same diagnostic instead of spawning only the first.
    const item = requireGeometryItem(inputs, "in", "spawnInstances");
    const batches = buildInstanceBatches(item.geo, {
      defaultAssetId: params.assetId,
      ...(params.assetAttr !== "" ? { assetAttr: params.assetAttr } : {}),
      ...(params.colorAttr !== "" ? { colorAttr: params.colorAttr } : {}),
    });
    return {
      instances: [makeInstancesItem(batches, item.tags)],
      // Pass-through keeps the input item (and its rev) intact so
      // downstream caches stay warm when the points are unchanged.
      points: [item],
    };
  },
});
