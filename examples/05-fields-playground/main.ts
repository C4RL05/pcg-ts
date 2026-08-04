/**
 * 05 — fields playground: the Svelte panel edits noise parameters and
 * emits a declarative FieldSpec; `fieldFromJson` builds the field, which
 * is evaluated over a dense grid point cloud and visualized as a colored
 * heightmap surface. The exact JSON shown in the panel is what runs.
 */
import { createPointCloud, evaluateField, fieldFromJson, type FieldSpec } from "pcg-ts";
import { mount } from "svelte";
import { BufferAttribute, Color, Mesh, MeshStandardMaterial, PlaneGeometry } from "three";
import { createFpsMeter } from "../shared/fps.js";
import { createOverlay } from "../shared/overlay.js";
import { createScene } from "../shared/scene.js";
import Panel from "./Panel.svelte";

const PLANE_SIZE = 30;
const RES = 192; // grid resolution per side
const HEIGHT_SCALE = 5;

// -- scene + surface -------------------------------------------------------

const { scene, start } = createScene({ cameraPosition: [24, 22, 24] });

const surfaceGeo = new PlaneGeometry(PLANE_SIZE, PLANE_SIZE, RES - 1, RES - 1);
surfaceGeo.rotateX(-Math.PI / 2);
const surface = new Mesh(
  surfaceGeo,
  new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
);
scene.add(surface);

// The evaluation domain: one standard point cloud whose P attribute holds
// the grid's world XZ positions. Reused across evaluations (positions
// never change; each evaluation gets a fresh context).
const pos = surfaceGeo.getAttribute("position");
const vertexCount = pos.count;
const cloud = createPointCloud(vertexCount);
{
  const P = cloud.attrs.point.require("P").data;
  for (let i = 0; i < vertexCount; i++) {
    P[i * 3] = pos.getX(i);
    P[i * 3 + 1] = 0;
    P[i * 3 + 2] = pos.getZ(i);
  }
}

const colorAttr = new BufferAttribute(new Float32Array(vertexCount * 3), 3);
surfaceGeo.setAttribute("color", colorAttr);

const c0 = new Color(0x1c2a4d);
const c1 = new Color(0x2f9e8f);
const c2 = new Color(0xf4d35e);
const c = new Color();

// -- stats overlay (top-left; controls live in the Svelte panel) -----------

const overlay = createOverlay({
  title: "05 · fields playground",
  info: "FieldSpec JSON → fieldFromJson → evaluate over a grid point cloud → height + color.",
});
const statFps = overlay.addStat("fps");
const statElements = overlay.addStat("elements");
const statEval = overlay.addStat("build + evaluate");
statElements(String(vertexCount));

// -- evaluation ------------------------------------------------------------

function applySpec(spec: FieldSpec): void {
  const t0 = performance.now();
  const field = fieldFromJson(spec);
  const column = evaluateField(field, { geo: cloud, domain: "point", seed: 0 });
  const elapsed = performance.now() - t0;

  // Out-range for color normalization comes from the spec's remap args.
  const args = spec.args as unknown[];
  const outMin = typeof args[3] === "number" ? args[3] : 0;
  const outMax = typeof args[4] === "number" ? args[4] : 1;
  const span = outMax - outMin || 1;

  for (let i = 0; i < vertexCount; i++) {
    const v = column.data[i];
    pos.setY(i, v * HEIGHT_SCALE * (1 / Math.max(Math.abs(outMin), Math.abs(outMax), 1)));
    const t = Math.min(Math.max((v - outMin) / span, 0), 1);
    if (t < 0.5) c.copy(c0).lerp(c1, t * 2);
    else c.copy(c1).lerp(c2, t * 2 - 1);
    colorAttr.setXYZ(i, c.r, c.g, c.b);
  }
  pos.needsUpdate = true;
  colorAttr.needsUpdate = true;
  surfaceGeo.computeVertexNormals();
  surfaceGeo.computeBoundingSphere();

  statEval(`${elapsed.toFixed(1)} ms`);
}

// -- panel -----------------------------------------------------------------

const target = document.getElementById("panel");
if (!target) throw new Error("missing #panel element");
mount(Panel, { target, props: { onSpec: (spec: object) => applySpec(spec as FieldSpec) } });

const fps = createFpsMeter((v) => statFps(v));
start(() => fps());
