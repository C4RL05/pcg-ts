/**
 * The pcg-ts wordmark, as geometry rather than as a file.
 *
 * INLINE AND NOT A `src`. The pages that draw it are served from two roots
 * — the vite dev server at the repository root, and the built site under
 * `docs/` — so any path to an asset is right in one and
 * broken in the other. That reasoning was worked out for the editor's
 * toolbar, which carried its own copy of these paths; this module is where
 * the copy went when the demos wanted the same mark.
 *
 * `currentColor` rather than a fill of its own, so the mark takes the
 * colour of whatever it is set in and the light-theme variant is not a
 * second asset to keep in sync.
 *
 * NOT in `editor/icons.ts`: that module's contract is Phosphor bold in a
 * shared `0 0 256 256` box, and this is different provenance in a
 * 1055x128 one.
 *
 * `docs/logo-dark.svg` and `docs/logo-light.svg` are the same geometry as
 * standalone FILES, for the README and the site to reference with `<img>`.
 * They are a different artefact, not a duplicate to be deleted — but they
 * do have to agree, and `tests/wordmark.test.ts` checks that they do,
 * because two drawings of one logotype drifting apart is invisible until
 * someone puts them side by side.
 */

import "./graph/tokens.css";
import { NARROW_MEDIA_QUERY } from "./mobile.js";

/** The box the geometry is drawn in. Every consumer needs it. */
export const WORDMARK_VIEWBOX = "0 0 1055 128";

/** The mark itself, as the inner markup of an `<svg>`. */
export const WORDMARK_PATHS =
  "<g fill=\"currentColor\" fill-rule=\"nonzero\" transform=\"translate(-9.14,127.96)\"><path d=\"M147.76,-95.97L147.76,-127.96L9.14,-127.96L9.14,-95.97L147.76,-95.97ZM147.762,-95.97L147.762,-63.98L41.13,-63.98L9.14,-31.99L9.14,0L41.13,0L41.13,-31.99L147.762,-31.99L179.752,-63.98L179.752,-95.97L147.762,-95.97Z\"/><path d=\"M368.768,-95.97L368.768,-127.96L230.145,-127.96L198.155,-95.97L198.155,-31.99L230.139,-31.99L230.139,0L368.768,0L368.768,-31.99L230.145,-31.99L230.145,-95.97L368.768,-95.97Z\"/><path d=\"M557.783,-95.97L557.783,-127.96L419.16,-127.96L387.17,-95.97L387.17,-31.99L419.16,-31.99L419.16,-95.97L557.783,-95.97ZM478.925,0L510.917,-31.99L525.793,-31.99L525.793,0L557.783,0L557.783,-63.98L497.696,-63.98L465.706,-31.99L419.16,-31.99L419.16,0L478.925,0Z\"/><rect x=\"576.186\" y=\"-63.98\" width=\"127.96\" height=\"31.99\"/><g transform=\"translate(-18.4628,0)\"><path d=\"M823.908,0L823.908,-95.97L791.918,-95.97L791.918,0L823.908,0ZM893.218,-95.97L893.218,-127.96L823.911,-127.96L823.911,-95.97L893.218,-95.97ZM791.912,-95.97L791.912,-127.96L722.608,-127.96L722.608,-95.97L791.912,-95.97Z\"/></g><g transform=\"translate(884.017944,0)\"><path d=\"M41.13,-95.97L147.762,-95.97L147.762,-127.96L41.13,-127.96L9.14,-95.97L9.14,-63.98L179.752,0L179.752,-34.149L41.13,-86.156L41.13,-95.97ZM41.13,0L41.13,-31.99L9.14,-31.99L9.14,0L41.13,0ZM179.755,-63.986L179.755,-95.97L147.765,-95.97L147.765,-63.986L179.755,-63.986Z\"/></g></g>";

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
.pcg-wordmark {
  position: fixed; left: 50%; transform: translateX(-50%); bottom: 12px; z-index: 10;
  display: block; line-height: 0;
  color: var(--ed-ink); opacity: 0.45;
  transition: opacity 0.15s;
}
.pcg-wordmark:hover, .pcg-wordmark:focus-visible { opacity: 0.9; }
.pcg-wordmark svg { height: 13px; width: auto; display: block; }
/* Below the shared breakpoint the overlay becomes a full-width bottom
   sheet and takes this edge. See shared/mobile.ts. */
@media ${NARROW_MEDIA_QUERY} {
  .pcg-wordmark { display: none; }
}
`;
  document.head.appendChild(style);
}

/**
 * Where the mark points: the landing page, two levels up.
 *
 * ONE PATH FOR BOTH ROOTS, and that is arranged rather than lucky. A demo
 * sits two levels down in each — `/demos/<id>/` on the dev server,
 * `/pcg-ts/demos/<id>/` published — and published, two levels up IS the
 * landing page. The dev server has nothing there on its own, so
 * `vite.config.ts` redirects `/` to `docs/index.html`; see the plugin
 * there for why that beats every way of asking, at runtime, which root
 * this is.
 *
 * It used to point at the demo shelf. The shelf is gone: the landing
 * page's own card grid was the navigation anyone actually used, and a
 * second index nothing linked to was a page to keep in step for nothing.
 */
const LANDING_PAGE = "../../";

/**
 * Put the wordmark at the bottom centre of the page.
 *
 * CENTRED RATHER THAN IN THE CORNER, because the panel already owns the
 * left edge in every demo and the mark sat under it.
 *
 * A LINK, because it is the only navigation a demo has — every one of
 * them is otherwise a page you can arrive at and not leave.
 */
export function attachWordmark(opts: { href?: string; label?: string } = {}): HTMLAnchorElement {
  injectStyles();
  const a = document.createElement("a");
  a.className = "pcg-wordmark";
  a.href = opts.href ?? LANDING_PAGE;
  a.title = opts.label ?? "pcg-ts";
  a.setAttribute("aria-label", opts.label ?? "pcg-ts");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", WORDMARK_VIEWBOX);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  // `innerHTML` on an SVG element parses in the SVG namespace, which
  // `createElement` would not: a `<path>` built the HTML way is an unknown
  // element that lays out as nothing.
  svg.innerHTML = WORDMARK_PATHS;
  a.appendChild(svg);
  document.body.appendChild(a);
  return a;
}
