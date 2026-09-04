/**
 * The look the racetrack draws, and the arithmetic behind its colours.
 *
 * WHY A SUITE FOR WHAT LOOKS LIKE PRESENTATION. A look decides no
 * placement — that is the property `demos/racetrack/look.ts` is built to
 * guarantee — so nothing here can catch a wrong lap. What it catches is
 * the OTHER failure mode, which is worse to debug precisely because the
 * lap is fine: a colour that arrives wrong lands in a material, comes out
 * as a plausible picture, and nothing says so.
 *
 * IT USED TO COVER FIVE LOOKS AND A CONTROL PANEL. Both are in the git
 * history (`6edc1d7`, `27e00db`); what is left is the one look the page
 * ships plus the folds it is built out of.
 *
 * THE FOLDS ARE TESTED THROUGH A FIXTURE, NOT THROUGH `LOOK`. Every fold
 * `assetColor` performs is a no-op in the shipped look — one grey on
 * every role, `coverMix` at 0, `referenceMix` at 1 — so a suite that only
 * ever asked `LOOK` would pass with the arithmetic gutted. {@link BY_ROLE}
 * exists to make the folds observable, and is deliberately not a preset:
 * nothing ships it.
 */
import { describe, expect, it } from "vitest";
import {
  LOOK,
  type Look,
  type Surface,
  assetColor,
  cloneLook,
  isLit,
  mapColor,
  mixHex,
  readAssetId,
} from "../demos/racetrack/look.js";
import { BOX_ROLES, boxAssetIds } from "../demos/racetrack/spawn.js";
import type { AssetMap } from "pcg-ts/three";
import type { Material } from "three";
import {
  disposeAssetMap,
  makeAssetMap,
  makeEdgeAssetMap,
  makeMapMaterials,
  makeStreamedMapMaterial,
  retintAssetMap,
  retintEdgeAssetMap,
  retintMapMaterials,
} from "../demos/racetrack/assets3d.js";

/** A look whose folds are all live, so the arithmetic can be seen. */
const BY_ROLE: Look = {
  ...cloneLook(LOOK),
  surface: "solid",
  opacity: 1,
  roles: {
    panel: 0xdccbb8,
    mass: 0xc0b2c6,
    leg: 0x565080,
    post: 0xe87f63,
    span: 0x3f9d99,
    head: 0xd4658a,
  },
  cover: 0xf0b13d,
  coverMix: 0.5,
  reference: 0x8d8399,
  referenceMix: 0.8,
  hemi: 1.35,
};

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

describe("assetColor's folds", () => {
  it("gives each role its own colour when the roles differ", () => {
    const seen = new Set(BOX_ROLES.map((r) => assetColor(BY_ROLE, r, "generated")));
    expect(seen.size, "two roles share a colour, so the fold lost one").toBe(BOX_ROLES.length);
  });

  it("moves a cover id away from its bare role, and only when coverMix asks", () => {
    for (const role of BOX_ROLES) {
      const bare = assetColor(BY_ROLE, role, "generated");
      const cover = assetColor(BY_ROLE, `cover:${role}`, "generated");
      expect(cover, `cover:${role} is indistinguishable from ${role}`).not.toBe(bare);
    }
    const off: Look = { ...cloneLook(BY_ROLE), coverMix: 0 };
    for (const role of BOX_ROLES) {
      expect(assetColor(off, `cover:${role}`, "generated")).toBe(
        assetColor(off, role, "generated"),
      );
    }
  });

  it("folds the reference layer to exactly one colour at referenceMix 1", () => {
    const one: Look = { ...cloneLook(BY_ROLE), referenceMix: 1 };
    const seen = new Set(boxAssetIds().map((id) => assetColor(one, id, "reference")));
    expect(seen).toEqual(new Set([one.reference]));
  });

  it("codes both populations identically at referenceMix 0", () => {
    const both: Look = { ...cloneLook(BY_ROLE), referenceMix: 0 };
    for (const id of boxAssetIds()) {
      expect(assetColor(both, id, "reference")).toBe(assetColor(both, id, "generated"));
    }
  });

  it("falls back to mass for an id it cannot read a role from", () => {
    expect(assetColor(BY_ROLE, "pose:3", "generated")).toBe(BY_ROLE.roles.mass);
  });
});

