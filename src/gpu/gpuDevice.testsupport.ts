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

/**
 * Hook budget for a device suite that builds a whole scenario in
 * `beforeAll`.
 *
 * Vitest's 10s default is not a budget these can respect: one scenario
 * acquires an adapter, compiles every pipeline variant it exercises and
 * cooks the graph, and the largest already measured 10.46s on an RTX
 * 5090 — so it failed on hook timeout while every assertion in it
 * passed. A gate that trips on the difference between 9.9 and 10.5
 * seconds of shader compilation is reporting machine speed, not
 * correctness.
 *
 * This is generous on purpose. It is a ceiling for a hung device, not a
 * performance assertion: nothing here should be read as "40s is fine".
 * These suites skip entirely where no adapter exists (CI included), so
 * the number only ever applies on a developer machine with a GPU.
 */
export const DEVICE_HOOK_TIMEOUT_MS = 40_000;
