/**
 * WHAT THE LAP IS DRAWN AS, as one value a person can edit.
 *
 * THE PAGE USED TO HAVE NO SUCH THING, and the header of `main.ts` argued
 * why: everything was wireframe, because the output of this technique is a
 * COMPOSITION — what is where, at what size, facing which way — and a
 * wireframe reads as the composition it is where a shaded prop would read
 * as bad art. That argument is still right about SHADED PROPS. It is not
 * right about every alternative to a wireframe, and the wireframe pays a
 * price the argument never priced: at 2200 boxes the edges of things
 * behind you are indistinguishable from the edges of things in front, so
 * the picture stops separating into objects at exactly the density the
 * rules are interesting at.
 *
 * SO THE THIRD OPTION, and it is the one this file is for: flat colour
 * with soft ambient shading, coded BY STRUCTURAL ROLE. It is not art and
 * does not pretend to be — a leg is indigo everywhere on the lap, not
 * because legs are indigo but because that is what makes a leg findable —
 * which is the same honesty the wireframe had, with silhouettes back. A
 * diagram, in other words, rather than a rendering.
 *
 * THE WIREFRAME IS STILL HERE, as {@link BLUEPRINT}, and it is exact
 * rather than approximate: the same colours and opacities the palette
 * carried before this file existed. Nothing about the old picture was
 * lost, it just stopped being the only one.
 *
 * EVERY NUMBER HERE IS LIVE. Nothing in a look feeds the cook — it is
 * material and light parameters only — so the playground rebinds them
 * without recooking, and the lap under two looks is the same lap. That is
 * a property worth keeping: the moment a colour could change a placement,
 * "which look was that shot in" becomes a question about the CONTENT.
 */
import { BOX_ROLES } from "./spawn.js";

/** The six structural roles a box can carry. */
export type BoxRole = (typeof BOX_ROLES)[number];

/**
 * How a surface is drawn.
 *
 * `solid` and `translucent` differ ONLY in whether the fill writes depth,
 * which is the whole reason they are separate names rather than an opacity
 * of 1 and an opacity below it. A translucent lap is not a faint lap: it
 * is a lap you can see the far side of, and that needs depth writing OFF
 * or the nearest box still occludes everything behind it at any alpha.
 *
 * `flat` IS THE ONE THAT HAD TO BE A MODE RATHER THAN A SETTING, and it
 * was found by shipping the alternative. A "plan" look is a solid fill
 * with the lights turned off — so the first version of it was exactly
 * that, three intensity sliders at zero, and it rendered the whole lap
 * BLACK: an unlit surface material has no light to return and is not a
 * flat colour, it is nothing. Making unlit-ness emergent from three
 * numbers also puts a MATERIAL CLASS behind a slider, and a class change
 * is a rebuild — so a drag through zero would have recooked the lap once
 * per frame.
 *
 * As a mode it is neither: it names an unlit fill outright, the class
 * follows the mode the way it does for `wireframe`, and the colours come
 * out as the exact bytes that were authored rather than as whatever a
 * tone curve made of them. Which is what a plan wants anyway.
 */
export type Surface = "solid" | "translucent" | "flat" | "wireframe";

/**
 * Does this look light anything?
 *
 * ASKED IN TWO PLACES AND ANSWERED HERE. `main.ts` switches tone mapping
 * off when nothing is lit — a filmic curve over colours a look states as
 * literals is a quiet desaturation of all of them — and `assets3d.ts`
 * picks the material class from the SURFACE. The two must not drift into
 * disagreeing about what "unlit" means, and the honest reading is the
 * surface's: `flat` and `wireframe` are unlit whatever the lights say.
 */
export function isLit(look: Look): boolean {
  return look.surface === "solid" || look.surface === "translucent";
}

/** Everything about how the lap is drawn, and nothing about what is on it. */
export interface Look {
  // ---------------------------------------------------------------- //
  // Surfaces
  // ---------------------------------------------------------------- //
  /** How the chase view draws a box. */
  surface: Surface;
  /** Fill alpha. Ignored by `solid`, which is opaque by definition. */
  opacity: number;
  /**
   * Draw the wireframe over the fill as well.
   *
   * THE EDGE IS WHAT MAKES A FLAT FILL READ AS A BOX rather than as a
   * silhouette, at the one place shading cannot help: two boxes of the
   * same role, touching, lit the same. It costs a second instanced draw
   * per asset id and nothing else — same geometry, same transforms.
   */
  edges: boolean;
  /** The edge overlay's alpha. */
  edgeOpacity: number;
  /**
   * How far the edge overlay is pushed toward black (0) or its own fill
   * colour (1). Below about 0.4 the edges read as a drawn line; above it
   * they read as a highlight.
   */
  edgeTint: number;

