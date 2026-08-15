/**
 * The `pcg` subcommands. Each one produces both a text rendering and a
 * machine-readable object; `--json` chooses between them, so the human
 * and the agent read the same run, never two different code paths.
 */
import {
  type CookOptions,
  DOMAINS,
  type DataItem,
  type Domain,
  type Graph,
  type NodeDoneInfo,
  type NodeTypeInfo,
  type ParamSchema,
  cook,
  describeSubgraphParams,
  deserializeGraph,
  getNodeType,
  getRegisteredSubgraph,
  listFieldFnInfos,
  listNodeTypes,
} from "../index.js";
import {
  type CommandSpec,
  CliUsageError,
  type ParsedArgs,
  boolFlag,
  intFlag,
  listFlag,
  numberFlag,
  stringFlag,
} from "./args.js";
import { CliError } from "./errors.js";
import { fmtMs, fmtStat, plural, table } from "./format.js";
import { type TargetOptions, cookTarget, loadGraph } from "./graphSource.js";
import type { CliIo } from "./io.js";
import {
  WRAPPER_NODE_ID,
  buildWrapperGraph,
  inputNodeId,
  parseParamAssignments,
  readInputBindings,
} from "./primitiveRun.js";
import { type ColorDomain, renderSvg } from "./render.js";
import {
  type AttrStats,
  type ItemSummary,
  attrListText,
  itemLine,
  sampleRows,
  summarizeItem,
} from "./summary.js";

/** What a command produced: one text rendering, one JSON rendering. */
export interface CommandOutcome {
  readonly text: string;
  readonly json: unknown;
}

/** A subcommand: its declared surface plus its implementation. */
export interface Command {
  readonly spec: CommandSpec;
  run(args: ParsedArgs, io: CliIo): Promise<CommandOutcome>;
}

const GRAPH_ARG = {
  name: "graph.json",
  required: true,
  description: "path to a serialized graph (formatVersion 1)",
} as const;

const SEED_FLAG = {
  kind: "number",
  value: "n",
  description: "override the graph seed before cooking",
} as const;

const BUDGET_FLAG = {
  kind: "number",
  value: "ms",
  description: "soft per-pass time budget in milliseconds (CookOptions.budgetMs)",
} as const;

const TARGET_FLAGS = {
  node: { kind: "string", value: "id", description: "read a node's output pin instead of a declared output" },
  pin: { kind: "string", value: "name", description: "output pin on --node (default: its first output pin)" },
  output: { kind: "string", value: "name", description: "read one declared output (default: all of them)" },
} as const;

/**
 * Which data the shared `--node`/`--pin`/`--output` flags select.
 * Combinations that would silently ignore one of them are refused
 * instead: a flag that does nothing is a misunderstanding worth hearing
 * about immediately.
 */
function targetOptions(args: ParsedArgs, command: string): TargetOptions {
  const node = stringFlag(args, "node");
  const pin = stringFlag(args, "pin");
  const output = stringFlag(args, "output");
  if (node !== undefined && output !== undefined) {
    throw new CliUsageError(
      `${command}: --node and --output select different sources; pass one of them, not both`,
    );
  }
  if (pin !== undefined && node === undefined) {
    throw new CliUsageError(
      `${command}: --pin names an output pin on --node, so it needs --node <id>; to read a declared output use --output <name>`,
    );
  }
  return {
    ...(node !== undefined ? { node } : {}),
    ...(pin !== undefined ? { pin } : {}),
    ...(output !== undefined ? { output } : {}),
  };
}

/**
 * Cook options from the shared `--budget` flag. A rejected flag VALUE is
 * a misuse of the command line, exactly like `--width 0`, so it raises
 * the usage error and exits 2 — a caller branching on the exit code must
 * be able to tell "your flag is wrong" from "your graph is broken".
 */
function cookOptions(args: ParsedArgs, command: string): CookOptions {
  const budgetMs = numberFlag(args, "budget");
  // 0 is ALLOWED and meaningful: every budget check in the executor is
  // `budgetMs !== undefined`, never a truthiness test, so 0 yields after
  // every node — maximum partitioning. That is the partition-safety
  // check `skills/performance-and-budgets` tells authors to run, and
  // rejecting it here made the documented check impossible from the CLI
  // while the cook() API accepted it. Negative and NaN are still misuse.
  if (budgetMs !== undefined && !(budgetMs >= 0)) {
    throw new CliUsageError(
      `${command}: flag "--budget" expects a non-negative number of milliseconds, got ${budgetMs}. Use --budget 0 to yield after every node (maximum partitioning), which is how you check a graph cooks identically however the work is split.`,
    );
  }
  return budgetMs === undefined ? {} : { budgetMs };
}

