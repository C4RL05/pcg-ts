/**
 * The text syntax's proof obligation.
 *
 * `spec.test.ts` states the bar for two descriptions of one computation:
 * "any disagreement between them is a silent numeric divergence with no
 * error anywhere", and pays for it with a per-constructor proof. Text is
 * the third description, and it is read and WRITTEN BACK by humans and
 * agents, so a disagreement here does not even need a divergent number to
 * do damage — it silently rewrites the tree somebody was editing.
 *
 * So the gate is the round trip, over the real corpus rather than over
 * examples chosen to pass:
 *
 * 1. `parseFieldText(printFieldSpec(spec))` deep-equals `spec`, for EVERY
 *    field spec in `graphs/**.json`.
 * 2. `printFieldSpec(parseFieldText(text))` returns `text` — printing is
 *    idempotent, so a view can be re-shown without drifting.
 * 3. Every registered fn survives both, not only the 36 the corpus uses.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { FieldJsonError, fieldFromJson, listFieldFnInfos } from "./fieldJson.js";
import { parseFieldText, printFieldSpec } from "./fieldText.js";
import type { FieldSpec } from "./spec.js";

const GRAPHS_DIR = fileURLToPath(new URL("../../graphs", import.meta.url));

function isSpec(v: unknown): v is FieldSpec {
  return typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as FieldSpec).fn === "string";
}

/**
 * Every field spec written as a param value anywhere in the graph corpus.
 *
 * Harvested by structure — any object with a string `fn` — rather than by
 * knowing which node types take a field, so a param added later is covered
 * without this file being told about it. Nested specs are NOT collected
 * separately: the top-level ones carry them, and round-tripping a root
 * exercises every child.
 */
function harvestCorpusSpecs(): { file: string; spec: FieldSpec }[] {
  const out: { file: string; spec: FieldSpec }[] = [];
  for (const file of readdirSync(GRAPHS_DIR).filter((f) => f.endsWith(".json"))) {
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) {
        for (const e of v) walk(e);
        return;
      }
      if (typeof v === "object" && v !== null) {
        if (isSpec(v)) {
          out.push({ file, spec: v });
          return;
        }
        for (const e of Object.values(v)) walk(e);
      }
    };
    walk(JSON.parse(readFileSync(join(GRAPHS_DIR, file), "utf8")));
  }
  return out;
}

const CORPUS = harvestCorpusSpecs();

describe("field text: the corpus round trip", () => {
  it("harvests the corpus rather than an empty set", () => {
    // An empty harvest would make every assertion below vacuously true,
    // which is the one way this suite could pass while proving nothing.
    expect(CORPUS.length).toBeGreaterThan(100);
  });

  it("parse(print(spec)) deep-equals spec, for every corpus spec", () => {
    for (const { file, spec } of CORPUS) {
      const text = printFieldSpec(spec);
      expect(parseFieldText(text), `${file}: ${text}`).toStrictEqual(spec);
    }
  });

  it("print(parse(text)) === text, for every corpus spec", () => {
    for (const { file, spec } of CORPUS) {
      const text = printFieldSpec(spec);
      expect(printFieldSpec(parseFieldText(text)), file).toBe(text);
    }
  });

  it("never prints the input-only sugar", () => {
    for (const { file, spec } of CORPUS) {
      const text = printFieldSpec(spec);
      expect(text, file).not.toContain("&&");
      expect(text, file).not.toContain("||");
    }
  });

  it("prints trees the grammar still accepts", () => {
    // Deep equality proves the SHAPE survived; this proves the shape was
    // legal in the first place, so a round trip cannot be green over a
    // tree `fieldFromJson` would refuse.
    for (const { file, spec } of CORPUS) {
      expect(() => fieldFromJson(parseFieldText(printFieldSpec(spec))), file).not.toThrow();
    }
  });
});

