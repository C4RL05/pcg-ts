/**
 * Layering guards for the gpu subpath (same pattern as noThreeInCore):
 * (a) core never imports src/gpu — the graph layer sees only structural
 * interfaces, so `pcg-ts` stays free of GPU code; (b) src/gpu never
 * imports three or src/three — the compiler is pure codegen over core
 * types. Walks every TypeScript file and fails on any static import,
 * side-effect import, dynamic import (string or template literal), or
 * require whose specifier crosses the boundary.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectSourceFiles } from "./testHelpers.js";

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));
const GPU_DIR = join(SRC_DIR, "gpu");

/**
 * Module specifiers in import/export-from, side-effect import, dynamic
 * import, and require positions (backticks included so template-literal
 * specifiers are caught too).
 */
const SPECIFIER_RES = [
  /from\s*(["'`])([^"'`]+)\1/g, // import|export ... from "x"
  /import\s*(["'`])([^"'`]+)\1/g, // side-effect import "x"
  /import\s*\(\s*(["'`])([^"'`]+)\1\s*\)/g, // dynamic import("x") / import(`x`)
  /require\s*\(\s*(["'`])([^"'`]+)\1\s*\)/g, // require("x")
];

function specifiersIn(source: string): string[] {
  const out: string[] = [];
  for (const re of SPECIFIER_RES) {
    for (const match of source.matchAll(re)) out.push(match[2]);
  }
  return out;
}

/** Does this specifier (from a file OUTSIDE src/gpu) reach src/gpu? */
function targetsGpu(spec: string): boolean {
  if (spec === "pcg-ts/gpu") return true;
  if (!spec.startsWith(".")) return false;
  return spec.endsWith("/gpu") || spec.includes("/gpu/");
}

/** Does this specifier (from a file inside src/gpu) reach three? */
function targetsThree(spec: string): boolean {
  if (spec === "three" || spec.startsWith("three/")) return true;
  if (!spec.startsWith(".")) return false;
  return spec.endsWith("/three") || spec.includes("/three/");
}

/**
 * Both scans below cover TEST files too — a core test that imports
 * src/gpu is exactly the leak this file exists to catch.
 */
const tsFiles = (dir: string, skipDir?: string): string[] =>
  collectSourceFiles(dir, { includeTests: true, ...(skipDir !== undefined ? { skipDir } : {}) });

describe("gpu layering", () => {
  it("detector flags every import form reaching src/gpu", () => {
    const flagged = [
      'import { compileFieldSpec } from "../gpu/index.js";',
      'import { compileFieldSpec } from "pcg-ts/gpu";',
      'export * from "./gpu";',
      'import "../gpu/compile.js";',
      'const gpu = await import("../../gpu/index.js");',
      "const mod = await import(`./gpu`);",
      'const lazy = require("../gpu");',
    ];
    for (const source of flagged) {
      expect(specifiersIn(source).filter(targetsGpu), `should flag: ${source}`).not.toEqual([]);
    }
  });

  it("detector passes benign sources", () => {
    const clean = [
      'import { Geometry } from "../data/index.js";',
      'import { x } from "./gpuish.js";', // name merely starts with "gpu"
      'import { y } from "../graph/gpu-utils.js";', // hyphenated sibling
      'const label = "gpu subgraphs";', // plain string, not an import
      'await import("./debug.js");',
    ];
    for (const source of clean) {
      expect(specifiersIn(source).filter(targetsGpu), `should pass: ${source}`).toEqual([]);
    }
  });

  it("no core file imports src/gpu (only tests inside src/gpu may)", () => {
    const files = tsFiles(SRC_DIR, GPU_DIR);
    expect(files.length).toBeGreaterThan(10); // sanity: the walk found the core

    const offenders = files
      .map((file) => ({ file, hits: specifiersIn(readFileSync(file, "utf8")).filter(targetsGpu) }))
      .filter(({ hits }) => hits.length > 0)
      .map(({ file, hits }) => `${file} -> ${hits.join(", ")}`);
    expect(offenders, "core files importing src/gpu (nothing outside src/gpu may)").toEqual([]);
  });

  it("src/gpu never imports three or src/three", () => {
    const files = tsFiles(GPU_DIR);
    expect(files.length).toBeGreaterThan(3); // sanity: the walk found the gpu module

    const offenders = files
      .map((file) => ({ file, hits: specifiersIn(readFileSync(file, "utf8")).filter(targetsThree) }))
      .filter(({ hits }) => hits.length > 0)
      .map(({ file, hits }) => `${file} -> ${hits.join(", ")}`);
    expect(offenders, "src/gpu files importing three (gpu must stay three-free)").toEqual([]);
  });
});
