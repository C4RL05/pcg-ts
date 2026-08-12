/**
 * Guard tests for the render-state release contract that per-mesh
 * material clones lean on (`cloneAssetMaterial` in `instanced.ts`, and
 * the clone/dispose pairs in `toInstancedMeshes`, `WorldThreeBinding`
 * and `createWebGpuInstanceAdapter`).
 *
 * ## The leak these exist to keep fixed
 *
 * three's `WebGPURenderer` keys an instanced mesh's render state per
 * mesh: `RenderObject.getMaterialCacheKey()` appends `object.uuid` for
 * any `InstancedMesh`, so every mesh gets its own `NodeBuilderState`
 * (a full WGSL build), pipeline and per-object uniform buffers — all
 * held in STRONG renderer-side caches (`NodeManager.nodeBuilderCache`,
 * `Pipelines.caches`/`programs`). The one and only signal that releases
 * any of it is the `dispose` event of the material the mesh rendered
 * with: `RenderObject` subscribes to it, and its teardown cascades
 * through `RenderObjects` into `Pipelines.delete` (programs refcount to
 * zero and are destroyed), `Bindings.deleteForRender` (per-object
 * uniform buffers destroyed) and `NodeManager.delete` (the cached
 * builder state evicted). Removing a mesh from the scene releases
 * NOTHING — worse, the material's listener list pins every RenderObject
 * strongly, so even GC cannot reclaim an evicted mesh while its material
 * lives. With the asset materials shared across all meshes and never
 * disposed, a streaming world grew three's program count by ~15 per
 * cooked cell (measured 1,911 → 8,821 over six minutes of flight),
 * unbounded.
 *
 * Hence per-mesh material clones, disposed on every release path. These
 * tests pin the three internals (r0.185) that make that the correct —
 * and a sufficient — fix, so a three upgrade that moves any link in the
 * chain fails here with the file named instead of silently resurrecting
 * the leak.
 *
 * A real-renderer assertion (`renderer.info.memory.programs` returning
 * to baseline after evictions) is not possible in this suite:
 * `WebGPURenderer` needs a canvas context to initialize and the repo's
 * Dawn-based device runner (`src/gpu/deviceRunner.mjs`) drives raw
 * compute, not three. The contract is pinned by source and by driving
 * three's real `RenderObject` class directly instead.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  BoxGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
} from "three";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

/** The RenderObject surface these tests drive. */
interface RenderObjectLike {
  onDispose: (() => void) | null;
  getMaterialCacheKey(): number;
  dispose(): void;
}
type RenderObjectCtor = new (...args: unknown[]) => RenderObjectLike;

let renderObjectCtor: Promise<RenderObjectCtor> | undefined;

/**
 * Deep-import the class under contract. three's exports map allows
 * `three/src/*` and RenderObject has no browser dependencies, but
 * `@types/three` ships no declaration for it — hence the runtime
 * resolution with a typed cast rather than a static import.
 */
function loadRenderObject(): Promise<RenderObjectCtor> {
  renderObjectCtor ??= import(
    /* @vite-ignore */
    pathToFileURL(require.resolve("three/src/renderers/common/RenderObject.js")).href
  ).then((module) => (module as { default: RenderObjectCtor }).default);
  return renderObjectCtor;
}

function threeSource(relativePath: string): string {
  return readFileSync(require.resolve(`three/src/${relativePath}`), "utf8");
}

/** Names the moved internal and the fix, matching the repo's seam-test style. */
function moved(file: string, what: string): string {
  return (
    `three has changed ${file}: ${what}. The per-mesh material clones minted by ` +
    "src/three/instanced.ts and src/three/webgpuInstances.ts rely on this internal to release " +
    "per-mesh render state on evict; re-read the file and update the clone/dispose design (and " +
    "this pin) before trusting a streaming world not to leak renderer caches"
  );
}

