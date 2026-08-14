/**
 * `forEach`: cook an inner graph once per element instead of once.
 *
 * The gap this closes is old. `partitionByAttribute` emits one geometry per
 * distinct value on a single pin, and every standard node consumes exactly
 * one geometry — so per-region treatment meant K hand-built parallel
 * branches, and `requireGeometry`'s diagnostic told authors to drive the
 * collection from TypeScript because in-graph there was nowhere to put the
 * loop. This is that loop.
 *
 * WHY IT LIVES IN THE NODES LAYER and not beside `subgraphNode`: the
 * per-point mode slices one point into its own geometry with
 * `gatherPoints`, which is nodes-layer machinery. `src/nodes` imports
 * `src/graph` and never the other way round, so the loop comes down to the
 * helper rather than the helper going up to the loop.
 *
 * TWO MODES, NAMED BY A PIN, NOT BY A PARAM. Exactly one exposed input must
 * be called `each` or `eachPoint`; that pin is what the body iterates, and
 * every other exposed input is BROADCAST — passed whole to every iteration,
 * so a shared spine or a lookup surface reaches all of them.
 *
 *   each       one iteration per ITEM of the collection on that pin
 *   eachPoint  one iteration per POINT of the one geometry on that pin,
 *              the body seeing a one-point cloud
 *
 * Encoding the mode as a reserved pin name rather than a param is not a
 * trick to save a field. The serialized format is closed at every object
 * position and a new key there arrives with a `formatVersion` bump, which
 * would move `hashableGraph` and so every registered primitive's content
 * hash, breaking every pinned `ref` in the wild — to say which of two
 * things a node already says with a name it already carries. Reserved names
 * are this format's existing idiom (`__in_`, `__out_`), and a third mode
 * later is one more name and no format change at all.
 *
 * WHAT SEEDS AN ITERATION is the question worth getting right, and the
 * answer is `hashCombine(nodeSeed, itemKey(item))` — content, never the
 * array index. See `src/graph/itemKey.ts`; the short version is that the
 * order of a collection is an artefact (discovery order out of
 * `partitionByAttribute`, connection order through `assembleInputs`,
 * whatever the host passed through `dataInput`) and none of those is
 * supposed to change what a group generates.
 *
 * WHAT IT COSTS, stated rather than glossed: the body gets NO memo reuse
 * between iterations, and cannot. Each iteration rotates the inner graph's
 * seed, which changes `deriveNodeSeed` for every inner node, hence every
 * inner memo key — and a node holds one cache slot, so iteration k+1 evicts
 * iteration k wholesale. That is the price of per-iteration randomness and
 * it is not recoverable by caching harder. The forEach node itself memoizes
 * normally, so an unchanged graph still costs nothing on a recook.
 */
// Imported from the graph modules directly rather than through
// `../graph/index.js`: the wrapper machinery below is `@internal` and
// re-exporting it there would carry it out through `src/index.ts` into the
// package surface, where nothing outside needs it.
import {
  type DataCollection,
  type DataItem,
  type GeometryItem,
  makeGeometryItem,
  makeValueItem,
} from "../graph/data.js";
import { GraphValidationError } from "../graph/errors.js";
import { cook, withExclusiveGraph } from "../graph/execute.js";
import type { Graph } from "../graph/graph.js";
import { itemKey, pointIdentityColumn, pointItemKey } from "../graph/itemKey.js";
import { type NodeDef, type PinDef, defineNode } from "../graph/node.js";
import {
  type ExposedParam,
  type ExposedPin,
  checkExposedValues,
  prepareWrapper,
  recordWrapperSpec,
  transitiveVersionKey,
  withExposedParams,
} from "../graph/subgraph.js";
import { hashCombine, hashString } from "../random/hash.js";
import { gatherPoints } from "./util.js";

/** The reserved exposed-input names, and what each iterates. */
export const ITERATED_PIN_NAMES = ["each", "eachPoint"] as const;
export type IterationMode = (typeof ITERATED_PIN_NAMES)[number];

/**
 * Ceiling on iterations, and the reason there is one.
 *
 * `eachPoint` over a scattered cloud is an easy accident — the pin takes
 * any geometry, and a 40,000-point cloud asks for 40,000 full inner cooks
 * with no cache reuse between them. Unbounded, that is a page that stops
 * responding with nothing on screen to explain why. The number is chosen to
 * be far above any real fan-out (a rig's cables, a settlement's districts,
 * a species list) and far below the size of a cloud someone scattered.
 */
export const MAX_ITERATIONS = 4096;

