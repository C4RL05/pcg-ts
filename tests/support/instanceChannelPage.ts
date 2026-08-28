/**
 * THE PAGE THAT ACTUALLY DRAWS. Browser half of
 * `tests/instanceChannelRender.test.ts`.
 *
 * Every other test of the per-instance attribute channel asserts that the
 * column LANDS on the geometry — `src/three/instanced.test.ts` does that
 * thirteen ways. None of them proves a shader can READ it, because a
 * vitest worker has no GL context and `toInstancedMeshes` deliberately
 * writes no shader ("the library ships the data, not the shader"). So the
 * only way to close that gap is to issue a real draw call in a real
 * browser and look at the pixels, which is what this file is.
 *
 * It is bundled BY PATH through esbuild by the Node half — never
 * imported, because it imports `three` and touches `document`. Renaming
 * it means grepping the bare filename (see CLAUDE.md, Conventions).
 *
 * ## The layout, and why it is this one
 *
 * Four instances in a row across a 64x16 RGBA8 render target under an
 * orthographic camera, one instance per 16-pixel column, each covering
 * only the middle 60% of the height. Two properties come out of that:
 *
 * - Sampling the centre of column `i` reads instance `i` and nothing
 *   else, so a per-instance channel value maps to one byte triple.
 * - The top row is background, so a readback of all-255 (or a target
 *   that was never rendered into) is distinguishable from a draw. The
 *   clear ALPHA is 0 and every shader here writes alpha 1, which makes
 *   "a fragment was written at this pixel" a single-byte test rather
 *   than an inference from colour.
 *
 * ## Colour management is switched off on purpose
 *
 * `ShaderMaterial` writes `fragColor` straight out: nothing here includes
 * `<tonemapping_fragment>` or `<colorspace_fragment>`, and three applies
 * no output transform when rendering into a render target. So the byte in
 * the buffer is `round(value * 255)` and the assertions can be exact to
 * one LSB instead of "close enough".
 */
import {
  ColorManagement,
  GLSL3,
  IntType,
  LinearSRGBColorSpace,
  NoColorSpace,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  WebGLRenderer,
  WebGLRenderTarget,
  type InstancedBufferAttribute,
  type InstancedMesh,
} from "three";
import { createPointCloud } from "../../src/data/index.js";
import { buildInstanceBatches } from "../../src/spawn/instances.js";
import { toInstancedMeshes, type AssetMap } from "../../src/three/instanced.js";
import { CELL, GAINS, HEIGHT, ID_BASE, ID_SCALE, IDS, N, TINTS, WIDTH } from "./instanceChannelFixture.js";

/* ------------------------------------------------------------------ *
 * The contract with the Node half
 * ------------------------------------------------------------------ */

