/**
 * The non-finite guard, at the surface an author actually touches: a
 * PRIMITIVE knob, set from JSON, bound to a field expression that divides
 * by zero.
 *
 * `PLAN-finiteness.md` section 5 lists eight demonstrated failures — cooks
 * that reported `ok: true` and drew nothing, because a schema's `min`/`max`
 * binds a PLAIN value and a field is a recipe with no number to check until
 * it lands on a domain. Six of the eight are reachable through a shipped
 * primitive and are pinned here; the other two (`sweepProfile.radius`,
 * `pathSegments.radius`) are node params no primitive recipe uses, so they
 * are pinned in `src/nodes/nonFinite.test.ts` instead.
 *
 * Each test asserts the WHOLE refusal, not merely that something threw: the
 * underlying node type, the param name inside the recipe, the spelling of
 * the first offender, and the count against the total. A graph this broken
 * has several ways to fail (a tuple size, a missing attribute, an empty
 * result), and a test that accepted any of them would still pass with the
 * guard deleted.
 *
 * The knob is always the same expression — `1 / 0`, +Infinity where the
 * author put it — and what it becomes at the call site is part of each
 * expectation, because the two are not the same number: an infinity that
 * reaches a `cos`, a `lerp` between two infinities, or a bin index divided
 * by an infinite bin count all arrive as NaN.
 */
import { describe, expect, it } from "vitest";
import {
  NodeExecutionError,
  type SerializedConnection,
  type SerializedGraph,
  type SerializedNode,
  cook,
  deserializeGraph,
} from "../index.js";
// Registers the shipped primitives, so a graph can reach one by name.
import "./index.js";

// ---------------------------------------------------------------------------
// Feeding a primitive from JSON — the same shape `primitives.test.ts` uses
// ---------------------------------------------------------------------------

/** A source a saved graph can carry: nodes, their wiring, and the emitting pin. */
interface Source {
  readonly nodes: readonly SerializedNode[];
  readonly connections?: readonly SerializedConnection[];
  readonly out: readonly [string, string];
}

/** How many points {@link points} emits — the total in a refusal message. */
const FIXTURE_POINTS = 60;

/** How many samples {@link sampledCurve} puts on its path. */
const CURVE_SAMPLES = 24;

/** A flat scatter on the ground plane. */
function points(id: string): Source {
  return {
    nodes: [
      {
        id,
        type: "pointScatterInBounds",
        params: {
          count: FIXTURE_POINTS,
          boundsMin: [-15, 0, -15],
          boundsMax: [15, 0, 15],
          seed: 7,
        },
      },
    ],
    out: [id, "out"],
  };
}

/** A straight open polyline along X through the origin. */
function curve(id: string): Source {
  return {
    nodes: [
      {
        id: `${id}_line`,
        type: "pointLine",
        params: { count: 9, start: [-20, 0, 0], end: [20, 0, 0], includeEnd: true },
      },
      { id, type: "pointsToPath", params: { closed: false, groupAttr: "", orderAttr: "" } },
    ],
    connections: [{ from: [`${id}_line`, "out"], to: [id, "in"] }],
    out: [id, "out"],
  };
}

/**
 * The same straight path, RESAMPLED — so it carries the `curveU`
 * `transform/gather-on-path` requires. A bare `pointsToPath` has none, and
 * that failure is a different one from this file's subject.
 */
function sampledCurve(id: string): Source {
  const base = curve(`${id}_path`);
  return {
    nodes: [
      ...base.nodes,
      {
        id,
        type: "pathResample",
        params: { mode: "count", count: CURVE_SAMPLES, spacing: 1 },
      },
    ],
    connections: [...(base.connections ?? []), { from: base.out, to: [id, "in"] }],
    out: [id, "out"],
  };
}

/** The instance id every graph here gives its primitive. */
const INSTANCE = "prim";

/** A graph referencing `name` once, with every input pin fed from JSON. */
function driverGraph(
  name: string,
  params: Record<string, unknown>,
  feeds: Record<string, (id: string) => Source>,
): SerializedGraph {
  const nodes: SerializedNode[] = [];
  const connections: SerializedConnection[] = [];
  for (const [pin, make] of Object.entries(feeds)) {
    const source = make(`src_${pin}`);
    nodes.push(...source.nodes);
    connections.push(...(source.connections ?? []));
    connections.push({ from: source.out, to: [INSTANCE, pin] });
  }
  nodes.push({ id: INSTANCE, type: "subgraph", params, ref: { name } });
  return {
    formatVersion: 1,
    seed: 2026,
    nodes,
    connections,
    outputs: [{ id: INSTANCE, pin: "out", name: "out" }],
  };
}

/** Cook a driver graph, returning whatever it threw (or `undefined`). */
async function cookFor(
  name: string,
  params: Record<string, unknown>,
  feeds: Record<string, (id: string) => Source>,
): Promise<unknown> {
  return await cook(deserializeGraph(driverGraph(name, params, feeds))).then(
    () => undefined,
    (err: unknown) => err,
  );
}

// ---------------------------------------------------------------------------
// The demonstrations
// ---------------------------------------------------------------------------

/**
 * `1 / 0` as a field expression: +Infinity, arriving through the JSON
 * grammar rather than as a literal, because a non-finite CONSTANT is
 * refused where it is written and this one is computed.
 */
const DIVIDE_BY_ZERO = { fn: "div", args: [1, 0] };

/** A finite value in the same slot, for the control cook. */
const FINITE = { fn: "div", args: [3, 2] };

