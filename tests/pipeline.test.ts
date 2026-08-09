/**
 * The staged pipeline (`examples/graphs/pipeline-*.json`), and the one
 * property that makes it a pipeline rather than eight unrelated graphs.
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
 * is not pedantry: a merge consumes its connections in file order, and
 * that order IS the point indexing every node downstream of it sees — the
 * prune behind it settles a priority tie on the LOWER index, and the
 * survivors come out in input order. Swapping two edges into one pin
 * removes nothing, renames nothing and retunes nothing — and changes the
 * cook. See `connectionKeys`.
 *
 * The `-edits` variants are the payoff. An edited stage is its base plus
 * authored geometry and ONE connection into a slot the base reserved, so
 * it is a superset too — and `terrain`, `boundary` and `districts` stay
 * bit-identical while `lots` changes. That is the claim "an edit is local"
 * as an assertion rather than a hope.
 *
 * What makes the authored points win is a PARAMETER, not a position: they
 * carry `locked = 1`, the base stamps `locked = 0` on the procedural side,
 * and the `lots` prune ranks by `priority: attribute("locked")`. The edit
 * is merged onto pin `b` — LAST, at the highest indices — precisely so
 * that nothing about the outcome can be read as an artifact of where it
 * was wired.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DataCollection } from "../src/index.js";
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
  ["pipeline-4-detail.json", "pipeline-5-roads.json"],
  ["pipeline-3-lots-edits.json", "pipeline-4-detail-edits.json"],
  ["pipeline-4-detail-edits.json", "pipeline-5-roads-edits.json"],
];

/** The (base, edited) pairs: same stage, one with an authored edit layer. */
const EDITED: readonly (readonly [string, string])[] = [
  ["pipeline-3-lots.json", "pipeline-3-lots-edits.json"],
  ["pipeline-4-detail.json", "pipeline-4-detail-edits.json"],
  ["pipeline-5-roads.json", "pipeline-5-roads-edits.json"],
];

/** Outputs an edit must NOT reach: everything upstream of where it enters. */
const UPSTREAM_OF_EDITS = ["terrain", "boundary", "districts"];

/**
 * Outputs a PARTICULAR stage adds to that list, keyed by the base file.
 *
 * Not folded into `UPSTREAM_OF_EDITS`, because the check below asserts each
 * name is present: an output stage 5 introduces cannot be demanded of the
 * stage-3 and stage-4 pairs, and softening the check to "compare it if it
 * happens to be there" would make a DROPPED output pass silently. So the
 * extra names are attached to the stage that has them.
 *
 * Stage 5's road net is built from the district centres — `centreKind`,
 * upstream of the `edits` slot — so `roads` and the `lamps` spawned along it
 * are as untouchable by an edit as the terrain is.
 */
const UPSTREAM_BY_STAGE: Readonly<Record<string, readonly string[]>> = {
  "pipeline-5-roads.json": ["roads", "lamps"],
};

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
 * in file order, and that order is the point indexing every node downstream
 * sees: `mergePoints` concatenates in the order it receives, `selfPrune`
 * settles a tie between equal priorities on the lower index, and its
 * survivors leave in input order. (WHO survives no longer rides on it —
 * that is `priority` now — but the indices still decide the ties and the
 * ordering, which is enough to move every float downstream.) Key an edge
 * by its endpoints alone and swapping two connections into one pin is
 * invisible: measured, swapping
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
 * One stage's cook, memoized. Eight files feed three comparison loops, so
 * without this the suite cooks the same graph up to four times.
 */
const cooks = new Map<string, Promise<Awaited<ReturnType<typeof cookCorpusGraph>>>>();

function cookOf(file: string): Promise<Awaited<ReturnType<typeof cookCorpusGraph>>> {
  let pending = cooks.get(file);
  if (pending === undefined) {
    pending = cookCorpusGraph(graphOf(file));
    cooks.set(file, pending);
  }
  return pending;
}

/** Float-exact fingerprint of one stage's cook. */
function fingerprintOf(file: string): Promise<Record<string, unknown>> {
  return cookOf(file).then((r) => corpusFingerprint(r.outputs));
}

