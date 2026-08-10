/**
 * Draw a device-resident instance batch with `THREE.WebGPURenderer`,
 * reading the instance matrices straight out of the `GPUBuffer` the
 * resident spawner composed them in — no readback, no CPU copy, not even
 * a CPU-side `Float32Array` of the right size.
 *
 * ## How it works
 *
 * Two halves, one supported and one not:
 *
 * 1. **Supported.** three's `InstanceNode` already branches on
 *    `instanceMatrix.isStorageInstancedBufferAttribute` and, when set,
 *    reads the matrix as `storage(instanceMatrix, "mat4", count)
 *    .element(instanceIndex)` — a read-only storage binding in the
 *    vertex stage. Every other branch reads `instanceMatrix.array` (a
 *    uniform-buffer upload or four interleaved vec4 vertex attributes),
 *    so the storage branch is the only CPU-free one. `mat4x4<f32>` is
 *    column-major, which is exactly `Matrix4.elements` and exactly what
 *    the compose kernel writes, so no repacking happens anywhere.
 *
 *    The same branch exists for instance COLOUR — `storage(colors,
 *    "vec3", count).element(instanceIndex)` — so a device-resident
 *    colour buffer rides the identical seam rather than a parallel one:
 *    same attribute class, same `backend.get(attribute).buffer` seeding,
 *    same usage flags. What differs is the layout, and that difference is
 *    three's own: WGSL gives `array<vec3<f32>>` a 16-byte stride, and
 *    three repacks an itemSize-3 storage attribute to 4 components
 *    before upload for exactly that reason ("WGSL does not support packed
 *    vec3 data in storage buffers"). The evaluator therefore composes 4
 *    f32 per instance, and that repack — which would rewrite the array we
 *    are adopting instead of — never runs, because it lives inside the
 *    `buffer === undefined` branch adoption short-circuits.
 *
 * 2. **Not supported.** three has no API for "bind the buffer I already
 *    own". Left alone it would allocate its own buffer and upload the
 *    attribute's (empty) array over the top. {@link ADOPTION_SEAM}
 *    below is the one place that reaches into an internal to prevent
 *    that; `webgpuInstances.test.ts` pins every name it touches.
 *
 * ## Bounds
 *
 * `InstancedMesh.computeBoundingSphere()` loops `getMatrixAt()` over the
 * CPU matrix array, which here is empty — it would compute a zero-radius
 * sphere at the origin and the renderer would cull every cell that is
 * not centred on the camera. So bounds are supplied out of band from the
 * cell AABB (`DeviceInstanceContext.bounds`), assigned to
 * `mesh.boundingSphere`, which `Frustum.intersectsObject` prefers over
 * the geometry's and which stops three ever calling
 * `computeBoundingSphere()`. With no bounds supplied, frustum culling is
 * switched off instead of guessed. The binding asks for those bounds once
 * per batch, so a cell holding several assets culls each by its own
 * sphere rather than by the tallest asset's.
 *
 * ## Ownership
 *
 * The adapter never disposes a `DeviceTransformsHandle` — matrices or
 * colours; `WorldThreeBinding` reference-counts and disposes those. The
 * adapter owns only the `InstancedMesh` and its attributes, and it must
 * never let three call `destroyAttribute` on an adopted attribute (that
 * would `destroy()` a buffer somebody else owns) — see
 * {@link WebGpuInstanceAdapter.release}.
 */
import { InstancedMesh, Object3D, Sphere, Vector3, type Material } from "three";
import type { DeviceInstanceBatch } from "../fields/index.js";
import type { DeviceInstanceAdapter, DeviceInstanceContext } from "./worldBinding.js";
import type { AssetMap } from "./instanced.js";

/** Backend tag every WebGPU device-transforms handle carries. */
const WEBGPU_BACKEND = "webgpu";

/** Instance-matrix item size in floats (a column-major 4x4). */
const MATRIX_ITEM_SIZE = 16;

