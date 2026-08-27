/**
 * Rendering of the primitive catalog (`docs/primitives.md` +
 * `docs/primitives.json`) from the named-subgraph registry: a pure
 * function from `PrimitiveInfo[]` to the exact bytes of each file, plus
 * the one impure step that produces a `PrimitiveInfo` from a registry
 * record.
 *
 * Why it lives under `src/` and not in `scripts/`: the same reason
 * `node-reference.ts` does. Two callers must render from one module or the
 * drift test drifts from the generator it guards —
 * `scripts/gen-primitives.mjs` (writes the files, imports the built copy)
 * and `primitives.test.ts` (compares the committed files, imports this
 * source so `npm test` needs no build). See node-reference.ts for the full
 * argument; nothing here restates it.
 *
 * WHAT A REGISTRY RECORD DOES NOT CARRY. `RegisteredSubgraph` holds the
 * AUTHORED half of each exposed param — name, targets, description,
 * default, bounds — because a serialized recipe deliberately does not
 * carry `type`, `enum` or `acceptsField`: those are re-derived from the
 * targets' registered schemas on load, so a payload cannot claim a schema
 * that lies about what the inner params accept. A catalog that printed
 * only the authored half would omit exactly the fields an agent needs to
 * write a value. So {@link describePrimitive} MATERIALIZES the primitive
 * through the ordinary `deserializeGraph` path and reads the derived
 * schemas off the live instance — the same route `pcg run` takes, and the
 * same route a graph referencing the primitive takes. Generating the
 * catalog therefore proves the primitives actually load.
 */
import {
  type DescribedSubgraphPin,
  type GraphMeta,
  type ParamSchema,
  type ParamType,
  type ParamValue,
  type PinKind,
  type RegisteredSubgraph,
  describeSubgraphParams,
  describeSubgraphPins,
  deserializeGraph,
  inferWrapperKind,
} from "../index.js";

/** One rendered catalog: the bytes of each generated file. */
export interface PrimitiveCatalog {
  /** Contents of `docs/primitives.json`. */
  readonly json: string;
  /** Contents of `docs/primitives.md`. */
  readonly markdown: string;
}

/** One exposed param of a primitive, authored half plus derived schema. */
export interface PrimitiveParamInfo {
  readonly name: string;
  readonly schema: ParamSchema;
  /** Inner slots the value is written into, in write order. */
  readonly targets: readonly { readonly node: string; readonly param: string }[];
}

/** A registered primitive, resolved to everything a catalog needs. */
export interface PrimitiveInfo {
  readonly name: string;
  readonly hash: string;
  readonly meta?: GraphMeta;
  readonly inputs: readonly DescribedSubgraphPin[];
  readonly outputs: readonly DescribedSubgraphPin[];
  readonly params: readonly PrimitiveParamInfo[];
  /** Node count of the recipe graph — the primitive's size at a glance. */
  readonly nodes: number;
}

/**
 * Resolve one registry record into the catalog's view of it, materializing
 * the primitive to read its derived pin kinds and param schemas.
 *
 * Deterministic and side-effect free: `deserializeGraph` builds a throwaway
 * `Graph` and touches no global state.
 */
export function describePrimitive(entry: RegisteredSubgraph): PrimitiveInfo {
  const probe = deserializeGraph({
    formatVersion: 1,
    seed: 0,
    // The probe's TYPE is inferred, never fixed at "subgraph". A recipe
    // records a body and its exposed pins and nothing about which wrapper
    // cooks them, so a body exposing a reserved name — `each` on a forEach
    // body, `carry` on a repeatUntil one — is refused outright when probed
    // as a plain subgraph, and the primitive becomes uncatalogable. That is
    // not a documentation-only failure: this probe is how the catalog reads
    // the DERIVED param schemas, so it is also the check that the shipped
    // primitives still load, and it would have failed the whole `npm run
    // docs` chain on the first loop-body primitive anyone registered.
    nodes: [
      { id: "probe", type: inferWrapperKind(entry.subgraph), params: {}, ref: { name: entry.name } },
    ],
    connections: [],
    outputs: [],
  });
  const state = probe._nodes.get("probe");
  // Unreachable: the node was just deserialized under that id.
  if (state === undefined) throw new Error(`describePrimitive("${entry.name}"): probe node missing`);
  const pins = describeSubgraphPins(state.def);
  if (pins === undefined) {
    throw new Error(
      `describePrimitive("${entry.name}"): the materialized node is not a subgraph instance`,
    );
  }
  return {
    name: entry.name,
    hash: entry.hash,
    ...(entry.meta !== undefined ? { meta: entry.meta } : {}),
    inputs: pins.inputs,
    outputs: pins.outputs,
    params: (describeSubgraphParams(state.def) ?? []).map((p) => ({
      name: p.name,
      schema: p.schema,
      targets: p.targets,
    })),
    nodes: entry.subgraph.graph.nodes.length,
  };
}

