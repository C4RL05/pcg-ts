import { describe, expect, it } from "vitest";
import { Attribute, AttributeSet } from "./attribute.js";
import type { AttrType } from "./types.js";

const NUMERIC_VALUES: Record<Exclude<AttrType, "string">, number[]> = {
  f32: [1.5, -2.25, 1024.5, 0.125],
  i32: [-2147483648, 2147483647, -5, 7],
  u32: [0, 4294967295, 123456789, 42],
  bool: [1, 0, 1, 1],
};

describe("Attribute storage round-trips", () => {
  for (const type of Object.keys(NUMERIC_VALUES) as Array<Exclude<AttrType, "string">>) {
    for (const tupleSize of [1, 2, 3, 4]) {
      it(`round-trips ${type} with tupleSize ${tupleSize}`, () => {
        const values = NUMERIC_VALUES[type];
        const set = new AttributeSet();
        const attr = set.add("a", type, tupleSize);
        set.resize(3);
        const tuples: number[][] = [];
        for (let i = 0; i < 3; i++) {
          const tuple: number[] = [];
          for (let k = 0; k < tupleSize; k++) {
            tuple.push(values[(i * tupleSize + k) % values.length]);
          }
          tuples.push(tuple);
          attr.setTuple(i, tuple);
        }
        for (let i = 0; i < 3; i++) {
          expect(attr.getTuple(i)).toEqual(tuples[i]);
          for (let k = 0; k < tupleSize; k++) {
            expect(attr.get(i, k)).toBe(tuples[i][k]);
          }
        }
      });
    }
  }

  it("maps types to the expected typed arrays", () => {
    const set = new AttributeSet();
    expect(set.add("f", "f32").data).toBeInstanceOf(Float32Array);
    expect(set.add("i", "i32").data).toBeInstanceOf(Int32Array);
    expect(set.add("u", "u32").data).toBeInstanceOf(Uint32Array);
    expect(set.add("b", "bool").data).toBeInstanceOf(Uint8Array);
    expect(set.add("s", "string").data).toBeInstanceOf(Uint32Array);
  });

  it("round-trips string values with interning", () => {
    const set = new AttributeSet();
    const attr = set.add("s", "string");
    set.resize(4);
    attr.setString(0, "apple");
    attr.setString(1, "banana");
    attr.setString(2, "apple");
    attr.setString(3, "");
    expect(attr.getString(0)).toBe("apple");
    expect(attr.getString(1)).toBe("banana");
    expect(attr.getString(2)).toBe("apple");
    expect(attr.getString(3)).toBe("");
    // "" (default) + "apple" + "banana": duplicates interned once.
    expect(attr.stringTable).toEqual(["", "apple", "banana"]);
    expect(attr.data[0]).toBe(attr.data[2]);
  });

  it("round-trips string tuples per component", () => {
    const set = new AttributeSet();
    const attr = set.add("s", "string", 2);
    set.resize(2);
    attr.setString(0, "a", 0);
    attr.setString(0, "b", 1);
    attr.setString(1, "c", 0);
    expect(attr.getString(0, 0)).toBe("a");
    expect(attr.getString(0, 1)).toBe("b");
    expect(attr.getString(1, 0)).toBe("c");
  });

  it("set + scalar get honor components", () => {
    const set = new AttributeSet();
    const attr = set.add("v", "f32", 3);
    set.resize(2);
    attr.set(1, 5.5, 2);
    expect(attr.get(1, 2)).toBe(5.5);
    expect(attr.get(1, 0)).toBe(0);
    expect(attr.data[5]).toBe(5.5);
  });
});

