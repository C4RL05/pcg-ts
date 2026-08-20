/**
 * The corpus gallery: `docs/gallery.html`, one card per graph under
 * `graphs/`.
 *
 * The corpus was public as PROSE long before it was public as pictures —
 * `docs/graphs.md` names all of them and shows none, which is the wrong
 * shape for the thing the README calls documentation and teaching
 * material: the one question a reader has about a corpus graph is what it
 * looks like.
 *
 * What makes this generated rather than hand-authored: the page states a
 * count, groups by family and names every file, so a graph added to the
 * corpus invalidates it. `scripts/gen-gallery.mjs` renders it from the
 * same `ExampleEntry` list that `docs/graphs.md` is built from, so the two
 * cannot disagree about what the corpus contains, and CI's existing
 * "generated files are stale" gate covers it with no new workflow config.
 *
 * The FRAMES are committed artifacts, not generated here: capturing them
 * drives a real browser through the editor, so it is a separate,
 * deliberate step (`npm run capture:gallery`). This module only asks
 * which ones exist. A graph with no frame still gets a card, marked — a gallery
 * that quietly omits what it could not photograph is worse than one that
 * admits the gap.
 *
 * The design tokens are copied from `docs/index.html` rather than shared:
 * that page inlines its own CSS and there is no stylesheet in `docs/` to
 * import, so a copy is what keeps this page a single request. Keep them in
 * step by hand; they are the palette, and it does not move.
 *
 * Nothing here touches the filesystem: the generator and the drift test in
 * gallery.test.ts each do their own I/O and hand strings in.
 */
import type { ExampleEntry } from "./graphIndex.js";

/** Which committed frames exist under `docs/gallery/`, by graph name. */
export interface GalleryFrames {
  /** Names with a cooked scene frame, `<name>.webp`. */
  readonly scenes: readonly string[];
  /** Names with a node-graph frame, `<name>.graph.webp`. */
  readonly graphs: readonly string[];
}

/**
 * What one graph cooks to, as the corpus golden already records it.
 *
 * These numbers are on the card for a reason a prettier caption would
 * miss: a 600-point scatter over a wide box IS a nearly black tile, and
 * without the count a reader cannot tell that from a broken frame. The
 * golden is the corpus' recorded cook — the same file the corpus test
 * asserts against — so quoting it keeps the caption and the assertion on
 * one set of numbers instead of two.
 */
export interface GalleryStat {
  readonly points: number;
  readonly primitives: number;
  readonly instances: number;
}

export interface GalleryOptions {
  /** package.json's version, for the footer. */
  readonly version: string;
  readonly frames: GalleryFrames;
  /** By graph name. A name with no entry simply loses its counts. */
  readonly stats: Readonly<Record<string, GalleryStat>>;
}

/**
 * The shape this module needs out of `tests/graphs.golden.json` — a
 * structural subset, not a re-declaration of the golden format. Anything
 * else in the file is none of the gallery's business.
 */
export interface GalleryGolden {
  readonly examples: Readonly<
    Record<
      string,
      {
        readonly outputs: Readonly<
          Record<
            string,
            readonly {
              readonly kind: string;
              readonly counts?: { readonly point: number; readonly primitive: number };
              readonly instances?: number;
            }[]
          >
        >;
      }
    >
  >;
}

/**
 * Reduce the golden to one line of counts per graph.
 *
 * Summed across a graph's outputs rather than taken from one of them: a
 * pipeline stage has ten, and the card is answering "how much is in this
 * picture", which is all of them. `value` outputs contribute nothing and
 * are not an error — a graph whose result is a number rather than geometry
 * is exactly what `basics-report-to-the-host` teaches.
 */
export function galleryStats(golden: GalleryGolden): Record<string, GalleryStat> {
  const stats: Record<string, GalleryStat> = {};
  for (const [file, example] of Object.entries(golden.examples)) {
    let points = 0;
    let primitives = 0;
    let instances = 0;
    for (const outputs of Object.values(example.outputs)) {
      for (const output of outputs) {
        points += output.counts?.point ?? 0;
        primitives += output.counts?.primitive ?? 0;
        instances += output.instances ?? 0;
      }
    }
    stats[file.replace(/\.json$/, "")] = { points, primitives, instances };
  }
  return stats;
}

