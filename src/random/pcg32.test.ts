import { describe, expect, it } from "vitest";
import { Pcg32 } from "./pcg32.js";

describe("Pcg32", () => {
  it("matches the PCG32 reference vectors for seed 42, stream 54", () => {
    const rng = new Pcg32(42, 54);
    const expected = [0xa15c02b7, 0x7b47f409, 0xba1d3330, 0x83d2f293, 0xbfa4784b, 0xcbed606e];
    for (const value of expected) {
      expect(rng.nextU32()).toBe(value);
    }
  });

  it("is deterministic across two fresh instances", () => {
    const a = new Pcg32(123456789, 987);
    const b = new Pcg32(123456789, 987);
    for (let i = 0; i < 100; i++) {
      expect(b.nextU32()).toBe(a.nextU32());
    }
  });

  it("produces different sequences for different seeds and streams", () => {
    const base = new Pcg32(1, 0);
    const otherSeed = new Pcg32(2, 0);
    const otherStream = new Pcg32(1, 1);
    const seq = (rng: Pcg32) => Array.from({ length: 8 }, () => rng.nextU32());
    const a = seq(base);
    expect(seq(otherSeed)).not.toEqual(a);
    expect(seq(otherStream)).not.toEqual(a);
  });

  it("nextF32 stays in [0, 1) and is f32-exact", () => {
    const rng = new Pcg32(7);
    let sum = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) {
      const v = rng.nextF32();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(Math.fround(v)).toBe(v);
      sum += v;
    }
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.02);
  });

  it("range stays within [min, max)", () => {
    const rng = new Pcg32(11, 3);
    for (let i = 0; i < 1000; i++) {
      const v = rng.range(-2.5, 4.5);
      expect(v).toBeGreaterThanOrEqual(-2.5);
      expect(v).toBeLessThan(4.5);
    }
  });

  it("fork derives independent, deterministic streams", () => {
    const seq = (rng: Pcg32) => Array.from({ length: 8 }, () => rng.nextU32());

    const parentA = new Pcg32(42, 54);
    const parentB = new Pcg32(42, 54);
    // Fork does not depend on how many numbers the parent has drawn.
    parentB.nextU32();
    parentB.nextU32();
    const forkA = parentA.fork(7);
    const forkB = parentB.fork(7);
    expect(seq(forkA)).toEqual(seq(forkB));

    // Distinct keys give distinct streams; forks differ from the parent.
    const parentC = new Pcg32(42, 54);
    const parentSeq = seq(parentC);
    expect(seq(new Pcg32(42, 54).fork(1))).not.toEqual(parentSeq);
    expect(seq(new Pcg32(42, 54).fork(1))).not.toEqual(seq(new Pcg32(42, 54).fork(2)));

    // Drawing from a fork does not disturb the parent.
    const parentD = new Pcg32(42, 54);
    const fork = parentD.fork(3);
    seq(fork);
    expect(seq(parentD)).toEqual(parentSeq);
  });
});
