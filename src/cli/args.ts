/**
 * Argument parsing for the `pcg` CLI: a declarative flag spec per
 * command, so every command validates its own surface and every mistake
 * gets the same shape of error — name the offender, list the valid
 * alternatives (the library's house rule, applied to the command line).
 */

/** A misuse of the command line: unknown command, unknown flag, missing value. */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

/** What a flag carries. */
export type FlagKind = "boolean" | "string" | "number";

/** One declared flag. */
export interface FlagSpec {
  readonly kind: FlagKind;
  /** Value placeholder in help output, e.g. "n" in `--seed <n>`. */
  readonly value?: string;
  readonly description: string;
}

/** One declared positional argument. */
export interface PositionalSpec {
  readonly name: string;
  readonly required: boolean;
  readonly description: string;
}

/** The full surface of one subcommand. */
export interface CommandSpec {
  readonly name: string;
  readonly summary: string;
  readonly positionals: readonly PositionalSpec[];
  readonly flags: Readonly<Record<string, FlagSpec>>;
}

/** Flags every command accepts. */
export const COMMON_FLAGS: Readonly<Record<string, FlagSpec>> = {
  json: { kind: "boolean", description: "print the machine-readable report instead of text" },
  help: { kind: "boolean", description: "print this command's usage and exit" },
};

/** Parsed command line for one subcommand. */
export interface ParsedArgs {
  readonly positional: readonly string[];
  readonly flags: ReadonlyMap<string, string | number | boolean>;
}

function allFlags(spec: CommandSpec): Record<string, FlagSpec> {
  return { ...COMMON_FLAGS, ...spec.flags };
}

function flagList(spec: CommandSpec): string {
  return Object.keys(allFlags(spec))
    .sort()
    .map((name) => `--${name}`)
    .join(", ");
}

/** Render `pcg <command> ...` usage, one line. */
export function usageLine(spec: CommandSpec): string {
  const args = spec.positionals
    .map((p) => (p.required ? `<${p.name}>` : `[${p.name}]`))
    .join(" ");
  return `pcg ${spec.name}${args === "" ? "" : ` ${args}`} [flags]`;
}

