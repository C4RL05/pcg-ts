/**
 * The shipped vocabulary, exercised the way the phase's exit criteria
 * state it — and the criteria are about REACHABILITY, not just about the
 * recipes being well-formed.
 *
 * Every primitive is driven FROM JSON: a serialized graph referencing it
 * by name, with its input pins fed by nodes a saved graph can carry. No
 * `dataInput`, no runtime injection, nothing built in code. A primitive
 * that needs items injected at runtime cannot be exercised by anyone who
 * loads a graph from a file, which for an agent-facing library means it is
 * not shipped at all. The fixture table below is therefore asserted to
 * cover EXACTLY the registry: adding a primitive without a way to cook it
 * fails here rather than shipping unreachable.
 */
import { describe, expect, it } from "vitest";
import {
  type DataCollection,
  type SerializedConnection,
  type SerializedGraph,
  type SerializedNode,
  cook,
  deserializeGraph,
  getRegisteredSubgraph,
  listSubgraphs,
} from "../index.js";
import { snapshotGeometry } from "../nodes/nodes.testsupport.js";
import "./index.js";
import { PRIMITIVE_FAMILIES, primitiveFamily } from "./define.js";

// ---------------------------------------------------------------------------
// Feeding a primitive from JSON
// ---------------------------------------------------------------------------

/** A source a saved graph can carry: nodes, their wiring, and the emitting pin. */
interface Source {
  readonly nodes: readonly SerializedNode[];
  readonly connections?: readonly SerializedConnection[];
  readonly out: readonly [string, string];
}

/** How many points every `points()` fixture emits. */
const FIXTURE_POINTS = 300;

/** A flat scatter on the ground plane. */
function points(id: string, seed = 7): Source {
  return {
    nodes: [
      {
        id,
        type: "pointScatterInBounds",
        params: { count: 300, boundsMin: [-15, 0, -15], boundsMax: [15, 0, 15], seed },
      },
    ],
    out: [id, "out"],
  };
}

/** A small scatter, for the source side of a copy. */
function fewPoints(id: string): Source {
  return {
    nodes: [
      {
        id,
        type: "pointScatterInBounds",
        params: { count: 6, boundsMin: [-1, 0, -1], boundsMax: [1, 0, 1], seed: 3 },
      },
    ],
    out: [id, "out"],
  };
}

/** A scatter floating above the ground plane, for a downward raycast. */
function pointsAbove(id: string): Source {
  return {
    nodes: [
      {
        id,
        type: "pointScatterInBounds",
        params: { count: 200, boundsMin: [-15, 5, -15], boundsMax: [15, 5, 15], seed: 11 },
      },
    ],
    out: [id, "out"],
  };
}

/** A subdivided ground plane: the mesh source a saved graph can carry. */
function mesh(id: string): Source {
  return {
    nodes: [
      {
        id,
        type: "meshPrimitive",
        params: {
          shape: "plane",
          size: [40, 0, 40],
          center: [0, 0, 0],
          orientation: "xz",
          subdivisions: [6, 1, 6],
          flip: false,
        },
      },
    ],
    out: [id, "out"],
  };
}

/** The same plane with a `normal` point attribute stamped on it. */
function meshWithNormal(id: string): Source {
  const base = mesh(`${id}_mesh`);
  return {
    nodes: [
      ...base.nodes,
      {
        id,
        type: "setAttribute",
        params: {
          name: "normal",
          domain: "point",
          type: "f32",
          tupleSize: 3,
          value: { fn: "constant", value: [0, 1, 0] },
        },
      },
    ],
    connections: [{ from: base.out, to: [id, "in"] }],
    out: [id, "out"],
  };
}

/** How many points {@link curve} puts on its path. */
const CURVE_POINTS = 9;

/** Half the length of {@link curve}, which runs along X through the origin. */
const CURVE_HALF_LENGTH = 20;

/**
 * A PATH a saved graph can carry: a straight open polyline along X through
 * the origin, built from raw nodes rather than from `shape/path-loop` so
 * the curve consumers are not tested through a curve producer. Straight on
 * purpose — every tangent is exactly +X, so orientation is checkable
 * against a number rather than against a trend.
 */
function curve(id: string): Source {
  return {
    nodes: [
      {
        id: `${id}_line`,
        type: "pointLine",
        params: {
          count: CURVE_POINTS,
          start: [-CURVE_HALF_LENGTH, 0, 0],
          end: [CURVE_HALF_LENGTH, 0, 0],
          includeEnd: true,
        },
      },
      { id, type: "pointsToPath", params: { closed: false, groupAttr: "", orderAttr: "" } },
    ],
    connections: [{ from: [`${id}_line`, "out"], to: [id, "in"] }],
    out: [id, "out"],
  };
}

/** How many points {@link sampledCurve} puts on {@link curve}. */
const SAMPLED_CURVE_POINTS = 24;

/**
 * The same straight path, RESAMPLED — so it carries the `curveU` a bare
 * `pointsToPath` never writes. `transform/gather-on-path` reads that
 * parameterization to know where each point already is, and the raw
 * `curve` fixture deliberately has none: a primitive that needs one has
 * to say so, and this is what saying so costs a caller.
 */
function sampledCurve(id: string): Source {
  const base = curve(`${id}_path`);
  return {
    nodes: [
      ...base.nodes,
      {
        id,
        type: "pathResample",
        params: { mode: "count", count: SAMPLED_CURVE_POINTS, spacing: 1 },
      },
    ],
    connections: [...(base.connections ?? []), { from: base.out, to: [id, "in"] }],
    out: [id, "out"],
  };
}

/** Points carrying the flat per-triangle `normal` `surfaceSample` writes. */
function pointsWithNormal(id: string): Source {
  const base = mesh(`${id}_mesh`);
  return {
    nodes: [
      ...base.nodes,
      { id, type: "surfaceSample", params: { count: 400, seed: 5, densityField: 1 } },
    ],
    connections: [{ from: base.out, to: [id, "in"] }],
    out: [id, "out"],
  };
}

/**
 * How every primitive's input pins are fed from a serialized graph.
 *
 * `[]` means the primitive is a source and takes nothing. The table is
 * asserted to name exactly the registered primitives, so this is also the
 * list of what ships.
 */
const FIXTURES: Record<string, Record<string, (id: string) => Source>> = {
  "shape/ring": {},
  "shape/spiral": {},
  "shape/disc": {},
  "shape/sphere-points": {},
  "shape/path-loop": {},
  "shape/path-meander": {},

  "fill/scatter-even": {},
  "fill/scatter-by-density": {},
  "fill/scatter-clustered": {},
  "fill/volume-by-noise": { in: points },

  "transform/displace-by-noise": { in: points },
  "transform/snap-to-grid": { in: points },
  "transform/relax-spacing": { in: points },
  "transform/gather-on-path": { in: sampledCurve },

  "compose/merge-tagged": { a: points, b: fewPoints },
  "compose/scatter-copies": { source: fewPoints, target: points },

  "filter/thin-by-density": { in: points },
  "filter/mask-by-noise": { in: points },
  "filter/inside-radius": { in: points },
  "filter/by-distance-to": { in: points, features: fewPoints },
  "filter/by-neighbor-count": { in: points },
  "filter/by-distance-to-curve": { in: points, curve },

  "place/on-surface": { surface: mesh },
  "place/plantable": { surface: mesh },
  "place/drop-to-surface": { points: pointsAbove, surface: mesh },
  "place/align-to-surface": { points: pointsAbove, surface: meshWithNormal },
  "place/along-curve": { curve },
  "place/radial-on-curve": { curve },

  "write/height-slope": { in: pointsWithNormal },
  "write/density-from-noise": { in: points },
  "write/random-scale": { in: points },
  "write/random-yaw": { in: points },
  "write/color-from-attribute": { in: points },
  "write/local-density": { in: points },
  "write/instances-by-species": { in: points },
  "write/orient-along-path": { in: curve },
  "write/curve-frame": { in: curve },
};

/**
 * A graph that references `name` once (or twice) and declares an output
 * per exposed output pin, with every input pin fed from {@link FIXTURES}.
 * Instances are suffixed so two of them can live in one graph.
 */
function driverGraph(
  name: string,
  instances: readonly { readonly id: string; readonly params?: Record<string, unknown> }[],
  seed = 2026,
): SerializedGraph {
  const entry = getRegisteredSubgraph(name);
  const feeds = FIXTURES[name];
  if (feeds === undefined) throw new Error(`no fixture for primitive "${name}"`);
  const nodes: SerializedNode[] = [];
  const connections: SerializedConnection[] = [];
  const outputs: { id: string; pin: string; name: string }[] = [];
  // ONE source per pin, SHARED by every instance. Two copies of a source
  // would have different node ids and so different derived seeds, and the
  // two instances would differ because their INPUTS differed — which is
  // exactly the thing the variation tests are trying to measure about the
  // primitives themselves.
  for (const pin of entry.subgraph.inputs) {
    const make = feeds[pin.name];
    if (make === undefined) throw new Error(`fixture for "${name}" does not feed pin "${pin.name}"`);
    const source = make(`src_${pin.name}`);
    nodes.push(...source.nodes);
    connections.push(...(source.connections ?? []));
  }
  for (const instance of instances) {
    nodes.push({
      id: instance.id,
      type: "subgraph",
      params: { ...(instance.params ?? {}) },
      ref: { name },
    });
    for (const pin of entry.subgraph.inputs) {
      const source = (feeds[pin.name] as (id: string) => Source)(`src_${pin.name}`);
      connections.push({ from: source.out, to: [instance.id, pin.name] });
    }
    for (const pin of entry.subgraph.outputs) {
      outputs.push({ id: instance.id, pin: pin.name, name: `${instance.id}_${pin.name}` });
    }
  }
  return { formatVersion: 1, seed, nodes, connections, outputs };
}

/** Exact, comparable snapshot of one cooked output collection. */
function snapshotCollection(collection: DataCollection | undefined): unknown {
  return (collection ?? []).map((item) => {
    if (item.kind === "geometry") return { kind: "geometry", geo: snapshotGeometry(item.geo) };
    if (item.kind === "instances") {
      return {
        kind: "instances",
        batches: item.batches.map((b) => ({
          assetId: b.assetId,
          count: b.count,
          transforms: Array.from(b.transforms),
        })),
      };
    }
    return { kind: item.kind, value: JSON.stringify(item) };
  });
}

async function cookGraph(graph: SerializedGraph): Promise<Record<string, DataCollection>> {
  return (await cook(deserializeGraph(graph))).outputs;
}

/** Every registered primitive name, sorted — the suite's subject. */
const NAMES = listSubgraphs()
  .map((e) => e.name)
  .sort();

/** Names of every point geometry output, used for the count assertions. */
function pointCounts(outputs: Record<string, DataCollection>): number[] {
  const counts: number[] = [];
  for (const collection of Object.values(outputs)) {
    for (const item of collection) if (item.kind === "geometry") counts.push(item.geo.pointCount);
  }
  return counts;
}

// ---------------------------------------------------------------------------

describe("the shipped vocabulary", () => {
  it("registers a catalog whose names are all <family>/<kebab-case>", () => {
    expect(NAMES.length).toBeGreaterThan(0);
    for (const name of NAMES) expect(() => primitiveFamily(name)).not.toThrow();
    expect(new Set(NAMES).size).toBe(NAMES.length);
  });

  it("covers every family, and every family has at least two entries", () => {
    const byFamily = new Map<string, string[]>();
    for (const name of NAMES) {
      const family = primitiveFamily(name);
      byFamily.set(family, [...(byFamily.get(family) ?? []), name]);
    }
    for (const family of PRIMITIVE_FAMILIES) {
      expect(byFamily.get(family)?.length ?? 0).toBeGreaterThanOrEqual(2);
    }
  });

  it("has a JSON fixture for exactly the registered set", () => {
    // The two halves of the criterion: nothing ships without a way to
    // cook it from JSON, and no fixture outlives the primitive it fed.
    expect(Object.keys(FIXTURES).sort()).toEqual(NAMES);
  });

  it("carries the family as a tag and a real title and description", () => {
    for (const entry of listSubgraphs()) {
      const family = primitiveFamily(entry.name);
      expect(entry.meta?.tags).toContain(family);
      expect((entry.meta?.title ?? "").length).toBeGreaterThan(8);
      // Long enough to say what it is FOR, not just what it is.
      expect((entry.meta?.description ?? "").length).toBeGreaterThan(120);
    }
  });
});

