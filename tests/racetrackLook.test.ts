/**
 * The look, and the two conversions the panel hangs off.
 *
 * WHY A SUITE FOR WHAT LOOKS LIKE PRESENTATION. A look decides no
 * placement — that is the property `demos/racetrack/look.ts` is built to
 * guarantee — so nothing here can catch a wrong lap. What it catches is
 * the OTHER failure mode, which is worse to debug precisely because the
 * lap is fine: a colour that arrives as `NaN` lands in a material, comes
 * out black, and the hunt starts at the mesh rather than at the string
 * that caused it. Every assertion below is on a value that reaches a
 * `Color.setHex` or an `<input type="color">`.
 *
 * THE TWO CONVERSIONS HAVE NO OTHER TEST. `hexToCss` and `cssToHex` are
 * the whole contract of the shared `color` control kind, their contract IS
 * their edge cases, and a later "simplification" of the `& 0xffffff` mask
 * into a `Math.min`/`Math.max` pair would break the NaN handling with
 * nothing to notice. They live in `shared/`, so this is the suite that
 * owns them.
 */
import { describe, expect, it } from "vitest";
import { cssToHex, hexToCss } from "../shared/controls.js";
import {
  BLUEPRINT,
  DEFAULT_PRESET,
  MONUMENT,
  PLAN,
  PRESETS,
  SMOKE,
  XRAY,
  type Look,
  type Surface,
  assetColor,
  cloneLook,
  isLit,
  mapColor,
  mixHex,
  readAssetId,
} from "../demos/racetrack/look.js";
import {
  LOOK_SECTIONS,
  RESTYLE_KEYS,
  readLook,
  writeLook,
  type LookValues,
} from "../demos/racetrack/lookPanel.js";
import { BOX_ROLES, boxAssetIds } from "../demos/racetrack/spawn.js";
import type { AssetMap } from "pcg-ts/three";
import type { Material } from "three";
import {
  disposeAssetMap,
  makeAssetMap,
  makeEdgeAssetMap,
  makeMapMaterials,
  retintAssetMap,
  retintEdgeAssetMap,
  retintMapMaterials,
} from "../demos/racetrack/assets3d.js";

