/**
 * The hand-authored `Field` extension point, run.
 *
 * `makeField` is the sanctioned door out of the field grammar: when what
 * you need is not an elementwise expression over the built-in fns, you
 * write the evaluator yourself. The docs (`llms.txt`, `docs/authoring.md`)
 * carry this example, and the trade it makes — a field the grammar cannot
 * describe cannot be serialized — so both halves are pinned here rather
 * than asserted in prose. Edit the doc and this test is what says whether
 * the new sentence is true.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import { Graph, cook, firstGeometry, makeGeometryItem } from "../graph/index.js";
import { pointGrid, serializeGraph, setAttribute, standardNode } from "../nodes/index.js";
import { attribute, position } from "./inputs.js";
import { component, mul } from "./combinators.js";
import { getFieldSpec } from "./spec.js";
import {
  type Column,
  type EvalContext,
  type Field,
  elementCount,
  evaluateField,
  isField,
  keyNum,
  keyRef,
  makeField,
} from "./types.js";

/**
 * THE WORKED EXAMPLE, verbatim in the docs.
 *
 * Standardize a field over the domain: subtract the mean, divide by the
 * standard deviation. It cannot be written in the grammar at any length,
 * because the grammar is elementwise — every fn sees one element at a
 * time — and mean and deviation are properties of the whole column.
 *
 * Reads component 0 of its input.
 */
function standardize(of: Field, epsilon = 1e-6): Field<1> {
  // `keyRef` length-prefixes the child key so no attribute name inside it
  // can forge the shape of a different parent; `keyNum` keeps -0 from
  // colliding with 0, which are different columns.
  const key = `standardize(${keyRef(of.key)},${keyNum(epsilon)})`;
  return makeField<1>(key, 1, (ctx: EvalContext): Column => {
    const n = elementCount(ctx);
    // `evaluateField`, not `of.evaluate`: it memoizes per context on
    // `Field.key`, so a sub-expression shared with a sibling is computed
    // once.
    const src = evaluateField(of, ctx);
    const out = new Float32Array(n);
    if (n === 0) return { data: out, tupleSize: 1 };
    let sum = 0;
    for (let i = 0; i < n; i++) sum += src.data[i * src.tupleSize];
    const mean = sum / n;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const d = src.data[i * src.tupleSize] - mean;
      sq += d * d;
    }
    const sd = Math.sqrt(sq / n);
    const scale = sd > epsilon ? 1 / sd : 0;
    for (let i = 0; i < n; i++) out[i] = (src.data[i * src.tupleSize] - mean) * scale;
    return { data: out, tupleSize: 1 };
  });
}

/**
 * A `Field`-shaped object literal that skips `makeField`. It compiles —
 * the interface does not declare the brand — and is not a Field.
 */
const impostor: Field<1> = {
  key: "impostor()",
  tupleSize: 1,
  evaluate: () => ({ data: new Float32Array([1, 2]), tupleSize: 1 }),
};

/** A cloud whose single scalar attribute holds the given values. */
function cloudWith(name: string, values: readonly number[]): EvalContext {
  const geo = createPointCloud(values.length);
  const attr = geo.attrs.point.add(name, "f32", 1);
  for (let i = 0; i < values.length; i++) attr.set(i, values[i]);
  return { geo, domain: "point", seed: 0 };
}

