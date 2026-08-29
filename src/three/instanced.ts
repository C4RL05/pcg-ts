/**
 * Instance batches → THREE.InstancedMesh. The renderer-side half of the
 * core spawner protocol.
 */
import {
  InstancedBufferAttribute,
  InstancedMesh,
  type BufferGeometry,
  type Material,
  type Mesh,
} from "three";
import type { AttrData } from "../data/index.js";
import {
  INSTANCE_COLOR_CHANNEL,
  instanceAttributesOf,
  type InstanceAttributes,
  type InstanceBatch,
} from "../graph/data.js";
import { attempt, type TeardownFailure } from "./teardown.js";

/** One renderable asset shared by every instance of an asset id. */
export interface InstancedAsset {
  readonly geometry: BufferGeometry;
  readonly material: Material | Material[];
}

/** Asset id → renderable, the lookup instance batches resolve against. */
export type AssetMap = Record<string, InstancedAsset>;

/**
 * Clone an asset's material slot for one mesh.
 *
 * Every mesh gets its OWN material instance on purpose, and the reason is
 * three's renderer bookkeeping, not appearance: `WebGPURenderer` keys an
 * instanced mesh's render state (its `RenderObject`, built shaders,
 * pipeline and uniform buffers) per mesh — `RenderObject.
 * getMaterialCacheKey()` appends `object.uuid` for instanced meshes — and
 * releases ALL of it through exactly one signal, the `dispose` event of
 * the material that mesh rendered with. A shared asset material never
 * fires that event mid-session, so in a streaming world every evicted
 * mesh's render state would stay cached forever (measured: three's
 * program count climbing ~15 per cooked cell and never returning).
 * A per-mesh clone gives each mesh a material whose `dispose()` releases
 * precisely that mesh's render state and nobody else's. The clone is
 * shallow where it matters: textures and node graphs are shared by
 * reference, so no GPU resource is duplicated.
 *
 * `renderStateRelease.test.ts` pins the three internals this leans on.
 */
export function cloneAssetMaterial(material: Material | Material[]): Material | Material[] {
  return Array.isArray(material) ? material.map((m) => m.clone()) : material.clone();
}

/** A mesh's material slot as a list, whichever shape it has. */
export function materialListOf(material: Material | Material[]): readonly Material[] {
  return Array.isArray(material) ? material : [material];
}

/**
 * `userData` flag marking a mesh whose geometry is a PER-BATCH CLONE it
 * owns, not the asset map's shared geometry.
 *
 * A flag rather than an identity comparison against the asset map,
 * because the code that disposes a mesh is often not the code that built
 * it and may not hold the map any more (`WorldThreeBinding` tears a cell
 * down long after the build).
 */
const OWNED_GEOMETRY_FLAG = "pcgOwnsGeometry";

/**
 * Does this mesh own its geometry, so that disposing the mesh must
 * dispose the geometry too?
 *
 * FALSE for the ordinary mesh, which draws the asset map's shared
 * geometry by reference — disposing that would break every other mesh
 * using the same asset, and it belongs to the caller's asset map. TRUE
 * exactly for a mesh built from a batch carrying NAMED per-instance
 * channels: those become `InstancedBufferAttribute`s on the GEOMETRY, so
 * the mesh cannot share one (see {@link toInstancedMeshes}' ownership
 * notes) and gets a clone that lives and dies with it.
 *
 * Read it on every teardown path. A silent per-batch clone that nothing
 * disposes is how a leak shows up six months out, in a streaming world,
 * as memory that only ever climbs.
 */
export function ownsGeometry(mesh: Mesh): boolean {
  return mesh.userData[OWNED_GEOMETRY_FLAG] === true;
}

/**
 * Geometry attribute names three (or a standard material) already means
 * something by. A channel of one of these names would overwrite the
 * asset's own vertex data — `position` most destructively — and the mesh
 * would draw nothing or draw garbage, with no error anywhere.
 *
 * `color` is not here because it never reaches this check: it is the
 * reserved instance-colour channel, handled before the loop.
 *
 * An ARRAY and not a `Set`, deliberately: `new Set([...])` is a call at
 * module scope, which makes this module impure and would force
 * `dist/three/index.js` into package.json's `sideEffects` — the one entry
 * deliberately omitted, so that a WebGL app importing `pcg-ts/three` can
 * tree-shake what it does not use. `tests/packaging.test.ts` enforces it.
 * Eleven entries scanned once per channel per batch costs nothing a Set
 * would save.
 */
