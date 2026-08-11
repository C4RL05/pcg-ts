/**
 * Test-only helpers for the node library suites. Not part of the public
 * API (not exported from the package index).
 */
import { DOMAINS, type Geometry } from "../data/index.js";
import type { DataCollection, NodeDef } from "../graph/index.js";
import { gatherPoints } from "./util.js";

/** Run a node def directly with merged defaults and stubbed cook plumbing. */
export async function runNode<P>(
  def: NodeDef<P>,
  params: Partial<P> = {},
  inputs: Record<string, DataCollection> = {},
  seed = 1,
): Promise<Record<string, DataCollection>> {
  const allInputs: Record<string, DataCollection> = {};
  for (const pin of def.inputs) allInputs[pin.name] = inputs[pin.name] ?? [];
  return await def.execute({
    inputs: allInputs,
    params: { ...def.defaultParams, ...params } as P,
    seed,
    checkCancelled() {
      /* never cancelled in direct runs */
    },
  });
}

/** First geometry item of a collection (throws when absent). */
export function firstGeo(collection: DataCollection | undefined): Geometry {
  for (const item of collection ?? []) {
    if (item.kind === "geometry") return item.geo;
  }
  throw new Error("expected a geometry item");
}

/**
 * Exact snapshot of a geometry's stored data (every domain, every
 * attribute, element-exact typed-array contents plus resolved strings).
 * Two byte-identical geometries produce deep-equal snapshots.
 */
export function snapshotGeometry(geo: Geometry): Record<string, unknown> {
  const domains: Record<string, unknown> = {};
  for (const domain of DOMAINS) {
    const set = geo.attrs[domain];
    domains[domain] = {
      count: set.count,
      attrs: set.names().map((name) => {
        const attr = set.require(name);
        const n = set.count * attr.tupleSize;
        return {
          name,
          type: attr.type,
          tupleSize: attr.tupleSize,
          data: Array.from(attr.data.subarray(0, n)),
          strings:
            attr.type === "string"
              ? Array.from({ length: n }, (_, i) =>
                  attr.getString(Math.floor(i / attr.tupleSize), i % attr.tupleSize),
                )
              : null,
        };
      }),
    };
  }
  domains.topology = {
    vertexToPoint: Array.from(geo.vertexToPoint),
    primVertexStart: Array.from(geo.primVertexStart),
    primVertexCount: Array.from(geo.primVertexCount),
  };
  return domains;
}

/** Positions of a point cloud as [x, y, z] triples. */
export function positionsOf(geo: Geometry): number[][] {
  const P = geo.attrs.point.require("P");
  const out: number[][] = [];
  for (let i = 0; i < geo.pointCount; i++) {
    out.push([P.get(i, 0), P.get(i, 1), P.get(i, 2)]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Permutation equivariance
//
// A node keyed on point IDENTITY must not care what order its points
// arrive in: reordering the input reorders the output and changes nothing
// else. These three helpers are what the permutation suites are written
// against — a shuffle, the permuted cloud, and a per-point record that
// makes "the same points came back" a multiset comparison rather than a
// count comparison.

/**
 * A deterministic shuffle of `0..n-1` (Fisher-Yates driven by an LCG —
 * there is no `Math.random` anywhere in this library, tests included).
 */
export function shuffledOrder(n: number, seed = 1): Uint32Array {
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  let state = (seed >>> 0) || 1;
  for (let i = n - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  return order;
}

/** `geo`'s points gathered in `order` — the same cloud, reordered. */
export function permutePoints(geo: Geometry, order: ArrayLike<number>): Geometry {
  return gatherPoints(geo, order);
}

/**
 * One string per point holding every point attribute's value, so two
 * clouds hold the same points exactly when these arrays are equal as
 * multisets (sort both before comparing). Topology is not included:
 * every node these suites cover emits a point cloud.
 */
export function pointRecords(geo: Geometry): string[] {
  const set = geo.attrs.point;
  const names = set.names().sort();
  const out: string[] = [];
  for (let i = 0; i < set.count; i++) {
    const parts: string[] = [];
    for (const name of names) {
      const attr = set.require(name);
      const vals: (number | string)[] = [];
      for (let k = 0; k < attr.tupleSize; k++) {
        vals.push(attr.type === "string" ? attr.getString(i, k) : attr.get(i, k));
      }
      parts.push(`${name}=${vals.join(",")}`);
    }
    out.push(parts.join("|"));
  }
  return out;
}
