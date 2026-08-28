/**
 * `repeatUntil`: cook an inner graph again and again until it stops
 * changing — a BOUNDED FIXED POINT, in a graph that cannot express a cycle.
 *
 * The gap this closes sits next to `forEach`'s. That node runs a body once
 * per element of a plan known before the first cook; this one runs a body
 * whose next input is the LAST ONE'S OUTPUT, and whose iteration count is
 * not known until it happens. Relaxation problems are the whole family:
 * push overlapping props apart and some new pair now overlaps, so push
 * again; snap a mesh's dangling edges and the snap creates another dangler;
 * repair a placement against a rule and the repair breaks the rule
 * somewhere else. Each of those is one node applied repeatedly, and the
 * only reason it needed a host loop before is that `Graph.connect` refuses
 * a cycle, so a body's output has no wire back to its own input.
 *
 * WHY THE FEEDBACK IS AN ASSIGNMENT AND NOT A WIRE. It has to be. A wire
 * from a body's output back to its input is a cycle, and the scheduler is
 * a topological sort over a DAG — there is no order in which to cook a
 * cycle, which is why `Graph.connect` refuses one at edit time rather than
 * hanging at cook time. So the feedback lives exactly where `forEach`'s
 * item selection lives: between cooks, as a write of `portal.items`, in a
 * loop the node body owns. The graph stays acyclic and the FIXED POINT is
 * expressed as repetition rather than as a loop in the data flow, which is
 * the same trade a numerical solver makes when it writes `x = f(x)` as a
 * for-loop instead of an equation.
 *
 * THE SETTLE SIGNAL RIDES THE DETAIL DOMAIN, and that is not a shortcut
 * either. A subgraph wrapper's outputs are geometry pins, and there is no
 * non-geometry output pin a body could raise a scalar on; adding one would
 * be a format change (`formatVersion`, `hashableGraph`, every pinned `ref`
 * in the wild) to carry one number. The detail domain already exists to
 * hold exactly one value per geometry, `attributeReduce` already writes it,
 * and the number a relaxation wants — "how many things did that round
 * actually move" — is a reduction. So the body ends in a reduction and this
 * node reads its result off the carried geometry. `settleAttr` names it.
 *
 * ============================================================
 * THE SEED IS NOT ROTATED PER ROUND. This is the load-bearing
 * decision in this file, and the one worth arguing at length.
 * ============================================================
 *
 * `forEach` rotates the inner seed once per iteration, deliberately: each
 * iteration is a DIFFERENT element and is supposed to generate a different
 * thing, so its randomness must differ, and the rotation is keyed on the
 * element's content. This node does the opposite, and for a reason that is
 * not stylistic.
 *
 * A fixed point is a value `x` with `f(x) = x`. It only exists if `f` is
 * ONE FUNCTION. A body whose seed varies with the round number is not one
 * function evaluated repeatedly — it is `f1, f2, f3, …`, a different
 * function every round, and the sequence `x2 = f1(x1)`, `x3 = f2(x2)`, …
 * has no fixed point to reach even in principle. Every round re-rolls
 * whatever the last round settled: the jitter that shook a pair of props
 * apart is a different jitter this round, so it shakes a different pair
 * together. The loop then runs to `maxRounds` every single time, reports
 * `converged: false` every single time, and the output is the last round's
 * fresh roll rather than anything that converged — which reads, from
 * outside, exactly like a body that is merely hard to satisfy. That is the
 * failure this design prevents, and it is a failure with no error message
 * attached, which is the worst kind.
 *
 * IT IS ALSO NOT HYPOTHETICAL. `demos/racetrack/dress.ts` passes
 * `seed + rounds` to three of its repair passes. Those three have no fixed
 * point, by construction, for exactly the reason above — and that is
 * findable now precisely because this node holds the seed still: a repair
 * that will not settle under a constant seed is a repair that is randomly
 * re-deciding, not a repair that needs more rounds.
 *
 * So: one seed, derived once from the outer node seed, held constant for
 * every round of the loop. If a body needs per-round variation it does not
 * want this node; it wants `forEach` over a plan that names the variants,
 * where the variation is DATA and the count is known.
 *
 * WHAT THIS BUYS BACK, and it is the mirror of what `forEach` costs: the
 * body DOES get memo reuse between rounds. A constant inner seed means
 * `deriveNodeSeed` is constant for every inner node, so an inner node whose
 * inputs did not change between rounds serves its cache. Everything
 * downstream of the carry portal recooks (the carried items get fresh revs
 * each round, which is correct — they are different geometry), but a
 * broadcast branch that only reads a shared spine or a lookup surface is
 * computed once and reused for every round after. That is a direct
 * consequence of not rotating the seed, and it is the reason a ten-round
 * relaxation over a body with an expensive shared prologue is affordable
 * at all.
 *
 * WHERE IT LIVES. Beside `forEach` in the nodes layer rather than beside
 * `subgraphNode`, so the two loops sit together and the diff between them
 * reads as what the feedback added.
 */
