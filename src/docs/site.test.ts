/**
 * `docs/index.html` and `docs/manual.html` are the published Pages site,
 * and they are hand-written: no generator, so nothing detected drift.
 * They sat at v0.9.0 while npm went to v0.14.0, and a person noticed
 * rather than CI. The existing artifact gate only checks that GENERATED
 * files regenerate byte-identically, and these had nothing to regenerate.
 *
 * This suite is the other half of the fix (see src/docs/site.ts for the
 * design). It checks three things the pages cannot check themselves:
 *
 *  1. The version stamps are current, and stamping cannot reach prose —
 *     including the roadmap's historical version strings, which a naive
 *     rewrite would flatten to today's version.
 *  2. Every count stated in the prose matches the live registry. Nothing
 *     here is hand-counted: the expected value always comes from
 *     `listNodeTypes()`, `listFieldFns()`, or a generated catalog.
 *  3. The roadmap has an entry for the version in package.json — exactly
 *     what went missing. The prose of that entry is deliberately NOT
 *     generated; it explains a mechanism and names its limitation, which
 *     is why the page is worth reading at all.
 *
 * Renders through the same module the generator uses (src/docs/site.ts,
 * imported from source so `npm test` works on a fresh clone with no
 * build). If a stamp test fails, the fix is `npm run build && npm run
 * docs:site`. If a count test fails, the fix is to correct the sentence
 * the failure quotes — never to relax the check.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listFieldFns, listNodeTypes } from "../index.js";
import {
  COUNT_CLAIMS,
  SITE_PAGES,
  extractFieldFnList,
  findStatedCounts,
  listRoadmapEntries,
  renderSiteVersion,
  scanStamps,
  withoutRoadmap,
} from "./site.js";

/**
 * Committed pages are read through git, and a Windows checkout with
 * `core.autocrlf=true` materializes them with CRLF. The generator
 * preserves whatever newlines it finds (it only ever swaps short inline
 * substrings), so normalizing here compares content rather than failing
 * every Windows clone on line endings the repository does not store.
 */
function readPage(name: string): string {
  const path = fileURLToPath(new URL(`../../docs/${name}`, import.meta.url));
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

/**
 * Any committed file a count claim points at, normalized the same way
 * {@link readPage} normalizes the site pages and for the same reason.
 * Separate from `readPage` because a claim may live outside `docs/` —
 * `llms.txt` is at the repository root, and being unreachable from here
 * is exactly why its count went a release out of date.
 */
function readRepoFile(relative: string): string {
  const path = fileURLToPath(new URL(`../../${relative}`, import.meta.url));
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

function readJson(relative: string): unknown[] {
  const path = fileURLToPath(new URL(`../../${relative}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as unknown[];
}

const PKG = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { version: string };

const PAGES = new Map(SITE_PAGES.map((page) => [page, readPage(page)] as const));

function page(name: string): string {
  const html = PAGES.get(name as (typeof SITE_PAGES)[number]);
  if (html === undefined) throw new Error(`site.test: docs/${name} is not in SITE_PAGES`);
  return html;
}

/**
 * The truth for every stated count.
 *
 * Node types and field functions come straight from the live registries.
 * Primitives and corpus examples come from their generated catalogs,
 * which are themselves pinned to the live registries by
 * primitives.test.ts and graphIndex.test.ts — so the chain still ends at
 * the code, and this file never counts anything by hand.
 */
const TRUTH: Record<string, number> = {
  "listNodeTypes().length": listNodeTypes().length,
  "listFieldFns().length": listFieldFns().length,
  "docs/primitives.json entries": readJson("docs/primitives.json").length,
  "docs/graphs.json entries": readJson("docs/graphs.json").length,
};

describe("site version stamps", () => {
  for (const name of SITE_PAGES) {
    it(`docs/${name} carries at least one well-formed stamp`, () => {
      const stamps = scanStamps(page(name), `docs/${name}`);
      expect(stamps.length, `docs/${name} has no <!--pcg:version--> marker`).toBeGreaterThan(0);
    });

    it(`docs/${name} is stamped with package.json's version`, () => {
      const committed = page(name);
      const { html } = renderSiteVersion(committed, PKG.version, `docs/${name}`);
      if (html !== committed) {
        throw new Error(
          [
            `docs/${name} is stale: its version stamp does not match package.json (${PKG.version}).`,
            "Run:",
            "",
            "  npm run build && npm run docs:site",
            "",
            ...stampDiff(committed, html),
          ].join("\n"),
        );
      }
    });

    it(`docs/${name} stamps idempotently`, () => {
      const once = renderSiteVersion(page(name), "9.9.9", `docs/${name}`).html;
      const twice = renderSiteVersion(once, "9.9.9", `docs/${name}`).html;
      expect(twice).toBe(once);
    });
  }

  /**
   * The failure this whole marker scheme exists to prevent. The roadmap
   * lists a version per release, and names older versions inside its
   * prose ("A gap v0.13.0 opened, closed"). A rewrite that matched
   * `v\d+\.\d+\.\d+` would replace all of it with the current version and
   * report success.
   */
  it("stamping a different version leaves every historical version untouched", () => {
    // ON THE ROADMAP PAGE, because that is where the history lives now.
    // A version of this test still reading index.html would find no
    // entries to protect and pass, which is the exact failure mode the
    // whole marker scheme exists against.
    const committed = page("roadmap.html");
    const bumped = renderSiteVersion(committed, "9.9.9", "docs/roadmap.html").html;

    const before = listRoadmapEntries(committed);
    const after = listRoadmapEntries(bumped);
    expect(before.length, "the roadmap should have entries to protect").toBeGreaterThan(5);
    expect(after).toEqual(before);

    // The strongest form of the guarantee: normalize BOTH pages to the
    // same stamp value and they must be byte-identical. Any difference
    // outside a stamp site — one historical version rewritten, one digit
    // of prose touched — survives normalization and fails here.
    const norm = (html: string) => renderSiteVersion(html, "0.0.0", "docs/roadmap.html").html;
    expect(norm(bumped)).toBe(norm(committed));

    // And the only lines that moved are the marked stamp lines.
    const a = committed.split("\n");
    const b = bumped.split("\n");
    expect(b.length).toBe(a.length);
    const moved = a.map((line, i) => [i + 1, line, b[i]] as const).filter(([, x, y]) => x !== y);
    expect(moved.length, "expected the roadmap page's footer stamp to move").toBe(1);
    for (const [line, , changedTo] of moved) {
      expect(changedTo, `docs/roadmap.html:${line} changed but carries no stamp marker`).toContain(
        "<!--pcg:version",
      );
    }
  });

  /**
   * The landing page has no roadmap left, so it needs its own form of
   * the claim: it still carries two stamps, and prose around them that a
   * bump must leave alone.
   */
  it("stamping index.html moves its two stamp lines and nothing else", () => {
    const committed = page("index.html");
    const bumped = renderSiteVersion(committed, "9.9.9", "docs/index.html").html;
    const a = committed.split("\n");
    const b = bumped.split("\n");
    expect(b.length).toBe(a.length);
    const moved = a.map((line, i) => [i + 1, line, b[i]] as const).filter(([, x, y]) => x !== y);
    expect(moved.length, "expected both index.html stamps to move").toBe(2);
    for (const [line, , changedTo] of moved) {
      expect(changedTo, `docs/index.html:${line} changed but carries no stamp marker`).toContain(
        "<!--pcg:version",
      );
    }
  });
});

