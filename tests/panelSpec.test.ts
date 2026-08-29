/**
 * The panel spec format, checked from both ends — and, since `visibleWhen`,
 * from the renderer's too.
 *
 * TWO HALVES, AND NEITHER IS ENOUGH ALONE.
 *
 * The first half runs the published validator over every file in
 * `graphs/panels/`, so the corpus cannot drift away from the format it is
 * supposed to be the reference for. That assertion passes by finding
 * NOTHING, which is the dangerous kind: a validator that quietly stopped
 * checking, or a glob that quietly stopped matching, would read as "all
 * clear" forever.
 *
 * So the second half is the control. Every negative case starts from a
 * fixture this file first asserts is VALID, changes exactly one thing, and
 * requires the validator to reject it AND to say where. That is what makes
 * the corpus sweep worth anything: a validator that threw on everything
 * would fail the base-is-valid assertion, and one that threw on nothing
 * would fail all thirty-odd mutations. The count of mutations is asserted
 * too, so a case list that shrinks by accident is a failure rather than a
 * quieter pass.
 *
 * The mutations are grouped by the class of error they belong to, and every
 * class the validator claims to catch has at least one.
 *
 * A THIRD BLOCK, at the bottom, exists because `visibleWhen` is the first
 * key whose whole point is what a PANEL does with it. Every other key can be
 * checked as data — a label is a string or it is not. A gate is only real if
 * a row disappears, so that block runs an authored spec through the panel
 * builder and the visibility predicate the Svelte renderer uses.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type GraphPanelSpec,
  PanelSpecError,
  type ParsePanelSpecOptions,
  parsePanelSpec,
} from "../src/panels/index.js";
import { visibleControls } from "../shared/controls.js";
import { buildKnobPanel, type Knob, type KnobPanel } from "../shared/graphUi.js";

const PANELS_DIR = fileURLToPath(new URL("../graphs/panels", import.meta.url));

const panelFiles = readdirSync(PANELS_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

describe("the shipped panel corpus conforms to the published format", () => {
  it("has panels to check at all", () => {
    // The sweep below is a for-loop over this list. An empty list would
    // make every case vacuous and the suite green, which is exactly the
    // failure this asserts away.
    expect(
      panelFiles.length,
      `no *.json under ${PANELS_DIR} — the conformance sweep below would check nothing and pass`,
    ).toBeGreaterThan(30);
  });

  for (const file of panelFiles) {
    it(`${file} parses`, () => {
      const raw: unknown = JSON.parse(readFileSync(join(PANELS_DIR, file), "utf8"));
      const spec = parsePanelSpec(raw, { source: `panel spec "${file}"` });
      // Not just "did not throw": a validator that returned an empty shell
      // would also not throw.
      expect(spec.sections.length).toBeGreaterThan(0);
      for (const section of spec.sections) {
        expect(section.title).not.toBe("");
        expect(section.controls.length).toBeGreaterThan(0);
      }
    });
  }

  it("covers the four panels added most recently", () => {
    // Named explicitly rather than left to the sweep: these four are the
    // newest, so they are the ones a format change would have been written
    // without. If one is renamed, this is the assertion that says so
    // instead of the sweep silently checking one file fewer.
    for (const name of [
      "basics-fit-runs.json",
      "basics-sightline-cull.json",
      "basics-tile-an-arc.json",
      "basics-under-cover.json",
    ]) {
      expect(panelFiles, `${name} is no longer in graphs/panels/`).toContain(name);
      const raw: unknown = JSON.parse(readFileSync(join(PANELS_DIR, name), "utf8"));
      expect(() => parsePanelSpec(raw, { source: name })).not.toThrow();
    }
  });

  it("would reject a real corpus file that drifted", () => {
    // The control for the sweep above, run on the sweep's OWN inputs. The
    // mutations further down prove the validator detects, but they run
    // on a synthetic fixture; this proves the thing that reads the actual
    // files would notice if one of them changed shape. Every shipped panel
    // is corrupted four ways, and every corruption must be caught — a
    // count, so a rule that stopped applying to most of the corpus cannot
    // hide behind the few files it still rejects.
    const drifts: ReadonlyArray<[string, (spec: Record<string, unknown>) => void]> = [
      ["a section loses its title", (s) => delete (s.sections as Sections)[0].title],
      ["a control gains a key", (s) => void (controlsOf(s, 0)[0].group = "Scatter")],
      ["a param stops being an address", (s) => void (controlsOf(s, 0)[0].param = "cellSize")],
      ["sections stops being an array", (s) => void (s.sections = "one")],
    ];
    let caught = 0;
    for (const file of panelFiles) {
      const text = readFileSync(join(PANELS_DIR, file), "utf8");
      for (const [why, drift] of drifts) {
        const spec = JSON.parse(text) as Record<string, unknown>;
        drift(spec);
        expect(
          () => parsePanelSpec(spec, { source: file }),
          `${file} was accepted after ${why}`,
        ).toThrow(PanelSpecError);
        caught++;
      }
    }
    expect(caught).toBe(panelFiles.length * drifts.length);
  });

  it("actually uses visibleWhen somewhere, and every corpus gate names a row", () => {
    // A format nothing in the corpus exercises is a format nothing tests
    // end to end. This asserts the gate is REACHED by the shipped panels.
    //
    // The second half is a CORPUS POLICY, and deliberately stricter than
    // the format: `PanelControlSpec.visibleWhen` permits a gate on any
    // address, including one no row shows and one this host does not have,
    // because a host's mode may live in an inspector or in another panel
    // entirely. These files are teaching material opened in an editor, so
    // they hold to the tighter rule — every gate names a row of the same
    // panel — which is what makes each of them drivable from the panel
    // alone. An author following the TSDoc and failing here is reading a
    // rule about this directory, not about the format.
    const gated: string[] = [];
    for (const file of panelFiles) {
      const raw: unknown = JSON.parse(readFileSync(join(PANELS_DIR, file), "utf8"));
      const spec = parsePanelSpec(raw, { source: file });
      const rows = spec.sections.flatMap((s) => s.controls);
      const shown = new Set(rows.map((c) => c.param));
      for (const row of rows) {
        if (row.visibleWhen === undefined) continue;
        gated.push(`${file}:${row.param}`);
        for (const address of Object.keys(row.visibleWhen)) {
          expect(
            shown.has(address),
            `${file}: ${row.param} gates on ${address}, which this panel gives no row. The ` +
              "FORMAT allows that; graphs/panels/ does not, because a corpus panel must be " +
              "drivable from the panel alone — otherwise the graph can open with a row hidden " +
              "and nothing on screen to unhide it. Add a row for the gate, or gate on one.",
          ).toBe(true);
        }
      }
    }
    expect(gated.length, "no corpus panel uses visibleWhen").toBeGreaterThan(3);
  });

  it("keeps every authored row, in order, through the parse", () => {
    // The parser rebuilds its result rather than returning what it was
    // given, so "it validated" has to also mean "it did not drop anything".
    const file = "basics-under-cover.json";
    const raw = JSON.parse(readFileSync(join(PANELS_DIR, file), "utf8")) as GraphPanelSpec;
    const spec = parsePanelSpec(raw, { source: file });
    expect(spec.sections.map((s) => s.title)).toEqual(raw.sections.map((s) => s.title));
    expect(spec.sections.flatMap((s) => s.controls.map((c) => c.param))).toEqual(
      raw.sections.flatMap((s) => s.controls.map((c) => c.param)),
    );
  });
});

/**
 * A spec that exercises every optional the format has, so a mutation can
 * remove or corrupt any one of them and still be a one-change diff.
 *
 * `also` is here and in no corpus file — 0 of 261 shipped rows use it — so
 * without this fixture the mirror rules would be reachable by nothing.
 * `visibleWhen` IS in the corpus (see the sweep below), but only in its
 * simplest forms; the AND-across-two-keys shape lives only here.
 */
