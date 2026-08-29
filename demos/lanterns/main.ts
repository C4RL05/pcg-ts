/**
 * lanterns — a per-instance channel, drawn.
 *
 * WHAT NEEDS A HOST HERE IS A MATERIAL, and that is the whole reason
 * this page exists. `spawnInstances`' `instanceAttrs` hands every named
 * point attribute to the renderer as an `InstancedBufferAttribute` of
 * its own name, with its dtype intact, and stops there: the library
 * ships the DATA, not the shader. `pcg-ts` does emit a shading language
 * — `pcg-ts/gpu` lowers the field grammar to WGSL compute kernels — but
 * it ships no MATERIAL: there is nothing in it that draws an instance,
 * and there is deliberately nowhere for a shader to be written down.
 * Until this page no demo drew with one of those channels bound — and
 * the corpus cannot show it either, because a graph carries no material:
 * `graphs/basics-instance-channels.json` cooks a `seed` column
 * and hands it to the editor's stock shading, which ignores it, so the
 * feature was correct and invisible at the same time. A channel read by
 * a material needs a host. This is the host.
 *
 * THE GRAPH SETTLES STRUCTURE AND THE PAGE ANIMATES IT. The field
 * grammar has no time input, on purpose, so nothing that was cooked here
 * moves: where a lantern hangs, how big it is, and what integer it
 * carries are the graph's, fixed for a seed and identical on any machine
 * that cooks it. The colour, the pulse and the bob are this page's,
 * computed in the vertex shader from that integer and a clock the graph
 * never sees. One `uint` per instance is the entire interface between
 * the two halves — which is what makes the channel an ABI rather than a
 * convenience.
 *
 * THE COLOUR IS THE MEASUREMENT, not decoration. The hue comes straight
 * off the LOW BYTE of the id, so the field's spread of colour is a
 * readout of how much of that id survived the trip. Flip "id source" to
 * the f32 channel — the same id, stored once through a float, which is
 * what a channel would look like if the spawner widened everything to
 * f32 — and the field falls in on itself: three quarters of the lit
 * pixels crowd into three hues, where a moment ago the same lanterns
 * were spread across the whole wheel. A u32 past 2^24 rounds to a
 * multiple of 128 or 256, and most of its low byte goes with the
 * remainder. Not every lantern moves and none of this is asserted —
 * the panel counts the two columns and prints what it found (256
 * distinct low bytes down to 72, at the default seed). That is not a
 * contrived worst case either; it is the ordinary case for an identity
 * hash, which is why the spawner refuses to widen one.
 *
 * AND THE HALF THE SCREEN CANNOT SHOW YOU: on the f32 path the timing
 * still looks fine. The pulse rate reads bits 18-24, which mostly
 * survive the rounding, so the field goes on twinkling convincingly
 * while all but a hundred of its ids are wrong. If this page hashed the
 * id in the shader instead of reading its bits directly, the widened
 * field would look exactly as random as the exact one — different, but
 * not visibly different, which is worse. "Looks right" is not the test.
 * Determinism is the claim, and the claim is about the value.
 */
import {
  type DataCollection,
  type Graph,
  type InstanceBatch,
  cook,
  isDeviceResidentInstances,
} from "pcg-ts";
import { type InstancedAsset, ownsGeometry, toInstancedMeshes } from "pcg-ts/three";
import {
  Color,
  Fog,
  GLSL3,
  GridHelper,
  type InstancedMesh,
  OctahedronGeometry,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createFpsMeter } from "../../shared/fps.js";
import { createOverlay } from "../../shared/overlay.js";
import { attachGraphPanel, type GraphPanelHandle } from "../../shared/graph/panel.js";
import { makeRecooker } from "../../shared/recook.js";
import { attachWordmark } from "../../shared/wordmark.js";
import { ASSET_ID, CHANNEL_EXACT, CHANNEL_WIDENED, OUTPUTS, buildLanternGraph } from "./graph.js";

// ------------------------------------------------------------------ //
// The cook.
// ------------------------------------------------------------------ //

/** What one cook of the lantern graph leaves the page to draw. */
interface LanternField {
  readonly graph: Graph;
  readonly batches: readonly InstanceBatch[];
  readonly count: number;
  readonly cookMs: number;
  /** What the widening cost, counted from the two columns themselves. */
  readonly loss: Loss;
}

