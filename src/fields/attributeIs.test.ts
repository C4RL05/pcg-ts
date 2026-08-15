/**
 * `attributeIs`: the one way a STRING attribute drives a field.
 *
 * The centre of gravity here is partition-independence, because that is
 * the whole reason the fn is a predicate instead of the obvious
 * "give me the table index". A string column stores indices into a table
 * that ordinary work rebuilds — `setAttribute` interns a declared list up
 * front, clone/filter/merge re-intern per element and compact — so the
 * same logical value sits at different indices in different cells of one
 * world. An index-returning fn would pass every other test in this file
 * and still make a world's output depend on how it was partitioned.
 *
 * So the two geometries in "partition independence" are built with tables
 * that disagree DELIBERATELY, in membership and in order, and the test
 * asserts that disagreement before asserting the predicate ignores it.
 */
import { describe, expect, it } from "vitest";
import {
  type Domain,
  Geometry,
  createPointCloud,
  createTriangleMesh,
} from "../data/index.js";
import { copyElements } from "../nodes/util.js";
import { type FieldSpec, FieldJsonError, fieldFromJson, fnVariation } from "./fieldJson.js";
import { attributeIs } from "./inputs.js";
import { getFieldSpec } from "./spec.js";
import { type EvalContext, type Field, evaluateField } from "./types.js";

function ctxOf(geo: Geometry, domain: Domain = "point", seed = 0): EvalContext {
  return { geo, domain, seed };
}

function column(field: Field, ctx: EvalContext): number[] {
  return Array.from(evaluateField(field, ctx).data);
}

/** The logical values every geometry in this file agrees about. */
const SPECIES = ["pine", "oak", "pine", "birch", "oak", "pine"] as const;

/**
 * A point cloud holding {@link SPECIES}, whose string table is built in an
 * order the caller chooses.
 *
 * `order` is the sequence of ELEMENTS written, which is what fixes the
 * table's index order (first encounter wins) — the same freedom a filter
 * or a merge exercises upstream. `declared` interns values before any
 * element is written, standing in for `setAttribute`'s declared list,
 * which puts entries in the table that no element uses.
 */
function cell(order: readonly number[], declared: readonly string[] = []): Geometry {
  const geo = createPointCloud(SPECIES.length);
  const attr = geo.attrs.point.add("species", "string");
  for (const value of declared) attr.internString(value);
  for (const i of order) attr.setString(i, SPECIES[i]);
  return geo;
}

const FORWARD = [0, 1, 2, 3, 4, 5];