function validSpec(): Record<string, unknown> {
  return {
    _comment: "an authoring note the format carries and nothing reads",
    sections: [
      {
        title: "scatter",
        _comment: "sections may be annotated too",
        controls: [
          { param: "grid.cellSize", label: "cell", min: 1, max: 50, step: 0.5, unit: "m" },
          { param: "$density", label: "density", description: "points per square metre" },
        ],
      },
      {
        title: "dunes",
        controls: [
          {
            param: "dunes.translate.amplitude",
            label: "height",
            also: ["ridges.translate.amplitude", "$duneEcho"],
            step: 0.25,
            _comment: "controls may be annotated too",
          },
          {
            // Every shape a gate has, in one row: two keys (which must BOTH
            // hold), a scalar on one and a list on the other, and a
            // graph-scoped address beside a node one. `visibleWhen` is on
            // this row and no other, so a mutation to it stays a one-change
            // diff of a spec this file asserts is valid.
            param: "dunes.translate.frequency",
            label: "ridge frequency",
            visibleWhen: { $mode: "dunes", "grid.cellSize": [10, 20, 30] },
          },
        ],
      },
    ],
  };
}

/** Apply `edit` to a deep copy of the fixture, so cases cannot leak. */
function mutated(edit: (spec: Record<string, unknown>) => void): Record<string, unknown> {
  const spec = validSpec();
  edit(spec);
  return spec;
}

type Sections = Record<string, unknown>[];
const sectionsOf = (s: Record<string, unknown>): Sections => s.sections as Sections;
const controlsOf = (s: Record<string, unknown>, i: number): Record<string, unknown>[] =>
  sectionsOf(s)[i].controls as Record<string, unknown>[];

/**
 * One negative control: what is wrong, the one-change spec, and the
 * fragments the message must contain.
 *
 * `expect` is checked as SUBSTRINGS rather than a whole message, because
 * the prose gets reworded and the parts that must survive a rewording are
 * the address of the fault and the word that names it. Every case requires
 * the path, so "it threw" can never stand in for "it said where".
 */
interface Case {
  readonly why: string;
  readonly spec: unknown;
  readonly expect: readonly string[];
  readonly opts?: ParsePanelSpecOptions;
}

