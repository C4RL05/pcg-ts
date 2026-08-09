/**
 * Corpus CI. Every example under `examples/graphs/` must deserialize,
 * cook inside a time budget, and still produce what the golden records —
 * and must produce it identically twice.
 *
 * WHAT THE GOLDEN PINS, AND WHY IT IS NOT A FLOAT DUMP. It holds element
 * counts per domain, attribute presence (name, type, tuple size),
 * instance batch shape, and the bounds of `P` compared within a
 * tolerance. A float-exact corpus fights every legitimate change — a
 * faster spatial grid, a reassociated sum, a rounding difference in a
 * transform — and a suite that fails on improvements is a suite that
 * gets relaxed until it catches nothing. Counts and attribute shape
 * survive an unrelated numerical improvement while still catching what
 * actually breaks: a filter that stopped filtering, a node that stopped
 * writing its attribute, a cloud that landed somewhere else.
 *
 * Float-exactness belongs in the last test instead, which cooks each
 * graph twice and compares the raw bytes. That compares a run against
 * itself rather than against a stored constant, so it tests determinism —
 * the hard invariant — and no intended change can make it stale.
 *
 * If the golden test fails on a change you meant to make, re-derive it
 * and read the diff: `npm run build && npm run corpus:golden`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deserializeGraph } from "../src/index.js";
import {
  CORPUS_TIME_LIMIT_MS,
  type CorpusGolden,
  cookCorpusGraph,
  corpusFingerprint,
  corpusStats,
  diffCorpusStats,
} from "../src/docs/corpus.js";
import { describeExample, loadCorpus } from "../src/docs/examples.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const GOLDEN_PATH = fileURLToPath(new URL("./corpus.golden.json", import.meta.url));

const corpus = loadCorpus(ROOT);
const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as CorpusGolden;

/** Where two rendered structures first differ, as one line each. */
function firstDifference(actual: string, expected: string): string {
  const a = actual.split("\n");
  const e = expected.split("\n");
  for (let i = 0; i < Math.max(a.length, e.length); i++) {
    if (a[i] !== e[i]) {
      return [
        `first difference at line ${i + 1}:`,
        `  first cook:  ${a[i] === undefined ? "<end>" : a[i]}`,
        `  second cook: ${e[i] === undefined ? "<end>" : e[i]}`,
      ].join("\n");
    }
  }
  return "structures differ only in trailing bytes";
}

describe("example corpus", () => {
  it("finds examples at all", () => {
    // Guards every per-file assertion below: an empty corpus generates a
    // green suite that tests nothing.
    expect(corpus.length).toBeGreaterThan(0);
  });

  it("the golden covers exactly the corpus on disk", () => {
    const onDisk = corpus.map((c) => c.file).sort();
    const recorded = Object.keys(golden.examples).sort();
    const missing = onDisk.filter((f) => !recorded.includes(f));
    const stale = recorded.filter((f) => !onDisk.includes(f));
    if (missing.length > 0 || stale.length > 0) {
      throw new Error(
        [
          "tests/corpus.golden.json no longer describes the corpus:",
          ...missing.map((f) => `  ${f}: on disk, not in the golden (added without regenerating?)`),
          ...stale.map((f) => `  ${f}: in the golden, not on disk (removed or renamed?)`),
          "",
          "  npm run build && npm run corpus:golden",
        ].join("\n"),
      );
    }
  });

  it("cooks from JSON alone — no dataInput anywhere", () => {
    // `dataInput` items are runtime-injected and a saved graph carries
    // none, so an example using one would deserialize, cook to nothing,
    // and teach a reader an idiom that cannot work from a file.
    const offenders = corpus
      .map(describeExample)
      .filter((e) => e.nodeTypes.includes("dataInput"))
      .map((e) => e.path);
    if (offenders.length > 0) {
      throw new Error(
        [
          "these corpus examples use `dataInput`, which carries nothing through",
          "serialization — use `meshPrimitive` for geometry a saved graph can cook:",
          ...offenders.map((p) => `  ${p}`),
        ].join("\n"),
      );
    }
  });

  for (const entry of corpus) {
    describe(entry.file, () => {
      it("deserializes", () => {
        expect(() => deserializeGraph(entry.json)).not.toThrow();
      });

      it("cooks within the time budget and matches the golden", async () => {
        const cooked = await cookCorpusGraph(entry.json);
        expect(cooked.cooked).toBeGreaterThan(0);
        if (cooked.elapsedMs > CORPUS_TIME_LIMIT_MS) {
          throw new Error(
            `${entry.path}: took ${cooked.elapsedMs.toFixed(1)} ms to load and cook, over the ` +
              `${CORPUS_TIME_LIMIT_MS} ms corpus budget. The corpus is authored small on purpose, ` +
              "so this is an order-of-magnitude regression, not a slow machine.",
          );
        }

        const expected = golden.examples[entry.file];
        if (expected === undefined) {
          throw new Error(
            `${entry.path}: no golden entry. Run \`npm run build && npm run corpus:golden\`.`,
          );
        }
        const diffs = diffCorpusStats(corpusStats(cooked.outputs), expected);
        if (diffs.length > 0) {
          throw new Error(
            [
              `${entry.path} no longer matches the golden (${diffs.length} difference(s)):`,
              "",
              ...diffs.map((d) => `  ${d}`),
              "",
              "The golden pins element counts, attribute names and types, instance",
              "batches, and bounds within a tolerance — never floats — so an unrelated",
              "numerical improvement should not have moved it. If this change is",
              "intended, re-derive the golden and read the diff before committing:",
              "",
              "  npm run build && npm run corpus:golden",
            ].join("\n"),
          );
        }
      });

      it("cooks byte-identically twice (determinism)", async () => {
        // Two separate deserializations, so the second cook re-derives
        // everything instead of serving one warm memo cache.
        const first = corpusFingerprint((await cookCorpusGraph(entry.json)).outputs);
        const second = corpusFingerprint((await cookCorpusGraph(entry.json)).outputs);
        const a = JSON.stringify(first, null, 1);
        const b = JSON.stringify(second, null, 1);
        if (a !== b) {
          throw new Error(
            [
              `${entry.path}: two cooks of the same graph produced different bytes.`,
              "Determinism is a hard invariant — same seed, same output, whatever the",
              "cook order — so this is a bug in a node, not a golden to update.",
              "",
              firstDifference(a, b),
            ].join("\n"),
          );
        }
      });
    });
  }
});
