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
import type { InstancesItem, NodeHandle } from "../index.js";
import {
  Graph,
  cook,
  deserializeGraph,
  fbm,
  fieldFromJson,
  firstGeometry,
  getNodeType,
  jitterPoints,
  listFieldFns,
  listNodeTypes,
  perlinNoise,
  pointScatterInBounds,
  remap,
  spawnInstances,
} from "../index.js";
import {
  CODE_ECHOES,
  COUNT_CLAIMS,
  ERROR_TRANSCRIPTS,
  SITE_PAGES,
  TRANSCRIPT_CLAIMS,
  extractCodeBlock,
  extractErrorTranscript,
  extractFieldFnList,
  extractManualExample,
  extractPointAttrList,
  extractSampleRows,
  extractTransformRow,
  findStatedCounts,
  findTranscriptMatches,
  matchesPrinted,
  extractLede,
  LEDE_SOURCE,
  ledeToHtml,
  listRoadmapEntries,
  renderSiteLede,
  renderSiteVersion,
  roundLike,
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

describe("the borrowed lede", () => {
  const markdown = readRepoFile(LEDE_SOURCE);
  const ledeHtml = ledeToHtml(extractLede(markdown, LEDE_SOURCE), LEDE_SOURCE);

  /**
   * THE DRIFT THIS EXISTS TO CATCH. Two copies of a paragraph is two
   * paragraphs: edit one and the other is quietly wrong, with nothing to
   * say so. The page carries a hole and the README carries the words, so
   * re-rendering has to be a no-op.
   */
  it("docs/index.html carries exactly what README.md says", () => {
    const committed = page("index.html");
    const { html } = renderSiteLede(committed, ledeHtml, "docs/index.html");
    if (html !== committed) {
      throw new Error(
        [
          `docs/index.html's lede is not ${LEDE_SOURCE}'s. It is generated, so the page is what is stale.`,
          "Run:",
          "",
          "  npm run build && npm run docs:site",
          "",
          "If the words should change, change them in " + LEDE_SOURCE + " — editing the page",
          "edits a build artifact and the next docs run puts it back.",
        ].join("\n"),
      );
    }
  });

  it("renders the markdown the lede actually uses", () => {
    const html = ledeToHtml("**bold** and *italic*" + "\n\n" + "a second paragraph", "test");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html.match(/<p>/g)?.length).toBe(2);
  });

  it("escapes markup rather than passing it through", () => {
    expect(ledeToHtml("a < b & c > d", "test")).toContain("a &lt; b &amp; c &gt; d");
  });

  /**
   * The failure mode worth a test of its own: an unimplemented construct
   * that reached the page would publish its own syntax, and nobody reads
   * their own landing page closely enough to notice a stray bracket.
   */
  it.each([
    ["a link", "see [the manual](./manual.html)"],
    ["a code span", "call `cook()`"],
    ["a list", "- one\n- two"],
    ["a heading", "# Title"],
  ])("refuses %s rather than emitting it literally", (_what, md) => {
    expect(() => ledeToHtml(md, "test")).toThrow(/does not implement/);
  });
});

/* ------------------------------------------------------------------ *
 * Transcripts of measured output
 * ------------------------------------------------------------------ */

/**
 * The manual quotes output. "Actual output", "a real trace", "From a real
 * cook", "Every string below is real output" — those sentences are the
 * page's strongest promises and, until this section existed, the only
 * ones with nothing behind them. The counts above could not have helped:
 * a transcript has no count in it, and two of these were already wrong.
 *
 * The whole design is in src/docs/site.ts under "Transcripts". The one
 * rule worth repeating here, because it is what separates a check from a
 * second copy of the answer: EVERY expected value below is measured by
 * running the live library in this process. Chapter 9's example is a JSON
 * document printed on the page, so the page itself is the input — nothing
 * is transcribed and nothing here can be "fixed" by editing a literal.
 */

/** A live cook, reduced to the scalars the page prints about it. */
type Measurements = Record<string, number>;

function stats(into: Measurements, prefix: string, s: { cooked: number; cached: number }): void {
  into[`${prefix}.stats.cooked`] = s.cooked;
  into[`${prefix}.stats.cached`] = s.cached;
}

/** min / max / mean of one column, per component, under `prefix`. */
function column(
  into: Measurements,
  prefix: string,
  data: ArrayLike<number>,
  count: number,
  tupleSize: number,
): void {
  const axes = tupleSize === 3 ? ["x", "y", "z"] : [""];
  for (let c = 0; c < tupleSize; c++) {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const v = data[i * tupleSize + c] as number;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    const axis = axes[c] === "" ? "" : `.${axes[c] as string}`;
    into[`${prefix}.min${axis}`] = min;
    into[`${prefix}.max${axis}`] = max;
    into[`${prefix}.mean${axis}`] = sum / count;
  }
}