const CASES: readonly Case[] = [
  // ---- the root is not a spec at all -------------------------------------
  { why: "root is null", spec: null, expect: ["expected an object", "got null"] },
  { why: "root is an array", spec: [], expect: ["expected an object", "got an array"] },
  { why: "root is a string", spec: "{}", expect: ["expected an object", "got a string"] },
  {
    why: "root has no sections",
    spec: { _comment: "nothing here" },
    expect: ['missing "sections"'],
  },
  {
    why: "sections is not an array",
    spec: { sections: { first: {} } },
    expect: ["fixture: sections:", "expected an array of sections", "got a object"],
  },
  {
    why: "sections is empty",
    spec: { sections: [] },
    expect: ["fixture: sections:", "at least one section", "hides every knob"],
  },

  // ---- unknown keys, which is the whole point of the strict allow-list ----
  {
    // The exact ask this format exists to answer. `group` is per-graph
    // presentation and belongs HERE, in a section title — not on a node
    // type's ParamSchema. A misspelling has to say so out loud.
    why: "an unknown key at the root",
    spec: mutated((s) => {
      s.group = "Scatter";
    }),
    expect: ['unknown key "group"', "allowed keys: sections, _comment"],
  },
  {
    why: "an unknown key on a section",
    spec: mutated((s) => {
      sectionsOf(s)[0].collapsed = true;
    }),
    expect: ["sections[0]", 'unknown key "collapsed"', "allowed keys: title, controls, _comment"],
  },
  {
    why: "an unknown key on a control",
    spec: mutated((s) => {
      controlsOf(s, 0)[1].enumLabels = { a: "A" };
    }),
    expect: [
      "sections[0].controls[1]",
      'unknown key "enumLabels"',
      "allowed keys: param, also, visibleWhen, label, description, min, max, step, unit, _comment",
    ],
  },
  {
    // The near-miss the new key invites: every other conditional-visibility
    // format in circulation spells it something else.
    why: "a near-miss spelling of visibleWhen",
    spec: mutated((s) => {
      controlsOf(s, 1)[1].showIf = { $mode: "dunes" };
    }),
    expect: ['unknown key "showIf"', "visibleWhen"],
  },
  {
    why: "a near-miss spelling of a real key",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].steps = 2;
    }),
    expect: ['unknown key "steps"', "step"],
  },

  // ---- section shape -----------------------------------------------------
  {
    why: "a section is not an object",
    spec: { sections: ["scatter"] },
    expect: ["sections[0]", "expected a section object", "got a string"],
  },
  {
    why: "a section has no title",
    spec: mutated((s) => {
      delete sectionsOf(s)[1].title;
    }),
    expect: ["sections[1]", 'missing "title"'],
  },
  {
    why: "a section title is empty",
    spec: mutated((s) => {
      sectionsOf(s)[0].title = "";
    }),
    expect: ["sections[0].title", "non-empty string"],
  },
  {
    why: "a section title is a number",
    spec: mutated((s) => {
      sectionsOf(s)[0].title = 3;
    }),
    expect: ["sections[0].title", "expected a string", "got a number"],
  },
  {
    why: "a section has no controls",
    spec: mutated((s) => {
      delete sectionsOf(s)[0].controls;
    }),
    expect: ["sections[0]", 'missing "controls"'],
  },
  {
    why: "a section's controls is not an array",
    spec: mutated((s) => {
      sectionsOf(s)[0].controls = {};
    }),
    expect: ["sections[0].controls", "expected an array of controls"],
  },
  {
    why: "a section has zero controls",
    spec: mutated((s) => {
      sectionsOf(s)[0].controls = [];
    }),
    expect: ["sections[0].controls", "at least one control", "renders nothing"],
  },

  // ---- control shape -----------------------------------------------------
  {
    why: "a control is not an object",
    spec: mutated((s) => {
      controlsOf(s, 0)[0] = "grid.cellSize" as unknown as Record<string, unknown>;
    }),
    expect: ["sections[0].controls[0]", "expected a control object", "got a string"],
  },
  {
    why: "a control has no param",
    spec: mutated((s) => {
      delete controlsOf(s, 0)[1].param;
    }),
    expect: ["sections[0].controls[1].param", "expected a string", "got a undefined"],
  },
  {
    why: "a param is not a string",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].param = 7;
    }),
    expect: ["sections[0].controls[0].param", "expected a string", "got a number"],
  },
  {
    why: "a param is empty",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].param = "";
    }),
    expect: ["sections[0].controls[0].param", "empty string", "<nodeId>.<paramName>"],
  },
  {
    // The realistic authoring slip: naming the param without its node.
    why: "a param names no node",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].param = "cellSize";
    }),
    expect: ['"cellSize" is not a knob address', "<nodeId>.<paramName>", "$<name>"],
  },
  {
    why: "a param is a bare $",
    spec: mutated((s) => {
      controlsOf(s, 0)[1].param = "$";
    }),
    expect: ['"$" is not a knob address'],
  },
  {
    why: "a graph-scoped param has a dot in it",
    spec: mutated((s) => {
      controlsOf(s, 0)[1].param = "$grid.density";
    }),
    expect: ['"$grid.density" is not a knob address'],
  },
  {
    why: "a param starts with its separator",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].param = ".cellSize";
    }),
    expect: ['".cellSize" is not a knob address'],
  },
  {
    why: "a param ends with its separator",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].param = "grid.";
    }),
    expect: ['"grid." is not a knob address'],
  },

  // ---- the mirror list ---------------------------------------------------
  {
    why: "also is not an array",
    spec: mutated((s) => {
      controlsOf(s, 1)[0].also = "ridges.translate.amplitude";
    }),
    expect: ["sections[1].controls[0].also", "expected an array of knob addresses"],
  },
  {
    why: "an also entry is not an address",
    spec: mutated((s) => {
      controlsOf(s, 1)[0].also = ["ridges.translate.amplitude", "amplitude"];
    }),
    expect: ["sections[1].controls[0].also[1]", '"amplitude" is not a knob address'],
  },
  {
    why: "an also entry is the row's own param",
    spec: mutated((s) => {
      controlsOf(s, 1)[0].also = ["dunes.translate.amplitude"];
    }),
    expect: ["sections[1].controls[0].also[0]", "this row's own param"],
  },
  {
    why: "an also entry is listed twice",
    spec: mutated((s) => {
      controlsOf(s, 1)[0].also = ["ridges.translate.amplitude", "ridges.translate.amplitude"];
    }),
    expect: ["sections[1].controls[0].also[1]", "listed twice"],
  },

  // ---- the gate ----------------------------------------------------------
  {
    why: "visibleWhen is not an object",
    spec: mutated((s) => {
      controlsOf(s, 1)[1].visibleWhen = ["$mode"];
    }),
    expect: [
      "sections[1].controls[1].visibleWhen",
      "expected an object mapping a knob address",
      "got an array",
    ],
  },
  {
    why: "visibleWhen is empty",
    spec: mutated((s) => {
      controlsOf(s, 1)[1].visibleWhen = {};
    }),
    expect: [
      "sections[1].controls[1].visibleWhen",
      "at least one condition",
      "always shown",
      "Omit the key",
    ],
  },
  {
    // The realistic slip, and the same one `param` already refuses: naming
    // the knob without its node.
    why: "a gate key is not an address",
    spec: mutated((s) => {
      controlsOf(s, 1)[1].visibleWhen = { mode: "dunes" };
    }),
    expect: [
      'sections[1].controls[1].visibleWhen["mode"]',
      '"mode" is not a knob address',
      "$<name>",
    ],
  },
  {
    why: "a gate key is an empty string",
    spec: mutated((s) => {
      controlsOf(s, 1)[1].visibleWhen = { "": "dunes" };
    }),
    expect: ['sections[1].controls[1].visibleWhen[""]', "empty string", "<nodeId>.<paramName>"],
  },
  {
    // The trap the format exists to close: hide the row by turning it, and
    // there is nothing left on screen to turn it back with.
    why: "a row gates on its own param",
    spec: mutated((s) => {
      controlsOf(s, 1)[1].visibleWhen = { "dunes.translate.frequency": 2 };
    }),
    expect: [
      'sections[1].controls[1].visibleWhen["dunes.translate.frequency"]',
      "this row's own param",
      "gate on another knob",
    ],
  },
  {
    // The same trap one step removed: a mirror holds whatever the row last
    // wrote, so gating on it is gating on the row itself.
    why: "a row gates on a knob its own `also` mirrors",
    spec: mutated((s) => {
      controlsOf(s, 1)[0].visibleWhen = { "$duneEcho": 3 };
    }),
    expect: [
      'sections[1].controls[0].visibleWhen["$duneEcho"]',
      "mirrored by this row's `also`",
      "no way back",
    ],
  },
  {
    why: "a gate value is null",
    spec: mutated((s) => {
      controlsOf(s, 1)[1].visibleWhen = { $mode: null };
    }),
    expect: [
      'sections[1].controls[1].visibleWhen["$mode"]',
      "expected a number, string or boolean",
      "got null",
    ],
  },
  {
    why: "a gate value is an object",
    spec: mutated((s) => {
      controlsOf(s, 1)[1].visibleWhen = { $mode: { equals: "dunes" } };
    }),
    expect: [
      'sections[1].controls[1].visibleWhen["$mode"]',
      "expected a number, string or boolean",
      "got a object",
    ],
  },
  {
    why: "a gate value is not finite",
    spec: mutated((s) => {
      controlsOf(s, 1)[1].visibleWhen = { "grid.cellSize": Number.NaN };
    }),
    expect: [
      'sections[1].controls[1].visibleWhen["grid.cellSize"]',
      "finite number",
      "NaN",
      "never be shown",
    ],
  },
  {
    why: "a gate list is empty",
    spec: mutated((s) => {
      controlsOf(s, 1)[1].visibleWhen = { "grid.cellSize": [] };
    }),
    expect: [
      'sections[1].controls[1].visibleWhen["grid.cellSize"]',
      "at least one value",
      "matches nothing",
    ],
  },
  {
    why: "a gate list holds a non-scalar",
    spec: mutated((s) => {
      controlsOf(s, 1)[1].visibleWhen = { "grid.cellSize": [10, [20]] };
    }),
    expect: [
      'sections[1].controls[1].visibleWhen["grid.cellSize"][1]',
      "expected a number, string or boolean",
      "got an array",
    ],
  },
  {
    // A sparse array reaches the parser from a host building a spec in JS.
    // `forEach` would skip the hole and normalize `[1, , 2]` to a dense
    // two-entry list — a silent edit of what the author wrote.
    why: "a gate list has a hole in it",
    spec: mutated((s) => {
      const sparse = [1, 2];
      delete sparse[0];
      controlsOf(s, 1)[1].visibleWhen = { "grid.cellSize": sparse };
    }),
    expect: [
      'sections[1].controls[1].visibleWhen["grid.cellSize"][0]',
      "expected a number, string or boolean",
      "got a undefined",
    ],
  },
  {
    // The two-step form of the self-gate trap: turn A out of B's range,
    // then B out of A's, and neither row is on screen to undo either.
    why: "two rows gate each other",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].visibleWhen = { $density: 1 };
      controlsOf(s, 0)[1].visibleWhen = { "grid.cellSize": 2 };
    }),
    expect: [
      "visibleWhen",
      "closes a loop",
      '"grid.cellSize"',
      '"$density"',
      "none of them is drawn",
    ],
  },
  {
    why: "three rows gate each other round a longer ring",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].visibleWhen = { $density: 1 };
      controlsOf(s, 0)[1].visibleWhen = { "dunes.translate.frequency": 2 };
      controlsOf(s, 1)[1].visibleWhen = { "grid.cellSize": 3 };
    }),
    expect: ["closes a loop", "Gate the chain on a knob no row in it writes"],
  },
  {
    why: "a gate list repeats a value",
    spec: mutated((s) => {
      controlsOf(s, 1)[1].visibleWhen = { $mode: ["dunes", "ridges", "dunes"] };
    }),
    expect: ['sections[1].controls[1].visibleWhen["$mode"][2]', '"dunes" is listed twice'],
  },

  // ---- text fields -------------------------------------------------------
  {
    why: "a label is not a string",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].label = ["cell"];
    }),
    expect: ["sections[0].controls[0].label", "expected a string", "got an array"],
  },
  {
    why: "a label is empty",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].label = "";
    }),
    expect: ["sections[0].controls[0].label", "non-empty string", "omit the key"],
  },
  {
    why: "a description is not a string",
    spec: mutated((s) => {
      controlsOf(s, 0)[1].description = 42;
    }),
    expect: ["sections[0].controls[1].description", "expected a string", "got a number"],
  },
  {
    why: "a unit is empty",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].unit = "";
    }),
    expect: ["sections[0].controls[0].unit", "non-empty string"],
  },
  {
    why: "a _comment is not a string",
    spec: mutated((s) => {
      s._comment = { note: "hi" };
    }),
    expect: ["fixture: _comment:", "expected a string", "got a object"],
  },

  // ---- numbers and bounds ------------------------------------------------
  {
    why: "min is a string",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].min = "1";
    }),
    expect: ["sections[0].controls[0].min", "expected a number", "got a string"],
  },
  {
    why: "max is null",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].max = null;
    }),
    expect: ["sections[0].controls[0].max", "expected a number", "got null"],
  },
  {
    why: "a bound is not finite",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].max = Number.POSITIVE_INFINITY;
    }),
    expect: ["sections[0].controls[0].max", "finite number", "Infinity"],
  },
  {
    why: "a bound is NaN",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].min = Number.NaN;
    }),
    expect: ["sections[0].controls[0].min", "finite number", "NaN"],
  },
  {
    why: "min is greater than max",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].min = 60;
    }),
    expect: ["sections[0].controls[0].min", "greater than max", "no positions"],
  },
  {
    why: "step is zero",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].step = 0;
    }),
    expect: ["sections[0].controls[0].step", "positive number", "quantises every value"],
  },
  {
    why: "step is negative",
    spec: mutated((s) => {
      controlsOf(s, 1)[0].step = -0.25;
    }),
    expect: ["sections[1].controls[0].step", "positive number"],
  },

  // ---- one address, one row ----------------------------------------------
  {
    why: "the same param is claimed by two rows in one section",
    spec: mutated((s) => {
      controlsOf(s, 0)[1].param = "grid.cellSize";
    }),
    expect: [
      "sections[0].controls[1].param",
      "already the param of",
      "sections[0].controls[0]",
      "One address is one row",
    ],
  },
  {
    why: "the same param is claimed by two rows in different sections",
    spec: mutated((s) => {
      controlsOf(s, 1)[0].param = "$density";
    }),
    expect: ["sections[1].controls[0].param", "already the param of", "sections[0].controls[1]"],
  },
  {
    // The one a single pass cannot catch, and the reason claims are
    // settled after the walk: the row that OWNS `grid.cellSize` is read
    // before the row that mirrors it here, but the reverse order is just
    // as legal in a file and must fail identically.
    why: "an also entry mirrors a knob another row owns outright",
    spec: mutated((s) => {
      controlsOf(s, 0)[1].also = ["grid.cellSize"];
    }),
    expect: [
      "sections[0].controls[1].also[0]",
      '"grid.cellSize" is the param of sections[0].controls[0]',
      "written from two places",
    ],
  },
  {
    why: "two rows mirror the same knob",
    spec: mutated((s) => {
      controlsOf(s, 0)[1].also = ["ridges.translate.amplitude"];
    }),
    expect: [
      "sections[1].controls[0].also[0]",
      "already mirrored by sections[0].controls[1].also[0]",
      "mirror it from one row only",
    ],
  },

  // ---- addresses that could never match a knob ---------------------------
  {
    why: "a param has an empty segment between its dots",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].param = "grid..cellSize";
    }),
    expect: ['"grid..cellSize" is not a knob address'],
  },
  {
    why: "a param has trailing whitespace",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].param = "grid.cellSize ";
    }),
    expect: ['"grid.cellSize " is not a knob address'],
  },
  {
    why: "a param carries a control character",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].param = "grid.cell\nSize";
    }),
    expect: ["is not a knob address"],
  },
  {
    why: "a graph-scoped param is $ and a space",
    spec: mutated((s) => {
      controlsOf(s, 0)[1].param = "$ ";
    }),
    expect: ["is not a knob address"],
  },

  // ---- blank is not the same as absent -----------------------------------
  {
    // `""` was already refused with "the title is what groups the rows".
    // Three spaces group exactly as little, and are harder to see in a diff.
    why: "a section title is only whitespace",
    spec: mutated((s) => {
      sectionsOf(s)[0].title = "   ";
    }),
    expect: ["sections[0].title", "non-empty string", '"   "'],
  },
  {
    why: "a label is only whitespace",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].label = "\t";
    }),
    expect: ["sections[0].controls[0].label", "non-empty string"],
  },

  // ---- bounds that leave nothing to turn ---------------------------------
  {
    // The sibling of min > max, and the one the "no positions" message
    // was quietly wrong about: [7, 7] has exactly one.
    why: "min equals max",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].min = 50;
    }),
    expect: ["sections[0].controls[0].min", "min and max are both 50", "nothing to drag"],
  },
  {
    why: "step is wider than the range it quantises",
    spec: mutated((s) => {
      controlsOf(s, 0)[0].step = 100;
    }),
    expect: ["sections[0].controls[0].step", "wider than the range [1, 50]", "can only reach"],
  },

  // ---- two sections that read as one -------------------------------------
  {
    why: "two sections share a title",
    spec: mutated((s) => {
      sectionsOf(s)[1].title = "scatter";
    }),
    expect: ["sections[1].title", "already the title of sections[0]", "split in half"],
  },
];

