/**
 * `byAttribute`: the N-way form of `attributeIs`, and the one fn whose
 * fall-through has a NAME.
 *
 * Two properties carry most of the weight here, and neither is an
 * implementation detail.
 *
 * The first is partition-independence, inherited whole from `attributeIs`
 * and for the same reason: a string column stores indices into a table
 * ordinary work rebuilds — `setAttribute` interns a declared list up
 * front, clone/filter/merge re-intern per element and compact — so one
 * logical value sits at different indices in different cells of one
 * world, and a cell that legitimately holds no `clamp` has no `"clamp"`
 * in its table at all. A case key is therefore NEVER validated against
 * the table: an absent key selects nothing and its elements take the
 * `default`. The two cells below are built with tables that disagree
 * DELIBERATELY, in membership and in index order, and the disagreement is
 * asserted before the agreement is, so the test cannot pass on tables
 * that happened to line up.
 *
 * The second is that `cases` is a new SPEC-VALUED POSITION — the first
 * since a noise's `opts.position` — so every walker that hard-codes where
 * specs hang off a node had to learn it. The `paramNamesOf` and fold
 * cases at the bottom of this file are that check: the fold cross-checks
 * its own walk against `paramNamesOf`'s and declines when they disagree,
 * so a walker left untaught surfaces as a wrong answer or a throw rather
 * than as silence.
 */
import { describe, expect, it } from "vitest";
import { type Domain, Geometry, createPointCloud, createTriangleMesh } from "../data/index.js";
import { mul } from "./combinators.js";
import {
  type FieldSpec,
  FieldJsonError,
  fieldFromJson,
  fieldToJson,
  fnVariation,
  inlineParamValuesOf,
  paramNamesOf,
} from "./fieldJson.js";
import { foldDomainConstants } from "./fold.js";
import { attribute, byAttribute } from "./inputs.js";
import { getFieldSpec } from "./spec.js";
import { type Column, type EvalContext, type Field, evaluateField } from "./types.js";

function ctxOf(geo: Geometry, domain: Domain = "point", seed = 0): EvalContext {
  return { geo, domain, seed };
}

function column(field: Field, ctx: EvalContext): number[] {
  return Array.from(evaluateField(field, ctx).data);
}

/** The raw bytes of a column, for the byte-identity claim below. */
function bytes(col: Column): Uint8Array {
  return new Uint8Array(col.data.buffer, col.data.byteOffset, col.data.byteLength);
}

/**
 * The rig's four part kinds. `clamp` is the one with no case anywhere in
 * this file: it is the element that takes the default, which is the whole
 * subject of the fn.
 */
const KINDS = ["rod", "panel", "bar", "clamp"] as const;

/** The logical parts every geometry in this file agrees about. */
const PARTS = ["rod", "panel", "bar", "panel", "rod", "clamp"] as const;

/**
 * A point cloud holding a SUBSET of {@link PARTS}, whose string table is
 * built in an order the caller chooses.
 *
 * `members` are the logical indices this cell holds, in element order.
 * `internOrder` is the sequence of LOCAL indices written, which is what
 * fixes the table's index order (first encounter wins) — the same freedom
 * a filter or a merge exercises upstream, and independent of which
 * element ends up holding which part. `declared` interns values before
 * any element is written, standing in for `setAttribute`'s declared list,
 * which puts entries in the table that no element uses.
 */
function cell(
  members: readonly number[],
  internOrder: readonly number[] = members.map((_, i) => i),
  declared: readonly string[] = [],
): Geometry {
  const geo = createPointCloud(members.length);
  const attr = geo.attrs.point.add("part", "string");
  for (const value of declared) attr.internString(value);
  for (const local of internOrder) attr.setString(local, PARTS[members[local]]);
  return geo;
}

const ALL = [0, 1, 2, 3, 4, 5];

