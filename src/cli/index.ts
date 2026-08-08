/**
 * `pcg` — the graph CLI: the authoring feedback loop an agent (or a
 * human, or CI) runs against a graph JSON file without writing a bespoke
 * script. Catalogs (`nodes`, `fields`), then validate → cook → inspect →
 * render.
 *
 * Exit codes: 0 success, 1 a failure the run hit (invalid graph,
 * unreadable file, a cook that threw), 2 a misuse of the command line.
 * Library errors are printed verbatim — naming the offending node, pin or
 * param is the library's job, and the CLI must not paraphrase it.
 */
import { VERSION } from "../index.js";
import { CliUsageError, boolFlag, commandHelp, parseArgs, usageLine } from "./args.js";
import { COMMANDS, type Command } from "./commands.js";
import { CliError } from "./errors.js";
import type { CliIo } from "./io.js";

export { type CliIo } from "./io.js";
export { makeNodeIo } from "./nodeIo.js";
export { CliUsageError } from "./args.js";
export { CliError } from "./errors.js";
export { renderSvg, type RenderOptions, type RenderResult } from "./render.js";
export {
  type AttrStats,
  type GeometrySummary,
  type ItemSummary,
  attributeStats,
  geometrySummary,
  summarizeItem,
} from "./summary.js";

/** Exit codes the CLI returns. */
export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

function topLevelHelp(): string {
  const width = Math.max(...COMMANDS.map((c) => c.spec.name.length));
  const lines = [
    "pcg — deterministic procedural content generation, from the command line",
    "",
    "usage: pcg <command> [args] [flags]",
    "",
    "Commands:",
    ...COMMANDS.map((c) => `  ${c.spec.name.padEnd(width)}  ${c.spec.summary.split(". ")[0]}.`),
    "",
    "Flags:",
    "  --json     print the machine-readable report instead of text",
    "  --help     print usage (per command: pcg <command> --help)",
    "  --version  print the library version",
    "",
    "The loop: pcg validate g.json && pcg cook g.json --stats && pcg inspect g.json --node <id>",
    "",
    ...COMMANDS.map((c) => `  ${usageLine(c.spec)}`),
    "",
  ];
  return lines.join("\n");
}

/**
 * Run one CLI invocation and return its exit code. Everything the CLI
 * touches goes through `io`, so this is fully testable in-process.
 */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const [first, ...rest] = argv;

  if (first === undefined || first === "--help" || first === "-h" || first === "help") {
    const wanted = first === "help" ? rest[0] : undefined;
    if (wanted !== undefined) {
      const command = COMMANDS.find((c) => c.spec.name === wanted);
      if (command === undefined) {
        io.err(`unknown command "${wanted}"; commands: ${COMMANDS.map((c) => c.spec.name).join(", ")}\n`);
        return EXIT_USAGE;
      }
      io.out(commandHelp(command.spec));
      return EXIT_OK;
    }
    if (first === undefined) {
      io.err(topLevelHelp());
      return EXIT_USAGE;
    }
    io.out(topLevelHelp());
    return EXIT_OK;
  }

  if (first === "--version" || first === "-v") {
    io.out(`${VERSION}\n`);
    return EXIT_OK;
  }

  const command: Command | undefined = COMMANDS.find((c) => c.spec.name === first);
  if (command === undefined) {
    io.err(
      `unknown command "${first}"; commands: ${COMMANDS.map((c) => c.spec.name).join(", ")}\nrun "pcg --help" for usage\n`,
    );
    return EXIT_USAGE;
  }

  // Asking for help must work on an otherwise incomplete command line —
  // `pcg inspect --help` is exactly what someone types when they do not
  // know which arguments it wants.
  if (rest.includes("--help") || rest.includes("-h")) {
    io.out(commandHelp(command.spec));
    return EXIT_OK;
  }

  try {
    const args = parseArgs(rest, command.spec);
    const outcome = await command.run(args, io);
    io.out(boolFlag(args, "json") ? JSON.stringify(outcome.json, null, 2) + "\n" : outcome.text);
    return EXIT_OK;
  } catch (err) {
    if (err instanceof CliUsageError) {
      io.err(`${err.message}\nrun "pcg ${command.spec.name} --help" for usage\n`);
      return EXIT_USAGE;
    }
    if (err instanceof CliError) {
      io.err(`${err.message}\n`);
      return EXIT_FAILURE;
    }
    // Library errors reach the user unchanged, message and all.
    io.err(`${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_FAILURE;
  }
}
