/**
 * Shared helpers for the runtime test suite: level factories built on the
 * standard node library, and byte-exact output comparison.
 */
import type { Domain, Geometry } from "../data/index.js";
import { Graph, type NodeHandle } from "../graph/index.js";
import { jitterPoints, type JitterPointsParams } from "../nodes/pointOps.js";
import { pointScatterInBounds, type PointScatterInBoundsParams } from "../nodes/sources.js";
import { hashCombine } from "../random/index.js";
import { dataInput, type DataInputParams } from "./dataInput.js";
import type { CellCoord, CellMode, CellOutputs, LevelDef } from "./types.js";

/** A scatter level plus handles for edit/invalidation tests. */
export interface ScatterLevel {
  readonly def: LevelDef;
  readonly graph: Graph;
  readonly scatter: NodeHandle<PointScatterInBoundsParams>;
  readonly jitter?: NodeHandle<JitterPointsParams>;
}

/**
 * A level whose graph scatters `count` points in the cell bounds (or a
 * fixed 100x100 area for an unbounded level), optionally jittered.
 * Declares one output, "points". Bind wires ctx bounds and ctx.seed into
 * the stochastic nodes — the documented determinism pattern.
 */
export function scatterLevel(opts: {
  name: string;
  cellSize: number | "unbounded";
  cellMode?: CellMode;
  generationRadius?: number;
  retainRadius?: number;
  count?: number;
  jitter?: boolean;
}): ScatterLevel {
  const graph = new Graph(1);
  const scatter = graph.add(pointScatterInBounds, { count: opts.count ?? 4 });
  let jitter: NodeHandle<JitterPointsParams> | undefined;
  if (opts.jitter === true) {
    jitter = graph.add(jitterPoints, { amount: [0.5, 0, 0.5] });
    graph.connect(scatter, "out", jitter, "in");
    graph.output(jitter, "out", "points");
  } else {
    graph.output(scatter, "out", "points");
  }
  const unbounded = opts.cellSize === "unbounded";
  const def: LevelDef = {
    name: opts.name,
    cellSize: opts.cellSize,
    cellMode: opts.cellMode,
    generationRadius: opts.generationRadius,
    retainRadius: opts.retainRadius,
    graph,
    bind(g, ctx) {
      if (unbounded) {
        g.setParam(scatter, "boundsMin", [0, 0, 0]);
        g.setParam(scatter, "boundsMax", [100, 0, 100]);
      } else if (ctx.cellMode === "xyz") {
        g.setParam(scatter, "boundsMin", [ctx.min[0], ctx.min[1], ctx.min[2]]);
        g.setParam(scatter, "boundsMax", [ctx.max[0], ctx.max[1], ctx.max[2]]);
      } else {
        g.setParam(scatter, "boundsMin", [ctx.min[0], 0, ctx.min[1]]);
        g.setParam(scatter, "boundsMax", [ctx.max[0], 0, ctx.max[1]]);
      }
      g.setParam(scatter, "seed", ctx.seed);
      if (jitter !== undefined) g.setParam(jitter, "seed", hashCombine(ctx.seed, 1));
    },
  };
  return { def, graph, scatter, jitter };
}

/** A child level echoing its parent's "points" output through dataInput. */
export interface EchoLevel {
  readonly def: LevelDef;
  readonly graph: Graph;
  readonly input: NodeHandle<DataInputParams>;
}

/**
 * A level whose graph re-emits the parent cell's "points" output via a
 * `dataInput` node, declared as output "parentEcho".
 */
export function childEchoLevel(opts: {
  name: string;
  cellSize: number;
  cellMode?: CellMode;
  generationRadius: number;
  retainRadius?: number;
}): EchoLevel {
  const graph = new Graph(2);
  const input = graph.add(dataInput);
  graph.output(input, "out", "parentEcho");
  const def: LevelDef = {
    name: opts.name,
    cellSize: opts.cellSize,
    cellMode: opts.cellMode,
    generationRadius: opts.generationRadius,
    retainRadius: opts.retainRadius,
    graph,
    bind(g, ctx) {
      g.setParam(input, "items", ctx.parent?.outputs["points"] ?? []);
    },
  };
  return { def, graph, input };
}

const DOMAINS: readonly Domain[] = ["point", "vertex", "primitive", "detail"];

/**
 * Byte-exact geometry comparison over every domain's full attribute
 * buffers. Returns null when equal, else a description of the first
 * difference.
 */