describe("hexToCss / cssToHex", () => {
  it("always emits seven characters, whatever it is handed", () => {
    // The padding is the whole job: `0x0088ff` renders as "88ff"
    // unpadded, and a colour input handed a value it cannot parse does
    // not complain — it shows black. A swatch silently disagreeing with
    // the number behind it is what this prevents.
    for (const n of [0, 1, 0x0088ff, 0xffffff, 0x123456]) {
      expect(hexToCss(n), `hexToCss(${n})`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("never emits 'nan', for any of the four ways a number goes bad", () => {
    for (const n of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5]) {
      const css = hexToCss(n);
      expect(css, `hexToCss(${n})`).toMatch(/^#[0-9a-f]{6}$/);
      expect(css).not.toContain("nan");
    }
  });

  it("masks rather than overflows above 0xffffff", () => {
    expect(hexToCss(0x1000000)).toBe("#000000");
    expect(hexToCss(0x1abcdef)).toBe("#abcdef");
  });

  it("reads a colour back with or without the hash", () => {
    expect(cssToHex("#abcdef")).toBe(0xabcdef);
    expect(cssToHex("abcdef")).toBe(0xabcdef);
    expect(cssToHex("  #ABCDEF  ")).toBe(0xabcdef);
  });

  it("answers 0 on garbage and NEVER NaN", () => {
    // Black is wrong too, but it is wrong IDENTICALLY every time, which
    // is the difference between a bug with a first suspect and one
    // without.
    for (const s of ["", "#", "nonsense", "#abc", "#abcdefg", "#gggggg", "0x123456"]) {
      const n = cssToHex(s);
      expect(Number.isNaN(n), `cssToHex(${JSON.stringify(s)}) is NaN`).toBe(false);
      expect(n, `cssToHex(${JSON.stringify(s)})`).toBe(0);
    }
    // AND THE CONTROL, because a check that only ever sees garbage cannot
    // tell "rejects everything" from "rejects the right things" — the
    // first spelling of this test compared the answer against an
    // expression derived from the same input and could not fail.
    expect(cssToHex("#000000")).toBe(0);
    expect(cssToHex("#000001")).toBe(1);
  });

  it("round-trips every colour a shipped preset carries", () => {
    for (const { id, look } of PRESETS) {
      const swatches = [
        ...Object.values(look.roles),
        look.cover,
        look.reference,
        look.road,
        look.centreline,
        look.car,
        look.sky,
        look.ground,
        look.key,
        look.fill,
        look.background,
        look.horizon,
        look.fog,
        look.mapTint,
      ];
      for (const hex of swatches) {
        expect(cssToHex(hexToCss(hex)), `${id}: ${hexToCss(hex)}`).toBe(hex);
      }
    }
  });
});

describe("mixHex", () => {
  it("is the identity at both ends", () => {
    expect(mixHex(0x123456, 0xabcdef, 0)).toBe(0x123456);
    expect(mixHex(0x123456, 0xabcdef, 1)).toBe(0xabcdef);
  });

  it("clamps rather than extrapolating", () => {
    expect(mixHex(0x123456, 0xabcdef, -1)).toBe(0x123456);
    expect(mixHex(0x123456, 0xabcdef, 5)).toBe(0xabcdef);
  });

  it("stays inside the byte range at the halfway point", () => {
    const mid = mixHex(0x000000, 0xffffff, 0.5);
    expect(mid).toBeGreaterThanOrEqual(0);
    expect(mid).toBeLessThanOrEqual(0xffffff);
    expect((mid >> 16) & 0xff).toBe(128);
  });
});

describe("readAssetId", () => {
  it("answers every id the box path can mint", () => {
    for (const id of boxAssetIds()) {
      const { role, cover } = readAssetId(id);
      expect(role, `no role for "${id}"`).toBeDefined();
      expect(cover).toBe(id.startsWith("cover:"));
      expect(BOX_ROLES).toContain(role);
    }
  });

  it("answers undefined for the two namespaces that carry no role", () => {
    // A pose is a whole placement and a kit id is a catalogue entry;
    // neither has one role, and the caller colours them per box from the
    // vertex colours instead.
    expect(readAssetId("pose:17").role).toBeUndefined();
    expect(readAssetId("cover:pose:17").role).toBeUndefined();
    expect(readAssetId("cover:pose:17").cover).toBe(true);
    expect(readAssetId("kit:42").role).toBeUndefined();
    expect(readAssetId("kit:42").cover).toBe(false);
  });
});

describe("assetColor", () => {
  it("gives each role its own colour in MONUMENT, which is the look that codes by role", () => {
    // NAMED RATHER THAN "the shipped look", which it was until the
    // default changed under it. `SMOKE` ships monochrome ON PURPOSE —
    // role colour and accumulated alpha are the same channel — so a test
    // asserting six distinct colours of whatever happens to be default
    // would fail for a reason that is not a bug.
    const seen = new Set(BOX_ROLES.map((r) => assetColor(MONUMENT, r, "generated")));
    expect(seen.size, "two roles share a colour, so the coding says less than it claims").toBe(
      BOX_ROLES.length,
    );
  });

  it("keeps SMOKE monochrome, which is the point of it rather than an oversight", () => {
    // Six hues summing through each other at alpha 0.5 make a fourth
    // colour meaning neither of the two it came from. `SMOKE` spends the
    // channel on density instead, and a later "fix" that gave it role
    // colours would quietly undo that.
    const seen = new Set(boxAssetIds().map((id) => assetColor(SMOKE, id, "generated")));
    expect(seen.size, "SMOKE has picked up a second colour").toBe(1);
  });

  it("moves a cover id away from its bare role, and only when coverMix asks", () => {
    for (const role of BOX_ROLES) {
      const bare = assetColor(MONUMENT, role, "generated");
      const cover = assetColor(MONUMENT, `cover:${role}`, "generated");
      expect(cover, `cover:${role} is indistinguishable from ${role}`).not.toBe(bare);
    }
    const flat: Look = { ...cloneLook(MONUMENT), coverMix: 0 };
    for (const role of BOX_ROLES) {
      expect(assetColor(flat, `cover:${role}`, "generated")).toBe(
        assetColor(flat, role, "generated"),
      );
    }
  });

  it("folds the reference layer to exactly one colour at referenceMix 1", () => {
    const one: Look = { ...cloneLook(MONUMENT), referenceMix: 1 };
    const seen = new Set(boxAssetIds().map((id) => assetColor(one, id, "reference")));
    expect(seen).toEqual(new Set([one.reference]));
  });

  it("codes both populations identically at referenceMix 0", () => {
    const both: Look = { ...cloneLook(MONUMENT), referenceMix: 0 };
    for (const id of boxAssetIds()) {
      expect(assetColor(both, id, "reference")).toBe(assetColor(both, id, "generated"));
    }
  });

  it("falls back to mass for an id it cannot read a role from", () => {
    expect(assetColor(MONUMENT, "pose:3", "generated")).toBe(MONUMENT.roles.mass);
  });

  it("mapColor is assetColor folded toward the map tint, and equal at mapMix 0", () => {
    const none: Look = { ...cloneLook(MONUMENT), mapMix: 0 };
    for (const id of boxAssetIds()) {
      expect(mapColor(none, id, "generated")).toBe(assetColor(none, id, "generated"));
    }
    const all: Look = { ...cloneLook(MONUMENT), mapMix: 1 };
    expect(mapColor(all, "leg", "generated")).toBe(all.mapTint);
  });
});

describe("the presets", () => {
  it("reproduces BLUEPRINT's colours exactly, which is what it claims", () => {
    // The old palette was `generated` 0x404040 and `reference` 0x999999.
    // The alpha is NOT reproduced and `look.ts` says why; the colours
    // are, and this is what pins them.
    for (const id of boxAssetIds()) {
      expect(assetColor(BLUEPRINT, id, "generated"), id).toBe(0x404040);
      expect(assetColor(BLUEPRINT, id, "reference"), id).toBe(0x999999);
    }
  });

  it("never pairs an unlit look with a lit material class", () => {
    // A lit material with no light returns black, not a flat colour —
    // which is how `PLAN` shipped for one revision, once in the chase
    // pass and once in the map pass. BOTH surfaces have to agree with
    // the lights, and `mapSurface` is decided independently of `surface`.
    for (const { id, look } of PRESETS) {
      const anyLight = look.hemi > 0 || look.keyIntensity > 0 || look.fillIntensity > 0;
      if (anyLight) continue;
      expect(look.surface, `${id}: an unlit look with a lit surface draws black`).not.toBe("solid");
      expect(look.surface, `${id}: an unlit look with a lit surface draws black`).not.toBe(
        "translucent",
      );
      expect(look.mapSurface, `${id}: an unlit look with a lit map surface draws black`).not.toBe(
        "solid",
      );
      expect(look.mapSurface, `${id}: an unlit look with a lit map surface draws black`).not.toBe(
        "translucent",
      );
    }
  });

  it("agrees with isLit about which presets are lit", () => {
    expect(isLit(MONUMENT)).toBe(true);
    expect(isLit(XRAY)).toBe(true);
    expect(isLit(PLAN)).toBe(false);
    expect(isLit(BLUEPRINT)).toBe(false);
    expect(isLit(SMOKE)).toBe(false);
  });

  it("SMOKE is BLUEPRINT with the surface filled, and differs in nothing else", () => {
    // The claim `look.ts` makes about it. Written as a diff rather than
    // as a value list so that a later edit to BLUEPRINT's palette carries
    // to SMOKE, which is the relationship the comment describes.
    const changed = new Set(["surface", "opacity", "edges", "edgeOpacity", "edgeTint",
      "mapSurface", "mapOpacity", "mapTint", "mapMix"]);
    for (const key of Object.keys(BLUEPRINT) as (keyof Look)[]) {
      if (changed.has(key) || key === "roles") continue;
      expect(SMOKE[key], `SMOKE.${key} drifted from BLUEPRINT`).toEqual(BLUEPRINT[key]);
    }
    expect(SMOKE.roles).toEqual(BLUEPRINT.roles);
    expect(SMOKE.surface).toBe("flat");
    expect(SMOKE.opacity).toBe(0.5);
  });

  it("opens on PRESETS[0], so the page and the dropdown cannot disagree", () => {
    expect(DEFAULT_PRESET).toBe(PRESETS[0]);
    expect(DEFAULT_PRESET.id).toBe("smoke");
    expect(DEFAULT_PRESET.look).toBe(SMOKE);
  });

  it("accumulates rather than occludes in the shipped default", () => {
    // THE ONE PROPERTY THE DEFAULT IS CHOSEN FOR. `flat` below alpha 1
    // turns depth writing off, which is what makes overlap read as
    // brightness; at alpha 1 it would write depth and the whole reading
    // would be gone with no other value changing.
    const map = makeAssetMap(SMOKE, "generated");
    for (const id of Object.keys(map)) {
      const m = map[id].material as Material;
      expect((m as unknown as { depthWrite: boolean }).depthWrite, id).toBe(false);
      expect((m as unknown as { transparent: boolean }).transparent, id).toBe(true);
    }
    disposeAssetMap(map);
  });

  it("carries every role in every preset, so no lookup can be undefined", () => {
    for (const { id, look } of PRESETS) {
      for (const role of BOX_ROLES) {
        expect(look.roles[role], `${id} has no colour for "${role}"`).toBeTypeOf("number");
      }
    }
  });

  it("clones deeply enough that editing one look cannot edit a preset", () => {
    // The panel mutates the live look in place, and the live look starts
    // as a clone of a module-level constant. A shallow copy would share
    // `roles`, so "reset to monument" would restore whatever the last
    // colour drag left behind.
    const live = cloneLook(MONUMENT);
    live.roles.leg = 0x010203;
    live.background = 0x040506;
    expect(MONUMENT.roles.leg).not.toBe(0x010203);
    expect(MONUMENT.background).not.toBe(0x040506);
  });
});

describe("the panel's record", () => {
  const keysOf = (look: Look): string[] => Object.keys(look).filter((k) => k !== "roles").sort();

  it("round-trips every preset without dropping or renaming a field", () => {
    for (const { id, look } of PRESETS) {
      const live = cloneLook(MONUMENT);
      writeLook(live, readLook(look, id));
      expect(live, `${id} did not survive the panel record`).toEqual(look);
    }
  });

  it("covers every scalar key of Look, so nothing is silently unreachable", () => {
    // A key added to `Look` and forgotten in `readLook`/`writeLook` is
    // not a type error — the record is its own interface — and the
    // symptom is a control that exists and does nothing.
    const values = readLook(MONUMENT, "monument") as unknown as Record<string, unknown>;
    for (const key of keysOf(MONUMENT)) {
      expect(values[key], `Look.${key} has no panel field`).toBeDefined();
    }
    for (const role of BOX_ROLES) {
      expect(values[role], `Look.roles.${role} has no panel field`).toBeDefined();
    }
  });

  it("gives every control a key the record actually holds", () => {
    const values = readLook(MONUMENT, "monument") as unknown as Record<string, unknown>;
    for (const section of LOOK_SECTIONS) {
      for (const control of section.controls) {
        const keys =
          "key" in control ? [String(control.key)] : control.items.map((i) => String(i.key));
        for (const key of keys) {
          expect(values[key], `${section.title} → "${key}" is not a LookValues key`).toBeDefined();
        }
      }
    }
  });

  it("names a restyle key for every setting that picks a material class", () => {
    // These three are the only ones no property write can express, and
    // two files act on the answer — the panel decides whether to report a
    // restyle and the page decides whether to rebuild.
    expect(RESTYLE_KEYS).toEqual(new Set(["surface", "mapSurface", "edges"]));
    const live = cloneLook(MONUMENT);
    const values: LookValues = readLook(live, "monument");
    for (const key of RESTYLE_KEYS) {
      expect(
        (values as unknown as Record<string, unknown>)[key],
        `restyle key "${key}" is not on the record`,
      ).toBeDefined();
    }
  });

  it("uses section titles that are unique, because they are also the tab labels", () => {
    const titles = LOOK_SECTIONS.map((s) => s.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

/**
 * THE BUILD PATH AND THE RETINT PATH, PINNED EQUAL.
 *
 * WHY THIS IS THE SUITE THAT MATTERS MOST HERE. `assets3d.ts` states each
 * surface's blend state twice — once in the constructor that builds a
 * material and once in the writer that repaints a live one — and the two
 * cannot be collapsed, because a constructor picks a CLASS and a repaint
 * may not. Two separate statements of one rule is exactly the shape that
 * rots, and it rotted twice before this test existed: the retint left
 * `depthWrite` alone, so dragging one always-visible alpha slider on a
 * `flat` look produced a blended material that still wrote depth and
 * could not be got back without a rebuild; and it wrote `look.opacity`
 * onto a `solid` material the constructor pins at 1.
 *
 * NEITHER WAS CAUGHT BY A TYPE OR BY A RENDER. The first is invisible
 * until geometry happens to overlap; the second is invisible always. What
 * catches both is asking whether a material retinted INTO a look is the
 * material that look would have BUILT.
 */
describe("build and retint agree", () => {
  const SURFACES = ["solid", "translucent", "flat", "wireframe"] as const;

  /** Everything a retint is allowed to change, read off a built material. */
  function shapeOf(m: Material): Record<string, unknown> {
    const basic = m as unknown as {
      color?: { getHex(): number };
      opacity: number;
      transparent: boolean;
      depthWrite: boolean;
      vertexColors: boolean;
      wireframe?: boolean;
      roughness?: number;
      metalness?: number;
    };
    return {
      class: m.constructor.name,
      color: basic.color?.getHex(),
      opacity: basic.opacity,
      transparent: basic.transparent,
      depthWrite: basic.depthWrite,
      vertexColors: basic.vertexColors,
      wireframe: basic.wireframe,
      roughness: basic.roughness,
      metalness: basic.metalness,
    };
  }

  function shapesOf(map: AssetMap): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const id of Object.keys(map)) {
      const m = map[id].material;
      out[id] = shapeOf(Array.isArray(m) ? m[0] : m);
    }
    return out;
  }

  /**
   * A look worth retinting INTO: every scalar moved off the default and
   * every alpha put on the far side of 1, which is the boundary both
   * shipped bugs lived at.
   */
  function target(surface: Surface): Look {
    const look = cloneLook(MONUMENT);
    look.surface = surface;
    look.mapSurface = surface;
    look.opacity = 0.37;
    look.edgeOpacity = 0.61;
    look.mapOpacity = 0.44;
    look.roughness = 0.42;
    look.metalness = 0.13;
    look.coverMix = 0.7;
    look.referenceMix = 0.3;
    look.roles.leg = 0x112233;
    look.mapTint = 0x445566;
    look.mapMix = 0.6;
    return look;
  }

  for (const surface of SURFACES) {
    for (const population of ["generated", "reference"] as const) {
      it(`fill materials: ${surface}, ${population}`, () => {
        const to = target(surface);
        // Built under a DIFFERENT look, then retinted into the target.
        const from = cloneLook(BLUEPRINT);
        from.surface = surface;
        from.mapSurface = surface;
        const retinted = makeAssetMap(from, population);
        retintAssetMap(retinted, to, population);
        const built = makeAssetMap(to, population);
        expect(shapesOf(retinted)).toEqual(shapesOf(built));
        disposeAssetMap(retinted);
        disposeAssetMap(built);
      });

      it(`map materials: ${surface}, ${population}`, () => {
        const to = target(surface);
        const from = cloneLook(BLUEPRINT);
        from.surface = surface;
        from.mapSurface = surface;
        const ids = boxAssetIds();
        const retinted = makeMapMaterials(from, population, ids);
        retintMapMaterials(retinted, to, population);
        const built = makeMapMaterials(to, population, ids);
        for (const id of ids) {
          expect(shapeOf(retinted[id]), id).toEqual(shapeOf(built[id]));
        }
        for (const id of ids) {
          retinted[id].dispose();
          built[id].dispose();
        }
      });
    }

    it(`edge materials stay a wireframe whatever the fill is: ${surface}`, () => {
      const to = target(surface);
      const from = cloneLook(BLUEPRINT);
      from.surface = surface;
      const fill = makeAssetMap(from, "generated");
      const retinted = makeEdgeAssetMap(from, "generated");
      retintEdgeAssetMap(retinted, to, "generated");
      const built = makeEdgeAssetMap(to, "generated");
      expect(shapesOf(retinted)).toEqual(shapesOf(built));
      // The overlay IS the wireframe; `Look.surface` decides only what is
      // under it. A `solid` edge material would be an opaque box drawn
      // over the box it is meant to outline.
      for (const id of Object.keys(built)) {
        expect(shapesOf(built)[id].wireframe, id).toBe(true);
      }
      disposeAssetMap(fill);
      disposeAssetMap(retinted);
      disposeAssetMap(built);
    });
  }

  it("pins a solid fill opaque, whatever the opacity slider says", () => {
    const look = cloneLook(MONUMENT);
    look.surface = "solid";
    look.opacity = 0.2;
    const map = makeAssetMap(look, "generated");
    for (const id of Object.keys(map)) {
      const s = shapeOf(map[id].material as Material);
      expect(s.opacity, id).toBe(1);
      expect(s.transparent, id).toBe(false);
      expect(s.depthWrite, id).toBe(true);
    }
    disposeAssetMap(map);
  });

  it("turns depth writing off for translucent at ANY alpha", () => {
    // The whole reason `translucent` is its own mode: an alpha below 1
    // with depth writing left on is not a see-through lap, it is a faint
    // lap that still hides its own far side.
    for (const opacity of [0.1, 0.5, 1]) {
      const look = cloneLook(MONUMENT);
      look.surface = "translucent";
      look.opacity = opacity;
      const map = makeAssetMap(look, "generated");
      for (const id of Object.keys(map)) {
        expect(shapeOf(map[id].material as Material).depthWrite, `${id} @ ${opacity}`).toBe(false);
      }
      disposeAssetMap(map);
    }
  });
});
