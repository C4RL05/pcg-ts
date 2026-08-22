/**
 * 07 — galaxy: an infinite deterministic spiral galaxy streamed from a
 * two-level World. The unbounded halo level cooks the whole galaxy once
 * (sparse "deep field" stars + nebular dust along the arms); the fine
 * level streams dense 100u star cells around the camera. Every dot is a
 * star: click one to fly into its planetary system, generated on the
 * spot from the star's seed. Same seed, same universe — for everyone.
 */
import { World, hashCombine, type CellOutputs, type GeometryItem, type Graph } from "pcg-ts";
import { Pcg32 } from "pcg-ts";
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createFpsMeter } from "../../shared/fps.js";
import { NARROW_MEDIA_QUERY } from "../../shared/mobile.js";
import { createOverlay } from "../../shared/overlay.js";
import { attachGraphPanel, type GraphPanelHandle } from "../../shared/graph/panel.js";
import { attachWordmark } from "../../shared/wordmark.js";
import { FINE_CELL, deriveGalaxy, makeHaloLevel, makeStarLevel, type GalaxyForm } from "./galaxy.js";
import { generateSystem, type SystemSpec } from "./system.js";

let seed = 42;
let genRadius = 420;
let brightness = 1.3;
let flySpeed = 140;

// -- renderer / scene ------------------------------------------------------

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x05070c);
const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 40000);

const bgGroup = new Group(); // distant extragalactic backdrop
const galaxyGroup = new Group(); // streamed cells + core glow
const systemGroup = new Group(); // active star system view
scene.add(bgGroup, galaxyGroup, systemGroup);

/** Pixel scale so shader point sizes are in world units at distance 1. */
function viewScale(): number {
  return window.innerHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
}

// -- star shader -----------------------------------------------------------

function makePointMaterial(soft: boolean): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBright: { value: 1 },
      uPx: { value: renderer.getPixelRatio() },
      uScale: { value: viewScale() },
    },
    vertexShader: /* glsl */ `
      attribute float size;
      attribute float phase;
      attribute vec3 aColor;
      uniform float uTime, uPx, uScale;
      varying vec3 vColor;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float tw = ${soft ? "1.0" : "0.78 + 0.22 * sin(uTime * (1.0 + phase * 2.5) + phase * 43.0)"};
        float px = size * uScale * uPx / max(0.1, -mv.z);
        float fade = clamp(px, 0.0, 1.0);
        vColor = aColor * tw * fade * fade;
        gl_PointSize = clamp(px, 1.0, 260.0 * uPx);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uBright;
      varying vec3 vColor;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float d = length(q) * 2.0;
        if (d > 1.0) discard;
        ${soft
          ? "float a = pow(1.0 - d, 2.2) * 0.05;"
          : "float a = pow(1.0 - d, 3.0) + exp(-d * d * 22.0) * 0.9;"}
        gl_FragColor = vec4(vColor * a * uBright, 1.0);
      }`,
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
}

const starMat = makePointMaterial(false);
const dustMat = makePointMaterial(true);

function makeGlowTexture(r: number, g: number, b: number): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    const rgb = `${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}`;
    grad.addColorStop(0, `rgba(${rgb}, 0.55)`);
    grad.addColorStop(0.22, `rgba(${rgb}, 0.16)`);
    grad.addColorStop(0.55, `rgba(${rgb}, 0.04)`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(canvas);
}

// -- cell -> Points --------------------------------------------------------

/** CPU copy of a cell's stars, kept for screen-space picking. */
interface PickData {
  positions: Float32Array;
  colors: Float32Array;
  temps: Float32Array;
  count: number;
}

interface CellEntry {
  objects: Points[];
  pick?: PickData;
}

function attrData(item: GeometryItem, name: string, tuple: number): Float32Array | undefined {
  const attr = item.geo.attrs.point.get(name);
  if (!attr) return undefined;
  return (attr.data as Float32Array).slice(0, item.geo.pointCount * tuple);
}

function buildPoints(item: GeometryItem, soft: boolean): { points: Points; pick: PickData } {
  const n = item.geo.pointCount;
  const positions = (item.geo.attrs.point.require("P").data as Float32Array).slice(0, n * 3);
  const colors = attrData(item, "color", 3) ?? new Float32Array(n * 3).fill(1);
  const sizes = attrData(item, "size", 1) ?? new Float32Array(n).fill(1);
  const phases = attrData(item, "phase", 1) ?? new Float32Array(n);
  const temps = attrData(item, "temp", 1) ?? new Float32Array(n).fill(0.5);

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setAttribute("aColor", new BufferAttribute(colors, 3));
  geo.setAttribute("size", new BufferAttribute(sizes, 1));
  geo.setAttribute("phase", new BufferAttribute(phases, 1));
  geo.computeBoundingSphere();
  const points = new Points(geo, soft ? dustMat : starMat);
  return { points, pick: { positions, colors, temps, count: n } };
}