describe("Attribute fill and copy", () => {
  it("fills scalar, tuple, and string values over a range", () => {
    const set = new AttributeSet();
    const a = set.add("a", "f32", 2);
    const s = set.add("s", "string");
    set.resize(4);
    a.fill(3, 1, 3);
    expect(Array.from(a.data.subarray(0, 8))).toEqual([0, 0, 3, 3, 3, 3, 0, 0]);
    a.fill([7, 8], 0, 2);
    expect(Array.from(a.data.subarray(0, 4))).toEqual([7, 8, 7, 8]);
    s.fill("x", 2, 4);
    expect(s.getString(1)).toBe("");
    expect(s.getString(2)).toBe("x");
    expect(s.getString(3)).toBe("x");
  });

  it("copies ranges within one attribute (overlap-safe)", () => {
    const set = new AttributeSet();
    const a = set.add("a", "i32");
    set.resize(5);
    a.data.set([1, 2, 3, 4, 5]);
    a.copyFrom(a, 0, 1, 4);
    expect(Array.from(a.data.subarray(0, 5))).toEqual([1, 1, 2, 3, 4]);
  });

  it("copies ranges between numeric attributes", () => {
    const setA = new AttributeSet();
    const a = setA.add("a", "f32", 2);
    setA.resize(3);
    a.data.set([1, 2, 3, 4, 5, 6]);
    const setB = new AttributeSet();
    const b = setB.add("b", "f32", 2);
    setB.resize(3);
    b.copyFrom(a, 1, 0, 2);
    expect(Array.from(b.data.subarray(0, 4))).toEqual([3, 4, 5, 6]);
  });

  it("re-interns strings when copying across attributes", () => {
    const setA = new AttributeSet();
    const a = setA.add("a", "string");
    setA.resize(3);
    a.setString(0, "x");
    a.setString(1, "y");
    a.setString(2, "z");
    const setB = new AttributeSet();
    const b = setB.add("b", "string");
    setB.resize(3);
    b.setString(0, "q"); // diverge the tables so raw indices differ
    b.copyFrom(a, 1, 1, 2);
    expect(b.getString(0)).toBe("q");
    expect(b.getString(1)).toBe("y");
    expect(b.getString(2)).toBe("z");
  });

  it("rejects mismatched copyFrom shapes and out-of-range copies", () => {
    const set = new AttributeSet();
    const a = set.add("a", "f32", 2);
    const b = set.add("b", "f32", 3);
    const c = set.add("c", "i32", 2);
    set.resize(2);
    expect(() => a.copyFrom(b, 0, 0, 1)).toThrow(/matching type and tupleSize/);
    expect(() => a.copyFrom(c, 0, 0, 1)).toThrow(/matching type and tupleSize/);
    expect(() => a.copyFrom(a, 0, 7, 3)).toThrow(/out of bounds/);
  });
});