/**
 * The two id columns, compared. Every number in the panel comes from
 * here rather than from a claim in a comment: the graph produced both
 * columns, so the damage is measurable without simulating anything.
 */
interface Loss {
  /** Instances whose f32 copy is not the u32 value. */
  readonly altered: number;
  /** Largest absolute difference between the two columns. */
  readonly worst: number;
  /** Distinct low bytes — the hue count — on each path. */
  readonly huesExact: number;
  readonly huesWidened: number;
}

function batchesOf(collection: DataCollection | undefined): readonly InstanceBatch[] {
  for (const item of collection ?? []) {
    if (item.kind !== "instances") continue;
    if (isDeviceResidentInstances(item)) {
      // Device-resident batches cannot arrive here: naming a non-colour
      // channel is exactly what the device spawner rejects at plan time,
      // so this graph always falls back to the CPU terminal. Checked
      // anyway, because the failure if it ever changed is that
      // `batches` throws rather than that the page draws nothing.
      throw new Error(
        "lanterns: the graph produced device-resident batches, whose columns are GPU buffers",
      );
    }
    return item.batches;
  }
  throw new Error("lanterns: the graph produced no instance batches");
}

/**
 * The measurement, taken across every batch.
 *
 * `& 255` is exactly what the vertex shader does to pick a hue, and
 * `>>> 0` is what `uint(seedWidened)` does to the float — the f32 column
 * still holds a whole number, it is just not the whole number that was
 * written. So these counts are the shader's, computed on the CPU.
 */
function measure(batches: readonly InstanceBatch[]): Loss {
  let altered = 0;
  let worst = 0;
  const exact = new Set<number>();
  const widened = new Set<number>();
  for (const batch of batches) {
    const ids = batch.attributes?.[CHANNEL_EXACT];
    const wide = batch.attributes?.[CHANNEL_WIDENED];
    if (!ids || !wide) continue;
    for (let i = 0; i < batch.count; i++) {
      const a = ids[i]!;
      const b = wide[i]!;
      if (a !== b) altered++;
      worst = Math.max(worst, Math.abs(b - a));
      exact.add(a & 255);
      widened.add((b >>> 0) & 255);
    }
  }
  return { altered, worst, huesExact: exact.size, huesWidened: widened.size };
}

async function cookField(seed: number, count: number, relief: number): Promise<LanternField> {
  const t0 = performance.now();
  const graph = buildLanternGraph({ seed, count, relief });
  const out = (await cook(graph)).outputs;
  const batches = batchesOf(out[OUTPUTS.instances]);
  return {
    graph,
    batches,
    count: batches.reduce((n, b) => n + b.count, 0),
    cookMs: performance.now() - t0,
    loss: measure(batches),
  };
}

// ------------------------------------------------------------------ //
// The material — this page's, because the library does not ship one.
// ------------------------------------------------------------------ //

const BACKGROUND = 0x05070b;
const FOG_NEAR = 90;
const FOG_FAR = 420;
const TAU = 6.2831853;

/**
 * One draw call, one integer per instance, everything else derived.
 *
 * `seed` IS DECLARED `uint`, which is the point of the whole page. three
 * compiles every `ShaderMaterial` as GLSL ES 3.00 — it prepends
 * `#version 300 es` to anything that is not a `RawShaderMaterial` — so
 * an integer vertex attribute needs no ceremony to declare. Asking for
 * `GLSL3` explicitly only stops three aliasing `gl_FragColor` for us,
 * which is why the fragment stage below declares its own output.
 *
 * The fog is this shader's own: three's fog is a chunk injected into
 * built-in materials, and a `ShaderMaterial` gets none of them. So the
 * two constants appear twice on this page — once here and once on
 * `scene.fog`, which is what fades the floor grid.
 *
 * The bit fields are chosen to make the widening legible rather than to
 * hide it: hue reads the low byte, which the rounding destroys, and rate
 * reads bits 18-24, which it mostly spares. See the file header for why
 * that asymmetry is the honest thing to show.
 */
function makeLanternMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    uniforms: {
      uTime: { value: 0 },
      /** 0 draws the u32 channel, 1 the f32 one. Nothing else changes. */
      uWiden: { value: 0 },
      uPulse: { value: 1 },
      uBob: { value: 1.4 },
      uBackground: { value: new Color(BACKGROUND) },
      uFogNear: { value: FOG_NEAR },
      uFogFar: { value: FOG_FAR },
    },
    vertexShader: /* glsl */ `
      in uint ${CHANNEL_EXACT};    // the u32 channel: the point's identity hash
      in float ${CHANNEL_WIDENED}; // the same id, after one f32 store

      uniform float uTime, uWiden, uPulse, uBob;

      out vec3 vTint;
      out float vShade;
      out float vGlow;
      out float vDepth;

      vec3 palette(float t) {
        return 0.5 + 0.5 * cos(${TAU} * (t + vec3(0.0, 0.33, 0.67)));
      }

      void main() {
        // The whole ABI, in one line. Everything below is this page's
        // opinion about an integer the graph settled.
        // The clamp is not decoration. A u32 in the top 128 values
        // rounds UP to exactly 2^32 as an f32, and float-to-uint is
        // undefined there — so the widened path needs a guard the exact
        // path does not, which is one more thing the dtype buys.
        // 4294967040 is the largest f32 below 2^32.
        uint id = uWiden > 0.5
          ? uint(min(${CHANNEL_WIDENED}, 4294967040.0))
          : ${CHANNEL_EXACT};

        float hue = float(id & 0xFFu) / 255.0;
        float phase = float((id >> 8) & 0x3FFu) / 1023.0;
        float rate = 0.45 + float((id >> 18) & 0x7Fu) / 127.0 * 1.15;

        float t = uTime * uPulse;
        vec4 world = instanceMatrix * vec4(position, 1.0);
        world.y += sin(t * rate * 0.5 + phase * ${TAU}) * uBob;
        vec4 mv = modelViewMatrix * world;
        gl_Position = projectionMatrix * mv;

        vec3 n = normalize(mat3(modelViewMatrix) * mat3(instanceMatrix) * normal);
        vShade = 0.3 + 0.7 * max(n.z, 0.0);
        vGlow = 0.22 + 0.78 * (0.5 + 0.5 * sin(t * rate + phase * ${TAU}));
        vTint = palette(hue);
        vDepth = -mv.z;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBackground;
      uniform float uFogNear, uFogFar;

      in vec3 vTint;
      in float vShade;
      in float vGlow;
      in float vDepth;

      layout(location = 0) out vec4 fragColor;

      // A filmic curve, because the tone mapping three applies to its own
      // materials is a shader chunk this material never receives. Without
      // it every lantern past half brightness clips to the same flat
      // wall of colour — which flattens the hue spread that is the entire
      // readout, so this is legibility, not taste.
      vec3 filmic(vec3 x) {
        return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
      }

      void main() {
        vec3 lit = filmic(vTint * (vShade * 0.5 + vGlow * 1.45));
        fragColor = vec4(mix(lit, uBackground, smoothstep(uFogNear, uFogFar, vDepth)), 1.0);
      }`,
  });
}

// ------------------------------------------------------------------ //
// The page.
// ------------------------------------------------------------------ //

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(BACKGROUND, 1);
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.fog = new Fog(BACKGROUND, FOG_NEAR, FOG_FAR);

// High enough to look ALONG the relief rather than through it. From eye
// level the field is a band of lights and the landscape the graph built
// is invisible behind its own front row — which loses the half of the
// claim that says the structure is not random.
const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 2000);
camera.position.set(0, 86, 168);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 20, 0);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.28;
controls.update();

// The floor is a grid and not a surface. There is no light in this scene
// — the lanterns shade themselves off their own facets — so a solid
// plane would be one flat colour pretending to be ground. The grid is
// here to say how wide the field is and where its bottom edge sits.
scene.add(new GridHelper(220, 22, 0x1b2836, 0x101820));

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------------ //
// The build.
// ------------------------------------------------------------------ //

/**
 * The lantern body. Faceted on purpose — flat facets hand the tint back
 * at three different angles, so a lantern reads as a lit object rather
 * than as a coloured dot — and taller than it is wide, which is the
 * cheapest way to say "hanging" without a string to hang it from.
 */
