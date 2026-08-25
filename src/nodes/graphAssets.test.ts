/**
 * What a graph PROMISES a renderer, read off the graph instead of a cook.
 *
 * Two halves, and the second is the one that catches what the first cannot.
 * The unit tests pin each rule on a graph small enough to read; the corpus
 * test runs the walk over every file in `graphs/` and asserts the aggregate,
 * which is the only way to notice that a rule is right in isolation and
 * wrong on the material people actually write.
 *
 * The pair that must never both pass by accident: "an authored table is
 * complete" (red if `open` were pinned non-empty) and each of the open-set
 * cases (red if it were pinned `[]`). A report whose openness is a constant
 * is worse than no report, because it still reads as an answer.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fieldFromJson } from "../fields/fieldJson.js";
import { Graph, type NodeHandle, subgraphNode } from "../graph/index.js";
import { spawnInstances } from "../spawn/index.js";
import { describeGraphAssets } from "./graphAssets.js";
import {
  attributeRemap,
  copyToPoints,
  partitionByAttribute,
  pointGrid,
  promoteAttribute,
  setAttribute,
  transferAttribute,
} from "./index.js";
import { deserializeGraph } from "./serialize.js";
import { resolveExposedParam } from "./subgraphParams.js";
// The corpus enumerator the corpus CI uses, so a graph added to `graphs/` is
// covered here with no list to update; and the primitives, imported for the
// side effect that lets `deserializeGraph` resolve a `ref` by name.
import { loadGraphs } from "../docs/graphIndex.js";
import "../primitives/index.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

interface Table {
  readonly graph: Graph;
  readonly grid: NodeHandle;
  readonly species: NodeHandle;
  readonly spawn: NodeHandle;
}

/** A grid feeding one string `setAttribute`, feeding one spawner. */
function tableGraph(
  values: readonly string[],
  spawn: { assetId?: string; assetAttr?: string },
  attrName = "species",
): Table {
  const graph = new Graph(7);
  const grid = graph.add(pointGrid, { countX: 2, countZ: 2 }, "grid");
  const species = graph.add(
    setAttribute,
    { name: attrName, domain: "point", type: "string", values: [...values] },
    "species",
  );
  const out = graph.add(spawnInstances, spawn, "spawn");
  graph.connect(grid, "out", species, "in");
  graph.connect(species, "out", out, "in");
  return { graph, grid, species, spawn: out };
}

/** Re-route `species -> spawn` through `mid`, which must have `in`/`out`. */
function splice(table: Table, mid: NodeHandle): DescribedSpawnerLike {
  const { graph, species, spawn } = table;
  graph.disconnect(species, "out", spawn, "in");
  graph.connect(species, "out", mid, "in");
  graph.connect(mid, "out", spawn, "in");
  return describeGraphAssets(graph)[0];
}

type DescribedSpawnerLike = ReturnType<typeof describeGraphAssets>[number];

/** The one reason an open set carries, asserted to be the only one. */
function soleReason(found: DescribedSpawnerLike): string {
  expect(found.open).toHaveLength(1);
  return found.open[0].reason;
}

describe("describeGraphAssets: constant mode", () => {
  it("reports the node's own assetId, and carries no assetAttr key at all", () => {
    const graph = new Graph(1);
    const grid = graph.add(pointGrid, {}, "grid");
    const spawn = graph.add(spawnInstances, { assetId: "boulder" }, "spawn");
    graph.connect(grid, "out", spawn, "in");

    const found = describeGraphAssets(graph);
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual({
      node: "spawn",
      assetId: "boulder",
      ids: [{ id: "boulder", from: "assetId" }],
      open: [],
    });
    expect("assetAttr" in found[0]).toBe(false);
  });

  it("stays closed behind a node it cannot read, because nothing per-point is read", () => {
    const graph = new Graph(1);
    const source = graph.add(pointGrid, { countX: 2 }, "source");
    const target = graph.add(pointGrid, { countZ: 2 }, "target");
    const copies = graph.add(copyToPoints, {}, "copies");
    const spawn = graph.add(spawnInstances, { assetId: "lamp" }, "spawn");
    graph.connect(source, "out", copies, "source");
    graph.connect(target, "out", copies, "target");
    graph.connect(copies, "out", spawn, "in");

    expect(describeGraphAssets(graph)[0]).toMatchObject({ open: [], assetId: "lamp" });
  });
});