/**
 * How many points of an output carry `locked = 1` — the flag the authored
 * edit layer stamps and the `lots` prune reads as `priority`.
 */
function lockedCount(outputs: Record<string, DataCollection>, name: string): number {
  const items = outputs[name] ?? [];
  let n = 0;
  for (const item of items) {
    if (item.kind !== "geometry") continue;
    const set = item.geo.attrs.point;
    const locked = [...set].find((a) => a.name === "locked");
    if (locked === undefined) {
      throw new Error(
        `output "${name}" carries no "locked" attribute. The base stamps it on the ` +
          "procedural branch (node `lotLock`) so that `attribute(\"locked\")` resolves " +
          "even in the unedited stages — without it the prune's `priority` field has " +
          "nothing to read.",
      );
    }
    for (let i = 0; i < set.count; i++) if (locked.getTuple(i)[0] === 1) n++;
  }
  return n;
}

/** Points the authored edit layer introduces, read off the edit nodes' own params. */
function authoredPointCount(file: string): number {
  const nodes = nodesById(graphOf(file));
  const row = nodes.get("editRow")?.params as { count: number } | undefined;
  const block = nodes.get("editBlock")?.params as
    | { countX: number; countY: number; countZ: number }
    | undefined;
  if (row === undefined || block === undefined) {
    throw new Error(`${CORPUS_DIR}/${file} has no editRow/editBlock: it is not an edited stage.`);
  }
  return row.count + block.countX * block.countY * block.countZ;
}

// ---------------------------------------------------------------------------

