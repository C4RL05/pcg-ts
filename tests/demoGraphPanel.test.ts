/**
 * The demos' read-only graph view, checked against the demos' own graphs.
 *
 * The picture is built in the browser and nothing here can look at it, so
 * what is checked is everything upstream of the pixels: that each demo's
 * graph survives the round trip into a serialized form, that the reader
 * turns it into boxes and cables with no dangling ends, that the layout is
 * a function of the graph and not of when it ran, and that every page
 * is actually wired to the panel.
 *
 * IT USES THE DEMOS' REAL BUILDERS, not a fixture. The reader's whole job
 * is to survive whatever a page hands it, and a fixture graph would pass
 * this suite on the day a demo grew a node type the reader cannot
 * classify. That applies to every reader case below and it is why they
 * are built from the demos' own builders.
 *
 * THE LENS IS THE EXCEPTION, and deliberately. Its tests are about bounds
 * and zoom, which no node type enters into; what they need is a graph
 * wide enough that the flat floor cannot show it. That used to be the
 * racetrack demo's 238-node graph purely because it was the biggest thing
 * in the repository — a coupling that made a viewport assertion depend on
 * which demos existed. It is now `tests/support/wideGraph.ts`, which is
 * what let that demo be retired without the lens tests going quiet.
 *
 * The reader cases lost their largest REAL subject with it: the biggest
 * that remains is `gpu-world/spires`. Seven real demo graphs still cover
 * the classification the header is about, but not at that size.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { serializeGraph, type Graph, type SerializedGraph } from "pcg-ts";
import { NODE_W, nodeHeight } from "../shared/graph/layout.js";
import { readGraph } from "../shared/graph/fromSerialized.js";
import { MIN_ZOOM, contentBounds, fitZoom, framed, zoomFloor } from "../shared/graph/viewport.js";
import { edgePath } from "../shared/graph/wires.js";
import { previewRows } from "../shared/graph/view.js";
import { deriveGalaxy, makeHaloLevel, makeStarLevel } from "../demos/galaxy/galaxy.js";
import { makeSpireLevel } from "../demos/gpu-world/levels.js";
import { makeLandmarkLevel, makeRockLevel } from "../demos/infinite-world/levels.js";
import { buildRoadGraph } from "../demos/racetrack/graph.js";
import { buildDressingGraph } from "../demos/racetrack/levels.js";
import { makeTrackSpline } from "../demos/racetrack/spline.js";
// Aliased, not renamed at the source: `road` is a deliberate copy
// of `road` and its module names are identical on purpose. See the header
// of demos/road/main.ts.
import { buildRoadGraph as buildSimpleRoadGraph } from "../demos/road/graph.js";
import { RETIRED_WIDE_SUBJECT, buildWideGraph } from "./support/wideGraph.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Every graph the demos put in front of the panel. */
function demoGraphs(): { name: string; graph: Graph }[] {
  const form = deriveGalaxy(7);
  return [
    { name: "galaxy/halo", graph: makeHaloLevel(form).graph },
    { name: "galaxy/stars", graph: makeStarLevel(form, 400).graph },
    { name: "gpu-world/spires", graph: makeSpireLevel(1, 200, 40).graph },
    { name: "infinite-world/landmarks", graph: makeLandmarkLevel().graph },
    {
      name: "infinite-world/rocks",
      graph: makeRockLevel({ cellSize: 64, generationRadius: 200, anchored: true, halo: true })
        .graph,
    },
    {
      name: "racetrack/dressed",
      graph: buildRoadGraph({ spline: makeTrackSpline({ seed: 1 }), seed: 1 }),
    },
    {
      // The streamed level's own graph, which the panel shows beside the
      // lap's. It needs no cooked lap -- only a half-width and a seed --
      // so it costs this suite nothing to cover.
      name: "racetrack/dressing",
      graph: buildDressingGraph({ seed: 1, halfWidth: 9 }).graph,
    },
    {
      name: "road/verges",
      graph: buildSimpleRoadGraph({ spline: makeTrackSpline({ seed: 1 }), seed: 1 }),
    },
  ];
}

const CASES: { name: string; json: SerializedGraph }[] = demoGraphs().map((g) => ({
  name: g.name,
  json: serializeGraph(g.graph),
}));

