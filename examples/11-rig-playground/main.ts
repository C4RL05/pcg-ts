/**
 * 11 — rig playground: components scattered along a spline, with cables
 * hanging off it. Geometry only.
 *
 * There are NO LIGHTS in this scene, on purpose. `examples/shared/scene.ts`
 * always adds a hemisphere and a sun and has no opt-out, and
 * `examples/shared/assets.ts` builds MeshStandardMaterial placeholders
 * which would render pure black here — so the host owns both, the way
 * 07-galaxy owns its renderer. Shading is either MeshNormalMaterial,
 * which reads volume and overlap better than any lit render and is what
 * you want when judging geometry, or a flat unlit colour per component
 * type, which reads composition and counts instead.
 *
 * Display changes (shading, wireframe, visibility) rebuild the MESHES
 * from the last cook rather than recooking: none of them can change a
 * single instance transform, and a recook per checkbox would make the
 * panel feel like it is thinking when it is not.
 */
import { toInstancedMeshes, type AssetMap, type InstancedAsset } from "pcg-ts/three";
import {
  BoxGeometry,
  BufferGeometry,
  Curve,
  Color,
  CylinderGeometry,
  GridHelper,
  Group,
  InstancedMesh,
  Material,
  MeshBasicMaterial,
  MeshNormalMaterial,
  PerspectiveCamera,
  Scene,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mount } from "svelte";
import { createFpsMeter } from "../shared/fps.js";
import { makeRecooker } from "../shared/recook.js";
import Panel from "./Panel.svelte";
import {
  DEFAULT_PARAMS,
  PART_KINDS,
  RIG_GROUPS,
  buildRigGraph,
  cookRig,
  noPartsEnabled,
  type PartKind,
  type RigGroup,
  type RigParams,
  type RigResult,
} from "./rig.js";
import type {
  DisplayKey,
  EnumParam,
  NumericParam,
  PanelBridge,
  PanelView,
  Shading,
} from "./view.js";

// -- scene ------------------------------------------------------------------

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x0d1117);

const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(19, 9, 26);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 5, 0);
controls.update();

// Unlit by construction (LineBasicMaterial), so it costs nothing here and
// gives the eye a ground plane to judge the hanging length against.
const grid = new GridHelper(80, 40, 0x2c3a52, 0x1b2331);
scene.add(grid);

const rigGroup = new Group();
scene.add(rigGroup);

// -- assets -----------------------------------------------------------------
// Geometry is authored in the LOCAL frame each spawner produces:
//
// - `tube` is what pathSegments feeds — axis "+y", scale (r, length, r) —
//   so it is a unit cylinder, radius 1 and height 1, and every spine and
//   cable segment lands on it exactly.
// - The component shapes are oriented by orientAlongVector with axis
//   "+z", which runs local +Z along the spine and puts local +Y as close
//   to world up as the tangent allows. So Y-long geometry sticks OUT
//   perpendicular (the rod), and Z-long geometry lies along the spine
//   (the bar, the collar). The rod is based at the origin rather than
//   centred, so it emerges from the spine instead of skewering it.

/**
 * The closed outline of a chain link: two semicircular caps joined by
 * straight sides — a stadium. Real links are oblong rather than round,
 * and the difference is what makes a chain read as a chain instead of a
 * string of rings, because the quarter-turn alternation only shows on a
 * shape that has a long axis at all.
 *
 * Long axis is LOCAL Y and the outline sits in the XY plane, which is
 * not arbitrary: the chain branch aims local +Z along a horizontal
 * direction with the chain's tangent as the up hint, and for a ±z axis
 * `orientAlongVector` puts local +Y on that hint. So local +Y is the
 * chain direction and local +Z is the ring's axis.
 *
 * Length is 1 so a uniform scale by a segment's length makes the link
 * span exactly that segment — the same contract the torus had.
 */
class StadiumCurve extends Curve<Vector3> {
  /** Half the straight run, and the cap radius (half the width). */
  constructor(
    private readonly half: number,
    private readonly r: number,
  ) {
    super();
  }

  getPoint(t: number, target = new Vector3()): Vector3 {
    const straight = this.half * 2;
    const cap = Math.PI * this.r;
    const total = 2 * straight + 2 * cap;
    // Walk the perimeter by LENGTH rather than by equal angle steps, so
    // the tube's segments stay evenly spaced around the corners.
    let s = t * total;
    if (s < straight) return target.set(this.r, -this.half + s, 0);
    s -= straight;
    if (s < cap) {
      const a = s / this.r; // 0 at +x, PI at -x, over the top cap
      return target.set(Math.cos(a) * this.r, this.half + Math.sin(a) * this.r, 0);
    }
    s -= cap;
    if (s < straight) return target.set(-this.r, this.half - s, 0);
    s -= straight;
    const a = s / this.r;
    return target.set(-Math.cos(a) * this.r, -this.half - Math.sin(a) * this.r, 0);
  }
}

