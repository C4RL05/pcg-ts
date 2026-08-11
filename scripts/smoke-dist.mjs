/**
 * Dist smoke test: proves the BUILT package works, entry by entry, the
 * way consumers actually load it. `npm test` runs against `src/` and
 * cannot see this class of failure: bundler code splitting once emitted
 * chunk imports in an order where the primitives chunk registered its
 * recipes before the standard-node chunk had evaluated, so importing
 * `pcg-ts/primitives` (or the CLI, or dist/docs) ALONE crashed with
 * `unknown node type "setAttribute"` — while src tests, the worker
 * entry (saved by a lucky chunk order), and `import "pcg-ts"` all
 * stayed green.
 *
 * Therefore every public entry is imported in a FRESH node subprocess
 * (module caches in a shared process would mask ordering: whichever
 * entry loads first evaluates the shared chunks for everyone after it),
 * and each asserts through its own surface that the registries are
 * actually populated. The worker path is exercised for real: a pooled
 * cook spawns dist/worker/entryNode.js inside a worker_threads Worker.
 *
 * Run after `npm run build`. Wired into `prepublishOnly`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** file:// URL literal for a repo-relative path, for embedding in -e code. */
function distUrl(relative) {
  return JSON.stringify(pathToFileURL(join(root, relative)).href);
}

const INDEX = distUrl("dist/index.js");
const PRIMITIVES = distUrl("dist/primitives/index.js");
const THREE = distUrl("dist/three/index.js");
const GPU = distUrl("dist/gpu/index.js");
const CLI = distUrl("dist/cli/index.js");
const WORKER = distUrl("dist/worker/index.js");
const ENTRY_NODE = distUrl("dist/worker/entryNode.js");
const ENTRY_BROWSER = distUrl("dist/worker/entryBrowser.js");
const DOCS = distUrl("dist/docs/index.js");

/**
 * Each case runs in its own node subprocess so no case can pre-warm the
 * module cache for another. The code is written to a temp .mjs file
 * rather than passed via `--input-type=module -e`, because
 * worker_threads Workers inherit execArgv and `--input-type` is invalid
 * for path input — it would crash the pooled-cook case's worker.
 * A case passes when the process exits 0.
 */
const importCases = [
  {
    name: "pcg-ts (dist/index.js): standard node registry populated",
    code: `
      const pcg = await import(${INDEX});
      const n = pcg.listNodeTypes().length;
      if (n <= 30) throw new Error("expected > 30 registered node types, got " + n);
      if (!pcg.hasNodeType("setAttribute")) throw new Error("setAttribute is not registered");
    `,
  },
  {
    name: "pcg-ts/primitives imported ALONE, then pcg-ts (the shipped regression)",
    code: `
      // Order matters: primitives FIRST. This is the exact import order
      // that crashed in the broken build (primitives chunk evaluated
      // before the standard-node chunk).
      await import(${PRIMITIVES});
      const pcg = await import(${INDEX});
      const n = pcg.listNodeTypes().length;
      if (n <= 30) throw new Error("expected > 30 registered node types, got " + n);
      const s = pcg.listSubgraphs().length;
      if (s <= 20) throw new Error("expected > 20 registered primitives, got " + s);
      if (!pcg.hasRegisteredSubgraph("write/height-slope")) {
        throw new Error("primitive write/height-slope (the first one registered) is missing");
      }
    `,
  },
  {
    name: "pcg-ts/three imported alone",
    code: `
      const three = await import(${THREE});
      if (typeof three.toInstancedMeshes !== "function") throw new Error("toInstancedMeshes missing");
    `,
  },
  {
    name: "pcg-ts/gpu imported alone",
    code: `
      const gpu = await import(${GPU});
      if (typeof gpu.compileFieldSpec !== "function") throw new Error("compileFieldSpec missing");
    `,
  },
  {
    name: "CLI module (dist/cli/index.js) imported alone",
    code: `
      await import(${CLI});
      const pcg = await import(${INDEX});
      if (pcg.listSubgraphs().length <= 20) throw new Error("CLI import did not register the primitives");
    `,
  },
  {
    name: "pcg-ts/worker imported alone",
    code: `
      const worker = await import(${WORKER});
      if (typeof worker.CookWorkerPool !== "function") throw new Error("CookWorkerPool missing");
    `,
  },
  {
    name: "pcg-ts/worker/node main-thread guard",
    code: `
      // Importing the worker entry on a main thread must fail with its
      // guidance error — anything else (including succeeding) is a bug.
      try {
        await import(${ENTRY_NODE});
        throw new Error("importing entryNode on the main thread did not throw");
      } catch (err) {
        const msg = String(err && err.message);
        if (!msg.includes("worker_threads")) throw err;
      }
    `,
  },
  {
    name: "pcg-ts/worker/browser worker-scope guard",
    code: `
      try {
        await import(${ENTRY_BROWSER});
        throw new Error("importing entryBrowser outside a worker scope did not throw");
      } catch (err) {
        const msg = String(err && err.message);
        if (!msg.includes("worker scope")) throw err;
      }
    `,
  },
  {
    name: "dist/docs (build tooling entry) imported alone",
    code: `
      const docs = await import(${DOCS});
      if (typeof docs.renderSiteVersion !== "function") throw new Error("renderSiteVersion missing");
      if (!Array.isArray(docs.SITE_PAGES)) throw new Error("SITE_PAGES missing");
    `,
  },
  {
    name: "pooled cook through dist/worker/entryNode.js in a real Worker",
    code: `
      const { CookWorkerPool } = await import(${WORKER});
      const { Graph, pointScatterInBounds, serializeGraph } = await import(${INDEX});
      const graph = new Graph(1);
      const scatter = graph.add(pointScatterInBounds, {
        count: 64,
        boundsMin: [0, 0, 0],
        boundsMax: [8, 0, 8],
      });
      graph.output(scatter, "out", "points");
      // No createWorker: the pool's default spawns dist/worker/entryNode.js
      // next to dist/worker/index.js — exactly what a consumer gets.
      const pool = new CookWorkerPool({ workers: 1 });
      try {
        const result = await pool.cook({ graph: serializeGraph(graph) });
        if (!result || !result.outputs || !result.outputs.points) {
          throw new Error("pooled cook returned no 'points' output");
        }
      } finally {
        await pool.close();
      }
    `,
  },
];

