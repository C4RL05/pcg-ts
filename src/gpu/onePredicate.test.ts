/**
 * "One predicate, not three" (CPU-only, runs everywhere).
 *
 * Four seams decide whether a Field may reach the device: the memo-key
 * salt and the fusion gate in `src/graph/execute.ts`, the per-field
 * resolution in `evaluator.ts`, and the resident-run planner in `run.ts`.
 * Since phase 33 all four ask `deviceSpec(field, acceptDerivedSpecs)`,
 * with the flag read once per cook from the resolver's advertisement.
 *
 * If any two of them ever disagree, a node resolves on the device without
 * its memo key gaining the `|gpu:` salt — and a later CPU cook is served
 * GPU bytes. That is a stale-cache bug that survives across runs and is
 * invisible to a test that only checks one seam, so this file checks the
 * seams AGAINST EACH OTHER, for every node type that can reach them, on
 * both settings of the flag.
 *
 * Both drift pins here are bidirectional set equalities against the
 * registry: a new adopting or resident node type fails this file until it
 * is covered, rather than silently escaping the property.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// The registry is populated by module side effects, and the drift pins
// below are only as complete as the modules this file has loaded. Pull in
// the whole public barrel so "every registered node type" means every node
// type the library ships (spawnInstances lives outside `src/nodes`).
import "../index.js";
import { createPolyline, createTriangleMesh } from "../data/index.js";
import {
  evaluateField,
  randomField,
  type FieldLike,
  type GpuCookStats,
  type GpuFieldResolver,
  type ResidentMemberDesc,
  type ResidentRunContext,
} from "../fields/index.js";
import { acceptsDerivedSpecs, deviceSpec } from "../fields/spec.js";
import {
  Graph,
  cook,
  defineNode,
  makeGeometryItem,
  subgraphNode,
  type NodeDef,
} from "../graph/index.js";
import {
  extrudePolygon,
  getNodeType,
  jitterPoints,
  listNodeTypes,
  orientAlongVector,
  pathPointAt,
  pathSegments,
  setAttribute,
  surfaceSample,
  sweepProfile,
  transformPoints,
  volumeSample,
} from "../nodes/index.js";
import { forEachNode } from "../nodes/forEach.js";
import { resolveOnMaybeGpu } from "../nodes/util.js";
import { fieldFromJson } from "../fields/fieldJson.js";
import { dataInput } from "../runtime/index.js";
import { planResidentRun } from "./run.js";
import { makeParityGeometry } from "./testGeometry.js";
import { collectSourceFiles, cpuResolveField, opaqueField } from "./testHelpers.js";

// ---------------------------------------------------------------------------
// The three field populations, differing only in provenance

/** Authored through `fieldFromJson`: eligible on every setting. */
const authored = (): FieldLike => fieldFromJson({ fn: "randomField", key: "authored" });
/** The same expression written in code: eligible only with the flag. */
const derived = (): FieldLike => randomField("authored");
/** An arbitrary closure: eligible on no setting, ever. */
const opaque = opaqueField;

/** Every population's name → builder, and what each is worth per flag. */
const POPULATIONS = [
  { name: "authored", make: authored, eligible: (_accept: boolean) => true },
  { name: "derived", make: derived, eligible: (accept: boolean) => accept },
  { name: "opaque", make: opaque, eligible: (_accept: boolean) => false },
] as const;

// ---------------------------------------------------------------------------
// A resolver whose acceptance IS the production predicate

interface ProbeResolver extends GpuFieldResolver {
  /** Fields this resolver actually took onto the "device". */
  resolved: number;
  /** Fields it declined, by reason. */
  declined: Record<string, number>;
}

/**
 * CPU-backed probe: it advertises a flag and gates on that same flag
 * through `deviceSpec`, exactly as `GpuFieldEvaluator` does. Anything it
 * counts in `resolved` is a field that reached the device seam, so the
 * executor MUST have salted that node's key.
 */
function probeResolver(opts: { acceptDerivedSpecs?: boolean } = {}): ProbeResolver {
  const accept = acceptsDerivedSpecs(opts);
  const probe: ProbeResolver = {
    resolved: 0,
    declined: {},
    cacheSalt: "probe|deviceA",
    acceptDerivedSpecs: accept,
    resolveField(field, ctx, stats) {
      const pending = cpuResolveField(field, ctx, stats, accept, {
        onFallback: (reason) => {
          probe.declined[reason] = (probe.declined[reason] ?? 0) + 1;
        },
      });
      // Non-null is exactly "the gate admitted it", so the tally below
      // counts the fields that reached the device seam and nothing else.
      if (pending !== null) probe.resolved++;
      return pending;
    },
  };
  return probe;
}

// ---------------------------------------------------------------------------
// Per-node-type fixtures for the `gpu: "fields"` adopters

