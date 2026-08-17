/**
 * `pcg assets`: the rendering, checked against hand-built descriptions.
 *
 * The report's whole job is that a reader cannot mistake a LOWER BOUND for
 * the whole set, and the shapes that test that — an open set, two open
 * sets, a spawner with no ids, a graph with no spawner — are exactly the
 * ones no corpus graph is guaranteed to contain. So the formatting is
 * driven directly, and the end-to-end suite below runs the real walk when
 * it is available.
 */
import { describe, expect, it } from "vitest";
import { type DescribedSpawner, describeGraphAssets, deserializeGraph } from "../index.js";
import { assetsReport } from "./commands.js";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, runCli } from "./index.js";
import type { CliIo } from "./io.js";

const PATH = "/graphs/spawn.json";

/** Two closed spawners: one plain, one reading an authored string table. */
const CLOSED: readonly DescribedSpawner[] = [
  {
    node: "trees",
    assetId: "tree_pine",
    assetAttr: "asset",
    ids: [
      { id: "tree_pine", from: "attribute", writtenBy: "treeSpecies" },
      { id: "tree_birch", from: "attribute", writtenBy: "treeSpecies" },
      { id: "tree_willow", from: "attribute", writtenBy: "treeSpecies" },
    ],
    open: [],
  },
  {
    node: "driftwood",
    assetId: "driftwood_log",
    ids: [{ id: "driftwood_log", from: "assetId" }],
    open: [],
  },
];

const OPEN_REASON =
  'spawner "props" reads assetAttr "kind", written by "copyToPoints" — a copy carries values from a template this walk cannot read, so the ids below are a lower bound';

const OPEN: DescribedSpawner = {
  node: "scatter > props",
  assetId: "crate",
  assetAttr: "kind",
  ids: [{ id: "crate", from: "assetId" }],
  open: [{ node: "scatter > copies", type: "copyToPoints", reason: OPEN_REASON }],
};

function fakeIo(files: Record<string, string> = {}): {
  io: CliIo;
  stdout(): string;
  stderr(): string;
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    stdout: () => out.join(""),
    stderr: () => err.join(""),
    io: {
      out: (text) => void out.push(text),
      err: (text) => void err.push(text),
      readFile: (path) => {
        const content = files[path];
        if (content === undefined) throw new Error(`ENOENT: no such file, open '${path}'`);
        return content;
      },
      writeFile: () => undefined,
    },
  };
}

/** A one-spawner graph whose ids are all authored in the file itself. */
const SPAWN_GRAPH = JSON.stringify({
  formatVersion: 1,
  seed: 4,
  nodes: [
    {
      id: "scatter",
      type: "pointScatterInBounds",
      params: { count: 8, boundsMin: [0, 0, 0], boundsMax: [4, 0, 4] },
    },
    {
      id: "species",
      type: "setAttribute",
      params: {
        name: "species",
        domain: "point",
        type: "string",
        values: ["pine", "birch"],
        value: { fn: "index" },
      },
    },
    { id: "spawn", type: "spawnInstances", params: { assetId: "pine", assetAttr: "species" } },
  ],
  connections: [
    { from: ["scatter", "out"], to: ["species", "in"] },
    { from: ["species", "out"], to: ["spawn", "in"] },
  ],
  outputs: [{ id: "spawn", pin: "instances", name: "instances" }],
});

/** A graph that ends in points: no spawner, so no asset id anywhere. */
const NO_SPAWNER_GRAPH = JSON.stringify({
  formatVersion: 1,
  seed: 1,
  nodes: [
    {
      id: "scatter",
      type: "pointScatterInBounds",
      params: { count: 4, boundsMin: [0, 0, 0], boundsMax: [1, 0, 1] },
    },
  ],
  connections: [],
  outputs: [{ id: "scatter", pin: "out", name: "points" }],
});

