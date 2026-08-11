/**
 * Guard test for `webgpuInstances.ts`.
 *
 * three publishes no supported way to render from a `GPUBuffer` you
 * already own, so the adapter depends on internals. Every one of them is
 * pinned here — structurally where a shape can be inspected,
 * behaviourally where the behaviour is what matters, and by source text
 * where the code lives inside a module-private function. When three
 * moves any of them this suite fails with a message naming the three
 * version and the moved API, instead of the renderer silently drawing
 * identity matrices (a world of assets stacked at the origin) or nothing
 * at all.
 *
 * All of it runs in the ordinary vitest suite: `three/webgpu` imports
 * fine in Node, and `new WebGPUBackend({})` constructs with
 * `device === null`, which is exactly what makes the adoption
 * short-circuit testable without a GPU (if three ever stopped
 * short-circuiting it would have to touch the null device and throw).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { BoxGeometry, InstancedMesh, MeshBasicMaterial, Sphere, Vector3 } from "three";
import { StorageInstancedBufferAttribute, WebGPUBackend, WebGPURenderer } from "three/webgpu";
import { describe, expect, it } from "vitest";
import type { DeviceInstanceBatch, DeviceTransformsHandle } from "../fields/index.js";
import { checkAdoptionSeam, createWebGpuInstanceAdapter } from "./webgpuInstances.js";
import type { DeviceInstanceContext } from "./worldBinding.js";

const require = createRequire(import.meta.url);

/** The three release these internals were read from and verified against. */
const VERIFIED_THREE = "0.185.1";

/**
 * Node has no WebGPU globals, but `WebGPUBackend.createStorageAttribute`
 * evaluates `GPUBufferUsage.*` to build its argument before the
 * short-circuit we are pinning is even reached. Stub the real numeric
 * constants (from the WebGPU spec) so the probe exercises three's code
 * exactly as a browser would — and so the flag values themselves are
 * pinned rather than only their names.
 */
const GPU_BUFFER_USAGE = {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
} as const;
const globals = globalThis as unknown as { GPUBufferUsage?: typeof GPU_BUFFER_USAGE };
globals.GPUBufferUsage ??= GPU_BUFFER_USAGE;

/** `three/package.json` is not in three's exports map; resolve the build instead. */
function threeVersion(): string {
  const pkg = join(dirname(require.resolve("three")), "..", "package.json");
  return (JSON.parse(readFileSync(pkg, "utf8")) as { version: string }).version;
}

function threeSource(relativePath: string): string {
  return readFileSync(require.resolve(`three/src/${relativePath}`), "utf8");
}

/** A renderer-shaped object exposing only what the seam needs. */
function fakeRenderer(backend: unknown): { readonly backend: unknown } {
  return { backend };
}

function newAttribute(count: number): StorageInstancedBufferAttribute {
  const attr = new StorageInstancedBufferAttribute(new Float32Array(0), 16);
  (attr as { count: number }).count = count;
  return attr;
}

describe("three version", () => {
  it("is the release the WebGPU instance-adapter internals were verified against", () => {
    const installed = threeVersion();
    const [major, minor] = installed.split(".");
    const [vMajor, vMinor] = VERIFIED_THREE.split(".");
    expect(
      `${major}.${minor}`,
      `three ${installed} is installed, but src/three/webgpuInstances.ts adopts a GPUBuffer ` +
        `into three's WebGPU backend using internals read from three ${VERIFIED_THREE}: ` +
        "`Backend.get(attribute).buffer`, the `buffer === undefined` short-circuit in " +
        "WebGPUAttributeUtils.createAttribute, the `isStorageInstancedBufferAttribute` branch in " +
        "nodes/accessors/Instance.js, and a writable BufferAttribute.count. Re-verify those four " +
        "against the new release and update VERIFIED_THREE_VERSION in webgpuInstances.ts (and " +
        "VERIFIED_THREE here), or pin three to " +
        `${VERIFIED_THREE}. Do not skip this test: a moved internal renders wrong matrices ` +
        "rather than failing",
    ).toBe(`${vMajor}.${vMinor}`);
  });
});

describe("three/webgpu exports the adapter depends on", () => {
  it("StorageInstancedBufferAttribute, WebGPURenderer and WebGPUBackend are constructible", () => {
    for (const [name, ctor] of [
      ["StorageInstancedBufferAttribute", StorageInstancedBufferAttribute],
      ["WebGPURenderer", WebGPURenderer],
      ["WebGPUBackend", WebGPUBackend],
    ] as const) {
      expect(typeof ctor, `three/webgpu no longer exports ${name} (three ${threeVersion()})`).toBe(
        "function",
      );
    }
  });

  it("WebGPUBackend constructs without a device and exposes the seam methods", () => {
    const backend = new WebGPUBackend({}) as unknown as Record<string, unknown>;
    for (const name of ["get", "set", "has", "delete", "createStorageAttribute"]) {
      expect(typeof backend[name], `WebGPUBackend.${name} moved (three ${threeVersion()})`).toBe(
        "function",
      );
    }
    expect(backend.device, "WebGPUBackend.device is expected to be null before init()").toBe(null);
    expect(
      (backend.attributeUtils as { constructor: { name: string } }).constructor.name,
      `backend.attributeUtils is no longer WebGPUAttributeUtils (three ${threeVersion()})`,
    ).toBe("WebGPUAttributeUtils");
  });
});

