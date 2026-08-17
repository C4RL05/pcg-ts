/**
 * Frame a camera, and a floor, on what a cook actually DREW.
 *
 * The editor loads arbitrary corpus graphs, so no fixed studio pose can
 * suit them: the shipped default sat at [20, 15, 20] over a 30-unit
 * ground while `basics-compose-primitives` scatters over ±40, so the page
 * opened on content running off both edges of its own floor. Nothing
 * declares the extent either — the graph JSON carries no bounds, and the
 * params do not imply one (a scatter's count and a field's amplitude both
 * move the result). Measuring is the only honest source.
 *
 * The measurement is taken from the three.js objects rather than the
 * cooked columns because those objects are what the viewer actually sees:
 * by then instance transforms, asset geometry and line topology have all
 * been applied. `Box3.setFromObject` accounts for an InstancedMesh's
 * per-instance matrices (three reads `object.boundingBox` for those), so
 * a spawn graph measures the props where they stand rather than the bare
 * points they grew from.
 */
import { Box3, Vector3 } from "three";
import type { Object3D, PerspectiveCamera } from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

/** What was drawn, measured. */
export interface Framing {
  readonly box: Box3;
  readonly center: Vector3;
  /** Half the box diagonal — the radius of its bounding sphere. */
  readonly radius: number;
  /** The larger horizontal extent, which is what a floor has to cover. */
  readonly footprint: number;
  /** Vertical extent. Compared against the footprint to read flatness. */
  readonly height: number;
}

/**
 * Leave this much room around the content rather than filling the frame
 * edge to edge. Small, because the corner fit below is already exact and
 * a three-quarter view of flat content leaves natural slack on its own —
 * anything larger reads as the camera being too far away.
 */
const FIT_MARGIN = 1.05;

/**
 * Measure a subtree, or `null` when there is nothing to measure.
 *
 * The finiteness check is not defensive padding. A graph free to compute
 * its own positions is free to produce NaN, and `Box3.isEmpty` cannot
 * catch that: it asks `max < min`, and every comparison against NaN is
 * false, so a NaN box reports itself as perfectly good. Framing on one
 * puts NaN into `camera.position`, and a camera with a NaN pose renders
 * black forever with no way back short of a reload. Treating it as
 * "nothing measurable" instead leaves the previous pose alone.
 */
export function measureDrawn(root: Object3D): Framing | null {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  if (box.isEmpty()) return null;
  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const finite = (v: Vector3): boolean =>
    Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
  if (!finite(center) || !finite(size)) return null;
  /**
   * A box with no extent at all — every point landed on the same spot,
   * which a one-point scatter or a fully collapsed path both produce —
   * has no scale to frame against, and every quantity derived from it
   * degenerates together: the fit distance is zero, so the camera is
   * placed exactly ON the content with a far plane just past its own
   * near. Nothing downstream can recover from that, because the
   * information is genuinely absent rather than merely small. Giving it
   * an arbitrary unit of size is the honest answer: the viewer sees a
   * dot at a sane distance instead of a black frame.
   *
   * Only the fully degenerate case. A flat box is not degenerate — it is
   * the single most common shape the library produces, and inflating it
   * would lift every ground scatter off its own floor.
   */
  if (size.length() < 1e-9) {
    box.expandByScalar(0.5);
    box.getSize(size);
  }
  return {
    box,
    center,
    radius: size.length() / 2,
    footprint: Math.max(size.x, size.z),
    height: size.y,
  };
}

/**
 * Where the camera sits relative to the target: a three-quarter view
 * whose elevation opens up as the content flattens.
 *
 * A fixed elevation cannot serve both. The library's output is very often
 * a scatter on the ground — zero height across a wide footprint — and a
 * low camera sees that edge-on, foreshortened into a band. Tall content
 * (a truss, a spire field) wants the opposite: a low camera reads the
 * height that is the point of it. So the angle is derived from the ratio
 * rather than picked once.
 */
function viewDirection(framing: Framing): Vector3 {
  // A zero footprint is a vertical line — the tallest thing there is, not
  // the flattest. The guard has to agree with the limit it stands in for,
  // or the one shape that most wants a low camera gets the highest one.
  const flatness =
    framing.footprint <= 1e-9 ? 0 : 1 - Math.min(framing.height / framing.footprint, 1);
  const elevation = ((22 + 16 * flatness) * Math.PI) / 180;
  const azimuth = Math.PI / 4;
  const horizontal = Math.cos(elevation);
  return new Vector3(
    Math.sin(azimuth) * horizontal,
    Math.sin(elevation),
    Math.cos(azimuth) * horizontal,
  ).normalize();
}

/**
 * The smallest distance along `dir` at which every corner of `box` is
 * inside the frustum.
 *
 * Fitting the bounding SPHERE is the usual shortcut and it is wrong for
 * this content: a flat 80×80 scatter has a sphere radius of 57, so
 * fitting it pushes the camera far enough back to fit a cube that is not
 * there and the scatter lands small in the middle of the frame. Solving
 * the eight corners against both frustum angles costs a loop and is
 * exact. Both angles matter — a wide viewport runs out of height first,
 * a tall one runs out of width.
 */
