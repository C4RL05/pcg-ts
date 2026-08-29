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
 * suite reads site.css and checks every `var(--…)` the chrome uses is
 * declared there.
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

  it("uses only tokens site.css declares", () => {
    const used = new Set([...CHROME_CSS.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1] as string));
    for (const token of used) {
      expect(
        siteCss.includes(`${token}:`),
        `chrome.css uses ${token}, which docs/site.css does not declare`,
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