export function geometryDiff(a: Geometry, b: Geometry): string | null {
  for (const domain of DOMAINS) {
    const sa = a.attrs[domain];
    const sb = b.attrs[domain];
    if (sa.count !== sb.count) return `${domain} count ${sa.count} vs ${sb.count}`;
    const namesA = [...sa].map((attr) => attr.name).join(",");
    const namesB = [...sb].map((attr) => attr.name).join(",");
    if (namesA !== namesB) return `${domain} attrs [${namesA}] vs [${namesB}]`;
    for (const attr of sa) {
      const other = sb.require(attr.name);
      if (attr.type !== other.type || attr.tupleSize !== other.tupleSize) {
        return `${domain}.${attr.name} shape differs`;
      }
      const n = sa.count * attr.tupleSize;
      for (let i = 0; i < n; i++) {
        if (!Object.is(attr.data[i], other.data[i])) {
          return `${domain}.${attr.name}[${i}]: ${attr.data[i]} vs ${other.data[i]}`;
        }
      }
      if (attr.type === "string") {
        // Equal table indices do not imply equal strings — the two sides
        // may carry different string tables. Resolve every stored index
        // through its own table and compare the actual values too.
        for (let i = 0; i < n; i++) {
          const va = attr.stringTable[attr.data[i]] ?? "";
          const vb = other.stringTable[other.data[i]] ?? "";
          if (va !== vb) {
            return `${domain}.${attr.name}[${i}]: "${va}" vs "${vb}"`;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Byte-exact comparison of two cells' outputs (names, item order/kinds,
 * value payloads, full geometry buffers). Returns null when equal.
 */
export function outputsDiff(a: CellOutputs, b: CellOutputs): string | null {
  const namesA = Object.keys(a).sort();
  const namesB = Object.keys(b).sort();
  if (namesA.join(",") !== namesB.join(",")) {
    return `output names [${namesA.join(",")}] vs [${namesB.join(",")}]`;
  }
  for (const name of namesA) {
    const ia = a[name];
    const ib = b[name];
    if (ia.length !== ib.length) return `${name}: ${ia.length} items vs ${ib.length}`;
    for (let i = 0; i < ia.length; i++) {
      const x = ia[i];
      const y = ib[i];
      if (x.kind !== y.kind) return `${name}[${i}]: kind ${x.kind} vs ${y.kind}`;
      if (x.kind === "value" && y.kind === "value") {
        if (JSON.stringify(x.value) !== JSON.stringify(y.value)) {
          return `${name}[${i}]: value differs`;
        }
      } else if (x.kind === "geometry" && y.kind === "geometry") {
        const diff = geometryDiff(x.geo, y.geo);
        if (diff !== null) return `${name}[${i}]: ${diff}`;
      } else if (x.kind === "instances" && y.kind === "instances") {
        // CPU-only by design: device-resident batches hold GPU buffers
        // with no host bytes to diff, and reading `batches` would throw.
        // Report it as a difference the caller can act on instead.
        if (x.deviceBatches !== undefined || y.deviceBatches !== undefined) {
          if (x.deviceBatches === undefined || y.deviceBatches === undefined) {
            return `${name}[${i}]: one item is device-resident and the other is not`;
          }
          const shape = (b: readonly { assetId: string; count: number }[]): string =>
            b.map((v) => `${v.assetId}x${v.count}`).join(",");
          if (shape(x.deviceBatches) !== shape(y.deviceBatches)) {
            return `${name}[${i}]: device batches ${shape(x.deviceBatches)} vs ${shape(y.deviceBatches)}`;
          }
          // Shapes match; transform bytes live on the device and are not
          // comparable here (the device suites compare them directly).
          continue;
        }
        if (x.batches.length !== y.batches.length) {
          return `${name}[${i}]: ${x.batches.length} batches vs ${y.batches.length}`;
        }
        for (let bi = 0; bi < x.batches.length; bi++) {
          const ba = x.batches[bi];
          const bb = y.batches[bi];
          if (ba.assetId !== bb.assetId || ba.count !== bb.count) {
            return `${name}[${i}]: batch ${bi} asset/count differs`;
          }
          if (ba.transforms.length !== bb.transforms.length) {
            return `${name}[${i}]: batch ${bi} transform length differs`;
          }
          for (let t = 0; t < ba.transforms.length; t++) {
            if (!Object.is(ba.transforms[t], bb.transforms[t])) {
              return `${name}[${i}]: batch ${bi} transform[${t}] differs`;
            }
          }
        }
      }
    }
  }
  return null;
}

/** Coordinates as joined strings ("cx,cz" or "cx,cy,cz"), preserving list order. */
export function coordKeys(list: readonly { coord: CellCoord }[]): string[] {
  return list.map((c) => c.coord.join(","));
}