const RESERVED_GEOMETRY_ATTRS: readonly string[] = [
  "position",
  "normal",
  "tangent",
  "uv",
  "uv1",
  "uv2",
  "uv3",
  "skinIndex",
  "skinWeight",
  "instanceMatrix",
  "instanceColor",
];

/** Largest itemSize a vertex attribute can carry on either three backend. */
const MAX_CHANNEL_ITEM_SIZE = 4;

/**
 * Opt-in expectations for {@link toInstancedMeshes}. Every field is
 * optional and every default is "behave exactly as this function always
 * has": a caller that passes nothing, or passes `{}`, gets the identical
 * meshes and the identical errors.
 */
export interface ToInstancedMeshesOptions {
  /**
   * Per-instance channel names the caller's materials DECLARE, and which
   * every batch in this call must therefore carry. A batch missing one is
   * refused by name instead of drawn.
   *
   * **Why this exists.** `toInstancedMeshes` binds the channels a batch
   * carries and never learns what the material declares, so the two can
   * disagree with nothing malformed on either side. Measured in
   * `tests/instanceChannelRender.test.ts`: a declared-but-unbound FLOAT
   * attribute reads `(0, 0, 0, 1)` for every instance, every fragment
   * runs and writes black, no GL error is queued, and a `ShaderMaterial`
   * under WebGL logs nothing at any severity. On screen that is "every
   * instance identical", which reads as a content mistake rather than a
   * binding one. (A `NodeMaterial` under WebGPU does warn by name, and an
   * INTEGER declaration is refused outright with `INVALID_OPERATION` —
   * the silent case is narrowly a float declaration in a
   * `ShaderMaterial`, which is most of them.) The realistic cause is a
   * stale name map: a host's shader attribute names are compiled into its
   * pipeline and cannot vary per clip, so the content carries a map from
   * the graph's channel names onto the host's, and a map entry can go
   * stale with nothing else changing.
   *
   * **PER CALL, not per asset id** — one list, checked against every
   * batch. Three reasons, and the second is the load-bearing one:
   *
   * - The failure is per BATCH. Two batches of ONE asset id where only
   *   one carries the channel is the shape that reaches ordinary
   *   consumers (two cooked cells, nothing misspelled) — and it is
   *   invisible from the outside, because three's `WebGLPrograms` keys
   *   its program cache on SHADER SOURCE, so the per-mesh material clones
   *   share one compiled program and the unchannelled mesh shades zeros
   *   through the pipeline its sibling compiled. A per-call list is
   *   checked once per batch, so that second batch is refused by
   *   construction rather than by the caller having remembered it.
   * - A per-asset-id map would carry the defect it is meant to catch. The
   *   realistic cause here IS a stale map; keying the expectation by
   *   asset id adds a second map, and an asset id it does not name is
   *   silently unchecked. A hole in the check that closes a hole is worse
   *   than no check, because it reads as coverage.
   * - The expectation states what the HOST'S PIPELINE needs, and those
   *   names are compiled into it. One pipeline, one set of names, one
   *   list. A host whose assets genuinely need different channels
   *   partitions its batches and calls this function once per group —
   *   which is the same partition it already makes when the assets need
   *   different materials. That composes; a map does not compose back
   *   into a list.
   *
   * Presence is read through `instanceAttributesOf`, so the reserved
   * `"color"` channel IS expressible and a batch satisfies it under
   * either spelling (`attributes.color` or the plain `colors` sugar).
   * It is admitted rather than excluded because a material that
   * multiplies by instance colour has the same silent failure — three
   * leaves `instanceColor` null, `USE_INSTANCING_COLOR` never turns on,
   * and every instance draws the material's own colour — and excluding
   * it would mean a host with one colour expectation and one channel
   * expectation needs two mechanisms for one question.
   *
   * Checked for EVERY batch including a zero-instance one, which cannot
   * draw a wrong picture yet. An exception there would be a hole in the
   * same shape as the one above, and a batch missing a channel at count 0
   * is the batch that will be missing it at count 500.
   *
   * NOT an alias or rename map, deliberately. The mapping from a graph's
   * channel names onto a host's shader attribute names is per-content
   * data that lives on the host side; a library-level alias map would be
   * a second home for it, and two homes for one mapping is how the entry
   * goes stale in the first place.
   */
  readonly requireChannels?: readonly string[];
}

