/**
 * CLI smoke tests: every subcommand over an in-memory io, asserting the
 * exit codes the shell contract promises (0 ok, 1 failure, 2 misuse) and
 * that library errors reach the user verbatim rather than paraphrased.
 */
import { describe, expect, it } from "vitest";
import { VERSION } from "../index.js";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, runCli } from "./index.js";
import type { CliIo } from "./io.js";

interface FakeIo {
  readonly io: CliIo;
  readonly files: Record<string, string>;
  stdout(): string;
  stderr(): string;
}

function fakeIo(files: Record<string, string> = {}): FakeIo {
  const out: string[] = [];
  const err: string[] = [];
  const store = { ...files };
  return {
    files: store,
    stdout: () => out.join(""),
    stderr: () => err.join(""),
    io: {
      out: (text) => void out.push(text),
      err: (text) => void err.push(text),
      readFile: (path) => {
        const content = store[path];
        if (content === undefined) {
          throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), {
            code: "ENOENT",
          });
        }
        return content;
      },
      writeFile: (path, data) => void (store[path] = data),
    },
  };
}

/** A three-node scatter → noise attribute → filter graph, with meta. */
const SCATTER_GRAPH = JSON.stringify({
  formatVersion: 1,
  seed: 7,
  meta: {
    title: "scatter basics",
    description: "Scatter points in a box, write a noise attribute, keep the high ones.",
    tags: ["basics", "scatter"],
  },
  nodes: [
    {
      id: "scatter",
      type: "pointScatterInBounds",
      params: { count: 64, boundsMin: [0, 0, 0], boundsMax: [10, 0, 10] },
    },
    {
      id: "height",
      type: "setAttribute",
      params: {
        name: "height",
        domain: "point",
        type: "f32",
        value: { fn: "perlinNoise", opts: { frequency: 0.15 } },
      },
    },
    {
      id: "keep",
      type: "filterByAttribute",
      params: { attribute: "height", comparison: "gt", value: 0 },
    },
  ],
  connections: [
    { from: ["scatter", "out"], to: ["height", "in"] },
    { from: ["height", "out"], to: ["keep", "in"] },
  ],
  outputs: [{ id: "keep", pin: "out", name: "points" }],
});

/**
 * A graph whose attributes are named nothing like its nodes, and whose
 * statistics are known exactly: `elevation` is the element index (0..11),
 * `overflow` is 1e39 stored as f32 — i.e. +Infinity in every slot — and
 * `species` picks from ten strings by index.
 */
const ATTR_GRAPH = JSON.stringify({
  formatVersion: 1,
  seed: 3,
  nodes: [
    {
      id: "src",
      type: "pointScatterInBounds",
      params: { count: 12, boundsMin: [0, 0, 0], boundsMax: [4, 0, 4] },
    },
    {
      id: "elev",
      type: "setAttribute",
      params: { name: "elevation", domain: "point", type: "f32", value: { fn: "index" } },
    },
    {
      id: "over",
      type: "setAttribute",
      params: { name: "overflow", domain: "point", type: "f32", value: 1e39 },
    },
    {
      id: "kind",
      type: "setAttribute",
      params: {
        name: "species",
        domain: "point",
        type: "string",
        values: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
        value: { fn: "index" },
      },
    },
  ],
  connections: [
    { from: ["src", "out"], to: ["elev", "in"] },
    { from: ["elev", "out"], to: ["over", "in"] },
    { from: ["over", "out"], to: ["kind", "in"] },
  ],
  outputs: [{ id: "kind", pin: "out", name: "cloud" }],
});

/**
 * A graph whose only interesting param is one nothing outside the field
 * spec names: `lift`, an inline `param` carrying its own value, range and
 * prose. Addressed `dunes.translate.lift` and reachable no other way.
 */
const KNOB_GRAPH = JSON.stringify({
  formatVersion: 1,
  seed: 5,
  nodes: [
    { id: "grid", type: "pointGrid", params: { countX: 3, countZ: 3 } },
    {
      id: "dunes",
      type: "transformPoints",
      params: {
        translate: {
          fn: "mul",
          args: [
            { fn: "position" },
            { fn: "param", name: "lift", value: 2, min: 0, max: 9, description: "How high." },
          ],
        },
      },
    },
  ],
  connections: [{ from: ["grid", "out"], to: ["dunes", "in"] }],
  outputs: [{ id: "dunes", pin: "out", name: "points" }],
});

const GRAPH = "/graphs/scatter.json";
const ATTRS = "/graphs/attrs.json";
const KNOBS = "/graphs/knobs.json";

function withGraph(extra: Record<string, string> = {}): FakeIo {
  return fakeIo({ [GRAPH]: SCATTER_GRAPH, [ATTRS]: ATTR_GRAPH, [KNOBS]: KNOB_GRAPH, ...extra });
}

/** The one output line starting with `name`, whitespace and all. */
function lineFor(text: string, name: string): string {
  return text.split("\n").find((line) => line.trim().startsWith(`${name} `)) ?? "";
}