describe("why materials are cloned per mesh (three keys instanced render state per mesh)", () => {
  it("RenderObject forks the material cache key on object.uuid for instanced meshes", () => {
    const source = threeSource("renderers/common/RenderObject.js");
    const fix = moved(
      "RenderObject.js",
      "getMaterialCacheKey() no longer appends object.uuid for instanced meshes. If render " +
        "state is no longer per mesh, per-mesh clones still release correctly but may have " +
        "become unnecessary — re-evaluate, do not just delete this pin",
    );
    expect(source, fix).toMatch(/object\.isInstancedMesh \|\| object\.count > 1/);
    expect(source, fix).toContain("cacheKey += object.uuid + ','");
  });

  it("even identical meshes compile distinct WGSL: buffer bindings are named by global node id", () => {
    // This is why the leak grew by ~one shader PROGRAM per mesh (not just
    // one pipeline): each build names its instance-matrix binding
    // `NodeBuffer_<id>` from a globally incrementing node id, so the
    // vertex WGSL of two otherwise identical meshes differs textually
    // and three's program cache (keyed by code) cannot share them. It is
    // also why "share one program across meshes" is not reachable from
    // library code — see the phase 47 report for the upstream shape.
    const source = threeSource("renderers/webgpu/nodes/WGSLNodeBuilder.js");
    expect(
      source,
      moved(
        "WGSLNodeBuilder.js",
        "buffer uniform names are no longer minted as 'NodeBuffer_' + id. If three now names " +
          "them stably, identical meshes may share programs — the leak fix still holds, but the " +
          "per-mesh program cost analysis behind it is stale (see the phase 47 commits: " +
          "git log --grep 'phase(47)')",
      ),
    ).toContain("uniformNode.name = name ? name : 'NodeBuffer_' + uniformNode.id");
  });
});

