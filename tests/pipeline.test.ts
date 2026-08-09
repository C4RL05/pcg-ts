/**
 * The staged pipeline (`examples/graphs/pipeline-*.json`), and the one
 * property that makes it a pipeline rather than six unrelated graphs.
 *
 * THE PROPERTY. Each stage's file is the previous stage's file plus new
 * nodes, connections and outputs. Nothing is removed, no shared node is
 * retuned, and the graph seed never moves — so every earlier stage
 * reproduces BIT-IDENTICALLY inside every later one. That works because a
 * node's seed is `hashCombine(graphSeed, hashString(nodeId))`: node-local,
 * and independent of where the node sits in the DAG, so adding a whole
 * district layer downstream cannot perturb the terrain upstream of it.
 *
 * WHY IT IS A TEST AND NOT A CLAIM IN A DESCRIPTION. The property is
 * invisible in any one file — it lives between files — and it is exactly
 * the kind of thing that rots on the first edit: retune one shared param
 * to make stage 4 look better and stages 1-3 quietly stop being the same
 * graph, while every file still cooks, still validates, and still matches
 * its own golden. Nothing else in the suite would notice. So the structural
 * superset is checked here directly, and the bit-identity it buys is
 * checked against `corpusFingerprint` — the same float-exact hash the
 * determinism test uses, run across two DIFFERENT graphs instead of two
 * cooks of one — for EVERY pair, chained and edited alike.
 *
 * "Superset" includes the ORDER of the edges into a multi-input pin. That
 * is not pedantry: a merge consumes its connections in file order and the
 * prune behind it is index-greedy, so order is what makes an authored edit
 * beat a generated lot. Swapping two edges into one pin removes nothing,
 * renames nothing and retunes nothing — and changes the cook. See
 * `connectionKeys`.
 *
 * The `-edits` variants are the payoff. An edited stage is its base plus
 * authored geometry and ONE connection into a slot the base reserved, so
 * it is a superset too — and `terrain`, `boundary` and `districts` stay
 * bit-identical while `lots` changes. That is the claim "an edit is local"
 * as an assertion rather than a hope.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CorpusGolden, cookCorpusGraph, corpusFingerprint } from "../src/docs/corpus.js";
import { CORPUS_DIR, type CorpusFile, loadCorpus } from "../src/docs/examples.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const GOLDEN_PATH = fileURLToPath(new URL("./corpus.golden.json", import.meta.url));

const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as CorpusGolden;

const PREFIX = "pipeline-";

/**
 * The whole staged set, by file name. Enumerated through `loadCorpus` — the
 * same reader the index, the golden and the cook test go through — so a
 * pipeline file that fails to be picked up there fails here too, rather
 * than silently dropping out of this suite while passing that one.
 */
const stages = new Map<string, CorpusFile>(
  loadCorpus(ROOT)
    .filter((c) => c.file.startsWith(PREFIX))
    .map((c) => [c.file, c]),
);

/**
 * The chains, as consecutive pairs of (earlier, later). Two of them: the
 * base pipeline, and the edited one that branches off it at stage 3.
 */
const CHAIN: readonly (readonly [string, string])[] = [
  ["pipeline-1-boundary.json", "pipeline-2-districts.json"],
  ["pipeline-2-districts.json", "pipeline-3-lots.json"],
  ["pipeline-3-lots.json", "pipeline-4-detail.json"],
  ["pipeline-3-lots-edits.json", "pipeline-4-detail-edits.json"],
];

/** The (base, edited) pairs: same stage, one with an authored edit layer. */
const EDITED: readonly (readonly [string, string])[] = [
  ["pipeline-3-lots.json", "pipeline-3-lots-edits.json"],
  ["pipeline-4-detail.json", "pipeline-4-detail-edits.json"],
];

/** Outputs an edit must NOT reach: everything upstream of where it enters. */
const UPSTREAM_OF_EDITS = ["terrain", "boundary", "districts"];

/** Ceiling on instances across every declared output of one stage. */
const INSTANCE_BUDGET = 1000;