/** Render full help for one subcommand. */
export function commandHelp(spec: CommandSpec): string {
  const lines = [usageLine(spec), "", spec.summary, ""];
  if (spec.positionals.length > 0) {
    lines.push("Arguments:");
    const width = Math.max(...spec.positionals.map((p) => p.name.length));
    for (const p of spec.positionals) {
      lines.push(`  ${p.name.padEnd(width)}  ${p.description}`);
    }
    lines.push("");
  }
  const flags = allFlags(spec);
  const names = Object.keys(flags).sort();
  const label = (name: string): string =>
    `--${name}${flags[name].value !== undefined ? ` <${flags[name].value}>` : ""}`;
  const width = Math.max(...names.map((n) => label(n).length));
  lines.push("Flags:");
  for (const name of names) {
    lines.push(`  ${label(name).padEnd(width)}  ${flags[name].description}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * The spelling a numeric flag value must have: an optional sign, decimal
 * digits, an optional fraction and an optional exponent. Deliberately
 * narrower than `Number`, which also accepts `0x10`, `0b11` and values
 * padded with whitespace — near-misses that would proceed with a number
 * the caller never wrote.
 */
const NUMBER_SPELLING = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Parse one subcommand's arguments. Supports `--flag`, `--flag value`,
 * and `--flag=value`; `--` ends flag parsing. A repeated flag is an error
 * rather than a silent last-wins, because a repeat is nearly always a
 * mistake the caller wants to hear about.
 *
 * `-h` is the one short spelling accepted, as an alias for `--help`, and
 * only in flag position: after `--`, or where a flag's value is expected
 * (`--node -h`), it is an ordinary value like any other token.
 */
export function parseArgs(argv: readonly string[], spec: CommandSpec): ParsedArgs {
  const flags = allFlags(spec);
  const values = new Map<string, string | number | boolean>();
  const positional: string[] = [];
  let onlyPositional = false;

  for (let i = 0; i < argv.length; i++) {
    const raw0 = argv[i];
    if (onlyPositional || raw0 === "-" || !raw0.startsWith("-")) {
      positional.push(raw0);
      continue;
    }
    if (raw0 === "--") {
      onlyPositional = true;
      continue;
    }
    const token = raw0 === "-h" ? "--help" : raw0;
    if (!token.startsWith("--")) {
      throw new CliUsageError(
        `${spec.name}: unknown flag "${token}" (short flags are not supported, except -h for --help); valid flags: ${flagList(spec)}`,
      );
    }
    const eq = token.indexOf("=");
    const name = eq < 0 ? token.slice(2) : token.slice(2, eq);
    const inlineValue = eq < 0 ? undefined : token.slice(eq + 1);
    if (name === "") {
      // `--=x` is not the end-of-flags marker with something stuck to it;
      // blaming `--`, which is legal on its own, sends the reader looking
      // in the wrong place.
      throw new CliUsageError(
        `${spec.name}: empty flag name in "${token}"; write --<name>=<value>; valid flags: ${flagList(spec)}`,
      );
    }
    const flag = flags[name];
    if (flag === undefined) {
      throw new CliUsageError(
        `${spec.name}: unknown flag "--${name}"; valid flags: ${flagList(spec)}`,
      );
    }
    if (values.has(name)) {
      throw new CliUsageError(`${spec.name}: flag "--${name}" was given more than once`);
    }
    if (flag.kind === "boolean") {
      if (inlineValue === undefined) {
        values.set(name, true);
      } else if (inlineValue === "true" || inlineValue === "false") {
        values.set(name, inlineValue === "true");
      } else {
        throw new CliUsageError(
          `${spec.name}: flag "--${name}" is a switch; write "--${name}", "--${name}=true", or "--${name}=false", got "${inlineValue}"`,
        );
      }
      continue;
    }
    let raw = inlineValue;
    if (raw === undefined) {
      // A following token is the value unless it is another flag or the
      // end-of-flags marker. `-1` is deliberately a value, not a flag, so
      // negative numbers work.
      const next = argv[i + 1];
      if (next === undefined || next === "--" || next.startsWith("--")) {
        throw new CliUsageError(
          `${spec.name}: flag "--${name}" needs a value (--${name} <${flag.value ?? "value"}>)`,
        );
      }
      raw = next;
      i++;
    }
    if (flag.kind === "number") {
      const n = NUMBER_SPELLING.test(raw) ? Number(raw) : Number.NaN;
      if (!Number.isFinite(n)) {
        throw new CliUsageError(
          `${spec.name}: flag "--${name}" expects a finite number, got "${raw}"; write plain decimal digits with an optional sign, fraction and exponent (12, -4, 1.5, 1e3) — not hex, not padded with spaces`,
        );
      }
      values.set(name, n);
    } else {
      if (raw.trim() === "") {
        throw new CliUsageError(
          `${spec.name}: flag "--${name}" needs a non-empty value (--${name} <${flag.value ?? "value"}>)`,
        );
      }
      values.set(name, raw);
    }
  }

  const required = spec.positionals.filter((p) => p.required);
  if (positional.length < required.length) {
    const missing = required[positional.length];
    throw new CliUsageError(
      `${spec.name}: missing required argument <${missing.name}> (${missing.description})\nusage: ${usageLine(spec)}`,
    );
  }
  if (positional.length > spec.positionals.length) {
    throw new CliUsageError(
      `${spec.name}: unexpected argument "${positional[spec.positionals.length]}"\nusage: ${usageLine(spec)}`,
    );
  }
  return { positional, flags: values };
}

/** Read a string flag, or `undefined` when it was not given. */
export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const v = args.flags.get(name);
  return v === undefined ? undefined : String(v);
}

/** Read a boolean flag (absent = false). */
export function boolFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

/** Read a number flag, or `undefined` when it was not given. */
export function numberFlag(args: ParsedArgs, name: string): number | undefined {
  const v = args.flags.get(name);
  return typeof v === "number" ? v : undefined;
}

/**
 * Read a number flag that must be an integer in range (counts, widths,
 * seeds). Names the command, the flag and the range on failure — a flag
 * whose value is silently clamped or truncated is a near-miss that
 * proceeds, and this CLI never does that.
 */
export function intFlag(
  args: ParsedArgs,
  name: string,
  command: string,
  opts: { min?: number; max?: number } = {},
): number | undefined {
  const v = numberFlag(args, name);
  if (v === undefined) return undefined;
  const min = opts.min ?? 0;
  const max = opts.max;
  if (!Number.isInteger(v) || v < min || (max !== undefined && v > max)) {
    throw new CliUsageError(
      max === undefined
        ? `${command}: flag "--${name}" expects an integer >= ${min}, got ${v}`
        : `${command}: flag "--${name}" expects an integer in [${min}, ${max}], got ${v}`,
    );
  }
  return v;
}
