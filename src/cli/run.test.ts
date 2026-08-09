/**
 * `pcg run <name>` — cooking a registered primitive with no graph file.
 *
 * Three things are under test and each has a way of silently not working:
 * the synthesized wrapper (whose node id and seed decide what cooks, so it
 * is compared byte-for-byte against the hand-written `ref` graph it must
 * be equivalent to), the schema-directed `--param` typing (one case per
 * param type, because a parser that guesses from the text would pass a
 * numeric case and fail a string one), and `--in`, which must bind value
 * items and must REFUSE geometry rather than appear to accept it.
 *
 * The subgraph registry is global module state with no unregister, so the
 * primitives below are registered once, under `test/` names, in this file
 * only — vitest gives each test file its own module registry, so they are
 * invisible to every other suite (including the catalog drift test, which
 * would otherwise see them).
 */
import { describe, expect, it } from "vitest";
import {
  Graph,
  type ParamSchema,
  jitterPoints,
  listSubgraphs,
  pointScatterInBounds,
  projectToPlane,
  registerSubgraph,
  setAttribute,
  standardNode,
} from "../index.js";
import { CliUsageError } from "./args.js";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, runCli } from "./index.js";
import type { CliIo } from "./io.js";
import { WRAPPER_NODE_ID, WRAPPER_SEED, buildWrapperGraph, parseParamValue } from "./primitiveRun.js";

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

/** Test-only: re-emits whatever reaches its input pin, so a bound value item is observable. */
const passThrough = standardNode<Record<string, never>>({
  type: "cliRunTestPassThrough",
  description: "Test-only node: re-emits every item that reaches its input pin, unchanged.",
  inputs: [{ name: "in", kind: "any" }],
  outputs: [{ name: "out", kind: "any" }],
  params: {},
  execute({ inputs }) {
    return { out: inputs.in ?? [] };
  },
});

/**
 * A primitive covering one param of every command-line-settable schema
 * type: i32 with a bound, vec3 (field-capable), f32 (field-capable),
 * string, enum, stringList, bool.
 */
function registerScatter(): void {
  const inner = new Graph(11);
  const scatter = inner.add(
    pointScatterInBounds,
    { count: 8, boundsMin: [0, 0, 0], boundsMax: [4, 0, 4], seed: 1 },
    "scatter",
  );
  const jit = inner.add(jitterPoints, { amount: [0.1, 0, 0.1], seed: 2 }, "jit");
  const h = inner.add(
    setAttribute,
    { name: "height", domain: "point", type: "f32", value: 1 },
    "h",
  );
  const s = inner.add(
    setAttribute,
    { name: "species", domain: "point", type: "string", values: ["oak", "pine"] },
    "s",
  );
  const flat = inner.add(projectToPlane, { keepOffset: false }, "flat");
  inner.connect(scatter, "out", jit, "in");
  inner.connect(jit, "out", h, "in");
  inner.connect(h, "out", s, "in");
  inner.connect(s, "out", flat, "in");
  inner.setMeta({ title: "Scatter", description: "Scatter, jitter, label, flatten." });
  registerSubgraph("test/scatter", {
    graph: inner,
    outputs: [{ name: "points", node: flat, pin: "out" }],
    params: [
      { name: "count", targets: [{ node: scatter, param: "count" }], description: "How many points." },
      { name: "amount", targets: [{ node: jit, param: "amount" }], description: "Jitter, per axis." },
      { name: "height", targets: [{ node: h, param: "value" }], description: "Height value." },
      { name: "attrName", targets: [{ node: h, param: "name" }], description: "Attribute name." },
      { name: "domain", targets: [{ node: h, param: "domain" }], description: "Attribute domain." },
      { name: "labels", targets: [{ node: s, param: "values" }], description: "Species labels." },
      {
        name: "keepOffset",
        targets: [{ node: flat, param: "keepOffset" }],
        description: "Record the pre-projection offset.",
      },
    ],
  });
}

/** A primitive with an exposed INPUT pin, so `--in` has somewhere to bind. */
function registerPassThrough(): void {
  const inner = new Graph(3);
  const pass = inner.add(passThrough, {}, "pass");
  registerSubgraph("test/passthrough", {
    graph: inner,
    inputs: [{ name: "values", node: pass, pin: "in" }],
    outputs: [{ name: "out", node: pass, pin: "out" }],
  });
}

