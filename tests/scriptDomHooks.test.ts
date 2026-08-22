/**
 * Cross-check between the CSS class hooks `scripts/*.mjs` queries in the
 * browser pages and the classes those pages actually render.
 *
 * WHY THIS EXISTS. `scripts/capture-demos.mjs` drives the editor and the
 * three hosted demos through their own markup -- `.toolbar .status` to read
 * the cook state, `.toolbar .path.cook select` to switch cook paths,
 * `.toolbar button.view` to cycle the view -- and none of it is typechecked
 * or imported, so a refactor of that markup has no compiler and no test to
 * answer to. Three of these selectors broke silently in one UI pass: `.path`
 * became ambiguous once a second `.path` element existed, `.path.cook`
 * disappeared for a redesign cycle, and the view-cycling button's selector
 * changed to what it is today (`.toolbar button.view`). Each failure showed
 * up only as a capture script erroring out -- or worse, timing out -- the
 * next time a human ran it by hand.
 *
 * WHAT THIS CHECKS. Every class token named in a selector literal passed to
 * `.querySelector`, `.querySelectorAll`, `.waitForSelector` or puppeteer's
 * `.$` inside scripts/**\/*.mjs must appear as a class SOMEWHERE in the
 * Svelte/TS/HTML sources under editor/, demos/ and shared/ -- as a
 * class="..." / class:name attribute, or set programmatically via
 * `.className` or `.classList.add/toggle(...)`. (`preview/` is excluded:
 * only preview/index.html and preview/main.ts are tracked, the rest of
 * that directory is gitignored render output and scratch probes that have
 * nothing to do with what ships.)
 *
 * WHAT THIS CANNOT CATCH, deliberately left uncaught rather than chased
 * with a real CSS engine:
 *   - COMPOUND/DESCENDANT STRUCTURE. This is a token set, not a DOM tree:
 *     it proves a class exists somewhere, not that it lands on the element
 *     a selector's `.a.b` or `.a .b` shape implies. A class that moved to
 *     the wrong element reads as fine here. That gap is not hypothetical:
 *     writing this file is what turned up `.panel .stat` in
 *     capture-demos.mjs, which had been matching NOTHING since `.panel`
 *     went to the editor's docked panels and `.stat` to the toolbar's
 *     status line -- two elements that never nest. Both classes existed,
 *     so a check of this shape passed it. The selector is now
 *     `.status .stat` and the script throws when a scrape comes back
 *     empty, which is the guard this file cannot be.
 *   - A selector built by string concatenation or template interpolation:
 *     only its literal substrings are visible, so an entirely
 *     interpolated selector is invisible to this check rather than
 *     flagged as unparseable.
 *   - A selector handed to a local helper (this file's own
 *     `setSelectByValue`, say) rather than passed directly to one of the
 *     four query calls above -- the literal is seen at its call site, not
 *     traced through the variable the helper receives it as.
 *   - Attribute-VALUE selectors, e.g. `option[value="gpu-fused"]`: only
 *     `.class` tokens are extracted, so a stale option value would not
 *     be caught here.
 *
 * FALSIFIED BY HAND before this file was committed: renamed Toolbar.svelte's
 * view button class from "view" to "viewx", ran this suite, watched the
 * ".view (queried by scripts/capture-demos.mjs ...)" case go red with
 * exactly the class-not-found message below, then restored the file.
 * Nothing about that rename is checked in.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCRIPTS_DIR = join(ROOT, "scripts");
const SOURCE_DIRS = ["editor", "demos", "shared"].map((d) => join(ROOT, d));

function walk(dir: string, exts: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

function displayName(file: string): string {
  return relative(ROOT, file).replace(/\\/g, "/");
}

const scriptFiles = walk(SCRIPTS_DIR, [".mjs", ".js"]);
const sourceFiles = SOURCE_DIRS.flatMap((d) => walk(d, [".svelte", ".ts", ".html"]));

/**
 * `.querySelector(...)`, `.querySelectorAll(...)`, `.waitForSelector(...)`
 * and puppeteer's `.$(...)` -- matched by method name alone, regardless of
 * receiver (`document`, `row`, `page`, `el`, ...), so one pattern covers
 * every call site instead of enumerating them. Group 1 is the quote
 * character, group 2 the literal between a matching pair of it -- a
 * backreference rather than a plain `[^"']*` class, because a Svelte
 * attribute mustache like `class="stat {s.tone ?? ''}"` embeds the OTHER
 * quote character and would otherwise truncate the match early.
 */
