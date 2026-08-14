/**
 * `docs/primitives.md` and `docs/primitives.json` are generated from the
 * named-subgraph registry, and nothing in the build regenerates them — so
 * they drift silently, exactly as the node reference does. There is no CI
 * in this repo, so the drift check has to be a test.
 *
 * This pins them together, through the same module the generator uses
 * (src/docs/primitives.ts, imported here from source so `npm test` works
 * on a fresh clone with no build). If it fails, the fix is `npm run build
 * && npm run docs:primitives`, not relaxing the test.
 *
 * REGISTRY ISOLATION, which this file needs and node-reference.test.ts
 * does not. Node types are code, registered once per process by importing
 * the library; primitives are DATA, so a suite registers throwaway ones —
 * including the one below, which exists to prove this very check can fail.
 * The registry is global module state and there is no unregister, so a
 * test that read `listSubgraphs()` at assertion time would compare the
 * committed docs against whatever earlier tests happened to leave behind,
 * and would pass or fail on test ORDER.
 *
 * So the drift comparison renders from {@link AT_LOAD}, captured once
 * during module evaluation, before any test body runs. Nothing any test in
 * this file does can move it. Across files, vitest gives each test file
 * its own module registry, so another file's registrations never reach
 * this one — and the registrations made here are confined to names under
 * `test/` that no shipped primitive may use.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
// Side-effect import: REGISTERS the shipped vocabulary, which is what the
// committed catalog is a rendering OF. It sits above the value imports
// because it must have run before `AT_LOAD` is captured — and because the
// generator imports the same module for the same reason. One of the two
// readers importing it while the other does not is exactly the drift this
// file exists to catch.
import "../primitives/index.js";
import {
  Graph,
  jitterPoints,
  listSubgraphs,
  registerSubgraph,
  transformPoints,
} from "../index.js";
import { type PrimitiveInfo, describePrimitive, renderPrimitiveCatalog } from "./primitives.js";

/**
 * The registry as it stood when this module was evaluated: the state the
 * committed catalog is asserted against. See the file header.
 */
const AT_LOAD: readonly PrimitiveInfo[] = listSubgraphs().map(describePrimitive);

/**
 * Committed docs are read through git, and a Windows checkout with
 * `core.autocrlf=true` materializes them with CRLF. The generator always
 * writes LF, so normalize the on-disk copy rather than fail every Windows
 * clone on line endings the repository does not store.
 */
function readDoc(name: string): string {
  const path = fileURLToPath(new URL(`../../docs/${name}`, import.meta.url));
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

/**
 * Where two texts first differ, as a short excerpt — never both whole
 * files. A drift failure should name the line to look at.
 */
function firstDifference(actual: string, expected: string): string {
  const a = actual.split("\n");
  const e = expected.split("\n");
  const n = Math.max(a.length, e.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== e[i]) {
      return [
        `first difference at line ${i + 1}:`,
        `  committed: ${a[i] === undefined ? "<end of file>" : JSON.stringify(a[i])}`,
        `  generated: ${e[i] === undefined ? "<end of file>" : JSON.stringify(e[i])}`,
        `(${a.length} committed lines vs ${e.length} generated)`,
      ].join("\n");
    }
  }
  return "files differ only in trailing bytes";
}

/**
 * Which primitive NAMES the registry and the committed catalog disagree
 * about. The first-difference excerpt says where the bytes diverge; this
 * says which primitive to blame, which is the question a reader has after
 * adding one. Read off the committed JSON, so it applies to both files.
 */
function nameDelta(generated: readonly PrimitiveInfo[]): string {
  let committed: string[];
  try {
    committed = (JSON.parse(readDoc("primitives.json")) as { name: string }[]).map((p) => p.name);
  } catch {
    return "the committed docs/primitives.json is not readable as a catalog";
  }
  const live = generated.map((p) => p.name);
  // Sorted, so the message reads the same however the registry was filled.
  const added = live.filter((n) => !committed.includes(n)).sort();
  const removed = committed.filter((n) => !live.includes(n)).sort();
  const parts: string[] = [];
  if (added.length > 0) parts.push(`registered but missing from the catalog: ${added.join(", ")}`);
  if (removed.length > 0) parts.push(`in the catalog but not registered: ${removed.join(", ")}`);
  return parts.length === 0
    ? "the same primitives are on both sides, so the difference is in their content"
    : parts.join("; ");
}

