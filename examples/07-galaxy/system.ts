/**
 * Deterministic star-system generation for the galaxy example:
 * renderer-free specs only. A star's u32 seed (derived from its world
 * position) fully determines its name, spectral class, and planetary
 * system — visit the same star in the same galaxy and the same worlds
 * are waiting.
 */
import { Pcg32 } from "pcg-ts";

/** Syllable-built proper name, deterministic per rng stream. */
export function properName(rng: Pcg32): string {
  const HEAD = [
    "al", "an", "ar", "be", "ca", "cor", "da", "del", "el", "es", "fa", "gal",
    "ha", "io", "ka", "ke", "ly", "ma", "me", "na", "ne", "o", "pha", "qua",
    "ra", "rho", "sa", "se", "ta", "tha", "u", "ve", "vi", "xa", "ze", "zo",
  ];
  const TAIL = [
    "dar", "dis", "la", "lia", "lon", "mar", "mir", "nis", "nor", "phos",
    "ra", "rax", "ria", "ris", "ron", "rus", "sar", "sil", "thea", "thos",
    "tis", "tor", "va", "vel", "ven", "wen", "xis", "ya", "zar",
  ];
  const parts = 2 + (rng.nextU32() % 2);
  let s = "";
  for (let i = 0; i < parts - 1; i++) s += HEAD[rng.nextU32() % HEAD.length];
  s += TAIL[rng.nextU32() % TAIL.length];
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Planet archetypes, ordered roughly hot to cold. */
export type PlanetKind =
  | "molten"
  | "rocky"
  | "desert"
  | "terran"
  | "ocean"
  | "gas giant"
  | "ice giant"
  | "frozen";

export interface RingSpec {
  readonly inner: number;
  readonly outer: number;
  readonly color: readonly [number, number, number];
  readonly opacity: number;
}

export interface PlanetSpec {
  readonly name: string;
  readonly kind: PlanetKind;
  /** Orbit radius in scene units. */
  readonly orbit: number;
  /** Body radius in scene units. */
  readonly radius: number;
  readonly color: readonly [number, number, number];
  /** Orbital angular speed, rad/s of presentation time. */
  readonly angularSpeed: number;
  /** Starting orbital angle, radians. */
  readonly phase: number;
  /** Axial tilt used for ring orientation, radians. */
  readonly tilt: number;
  readonly ring?: RingSpec;
  readonly moons: number;
}

export interface SystemSpec {
  readonly seed: number;
  readonly catalog: string;
  readonly name: string;
  readonly spectral: string;
  readonly tempK: number;
  readonly starColor: readonly [number, number, number];
  readonly starRadius: number;
  readonly planets: readonly PlanetSpec[];
  /** Outermost orbit + margin; sizes the camera framing. */
  readonly extent: number;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

const KIND_COLOR: Record<PlanetKind, readonly [number, number, number]> = {
  molten: [0.85, 0.35, 0.16],
  rocky: [0.55, 0.5, 0.46],
  desert: [0.8, 0.65, 0.4],
  terran: [0.32, 0.55, 0.72],
  ocean: [0.2, 0.45, 0.85],
  "gas giant": [0.75, 0.62, 0.45],
  "ice giant": [0.45, 0.65, 0.85],
  frozen: [0.75, 0.8, 0.9],
};

const KIND_RADIUS: Record<PlanetKind, readonly [number, number]> = {
  molten: [0.22, 0.4],
  rocky: [0.25, 0.5],
  desert: [0.25, 0.5],
  terran: [0.35, 0.55],
  ocean: [0.35, 0.6],
  "gas giant": [0.95, 1.7],
  "ice giant": [0.7, 1.2],
  frozen: [0.22, 0.45],
};

const INNER_KINDS: readonly PlanetKind[] = ["molten", "rocky", "desert", "terran", "ocean"];
const OUTER_KINDS: readonly PlanetKind[] = ["gas giant", "gas giant", "ice giant", "frozen"];

function jitterColor(rng: Pcg32, base: readonly [number, number, number]): [number, number, number] {
  const j = (v: number): number => Math.min(1, Math.max(0, v + (rng.nextF32() - 0.5) * 0.16));
  return [j(base[0]), j(base[1]), j(base[2])];
}

/**
 * Generate the full system for a star. `temp` is the star's normalized
 * temperature in [0, 1] (1 = hottest/bluest); `starColor` is the star's
 * rendered point color, reused so the system view matches the dot you
 * clicked.
 */
export function generateSystem(
  starSeed: number,
  temp: number,
  starColor: readonly [number, number, number],
): SystemSpec {
  const rng = new Pcg32(starSeed, 11);
  const name = properName(rng.fork(1));
  const catalog = `PCG-${(starSeed >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
  const spectral = "MKGFABO".charAt(Math.min(6, Math.floor(temp * 7)));
  const tempK = Math.round(2600 + temp * temp * 27000);
  const starRadius = 1.1 + temp * 1.6 + rng.nextF32() * 0.5;

  const planetRng = rng.fork(2);
  const count = planetRng.nextF32() < 0.07 ? 0 : 1 + (planetRng.nextU32() % 7);
  const frostLine = starRadius * 6 + planetRng.range(5, 12);

  const planets: PlanetSpec[] = [];
  let orbit = starRadius * 3.2 + planetRng.range(2.5, 4.5);
  for (let i = 0; i < count; i++) {
    const pool = orbit < frostLine ? INNER_KINDS : OUTER_KINDS;
    const kind = pool[planetRng.nextU32() % pool.length];
    const [rMin, rMax] = KIND_RADIUS[kind];
    const radius = planetRng.range(rMin, rMax);
    const hasRing =
      (kind === "gas giant" || kind === "ice giant") && planetRng.nextF32() < 0.42;
    planets.push({
      name: `${name} ${ROMAN[i]}`,
      kind,
      orbit,
      radius,
      color: jitterColor(planetRng, KIND_COLOR[kind]),
      angularSpeed: 0.55 / Math.sqrt(orbit),
      phase: planetRng.nextF32() * Math.PI * 2,
      tilt: (planetRng.nextF32() - 0.5) * 0.5,
      ring: hasRing
        ? {
            inner: radius * 1.5,
            outer: radius * planetRng.range(2.1, 2.7),
            color: jitterColor(planetRng, [0.7, 0.66, 0.58]),
            opacity: planetRng.range(0.3, 0.55),
          }
        : undefined,
      moons: kind === "gas giant" || kind === "ice giant"
        ? planetRng.nextU32() % 5
        : planetRng.nextF32() < 0.25 ? 1 : 0,
    });
    orbit *= planetRng.range(1.42, 1.9);
  }

  const extent = planets.length > 0 ? planets[planets.length - 1].orbit + 8 : starRadius * 10;
  return { seed: starSeed, catalog, name, spectral, tempK, starColor, starRadius, planets, extent };
}