describe("makeField: the hand-authored extension point", () => {
  it("evaluates over a domain like any other field", () => {
    const ctx = cloudWith("w", [1, 2, 3, 4, 5]);
    const col = standardize(attribute("w", 1)).evaluate(ctx);
    expect(col.tupleSize).toBe(1);
    // mean 3, population sd sqrt(2)
    const sd = Math.SQRT2;
    expect([...col.data].map((v) => Number(v.toFixed(6)))).toEqual(
      [-2, -1, 0, 1, 2].map((d) => Number((d / sd).toFixed(6))),
    );
  });

  it("degenerate input divides by nothing", () => {
    const ctx = cloudWith("w", [7, 7, 7]);
    expect([...standardize(attribute("w", 1)).evaluate(ctx).data]).toEqual([0, 0, 0]);
  });

  it("an empty domain yields an empty column", () => {
    const ctx = cloudWith("w", []);
    expect(standardize(attribute("w", 1)).evaluate(ctx).data.length).toBe(0);
  });

  it("makeField brands it, so isField is the supported check", () => {
    const f = standardize(attribute("w", 1));
    expect(isField(f)).toBe(true);
  });

  it("a plain object literal type-checks as a Field but is NOT one", () => {
    // The `Field` interface does not declare the brand, so this compiles.
    // `isField` still says no. `makeField` is the only way in.
    expect(isField(impostor)).toBe(false);
  });

  it("and the un-branded literal is REFUSED, not quietly mis-cached", () => {
    // `isField` is the gate `Graph.add` asks. An object it does not
    // recognize as a field is judged against the schema's ordinary
    // type, so the mistake surfaces before the graph is built rather
    // than as a wrong column later. The docs quote this message.
    const g = new Graph(1);
    expect(() =>
      g.add(setAttribute, {
        name: "w",
        domain: "point",
        type: "f32",
        tupleSize: 1,
        value: impostor,
      }),
    ).toThrow(
      'add: node "setAttribute_0" (type "setAttribute") param "value": ' +
        'expected a finite number, got {"key":"impostor()","tupleSize":1}',
    );
  });

  it("evaluateField itself does NOT brand-check", () => {
    // Worth pinning because the obvious guess is wrong: the memo keys on
    // `key` with no `isField` call, so nothing about the memoization
    // depends on the brand. The brand's job is the param seam above.
    const ctx = cloudWith("w", [0, 0]);
    expect([...evaluateField(impostor, ctx).data]).toEqual([1, 2]);
  });

  it("the brand is enumerable, so a structural copy stays a Field", () => {
    const f = standardize(attribute("w", 1));
    expect(isField({ ...f })).toBe(true);
  });

  it("composes with the combinators in both directions", () => {
    const ctx = cloudWith("w", [1, 2, 3, 4, 5]);
    const outer = mul(standardize(attribute("w", 1)), 10);
    const col = outer.evaluate(ctx);
    expect(Number(col.data[4].toFixed(4))).toBe(Number((10 * (2 / Math.SQRT2)).toFixed(4)));
  });

  it("equal keys must mean equal columns: two calls are one field to the cache", () => {
    const ctx = cloudWith("w", [1, 2, 3, 4, 5]);
    const a = standardize(attribute("w", 1));
    const b = standardize(attribute("w", 1));
    expect(a.key).toBe(b.key);
    // Distinct instances, one evaluation: `evaluateField` keys on `key`.
    expect(evaluateField(b, ctx)).toBe(evaluateField(a, ctx));
  });

  it("a differing param gives a differing key", () => {
    expect(standardize(attribute("w", 1), 1e-6).key).not.toBe(
      standardize(attribute("w", 1), 1e-3).key,
    );
  });
});