/**
 * The names in `expected` that `channels` does not carry, deduplicated,
 * in the order the caller named them.
 *
 * Presence has to mean what BINDING means, or this check reports coverage
 * over the exact silent zeros it exists to refuse. Binding needs two
 * things, so this tests both:
 *
 * - **Own and enumerable.** The channel loop below reads
 *   `Object.entries(channels)`, which sees own enumerable keys and
 *   nothing else, so a `tint` reachable only through a prototype (a host
 *   layering its channels over a defaults object) binds nothing at all.
 *   This is also the test `instanceAttributesOf` uses for the colour
 *   channel, for the same reason.
 * - **A value.** A key present with `undefined` (or `null`) is the shape
 *   a stale name map produces on the host side — `for (const n of wanted)
 *   attributes[n] = columns[n]`, where a lookup miss writes `undefined`
 *   and type-checks, because this project does not enable
 *   `noUncheckedIndexedAccess`. The colour path binds on the VALUE
 *   (`if (colors)`), so such a key leaves `instanceColor` null and every
 *   instance drawing the material's own colour, with the expectation
 *   having said it was satisfied. That is the worst failure available
 *   here — a hole reported as coverage — and it is what this clause
 *   closes. A named channel with the same shape would instead die on
 *   `column.length`, naming neither the batch nor the channel; requiring
 *   a value turns that into the refusal below.
 */
function missingChannels(expected: readonly string[], channels: InstanceAttributes): string[] {
  const missing: string[] = [];
  for (const name of expected) {
    // `!= null` on purpose: `undefined` and `null` both reach here from a
    // stale map, and both bind nothing.
    const carried =
      Object.prototype.propertyIsEnumerable.call(channels, name) && channels[name] != null;
    // Deduplicated so a caller's repeated name is not reported twice.
    if (!carried && !missing.includes(name)) missing.push(name);
  }
  return missing;
}

/** A channel-name list for an error: quoted, comma-joined, `(none)` when empty. */
function nameList(names: readonly string[]): string {
  return names.length === 0 ? "(none)" : names.map((name) => `"${name}"`).join(", ");
}