describe("the validator rejects a malformed panel, and says where", () => {
  it("accepts the fixture every case below is a one-change edit of", () => {
    // The positive control. Without it a validator that threw on
    // EVERYTHING would pass every case below and look thorough.
    const spec = parsePanelSpec(validSpec(), { source: "fixture" });
    expect(spec.sections).toHaveLength(2);
    expect(spec.sections[1].controls[0].also).toEqual([
      "ridges.translate.amplitude",
      "$duneEcho",
    ]);
    // The gate survives the rebuild with both keys, the list intact and in
    // the order it was written — and as a COPY, so a caller mutating what
    // it handed in cannot reach into the parsed spec afterwards.
    const gated = spec.sections[1].controls[1];
    expect(gated.visibleWhen).toEqual({ $mode: "dunes", "grid.cellSize": [10, 20, 30] });
    expect(Object.keys(gated.visibleWhen ?? {})).toEqual(["$mode", "grid.cellSize"]);
    const source = validSpec();
    const raw = (source.sections as Sections)[1].controls as Record<string, unknown>[];
    expect(gated.visibleWhen).not.toBe(raw[1].visibleWhen);
    expect(gated.visibleWhen?.["grid.cellSize"]).not.toBe(
      (raw[1].visibleWhen as Record<string, unknown>)["grid.cellSize"],
    );
    expect(spec._comment).toContain("authoring note");
    expect(spec.sections[0].controls[0]).toEqual({
      param: "grid.cellSize",
      label: "cell",
      min: 1,
      max: 50,
      step: 0.5,
      unit: "m",
    });
    // Absent optionals stay absent rather than becoming `undefined`, so a
    // spec that round-trips compares equal to one written by hand.
    expect(Object.keys(spec.sections[0].controls[1])).toEqual(["param", "label", "description"]);
  });

  it("has a case for every class of error the format defines", () => {
    // A case list that shrinks by accident is a quieter pass, not a
    // failure. This is the number that has to be edited deliberately.
    expect(CASES.length).toBe(71);
    expect(new Set(CASES.map((c) => c.why)).size, "two cases share a `why`").toBe(CASES.length);
  });

  for (const c of CASES) {
    it(`rejects: ${c.why}`, () => {
      let thrown: unknown;
      try {
        parsePanelSpec(c.spec, c.opts ?? { source: "fixture" });
      } catch (err) {
        thrown = err;
      }
      expect(thrown, `parsePanelSpec accepted a spec where ${c.why}`).toBeInstanceOf(
        PanelSpecError,
      );
      const message = (thrown as PanelSpecError).message;
      expect((thrown as PanelSpecError).name).toBe("PanelSpecError");
      // Every message names the panel first, so a host validating a
      // directory of them knows which file to open.
      expect(message.startsWith("fixture"), `message does not name the source: ${message}`).toBe(
        true,
      );
      for (const fragment of c.expect) {
        expect(message, `message for "${c.why}" omits ${JSON.stringify(fragment)}`).toContain(
          fragment,
        );
      }
    });
  }

  it("names the caller's own source, whatever it is", () => {
    // The source is prose the caller chooses — a file name here, a URL or
    // a record id in a host. It must survive into the message unaltered.
    expect(() => parsePanelSpec({}, { source: "https://example.test/panels/17.json" })).toThrow(
      /^https:\/\/example\.test\/panels\/17\.json: missing "sections"/,
    );
  });

  it("falls back to a usable name when the caller gives none", () => {
    expect(() => parsePanelSpec({})).toThrow(/^panel spec: missing "sections"/);
  });

  it("accepts a node id containing a dot, which the corpus happens not to have", () => {
    // The rule is deliberately not a dot COUNT. A node called `a.b` makes
    // `a.b.c` a two-part address and `a.b.c.d` a three-part one, and a
    // validator fitted to the shipped corpus — which holds only one- and
    // two-dot addresses — would reject graphs the library accepts.
    const spec = parsePanelSpec({
      sections: [
        {
          title: "deep",
          controls: [{ param: "outer.inner.node.cellSize.amplitude" }],
        },
      ],
    });
    expect(spec.sections[0].controls[0].param).toBe("outer.inner.node.cellSize.amplitude");
  });
});

