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

const GRAPH = "/graphs/scatter.json";

function withGraph(extra: Record<string, string> = {}): FakeIo {
  return fakeIo({ [GRAPH]: SCATTER_GRAPH, ...extra });
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

  it("fields lists the grammar with usage, and one fn in detail", async () => {
    const io = withGraph();
    expect(await runCli(["fields"], io.io)).toBe(EXIT_OK);
    expect(io.stdout()).toContain("perlinNoise");

    const one = withGraph();
    expect(await runCli(["fields", "perlinNoise"], one.io)).toBe(EXIT_OK);
    expect(one.stdout()).toContain("usage:");

    const bad = withGraph();
    expect(await runCli(["fields", "perlin"], bad.io)).toBe(EXIT_FAILURE);
    expect(bad.stderr()).toContain('unknown field fn "perlin"; valid fns: ');
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
    expect(text).toContain("points");
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

  it("--stats adds the per-node breakdown", async () => {
    const io = withGraph();
    expect(await runCli(["cook", GRAPH, "--stats"], io.io)).toBe(EXIT_OK);
    expect(io.stdout()).toContain("per-node:");
    expect(io.stdout()).toContain("pointScatterInBounds");
    expect(io.stdout()).toContain("cooked");
  });

  it("--out writes the JSON report", async () => {
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
});

describe("pcg cli — inspect", () => {
  it("reports domains, attribute statistics, bounds and sample rows", async () => {
    const io = withGraph();
    expect(await runCli(["inspect", GRAPH, "--node", "height"], io.io)).toBe(EXIT_OK);
    const text = io.stdout();
    expect(text).toContain('node "height" pin "out"');
    expect(text).toContain("point — 64 elements");
    expect(text).toContain("height");
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

  it("an unknown domain lists the valid ones", async () => {
    const io = withGraph();
    expect(await runCli(["inspect", GRAPH, "--domain", "points"], io.io)).toBe(EXIT_FAILURE);
    expect(io.stderr()).toContain('unknown domain "points"; valid domains: point, vertex, primitive, detail');
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

    const bad = withGraph();
    expect(await runCli(["render", GRAPH, "--attr", "nope", "--out", "/n.svg"], bad.io)).toBe(
      EXIT_FAILURE,
    );
    expect(bad.stderr()).toContain('no point attribute "nope" to color by; point attributes: ');
  });

  it("--json without --out is a misuse, not a failure", async () => {
    const io = withGraph();
    expect(await runCli(["render", GRAPH, "--json"], io.io)).toBe(EXIT_USAGE);
    expect(io.stderr()).toContain("--json needs --out");
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
      'unknown command "bake"; commands: nodes, fields, validate, cook, inspect, render',
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
    expect(fractional.stderr()).toContain('flag "--seed" expects an integer >= 0, got 1.5');
  });

  it("accepts --flag=value as well as --flag value", async () => {
    const io = withGraph();
    expect(await runCli(["cook", GRAPH, "--seed=3", "--json"], io.io)).toBe(EXIT_OK);
    expect(JSON.parse(io.stdout()).seed).toBe(3);
  });
});