function fitDistance(box: Box3, center: Vector3, dir: Vector3, camera: PerspectiveCamera): number {
  const vTan = Math.tan(((camera.fov * Math.PI) / 180) / 2);
  const hTan = vTan * camera.aspect;
  const forward = dir.clone().negate();
  const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0));
  // Only when looking straight down, which `viewDirection` never returns.
  if (right.lengthSq() < 1e-12) right.set(1, 0, 0);
  right.normalize();
  const up = new Vector3().crossVectors(right, forward).normalize();

  const corner = new Vector3();
  let dist = 0;
  for (let i = 0; i < 8; i++) {
    corner
      .set(
        (i & 1) === 0 ? box.min.x : box.max.x,
        (i & 2) === 0 ? box.min.y : box.max.y,
        (i & 4) === 0 ? box.min.z : box.max.z,
      )
      .sub(center);
    // Depth is measured from the eye, so a corner nearer the camera
    // (positive `along`) needs the eye pushed back by exactly that much
    // on top of what its off-axis offset already demands.
    const along = corner.dot(dir);
    dist = Math.max(
      dist,
      along + Math.abs(corner.dot(right)) / hTan,
      along + Math.abs(corner.dot(up)) / vTan,
    );
  }
  return dist;
}

/**
 * The depth range for a camera sitting `distance` from the content.
 *
 * The corpus spans four orders of magnitude between a unit sphere and a
 * world-scale scatter, so a fixed 0.1/2000 pair either clips the small
 * ones or spends the whole depth buffer on the large ones. But deriving
 * it from the FRAMING alone is worse than the fixed pair it replaces:
 * the framing distance is only where the camera starts, orbit controls
 * put no ceiling on the wheel, and a far plane a couple of framing
 * distances out means a second of scrolling pushes the content — and its
 * floor — out the back of the frustum and leaves bare background. It has
 * to follow the camera, so it takes the live distance and is re-derived
 * as that changes.
 *
 * The far/near ratio is held at 1e5, which is what keeps depth precision
 * even across that span rather than merely sufficient at one end of it.
 */
export function depthRange(framing: Framing, distance: number): { near: number; far: number } {
  const far = Math.max(distance + framing.radius * 4, framing.radius * 8, 1e-3);
  return { near: Math.max(far / 1e5, 1e-5), far };
}

/** Point `camera` (and its orbit target) at the measured content. */
export function frameCamera(
  framing: Framing,
  camera: PerspectiveCamera,
  controls?: OrbitControls,
): void {
  const dir = viewDirection(framing);
  // The margin is taken by growing the content rather than by scaling the
  // distance, so a box that is deep along the view axis does not get an
  // extra push proportional to that depth.
  const padded = framing.box.clone();
  const pad = framing.box.getSize(new Vector3()).multiplyScalar((FIT_MARGIN - 1) / 2);
  padded.expandByVector(pad);
  const dist = Math.max(fitDistance(padded, framing.center, dir, camera), framing.radius * 0.5, 1e-3);

  camera.position.copy(framing.center).addScaledVector(dir, dist);
  const { near, far } = depthRange(framing, dist);
  camera.near = near;
  camera.far = far;
  camera.updateProjectionMatrix();
  camera.lookAt(framing.center);
  if (controls) {
    controls.target.copy(framing.center);
    controls.update();
  }
}

/** Snap up to the next 1, 2 or 5 times a power of ten. */
function niceUp(v: number): number {
  if (!(v > 0)) return 1;
  const base = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / base;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * base;
}

/** A floor sized to the content, in the units a grid should be drawn in. */
export interface GroundPlan {
  readonly size: number;
  readonly divisions: number;
  /** Centre of the floor. It follows the content, which need not sit on the origin. */
  readonly x: number;
  readonly z: number;
  readonly y: number;
  /**
   * How far to lift the grid above the floor plane.
   *
   * Both sit just under the content, and "just under" cannot be a
   * constant: the corpus spans a unit sphere to a world-scale scatter, so
   * a fixed 0.01 that separates them cleanly at one scale is far inside
   * the depth buffer's resolution at another, and the grid comes through
   * the content as dark seams. Scaling the gap with the floor keeps the
   * separation constant in the only terms that matter — a fraction of the
   * view distance.
   */
  readonly lift: number;
}

/**
 * Size the floor to the content and snap it to a readable number.
 *
 * Snapping is what makes the grid a measuring stick rather than
 * decoration: cells land on round world units, so counting them tells you
 * how big the thing is. The floor never rises above y = 0 — that is the
 * world's ground, and content sitting on it should look like it does —
 * but it drops below when the content does, so a sphere centred on the
 * origin is not sawn in half by its own floor.
 */
export function groundPlan(framing: Framing): GroundPlan {
  const span = Math.max(framing.footprint * 1.35, 1);
  // The CELL is what gets snapped, and the floor is then a whole number
  // of them. Snapping the floor itself is what the first cut did, and it
  // overshoots badly: a 108-unit span rounds up to 200, so two thirds of
  // the frame is empty floor and the content reads as far smaller than it
  // is. Snapping the cell lands the floor within one cell of the span
  // while keeping every line on a round world unit.
  // No clamp on the count: `niceUp` returns a value in [v, 2.5v), so
  // `span / cell` is always within [9.6, 24] and the divisions land in
  // [10, 24] by construction. A guard here would only ever be dead.
  const cell = niceUp(span / 24);
  const divisions = Math.ceil(span / cell);
  // Rounded because the product of a snapped cell and a count still
  // carries binary noise (0.1 × 14 is 1.4000000000000001), and this
  // number is compared as a string to decide whether to rebuild the grid.
  const size = Number((cell * divisions).toPrecision(12));
  const center = framing.box.getCenter(new Vector3());
  const lift = size * 0.002;
  return {
    size,
    divisions,
    x: Math.round(center.x / cell) * cell,
    z: Math.round(center.z / cell) * cell,
    y: Math.min(0, framing.box.min.y) - lift,
    lift: lift * 0.4,
  };
}