describe("attributeIs", () => {
  it("is 1 on the elements holding the literal and 0 on the rest", () => {
    const ctx = ctxOf(cell(FORWARD));
    expect(column(attributeIs("species", "pine"), ctx)).toEqual([1, 0, 1, 0, 0, 1]);
    expect(column(attributeIs("species", "oak"), ctx)).toEqual([0, 1, 0, 0, 1, 0]);
    expect(column(attributeIs("species", "birch"), ctx)).toEqual([0, 0, 0, 1, 0, 0]);
  });

  it("is a scalar f32 column whatever the attribute's storage", () => {
    const col = evaluateField(attributeIs("species", "pine"), ctxOf(cell(FORWARD)));
    expect(col.tupleSize).toBe(1);
    expect(col.data).toBeInstanceOf(Float32Array);
    expect(attributeIs("species", "pine").tupleSize).toBe(1);
  });

  it("matches the empty string, which is the default every table interns at 0", () => {
    // Only elements 0 and 2 are written, so the rest still hold the
    // default — the one literal that is in every string table.
    const geo = createPointCloud(4);
    const attr = geo.attrs.point.add("species", "string");
    attr.setString(0, "pine");
    attr.setString(2, "pine");
    expect(column(attributeIs("species", ""), ctxOf(geo))).toEqual([0, 1, 0, 1]);
  });

  it("resolves on every domain", () => {
    // Two triangles over four points, so each domain has a distinct count.
    const geo = createTriangleMesh(
      [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
      [0, 1, 2, 0, 2, 3],
    );
    const expected: Record<Domain, number[]> = {
      point: [1, 0, 1, 0],
      vertex: [0, 1, 0, 0, 0, 1],
      primitive: [1, 0],
      detail: [1],
    };
    for (const domain of ["point", "vertex", "primitive", "detail"] as const) {
      const set = geo.attrs[domain];
      const attr = set.add("species", "string");
      for (let i = 0; i < set.count; i++) {
        attr.setString(i, expected[domain][i] === 1 ? "pine" : "oak");
      }
      expect(column(attributeIs("species", "pine"), ctxOf(geo, domain)), domain).toEqual(
        expected[domain],
      );
    }
  });

  it("reads component 0 of a tuple-valued string attribute", () => {
    // The predicate is Field<1>, so a tuple has to name one component; it
    // takes the first, as `Attribute.getString` does.
    const geo = createPointCloud(3);
    const attr = geo.attrs.point.add("pair", "string", 2);
    attr.setString(0, "pine", 0);
    attr.setString(0, "oak", 1);
    attr.setString(1, "oak", 0);
    attr.setString(1, "pine", 1);
    attr.setString(2, "pine", 0);
    attr.setString(2, "pine", 1);
    expect(column(attributeIs("pair", "pine"), ctxOf(geo))).toEqual([1, 0, 1]);
  });

  it("yields an empty column on an empty domain", () => {
    const geo = createPointCloud(0);
    geo.attrs.point.add("species", "string");
    expect(column(attributeIs("species", "pine"), ctxOf(geo))).toEqual([]);
  });
});

describe("attributeIs: partition independence", () => {
  /**
   * Two geometries holding the SAME logical points whose string tables
   * disagree as thoroughly as ordinary upstream work can make them
   * disagree: one carries an entry the other has never heard of, and the
   * three shared values are interned in opposite order.
   */
  const a = cell(FORWARD);
  const b = cell([3, 1, 0, 2, 4, 5], ["fir"]);
  const attrA = a.attrs.point.require("species");
  const attrB = b.attrs.point.require("species");

  it("the two tables really do disagree, in membership and in order", () => {
    expect(attrA.stringTable).toEqual(["", "pine", "oak", "birch"]);
    expect(attrB.stringTable).toEqual(["", "fir", "birch", "oak", "pine"]);
    // Membership: "fir" is declared in b and unknown to a.
    expect(attrA.stringTable).not.toContain("fir");
    expect(attrB.stringTable).toContain("fir");
    // Order: the shared values are interned back to front.
    const order = (t: readonly string[]) => ["pine", "oak", "birch"].map((v) => t.indexOf(v));
    expect(order(attrA.stringTable)).toEqual([1, 2, 3]);
    expect(order(attrB.stringTable)).toEqual([4, 3, 2]);
    // ...so the raw columns hold different numbers element for element,
    // which is what makes the agreement below worth asserting.
    const raw = (g: Geometry) => Array.from(g.attrs.point.require("species").data.slice(0, 6));
    expect(raw(a)).not.toEqual(raw(b));
  });

  for (const value of ["pine", "oak", "birch", "fir", "", "cypress"]) {
    it(`agrees on "${value}" across both tables`, () => {
      const fromA = column(attributeIs("species", value), ctxOf(a));
      const fromB = column(attributeIs("species", value), ctxOf(b));
      expect(fromB).toEqual(fromA);
      // Pinned against the answer too, so "both wrong the same way" is
      // not what this passes on.
      const expected = SPECIES.map((s) => (s === value ? 1 : 0));
      expect(fromA).toEqual(expected);
    });
  }

  it("gives one answer per literal, however the literal punctuates", () => {
    // Fields memoize on `key` within a context, so two DIFFERENT
    // (name, value) pairs sharing a key would serve each other's column.
    // A name and a literal are both arbitrary strings; the key escapes
    // both so neither can forge the other's.
    const forged = attributeIs('species","x', "y");
    const honest = attributeIs("species", 'x","y');
    expect(forged.key).not.toBe(honest.key);
    expect(attributeIs("species", "pine").key).toBe(attributeIs("species", "pine").key);
    expect(attributeIs("species", "pine").key).not.toBe(attributeIs("species", "oak").key);
  });
});

describe("attributeIs: a literal the table does not hold", () => {
  it("yields zeros instead of throwing", () => {
    const ctx = ctxOf(cell(FORWARD));
    expect(column(attributeIs("species", "cypress"), ctx)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("leaves the string table untouched", () => {
    // The regression guard against `internString` creeping back in.
    // Interning on a miss would also produce zeros — every element would
    // still fail to match the entry it just added — so the ZEROS above
    // cannot catch it and the table has to be inspected directly.
    const geo = cell(FORWARD);
    const attr = geo.attrs.point.require("species");
    const before = [...attr.stringTable];
    for (let pass = 0; pass < 2; pass++) {
      column(attributeIs("species", "cypress"), ctxOf(geo));
    }
    expect(attr.stringTable).toEqual(before);
    expect(attr.stringTable).not.toContain("cypress");
    expect(attr.lookupString("cypress")).toBeUndefined();
  });

  it("is zeros after a filter removes the last element holding it", () => {
    // Within ONE cook: filtering compacts the table to first-encounter
    // order over the survivors and drops the rest, so a literal that was
    // legal a moment ago is now absent. Same rule as the cell that never
    // had one.
    const src = cell(FORWARD);
    const keep = [1, 3, 4]; // every element whose species is not "pine"
    const filtered = new Geometry();
    copyElements(src.attrs.point, filtered.attrs.point, keep, keep.length);

    const table = filtered.attrs.point.require("species").stringTable;
    expect(table).not.toContain("pine");
    expect(table).toEqual(["", "oak", "birch"]);
    expect(column(attributeIs("species", "pine"), ctxOf(filtered))).toEqual([0, 0, 0]);
    // The survivors still answer, so this is compaction and not breakage.
    expect(column(attributeIs("species", "oak"), ctxOf(filtered))).toEqual([1, 0, 1]);
  });
});

describe("attributeIs: structural mistakes", () => {
  it("throws on a numeric attribute, naming eq() as the fix", () => {
    const geo = createPointCloud(3);
    expect(() => column(attributeIs("density", "pine"), ctxOf(geo))).toThrow(
      /attributeIs "density": expected a string attribute, got f32/,
    );
    expect(() => column(attributeIs("density", "pine"), ctxOf(geo))).toThrow(
      /eq\(attribute\("density"\), value\)/,
    );
  });

  it("throws on a missing attribute", () => {
    const geo = createPointCloud(3);
    expect(() => column(attributeIs("species", "pine"), ctxOf(geo))).toThrow(
      /attribute "species" not found/,
    );
  });
});

describe("attributeIs: grammar", () => {
  it("derives the spec the grammar spells", () => {
    expect(getFieldSpec(attributeIs("species", "pine"))).toEqual({
      fn: "attributeIs",
      name: "species",
      value: "pine",
    });
  });

  it("round-trips through JSON to the same field", () => {
    const field = attributeIs("species", "pine");
    const spec = getFieldSpec(field);
    const rebuilt = fieldFromJson(JSON.parse(JSON.stringify(spec)) as FieldSpec);
    expect(rebuilt.key).toBe(field.key);
    expect(rebuilt.tupleSize).toBe(1);
    // Separate contexts, because equal keys share a memoized column
    // within one — evaluating both against the same context would compare
    // a column with itself.
    expect(column(rebuilt, ctxOf(cell(FORWARD)))).toEqual(column(field, ctxOf(cell(FORWARD))));
  });

  it("reads a column, so the fold must not treat it as uniform", () => {
    expect(fnVariation("attributeIs")).toBe("per-element");
  });

  it("withholds a spec for a name the grammar would reject", () => {
    expect(getFieldSpec(attributeIs("", "pine"))).toBeUndefined();
  });

  it("rejects a missing or empty name", () => {
    expect(() => fieldFromJson({ fn: "attributeIs", value: "pine" })).toThrow(FieldJsonError);
    expect(() => fieldFromJson({ fn: "attributeIs", name: "", value: "pine" })).toThrow(
      /attributeIs requires a non-empty string name/,
    );
  });

  it("rejects a non-string value, pointing at the numeric spelling", () => {
    expect(() => fieldFromJson({ fn: "attributeIs", name: "density", value: 3 })).toThrow(
      /attributeIs requires a string value/,
    );
    expect(() => fieldFromJson({ fn: "attributeIs", name: "density", value: 3 })).toThrow(
      /fn: "eq"/,
    );
  });

  it("rejects keys the fn does not have", () => {
    expect(() =>
      fieldFromJson({ fn: "attributeIs", name: "species", value: "pine", tupleSize: 1 }),
    ).toThrow(/unknown key "tupleSize"/);
  });
});
