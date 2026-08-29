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
  "guides/racetrack.html",
  "guides/lanterns.html",
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
const BLOCK_KINDS = new Set(["lede", "chrome-header", "chrome-rail"]);

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
 * Generated blocks
 * ------------------------------------------------------------------ */

/**
 * Replace the body of a paired `<!--pcg:KIND-->` block with `body`.
 *
 * The same reachability argument `renderSiteLede` makes, factored out so
 * the chrome can borrow it: a non-greedy span between two literal
 * markers, rejected unless the document holds exactly one marker of each
 * side. The body IS markup here, so the stamp rules do not apply and
 * cannot.
 *
 * Absence is an error, not a no-op. A page whose chrome silently stopped
 * being written looks exactly like a page that is up to date, which is
 * the whole failure this module exists to prevent.
 */
export function renderSiteBlock(
  html: string,
  kind: string,
  body: string,
  file: string,
): SiteRenderResult {
  const openTag = `<!--pcg:${kind}-->`;
  const closeTag = `<!--/pcg:${kind}-->`;
  const open = html.indexOf(openTag);
  const close = html.indexOf(closeTag);
  if (open < 0 || close < 0 || close < open) {
    throw new Error(
      [
        `${file}: no ${openTag} … ${closeTag} hole, so the generated block would silently stop reaching it.`,
        `Put the markers where the block belongs, e.g.`,
        `  ${openTag}${closeTag}`,
      ].join("\n"),
    );
  }
  // Nesting is not the only way to get a second span. TWO COMPLETE PAIRS
  // of the same kind nest nothing and pass every check inside the first
  // one, and the rewrite below would fill the first and leave the second
  // stale for good — a page half-generated and half-frozen, which is the
  // exact failure this module exists to make impossible. So count across
  // the whole document, not just inside the first span.
  const opens = html.split(openTag).length - 1;
  const closes = html.split(closeTag).length - 1;
  if (opens > 1 || closes > 1) {
    throw new Error(
      [
        `${file}: ${opens} ${openTag} and ${closes} ${closeTag} markers — a page may have exactly one of each.`,
        `Only the first would ever be rewritten; the rest would silently freeze at whatever they hold today.`,
      ].join("\n"),
    );
  }
  const out = html.slice(0, open + openTag.length) + `\n${body}\n` + html.slice(close);
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
 * Transcripts
 * ------------------------------------------------------------------ */

/**
 * The other half of the drift problem, and the half a count cannot reach.
 *
 * `COUNT_CLAIMS` above gates the numbers the manual states ABOUT the
 * library — how many node types there are, how many field fns. What it
 * cannot see is the much larger set of numbers and strings the manual
 * QUOTES AS OUTPUT: "Actual output", "a real trace", "every string below
 * is real output, produced by feeding the named mistake to the published
 * build". Those are the strongest sentences on the page, because they are
 * the ones a reader will copy and expect to reproduce, and they were the
 * only ones with nothing behind them. Two were already wrong when this
 * section was written (see the notes on ERROR_TRANSCRIPTS and on the
 * chapter 1 sample below), and neither had a count attached, so neither
 * could ever have been caught by the mechanism above.
 *
 * The rule these follow, and the reason they are worth gating at all:
 * **the expected value is re-derived by running the live library, never
 * written down here.** A check that compared the manual against a literal
 * copied out of the manual would only move the stale number into a second
 * file. So:
 *
 *  - Chapter 9 prints a complete JSON document and says it "deserializes,
 *    cooks, and round-trips as written". The test EXTRACTS THAT DOCUMENT
 *    FROM THE PAGE, deserializes it, cooks it, and every number the manual
 *    prints about it — in chapters 2, 9 and 14 — is compared against that
 *    one live cook. Nothing is transcribed; edit the document on the page
 *    and the expectations move with it.
 *  - The error transcripts are produced by triggering the real error and
 *    comparing the whole message.
 *  - Chapters 1 and 8 print CODE rather than a document, so their graphs
 *    ARE transcribed into the test. Those two transcriptions are pinned to
 *    the printed code by CODE_ECHOES below, so the copy cannot drift from
 *    the page in silence.
 *  - Chapter 2.3 is a third case and NOT a CODE_ECHOES one, which is worth
 *    saying because the obvious reading is wrong: it prints no graph at
 *    all, only two bare `cook()` calls, and names its graph in the PROSE
 *    above them. There is no code block to pin literals against, so that
 *    transcription is guarded by a test on the sentence instead. See
 *    chapter23Graph() in site.test.ts.
 *
 * Numbers are compared by `matchesPrinted`: round the LIVE value to as
 * many decimals as the page chose to print, then require equality — and,
 * where the page printed no decimal point at all, require the measurement
 * to be a whole number too. One rule covers an integer count, a
 * coordinate printed to three places and a bound printed to six, and it
 * has the property you want from a documentation check: printing more
 * digits demands more accuracy, so the page can be as precise as it likes
 * and never more precise than it is.
 */
export interface TranscriptClaim {
  /** File the transcript appears in, relative to the repository root. */
  readonly page: string;
  /** What the transcript shows, as the reader sees it. */
  readonly label: string;
  /**
   * Named capture group → the live measurement it must equal. The name is
   * quoted verbatim in failures, so it should read as an instruction for
   * reproducing the value ("cook(chapter 9 document).stats.cooked").
   */
  readonly sources: Readonly<Record<string, string>>;
  /**
   * Locates the transcript. Global, with one NAMED group per source.
   * Anchored on literal surrounding markup so it matches this transcript
   * and nothing else; every match is checked, not just the first.
   */
  readonly pattern: RegExp;
}

/**
 * Every quoted-output transcript that a live run can re-derive.
 *
 * Grouped by chapter, and every `sources` key names something the test
 * measures rather than something anyone typed here. A claim whose pattern
 * stops matching FAILS — a silently-matching-nothing claim would pass
 * forever while checking nothing, which is the failure mode the whole
 * file exists against.
 */
export const TRANSCRIPT_CLAIMS: readonly TranscriptClaim[] = [
  /* --- Chapter 1: "Actual output" of the first graph in the book --- */
  {
    page: "docs/manual.html",
    label: "chapter 1 — the printed console.log of pointCount and P[0..3]",
    sources: {
      count: "cook(chapter 1 graph).pointCount",
      x: "cook(chapter 1 graph).P[0]",
      y: "cook(chapter 1 graph).P[1]",
      z: "cook(chapter 1 graph).P[2]",
    },
    pattern:
      /<pre><code>(?<count>[\d,]+) \[ (?<x>-?[\d.]+), (?<y>-?[\d.]+), (?<z>-?[\d.]+) \]$/gm,
  },
  {
    page: "docs/manual.html",
    label: "chapter 1 — cook stats of the first cook",
    sources: {
      cooked: "cook(chapter 1 graph).stats.cooked",
      cached: "cook(chapter 1 graph).stats.cached",
    },
    pattern: /\{ cooked: (?<cooked>\d+), cached: (?<cached>\d+), elapsedMs: [\d.]+ \}<\/code>/g,
  },
  {
    page: "docs/manual.html",
    label: "chapter 1 — cook stats of the second, fully cached cook",
    sources: {
      cooked: "second cook(chapter 1 graph).stats.cooked",
      cached: "second cook(chapter 1 graph).stats.cached",
    },
    pattern:
      /served from the memo cache — <code>\{ cooked: (?<cooked>\d+), cached: (?<cached>\d+) \}<\/code>/g,
  },

  /* --- Chapter 2.3: what per-output cooking actually schedules --- */
  {
    page: "docs/manual.html",
    label: "chapter 2.3 — stats of a cook restricted to one output",
    sources: {
      cooked: 'cook(scatter→jitter→spawn, { outputs: ["points"] }).stats.cooked',
      cached: 'cook(scatter→jitter→spawn, { outputs: ["points"] }).stats.cached',
    },
    pattern:
      /cook<\/span>\(graph, \{ outputs: \[<span class="s">"points"<\/span>\] \}\);\s*<span class="c">\/\/ \{ cooked: (?<cooked>\d+), cached: (?<cached>\d+) \}/g,
  },
  {
    page: "docs/manual.html",
    label: "chapter 2.3 — stats of the follow-up full cook",
    sources: {
      cooked: "second cook(scatter→jitter→spawn).stats.cooked",
      cached: "second cook(scatter→jitter→spawn).stats.cached",
    },
    pattern:
      /cook<\/span>\(graph\);\s*<span class="c">\/\/ \{ cooked: (?<cooked>\d+), cached: (?<cached>\d+) \}<\/span>/g,
  },

  /* --- Chapter 2.6 + 9: the instance batch the document produces --- */
  {
    page: "docs/manual.html",
    label: "chapter 2.6 — the cloud the spawner example was cooked from",
    sources: { count: "cook(chapter 9 document).pointCount" },
    pattern: /From a real cook of the (?<count>[\d,]+)-point cloud in chapter 9/g,
  },
  {
    page: "docs/manual.html",
    label: "batch.count (chapters 2.6 and 9)",
    sources: { count: "cook(chapter 9 document).batches[0].count" },
    pattern: /batch\.count;?\s+<span class="c">\/\/ (?<count>[\d,]+)<\/span>/g,
  },
  {
    page: "docs/manual.html",
    label: "batch.transforms length (chapters 2.6 and 9)",
    sources: { n: "cook(chapter 9 document).batches[0].transforms.length" },
    pattern:
      /batch\.transforms(?:\.length)?(?:; +| {2,})<span class="c">\/\/ (?:Float32Array\()?(?<n>[\d,]+)/g,
  },

  /* --- Chapter 8: a graph built from the registry --- */
  {
    page: "docs/manual.html",
    label: "chapter 8 — pointCount of the 3×3 pointGrid built from getNodeType",
    sources: { count: "cook(chapter 8 pointGrid graph).pointCount" },
    pattern: /outputs\.p\)\.pointCount;\s*<span class="c">\/\/ (?<count>[\d,]+)<\/span>/g,
  },

  /* --- Chapter 9: the document the page tells you it cooked --- */
  {
    page: "docs/manual.html",
    label: "chapter 9 — pointCount of the printed document",
    sources: { count: "cook(chapter 9 document).pointCount" },
    pattern:
      /result\.outputs\.points\)\.pointCount;\s*<span class="c">\/\/ (?<count>[\d,]+)<\/span>/g,
  },
  {
    page: "docs/manual.html",
    label: "chapter 9 — cook stats of the printed document",
    sources: {
      cooked: "cook(chapter 9 document).stats.cooked",
      cached: "cook(chapter 9 document).stats.cached",
    },
    pattern:
      /result\.stats;\s*<span class="c">\/\/ \{ cooked: (?<cooked>\d+), cached: (?<cached>\d+), elapsedMs/g,
  },

  /* --- Chapter 14: the same document, through the CLI --- */
  {
    page: "docs/manual.html",
    label: "chapter 14 — the `pcg cook --stats` headline",
    sources: {
      cooked: "cook(chapter 9 document).stats.cooked",
      cached: "cook(chapter 9 document).stats.cached",
    },
    pattern: /\n(?<cooked>\d+) cooked, (?<cached>\d+) cached, [\d.]+ ms/g,
  },
  {
    page: "docs/manual.html",
    label: "chapter 14 — the geometry line of `pcg cook --stats`",
    sources: {
      points: "cook(chapter 9 document).pointCount",
      vertices: "cook(chapter 9 document).vertexCount",
      primitives: "cook(chapter 9 document).primitiveCount",
    },
    pattern:
      /\[0\] geometry\s+points (?<points>[\d,]+)\s+vertices (?<vertices>[\d,]+)\s+primitives (?<primitives>[\d,]+)/g,
  },
  {
    page: "docs/manual.html",
    label: "chapter 14 — the bounds line of `pcg cook --stats`",
    sources: {
      minX: "cook(chapter 9 document).P.min.x",
      minY: "cook(chapter 9 document).P.min.y",
      minZ: "cook(chapter 9 document).P.min.z",
      maxX: "cook(chapter 9 document).P.max.x",
      maxY: "cook(chapter 9 document).P.max.y",
      maxZ: "cook(chapter 9 document).P.max.z",
    },
    pattern:
      /bounds (?<minX>-?[\d.]+),(?<minY>-?[\d.]+),(?<minZ>-?[\d.]+) \.\. (?<maxX>-?[\d.]+),(?<maxY>-?[\d.]+),(?<maxZ>-?[\d.]+)/g,
  },
  {
    page: "docs/manual.html",
    label: "chapter 14 — the instances line of `pcg cook --stats`",
    sources: {
      count: "cook(chapter 9 document).instance count",
      // The batch COUNT was a literal `1` in this pattern until an audit
      // pointed out that it made the per-asset number vacuous: with one
      // batch asserted by the regex, "rock x1038" could only ever repeat
      // the total beside it. Measured, the two say different things.
      batches: "cook(chapter 9 document).batches.length",
      perAsset: "cook(chapter 9 document).batches[0].count",
    },
    pattern:
      /\[0\] instances\s+(?<count>[\d,]+) instances in (?<batches>\d+) batch \(cpu\) — rock x(?<perAsset>[\d,]+)/g,
  },
  {
    page: "docs/manual.html",
    label: "chapter 14 — the survivors-of-scattered sentence",
    sources: {
      survivors: "cook(chapter 9 document).pointCount",
      scattered: "chapter 9 document's scatter `count` param",
    },
    pattern: /<p>(?<survivors>[\d,]+) survivors of (?<scattered>[\d,]+) scattered/g,
  },
  {
    page: "docs/manual.html",
    label: "chapter 14 — `pcg inspect --node density` cook stats",
    sources: {
      cooked: "cook(chapter 9 document, up to the density node).stats.cooked",
      cached: "cook(chapter 9 document, up to the density node).stats.cached",
    },
    pattern: /1 item, cooked (?<cooked>\d+), cached (?<cached>\d+)/g,
  },
  {
    page: "docs/manual.html",
    label: "chapter 14 — the geometry line of `pcg inspect --node density`",
    sources: {
      points: "cook(chapter 9 document, up to the density node).pointCount",
      vertices: "cook(chapter 9 document, up to the density node).vertexCount",
      primitives: "cook(chapter 9 document, up to the density node).primitiveCount",
    },
    pattern:
      /item 0: geometry\s+points (?<points>[\d,]+)\s+vertices (?<vertices>[\d,]+)\s+primitives (?<primitives>[\d,]+)/g,
  },
  {
    page: "docs/manual.html",
    label: "chapter 14 — the element count of the inspected point domain",
    sources: { n: "cook(chapter 9 document, up to the density node).pointCount" },
    pattern: /point — (?<n>[\d,]+) elements:/g,
  },
  {
    // The `of N` here is what stops the sample table below it from being
    // quietly trimmable: the sample-rows test requires the page to print
    // as many rows as this header promises, and this claim pins the
    // population that header is a sample OF.
    page: "docs/manual.html",
    label: "chapter 14 — the sample table's header",
    sources: { total: "cook(chapter 9 document, up to the density node).pointCount" },
    pattern: /first \d+ of (?<total>[\d,]+) point rows:/g,
  },
  {
    page: "docs/manual.html",
    label: "chapter 14 — the density row of the per-attribute table",
    sources: {
      min: "cook(chapter 9 document, up to the density node).density.min",
      max: "cook(chapter 9 document, up to the density node).density.max",
      mean: "cook(chapter 9 document, up to the density node).density.mean",
    },
    pattern: /density\s+f32\s+1\s+(?<min>[\d.]+)\s+(?<max>[\d.]+)\s+(?<mean>[\d.]+)\s+0$/gm,
  },
  {
    page: "docs/manual.html",
    label: "chapter 14 — the P row of the per-attribute table",
    sources: {
      minX: "cook(chapter 9 document, up to the density node).P.min.x",
      minY: "cook(chapter 9 document, up to the density node).P.min.y",
      minZ: "cook(chapter 9 document, up to the density node).P.min.z",
      maxX: "cook(chapter 9 document, up to the density node).P.max.x",
      maxY: "cook(chapter 9 document, up to the density node).P.max.y",
      maxZ: "cook(chapter 9 document, up to the density node).P.max.z",
      meanX: "cook(chapter 9 document, up to the density node).P.mean.x",
      meanY: "cook(chapter 9 document, up to the density node).P.mean.y",
      meanZ: "cook(chapter 9 document, up to the density node).P.mean.z",
    },
    pattern:
      /P\s+f32\s+3\s+(?<minX>-?[\d.]+),(?<minY>-?[\d.]+),(?<minZ>-?[\d.]+)\s+(?<maxX>-?[\d.]+),(?<maxY>-?[\d.]+),(?<maxZ>-?[\d.]+)\s+(?<meanX>-?[\d.]+),(?<meanY>-?[\d.]+),(?<meanZ>-?[\d.]+)\s+0$/gm,
  },
  {
    // The MEAN of this row is deliberately not checked. It is the one
    // number in the table the page prints at a precision that does not
    // bound it: a u32 column's mean is rendered as a whole number, so
    // "round the measurement to the printed precision" — the rule every
    // other float here is compared under — has nothing to work with, and
    // the live mean (…434.83) differs from the printed …434 by more than
    // that rule allows while being the same measurement. min and max are
    // exact integers and are checked.
    page: "docs/manual.html",
    label: "chapter 14 — the seed row of the per-attribute table",
    sources: {
      min: "cook(chapter 9 document, up to the density node).seed.min",
      max: "cook(chapter 9 document, up to the density node).seed.max",
    },
    pattern: /seed\s+u32\s+1\s+(?<min>[\d.]+)\s+(?<max>[\d.]+)\s+[\d.]+\s+0$/gm,
  },
  {
    page: "docs/manual.html",
    label: "chapter 14 — the world bounds `pcg render` reports",
    sources: {
      minX: "cook(chapter 9 document).P.min.x",
      maxX: "cook(chapter 9 document).P.max.x",
      minZ: "cook(chapter 9 document).P.min.z",
      maxZ: "cook(chapter 9 document).P.max.z",
    },
    pattern:
      /bounds \(world\) x (?<minX>-?[\d.]+)\.\.(?<maxX>-?[\d.]+)\s+z (?<minZ>-?[\d.]+)\.\.(?<maxZ>-?[\d.]+)/g,
  },
  {
    page: "docs/manual.html",
    label: "chapter 14 — the density prose under the inspect table",
    sources: {
      min: "cook(chapter 9 document, up to the density node).density.min",
      max: "cook(chapter 9 document, up to the density node).density.max",
      mean: "cook(chapter 9 document, up to the density node).density.mean",
    },
    pattern:
      /density channel spans (?<min>[\d.]+) to (?<max>[\d.]+) with a mean of (?<mean>[\d.]+)/g,
  },
  {
    page: "docs/manual.html",
    label: "chapter 14 — the `pcg render` decimation report",
    sources: {
      drawn: "cook(chapter 9 document).pointCount",
      total: "cook(chapter 9 document).pointCount",
    },
    pattern: /(?<drawn>[\d,]+) of (?<total>[\d,]+) points, 0 of 0 primitives/g,
  },
  {
    page: "docs/manual.html",
    label: "chapter 14 — the decimation report quoted back in prose",
    sources: {
      drawn: "cook(chapter 9 document).pointCount",
      total: "cook(chapter 9 document).pointCount",
    },
    pattern: /<code>(?<drawn>[\d,]+) of (?<total>[\d,]+)<\/code> means nothing was decimated/g,
  },
  {
    page: "docs/manual.html",
    label: "chapter 14 — the `--json` twin's cook stats",
    sources: {
      cooked: 'cook(chapter 9 document, { outputs: ["points"] }).stats.cooked',
      cached: 'cook(chapter 9 document, { outputs: ["points"] }).stats.cached',
    },
    pattern:
      /<span class="s">"cooked"<\/span>: <span class="n">(?<cooked>\d+)<\/span>, <span class="s">"cached"<\/span>: <span class="n">(?<cached>\d+)<\/span>/g,
  },
  {
    page: "docs/manual.html",
    label: "chapter 14 — the `--json` twin's geometry counts",
    sources: {
      points: "cook(chapter 9 document).pointCount",
      vertices: "cook(chapter 9 document).vertexCount",
      primitives: "cook(chapter 9 document).primitiveCount",
    },
    pattern:
      /<span class="s">"points"<\/span>: <span class="n">(?<points>[\d,]+)<\/span>, <span class="s">"vertices"<\/span>: <span class="n">(?<vertices>[\d,]+)<\/span>, <span class="s">"primitives"<\/span>: <span class="n">(?<primitives>[\d,]+)<\/span>/g,
  },
  {
    page: "docs/manual.html",
    label: "chapter 14 — cook stats after the one-parameter edit",
    sources: {
      cooked: "cook(chapter 9 document, density frequency 0.09).stats.cooked",
      cached: "cook(chapter 9 document, density frequency 0.09).stats.cached",
    },
    pattern: /r2\.stats;\s*<span class="c">\/\/ \{ cooked: (?<cooked>\d+), cached: (?<cached>\d+) \}/g,
  },
  {
    page: "docs/manual.html",
    label: "chapter 14 — pointCount after the one-parameter edit, and before it",
    sources: {
      after: "cook(chapter 9 document, density frequency 0.09).pointCount",
      before: "cook(chapter 9 document).pointCount",
    },
    pattern:
      /r2\.outputs\.points\)\.pointCount;\s*<span class="c">\/\/ (?<after>[\d,]+)\s+\(was (?<before>[\d,]+)\)<\/span>/g,
  },
  {
    page: "docs/manual.html",
    label: "chapter 14 — cook stats after removeNode",
    sources: {
      cooked: "cook(chapter 9 document, spawn removed).stats.cooked",
      cached: "cook(chapter 9 document, spawn removed).stats.cached",
    },
    pattern:
      /<span class="c">\/\/ \{ cooked: (?<cooked>\d+), cached: (?<cached>\d+) \} — survivors all served warm<\/span>/g,
  },
];