/** One instance's sampled pixel, as raw 8-bit channels. */
export interface Sample {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** What one rendered case reports back. */
export interface CaseResult {
  readonly name: string;
  /** Centre pixel of each instance's column, in instance order. */
  readonly samples: Sample[];
  /** A pixel above every instance — the untouched clear colour. */
  readonly background: Sample;
  /** GL errors raised between the draw and the readback, if any. */
  readonly glErrors: string[];
  /** Set when the case could not run at all (never for the WebGL cases). */
  readonly skipped?: string;
}

/** How to corrupt the binding, for the proof that the test can fail. */
export type Sabotage = "none" | "drop" | "zero" | "reverse";

export interface RunRequest {
  readonly sabotage?: Sabotage;
  /** Run the WebGPU cases too. They are gated on `navigator.gpu`. */
  readonly webgpu?: boolean;
}

export interface RunResult {
  readonly webgl: CaseResult[];
  readonly webgpu: CaseResult[];
  readonly renderer: string;
  readonly adapter: string | null;
}

/* ------------------------------------------------------------------ *
 * Geometry / batch construction
 * ------------------------------------------------------------------ */

/**
 * A four-point cloud laid out one per column, carrying every channel the
 * cases draw with. The transforms come from the standard point attributes
 * and go through `buildInstanceBatches` — this is the shipped path from
 * point cloud to `InstanceBatch`, not a hand-built batch.
 */
function cloud() {
  const geo = createPointCloud(N);
  const P = geo.attrs.point.require("P");
  const scale = geo.attrs.point.require("scale");
  const tint = geo.attrs.point.add("tint", "f32", 3, [0, 0, 0]);
  const gain = geo.attrs.point.add("gain", "f32", 1, 0);
  const id = geo.attrs.point.add("id", "u32", 1, 0);
  const idf = geo.attrs.point.add("idf", "f32", 1, 0);
  for (let i = 0; i < N; i++) {
    // Column i spans x in [-2 + i, -1 + i] under the camera below.
    P.setTuple(i, [-1.5 + i, 0, 0]);
    // 0.6 of the frustum height, so the top and bottom rows stay clear.
    scale.setTuple(i, [1, 0.6, 1]);
    tint.setTuple(i, [...TINTS[i]]);
    gain.set(i, GAINS[i]);
    id.set(i, IDS[i]);
    // The SAME ids through an f32 column: the widening the spawner
    // refuses to do, done deliberately so the collision is measurable.
    idf.set(i, IDS[i]);
  }
  return geo;
}

/** Unit quad; `toInstancedMeshes` clones it per channelled batch. */
function assetMap(material: ShaderMaterial): AssetMap {
  return { q: { geometry: new PlaneGeometry(1, 1), material } };
}

/* ------------------------------------------------------------------ *
 * Shaders
 * ------------------------------------------------------------------ */

/** three's ShaderMaterial prefix supplies position/instanceMatrix/matrices. */
const VERTEX_TAIL = "gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);";

function tintMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: `
      in vec3 tint;
      in float gain;
      out vec3 vTint;
      void main() {
        vTint = tint * gain;
        ${VERTEX_TAIL}
      }
    `,
    fragmentShader: `
      in vec3 vTint;
      out vec4 fragColor;
      void main() { fragColor = vec4(vTint, 1.0); }
    `,
  });
}

/**
 * Reads the channel as an INTEGER — `in uint`, with the varying `flat`
 * because GLSL ES 3.00 forbids interpolating one. Red carries
 * `(id - 2^24) * 40`, blue carries the top byte (1 for every id here),
 * green is a constant 255 so "this fragment ran" is readable even when
 * red is 0.
 */
function uintMaterial(attrName: string): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: `
      in uint ${attrName};
      flat out uint vId;
      void main() {
        vId = ${attrName};
        ${VERTEX_TAIL}
      }
    `,
    fragmentShader: `
      flat in uint vId;
      out vec4 fragColor;
      void main() {
        uint d = vId - ${ID_BASE}u;
        fragColor = vec4(float(d) * ${ID_SCALE}.0 / 255.0, 1.0, float(vId >> 24u) / 255.0, 1.0);
      }
    `,
  });
}

/**
 * The same decode, but the channel is declared `in float` — the shape the
 * documentation recommends when the column is kept f32 end to end
 * (`int(attribute('aOrigIndex', 'float'))`).
 */
function floatIdMaterial(attrName: string): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: `
      in float ${attrName};
      flat out uint vId;
      void main() {
        vId = uint(${attrName}) - ${ID_BASE}u;
        ${VERTEX_TAIL}
      }
    `,
    fragmentShader: `
      flat in uint vId;
      out vec4 fragColor;
      void main() {
        fragColor = vec4(float(vId) * ${ID_SCALE}.0 / 255.0, 1.0, 1.0 / 255.0, 1.0);
      }
    `,
  });
}

/* ------------------------------------------------------------------ *
 * The WebGL runner
 * ------------------------------------------------------------------ */

function sampleOf(px: Uint8Array, x: number, y: number): Sample {
  const k = (y * WIDTH + x) * 4;
  return { r: px[k], g: px[k + 1], b: px[k + 2], a: px[k + 3] };
}

