/**
 * The Node binding of {@link CliIo} — the only place in `src/cli` that
 * touches the filesystem or the process streams. Kept in its own module
 * so the commands stay pure and testable.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CliIo } from "./io.js";

/** Real stdout/stderr and real files. */
export function makeNodeIo(): CliIo {
  return {
    out: (text) => void process.stdout.write(text),
    err: (text) => void process.stderr.write(text),
    readFile: (path) => readFileSync(path, "utf8"),
    writeFile: (path, data) => {
      const dir = dirname(path);
      if (dir !== "" && dir !== ".") mkdirSync(dir, { recursive: true });
      writeFileSync(path, data);
    },
  };
}