// Imported from the graph modules directly rather than through
// `../graph/index.js`, for the reason `forEach.ts` gives: the wrapper
// machinery is `@internal` and re-exporting it there would carry it out
// through `src/index.ts` into the package surface.
import type { DataCollection } from "../graph/data.js";
import { makeValueItem } from "../graph/data.js";
import { CookCancelledError, GraphValidationError } from "../graph/errors.js";
import { cook, withExclusiveGraph } from "../graph/execute.js";
import type { Graph } from "../graph/graph.js";
import { type NodeDef, type PinDef, defineNode } from "../graph/node.js";
import type { ParamSchema } from "../graph/params.js";
import {
  CARRIED_PIN_NAMES,
  type ExposedParam,
  type ExposedPin,
  ITERATED_PIN_NAMES,
  checkExposedValues,
  prepareWrapper,
  recordWrapperSpec,
  transitiveVersionKey,
  withExposedParams,
} from "../graph/subgraph.js";
import { hashCombine, hashString } from "../random/hash.js";

/** The exposed pin name that feeds a round's output back into the next round. */
export const CARRY_PIN_NAME = "carry";

/** Synthetic output pins this node adds to whatever the body declares. */
export const REPORT_PIN_NAMES: ReadonlySet<string> = new Set(["rounds", "converged"]);

/** Rounds a fresh instance runs at most; see {@link REPEAT_UNTIL_PARAM_SCHEMAS}. */
export const DEFAULT_MAX_ROUNDS = 12;

/**
 * Ceiling on `maxRounds`, and the reason there is one.
 *
 * A relaxation that has not settled in a thousand cooks of its body is not
 * a relaxation that needs one thousand and one — it is a body with no fixed
 * point (usually a varying seed; see the header), or a rule that fights
 * itself. Unbounded, that shape is a page that stops responding with
 * nothing on screen to explain why, which is the same accident `forEach`
 * bounds with `MAX_ITERATIONS` and for the same reason. The number is far
 * above any real relaxation and far below "forever".
 */
export const MAX_ROUNDS_CEILING = 1024;

/**
 * This node's OWN params — the two knobs that are not exposed from the
 * body, and the only wrapper params in the library that are not.
 *
 * They live here rather than in `serialize.ts` because both the factory
 * (which needs them as `defaultParams`) and the reader/writer (which needs
 * them to round-trip an instance's values) must agree on one definition. A
 * second spelling of a schema is a way for a saved graph to load with a
 * different bound than it was authored under.
 */