describe("pcg cli — catalogs", () => {
  it("nodes lists every registered type by category", async () => {
    const io = withGraph();
    expect(await runCli(["nodes"], io.io)).toBe(EXIT_OK);
    expect(io.stdout()).toContain("node types, by category");
    expect(io.stdout()).toContain("pointScatterInBounds");
    expect(io.stdout()).toContain("sampler:");
  });

  it("nodes <type> prints pins and the param schema", async () => {
    const io = withGraph();
    expect(await runCli(["nodes", "pointScatterInBounds"], io.io)).toBe(EXIT_OK);
    const text = io.stdout();
    expect(text).toContain("outputs: out (geometry)");
    expect(text).toContain("count");
    expect(text).toContain("boundsMax");
  });

  it("nodes --json emits the registry metadata", async () => {
    const io = withGraph();
    expect(await runCli(["nodes", "setAttribute", "--json"], io.io)).toBe(EXIT_OK);
    const info = JSON.parse(io.stdout());
    expect(info.type).toBe("setAttribute");
    expect(info.params.value.acceptsField).toBe(true);
  });

  it("an unknown node type fails with the registry's own message", async () => {
    const io = withGraph();
    expect(await runCli(["nodes", "scatterPoints"], io.io)).toBe(EXIT_FAILURE);
    expect(io.stderr()).toContain('unknown node type "scatterPoints"; registered types: ');
    expect(io.stderr()).toContain("pointScatterInBounds");
  });

  it("fields lists the grammar with a description each, and one fn in detail", async () => {
    const io = withGraph();
    expect(await runCli(["fields"], io.io)).toBe(EXIT_OK);
    expect(io.stdout()).toContain("perlinNoise");
    // The list is the `pcg nodes` list's counterpart: one sentence per
    // entry saying what the thing DOES, not 46 type signatures.
    expect(io.stdout()).toContain("Perlin gradient noise");
    expect(io.stdout()).toContain("Elementwise conditional");

    const one = withGraph();
    expect(await runCli(["fields", "perlinNoise"], one.io)).toBe(EXIT_OK);
    expect(one.stdout()).toContain("usage:");

    const bad = withGraph();
    expect(await runCli(["fields", "perlin"], bad.io)).toBe(EXIT_FAILURE);
    expect(bad.stderr()).toContain('unknown field fn "perlin"; valid fns: ');
  });

  /**
   * The detail view is judged against `pcg nodes <type>`, which is the
   * standard the field catalog was failing: a typed table with a real
   * sentence per position. Before this, `pcg fields select` printed
   * `args: [arg0, arg1, arg2]` and nothing else, and an agent had to build
   * a probe graph to find out which argument was the condition.
   */
  it("fields <fn> names each argument in a table, and never prints arg0", async () => {
    const io = withGraph();
    expect(await runCli(["fields", "select"], io.io)).toBe(EXIT_OK);
    const text = io.stdout();
    expect(text).not.toMatch(/\barg\d/);
    expect(text).toContain('usage: { fn: "select", args: [cond, whenTrue, whenFalse] }');
    expect(text).toContain("args:");
    expect(text).toContain("cond");
    expect(text).toContain("whenTrue");
    expect(text).toContain("whenFalse");
    // The prose, not just the names.
    expect(text).toContain("Elementwise conditional");

    // `remap`'s five positions were the sharpest case: `[arg0..arg4]` is a
    // length, not a signature.
    const remap = withGraph();
    expect(await runCli(["fields", "remap"], remap.io)).toBe(EXIT_OK);
    expect(remap.stdout()).toContain('args: [x, inMin, inMax, outMin, outMax]');
  });

  it("fields <fn> prints the output range a noise was always keeping to itself", async () => {
    const io = withGraph();
    expect(await runCli(["fields", "perlinNoise"], io.io)).toBe(EXIT_OK);
    const text = io.stdout();
    expect(text).toContain("output range:");
    expect(text).toContain("-1 .. 1");
    expect(text).toContain("opts.normalized: true");
    // The measured trap, with a remedy an author can act on.
    expect(text).toMatch(/lattice/i);
    expect(text).toMatch(/fractional/i);

    // Worley publishes one range per `output`, because one pair of numbers
    // would be wrong for two of the three.
    const worley = withGraph();
    expect(await runCli(["fields", "worleyNoise"], worley.io)).toBe(EXIT_OK);
    expect(worley.stdout()).toContain('output: "f1"');
    expect(worley.stdout()).toContain('output: "f2-f1"');
  });

  it("--json carries the description, the named args and the ranges", async () => {
    const one = withGraph();
    expect(await runCli(["fields", "ramp", "--json"], one.io)).toBe(EXIT_OK);
    const info = JSON.parse(one.stdout()) as {
      fn: string;
      usage: string;
      description: string;
      args?: { name: string; description: string }[];
    };
    expect(info.fn).toBe("ramp");
    // The two things the log could not learn from `--json`: what the stops
    // mean, and what happens outside them.
    expect(info.description).toMatch(/inputPosition/);
    expect(info.description).toMatch(/CLAMP/i);
    expect(info.args?.[0].name).toBe("scalarField");

    const all = withGraph();
    expect(await runCli(["fields", "--json"], all.io)).toBe(EXIT_OK);
    const infos = JSON.parse(all.stdout()) as {
      fn: string;
      usage: string;
      description: string;
      outputRange?: { min: number; max: number; note?: string }[];
    }[];
    // The list keeps the usage sketches it always carried — they left the
    // TEXT table, not the machine-readable report.
    expect(infos.every((i) => i.usage !== "" && i.description !== "")).toBe(true);
    const random = infos.find((i) => i.fn === "randomField");
    expect(random?.outputRange?.[0]).toEqual({
      min: 0,
      max: 1,
      note: "half-open — 0 occurs, 1 never does",
    });
  });
});