describe("instance-matrix attribute shape", () => {
  it("a zero-length storage attribute carries both flags the render path gates on", () => {
    const attr = newAttribute(7) as unknown as Record<string, unknown>;
    // nodes/accessors/Instance.js picks the storage (buffer-backed)
    // branch on this flag; without it three reads `instanceMatrix.array`
    // — which is empty here — and every instance collapses to identity.
    expect(
      attr.isStorageInstancedBufferAttribute,
      `StorageInstancedBufferAttribute lost isStorageInstancedBufferAttribute (three ${threeVersion()})`,
    ).toBe(true);
    // NodeMaterial.setupPositionNode only applies instancing at all when
    // this inherited flag is true.
    expect(
      attr.isInstancedBufferAttribute,
      `StorageInstancedBufferAttribute no longer extends InstancedBufferAttribute (three ${threeVersion()})`,
    ).toBe(true);
    expect(attr.itemSize, "itemSize 16 must survive (any other size would be padded)").toBe(16);
    expect((attr.array as Float32Array).length, "the matrices must not exist on the CPU").toBe(0);
  });

  it("BufferAttribute.count is writable at runtime (typed readonly, plain data property)", () => {
    const attr = newAttribute(0);
    expect(attr.count).toBe(0);
    (attr as { count: number }).count = 512;
    expect(
      attr.count,
      `BufferAttribute.count is no longer writable (three ${threeVersion()}); the adapter would ` +
        "report 0 instances and draw nothing",
    ).toBe(512);
  });

  it("itemSize 16 avoids both of createAttribute's padding branches", () => {
    // vec3 storage attributes get padded to vec4, and any itemSize whose
    // byte stride is not a multiple of 4 gets padded too — either would
    // rewrite `bufferAttribute.array`/`itemSize` and change the layout we
    // adopt against. Pin three's ACTUAL conditions, then evaluate them
    // against our attribute: asserting `16 !== 3` on a local constant
    // would pass no matter what three does.
    const source = threeSource("renderers/webgpu/utils/WebGPUAttributeUtils.js");
    const fix =
      `three ${threeVersion()}: WebGPUAttributeUtils.createAttribute's padding conditions have ` +
      "changed. The adapter's instance matrix is itemSize 16 precisely because neither branch " +
      "fires for it; a padding branch that did fire would rewrite the attribute's array and " +
      "itemSize, so the storage binding would no longer describe the adopted buffer's layout";
    expect(source, fix).toMatch(/isStorageInstancedBufferAttribute \) && bufferAttribute\.itemSize === 3/);
    expect(source, fix).toMatch(
      /bufferAttribute\.itemSize > 1 && \( bufferAttribute\.itemSize \* array\.BYTES_PER_ELEMENT \) % 4 !== 0/,
    );
    const attr = newAttribute(4);
    expect(attr.itemSize, "the vec3 -> vec4 branch must not apply").not.toBe(3);
    expect(
      (attr.itemSize * Float32Array.BYTES_PER_ELEMENT) % 4,
      "the arrayStride branch must not apply",
    ).toBe(0);
  });

  it("adoption leaves the attribute's array untouched (no CPU matrices reappear)", () => {
    // The padding/rewrite code lives inside `if (buffer === undefined)`,
    // so adoption skips it. Assert that behaviourally rather than by
    // reading the source: if three ever rewrote `array` before the
    // short-circuit, the headline claim ("the matrices never exist on
    // the CPU") would quietly stop being true while everything still
    // rendered.
    const backend = new WebGPUBackend({}) as unknown as {
      get(o: object): Record<string, unknown>;
      createStorageAttribute(a: object): void;
    };
    const attr = newAttribute(64);
    backend.get(attr).buffer = { pcgAdopted: true };
    backend.createStorageAttribute(attr);
    expect(
      (attr.array as Float32Array).length,
      `three ${threeVersion()}: createStorageAttribute rewrote an adopted attribute's array, so ` +
        "instance matrices are being allocated on the CPU again",
    ).toBe(0);
    expect(attr.itemSize, "createStorageAttribute must not repack the item size").toBe(16);
    expect(attr.count, "createStorageAttribute must not reset the matrix count").toBe(64);
  });
});

