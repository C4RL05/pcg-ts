/**
 * Every field expression in every shipped graph, resolved twice — once as
 * written and once with `foldDomainConstants` applied — and required to
 * produce the same bytes.
 *
 * WHY THIS EXISTS AND `tests/graphs.test.ts` DOES NOT COVER IT. The fold
 * (`src/fields/fold.ts`) claims to change what a resolve costs and never
 * what it produces, and the commit that introduced it cited the 50-graph
 * golden as proof. That was an overclaim. `tests/graphs.golden.json` pins
 * element counts, attribute presence, type and tuple size, batch shape,
 * and — within a 1e-3 tolerance — `P` bounds and per-batch instance
 * transform statistics. It is a SHAPE gate, not a byte gate, and a one-ULP
 * drift in a colour or a scale would pass every file. The two float-exact tests in the suite compare a cook against
 * another cook of the same code, so both sides are folded and neither can
 * see a fold-induced change.
 *
 * This closes that gap at the level the claim is actually made: the
 * column. It does not cook the graphs — it lifts their field specs out
 * and evaluates them directly, which is cheaper and lets it compare the
 * folded and unfolded forms of the SAME expression, something no
 * whole-cook comparison can do without bundling the library twice.
 *
 * Complementary to the differential fuzz in `src/fields/fold.test.ts`,
 * which covers the grammar more broadly than the graphs do. This one
 * covers what actually ships, and will notice a construct a future graph
 * introduces that the fuzz never generates.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPointCloud } from "../src/data/index.js";
import { type EvalContext, evaluateField } from "../src/fields/index.js";
import { foldDomainConstants } from "../src/fields/fold.js";
import { GRAPHS_DIR, loadGraphs } from "../src/docs/graphIndex.js";
import { type FieldSpec, fieldFromJson } from "../src/nodes/index.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/**
 * Well past `MIN_ELEMENTS_TO_FOLD`, because this suite asks WHAT the fold
 * produces, not when it declines to run. The threshold has its own tests.
 */
const FOLD_ANY_SIZE = 1 << 20;

const isSpec = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) &&
  typeof (v as { fn?: unknown }).fn === "string";

/** Every field spec anywhere in a value, outermost first and not recursed into. */
function specsIn(value: unknown, out: FieldSpec[] = []): FieldSpec[] {
  if (isSpec(value)) {
    out.push(value as FieldSpec);
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) specsIn(v, out);
  } else if (typeof value === "object" && value !== null) {
    for (const v of Object.values(value)) specsIn(v, out);
  }
  return out;
}

/** A domain whose points genuinely differ, so a per-element leaf cannot masquerade as constant. */
function variedCtx(count: number, seed: number): EvalContext {
  const geo = createPointCloud(count);
  const P = geo.attrs.point.require("P");
  for (let i = 0; i < count; i++) P.setTuple(i, [i * 0.37 - 1, i * -0.11 + 2, i * 0.53]);
  return { geo, domain: "point", seed };
}

/**
 * Evaluate, reporting a throw as a value so the folded and unfolded forms
 * can be compared on failure as well as on success.
 */
