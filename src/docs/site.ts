/**
 * The hand-authored Pages site (`docs/index.html`, `docs/manual.html`) is
 * the one part of the documentation with no generator behind it. That is
 * deliberate — the roadmap entries explain a mechanism and name its
 * limitation, which is human work — but it means nothing detected drift.
 * The pages sat at v0.9.0 while npm went to v0.14.0 and a person noticed,
 * not CI.
 *
 * This module makes the pages self-policing in three ways, and the split
 * between them is the whole design:
 *
 *  1. GENERATED — the version stamps. `scripts/gen-site.mjs` rewrites them
 *     from package.json, so the existing "generated artifacts are up to
 *     date" CI step catches a stale stamp with no new workflow config.
 *  2. ASSERTED — the counts stated in prose (node types, primitives,
 *     corpus size, field functions). Nothing rewrites them; the sentences
 *     around them are prose that a generator has no business owning. The
 *     test in site.test.ts locates each stated number and compares it to
 *     the live registry.
 *  3. REQUIRED — a roadmap entry whose version equals package.json's. That
 *     is exactly what went missing: released, forgot to write the entry.
 *
 * The rendering lives here rather than in the script (see
 * node-reference.ts for the full rationale) so the test exercises the
 * same code the generator runs and the two cannot drift apart.
 *
 * Nothing here touches the filesystem: the generator and the test each do
 * their own I/O and hand strings in.
 */

/** The hand-authored pages, relative to `docs/`. */
export const SITE_PAGES = [
  "index.html",
  "architecture.html",
  "roadmap.html",
  "manual.html",
] as const;

/* ------------------------------------------------------------------ *
 * Version stamps
 * ------------------------------------------------------------------ */

/**
 * How each kind of stamp renders the package version.
 *
 * `version` is the full `v0.14.0` used in the footers and the manual's
 * kicker; `version-minor` is the shortened `v0.14` in the landing page's
 * stat row, where a patch digit would be noise.
 */
const STAMP_KINDS: Record<string, (version: string) => string> = {
  version: (version) => `v${version}`,
  "version-minor": (version) => `v${version.split(".").slice(0, 2).join(".")}`,
};

const STAMP_KIND_NAMES = Object.keys(STAMP_KINDS).sort();

/**
 * `pcg:` markers that are NOT version stamps.
 *
 * The scanner below sees every marker in the namespace, which is what
 * makes a typo'd kind an error rather than a silent no-op — so a second
 * kind of marker cannot simply opt out of it. It is declared here
 * instead: a BLOCK wraps generated MARKUP rather than a run of text, so
 * the stamp rules (no angle brackets in the body, body rewritten with the
 * version) do not apply. `scanStamps` still checks that it is paired and
 * unnested, then leaves it to its own renderer — `renderSiteLede` is the
 * one that exists.
 */
const BLOCK_KINDS = new Set(["lede"]);

/**
 * Every `pcg:` marker in the document, opening or closing, in order.
 *
 * This is the scanner behind the validation: it sees ALL markers, so a
 * typo'd kind or an unclosed stamp is a named error rather than a silent
 * no-op rewrite.
 */
const ANY_MARKER = /<!--(\/?)pcg:([a-z0-9-]+)-->/g;

/**
 * A stamp site, and the reason this rewrite provably cannot reach prose.
 *
 * The roadmap deliberately contains a version string per release —
 * `v0.8.0`, `v0.9.0`, … — plus versions named inside the prose itself
 * ("A gap v0.13.0 opened, closed"). A regex over `v\d+\.\d+\.\d+` would
 * rewrite the entire release history to the current version and vandalize
 * the page while reporting success. So the rewrite never matches version
 * SYNTAX. It matches two literal comment markers and replaces what sits
 * between them, and the between is `[^<>]*` — text that contains no angle
 * bracket at all, so a match can neither cross a tag boundary nor swallow
 * a second marker. The reachable set is exactly the marked sites.
 */