describe("pcg assets — the report", () => {
  it("prints one row per spawner, with its params and the ids it can emit", () => {
    const { text } = assetsReport(PATH, CLOSED);
    expect(text).toContain(`assets  ${PATH}`);
    expect(text).toContain("2 spawners, 4 distinct ids, every set complete");
    const rows = text.split("\n");
    const header = rows.find((l) => l.includes("assetAttr"));
    expect(header).toBeDefined();
    expect(header).toContain("node");
    expect(header).toContain("assetId");
    expect(header).toContain("can emit");
    const trees = rows.find((l) => l.includes("trees"));
    expect(trees).toContain("tree_pine, tree_birch, tree_willow");
    expect(trees).toContain("asset");
    // A spawner with no assetAttr says so rather than leaving a blank a
    // reader has to interpret.
    expect(rows.find((l) => l.startsWith("    driftwood"))).toContain("—");
    // Deduplicated, first-occurrence order, across the whole graph.
    expect(text).toContain("distinct ids: tree_pine, tree_birch, tree_willow, driftwood_log");
  });

  it("keeps a node path and a repeated id straight in the flat list", () => {
    const { text, json } = assetsReport(PATH, [
      ...CLOSED,
      {
        node: "wrapper > inner",
        assetId: "driftwood_log",
        ids: [{ id: "driftwood_log", from: "assetId" }],
        open: [],
      },
    ]);
    expect(text).toContain("wrapper > inner");
    expect(text).toContain("3 spawners, 4 distinct ids");
    expect((json as { ids: string[] }).ids).toEqual([
      "tree_pine",
      "tree_birch",
      "tree_willow",
      "driftwood_log",
    ]);
  });

  it("marks an open set in the headline, on its row, and in a block of its own", () => {
    const { text } = assetsReport(PATH, [...CLOSED, OPEN]);
    // 1. the headline, before anything else is read
    expect(text).toContain("1 OPEN SET");
    expect(text).toContain("LOWER BOUND");
    // 2. the row itself: a marker and an id list that visibly does not end
    const row = text.split("\n").find((l) => l.includes("scatter > props"));
    expect(row?.startsWith("  ! ")).toBe(true);
    expect(row).toContain("crate, … OPEN, see below");
    // 3. the block, with the reason verbatim — one reason is the sentence
    // itself, indented under the node and carrying no list marker
    expect(text).toContain("OPEN SETS — 1 of 3 spawners can emit ids this walk cannot name.");
    expect(text.split("\n")).toContain(`      ${OPEN_REASON}`);
    expect(text).toContain('Read every row marked "!" as "at least these ids"');
    // and the flat list, which is a lower bound for the same reason
    expect(text).toContain(
      "distinct ids so far (a lower bound): tree_pine, tree_birch, tree_willow, driftwood_log, crate",
    );
    // a closed row carries no marker
    expect(text.split("\n").find((l) => l.includes("driftwood"))?.startsWith("  ! ")).toBe(false);
  });

  it("pluralizes two open sets and prints both reasons", () => {
    const second: DescribedSpawner = {
      node: "rocks",
      assetId: "boulder",
      assetAttr: "rockKind",
      ids: [],
      open: [
        {
          node: "up",
          type: "promoteAttribute",
          reason: 'spawner "rocks" reads assetAttr "rockKind", promoted from the primitive domain',
        },
      ],
    };
    const { text } = assetsReport(PATH, [OPEN, second]);
    expect(text).toContain("2 OPEN SETS");
    expect(text).not.toContain("OPEN SETs");
    expect(text).toContain("OPEN SETS — 2 of 2 spawners");
    expect(text).toContain(OPEN_REASON);
    expect(text).toContain("promoted from the primitive domain");
    // No ids at all and still open: the row must not read as an empty set.
    expect(text.split("\n").find((l) => l.includes("rocks"))).toContain("… OPEN, see below");
  });

  /**
   * One spawner, two offending nodes. The joined-sentence shape this
   * replaced could only ever print one paragraph, so a reader had to take
   * it apart to see there were two things to fix.
   */
  it("bullets a spawner that is open twice over, one reason per node", () => {
    const FIRST = '"copies" (copyToPoints) builds its points from a source template';
    const SECOND = '"split" (partitionByAttribute) routes its groups by tag';
    const twice: DescribedSpawner = {
      node: "props",
      assetId: "crate",
      assetAttr: "kind",
      ids: [{ id: "crate", from: "assetId" }],
      open: [
        { node: "copies", type: "copyToPoints", reason: FIRST },
        { node: "split", type: "partitionByAttribute", reason: SECOND },
      ],
    };
    const { text, json } = assetsReport(PATH, [twice]);
    const lines = text.split("\n");
    const at = lines.indexOf("  ! props");
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1]).toBe(`      - ${FIRST}`);
    expect(lines[at + 2]).toBe(`      - ${SECOND}`);
    // One OPEN SET, not two: the headline counts sets, not reasons.
    expect(text).toContain("1 OPEN SET — the ids below are a LOWER BOUND");
    expect(text).toContain("OPEN SETS — 1 of 1 spawner can emit ids");
    // and --json hands over the structure, not the prose
    expect((json as { spawners: DescribedSpawner[] }).spawners[0].open).toEqual(twice.open);
  });

  it("says so plainly when the graph has no spawner at all", () => {
    const { text, json } = assetsReport(PATH, []);
    expect(text).toContain("no spawnInstances node in this graph, so it emits no asset ids at all");
    expect(text).toContain("`pcg validate` lists what it does declare.");
    // Not an empty table, and not a bare heading with nothing under it.
    expect(text).not.toContain("spawners:");
    expect(text).not.toContain("distinct ids:");
    expect(json).toMatchObject({ spawnerCount: 0, distinctIds: 0, openSpawners: 0, complete: true });
  });

  it("--json carries the descriptions unchanged plus the distinct-id summary", () => {
    const { json } = assetsReport(PATH, [...CLOSED, OPEN]);
    expect(json).toEqual({
      path: PATH,
      spawnerCount: 3,
      distinctIds: 5,
      openSpawners: 1,
      complete: false,
      ids: ["tree_pine", "tree_birch", "tree_willow", "driftwood_log", "crate"],
      spawners: [...CLOSED, OPEN],
    });
    // The origins survive the round trip: the text report drops them, and
    // this is where an agent reads which node authored an id.
    const spawners = (json as { spawners: DescribedSpawner[] }).spawners;
    expect(spawners[0].ids[1]).toEqual({
      id: "tree_birch",
      from: "attribute",
      writtenBy: "treeSpecies",
    });
    // The open set is structure, not prose: the node, its type, and the
    // sentence, so an agent can act on it without parsing English.
    expect(spawners[2].open).toEqual([
      { node: "scatter > copies", type: "copyToPoints", reason: OPEN_REASON },
    ]);
  });

  it("renders the same bytes for the same descriptions", () => {
    expect(assetsReport(PATH, [...CLOSED, OPEN]).text).toBe(
      assetsReport(PATH, [...CLOSED, OPEN]).text,
    );
  });
});