/**
 * The seed the graph will cook with. `Graph.setSeed` stores `seed >>> 0`,
 * so anything outside the 32-bit range would cook with a different number
 * than the one typed; the flag is range-checked instead of truncated, and
 * the caller reports `graph.seed` rather than the raw flag so the text and
 * the JSON always name the seed that actually ran.
 */
function applySeed(
  args: ParsedArgs,
  command: string,
  graph: { setSeed(n: number): void },
): number | undefined {
  const seed = intFlag(args, "seed", command, { min: 0, max: 0xffffffff });
  if (seed !== undefined) graph.setSeed(seed);
  return seed;
}

// ---------------------------------------------------------------------------
// nodes
// ---------------------------------------------------------------------------

function paramRow(name: string, schema: ParamSchema): string[] {
  // `acceptsInfinite` widens what the param admits, so it reads as part of
  // the range — same placement `docs/nodes.md` gives it, because an agent
  // reading this catalog and one reading that one must not be told
  // different things about the same param.
  const infinite = schema.acceptsInfinite === true ? " (±Infinity ok)" : "";
  const range =
    schema.min !== undefined && schema.max !== undefined
      ? `${schema.min}..${schema.max}${infinite}`
      : schema.min !== undefined
        ? `>= ${schema.min}${infinite}`
        : schema.max !== undefined
          ? `<= ${schema.max}${infinite}`
          : infinite.trim();
  return [
    name,
    schema.type,
    JSON.stringify(schema.default),
    range,
    schema.enum !== undefined ? schema.enum.join("|") : "",
    schema.acceptsField === true ? "field" : "",
    schema.description,
  ];
}

function nodeDetailText(info: NodeTypeInfo): string {
  const pins = (list: readonly { name: string; kind: string; multi: boolean }[]): string =>
    list.length === 0
      ? "(none)"
      : list.map((p) => `${p.name} (${p.kind}${p.multi ? ", multi" : ""})`).join(", ");
  const lines = [
    `${info.type}${info.category !== undefined ? `  [${info.category}]` : ""}`,
    "",
    info.description,
    "",
    `inputs:  ${pins(info.inputs)}`,
    `outputs: ${pins(info.outputs)}`,
    "",
  ];
  const names = Object.keys(info.params);
  if (names.length === 0) {
    lines.push("params:  (none)");
  } else {
    lines.push("params:");
    lines.push(
      ...table([
        ["name", "type", "default", "range", "enum", "field", "description"],
        ...names.map((name) => paramRow(name, info.params[name])),
      ]),
    );
  }
  return lines.join("\n") + "\n";
}

function firstSentence(description: string): string {
  return description.split(". ")[0].replace(/\.$/, "");
}

const nodesCommand: Command = {
  spec: {
    name: "nodes",
    summary:
      "Print the node-type catalog from the registry (listNodeTypes()). With a type, print that type's pins and full param schema.",
    positionals: [
      { name: "type", required: false, description: "a registered node type, e.g. pointScatterInBounds" },
    ],
    flags: {},
  },
  run(args) {
    const wanted = args.positional[0];
    if (wanted !== undefined) {
      // Unknown types raise the registry's own error, which lists every
      // registered type — the CLI must not paraphrase it.
      const info = getNodeType(wanted).info;
      return Promise.resolve({ text: nodeDetailText(info), json: info });
    }
    const types = [...listNodeTypes()].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
    const byCategory = new Map<string, NodeTypeInfo[]>();
    for (const info of types) {
      const key = info.category ?? "(uncategorized)";
      const bucket = byCategory.get(key);
      if (bucket === undefined) byCategory.set(key, [info]);
      else bucket.push(info);
    }
    const categories = [...byCategory.keys()].sort((a, b) =>
      a === "(uncategorized)" ? 1 : b === "(uncategorized)" ? -1 : a < b ? -1 : 1,
    );
    const lines = [`${plural(types.length, "node type")}, by category`, ""];
    for (const category of categories) {
      lines.push(`${category}:`);
      lines.push(
        ...table((byCategory.get(category) as NodeTypeInfo[]).map((i) => [i.type, firstSentence(i.description)])),
      );
      lines.push("");
    }
    lines.push("pcg nodes <type> prints one type's pins and params.");
    return Promise.resolve({ text: lines.join("\n") + "\n", json: types });
  },
};