// ---------------------------------------------------------------------------
// Reading a serialized graph structurally. Deliberately NOT through
// `deserializeGraph`: the property is about the authored FILES, and a
// round-trip through the graph builder fills defaults, canonicalizes tuples
// and re-serializes params — which would make two files that differ compare
// equal, hiding exactly the retune this test exists to catch.
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function graphOf(file: string): Json {
  const entry = stages.get(file);
  if (entry === undefined) {
    throw new Error(
      `${CORPUS_DIR}/${file} is not in the corpus. The staged pipeline is enumerated by ` +
        `loadCorpus, so either the file was renamed or its prefix is no longer listed in ` +
        "CORPUS_PREFIXES (src/docs/examples.ts).",
    );
  }
  return entry.json as Json;
}

/** Key order is not content: sort it away before comparing two param trees. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      sorted[k] = (v as Record<string, unknown>)[k];
    }
    return sorted;
  });
}

function nodesById(graph: Json): Map<string, Json> {
  const out = new Map<string, Json>();
  for (const n of graph.nodes as Json[]) out.set(String(n.id), n);
  return out;
}

/**
 * `from.pin -> to.pin #n`, the identity of one edge — where `n` is the
 * edge's ORDINAL among the connections sharing its destination pin.
 *
 * The ordinal is not decoration. A multi-input pin consumes its connections
 * in file order, and the pipeline's whole edit mechanism is built on that:
 * `compose/merge-tagged` concatenates in the order it receives, and the
 * `selfPrune` behind it is index-greedy, so whichever branch is connected
 * FIRST wins every contested position. Authored edits beat generated lots
 * by construction, not by luck. Key an edge by its endpoints alone and
 * swapping two connections into one pin is invisible: measured, swapping
 * the two feeding `editPts.in` in pipeline-4-detail-edits.json changes
 * `lots`, `footprints` and `buildings`, and every structural check here
 * still passed. A test that cannot see order cannot protect the property
 * the pipeline is built on.
 */
function connectionKeys(graph: Json): Set<string> {
  const out = new Set<string>();
  const seen = new Map<string, number>();
  for (const c of graph.connections as Json[]) {
    const from = c.from as [string, string];
    const to = c.to as [string, string];
    const dst = `${to[0]}.${to[1]}`;
    const ordinal = (seen.get(dst) ?? -1) + 1;
    seen.set(dst, ordinal);
    out.add(`${from[0]}.${from[1]} -> ${dst} #${ordinal}`);
  }
  return out;
}

function outputsByName(graph: Json): Map<string, string> {
  const out = new Map<string, string>();
  for (const o of graph.outputs as Json[]) out.set(String(o.name), `${String(o.id)}.${String(o.pin)}`);
  return out;
}

/**
 * Float-exact fingerprint of one stage's cook, memoized. Six files feed
 * two comparison loops, so without this the suite cooks the same graph up
 * to three times.
 */
const fingerprints = new Map<string, Promise<Record<string, unknown>>>();

function fingerprintOf(file: string): Promise<Record<string, unknown>> {
  let pending = fingerprints.get(file);
  if (pending === undefined) {
    pending = cookCorpusGraph(graphOf(file)).then((r) => corpusFingerprint(r.outputs));
    fingerprints.set(file, pending);
  }
  return pending;
}

// ---------------------------------------------------------------------------