describe("the adoption seam", () => {
  it("backend.get() auto-vivifies a per-object record and returns it stably", () => {
    const backend = new WebGPUBackend({}) as unknown as {
      get(o: object): Record<string, unknown>;
    };
    const a = {};
    const b = {};
    const recordA = backend.get(a);
    expect(recordA, `backend.get() no longer returns a record (three ${threeVersion()})`).toEqual(
      {},
    );
    expect(backend.get(a), "backend.get() must return the same record for the same object").toBe(
      recordA,
    );
    expect(backend.get(b), "backend.get() must key records per object").not.toBe(recordA);
    recordA.buffer = "sentinel";
    expect(backend.get(a).buffer, "writes through backend.get() must persist").toBe("sentinel");
  });

  it("createStorageAttribute short-circuits on a pre-seeded buffer (the whole mechanism)", () => {
    // The device is null, so if three stopped short-circuiting it would
    // reach `backend.device.createBuffer` and throw — which is exactly
    // the failure this pins, and why the test needs no GPU.
    const backend = new WebGPUBackend({});
    const renderer = fakeRenderer(backend);
    expect(() => checkAdoptionSeam(renderer, () => newAttribute(4))).not.toThrow();
  });

  it("createStorageAttribute still asks for exactly STORAGE | VERTEX | COPY_SRC | COPY_DST", () => {
    // The evaluator's pool allocates a transforms buffer with exactly
    // these flags. If three asked for more, an adopted buffer would fail
    // WebGPU validation at bind time with a message about usage.
    let requested: number | undefined;
    const backend = new WebGPUBackend({}) as unknown as {
      attributeUtils: { createAttribute(attribute: object, usage: number): void };
      createStorageAttribute(attribute: object): void;
    };
    backend.attributeUtils.createAttribute = (_attribute, usage) => {
      requested = usage;
    };
    backend.createStorageAttribute(newAttribute(1));
    const expected =
      GPU_BUFFER_USAGE.STORAGE |
      GPU_BUFFER_USAGE.VERTEX |
      GPU_BUFFER_USAGE.COPY_SRC |
      GPU_BUFFER_USAGE.COPY_DST;
    expect(
      requested,
      `three ${threeVersion()}: createStorageAttribute now requests usage ` +
        `0x${(requested ?? 0).toString(16)}, not 0x${expected.toString(16)} ` +
        "(STORAGE | VERTEX | COPY_SRC | COPY_DST). The evaluator's transforms buffers are " +
        "allocated with exactly those flags; a wider request makes an adopted buffer fail " +
        "WebGPU validation at bind time",
    ).toBe(expected);
  });

  it("reports a missing or moved backend accessor instead of rendering wrong matrices", () => {
    const cases: { readonly label: string; readonly backend: unknown }[] = [
      { label: "no backend", backend: undefined },
      { label: "null backend", backend: null },
      { label: "backend without get()", backend: { createStorageAttribute: () => undefined } },
      { label: "backend with a renamed get()", backend: { fetch: () => ({}) } },
      {
        label: "backend without createStorageAttribute()",
        backend: { get: () => ({}) },
      },
    ];
    for (const { label, backend } of cases) {
      let thrown: unknown;
      try {
        checkAdoptionSeam(fakeRenderer(backend), () => newAttribute(1));
      } catch (err) {
        thrown = err;
      }
      expect(thrown, `${label} must be rejected`).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      expect(message, `${label}: the failure must name the three version`).toContain("0.185.1");
      expect(message, `${label}: the failure must name the moved API`).toMatch(
        /backend\.get\(attribute\)\.buffer/,
      );
      expect(message, `${label}: the failure must state the fix`).toMatch(/webgpuInstances\.ts/);
    }
  });

  it("detects a backend that creates its own buffer over the seeded one", () => {
    // Simulates three dropping the `buffer === undefined` guard.
    const records = new WeakMap<object, Record<string, unknown>>();
    const overwritingBackend = {
      get(o: object): Record<string, unknown> {
        let rec = records.get(o);
        if (rec === undefined) {
          rec = {};
          records.set(o, rec);
        }
        return rec;
      },
      createStorageAttribute(attribute: object): void {
        this.get(attribute).buffer = { theirs: true };
      },
    };
    expect(() => checkAdoptionSeam(fakeRenderer(overwritingBackend), () => newAttribute(1))).toThrow(
      /replaced a pre-seeded attribute buffer|buffer === undefined/,
    );
  });

  it("detects a backend that clears the seeded buffer", () => {
    const records = new WeakMap<object, Record<string, unknown>>();
    const clearingBackend = {
      get(o: object): Record<string, unknown> {
        let rec = records.get(o);
        if (rec === undefined) {
          rec = {};
          records.set(o, rec);
        }
        return rec;
      },
      createStorageAttribute(attribute: object): void {
        delete this.get(attribute).buffer;
      },
    };
    expect(() => checkAdoptionSeam(fakeRenderer(clearingBackend), () => newAttribute(1))).toThrow(
      /the record was cleared/,
    );
  });
});

describe("three source pins (module-private code the adapter relies on)", () => {
  it("Instance.js still reads instanceMatrix from a storage buffer at instanceIndex", () => {
    const source = threeSource("nodes/accessors/Instance.js");
    const fix =
      `three ${threeVersion()}: nodes/accessors/Instance.js no longer takes the storage-buffer ` +
      "branch for instanceMatrix. Device-resident instances depend on it — every other branch " +
      "reads `instanceMatrix.array`, which the adapter deliberately leaves empty, so the whole " +
      "world would draw at identity. Re-read that file and update src/three/webgpuInstances.ts";
    expect(source, fix).toContain("isStorageInstancedBufferAttribute === true");
    expect(source, fix).toMatch(/storage\(\s*instanceMatrix,\s*'mat4',\s*matrixCount\s*\)/);
    expect(source, fix).toContain(".element( instanceIndex )");
  });

  it("Instance.js still reads instanceColor from a vec3 storage buffer", () => {
    const source = threeSource("nodes/accessors/Instance.js");
    const fix =
      `three ${threeVersion()}: nodes/accessors/Instance.js no longer takes the storage-buffer ` +
      "branch for instance colours. Every other branch reads `colors.array`, which the adapter " +
      "deliberately leaves empty, so every instance would draw black. Re-read that file and " +
      "update src/three/webgpuInstances.ts";
    expect(source, fix).toMatch(/storage\(\s*colors,\s*'vec3',\s*Math\.max\(\s*colors\.count,\s*1\s*\)\s*\)/);
    expect(source, fix).toContain("instanceColor.assign( instanceColorNode )");
    // `instance( instanceMatrix, instanceColor )` is what passes the
    // mesh's colour attribute in at all.
    expect(source, fix).toMatch(/instance\(\s*instanceMatrix,\s*instanceColor\s*\)/);
  });

  it("NodeMaterial still multiplies in instanceColor whenever the mesh has one", () => {
    const source = threeSource("materials/nodes/NodeMaterial.js");
    expect(
      source,
      `three ${threeVersion()}: NodeMaterial no longer gates instance colour on ` +
        "`object.instanceColor`; setting the attribute would no longer tint anything",
    ).toMatch(/if\s*\(\s*object\.instanceColor\s*\)/);
  });

  it("three's OWN vec3 storage rule is why the device buffer is 4 floats wide", () => {
    // The stride is not our choice and must not be re-derived from
    // memory. three repacks an itemSize-3 storage attribute to 4
    // components before upload — "WGSL does not support packed vec3 data
    // in storage buffers" — which is the same 16-byte stride the compose
    // kernel writes at. Pin three's actual condition and its actual
    // padded size, so a release that changed either fails here rather
    // than skewing every colour by a growing offset at runtime.
    const source = threeSource("renderers/webgpu/utils/WebGPUAttributeUtils.js");
    const fix =
      `three ${threeVersion()}: WebGPUAttributeUtils no longer pads itemSize-3 storage ` +
      "attributes to 4 components. That rule is the justification for the evaluator composing " +
      "16 bytes of colour per instance (INSTANCE_COLOR_COMPONENTS in src/gpu/applyKernels.ts); " +
      "re-derive the stride before changing anything";
    expect(source, fix).toMatch(
      /isStorageInstancedBufferAttribute \) && bufferAttribute\.itemSize === 3/,
    );
    expect(source, fix).toMatch(/paddedItemSize = 4;/);
    expect(source, fix).toContain("pad to vec4");
    // And the adapter's colour attribute is exactly the itemSize that
    // rule names, so the two really are talking about the same case.
    const attr = new StorageInstancedBufferAttribute(new Float32Array(0), 3);
    expect(attr.itemSize).toBe(3);
  });

  it("NodeMaterial still applies instancing for an InstancedBufferAttribute matrix", () => {
    const source = threeSource("materials/nodes/NodeMaterial.js");
    expect(
      source,
      `three ${threeVersion()}: NodeMaterial no longer gates instancing on ` +
        "`instanceMatrix.isInstancedBufferAttribute === true`; the adapter's storage attribute " +
        "may no longer be recognised as an instance matrix",
    ).toContain("instanceMatrix.isInstancedBufferAttribute === true");
  });

  it("WebGPUAttributeUtils still short-circuits creation on an existing buffer", () => {
    const source = threeSource("renderers/webgpu/utils/WebGPUAttributeUtils.js");
    const fix =
      `three ${threeVersion()}: WebGPUAttributeUtils.createAttribute no longer skips creation ` +
      "when the backend record already holds a buffer. That short-circuit IS the adoption " +
      "mechanism — without it three allocates its own buffer and uploads an empty array over " +
      "the device-composed matrices";
    expect(source, fix).toContain("bufferData.buffer");
    expect(source, fix).toMatch(/if\s*\(\s*buffer === undefined\s*\)/);
  });

  it("WebGPUBindingUtils still binds a storage buffer straight from the backend record", () => {
    const source = threeSource("renderers/webgpu/utils/WebGPUBindingUtils.js");
    expect(
      source,
      `three ${threeVersion()}: the storage-buffer bind group no longer reads ` +
        "`backend.get(binding.attribute).buffer`; the adopted buffer may not reach the shader",
    ).toMatch(/backend\.get\(\s*binding\.attribute\s*\)\.buffer/);
  });
});

