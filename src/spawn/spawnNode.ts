/**
 * The spawnInstances node: the graph's render-agnostic spawner terminal.
 * Turns a point cloud into instance batches a renderer adapter (e.g.
 * `pcg-ts/three`'s `toInstancedMeshes`) can draw directly.
 */
import { makeInstancesItem } from "../graph/index.js";
import { standardNode } from "../nodes/registry.js";
import { requireGeometryItem } from "../nodes/util.js";
import { buildInstanceBatches } from "./instances.js";

/** Params of {@link spawnInstances}. */
export interface SpawnInstancesParams {
  assetId: string;
  assetAttr: string;
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
    "back to assetId. The 'instances' pin emits one instances item (input tags carried over); " +
    "'points' passes the input geometry through unchanged for chaining or debug rendering.",
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
   * No `eligible` gate: both `assetId` and `assetAttr` spawns are
   * device-resident. A multi-asset spawn needs no device-side sort — the
   * asset column is host-resident by construction, so the host plans the
   * grouping (shared code with the CPU spawner, hence identical batch
   * order) and the device composes one buffer per asset. The param
   * failures the CPU spawner throws on (a missing or non-string
   * `assetAttr`) are rejected by the run planner instead, which puts the
   * node back on this execute so it raises the identical message.
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
    });
    return {
      instances: [makeInstancesItem(batches, item.tags)],
      // Pass-through keeps the input item (and its rev) intact so
      // downstream caches stay warm when the points are unchanged.
      points: [item],
    };
  },
});
