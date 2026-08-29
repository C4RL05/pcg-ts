/**
 * What a gate MEANS, held still.
 *
 * `tests/panelSpec.test.ts` proves the format parses and that a malformed
 * one is refused. This file is the other half of the same key: the rules a
 * host has to reproduce to render an authored panel the way its author saw
 * it — and the reason those rules are exported at all rather than left for
 * every host to guess.
 *
 * Every case here is one sentence of the contract:
 *
 *   - a list is OR and a second key is AND;
 *   - matching is strict, so `1` is not `"1"` and `1` is not `true`;
 *   - an address this host cannot answer leaves the row SHOWN.
 *
 * The third is the one worth a test of its own. It is the difference between
 * a typo in a panel file being visible and a knob quietly vanishing.
 */
import { describe, expect, it } from "vitest";
import {
  type PanelControlSpec,
  isPanelConditionValue,
  panelConditionHolds,
  panelGateHolds,
  panelRowVisible,
  parsePanelSpec,
} from "./index.js";

/** The one row of a one-row spec, parsed — so cases run on validated data. */
function row(control: Record<string, unknown>): PanelControlSpec {
  return parsePanelSpec({ sections: [{ title: "s", controls: [control] }] }, { source: "fixture" })
    .sections[0].controls[0];
}

/** A `valueAt` over a plain record: absent key → `undefined`. */
const from =
  (values: Record<string, unknown>) =>
  (address: string): unknown =>
    values[address];

describe("panelConditionHolds", () => {
  it("matches a scalar exactly", () => {
    expect(panelConditionHolds("circle", "circle")).toBe(true);
    expect(panelConditionHolds("circle", "ribbon")).toBe(false);
    expect(panelConditionHolds(3, 3)).toBe(true);
    expect(panelConditionHolds(3, 4)).toBe(false);
    expect(panelConditionHolds(true, true)).toBe(true);
    expect(panelConditionHolds(true, false)).toBe(false);
  });

  it("matches ANY member of a list", () => {
    // The shape most gates want: `caps` closes a hole, and the two CLOSED
    // profiles both have one. A JSON object cannot carry the same key twice,
    // so without the list this needs two rows saying the same thing.
    expect(panelConditionHolds(["circle", "square"], "circle")).toBe(true);
    expect(panelConditionHolds(["circle", "square"], "square")).toBe(true);
    expect(panelConditionHolds(["circle", "square"], "ribbon")).toBe(false);
  });

  it("does not coerce across types", () => {
    // A mode is an enum and a count is a number. A gate that matched `1`
    // against `"1"` would be gating on something other than what it says,
    // and the symptom — a row appearing in the wrong mode — reads as a bug
    // in the graph rather than a typo in the panel.
    expect(panelConditionHolds(1, "1")).toBe(false);
    expect(panelConditionHolds("1", 1)).toBe(false);
    expect(panelConditionHolds(1, true)).toBe(false);
    expect(panelConditionHolds(true, 1)).toBe(false);
    expect(panelConditionHolds(0, false)).toBe(false);
    expect(panelConditionHolds("", false)).toBe(false);
  });

  it("refuses a value no knob holds", () => {
    // A vector, a null and an undefined all reach here from a host reading
    // its own record; none of them is a scalar and none may match.
    expect(panelConditionHolds(3, [3])).toBe(false);
    expect(panelConditionHolds(3, null)).toBe(false);
    expect(panelConditionHolds(3, undefined)).toBe(false);
    expect(panelConditionHolds([1, 2], undefined)).toBe(false);
  });
});

