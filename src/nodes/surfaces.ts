/**
 * Surface nodes: the producers that turn a curve into a skin and a
 * footprint into a solid.
 *
 * Before these, the library could represent, sample, transfer through,
 * filter, serialize and render a triangle mesh, and had exactly one node
 * that MADE one — `meshPrimitive`, which builds planes and boxes from
 * params alone. Everything a graph drew out of curves stopped at
 * `pathSegments`, which fakes a tube as a run of instanced cylinders.
 *
 * Both nodes here emit 3-VERTEX `poly` primitives, never n-gons. That is
 * not a stylistic choice: `surfaceSample` skips any primitive whose
 * vertex count is not 3, and the `uv` and `raycast` transfer mappings
 * collect only 3-vertex `poly` primitives. A quad-spelled surface would
 * draw correctly through `toBufferGeometry` (which fan-triangulates) and
 * be invisible to the library's own consumers — a plausible-looking cook,
 * which is the failure class this library refuses everywhere else.
 *
 * Neither node RESAMPLES its input. `sweepProfile` puts one ring on each
 * point it is given; an author who wants a finer surface runs
 * `pathResample` first, which is already the idiom. That removes the
 * interpolation question entirely, and with it the one fudge in
 * `pathSegments`, whose radius has to average its segment's two endpoints
 * because a segment has no element of its own. A ring IS at a point, so a
 * field-capable radius resolves there exactly.
 */
import { Geometry, PRIMTYPE_ATTR, type PrimType } from "../data/index.js";
import { type Column, isField } from "../fields/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { standardNode } from "./registry.js";
import {
  type FieldParam,
  type PolylineArcTable,
  carryPrimitiveAttributes,
  copyElements,
  orientQuat,
  polylineArcTables,
  readComp,
  requireGeometry,
  requireReportSlot,
  requireTuple,
  resolveOnMaybeGpu,
  rotateVec,
} from "./util.js";

/** How often the emit loops check for cancellation. */
const CANCEL_STRIDE = 1024;

/**
 * A cross-section, in the ring's own 2D basis and at unit scale.
 *
 * `pos` and `nrm` hold one (a1, a2) pair per ENTRY, `v` the texture
 * coordinate around the profile, and `bandA`/`bandB` name the entry pairs
 * that get stitched into quads. Entries and bands are separate because a
 * profile with FLAT faces needs its corners duplicated — a square tube
 * whose corner points carry an averaged normal shades like a rounded rod
 * — and duplicating a corner would otherwise emit a zero-width band
 * between the two copies. `cap` names the distinct corners in boundary
 * order, so a cap fan visits each position exactly once.
 */
interface ProfileSpec {
  readonly count: number;
  readonly pos: Float64Array;
  readonly nrm: Float64Array;
  readonly v: Float64Array;
  readonly bandA: Uint32Array;
  readonly bandB: Uint32Array;
  /** Empty for an open profile, which has no inside and takes no cap. */
  readonly cap: Uint32Array;
  /** Which field param sets this profile's scale: "radius" or "width". */
  readonly scaleParam: "radius" | "width";
}

/**
 * A closed ring of `sides` points on the unit circle, with the seam
 * column duplicated: entry `sides` sits exactly on entry 0 but carries
 * `v = 1` rather than `v = 0`. Sharing the point instead would make a
 * texture run backwards across one column of quads; the duplicate costs
 * `(sides + 1) / sides` points and is the standard answer.
 *
 * The seam's trigonometry is taken at `i % sides` rather than at `2 * PI`,
 * so the duplicated entry is BIT-IDENTICAL to entry 0 instead of a
 * `Math.sin(2 * PI)` hair away from it.
 */
function circleProfile(sides: number): ProfileSpec {
  const count = sides + 1;
  const pos = new Float64Array(count * 2);
  const nrm = new Float64Array(count * 2);
  const v = new Float64Array(count);
  for (let i = 0; i <= sides; i++) {
    const phi = (2 * Math.PI * (i % sides)) / sides;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    pos[i * 2] = c;
    pos[i * 2 + 1] = s;
    nrm[i * 2] = c;
    nrm[i * 2 + 1] = s;
    v[i] = i / sides;
  }
  const bandA = new Uint32Array(sides);
  const bandB = new Uint32Array(sides);
  for (let i = 0; i < sides; i++) {
    bandA[i] = i;
    bandB[i] = i + 1;
  }
  const cap = new Uint32Array(sides);
  for (let i = 0; i < sides; i++) cap[i] = i;
  return { count, pos, nrm, v, bandA, bandB, cap, scaleParam: "radius" };
}

/**
 * A square of half-width 1, with every corner duplicated so the four
 * faces stay flat. Corners run counter-clockwise from (1, -1), matching
 * the circle's direction of travel, so the two profiles wind the same way
 * and produce the same facing.
 */
function squareProfile(): ProfileSpec {
  // Corner positions in order, then the outward normal of the face that
  // LEAVES each corner.
  const corners = [1, -1, 1, 1, -1, 1, -1, -1];
  const faceNrm = [1, 0, 0, 1, -1, 0, 0, -1];
  const count = 8;
  const pos = new Float64Array(count * 2);
  const nrm = new Float64Array(count * 2);
  const v = new Float64Array(count);
  for (let f = 0; f < 4; f++) {
    const a = f * 2;
    const b = ((f + 1) % 4) * 2;
    // Entry 2f starts face f at corner f; entry 2f + 1 ends it at the
    // next corner. Both carry face f's normal.
    pos[(2 * f) * 2] = corners[a];
    pos[(2 * f) * 2 + 1] = corners[a + 1];
    pos[(2 * f + 1) * 2] = corners[b];
    pos[(2 * f + 1) * 2 + 1] = corners[b + 1];
    nrm[(2 * f) * 2] = faceNrm[a];
    nrm[(2 * f) * 2 + 1] = faceNrm[a + 1];
    nrm[(2 * f + 1) * 2] = faceNrm[a];
    nrm[(2 * f + 1) * 2 + 1] = faceNrm[a + 1];
    v[2 * f] = f / 4;
    v[2 * f + 1] = (f + 1) / 4;
  }
  const bandA = Uint32Array.of(0, 2, 4, 6);
  const bandB = Uint32Array.of(1, 3, 5, 7);
  // The distinct corners, in boundary order: the first entry of each face.
  const cap = Uint32Array.of(0, 2, 4, 6);
  return { count, pos, nrm, v, bandA, bandB, cap, scaleParam: "radius" };
}

/**
 * An open two-point strip of unit width, centred on the path and lying
 * along the ring's first basis axis, facing the second. A ribbon has no
 * inside, so it takes no cap and is SINGLE-SIDED: it is invisible from
 * below under a front-face material.
 *
 * The band runs 1 -> 0, against the entries' own order, and that is
 * load-bearing rather than a typo. A band's face normal is
 * `travel x ringNormal`, and the ring basis is right-handed
 * (`e1 x e2 = n`), so travel along `+e1` faces `-e2` while the strip is
 * declared to face `+e2`. Stitching the other way round is what makes
 * the winding agree with the normal this profile writes; `v` stays with
 * its entry, so the texture direction does not move.
 */
function ribbonProfile(): ProfileSpec {
  return {
    count: 2,
    pos: Float64Array.of(-0.5, 0, 0.5, 0),
    nrm: Float64Array.of(0, 1, 0, 1),
    v: Float64Array.of(0, 1),
    bandA: Uint32Array.of(1),
    bandB: Uint32Array.of(0),
    cap: new Uint32Array(0),
    scaleParam: "width",
  };
}

/** The three shipped cross-sections; a fourth needs a consumer, not a guess. */
const PROFILES = ["circle", "square", "ribbon"] as const;
/** How a ring meets the next one through a bend. */
const JOINTS = ["miter", "perpendicular"] as const;
/** Where the roll inside the ring plane comes from. */
const FRAMES = ["upHint", "curveFrame", "rot"] as const;

