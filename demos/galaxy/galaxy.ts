/**
 * Level definitions for the galaxy example: renderer-free, so they can
 * also run headless (the graphs only produce point clouds).
 *
 * A galaxy here is a pure function of one u32 seed. The seed first
 * derives a morphology (arm count, wind-up, bulge, disc thickness,
 * palette tint) and then feeds every stochastic node, so the same seed
 * rebuilds the same galaxy star for star — while different seeds grow
 * structurally different galaxies.
 *
 * Structure comes from one shared world-space density field:
 *
 *   arm     = cos(arms * theta - twist * ln r)  sharpened by squaring
 *   radial  = disc falloff + central bulge      (ramp approximating exp)
 *   clumps  = fbm(simplex)                      (star clusters / voids)
 *   density = clamp(arm-boosted radial * clumps, 0, 1)
 *
 * There is no ln/exp combinator; `ramp` fits both curves piecewise over
 * the radius range, which is all a density needs. Every noise seed
 * derives from the galaxy seed (not the cell), so density is seamless
 * across cell borders per the LevelDef determinism contract.
 */
import {
  Graph,
  Pcg32,
  add,
  atan2,
  attribute,
  clamp,
  component,
  cos,
  fbm,
  filterByDensity,
  gt,
  hashCombine,
  length,
  mul,
  pointScatterInBounds,
  position,
  ramp,
  randomField,
  remap,
  setAttribute,
  simplexNoise,
  sub,
  transformPoints,
  vec,
  xzCell,
  type Field,
  type LevelDef,
  type NodeHandle,
} from "pcg-ts";
import { properName } from "./system.js";

/** Fine level cell edge length in world units. */
export const FINE_CELL = 100;

/** Uniform scatter candidates per fine cell (density then thins them). */
const CELL_CANDIDATES = 1400;

/** Uniform scatter candidates for the one unbounded halo cook. */
const HALO_CANDIDATES = 160_000;

/** Morphology derived from the galaxy seed. */
export interface GalaxyForm {
  readonly seed: number;
  readonly name: string;
  /** Spiral arm count, 2..5. */
  readonly arms: number;
  /** Arm wind-up in radians per unit of ln(r). */
  readonly twist: number;
  /** Disc radius in world units. */
  readonly radius: number;
  /** Central bulge radius. */
  readonly bulge: number;
  /** Disc half-thickness at mid radius. */
  readonly thickness: number;
  /** Arm contrast: squaring passes applied to the arm wave (2 => cos^4). */
  readonly sharpen: number;
  /** Frequency of the cluster/void noise. */
  readonly clumpFreq: number;
  /** Subtle per-channel palette multiplier. */
  readonly tint: readonly [number, number, number];
}

/** Derive a galaxy's shape and palette from its seed. */
export function deriveGalaxy(seed: number): GalaxyForm {
  const rng = new Pcg32(seed, 7);
  const arms = 2 + (rng.nextU32() % 4); // 2..5
  const warm = rng.nextF32() * 2 - 1; // -1 cool .. +1 warm palette lean
  return {
    seed,
    name: properName(rng.fork(1)),
    arms,
    twist: rng.range(3.8, 7.2),
    radius: rng.range(780, 1020),
    bulge: rng.range(85, 150),
    thickness: rng.range(24, 40),
    sharpen: rng.nextF32() < 0.5 ? 2 : 3,
    clumpFreq: rng.range(0.006, 0.013),
    tint: [1 + 0.06 * warm, 1, 1 - 0.08 * warm],
  };
}

/** Piecewise-linear ln(r) over (0, maxR], log-spaced control points. */
function lnRamp(r: Field, maxR: number): Field {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const x = 2 * Math.pow(maxR / 2, i / 10);
    pts.push([x, Math.log(x)]);
  }
  return ramp(r, pts);
}

interface GalaxyFields {
  /** Star acceptance probability in [0, 1]. */
  density: Field;
  /** Arm proximity in [0, ~1] (already radius-windowed). */
  arm: Field;
  /** Galactic radius of the evaluated position. */
  r: Field;
}