describe("byAttribute", () => {
  it("selects the case whose key is the element's value, and the default elsewhere", () => {
    const ctx = ctxOf(cell(ALL));
    const field = byAttribute("part", { rod: 1, panel: 2, bar: 3 }, 9);
    // PARTS is rod, panel, bar, panel, rod, clamp — and `clamp` is named
    // by no case, so it is the default that answers for it.
    expect(column(field, ctx)).toEqual([1, 2, 3, 2, 1, 9]);
  });

  it("resolves on every domain", () => {
    // Two triangles over four points, so each domain has a distinct count
    // and the kind cycle lands differently on each.
    const geo = createTriangleMesh([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3]);
    const field = byAttribute("part", { rod: 1, panel: 2, bar: 3 }, 9);
    const expected: Record<Domain, number[]> = {
      point: [1, 2, 3, 9],
      vertex: [1, 2, 3, 9, 1, 2],
      primitive: [1, 2],
      detail: [1],
    };
    for (const domain of ["point", "vertex", "primitive", "detail"] as const) {
      const set = geo.attrs[domain];
      const attr = set.add("part", "string");
      for (let i = 0; i < set.count; i++) attr.setString(i, KINDS[i % KINDS.length]);
      expect(column(field, ctxOf(geo, domain)), domain).toEqual(expected[domain]);
    }
  });

  it("yields an empty column on an empty domain", () => {
    const geo = createPointCloud(0);
    geo.attrs.point.add("part", "string");
    expect(column(byAttribute("part", { rod: 1 }, 0), ctxOf(geo))).toEqual([]);
  });

  it("reads component 0 of a tuple-valued string attribute", () => {
    // The selector reads one component of the column; it takes the first,
    // as `Attribute.getString` and `attributeIs` do.
    const geo = createPointCloud(3);
    const attr = geo.attrs.point.add("pair", "string", 2);
    attr.setString(0, "rod", 0);
    attr.setString(0, "panel", 1);
    attr.setString(1, "panel", 0);
    attr.setString(1, "rod", 1);
    attr.setString(2, "clamp", 0);
    expect(column(byAttribute("pair", { rod: 1, panel: 2 }, 9), ctxOf(geo))).toEqual([1, 2, 9]);
  });
});

describe("byAttribute: what a case value may be", () => {
  /**
   * One geometry carrying all three case-value kinds at once, because the
   * broadcast that widens the scalar branches is a property of the whole
   * case SET and cannot be observed one branch at a time.
   *
   * Every literal here is exactly representable in f32, so the assertions
   * can be written as the numbers an author would read rather than as
   * `Math.fround` calls that would hide an arithmetic mistake behind a
   * rounding one.
   */
  function rigCell(): Geometry {
    const geo = createPointCloud(4);
    const part = geo.attrs.point.add("part", "string");
    const density = geo.attrs.point.require("density");
    for (let i = 0; i < 4; i++) {
      part.setString(i, KINDS[i]);
      density.set(i, i + 1);
    }
    return geo;
  }

  const field = byAttribute(
    "part",
    {
      rod: 0.5, // a scalar
      panel: [1, 0.5, 2], // a tuple
      bar: mul(attribute("density"), 2), // a nested spec, per element
    },
    9, // a SCALAR default against tuple cases
  );

  it("takes a scalar, a tuple and a nested spec in one case set", () => {
    expect(column(field, ctxOf(rigCell()))).toEqual([
      0.5, 0.5, 0.5, // rod: the scalar case, splatted
      1, 0.5, 2, // panel: the tuple case, verbatim
      6, 6, 6, // bar: density 3 * 2, splatted
      9, 9, 9, // clamp: the scalar default, splatted
    ]);
  });

  it("is as wide as the broadcast of every branch, the default included", () => {
    const col = evaluateField(field, ctxOf(rigCell()));
    expect(col.tupleSize).toBe(3);
    // The width is a property of the EXPRESSION, so it does not move with
    // which case fired: element 3 matched nothing and is still 3 wide.
    expect(Array.from(col.data.slice(9))).toEqual([9, 9, 9]);
    // Not statically known here, because `attribute("density")` declares
    // no tupleSize — which is exactly why the rule is checked twice, once
    // at construction and once over the produced columns.
    expect(field.tupleSize).toBeUndefined();
    // With every branch's width static, the constructor knows it up front.
    expect(byAttribute("part", { rod: [1, 2, 3] }, 0).tupleSize).toBe(3);
  });
});

