/**
 * Pins the public surface of `pcg-ts` — the root import.
 * See publicSurface.testsupport.ts for why this exists and how to respond
 * when it fails. The gpu and three entry points are pinned by their own
 * files, next to the code they cover.
 */
import { describe, expect, it } from "vitest";

import * as root from "./index.js";
import { surfaceDiff, surfaceOf } from "./publicSurface.testsupport.js";

const ROOT_SURFACE = [
  "ATTR_CTORS", "Attribute", "AttributeSet", "CookCancelledError", "DOMAINS",
  "FIELD_BRAND", "FieldJsonError", "GRAPH_META_KEYS", "Geometry", "Graph",
  "GraphCycleError", "GraphError", "GraphSerializationError", "GraphValidationError",
  "MAX_INSTANCES", "NOISE_RAW_RANGES", "NodeExecutionError", "PRIMTYPE_ATTR", "Pcg32",
  "STANDARD_POINT_ATTRS", "TRANSFER_AREA_EPS", "TRANSFER_BARY_EPS", "TRANSFER_BOX_PAD_REL",
  "TRANSFER_DET_EPS", "VERSION", "World", "WorldValidationError", "abs", "acos", "add",
  "applyGraphParamTargets", "applyParamPatches", "asin", "atan", "atan2", "attribute", "attributeIs", "attributeReduce",
  "attributeRemap", "buildInstanceBatches", "byAttribute", "capture", "captureAsync", "clamp",
  "cloneGeometry", "component", "composeTRS", "connectPoints", "constant", "cook",
  "copyToPoints", "cos", "createGpuCookStats", "createPointCloud", "createPolyline", "cross",
  "createTriangleMesh", "dataInput", "defineNode", "describeGraphAssets", "describeGraphParams",
  "describeSubgraphParams",
  "describeSubgraphPins", "deserializeGraph", "distance",
  "div", "dot", "elementCount", "eq",
  "evaluateField", "exp",
  "extrudePolygon", "fbm", "fieldFromJson", "fieldToJson", "filterByAttribute",
  "filterByBounds", "filterByDensity", "filterByExpression", "filterByTag",
  "filterPrimitivesByAttribute", "filterPrimitivesByBounds", "firstGeometry", "floor", "forEachNode", "fract",
  "fraction", "ge",
  "getFieldSpec",
  "getNodeType", "getRegisteredSubgraph", "graphParamBindings", "getSubgraphPlumbing", "getSubgraphSpec", "gt",
  "hasNodeType", "hasRegisteredSubgraph", "hashCombine", "hashFloat", "hashString",
  "index", "inlineParamMetaOf", "inlineParamSchema", "inlineParamValuesOf", "isDeviceInstanceBatch", "isDeviceResidentInstances", "isField", "jitterPoints",
  "keyNum", "keyRef", "le", "length", "lerp", "liveParamValueError", "listFieldFnInfos", "listFieldFns",
  "listNodeTypes", "listSubgraphs", "log",
  "lt", "makeDeviceInstancesItem", "makeField",
  "makeGeometryItem", "makeInstancesItem", "makeValueItem", "max", "mergePoints", "mergePrimitives",
  "meshPrimitive", "min", "mod",
  "mul", "ne", "nextRev", "nodeSeed", "noiseOutputRange", "normalize",
  "orientAlongVector", "paramNamesOf", "paramSchemaError", "paramValueError", "parseFieldText",
  "partitionByAttribute",
  "pathPointAt", "pathResample", "pathSegments", "perlinNoise", "pointGrid", "pointLine", "pointNeighborhood",
  "pointScatterInBounds", "pointScatterInWorld", "pointsToPath", "position", "pow",
  "primitiveTypeCounts", "printFieldSpec", "projectToPlane", "promote", "promoteAttribute", "ramp",
  "randomField", "registerSubgraph", "remap", "removeAttribute", "resolveExposedParam",
  "resolveField", "sampleNearestPoint", "select", "selfPrune", "serializeGraph",
  "setAttribute", "setBounds", "setPolylineTopology", "sign",
  "simplexNoise", "sin",
  "smoothstep",
  "spawnInstances", "specChildEntries", "splineSample", "sqrt", "standardNode", "step",
  "strandedGraphParamValues", "sub",
  "subgraphContentHash",
  "subgraphNode", "surfaceSample", "sweepProfile", "tan", "transferAttribute", "transferNearest",
  "transferRaycast", "transferUv", "transformPoints", "validateGraphMeta", "valueConstant",
  "valueNoise", "vec", "volumeSample", "withInlineParamValue", "worleyNoise", "writeCurveFrame",
  "writeTangents",
] as const;

describe("public surface: pcg-ts", () => {
  it("exports exactly the reviewed set", () => {
    const drift = surfaceDiff(surfaceOf(root), ROOT_SURFACE);
    expect(drift, drift).toBe("");
  });

  it("does not publish the internal anonymous-attribute marker", () => {
    // The concrete leak that motivated these tests. Its own case so a
    // regression names itself instead of hiding inside a 169-name diff.
    expect(Object.keys(root)).not.toContain("ANON_ATTR_PREFIX");
  });
});
