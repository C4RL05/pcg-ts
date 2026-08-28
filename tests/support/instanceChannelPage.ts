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
import { ownsGeometry, toInstancedMeshes, type AssetMap } from "../../src/three/instanced.js";
import {
  CELL,
  GAINS,
  HEIGHT,
  HOST_GAIN,
  HOST_ID,
  HOST_TINT,
  ID_BASE,
  ID_SCALE,
  IDS,
  N,
  SHARED_FIRST,
  SHARED_SECOND,
  TINTS,
  WIDTH,
} from "./instanceChannelFixture.js";

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
  /**
   * Live programs on the renderer while this case drew.
   *
   * Recorded for one claim only, and it is the shared-asset case's: two
   * meshes of the same asset whose materials are clones of one
   * `ShaderMaterial` compile to ONE program, so the mesh that carries no
   * channel is shading through a pipeline built for the attributes the
   * other mesh has. That is the integrator's "joins a pipeline already
   * compiled with those attributes", turned into a number.
   */
  readonly programs?: number;
  /**
   * Meshes drawn — one per batch. Reported so `programs` can be read as a
   * claim about SHARING: "one program" says nothing on its own, and says
   * everything beside "two meshes".
   */
  readonly meshes?: number;
  /** Set when the case could not run at all (never for the WebGL cases). */
  readonly skipped?: string;
  /**
   * Set when the case THREW instead of drawing — which is itself an
   * answer, and a different one from "it drew zeros". Distinct from
   * `skipped`, which means the case never applied to this machine.
   */
  readonly error?: string;
}

/** How to corrupt the binding, for the proof that the test can fail. */
export type Sabotage = "none" | "drop" | "zero" | "reverse";

