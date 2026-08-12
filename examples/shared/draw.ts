/**
 * Draw one cooked `DataItem` as three.js objects.
 *
 * A geometry is drawn as whatever it actually CARRIES — triangles, lines,
 * or bare points — rather than assumed to be one of them, because an
 * arbitrary graph is the input and guessing wrong renders an empty frame
 * that looks like a generation bug. That reasoning was worked out on the
 * preview page, which is judged against arbitrary corpus graphs; the
 * sandbox now loads the same corpus, so the logic lives here and both
 * call it.
 *
 * CONSTRUCTION ONLY. Nothing here touches a scene graph or picks a look:
 * materials arrive as a factory and the objects come back for the caller
 * to add. The two callers want genuinely different renderers — a daylight
 * page with shadows, a dark studio without — and that difference is
 * renderer work, not generation work.
 */
import { isDeviceResidentInstances, primitiveTypeCounts, type DataItem } from "pcg-ts";
import {
  toBufferGeometry,
  toInstancedMeshes,
  toLineGeometry,
  toPointsObject,
} from "pcg-ts/three";
import { InstancedMesh, LineSegments, Mesh, Points, type Material, type Object3D } from "three";
import { resolveAssets, type PlaceholderAssets } from "./assets.js";

/**
 * Materials for the drawn objects. Functions rather than instances
 * because `vertexColors` has to be decided per geometry: it is asked of
 * the EXPORTED geometry, not the pcg one — the exporter emits a colour
 * buffer only for an f32 column of at least three components, and taking
 * "the graph has an attribute named color" as the answer sets
 * `vertexColors` with no buffer behind it, which renders solid black.
 */
export interface DrawMaterials {
  mesh(vertexColors: boolean): Material;
  line(vertexColors: boolean): Material;
}

export interface DrawOptions {
  assets: PlaceholderAssets;
  materials: DrawMaterials;
  /** Draw points even for geometries that carry topology. */
  points?: boolean;
  /** World size for point sprites (they are size-attenuated). */
  pointSize?: number;
}

/** What was drawn, and what was not — the caller's stats line. */
export interface DrawReport {
  kind: "geometry" | "instances" | "value";
  /** "mesh" | "lines" | "points" | "instances", in draw order. */
  drew: string[];
  points?: number;
  instances?: number;
  primitives?: Record<string, number>;
  /** Instances per asset id: a species mix is what a spawn graph is about. */
  batches?: Record<string, number>;
  /** The geometry has primitives but none carry a type tag. */
  untagged?: boolean;
  hint?: string;
  skipped?: string;
}

export interface Drawn {
  objects: Object3D[];
  report: DrawReport;
}

export function drawItem(item: DataItem, opts: DrawOptions): Drawn {
  if (item.kind === "value") {
    return {
      objects: [],
      report: { kind: "value", drew: [], skipped: "values have no scene representation" },
    };
  }

  if (item.kind === "instances") {
    if (isDeviceResidentInstances(item)) {
      return {
        objects: [],
        report: { kind: "instances", drew: [], skipped: "device-resident batches" },
      };
    }
    const meshes = toInstancedMeshes(item.batches, resolveAssets(item.batches, opts.assets));
    let instances = 0;
    const batches: Record<string, number> = {};
    for (const mesh of meshes) {
      instances += mesh.count;
      batches[mesh.name] = (batches[mesh.name] ?? 0) + mesh.count;
    }
    return {
      objects: meshes,
      report: { kind: "instances", drew: ["instances"], instances, batches },
    };
  }

  const geo = item.geo;
  const counts = primitiveTypeCounts(geo);
  const untagged = geo.primitiveCount > 0 && Object.keys(counts).length === 0;
  const objects: Object3D[] = [];
  const drew: string[] = [];
  const problems: string[] = [];

  /**
   * Run an exporter, swallowing its refusal ONLY when we were guessing.
   *
   * An untagged geometry is genuinely ambiguous — both exporters are
   * offered it and at most one can be right — so a refusal there is the
   * answer, not a fault. A geometry TAGGED with the kind we asked for is
   * different: the only refusals left are a missing `P` and "every
   * primitive touches a non-finite position", which is a field that
   * divided by zero upstream. Swallowing that degrades silently to a
   * point cloud and hides the one thing the author needs told.
   */
  const attempt = (what: string, run: () => void): void => {
    try {
      run();
      drew.push(what);
    } catch (err) {
      if (!untagged) problems.push(err instanceof Error ? err.message : String(err));
    }
  };

  if ((counts.poly ?? 0) > 0 || untagged) {
    attempt("mesh", () => {
      const exported = toBufferGeometry(geo);
      objects.push(new Mesh(exported, opts.materials.mesh(exported.hasAttribute("color"))));
    });
  }
  if ((counts.polyline ?? 0) > 0 || (untagged && drew.length === 0)) {
    attempt("lines", () => {
      const exported = toLineGeometry(geo);
      objects.push(
        new LineSegments(exported, opts.materials.line(exported.hasAttribute("color"))),
      );
    });
  }
  // Points are the fallback, not an addition: drawing a cloud over a mesh
  // it belongs to buries the surface under its own vertices.
  const suppressed = geo.pointCount > 0 && drew.length > 0 && opts.points !== true;
  if (geo.pointCount > 0 && !suppressed) {
    objects.push(toPointsObject(geo, { size: opts.pointSize ?? 0.1 }));
    drew.push("points");
  }

  return {
    objects,
    report: {
      kind: "geometry",
      drew,
      points: geo.pointCount,
      primitives: counts,
      ...(untagged ? { untagged: true } : {}),
      ...(suppressed ? { hint: "points not drawn because topology was" } : {}),
      ...(problems.length > 0 ? { skipped: problems.join(" | ") } : {}),
    },
  };
}

/**
 * Release what `drawItem` minted, and only that. An InstancedMesh's
 * geometry and material belong to the ASSET — memoized across cooks in
 * `assets.ts` precisely so a viewer that re-cooks on every edit does not
 * leak a GPU program each time — so its own `dispose()` (instance buffers
 * only) is the whole job. Everything else was built for this cook alone.
 */
export function disposeDrawn(objects: readonly Object3D[]): void {
  for (const obj of objects) {
    if (obj instanceof InstancedMesh) {
      obj.dispose();
      continue;
    }
    if (obj instanceof Mesh || obj instanceof LineSegments || obj instanceof Points) {
      obj.geometry.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat.dispose();
    }
  }
}
