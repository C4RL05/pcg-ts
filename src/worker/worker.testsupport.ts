/**
 * Shared helpers for the worker suite.
 *
 * A `worker_threads.Worker` loads real JS off disk — it cannot see
 * vitest's in-process TS transforms — so the tests bundle the Node worker
 * entry once per test file with esbuild (already present as tsup's
 * bundler; production never touches this path) and spawn workers on the
 * bundle. This mirrors production exactly: the shipped worker entry is a
 * bundled artifact too (dist/worker/entryNode.js), so the suite exercises
 * the real cross-build determinism claim — a vitest-transformed main
 * thread against an esbuild-bundled worker must agree byte-for-byte.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { CookWorkerLike } from "./pool.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "../../node_modules/.cache/pcg-ts-worker-tests");

/** A bundled worker entry: its URL and a best-effort cleanup. */
export interface BundledEntry {
  readonly url: URL;
  /** Spawn one worker on the bundle (satisfies `CookWorkerLike`). */
  createWorker(): CookWorkerLike;
  /** Delete the bundle file (call after every worker is terminated). */
  cleanup(): void;
}

let bundleSerial = 0;

/**
 * Bundle `src/worker/entryNode.ts` for `worker_threads`. Each call gets
 * its own output file (pid + serial), so concurrent vitest workers never
 * race on one path.
 */
export async function bundleWorkerEntry(): Promise<BundledEntry> {
  mkdirSync(OUT_DIR, { recursive: true });
  const outfile = join(OUT_DIR, `entryNode-${process.pid}-${bundleSerial++}.mjs`);
  await build({
    entryPoints: [join(HERE, "entryNode.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    sourcemap: "inline",
    logLevel: "silent",
  });
  const url = pathToFileURL(outfile);
  return {
    url,
    createWorker: () => new Worker(url) as unknown as CookWorkerLike,
    cleanup: () => {
      try {
        rmSync(outfile);
      } catch {
        /* best effort; .cache is disposable */
      }
    },
  };
}
