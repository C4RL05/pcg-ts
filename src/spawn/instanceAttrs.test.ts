/**
 * The per-instance channel rules, unit-tested against a hand-built point
 * domain rather than through a spawn: `resolveInstanceAttrs` is where
 * every "this attribute cannot cross the spawner" decision is made, and
 * its messages are part of the agent API — each one has to name the node,
 * the param, the offending entry AND the way out, or an agent reading it
 * has nothing to act on.
 *
 * `buildInstanceBatches` is exercised in instances.test.ts; nothing here
 * builds a batch, on purpose. What is pinned here is the rule set and the
 * copy loop, independent of who calls them.
 */
import { describe, expect, it } from "vitest";
import { AttributeSet } from "../data/index.js";
import {
  allocInstanceAttrs,
  instanceAttrShape,
  readInstanceAttr,
  resolveInstanceAttrs,
} from "./instanceAttrs.js";

/** The node and param every message below must name. */
const NODE = "spawnInstances";
const PARAM = "instanceAttrs";

/**
 * A point domain carrying one attribute of every kind the rules care
 * about: three eligible channels, a `bool`, the RESERVED `color`, and a
 * `string` that cannot cross.
 */
function points(count = 4): AttributeSet {
  const attrs = new AttributeSet();
  attrs.resize(count);
  attrs.add("id", "u32", 1, 0);
  attrs.add("phase", "f32", 1, 0);
  attrs.add("uvw", "f32", 3, [0, 0, 0]);
  attrs.add("lit", "bool", 1, 0);
  attrs.add("color", "f32", 4, [1, 1, 1, 1]);
  attrs.add("asset", "string", 1, "");
  return attrs;
}

/** The message of the error `fn` throws. Fails loudly when it does not throw. */
function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected the call to throw, but it returned normally");
}