  // ---------------------------------------------------------------- //
  // The palette — the information-graphics half
  // ---------------------------------------------------------------- //
  /** One colour per structural role, and the reason this is a diagram. */
  roles: Record<BoxRole, number>;
  /**
   * The accent a `cover:` id mixes toward.
   *
   * COVER IS A LAYER, NOT A ROLE. `spawn.ts` keeps `cover:span` and
   * `span` as separate ids precisely because structure OVER the racing
   * line and something standing BESIDE it are not the same thing to look
   * at. Mixing rather than replacing keeps both facts legible: a covered
   * span is still recognisably a span, and is still obviously cover.
   */
  cover: number;
  /** How far toward {@link Look.cover} a `cover:` id is mixed, 0..1. */
  coverMix: number;
  /**
   * The reference layer's colour, and how far its roles fold into it.
   *
   * AT 1 THE REFERENCE IS ONE FLAT COLOUR, which is what the old palette
   * did and what the comparison actually wants: the question the page
   * asks is whether the GENERATED layer reads, and a reference in the
   * same six colours competes for the same glance. At 0 both layers are
   * coded identically, which is the right setting for asking whether the
   * two agree role by role.
   */
  reference: number;
  /** How far the reference layer folds into {@link Look.reference}, 0..1. */
  referenceMix: number;

  /** The road surface. */
  road: number;
  /** Alpha of the road surface. */
  roadOpacity: number;
  /** The centreline. */
  centreline: number;
  /** The car. */
  car: number;

  // ---------------------------------------------------------------- //
  // Light
  // ---------------------------------------------------------------- //
  /**
   * The hemisphere light's two ends and its strength.
   *
   * A HEMISPHERE IS THE WHOLE LIGHTING MODEL HERE, near enough, and that
   * is deliberate. It shades a box by which way its faces point and by
   * nothing else — no position, no falloff, no shadow — so an identical
   * box reads identically anywhere on the lap. That is the property a
   * diagram needs and the property a lighting rig destroys first.
   */
  sky: number;
  /** The hemisphere's lower half: the bounce a ground plane would give. */
  ground: number;
  /** Hemisphere strength. */
  hemi: number;

  /** A single soft key, for the little bit of direction a hemisphere lacks. */
  key: number;
  /** Key strength. Above about 1.5 the flat-colour reading starts to go. */
  keyIntensity: number;
  /** Key direction around the lap, in degrees. */
  keyAzimuth: number;
  /** Key height, in degrees above the horizon. */
  keyElevation: number;

  /** A cool counter-light opposite the key, so the dark side is not black. */
  fill: number;
  /** Counter-light strength. */
  fillIntensity: number;

  /** Surface roughness. 1 is matte, which is what a diagram wants. */
  roughness: number;
  /** Surface metalness. Non-zero needs an environment to reflect. */
  metalness: number;
  /** Tone-mapping exposure. */
  exposure: number;

  // ---------------------------------------------------------------- //
  // Air
  // ---------------------------------------------------------------- //
  /** The sky behind everything, at the top of the frame. */
  background: number;
  /**
   * The sky at the horizon.
   *
   * EQUAL TO {@link Look.background} MEANS FLAT, which is a setting and
   * not a degenerate case: a flat ground is the more diagrammatic of the
   * two and the gradient is the more atmospheric.
   */
  horizon: number;
  /** Where fog starts, in world units from the camera. */
  fogNear: number;
  /** Where fog reaches the horizon colour. */
  fogFar: number;
  /**
   * What the fog fades to.
   *
   * SEPARATE FROM THE BACKGROUND ON PURPOSE. Matching them makes distance
   * dissolve, which is the Monument Valley reading; a fog lighter than the
   * sky makes distance PALE without dissolving, which keeps the far side
   * of the circuit legible as a shape. Both are wanted and neither is
   * derivable from the other.
   */
  fog: number;

  // ---------------------------------------------------------------- //
  // The map pass
  // ---------------------------------------------------------------- //
  /**
   * How the overhead pass draws a box.
   *
   * ITS OWN SETTING, BECAUSE THE TWO VIEWS ASK DIFFERENT QUESTIONS. From
   * above, a lap of overlapping translucent boxes reads as a smear of
   * density rather than as a layout, and the layout is the only thing the
   * map view is for — which is the note the old `makeMapMaterials` carried
   * about dropping transparency, restated as a knob rather than a rule.
   */
  mapSurface: Surface;
  /** The map pass's alpha. */
  mapOpacity: number;
  /**
   * The generated dressing's colour in the overhead pass.
   *
   * FLAT, AND NOT A FOLD OF THE ROLE COLOURS. The map pass used to mix
   * each id's chase colour toward a tint by a ratio, which is machinery
   * for a question the map does not ask: from above, the layout is the
   * only thing this view is for, and what it has to separate is the two
   * POPULATIONS rather than the six roles. Two flat colours say that;
   * a fold could only say it by accident, and could not say it at all
   * once the chase palette went monochrome — both populations fold to
   * the same place from the same grey.
   *
   * IT IS ALSO WHY THE MAP DROPS VERTEX COLOURS. A merged pose carries a
   * per-box colour attribute, and a material that multiplied by it could
   * not reach a stated colour — red times 0x404040 is a dark red. The map
   * materials switch the attribute off and mean exactly what they say;
   * see `passTint` in `assets3d.ts`.
   */
  mapGenerated: number;
  /** The reference layer's colour in the overhead pass. */
  mapReference: number;
}