describe("makeField: the trade", () => {
  /** A 2x2x1 grid, one attribute written from a hand-authored field. */
  function graphWithHandAuthoredParam(): Graph {
    const g = new Graph(7);
    const src = g.add(pointGrid, {
      countX: 2,
      countY: 1,
      countZ: 2,
      spacing: [1, 0, 1],
      origin: [0, 0, 0],
    });
    const set = g.add(setAttribute, {
      name: "rank",
      domain: "point",
      type: "f32",
      tupleSize: 1,
      value: standardize(component(position(), 0)),
    });
    g.connect(src, "out", set, "in");
    g.output(set, "out", "points");
    return g;
  }

  it("cooks: a hand-authored field is a first-class node param", async () => {
    const { outputs } = await cook(graphWithHandAuthoredParam());
    const geo = firstGeometry(outputs.points);
    if (!geo) throw new Error("no geometry on the `points` output");
    expect(geo.attrs.point.count).toBe(4);
    const rank = geo.attrs.point.require("rank");
    // Four points, x in {0, 1}: standardizing component 0 gives ±1.
    expect([...rank.data.subarray(0, 4)].map((v) => Number(v.toFixed(5))).sort()).toEqual([
      -1, -1, 1, 1,
    ]);
  });

  it("carries no spec, and the absence propagates outward", () => {
    // `getFieldSpec` answers "can this be described". Undefined here is
    // the same condition the GPU path reports as its `no-spec` fallback
    // reason, so a hand-authored field always evaluates on the CPU.
    expect(getFieldSpec(standardize(attribute("w", 1)))).toBeUndefined();
    expect(getFieldSpec(mul(standardize(attribute("w", 1)), 10))).toBeUndefined();
    // The grammar side of the same expression still describes itself.
    expect(getFieldSpec(mul(attribute("w", 1), 10))).toBeDefined();
  });

  it("but cannot be serialized, and the error says which field and why", () => {
    let message = "";
    try {
      serializeGraph(graphWithHandAuthoredParam());
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).toContain("makeField");
  });

  /**
   * The way back across the boundary, and the one the docs recommend:
   * the same computation as a REGISTERED node type. A node's params are
   * plain values, so nothing has to be described as a field expression,
   * and a graph using it serializes.
   */
  it("the same computation as a registered node type serializes", () => {
    const standardizeNode = standardNode<{ readonly attr: string; readonly out: string }>({
      type: "__test_standardize",
      category: "attribute",
      description: "Writes the standardized (mean 0, sd 1) values of a scalar attribute.",
      inputs: [{ name: "in", kind: "geometry" }],
      outputs: [{ name: "out", kind: "geometry" }],
      params: {
        attr: { type: "string", default: "P", description: "Scalar point attribute to read." },
        out: { type: "string", default: "rank", description: "Point attribute to write." },
      },
      execute: ({ inputs, params }) => {
        const geo = firstGeometry(inputs.in ?? []);
        if (!geo) throw new Error("__test_standardize: no geometry");
        const ctx: EvalContext = { geo, domain: "point", seed: 0 };
        const col = standardize(attribute(params.attr, 1)).evaluate(ctx);
        const dst = geo.attrs.point.add(params.out, "f32", 1);
        for (let i = 0; i < col.data.length; i++) dst.set(i, col.data[i]);
        return { out: [makeGeometryItem(geo)] };
      },
    });

    const g = new Graph(7);
    const src = g.add(pointGrid, { countX: 4, countY: 1, countZ: 1, spacing: [1, 0, 0] });
    const w = g.add(setAttribute, {
      name: "w",
      domain: "point",
      type: "f32",
      tupleSize: 1,
      value: component(position(), 0),
    });
    const std = g.add(standardizeNode, { attr: "w", out: "rank" });
    g.connect(src, "out", w, "in");
    g.connect(w, "out", std, "in");
    g.output(std, "out", "points");

    // No field expression in the graph is undescribable, so it saves.
    expect(() => serializeGraph(g)).not.toThrow();
  });
});

/**
 * The docs print this example. A test proving a claim the docs no longer
 * make is a test that passes forever while checking nothing, so the two
 * load-bearing literals are pinned: the structural key (which is where
 * `keyRef` and `keyNum` earn their place) and the sentence the reader is
 * told to expect when serialization refuses.
 *
 * These are deliberately NOT a whole-block comparison. Prose around them
 * should be free to move; what must not move in silence is the code a
 * reader will copy and the message they will see.
 */
describe("the docs print what this file proves", () => {
  const ROOT = new URL("../../", import.meta.url);
  const read = (file: string) => readFileSync(fileURLToPath(new URL(file, ROOT)), "utf8");

  const KEY_LINE = "const key = `standardize(${keyRef(of.key)},${keyNum(epsilon)})`;";
  // The refusal the docs now quote for an un-branded literal.
  const REFUSAL_ADD = 'expected a finite number, got {"key":"impostor()","tupleSize":1}';
  // The distinctive clause of the real fieldToJson refusal. The docs wrap
  // the message for width, so the check joins their wrapped lines first.
  const REFUSAL = "It was built by makeField, whose evaluator is an arbitrary closure";

  for (const file of ["docs/authoring.md", "llms.txt"]) {
    it(`${file} carries the worked example's key expression`, () => {
      expect(read(file)).toContain(KEY_LINE);
    });
  }

  it("docs/authoring.md quotes the refusals the library actually raises", () => {
    const unwrapped = read("docs/authoring.md").replaceAll(/\s+/g, " ");
    expect(unwrapped).toContain(REFUSAL);
    expect(unwrapped).toContain(REFUSAL_ADD);
  });

  it("llms.txt quotes the un-branded-literal refusal too", () => {
    expect(read("llms.txt").replaceAll(/\s+/g, " ")).toContain(REFUSAL_ADD);
  });

  it("the pinned key expression is the one the example builds", () => {
    // Closes the loop: the literal above is not merely present in the
    // prose, it is what `standardize` produces.
    expect(standardize(attribute("w", 1), 1e-6).key).toBe(
      `standardize(${keyRef(attribute("w", 1).key)},${keyNum(1e-6)})`,
    );
  });
});
