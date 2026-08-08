/**
 * The FIFTH seam: forwarding a resolver's `acceptDerivedSpecs`
 * advertisement across a WRAPPER.
 *
 * `deviceSpec(field, flag)` makes the four READING seams type-safe — the
 * flag has no default, so a seam that forgets it does not compile. The
 * forwarding seam cannot be typed that way: `acceptDerivedSpecs` has to
 * stay optional on `GpuFieldResolver` (resolvers written before v0.9 omit
 * it), so a wrapper that drops it typechecks cleanly. The executor then
 * believes the base accepts only authored specs, salts memo keys for that
 * narrower population, and the base resolves the wider one anyway — GPU
 * bytes written under a CPU memo key and served to the next CPU-only
 * cook. That is the exact stale-cache bug phase 33 exists to prevent,
 * reached through the one seam a required argument cannot cover.
 *
 * `resolverView` closes it two ways: it copies the advertisement itself,
 * and it types the view argument's `acceptDerivedSpecs` as `never` so
 * writing one by hand is a compile error. This file pins the copy, pins
 * the end-to-end consequence of losing it, and pins that every wrapper in
 * `src/` is built through the helper rather than by hand.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateField,
  randomField,
  type Column,
  type GpuFieldResolver,
} from "../fields/index.js";
import { acceptsDerivedSpecs, deviceSpec, resolverView } from "../fields/spec.js";
import { Graph, cook, makeGeometryItem, type CookResult } from "../graph/index.js";
import { setAttribute } from "../nodes/index.js";
import { dataInput } from "../runtime/index.js";
import { makeCorpusGeometry } from "./testGeometry.js";

// ---------------------------------------------------------------------------
// 1. The helper copies the advertisement and nothing else

const noopResolve: GpuFieldResolver["resolveField"] = () => null;

describe("resolverView carries the acceptDerivedSpecs advertisement", () => {
  for (const flag of [true, false] as const) {
    it(`copies acceptDerivedSpecs=${flag} from the base`, () => {
      const view = resolverView(
        { acceptDerivedSpecs: flag },
        { cacheSalt: "wrapped", resolveField: noopResolve },
      );
      expect(view.acceptDerivedSpecs).toBe(flag);
      // ...and through the ONE reading of "absent means false", which is
      // what the executor and the evaluator both use.
      expect(acceptsDerivedSpecs(view)).toBe(flag);
    });
  }

  it("invents nothing when the base advertises nothing", () => {
    const view = resolverView({}, { cacheSalt: "wrapped", resolveField: noopResolve });
    expect("acceptDerivedSpecs" in view).toBe(false);
    expect(acceptsDerivedSpecs(view)).toBe(false);
  });

  it("keeps the view's own salt and run methods, and adds no others", () => {
    const planRun = (): null => null;
    const executeRun = (): never => {
      throw new Error("never");
    };
    const base: GpuFieldResolver = {
      cacheSalt: "base",
      acceptDerivedSpecs: true,
      residentTerminals: ["instances"],
      resolveField: noopResolve,
    };
    const view = resolverView(base, {
      cacheSalt: "base|wrapped",
      resolveField: noopResolve,
      planRun,
      executeRun,
    });
    expect(view.cacheSalt).toBe("base|wrapped");
    expect(view.planRun).toBe(planRun);
    expect(view.executeRun).toBe(executeRun);
    // `residentTerminals` is the view's business, not the helper's: a
    // wrapper that cannot fuse must be able to say so.
    expect(view.residentTerminals).toBeUndefined();
    expect(Object.keys(view).sort()).toEqual([
      "acceptDerivedSpecs",
      "cacheSalt",
      "executeRun",
      "planRun",
      "resolveField",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. What losing the advertisement costs, end to end

/** Every resolved column is this value, so GPU bytes are recognizable. */
const SENTINEL = 12345;

interface Probe extends GpuFieldResolver {
  resolved: number;
}

/**
 * A base resolver that gates on its OWN captured flag (exactly as
 * `GpuFieldEvaluator` does) and returns recognizable bytes, so a CPU cook
 * that is wrongly served device bytes is visible in the output.
 */
function sentinelProbe(acceptDerivedSpecs: boolean): Probe {
  const probe: Probe = {
    resolved: 0,
    cacheSalt: "probe|deviceA",
    acceptDerivedSpecs,
    resolveField(field, ctx) {
      if (deviceSpec(field, acceptDerivedSpecs) === undefined) return null;
      probe.resolved++;
      const column = evaluateField(field, ctx);
      const data = column.data.slice() as Column["data"];
      data.fill(SENTINEL);
      return Promise.resolve({ data, tupleSize: column.tupleSize });
    },
  };
  return probe;
}

/** din → setAttribute("d", <code-authored field>): a derived-spec adopter. */
function derivedGraph(): { g: Graph; id: string } {
  const g = new Graph(7);
  const din = g.add(dataInput);
  g.setParam(din, "items", [makeGeometryItem(makeCorpusGeometry(16))]);
  const n = g.add(setAttribute, { name: "d", value: randomField("authored") as never });
  g.connect(din, "out", n, "in");
  g.output(n, "out", "out");
  return { g, id: n.id };
}

function attrValues(result: CookResult): number[] {
  const item = result.outputs.out[0];
  if (item.kind !== "geometry") throw new Error("expected a geometry item");
  const attr = item.geo.attrs.point.require("d");
  return [...attr.data.subarray(0, item.geo.attrs.point.count * attr.tupleSize)];
}