export interface TranscriptMatch {
  /** Group name → the number as written, commas stripped. */
  readonly values: Readonly<Record<string, string>>;
  /** The matched text, for quoting back in a failure. */
  readonly text: string;
  /** 1-based line in the page. */
  readonly line: number;
}

/** Every place a transcript claim's pattern matches, with line numbers. */
export function findTranscriptMatches(html: string, pattern: RegExp): TranscriptMatch[] {
  const found: TranscriptMatch[] = [];
  const re = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    const values: Record<string, string> = {};
    for (const [name, raw] of Object.entries(m.groups ?? {})) {
      if (raw !== undefined) values[name] = raw.replaceAll(",", "");
    }
    found.push({ values, text: m[0], line: lineOf(html, m.index) });
    if (m[0].length === 0) re.lastIndex++;
  }
  return found;
}

/**
 * Round `value` to as many decimal places as `printed` carries.
 *
 * Half-away-from-zero, like `toFixed` and unlike `Math.round`, which
 * rounds half toward +Infinity and would therefore disagree with the
 * page's own rounding on a NEGATIVE value that lands exactly on a half.
 * That would be a false failure, and a false failure in a documentation
 * check trains people to edit the number without reading it.
 */
export function roundLike(value: number, printed: string): number {
  const dot = printed.indexOf(".");
  const places = dot < 0 ? 0 : printed.length - dot - 1;
  const scale = 10 ** places;
  const scaled = Math.abs(value) * scale;
  return (Math.sign(value) * Math.round(scaled)) / scale;
}