// ---------------------------------------------------------------------------
// fields
// ---------------------------------------------------------------------------

const fieldsCommand: Command = {
  spec: {
    name: "fields",
    summary:
      "Print the field-expression catalog: every `fn` a field-valued param accepts in JSON, with its allowed keys and usage.",
    positionals: [{ name: "fn", required: false, description: "a field constructor, e.g. perlinNoise" }],
    flags: {},
  },
  run(args) {
    const infos = listFieldFnInfos();
    const wanted = args.positional[0];
    if (wanted !== undefined) {
      const info = infos.find((i) => i.fn === wanted);
      if (info === undefined) {
        throw new CliError(
          `unknown field fn "${wanted}"; valid fns: ${infos.map((i) => i.fn).join(", ")}`,
        );
      }
      const text = [
        info.fn,
        "",
        `keys:  ${info.keys.length === 0 ? "(none besides fn)" : info.keys.join(", ")}`,
        `usage: ${info.usage}`,
        "",
      ].join("\n");
      return Promise.resolve({ text, json: info });
    }
    const lines = [`${plural(infos.length, "field fn")}`, ""];
    lines.push(...table(infos.map((i) => [i.fn, i.usage])));
    lines.push("");
    lines.push("pcg fields <fn> prints one constructor's keys and usage.");
    return Promise.resolve({ text: lines.join("\n") + "\n", json: infos });
  },
};

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

const validateCommand: Command = {
  spec: {
    name: "validate",
    summary:
      "Deserialize a graph file and report its structure. Exits nonzero with the library's own message when the graph is invalid.",
    positionals: [GRAPH_ARG],
    flags: {},
  },
  run(args, io) {
    const { graph, path } = loadGraph(io, args.positional[0]);
    const description = graph.describe();
    const meta = graph.meta;
    const nodes = description.nodes.map((n) => ({ id: n.id, type: n.defType ?? "(unregistered)" }));
    const lines = [
      `ok  ${path}`,
      `seed ${graph.seed}  ${plural(nodes.length, "node")}  ${plural(
        description.connections.length,
        "connection",
      )}  ${plural(description.outputs.length, "output")}`,
    ];
    if (meta !== undefined) {
      lines.push("");
      if (meta.title !== undefined) lines.push(`title:       ${meta.title}`);
      if (meta.description !== undefined) lines.push(`description: ${meta.description}`);
      if (meta.tags !== undefined) lines.push(`tags:        ${meta.tags.join(", ")}`);
    }
    lines.push("", "nodes:");
    lines.push(...table(nodes.map((n) => [n.id, n.type])));
    lines.push("", "outputs:");
    lines.push(
      ...(description.outputs.length === 0
        ? ["  (none declared — nothing to cook without --node)"]
        : table(description.outputs.map((o) => [o.name, `<- ${o.id}.${o.pin}`]))),
    );
    return Promise.resolve({
      text: lines.join("\n") + "\n",
      json: {
        ok: true,
        path,
        seed: graph.seed,
        ...(meta !== undefined ? { meta } : {}),
        nodes,
        connections: description.connections.map((c) => ({ from: c.from, to: c.to })),
        outputs: description.outputs.map((o) => ({ name: o.name, node: o.id, pin: o.pin })),
      },
    });
  },
};

// ---------------------------------------------------------------------------
// cook
// ---------------------------------------------------------------------------