describe("byAttribute: a key the table does not hold", () => {
  it("takes the default instead of throwing", () => {
    // A misspelled key is dead code, not an error — see the module note.
    // `pnael` matches nothing, so every panel falls to the default.
    const field = byAttribute("part", { rod: 1, pnael: 2 }, 9);
    expect(column(field, ctxOf(cell(ALL)))).toEqual([1, 9, 9, 9, 1, 9]);
  });

  it("leaves the string table untouched", () => {
    // The regression guard against `internString` creeping in where
    // `lookupString` belongs. Interning on a miss would ALSO take the
    // default — no element holds the index it just added — so the numbers
    // above cannot catch it and the table has to be inspected directly.
    const geo = cell(ALL);
    const attr = geo.attrs.point.require("part");
    const before = [...attr.stringTable];
    for (let pass = 0; pass < 2; pass++) {
      column(byAttribute("part", { pnael: 1, strut: 2 }, 9), ctxOf(geo));
    }
    expect(attr.stringTable).toEqual(before);
    expect(attr.stringTable).not.toContain("pnael");
    expect(attr.lookupString("strut")).toBeUndefined();
  });

  it("takes the default for every element when NO case key is in the table", () => {
    const field = byAttribute("part", { strut: 1, gusset: 2 }, 7);
    expect(column(field, ctxOf(cell(ALL)))).toEqual([7, 7, 7, 7, 7, 7]);
  });
});

describe("byAttribute: partition independence", () => {
  /**
   * The same six logical points split into two cells whose tables
   * disagree as thoroughly as ordinary upstream work can make them
   * disagree.
   *
   * Cell A holds logical 0,1,2 (rod, panel, bar) written front to back.
   * Cell B holds logical 3,4,5 (panel, rod, clamp), declares `"strut"`
   * before any element is written, and writes its rod BEFORE its panel.
   * The tables that produces:
   *
   *     A: ["", "rod", "panel", "bar"]
   *     B: ["", "strut", "rod", "panel", "clamp"]
   *
   * Membership disagrees both ways — `bar` is unknown to B, `clamp` and
   * `strut` unknown to A — and the two values they SHARE are at different
   * indices in each (rod 1 vs 2, panel 2 vs 3). Both halves are asserted
   * below before any result is compared, so this cannot pass on tables
   * that happened to agree.
   */
  const whole = cell(ALL);
  const a = cell([0, 1, 2]);
  const b = cell([3, 4, 5], [1, 0, 2], ["strut"]);
  const tableOf = (g: Geometry) => g.attrs.point.require("part").stringTable;

  it("the two tables really do disagree, in membership and in index order", () => {
    expect(tableOf(a)).toEqual(["", "rod", "panel", "bar"]);
    expect(tableOf(b)).toEqual(["", "strut", "rod", "panel", "clamp"]);
    // Membership, in both directions.
    expect(tableOf(a)).not.toContain("clamp");
    expect(tableOf(b)).not.toContain("bar");
    // Index order: the values both cells hold sit at different indices.
    const at = (g: Geometry, v: string) => tableOf(g).indexOf(v);
    expect([at(a, "rod"), at(a, "panel")]).toEqual([1, 2]);
    expect([at(b, "rod"), at(b, "panel")]).toEqual([2, 3]);
    // ...so ONE logical kind is stored as a different NUMBER in each
    // cell: A's rod (element 0) holds 1 where B's rod (element 1) holds
    // 2. That is what makes the agreement below worth asserting — a fn
    // that handed back the table index would pass every other case in
    // this file and fail only here.
    const raw = (g: Geometry, i: number) => g.attrs.point.require("part").data[i];
    expect(raw(a, 0)).toBe(1);
    expect(raw(b, 1)).toBe(2);
    expect(raw(a, 0)).not.toBe(raw(b, 1));
  });

  const cases = { rod: 1, panel: 2, bar: 3, strut: 4 } as const;

  it("gives each point the same answer whichever cell cooked it", () => {
    // `strut` is a case whose key is in B's table and in no element, and
    // `clamp` an element whose kind is in no case: between them the two
    // ways a case set and a table can fail to line up are both covered.
    const field = byAttribute("part", cases, 9);
    const fromWhole = column(field, ctxOf(whole));
    const split = [...column(field, ctxOf(a)), ...column(field, ctxOf(b))];
    expect(split).toEqual(fromWhole);
    // Pinned against the answer too, so "both wrong the same way" is not
    // what this passes on.
    expect(fromWhole).toEqual(PARTS.map((p) => (p in cases ? cases[p as keyof typeof cases] : 9)));
  });

  it("agrees per case key, including the keys each table is missing", () => {
    for (const key of ["rod", "panel", "bar", "clamp", "strut", ""]) {
      const field = byAttribute("part", { [key]: 1 }, 0);
      const split = [...column(field, ctxOf(a)), ...column(field, ctxOf(b))];
      expect(split, key).toEqual(column(field, ctxOf(whole)));
    }
  });

  it("gives one answer per case set, however the keys punctuate", () => {
    // Fields memoize on `key` within a context, so two DIFFERENT case
    // sets sharing a key would serve each other's column. An attribute
    // name and a case key are both arbitrary strings; the key escapes
    // both so neither can forge the shape of the other.
    const forged = byAttribute('part","x"=1', { y: 1 }, 0);
    const honest = byAttribute("part", { 'x"=1,"y': 1 }, 0);
    expect(forged.key).not.toBe(honest.key);
    expect(byAttribute("part", { rod: 1 }, 0).key).toBe(byAttribute("part", { rod: 1 }, 0).key);
    expect(byAttribute("part", { rod: 1 }, 0).key).not.toBe(byAttribute("part", { bar: 1 }, 0).key);
    // The default is part of the identity too, not just the cases.
    expect(byAttribute("part", { rod: 1 }, 0).key).not.toBe(byAttribute("part", { rod: 1 }, 5).key);
  });
});