/**
 * Instance-colour item size in floats, as three's node graph reads it:
 * `storage(colors, "vec3", count)`.
 */
const COLOR_ITEM_SIZE = 3;

/**
 * f32 the device buffer actually spends per instance — FOUR, against the
 * `vec3` above. `array<vec3<f32>>` has a 16-byte stride in WGSL, so the
 * third and fourth numbers on this page disagree on purpose. Mirrors
 * `INSTANCE_COLOR_COMPONENTS` in `src/gpu/applyKernels.ts`, which is what
 * the compose kernel writes; kept as a literal here because `src/three`
 * must not import `src/gpu`, and asserted against the batch's declared
 * handle length on every build so the two cannot drift silently.
 */
const COLOR_DEVICE_COMPONENTS = 4;

/**
 * Structural stand-in for `THREE.WebGPURenderer`.
 *
 * Deliberately not the real class type: the only member this adapter
 * needs is `backend.get`, which `@types/three` does not declare on
 * `Backend` at all (it is inherited from the undocumented `DataMap`), so
 * a nominal type would not type-check against the very property we use.
 * A real `WebGPURenderer` is assignable to this, and the runtime seam
 * check in {@link createWebGpuInstanceAdapter} verifies the shape for
 * real instead of trusting the declaration.
 */
export interface WebGpuRendererLike {
  /** The renderer's backend (`WebGPUBackend`). */
  readonly backend: unknown;
}

/** Options for {@link createWebGpuInstanceAdapter}. */
export interface WebGpuInstanceAdapterOptions {
  /**
   * An **initialized** `WebGPURenderer` (`await renderer.init()`, or the
   * first `renderAsync`) whose `GPUDevice` is the same device the
   * `GpuFieldEvaluator` composed the transforms on. Two devices cannot
   * share a buffer, so this is a hard requirement, not a suggestion.
   */
  readonly renderer: WebGpuRendererLike;
  /** Asset id → geometry/material, the same map shape `toInstancedMeshes` takes. */
  readonly assets: AssetMap;
}

/** Counters for tests and on-screen diagnostics. */
export interface WebGpuInstanceAdapterStats {
  /** Objects built (one per device batch, including empty ones). */
  readonly built: number;
  /** Objects released. `built - released` is the live object count. */
  readonly released: number;
  /**
   * Device buffers adopted into three's backend (empty batches adopt
   * none). Counts BUFFERS, not batches: a coloured batch adopts two.
   */
  readonly adopted: number;
  /** Instances currently drawn from device buffers. */
  readonly liveInstances: number;
}

/** A {@link DeviceInstanceAdapter} backed by `THREE.WebGPURenderer`. */
export interface WebGpuInstanceAdapter extends DeviceInstanceAdapter {
  readonly stats: WebGpuInstanceAdapterStats;
}

/**
 * ADOPTION SEAM — the one internal this file depends on.
 *
 * three's WebGPU backend keeps per-object GPU state in a `DataMap`
 * (a `WeakMap` wrapper) reachable as `backend.get(object)`, which
 * auto-creates an empty record. For a buffer attribute the record's
 * `buffer` field holds the `GPUBuffer`, and
 * `WebGPUAttributeUtils.createAttribute` opens with
 *
 * ```js
 * let buffer = bufferData.buffer;
 * if ( buffer === undefined ) { ...createBuffer + upload... }
 * ```
 *
 * so seeding `backend.get(attribute).buffer` before three first sees the
 * attribute makes creation and upload a complete no-op, and
 * `WebGPUBindingUtils.createBindGroup` then binds our buffer verbatim
 * (`resource: { buffer: backend.get(binding.attribute).buffer }`).
 *
 * The usage flags line up exactly: `WebGPUBackend.createStorageAttribute`
 * asks for `STORAGE | VERTEX | COPY_SRC | COPY_DST`, which is the
 * evaluator pool's allocation flags for a transforms buffer, so the
 * adopted buffer is bindable in every way three's own would have been.
 *
 * Pinned by `webgpuInstances.test.ts`: the property name (`buffer`, not
 * `bufferGPU`), the accessor name (`get`), the auto-vivification, and —
 * behaviourally, by calling it — the `buffer === undefined` guard.
 */