describe("describeGraphAssets: an authored table", () => {
  // Red if `open` were pinned non-empty — see the module comment.
  it("reads every entry, in table order, with the node that wrote it", () => {
    const { graph } = tableGraph(["pine", "pine", "birch", "bush"], {
      assetId: "pine",
      assetAttr: "species",
    });
    const found = describeGraphAssets(graph);
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual({
      node: "spawn",
      assetId: "pine",
      assetAttr: "species",
      ids: [
        { id: "pine", from: "attribute", writtenBy: "species" },
        { id: "birch", from: "attribute", writtenBy: "species" },
        { id: "bush", from: "attribute", writtenBy: "species" },
      ],
      open: [],
    });
  });

  it("takes the constant `stringValue` when the table is empty", () => {
    const graph = new Graph(3);
    const grid = graph.add(pointGrid, {}, "grid");
    const species = graph.add(
      setAttribute,
      { name: "species", domain: "point", type: "string", stringValue: "oak" },
      "species",
    );
    const spawn = graph.add(spawnInstances, { assetId: "pine", assetAttr: "species" }, "spawn");
    graph.connect(grid, "out", species, "in");
    graph.connect(species, "out", spawn, "in");

    expect(describeGraphAssets(graph)[0]).toMatchObject({
      ids: [{ id: "oak", from: "attribute", writtenBy: "species" }],
      open: [],
    });
  });

  it("passes over a writer of the same name on another domain", () => {
    const table = tableGraph(["rod", "bar"], { assetId: "rod", assetAttr: "part" }, "part");
    const decoy = table.graph.add(
      setAttribute,
      { name: "part", domain: "primitive", type: "string", values: ["decoy"] },
      "decoy",
    );
    // Above the real writer, so the walk only reaches it if the domain check
    // fails to stop at `species` first.
    table.graph.disconnect(table.grid, "out", table.species, "in");
    table.graph.connect(table.grid, "out", decoy, "in");
    table.graph.connect(decoy, "out", table.species, "in");

    const found = describeGraphAssets(table.graph)[0];
    expect(found.ids.map((o) => o.id)).toEqual(["rod", "bar"]);
    expect(found.open).toEqual([]);
  });
});

describe("describeGraphAssets: the empty-entry rule", () => {
  // The spawner resolves an empty string-table value to its own assetId
  // (src/spawn/grouping.ts), so an empty entry is never an id of "".
  it("turns an empty entry into the node's assetId, in the entry's place", () => {
    const { graph } = tableGraph(["pine", "", "birch"], {
      assetId: "stump",
      assetAttr: "species",
    });
    const found = describeGraphAssets(graph)[0];
    expect(found.ids).toEqual([
      { id: "pine", from: "attribute", writtenBy: "species" },
      { id: "stump", from: "assetId" },
      { id: "birch", from: "attribute", writtenBy: "species" },
    ]);
    expect(found.ids.some((o) => o.id === "")).toBe(false);
    expect(found.open).toEqual([]);
  });

  it("does the same for an empty constant, which is the same fallback", () => {
    const graph = new Graph(3);
    const grid = graph.add(pointGrid, {}, "grid");
    const species = graph.add(setAttribute, { name: "species", type: "string" }, "species");
    const spawn = graph.add(spawnInstances, { assetId: "post", assetAttr: "species" }, "spawn");
    graph.connect(grid, "out", species, "in");
    graph.connect(species, "out", spawn, "in");

    expect(describeGraphAssets(graph)[0].ids).toEqual([{ id: "post", from: "assetId" }]);
  });

  it("does not report the assetId when every entry names an asset", () => {
    const { graph } = tableGraph(["rod", "bar"], { assetId: "clamp", assetAttr: "part" }, "part");
    const found = describeGraphAssets(graph)[0];
    expect(found.ids.map((o) => o.from)).toEqual(["attribute", "attribute"]);
  });
});