const MANUAL = page("manual.html");

/** The chapter 9 document, read off the page rather than copied here. */
const EXAMPLE_DOC = extractManualExample(MANUAL);

/**
 * Rebuilt from the code chapter 1 prints. Guarded by CODE_ECHOES, which
 * fails if any literal this depends on stops being on the page.
 */
function chapter1Graph(): Graph {
  const graph = new Graph(42);
  const scatter = graph.add(pointScatterInBounds, {
    count: 500,
    boundsMin: [0, 0, 0],
    boundsMax: [50, 0, 50],
  });
  const jitter = graph.add(jitterPoints, {
    amount: remap(fbm(perlinNoise, { seed: 7, frequency: 0.05 }), -1, 1, 0, 1),
  });
  graph.connect(scatter, "out", jitter, "in");
  graph.output(jitter, "out", "points");
  return graph;
}

/** Rebuilt from the code chapter 8 prints. Guarded by CODE_ECHOES. */
function chapter8GridGraph(): { graph: Graph; node: NodeHandle } {
  const { def } = getNodeType("pointGrid");
  const graph = new Graph(5);
  const node = graph.add(def, { countX: 3, countZ: 3 });
  graph.output(node, "out", "p");
  return { graph, node };
}

/**
 * Chapter 2.3's trace is about the SCHEDULER, not about content: "given
 * scatter → jitter → spawn with both `points` (on jitter) and `instances`
 * (on spawn) declared", cooking one output must schedule two nodes and
 * the follow-up must schedule one. No parameter can change those numbers,
 * which is why this graph is built from the shape the prose states rather
 * than pinned to literals the way chapters 1 and 8 are.
 */
function chapter23Graph(): Graph {
  const graph = new Graph(1);
  const scatter = graph.add(pointScatterInBounds, { count: 100 });
  const jitter = graph.add(jitterPoints, {});
  const spawn = graph.add(spawnInstances, { assetId: "rock" });
  graph.connect(scatter, "out", jitter, "in");
  graph.connect(jitter, "out", spawn, "in");
  graph.output(jitter, "out", "points");
  graph.output(spawn, "instances", "instances");
  return graph;
}