const ADOPTION_SEAM = {
  /** Property on the backend that returns an object's GPU record. */
  accessor: "get",
  /** Field on that record holding the `GPUBuffer`. */
  field: "buffer",
} as const;

interface BackendLike {
  get(object: object): Record<string, unknown>;
  createStorageAttribute(attribute: object): void;
}

/** three version this seam was verified against; named in failures. */
const VERIFIED_THREE_VERSION = "0.185.1";

function seamError(detail: string, observed: string): Error {
  return new Error(
    `pcg-ts/three WebGPU instance adapter: ${detail}. This adapter binds device-resident ` +
      "instance transforms by seeding three's WebGPU backend attribute record " +
      `(\`renderer.backend.${ADOPTION_SEAM.accessor}(attribute).${ADOPTION_SEAM.field}\`), an internal ` +
      `verified against three ${VERIFIED_THREE_VERSION}; observed: ${observed}. three has moved or ` +
      "renamed it, so rendering from a device buffer would silently draw the wrong matrices. Pin " +
      `three to ${VERIFIED_THREE_VERSION}, or update src/three/webgpuInstances.ts (ADOPTION_SEAM) ` +
      "to the new shape, or drop `deviceInstances: true` from the GpuFieldEvaluator to render " +
      "through the CPU path",
  );
}

/**
 * Narrow a renderer to the backend members the seam needs, throwing an
 * actionable error naming the three version when they are not there.
 */
function requireBackend(renderer: WebGpuRendererLike): BackendLike {
  const backend = renderer.backend as Partial<BackendLike> | null | undefined;
  if (backend === null || backend === undefined || typeof backend !== "object") {
    throw seamError(
      "the renderer has no `backend`; pass an initialized WebGPURenderer",
      `typeof renderer.backend === "${typeof renderer.backend}"`,
    );
  }
  if (typeof backend[ADOPTION_SEAM.accessor] !== "function") {
    throw seamError(
      `\`backend.${ADOPTION_SEAM.accessor}(object)\` is not a function`,
      `typeof backend.${ADOPTION_SEAM.accessor} === "${typeof backend[ADOPTION_SEAM.accessor]}"`,
    );
  }
  if (typeof backend.createStorageAttribute !== "function") {
    throw seamError(
      "`backend.createStorageAttribute(attribute)` is not a function",
      `typeof backend.createStorageAttribute === "${typeof backend.createStorageAttribute}"`,
    );
  }
  return backend as BackendLike;
}

/**
 * Prove the seam still works before anything is rendered: seed a
 * sentinel on a throwaway attribute and let three's own creation path
 * run over it. If the `buffer === undefined` guard is intact the
 * sentinel survives untouched and no device call is made (this works
 * even on an uninitialized backend, which is what lets the guard test
 * run without a GPU). If three ever creates a buffer anyway, we find out
 * here — loudly — instead of rendering garbage.
 */
