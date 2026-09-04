/**
 * What each asset id draws — the socket the real art plugs into.
 *
 * TODAY EVERY ID IS THE SAME UNIT CUBE, and that is the point rather than
 * a shortcut. The output of this technique is a COMPOSITION — what is
 * where, at what size, facing which way — and a box reads as the
 * composition it is, where a shaded prop would read as bad art (see
 * `main.ts`' header, which has argued this since before the rules
 * landed). So the map exists not to make the picture different but to
 * make the picture ADDRESSABLE: `panel` and `cover:span` are separate
 * entries drawing identical geometry, and giving one of them a real mesh
 * is an edit to this file and to nothing else.
 *
 * ONE GEOMETRY, MANY ENTRIES. The cube is shared by reference across
 * every id and across both populations, so a lap of thousands of boxes
 * uploads one vertex buffer. `toInstancedMeshes` clones each mesh's
 * MATERIAL — which is how three releases that mesh's cached render state
 * on dispose — but never its geometry, so ownership is: dispose the mesh
 * and its material together, dispose the geometry with the map.
 *
 * ONE PALETTE, TWO FOLDS OF IT, AND STILL NOT TWO GEOMETRIES. What tells
 * a box apart from its neighbour is now its structural ROLE — a leg is
 * indigo everywhere on the lap — and what tells the generated dressing
 * apart from the reference layer beside it is `Look.referenceMix`, which
 * folds the reference's six role colours toward one. Both are colour and
 * neither is geometry, and that is the whole discipline: the page's
 * question is whether the generated layer reads like the reference, so
 * the two must be drawn by exactly the same renderer over exactly the
 * same meshes. A different mesh would be a different picture and would
 * make the comparison worthless.
 *
 * NOTHING HERE DECIDES A COLOUR. `look.ts` owns the palette and every
 * fold of it — role, cover, population, map tint — and exposes the answer
 * as {@link assetColor} and {@link mapColor}. This file's job is to turn
 * that answer into materials and, for a merged pose, into vertices. The
 * split matters because the same colour is asked for from four places
 * (chase fill, edge overlay, map pass, baked pose colours) and the
 * failure of resolving it four times is not that one is wrong but that
 * one is STALE — a lap whose map pass codes cover and whose chase pass
 * does not reads as a bug in the rules rather than in the renderer.
 *
 * EVERY COLOUR IS RETINTABLE WITHOUT ALLOCATING. The playground drags a
 * colour picker, and re-merging a whole vocabulary or rebuilding the
 * streamed world per frame is not a thing that can happen — the world
 * rebuild alone recooks the lap. So each `make*` here has a `retint*`
 * beside it that writes into what already exists, and the line between
 * them is exactly the line between a scalar and a CLASS: colours,
 * opacities, roughness and metalness are live; `Look.surface`,
 * `Look.mapSurface` and `Look.edges` pick which material class is built
 * and changing one of those is a rebuild.
 */
import type { AssetMap } from "pcg-ts/three";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from "three";
import { type PoseBoxW, type PoseLibrary, poseAssetId, poseBoxesW } from "./dressGraph.js";
import {
  assetColor,
  type Look,
  mapColor,
  mixHex,
  type Population,
  readAssetId,
  type Surface,
} from "./look.js";
import { BOX_ROLES, boxAssetIds } from "./spawn.js";

/**
 * The unit box every placed box is scaled from.
 *
 * Module-level and shared, exactly as the renderer this replaces kept it:
 * a recook replaces every mesh, and re-uploading a buffer that never
 * changes was measurable enough that the old dispose path special-cased
 * it by name. Here the sharing is structural instead — the asset map owns
 * it, meshes only borrow it — so there is nothing for a dispose loop to
 * get wrong.
 */
const UNIT_BOX = new BoxGeometry(1, 1, 1);

/** The identity of a multiply, and what a vertex-coloured base must be. */
const WHITE = 0xffffff;
/** What {@link Look.edgeTint} pushes an edge toward at 0. */
const BLACK = 0x000000;

// ------------------------------------------------------------------ //
// Surfaces: one factory, three classes, and the retint beside each.
// ------------------------------------------------------------------ //

/**
 * Which of the three passes a material is being built for.
 *
 * A PASS, NOT A STYLE. The three draw the SAME meshes with the same
 * transforms and differ only in what colour and alpha they resolve to —
 * the fill states what a thing is, the edge overlay states where it ends,
 * the map pass states where it is on the circuit. Naming them lets
 * {@link passTint} be the one place any of those three questions is
 * answered, which is what stops the edge overlay from quietly disagreeing
 * with the fill it is drawn over.
 */
export type Pass = "fill" | "edge" | "map";

/** Everything {@link makeSurfaceMaterial} needs that is not on the look. */
interface SurfaceSpec {
  /** Which class to build. NOT retintable — see the header. */
  readonly surface: Surface;
  /** The base colour, already folded by {@link passTint}. */
  readonly color: number;
  /** The alpha the pass wants; ignored by `solid`. */
  readonly opacity: number;
  /** Read a per-vertex `color` attribute and multiply the base by it. */
  readonly vertexColors: boolean;
}

/**
 * One material, in whichever class the look's surface names.
 *
 * THE ONE PLACE A MATERIAL IS CONSTRUCTED, and the reason is the middle
 * case: `translucent` differs from `solid` in TWO settings, not one, and
 * the second is the one that is easy to leave out. Depth writing has to
 * be OFF for a translucent fill or the nearest box still occludes
 * everything behind it at any alpha — the fill goes faint and the lap
 * stays exactly as opaque as it was, which reads as "transparency does
 * not work here" rather than as a missing flag. Written out at four call
 * sites, three of them would be right.
 *
 * `wireframe` IS PRESERVED TO THE BEHAVIOUR, not merely to the name: a
 * transparent `MeshBasicMaterial` at the look's opacity, which is what
 * this file built for every id before a look existed. `BLUEPRINT` carries
 * the numbers it built them with.
 *
 * TYPED AS `Material` AT THE SEAM. The union is real — two classes with
 * different properties — and widening it here is what keeps every caller
 * from having to know which one it got. What a caller does need is
 * covered by {@link tintMaterial}, which narrows back with `instanceof`
 * rather than with a cast.
 */
