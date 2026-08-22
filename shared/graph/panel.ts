/**
 * One call that puts a demo's graph in the corner of its page.
 *
 * The demos are plain DOM — `shared/overlay.ts` builds their panels by
 * hand — and the graph view is Svelte, per the project's rule that
 * anything richer than plain HTML is. This is the seam between them, and
 * it exists so that adding the panel to a demo is one import and one call
 * rather than each of the four pages learning how to mount a component.
 *
 * It mounts INTO A SLOT the demo's own overlay hands out, rather than
 * floating a second panel over the page. `into` is required for that
 * reason: an optional target would default to the body, and the default is
 * exactly the arrangement this replaced.
 *
 * IT TAKES LIVE GRAPHS AND SERIALIZES THEM ITSELF. The alternative was to
 * take the JSON and let each demo call `serializeGraph`, which is one more
 * line per page and one more chance for two pages to hand the panel
 * different things. Serializing here also puts the cost in one place where
 * it can be moved off the critical path — it happens on the demo's own
 * graph objects, which are already built by the time a page has anything
 * to draw.
 */
import { mount, unmount } from "svelte";
import { serializeGraph, type Graph } from "pcg-ts";
import GraphPanel from "./GraphPanel.svelte";

/** One graph a demo is willing to show, and what to call it. */
export interface PanelGraph {
  /** Tab label and thumbnail caption — what this graph MAKES, ideally. */
  readonly name: string;
  readonly graph: Graph;
}

export interface GraphPanelHandle {
  /**
   * Replace what the panel shows.
   *
   * A demo that rebuilds its graph — a new seed, a new preset — has a new
   * graph, and the panel would otherwise keep showing the one that
   * produced the previous frame. Calling this with the same graphs is
   * harmless but not free (it re-serializes and re-lays-out), so call it
   * when the graph changed, not every frame.
   */
  set(graphs: readonly PanelGraph[]): void;
  destroy(): void;
}

interface Entry {
  readonly name: string;
  readonly json: ReturnType<typeof serializeGraph>;
}

/**
 * Serialize what can be serialized, and drop what cannot.
 *
 * A graph that refuses to serialize is a graph this panel cannot show —
 * a reference to a subgraph that is no longer registered is the documented
 * case — and the page it belongs to is otherwise working. So it is left
 * out, with the reason on the console for whoever is looking, rather than
 * taken as a reason to fail the demo.
 */
function serializeAll(graphs: readonly PanelGraph[]): Entry[] {
  const out: Entry[] = [];
  for (const g of graphs) {
    try {
      out.push({ name: g.name, json: serializeGraph(g.graph) });
    } catch (err) {
      console.warn(`graph panel: "${g.name}" could not be serialized, so it is not shown`, err);
    }
  }
  return out;
}

/** Mount the graph panel on the current page. */
export function attachGraphPanel(
  graphs: readonly PanelGraph[],
  opts: { into: HTMLElement; title?: string },
): GraphPanelHandle {
  const host = document.createElement("div");
  opts.into.appendChild(host);
  const app = mount(GraphPanel, {
    target: host,
    props: { initial: serializeAll(graphs), title: opts.title ?? "graph" },
  });
  // The component's own `setGraphs`. Props cannot carry the update: making
  // one reactive from here would need a `$state` object, and a rune outside
  // a component means a `.svelte.ts` module, which `tsc --noEmit` cannot
  // read without teaching it Svelte's ambient types (see `svelte-shim.d.ts`
  // for how shallowly it reads components today). A component export is the
  // same reactivity through a door that is already open.
  const instance = app as unknown as { setGraphs(next: readonly Entry[]): void };
  return {
    set(next) {
      instance.setGraphs(serializeAll(next));
    },
    destroy() {
      void unmount(app);
      host.remove();
    },
  };
}
