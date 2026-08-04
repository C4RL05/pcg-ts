import { hashCombine } from "./hash.js";

// 64-bit LCG multiplier 6364136223846793005, split into 32-bit halves.
const MUL_HI = 0x5851f42d;
const MUL_LO = 0x4c957f2d;
const MUL_LO_0 = MUL_LO & 0xffff;
const MUL_LO_1 = MUL_LO >>> 16;

const TWO32 = 0x100000000;
const INV_2_24 = 2 ** -24;

/**
 * PCG32 (PCG-XSH-RR 64/32): O'Neill's permuted congruential generator.
 * 64-bit state carried as two u32 halves — no BigInt on the hot path.
 * Matches the reference C implementation bit-for-bit: seed 42, stream 54
 * yields 0xa15c02b7, 0x7b47f409, 0xba1d3330, ...
 */
export class Pcg32 {
  private stateHi = 0;
  private stateLo = 0;
  private readonly incHi: number;
  private readonly incLo: number;
  private readonly seedHi: number;
  private readonly seedLo: number;
  private readonly streamHi: number;
  private readonly streamLo: number;

  /**
   * Create a generator from an integer seed and optional stream id.
   * Both are interpreted as 64-bit integers (safe up to 2^53); distinct
   * stream ids produce independent sequences for the same seed.
   */
  constructor(seed: number, streamId = 0) {
    this.seedLo = seed >>> 0;
    this.seedHi = Math.floor(seed / TWO32) >>> 0;
    this.streamLo = streamId >>> 0;
    this.streamHi = Math.floor(streamId / TWO32) >>> 0;
    // inc = (streamId << 1) | 1
    this.incLo = ((this.streamLo << 1) | 1) >>> 0;
    this.incHi = ((this.streamHi << 1) | (this.streamLo >>> 31)) >>> 0;
    // Reference seeding: state = 0; step; state += seed; step.
    this.step();
    const lo = this.stateLo + this.seedLo;
    this.stateLo = lo >>> 0;
    this.stateHi = (this.stateHi + this.seedHi + (lo >= TWO32 ? 1 : 0)) >>> 0;
    this.step();
  }

  /** Advance: state = state * MUL + inc (mod 2^64), via 32-bit halves. */
  private step(): void {
    const aLo = this.stateLo;
    const aHi = this.stateHi;
    // Full 64-bit product of aLo * MUL_LO via 16-bit limbs (exact doubles).
    const a0 = aLo & 0xffff;
    const a1 = aLo >>> 16;
    const p0 = a0 * MUL_LO_0;
    const p1 = a0 * MUL_LO_1 + a1 * MUL_LO_0;
    const p2 = a1 * MUL_LO_1;
    const mid = Math.floor(p0 / 0x10000) + p1;
    const prodLo = ((mid % 0x10000) * 0x10000 + (p0 % 0x10000)) >>> 0;
    let hi =
      p2 +
      Math.floor(mid / 0x10000) +
      (Math.imul(aLo, MUL_HI) >>> 0) +
      (Math.imul(aHi, MUL_LO) >>> 0);
    // 64-bit add of the increment.
    const lo = prodLo + this.incLo;
    hi += this.incHi + (lo >= TWO32 ? 1 : 0);
    this.stateLo = lo >>> 0;
    this.stateHi = hi >>> 0; // exact mod 2^32: hi < 2^53
  }

  /** Next unsigned 32-bit integer. */
  nextU32(): number {
    const oldLo = this.stateLo;
    const oldHi = this.stateHi;
    this.step();
    // xorshifted = ((old >> 18) ^ old) >> 27 (low 32 bits)
    const t18Lo = ((oldLo >>> 18) | (oldHi << 14)) >>> 0;
    const t18Hi = oldHi >>> 18;
    const xLo = (t18Lo ^ oldLo) >>> 0;
    const xHi = (t18Hi ^ oldHi) >>> 0;
    const xorshifted = ((xLo >>> 27) | (xHi << 5)) >>> 0;
    const rot = oldHi >>> 27; // old >> 59
    return ((xorshifted >>> rot) | (xorshifted << ((32 - rot) & 31))) >>> 0;
  }

  /**
   * Next float in [0, 1) with 24-bit resolution — exactly representable
   * as an f32, so it stays < 1 when stored in a Float32Array.
   */
  nextF32(): number {
    return (this.nextU32() >>> 8) * INV_2_24;
  }

  /** Next float in [min, max) (assuming max > min). */
  range(min: number, max: number): number {
    return min + this.nextF32() * (max - min);
  }

  /**
   * Derive an independent generator keyed by `key`. Forking depends only
   * on this generator's constructor arguments and the key — never on how
   * many numbers have been drawn — so fork trees are order-independent.
   */
  fork(key: number): Pcg32 {
    return new Pcg32(
      hashCombine(this.seedLo, this.seedHi, key),
      hashCombine(this.streamLo, this.streamHi, key),
    );
  }
}