/** A primitive with no exposed outputs at all. */
function registerSilent(): void {
  const inner = new Graph(5);
  inner.add(pointScatterInBounds, { count: 2 }, "scatter");
  registerSubgraph("test/silent", { graph: inner });
}

registerScatter();
registerPassThrough();
registerSilent();

async function run(argv: readonly string[], files: Record<string, string> = {}): Promise<{
  code: number;
  out: string;
  err: string;
  io: FakeIo;
}> {
  const io = fakeIo(files);
  const code = await runCli(argv, io.io);
  return { code, out: io.stdout(), err: io.stderr(), io };
}

/** The JSON report of a successful run. */
async function runJson(argv: readonly string[], files: Record<string, string> = {}): Promise<
  Record<string, unknown>
> {
  const r = await run([...argv, "--json"], files);
  expect(r.err, r.err).toBe("");
  expect(r.code).toBe(EXIT_OK);
  return JSON.parse(r.out) as Record<string, unknown>;
}

describe("pcg run — the synthesized wrapper", () => {
  it("is the hand-written ref graph, node id and seed included", () => {
    expect(WRAPPER_NODE_ID).toBe("main");
    expect(WRAPPER_SEED).toBe(0);
    expect(
      buildWrapperGraph({
        name: "test/scatter",
        boundInputs: [],
        outputs: ["points"],
        params: { count: 5 },
      }),
    ).toEqual({
      formatVersion: 1,
      seed: 0,
      nodes: [{ id: "main", type: "subgraph", params: { count: 5 }, ref: { name: "test/scatter" } }],
      connections: [],
      outputs: [{ id: "main", pin: "points", name: "points" }],
    });
  });

  it("wires a dataInput per bound pin, and only per bound pin", () => {
    const wrapper = buildWrapperGraph({
      name: "test/passthrough",
      boundInputs: ["values"],
      outputs: ["out"],
      params: {},
    });
    expect(wrapper.nodes.map((n) => n.id)).toEqual(["main", "in_values"]);
    expect(wrapper.nodes[1]).toEqual({ id: "in_values", type: "dataInput", params: { items: [] } });
    expect(wrapper.connections).toEqual([{ from: ["in_values", "out"], to: ["main", "values"] }]);
  });

  it("cooks byte-identically to the same graph written by hand", async () => {
    const byName = await runJson(["run", "test/scatter", "--param", "count=6"]);
    // Spelled out rather than produced by buildWrapperGraph: a comparison
    // against the generator's own output would agree with itself whatever
    // the generator did, which is exactly the tautology this test exists
    // to avoid. Changing the wrapper's node id or seed must break this.
    const handWritten = JSON.stringify({
      formatVersion: 1,
      seed: 0,
      nodes: [
        { id: "main", type: "subgraph", params: { count: 6 }, ref: { name: "test/scatter" } },
      ],
      connections: [],
      outputs: [{ id: "main", pin: "points", name: "points" }],
    });
    const byFile = await runJson(["cook", "g.json"], { "g.json": handWritten });
    // Asserted first, so a comparison of two empty reports cannot pass as
    // agreement: 6 points must actually have come out of both.
    const points = (byName.outputs as { points: { geometry: { points: number } }[] }).points;
    expect(points).toHaveLength(1);
    expect(points[0].geometry.points).toBe(6);
    expect(byName.outputs).toEqual(byFile.outputs);
    expect(byName.stats).toMatchObject({ cooked: (byFile.stats as { cooked: number }).cooked });
    expect((byName.stats as { cooked: number }).cooked).toBeGreaterThan(0);
    expect(byName.seed).toBe(byFile.seed);
  });
});