describe("out-of-band bounds", () => {
  it("Frustum.intersectsObject prefers object.boundingSphere over the geometry's", () => {
    // This is what makes bounds supplied from the cell AABB work at all:
    // three never falls back to computeBoundingSphere(), which would
    // read the empty CPU matrix array and cull the whole cell.
    const source = threeSource("math/Frustum.js");
    expect(
      source,
      `three ${threeVersion()}: Frustum.intersectsObject no longer honours ` +
        "`object.boundingSphere`; device-resident cells would be culled using a bounding sphere " +
        "computed from CPU matrices that do not exist",
    ).toMatch(/object\.boundingSphere !== undefined/);
  });

  it("InstancedMesh.boundingSphere starts null and accepts an out-of-band sphere", () => {
    const mesh = new InstancedMesh(undefined, undefined, 0);
    expect(
      mesh.boundingSphere,
      `three ${threeVersion()}: InstancedMesh.boundingSphere is no longer a null-initialised field`,
    ).toBe(null);
    const sphere = new Sphere(new Vector3(1, 2, 3), 40);
    mesh.boundingSphere = sphere;
    expect(mesh.boundingSphere).toBe(sphere);
  });

  it("InstancedMesh.computeBoundingSphere would read the CPU matrix array (hence out-of-band)", () => {
    // The documented reason bounds cannot be computed: with a
    // zero-length instance matrix this produces an empty sphere.
    const mesh = new InstancedMesh(undefined, undefined, 0);
    mesh.instanceMatrix = newAttribute(4);
    mesh.count = 0;
    mesh.computeBoundingSphere();
    // An empty sphere (radius -1 in three) or a zero one — either way it
    // culls the cell at every camera position but one.
    expect(mesh.boundingSphere?.radius ?? 0).toBeLessThanOrEqual(0);
  });
});

// -- the adapter itself ----------------------------------------------------

/**
 * `build`/`release` never touch the GPUDevice — adoption is a write into
 * the backend's data map — so the whole adapter is exercisable in Node
 * against an uninitialized `WebGPUBackend`. That is what lets the
 * strongest assertion of all run here rather than only in a browser: the
 * buffer three will bind is *identically* the object the batch's handle
 * owns.
 */
interface StubHandle extends DeviceTransformsHandle {
  disposeCalls: number;
}

function stubHandle(count: number, backend = "webgpu", bytesPer = 64): StubHandle {
  const buffer = { size: Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(1, count * bytesPer)))) };
  let disposed = false;
  const handle: StubHandle = {
    backend,
    byteLength: count * bytesPer,
    disposeCalls: 0,
    get disposed() {
      return disposed;
    },
    get resource() {
      if (disposed) throw new Error("device transforms handle was disposed");
      return buffer;
    },
    dispose() {
      handle.disposeCalls++;
      disposed = true;
    },
  };
  return handle;
}

function stubBatch(assetId: string, count: number, handle?: StubHandle): DeviceInstanceBatch {
  return {
    residency: "device",
    assetId,
    count,
    transforms: handle ?? stubHandle(count),
  };
}

/** Instance colour rides 4 f32 per instance — the WGSL vec3 stride. */
const COLOR_BYTES_PER_INSTANCE = 16;

function colouredBatch(
  assetId: string,
  count: number,
  colors?: StubHandle,
): DeviceInstanceBatch & { colors: StubHandle } {
  return {
    ...stubBatch(assetId, count),
    colors: colors ?? stubHandle(count, "webgpu", COLOR_BYTES_PER_INSTANCE),
  };
}

const CTX: DeviceInstanceContext = { levelName: "spires", coord: [2, 3], bounds: undefined };
const BOUNDED: DeviceInstanceContext = {
  levelName: "spires",
  coord: [2, 3],
  bounds: { center: [48, 4, 72], radius: 21.5 },
};

async function makeAdapter() {
  const backend = new WebGPUBackend({});
  const renderer = { backend } as { readonly backend: unknown };
  const assets = { spire: { geometry: new BoxGeometry(), material: new MeshBasicMaterial() } };
  const adapter = await createWebGpuInstanceAdapter({ renderer, assets });
  return { adapter, backend: backend as unknown as { get(o: object): { buffer?: unknown } } };
}