export const REPEAT_UNTIL_PARAM_SCHEMAS: Readonly<Record<string, ParamSchema>> = Object.freeze({
  maxRounds: Object.freeze({
    type: "u32",
    default: DEFAULT_MAX_ROUNDS,
    min: 1,
    max: MAX_ROUNDS_CEILING,
    description:
      "Hard ceiling on how many times the body cooks. Reaching it WITHOUT the settle signal going to zero " +
      'is not an error and is not silent: the loop stops, "rounds" reports this number and "converged" ' +
      "reports false, so a host or a downstream branch can tell a settled result from a truncated one. " +
      "This is a budget, not a target — a body with a fixed point normally reaches it in a handful of " +
      "rounds, and a body that reliably needs the whole ceiling is telling you it has no fixed point " +
      "(the usual cause being a seed that varies per round, which this node deliberately does not do; see " +
      "the node description). Raising it is the wrong first response to a false `converged`: find out " +
      "whether the body is converging slowly or not at all, because those need opposite fixes. Minimum 1 " +
      "— one round means cook the body exactly once and report whether that one round settled, which is a " +
      "legitimate way to ASK the question without paying for the loop.",
  }),
  settleAttr: Object.freeze({
    type: "string",
    default: "moves",
    description:
      "Name of the DETAIL-domain attribute the body writes to say whether anything still changed. Read " +
      "after every round from every geometry item on the carry output: all zero means settled (stop, and " +
      "that round counts), anything else means loop. The detail domain is used because it is the one " +
      "domain that holds exactly one value per geometry, and because a subgraph wrapper has no " +
      "non-geometry output pin a scalar could ride out on — attributeReduce is what normally writes it " +
      "(mode 'count' over a filtered cloud, or 'sum' of a per-point moved flag). The attribute MUST exist " +
      "on the carry geometry every round: an absent one is refused by name rather than treated as zero, " +
      "because treating it as zero turns a typo here, or a body that never wired the reduction, into " +
      "'converged on round one' — a wrong answer that cooks cleanly and saves cleanly. A tuple attribute " +
      "settles only when every component is zero, and NaN never settles (so unmeasurable data runs the " +
      "budget out and reports converged false, instead of stopping on garbage).",
  }),
});

/**
 * The exposed input and output that carry state between rounds.
 *
 * Both must be named `carry`, and the name is reserved GLOBALLY (see
 * {@link CARRIED_PIN_NAMES}) for the reason `each`/`eachPoint` are: a
 * registered recipe records a body and its exposed pins and NOTHING about
 * which wrapper cooks them, so without the reservation a body authored to
 * be relaxed could be referenced from a plain `subgraph` node and cook
 * exactly once — a wrong-but-well-formed answer, which is the shape worth
 * refusing outright.
 */
function resolveCarryPins(
  exposedInputs: readonly ExposedPin[],
  exposedOutputs: readonly ExposedPin[],
): void {
  const check = (side: "input" | "output", pins: readonly ExposedPin[]): void => {
    const found = pins.filter((e) => e.name === CARRY_PIN_NAME);
    if (found.length === 0) {
      throw new GraphValidationError(
        `repeatUntil: no carried ${side}. Exactly one exposed ${side} must be named "${CARRY_PIN_NAME}" — ` +
          `it is the state the loop feeds through itself: round 1 gets the outer "${CARRY_PIN_NAME}" input, ` +
          `and round k+1 gets round k's "${CARRY_PIN_NAME}" output. Exposed ${side}s here: ` +
          `${pins.map((e) => `"${e.name}"`).join(", ") || "(none)"}. Rename the one the body threads through, ` +
          `or use subgraphNode if the body is meant to cook once.`,
      );
    }
    if (found.length > 1) {
      // prepareWrapper would reject duplicates anyway, but with a message
      // about names rather than about what a loop carries.
      throw new GraphValidationError(
        `repeatUntil: ${found.length} exposed ${side}s named "${CARRY_PIN_NAME}", but a fixed point iterates ` +
          `one value. Keep the one the body threads through and rename the others — a non-carry ${side} is ` +
          `${side === "input" ? "broadcast whole to every round" : "still emitted, from the last round"}.`,
      );
    }
  };
  check("input", exposedInputs);
  check("output", exposedOutputs);
  // Names owned by the OTHER loop. A body cannot be both, and a wrapper
  // silently ignoring `each` would cook the whole collection once per round
  // while its author believed it was iterating.
  for (const [side, pins] of [
    ["input", exposedInputs],
    ["output", exposedOutputs],
  ] as const) {
    const iterated = pins.filter((e) => ITERATED_PIN_NAMES.has(e.name));
    if (iterated.length > 0) {
      throw new GraphValidationError(
        `repeatUntil: exposed ${side} ${iterated.map((e) => `"${e.name}"`).join(" and ")} — those names are ` +
          `reserved for the pin a "forEach" iterates, and this node does not iterate a collection: it re-cooks ` +
          `the body over its own "${CARRY_PIN_NAME}" output until the settle signal reaches zero. Rename the ` +
          `pin, or wrap the body with forEachNode if a pass per element is what you want.`,
      );
    }
  }
  const shadowed = exposedOutputs.filter((e) => REPORT_PIN_NAMES.has(e.name));
  if (shadowed.length > 0) {
    throw new GraphValidationError(
      `repeatUntil: exposed output ${shadowed.map((e) => `"${e.name}"`).join(" and ")} — this node adds ` +
        `${[...REPORT_PIN_NAMES].map((n) => `"${n}"`).join(" and ")} outputs of its own, reporting how many ` +
        "times the body cooked and whether it settled, so a body output of that name would be shadowed by a " +
        "value item the body never produced. Rename the body's output.",
    );
  }
}