export interface RunRequest {
  readonly sabotage?: Sabotage;
  /** Run the WebGPU cases too. They are gated on `navigator.gpu`. */
  readonly webgpu?: boolean;
  /**
   * Publish the channels the missing-channel cases deliberately withhold
   * — the `CHANNEL_MAP` corrected, the second batch given the channel its
   * sibling has. Nothing else changes: same page, same materials, same
   * draw. This is the proof those cases can fail, and it runs the same
   * way round as the `sabotage` knob does for the clean cases.
   */
  readonly provideChannels?: boolean;
  /**
   * Draw only these cases, by name. Absent draws them all.
   *
   * It exists for ONE measurement: whether a silent case is silent. The
   * console is a whole-tab log with no case boundaries in it, so the only
   * way to attribute a line — or its absence — to a case is to run that
   * case and nothing else.
   */
  readonly only?: readonly string[];
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

/** Every instance the cases draw, in column order. */
const ALL: readonly number[] = [0, 1, 2, 3];

/**
 * A point cloud laid out one instance per column, carrying every channel
 * the cases draw with. The transforms come from the standard point
 * attributes and go through `buildInstanceBatches` — this is the shipped
 * path from point cloud to `InstanceBatch`, not a hand-built batch.
 *
 * `indices` names WHICH of the four fixture instances this cloud holds,
 * and each keeps its own column: a cloud of `[2, 3]` draws in columns 2
 * and 3 and nowhere else. That is what lets one 64x16 readback answer for
 * two batches of the same asset id drawn side by side.
 *
 * `hostTint` / `hostGain` / `hostId` duplicate `tint` / `gain` / `id`
 * under the names a host's shader declares (see the fixture). Duplicated
 * rather than renamed so that publishing one set or the other is the only
 * variable between a missing-channel case and the run that fixes it.
 */
function cloud(indices: readonly number[] = ALL) {
  const geo = createPointCloud(indices.length);
  const P = geo.attrs.point.require("P");
  const scale = geo.attrs.point.require("scale");
  const tint = geo.attrs.point.add("tint", "f32", 3, [0, 0, 0]);
  const gain = geo.attrs.point.add("gain", "f32", 1, 0);
  const id = geo.attrs.point.add("id", "u32", 1, 0);
  const idf = geo.attrs.point.add("idf", "f32", 1, 0);
  const hostTint = geo.attrs.point.add(HOST_TINT, "f32", 3, [0, 0, 0]);
  const hostGain = geo.attrs.point.add(HOST_GAIN, "f32", 1, 0);
  const hostId = geo.attrs.point.add(HOST_ID, "u32", 1, 0);
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    // Column i spans x in [-2 + i, -1 + i] under the camera below.
    P.setTuple(k, [-1.5 + i, 0, 0]);
    // 0.6 of the frustum height, so the top and bottom rows stay clear.
    scale.setTuple(k, [1, 0.6, 1]);
    tint.setTuple(k, [...TINTS[i]]);
    hostTint.setTuple(k, [...TINTS[i]]);
    gain.set(k, GAINS[i]);
    hostGain.set(k, GAINS[i]);
    id.set(k, IDS[i]);
    hostId.set(k, IDS[i]);
    // The SAME ids through an f32 column: the widening the spawner
    // refuses to do, done deliberately so the collision is measurable.
    idf.set(k, IDS[i]);
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

/**
 * The two names are parameters because the HOST owns them: a material
 * declaring `hostTint` is the same material declaring `tint`, and the
 * only difference the missing-channel cases turn on is whether the batch
 * publishes a column under the name this shader asks for.
 */
function tintMaterial(tintName = "tint", gainName = "gain"): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: `
      in vec3 ${tintName};
      in float ${gainName};
      out vec3 vTint;
      void main() {
        vTint = ${tintName} * ${gainName};
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

/** One batch of a case's asset id. Most cases have exactly one. */
interface BatchSpec {
  /** Which fixture instances (and therefore columns) it covers. */
  readonly indices?: readonly number[];
  /** Point attributes it publishes as channels, in `instanceAttrs` order. */
  readonly channels: readonly string[];
  /**
   * What `provideChannels` publishes INSTEAD — the corrected map, or the
   * channel the second batch was missing. Absent means the knob does
   * nothing to this batch, which is the case for everything that already
   * publishes what its material declares.
   */
  readonly provided?: readonly string[];
}

interface GlCase {
  readonly name: string;
  /**
   * One entry per batch, all resolving the SAME asset id — which is the
   * shape three's renderer sees when two cooked cells spawn the same
   * asset and only one of them carries a channel.
   */
  readonly batches: readonly BatchSpec[];
  readonly material: () => ShaderMaterial;
  /** Applied to the built mesh before the draw. */
  readonly tweak?: (mesh: InstancedMesh) => void;
  /** Which channel the sabotage knob corrupts, if this case honours it. */
  readonly sabotages?: string;
}

const GL_CASES: readonly GlCase[] = [
  {
    name: "f32-tint",
    batches: [{ channels: ["tint", "gain"] }],
    material: () => tintMaterial(),
    sabotages: "tint",
  },
  {
    // The gpuType trap, direction one: the library leaves gpuType at
    // three's default (FloatType) and the host declares `uint`.
    name: "u32-default-gpuType",
    batches: [{ channels: ["id"] }],
    material: () => uintMaterial("id"),
    sabotages: "id",
  },
  {
    // Direction two: the host does what the documentation says and sets
    // gpuType = IntType on the bound attribute.
    name: "u32-IntType",
    batches: [{ channels: ["id"] }],
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
    batches: [{ channels: ["idf"] }],
    material: () => floatIdMaterial("idf"),
  },
  {
    // A u32 column declared `in float` at the shader. Undefined by the
    // GLSL spec and validated by WebGL2 — recorded, not asserted on
    // beyond "it does not silently return the right answer".
    name: "u32-declared-float",
    batches: [{ channels: ["id"] }],
    material: () => floatIdMaterial("id"),
  },
  /* ---------------------------------------------------------------- *
   * THE STALE MAP: a material declaring a channel no batch publishes.
   * ---------------------------------------------------------------- */
  {
    // The host's shader declares `hostTint` / `hostGain`; the content
    // publishes `tint` / `gain`. Nothing is malformed — the batch is a
    // perfectly good channelled batch, the material is a perfectly good
    // material, and the two simply do not name the same thing. This is
    // what a wrong or stale CHANNEL_MAP entry looks like from below.
    name: "declared-absent-f32",
    batches: [{ channels: ["tint", "gain"], provided: [HOST_TINT, HOST_GAIN] }],
    material: () => tintMaterial(HOST_TINT, HOST_GAIN),
  },
  {
    // The same mistake with an INTEGER declaration. Kept beside the float
    // one because the two are not the same failure and the documentation
    // has to say which is which.
    name: "declared-absent-u32",
    batches: [{ channels: ["id"], provided: [HOST_ID] }],
    material: () => uintMaterial(HOST_ID),
  },
  {
    // TWO batches of ONE asset id: the first carries the channel, the
    // second carries none at all — a batch that never asked for one, not
    // a batch whose channel was removed. Both meshes' materials are
    // clones of the same `ShaderMaterial`, so three compiles ONE program
    // for the pair (`programs` records it) and the second mesh shades
    // through a pipeline built for attributes its geometry does not have.
    //
    // The second batch also shares the asset's geometry by reference —
    // `toInstancedMeshes` clones only for a batch that carries channels —
    // so there is nowhere for the attribute to have come from.
    name: "shared-asset-unchannelled-batch",
    batches: [
      { indices: SHARED_FIRST, channels: ["tint", "gain"] },
      { indices: SHARED_SECOND, channels: [], provided: ["tint", "gain"] },
    ],
    material: () => tintMaterial(),
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
  // One cloud per distinct instance split, built once: four points cost
  // nothing, but rebuilding them per case would make "the same values"
  // an assumption instead of a fact.
  const clouds = new Map<string, ReturnType<typeof cloud>>();
  const cloudFor = (indices: readonly number[]): ReturnType<typeof cloud> => {
    const key = indices.join(",");
    let found = clouds.get(key);
    if (found === undefined) {
      found = cloud(indices);
      clouds.set(key, found);
    }
    return found;
  };

  for (const spec of GL_CASES) {
    if (request.only !== undefined && !request.only.includes(spec.name)) continue;
    const material = spec.material();
    const assets = assetMap(material);
    // Each batch spec is its own `buildInstanceBatches` call, because one
    // call yields one batch per asset id — two batches of ONE id is what
    // two cooked cells produce, and that is the shape being tested.
    const batches = spec.batches.flatMap((b) => {
      const names = request.provideChannels === true && b.provided !== undefined ? b.provided : b.channels;
      return buildInstanceBatches(cloudFor(b.indices ?? ALL), {
        defaultAssetId: "q",
        // Absent, not empty: `instanceAttrs: []` and no `instanceAttrs`
        // are the same thing to the spawner, and absent is what a graph
        // that never asked for a channel actually sends.
        instanceAttrs: names.length > 0 ? [...names] : undefined,
      });
    });
    const meshes = toInstancedMeshes(batches, assets);
    for (const mesh of meshes) spec.tweak?.(mesh);
    const mode = request.sabotage ?? "none";
    if (spec.sabotages !== undefined && mode !== "none") {
      for (const mesh of meshes) sabotageChannel(mesh, spec.sabotages, mode);
    }
    const scene = new Scene();
    for (const mesh of meshes) scene.add(mesh);

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
      programs: renderer.info.programs?.length ?? -1,
      meshes: meshes.length,
    });

    for (const mesh of meshes) {
      scene.remove(mesh);
      mesh.dispose();
      // ONLY the per-batch clone. An unchannelled batch draws the asset
      // map's geometry by reference, and disposing that here would tear
      // down a geometry the next case still uses — the library's own
      // teardown rule, applied because this page is a consumer of it.
      if (ownsGeometry(mesh)) mesh.geometry.dispose();
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
    }
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

  const specs: {
    name: string;
    channels: string[];
    /** What `provideChannels` publishes instead; see `RunRequest`. */
    provided?: string[];
    sabotages?: string;
    color: () => unknown;
  }[] = [
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
    {
      // THE STALE MAP, under the renderer the integrator was on, and in
      // the SAME shape as its WebGL namesake: a batch that publishes real
      // channels under the content's names while the material's TSL
      // `attribute()` nodes name the host's. Not "a batch with no
      // channels" — that is the shared-asset case, and a doc sentence
      // about a stale NAME should be measured against a stale name.
      //
      // Deliberately LAST: a node pipeline built against an attribute the
      // geometry lacks is the one case here that might take the device
      // down with it, and the two measurements above must not be
      // collateral if it does.
      name: "declared-absent-f32",
      channels: [HOST_TINT, HOST_GAIN],
      provided: ["tint", "gain"],
      color: () => tsl.vec4(tsl.mul(tsl.attribute("tint", "vec3"), tsl.attribute("gain", "float")), 1),
    },
  ];

  const results: CaseResult[] = [];
  for (const spec of specs) {
    // Honoured here as well as on the WebGL side, and for the same
    // reason: the console measurement needs a run that draws ONE case, or
    // a line cannot be attributed to the case that printed it.
    if (request.only !== undefined && !request.only.includes(spec.name)) continue;
    const names = request.provideChannels === true && spec.provided !== undefined ? spec.provided : spec.channels;
    const material = new three.NodeMaterial();
    material.outputNode = spec.color() as never;
    const assets: AssetMap = { q: { geometry: new PlaneGeometry(1, 1), material } };
    const batches = buildInstanceBatches(geo, {
      defaultAssetId: "q",
      instanceAttrs: names.length > 0 ? [...names] : undefined,
    });
    const [mesh] = toInstancedMeshes(batches, assets);
    const mode = request.sabotage ?? "none";
    if (mode !== "none" && spec.sabotages !== undefined) sabotageChannel(mesh, spec.sabotages, mode);
    const scene = new Scene();
    scene.add(mesh);
    // Per case rather than around the loop: a case that throws must
    // report AS a case, so the ones after it still run and the one that
    // failed still names what it did. `error` and `skipped` are different
    // answers and the suite reads them differently.
    try {
      renderer.setRenderTarget(target);
      renderer.clear();
      await renderer.renderAsync(scene, camera);
      const px = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, WIDTH, HEIGHT)) as Uint8Array;
      renderer.setRenderTarget(null);
      await renderer.renderAsync(scene, camera);

      const samples: Sample[] = [];
      for (let i = 0; i < N; i++) samples.push(sampleOf(px, i * CELL + CELL / 2, HEIGHT / 2));
      results.push({ name: spec.name, samples, background: sampleOf(px, CELL / 2, 0), glErrors: [] });
    } catch (err) {
      renderer.setRenderTarget(null);
      results.push({
        name: spec.name,
        samples: [],
        background: { r: 0, g: 0, b: 0, a: 0 },
        glErrors: [],
        error: String(err),
      });
    }

    scene.remove(mesh);
    mesh.dispose();
    if (ownsGeometry(mesh)) mesh.geometry.dispose();
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