/** Corrupt a bound channel in place — see `Sabotage`. */
function sabotageChannel(mesh: InstancedMesh, name: string, mode: Sabotage): void {
  if (mode === "none") return;
  if (mode === "drop") {
    mesh.geometry.deleteAttribute(name);
    return;
  }
  const attr = mesh.geometry.getAttribute(name);
  if (!attr) return;
  const array = attr.array as unknown as { [k: number]: number; length: number };
  const size = attr.itemSize;
  if (mode === "zero") {
    for (let i = 0; i < array.length; i++) array[i] = 0;
  } else {
    // Reverse the per-instance records, so every instance draws with
    // another instance's values and nothing is merely missing.
    const copy = Array.from({ length: array.length }, (_, i) => array[i]);
    for (let i = 0; i < N; i++) {
      for (let c = 0; c < size; c++) array[i * size + c] = copy[(N - 1 - i) * size + c];
    }
  }
  attr.needsUpdate = true;
}

interface GlCase {
  readonly name: string;
  readonly channels: string[];
  readonly material: () => ShaderMaterial;
  /** Applied to the built mesh before the draw. */
  readonly tweak?: (mesh: InstancedMesh) => void;
  /** Which channel the sabotage knob corrupts, if this case honours it. */
  readonly sabotages?: string;
}

const GL_CASES: readonly GlCase[] = [
  {
    name: "f32-tint",
    channels: ["tint", "gain"],
    material: tintMaterial,
    sabotages: "tint",
  },
  {
    // The gpuType trap, direction one: the library leaves gpuType at
    // three's default (FloatType) and the host declares `uint`.
    name: "u32-default-gpuType",
    channels: ["id"],
    material: () => uintMaterial("id"),
    sabotages: "id",
  },
  {
    // Direction two: the host does what the documentation says and sets
    // gpuType = IntType on the bound attribute.
    name: "u32-IntType",
    channels: ["id"],
    material: () => uintMaterial("id"),
    tweak: (mesh) => {
      // `getAttribute` is typed as the union with `InterleavedBufferAttribute`,
      // which has no `gpuType`; `toInstancedMeshes` only ever sets a plain
      // `InstancedBufferAttribute`, so the narrowing is safe here.
      const attr = mesh.geometry.getAttribute("id") as InstancedBufferAttribute | undefined;
      if (attr) attr.gpuType = IntType;
    },
  },
  {
    // The widening the spawner refuses, performed on purpose: the same
    // ids carried in an f32 column.
    name: "f32-widened-id",
    channels: ["idf"],
    material: () => floatIdMaterial("idf"),
  },
  {
    // A u32 column declared `in float` at the shader. Undefined by the
    // GLSL spec and validated by WebGL2 — recorded, not asserted on
    // beyond "it does not silently return the right answer".
    name: "u32-declared-float",
    channels: ["id"],
    material: () => floatIdMaterial("id"),
  },
];