/**
 * The blend state one surface wears at one alpha — the ONE statement of it.
 *
 * IT IS A FUNCTION BECAUSE IT WAS A DUPLICATE, and the duplicate cost
 * three bugs. `makeSurfaceMaterial` set these flags in a constructor and
 * `tintMaterial` set them again on a live material, and being two
 * statements of one rule they diverged three separate ways: the retint
 * did not write `depthWrite` at all (so a `flat` look dragged below alpha
 * 1 blended but still wrote depth, and could not be got back without a
 * rebuild); it wrote `look.opacity` onto a `solid` material the
 * constructor pins at 1; and when `depthWrite` was finally added to it,
 * it was added with a rule the WIREFRAME arm never had. Each was found
 * separately, by a person or a test, after the code read as finished.
 *
 * So there is now nowhere for them to disagree: both paths call this and
 * neither restates it. What is left in the two of them is only what
 * genuinely differs — a constructor picks a CLASS, and a repaint may not.
 *
 * THE FOUR ANSWERS, and each is a decision rather than a default:
 *
 *   - `solid` is opaque BY DEFINITION and pins the alpha at 1. Its
 *     opacity slider belongs to the other modes, which is what the
 *     playground's own gating says out loud.
 *   - `translucent` turns depth writing off AT ANY ALPHA. That is the
 *     whole reason it is a mode rather than an opacity: a low alpha with
 *     depth writing left on is not a see-through lap, it is a faint lap
 *     that still hides its own far side.
 *   - `flat` follows the alpha, because it has no lit/unlit distinction
 *     left to track — it is the mode for a plan, and a plan laid over its
 *     own far side is a legitimate thing to ask for.
 *   - `wireframe` KEEPS WRITING DEPTH even when blended, and that is the
 *     incumbent behaviour rather than a considered one: the page drew its
 *     dressing at alpha 0.95 with the default depth mask for as long as
 *     it was a wireframe. Changing it here would change `BLUEPRINT`,
 *     which claims to be that page.
 *
 * BLENDING IS DERIVED FROM THE ALPHA, NOT HARDCODED, which is what
 * reproduces all three of the sites the wireframe arm replaced rather
 * than two of them. The fill map built at 0.95 and WAS transparent; the
 * map pass and the streamed map material built at 1 and were NOT. At
 * alpha 1 the blended pixel is identical, so the mistake is invisible —
 * it moves every map-pass mesh out of the opaque pass and into a
 * back-to-front sort that decides nothing, on a view whose whole job is
 * to draw the entire circuit at once.
 */
interface BlendState {
  readonly opacity: number;
  readonly transparent: boolean;
  readonly depthWrite: boolean;
}

function blendFor(surface: Surface, opacity: number): BlendState {
  if (surface === "solid") return { opacity: 1, transparent: false, depthWrite: true };
  const transparent = opacity < 1;
  if (surface === "translucent") return { opacity, transparent: true, depthWrite: false };
  if (surface === "flat") return { opacity, transparent, depthWrite: opacity >= 1 };
  return { opacity, transparent, depthWrite: true };
}

function makeSurfaceMaterial(look: Look, spec: SurfaceSpec): Material {
  const { color, vertexColors } = spec;
  const blend = blendFor(spec.surface, spec.opacity);
  switch (spec.surface) {
    case "wireframe":
      return new MeshBasicMaterial({ color, wireframe: true, vertexColors, ...blend });
    case "flat":
      // THE SAME CLASS AS `wireframe` AND FOR THE SAME REASON: an unlit
      // fill is a colour, not a shading model, and a surface material
      // asked to return a colour with no light returns black, not a flat
      // colour. `look.ts` records that this was found by shipping it.
      return new MeshBasicMaterial({ color, vertexColors, ...blend });
    case "translucent":
    case "solid":
      return new MeshStandardMaterial({
        color,
        roughness: look.roughness,
        metalness: look.metalness,
        vertexColors,
        ...blend,
      });
  }
}

/**
 * Repaint a material that already exists, into a look.
 *
 * NO ALLOCATION, AND NO RECOMPILE EXCEPT AT ONE THRESHOLD: a colour drag
 * runs this over every material on the lap per frame. `color`, `opacity`,
 * `depthWrite` and the two standard-material scalars are all free —
 * uniforms and per-draw state, which three uploads without rebuilding a
 * program. `transparent` is the one that is NOT, because it reaches the
 * program cache key through `parameters.opaque`; it is written only when
 * it actually changes, so a drag costs one recompile at the crossing and
 * nothing on either side of it.
 *
 * WHAT IT STILL REFUSES TO TOUCH IS `wireframe` AND `vertexColors`. Those
 * follow the material CLASS, no property write turns one class into
 * another, and a surface change is therefore a rebuild rather than a
 * repaint. That line — between what a repaint can express and what only a
 * constructor can — is the whole division of labour in this file.
 *
 * AN EARLIER VERSION OF THIS COMMENT PUT `depthWrite` ON THE WRONG SIDE
 * OF THAT LINE, and the code agreed with the comment: it was not written
 * here at all. It is not a cache key and never was, so the omission cost
 * nothing but correctness — a `flat` look dragged below alpha 1 blended
 * and went on writing depth, which no further drag could undo.
 *
 * NARROWED WITH `instanceof`, NOT WITH A CAST. `Material` has `opacity`
 * but not `color`, and the honest reason a cast would be wrong here is
 * that the material may well be the WRONG CLASS: a caller that changed
 * `Look.surface` and retinted instead of rebuilding hands a
 * `MeshBasicMaterial` a roughness. The narrowing makes that a no-op on
 * the property that does not exist rather than a silent write to it.
 */
function tintMaterial(
  material: Material,
  look: Look,
  color: number,
  opacity: number,
  surface: Surface,
): void {
  // THE SAME ANSWER THE CONSTRUCTOR USED. See {@link blendFor} for why
  // this is a call rather than four lines of arithmetic repeated here.
  const blend = blendFor(surface, opacity);

  if (material instanceof MeshStandardMaterial) {
    material.color.setHex(color);
    material.roughness = look.roughness;
    material.metalness = look.metalness;
  } else if (material instanceof MeshBasicMaterial) {
    material.color.setHex(color);
  } else {
    // NOT A MATERIAL THIS FILE BUILT, so there is nothing here that can
    // be written safely. Narrowed with `instanceof` rather than cast,
    // because the honest reason a cast would be wrong is that the
    // material may be the WRONG CLASS — a caller that changed
    // `Look.surface` and retinted instead of rebuilding.
    return;
  }

  material.opacity = blend.opacity;
  // DEPTH WRITING IS FREE TO WRITE AND `transparent` IS NOT. `depthWrite`
  // appears nowhere in three's program cache key — it is applied per draw
  // as `depthBuffer.setMask(material.depthWrite)` — so it can be set
  // unconditionally. `transparent` IS part of that key (through
  // `parameters.opaque`), so flipping it every frame would recompile
  // every frame; guarded on an actual change it costs one recompile at
  // the crossing and nothing on either side of it.
  material.depthWrite = blend.depthWrite;
  if (material.transparent !== blend.transparent) {
    material.transparent = blend.transparent;
    material.needsUpdate = true;
  }
}

