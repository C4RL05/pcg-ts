import { describe, expect, it } from "vitest";
// Side-effect imports: register the standard types living outside
// src/nodes (spawnInstances, dataInput) so the sweep sees the whole
// standard library, exactly as registry.test.ts does.
import "../runtime/index.js";
import "../spawn/index.js";
import { listNodeTypes } from "./index.js";

/**
 * Which params accept a `Field` was an unstated whitelist — 20 of 180 —
 * until `docs/authoring.md` wrote the rule down. Being unstated is how it
 * drifted in the first place, so the three clauses that are MECHANICAL
 * are pinned here: the documented rule and the registry cannot now
 * disagree without a red test naming the offender.
 *
 * The other two clauses are deliberately NOT pinned. "It must not decide
 * how many elements come out" and "it must not define a symmetric
 * relation" are judgements about what a param MEANS, and a test that
 * tried to pin them would be asserting a LIST of param names — which is
 * the whitelist again, wearing a test's clothes.
 *
 * A param newly granted `acceptsField` that trips one of these is not
 * necessarily wrong; it means the rule in the docs needs the same edit,
 * and that is the point of the failure.
 */

/** A field resolves to one f32 column, so these are the types that can read one. */
const FIELD_COLUMN_TYPES = ["f32", "vec3", "vec4"];

/** Skip the `__test_*` fixtures other suites register. */
const standardTypes = () => listNodeTypes().filter((t) => !t.type.startsWith("__test_"));

const fieldCapableParams = () =>
  standardTypes().flatMap((info) =>
    Object.entries(info.params)
      .filter(([, schema]) => schema.acceptsField === true)
      .map(([param, schema]) => ({ id: `${info.type}.${param}`, type: schema.type })),
  );

describe("the rule for which params accept a field", () => {
  it("clause 1: a field column is f32, so only f32/vec3/vec4 params take one", () => {
    const capable = fieldCapableParams();
    // Guard the sweep itself: an empty result would pass every assertion
    // below while proving nothing at all.
    expect(capable.length).toBeGreaterThan(10);
    const wrongType = capable
      .filter((p) => !FIELD_COLUMN_TYPES.includes(p.type))
      .map((p) => `${p.id} is ${p.type}`);
    expect(wrongType).toEqual([]);
  });

  it("clause 2: a source node has no elements to evaluate a field against", () => {
    // A source builds its elements FROM its params, so they are read
    // before there is a domain to resolve anything over.
    const sources = standardTypes().filter(
      (info) => !info.inputs.some((pin) => pin.kind === "geometry" || pin.kind === "any"),
    );
    expect(sources.length).toBeGreaterThan(0);
    const offenders = sources.flatMap((info) =>
      Object.entries(info.params)
        .filter(([, schema]) => schema.acceptsField === true)
        .map(([param]) => `${info.type}.${param}`),
    );
    expect(offenders).toEqual([]);
  });

  it("clause 3: a seed is folded in before the walk, so it stays eager", () => {
    // A seed is hash-combined into the node's derived seed at cook start,
    // when there is no element in hand to evaluate a field against.
    const seedParams = standardTypes().flatMap((info) =>
      Object.entries(info.params)
        .filter(([param]) => /seed/i.test(param))
        .map(([param, schema]) => ({
          id: `${info.type}.${param}`,
          capable: schema.acceptsField === true,
        })),
    );
    expect(seedParams.length).toBeGreaterThan(0);
    expect(seedParams.filter((p) => p.capable).map((p) => p.id)).toEqual([]);
  });
});