/**
 * Does the page's `printed` number agree with the measured `value`?
 *
 * The comparison rule for every number in a transcript, and the reason it
 * is the right one: THE PAGE DECIDES HOW PRECISE ITS OWN CLAIM IS. Print
 * `39.718` and three places have to agree; print `0.004381` and six do.
 * A fixed epsilon would either reject the page's own rounding or accept a
 * number that visibly disagrees with it.
 *
 * The second clause is what keeps that from being too generous. Rounding
 * alone gives a printed `0` a tolerance of ±0.5, and `0` is the most
 * common thing on this page — twelve of a transform's sixteen floats, the
 * whole Y axis of a flat scatter, every `vertices`/`primitives` count. A
 * Y that drifted to 0.4 would have been accepted. So where the page
 * printed no decimal point, the measurement has to be a whole number as
 * well: the page said "exactly zero", not "about zero", and it is held to
 * that.
 *
 * The one measurement that legitimately fails the second clause is a u32
 * column's MEAN, which the CLI renders as a whole number without being
 * one. That is not worked around here — the claim that would need it
 * omits the group and says why, which keeps the rule uniform.
 */
export function matchesPrinted(value: number, printed: string): boolean {
  if (!printed.includes(".") && !Number.isInteger(value)) return false;
  return Number(printed) === roundLike(value, printed);
}

