/**
 * The shared page chrome for the Pages site: one header bar and one site
 * index, rendered from one model into every text page.
 *
 * Why this is generated rather than hand-copied into six files: there was
 * no shared partial before, and the six pages had already drifted into
 * four footer variants, two breadcrumb spellings and three different
 * ideas of what a header is. Copying a seventh thing into six files is
 * how that happens again. Here the model is declared once, and the pages
 * carry a marked hole that `scripts/gen-site.mjs` fills — which puts the
 * chrome behind the existing docs staleness gate (`npm run docs`, then
 * `git diff --exit-code -- docs`), so a page that stopped tracking the
 * index fails CI instead of quietly going stale.
 *
 * Two consumers, one source:
 *
 *  - the five hand-authored non-landing pages get the markup through
 *    their `<!--pcg:chrome-header-->` / `<!--pcg:chrome-rail-->` holes and
 *    the CSS through the generated `docs/chrome.css`;
 *  - `gallery.ts` is a generator with its own inline stylesheet, so it
 *    calls the same renderers and inlines `CHROME_CSS` directly.
 *
 * The landing page deliberately has neither hole. It keeps the animated
 * lockup hero, which is a full-width first impression and the one place
 * the wordmark is the page rather than a way back to it.
 */

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

export interface ChromeItem {
  /** How the rail names it. */
  readonly label: string;
  /**
   * Where it points. A path is relative to `docs/` and gets the reader's
   * depth prefix; anything matching a scheme is emitted verbatim.
   */
  readonly href: string;
  /**
   * Markdown with no HTML page anywhere on the site. The rail badges
   * these so the reader knows the link leaves for a rendered blob view
   * rather than another page of the site — five of the largest documents
   * are in this state, and pretending otherwise in a nav is worse than
   * saying so.
   */
  readonly md?: boolean;
}

export interface ChromeGroup {
  readonly label: string;
  readonly items: readonly ChromeItem[];
}

const REPO = "https://github.com/C4RL05/pcg-ts";
const BLOB = `${REPO}/blob/main/docs`;

/**
 * Every destination the site has, grouped the way the rail shows them.
 *
 * One index, used unchanged on every page: the reader is never more than
 * one click from any part of the site, and no page has to work out which
 * subset of the site it is allowed to mention. The cost is a rail that is
 * the same height everywhere; the benefit is that there is exactly one
 * place to add a page.
 */
export const SITE_INDEX: readonly ChromeGroup[] = [
  {
    label: "Docs",
    items: [
      { label: "User manual", href: "manual.html" },
      { label: "Architecture", href: "architecture.html" },
      { label: "Roadmap", href: "roadmap.html" },
    ],
  },
  {
    label: "Guides",
    items: [
      { label: "Dressing a roadside", href: "guides/racetrack.html" },
      { label: "One number per lantern", href: "guides/lanterns.html" },
    ],
  },
  {
    label: "Demos",
    items: [
      { label: "Infinite world", href: "demos/infinite-world/" },
      { label: "Galaxy", href: "demos/galaxy/" },
      { label: "GPU world", href: "demos/gpu-world/" },
      { label: "Racetrack", href: "demos/racetrack/" },
      { label: "Road", href: "demos/road/" },
      { label: "Lanterns", href: "demos/lanterns/" },
    ],
  },
  {
    label: "Reference",
    items: [
      { label: "Corpus gallery", href: "gallery.html" },
      { label: "Node reference", href: `${BLOB}/nodes.md`, md: true },
      { label: "Primitives", href: `${BLOB}/primitives.md`, md: true },
      { label: "Graph corpus", href: `${BLOB}/graphs.md`, md: true },
      { label: "Authoring & parity", href: `${BLOB}/authoring.md`, md: true },
      { label: "Design notes", href: `${BLOB}/design.md`, md: true },
    ],
  },
  {
    label: "Tool",
    items: [{ label: "Editor", href: "editor/" }],
  },
];

/**
 * Where a group's name points when there is no room for the group.
 *
 * Below the two-column threshold the rail is gone, and a header with only
 * a mark and a crumb is a dead end: a reader on a phone could reach home
 * and nothing else. So the bar grows the five group names, each pointing
 * at that group's first page. It is a coarser index than the rail — one
 * link per group instead of thirty — which is the right trade at 360px.
 */
export function groupEntry(group: ChromeGroup): ChromeItem {
  const first = group.items[0];
  if (first === undefined) {
    throw new Error(
      `SITE_INDEX group "${group.label}" has no items, so the narrow header has nowhere to send it.`,
    );
  }
  return first;
}