// One legal spec per fn with keys beyond `args`; the rest are generated
// from the registry's own arity below. Together they cover all 50 fns, so
// the 14 the corpus never writes are not left untested.
const EXAMPLES: Readonly<Record<string, FieldSpec>> = {
  constant: { fn: "constant", value: [1, 2, 3] },
  attribute: { fn: "attribute", name: "tangent", tupleSize: 3 },
  attributeIs: { fn: "attributeIs", name: "species", value: "pine" },
  byAttribute: { fn: "byAttribute", name: "part", cases: { rod: 1, bar: [1, 0.7, 1] }, default: 1 },
  component: { fn: "component", args: [{ fn: "position" }], index: 0 },
  ramp: {
    fn: "ramp",
    args: [{ fn: "attribute", name: "height" }],
    stops: [
      [4.5, 0.02],
      [14, 0.3],
    ],
  },
  randomField: { fn: "randomField", key: "thin" },
  // Width 3 only, so the generated `cross(1, 2)` would not build.
  cross: {
    fn: "cross",
    args: [
      [1, 0, 0],
      [0, 1, 0],
    ],
  },
  fbm: { fn: "fbm", base: "perlinNoise", opts: { octaves: 5, lacunarity: 2, gain: 0.5 } },
  param: { fn: "param", name: "amp", value: 24, min: 0, max: 40, description: "how far" },
  valueNoise: { fn: "valueNoise", opts: { frequency: 0.05, seed: { from: "node", variant: 0 } } },
  perlinNoise: {
    fn: "perlinNoise",
    opts: { frequency: 0.05, offset: [1, 2, 3], position: { fn: "position" }, normalized: true },
  },
  simplexNoise: { fn: "simplexNoise", opts: { seed: 7 } },
  worleyNoise: { fn: "worleyNoise", opts: { output: "f2-f1", normalized: true } },
};

function exampleFor(fn: string, args: readonly { name: string }[] | undefined): FieldSpec {
  const known = EXAMPLES[fn];
  if (known !== undefined) return known;
  if (args === undefined || args.length === 0) return { fn };
  return { fn, args: args.map((_a, i) => i + 1) };
}

