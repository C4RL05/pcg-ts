/**
 * The flag parser on its own: the shapes the commands rely on, and the
 * misuses each command's error message promises to catch.
 */
import { describe, expect, it } from "vitest";
import { type CommandSpec, CliUsageError, boolFlag, numberFlag, parseArgs, stringFlag } from "./args.js";

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
    ];
    for (const [argv, message] of cases) {
      expect(() => parseArgs(argv, SPEC), argv.join(" ")).toThrow(CliUsageError);
      expect(() => parseArgs(argv, SPEC), argv.join(" ")).toThrow(message);
    }
  });

  it("lists every valid flag, common ones included", () => {
    try {
      parseArgs(["a.json", "--nope"], SPEC);
      expect.unreachable("should have thrown");
    } catch (err) {
      const message = (err as Error).message;
      for (const flag of ["--out", "--width", "--stats", "--json", "--help"]) {
        expect(message).toContain(flag);
      }
    }
  });
});