describe("pcg run — --param typing", () => {
  it("types each value from the param's own schema", async () => {
    const report = await runJson([
      "run",
      "test/scatter",
      "--param",
      "count=6",
      "--param",
      "amount=0.5,0,0.25",
      "--param",
      "attrName=elevation",
      "--param",
      "domain=point",
      "--param",
      "labels=oak,pine,birch",
      "--param",
      "keepOffset=true",
      "--param",
      "height=2.5",
    ]);
    expect(report.params).toEqual({
      count: 6,
      amount: [0.5, 0, 0.25],
      attrName: "elevation",
      domain: "point",
      labels: ["oak", "pine", "birch"],
      keepOffset: true,
      height: 2.5,
    });
  });

  it("accepts a vec as a JSON array or as one broadcast scalar", async () => {
    const asJson = await runJson(["run", "test/scatter", "--param", "amount=[1,0,2]"]);
    expect((asJson.params as { amount: number[] }).amount).toEqual([1, 0, 2]);
    const broadcast = await runJson(["run", "test/scatter", "--param", "amount=0.25"]);
    expect((broadcast.params as { amount: number[] }).amount).toEqual([0.25, 0.25, 0.25]);
  });

  it("reads a field-valued param as a JSON spec, or from @file.json", async () => {
    const spec = { fn: "perlinNoise", opts: { frequency: 0.3 } };
    const inline = await runJson([
      "run",
      "test/scatter",
      "--param",
      `height=${JSON.stringify(spec)}`,
    ]);
    expect((inline.params as { height: unknown }).height).toMatchObject({ fn: "perlinNoise" });
    const fromFile = await runJson(["run", "test/scatter", "--param", "height=@field.json"], {
      "field.json": JSON.stringify(spec),
    });
    expect(fromFile.params).toEqual(inline.params);
  });

  it("names the param and lists the alternatives on a miss", async () => {
    const enumMiss = await run(["run", "test/scatter", "--param", "domain=pointy"]);
    expect(enumMiss.code).toBe(EXIT_USAGE);
    expect(enumMiss.err).toContain("--param domain=pointy is not one of its values");
    expect(enumMiss.err).toContain("point, vertex, primitive, detail");

    const boolMiss = await run(["run", "test/scatter", "--param", "keepOffset=yes"]);
    expect(boolMiss.code).toBe(EXIT_USAGE);
    expect(boolMiss.err).toContain('expects "true" or "false"');

    const numberMiss = await run(["run", "test/scatter", "--param", "count=lots"]);
    expect(numberMiss.code).toBe(EXIT_USAGE);
    expect(numberMiss.err).toContain("--param count=lots expects an integer");

    const arityMiss = await run(["run", "test/scatter", "--param", "amount=1,2"]);
    expect(arityMiss.code).toBe(EXIT_USAGE);
    expect(arityMiss.err).toContain("expects 3 comma-separated numbers");

    const noEquals = await run(["run", "test/scatter", "--param", "count"]);
    expect(noEquals.code).toBe(EXIT_USAGE);
    expect(noEquals.err).toContain('--param takes an assignment "<param>=<value>"');
  });

  it("lets the deserializer's own bounds check decide, and reports it as misuse", async () => {
    const r = await run(["run", "test/scatter", "--param", "count=-1"]);
    expect(r.code).toBe(EXIT_USAGE);
    // The library's message, verbatim, inside the CLI's frame.
    expect(r.err).toContain("a --param value was rejected");
    expect(r.err).toContain("-1 is below the minimum 0");
  });

  it("refuses an unknown param name, listing what the primitive exposes", async () => {
    const r = await run(["run", "test/scatter", "--param", "cont=6"]);
    // A named thing that does not exist — exit 1, like an unknown node type.
    expect(r.code).toBe(EXIT_FAILURE);
    expect(r.err).toContain('unknown param "cont" on primitive "test/scatter"');
    expect(r.err).toContain("count, amount, height, attrName, domain, labels, keepOffset");
  });

  it("refuses the same param twice rather than silently taking the last", async () => {
    const r = await run(["run", "test/scatter", "--param", "count=1", "--param", "count=2"]);
    expect(r.code).toBe(EXIT_USAGE);
    expect(r.err).toContain("--param count was given more than once");
  });

  it("refuses an items param from the command line and points at --in", () => {
    const io = fakeIo().io;
    const schema: ParamSchema = { type: "items", default: [], description: "Items." };
    expect(() => parseParamValue(io, "feed", schema, "[]")).toThrow(CliUsageError);
    expect(() => parseParamValue(io, "feed", schema, "[]")).toThrow(
      "it is an item list (live DataItems), and text cannot spell one",
    );
    expect(() => parseParamValue(io, "feed", schema, "[]")).toThrow("--in <data.json>");
  });

  it("types u32 and vec4, which no test primitive happens to expose", () => {
    const io = fakeIo().io;
    const u32: ParamSchema = { type: "u32", default: 0, description: "A count." };
    expect(parseParamValue(io, "n", u32, "12")).toBe(12);
    expect(() => parseParamValue(io, "n", u32, "0x10")).toThrow(
      "expects a non-negative integer",
    );
    const vec4: ParamSchema = { type: "vec4", default: [0, 0, 0, 1], description: "A rotation." };
    expect(parseParamValue(io, "rot", vec4, "0,0,0,1")).toEqual([0, 0, 0, 1]);
    expect(parseParamValue(io, "rot", vec4, "2")).toEqual([2, 2, 2, 2]);
    expect(() => parseParamValue(io, "rot", vec4, "1,2,3")).toThrow("expects 4 comma-separated");
  });

  it("does not read @ or { as anything special on a plain string param", () => {
    const io = fakeIo().io;
    const schema: ParamSchema = { type: "string", default: "", description: "A name." };
    expect(parseParamValue(io, "attrName", schema, "@home")).toBe("@home");
    expect(parseParamValue(io, "attrName", schema, '{"fn":"x"}')).toBe('{"fn":"x"}');
  });
});