/**
 * Does this id name a merged pose rather than a single box?
 *
 * BY PREFIX, because that is the only thing the id carries. `spawn.ts`
 * mints bare role names and `cover:<role>`; `dressGraph.ts` mints
 * `pose:<n>` and `cover:pose:<n>`. The distinction matters for exactly
 * one reason and it is not cosmetic: a pose geometry carries baked
 * per-vertex colours and a unit cube does not, so the two want opposite
 * answers about what the material's base colour should be.
 */
function isPoseId(id: string): boolean {
  return id.startsWith("pose:") || id.startsWith("cover:pose:");
}

/**
 * What one id draws as, in one pass, under one look.
 *
 * THE FORK IS BAKED VERSUS NOT, and it runs through all three passes.
 *
 * A BOX ID resolves to its own colour: the material is the only place the
 * role can be stated, because one instanced mesh draws one asset id and
 * every instance of it is the same role.
 *
 * A POSE ID resolves to WHITE, or to white folded by the pass's own tint.
 * A merged pose is one mesh for a WHOLE PLACEMENT — a dozen boxes of
 * five different roles — so a per-mesh colour cannot code its roles at
 * all; the colours live in the vertices ({@link paintPose}) and the
 * material's job is to multiply through unchanged. White is the identity
 * of that multiply, and a non-white base does not fail loudly: it
 * silently darkens every fill on the lap, uniformly enough to read as a
 * lighting choice rather than as a bug.
 *
 * THE TWO TINTS ARE MULTIPLIES, NOT LERPS, and that is a real
 * approximation rather than a notational one. `assetColor`'s folds are
 * linear mixes toward a colour; a base multiplied into a vertex colour
 * can only fold toward `colour × tint`, which is the same direction and a
 * darker destination. It is CLOSEST for the EDGE, where the destination
 * is black and mixing toward black IS a multiply, so the two differ only
 * by which space the multiply happens in; it is LOOSEST for the MAP,
 * where a light `mapTint` can only fold by doing less rather than by
 * paling. Both are constraints of sharing one material across roles, and
 * neither is worth a second baked attribute to remove: the map pass is a
 * plan and the edge is a line.
 *
 * IT ANSWERS INTO A SHARED OBJECT AND THE ANSWER IS BORROWED. A retint
 * runs this once per material — the box populations' fills and edges,
 * their map materials, and every resident streamed mesh, which is some
 * hundreds — on every frame of a colour drag. Returning a fresh literal
 * made that a few hundred short-lived objects a frame, which is not a
 * problem V8 cannot absorb and IS a problem for the claim this file makes
 * about the retint path costing nothing; the claim is worth more than the
 * literal.
 *
 * WHICH MAKES THE RESULT VALID ONLY UNTIL THE NEXT CALL. Every call site
 * either destructures it or spreads it on the same line, so none of them
 * holds it across another; a caller that wanted to keep one would have to
 * copy it, and this comment is the notice that it must.
 */
const tint = { color: 0, opacity: 1, vertexColors: false, surface: "solid" as Surface };

function passTint(
  id: string,
  pass: Pass,
  look: Look,
  population: Population,
): { color: number; opacity: number; vertexColors: boolean; surface: Surface } {
  const posed = isPoseId(id);
  const base = posed ? WHITE : assetColor(look, id, population);
  tint.vertexColors = posed;
  // THE SURFACE THE PASS IS DRAWN IN, which is not one question but
  // three. The fill wears `Look.surface`; the map pass wears
  // `Look.mapSurface`, which is decided independently of it; and the
  // edge overlay is ALWAYS a wireframe, because the overlay IS the
  // wireframe and what `Look.surface` picks is how the thing under it is
  // drawn. Carried on the answer so the retint can reproduce every flag
  // the constructor set instead of the two it happened to remember.
  tint.surface = pass === "map" ? look.mapSurface : pass === "edge" ? "wireframe" : look.surface;
  switch (pass) {
    case "fill":
      tint.color = base;
      tint.opacity = look.opacity;
      return tint;
    case "edge":
      // Mixing toward black is a scalar multiply, so this is the SAME
      // fold whether it lands on the material of a single box or on a
      // white base multiplying a pose's baked vertex colours. The two
      // paths agree at both ends and differ by a shade in the middle,
      // because one mix happens in sRGB bytes and the other in the
      // renderer's linear working space — a value, never a hue.
      tint.color = mixHex(base, BLACK, 1 - look.edgeTint);
      tint.opacity = look.edgeOpacity;
      return tint;
    case "map":
      tint.color = posed ? mixHex(WHITE, look.mapTint, look.mapMix) : mapColor(look, id, population);
      tint.opacity = look.mapOpacity;
      return tint;
  }
}

/**
 * Retint one LIVE material — a mesh's own clone, not a map's template.
 *
 * THE ENTRY POINT FOR EVERYTHING THAT IS ALREADY DRAWING, and it exists
 * because the maps in this file are templates by design.
 * `toInstancedMeshes` clones each asset's material per mesh (that clone
 * is what renders, and its `dispose()` is the one signal three uses to
 * release that mesh's cached render state), so retinting a map reaches
 * meshes that have not been built yet and NOTHING that is on screen. The
 * page keeps its live materials per layer and passes them here.
 *
 * KEYED BY ASSET ID, because that is the identity a live mesh actually
 * has: `mesh.name` is the batch's asset id and is the only per-mesh
 * identity `toInstancedMeshes` sets. Nothing has to be carried alongside
 * the mesh for this to answer.
 *
 * TAKES A SLOT, NOT A MATERIAL, for the same reason `AssetMap` does: an
 * `InstancedMesh` types its material as one OR an array, and accepting
 * both here is one branch against a cast at every call site.
 */
export function retintMaterial(
  material: Material | Material[],
  assetId: string,
  pass: Pass,
  look: Look,
  population: Population,
): void {
  const { color, opacity, surface } = passTint(assetId, pass, look, population);
  for (const one of Array.isArray(material) ? material : [material]) {
    tintMaterial(one, look, color, opacity, surface);
  }
}

// ------------------------------------------------------------------ //
// The box path: one instance per BOX, over the shared cube.
// ------------------------------------------------------------------ //

/**
 * An asset map for one population.
 *
 * ITS MATERIALS ARE TEMPLATES AND NOTHING ELSE. `toInstancedMeshes`
 * clones each asset's material per mesh — that clone is what renders, and
 * its `dispose()` is the one signal three uses to release that mesh's
 * cached render state — so the originals here are never uploaded and are
 * dead the moment the meshes exist. The caller disposes this map
 * immediately after building from it (see {@link disposeAssetMap}, which
 * is inert bookkeeping rather than GPU work), and from then on every live
 * material is owned by exactly one mesh. That single-ownership rule is
 * what makes the page's dispose loop correct without a special case.
 *
 * WHICH IS ALSO WHY A LOOK CHANGE DOES NOT COME BACK THROUGH HERE. The
 * meshes hold clones, so the live retint is {@link retintMaterial} on
 * what the page kept, not {@link retintAssetMap} on a map that was thrown
 * away three frames after it was built.
 */