/** Which exposed input drives the loop, and how. */
function resolveIteratedPin(exposedInputs: readonly ExposedPin[]): {
  name: string;
  mode: IterationMode;
} {
  const found = exposedInputs.filter((e): e is ExposedPin & { name: IterationMode } =>
    (ITERATED_PIN_NAMES as readonly string[]).includes(e.name),
  );
  if (found.length === 0) {
    throw new GraphValidationError(
      `forEach: no iterated input. Exactly one exposed input must be named "each" (one iteration per item ` +
        `of the collection) or "eachPoint" (one iteration per point of the one geometry); every other exposed ` +
        `input is broadcast whole to every iteration. Exposed inputs here: ` +
        `${exposedInputs.map((e) => `"${e.name}"`).join(", ") || "(none)"}. Rename the one the body iterates.`,
    );
  }
  if (found.length > 1) {
    throw new GraphValidationError(
      `forEach: ${found.length} iterated inputs (${found.map((e) => `"${e.name}"`).join(", ")}), but a loop ` +
        "runs over one thing. Keep the pin the body iterates and rename the others — they stay available, " +
        "broadcast whole to every iteration.",
    );
  }
  return { name: found[0].name, mode: found[0].name };
}

/** Name the iteration in an error, by everything except its position. */
function describeIteration(index: number, key: number, tags: ReadonlySet<string>): string {
  const tagList = tags.size === 0 ? "no tags" : [...tags].sort().join(", ");
  // The index is in the message and NOT in the seed. Diagnostics may say
  // where a thing sat; only content may decide what it generates.
  return `iteration ${index} (key ${key.toString(16).padStart(8, "0")}, ${tagList})`;
}

/**
 * Re-mint `item` carrying `tags` as well as its own.
 *
 * The loop's structure is otherwise lost on the way out: a body that emits
 * a cloud per group hands back K clouds that no longer say which group each
 * came from, so `partitionByAttribute` → `forEach` → `filterByTag` could
 * not work. Instances items pass through untouched — re-minting one means
 * re-wrapping device batches whose handles the receiver already owns, and
 * a routing tag is not worth reasoning about handle ownership for.
 */
function withInheritedTags(item: DataItem, tags: ReadonlySet<string>): DataItem {
  if (tags.size === 0) return item;
  let missing = false;
  for (const tag of tags) {
    if (!item.tags.has(tag)) {
      missing = true;
      break;
    }
  }
  if (!missing) return item;
  const merged = new Set([...item.tags, ...tags]);
  if (item.kind === "geometry") return makeGeometryItem(item.geo, merged);
  if (item.kind === "value") return makeValueItem(item.value, merged);
  return item;
}

/**
 * Wrap an inner graph as a node that cooks it once per element.
 *
 * Same construction as `subgraphNode` — exposed inputs become pins fed by
 * injected portals, exposed outputs become inner output declarations,
 * exposed params become the wrapper's own knobs — with one added rule:
 * exactly one exposed input must be named `each` or `eachPoint`.
 *
 * Each iteration's outputs are concatenated onto the matching output pin,
 * in the iterated collection's own order. Deliberately not sorted by key:
 * an author reordering the input is supposed to see the output reorder with
 * it, and a sort would hide exactly the upstream-reordering bug the
 * equivariance test exists to catch.
 */
export function forEachNode(
  inner: Graph,
  exposedInputs: readonly ExposedPin[],
  exposedOutputs: readonly ExposedPin[],
  exposedParams: readonly ExposedParam[] = [],
): NodeDef<Record<string, unknown>> {
  const iterated = resolveIteratedPin(exposedInputs);
  const parts = prepareWrapper(inner, exposedInputs, exposedOutputs, exposedParams);
  const { portals, paramList } = parts;
  // The iterated pin never carries a collection into the body — one item at
  // a time does — so it is single-valued on the wrapper regardless of what
  // the inner pin behind it accepts.
  const inputPins: PinDef[] = parts.inputPins.map((pin) =>
    pin.name === iterated.name ? { name: pin.name, kind: pin.kind } : pin,
  );

  const def = defineNode<Record<string, unknown>>({
    type: "forEach",
    inputs: inputPins,
    outputs: parts.outputPins,
    defaultParams: parts.defaultParams,
    // Same reasoning as the subgraph wrapper: the outer resolver is
    // forwarded into every inner cook, so the memo key carries GPU
    // provenance whenever one is present.
    gpu: "always",
    memoKey: () => transitiveVersionKey(inner, new Set()),
    async execute({ inputs, params, seed, signal, budgetMs, gpu, checkCancelled }) {
      const source = inputs[iterated.name] ?? [];
      return withExclusiveGraph(inner, async () => {
        checkExposedValues(paramList, params);
        const out: Record<string, DataCollection> = {};
        for (const exp of exposedOutputs) out[exp.name] = [];

        // One window over the whole loop, not one per iteration: the values
        // do not vary between iterations, and restoring K times would be K
        // chances to leave the shared graph dirty for one that is enough.
        return withExposedParams(inner, paramList, params, async () => {
          const plan = planIterations(source, iterated.mode);
          // The budget is metered HERE and not by the executor. A node body
          // is atomic to the outer loop, which checks the budget only after
          // this returns, and each inner cook resets its own slice clock —
          // so K iterations under a 16 ms budget would never yield once
          // between them. This clock spans the loop, which is the only
          // level that can see it.
          let sliceStart = performance.now();
          for (let i = 0; i < plan.length; i++) {
            const step = plan[i];
            checkCancelled();
            inner._setSeedQuiet(hashCombine(seed, hashString("forEach"), step.key));
            for (const portal of portals) {
              inner._setParamQuiet(
                portal.handle,
                "items",
                portal.name === iterated.name ? step.items : (inputs[portal.name] ?? []),
              );
            }
            let result;
            try {
              result = await cook(inner, { signal, budgetMs, gpu });
            } catch (err) {
              // Which of sixteen blew up is the first thing an author needs
              // and the last thing the raw error says.
              throw new Error(
                `forEach: ${describeIteration(i, step.key, step.tags)} failed — ${
                  err instanceof Error ? err.message : String(err)
                }`,
                { cause: err },
              );
            }
            for (const exp of exposedOutputs) {
              const produced = result.outputs[`__out_${exp.name}`] ?? [];
              (out[exp.name] as DataItem[]).push(
                ...produced.map((item) => withInheritedTags(item, step.tags)),
              );
            }
            if (budgetMs !== undefined && performance.now() - sliceStart > budgetMs) {
              await new Promise((resolve) => setTimeout(resolve, 0));
              checkCancelled();
              sliceStart = performance.now();
            }
          }
          return out;
        });
      });
    },
  });
  recordWrapperSpec(def, "forEach", inner, exposedInputs, exposedOutputs, paramList);
  return def;
}