/**
 * The chapter 9 JSON document, taken from the page rather than copied.
 *
 * "This document deserializes, cooks, and round-trips as written" is a
 * claim about the exact bytes on the page, so the test cooks the exact
 * bytes on the page. Everything chapters 2, 9 and 14 print about it —
 * point counts, cook stats, bounds, the instance batch — is then a
 * measurement of one live cook rather than a number anybody maintains.
 */
export function extractManualExample(html: string): string | undefined {
  return extractCodeBlock(html, "<h3>A complete working example</h3>");
}

/**
 * Plain text of the first `<pre><code>` block at or after `anchor`.
 *
 * Highlighting spans are stripped before the entities are decoded, so a
 * `class="s"` can never be read as part of the code, and a `&lt;` in the
 * code can never be read as a tag.
 */
export function extractCodeBlock(html: string, anchor: string): string | undefined {
  const at = html.indexOf(anchor);
  if (at < 0) return undefined;
  const block = /<pre><code>([\s\S]*?)<\/code><\/pre>/.exec(html.slice(at));
  if (block === null) return undefined;
  return decodeCode(block[1] as string);
}

/** Every `<pre><code>` block on the page, as plain text, in order. */
export function listCodeBlocks(html: string): string[] {
  const blocks: string[] = [];
  const re = /<pre><code>([\s\S]*?)<\/code><\/pre>/g;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    blocks.push(decodeCode(m[1] as string));
  }
  return blocks;
}