describe("pcg assets — the command line", () => {
  it("is listed in the top-level help", async () => {
    const io = fakeIo();
    expect(await runCli(["--help"], io.io)).toBe(EXIT_OK);
    expect(io.stdout()).toContain("pcg assets <graph.json> [flags]");
    expect(io.stdout()).toContain("List every asset id a graph can spawn, statically");
  });

  it("prints its own usage, and refuses a line with no graph", async () => {
    const help = fakeIo();
    expect(await runCli(["assets", "--help"], help.io)).toBe(EXIT_OK);
    expect(help.stdout()).toContain("pcg assets <graph.json> [flags]");
    expect(help.stdout()).toContain("--json");

    const missing = fakeIo();
    expect(await runCli(["assets"], missing.io)).toBe(EXIT_USAGE);
    expect(missing.stderr()).toContain("missing required argument <graph.json>");
  });

  it("reports an unreadable graph file as a failure, not a misuse", async () => {
    const io = fakeIo();
    expect(await runCli(["assets", "/nope.json"], io.io)).toBe(EXIT_FAILURE);
    expect(io.stderr()).toContain('cannot read graph file "/nope.json"');
  });
});

/**
 * The walk is landing separately; until its body exists the suite below
 * reports SKIPPED rather than failing on someone else's half of the work.
 */
const walkLanded = ((): boolean => {
  try {
    describeGraphAssets(deserializeGraph(JSON.parse(NO_SPAWNER_GRAPH)));
    return true;
  } catch (err) {
    return !(err instanceof Error && err.message.includes("not implemented"));
  }
})();

describe.skipIf(!walkLanded)(
  walkLanded
    ? "pcg assets — against real graphs"
    : "pcg assets — against real graphs (SKIPPED: describeGraphAssets has no body yet)",
  () => {
    it("reports the ids an authored string table can emit", async () => {
      const io = fakeIo({ "/g.json": SPAWN_GRAPH });
      expect(await runCli(["assets", "/g.json"], io.io)).toBe(EXIT_OK);
      const text = io.stdout();
      expect(text).toContain("assets  /g.json");
      expect(text).toContain("spawn");
      expect(text).toContain("pine");
      expect(text).toContain("birch");
    });

    it("reports a graph with no spawner", async () => {
      const io = fakeIo({ "/g.json": NO_SPAWNER_GRAPH });
      expect(await runCli(["assets", "/g.json"], io.io)).toBe(EXIT_OK);
      expect(io.stdout()).toContain("no spawnInstances node in this graph");
    });

    it("--json is the machine-readable half of the same run", async () => {
      const io = fakeIo({ "/g.json": SPAWN_GRAPH });
      expect(await runCli(["assets", "/g.json", "--json"], io.io)).toBe(EXIT_OK);
      const json = JSON.parse(io.stdout()) as {
        path: string;
        spawnerCount: number;
        ids: string[];
        spawners: DescribedSpawner[];
      };
      expect(json.path).toBe("/g.json");
      expect(json.spawnerCount).toBe(1);
      expect(json.spawners[0].node).toBe("spawn");
      expect(json.spawners[0].assetAttr).toBe("species");
      expect(json.ids).toContain("birch");
    });
  },
);
