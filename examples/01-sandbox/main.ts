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
import { createGpuPaths, requestGpuDevice, type CookPath, type GpuPaths } from "../shared/gpu.js";
import { disposeDrawn, drawItem, type DrawMaterials } from "../shared/draw.js";
import {
  depthRange,
  frameCamera,
  groundPlan,
  measureDrawn,
  type Framing,
  type GroundPlan,
} from "../shared/frame.js";
import { EditorController, type CookStatus, type RenderInfo } from "./controller.js";
import Editor from "./Editor.svelte";

// -- scene -----------------------------------------------------------------

const { scene, camera, controls, start } = createScene({
  cameraPosition: [20, 15, 20],
  target: [0, 2, 0],
});

/**
 * The floor is rebuilt to fit whatever the graph made, so nothing here is
 * a fixed size. What ships as the initial 30×30 is only what stands
 * before the first cook lands.
 */
const groundMaterial = new MeshStandardMaterial({ color: 0x1a2230, roughness: 1 });
const ground = new Mesh(new PlaneGeometry(1, 1), groundMaterial);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
let grid = new GridHelper(30, 30, 0x2c3a52, 0x1e2939);
scene.add(grid);
let groundKey = "";

/**
 * Resize the floor and grid to the measured content.
 *
 * The plane is a unit geometry under a scale so that following the
 * content costs a transform rather than an allocation, but a GridHelper
 * bakes its divisions into a buffer and has to be rebuilt. That is why
 * the plan is compared as a key first: a knob that nudges the extent
 * without crossing a snap boundary must not rebuild geometry on every
 * cook.
 */
function applyGround(plan: GroundPlan): void {
  ground.scale.set(plan.size, plan.size, 1);
  ground.position.set(plan.x, plan.y, plan.z);
  const key = `${plan.size}/${plan.divisions}`;
  if (key !== groundKey) {
    groundKey = key;
    scene.remove(grid);
    grid.dispose();
    grid = new GridHelper(plan.size, plan.divisions, 0x2c3a52, 0x1e2939);
    scene.add(grid);
  }
  grid.position.set(plan.x, plan.y + plan.lift, plan.z);
}

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

/**
 * A graph arrived and has not been framed yet.
 *
 * It survives a cook that drew nothing rather than being consumed by it,
 * because "nothing to measure" is not the same as "framed": a graph whose
 * first cook errors, or whose knob patch arrives a beat later, would
 * otherwise keep the pose of the graph before it for good.
 */
let pendingFrame = true;

/**
 * The last measurement, kept so the depth range can follow the camera.
 * The framing fixes where the camera STARTS; the wheel has no ceiling,
 * so near and far have to be re-derived from where it actually is.
 */
let framed: Framing | null = null;

/**
 * Point the camera at what is there now, whether or not it is new. The
 * measurement is a parameter so the render path, which has just taken
 * one to size the floor, does not pay for a second.
 */
function frameNow(measured?: Framing | null): void {
  const framing = measured === undefined ? measureDrawn(outputGroup) : measured;
  if (framing === null) return;
  framed = framing;
  frameCamera(framing, camera, controls);
  depthAt = camera.position.distanceTo(controls?.target ?? framing.center);
  pendingFrame = false;
}

/**
 * Re-derive the depth range for wherever the camera has been dollied to.
 *
 * Guarded by a ratio rather than run unconditionally: this is per-frame
 * work, and rebuilding the projection matrix for a distance that moved a
 * fraction of a percent is pure cost. A quarter is far inside the
 * headroom `depthRange` leaves, so the planes never catch up late.
 */
let depthAt = 0;
function followDepth(): void {
  if (framed === null || controls === undefined) return;
  const d = camera.position.distanceTo(controls.target);
  if (d > depthAt * 0.8 && d < depthAt * 1.25) return;
  depthAt = d;
  const { near, far } = depthRange(framed, d);
  camera.near = near;
  camera.far = far;
  camera.updateProjectionMatrix();
}

