/// <reference types="vite/client" />
/**
 * The preview page: cook ONE serialized graph and render whatever it
 * produced, from camera poses the harness can screenshot.
 *
 * Driven by `npm run preview <graph.json>`, which injects the job as
 * `window.__PCG_PREVIEW_JOB__` before this module runs. It is also usable
 * by hand under `npm run examples` — open `/preview/?graph=<name>` to
 * load a file from `examples/graphs/`, then orbit with the mouse.
 *
 * NOT a demo, and deliberately absent from `build.rollupOptions.input` in
 * `examples/vite.config.ts`: it exists to be photographed by a script, it
 * renders nothing without a job, and shipping it to the Pages site would
 * put a blank page beside nine working ones.
 *
 * WHY IT LOOKS DIFFERENT FROM THE DEMOS. The demos share a dark studio
 * look from `shared/scene.ts`. This page is judged against outdoor
 * reference imagery, so it uses a daylight sky, fog, tone mapping and a
 * shadow-casting sun. That is renderer work, not generation work — pcg-ts
 * sets neither `castShadow` nor `receiveShadow` anywhere — and it lives
 * here rather than in `shared/scene.ts` precisely so it cannot move the
 * nine committed demo screenshots.
 */
import "pcg-ts/primitives";
import { cook, deserializeGraph, type DataItem } from "pcg-ts";

import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  Fog,
  GridHelper,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Raycaster,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createPlaceholderAssets } from "../shared/assets.js";
import { drawItem, type DrawMaterials } from "../shared/draw.js";

/** The job the harness injects; every field optional but `graph`. */
interface PreviewJob {
  readonly graph: unknown;
  readonly seed?: number;
  /** Ground-camera eye height in world units (default 1.7 — a person). */
  readonly eye?: number;
  /** Pin the framing extent instead of deriving it from the content. */
  readonly extent?: number;
  /** Draw points even for geometries that carry topology. */
  readonly points?: boolean;
  /** Add a ground grid at y = 0. */
  readonly grid?: boolean;
}

/** One named camera pose, in absolute world units. */
interface View {
  readonly name: string;
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly up: readonly [number, number, number];
  /**
   * World size for point sprites in this view. Per view because sprites
   * are size-attenuated: one world size that reads well from 80 m up is
   * a two-metre billboard when the camera is standing among them.
   */
  readonly pointSize: number;
  /**
   * Linear fog range for this view, also per view and for the same kind
   * of reason. At eye level haze is the depth cue that makes a forest
   * read as deep rather than flat, so it wants to start close; from the
   * hero pose the whole scene is farther away than that, and one shared
   * range washes the layout out to the colour of the sky.
   */
  readonly fog: readonly [number, number];
}

declare global {
  interface Window {
    __PCG_PREVIEW_JOB__?: PreviewJob;
    __pcgPreview?: {
      state: "loading" | "ready" | "error";
      error?: string;
      report?: unknown;
      views: string[];
      setView(name: string): void;
    };
  }
}

const probe: NonNullable<Window["__pcgPreview"]> = {
  state: "loading",
  views: [],
  setView: () => {},
};
window.__pcgPreview = probe;

function fail(message: string): never {
  probe.state = "error";
  probe.error = message;
  const el = document.getElementById("err");
  if (el) {
    el.textContent = message;
    el.style.display = "block";
  }
  throw new Error(message);
}

/**
 * Round an extent up a ~25% ladder.
 *
 * The camera must not move between iterations or the comparison the whole
 * method rests on is meaningless — but auto-framing from the content's
 * bounding box moves it whenever the content changes by a hair. Snapping
 * to a coarse ladder buys back the property that matters: tuning density,
 * a threshold or a seed leaves the framing bit-identical, while a real
 * change of extent still re-frames and the harness says so out loud.
 */
function quantizeExtent(value: number): number {
  if (!(value > 0)) return 1;
  const decade = Math.pow(10, Math.floor(Math.log10(value)));
  const ladder = [1, 1.25, 1.6, 2, 2.5, 3.2, 4, 5, 6.4, 8, 10];
  for (const step of ladder) {
    const candidate = step * decade;
    if (value <= candidate * (1 + 1e-9)) return candidate;
  }
  return 10 * decade;
}