const cookCommand: Command = {
  spec: {
    name: "cook",
    summary:
      "Cook every declared output headless and report what came out. --stats adds the per-node breakdown (cooked vs served from cache).",
    positionals: [GRAPH_ARG],
    flags: {
      seed: SEED_FLAG,
      budget: BUDGET_FLAG,
      stats: { kind: "boolean", description: "print per-node cook stats" },
      out: { kind: "string", value: "file", description: "write the JSON report to a file" },
    },
  },
  async run(args, io) {
    const { graph, path } = loadGraph(io, args.positional[0]);
    const seed = applySeed(args, "cook", graph);
    const declared = graph.describe().outputs;
    if (declared.length === 0) {
      throw new CliError(
        `"${path}" declares no outputs, so cooking it produces nothing; declare one in the JSON ("outputs": [...]) or inspect a node directly with: pcg inspect ${path} --node <id>`,
      );
    }
    const perNode: NodeDoneInfo[] = [];
    const result = await cook(graph, {
      ...cookOptions(args, "cook"),
      onNodeDone: (info) => perNode.push(info),
    });

    const outputs: Record<string, ItemSummary[]> = {};
    for (const name of Object.keys(result.outputs)) {
      outputs[name] = [...result.outputs[name]].map(summarizeItem);
    }
    const outPath = stringFlag(args, "out");
    const json = {
      path,
      seed: graph.seed,
      out: outPath ?? null,
      stats: {
        cooked: result.stats.cooked,
        cached: result.stats.cached,
        elapsedMs: result.stats.elapsedMs,
      },
      nodes: perNode.map((n) => ({
        id: n.id,
        type: n.type,
        cached: n.cached,
        elapsedMs: n.elapsedMs,
      })),
      outputs,
    };

    const lines = [
      `cooked ${path}${seed !== undefined ? ` (seed override ${graph.seed})` : ` (seed ${graph.seed})`}`,
      `${result.stats.cooked} cooked, ${result.stats.cached} cached, ${fmtMs(result.stats.elapsedMs)}`,
      "",
      "outputs:",
    ];
    for (const name of Object.keys(outputs)) {
      lines.push(`  ${name} (${plural(outputs[name].length, "item")})`);
      outputs[name].forEach((item, i) => lines.push(`    [${i}] ${itemLine(item)}`));
    }
    if (boolFlag(args, "stats")) {
      lines.push("", "per-node:");
      lines.push(
        ...table([
          ["id", "type", "state", "elapsed"],
          ...perNode.map((n) => [n.id, n.type, n.cached ? "cached" : "cooked", fmtMs(n.elapsedMs)]),
        ]),
      );
    }
    if (outPath !== undefined) {
      io.writeFile(outPath, JSON.stringify(json, null, 2) + "\n");
      lines.push("", `wrote ${outPath}`);
    }
    return { text: lines.join("\n") + "\n", json };
  },
};

// ---------------------------------------------------------------------------
// inspect
// ---------------------------------------------------------------------------

/**
 * Per-attribute statistics as text. Numeric and string columns get
 * separate tables because they have nothing to line up under: the table
 * is documented as greppable by column position, and a distinct-value
 * count printed beneath a `min` header is a lie an agent reading column 4
 * will believe.
 *
 * `non-finite` is a column here and not only in `--json`. Min/max/mean
 * exclude non-finite slots, so a column holding `+Infinity` reports a
 * maximum that is wrong rather than absent — "did this node emit NaN?" is
 * the first question of the authoring loop and the text has to answer it.
 */
function attrTables(attrs: readonly AttrStats[]): string[] {
  const lines: string[] = [];
  const numeric = attrs.filter((a) => a.type !== "string");
  const strings = attrs.filter((a) => a.type === "string");
  if (numeric.length > 0) {
    lines.push(
      ...table(
        [
          ["attr", "type", "tuple", "min", "max", "mean", "non-finite"],
          ...numeric.map((a) => [
            a.name,
            a.type,
            String(a.tupleSize),
            a.min !== undefined ? a.min.map(fmtStat).join(",") : "",
            a.max !== undefined ? a.max.map(fmtStat).join(",") : "",
            a.mean !== undefined ? a.mean.map(fmtStat).join(",") : "",
            String(a.nonFinite ?? 0),
          ]),
        ],
        "    ",
      ),
    );
  }
  if (strings.length > 0) {
    lines.push(
      ...table(
        [
          ["attr", "type", "tuple", "distinct", "values"],
          ...strings.map((a) => {
            const values = a.values ?? [];
            const distinct = a.distinct ?? values.length;
            const shown = values.map((v) => JSON.stringify(v));
            // The list is capped; without saying so, a 20-value column
            // reads as a 8-value one.
            if (distinct > values.length) shown.push(`(+${distinct - values.length} more)`);
            return [a.name, a.type, String(a.tupleSize), String(distinct), shown.join(" ")];
          }),
        ],
        "    ",
      ),
    );
  }
  return lines;
}