describe("pcg run — --in data.json", () => {
  it("binds value items to an exposed input pin", async () => {
    const report = await runJson(
      ["run", "test/passthrough", "--in", "data.json"],
      {
        "data.json": JSON.stringify({
          values: [
            { kind: "value", value: 3.5, tags: ["seedling"] },
            { kind: "value", value: "oak" },
          ],
        }),
      },
    );
    expect(report.inputs).toEqual([{ pin: "values", items: 2 }]);
    const outputs = report.outputs as Record<string, { kind: string; value?: unknown }[]>;
    expect(outputs.out.map((i) => i.kind)).toEqual(["value", "value"]);
    expect(outputs.out.map((i) => i.value)).toEqual([3.5, "oak"]);
  });

  it("refuses a geometry item, naming the limitation and the way round it", async () => {
    const r = await run(["run", "test/passthrough", "--in", "data.json"], {
      "data.json": JSON.stringify({ values: [{ kind: "geometry", value: 1 }] }),
    });
    expect(r.code).toBe(EXIT_FAILURE);
    expect(r.err).toContain("asks for a geometry item");
    expect(r.err).toContain("geometry has no JSON representation in this format");
    expect(r.err).toContain("pointScatterInBounds");
  });

  it("refuses an instances item for the same reason", async () => {
    const r = await run(["run", "test/passthrough", "--in", "data.json"], {
      "data.json": JSON.stringify({ values: [{ kind: "instances" }] }),
    });
    expect(r.code).toBe(EXIT_FAILURE);
    expect(r.err).toContain("asks for a instances item");
  });

  it("refuses a key that is not an exposed input pin", async () => {
    const r = await run(["run", "test/passthrough", "--in", "data.json"], {
      "data.json": JSON.stringify({ valuez: [] }),
    });
    expect(r.code).toBe(EXIT_FAILURE);
    expect(r.err).toContain('key "valuez" is not an exposed input pin');
    expect(r.err).toContain("its input pins: values");
  });

  it("refuses --in when the primitive takes no incoming data", async () => {
    const r = await run(["run", "test/scatter", "--in", "data.json"], {
      "data.json": JSON.stringify({ points: [] }),
    });
    expect(r.code).toBe(EXIT_FAILURE);
    expect(r.err).toContain("exposes no input pins");
  });

  it("names the file on an unreadable path, malformed JSON, or a malformed item", async () => {
    const missing = await run(["run", "test/passthrough", "--in", "nope.json"]);
    expect(missing.code).toBe(EXIT_FAILURE);
    expect(missing.err).toContain('cannot read --in file "nope.json"');

    const notJson = await run(["run", "test/passthrough", "--in", "data.json"], {
      "data.json": "{",
    });
    expect(notJson.code).toBe(EXIT_FAILURE);
    expect(notJson.err).toContain('--in "data.json" is not valid JSON');

    const badKey = await run(["run", "test/passthrough", "--in", "data.json"], {
      "data.json": JSON.stringify({ values: [{ kind: "value", value: 1, tag: ["x"] }] }),
    });
    expect(badKey.code).toBe(EXIT_FAILURE);
    expect(badKey.err).toContain('unknown key "tag"');

    const badValue = await run(["run", "test/passthrough", "--in", "data.json"], {
      "data.json": JSON.stringify({ values: [{ kind: "value", value: { a: 1 } }] }),
    });
    expect(badValue.code).toBe(EXIT_FAILURE);
    expect(badValue.err).toContain('"value" must be a number');
  });
});