/**
 * THE LOOK THE PAGE DRAWS. There is exactly one, and it was found rather
 * than designed.
 *
 * THE FILL IS FLAT, UNLIT, AND HALF-TRANSPARENT WITH DEPTH WRITING OFF,
 * which is the whole picture in one sentence. Overlapping boxes ADD
 * instead of occluding, so brightness stops meaning "which way is this
 * face pointing" and starts meaning "how much structure is stacked along
 * this ray". The lap hides nothing behind anything and still reads as a
 * lap.
 *
 * IT IS MONOCHROME ON PURPOSE, and that is the one thing about it worth
 * defending. Accumulated alpha and hue are the same channel: six role
 * colours summing through each other at half alpha make a muddy seventh
 * that means neither of the two facts it came from. So the channel is
 * spent on density, and role is simply not shown. Every `roles` entry
 * below is the same grey for that reason, not because the palette was
 * never filled in.
 *
 * FOUR OTHER LOOKS USED TO SIT BESIDE THIS ONE — a by-role colouring
 * under a hemisphere, an x-ray, a flat plan, and the wireframe this page
 * drew for its whole life before any of this. They are in the git history
 * (`6edc1d7`) together with the panel that was built to choose between
 * them; what survived the choosing is this. The renderer still supports
 * every mode they used, so `window.pcgRacetrack.setLook` can still reach
 * them — {@link Surface} is four modes wide for that reason and not by
 * accident.
 *
 * THE VALUES ARE A RESOLVED SPREAD, not a fresh set. This was
 * `{...BLUEPRINT, surface: "flat", opacity: 0.5}` and `BLUEPRINT` was
 * `{...MONUMENT, ...}`; with the other two gone the chain is written out
 * so that reading one object tells you the whole look. The greys, the
 * green centreline and the black are the wireframe page's own, to the
 * number.
 */
export const LOOK: Look = {
  surface: "flat",
  opacity: 0.5,
  edges: false,
  edgeOpacity: 0,
  edgeTint: 0,

  // ONE GREY FOR EVERY ROLE, which is a decision and not a placeholder —
  // see the header. `assetColor` still folds cover and population on top
  // of these, and both folds are no-ops here: `coverMix` at 0 and
  // `referenceMix` at 1. That is what makes the whole lap exactly two
  // colours rather than nearly two.
  roles: {
    panel: 0x404040,
    mass: 0x404040,
    leg: 0x404040,
    post: 0x404040,
    span: 0x404040,
    head: 0x404040,
  },
  cover: 0x404040,
  coverMix: 0,
  reference: 0x999999,
  referenceMix: 1,

  road: 0x333333,
  // HALF-TRANSPARENT, WHICH ON THIS BACKGROUND MEANS HALF AS DARK-GREY
  // AGAINST BLACK. The road is the one large continuous surface in
  // frame; at full alpha it is a flat plate that the accumulating
  // dressing sits ON, and at half it recedes into the black and reads as
  // a surface the lap is drawn OVER. It is also the only page-owned
  // drawable with an alpha of its own — the fill's `opacity` does not
  // reach it, because a see-through floor would show the far side of the
  // circuit through the near side of the tarmac.
  roadOpacity: 0.5,
  centreline: 0x00ff00,
  car: 0xffffff,

  // THE LIGHT IS ALL AT ZERO AND ITS COLOURS ARE STILL HERE. `flat` is an
  // unlit mode, so none of these reaches the screen as the page ships.
  // They are the rig's parameters, kept because the rig is real and
  // `setLook` can turn it on; deleting them would mean deleting the
  // hemisphere, the key, the fill and the lit material arms along with
  // them, which is a different and much larger change than "the shipped
  // look does not use them".
  sky: 0xd8c8e4,
  ground: 0xe8c8a6,
  hemi: 0,

  key: 0xfff0d8,
  keyIntensity: 0,
  keyAzimuth: 135,
  keyElevation: 42,

  fill: 0x9fb8e0,
  fillIntensity: 0,

  roughness: 1,
  metalness: 0,
  exposure: 1,

  background: 0x000000,
  horizon: 0x000000,
  fogNear: 60,
  fogFar: 420,
  fog: 0x000000,

  // THE OVERHEAD PASS IS THE ONE PLACE THIS LOOK IS NOT MONOCHROME, and
  // it can afford to be because it has no accumulation to protect. The
  // chase view spends its single channel on density and therefore cannot
  // also say which population a box belongs to; the map is a line drawing
  // of a layout, so it answers that question instead — which is most of
  // what an overhead view of two populations is for. Red is the generated
  // dressing, grey is the reference catalogue drawn beside it.
  //
  // OPAQUE, AND A `wireframe` KEEPS WRITING DEPTH. A plan drawn in
  // accumulating half-alpha would be exactly the smear this pass exists
  // to avoid.
  mapSurface: "wireframe",
  mapOpacity: 1,
  mapGenerated: 0xff0000,
  mapReference: 0x999999,
};

