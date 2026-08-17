/**
 * The `pcg` executable is three separate declarations that must agree:
 * package.json's `bin`, the shim in bin/, and the tsup entry that builds
 * what the shim imports. Any one of them drifting leaves an installed
 * `pcg` that fails at the first invocation and passes every other test in
 * this suite — the unpinned-constant class that has bitten this repo
 * before (VERSION, PLAN_FORMAT). So it is pinned.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const pkg = JSON.parse(read("package.json"));

/** The one path all three declarations have to agree on. */
const CLI_ENTRY = "src/cli/index.ts";
const CLI_DIST = "dist/cli/index.js";
const BIN_PATH = "bin/pcg.mjs";

describe("pcg bin", () => {
  it("package.json declares the bin and ships it", () => {
    expect(pkg.bin).toEqual({ pcg: BIN_PATH });
    expect(pkg.files).toContain("bin");
    expect(pkg.files).toContain("dist");
  });

  it("the ./cli export and the shim point at what tsup builds", () => {
    expect(pkg.exports["./cli"]).toEqual({
      types: "./dist/cli/index.d.ts",
      import: `./${CLI_DIST}`,
    });
    expect(read("tsup.config.ts")).toContain(`"${CLI_ENTRY}"`);

    const shim = read(BIN_PATH);
    expect(shim.startsWith("#!/usr/bin/env node")).toBe(true);
    expect(shim).toContain(`../${CLI_DIST}`);
    expect(shim).toContain("runCli");
    expect(shim).toContain("makeNodeIo");
    // process.exit truncates piped stdout; the shim must set exitCode.
    expect(shim).toContain("process.exitCode");
    expect(shim).not.toContain("process.exit(");
    // `pcg nodes | head` must not die on EPIPE.
    expect(shim).toContain("EPIPE");
  });

  it("ships the generated references the CLI's own help points at", () => {
    // Same unpinned-constant class as the bin path: `pcg nodes` and the
    // primitive catalog tell an agent to read these files, and a package
    // that does not ship them makes both instructions dead on install.
    for (const doc of [
      "docs/nodes.md",
      "docs/nodes.json",
      "docs/primitives.md",
      "docs/primitives.json",
      "docs/authoring.md",
    ]) {
      expect(pkg.files).toContain(doc);
    }
  });

  it("declares the primitives subpath the CLI imports to register them", () => {
    expect(pkg.exports["./primitives"]).toEqual({
      types: "./dist/primitives/index.d.ts",
      import: "./dist/primitives/index.js",
    });
    expect(read("tsup.config.ts")).toContain('"src/primitives/index.ts"');
    // Importing it is what fills the registry `pcg run` reads; a CLI that
    // dropped the import would still build, still pass its own tests, and
    // report that no subgraphs exist on every install.
    expect(read("src/cli/index.ts")).toContain('import "../primitives/index.js"');
  });

  it("every command the CLI dispatches is named in the shipped help", () => {
    const names = COMMANDS.map((c) => c.spec.name);
    expect(names).toEqual([
      "nodes",
      "fields",
      "validate",
      "assets",
      "cook",
      "run",
      "inspect",
      "render",
    ]);
    expect(new Set(names).size).toBe(names.length);
  });
});