function stampPattern(kind: string): RegExp {
  return new RegExp(`(<!--pcg:${kind}-->)([^<>]*)(<!--/pcg:${kind}-->)`, "g");
}

export interface SiteRenderResult {
  /** The page with every marked stamp set to `version`. */
  readonly html: string;
  /** How many stamp sites were rewritten. */
  readonly stamps: number;
}

/**
 * Rewrite the marked version stamps in a page.
 *
 * `file` is used only in error messages — pass the path the reader would
 * open, e.g. `docs/index.html`.
 *
 * Throws if a marker is malformed, of an unknown kind, or absent
 * entirely. Silence would be the dangerous outcome: a page whose stamps
 * stopped being rewritten looks identical to a page that is up to date,
 * which is the failure this module exists to prevent.
 */
export function renderSiteVersion(html: string, version: string, file: string): SiteRenderResult {
  assertVersion(version, file);
  const sites = scanStamps(html, file);
  if (sites.length === 0) {
    throw new Error(
      [
        `${file} contains no version stamp, so its version would silently stop tracking package.json.`,
        `Wrap the version text in a stamp marker, e.g.`,
        `  <!--pcg:version-->v${version}<!--/pcg:version-->`,
        `Available stamp kinds: ${STAMP_KIND_NAMES.join(", ")}.`,
      ].join("\n"),
    );
  }

  let out = html;
  for (const kind of new Set(sites)) {
    const render = STAMP_KINDS[kind];
    if (render === undefined) continue; // scanStamps already rejected it
    out = out.replace(stampPattern(kind), (_match, open: string, _body: string, close: string) => {
      return `${open}${render(version)}${close}`;
    });
  }
  return { html: out, stamps: sites.length };
}

/**
 * The kind of every well-formed stamp in the page, in document order.
 *
 * Rejects anything that would make the rewrite a no-op without saying so:
 * an unknown kind, a close with no open, an open with no close, and a
 * marker pair whose body carries markup the `[^<>]*` body cannot match.
 */
export function scanStamps(html: string, file: string): string[] {
  const kinds: string[] = [];
  let open: { kind: string; index: number } | undefined;

  ANY_MARKER.lastIndex = 0;
  for (let m = ANY_MARKER.exec(html); m !== null; m = ANY_MARKER.exec(html)) {
    const closing = m[1] === "/";
    const kind = m[2] as string;
    const where = `${file}:${lineOf(html, m.index)}`;

    if (!(kind in STAMP_KINDS) && !BLOCK_KINDS.has(kind)) {
      throw new Error(
        `${where}: unknown pcg marker kind "${kind}". Version stamps: ${STAMP_KIND_NAMES.join(", ")}. Generated blocks: ${[...BLOCK_KINDS].sort().join(", ")}.`,
      );
    }
    if (!closing) {
      if (open !== undefined) {
        throw new Error(
          `${where}: stamp <!--pcg:${kind}--> opens while <!--pcg:${open.kind}--> (line ${lineOf(html, open.index)}) is still open. Stamps do not nest; close each one before opening the next.`,
        );
      }
      open = { kind, index: m.index };
      continue;
    }
    if (open === undefined) {
      throw new Error(
        `${where}: closing marker <!--/pcg:${kind}--> has no matching <!--pcg:${kind}--> before it.`,
      );
    }
    if (open.kind !== kind) {
      throw new Error(
        `${where}: <!--pcg:${open.kind}--> (line ${lineOf(html, open.index)}) is closed by <!--/pcg:${kind}-->. Opening and closing kinds must match.`,
      );
    }
    const body = html.slice(open.index + `<!--pcg:${kind}-->`.length, m.index);
    // A block's body IS markup, and its own renderer owns it. Pairing is
    // checked above; the stamp rules below are not its rules.
    if (BLOCK_KINDS.has(kind)) {
      open = undefined;
      continue;
    }
    if (/[<>]/.test(body)) {
      throw new Error(
        `${where}: the <!--pcg:${kind}--> stamp opened on line ${lineOf(html, open.index)} wraps markup (${JSON.stringify(body)}). A stamp may only wrap the version text itself — put the markers inside the element, not around it.`,
      );
    }
    kinds.push(kind);
    open = undefined;
  }

  if (open !== undefined) {
    throw new Error(
      `${file}:${lineOf(html, open.index)}: <!--pcg:${open.kind}--> is never closed. Add <!--/pcg:${open.kind}--> after the version text.`,
    );
  }
  return kinds;
}

