/**
 * Minimal utility nodes for exercising the graph runtime in tests. NOT
 * part of the public API (not exported from the package index) — Phase 4
 * builds the real node library.
 */
import { createPointCloud } from "../data/index.js";
import { evaluateField, resolveField, type FieldLike } from "../fields/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import { cloneGeometry } from "./clone.js";
import { makeGeometryItem, makeValueItem, type DataItem } from "./data.js";
import { defineNode, type NodeDef } from "./node.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Source: a point cloud of `count` points with P filled from the node
 * seed (deterministic, seed-dependent bytes).
 */
export function makePointsNode(count = 4): NodeDef<{ count: number }> {
  return defineNode<{ count: number }>({
    type: "points",
    inputs: [],
    outputs: [{ name: "out", kind: "geometry" }],
    defaultParams: { count },
    execute({ params, seed }) {
      const geo = createPointCloud(params.count);
      const P = geo.attrs.point.require("P");
      for (let i = 0; i < params.count; i++) {
        for (let k = 0; k < 3; k++) {
          P.data[i * 3 + k] = hashFloat(hashCombine(seed, i, k));
        }
      }
      return { out: [makeGeometryItem(geo)] };
    },
  });
}

/**
 * Adds `offset` (a number[] or Field, tuple 1 broadcast or tuple 3) to P
 * of every incoming geometry. Clones inputs per the purity contract;
 * value items pass through untouched.
 */
export function transformNode(): NodeDef<{ offset: FieldLike }> {
  return defineNode<{ offset: FieldLike }>({
    type: "transform",
    inputs: [{ name: "in", kind: "geometry" }],
    outputs: [{ name: "out", kind: "geometry" }],
    defaultParams: { offset: [0, 0, 0] },
    execute({ inputs, params, seed }) {
      const out: DataItem[] = [];
      const field = resolveField(params.offset);
      for (const item of inputs.in) {
        if (item.kind !== "geometry") {
          out.push(item);
          continue;
        }
        const geo = cloneGeometry(item.geo);
        const col = evaluateField(field, { geo, domain: "point", seed });
        if (col.tupleSize !== 1 && col.tupleSize !== 3) {
          throw new Error(`transform: offset tuple must be 1 or 3, got ${col.tupleSize}`);
        }
        const P = geo.attrs.point.require("P");
        const n = geo.pointCount;
        for (let i = 0; i < n; i++) {
          for (let k = 0; k < 3; k++) {
            P.data[i * 3 + k] += col.tupleSize === 1 ? col.data[i] : col.data[i * 3 + k];
          }
        }
        out.push(makeGeometryItem(geo, item.tags));
      }
      return { out };
    },
  });
}

/** Total point count of all incoming geometries, as a single value item. */
export function countNode(): NodeDef<Record<string, never>> {
  return defineNode<Record<string, never>>({
    type: "count",
    inputs: [{ name: "in", kind: "geometry", multi: true }],
    outputs: [{ name: "count", kind: "value" }],
    defaultParams: {},
    execute({ inputs }) {
      let total = 0;
      for (const item of inputs.in) {
        if (item.kind === "geometry") total += item.geo.pointCount;
      }
      return { count: [makeValueItem(total)] };
    },
  });
}

/**
 * Async pass-through that sleeps `delayMs` in short chunks, calling
 * `checkCancelled` between chunks — for cancellation and budget tests.
 */
export function slowNode(delayMs = 20): NodeDef<{ delayMs: number }> {
  return defineNode<{ delayMs: number }>({
    type: "slow",
    inputs: [{ name: "in", kind: "any" }],
    outputs: [{ name: "out", kind: "any" }],
    defaultParams: { delayMs },
    async execute({ inputs, params, checkCancelled }) {
      const chunks = Math.max(1, Math.ceil(params.delayMs / 5));
      const chunkMs = params.delayMs / chunks;
      for (let i = 0; i < chunks; i++) {
        checkCancelled();
        await sleep(chunkMs);
      }
      checkCancelled();
      return { out: inputs.in };
    },
  });
}

/**
 * Records execute invocations (for cache tests). Emits one value item:
 * `params.value` plus the sum of incoming numeric value items — so
 * upstream changes are observable downstream.
 */
export function counterNode(value = 0): {
  def: NodeDef<{ value: number }>;
  state: { count: number };
} {
  const state = { count: 0 };
  const def = defineNode<{ value: number }>({
    type: "counter",
    inputs: [{ name: "in", kind: "value", multi: true }],
    outputs: [{ name: "out", kind: "value" }],
    defaultParams: { value },
    execute({ inputs, params }) {
      state.count++;
      let sum = params.value;
      for (const item of inputs.in) {
        if (item.kind === "value" && typeof item.value === "number") sum += item.value;
      }
      return { out: [makeValueItem(sum)] };
    },
  });
  return { def, state };
}

/** Pass-through with a multi input: concatenates in connection order. */
export function mergeNode(): NodeDef<Record<string, never>> {
  return defineNode<Record<string, never>>({
    type: "merge",
    inputs: [{ name: "in", kind: "any", multi: true }],
    outputs: [{ name: "out", kind: "any" }],
    defaultParams: {},
    execute({ inputs }) {
      return { out: inputs.in };
    },
  });
}