export function makeAssetMap(look: Look, population: Population): AssetMap {
  const map: Record<string, { geometry: BufferGeometry; material: Material }> = {};
  for (const id of boxAssetIds()) {
    map[id] = {
      geometry: UNIT_BOX,
      material: makeSurfaceMaterial(look, passTint(id, "fill", look, population)),
    };
  }
  return map;
}

/**
 * The edge overlay for the box path — the same cube, drawn as lines.
 *
 * THE EDGE IS WHAT MAKES A FLAT FILL READ AS A BOX at the one place
 * shading cannot help: two boxes of the same role, touching, lit the
 * same. A silhouette is not enough there and a hue is not either, because
 * both boxes have the same one. It costs a second instanced draw per
 * asset id and nothing else — same geometry, same transforms — which is
 * what makes the overlay exact rather than approximate: an edge can never
 * be drawn around a box that is not there or miss one that is.
 *
 * ITS GEOMETRY IS BORROWED, WHICH DECIDES ITS DISPOSER. Every entry is
 * the shared {@link UNIT_BOX}, exactly as {@link makeAssetMap}'s are, so
 * this map owns its materials and NOT ONE VERTEX and is freed with
 * {@link disposeAssetMap}. That is the same rule {@link
 * makePoseEdgeAssetMap} runs on for the coarse path, where the borrowing
 * is from a map that really does own its buffers and getting it wrong
 * really would free them early.
 */
export function makeEdgeAssetMap(look: Look, population: Population): AssetMap {
  const map: Record<string, { geometry: BufferGeometry; material: Material }> = {};
  for (const id of boxAssetIds()) map[id] = edgeEntry(UNIT_BOX, id, look, population);
  return map;
}

/**
 * The edge overlay for the coarse path, over a pose map's own geometry.
 *
 * DERIVED FROM THE FILL MAP RATHER THAN BUILT BESIDE IT, which is the
 * ownership argument made structural. An outline has to draw the SAME
 * vertices as the fill under it or it is not an outline of anything, and
 * a second merge would agree with the first right up until one of them
 * was edited — the same silent divergence this file's pose header
 * describes having removed by importing `poseBoxesW` instead of copying
 * it. Taking the geometry by reference makes "same geometry" a fact.
 *
 * IT BORROWS BUFFERS THAT SOMEBODY ELSE FREES. Free this one with {@link
 * disposeAssetMap} — materials only. {@link disposePoseAssetMap} would
 * dispose the fill map's merged geometry out from under the meshes still
 * drawing it, and the fill map would then dispose it a second time.
 *
 * IT ALSO BORROWS THE COLOURS. The per-vertex role colours live in the
 * fill map's attribute, so an overlay entry needs no colour of its own:
 * its white-folded-toward-black base multiplies through whatever the fill
 * map last painted. Which is why {@link retintPoseAssetMap} repaints for
 * both and this map's retint is materials only.
 */
export function makePoseEdgeAssetMap(fill: AssetMap, look: Look, population: Population): AssetMap {
  const map: Record<string, { geometry: BufferGeometry; material: Material }> = {};
  for (const id of Object.keys(fill)) map[id] = edgeEntry(fill[id].geometry, id, look, population);
  return map;
}

/** One overlay entry: borrowed geometry, a wireframe material of its own. */
function edgeEntry(
  geometry: BufferGeometry,
  id: string,
  look: Look,
  population: Population,
): { geometry: BufferGeometry; material: Material } {
  return {
    geometry,
    // ALWAYS `wireframe`, and it is not a fourth surface. The overlay IS
    // the wireframe; what `Look.surface` picks is how the thing UNDER it
    // is drawn, and `Look.edges` is what decides whether this map is
    // built at all. `passTint` is what says so — it answers the surface
    // as well as the colour, so this site and the retint that follows it
    // cannot come to different conclusions about which class to use.
    material: makeSurfaceMaterial(look, passTint(id, "edge", look, population)),
  };
}

/**
 * Retint a fill map's materials in place.
 *
 * MATERIALS ONLY, AND FOR A POSE MAP THAT IS HALF THE ANSWER. Use {@link
 * retintPoseAssetMap} there — the pair splits exactly where {@link
 * disposeAssetMap} and {@link disposePoseAssetMap} split, on whether the
 * map owns vertices, which is the one distinction this file has always
 * organised itself around. Calling this one on a pose map is not an
 * error and does not throw: the opacity moves, the hues do not, and it
 * looks like the picker is half broken.
 *
 * THIS REACHES NO MESH THAT ALREADY EXISTS. `toInstancedMeshes` clones a
 * map's materials per mesh, so a map is a set of templates and retinting
 * one changes what the NEXT mesh built from it will look like. The page's
 * live materials are the clones it kept per layer, and {@link
 * retintMaterial} is what those go through. It is worth being blunt about
 * because the failure is invisible: a retint that runs, costs nothing,
 * and changes nothing on screen.
 */
export function retintAssetMap(map: AssetMap, look: Look, population: Population): void {
  for (const id of Object.keys(map)) {
    retintMaterial(map[id].material, id, "fill", look, population);
  }
}

/**
 * Retint an edge overlay in place.
 *
 * ONE FUNCTION FOR BOTH PATHS, for the same reason there is one disposer
 * for both: an overlay never owns a vertex, whether it outlines the cube
 * or a merged pose. The colours it multiplies belong to the fill map and
 * are repainted there — {@link retintPoseAssetMap} — so repainting them
 * here as well would write the same values into the same attribute a
 * second time per frame.
 */
export function retintEdgeAssetMap(map: AssetMap, look: Look, population: Population): void {
  for (const id of Object.keys(map)) {
    retintMaterial(map[id].material, id, "edge", look, population);
  }
}

/**
 * Release a map's template materials.
 *
 * NOT ITS GEOMETRY. Every entry in a box map points at the one shared
 * {@link UNIT_BOX}, so disposing "the geometry of everything in the map"
 * would throw the same buffer away once per id and force a re-upload —
 * the precise bug the hand-written renderer carried a named special case
 * to avoid. The cube outlives every cook and is never disposed; the
 * process ending is what releases it.
 *
 * AND THIS IS THE EDGE OVERLAY'S DISPOSER TOO, by the same rule read the
 * other way. {@link makeEdgeAssetMap} takes its geometry BY REFERENCE
 * from the map it outlines, so an overlay over a POSE map is holding
 * merged geometry it did not make and must not free — the pose map is
 * still drawing it. The rule, stated once for the whole file: a map frees
 * exactly what it minted. This one minted materials.
 */