/**
 * THE THIRD HALF: the gate has to REACH A ROW, or the format is decoration.
 *
 * The two halves above prove `visibleWhen` parses and that a malformed one
 * is refused. Neither proves a row ever disappears. This one runs the
 * authored spec through the panel builder the editor uses and then through
 * the same predicate `Controls.svelte` renders with, so "the format carries
 * it" and "the panel obeys it" are separate assertions — the first passed
 * for a while before the second existed, and that is exactly the state this
 * block exists to make impossible to return to.
 *
 * Knobs are hand-built rather than cooked out of a graph: what is under test
 * is the gate, and a `sweepProfile` standing in for it would only add a
 * second thing that can break.
 */
describe("a gate reaches the rendered row", () => {
  const enumKnob = (key: string, value: string, choices: readonly string[]): Knob => ({
    scope: "node",
    node: key.split(".")[0],
    name: key.split(".")[1],
    key,
    nodeLabel: "sweepProfile",
    schema: { type: "enum", default: choices[0], description: "", enum: choices },
    value,
    isField: false,
    exposed: false,
  });

  const numberKnob = (key: string, value: number): Knob => ({
    scope: "node",
    node: key.split(".")[0],
    name: key.split(".")[1],
    key,
    nodeLabel: "sweepProfile",
    schema: { type: "i32", default: value, description: "", min: 3, max: 64 },
    value,
    isField: false,
    exposed: false,
  });

  /** The shipped `basics-sweep-profile` shape, reduced to what gates it. */
  const knobs = (profile: string, joint: string): readonly Knob[] => [
    enumKnob("skin.profile", profile, ["circle", "square", "ribbon"]),
    enumKnob("skin.joint", joint, ["miter", "perpendicular"]),
    numberKnob("skin.sides", 10),
    numberKnob("skin.miterLimit", 4),
    numberKnob("skin.width", 1),
  ];

  const SPEC = (): GraphPanelSpec =>
    parsePanelSpec(
      JSON.parse(readFileSync(join(PANELS_DIR, "basics-sweep-profile.json"), "utf8")),
      { source: "basics-sweep-profile.json" },
    );

  /** The rows a panel would actually draw, in order, for these knob values. */
  const drawn = (profile: string, joint: string): string[] => {
    const spec = SPEC();
    const panel = buildKnobPanel(knobs(profile, joint), spec);
    return panel.sections.flatMap((section) =>
      visibleControls(section, panel.values).map((c) => ("key" in c ? c.key : c.items[0].key)),
    );
  };

  it("draws only the rows the current mode applies to", () => {
    // A circle has sides and no width; a mitred joint has a limit.
    expect(drawn("circle", "miter")).toEqual([
      "skin.profile",
      "skin.sides",
      "skin.joint",
      "skin.miterLimit",
    ]);
    // A ribbon swaps `sides` for `width`; a perpendicular joint drops the
    // limit. Nothing else moved, and no knob lost its value.
    // The authored order is kept — `width` sits where the spec puts it,
    // above `joint`, rather than being appended where the gate opened.
    expect(drawn("ribbon", "perpendicular")).toEqual([
      "skin.profile",
      "skin.width",
      "skin.joint",
    ]);
  });

  it("re-reads the gate from the live values, not from the cooked graph", () => {
    // The behaviour a host depends on: `Controls.svelte` renders the panel's
    // own record, and a select writes that record before the graph hears
    // about it. So editing the record alone must move the rows — if the gate
    // were resolved when the panel was BUILT, this would still show `sides`.
    const spec = SPEC();
    const panel = buildKnobPanel(knobs("circle", "miter"), spec);
    const surface = panel.sections[panel.sections.length - 1];
    expect(visibleControls(surface, panel.values).map((c) => ("key" in c ? c.key : ""))).toContain(
      "skin.sides",
    );

    const edited = { ...panel.values, "skin.profile": "ribbon" };
    const keys = visibleControls(surface, edited).map((c) => ("key" in c ? c.key : ""));
    expect(keys).not.toContain("skin.sides");
    expect(keys).toContain("skin.width");
    // And the hidden row's VALUE is untouched: hiding is presentation, and
    // the graph still cooks with whatever `sides` holds.
    expect(panel.values["skin.sides"]).toBe(10);
  });

  it("keeps the knob a gate READS readable even when no row shows it", () => {
    // The gate may name a knob the spec chose not to surface. Its value has
    // to reach the panel's record anyway, or the gate resolves to nothing
    // and the row hangs permanently open.
    const spec: GraphPanelSpec = {
      sections: [
        {
          title: "surface",
          controls: [{ param: "skin.sides", visibleWhen: { "skin.profile": "circle" } }],
        },
      ],
    };
    const panel = buildKnobPanel(knobs("ribbon", "miter"), spec);
    expect(panel.values["skin.profile"]).toBe("ribbon");
    expect(visibleControls(panel.sections[0], panel.values)).toEqual([]);
  });

  it("shows the row, and SAYS SO, when a gate names a knob the graph lacks", () => {
    // The safe way round. A silently-hidden row leaves an author looking for
    // a knob that is not there; an inert gate leaves the row on screen and
    // the reason beside the panel.
    const spec: GraphPanelSpec = {
      sections: [
        {
          title: "surface",
          controls: [{ param: "skin.sides", visibleWhen: { "skin.shape": "circle" } }],
        },
      ],
    };
    const panel = buildKnobPanel(knobs("ribbon", "miter"), spec);
    expect(panel.unknown).toEqual(["skin.shape"]);
    expect(visibleControls(panel.sections[0], panel.values).map((c) => ("key" in c ? c.key : ""))
    ).toEqual(["skin.sides"]);
  });

  it("reports a gate on a knob no widget can read, once", () => {
    // `Overview.svelte` renders `skipped` as a keyed {#each}, and a repeated
    // key is a RUNTIME error there — reachable the moment two rows gate on
    // the same unreadable knob, which is the normal way to write a mode.
    const fielded: Knob = { ...numberKnob("skin.roll", 0), isField: true };
    const spec: GraphPanelSpec = {
      sections: [
        {
          title: "surface",
          controls: [
            { param: "skin.sides", visibleWhen: { "skin.roll": 0 } },
            { param: "skin.width", visibleWhen: { "skin.roll": 0 } },
          ],
        },
      ],
    };
    const panel = buildKnobPanel([...knobs("circle", "miter"), fielded], spec);
    expect(panel.skipped.filter((s) => s.key === "skin.roll")).toHaveLength(1);
    expect(panel.skipped[0].reason).toContain("holds a field");
    // Unreadable means inert, not hidden.
    expect(visibleControls(panel.sections[0], panel.values)).toHaveLength(2);
  });

  it("leaves a gate on a value no gate can read INERT, in either row order", () => {
    // A gate's vocabulary is the three scalars. The knob it names may hold
    // something else — a `numberList` is the reachable case — and then the
    // gate is UNANSWERABLE, which the format says leaves the row shown. Two
    // ways to get that wrong, and this covers both: registering the array
    // as a value would make the gate FAIL and hide the row for a reason
    // nothing explains, and registering it in only one of the two possible
    // row orders would make it an ordering fact.
    const weights: Knob = {
      scope: "node",
      node: "skin",
      name: "weights",
      key: "skin.weights",
      nodeLabel: "sweepProfile",
      schema: { type: "numberList", default: [1, 2], description: "" },
      value: [1, 2],
      isField: false,
      exposed: false,
    };
    const rows = [
      { param: "skin.sides", visibleWhen: { "skin.weights": 1 } },
      { param: "skin.weights" },
    ];
    const panelFor = (controls: typeof rows): KnobPanel => {
      const spec: GraphPanelSpec = { sections: [{ title: "surface", controls }] };
      return buildKnobPanel([...knobs("circle", "miter"), weights], spec);
    };
    const shownFor = (controls: typeof rows): string[] => {
      const panel = panelFor(controls);
      return visibleControls(panel.sections[0], panel.values).map((c) =>
        "key" in c ? c.key : "",
      );
    };
    // `skin.weights` has no widget either way, so only `skin.sides` is ever
    // a row — and it is shown, because its gate cannot be answered.
    expect(shownFor(rows)).toEqual(["skin.sides"]);
    expect(shownFor([...rows].reverse())).toEqual(["skin.sides"]);
    // Said out loud rather than left to be discovered, and said ONCE.
    for (const controls of [rows, [...rows].reverse()]) {
      const panel = panelFor(controls);
      const notes = panel.skipped.filter((s) => s.key === "skin.weights");
      expect(notes).toHaveLength(1);
      expect(panel.values).not.toHaveProperty("skin.weights");
    }
  });

  it("drops a section whose every row is gated off", () => {
    // A titled group with no rows under it is a heading that leads nowhere,
    // and in a tabbed panel a tab that opens on blank space. The section
    // still EXISTS in the built panel — the values behind it are live and
    // one flip brings it back — so the drop is the renderer's.
    const spec: GraphPanelSpec = {
      sections: [
        { title: "profile", controls: [{ param: "skin.profile" }] },
        {
          title: "ribbon",
          controls: [{ param: "skin.width", visibleWhen: { "skin.profile": "ribbon" } }],
        },
      ],
    };
    const panel = buildKnobPanel(knobs("circle", "miter"), spec);
    expect(panel.sections.map((s) => s.title)).toEqual(["profile", "ribbon"]);
    expect(
      panel.sections.filter((s) => visibleControls(s, panel.values).length > 0).map((s) => s.title),
    ).toEqual(["profile"]);
  });
});