describe("pcg cli — validate", () => {
  it("reports structure and meta", async () => {
    const io = withGraph();
    expect(await runCli(["validate", GRAPH], io.io)).toBe(EXIT_OK);
    const text = io.stdout();
    expect(text).toContain(`ok  ${GRAPH}`);
    expect(text).toContain("seed 7  3 nodes  2 connections  1 output");
    expect(text).toContain("title:       scatter basics");
    expect(text).toContain("tags:        basics, scatter");
    // The declared output, with the pin it reads — not merely the word
    // "points" somewhere in the report.
    expect(lineFor(text, "points")).toMatch(/^\s+points\s+<- keep\.out$/);
  });

  it("prints each node's DERIVED seed, which is what a rename moves", async () => {
    const io = withGraph();
    expect(await runCli(["validate", GRAPH], io.io)).toBe(EXIT_OK);
    // `hash(graphSeed, nodeId)` — the number that decides what the node
    // draws, and the only way to see it used to be to cook and infer.
    const row = lineFor(io.stdout(), "scatter");
    expect(row).toMatch(/^\s+scatter\s+pointScatterInBounds\s+\d+$/);
    const json = withGraph();
    expect(await runCli(["validate", GRAPH, "--json"], json.io)).toBe(EXIT_OK);
    const seeds = JSON.parse(json.stdout()).nodes.map((n: { seed: number }) => n.seed);
    expect(seeds).toHaveLength(3);
    expect(new Set(seeds).size).toBe(3); // one per id, not one per graph
    expect(seeds.every((s: number) => Number.isInteger(s) && s >= 0)).toBe(true);
  });

  it("--json carries the meta block through", async () => {
    const io = withGraph();
    expect(await runCli(["validate", GRAPH, "--json"], io.io)).toBe(EXIT_OK);
    const report = JSON.parse(io.stdout());
    expect(report.ok).toBe(true);
    expect(report.seed).toBe(7);
    expect(report.meta.tags).toEqual(["basics", "scatter"]);
    expect(report.nodes.map((n: { id: string }) => n.id)).toEqual(["scatter", "height", "keep"]);
    expect(report.outputs).toEqual([{ name: "points", node: "keep", pin: "out" }]);
  });

  it("--params prints the address of a value living inside a field spec", async () => {
    const io = withGraph();
    expect(await runCli(["validate", KNOBS, "--params"], io.io)).toBe(EXIT_OK);
    const text = io.stdout();
    expect(text).toContain("params:  9 addresses, 1 declared worth turning (*)");
    expect(text).toContain('addressed as "seed" (currently 5)');
    // The three-part key is the whole point: nothing else in the library
    // or the docs names `lift`, and finding it used to mean opening the
    // graph in the sandbox and reading a label.
    expect(lineFor(text, "*")).toMatch(/^\s+\*\s+dunes\.translate\.lift\s+f32\s+2\s+0\.\.9$/);
    // Its container is listed too, and says it holds an expression rather
    // than pretending to a value a knob could write.
    expect(lineFor(text, "dunes.translate")).toMatch(/dunes\.translate\s+vec3\s+\(field\)$/);
  });

  it("--params is opt-in, and --json carries the same list", async () => {
    const bare = withGraph();
    expect(await runCli(["validate", KNOBS], bare.io)).toBe(EXIT_OK);
    expect(bare.stdout()).not.toContain("params:");

    const io = withGraph();
    expect(await runCli(["validate", KNOBS, "--params", "--json"], io.io)).toBe(EXIT_OK);
    const report = JSON.parse(io.stdout());
    const lift = report.params.find((p: { key: string }) => p.key === "dunes.translate.lift");
    expect(lift).toMatchObject({
      node: "dunes",
      type: "transformPoints",
      param: "translate",
      fieldParam: "lift",
      value: 2,
      exposed: true,
      holdsField: false,
      schema: { type: "f32", default: 2, description: "How high.", min: 0, max: 9 },
    });
    // No flag, no key — the terse report stays terse for an agent too.
    const plain = withGraph();
    expect(await runCli(["validate", KNOBS, "--json"], plain.io)).toBe(EXIT_OK);
    expect(JSON.parse(plain.stdout()).params).toBeUndefined();
  });

  it("an invalid graph fails with the library's message, unparaphrased", async () => {
    const io = fakeIo({
      "/bad.json": JSON.stringify({
        formatVersion: 1,
        seed: 1,
        nodes: [{ id: "a", type: "scatterPoints", params: {} }],
        connections: [],
        outputs: [],
      }),
    });
    expect(await runCli(["validate", "/bad.json"], io.io)).toBe(EXIT_FAILURE);
    expect(io.stderr()).toContain('node "a": unknown node type "scatterPoints"; registered types: ');
  });

  it("a missing file and invalid JSON are named by the CLI", async () => {
    const missing = fakeIo();
    expect(await runCli(["validate", "/nope.json"], missing.io)).toBe(EXIT_FAILURE);
    expect(missing.stderr()).toContain('cannot read graph file "/nope.json"');

    const broken = fakeIo({ "/broken.json": "{ nope" });
    expect(await runCli(["validate", "/broken.json"], broken.io)).toBe(EXIT_FAILURE);
    expect(broken.stderr()).toContain('"/broken.json" is not valid JSON');
  });

  it("reads a file written with a UTF-8 BOM", async () => {
    const io = fakeIo({ "/bom.json": `﻿${SCATTER_GRAPH}` });
    expect(await runCli(["validate", "/bom.json"], io.io)).toBe(EXIT_OK);
    expect(io.stdout()).toContain("ok  /bom.json");
  });
});