/**
 * What each family is, in one sentence. A family with no entry here still
 * renders — it gets its name and its count and no blurb — so adding a
 * `weather-*` graph to the corpus cannot break the page, it just leaves a
 * sentence for someone to write.
 */
const FAMILY_BLURB: Readonly<Record<string, string>> = {
  basics:
    "One concept per file, cooked from JSON alone. These are what the node reference points at when it says a param takes a field.",
  examples:
    "Whole scenes rather than single ideas — each one exists because something in the library only shows up at that size.",
  pipeline:
    "One settlement in five stages, plus three edit variants. Each stage is the previous file plus nodes and nothing removed, so the earlier stages cook bit-identically inside the later ones.",
};

/** Families first in this order, then anything new, alphabetically. */
const FAMILY_ORDER = ["basics", "examples", "pipeline"] as const;

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => ESCAPES[ch] ?? ch);
}

/** `basics-point-grid.json` -> `basics-point-grid`. */
function nameOf(entry: ExampleEntry): string {
  return entry.file.replace(/\.json$/, "");
}

/** `basics-point-grid` -> `basics`. The corpus names its families in the file name. */
function familyOf(name: string): string {
  const cut = name.indexOf("-");
  return cut === -1 ? name : name.slice(0, cut);
}

/** Commas, matching the stat row on docs/index.html. The locale is pinned, so this is byte-stable. */
function withCommas(value: number): string {
  return value.toLocaleString("en-US");
}

function plural(count: number, one: string, many: string): string {
  return `${withCommas(count)} ${count === 1 ? one : many}`;
}

/**
 * The card's caption under the title: how big the graph is, then what it
 * cooked to. Three terms at most — the fourth wraps onto a second line at
 * card width, and the two that survive are the ones that explain the
 * picture. Primitives stand in for instances only when there are none,
 * because a mesh graph's triangle count is what its point count is not
 * telling you.
 */
function factsOf(entry: ExampleEntry, stat: GalleryStat | undefined): string {
  const facts = [plural(entry.nodeCount, "node", "nodes")];
  if (stat !== undefined) {
    // A zero is not a fact worth the width: a graph whose only output is an
    // instance batch has no points of its own, and "0 pts" reads as a
    // failure rather than as the shape of that graph.
    if (stat.points > 0) facts.push(`${withCommas(stat.points)} pts`);
    if (stat.instances > 0) facts.push(`${withCommas(stat.instances)} inst`);
    else if (stat.primitives > 0) facts.push(`${withCommas(stat.primitives)} prims`);
  }
  return facts.join(" · ");
}

/**
 * Alt text. The title is the one sentence that distinguishes this frame
 * from the other sixty-six, so it carries the description, and the counts
 * follow it for the same reason they are on the card: they are what says a
 * dark frame is a sparse scatter rather than a failure. The node-graph
 * frame beside it gets `alt=""` because it is the SAME card rendered a
 * second way, and announcing every card twice serves nobody.
 */
function altOf(entry: ExampleEntry, name: string, stat: GalleryStat | undefined): string {
  const cooked =
    stat === undefined
      ? ""
      : ` — ${plural(stat.points, "point", "points")}${stat.instances > 0 ? `, ${plural(stat.instances, "instance", "instances")}` : ""}`;
  return `${name} cooked in the editor: ${entry.title}${cooked}`;
}

function renderTile(entry: ExampleEntry, options: GalleryOptions): string {
  const name = nameOf(entry);
  const frames = options.frames;
  const stat = options.stats[name];
  const find = [name, entry.title, ...entry.tags].join(" ").toLowerCase();
  const images: string[] = [];
  if (frames.scenes.includes(name)) {
    images.push(
      `<img class="scene" src="./gallery/${name}.webp" width="720" height="480" loading="lazy" decoding="async" alt="${escapeHtml(altOf(entry, name, stat))}">`,
    );
  }
  if (frames.graphs.includes(name)) {
    images.push(
      `<img class="graph" src="./gallery/${name}.graph.webp" width="720" height="480" loading="lazy" decoding="async" alt="">`,
    );
  }
  if (images.length === 0) images.push(`<span class="missing">no frame captured</span>`);

  return [
    `      <a class="tile" id="${name}" href="./pages/editor/?graph=${name}"`,
    ` data-family="${familyOf(name)}" data-find="${escapeHtml(find)}">`,
    `<span class="frame">${images.join("")}</span>`,
    `<span class="meta"><b>${name}</b>`,
    `<span class="what">${escapeHtml(entry.title)}</span>`,
    `<span class="facts">${factsOf(entry, stat)}</span></span></a>`,
  ].join("");
}

