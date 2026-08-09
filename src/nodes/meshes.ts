/**
 * Mesh source nodes: triangle geometry built from parameters alone, with
 * no runtime injection.
 *
 * This is the only in-graph door to mesh geometry. `dataInput` carries
 * live items that a serialized graph does not keep, so before this node
 * existed every mesh-consuming path (surfaceSample, transferAttribute's
 * uv and raycast mappings, promoteAttribute's topology) was unreachable
 * from JSON alone.
 */
import { createTriangleMesh } from "../data/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { standardNode } from "./registry.js";

/** Axis letters in world order, for error messages. */
const AXIS_NAMES = ["x", "y", "z"] as const;

/** In-plane axes of each plane orientation: [u axis, v axis]. */
const PLANE_AXES: Record<string, readonly [number, number]> = {
  xz: [0, 2],
  xy: [0, 1],
  yz: [1, 2],
};

/**
 * Whole-number quad counts per world axis, validated. `vec3` params carry
 * finite numbers, not integers, so a fractional count is caught here where
 * the message can name the axis and the fix.
 */
function subdivisionCounts(subdivisions: readonly number[]): [number, number, number] {
  const out: number[] = [];
  for (let a = 0; a < 3; a++) {
    const v = subdivisions[a];
    if (!Number.isInteger(v)) {
      throw new Error(
        `meshPrimitive: subdivisions.${AXIS_NAMES[a]} is ${v}, but subdivision counts must be whole numbers >= 1 (they count quads along an axis); use ${Math.max(1, Math.round(v))}`,
      );
    }
    out.push(v);
  }
  return out as [number, number, number];
}

/**
 * Append one subdivided quad to the buffers: `nu * nv` quads spanning the
 * `au`/`av` world axes at a fixed `an` coordinate. Points run u fastest.
 * The base winding gives a normal along +(au x av); `reverse` flips it.
 */
function appendQuad(
  positions: number[],
  uvs: number[],
  triangles: number[],
  au: number,
  av: number,
  an: number,
  nu: number,
  nv: number,
  minU: number,
  minV: number,
  sizeU: number,
  sizeV: number,
  planeCoord: number,
  reverse: boolean,
): void {
  const base = positions.length / 3;
  const stepU = sizeU / nu;
  const stepV = sizeV / nv;
  // One scratch tuple for the whole quad: the axes are chosen at runtime,
  // so the coordinate has to be addressed by index, not by name.
  const p = [0, 0, 0];
  for (let iv = 0; iv <= nv; iv++) {
    for (let iu = 0; iu <= nu; iu++) {
      p[au] = minU + iu * stepU;
      p[av] = minV + iv * stepV;
      p[an] = planeCoord;
      positions.push(p[0], p[1], p[2]);
      uvs.push(iu / nu, iv / nv);
    }
  }
  const rowStride = nu + 1;
  for (let iv = 0; iv < nv; iv++) {
    for (let iu = 0; iu < nu; iu++) {
      const a = base + iv * rowStride + iu;
      const b = a + 1;
      const c = a + rowStride;
      const d = c + 1;
      if (reverse) {
        triangles.push(a, c, b, b, c, d);
      } else {
        triangles.push(a, b, c, b, d, c);
      }
    }
  }
}

/** Params of {@link meshPrimitive}. */
export interface MeshPrimitiveParams {
  shape: string;
  size: readonly number[];
  center: readonly number[];
  orientation: string;
  subdivisions: readonly number[];
  flip: boolean;
}