const LANTERN = new OctahedronGeometry(0.66, 0).scale(0.78, 1.5, 0.78);

let meshes: InstancedMesh[] = [];

function disposeMeshes(): void {
  for (const mesh of meshes) {
    scene.remove(mesh);
    mesh.dispose();
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
    // Always true here, and asked anyway: a batch carrying a
    // non-reserved channel gets its own geometry CLONE, because an
    // instanced attribute lives on the geometry and cannot be shared
    // with every other mesh drawing the same asset. That clone is the
    // mesh's to free. `LANTERN` is not, and never becomes so.
    if (ownsGeometry(mesh)) mesh.geometry.dispose();
  }
  meshes = [];
}

function build(field: LanternField): void {
  disposeMeshes();
  // The asset map's material is a TEMPLATE. `toInstancedMeshes` clones
  // one per mesh, and `ShaderMaterial.copy` clones the uniform record
  // with it — so the uniforms this page animates have to be the MESH's,
  // not these. Writing the template's is a silent no-op that presents as
  // a frozen animation, which is a long way to walk for one line.
  const template = makeLanternMaterial();
  const assets: Record<string, InstancedAsset> = {
    [ASSET_ID]: { geometry: LANTERN, material: template },
  };
  try {
    // `requireChannels` is the one line that keeps this page from going
    // dark silently. The material below declares `in uint seed;` and
    // `in float seedWidened;`; a batch arriving without one binds
    // nothing, three shades the missing attribute as zeros, and the
    // lanterns render black with no error, no warning and no WebGL
    // validation message. The graph promises both channels, so this
    // asserts the promise rather than guarding a branch that can fire
    // today — and if an edit upstream ever drops one, the page names it
    // instead of going black.
    meshes = toInstancedMeshes(field.batches, assets, {
      requireChannels: [CHANNEL_EXACT, CHANNEL_WIDENED],
    });
  } finally {
    template.dispose();
  }

  for (const mesh of meshes) {
    // ------------------------------------------------------------ //
    // THERE IS NO `gpuType` LINE HERE, and its absence is deliberate —
    // which is worth more words than setting it would have been,
    // because the advice going around says to set it.
    //
    // MEASURED on this renderer, not reasoned about: a `Uint32Array`
    // channel arrives EXACT with `gpuType` left at three's default.
    // `WebGLAttributes` maps a `Uint32Array` to `gl.UNSIGNED_INT`, and
    // `WebGLBindingStates` chooses the integer pointer as `type ===
    // gl.INT || type === gl.UNSIGNED_INT || gpuType === IntType` — so
    // `gpuType` is the THIRD disjunct and is already short-circuited
    // before it is read. Setting it changes nothing here. A no-op line
    // in a file people copy is worse than no line: it reads as a
    // requirement, it gets pasted into codebases that never measure it,
    // and then nobody can retire it.
    //
    // WHERE THE FLAG IS REAL: a `Uint8Array`, which is how a `bool`
    // channel is stored. `gl.UNSIGNED_BYTE` fails that same test, so
    // the float path is taken by default and `IntType` is what selects
    // the integer one. This page carries no bool channel, so it needs
    // nothing. A page that does, does.
    //
    // WHERE IT IS ACTIVELY HARMFUL: a `Float32Array`. `IntType` there
    // makes three call `vertexAttribIPointer` with `GL_FLOAT`, which
    // the driver refuses — `GL_INVALID_ENUM`, then
    // `GL_INVALID_OPERATION` at the draw. So "set it to be safe" is not
    // a safe default in either direction; the flag says which pointer
    // call to make, and only one of them is legal per buffer type.
    // `seedWidened` is therefore left alone.
    //
    // AND THE DTYPE STILL HAS TO MATCH AT BOTH ENDS. Declaring this u32
    // channel as `in float` does not quietly round it — WebGL2 refuses
    // the draw outright (`GL_INVALID_OPERATION`: the shader input type
    // does not match the bound attribute). The binding will not silently
    // lose the id for you.
    //
    // SO WHERE DOES THE 2^24 COLLISION ACTUALLY LIVE? Not in the
    // binding. In the COLUMN. An f32 column cannot hold these ids at
    // all, and that is the whole argument for preserving dtype across
    // the spawner — which is what the panel's toggle draws, by carrying
    // the same ids through both a u32 column and an f32 one.
    // ------------------------------------------------------------ //
    scene.add(mesh);
  }
  applyUniforms();
}