const CALL_RE = /\.(?:querySelector|querySelectorAll|waitForSelector|\$)\(\s*(["'`])((?:(?!\1)[\s\S])*?)\1/g;

/** `.foo` / `.foo.bar` -> ["foo", "bar"]. Tag names and attribute selectors carry no dot and are dropped. */
function classTokens(selector: string): string[] {
  return [...selector.matchAll(/\.([a-zA-Z_-][\w-]*)/g)].map((m) => m[1]!);
}

interface Hook {
  readonly cls: string;
  readonly selector: string;
  readonly file: string;
}

function hooksIn(file: string): Hook[] {
  const text = readFileSync(file, "utf8");
  const out: Hook[] = [];
  for (const m of text.matchAll(CALL_RE)) {
    const selector = m[2]!;
    for (const cls of classTokens(selector)) out.push({ cls, selector, file });
  }
  return out;
}

const hooks = scriptFiles.flatMap(hooksIn);

/**
 * Every class name the browser pages could plausibly carry at runtime:
 * static class="..." / className="..." attribute contents (split on
 * whitespace, since an attribute is a space-separated list), Svelte's
 * `class:name` shorthand directive, and classes set imperatively via
 * `classList.add/toggle/remove("name")` -- `shared/overlay.ts` builds its
 * panel with `document.createElement` + `.className`, not markup, so the
 * attribute regex alone would miss every class it uses.
 */
function knownClasses(files: readonly string[]): Set<string> {
  const known = new Set<string>();
  const attrRe = /\bclass(?:Name)?\s*=\s*(["'])((?:(?!\1)[\s\S])*?)\1/g;
  const directiveRe = /\bclass:([a-zA-Z_][\w-]*)/g;
  const listRe = /classList\.(?:add|toggle|remove)\(\s*(["'])((?:(?!\1)[\s\S])*?)\1/g;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(attrRe)) {
      for (const tok of m[2]!.trim().split(/\s+/)) if (tok !== "") known.add(tok);
    }
    for (const m of text.matchAll(directiveRe)) known.add(m[1]!);
    for (const m of text.matchAll(listRe)) known.add(m[2]!);
  }
  return known;
}

const known = knownClasses(sourceFiles);

describe("scripts' DOM hooks still exist in editor/demos/shared", () => {
  it("found selector hooks in scripts/ to check", () => {
    // An empty list would make every `it` below vacuous -- the same guard
    // tests/scriptsSyntax.test.ts keeps on its own file count.
    expect(hooks.length).toBeGreaterThan(0);
  });

  it("found candidate classes in the browser pages", () => {
    expect(known.size).toBeGreaterThan(0);
  });

  // One `it` per (class, file) pair, not per occurrence: capture-demos.mjs
  // queries ".toolbar .status" from four different demo entries, and a
  // renamed class should read as one broken hook, not four.
  const seen = new Set<string>();
  for (const hook of hooks) {
    const key = hook.cls + "|" + hook.file;
    if (seen.has(key)) continue;
    seen.add(key);
    it(`.${hook.cls} (queried by ${displayName(hook.file)} as "${hook.selector}")`, () => {
      if (!known.has(hook.cls)) {
        throw new Error(
          [
            `no class="${hook.cls}" (or class:${hook.cls}, or a classList call naming it) found`,
            "under editor/, demos/ or shared/, but this selector queries it:",
            `  ${displayName(hook.file)}: "${hook.selector}"`,
            "",
            "Either the markup renamed or removed the hook and the script needs updating,",
            "or the class is real but spelled differently here -- check the source directly.",
          ].join("\n"),
        );
      }
    });
  }
});

/**
 * A second thing `scripts/*.mjs` does that no compiler answers for: it
 * injects functions with `evaluateOnNewDocument`, which fires BEFORE the
 * page is parsed. There is no `<html>` yet at that moment, so
 * `document.documentElement` is null and `document.head` is null, and a
 * function that appends to either throws.
 *
 * It cost a whole capture run to learn. The thrown error surfaced as seven
 * identical "page reported 1 error(s): Cannot read properties of null" —
 * one per demo, naming the appendChild and not the reason — and the run
 * produced no frames at all. Nothing before this caught it, because the
 * function is a string handed to a browser: it is never imported, never
 * typechecked, and never executed by any test.
 *
 * The rule is narrow on purpose: touch the document from one of these and
 * you must say what happens when it is not there yet. A guard, a `??`, or
 * a wait — this does not care which, only that the question was asked.
 */
const EARLY_RE = /evaluateOnNewDocument\(\s*([A-Za-z_$][\w$]*)\s*\)/g;

/** The source of a top-level `function name(...) { ... }`, braces matched. */
function functionBody(src: string, name: string): string | null {
  const start = src.search(new RegExp(`^function ${name}\\s*\\(`, "m"));
  if (start < 0) return null;
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}

describe("what the capture scripts inject before the page exists", () => {
  const injected: { script: string; name: string; body: string }[] = [];
  for (const file of scriptFiles) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(EARLY_RE)) {
      const body = functionBody(src, m[1]);
      if (body !== null) injected.push({ script: displayName(file), name: m[1], body });
    }
  }

  it("finds the injected functions at all", () => {
    // Without this the suite below passes by iterating an empty list, which
    // is the failure mode of every test that looks for a pattern in source.
    expect(injected.length).toBeGreaterThan(0);
  });

  it.each(injected)("$script: $name survives a document that is not there yet", ({ body }) => {
    const reaches = /document\.(documentElement|head|body)\s*\.\s*(appendChild|insertBefore|append|prepend)/.test(
      body,
    );
    if (!reaches) return;
    const guarded =
      /\?\?/.test(body) ||
      /\bif\s*\(\s*document\.(documentElement|head|body)/.test(body) ||
      /DOMContentLoaded|readystatechange/.test(body);
    expect(guarded).toBe(true);
  });
});
