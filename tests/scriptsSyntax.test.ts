/**
 * Syntax gate for the repo's standalone scripts (`scripts/**\/*.mjs`,
 * recursively — includes `scripts/lib/`).
 *
 * WHY THIS EXISTS. `scripts/capture-demos.mjs` once carried a doc comment
 * that spelled out a glob inline — `demos` then two stars then a slash
 * then a star — and the star-slash sitting inside that glob closed the
 * block comment early, leaving real prose sitting where code was
 * expected. The file failed to PARSE. Nothing caught it:
 * nothing under src/ imports scripts/*.mjs, so `tsc --noEmit` never looks
 * at them, and `vitest run` never touches them either — they are I/O
 * entry points invoked with `node scripts/foo.mjs`, not modules anything
 * requires. `npm test`, `npm run check` and CI all stayed green. Only a
 * human running `npm run capture` by hand ever found it.
 *
 * `node --check` parses a file without executing it, which is the property
 * this gate actually needs: these scripts launch a real browser and write
 * to disk, and a check that ran them for real would be a very expensive,
 * very side-effectful way to ask a question V8 can answer in milliseconds.
 * It infers module vs. script from the .mjs/.js extension exactly the way
 * `node scripts/foo.mjs` would, so no `--input-type` flag is needed —
 * verified empirically below by reproducing the actual defect against a
 * throwaway temp file.
 *
 * DISCOVERED, NOT LISTED. `readdirSync` walks scripts/ rather than
 * enumerating file names, so a script added later is covered on its next
 * test run with no edit to this file — the same reasoning tests/pipeline.
 * test.ts uses `loadGraphs` for instead of a literal array. Walking the
 * filesystem instead of shelling out to `git ls-files` means this also
 * catches a syntax error in a script that has not been committed yet, and
 * it needs nothing beyond a checked-out source tree to run.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCRIPTS_DIR = join(ROOT, "scripts");

/** Every .mjs/.js file under `dir`, recursively. */
function findScripts(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findScripts(full));
    else if (/\.(?:mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const scripts = findScripts(SCRIPTS_DIR);

function displayName(file: string): string {
  return relative(ROOT, file).replace(/\\/g, "/");
}

describe("scripts parse (node --check)", () => {
  it("found at least one script under scripts/", () => {
    // Guards every `it` generated below: an empty list would make this
    // suite pass while checking nothing — the exact way the real defect
    // slipped past every other gate in the repo.
    expect(scripts.length).toBeGreaterThan(0);
  });

  for (const file of scripts) {
    it(`${displayName(file)} is syntactically valid`, () => {
      const proc = spawnSync(process.execPath, ["--check", file], {
        encoding: "utf8",
        timeout: 10_000,
      });
      if (proc.status !== 0) {
        throw new Error(
          `node --check ${displayName(file)} failed:\n${(proc.stderr || proc.stdout || "").trim()}`,
        );
      }
    });
  }

  it("node --check actually rejects a broken file", () => {
    // Falsifiability for the MECHANISM, not for the corpus: every `it`
    // above only means something if `--check` is capable of failing at
    // all. Reproduces the real defect — a glob spelled out inside a block
    // comment, whose `*/` closes the comment early — against a throwaway
    // file in the OS temp dir, then deletes it; nothing here is committed.
    const dir = mkdtempSync(join(tmpdir(), "pcg-script-syntax-"));
    const broken = join(dir, "broken.mjs");
    try {
      writeFileSync(
        broken,
        [
          "/**",
          " * a doc comment that spells out demos/**/* right in the middle,",
          " * which is exactly what closed capture-demos.mjs's comment early",
          " */",
          "console.log('unreachable if this parsed correctly');",
          "",
        ].join("\n"),
      );
      const proc = spawnSync(process.execPath, ["--check", broken], {
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(proc.status).not.toBe(0);
      expect(proc.stderr).toMatch(/SyntaxError/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