function renderFamily(
  family: string,
  entries: readonly ExampleEntry[],
  options: GalleryOptions,
): string {
  const blurb = FAMILY_BLURB[family];
  return [
    `  <section class="family" id="family-${family}">`,
    `    <p class="eyebrow">${family} · ${plural(entries.length, "graph", "graphs")}</p>`,
    ...(blurb === undefined ? [] : [`    <p class="blurb">${escapeHtml(blurb)}</p>`]),
    `    <div class="grid">`,
    ...entries.map((entry) => renderTile(entry, options)),
    `    </div>`,
    `  </section>`,
  ].join("\n");
}

/**
 * Group into families, in FAMILY_ORDER and then alphabetically, keeping the
 * corpus' own order (by file name) inside each.
 */
function byFamily(entries: readonly ExampleEntry[]): [string, ExampleEntry[]][] {
  const groups = new Map<string, ExampleEntry[]>();
  for (const entry of entries) {
    const family = familyOf(nameOf(entry));
    const group = groups.get(family);
    if (group === undefined) groups.set(family, [entry]);
    else group.push(entry);
  }
  const rank = (family: string): number => {
    const at = (FAMILY_ORDER as readonly string[]).indexOf(family);
    return at === -1 ? FAMILY_ORDER.length : at;
  };
  return [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * The whole page, as bytes. Deterministic: the entries arrive sorted, the
 * frame lists are only membership tests, and nothing here reads a clock.
 */
export function renderGallery(
  entries: readonly ExampleEntry[],
  options: GalleryOptions,
): string {
  const families = byFamily(entries);
  const breakdown = families.map(([family, group]) => `${group.length} ${family}`).join(", ");
  const missing = entries.filter((entry) => !options.frames.scenes.includes(nameOf(entry))).length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>pcg-ts — the graph corpus</title>
<meta name="description" content="Every graph in the pcg-ts corpus, cooked in the editor: ${entries.length} files, ${escapeHtml(breakdown)}." />
<link rel="icon" href="./icon.svg" type="image/svg+xml" />
</head>
<body>
<!-- Generated by scripts/gen-gallery.mjs from graphs/ and docs/gallery/.
     Do not edit by hand: run \`npm run build && npm run docs:gallery\`. -->
<style>
  @font-face {
    font-family: "Inter";
    src: url("./fonts/inter-latin.woff2") format("woff2");
    font-weight: 100 900; font-style: normal; font-display: swap;
  }
  @font-face {
    font-family: "JetBrains Mono";
    src: url("./fonts/jetbrains-mono-latin.woff2") format("woff2");
    font-weight: 100 800; font-style: normal; font-display: swap;
  }
  /* The palette of docs/index.html: one dark world, greyscale text, and
     green spent only on interaction. See that page for the contrast
     measurements behind each value. */
  :root {
    color-scheme: dark;
    --bg: #000000;
    --ink-hi: #ffffff;
    --ink: #ededed;
    --muted: #9a9a9a;
    --faint: #7a7a7a;
    --line: #262626;
    --line-hi: #3a3a3a;
    --card: #0d0d0d;
    --accent: #00ff00;
    --accent-ink: #ededed;
    --mono: "JetBrains Mono", "Cascadia Code", "SF Mono", Consolas, monospace;
    --sans: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font-family: var(--sans); font-size: 16px; line-height: 1.65;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 0 24px; }
  a { color: var(--accent-ink); text-decoration: none; border-bottom: 1px solid var(--line-hi); }
  a:hover, a:focus-visible { border-bottom-color: var(--accent); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
  code { font-family: var(--mono); font-size: 0.92em; }

  header { border-bottom: 1px solid var(--line); padding: 40px 0 26px; }
  h1 {
    font-family: var(--mono); font-size: 27px; font-weight: 600;
    letter-spacing: -0.01em; color: var(--ink-hi); margin: 0 0 10px;
  }
  .lead { font-size: 17px; color: var(--muted); max-width: 68ch; margin: 0 0 12px; }
  .lead strong { color: var(--ink); font-weight: 600; }
  .sub { font-size: 14.5px; color: var(--faint); max-width: 68ch; margin: 0; }
  .eyebrow {
    font-family: var(--mono); font-size: 12px; font-weight: 600;
    letter-spacing: 0.14em; text-transform: uppercase; color: var(--faint); margin: 0 0 8px;
  }

  /* The controls ride along the top because the grid is taller than any
     screen: a filter you have to scroll back up to reach is a filter you
     use once. They start hidden and are revealed by the script, so a page
     with JavaScript off shows every card and no dead switches.

     The RAIL is what sticks, not the bar inside it. A sticky element only
     travels within its own parent's box, so sticking .controls — whose
     parent is exactly as tall as it is — scrolls it away immediately.
     The rail's parent is the document body, which is the whole page. */
  .controls-rail {
    position: sticky; top: 0; z-index: 5;
    border-bottom: 1px solid var(--line);
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(8px);
  }
  .controls {
    display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: center;
    padding: 12px 0;
  }
  .controls input[type="search"] {
    font-family: var(--mono); font-size: 13px; color: var(--ink);
    background: var(--card); border: 1px solid var(--line); border-radius: 7px;
    padding: 7px 11px; width: 220px;
  }
  .controls input[type="search"]:focus { border-color: var(--line-hi); outline: none; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chips button {
    font-family: var(--mono); font-size: 11.5px; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--muted); background: transparent;
    border: 1px solid var(--line); border-radius: 99px; padding: 5px 12px; cursor: pointer;
  }
  .chips button:hover { border-color: var(--line-hi); color: var(--ink); }
  .chips button[aria-pressed="true"] {
    color: var(--ink-hi); border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .switch {
    display: flex; align-items: center; gap: 7px;
    font-family: var(--mono); font-size: 11.5px; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--muted); cursor: pointer;
  }
  .switch input { accent-color: var(--accent); width: 14px; height: 14px; }
  .count { font-family: var(--mono); font-size: 11.5px; color: var(--faint); margin-left: auto; }

  section.family { padding: 34px 0 6px; }
  section.family + section.family { border-top: 1px solid var(--line); }
  .blurb { font-size: 14.5px; color: var(--muted); max-width: 74ch; margin: 0 0 18px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(258px, 1fr)); gap: 14px; }

  a.tile {
    display: block; border: 1px solid var(--line); border-radius: 10px;
    background: var(--bg); overflow: hidden; transition: border-color 0.15s ease;
  }
  a.tile:hover, a.tile:focus-visible { border-color: var(--accent); }
  a.tile:target { border-color: var(--line-hi); }
  /* The aspect is reserved up front so lazily-loaded frames cannot reflow
     the grid as they arrive. */
  .frame {
    position: relative; display: block; aspect-ratio: 3 / 2;
    background: var(--card); border-bottom: 1px solid var(--line);
  }
  .frame img {
    position: absolute; inset: 0; display: block; width: 100%; height: 100%;
    object-fit: cover; opacity: 0.94; transition: opacity 0.18s ease;
  }
  a.tile:hover .scene, a.tile:focus-visible .scene { opacity: 1; }
  /* The node graph sits ON the scene and is revealed by hover, or held up
     across the whole page by the switch — the pairing is the point: every
     frame here is the output of a file you can read. */
  .frame .graph { opacity: 0; }
  a.tile:hover .graph, a.tile:focus-visible .graph, body.show-graphs .frame .graph { opacity: 1; }
  .missing {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-family: var(--mono); font-size: 11.5px; color: var(--faint);
  }
  .meta { display: block; padding: 11px 13px 13px; }
  .meta b {
    font-family: var(--mono); font-size: 12.5px; font-weight: 600;
    display: block; color: var(--accent-ink); margin-bottom: 3px; overflow-wrap: anywhere;
  }
  .meta .what { display: block; font-size: 13px; color: var(--muted); line-height: 1.5; }
  .meta .facts {
    display: block; font-family: var(--mono); font-size: 11px;
    color: var(--faint); margin-top: 7px;
  }
  .empty { font-size: 14.5px; color: var(--faint); padding: 30px 0; }

  footer {
    border-top: 1px solid var(--line); margin-top: 34px; padding: 24px 0 40px;
    font-size: 13.5px; color: var(--faint);
  }
  footer .wrap { display: flex; flex-wrap: wrap; gap: 8px 28px; }

  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; }
  }
</style>

<header>
  <div class="wrap">
    <p class="eyebrow">Corpus</p>
    <h1>${entries.length} graphs, every one a file you can cook</h1>
    <p class="lead">Every graph in <code>graphs/</code>, cooked in the editor and shot from the frame it draws into. <strong>${escapeHtml(breakdown)}.</strong> Each file teaches one thing and cooks from JSON alone — <code>pcg cook graphs/&lt;name&gt;.json</code> reproduces what you see here from the seed the file carries, on any machine and in any cook order.</p>
    <p class="sub">Hover a card for the node graph behind the frame. Click to open it in the <a href="./pages/editor/">editor</a> and change it live. The files themselves are in <a href="https://github.com/C4RL05/pcg-ts/tree/main/graphs">graphs/</a>; the same index in prose is <a href="./graphs.md">graphs.md</a>.</p>
  </div>
</header>

<div class="controls-rail">
  <div class="wrap">
    <div class="controls" id="controls" hidden>
      <input type="search" id="find" placeholder="filter…" aria-label="Filter graphs by name, title or tag" autocomplete="off" spellcheck="false">
      <div class="chips" role="group" aria-label="Filter by family">
        <button type="button" data-family="all" aria-pressed="true">all</button>
${families.map(([family]) => `        <button type="button" data-family="${family}" aria-pressed="false">${family}</button>`).join("\n")}
      </div>
      <label class="switch"><input type="checkbox" id="graphs-on"> node graphs</label>
      <span class="count" id="count" aria-live="polite">${entries.length} graphs</span>
    </div>
  </div>
</div>

<main class="wrap">
${families.map(([family, group]) => renderFamily(family, group, options)).join("\n")}
  <p class="empty" id="empty" hidden>Nothing matches that filter.</p>
</main>

<footer>
  <div class="wrap">
    <span>pcg-ts v${options.version}</span>
    <span>${entries.length} graphs${missing === 0 ? "" : `, ${missing} without a frame`}</span>
    <a href="./index.html">home</a>
    <a href="./manual.html">user manual</a>
    <a href="https://github.com/C4RL05/pcg-ts">github.com/C4RL05/pcg-ts</a>
  </div>
</footer>

<script>
(() => {
  const tiles = Array.from(document.querySelectorAll("a.tile"));
  const sections = Array.from(document.querySelectorAll("section.family"));
  const controls = document.getElementById("controls");
  const find = document.getElementById("find");
  const chips = Array.from(document.querySelectorAll(".chips button"));
  const count = document.getElementById("count");
  const empty = document.getElementById("empty");
  let family = "all";

  function apply() {
    const q = find.value.trim().toLowerCase();
    let shown = 0;
    for (const tile of tiles) {
      const on =
        (family === "all" || tile.dataset.family === family) &&
        (q === "" || tile.dataset.find.includes(q));
      tile.hidden = !on;
      if (on) shown++;
    }
    for (const section of sections) {
      section.hidden = section.querySelector("a.tile:not([hidden])") === null;
    }
    empty.hidden = shown !== 0;
    count.textContent =
      shown === tiles.length ? shown + " graphs" : shown + " of " + tiles.length + " graphs";
  }

  find.addEventListener("input", apply);
  for (const chip of chips) {
    chip.addEventListener("click", () => {
      family = chip.dataset.family;
      for (const other of chips) other.setAttribute("aria-pressed", String(other === chip));
      apply();
    });
  }
  document.getElementById("graphs-on").addEventListener("change", (event) => {
    document.body.classList.toggle("show-graphs", event.currentTarget.checked);
  });

  // A card linked to directly has to survive the filter it lands in.
  addEventListener("hashchange", () => {
    if (location.hash.length < 2) return;
    const tile = document.getElementById(location.hash.slice(1));
    if (tile === null || !tile.hidden) return;
    find.value = "";
    family = "all";
    for (const other of chips) {
      other.setAttribute("aria-pressed", String(other.dataset.family === "all"));
    }
    apply();
    tile.scrollIntoView({ block: "center" });
  });

  controls.hidden = false;
  apply();
})();
</script>
</body>
</html>
`;
}