export function disposeAssetMap(map: AssetMap): void {
  for (const id of Object.keys(map)) {
    const m = map[id].material;
    for (const one of Array.isArray(m) ? m : [m]) one.dispose();
  }
}

/**
 * The MAP pass's material for each asset id.
 *
 * A PLAIN RECORD RATHER THAN A SECOND ASSET MAP, because nothing spawns
 * from it. The page draws two views over each other and swaps each mesh
 * between a PAIR of pre-built materials rather than re-colouring one
 * twice a frame, so the swap costs a pointer; the second half of that
 * pair is looked up by `mesh.name`, which `toInstancedMeshes` sets to the
 * batch's asset id. Exactly one mesh exists per id per population, so
 * each material here ends up owned by exactly one layer and is disposed
 * with it — which also makes these the LIVE materials, unlike the fill
 * map's templates, so {@link retintMapMaterials} does reach the screen.
 *
 * TAKES THE IDS THAT ACTUALLY SPAWNED, not every id an asset map owes an
 * answer for. A lap uses a handful of the twelve, and minting the rest
 * would leave materials that no mesh ever claims and no dispose loop ever
 * reaches — a small leak, but one that grows once per recook and is
 * exactly the class of bug the old renderer's comment records having been
 * caught by.
 *
 * THE MAP PASS USED TO DROP TRANSPARENCY AS A RULE, and the reason still
 * holds: from above, a lap of overlapping translucent boxes reads as a
 * smear of density rather than as a layout, and the layout is the only
 * thing the map view is for. It is a KNOB now rather than a rule —
 * `Look.mapSurface` and `Look.mapOpacity`, separate from the chase view's
 * pair — because the reason is an argument about a view and not a fact
 * about a renderer, and the default still answers it the same way.
 */
export function makeMapMaterials(
  look: Look,
  population: Population,
  ids: readonly string[],
): Record<string, Material> {
  const out: Record<string, Material> = {};
  for (const id of ids) {
    out[id] = makeSurfaceMaterial(look, passTint(id, "map", look, population));
  }
  return out;
}

/** Retint the map pass's per-id materials in place. */
export function retintMapMaterials(
  materials: Record<string, Material>,
  look: Look,
  population: Population,
): void {
  for (const id of Object.keys(materials)) {
    retintMaterial(materials[id], id, "map", look, population);
  }
}

/**
 * The id a shared pose material resolves its colour against.
 *
 * ANY POSE ID ANSWERS THE SAME, which is what makes one material for
 * hundreds of them correct rather than merely cheap: {@link passTint}'s
 * pose branch reads neither the pose number nor the population, because
 * both are already in the vertices. Naming a sentinel says that out loud;
 * threading a real id through would imply the answer depends on it.
 */
const SHARED_POSE_ID = "pose:0";

/**
 * ONE map-pass material for a whole STREAMED population.
 *
 * THE COUNTERPART TO {@link makeMapMaterials}, and the difference is how
 * many names the population has. That function mints one material per
 * asset id because a lap uses a handful of the twelve box ids and each
 * ends up owned by exactly one mesh. A pose library has hundreds of ids,
 * they arrive and leave with the sectors rather than with the cook, and
 * the map pass is a flat overhead view — so a per-id table there would be
 * hundreds of materials, all the same, minted and freed on a schedule
 * nothing needs to track.
 *
 * ONE MATERIAL IS SAFE HERE FOR THE REASON THE PER-ID TABLE IS NOT: it is
 * BORROWED rather than owned. The streamed meshes belong to the world
 * binding, which disposes each mesh's own material with it; this one is
 * lent to them for the length of the map pass and handed back, and the
 * page disposes it with the world that built it.
 *
 * IT TAKES A POPULATION AND CANNOT READ ONE, which is worth stating
 * rather than hiding behind a shorter signature. The meshes it is lent to
 * carry baked per-vertex colours with the population already folded in,
 * so {@link passTint}'s pose branch answers white regardless and the
 * argument falls through unused. It stays in the signature because every
 * other maker in this file takes one in the same position, and a caller
 * that has to remember which single function forgot to ask is a caller
 * that will eventually hand the reference layer's material to the
 * generated one. The right reading is not "unused": it is that the
 * population moved into the geometry.
 *
 * WHICH LEAVES `mapMix` ONLY A MULTIPLY, and the decision is to take it.
 * Folding the plan toward one tint is what makes the map read as a layer
 * rather than as the chase view from above, and a white base scaled
 * toward `mapTint` does fold it — toward `colour × tint` instead of
 * toward `tint`. The two agree at `mapMix: 0`, track each other closely
 * for a dark tint over light roles (the shipped default), and part
 * company for a LIGHT tint, which can only fold by doing less rather than
 * by paling. The alternative is a second baked colour attribute per pose
 * — a whole second vocabulary of vertices to state a fold that is already
 * approximate by eye — and that is not a trade this view is worth.
 */
export function makeStreamedMapMaterial(look: Look, population: Population): Material {
  return makeSurfaceMaterial(look, passTint(SHARED_POSE_ID, "map", look, population));
}

/**
 * Retint the borrowed streamed map-pass material in place.
 *
 * ONE MATERIAL, SO ONE CALL retints every streamed pose on the map pass —
 * the one place in this file where the shared-material decision pays back
 * at retint time as well as at build time.
 */
export function retintStreamedMapMaterial(
  material: Material,
  look: Look,
  population: Population,
): void {
  retintMaterial(material, SHARED_POSE_ID, "map", look, population);
}

// ------------------------------------------------------------------ //
// One instance per PLACEMENT: a pose drawn as a single merged mesh.
// ------------------------------------------------------------------ //

/**
 * NOTHING ABOUT A POSE IS DECIDED HERE, and that is the whole arrangement.
 *
 * `dressGraph.ts` owns the pose library, the corners-to-centre-and-extent
 * conversion ({@link poseBoxesW}) and the id a placement is keyed by
 * ({@link poseAssetId}), because it is the file the RULES read, and the
 * page's only claim is that the mesh drawn here is the boxes those rules
 * measured. Each of those three was written out a second time in this file
 * once. None of them was wrong; all three were a copy that agrees until
 * one side is edited, and the failure mode is silent — a lap that is nearly
 * the lap beside it. Importing them makes the two paths the same arithmetic
 * rather than two readings of it, and leaves this file with the one job it
 * should have: turning numbers into vertices.
 *
 * It costs an import from a module that never touches three, which is the
 * direction that was always safe: `dressGraph.ts` is cooked headlessly in
 * the tests and must not gain a renderer dependency, and this direction
 * cannot give it one. The role a box carries rides the same import for the
 * same reason — see {@link PoseBoxW.role}, which that file passes through
 * without reading.
 */

