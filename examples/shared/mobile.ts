/**
 * The one narrow-screen breakpoint shared by the example chrome. Below it
 * the side panels become full-width bottom sheets (collapsed to a title
 * bar by default) so the 3D content keeps the screen on phones. Width
 * only, on purpose: width is the dimension the 300px+ panels actually
 * fail on, and every capture viewport is >=1079 CSS px wide, so the
 * committed screenshots never see the mobile layout.
 *
 * Svelte <style> blocks cannot interpolate this constant — components
 * hard-code `@media (max-width: 700px)` with a comment pointing here.
 */

export const NARROW_MEDIA_QUERY = "(max-width: 700px)";

export function narrowScreen(): MediaQueryList {
  return window.matchMedia(NARROW_MEDIA_QUERY);
}
