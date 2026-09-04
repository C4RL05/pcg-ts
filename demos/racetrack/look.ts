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
  /** A colour the map's roles fold toward, so the plan reads as one layer. */
  mapTint: number;
  /** How far the map folds into {@link Look.mapTint}, 0..1. */
  mapMix: number;
}

/**
 * THE LAP AS A DIAGRAM. The default, and what the page ships as.
 *
 * WARM GROUND, COOL SKY, SATURATED PARTS. The background sits between the
 * two so nothing on the lap is the same value as the air behind it, which
 * is the one constraint a flat-colour picture has that a wireframe did
 * not: a wireframe over black separates by luminance for free, and a fill
 * has to be given a value that separates.
 *
 * THE ROLE COLOURS ARE ASSIGNED BY HOW MUCH OF THE FRAME EACH ROLE FILLS,
 * WHICH IS NOT HOW MANY BOXES IT HAS. The shipped vocabulary's 2200
 * library boxes are 638 legs, 619 masses, 530 panels, 171 heads, 160
 * posts and 82 spans — so `leg` is the commonest and `panel` only third.
 * Coloured to that count, the lap came out an almost solid wall of one
 * hue, because a leg is a stick and a panel is a SHEET: panels and masses
 * are what a viewer at eye level is actually looking at, and the six
 * counts say nothing about it.
 *
 * SO THE BULK IS RECESSIVE AND THE RARE THINGS CARRY THE COLOUR. Panel
 * and mass are two low-saturation neutrals a shade apart — enough to tell
 * a sheet from a volume, not enough to shout — and post, span and head
 * get coral, teal and rose, which is affordable precisely because there
 * are 413 of them against 1149. Leg keeps indigo: it is numerous but
 * almost always thin, so a saturated colour on it reads as detail rather
 * than as a field.
 *
 * Nothing about a leg is indigo. The point is that a leg is the SAME
 * indigo everywhere, so a person can ask "where does this structure carry
 * load" and get an answer from the picture rather than from a readout.
 */
export const MONUMENT: Look = {
  surface: "solid",
  opacity: 0.82,
  // OFF, AND NOT BECAUSE IT LOOKS BAD IN PRINCIPLE. The overlay is a
  // `wireframe` material, and a wireframe of a box is its TRIANGULATION —
  // twelve edges plus a diagonal across each of the six faces. On a lap of
  // sheets that reads as a hatch rather than as an outline, which is worse
  // than no outline at all. It stays a knob because the hatch is exactly
  // what someone asking "how is this tessellated" wants; a true
  // silhouette would need instanced line segments, which three has no
  // built-in for.
  edges: false,
  edgeOpacity: 0.3,
  edgeTint: 0.15,

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

  road: 0x6e6480,
  roadOpacity: 1,
  centreline: 0xffe6a8,
  car: 0xfff4e2,

  sky: 0xd8c8e4,
  ground: 0xe8c8a6,
  hemi: 1.35,

  key: 0xfff0d8,
  keyIntensity: 0.7,
  keyAzimuth: 135,
  keyElevation: 42,

  fill: 0x9fb8e0,
  fillIntensity: 0.35,

  roughness: 1,
  metalness: 0,
  exposure: 1.05,

  background: 0xcbb8d4,
  horizon: 0xf3dcc4,
  fogNear: 70,
  fogFar: 620,
  fog: 0xe3d0d2,

  // WIREFRAME, WHICH IS THE SETTING THE OLD PAGE ALREADY HAD AND THE ONE
  // THIS FILE NEARLY THREW AWAY. Drawn solid, the overhead pass is an
  // opaque plate of boxes laid over the chase view — it does not overlay
  // the picture, it replaces the middle of it. The map is a PLAN, and a
  // plan is a line drawing; `makeMapMaterials` has made the neighbouring
  // argument about transparency since before this file existed.
  mapSurface: "wireframe",
  mapOpacity: 0.85,
  mapTint: 0x2a2438,
  // FOLDED NEARLY ALL THE WAY, WHICH IS A CONSEQUENCE OF THE SKY. The
  // old page drew this pass in white over black, so it separated by
  // luminance for free. Over a pale sky the same lines have to go DARK
  // to do the same job, and a half fold leaves them mid-grey — the one
  // value that reads against neither the sand nor the lilac, so the plan
  // dissolves into the picture it is supposed to be drawn on. `XRAY`
  // folds the other way toward a light tint, for the same reason
  // inverted.
  mapMix: 0.85,
};

