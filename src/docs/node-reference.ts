/**
 * Rendering of the node reference (`docs/nodes.md` + `docs/nodes.json`)
 * from node registry metadata: a pure function from `NodeTypeInfo[]` to
 * the exact bytes of each file. No I/O, no registry access — the caller
 * supplies the metadata and decides what to do with the strings.
 *
 * WHY IT LIVES UNDER `src/` AND NOT IN `scripts/`. Two callers must
 * render from the same code or the drift test drifts from the generator
 * it guards: `scripts/gen-node-reference.mjs` (writes the files) and
 * `node-reference.test.ts` (compares the committed files against a fresh
 * render). The test must run on a fresh clone with no build — `npm test`
 * cannot depend on `npm run build` — so it imports this module from
 * source. The script is plain ESM with no TypeScript loader, so it
 * imports the built copy.
 *
 * The trade-off that decides the exact location: a plain `.mjs` module
 * under `scripts/` would be one file imported by both (stronger still),
 * but `tsconfig` has `allowJs` off and `strict` on, so a `.ts` test
 * importing it fails `npm run check` with TS7016 unless a hand-written
 * `.d.mts` shadows it — trading logic drift for type drift. So: TypeScript
 * here, and a dedicated `src/docs/index.ts` build entry (tsup) so the
 * script has a built path to import. That entry is deliberately NOT in
 * `src/index.ts` and NOT in package.json's `exports` map: doc rendering is
 * build tooling, and putting it in the public surface would ship it into
 * every consumer bundle and pin its signature under semver.
 *
 * Output is deterministic — see {@link renderNodeReference}.
 */
import type { ParamSchema, ParamType, ParamValue } from "../graph/index.js";
import type { NodeTypeInfo } from "../nodes/registry.js";
import type { PinKind } from "../graph/index.js";

/** One rendered catalog: the bytes of each generated file. */
export interface NodeReference {
  /** Contents of `docs/nodes.json`. */
  readonly json: string;
  /** Contents of `docs/nodes.md`. */
  readonly markdown: string;
}

// ---------------------------------------------------------------------------
// docs/nodes.json — the raw registry metadata, canonical key order.
// ---------------------------------------------------------------------------

interface CanonicalPin {
  readonly name: string;
  readonly kind: PinKind;
  readonly multi: boolean;
}

interface CanonicalSchema {
  readonly type: ParamType;
  readonly default: ParamValue;
  readonly description: string;
  readonly enum?: readonly string[];
  readonly acceptsField?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly acceptsInfinite?: boolean;
}

interface CanonicalNodeType {
  readonly type: string;
  readonly description: string;
  readonly category?: string;
  readonly inputs: readonly CanonicalPin[];
  readonly outputs: readonly CanonicalPin[];
  readonly params: Record<string, CanonicalSchema>;
}

function canonicalPin(pin: { name: string; kind: PinKind; multi?: boolean }): CanonicalPin {
  return { name: pin.name, kind: pin.kind, multi: pin.multi === true };
}

/**
 * Key order is the insertion order of these literals — that is what makes
 * `JSON.stringify` output stable across runs.
 */
function canonicalSchema(schema: ParamSchema): CanonicalSchema {
  return {
    type: schema.type,
    default: schema.default,
    description: schema.description,
    ...(schema.enum !== undefined ? { enum: schema.enum } : {}),
    ...(schema.acceptsField !== undefined ? { acceptsField: schema.acceptsField } : {}),
    ...(schema.min !== undefined ? { min: schema.min } : {}),
    ...(schema.max !== undefined ? { max: schema.max } : {}),
    ...(schema.acceptsInfinite !== undefined ? { acceptsInfinite: schema.acceptsInfinite } : {}),
  };
}

function canonicalType(t: NodeTypeInfo): CanonicalNodeType {
  return {
    type: t.type,
    description: t.description,
    ...(t.category !== undefined ? { category: t.category } : {}),
    inputs: t.inputs.map(canonicalPin),
    outputs: t.outputs.map(canonicalPin),
    params: Object.fromEntries(
      Object.entries(t.params).map(([name, schema]) => [name, canonicalSchema(schema)]),
    ),
  };
}

// ---------------------------------------------------------------------------
// docs/nodes.md — one section per node type.
// ---------------------------------------------------------------------------

