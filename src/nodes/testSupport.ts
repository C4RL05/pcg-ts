/**
 * Test-only helpers for the node library suites. Not part of the public
 * API (not exported from the package index).
 */
import { DOMAINS, type Geometry } from "../data/index.js";
import type { DataCollection, NodeDef } from "../graph/index.js";

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
