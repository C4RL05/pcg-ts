/**
 * Layering guard: `src/three` is the only module allowed to import
 * `three` (see CLAUDE.md). Walks every TypeScript file under src/
 * except src/three and fails on any static import, side-effect import,
 * dynamic import (string or template literal), or require whose
 * specifier is the `three` package (or a `three/...` subpath) — or a
 * relative specifier resolving into src/three, which would pull three
 * in transitively.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));
const THREE_DIR = join(SRC_DIR, "three");

/**
 * Module specifiers in import/export-from, side-effect import, dynamic
 * import, and require positions. Quote class includes backticks so plain
 * template-literal specifiers (`import(\`three\`)`) are caught too.
 */
const SPECIFIER_RES = [
  /from\s*(["'`])([^"'`]+)\1/g, // import|export ... from "x"
  /import\s*(["'`])([^"'`]+)\1/g, // side-effect import "x"
  /import\s*\(\s*(["'`])([^"'`]+)\1\s*\)/g, // dynamic import("x") / import(`x`)
  /require\s*\(\s*(["'`])([^"'`]+)\1\s*\)/g, // require("x")
];

/** Does this specifier (from a file OUTSIDE src/three) reach three? */
function specifierTargetsThree(spec: string): boolean {
  if (spec === "three" || spec.startsWith("three/")) return true;
  // Relative path into src/three (e.g. "../three/debug.js", "./three").
  if (!spec.startsWith(".")) return false;
  return spec.endsWith("/three") || spec.includes("/three/");
}

/** All specifiers in `source` that reach three (empty = clean). */
function threeImportsIn(source: string): string[] {
  const hits: string[] = [];
  for (const re of SPECIFIER_RES) {
    for (const match of source.matchAll(re)) {
      if (specifierTargetsThree(match[2])) hits.push(match[2]);
    }
  }
  return hits;
}

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
  it("detector flags every import form reaching three", () => {
    const flagged = [
      'import { Group } from "three";',
      "import * as THREE from 'three';",
      'export { Box3 } from "three";',
      'import "three";',
      'import { MeshBVH } from "three/examples/jsm/utils/whatever.js";',
      'const three = await import("three");',
      "const mod = await import(`three`);",
      'const lazy = require("three");',
      "const sub = require(`three/examples/jsm/x.js`);",
      // Relative specifiers resolving into src/three (transitive three).
      'import { toPointsObject } from "../three/debug.js";',
      'import { fromCurve } from "./three/index.js";',
      'export * from "../../three";',
      "const adapters = await import(`../three/instanced.js`);",
      'const binding = require("./three");',
    ];
    for (const source of flagged) {
      expect(threeImportsIn(source), `should flag: ${source}`).not.toEqual([]);
    }
  });

  it("detector passes benign sources", () => {
    const clean = [
      'import { Geometry } from "../data/index.js";',
      'import { x } from "./threeish.js";', // name merely starts with "three"
      'import { y } from "../graph/three-utils.js";', // hyphenated sibling
      'const n = require("./nothree.js");', // name merely contains "three"
      'const label = "three of them";', // plain string, not an import
      "const total = batchCount * 3; // three per row",
      'await import("./debug.js");',
    ];
    for (const source of clean) {
      expect(threeImportsIn(source), `should pass: ${source}`).toEqual([]);
    }
  });

  it("no core file imports three, directly or via src/three", () => {
    const files: string[] = [];
    walk(SRC_DIR, files);
    expect(files.length).toBeGreaterThan(10); // sanity: the walk found the core

    const offenders = files
      .map((file) => ({ file, hits: threeImportsIn(readFileSync(file, "utf8")) }))
      .filter(({ hits }) => hits.length > 0)
      .map(({ file, hits }) => `${file} -> ${hits.join(", ")}`);
    expect(offenders, "core files importing three (only src/three may)").toEqual([]);
  });
});