/** Build the shared world-space structure fields for one morphology. */
function makeGalaxyFields(form: GalaxyForm): GalaxyFields {
  const p = position();
  const x = component(p, 0);
  const z = component(p, 2);
  const r = length(vec(x, 0, z));
  const theta = atan2(z, x);

  const wave = cos(sub(mul(theta, form.arms), mul(lnRamp(r, form.radius * 1.3), form.twist)));
  let armMask = remap(wave, -1, 1, 0, 1);
  for (let i = 0; i < form.sharpen; i++) armMask = mul(armMask, armMask);
  // Arms don't reach into the bulge and fade past the rim.
  const armWindow = ramp(r, [
    [0, 0],
    [form.bulge * 0.7, 0.1],
    [form.bulge * 1.8, 1],
    [form.radius * 0.85, 0.9],
    [form.radius * 1.05, 0.25],
  ]);
  const arm = mul(armMask, armWindow);

  // Exponential-ish disc profile with a hot bulge, fit as a ramp.
  const radial = ramp(r, [
    [0, 1.6],
    [form.bulge * 0.6, 1.1],
    [form.bulge, 0.7],
    [form.radius * 0.45, 0.5],
    [form.radius * 0.75, 0.28],
    [form.radius, 0.1],
    [form.radius * 1.12, 0],
  ]);

  const clumps = remap(
    fbm(simplexNoise, {
      seed: hashCombine(form.seed, 101),
      frequency: form.clumpFreq,
      octaves: 4,
      normalized: true,
    }),
    0,
    1,
    0.35,
    1.45,
  );

  const density = clamp(mul(mul(add(mul(arm, 1.6), 0.28), radial), clumps), 0, 1);
  return { density, arm, r };
}

/**
 * Vertical offset field: triangular-ish spread (sum of three uniforms)
 * scaled by a radius-dependent half-thickness — thick ellipsoidal bulge,
 * thin outer disc.
 */
function makeLift(form: GalaxyForm, f: GalaxyFields, widen: number): Field {
  const spread = sub(add(add(randomField("y1"), randomField("y2")), randomField("y3")), 1.5);
  const halfThickness = ramp(f.r, [
    [0, form.bulge * 0.55],
    [form.bulge, form.thickness * 2.2],
    [form.radius * 0.35, form.thickness],
    [form.radius, form.thickness * 0.5],
  ]);
  return vec(0, mul(spread, mul(halfThickness, widen)), 0);
}

/**
 * Star temperature in [0, 1] (1 = hottest/bluest): random base, boosted
 * in the arms (young hot stars trace them), cooled in the bulge (old
 * red population).
 */
function tempField(form: GalaxyForm, f: GalaxyFields): Field {
  const bulgeCool = ramp(f.r, [
    [0, 0.3],
    [form.bulge, 0.18],
    [form.bulge * 2.2, 0],
  ]);
  return clamp(sub(add(mul(randomField("temp"), 0.72), mul(f.arm, 0.5)), bulgeCool), 0, 1);
}

/** Blackbody-ish color from the previously written `temp` attribute. */
function colorFromTemp(form: GalaxyForm, dim: number): Field {
  const t = attribute("temp");
  const [tr, tg, tb] = form.tint;
  const r = ramp(t, [[0, 1], [0.45, 1], [0.75, 0.98], [1, 0.75]]);
  const g = ramp(t, [[0, 0.5], [0.35, 0.74], [0.65, 0.93], [1, 0.9]]);
  const b = ramp(t, [[0, 0.3], [0.4, 0.58], [0.7, 1], [1, 1]]);
  return vec(mul(r, tr * dim), mul(g, tg * dim), mul(b, tb * dim));
}

/** Point size: skewed small, with rare giants (~1.8% of stars). */
function sizeField(scale: number): Field {
  const base = remap(mul(randomField("s1"), randomField("s2")), 0, 1, 0.7, 2.4);
  const giantBonus = mul(gt(randomField("giant"), 0.982), remap(randomField("gsize"), 0, 1, 2.5, 4));
  return mul(add(base, giantBonus), scale);
}

/**
 * Append the shared attribute chain (temp, color, size, phase, lift)
 * after `from` and return the terminal node handle's output declaration.
 */
function starChain(
  graph: Graph,
  from: NodeHandle,
  form: GalaxyForm,
  f: GalaxyFields,
  opts: { dim: number; widen: number; sizeMul: number },
): NodeHandle {
  const temp = graph.add(setAttribute, { name: "temp", tupleSize: 1, value: tempField(form, f) });
  const color = graph.add(setAttribute, {
    name: "color",
    tupleSize: 3,
    value: colorFromTemp(form, opts.dim),
  });
  const size = graph.add(setAttribute, { name: "size", tupleSize: 1, value: sizeField(opts.sizeMul) });
  const phase = graph.add(setAttribute, { name: "phase", tupleSize: 1, value: randomField("ph") });
  const lift = graph.add(transformPoints, { translate: makeLift(form, f, opts.widen) });
  graph.connect(from, "out", temp, "in");
  graph.connect(temp, "out", color, "in");
  graph.connect(color, "out", size, "in");
  graph.connect(size, "out", phase, "in");
  graph.connect(phase, "out", lift, "in");
  return lift;
}

/**
 * Coarse unbounded level: one cook of the whole galaxy — a sparse
 * "deep field" of ~20k stars so the full spiral is always visible from
 * anywhere, plus a `dust` output of huge dim points that reads as
 * nebular glow along the arms.
 */