/**
 * Create one `THREE.InstancedMesh` per batch, resolving each batch's
 * `assetId` in `assets` (unknown ids throw, listing the known ids).
 * Batch transforms are already in `Matrix4.elements` layout, so they are
 * copied straight into `instanceMatrix`. Each mesh is named after its
 * asset id and gets its bounding sphere computed over the instances so
 * frustum culling is correct.
 *
 * The batch's per-instance channels are read through
 * `instanceAttributesOf` — one record, colour included — and land in two
 * places, because three binds instance colour structurally and everything
 * else generically:
 *
 * - The reserved `color` channel becomes `mesh.instanceColor`, which
 *   three multiplies into the material's own colour with no material
 *   change needed (`instanceColor !== null` is what defines
 *   `USE_INSTANCING_COLOR` for the program). A batch WITHOUT colour
 *   leaves `instanceColor` at `null`, so a spawn that never asked for
 *   colour draws through exactly the shader variant it always did.
 * - Every OTHER channel becomes an `InstancedBufferAttribute` of its own
 *   name on the geometry, with the batch column's dtype and its item size
 *   (`column.length / count`) intact — so a `u32` id arrives as a `uint`
 *   in the shader rather than as an f32 that lost its low bits. A
 *   material has to declare it to use it (an `onBeforeCompile` patch, a
 *   `ShaderMaterial`, or a TSL `attribute()` node); nothing here writes
 *   the shader, because the whole point of the channel is that the HOST
 *   decides what the data drives.
 *
 * Ownership, in three parts:
 *
 * - Each mesh's MATERIAL is a per-mesh clone of the asset's (see
 *   {@link cloneAssetMaterial} for why: it is the one lever that lets
 *   three's renderer release the mesh's cached render state). **A host
 *   that draws these meshes with its OWN pooled or shared material must
 *   dispose what it displaces when it overwrites `mesh.material`** — the
 *   clone is minted here whether the host keeps it or not, and after the
 *   assignment nothing holds a reference to it. Read the old value
 *   through {@link materialListOf} first: a multi-material asset is
 *   cloned SLOT BY SLOT, so there are as many clones as slots, and
 *   disposing only slot 0 leaks the rest. Dispose what was DISPLACED,
 *   never the pooled material that displaced it.
 * - **A batch carrying NAMED channels also gets its own GEOMETRY clone,
 *   and that clone is disposed with the mesh.** An
 *   `InstancedBufferAttribute` lives on the geometry, so a mesh that sets
 *   one cannot share the asset's — it would publish this batch's ids to
 *   every other mesh drawing the same asset, and the last cook would win.
 *   The clone is shallow where it matters: three's `BufferGeometry.clone`
 *   copies attribute ARRAYS but not GPU buffers, and index/groups/bounds
 *   come along. {@link ownsGeometry} is how a teardown path tells the two
 *   apart, and the flag is set on the mesh rather than inferred, because
 *   whoever disposes a mesh usually no longer holds the asset map.
 * - The asset GEOMETRY of an unchannelled batch (and any textures the
 *   material references) stays shared by reference — dispose those with
 *   the asset map, never per mesh. Instance COLOUR alone does not force a
 *   clone: `instanceColor` is a property of the MESH, not the geometry,
 *   so a coloured spawn shares geometry exactly as it always has.
 *
 * Dispose a mesh with all three parts:
 *
 * ```ts
 * mesh.dispose(); // per-mesh GPU state (the instance-matrix buffer)
 * for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
 * if (ownsGeometry(mesh)) mesh.geometry.dispose(); // ONLY the per-batch clone
 * ```
 *
 * `WorldThreeBinding` does exactly this on every release path. If a batch
 * mid-list fails validation, the materials and geometry clones already
 * minted for earlier batches are disposed before the error propagates, so
 * a throwing build mints nothing that outlives it.
 *
 * A caller that knows which channels its materials declare can say so
 * through `options.requireChannels` and have a batch missing one refused
 * by name rather than drawn as zeros. Purely opt-in: with no `options`
 * this function binds whatever the batch carries, exactly as it always
 * has, because plenty of callers legitimately draw batches with no
 * channels at all.
 */