describe("byAttribute: order independence", () => {
  // At most one case can fire — distinct keys intern at distinct table
  // indices — so the answer cannot depend on the order the cases are
  // written in. The two objects below are asserted to be genuinely
  // differently ordered first: without that, this would be comparing a
  // field with itself and would pass on any implementation at all.
  const forward = { rod: 1, panel: [1, 0.5, 2], bar: 3 } as const;
  const reversed = { bar: 3, panel: [1, 0.5, 2], rod: 1 } as const;

  it("the two case sets really are written in different orders", () => {
    expect(Object.keys(forward)).toEqual(["rod", "panel", "bar"]);
    expect(Object.keys(reversed)).toEqual(["bar", "panel", "rod"]);
    expect(Object.keys(forward)).not.toEqual(Object.keys(reversed));
    // And the difference survives into the spec, which records what the
    // author wrote rather than the sorted order the key uses.
    const keysOf = (f: Field) => Object.keys((getFieldSpec(f) as FieldSpec).cases as object);
    expect(keysOf(byAttribute("part", forward, 9))).toEqual(["rod", "panel", "bar"]);
    expect(keysOf(byAttribute("part", reversed, 9))).toEqual(["bar", "panel", "rod"]);
  });

  it("permuting the cases is one field and one column, byte for byte", () => {
    const one = byAttribute("part", forward, 9);
    const other = byAttribute("part", reversed, 9);
    expect(other.key).toBe(one.key);
    // Separate contexts, because equal keys share a memoized column
    // within one — evaluating both against the same context would compare
    // a column with itself and prove nothing.
    const colOne = evaluateField(one, ctxOf(cell(ALL)));
    const colOther = evaluateField(other, ctxOf(cell(ALL)));
    expect(colOther.tupleSize).toBe(colOne.tupleSize);
    expect(bytes(colOther)).toEqual(bytes(colOne));
  });
});

describe("byAttribute: the empty-string case key", () => {
  it("selects the elements nobody ever wrote to", () => {
    // "" is the default entry every string attribute interns at index 0,
    // so it is the one key that is in every table — and it names the
    // elements an upstream node never assigned, which is a real
    // population and not a degenerate one.
    const geo = createPointCloud(4);
    const attr = geo.attrs.point.add("part", "string");
    attr.setString(0, "rod");
    attr.setString(2, "rod");
    expect(column(byAttribute("part", { rod: 1, "": 2 }, 9), ctxOf(geo))).toEqual([1, 2, 1, 2]);
  });
});