function tryEvaluate(
  field: Parameters<typeof evaluateField>[0],
  ctx: EvalContext,
): { column?: ReturnType<typeof evaluateField>; error?: string } {
  try {
    return { column: evaluateField(field, ctx) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

interface Case {
  readonly graph: string;
  readonly node: string;
  readonly spec: FieldSpec;
  /** What a wrapping subgraph binds this body expression's params to. */
  readonly bindings?: Record<string, number | readonly number[]>;
}

/** A JSON node, as much of one as this file reads. */
interface GraphNode {
  readonly id?: string;
  readonly params?: Record<string, unknown>;
  readonly subgraph?: {
    readonly params?: { name?: string; default?: unknown }[];
    readonly graph?: { nodes?: GraphNode[] };
  };
}

/** A binding a field expression can take: the values, not the fields. */
function bindable(v: unknown): number | readonly number[] | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number" && Number.isFinite(x))) {
    return v as readonly number[];
  }
  return undefined;
}

/**
 * Every field expression in a node list, and — for a SUBGRAPH node — the
 * expressions in its body along with what the wrapper binds their `param`
 * references to.
 *
 * Bound, because that is how the graph cooks them: `withExposedParams`
 * calls `fieldFromJson(spec, bindings)` per cook, and the fold now folds
 * THROUGH those references. An unbound rebuild would exercise the
 * decline instead, which is the path this suite covered before and is no
 * longer the interesting one.
 */
function collect(nodes: readonly GraphNode[] | undefined, graph: string, cases: Case[]): void {
  for (const node of nodes ?? []) {
    for (const spec of specsIn(node.params)) {
      cases.push({ graph, node: String(node.id ?? "?"), spec });
    }
    const sub = node.subgraph;
    if (sub === undefined) continue;
    // The node's own values over the exposure's defaults — the same
    // precedence the wrapper applies, so what is bound here is what a cook
    // would bind.
    const bindings: Record<string, number | readonly number[]> = {};
    for (const exposed of sub.params ?? []) {
      const value = bindable(exposed.default);
      if (typeof exposed.name === "string" && value !== undefined) bindings[exposed.name] = value;
    }
    for (const [name, raw] of Object.entries(node.params ?? {})) {
      const value = bindable(raw);
      if (value !== undefined) bindings[name] = value;
    }
    const body: Case[] = [];
    collect(sub.graph?.nodes, graph, body);
    for (const c of body) cases.push({ ...c, bindings: c.bindings ?? bindings });
  }
}

const cases: Case[] = [];
for (const entry of loadGraphs(ROOT)) {
  const json = JSON.parse(readFileSync(`${ROOT}${entry.path}`, "utf8")) as { nodes?: GraphNode[] };
  collect(json.nodes, entry.path, cases);
}

describe(`field expressions across ${GRAPHS_DIR}/ fold without changing a byte`, () => {
  it("found expressions to check", () => {
    // Vacuity guard. Everything below is a loop over `cases`, so an empty
    // list would make this file pass while proving nothing — which is
    // precisely the failure the fold's own evidence had the first time.
    expect(cases.length).toBeGreaterThan(20);
  });

  let built = 0;
  let actuallyFolded = 0;
  let foldedThroughParam = 0;

  for (const [i, c] of cases.entries()) {
    it(`${c.graph} node "${c.node}" [${i}]`, () => {
      let field;
      try {
        field = fieldFromJson(c.spec, c.bindings);
      } catch {
        // A spec that does not stand alone — an unbound `param`, most
        // often, since bindings live outside the spec. Not this suite's
        // subject; the count assertion below keeps skips from hiding
        // everything.
        return;
      }
      built++;

      for (const [count, seed] of [
        [1, 7],
        [5, 0x9e3779b9],
        [9, 123456789],
      ] as const) {
        const ctx = variedCtx(count, seed);
        const folded = foldDomainConstants(field, seed, FOLD_ANY_SIZE);
        if (folded !== field) {
          actuallyFolded++;
          if (JSON.stringify(c.spec).includes('"fn":"param"')) foldedThroughParam++;
        }

        const a = tryEvaluate(field, ctx);
        const b = tryEvaluate(folded, ctx);

        // Most corpus expressions read attributes a bare point cloud does
        // not carry ("density", "scale", a spawner's own inputs), so they
        // throw here. That is not a gap to skip past: an optimization that
        // turned a clean "attribute not found" into a different error, or
        // into a silent wrong answer, would be a defect of exactly the
        // kind this file exists to catch. So the failure mode is compared
        // as carefully as the success one.
        expect(`${c.node}: ${b.error}`).toBe(`${c.node}: ${a.error}`);
        if (a.error !== undefined || a.column === undefined || b.column === undefined) continue;

        expect(b.column.tupleSize).toBe(a.column.tupleSize);
        expect(b.column.data.constructor).toBe(a.column.data.constructor);
        expect(b.column.data.length).toBe(a.column.data.length);
        for (let k = 0; k < a.column.data.length; k++) {
          // Object.is, not toBeCloseTo and not ===: this is a bit-exactness
          // claim, and it has to separate -0 from 0 and reject NaN drift.
          if (!Object.is(a.column.data[k], b.column.data[k])) {
            throw new Error(
              `${c.graph} node "${c.node}": folding changed element ${k} at count ${count}, ` +
                `seed ${seed} — unfolded ${a.column.data[k]}, folded ${b.column.data[k]}`,
            );
          }
        }
      }
    });
  }

  it("actually folded something, on more than one expression", () => {
    // The teeth. Every case above passes trivially if the fold declines
    // everything, so the suite has to prove it did work. If this fails
    // after a grammar change, the fold has gone silently inert — which is
    // a real defect and not a reason to lower the number.
    expect(built).toBeGreaterThan(20);
    expect(actuallyFolded).toBeGreaterThan(10);
    // And on an expression carrying a `param`, which the corpus reaches
    // only through a subgraph body cooked with its wrapper's bindings.
    // Zero here means the fold has gone back to refusing them, or that
    // this file stopped binding — either way the shipped param
    // expressions are no longer covered at the byte level.
    expect(foldedThroughParam).toBeGreaterThan(0);
  });
});