/**
 * THE LAP AS AN X-RAY. Depth off, alpha low, edges up.
 *
 * WHAT IT IS FOR is the question the solid look cannot answer: whether a
 * rule placed something INSIDE something else. A solid lap hides its own
 * interior by construction, and the density rules are all about what
 * happens where two placements meet.
 */
export const XRAY: Look = {
  ...MONUMENT,
  surface: "translucent",
  opacity: 0.28,
  edges: true,
  edgeOpacity: 0.45,
  edgeTint: 0.35,
  hemi: 1.35,
  keyIntensity: 0.5,
  background: 0x1b1a2a,
  horizon: 0x2b2740,
  fog: 0x232036,
  fogNear: 90,
  fogFar: 760,
  road: 0x3b3552,
  centreline: 0x7cf0a8,
  mapMix: 0.35,
  mapTint: 0xd8d0e4,
};

/**
 * THE PAGE AS IT WAS. The wireframe.
 *
 * NOT A NOSTALGIA SETTING. `main.ts`'s header is still right that a
 * wireframe states the composition and claims nothing else, and there are
 * questions — is that one object or two, is that box inside that box —
 * where it is simply the better picture.
 *
 * THE COLOURS ARE EXACT AND ONE ALPHA IS NOT, which is worth stating
 * rather than rounding off. The old palette was `generated` `0x404040` at
 * 0.95 and `reference` `0x999999` at 0.85 over a black clear colour. Every
 * colour below reproduces: six roles at `0x404040` with `coverMix` at 0
 * gives the generated layer one flat `0x404040`, and `referenceMix` at 1
 * folds the reference to exactly `0x999999`. The alpha does not, because
 * `Look` has ONE `opacity` and the two populations had two — so the
 * reference draws at 0.95 here rather than 0.85.
 *
 * AND IT STAYS THAT WAY UNTIL SOMETHING NEEDS THE DIFFERENCE. The
 * symmetric fix is a per-population alpha fold beside `referenceMix`,
 * which is a knob, a panel row and a branch in every material factory to
 * reproduce one tenth of an alpha on one preset. What that 0.85 was FOR
 * is telling the two populations apart at a glance, and `referenceMix`
 * does that job better and is already here. Recorded so the claim is not
 * quietly wrong; not fixed, because the fix costs more than the fact.
 */
export const BLUEPRINT: Look = {
  ...MONUMENT,
  surface: "wireframe",
  opacity: 0.95,
  edges: false,
  edgeOpacity: 0,
  edgeTint: 0,

  roles: {
    panel: 0x404040,
    leg: 0x404040,
    post: 0x404040,
    span: 0x404040,
    head: 0x404040,
    mass: 0x404040,
  },
  cover: 0x404040,
  coverMix: 0,
  reference: 0x999999,
  referenceMix: 1,

  road: 0x333333,
  roadOpacity: 1,
  centreline: 0x00ff00,
  car: 0xffffff,

  hemi: 0,
  keyIntensity: 0,
  fillIntensity: 0,
  exposure: 1,

  background: 0x000000,
  horizon: 0x000000,
  fog: 0x000000,
  fogNear: 60,
  fogFar: 420,

  mapSurface: "wireframe",
  mapOpacity: 1,
  mapTint: 0x000000,
  mapMix: 0,
};

/**
 * THE LAP AS A PLAN. Flat fills, no light at all, hard edges.
 *
 * THE LIMIT CASE OF THE ARGUMENT this file opens with: if the picture is a
 * diagram, then shading is decoration and can go. What is left separates
 * purely by hue and by outline, which is what a printed plan does. It is
 * genuinely harder to read in three dimensions and genuinely easier to
 * read as a legend, and having both makes the trade visible instead of
 * arguable.
 */