describe("every primitive cooks from JSON", () => {
  for (const name of NAMES) {
    it(`${name} cooks and produces points`, async () => {
      const outputs = await cookGraph(driverGraph(name, [{ id: "main" }]));
      const counts = pointCounts(outputs);
      expect(counts.length).toBeGreaterThan(0);
      for (const count of counts) expect(count).toBeGreaterThan(0);
    });
  }

  it("uses no dataInput anywhere in the driver graphs", () => {
    for (const name of NAMES) {
      const graph = driverGraph(name, [{ id: "main" }]);
      expect(graph.nodes.map((n) => n.type)).not.toContain("dataInput");
    }
  });
});

describe("double-cook determinism over the whole set", () => {
  for (const name of NAMES) {
    it(`${name} cooks byte-identically twice`, async () => {
      const graph = driverGraph(name, [{ id: "main" }]);
      const a = await cookGraph(graph);
      const b = await cookGraph(graph);
      expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
      for (const key of Object.keys(a)) {
        expect(snapshotCollection(b[key])).toEqual(snapshotCollection(a[key]));
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Seeds: what two instances of one primitive do
// ---------------------------------------------------------------------------

/** Field-expression constructors that make a primitive noise-bearing. */
const NOISE_FNS = ["valueNoise", "perlinNoise", "simplexNoise", "worleyNoise", "fbm"];

/** Whether a recipe reaches a noise field, following nested references. */
function isNoiseBearing(name: string, seen = new Set<string>()): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  const entry = getRegisteredSubgraph(name);
  const json = JSON.stringify(entry.subgraph.graph.nodes);
  if (NOISE_FNS.some((fn) => json.includes(`"fn":"${fn}"`))) return true;
  return entry.subgraph.graph.nodes.some(
    (node) => node.ref !== undefined && isNoiseBearing(node.ref.name, seen),
  );
}

describe("seeds and per-instance variation", () => {
  const noiseBearing = NAMES.filter((name) => isNoiseBearing(name));

  it("finds the noise-bearing primitives", () => {
    // A guard on the detector, not on the catalog: a rewrite that stopped
    // finding noise would make every assertion below vacuously pass.
    expect(noiseBearing.length).toBeGreaterThanOrEqual(5);
    expect(noiseBearing).toContain("filter/mask-by-noise");
    expect(noiseBearing).toContain("fill/scatter-by-density");
  });

  it("gives every noise-bearing primitive a variant knob, and says so", () => {
    for (const name of noiseBearing) {
      const params = getRegisteredSubgraph(name).subgraph.params ?? [];
      const variant = params.find((p) => p.name === "variant");
      expect(variant, `${name} is noise-bearing but exposes no "variant"`).toBeDefined();
      // The knob is worthless if the catalog does not warn that two
      // instances are otherwise identical.
      expect(getRegisteredSubgraph(name).meta?.description ?? "").toContain("variant");
    }
  });

  it("a different variant gives a noise-bearing primitive a different result", async () => {
    for (const name of noiseBearing) {
      const graph = driverGraph(name, [
        { id: "a", params: { variant: 0 } },
        { id: "b", params: { variant: 137.5 } },
      ]);
      const outputs = await cookGraph(graph);
      const a = snapshotCollection(outputs[`a_out`]);
      const b = snapshotCollection(outputs[`b_out`]);
      expect(a, `${name} ignores its variant`).not.toEqual(b);
    }
  });

  it("frequency really scales the noise sample position", async () => {
    // `variant` is an offset and `frequency` a multiplier on the same
    // position; a recipe that confused the two would still vary with
    // `variant` and would silently ignore this.
    for (const name of noiseBearing) {
      const graph = driverGraph(name, [
        { id: "a", params: { frequency: 0.01 } },
        { id: "b", params: { frequency: 0.2 } },
      ]);
      const outputs = await cookGraph(graph);
      expect(
        snapshotCollection(outputs.a_out),
        `${name} ignores its frequency`,
      ).not.toEqual(snapshotCollection(outputs.b_out));
    }
  });

  it("the same variant reproduces exactly across two instances of one graph", async () => {
    // Two instances have different node ids, hence different inner seeds —
    // so this is the direct measurement of what noise does NOT vary with.
    const graph = driverGraph("filter/mask-by-noise", [
      { id: "a", params: { variant: 4 } },
      { id: "b", params: { variant: 4 } },
    ]);
    const outputs = await cookGraph(graph);
    expect(snapshotCollection(outputs.a_out)).toEqual(snapshotCollection(outputs.b_out));
  });

  it("stochastic primitives vary between two instances with no knob touched", async () => {
    for (const name of ["shape/disc", "fill/scatter-even", "write/random-scale", "write/random-yaw"]) {
      const outputs = await cookGraph(driverGraph(name, [{ id: "a" }, { id: "b" }]));
      expect(snapshotCollection(outputs.a_out), `${name} does not vary per instance`).not.toEqual(
        snapshotCollection(outputs.b_out),
      );
    }
  });

  it("an explicit seed re-rolls a stochastic primitive", async () => {
    const outputs = await cookGraph(
      driverGraph("fill/scatter-even", [
        { id: "a", params: { seed: 1 } },
        { id: "a2", params: { seed: 2 } },
      ]),
    );
    expect(snapshotCollection(outputs.a_out)).not.toEqual(snapshotCollection(outputs.a2_out));
  });
});

// ---------------------------------------------------------------------------
// Per-family smoke coverage: the claim each family's description makes
// ---------------------------------------------------------------------------

async function cookOne(
  name: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, DataCollection>> {
  return await cookGraph(driverGraph(name, [{ id: "main", params }]));
}

function geo(outputs: Record<string, DataCollection>, key = "main_out") {
  const collection = outputs[key] ?? [];
  for (const item of collection) if (item.kind === "geometry") return item.geo;
  throw new Error(`no geometry on output "${key}"`);
}

describe("shape/", () => {
  it("ring emits exactly `count` points on the circle of the requested size", async () => {
    // `count` means count. It used to mean "count - 1 on a full sweep",
    // because the recipe sampled both ends of the turn and then paid a
    // filter node to delete the duplicate; the half-open `includeEnd`
    // mode means the duplicate is never created.
    const g = geo(await cookOne("shape/ring", { count: 25, size: [10, 10, 10] }));
    expect(g.pointCount).toBe(25);
    const P = g.attrs.point.require("P");
    for (let i = 0; i < g.pointCount; i++) {
      const r = Math.hypot(P.get(i, 0), P.get(i, 2));
      expect(r).toBeCloseTo(10, 3);
      expect(P.get(i, 1)).toBeCloseTo(0, 6);
    }
    // ...and no two of them are the same place: the seam never existed.
    const gap = Math.hypot(P.get(24, 0) - P.get(0, 0), P.get(24, 2) - P.get(0, 2));
    expect(gap).toBeGreaterThan(1);
  });

  it("ring pins the far end of a partial sweep only when asked", async () => {
    const open = geo(await cookOne("shape/ring", { count: 25, sweep: 0.5, size: [10, 10, 10] }));
    const pinned = geo(
      await cookOne("shape/ring", { count: 25, sweep: 0.5, size: [10, 10, 10], includeEnd: true }),
    );
    // The knob moves the last sample; it never changes how many there are.
    expect(open.pointCount).toBe(25);
    expect(pinned.pointCount).toBe(25);
    const pinnedP = pinned.attrs.point.require("P");
    expect(pinnedP.get(24, 0)).toBeCloseTo(-10, 4); // half a turn round
    expect(pinnedP.get(24, 2)).toBeCloseTo(0, 4);
    const openP = open.attrs.point.require("P");
    expect(openP.get(24, 0)).toBeGreaterThan(-10); // one step short of it
    expect(openP.get(24, 2)).toBeGreaterThan(0.5);
  });

  it("shapes leave the per-point scale attribute at 1", async () => {
    for (const name of [
      "shape/ring",
      "shape/spiral",
      "shape/disc",
      "shape/sphere-points",
      "shape/path-loop",
      "shape/path-meander",
    ]) {
      const g = geo(await cookOne(name, { size: [12, 12, 12] }));
      const scale = g.attrs.point.require("scale");
      for (let i = 0; i < g.pointCount; i++) {
        expect(scale.get(i, 0), `${name} leaked its size into the scale attribute`).toBeCloseTo(1, 6);
      }
    }
  });

  it("disc keeps roughly the area ratio of a circle in a square", async () => {
    const g = geo(await cookOne("shape/disc", { count: 4000 }));
    expect(g.pointCount / 4000).toBeGreaterThan(0.74);
    expect(g.pointCount / 4000).toBeLessThan(0.83);
  });

  it("sphere-points lands every point on the sphere", async () => {
    const g = geo(await cookOne("shape/sphere-points", { count: 500, size: [6, 6, 6] }));
    const P = g.attrs.point.require("P");
    for (let i = 0; i < g.pointCount; i++) {
      expect(Math.hypot(P.get(i, 0), P.get(i, 1), P.get(i, 2))).toBeCloseTo(6, 3);
    }
  });

  it("spiral runs from the centre out to the outer radius", async () => {
    const g = geo(await cookOne("shape/spiral", { count: 200, turns: 2, size: [9, 9, 9] }));
    const P = g.attrs.point.require("P");
    const radii = Array.from({ length: g.pointCount }, (_, i) => Math.hypot(P.get(i, 0), P.get(i, 2)));
    expect(Math.min(...radii)).toBeCloseTo(0, 5);
    expect(Math.max(...radii)).toBeCloseTo(9, 3);
  });
});

describe("fill/", () => {
  it("scatter-even honours the minimum distance", async () => {
    const g = geo(await cookOne("fill/scatter-even", { count: 3000, minDistance: 3 }));
    expect(g.pointCount).toBeGreaterThan(10);
    const P = g.attrs.point.require("P");
    for (let i = 0; i < g.pointCount; i++) {
      for (let j = i + 1; j < g.pointCount; j++) {
        const d = Math.hypot(P.get(i, 0) - P.get(j, 0), P.get(i, 2) - P.get(j, 2));
        expect(d).toBeGreaterThanOrEqual(3 - 1e-4);
      }
    }
  });

  it("scatter-by-density thins to roughly half and writes density", async () => {
    const g = geo(await cookOne("fill/scatter-by-density", { count: 4000 }));
    expect(g.pointCount).toBeGreaterThan(1200);
    expect(g.pointCount).toBeLessThan(2800);
    expect(g.attrs.point.names()).toContain("density");
    // The parameter attributes the recipe needed are gone again.
    expect(g.attrs.point.names()).not.toContain("freq");
    expect(g.attrs.point.names()).not.toContain("variant");
  });

  it("scatter-clustered multiplies the two counts", async () => {
    const g = geo(await cookOne("fill/scatter-clustered", { clusters: 7, perCluster: 5 }));
    expect(g.pointCount).toBe(35);
    const scale = g.attrs.point.require("scale");
    for (let i = 0; i < g.pointCount; i++) expect(scale.get(i, 0)).toBeCloseTo(1, 6);
  });

  it("volume-by-noise carves out part of the box and takes bounds from its input", async () => {
    const solid = geo(await cookOne("fill/volume-by-noise", { threshold: 0, cellSize: 4 }));
    const carved = geo(await cookOne("fill/volume-by-noise", { threshold: 0.6, cellSize: 4 }));
    expect(carved.pointCount).toBeGreaterThan(0);
    expect(carved.pointCount).toBeLessThan(solid.pointCount);
    // The fixture connects `in`, so the bounds came from the scatter's
    // own extents (a flat plane), not from the [0,0,0]..[32,32,32] params.
    const P = solid.attrs.point.require("P");
    for (let i = 0; i < solid.pointCount; i++) expect(Math.abs(P.get(i, 0))).toBeLessThan(20);
  });
});

describe("transform/", () => {
  it("displace-by-noise moves points on Y only, within the amount", async () => {
    const g = geo(await cookOne("transform/displace-by-noise", { amount: 5 }));
    expect(g.pointCount).toBe(FIXTURE_POINTS);
    const P = g.attrs.point.require("P");
    let moved = 0;
    for (let i = 0; i < g.pointCount; i++) {
      expect(Math.abs(P.get(i, 1))).toBeLessThanOrEqual(5 + 1e-4);
      if (Math.abs(P.get(i, 1)) > 1e-6) moved++;
    }
    expect(moved).toBeGreaterThan(250);
    expect(g.attrs.point.names()).not.toContain("amp");
  });

  it("snap-to-grid lands every point on a multiple of the pitch and keeps scale", async () => {
    const g = geo(await cookOne("transform/snap-to-grid", { cellSize: 5 }));
    const P = g.attrs.point.require("P");
    const scale = g.attrs.point.require("scale");
    for (let i = 0; i < g.pointCount; i++) {
      expect(P.get(i, 0) / 5).toBeCloseTo(Math.round(P.get(i, 0) / 5), 4);
      expect(P.get(i, 2) / 5).toBeCloseTo(Math.round(P.get(i, 2) / 5), 4);
      expect(scale.get(i, 0)).toBeCloseTo(1, 6);
    }
  });

  it("relax-spacing keeps the count and raises the nearest-neighbour distance", async () => {
    const before = geo(await cookOne("transform/relax-spacing", { strength: 0 }));
    const after = geo(await cookOne("transform/relax-spacing", { radius: 6, strength: 0.5 }));
    expect(after.pointCount).toBe(before.pointCount);
    const nearest = (g: ReturnType<typeof geo>): number => {
      const P = g.attrs.point.require("P");
      let sum = 0;
      for (let i = 0; i < g.pointCount; i++) {
        let best = Infinity;
        for (let j = 0; j < g.pointCount; j++) {
          if (i === j) continue;
          best = Math.min(best, Math.hypot(P.get(i, 0) - P.get(j, 0), P.get(i, 2) - P.get(j, 2)));
        }
        sum += best;
      }
      return sum / g.pointCount;
    };
    expect(nearest(after)).toBeGreaterThan(nearest(before));
  });
});

describe("compose/", () => {
  it("merge-tagged labels both sides under one attribute name", async () => {
    const g = geo(
      await cookOne("compose/merge-tagged", { kindAttr: "origin", nameA: "trees", nameB: "rocks" }),
    );
    expect(g.pointCount).toBe(FIXTURE_POINTS + 6);
    const origin = g.attrs.point.require("origin");
    expect(origin.type).toBe("string");
    expect(origin.getString(0, 0)).toBe("trees");
    expect(origin.getString(FIXTURE_POINTS + 5, 0)).toBe("rocks");
  });

  it("scatter-copies emits source x target points", async () => {
    const g = geo(await cookOne("compose/scatter-copies"));
    expect(g.pointCount).toBe(6 * FIXTURE_POINTS);
  });
});

describe("filter/", () => {
  it("filters never move a point and never leave a column behind", async () => {
    for (const name of [
      "filter/thin-by-density",
      "filter/mask-by-noise",
      "filter/inside-radius",
      "filter/by-neighbor-count",
    ]) {
      const g = geo(await cookOne(name));
      for (const scratch of ["freq", "variant", "threshold", "__center", "__radial", "__nbrCount"]) {
        expect(g.attrs.point.names(), `${name} left ${scratch} behind`).not.toContain(scratch);
      }
      expect(g.pointCount).toBeLessThanOrEqual(FIXTURE_POINTS);
    }
  });

  it("inside-radius keeps exactly what is within the radius, and inverts", async () => {
    const inside = geo(await cookOne("filter/inside-radius", { radius: 8, comparison: "le" }));
    const outside = geo(await cookOne("filter/inside-radius", { radius: 8, comparison: "ge" }));
    expect(inside.pointCount + outside.pointCount).toBe(FIXTURE_POINTS);
    const P = inside.attrs.point.require("P");
    for (let i = 0; i < inside.pointCount; i++) {
      expect(Math.hypot(P.get(i, 0), P.get(i, 1), P.get(i, 2))).toBeLessThanOrEqual(8 + 1e-5);
    }
  });

  it("inside-radius moves its centre through a field-valued param", async () => {
    const atOrigin = geo(await cookOne("filter/inside-radius", { radius: 5 }));
    const moved = geo(
      await cookOne("filter/inside-radius", {
        radius: 5,
        center: { fn: "constant", value: [12, 0, 12] },
      }),
    );
    expect(snapshotGeometry(moved)).not.toEqual(snapshotGeometry(atOrigin));
    const P = moved.attrs.point.require("P");
    for (let i = 0; i < moved.pointCount; i++) {
      expect(Math.hypot(P.get(i, 0) - 12, P.get(i, 2) - 12)).toBeLessThanOrEqual(5 + 1e-5);
    }
  });

  it("by-distance-to bands around the second cloud", async () => {
    const far = geo(await cookOne("filter/by-distance-to", { distance: 6, comparison: "ge" }));
    const near = geo(await cookOne("filter/by-distance-to", { distance: 6, comparison: "le" }));
    expect(far.pointCount + near.pointCount).toBe(FIXTURE_POINTS);
    expect(near.pointCount).toBeGreaterThan(0);
    expect(far.attrs.point.names()).not.toContain("__nearDist");
  });

  it("by-neighbor-count separates crowded from isolated", async () => {
    const crowded = geo(await cookOne("filter/by-neighbor-count", { radius: 3, count: 5, comparison: "ge" }));
    const lonely = geo(await cookOne("filter/by-neighbor-count", { radius: 3, count: 5, comparison: "lt" }));
    expect(crowded.pointCount + lonely.pointCount).toBe(FIXTURE_POINTS);
    expect(crowded.pointCount).toBeGreaterThan(0);
  });

  it("mask-by-noise is harder-edged than thin-by-density at the same frequency", async () => {
    // The claim both descriptions make, measured: a threshold mask leaves
    // its survivors clustered, a probabilistic thin scatters them.
    const masked = geo(await cookOne("filter/mask-by-noise", { frequency: 0.05 }));
    const thinned = geo(await cookOne("filter/thin-by-density", { frequency: 0.05 }));
    const spread = (g: ReturnType<typeof geo>): number => {
      const P = g.attrs.point.require("P");
      let sum = 0;
      for (let i = 0; i < g.pointCount; i++) {
        let best = Infinity;
        for (let j = 0; j < g.pointCount; j++) {
          if (i === j) continue;
          best = Math.min(best, Math.hypot(P.get(i, 0) - P.get(j, 0), P.get(i, 2) - P.get(j, 2)));
        }
        sum += best;
      }
      return sum / Math.max(1, g.pointCount);
    };
    expect(spread(masked)).toBeLessThan(spread(thinned));
  });
});

/**
 * A scatter dropped onto a TILTED plane through `place/drop-to-surface`.
 * `span` is the xz extent the points are scattered over (the plane reaches
 * about ±20 after the tilt, so a wider span produces genuine misses), and
 * `poison` stamps the primitive's internal flag name onto the input points
 * before they reach it.
 */
function tiltedDrop(
  span: readonly [number, number],
  count: number,
  poison: false | "bool" | "f32" = false,
  height = 30,
  exposeInput = false,
): SerializedGraph {
  const nodes: SerializedNode[] = [
    {
      id: "mesh",
      type: "meshPrimitive",
      params: {
        shape: "plane",
        size: [40, 0, 40],
        center: [0, 0, 0],
        orientation: "xz",
        subdivisions: [9, 1, 9],
        flip: false,
      },
    },
    {
      id: "tilt",
      type: "transformPoints",
      params: { scale: [1, 1, 1], rotateEuler: [17, 23, 11], translate: [0, 0, 0] },
    },
    {
      id: "pts",
      type: "pointScatterInBounds",
      params: {
        count,
        boundsMin: [span[0], height, span[0]],
        boundsMax: [span[1], height, span[1]],
        seed: 4,
      },
    },
    { id: "drop", type: "subgraph", params: {}, ref: { name: "place/drop-to-surface" } },
  ];
  const connections: SerializedConnection[] = [
    { from: ["mesh", "out"], to: ["tilt", "in"] },
    { from: ["tilt", "out"], to: ["drop", "surface"] },
  ];
  if (poison !== false) {
    nodes.push({
      id: "stamp",
      type: "setAttribute",
      params: { name: "__onSurface", domain: "point", type: poison, tupleSize: 1, value: 1 },
    });
    connections.push({ from: ["pts", "out"], to: ["stamp", "in"] });
    connections.push({ from: ["stamp", "out"], to: ["drop", "points"] });
  } else {
    connections.push({ from: ["pts", "out"], to: ["drop", "points"] });
  }
  const outputs = [{ id: "drop", pin: "out", name: "main_out" }];
  // The points as they were BEFORE the drop, so a test can compare each
  // survivor against its own input rather than against a summary of them.
  if (exposeInput) outputs.push({ id: "pts", pin: "out", name: "before" });
  return { formatVersion: 1, seed: 5, nodes, connections, outputs };
}

describe("place/", () => {
  it("on-surface stamps height and slope on a flat plane", async () => {
    const g = geo(await cookOne("place/on-surface", { count: 200 }));
    expect(g.pointCount).toBe(200);
    const height = g.attrs.point.require("height");
    const slope = g.attrs.point.require("slope");
    for (let i = 0; i < g.pointCount; i++) {
      expect(height.get(i, 0)).toBeCloseTo(0, 5);
      expect(slope.get(i, 0)).toBeCloseTo(0, 5);
    }
  });

  it("plantable keeps a flat plane and rejects an impossible slope limit", async () => {
    const flat = geo(await cookOne("place/plantable", { count: 200 }));
    expect(flat.pointCount).toBe(200);
    const none = geo(await cookOne("place/plantable", { count: 200, maxSlope: -1 }));
    expect(none.pointCount).toBe(0);
  });

  it("drop-to-surface lands the hits on the plane and discards the misses", async () => {
    const g = geo(await cookOne("place/drop-to-surface"));
    expect(g.pointCount).toBeGreaterThan(100);
    const P = g.attrs.point.require("P");
    for (let i = 0; i < g.pointCount; i++) expect(P.get(i, 1)).toBeCloseTo(0, 5);
    expect(g.attrs.point.names()).not.toContain("__onSurface");

    // Rays are forward-only, so a ray pointing away finds nothing at all.
    const up = geo(await cookOne("place/drop-to-surface", { direction: [0, 1, 0] }));
    expect(up.pointCount).toBe(0);
  });

  it("drop-to-surface casts exactly ONE ray, and the count is the assertion", () => {
    // This used to be five nodes: a marker stamped on the surface, a
    // transfer to bring it back as a hit flag, a SECOND raycast to move
    // the points, a filter and a cleanup. The second ray existed only to
    // recover what the first one already knew, and phase 37's mutation
    // testing found a real bug living in exactly that gap — reorder the
    // two passes and every test still passed until the surface was
    // TILTED, at which point snapping first left the forward-only second
    // ray starting a hair below the plane and discarding points that had
    // genuinely landed. `transferAttribute.hitAttr` reports the outcome of
    // the ray that did the moving, so there is nothing left to reorder.
    // A reintroduced second raycast fails here.
    const recipe = getRegisteredSubgraph("place/drop-to-surface").subgraph.graph;
    expect(recipe.nodes.map((n) => n.type)).toEqual([
      "transferAttribute",
      "filterByAttribute",
      "removeAttribute",
    ]);
    const rays = recipe.nodes.filter((n) => n.params.mapping === "raycast");
    expect(rays).toHaveLength(1);
    expect(rays[0]?.params.name).toBe("P");
    expect(rays[0]?.params.hitAttr).toBe("__onSurface");
  });

  it("drop-to-surface keeps the hits on a TILTED surface too", async () => {
    // The flat fixture above cannot see the failure this guards: a plane
    // at y = 0 gives hit positions exactly on it, so anything asked a
    // second time still hits at t = 0. Tilt the plane and a hit position
    // lands a hair BELOW it, where a forward-only ray finds nothing —
    // which is how the old two-pass recipe could discard points that had
    // genuinely landed (measured then: half of them). One ray cannot have
    // that failure, and this fixture is what says so: every point aimed
    // at the tilted plane must survive.
    const g = geo(await cookGraph(tiltedDrop([-8, 8], 1500)));
    expect(g.pointCount).toBe(1500);
  });

  it("drop-to-surface flags hit and miss correctly on a TILTED surface", async () => {
    // The all-hit fixture above cannot distinguish a correct flag from one
    // stuck at 1. Scatter wider than the tilted plane reaches so some rays
    // genuinely miss, then check the two halves separately: the survivors
    // must all lie on ONE plane (the tilted one), and some points must
    // have been discarded.
    const g = geo(await cookGraph(tiltedDrop([-40, 40], 2000)));
    expect(g.pointCount).toBeGreaterThan(100);
    expect(g.pointCount).toBeLessThan(2000);

    // Fit the plane from the survivors rather than re-deriving the euler
    // convention: three of them define it, and every other one must lie on
    // it. A point that never landed is still up at y = 30 and fails by a
    // mile.
    const P = g.attrs.point.require("P");
    const at = (i: number): number[] => P.getTuple(i);
    const [ax, ay, az] = at(0);
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 1; i < g.pointCount - 1 && nx === 0 && ny === 0 && nz === 0; i++) {
      const [bx, by, bz] = at(i);
      const [cx, cy, cz] = at(i + 1);
      const ux = bx - ax;
      const uy = by - ay;
      const uz = bz - az;
      const vx = cx - ax;
      const vy = cy - ay;
      const vz = cz - az;
      const px = uy * vz - uz * vy;
      const py = uz * vx - ux * vz;
      const pz = ux * vy - uy * vx;
      const len = Math.sqrt(px * px + py * py + pz * pz);
      if (len > 1e-3) {
        nx = px / len;
        ny = py / len;
        nz = pz / len;
      }
    }
    expect(Math.abs(nx) + Math.abs(ny) + Math.abs(nz)).toBeGreaterThan(0.5);
    // A tilt, not the flat plane the other fixture uses.
    expect(Math.abs(ny)).toBeLessThan(0.999);
    for (let i = 0; i < g.pointCount; i++) {
      const [x, y, z] = at(i);
      const d = nx * (x - ax) + ny * (y - ay) + nz * (z - az);
      expect(Math.abs(d), `survivor ${i} is off the tilted plane`).toBeLessThan(1e-2);
    }
  });

  it("drop-to-surface drops STRAIGHT DOWN: x and z survive the landing", async () => {
    // `direction` is [0,-1,0] and the param text says so — "drops straight
    // down" — but nothing was checking the two components that makes true.
    // A count cannot: tip the ray to [0,-1,0.08] and every point still
    // lands on the plane, in exactly the same number, about 2.4 units away
    // in z from where it was authored. That is a scatter silently sheared
    // sideways, and it is what a drop must never do — the whole reason to
    // drop rather than to re-scatter is that the xz layout is the answer
    // and only the height is unknown. The span is narrow enough that every
    // ray hits, so survivor i IS input i and they can be compared directly.
    const out = await cookGraph(tiltedDrop([-8, 8], 400, false, 30, true));
    const after = geo(out);
    const before = geo(out, "before");
    expect(after.pointCount).toBe(before.pointCount);
    const A = after.attrs.point.require("P");
    const B = before.attrs.point.require("P");
    for (let i = 0; i < after.pointCount; i++) {
      expect(A.get(i, 0), `point ${i} x`).toBe(B.get(i, 0));
      expect(A.get(i, 2), `point ${i} z`).toBe(B.get(i, 2));
      // ...and the drop did happen, or preserving xz is trivially true.
      expect(A.get(i, 1)).toBeLessThan(B.get(i, 1) - 1);
    }
  });

  it("drop-to-surface is unbounded by default: no drop is too long", async () => {
    // `maxDistance` is 0 and the param text says 0 means unlimited, but
    // every other fixture drops from y = 30, so any cap above that reads
    // as unlimited too — a default of 100 passed the whole suite. A drop
    // is a authored-height-agnostic operation: points parked far above the
    // terrain (a scatter in an unbounded level, a layout authored at a
    // round altitude) have to reach it. So: 4000 units up, same plane,
    // every point still lands.
    const g = geo(await cookGraph(tiltedDrop([-8, 8], 200, false, 4000)));
    expect(g.pointCount).toBe(200);
  });

  it("drop-to-surface's internal flag cannot be poisoned by the input's attributes", async () => {
    // The flag is an INTERNAL name, and an internal name is only internal
    // until an input happens to carry it. The old recipe transferred a
    // marker onto the points, so a destination already holding that name
    // with a matching type kept its own value on a miss — and a point that
    // hit nothing got to claim it had landed, staying in the output,
    // floating. `hitAttr` writes every point unconditionally, so stamping
    // the name on the input changes NOTHING: same count, same points.
    const clean = geo(await cookGraph(tiltedDrop([-40, 40], 2000)));
    const poisoned = geo(await cookGraph(tiltedDrop([-40, 40], 2000, "bool")));
    expect(poisoned.pointCount).toBe(clean.pointCount);
    expect(snapshotGeometry(poisoned)).toEqual(snapshotGeometry(clean));
    expect(poisoned.attrs.point.names()).not.toContain("__onSurface");

    // A collision under another SHAPE is the case the flag cannot absorb:
    // writing it would delete the input's own column. The primitive stops
    // and names the collision rather than cooking something plausible.
    await expect(cookGraph(tiltedDrop([-40, 40], 200, "f32"))).rejects.toThrow(
      /hitAttr "__onSurface" already exists on the input's point domain as f32/,
    );
  });

  it("align-to-surface writes rot from the transferred normal", async () => {
    const g = geo(await cookOne("place/align-to-surface"));
    expect(g.attrs.point.names()).toContain("normal");
    const rot = g.attrs.point.require("rot");
    // Up-facing normal with axis '+y' is the identity quaternion.
    expect(rot.get(0, 3)).toBeCloseTo(1, 5);
    const tipped = geo(await cookOne("place/align-to-surface", { axis: "+x" }));
    expect(tipped.attrs.point.require("rot").get(0, 3)).not.toBeCloseTo(1, 5);
  });
});

describe("write/", () => {
  it("height-slope needs a normal and reads it", async () => {
    const g = geo(await cookOne("write/height-slope"));
    expect(g.attrs.point.names()).toContain("height");
    expect(g.attrs.point.require("slope").get(0, 0)).toBeCloseTo(0, 5);
  });

  it("density-from-noise writes a normalized density and cleans up after itself", async () => {
    const g = geo(await cookOne("write/density-from-noise"));
    const density = g.attrs.point.require("density");
    for (let i = 0; i < g.pointCount; i++) {
      expect(density.get(i, 0)).toBeGreaterThanOrEqual(0);
      expect(density.get(i, 0)).toBeLessThanOrEqual(1);
    }
    expect(g.attrs.point.names()).not.toContain("freq");
  });

  it("random-scale writes ONE size per point, the same on all three axes", async () => {
    const g = geo(await cookOne("write/random-scale", { min: 0.5, max: 2 }));
    const scale = g.attrs.point.require("scale");
    const seen = new Set<number>();
    for (let i = 0; i < g.pointCount; i++) {
      const s = scale.get(i, 0);
      expect(scale.get(i, 1)).toBe(s);
      expect(scale.get(i, 2)).toBe(s);
      expect(s).toBeGreaterThanOrEqual(0.5 - 1e-5);
      expect(s).toBeLessThanOrEqual(2 + 1e-5);
      seen.add(s);
    }
    expect(seen.size).toBeGreaterThan(100); // it really is per point
  });

  it("random-yaw turns points around Y without a spatial pattern", async () => {
    const g = geo(await cookOne("write/random-yaw"));
    const rot = g.attrs.point.require("rot");
    const yaws = new Set<number>();
    for (let i = 0; i < g.pointCount; i++) yaws.add(rot.get(i, 1));
    expect(yaws.size).toBeGreaterThan(100);
  });

  it("color-from-attribute fits any scale into the ramp", async () => {
    const g = geo(await cookOne("write/color-from-attribute", { source: "density" }));
    const color = g.attrs.point.require("color");
    expect(color.tupleSize).toBe(4);
    for (let i = 0; i < g.pointCount; i++) {
      for (let c = 0; c < 3; c++) {
        expect(color.get(i, c)).toBeGreaterThanOrEqual(0);
        expect(color.get(i, c)).toBeLessThanOrEqual(1);
      }
      expect(color.get(i, 3)).toBe(1);
    }
    expect(g.attrs.point.names()).not.toContain("__t");
  });

  it("local-density writes a 0..1 density from crowding", async () => {
    const g = geo(await cookOne("write/local-density", { radius: 4 }));
    const density = g.attrs.point.require("density");
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < g.pointCount; i++) {
      min = Math.min(min, density.get(i, 0));
      max = Math.max(max, density.get(i, 0));
    }
    expect(min).toBeCloseTo(0, 5);
    expect(max).toBeCloseTo(1, 5);
    expect(g.attrs.point.names()).not.toContain("__nbrCount");
  });

  it("instances-by-species batches by asset and keeps the writer and reader in step", async () => {
    const outputs = await cookOne("write/instances-by-species", {
      assets: ["oak", "oak", "birch", "shrub"],
      speciesAttr: "kind",
    });
    const instances = (outputs.main_instances ?? []).find((i) => i.kind === "instances");
    expect(instances).toBeDefined();
    if (instances?.kind !== "instances") throw new Error("expected instances");
    expect(new Set(instances.batches.map((b) => b.assetId))).toEqual(
      new Set(["oak", "birch", "shrub"]),
    );
    expect(instances.batches.reduce((n, b) => n + b.count, 0)).toBe(FIXTURE_POINTS);
    const points = geo(outputs, "main_points");
    expect(points.attrs.point.names()).toContain("kind");
  });
});

// ---------------------------------------------------------------------------
// The curve set: the primitives that make, consume or measure against a path
// ---------------------------------------------------------------------------

/** Every primitive tagged `curve` — its output must carry topology. */
const CURVE_TAGGED = listSubgraphs()
  .filter((e) => (e.meta?.tags ?? []).includes("curve"))
  .map((e) => e.name)
  .sort();

/** The segment lengths of the first polyline of a geometry. */
function segmentLengths(g: ReturnType<typeof geo>): number[] {
  const P = g.attrs.point.require("P");
  const start = g.primVertexStart[0];
  const n = g.primVertexCount[0];
  const out: number[] = [];
  for (let k = 0; k + 1 < n; k++) {
    const a = g.vertexToPoint[start + k];
    const b = g.vertexToPoint[start + k + 1];
    out.push(Math.hypot(P.get(b, 0) - P.get(a, 0), P.get(b, 1) - P.get(a, 1), P.get(b, 2) - P.get(a, 2)));
  }
  return out;
}

/** The dot product of two tuple-3 point attributes at one point. */
function frameDot(g: ReturnType<typeof geo>, a: string, b: string, i: number): number {
  const A = g.attrs.point.require(a);
  const B = g.attrs.point.require(b);
  return A.get(i, 0) * B.get(i, 0) + A.get(i, 1) * B.get(i, 1) + A.get(i, 2) * B.get(i, 2);
}

/** Every distinct value of one attribute component, rounded to `places`. */
function distinct(g: ReturnType<typeof geo>, name: string, comp: number, places = 3): number[] {
  const a = g.attrs.point.require(name);
  const seen = new Set<number>();
  const scale = 10 ** places;
  for (let i = 0; i < g.pointCount; i++) seen.add(Math.round(a.get(i, comp) * scale) / scale);
  return [...seen].sort((x, y) => x - y);
}

describe("the curve set", () => {
  it("the `curve` tag means the output really is a path", async () => {
    // The tag an agent chains by. `shape/ring` and `shape/spiral` carried
    // it while emitting loose points, so ring -> a curve consumer was a
    // hard error the catalog had promised would work.
    expect(CURVE_TAGGED.length).toBeGreaterThanOrEqual(4);
    for (const name of ["shape/ring", "shape/spiral"]) expect(CURVE_TAGGED).not.toContain(name);
    for (const name of CURVE_TAGGED) {
      const g = geo(await cookOne(name));
      expect(g.primitiveCount, `${name} is tagged curve but emits no primitives`).toBeGreaterThan(0);
      expect(g.vertexToPoint.length, `${name} is tagged curve but has no vertices`).toBeGreaterThan(0);
    }
  });

  it("path-loop closes structurally, with no duplicated seam point", async () => {
    const g = geo(await cookOne("shape/path-loop", { count: 12, size: [10, 10, 10] }));
    expect(g.pointCount).toBe(12);
    expect(g.primitiveCount).toBe(1);
    // 13 vertices over 12 points: the closure is the trailing vertex.
    expect(g.primVertexCount[0]).toBe(13);
    expect(g.vertexToPoint[12]).toBe(g.vertexToPoint[0]);
    const P = g.attrs.point.require("P");
    for (let i = 0; i < g.pointCount; i++) {
      expect(Math.hypot(P.get(i, 0), P.get(i, 2))).toBeCloseTo(10, 3);
    }
    // Even spacing round the loop, including across the seam.
    const seg = segmentLengths(g);
    expect(Math.max(...seg) - Math.min(...seg)).toBeLessThan(1e-4);
  });

  it("path-loop feeds a curve consumer where the ring cannot", async () => {
    // The whole point of the tag fix, cooked from JSON both ways.
    const chain = (source: string): SerializedGraph => ({
      formatVersion: 1,
      seed: 11,
      nodes: [
        { id: "src", type: "subgraph", params: { count: 16 }, ref: { name: source } },
        { id: "along", type: "subgraph", params: { count: 8 }, ref: { name: "place/along-curve" } },
      ],
      connections: [{ from: ["src", "out"], to: ["along", "curve"] }],
      outputs: [{ id: "along", pin: "out", name: "main_out" }],
    });
    const g = geo(await cookGraph(chain("shape/path-loop")));
    expect(g.pointCount).toBe(8);
    await expect(cookGraph(chain("shape/ring"))).rejects.toThrow(/no polyline primitives/);
  });

  it("path-meander wanders, stays a path, and comes out evenly spaced", async () => {
    const g = geo(await cookOne("shape/path-meander", { count: 40, wander: 0.2 }));
    expect(g.pointCount).toBe(40);
    expect(g.primitiveCount).toBe(1);
    expect(g.primVertexCount[0]).toBe(40); // open: no trailing vertex
    const P = g.attrs.point.require("P");
    let maxZ = 0;
    for (let i = 0; i < g.pointCount; i++) maxZ = Math.max(maxZ, Math.abs(P.get(i, 2)));
    expect(maxZ).toBeGreaterThan(1); // it really left the straight line

    // The resample is the content: displacing a line sideways stretches
    // the segments where the wander is steep. Measured on this exact
    // recipe with the resample removed, the longest segment is 1.33x the
    // shortest at this wander (and 2.4x at wander 0.5); resampled it is
    // 1.05x. The residual is not unevenness — the samples are evenly
    // spaced along the ARC, and a chord that cuts a corner is shorter
    // than the arc it spans.
    const seg = segmentLengths(g);
    expect(Math.max(...seg) / Math.min(...seg)).toBeLessThan(1.06);

    // Fresh points: the three parameter attributes never reach the output,
    // and the sampler's own columns are there instead.
    for (const scratch of ["freq", "variant", "amp"]) {
      expect(g.attrs.point.names()).not.toContain(scratch);
    }
    expect(g.attrs.point.names()).toContain("tangent");
    expect(g.attrs.point.names()).toContain("curveU");
  });

  it("path-meander at wander 0 is a straight line of the requested length", async () => {
    const g = geo(await cookOne("shape/path-meander", { count: 20, wander: 0, size: [60, 1, 60] }));
    const P = g.attrs.point.require("P");
    for (let i = 0; i < g.pointCount; i++) expect(P.get(i, 2)).toBeCloseTo(0, 5);
    expect(P.get(0, 0)).toBeCloseTo(-30, 4);
    expect(P.get(g.pointCount - 1, 0)).toBeCloseTo(30, 4);
  });

  it("path-meander strays by the amount `wander` advertises, and never doubles back", async () => {
    // Descriptions are the agent API, so the numbers `wander` quotes are
    // asserted rather than left to drift. The knob scales a NOMINAL +/-1
    // noise term: four octaves of normalized fBm sampled along a single
    // line only cover part of that range, so the peak deviation lands near
    // 0.22 * wander * size.z. That shortfall is the catalog's shared noise
    // convention — transform/displace-by-noise builds the same term the
    // same way and reaches ~0.4 of nominal over a 2D spread — not a
    // scaling bug here. What an agent needs is that it is STATED and that
    // it is linear, and both are pinned below.
    const peak = async (params: Record<string, unknown>) => {
      const g = geo(await cookOne("shape/path-meander", { count: 200, ...params }));
      const P = g.attrs.point.require("P");
      let m = 0;
      for (let i = 0; i < g.pointCount; i++) m = Math.max(m, Math.abs(P.get(i, 2)));
      return m;
    };

    const base = await peak({ wander: 0.5, size: [80, 1, 60] });
    expect(base / (0.5 * 60)).toBeCloseTo(0.2177, 3);
    // Exactly linear in `wander` and in size.z: a doubled knob doubles the
    // stray, which is what makes the figure above predictive at all.
    expect(await peak({ wander: 1, size: [80, 1, 60] })).toBeCloseTo(2 * base, 4);
    expect(await peak({ wander: 0.5, size: [80, 1, 120] })).toBeCloseTo(2 * base, 4);
    // The two strays the description quotes for the default size [40,1,40].
    const gentle = await peak({ wander: 0.15 });
    expect(gentle).toBeGreaterThan(1.25);
    expect(gentle).toBeLessThan(1.35);
    const loose = await peak({ wander: 0.5 });
    expect(loose).toBeGreaterThan(4.3);
    expect(loose).toBeLessThan(4.45);
    // ...and the inverse rule it gives: wander ~ 4.6 * f peaks at f * size.z.
    expect((await peak({ wander: 4.6 * 0.25, size: [80, 1, 60] })) / 60).toBeCloseTo(0.25, 2);

    // The band the description puts on that 0.22 as `frequency` and
    // `variant` move the noise window. These are the measured extremes:
    // 0.135 at variant 7, 0.309 at variant 13.3, 0.152 at frequency 0.5.
    for (const params of [
      { frequency: 0.5 },
      { frequency: 12 },
      { variant: 7 },
      { variant: 13.3 },
      { variant: 100 },
    ]) {
      const ratio = (await peak({ wander: 0.5, size: [80, 1, 60], ...params })) / 30;
      expect(ratio, `${JSON.stringify(params)} left the documented band`).toBeGreaterThan(0.13);
      expect(ratio, `${JSON.stringify(params)} left the documented band`).toBeLessThan(0.31);
    }

    // The description's other claim, and the reason no amount of amplitude
    // could ever buy the "doubles back" the old wording promised: the
    // wander is sideways only, so the path is a height field along X.
    for (const wander of [0.5, 2, 10]) {
      const g = geo(await cookOne("shape/path-meander", { count: 200, wander, size: [80, 1, 60] }));
      const P = g.attrs.point.require("P");
      for (let i = 1; i < g.pointCount; i++) {
        expect(P.get(i, 0), `wander ${wander} reversed along X`).toBeGreaterThan(P.get(i - 1, 0));
      }
    }
  });

  it("along-curve spaces points by arc length and faces them along the curve", async () => {
    const byCount = geo(await cookOne("place/along-curve", { count: 5 }));
    expect(byCount.pointCount).toBe(5);
    const P = byCount.attrs.point.require("P");
    for (let i = 0; i < 5; i++) {
      expect(P.get(i, 0)).toBeCloseTo(-CURVE_HALF_LENGTH + i * 10, 4);
      expect(P.get(i, 2)).toBeCloseTo(0, 5);
    }
    // Every tangent is +X on a straight curve, and every rot follows it.
    const tangent = byCount.attrs.point.require("tangent");
    const rot = byCount.attrs.point.require("rot");
    for (let i = 0; i < 5; i++) {
      expect(tangent.get(i, 0)).toBeCloseTo(1, 5);
      expect(tangent.get(i, 2)).toBeCloseTo(0, 5);
      expect(rot.get(i, 3)).not.toBeCloseTo(1, 3); // not the identity
      expect(rot.get(i, 3)).toBeCloseTo(rot.get(0, 3), 6);
    }
    expect(byCount.attrs.point.names()).toContain("curveU");
    // Still a path: it can be resampled again.
    expect(byCount.primitiveCount).toBe(1);

    // 'spacing' steps in world units and always lands on the far end.
    const bySpacing = geo(await cookOne("place/along-curve", { mode: "spacing", spacing: 5 }));
    expect(bySpacing.pointCount).toBe(9);
    const Q = bySpacing.attrs.point.require("P");
    expect(Q.get(8, 0)).toBeCloseTo(CURVE_HALF_LENGTH, 4);
  });

  it("orient-along-path keeps the points and their attributes, and orients them", async () => {
    // The claim that separates it from place/along-curve, measured: a
    // column written on the path's own points survives being oriented.
    const graph: SerializedGraph = {
      formatVersion: 1,
      seed: 3,
      nodes: [
        {
          id: "line",
          type: "pointLine",
          params: { count: 7, start: [-12, 0, 0], end: [12, 0, 0], includeEnd: true },
        },
        {
          id: "mark",
          type: "setAttribute",
          params: {
            name: "post",
            domain: "point",
            type: "f32",
            tupleSize: 1,
            value: { fn: "component", args: [{ fn: "position" }], index: 0 },
          },
        },
        { id: "path", type: "pointsToPath", params: { closed: false, groupAttr: "", orderAttr: "" } },
        { id: "orient", type: "subgraph", params: {}, ref: { name: "write/orient-along-path" } },
      ],
      connections: [
        { from: ["line", "out"], to: ["mark", "in"] },
        { from: ["mark", "out"], to: ["path", "in"] },
        { from: ["path", "out"], to: ["orient", "in"] },
      ],
      outputs: [{ id: "orient", pin: "out", name: "main_out" }],
    };
    const g = geo(await cookGraph(graph));
    expect(g.pointCount).toBe(7); // nothing resampled, nothing dropped
    expect(g.primitiveCount).toBe(1); // and it is still a path
    const P = g.attrs.point.require("P");
    const post = g.attrs.point.require("post");
    const tangent = g.attrs.point.require("tangent");
    for (let i = 0; i < g.pointCount; i++) {
      expect(P.get(i, 0)).toBeCloseTo(-12 + i * 4, 4); // P untouched
      expect(post.get(i, 0)).toBeCloseTo(-12 + i * 4, 4); // the column survived
      expect(tangent.get(i, 0)).toBeCloseTo(1, 5); // including at both ends
    }
    // The same direction through the same orienting node as place/along-curve.
    const along = geo(await cookOne("place/along-curve", { count: 5 }));
    for (let c = 0; c < 4; c++) {
      expect(g.attrs.point.require("rot").get(0, c)).toBeCloseTo(
        along.attrs.point.require("rot").get(0, c),
        6,
      );
    }
  });

  it("curve-frame writes three perpendicular unit axes and moves nothing", async () => {
    const g = geo(await cookOne("write/curve-frame"));
    expect(g.pointCount).toBe(CURVE_POINTS); // nothing resampled
    expect(g.primitiveCount).toBe(1); // and it is still a path
    const P = g.attrs.point.require("P");
    for (let i = 0; i < g.pointCount; i++) {
      expect(P.get(i, 0)).toBeCloseTo(-CURVE_HALF_LENGTH + i * 5, 4);
    }
    // Orthonormal by construction rather than nearly so — the claim the
    // binormal ships as a column to keep true.
    for (const name of ["tangent", "curveNormal", "curveBinormal"]) {
      const a = g.attrs.point.require(name);
      for (let i = 0; i < g.pointCount; i++) {
        expect(Math.hypot(a.get(i, 0), a.get(i, 1), a.get(i, 2)), `${name} is not unit`).toBeCloseTo(1, 5);
      }
    }
    for (let i = 0; i < g.pointCount; i++) {
      expect(frameDot(g, "tangent", "curveNormal", i)).toBeCloseTo(0, 5);
      expect(frameDot(g, "tangent", "curveBinormal", i)).toBeCloseTo(0, 5);
      expect(frameDot(g, "curveNormal", "curveBinormal", i)).toBeCloseTo(0, 5);
    }
    // The name knobs really move the columns, which is what makes the
    // description's warning about calling one of them 'normal' actionable.
    const renamed = geo(await cookOne("write/curve-frame", { normalName: "spineNormal" }));
    expect(renamed.attrs.point.names()).toContain("spineNormal");
    expect(renamed.attrs.point.names()).not.toContain("curveNormal");
  });

  it("gather-on-path clumps onto its bin centres without losing a point", async () => {
    const even = geo(await cookOne("transform/gather-on-path", { amount: 0 }));
    const clumped = geo(await cookOne("transform/gather-on-path", { bins: 4, amount: 1 }));
    // The family contract: P changes, the count does not.
    expect(even.pointCount).toBe(SAMPLED_CURVE_POINTS);
    expect(clumped.pointCount).toBe(SAMPLED_CURVE_POINTS);
    expect(clumped.primitiveCount).toBe(1); // and it is still a path
    for (const scratch of ["__bins", "__gather"]) {
      expect(clumped.attrs.point.names(), `left ${scratch} behind`).not.toContain(scratch);
    }
    // amount 0 is the identity: the resample's own even spacing survives.
    const E = even.attrs.point.require("P");
    const step = (2 * CURVE_HALF_LENGTH) / (SAMPLED_CURVE_POINTS - 1);
    for (let i = 0; i < even.pointCount; i++) {
      expect(E.get(i, 0)).toBeCloseTo(-CURVE_HALF_LENGTH + i * step, 4);
    }
    // amount 1 collapses each bin onto its centre: four clumps at
    // (i + 0.5) / 4 of a 40-unit curve, plus the far endpoint, whose own
    // bin centre lies past the end and clamps back onto it.
    expect(distinct(clumped, "P", 0)).toEqual([-15, -5, 5, 15, 20]);
    // ...and the parameterization follows the points rather than the
    // places they came from, so a second gather bins the new positions.
    expect(distinct(clumped, "curveU", 0)).toEqual([0.125, 0.375, 0.625, 0.875, 1]);
  });

  it("radial-on-curve fans the roll around the curve where along-curve cannot", async () => {
    const fan = geo(await cookOne("place/radial-on-curve", { count: 12 }));
    expect(fan.pointCount).toBe(12);
    expect(fan.primitiveCount).toBe(1); // still a path, still resamplable
    expect(fan.attrs.point.names()).not.toContain("__spread");
    for (const name of ["tangent", "curveU", "curveNormal", "curveBinormal", "rot"]) {
      expect(fan.attrs.point.names()).toContain(name);
    }
    // The whole claim, on a STRAIGHT curve where a constant up cannot be
    // blamed for the difference: every tangent is +X, so place/along-curve
    // gives all twelve points the same rot and this one gives them twelve.
    expect(distinct(fan, "rot", 3, 6).length).toBeGreaterThan(6);
    const along = geo(await cookOne("place/along-curve", { count: 12 }));
    expect(distinct(along, "rot", 3, 6)).toHaveLength(1);
    // spread 0 closes the fan back down to one roll — the ribbon case.
    const ribbon = geo(await cookOne("place/radial-on-curve", { count: 12, spread: 0 }));
    expect(distinct(ribbon, "rot", 3, 6)).toHaveLength(1);
  });

  it("by-distance-to-curve bands around the curve, and the densification matters", async () => {
    const near = geo(await cookOne("filter/by-distance-to-curve", { distance: 4, comparison: "le", resolution: 0.25 }));
    const far = geo(await cookOne("filter/by-distance-to-curve", { distance: 4, comparison: "ge", resolution: 0.25 }));
    expect(near.pointCount + far.pointCount).toBe(FIXTURE_POINTS);
    expect(near.pointCount).toBeGreaterThan(0);
    expect(near.attrs.point.names()).not.toContain("__nearDist");
    const P = near.attrs.point.require("P");
    for (let i = 0; i < near.pointCount; i++) {
      // The curve is the X axis, so the true distance is |z|.
      expect(Math.abs(P.get(i, 2))).toBeLessThanOrEqual(4 + 1e-3);
    }

    // Coarse sampling measures to points ON the curve that are up to half
    // a step away along it, so it over-states every distance and eats into
    // the band. That is the error the primitive exists to avoid, and it is
    // invisible in a count unless it is compared.
    const coarse = geo(
      await cookOne("filter/by-distance-to-curve", { distance: 4, comparison: "le", resolution: 6 }),
    );
    expect(coarse.pointCount).toBeLessThan(near.pointCount);
  });
});

// ---------------------------------------------------------------------------
// The numbers the catalog quotes
// ---------------------------------------------------------------------------

/**
 * Descriptions are the agent API, so every magnitude a param description
 * PROMISES is asserted here rather than left to drift. A documented number
 * with no test is the next thing to go stale, and the failure mode is
 * silent: the recipe still cooks, the catalog still reads well, and an
 * agent plans against a figure that stopped being true.
 *
 * The recurring theme is the catalog's shared noise convention. Four
 * octaves of Perlin fBm are normalized against their THEORETICAL sum
 * range, and the realized values only cover the middle ~0.42 of it —
 * measured 0.29..0.71 on a wide 2D spread, widening toward 0.26..0.76 with
 * far more samples. Everything built on `amp * remap(fbm01, 0,1,-1,1)`
 * therefore delivers about 0.41 of its nominal amplitude, and every 0..1
 * threshold over the same field has all of its travel between about 0.32
 * and 0.68. That is a convention, not a bug in any one recipe, and the job
 * of these tests is to hold the STATED figures to the measured ones.
 */

/** A driver graph with explicit per-pin feeds, for laws the fixtures cannot reach. */
function lawGraph(
  name: string,
  params: Record<string, unknown>,
  feeds: Record<string, (id: string) => Source> = {},
): SerializedGraph {
  const entry = getRegisteredSubgraph(name);
  const nodes: SerializedNode[] = [];
  const connections: SerializedConnection[] = [];
  const outputs: { id: string; pin: string; name: string }[] = [];
  for (const pin of entry.subgraph.inputs) {
    const make = feeds[pin.name];
    // A pin with no feed is left unconnected on purpose: it is how
    // `fill/volume-by-noise` is measured against its own bounds params.
    if (make === undefined) continue;
    const source = make(`src_${pin.name}`);
    nodes.push(...source.nodes);
    connections.push(...(source.connections ?? []));
    connections.push({ from: source.out, to: ["main", pin.name] });
  }
  nodes.push({ id: "main", type: "subgraph", params, ref: { name } });
  for (const pin of entry.subgraph.outputs) {
    outputs.push({ id: "main", pin: pin.name, name: `main_${pin.name}` });
  }
  return { formatVersion: 1, seed: 2026, nodes, connections, outputs };
}

async function cookLaw(
  name: string,
  params: Record<string, unknown>,
  feeds: Record<string, (id: string) => Source> = {},
) {
  return geo(await cookGraph(lawGraph(name, params, feeds)));
}

/** A scatter of any size over any box — the sample the noise laws need. */
function box(count: number, lo: readonly number[], hi: readonly number[], seed = 7) {
  return (id: string): Source => ({
    nodes: [
      { id, type: "pointScatterInBounds", params: { count, boundsMin: [...lo], boundsMax: [...hi], seed } },
    ],
    out: [id, "out"],
  });
}

/** Points carrying a normal tilted `deg` degrees off vertical. */
function tiltedNormal(deg: number) {
  const r = (deg * Math.PI) / 180;
  return (id: string): Source => ({
    nodes: [
      { id: `${id}_p`, type: "pointLine", params: { count: 4, start: [0, 3, 0], end: [1, 3, 0], includeEnd: true } },
      {
        id,
        type: "setAttribute",
        params: {
          name: "normal",
          domain: "point",
          type: "f32",
          tupleSize: 3,
          value: { fn: "constant", value: [Math.sin(r), Math.cos(r), 0] },
        },
      },
    ],
    connections: [{ from: [`${id}_p`, "out"], to: [id, "in"] }],
    out: [id, "out"],
  });
}

/** Every value of one attribute component, in point order. */
function column(g: ReturnType<typeof geo>, name: string, comp = 0): number[] {
  const a = g.attrs.point.require(name);
  const out: number[] = [];
  for (let i = 0; i < g.pointCount; i++) out.push(a.get(i, comp));
  return out;
}

/** The wide 2D spread the noise laws are quoted against. */
const SPREAD = box(20000, [-300, 0, -300], [300, 0, 300]);

describe("the magnitudes the descriptions promise", () => {
  it("displace-by-noise reaches ~0.41 of `amount`, not `amount`", async () => {
    // The description's central claim, and the reason it no longer says
    // "points move between -amount and +amount": the knob scales a term
    // whose NOMINAL range is +/-1, and normalized fBm only covers the
    // middle of it.
    const peak = async (params: Record<string, unknown>, cloud = SPREAD) => {
      const ys = column(await cookLaw("transform/displace-by-noise", params, { in: cloud }), "P", 1);
      const amount = (params.amount as number | undefined) ?? 4;
      return {
        peak: Math.max(...ys.map(Math.abs)) / amount,
        mean: ys.reduce((a, b) => a + b, 0) / ys.length / amount,
      };
    };
    const base = await peak({ amount: 4 });
    expect(base.peak).toBeCloseTo(0.4224, 3);
    // Exactly linear in `amount`: the quoted 0.41 is predictive only
    // because a doubled knob doubles every displacement.
    expect((await peak({ amount: 1 })).peak).toBeCloseTo(base.peak, 6);
    expect((await peak({ amount: 40 })).peak).toBeCloseTo(base.peak, 6);
    // "the average height does not move", within 1% of `amount`.
    expect(Math.abs(base.mean)).toBeLessThan(0.01);
    // The band the description puts on that 0.41 as `frequency` moves the
    // sampled window: measured 0.425 at 0.01 and 0.487 at 1.
    for (const frequency of [0.01, 0.05, 0.2, 1]) {
      const p = (await peak({ amount: 4, frequency })).peak;
      expect(p, `frequency ${frequency} left the documented band`).toBeGreaterThan(0.38);
      expect(p, `frequency ${frequency} left the documented band`).toBeLessThan(0.49);
    }
    // ...and the inverse rule it gives: amount ~ 2.4 * h peaks at h.
    const g = await cookLaw("transform/displace-by-noise", { amount: 2.4 * 10 }, { in: SPREAD });
    expect(Math.max(...column(g, "P", 1).map(Math.abs))).toBeCloseTo(10, 0);

    // The description's sharpest claim, and the one an agent is most
    // likely to be burnt by: what sets the coverage is how much FIELD the
    // cloud spans (extent x frequency), not how many points it holds. A
    // 30-unit patch at the default frequency spans about one period and
    // reaches 0.25 of `amount` at every count.
    const patch = async (count: number) =>
      (await peak({ amount: 4 }, box(count, [-15, 0, -15], [15, 0, 15]))).peak;
    for (const count of [100, 1000, 20000]) {
      const p = await patch(count);
      expect(p, `${count} points on a 30-unit patch`).toBeGreaterThan(0.24);
      expect(p, `${count} points on a 30-unit patch`).toBeLessThan(0.27);
    }
  });

  it("mask-by-noise spends its whole travel between 0.32 and 0.68", async () => {
    // The five figures the `threshold` description quotes, and the two
    // dead zones that made the old "1 keeps nothing and 0 keeps
    // everything" wording useless for planning.
    const kept = async (threshold: number) =>
      (await cookLaw("filter/mask-by-noise", { threshold }, { in: SPREAD })).pointCount / 20000;
    for (const [threshold, fraction] of [
      [0.42, 0.89],
      [0.46, 0.75],
      [0.5, 0.5],
      [0.55, 0.23],
      [0.59, 0.09],
    ] as const) {
      expect(await kept(threshold), `threshold ${threshold}`).toBeCloseTo(fraction, 1);
    }
    // The ends: everything below 0.32, nothing above 0.68 — so a
    // threshold of 0.8 does NOT keep a fifth of the points.
    expect(await kept(0.32)).toBeGreaterThan(0.99);
    expect(await kept(0.2)).toBe(1);
    expect(await kept(0.68)).toBeLessThan(0.01);
    expect(await kept(0.8)).toBe(0);
  });

  it("volume-by-noise carves over the same narrow threshold band", async () => {
    // Same field read in 3D, and the description's warning that the band's
    // CENTRE moves: a 32-unit box at frequency 0.05 samples a small window
    // of the field, so 0.5 keeps two thirds here rather than half.
    const kept = async (threshold: number) => (await cookLaw("fill/volume-by-noise", { threshold })).pointCount;
    const solid = await kept(0.3);
    expect(solid).toBeGreaterThan(4000);
    for (const [threshold, fraction] of [
      [0.45, 0.85],
      [0.5, 0.65],
      [0.55, 0.41],
      [0.6, 0.18],
    ] as const) {
      expect((await kept(threshold)) / solid, `threshold ${threshold}`).toBeCloseTo(fraction, 1);
    }
    expect(await kept(0.7)).toBe(0);
  });

  it("volume-by-noise costs 8x per halving only in three dimensions", async () => {
    // floor(extent / cellSize) per axis, at least 1, multiplied — and the
    // two quoted count series, which differ for exactly that reason.
    // Bounds from the PARAMS divide evenly and give the clean powers.
    const exact: number[] = [];
    for (const cellSize of [8, 4, 2, 1]) {
      exact.push(
        (
          await cookLaw("fill/volume-by-noise", {
            cellSize,
            threshold: 0,
            boundsMin: [0, 0, 0],
            boundsMax: [32, 32, 32],
          })
        ).pointCount,
      );
    }
    expect(exact).toEqual([64, 512, 4096, 32768]);
    // Bounds taken from a SCATTER land just under 32, so every axis loses
    // its last whole cell and the counts drop a step: 3, 7, 15, 31 per axis.
    const cube = { in: box(2000, [-16, -16, -16], [16, 16, 16]) };
    const counts: number[] = [];
    for (const cellSize of [8, 4, 2, 1]) {
      counts.push((await cookLaw("fill/volume-by-noise", { cellSize, threshold: 0 }, cube)).pointCount);
    }
    expect(counts).toEqual([27, 343, 3375, 29791]);
    // The ratio approaches 8 from above as the missing cell stops mattering.
    expect((counts[3] as number) / (counts[2] as number)).toBeGreaterThan(8);
    expect((counts[3] as number) / (counts[2] as number)).toBeLessThan(9);
    // Over a FLAT region the same halving costs four times, not eight.
    const flat = { in: box(2000, [-16, 0, -16], [16, 0, 16]) };
    const coarse = (await cookLaw("fill/volume-by-noise", { cellSize: 2, threshold: 0 }, flat)).pointCount;
    const fine = (await cookLaw("fill/volume-by-noise", { cellSize: 1, threshold: 0 }, flat)).pointCount;
    expect(fine / coarse).toBeGreaterThan(3.8);
    expect(fine / coarse).toBeLessThan(4.4);
  });

  it("volume-by-noise jitter never leaves its own cell, at any jitter", async () => {
    // The primitive's structural promise, and the one an agent builds
    // non-overlap on: at jitter 1 a point reaches the FACE of its cell and
    // stops. What the "0.53 * cellSize" measurement really showed is that
    // the cell is not always the `cellSize` asked for — the grid divides
    // the extent into whole cells, so the cell is only `cellSize` when the
    // extent is a multiple of it, and wider otherwise.
    const measure = async (params: Record<string, unknown>, feeds: Record<string, (id: string) => Source>) => {
      const lattice = await cookLaw("fill/volume-by-noise", { ...params, threshold: 0, jitter: 0 }, feeds);
      const A = lattice.attrs.point.require("P");
      // The cell the grid actually used, PER AXIS: the step between lattice
      // nodes. The three differ whenever the bounds are not a cube.
      const cell = [0, 1, 2].map((axis) => {
        const vs = [...new Set(column(lattice, "P", axis))].sort((a, b) => a - b);
        return (vs[1] as number) - (vs[0] as number);
      });
      const at = async (jitter: number) => {
        const g = await cookLaw("fill/volume-by-noise", { ...params, threshold: 0, jitter }, feeds);
        const B = g.attrs.point.require("P");
        const worst = [0, 0, 0];
        for (let i = 0; i < g.pointCount; i++) {
          for (let c = 0; c < 3; c++) worst[c] = Math.max(worst[c] as number, Math.abs(B.get(i, c) - A.get(i, c)));
        }
        // Containment is per point and per axis, not just at the extreme:
        // every point is still inside the cell it was generated in.
        for (let c = 0; c < 3; c++) {
          expect(worst[c] as number, `jitter ${jitter} left its cell on axis ${c}`).toBeLessThan(
            (cell[c] as number) / 2,
          );
        }
        return { worst, peak: Math.max(...worst) };
      };
      return { cell, count: lattice.pointCount, at };
    };

    // An extent that divides evenly: the cell IS `cellSize`, and jitter 1
    // reaches half of the number typed, to within a rounding error.
    const even = await measure({ cellSize: 2, boundsMin: [0, 0, 0], boundsMax: [32, 32, 32] }, {});
    for (const c of even.cell) expect(c).toBeCloseTo(2, 5);
    expect((await even.at(1)).peak).toBeCloseTo(1, 4);
    expect((await even.at(0.5)).peak).toBeCloseTo(0.5, 4);

    // Bounds from a scatter: the extent falls just short of 32, 15 whole
    // cells of 2.13 fit, and half of THAT is the 1.066 measured before —
    // 0.53 of `cellSize`, but still exactly half a cell.
    const cube = { in: box(2000, [-16, -16, -16], [16, 16, 16]) };
    const odd = await measure({ cellSize: 2 }, cube);
    for (const c of odd.cell) expect(c).toBeGreaterThan(2);
    const hard = await odd.at(1);
    expect(hard.peak).toBeCloseTo(1.066, 2);
    expect(hard.peak).toBeGreaterThan(1); // past half of `cellSize`...
    // ...never past half a cell, on any axis.
    for (let c = 0; c < 3; c++) {
      expect((hard.worst[c] as number) / (odd.cell[c] as number)).toBeCloseTo(0.5, 3);
    }
    // Linear in jitter.
    expect((await odd.at(0.5)).peak / hard.peak).toBeCloseTo(0.5, 6);

    // And the consequence the guarantee exists for: disjoint cells mean
    // neighbours along an axis keep their order and stay at least
    // (1 - jitter) * cell apart, however hard the grid is jittered.
    const lattice = await cookLaw(
      "fill/volume-by-noise",
      { cellSize: 4, threshold: 0, jitter: 0, boundsMin: [0, 0, 0], boundsMax: [32, 32, 32] },
      {},
    );
    const rows = new Map<string, number[]>();
    const L = lattice.attrs.point.require("P");
    for (let i = 0; i < lattice.pointCount; i++) {
      const key = `${L.get(i, 1)},${L.get(i, 2)}`;
      const row = rows.get(key) ?? [];
      row.push(i);
      rows.set(key, row);
    }
    for (const jitter of [0.5, 1]) {
      const g = await cookLaw(
        "fill/volume-by-noise",
        { cellSize: 4, threshold: 0, jitter, boundsMin: [0, 0, 0], boundsMax: [32, 32, 32] },
        {},
      );
      const J = g.attrs.point.require("P");
      let closest = Infinity;
      for (const row of rows.values()) {
        const sorted = [...row].sort((a, b) => L.get(a, 0) - L.get(b, 0));
        for (let k = 1; k < sorted.length; k++) {
          closest = Math.min(closest, J.get(sorted[k] as number, 0) - J.get(sorted[k - 1] as number, 0));
        }
      }
      expect(closest, `jitter ${jitter} let two neighbours cross`).toBeGreaterThan(0);
      expect(closest, `jitter ${jitter} broke the (1 - jitter) * cell floor`).toBeGreaterThanOrEqual(
        (1 - jitter) * 4 - 1e-4,
      );
    }
  });

  it("scatter-even approaches its packing ceiling from below", async () => {
    // The `count` description's whole point: the survivor count keeps
    // climbing long after over-scattering looks sufficient, so "however
    // many fit" was never reached at the default.
    const n = async (count: number) =>
      (
        await cookLaw("fill/scatter-even", {
          count,
          minDistance: 2,
          boundsMin: [0, 0, 0],
          boundsMax: [50, 0, 50],
        })
      ).pointCount;
    const quoted = [374, 416, 436, 444];
    expect([await n(4000), await n(16000), await n(64000), await n(200000)]).toEqual(quoted);
    // The ceiling: ~0.7 * area / minDistance^2 = ~437 here, and the
    // default `count` reaches 85% of it.
    const ceiling = (0.7 * 50 * 50) / (2 * 2);
    expect((quoted[3] as number) / ceiling).toBeGreaterThan(0.98);
    expect((quoted[0] as number) / (quoted[3] as number)).toBeCloseTo(0.85, 1);
    // ...and the inverse square in `minDistance`: four times the spacing
    // squared leaves a quarter of the room.
    const wide = await cookLaw("fill/scatter-even", {
      count: 64000,
      minDistance: 4,
      boundsMin: [0, 0, 0],
      boundsMax: [50, 0, 50],
    });
    expect((wide.pointCount * 16) / 2500).toBeGreaterThan(0.65);
  });

  it("scatter-clustered spreads a box on all three axes, `spread.y` included", async () => {
    // The group is a BOX, and every component of `spread` is a live axis —
    // the flatness an agent sees at the defaults is the default value
    // [4, 0, 4], not the shape of the primitive.
    // `perCluster` is what samples the group's shape — one local cloud is
    // copied to every centre — so the reach is drawn from that many uniform
    // values per axis, not from the output count.
    const params = { clusters: 20, perCluster: 300, boundsMin: [0, 0, 0], boundsMax: [100, 0, 100] };
    const centres = await cookLaw("fill/scatter-clustered", { ...params, spread: [0, 0, 0] });
    const reach = async (spread: readonly number[], axis: number) => {
      const g = await cookLaw("fill/scatter-clustered", { ...params, spread: [...spread] });
      const A = centres.attrs.point.require("P");
      const B = g.attrs.point.require("P");
      let worst = 0;
      for (let i = 0; i < g.pointCount; i++) worst = Math.max(worst, Math.abs(B.get(i, axis) - A.get(i, axis)));
      return worst / (spread[axis] as number);
    };
    // Y answers exactly as X and Z do, and is exactly linear in the value.
    expect(await reach([4, 40, 4], 1)).toBeGreaterThan(0.9);
    expect(await reach([4, 40, 4], 1)).toBeLessThan(1);
    expect(await reach([4, 40, 4], 1)).toBeCloseTo(await reach([4, 9, 4], 1), 6);
    // ...and it moves Y ONLY: the same groups, given height.
    const flat = await cookLaw("fill/scatter-clustered", { ...params, spread: [4, 0, 4] });
    const tall = await cookLaw("fill/scatter-clustered", { ...params, spread: [4, 40, 4] });
    expect(column(tall, "P", 0)).toEqual(column(flat, "P", 0));
    expect(column(tall, "P", 2)).toEqual(column(flat, "P", 2));
    expect(column(tall, "P", 1)).not.toEqual(column(flat, "P", 1));
    // A zero Y is still the flat ground patch, on the nose — and that is
    // what the shipped default gives, so a village stays on the ground.
    for (const y of column(flat, "P", 1)) expect(y).toBe(0);
    for (const y of column(await cookLaw("fill/scatter-clustered", {}), "P", 1)) expect(y).toBe(0);
    // The reach is exactly linear in `spread`, measured against the same
    // groups collapsed onto their centres.
    // 0.96 rather than 1.00 is how close 600 uniform draws get to their own
    // bound, not evidence of a different bound.
    expect(await reach([4, 0, 4], 0)).toBeCloseTo(await reach([9, 0, 9], 0), 6);
    expect(await reach([4, 0, 4], 0)).toBeGreaterThan(0.9);
    expect(await reach([4, 0, 4], 0)).toBeLessThan(1);
    // The overhang, asserted as INTENDED rather than tolerated:
    // `boundsMin`/`boundsMax` bound the CENTRES, so the points leave the
    // box by up to `spread` on every side and nothing clamps them — a
    // group straddling the edge is a whole group, not a clipped one. The
    // bound on the overhang is `spread` exactly, which is what makes
    // insetting the bounds by `spread` a reliable way to contain the
    // points when a caller needs that.
    const overhang = { clusters: 200, perCluster: 20, boundsMin: [0, 0, 0], boundsMax: [100, 0, 100] };
    const xs = column(await cookLaw("fill/scatter-clustered", { ...overhang, spread: [9, 9, 9] }), "P", 0);
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(100);
    expect(Math.min(...xs)).toBeGreaterThan(-9);
    expect(Math.max(...xs)).toBeLessThan(109);
    // ...and the same overhang on Y once the group has height, which is
    // new ground: a volumetric group reaches below the centre plane too.
    const ys = column(await cookLaw("fill/scatter-clustered", { ...overhang, spread: [9, 9, 9] }), "P", 1);
    expect(Math.min(...ys)).toBeLessThan(0);
    expect(Math.min(...ys)).toBeGreaterThan(-9);
    expect(Math.max(...ys)).toBeGreaterThan(0);
    expect(Math.max(...ys)).toBeLessThan(9);
  });

  it("the slope scale is 1 - cos(angle), so 0.3 is 45 degrees and not 27", async () => {
    // `place/plantable`'s `maxSlope` is quoted in these anchors, and the
    // compression at the flat end is the whole reason they are listed.
    for (const [deg, slope] of [
      [0, 0],
      [10, 0.0152],
      [20, 0.0603],
      [30, 0.134],
      [45, 0.2929],
      [60, 0.5],
      [75, 0.7412],
      [90, 1],
    ] as const) {
      const g = await cookLaw("write/height-slope", {}, { in: tiltedNormal(deg) });
      expect(g.attrs.point.require("slope").get(0, 0), `${deg} degrees`).toBeCloseTo(slope, 3);
      expect(slope).toBeCloseTo(1 - Math.cos((deg * Math.PI) / 180), 3);
    }
    // The default `maxSlope` of 0.3 admits 45 degrees and rejects 60.
    expect(1 - Math.cos(Math.PI / 4)).toBeLessThan(0.3);
    expect(1 - Math.cos(Math.PI / 3)).toBeGreaterThan(0.3);
  });

  it("along-curve pitches every step but the last at `spacing`", async () => {
    // The leftover step is the fact the one-line description hid: props are
    // evenly pitched except at the far end of every path.
    const gaps = async (params: Record<string, unknown>) => {
      const g = await cookLaw("place/along-curve", params, { curve });
      const P = g.attrs.point.require("P");
      const out: number[] = [];
      for (let i = 1; i < g.pointCount; i++) out.push(Math.round((P.get(i, 0) - P.get(i - 1, 0)) * 1e4) / 1e4);
      return out;
    };
    // A 40-unit curve at spacing 7: five full steps and a short one.
    expect(await gaps({ mode: "spacing", spacing: 7 })).toEqual([7, 7, 7, 7, 7, 5]);
    expect(await gaps({ mode: "spacing", spacing: 12 })).toEqual([12, 12, 12, 4]);
    // floor(length / spacing) + 2, or + 1 when it divides exactly.
    for (const spacing of [3, 6, 7, 12]) {
      const expected = Math.floor((2 * CURVE_HALF_LENGTH) / spacing) + 2;
      expect((await gaps({ mode: "spacing", spacing })).length + 1, `spacing ${spacing}`).toBe(expected);
    }
    expect((await gaps({ mode: "spacing", spacing: 1 })).length + 1).toBe(41);
    // 'count' mode is exact instead: length / (count - 1), both ends on.
    for (const count of [5, 24]) {
      for (const gap of await gaps({ mode: "count", count })) {
        expect(gap).toBeCloseTo((2 * CURVE_HALF_LENGTH) / (count - 1), 3);
      }
    }
  });

  it("by-distance-to-curve loses band as `resolution` coarsens, never gains", async () => {
    // The quoted loss table. Sampling a curve sparsely can only push points
    // further from the nearest sample, so the band shrinks monotonically.
    const feeds = { in: box(20000, [-25, 0, -25], [25, 0, 25]), curve };
    const kept: number[] = [];
    for (const resolution of [0.1, 1, 2, 5, 10, 20]) {
      kept.push(
        (await cookLaw("filter/by-distance-to-curve", { distance: 5, comparison: "le", resolution }, feeds))
          .pointCount,
      );
    }
    const exact = kept[0] as number;
    for (let i = 1; i < kept.length; i++) expect(kept[i]).toBeLessThanOrEqual(kept[i - 1] as number);
    // resolution = distance / 5 is within half a percent; = distance loses
    // ~4%; = 2 * distance loses ~18%; = 4 * distance loses about half.
    expect(1 - (kept[1] as number) / exact).toBeLessThan(0.005);
    expect(1 - (kept[3] as number) / exact).toBeCloseTo(0.04, 2);
    expect(1 - (kept[4] as number) / exact).toBeCloseTo(0.18, 1);
    expect(1 - (kept[5] as number) / exact).toBeGreaterThan(0.4);
  });

  it("local-density always fills 0..1, whatever the radius", async () => {
    // The trap the `radius` description now names: the fit is per-cook, so
    // a density of 0.8 is never an absolute crowding.
    for (const radius of [2, 5, 20]) {
      const d = column(
        await cookLaw("write/local-density", { radius }, { in: box(3000, [-40, 0, -40], [40, 0, 40]) }),
        "density",
      );
      expect(Math.min(...d), `radius ${radius}`).toBe(0);
      expect(Math.max(...d), `radius ${radius}`).toBe(1);
    }
  });

  it("relax-spacing travel is exactly linear in `strength`", async () => {
    const travel = async (strength: number, radius: number) => {
      const at = async (s: number) =>
        (
          await cookLaw("transform/relax-spacing", { strength: s, radius }, { in: points })
        ).attrs.point.require("P");
      const A = await at(0);
      const B = await at(strength);
      let sum = 0;
      for (let i = 0; i < FIXTURE_POINTS; i++) {
        sum += Math.hypot(B.get(i, 0) - A.get(i, 0), B.get(i, 1) - A.get(i, 1), B.get(i, 2) - A.get(i, 2));
      }
      return sum / FIXTURE_POINTS;
    };
    // strength * (position - neighbourhood centroid): doubling the knob
    // doubles the travel exactly, and `radius` sets the scale it is a
    // fraction OF.
    const half = await travel(0.5, 4);
    expect(half).toBeCloseTo(0.42, 1);
    expect(await travel(1, 4)).toBeCloseTo(2 * half, 6);
    expect(await travel(0.5, 12)).toBeCloseTo(1.5, 1);
  });

  it("scatter-copies jitter is symmetric and reaches its bound exactly", async () => {
    const feeds = { source: box(20, [-1, 0, -1], [1, 0, 1], 3), target: box(2000, [-50, 0, -50], [50, 0, 50]) };
    const exact = await cookLaw("compose/scatter-copies", { jitter: [0, 0, 0] }, feeds);
    const A = exact.attrs.point.require("P");
    for (const j of [1, 6]) {
      const g = await cookLaw("compose/scatter-copies", { jitter: [j, j, j] }, feeds);
      const B = g.attrs.point.require("P");
      let lo = 0;
      let hi = 0;
      for (let i = 0; i < g.pointCount; i++) {
        for (const c of [0, 1, 2]) {
          const d = B.get(i, c) - A.get(i, c);
          lo = Math.min(lo, d);
          hi = Math.max(hi, d);
        }
      }
      // -jitter..+jitter on every axis: a spread of 2 * jitter, not jitter.
      expect(lo / j, `jitter ${j}`).toBeCloseTo(-1, 3);
      expect(hi / j, `jitter ${j}`).toBeCloseTo(1, 3);
    }
  });

  it("random-scale replaces `scale` rather than multiplying it", async () => {
    const preScaled = (id: string): Source => ({
      nodes: [
        ...box(200, [0, 0, 0], [10, 0, 10], 4)(`${id}_p`).nodes,
        {
          id,
          type: "setAttribute",
          params: {
            name: "scale",
            domain: "point",
            type: "f32",
            tupleSize: 3,
            value: { fn: "constant", value: [3, 3, 3] },
          },
        },
      ],
      connections: [{ from: [`${id}_p`, "out"], to: [id, "in"] }],
      out: [id, "out"],
    });
    const s = column(await cookLaw("write/random-scale", { min: 0.7, max: 1.4 }, { in: preScaled }), "scale");
    // An incoming scale of 3 leaves no trace: the range is min..max, and
    // both ends are reached rather than merely approached.
    expect(Math.min(...s)).toBeGreaterThanOrEqual(0.7);
    expect(Math.min(...s)).toBeLessThan(0.71);
    expect(Math.max(...s)).toBeLessThanOrEqual(1.4);
    expect(Math.max(...s)).toBeGreaterThan(1.39);
  });

  it("the acceptance rates the shape descriptions quote are the geometric ones", async () => {
    // 78.5% and 52.4% are pi/4 and pi/6, asserted at a sample size where
    // the difference between "about" and "wrong" would show.
    expect((await cookLaw("shape/disc", { count: 100000 })).pointCount / 100000).toBeCloseTo(Math.PI / 4, 2);
    expect((await cookLaw("shape/sphere-points", { count: 100000 })).pointCount / 100000).toBeCloseTo(
      Math.PI / 6,
      2,
    );
    // ...and "roughly half" for the density-driven one, which is the MEAN
    // of the normalized field rather than a rejection ratio — the one
    // place the narrow realized range costs nothing, since the mean is
    // 0.5 however little of 0..1 the field reaches.
    const thinned = await cookLaw("filter/thin-by-density", {}, { in: SPREAD });
    expect(thinned.pointCount / 20000).toBeCloseTo(0.5, 1);
  });
});
