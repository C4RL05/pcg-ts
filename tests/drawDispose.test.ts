/**
 * `disposeDrawn` frees exactly what `drawItem` minted.
 *
 * The three parts of an instanced mesh have three different owners, and
 * every version of this function that got one of them wrong was silent:
 * a shared asset geometry disposed by mistake pulls the buffers out from
 * under every other mesh drawing that asset, and a per-mesh clone left
 * undisposed is memory that only ever climbs. Neither shows up in a
 * frame, so neither shows up in a screenshot.
 *
 * Lives in `tests/` for the reason `sharedAssets.test.ts` gives: the
 * browser pages sit outside vitest's `src/**` include.
 *
 * It watches three's own `dispose` EVENT rather than a spy on the method,
 * because the event is what the renderer listens to — it is the thing
 * that actually releases the GPU resource, and a test that asserted on
 * the method call would pass for a caller that disposed the wrong object
 * by the right name. No renderer is created: the events fire from the
 * objects themselves.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeInstancesItem, type InstanceBatch } from "pcg-ts";
import { ownsGeometry } from "pcg-ts/three";
import {
  InstancedMesh,
  LineBasicMaterial,
  MeshNormalMaterial,
  MeshStandardMaterial,
  type BufferGeometry,
  type Material,
} from "three";
import { createPlaceholderAssets } from "../shared/assets.js";
import { disposeDrawn, drawItem, type DrawMaterials } from "../shared/draw.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Nothing here judges a look; the factories only have to produce objects. */
const materials: DrawMaterials = {
  mesh: (vertexColors) => new MeshStandardMaterial({ vertexColors }),
  line: (vertexColors) => new LineBasicMaterial({ vertexColors }),
};

/** `count` identity matrices in `Matrix4.elements` order. */
function identities(count: number): Float32Array {
  const out = new Float32Array(count * 16);
  for (let i = 0; i < count; i++) {
    out[i * 16] = 1;
    out[i * 16 + 5] = 1;
    out[i * 16 + 10] = 1;
    out[i * 16 + 15] = 1;
  }
  return out;
}

/** Did this object's `dispose` event fire? Asked after the teardown. */
function watchDispose(target: BufferGeometry | Material): () => boolean {
  let fired = false;
  target.addEventListener("dispose", () => {
    fired = true;
  });
  return () => fired;
}

/** The one mesh a single-batch instances item draws as. */
function drawOne(
  batch: InstanceBatch,
  override?: Material,
): { mesh: InstancedMesh; objects: readonly object[] } {
  const assets = createPlaceholderAssets();
  const { objects } = drawItem(makeInstancesItem([batch]), {
    assets,
    materials,
    ...(override === undefined ? {} : { instanceMaterial: override }),
  });
  expect(objects).toHaveLength(1);
  const mesh = objects[0];
  expect(mesh).toBeInstanceOf(InstancedMesh);
  return { mesh: mesh as InstancedMesh, objects };
}

/**
 * The SAME asset map the drawn mesh resolved against.
 *
 * `createPlaceholderAssets` mints fresh geometry and materials per call,
 * so a second call would hand back look-alikes that no mesh references
 * and every "was it disposed?" assertion would pass vacuously.
 */
function assetsFor(batch: InstanceBatch): {
  mesh: InstancedMesh;
  objects: readonly object[];
  geometry: BufferGeometry;
  material: Material;
} {
  const assets = createPlaceholderAssets();
  const asset = assets.known[batch.assetId];
  expect(asset).toBeDefined();
  const { objects } = drawItem(makeInstancesItem([batch]), { assets, materials });
  const mesh = objects[0] as InstancedMesh;
  return {
    mesh,
    objects,
    geometry: asset.geometry,
    material: asset.material as Material,
  };
}

