/**
 * A graph wide enough to exercise the panel's lens, built from real nodes.
 *
 * WHY THIS EXISTS. Two of the viewport tests are about a graph too wide
 * for the flat zoom floor: `zoomFloor` only lowers `MIN_ZOOM` when the
 * content cannot fit above it, so a subject has to be genuinely large or
 * the assertion passes for the wrong reason. The only graph in the
 * repository at that size was the racetrack demo's, at 238 nodes and
 * 23208 units across, and that demo is being retired.
 *
 * WHY A FIXTURE IS ACCEPTABLE HERE, given that `demoGraphPanel.test.ts`
 * argues against fixtures in its own header. That argument is about the
 * READER: its job is to survive whatever a page hands it, so a fixture
 * would keep passing the day a demo grew a node type the reader cannot
 * classify. It is a good argument and it still holds — every reader test
 * keeps running over the demos' real builders, and this fixture is not
 * added to that list.
 *
 * The LENS tests are a different question. They are about geometry:
 * bounds, aspect, and whether a fit lands inside a rect. Node types do
 * not enter into it. What they need is a shape, and taking that shape
 * from a demo was always incidental — it coupled a viewport assertion to
 * whichever demo happened to be biggest, which is how one of them ended
 * up written as `CASES[CASES.length - 1]` and silently changed meaning
 * when a demo was added after it.
 *
 * SO IT IS STILL A REAL GRAPH. Built with real node types through the
 * real `Graph` API and serialized through the real `serializeGraph`, not
 * a hand-written JSON blob that would drift the first time the format
 * moved. What it is not is a picture of anything — it is a chain wide
 * enough and a fan tall enough to reproduce the regime the retired demo
 * happened to occupy.
 */
import { Graph, type NodeHandle, mergePoints, pointGrid, setAttribute } from "pcg-ts";

/**
 * The shape the retired subject had, as measured before it was removed.
 *
 * Kept as numbers rather than as prose so the fixture can be checked
 * against them: a stand-in nobody has compared to the thing it stands in
 * for is just a different graph.
 */
export const RETIRED_WIDE_SUBJECT = {
  nodes: 238,
  widthUnits: 23208,
  heightUnits: 1596,
  aspect: 14.54,
} as const;

export interface WideGraphOptions {
  /** Columns. The chain's length is what makes the graph wide. */
  readonly depth?: number;
  /** Parallel chains. What gives it height, and so an aspect ratio. */
  readonly branches?: number;
  readonly seed?: number;
}

/**
 * A wide graph: `branches` parallel chains of `depth` attribute writes,
 * merged at the end.
 *
 * The defaults are fitted to {@link RETIRED_WIDE_SUBJECT}: 95 columns
 * reproduce its width of 23208 units exactly, which is the number
 * `viewport.ts` quotes when it explains why the flat floor is not enough.
 *
 * The ASPECT is more extreme than the retired subject's — about 40 to 1
 * against 14.5 — because a chain-and-fan is inherently wider than a graph
 * with real fan-in. That makes this a HARDER case for the lens, not a
 * weaker one: it fits at 0.032 where the racetrack fitted at 0.034, so
 * every assertion about clearing the floor and landing inside the rect is
 * asked of a graph that clears it by more. Said out loud because a
 * stand-in that is quietly easier than what it replaced is the failure
 * mode worth guarding against.
 */
export function buildWideGraph(opts: WideGraphOptions = {}): Graph {
  const depth = opts.depth ?? 95;
  const branches = opts.branches ?? 4;
  const g = new Graph(opts.seed ?? 1);

  const source = g.add(pointGrid, { countX: 4, countY: 1, countZ: 4, spacing: [10, 10, 10] }, "source");

  const tails: NodeHandle[] = [];
  for (let b = 0; b < branches; b++) {
    let head: NodeHandle = source;
    for (let i = 0; i < depth; i++) {
      // A different attribute name per node so nothing downstream can
      // collapse the chain, and a param row so the boxes have the height
      // a real node has.
      const n = g.add(
        setAttribute,
        { name: `w${b}_${i}`, tupleSize: 1, value: i + 1 },
        `branch${b}_step${i}`,
      );
      g.connect(head, "out", n, "in");
      head = n;
    }
    tails.push(head);
  }

  const merged = g.add(mergePoints, {}, "merged");
  for (const t of tails) g.connect(t, "out", merged, "in");
  g.output(merged, "out", "out");
  return g;
}
