/**
 * 06 — graph editor: a registry-driven node editor built entirely on the
 * public API. The Svelte panel edits an editor-side model; the controller
 * applies each edit to a live Graph through the mutation API (no rebuild,
 * so caches survive structural edits), cooks debounced, and this module
 * renders the cook outputs into the shared three.js scene (geometry as
 * debug points, instances via toInstancedMeshes).
 */
import type { DataItem } from "pcg-ts";
import { toInstancedMeshes, toPointsObject } from "pcg-ts/three";
import { mount } from "svelte";
import {
  GridHelper,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type Object3D,
} from "three";
import { createFpsMeter } from "../shared/fps.js";
import { createOverlay } from "../shared/overlay.js";
import { createScene } from "../shared/scene.js";
import { createBaseAssets, resolveAssets } from "./assets.js";
import { EditorController, type CookStatus } from "./controller.js";
import Editor from "./Editor.svelte";

// -- scene -----------------------------------------------------------------

const { scene, start } = createScene({ cameraPosition: [20, 15, 20], target: [0, 2, 0] });

const ground = new Mesh(
  new PlaneGeometry(30, 30),
  new MeshStandardMaterial({ color: 0x1a2230, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
scene.add(ground);
scene.add(new GridHelper(30, 30, 0x2c3a52, 0x1e2939));

const assets = createBaseAssets();
const outputGroup = new Group();
scene.add(outputGroup);
let disposables: { obj: Object3D; dispose(): void }[] = [];

function render(items: readonly DataItem[]): void {
  for (const d of disposables) {
    outputGroup.remove(d.obj);
    d.dispose();
  }
  disposables = [];
  for (const item of items) {
    if (item.kind === "geometry") {
      const pts = toPointsObject(item.geo, { size: 0.16 });
      outputGroup.add(pts);
      disposables.push({
        obj: pts,
        dispose: () => {
          pts.geometry.dispose();
          pts.material.dispose();
        },
      });
    } else if (item.kind === "instances") {
      for (const mesh of toInstancedMeshes(item.batches, resolveAssets(item.batches, assets))) {
        outputGroup.add(mesh);
        disposables.push({ obj: mesh, dispose: () => mesh.dispose() });
      }
    }
    // value items have no scene representation; the overlay hash covers them
  }
}

// -- overlay (stats live here; controls live in the Svelte editor) ---------

const overlay = createOverlay({
  title: "06 · graph editor",
  info: "Palette → canvas → inspector; every edit mutates the live graph in place (add/connect/disconnect/removeNode), so untouched branches re-cook from cache — watch nodes cooked/cached after deleting a node. Unconnected output pins are the declared outputs.",
});
const statFps = overlay.addStat("fps");
const statOutputs = overlay.addStat("outputs");
const statCook = overlay.addStat("cook");
const statNodes = overlay.addStat("nodes cooked/cached");
const statPayload = overlay.addStat("points / instances");
const statHash = overlay.addStat("output hash");
const errorsPre = overlay.addCollapsible("cook errors", false);
errorsPre.textContent = "(none)";

function status(s: CookStatus): void {
  statOutputs(String(s.outputs));
  statCook(`${s.elapsedMs.toFixed(1)} ms`);
  statNodes(`${s.cooked} / ${s.cached}`);
  statPayload(`${s.points} / ${s.instances}`);
  statHash(s.hash);
  errorsPre.textContent = s.errors.length > 0 ? s.errors.join("\n\n") : "(none)";
}

// -- editor ----------------------------------------------------------------

const controller = new EditorController({ render, status });

const target = document.getElementById("editor");
if (!target) throw new Error("missing #editor element");
mount(Editor, { target, props: { controller } });

const fps = createFpsMeter((v) => statFps(v));
start(() => fps());