/** Escape a value for use inside a markdown table cell. */
function cell(text: unknown): string {
  return String(text).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function formatDefault(value: ParamValue): string {
  return "`" + JSON.stringify(value) + "`";
}

function formatRange(schema: ParamSchema): string {
  const hasMin = schema.min !== undefined;
  const hasMax = schema.max !== undefined;
  // `acceptsInfinite` is part of the range a param admits, so it belongs in
  // the range cell rather than a column of its own — and it is the LIVE
  // range: a graph carrying an infinity cannot be serialized.
  const infinite = schema.acceptsInfinite === true ? " (±Infinity ok, but never serializes)" : "";
  if (hasMin && hasMax) return `${schema.min}..${schema.max}${infinite}`;
  if (hasMin) return `>= ${schema.min}${infinite}`;
  if (hasMax) return `<= ${schema.max}${infinite}`;
  return infinite.trim();
}

function formatPins(pins: readonly { name: string; kind: PinKind; multi?: boolean }[]): string {
  if (pins.length === 0) return "*(none)*";
  return pins
    .map((p) => "`" + p.name + "` (" + p.kind + (p.multi === true ? ", multi" : "") + ")")
    .join(", ");
}

function firstSentence(description: string): string {
  return description.split(". ")[0]!.replace(/\.$/, "");
}

const UNCATEGORIZED = "(uncategorized)";

function renderMarkdown(types: readonly NodeTypeInfo[]): string {
  /** Category buckets in first-appearance-agnostic (alphabetical) order; uncategorized last. */
  const byCategory = new Map<string, NodeTypeInfo[]>();
  for (const t of types) {
    const cat = t.category !== undefined ? t.category : UNCATEGORIZED;
    let bucket = byCategory.get(cat);
    if (!bucket) byCategory.set(cat, (bucket = []));
    bucket.push(t);
  }
  const categories = [...byCategory.keys()].sort((a, b) => {
    if (a === UNCATEGORIZED) return 1;
    if (b === UNCATEGORIZED) return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const lines: string[] = [];
  lines.push("# Node reference");
  lines.push("");
  lines.push(
    "Generated from the node registry metadata (`listNodeTypes()`) by " +
      "`node scripts/gen-node-reference.mjs` — do not edit by hand. " +
      "The same metadata, machine-readable, is in [nodes.json](./nodes.json). " +
      "For the graph JSON format and field-expression grammar see " +
      "[authoring.md](./authoring.md).",
  );
  lines.push("");
  lines.push(
    `${types.length} node types, grouped by \`category\` (node sections below are alphabetical):`,
  );
  lines.push("");
  for (const cat of categories) {
    lines.push(`**${cat}**`);
    lines.push("");
    for (const t of byCategory.get(cat)!) {
      lines.push(`- [${t.type}](#${t.type.toLowerCase()}) — ${firstSentence(t.description)}.`);
    }
    lines.push("");
  }

  for (const t of types) {
    lines.push(`## ${t.type}`);
    lines.push("");
    lines.push(t.description);
    lines.push("");
    if (t.category !== undefined) {
      lines.push(`**Category:** ${t.category}`);
      lines.push("");
    }
    lines.push(`**Inputs:** ${formatPins(t.inputs)}`);
    lines.push("");
    lines.push(`**Outputs:** ${formatPins(t.outputs)}`);
    lines.push("");
    const paramNames = Object.keys(t.params);
    if (paramNames.length === 0) {
      lines.push("**Params:** *(none)*");
    } else {
      lines.push("**Params:**");
      lines.push("");
      lines.push("| Param | Type | Default | Range | Enum | Field | Description |");
      lines.push("| --- | --- | --- | --- | --- | --- | --- |");
      for (const name of paramNames) {
        const s = t.params[name]!;
        lines.push(
          "| " +
            [
              "`" + name + "`",
              s.type,
              cell(formatDefault(s.default)),
              cell(formatRange(s)),
              cell(s.enum !== undefined ? s.enum.map((v) => "`" + v + "`").join(", ") : ""),
              s.acceptsField === true ? "yes" : "",
              cell(s.description),
            ].join(" | ") +
            " |",
        );
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Render the node reference from registry metadata (`listNodeTypes()`).
 *
 * Deterministic by three mechanisms, all of which the drift test depends
 * on: node types are sorted by name here (not left in registration
 * order), object keys are emitted in a fixed canonical order, and every
 * line break is an LF — so rendering the same registry twice yields
 * identical bytes on every platform.
 */
export function renderNodeReference(types: readonly NodeTypeInfo[]): NodeReference {
  const sorted = types.slice().sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
  return {
    json: JSON.stringify(sorted.map(canonicalType), null, 2) + "\n",
    markdown: renderMarkdown(sorted),
  };
}