/**
 * The lens' wide subject, which is NOT one of the demos.
 *
 * The reader cases above stay on the demos' real builders for the reason
 * this file's header gives. The lens is a different question — bounds and
 * zoom, with no node type in it — and taking its subject from whichever
 * demo happened to be biggest is what let one of these assertions be
 * written as `CASES[CASES.length - 1]` and silently change meaning when a
 * demo was added after it. See `tests/support/wideGraph.ts`.
 */
const WIDE = serializeGraph(buildWideGraph());

/** Bounds and preview rows for a serialized graph, as the panel takes them. */
function boundsOf(json: SerializedGraph): ReturnType<typeof contentBounds> {
  const pic = readGraph(json);
  return contentBounds(pic.nodes, new Map([...pic.previews].map(([id, r]) => [id, r.length])));
}

describe("the demos' graphs reach the panel", () => {
  it.each(CASES)("$name serializes and reads into a picture", ({ json }) => {
    const pic = readGraph(json);
    expect(pic.nodes.length).toBe(json.nodes.length);
    expect(pic.edges.length).toBe(json.connections.length);
    // Every box knows what it is: an unknown type would have come back
    // with no pins and no icon, which draws as an empty rectangle.
    for (const n of pic.nodes) expect(n.type).not.toBe("");
  });

  it.each(CASES)("$name draws every cable it declares", ({ json }) => {
    const pic = readGraph(json);
    const byId = new Map(pic.nodes.map((n) => [n.id, n]));
    // A null path is a cable with an endpoint the reader could not find —
    // a pin the registry does not report, or a node id nothing matches. It
    // is drawn as nothing at all, so the connection would silently vanish
    // from the picture rather than show up wrong.
    const missing = pic.edges.filter((e) => edgePath(byId, e) === null);
    expect(missing).toEqual([]);
  });

  it.each(CASES)("$name lays out with no two boxes overlapping", ({ json }) => {
    const pic = readGraph(json);
    const rows = new Map([...pic.previews].map(([id, r]) => [id, r.length]));
    const boxes = pic.nodes.map((n) => ({
      id: n.id,
      x0: n.x,
      x1: n.x + NODE_W,
      y0: n.y,
      y1: n.y + nodeHeight(n, rows.get(n.id) ?? 0),
    }));
    const hits: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) {
          hits.push(`${a.id} / ${b.id}`);
        }
      }
    }
    // The layout is told each box's param-band height, so a column packed
    // as if the boxes were bare is the specific bug this catches: it looks
    // like a working graph until you read one, and then the rows of the box
    // below are under the box above.
    expect(hits).toEqual([]);
  });

  it.each(CASES)("$name lays out the same way every time", ({ json }) => {
    const a = readGraph(json);
    const b = readGraph(json);
    // Positions are invented by the reader rather than carried by the
    // format, so "the same graph looks the same" is a promise only this
    // makes. Without it a thumbnail would reshuffle between reloads and
    // two pages showing one graph would disagree about its shape.
    expect(b.nodes.map((n) => [n.id, n.x, n.y])).toEqual(a.nodes.map((n) => [n.id, n.x, n.y]));
  });
});