describe("byAttribute: structural mistakes", () => {
  it("throws on a missing attribute", () => {
    // Absence of a VALUE is data — it takes the default. Absence of the
    // ATTRIBUTE is a bug, and the two are on opposite sides of the line.
    const geo = createPointCloud(3);
    expect(() => column(byAttribute("part", { rod: 1 }, 0), ctxOf(geo))).toThrow(
      /attribute "part" not found/,
    );
  });

  it("throws on a numeric attribute, naming eq() as the fix", () => {
    const geo = createPointCloud(3);
    const field = byAttribute("density", { rod: 1 }, 0);
    expect(() => column(field, ctxOf(geo))).toThrow(
      /byAttribute "density": expected a string attribute, got f32/,
    );
    expect(() => column(field, ctxOf(geo))).toThrow(/eq\(attribute\("density"\), value\)/);
  });
});

describe("byAttribute: construction refusals", () => {
  it("refuses an empty case set", () => {
    // A case set with no cases is a `default` written the long way, which
    // is far likelier to be a lost edit than an intention.
    expect(() => byAttribute("part", {}, 1)).toThrow(
      /byAttribute "part": `cases` must name at least one value/,
    );
    expect(() => byAttribute("part", {}, 1)).toThrow(/its default written the long way/);
  });

  it("refuses two non-scalar widths, naming the case key and both sizes", () => {
    // The offending KEY is the whole reason this message exists rather
    // than the generic broadcast one: "3 vs 2" without a name sends an
    // author looking through every branch.
    const build = () => byAttribute("part", { panel: [1, 2, 3], rod: [1, 2] }, 0);
    expect(build).toThrow(/byAttribute "part": case "rod" has tuple size 2/);
    expect(build).toThrow(/but case "panel" has tuple size 3/);
    expect(build).toThrow(/a scalar broadcasts against any size/);
  });

  it("accepts a scalar against any width, which is the library's ordinary rule", () => {
    // Stricter than the idiom it replaces would block the rewrite it
    // exists for: the nested `lerp`s already broadcast a scalar branch.
    expect(() => byAttribute("part", { panel: [1, 2, 3], rod: 1 }, 0)).not.toThrow();
    expect(byAttribute("part", { panel: [1, 2, 3], rod: 1 }, 0).tupleSize).toBe(3);
    // Including when the DEFAULT is the wide one.
    expect(byAttribute("part", { rod: 1 }, [1, 2, 3]).tupleSize).toBe(3);
  });
});

describe("byAttribute: grammar refusals", () => {
  it("refuses a missing or empty name", () => {
    expect(() => fieldFromJson({ fn: "byAttribute", cases: { rod: 1 }, default: 0 })).toThrow(
      FieldJsonError,
    );
    expect(() =>
      fieldFromJson({ fn: "byAttribute", name: "", cases: { rod: 1 }, default: 0 }),
    ).toThrow(/byAttribute requires a non-empty string name/);
  });

  it("refuses a `cases` that is not an object", () => {
    expect(() =>
      fieldFromJson({ fn: "byAttribute", name: "part", cases: [1, 2], default: 0 }),
    ).toThrow(/byAttribute requires a "cases" object keyed by the string values of "part"/);
    expect(() => fieldFromJson({ fn: "byAttribute", name: "part", cases: 3, default: 0 })).toThrow(
      FieldJsonError,
    );
  });

  it("refuses an empty case set", () => {
    expect(() => fieldFromJson({ fn: "byAttribute", name: "part", cases: {}, default: 0 })).toThrow(
      /byAttribute requires at least one case/,
    );
  });

  it("refuses a missing default, and says WHY it is required", () => {
    // The one refusal that is not merely structural. An optional default
    // would reinstate, one level down, the exact defect this fn removes:
    // a fall-through nobody wrote. So the message has to argue, not just
    // report a missing key.
    const build = () => fieldFromJson({ fn: "byAttribute", name: "part", cases: { rod: 1 } });
    expect(build).toThrow(FieldJsonError);
    expect(build).toThrow(/byAttribute requires a "default"/);
    expect(build).toThrow(/matches no case has to resolve to something/);
    expect(build).toThrow(/naming it here is the point of this fn/);
    // And it tells the author what to write, including the case they are
    // likeliest to think is impossible: every value has a case, but a key
    // this table does not hold still lands on the default.
    expect(build).toThrow(/write a number, a tuple, or a spec/);
    expect(build).toThrow(/the default is reachable even when every value you expect has a case/);
  });

  it("refuses keys the fn does not have", () => {
    // `value` is `attributeIs`'s key, so it is the plausible typo — and
    // silently ignoring it would build a field the author did not write.
    expect(() =>
      fieldFromJson({
        fn: "byAttribute",
        name: "part",
        cases: { rod: 1 },
        default: 0,
        value: "rod",
      }),
    ).toThrow(/unknown key "value"/);
  });

  it("reads a column, so the fold must not treat it as uniform", () => {
    // Stronger here than for `attributeIs`: even when every case VALUE is
    // uniform, WHICH case fires is read per element.
    expect(fnVariation("byAttribute")).toBe("per-element");
  });

  it("withholds a spec for a name the grammar would reject", () => {
    expect(getFieldSpec(byAttribute("", { rod: 1 }, 0))).toBeUndefined();
  });
});