describe("the shipped look", () => {
  it("is monochrome, which is the point of it rather than an oversight", () => {
    // Accumulated alpha and hue are the same channel: six role colours
    // summing through each other at half alpha make a muddy seventh that
    // means neither fact it came from. A later "fix" giving the lap role
    // colours back would quietly undo the whole reading.
    const seen = new Set(boxAssetIds().map((id) => assetColor(LOOK, id, "generated")));
    expect(seen.size, "the shipped look has picked up a second colour").toBe(1);
    expect([...seen][0]).toBe(0x404040);
  });

  it("keeps the reference layer one flat colour of its own", () => {
    const seen = new Set(boxAssetIds().map((id) => assetColor(LOOK, id, "reference")));
    expect(seen).toEqual(new Set([0x999999]));
  });

  it("is unlit, and says so through its surface rather than its intensities", () => {
    expect(isLit(LOOK)).toBe(false);
    expect(LOOK.surface).toBe("flat");
  });

  it("accumulates rather than occludes", () => {
    // THE ONE PROPERTY THE LOOK IS CHOSEN FOR. `flat` below alpha 1 turns
    // depth writing off, which is what makes overlap read as brightness;
    // at alpha 1 it would write depth and the whole reading would be gone
    // with no other value changing.
    expect(LOOK.opacity).toBeLessThan(1);
    const map = makeAssetMap(LOOK, "generated");
    for (const id of Object.keys(map)) {
      const m = map[id].material as Material;
      expect((m as unknown as { depthWrite: boolean }).depthWrite, id).toBe(false);
      expect((m as unknown as { transparent: boolean }).transparent, id).toBe(true);
    }
    disposeAssetMap(map);
  });
});

describe("the overhead pass", () => {
  it("separates the two populations rather than the six roles", () => {
    for (const id of boxAssetIds()) {
      expect(mapColor(id, LOOK, "generated"), id).toBe(0xff0000);
      expect(mapColor(id, LOOK, "reference"), id).toBe(0x999999);
    }
    // A merged pose has no role and must answer the same as anything else.
    expect(mapColor("pose:7", LOOK, "generated")).toBe(0xff0000);
    expect(mapColor("cover:pose:7", LOOK, "generated")).toBe(0xff0000);
  });

  it("draws the generated dressing solid red, with no blending at all", () => {
    const ids = boxAssetIds();
    const materials = makeMapMaterials(LOOK, "generated", ids);
    for (const id of ids) {
      const m = materials[id] as unknown as {
        color: { getHex(): number };
        opacity: number;
        transparent: boolean;
        wireframe: boolean;
        vertexColors: boolean;
      };
      expect(m.color.getHex(), id).toBe(0xff0000);
      expect(m.opacity, id).toBe(1);
      expect(m.transparent, `${id} is blended, so the plan smears`).toBe(false);
      expect(m.wireframe, id).toBe(true);
      // VERTEX COLOURS OFF OR THE RED IS NOT RED. A merged pose carries a
      // per-box colour attribute and the material could only MULTIPLY by
      // it, landing on red times 0x404040 — a dark red that no value in
      // the look could correct.
      expect(m.vertexColors, `${id} would multiply the stated colour away`).toBe(false);
    }
    for (const id of ids) materials[id].dispose();
  });

  it("draws the STREAMED dressing solid red, which is the one that matters", () => {
    // THE GENERATED DRESSING IS THE STREAMED POSES, not the box path
    // above. Every pose mesh borrows this single material for the length
    // of the map render, and a merged pose is the ONLY geometry on the
    // page carrying a per-box colour attribute — so this is the one
    // material where leaving vertex colours on would silently multiply
    // the stated red down to red times 0x404040. A test that only
    // covered the box ids could not see that, because no box id is a
    // pose id and the attribute is off there anyway.
    const m = makeStreamedMapMaterial(LOOK, "generated") as unknown as Material & {
      color: { getHex(): number };
      opacity: number;
      transparent: boolean;
      wireframe: boolean;
      vertexColors: boolean;
    };
    expect(m.color.getHex()).toBe(0xff0000);
    expect(m.opacity).toBe(1);
    expect(m.transparent).toBe(false);
    expect(m.wireframe).toBe(true);
    expect(m.vertexColors, "the pose attribute would multiply the red away").toBe(false);
    m.dispose();
  });

  it("leaves the reference layer grey, so the two are told apart", () => {
    const ids = boxAssetIds();
    const materials = makeMapMaterials(LOOK, "reference", ids);
    for (const id of ids) {
      expect((materials[id] as unknown as { color: { getHex(): number } }).color.getHex(), id).toBe(
        0x999999,
      );
    }
    for (const id of ids) materials[id].dispose();
  });
});

