/**
 * @internal The def → param-schema link, in a module of its own.
 *
 * `Graph.add` and `Graph.setParam` check a plain param value against the
 * schema that declares it, and a {@link NodeDef} carries no schemas: the
 * node REGISTRY authors them one layer up (`src/nodes`), which the graph
 * layer cannot import without a cycle. `standardNode` writes here and
 * `graph.ts` reads, the same arrangement — and for the same reason — as
 * subgraphLink.ts. This module imports nothing at runtime, so both sides
 * may depend on it.
 *
 * A def absent from the map declares no schemas and is not checked. That
 * is not a hole: a hand-rolled `defineNode` has nothing to check against,
 * so its params behave exactly as they did before the check existed. A
 * subgraph def is absent too, on purpose — its schemas come from its
 * exposed params, which `subgraphLink.ts` already records, and one copy
 * of a fact cannot disagree with itself.
 */
import type { ParamSchema } from "./params.js";

/** @internal Param schemas of every def built by `standardNode`, by param name. */
export const defParamSchemas = new WeakMap<object, Record<string, ParamSchema>>();