describe("describeGraphAssets: sets it refuses to close", () => {
  // Every case here is red if `open` were pinned `[]`.
  it("names a copyToPoints, and still reports what it found as a lower bound", () => {
    const table = tableGraph(["pine", "birch"], { assetId: "pine", assetAttr: "species" });
    const { graph, species, spawn } = table;
    const template = graph.add(pointGrid, { countX: 2 }, "template");
    const copies = graph.add(copyToPoints, { targetNames: ["species"] }, "copies");
    graph.disconnect(species, "out", spawn, "in");
    graph.connect(template, "out", copies, "source");
    graph.connect(species, "out", copies, "target");
    graph.connect(copies, "out", spawn, "in");

    const found = describeGraphAssets(graph)[0];
    expect(found.open).toHaveLength(1);
    expect(found.open[0]).toMatchObject({ node: "copies", type: "copyToPoints" });
    expect(soleReason(found)).toContain('"copies" (copyToPoints)');
    expect(soleReason(found)).toContain("species");
    // The ids it could see survive as a lower bound; the assetId joins them
    // because an unread value may be the empty string.
    expect(found.ids.map((o) => o.id)).toEqual(["pine", "birch"]);
  });

  it("names a promoteAttribute that lands on the point domain", () => {
    const table = tableGraph(["rod"], { assetId: "bar", assetAttr: "part" }, "part");
    const promote = table.graph.add(
      promoteAttribute,
      { name: "part", from: "primitive", to: "point", mode: "first" },
      "up",
    );
    const found = splice(table, promote);
    expect(found.open[0]).toMatchObject({ node: "up", type: "promoteAttribute" });
    expect(soleReason(found)).toContain('"up" (promoteAttribute)');
    expect(found.ids.map((o) => o.id)).toEqual(["rod", "bar"]);
  });

  it("leaves a promoteAttribute of another attribute alone", () => {
    const table = tableGraph(["rod"], { assetId: "bar", assetAttr: "part" }, "part");
    const promote = table.graph.add(
      promoteAttribute,
      { name: "density", from: "primitive", to: "point", mode: "first" },
      "up",
    );
    expect(splice(table, promote).open).toEqual([]);
  });

  it("names a transferAttribute carrying the same attribute", () => {
    const table = tableGraph(["rod"], { assetId: "bar", assetAttr: "part" }, "part");
    const { graph, species, spawn } = table;
    const source = graph.add(pointGrid, { countX: 2 }, "src");
    const transfer = graph.add(transferAttribute, { name: "part", mapping: "nearest" }, "tr");
    graph.disconnect(species, "out", spawn, "in");
    graph.connect(species, "out", transfer, "in");
    graph.connect(source, "out", transfer, "source");
    graph.connect(transfer, "out", spawn, "in");

    const found = describeGraphAssets(graph)[0];
    expect(found.open[0]).toMatchObject({ node: "tr", type: "transferAttribute" });
    expect(soleReason(found)).toContain('"tr" (transferAttribute)');
  });

  it("names an attributeRemap writing over the asset attribute", () => {
    const table = tableGraph(["rod"], { assetId: "bar", assetAttr: "part" }, "part");
    const remap = table.graph.add(attributeRemap, { name: "density", outName: "part" }, "fit");
    const found = splice(table, remap);
    expect(found.open[0]).toMatchObject({ node: "fit", type: "attributeRemap" });
    expect(soleReason(found)).toContain('"fit" (attributeRemap)');
  });

  it("names a partitionByAttribute, whose routing is settled at cook time", () => {
    const table = tableGraph(["rod", "bar"], { assetId: "rod", assetAttr: "part" }, "part");
    const split = table.graph.add(partitionByAttribute, { name: "part" }, "split");
    const found = splice(table, split);
    expect(found.open[0]).toMatchObject({ node: "split", type: "partitionByAttribute" });
    expect(soleReason(found)).toContain('"split" (partitionByAttribute)');
  });

  it("names a setAttribute that replaces the column with a numeric one", () => {
    const table = tableGraph(["rod"], { assetId: "bar", assetAttr: "part" }, "part");
    const clobber = table.graph.add(setAttribute, { name: "part", type: "f32", value: 1 }, "clobber");
    const found = splice(table, clobber);
    expect(found.open[0]).toMatchObject({ node: "clobber", type: "setAttribute" });
    expect(soleReason(found)).toContain('"clobber" (setAttribute)');
    expect(soleReason(found)).toContain("f32");
    // The walk stopped at the overwrite: nothing above it reaches the spawner.
    expect(found.ids).toEqual([{ id: "bar", from: "assetId" }]);
  });

  it("says so when nothing upstream writes the attribute at all", () => {
    const graph = new Graph(1);
    const grid = graph.add(pointGrid, {}, "grid");
    const spawn = graph.add(spawnInstances, { assetId: "pine", assetAttr: "species" }, "spawn");
    graph.connect(grid, "out", spawn, "in");

    const found = describeGraphAssets(graph)[0];
    // No node upstream is to blame, so the reason names the spawner itself.
    expect(found.open[0]).toMatchObject({ node: "spawn", type: "spawnInstances" });
    expect(soleReason(found)).toContain('string point attribute named "species"');
    expect(found.ids).toEqual([{ id: "pine", from: "assetId" }]);
  });

  it("cannot read a table that is not a list of strings, and names the node", () => {
    const table = tableGraph([], { assetId: "rod", assetAttr: "part" }, "part");
    // Written past `setParam`'s schema check on purpose: a slot holding
    // something else is what a hand-built wrapper or a stale saved graph
    // produces, and this walk must report it rather than throw on it.
    table.graph.require("species").params.values = fieldFromJson({ fn: "constant", value: 1 });
    const found = describeGraphAssets(table.graph)[0];
    expect(found.open[0]).toMatchObject({ node: "species", type: "setAttribute" });
    expect(soleReason(found)).toContain('"species" (setAttribute)');
  });

  /**
   * The reason `open` is a list. Two nodes stand between the table and the
   * spawner, each opening the set for its own reason and each with its own
   * fix; the joined sentence this replaced could report only one thing, so
   * a reader who fixed it would still have an open set and no second line
   * to tell them why.
   */
  it("reports one entry per offending node when two of them make it open", () => {
    const table = tableGraph(["pine", "birch"], { assetId: "stump", assetAttr: "species" });
    const { graph, species, spawn } = table;
    const split = graph.add(partitionByAttribute, { name: "species" }, "split");
    const template = graph.add(pointGrid, { countX: 2 }, "template");
    const copies = graph.add(copyToPoints, { targetNames: ["species"] }, "copies");
    graph.disconnect(species, "out", spawn, "in");
    graph.connect(species, "out", split, "in");
    graph.connect(split, "out", copies, "target");
    graph.connect(template, "out", copies, "source");
    graph.connect(copies, "out", spawn, "in");

    const found = describeGraphAssets(graph)[0];
    // Both, in the order the sweep meets them: nearest the spawner first.
    expect(found.open).toHaveLength(2);
    expect(found.open.map((o) => [o.node, o.type])).toEqual([
      ["copies", "copyToPoints"],
      ["split", "partitionByAttribute"],
    ]);
    // Two whole reasons, each naming its own node and its own fix — not one
    // sentence carrying both, which is what a joined string could express.
    expect(found.open[0].reason).toContain('"copies" (copyToPoints)');
    expect(found.open[1].reason).toContain('"split" (partitionByAttribute)');
    expect(found.open[0].reason).not.toContain("partitionByAttribute");
    expect(found.open[1].reason).not.toContain("copyToPoints");
    // And the ids it could still see, plus the default an unread value may
    // resolve to: an open set is a lower bound, not a refusal.
    expect(found.ids.map((o) => o.id)).toEqual(["pine", "birch", "stump"]);
  });
});