/**
 * Link proportions, live. Both are fractions of a link's LENGTH, which
 * the graph sets from the chain segment it spans, so a link keeps its
 * shape whatever the chain length or link count.
 */
const display: Record<DisplayKey, number> = { linkWidth: 0.62, linkThickness: 0.085 };

/** Build the link outline and sweep a tube around it. */
function buildChainLink(): BufferGeometry {
  const width = display.linkWidth;
  // The hole closes once the section is as fat as the cap, and past that
  // the tube turns itself inside out. Clamped rather than left to the
  // slider, because the two ranges are independent and their product is
  // what has to stay sane.
  const thickness = Math.min(display.linkThickness, width * 0.42);
  return new TubeGeometry(
    new StadiumCurve(Math.max(0, (1 - width) / 2), width / 2),
    26,
    thickness,
    5,
    true,
  );
}

const GEOMETRY: Record<string, BufferGeometry> = {
  tube: new CylinderGeometry(1, 1, 1, 8),
  rod: new CylinderGeometry(0.045, 0.03, 1.6, 6).translate(0, 0.8, 0),
  bar: new BoxGeometry(0.1, 0.17, 1.5),
  panel: new BoxGeometry(0.42, 0.3, 0.66),
  clamp: new CylinderGeometry(0.32, 0.32, 0.28, 12).rotateX(Math.PI / 2),
  // An oblong link of unit LENGTH along Y, so scaling it by a chain
  // segment's length makes it span exactly that segment. Rebuilt when
  // its proportions change, which is why it is the one entry here that
  // is not a constant.
  chainLink: buildChainLink(),
};

/** Flat-mode colour per asset id — the only thing telling them apart. */
const FLAT_COLOUR: Record<string, number> = {
  tube: 0x8a94a6,
  rod: 0xe0603c,
  bar: 0x46c0a0,
  panel: 0xd9b23c,
  clamp: 0x7a6ce0,
  chainLink: 0xb0b8c4,
};

let shading: Shading = "normal";
let wireframe = false;

/** Materials are rebuilt whenever the display mode changes. */
function buildAssets(): AssetMap {
  const assets: Record<string, InstancedAsset> = {};
  // One shared normal material: toInstancedMeshes clones per mesh, so
  // sharing the source costs nothing and keeps disposal simple.
  const normal = new MeshNormalMaterial({ wireframe });
  for (const id of Object.keys(GEOMETRY)) {
    assets[id] = {
      geometry: GEOMETRY[id],
      material:
        shading === "normal"
          ? normal
          : new MeshBasicMaterial({ color: FLAT_COLOUR[id] ?? 0xffffff, wireframe }),
    };
  }
  return assets;
}

// -- state ------------------------------------------------------------------

let params: RigParams = { ...DEFAULT_PARAMS, weights: { ...DEFAULT_PARAMS.weights } };
let graph = buildRigGraph(params);
let lastResult: RigResult | undefined;
let meshes: InstancedMesh[] = [];
let cooking = false;
let error: string | undefined;
let fpsText = "—";
const visible: Record<RigGroup, boolean> = {
  chains: true,
  spine: true,
  parts: true,
  danglers: true,
  drapes: true,
};

const bridge: PanelBridge = {};

function view(): PanelView {
  // An empty mix still cooks a full set of parts (the graph falls back
  // to a one-entry values list), and the renderer then skips them. The
  // stats have to agree with the picture, not with the cook.
  const counts = { ...(lastResult?.counts ?? {}) };
  if (noPartsEnabled(params.weights)) counts.parts = 0;
  let total = 0;
  for (const group of RIG_GROUPS) total += visible[group] ? (counts[group] ?? 0) : 0;
  return {
    params,
    shading,
    wireframe,
    grid: grid.visible,
    visible: { ...visible },
    display: { ...display },
    cooking,
    fps: fpsText,
    counts,
    total,
    cookMs: lastResult?.elapsedMs ?? 0,
    drawCalls: meshes.length,
    // Not an error: an empty mix is a legitimate thing to dial to, and
    // the graph still cooks. Saying so beats an unexplained empty scene.
    notice: noPartsEnabled(params.weights) ? "every component type is at 0 — mix is empty" : undefined,
    error,
  };
}

function publish(): void {
  bridge.publish?.(view());
}

/** Drop every instanced mesh, including the materials cloned per mesh. */
function clearMeshes(): void {
  for (const mesh of meshes) {
    rigGroup.remove(mesh);
    // toInstancedMeshes clones the material per mesh and shares the
    // geometry by reference, so the clone is ours to dispose and the
    // geometry is emphatically not.
    const material: Material | Material[] = mesh.material;
    for (const m of Array.isArray(material) ? material : [material]) m.dispose();
    mesh.dispose();
  }
  meshes = [];
}