describe("pcg cli — cook", () => {
  it("cooks every declared output and reports counts", async () => {
    const io = withGraph();
    expect(await runCli(["cook", GRAPH], io.io)).toBe(EXIT_OK);
    const text = io.stdout();
    expect(text).toContain(`cooked ${GRAPH} (seed 7)`);
    expect(text).toContain("3 cooked, 0 cached");
    expect(text).toContain("points (1 item)");
    expect(text).toContain("geometry   points ");
  });

  it("--stats adds the per-node breakdown, and without it there is none", async () => {
    const plain = withGraph();
    expect(await runCli(["cook", GRAPH], plain.io)).toBe(EXIT_OK);
    expect(plain.stdout()).not.toContain("per-node:");
    expect(plain.stdout()).not.toContain("pointScatterInBounds");

    const io = withGraph();
    expect(await runCli(["cook", GRAPH, "--stats"], io.io)).toBe(EXIT_OK);
    const text = io.stdout();
    expect(text).toContain("per-node:");
    expect(lineFor(text, "id")).toMatch(/^\s+id\s+type\s+state\s+elapsed$/);
    // id, type, state, elapsed — the state column says which nodes ran and
    // which were served from cache, in those words.
    expect(lineFor(text, "scatter")).toMatch(
      /^\s+scatter\s+pointScatterInBounds\s+cooked\s+[\d.]+ ms$/,
    );
    expect(lineFor(text, "keep")).toMatch(/^\s+keep\s+filterByAttribute\s+cooked\s+[\d.]+ ms$/);
  });

  it("--out writes the JSON report, and both renderings record the write", async () => {
    const io = withGraph();
    expect(await runCli(["cook", GRAPH, "--out", "/reports/cook.json"], io.io)).toBe(EXIT_OK);
    const report = JSON.parse(io.files["/reports/cook.json"]);
    expect(report.stats.cooked).toBe(3);
    expect(report.nodes.map((n: { type: string }) => n.type)).toEqual([
      "pointScatterInBounds",
      "setAttribute",
      "filterByAttribute",
    ]);
    expect(report.outputs.points[0].kind).toBe("geometry");
    expect(io.stdout()).toContain("wrote /reports/cook.json");
    // The text and the JSON describe the same run, so the file the run
    // wrote is named in both.
    expect(report.out).toBe("/reports/cook.json");

    const none = withGraph();
    await runCli(["cook", GRAPH, "--json"], none.io);
    expect(JSON.parse(none.stdout()).out).toBeNull();
  });

  it("--seed changes the cooked result", async () => {
    const a = withGraph();
    const b = withGraph();
    await runCli(["cook", GRAPH, "--json"], a.io);
    await runCli(["cook", GRAPH, "--seed", "99", "--json"], b.io);
    const boundsOf = (text: string): unknown =>
      JSON.parse(text).outputs.points[0].geometry.bounds;
    expect(boundsOf(a.stdout())).not.toEqual(boundsOf(b.stdout()));
  });

  it("a cook that throws exits 1 with the node's own message", async () => {
    const io = fakeIo({
      "/bad-attr.json": JSON.stringify({
        formatVersion: 1,
        seed: 1,
        nodes: [
          { id: "scatter", type: "pointScatterInBounds", params: { count: 8 } },
          {
            id: "keep",
            type: "filterByAttribute",
            params: { attribute: "nope", comparison: "gt", value: 0 },
          },
        ],
        connections: [{ from: ["scatter", "out"], to: ["keep", "in"] }],
        outputs: [{ id: "keep", pin: "out", name: "points" }],
      }),
    });
    expect(await runCli(["cook", "/bad-attr.json"], io.io)).toBe(EXIT_FAILURE);
    expect(io.stderr()).toContain(
      'node "keep" failed: filterByAttribute: point attribute "nope" not found; available: ',
    );
  });

  it("a field param that resolves to a non-finite value fails the cook, not silently", async () => {
    // The refusal has to reach the shell as a FAILURE. A serialized graph
    // carries its field as the JSON grammar, where `div` by a literal 0 is
    // the shortest way to write the mistake the guard exists for: the
    // schema's min/max bound nothing, because there was no number to bind
    // until the recipe landed on a domain.
    const io = fakeIo({
      "/non-finite.json": JSON.stringify({
        formatVersion: 1,
        seed: 1,
        nodes: [
          {
            id: "scatter",
            type: "pointScatterInBounds",
            params: { count: 6, boundsMin: [0, 0, 0], boundsMax: [4, 0, 4] },
          },
          {
            id: "height",
            type: "setAttribute",
            params: {
              name: "height",
              domain: "point",
              type: "f32",
              value: { fn: "div", args: [1, 0] },
            },
          },
        ],
        connections: [{ from: ["scatter", "out"], to: ["height", "in"] }],
        outputs: [{ id: "height", pin: "out", name: "points" }],
      }),
    });
    expect(await runCli(["cook", "/non-finite.json"], io.io)).toBe(EXIT_FAILURE);
    // The node instance, the node TYPE and the PARAM, all named — the
    // three things an agent needs to edit the right key of the right node.
    expect(io.stderr()).toContain(
      'node "height" failed: setAttribute: param "value" resolved to +Infinity at element 0 — ' +
        "6 of 6 elements are non-finite.",
    );
    // ...and the fix, in the same breath as the complaint.
    expect(io.stderr()).toContain('set "value" to a plain number');
    // Nothing may read as a completed cook: an exit code alone is easy to
    // miss in a pipeline that also prints a report.
    expect(io.stdout()).not.toContain("cooked /non-finite.json");
  });

  it("a graph with no declared outputs says so, and points at the fix", async () => {
    const io = fakeIo({
      "/no-outputs.json": JSON.stringify({
        formatVersion: 1,
        seed: 1,
        nodes: [{ id: "scatter", type: "pointScatterInBounds", params: { count: 4 } }],
        connections: [],
        outputs: [],
      }),
    });
    expect(await runCli(["cook", "/no-outputs.json"], io.io)).toBe(EXIT_FAILURE);
    expect(io.stderr()).toContain("declares no outputs");
    expect(io.stderr()).toContain("--node <id>");
  });

  it("reports the seed that actually cooked, never the one that was typed", async () => {
    const io = withGraph();
    expect(await runCli(["cook", GRAPH, "--seed", "0"], io.io)).toBe(EXIT_OK);
    expect(io.stdout()).toContain("(seed override 0)");

    // Graph.setSeed keeps 32 bits, so anything above the range would cook
    // as a different number: the flag is refused rather than truncated.
    const tooBig = withGraph();
    expect(await runCli(["cook", GRAPH, "--seed", "4294967296"], tooBig.io)).toBe(EXIT_USAGE);
    expect(tooBig.stderr()).toContain(
      'cook: flag "--seed" expects an integer in [0, 4294967295], got 4294967296',
    );

    const huge = withGraph();
    expect(await runCli(["cook", GRAPH, "--seed", "9007199254740991"], huge.io)).toBe(EXIT_USAGE);
    expect(huge.stderr()).toContain('flag "--seed" expects an integer in [0, 4294967295]');
  });

  // A budget of 0 is a real budget, not "off": the executor tests
  // `budgetMs !== undefined`, so 0 yields after every node. That is the
  // maximum-partitioning check the performance skill documents, so the
  // CLI has to accept it — it used to reject it, which made the
  // documented check reachable from the API but not the command line.
  it("accepts a budget of zero as maximum partitioning", async () => {
    const io = withGraph();
    expect(await runCli(["cook", GRAPH, "--budget", "0"], io.io)).toBe(EXIT_OK);
  });

  it("refuses a negative budget as a misuse, not as a run failure", async () => {
    const negative = withGraph();
    expect(await runCli(["cook", GRAPH, "--budget", "-5"], negative.io)).toBe(EXIT_USAGE);
    expect(negative.stderr()).toContain('flag "--budget" expects a non-negative number');
  });
});