// ---------------------------------------------------------------------------
// Bodies.
// ---------------------------------------------------------------------------

/** `write/instances-by-species` in miniature: a table and a spawner in a body. */
function bodyDef(values: readonly string[], assetId: string) {
  const inner = new Graph(11);
  const species = inner.add(
    setAttribute,
    { name: "species", domain: "point", type: "string", values: [...values] },
    "species",
  );
  const spawn = inner.add(spawnInstances, { assetId, assetAttr: "species" }, "spawn");
  inner.connect(species, "out", spawn, "in");
  return subgraphNode(
    inner,
    [{ name: "in", node: species, pin: "in" }],
    [{ name: "instances", node: spawn, pin: "instances" }],
    [
      resolveExposedParam(inner, {
        name: "assets",
        targets: [{ node: species, param: "values" }],
        description: "Asset ids to choose among.",
      }),
      resolveExposedParam(inner, {
        name: "assetId",
        targets: [{ node: spawn, param: "assetId" }],
        description: "Asset id for a point whose entry is empty.",
      }),
    ],
  );
}

describe("describeGraphAssets: subgraph bodies", () => {
  it("reports a body's spawner under the wrapper > inner path", () => {
    const def = bodyDef(["pine", "birch"], "pine");
    const graph = new Graph(5);
    const grid = graph.add(pointGrid, {}, "grid");
    const trees = graph.add(def, {}, "trees");
    graph.connect(grid, "out", trees, "in");

    const found = describeGraphAssets(graph);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      node: "trees > spawn",
      assetId: "pine",
      assetAttr: "species",
      open: [],
    });
    expect(found[0].ids).toEqual([
      { id: "pine", from: "attribute", writtenBy: "trees > species" },
      { id: "birch", from: "attribute", writtenBy: "trees > species" },
    ]);
  });

  // Red if the wrapper's value were ignored in favour of the body literal —
  // the whole point of an exposed param, and what `write/instances-by-species`
  // uses to make one body serve buildings and trees at once.
  it("takes the wrapper's exposed value over the body's own literal", () => {
    const def = bodyDef(["pine", "birch"], "pine");
    const graph = new Graph(5);
    const grid = graph.add(pointGrid, {}, "grid");
    const buildings = graph.add(
      def,
      { assets: ["hall", "house", "barn"], assetId: "house" },
      "buildings",
    );
    graph.connect(grid, "out", buildings, "in");

    const found = describeGraphAssets(graph)[0];
    expect(found.assetId).toBe("house");
    expect(found.ids.map((o) => o.id)).toEqual(["hall", "house", "barn"]);
    expect(found.open).toEqual([]);
  });

  it("keeps two instances of one body apart, each with its own values", () => {
    const def = bodyDef(["pine", "birch"], "pine");
    const graph = new Graph(5);
    const grid = graph.add(pointGrid, {}, "grid");
    const buildings = graph.add(def, { assets: ["hall", "barn"], assetId: "house" }, "buildings");
    const trees = graph.add(def, {}, "trees");
    graph.connect(grid, "out", buildings, "in");
    graph.connect(grid, "out", trees, "in");

    const found = describeGraphAssets(graph);
    expect(found.map((s) => s.node)).toEqual(["buildings > spawn", "trees > spawn"]);
    expect(found[0].ids.map((o) => o.id)).toEqual(["hall", "barn"]);
    expect(found[1].ids.map((o) => o.id)).toEqual(["pine", "birch"]);
  });

  it("says a body's attribute may be written outside it", () => {
    const inner = new Graph(11);
    const spawn = inner.add(spawnInstances, { assetId: "rod", assetAttr: "part" }, "spawn");
    const def = subgraphNode(
      inner,
      [{ name: "in", node: spawn, pin: "in" }],
      [{ name: "instances", node: spawn, pin: "instances" }],
    );
    const graph = new Graph(5);
    const grid = graph.add(pointGrid, {}, "grid");
    const parts = graph.add(def, {}, "parts");
    graph.connect(grid, "out", parts, "in");

    const found = describeGraphAssets(graph)[0];
    expect(found.node).toBe("parts > spawn");
    // The WRAPPER is what made the set open, not the portal node the
    // subgraph injected: a reader can open "parts", and `__in_in` is
    // plumbing they never wrote.
    expect(found.open[0]).toMatchObject({ node: "parts", type: "subgraph" });
    expect(soleReason(found)).toContain('the body "parts"');
  });

  it("names a wrapper standing between a spawner and any writer", () => {
    const inner = new Graph(11);
    const pass = inner.add(setAttribute, { name: "unrelated", value: 1 }, "pass");
    const def = subgraphNode(
      inner,
      [{ name: "in", node: pass, pin: "in" }],
      [{ name: "out", node: pass, pin: "out" }],
    );
    const table = tableGraph(["rod"], { assetId: "bar", assetAttr: "part" }, "part");
    const wrap = table.graph.add(def, {}, "wrap");
    table.graph.disconnect(table.species, "out", table.spawn, "in");
    table.graph.connect(table.species, "out", wrap, "in");
    table.graph.connect(wrap, "out", table.spawn, "in");

    const found = describeGraphAssets(table.graph).find((s) => s.node === "spawn");
    expect(found).toBeDefined();
    expect(found?.open[0]).toMatchObject({ node: "wrap", type: "subgraph" });
    expect(found?.open[0].reason).toContain('"wrap" (subgraph)');
  });
});