describe("field text: every registered fn", () => {
  const infos = listFieldFnInfos();

  it("covers the whole registry", () => {
    expect(infos.length).toBeGreaterThan(40);
    for (const info of infos) {
      const spec = exampleFor(info.fn, info.keys.includes("args") ? info.args : undefined);
      const text = printFieldSpec(spec);
      expect(parseFieldText(text), `${info.fn}: ${text}`).toStrictEqual(spec);
      expect(printFieldSpec(parseFieldText(text)), info.fn).toBe(text);
      expect(() => fieldFromJson(spec), `${info.fn}: ${text}`).not.toThrow();
    }
  });

  it("prints the shapes the syntax promises", () => {
    expect(printFieldSpec(EXAMPLES.attribute as FieldSpec)).toBe('attribute("tangent", 3)');
    expect(printFieldSpec({ fn: "attribute", name: "density" })).toBe('attribute("density")');
    expect(printFieldSpec(EXAMPLES.attributeIs as FieldSpec)).toBe('attributeIs("species", "pine")');
    expect(printFieldSpec(EXAMPLES.byAttribute as FieldSpec)).toBe(
      'byAttribute("part", { rod: 1, bar: [1, 0.7, 1] }, 1)',
    );
    expect(printFieldSpec(EXAMPLES.component as FieldSpec)).toBe("component(position(), 0)");
    expect(printFieldSpec(EXAMPLES.ramp as FieldSpec)).toBe(
      'ramp(attribute("height"), [[4.5, 0.02], [14, 0.3]])',
    );
    expect(printFieldSpec(EXAMPLES.randomField as FieldSpec)).toBe('randomField("thin")');
    expect(printFieldSpec({ fn: "randomField" })).toBe("randomField()");
    expect(printFieldSpec({ fn: "fbm", base: "perlinNoise", opts: { octaves: 5 } })).toBe(
      "fbm(perlinNoise, { octaves: 5 })",
    );
    expect(printFieldSpec({ fn: "param", name: "amp", value: 24, min: 0 })).toBe(
      'param("amp", { value: 24, min: 0 })',
    );
    expect(printFieldSpec({ fn: "param", name: "amp" })).toBe('param("amp")');
    expect(
      printFieldSpec({ fn: "perlinNoise", opts: { frequency: 0.05, seed: { from: "node", variant: 0 } } }),
    ).toBe('perlinNoise({ frequency: 0.05, seed: { from: "node", variant: 0 } })');
    expect(printFieldSpec({ fn: "vec", args: [1, 2, { fn: "index" }] })).toBe("vec(1, 2, index())");
  });

  it("keeps a raw literal and an explicit constant apart", () => {
    // Semantically identical, structurally not — `buildArg` wraps the raw
    // form — and the corpus holds both in quantity. A view that printed
    // them alike would rewrite one into the other on every edit.
    const raw: FieldSpec = { fn: "mul", args: [{ fn: "position" }, 2] };
    const wrapped: FieldSpec = { fn: "mul", args: [{ fn: "position" }, { fn: "constant", value: 2 }] };
    expect(printFieldSpec(raw)).toBe("position() * 2");
    expect(printFieldSpec(wrapped)).toBe("position() * constant(2)");
    expect(parseFieldText(printFieldSpec(raw))).toStrictEqual(raw);
    expect(parseFieldText(printFieldSpec(wrapped))).toStrictEqual(wrapped);
  });

  it("refuses to print what it could not read back", () => {
    // The printer and the parser must reject the SAME specs. Anything the
    // printer emits that the parser refuses is a round trip that reports
    // success on one end and failure on the other.
    expect(() => printFieldSpec({ fn: "vec", args: [] })).toThrowError(/at least 1 arg/);
    expect(() => printFieldSpec({ fn: "byAttribute", name: "part", cases: { rod: 1 } })).toThrowError(
      /requires a "default"/,
    );
    expect(() => printFieldSpec({ fn: "attribute", tupleSize: 3 })).toThrowError(/requires a "name"/);
    expect(() => printFieldSpec({ fn: "perlnNoise" })).toThrowError(/closest: perlinNoise/);
    expect(() => printFieldSpec({ fn: "position", frequency: 2 })).toThrowError(/unknown key "frequency"/);
    expect(() => printFieldSpec({ fn: "constant", value: Number.POSITIVE_INFINITY })).toThrowError(
      /not finite/,
    );
  });

  it("normalizes an own key whose value is undefined, as JSON does", () => {
    // The ONE spec shape text does not preserve, pinned so it is a decided
    // property and not an accident. Unreachable from a serialized graph or
    // from `getFieldSpec` — every constructor with an optional key
    // branches on it rather than writing `undefined` — and the result
    // means exactly what the input means, which is why it normalizes
    // rather than throws.
    expect(printFieldSpec({ fn: "randomField", key: undefined })).toBe("randomField()");
    expect(parseFieldText("randomField()")).toStrictEqual({ fn: "randomField" });
    expect(printFieldSpec({ fn: "attribute", name: "d", tupleSize: undefined })).toBe('attribute("d")');
  });

  it("holds the same nesting bound as the JSON end, at both ends", () => {
    // A tree `fieldFromJson` accepts must print, and one it refuses must
    // refuse HERE too rather than run the stack out: an unbounded
    // recursion raises a bare RangeError, which names no position and is
    // exactly the failure `docs/authoring.md` rules out.
    const chain = (levels: number): FieldSpec => {
      let spec: FieldSpec = { fn: "position" };
      for (let i = 1; i < levels; i++) spec = { fn: "add", args: [spec, i] };
      return spec;
    };
    const deepest = chain(256);
    expect(() => fieldFromJson(deepest)).not.toThrow();
    expect(parseFieldText(printFieldSpec(deepest))).toStrictEqual(deepest);

    expect(() => printFieldSpec(chain(300))).toThrowError(/deeper than 256 levels/);
    const nested = `${"(".repeat(20000)}1${")".repeat(20000)}`;
    expect(() => parseFieldText(nested)).toThrowError(FieldJsonError);
    expect(() => parseFieldText(nested)).toThrowError(/1:257: field spec nesting deeper than 256/);
    // The bound is a limit, not a leak: the printer keeps working after
    // one call hit it.
    expect(printFieldSpec({ fn: "position" })).toBe("position()");
  });

  it("round-trips numbers to the identical double", () => {
    for (const value of [
      0, -0, 1, -1.5, 0.1, 0.36000000000000004, Math.PI, 1e21, 1e-7, 5e-324, Number.MAX_SAFE_INTEGER,
      -0.7071067811865475,
    ]) {
      const spec: FieldSpec = { fn: "constant", value };
      const back = parseFieldText(printFieldSpec(spec));
      expect(back, printFieldSpec(spec)).toStrictEqual(spec);
      expect(Object.is(back.value, value), printFieldSpec(spec)).toBe(true);
    }
  });
});