export function checkAdoptionSeam(
  renderer: WebGpuRendererLike,
  makeAttribute: () => object,
): void {
  const backend = requireBackend(renderer);
  const probe = makeAttribute();
  const record = backend.get(probe);
  if (record === null || typeof record !== "object") {
    throw seamError(
      `\`backend.${ADOPTION_SEAM.accessor}(attribute)\` did not return a record object`,
      `got ${record === null ? "null" : typeof record}`,
    );
  }
  if (record[ADOPTION_SEAM.field] !== undefined) {
    throw seamError(
      `a fresh attribute's record already has \`${ADOPTION_SEAM.field}\``,
      `record.${ADOPTION_SEAM.field} was already set`,
    );
  }
  const sentinel = { pcgAdoptionProbe: true };
  record[ADOPTION_SEAM.field] = sentinel;
  try {
    backend.createStorageAttribute(probe);
  } catch (err) {
    throw seamError(
      "three's `createStorageAttribute` threw over a pre-seeded attribute record, so it no " +
        "longer short-circuits on an existing buffer",
      err instanceof Error ? err.message : String(err),
    );
  }
  const after = backend.get(probe)[ADOPTION_SEAM.field];
  if (after !== sentinel) {
    throw seamError(
      "three replaced a pre-seeded attribute buffer instead of reusing it, so the " +
        "`buffer === undefined` short-circuit in WebGPUAttributeUtils.createAttribute is gone",
      after === undefined ? "the record was cleared" : "the record holds a different buffer",
    );
  }
  // Leave the record as it was found. The probe attribute is a throwaway,
  // so this is mostly hygiene — but it is also what makes the check
  // REPEATABLE, and the adapter runs it once per item size (a matrix is
  // itemSize 16, a colour 3, and only the latter has a padding branch to
  // short-circuit past). A backend that returned one shared record would
  // otherwise fail its own second probe on the sentinel it just wrote.
  delete backend.get(probe)[ADOPTION_SEAM.field];
}

/** Zero-length backing array: the matrices never exist on the CPU. */
function emptyMatrixArray(): Float32Array {
  return new Float32Array(0);
}

/**
 * Create the WebGPU device-instance adapter for a
 * {@link WorldThreeBinding}.
 *
 * `three/webgpu` is imported lazily so that importing `pcg-ts/three` at
 * all does not pull the 2 MB WebGPU build into a WebGL app — the
 * existing CPU/WebGL path stays exactly as costly as it was.
 *
 * ```ts
 * const adapter = await createWebGpuInstanceAdapter({ renderer, assets });
 * const binding = new WorldThreeBinding({
 *   group, assets,
 *   deviceInstances: { adapter, bounds: (level, coord) => cellSphere(level, coord) },
 * });
 * ```
 */