describe("staged pipeline", () => {
  it("finds every stage", () => {
    // Guards every assertion below: an empty set would make the whole
    // suite green while testing nothing.
    const missing = [...CHAIN, ...EDITED].flat().filter((f) => !stages.has(f));
    expect([...new Set(missing)]).toEqual([]);
    expect(stages.size).toBe(8);
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
              "changed order: order decides which branch a merge sees first, which is the",
              "point indexing selfPrune breaks its priority ties on and emits its",
              "survivors in.",
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
      for (const name of [...UPSTREAM_OF_EDITS, ...(UPSTREAM_BY_STAGE[base] ?? [])]) {
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

    it(`${ext} lands the authored layer WHOLE`, async () => {
      // The claim the variant exists to make: every hand-placed plot comes
      // out the far side of the prune. Counted from the edit nodes' own
      // params rather than from a literal, so retuning the terrace or the
      // block moves the expectation with it and a plot lost to the prune
      // still reddens.
      const { outputs } = await cookOf(ext);
      expect(lockedCount(outputs, "lots")).toBe(authoredPointCount(ext));
    });

    it(`${base} reserves the rank the edit uses`, async () => {
      // The other half, and the reason the base is not merely unaffected:
      // `attribute("locked")` has to resolve in the UNEDITED stage too, so
      // the base stamps the flag on the procedural branch. Nothing carries
      // 1 there — every point ties at 0 and the prune is the plain
      // index-greedy one, which is exactly what priority's default means.
      const { outputs } = await cookOf(base);
      expect(lockedCount(outputs, "lots")).toBe(0);
    });
  }

  it("the authored plots win on PRIORITY, not on where they were merged", async () => {
    // The regression this whole rewiring exists to prevent. Before it, the
    // edit was merged onto pin `a` and won because the prune was
    // index-greedy — except it did not: the pre-merge clearance was wider
    // than the prune radius, so no authored/procedural pair ever actually
    // contested a spot and the documented mechanism never fired. A corpus
    // that teaches an inert parameter is worse than one that teaches a
    // trick, so the parameter is checked here by REMOVING it: strip
    // `priority` from the prune and authored plots must start losing.
    const file = "pipeline-3-lots-edits.json";
    const withPriority = lockedCount((await cookOf(file)).outputs, "lots");
    expect(withPriority).toBe(authoredPointCount(file));

    const stripped = JSON.parse(JSON.stringify(graphOf(file))) as Json;
    const lots = nodesById(stripped).get("lots");
    const params = lots?.params as Record<string, unknown> | undefined;
    expect(params, 'node "lots" has no params').toBeDefined();
    expect(params?.priority, 'node "lots" no longer ranks by `priority`').toBeDefined();
    delete params?.priority;

    const without = lockedCount((await cookCorpusGraph(stripped)).outputs, "lots");
    if (without >= withPriority) {
      throw new Error(
        [
          `${CORPUS_DIR}/${file}: removing \`priority\` from the \`lots\` prune changed nothing —`,
          `${without} of the ${withPriority} authored plots still survive without it.`,
          "",
          "That means the graph wins its contested spots some other way (most likely the",
          "`clear` exclusion radius grew back past the prune's minDistance), and the",
          "description's claim that survival is a value the points carry is no longer",
          "true of this file. Fix the graph, not this test.",
        ].join("\n"),
      );
    }
  });

  it("stage 5's roads are a NETWORK, not another tour", async () => {
    // What stage 5 exists to demonstrate, stated as a property rather than
    // left to the golden. The golden pins `roads` at 9 points and 10
    // primitives, and those two numbers survive a graph that came out as a
    // single closed chain — which is exactly what stage 3's `spine` already
    // is, and which would make the stage teach nothing new. The claim is
    // about DEGREE: `connectPoints` builds its polylines over the SAME
    // points, so a centre where three roads meet is one point of degree 3,
    // and `pointsToPath` — one group per point, hence two neighbours each —
    // cannot produce that at all.
    const { outputs } = await cookOf("pipeline-5-roads.json");
    const items = outputs.roads ?? [];
    expect(items).toHaveLength(1);
    const item = items[0];
    if (item?.kind !== "geometry") throw new Error('output "roads" is not geometry');
    const geo = item.geo;
    const points = geo.attrs.point.count;
    const segments = geo.attrs.primitive.count;

    // Every primitive is one EDGE: two vertices, two distinct endpoints.
    const degree = new Uint32Array(points);
    const parent = new Uint32Array(points).map((_, i) => i);
    const find = (x: number): number => {
      let root = x;
      while (parent[root] !== root) root = parent[root] as number;
      return root;
    };
    for (let p = 0; p < segments; p++) {
      expect(geo.primVertexCount[p], `primitive ${p} is not a 2-vertex edge`).toBe(2);
      const start = geo.primVertexStart[p] as number;
      const a = geo.vertexToPoint[start] as number;
      const b = geo.vertexToPoint[start + 1] as number;
      expect(a, `primitive ${p} is a self-loop`).not.toBe(b);
      degree[a]++;
      degree[b]++;
      parent[find(a)] = find(b);
    }

    const components = new Set([...degree.keys()].map(find)).size;
    const junctions = [...degree].filter((d) => d >= 3).length;
    const shape =
      `${points} centres, ${segments} segments, ${components} component(s), ` +
      `degrees [${[...degree].join(", ")}]`;

    // It branches: at least one point carries three roads. A cloud where
    // every degree is 1 or 2 is a chain or a ring however it was built.
    expect(junctions, `the road net does not branch — ${shape}`).toBeGreaterThan(0);
    // It is CONNECTED, which is what the relative-neighbourhood graph buys
    // by containing a minimum spanning tree of everything the radius reached.
    expect(components, `the road net is disconnected — ${shape}`).toBe(1);
    // ...and it keeps CYCLES, the other half of the same choice: a tree of
    // n points has exactly n - 1 edges, so more than that means a loop.
    expect(segments, `the road net is a tree, not a network — ${shape}`).toBeGreaterThan(points - 1);
    // Degree is reported on the points, not inferred here.
    const degreeAttr = [...geo.attrs.point].find((a) => a.name === "degree");
    expect(degreeAttr, '`roadNet` no longer writes its `degree` attribute').toBeDefined();
    for (let i = 0; i < points; i++) {
      expect(degreeAttr?.getTuple(i)[0], `degree of point ${i} — ${shape}`).toBe(degree[i]);
    }
  });

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