interface AdopterFixture {
  readonly type: string;
  /** Graph with one field-capable param filled; returns the node's id. */
  readonly build: (value: FieldLike) => { g: Graph; id: string };
}

const unitSquare = (): ReturnType<typeof createTriangleMesh> =>
  createTriangleMesh([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3]);

const cloudInput = (g: Graph, count = 40): ReturnType<Graph["add"]> => {
  const din = g.add(dataInput);
  g.setParam(din, "items", [makeGeometryItem(makeParityGeometry(count))]);
  return din;
};

const ADOPTERS: AdopterFixture[] = [
  {
    type: "setAttribute",
    build: (value) => {
      const g = new Graph(7);
      const din = cloudInput(g);
      const n = g.add(setAttribute, { name: "d", value: value as never });
      g.connect(din, "out", n, "in");
      g.output(n, "out", "out");
      return { g, id: n.id };
    },
  },
  {
    type: "transformPoints",
    build: (value) => {
      const g = new Graph(7);
      const din = cloudInput(g);
      const n = g.add(transformPoints, { translate: value as never });
      g.connect(din, "out", n, "in");
      g.output(n, "out", "out");
      return { g, id: n.id };
    },
  },
  {
    type: "jitterPoints",
    build: (value) => {
      const g = new Graph(7);
      const din = cloudInput(g);
      const n = g.add(jitterPoints, { amount: value as never });
      g.connect(din, "out", n, "in");
      g.output(n, "out", "out");
      return { g, id: n.id };
    },
  },
  {
    type: "orientAlongVector",
    build: (value) => {
      const g = new Graph(7);
      const din = cloudInput(g);
      const n = g.add(orientAlongVector, { direction: value as never });
      g.connect(din, "out", n, "in");
      g.output(n, "out", "out");
      return { g, id: n.id };
    },
  },
  {
    type: "surfaceSample",
    build: (value) => {
      const g = new Graph(7);
      const din = g.add(dataInput);
      g.setParam(din, "items", [makeGeometryItem(unitSquare())]);
      const n = g.add(surfaceSample, { count: 64, densityField: value as never });
      g.connect(din, "out", n, "in");
      g.output(n, "out", "out");
      return { g, id: n.id };
    },
  },
  {
    type: "pathPointAt",
    build: (value) => {
      const g = new Graph(7);
      const din = g.add(dataInput);
      // A path, not a cloud: this adopter resolves `parameter` on the
      // points of the polyline it slides them along.
      g.setParam(din, "items", [
        makeGeometryItem(createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 2, 1, 0])),
      ]);
      const n = g.add(pathPointAt, { parameter: value as never });
      g.connect(din, "out", n, "in");
      g.output(n, "out", "out");
      return { g, id: n.id };
    },
  },
  {
    type: "pathSegments",
    build: (value) => {
      const g = new Graph(7);
      const din = g.add(dataInput);
      // A path, not a cloud: this adopter resolves `radius` on the
      // points of the polyline it segments.
      g.setParam(din, "items", [
        makeGeometryItem(createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 2, 1, 0])),
      ]);
      const n = g.add(pathSegments, { radius: value as never });
      g.connect(din, "out", n, "in");
      g.output(n, "out", "out");
      return { g, id: n.id };
    },
  },
  {
    type: "sweepProfile",
    build: (value) => {
      const g = new Graph(7);
      const din = g.add(dataInput);
      // A path: this adopter resolves `radius` on the points its rings
      // sit on, and never mutates them.
      g.setParam(din, "items", [
        makeGeometryItem(createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 2, 1, 0])),
      ]);
      const n = g.add(sweepProfile, { radius: value as never });
      g.connect(din, "out", n, "in");
      g.output(n, "out", "out");
      return { g, id: n.id };
    },
  },
  {
    type: "extrudePolygon",
    build: (value) => {
      const g = new Graph(7);
      const din = g.add(dataInput);
      // A CLOSED path: extrusion is not defined on an open one.
      g.setParam(din, "items", [
        makeGeometryItem(
          createPolyline([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1], { closed: true }),
        ),
      ]);
      const n = g.add(extrudePolygon, { distance: value as never });
      g.connect(din, "out", n, "in");
      g.output(n, "out", "out");
      return { g, id: n.id };
    },
  },
  {
    type: "volumeSample",
    build: (value) => {
      const g = new Graph(7);
      const n = g.add(volumeSample, {
        boundsMin: [0, 0, 0],
        boundsMax: [2, 2, 2],
        cellSize: 0.5,
        jitter: value as never,
      });
      g.output(n, "out", "out");
      return { g, id: n.id };
    },
  },
];

/**
 * The device mark a memo key carries, as a whole segment: everything
 * after `|gpu:`, or undefined when the key is unsalted. Reading it this
 * way rather than with `toContain` is deliberate — `probe|deviceA` is a
 * PREFIX of `probe|deviceA+derived`, so a substring check cannot tell the
 * two settings (or two adapters) apart.
 */