describe("the lens", () => {
  const rect = { width: 800, height: 500, left: 0, top: 0 } as DOMRect;

  /**
   * THE STAND-IN IS STILL STANDING IN FOR SOMETHING.
   *
   * A fixture nobody has compared to the thing it replaced is just a
   * different graph, and the comparison cannot be made later — the
   * subject is being deleted. So its measurements are pinned here, taken
   * while both existed, and the fixture is checked against them.
   *
   * WIDTH IS THE PROPERTY THAT MATTERS. `zoomFloor` lowers `MIN_ZOOM`
   * only when the content cannot fit above it, so a subject that is not
   * genuinely wide makes every assertion below pass for the wrong reason.
   */
  it("stands where the retired subject stood", () => {
    const b = boundsOf(WIDE);
    expect(b).not.toBeNull();
    const w = b as NonNullable<typeof b>;

    // The same width, to within a column.
    expect(Math.abs(w.w - RETIRED_WIDE_SUBJECT.widthUnits)).toBeLessThan(300);

    // And the same regime: it clears the flat floor, by at least as much
    // as the graph it replaced did.
    const fit = fitZoom(w, rect);
    expect(fit).toBeLessThan(MIN_ZOOM);
    expect(fit).toBeLessThanOrEqual(rect.width / RETIRED_WIDE_SUBJECT.widthUnits + 1e-9);
  });

  /**
   * THE CONTROL. The assertions above are only about a wide graph if a
   * graph that is NOT wide fails them — otherwise `fitZoom < MIN_ZOOM`
   * could be true of everything and prove nothing. The road demo's graph
   * is ten nodes and fits this viewport at about a third.
   */
  it("does not clear the floor for an ordinary demo graph", () => {
    const road = CASES.find((c) => c.name === "road/verges");
    const b = boundsOf((road as NonNullable<typeof road>).json);
    expect(fitZoom(b as NonNullable<typeof b>, rect)).toBeGreaterThan(MIN_ZOOM);
    expect(zoomFloor(b, rect)).toBe(MIN_ZOOM);
  });

  it("frames a whole graph inside the viewport", () => {
    const b = boundsOf(WIDE);
    expect(b).not.toBeNull();
    // With the floor an interactive view uses: `zoomFloor` is exactly "far
    // enough out to see everything", so framing at it must put everything
    // inside the viewport for a graph this wide too.
    const view = framed(b, rect, { floor: zoomFloor(b, rect) });
    const w = b as NonNullable<typeof b>;
    expect(view.x + w.minX * view.z).toBeGreaterThanOrEqual(0);
    expect(view.y + w.minY * view.z).toBeGreaterThanOrEqual(0);
    expect(view.x + (w.minX + w.w) * view.z).toBeLessThanOrEqual(rect.width);
    expect(view.y + (w.minY + w.h) * view.z).toBeLessThanOrEqual(rect.height);
  });

  it("holds the flat floor for a graph small enough to need it", () => {
    const small = CASES.find((c) => c.name === "infinite-world/landmarks");
    const pic = readGraph((small as NonNullable<typeof small>).json);
    const rows = new Map([...pic.previews].map(([id, r]) => [id, r.length]));
    const b = contentBounds(pic.nodes, rows);
    // Three nodes fit far above MIN_ZOOM, so the content-derived floor
    // must defer to the flat one: the point of zoomFloor is to LOWER the
    // floor for a graph that needs it, never to raise it for one that
    // does not.
    expect(zoomFloor(b, rect)).toBe(MIN_ZOOM);
  });

  it("lowers the floor to fit a graph too wide for the flat one", () => {
    // This once read `CASES[CASES.length - 1]`, meaning "the racetrack"
    // only until a demo was added after it, at which point the assertion
    // silently changed what it was about. Naming the case fixed that; a
    // subject that is not a demo at all removes the hazard.
    const b = boundsOf(WIDE);
    // A graph this wide fits this viewport at about 0.03. A flat 0.2
    // floor would let it be framed and then refuse to zoom back out to
    // that framing, which is a view with a home it will not return to.
    expect(zoomFloor(b, rect)).toBeLessThan(MIN_ZOOM);
    expect(zoomFloor(b, rect)).toBe(fitZoom(b as NonNullable<typeof b>, rect));
  });

  it("survives a viewport with no size", () => {
    // A modal measures zero on the frame it opens. Framing against that
    // used to divide by zero and strand the view at NaN.
    const zero = { width: 0, height: 0, left: 0, top: 0 } as DOMRect;
    const view = framed(null, zero, {});
    expect(Number.isFinite(view.x) && Number.isFinite(view.y) && Number.isFinite(view.z)).toBe(true);
  });
});

describe("the param rows", () => {
  it("names them all when there are few", () => {
    const rows = previewRows([
      { key: "count", value: "350", field: false },
      { key: "seed", value: "0", field: false },
    ]);
    expect(rows.map((r) => r.key)).toEqual(["count", "seed"]);
  });

  it("counts the tail when there are many", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      key: `p${i}`,
      value: String(i),
      field: false,
    }));
    const rows = previewRows(many);
    // Three named and a count, not nine rows: a box taller than the graph
    // it sits in is not a preview.
    expect(rows.length).toBe(4);
    expect(rows[3].value).toBe("+6 more");
  });

  it("marks a field as a different kind of answer, not a different value", () => {
    const rows = previewRows([{ key: "amount", value: "ƒ fbm(perlin)", field: true }]);
    expect(rows[0].field).toBe(true);
  });
});

