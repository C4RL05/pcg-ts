/**
 * SVG renderer: determinism (the property the phase is judged on),
 * the world-to-pixel transform, projection, primitive drawing, coloring,
 * and the caps that keep a million-point cook from producing a
 * hundred-megabyte file.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type DataCollection,
  type Geometry,
  createPointCloud,
  createPolyline,
  createTriangleMesh,
  makeDeviceInstancesItem,
  makeGeometryItem,
  makeInstancesItem,
  setPolylineTopology,
} from "../index.js";
import { renderSvg } from "./render.js";

/** A point cloud with the given xz positions (y = 0) and optional extra columns. */
function cloudGeo(positions: readonly (readonly [number, number])[]): Geometry {
  const geo = createPointCloud(positions.length);
  const P = geo.attrs.point.require("P");
  positions.forEach(([x, z], i) => P.setTuple(i, [x, 0, z]));
  return geo;
}

function cloud(positions: readonly (readonly [number, number])[]): DataCollection {
  return [makeGeometryItem(cloudGeo(positions))];
}

function circles(svg: string): string[] {
  return svg.split("\n").filter((line) => line.startsWith("<circle"));
}

/** The `<g fill="...">` colors, in the order the document lists them. */
function fillOrder(svg: string): string[] {
  return [...svg.matchAll(/<g fill="([^"]+)">/g)].map((m) => m[1]);
}

/** The path groups' stroke colors, in the order the document lists them. */
function strokeOrder(svg: string): string[] {
  return [...svg.matchAll(/<g fill="none" stroke="([^"]+)"/g)].map((m) => m[1]);
}

/** Path `d` -> the stroke color of the group it was emitted in. */
function strokeOf(svg: string): Map<string, string> {
  const byPath = new Map<string, string>();
  let color = "";
  for (const line of svg.split("\n")) {
    const group = /^<g fill="none" stroke="([^"]+)"/.exec(line);
    if (group !== null) color = group[1];
    const path = /^<path d="([^"]+)"\/>$/.exec(line);
    if (path !== null) byPath.set(path[1], color);
  }
  return byPath;
}

