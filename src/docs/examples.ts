/**
 * The example corpus: enumerating `examples/graphs/{basics,pipeline}-*.json`
 * and rendering the generated index (`docs/examples.md` + `docs/examples.json`).
 *
 * WHY IT LIVES UNDER `src/` AND NOT IN `scripts/` — the same reason
 * node-reference.ts does, and its comment carries the full argument. Two
 * callers must render from the same code or the drift test drifts from
 * the generator it guards: `scripts/gen-examples.mjs` (writes the files)
 * and `examples.test.ts` (compares the committed files against a fresh
 * render). The test must run on a fresh clone with no build, so it
 * imports this module from source; the script is plain ESM with no
 * TypeScript loader, so it imports the built copy from `dist/docs`.
 *
 * {@link loadCorpus} is here rather than in either caller for a second
 * reason: the corpus CI (`tests/corpus.test.ts`) enumerates the same
 * files, and one enumeration for all three readers is what makes "in the
 * corpus" and "in the index" the same set by construction. An example
 * dropped into `examples/graphs/` is picked up by the index, the golden
 * and the cook test at once — there is no list to update, and so no list
 * to forget.
 *
 * Output is deterministic — see {@link renderExampleIndex}.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Corpus location, relative to the repository root. */
export const CORPUS_DIR = "examples/graphs";

/**
 * The prefixes a corpus file may carry. Anything else in the directory is
 * ignored.
 *
 * A LIST rather than one string, because the corpus now holds two kinds of
 * example and they are read differently. A `basics-` file teaches ONE thing
 * and stands alone; a `pipeline-` file is one step of a staged chain, and
 * only means anything beside its neighbours — each is the previous file plus
 * new nodes, connections and outputs, sharing a seed so every earlier stage
 * reproduces bit-identically inside every later one. Both kinds must be
 * indexed, cooked and pinned by the golden, so both enumerate here: adding a
 * prefix is the one edit that admits a family, and there is still no
 * hand-maintained list of files anywhere.
 */
export const CORPUS_PREFIXES: readonly string[] = ["basics-", "examples-", "pipeline-"];

/** One rendered index: the bytes of each generated file. */
export interface ExampleIndex {
  /** Contents of `docs/examples.json`. */
  readonly json: string;
  /** Contents of `docs/examples.md`. */
  readonly markdown: string;
}

/** A corpus file as read from disk: its name, its absolute path, its parsed JSON. */
export interface CorpusFile {
  /** Base name, e.g. `basics-scatter-in-bounds.json`. */
  readonly file: string;
  /** Repository-relative path, e.g. `examples/graphs/basics-scatter-in-bounds.json`. */
  readonly path: string;
  /** Absolute path on disk. */
  readonly absolutePath: string;
  /** The parsed graph JSON, unvalidated (deserializing it is the caller's job). */
  readonly json: unknown;
}

/**
 * Read every corpus graph under `<root>/examples/graphs`, sorted by file
 * name. Sorting here — not relying on directory order — is one of the
 * three mechanisms that make the generated index byte-stable across
 * platforms and filesystems.
 *
 * A file that is not valid JSON fails here, naming the file: the corpus
 * is the agent-facing material, and a half-read corpus would generate an
 * index that quietly omits an example.
 */