/** CLI commands, run exactly as a user would. */
const cliCases = [
  {
    name: "CLI: pcg nodes",
    args: [join(root, "bin/pcg.mjs"), "nodes"],
    check: (out) => {
      if (!/\d+ node types/.test(out)) return "output does not report a node-type count";
      return undefined;
    },
  },
  {
    name: "CLI: pcg validate examples/graphs/basics-primitive-ref.json",
    // A graph whose "ref" node resolves a registered primitive — validation
    // fails unless both the node AND primitive registries populated. Also a
    // corpus graph, so this same command works against a packed tarball.
    args: [join(root, "bin/pcg.mjs"), "validate", join(root, "examples/graphs/basics-primitive-ref.json")],
    check: (out) => {
      if (!out.includes("ok")) return "validate did not report ok";
      return undefined;
    },
  },
];

function fail(name, detail, proc) {
  console.error(`FAIL  ${name}`);
  if (detail) console.error(`      ${detail}`);
  if (proc) {
    const text = `${proc.stdout ?? ""}${proc.stderr ?? ""}`.trim();
    if (text) console.error(text.split("\n").map((l) => `      | ${l}`).join("\n"));
  }
  process.exitCode = 1;
}

// Guard rail: the build must exist (and be current enough to have every
// entry) before any subprocess spawns.
const requiredEntries = [
  "dist/index.js",
  "dist/primitives/index.js",
  "dist/three/index.js",
  "dist/gpu/index.js",
  "dist/cli/index.js",
  "dist/worker/index.js",
  "dist/worker/entryNode.js",
  "dist/worker/entryBrowser.js",
  "dist/docs/index.js",
];
const missing = requiredEntries.filter((p) => !existsSync(join(root, p)));
if (missing.length > 0) {
  console.error(`smoke-dist: missing built entries (run \`npm run build\` first):\n  ${missing.join("\n  ")}`);
  process.exit(1);
}

// Every exports target in package.json must be a real file — a rename in
// tsup.config.ts that orphans an exports path should fail here, not at
// install time.
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
for (const [subpath, target] of Object.entries(pkg.exports)) {
  const targets = typeof target === "string" ? [target] : Object.values(target);
  for (const t of targets) {
    if (!existsSync(join(root, t))) {
      fail(`exports["${subpath}"]`, `target ${t} does not exist in the build output`);
    }
  }
}

const started = Date.now();
let ran = 0;

const caseDir = mkdtempSync(join(tmpdir(), "pcg-smoke-"));
try {
  for (const [i, c] of importCases.entries()) {
    const caseFile = join(caseDir, `case-${i}.mjs`);
    writeFileSync(caseFile, c.code);
    const t0 = Date.now();
    const proc = spawnSync(process.execPath, [caseFile], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
    });
    ran += 1;
    if (proc.status !== 0) {
      fail(c.name, proc.signal ? `killed by ${proc.signal} (timeout?)` : `exit ${proc.status}`, proc);
    } else {
      console.log(`ok    ${c.name} (${Date.now() - t0}ms)`);
    }
  }
} finally {
  rmSync(caseDir, { recursive: true, force: true });
}

for (const c of cliCases) {
  const t0 = Date.now();
  const proc = spawnSync(process.execPath, c.args, { cwd: root, encoding: "utf8", timeout: 30_000 });
  ran += 1;
  if (proc.status !== 0) {
    fail(c.name, proc.signal ? `killed by ${proc.signal} (timeout?)` : `exit ${proc.status}`, proc);
    continue;
  }
  const problem = c.check(`${proc.stdout ?? ""}${proc.stderr ?? ""}`);
  if (problem) {
    fail(c.name, problem, proc);
  } else {
    console.log(`ok    ${c.name} (${Date.now() - t0}ms)`);
  }
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
if (process.exitCode) {
  console.error(`\nsmoke-dist: FAILED (${ran} cases, ${elapsed}s)`);
} else {
  console.log(`\nsmoke-dist: all ${ran} cases passed (${elapsed}s)`);
}