/** Names an inner cook in an error, without claiming the round decided anything. */
function describeRound(round: number, maxRounds: number): string {
  return `round ${round} of at most ${maxRounds}`;
}

/**
 * Every device-resident transform handle reachable from a collection map.
 *
 * The GPU hazard this node has and `forEach` does not: `forEach` DELIVERS
 * every iteration's outputs, so the handles a device-resident inner run
 * mints all reach the caller and become the caller's to free. This node
 * discards every round but the last. The executor's own `disposeUndelivered`
 * is scoped to ONE cook run — it frees what that run produced and nobody
 * received — and a round's outputs WERE received, by this node. So the
 * intermediates are ours, and dropping the reference leaks device memory
 * with no GC behind it (visibly, in `poolStats`, which is the only reason
 * such a leak is findable at all).
 */
function deviceHandlesIn(outputs: Record<string, DataCollection>): Set<{ dispose(): void }> {
  const handles = new Set<{ dispose(): void }>();
  for (const collection of Object.values(outputs)) {
    for (const item of collection) {
      if (item.kind !== "instances" || item.deviceBatches === undefined) continue;
      for (const batch of item.deviceBatches) {
        handles.add(batch.transforms);
        if (batch.colors !== undefined) handles.add(batch.colors);
      }
    }
  }
  return handles;
}

/**
 * Free every handle `superseded` holds that `keep` does not.
 *
 * `keep` is not decoration: an inner body may forward an instances item
 * from its input straight to its output, so the very handle a discarded
 * round produced can be the one the NEXT round delivers. Disposing by round
 * alone would then destroy a buffer the surviving item still points at, and
 * the failure would surface as a renderer reading a destroyed resource —
 * far from here. Disposal is idempotent, so an over-broad `keep` costs
 * nothing but a delayed free.
 */
function disposeSuperseded(
  superseded: Record<string, DataCollection> | undefined,
  keep: ReadonlySet<{ dispose(): void }>,
): void {
  if (superseded === undefined) return;
  for (const handle of deviceHandlesIn(superseded)) {
    if (!keep.has(handle)) handle.dispose();
  }
}

/**
 * Read the settle signal off a round's carry collection.
 *
 * Returns true when every geometry item on the pin reports zero in every
 * component of `attrName`. Throws — rather than assuming a value — when the
 * signal is not there to read; see `settleAttr`'s description for why an
 * absent attribute is refused instead of counted as settled.
 */