export function loadCorpus(root: string): CorpusFile[] {
  const dir = join(root, CORPUS_DIR);
  const names = readdirSync(dir)
    .filter((name) => CORPUS_PREFIXES.some((p) => name.startsWith(p)) && name.endsWith(".json"))
    .sort();
  return names.map((file) => {
    const absolutePath = join(dir, file);
    const text = readFileSync(absolutePath, "utf8");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new Error(
        `${CORPUS_DIR}/${file}: not valid JSON (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    return { file, path: `${CORPUS_DIR}/${file}`, absolutePath, json };
  });
}

// ---------------------------------------------------------------------------
// Describing one example: its own `meta` block plus what the graph contains.
// ---------------------------------------------------------------------------

/** One catalogued example. Key order here IS the emitted JSON key order. */
export interface ExampleEntry {
  readonly file: string;
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly seed: number;
  /** Nodes in the outer graph (inner subgraph nodes are not counted). */
  readonly nodeCount: number;
  /** Every node type used, at any nesting depth, sorted and deduplicated. */
  readonly nodeTypes: readonly string[];
  /** Every primitive referenced by name (`ref.name`), sorted and deduplicated. */
  readonly primitives: readonly string[];
  /** Declared terminal outputs, in declaration order. */
  readonly outputs: readonly ExampleOutput[];
}

export interface ExampleOutput {
  readonly name: string;
  readonly node: string;
  readonly pin: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(file: string, message: string): never {
  throw new Error(`${CORPUS_DIR}/${file}: ${message}`);
}

function readString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/**
 * Collect node types and referenced primitive names from a graph object,
 * descending into inline `subgraph` payloads. A referenced primitive
 * contributes its NAME only: what is behind the name lives in the
 * registry and is catalogued by primitives.md, so copying it in here
 * would be a second copy to keep in step.
 */
function collectStructure(
  file: string,
  graph: unknown,
  types: Set<string>,
  primitives: Set<string>,
  depth: number,
): void {
  if (depth > 32) fail(file, "subgraph payloads nest deeper than 32 levels");
  if (!isObject(graph)) fail(file, "expected a serialized graph object");
  const nodes = graph.nodes;
  if (!Array.isArray(nodes)) fail(file, '"nodes" must be an array');
  for (const node of nodes) {
    if (!isObject(node)) fail(file, "every node must be an object");
    const type = readString(node.type);
    if (type === "") fail(file, 'every node needs a string "type"');
    types.add(type);
    const ref = node.ref;
    if (isObject(ref)) {
      const name = readString(ref.name);
      if (name !== "") primitives.add(name);
    }
    const payload = node.subgraph;
    if (isObject(payload)) {
      collectStructure(file, payload.graph, types, primitives, depth + 1);
    }
  }
}

/**
 * Describe one corpus file: its authored `meta` block plus the
 * structural facts derived from the graph itself. Nothing here is
 * hand-maintained — an example that gains a node type or a primitive
 * reference says so in the index the next time it is generated.
 */
export function describeExample(entry: CorpusFile): ExampleEntry {
  const { file, path, json } = entry;
  if (!isObject(json)) fail(file, "expected a serialized graph object");
  const meta = isObject(json.meta) ? json.meta : undefined;
  if (meta === undefined) {
    fail(file, 'no "meta" block; every corpus example must say what it teaches');
  }
  const title = readString(meta.title);
  const description = readString(meta.description);
  if (title === "" || description === "") {
    fail(file, 'its "meta" block needs both a title and a description');
  }
  const tags = Array.isArray(meta.tags) ? meta.tags.filter((t): t is string => typeof t === "string") : [];
  if (tags.length === 0) fail(file, 'its "meta" block needs at least one tag');

  const types = new Set<string>();
  const primitives = new Set<string>();
  collectStructure(file, json, types, primitives, 0);

  const nodes = json.nodes;
  const outputsJson = json.outputs;
  if (!Array.isArray(outputsJson) || outputsJson.length === 0) {
    fail(file, "declares no outputs, so cooking it would produce nothing");
  }
  const outputs = outputsJson.map((o: unknown): ExampleOutput => {
    if (!isObject(o)) fail(file, "every declared output must be an object");
    return { name: readString(o.name), node: readString(o.id), pin: readString(o.pin) };
  });

  return {
    file,
    path,
    title,
    description,
    tags,
    seed: typeof json.seed === "number" ? json.seed : 0,
    nodeCount: Array.isArray(nodes) ? nodes.length : 0,
    nodeTypes: [...types].sort(),
    primitives: [...primitives].sort(),
    outputs,
  };
}

// ---------------------------------------------------------------------------
// docs/examples.md — one section per example.
// ---------------------------------------------------------------------------

/**
 * The heading anchor GitHub derives from a file name: lowercased, dots
 * dropped. Same rule the primitive catalog applies to the `/` in a
 * primitive name.
 */
function anchor(file: string): string {
  return file.toLowerCase().replaceAll(".", "");
}

function code(items: readonly string[]): string {
  if (items.length === 0) return "*(none)*";
  return items.map((i) => "`" + i + "`").join(", ");
}

function renderMarkdown(entries: readonly ExampleEntry[]): string {
  const lines: string[] = [];
  lines.push("# Example corpus");
  lines.push("");
  lines.push(
    "Generated from the graphs in [`" +
      CORPUS_DIR +
      "`](../" +
      CORPUS_DIR +
      ") by `node scripts/gen-examples.mjs` — do not edit by hand. " +
      "The same index, machine-readable, is in [examples.json](./examples.json). " +
      "For the graph JSON format see [authoring.md](./authoring.md); for the node " +
      "types these graphs use, [nodes.md](./nodes.md); for the primitives they " +
      "reference, [primitives.md](./primitives.md).",
  );
  lines.push("");
  lines.push(
    "Each file teaches ONE thing and cooks from JSON alone — no runtime-injected " +
      "data, so `pcg cook <file>` on a clean install reproduces exactly what the " +
      "corpus test asserts.",
  );
  lines.push("");
  lines.push(`${entries.length} examples, alphabetical by file:`);
  lines.push("");
  for (const e of entries) {
    lines.push(`- [${e.file}](#${anchor(e.file)}) — ${e.title}`);
  }
  lines.push("");

  for (const e of entries) {
    lines.push(`## ${e.file}`);
    lines.push("");
    lines.push(`**${e.title}**`);
    lines.push("");
    lines.push(e.description);
    lines.push("");
    lines.push(`**Tags:** ${code(e.tags)}`);
    lines.push("");
    lines.push(`**Seed:** ${e.seed}`);
    lines.push("");
    lines.push(`**Node types:** ${code(e.nodeTypes)}`);
    lines.push("");
    lines.push(`**Primitives:** ${code(e.primitives)}`);
    lines.push("");
    lines.push(
      "**Outputs:** " +
        e.outputs.map((o) => "`" + o.name + "` (from `" + o.node + "`.`" + o.pin + "`)").join(", "),
    );
    lines.push("");
    lines.push(`Cook it: \`pcg cook ${e.path} --stats\``);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Render the example index from the corpus files.
 *
 * Deterministic by the same three mechanisms the node reference and the
 * primitive catalog use, and the drift test depends on all three:
 * entries are sorted by file name (in {@link loadCorpus}, so directory
 * order never reaches here), object keys are emitted in the fixed order
 * of the {@link ExampleEntry} literal, and every line break is an LF. No
 * timestamp, no version, no count that comes from anywhere but the files
 * themselves — so rendering the same corpus twice yields identical bytes
 * on every platform.
 */
export function renderExampleIndex(entries: readonly ExampleEntry[]): ExampleIndex {
  const sorted = entries.slice().sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return {
    json: JSON.stringify(sorted, null, 2) + "\n",
    markdown: renderMarkdown(sorted),
  };
}