describe("AttributeSet defaults and resize", () => {
  it("initializes new elements to the default on grow", () => {
    const set = new AttributeSet();
    const a = set.add("a", "f32", 1, 9);
    set.resize(3);
    a.data.set([1, 2, 3]);
    set.resize(6);
    expect(Array.from(a.data.subarray(0, 6))).toEqual([1, 2, 3, 9, 9, 9]);
  });

  it("broadcasts scalar defaults and honors tuple defaults", () => {
    const set = new AttributeSet();
    const s = set.add("s", "f32", 3, 2);
    const t = set.add("t", "f32", 4, [0, 0, 0, 1]);
    set.resize(2);
    expect(Array.from(s.data.subarray(0, 6))).toEqual([2, 2, 2, 2, 2, 2]);
    expect(Array.from(t.data.subarray(0, 8))).toEqual([0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("defaults string attributes", () => {
    const set = new AttributeSet();
    const s = set.add("s", "string", 1, "none");
    set.resize(2);
    expect(s.getString(0)).toBe("none");
    expect(s.getString(1)).toBe("none");
  });

  it("initializes existing elements when adding to a non-empty set", () => {
    const set = new AttributeSet();
    set.resize(4);
    const a = set.add("a", "u32", 1, 9);
    expect(Array.from(a.data.subarray(0, 4))).toEqual([9, 9, 9, 9]);
  });

  it("re-defaults elements after shrink and regrow", () => {
    const set = new AttributeSet();
    const a = set.add("a", "i32", 1, 9);
    set.resize(5);
    a.data.set([1, 2, 3, 4, 5]);
    set.resize(2);
    expect(set.count).toBe(2);
    set.resize(5);
    expect(Array.from(a.data.subarray(0, 5))).toEqual([1, 2, 9, 9, 9]);
  });

  it("grows capacity by doubling and keeps it on shrink", () => {
    const set = new AttributeSet();
    set.add("a", "f32");
    set.resize(3);
    expect(set.capacity).toBe(8);
    set.resize(9);
    expect(set.capacity).toBe(16);
    set.resize(17);
    expect(set.capacity).toBe(32);
    set.resize(2);
    expect(set.capacity).toBe(32);
    expect(set.count).toBe(2);
    const a = set.require("a");
    expect(a.capacity).toBe(32);
  });

  it("keeps data valid for attributes added before the first resize", () => {
    const set = new AttributeSet();
    const a = set.add("a", "f32", 2, 5);
    expect(a.capacity).toBe(0);
    set.resize(3);
    expect(Array.from(a.data.subarray(0, 6))).toEqual([5, 5, 5, 5, 5, 5]);
  });
});

describe("AttributeSet ordering and management", () => {
  it("iterates in insertion order, deterministically", () => {
    const set = new AttributeSet();
    set.add("alpha", "f32");
    set.add("zeta", "i32");
    set.add("beta", "u32");
    expect(set.names()).toEqual(["alpha", "zeta", "beta"]);
    expect([...set].map((a) => a.name)).toEqual(["alpha", "zeta", "beta"]);
    set.remove("zeta");
    set.add("gamma", "f32");
    expect(set.names()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("rename keeps the attribute's position", () => {
    const set = new AttributeSet();
    set.add("a", "f32");
    set.add("b", "f32");
    set.add("c", "f32");
    set.rename("b", "middle");
    expect(set.names()).toEqual(["a", "middle", "c"]);
    expect(set.require("middle").name).toBe("middle");
    expect(set.has("b")).toBe(false);
  });

  it("add/get/has/remove/require behave", () => {
    const set = new AttributeSet();
    const a = set.add("a", "f32");
    expect(set.get("a")).toBe(a);
    expect(set.has("a")).toBe(true);
    expect(set.get("missing")).toBeUndefined();
    expect(() => set.require("missing")).toThrow(/not found/);
    expect(set.remove("a")).toBe(true);
    expect(set.remove("a")).toBe(false);
    expect(set.size).toBe(0);
  });

  it("replace reuses same-shaped attributes in place", () => {
    const set = new AttributeSet();
    set.add("a", "f32");
    const b = set.add("b", "f32");
    set.add("c", "f32");
    set.resize(2);
    b.data.set([5, 6]);
    const b2 = set.replace("b", "f32", 1, 7);
    expect(b2).toBe(b);
    expect(set.names()).toEqual(["a", "b", "c"]);
    expect(Array.from(b2.data.subarray(0, 2))).toEqual([7, 7]);
  });

  it("replace swaps mismatched shapes for a fresh attribute", () => {
    const set = new AttributeSet();
    set.add("a", "f32");
    set.add("b", "f32");
    set.resize(2);
    const b2 = set.replace("b", "u32", 2, 3);
    expect(b2.type).toBe("u32");
    expect(b2.tupleSize).toBe(2);
    expect(Array.from(b2.data.subarray(0, 4))).toEqual([3, 3, 3, 3]);
  });

  it("rejects duplicate adds and bad renames", () => {
    const set = new AttributeSet();
    set.add("a", "f32");
    set.add("b", "f32");
    expect(() => set.add("a", "f32")).toThrow(/already exists/);
    expect(() => set.rename("a", "b")).toThrow(/already exists/);
    expect(() => set.rename("missing", "x")).toThrow(/not found/);
  });

  it("validates defaults and types", () => {
    const set = new AttributeSet();
    expect(() => set.add("a", "f32", 3, [1, 2])).toThrow(/does not match tupleSize/);
    expect(() => set.add("b", "f32", 1, "oops")).toThrow(/numeric default/);
    expect(() => set.add("c", "string", 1, 5)).toThrow(/string default/);
    expect(() => set.add("d", "f32", 0)).toThrow(/positive integer/);
    const n = set.add("n", "f32");
    expect(() => n.getString(0)).toThrow(/not a string attribute/);
    expect(() => set.resize(-1)).toThrow(/non-negative/);
  });

  it("standalone Attribute exposes capacity and defaults", () => {
    const attr = new Attribute("solo", "f32", 2, 4, [1, 2]);
    expect(attr.capacity).toBe(4);
    expect(attr.defaultValue).toEqual([1, 2]);
    attr.fillDefault(0, 4);
    expect(Array.from(attr.data)).toEqual([1, 2, 1, 2, 1, 2, 1, 2]);
  });
});