function readSettled(carry: DataCollection, attrName: string, where: string): boolean {
  let geometries = 0;
  let settled = true;
  for (const item of carry) {
    if (item.kind !== "geometry") continue;
    geometries++;
    const attr = item.geo.attrs.detail.get(attrName);
    if (attr === undefined) {
      throw new GraphValidationError(
        `repeatUntil: ${where} produced no detail attribute "${attrName}", so there is no settle signal to ` +
          `read and the loop cannot know when to stop. Detail attributes on the carried geometry: ` +
          `${item.geo.attrs.detail.names().join(", ") || "(none)"}. End the body with a reduction that ` +
          `writes it — attributeReduce with outName "${attrName}" is the usual one — or point the ` +
          `"settleAttr" param at the attribute the body does write. An absent signal is deliberately NOT ` +
          "treated as zero: that would report convergence on the first round for a body that never wired one.",
      );
    }
    if (attr.type === "string") {
      throw new GraphValidationError(
        `repeatUntil: ${where} wrote detail attribute "${attrName}" as a STRING, which has no zero to settle ` +
          `on. The settle signal is a count or a magnitude — "how much moved this round" — so point ` +
          `"settleAttr" at a numeric detail attribute (f32/i32/u32/bool), or reduce the string column to one.`,
      );
    }
    // Typed-array reads, no per-element objects: the detail domain has one
    // element, so this is tupleSize scalar loads per item.
    for (let c = 0; c < attr.tupleSize; c++) {
      // NaN !== 0 is true, so an unmeasurable signal never settles. That is
      // the intended reading: it runs the budget out and reports
      // `converged: false` rather than stopping on a value nothing computed.
      if (attr.get(0, c) !== 0) settled = false;
    }
  }
  if (geometries === 0) {
    throw new GraphValidationError(
      `repeatUntil: ${where} emitted no geometry on "${CARRY_PIN_NAME}" (${carry.length} item(s), none of ` +
        `them geometry), so there is nothing carrying a detail domain and no settle signal to read. The ` +
        `carried pin is the loop's state and must be geometry; emit the other payloads on outputs of their own.`,
    );
  }
  return settled;
}

/**
 * Wrap an inner graph as a node that re-cooks it until it settles.
 *
 * Same construction as `subgraphNode` and `forEachNode` — exposed inputs
 * become pins fed by injected portals, exposed outputs become inner output
 * declarations, exposed params become the wrapper's own knobs — with one
 * added rule and two added outputs.
 *
 * The rule: exactly one exposed INPUT and exactly one exposed OUTPUT must
 * be named `carry`. Round 1 feeds the outer `carry` input into the body;
 * round k+1 feeds round k's `carry` output back in. Every OTHER exposed
 * input is broadcast whole to every round, exactly as `forEach` broadcasts
 * its non-iterated pins — a shared spine, a lookup surface, an obstacle
 * cloud all reach every round unchanged.
 *
 * The outputs: `rounds` (how many times the body cooked) and `converged`
 * (1 when the last of those rounds settled, 0 when `maxRounds` stopped it),
 * both as one value item carrying a NUMBER. They are synthesised here
 * rather than declared by the body, which has no way to say either — the
 * body cannot see how many times it has run. Every other output carries the
 * LAST round's items and nothing from the rounds before it.
 *
 * The seed is derived once and held constant across every round. That is
 * the design decision this node is built around; the file header argues it
 * at length, and `settleAttr`'s description says what going the other way
 * looks like from outside.
 */
