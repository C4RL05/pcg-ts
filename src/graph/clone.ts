// NOTE: this helper lives in src/graph for now to keep module ownership
// clean during parallel development; it may move to src/data later.
import { DOMAINS, Geometry, type Domain } from "../data/index.js";

function copyDomain(src: Geometry, dst: Geometry, domain: Domain): void {
  const from = src.attrs[domain];
  const to = dst.attrs[domain];
  for (const attr of from) {
    to.add(attr.name, attr.type, attr.tupleSize, attr.defaultValue);
  }
  to.resize(from.count);
  for (const attr of from) {
    to.require(attr.name).copyFrom(attr, 0, 0, from.count);
  }
}

/**
 * Deep-copy a geometry: every attribute of every domain (including string
 * tables and defaults) plus the topology arrays. Nodes use this to honor
 * the purity contract — transform a clone, never a cached input.
 */
export function cloneGeometry(src: Geometry): Geometry {
  const dst = new Geometry();
  // Points first so topology validation sees the right point count;
  // setTopology copies the arrays defensively and sizes the vertex and
  // primitive domains.
  copyDomain(src, dst, "point");
  dst.setTopology(src.vertexToPoint, src.primVertexStart, src.primVertexCount);
  for (const domain of DOMAINS) {
    if (domain !== "point") copyDomain(src, dst, domain);
  }
  return dst;
}