function decodeCode(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/**
 * The 16 floats of the first instance transform, printed in chapter 2.6.
 *
 * A transform is where a silent change shows up as a plausible-looking
 * number rather than a crash — a row/column swap keeps sixteen floats and
 * moves the translation into the wrong slot — so the whole matrix is
 * compared rather than the count of it.
 */
export function extractTransformRow(html: string): string[] | undefined {
  const at = html.indexOf("batch.transforms.<span class=\"n\">subarray</span>");
  if (at < 0) return undefined;
  const row = /\/\/ \[([^\]]*)\]/.exec(html.slice(at));
  if (row === null) return undefined;
  return (row[1] as string).split(",").map((n) => n.trim());
}

/**
 * The `point attrs:` line of chapter 14's `pcg cook --stats` transcript.
 *
 * Verbatim for the same reason the field-fn list is: this states the
 * standard attribute set a scatter mints, in order, with types and tuple
 * sizes. A count would miss a renamed attribute, a changed tuple size, or
 * a reordering — and reordering is exactly what a change to the scatter
 * node would do.
 */
export function extractPointAttrList(html: string): string[] | undefined {
  const block = listCodeBlocks(html).find((b) => b.includes("point attrs:"));
  if (block === undefined) return undefined;
  const lines = block.split("\n");
  const start = lines.findIndex((l) => l.includes("point attrs:"));
  if (start < 0) return undefined;
  // The list wraps across lines, continuing while the indentation holds.
  // The next thing at a shallower indent is the next section of the
  // report, not more attributes.
  const indent = (lines[start] as string).search(/\S/);
  const parts = [(lines[start] as string).split("point attrs:")[1] as string];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim() === "" || line.search(/\S/) < indent) break;
    parts.push(line);
  }
  return parts
    .join(" ")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** One printed row of chapter 14's `pcg inspect --rows 3` sample table. */