export async function createWebGpuInstanceAdapter(
  opts: WebGpuInstanceAdapterOptions,
): Promise<WebGpuInstanceAdapter> {
  const { StorageInstancedBufferAttribute } = await import("three/webgpu");
  const backend = requireBackend(opts.renderer);
  const makeAttribute = (
    count: number,
    itemSize: number,
  ): InstanceType<typeof StorageInstancedBufferAttribute> => {
    // Second (and last) internal: passing a typed array rather than a
    // count skips three's `new Float32Array(count * itemSize)` entirely —
    // the matrices and colours genuinely never exist on the CPU — and
    // `count` is then written directly. `@types/three` marks
    // `BufferAttribute.count` readonly, but it is a plain data property
    // at runtime and is what three reads for the instance count. If it
    // ever becomes a derived getter the assignment throws (modules are
    // strict) and the read-back below catches a silent no-op either way.
    const attr = new StorageInstancedBufferAttribute(emptyMatrixArray(), itemSize);
    (attr as { count: number }).count = count;
    if (attr.count !== count) {
      throw seamError(
        "`BufferAttribute.count` could not be set on a zero-length storage attribute, so the " +
          "instance count three reads would be 0 and nothing would draw",
        `wrote ${count}, read back ${String(attr.count)}`,
      );
    }
    return attr;
  };
  // Probe BOTH item sizes. itemSize 3 is the one three would repack (its
  // vec3 -> vec4 padding branch), so proving the short-circuit over a
  // colour-shaped attribute is a different claim from proving it over a
  // matrix-shaped one, and the colour path depends on the harder claim.
  checkAdoptionSeam(opts.renderer, () => makeAttribute(1, MATRIX_ITEM_SIZE));
  checkAdoptionSeam(opts.renderer, () => makeAttribute(1, COLOR_ITEM_SIZE));

  let built = 0;
  let released = 0;
  let adopted = 0;
  let liveInstances = 0;

  return {
    get stats(): WebGpuInstanceAdapterStats {
      return { built, released, adopted, liveInstances };
    },

    build(batch: DeviceInstanceBatch, ctx: DeviceInstanceContext): Object3D {
      const asset = opts.assets[batch.assetId];
      if (!asset) {
        const known = Object.keys(opts.assets).sort().join(", ");
        throw new Error(
          `createWebGpuInstanceAdapter: unknown assetId "${batch.assetId}" for cell ` +
            `"${ctx.levelName}|${ctx.coord.join(",")}"; known assets: ` +
            (known === "" ? "(none)" : known),
        );
      }
      if (batch.transforms.backend !== WEBGPU_BACKEND) {
        throw new Error(
          `createWebGpuInstanceAdapter: batch "${batch.assetId}" carries a "` +
            `${batch.transforms.backend}" transforms handle, not "${WEBGPU_BACKEND}"; only a ` +
            "GpuFieldEvaluator running on the renderer's own GPUDevice produces bindable buffers",
        );
      }
      const expected = batch.count * MATRIX_ITEM_SIZE * Float32Array.BYTES_PER_ELEMENT;
      if (batch.transforms.byteLength !== expected) {
        throw new Error(
          `createWebGpuInstanceAdapter: batch "${batch.assetId}" declares ${batch.count} ` +
            `instances (${expected} bytes of column-major 4x4s) but its transforms handle is ` +
            `${batch.transforms.byteLength} bytes`,
        );
      }
      const colors = batch.colors;
      if (colors !== undefined) {
        if (colors.backend !== WEBGPU_BACKEND) {
          throw new Error(
            `createWebGpuInstanceAdapter: batch "${batch.assetId}" carries a "` +
              `${colors.backend}" instance-colour handle, not "${WEBGPU_BACKEND}"; only a ` +
              "GpuFieldEvaluator running on the renderer's own GPUDevice produces bindable buffers",
          );
        }
        // 16 bytes per instance, not 12: this is the length check that
        // would catch a producer that packed colour tightly, which is
        // the failure that renders as a growing colour skew rather than
        // as an error.
        const expectedColors =
          batch.count * COLOR_DEVICE_COMPONENTS * Float32Array.BYTES_PER_ELEMENT;
        if (colors.byteLength !== expectedColors) {
          throw new Error(
            `createWebGpuInstanceAdapter: batch "${batch.assetId}" declares ${batch.count} ` +
              `instances, so its instance-colour handle must be ${expectedColors} bytes ` +
              `(${COLOR_DEVICE_COMPONENTS} f32 per instance — WGSL gives array<vec3<f32>> a ` +
              `16-byte stride, so RGB is padded to 4 components), but it is ` +
              `${colors.byteLength} bytes`,
          );
        }
      }
      built++;
      if (batch.count === 0) {
        // A zero-instance batch has nothing to bind. It must NOT become
        // an InstancedMesh: three clamps the instance count to
        // `max(object.count, 1)`, so an empty mesh would draw one
        // instance through the non-storage branch of `InstanceNode`,
        // reading a `mat4` out of a zero-length array. An empty
        // Object3D draws nothing; the handle is still owned (and
        // released) by the binding.
        const placeholder = new Object3D();
        placeholder.name = batch.assetId;
        return placeholder;
      }

      // `resource` throws for a disposed handle — read BOTH before
      // anything else is allocated so a stale batch fails cleanly and
      // leaves no half-built mesh behind.
      const buffer = batch.transforms.resource;
      const colorBuffer = colors?.resource;
      const attribute = makeAttribute(batch.count, MATRIX_ITEM_SIZE);
      attribute.name = `pcg:instanceMatrix:${batch.assetId}`;
      adoptInto(backend, attribute, buffer);
      adopted++;

      // count 0 at construction so three's own `new Float32Array(count *
      // 16)` is zero-length; the real count is set after the storage
      // attribute replaces it.
      const mesh = new InstancedMesh(asset.geometry, asset.material as Material, 0);
      mesh.instanceMatrix = attribute;
      if (colorBuffer !== undefined) {
        // `NodeMaterial.setupDiffuseColor` multiplies in `instanceColor`
        // whenever this is non-null, and `Instance.js` takes the storage
        // branch for it exactly as it does for the matrix. Setting it is
        // therefore the whole adoption: no material flag, no
        // `vertexColors`, no second draw path.
        const colorAttribute = makeAttribute(batch.count, COLOR_ITEM_SIZE);
        colorAttribute.name = `pcg:instanceColor:${batch.assetId}`;
        adoptInto(backend, colorAttribute, colorBuffer);
        adopted++;
        mesh.instanceColor = colorAttribute;
      }
      mesh.count = batch.count;
      mesh.name = batch.assetId;
      applyBounds(mesh, ctx, batch.assetId);
      liveInstances += batch.count;
      return mesh;
    },

    release(object: Object3D): void {
      released++;
      const mesh = object as InstancedMesh & { isInstancedMesh?: boolean };
      if (mesh.isInstancedMesh !== true) return;
      liveInstances -= mesh.count;
      // `InstancedMesh.dispose()` only fires the mesh's own dispose
      // event and drops its morph texture; it does NOT reach three's
      // `Attributes.delete` (that is driven by geometry disposal), so
      // the adopted buffer is never `destroy()`ed here. That matters:
      // the buffer belongs to the batch's handle, and a cell aliasing a
      // parent's outputs can share it with a live cell.
      mesh.dispose();
    },
  };
}