describe("resolveInstanceAttrs", () => {
  it("carries each attribute's own dtype, tuple size and column through unchanged", () => {
    const attrs = points();
    const sources = resolveInstanceAttrs(attrs, ["id", "uvw"], NODE, PARAM);

    expect(sources.map((s) => s.name)).toEqual(["id", "uvw"]);
    expect(sources[0].type).toBe("u32");
    expect(sources[0].tupleSize).toBe(1);
    // The point column itself, by identity: a channel READS the domain,
    // it does not copy it (the copy happens per instance, in the spawner's
    // one loop).
    expect(sources[0].data).toBe(attrs.require("id").data);
    expect(sources[1].type).toBe("f32");
    expect(sources[1].tupleSize).toBe(3);
    expect(sources[1].data).toBe(attrs.require("uvw").data);
    // The library's shape spelling, which the error messages use.
    expect(instanceAttrShape(sources[0])).toBe("u32");
    expect(instanceAttrShape(sources[1])).toBe("f32x3");
  });

  it("resolves in the PARAM's order, not the attribute set's", () => {
    // The channel record enumerates the way the author wrote it, which is
    // what makes the batch's channel order predictable from the graph.
    const attrs = points();
    expect(resolveInstanceAttrs(attrs, ["uvw", "lit", "id"], NODE, PARAM).map((s) => s.name)).toEqual(
      ["uvw", "lit", "id"],
    );
    expect(attrs.names().indexOf("id")).toBeLessThan(attrs.names().indexOf("uvw"));
  });

  it("carries a bool channel as its own dtype rather than widening it", () => {
    const [lit] = resolveInstanceAttrs(points(), ["lit"], NODE, PARAM);
    expect(lit.type).toBe("bool");
    expect(lit.data).toBeInstanceOf(Uint8Array);
  });

  it("an empty list is no channels, not an error", () => {
    expect(resolveInstanceAttrs(points(), [], NODE, PARAM)).toEqual([]);
  });

  it("a missing attribute names the node, the param, the entry and the candidates", () => {
    const message = messageOf(() => resolveInstanceAttrs(points(), ["age"], NODE, PARAM));
    expect(message).toContain('spawnInstances: instanceAttrs "age" not found on the point domain');
    // Exactly the eligible names, in insertion order: the `string`
    // attribute and the reserved `color` are NOT candidates, and listing
    // either would send an author straight into the next error.
    expect(message).toContain("point attributes that can become channels: id, phase, uvw, lit.");
    expect(message).toContain("Write it upstream with setAttribute, or take it out of instanceAttrs");
  });

  it("says (none) when the domain holds nothing that could be a channel", () => {
    const attrs = new AttributeSet();
    attrs.resize(2);
    attrs.add("color", "f32", 4, [1, 1, 1, 1]);
    attrs.add("asset", "string", 1, "");
    const message = messageOf(() => resolveInstanceAttrs(attrs, ["age"], NODE, PARAM));
    expect(message).toContain("point attributes that can become channels: (none).");
  });

  it("refuses a string attribute and points at assetAttr", () => {
    const message = messageOf(() => resolveInstanceAttrs(points(), ["asset"], NODE, PARAM));
    expect(message).toContain('spawnInstances: instanceAttrs "asset" is a string attribute');
    expect(message).toContain("a string cannot cross the spawner");
    // WHY, so the rule is learnable rather than arbitrary.
    expect(message).toContain(
      "its column holds indices into a per-attribute string table that does not travel with it",
    );
    // …and the two ways out.
    expect(message).toContain("For per-point asset ids use the assetAttr param");
    expect(message).toContain("encode the choice as a number (u32 or i32) upstream");
  });

  it('refuses the reserved "color" name, pointing at colorAttr and at the RGBA route', () => {
    const message = messageOf(() => resolveInstanceAttrs(points(), ["color"], NODE, PARAM));
    expect(message).toContain('spawnInstances: instanceAttrs cannot carry "color"');
    expect(message).toContain("reserved for per-instance RGB");
    expect(message).toContain("InstancedMesh.instanceColor");
    expect(message).toContain("Use the colorAttr param to carry it");
    // The rename-upstream route, which is also the only way RGBA reaches
    // a host — colorAttr drops alpha and a channel does not.
    expect(message).toContain("copy the attribute to another name upstream with setAttribute");
    expect(message).toContain("colorAttr drops alpha, a channel does not");
  });

  it('refuses "color" even when the domain has no such attribute (the name is what is reserved)', () => {
    const attrs = new AttributeSet();
    attrs.resize(1);
    attrs.add("id", "u32", 1, 0);
    expect(attrs.has("color")).toBe(false);
    // The reserved check runs BEFORE the lookup, so the author is told the
    // real reason instead of "not found".
    expect(messageOf(() => resolveInstanceAttrs(attrs, ["color"], NODE, PARAM))).toContain(
      'instanceAttrs cannot carry "color"',
    );
  });

  it("refuses a duplicate entry, because a channel is named after its attribute", () => {
    const message = messageOf(() => resolveInstanceAttrs(points(), ["id", "phase", "id"], NODE, PARAM));
    expect(message).toContain('spawnInstances: instanceAttrs names "id" twice');
    expect(message).toContain("a repeat would be one channel listed twice; list each attribute once");
  });

  it("refuses an empty-string entry, before it can be looked up as an attribute", () => {
    const message = messageOf(() => resolveInstanceAttrs(points(), ["id", "", "age"], NODE, PARAM));
    expect(message).toContain("spawnInstances: instanceAttrs contains an empty name");
    expect(message).toContain("Every entry must name a point attribute");
    expect(message).toContain("clear instanceAttrs entirely to carry no instance attributes");
    // The empty entry reported, not the missing "age" that follows it.
    expect(message).not.toContain("age");
  });
});

