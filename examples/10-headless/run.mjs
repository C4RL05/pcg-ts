#!/usr/bin/env node
/**
 * The headless example: load a graph from JSON, cook it in plain Node,
 * print what came out. No renderer, no page, no bespoke graph-building
 * code — the graph is `graph.json` beside this file, and this script is
 * only the harness around it.
 *
 * Usage (after `npm run build`):
 *   node examples/10-headless/run.mjs [seed]
 *
 * The same graph through the CLI, which needs no script at all:
 *   pcg validate examples/10-headless/graph.json
 *   pcg cook     examples/10-headless/graph.json --stats
 *   pcg inspect  examples/10-headless/graph.json --node height
 *   pcg render   examples/10-headless/graph.json --attr height --out ridge.svg
 */
import { readFileSync } from "node:fs";

const graphPath = new URL("./graph.json", import.meta.url);

let lib;
try {
  lib = await import(new URL("../../dist/index.js", import.meta.url).href);
} catch (err) {
  if (err?.code === "ERR_MODULE_NOT_FOUND") {
    console.error(
      "10-headless: dist/index.js not found — run `npm run build` first, then re-run this script.",
    );
    process.exitCode = 1;
  } else {
    throw err;
  }
}

if (lib !== undefined) {
  const { cook, deserializeGraph } = lib;
  const graph = deserializeGraph(JSON.parse(readFileSync(graphPath, "utf8")));

  const seedArg = process.argv[2];
  if (seedArg !== undefined) graph.setSeed(Number(seedArg));

  const meta = graph.meta ?? {};
  console.log(`${meta.title ?? "(untitled graph)"} — seed ${graph.seed}`);
  if (meta.description !== undefined) console.log(meta.description);
  console.log();

  const perNode = [];
  const { outputs, stats } = await cook(graph, { onNodeDone: (info) => perNode.push(info) });

  for (const info of perNode) {
    console.log(
      `  ${info.id.padEnd(10)} ${info.type.padEnd(22)} ${info.cached ? "cached" : "cooked"}  ${info.elapsedMs.toFixed(1)} ms`,
    );
  }
  console.log(
    `\n${stats.cooked} cooked, ${stats.cached} cached, ${stats.elapsedMs.toFixed(1)} ms total\n`,
  );

  for (const [name, collection] of Object.entries(outputs)) {
    for (const item of collection) {
      if (item.kind !== "geometry") continue;
      const geo = item.geo;
      const P = geo.attrs.point.require("P");
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < geo.pointCount; i++) {
        const x = P.get(i, 0);
        const z = P.get(i, 2);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      const attrs = [...geo.attrs.point].map((a) => a.name).join(", ");
      console.log(`output "${name}": ${geo.pointCount} points`);
      console.log(`  attributes: ${attrs}`);
      console.log(
        `  bounds: x ${minX.toFixed(2)}..${maxX.toFixed(2)}  z ${minZ.toFixed(2)}..${maxZ.toFixed(2)}`,
      );
    }
  }
}