describe("pcg cli — inspect", () => {
  it("reports domains, attribute statistics, bounds and sample rows", async () => {
    const io = withGraph();
    expect(await runCli(["inspect", GRAPH, "--node", "height"], io.io)).toBe(EXIT_OK);
    const text = io.stdout();
    expect(text).toContain('node "height" pin "out"');
    expect(text).toContain("point — 64 elements");
    // The height ATTRIBUTE, as a row of the statistics table — the node is
    // also called "height", so a bare substring proves nothing.
    expect(lineFor(text, "height")).toMatch(/^\s+height\s+f32\s+1\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+0$/);
    expect(text).toContain("first 5 of 64 point rows:");
  });

  it("--rows and --json expose the same sample", async () => {
    const io = withGraph();
    expect(await runCli(["inspect", GRAPH, "--node", "scatter", "--rows", "2", "--json"], io.io)).toBe(
      EXIT_OK,
    );
    const report = JSON.parse(io.stdout());
    expect(report.items[0].kind).toBe("geometry");
    expect(report.items[0].geometry.points).toBe(64);
    expect(report.items[0].sample.rows).toHaveLength(2);
    expect(report.items[0].sample.columns).toContain("P");
  });

  it("cooks only the targeted node's upstream subgraph", async () => {
    const io = withGraph();
    await runCli(["inspect", GRAPH, "--node", "scatter", "--json"], io.io);
    expect(JSON.parse(io.stdout()).stats.cooked).toBe(1);
  });

  it("an unknown node or pin lists the valid ones", async () => {
    const node = withGraph();
    expect(await runCli(["inspect", GRAPH, "--node", "nope"], node.io)).toBe(EXIT_FAILURE);
    expect(node.stderr()).toContain('unknown node "nope"; nodes in this graph: scatter, height, keep');

    const pin = withGraph();
    expect(await runCli(["inspect", GRAPH, "--node", "scatter", "--pin", "nope"], pin.io)).toBe(
      EXIT_FAILURE,
    );
    expect(pin.stderr()).toContain('node "scatter" has no output pin "nope"; its output pins: out');
  });

  it("refuses target flags that would silently do nothing", async () => {
    const both = withGraph();
    expect(await runCli(["inspect", GRAPH, "--node", "scatter", "--output", "points"], both.io)).toBe(
      EXIT_USAGE,
    );
    expect(both.stderr()).toContain("--node and --output select different sources");

    const orphanPin = withGraph();
    expect(await runCli(["inspect", GRAPH, "--pin", "out"], orphanPin.io)).toBe(EXIT_USAGE);
    expect(orphanPin.stderr()).toContain("--pin names an output pin on --node");
  });

  it("reads one declared output by name, and lists them when the name is wrong", async () => {
    const io = withGraph();
    expect(await runCli(["inspect", GRAPH, "--output", "points", "--json"], io.io)).toBe(EXIT_OK);
    expect(JSON.parse(io.stdout()).target).toBe('output "points"');

    const wrong = withGraph();
    expect(await runCli(["inspect", GRAPH, "--output", "point"], wrong.io)).toBe(EXIT_FAILURE);
    expect(wrong.stderr()).toContain('unknown output "point"; declared outputs: points');
  });

  it("an unknown domain is a misuse, and lists the valid ones", async () => {
    const io = withGraph();
    expect(await runCli(["inspect", GRAPH, "--domain", "points"], io.io)).toBe(EXIT_USAGE);
    expect(io.stderr()).toContain(
      'inspect: flag "--domain" got unknown domain "points"; valid domains: point, vertex, primitive, detail',
    );
  });

  it("prints each attribute by name, with its own statistics", async () => {
    const io = withGraph();
    expect(await runCli(["inspect", ATTRS, "--output", "cloud"], io.io)).toBe(EXIT_OK);
    const text = io.stdout();
    // elevation is the element index over 12 points: 0..11, mean 5.5. The
    // name is nothing like any node id in the graph, so finding it here
    // means the attribute table really carries it.
    expect(lineFor(text, "attr")).toMatch(/^\s+attr\s+type\s+tuple\s+min\s+max\s+mean\s+non-finite$/);
    expect(lineFor(text, "elevation")).toMatch(/^\s+elevation\s+f32\s+1\s+0\s+11\s+5\.5\s+0$/);
  });

  it("shows non-finite values in the text, not only under --json", async () => {
    const io = withGraph();
    expect(await runCli(["inspect", ATTRS, "--output", "cloud"], io.io)).toBe(EXIT_OK);
    // overflow is 1e39 in an f32 column, i.e. +Infinity in all 12 slots.
    // Min/max/mean have nothing to say; the count is the whole answer, and
    // a text report that omitted it would show an attribute that destroyed
    // itself as an attribute with nothing to say.
    expect(lineFor(io.stdout(), "overflow")).toMatch(/^\s+overflow\s+f32\s+1\s+12$/);

    const json = withGraph();
    await runCli(["inspect", ATTRS, "--output", "cloud", "--json"], json.io);
    const report = JSON.parse(json.stdout());
    const point = report.items[0].geometry.domains.find(
      (d: { domain: string }) => d.domain === "point",
    );
    const overflow = point.attrs.find((a: { name: string }) => a.name === "overflow");
    expect(overflow.nonFinite).toBe(12);
    expect(overflow.min).toBeUndefined();
  });

  it("gives string attributes their own table, and says when the list is cut", async () => {
    const io = withGraph();
    expect(await runCli(["inspect", ATTRS, "--output", "cloud"], io.io)).toBe(EXIT_OK);
    const text = io.stdout();
    // A distinct-value count printed under a `min` header is a lie an
    // agent reading by column position will believe, so strings get their
    // own headers rather than borrowing the numeric ones.
    const headers = text.split("\n").filter((line) => line.trim().startsWith("attr "));
    expect(headers).toHaveLength(2);
    expect(headers[0]).toMatch(/^\s+attr\s+type\s+tuple\s+min\s+max\s+mean\s+non-finite$/);
    expect(headers[1]).toMatch(/^\s+attr\s+type\s+tuple\s+distinct\s+values$/);
    expect(lineFor(text, "species")).toMatch(
      /^\s+species\s+string\s+1\s+10\s+"a" "b" "c" "d" "e" "f" "g" "h" \(\+2 more\)$/,
    );
  });

  it("says --rows 0 was asked for, rather than that there was nothing to sample", async () => {
    const io = withGraph();
    expect(await runCli(["inspect", GRAPH, "--node", "scatter", "--rows", "0"], io.io)).toBe(
      EXIT_OK,
    );
    expect(io.stdout()).toContain("point rows not sampled (--rows 0; 64 elements)");
    expect(io.stdout()).not.toContain("no point rows to sample");
  });
});

