/**
 * filterByExpression — the filter family's arrival at the
 * params-accept-fields pillar. The tests pin the predicate contract an
 * agent has to be able to rely on: non-zero keeps, NaN drops, and a
 * vector predicate is refused rather than silently reinterpreted.
 */
import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import type { FieldLike } from "../fields/index.js";
import {
  attribute,
  component,
  div,
  evaluateField,
  gt,
  lt,
  max,
  mul,
  position,
  randomField,
  sub,
} from "../fields/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { fieldFromJson, filterByExpression, type FilterByExpressionParams } from "./index.js";
import { firstGeo, positionsOf, runNode, snapshotGeometry } from "./nodes.testsupport.js";

function cloudAt(positions: readonly (readonly number[])[]): ReturnType<typeof createPointCloud> {
  const geo = createPointCloud(positions.length);
  const P = geo.attrs.point.require("P");
  positions.forEach((p, i) => P.setTuple(i, p));
  return geo;
}

const LINE = [
  [0, 0, 0],
  [1, 0, 0],
  [2, 0, 0],
  [3, 0, 0],
];

async function keep(
  predicate: FieldLike,
  positions: readonly (readonly number[])[] = LINE,
  params: Partial<FilterByExpressionParams> = {},
  seed = 1,
): Promise<number[]> {
  const geo = firstGeo(
    (
      await runNode(
        filterByExpression,
        { predicate, ...params },
        { in: [makeGeometryItem(cloudAt(positions))] },
        seed,
      )
    ).out,
  );
  return positionsOf(geo).map((p) => p[0]);
}

describe("filterByExpression", () => {
  it("keeps points where a field predicate is non-zero", async () => {
    expect(await keep(gt(component(position(), 0), 1.5))).toEqual([2, 3]);
    expect(await keep(lt(component(position(), 0), 1.5))).toEqual([0, 1]);
  });

  it("a constant-true predicate keeps everything and a constant-false keeps nothing", async () => {
    expect(await keep(1)).toEqual([0, 1, 2, 3]);
    expect(await keep(0)).toEqual([]);
    // Any non-zero counts, including negatives.
    expect(await keep(-0.5)).toEqual([0, 1, 2, 3]);
    // And the default param is the identity filter.
    const geo = cloudAt(LINE);
    const out = firstGeo((await runNode(filterByExpression, {}, { in: [makeGeometryItem(geo)] })).out);
    expect(snapshotGeometry(out)).toEqual(snapshotGeometry(geo));
  });

  it("NaN never passes", async () => {
    expect(await keep(NaN)).toEqual([]);
    // A per-point NaN drops only its own point: 0/0 at x = 0.
    expect(await keep(div(component(position(), 0), component(position(), 0)))).toEqual([1, 2, 3]);
  });

  it("mul is AND and max is OR over comparison flags", async () => {
    const x = component(position(), 0);
    expect(await keep(mul(gt(x, 0.5), lt(x, 2.5)))).toEqual([1, 2]);
    expect(await keep(max(lt(x, 0.5), gt(x, 2.5)))).toEqual([0, 3]);
  });

  it("reads attributes, and carries every attribute onto the survivors", async () => {
    const geo = cloudAt(LINE);
    geo.attrs.point.require("density").data.set([0.1, 0.9, 0.2, 0.8]);
    const tag = geo.attrs.point.add("tag", "string", 1, "");
    LINE.forEach((_, i) => tag.setString(i, `p${i}`));
    const out = firstGeo(
      (
        await runNode(
          filterByExpression,
          { predicate: gt(attribute("density", 1), 0.5) },
          { in: [makeGeometryItem(geo)] },
        )
      ).out,
    );
    expect(positionsOf(out).map((p) => p[0])).toEqual([1, 3]);
    const outTag = out.attrs.point.require("tag");
    expect([outTag.getString(0), outTag.getString(1)]).toEqual(["p1", "p3"]);
  });

  it("refuses a vector predicate, naming the elementwise trap and the fix", async () => {
    await expect(
      runNode(
        filterByExpression,
        { predicate: gt(position(), 0) },
        { in: [makeGeometryItem(cloudAt(LINE))] },
      ),
    ).rejects.toThrow(/tuple size 1 \(one flag per point\), got tuple size 3.*component\(position\(\), 1\)/s);
  });

  it("a seed re-rolls context randomness, and 0 leaves the node seed alone", async () => {
    const many = Array.from({ length: 400 }, (_, i) => [i, 0, 0]);
    const half = lt(randomField("keep"), 0.5);
    const a = await keep(half, many, {}, 5);
    const b = await keep(half, many, {}, 5);
    expect(b).toEqual(a);
    expect(a.length).toBeGreaterThan(150);
    expect(a.length).toBeLessThan(250);
    // seed 0 is the node seed UNCHANGED — not hashCombine(nodeSeed, 0).
    // Checked against the field evaluated directly at the node seed, which
    // is the only reference that does not go through the node's own
    // folding rule; graphs authored before the param existed depend on it.
    const geo = cloudAt(many);
    const direct = evaluateField(half, { geo, domain: "point", seed: 5 });
    const expected = many.map((p, i) => (direct.data[i] !== 0 ? p[0] : -1)).filter((x) => x >= 0);
    expect(a).toEqual(expected);
    expect(await keep(half, many, { seed: 0 }, 5)).toEqual(expected);
    // A nonzero seed is a different roll, reproducible on its own terms.
    expect(await keep(half, many, { seed: 9 }, 5)).not.toEqual(a);
    expect(await keep(half, many, { seed: 9 }, 5)).toEqual(await keep(half, many, { seed: 9 }, 5));
  });

  it("handles an empty input and a single point", async () => {
    expect(await keep(1, [])).toEqual([]);
    expect(await keep(gt(component(position(), 0), 0), [[5, 0, 0]])).toEqual([5]);
    expect(await keep(gt(component(position(), 0), 0), [[-5, 0, 0]])).toEqual([]);
  });

  it("survives non-finite coordinates without keeping them by accident", async () => {
    // The comparison against NaN is false, so the bad point is dropped —
    // the same answer a hand-written filterByAttribute would give.
    expect(
      await keep(gt(component(position(), 0), -1), [
        [0, 0, 0],
        [NaN, 0, 0],
        [Infinity, 0, 0],
      ]),
    ).toEqual([0, Infinity]);
  });

  it("takes a predicate authored as a declarative field spec (the JSON path)", async () => {
    const spec = fieldFromJson({
      fn: "gt",
      args: [{ fn: "component", args: [{ fn: "position" }], index: 0 }, 1.5],
    });
    expect(await keep(spec)).toEqual([2, 3]);
  });

  it("is deterministic: cooking twice gives identical bytes", async () => {
    const geo = cloudAt(LINE);
    const run = () =>
      runNode(
        filterByExpression,
        { predicate: sub(component(position(), 0), 1) },
        { in: [makeGeometryItem(geo)] },
        3,
      );
    expect(snapshotGeometry(firstGeo((await run()).out))).toEqual(
      snapshotGeometry(firstGeo((await run()).out)),
    );
  });

  it("names the node when nothing is connected", async () => {
    await expect(runNode(filterByExpression, {}, {})).rejects.toThrow(
      /filterByExpression: input pin "in" has no geometry connected/,
    );
  });
});
