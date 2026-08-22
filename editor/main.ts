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
/**
 * The overlay's shared vocabulary, as a stylesheet rather than as a
 * `<style>` block in `index.html`. It moved to `shared/graph/` when the
 * demos grew a read-only view of their own graph: `NodeBox.svelte` went
 * with it, and a component may not read custom properties that only one
 * of its two pages declares. See that file.
 */
import "../shared/graph/tokens.css";
import type { DataItem } from "pcg-ts";
import { mount } from "svelte";
import {
  GridHelper,
  Group,
  LineBasicMaterial,
  MeshNormalMaterial,
  MeshStandardMaterial,
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

/**
 * GREYSCALE, and pure black behind it. The shared look is a cool sky over
 * a warm sun on a dark blue ground, which reads blue everywhere; this page
 * asks for neither cast. The lights have to be neutral for it to hold —
 * grey materials under a blue lamp are still blue.
 */
const { scene, camera, controls, start } = createScene({
  cameraPosition: [20, 15, 20],
  target: [0, 2, 0],
  background: 0x000000,
  lights: { sky: 0xffffff, ground: 0x2a2a2a, sun: 0xffffff },
});

/**
 * THE LINES ARE THE FLOOR. There is no ground plane under them any more.
 *
 * There used to be a lit slab beneath the grid, and on a pure black page
 * it was the one surface that read as a colour: a MeshStandardMaterial is
 * not its hex, it is its hex times whatever the lights do to it, so the
 * darkest floor that still looked deliberate was still visibly lighter
 * than everything around it. Deleted rather than made transparent — an
 * invisible mesh is still submitted, still lit, and still something to
 * keep in sync with the plan.
 *
 * The grid is rebuilt to fit whatever the graph made, so nothing here is
 * a fixed size. What ships as the initial 30×30 is only what stands
 * before the first cook lands.
 */
let grid = new GridHelper(30, 30, 0x3a3a3a, 0x242424);
scene.add(grid);
let gridKey = "";

/**
 * Resize the grid to the measured content.
 *
 * A GridHelper bakes its divisions into a buffer and has to be rebuilt,
 * which is why the plan is compared as a key first: a knob that nudges
 * the extent without crossing a snap boundary must not rebuild geometry
 * on every cook. Position is a transform either way, so it is set every
 * time.
 */
function applyGround(plan: GroundPlan): void {
  const key = `${plan.size}/${plan.divisions}`;
  if (key !== gridKey) {
    gridKey = key;
    scene.remove(grid);
    grid.dispose();
    grid = new GridHelper(plan.size, plan.divisions, 0x3a3a3a, 0x242424);
    scene.add(grid);
  }
  grid.position.set(plan.x, plan.y + plan.lift, plan.z);
}

/**
 * COLOURED, on a page whose chrome is greyscale. The two are different
 * layers and the greyscale belongs to only one of them: the toolbar,
 * the panels and the node boxes are neutral so that nothing in the UI
 * competes with the render, which is the opposite reason from anything
 * to do with the scene. Placeholder assets ARE the render — greying
 * them throws away the one signal that separates one spawned batch
 * from the next, and next to per-output hues it reads as unfinished
 * geometry rather than as a decision.
 */
const assets = createPlaceholderAssets();
const outputGroup = new Group();
scene.add(outputGroup);
let drawn: Object3D[] = [];

/**
 * This page's look, kept out of `shared/draw.ts` for the same reason the
 * preview page keeps its daylight one: choosing a material is renderer
 * work, and the two pages are judged against different things. These
 * match the dark studio of `shared/scene.ts`.
 *
 * `vertexColors` is still honoured where a graph wrote a colour attribute
 * — that is the graph's own data showing through, not this page's
 * palette, and blanking it would be hiding a cook result rather than
 * styling a page.
 */
/**
 * One hue per OUTPUT, because a graph declares outputs to name its parts.
 *
 * A single constant colour for all geometry was fine while a graph was one
 * thing. It stopped being fine when the parts became real surfaces: the
 * rig declares nine outputs precisely so a viewer can tell a clamp from a
 * cable, its two instanced outputs keep their per-asset materials and read
 * as themselves, and its seven swept ones all arrived in the same
 * blue-grey. Colour-coding the instances and not the geometry is an
 * accident of where the material comes from, not a decision anyone made.
 *
 * Index 0 is the old constant, so every single-output graph — most of the
 * corpus — renders exactly as it did. The hues after it are spaced around
 * the wheel at a similar lightness, which is what makes them tell apart on
 * a near-black background where saturation alone would not.
 *
 * Assigned by first appearance rather than hashed from the name: a hash is
 * stable across graphs but collides, and two ADJACENT parts sharing a
 * colour is the exact failure this exists to prevent. The cost is that
 * adding an output can shift the ones after it, which is a re-cook of the
 * same scene, not a comparison between two.
 */
const OUTPUT_COLORS = [
  0x93a7c4, 0xe2a447, 0x6ec2a0, 0xcf8bc4, 0xd2705f, 0x8fb84a, 0x59b6cf, 0xa396d8,
];

/**
 * The line colour for an output: its hue, lifted towards white.
 *
 * Lines and surfaces from the SAME output want to be recognisably one
 * part, and still separable from each other — a swept tube drawn over the
 * path it was swept along is the everyday case. Lightness carries the
 * second distinction, so hue is left to carry the first.
 *
 * Slot 0 keeps the amber the page has always drawn lines in, so that the
 * corpus's many single-output path graphs are untouched by this: slot 0 is
 * the old PAIR, not just the old mesh colour.
 */
const LINE_0 = 0xffb454;
const litLine = (index: number): number => {
  if (index % OUTPUT_COLORS.length === 0) return LINE_0;
  const c = OUTPUT_COLORS[index % OUTPUT_COLORS.length];
  const lift = (shift: number): number =>
    Math.round(((c >> shift) & 0xff) + (0xff - ((c >> shift) & 0xff)) * 0.45);
  return (lift(16) << 16) | (lift(8) << 8) | lift(0);
};

/**
 * Materials for one output's items.
 *
 * Minted per draw, as the single constant pair was: `disposeDrawn` frees a
 * Mesh's material, so a shared palette instance would be disposed by the
 * first cook that drew it and the page would be handing out dead materials
 * from then on. That contract is worth more than the allocation — three
 * caches the compiled program per material key, so a colour drawn every
 * cook costs a JS object and no GPU work.
 *
 * The colour multiplies any vertex colours the geometry carries, exactly
 * as the old constant did: for the standard `color` attribute at its white
 * default this IS the colour, and a graph that authors real colours is
 * tinted by its output's hue rather than by one blue-grey.
 */
const litMaterialsFor = (index: number): DrawMaterials => ({
  mesh: (vertexColors) =>
    new MeshStandardMaterial({
      color: OUTPUT_COLORS[index % OUTPUT_COLORS.length],
      roughness: 0.85,
      metalness: 0,
      vertexColors,
    }),
  line: (vertexColors) => new LineBasicMaterial({ color: litLine(index), vertexColors }),
});

/**
 * The other way to look at geometry: surface direction instead of light.
 *
 * Worth a control rather than a preference, because the two answer
 * different questions. A lit render says what a thing would look like; a
 * normal render says what SHAPE it is — overlapping solids, a twist in a
 * swept tube, a face pointing the wrong way, all of which a single key
 * light on a dark studio flattens into one silhouette. When the geometry
 * is what you are judging, and in a graph editor it usually is, normals
 * read better.
 *
 * `MeshNormalMaterial` ignores vertex colours by construction, so the
 * flag the lit factories take is dropped here rather than passed on: a
 * graph's `color` attribute stops showing in this mode, which is the
 * trade — direction OR colour, not both.
 */
const normalMaterials: DrawMaterials = {
  /**
   * Minted per draw, NOT `sharedNormal`. `disposeDrawn` frees a plain
   * Mesh's material, so handing it the page-wide instance disposed it on
   * the next cook — and the InstancedMeshes still holding it as their
   * override lost their compiled program with it, every knob turn. The
   * shared one is for the override alone, which dispose leaves untouched.
   */
  mesh: () => new MeshNormalMaterial(),
  line: (vertexColors) => new LineBasicMaterial({ color: 0xcfd6e4, vertexColors }),
};

/**
 * One material for the whole page, not one per cook.
 *
 * `disposeDrawn` deliberately leaves an InstancedMesh's material alone —
 * normally it belongs to the memoized asset — so minting one of these per
 * cook would leak a GPU program on every knob turn.
 */
const sharedNormal = new MeshNormalMaterial();

export type Shading = "lit" | "normals";
let shading: Shading = "lit";
/**
 * Normals mode answers a question about SHAPE, so it stays one material
 * for the whole scene: per-output colour there would be a second signal
 * fighting the one being read, and `MeshNormalMaterial` has no colour to
 * give anyway.
 */
const materialsFor = (mode: Shading, output: number): DrawMaterials =>
  mode === "normals" ? normalMaterials : litMaterialsFor(output);

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

/**
 * What the last cook drew, kept so the shading control can redraw without
 * re-cooking. Switching how something is shaded is not a question about
 * the graph, and paying a cook for it would make the control unusable on
 * exactly the graphs it is most useful for.
 */
let lastDrawn: { items: readonly DataItem[]; info: RenderInfo } | null = null;

function setShading(mode: Shading): void {
  if (mode === shading) return;
  shading = mode;
  // `fresh: false` — a redraw must not re-frame the camera. The content is
  // the same content; only its material changed.
  if (lastDrawn !== null) render(lastDrawn.items, { ...lastDrawn.info, fresh: false });
}

function render(items: readonly DataItem[], info: RenderInfo): void {
  lastDrawn = { items, info };
  for (const obj of drawn) outputGroup.remove(obj);
  disposeDrawn(drawn);
  drawn = [];
  /**
   * A palette slot per output, in the order the outputs first appear. The
   * map is what makes an output that produced sixteen items one colour
   * rather than sixteen.
   */
  const slot = new Map<string, number>();
  for (const name of info.outputs) if (!slot.has(name)) slot.set(name, slot.size);
  // A count per kind rather than a list: an arbitrary graph can produce a
  // dozen outputs, and "mesh · lines · points" repeated twelve times says
  // less than "3 mesh · 12 points".
  const tally = new Map<string, number>();
  for (const [i, item] of items.entries()) {
    const { objects, report } = drawItem(item, {
      assets,
      materials: materialsFor(shading, slot.get(info.outputs[i] ?? "") ?? 0),
      pointSize: 0.16,
      ...(shading === "normals" ? { instanceMaterial: sharedNormal } : {}),
    });
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
  publish?: (s: { fps: string; drew: string; gpu: GpuState; shading: Shading }) => void;
  /** The editor's way back to the scene: re-frame on demand. */
  frame?: () => void;
  /** The editor's way to choose a cook path. */
  setCookPath?: (path: CookPath) => void;
  /** The editor's way to choose how geometry is shaded. Redraws, never re-cooks. */
  setShading?: (mode: Shading) => void;
} = {};
bridge.setShading = (mode) => {
  setShading(mode);
  publish();
};
bridge.frame = frameNow;
let fpsText = "–";
let gpu: GpuState = { path: "cpu", ready: false, label: "", error: null };
const publish = (): void => bridge.publish?.({ fps: fpsText, drew: drewSummary, gpu, shading });

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