describe("disposeDrawn, on an instanced mesh", () => {
  it("frees the per-mesh material clone and leaves the asset's geometry and material alone", () => {
    const batch: InstanceBatch = { assetId: "box", count: 2, transforms: identities(2) };
    const { mesh, objects, geometry, material } = assetsFor(batch);

    // The mesh borrows the geometry and was handed a material of its own.
    expect(ownsGeometry(mesh)).toBe(false);
    expect(mesh.geometry).toBe(geometry);
    expect(mesh.material).not.toBe(material);

    const assetGeometryFreed = watchDispose(geometry);
    const assetMaterialFreed = watchDispose(material);
    const cloneFreed = watchDispose(mesh.material as Material);

    disposeDrawn(objects as never);

    expect(cloneFreed()).toBe(true);
    expect(assetGeometryFreed()).toBe(false);
    expect(assetMaterialFreed()).toBe(false);
  });

  it("frees the geometry clone a batch with a named channel was given", () => {
    const batch: InstanceBatch = {
      assetId: "box",
      count: 2,
      transforms: identities(2),
      // Not a reserved name, so it binds as an InstancedBufferAttribute on
      // the GEOMETRY — which is exactly why the mesh cannot share the
      // asset's and gets a clone it owns.
      attributes: { wear: new Uint32Array([7, 9]) },
    };
    const { mesh, objects, geometry } = assetsFor(batch);

    expect(ownsGeometry(mesh)).toBe(true);
    expect(mesh.geometry).not.toBe(geometry);
    expect(mesh.geometry.hasAttribute("wear")).toBe(true);

    const cloneFreed = watchDispose(mesh.geometry);
    const assetGeometryFreed = watchDispose(geometry);

    disposeDrawn(objects as never);

    expect(cloneFreed()).toBe(true);
    expect(assetGeometryFreed()).toBe(false);
  });

  it("leaves the asset's geometry alone for a coloured batch, which does not clone", () => {
    // `instanceColor` is a property of the MESH, not the geometry, so
    // colour alone must not trip the ownership flag.
    const batch: InstanceBatch = {
      assetId: "box",
      count: 2,
      transforms: identities(2),
      attributes: { color: new Float32Array([1, 0, 0, 0, 1, 0]) },
    };
    const { mesh, objects, geometry } = assetsFor(batch);

    expect(ownsGeometry(mesh)).toBe(false);
    expect(mesh.geometry).toBe(geometry);
    expect(mesh.instanceColor).not.toBeNull();

    const assetGeometryFreed = watchDispose(geometry);
    disposeDrawn(objects as never);
    expect(assetGeometryFreed()).toBe(false);
  });

  it("frees the clone of an instanceMaterial override without touching the override", () => {
    // The page mints one override for its whole life; `toInstancedMeshes`
    // clones it per mesh. Disposing the original would leave every later
    // cook cloning a dead material.
    const override = new MeshNormalMaterial();
    const overrideFreed = watchDispose(override);
    const batch: InstanceBatch = { assetId: "box", count: 1, transforms: identities(1) };
    const { mesh, objects } = drawOne(batch, override);

    expect(mesh.material).not.toBe(override);
    const cloneFreed = watchDispose(mesh.material as Material);

    disposeDrawn(objects as never);

    expect(cloneFreed()).toBe(true);
    expect(overrideFreed()).toBe(false);
  });
});

/**
 * A demo's source with its line endings normalized.
 *
 * `core.autocrlf` is on for this repo, so a Windows checkout has CRLF in
 * the working tree and a Linux one has LF — and a structural check that
 * searched for a literal `\n}` would pass on CI and fail on the machine
 * the change was written on, or the reverse.
 */
function demoSource(demo: string): string {
  return readFileSync(`${ROOT}demos/${demo}/main.ts`, "utf8").replace(/\r\n/g, "\n");
}

function disposeBuiltBody(demo: string): string {
  const src = demoSource(demo);
  const start = src.indexOf("function disposeBuilt(): void {");
  expect(start, `${demo}/main.ts has no disposeBuilt`).toBeGreaterThan(-1);
  const end = src.indexOf("\n}\n", start);
  expect(end, `${demo}/main.ts's disposeBuilt is unterminated`).toBeGreaterThan(start);
  return src.slice(start, end);
}