describe("byAttribute: round trip", () => {
  const authored: FieldSpec = {
    fn: "byAttribute",
    name: "part",
    cases: {
      rod: 1,
      panel: [1, 0.5, 2],
      bar: { fn: "mul", args: [{ fn: "attribute", name: "density" }, 2] },
    },
    default: 9,
  };

  it("hands an authored spec back verbatim, case order included", () => {
    const out = fieldToJson(fieldFromJson(structuredClone(authored)));
    expect(out).toEqual(authored);
    // `toEqual` is order-blind on object keys, and the case order is
    // exactly what a caller diffing a saved graph would see move.
    expect(Object.keys(out.cases as object)).toEqual(["rod", "panel", "bar"]);
  });

  it("carries a derived spec back to an equal column", () => {
    const field = byAttribute(
      "part",
      { rod: 1, panel: [1, 0.5, 2], bar: mul(attribute("density"), 2) },
      9,
    );
    const spec = getFieldSpec(field) as FieldSpec;
    const rebuilt = fieldFromJson(JSON.parse(JSON.stringify(spec)) as FieldSpec);
    expect(rebuilt.key).toBe(field.key);
    // Separate contexts, for the reason the order-independence case gives.
    expect(column(rebuilt, ctxOf(cell(ALL)))).toEqual(column(field, ctxOf(cell(ALL))));
  });
});

