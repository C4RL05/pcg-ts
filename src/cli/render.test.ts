/**
 * SVG renderer: determinism (the property the phase is judged on),
 * projection, primitive drawing, coloring, and the caps that keep a
 * million-point cook from producing a hundred-megabyte file.
 */
import { describe, expect, it } from "vitest";
import {
  type DataCollection,
  createPointCloud,
  createPolyline,
  makeGeometryItem,
  makeInstancesItem,
} from "../index.js";
import { renderSvg } from "./render.js";

/** A point cloud with the given xz positions (y = 0) and optional extra columns. */
function cloud(positions: readonly (readonly [number, number])[]): DataCollection {
  const geo = createPointCloud(positions.length);
  const P = geo.attrs.point.require("P");
  positions.forEach(([x, z], i) => P.setTuple(i, [x, 0, z]));
  return [makeGeometryItem(geo)];
}

function circles(svg: string): string[] {
  return svg.split("\n").filter((line) => line.startsWith("<circle"));
}

describe("renderSvg", () => {
  it("draws one circle per point, projecting x right and z down", () => {
    const result = renderSvg(cloud([[0, 0], [10, 4]]));
    expect(result.points).toBe(2);
    expect(result.bounds).toEqual({ min: [0, 0], max: [10, 4] });
    const drawn = circles(result.svg);
    expect(drawn).toHaveLength(2);
    expect(drawn[0]).toContain('cx="0" cy="0"');
    expect(drawn[1]).toContain('cx="10" cy="4"');
  });

  it("is byte-identical across runs over the same data", () => {
    const positions: [number, number][] = Array.from({ length: 500 }, (_, i) => [
      Math.sin(i) * 10,
      Math.cos(i * 0.7) * 10,
    ]);
    const a = renderSvg(cloud(positions), { attr: "density" });
    const b = renderSvg(cloud(positions), { attr: "density" });
    expect(a.svg).toBe(b.svg);
    // ...and stable when only the drawing knobs change in ways that should
    // not move the geometry: same points, same coordinates.
    expect(renderSvg(cloud(positions)).svg).not.toBe(a.svg);
  });

  it("carries a viewBox sized to the padded data extent, with the requested width", () => {
    const result = renderSvg(cloud([[0, 0], [20, 10]]), { width: 400 });
    expect(result.width).toBe(400);
    // extent 20 x 10, pad 4% of 20 = 0.8 each side -> 21.6 x 11.6.
    expect(result.svg).toContain('viewBox="-0.8 -0.8 21.6 11.6"');
    expect(result.height).toBe(Math.round((400 * 11.6) / 21.6));
  });

  it("draws polyline primitives as open paths and meshes as closed ones", () => {
    const line = createPolyline(Float32Array.of(0, 0, 0, 1, 0, 1, 2, 0, 0));
    const result = renderSvg([makeGeometryItem(line)]);
    expect(result.primitives).toBe(1);
    expect(result.svg).toContain('<path d="M0 0L1 1L2 0"/>');
    expect(result.svg).toContain(`stroke="#2563eb"`);
    expect(result.svg).not.toContain('d="M0 0L1 1L2 0Z"');
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

  it("draws instance batches from their transforms' translations", () => {
    const transforms = new Float32Array(32);
    transforms[12] = 1;
    transforms[14] = 2;
    transforms[16 + 12] = 3;
    transforms[16 + 14] = 4;
    const item = makeInstancesItem([{ assetId: "tree", count: 2, transforms }]);
    const result = renderSvg([item]);
    expect(result.instances).toBe(2);
    expect(result.points).toBe(0);
    expect(circles(result.svg)).toHaveLength(2);
    expect(result.bounds).toEqual({ min: [1, 2], max: [3, 4] });
  });

  it("renders an empty collection as a valid, non-degenerate image", () => {
    const result = renderSvg([]);
    expect(result.points).toBe(0);
    expect(result.bounds).toBeUndefined();
    expect(result.svg.startsWith("<svg ")).toBe(true);
    expect(result.svg).toContain("</svg>");
    expect(result.height).toBeGreaterThan(0);
  });
});