describe("pcg cli — render", () => {
  it("writes an SVG and reports what it drew", async () => {
    const io = withGraph();
    expect(await runCli(["render", GRAPH, "--out", "/out/scatter.svg"], io.io)).toBe(EXIT_OK);
    const svg = io.files["/out/scatter.svg"];
    expect(svg.startsWith("<svg xmlns=")).toBe(true);
    expect(svg).toContain("<circle");
    expect(svg.endsWith("</svg>\n")).toBe(true);
    expect(io.stdout()).toContain("wrote /out/scatter.svg");
  });

  it("is byte-identical across runs at the same seed, and differs at another", async () => {
    const first = withGraph();
    const second = withGraph();
    const other = withGraph();
    await runCli(["render", GRAPH, "--out", "/a.svg"], first.io);
    await runCli(["render", GRAPH, "--out", "/b.svg"], second.io);
    await runCli(["render", GRAPH, "--seed", "99", "--out", "/c.svg"], other.io);
    expect(first.files["/a.svg"]).toBe(second.files["/b.svg"]);
    expect(other.files["/c.svg"]).not.toBe(first.files["/a.svg"]);
  });

  it("prints the SVG to stdout when --out is omitted", async () => {
    const io = withGraph();
    expect(await runCli(["render", GRAPH, "--width", "200"], io.io)).toBe(EXIT_OK);
    expect(io.stdout().startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="200"')).toBe(true);
  });

  it("colors by an attribute, and names the alternatives when it is missing", async () => {
    const ok = withGraph();
    expect(await runCli(["render", GRAPH, "--attr", "height", "--out", "/h.svg", "--json"], ok.io)).toBe(
      EXIT_OK,
    );
    expect(JSON.parse(ok.stdout()).colorAttr).toBe("height");
    // Which domain the colors came from is part of the report, because
    // the same name can live on the points, on the primitives or on both.
    expect(JSON.parse(ok.stdout()).colorDomains).toEqual(["point"]);

    const bad = withGraph();
    expect(await runCli(["render", GRAPH, "--attr", "nope", "--out", "/n.svg"], bad.io)).toBe(
      EXIT_FAILURE,
    );
    expect(bad.stderr()).toContain(
      'item 0 has no attribute "nope" to color by on the point or the primitive domain; item 0 point attributes: ',
    );
    expect(bad.stderr()).toContain("primitive attributes: (none)");
  });

  it("--attr-domain narrows the lookup, and is refused where it would color nothing", async () => {
    const narrowed = withGraph();
    expect(
      await runCli(
        ["render", GRAPH, "--attr", "height", "--attr-domain", "point", "--out", "/h.svg", "--json"],
        narrowed.io,
      ),
    ).toBe(EXIT_OK);
    expect(JSON.parse(narrowed.stdout()).colorDomains).toEqual(["point"]);

    const alone = withGraph();
    expect(
      await runCli(["render", GRAPH, "--attr-domain", "point", "--out", "/a.svg"], alone.io),
    ).toBe(EXIT_USAGE);
    expect(alone.stderr()).toContain("--attr-domain narrows which domain --attr is read from");

    const unknown = withGraph();
    expect(
      await runCli(
        ["render", GRAPH, "--attr", "height", "--attr-domain", "vertex", "--out", "/v.svg"],
        unknown.io,
      ),
    ).toBe(EXIT_USAGE);
    expect(unknown.stderr()).toContain('flag "--attr-domain" got "vertex"; valid domains: point, primitive');
  });

  it("--json without --out is a misuse, not a failure", async () => {
    const io = withGraph();
    expect(await runCli(["render", GRAPH, "--json"], io.io)).toBe(EXIT_USAGE);
    expect(io.stderr()).toContain("--json needs --out");
  });

  it("a radius of zero is a misuse, like a width of zero on the same command", async () => {
    const radius = withGraph();
    expect(await runCli(["render", GRAPH, "--radius", "0", "--out", "/o.svg"], radius.io)).toBe(
      EXIT_USAGE,
    );
    expect(radius.stderr()).toContain(
      'render: flag "--radius" expects a number greater than 0 (pixels), got 0',
    );

    const width = withGraph();
    expect(await runCli(["render", GRAPH, "--width", "0", "--out", "/o.svg"], width.io)).toBe(
      EXIT_USAGE,
    );
  });

  it("writes a picture in pixel space, whatever the world scale", async () => {
    const io = withGraph();
    expect(await runCli(["render", GRAPH, "--out", "/px.svg", "--width", "200", "--json"], io.io)).toBe(
      EXIT_OK,
    );
    const svg = io.files["/px.svg"];
    const report = JSON.parse(io.stdout());
    expect(svg).toContain(`viewBox="0 0 200 ${report.height}"`);
    expect(svg).toContain('r="1.5"');
    expect(svg).not.toContain('r="0"');
    // The report's bounds stay in world units — data about the cook.
    expect(report.bounds.max[0]).toBeGreaterThan(1);
    expect(io.stdout()).not.toContain("device-resident");
  });
});

describe("pcg cli — the command line itself", () => {
  it("no arguments prints usage to stderr and exits 2", async () => {
    const io = fakeIo();
    expect(await runCli([], io.io)).toBe(EXIT_USAGE);
    expect(io.stderr()).toContain("usage: pcg <command>");
    expect(io.stdout()).toBe("");
  });

  it("--help and per-command help exit 0 on stdout", async () => {
    const top = fakeIo();
    expect(await runCli(["--help"], top.io)).toBe(EXIT_OK);
    expect(top.stdout()).toContain("Commands:");

    const one = fakeIo();
    expect(await runCli(["inspect", "--help"], one.io)).toBe(EXIT_OK);
    expect(one.stdout()).toContain("pcg inspect <graph.json> [flags]");
    expect(one.stdout()).toContain("--rows");
  });

  it("--version prints the library version", async () => {
    const io = fakeIo();
    expect(await runCli(["--version"], io.io)).toBe(EXIT_OK);
    expect(io.stdout()).toBe(`${VERSION}\n`);
  });

  it("an unknown command or flag lists what is valid", async () => {
    const command = fakeIo();
    expect(await runCli(["bake", "x.json"], command.io)).toBe(EXIT_USAGE);
    expect(command.stderr()).toContain(
      'unknown command "bake"; commands: nodes, fields, validate, cook, run, inspect, render',
    );

    const flag = withGraph();
    expect(await runCli(["cook", GRAPH, "--stat"], flag.io)).toBe(EXIT_USAGE);
    expect(flag.stderr()).toContain('cook: unknown flag "--stat"; valid flags: ');
    expect(flag.stderr()).toContain("--stats");
  });

  it("a missing argument and a missing flag value are both misuses", async () => {
    const arg = fakeIo();
    expect(await runCli(["cook"], arg.io)).toBe(EXIT_USAGE);
    expect(arg.stderr()).toContain("missing required argument <graph.json>");

    const value = withGraph();
    expect(await runCli(["cook", GRAPH, "--seed"], value.io)).toBe(EXIT_USAGE);
    expect(value.stderr()).toContain('flag "--seed" needs a value');
  });

  it("rejects a repeated flag and a non-integer seed", async () => {
    const twice = withGraph();
    expect(await runCli(["cook", GRAPH, "--seed", "1", "--seed", "2"], twice.io)).toBe(EXIT_USAGE);
    expect(twice.stderr()).toContain('flag "--seed" was given more than once');

    const fractional = withGraph();
    expect(await runCli(["cook", GRAPH, "--seed", "1.5"], fractional.io)).toBe(EXIT_USAGE);
    expect(fractional.stderr()).toContain(
      'flag "--seed" expects an integer in [0, 4294967295], got 1.5',
    );
  });

  it("accepts --flag=value as well as --flag value", async () => {
    const io = withGraph();
    expect(await runCli(["cook", GRAPH, "--seed=3", "--json"], io.io)).toBe(EXIT_OK);
    expect(JSON.parse(io.stdout()).seed).toBe(3);
  });

  it("does not honour a help token that a flag is waiting to consume", async () => {
    // The only path that used to return SUCCESS for a command line that
    // cannot be parsed: in `pcg validate g.json && pcg cook g.json --out
    // --help` the chain would proceed as if the cook had run.
    const consumed = withGraph();
    expect(await runCli(["cook", GRAPH, "--out", "--help"], consumed.io)).toBe(EXIT_USAGE);
    expect(consumed.stderr()).toContain('cook: flag "--out" needs a value (--out <file>)');
    expect(consumed.stdout()).toBe("");

    // ...while help on an otherwise incomplete line still works, which is
    // the whole reason the check existed.
    const incomplete = fakeIo();
    expect(await runCli(["inspect", "--help"], incomplete.io)).toBe(EXIT_OK);
    expect(incomplete.stdout()).toContain("pcg inspect <graph.json> [flags]");

    const short = fakeIo();
    expect(await runCli(["render", "-h"], short.io)).toBe(EXIT_OK);
    expect(short.stdout()).toContain("pcg render <graph.json> [flags]");

    // After --, a help token is a positional like any other.
    const ended = withGraph();
    expect(await runCli(["nodes", "--", "--help"], ended.io)).toBe(EXIT_FAILURE);
    expect(ended.stderr()).toContain('unknown node type "--help"');
  });

  it("rejects an empty value where a name or a path is required", async () => {
    const empty = withGraph();
    expect(await runCli(["cook", GRAPH, "--out="], empty.io)).toBe(EXIT_USAGE);
    expect(empty.stderr()).toContain('cook: flag "--out" needs a non-empty value (--out <file>)');

    const blank = withGraph();
    expect(await runCli(["cook", GRAPH, "--out", "   "], blank.io)).toBe(EXIT_USAGE);
    expect(blank.stderr()).toContain('flag "--out" needs a non-empty value');
    expect(Object.keys(blank.files)).toEqual([GRAPH, ATTRS, KNOBS]);
  });

  it("states the exit-code rule in the top-level help", async () => {
    const io = fakeIo();
    expect(await runCli(["--help"], io.io)).toBe(EXIT_OK);
    const text = io.stdout();
    expect(text).toContain("Exit codes:");
    expect(text).toContain("1  a named thing does not exist");
    expect(text).toContain("2  the command line itself is wrong");
  });

  it("keeps the two exit-code classes apart across commands", async () => {
    // 1 = you named something that does not exist; 2 = the command line
    // itself is wrong. A caller branching on the code depends on it.
    const cases: readonly (readonly [readonly string[], number])[] = [
      [["fields", "perlin"], EXIT_FAILURE],
      [["nodes", "scatterPoints"], EXIT_FAILURE],
      [["inspect", GRAPH, "--node", "nope"], EXIT_FAILURE],
      [["inspect", GRAPH, "--output", "nope"], EXIT_FAILURE],
      [["bake", GRAPH], EXIT_USAGE],
      [["cook", GRAPH, "--stat"], EXIT_USAGE],
      [["cook", GRAPH, "--budget", "-5"], EXIT_USAGE],
      [["cook", GRAPH, "--seed", "-1"], EXIT_USAGE],
      [["inspect", GRAPH, "--domain", "bogus"], EXIT_USAGE],
      [["inspect", GRAPH, "--rows", "-1"], EXIT_USAGE],
      [["render", GRAPH, "--radius", "0", "--out", "/o.svg"], EXIT_USAGE],
      [["render", GRAPH, "--width", "0", "--out", "/o.svg"], EXIT_USAGE],
      [["render", GRAPH, "--max-points", "0", "--out", "/o.svg"], EXIT_USAGE],
      [["cook", GRAPH, "--out", "--help"], EXIT_USAGE],
    ];
    for (const [argv, code] of cases) {
      const io = withGraph();
      expect(await runCli(argv, io.io), argv.join(" ")).toBe(code);
    }
  });
});