describe("byAttribute: the walkers the new spec positions had to teach", () => {
  /**
   * A `param` inside a case value AND inside the default. Both positions
   * are new to the grammar — `cases` is the first spec-valued position
   * since a noise's `opts.position` — and a walker that was never taught
   * them reports neither.
   */
  const withParams: FieldSpec = {
    fn: "byAttribute",
    name: "part",
    cases: {
      rod: { fn: "mul", args: [{ fn: "param", name: "rodScale", value: 3 }, 2] },
      panel: 1,
    },
    default: { fn: "mul", args: [{ fn: "param", name: "baseScale", value: 0.5 }, 4] },
  };

  it("paramNamesOf finds a param in a case value and in the default", () => {
    expect(paramNamesOf(withParams)).toEqual(["baseScale", "rodScale"]);
  });

  it("inlineParamValuesOf finds the values those references supply", () => {
    expect(inlineParamValuesOf(withParams)).toEqual({ rodScale: 3, baseScale: 0.5 });
  });

  it("the domain-constant fold sees through both, and answers in numbers", () => {
    // The fold cross-checks its own walk against `paramNamesOf`'s and
    // DECLINES when they disagree, so an untaught walker costs a wrong
    // answer or an unbound-param throw here rather than silence. The
    // `not.toBe` is what keeps this honest: a declined fold returns the
    // very same field, and every number below would still be right.
    const field = fieldFromJson(structuredClone(withParams));
    const folded = foldDomainConstants(field, 0x9e3779b9, 1 << 20);
    expect(folded).not.toBe(field);

    // rod: 3 * 2, panel: 1 verbatim, everything else: 0.5 * 4.
    const expected = [6, 1, 2, 1, 6, 2];
    expect(column(folded, ctxOf(cell(ALL)))).toEqual(expected);
    // And the same numbers the unfolded field produces, which is the
    // whole contract of the fold: it changes cost, never output.
    expect(column(field, ctxOf(cell(ALL)))).toEqual(expected);

    // The branches folded to literals; the selection itself did not,
    // because which case fires is read per element.
    const out = fieldToJson(folded) as { fn: string; cases: Record<string, unknown>; default: unknown };
    expect(out.fn).toBe("byAttribute");
    expect(out.cases.rod).toEqual({ fn: "constant", value: 6 });
    expect(out.default).toEqual({ fn: "constant", value: 2 });
  });
  // A case key is an author's string, and `"__proto__"` is one of the
  // strings an author may write. It reached here as a real DEFECT, found
  // by re-derivation rather than by any of the tests above: `JSON.parse`
  // gives the spec a genuine own `"__proto__"` property, but copying the
  // case set onto a PLAIN `{}` ran `Object.prototype`'s setter instead of
  // creating a property, so the case silently vanished on the CPU — while
  // the WGSL compiler, which reads `Object.keys` straight off the raw
  // spec, still allocated its uniform slot and answered 5. A CPU/GPU
  // disagreement in the one place this fn promises exactness, on an input
  // that throws nothing and logs nothing.
  describe("a __proto__ case key", () => {
    // Built through JSON.parse deliberately: an object LITERAL written
    // `{__proto__: 5}` sets the prototype rather than creating a
    // property, which is the author's own choice and a different case.
    const raw = () =>
      JSON.parse(
        '{"fn":"byAttribute","name":"part","cases":{"__proto__":5,"rod":1,"bar":2},"default":9}',
      ) as FieldSpec;

    // The fixture's third kind, renamed to the dangerous string, so the
    // column actually contains an element that must select it.
    function protoCell(): Geometry {
      const geo = createPointCloud(3);
      const attr = geo.attrs.point.add("part", "string");
      attr.setString(0, "rod");
      attr.setString(1, "__proto__");
      attr.setString(2, "bar");
      return geo;
    }

    it("selects its case rather than falling through to the default", () => {
      expect(column(fieldFromJson(raw()), ctxOf(protoCell()))).toEqual([1, 5, 2]);
    });

    it("survives into the spec, so the kernel and the column agree", () => {
      // The other half of the same defect: the CONSTRUCTOR dropped the key
      // from the spec it derived, so the column was right and
      // `fieldToJson` emitted a case set one case short — and anything
      // compiled from that spec answered the default where the CPU did
      // not. `Object.hasOwn`, because a plain lookup would be satisfied by
      // `Object.prototype` itself.
      const cases = JSON.parse('{"__proto__":5,"rod":1,"bar":2}') as Record<string, number>;
      const field = byAttribute("part", cases, 9);
      expect(column(field, ctxOf(protoCell()))).toEqual([1, 5, 2]);
      const spec = getFieldSpec(field) as FieldSpec;
      const emitted = spec.cases as Record<string, unknown>;
      expect(Object.hasOwn(emitted, "__proto__")).toBe(true);
      expect(Object.keys(emitted).sort()).toEqual(["__proto__", "bar", "rod"]);
    });

    it("is a case set of one, and describes itself as one", () => {
      // A lone `"__proto__"` is the sharpest version of the spec half:
      // the column was always right (the evaluator closes over the case
      // list, not over the spec), while the emitted spec held NO cases at
      // all — a `byAttribute` that `fieldFromJson` would then reject
      // outright. So the column assertion below does not discriminate and
      // the spec assertion does; both are here because the pair is the
      // claim.
      const cases = JSON.parse('{"__proto__":7}') as Record<string, number>;
      const field = byAttribute("part", cases, 9);
      expect(column(field, ctxOf(protoCell()))).toEqual([9, 7, 9]);
      const emitted = (getFieldSpec(field) as FieldSpec).cases as Record<string, unknown>;
      expect(Object.keys(emitted)).toEqual(["__proto__"]);
    });
  });
});