/**
 * A look's own copy, deep enough for `roles`.
 *
 * THE PAGE MUST NOT HOLD {@link LOOK} ITSELF. `setLook` mutates the live
 * look in place — every material and light holds the reference — so an
 * alias would edit the module constant and leave nothing to reset to.
 */
export function cloneLook(look: Look): Look {
  return { ...look, roles: { ...look.roles } };
}

/**
 * The role an asset id draws as, and whether it is cover.
 *
 * ONE READER FOR THREE ID NAMESPACES, because the renderer has three and
 * they all have to answer the same question. `spawn.ts` mints bare role
 * names and `cover:<role>`; `dressGraph.ts` mints `pose:<n>` and
 * `cover:pose:<n>`; `spawn.ts` also mints `kit:<id>`. Only the first
 * carries a role in its name — a pose is a whole placement and a kit id is
 * a catalogue entry — so the other two answer `undefined` and the caller
 * colours them per box instead, from the vertex colours the merge baked.
 *
 * PARSING A NAME RATHER THAN CARRYING A FIELD is the seam that already
 * exists: `mesh.name` is the batch's asset id and is the ONLY per-mesh
 * identity `toInstancedMeshes` sets. Adding a parallel table keyed by the
 * same string would be a second spelling of the same fact.
 */
export function readAssetId(id: string): { role?: BoxRole; cover: boolean } {
  const cover = id.startsWith("cover:");
  const bare = cover ? id.slice("cover:".length) : id;
  return { role: (BOX_ROLES as readonly string[]).includes(bare) ? (bare as BoxRole) : undefined, cover };
}

/** Mix two packed 0xRRGGBB colours, `t` of the way from `a` to `b`. */
export function mixHex(a: number, b: number, t: number): number {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/**
 * Which population a layer belongs to, kept as a name rather than a flag.
 *
 * The two are drawn by the same renderer on purpose — the page's whole
 * question is whether the generated one reads like the reference — so the
 * only thing that may differ between them is how the look folds their
 * colours, which is {@link Look.referenceMix}.
 */
export type Population = "generated" | "reference";

/**
 * The colour one asset id draws in, under one look, in one population.
 *
 * THE ONE PLACE THE PALETTE IS RESOLVED. Four call sites want this answer
 * — the chase materials, the map materials, the edge overlay and the
 * merged-pose vertex colours — and the failure of writing it out four
 * times is not that one is wrong but that one is STALE: a lap whose map
 * pass codes cover and whose chase pass does not, which reads as a bug in
 * the rules rather than in the renderer.
 *
 * A POSE ID ANSWERS WITH THE MASS COLOUR and is expected to be overridden
 * per box by the vertex colours. It is not a fallback for a missing case:
 * a merged pose has no single role, so the per-mesh answer is only ever
 * used for the map pass's flat fold and for a caller that has turned
 * vertex colours off.
 */
export function assetColor(look: Look, id: string, population: Population): number {
  const { role, cover } = readAssetId(id);
  let c = look.roles[role ?? "mass"];
  if (cover) c = mixHex(c, look.cover, look.coverMix);
  if (population === "reference") c = mixHex(c, look.reference, look.referenceMix);
  return c;
}

/**
 * The colour one population wears in the overhead pass.
 *
 * IT IGNORES THE ASSET ID, which is why it still takes one: every other
 * colour on this page is a function of the id, and a reader comparing
 * this with {@link assetColor} should be able to see that the map
 * deliberately is not. The map separates the two POPULATIONS and nothing
 * finer — {@link Look.mapGenerated} says why the role fold that used to
 * live here could not survive a monochrome chase palette.
 */
export function mapColor(_id: string, look: Look, population: Population): number {
  return population === "generated" ? look.mapGenerated : look.mapReference;
}