const inspectCommand: Command = {
  spec: {
    name: "inspect",
    summary:
      "Cook one node's output pin (or a declared output) and report element counts per domain, attribute statistics, bounds, and the first sample rows.",
    positionals: [GRAPH_ARG],
    flags: {
      ...TARGET_FLAGS,
      seed: SEED_FLAG,
      budget: BUDGET_FLAG,
      rows: { kind: "number", value: "k", description: "sample rows to print (default 5)" },
      domain: {
        kind: "string",
        value: "name",
        description: "domain to sample rows from: point, vertex, primitive, detail (default point)",
      },
    },
  },
  async run(args, io) {
    const { graph, path } = loadGraph(io, args.positional[0]);
    applySeed(args, "inspect", graph);
    const rows = intFlag(args, "rows", "inspect", { min: 0 }) ?? 5;
    const domainName = stringFlag(args, "domain") ?? "point";
    if (!(DOMAINS as readonly string[]).includes(domainName)) {
      throw new CliUsageError(
        `inspect: flag "--domain" got unknown domain "${domainName}"; valid domains: ${DOMAINS.join(", ")}`,
      );
    }
    const domain = domainName as Domain;
    const target = await cookTarget(
      graph,
      targetOptions(args, "inspect"),
      cookOptions(args, "inspect"),
    );

    const items = [...target.collection];
    const summaries = items.map(summarizeItem);
    const lines = [
      `${path} — ${target.label}`,
      `${plural(items.length, "item")}, cooked ${target.result.stats.cooked}, cached ${target.result.stats.cached}`,
    ];
    const sampled: unknown[] = [];
    summaries.forEach((summary, i) => {
      lines.push("", `item ${i}: ${itemLine(summary)}`);
      if (summary.kind !== "geometry") {
        sampled.push(null);
        return;
      }
      for (const domainSummary of summary.geometry.domains) {
        // A domain with no attributes says nothing the item line has not
        // already said (its element count), so it is left out.
        if (domainSummary.attrs.length === 0) continue;
        lines.push(
          `  ${domainSummary.domain} — ${plural(domainSummary.count, "element")}: ${attrListText(domainSummary.attrs)}`,
        );
        lines.push(...attrTables(domainSummary.attrs));
      }
      const item = items[i];
      if (item.kind !== "geometry") return;
      const sample = sampleRows(item.geo, domain, rows);
      sampled.push(sample);
      if (sample.rows.length > 0) {
        lines.push(`  first ${sample.rows.length} of ${sample.total} ${domain} rows:`);
        lines.push(...table([sample.columns as string[], ...sample.rows.map((r) => [...r])], "    "));
      } else if (rows === 0) {
        lines.push(`  ${domain} rows not sampled (--rows 0; ${plural(sample.total, "element")})`);
      } else {
        lines.push(`  no ${domain} rows to sample (${plural(sample.total, "element")})`);
      }
    });

    return {
      text: lines.join("\n") + "\n",
      json: {
        path,
        target: target.label,
        stats: {
          cooked: target.result.stats.cooked,
          cached: target.result.stats.cached,
          elapsedMs: target.result.stats.elapsedMs,
        },
        domain,
        items: summaries.map((summary, i) => ({ ...summary, sample: sampled[i] })),
      },
    };
  },
};

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

/** The domains `render --attr` can take color from, and their marks. */
const COLOR_DOMAINS: readonly ColorDomain[] = ["point", "primitive"];

/** Where a render's colors came from, named by domain and by mark. */
function colorSourceText(domains: readonly ColorDomain[]): string {
  const parts = domains.map((d) =>
    d === "point" ? "point values on the circles" : "primitive values on the paths",
  );
  return parts.length === 0 ? "nothing colored" : parts.join(", ");
}