describe("site stated counts", () => {
  for (const claim of COUNT_CLAIMS) {
    it(`${claim.page}: ${claim.label} matches ${claim.source}`, () => {
      const expected = TRUTH[claim.source];
      expect(expected, `site.test: no truth registered for "${claim.source}"`).toBeTypeOf("number");

      // The roadmap is history — "node types go 25 → 32", "429 tests" —
      // and must never be read as a claim about the current release.
      const text = readRepoFile(claim.page);
      const searched = claim.page === "docs/roadmap.html" ? withoutRoadmap(text) : text;
      const found = findStatedCounts(searched, claim.pattern);

      if (found.length === 0) {
        throw new Error(
          [
            `${claim.page}: could not find the sentence stating ${claim.label}.`,
            `It was matched by ${String(claim.pattern)}.`,
            "Either the sentence was reworded (update the pattern in src/docs/site.ts,",
            "in COUNT_CLAIMS) or the claim was deleted (remove the entry). A claim that",
            "matches nothing would pass forever without checking anything.",
          ].join("\n"),
        );
      }

      const wrong = found.filter((f) => f.value !== expected);
      if (wrong.length > 0) {
        throw new Error(
          [
            `${claim.page} states the wrong ${claim.label}.`,
            `  ${claim.source} reports ${expected}.`,
            ...wrong.map(
              (f) => `  ${claim.page}:${f.line} says ${f.value} — ${JSON.stringify(f.text)}`,
            ),
            "",
            `Fix: edit the prose on the line above to say ${expected}. The number is`,
            "asserted, not generated — the sentence around it is prose that belongs to a",
            "person, so nothing will rewrite it for you.",
          ].join("\n"),
        );
      }
    });
  }

  /**
   * The manual calls `listFieldFns()` "the closed set" and prints its
   * whole output. A count alone would miss a rename, so compare the names.
   */
  it("docs/manual.html prints the real listFieldFns() output", () => {
    const printed = extractFieldFnList(page("manual.html"));
    if (printed === undefined) {
      throw new Error(
        [
          "docs/manual.html: could not find the verbatim listFieldFns() output.",
          'It is located by the "<h3>listFieldFns()</h3>" heading and the first',
          "<pre><code> block after it. If the chapter was restructured, update",
          "extractFieldFnList() in src/docs/site.ts.",
        ].join("\n"),
      );
    }
    const live = listFieldFns();
    if (printed.join(",") !== live.join(",")) {
      const missing = live.filter((n) => !printed.includes(n));
      const extra = printed.filter((n) => !live.includes(n));
      throw new Error(
        [
          "docs/manual.html prints a field-function list that is not what listFieldFns() returns.",
          `  missing from the manual: ${missing.length > 0 ? missing.join(", ") : "(none)"}`,
          `  in the manual but not in the registry: ${extra.length > 0 ? extra.join(", ") : "(none)"}`,
          `  ${live.length} live names vs ${printed.length} printed`,
          "",
          "Fix: paste the current listFieldFns() output into the chapter 8 code block.",
        ].join("\n"),
      );
    }
  });
});