function runWebGL(request: RunRequest): { cases: CaseResult[]; renderer: string } {
  ColorManagement.enabled = false;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.style.cssText = "width:256px;height:64px;image-rendering:pixelated;border:1px solid #444";
  document.body.appendChild(canvas);

  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.setClearColor(0x000000, 0);

  const target = new WebGLRenderTarget(WIDTH, HEIGHT, {
    format: RGBAFormat,
    type: UnsignedByteType,
    colorSpace: NoColorSpace,
    depthBuffer: true,
  });

  // Frustum is 4 wide and 1 tall — the same 4:1 as the target, so the
  // unit quad stays square and column i is exactly pixels [16i, 16i+16).
  const camera = new OrthographicCamera(-2, 2, 0.5, -0.5, 0.1, 10);
  camera.position.z = 5;

  const gl = renderer.getContext();
  const results: CaseResult[] = [];
  const geo = cloud();

  for (const spec of GL_CASES) {
    const material = spec.material();
    const assets = assetMap(material);
    const batches = buildInstanceBatches(geo, {
      defaultAssetId: "q",
      instanceAttrs: [...spec.channels],
    });
    const [mesh] = toInstancedMeshes(batches, assets);
    spec.tweak?.(mesh);
    const mode = request.sabotage ?? "none";
    if (spec.sabotages !== undefined && mode !== "none") {
      sabotageChannel(mesh, spec.sabotages, mode);
    }
    const scene = new Scene();
    scene.add(mesh);

    // Drain anything a previous case left behind, so `glErrors` only
    // ever describes this draw.
    while (gl.getError() !== gl.NO_ERROR) {
      /* drain */
    }
    renderer.setRenderTarget(target);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);

    const glErrors: string[] = [];
    for (let err = gl.getError(); err !== gl.NO_ERROR; err = gl.getError()) {
      glErrors.push(`0x${err.toString(16)}`);
      if (glErrors.length > 8) break;
    }

    const px = new Uint8Array(WIDTH * HEIGHT * 4);
    renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, px);
    renderer.setRenderTarget(null);
    // Draw the same thing to the canvas so a headed run is inspectable
    // and the tab has something to paint.
    renderer.render(scene, camera);

    const samples: Sample[] = [];
    for (let i = 0; i < N; i++) samples.push(sampleOf(px, i * CELL + CELL / 2, HEIGHT / 2));
    results.push({
      name: spec.name,
      samples,
      // Row 0 is below every instance (they cover the middle 60%).
      background: sampleOf(px, CELL / 2, 0),
      glErrors,
    });

    scene.remove(mesh);
    mesh.dispose();
    mesh.geometry.dispose();
    assets.q.geometry.dispose();
    material.dispose();
  }

  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const label =
    debugInfo === null
      ? gl.getParameter(gl.RENDERER)
      : `${gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)} / ${gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)}`;

  target.dispose();
  renderer.dispose();
  return { cases: results, renderer: String(label) };
}

/* ------------------------------------------------------------------ *
 * The WebGPU runner
 * ------------------------------------------------------------------ */

/**
 * The same two questions under `WebGPURenderer`, which is the renderer
 * the documentation calls the supported host for per-instance data and
 * the one no test has ever drawn with.
 *
 * Deliberately weaker assertions than the WebGL half, and the reason is
 * honesty rather than caution: the node pipeline's output goes through
 * its own colour handling, so the exact byte is three's business, not
 * this library's. What IS this library's business — that the four
 * channel values arrive as four DISTINCT per-instance values in the
 * right order, and that a u32 above 2^24 does not collide — survives any
 * output transform that is monotone per channel, which every one three
 * applies is.
 */