/**
 * The fixed poses. `ground` stands INSIDE the content at eye height and
 * looks across it, because that is the view the reference imagery is of:
 * a density that reads well from above can be a bald patch at 1.7 m.
 *
 * `surfaceY` answers "what is the ground at this x, z" by raycasting
 * down through the scene's surfaces. Using the bounding box's minimum
 * instead — which is what the first version did — puts the eye at the
 * lowest point of the whole terrain, so on anything with relief the
 * camera stands metres UNDERGROUND and photographs the sky through the
 * back of a front-facing mesh. It renders confidently and is completely
 * wrong, which is the failure this whole tool exists to avoid.
 */
function viewsFor(
  cx: number,
  cz: number,
  groundY: number,
  extent: number,
  eye: number,
  surfaceY: (x: number, z: number) => number,
): View[] {
  const eyeX = cx;
  const eyeZ = cz + 0.22 * extent;
  const lookX = cx;
  const lookZ = cz - 0.3 * extent;
  // 1.15 * extent along a (1, 1, 1) direction: 35.26 degrees above the
  // horizontal — high enough to read layout, low enough to keep vertical
  // structure and cast shadows legible — and far enough back that
  // content filling its whole extent bucket still fits the frustum. The
  // first version stood at 0.87 and cropped the near half off anything
  // at 90% fill or more; 1.45 fixed the crop and then wasted half the
  // frame on sky.
  const heroDistance = 1.15 * extent;
  const heroOffset = heroDistance / Math.sqrt(3);
  const aerialFog: readonly [number, number] = [heroDistance * 0.95, extent * 4];
  return [
    {
      name: "hero",
      position: [cx + heroOffset, groundY + 0.05 * extent + heroOffset, cz + heroOffset],
      target: [cx, groundY + 0.05 * extent, cz],
      up: [0, 1, 0],
      pointSize: extent / 160,
      fog: aerialFog,
    },
    {
      name: "ground",
      position: [eyeX, surfaceY(eyeX, eyeZ) + eye, eyeZ],
      target: [lookX, surfaceY(lookX, lookZ) + eye * 0.9, lookZ],
      up: [0, 1, 0],
      // Sized against the eye, not the scene: the nearest points are a
      // couple of metres away, where an extent-sized sprite is a wall.
      pointSize: eye / 12,
      fog: [extent * 0.12, extent * 1.6],
    },
    {
      name: "top",
      // Straight down needs a non-Y up vector or lookAt degenerates.
      position: [cx, groundY + 1.15 * extent, cz],
      target: [cx, groundY, cz],
      up: [0, 0, -1],
      pointSize: extent / 160,
      fog: aerialFog,
    },
  ];
}

const assets = createPlaceholderAssets();

/** What one cooked item contributed, for the harness's sidecar. */
interface ItemReport {
  readonly output: string;
  readonly kind: string;
  readonly drew: string[];
  readonly points?: number;
  readonly primitives?: Record<string, number>;
  readonly instances?: number;
  /** Per-batch instance counts, keyed by assetId. */
  readonly batches?: Record<string, number>;
  /** The topology carried no `primtype`, so its kind was inferred. */
  readonly untagged?: boolean;
  readonly hint?: string;
  readonly skipped?: string;
}

/**
 * This page's look. Daylight, because it is judged against outdoor
 * reference imagery — see the header. What to DRAW is decided by
 * `shared/draw.ts`, which the sandbox shares; only the materials and the
 * shadow flags below are this page's own, and both are renderer work.
 */
const PREVIEW_MATERIALS: DrawMaterials = {
  mesh: (vertexColors) =>
    new MeshStandardMaterial({ color: 0x9aa792, roughness: 0.95, metalness: 0, vertexColors }),
  line: (vertexColors) => new LineBasicMaterial({ color: 0xffb454, vertexColors }),
};

