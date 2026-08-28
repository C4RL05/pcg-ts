/**
 * `randomFrom`: a uniform keyed on a VALUE rather than on an element.
 *
 * THE CLAIM THAT MATTERS IS THE ONE `randomField` CANNOT MAKE — that a
 * draw survives its element being moved. Everything else here (flatness,
 * salting, the seed fold) it shares with `randomField` and is checked
 * because a hash that got any of them wrong would still look random.
 *
 * The two are deliberately checked SIDE BY SIDE on the same clouds: what
 * separates them is not a property either one has alone, it is which of
 * them changes when the geometry does.
 */
import { describe, expect, it } from "vitest";
import { createPointCloud, type Geometry } from "../data/index.js";
import { attribute, position, randomField } from "./inputs.js";
import { component, randomFrom } from "./combinators.js";
import { evaluateField, type EvalContext, type Field } from "./types.js";

const SEED = 0x9e3779b9;

/** A cloud whose points carry a `station` and sit where that puts them. */
function cloud(stations: readonly number[], lateral = 0): Geometry {
  const geo = createPointCloud(stations.length);
  const P = geo.attrs.point.require("P");
  const station = geo.attrs.point.add("station", "f32", 1);
  stations.forEach((s, i) => {
    P.setTuple(i, [lateral, 0, s]);
    station.set(i, s);
  });
  return geo;
}

const ctxOf = (geo: Geometry, seed = SEED): EvalContext => ({ geo, domain: "point", seed });

const read = (f: Field, geo: Geometry, seed = SEED): number[] =>
  Array.from(evaluateField(f, ctxOf(geo, seed)).data);

describe("randomFrom: what it is for", () => {
  it("hands the same draw to a point that has moved, where randomField does not", () => {
    // THE WHOLE POINT, and the reason the field exists. The repair loop
    // that motivated it nudges placements sideways every round; a draw
    // keyed on identity re-rolls every time, so anything derived from it
    // — which recorded shape a prop wears, say — changes whenever the
    // prop is moved half a metre.
    const stations = [0, 7, 19, 40, 91];
    const still = cloud(stations, 0);
    const moved = cloud(stations, 3.5);

    const keyed = randomFrom(attribute("station"), "pose");
    expect(read(keyed, moved)).toEqual(read(keyed, still));

    // The control: the same clouds, the same seed, keyed on identity.
    const identity = randomField("pose");
    const a = read(identity, still);
    const b = read(identity, moved);
    expect(b).not.toEqual(a);
    // And not by a hair — every one of them re-rolled.
    expect(a.filter((v, i) => v === b[i])).toHaveLength(0);
  });

  it("is flat in [0, 1) and never returns 1", () => {
    const n = 4096;
    const geo = cloud(Array.from({ length: n }, (_, i) => i));
    const got = read(randomFrom(attribute("station")), geo);
    expect(Math.min(...got)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...got)).toBeLessThan(1);
    // Ten buckets, no bucket more than 30% off its expected share. A hash
    // that returned a ramp or a constant fails this; one that is merely
    // imperfect does not.
    const buckets = new Array<number>(10).fill(0);
    for (const v of got) buckets[Math.floor(v * 10)] = (buckets[Math.floor(v * 10)] as number) + 1;
    for (const b of buckets) {
      expect(b).toBeGreaterThan((n / 10) * 0.7);
      expect(b).toBeLessThan((n / 10) * 1.3);
    }
  });

  it("gives equal keys equal draws and unequal keys unrelated ones", () => {
    // Two points at the same station draw alike — which is the contract,
    // not a collision: the key IS the question being asked.
    const geo = cloud([12, 12, 12.5, 40]);
    const got = read(randomFrom(attribute("station")), geo);
    expect(got[0]).toBe(got[1]);
    // AND 12.5 IS NOT 12. The key is hashed as BITS, so there is no
    // interval that collapses onto one stream — the trap this avoids is
    // `hashCombine`'s truncation toward zero, under which every station
    // between 12 and 13 would have drawn together.
    expect(got[2]).not.toBe(got[0]);
    expect(got[3]).not.toBe(got[0]);
  });

  it("separates streams by key and by node seed", () => {
    const geo = cloud([1, 2, 3, 4, 5, 6, 7, 8]);
    const k = attribute("station");
    const one = read(randomFrom(k, "a"), geo);
    const two = read(randomFrom(k, "b"), geo);
    expect(two).not.toEqual(one);
    // The cooking node's seed folds in exactly as `randomField`'s does,
    // so two nodes hashing the same value draw differently.
    expect(read(randomFrom(k, "a"), geo, SEED + 1)).not.toEqual(one);
    // And the same key at the same seed reproduces.
    expect(read(randomFrom(k, "a"), geo)).toEqual(one);
  });

  it("survives a shuffle, because the key does", () => {
    // Nothing here is keyed on a slot, so the answer travels with the
    // value: the same stations in a different order give the same draws
    // in that order.
    const a = cloud([5, 9, 14, 22]);
    const b = cloud([22, 5, 14, 9]);
    const f = randomFrom(attribute("station"), "s");
    const ra = read(f, a);
    const rb = read(f, b);
    expect(rb).toEqual([ra[3], ra[0], ra[2], ra[1]]);
  });

  it("is constant when its key is", () => {
    // A domain-constant key makes a domain-constant field, which is what
    // lets the fold treat it as uniform. `randomField` can never be that.
    const geo = cloud([1, 2, 3, 4]);
    const got = read(randomFrom(7, "c"), geo);
    expect(new Set(got).size).toBe(1);
  });

  it("refuses a tuple key", () => {
    const geo = cloud([1, 2, 3]);
    expect(() => read(randomFrom(position()), geo)).toThrow(/ONE number per element/);
    // Reduced, the same expression is fine — and the message says so.
    expect(() => read(randomFrom(component(position(), 2)), geo)).not.toThrow();
  });

  it("keys on any domain, having no identity to need", () => {
    // `randomField` answers the element index on vertex and detail because
    // there is nothing else to name there. This one has a key on every
    // domain, so the detail domain — one element, no identity at all —
    // still draws from the value it was handed.
    const geo = cloud([1, 2, 3]);
    geo.attrs.detail.add("k", "f32", 1).set(0, 42);
    const col = evaluateField(randomFrom(attribute("k"), "d"), {
      geo,
      domain: "detail",
      seed: SEED,
    });
    expect(col.data).toHaveLength(1);
    expect(col.data[0]).toBeGreaterThanOrEqual(0);
    expect(col.data[0]).toBeLessThan(1);
    // Same key, same answer, whichever domain asked.
    expect(read(randomFrom(42, "d"), geo)[0]).toBe(col.data[0]);
  });
});