function assertVersion(version: string, file: string): void {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(
      `${file}: refusing to stamp "${version}" — package.json's version is not a plain semver string. Fix package.json rather than relaxing the check; every stamped page would otherwise carry it.`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * The lede, borrowed from the README
 * ------------------------------------------------------------------ */

/**
 * The file the landing page's opening paragraphs are written in.
 *
 * ONE SOURCE, because two copies of a paragraph is two paragraphs. The
 * README's opening is the best short statement of what this library is —
 * it shows the recipe before it names the vocabulary, and it puts
 * determinism in words a stranger already has — and the landing page had
 * its own, longer, colder version of the same claims. Rather than paste
 * it and let the two drift, the page carries a marked hole and the docs
 * chain fills it.
 */
export const LEDE_SOURCE = "README.md";

const LEDE_OPEN = "<!--pcg:lede-->";
const LEDE_CLOSE = "<!--/pcg:lede-->";

/**
 * The lede's markdown, from between the markers in the README.
 *
 * `file` is used only in error messages.
 */
export function extractLede(markdown: string, file: string): string {
  const open = markdown.indexOf(LEDE_OPEN);
  const close = markdown.indexOf(LEDE_CLOSE);
  if (open < 0 || close < 0 || close < open) {
    throw new Error(
      [
        `${file}: no ${LEDE_OPEN} … ${LEDE_CLOSE} block, so the landing page's opening has no source.`,
        "Wrap the opening paragraphs in those two markers, or remove the",
        "matching hole from docs/index.html if the page should stop borrowing them.",
      ].join("\n"),
    );
  }
  return markdown.slice(open + LEDE_OPEN.length, close).trim();
}

/**
 * The little of markdown this borrow needs, and NOTHING ELSE.
 *
 * Bold, italic and paragraph breaks are what the lede uses. Every other
 * construct throws rather than passing through, because the failure it
 * prevents is silent: an unimplemented `[link](url)` would reach the
 * published page as literal brackets, and a page that renders its own
 * source is worse than a build that stopped.
 *
 * Escaping runs FIRST and the inline markers are applied to the escaped
 * text, so a `<` in the prose can never open a tag.
 */
export function ledeToHtml(markdown: string, file: string): string {
  const paragraphs = markdown.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p !== "");
  if (paragraphs.length === 0) {
    throw new Error(`${file}: the lede block is empty.`);
  }

  return paragraphs
    .map((paragraph) => {
      for (const [pattern, what] of UNSUPPORTED) {
        if (pattern.test(paragraph)) {
          throw new Error(
            [
              `${file}: the lede uses ${what}, which the landing page's converter does not implement.`,
              "It renders bold, italic and paragraph breaks and nothing else — see ledeToHtml",
              "in src/docs/site.ts. Either reword the lede or teach the converter, but do not",
              "leave it: unhandled markdown reaches the published page as its own syntax.",
            ].join("\n"),
          );
        }
      }
      const escaped = paragraph
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replace(/\s*\n\s*/g, " ");
      const inline = escaped
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>");
      return `      <p>${inline}</p>`;
    })
    .join("\n");
}

/** Markdown the converter refuses to guess at, and what to call it. */
const UNSUPPORTED: readonly (readonly [RegExp, string])[] = [
  [/\[[^\]]*\]\(/, "a link"],
  [/`/, "a code span"],
  [/^\s*[-*+]\s/m, "a list"],
  [/^\s*#/m, "a heading"],
  [/^\s*>/m, "a block quote"],
  [/!\[/, "an image"],
];

/**
 * Put `ledeHtml` into the page's marked hole.
 *
 * A block marker rather than the `[^<>]*` stamp body above: this one's
 * content IS markup, so it cannot borrow that pattern's guarantee. What
 * replaces it instead is a non-greedy span between two literal markers,
 * checked to contain no second marker — the same reachability argument,
 * made a different way.
 */
export function renderSiteLede(html: string, ledeHtml: string, file: string): SiteRenderResult {
  const open = html.indexOf(LEDE_OPEN);
  const close = html.indexOf(LEDE_CLOSE);
  if (open < 0 || close < 0 || close < open) {
    throw new Error(
      [
        `${file}: no ${LEDE_OPEN} … ${LEDE_CLOSE} hole, so the README's opening would silently stop reaching it.`,
        `Put the markers around the paragraphs that should come from ${LEDE_SOURCE}.`,
      ].join("\n"),
    );
  }
  const body = html.slice(open + LEDE_OPEN.length, close);
  if (body.includes(LEDE_OPEN) || body.includes(LEDE_CLOSE)) {
    throw new Error(`${file}: nested ${LEDE_OPEN} markers — the hole must be one span.`);
  }
  const out = html.slice(0, open + LEDE_OPEN.length) + `
${ledeHtml}
    ` + html.slice(close);
  return { html: out, stamps: 1 };
}

