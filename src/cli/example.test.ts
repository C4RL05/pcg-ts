/**
 * The shipped headless example, driven through the CLI exactly as its
 * README tells a reader to. An example that is data can rot silently —
 * a renamed param, a tightened validator — so it is cooked here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXIT_OK, runCli } from "./index.js";
import type { CliIo } from "./io.js";

const GRAPH = fileURLToPath(new URL("../../examples/10-headless/graph.json", import.meta.url));

function realFileIo(): { io: CliIo; stdout(): string; files: Record<string, string> } {
  const out: string[] = [];
  const files: Record<string, string> = {};
  return {
    files,
    stdout: () => out.join(""),
    io: {
      out: (text) => void out.push(text),
      err: (text) => void out.push(text),
      readFile: (path) => readFileSync(path, "utf8"),
      writeFile: (path, data) => void (files[path] = data),
    },
  };
}

describe("examples/10-headless", () => {
  it("validates, carrying its meta block", async () => {
    const io = realFileIo();
    expect(await runCli(["validate", GRAPH, "--json"], io.io)).toBe(EXIT_OK);
    const report = JSON.parse(io.stdout());
    expect(report.ok).toBe(true);
    expect(report.meta.title).toBe("headless scatter");
    expect(report.meta.tags).toContain("headless");
    expect(report.nodes.map((n: { id: string }) => n.id)).toEqual([
      "scatter",
      "height",
      "ridge",
      "spread",
    ]);
  });

  it("cooks to a nonempty point cloud carrying the height attribute", async () => {
    const io = realFileIo();
    expect(await runCli(["cook", GRAPH, "--json"], io.io)).toBe(EXIT_OK);
    const report = JSON.parse(io.stdout());
    expect(report.stats.cooked).toBe(4);
    const geometry = report.outputs.points[0].geometry;
    expect(geometry.points).toBeGreaterThan(0);
    expect(geometry.points).toBeLessThan(4000);
    const point = geometry.domains.find((d: { domain: string }) => d.domain === "point");
    expect(point.attrs.map((a: { name: string }) => a.name)).toContain("height");
  });

  it("renders byte-identically across two runs at the same seed", async () => {
    const first = realFileIo();
    const second = realFileIo();
    expect(await runCli(["render", GRAPH, "--attr", "height", "--out", "/a.svg"], first.io)).toBe(
      EXIT_OK,
    );
    expect(await runCli(["render", GRAPH, "--attr", "height", "--out", "/b.svg"], second.io)).toBe(
      EXIT_OK,
    );
    expect(first.files["/a.svg"]).toBe(second.files["/b.svg"]);
    expect(first.files["/a.svg"].length).toBeGreaterThan(1000);
  });
});