/**
 * The graphs behind the page, in the corner.
 *
 * Attached on the first build and updated on every later one: a new seed
 * derives a new galaxy, and its arm count and clump frequency are baked
 * into the graph's field expressions rather than bound per cell — so the
 * graph really is a different graph, not the same one with a new seed.
 */
let graphPanel: GraphPanelHandle | undefined;

function showGraphs(halo: Graph, stars: Graph): void {
  const entries = [
    { name: "halo", graph: halo },
    { name: "stars", graph: stars },
  ];
  if (graphPanel) graphPanel.set(entries);
  else graphPanel = attachGraphPanel(entries, { into: graphSlot, title: "galaxy" });
}

// -- world lifecycle -------------------------------------------------------

function cellCap(radius: number, cellSize: number): number {
  const r = (radius * 1.25) / cellSize + 1.5;
  return Math.max(256, Math.ceil(Math.PI * r * r));
}

interface WorldRig {
  world: World;
  form: GalaxyForm;
  cells: Map<string, CellEntry>;
  disposed: boolean;
}

let rig: WorldRig | undefined;
let coreGlow: Sprite | undefined;
let lastPending = 0;
let lastCookMs = 0;

function removeCell(entry: CellEntry): void {
  for (const obj of entry.objects) {
    galaxyGroup.remove(obj);
    obj.geometry.dispose(); // materials are shared, keep them
  }
}