describe("pcg run — reporting and exit codes", () => {
  it("reports the primitive, its content hash and the cook stats", async () => {
    const r = await run(["run", "test/scatter", "--param", "count=4", "--stats"]);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toMatch(/^ran "test\/scatter" #[0-9a-f]{16} \(seed 0\)\n/);
    expect(r.out).toContain("cooked");
    expect(r.out).toContain("params:");
    expect(r.out).toContain("outputs:");
    expect(r.out).toContain("per-node:");
  });

  it("honours --seed and says the seed it actually ran", async () => {
    const zero = await runJson(["run", "test/scatter", "--param", "count=4"]);
    const seeded = await runJson(["run", "test/scatter", "--param", "count=4", "--seed", "9"]);
    expect(zero.seed).toBe(0);
    expect(seeded.seed).toBe(9);
    expect(seeded.outputs).not.toEqual(zero.outputs);
    const text = await run(["run", "test/scatter", "--seed", "9"]);
    expect(text.out).toContain("(seed override 9)");
  });

  it("writes the JSON report with --out", async () => {
    const r = await run(["run", "test/scatter", "--out", "report.json"]);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("wrote report.json");
    const written = JSON.parse(r.io.files["report.json"]) as { primitive: string };
    expect(written.primitive).toBe("test/scatter");
  });

  it("exits 1 on an unknown primitive, with the registry's own list", async () => {
    const r = await run(["run", "test/scater"]);
    expect(r.code).toBe(EXIT_FAILURE);
    expect(r.err).toContain('unknown subgraph "test/scater"');
    expect(r.err).toContain("registered subgraphs: ");
    // The list is sorted, so this file's three sit together in it. It is
    // no longer the WHOLE list: the CLI entry imports the shipped
    // vocabulary, so the real primitives are named here too — which is
    // the point of importing it, and is asserted next.
    expect(r.err).toContain("test/passthrough, test/scatter, test/silent");
  });

  it("cooks a REAL shipped primitive end to end", async () => {
    const r = await run(["run", "shape/disc", "--param", "count=200", "--param", "size=6"]);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain('ran "shape/disc"');
    expect(r.out).toMatch(/points \d+/);
    // Rejection to the disc keeps ~78.5% of the candidates, so the count
    // proves the recipe actually ran rather than passing its input along.
    const points = Number(/points (\d+)/.exec(r.out)?.[1]);
    expect(points).toBeGreaterThan(120);
    expect(points).toBeLessThan(180);
  });

  it("has the shipped vocabulary registered, because the CLI entry imports it", () => {
    // Registration happens by importing the module that declares the
    // primitives. `pcg run <a real primitive>` works only if the CLI does
    // that import, and nothing else in this suite would notice if it
    // stopped — the test primitives above are registered by this file.
    const names = listSubgraphs().map((e) => e.name);
    expect(names).toContain("fill/scatter-even");
    expect(names.filter((n) => n.includes("/") && !n.startsWith("test/")).length).toBeGreaterThan(20);
  });

  it("exits 1 when the primitive exposes nothing to cook", async () => {
    const r = await run(["run", "test/silent"]);
    expect(r.code).toBe(EXIT_FAILURE);
    expect(r.err).toContain('primitive "test/silent" exposes no output pins');
  });

  it("exits 2 on a misuse of the command line", async () => {
    const noName = await run(["run"]);
    expect(noName.code).toBe(EXIT_USAGE);
    expect(noName.err).toContain("missing required argument <name>");

    const unknownFlag = await run(["run", "test/scatter", "--parm", "count=1"]);
    expect(unknownFlag.code).toBe(EXIT_USAGE);
    expect(unknownFlag.err).toContain('unknown flag "--parm"');

    // --param repeats; every other flag still refuses to.
    const repeatedSeed = await run(["run", "test/scatter", "--seed", "1", "--seed", "2"]);
    expect(repeatedSeed.code).toBe(EXIT_USAGE);
    expect(repeatedSeed.err).toContain('flag "--seed" was given more than once');
  });

  it("prints its own help, marking --param repeatable", async () => {
    const r = await run(["run", "--help"]);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("pcg run <name> [flags]");
    expect(r.out).toContain("(repeatable)");
    expect(r.out).toContain("--in <data.json>");
  });

  it("is listed in the top-level help", async () => {
    const r = await run(["--help"]);
    expect(r.out).toContain("pcg run <name> [flags]");
  });
});