describe("staged pipeline", () => {
  it("finds every stage", () => {
    // Guards every assertion below: an empty set would make the whole
    // suite green while testing nothing.
    const missing = [...CHAIN, ...EDITED].flat().filter((f) => !stages.has(f));
    expect([...new Set(missing)]).toEqual([]);
    expect(stages.size).toBe(6);
  });

  it("compares connections by ORDER, not just by endpoints", () => {
    // A guard on the instrument rather than on the corpus. The superset
    // check below is only as strong as what `connectionKeys` can
    // distinguish, and for most of this suite's life it could not
    // distinguish anything about order: two connections into one pin,
    // swapped, produced the identical key set. That is a mutation the whole
    // file was written to catch and did not. Stated here directly, the day
    // someone simplifies the ordinal away is the day this reddens — no cook
    // required, and no corpus file has to be carrying a shared pin for the
    // rule to hold.
    const edge = (from: string, to: string): Json => ({ from: [from, "out"], to: [to, "in"] });
    const forward = connectionKeys({ connections: [edge("a", "m"), edge("b", "m")] });
    const swapped = connectionKeys({ connections: [edge("b", "m"), edge("a", "m")] });
    expect(forward.size).toBe(2);
    expect([...forward].sort()).not.toEqual([...swapped].sort());
    // ...and the two must not be interchangeable in either direction, which
    // is what makes a swap read as a DROPPED connection in the check below.
    expect([...forward].filter((k) => !swapped.has(k))).toHaveLength(2);

    // The corpus really does exercise this: the guard would be vacuous if
    // no shipped stage fed a pin from two places.
    const shared = new Map<string, number>();
    for (const c of graphOf("pipeline-4-detail-edits.json").connections as Json[]) {
      const to = c.to as [string, string];
      shared.set(`${to[0]}.${to[1]}`, (shared.get(`${to[0]}.${to[1]}`) ?? 0) + 1);
    }
    expect([...shared.values()].filter((n) => n > 1).length).toBeGreaterThan(0);
  });

  it("every stage shares one graph seed", () => {
    // Not implied by the per-pair checks alone: they compare neighbours,
    // and this states the invariant for the set.
    const seeds = new Map<string, unknown>();
    for (const file of stages.keys()) seeds.set(file, graphOf(file).seed);
    const distinct = new Set(seeds.values());
    if (distinct.size !== 1) {
      throw new Error(
        [
          "the staged pipeline no longer shares one seed, so the later stages can no",
          "longer reproduce the earlier ones:",
          ...[...seeds].map(([f, s]) => `  ${f}: seed ${String(s)}`),
        ].join("\n"),
      );
    }
  });

  for (const [base, ext] of [...CHAIN, ...EDITED]) {
    describe(`${ext} extends ${base}`, () => {
      it("keeps every node, with the same type and the same params", () => {
        const before = nodesById(graphOf(base));
        const after = nodesById(graphOf(ext));
        const problems: string[] = [];
        for (const [id, node] of before) {
          const later = after.get(id);
          if (later === undefined) {
            problems.push(`  node "${id}" (${String(node.type)}) is gone`);
            continue;
          }
          if (later.type !== node.type) {
            problems.push(`  node "${id}": type "${String(later.type)}" (was "${String(node.type)}")`);
          }
          if (canonical(later.params) !== canonical(node.params)) {
            problems.push(
              `  node "${id}" params retuned:\n    was ${canonical(node.params)}\n    now ${canonical(
                later.params,
              )}`,
            );
          }
          if (canonical(later.ref) !== canonical(node.ref)) {
            problems.push(
              `  node "${id}" ref changed: was ${canonical(node.ref)}, now ${canonical(later.ref)}`,
            );
          }
        }
        if (problems.length > 0) {
          throw new Error(
            [
              `${CORPUS_DIR}/${ext} is no longer a superset of ${base}:`,
              ...problems,
              "",
              "A stage may only ADD nodes. Retuning or dropping a shared one breaks the",
              "guarantee the whole set rests on — that every earlier stage reproduces",
              "bit-identically inside every later one — while every file still cooks.",
            ].join("\n"),
          );
        }
        // A stage that adds nothing is not a stage.
        expect(after.size).toBeGreaterThan(before.size);
      });

      it("keeps every connection", () => {
        const before = connectionKeys(graphOf(base));
        const after = connectionKeys(graphOf(ext));
        const dropped = [...before].filter((c) => !after.has(c));
        if (dropped.length > 0) {
          throw new Error(
            [
              `${CORPUS_DIR}/${ext} drops ${dropped.length} connection(s) of ${base}:`,
              ...dropped.map((c) => `  ${c}`),
              "",
              "Rewiring an existing edge is not extending — it changes what the earlier",
              "stage cooks. Feed the new branch from a slot the base already reserved",
              "instead (see the `edits` node in pipeline-3-lots.json).",
            ].join("\n"),
          );
        }
      });

      it("keeps every declared output", () => {
        const before = outputsByName(graphOf(base));
        const after = outputsByName(graphOf(ext));
        for (const [name, source] of before) {
          expect(after.get(name), `output "${name}" of ${base}`).toBe(source);
        }
      });
    });
  }

  for (const [base, ext] of CHAIN) {
    it(`${ext} reproduces every output ${base} declares`, async () => {
      // TWO granularities, and the coarse one alone would not be the claim
      // the docstring makes. The golden is count-level: re-derived from a
      // real cook of both files, so an output that moved shows up as a
      // count, an attribute or a bounds difference — but two cooks can
      // agree on all of those and still differ in every float. The
      // fingerprint is the actual claim, the same float-exact hash the
      // determinism test uses, run across two DIFFERENT graphs: a stage
      // reproduces its predecessor BIT-identically, not merely to the
      // nearest rounded bound.
      const a = golden.examples[base];
      const b = golden.examples[ext];
      expect(a, `${base} has no golden entry`).toBeDefined();
      expect(b, `${ext} has no golden entry`).toBeDefined();
      for (const name of Object.keys(a?.outputs ?? {})) {
        expect(b?.outputs[name], `output "${name}" of ${ext} vs ${base}`).toEqual(a?.outputs[name]);
      }

      const before = await fingerprintOf(base);
      const after = await fingerprintOf(ext);
      for (const name of Object.keys(a?.outputs ?? {})) {
        expect(after[name], `output "${name}" is missing from ${ext}`).toBeDefined();
        if (JSON.stringify(after[name]) !== JSON.stringify(before[name])) {
          throw new Error(
            [
              `${CORPUS_DIR}/${ext}: output "${name}" is not bit-identical to ${base}.`,
              "",
              "A later stage only ADDS to an earlier one, and a node's seed is derived",
              "from the graph seed and its own id — never from its position in the DAG —",
              "so nothing added downstream can perturb this. A difference means a shared",
              "node was retuned, the graph seed moved, or an edge into a MULTI-INPUT pin",
              "changed order: order decides which branch a merge sees first, and",
              "selfPrune is index-greedy, so it decides which points survive.",
            ].join("\n"),
          );
        }
      }
    });
  }

  for (const [base, ext] of EDITED) {
    it(`${ext} changes only what the edit can reach`, async () => {
      const before = await fingerprintOf(base);
      const after = await fingerprintOf(ext);
      for (const name of UPSTREAM_OF_EDITS) {
        expect(after[name], `output "${name}" is upstream of the edit slot`).toBeDefined();
        if (JSON.stringify(after[name]) !== JSON.stringify(before[name])) {
          throw new Error(
            [
              `${CORPUS_DIR}/${ext}: output "${name}" is not bit-identical to ${base}.`,
              "",
              "The authored edit layer enters at the `edits` slot, downstream of the",
              `terrain, the wall and the district pass — so "${name}" cannot depend on it.`,
              "A difference here means an edit node was wired upstream of where the",
              "edit belongs, or a shared node was retuned. Locality is the whole",
              "point of the base+edits pair; without it the pair demonstrates nothing.",
            ].join("\n"),
          );
        }
      }
      // ...and it must actually reach something, or the variant is a copy.
      expect(JSON.stringify(after.lots)).not.toBe(JSON.stringify(before.lots));
    });
  }

  for (const file of [...stages.keys()].sort()) {
    it(`${file} stays inside the instance budget`, () => {
      const entry = golden.examples[file];
      expect(entry, `${file} has no golden entry`).toBeDefined();
      let total = 0;
      for (const items of Object.values(entry?.outputs ?? {})) {
        for (const item of items) total += item.instances ?? 0;
      }
      if (total > INSTANCE_BUDGET) {
        throw new Error(
          `${CORPUS_DIR}/${file} spawns ${total} instances, over the ${INSTANCE_BUDGET} budget ` +
            "the staged set is authored to. The corpus cooks on every test run, so a stage " +
            "that outgrows its budget is shrunk — the budget is not raised.",
        );
      }
    });
  }
});