const renderCommand: Command = {
  spec: {
    name: "render",
    summary:
      "Draw a cooked collection as a deterministic top-down SVG (points as circles, polylines as paths). Without --out the SVG goes to stdout.",
    positionals: [GRAPH_ARG],
    flags: {
      ...TARGET_FLAGS,
      seed: SEED_FLAG,
      budget: BUDGET_FLAG,
      out: { kind: "string", value: "file.svg", description: "write the SVG to a file" },
      width: { kind: "number", value: "px", description: "image width in pixels (default 800)" },
      attr: {
        kind: "string",
        value: "name",
        description:
          "attribute to color by: scalar ramp, vec3+ as RGB, strings categorical. Point attributes color the circles, primitive attributes color the paths; a name on both colors both",
      },
      "attr-domain": {
        kind: "string",
        value: "point|primitive",
        description: "read --attr from one domain only, instead of from both",
      },
      radius: { kind: "number", value: "px", description: "point radius in pixels (default 1.5)" },
      "max-points": {
        kind: "number",
        value: "n",
        description: "drawn-circle cap across the whole collection, points and instances (default 50000)",
      },
      "max-primitives": {
        kind: "number",
        value: "n",
        description: "drawn-primitive cap across the whole collection (default 20000)",
      },
    },
  },
  async run(args, io) {
    const outPath = stringFlag(args, "out");
    if (outPath === undefined && boolFlag(args, "json")) {
      throw new CliUsageError(
        "render: --json needs --out <file.svg>, because without it the SVG itself is the output",
      );
    }
    const { graph, path } = loadGraph(io, args.positional[0]);
    applySeed(args, "render", graph);
    const target = await cookTarget(
      graph,
      targetOptions(args, "render"),
      cookOptions(args, "render"),
    );
    const width = intFlag(args, "width", "render", { min: 1 });
    const attr = stringFlag(args, "attr");
    const attrDomainName = stringFlag(args, "attr-domain");
    if (attrDomainName !== undefined && !(COLOR_DOMAINS as readonly string[]).includes(attrDomainName)) {
      throw new CliUsageError(
        `render: flag "--attr-domain" got "${attrDomainName}"; valid domains: ${COLOR_DOMAINS.join(", ")} — circles are colored from the point domain and paths from the primitive domain, so vertex and detail have no mark to color`,
      );
    }
    if (attrDomainName !== undefined && attr === undefined) {
      throw new CliUsageError(
        'render: --attr-domain narrows which domain --attr is read from, so it needs --attr <name>; drop it to color from both domains',
      );
    }
    const radius = numberFlag(args, "radius");
    if (radius !== undefined && !(radius > 0)) {
      throw new CliUsageError(
        `render: flag "--radius" expects a number greater than 0 (pixels), got ${radius}`,
      );
    }
    const maxPoints = intFlag(args, "max-points", "render", { min: 1 });
    const maxPrimitives = intFlag(args, "max-primitives", "render", { min: 1 });
    const result = renderSvg(target.collection, {
      ...(width !== undefined ? { width } : {}),
      ...(attr !== undefined ? { attr } : {}),
      ...(attrDomainName !== undefined ? { attrDomain: attrDomainName as ColorDomain } : {}),
      ...(radius !== undefined ? { radius } : {}),
      ...(maxPoints !== undefined ? { maxPoints } : {}),
      ...(maxPrimitives !== undefined ? { maxPrimitives } : {}),
    });
    const json = {
      path,
      target: target.label,
      out: outPath ?? null,
      width: result.width,
      height: result.height,
      points: result.points,
      pointsTotal: result.pointsTotal,
      primitives: result.primitives,
      primitivesTotal: result.primitivesTotal,
      instances: result.instances,
      instancesTotal: result.instancesTotal,
      deviceInstances: result.deviceInstances,
      skipped: result.skipped,
      ...(result.colorAttr !== undefined
        ? { colorAttr: result.colorAttr, colorDomains: result.colorDomains ?? [] }
        : {}),
      ...(result.bounds !== undefined ? { bounds: result.bounds } : {}),
    };
    if (outPath === undefined) return { text: result.svg, json };
    io.writeFile(outPath, result.svg);
    const truncated =
      result.points < result.pointsTotal ||
      result.primitives < result.primitivesTotal ||
      result.instances < result.instancesTotal;
    const text = [
      `wrote ${outPath}  ${result.width}x${result.height}`,
      `${path} — ${target.label}`,
      `${result.points} of ${result.pointsTotal} points, ${result.primitives} of ${result.primitivesTotal} primitives, ${result.instances} of ${result.instancesTotal} instances${
        result.skipped > 0 ? `, ${result.skipped} skipped (non-finite)` : ""
      }${truncated ? " — capped, raise --max-points/--max-primitives to draw the rest" : ""}`,
      // Never silently: a device-resident batch has no CPU transforms to
      // draw, and a blank frame reporting "0 instances" is exactly the
      // failure the throwing `batches` accessor exists to prevent.
      ...(result.deviceInstances > 0
        ? [
            `${plural(result.deviceInstances, "instance")} not drawn: device-resident (transforms live in GPU buffers, never composed on the CPU)`,
          ]
        : []),
      // Never just `colored by "x"`: the same name can live on the points,
      // on the primitives or on both, and a reader who is not told which
      // one this picture came from cannot know what it means.
      ...(result.colorAttr !== undefined
        ? [`colored by "${result.colorAttr}" — ${colorSourceText(result.colorDomains ?? [])}`]
        : []),
      ...(result.bounds !== undefined
        ? [
            `bounds (world) x ${fmtStat(result.bounds.min[0])}..${fmtStat(result.bounds.max[0])}  z ${fmtStat(result.bounds.min[1])}..${fmtStat(result.bounds.max[1])}`,
          ]
        : ["nothing drawable in this collection"]),
    ].join("\n");
    return { text: text + "\n", json };
  },
};

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

