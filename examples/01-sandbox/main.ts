/**
 * 06 — graph editor: a registry-driven node editor built entirely on the
 * public API. The Svelte panel edits an editor-side model; the controller
 * applies each edit to a live Graph through the mutation API (no rebuild,
 * so caches survive structural edits), cooks debounced, and this module
 * renders the cook outputs into the shared three.js scene (geometry as
 * debug points, instances via toInstancedMeshes).
 */
/**
 * Imported for its side effect: it REGISTERS every shipped primitive.
 * Corpus graphs reference primitives by name (`shape/ring`,
 * `transform/displace-by-noise`), and a name resolves against that
 * registry at load time — without this, loading one fails with "unknown
 * subgraph". The starter graph needs none, which is why the editor got
 * this far without it. It adds nothing to the palette: primitives are
 * registered subgraphs, and the palette lists node types.
 */
import "pcg-ts/primitives";
import type { DataItem } from "pcg-ts";
import { mount } from "svelte";
import {
  GridHelper,
  Group,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type Object3D,
} from "three";
import { createFpsMeter } from "../shared/fps.js";
import { createScene } from "../shared/scene.js";
import { createPlaceholderAssets } from "../shared/assets.js";
import { disposeDrawn, drawItem, type DrawMaterials } from "../shared/draw.js";
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

const assets = createPlaceholderAssets();
const outputGroup = new Group();
scene.add(outputGroup);
let drawn: Object3D[] = [];

/**
 * This page's look, kept out of `shared/draw.ts` for the same reason the
 * preview page keeps its daylight one: choosing a material is renderer
 * work, and the two pages are judged against different things. These
 * match the dark studio of `shared/scene.ts`.
 */
const materials: DrawMaterials = {
  mesh: (vertexColors) =>
    new MeshStandardMaterial({ color: 0x93a7c4, roughness: 0.85, metalness: 0, vertexColors }),
  line: (vertexColors) => new LineBasicMaterial({ color: 0xffb454, vertexColors }),
};

/** What the last cook actually drew, for the overlay's `drew` line. */
let drewSummary = "–";

function render(items: readonly DataItem[]): void {
  for (const obj of drawn) outputGroup.remove(obj);
  disposeDrawn(drawn);
  drawn = [];
  // A count per kind rather than a list: an arbitrary graph can produce a
  // dozen outputs, and "mesh · lines · points" repeated twelve times says
  // less than "3 mesh · 12 points".
  const tally = new Map<string, number>();
  for (const item of items) {
    const { objects, report } = drawItem(item, { assets, materials, pointSize: 0.16 });
    for (const obj of objects) outputGroup.add(obj);
    drawn.push(...objects);
    for (const what of report.drew) tally.set(what, (tally.get(what) ?? 0) + 1);
    if (report.skipped !== undefined) tally.set(`skipped: ${report.skipped}`, 1);
  }
  drewSummary =
    tally.size === 0
      ? "nothing"
      : [...tally].map(([what, n]) => (n > 1 ? `${n}× ${what}` : what)).join(" · ");
}

// -- readouts --------------------------------------------------------------

/**
 * There is no stats card any more. The editor is a full-bleed overlay
 * over the render, and anything floating over the scene shows through
 * its translucent canvas as ghost text — so the numbers live in the
 * toolbar's status line, which already carried most of them. These two
 * are the host's own (the cook does not know the frame rate, and what an
 * output DREW is a renderer question), pushed in through the bridge.
 */
const bridge: { publish?: (s: { fps: string; drew: string }) => void } = {};
let fpsText = "–";
const publish = (): void => bridge.publish?.({ fps: fpsText, drew: drewSummary });

function status(s: CookStatus): void {
  void s; // the editor already has it from the controller; this just refreshes ours
  publish();
}

// -- editor ----------------------------------------------------------------

const controller = new EditorController({ render, status });

const target = document.getElementById("editor");
if (!target) throw new Error("missing #editor element");
mount(Editor, { target, props: { controller, bridge } });
publish();

const fps = createFpsMeter((v) => {
  fpsText = v;
  publish();
});
start(() => fps());
