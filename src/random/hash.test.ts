import { describe, expect, it } from "vitest";
import { hashCombine, hashFloat, hashString } from "./hash.js";

describe("hashCombine", () => {
  it("is deterministic", () => {
    expect(hashCombine(1, 2, 3)).toBe(hashCombine(1, 2, 3));
    expect(hashCombine(0)).toBe(hashCombine(0));
    expect(hashCombine()).toBe(hashCombine());
  });

  it("is order- and arity-sensitive", () => {
    expect(hashCombine(1, 2)).not.toBe(hashCombine(2, 1));
    expect(hashCombine(1)).not.toBe(hashCombine(1, 0));
    expect(hashCombine(1, 0)).not.toBe(hashCombine(0, 1));
  });

  it("wraps negative values deterministically", () => {
    expect(hashCombine(-1, -2)).toBe(hashCombine(0xffffffff, 0xfffffffe));
    expect(hashCombine(-1)).not.toBe(hashCombine(1));
  });

  it("returns an unsigned 32-bit integer", () => {
    for (const h of [hashCombine(0), hashCombine(-1, 7), hashCombine(1e9, 2e9, 3e9)]) {
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("avalanches: flipping any single input bit changes the output", () => {
    const bases: number[][] = [
      [0],
      [42, 54],
      [0xdeadbeef, 123, 456],
      [1, 2, 3, 4],
    ];
    for (const base of bases) {
      const h0 = hashCombine(...base);
      for (let pos = 0; pos < base.length; pos++) {
        for (let bit = 0; bit < 32; bit++) {
          const flipped = [...base];
          flipped[pos] = (flipped[pos] ^ (1 << bit)) >>> 0;
          expect(hashCombine(...flipped), `pos ${pos} bit ${bit}`).not.toBe(h0);
        }
      }
    }
  });

  it("avalanches: output bits change ~half the time on single-bit flips", () => {
    const popcount = (x: number): number => {
      let c = 0;
      for (let i = 0; i < 32; i++) if ((x >>> i) & 1) c++;
      return c;
    };
    let total = 0;
    let flips = 0;
    for (let v = 0; v < 64; v++) {
      const h0 = hashCombine(7, v);
      for (let bit = 0; bit < 32; bit++) {
        total += popcount(h0 ^ hashCombine(7, (v ^ (1 << bit)) >>> 0));
        flips++;
      }
    }
    const mean = total / flips;
    expect(mean).toBeGreaterThan(12);
    expect(mean).toBeLessThan(20);
  });
});

describe("hashFloat", () => {
  it("maps hashes into [0, 1) with f32-exact values", () => {
    for (let i = 0; i < 5000; i++) {
      const v = hashFloat(hashCombine(99, i));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(Math.fround(v)).toBe(v);
    }
    expect(hashFloat(0)).toBe(0);
    expect(hashFloat(0xffffffff)).toBeLessThan(1);
  });

  it("is deterministic", () => {
    expect(hashFloat(123456)).toBe(hashFloat(123456));
  });
});

describe("hashString", () => {
  it("is deterministic and discriminating", () => {
    expect(hashString("hello")).toBe(hashString("hello"));
    expect(hashString("hello")).not.toBe(hashString("hellp"));
    expect(hashString("")).not.toBe(hashString(" "));
    const h = hashString("pcg");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});