// ---------------------------------------------------------------------------
// The corpus. Ground truth for every rule above.
// ---------------------------------------------------------------------------

describe("describeGraphAssets: the graph corpus", () => {
  const spawners = loadGraphs(ROOT).flatMap((entry) =>
    describeGraphAssets(deserializeGraph(entry.json)).map((s) => ({ file: entry.file, ...s })),
  );

  it("finds every spawner in the corpus, bodies included", () => {
    expect(new Set(spawners.map((s) => s.file)).size).toBe(22);
    expect(spawners).toHaveLength(35);
    // Eight of them are inside a `write/instances-by-species` body.
    expect(spawners.filter((s) => s.node.includes(" > "))).toHaveLength(8);
  });

  it("reports exactly the asset ids the corpus promises a renderer", () => {
    const ids: string[] = [];
    for (const spawner of spawners) {
      for (const origin of spawner.ids) if (!ids.includes(origin.id)) ids.push(origin.id);
    }
    expect(ids.slice().sort()).toEqual(
      [
        // arch / gantry / rib arrive with `basics-tile-an-arc`, which
        // draws one of the three per arc range and repeats it — so the
        // ids reach the renderer through an assetAttr rather than a
        // literal, which is the case this list exists to keep honest.
        "arch",
        "gantry",
        "rib",
        "bar",
        "barn",
        "birch",
        "boulder",
        "box",
        "bush",
        "chainLink",
        "clamp",
        "hall",
        "house",
        "lamp",
        "link",
        "log",
        "marker",
        "panel",
        "pine",
        "post",
        "prop",
        "rod",
        "tube",
        "willow",
      ].sort(),
    );
  });

  it("closes every corpus spawner but the two behind a node it cannot read through", () => {
    const open = spawners.filter((s) => s.open.length > 0);
    expect(open.map((s) => `${s.file} ${s.node}`)).toEqual([
      "basics-copy-to-points.json spawn",
      "basics-tile-an-arc.json spawn",
    ]);
    // Each has exactly ONE offending node, named and typed — the corpus has
    // no graph whose set is open twice over, which is what the unit test
    // above covers.
    expect(open.map((s) => s.open.map((o) => o.type))).toEqual([["copyToPoints"], ["subgraph"]]);
    // THE SECOND ONE IS A SUBGRAPH, NOT THE arcTile ABOVE IT, and the
    // difference is worth stating because the obvious guess is wrong.
    // `basics-tile-an-arc` finds all three of its ids — rib, arch and
    // gantry, every one of them `from: "attribute"` — so the openness is
    // not about what the walk FOUND. It is about what it cannot rule out:
    // a `shape/path-loop` wrapper stands between the spawner and any
    // writer, and the walk does not follow geometry out of a body, so it
    // cannot promise the body writes no fourth id.
    //
    // Both entries are therefore the same shape of answer — "a node I
    // cannot read through sits on this path" — and both are honest rather
    // than incomplete. A report that quietly dropped the caveat and listed
    // three ids as the whole set would be the exact failure this walk
    // exists to prevent: a list that reads complete and is not.
  });

  it("never reports an empty id, and always gives an open set an actionable reason", () => {
    for (const spawner of spawners) {
      expect(spawner.ids.length).toBeGreaterThan(0);
      for (const origin of spawner.ids) {
        expect(origin.id).not.toBe("");
        if (origin.from === "attribute") expect(origin.writtenBy).toBeTruthy();
      }
      // Every entry is a whole answer on its own: a node to open, a type to
      // look up, and prose the CLI prints verbatim.
      for (const entry of spawner.open) {
        expect(entry.node).not.toBe("");
        expect(entry.type).not.toBe("");
        expect(entry.reason.length).toBeGreaterThan(20);
      }
    }
  });
});