describe("cloneLook", () => {
  it("is deep enough that editing a copy cannot edit the module constant", () => {
    // The page mutates the live look in place, and the live look starts
    // as a clone of `LOOK`. A shallow copy would share `roles`.
    const live = cloneLook(LOOK);
    live.roles.leg = 0x010203;
    live.background = 0x040506;
    expect(LOOK.roles.leg).not.toBe(0x010203);
    expect(LOOK.background).not.toBe(0x040506);
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
 * rots, and it rotted three times before this test existed: the retint
 * left `depthWrite` alone, so a `flat` look dragged below alpha 1 blended
 * but still wrote depth; it wrote the opacity onto a `solid` material the
 * constructor pins at 1; and the first `depthWrite` rule written into it
 * was wrong for the wireframe arm.
 *
 * NONE WAS CAUGHT BY A TYPE OR BY A RENDER. What catches them is asking
 * whether a material retinted INTO a look is the material that look would
 * have BUILT.
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
   * A look worth retinting INTO: every scalar moved off the shipped one
   * and every alpha put on the far side of 1, which is the boundary all
   * three shipped divergences lived at.
   */
  function target(surface: Surface): Look {
    const look = cloneLook(BY_ROLE);
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
    look.mapGenerated = 0x445566;
    look.mapReference = 0x778899;
    return look;
  }

  /** Built under a different look, so a retint has real work to do. */
  function origin(surface: Surface): Look {
    const look = cloneLook(LOOK);
    look.surface = surface;
    look.mapSurface = surface;
    return look;
  }

  for (const surface of SURFACES) {
    for (const population of ["generated", "reference"] as const) {
      it(`fill materials: ${surface}, ${population}`, () => {
        const to = target(surface);
        const retinted = makeAssetMap(origin(surface), population);
        retintAssetMap(retinted, to, population);
        const built = makeAssetMap(to, population);
        expect(shapesOf(retinted)).toEqual(shapesOf(built));
        disposeAssetMap(retinted);
        disposeAssetMap(built);
      });

      it(`map materials: ${surface}, ${population}`, () => {
        const to = target(surface);
        const ids = boxAssetIds();
        const retinted = makeMapMaterials(origin(surface), population, ids);
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
      const retinted = makeEdgeAssetMap(origin(surface), "generated");
      retintEdgeAssetMap(retinted, to, "generated");
      const built = makeEdgeAssetMap(to, "generated");
      expect(shapesOf(retinted)).toEqual(shapesOf(built));
      // The overlay IS the wireframe; `Look.surface` decides only what is
      // under it. A `solid` edge material would be an opaque box drawn
      // over the box it is meant to outline.
      for (const id of Object.keys(built)) {
        expect(shapesOf(built)[id].wireframe, id).toBe(true);
      }
      disposeAssetMap(retinted);
      disposeAssetMap(built);
    });
  }

  it("pins a solid fill opaque, whatever the opacity slider says", () => {
    const look = cloneLook(BY_ROLE);
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
      const look = cloneLook(BY_ROLE);
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
