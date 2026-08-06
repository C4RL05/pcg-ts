/**
 * Adapter detection for the `*.device.test.ts` suites. Probes for a
 * WebGPU adapter by running the plain-Node device runner with an empty
 * task list — deliberately OUT of process: the Dawn bindings crash
 * vitest worker processes nondeterministically (see deviceRunner.mjs),
 * so no test worker ever touches Dawn directly. Device suites gate on
 * the result with `describe.skipIf`, reporting SKIPPED with an explicit
 * reason when no adapter exists — never a silent pass, never a failure.
 * Test-only.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { GpuAdapterInfoLike } from "./device.js";

/** A detected adapter identity (the device itself lives in child processes). */
export interface TestDevice {
  readonly info: GpuAdapterInfoLike;
  readonly label: string;
}

function probe(): TestDevice | null {
  try {
    const runner = fileURLToPath(new URL("./deviceRunner.mjs", import.meta.url));
    const stdout = execFileSync(process.execPath, [runner], {
      input: JSON.stringify({ tasks: [] }),
      encoding: "utf8",
      timeout: 60_000,
    });
    const parsed = JSON.parse(stdout) as
      | { ok: true; adapter: GpuAdapterInfoLike }
      | { ok: false; error: string };
    if (!parsed.ok) return null;
    const info = parsed.adapter;
    const label = [info.vendor, info.architecture, info.device, info.description]
      .filter((v) => v !== undefined && v !== "")
      .join(" ");
    return { info, label: label === "" ? "unknown adapter" : label };
  } catch {
    return null;
  }
}

/** The detected adapter, or null when none is available. */
export const testDevice: TestDevice | null = probe();

/** Suite title suffix making skips self-explanatory in the report. */
export function deviceSuiteName(base: string): string {
  return testDevice === null
    ? `${base} [SKIPPED: no WebGPU adapter available]`
    : `${base} [${testDevice.label}]`;
}