export function makeHaloLevel(form: GalaxyForm): LevelDef {
  const f = makeGalaxyFields(form);
  const graph = new Graph();
  const extent = form.radius * 1.15;

  const scatter = graph.add(pointScatterInBounds, {
    count: HALO_CANDIDATES,
    boundsMin: [-extent, 0, -extent],
    boundsMax: [extent, 0, extent],
  });
  const density = graph.add(setAttribute, { name: "density", tupleSize: 1, value: f.density });
  const filter = graph.add(filterByDensity, { mode: "probabilistic" });
  graph.connect(scatter, "out", density, "in");
  graph.connect(density, "out", filter, "in");
  // Halo stars stand in for thousands each: render them larger and dimmer.
  const stars = starChain(graph, filter, form, f, { dim: 0.75, widen: 1, sizeMul: 2.4 });
  graph.output(stars, "out", "stars");

  // Dust branch: few, huge, dim points hugging the arms.
  const dustScatter = graph.add(pointScatterInBounds, {
    count: 2600,
    boundsMin: [-extent, 0, -extent],
    boundsMax: [extent, 0, extent],
  });
  const dustNoise = remap(
    fbm(simplexNoise, {
      seed: hashCombine(form.seed, 202),
      frequency: form.clumpFreq * 1.7,
      octaves: 3,
      normalized: true,
    }),
    0,
    1,
    0.2,
    1.6,
  );
  const dustDensity = graph.add(setAttribute, {
    name: "density",
    tupleSize: 1,
    value: clamp(mul(mul(f.arm, dustNoise), 1.3), 0, 1),
  });
  const dustFilter = graph.add(filterByDensity, { mode: "probabilistic" });
  const hue = randomField("hue");
  const dustColor = graph.add(setAttribute, {
    name: "color",
    tupleSize: 3,
    value: vec(
      add(0.05, mul(hue, 0.1)),
      add(0.04, mul(sub(1, hue), 0.05)),
      add(0.12, mul(hue, 0.08)),
    ),
  });
  const dustSize = graph.add(setAttribute, {
    name: "size",
    tupleSize: 1,
    value: remap(randomField("ds"), 0, 1, 60, 120),
  });
  const dustLift = graph.add(transformPoints, { translate: makeLift(form, f, 1.6) });
  graph.connect(dustScatter, "out", dustDensity, "in");
  graph.connect(dustDensity, "out", dustFilter, "in");
  graph.connect(dustFilter, "out", dustColor, "in");
  graph.connect(dustColor, "out", dustSize, "in");
  graph.connect(dustSize, "out", dustLift, "in");
  graph.output(dustLift, "out", "dust");

  return {
    name: "halo",
    cellSize: "unbounded",
    generationRadius: Infinity,
    graph,
    bind(g, ctx) {
      g.setParam(scatter, "seed", ctx.seed);
      g.setParam(filter, "seed", hashCombine(ctx.seed, 1));
      g.setParam(dustScatter, "seed", hashCombine(ctx.seed, 3));
      g.setParam(dustFilter, "seed", hashCombine(ctx.seed, 4));
      // Re-derive node seeds so randomField draws vary with the world.
      g.setSeed(hashCombine(ctx.seed, 2));
    },
  };
}

/**
 * Fine bounded level: dense local stars streamed in FINE_CELL cells
 * around the camera. Same structure fields as the halo (seeded by the
 * galaxy, not the cell), so local detail lands exactly on the backdrop's
 * arms.
 */
export function makeStarLevel(form: GalaxyForm, generationRadius: number): LevelDef {
  const f = makeGalaxyFields(form);
  const graph = new Graph();
  const scatter = graph.add(pointScatterInBounds, { count: CELL_CANDIDATES });
  const density = graph.add(setAttribute, { name: "density", tupleSize: 1, value: f.density });
  const filter = graph.add(filterByDensity, { mode: "probabilistic" });
  graph.connect(scatter, "out", density, "in");
  graph.connect(density, "out", filter, "in");
  const stars = starChain(graph, filter, form, f, { dim: 1, widen: 1, sizeMul: 1 });
  graph.output(stars, "out", "stars");

  return {
    name: "stars",
    cellSize: FINE_CELL,
    generationRadius,
    graph,
    bind(g, ctx) {
      const { min, max } = xzCell(ctx);
      g.setParam(scatter, "boundsMin", [min[0], 0, min[1]]);
      g.setParam(scatter, "boundsMax", [max[0], 0, max[1]]);
      g.setParam(scatter, "seed", ctx.seed);
      g.setParam(filter, "seed", hashCombine(ctx.seed, 1));
      g.setSeed(hashCombine(ctx.seed, 2));
    },
  };
}