function buildWorld(): void {
  if (mode === "system") exitSystem();
  if (rig) {
    rig.disposed = true;
    for (const entry of rig.cells.values()) removeCell(entry);
    rig.cells.clear();
  }
  if (coreGlow) {
    coreGlow.material.map?.dispose();
    coreGlow.material.dispose();
    coreGlow = undefined;
  }
  galaxyGroup.clear();
  buildBackdrop();

  const form = deriveGalaxy(seed);
  statGalaxy(`${form.name} · ${form.arms} arms · r=${form.radius.toFixed(0)}`);

  // Core glow sprite, tinted by the palette.
  const glow = new Sprite(
    new SpriteMaterial({
      map: makeGlowTexture(1 * form.tint[0], 0.86 * form.tint[1], 0.68 * form.tint[2]),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  glow.scale.setScalar(form.bulge * 3.2);
  galaxyGroup.add(glow);
  coreGlow = glow;

  const cells = new Map<string, CellEntry>();
  const next: WorldRig = { world: undefined as unknown as World, form, cells, disposed: false };
  // Named, so the corner panel can show what each level cooks. The two are
  // genuinely different graphs — the halo is one unbounded cell of dust and
  // the stars are a streamed grid — which is the thing worth seeing here.
  const levels = [makeHaloLevel(form), makeStarLevel(form, genRadius)];
  showGraphs(levels[0].graph, levels[1].graph);
  next.world = new World({
    seed,
    levels,
    maxCellsPerLevel: cellCap(genRadius, FINE_CELL),
    onCellReady: (level, coord, outputs: CellOutputs) => {
      if (next.disposed) return;
      const key = `${level}|${coord.join(",")}`;
      const prev = cells.get(key);
      if (prev) removeCell(prev);
      const entry: CellEntry = { objects: [] };
      for (const name of Object.keys(outputs)) {
        for (const item of outputs[name]) {
          if (item.kind !== "geometry" || item.geo.pointCount === 0) continue;
          const { points, pick } = buildPoints(item, name === "dust");
          entry.objects.push(points);
          galaxyGroup.add(points);
          if (name === "stars") entry.pick = pick;
        }
      }
      cells.set(key, entry);
    },
    onCellEvicted: (level, coord) => {
      if (next.disposed) return;
      const key = `${level}|${coord.join(",")}`;
      const entry = cells.get(key);
      if (entry) {
        removeCell(entry);
        cells.delete(key);
      }
    },
  });
  rig = next;
  lastPending = 0;
  // Kick the first update immediately (overlapping updates are serialized).
  void next.world
    .update([camera.position.x, 0, camera.position.z], { budgetMs: 14 })
    .then((stats) => {
      if (!next.disposed) {
        lastPending = stats.pending;
        lastCookMs = stats.elapsedMs;
      }
    })
    .catch((err: unknown) => console.error(err));

  cruise = true;
  cruiseTime = 0;
  cruiseAngle = new Pcg32(seed, 3).nextF32() * Math.PI * 2;
}

/** Distant static backdrop stars (outside the galaxy, presentation only). */
function buildBackdrop(): void {
  for (const child of [...bgGroup.children]) {
    bgGroup.remove(child);
    if (child instanceof Points) {
      child.geometry.dispose();
      (child.material as PointsMaterial).dispose();
    }
  }
  const rng = new Pcg32(hashCombine(seed, 9999), 1);
  const n = 1600;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // Uniform direction via normalized gaussian-ish triple.
    const v = new Vector3(
      rng.nextF32() + rng.nextF32() - 1,
      rng.nextF32() + rng.nextF32() - 1,
      rng.nextF32() + rng.nextF32() - 1,
    ).normalize().multiplyScalar(16000);
    pos.set([v.x, v.y, v.z], i * 3);
    const w = 0.35 + rng.nextF32() * 0.5;
    col.set([w, w, w * (0.9 + rng.nextF32() * 0.25)], i * 3);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  geo.setAttribute("color", new BufferAttribute(col, 3));
  const pts = new Points(
    geo,
    new PointsMaterial({
      size: 1.6,
      sizeAttenuation: false,
      vertexColors: true,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  pts.frustumCulled = false;
  bgGroup.add(pts);
}

// -- fly controls ----------------------------------------------------------

type Mode = "galaxy" | "system";
let mode: Mode = "galaxy";
let yaw = 0;
let pitch = -0.4;
let speedMul = 1;
let cruise = true;
let cruiseAngle = 0;
let cruiseTime = 0;
const keys = new Set<string>();
const MOVE_KEYS = new Set(["w", "a", "s", "d", "q", "e"]);

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);
  if (MOVE_KEYS.has(k)) cruise = false;
  if (k === "escape" && mode === "system") exitSystem();
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

let dragging = false;
let dragMoved = 0;
let lastX = 0;
let lastY = 0;

renderer.domElement.addEventListener("pointerdown", (e) => {
  dragging = true;
  dragMoved = 0;
  lastX = e.clientX;
  lastY = e.clientY;
});
window.addEventListener("pointermove", (e) => {
  if (!dragging || mode !== "galaxy") return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  dragMoved += Math.abs(dx) + Math.abs(dy);
  if (dragMoved > 4) cruise = false;
  yaw -= dx * 0.0032;
  pitch = Math.max(-1.52, Math.min(1.52, pitch - dy * 0.0032));
});
window.addEventListener("pointerup", (e) => {
  if (dragging && dragMoved <= 4 && mode === "galaxy") pickStar(e.clientX, e.clientY);
  dragging = false;
});
renderer.domElement.addEventListener("wheel", (e) => {
  if (mode !== "galaxy") return;
  speedMul = Math.max(0.05, Math.min(40, speedMul * Math.exp(-e.deltaY * 0.001)));
});

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.enabled = false;

function flyTick(dt: number): void {
  if (cruise && rig) {
    // Sweeping aerial orbit: high enough to read the arms, slowly sinking
    // toward the disc so the view keeps changing until the user takes over.
    const rc = rig.form.radius * 0.62;
    const h = rig.form.radius * (0.4 - Math.min(0.22, cruiseTime * 0.004));
    cruiseTime += dt;
    cruiseAngle += dt * 0.02;
    const a = cruiseAngle;
    camera.position.set(Math.cos(a) * rc, h, Math.sin(a) * rc);
    camera.lookAt(0, 0, 0);
    camera.rotation.reorder("YXZ");
    yaw = camera.rotation.y;
    pitch = camera.rotation.x;
    return;
  }
  camera.rotation.set(pitch, yaw, 0, "YXZ");
  const boost = keys.has("shift") ? 4 : 1;
  const v = flySpeed * speedMul * boost * dt;
  const fwd = new Vector3(0, 0, -1).applyEuler(camera.rotation);
  const right = new Vector3(1, 0, 0).applyEuler(camera.rotation);
  if (keys.has("w")) camera.position.addScaledVector(fwd, v);
  if (keys.has("s")) camera.position.addScaledVector(fwd, -v);
  if (keys.has("d")) camera.position.addScaledVector(right, v);
  if (keys.has("a")) camera.position.addScaledVector(right, -v);
  if (keys.has("e")) camera.position.y += v;
  if (keys.has("q")) camera.position.y -= v;
}

// -- star picking ----------------------------------------------------------

interface PickHit {
  position: Vector3;
  color: readonly [number, number, number];
  temp: number;
  starSeed: number;
  worldDist: number;
}

function pickStar(clientX: number, clientY: number): void {
  if (!rig) return;
  const px = (clientX / window.innerWidth) * 2 - 1;
  const py = -(clientY / window.innerHeight) * 2 + 1;
  const v = new Vector3();
  const maxPx = 18; // screen-space pick radius in CSS pixels
  let best: PickHit | undefined;
  let bestDist = Infinity;
  for (const entry of rig.cells.values()) {
    const pick = entry.pick;
    if (!pick) continue;
    for (let i = 0; i < pick.count; i++) {
      v.fromArray(pick.positions, i * 3);
      const worldDist = v.distanceTo(camera.position);
      if (worldDist < 4) continue;
      v.project(camera);
      if (v.z < -1 || v.z > 1) continue;
      const dx = ((v.x - px) * window.innerWidth) / 2;
      const dy = ((v.y - py) * window.innerHeight) / 2;
      const d = Math.hypot(dx, dy);
      if (d < maxPx && d < bestDist) {
        bestDist = d;
        const p = new Vector3().fromArray(pick.positions, i * 3);
        best = {
          position: p,
          color: [pick.colors[i * 3], pick.colors[i * 3 + 1], pick.colors[i * 3 + 2]],
          temp: pick.temps[i],
          // Star identity: a stable hash of galaxy seed + quantized position,
          // so the same dot resolves to the same system in any cell or level.
          starSeed: hashCombine(
            rig.form.seed,
            Math.round(p.x * 16),
            Math.round(p.y * 16),
            Math.round(p.z * 16),
          ),
          worldDist,
        };
      }
    }
  }
  if (best) enterSystem(best);
}

// -- star system view ------------------------------------------------------

interface SystemRig {
  spec: SystemSpec;
  planets: { mesh: Mesh; pivot: Group; speed: number; phase: number; orbit: number }[];
  moons: { mesh: Mesh; around: Mesh; orbit: number; speed: number; phase: number }[];
  time: number;
}

let systemRig: SystemRig | undefined;
const savedCam = { position: new Vector3(), yaw: 0, pitch: 0 };

function enterSystem(hit: PickHit): void {
  const spec = generateSystem(hit.starSeed, hit.temp, hit.color);
  mode = "system";
  cruise = false;
  savedCam.position.copy(camera.position);
  savedCam.yaw = yaw;
  savedCam.pitch = pitch;
  galaxyGroup.visible = false;

  const [cr, cg, cb] = spec.starColor;
  const star = new Mesh(
    new SphereGeometry(spec.starRadius, 48, 24),
    new MeshBasicMaterial({ color: new Color(cr, cg, cb) }),
  );
  systemGroup.add(star);
  const glow = new Sprite(
    new SpriteMaterial({
      map: makeGlowTexture(cr, cg, cb),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  glow.scale.setScalar(spec.starRadius * 11);
  systemGroup.add(glow);
  systemGroup.add(new PointLight(0xffffff, 2.6, 0, 0));
  systemGroup.add(new AmbientLight(0x223044, 0.7));

  const rigOut: SystemRig = { spec, planets: [], moons: [], time: 0 };
  for (const p of spec.planets) {
    // Orbit line.
    const segs = 128;
    const linePos = new Float32Array(segs * 3);
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      linePos.set([Math.cos(a) * p.orbit, 0, Math.sin(a) * p.orbit], i * 3);
    }
    const lineGeo = new BufferGeometry();
    lineGeo.setAttribute("position", new BufferAttribute(linePos, 3));
    systemGroup.add(
      new LineLoop(lineGeo, new LineBasicMaterial({ color: 0x2a3a55, transparent: true, opacity: 0.5 })),
    );

    const pivot = new Group();
    systemGroup.add(pivot);
    const mesh = new Mesh(
      new SphereGeometry(p.radius, 28, 16),
      new MeshStandardMaterial({ color: new Color(...p.color), roughness: 0.85, metalness: 0 }),
    );
    mesh.position.x = p.orbit;
    pivot.add(mesh);
    if (p.ring) {
      const ring = new Mesh(
        new RingGeometry(p.ring.inner, p.ring.outer, 64),
        new MeshBasicMaterial({
          color: new Color(...p.ring.color),
          transparent: true,
          opacity: p.ring.opacity,
          side: DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2 + p.tilt;
      mesh.add(ring);
    }
    rigOut.planets.push({ mesh, pivot, speed: p.angularSpeed, phase: p.phase, orbit: p.orbit });
    const moonRng = new Pcg32(hashCombine(spec.seed, p.orbit * 1000), 5);
    for (let m = 0; m < p.moons; m++) {
      const moon = new Mesh(
        new SphereGeometry(p.radius * 0.22, 12, 8),
        new MeshStandardMaterial({ color: 0x9aa2ad, roughness: 1 }),
      );
      pivot.add(moon);
      rigOut.moons.push({
        mesh: moon,
        around: mesh,
        orbit: p.radius * (1.8 + m * 0.9),
        speed: 1.2 + moonRng.nextF32() * 1.5,
        phase: moonRng.nextF32() * Math.PI * 2,
      });
    }
  }
  systemRig = rigOut;

  camera.position.set(0, spec.extent * 0.42, spec.extent * 1.05);
  camera.lookAt(0, 0, 0);
  orbit.target.set(0, 0, 0);
  orbit.enabled = true;
  orbit.update();
  showCard(spec, hit.worldDist);
}

function exitSystem(): void {
  for (const child of [...systemGroup.children]) {
    systemGroup.remove(child);
    child.traverse((o) => {
      if (o instanceof Mesh || o instanceof LineLoop) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
      if (o instanceof Sprite) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  }
  systemRig = undefined;
  orbit.enabled = false;
  galaxyGroup.visible = true;
  camera.position.copy(savedCam.position);
  yaw = savedCam.yaw;
  pitch = savedCam.pitch;
  camera.rotation.set(pitch, yaw, 0, "YXZ");
  mode = "galaxy";
  card.style.display = "none";
}

function systemTick(dt: number): void {
  const r = systemRig;
  if (!r) return;
  r.time += dt;
  for (const p of r.planets) {
    p.pivot.rotation.y = p.phase + r.time * p.speed;
    p.mesh.rotation.y += dt * 0.4;
  }
  for (const m of r.moons) {
    const a = m.phase + r.time * m.speed;
    m.mesh.position.set(
      m.around.position.x + Math.cos(a) * m.orbit,
      0,
      Math.sin(a) * m.orbit,
    );
  }
}

// -- star card -------------------------------------------------------------

/* The card's layout lives in a stylesheet (not style.cssText) so the narrow-
   screen media query below can override it; inline declarations would win
   over any media query. Only display stays inline, because showCard and
   exitSystem toggle card.style.display directly. */
const cardStyle = document.createElement("style");
cardStyle.textContent = `
.pcg07-card {
  position: fixed; top: 16px; right: 16px; width: 300px; z-index: 10;
  background: var(--ed-solid); border: 1px solid var(--ed-rule); border-radius: 10px;
  padding: 16px 18px; color: var(--ed-ink); font: 13px/1.5 ui-monospace, monospace;
}
/* On narrow screens the shared overlay owns the bottom edge, so the card
   spans the top instead and scrolls internally rather than growing past a
   phone-height viewport. */
@media ${NARROW_MEDIA_QUERY} {
  .pcg07-card {
    left: 12px; right: 12px; width: auto;
    top: calc(12px + env(safe-area-inset-top));
    max-height: 40vh; max-height: 40dvh; overflow-y: auto;
  }
}
`;
document.head.appendChild(cardStyle);

const card = document.createElement("div");
card.className = "pcg07-card";
card.style.display = "none";
document.body.appendChild(card);

function showCard(spec: SystemSpec, dist: number): void {
  const rows = spec.planets
    .map((p) => {
      const extras = [
        p.ring ? "ringed" : "",
        p.moons > 0 ? `${p.moons} moon${p.moons > 1 ? "s" : ""}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      return `<tr><td style="padding-right:10px;color:var(--ed-figure)">${p.name}</td>` +
        `<td style="color:var(--ed-ink-dim)">${p.kind}${extras ? " · " + extras : ""}</td></tr>`;
    })
    .join("");
  card.innerHTML =
    `<div style="font-size:17px;color:var(--ed-ink-hi)">${spec.name}</div>` +
    `<div style="color:var(--ed-ink-ghost);margin-bottom:8px">${spec.catalog}</div>` +
    `<div>class ${spec.spectral} · ${spec.tempK.toLocaleString()} K</div>` +
    `<div style="color:var(--ed-ink-dim);margin-bottom:8px">${dist.toFixed(0)} u from your last position</div>` +
    (spec.planets.length > 0
      ? `<table style="border-spacing:0">${rows}</table>`
      : `<div style="color:var(--ed-ink-dim)">no planets — a lonely star</div>`) +
    `<div style="margin-top:10px;color:var(--ed-ink-ghost)">Esc — back to the galaxy</div>`;
  card.style.display = "block";
}

// -- overlay ---------------------------------------------------------------

const overlay = createOverlay({
  title: "galaxy",
  info:
    "An infinite deterministic spiral galaxy: unbounded halo + dust level above streamed " +
    "100u star cells. Drag to look, W/A/S/D + Q/E to fly (Shift boosts, wheel scales speed). " +
    "Click any star to visit its planetary system.",
});
const statFps = overlay.addStat("fps");
const statGalaxy = overlay.addStat("galaxy");
const statStars = overlay.addStat("stars");
const statCells = overlay.addStat("star cells");
const statCooked = overlay.addStat("cooked / evicted");
const statPending = overlay.addStat("pending");
const statCook = overlay.addStat("last update");
const statPos = overlay.addStat("position");

/* The graph section, claimed HERE rather than where the panel is filled,
   so this page decides where in its own panel the graph sits. Right after
   the readouts and above the prose: the collapsibles and notes below run
   to several hundred pixels on this page, and a thumbnail under them is a
   thumbnail below the fold. */
const graphSlot = overlay.addSlot();

/* The mark, bottom left, linking back to the shelf these came from.
   Every demo is otherwise a page you can arrive at and not leave. */
attachWordmark();
overlay.addSeed(seed, (s) => {
  seed = s;
  buildWorld();
});
overlay.addSlider(
  "gen radius",
  { min: 240, max: 640, step: 20, value: genRadius, format: (v) => `${v} u` },
  (v) => {
    genRadius = v;
    buildWorld();
  },
);
overlay.addSlider(
  "brightness",
  { min: 0.4, max: 2.2, step: 0.05, value: brightness },
  (v) => {
    brightness = v;
  },
);
overlay.addSlider(
  "fly speed",
  { min: 20, max: 600, step: 10, value: flySpeed, format: (v) => `${v} u/s` },
  (v) => {
    flySpeed = v;
  },
);
overlay.addNote(
  "Every galaxy is a pure function of its seed: morphology (arms, twist, bulge, palette), " +
  "every star, and every star's planets. Fly away and back — the same stars return. " +
  "Share a seed and a friend sees the same universe.",
);

// -- frame loop ------------------------------------------------------------

let updating = false;
const fps = createFpsMeter((v) => statFps(v));

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const s = viewScale();
  const px = renderer.getPixelRatio();
  starMat.uniforms.uScale.value = s;
  dustMat.uniforms.uScale.value = s;
  starMat.uniforms.uPx.value = px;
  dustMat.uniforms.uPx.value = px;
});

buildWorld();

let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  fps();

  starMat.uniforms.uTime.value = now / 1000;
  starMat.uniforms.uBright.value = brightness;
  dustMat.uniforms.uBright.value = brightness;

  if (mode === "galaxy") {
    flyTick(dt);
    const r = rig;
    if (r && !updating) {
      updating = true;
      r.world
        .update([camera.position.x, 0, camera.position.z], { budgetMs: 7 })
        .then((stats) => {
          if (!r.disposed) {
            lastPending = stats.pending;
            if (stats.cooked.length > 0) lastCookMs = stats.elapsedMs;
          }
        })
        .catch((err: unknown) => console.error(err))
        .finally(() => {
          updating = false;
        });
    }
    if (r) {
      const ws = r.world.stats();
      const fine = ws.levels.find((l) => l.name === "stars")?.cellCount ?? 0;
      let total = 0;
      for (const entry of r.cells.values()) total += entry.pick?.count ?? 0;
      statStars(total.toLocaleString());
      statCells(String(fine));
      statCooked(`${ws.totalCooked} / ${ws.totalEvicted}`);
      statPending(String(lastPending));
      statCook(`${lastCookMs.toFixed(1)} ms`);
      statPos(
        `${camera.position.x.toFixed(0)}, ${camera.position.y.toFixed(0)}, ${camera.position.z.toFixed(0)}`,
      );
    }
  } else {
    orbit.update();
    systemTick(dt);
  }

  renderer.render(scene, camera);
});
