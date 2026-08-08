#!/usr/bin/env node
/**
 * The `pcg` executable. Everything it does lives in the built library
 * (dist/cli/index.js); this file only binds the process to it, so the
 * CLI's behavior is typechecked and unit-tested with the rest of src.
 */
// `pcg nodes | head` closes stdout early; without this the write fails
// with EPIPE and the CLI dies noisily on a perfectly ordinary pipeline.
process.stdout.on("error", (err) => {
  if (!err || err.code !== "EPIPE") throw err;
});

let cli;
try {
  cli = await import(new URL("../dist/cli/index.js", import.meta.url).href);
} catch (err) {
  if (err && err.code === "ERR_MODULE_NOT_FOUND") {
    process.stderr.write(
      [
        "pcg: dist/cli/index.js not found — the library is not built.",
        "Run `npm run build` first, then re-run the command.",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
  } else {
    throw err;
  }
}

if (cli !== undefined) {
  // Set exitCode rather than calling process.exit, so buffered stdout is
  // flushed before the process ends (piped output would otherwise truncate).
  process.exitCode = await cli.runCli(process.argv.slice(2), cli.makeNodeIo());
}
