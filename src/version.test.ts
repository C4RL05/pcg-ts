/**
 * `VERSION` is the only version string a consumer can read at runtime,
 * and nothing else in the build derives it from `package.json` — so it
 * drifts silently. It did: it still said 0.6.1 after 0.7.0 shipped,
 * because bumping the package is a separate act from editing this
 * constant and nothing connected the two.
 *
 * This pins them together. If it fails, the fix is to make `VERSION`
 * match `package.json`, not to relax the test.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERSION } from "./index.js";

describe("VERSION", () => {
  it("matches the version in package.json", () => {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
