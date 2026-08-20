/**
 * The one cramped-screen breakpoint shared by the example chrome. Inside
 * it the side panels become full-width sheets and the editor's toolbar
 * drops to a single row, so the 3D content keeps the screen on phones.
 *
 * TWO DIMENSIONS, because the chrome fails in two ways. Width is what the
 * 300px+ panels fail on. HEIGHT is what the editor's toolbar fails on: it
 * needs about 1100px to sit on one row, so a phone held sideways at
 * 844x391 wraps it onto five rows and spends a quarter of the screen on
 * controls while passing the width test comfortably. A desktop window
 * shorter than 500px wants the same treatment for the same reason.
 *
 * The demo captures shoot at 783 and 791 px tall and the gallery's node
 * canvas at 480, so the gallery frames DO see this layout — which is why
 * scripts/capture-gallery.mjs hides the drawer tab along with the rest of
 * the chrome.
 *
 * Svelte <style> blocks cannot interpolate this constant — components
 * hard-code the same query with a comment pointing here.
 */

export const NARROW_MEDIA_QUERY = "(max-width: 700px), (max-height: 500px)";

export function narrowScreen(): MediaQueryList {
  return window.matchMedia(NARROW_MEDIA_QUERY);
}