export interface SampleRow {
  readonly index: string;
  /** The three components of `P`, as printed. */
  readonly p: readonly string[];
  /** The `density` column, as printed. */
  readonly density: string;
  /** The `seed` column, as printed. */
  readonly seed: string;
}

/**
 * The sample rows chapter 14 prints from `pcg inspect --node density`.
 *
 * The densest verbatim measurement on the page: three positions, three
 * densities and three seeds, all of which move if anything at all changes
 * in the scatter, the field, or the seed derivation. Nothing else on the
 * page would notice a reseeding that kept every count identical.
 */
export function extractSampleRows(html: string): SampleRow[] | undefined {
  const block = listCodeBlocks(html).find((b) => b.includes("point rows:"));
  if (block === undefined) return undefined;
  const rows: SampleRow[] = [];
  const re = /^\s*(\d+)\s+\[([^\]]*)\]\s+(\S+)\s+(\S+)\s*$/gm;
  for (let m = re.exec(block); m !== null; m = re.exec(block)) {
    rows.push({
      index: m[1] as string,
      p: (m[2] as string).split(",").map((s) => s.trim()),
      density: m[3] as string,
      seed: m[4] as string,
    });
  }
  return rows.length > 0 ? rows : undefined;
}

/* ------------------------------------------------------------------ *
 * Error transcripts
 * ------------------------------------------------------------------ */