/** Turn one cooked item into scene objects, and say what it drew. */
function addItem(group: Group, output: string, item: DataItem, job: PreviewJob): ItemReport {
  const { objects, report } = drawItem(item, {
    assets,
    materials: PREVIEW_MATERIALS,
    points: job.points,
    pointSize: 0.1,
  });
  for (const obj of objects) {
    // InstancedMesh extends Mesh, so this covers both. Lines and points
    // neither cast nor receive in three's shadow map, so flagging them
    // would only claim something untrue.
    if (obj instanceof Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
    group.add(obj);
  }
  return {
    ...report,
    output,
    ...(report.hint !== undefined ? { hint: `${report.hint}; pass --points to add them` } : {}),
  };
}

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  let job = window.__PCG_PREVIEW_JOB__;
  if (job === undefined) {
    // Hand use under `npm run examples`: /preview/?graph=basics-point-grid
    const name = params.get("graph");
    if (name === null) {
      fail(
        "preview: no job. This page is driven by `npm run preview <graph.json>`.\n" +
          "By hand, open /preview/?graph=<name> to load examples/graphs/<name>.json.",
      );
    }
    const corpus = import.meta.glob("../graphs/*.json", { query: "?raw", import: "default" });
    const key = `../graphs/${name}.json`;
    const load = corpus[key];
    if (load === undefined) {
      const known = Object.keys(corpus)
        .map((k) => k.slice("../graphs/".length, -".json".length))
        .join(", ");
      fail(`preview: no graph named "${name}" in examples/graphs. Known: ${known}`);
    }
    job = { graph: JSON.parse((await load()) as string) };
  }

  let report: Record<string, unknown>;
  const group = new Group();
  let stats;
  try {
    const graph = deserializeGraph(job.graph);
    if (job.seed !== undefined) graph.setSeed(job.seed);
    const cooked = await cook(graph);
    stats = cooked.stats;
    const items: ItemReport[] = [];
    for (const [name, collection] of Object.entries(cooked.outputs)) {
      for (const item of collection) items.push(addItem(group, name, item, job));
    }
    if (group.children.length === 0) {
      fail(
        `preview: the graph cooked but produced nothing drawable — ` +
          `${items.length} item(s): ${items.map((i) => `${i.output} (${i.kind})`).join(", ") || "none"}.` +
          "\nA graph whose only outputs are values has nothing to photograph.",
      );
    }
    report = {
      seed: graph.seed,
      meta: graph.meta ?? {},
      cook: { cooked: stats.cooked, cached: stats.cached, elapsedMs: stats.elapsedMs },
      items,
    };
  } catch (err) {
    if (probe.state === "error") throw err;
    fail(`preview: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Framing from the content, quantized so small edits do not move it.
  const box = new Box3().setFromObject(group);
  if (box.isEmpty()) fail("preview: the scene has no finite bounds");
  const size = box.getSize(new Vector3());
  const centre = box.getCenter(new Vector3());
  if (![size.x, size.y, size.z, centre.x, centre.y, centre.z].every(Number.isFinite)) {
    fail(
      "preview: the scene's bounding box is not finite — some position is NaN or infinite. " +
        "Cook with `pcg cook --stats` and look for a field that divided by zero.",
    );
  }
  // The 1.1 is margin, not slop. The hero pose is a fixed offset rather
  // than a frustum fit, so content filling its whole extent bucket clips
  // its near corner — measured on a plane exactly as wide as its bucket.
  // Asking for a bucket 10% larger only bumps the graphs above ~91% fill
  // into the next rung, which is precisely the band that clipped, and
  // leaves every other framing where it was.
  const extent = job.extent ?? quantizeExtent(Math.max(size.x, size.z, size.y, 1e-3) * 1.1);
  const eye = job.eye ?? 1.7;

  // Quantizing the EXTENT is not enough to hold the camera still: every
  // pose is also anchored to the centre and the ground, and both come
  // raw off a bounding box that moves whenever any extreme point does.
  // Tuning a density would then shift all three cameras with the extent
  // bucket unchanged and nothing reported. Snapping to a power-of-two
  // fraction of the extent is exact in binary, so an edit that does not
  // cross a step leaves the pose bit-identical.
  const step = extent / 128;
  const snap = (v: number): number => Math.round(v / step) * step;
  const cx = snap(centre.x);
  const cz = snap(centre.z);
  const groundY = snap(box.min.y);

  let hasSurface = false;
  group.traverse((o: Object3D) => {
    if (o instanceof Mesh && !(o instanceof InstancedMesh)) hasSurface = true;
  });

  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  const sky = new Color(0x8fb4d9);
  const scene = new Scene();
  scene.background = sky;
  // Range set per view by applyView; these are placeholders.
  const fog = new Fog(sky, extent, extent * 4);
  scene.fog = fog;
  scene.add(group);

  // A stand-in ground when the graph made no surface of its own.
  //
  // Not decoration. Placement is unjudgeable against a void: nothing
  // catches a shadow, so you cannot tell a tree standing on the ground
  // from one hovering above it, and the standard `color` point attribute
  // defaults to WHITE — so an ordinary point cloud over a bright sky is
  // very nearly invisible. It is skipped when the graph produced its own
  // mesh, which for a terrain graph is the real ground and would z-fight
  // with a second one.
  const surfaces: Object3D[] = [];
  group.traverse((o: Object3D) => {
    if (o instanceof Mesh && !(o instanceof InstancedMesh)) surfaces.push(o);
  });
  if (!hasSurface) {
    const ground = new Mesh(
      new PlaneGeometry(extent * 4, extent * 4),
      new MeshStandardMaterial({ color: 0x4a5240, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    // Just under the lowest point, so a cloud lying exactly on y = 0 is
    // not half-swallowed by z-fighting.
    ground.position.set(cx, groundY - extent * 0.002, cz);
    ground.receiveShadow = true;
    scene.add(ground);
    surfaces.push(ground);
  }

  /**
   * The ground under (x, z), by casting straight down from above
   * everything. Instanced meshes are excluded on purpose — standing on
   * top of a tree is not eye level — and a miss falls back to the box
   * minimum, which is the old behaviour and correct for a flat scene.
   */
  const down = new Vector3(0, -1, 0);
  const from = new Vector3();
  const caster = new Raycaster();
  const surfaceY = (x: number, z: number): number => {
    if (surfaces.length === 0) return groundY;
    from.set(x, box.max.y + extent, z);
    caster.set(from, down);
    const hits = caster.intersectObjects(surfaces, false);
    return hits.length > 0 ? hits[0].point.y : groundY;
  };
  if (job.grid === true) {
    const grid = new GridHelper(extent * 2, 40, 0x5a6b7a, 0x6f8296);
    grid.position.y = groundY;
    scene.add(grid);
  }

  // 3.2 on a vegetation-bounce ground term, not 1.1 over dark earth: a
  // closed canopy fully shadows the directional, so interiors are lit by
  // the hemisphere alone — at 1.1 through ACES that is ~4% grey and a
  // forest floor renders black (measured: 88% of ground-view pixels under
  // 10% luma). Downward faces sample the ground half, and dark earth
  // renders any canopy seen from below as black; vegetated ground bounces
  // green. The directional stays untouched — open ground was exposed
  // correctly.
  scene.add(new HemisphereLight(0xbfd6f2, 0x66705a, 3.2));
  const sun = new DirectionalLight(0xfff2d8, 2.4);
  sun.position.set(centre.x + extent * 0.5, groundY + extent * 0.9, centre.z + extent * 0.35);
  sun.target.position.copy(centre);
  sun.castShadow = true;
  // The shadow camera is an orthographic box: sized to the content, or
  // the shadows land outside it and nothing appears to cast one.
  sun.shadow.camera.left = -extent * 0.75;
  sun.shadow.camera.right = extent * 0.75;
  sun.shadow.camera.top = extent * 0.75;
  sun.shadow.camera.bottom = -extent * 0.75;
  sun.shadow.camera.near = extent * 0.05;
  sun.shadow.camera.far = extent * 2.5;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);

  const camera = new PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    Math.max(0.02, extent / 5000),
    extent * 6,
  );
  const views = viewsFor(cx, cz, groundY, extent, eye, surfaceY);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;

  const applyView = (name: string): void => {
    const view = views.find((v) => v.name === name);
    if (view === undefined) throw new Error(`preview: no view named "${name}"`);
    camera.up.set(...view.up);
    camera.position.set(...view.position);
    camera.lookAt(...view.target);
    controls.target.set(...view.target);
    controls.update();
    [fog.near, fog.far] = view.fog;
    group.traverse((o: Object3D) => {
      if (o instanceof Points) o.material.size = view.pointSize;
    });
    // Render synchronously so the probe never reports a pose the canvas
    // has not drawn yet: the harness screenshots as soon as successive
    // frames match, and the frame before an animation-loop tick would
    // still be the previous view.
    renderer.render(scene, camera);
  };
  applyView("hero");

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  renderer.setAnimationLoop(() => renderer.render(scene, camera));

  probe.views = views.map((v) => v.name);
  probe.setView = applyView;
  probe.report = {
    ...report,
    framing: {
      extent,
      pinned: job.extent !== undefined,
      eye,
      groundY,
      centre: [cx, snap(centre.y), cz],
      bounds: { min: box.min.toArray(), max: box.max.toArray() },
    },
    views,
  };
  probe.state = "ready";
}

void main();