/**
 * Unit direction of every segment of one path, plus the nearest-nonzero
 * lookups either side of it.
 *
 * Zero-length segments are real (two path points landing on top of each
 * other survives every filter in the library) and a zero segment has no
 * direction. Rather than invent one per ring, the nearest segment that
 * DOES have a direction stands in, which keeps the ring plane defined and
 * the emitted band degenerate — a zero-area triangle, which area-weighted
 * sampling and the raycast mapping already skip — instead of producing a
 * NaN frame that poisons the whole path.
 */
interface SegmentDirs {
  readonly dir: Float64Array;
  readonly fwd: Int32Array;
  readonly bwd: Int32Array;
  /** Index of the first / last segment with a direction, or -1 for none. */
  readonly first: number;
  readonly last: number;
}

function segmentDirs(table: PolylineArcTable): SegmentDirs {
  const nSeg = table.segLen.length;
  const dir = new Float64Array(nSeg * 3);
  const fwd = new Int32Array(nSeg);
  const bwd = new Int32Array(nSeg);
  for (let k = 0; k < nSeg; k++) {
    const len = table.segLen[k];
    if (len === 0) continue;
    const inv = 1 / len;
    dir[k * 3] = table.segDir[k * 3] * inv;
    dir[k * 3 + 1] = table.segDir[k * 3 + 1] * inv;
    dir[k * 3 + 2] = table.segDir[k * 3 + 2] * inv;
  }
  let run = -1;
  for (let k = nSeg - 1; k >= 0; k--) {
    if (table.segLen[k] > 0) run = k;
    fwd[k] = run;
  }
  const first = nSeg > 0 ? fwd[0] : -1;
  run = -1;
  for (let k = 0; k < nSeg; k++) {
    if (table.segLen[k] > 0) run = k;
    bwd[k] = run;
  }
  const last = nSeg > 0 ? bwd[nSeg - 1] : -1;
  return { dir, fwd, bwd, first, last };
}

/** Per-path bookkeeping shared by the counting pass and the writing pass. */
interface SweepLayout {
  readonly table: PolylineArcTable;
  readonly dirs: SegmentDirs;
  /** Rings emitted: a closed path shares its first and last. */
  readonly rings: number;
  /** Ring-to-ring bands: `rings` when closed, `rings - 1` when open. */
  readonly bands: number;
  readonly caps: boolean;
  /** First output point of this path's ring block. */
  readonly pointBase: number;
  /** First output point of the start cap block (`-1` when uncapped). */
  readonly capStart: number;
  readonly capEnd: number;
}

/**
 * Rotate a profile entry by `roll` turns about the ring normal, in the
 * ring's own 2D basis. Written as a free function because it runs once
 * per profile entry per ring and must not allocate.
 */
function rollApply(out: number[], a1: number, a2: number, c: number, s: number): void {
  out[0] = a1 * c - a2 * s;
  out[1] = a1 * s + a2 * c;
}

/** Params of {@link sweepProfile}. */
export interface SweepProfileParams {
  profile: string;
  sides: number;
  radius: FieldParam;
  width: FieldParam;
  frame: string;
  up: FieldParam;
  roll: FieldParam;
  joint: string;
  miterLimit: number;
  caps: boolean;
}