describe("material dispose is the release lever (pinned by source, three r0.185)", () => {
  it("RenderObject subscribes to the material's dispose event and tears itself down on it", () => {
    const source = threeSource("renderers/common/RenderObject.js");
    const fix = moved(
      "RenderObject.js",
      "a RenderObject no longer disposes itself when its material fires 'dispose'",
    );
    expect(source, fix).toContain("this.material.addEventListener( 'dispose', this.onMaterialDispose );");
    expect(source, fix).toMatch(/this\.onMaterialDispose = \(\) => \{\s*this\.dispose\(\);\s*\};/);
    // dispose() must both unhook the listener (unpinning the object for
    // GC) and run the onDispose cascade RenderObjects installed.
    expect(source, fix).toContain("this.material.removeEventListener( 'dispose', this.onMaterialDispose );");
    expect(source, fix).toMatch(/dispose\(\) \{[\s\S]*?this\.onDispose\(\);[\s\S]*?\}/);
  });

  it("the teardown cascade releases pipelines, bindings, node state and the chain entry", () => {
    const source = threeSource("renderers/common/RenderObjects.js");
    const fix = moved(
      "RenderObjects.js",
      "renderObject.onDispose no longer releases pipelines/bindings/nodes/chain entries",
    );
    expect(source, fix).toContain("this.pipelines.delete( renderObject );");
    expect(source, fix).toContain("this.bindings.deleteForRender( renderObject );");
    expect(source, fix).toContain("this.nodes.delete( renderObject );");
    expect(source, fix).toContain("chainMap.delete( renderObject.getChainArray() );");
  });

  it("NodeManager evicts the cached NodeBuilderState when its last user goes", () => {
    const source = threeSource("renderers/common/nodes/NodeManager.js");
    const fix = moved(
      "nodes/NodeManager.js",
      "delete() no longer evicts nodeBuilderCache entries at zero usedTimes — the WGSL builds " +
        "of evicted meshes would accumulate in a strong Map again",
    );
    expect(source, fix).toContain("nodeBuilderState.usedTimes --;");
    expect(source, fix).toMatch(
      /if \( nodeBuilderState\.usedTimes === 0 \) \{\s*this\.nodeBuilderCache\.delete\( this\.getForRenderCacheKey\( object \) \);/,
    );
  });

  it("Pipelines releases pipelines and programs at zero usedTimes, decrementing info", () => {
    const source = threeSource("renderers/common/Pipelines.js");
    const fix = moved(
      "Pipelines.js",
      "delete() no longer refcounts pipelines/programs down and destroys them at zero — " +
        "renderer.info.memory.programs would climb without bound again",
    );
    expect(source, fix).toContain("pipeline.usedTimes --;");
    expect(source, fix).toContain("if ( pipeline.usedTimes === 0 ) this._releasePipeline( pipeline );");
    expect(source, fix).toContain(
      "if ( pipeline.vertexProgram.usedTimes === 0 ) this._releaseProgram( pipeline.vertexProgram );",
    );
    expect(source, fix).toContain("this.info.destroyProgram( program );");
  });

  it("releasing a render object's bindings never destroys a storage attribute's buffer", () => {
    // The safety half of the contract: the device path adopts GPUBuffers
    // that the batch's handle owns (and may still share with a live
    // cell). Disposing a per-mesh material must therefore free the
    // per-object uniform buffers WITHOUT touching storage-attribute
    // buffers — three's binding teardown destroys uniform buffers and
    // samplers only. Attribute buffers are destroyed exclusively through
    // geometry disposal (Geometries → Attributes.delete →
    // backend.destroyAttribute), which is exactly why the binding and
    // adapter never dispose the shared asset geometry.
    const bindings = threeSource("renderers/common/Bindings.js");
    const fix = moved(
      "Bindings.js",
      "_destroyBindings has started destroying attribute-backed buffers; disposing a per-mesh " +
        "material would now destroy() an adopted device buffer a live cell may still draw from",
    );
    expect(bindings, fix).toContain("this.backend.destroyUniformBuffer( binding );");
    expect(bindings, fix).not.toContain("destroyAttribute");
    // And the geometry-disposal path really is where attribute buffers
    // die — the reason asset geometry stays shared and undisposed.
    const geometries = threeSource("renderers/common/Geometries.js");
    expect(geometries, fix).toContain("this.attributes.delete( geometryAttribute );");
    const attributes = threeSource("renderers/common/Attributes.js");
    expect(attributes, fix).toContain("this.backend.destroyAttribute( attribute );");
  });
});

describe("material dispose is the release lever (driven against the real RenderObject)", () => {
  /**
   * Construct a real RenderObject with the minimal collaborator set its
   * constructor and cache keys touch, stubbed exactly as the renderer
   * would fill them. Every other argument is a real three object.
   */
  function makeRenderObject(
    RenderObject: RenderObjectCtor,
    object: Mesh | InstancedMesh,
    material: MeshBasicMaterial,
  ) {
    const nodes = { getCacheKey: () => 7 };
    const renderer = {
      _currentSourceMaterial: null,
      contextNode: { id: 0, version: 0 },
      backend: { isWebGPUBackend: true },
    };
    const camera = new PerspectiveCamera();
    const renderContext = { id: 1 };
    const ro = new RenderObject(
      nodes,
      {},
      renderer,
      object,
      material,
      {},
      camera,
      null,
      renderContext,
      null,
    );
    let disposeCalls = 0;
    ro.onDispose = () => disposeCalls++;
    return { ro, disposeCalls: () => disposeCalls };
  }

  it("disposing the material disposes the RenderObject exactly once, then unhooks", async () => {
    const RenderObject = await loadRenderObject();
    const geometry = new BoxGeometry();
    const material = new MeshBasicMaterial();
    const { disposeCalls } = makeRenderObject(
      RenderObject,
      new InstancedMesh(geometry, material, 2),
      material,
    );
    material.dispatchEvent({ type: "dispose" });
    expect(disposeCalls(), "the material's dispose event must tear the render object down").toBe(1);
    // The listener is removed by dispose(): a second event is a no-op —
    // and the strong reference pinning the RenderObject in the
    // material's listener list is gone, so GC can reclaim the mesh.
    material.dispatchEvent({ type: "dispose" });
    expect(disposeCalls()).toBe(1);
  });

  it("two instanced meshes sharing one material still get DISTINCT cache keys (per-mesh state)", async () => {
    // The premise of the whole design: instanced render state is per
    // mesh no matter what the material is, so per-mesh clones add no
    // extra shader builds — they only add the release lever.
    const RenderObject = await loadRenderObject();
    const geometry = new BoxGeometry();
    const material = new MeshBasicMaterial();
    const a = makeRenderObject(RenderObject, new InstancedMesh(geometry, material, 2), material);
    const b = makeRenderObject(RenderObject, new InstancedMesh(geometry, material, 2), material);
    expect(a.ro.getMaterialCacheKey()).not.toBe(b.ro.getMaterialCacheKey());
  });

  it("two plain meshes sharing one material get the SAME cache key (no uuid fork)", async () => {
    // Contrast case, so the previous test is pinned to instancing rather
    // than to some global per-object salt.
    const RenderObject = await loadRenderObject();
    const geometry = new BoxGeometry();
    const material = new MeshBasicMaterial();
    const a = makeRenderObject(RenderObject, new Mesh(geometry, material), material);
    const b = makeRenderObject(RenderObject, new Mesh(geometry, material), material);
    expect(a.ro.getMaterialCacheKey()).toBe(b.ro.getMaterialCacheKey());
  });
});
