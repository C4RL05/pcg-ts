/**
 * How close is the same place, and why these numbers and not tighter ones.
 *
 * EVERY FIGURE IN THIS DEMO IS f64 TODAY AND IS ABOUT TO BE f32. A `Lap`
 * holds Float64Array columns and the placement rules are plain TypeScript
 * over them, so `1e-9` is a perfectly sensible epsilon and several of
 * these comparisons were written with one. Ported into graph nodes the
 * same arithmetic runs in f32 attribute columns, and f32 is not a
 * slightly coarser f64: its spacing is 2^-23 RELATIVE, so what an epsilon
 * has to clear depends entirely on the magnitude being compared.
 *
 * TWO MAGNITUDES LIVE HERE AND THEY ARE THREE HUNDRED APART:
 *
 *   lateral, height, size   |t| <= 20W, h <= 13W    f32 spacing <= 2.4e-6
 *   station (lap arc)       0 to ~360W, past 512W   f32 spacing <= 6.1e-5
 *
 * One epsilon cannot serve both. 1e-6 is BELOW the f32 spacing at a
 * station of 360 — a comparison guarded by it is reading quantisation
 * noise, and every ruler on the lap would report its marks missing — and
 * an epsilon fat enough for a station is fatter than a lateral needs.
 * Hence two, each named for what it compares.
 *
 * BOTH SIT WELL ABOVE THE SPACING RATHER THAN AT IT. The quantities
 * compared are never single values: a station reaches a comparison
 * through a subtraction, a `%` and a wrap, each rounding once, so a few
 * spacings of disagreement between two spellings of the same number is
 * ordinary rather than exceptional. Sizing an epsilon at one ulp is the
 * same mistake as sizing it at zero, one round of arithmetic later.
 *
 * AND THEY ARE FREE, WHICH IS THE OTHER HALF OF THE ARGUMENT. W is a road
 * half-width — five to ten world units on the circuits this reads — so
 * 1e-4W is well under a millimetre of real track and 1e-3W is under a
 * centimetre. Nothing these tolerances can swallow is anything a driver,
 * a renderer or a rule could tell from zero. What they buy is that a
 * value which survived a round trip through its own datum still compares
 * equal to itself, which is what several of these rules assumed and none
 * of them stated.
 *
 * WHAT THESE ARE NOT. They are not slack in a rule. Every one of them is
 * applied in the direction that keeps the f64 answer for a value sitting
 * EXACTLY on a boundary — and the boundaries here are hit exactly, by
 * construction, not by luck: Z-1 stands large art off at exactly
 * `1 + across/2`, the band mix raises to exactly `1.2 + tall/2`, and L-3
 * puts its marks at exactly `entry - 6W` and `entry - 15W`. A rule whose
 * own placer lands on its own boundary needs to agree with itself.
 */

/**
 * Two laterals, heights or sizes this close are the same place, in W.
 *
 * 1e-4W is about forty f32 spacings at a lateral of 13W and eight hundred
 * at the corridor ceiling of 1.2W — room for a value to make several
 * round trips through `h = base + tall/2` and back and still be itself.
 * Measured against what it must NOT swallow: across four seeds of the
 * dressed lap, the nearest genuine placement to any band boundary that
 * was not exactly on one sat 8.9e-4W out, an order of magnitude clear.
 */
export const SAME_PLACE_W = 1e-4;

/**
 * Two stations this close are the same point on the lap, in W.
 *
 * Ten times `SAME_PLACE_W`, because a station is up to three hundred
 * times larger than a lateral and f32 spacing is relative: 1e-3W is
 * sixteen spacings at a 512W station, where 1e-4W would be one and a half
 * and 1e-6W would be a fortieth of one. Measured against what it must not
 * swallow: L-3's marks are 4.5W apart and the gate that proves it can
 * fail moves one of them by 1.5W.
 */
export const SAME_STATION_W = 1e-3;

/**
 * Two band shares this close are the same share.
 *
 * A share is a count over a few hundred placements, so f32 spacing at 0.1
 * is 7.5e-9 — the `1e-9` this replaced was BELOW it, which makes a share
 * landing exactly on a Z-3 bound read as outside it. 1e-6 of share is a
 * third of a thousandth of one placement on a 360-placement lap: it
 * cannot change the verdict on any ratio of whole numbers that was not
 * already sitting on the bound.
 */
export const SAME_SHARE = 1e-6;