describe("allocInstanceAttrs", () => {
  it("allocates count * tupleSize elements per channel in the channel's own dtype", () => {
    const attrs = points();
    const sources = resolveInstanceAttrs(attrs, ["id", "uvw", "lit", "phase"], NODE, PARAM);
    const out = allocInstanceAttrs(sources, 5);

    // Insertion order follows the param's, so the batch's channel record
    // enumerates the way the author wrote it.
    expect(Object.keys(out)).toEqual(["id", "uvw", "lit", "phase"]);
    // Dtype preserved — an f32 for everything would lose a u32 id past 2^24.
    expect(out.id).toBeInstanceOf(Uint32Array);
    expect(out.uvw).toBeInstanceOf(Float32Array);
    expect(out.lit).toBeInstanceOf(Uint8Array);
    expect(out.phase).toBeInstanceOf(Float32Array);
    // tupleSize preserved: the consumer recovers it as length / count.
    expect(out.id).toHaveLength(5);
    expect(out.uvw).toHaveLength(15);
    expect(out.lit).toHaveLength(5);
    expect(out.phase).toHaveLength(5);
    expect(out.uvw.length / 5).toBe(3);
    // A fresh column, never the point domain's own.
    expect(out.id).not.toBe(attrs.require("id").data);
    expect(Array.from(out.id)).toEqual([0, 0, 0, 0, 0]);
  });

  it("allocates nothing for no channels, and zero-length columns for no instances", () => {
    const attrs = points();
    expect(allocInstanceAttrs([], 8)).toEqual({});
    const empty = allocInstanceAttrs(resolveInstanceAttrs(attrs, ["uvw"], NODE, PARAM), 0);
    expect(empty.uvw).toBeInstanceOf(Float32Array);
    expect(empty.uvw).toHaveLength(0);
  });
});

describe("readInstanceAttr", () => {
  it("copies every component of source element i into instance slot k", () => {
    const attrs = points();
    const uvw = attrs.require("uvw");
    for (let i = 0; i < 4; i++) uvw.setTuple(i, [i, i + 0.5, i + 0.25]);
    const [src] = resolveInstanceAttrs(attrs, ["uvw"], NODE, PARAM);
    const out = allocInstanceAttrs([src], 2).uvw;

    // Deliberately out of order and non-contiguous: the spawner reads
    // point `perm[start + k]` into slot `k`, so the two indices are
    // independent.
    readInstanceAttr(out, 0, src, 3);
    readInstanceAttr(out, 1, src, 1);
    expect(Array.from(out)).toEqual([3, 3.5, 3.25, 1, 1.5, 1.25]);
  });

  it("preserves a u32 value an f32 channel would have rounded away", () => {
    const attrs = points();
    const id = attrs.require("id");
    // 2^24 + 1 is the first integer f32 cannot represent.
    id.set(0, 16777217);
    id.set(1, 4294967295);
    const [src] = resolveInstanceAttrs(attrs, ["id"], NODE, PARAM);
    const out = allocInstanceAttrs([src], 2).id;
    readInstanceAttr(out, 0, src, 1);
    readInstanceAttr(out, 1, src, 0);
    expect(Array.from(out)).toEqual([4294967295, 16777217]);
  });

  it("writes only its own slot", () => {
    const attrs = points();
    attrs.require("uvw").setTuple(2, [7, 8, 9]);
    const [src] = resolveInstanceAttrs(attrs, ["uvw"], NODE, PARAM);
    const out = allocInstanceAttrs([src], 3).uvw;
    readInstanceAttr(out, 1, src, 2);
    expect(Array.from(out)).toEqual([0, 0, 0, 7, 8, 9, 0, 0, 0]);
  });

  it("copies a scalar channel with no tuple arithmetic to get wrong", () => {
    const attrs = points();
    const phase = attrs.require("phase");
    for (let i = 0; i < 4; i++) phase.set(i, i / 4);
    const [src] = resolveInstanceAttrs(attrs, ["phase"], NODE, PARAM);
    const out = allocInstanceAttrs([src], 4).phase;
    for (let k = 0; k < 4; k++) readInstanceAttr(out, k, src, 3 - k);
    expect(Array.from(out)).toEqual([0.75, 0.5, 0.25, 0]);
  });
});