/** {@link UNIT_BOX}'s six faces, read once as plain arrays. */
interface UnitFaces {
  /** 3 floats per vertex, the cube's corners at ±0.5. */
  readonly position: Float32Array;
  readonly normal: Float32Array;
  /** Triangle indices into those vertices. */
  readonly index: Uint16Array;
  readonly vertexCount: number;
}

/**
 * The cube's faces, pulled out of the shared geometry rather than typed in.
 *
 * DERIVED, SO THE TWO PATHS DRAW THE SAME CUBE. A merged pose is stamped
 * from this and a single box is drawn from {@link UNIT_BOX} itself, and
 * the page's whole claim is that the coarse path draws what the fine one
 * drew. A hand-written vertex table would be a second cube that agrees
 * until three changes its own — and it is not only the corners that would
 * have to agree: `wireframe` derives its edges from the INDEX, so a
 * different triangulation of the same corners is a visibly different box.
 *
 * Read through `getX`/`getY`/`getZ` because that is the accessor both an
 * interleaved and a plain attribute answer, and the sequential fallback
 * covers a cube that arrives without an index. Neither costs anything: it
 * runs once, over 24 vertices, at module load.
 */
function readUnitFaces(): UnitFaces {
  const position = UNIT_BOX.getAttribute("position");
  const normal = UNIT_BOX.getAttribute("normal");
  const index = UNIT_BOX.getIndex();
  const vertexCount = position.count;
  const pos = new Float32Array(vertexCount * 3);
  const nrm = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    pos[i * 3] = position.getX(i);
    pos[i * 3 + 1] = position.getY(i);
    pos[i * 3 + 2] = position.getZ(i);
    nrm[i * 3] = normal.getX(i);
    nrm[i * 3 + 1] = normal.getY(i);
    nrm[i * 3 + 2] = normal.getZ(i);
  }
  const idx = new Uint16Array(index === null ? vertexCount : index.count);
  for (let i = 0; i < idx.length; i++) idx[i] = index === null ? i : index.getX(i);
  return { position: pos, normal: nrm, index: idx, vertexCount };
}

const UNIT_FACES = readUnitFaces();

/** Where an unnamed box lands in the palette. */
const DEFAULT_ROLE_INDEX = BOX_ROLES.indexOf("mass");

/**
 * What a merged geometry needs to be repainted without being rebuilt.
 *
 * A ROLE INDEX PER VERTEX, AND THE ATTRIBUTE'S OWN ARRAY. The roles are
 * what the colours were computed FROM, and keeping them is the difference
 * between a colour drag costing a pass over some floats and costing a
 * re-merge of the whole vocabulary — hundreds of poses, per frame, while
 * the picker moves. Recovering them from the baked colours instead is not
 * possible in general and is a lookup table against a palette that is
 * mid-edit in particular.
 *
 * NOT AN ATTRIBUTE, AND DELIBERATELY NOT. Nothing on the GPU reads a role
 * index — the shader wants the colour — so uploading one would add a
 * quarter of a byte per vertex to every buffer in the lap to carry a
 * value only the CPU asks about. A `WeakMap` keyed by the geometry keeps
 * it beside the thing it describes and lets it die with it, which a
 * module-level array indexed by pose id would not: the maps here are
 * rebuilt per cook and the table would outlive every one of them.
 *
 * THE ARRAY IS HELD RATHER THAN READ BACK because `BufferAttribute.array`
 * is typed as the union of every typed array three admits, and a cast at
 * the one place that writes to it is a cast that survives a change of
 * element type. Holding the `Float32Array` this file allocated is the
 * same fact with no cast in it.
 */
interface PoseColorTable {
  /** One index into `BOX_ROLES` per vertex. */
  readonly roles: Uint8Array;
  /** The `color` attribute's backing store, held to avoid a cast. */
  readonly colors: Float32Array;
  /** The attribute itself, so a repaint can flag it for re-upload. */
  readonly attribute: BufferAttribute;
}

/**
 * Merged geometry → what it takes to repaint it.
 *
 * WEAK, so a disposed pose map takes its tables with it. Nothing else
 * holds these geometries and nothing should have to remember to forget
 * them.
 */
const POSE_COLORS = new WeakMap<BufferGeometry, PoseColorTable>();

/**
 * {@link paintPose}'s working room, hoisted so a retint allocates nothing.
 *
 * A DRAG REPAINTS THE WHOLE VOCABULARY PER FRAME — a few hundred merged
 * geometries — and a `Color` plus an 18-float table per geometry is a few
 * hundred short-lived objects per frame. That is not a leak and it is not
 * slow arithmetic; it is the collector waking up mid-drag, which is the
 * one cost a picker actually shows. Safe as module state because nothing
 * in the paint re-enters it and both are written in full before they are
 * read.
 */
const PAINT_COLOR = new Color();
/** Six role colours in the renderer's working space, r/g/b interleaved. */
const PAINT_BY_ROLE = new Float32Array(BOX_ROLES.length * 3);

/**
 * One pose's boxes as a single geometry, in the library's own units.
 *
 * TAKES CENTRES AND EXTENTS, NOT CORNERS, so the arithmetic that produced
 * them is `poseBoxesW`'s and the fine path's per-box points are stamped
 * from the same values. Half-widths throughout: the track's scale arrives
 * on the INSTANCE transform, so one merged pose dresses a lap of any width.
 *
 * Normals are copied unchanged rather than transformed. A box's normals
 * only ever point down an axis and every extent is floored strictly above
 * zero, so a positive per-axis scale leaves them axis-aligned and unit —
 * the inverse-transpose a general mesh would need has nothing to do here.
 * They are read now rather than carried unused: a `solid` or `translucent`
 * surface is a lit material, and the hemisphere `look.ts` describes shades
 * a box by which way its faces point and by nothing else.
 *
 * THE COLOUR ATTRIBUTE IS ALLOCATED HERE AND FILLED BY {@link paintPose}.
 * Splitting them is what makes the first paint and every later retint the
 * same code: a merge that also coloured would be a second painter, and
 * the two would agree until the palette grew a fold that only one of them
 * learned about.
 */