describe("panelRowVisible", () => {
  it("shows a row with no gate", () => {
    expect(panelRowVisible(row({ param: "skin.sides" }), from({}))).toBe(true);
  });

  it("requires EVERY key to hold", () => {
    // AND across keys, which is the half a host would otherwise have to
    // guess: two independent conditions, both of which must be true.
    const gated = row({
      param: "skin.sides",
      visibleWhen: { "skin.profile": "circle", "skin.joint": "miter" },
    });
    expect(panelRowVisible(gated, from({ "skin.profile": "circle", "skin.joint": "miter" }))).toBe(
      true,
    );
    expect(
      panelRowVisible(gated, from({ "skin.profile": "circle", "skin.joint": "perpendicular" })),
    ).toBe(false);
    expect(panelRowVisible(gated, from({ "skin.profile": "ribbon", "skin.joint": "miter" }))).toBe(
      false,
    );
    expect(
      panelRowVisible(gated, from({ "skin.profile": "ribbon", "skin.joint": "perpendicular" })),
    ).toBe(false);
  });

  it("combines OR inside a key with AND across keys", () => {
    const gated = row({
      param: "skin.caps",
      visibleWhen: { "skin.profile": ["circle", "square"], "skin.closed": false },
    });
    expect(panelRowVisible(gated, from({ "skin.profile": "square", "skin.closed": false }))).toBe(
      true,
    );
    // The list holds, the second key does not — the row is still gone.
    expect(panelRowVisible(gated, from({ "skin.profile": "square", "skin.closed": true }))).toBe(
      false,
    );
  });

  it("SHOWS the row when an address cannot be answered", () => {
    // The safe way round, and the whole reason it is stated in the format
    // rather than left to each host: a mistyped gate must never silently
    // swallow a knob. Every unanswerable case behaves the same — a typo, a
    // knob holding a field, a knob of a type no widget reads.
    const gated = row({ param: "skin.sides", visibleWhen: { "skin.shape": "circle" } });
    expect(panelRowVisible(gated, from({}))).toBe(true);
    expect(panelRowVisible(gated, from({ "skin.profile": "ribbon" }))).toBe(true);
    // One answerable key beside one that is not: the answerable one still
    // decides, so a partly-broken gate is not a dead one.
    const half = row({
      param: "skin.sides",
      visibleWhen: { "skin.shape": "circle", "skin.profile": "circle" },
    });
    expect(panelRowVisible(half, from({ "skin.profile": "ribbon" }))).toBe(false);
    expect(panelRowVisible(half, from({ "skin.profile": "circle" }))).toBe(true);
  });

  it("treats a value no gate can read as UNANSWERABLE, not as a failed gate", () => {
    // The sharp edge. A gate's vocabulary is the three scalars, so a knob
    // holding a vector or a list cannot answer one — and reading that as a
    // gate that FAILED would hide the row, which is the opposite of the
    // rule. Hidden, the author sees a knob missing and nothing saying why;
    // shown, the gate is merely inert and the host can say so beside it.
    const gated = row({ param: "skin.sides", visibleWhen: { "skin.up": 1 } });
    for (const unreadable of [[1, 2, 3], [], {}, null, undefined]) {
      expect(
        panelRowVisible(gated, from({ "skin.up": unreadable })),
        `${JSON.stringify(unreadable) ?? "undefined"} answered a gate`,
      ).toBe(true);
    }
    // A scalar of the wrong value still fails, which is what makes the
    // above a statement about READABILITY and not about leniency.
    expect(panelRowVisible(gated, from({ "skin.up": 2 }))).toBe(false);
  });

  it("is the same rule `panelGateHolds` states, since one calls the other", () => {
    // Exported separately because a host keyed differently — a renderer
    // holding widget specs rather than `PanelControlSpec`s — needs the rule
    // without the row. Two implementations would be two answers.
    const gates = { "skin.profile": ["circle", "square"] as const, "skin.joint": "miter" };
    const control = row({ param: "skin.caps", visibleWhen: gates });
    for (const values of [
      { "skin.profile": "circle", "skin.joint": "miter" },
      { "skin.profile": "ribbon", "skin.joint": "miter" },
      { "skin.profile": "square" },
      {},
    ]) {
      expect(panelGateHolds(control.visibleWhen, from(values))).toBe(
        panelRowVisible(control, from(values)),
      );
    }
    // And a row with no gate is the `undefined` case, which holds.
    expect(panelGateHolds(undefined, from({}))).toBe(true);
  });

  it("knows which values a gate can be compared against at all", () => {
    for (const yes of [0, -1, 1.5, "", "circle", true, false]) {
      expect(isPanelConditionValue(yes), `${JSON.stringify(yes)} is a scalar`).toBe(true);
    }
    for (const no of [undefined, null, [1], [], {}, () => 1]) {
      expect(isPanelConditionValue(no), `${String(no)} is not a scalar`).toBe(false);
    }
  });

  it("treats `false` as an answer, not as an absence", () => {
    // The classic falsy bug: a gate on `caps: false` must HOLD when the knob
    // is false, not fall through to the unanswerable case.
    const gated = row({ param: "skin.sides", visibleWhen: { "skin.caps": false } });
    expect(panelRowVisible(gated, from({ "skin.caps": false }))).toBe(true);
    expect(panelRowVisible(gated, from({ "skin.caps": true }))).toBe(false);
    // And zero, and the empty string, for the same reason.
    const zero = row({ param: "skin.sides", visibleWhen: { "skin.roll": 0 } });
    expect(panelRowVisible(zero, from({ "skin.roll": 0 }))).toBe(true);
    expect(panelRowVisible(zero, from({ "skin.roll": 1 }))).toBe(false);
  });
});

describe("a gate survives the parse unchanged", () => {
  it("re-emits what was authored, key order and all", () => {
    // The parser rebuilds rather than returning its input, so "it validated"
    // has to also mean "it is still the same gate".
    const authored = {
      param: "skin.caps",
      visibleWhen: { "skin.profile": ["circle", "square"], $mode: 2, "skin.joint": true },
    };
    const parsed = row(authored);
    expect(parsed.visibleWhen).toEqual(authored.visibleWhen);
    expect(Object.keys(parsed.visibleWhen ?? {})).toEqual([
      "skin.profile",
      "$mode",
      "skin.joint",
    ]);
  });

  it("round-trips through JSON and through itself", () => {
    // A spec re-parsed from its own output must be the same spec: that is
    // what lets a host save a panel it validated.
    const once = parsePanelSpec({
      sections: [
        {
          title: "surface",
          controls: [
            { param: "skin.profile" },
            { param: "skin.sides", visibleWhen: { "skin.profile": "circle" } },
            { param: "skin.caps", visibleWhen: { "skin.profile": ["circle", "square"] } },
          ],
        },
      ],
    });
    const twice = parsePanelSpec(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });

  it("shares no structure with the input", () => {
    // A caller that mutates what it handed in must not reach into the
    // parsed spec afterwards — the same promise the rest of the format
    // makes, extended to the one key that holds a nested array.
    const list = ["circle", "square"];
    const input = { "skin.profile": list };
    const parsed = row({ param: "skin.caps", visibleWhen: input });
    list.push("ribbon");
    expect(parsed.visibleWhen?.["skin.profile"]).toEqual(["circle", "square"]);
    expect(parsed.visibleWhen).not.toBe(input);
  });
});