/* ------------------------------------------------------------------ *
 * Roadmap
 * ------------------------------------------------------------------ */

export interface RoadmapEntry {
  /** The version as written, e.g. `v0.14.0` — or `next` for the open entry. */
  readonly version: string;
  /** The `<small>` beside it: a release date, or `unscheduled`. */
  readonly date: string;
  /** The entry's prose, tags and all. */
  readonly body: string;
  /** 1-based line of the entry's heading, for error messages. */
  readonly line: number;
}

const ROADMAP_LIST = /<ul class="roadmap">([\s\S]*?)<\/ul>/;
const ROADMAP_HEADING = /<div class="rm-ver">([^<\s]+)\s*<small>([^<]*)<\/small><\/div>/g;

/**
 * Every roadmap entry on the landing page, in document order.
 *
 * Entries are split on their `rm-ver` headings rather than on `<li>`, so
 * nested list markup inside an entry's prose cannot confuse the parse.
 */
export function listRoadmapEntries(html: string): RoadmapEntry[] {
  const list = ROADMAP_LIST.exec(html);
  if (list === null) return [];
  const section = list[1] as string;
  const base = (list.index as number) + list[0].indexOf(section);

  const heads: { version: string; date: string; at: number; end: number }[] = [];
  ROADMAP_HEADING.lastIndex = 0;
  for (let m = ROADMAP_HEADING.exec(section); m !== null; m = ROADMAP_HEADING.exec(section)) {
    heads.push({
      version: m[1] as string,
      date: m[2] as string,
      at: m.index,
      end: m.index + m[0].length,
    });
  }

  return heads.map((head, i) => ({
    version: head.version,
    date: head.date,
    body: section.slice(head.end, heads[i + 1]?.at ?? section.length),
    line: lineOf(html, base + head.at),
  }));
}

/**
 * The landing page with the roadmap blanked out, line numbering intact.
 *
 * Stated-count claims are searched in THIS, never in the whole page. The
 * roadmap is a history: "node types go 25 → 32", "field-grammar functions
 * 40 → 42", "429 tests" are all true statements about releases that are
 * over, and a claim pattern that wandered into them would either fail
 * forever or, worse, be "fixed" by rewriting history. Excluding the
 * section structurally is a stronger guarantee than any amount of regex
 * care. Characters are replaced with spaces rather than deleted so that
 * every reported line number still matches the real file.
 */
export function withoutRoadmap(html: string): string {
  const list = ROADMAP_LIST.exec(html);
  if (list === null) return html;
  const blanked = (list[0] as string).replace(/[^\n]/g, " ");
  return html.slice(0, list.index) + blanked + html.slice(list.index + list[0].length);
}