// ------------------------------------------------------------------ //
// The panel.
// ------------------------------------------------------------------ //

const overlay = createOverlay({
  title: "lanterns",
  info:
    "Every lantern's colour, pulse and bob is derived in the vertex shader from ONE u32 the graph " +
    "settled — the point's own seed, carried out as a named per-instance channel. The graph has no " +
    "clock; the shader has no idea where anything is. Switch the id source to the f32 copy of the " +
    "same id to see what widening an identity hash costs.",
});

const state = {
  seed: 7,
  count: 6000,
  relief: 30,
  widened: false,
  pulse: 1,
  paused: false,
};

let graphPanel: GraphPanelHandle | undefined;

const recook = makeRecooker(async () => {
  const next = await cookField(state.seed, state.count, state.relief);
  build(next);
  statCount(next.count.toLocaleString());
  statCook(`${next.cookMs.toFixed(0)} ms`);
  statAltered(`${next.loss.altered.toLocaleString()} of ${next.count.toLocaleString()}`);
  statWorst(`±${next.loss.worst.toLocaleString()}`);
  statHues(`${next.loss.huesExact} exact → ${next.loss.huesWidened} widened`);
  // Set only when the graph CHANGED — it re-serializes and re-lays out,
  // which is not free and is wasted every frame.
  const graphs = [{ name: "lantern field", graph: next.graph }];
  if (graphPanel) graphPanel.set(graphs);
  else graphPanel = attachGraphPanel(graphs, { into: graphSlot, title: "graph" });
});

overlay.addSeed(state.seed, (seed) => {
  state.seed = seed;
  recook();
});
overlay.addSlider("lanterns", { min: 500, max: 30000, step: 500, value: state.count }, (v) => {
  state.count = v;
  recook();
});
overlay.addSlider("relief", { min: 0, max: 60, step: 1, value: state.relief }, (v) => {
  state.relief = v;
  recook();
});
overlay.addSelect(
  "id source",
  [
    { value: "exact", label: "seed — u32 channel" },
    { value: "widened", label: "seedWidened — f32 channel" },
  ],
  "exact",
  (v) => {
    // No recook. Both columns are already on the GPU, on the same
    // instances, in the same order — the shader picks between them. That
    // is the shape of the claim: the graph settled both, the host chose.
    state.widened = v === "widened";
    applyUniforms();
  },
);
overlay.addSlider("pulse", { min: 0, max: 3, step: 0.05, value: state.pulse }, (v) => {
  state.pulse = v;
  applyUniforms();
});
overlay.addCheckbox("pause", state.paused, (on) => {
  state.paused = on;
});

const statFps = overlay.addStat("fps");
const statCount = overlay.addStat("lanterns");
const statCook = overlay.addStat("cook");
const statAltered = overlay.addStat("ids altered by f32");
const statWorst = overlay.addStat("worst drift");
const statHues = overlay.addStat("distinct hues");

// The slot is claimed HERE, where the panel is built, so this page decides
// where in its own panel the graph sits — under the readouts.
const graphSlot = overlay.addSlot();

attachWordmark();

/** Push page state onto every live mesh's own uniform record. */
function applyUniforms(): void {
  for (const mesh of meshes) {
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const u = (m as ShaderMaterial).uniforms;
      u.uWiden!.value = state.widened ? 1 : 0;
      u.uPulse!.value = state.pulse;
    }
  }
}

// ------------------------------------------------------------------ //
// The loop.
// ------------------------------------------------------------------ //

const tickFps = createFpsMeter(statFps);
let clock = 0;
let last = performance.now();

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  // The clock is the page's, and it is the only thing on the page that
  // advances. Accumulated rather than read off `performance.now()` so
  // that pausing holds the field still instead of banking time and
  // teleporting it forward on resume.
  if (!state.paused) clock += dt;

  for (const mesh of meshes) {
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      (m as ShaderMaterial).uniforms.uTime!.value = clock;
    }
  }

  controls.update();
  renderer.render(scene, camera);
  tickFps();
});

recook();