function mergePose(boxes: readonly PoseBoxW[]): BufferGeometry {
  const perBox = UNIT_FACES.vertexCount;
  const perBoxIndices = UNIT_FACES.index.length;
  const position = new Float32Array(boxes.length * perBox * 3);
  const normal = new Float32Array(boxes.length * perBox * 3);
  // A pose of more than ~2730 boxes overflows a 16-bit index. The shipped
  // vocabulary is nowhere near that, and picking the width from the count
  // costs one comparison against a whole class of silently wrapped
  // geometry on a catalogue nobody has built yet.
  const vertices = boxes.length * perBox;
  const index =
    vertices > 65535
      ? new Uint32Array(boxes.length * perBoxIndices)
      : new Uint16Array(boxes.length * perBoxIndices);
  const colors = new Float32Array(vertices * 3);
  const roles = new Uint8Array(vertices);

  let base = 0;
  let at = 0;
  for (const b of boxes) {
    const [cx, cy, cz] = b.centre;
    const [sx, sy, sz] = b.extent;
    // ONE ROLE FOR ALL OF A BOX'S VERTICES, resolved once per box rather
    // than once per vertex. A name the vocabulary has never heard of
    // lands on `mass`, which is the palette's own answer for "a volume
    // with nothing more specific to say" — deciding that here rather than
    // throwing keeps a kit with an unknown role name drawable.
    const role = (BOX_ROLES as readonly string[]).indexOf(b.role ?? "");
    roles.fill(role < 0 ? DEFAULT_ROLE_INDEX : role, base, base + perBox);
    for (let i = 0; i < perBox; i++) {
      const from = i * 3;
      const to = (base + i) * 3;
      position[to] = UNIT_FACES.position[from] * sx + cx;
      position[to + 1] = UNIT_FACES.position[from + 1] * sy + cy;
      position[to + 2] = UNIT_FACES.position[from + 2] * sz + cz;
      normal[to] = UNIT_FACES.normal[from];
      normal[to + 1] = UNIT_FACES.normal[from + 1];
      normal[to + 2] = UNIT_FACES.normal[from + 2];
    }
    for (let i = 0; i < perBoxIndices; i++) index[at + i] = base + UNIT_FACES.index[i];
    base += perBox;
    at += perBoxIndices;
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(position, 3));
  geo.setAttribute("normal", new BufferAttribute(normal, 3));
  const colorAttribute = new BufferAttribute(colors, 3);
  geo.setAttribute("color", colorAttribute);
  geo.setIndex(new BufferAttribute(index, 1));
  // Frustum culling reads it, and a merged pose is not a unit cube any
  // more: its radius is the pose's own reach, which is the number the
  // renderer has no other way to know.
  geo.computeBoundingSphere();
  POSE_COLORS.set(geo, { roles, colors, attribute: colorAttribute });
  return geo;
}

/**
 * Write one asset id's role colours into a merged geometry's vertices.
 *
 * THE ONLY WAY A MERGED POSE CAN CODE ITS ROLES. One instanced mesh draws
 * a whole placement, so the material states one colour for a dozen boxes
 * of five different roles; the vertices are the only per-box channel the
 * coarse path has, and without them the diagram this look is for stops at
 * the box path. That is the trade the coarse path makes and it is worth
 * naming: it buys instances in the hundreds instead of the thousands, and
 * it pays by moving the palette into the buffer.
 *
 * LINEAR SPACE, WHICH IS THE ONE THING EASY TO GET WRONG HERE. Three
 * colour-manages a MATERIAL colour on the way in — `setHex` defaults to
 * `SRGBColorSpace` and converts to the renderer's working space — but it
 * does NOT touch a vertex-colour attribute, which the shader multiplies
 * in raw (`vColor.rgb *= color`). So the same hex has to arrive here
 * already converted, and `new Color().setHex(hex)` is exactly that
 * conversion. Writing the packed bytes straight in leaves sRGB values
 * being read as linear and every fill comes out washed out and pale;
 * calling `convertSRGBToLinear()` on top of `setHex` converts twice and
 * every fill comes out muddy. Neither failure looks like a colour-space
 * bug — both look like a badly chosen palette.
 *
 * COVER COMES FROM THE ID, not from the box. A pose is boxes and cover is
 * a property of where the PLACEMENT sits — over the racing line rather
 * than beside it — which is why `dressGraph.ts` mints `pose:n` and
 * `cover:pose:n` as separate ids for the same boxes, and why this is
 * called once per id rather than once per pose.
 *
 * A GEOMETRY WITH NO TABLE IS NOT AN ERROR. It is a unit cube: the box
 * path's entries all point at {@link UNIT_BOX}, which has no colour
 * attribute and needs none because its material carries the role. Falling
 * through lets {@link retintAssetMap} be one function for both maps.
 */
function paintPose(
  geometry: BufferGeometry,
  id: string,
  look: Look,
  population: Population,
): void {
  const table = POSE_COLORS.get(geometry);
  if (table === undefined) return;
  const { cover } = readAssetId(id);
  // The six answers, resolved once per geometry rather than once per
  // vertex: a pose of a dozen boxes is ~300 vertices and the palette can
  // only give six answers, so the per-vertex loop below is a copy rather
  // than a computation. It is what keeps a colour drag inside a frame.
  //
  // Into module-level scratch, so a retint over a whole vocabulary really
  // does allocate nothing — a `Color` and an 18-float table per geometry
  // is a few hundred short-lived objects per frame of a drag, which is
  // not a leak and is exactly the shape of garbage that turns a smooth
  // drag into a stuttering one. Both are fully overwritten below before
  // anything reads them, and nothing here re-enters.
  for (let r = 0; r < BOX_ROLES.length; r++) {
    const role = BOX_ROLES[r];
    PAINT_COLOR.setHex(assetColor(look, cover ? `cover:${role}` : role, population));
    PAINT_BY_ROLE[r * 3] = PAINT_COLOR.r;
    PAINT_BY_ROLE[r * 3 + 1] = PAINT_COLOR.g;
    PAINT_BY_ROLE[r * 3 + 2] = PAINT_COLOR.b;
  }
  const byRole = PAINT_BY_ROLE;
  const { roles, colors, attribute } = table;
  for (let v = 0; v < roles.length; v++) {
    const from = roles[v] * 3;
    const to = v * 3;
    colors[to] = byRole[from];
    colors[to + 1] = byRole[from + 1];
    colors[to + 2] = byRole[from + 2];
  }
  attribute.needsUpdate = true;
}