describe("a wrapper that forwards the advertisement keeps device bytes out of a CPU cook", () => {
  it("salts the memo key for the population the base actually resolves", async () => {
    const base = sentinelProbe(true);
    // The shape that dropped the flag before this fix: same delegation,
    // built through the helper instead of by hand.
    const wrapper = resolverView(base, {
      cacheSalt: `${base.cacheSalt}|wrapped`,
      resolveField: (field, ctx, stats) => base.resolveField(field, ctx, stats),
    });
    expect(wrapper.acceptDerivedSpecs).toBe(true);

    const { g, id } = derivedGraph();
    const gpuResult = await cook(g, { gpu: wrapper });
    expect(base.resolved, "the base took the derived field onto the device").toBe(1);
    expect(attrValues(gpuResult).every((v) => v === SENTINEL)).toBe(true);

    // The key must record BOTH that a device produced these bytes and
    // that it was the wide gate: dropping the advertisement leaves
    // `paramsHaveSpecField` blind to a derived-spec field and the mark
    // disappears entirely.
    const gpuKey = g.require(id).cache!.key;
    expect(gpuKey).toContain("|gpu:");
    expect(gpuKey.slice(gpuKey.indexOf("|gpu:"))).toBe("|gpu:probe|deviceA|wrapped+derived");

    // ...so a later CPU-only cook recooks rather than being served them.
    const cpuResult = await cook(g);
    expect(cpuResult.stats.cooked, "CPU cook must not be served the device bytes").toBe(1);
    expect(g.require(id).cache!.key).not.toContain("|gpu:");
    expect(attrValues(cpuResult).some((v) => v !== SENTINEL)).toBe(true);
  });

  it("and a narrow base still salts nothing for a derived field", async () => {
    const base = sentinelProbe(false);
    const wrapper = resolverView(base, {
      cacheSalt: base.cacheSalt,
      resolveField: (field, ctx, stats) => base.resolveField(field, ctx, stats),
    });
    expect(wrapper.acceptDerivedSpecs).toBe(false);
    const { g, id } = derivedGraph();
    await cook(g, { gpu: wrapper });
    expect(base.resolved).toBe(0);
    expect(g.require(id).cache!.key).not.toContain("|gpu:");
  });
});

// ---------------------------------------------------------------------------
// 3. Every wrapper in src/ is built through the helper
//
// Same shape as the layering guards in `noGpuInCore.test.ts`: a source
// scan with its own detector tests, so the pin cannot pass by matching
// nothing.

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));

/**
 * An object-literal `cacheSalt:` entry — i.e. a resolver being
 * constructed. Deliberately not matched: `readonly cacheSalt: string;`
 * (an interface/class field declaration, which ends in `;`) and
 * `this.cacheSalt = ...` (a class assignment). `GpuFieldEvaluator` is the
 * one resolver in `src/` that is a class rather than a literal, and it is
 * a BASE — it decides the flag, it does not forward one.
 */
const RESOLVER_LITERAL_RE = /^[ \t]*cacheSalt:[^\n]*,[ \t]*$/gm;
/** A CALL of the helper (its own declaration in spec.ts is not one). */
const RESOLVER_VIEW_CALL_RE = /(?<!function )\bresolverView\(/g;

function countIn(source: string, re: RegExp): number {
  return [...source.matchAll(re)].length;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(path);
    }
  }
}

describe("every resolver wrapper in src/ is built through resolverView", () => {
  it("the detector sees a resolver literal and ignores declarations", () => {
    expect(countIn("  cacheSalt: base.cacheSalt,\n", RESOLVER_LITERAL_RE)).toBe(1);
    expect(countIn("    cacheSalt: `${ev.cacheSalt}|per-node`,\n", RESOLVER_LITERAL_RE)).toBe(1);
    expect(countIn("  readonly cacheSalt: string;\n", RESOLVER_LITERAL_RE)).toBe(0);
    expect(countIn("    this.cacheSalt = saltFrom(info);\n", RESOLVER_LITERAL_RE)).toBe(0);
    expect(countIn("   * `cacheSalt` identifies the device/backend.\n", RESOLVER_LITERAL_RE)).toBe(0);
  });

  it("the detector counts calls, not the declaration", () => {
    expect(countIn("export function resolverView(\n", RESOLVER_VIEW_CALL_RE)).toBe(0);
    expect(countIn("  return resolverView(base, view);\n", RESOLVER_VIEW_CALL_RE)).toBe(1);
    expect(countIn("{@link resolverView} and resolverView.test.ts\n", RESOLVER_VIEW_CALL_RE)).toBe(0);
  });

  it("each non-test source file builds as many resolvers as it views", () => {
    const files: string[] = [];
    walk(SRC_DIR, files);
    expect(files.length).toBeGreaterThan(10); // sanity: the walk found src/

    let totalLiterals = 0;
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const literals = countIn(source, RESOLVER_LITERAL_RE);
      const views = countIn(source, RESOLVER_VIEW_CALL_RE);
      totalLiterals += literals;
      if (literals !== views) offenders.push(`${file}: ${literals} resolver(s), ${views} view(s)`);
    }
    // Sanity: the scan is looking at real wrappers, so a future rename
    // that makes the detector match nothing fails here rather than
    // passing vacuously.
    expect(totalLiterals, "resolver literals found in non-test src/").toBe(3);
    expect(
      offenders,
      "a resolver literal not built by resolverView: forward the base's acceptDerivedSpecs advertisement through the helper (src/fields/spec.ts)",
    ).toEqual([]);
  });
});