/** One row of `PLAN-finiteness.md` section 5, as a cookable graph. */
interface Demonstration {
  /** Its number in that table, so a failure here points back at the row. */
  readonly n: string;
  readonly primitive: string;
  /** The exposed knob the author sets. */
  readonly knob: string;
  /** Extra params, only ever to fix the element count in the message. */
  readonly params?: Record<string, unknown>;
  readonly feeds?: Record<string, (id: string) => Source>;
  /** Id of the body node that refuses, named in the wrapped message. */
  readonly node: string;
  readonly nodeType: string;
  /** The param the guard names — the recipe's, not the author's. */
  readonly param: string;
  /** Spelling of the FIRST offender, once the knob's +Infinity has travelled. */
  readonly spelling: "NaN" | "+Infinity" | "-Infinity";
  /** Domain elements in the resolved column — every one of them non-finite. */
  readonly elements: number;
}

const DEMONSTRATIONS: readonly Demonstration[] = [
  // f8dbfbd made `bins` a guarded divisor — `max(param, 1)` at the point of
  // use — and this is what that clamp does and does not buy: it is a FLOOR,
  // and `Math.max(+Infinity, 1)` is +Infinity, so an infinite bin count
  // still reaches the parameter, where dividing an infinite bin index by an
  // infinite bin count yields NaN. A floor stops a value that is too small,
  // never one that is not a value at all.
  {
    n: "1a",
    primitive: "transform/gather-on-path",
    knob: "bins",
    feeds: { in: sampledCurve },
    node: "slide",
    nodeType: "pathPointAt",
    param: "parameter",
    spelling: "NaN",
    elements: CURVE_SAMPLES,
  },
  // The row names two knobs, and both still reach the same call site — the
  // second by the shorter route, since `amount` is the lerp's own weight
  // and travels to the parameter without meeting a clamp at all.
  {
    n: "1b",
    primitive: "transform/gather-on-path",
    knob: "amount",
    feeds: { in: sampledCurve },
    node: "slide",
    nodeType: "pathPointAt",
    param: "parameter",
    spelling: "+Infinity",
    elements: CURVE_SAMPLES,
  },
  {
    n: "2",
    primitive: "shape/ring",
    knob: "sweep",
    params: { count: 24 },
    node: "ring",
    nodeType: "transformPoints",
    param: "translate",
    // cos(+Infinity) is NaN: the angle is not a number, so neither is the
    // point on the circle.
    spelling: "NaN",
    elements: 24,
  },
  {
    n: "3",
    primitive: "shape/spiral",
    knob: "turns",
    params: { count: 40 },
    node: "spiral",
    nodeType: "transformPoints",
    param: "translate",
    spelling: "NaN",
    elements: 40,
  },
  {
    n: "6",
    primitive: "place/radial-on-curve",
    knob: "spread",
    params: { count: 12 },
    feeds: { curve },
    node: "orient",
    nodeType: "orientAlongVector",
    param: "up",
    spelling: "NaN",
    elements: 12,
  },
  // `min` and `max` are one knob each into the same lerp, and they do not
  // spoil it the same way: an infinite `min` is subtracted from a finite
  // `max` and the difference of the two infinities is NaN, while an
  // infinite `max` survives the subtraction and lands as +Infinity. Both
  // are refused, and the message says which arrived.
  {
    n: "7a",
    primitive: "write/random-scale",
    knob: "min",
    feeds: { in: points },
    node: "scaleAttr",
    nodeType: "setAttribute",
    param: "value",
    spelling: "NaN",
    elements: FIXTURE_POINTS,
  },
  {
    n: "7b",
    primitive: "write/random-scale",
    knob: "max",
    feeds: { in: points },
    node: "scaleAttr",
    nodeType: "setAttribute",
    param: "value",
    spelling: "+Infinity",
    elements: FIXTURE_POINTS,
  },
  {
    n: "8",
    primitive: "transform/relax-spacing",
    knob: "strength",
    feeds: { in: points },
    node: "push",
    nodeType: "transformPoints",
    param: "translate",
    spelling: "+Infinity",
    elements: FIXTURE_POINTS,
  },
];

describe("a primitive knob bound to a field that divides by zero", () => {
  for (const d of DEMONSTRATIONS) {
    it(`${d.n}: refuses ${d.primitive} "${d.knob}", naming ${d.nodeType} param "${d.param}"`, async () => {
      // First the control, so the refusal below cannot be an unrelated
      // failure wearing the right shape: the very same graph, the very same
      // knob still held by a FIELD, cooks when what the field resolves to is
      // a number.
      const finite = await cookFor(d.primitive, { ...(d.params ?? {}), [d.knob]: FINITE }, d.feeds ?? {});
      expect(finite === undefined ? "cooked" : (finite as Error).message).toBe("cooked");

      const err = await cookFor(
        d.primitive,
        { ...(d.params ?? {}), [d.knob]: DIVIDE_BY_ZERO },
        d.feeds ?? {},
      );
      // The node id is the SUBGRAPH INSTANCE the author placed: that is the
      // node this graph has, and the one an editor can select. Which node
      // inside the recipe refused is in the message, where a caller who did
      // not write the recipe can still read it.
      expect(err).toBeInstanceOf(NodeExecutionError);
      expect((err as NodeExecutionError).nodeId).toBe(INSTANCE);
      const message = (err as Error).message;
      // Two halves rather than one string: a vec param names the offending
      // COMPONENT between them ("at element 0, component 1"), which is
      // per-param detail this table does not carry.
      expect(message).toContain(
        `node "${d.node}" failed: ${d.nodeType}: param "${d.param}" resolved to ${d.spelling} ` +
          "at element 0",
      );
      expect(message).toContain(`${d.elements} of ${d.elements} elements are non-finite.`);
      // The explanation is half the point of the refusal: it is the only
      // place an author is told that a bound does not bind a field.
      expect(message).toContain("A FIELD param is not range-checked");
      expect(message).toContain(`set "${d.param}" to a plain number`);
    });
  }
});