function render(items: readonly DataItem[], info: RenderInfo): void {
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

  /**
   * The floor follows every cook that drew something, the camera only a
   * new graph. They are judged differently: a floor that lags the content
   * reads as a bug, while a camera that moves while you are turning a
   * knob takes the view away from the very thing you are watching.
   *
   * A cook that drew nothing — an error, or a filter that kept no points
   * — leaves both alone rather than collapsing them onto a measurement
   * that does not exist. The previous floor is the better guess at the
   * scale the graph is being edited at.
   */
  if (info.fresh) pendingFrame = true;
  const framing = measureDrawn(outputGroup);
  if (framing === null) return;
  framed = framing;
  applyGround(groundPlan(framing));
  if (pendingFrame) frameNow(framing);
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
/** What the toolbar needs to know about the device, if there is one. */
export interface GpuState {
  readonly path: CookPath;
  /** False while probing, and after a failure or a lost device. */
  readonly ready: boolean;
  /** Adapter description, once there is one. */
  readonly label: string;
  /** Why there is no device, verbatim. Null while probing or once ready. */
  readonly error: string | null;
}

const bridge: {
  publish?: (s: { fps: string; drew: string; gpu: GpuState }) => void;
  /** The editor's way back to the scene: re-frame on demand. */
  frame?: () => void;
  /** The editor's way to choose a cook path. */
  setCookPath?: (path: CookPath) => void;
} = {};
bridge.frame = frameNow;
let fpsText = "–";
let gpu: GpuState = { path: "cpu", ready: false, label: "", error: null };
const publish = (): void => bridge.publish?.({ fps: fpsText, drew: drewSummary, gpu });

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

// -- the device ------------------------------------------------------------

/**
 * The cook paths, once a device answers. The page opens on the CPU and
 * probes in the background: a graph has to be on screen before WebGPU
 * has finished negotiating, and a page that waits for an adapter it may
 * never get is a page that never draws.
 */
let paths: GpuPaths | undefined;

/** Push the selected path to the controller, which recooks. */
function applyCookPath(): void {
  if (paths === undefined || gpu.path === "cpu") {
    controller.setGpuResolver(undefined);
    return;
  }
  controller.setGpuResolver(gpu.path === "gpu-fused" ? paths.fused : paths.perNode);
}

bridge.setCookPath = (path) => {
  gpu = { ...gpu, path };
  applyCookPath();
  publish();
};

/**
 * Set the moment a device is lost, and never cleared. The loss can
 * arrive DURING the probe — the handler is registered before the probe
 * resolves — and without this the continuation below would build paths
 * on the corpse and re-advertise the device as ready.
 */
let deviceLost = false;

void (async () => {
  const probe = await requestGpuDevice((detail) => {
    deviceLost = true;
    // Deliberately NOT disposed: dispose destroys pooled buffers, and a
    // cook may still be holding them. The device is gone either way, so
    // dropping the reference and letting it be collected is the safe
    // half of that trade.
    paths = undefined;
    gpu = { path: "cpu", ready: false, label: "", error: `device lost — ${detail}` };
    applyCookPath();
    // The pass in flight was handed the dead device and will never
    // settle on its own; the CPU recook just scheduled is stuck behind
    // it until it does.
    controller.abandonCook(`device lost — ${detail}`);
    publish();
  });
  if ("error" in probe) {
    // Back to the CPU as well as unavailable. The selector renders
    // `gpu.path`, so leaving a GPU path selected here would show a path
    // the page is not on — the same inconsistency the loss branch avoids.
    gpu = { path: "cpu", ready: false, label: "", error: probe.error };
    applyCookPath();
    publish();
    return;
  }
  if (deviceLost) return; // lost while probing; the handler already reported it
  paths = createGpuPaths(probe);
  gpu = { ...gpu, ready: true, label: probe.label, error: null };
  // The selector is live while the probe is in flight, so honour a
  // choice already made rather than silently staying on the CPU.
  applyCookPath();
  publish();
})();

const fps = createFpsMeter((v) => {
  fpsText = v;
  publish();
});
start(() => {
  followDepth();
  fps();
});
