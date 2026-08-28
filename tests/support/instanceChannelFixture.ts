/**
 * The numbers the instance-channel render harness draws with, and the
 * bytes they must come back as.
 *
 * A third module rather than a section of either half, because both
 * halves need them and they must not drift: the page
 * (`./instanceChannelPage.ts`, bundled into a browser) writes these
 * values into point attributes, and the suite
 * (`../instanceChannelRender.test.ts`, running in Node) asserts the
 * pixels against them. Nothing here imports `three` or touches the DOM,
 * so it is safe on both sides.
 */

/** Instances per case, and therefore 16-pixel columns in the target. */
export const N = 4;

/**
 * THE HOST'S SPELLING OF A CHANNEL, WHICH IS NOT THE CONTENT'S.
 *
 * An integrating host owns the shader, so it owns the attribute NAMES the
 * shader declares; a graph publishes channels under the point attribute's
 * own name. Anything that maps one onto the other — the integrator's
 * `CHANNEL_MAP` — can be stale, and a stale entry is not a mismatch the
 * library can see: `toInstancedMeshes` binds what the batch carries and
 * the material declares what it declares.
 *
 * The point cloud carries these three attributes with the SAME values as
 * `tint` / `gain` / `id`, which is what makes the missing-channel cases
 * provable: the run that publishes them instead is byte-for-byte the run
 * that works, so "the channel was absent" is the only difference between
 * the failing pixels and the passing ones.
 */
export const HOST_TINT = "hostTint";
export const HOST_GAIN = "hostGain";
export const HOST_ID = "hostId";

/**
 * How the shared-asset case splits four instances across TWO batches of
 * one asset id: instances 0-1 in a channelled batch, 2-3 in a batch that
 * carries no channel at all. Columns 0-1 therefore read the first mesh
 * and columns 2-3 the second, so one readback answers for both.
 */
export const SHARED_FIRST: readonly number[] = [0, 1];
export const SHARED_SECOND: readonly number[] = [2, 3];
/** Pixels per instance column; also the target's height. */
export const CELL = 16;
export const WIDTH = N * CELL;
export const HEIGHT = CELL;

/**
 * 2^24 — where an f32's 24-bit mantissa stops holding every integer.
 *
 * The four ids are 2^24 + 0..3, and an f32 rounds them to 2^24, 2^24,
 * 2^24 + 2, 2^24 + 4 (ties to even). So instances 0 and 1 COLLIDE under
 * the widening while 2 and 3 stay apart, and that asymmetry is the
 * point: a case where every instance collapsed to one value could just
 * as well mean the attribute never arrived.
 */
export const ID_BASE = 16777216;

/** The ids, as a `u32` column carries them. */
export const IDS: readonly number[] = [0, 1, 2, 3].map((k) => ID_BASE + k);

/**
 * The shaders put `(id - ID_BASE) * ID_SCALE` in the red byte. Scaled so
 * consecutive ids are 40 bytes apart instead of 1 — a difference no
 * rounding, dithering or filtering could manufacture or erase.
 */
export const ID_SCALE = 40;

/**
 * Per-instance tint. Every component is a multiple of 1/255 and no two
 * instances share one, so a transposition cannot hide behind a matching
 * value.
 */
export const TINTS: readonly (readonly [number, number, number])[] = [
  [0.2, 0.4, 0.6],
  [0.8, 0.2, 0.4],
  [0.4, 0.8, 0.2],
  [0.6, 0.6, 0.8],
];

/**
 * Per-instance scalar channel, so a 1-component channel is exercised too.
 *
 * 0.6 and not 0.5, and the reason is the assertion's sharpness. `tint *
 * gain` is written to an RGBA8 target, so the byte is `round(v * 255)`
 * — and at gain 0.5 three of the twelve components land on EXACTLY
 * `x.5` (0.1*255 = 25.5, 0.3*255 = 76.5), where which way the hardware
 * rounds is a coin toss the test would have to absorb with a tolerance.
 * At 0.6 the worst component sits 0.1 of a byte from the boundary,
 * which is four hundred times the error a smooth varying's
 * interpolation weights can introduce, so every expected byte is exact
 * and the assertion needs no tolerance at all.
 */
export const GAINS: readonly number[] = [1, 0.6, 1, 0.6];

/**
 * `TINTS[tintIndex] * GAINS[gainIndex]` as an 8-bit triple, computed
 * through f32 the way the GPU does.
 *
 * The two indices are separate because the sabotage runs corrupt ONE
 * channel: reversing `tint` and leaving `gain` alone means instance `i`
 * draws with tint `N-1-i` and gain `i`, and an expectation that could
 * not say that would be asserting the wrong thing.
 */
export function expectedTintBytes(tintIndex: number, gainIndex = tintIndex): [number, number, number] {
  const gain = Math.fround(GAINS[gainIndex]);
  const [r, g, b] = TINTS[tintIndex].map((v) => Math.round(Math.fround(Math.fround(v) * gain) * 255));
  return [r, g, b];
}

/** Red byte for instance `i` when the id survives as a `u32`. */
export function expectedIdByte(i: number): number {
  return (IDS[i] - ID_BASE) * ID_SCALE;
}

/**
 * Red byte for instance `i` when the id was WIDENED to f32 first — the
 * widening `src/spawn` refuses to do, performed on purpose so the
 * collision it avoids is visible in pixels: `[0, 0, 80, 160]`, where the
 * first two are the same byte from two different ids.
 */
export function expectedWidenedIdByte(i: number): number {
  return (Math.fround(IDS[i]) - ID_BASE) * ID_SCALE;
}