/* ------------------------------------------------------------------ *
 * Stated counts
 * ------------------------------------------------------------------ */

export interface CountClaim {
  /**
   * File the claim appears in, relative to the REPOSITORY ROOT — not to
   * `docs/`, which is what it used to mean and what kept the two
   * root-level copies of these sentences out of the check. `llms.txt`
   * and `docs/authoring.md` both state the field-fn count, both drifted
   * to 45 while the gated pages correctly said 46, and neither was
   * noticed until a fn was added.
   */
  readonly page: string;
  /** What the number counts, as the reader sees it. */
  readonly label: string;
  /** The registry that decides the truth, named for the failure message. */
  readonly source: string;
  /**
   * Locates the stated number. Global, with the number in group 1. Anchored
   * on literal surrounding prose so it matches the claim and nothing else;
   * every match is checked, not just the first.
   */
  readonly pattern: RegExp;
}

/**
 * Which sentence states which count, and what decides it.
 *
 * `source` is the name of the live registry, quoted verbatim in failures
 * so the reader knows where the truth comes from. Adding a claim here is
 * how a newly written sentence joins the check; nothing is hand-counted,
 * and no number appears in this file.
 */
export const COUNT_CLAIMS: readonly CountClaim[] = [
  {
    page: "docs/index.html",
    label: "registered node types (stat row)",
    source: "listNodeTypes().length",
    pattern: /<b>([\d,]+)<\/b><span>registered node types<\/span>/g,
  },
  {
    // Fig. 1 moved to the architecture page; the claim followed it.
    page: "docs/architecture.html",
    label: "node types (Fig. 1, src/nodes)",
    source: "listNodeTypes().length",
    pattern: /src\/nodes — ([\d,]+) types/g,
  },
  {
    page: "docs/index.html",
    label: "named primitives (stat row)",
    source: "docs/primitives.json entries",
    pattern: /<b>([\d,]+)<\/b><span>named primitives<\/span>/g,
  },
  {
    // Fig. 1 moved to the architecture page; the claim followed it.
    page: "docs/architecture.html",
    label: "named primitives (Fig. 1, src/primitives)",
    source: "docs/primitives.json entries",
    pattern: /src\/primitives — ([\d,]+) named recipes/g,
  },
  {
    page: "docs/index.html",
    label: "named primitives (Built for agents)",
    source: "docs/primitives.json entries",
    pattern: /([\d,]+) named primitives ship as/g,
  },
  {
    page: "docs/index.html",
    label: "field-grammar functions (stat row)",
    source: "listFieldFns().length",
    pattern: /<b>([\d,]+)<\/b><span>field-grammar functions<\/span>/g,
  },
  {
    page: "docs/index.html",
    label: "corpus graphs",
    source: "docs/graphs.json entries",
    // Was "corpus of N single-concept graphs". The corpus grew a family
    // that is not single-concept — composed scenes under `examples-` —
    // so the adjective moved into the sentence that follows it.
    pattern: /corpus of ([\d,]+) graphs/g,
  },
  {
    page: "docs/manual.html",
    label: "node types in the standard library (ch. 8 prose)",
    source: "listNodeTypes().length",
    pattern: /There are ([\d,]+) types in the standard library/g,
  },
  {
    page: "docs/manual.html",
    label: "listNodeTypes().length (ch. 8 code comment)",
    source: "listNodeTypes().length",
    pattern: /types\.length;[^<]*<span class="c">\/\/ ([\d,]+)<\/span>/g,
  },
  {
    page: "docs/manual.html",
    label: "docs/nodes.json entry count (ch. 8 prose)",
    source: "listNodeTypes().length",
    pattern: /same ([\d,]+) entries in the same shape/g,
  },
  {
    page: "docs/manual.html",
    label: "field function names (ch. 8 prose)",
    source: "listFieldFns().length",
    pattern: /sorted array of ([\d,]+) names/g,
  },
  {
    page: "docs/manual.html",
    label: "node types (ch. 8 `pcg nodes` transcript)",
    source: "listNodeTypes().length",
    pattern: /([\d,]+) node types, by category/g,
  },
  {
    page: "docs/manual.html",
    label: "named primitives (ch. 8 prose)",
    source: "docs/primitives.json entries",
    pattern: /([\d,]+) named primitives ship with the library/g,
  },
  {
    page: "docs/manual.html",
    label: "listSubgraphs().length (ch. 8 code comment)",
    source: "docs/primitives.json entries",
    pattern: /all\.length;[^<]*<span class="c">\/\/ ([\d,]+)<\/span>/g,
  },
  {
    page: "docs/manual.html",
    label: "corpus graphs (ch. 8 catalog table)",
    source: "docs/graphs.json entries",
    pattern: /([\d,]+) graphs under <code>graphs\/<\/code>/g,
  },
  {
    page: "docs/manual.html",
    label: "corpus graphs (ch. 14 prose)",
    source: "docs/graphs.json entries",
    pattern: /indexes ([\d,]+) corpus graphs/g,
  },
  {
    page: "docs/manual.html",
    label: "field fns (ch. 8 `pcg fields` transcript)",
    source: "listFieldFns().length",
    pattern: /([\d,]+) field fns/g,
  },
  {
    page: "docs/manual.html",
    label: "field-grammar functions (ch. 12 prose)",
    source: "listFieldFns().length",
    pattern: /Those ([\d,]+) functions, nested arbitrarily/g,
  },
  // The two below are the reason `page` is repo-relative. Both state the
  // field-fn count in the agent-facing docs, both are hand-written, and
  // both were a full release behind the gated pages before anyone looked.
  {
    page: "llms.txt",
    label: "field fns (grammar section)",
    source: "listFieldFns().length",
    pattern: /All ([\d,]+) fns \(`listFieldFns\(\)`\):/g,
  },
  {
    page: "docs/authoring.md",
    label: "field fn names (elementwise chapter)",
    source: "listFieldFns().length",
    pattern: /`listFieldFns\(\)` returns all ([\d,]+) names at runtime/g,
  },
];