describe("renderSvg", () => {
  it("draws one circle per point, projecting x right and z down", () => {
    // extent 10 x 4, pad 4% of 10 = 0.4 -> a 10.8 x 4.8 world box, which
    // at width 108 is exactly 10 px per world unit.
    const result = renderSvg(cloud([[0, 0], [10, 4]]), { width: 108 });
    expect(result.points).toBe(2);
    expect(result.pointsTotal).toBe(2);
    expect(result.bounds).toEqual({ min: [0, 0], max: [10, 4] });
    const drawn = circles(result.svg);
    expect(drawn).toEqual(['<circle cx="4" cy="4" r="1.5"/>', '<circle cx="104" cy="44" r="1.5"/>']);
  });

  it("writes the document in pixel space: viewBox, background and radius", () => {
    const result = renderSvg(cloud([[0, 0], [20, 10]]), { width: 400 });
    expect(result.width).toBe(400);
    // extent 20 x 10, pad 0.8 -> 21.6 x 11.6 world, projected onto the image.
    expect(result.height).toBe(215);
    expect(result.svg).toContain('width="400" height="215" viewBox="0 0 400 215"');
    expect(result.svg).toContain('<rect x="0" y="0" width="400" height="215" fill="#ffffff"/>');
    // Coordinates carry three decimals of a pixel — the precision that
    // makes the file faithful and diffable.
    expect(result.svg).toContain('<circle cx="14.815" cy="14.815" r="1.5"/>');
    expect(result.svg).toContain('<circle cx="385.185" cy="200" r="1.5"/>');
  });

  it("draws a world a thousandth of a unit wide exactly like a large one", () => {
    // The regression that made this a pixel-space renderer: with world
    // coordinates in the document, a small extent quantized every radius
    // and every position to 0 and shipped a blank white image under a
    // success report.
    const big = renderSvg(cloud([[0, 0], [10, 4]]), { width: 108 });
    const tiny = renderSvg(cloud([[0, 0], [0.0001, 0.00004]]), { width: 108 });
    expect(tiny.svg).toBe(big.svg);
    expect(tiny.svg).toContain('r="1.5"');
    expect(tiny.svg).not.toContain('r="0"');
    expect(tiny.svg).toContain('viewBox="0 0 108 48"');
    // ...while the reported bounds stay in WORLD units, because that is
    // data about the cook and not about the image.
    expect(tiny.bounds?.max[0]).toBeCloseTo(0.0001, 9);
    expect(big.bounds).toEqual({ min: [0, 0], max: [10, 4] });
  });

  it("keeps the image at least one pixel tall for an extreme aspect", () => {
    const result = renderSvg(cloud([[0, 0], [100, 1]]), { width: 1 });
    expect(result.height).toBeGreaterThanOrEqual(1);
    expect(result.svg).toContain('viewBox="0 0 1 1"');
  });

  it("emits color groups in sorted order however the colors were inserted", () => {
    // The guard the renderer's own comment calls the defence against
    // "iteration or insertion accidents". Two collections that insert the
    // same two colors in opposite order must produce the same document.
    const rising = cloudGeo([[0, 0], [1, 0]]);
    const risingH = rising.attrs.point.add("h", "f32", 1);
    risingH.set(0, 0);
    risingH.set(1, 1);
    const falling = cloudGeo([[1, 0], [0, 0]]);
    const fallingH = falling.attrs.point.add("h", "f32", 1);
    fallingH.set(0, 1);
    fallingH.set(1, 0);

    const a = renderSvg([makeGeometryItem(rising)], { attr: "h" });
    const b = renderSvg([makeGeometryItem(falling)], { attr: "h" });
    expect(fillOrder(a.svg)).toEqual(["#440154", "#fde725"]);
    expect(fillOrder(b.svg)).toEqual(fillOrder(a.svg));
    expect([...fillOrder(a.svg)]).toEqual([...fillOrder(a.svg)].sort());
  });

  it("draws polyline primitives as open paths and meshes as closed ones", () => {
    // extent 2 x 1, pad 0.08 -> a 2.16 x 1.16 box; at width 216 that is
    // exactly 100 px per world unit.
    const line = createPolyline(Float32Array.of(0, 0, 0, 1, 0, 1, 2, 0, 0));
    const open = renderSvg([makeGeometryItem(line)], { width: 216 });
    expect(open.primitives).toBe(1);
    expect(open.primitivesTotal).toBe(1);
    expect(open.svg).toContain(
      '<g fill="none" stroke="#2563eb" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">',
    );
    expect(open.svg).toContain('<path d="M8 8L108 108L208 8"/>');

    const mesh = createTriangleMesh(
      Float32Array.of(0, 0, 0, 1, 0, 1, 2, 0, 0),
      Uint32Array.of(0, 1, 2),
    );
    const closed = renderSvg([makeGeometryItem(mesh)], { width: 216 });
    expect(closed.svg).toContain('<g fill="none" stroke="#9ca3af" stroke-width="1.2">');
    expect(closed.svg).toContain('<path d="M8 8L108 108L208 8Z"/>');
  });

  it("breaks a primitive at a non-finite vertex instead of splicing across it", () => {
    // The spliced segment would be a line that is in no input — the one
    // thing a picture of the data must never invent.
    const gapped = createPolyline(
      Float32Array.of(0, 0, 0, 5, 0, 10, Number.NaN, 0, Number.NaN, 10, 0, 0),
    );
    const result = renderSvg([makeGeometryItem(gapped)], { width: 108 });
    expect(result.svg).toContain('<path d="M4 4L54 104"/>');
    // (10, 0) projects to x 104, y 4; no segment may reach it, and the
    // single-vertex remainder is not a subpath of its own either.
    expect(result.svg).not.toContain("L104 4");
    expect(result.svg).not.toContain("M104 4");
    expect(result.primitives).toBe(1);
    expect(result.skipped).toBe(2);

    const twoRuns = createPolyline(
      Float32Array.of(0, 0, 0, 1, 0, 0, Number.NaN, 0, Number.NaN, 2, 0, 0, 3, 0, 0),
    );
    const split = renderSvg([makeGeometryItem(twoRuns)], { width: 108 });
    const d = /<path d="([^"]+)"\/>/.exec(split.svg)?.[1] ?? "";
    // Two runs of two, each opened with its own M — never L37.333 4L70.667 4,
    // the segment that bridges the hole.
    expect(d).toBe("M4 4L37.333 4M70.667 4L104 4");
    expect(d).not.toContain("L37.333 4L");
    expect(split.primitives).toBe(1);
  });

  it("counts and bounds only what it actually drew", () => {
    // A primitive with fewer than two usable vertices in a row emits
    // nothing, so it is not a drawn primitive and it must not stretch the
    // frame around content the file does not contain.
    const mesh = createTriangleMesh(
      Float32Array.of(
        0, 0, 0,
        1, 0, 0,
        0, 0, 1,
        1000, 0, 1000,
        Number.NaN, 0, Number.NaN,
        Number.NaN, 0, Number.NaN,
      ),
      Uint32Array.of(0, 1, 2, 3, 4, 5),
    );
    // maxPoints 1 keeps the far point from being drawn as a circle, so the
    // only thing that could push the bounds out to 1000 is the discarded
    // primitive.
    const result = renderSvg([makeGeometryItem(mesh)], { maxPoints: 1 });
    expect(result.primitives).toBe(1);
    expect(result.primitivesTotal).toBe(2);
    expect(result.points).toBe(1);
    expect(result.bounds).toEqual({ min: [0, 0], max: [1, 1] });
  });

  it("tracks bounds through primitive vertices, not only through drawn points", () => {
    const line = createPolyline(Float32Array.of(0, 0, 0, 4, 0, 8, 8, 0, 0));
    const result = renderSvg([makeGeometryItem(line)], { maxPoints: 1 });
    expect(result.points).toBe(1);
    expect(result.bounds).toEqual({ min: [0, 0], max: [8, 8] });
  });

  it("colors by a scalar attribute through the ramp, and by a vec3 as RGB", () => {
    const geo = createPointCloud(2);
    const P = geo.attrs.point.require("P");
    P.setTuple(0, [0, 0, 0]);
    P.setTuple(1, [1, 0, 1]);
    const scalar = geo.attrs.point.add("h", "f32", 1);
    scalar.set(0, 0);
    scalar.set(1, 1);
    const ramped = renderSvg([makeGeometryItem(geo)], { attr: "h" });
    expect(ramped.colorAttr).toBe("h");
    expect(ramped.svg).toContain('<g fill="#440154">');
    expect(ramped.svg).toContain('<g fill="#fde725">');

    const rgb = geo.attrs.point.add("rgb", "f32", 3);
    rgb.setTuple(0, [1, 0, 0]);
    rgb.setTuple(1, [0, 0.5, 1]);
    const colored = renderSvg([makeGeometryItem(geo)], { attr: "rgb" });
    expect(colored.svg).toContain('<g fill="#ff0000">');
    expect(colored.svg).toContain('<g fill="#0080ff">');
  });

  it("colors a constant attribute at the bottom of the ramp, not out of it", () => {
    const geo = cloudGeo([[0, 0], [1, 1]]);
    const flat = geo.attrs.point.add("h", "f32", 1);
    flat.set(0, 3);
    flat.set(1, 3);
    const result = renderSvg([makeGeometryItem(geo)], { attr: "h" });
    expect(fillOrder(result.svg)).toEqual(["#440154"]);
    expect(result.svg).not.toContain("undefined");
  });

  it("normalizes the scalar ramp over the whole collection, so one color means one value", () => {
    const low = cloudGeo([[0, 0], [1, 0]]);
    const lowH = low.attrs.point.add("h", "f32", 1);
    lowH.set(0, 0);
    lowH.set(1, 1);
    const high = cloudGeo([[2, 0], [3, 0]]);
    const highH = high.attrs.point.add("h", "f32", 1);
    highH.set(0, 100);
    highH.set(1, 200);

    const result = renderSvg([makeGeometryItem(low), makeGeometryItem(high)], { attr: "h" });
    // Range 0..200 across both: 0 and 1 land in the first stop, 100 in the
    // middle, only 200 at the top. Per-geometry ramps would put both
    // geometries' maxima at #fde725 and claim they mean the same value.
    expect(fillOrder(result.svg)).toEqual(["#1fa187", "#440154", "#fde725"]);
    expect(result.svg.match(/<g fill="#fde725">/g)).toHaveLength(1);
  });

  it("colors string values by a hash of the value, stable across interning order", () => {
    const first = cloudGeo([[0, 0], [1, 0]]);
    const firstTag = first.attrs.point.add("tag", "string", 1);
    firstTag.setString(0, "oak");
    firstTag.setString(1, "pine");
    // Same picture, opposite interning order: "pine" is written first.
    const second = cloudGeo([[1, 0], [0, 0]]);
    const secondTag = second.attrs.point.add("tag", "string", 1);
    secondTag.setString(0, "pine");
    secondTag.setString(1, "oak");

    const a = renderSvg([makeGeometryItem(first)], { attr: "tag" });
    const b = renderSvg([makeGeometryItem(second)], { attr: "tag" });
    expect(a.colorAttr).toBe("tag");
    expect(fillOrder(a.svg)).toHaveLength(2);
    // Coloring by the string-table index instead would recolor every
    // category the moment one value first appears somewhere else.
    expect(b.svg).toBe(a.svg);
  });

  it("names the item that is missing the color attribute, and lists that item's attributes", () => {
    const withAttr = cloudGeo([[0, 0]]);
    withAttr.attrs.point.add("d", "f32", 1);
    const without = cloudGeo([[1, 1]]);
    without.attrs.point.add("other", "f32", 1);
    expect(() =>
      renderSvg([makeGeometryItem(withAttr), makeGeometryItem(without)], { attr: "d" }),
    ).toThrow(
      'item 1 has no attribute "d" to color by on the point or the primitive domain; item 1 point attributes: P, rot, scale, density, boundsMin, boundsMax, color, seed, other; primitive attributes: (none)',
    );
  });

  // -- primitive-domain coloring -------------------------------------------

  /**
   * A road-shaped network: two polyline primitives over three points,
   * meeting at the middle one — the topology `pointsToPath` cannot
   * express and the reason a per-edge value needs a domain of its own.
   */
  function network(): Geometry {
    const geo = cloudGeo([[0, 0], [1, 1], [2, 0]]);
    // Primitive columns are added after the topology, which drops them.
    setPolylineTopology(geo, [0, 1, 1, 2], [0, 2], [2, 2]);
    return geo;
  }

  it("colors polyline paths from a primitive attribute, one group per color", () => {
    const geo = network();
    const width = geo.attrs.primitive.add("roadWidth", "f32", 1);
    width.set(0, 0);
    width.set(1, 1);
    const result = renderSvg([makeGeometryItem(geo)], { attr: "roadWidth", width: 216 });
    expect(result.primitives).toBe(2);
    expect(result.colorAttr).toBe("roadWidth");
    expect(result.colorDomains).toEqual(["primitive"]);
    // Two edges, two ends of the ramp, two stroke groups — the per-edge
    // value that phase 43 could compute and nothing could show.
    expect(strokeOrder(result.svg)).toEqual(["#440154", "#fde725"]);
    expect(result.svg).toContain('<path d="M8 8L108 108"/>');
    expect(result.svg).toContain('<path d="M108 108L208 8"/>');
    // The points of a geometry whose only copy is on the primitives keep
    // the flat default: a junction of three roads has three candidate
    // values and inventing one would draw something not in the data.
    expect(fillOrder(result.svg)).toEqual(["#1f2937"]);
  });

  it("colors both marks when one name lives on both domains, over one shared ramp", () => {
    const geo = network();
    const primWidth = geo.attrs.primitive.add("w", "f32", 1);
    primWidth.set(0, 0);
    primWidth.set(1, 4);
    const pointWidth = geo.attrs.point.add("w", "f32", 1);
    pointWidth.set(0, 0);
    pointWidth.set(1, 8);
    pointWidth.set(2, 4);
    const result = renderSvg([makeGeometryItem(geo)], { attr: "w" });
    expect(result.colorDomains).toEqual(["point", "primitive"]);
    // One ramp over 0..8: the primitive at 4 and the point at 4 are the
    // same color, which is what "one picture, one legend" has to mean
    // once two domains are in it.
    expect(strokeOrder(result.svg)).toEqual(["#440154", "#1fa187"].sort());
    expect(fillOrder(result.svg)).toEqual(["#1fa187", "#440154", "#fde725"]);

    // ...and the narrowed render is exactly the point-only picture.
    const pointsOnly = renderSvg([makeGeometryItem(geo)], { attr: "w", attrDomain: "point" });
    expect(pointsOnly.colorDomains).toEqual(["point"]);
    expect(strokeOrder(pointsOnly.svg)).toEqual(["#2563eb"]);
  });

  it("renders a string primitive attribute categorically, by a hash of the value", () => {
    const geo = network();
    const kind = geo.attrs.primitive.add("roadKind", "string", 1);
    kind.setString(0, "avenue");
    kind.setString(1, "street");
    // Same two categories, opposite interning order.
    const flipped = network();
    const flippedKind = flipped.attrs.primitive.add("roadKind", "string", 1);
    flippedKind.setString(0, "street");
    flippedKind.setString(1, "avenue");

    const a = renderSvg([makeGeometryItem(geo)], { attr: "roadKind", width: 216 });
    const b = renderSvg([makeGeometryItem(flipped)], { attr: "roadKind", width: 216 });
    expect(a.colorDomains).toEqual(["primitive"]);
    expect(strokeOrder(a.svg)).toHaveLength(2);
    expect(strokeOrder(b.svg)).toEqual(strokeOrder(a.svg));
    // "avenue" keeps its color whichever edge interned it first: it is
    // the first edge in `a` and the second in `b`.
    expect(strokeOf(a.svg).get("M8 8L108 108")).toBe(strokeOf(b.svg).get("M108 108L208 8"));
    expect(strokeOf(a.svg).get("M108 108L208 8")).toBe(strokeOf(b.svg).get("M8 8L108 108"));
  });

  it("colors closed primitives too, and keeps closed and open groups apart", () => {
    const mesh = createTriangleMesh(
      Float32Array.of(0, 0, 0, 1, 0, 1, 2, 0, 0, 3, 0, 3),
      Uint32Array.of(0, 1, 2, 1, 2, 3),
    );
    const shade = mesh.attrs.primitive.add("shade", "f32", 1);
    shade.set(0, 0);
    shade.set(1, 1);
    const result = renderSvg([makeGeometryItem(mesh)], { attr: "shade" });
    expect(result.colorDomains).toEqual(["primitive"]);
    expect(strokeOrder(result.svg)).toEqual(["#440154", "#fde725"]);
    expect(result.svg).not.toContain("stroke-linecap");
  });

  it("normalizes the primitive ramp over the whole collection", () => {
    const low = network();
    const lowW = low.attrs.primitive.add("w", "f32", 1);
    lowW.set(0, 0);
    lowW.set(1, 1);
    const high = network();
    const highW = high.attrs.primitive.add("w", "f32", 1);
    highW.set(0, 100);
    highW.set(1, 200);
    const result = renderSvg([makeGeometryItem(low), makeGeometryItem(high)], { attr: "w" });
    // Range 0..200 across both items, exactly as for points.
    expect(strokeOrder(result.svg)).toEqual(["#1fa187", "#440154", "#fde725"].sort());
  });

  it("names the domain a narrowed lookup missed, and the domain that has it", () => {
    const geo = network();
    geo.attrs.primitive.add("roadWidth", "f32", 1);
    expect(() =>
      renderSvg([makeGeometryItem(geo)], { attr: "roadWidth", attrDomain: "point" }),
    ).toThrow(
      'item 0 has no point attribute "roadWidth" to color by, but item 0 carries it on the primitive domain — pass attrDomain "primitive", or drop attrDomain to color from both',
    );
    expect(() =>
      renderSvg([makeGeometryItem(geo)], { attr: "elevation", attrDomain: "primitive" }),
    ).toThrow(
      'item 0 has no primitive attribute "elevation" to color by; item 0 primitive attributes: primtype, roadWidth',
    );
  });

  it("refuses a domain that colors nothing, and a domain with no attribute to read", () => {
    const geo = network();
    expect(() =>
      // @ts-expect-error — the flag's whole job is to name a colorable domain.
      renderSvg([makeGeometryItem(geo)], { attr: "density", attrDomain: "vertex" }),
    ).toThrow('renderSvg: option "attrDomain" must be "point" or "primitive"');
    expect(() => renderSvg([makeGeometryItem(geo)], { attrDomain: "primitive" })).toThrow(
      'renderSvg: option "attrDomain" narrows which domain "attr" is read from',
    );
  });

  it("skips non-finite positions instead of poisoning the bounds", () => {
    const geo = createPointCloud(3);
    const P = geo.attrs.point.require("P");
    P.setTuple(0, [0, 0, 0]);
    P.setTuple(1, [Number.NaN, 0, 5]);
    P.setTuple(2, [4, 0, 4]);
    const result = renderSvg([makeGeometryItem(geo)]);
    expect(result.points).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.bounds).toEqual({ min: [0, 0], max: [4, 4] });
  });

  it("caps drawn points by striding, and reports both counts", () => {
    const positions: [number, number][] = Array.from({ length: 100 }, (_, i) => [i, 0]);
    const result = renderSvg(cloud(positions), { maxPoints: 10 });
    expect(result.pointsTotal).toBe(100);
    expect(result.points).toBe(10);
    expect(circles(result.svg)).toHaveLength(10);
  });

  it("never exceeds a cap that does not divide the total", () => {
    // A single integer stride has to round UP: rounding down lets 100
    // points at a cap of 30 draw 34.
    const positions: [number, number][] = Array.from({ length: 100 }, (_, i) => [i, 0]);
    const result = renderSvg(cloud(positions), { maxPoints: 30 });
    expect(result.points).toBeLessThanOrEqual(30);
    expect(result.points).toBe(25);
  });

  it("spends the caps across the whole collection, not once per geometry", () => {
    const many = Array.from({ length: 3 }, (_, g) =>
      makeGeometryItem(cloudGeo(Array.from({ length: 100 }, (_, i) => [g * 200 + i, 0] as const))),
    );
    const result = renderSvg(many, { maxPoints: 10 });
    expect(result.pointsTotal).toBe(300);
    expect(result.points).toBe(10);
    expect(circles(result.svg)).toHaveLength(10);
  });

  it("draws instance batches from their transforms' translations, one color per batch", () => {
    const batch = (x: number, z: number): Float32Array => {
      const t = new Float32Array(16);
      t[12] = x;
      t[14] = z;
      return t;
    };
    const item = makeInstancesItem([
      { assetId: "tree", count: 1, transforms: batch(1, 2) },
      { assetId: "rock", count: 1, transforms: batch(3, 4) },
    ]);
    const result = renderSvg([item]);
    expect(result.instances).toBe(2);
    expect(result.instancesTotal).toBe(2);
    expect(result.points).toBe(0);
    expect(circles(result.svg)).toHaveLength(2);
    expect(result.bounds).toEqual({ min: [1, 2], max: [3, 4] });
    expect(fillOrder(result.svg)).toEqual(["#4e79a7", "#f28e2b"]);
  });

  it("reports device-resident instances instead of silently drawing nothing", () => {
    const handle = { backend: "test", byteLength: 0, disposed: false, resource: null, dispose() {} };
    const item = makeDeviceInstancesItem([
      { residency: "device", assetId: "tree", count: 5, transforms: handle },
    ]);
    const result = renderSvg([...cloud([[0, 0], [1, 1]]), item]);
    expect(result.deviceInstances).toBe(5);
    expect(result.instances).toBe(0);
    expect(result.instancesTotal).toBe(0);
    expect(result.svg).toContain("5 device-resident instances not drawn");
  });

  it("says in the header comment what it drew, not what it was given", () => {
    const positions: [number, number][] = Array.from({ length: 100 }, (_, i) => [i, 0]);
    const result = renderSvg(cloud(positions), { maxPoints: 10 });
    expect(result.svg).toContain(
      "<!-- pcg render: 10 points, 0 instances, 0 primitives; x right, z down (top-down view) -->",
    );
  });

  it("centres a degenerate extent instead of dividing by it", () => {
    // One point, or N points on top of each other, leaves both extents at
    // zero; the frame falls back to a fixed pad and the content lands in
    // the middle of a square image.
    const one = renderSvg(cloud([[7, -3]]), { width: 40 });
    expect(one.height).toBe(40);
    expect(one.svg).toContain('viewBox="0 0 40 40"');
    expect(circles(one.svg)).toEqual(['<circle cx="20" cy="20" r="1.5"/>']);
    expect(one.bounds).toEqual({ min: [7, -3], max: [7, -3] });

    const stacked = renderSvg(cloud([[2, 2], [2, 2], [2, 2]]), { width: 40 });
    expect(circles(stacked.svg)).toHaveLength(3);
    expect(stacked.svg).toContain('viewBox="0 0 40 40"');
  });

  it("renders an empty collection as a valid, non-degenerate image", () => {
    const result = renderSvg([]);
    expect(result.points).toBe(0);
    expect(result.bounds).toBeUndefined();
    expect(result.svg.startsWith("<svg ")).toBe(true);
    expect(result.svg).toContain("</svg>");
    expect(result.height).toBeGreaterThan(0);
    expect(result.svg).toContain('viewBox="0 0 800 800"');
  });

  it("rejects option values that would produce a corrupt document", () => {
    const data = cloud([[0, 0], [1, 1]]);
    expect(() => renderSvg(data, { width: Number.NaN })).toThrow(
      'renderSvg: option "width" must be a finite number >= 1',
    );
    expect(() => renderSvg(data, { width: 0 })).toThrow('renderSvg: option "width"');
    expect(() => renderSvg(data, { width: -5 })).toThrow('renderSvg: option "width"');
    expect(() => renderSvg(data, { radius: 0 })).toThrow(
      'renderSvg: option "radius" must be a finite number > 0',
    );
    expect(() => renderSvg(data, { radius: -3 })).toThrow('renderSvg: option "radius"');
    expect(() => renderSvg(data, { radius: Number.NaN })).toThrow('renderSvg: option "radius"');
    // 0 is a cap of zero, not "no cap" — an option that silently disables
    // itself is the near-miss this CLI never allows.
    expect(() => renderSvg(data, { maxPoints: 0 })).toThrow('renderSvg: option "maxPoints"');
    expect(() => renderSvg(data, { maxPrimitives: 0 })).toThrow(
      'renderSvg: option "maxPrimitives"',
    );
    expect(() => renderSvg(data, { maxPoints: 2.5 })).toThrow('renderSvg: option "maxPoints"');
    expect(() => renderSvg(data, { width: 1, radius: 0.5, maxPoints: 1 })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Cross-process byte identity
// ---------------------------------------------------------------------------

/**
 * Node strips TypeScript without a flag from 22.18. Below that the child
 * process cannot load the sources and this file's cross-process check is
 * not runnable; every other test above still runs.
 */
const NODE_STRIPS_TYPES = ((): boolean => {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 18);
})();

const REPO = new URL("../../", import.meta.url);

/** Resolves the sources' `./x.js` specifiers to the `./x.ts` on disk. */
const LOADER = `
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
export function resolve(specifier, context, next) {
  if (/^\\.{1,2}\\//.test(specifier) && specifier.endsWith(".js") && context.parentURL !== undefined) {
    if (!existsSync(fileURLToPath(new URL(specifier, context.parentURL)))) {
      const ts = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(ts))) return next(ts.href, context);
    }
  }
  return next(specifier, context);
}
`;

const REGISTER = `
import { register } from "node:module";
register("./loader.mjs", import.meta.url);
`;

/**
 * Renders a deliberately hostile collection — mixed magnitudes, a scalar
 * ramp, a string attribute, a mesh, a polyline, two instance batches —
 * and writes the SVG to stdout.
 */
const CHILD = (repo: string): string => `
const { renderSvg } = await import(${JSON.stringify(`${repo}src/cli/render.ts`)});
const lib = await import(${JSON.stringify(`${repo}src/index.ts`)});
const geo = lib.createPointCloud(64);
const P = geo.attrs.point.require("P");
const h = geo.attrs.point.add("h", "f32", 1);
const tag = geo.attrs.point.add("tag", "string", 1);
const odd = [0, -0, 0.5, 0.125, 0.1, 1 / 3, 1e-7, 5e-4, 1e7, -3.4e38];
for (let i = 0; i < 64; i++) {
  P.setTuple(i, [odd[i % odd.length], 0, odd[(i * 7 + 3) % odd.length]]);
  h.set(i, odd[(i * 3) % odd.length]);
  tag.setString(i, ["oak", "pine", "fir", "elm", "ash"][i % 5]);
}
const mesh = lib.createTriangleMesh(
  Float32Array.of(0, 0, 0, 1, 0, 1, 2, 0, 0, 3, 0, 4),
  Uint32Array.of(0, 1, 2, 1, 2, 3),
);
const line = lib.createPolyline(Float32Array.of(0, 0, 0, 1, 0, 1, 2, 0, 0));
for (const g of [mesh, line]) {
  const column = g.attrs.point.add("tag", "string", 1);
  for (let i = 0; i < g.pointCount; i++) column.setString(i, ["fir", "oak", "pine"][i % 3]);
}
const t = (x, z) => { const m = new Float32Array(16); m[12] = x; m[14] = z; return m; };
const instances = lib.makeInstancesItem([
  { assetId: "tree", count: 1, transforms: t(9, -9) },
  { assetId: "rock", count: 1, transforms: t(-9, 9) },
]);
const collection = [
  lib.makeGeometryItem(geo),
  lib.makeGeometryItem(mesh),
  lib.makeGeometryItem(line),
  instances,
];
process.stdout.write(renderSvg(collection, { attr: "tag", width: 640, radius: 2 }).svg);
`;

describe.runIf(NODE_STRIPS_TYPES)("renderSvg across processes", () => {
  it("produces the same bytes in two separate node processes, locale and timezone apart", () => {
    const dir = mkdtempSync(join(tmpdir(), "pcg-render-"));
    try {
      writeFileSync(join(dir, "loader.mjs"), LOADER);
      writeFileSync(join(dir, "register.mjs"), REGISTER);
      writeFileSync(join(dir, "child.mjs"), CHILD(REPO.href));
      const run = (env: NodeJS.ProcessEnv): string =>
        execFileSync(
          process.execPath,
          ["--import", pathToFileURL(join(dir, "register.mjs")).href, join(dir, "child.mjs")],
          { encoding: "utf8", env: { ...process.env, ...env }, cwd: fileURLToPath(REPO) },
        );
      // A locale with dotless-i collation and a foreign timezone: two of
      // the classic ways a "deterministic" formatter turns out not to be.
      const a = run({});
      const b = run({ TZ: "Asia/Kolkata", LANG: "tr_TR.UTF-8", LC_ALL: "tr_TR.UTF-8" });
      expect(a.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(circles(a).length).toBeGreaterThan(8);
      expect(a).toContain("<path");
      expect(b).toBe(a);
      // The group order the file commits to is the sorted one.
      expect(fillOrder(a)).toEqual([...fillOrder(a)].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