// ---------------------------------------------------------------------------
// docs/primitives.json — the registry's own records, canonical key order.
// ---------------------------------------------------------------------------

interface CanonicalPin {
  readonly name: string;
  readonly kind: PinKind;
}

interface CanonicalSchema {
  readonly type: ParamType;
  readonly default: ParamValue;
  readonly description: string;
  readonly enum?: readonly string[];
  readonly acceptsField?: boolean;
  readonly min?: number;
  readonly max?: number;
}

interface CanonicalParam {
  readonly name: string;
  readonly schema: CanonicalSchema;
  readonly targets: readonly { readonly node: string; readonly param: string }[];
}

interface CanonicalPrimitive {
  readonly name: string;
  readonly hash: string;
  readonly title?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly nodes: number;
  readonly inputs: readonly CanonicalPin[];
  readonly outputs: readonly CanonicalPin[];
  readonly params: readonly CanonicalParam[];
}

/**
 * Key order is the insertion order of these literals, and optionals are
 * spread in conditionally rather than assigned — so `JSON.stringify` emits
 * the same key sequence on every run, and a field added upstream cannot
 * silently appear in the docs because nothing here spreads the source.
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
  };
}

function canonicalPrimitive(p: PrimitiveInfo): CanonicalPrimitive {
  return {
    name: p.name,
    hash: p.hash,
    ...(p.meta?.title !== undefined ? { title: p.meta.title } : {}),
    ...(p.meta?.description !== undefined ? { description: p.meta.description } : {}),
    ...(p.meta?.tags !== undefined ? { tags: p.meta.tags } : {}),
    nodes: p.nodes,
    inputs: p.inputs.map((pin) => ({ name: pin.name, kind: pin.kind })),
    outputs: p.outputs.map((pin) => ({ name: pin.name, kind: pin.kind })),
    // Exposure order is preserved for pins (it is the wrapper's pin order,
    // which is semantic) but params are SORTED: their order in a recipe is
    // whatever the author listed, so sorting makes reordering the envelope
    // a no-op in the catalog.
    params: p.params
      .slice()
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((param) => ({
        name: param.name,
        schema: canonicalSchema(param.schema),
        targets: param.targets.map((t) => ({ node: t.node, param: t.param })),
      })),
  };
}

// ---------------------------------------------------------------------------
// docs/primitives.md — one section per primitive.
// ---------------------------------------------------------------------------

/** Escape a value for use inside a markdown table cell. */
function cell(text: unknown): string {
  return String(text).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function formatRange(schema: ParamSchema): string {
  const hasMin = schema.min !== undefined;
  const hasMax = schema.max !== undefined;
  if (hasMin && hasMax) return `${schema.min}..${schema.max}`;
  if (hasMin) return `>= ${schema.min}`;
  if (hasMax) return `<= ${schema.max}`;
  return "";
}

function formatPins(pins: readonly CanonicalPin[]): string {
  if (pins.length === 0) return "*(none)*";
  return pins.map((p) => "`" + p.name + "` (" + p.kind + ")").join(", ");
}

/** The anchor GitHub gives a heading; primitive names carry slashes. */
function anchor(name: string): string {
  return name.toLowerCase().replaceAll("/", "").replaceAll(" ", "-");
}

const PREAMBLE =
  "Generated from the named-subgraph registry (`listSubgraphs()`) by " +
  "`node scripts/gen-primitives.mjs` — do not edit by hand. The same " +
  "catalog, machine-readable, is in [primitives.json](./primitives.json). " +
  "For the graph JSON format, including how a graph references a primitive " +
  "by name, see [authoring.md](./authoring.md); for the node types a " +
  "primitive is built from, [nodes.md](./nodes.md).";

/**
 * What an empty catalog says. A generated file that explains its own
 * emptiness is worth far more than a missing one: it fixes the format, the
 * generator and the drift test now, so shipping the vocabulary later only
 * adds rows.
 */
const EMPTY_NOTE = [
  "**No primitives are registered in this build, so this catalog is empty.**",
  "",
  "That is the honest state, not a generation failure: the mechanism ships —",
  '`registerSubgraph(name, spec)` registers one, and `"ref": { "name": ... }` on',
  "a serialized subgraph node references it — but the shipped vocabulary of",
  "primitives arrives with a later phase. Registering a primitive is what puts a",
  "section here, and `pcg run <name>` is what cooks it.",
].join("\n");

function renderMarkdown(primitives: readonly CanonicalPrimitive[]): string {
  const lines: string[] = [];
  lines.push("# Primitive reference");
  lines.push("");
  lines.push(PREAMBLE);
  lines.push("");
  if (primitives.length === 0) {
    lines.push(EMPTY_NOTE);
    lines.push("");
    return lines.join("\n");
  }
  lines.push(
    `${primitives.length} registered ${primitives.length === 1 ? "primitive" : "primitives"}, alphabetical:`,
  );
  lines.push("");
  for (const p of primitives) {
    lines.push(`- [${p.name}](#${anchor(p.name)})${p.title !== undefined ? ` — ${cell(p.title)}` : ""}`);
  }
  lines.push("");
  for (const p of primitives) {
    lines.push(`## ${p.name}`);
    lines.push("");
    if (p.title !== undefined) {
      lines.push(`**${p.title}**`);
      lines.push("");
    }
    if (p.description !== undefined) {
      lines.push(p.description);
      lines.push("");
    }
    lines.push(`**Content hash:** \`${p.hash}\``);
    lines.push("");
    if (p.tags !== undefined && p.tags.length > 0) {
      lines.push(`**Tags:** ${p.tags.map((t) => "`" + t + "`").join(", ")}`);
      lines.push("");
    }
    lines.push(`**Inputs:** ${formatPins(p.inputs)}`);
    lines.push("");
    lines.push(`**Outputs:** ${formatPins(p.outputs)}`);
    lines.push("");
    if (p.params.length === 0) {
      lines.push("**Params:** *(none)*");
    } else {
      lines.push("**Params:**");
      lines.push("");
      lines.push("| Param | Type | Default | Range | Enum | Field | Writes to | Description |");
      lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
      for (const param of p.params) {
        const s = param.schema;
        lines.push(
          "| " +
            [
              "`" + param.name + "`",
              s.type,
              cell("`" + JSON.stringify(s.default) + "`"),
              cell(formatRange(s)),
              cell(s.enum !== undefined ? s.enum.map((v) => "`" + v + "`").join(", ") : ""),
              s.acceptsField === true ? "yes" : "",
              // No targets does not mean the knob does nothing: such a
              // param binds its name into the body's field scope and its
              // value is substituted into the expressions that read it as
              // `{"fn": "param"}`. An empty cell would read as missing
              // data about a param that in fact drives the cook, so name
              // the route it takes instead.
              cell(
                param.targets.length === 0
                  ? "*(nothing — the body's field expressions read it by name)*"
                  : param.targets.map((t) => `${t.node}.${t.param}`).join(", "),
              ),
              cell(s.description),
            ].join(" | ") +
            " |",
        );
      }
    }
    lines.push("");
    lines.push(`Run it: \`pcg run ${p.name}\``);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Render the primitive catalog from resolved registry records.
 *
 * Deterministic by four mechanisms, each guarding a different way a
 * generated file drifts between two runs that saw the same registry:
 *
 * 1. **Sorted entries** — primitives are ordered by name here, not left in
 *    registration order, so which module imported first cannot reorder the
 *    file. Exposed params are sorted too (their order in a recipe is the
 *    author's, not semantic); pin order is left alone, because it IS
 *    semantic.
 * 2. **Canonical key order by construction** — every emitted object is
 *    rebuilt through a literal with a fixed key sequence and conditional
 *    spreads for optionals. Nothing spreads a source object, so a field
 *    added upstream cannot appear here unreviewed, and an optional that is
 *    absent is absent rather than `undefined`.
 * 3. **LF newlines** — the markdown is a `lines` array joined with `"\n"`
 *    and the JSON gets an explicit `"\n"`; no platform newline is
 *    reachable from here.
 * 4. **Trailing newline, and nothing unstable** — both files end with
 *    exactly one LF, and neither carries a timestamp, a library version or
 *    a file path. A generated file that embeds the clock can never be
 *    compared against a committed one.
 */
export function renderPrimitiveCatalog(primitives: readonly PrimitiveInfo[]): PrimitiveCatalog {
  const sorted = primitives
    .slice()
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(canonicalPrimitive);
  return {
    json: JSON.stringify(sorted, null, 2) + "\n",
    markdown: renderMarkdown(sorted),
  };
}
