/**
 * The flag parser on its own: the shapes the commands rely on, and the
 * misuses each command's error message promises to catch.
 */
import { describe, expect, it } from "vitest";
import {
  type CommandSpec,
  CliUsageError,
  boolFlag,
  commandHelp,
  intFlag,
  listFlag,
  numberFlag,
  parseArgs,
  parseNumberValue,
  stringFlag,
} from "./args.js";

const SPEC: CommandSpec = {
  name: "demo",
  summary: "A command that exists only in this test.",
  positionals: [
    { name: "file", required: true, description: "a file" },
    { name: "extra", required: false, description: "an optional second argument" },
  ],
  flags: {
    out: { kind: "string", value: "path", description: "where to write" },
    width: { kind: "number", value: "px", description: "how wide" },
    stats: { kind: "boolean", description: "print stats" },
    set: { kind: "strings", value: "k=v", description: "set one thing" },
  },
};

describe("parseArgs", () => {
  it("reads positionals, values, and switches", () => {
    const args = parseArgs(["a.json", "b", "--out", "x.svg", "--width", "12", "--stats"], SPEC);
    expect(args.positional).toEqual(["a.json", "b"]);
    expect(stringFlag(args, "out")).toBe("x.svg");
    expect(numberFlag(args, "width")).toBe(12);
    expect(boolFlag(args, "stats")).toBe(true);
  });

  it("accepts --flag=value, including =false on a switch", () => {
    const args = parseArgs(["a.json", "--out=x.svg", "--stats=false"], SPEC);
    expect(stringFlag(args, "out")).toBe("x.svg");
    expect(boolFlag(args, "stats")).toBe(false);
  });

  it("treats a negative number as a value, not as a flag", () => {
    expect(numberFlag(parseArgs(["a.json", "--width", "-4"], SPEC), "width")).toBe(-4);
  });

  it("stops reading flags after --", () => {
    const args = parseArgs(["--", "--out"], SPEC);
    expect(args.positional).toEqual(["--out"]);
    expect(stringFlag(args, "out")).toBeUndefined();
  });

  it("names the offender on every misuse", () => {
    const cases: readonly (readonly [readonly string[], string])[] = [
      [["a.json", "--nope"], 'demo: unknown flag "--nope"; valid flags: '],
      [["a.json", "-s"], 'demo: unknown flag "-s"'],
      [["a.json", "--out"], 'demo: flag "--out" needs a value'],
      [["a.json", "--out", "--stats"], 'demo: flag "--out" needs a value'],
      [["a.json", "--out", "--"], 'demo: flag "--out" needs a value'],
      [["a.json", "--width", "wide"], 'demo: flag "--width" expects a finite number, got "wide"'],
      [["a.json", "--stats=yes"], 'demo: flag "--stats" is a switch'],
      [["a.json", "--out", "x", "--out", "y"], 'demo: flag "--out" was given more than once'],
      [[], "demo: missing required argument <file>"],
      [["a", "b", "c"], 'demo: unexpected argument "c"'],
      // `--` on its own is legal, so blaming it for `--=x` sends the
      // reader looking in exactly the wrong place.
      [["a.json", "--=x"], 'demo: empty flag name in "--=x"'],
      [["a.json", "--="], 'demo: empty flag name in "--="'],
      // A path-shaped flag with nothing in it has no downstream lookup to
      // fail in, so it has to fail here, named.
      [["a.json", "--out="], 'demo: flag "--out" needs a non-empty value (--out <path>)'],
      [["a.json", "--out", ""], 'demo: flag "--out" needs a non-empty value'],
      [["a.json", "--out", "   "], 'demo: flag "--out" needs a non-empty value'],
      // Numbers must be spelled the way they were meant, not the way
      // `Number` happens to accept them.
      [["a.json", "--width", "0x10"], 'demo: flag "--width" expects a finite number, got "0x10"'],
      [["a.json", "--width", " 12 "], 'demo: flag "--width" expects a finite number'],
      [["a.json", "--width", "\t9\n"], 'demo: flag "--width" expects a finite number'],
      [["a.json", "--width", "0b11"], 'demo: flag "--width" expects a finite number'],
      [["a.json", "--width", "1_000"], 'demo: flag "--width" expects a finite number'],
      [["a.json", "--width", "Infinity"], 'demo: flag "--width" expects a finite number'],
      [["a.json", "--width", "1e400"], 'demo: flag "--width" expects a finite number'],
      [["a.json", "--width", ""], 'demo: flag "--width" expects a finite number'],
    ];
    for (const [argv, message] of cases) {
      expect(() => parseArgs(argv, SPEC), argv.join(" ")).toThrow(CliUsageError);
      expect(() => parseArgs(argv, SPEC), argv.join(" ")).toThrow(message);
    }
  });

  it("accepts the number spellings a caller would actually write", () => {
    const width = (text: string): number | undefined =>
      numberFlag(parseArgs(["a.json", "--width", text], SPEC), "width");
    expect(width("12")).toBe(12);
    expect(width("-4")).toBe(-4);
    expect(width("+4")).toBe(4);
    expect(width("1.5")).toBe(1.5);
    expect(width(".5")).toBe(0.5);
    expect(width("1e3")).toBe(1000);
    expect(width("2E-2")).toBe(0.02);
  });

  it("reads -h as --help, but only where a flag can stand", () => {
    expect(boolFlag(parseArgs(["a.json", "-h"], SPEC), "help")).toBe(true);
    expect(boolFlag(parseArgs(["a.json"], SPEC), "help")).toBe(false);
    // After --, and in a flag's value position, it is just a token.
    expect(parseArgs(["a.json", "--", "-h"], SPEC).positional).toEqual(["a.json", "-h"]);
    expect(stringFlag(parseArgs(["a.json", "--out", "-h"], SPEC), "out")).toBe("-h");
  });

  it("collects a repeatable flag's values in order, and only that flag's", () => {
    const args = parseArgs(
      ["a.json", "--set", "a=1", "--set=b=2", "--set", "c=3", "--out", "x"],
      SPEC,
    );
    expect(listFlag(args, "set")).toEqual(["a=1", "b=2", "c=3"]);
    // A repeat of the same flag used to throw; every OTHER flag still does.
    expect(stringFlag(args, "out")).toBe("x");
    expect(listFlag(parseArgs(["a.json"], SPEC), "set")).toEqual([]);
  });

  it("still refuses a repeat of every flag that is not declared repeatable", () => {
    for (const argv of [
      ["a.json", "--out", "x", "--out", "y"],
      ["a.json", "--width", "1", "--width", "2"],
      ["a.json", "--stats", "--stats"],
      ["a.json", "--json", "--json"],
    ]) {
      expect(() => parseArgs(argv, SPEC), argv.join(" ")).toThrow(CliUsageError);
      expect(() => parseArgs(argv, SPEC), argv.join(" ")).toThrow("was given more than once");
    }
  });

  it("applies the ordinary value rules to each occurrence of a repeatable flag", () => {
    for (const [argv, message] of [
      [["a.json", "--set", "a=1", "--set"], 'demo: flag "--set" needs a value (--set <k=v>)'],
      [["a.json", "--set="], 'demo: flag "--set" needs a non-empty value'],
      [["a.json", "--set", "a=1", "--set", "   "], 'demo: flag "--set" needs a non-empty value'],
    ] as const) {
      expect(() => parseArgs(argv, SPEC), argv.join(" ")).toThrow(message);
    }
  });

  it("refuses to read a flag through the wrong accessor, loudly", () => {
    const args = parseArgs(["a.json", "--set", "a=1", "--out", "x"], SPEC);
    expect(() => stringFlag(args, "set")).toThrow("declared repeatable");
    expect(() => listFlag(args, "out")).toThrow("not declared repeatable");
  });

  it("marks a repeatable flag as repeatable in help, derived from its kind", () => {
    const help = commandHelp(SPEC);
    expect(help).toContain("--set <k=v>");
    expect(help).toContain("set one thing (repeatable)");
    expect(help).not.toContain("where to write (repeatable)");
  });

  it("parseNumberValue is the one number spelling, shared with --flag values", () => {
    expect(parseNumberValue("12")).toBe(12);
    expect(parseNumberValue("-4.5")).toBe(-4.5);
    expect(parseNumberValue("1e3")).toBe(1000);
    for (const bad of ["0x10", " 12 ", "1_000", "Infinity", "1e400", "", "abc"]) {
      expect(parseNumberValue(bad), bad).toBeUndefined();
    }
  });

  it("lists every valid flag, common ones included", () => {
    let message = "";
    try {
      parseArgs(["a.json", "--nope"], SPEC);
    } catch (err) {
      message = (err as Error).message;
    }
    // Asserted outside the try, so a parseArgs that stopped throwing fails
    // here rather than being swallowed by the catch it was meant to prove.
    expect(message).toContain('unknown flag "--nope"');
    for (const flag of ["--out", "--width", "--stats", "--json", "--help"]) {
      expect(message).toContain(flag);
    }
  });
});