/** A cross-section placed on every path point and stitched into a surface. */
export const sweepProfile = standardNode<SweepProfileParams>({
  type: "sweepProfile",
  category: "surface",
  description:
    "Places a cross-section on EVERY POINT of every polyline primitive and stitches consecutive placements into 3-vertex 'poly' triangles: a curve becomes a surface. This is what `pathSegments` could only fake — a run of overlapping instanced cylinders becomes one continuous skin, at HALF the drawn triangles of the eight-sided instanced tube it replaces, because rings are shared between segments and no interior caps grow. THE PATH IS NOT RESAMPLED: one ring per input point, exactly where the point is, so a field-capable `radius` resolves at the ring rather than being averaged across a segment's endpoints the way pathSegments must. Run `pathResample` first for a finer surface. Output carries P, a `normal` (f32 tuple 3) and a `uv` (f32 tuple 2) the node writes itself — `u` is normalized arc length along the path, matching the `curveU` that pathSegments and pathPointAt write, and `v` runs around the profile — plus every INPUT POINT attribute copied (not interpolated) around each ring, and every input PRIMITIVE attribute gathered onto the triangles that came from it, so a per-path `roadWidth` or `chordPick` survives the sweep and a primitive-domain filter downstream can still see it. Input VERTEX attributes are dropped: the topology they described is gone. `normal` and `uv` are reporting slots — an input already carrying either at a different shape is REFUSED by name rather than silently deleted. Open versus closed is structural and needs no flag: a closed path shares its first and last ring so the tube closes on itself exactly (which means `u` returns to 0 across that one closing band — a texture measured along `u` repeats backwards there, the price of a genuinely closed tube), and `caps` applies only to an OPEN path with a CLOSED profile, since a closed path has no ends and a ribbon has no hole. Roll around the path is fixed by `frame` and never by chance. Junctions are NOT solved: where several polylines share an endpoint each is swept independently and the surfaces overlap, which is what every mitered-stroke renderer does by default.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    profile: {
      type: "enum",
      default: "circle",
      enum: [...PROFILES],
      description:
        "Cross-section shape. 'circle' and 'square' are CLOSED (a tube, and a square rod whose four faces stay flat because its corners carry per-face normals) and take `radius` and `caps`; 'ribbon' is OPEN — a flat two-point strip of `width`, centred on the path, facing the frame's up axis — and takes neither, because a strip has no inside. A profile from a second geometry pin (an I-beam, a kerb) is deliberately not here yet: it forces four decisions no consumer has asked for, and these enum values stay valid when it arrives.",
    },
    sides: {
      type: "i32",
      default: 8,
      min: 3,
      max: 256,
      description:
        "Points around a 'circle' profile; ignored by the other two. Default 8 matches the shipped tube asset (a three.js CylinderGeometry with 8 radial segments), so a swept tube reads like the instanced tube it replaces. Cost is linear: the ring emits `sides + 1` points (the extra one duplicates the seam so the uv does not run backwards across one column of quads) and `sides * 2` triangles per band.",
    },
    radius: {
      type: "f32",
      default: 0.05,
      min: 0,
      acceptsField: true,
      description:
        "Distance from the path to the surface, in world units, for the 'circle' and 'square' profiles ('square' reads it as HALF-WIDTH, so the section fits a 2 x radius box). Same default as pathSegments' `radius`. Field-capable and resolved on the INPUT points — the path's own points, which is exactly where a ring sits — so a taper is exact rather than averaged. A per-path radius living on the primitive domain has to be promoted onto the points first (promoteAttribute, primitive to point) before a field can see it.",
    },
    width: {
      type: "f32",
      default: 1,
      min: 0,
      acceptsField: true,
      description:
        "Full width of a 'ribbon' profile in world units (the strip runs from -width/2 to +width/2 across the path); ignored by the closed profiles. Field-capable on the INPUT points, so a road that widens at a junction is one promoted attribute away.",
    },
    frame: {
      type: "enum",
      default: "upHint",
      enum: [...FRAMES],
      description:
        "Where the ROLL inside the ring comes from. The ring's PLANE always comes from the path, so this never changes where the surface is, only how the profile is turned within it — which is invisible for a circle and decisive for a square or a ribbon. 'upHint' uses the `up` param through the same deterministic construction (and the same [0,0,1] then [1,0,0] fallbacks) orientAlongVector and pathSegments use: purely local, correct for a tube and for a flat road ribbon, wrong for a ribbon on a curve that turns over. 'curveFrame' reads the `curveNormal` point attribute writeCurveFrame writes — a rotation-minimizing frame carried ALONG the curve, which is what a ribbon on a twisting path needs; `curveBinormal` is not read, the second axis is derived so the ring stays right-handed. 'rot' reads the standard `rot` quaternion's local +X, so anything that writes `rot` (orientAlongVector, with its field-capable direction and up) drives the roll. Both attribute modes fall back to `up` at a point whose attribute is degenerate. This node TRANSPORTS nothing along the path: the ring plane reads only the two segments meeting at its own point (a one-neighbour rule, the same reach writeTangents has) and no mode carries a value forward, so the only non-locality in a swept surface is whatever the attribute it was handed already had — 'curveFrame' inherits the non-locality writeCurveFrame documents, and nothing more.",
    },
    up: {
      type: "vec3",
      default: [0, 1, 0],
      acceptsField: true,
      description:
        "Up hint fixing the roll in 'upHint' mode, and the fallback in the other two; need not be unit length. When parallel or antiparallel to the path direction (or zero) it deterministically falls back to [0, 0, 1], then [1, 0, 0] — the same contract orientAlongVector and pathSegments state, through the same shared code, so a vertical path's roll is arbitrary but never random. Field-capable on the input points.",
    },
    roll: {
      type: "f32",
      default: 0,
      acceptsField: true,
      description:
        "Turns of the profile about the path direction, applied inside the ring plane on top of `frame` — 0.25 is a quarter turn, 1 is a full one. Field-capable on the input points, so a value that ramps along the path twists the section. Invisible on a 'circle' (it is rotationally symmetric) and the reason a 'square' or 'ribbon' can be aimed without changing the frame.",
    },
    joint: {
      type: "enum",
      default: "miter",
      enum: [...JOINTS],
      description:
        "How the section meets a bend. Both modes put the ring in the plane that BISECTS the two segments meeting at the point; they differ in whether the section is corrected for the tilt. 'miter' stretches the ring by 1/cos(half the turn angle) along the bend direction, which is exactly the ellipse a cylinder cuts on that plane, so the tube keeps its radius through the corner. 'perpendicular' leaves it, so the section thins by cos(half the turn angle) — 33% at a 96-degree bend, which is visible. Miter self-intersects only when the mitered half-width exceeds half the shorter segment; `miterLimit` is what refuses that.",
    },
    miterLimit: {
      type: "f32",
      default: 4,
      min: 1,
      description:
        "Largest stretch 'miter' may apply. Past it the ring falls back to the unstretched 'perpendicular' section for that point ONLY, which pinches rather than shooting a spike out of the corner. A stretch of 4 is a 151-degree turn; the limit is never reached by a path that was resampled at anything like an even spacing, and exists for the pathological input that would otherwise self-intersect. Ignored by 'perpendicular'.",
    },
    caps: {
      type: "bool",
      default: true,
      description:
        "Close the two ends of an OPEN path with a CLOSED profile, as a triangle fan from the path's endpoint. Ignored for a closed path (it has no ends) and for the 'ribbon' profile (it has no hole), so all four combinations are defined rather than merely unsurprising. Cap points are separate from the wall's, so the seam between a flat cap and a round wall stays a real crease instead of being smoothed away. Cap uv is a disc mapping — the unit section mapped into the 0..1 square — not a continuation of the wall's.",
    },
  },
  // `radius`, `width`, `up` and `roll` may resolve on the GPU. All four
  // are evaluated on the INPUT geometry, which this node never mutates
  // (it builds a fresh mesh), so the resolver and the CPU fallback see
  // identical bytes. Not `resident`: a resident node must be
  // element-count-preserving on a single geometry input, and a sweep
  // multiplies the point count, creates a primitive domain and writes
  // three topology arrays — none of which is device-resident anywhere.
  gpu: "fields",
  async execute({ inputs, params, seed, gpu, checkCancelled }) {
    const profileName = params.profile;
    if (!(PROFILES as readonly string[]).includes(profileName)) {
      throw new Error(
        `sweepProfile: param "profile" must be one of ${PROFILES.join(", ")}; got "${profileName}"`,
      );
    }
    const frameMode = params.frame;
    if (!(FRAMES as readonly string[]).includes(frameMode)) {
      throw new Error(
        `sweepProfile: param "frame" must be one of ${FRAMES.join(", ")}; got "${frameMode}"`,
      );
    }
    const jointMode = params.joint;
    if (!(JOINTS as readonly string[]).includes(jointMode)) {
      throw new Error(
        `sweepProfile: param "joint" must be one of ${JOINTS.join(", ")}; got "${jointMode}"`,
      );
    }
    if (!Number.isInteger(params.sides) || params.sides < 3 || params.sides > 256) {
      throw new Error(
        `sweepProfile: param "sides" must be a whole number in [3, 256] (points around a 'circle' profile), got ${params.sides}`,
      );
    }
    if (!Number.isFinite(params.miterLimit) || params.miterLimit < 1) {
      throw new Error(
        `sweepProfile: param "miterLimit" must be a finite number >= 1 (a limit below 1 would shrink every joint), got ${params.miterLimit}`,
      );
    }

    const src = requireGeometry(inputs, "in", "sweepProfile");
    // `normal` and `uv` are this node's own shapes, not the author's, so a
    // differently shaped column under either name is refused rather than
    // deleted and re-added — the same rule writeTangents and
    // writeCurveFrame follow, checked against the INPUT because every
    // input point attribute is copied around the rings.
    requireReportSlot({
      attrs: src.attrs.point,
      nodeType: "sweepProfile",
      param: "normal",
      name: "normal",
      type: "f32",
      tupleSize: 3,
      domain: "point",
      suggestion: "inNormal",
    });
    requireReportSlot({
      attrs: src.attrs.point,
      nodeType: "sweepProfile",
      param: "uv",
      name: "uv",
      type: "f32",
      tupleSize: 2,
      domain: "point",
      suggestion: "inUv",
    });

    const tables = polylineArcTables(src, "sweepProfile");
    const profile =
      profileName === "circle"
        ? circleProfile(params.sides)
        : profileName === "square"
          ? squareProfile()
          : ribbonProfile();
    const capable = profile.cap.length > 0 && params.caps;
    // Every field-capable param resolves BEFORE anything is written, on
    // the untouched input, so the GPU and CPU paths read the same bytes.
    // Which param sets the ring's size is the profile's own business —
    // a closed section has a radius, an open strip has a width.
    const scaleCol = requireTuple(
      await resolveOnMaybeGpu(
        gpu,
        src,
        "point",
        profile.scaleParam === "width" ? params.width : params.radius,
        seed,
        "sweepProfile",
        profile.scaleParam,
      ),
      [1],
      "sweepProfile",
      profile.scaleParam,
    );
    const rollCol = requireTuple(
      await resolveOnMaybeGpu(gpu, src, "point", params.roll, seed, "sweepProfile", "roll"),
      [1],
      "sweepProfile",
      "roll",
    );
    const upIsField = isField(params.up);
    let upCol: Column | undefined;
    let upx = 0;
    let upy = 1;
    let upz = 0;
    if (upIsField) {
      upCol = requireTuple(
        await resolveOnMaybeGpu(gpu, src, "point", params.up, seed, "sweepProfile", "up"),
        [1, 3],
        "sweepProfile",
        "up",
      );
    } else {
      const up = params.up;
      if (!Array.isArray(up) || up.length !== 3 || !up.every((v) => Number.isFinite(v))) {
        throw new Error(
          'sweepProfile: param "up" must be an array of 3 finite numbers (e.g. [0, 1, 0])',
        );
      }
      const lenSq = up[0] * up[0] + up[1] * up[1] + up[2] * up[2];
      const inv = lenSq > 0 ? 1 / Math.sqrt(lenSq) : 0;
      upx = up[0] * inv;
      upy = up[1] * inv;
      upz = up[2] * inv;
    }

    // Frame sources, read once. A missing column is not fatal: the ring
    // falls back to the up hint, and the message only fires when the
    // author asked for a mode whose attribute is nowhere at all.
    const frameAttr =
      frameMode === "curveFrame"
        ? src.attrs.point.get("curveNormal")
        : frameMode === "rot"
          ? src.attrs.point.get("rot")
          : undefined;
    if (frameMode !== "upHint" && frameAttr === undefined) {
      throw new Error(
        frameMode === "curveFrame"
          ? 'sweepProfile: frame "curveFrame" reads the "curveNormal" point attribute and the input has none; run writeCurveFrame on the path first (it writes curveNormal, curveBinormal and tangent together), or use frame "upHint"'
          : 'sweepProfile: frame "rot" reads the standard "rot" point attribute and the input has none; run orientAlongVector on the path first, or use frame "upHint"',
      );
    }
    const frameTuple = frameMode === "rot" ? 4 : 3;
    if (frameAttr !== undefined && (frameAttr.type !== "f32" || frameAttr.tupleSize < frameTuple)) {
      throw new Error(
        `sweepProfile: frame "${frameMode}" needs the "${frameAttr.name}" point attribute to be f32 with at least ${frameTuple} components, but it is ${frameAttr.type} with ${frameAttr.tupleSize}`,
      );
    }

    // Pass one: lay the output out. Purely combinatorial, so the writing
    // pass below can index straight into the blocks it names.
    const layouts: SweepLayout[] = [];
    let nPoints = 0;
    let nTris = 0;
    for (const table of tables) {
      const nv = table.points.length;
      const rings = table.closed ? nv - 1 : nv;
      if (rings < 2) continue;
      const dirs = segmentDirs(table);
      if (dirs.first < 0) continue; // every segment degenerate: no direction anywhere
      const bands = table.closed ? rings : rings - 1;
      const caps = capable && !table.closed;
      const pointBase = nPoints;
      nPoints += rings * profile.count;
      const capStart = caps ? nPoints : -1;
      if (caps) nPoints += profile.cap.length + 1;
      const capEnd = caps ? nPoints : -1;
      if (caps) nPoints += profile.cap.length + 1;
      nTris += bands * profile.bandA.length * 2 + (caps ? 2 * profile.cap.length : 0);
      layouts.push({ table, dirs, rings, bands, caps, pointBase, capStart, capEnd });
    }
    if (nTris === 0) {
      throw new Error(
        `sweepProfile: none of the input's ${tables.length} path(s) can be swept — a path needs at least 2 distinct points and at least one segment of nonzero length. Drop the degenerate paths upstream, or move the points apart.`,
      );
    }

    // Which input point every output point came from, in write order.
    // This is the whole attribute story on the point domain: one gather,
    // no interpolation, values replicated around each ring.
    const srcPoint = new Uint32Array(nPoints);
    const v2p = new Uint32Array(nTris * 3);
    const primStart = new Uint32Array(nTris);
    const primCount = new Uint32Array(nTris);
    const primSrc = new Uint32Array(nTris);
    {
      let t = 0;
      for (const L of layouts) {
        const pts = L.table.points;
        for (let k = 0; k < L.rings; k++) {
          const base = L.pointBase + k * profile.count;
          for (let i = 0; i < profile.count; i++) srcPoint[base + i] = pts[k];
        }
        for (let k = 0; k < L.bands; k++) {
          const a = L.pointBase + k * profile.count;
          const b = L.pointBase + ((k + 1) % L.rings) * profile.count;
          for (let e = 0; e < profile.bandA.length; e++) {
            const i0 = profile.bandA[e];
            const i1 = profile.bandB[e];
            v2p[t * 3] = a + i0;
            v2p[t * 3 + 1] = a + i1;
            v2p[t * 3 + 2] = b + i0;
            primSrc[t++] = L.table.prim;
            v2p[t * 3] = a + i1;
            v2p[t * 3 + 1] = b + i1;
            v2p[t * 3 + 2] = b + i0;
            primSrc[t++] = L.table.prim;
          }
        }
        if (L.caps) {
          const nc = profile.cap.length;
          for (let c = 0; c < nc; c++) {
            srcPoint[L.capStart + c] = pts[0];
            srcPoint[L.capEnd + c] = pts[L.rings - 1];
          }
          srcPoint[L.capStart + nc] = pts[0];
          srcPoint[L.capEnd + nc] = pts[L.rings - 1];
          // The start cap faces backwards along the path, the end cap
          // forwards, so their fans wind opposite ways.
          for (let c = 0; c < nc; c++) {
            const d = (c + 1) % nc;
            v2p[t * 3] = L.capStart + nc;
            v2p[t * 3 + 1] = L.capStart + d;
            v2p[t * 3 + 2] = L.capStart + c;
            primSrc[t++] = L.table.prim;
          }
          for (let c = 0; c < nc; c++) {
            const d = (c + 1) % nc;
            v2p[t * 3] = L.capEnd + nc;
            v2p[t * 3 + 1] = L.capEnd + c;
            v2p[t * 3 + 2] = L.capEnd + d;
            primSrc[t++] = L.table.prim;
          }
        }
      }
      for (let i = 0; i < nTris; i++) {
        primStart[i] = i * 3;
        primCount[i] = 3;
      }
    }

    const out = new Geometry();
    copyElements(src.attrs.point, out.attrs.point, srcPoint, nPoints);
    const P = out.attrs.point.require("P");
    const pOut = P.data;
    const pStride = P.tupleSize;
    const normal = out.attrs.point.replace("normal", "f32", 3, [0, 0, 0]).data;
    const uv = out.attrs.point.replace("uv", "f32", 2, [0, 0]).data;

    const srcP = src.attrs.point.require("P");
    const pd = srcP.data;
    const ps = srcP.tupleSize;
    const fd = frameAttr?.data;
    const fs = frameAttr?.tupleSize ?? 0;

    const q: number[] = [0, 0, 0, 1];
    const e1: number[] = [0, 0, 0];
    const e2: number[] = [0, 0, 0];
    const rp: number[] = [0, 0];
    const rn: number[] = [0, 0];
    let rings = 0;
    for (const L of layouts) {
      const table = L.table;
      const pts = table.points;
      const dirs = L.dirs;
      const nSeg = table.segLen.length;
      const arc = table.length;
      for (let k = 0; k < L.rings; k++) {
        if ((rings++ & (CANCEL_STRIDE - 1)) === 0) checkCancelled();
        const pi = pts[k];
        const po = pi * ps;
        // Outgoing and incoming unit directions, standing in from the
        // nearest segment that has one.
        let outIdx = k < nSeg ? dirs.fwd[k] : -1;
        if (outIdx < 0) outIdx = table.closed ? dirs.first : dirs.last;
        let inIdx = k > 0 ? dirs.bwd[k - 1] : table.closed ? dirs.last : -1;
        if (inIdx < 0) inIdx = table.closed ? dirs.last : dirs.first;
        const ox = dirs.dir[outIdx * 3];
        const oy = dirs.dir[outIdx * 3 + 1];
        const oz = dirs.dir[outIdx * 3 + 2];
        const ix = dirs.dir[inIdx * 3];
        const iy = dirs.dir[inIdx * 3 + 1];
        const iz = dirs.dir[inIdx * 3 + 2];
        // The ring plane bisects the two segments. For equal-length
        // segments this is the central-difference tangent writeTangents
        // computes; unlike it, the TRUE bisector makes the miter exact
        // (both cylinders cut the same ellipse on this plane) whatever
        // the two segment lengths are.
        let nx = ix + ox;
        let ny = iy + oy;
        let nz = iz + oz;
        let nl = nx * nx + ny * ny + nz * nz;
        if (nl <= 1e-12) {
          // A hairpin: the two segments are antiparallel and bisect
          // nothing. The outgoing direction stands in, unmitered.
          nx = ox;
          ny = oy;
          nz = oz;
          nl = 1;
        } else {
          const inv = 1 / Math.sqrt(nl);
          nx *= inv;
          ny *= inv;
          nz *= inv;
        }
        // Miter: stretch along the in-plane bend direction, which is
        // parallel to (out - in) and perpendicular to the bisector.
        let mx = 0;
        let my = 0;
        let mz = 0;
        let stretch = 0;
        if (jointMode === "miter") {
          const cosHalf = nx * ox + ny * oy + nz * oz;
          const ms = cosHalf > 0 ? 1 / cosHalf : 0;
          if (ms > 1 && ms <= params.miterLimit) {
            let wx = ox - ix;
            let wy = oy - iy;
            let wz = oz - iz;
            const wl = wx * wx + wy * wy + wz * wz;
            if (wl > 1e-12) {
              const inv = 1 / Math.sqrt(wl);
              wx *= inv;
              wy *= inv;
              wz *= inv;
              mx = wx;
              my = wy;
              mz = wz;
              stretch = ms - 1;
            }
          }
        }

        // The roll axes. The plane is fixed above; `frame` only decides
        // where inside it the profile's first axis points.
        let ax = 0;
        let ay = 0;
        let az = 0;
        let have = false;
        if (frameAttr !== undefined && fd !== undefined) {
          const fo = pi * fs;
          if (frameMode === "curveFrame") {
            ax = fd[fo];
            ay = fd[fo + 1];
            az = fd[fo + 2];
          } else {
            // rot's local +X, without materializing the whole basis.
            rotateVec(e1, fd[fo], fd[fo + 1], fd[fo + 2], fd[fo + 3], 1, 0, 0);
            ax = e1[0];
            ay = e1[1];
            az = e1[2];
          }
          // Gram-Schmidt into the ring plane.
          const d = ax * nx + ay * ny + az * nz;
          ax -= nx * d;
          ay -= ny * d;
          az -= nz * d;
          const al = ax * ax + ay * ay + az * az;
          if (al > 1e-12) {
            const inv = 1 / Math.sqrt(al);
            e1[0] = ax * inv;
            e1[1] = ay * inv;
            e1[2] = az * inv;
            e2[0] = ny * e1[2] - nz * e1[1];
            e2[1] = nz * e1[0] - nx * e1[2];
            e2[2] = nx * e1[1] - ny * e1[0];
            have = true;
          }
        }
        if (!have) {
          let ux = upx;
          let uy = upy;
          let uz = upz;
          if (upCol !== undefined) {
            ux = readComp(upCol, pi, 0);
            uy = readComp(upCol, pi, 1);
            uz = readComp(upCol, pi, 2);
            const ul = ux * ux + uy * uy + uz * uz;
            const inv = ul > 0 ? 1 / Math.sqrt(ul) : 0;
            ux *= inv;
            uy *= inv;
            uz *= inv;
          }
          // Local +Z onto the ring normal, through the one place the
          // library builds an orientation from a direction — so the up
          // fallbacks are the shared contract, not a second copy of it.
          orientQuat(q, nx, ny, nz, ux, uy, uz, "+z");
          rotateVec(e1, q[0], q[1], q[2], q[3], 1, 0, 0);
          rotateVec(e2, q[0], q[1], q[2], q[3], 0, 1, 0);
        }

        const scale = readComp(scaleCol, pi, 0);
        const turns = readComp(rollCol, pi, 0);
        const rc = Math.cos(2 * Math.PI * turns);
        const rsn = Math.sin(2 * Math.PI * turns);
        const u = arc > 0 ? table.cum[k] / arc : 0;
        const base = L.pointBase + k * profile.count;
        for (let i = 0; i < profile.count; i++) {
          rollApply(rp, profile.pos[i * 2], profile.pos[i * 2 + 1], rc, rsn);
          rollApply(rn, profile.nrm[i * 2], profile.nrm[i * 2 + 1], rc, rsn);
          let vx = (rp[0] * e1[0] + rp[1] * e2[0]) * scale;
          let vy = (rp[0] * e1[1] + rp[1] * e2[1]) * scale;
          let vz = (rp[0] * e1[2] + rp[1] * e2[2]) * scale;
          if (stretch !== 0) {
            const along = vx * mx + vy * my + vz * mz;
            vx += mx * along * stretch;
            vy += my * along * stretch;
            vz += mz * along * stretch;
          }
          const o = (base + i) * pStride;
          pOut[o] = pd[po] + vx;
          pOut[o + 1] = pd[po + 1] + vy;
          pOut[o + 2] = pd[po + 2] + vz;
          const no = (base + i) * 3;
          normal[no] = rn[0] * e1[0] + rn[1] * e2[0];
          normal[no + 1] = rn[0] * e1[1] + rn[1] * e2[1];
          normal[no + 2] = rn[0] * e1[2] + rn[1] * e2[2];
          uv[(base + i) * 2] = u;
          uv[(base + i) * 2 + 1] = profile.v[i];
        }

        // Caps reuse the ring just built, so a cap point sits exactly on
        // its wall neighbour; only the normal and the uv differ.
        if (L.caps && (k === 0 || k === L.rings - 1)) {
          const capBase = k === 0 ? L.capStart : L.capEnd;
          const sign = k === 0 ? -1 : 1;
          const nc = profile.cap.length;
          for (let c = 0; c < nc; c++) {
            const i = profile.cap[c];
            const from = (base + i) * pStride;
            const o = (capBase + c) * pStride;
            pOut[o] = pOut[from];
            pOut[o + 1] = pOut[from + 1];
            pOut[o + 2] = pOut[from + 2];
            const no = (capBase + c) * 3;
            normal[no] = nx * sign;
            normal[no + 1] = ny * sign;
            normal[no + 2] = nz * sign;
            // A disc mapping over the UNIT section, so cap uv does not
            // move when the radius does.
            rollApply(rp, profile.pos[i * 2], profile.pos[i * 2 + 1], rc, rsn);
            uv[(capBase + c) * 2] = 0.5 + 0.5 * rp[0];
            uv[(capBase + c) * 2 + 1] = 0.5 + 0.5 * rp[1];
          }
          const co = (capBase + nc) * pStride;
          pOut[co] = pd[po];
          pOut[co + 1] = pd[po + 1];
          pOut[co + 2] = pd[po + 2];
          const cno = (capBase + nc) * 3;
          normal[cno] = nx * sign;
          normal[cno + 1] = ny * sign;
          normal[cno + 2] = nz * sign;
          uv[(capBase + nc) * 2] = 0.5;
          uv[(capBase + nc) * 2 + 1] = 0.5;
        }
      }
    }

    out.setTopology(v2p, primStart, primCount);
    out.attrs.primitive.add(PRIMTYPE_ATTR, "string", 1, "poly" satisfies PrimType);
    carryPrimitiveAttributes(
      src.attrs.primitive,
      out.attrs.primitive,
      primSrc,
      "sweepProfile",
      "primitive",
    );
    copyElements(src.attrs.detail, out.attrs.detail, undefined, src.attrs.detail.count);
    return { out: [makeGeometryItem(out)] };
  },
});