export const PLAN: Look = {
  ...MONUMENT,
  surface: "flat",
  opacity: 1,
  edges: false,
  edgeOpacity: 0.55,
  edgeTint: 0,
  hemi: 0,
  keyIntensity: 0,
  fillIntensity: 0,
  exposure: 1,
  background: 0xf4efe6,
  horizon: 0xf4efe6,
  fog: 0xf4efe6,
  fogNear: 200,
  fogFar: 1400,
  road: 0xded5c8,
  centreline: 0xc4553f,
  car: 0x2a2438,
  reference: 0xb4aca4,
  referenceMix: 0.9,
  // `flat`, NOT `solid`, AND THE TWO PASSES DO NOT SHARE THE ANSWER.
  // `mapSurface` picks its own material class, so a `solid` map under a
  // look with the lights at zero is a lit material with nothing to
  // return — a black plate over the middle of the frame — even though
  // the chase pass beside it is unlit and fine. This preset shipped that
  // way for one revision. Any look that turns the lights off has to say
  // so in BOTH surfaces.
  mapSurface: "flat",
  mapOpacity: 1,
  mapMix: 0.7,
  mapTint: 0x2a2438,
};

/**
 * THE LAP AS ACCUMULATED DEPTH. The default, and what the page ships as.
 *
 * IT IS `BLUEPRINT`'s PALETTE WITH THE SURFACE FILLED IN, to the number:
 * the same 0x404040 on every role, the same 0x999999 reference, the same
 * 0x333333 road and green centreline over the same black. The one change
 * is `surface` — `wireframe` becomes `flat` at half alpha — and it turns
 * out to be the whole picture.
 *
 * WHAT THAT ONE CHANGE BUYS, and it is the reason this is the default
 * rather than a fifth preset. `flat` below alpha 1 turns depth writing
 * off, so overlapping boxes ACCUMULATE: brightness stops meaning "which
 * way is this face pointing" and starts meaning "how much structure is
 * stacked along this ray". The wireframe stated the composition and left
 * density to be counted; this states density directly, as a value, while
 * still hiding nothing behind anything.
 *
 * WHICH IS ALSO WHY IT IS MONOCHROME AND THAT IS NOT A REGRESSION. Role
 * colour and accumulated alpha are the same channel — six hues summing
 * through each other make a muddy fourth colour that means neither of
 * the two things it came from. So this look spends the channel on
 * density and {@link MONUMENT} spends it on role, and they are a
 * dropdown apart. Neither is the honest one; they answer different
 * questions.
 *
 * FOUND IN THE PLAYGROUND RATHER THAN DESIGNED, which is the entire
 * point of there being one. Every value below arrived as a paste from
 * its `copy JSON` button.
 */
export const SMOKE: Look = {
  ...BLUEPRINT,
  surface: "flat",
  opacity: 0.5,
  edges: false,
  edgeOpacity: 0,
  edgeTint: 0,
  mapSurface: "wireframe",
  mapOpacity: 1,
  mapTint: 0x000000,
  mapMix: 0,
};

/** The looks the playground offers, in the order it offers them. */
export const PRESETS: readonly { readonly id: string; readonly label: string; readonly look: Look }[] =
  [
    // THE DEFAULT FIRST, which is a claim the page has to keep: `main.ts`
    // opens on `PRESETS[0]` rather than naming a look of its own, so
    // there is no second place for "what does this ship as" to be
    // answered differently.
    { id: "smoke", label: "smoke", look: SMOKE },
    { id: "monument", label: "monument — by role", look: MONUMENT },
    { id: "xray", label: "x-ray", look: XRAY },
    { id: "plan", label: "plan", look: PLAN },
    { id: "blueprint", label: "blueprint (was)", look: BLUEPRINT },
  ];

/** The look the page opens on, and the id the panel reports for it. */
export const DEFAULT_PRESET = PRESETS[0];

/** A look's own copy, so the playground can edit it without editing a preset. */
export function cloneLook(look: Look): Look {
  return { ...look, roles: { ...look.roles } };
}

/** Overwrite `into` in place, so every holder of the live look sees it. */
export function assignLook(into: Look, from: Look): void {
  Object.assign(into, from);
  into.roles = { ...from.roles };
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

/** The same colour, folded toward the map's tint. */
export function mapColor(look: Look, id: string, population: Population): number {
  return mixHex(assetColor(look, id, population), look.mapTint, look.mapMix);
}