async function runWebGPU(request: RunRequest): Promise<CaseResult[]> {
  if (typeof navigator === "undefined" || navigator.gpu === undefined) {
    return [{ name: "webgpu", samples: [], background: { r: 0, g: 0, b: 0, a: 0 }, glErrors: [], skipped: "navigator.gpu is undefined" }];
  }
  const three = await import("three/webgpu");
  const tsl = await import("three/tsl");

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.style.cssText = "width:256px;height:64px;image-rendering:pixelated;border:1px solid #444";
  document.body.appendChild(canvas);

  const renderer = new three.WebGPURenderer({ canvas, antialias: false, alpha: true, forceWebGL: false });
  await renderer.init();
  // `Backend` is the abstract base in the typings, so the discriminant
  // the WebGL fallback sets is not on it. A fallback would draw the
  // WebGL path a second time under a WebGPU name, which is worse than
  // not running: skip loudly instead.
  if ((renderer.backend as unknown as { isWebGLBackend?: boolean }).isWebGLBackend === true) {
    return [{ name: "webgpu", samples: [], background: { r: 0, g: 0, b: 0, a: 0 }, glErrors: [], skipped: "WebGPURenderer fell back to its WebGL backend" }];
  }
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = NoToneMapping;

  const target = new three.RenderTarget(WIDTH, HEIGHT, {
    format: RGBAFormat,
    type: UnsignedByteType,
    colorSpace: NoColorSpace,
  });
  const camera = new OrthographicCamera(-2, 2, 0.5, -0.5, 0.1, 10);
  camera.position.z = 5;
  const geo = cloud();

  const specs: { name: string; channels: string[]; sabotages: string; color: () => unknown }[] = [
    {
      name: "f32-tint",
      channels: ["tint", "gain"],
      sabotages: "tint",
      // The function forms of the TSL operators rather than the method
      // forms: `AttributeNode` is typed without them, and a cast per
      // call would say less than this does.
      color: () => tsl.vec4(tsl.mul(tsl.attribute("tint", "vec3"), tsl.attribute("gain", "float")), 1),
    },
    {
      name: "u32-default-gpuType",
      channels: ["id"],
      sabotages: "id",
      color: () => {
        const d = tsl.float(tsl.sub(tsl.attribute("id", "uint"), tsl.uint(ID_BASE)));
        return tsl.vec4(tsl.mul(d, ID_SCALE / 255), 1, 1 / 255, 1);
      },
    },
  ];

  const results: CaseResult[] = [];
  for (const spec of specs) {
    const material = new three.NodeMaterial();
    material.outputNode = spec.color() as never;
    const assets: AssetMap = { q: { geometry: new PlaneGeometry(1, 1), material } };
    const batches = buildInstanceBatches(geo, { defaultAssetId: "q", instanceAttrs: [...spec.channels] });
    const [mesh] = toInstancedMeshes(batches, assets);
    const mode = request.sabotage ?? "none";
    if (mode !== "none") sabotageChannel(mesh, spec.sabotages, mode);
    const scene = new Scene();
    scene.add(mesh);
    renderer.setRenderTarget(target);
    renderer.clear();
    await renderer.renderAsync(scene, camera);
    const px = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, WIDTH, HEIGHT)) as Uint8Array;
    renderer.setRenderTarget(null);
    await renderer.renderAsync(scene, camera);

    const samples: Sample[] = [];
    for (let i = 0; i < N; i++) samples.push(sampleOf(px, i * CELL + CELL / 2, HEIGHT / 2));
    results.push({ name: spec.name, samples, background: sampleOf(px, CELL / 2, 0), glErrors: [] });

    scene.remove(mesh);
    mesh.dispose();
    mesh.geometry.dispose();
    assets.q.geometry.dispose();
    material.dispose();
  }
  target.dispose();
  await renderer.dispose();
  return results;
}

/* ------------------------------------------------------------------ *
 * The page contract
 * ------------------------------------------------------------------ */

declare global {
  interface Window {
    __pcgChannels: {
      state: "loading" | "ready" | "error";
      error?: string;
      run(request: RunRequest): Promise<RunResult>;
    };
  }
}

async function run(request: RunRequest): Promise<RunResult> {
  const gl = runWebGL(request);
  let webgpu: CaseResult[] = [];
  if (request.webgpu === true) {
    try {
      webgpu = await runWebGPU(request);
    } catch (err) {
      webgpu = [
        {
          name: "webgpu",
          samples: [],
          background: { r: 0, g: 0, b: 0, a: 0 },
          glErrors: [],
          skipped: `WebGPU run threw: ${String(err)}`,
        },
      ];
    }
  }
  let adapter: string | null = null;
  try {
    const info = navigator.gpu === undefined ? null : (await navigator.gpu.requestAdapter())?.info;
    adapter = info == null ? null : `${info.vendor} ${info.architecture} ${info.description}`.trim();
  } catch {
    adapter = null;
  }
  return { webgl: gl.cases, webgpu, renderer: gl.renderer, adapter };
}

window.__pcgChannels = { state: "loading", run };
try {
  // A trial render at import time turns "no GL context" into a page-level
  // error the Node half can report, rather than a mystery in the first
  // assertion.
  const probe = new WebGLRenderer({ antialias: false });
  probe.dispose();
  window.__pcgChannels.state = "ready";
} catch (err) {
  window.__pcgChannels.state = "error";
  window.__pcgChannels.error = String(err);
}