describe("createWebGpuInstanceAdapter", () => {
  it("binds the batch's own GPUBuffer and composes no matrices on the CPU", async () => {
    const { adapter, backend } = await makeAdapter();
    const handle = stubHandle(140);
    const mesh = adapter.build(stubBatch("spire", 140, handle), BOUNDED) as InstancedMesh;

    expect((mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh).toBe(true);
    expect(mesh.count, "three draws exactly the batch's instances").toBe(140);
    const attr = mesh.instanceMatrix as unknown as {
      array: ArrayLike<number>;
      count: number;
      isStorageInstancedBufferAttribute?: boolean;
      name: string;
    };
    expect(attr.array.length, "the matrices must never exist on the CPU").toBe(0);
    expect(attr.count, "the storage attribute reports the real matrix count").toBe(140);
    expect(attr.isStorageInstancedBufferAttribute, "must take three's storage branch").toBe(true);
    expect(attr.name).toBe("pcg:instanceMatrix:spire");
    // THE claim, asserted by identity: what three will bind IS the
    // buffer the resident run composed into.
    expect(backend.get(attr as unknown as object).buffer).toBe(handle.resource);
    expect(handle.disposed, "the adapter never disposes a handle").toBe(false);
    expect(adapter.stats).toEqual({ built: 1, released: 0, adopted: 1, liveInstances: 140 });
  });

  it("applies out-of-band bounds so three never computes them", async () => {
    const { adapter } = await makeAdapter();
    const mesh = adapter.build(stubBatch("spire", 8), BOUNDED) as InstancedMesh;
    expect(mesh.frustumCulled).toBe(true);
    expect(mesh.boundingSphere?.center.toArray()).toEqual([48, 4, 72]);
    expect(mesh.boundingSphere?.radius).toBe(21.5);
    // A non-null boundingSphere is exactly what stops
    // Frustum.intersectsObject calling computeBoundingSphere().
    expect(mesh.boundingSphere).not.toBe(null);
  });

  it("disables culling rather than guessing when bounds are absent or infinite", async () => {
    const { adapter } = await makeAdapter();
    expect((adapter.build(stubBatch("spire", 8), CTX) as InstancedMesh).frustumCulled).toBe(false);
    const unbounded: DeviceInstanceContext = {
      levelName: "landmarks",
      coord: [0, 0],
      bounds: { center: [-Infinity, 0, -Infinity], radius: Infinity },
    };
    const mesh = adapter.build(stubBatch("spire", 8), unbounded) as InstancedMesh;
    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.boundingSphere).toBe(null);
  });

  it("rejects a bad radius instead of silently clamping it", async () => {
    const { adapter } = await makeAdapter();
    const bad: DeviceInstanceContext = {
      levelName: "spires",
      coord: [1, 1],
      bounds: { center: [0, 0, 0], radius: -3 },
    };
    expect(() => adapter.build(stubBatch("spire", 4), bad)).toThrow(
      /bounding radius of -3.*finite non-negative/s,
    );
  });

  it("a zero-instance batch draws nothing (an InstancedMesh would draw one)", async () => {
    // three clamps the instance count to max(object.count, 1), so an
    // empty InstancedMesh would read a mat4 out of a zero-length array.
    const { adapter } = await makeAdapter();
    const object = adapter.build(stubBatch("spire", 0), CTX);
    expect((object as unknown as { isInstancedMesh?: boolean }).isInstancedMesh).not.toBe(true);
    expect(object.children).toHaveLength(0);
    expect(adapter.stats.adopted, "nothing to adopt").toBe(0);
    expect(adapter.stats.liveInstances).toBe(0);
  });

  it("release frees the three-side object and leaves the handle alone", async () => {
    const { adapter } = await makeAdapter();
    const handle = stubHandle(12);
    const mesh = adapter.build(stubBatch("spire", 12, handle), CTX) as InstancedMesh;
    let disposeEvents = 0;
    mesh.addEventListener("dispose", () => disposeEvents++);
    adapter.release(mesh);
    expect(disposeEvents).toBe(1);
    expect(handle.disposed, "handle ownership belongs to WorldThreeBinding").toBe(false);
    expect(handle.disposeCalls).toBe(0);
    expect(adapter.stats).toEqual({ built: 1, released: 1, adopted: 1, liveInstances: 0 });
    // Releasing a zero-instance placeholder is a no-op, not a crash.
    adapter.release(adapter.build(stubBatch("spire", 0), CTX));
    expect(adapter.stats.liveInstances).toBe(0);
  });

  it("refuses an unknown asset, a foreign backend, a size mismatch and a disposed handle", async () => {
    const { adapter } = await makeAdapter();
    expect(() => adapter.build(stubBatch("rock", 4), CTX)).toThrow(
      /unknown assetId "rock".*known assets: spire/s,
    );
    expect(() => adapter.build(stubBatch("spire", 4, stubHandle(4, "webgl")), CTX)).toThrow(
      /carries a "webgl" transforms handle/,
    );
    const mismatched: DeviceInstanceBatch = { ...stubBatch("spire", 4), count: 5 };
    expect(() => adapter.build(mismatched, CTX)).toThrow(/declares 5 instances \(320 bytes/);
    const dead = stubHandle(4);
    dead.dispose();
    expect(() => adapter.build(stubBatch("spire", 4, dead), CTX)).toThrow(/was disposed/);
  });

  it("the factory runs the seam check, so a moved internal fails at startup not at draw", async () => {
    // `checkAdoptionSeam` is the startup guarantee the whole design
    // leans on: a three upgrade that slipped past CI must fail loudly
    // when the adapter is constructed rather than silently render
    // identity matrices. Nothing else pins that the factory calls it.
    const records = new WeakMap<object, Record<string, unknown>>();
    const overwritingBackend = {
      get(o: object): Record<string, unknown> {
        let rec = records.get(o);
        if (rec === undefined) {
          rec = {};
          records.set(o, rec);
        }
        return rec;
      },
      createStorageAttribute(attribute: object): void {
        this.get(attribute).buffer = { theirs: true };
      },
    };
    await expect(
      createWebGpuInstanceAdapter({
        renderer: fakeRenderer(overwritingBackend),
        assets: { spire: { geometry: new BoxGeometry(), material: new MeshBasicMaterial() } },
      }),
    ).rejects.toThrow(/replaced a pre-seeded attribute buffer|buffer === undefined/);
  });

  it("refuses to adopt into a record that already holds a buffer", async () => {
    // The invariant that makes adoption safe is one fresh attribute per
    // batch (three caches bind groups by attribute identity). A backend
    // that keyed records differently — one shared record, say — would
    // make cell B bind cell A's buffer. That must be an error, not a
    // silently wrong frame.
    const shared: Record<string, unknown> = {};
    const sharingBackend = {
      get(): Record<string, unknown> {
        return shared;
      },
      createStorageAttribute(): void {
        /* short-circuits: the record already has a buffer */
      },
    };
    const adapter = await createWebGpuInstanceAdapter({
      renderer: fakeRenderer(sharingBackend),
      assets: { spire: { geometry: new BoxGeometry(), material: new MeshBasicMaterial() } },
    });
    // The construction-time seam probes used the same record; they clean
    // up after themselves (which is what lets the adapter run one per
    // item size), so this is belt and braces.
    delete shared.buffer;
    expect(adapter.build(stubBatch("spire", 4), CTX)).toBeTruthy();
    expect(() => adapter.build(stubBatch("spire", 4), CTX)).toThrow(
      /attribute records are being reused across batches/,
    );
  });

  it("adopts a colour buffer through the SAME seam and sets instanceColor", async () => {
    const { adapter, backend } = await makeAdapter();
    const batch = colouredBatch("spire", 140);
    const mesh = adapter.build(batch, BOUNDED) as InstancedMesh;

    const attr = mesh.instanceColor as unknown as {
      array: ArrayLike<number>;
      count: number;
      itemSize: number;
      isStorageInstancedBufferAttribute?: boolean;
      isInstancedBufferAttribute?: boolean;
      name: string;
    };
    expect(attr, "a coloured batch must set instanceColor").toBeTruthy();
    // `NodeMaterial.setupDiffuseColor` gates purely on `object.instanceColor`
    // being non-null, and `Instance.js` takes its storage branch on this
    // flag — every other branch reads `colors.array`, which is empty.
    expect(attr.isStorageInstancedBufferAttribute).toBe(true);
    expect(attr.isInstancedBufferAttribute).toBe(true);
    expect(attr.array.length, "colours must never exist on the CPU either").toBe(0);
    expect(attr.count).toBe(140);
    // itemSize 3 is what three's `storage(colors, 'vec3', count)` expects.
    // The BUFFER is 4 floats wide; those two numbers differ on purpose,
    // and the padding branch that would reconcile them never runs because
    // adoption short-circuits before it.
    expect(attr.itemSize).toBe(3);
    expect(attr.name).toBe("pcg:instanceColor:spire");
    // Identity again: what three binds IS the buffer the kernel gathered
    // into, and it is NOT the matrix buffer.
    expect(backend.get(attr as unknown as object).buffer).toBe(batch.colors.resource);
    expect(backend.get(attr as unknown as object).buffer).not.toBe(batch.transforms.resource);
    // Two buffers adopted for one batch; neither handle is disposed here.
    expect(adapter.stats).toEqual({ built: 1, released: 0, adopted: 2, liveInstances: 140 });
    expect(batch.colors.disposed).toBe(false);
    adapter.release(mesh);
    expect(batch.colors.disposeCalls, "handle ownership belongs to WorldThreeBinding").toBe(0);
  });

  it("leaves instanceColor null when the batch carries none", async () => {
    // Setting it flips three's program variant (the `vInstanceColor`
    // varying and a shader recompile), so an uncoloured spawn must leave
    // it alone rather than bind an all-white buffer.
    const { adapter } = await makeAdapter();
    const mesh = adapter.build(stubBatch("spire", 8), CTX) as InstancedMesh;
    expect(mesh.instanceColor).toBe(null);
    expect(adapter.stats.adopted).toBe(1);
  });

  it("refuses a colour handle of the wrong length or the wrong backend", async () => {
    const { adapter } = await makeAdapter();
    // 12 bytes per instance — the CPU batch's packing. This is THE
    // failure that would otherwise render as a colour skew growing with
    // the instance index rather than as an error.
    const tight = colouredBatch("spire", 4, stubHandle(4, "webgpu", 12));
    expect(() => adapter.build(tight, CTX)).toThrow(
      /instance-colour handle must be 64 bytes \(4 f32 per instance.*16-byte stride.*but it is 48 bytes/s,
    );
    const foreign = colouredBatch("spire", 4, stubHandle(4, "webgl", COLOR_BYTES_PER_INSTANCE));
    expect(() => adapter.build(foreign, CTX)).toThrow(/carries a "webgl" instance-colour handle/);
    const dead = stubHandle(4, "webgpu", COLOR_BYTES_PER_INSTANCE);
    dead.dispose();
    expect(() => adapter.build(colouredBatch("spire", 4, dead), CTX)).toThrow(/was disposed/);
  });

  it("every batch gets a fresh attribute, so three never reuses a bind group", async () => {
    const { adapter, backend } = await makeAdapter();
    const a = adapter.build(stubBatch("spire", 4), CTX) as InstancedMesh;
    const b = adapter.build(stubBatch("spire", 4), CTX) as InstancedMesh;
    expect(a.instanceMatrix).not.toBe(b.instanceMatrix);
    expect(backend.get(a.instanceMatrix as unknown as object).buffer).not.toBe(
      backend.get(b.instanceMatrix as unknown as object).buffer,
    );
    expect(adapter.stats.adopted).toBe(2);
  });
});

// -- per-mesh material lifecycle ---------------------------------------------

/**
 * Every mesh the adapter builds wears a per-mesh CLONE of the asset's
 * material, and `release` disposes it. The clone is not decoration:
 * three's renderer keys an instanced mesh's render state — render
 * object, built WGSL, pipeline, per-object uniform buffers — per mesh
 * (`RenderObject.getMaterialCacheKey()` appends `object.uuid`), and the
 * ONLY signal that releases any of it is the `dispose` event of the
 * material that mesh rendered with. A shared asset material never fires
 * mid-session, which measured as three's program count climbing ~15 per
 * cooked cell of streaming flight and never returning. The pinned three
 * internals live in renderStateRelease.test.ts; what is pinned HERE is
 * that the adapter mints one clone per mesh and fires its dispose on
 * every path a mesh can die — release, and a build that fails after the
 * clone exists.
 */
describe("createWebGpuInstanceAdapter per-mesh materials", () => {
  /** Assets whose material records every clone minted and every dispose received. */
  async function makeTrackedAdapter() {
    const backend = new WebGPUBackend({});
    const renderer = { backend } as { readonly backend: unknown };
    const material = new MeshBasicMaterial();
    const minted: MeshBasicMaterial[] = [];
    const disposed: MeshBasicMaterial[] = [];
    const originalClone = material.clone.bind(material);
    material.clone = () => {
      const clone = originalClone();
      minted.push(clone);
      clone.addEventListener("dispose", () => disposed.push(clone));
      return clone;
    };
    let assetDisposed = 0;
    material.addEventListener("dispose", () => assetDisposed++);
    const assets = { spire: { geometry: new BoxGeometry(), material } };
    const adapter = await createWebGpuInstanceAdapter({ renderer, assets });
    return { adapter, material, minted, disposed, assetDisposeCount: () => assetDisposed };
  }

  it("each mesh wears its own clone — never the asset's material, never a sibling's", async () => {
    const { adapter, material, minted } = await makeTrackedAdapter();
    const a = adapter.build(stubBatch("spire", 4), CTX) as InstancedMesh;
    const b = adapter.build(stubBatch("spire", 6), CTX) as InstancedMesh;
    expect(a.material).not.toBe(material);
    expect(b.material).not.toBe(material);
    expect(a.material).not.toBe(b.material);
    expect(minted).toEqual([a.material, b.material]);
  });

  it("release disposes the mesh's clone exactly once, and never the asset's material", async () => {
    const { adapter, minted, disposed, assetDisposeCount } = await makeTrackedAdapter();
    const mesh = adapter.build(stubBatch("spire", 12), CTX) as InstancedMesh;
    expect(disposed).toHaveLength(0);
    adapter.release(mesh);
    expect(disposed).toEqual(minted);
    expect(disposed).toHaveLength(1);
    expect(assetDisposeCount()).toBe(0);
  });

  it("a zero-instance placeholder mints no clone and releases without one", async () => {
    const { adapter, minted } = await makeTrackedAdapter();
    const placeholder = adapter.build(stubBatch("spire", 0), CTX);
    expect(minted).toHaveLength(0);
    adapter.release(placeholder);
    expect(minted).toHaveLength(0);
  });

  it("a bad radius fails BEFORE the clone is minted — validation precedes minting", async () => {
    const { adapter, minted } = await makeTrackedAdapter();
    const bad: DeviceInstanceContext = {
      levelName: "spires",
      coord: [1, 1],
      bounds: { center: [0, 0, 0], radius: -3 },
    };
    expect(() => adapter.build(stubBatch("spire", 4), bad)).toThrow(/bounding radius of -3/);
    expect(minted, "nothing to unwind: the clone must not exist yet").toHaveLength(0);
  });

  it("a build that fails after the clone exists disposes it before rethrowing", async () => {
    // A backend that hands every attribute ONE shared record makes the
    // colour adoption throw (`record.buffer` already set by the matrix
    // adoption) — which is a throw from inside the guarded region, after
    // the clone was minted.
    const shared: Record<string, unknown> = {};
    const sharingBackend = {
      get(): Record<string, unknown> {
        return shared;
      },
      createStorageAttribute(): void {
        /* short-circuits: the record already has a buffer */
      },
    };
    const material = new MeshBasicMaterial();
    const minted: MeshBasicMaterial[] = [];
    const disposed: MeshBasicMaterial[] = [];
    const originalClone = material.clone.bind(material);
    material.clone = () => {
      const clone = originalClone();
      minted.push(clone);
      clone.addEventListener("dispose", () => disposed.push(clone));
      return clone;
    };
    const adapter = await createWebGpuInstanceAdapter({
      renderer: fakeRenderer(sharingBackend),
      assets: { spire: { geometry: new BoxGeometry(), material } },
    });
    delete shared.buffer; // the seam probes cleaned up; be explicit anyway
    expect(() => adapter.build(colouredBatch("spire", 4), CTX)).toThrow(
      /attribute records are being reused across batches/,
    );
    expect(minted, "the clone was minted before the colour adoption threw").toHaveLength(1);
    expect(disposed, "…and disposed before the error escaped").toEqual(minted);
  });
});

// -- v0.8: several batches from one cell -----------------------------------

/**
 * A resident spawn driven by `assetAttr` hands the binding one batch per
 * asset, each with its own buffer, and the binding builds them through
 * one adapter in a row. `build` is per batch and holds no cross-batch
 * state, so what these pin is that it stays that way: N assets in, N
 * independent objects out, each bound to its own buffer with its own
 * geometry and its own sphere, and a failure in the middle of the run
 * leaving the earlier ones untouched.
 */
const MULTI_ASSETS = ["pine", "rock", "fern"] as const;

async function makeMultiAssetAdapter() {
  const backend = new WebGPUBackend({});
  const renderer = { backend } as { readonly backend: unknown };
  const assets: Record<string, { geometry: BoxGeometry; material: MeshBasicMaterial }> = {};
  // Distinct geometry per asset: a mesh drawing the wrong asset's
  // geometry is the failure a shared-state bug would produce.
  for (const id of MULTI_ASSETS) {
    assets[id] = { geometry: new BoxGeometry(), material: new MeshBasicMaterial() };
  }
  const adapter = await createWebGpuInstanceAdapter({ renderer, assets });
  return {
    adapter,
    assets,
    backend: backend as unknown as { get(o: object): { buffer?: unknown } },
  };
}

/**
 * A per-asset bounding sphere, the shape `DeviceInstanceBinding.bounds`
 * now returns. The centre moves with the radius so that a mesh wearing
 * the wrong batch's sphere is wrong in two independent components.
 */
function ctxWithRadius(radius: number): DeviceInstanceContext {
  return {
    levelName: "spires",
    coord: [2, 3],
    bounds: { center: [48 + radius, 4, 72], radius },
  };
}

describe("createWebGpuInstanceAdapter with several batches from one cell", () => {
  it("adopts one distinct buffer per asset into one distinct attribute", async () => {
    const { adapter, assets, backend } = await makeMultiAssetAdapter();
    const counts = [102, 103, 205];
    const handles = counts.map((n) => stubHandle(n));
    const meshes = MULTI_ASSETS.map(
      (id, i) => adapter.build(stubBatch(id, counts[i], handles[i]), CTX) as InstancedMesh,
    );

    MULTI_ASSETS.forEach((id, i) => {
      expect(meshes[i].name).toBe(id);
      expect(meshes[i].geometry, `${id} draws its own geometry`).toBe(assets[id].geometry);
      expect(meshes[i].count).toBe(counts[i]);
      const attr = meshes[i].instanceMatrix as unknown as { name: string };
      expect(attr.name).toBe(`pcg:instanceMatrix:${id}`);
      // The claim, by identity: the buffer three will bind for THIS mesh
      // is the buffer THIS batch's handle owns.
      expect(backend.get(attr as unknown as object).buffer).toBe(handles[i].resource);
    });
    // No two batches share an attribute or a buffer — three caches bind
    // groups by attribute identity, so a shared one would draw one
    // asset's matrices under another asset's geometry.
    const attrs = meshes.map((m) => m.instanceMatrix as unknown as object);
    expect(new Set(attrs).size).toBe(3);
    expect(new Set(attrs.map((a) => backend.get(a).buffer)).size).toBe(3);
    expect(adapter.stats).toEqual({ built: 3, released: 0, adopted: 3, liveInstances: 410 });
  });

  it("gives each batch the sphere its own context carried", async () => {
    const { adapter } = await makeMultiAssetAdapter();
    // Per-asset bounds is the point of threading `assetId` into the
    // binding's `bounds` callback: ground cover must not inherit a
    // landmark's radius.
    const pine = adapter.build(stubBatch("pine", 4), ctxWithRadius(12)) as InstancedMesh;
    const rock = adapter.build(stubBatch("rock", 4), ctxWithRadius(3)) as InstancedMesh;
    const fern = adapter.build(stubBatch("fern", 4), ctxWithRadius(210)) as InstancedMesh;
    // Centre AND radius, because `ctxWithRadius` offsets the centre by
    // the radius: a mesh wearing another batch's sphere fails on both.
    expect([pine, rock, fern].map((m) => m.boundingSphere?.radius)).toEqual([12, 3, 210]);
    expect([pine, rock, fern].map((m) => m.boundingSphere?.center.x)).toEqual([60, 51, 258]);
    // Separate Sphere objects: sharing one would make a later batch's
    // radius overwrite an earlier batch's.
    expect(pine.boundingSphere).not.toBe(rock.boundingSphere);
  });

  it("a rejected radius names the asset as well as the cell", async () => {
    const { adapter } = await makeMultiAssetAdapter();
    // A finite centre with a non-finite radius: the centre check runs
    // first and would disable culling instead of throwing.
    const bad: DeviceInstanceContext = {
      levelName: "spires",
      coord: [2, 3],
      bounds: { center: [48, 4, 72], radius: Number.NaN },
    };
    expect(() => adapter.build(stubBatch("fern", 4), bad)).toThrow(
      /cell "spires\|2,3" supplied a bounding radius of NaN for asset "fern"/,
    );
  });

  it("releasing every object of a multi-asset cell returns the live-instance meter to zero", async () => {
    const { adapter } = await makeMultiAssetAdapter();
    const objects = [
      adapter.build(stubBatch("pine", 30), CTX),
      // An empty batch in the middle: a placeholder, not an InstancedMesh.
      adapter.build(stubBatch("rock", 0), CTX),
      adapter.build(stubBatch("fern", 7), CTX),
    ];
    expect(adapter.stats).toEqual({ built: 3, released: 0, adopted: 2, liveInstances: 37 });
    for (const object of objects) adapter.release(object);
    expect(adapter.stats).toEqual({ built: 3, released: 3, adopted: 2, liveInstances: 0 });
  });

  it("a batch that fails validation adopts nothing and leaves the earlier ones intact", async () => {
    const { adapter, backend } = await makeMultiAssetAdapter();
    const good = stubHandle(4);
    const first = adapter.build(stubBatch("pine", 4, good), CTX) as InstancedMesh;
    const before = adapter.stats;
    expect(before).toEqual({ built: 1, released: 0, adopted: 1, liveInstances: 4 });

    // Batch 2 of 3 declares more instances than its handle holds.
    expect(() => adapter.build({ ...stubBatch("rock", 4), count: 5 }, CTX)).toThrow(
      /declares 5 instances/,
    );
    // Nothing was counted and nothing was adopted for the failed batch —
    // the binding is about to release the cell, and a phantom `built`
    // would never be balanced by a `release`.
    expect(adapter.stats).toEqual(before);
    // The surviving object still binds its own buffer.
    expect(backend.get(first.instanceMatrix as unknown as object).buffer).toBe(good.resource);

    // And a later batch still builds normally.
    const third = adapter.build(stubBatch("fern", 9), CTX) as InstancedMesh;
    expect(third.count).toBe(9);
    expect(adapter.stats).toEqual({ built: 2, released: 0, adopted: 2, liveInstances: 13 });
  });
});