describe("intFlag", () => {
  const parse = (text: string): ReturnType<typeof parseArgs> =>
    parseArgs(["a.json", "--width", text], SPEC);

  it("accepts an integer in range and reports it verbatim", () => {
    expect(intFlag(parse("12"), "width", "demo", { min: 1 })).toBe(12);
    expect(intFlag(parse("0"), "width", "demo")).toBe(0);
    expect(intFlag(parse("4294967295"), "width", "demo", { min: 0, max: 0xffffffff })).toBe(
      4294967295,
    );
    expect(intFlag(parseArgs(["a.json"], SPEC), "width", "demo")).toBeUndefined();
  });

  it("names the flag and the range it broke, never truncating to fit", () => {
    expect(() => intFlag(parse("1.5"), "width", "demo")).toThrow(
      'demo: flag "--width" expects an integer >= 0, got 1.5',
    );
    expect(() => intFlag(parse("-1"), "width", "demo")).toThrow(
      'demo: flag "--width" expects an integer >= 0, got -1',
    );
    expect(() => intFlag(parse("0"), "width", "demo", { min: 1 })).toThrow(
      'demo: flag "--width" expects an integer >= 1, got 0',
    );
    expect(() => intFlag(parse("4294967296"), "width", "demo", { min: 0, max: 0xffffffff })).toThrow(
      'demo: flag "--width" expects an integer in [0, 4294967295], got 4294967296',
    );
    expect(() => intFlag(parse("-1"), "width", "demo", { min: 0, max: 8 })).toThrow(
      'demo: flag "--width" expects an integer in [0, 8], got -1',
    );
  });
});