/**
 * The demos' own teardown, read as SOURCE.
 *
 * `demos/racetrack/main.ts` and `demos/road/main.ts` are page entry
 * points: both build a `WebGLRenderer` and touch `document` at module
 * scope, so importing one under vitest throws before a single function in
 * it is reachable. That rules out the behavioural test the block above
 * gets — and these pages carry the same ownership rule with the same
 * invisible failure. A page that disposes a borrowed geometry breaks the
 * NEXT cook; one that skips an owned clone leaks until the tab is closed.
 *
 * So the invariant is pinned structurally instead: the teardown must ASK
 * `ownsGeometry` rather than assume an answer, and it must free the
 * materials the replaced cook minted. Reading a demo's source in a test is
 * how `wordmark.test.ts` and `demoGraphPanel.test.ts` already cover these
 * files. A structural check is weaker than running the code and is not
 * pretending otherwise: it catches the rule being DROPPED, not every way
 * the rule could be misapplied.
 */
describe.each(["racetrack", "road"])("%s's disposeBuilt", (demo) => {
  it("imports the ownership predicate from the library", () => {
    // Not just "the word appears somewhere": it has to be named in the
    // `pcg-ts/three` import, so the page reads the flag that
    // `toInstancedMeshes` actually sets rather than a local look-alike.
    const specifiers = /import \{([^}]*)\} from "pcg-ts\/three";/.exec(demoSource(demo));
    expect(specifiers, `${demo}/main.ts has no pcg-ts/three import`).not.toBeNull();
    expect(specifiers?.[1].split(",").map((s) => s.trim())).toContain("ownsGeometry");
  });

  it("asks before disposing an instanced mesh's geometry", () => {
    const body = disposeBuiltBody(demo);
    // An InstancedMesh is separated out from the plain meshes, and the
    // only geometry disposal inside that branch is behind the predicate.
    expect(body).toContain("obj instanceof InstancedMesh");
    expect(body).toContain("if (ownsGeometry(obj)) obj.geometry.dispose();");
    // The unguarded disposal that follows must be unreachable for an
    // instanced mesh — the branch above it ends in `continue`.
    const branch = body.slice(body.indexOf("obj instanceof InstancedMesh"));
    expect(branch.slice(0, branch.indexOf("(obj as Mesh)"))).toContain("continue;");
  });

  it("frees every material the replaced cook minted", () => {
    // Layer 0 is the car, which outlives every recook; everything after it
    // was minted by the cook being torn down, an instanced mesh's material
    // clone included.
    const body = disposeBuiltBody(demo);
    expect(body).toContain("layers.slice(1)");
    expect(body).toContain("l.chase.dispose();");
    expect(body).toContain("if (l.map !== l.chase) l.map.dispose();");
  });
});

/**
 * Why the block above is the guard `road` needed.
 *
 * `PROP_BOX` is a module-level `BoxGeometry` that every cook instances
 * again, and the teardown used to dispose the geometry of everything in
 * `built` unconditionally — so the shared cube's GPU buffers were thrown
 * away on every recook and re-uploaded by the next one, with three's
 * geometry count going negative behind it. Nothing NAMED it, which is
 * exactly why it survived review: the bug was the generic path reaching
 * an object it should never have been handed.
 *
 * This pins the two facts that make the `InstancedMesh` branch the thing
 * that spares it, so the guard cannot be removed as redundant.
 */
describe("road's shared prop geometry", () => {
  it("is drawn by an instanced mesh, which is the branch the teardown guards", () => {
    const src = demoSource("road");
    // Module-level (column zero), so it outlives every cook.
    expect(src).toMatch(/^const PROP_BOX = new BoxGeometry\(1, 1, 1\);$/m);
    // And the one mesh that draws it goes into `built` as an InstancedMesh.
    expect(src).toMatch(/new InstancedMesh\(\s*PROP_BOX,/);
    expect(src).toContain("built.push(props);");
  });

  it("is never disposed", () => {
    // Comments are stripped first: the teardown's PROSE names the shared
    // cube — explaining why it is spared is the point — but its CODE must
    // not reach for it at all.
    const code = disposeBuiltBody("road").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("PROP_BOX");
    expect(demoSource("road")).not.toContain("PROP_BOX.dispose()");
  });
});
