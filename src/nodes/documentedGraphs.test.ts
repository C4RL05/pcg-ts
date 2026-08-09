/**
 * Every graph JSON printed in the docs must still deserialize.
 *
 * The docs are part of the agent API: an agent reads `llms.txt` or
 * `authoring.md`, copies the shape it finds, and expects it to load. So a
 * tightening of the format — phase 36 closed unknown keys at every object
 * position — can invalidate the documentation without touching a line of
 * it, and nothing would say so. This walks the prose, extracts every
 * embedded graph, and loads it.
 *
 * If this fails, the fix is to correct the DOCUMENTED example (or to
 * reconsider the format change), never to relax the test.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// The package root, not ./index.js: node types register as a side effect
// of the module that defines them, and spawnInstances lives in src/spawn.
// A documented graph may name ANY registered type, so the test has to see
// the same registry a `pcg` run does.
import { deserializeGraph, registerSubgraph } from "../index.js";
import { __resetSubgraphRegistry } from "./subgraphRegistry.js";

const ROOT = new URL("../../", import.meta.url);

/** Files that carry hand-authored graph JSON, with how many to expect. */
const SOURCES: readonly { readonly file: string; readonly atLeast: number }[] = [
  { file: "README.md", atLeast: 1 },
  { file: "llms.txt", atLeast: 1 },
  { file: "docs/authoring.md", atLeast: 4 },
  { file: "docs/manual.html", atLeast: 2 },
];

/** HTML entities the manual's syntax highlighting introduces. */
function decodeEntities(text: string): string {
  return text
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&");
}

/**
 * The substring of `text` starting at the `{` at `start` and ending at its
 * matching `}`, or `undefined` when the braces never balance. String
 * literals (and their escapes) are skipped, so a brace inside a
 * description cannot end the object early.
 */
function braceMatch(text: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return undefined;
}

/**
 * Parse one candidate as JSON, falling back to a JS object literal —
 * README and the manual show graphs as TypeScript literals (unquoted
 * keys, trailing commas) passed straight to `deserializeGraph`, and those
 * are exactly as much a documented shape as the fenced JSON is. Evaluating
 * is safe here and only here: the input is this repository's own
 * documentation, read from disk by its own test suite.
 */
function parseObjectLiteral(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch {
    try {
      return Function(`"use strict"; return (${candidate});`)() as unknown;
    } catch {
      // An elided snippet, or not the enclosing object; keep walking out.
      return undefined;
    }
  }
}

/**
 * Every parseable object in `text` carrying a `formatVersion` key. Walks
 * back from each occurrence to the innermost enclosing object that parses,
 * so it works the same in fenced markdown and in highlighted HTML without
 * knowing anything about either.
 */
function extractGraphs(text: string): unknown[] {
  const found: unknown[] = [];
  // Unquoted, so it matches both the JSON `"formatVersion"` and the
  // TypeScript literal `formatVersion:`. Prose mentions of the word walk
  // back to some unrelated brace, fail to parse, and are skipped.
  const key = "formatVersion";
  for (let at = text.indexOf(key); at !== -1; at = text.indexOf(key, at + 1)) {
    for (let open = text.lastIndexOf("{", at); open >= 0; open = text.lastIndexOf("{", open - 1)) {
      const candidate = braceMatch(text, open);
      if (candidate === undefined || open + candidate.length < at) continue;
      const parsed = parseObjectLiteral(candidate);
      if (parsed !== undefined) {
        found.push(parsed);
        break;
      }
    }
  }
  return found;
}

describe("graph JSON printed in the docs", () => {
  for (const { file, atLeast } of SOURCES) {
    it(`still deserializes every graph in ${file}`, () => {
      const raw = readFileSync(fileURLToPath(new URL(file, ROOT)), "utf8");
      const graphs = extractGraphs(file.endsWith(".html") ? decodeEntities(raw) : raw);

      // A count floor, because a snippet that stopped parsing would
      // otherwise be silently skipped and this test would pass by
      // examining nothing.
      expect(graphs.length, `graphs extracted from ${file}`).toBeGreaterThanOrEqual(atLeast);

      graphs.forEach((graph, i) => {
        // A documented example may reference a primitive by name; the
        // registry is empty in tests, so register a stand-in under
        // whatever name it asks for rather than failing on the lookup.
        __resetSubgraphRegistry();
        for (const name of referencedNames(graph)) {
          registerSubgraph(name, {
            graph: { formatVersion: 1, seed: 0, nodes: [], connections: [], outputs: [] },
          });
        }
        expect(
          () => deserializeGraph(graph),
          `${file} graph #${i + 1}: ${JSON.stringify(graph).slice(0, 120)}...`,
        ).not.toThrow();
      });
    });
  }
});

/** Subgraph names a documented graph references by `ref`. */
function referencedNames(graph: unknown): string[] {
  const nodes = (graph as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes
    .map((n: unknown) => (n as { ref?: { name?: unknown } }).ref?.name)
    .filter((name): name is string => typeof name === "string");
}