/** Seed the backend record so three adopts `buffer` instead of creating one. */
function adoptInto(backend: BackendLike, attribute: object, buffer: unknown): void {
  const record = backend.get(attribute);
  if (record[ADOPTION_SEAM.field] !== undefined) {
    // A fresh attribute per batch is the invariant that makes adoption
    // safe (three caches bind groups per attribute identity); reusing
    // one would bind the previous cell's buffer.
    throw seamError(
      "a freshly created instance-matrix attribute already had a GPU buffer, so attribute " +
        "records are being reused across batches",
      "record.buffer was already set",
    );
  }
  record[ADOPTION_SEAM.field] = buffer;
}

/**
 * Frustum culling without CPU matrices: assign the bounding sphere the
 * binding supplied for this batch's asset so `Frustum.intersectsObject`
 * uses it (it prefers `object.boundingSphere` over the geometry's) and
 * never falls back to `computeBoundingSphere()`, which would read the
 * empty CPU array and cull the cell away. With no bounds supplied,
 * culling is disabled — drawing too much is recoverable, culling visible
 * geometry is not.
 *
 * `ctx.bounds` is per asset, so a rejected radius names the asset as
 * well as the cell: with several assets per cell the cell alone does not
 * identify which `bounds(...)` return value was wrong.
 */
function applyBounds(mesh: InstancedMesh, ctx: DeviceInstanceContext, assetId: string): void {
  const bounds = ctx.bounds;
  if (bounds === undefined) {
    mesh.frustumCulled = false;
    return;
  }
  const [x, y, z] = bounds.center;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    // An unbounded level's AABB is infinite: no sphere can express it.
    mesh.frustumCulled = false;
    return;
  }
  if (!Number.isFinite(bounds.radius) || bounds.radius < 0) {
    throw new Error(
      `createWebGpuInstanceAdapter: cell "${ctx.levelName}|${ctx.coord.join(",")}" supplied a ` +
        `bounding radius of ${String(bounds.radius)} for asset "${assetId}"; it must be a finite ` +
        "non-negative number (return undefined from `bounds` to disable frustum culling instead)",
    );
  }
  mesh.boundingSphere = new Sphere(new Vector3(x, y, z), bounds.radius);
  mesh.frustumCulled = true;
}