async function measure(): Promise<Measurements> {
  const m: Measurements = {};

  /* --- chapter 1 --- */
  {
    const graph = chapter1Graph();
    const result = await cook(graph);
    const geo = firstGeometry(result.outputs.points);
    if (geo === undefined) throw new Error("site.test: chapter 1 graph produced no geometry");
    m["cook(chapter 1 graph).pointCount"] = geo.pointCount;
    const P = geo.attrs.point.require("P");
    for (let i = 0; i < 3; i++) m[`cook(chapter 1 graph).P[${i}]`] = P.data[i] as number;
    stats(m, "cook(chapter 1 graph)", result.stats);
    stats(m, "second cook(chapter 1 graph)", (await cook(graph)).stats);
  }

  /* --- chapter 2.3 --- */
  {
    const graph = chapter23Graph();
    const partial = await cook(graph, { outputs: ["points"] });
    stats(m, 'cook(scatter→jitter→spawn, { outputs: ["points"] })', partial.stats);
    expect(
      Object.keys(partial.outputs),
      "chapter 2.3 also claims the partial result's keys are exactly the outputs asked for",
    ).toEqual(["points"]);
    stats(m, "second cook(scatter→jitter→spawn)", (await cook(graph)).stats);
  }

  /* --- chapter 8 --- */
  {
    const { graph } = chapter8GridGraph();
    const geo = firstGeometry((await cook(graph)).outputs.p);
    if (geo === undefined) throw new Error("site.test: chapter 8 grid produced no geometry");
    m["cook(chapter 8 pointGrid graph).pointCount"] = geo.pointCount;
  }

  /* --- chapters 9 and 14: the document printed on the page --- */
  if (EXAMPLE_DOC !== undefined) {
    const doc = JSON.parse(EXAMPLE_DOC) as {
      nodes: { id: string; params?: Record<string, unknown> }[];
    };
    const scatter = doc.nodes.find((n) => n.id === "scatter");
    m["chapter 9 document's scatter `count` param"] = Number(scatter?.params?.count);

    // The CLI chapter walks ONE graph through cook → edit → recook →
    // removeNode → recook, so the cache states it prints only make sense
    // in that order. This is that walk.
    const graph = deserializeGraph(doc);
    const cold = await cook(graph);
    stats(m, "cook(chapter 9 document)", cold.stats);
    const geo = firstGeometry(cold.outputs.points);
    if (geo === undefined) throw new Error("site.test: chapter 9 document produced no geometry");
    m["cook(chapter 9 document).pointCount"] = geo.pointCount;
    m["cook(chapter 9 document).vertexCount"] = geo.vertexCount;
    m["cook(chapter 9 document).primitiveCount"] = geo.primitiveCount;
    const P = geo.attrs.point.require("P");
    column(m, "cook(chapter 9 document).P", P.data, geo.pointCount, 3);

    const instances = cold.outputs.instances.find(
      (item): item is InstancesItem => item.kind === "instances",
    );
    const batch = instances?.batches[0];
    if (batch === undefined) throw new Error("site.test: chapter 9 document produced no batch");
    m["cook(chapter 9 document).batches[0].count"] = batch.count;
    m["cook(chapter 9 document).batches[0].transforms.length"] = batch.transforms.length;
    m["cook(chapter 9 document).batches.length"] = instances?.batches.length ?? 0;
    m["cook(chapter 9 document).instance count"] = (instances?.batches ?? []).reduce(
      (total, b) => total + b.count,
      0,
    );

    const byId = Object.fromEntries(graph.describe().nodes.map((n) => [n.id, { id: n.id }])) as
      Record<string, NodeHandle<Record<string, unknown>>>;
    graph.setParam(
      byId.density as NodeHandle<Record<string, unknown>>,
      "value",
      fieldFromJson({
        fn: "fbm",
        base: "perlinNoise",
        opts: { frequency: 0.09, octaves: 4, normalized: true },
      }),
    );
    const edited = await cook(graph);
    stats(m, "cook(chapter 9 document, density frequency 0.09)", edited.stats);
    const editedGeo = firstGeometry(edited.outputs.points);
    if (editedGeo === undefined) {
      throw new Error("site.test: the edited chapter 9 document produced no geometry");
    }
    m["cook(chapter 9 document, density frequency 0.09).pointCount"] = editedGeo.pointCount;

    graph.removeNode(byId.spawn as NodeHandle);
    stats(m, "cook(chapter 9 document, spawn removed)", (await cook(graph)).stats);

    // `pcg inspect --node density` cooks just enough to produce that
    // pin, on a graph whose caches are cold. A separate graph, then.
    const upToDensity = deserializeGraph(doc);
    const densityNode = upToDensity
      .describe()
      .nodes.find((n) => n.id === "density") as { id: string } | undefined;
    if (densityNode !== undefined) {
      upToDensity.output(densityNode, "out", "d");
      const inspected = await cook(upToDensity, { outputs: ["d"] });
      stats(m, "cook(chapter 9 document, up to the density node)", inspected.stats);
      const mid = firstGeometry(inspected.outputs.d);
      if (mid !== undefined) {
        const key = "cook(chapter 9 document, up to the density node)";
        m[`${key}.pointCount`] = mid.pointCount;
        m[`${key}.vertexCount`] = mid.vertexCount;
        m[`${key}.primitiveCount`] = mid.primitiveCount;
        column(m, `${key}.P`, mid.attrs.point.require("P").data, mid.pointCount, 3);
        column(m, `${key}.density`, mid.attrs.point.require("density").data, mid.pointCount, 1);
        column(m, `${key}.seed`, mid.attrs.point.require("seed").data, mid.pointCount, 1);
      }
    }

    // `pcg inspect g.json --output points --json` needs the spawner's
    // upstream and not the spawner, again from cold.
    const forPoints = deserializeGraph(doc);
    stats(
      m,
      'cook(chapter 9 document, { outputs: ["points"] })',
      (await cook(forPoints, { outputs: ["points"] })).stats,
    );
  }

  return m;
}

/**
 * One set of cooks, shared by every transcript check.
 *
 * Created on first use rather than at module load: a rejection from a
 * promise nothing is awaiting yet is an unhandled rejection, which node
 * reports as a crash instead of as the failing test it is. Built lazily,
 * the first `await` is always the handler.
 */
let measured: Promise<Measurements> | undefined;
function measurements(): Promise<Measurements> {
  measured ??= measure();
  return measured;
}

