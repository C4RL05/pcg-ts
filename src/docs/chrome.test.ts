/**
 * The shared chrome is one model rendered into seven pages, and the two
 * ways it can go wrong are both silent.
 *
 * The first is depth. `docs/guides/` is one level down, so a rail link
 * that forgot its `../` still renders, still looks right in the markup,
 * and 404s only when a reader clicks it. Every link the chrome emits is
 * therefore resolved against a real page path and checked to point at a
 * file that exists on disk.
 *
 * The second is drift between the chrome's stylesheet and the site's. The
 * chrome is written against site.css's tokens but ships as a separate
 * file (and a second inlined copy inside the generated gallery), so a
 * token renamed in site.css would leave the chrome referencing a variable
 * nobody defines — which CSS resolves to nothing, without an error. The
 * suite reads BOTH hosts — site.css and the gallery's own inline `:root`
 * — and checks every `var(--…)` the chrome uses is declared in each. One
 * host is not enough: the two palettes are separate copies, so a token
 * present in one and missing from the other fails on exactly one page.
 *
 * Imported from source, so `npm test` works on a fresh clone with no
 * build. If a link test fails, the fix is in `SITE_INDEX`; if a token
 * test fails, the fix is in `CHROME_CSS` — never to relax the check.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CHROME_CSS,
  HOME_PAGE,
  SITE_INDEX,
  crumbFor,
  depthPrefix,
  escapeHtml,
  extractToc,
  renderChromeHeader,
  renderChromeRail,
  resolveHref,
} from "./chrome.js";
import { SITE_PAGES } from "./site.js";

function repoFile(relative: string): string {
  return fileURLToPath(new URL(`../../${relative}`, import.meta.url));
}

/** Every model href that names a path on this site, not another origin. */
const LOCAL_ITEMS = SITE_INDEX.flatMap((group) =>
  group.items.filter((item) => !/^[a-z][a-z0-9+.-]*:/i.test(item.href)),
);

/** The pages that actually carry the chrome — every SITE_PAGE but home. */
const CHROME_PAGES = SITE_PAGES.filter((page) => page !== HOME_PAGE);

describe("depth", () => {
  it("prefixes a top-level page with ./ and a guide with ../", () => {
    expect(depthPrefix("manual.html")).toBe("./");
    expect(depthPrefix("guides/racetrack.html")).toBe("../");
  });

  it("leaves absolute URLs and fragments alone", () => {
    const url = "https://github.com/C4RL05/pcg-ts";
    expect(resolveHref(url, "guides/racetrack.html")).toBe(url);
    expect(resolveHref("#install", "guides/racetrack.html")).toBe("#install");
  });
});