/**
 * The exposed params of the primitive instance in a synthesized wrapper,
 * read from the live node the way `pcg inspect --node` reads output pins:
 * a subgraph node's real interface is per-instance, so the registry entry
 * for the `subgraph` TYPE declares none and this is the only place it
 * lives.
 */
function exposedParams(graph: Graph): readonly { name: string; schema: ParamSchema }[] {
  const state = graph._nodes.get(WRAPPER_NODE_ID);
  // Unreachable: buildWrapperGraph always emits the node under this id,
  // and deserializeGraph would have thrown otherwise. Narrowing.
  if (state === undefined) throw new CliError(`internal: wrapper node "${WRAPPER_NODE_ID}" is missing`);
  return (describeSubgraphParams(state.def) ?? []).map((p) => ({ name: p.name, schema: p.schema }));
}

const runCommand: Command = {
  spec: {
    name: "run",
    summary:
      "Cook a registered primitive by name, with no graph file: synthesize a one-node wrapper around it, bind --param values and --in items, cook every exposed output and report what came out.",
    positionals: [
      {
        name: "name",
        required: true,
        description: "a registered subgraph name (an unknown one lists what is registered)",
      },
    ],
    flags: {
      param: {
        kind: "strings",
        value: "k=v",
        description:
          "set one exposed param; the value is typed by that param's own schema (numbers, true/false, enum members, vec3 as 1,0,2.5 or [1,0,2.5], a field as JSON or @file.json)",
      },
      in: {
        kind: "string",
        value: "data.json",
        description:
          'bind value items to exposed input pins: { "<pin>": [ { "kind": "value", "value": 3.5 } ] } (value items only — geometry has no JSON form)',
      },
      seed: SEED_FLAG,
      budget: BUDGET_FLAG,
      stats: { kind: "boolean", description: "print per-node cook stats" },
      out: { kind: "string", value: "file", description: "write the JSON report to a file" },
    },
  },
  /**
   * Exit codes follow the CLI's documented split. A name that does not
   * exist — the primitive, or a param on it — is exit 1, the class the
   * top-level help calls "a named thing does not exist". A `--param` value
   * of the wrong shape or out of range is exit 2, like every other flag
   * value the CLI refuses; that includes the ones only the deserializer
   * can catch (bounds, field specs), which is why the second
   * `deserializeGraph` re-raises as a usage error. It can do so safely:
   * the two wrapper graphs differ ONLY in the params object, so a failure
   * that the first one did not hit is a param failure by construction.
   */
  async run(args, io) {
    const name = args.positional[0];
    // The registry's own message, verbatim: it lists every registered
    // name, or explains that none are, and the CLI must not paraphrase it.
    const entry = getRegisteredSubgraph(name);
    const exposedInputs = entry.subgraph.inputs.map((p) => p.name);
    const exposedOutputs = entry.subgraph.outputs.map((p) => p.name);

    const inPath = stringFlag(args, "in");
    const bindings =
      inPath === undefined ? [] : readInputBindings(io, inPath, name, exposedInputs);
    const shape = {
      name,
      boundInputs: bindings.map((b) => b.pin),
      outputs: exposedOutputs,
      params: {},
    };
    // Materialized once to read the schemas, then again only if there are
    // values to type against them — so the common case pays for one.
    let graph = deserializeGraph(buildWrapperGraph(shape));
    const params = parseParamAssignments(io, name, exposedParams(graph), listFlag(args, "param"));
    const wrapper = buildWrapperGraph({ ...shape, params });
    if (Object.keys(params).length > 0) {
      try {
        graph = deserializeGraph(wrapper);
      } catch (err) {
        throw new CliUsageError(
          `run: a --param value was rejected: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    for (const binding of bindings) {
      graph.setParam<{ items: readonly DataItem[] }, "items">(
        { id: inputNodeId(binding.pin) },
        "items",
        binding.items,
      );
    }
    const seed = applySeed(args, "run", graph);
    if (exposedOutputs.length === 0) {
      throw new CliError(
        `primitive "${name}" exposes no output pins, so cooking it produces nothing; a primitive is run through its exposed outputs — register it with an "outputs" entry, or inspect the graph that builds it instead`,
      );
    }

    const perNode: NodeDoneInfo[] = [];
    const result = await cook(graph, {
      ...cookOptions(args, "run"),
      onNodeDone: (info) => perNode.push(info),
    });

    const outputs: Record<string, ItemSummary[]> = {};
    for (const outputName of Object.keys(result.outputs)) {
      outputs[outputName] = [...result.outputs[outputName]].map(summarizeItem);
    }
    const outPath = stringFlag(args, "out");
    const json = {
      primitive: name,
      hash: entry.hash,
      seed: graph.seed,
      // The wrapper's params exactly as they went into the JSON, so the
      // report says what cooked rather than what was typed.
      params: wrapper.nodes[0].params,
      inputs: bindings.map((b) => ({ pin: b.pin, items: b.items.length })),
      out: outPath ?? null,
      stats: {
        cooked: result.stats.cooked,
        cached: result.stats.cached,
        elapsedMs: result.stats.elapsedMs,
      },
      nodes: perNode.map((n) => ({
        id: n.id,
        type: n.type,
        cached: n.cached,
        elapsedMs: n.elapsedMs,
      })),
      outputs,
    };

    const lines = [
      `ran "${name}" #${entry.hash}${seed !== undefined ? ` (seed override ${graph.seed})` : ` (seed ${graph.seed})`}`,
      `${result.stats.cooked} cooked, ${result.stats.cached} cached, ${fmtMs(result.stats.elapsedMs)}`,
    ];
    const paramNames = Object.keys(json.params);
    if (paramNames.length > 0) {
      lines.push("", "params:");
      lines.push(...table(paramNames.map((k) => [k, JSON.stringify(json.params[k])])));
    }
    if (bindings.length > 0) {
      lines.push("", "inputs:");
      lines.push(...table(bindings.map((b) => [b.pin, plural(b.items.length, "value item")])));
    }
    lines.push("", "outputs:");
    for (const outputName of Object.keys(outputs)) {
      lines.push(`  ${outputName} (${plural(outputs[outputName].length, "item")})`);
      outputs[outputName].forEach((item, i) => lines.push(`    [${i}] ${itemLine(item)}`));
    }
    if (boolFlag(args, "stats")) {
      lines.push("", "per-node:");
      lines.push(
        ...table([
          ["id", "type", "state", "elapsed"],
          ...perNode.map((n) => [n.id, n.type, n.cached ? "cached" : "cooked", fmtMs(n.elapsedMs)]),
        ]),
      );
    }
    if (outPath !== undefined) {
      io.writeFile(outPath, JSON.stringify(json, null, 2) + "\n");
      lines.push("", `wrote ${outPath}`);
    }
    return { text: lines.join("\n") + "\n", json };
  },
};

/** Every subcommand, in help order. */
export const COMMANDS: readonly Command[] = [
  nodesCommand,
  fieldsCommand,
  validateCommand,
  cookCommand,
  runCommand,
  inspectCommand,
  renderCommand,
];
