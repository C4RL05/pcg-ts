/**
 * Pins the TYPE surface of `pcg-ts` — the root import's interfaces and
 * type aliases, which `publicSurface.test.ts` cannot see.
 *
 * WHY IT IS A SEPARATE FILE. Reading types means building a TypeScript
 * program, which costs seconds where `Object.keys` costs nothing. The
 * value tests are the common case and run on every change; this one
 * should not slow them down. See {@link entryPointSurface} for why the
 * checker is read rather than the emitted `.d.ts`.
 *
 * WHAT WENT WRONG WITHOUT IT. `isDeviceInstanceBatch` and
 * `getSubgraphPlumbing` were withdrawn from the root as internals that
 * had escaped through an `export *`. `AnyInstanceBatch` and
 * `SubgraphPlumbing` were the parameter and return type of exactly those
 * two, so they were left behind published with nothing public able to
 * produce or consume either — a name in the typings describing a
 * capability that was not there. Every value assertion still passed. They
 * were caught by a person reading the barrels, which is not a mechanism.
 *
 * A TYPE IS NOT A LESSER EXPORT, which is the assumption that let this
 * sit. Removing one breaks a consumer's build exactly as removing a
 * function does; publishing one commits to it just as hard. What differs
 * is only that nothing at runtime can observe it, and the tooling had
 * quietly inherited that as "it does not matter".
 */
import { describe, expect, it } from "vitest";
import path from "node:path";

import * as root from "./index.js";
import { surfaceDiff, surfaceOf } from "./publicSurface.testsupport.js";
import { entryPointSurface } from "./publicTypeSurface.testsupport.js";

/**
 * Every interface and type alias the root import publishes.
 *
 * Sorted, and generated FROM the checker rather than typed by hand —
 * re-generate with the same call the test makes rather than editing an
 * entry in place, so the list cannot drift into a shape the checker never
 * produces.
 *
 * Adding a name here is the same decision as adding one to ROOT_SURFACE:
 * say why in the barrel that exports it, not only here.
 */
const ROOT_TYPE_SURFACE = [
  "ArcTileParams", "AssetIdOrigin", "AttrData", "AttrDefault", "AttrType", "AttrTypeMap",
  "Attribute", "AttributeReduceParams", "AttributeRemapParams", "AttributeSet", "BindPatches",
  "BuildInstanceBatchesOptions", "CellContext", "CellContextBase", "CellContextPath",
  "CellContextXYZ", "CellContextXZ", "CellCookRequest", "CellCoord", "CellCoord1", "CellCoord2",
  "CellCoord3", "CellId", "CellMode", "CellOutputs", "CellSnapshot", "Column", "ColumnData",
  "ConnectPointsParams", "CookBackend", "CookCancelledError", "CookOptions", "CookResult",
  "CookStats", "CopyToPointsParams", "DataCollection", "DataInputParams", "DataItem",
  "DataValue", "DescribedConnection", "DescribedDrivenParam", "DescribedGraphParam",
  "DescribedGraphScopedParam", "DescribedNode", "DescribedNodeParam", "DescribedOutput",
  "DescribedParamBase", "DescribedSpawner", "DescribedSubgraphParam", "DescribedSubgraphPin",
  "DeviceInstanceBatch", "DeviceTransformsHandle", "Domain", "EvalContext", "ExposedParam",
  "ExposedParamDecl", "ExposedParamTarget", "ExposedParamTargetDecl", "ExposedPin",
  "ExposedPinNames", "ExtrudePolygonParams", "FbmOpts", "Field", "FieldBindingValue",
  "FieldBindings", "FieldFnInfo", "FieldJsonError", "FieldLike", "FieldSpec", "FieldSpecArg",
  "FilterByAttributeParams", "FilterByBoundsParams", "FilterByDensityParams",
  "FilterByExpressionParams", "FilterPrimitivesByAttributeParams",
  "FilterPrimitivesByBoundsParams", "Geometry", "GeometryItem", "GpuCookStats",
  "GpuFieldResolver", "Graph", "GraphCycleError", "GraphDescription", "GraphError", "GraphMeta",
  "GraphParam", "GraphSerializationError", "GraphValidationError", "InlineParamMeta",
  "InstanceBatch", "InstancesItem", "JitterPointsParams", "LevelDef", "MergePointsParams",
  "MergePrimitivesParams", "MeshPrimitiveParams", "NodeDef", "NodeDoneInfo", "NodeExecuteArgs",
  "NodeExecutionError", "NodeHandle", "NodeOutputs", "NodeSeedRef", "NodeSpec", "NodeTypeInfo",
  "NoiseFactory", "NoiseOpts", "NoiseRange", "NonFiniteReport", "OcclusionCullParams",
  "OpenAssetSet", "OrientAlongVectorParams", "ParamPatch", "ParamSchema", "ParamType",
  "ParamValue", "ParentCellRef", "PartitionByAttributeParams", "PathCoverageParams",
  "PathPointAtParams", "PathResampleParams", "PathRunsParams", "PathScanParams",
  "PathSegmentsParams", "PathShiftParams", "Pcg32", "PinDef", "PinInfo", "PinKind",
  "PointGridParams", "PointLineParams", "PointNeighborhoodParams", "PointScatterInBoundsParams",
  "PointScatterInWorldParams", "PointScatterOnPathParams", "PointsToPathParams", "PrimType",
  "ProjectToPlaneParams", "PromoteAttributeParams", "PromoteMode", "QuotaRebalanceParams",
  "RegisteredNodeType", "RegisteredSubgraph", "RegistrationNodeRef", "RegistrationParam",
  "RegistrationPin", "RemoveAttributeParams", "ResidentAttrDesc", "ResidentDesc",
  "ResidentMemberDesc", "ResidentRunContext", "ResidentRunInput", "ResidentRunResult",
  "RunFitParams", "SampleNearestPointParams", "SelfPruneParams", "SerializedConnection",
  "SerializedExposedParam", "SerializedExposedPin", "SerializedGraph", "SerializedGraphParam",
  "SerializedNode", "SerializedOutput", "SerializedSubgraph", "SerializedSubgraphRef",
  "SetAttributeParams", "SetBoundsParams", "SpawnInstancesParams", "SpecChild",
  "SplineSampleParams", "StandardPointAttr", "StrandedGraphParamValue", "SubgraphPins",
  "SubgraphRegistrationSpec", "SubgraphSpec", "SurfaceSampleParams", "SweepProfileParams",
  "TransferAlongPathParams", "TransferAttrDomain", "TransferAttributeParams",
  "TransferByIndexParams", "TransferMappingResult", "TransferNearestOptions",
  "TransferRaycastOptions", "TransferUvOptions", "TransformPointsParams", "UpdateOptions",
  "UpdateStats", "ValueConstantParams", "ValueItem", "VolumeSampleParams", "World",
  "WorldOptions", "WorldStats", "WorldValidationError", "WorleyNoiseOpts", "WrapperKind",
  "WriteCurveFrameParams", "WriteTangentsParams",
] as const;