describe("manual transcripts of measured output", () => {
  it("finds the chapter 9 document the rest of these checks are cooked from", () => {
    if (EXAMPLE_DOC === undefined) {
      throw new Error(
        [
          "docs/manual.html: could not find chapter 9's complete working example.",
          'It is located by the "<h3>A complete working example</h3>" heading and the',
          "first <pre><code> block after it. Every transcript in chapters 2, 9 and 14",
          "is checked by cooking THAT document, so if the chapter was restructured,",
          "update extractManualExample() in src/docs/site.ts rather than deleting",
          "these tests — without the document they check nothing.",
        ].join("\n"),
      );
    }
    expect(() => JSON.parse(EXAMPLE_DOC)).not.toThrow();
  });

  for (const claim of TRANSCRIPT_CLAIMS) {
    it(`${claim.page}: ${claim.label}`, async () => {
      const measured = await measurements();
      const text = readRepoFile(claim.page);
      const found = findTranscriptMatches(text, claim.pattern);

      if (found.length === 0) {
        throw new Error(
          [
            `${claim.page}: could not find the transcript showing ${claim.label}.`,
            `It was matched by ${String(claim.pattern)}.`,
            "Either the transcript was reworded or reformatted (update the pattern in",
            "src/docs/site.ts, in TRANSCRIPT_CLAIMS) or it was deleted (remove the entry).",
            "A claim that matches nothing would pass forever without checking anything.",
          ].join("\n"),
        );
      }

      const wrong: string[] = [];
      for (const match of found) {
        for (const [group, source] of Object.entries(claim.sources)) {
          const printed = match.values[group];
          if (printed === undefined) {
            throw new Error(
              `src/docs/site.ts: TRANSCRIPT_CLAIMS entry "${claim.label}" names a group "${group}" its pattern does not capture.`,
            );
          }
          const live = measured[source];
          if (live === undefined) {
            throw new Error(
              `src/docs/site.ts: TRANSCRIPT_CLAIMS entry "${claim.label}" names a source "${source}" that measure() in src/docs/site.test.ts does not produce.`,
            );
          }
          // The page decides its own precision: round the measurement to
          // as many decimals as the page printed, then require equality —
          // and a page that printed no decimal point is claiming a whole
          // number, so it has to be one. See matchesPrinted.
          const expectedText = String(roundLike(live, printed));
          if (!matchesPrinted(live, printed)) {
            wrong.push(
              `  ${claim.page}:${match.line} prints ${group} = ${printed}, but ${source} is ${live} (${expectedText} at the printed precision)`,
            );
          }
        }
      }

      if (wrong.length > 0) {
        throw new Error(
          [
            `${claim.page} quotes output that the library no longer produces (${claim.label}).`,
            ...wrong,
            `  in: ${JSON.stringify(found[0]?.text ?? "")}`,
            "",
            "Fix: correct the transcript on the page to the value on the right. These",
            "numbers are MEASURED, not written down — nothing in the test suite holds a",
            "copy of them, so there is no second place to edit and no way to make this",
            "pass except by making the page true. If the change to the library was the",
            "mistake, fix the library instead; the page is telling you what it did.",
          ].join("\n"),
        );
      }
    });
  }

  /**
   * Sixteen floats, compared as sixteen floats. A transform is where a
   * change arrives looking plausible rather than looking broken — swap
   * row-major for column-major and the count is still sixteen — so the
   * count of them is not the claim, the matrix is.
   */
  it("docs/manual.html prints the real first instance transform", async () => {
    const printed = extractTransformRow(MANUAL);
    if (printed === undefined) {
      throw new Error(
        [
          "docs/manual.html: could not find chapter 2.6's printed instance transform.",
          "It is located by the `batch.transforms.subarray(0, 16)` line and the `// [ … ]`",
          "comment under it. Update extractTransformRow() in src/docs/site.ts if the",
          "example moved.",
        ].join("\n"),
      );
    }
    const live = await liveTransform();
    expect(
      printed.length,
      `docs/manual.html prints ${printed.length} floats for a 4×4 transform`,
    ).toBe(16);
    const wrong = printed
      .map((text, i) => [i, text, live[i] as number] as const)
      .filter(([, text, value]) => !matchesPrinted(value, text));
    if (wrong.length > 0) {
      throw new Error(
        [
          "docs/manual.html prints an instance transform the spawner no longer produces.",
          ...wrong.map(
            ([i, text, value]) => `  element ${i}: page says ${text}, cook says ${value}`,
          ),
          "",
          `  page:  [ ${printed.join(", ")} ]`,
          `  cook:  [ ${live.map((v, i) => roundLike(v, printed[i] as string)).join(", ")} ]`,
          "",
          "Fix: paste the current transform into chapter 2.6, keeping the page's own",
          "rounding — the check compares to as many decimals as the page prints.",
        ].join("\n"),
      );
    }
  });

  /**
   * The attribute set a scatter mints, in order, with types and tuple
   * sizes. Verbatim for the same reason listFieldFns() is: a count would
   * survive a rename, a retyped column, or a reordering — and reordering
   * is exactly what a change to the scatter node does.
   *
   * Only the CONTENT is owned here. The exact rendering (`f32x3`, and a
   * scalar written without its `x1`) belongs to `attrListText` in
   * src/cli/summary.ts; this reproduces it so the comparison can be made
   * at all, and a change to that formatter should be followed here.
   */
  it("docs/manual.html prints the real point attribute list", async () => {
    await measurements();
    const printed = extractPointAttrList(MANUAL);
    if (printed === undefined) {
      throw new Error(
        [
          "docs/manual.html: could not find the `point attrs:` line of chapter 14's",
          "`pcg cook --stats` transcript. Update extractPointAttrList() in",
          "src/docs/site.ts if the transcript moved.",
        ].join("\n"),
      );
    }
    const live = await liveAttrList();
    if (printed.join(", ") !== live.join(", ")) {
      throw new Error(
        [
          "docs/manual.html prints a point attribute list the graph no longer produces.",
          `  page: ${printed.join(", ")}`,
          `  cook: ${live.join(", ")}`,
          "",
          "Fix: correct the `point attrs:` line in chapter 14. The order is the column",
          "order the geometry actually carries, so a difference in order is a real",
          "difference and not a formatting choice.",
        ].join("\n"),
      );
    }
  });

  /**
   * Three positions, three densities and three seeds. This is the only
   * thing on the page that would notice a reseeding which left every
   * count identical — which is precisely the change most likely to slip
   * through, because nothing else about the output would move.
   */
  it("docs/manual.html prints the real inspect sample rows", async () => {
    await measurements();
    const rows = extractSampleRows(MANUAL);
    if (rows === undefined) {
      throw new Error(
        [
          "docs/manual.html: could not find chapter 14's `pcg inspect --rows 3` sample",
          "table. Update extractSampleRows() in src/docs/site.ts if the transcript moved.",
        ].join("\n"),
      );
    }
    // A CARDINALITY FLOOR, because without one this check quietly weakens
    // as the page shrinks: delete two rows and the remaining one still
    // passes. The page's own header says how many rows it is showing, so
    // that is the number it has to show — and the header's population is
    // itself pinned to the live cook by a transcript claim.
    const header = /first (\d+) of [\d,]+ point rows:/.exec(MANUAL);
    if (header === null) {
      throw new Error(
        [
          'docs/manual.html: the sample table has no "first N of M point rows:" header,',
          "so nothing states how many rows it is supposed to print and the row check",
          "would silently accept however many survive. Restore the header, or update",
          "this test in src/docs/site.test.ts if the transcript changed shape.",
        ].join("\n"),
      );
    }
    const promised = Number(header[1] as string);
    if (rows.length !== promised) {
      throw new Error(
        [
          `docs/manual.html: the sample table promises ${promised} rows but prints ${rows.length}.`,
          "Every printed row is checked against a live cook, so a missing row is not a",
          "smaller transcript — it is an unchecked one. Print the rows the header",
          "promises, or change the header to match what is shown.",
        ].join("\n"),
      );
    }

    const live = await liveSampleRows();
    const wrong: string[] = [];
    for (const row of rows) {
      const i = Number(row.index);
      const actual = live[i];
      if (actual === undefined) {
        wrong.push(`  row ${row.index} is printed, but the cook has no such row`);
        continue;
      }
      const cells: (readonly [string, string, number])[] = [
        ["P.x", row.p[0] as string, actual.p[0] as number],
        ["P.y", row.p[1] as string, actual.p[1] as number],
        ["P.z", row.p[2] as string, actual.p[2] as number],
        ["density", row.density, actual.density],
        ["seed", row.seed, actual.seed],
      ];
      for (const [what, text, value] of cells) {
        if (!matchesPrinted(value, text)) {
          wrong.push(`  row ${row.index} ${what}: page says ${text}, cook says ${value}`);
        }
      }
    }
    if (wrong.length > 0) {
      throw new Error(
        [
          "docs/manual.html prints inspect rows the chapter 9 document no longer produces.",
          ...wrong,
          "",
          "Fix: rerun `pcg inspect g.json --node density --rows 3` against the document",
          "printed in chapter 9 and paste the rows back. Every value here is measured by",
          "cooking that document, so there is no literal in the test suite to adjust.",
        ].join("\n"),
      );
    }
  });
});