export interface StatedCount {
  /** The number as written, commas stripped. */
  readonly value: number;
  /** The matched text, for quoting back in a failure. */
  readonly text: string;
  /** 1-based line in the page. */
  readonly line: number;
}

/** Every place a claim's pattern matches, with line numbers. */
export function findStatedCounts(html: string, pattern: RegExp): StatedCount[] {
  const found: StatedCount[] = [];
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    found.push({
      value: Number((m[1] as string).replaceAll(",", "")),
      text: m[0],
      line: lineOf(html, m.index),
    });
    if (m[0].length === 0) re.lastIndex++;
  }
  return found;
}

/**
 * The verbatim `listFieldFns()` output printed in the manual's chapter 8.
 *
 * The manual calls this "the closed set", so a count alone would not be
 * enough: renaming a function keeps the count and breaks the claim. The
 * block is located by the heading above it, then read as its quoted
 * strings. Returns `undefined` if the block is not where it was.
 */
export function extractFieldFnList(html: string): string[] | undefined {
  const heading = html.indexOf("<h3>listFieldFns()</h3>");
  if (heading < 0) return undefined;
  const block = /<pre><code>([\s\S]*?)<\/code><\/pre>/.exec(html.slice(heading));
  if (block === null) return undefined;
  // Strip the syntax-highlighting markup first, so that `class="s"` cannot
  // be read as a quoted name; what is left is the code as printed.
  const code = (block[1] as string).replace(/<[^>]*>/g, "");
  const names: string[] = [];
  const quoted = /(?:&quot;|")([A-Za-z0-9_]+)(?:&quot;|")/g;
  for (let m = quoted.exec(code); m !== null; m = quoted.exec(code)) {
    names.push(m[1] as string);
  }
  return names;
}

/* ------------------------------------------------------------------ *
 * Shared
 * ------------------------------------------------------------------ */

/** 1-based line number of a character offset. */
export function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}