/**
 * Chapter 11 opens with "Every string below is real output, produced by
 * feeding the named mistake to the published build." Nothing checked it,
 * and the first transcript in the chapter — the one that enumerates the
 * whole node registry — was TWENTY TYPES BEHIND when this table was
 * written. That is the worst possible place for a stale list, because it
 * is presented to an agent as the authoritative answer to "what types
 * exist"; a reader taking the chapter at its word would have concluded
 * that `pathScan`, `repeatUntil` and eighteen others do not exist.
 *
 * So each entry names a mistake, and the test FEEDS THAT MISTAKE to the
 * live library and compares the whole message. `startsWith` locates the
 * transcript by its first line; a transcript ends at the next blank line,
 * or at `endsBefore` where the page shows something alongside the message
 * that is not part of it.
 *
 * Errors that need a live `Graph`, a cook, or a `World` are deliberately
 * absent — not because they are less important, but because each needs a
 * scenario built rather than a value fed, and a scenario built HERE could
 * drift from the one the page describes without either side noticing.
 * The ones listed are exactly the ones whose input is fully stated by the
 * page itself.
 */
export interface ErrorTranscript {
  /** The mistake, as the test's producer is registered under. */
  readonly mistake: string;
  /** First line of the transcript, verbatim, used to locate it. */
  readonly startsWith: string;
  /** A line that follows the message but is not part of it. */
  readonly endsBefore?: string;
}