describe("the site index", () => {
  it("points every local item at a file that exists", () => {
    for (const item of LOCAL_ITEMS) {
      // A directory href (demos/, editor/) is served by its index.html.
      const target = item.href.endsWith("/") ? `${item.href}index.html` : item.href;
      const path = repoFile(`docs/${target}`);
      expect(existsSync(path), `${item.label} → docs/${target} does not exist`).toBe(true);
    }
  });

  it("never lists home — home is what the breadcrumb points back to", () => {
    expect(LOCAL_ITEMS.some((item) => item.href === HOME_PAGE)).toBe(false);
  });

  it("badges every markdown item, and only those, as md", () => {
    for (const group of SITE_INDEX) {
      for (const item of group.items) {
        expect(item.md === true, `${item.label}`).toBe(item.href.endsWith(".md"));
      }
    }
  });

  it("resolves every link on every chrome-bearing page to a real file", () => {
    for (const page of CHROME_PAGES) {
      for (const item of LOCAL_ITEMS) {
        const href = resolveHref(item.href, page);
        // Resolve the way a browser would: relative to the page's directory.
        const dir = page.includes("/") ? page.slice(0, page.lastIndexOf("/") + 1) : "";
        const resolved = new URL(href, `file:///docs/${dir}`).pathname;
        const target = resolved.endsWith("/") ? `${resolved}index.html` : resolved;
        expect(
          existsSync(repoFile(target.replace(/^\//, ""))),
          `${page} → ${item.label} resolves to ${target}, which does not exist`,
        ).toBe(true);
      }
    }
  });
});

describe("the breadcrumb", () => {
  it("places every chrome-bearing page in a group", () => {
    for (const page of CHROME_PAGES) {
      expect(crumbFor(page), `${page} is not in SITE_INDEX, so its header has no crumb`).toBeDefined();
    }
  });

  it("has no crumb for home", () => {
    expect(crumbFor(HOME_PAGE)).toBeUndefined();
  });

  it("hides the crumb separators from assistive tech", () => {
    // Otherwise every breadcrumb announces "slash" twice.
    const html = renderChromeHeader("guides/racetrack.html", "0.17.0");
    expect(html).not.toMatch(/<span class="sep">/);
    expect((html.match(/<span class="sep" aria-hidden="true">/g) ?? []).length).toBe(2);
  });

  it("does not repeat the wordmark's own name", () => {
    const html = renderChromeHeader("guides/racetrack.html", "0.17.0");
    const crumb = html.slice(html.indexOf("sitehdr-crumb"), html.indexOf("sitehdr-meta"));
    expect(crumb).not.toContain(">pcg-ts<");
  });
});

describe("the header", () => {
  it("sends the mark home at the reader's own depth", () => {
    expect(renderChromeHeader("manual.html", "0.17.0")).toContain('href="./index.html"');
    expect(renderChromeHeader("guides/racetrack.html", "0.17.0")).toContain('href="../index.html"');
  });

  it("stamps the version it is given", () => {
    expect(renderChromeHeader("manual.html", "1.2.3")).toContain(">v1.2.3<");
  });

  it("carries section links for the widths where the rail is gone", () => {
    // The rail is display:none below 861px, so without these a reader on a
    // phone could reach home and nothing else.
    const html = renderChromeHeader("guides/racetrack.html", "0.17.0");
    const row = html.slice(html.indexOf("sitehdr-sections"), html.indexOf("sitehdr-meta"));
    for (const group of SITE_INDEX) expect(row).toContain(`>${group.label}<`);
    // and each points somewhere real, at the reader's depth
    expect(row).toContain('href="../manual.html"');
    expect((row.match(/class="here"/g) ?? []).length).toBe(1);
  });

  it("offers a skip link, and every page has its target", () => {
    // The rail puts 19-36 links before the first word of the article.
    expect(renderChromeHeader("manual.html", "0.17.0")).toContain(
      '<a class="skip-to-main" href="#main">',
    );
    for (const page of CHROME_PAGES) {
      const html = readFileSync(repoFile(`docs/${page}`), "utf8");
      expect(html, `docs/${page} has no #main for the skip link`).toMatch(/<main\b[^>]*\bid="main"/);
    }
  });

  it("gives the mark link an accessible name", () => {
    // The svg is aria-hidden and site.css's .vh helper is scoped to
    // .hero-title, so the name has to be an attribute here.
    expect(renderChromeHeader("manual.html", "0.17.0")).toMatch(/<a class="sitehdr-home"[^>]*aria-label=/);
  });
});

describe("the rail", () => {
  it("marks exactly one item as the current page", () => {
    for (const page of CHROME_PAGES) {
      const html = renderChromeRail(page, []);
      expect((html.match(/class="here"/g) ?? []).length, `${page}`).toBe(1);
      expect((html.match(/aria-current="page"/g) ?? []).length, `${page}`).toBe(1);
    }
  });

  it("marks nothing on a page outside the index", () => {
    expect(renderChromeRail(HOME_PAGE, [])).not.toContain('class="here"');
  });

  it("renders the page's own contents last, and omits the group when empty", () => {
    const withToc = renderChromeRail("manual.html", [{ id: "install", text: "Install" }]);
    expect(withToc).toContain("On this page");
    expect(withToc.indexOf("On this page")).toBeGreaterThan(withToc.indexOf("Reference"));
    expect(withToc).toContain('href="#install"');
    expect(renderChromeRail("manual.html", [])).not.toContain("On this page");
  });

  it("keeps the article's h1 the first heading on the page", () => {
    // Group labels are <p aria-hidden> with the name on the <ul>, so the
    // rail does not put six <h2> above the page's own <h1>.
    const rail = renderChromeRail("manual.html", [{ id: "a", text: "A" }]);
    expect(rail).not.toContain("<h2");
    expect(rail).toContain('<ul aria-label="Docs">');
    expect(rail).toContain('<p class="rail-lbl" aria-hidden="true">Docs</p>');
  });

  it("separates the md badge from the label it follows", () => {
    // Without the space the accessible name is "Node referencemd".
    expect(renderChromeRail("manual.html", [])).toContain("Node reference <span");
  });

  it("escapes a label that carries markup syntax", () => {
    expect(escapeHtml("Authoring & parity")).toBe("Authoring &amp; parity");
    expect(renderChromeRail("manual.html", [])).toContain("Authoring &amp; parity");
    expect(renderChromeRail("manual.html", [])).not.toMatch(/Authoring & parity/);
  });
});

describe("the table of contents", () => {
  it("lets a heading give the rail a shorter label", () => {
    // The guides write headings as sentences; a 228px rail cannot.
    const html = '<h2 id="loop" data-toc="The loop">Round until nothing moves</h2>';
    expect(extractToc(html)).toEqual([{ id: "loop", text: "The loop" }]);
  });

  it("falls back to the heading text when data-toc is absent or blank", () => {
    expect(extractToc('<h2 id="a" data-toc="">Heading</h2>')).toEqual([{ id: "a", text: "Heading" }]);
  });

  it("takes every h2 that carries an id, and only those", () => {
    const html = `
      <h2 id="one">First</h2>
      <h2>Unlinkable, so not listed</h2>
      <h2 id="two" class="x">Second <code>bit</code></h2>`;
    expect(extractToc(html)).toEqual([
      { id: "one", text: "First" },
      { id: "two", text: "Second bit" },
    ]);
  });

  it("finds the headings of every chrome-bearing page as committed", () => {
    for (const page of CHROME_PAGES) {
      const html = readFileSync(repoFile(`docs/${page}`), "utf8");
      expect(extractToc(html).length, `${page} has no <h2 id> — its rail would have no contents`).toBeGreaterThan(0);
    }
  });
});

describe("the stylesheet", () => {
  const siteCss = readFileSync(repoFile("docs/site.css"), "utf8");

  const used = [...new Set([...CHROME_CSS.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1] as string))];

  it("uses only tokens site.css declares", () => {
    for (const token of used) {
      expect(
        siteCss.includes(`${token}:`),
        `chrome.css uses ${token}, which docs/site.css does not declare`,
      ).toBe(true);
    }
  });

  it("uses only tokens the gallery's own palette declares too", () => {
    // The linked pages are not the only host. gallery.html inlines this
    // same string beside a palette copy of its own, so a token that only
    // site.css declares resolves to nothing THERE and nowhere else — and
    // an invalid var() is not an error, it is a declaration that quietly
    // computes away. That is how the hover glitch's --r/--b split shipped
    // dead on one page out of seven while looking right on the other six.
    const gallery = readFileSync(repoFile("docs/gallery.html"), "utf8");
    const root = /:root \{([^}]*)\}/.exec(gallery);
    expect(root, "docs/gallery.html declares no :root palette").not.toBeNull();
    for (const token of used) {
      expect(
        (root as RegExpExecArray)[1].includes(`${token}:`),
        `chrome.css uses ${token}, which docs/gallery.html's inline :root does not declare`,
      ).toBe(true);
    }
  });

  it("keeps site.css's stated language: no radius, no shadow, no gradient", () => {
    for (const [pattern, what] of [
      [/border-radius:\s*(?!0)/, "a non-zero border-radius"],
      [/box-shadow:\s*(?!none)/, "a box-shadow"],
      [/gradient\(/, "a gradient"],
    ] as const) {
      expect(pattern.test(CHROME_CSS), `chrome.css introduces ${what}, which site.css does not use`).toBe(
        false,
      );
    }
  });

  it("hides the section row only where a rail is actually shown", () => {
    // The row and the rail are one navigation in two sizes. The row is the
    // default; it is suppressed only when a rail exists AND the viewport is
    // wide enough to show it. Keyed on :has(.rail), not on width alone,
    // because gallery.html has the header and no rail at any width.
    expect(CHROME_CSS).toMatch(/\.sitehdr-sections \{\s*display: flex/);
    expect(CHROME_CSS).toMatch(
      /@media \(min-width: 861px\) \{\s*body:has\(\.rail\) \.sitehdr-sections \{ display: none; \}/,
    );
    expect(CHROME_CSS).toMatch(/@media \(max-width: 860px\) \{ \.rail \{ display: none; \} \}/);
  });

  it("answers a hover on the mark with the glitch, not with green", () => {
    // The green tint was the old affordance and it is now the
    // reduced-motion fallback only. If someone reinstates the plain rule
    // the mark stops being the logo doing its one trick and goes back to
    // being a link that turns a colour, so pin both halves.
    expect(CHROME_CSS).toMatch(/\.sitehdr-home:hover \.sitehdr-mark \{\s*animation:\s*sitehdr-tear/);
    expect(CHROME_CSS).toContain("@keyframes sitehdr-tear");
    expect(CHROME_CSS).toContain("@keyframes sitehdr-split");
    expect(CHROME_CSS).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.sitehdr-home:hover \.sitehdr-mark \{ animation: none; \}\s*\.sitehdr-home:hover \{ color: var\(--accent\); \}/,
    );
    // Cut the whole reduced-motion block out and there must be no rule
    // left that colours the link on hover. Slicing at the query's start
    // instead would miss one reinstated after it, and matching a fixed
    // one-line spelling would miss one that got reformatted.
    const at = CHROME_CSS.indexOf("@media (prefers-reduced-motion");
    let depth = 0;
    let rest = CHROME_CSS.slice(0, at);
    for (let i = CHROME_CSS.indexOf("{", at); i < CHROME_CSS.length; i++) {
      if (CHROME_CSS[i] === "{") depth += 1;
      else if (CHROME_CSS[i] === "}" && (depth -= 1) === 0) {
        rest += CHROME_CSS.slice(i + 1);
        break;
      }
    }
    expect(rest, "the reduced-motion block was not found or is unbalanced").not.toBe(
      CHROME_CSS.slice(0, at),
    );
    expect(rest).not.toMatch(/\.sitehdr-home:hover[^{}]*\{[^{}]*color:/);
  });

  it("splits the mark on the primaries the palette reserves for marks", () => {
    // --r and --b, never --accent, and never a raw hex: the split is the
    // lockup's own. A blur radius would turn it into the soft shadow
    // site.css does not use. The paren-aware pattern matters -- a lazy
    // one stops inside var(--r) and would skip a hex-coloured stop
    // entirely instead of failing on it.
    const shadows = [...CHROME_CSS.matchAll(/drop-shadow\(((?:[^()]|\([^()]*\))*)\)/g)].map(
      (m) => m[1] as string,
    );
    expect(shadows.length, "the hover glitch draws no channel split").toBeGreaterThan(0);
    const CHANNEL = /^(-?\d+)(?:px)? (-?\d+)(?:px)? 0 var\(--([rb])\)$/;
    for (const arg of shadows) {
      expect(CHANNEL.test(arg), `drop-shadow(${arg}) is not a hard-offset channel split`).toBe(true);
    }

    // The two channels of a stop separate in opposite directions by the
    // same amount -- that is what reads as a split rather than a blur or
    // a double image. Which of them leads flips frame to frame, so the
    // invariant is the negation, not a fixed order.
    const body = /@keyframes sitehdr-split \{([\s\S]*?)\n\}/.exec(CHROME_CSS);
    expect(body, "the split keyframes are missing or unterminated").not.toBeNull();
    let pairs = 0;
    for (const line of (body as RegExpExecArray)[1].split("\n")) {
      const stop = [...line.matchAll(/drop-shadow\(((?:[^()]|\([^()]*\))*)\)/g)].map(
        (m) => CHANNEL.exec(m[1] as string) as RegExpExecArray,
      );
      if (stop.length === 0) continue;
      pairs += 1;
      expect(stop.length, `${line.trim()} does not split both channels`).toBe(2);
      const [a, b] = stop;
      expect([a[3], b[3]].sort().join(""), `${line.trim()} is not one --r and one --b`).toBe("br");
      // Summed rather than negated: Object.is separates -0 from 0, and a
      // stop with no vertical offset writes 0 on both channels.
      expect(Number(a[1]) + Number(b[1]), `${line.trim()} separates x unevenly`).toBe(0);
      expect(Number(a[2]) + Number(b[2]), `${line.trim()} separates y unevenly`).toBe(0);
      expect(Number(a[1]), `${line.trim()} separates the channels by nothing`).not.toBe(0);
    }
    expect(pairs, "the split keyframes carry no channel stop").toBeGreaterThan(0);
  });

  it("contains no backtick", () => {
    // CHROME_CSS is a template literal, so a backtick in a CSS comment
    // terminates it and the build fails somewhere else entirely with
    // "Expected ; but found g". Name the real cause here instead.
    expect(CHROME_CSS.includes("`"), "a backtick in CHROME_CSS ends its template literal").toBe(
      false,
    );
  });

  it("clears the sticky bar when an in-page anchor is targeted", () => {
    // Without this a link to #install lands with the heading under the bar.
    expect(CHROME_CSS).toMatch(/scroll-margin-top/);
  });
});

describe("the pages", () => {
  it("gives every chrome-bearing page both holes, and home neither", () => {
    for (const page of CHROME_PAGES) {
      const html = readFileSync(repoFile(`docs/${page}`), "utf8");
      for (const kind of ["chrome-header", "chrome-rail"]) {
        expect(html, `docs/${page} has no <!--pcg:${kind}--> hole`).toContain(`<!--pcg:${kind}-->`);
        expect(html, `docs/${page} has no <!--/pcg:${kind}--> close`).toContain(`<!--/pcg:${kind}-->`);
      }
    }
    const home = readFileSync(repoFile(`docs/${HOME_PAGE}`), "utf8");
    expect(home).not.toContain("<!--pcg:chrome-header-->");
    expect(home).not.toContain("<!--pcg:chrome-rail-->");
  });

  it("links the generated stylesheet at the right depth", () => {
    for (const page of CHROME_PAGES) {
      const html = readFileSync(repoFile(`docs/${page}`), "utf8");
      expect(html, `docs/${page} does not link chrome.css`).toContain(
        `href="${depthPrefix(page)}chrome.css"`,
      );
    }
  });

  it("has no hard-coded published-origin self-links left", () => {
    // They break the dev server and any fork of the repo.
    for (const page of SITE_PAGES) {
      const html = readFileSync(repoFile(`docs/${page}`), "utf8");
      expect(html, `docs/${page} still hard-codes the published origin`).not.toContain(
        "c4rl05.github.io/pcg-ts",
      );
    }
  });
});
