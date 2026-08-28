export * from "./errors.js";
// Named rather than `export *`: data.js also exports three things the
// package must not promise, and each fails a different way if a caller
// takes it up.
//
//   - `nextRev` mints the revision an item is stamped with. Every
//     constructor here calls it; calling it BY HAND is how a caller
//     stamps changed data with a rev the cache has already seen.
//   - `makeDeviceInstancesItem` takes device handles only the executor
//     can obtain, so a caller outside it has nothing valid to pass.
//   - `isDeviceInstanceBatch` narrows an `AnyInstanceBatch`, and it had
//     no caller anywhere. It is also the wrong tool twice over: a
//     consumer holding a BATCH narrows it on the `residency`
//     discriminant `InstanceBatch` documents, and a consumer holding an
//     `InstancesItem` wants `isDeviceResidentInstances` — which stays
//     exported.
//   - `type AnyInstanceBatch` WENT WITH IT, and the first pass left it
//     published "for now", which is the state worth naming rather than
//     repeating. It is the predicate's parameter type and nothing else,
//     so with the predicate gone no public signature produced or consumed
//     one: a reader met a type in the typings, went looking for how to
//     obtain it, and found nothing. A published name is a promise, and a
//     promise nobody can call in is worse than an absent one — it implies
//     a capability that is not there. `InstancesItem` keeps `batches` and
//     `deviceBatches` as separate fields rather than a union of the two,
//     so nothing public needs the union's NAME either.
//
//   - `makeInstanceBatch` joins them, and for the first reason: it is the
//     constructor that installs `colors` as an accessor over the reserved
//     channel, so calling it BY HAND is how a caller mints a batch whose
//     two spellings of colour disagree. A caller building a batch writes
//     the object literal the `InstanceBatch` type already documents;
//     `instanceAttributesOf` — which IS published — is what reads one
//     back, and is the half a host writing a renderer adapter needs.
//
// All four remain exported from ./data.js, which is what internal code
// and the tests import. See publicSurface.test.ts.
export {
  type DataCollection,
  type DataItem,
  type DataValue,
  filterByTag,
  firstGeometry,
  type GeometryItem,
  INSTANCE_COLOR_CHANNEL,
  type InstanceAttributes,
  instanceAttributesOf,
  type InstanceBatch,
  type InstancesItem,
  isDeviceResidentInstances,
  makeGeometryItem,
  makeInstancesItem,
  makeValueItem,
  type ValueItem,
} from "./data.js";
export * from "./node.js";
// `paramSchemaError` and `paramValueError` are deliberately absent: both
// are @internal message builders the library calls while VALIDATING a
// param, and a caller has no way to reach the validation they belong to.
// `liveParamValueError` — the editor-facing one — stays.
export {
  type GraphParam,
  graphParamBindings,
  liveParamValueError,
  type ParamSchema,
  type ParamType,
  type ParamValue,
} from "./params.js";
export {
  GRAPH_META_KEYS,
  Graph,
  validateGraphMeta,
  type DescribedConnection,
  type DescribedNode,
  type DescribedOutput,
  type GraphDescription,
  type GraphMeta,
  type NodeHandle,
} from "./graph.js";
export {
  cook,
  type CookOptions,
  type CookResult,
  type CookStats,
  type NodeDoneInfo,
} from "./execute.js";
export { cloneGeometry } from "./clone.js";
export {
  describeSubgraphParams,
  describeSubgraphPins,
  // `getSubgraphPlumbing` is deliberately absent: it is @internal, and
  // what it returns is the injected portal ids serialization goes out of
  // its way to hide. `describeSubgraphPins`/`describeSubgraphParams` are
  // the same wrapper described in the terms a caller can act on.
  //
  // `type SubgraphPlumbing` IS ABSENT FOR THE SECOND REASON RATHER THAN
  // THE FIRST. It is that function's return type and nothing else's, so
  // once the function went there was no public way to obtain a value of
  // it — a name in the typings describing a shape no exported signature
  // hands back. Both stay exported from ./subgraph.js, where the two
  // internal callers and `mutation.test.ts` reach them by relative path.
  getSubgraphSpec,
  // Public because materializing a REGISTERED recipe is a public act:
  // `registerSubgraph` and `getRegisteredSubgraph` both ship, the recipe
  // deliberately does not record which wrapper cooks it, and so anything
  // that builds a node around one has to answer the same question the CLI
  // and the catalog answer. Left internal, a third party writing that node
  // would reach for the same `"subgraph"` literal those two used to.
  inferWrapperKind,
  subgraphNode,
  type DescribedSubgraphParam,
  type DescribedSubgraphPin,
  type ExposedParam,
  type ExposedParamTarget,
  type ExposedPin,
  type ExposedPinNames,
  type SubgraphPins,
  type SubgraphSpec,
  type WrapperKind,
} from "./subgraph.js";
// testNodes.js is intentionally not exported: test-only utilities.
