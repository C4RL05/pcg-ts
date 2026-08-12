/// <reference types="vite/client" />
/**
 * The graph corpus under `examples/graphs/` as a pickable list.
 *
 * Those 40 files already exist as the corpus the preview page renders and
 * `scripts/gen-examples.mjs` catalogs; each carries its own `meta` block
 * with a title and a description. The sandbox picks from the same set, so
 * a preset is not a new artefact to maintain — adding a graph to the
 * corpus adds it to the menu.
 *
 * TWO GLOBS, ON PURPOSE. The metadata is eager, because a menu has to
 * render before anything is chosen; the graph bodies are lazy, because
 * the corpus is ~288 KB and a page that loads all of it to show a
 * dropdown has paid for 39 graphs nobody asked for. The eager glob names
 * `meta` as its import so only that key is pulled in — the bodies stay in
 * their own chunks, fetched when picked.
 */

interface PresetMeta {
  readonly title?: string;
  readonly description?: string;
}

const META = import.meta.glob<PresetMeta>("../graphs/*.json", { eager: true, import: "meta" });
const BODY = import.meta.glob("../graphs/*.json", { query: "?raw", import: "default" });

const PREFIX = "../graphs/";
const SUFFIX = ".json";

const nameOf = (key: string): string => key.slice(PREFIX.length, -SUFFIX.length);

export interface Preset {
  /** File stem, e.g. "basics-scatter-in-bounds". Also the `?graph=` value. */
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** Leading segment of the file name — the corpus's own grouping. */
  readonly group: string;
}

/**
 * Every corpus graph, sorted by file name so the menu order is the
 * directory order and two builds never disagree about it. A file with no
 * `meta.title` falls back to its own name rather than vanishing: a graph
 * that is hard to label is exactly the one worth being able to open.
 */
export const PRESETS: readonly Preset[] = Object.keys(META)
  .sort()
  .map((key) => {
    const name = nameOf(key);
    const meta = META[key];
    const dash = name.indexOf("-");
    return {
      name,
      title: meta?.title ?? name,
      description: meta?.description ?? "",
      group: dash < 0 ? name : name.slice(0, dash),
    };
  });

/** Group names in first-appearance order, for the menu's optgroups. */
export const PRESET_GROUPS: readonly string[] = [...new Set(PRESETS.map((p) => p.group))];

export function findPreset(name: string): Preset | undefined {
  return PRESETS.find((p) => p.name === name);
}

/**
 * The graph's serialized JSON as text — the shape `deserializeGraph` and
 * the editor's own import path already take, so a preset load is the
 * import path with the paste step removed.
 */
export async function loadPresetText(name: string): Promise<string> {
  const load = BODY[`${PREFIX}${name}${SUFFIX}`];
  if (load === undefined) {
    throw new Error(
      `no graph named "${name}" in examples/graphs. Known: ${PRESETS.map((p) => p.name).join(", ")}`,
    );
  }
  return (await load()) as string;
}
