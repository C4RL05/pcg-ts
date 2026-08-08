/**
 * The formatting substrate the whole CLI rests on. Every number `pcg`
 * prints — every SVG coordinate, every statistic, every table cell — goes
 * through one of these, so the determinism the phase is judged on is
 * really a property of this file. It is pinned here rather than inferred
 * from the output of the commands that use it.
 */
import { describe, expect, it } from "vitest";
import { fmtCoord, fmtFixed, fmtMs, fmtStat, fmtTuple, plural, table } from "./format.js";

describe("fmtFixed", () => {
  it("rounds to the requested decimals and trims trailing zeros", () => {
    expect(fmtFixed(1.23456, 3)).toBe("1.235");
    expect(fmtFixed(1.2, 3)).toBe("1.2");
    expect(fmtFixed(1.0, 3)).toBe("1");
    expect(fmtFixed(2, 0)).toBe("2");
    expect(fmtFixed(0.0004, 3)).toBe("0");
    expect(fmtFixed(1234.5678, 2)).toBe("1234.57");
  });

  it("normalizes -0 to 0, at every decimal count", () => {
    // JSON and JS print -0 differently and the difference is never
    // meaningful; a stray "-0" is a byte difference for no reason.
    expect(fmtFixed(-0, 3)).toBe("0");
    expect(fmtFixed(-0, 0)).toBe("0");
    expect(fmtFixed(-0.0001, 3)).toBe("0");
    expect(fmtFixed(-0.0004, 2)).toBe("0");
    expect(String(1 / Number(fmtFixed(-0, 3)))).toBe("Infinity");
  });

  it("keeps a real negative negative", () => {
    expect(fmtFixed(-1.5, 3)).toBe("-1.5");
    expect(fmtFixed(-0.002, 3)).toBe("-0.002");
  });

  it("passes non-finite values through as their JS text", () => {
    expect(fmtFixed(Number.NaN, 3)).toBe("NaN");
    expect(fmtFixed(Number.POSITIVE_INFINITY, 3)).toBe("Infinity");
    expect(fmtFixed(Number.NEGATIVE_INFINITY, 3)).toBe("-Infinity");
  });

  it("is locale-independent: no grouping separators, ever", () => {
    expect(fmtFixed(1234567.5, 1)).toBe("1234567.5");
    expect(fmtFixed(1234567.5, 1)).not.toContain(",");
  });
});

describe("fmtCoord", () => {
  it("is fmtFixed at exactly 3 decimals", () => {
    // The SVG is written in pixel space, so 3 decimals is a thousandth of
    // a pixel whatever the world scale. Change this and every rendered
    // file changes.
    expect(fmtCoord(1.23456)).toBe("1.235");
    expect(fmtCoord(1.2345)).toBe("1.234");
    expect(fmtCoord(0.0005)).toBe("0.001");
    expect(fmtCoord(0.0004)).toBe("0");
    expect(fmtCoord(400)).toBe("400");
    expect(fmtCoord(14.814814814814815)).toBe("14.815");
  });
});

describe("fmtStat", () => {
  it("prints integers verbatim and everything else to 6 decimals", () => {
    expect(fmtStat(42)).toBe("42");
    expect(fmtStat(-7)).toBe("-7");
    expect(fmtStat(0)).toBe("0");
    expect(fmtStat(-0)).toBe("0");
    expect(fmtStat(4294967295)).toBe("4294967295");
    expect(fmtStat(0.5)).toBe("0.5");
    expect(fmtStat(1 / 3)).toBe("0.333333");
    expect(fmtStat(1e-9)).toBe("0");
  });

  it("names non-finite values instead of hiding them", () => {
    expect(fmtStat(Number.NaN)).toBe("NaN");
    expect(fmtStat(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});

describe("fmtMs / fmtTuple / plural", () => {
  it("formats elapsed time with one decimal", () => {
    expect(fmtMs(12.34)).toBe("12.3 ms");
    expect(fmtMs(0)).toBe("0.0 ms");
    expect(fmtMs(Number.NaN)).toBe("NaN ms");
  });

  it("formats a tuple through fmtStat", () => {
    expect(fmtTuple([1, 2.5, -0])).toBe("[1, 2.5, 0]");
    expect(fmtTuple([])).toBe("[]");
  });

  it("pluralizes without a lookup table", () => {
    expect(plural(1, "point")).toBe("1 point");
    expect(plural(2, "point")).toBe("2 points");
    expect(plural(0, "point")).toBe("0 points");
    expect(plural(1, "batch", "batches")).toBe("1 batch");
    expect(plural(3, "batch", "batches")).toBe("3 batches");
  });
});

describe("table", () => {
  it("pads columns to their content width so cells line up", () => {
    expect(table([["a", "bb"], ["ccc", "d"]])).toEqual(["  a    bb", "  ccc  d"]);
  });

  it("strips trailing whitespace, so the output is diffable", () => {
    const rows = table([["a", "bb"], ["c", ""]]);
    expect(rows[1]).toBe("  c");
    for (const row of rows) expect(row).toBe(row.replace(/\s+$/, ""));
  });

  it("honours the indent and tolerates ragged rows", () => {
    expect(table([["a"], ["b", "c"]], "    ")).toEqual(["    a", "    b  c"]);
  });

  it("renders no lines for no rows", () => {
    expect(table([])).toEqual([]);
  });
});