/** The message a stale catalog fails with. Shared by both files' checks. */
function drift(
  file: string,
  committed: string,
  generated: string,
  from: readonly PrimitiveInfo[],
): string {
  return [
    `docs/${file} is stale: the subgraph registry changed but the generated`,
    "catalog was not regenerated. Run:",
    "",
    "  npm run build && npm run docs:primitives",
    "",
    nameDelta(from),
    "",
    firstDifference(committed, generated),
  ].join("\n");
}

describe("primitive catalog docs", () => {
  const { json, markdown } = renderPrimitiveCatalog(AT_LOAD);

  it("docs/primitives.json matches the subgraph registry", () => {
    const committed = readDoc("primitives.json");
    if (committed !== json) throw new Error(drift("primitives.json", committed, json, AT_LOAD));
  });

  it("docs/primitives.md matches the subgraph registry", () => {
    const committed = readDoc("primitives.md");
    if (committed !== markdown) throw new Error(drift("primitives.md", committed, markdown, AT_LOAD));
  });

  it("renders identically twice (deterministic output)", () => {
    const again = renderPrimitiveCatalog(AT_LOAD);
    expect(again.json).toBe(json);
    expect(again.markdown).toBe(markdown);
  });

  it("emits LF newlines and exactly one trailing newline", () => {
    for (const text of [json, markdown]) {
      expect(text).not.toContain("\r");
      expect(text.endsWith("\n")).toBe(true);
      expect(text.endsWith("\n\n")).toBe(false);
    }
  });

  it("the empty catalog is a valid, parseable one, not a placeholder", () => {
    // Today the registry ships no primitives, so this is the shape the
    // committed files actually have. When the vocabulary lands the arrays
    // stop being empty and only the length assertion here moves.
    const parsed: unknown = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as unknown[]).length).toBe(AT_LOAD.length);
    expect(markdown.startsWith("# Primitive reference\n")).toBe(true);
    if (AT_LOAD.length === 0) {
      // An empty generated file must SAY it is empty and why; a bare `[]`
      // with no prose reads as a broken generator.
      expect(markdown).toContain("**No primitives are registered in this build");
      expect(markdown).toContain("registerSubgraph");
      expect(json).toBe("[]\n");
    }
  });
});

/**
 * The half a drift test is worthless without. A comparison between two
 * things computed the same way passes forever; this registers real
 * primitives and shows the check going red, with the message it goes red
 * with.
 */