export const ERROR_TRANSCRIPTS: readonly ErrorTranscript[] = [
  {
    mistake: 'a graph object with an unrecognized key "notes"',
    startsWith: 'deserializeGraph: unknown key "notes"',
  },
  {
    mistake: 'a node of unknown type "pointScatterInBox"',
    startsWith: 'GraphSerializationError: node "a": unknown node type "pointScatterInBox"',
  },
  {
    mistake: 'pointScatterInBounds with an unknown param "counts"',
    startsWith: 'GraphSerializationError: node "a": unknown param "counts"',
  },
  {
    mistake: "pointScatterInBounds with count -5",
    startsWith: 'GraphSerializationError: node "a" param "count": -5 is below the minimum',
  },
  {
    mistake: 'filterByDensity with mode "probablistic"',
    startsWith: 'GraphSerializationError: node "a" param "mode": expected one of',
  },
  {
    mistake: 'a connection from an output pin named "output"',
    startsWith: 'GraphSerializationError: connections[0]: node "a" has no output pin',
  },
  {
    mistake: 'a field spec with fn "perlin"',
    startsWith: 'FieldJsonError: $: unknown field fn "perlin"',
  },
  {
    mistake: 'a "clamp" field spec with two args',
    startsWith: 'FieldJsonError: $: fn "clamp" expects exactly 3 args',
  },
];

/**
 * The transcript beginning with `startsWith`, as one whitespace-normalized
 * line.
 *
 * The page hard-wraps these messages to fit its column, so the newlines
 * and indentation in the page are typesetting rather than content —
 * comparing them would fail on a rewrap that changed nothing. Everything
 * else is compared exactly.
 */
export function extractErrorTranscript(
  html: string,
  startsWith: string,
  endsBefore?: string,
): { text: string; raw: string } | undefined {
  for (const block of listCodeBlocks(html)) {
    const lines = block.split("\n");
    const start = lines.findIndex((l) => l.startsWith(startsWith));
    if (start < 0) continue;
    const kept: string[] = [];
    for (let i = start; i < lines.length; i++) {
      const line = lines[i] as string;
      if (i > start && line.trim() === "") break;
      if (endsBefore !== undefined && i > start && line.trim().startsWith(endsBefore)) break;
      kept.push(line);
    }
    const raw = kept.join("\n");
    return { text: raw.replace(/\s+/g, " ").trim(), raw };
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Transcribed code
 * ------------------------------------------------------------------ */

/**
 * Chapters 1 and 8 print CODE, not a document, so the test cannot feed
 * the page to the library the way it can with chapter 9 — it has to build
 * the same graph itself. That transcription is the one place in this file
 * where a value could go stale without anything noticing: edit the code
 * block, and the test happily keeps checking the old graph.
 *
 * Chapter 2.3 is transcribed too but is NOT here, because it prints no
 * graph code to pin against — its shape is stated in prose, and a test on
 * that sentence guards it instead.
 *
 * These are the guard. Every literal the transcription depends on has to
 * still be on the page, in that page's code, or the test says so and
 * names the transcription to update. It is a weaker guarantee than
 * chapter 9's — a reordering the substrings survive would go unnoticed —
 * and it is stated as weaker rather than dressed up: prefer moving a
 * future example into a JSON document the test can just read.
 */
export interface CodeEcho {
  /** The transcription in site.test.ts this guards. */
  readonly transcription: string;
  /** Markup identifying the code block the literals must appear in. */
  readonly anchor: string;
  /** Literals the transcription depends on, as they appear in the code. */
  readonly literals: readonly string[];
}

export const CODE_ECHOES: readonly CodeEcho[] = [
  {
    transcription: "chapter1Graph()",
    anchor: "<h3>A graph that cooks</h3>",
    literals: [
      "new Graph(42)",
      "graph.add(pointScatterInBounds, {",
      "count: 500",
      "boundsMin: [0, 0, 0]",
      "boundsMax: [50, 0, 50]",
      "graph.add(jitterPoints, {",
      "amount: remap(fbm(perlinNoise, { seed: 7, frequency: 0.05 }), -1, 1, 0, 1)",
      'graph.connect(scatter, "out", jitter, "in")',
      'graph.output(jitter, "out", "points")',
      "P.data.subarray(0, 3)",
    ],
  },
  {
    transcription: "chapter8GridGraph()",
    anchor: "<h3>Building a graph in code from a type name</h3>",
    literals: [
      'getNodeType("pointGrid")',
      "new Graph(5)",
      "g.add(def, { countX: 3, countZ: 3 })",
      'g.output(n, "out", "p")',
    ],
  },
];

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
