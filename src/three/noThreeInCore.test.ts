/**
 * Layering guard: `src/three` is the only module allowed to import
 * `three` (see CLAUDE.md). Walks every TypeScript file under src/
 * except src/three and fails on any static import, dynamic import, or
 * require of "three" (or a "three/..." subpath).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));
const THREE_DIR = join(SRC_DIR, "three");

const PATTERNS = [
  /from\s*["']three(?:\/[^"']*)?["']/, // import|export ... from "three"
  /import\s*["']three(?:\/[^"']*)?["']/, // side-effect import "three"
  /import\s*\(\s*["']three(?:\/[^"']*)?["']\s*\)/, // dynamic import("three")
  /require\s*\(\s*["']three(?:\/[^"']*)?["']\s*\)/, // require("three")
];

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path === THREE_DIR) continue;
      walk(path, out);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(path);
    }
  }
}

describe("layering", () => {
  it("no core file imports three", () => {
    const files: string[] = [];
    walk(SRC_DIR, files);
    expect(files.length).toBeGreaterThan(10); // sanity: the walk found the core

    const offenders = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return PATTERNS.some((re) => re.test(source));
    });
    expect(offenders, "core files importing three (only src/three may)").toEqual([]);
  });
});