/**
 * The root exports that are a type AND a value: every one a `class`.
 *
 * Kept beside the type list because it is a SUBSET of it, not a third
 * surface -- each of these already appears in ROOT_TYPE_SURFACE and in
 * the value pin.
 */
const DUAL_SURFACE = [
  "Attribute", "AttributeSet", "CookCancelledError", "FieldJsonError", "Geometry", "Graph",
  "GraphCycleError", "GraphError", "GraphSerializationError", "GraphValidationError",
  "NodeExecutionError", "Pcg32", "World", "WorldValidationError",
] as const;

/** Building a program is seconds, not milliseconds. */
const PROGRAM_MS = 120_000;

describe("public type surface", () => {
  it(
    "publishes exactly the types this list names",
    () => {
      const surface = entryPointSurface(
        path.join(process.cwd(), "src/index.ts"),
        path.join(process.cwd(), "tsconfig.json"),
      );
      const diff = surfaceDiff([...surface.types], ROOT_TYPE_SURFACE);
      expect(diff, diff).toBe("");
    },
    PROGRAM_MS,
  );

  /**
   * THE CROSS-CHECK, and the reason this file pins one list rather than
   * two. The checker and `Object.keys` are two independent readings of
   * the same entry point, so if they disagree about the VALUES then one
   * of them is wrong about the types too and neither pin can be trusted.
   * Asserting the equivalence live — rather than pinning a second copy of
   * the value list here — means there is still exactly ONE list of value
   * names in the repo, and this test proves the mechanism that reads the
   * types agrees with the mechanism that has been guarding the values all
   * along.
   */
  it(
    "agrees with Object.keys about which names are values",
    () => {
      const surface = entryPointSurface(
        path.join(process.cwd(), "src/index.ts"),
        path.join(process.cwd(), "tsconfig.json"),
      );
      expect(
        [...surface.values],
        "the checker and the module object disagree about the value surface, so one of them " +
          "is also wrong about the types and neither pin means anything until it is resolved",
      ).toEqual(surfaceOf(root));
    },
    PROGRAM_MS,
  );

  /**
   * WHICH NAMES ARE A TYPE AND A VALUE AT ONCE, pinned as a set rather
   * than asserted away.
   *
   * A `class` declares both under one identifier -- `Graph` is `new
   * Graph()` and `let g: Graph` -- and so does an `enum`. This test used
   * to assert that NO name was ever both, and it passed, and it was
   * wrong: `TYPE_FLAGS` had omitted `Class`, so all fourteen of these
   * were classified value-only and the assertion was true of the
   * classification rather than of the library. A test that passes because
   * the thing it measures is broken is worse than no test, and it is the
   * exact failure this file exists to catch.
   *
   * As a positive pin it earns its place: a new class on the root surface
   * shows up here, and a class demoted to an interface -- which removes
   * `new X()` from the API while leaving `X` a valid type -- shows up as a
   * REMOVED here while both name lists stay identical.
   */
  it(
    "names exactly the exports that are both a type and a value",
    () => {
      const surface = entryPointSurface(
        path.join(process.cwd(), "src/index.ts"),
        path.join(process.cwd(), "tsconfig.json"),
      );
      const both = surface.types.filter((n) => surface.values.includes(n));
      const diff = surfaceDiff(both, DUAL_SURFACE);
      expect(diff, diff).toBe("");
    },
    PROGRAM_MS,
  );
});
