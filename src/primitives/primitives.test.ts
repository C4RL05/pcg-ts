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
import { snapshotGeometry } from "../nodes/testSupport.js";
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

  "write/height-slope": { in: pointsWithNormal },
  "write/density-from-noise": { in: points },
  "write/random-scale": { in: points },
  "write/random-yaw": { in: points },
  "write/color-from-attribute": { in: points },
  "write/local-density": { in: points },
  "write/instances-by-species": { in: points },
  "write/orient-along-path": { in: curve },
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

  it("drop-to-surface keeps the hits on a TILTED surface too", async () => {
    // The flat fixture above cannot see this: a plane at y = 0 gives hit
    // positions that are exactly on it, so a second ray cast from the
    // snapped position still hits at t = 0 whatever order the two
    // transfers run in. Tilt the plane and the hit position lands a hair
    // below it, the second ray (forward-only) finds nothing, and every
    // point that really did hit is discarded. Measured: half of them.
    // So the order — mark the hits BEFORE moving anything — is load-
    // bearing, and this is the fixture that says so.
    const graph: SerializedGraph = {
      formatVersion: 1,
      seed: 5,
      nodes: [
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
          params: { count: 1500, boundsMin: [-8, 30, -8], boundsMax: [8, 30, 8], seed: 4 },
        },
        { id: "drop", type: "subgraph", params: {}, ref: { name: "place/drop-to-surface" } },
      ],
      connections: [
        { from: ["mesh", "out"], to: ["tilt", "in"] },
        { from: ["tilt", "out"], to: ["drop", "surface"] },
        { from: ["pts", "out"], to: ["drop", "points"] },
      ],
      outputs: [{ id: "drop", pin: "out", name: "main_out" }],
    };
    const g = geo(await cookGraph(graph));
    expect(g.pointCount).toBe(1500);
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