export function toInstancedMeshes(
  batches: readonly InstanceBatch[],
  assets: AssetMap,
  options?: ToInstancedMeshesOptions,
): InstancedMesh[] {
  // Read once, outside the loop: absent is the default and must cost
  // nothing per batch.
  const required = options?.requireChannels;
  if (required !== undefined) {
    for (const name of required) {
      // An expectation naming one of these can NEVER be satisfied: the
      // loop below refuses a batch that carries such a channel. Left
      // unchecked, the per-batch refusal would tell the caller to publish
      // the name from the spawn — the one action the next guard rejects —
      // so the expectation is validated once, up front, instead of
      // handing out advice that cannot be taken. Before any mesh is
      // minted, so there is nothing to unwind.
      //
      // THIS IS AN ORDERING CHANGE and it is worth finding here rather
      // than being surprised by it: because the expectation is validated
      // before the batch loop, an unsatisfiable `requireChannels` is
      // reported ahead of per-batch errors that used to come first
      // (unknown assetId, a bad transform length). Deliberate — the
      // expectation is a defect in the CALL, so it holds for every batch
      // and would be reported for whichever batch happened to be examined
      // first; reporting it once, before any of them, is the same finding
      // without the false attribution to a batch. Callers with NO
      // expectation see the old order untouched, since this block does
      // not run for them.
      if (RESERVED_GEOMETRY_ATTRS.includes(name)) {
        throw new Error(
          `toInstancedMeshes: requireChannels names "${name}", which is a geometry attribute ` +
            `three already means something by — a batch carrying a channel of that name is ` +
            `refused, so this expectation can never be satisfied by any batch. Rename the point ` +
            `attribute upstream (setAttribute), name the new one in spawnInstances' ` +
            `instanceAttrs, and require THAT name here. Reserved: ` +
            `${[...RESERVED_GEOMETRY_ATTRS].sort().join(", ")}. (The reserved ` +
            `"${INSTANCE_COLOR_CHANNEL}" channel is not on that list and IS requirable — it ` +
            `rides mesh.instanceColor rather than the geometry.)`,
        );
      }
    }
  }
  const meshes: InstancedMesh[] = [];
  try {
    for (const batch of batches) {
      const asset = assets[batch.assetId];
      if (!asset) {
        const known = Object.keys(assets).sort().join(", ");
        throw new Error(
          `toInstancedMeshes: unknown assetId "${batch.assetId}"; known assets: ` +
            (known === "" ? "(none)" : known),
        );
      }
      if (batch.transforms.length !== batch.count * 16) {
        throw new Error(
          `toInstancedMeshes: batch "${batch.assetId}" has ${batch.transforms.length} transform ` +
            `floats, expected count * 16 = ${batch.count * 16}`,
        );
      }
      // One record, colour included; a batch carrying only a legacy plain
      // `colors` is lifted into the reserved channel, so it takes this
      // exact path with nothing special-cased for it.
      const channels = instanceAttributesOf(batch);
      // The caller's own contract, answered before anything else about
      // the channels: it is the only check here that knows what the
      // material expects, so its message is the one that can name the
      // stale entry. After `instanceAttributesOf`, never before — the
      // reserved colour channel is only present in that record.
      if (required !== undefined) {
        const missing = missingChannels(required, channels);
        if (missing.length > 0) {
          // Sorted, like the known-asset list above: the caller compares
          // it against its own name map by eye, and insertion order is
          // whatever the spawn happened to write.
          //
          // SPLIT BY WHETHER THE KEY HOLDS ANYTHING, which is the same
          // line `missingChannels` draws and has to be, or the message
          // contradicts itself in the one shape it was written for. A
          // stale host map leaves the key with no value, so a bare
          // `Object.keys` would print the missing name on BOTH sides —
          // "does not carry "tint" … it carries "phase", "tint"" — and
          // then tell the reader to compare the two lists. The empty ones
          // are reported separately rather than dropped, because "present
          // but holds no column" is a sharper diagnosis of a stale map
          // than the name silently vanishing: it says the loop that fills
          // the record ran and found nothing, not that the name was never
          // asked for.
          const keys = Object.keys(channels).sort();
          const carried = keys.filter((name) => channels[name] != null);
          const empty = keys.filter((name) => channels[name] == null);
          // The two consequences are DIFFERENT pictures, so the message
          // states only the ones that apply. A generic channel reads as
          // zeros through a geometry attribute that was never bound —
          // but only where the declaration is a FLOAT, and the message
          // has to say both, because an INTEGER declaration is refused
          // by WebGL2 outright and a host reading "black" would be
          // hunting a symptom it never saw; the
          // reserved colour is not a geometry attribute at all, and its
          // absence leaves the material's own colour drawing instead. A
          // host told "it reads as zeros" would go looking for black
          // instances and not find any.
          const generic = missing.filter((name) => name !== INSTANCE_COLOR_CHANNEL);
          throw new Error(
            `toInstancedMeshes: batch "${batch.assetId}" does not carry the required ` +
              `per-instance ${missing.length === 1 ? "channel" : "channels"} ` +
              `${nameList(missing)}; it carries ${nameList(carried)}` +
              (empty.length > 0
                ? ` (${nameList(empty)} ${empty.length === 1 ? "is" : "are"} present but ` +
                  `${empty.length === 1 ? "holds" : "hold"} no column)`
                : "") +
              `. requireChannels asked for ` +
              `${nameList(required)}. Nothing downstream would refuse this: three binds only ` +
              `what the batch carries and never sees what the material declares.` +
              (generic.length > 0
                ? ` A material declaring ${nameList([generic[0]])} as a FLOAT reads it as ZEROS ` +
                  "for every instance — the fragments still run and write black, every instance " +
                  "draws identical, and a ShaderMaterial under WebGL logs nothing at any " +
                  "severity. Declared as an INTEGER it fails loudly instead, and the symptom " +
                  "looks unrelated: WebGL2 refuses the draw with INVALID_OPERATION and nothing " +
                  "is drawn at all."
                : "") +
              (missing.includes(INSTANCE_COLOR_CHANNEL)
                ? ` The reserved "${INSTANCE_COLOR_CHANNEL}" channel is not a geometry attribute ` +
                  "and fails as a different picture: three leaves `instanceColor` null, the " +
                  "USE_INSTANCING_COLOR shader variant never turns on, and every instance draws " +
                  "the material's own colour rather than black."
                : "") +
              ` The usual cause is a stale channel-name map: compare the two lists above, then ` +
              `either publish the name from the spawn (spawnInstances' instanceAttrs, or ` +
              `colorAttr for the reserved "${INSTANCE_COLOR_CHANNEL}" channel) or drop it from ` +
              `requireChannels.`,
          );
        }
      }
      const colors = channels[INSTANCE_COLOR_CHANNEL];
      if (colors && colors.length !== batch.count * 3) {
        throw new Error(
          `toInstancedMeshes: batch "${batch.assetId}" has ${colors.length} colour ` +
            `floats, expected count * 3 = ${batch.count * 3} (rgb per instance; alpha is dropped ` +
            `at the spawner)`,
        );
      }
      // Every channel is validated BEFORE anything is minted, so a bad
      // one throws with no half-built mesh, geometry clone or material
      // clone behind it. Item size is derived, never carried — see
      // `InstanceAttributes`.
      const custom: { name: string; column: AttrData; itemSize: number }[] = [];
      for (const [name, column] of Object.entries(channels)) {
        if (name === INSTANCE_COLOR_CHANNEL) continue;
        if (RESERVED_GEOMETRY_ATTRS.includes(name)) {
          throw new Error(
            `toInstancedMeshes: batch "${batch.assetId}" carries a per-instance channel named ` +
              `"${name}", which is a geometry attribute three already means something by — ` +
              `setting it would overwrite the asset's own vertex data and the mesh would draw ` +
              `nothing or draw garbage, with no error. Rename the point attribute upstream ` +
              `(setAttribute) and name the new one in spawnInstances' instanceAttrs. Reserved: ` +
              `${[...RESERVED_GEOMETRY_ATTRS].sort().join(", ")}.`,
          );
        }
        if (batch.count === 0) {
          if (column.length !== 0) {
            throw new Error(
              `toInstancedMeshes: batch "${batch.assetId}" declares 0 instances but its ` +
                `"${name}" channel has ${column.length} elements. A channel is ` +
                `count * itemSize elements, and at count 0 the item size cannot be recovered ` +
                `(there is nothing to divide by), so a zero-instance batch's channels must be ` +
                `empty. Give the batch its real instance count, or drop the channel.`,
            );
          }
          // No instances means no recoverable item size (it is
          // `length / count`), and no attribute worth binding either.
          continue;
        }
        if (column.length % batch.count !== 0) {
          throw new Error(
            `toInstancedMeshes: batch "${batch.assetId}" channel "${name}" has ${column.length} ` +
              `elements, which is not a whole number per instance for ${batch.count} instances ` +
              `— a channel is count * itemSize elements and its item size is recovered as ` +
              `length / count`,
          );
        }
        const itemSize = column.length / batch.count;
        if (itemSize > MAX_CHANNEL_ITEM_SIZE) {
          throw new Error(
            `toInstancedMeshes: batch "${batch.assetId}" channel "${name}" is ${itemSize} ` +
              `components per instance; a vertex attribute carries at most ` +
              `${MAX_CHANNEL_ITEM_SIZE}. Split the point attribute into several narrower ones ` +
              `upstream and name each in instanceAttrs.`,
          );
        }
        custom.push({ name, column, itemSize });
      }
      // A channel is an attribute of the GEOMETRY, so a channelled batch
      // cannot share the asset's — see the ownership notes above. Colour
      // alone still shares: `instanceColor` hangs on the mesh.
      const owned = custom.length > 0;
      const geometry = owned ? asset.geometry.clone() : asset.geometry;
      const mesh = new InstancedMesh(geometry, cloneAssetMaterial(asset.material), batch.count);
      if (owned) mesh.userData[OWNED_GEOMETRY_FLAG] = true;
      // Listed the moment it owns anything, not once it is finished:
      // everything below can still throw (`colors.slice()` on a huge
      // batch, `computeBoundingSphere`), and the unwind below can only
      // dispose what this array holds. The ownership flag above is set
      // first for the same reason — it is what tells the unwind whether
      // the geometry is this mesh's clone or the asset map's.
      meshes.push(mesh);
      (mesh.instanceMatrix.array as Float32Array).set(batch.transforms);
      mesh.instanceMatrix.needsUpdate = true;
      if (colors) {
        // Copied, like the transforms: the batch belongs to a cached graph
        // item that may back several meshes, and three writes through
        // `setColorAt` into whatever array it is given.
        mesh.instanceColor = new InstancedBufferAttribute(colors.slice(), 3);
        mesh.instanceColor.needsUpdate = true;
      }
      for (const { name, column, itemSize } of custom) {
        // `.slice()` for the same reason the transforms are copied, and
        // the DTYPE IS PRESERVED by it: `slice` on a typed array returns
        // its own class, so a u32 id stays a Uint32Array and reaches the
        // shader as an integer instead of an f32 that lost its low bits.
        geometry.setAttribute(name, new InstancedBufferAttribute(column.slice(), itemSize));
      }
      mesh.name = batch.assetId;
      mesh.computeBoundingSphere();
    }
  } catch (err) {
    // A later batch's validation failure discards the earlier batches'
    // meshes — they are local to this call and the caller never sees
    // them, so their material clones (and geometry clones) must not
    // outlive it. None has been rendered yet, so disposal here is inert
    // bookkeeping, not GPU work.
    //
    // Guarded step by step (see ./teardown.ts) even though three's own
    // classes cannot throw here, and both halves of that are worth
    // stating. They cannot: `Material.dispose` and
    // `BufferGeometry.dispose` only dispatch a `dispose` event,
    // `InstancedMesh.dispose` dispatches and frees a `morphTexture` this
    // function never sets, and `dispatchEvent` returns immediately when
    // nothing is listening — which nothing is, since both renderers
    // attach their listeners only when the renderer first PROCESSES an
    // object (`WebGLObjects.update`, `getProgram`, the `RenderObject`
    // constructor on the WebGPU backend) and every mesh here was minted
    // in the loop above, never escaped this function and was never
    // rendered. But the CLASS is the caller's: the material and geometry
    // are `.clone()`s of whatever the asset map holds, so a host
    // subclass may override `dispose` (or override `copy` to carry
    // `_listeners` across from a rendered source, which three's own copy
    // implementations do not). Nothing unrecoverable is stranded if one
    // throws — these are CPU objects with no GPU state behind them, not
    // the device buffers `worldBinding.disposeEntry` is the last owner
    // of — but an escape would replace the ACTIONABLE error (`unknown
    // assetId "rock"`) with a teardown symptom, and the error message is
    // the whole diagnosis for the caller.
    let failure: TeardownFailure = { err };
    for (const mesh of meshes) {
      failure = attempt(failure, () => mesh.dispose());
      for (const material of materialListOf(mesh.material)) {
        failure = attempt(failure, () => material.dispose());
      }
      if (ownsGeometry(mesh)) failure = attempt(failure, () => mesh.geometry.dispose());
    }
    // Always the build error, by the seeding above; the `??` is only
    // there because the helper's type admits an unseeded start.
    throw failure?.err ?? err;
  }
  return meshes;
}