describe("field text: operators", () => {
  it("parses && and || as mul and max, and never prints them back", () => {
    const and = parseFieldText("attribute(\"d\") < 0.5 && randomField() > 0.2");
    expect(and).toStrictEqual({
      fn: "mul",
      args: [
        { fn: "lt", args: [{ fn: "attribute", name: "d" }, 0.5] },
        { fn: "gt", args: [{ fn: "randomField" }, 0.2] },
      ],
    });
    expect(printFieldSpec(and)).toBe('(attribute("d") < 0.5) * (randomField() > 0.2)');

    const or = parseFieldText("1 || 2");
    expect(or).toStrictEqual({ fn: "max", args: [1, 2] });
    expect(printFieldSpec(or)).toBe("max(1, 2)");

    // The sugar is INPUT-only in both directions: a `mul` whose operands
    // are not predicates prints as `*` too, so no reader is ever shown a
    // `&&` they did not type.
    expect(printFieldSpec({ fn: "mul", args: [2, 3] })).toBe("2 * 3");
  });

  it("prints minimal parentheses and keeps left associativity", () => {
    const sub = (a: unknown, b: unknown): FieldSpec => ({ fn: "sub", args: [a, b] });
    const div = (a: unknown, b: unknown): FieldSpec => ({ fn: "div", args: [a, b] });

    // Left-nested needs none; right-nested needs them, or the tree changes.
    expect(printFieldSpec(sub(sub(1, 2), 3))).toBe("1 - 2 - 3");
    expect(printFieldSpec(sub(1, sub(2, 3)))).toBe("1 - (2 - 3)");
    expect(printFieldSpec(div(div(1, 2), 3))).toBe("1 / 2 / 3");
    expect(printFieldSpec(div(1, div(2, 3)))).toBe("1 / (2 / 3)");
    expect(printFieldSpec(sub(div(1, 2), 3))).toBe("1 / 2 - 3");
    expect(printFieldSpec(div(sub(1, 2), 3))).toBe("(1 - 2) / 3");
    expect(printFieldSpec({ fn: "mul", args: [{ fn: "add", args: [1, 2] }, 3] })).toBe("(1 + 2) * 3");
    expect(printFieldSpec({ fn: "add", args: [1, { fn: "mul", args: [2, 3] }] })).toBe("1 + 2 * 3");
    expect(printFieldSpec({ fn: "lt", args: [{ fn: "add", args: [1, 2] }, 3] })).toBe("1 + 2 < 3");
    expect(printFieldSpec({ fn: "eq", args: [{ fn: "lt", args: [1, 2] }, 0] })).toBe("1 < 2 == 0");
    expect(printFieldSpec({ fn: "lt", args: [1, { fn: "eq", args: [2, 3] }] })).toBe("1 < (2 == 3)");

    // And what the printer emits is what the parser reads back.
    for (const spec of [sub(sub(1, 2), 3), sub(1, sub(2, 3)), div(1, div(2, 3)), div(sub(1, 2), 3)]) {
      expect(parseFieldText(printFieldSpec(spec))).toStrictEqual(spec);
    }
    expect(parseFieldText("1 - 2 - 3")).toStrictEqual(sub(sub(1, 2), 3));
    expect(parseFieldText("1 / 2 / 3")).toStrictEqual(div(div(1, 2), 3));
    expect(parseFieldText("1 + 2 * 3")).toStrictEqual({
      fn: "add",
      args: [1, { fn: "mul", args: [2, 3] }],
    });
  });

  it("folds unary minus into a literal, and desugars it otherwise", () => {
    expect(parseFieldText("position() * -1")).toStrictEqual({ fn: "mul", args: [{ fn: "position" }, -1] });
    expect(parseFieldText("position() - -1.5")).toStrictEqual({
      fn: "sub",
      args: [{ fn: "position" }, -1.5],
    });
    expect(printFieldSpec({ fn: "sub", args: [{ fn: "position" }, -1.5] })).toBe("position() - -1.5");
    // No negate fn exists, so a negated expression is `0 - x` — and that
    // is what prints back.
    const negated = parseFieldText("-position()");
    expect(negated).toStrictEqual({ fn: "sub", args: [0, { fn: "position" }] });
    expect(printFieldSpec(negated)).toBe("0 - position()");
  });

  it("reads redundant parentheses without recording them", () => {
    expect(parseFieldText("((1 + 2)) * 3")).toStrictEqual({
      fn: "mul",
      args: [{ fn: "add", args: [1, 2] }, 3],
    });
    expect(printFieldSpec(parseFieldText("((1 + 2)) * 3"))).toBe("(1 + 2) * 3");
  });
});