export function repeatUntilNode(
  inner: Graph,
  exposedInputs: readonly ExposedPin[],
  exposedOutputs: readonly ExposedPin[],
  exposedParams: readonly ExposedParam[] = [],
): NodeDef<Record<string, unknown>> {
  resolveCarryPins(exposedInputs, exposedOutputs);
  // Checked before `prepareWrapper`, which injects portals into the shared
  // inner graph: a refusal after that point leaves plumbing behind for a
  // node that was never built.
  for (const exp of exposedParams) {
    if (exp.name in REPEAT_UNTIL_PARAM_SCHEMAS) {
      throw new GraphValidationError(
        `repeatUntil: exposed param "${exp.name}" collides with this node's own param of that name ` +
          `(${Object.keys(REPEAT_UNTIL_PARAM_SCHEMAS).join(" and ")} are the loop's own knobs, not the ` +
          "body's). One slot holds one value, so the loop's would win and the exposed one would be a dead " +
          "knob forcing recooks it cannot affect — rename the exposed param.",
      );
    }
  }
  const parts = prepareWrapper(inner, exposedInputs, exposedOutputs, exposedParams);
  const { portals, paramList } = parts;
  // The carry INPUT takes as many connections as an author wants, for the
  // reason `forEach`'s iterated pin does: the arity of the outer pin and
  // the arity of the inner pin behind it are about different things. The
  // body sees whatever collection round k emitted, which is a collection
  // however many producers assembled the first one.
  const inputPins: PinDef[] = parts.inputPins.map((pin) =>
    pin.name === CARRY_PIN_NAME ? { name: pin.name, kind: pin.kind, multi: true } : pin,
  );
  const outputPins: PinDef[] = [
    ...parts.outputPins,
    { name: "rounds", kind: "value" },
    { name: "converged", kind: "value" },
  ];
  const defaultParams: Record<string, unknown> = { ...parts.defaultParams };
  for (const [name, schema] of Object.entries(REPEAT_UNTIL_PARAM_SCHEMAS)) {
    defaultParams[name] = schema.default;
  }

  const def = defineNode<Record<string, unknown>>({
    type: "repeatUntil",
    inputs: inputPins,
    outputs: outputPins,
    defaultParams,
    // Same reasoning as the other two wrappers: the outer resolver is
    // forwarded into every inner cook, so the memo key carries GPU
    // provenance whenever one is present.
    gpu: "always",
    memoKey: () => transitiveVersionKey(inner, new Set()),
    async execute({ inputs, params, seed, signal, budgetMs, gpu, checkCancelled }) {
      const maxRounds = params.maxRounds as number;
      const settleAttr = params.settleAttr as string;
      // Checked here as well as in the schema, because a def built by this
      // factory is not the registered def and so `Graph.setParam` has no
      // registry schema to bound it with. Zero rounds is the one value that
      // would produce a whole cook's worth of nothing — empty outputs and
      // `converged: false` — with no error to say why.
      if (!Number.isInteger(maxRounds) || maxRounds < 1) {
        throw new GraphValidationError(
          `repeatUntil: param "maxRounds" is ${JSON.stringify(maxRounds)}, but the loop must cook the body ` +
            `at least once (integer, 1..${MAX_ROUNDS_CEILING}). Set it to 1 to run one round and report ` +
            "whether that round settled, or raise it to give the body room to relax.",
        );
      }
      return withExclusiveGraph(inner, async () => {
        checkExposedValues(inner, paramList, params);
        // The seed is restored for the reason `forEach` gives: the inner
        // graph is SHARED, `getSubgraphSpec(def).graph` is the sanctioned
        // door to it, and `serializeGraph` reads what it finds. A wrapper
        // cooks under a derived seed, so leaving the last one behind makes
        // those bytes depend on cook history.
        const seedBefore = inner.seed;
        // The last round's inner outputs, ours to free until we either hand
        // them on or supersede them. Tracked across the whole try so the
        // `finally` frees them on the cancellation and failure paths too,
        // where nothing downstream will ever see them.
        let held: Record<string, DataCollection> | undefined;
        let delivered: Record<string, DataCollection> | undefined;
        try {
          const out = await runRounds();
          delivered = out;
          return out;
        } finally {
          inner._setSeedQuiet(seedBefore);
          disposeSuperseded(
            held,
            delivered === undefined ? new Set<{ dispose(): void }>() : deviceHandlesIn(delivered),
          );
        }

        // One window over the whole loop, not one per round: the exposed
        // values do not vary between rounds, and restoring K times would be
        // K chances to leave the shared graph dirty for one that is enough.
        async function runRounds(): Promise<Record<string, DataCollection>> {
          return withExposedParams(inner, paramList, params, async () => {
            // ONE seed, set once, for every round. See the file header:
            // a fixed point exists only if the body is the same function
            // each time, and a seed that moves with the round number makes
            // it a different function each time.
            inner._setSeedQuiet(hashCombine(seed, hashString("repeatUntil")));
            // The budget is metered HERE and not by the executor, exactly
            // as in `forEach`. A node body is atomic to the outer loop,
            // which checks the budget only after this returns, and each
            // inner cook resets its own slice clock — so K rounds under a
            // 16 ms budget would never yield once between them.
            let sliceStart = performance.now();
            let carry: DataCollection = inputs[CARRY_PIN_NAME] ?? [];
            let rounds = 0;
            let converged = false;
            while (rounds < maxRounds) {
              checkCancelled();
              for (const portal of portals) {
                inner._setParamQuiet(
                  portal.handle,
                  "items",
                  portal.name === CARRY_PIN_NAME ? carry : (inputs[portal.name] ?? []),
                );
              }
              let result;
              try {
                result = await cook(inner, { signal, budgetMs, gpu });
              } catch (err) {
                // Cancellation passes through UNWRAPPED, and this branch
                // has to come FIRST — `forEach.ts` documents the exact
                // regression the other order caused. The executor rethrows
                // a cancelled cook as itself only when it sees a
                // `CookCancelledError`; anything else becomes a
                // `NodeExecutionError`, so wrapping it here would turn
                // every abort landing inside an inner cook (which is where
                // the time goes, and so the common case) into an ordinary
                // node failure. `World` rethrows a cook's error verbatim
                // and the worker protocol reconstructs by `error.name`, so
                // both would report a broken graph where the caller had
                // simply cancelled. There is no round to name in that case:
                // the caller asked to stop, and which round was in flight
                // is not a fact about the graph.
                if (err instanceof CookCancelledError) throw err;
                throw new Error(
                  `repeatUntil: ${describeRound(rounds + 1, maxRounds)} failed — ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                  { cause: err },
                );
              }
              rounds++;
              // Round k's handles die the moment round k+1's are in hand —
              // except any the new round forwarded through unchanged.
              disposeSuperseded(held, deviceHandlesIn(result.outputs));
              held = result.outputs;
              carry = result.outputs[`__out_${CARRY_PIN_NAME}`] ?? [];
              converged = readSettled(
                carry,
                settleAttr,
                describeRound(rounds, maxRounds),
              );
              if (converged) break;
              if (budgetMs !== undefined && performance.now() - sliceStart > budgetMs) {
                await new Promise((resolve) => setTimeout(resolve, 0));
                checkCancelled();
                sliceStart = performance.now();
              }
            }
            const out: Record<string, DataCollection> = {};
            const last = held ?? {};
            for (const exp of exposedOutputs) {
              out[exp.name] = last[`__out_${exp.name}`] ?? [];
            }
            // Synthesised, because the body has no way to say either: it
            // cannot see how many times it has run. `forEach` doctoring its
            // own `inputPins` is the precedent for a wrapper declaring a
            // pin its body never did.
            out.rounds = [makeValueItem(rounds)];
            // 1 or 0 rather than true/false. `DataValue` admits a boolean,
            // but nothing in the library has ever put one on a pin — every
            // producer emits a number — and these two pins are read
            // together far more often than apart, so a consumer that has
            // just pulled a number off "rounds" would need a second shape
            // for the pin beside it. A boolean that travelled as a number
            // is still the answer; a lone boolean in a numeric protocol is
            // a special case at every reader.
            out.converged = [makeValueItem(converged ? 1 : 0)];
            return out;
          });
        }
      });
    },
  });
  recordWrapperSpec(def, "repeatUntil", inner, exposedInputs, exposedOutputs, paramList);
  return def;
}