describe("site roadmap", () => {
  const entries = listRoadmapEntries(page("roadmap.html"));

  it("parses the roadmap", () => {
    expect(entries.length, 'docs/roadmap.html: no <ul class="roadmap"> entries found').toBeGreaterThan(5);
  });

  /**
   * The exact failure that started this: v0.14.0 was published and the
   * page still ended at v0.9.0. Only the entry's EXISTENCE is checked —
   * its prose explains a mechanism and states a cost, which is human work
   * and the reason the roadmap is worth reading.
   */
  it("has an entry for the released version", () => {
    const want = `v${PKG.version}`;
    const shipped = entries.map((e) => e.version);
    if (!shipped.includes(want)) {
      throw new Error(
        [
          `docs/roadmap.html: the roadmap has no entry for ${want}, the version in package.json.`,
          `  last entry with a version: ${shipped.filter((v) => /^v\d/.test(v)).at(-1) ?? "(none)"}`,
          "",
          "Fix: add a roadmap <li> for this release, following the shape of the one",
          "above it — what shipped, what it unblocked, and the limitation it carries.",
          "This entry is deliberately not generated: nothing can write that paragraph",
          "for you, which is exactly why it goes missing.",
        ].join("\n"),
      );
    }
  });

  /**
   * The headline test count is different in kind from every other stated
   * number here. It changes on almost every commit, and no registry
   * reports it: a suite cannot know its own total without running itself,
   * and adding these very tests moves it. Asserting it exactly would make
   * every new test fail the docs suite — which trains people to edit the
   * number without reading it, the exact habit that let the site fall
   * behind. A hard-coded floor is no better: another hand-written number
   * going stale in a second place.
   *
   * So it is not asserted against the code. It is asserted against the
   * release entry the author has to write anyway: the stat row and the
   * roadmap entry for the released version must agree. The stat row is
   * therefore read as "as of this release" — the same tense as the
   * `v0.14` stamp sitting beside it — and it is correct for it to stay
   * put while unreleased tests accumulate. Cost is zero between releases;
   * at the one moment the number matters, it cannot be forgotten.
   *
   * The other stats are checked against the LIVE registries instead,
   * because for those "live" is knowable and is the stronger claim.
   */
  it("the headline test count agrees with the current release entry", () => {
    const entry = entries.find((e) => e.version === `v${PKG.version}`);
    if (entry === undefined) return; // reported by the previous test

    const inEntry = /([\d,]+) tests/.exec(entry.body);
    const inStats = /<b>([\d,]+)<\/b><span>tests, all green<\/span>/.exec(page("index.html"));
    if (inEntry === null) {
      throw new Error(
        `docs/roadmap.html:${entry.line}: the v${PKG.version} roadmap entry does not end with "<n> tests." Add it — the landing page's stat row is checked against it.`,
      );
    }
    if (inStats === null) {
      throw new Error(
        'docs/index.html: could not find the "tests, all green" stat. If the stat row was reworded, update this test in src/docs/site.test.ts.',
      );
    }
    const fromEntry = Number((inEntry[1] as string).replaceAll(",", ""));
    const fromStats = Number((inStats[1] as string).replaceAll(",", ""));
    if (fromEntry !== fromStats) {
      throw new Error(
        [
          "the site disagrees with itself about the test count.",
          `  docs/index.html stat row says ${fromStats}`,
          `  docs/roadmap.html:${entry.line}, the v${PKG.version} entry, says ${fromEntry}`,
          "",
          "The stat row states the total as of the released version, like the `v` stamp",
          "beside it, so both numbers move together and only at a release: put what",
          "`npm test` reports into the new roadmap entry, then copy it to the stat row.",
          "Between releases, leave both alone — unreleased tests are not in this release.",
          "This is the one stated number not checked against the code: a suite cannot",
          "count itself, so the two places are pinned to each other instead.",
        ].join("\n"),
      );
    }
  });
});

/** The stamp lines that differ, quoted — never two whole pages. */
function stampDiff(committed: string, generated: string): string[] {
  const a = committed.split("\n");
  const b = generated.split("\n");
  const lines: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      lines.push(`  line ${i + 1}:`);
      lines.push(`    committed: ${JSON.stringify(a[i] ?? "<end of file>")}`);
      lines.push(`    generated: ${JSON.stringify(b[i] ?? "<end of file>")}`);
    }
  }
  return lines.length > 0 ? lines : ["  (pages differ only in trailing bytes)"];
}
