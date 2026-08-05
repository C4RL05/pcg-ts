#!/usr/bin/env node
/**
 * Generate the node reference (docs/nodes.md + docs/nodes.json) from the
 * built library's node registry metadata (`listNodeTypes()`).
 *
 * Usage: node scripts/gen-node-reference.mjs
 *
 * Reads dist/index.js (run `npm run build` first). Output is deterministic:
 * node types sorted alphabetically, canonical key order, LF newlines —
 * running twice yields identical bytes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(scriptDir);
const distUrl = new URL("../dist/index.js", import.meta.url);

let lib;
try {
  lib = await import(distUrl.href);
} catch (err) {
  const code = err && err.code;
  const message = err && err.message ? String(err.message) : "";
  if (code === "ERR_MODULE_NOT_FOUND" && message.includes("dist")) {
    console.error(
      [
        "gen-node-reference: dist/index.js not found — the library is not built.",
        "Run `npm run build` first, then re-run:",
        "  node scripts/gen-node-reference.mjs",
      ].join("\n"),
    );
    process.exit(1);
  }
  throw err;
}

if (typeof lib.listNodeTypes !== "function") {
  console.error(
    "gen-node-reference: dist/index.js does not export listNodeTypes(); rebuild with `npm run build`.",
  );
  process.exit(1);
}

/** Node types sorted alphabetically for deterministic output. */
const types = lib
  .listNodeTypes()
  .slice()
  .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));

// ---------------------------------------------------------------------------
// docs/nodes.json — the raw registry metadata, canonical key order.
// ---------------------------------------------------------------------------

function canonicalPin(pin) {
  return { name: pin.name, kind: pin.kind, multi: pin.multi === true };
}

function canonicalSchema(schema) {
  const out = {
    type: schema.type,
    default: schema.default,
    description: schema.description,
  };
  if (schema.enum !== undefined) out.enum = schema.enum;
  if (schema.acceptsField !== undefined) out.acceptsField = schema.acceptsField;
  if (schema.min !== undefined) out.min = schema.min;
  if (schema.max !== undefined) out.max = schema.max;
  return out;
}

function canonicalType(t) {
  const out = {
    type: t.type,
    description: t.description,
  };
  if (t.category !== undefined) out.category = t.category;
  out.inputs = t.inputs.map(canonicalPin);
  out.outputs = t.outputs.map(canonicalPin);
  out.params = Object.fromEntries(
    Object.entries(t.params).map(([name, schema]) => [name, canonicalSchema(schema)]),
  );
  return out;
}

const json = JSON.stringify(types.map(canonicalType), null, 2) + "\n";

// ---------------------------------------------------------------------------
// docs/nodes.md — one section per node type.
// ---------------------------------------------------------------------------

/** Escape a value for use inside a markdown table cell. */
function cell(text) {
  return String(text).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function formatDefault(value) {
  if (typeof value === "string") return "`" + JSON.stringify(value) + "`";
  return "`" + JSON.stringify(value) + "`";
}

function formatRange(schema) {
  const hasMin = schema.min !== undefined;
  const hasMax = schema.max !== undefined;
  if (hasMin && hasMax) return `${schema.min}..${schema.max}`;
  if (hasMin) return `>= ${schema.min}`;
  if (hasMax) return `<= ${schema.max}`;
  return "";
}

function formatPins(pins) {
  if (pins.length === 0) return "*(none)*";
  return pins
    .map((p) => "`" + p.name + "` (" + p.kind + (p.multi === true ? ", multi" : "") + ")")
    .join(", ");
}

/** Category buckets in first-appearance-agnostic (alphabetical) order; uncategorized last. */
const UNCATEGORIZED = "(uncategorized)";
const byCategory = new Map();
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

function firstSentence(description) {
  return description.split(". ")[0].replace(/\.$/, "");
}

const lines = [];
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
  for (const t of byCategory.get(cat)) {
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
      const s = t.params[name];
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

const md = lines.join("\n");

// ---------------------------------------------------------------------------
// Write.
// ---------------------------------------------------------------------------

const docsDir = join(root, "docs");
mkdirSync(docsDir, { recursive: true });
writeFileSync(join(docsDir, "nodes.json"), json);
writeFileSync(join(docsDir, "nodes.md"), md);
console.log(`gen-node-reference: wrote docs/nodes.md and docs/nodes.json (${types.length} node types)`);