/** The landing page, which is home and therefore never a rail item. */
export const HOME_PAGE = "index.html";

/* ------------------------------------------------------------------ *
 * Depth
 * ------------------------------------------------------------------ */

/**
 * The `../` a page needs to reach the root of `docs/`.
 *
 * `docs/guides/` is one level down, so its chrome cannot share a single
 * hard-coded prefix with the top-level pages — the old pages handled this
 * by being written twice, which is exactly the drift this module removes.
 */
export function depthPrefix(page: string): string {
  const depth = page.split("/").length - 1;
  return depth === 0 ? "./" : "../".repeat(depth);
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:|^\/\//i;

/** Resolve a model href against the reader's depth. */
export function resolveHref(href: string, page: string): string {
  return HAS_SCHEME.test(href) || href.startsWith("#") ? href : depthPrefix(page) + href;
}

/* ------------------------------------------------------------------ *
 * Escaping
 * ------------------------------------------------------------------ */

/**
 * Escape text for a element body or a double-quoted attribute.
 *
 * The model is ours, but it holds an `&` today (`Authoring & parity`) and
 * a nav is not the place to discover that a label was pasted through raw.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------------ *
 * Breadcrumb
 * ------------------------------------------------------------------ */

export interface Crumb {
  /** The group the page sits in, e.g. `Guides`. */
  readonly section: string;
  /** The page's own name within it. */
  readonly page: string;
}

/**
 * Where a page sits in the index, or `undefined` if it is not in it.
 *
 * The landing page is deliberately absent — it is home, so it is the
 * thing a breadcrumb points back TO, never a step in one.
 */
export function crumbFor(page: string): Crumb | undefined {
  for (const group of SITE_INDEX) {
    for (const item of group.items) {
      if (item.href === page) return { section: group.label, page: item.label };
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Marks
 * ------------------------------------------------------------------ */

/**
 * The wordmark, as the header's route home.
 *
 * The same outlines the landing page's static fallback draws, at 16px:
 * small enough to read as a mark rather than a title, and the only thing
 * in the bar that goes anywhere but forward. `fill: currentColor` is what
 * lets the hover rule reach it.
 */
const WORDMARK = [
  '<svg class="sitehdr-mark" viewBox="0 0 1055 128" aria-hidden="true" focusable="false">',
  '<g fill-rule="nonzero" transform="translate(-9.14,127.96)">',
  '<path d="M147.76,-95.97L147.76,-127.96L9.14,-127.96L9.14,-95.97L147.76,-95.97ZM147.762,-95.97L147.762,-63.98L41.13,-63.98L9.14,-31.99L9.14,0L41.13,0L41.13,-31.99L147.762,-31.99L179.752,-63.98L179.752,-95.97L147.762,-95.97Z"/>',
  '<path d="M368.768,-95.97L368.768,-127.96L230.145,-127.96L198.155,-95.97L198.155,-31.99L230.139,-31.99L230.139,0L368.768,0L368.768,-31.99L230.145,-31.99L230.145,-95.97L368.768,-95.97Z"/>',
  '<path d="M557.783,-95.97L557.783,-127.96L419.16,-127.96L387.17,-95.97L387.17,-31.99L419.16,-31.99L419.16,-95.97L557.783,-95.97ZM478.925,0L510.917,-31.99L525.793,-31.99L525.793,0L557.783,0L557.783,-63.98L497.696,-63.98L465.706,-31.99L419.16,-31.99L419.16,0L478.925,0Z"/>',
  '<rect x="576.186" y="-63.98" width="127.96" height="31.99"/>',
  '<g transform="translate(-18.4628,0)"><path d="M823.908,0L823.908,-95.97L791.918,-95.97L791.918,0L823.908,0ZM893.218,-95.97L893.218,-127.96L823.911,-127.96L823.911,-95.97L893.218,-95.97ZM791.912,-95.97L791.912,-127.96L722.608,-127.96L722.608,-95.97L791.912,-95.97Z"/></g>',
  '<g transform="translate(884.017944,0)"><path d="M41.13,-95.97L147.762,-95.97L147.762,-127.96L41.13,-127.96L9.14,-95.97L9.14,-63.98L179.752,0L179.752,-34.149L41.13,-86.156L41.13,-95.97ZM41.13,0L41.13,-31.99L9.14,-31.99L9.14,0L41.13,0ZM179.755,-63.986L179.755,-95.97L147.765,-95.97L147.765,-63.986L179.755,-63.986Z"/></g>',
  "</g></svg>",
].join("");

/** GitHub's mark, inlined — the site makes no off-origin asset requests. */
const GITHUB_MARK = [
  '<svg class="sitehdr-gh" viewBox="0 0 16 16" aria-hidden="true" focusable="false">',
  '<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>',
  "</svg>",
].join("");

/* ------------------------------------------------------------------ *
 * The header
 * ------------------------------------------------------------------ */

/**
 * The header bar for `page`.
 *
 * The wordmark is the only route home, so it is a link with an accessible
 * name of its own (an `aria-label`, because site.css's `.vh` helper is
 * scoped to `.hero-title` and does not reach here) — the breadcrumb
 * beside it does NOT repeat "pcg-ts",
 * because the mark already says it and a bar that reads "pcg-ts pcg-ts /
 * Guides" is how a stutter ships. The crumb therefore opens on its
 * separator, which reads as "…/ Guides / Racetrack" hanging off the mark.
 */
export function renderChromeHeader(page: string, version: string): string {
  const home = resolveHref(HOME_PAGE, page);
  const crumb = crumbFor(page);

  const crumbHtml =
    crumb === undefined
      ? ""
      : [
          '    <nav class="sitehdr-crumb" aria-label="Breadcrumb">',
          // aria-hidden: otherwise every crumb announces "slash".
          '<span class="sep" aria-hidden="true">/</span>',
          `<span>${escapeHtml(crumb.section)}</span>`,
          '<span class="sep" aria-hidden="true">/</span>',
          `<span aria-current="page">${escapeHtml(crumb.page)}</span>`,
          "</nav>",
        ].join("");

  return [
    '<a class="skip-to-main" href="#main">Skip to content</a>',
    '<header class="sitehdr">',
    '  <div class="sitehdr-row">',
    `    <a class="sitehdr-home" href="${home}" aria-label="pcg-ts — home">${WORDMARK}</a>`,
    crumbHtml,
    '    <nav class="sitehdr-sections" aria-label="Sections">',
    SITE_INDEX.map((group) => {
      const entry = groupEntry(group);
      const here = group.items.some((item) => item.href === page);
      return `      <a href="${resolveHref(entry.href, page)}"${here ? ' class="here" aria-current="true"' : ""}>${escapeHtml(group.label)}</a>`;
    }).join("\n"),
    "    </nav>",
    '    <div class="sitehdr-meta">',
    `      <span class="sitehdr-ver">v${version}</span>`,
    '      <a href="https://www.npmjs.com/package/pcg-ts">npm</a>',
    `      <a href="${REPO}" aria-label="Source on GitHub">${GITHUB_MARK}</a>`,
    "    </div>",
    "  </div>",
    "</header>",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/* ------------------------------------------------------------------ *
 * The rail
 * ------------------------------------------------------------------ */

export interface TocEntry {
  /** The `id` the heading carries. */
  readonly id: string;
  /** Its text, already plain. */
  readonly text: string;
}

/**
 * Every `<h2 id="…">` in the page, in document order.
 *
 * Scraped rather than declared so the page's own contents cannot drift
 * from the rail that lists them: adding a section to a page adds it to
 * the rail on the next `npm run docs`. Only headings that carry an `id`
 * are listed, because only those can be linked to.
 *
 * A heading may override what the rail calls it with `data-toc`. The
 * guides write their headings as full sentences — "Round until nothing
 * moves" is a good heading and a bad nav item — and a 228px rail is not
 * the place to find that out. The attribute is explicit rather than
 * scraped from the section's eyebrow label, because a rail entry that
 * silently changed when a nearby label was edited is worse than one that
 * has to be written down.
 */
export function extractToc(html: string): TocEntry[] {
  const out: TocEntry[] = [];
  const heading = /<h2\b([^>]*)\bid="([^"]+)"([^>]*)>([\s\S]*?)<\/h2>/g;
  for (let m = heading.exec(html); m !== null; m = heading.exec(html)) {
    const id = m[2] as string;
    const attrs = `${m[1] as string} ${m[3] as string}`;
    const label = /\bdata-toc="([^"]*)"/.exec(attrs)?.[1];
    const text =
      label !== undefined && label.trim() !== ""
        ? label.trim()
        : (m[4] as string)
            .replace(/<[^>]*>/g, "")
            .replace(/\s+/g, " ")
            .trim();
    if (text !== "") out.push({ id, text });
  }
  return out;
}

function railItem(item: ChromeItem, page: string): string {
  const here = item.href === page;
  const cls = here ? ' class="here"' : "";
  const current = here ? ' aria-current="page"' : "";
  // The leading space is not decoration: without it the accessible name
  // is "Node referencemd", because the badge's 7px margin is visual only.
  const badge = item.md === true ? ' <span class="md">md</span>' : "";
  return `      <li><a href="${resolveHref(item.href, page)}"${cls}${current}>${escapeHtml(item.label)}${badge}</a></li>`;
}

/**
 * The site index for `page`, with the page's own contents beneath it.
 *
 * `toc` is the page's `<h2 id>` list. It is rendered as a final group
 * rather than a separate element so the rail is one scrolling column: the
 * reader's position in the site and their position in the article are the
 * same kind of question, answered in the same place.
 */
export function renderChromeRail(page: string, toc: readonly TocEntry[]): string {
  const lines: string[] = ['<nav class="rail" aria-label="Site index">'];

  for (const group of SITE_INDEX) {
    const label = escapeHtml(group.label);
    lines.push('  <div class="rail-grp">');
    // A <p>, not an <h2>: six rail headings before the article's own <h1>
    // is a broken heading order for anyone navigating by heading. The
    // group name reaches assistive tech as the list's label instead, so
    // nothing is lost and it is not announced twice.
    lines.push(`    <p class="rail-lbl" aria-hidden="true">${label}</p>`);
    lines.push(`    <ul aria-label="${label}">`);
    for (const item of group.items) lines.push(railItem(item, page));
    lines.push("    </ul>");
    lines.push("  </div>");
  }

  if (toc.length > 0) {
    lines.push('  <div class="rail-grp rail-toc">');
    lines.push('    <p class="rail-lbl" aria-hidden="true">On this page</p>');
    lines.push('    <ul aria-label="On this page">');
    for (const entry of toc) {
      lines.push(`      <li><a href="#${entry.id}">${escapeHtml(entry.text)}</a></li>`);
    }
    lines.push("    </ul>");
    lines.push("  </div>");
  }

  lines.push("</nav>");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * The stylesheet
 * ------------------------------------------------------------------ */

/**
 * The chrome's CSS, in site.css's language.
 *
 * Written here rather than in `docs/site.css` because `gallery.html` is
 * generated with its own inline stylesheet and would otherwise need a
 * second copy — the duplication that already made its palette drift from
 * the site's. `gen-site.mjs` writes this to `docs/chrome.css` for the
 * hand-authored pages; `gallery.ts` inlines the same string.
 *
 * It respects the rules site.css states about itself: radius 0, no
 * shadows, no gradients, mono for every label and Inter only for prose,
 * hairlines at `--line`, and green reserved for the interaction rather
 * than the text.
 */
export const CHROME_CSS = `/* ---------- the shared header bar ---------- */

/* Full-bleed: the rule under the bar spans the viewport even though the
   row inside it is aligned to the same page the content uses. A bar that
   stopped at 1180px would read as a card, and the site has no cards that
   size. */
.sitehdr {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
}
.sitehdr-row {
  max-width: 1180px;
  margin: 0 auto;
  padding: 0 var(--gutter);
  min-height: 48px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.sitehdr-home {
  display: flex;
  align-items: center;
  border: 0;
  color: var(--ink-hi);
  flex: none;
}
.sitehdr-home:hover { color: var(--accent); }
.sitehdr-mark { display: block; height: 16px; width: auto; fill: currentColor; }
.sitehdr-gh { display: block; width: 15px; height: 15px; fill: currentColor; }

/* The mark already spells the name, so the crumb opens on its separator
   rather than repeating it. */
.sitehdr-crumb {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font: 400 12px/1 var(--mono);
  letter-spacing: 0.06em;
  color: var(--faint);
  white-space: nowrap;
  overflow: hidden;
}
.sitehdr-crumb .sep { color: var(--line-hi); }
.sitehdr-crumb [aria-current="page"] { color: var(--muted); }

/* The section row and the rail are one navigation in two sizes, and the
   rule is: the row shows wherever the rail does not. That is two cases,
   not one. Below the two-column threshold the rail is display:none on
   every page. Above it, the gallery still has no rail — its tile grid
   wants the full width — and without this it would be a page you can
   reach and not leave, which is what a bare crumb and a GitHub icon add
   up to. Hence :has(.rail) rather than a width alone.

   It scrolls rather than wraps: a bar that grew to three rows would push
   the article off the first screen on a phone. */
.sitehdr-sections {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-left: auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  font: 400 12.5px/1 var(--mono);
  white-space: nowrap;
}
.sitehdr-sections::-webkit-scrollbar { display: none; }
.sitehdr-sections a { border: 0; color: var(--muted); }
.sitehdr-sections a:hover { color: var(--accent); }
.sitehdr-sections a.here { color: var(--ink-hi); font-weight: 600; }

/* Where the rail is present and visible, it is the index and the row is
   redundant. */
@media (min-width: 861px) {
  body:has(.rail) .sitehdr-sections { display: none; }
}

@media (max-width: 860px) {
  /* The section row already names the section, and the version and the
     npm link are not what a reader follows from a phone. */
  .sitehdr-crumb { display: none; }
  .sitehdr-ver { display: none; }
  .sitehdr-meta a[href*="npmjs"] { display: none; }
}

.sitehdr-meta {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 16px;
  flex: none;
  font: 400 13px/1 var(--mono);
}
.sitehdr-ver { color: var(--faint); font-variant-numeric: tabular-nums; }
.sitehdr-meta a { border: 0; color: var(--muted); display: flex; align-items: center; }
.sitehdr-meta a:hover { color: var(--accent); }

/* ---------- the shell: rail beside article ---------- */

.shell {
  max-width: 1180px;
  margin: 0 auto;
  padding: 0 var(--gutter);
}
.shell > main { min-width: 0; padding-top: 30px; }

@media (min-width: 861px) {
  .shell {
    display: grid;
    grid-template-columns: 228px minmax(0, 1fr);
    gap: 44px;
    align-items: start;
  }
}

/* ---------- the site index ---------- */

.rail {
  padding-top: 30px;
  font-family: var(--mono);
}
/* Below the two-column threshold the rail is removed rather than stacked:
   a 30-item index unstacked above the article is a page of navigation
   before a word of prose. The header bar is what carries the reader
   there instead. */
@media (max-width: 860px) { .rail { display: none; } }
@media (min-width: 861px) {
  .rail {
    position: sticky;
    top: 64px;
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    padding-bottom: 24px;
  }
}
.rail-grp { margin-bottom: 22px; }
.rail-grp:last-child { margin-bottom: 0; }
.rail-lbl {
  margin: 0 0 10px;
  font: 600 11px/1 var(--mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--faint);
}
.rail ul { list-style: none; margin: 0; padding: 0; }
.rail li a {
  display: block;
  border: 0;
  padding: 4px 0;
  font: 400 13px/1.45 var(--mono);
  color: var(--muted);
}
.rail li a:hover { color: var(--ink-hi); }

/* The green bullet is the only hue in the rail, and it marks a position
   rather than a link — hence a marker glyph, not a colour on the text. */
.rail li a.here { color: var(--ink-hi); }
.rail li a.here::before { content: "\\2022\\00a0"; color: var(--accent); }

/* Five of the reference documents are markdown with no HTML page. The
   badge says so on the way out rather than after the click. */
.rail .md {
  margin-left: 7px;
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--faint);
  vertical-align: 1px;
}
.rail li a:hover .md { color: var(--muted); }

.rail-toc li a { color: var(--faint); }

/* A sticky bar means an in-page anchor would otherwise land under it. */
:target { scroll-margin-top: 64px; }

/* The footer is outside the shell, so it keeps site.css's 960px .wrap
   while the header and the article are on the 1180px page. That is a
   110px inset per side under a full-width hairline that lines up with
   the header's — which reads as a mistake rather than as a narrower
   band. Put it on the same page as everything above it. */
body:has(.shell) footer .wrap { max-width: 1180px; }

/* ---------- skip link ---------- */

/* The rail puts 19-36 links between the top of the page and the first
   word of it. Without this, reaching the article by keyboard means
   tabbing through the whole site index on every page. */
.skip-to-main {
  position: absolute;
  left: -9999px;
  top: 0;
  z-index: 30;
  border: 0;
}
.skip-to-main:focus {
  left: var(--gutter);
  top: 8px;
  padding: 8px 12px;
  background: var(--accent);
  color: #000;
  font: 600 12px/1 var(--mono);
  letter-spacing: 0.06em;
}

/* ---------- the dev grid overlay ---------- */

/* site.css draws the overlay's twelve tracks inside .wrap, which is 960px.
   A chrome page's article lives in the 1180px shell instead, so the ruler
   was measuring a column that is no longer there — and a ruler that is
   wrong is worse than no ruler. Re-key it onto the shell.

   What it still does NOT show: the rail's 228px and the 44px gap are part
   of the shell's width but hold no track, so tracks 1-2 fall behind the
   rail. Deciding whether the page grid should start at the article rather
   than at the shell is a site.css question, and it is deliberately not
   answered here. Dev-only either way: the overlay needs a "show-grid" class on
   <html>, which the g key sets. */
body:has(.shell) .grid-guide .wrap { max-width: 1180px; }
`;