/** Which way an extrusion goes. */
const EXTRUDE_DIRECTIONS = ["+y", "vector", "polygonNormal"] as const;
/** Which ends of an extrusion are closed. */
const EXTRUDE_CAPS = ["none", "top", "bottom", "both"] as const;

/** Per-polygon bookkeeping shared by the counting pass and the writing pass. */
interface ExtrudeLayout {
  readonly table: PolylineArcTable;
  /** Distinct boundary points (the closing repeat is not one of them). */
  readonly corners: number;
  /** Unit extrusion direction of THIS polygon. */
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  /** Newell normal of the footprint, UNNORMALIZED (zero when degenerate). */
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  /** +1 when the boundary winds counter-clockwise about the direction. */
  readonly wind: number;
  /**
   * +1 when the solid is built ALONG the direction, -1 when a negative
   * `distance` puts it on the other side. Every winding decision is made
   * against `wind * hsign` so a downward extrusion comes out facing
   * outward rather than inside out; the wall NORMALS stay on `wind`
   * alone, because a wall's outward direction is away from the footprint
   * interior whichever side the solid is on.
   */
  readonly hsign: number;
  readonly wallBase: number;
  readonly bottomBase: number;
  readonly topBase: number;
}

/** Params of {@link extrudePolygon}. */
export interface ExtrudePolygonParams {
  distance: FieldParam;
  direction: string;
  vector: readonly number[];
  caps: string;
  sides: boolean;
}