function gpuMark(key: string): string | undefined {
  const at = key.indexOf("|gpu:");
  return at === -1 ? undefined : key.slice(at + "|gpu:".length);
}

/** Registered node types whose adoption depends on their Field params. */
function registeredFieldAdopters(): string[] {
  return listNodeTypes()
    .map((info) => info.type)
    .filter((type) => getNodeType(type).def.gpu === "fields")
    .sort();
}

/** Registered resident members that are not terminal-only. */
function registeredChainResidents(): string[] {
  return listNodeTypes()
    .map((info) => info.type)
    .filter((type) => {
      const resident = getNodeType(type).def.resident;
      return resident !== undefined && resident.terminal !== true;
    })
    .sort();
}

describe("the salt mark and the resolver's acceptance agree, for every node type", () => {
  it("covers every registered gpu:\"fields\" node type", () => {
    // Bidirectional: a new adopter with no fixture fails here rather than
    // quietly skipping the property below.
    expect(ADOPTERS.map((a) => a.type).sort()).toEqual(registeredFieldAdopters());
  });

  for (const adopter of ADOPTERS) {
    for (const pop of POPULATIONS) {
      for (const accept of [false, true]) {
        it(`${adopter.type} / ${pop.name} field / acceptDerivedSpecs=${accept}`, async () => {
          const { g, id } = adopter.build(pop.make());
          const probe = probeResolver({ acceptDerivedSpecs: accept });
          await cook(g, { gpu: probe });

          const key = g.require(id).cache?.key;
          expect(key, "cooked node must have a cache entry").toBeDefined();
          const salted = key!.includes("|gpu:");
          const resolvedOnDevice = probe.resolved > 0;

          // THE property: a node resolves on the device if and only if its
          // memo key carries the resolver's salt. Either direction failing
          // is a cache bug — bytes served across the CPU/GPU boundary, or a
          // pointless recook that hides one.
          expect(salted, `salted=${salted} resolved=${resolvedOnDevice}`).toBe(resolvedOnDevice);

          // ...and the flag is what moves it, so neither side can satisfy
          // the equality by refusing everything.
          expect(resolvedOnDevice).toBe(pop.eligible(accept));
          if (!resolvedOnDevice) {
            expect(probe.declined).toEqual({
              [pop.name === "opaque" ? "no-spec" : "derived-spec"]: expect.any(Number) as number,
            });
          }
        });
      }
    }
  }

  it("a cook with no resolver salts nothing, whatever the fields are", async () => {
    for (const adopter of ADOPTERS) {
      for (const pop of POPULATIONS) {
        const { g, id } = adopter.build(pop.make());
        await cook(g);
        expect(g.require(id).cache?.key, `${adopter.type}/${pop.name}`).not.toContain("|gpu:");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The fusion gate (execute.ts) against the run planner (run.ts)

/** Records the runs detection formed; planning always rejects. */
function recordingRunResolver(opts: { acceptDerivedSpecs?: boolean } = {}): GpuFieldResolver & {
  planned: string[][];
} {
  const accept = acceptsDerivedSpecs(opts);
  const fake: GpuFieldResolver & { planned: string[][] } = {
    planned: [],
    cacheSalt: "probe|deviceA",
    acceptDerivedSpecs: accept,
    // This fake pins run PLANNING, not dispatch accounting, so it counts
    // fallbacks like every other double but leaves `stats.dispatches` alone.
    resolveField: (field, ctx, stats) =>
      cpuResolveField(field, ctx, stats, accept, { countDispatches: false }),
    planRun(members, _ctx, stats: GpuCookStats | undefined) {
      fake.planned.push(members.map((m) => m.id));
      if (stats !== undefined) {
        stats.fallbacks["run-plan-failed"] = (stats.fallbacks["run-plan-failed"] ?? 0) + 1;
      }
      return null;
    },
    executeRun() {
      throw new Error("planRun always rejects, so executeRun must never run");
    },
  };
  return fake;
}

/** Chain fixtures for the four non-terminal resident kinds. */
interface ResidentFixture {
  readonly type: string;
  /** The node's field-capable param. */
  readonly param: string;
  /** The node def, erased: `Graph.add` is generic over its param type. */
  readonly def: Parameters<Graph["add"]>[0];
}

const RESIDENTS: ResidentFixture[] = [
  { type: "setAttribute", param: "value", def: setAttribute as never },
  { type: "transformPoints", param: "translate", def: transformPoints as never },
  { type: "jitterPoints", param: "amount", def: jitterPoints as never },
  { type: "orientAlongVector", param: "direction", def: orientAlongVector as never },
];

const CHAIN_LAYOUT: ResidentRunContext["attributes"] = { P: { type: "f32", tupleSize: 3 } };

describe("the fusion gate and the run planner agree, for every resident kind", () => {
  it("covers every registered non-terminal resident kind", () => {
    expect(RESIDENTS.map((r) => r.type).sort()).toEqual(registeredChainResidents());
  });

  it("and the terminal-only residents have no Field params to gate", () => {
    // Terminal residents are excluded from the cross-check above because
    // their fusion also needs `residentTerminals`. That exclusion is only
    // safe while none of them takes a Field param — the moment one does,
    // the fusion gate starts deciding something for it and this fails,
    // forcing the kind into the matrix rather than out of it.
    const terminals = listNodeTypes()
      .map((info) => info.type)
      .filter((type) => getNodeType(type).def.resident?.terminal === true)
      .sort();
    expect(terminals).toEqual(["spawnInstances"]);
    for (const type of terminals) {
      for (const [name, schema] of Object.entries(getNodeType(type).info.params)) {
        expect(schema.acceptsField ?? false, `${type}.${name} accepts a Field`).toBe(false);
      }
    }
  });

  for (const res of RESIDENTS) {
    for (const pop of POPULATIONS) {
      for (const accept of [false, true]) {
        it(`${res.type} / ${pop.name} field / acceptDerivedSpecs=${accept}`, async () => {
          // A lone node is never a run, so the fixture is a two-member
          // chain: a plain-param head, then the node under test. The head
          // is a setAttribute rather than a transformPoints because it
          // must not write P — an identity-keyed member (jitterPoints, or
          // any param carrying randomField) declines a P the device has
          // already rewritten, and that rule is about run POSITION, not
          // about spec eligibility, which is what this matrix cross-checks
          // (it has its own pin in runPlan.test.ts).
          const g = new Graph(7);
          const din = cloudInput(g);
          const head = g.add(setAttribute, { name: "hd", type: "f32", tupleSize: 1, value: 0.5 });
          const params: Record<string, unknown> = { [res.param]: pop.make() };
          if (res.type === "setAttribute") params.name = "d";
          const tail = g.add(res.def, params as never);
          g.connect(din, "out", head, "in");
          g.connect(head, "out", tail, "in");
          g.output(tail, "out", "out");

          const fake = recordingRunResolver({ acceptDerivedSpecs: accept });
          await cook(g, { gpu: fake });
          const joined = fake.planned.some((run) => run.includes(tail.id));

          // The planner, asked the same question directly with the same
          // flag, about the same member.
          const members: ResidentMemberDesc[] = [
            {
              id: head.id,
              type: "setAttribute",
              kind: "setAttribute",
              params: g.require(head.id).params,
              seed: 1,
            },
            {
              id: tail.id,
              type: res.type,
              kind: getNodeType(res.type).def.resident!.kind,
              params: g.require(tail.id).params,
              seed: 2,
            },
          ];
          const outcome = planResidentRun(
            members,
            { attributes: CHAIN_LAYOUT, count: 40, needsGeometry: true },
            Number.MAX_SAFE_INTEGER,
            accept,
          );
          const plannerAccepts = "plan" in outcome;

          expect(joined, `joined=${joined} plannerAccepts=${plannerAccepts}`).toBe(plannerAccepts);
          expect(joined).toBe(pop.eligible(accept));
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// The flag's single path: the per-cook resolver VIEW must carry it

describe("acceptDerivedSpecs survives the per-cook resolver view", () => {
  it("a run-less resolver's flag still reaches the memo key", async () => {
    // `residentTerminals` is forwarded only for resolvers implementing
    // both run methods. This flag must NOT be: it governs the per-field
    // seam, which every resolver has.
    const probe = probeResolver({ acceptDerivedSpecs: true });
    expect(probe.planRun).toBeUndefined();
    const { g, id } = ADOPTERS[0].build(derived());
    await cook(g, { gpu: probe });
    expect(probe.resolved).toBe(1);
    expect(g.require(id).cache?.key).toContain("|gpu:");
  });

  it("the flag is part of the memo key, not only of the eligibility test", async () => {
    // The one case `|gpu:<salt>` alone cannot separate: a node salted on
    // BOTH settings, whose bytes still differ between them. `translate`
    // is authored (always resolved), `scale` is code-authored (resolved
    // only with the flag) — so the key must carry the flag, or the wide
    // cook would be served the narrow cook's bytes off the same adapter.
    const g = new Graph(7);
    const din = cloudInput(g);
    const n = g.add(transformPoints, {
      translate: authored() as never,
      scale: derived() as never,
    });
    g.connect(din, "out", n, "in");
    g.output(n, "out", "out");

    const narrow = probeResolver();
    const rNarrow = await cook(g, { gpu: narrow });
    const keyNarrow = g.require(n.id).cache!.key;
    expect(narrow.resolved).toBe(1);
    expect(rNarrow.stats.gpu!.fallbacks).toEqual({ "derived-spec": 1 });

    const wide = probeResolver({ acceptDerivedSpecs: true });
    const rWide = await cook(g, { gpu: wide });
    const keyWide = g.require(n.id).cache!.key;
    expect(wide.resolved).toBe(2);
    expect(rWide.stats.gpu!.fallbacks).toEqual({});

    // Both salted with the SAME adapter salt. Compared as whole segments,
    // not with `toContain`: the wide mark starts with the narrow one, so a
    // substring check passes even when the adapter identity changes.
    expect(gpuMark(keyNarrow)).toBe("probe|deviceA");
    expect(gpuMark(keyWide)).toBe("probe|deviceA+derived");
    // ...and still distinguishable, so the wide cook recooked.
    expect(keyWide).not.toBe(keyNarrow);
    expect(rWide.stats.cooked).toBe(1);
    // The prefixes are otherwise byte-identical, so the flag is the ONLY
    // thing separating them.
    expect(keyWide.slice(0, keyWide.indexOf("|gpu:"))).toBe(
      keyNarrow.slice(0, keyNarrow.indexOf("|gpu:")),
    );
  });

  it("a nested cook (subgraph) sees the same flag as its parent", async () => {
    // Subgraph nodes cook with the parent's VIEW, not the parent's
    // resolver, so a dropped property would change eligibility one level
    // down while the outer key still claimed the device.
    const inner = new Graph(3);
    const din = cloudInput(inner, 20);
    const sa = inner.add(setAttribute, { name: "d", value: derived() as never });
    inner.connect(din, "out", sa, "in");
    const { subgraphNode } = await import("../graph/index.js");
    const sub = subgraphNode(inner, [], [{ name: "out", node: sa, pin: "out" }]);
    const outer = new Graph(11);
    const sn = outer.add(sub);
    outer.output(sn, "out", "out");

    const off = probeResolver();
    const rOff = await cook(outer, { gpu: off });
    expect(off.resolved).toBe(0);
    expect(off.declined).toEqual({ "derived-spec": 1 });
    const keyOff = outer.require(sn.id).cache!.key;

    const on = probeResolver({ acceptDerivedSpecs: true });
    const rOn = await cook(outer, { gpu: on });
    expect(on.resolved).toBe(1);
    expect(on.declined).toEqual({});
    const keyOn = outer.require(sn.id).cache!.key;

    // The `gpu: "always"` half of the collision fix, pinned on the KEY and
    // not only on the recook: a subgraph is salted under both settings, so
    // without the flag in the salt these two cooks — whose inner cooks
    // produce different bytes — would share one memo entry.
    expect(rOff.stats.cooked).toBe(1);
    expect(rOn.stats.cooked, "the subgraph node itself recooked").toBe(1);
    expect(keyOn).not.toBe(keyOff);
    expect(gpuMark(keyOff)).toBe("probe|deviceA");
    expect(gpuMark(keyOn)).toBe("probe|deviceA+derived");
    expect(keyOn.slice(0, keyOn.indexOf("|gpu:"))).toBe(keyOff.slice(0, keyOff.indexOf("|gpu:")));
  });
});

// ---------------------------------------------------------------------------
// The global-singleton hazard the gate would otherwise expose

describe("fieldFromJson never changes a live field's provenance", () => {
  it("stamping {fn:\"position\"} leaves position() code-authored", async () => {
    const { position, index } = await import("../fields/index.js");
    // Before phase 33 this call stamped the process-wide POSITION
    // singleton, so one `fieldFromJson({fn:"position"})` anywhere made
    // every later `position()` device-eligible — eligibility by module
    // load order.
    const parsed = fieldFromJson({ fn: "position" });
    const parsedIndex = fieldFromJson({ fn: "index" });
    expect(parsed).not.toBe(position());
    expect(parsedIndex).not.toBe(index());

    // The parsed field is authored (eligible with the gate off, exactly
    // as in v0.8.0); the singleton is derived (eligible only with it on).
    expect(deviceSpec(parsed, false)).toEqual({ fn: "position" });
    expect(deviceSpec(position(), false)).toBeUndefined();
    expect(deviceSpec(position(), true)).toEqual({ fn: "position" });
    expect(deviceSpec(parsedIndex, false)).toEqual({ fn: "index" });
    expect(deviceSpec(index(), false)).toBeUndefined();

    // ...and the copy is indistinguishable everywhere else.
    expect(parsed.key).toBe(position().key);
    expect(parsed.tupleSize).toBe(position().tupleSize);
    const geo = makeParityGeometry(8);
    // Two DISTINCT context objects: `evaluateField` memoizes per context
    // in an identity-keyed map, so evaluating both fields against one ctx
    // returns the same Column object and compares equal to itself no
    // matter what the copy does. Raw bytes, through separate memos.
    const a = evaluateField(parsed, { geo, domain: "point", seed: 3 });
    const b = evaluateField(position(), { geo, domain: "point", seed: 3 });
    expect(a).not.toBe(b);
    expect(a.tupleSize).toBe(b.tupleSize);
    expect(a.data.constructor.name).toBe(b.data.constructor.name);
    expect([...new Uint8Array(a.data.buffer, a.data.byteOffset, a.data.byteLength)]).toEqual([
      ...new Uint8Array(b.data.buffer, b.data.byteOffset, b.data.byteLength),
    ]);
  });

  it("detachedLeaf's derived spec cannot escape a top-level authored stamp", () => {
    // `detachedLeaf` re-attaches the singleton's derived spec to its copy
    // (`fieldJson.ts`, "It carries the same derived spec, so a copy nested
    // inside a larger expression composes exactly as the singleton
    // would"). That line is DEFENCE IN DEPTH, not a pinned behavior, and
    // this test says so rather than pretending otherwise: `fieldFromJson`
    // stamps the authored spec on the TOP-LEVEL field only, and every
    // caller of `detachedLeaf` is a leaf registry entry, so a copy
    // can never leave a `fieldFromJson` call carrying that derived spec —
    // deleting the line changes nothing observable (audit mutation X4).
    //
    // What IS pinned is the reachability boundary: a third caller, or a
    // second stamping site, would make the claim testable, and this fails
    // until someone writes that test.
    const source = readFileSync(
      fileURLToPath(new URL("../fields/fieldJson.ts", import.meta.url)),
      "utf8",
    );
    // The declaration is generic (`function detachedLeaf<N ...>(`), so it
    // is not one of the call matches.
    expect([...source.matchAll(/function detachedLeaf</g)].length).toBe(1);
    expect(
      [...source.matchAll(/detachedLeaf\(/g)].length,
      "callers of detachedLeaf (position, index, fraction, nodeSeed)",
    ).toBe(4);
    expect([...source.matchAll(/attachAuthoredSpec\(/g)].length, "authored stamping sites").toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The `gpu: "always"` class, which `listNodeTypes()` cannot enumerate
//
// `subgraph` is built with `defineNode`, not `standardNode`, so it never
// enters the registry and the bidirectional pins above cannot see it —
// yet it is the node whose WHOLE INNER COOK changes with the flag. The
// class is therefore covered by an explicit fixture plus a source-level
// drift pin, so a second `gpu: "always"` definition anywhere in `src/`
// fails this file instead of escaping the property.

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));

/** Non-test source files declaring `gpu: "always"`, by path under src/. */
function alwaysAdopterSources(): string[] {
  const hits: string[] = [];
  for (const file of collectSourceFiles(SRC_DIR)) {
    const source = readFileSync(file, "utf8");
    for (const _ of source.matchAll(/^[ \t]*gpu:[ \t]*"always",[ \t]*$/gm)) {
      hits.push(file.slice(SRC_DIR.length).replace(/\\/g, "/"));
    }
  }
  return hits.sort();
}

/**
 * The composite adopters under test: a wrapper around one adopter.
 *
 * Both wrappers, because both forward the outer resolver into a nested cook
 * they cannot see inside, and so both salt on the resolver's mere presence.
 * `forEach` runs its body once per item and is fed exactly one, so the two
 * fixtures differ in the loop and in nothing else that matters here.
 */
const ALWAYS_WRAPPERS = ["subgraph", "forEach"] as const;

// Defaults to `subgraph` because the literal-key pin further down calls
// this through a one-argument builder signature, and those literals are the
// v0.8.0 compatibility promise — a `forEach` has no v0.8.0 key to keep.
function alwaysFixture(
  value: FieldLike,
  wrapper: (typeof ALWAYS_WRAPPERS)[number] = "subgraph",
): { g: Graph; id: string } {
  const inner = new Graph(3);
  const sa = inner.add(setAttribute, { name: "d", value: value as never });
  if (wrapper === "subgraph") {
    const din = cloudInput(inner, 20);
    inner.connect(din, "out", sa, "in");
    const sub = subgraphNode(inner, [], [{ name: "out", node: sa, pin: "out" }]);
    const g = new Graph(11);
    const n = g.add(sub);
    g.output(n, "out", "out");
    return { g, id: n.id };
  }
  const def = forEachNode(inner, [{ name: "each", node: sa, pin: "in" }], [
    { name: "out", node: sa, pin: "out" },
  ]);
  const g = new Graph(11);
  const din = cloudInput(g, 20);
  const n = g.add(def);
  g.connect(din, "out", n, "each");
  g.output(n, "out", "out");
  return { g, id: n.id };
}

describe('the gpu:"always" class is covered too', () => {
  it("has exactly the members covered below", () => {
    // Registry-invisible by construction: assert that too, so the day a
    // `standardNode` declares `gpu: "always"` the ADOPTERS pin above
    // starts carrying it instead of this one silently going stale.
    const registered = listNodeTypes()
      .map((info) => info.type)
      .filter((type) => getNodeType(type).def.gpu === "always");
    expect(registered, 'no registered node type declares gpu:"always"').toEqual([]);
    // One entry per wrapper. A THIRD arriving here means a new composite
    // that forwards a resolver into a cook this file does not exercise.
    expect(alwaysAdopterSources()).toEqual(["graph/subgraph.ts", "nodes/forEach.ts"]);
  });

  for (const wrapper of ALWAYS_WRAPPERS)
  for (const pop of POPULATIONS) {
    for (const accept of [false, true]) {
      it(`${wrapper} / ${pop.name} field / acceptDerivedSpecs=${accept}`, async () => {
        const { g, id } = alwaysFixture(pop.make(), wrapper);
        const probe = probeResolver({ acceptDerivedSpecs: accept });
        await cook(g, { gpu: probe });

        // "always" salts on the presence of a resolver alone — the
        // wrapper cannot see which inner nodes adopt — so unlike the
        // "fields" class the mark is unconditional...
        expect(gpuMark(g.require(id).cache!.key)).toBe(
          accept ? "probe|deviceA+derived" : "probe|deviceA",
        );
        // ...which is exactly why the flag must be IN the mark: the inner
        // cook resolves a different population on each setting under a
        // node key that is otherwise identical.
        expect(probe.resolved > 0).toBe(pop.eligible(accept));
      });
    }
  }

  it("and salts nothing at all without a resolver", async () => {
    for (const wrapper of ALWAYS_WRAPPERS) {
      for (const pop of POPULATIONS) {
        const { g, id } = alwaysFixture(pop.make(), wrapper);
        await cook(g);
        expect(gpuMark(g.require(id).cache!.key), `${wrapper}/${pop.name}`).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Gate-off memo keys are the v0.8.0 keys, byte for byte
//
// The phase's headline compatibility promise, guarded in-repo rather than
// by a throwaway cross-version harness. Both fixtures are INPUT-FREE, so
// their keys carry no cook-order-dependent input signature and can be
// pinned as literals: a change to the key composition, to the salt
// format, or to the gate-off suffix moves a string here.

const VOL_PREFIX =
  'volumeSample|s4258174262|p{"boundsMax":[#2,#2,#2],"boundsMin":[#0,#0,#0],"cellSize":#0.5,' +
  '"jitter":F(random(7897303)),"seed":#0}|iin=|x';
const SUB_PREFIX = "subgraph|s4224367284|p{}|i|x5";

/** ADOPTERS' input-free fixture: `volumeSample` with a Field `jitter`. */
function volumeFixture(value: FieldLike): { g: Graph; id: string } {
  const g = new Graph(7);
  const n = g.add(volumeSample, {
    boundsMin: [0, 0, 0],
    boundsMax: [2, 2, 2],
    cellSize: 0.5,
    jitter: value as never,
  });
  g.output(n, "out", "out");
  return { g, id: n.id };
}

/** Cook a FRESH graph so the pinned key never depends on cook history. */
async function keyOf(
  make: (value: FieldLike) => { g: Graph; id: string },
  value: FieldLike,
  accept: boolean | undefined,
): Promise<string> {
  const { g, id } = make(value);
  await cook(g, accept === undefined ? {} : { gpu: probeResolver({ acceptDerivedSpecs: accept }) });
  return g.require(id).cache!.key;
}

describe("gate-off memo keys are byte-identical to v0.8.0's", () => {
  it('pins the literal keys of a gpu:"fields" adopter', async () => {
    // Authored param: salted in v0.8.0 and salted now, with the SAME
    // mark — the suffix is empty with the gate off, so no pre-v0.9 key
    // moves. `+authored`, or any other non-empty gate-off suffix, fails
    // here (audit mutations X1, X2, H1).
    expect(await keyOf(volumeFixture, authored(), false)).toBe(`${VOL_PREFIX}|gpu:probe|deviceA`);
    // Code-authored param: unsalted in v0.8.0 (it carried no spec the
    // resolver would take) and unsalted now.
    expect(await keyOf(volumeFixture, derived(), false)).toBe(VOL_PREFIX);
    // No resolver at all: the pre-GPU key, unchanged since v0.5.
    expect(await keyOf(volumeFixture, authored(), undefined)).toBe(VOL_PREFIX);
    expect(await keyOf(volumeFixture, derived(), undefined)).toBe(VOL_PREFIX);
    // ...and only the gate ON moves them, both to the same wider key.
    expect(await keyOf(volumeFixture, authored(), true)).toBe(
      `${VOL_PREFIX}|gpu:probe|deviceA+derived`,
    );
    expect(await keyOf(volumeFixture, derived(), true)).toBe(
      `${VOL_PREFIX}|gpu:probe|deviceA+derived`,
    );
  });

  it('pins the literal keys of the gpu:"always" adopter', async () => {
    expect(await keyOf(alwaysFixture, derived(), false)).toBe(`${SUB_PREFIX}|gpu:probe|deviceA`);
    expect(await keyOf(alwaysFixture, derived(), undefined)).toBe(SUB_PREFIX);
    expect(await keyOf(alwaysFixture, derived(), true)).toBe(
      `${SUB_PREFIX}|gpu:probe|deviceA+derived`,
    );
  });

  it("the gate-off mark is the resolver's cacheSalt and nothing else", async () => {
    // The literals above pin one salt string; this pins the RELATION for
    // arbitrary ones, so a suffix that happened to spell "deviceA" could
    // not hide inside them.
    for (const salt of ["s", "probe|deviceB", "gpu2|acme|gen9|gpu-1|Acme GPU"]) {
      const { g, id } = volumeFixture(authored());
      await cook(g, { gpu: { cacheSalt: salt, acceptDerivedSpecs: false, resolveField: () => null } });
      expect(gpuMark(g.require(id).cache!.key)).toBe(salt);
    }
  });
});

// ---------------------------------------------------------------------------
// Map- and Set-valued params
//
// `stableValueHash` accepts both, so a user-defined node type may carry a
// Field inside one — but no SHIPPED node does, which left both branches of
// `paramsHaveSpecField` and `paramsFieldsAllSpecd` unexecuted by the whole
// suite (audit mutation X7 survived with zero failures). A Field the salt
// predicate cannot see is a Field the evaluator resolves under an unsalted
// key: the stale-cache bug in its original form.

interface ContainerParams {
  readonly fields: Map<string, FieldLike> | Set<FieldLike>;
}

/** A chain-shaped adopter whose only Field param lives inside a container. */
function containerNode(type: string): NodeDef<ContainerParams> {
  return defineNode<ContainerParams>({
    type,
    inputs: [{ name: "in", kind: "geometry" }],
    outputs: [{ name: "out", kind: "geometry" }],
    defaultParams: { fields: new Map() },
    gpu: "fields",
    resident: { kind: "testContainerParam" },
    async execute({ inputs, params, seed, gpu }) {
      const item = inputs.in[0];
      if (item === undefined || item.kind !== "geometry") {
        throw new Error(`${type}: input pin "in" has no geometry connected`);
      }
      const values =
        params.fields instanceof Map ? [...params.fields.values()] : [...params.fields];
      // Resolve exactly as an adopter does; the geometry passes through
      // untouched, so the node's only observable effect is the resolve.
      for (const value of values) {
        await resolveOnMaybeGpu(gpu, item.geo, "point", value, seed, type, "fields");
      }
      return { out: [item] };
    },
  });
}

const CONTAINERS = [
  {
    name: "Map",
    def: containerNode("testMapParam"),
    wrap: (f: FieldLike): ContainerParams["fields"] => new Map([["v", f]]),
  },
  {
    name: "Set",
    def: containerNode("testSetParam"),
    wrap: (f: FieldLike): ContainerParams["fields"] => new Set([f]),
  },
] as const;

describe("the salt predicates walk Map- and Set-valued params", () => {
  for (const container of CONTAINERS) {
    for (const pop of POPULATIONS) {
      for (const accept of [false, true]) {
        it(`${container.name} param / ${pop.name} field / acceptDerivedSpecs=${accept}`, async () => {
          const build = (): { g: Graph; id: string } => {
            // A lone node is never a run, so the fixture is a two-member
            // chain, exactly as the resident matrix above.
            const g = new Graph(7);
            const din = cloudInput(g);
            const head = g.add(transformPoints, { translate: [1, 0, 0] });
            const n = g.add(container.def, { fields: container.wrap(pop.make()) } as never);
            g.connect(din, "out", head, "in");
            g.connect(head, "out", n, "in");
            g.output(n, "out", "out");
            return { g, id: n.id };
          };

          // (a) the memo-key salt seam: `paramsHaveSpecField`'s container
          // branch must find the Field the resolver then resolves.
          const salted = build();
          const probe = probeResolver({ acceptDerivedSpecs: accept });
          await cook(salted.g, { gpu: probe });
          const resolvedOnDevice = probe.resolved > 0;
          expect(resolvedOnDevice).toBe(pop.eligible(accept));
          expect(gpuMark(salted.g.require(salted.id).cache!.key) !== undefined).toBe(
            resolvedOnDevice,
          );

          // (b) the fusion gate: `paramsFieldsAllSpecd`'s container branch
          // decides whether the node is offered to the run planner.
          const fused = build();
          const fake = recordingRunResolver({ acceptDerivedSpecs: accept });
          await cook(fused.g, { gpu: fake });
          expect(fake.planned.some((run) => run.includes(fused.id))).toBe(pop.eligible(accept));
        });
      }
    }
  }
});