/** One iteration: what the body sees, and what seeds it. */
interface Iteration {
  readonly items: DataCollection;
  readonly key: number;
  readonly tags: ReadonlySet<string>;
}

/**
 * Expand the iterated pin into the iterations it stands for, and refuse the
 * shapes that cannot mean what an author intended.
 *
 * Keys are computed for the whole plan up front so a duplicate is reported
 * before any of them cooks, rather than after the first K-1 have run.
 */
function planIterations(source: DataCollection, mode: IterationMode): Iteration[] {
  const plan: Iteration[] = [];
  if (mode === "each") {
    for (const item of source) {
      plan.push({ items: [item], key: itemKey(item, "forEach"), tags: item.tags });
    }
  } else {
    const geometries = source.filter((i): i is GeometryItem => i.kind === "geometry");
    if (geometries.length !== source.length) {
      const other = source.find((i) => i.kind !== "geometry");
      throw new GraphValidationError(
        `forEach: "eachPoint" iterates the points of a geometry, but the pin carries a ` +
          `${other?.kind} item. Connect a geometry, or rename the pin to "each" to iterate whatever the ` +
          "collection holds one item at a time.",
      );
    }
    if (geometries.length > 1) {
      throw new GraphValidationError(
        `forEach: "eachPoint" iterates the points of ONE geometry, but the pin carries ${geometries.length}. ` +
          "mergePoints them into one first, or rename the pin to \"each\" to iterate the items and slice " +
          "the points inside the body.",
      );
    }
    if (geometries.length === 1) {
      const item = geometries[0];
      const identities = pointIdentityColumn(item, "forEach");
      checkIterationCount(identities.length, `points of the geometry on "eachPoint"`);
      for (let i = 0; i < identities.length; i++) {
        plan.push({
          items: [makeGeometryItem(gatherPoints(item.geo, [i]), item.tags)],
          key: pointItemKey(identities[i], item.tags),
          tags: item.tags,
        });
      }
    }
  }
  checkIterationCount(plan.length, mode === "each" ? 'items on "each"' : 'points on "eachPoint"');
  checkDistinctKeys(plan, mode);
  return plan;
}

function checkIterationCount(count: number, what: string): void {
  if (count > MAX_ITERATIONS) {
    throw new GraphValidationError(
      `forEach: ${count} ${what} exceeds the ${MAX_ITERATIONS}-iteration ceiling. Each iteration is a full ` +
        "cook of the body with no cache reuse from the last, so this would block for a long time with " +
        "nothing to show for it. Reduce the count upstream, or do the work with one cook over the whole " +
        "cloud if the elements do not actually need separate treatment.",
    );
  }
}

/**
 * Refuse a collection holding two elements that are the same element.
 *
 * Doctrinally this is not an error: two items agreeing on their whole
 * identity ARE one item, and giving them one seed is the rule working. But
 * the reason to reach for a loop is K DIFFERENT results, and silently
 * emitting the same block twice is the failure an author would ship without
 * noticing. So it is loud here, one level up from where `identity.ts`
 * chooses to be quiet.
 */
function checkDistinctKeys(plan: readonly Iteration[], mode: IterationMode): void {
  const seen = new Map<number, number>();
  for (let i = 0; i < plan.length; i++) {
    const first = seen.get(plan[i].key);
    if (first !== undefined) {
      throw new GraphValidationError(
        `forEach: ${describeIteration(first, plan[first].key, plan[first].tags)} and ` +
          `${describeIteration(i, plan[i].key, plan[i].tags)} are the same ${
            mode === "each" ? "item" : "point"
          } — identical content and identical tags — so both would be seeded alike and emit the same ` +
          "block twice. Give them something to be told apart by: distinct positions or seeds, or a tag " +
          `naming what each one is (partitionByAttribute writes one per group).`,
      );
    }
    seen.set(plan[i].key, i);
  }
}