describe("field text: errors name the token, the position and the fix", () => {
  const failure = (text: string): string => {
    try {
      parseFieldText(text);
    } catch (err) {
      expect(err).toBeInstanceOf(FieldJsonError);
      return (err as Error).message;
    }
    throw new Error(`expected ${JSON.stringify(text)} to be rejected`);
  };

  it("names an unknown fn and the closest ones", () => {
    const msg = failure('perlnNoise({ frequency: 1 })');
    expect(msg).toContain("1:1");
    expect(msg).toContain('"perlnNoise"');
    expect(msg).toContain("perlinNoise");
    expect(msg).toContain("listFieldFns()");
  });

  it("names a missing operand at the end of the input", () => {
    const msg = failure("position() + ");
    expect(msg).toContain("1:14");
    expect(msg).toContain("end of input");
    expect(msg).toContain("expected a value");
  });

  it("names an unexpected operator token and where it sits", () => {
    const msg = failure('attribute("d") ** 2');
    expect(msg).toContain("1:17");
    expect(msg).toContain('"*"');
  });

  it("names a stray character and the operator it nearly is", () => {
    const msg = failure("1 = 2");
    expect(msg).toContain("1:3");
    expect(msg).toContain('"="');
    expect(msg).toContain('"=="');
  });

  it("names an unclosed call and where it was opened", () => {
    const msg = failure("add(1, 2");
    expect(msg).toContain("1:9");
    expect(msg).toContain('")"');
    expect(msg).toContain("1:1");
  });

  it("names trailing input after the expression", () => {
    const msg = failure("add(1, 2))");
    expect(msg).toContain("1:10");
    expect(msg).toContain('")"');
    expect(msg).toContain("one expression per field text");
  });

  it("names a bare identifier and how to call it", () => {
    const called = failure("position + 1");
    expect(called).toContain("1:1");
    expect(called).toContain('"position"');
    expect(called).toContain("position()");

    const unknown = failure('attribute(density)');
    expect(unknown).toContain("1:11");
    expect(unknown).toContain('"density"');
  });

  it("names a wrong argument count and prints the usage", () => {
    const few = failure("attribute()");
    expect(few).toContain("1:1");
    expect(few).toContain('"name"');
    expect(few).toContain("attribute(name, tupleSize?)");

    const many = failure('attribute("d", 1, 2)');
    expect(many).toContain("1:19");
    expect(many).toContain("at most 2");
  });

  it("names an unknown key in an options object", () => {
    const msg = failure('param("amp", { valu: 1 })');
    expect(msg).toContain("1:14");
    expect(msg).toContain('"valu"');
    expect(msg).toContain("value, min, max, description");
  });

  it("names a line and column past the first line", () => {
    const msg = failure("add(\n  1,\n  )");
    expect(msg).toContain("3:3");
  });

  it("refuses a bare value as a whole field text", () => {
    const msg = failure("3");
    expect(msg).toContain("1:1");
    expect(msg).toContain("constant(3)");
    expect(failure("")).toContain("empty");
  });
});

describe("names an author reaches for that are not fns", () => {
  // `P` is the case this exists for. It is the standard position attribute
  // everywhere else in the library, and the reviewer sentence that prompted
  // this whole syntax was written `length(P) < 20`. It is deliberately NOT
  // sugar — `position()` is what the TypeScript API is called and what the
  // printer emits — so the error has to teach the spelling instead, or the
  // motivating example fails with "unknown fn; closest: eq, ge, gt".
  it("points P at position() rather than at an edit-distance neighbour", () => {
    expect(() => parseFieldText("length(P) < 20")).toThrow(/did you mean position\(\)\?/);
    // As a CALL too, where the caller has not already quoted the word.
    expect(() => parseFieldText("P(1)")).toThrow(/"P" is not a field fn; did you mean position\(\)\?/);
  });

  it("still uses edit distance for an actual typo", () => {
    expect(() => parseFieldText("perlinNose({})")).toThrow(/closest: perlinNoise/);
  });

  it("does not quote the word twice when the caller already did", () => {
    const message = (text: string): string => {
      try {
        parseFieldText(text);
      } catch (e) {
        return (e as Error).message;
      }
      return "";
    };
    // The MEANT_INSTEAD branch…
    expect(message("length(P) < 20").match(/"P"/g)).toHaveLength(1);
    // …and the edit-distance one, which is the same sentence with a
    // different second half and so has the same rule to follow.
    const typo = message("perlinNose < 20");
    expect(typo).toContain("closest: perlinNoise");
    expect(typo.match(/"perlinNose"/g)).toHaveLength(1);
  });
});
