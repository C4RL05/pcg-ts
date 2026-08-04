import type { Attribute } from "./attribute.js";
import type { Geometry } from "./geometry.js";
import type { AttrDefault, Domain } from "./types.js";

/** How multiple source contributions collapse onto one target element. */
export type PromoteMode = "first" | "average" | "sum" | "min" | "max";

/**
 * Iterate (source element, target element) contribution pairs implied by
 * the topology, in deterministic order (ascending vertex / primitive
 * scan). Point<->primitive goes through the vertices, so a point
 * contributes once per vertex reference.
 */
function forEachContribution(
  geo: Geometry,
  from: Domain,
  to: Domain,
  fn: (src: number, dst: number) => void,
): void {
  if (from === "detail") {
    const n = geo.attrs[to].count;
    for (let i = 0; i < n; i++) fn(0, i);
    return;
  }
  if (to === "detail") {
    const n = geo.attrs[from].count;
    for (let i = 0; i < n; i++) fn(i, 0);
    return;
  }
  const v2p = geo.vertexToPoint;
  const nv = geo.vertexCount;
  if (from === "point" && to === "vertex") {
    for (let v = 0; v < nv; v++) fn(v2p[v], v);
    return;
  }
  if (from === "vertex" && to === "point") {
    for (let v = 0; v < nv; v++) fn(v, v2p[v]);
    return;
  }
  const starts = geo.primVertexStart;
  const counts = geo.primVertexCount;
  const nPrim = geo.primitiveCount;
  for (let p = 0; p < nPrim; p++) {
    const start = starts[p];
    const end = start + counts[p];
    for (let v = start; v < end; v++) {
      if (from === "vertex" && to === "primitive") fn(v, p);
      else if (from === "primitive" && to === "vertex") fn(p, v);
      else if (from === "point" && to === "primitive") fn(v2p[v], p);
      else if (from === "primitive" && to === "point") fn(p, v2p[v]);
      else throw new Error(`promote: unsupported domain pair ${from} -> ${to}`);
    }
  }
}

/**
 * Promote an attribute between domains using the topology, creating or
 * overwriting the attribute on the target domain and returning it.
 *
 * Modes: `first` keeps the first contribution in deterministic scan
 * order (and is the only mode valid for string attributes);
 * `average`/`sum`/`min`/`max` accumulate in float64 and write back with
 * the attribute's typed-array conversion (integer types truncate). Any
 * NaN contribution yields NaN in every aggregate mode.
 * Target elements with no contributors keep the attribute default.
 * `detail` participates as broadcast (from) or reduce-all (to).
 * Promoting to the same domain returns the existing attribute unchanged.
 */
export function promote(
  geo: Geometry,
  attrName: string,
  from: Domain,
  to: Domain,
  mode: PromoteMode,
): Attribute {
  const src = geo.attrs[from].get(attrName);
  if (!src) {
    throw new Error(`promote: attribute "${attrName}" not found on ${from} domain`);
  }
  if (from === to) return src;
  if (src.type === "string" && mode !== "first") {
    throw new Error('promote: string attributes support only "first" mode');
  }
  const dstSet = geo.attrs[to];
  const dst = dstSet.replace(attrName, src.type, src.tupleSize, src.defaultValue as AttrDefault);
  const ts = src.tupleSize;
  const n = dstSet.count;
  const counts = new Uint32Array(n);

  if (src.type === "string") {
    forEachContribution(geo, from, to, (s, d) => {
      if (counts[d]++ !== 0) return;
      for (let k = 0; k < ts; k++) dst.setString(d, src.getString(s, k), k);
    });
    return dst;
  }

  const srcData = src.data;
  const dstData = dst.data;

  if (mode === "first") {
    forEachContribution(geo, from, to, (s, d) => {
      if (counts[d]++ !== 0) return;
      const so = s * ts;
      const dofs = d * ts;
      for (let k = 0; k < ts; k++) dstData[dofs + k] = srcData[so + k];
    });
    return dst;
  }

  const acc = new Float64Array(n * ts);
  if (mode === "min") acc.fill(Infinity);
  else if (mode === "max") acc.fill(-Infinity);

  forEachContribution(geo, from, to, (s, d) => {
    counts[d]++;
    const so = s * ts;
    const dofs = d * ts;
    for (let k = 0; k < ts; k++) {
      const v = srcData[so + k];
      // NaN contributions propagate in every aggregate mode (sum/average
      // do so arithmetically; min/max need it made explicit because NaN
      // comparisons are always false).
      if (mode === "min") {
        if (Number.isNaN(v)) acc[dofs + k] = NaN;
        else if (v < acc[dofs + k]) acc[dofs + k] = v;
      } else if (mode === "max") {
        if (Number.isNaN(v)) acc[dofs + k] = NaN;
        else if (v > acc[dofs + k]) acc[dofs + k] = v;
      } else {
        acc[dofs + k] += v;
      }
    }
  });

  const divide = mode === "average";
  for (let d = 0; d < n; d++) {
    const c = counts[d];
    if (c === 0) continue; // keeps the default
    const dofs = d * ts;
    for (let k = 0; k < ts; k++) {
      dstData[dofs + k] = divide ? acc[dofs + k] / c : acc[dofs + k];
    }
  }
  return dst;
}