/** Parametric triangle meshes: a subdivided plane or box. */
export const meshPrimitive = standardNode<MeshPrimitiveParams>({
  type: "meshPrimitive",
  category: "source",
  description:
    "Builds a parametric triangle mesh with no input: shape 'plane' is one axis-aligned rectangle, shape 'box' is six of them around a volume. Output carries P (f32 tuple 3), a uv point attribute (f32 tuple 2) running 0..1 across each face, and one 3-vertex 'poly' primitive per triangle — everything surfaceSample, transferAttribute's 'uv' and 'raycast' mappings, and promoteAttribute need. This is the only mesh source that survives serialization: dataInput's items are injected at runtime and a saved graph carries none, so a graph that must cook from JSON alone gets its surface from here. Plane normals point along the positive third axis (+y for orientation 'xz', +z for 'xy', +x for 'yz'); box normals point outward. Point order is u fastest then v, one block per face in the order +x, -x, +y, -y, +z, -z; a box's faces do not share points, so uv seams are exact. A zero size component makes degenerate (zero-area) triangles, which area-weighted sampling and the raycast mapping skip.",
  inputs: [],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    shape: {
      type: "enum",
      default: "plane",
      enum: ["plane", "box"],
      description:
        "'plane' builds one rectangle in the world plane named by `orientation`; 'box' builds a closed six-sided box of the full `size` extents (and ignores `orientation`).",
    },
    size: {
      type: "vec3",
      default: [10, 10, 10],
      min: 0,
      description:
        "Full extents along world x, y, z, in world units (not half-extents). For 'plane', the component along the plane's normal axis is ignored.",
    },
    center: {
      type: "vec3",
      default: [0, 0, 0],
      description: "World position of the shape's center.",
    },
    orientation: {
      type: "enum",
      default: "xz",
      enum: ["xz", "xy", "yz"],
      description:
        "Which world plane a 'plane' lies in, and so which axis is its normal: 'xz' is the ground plane (normal +y), 'xy' faces +z, 'yz' faces +x. Ignored for 'box'.",
    },
    subdivisions: {
      type: "vec3",
      default: [1, 1, 1],
      min: 1,
      description:
        "Quads along world x, y, z — whole numbers, minimum 1. A plane uses the two components of its own axes ([1,1,1] is a single quad, two triangles); a box uses all three, each face taking the two that span it. More subdivisions give finer sampling and a finer uv/raycast target.",
    },
    flip: {
      type: "bool",
      default: false,
      description:
        "Reverse every triangle's winding, which flips the surface normals — a plane becomes a ceiling, a box becomes an inward-facing room.",
    },
  },
  execute({ params }) {
    const sub = subdivisionCounts(params.subdivisions);
    const [cx, cy, cz] = params.center;
    const center = [cx, cy, cz];
    const size = [params.size[0], params.size[1], params.size[2]];
    const positions: number[] = [];
    const uvs: number[] = [];
    const triangles: number[] = [];

    if (params.shape === "plane") {
      const axes = PLANE_AXES[params.orientation];
      if (!axes) {
        throw new Error(
          `meshPrimitive: unknown orientation "${params.orientation}"; valid orientations: ${Object.keys(PLANE_AXES).join(", ")}`,
        );
      }
      const [au, av] = axes;
      const an = 3 - au - av;
      // The base winding's normal is +(au x av), which is -y for 'xz'
      // (x cross z). Reversing there is what makes every orientation's
      // normal the POSITIVE third axis, as the description promises.
      const reverse = params.flip !== (au === 0 && av === 2);
      appendQuad(
        positions,
        uvs,
        triangles,
        au,
        av,
        an,
        sub[au],
        sub[av],
        center[au] - size[au] / 2,
        center[av] - size[av] / 2,
        size[au],
        size[av],
        center[an],
        reverse,
      );
    } else if (params.shape === "box") {
      // +x, -x, +y, -y, +z, -z. For normal axis `an`, the spanning axes
      // (an+1)%3 and (an+2)%3 cross to +an, so the base winding already
      // faces outward on the positive side and is reversed on the other.
      for (let an = 0; an < 3; an++) {
        for (const sign of [1, -1]) {
          const au = (an + 1) % 3;
          const av = (an + 2) % 3;
          appendQuad(
            positions,
            uvs,
            triangles,
            au,
            av,
            an,
            sub[au],
            sub[av],
            center[au] - size[au] / 2,
            center[av] - size[av] / 2,
            size[au],
            size[av],
            center[an] + (sign * size[an]) / 2,
            params.flip !== (sign < 0),
          );
        }
      }
    } else {
      throw new Error(
        `meshPrimitive: unknown shape "${params.shape}"; valid shapes: plane, box`,
      );
    }

    const geo = createTriangleMesh(positions, triangles);
    const uv = geo.attrs.point.add("uv", "f32", 2, 0);
    uv.data.set(uvs);
    return { out: [makeGeometryItem(geo)] };
  },
});