/** Rebuild the scene objects from the last cook. No cooking happens here. */
function rebuildMeshes(): void {
  clearMeshes();
  if (!lastResult) return;
  const assets = buildAssets();
  const partsEmpty = noPartsEnabled(params.weights);
  for (const group of RIG_GROUPS) {
    if (!visible[group]) continue;
    // With an empty mix every point falls back to the spawner's own
    // assetId, which would draw a full set of rods for a mix the user
    // just emptied. Drawing nothing is what they asked for.
    if (group === "parts" && partsEmpty) continue;
    const batches = lastResult.groups[group] ?? [];
    for (const mesh of toInstancedMeshes(batches, assets)) {
      mesh.frustumCulled = false;
      rigGroup.add(mesh);
      meshes.push(mesh);
    }
  }
}

const recook = makeRecooker(async () => {
  cooking = true;
  publish();
  try {
    lastResult = await cookRig(graph);
    error = undefined;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    cooking = false;
  }
  rebuildMeshes();
  publish();
});

/**
 * Params reach the graph by rebuilding it rather than by setParam. Most
 * of them are baked into FIELD EXPRESSIONS (the wander amplitude, the
 * sag, the part weights) rather than sitting in a scalar param, and a
 * field cannot be edited in place — so a rebuild is the honest move, and
 * at this size it costs a millisecond.
 */
function rebuildGraph(): void {
  graph = buildRigGraph(params);
  recook();
}

// -- panel ------------------------------------------------------------------

const host = {
  setNumber(key: NumericParam, value: number) {
    params = { ...params, [key]: value };
    rebuildGraph();
  },
  setChoice(key: EnumParam, value: string) {
    params = { ...params, [key]: value };
    rebuildGraph();
  },
  setWeight(kind: PartKind, weight: number) {
    params = { ...params, weights: { ...params.weights, [kind]: weight } };
    rebuildGraph();
  },
  setSeed(seed: number) {
    params = { ...params, seed };
    rebuildGraph();
  },
  setShading(next: Shading) {
    shading = next;
    rebuildMeshes();
    publish();
  },
  setWireframe(on: boolean) {
    wireframe = on;
    rebuildMeshes();
    publish();
  },
  setGrid(on: boolean) {
    grid.visible = on;
    publish();
  },
  setVisible(group: RigGroup, on: boolean) {
    visible[group] = on;
    rebuildMeshes();
    publish();
  },
  setDisplayNumber(key: DisplayKey, value: number) {
    display[key] = value;
    // Drop the meshes BEFORE disposing the geometry they were sharing:
    // toInstancedMeshes shares geometry by reference and never disposes
    // it, so the host owns this one and has to free the old shape itself.
    clearMeshes();
    GEOMETRY.chainLink.dispose();
    GEOMETRY.chainLink = buildChainLink();
    rebuildMeshes();
    publish();
  },
};

const target = document.getElementById("panel");
if (!target) throw new Error("missing #panel element");
mount(Panel, { target, props: { host, bridge, initial: view() } });

// -- capture hooks ----------------------------------------------------------
// Used by the screenshot script; harmless otherwise.

declare global {
  interface Window {
    __rigReady?: () => boolean;
    __rigChrome?: (show: boolean) => void;
    __rigView?: (name: string) => void;
    __rigSet?: (patch: Partial<RigParams>) => void;
    __rigDisplay?: (patch: Partial<Record<DisplayKey, number>>) => void;
  }
}
window.__rigReady = () => !cooking && lastResult !== undefined;
/**
 * Set any subset of the params at once. The panel drives one knob at a
 * time; this is for scripted comparisons, where the whole point is that
 * two frames differ by exactly the fields named here and nothing else.
 */
/** The display-side twin of __rigSet: rebuilds geometry, never cooks. */
window.__rigDisplay = (patch: Partial<Record<DisplayKey, number>>) => {
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === "number") host.setDisplayNumber(key as DisplayKey, value);
  }
};
window.__rigSet = (patch: Partial<RigParams>) => {
  params = { ...params, ...patch, weights: { ...params.weights, ...(patch.weights ?? {}) } };
  rebuildGraph();
  publish();
};
window.__rigChrome = (show: boolean) => {
  const panel = document.getElementById("panel");
  if (panel) panel.style.display = show ? "" : "none";
};
/** Fixed poses, so two screenshots of different builds are comparable. */
const VIEWS: Record<string, { eye: [number, number, number]; look: [number, number, number] }> = {
  hero: { eye: [19, 9, 26], look: [0, 5, 0] },
  under: { eye: [2, 1.7, 7], look: [0, 7, -2] },
  detail: { eye: [-9, 5.2, 12], look: [-13, 7.2, 2] },
  side: { eye: [0, 7, 34], look: [0, 6, 0] },
};
window.__rigView = (name: string) => {
  const pose = VIEWS[name];
  if (!pose) return;
  camera.position.set(...pose.eye);
  controls.target.set(...pose.look);
  controls.update();
};

// -- run --------------------------------------------------------------------

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const fps = createFpsMeter((value) => {
  fpsText = value;
  publish();
});

// Referenced so the part-kind list stays a compile-time dependency of the
// host as well as the panel: adding a kind must break here too, not just
// silently render nothing.
void PART_KINDS;

rebuildGraph();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  fps();
});