/**
 * An asset map keyed by POSE, for the one-instance-per-placement path.
 *
 * THE COARSE PATH, AND IT IS A DIFFERENT PICTURE OF THE SAME NUMBERS. The
 * box map draws one instance per box and can colour a rib differently from
 * a post; this draws one per PLACEMENT, so a lap costs instances in the
 * hundreds rather than the thousands and the smallest thing addressable is
 * the pose. Both are wanted — the fine one to ask what a box is, the
 * coarse one to ask what the lap looks like — and neither replaces the
 * other, which is why this is an addition and not a rewrite.
 *
 * ONE GEOMETRY PER (POSE, COVER) PAIR, WHICH IT DID NOT USED TO BE. The
 * two ids shared one merged geometry for as long as they drew the same
 * thing, and they no longer do: {@link paintPose} bakes `Look.cover` into
 * the VERTICES, so `cover:pose:17` and `pose:17` differ by the contents of
 * a buffer and one buffer cannot hold both. Sharing it anyway would give
 * whichever id painted last the whole lap — a covered span and a bare one
 * in the same colour, which is precisely the distinction `dressGraph.ts`
 * mints two ids to keep. It doubles the merge, once per cook, over a
 * vocabulary of a few hundred poses; the retint that this buys is what
 * runs per frame, and it is exact.
 *
 * EVERY POSE IN THE LIBRARY GETS AN ENTRY, including one whose box set is
 * empty. An empty pose draws nothing, which is what the fine path does
 * with it too; leaving the id out instead would make the same lap throw
 * `unknown assetId` out of `toInstancedMeshes` the first time a placement
 * selected it.
 *
 * THE MATERIALS ARE WHITE and the population is not in them. It is in the
 * vertices — see {@link passTint} for why white is the only correct base
 * for a vertex-coloured fill, and what a non-white one costs.
 */
export function makePoseAssetMap(
  lib: PoseLibrary,
  halfWidth: number,
  look: Look,
  population: Population,
): AssetMap {
  const posed = poseBoxesW(lib, halfWidth);
  const map: Record<string, { geometry: BufferGeometry; material: Material }> = {};
  for (let pose = 0; pose < posed.length; pose++) {
    for (const cover of [false, true]) {
      const id = poseAssetId(pose, cover);
      const geometry = mergePose(posed[pose]);
      paintPose(geometry, id, look, population);
      map[id] = {
        geometry,
        material: makeSurfaceMaterial(look, passTint(id, "fill", look, population)),
      };
    }
  }
  return map;
}

/**
 * Retint a pose map in place — its baked vertex colours AND its materials.
 *
 * THE WHOLE POINT OF KEEPING A ROLE TABLE. Every colour on the coarse
 * path lives in a buffer, and the only other way to change one is to
 * merge the vocabulary again — a few hundred poses, twice each — which is
 * not a thing that can happen while a colour picker is being dragged.
 * This walks the roles instead: six palette lookups per geometry and a
 * copy per vertex, no allocation, no re-merge, and no rebuild of the
 * streamed world (which would recook the lap and cost a second and a
 * third of it).
 *
 * IT DOES REACH THE MESHES ALREADY ON SCREEN, unlike every other retint
 * here, and the asymmetry is exactly the ownership rule read forwards.
 * `toInstancedMeshes` hands a mesh its geometry BY REFERENCE and its
 * material as a CLONE, so rewriting the attribute repaints every streamed
 * sector currently live while rewriting the template materials repaints
 * none of them. The page still has to run {@link retintMaterial} over the
 * live clones for the opacity and the standard-material scalars; what it
 * does NOT have to do is touch a vertex.
 *
 * WHICH RESTS ON THESE BATCHES CARRYING NO NAMED CHANNELS, and it is the
 * same condition {@link disposePoseAssetMap} depends on read from the
 * other end. A channel is an attribute of the GEOMETRY, so a channelled
 * batch gets a CLONE of its own — and a clone is a different buffer with
 * a different `color` attribute and no entry in the role table, so this
 * would repaint the map and leave every live mesh exactly as it was. The
 * lap spawns transforms and an asset id and nothing else; a future
 * per-instance channel on the coarse path is the thing that would quietly
 * break this, not a change to any of the colour code above.
 *
 * A SET OVER THE GEOMETRIES, and this one is not defensive. Two ids can
 * legitimately answer with the same buffer — nothing in `AssetMap`
 * forbids it, and the entries here shared one until cover moved into the
 * vertices — and painting the same attribute twice with two different
 * ids' colours would leave whichever ran last, silently, on both. Skipping
 * a geometry already painted this pass makes the FIRST id win instead of
 * the last, which is at least stable; the real guarantee is upstream, in
 * {@link makePoseAssetMap} merging one geometry per (pose, cover) pair.
 */
export function retintPoseAssetMap(map: AssetMap, look: Look, population: Population): void {
  const painted = new Set<BufferGeometry>();
  for (const id of Object.keys(map)) {
    const { geometry } = map[id];
    if (!painted.has(geometry)) {
      painted.add(geometry);
      paintPose(geometry, id, look, population);
    }
    retintMaterial(map[id].material, id, "fill", look, population);
  }
}

/**
 * Release a pose map's geometry AND its materials.
 *
 * THE OPPOSITE OF {@link disposeAssetMap}, and the difference is
 * ownership rather than taste. That map's entries all point at the one
 * module-level cube, which outlives every cook and belongs to nobody; the
 * geometries here were merged for this map alone, so nothing else can free
 * them and leaving them is a leak that grows by a whole vocabulary per
 * recook.
 *
 * WHICH MEANS THE CALL SITE IS DIFFERENT TOO. `disposeAssetMap` is called
 * the moment the meshes are built, because by then only the dead template
 * materials are left. This map's geometry is the geometry those meshes
 * DRAW — `toInstancedMeshes` hands it to them BY REFERENCE (these poses
 * carry no named per-instance channels, which is the one thing that would
 * make it clone instead) — so this waits until the meshes are gone. It
 * waits for the EDGE OVERLAY too, if one was derived from this map: that
 * map borrows these geometries and frees only its own materials, so
 * disposing this one first would pull the buffers out from under it.
 *
 * AND IT WOULD STILL WAIT IF THAT CHANGED. A channelled batch gets a
 * geometry CLONE of its own, flagged `ownsGeometry` and disposed with the
 * mesh; the map's original is not that clone and is still nobody else's
 * to free. Either way the rule from `src/three/instanced.ts` is the one
 * that decides here: an asset map's geometry is disposed WITH THE MAP,
 * never per mesh.
 *
 * A SET EVEN THOUGH THE ENTRIES NO LONGER OVERLAP. They did: two ids
 * answered with the same merged geometry until cover moved into the
 * vertices, and a loop over the keys disposed each one twice — the second
 * call re-firing three's `dispose` event on a buffer already released,
 * the same double-free the box map's comment records the hand-written
 * renderer carrying a named special case to avoid. The sharing is gone
 * and the Set stays, because what made it necessary was a decision about
 * ids and geometries that this file has now made twice in two different
 * directions. Collecting distinct objects first says it once whichever
 * way that decision goes next, and says it for the materials on the same
 * pass.
 */
export function disposePoseAssetMap(map: AssetMap): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  for (const id of Object.keys(map)) {
    geometries.add(map[id].geometry);
    const m = map[id].material;
    for (const one of Array.isArray(m) ? m : [m]) materials.add(one);
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}