describe("the demos are wired to it", () => {
  const DEMOS = ["galaxy", "gpu-world", "infinite-world", "racetrack", "road"];

  it.each(DEMOS)("%s attaches the graph panel", (demo) => {
    const src = readFileSync(`${ROOT}demos/${demo}/main.ts`, "utf8");
    // A demo that builds a graph and never shows it is the state this
    // whole feature exists to end, and it is invisible from any test that
    // only looks at the shared module.
    expect(src).toContain("attachGraphPanel");
  });

  it.each(DEMOS)("%s puts it in its own panel, not a second one", (demo) => {
    const src = readFileSync(`${ROOT}demos/${demo}/main.ts`, "utf8");
    // Two panels on one page is two claims about where the chrome is. The
    // `into` argument is required, so a demo cannot drift back to a
    // floating card without this failing to compile first — this only
    // catches the case where someone adds a container that is not the
    // demo's own overlay.
    // The slot is claimed where the panel is BUILT, not where it is filled,
    // so each page decides where in its own panel the graph sits — under
    // the readouts and above the prose, which on two of these pages is the
    // difference between visible and below the fold.
    expect(src).toContain("overlay.addSlot()");
    expect(src).toContain("into: graphSlot");
  });

  /**
   * The pairing that makes the modal work, and the one nothing else would
   * catch.
   *
   * `position: fixed` is relative to the viewport only while no ancestor is
   * a containing block for it, and an ancestor becomes one by carrying a
   * filter, a backdrop-filter, or a transform. The demos' panel carries
   * `backdrop-filter: blur(6px)` — so the graph modal, which now renders
   * inside that panel, has to be moved to the body or it opens at the size
   * of the 300px card it was launched from. Measured in a browser with the
   * portal removed: the "full-screen" backdrop came out 298x658, and the
   * wheel died with it.
   *
   * Either side may legitimately change. What may not happen is the blur
   * staying while the portal goes.
   */
  it("moves the modal out of the panel for as long as the panel is filtered", () => {
    const overlay = readFileSync(`${ROOT}shared/overlay.ts`, "utf8");
    const panel = readFileSync(`${ROOT}shared/graph/GraphPanel.svelte`, "utf8");
    const traps = /backdrop-filter:(?!\s*none)|[^-]filter:(?!\s*none)|transform:(?!\s*none)/.test(
      overlay,
    );
    if (traps) expect(panel).toContain("use:portal");
  });

  /**
   * BOTH OF THESE ARE TEXT CHECKS, and both were bugs that shipped.
   *
   * Neither is reachable from Node: one is browser scheduling and the
   * other is a CSS width, and the only way either was ever going to be
   * caught is by looking at the page on hardware and at a window size that
   * happens to expose it. Both went out green on a box fast enough and a
   * monitor narrow enough to hide them. A text check is a weak test, and a
   * weak test that names the exact mistake is worth more here than the
   * strong test that does not exist — the same trade `narrowBreakpoint`
   * makes for the same reason.
   */
  it("reads the graph without waiting for an idle window", () => {
    const panel = readFileSync(`${ROOT}shared/graph/GraphPanel.svelte`, "utf8");
    // `requestIdleCallback` with no timeout is a request, not a promise.
    // Every page this panel sits on runs a render loop that streams and
    // cooks, so on a machine 8x slower than the one this was written on
    // the card stayed BLACK for six seconds waiting for an idle window the
    // demo never left it. There is no bound on that wait, only the speed
    // of the box you tested on.
    // The CALL, with its paren: the comment above the read explains why
    // the scheduling is gone, and a check that forbade the word would fail
    // on the explanation for the bug it exists to prevent.
    expect(panel).not.toContain("requestIdleCallback(");
  });

  it("leaves no backdrop gap for the wheel to fall into", () => {
    const panel = readFileSync(`${ROOT}shared/graph/GraphPanel.svelte`, "utf8");
    // The sheet was capped at 1400px inside a full-screen backdrop, which
    // on a 2560px monitor left 580px of bare backdrop down each side: 45%
    // of the screen that looks like the graph view and swallows the wheel,
    // because the wheel belongs to the SVG and the SVG stops at the cap.
    // It reads as "zoom does not work".
    const sheet = panel.slice(panel.indexOf("  .sheet {"));
    expect(sheet.slice(0, sheet.indexOf("}"))).not.toMatch(/max-width|width:\s*min\(/);
  });

  it("keeps the hook the capture script hides", () => {
    const panel = readFileSync(`${ROOT}shared/graph/GraphPanel.svelte`, "utf8");
    const capture = readFileSync(`${ROOT}scripts/capture-demos.mjs`, "utf8");
    // Renaming the class on one side leaves the committed demo screenshots
    // with a node graph in the corner of all four, which is exactly the
    // kind of break that gets noticed a release later.
    expect(panel).toContain("pcg-graph-panel");
    expect(capture).toContain(".pcg-graph-panel { display: none !important; }");
  });
});