describe("the drift check is load-bearing", () => {
  /** A one-node primitive with a pin on each side and one exposed param. */
  function register(name: string, title: string): void {
    const inner = new Graph(11);
    const jit = inner.add(jitterPoints, { amount: [0.2, 0, 0.2], seed: 3 }, "jit");
    const xf = inner.add(transformPoints, { translate: [1, 0, 0] }, "xf");
    inner.connect(jit, "out", xf, "in");
    inner.setMeta({ title, description: "Jitter, then translate.", tags: ["test"] });
    registerSubgraph(name, {
      graph: inner,
      inputs: [{ name: "pts", node: jit, pin: "in" }],
      outputs: [{ name: "out", node: xf, pin: "out" }],
      params: [
        {
          name: "amount",
          targets: [{ node: jit, param: "amount" }],
          description: "How far each point may move.",
        },
      ],
    });
  }

  let live: readonly PrimitiveInfo[];

  beforeAll(() => {
    // Registered out of alphabetical order on purpose: the rendering has
    // to sort, or the catalog would depend on import order.
    register("test/zeta", "Zeta");
    register("test/alpha", "Alpha");
    live = listSubgraphs().map(describePrimitive);
  });

  it("a newly registered primitive makes the committed catalog stale", () => {
    const fresh = renderPrimitiveCatalog(live);
    const committedMd = readDoc("primitives.md");
    const committedJson = readDoc("primitives.json");
    expect(fresh.markdown).not.toBe(committedMd);
    expect(fresh.json).not.toBe(committedJson);

    const message = drift("primitives.md", committedMd, fresh.markdown, live);
    // The three things a drift failure has to do: say it is stale, say how
    // to fix it, and name what differs.
    expect(message).toContain("docs/primitives.md is stale");
    expect(message).toContain("npm run build && npm run docs:primitives");
    expect(message).toContain("registered but missing from the catalog: test/alpha, test/zeta");
    expect(message).toContain("first difference at line");
  });

  it("sorts primitives by name, whatever order they registered in", () => {
    const { json } = renderPrimitiveCatalog(live);
    const names = (JSON.parse(json) as { name: string }[]).map((p) => p.name);
    expect(names).toEqual([...names].sort());
    expect(names).toContain("test/alpha");
    expect(names).toContain("test/zeta");
  });

  it("renders the DERIVED param schema, which no registry record carries", () => {
    const { json, markdown } = renderPrimitiveCatalog(live);
    const entry = (JSON.parse(json) as { name: string; params: { name: string; schema: { type: string; acceptsField?: boolean } }[] }[]).find(
      (p) => p.name === "test/alpha",
    );
    expect(entry).toBeDefined();
    // `type` and `acceptsField` are absent from a serialized recipe by
    // design — they are re-derived from the inner targets' registered
    // schemas — so their presence here proves the catalog materialized the
    // primitive rather than transcribing its record.
    expect(entry?.params[0]).toMatchObject({
      name: "amount",
      schema: { type: "vec3", acceptsField: true },
    });
    expect(markdown).toContain("`amount` | vec3 |");
    expect(markdown).toContain("jit.amount");
    expect(markdown).toContain("pcg run test/alpha");
  });

  it("still renders identically twice with entries in it", () => {
    const a = renderPrimitiveCatalog(live);
    const b = renderPrimitiveCatalog(live.slice().reverse());
    expect(b.json).toBe(a.json);
    expect(b.markdown).toBe(a.markdown);
  });
});

/**
 * The "Writes to" column for a param that writes to nothing.
 *
 * Rendered from a hand-built record rather than a registered primitive:
 * the branch under test is the RENDERING of an empty target list, no
 * shipped primitive has one yet, and registering another `test/` name here
 * would land in `listSubgraphs()` for whatever ran after it. A blank cell
 * would say "this catalog has no data about that param", which is the one
 * thing that is not true of a knob the body's fields read by name.
 */
describe("a param with no targets", () => {
  const bindOnly: PrimitiveInfo = {
    name: "test/bind-only",
    hash: "0".repeat(16),
    meta: { title: "Bind only", description: "One knob, read by a field.", tags: [] },
    inputs: [],
    outputs: [{ name: "out", kind: "geometry" }],
    params: [
      {
        name: "amplitude",
        schema: { type: "f32", default: 1, description: "How tall." },
        targets: [],
      },
    ],
    nodes: 1,
  };

  it("says where its value goes instead of leaving the cell blank", () => {
    const { markdown } = renderPrimitiveCatalog([bindOnly]);
    const row = markdown.split("\n").find((line) => line.startsWith("| `amplitude`"));
    expect(row).toBeDefined();
    // The whole cell, so an empty one can never satisfy this.
    expect(row).toContain("| *(nothing — the body's field expressions read it by name)* |");
  });

  it("still renders a targeted param as the slots it writes into", () => {
    const targeted: PrimitiveInfo = {
      ...bindOnly,
      params: [{ ...bindOnly.params[0], targets: [{ node: "lift", param: "translate" }] }],
    };
    const { markdown } = renderPrimitiveCatalog([targeted]);
    const row = markdown.split("\n").find((line) => line.startsWith("| `amplitude`"));
    expect(row).toContain("lift.translate");
    expect(row).not.toContain("read it by name");
  });
});
