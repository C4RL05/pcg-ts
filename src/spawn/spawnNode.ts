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
  instanceAttrs: readonly string[];
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
    "age, health, season, a hue drift — without splitting into more assets. instanceAttrs " +
    "carries any other point attributes as NAMED channels on the batch, dtype and tuple size " +
    "preserved, which is how graph-authored data a host must animate (a phase, an id, an RGBA) " +
    "reaches it at all: the field grammar has no time input, so the graph settles the structure " +
    "and the host drives it from these channels. The 'instances' pin " +
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
        "renderer resolves it to an actual renderable (e.g. the three adapter's asset map). " +
        "ANY STRING IS ACCEPTED and none is checked, because the set of real ids belongs to " +
        "the host and the library has never met it — an invented id cooks perfectly and then " +
        "renders as whatever that host does with a name it does not know, which for a viewer " +
        "of arbitrary graphs is usually a stand-in shape rather than an error. So confirm the " +
        "spelling against the renderer you are targeting. `pcg assets <graph.json>` lists " +
        "every id a graph can emit, this param and the assetAttr tables together, which is " +
        "the list to check against that host.",
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
    instanceAttrs: {
      type: "stringList",
      default: [],
      description:
        "Point attributes to carry to the renderer as NAMED per-instance channels, in the order " +
        "given: each becomes batch.attributes[<the attribute's own name>], a tightly packed " +
        "column of count * tupleSize elements with instance k at k * tupleSize. This is the " +
        "whole per-instance ABI between a graph and its host. The field grammar has no time " +
        "input on purpose — a graph produces STRUCTURE and the host animates it — so anything " +
        "the host must drive per instance at runtime (a phase offset, a stable id, a species " +
        "index, an RGBA tint, a wind stiffness) has to leave the graph on this list; before it " +
        "existed only transforms and RGB could cross, and a host had to re-derive the rest from " +
        "a position, which stopped agreeing with the graph that authored it. DTYPE AND TUPLE " +
        "SIZE ARE PRESERVED, not widened to f32: a u32 id past 2^24 does not survive f32, and " +
        "THREE.InstancedBufferAttribute takes any typed array, so nothing downstream wants the " +
        "widening. Item size is recovered by the consumer as column.length / count — it is not " +
        "carried, so there is no second place for it to be wrong. The one exception to \"in the " +
        "order given\" is the one JS imposes on every object: an integer-like channel name " +
        '("12") is hoisted ahead of the string ones in the record — deterministic either way, ' +
        "just not always the order written. Instance order is the " +
        "invariant: attributes[name][k] and transforms[k] are the same instance, written in one " +
        "loop from one source index. Empty (the default) carries nothing and allocates nothing. " +
        "FIVE things error, each naming the way out — and all but the first the offending entry, " +
        "since an empty name has none to give — in the order they are checked, per entry rather " +
        "than as a ranking across the list: an EMPTY name (drop that entry, or clear " +
        "instanceAttrs to carry nothing); " +
        "the same name listed TWICE (a channel is named after its attribute, so a repeat would " +
        'be one channel listed twice); the reserved name "color", which is checked BEFORE the ' +
        "lookup and so reports as reserved even when no such attribute exists (a renderer binds " +
        "instance colour structurally, so colorAttr carries it instead; copy the attribute to " +
        "another name upstream to carry RGBA, which colorAttr's alpha drop cannot); an " +
        "attribute MISSING from the point domain (the message lists the point attributes that " +
        "could become channels); and a STRING attribute (its column is indices into a string " +
        "table that does not travel with it — use assetAttr for per-point asset ids). " +
        "TWO MORE refusals live at the RENDERER seam rather than here, so they cook clean and " +
        "throw later, in toInstancedMeshes: a channel named after something three already means " +
        "(position, normal, uv, instanceMatrix and more), which would overwrite the asset's " +
        "vertex data, and a channel wider than 4 components, which a vertex attribute cannot " +
        "carry — split it upstream into several narrower ones. " +
        "Device production is OPT-IN: the GPU evaluator's `deviceInstanceAttrs` (which requires " +
        "`deviceInstances`) gathers each channel into its own device buffer beside the " +
        "transforms, for a host that binds them itself from " +
        "batch.attributes[name].handle.resource. Default off, and off is what it always was: a " +
        "spawn naming any channel falls back to the CPU spawner for the whole terminal, with the " +
        "transforms it composes there.",
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
   * `instanceAttrs` is the ONE param whose device production is OPT-IN,
   * and it is decided by the run planner rather than gated here (an
   * `eligible` predicate would keep the node off every resident run in
   * the graph, where the planner rejects only the run that actually names
   * channels). Without the resolver's `deviceInstanceAttrs` the planner
   * rejects such a run, the terminal falls back per-node and the CPU
   * spawner composes the transforms AND the channels together — never a
   * device run silently dropping data a host is about to bind. With it,
   * each channel is gathered into its own retained buffer beside the
   * transforms, by its own kernel rather than more bindings on the
   * compose one (whose widest form already binds seven storage buffers
   * against the baseline `maxStorageBuffersPerShaderStage` of 8, so
   * folding channels in would have bought exactly one). It is a separate
   * flag because it moves an obligation: `pcg-ts/three`'s device adapter
   * binds the matrix and the reserved colour and refuses every other
   * channel by name, so a graph rendering through it works only while
   * the flag is off, and the host that turns it on binds the buffers
   * itself from `batch.attributes[name].handle.resource`.
   *
   * No `eligible` gate, and none of the other three params earns one. Both
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
      ...(params.instanceAttrs.length > 0 ? { instanceAttrs: params.instanceAttrs } : {}),
    });
    return {
      instances: [makeInstancesItem(batches, item.tags)],
      // Pass-through keeps the input item (and its rev) intact so
      // downstream caches stay warm when the points are unchanged.
      points: [item],
    };
  },
});
