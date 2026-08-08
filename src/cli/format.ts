/**
 * Deterministic text formatting for the CLI. Every number the CLI prints
 * goes through one of these, so two runs over the same data produce the
 * same bytes — the property `pcg render` is judged on and the reason
 * `pcg inspect` output is diffable in a review.
 */

/** Trim trailing zeros (and a trailing dot) from a fixed-decimal string. */
function trimZeros(text: string): string {
  if (!text.includes(".")) return text;
  return text.replace(/\.?0+$/, "");
}

/**
 * Fixed-decimal formatting, trailing zeros trimmed, `-0` normalized to
 * `0` (JSON and JS print those differently and the difference is never
 * meaningful in a picture). Non-finite values format as their JS text.
 */
export function fmtFixed(n: number, decimals: number): string {
  if (!Number.isFinite(n)) return String(n);
  const trimmed = trimZeros(n.toFixed(decimals));
  return trimmed === "-0" || trimmed === "" ? "0" : trimmed;
}

/** Coordinate formatting for SVG output: 3 decimals is ~1/1000 of a pixel. */
export function fmtCoord(n: number): string {
  return fmtFixed(n, 3);
}

/** Statistic formatting: integers verbatim, everything else to 6 decimals. */
export function fmtStat(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n === 0 ? 0 : n);
  return fmtFixed(n, 6);
}

/** Elapsed-time formatting, always one decimal (`12.3 ms`). */
export function fmtMs(n: number): string {
  return `${Number.isFinite(n) ? n.toFixed(1) : String(n)} ms`;
}

/** A tuple of numbers as `[a, b, c]`, each through {@link fmtStat}. */
export function fmtTuple(values: readonly number[]): string {
  return `[${values.map(fmtStat).join(", ")}]`;
}

/** `1 point` / `2 points` — plural without a lookup table. */
export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

/**
 * Render rows as a left-aligned, space-padded table. Column widths come
 * from the content, so output is stable for stable input and greppable by
 * column position.
 */
export function table(rows: readonly (readonly string[])[], indent = "  "): string[] {
  if (rows.length === 0) return [];
  const columns = Math.max(...rows.map((r) => r.length));
  const widths: number[] = [];
  for (let c = 0; c < columns; c++) {
    widths.push(Math.max(...rows.map((r) => (r[c] ?? "").length)));
  }
  return rows.map((row) => {
    const cells: string[] = [];
    for (let c = 0; c < columns; c++) {
      const cell = row[c] ?? "";
      cells.push(c === columns - 1 ? cell : cell.padEnd(widths[c]));
    }
    return (indent + cells.join("  ")).replace(/\s+$/, "");
  });
}