/** A closed footprint swept along a direction into a solid. */
export const extrudePolygon = standardNode<ExtrudePolygonParams>({
  type: "extrudePolygon",
  category: "surface",
  description:
    "Treats every CLOSED polyline primitive as a polygon boundary and sweeps it along a direction into 3-vertex 'poly' triangles: a footprint becomes massing, a boundary loop becomes a wall. This is the node a pipeline that already computed its plots has been waiting for — a closed quad per lot renders as four hairlines until something gives it a third dimension. Output carries P, a `normal` (f32 tuple 3) and a `uv` (f32 tuple 2) the node writes itself, plus every INPUT POINT attribute copied onto the points that came from it and every input PRIMITIVE attribute gathered onto the triangles, so a per-lot `lotId` or `districtKind` survives; input VERTEX attributes are dropped. `normal` and `uv` are reporting slots — an input already carrying either at a different shape is REFUSED by name rather than silently deleted. On the walls `u` runs 0..1 around the boundary by ARC LENGTH (so a plot with one long side does not stretch its texture there) and `v` 0..1 from bottom to top; on the caps both run 0..1 across the footprint's own bounding box in the plane perpendicular to the direction. Walls, top cap and bottom cap keep SEPARATE points, so the edge where a roof meets a wall stays a crease instead of being shaded round. Caps are fan-triangulated from the boundary's first point, which is exact for a CONVEX footprint and is all the topology records — a concave footprint gets triangles outside itself, so subdivide it upstream. An OPEN polyline is refused by name: extrusion is not defined on one, and the fix is pointsToPath with `closed: true`. Winding is derived from the polygon's own Newell normal against the direction and against the sign of `distance`, so a footprint wound either way, extruded either way, comes out facing outward.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    distance: {
      type: "f32",
      default: 3,
      acceptsField: true,
      description:
        "How far the boundary travels along the direction, in world units. Field-capable and resolved on the INPUT points — the footprint's own points — so a per-point value gives a sloped top rather than a flat one, and a per-lot height living on the primitive domain becomes a field once promoteAttribute has put it on the points. A negative distance builds the solid on the OTHER side of the footprint and still comes out facing outward — the winding flips with it. A footprint whose distances straddle zero is a bowtie and has no outward side; the sign of their sum decides, which is total rather than right.",
    },
    direction: {
      type: "enum",
      default: "+y",
      enum: [...EXTRUDE_DIRECTIONS],
      description:
        "Which way the boundary travels. '+y' is straight up, the answer for buildings and walls on a ground plane. 'vector' uses the `vector` param, normalized. 'polygonNormal' computes each polygon's OWN normal by Newell's method — a sum over the boundary edges, so it is exact for a planar polygon, deterministic, and defined for a non-planar one (it returns the best-fit plane's normal) — which is what extrudes a footprint that is not lying flat. A polygon whose Newell normal is zero (every point collinear, or zero area) is refused by primitive index.",
    },
    vector: {
      type: "vec3",
      default: [0, 1, 0],
      description:
        "Direction for the 'vector' mode; need not be unit length, and is normalized before use. Ignored by the other modes. A zero-length vector is refused rather than producing a flat sheet. Not field-capable on purpose: it names the direction of the whole extrusion, and a per-point one would not be a sweep — that is what `distance` is for.",
    },
    caps: {
      type: "enum",
      default: "both",
      enum: [...EXTRUDE_CAPS],
      description:
        "Which ends are closed. 'both' is a solid; 'bottom' or 'top' alone leaves an open shell (with `sides` false, 'top' is a floating lid — a roof with no building); 'none' with `sides` is a tube of wall. Each cap faces along its OWN plane's normal rather than along the direction, which is what makes a per-point `distance` shade as the sloped roof it actually builds, and what keeps a footprint lying in a tilted plane correct when it is extruded straight up.",
    },
    sides: {
      type: "bool",
      default: true,
      description:
        "Build the wall between the two ends. False keeps only the caps the `caps` param asked for, which is how a flat slab (`caps: 'bottom'`) or a floating roof (`caps: 'top'`) is spelled without a second node. False with `caps: 'none'` has nothing to build and is refused.",
    },
  },
  // `distance` may resolve on the GPU, evaluated on the INPUT geometry
  // which this node never mutates. Not `resident`: the element count
  // changes and topology is not device-resident.
  gpu: "fields",
  async execute({ inputs, params, seed, gpu, checkCancelled }) {
    const dirMode = params.direction;
    if (!(EXTRUDE_DIRECTIONS as readonly string[]).includes(dirMode)) {
      throw new Error(
        `extrudePolygon: param "direction" must be one of ${EXTRUDE_DIRECTIONS.join(", ")}; got "${dirMode}"`,
      );
    }
    const capMode = params.caps;
    if (!(EXTRUDE_CAPS as readonly string[]).includes(capMode)) {
      throw new Error(
        `extrudePolygon: param "caps" must be one of ${EXTRUDE_CAPS.join(", ")}; got "${capMode}"`,
      );
    }
    const wantBottom = capMode === "bottom" || capMode === "both";
    const wantTop = capMode === "top" || capMode === "both";
    const wantSides = params.sides;
    if (!wantSides && !wantBottom && !wantTop) {
      throw new Error(
        'extrudePolygon: params "sides" false and "caps" "none" leave nothing to build; turn one of them back on',
      );
    }

    let gx = 0;
    let gy = 1;
    let gz = 0;
    if (dirMode === "vector") {
      const v = params.vector;
      if (!Array.isArray(v) || v.length !== 3 || !v.every((c) => Number.isFinite(c))) {
        throw new Error(
          'extrudePolygon: param "vector" must be an array of 3 finite numbers (e.g. [0, 1, 0])',
        );
      }
      const lenSq = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
      if (lenSq === 0) {
        throw new Error(
          'extrudePolygon: param "vector" is [0, 0, 0], which names no direction; give it a nonzero vector, or use direction "+y" or "polygonNormal"',
        );
      }
      const inv = 1 / Math.sqrt(lenSq);
      gx = v[0] * inv;
      gy = v[1] * inv;
      gz = v[2] * inv;
    }

    const src = requireGeometry(inputs, "in", "extrudePolygon");
    requireReportSlot({
      attrs: src.attrs.point,
      nodeType: "extrudePolygon",
      param: "normal",
      name: "normal",
      type: "f32",
      tupleSize: 3,
      domain: "point",
      suggestion: "inNormal",
    });
    requireReportSlot({
      attrs: src.attrs.point,
      nodeType: "extrudePolygon",
      param: "uv",
      name: "uv",
      type: "f32",
      tupleSize: 2,
      domain: "point",
      suggestion: "inUv",
    });

    const tables = polylineArcTables(src, "extrudePolygon");
    const distCol = requireTuple(
      await resolveOnMaybeGpu(gpu, src, "point", params.distance, seed, "extrudePolygon", "distance"),
      [1],
      "extrudePolygon",
      "distance",
    );
    const srcP = src.attrs.point.require("P");
    const pd = srcP.data;
    const ps = srcP.tupleSize;

    const open = tables.filter((t) => !t.closed).map((t) => t.prim);
    if (open.length > 0) {
      throw new Error(
        `extrudePolygon: primitive(s) ${open.slice(0, 8).join(", ")}${open.length > 8 ? ", ..." : ""} of the input's ${tables.length} polyline(s) are OPEN, and extrusion is not defined on an open curve — there is no inside to fill and no boundary to close. Build the path with pointsToPath and \`closed: true\` (closure is structural: a closed polyline's last vertex references its own first point), or sweep it with sweepProfile instead.`,
      );
    }

    const layouts: ExtrudeLayout[] = [];
    let nPoints = 0;
    let nTris = 0;
    for (const table of tables) {
      const m = table.points.length - 1;
      if (m < 3) {
        throw new Error(
          `extrudePolygon: primitive ${table.prim} closes over only ${m} distinct point(s); a polygon boundary needs at least 3`,
        );
      }
      // Newell's normal: exact for a planar polygon, best-fit otherwise,
      // and a pure function of the boundary order — no Map, no sort.
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let i = 0; i < m; i++) {
        const a = table.points[i] * ps;
        const b = table.points[(i + 1) % m] * ps;
        nx += (pd[a + 1] - pd[b + 1]) * (pd[a + 2] + pd[b + 2]);
        ny += (pd[a + 2] - pd[b + 2]) * (pd[a] + pd[b]);
        nz += (pd[a] - pd[b]) * (pd[a + 1] + pd[b + 1]);
      }
      let dx = gx;
      let dy = gy;
      let dz = gz;
      if (dirMode === "polygonNormal") {
        const lenSq = nx * nx + ny * ny + nz * nz;
        if (lenSq === 0) {
          throw new Error(
            `extrudePolygon: direction "polygonNormal" needs primitive ${table.prim} to have an area, but its Newell normal is zero — every point is collinear, or they coincide. Use direction "+y" or "vector", or fix the footprint upstream.`,
          );
        }
        const inv = 1 / Math.sqrt(lenSq);
        dx = nx * inv;
        dy = ny * inv;
        dz = nz * inv;
      }
      const wind = nx * dx + ny * dy + nz * dz >= 0 ? 1 : -1;
      // Which SIDE the solid ends up on. Summed rather than sampled so a
      // per-point `distance` decides it as a whole; a footprint whose
      // distances straddle zero is a bowtie and has no outward side, so
      // any rule is arbitrary there and this one is at least total.
      let hsum = 0;
      for (let i = 0; i < m; i++) hsum += readComp(distCol, table.points[i], 0);
      const hsign = hsum >= 0 ? 1 : -1;
      const wallBase = nPoints;
      if (wantSides) {
        nPoints += m * 4;
        nTris += m * 2;
      }
      const bottomBase = wantBottom ? nPoints : -1;
      if (wantBottom) {
        nPoints += m;
        nTris += m - 2;
      }
      const topBase = wantTop ? nPoints : -1;
      if (wantTop) {
        nPoints += m;
        nTris += m - 2;
      }
      layouts.push({
        table,
        corners: m,
        dx,
        dy,
        dz,
        nx,
        ny,
        nz,
        wind,
        hsign,
        wallBase,
        bottomBase,
        topBase,
      });
    }

    const srcPoint = new Uint32Array(nPoints);
    const v2p = new Uint32Array(nTris * 3);
    const primStart = new Uint32Array(nTris);
    const primCount = new Uint32Array(nTris);
    const primSrc = new Uint32Array(nTris);
    {
      let t = 0;
      for (const L of layouts) {
        const m = L.corners;
        const pts = L.table.points;
        // Every winding decision runs off wind * hsign: the geometry
        // itself flips when the solid is built on the other side, so the
        // vertex order has to flip with it or the whole solid comes back
        // inside out.
        const emit = L.wind * L.hsign;
        if (wantSides) {
          for (let j = 0; j < m; j++) {
            const b = L.wallBase + j * 4;
            // [bottom j, bottom j+1, top j, top j+1] — the band's own
            // four points, so its face normal stays flat.
            srcPoint[b] = pts[j];
            srcPoint[b + 1] = pts[(j + 1) % m];
            srcPoint[b + 2] = pts[j];
            srcPoint[b + 3] = pts[(j + 1) % m];
            if (emit > 0) {
              v2p[t * 3] = b;
              v2p[t * 3 + 1] = b + 1;
              v2p[t * 3 + 2] = b + 2;
              primSrc[t++] = L.table.prim;
              v2p[t * 3] = b + 1;
              v2p[t * 3 + 1] = b + 3;
              v2p[t * 3 + 2] = b + 2;
              primSrc[t++] = L.table.prim;
            } else {
              v2p[t * 3] = b;
              v2p[t * 3 + 1] = b + 2;
              v2p[t * 3 + 2] = b + 1;
              primSrc[t++] = L.table.prim;
              v2p[t * 3] = b + 1;
              v2p[t * 3 + 1] = b + 2;
              v2p[t * 3 + 2] = b + 3;
              primSrc[t++] = L.table.prim;
            }
          }
        }
        if (wantBottom) {
          for (let j = 0; j < m; j++) srcPoint[L.bottomBase + j] = pts[j];
          // The bottom faces AGAINST the direction, so its fan winds
          // opposite the top's.
          for (let j = 1; j + 1 < m; j++) {
            v2p[t * 3] = L.bottomBase;
            v2p[t * 3 + 1] = L.bottomBase + (emit > 0 ? j + 1 : j);
            v2p[t * 3 + 2] = L.bottomBase + (emit > 0 ? j : j + 1);
            primSrc[t++] = L.table.prim;
          }
        }
        if (wantTop) {
          for (let j = 0; j < m; j++) srcPoint[L.topBase + j] = pts[j];
          for (let j = 1; j + 1 < m; j++) {
            v2p[t * 3] = L.topBase;
            v2p[t * 3 + 1] = L.topBase + (emit > 0 ? j : j + 1);
            v2p[t * 3 + 2] = L.topBase + (emit > 0 ? j + 1 : j);
            primSrc[t++] = L.table.prim;
          }
        }
      }
      for (let i = 0; i < nTris; i++) {
        primStart[i] = i * 3;
        primCount[i] = 3;
      }
    }

    const out = new Geometry();
    copyElements(src.attrs.point, out.attrs.point, srcPoint, nPoints);
    const P = out.attrs.point.require("P");
    const pOut = P.data;
    const pStride = P.tupleSize;
    const normal = out.attrs.point.replace("normal", "f32", 3, [0, 0, 0]).data;
    const uv = out.attrs.point.replace("uv", "f32", 2, [0, 0]).data;

    const q: number[] = [0, 0, 0, 1];
    const c1: number[] = [0, 0, 0];
    const c2: number[] = [0, 0, 0];
    // Wall normals of one polygon, computed before they are written so a
    // degenerate edge can borrow from a real one.
    let wallN = new Float64Array(0);
    let done = 0;
    for (const L of layouts) {
      if ((done & (CANCEL_STRIDE - 1)) === 0) checkCancelled();
      const m = L.corners;
      const pts = L.table.points;
      const { dx, dy, dz } = L;
      // The cap plane's basis, always: the degenerate-wall fallback below
      // borrows from it too. Same orientation construction, and the same
      // up fallbacks, every other frame in the library uses.
      orientQuat(q, dx, dy, dz, 0, 1, 0, "+z");
      rotateVec(c1, q[0], q[1], q[2], q[3], 1, 0, 0);
      rotateVec(c2, q[0], q[1], q[2], q[3], 0, 1, 0);
      if (wantSides) {
        if (wallN.length < m * 3) wallN = new Float64Array(m * 3);
        for (let j = 0; j < m; j++) {
          const a = pts[j] * ps;
          const b = pts[(j + 1) % m] * ps;
          // Outward wall normal: perpendicular to the edge and to the
          // direction, turned by the boundary's winding. It rides on
          // `wind` alone, NOT on `wind * hsign`: a wall faces away from
          // the footprint's interior whichever side the solid sits on.
          const ex = pd[b] - pd[a];
          const ey = pd[b + 1] - pd[a + 1];
          const ez = pd[b + 2] - pd[a + 2];
          const wx = ey * dz - ez * dy;
          const wy = ez * dx - ex * dz;
          const wz = ex * dy - ey * dx;
          const wl = wx * wx + wy * wy + wz * wz;
          const inv = wl > 0 ? L.wind / Math.sqrt(wl) : 0;
          wallN[j * 3] = wx * inv;
          wallN[j * 3 + 1] = wy * inv;
          wallN[j * 3 + 2] = wz * inv;
        }
        // A zero-length boundary edge (two footprint points on top of
        // each other) has no direction and so no normal. The band it
        // makes is zero-area and draws nothing, but a [0,0,0] normal in
        // the buffer renders BLACK under every lit material if anything
        // downstream welds or resamples it, so the nearest real normal
        // stands in — and if the whole boundary is degenerate, the cap
        // basis does, which is at least perpendicular to the direction.
        let lastGood = -1;
        for (let j = 0; j < m; j++) {
          if (wallN[j * 3] !== 0 || wallN[j * 3 + 1] !== 0 || wallN[j * 3 + 2] !== 0) {
            lastGood = j;
            break;
          }
        }
        if (lastGood < 0) {
          for (let j = 0; j < m; j++) {
            wallN[j * 3] = c1[0];
            wallN[j * 3 + 1] = c1[1];
            wallN[j * 3 + 2] = c1[2];
          }
        } else {
          // One wrapping pass from the first real normal fills every gap.
          for (let k = 0; k < m; k++) {
            const j = (lastGood + k) % m;
            if (wallN[j * 3] === 0 && wallN[j * 3 + 1] === 0 && wallN[j * 3 + 2] === 0) {
              const p = (j + m - 1) % m;
              wallN[j * 3] = wallN[p * 3];
              wallN[j * 3 + 1] = wallN[p * 3 + 1];
              wallN[j * 3 + 2] = wallN[p * 3 + 2];
            }
          }
        }
        const perimeter = L.table.length;
        const invPerimeter = perimeter > 0 ? 1 / perimeter : 0;
        for (let j = 0; j < m; j++) {
          const i0 = pts[j];
          const i1 = pts[(j + 1) % m];
          const a = i0 * ps;
          const b = i1 * ps;
          const h0 = readComp(distCol, i0, 0);
          const h1 = readComp(distCol, i1, 0);
          const base = L.wallBase + j * 4;
          // u by ARC LENGTH around the boundary, from the same table
          // every path node measures with — so an unevenly cornered plot
          // does not stretch its texture on the long walls. The closing
          // edge ends at 1 exactly rather than at cum[m] / perimeter.
          const u0 = L.table.cum[j] * invPerimeter;
          const u1 = j + 1 === m ? 1 : L.table.cum[j + 1] * invPerimeter;
          const wx = wallN[j * 3];
          const wy = wallN[j * 3 + 1];
          const wz = wallN[j * 3 + 2];
          for (let c = 0; c < 4; c++) {
            const top = c >= 2;
            const far = (c & 1) === 1;
            const s = far ? b : a;
            const h = (far ? h1 : h0) * (top ? 1 : 0);
            const o = (base + c) * pStride;
            pOut[o] = pd[s] + dx * h;
            pOut[o + 1] = pd[s + 1] + dy * h;
            pOut[o + 2] = pd[s + 2] + dz * h;
            const no = (base + c) * 3;
            normal[no] = wx;
            normal[no + 1] = wy;
            normal[no + 2] = wz;
            uv[(base + c) * 2] = far ? u1 : u0;
            uv[(base + c) * 2 + 1] = top ? 1 : 0;
          }
        }
      }
      if (wantBottom || wantTop) {
        // Cap normals come from the caps' OWN Newell normals, not from
        // the direction. Two things need that: a footprint lying in a
        // tilted plane extruded straight up has caps facing the tilt,
        // not the direction; and a per-point `distance` makes the top a
        // SLOPED plane, which is the whole reason the param is
        // field-capable — stamping `dir` there would light a ramped roof
        // as if it were flat. `wind * hsign` turns each outward.
        const face = L.wind * L.hsign;
        let bx = -L.nx;
        let by = -L.ny;
        let bz = -L.nz;
        let bl = bx * bx + by * by + bz * bz;
        if (bl > 0) {
          const inv = face / Math.sqrt(bl);
          bx *= inv;
          by *= inv;
          bz *= inv;
        } else {
          bx = -dx * L.hsign;
          by = -dy * L.hsign;
          bz = -dz * L.hsign;
        }
        // The top ring's own Newell normal, over the DISPLACED points.
        let tx = 0;
        let ty = 0;
        let tz = 0;
        if (wantTop) {
          for (let j = 0; j < m; j++) {
            const a = pts[j] * ps;
            const b = pts[(j + 1) % m] * ps;
            const ha = readComp(distCol, pts[j], 0);
            const hb = readComp(distCol, pts[(j + 1) % m], 0);
            const ax = pd[a] + dx * ha;
            const ay = pd[a + 1] + dy * ha;
            const az = pd[a + 2] + dz * ha;
            const bx2 = pd[b] + dx * hb;
            const by2 = pd[b + 1] + dy * hb;
            const bz2 = pd[b + 2] + dz * hb;
            tx += (ay - by2) * (az + bz2);
            ty += (az - bz2) * (ax + bx2);
            tz += (ax - bx2) * (ay + by2);
          }
          const tl = tx * tx + ty * ty + tz * tz;
          if (tl > 0) {
            const inv = face / Math.sqrt(tl);
            tx *= inv;
            ty *= inv;
            tz *= inv;
          } else {
            tx = dx * L.hsign;
            ty = dy * L.hsign;
            tz = dz * L.hsign;
          }
        }
        let min1 = Infinity;
        let max1 = -Infinity;
        let min2 = Infinity;
        let max2 = -Infinity;
        for (let j = 0; j < m; j++) {
          const a = pts[j] * ps;
          const s1 = pd[a] * c1[0] + pd[a + 1] * c1[1] + pd[a + 2] * c1[2];
          const s2 = pd[a] * c2[0] + pd[a + 1] * c2[1] + pd[a + 2] * c2[2];
          if (s1 < min1) min1 = s1;
          if (s1 > max1) max1 = s1;
          if (s2 < min2) min2 = s2;
          if (s2 > max2) max2 = s2;
        }
        const inv1 = max1 > min1 ? 1 / (max1 - min1) : 0;
        const inv2 = max2 > min2 ? 1 / (max2 - min2) : 0;
        for (let j = 0; j < m; j++) {
          const i0 = pts[j];
          const a = i0 * ps;
          const s1 = (pd[a] * c1[0] + pd[a + 1] * c1[1] + pd[a + 2] * c1[2] - min1) * inv1;
          const s2 = (pd[a] * c2[0] + pd[a + 1] * c2[1] + pd[a + 2] * c2[2] - min2) * inv2;
          if (wantBottom) {
            const o = (L.bottomBase + j) * pStride;
            pOut[o] = pd[a];
            pOut[o + 1] = pd[a + 1];
            pOut[o + 2] = pd[a + 2];
            const no = (L.bottomBase + j) * 3;
            normal[no] = bx;
            normal[no + 1] = by;
            normal[no + 2] = bz;
            uv[(L.bottomBase + j) * 2] = s1;
            uv[(L.bottomBase + j) * 2 + 1] = s2;
          }
          if (wantTop) {
            const h = readComp(distCol, i0, 0);
            const o = (L.topBase + j) * pStride;
            pOut[o] = pd[a] + dx * h;
            pOut[o + 1] = pd[a + 1] + dy * h;
            pOut[o + 2] = pd[a + 2] + dz * h;
            const no = (L.topBase + j) * 3;
            normal[no] = tx;
            normal[no + 1] = ty;
            normal[no + 2] = tz;
            uv[(L.topBase + j) * 2] = s1;
            uv[(L.topBase + j) * 2 + 1] = s2;
          }
        }
      }
      done += m;
    }

    out.setTopology(v2p, primStart, primCount);
    out.attrs.primitive.add(PRIMTYPE_ATTR, "string", 1, "poly" satisfies PrimType);
    carryPrimitiveAttributes(
      src.attrs.primitive,
      out.attrs.primitive,
      primSrc,
      "extrudePolygon",
      "primitive",
    );
    copyElements(src.attrs.detail, out.attrs.detail, undefined, src.attrs.detail.count);
    return { out: [makeGeometryItem(out)] };
  },
});