/* Live re-derivations used by the three verbatim checks above. Kept as
 * functions rather than folded into `measure()` because they produce
 * lists rather than the scalars TRANSCRIPT_CLAIMS compares. */

async function liveTransform(): Promise<number[]> {
  if (EXAMPLE_DOC === undefined) return [];
  const result = await cook(deserializeGraph(JSON.parse(EXAMPLE_DOC)));
  const instances = result.outputs.instances.find(
    (item): item is InstancesItem => item.kind === "instances",
  );
  const batch = instances?.batches[0];
  return batch === undefined ? [] : [...batch.transforms.subarray(0, 16)];
}

async function liveAttrList(): Promise<string[]> {
  if (EXAMPLE_DOC === undefined) return [];
  const geo = firstGeometry((await cook(deserializeGraph(JSON.parse(EXAMPLE_DOC)))).outputs.points);
  if (geo === undefined) return [];
  return [...geo.attrs.point.names()].map((name) => {
    const attr = geo.attrs.point.require(name);
    return attr.tupleSize === 1 ? `${name}(${attr.type})` : `${name}(${attr.type}x${attr.tupleSize})`;
  });
}

/** Enough rows to cover any sample table the page might print. */
const SAMPLE_ROW_LIMIT = 16;

async function liveSampleRows(): Promise<{ p: number[]; density: number; seed: number }[]> {
  if (EXAMPLE_DOC === undefined) return [];
  const graph = deserializeGraph(JSON.parse(EXAMPLE_DOC));
  const density = graph.describe().nodes.find((n) => n.id === "density");
  if (density === undefined) return [];
  graph.output({ id: density.id }, "out", "d");
  const geo = firstGeometry((await cook(graph, { outputs: ["d"] })).outputs.d);
  if (geo === undefined) return [];
  const P = geo.attrs.point.require("P");
  const d = geo.attrs.point.require("density");
  const seed = geo.attrs.point.require("seed");
  const rows: { p: number[]; density: number; seed: number }[] = [];
  for (let i = 0; i < Math.min(SAMPLE_ROW_LIMIT, geo.pointCount); i++) {
    rows.push({
      p: [P.data[i * 3] as number, P.data[i * 3 + 1] as number, P.data[i * 3 + 2] as number],
      density: d.data[i] as number,
      seed: seed.data[i] as number,
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ *
 * Error transcripts
 * ------------------------------------------------------------------ */

/**
 * "Every string below is real output, produced by feeding the named
 * mistake to the published build." Chapter 11 says that in its own words,
 * and nothing enforced it: the first transcript in the chapter listed 38
 * node types when the registry had 58, so the chapter told an agent that
 * twenty existing types do not exist. It is the single most load-bearing
 * page in the manual for a generator, and it was the least checked.
 *
 * So the mistake named in the table is actually made, here, and the whole
 * message is compared. The producers below are the mistakes; anything a
 * producer cannot make (a cycle, a failed cook, a World) is deliberately
 * out of the table — see ERROR_TRANSCRIPTS in src/docs/site.ts.
 */
const ERROR_PRODUCERS: Record<string, () => void> = {
  'a graph object with an unrecognized key "notes"': () => {
    deserializeGraph({
      formatVersion: 1,
      seed: 7,
      nodes: [],
      connections: [],
      outputs: [],
      notes: "a comment",
    });
  },
  'a node of unknown type "pointScatterInBox"': () => {
    deserializeGraph({
      formatVersion: 1,
      seed: 1,
      nodes: [{ id: "a", type: "pointScatterInBox", params: {} }],
      connections: [],
      outputs: [],
    });
  },
  'pointScatterInBounds with an unknown param "counts"': () => {
    deserializeGraph({
      formatVersion: 1,
      seed: 1,
      nodes: [{ id: "a", type: "pointScatterInBounds", params: { counts: 5 } }],
      connections: [],
      outputs: [],
    });
  },
  "pointScatterInBounds with count -5": () => {
    deserializeGraph({
      formatVersion: 1,
      seed: 1,
      nodes: [{ id: "a", type: "pointScatterInBounds", params: { count: -5 } }],
      connections: [],
      outputs: [],
    });
  },
  'filterByDensity with mode "probablistic"': () => {
    deserializeGraph({
      formatVersion: 1,
      seed: 1,
      nodes: [{ id: "a", type: "filterByDensity", params: { mode: "probablistic" } }],
      connections: [],
      outputs: [],
    });
  },
  'a connection from an output pin named "output"': () => {
    deserializeGraph({
      formatVersion: 1,
      seed: 1,
      nodes: [
        { id: "a", type: "pointScatterInBounds", params: {} },
        { id: "b", type: "jitterPoints", params: {} },
      ],
      connections: [{ from: ["a", "output"], to: ["b", "in"] }],
      outputs: [],
    });
  },
  'a field spec with fn "perlin"': () => {
    fieldFromJson({ fn: "perlin" });
  },
  'a "clamp" field spec with two args': () => {
    fieldFromJson({ fn: "clamp", args: [1, 2] });
  },
};

/**
 * The comparison rule itself, pinned. It decides every number in every
 * transcript, so "what does this actually accept" should not have to be
 * reasoned out from the implementation — especially the second clause,
 * which was added after an audit pointed out that rounding alone gave a
 * printed `0` a tolerance of half a unit.
 */
describe("the transcript comparison rule", () => {
  it("holds a measurement to as many decimals as the page printed", () => {
    expect(matchesPrinted(39.71824645996094, "39.718")).toBe(true);
    expect(matchesPrinted(39.71824645996094, "39.719")).toBe(false);
    expect(matchesPrinted(0.004380941390991211, "0.004381")).toBe(true);
    // The same measurement, printed to fewer places, is a weaker claim
    // and is allowed to be one.
    expect(matchesPrinted(0.34079214930534363, "0.34")).toBe(true);
    expect(matchesPrinted(0.34079214930534363, "0.342")).toBe(false);
  });

  it("reads a page that printed no decimal point as claiming a whole number", () => {
    expect(matchesPrinted(0, "0")).toBe(true);
    expect(matchesPrinted(1038, "1038")).toBe(true);
    // Rounding alone would accept this: 0.4 rounds to 0. The page said
    // zero, and twelve of a transform's sixteen floats say zero, so a
    // drifted axis has to fail rather than hide inside the tolerance.
    expect(matchesPrinted(0.4, "0")).toBe(false);
    expect(matchesPrinted(2146090434.8265, "2146090434")).toBe(false);
  });

  it("rounds halves away from zero, as the page's own formatter does", () => {
    // Math.round would give -0.05 here and report a false MISMATCH.
    expect(matchesPrinted(-0.055, "-0.06")).toBe(true);
    expect(matchesPrinted(0.055, "0.06")).toBe(true);
  });
});

describe("manual error transcripts", () => {
  for (const transcript of ERROR_TRANSCRIPTS) {
    it(`docs/manual.html: ${transcript.mistake}`, () => {
      const producer = ERROR_PRODUCERS[transcript.mistake];
      expect(
        producer,
        `site.test: no producer registered for the mistake "${transcript.mistake}"`,
      ).toBeTypeOf("function");

      let live: string | undefined;
      try {
        (producer as () => void)();
      } catch (error) {
        const e = error as Error;
        // The page prints the message with its class in front where the
        // class is part of what it is teaching, and without it for the
        // one message the reader meets before any class has a name.
        live = transcript.startsWith.startsWith(e.name)
          ? `${e.name}: ${e.message}`
          : e.message;
      }
      if (live === undefined) {
        throw new Error(
          [
            `docs/manual.html: ${transcript.mistake} no longer throws.`,
            "Chapter 11 prints the message it used to produce. Either the validation was",
            "relaxed — in which case the chapter is teaching a rule the library no longer",
            "enforces, and that is the bug — or the mistake has to be made differently now",
            "(update ERROR_PRODUCERS in src/docs/site.test.ts).",
          ].join("\n"),
        );
      }

      const printed = extractErrorTranscript(
        MANUAL,
        transcript.startsWith,
        transcript.endsBefore,
      );
      if (printed === undefined) {
        throw new Error(
          [
            `docs/manual.html: could not find the transcript starting "${transcript.startsWith}".`,
            "It is located by that first line inside a <pre><code> block. Either the",
            "transcript was reworded (update ERROR_TRANSCRIPTS in src/docs/site.ts) or it",
            "was removed (delete the entry) — a transcript claim that finds nothing would",
            "pass forever while checking nothing.",
            "",
            `The message the live library produces is:\n\n${live}`,
          ].join("\n"),
        );
      }

      // The page hard-wraps to its column, so newlines and indentation
      // are typesetting. Everything else compares exactly.
      const normalized = live.replace(/\s+/g, " ").trim();
      if (printed.text !== normalized) {
        throw new Error(
          [
            `docs/manual.html quotes an error message the library no longer produces.`,
            `  mistake: ${transcript.mistake}`,
            "",
            `  page: ${printed.text}`,
            `  live: ${normalized}`,
            "",
            ...describeListDrift(printed.text, normalized),
            "Fix: paste the live message into chapter 11, wrapped to the page's column.",
            "Chapter 11 opens by promising every string in it is real output, and error",
            "messages are part of this library's API — a stale one here tells an agent",
            "that something which exists does not.",
          ].join("\n"),
        );
      }
    });
  }
});

/**
 * Several of these messages end in an enumeration — every registered node
 * type, every param of a type, every field fn. When one of those drifts,
 * a whole-string diff is unreadable and the useful answer is "these names
 * are missing". So say that, when the difference looks like a list.
 */
function describeListDrift(printed: string, live: string): string[] {
  const tail = (text: string): string[] => {
    const at = text.lastIndexOf(": ");
    if (at < 0) return [];
    return text
      .slice(at + 2)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s));
  };
  const a = tail(printed);
  const b = tail(live);
  if (a.length < 2 || b.length < 2) return [];
  const missing = b.filter((n) => !a.includes(n));
  const extra = a.filter((n) => !b.includes(n));
  if (missing.length === 0 && extra.length === 0) return [];
  return [
    `  missing from the page (${missing.length}): ${missing.join(", ") || "(none)"}`,
    `  on the page but not live (${extra.length}): ${extra.join(", ") || "(none)"}`,
    "",
  ];
}

/* ------------------------------------------------------------------ *
 * Transcribed code
 * ------------------------------------------------------------------ */

/**
 * Chapters 1 and 8 print code, so their graphs are rebuilt above rather
 * than read off the page. That copy is the one thing in this file that
 * could go stale unnoticed — so it does not get to be silent. Every
 * literal the copy depends on has to still be in the block the page
 * prints, and the failure names the function to update.
 */
describe("transcribed manual code still matches the page", () => {
  for (const echo of CODE_ECHOES) {
    it(`${echo.transcription} matches the code under ${echo.anchor}`, () => {
      const block = extractCodeBlock(MANUAL, echo.anchor);
      if (block === undefined) {
        throw new Error(
          [
            `docs/manual.html: no code block after ${echo.anchor}.`,
            `${echo.transcription} in src/docs/site.test.ts is a hand copy of that block,`,
            "so without it nothing pins the copy to the page. Update the anchor in",
            "CODE_ECHOES (src/docs/site.ts) or remove the entry with the transcription.",
          ].join("\n"),
        );
      }
      const gone = echo.literals.filter((literal) => !block.includes(literal));
      if (gone.length > 0) {
        throw new Error(
          [
            `docs/manual.html changed code that ${echo.transcription} copies.`,
            ...gone.map((literal) => `  no longer on the page: ${JSON.stringify(literal)}`),
            "",
            `Fix: update ${echo.transcription} in src/docs/site.test.ts to build the graph`,
            "the page now prints, then update CODE_ECHOES in src/docs/site.ts to match.",
            "Until both are done, the transcripts checked against that graph are checking",
            "a graph the manual does not show.",
          ].join("\n"),
        );
      }
    });
  }

  /**
   * Chapter 2.3's graph is transcribed too, but from PROSE rather than
   * from a code block, so CODE_ECHOES — which pins literals to a printed
   * block — has nothing to anchor on. The sentence itself is the spec:
   * three nodes in that order, with `points` declared on the middle one
   * and `instances` on the last. Every number chapter 2.3 prints follows
   * from that shape and from nothing else, so the shape is what has to
   * hold, and this is the guard that it still says so.
   */
  it("chapter 2.3 still describes the graph chapter23Graph() builds", () => {
    const sentence =
      /Given scatter → jitter → spawn with both <code>points<\/code> \(on jitter\) and <code>instances<\/code> \(on spawn\) declared/;
    if (!sentence.test(MANUAL)) {
      throw new Error(
        [
          "docs/manual.html: chapter 2.3 no longer states the graph its trace is about.",
          "chapter23Graph() in src/docs/site.test.ts builds scatter → jitter → spawn with",
          "`points` on jitter and `instances` on spawn, because that paragraph said so.",
          "The cook stats printed under it are a fact about THAT shape, so if the shape",
          "was reworded, update chapter23Graph() and this sentence together — otherwise",
          "the trace is being checked against a graph the chapter no longer describes.",
        ].join("\n"),
      );
    }
  });

  /**
   * Chapter 8 also states what the id of a code-built node comes out as,
   * and the paragraph under it makes that the point — "a code-built node
   * is named <type>_<n>, whereas a node loaded from JSON keeps the id you
   * gave it". Both appear verbatim in error messages, so the scheme is
   * part of the API and not an implementation detail.
   */
  it("docs/manual.html prints the real generated node id", () => {
    const { node } = chapter8GridGraph();
    const printed = /\/\/ n\.id === "([^"]+)"/.exec(MANUAL);
    if (printed === null) {
      throw new Error(
        'docs/manual.html: could not find chapter 8\'s `n.id === "…"` comment. Update this test in src/docs/site.test.ts if the example moved.',
      );
    }
    if (printed[1] !== node.id) {
      throw new Error(
        [
          "docs/manual.html states a generated node id the graph does not produce.",
          `  page: ${printed[1] as string}`,
          `  live: ${node.id}`,
          "",
          "Fix: correct the comment in chapter 8. The id scheme is API — it appears in",
          "every error message and in describe() — so a change to it is a change the",
          "manual has to state.",
        ].join("\n"),
      );
    }
  });
});
