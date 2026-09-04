/**
 * The look playground: a {@link Look} as a panel of controls.
 *
 * WHY THERE IS A RECORD IN THE MIDDLE AT ALL, rather than binding the
 * controls straight to the live look. `shared/controls.ts` addresses a
 * value by a TOP-LEVEL KEY of the record it is given — that is what makes
 * a spec plain data, which is what lets the editor carry one through a
 * JSON file — and `Look.roles` is a nested record. Six colours living one
 * level down is the whole reason for the flattening; everything else here
 * is a straight rename, and {@link readLook} / {@link writeLook} are the
 * two halves of it.
 *
 * IT IS ALSO THE SEAM THAT KEEPS THE LOOK HONEST. A `Look` is consumed by
 * materials and lights and by nothing that cooks; a panel record is
 * consumed by a renderer that knows nothing about three. Neither has to
 * know the other's shape, and the one place they meet is small enough to
 * read.
 */
import type { ControlSection } from "../../shared/controls.js";
import { BOX_ROLES } from "./spawn.js";
import { PRESETS, type Look, type Surface } from "./look.js";

/**
 * The look flattened into one record the control kit can address.
 *
 * `preset` IS NOT PART OF A LOOK and only exists here. A look is a set of
 * values; which named set they last came from is a fact about the panel,
 * and storing it on the look would leave every hand-tweaked variant
 * claiming to be the preset it started from.
 */
export interface LookValues extends Record<string, unknown> {
  preset: string;

  surface: string;
  opacity: number;
  edges: boolean;
  edgeOpacity: number;
  edgeTint: number;

  panel: number;
  leg: number;
  post: number;
  span: number;
  head: number;
  mass: number;
  cover: number;
  coverMix: number;
  reference: number;
  referenceMix: number;

  sky: number;
  ground: number;
  hemi: number;
  key: number;
  keyIntensity: number;
  keyAzimuth: number;
  keyElevation: number;
  fill: number;
  fillIntensity: number;
  roughness: number;
  metalness: number;
  exposure: number;

  background: number;
  horizon: number;
  fog: number;
  fogNear: number;
  fogFar: number;

  road: number;
  roadOpacity: number;
  centreline: number;
  car: number;

  mapSurface: string;
  mapOpacity: number;
  mapTint: number;
  mapMix: number;
}

/** A look as the panel's record. */
export function readLook(look: Look, preset: string): LookValues {
  return {
    preset,
    surface: look.surface,
    opacity: look.opacity,
    edges: look.edges,
    edgeOpacity: look.edgeOpacity,
    edgeTint: look.edgeTint,

    panel: look.roles.panel,
    leg: look.roles.leg,
    post: look.roles.post,
    span: look.roles.span,
    head: look.roles.head,
    mass: look.roles.mass,
    cover: look.cover,
    coverMix: look.coverMix,
    reference: look.reference,
    referenceMix: look.referenceMix,

    sky: look.sky,
    ground: look.ground,
    hemi: look.hemi,
    key: look.key,
    keyIntensity: look.keyIntensity,
    keyAzimuth: look.keyAzimuth,
    keyElevation: look.keyElevation,
    fill: look.fill,
    fillIntensity: look.fillIntensity,
    roughness: look.roughness,
    metalness: look.metalness,
    exposure: look.exposure,

    background: look.background,
    horizon: look.horizon,
    fog: look.fog,
    fogNear: look.fogNear,
    fogFar: look.fogFar,

    road: look.road,
    roadOpacity: look.roadOpacity,
    centreline: look.centreline,
    car: look.car,

    mapSurface: look.mapSurface,
    mapOpacity: look.mapOpacity,
    mapTint: look.mapTint,
    mapMix: look.mapMix,
  };
}

/**
 * The panel's record back into a look, IN PLACE.
 *
 * IN PLACE BECAUSE EVERY MATERIAL HOLDS THE SAME OBJECT. `main.ts` builds
 * one live look and hands the reference to lights, fog, the sky shader
 * and half a dozen closures; assigning a new object here would leave all
 * of them describing the look as it was when they were built. Which is
 * the same argument `assignLook` makes, for the same reason.
 */
export function writeLook(look: Look, v: LookValues): void {
  look.surface = v.surface as Surface;
  look.opacity = v.opacity;
  look.edges = v.edges;
  look.edgeOpacity = v.edgeOpacity;
  look.edgeTint = v.edgeTint;

  look.roles.panel = v.panel;
  look.roles.leg = v.leg;
  look.roles.post = v.post;
  look.roles.span = v.span;
  look.roles.head = v.head;
  look.roles.mass = v.mass;
  look.cover = v.cover;
  look.coverMix = v.coverMix;
  look.reference = v.reference;
  look.referenceMix = v.referenceMix;

  look.sky = v.sky;
  look.ground = v.ground;
  look.hemi = v.hemi;
  look.key = v.key;
  look.keyIntensity = v.keyIntensity;
  look.keyAzimuth = v.keyAzimuth;
  look.keyElevation = v.keyElevation;
  look.fill = v.fill;
  look.fillIntensity = v.fillIntensity;
  look.roughness = v.roughness;
  look.metalness = v.metalness;
  look.exposure = v.exposure;

  look.background = v.background;
  look.horizon = v.horizon;
  look.fog = v.fog;
  look.fogNear = v.fogNear;
  look.fogFar = v.fogFar;

  look.road = v.road;
  look.roadOpacity = v.roadOpacity;
  look.centreline = v.centreline;
  look.car = v.car;

  look.mapSurface = v.mapSurface as Surface;
  look.mapOpacity = v.mapOpacity;
  look.mapTint = v.mapTint;
  look.mapMix = v.mapMix;
}

/**
 * The three keys a change of which cannot be a property write.
 *
 * NAMED ONCE, HERE, because two files act on the answer: the panel decides
 * whether to report a restyle, and `main.ts` decides whether to rebuild.
 * Written out twice, the two agree until one gains a key — and the failure
 * is a control that silently does nothing until the next recook.
 */
export const RESTYLE_KEYS: ReadonlySet<string> = new Set(["surface", "mapSurface", "edges"]);

const SURFACES = [
  { value: "solid", label: "solid — lit" },
  { value: "translucent", label: "translucent — lit" },
  { value: "flat", label: "flat — unlit" },
  { value: "wireframe", label: "wireframe" },
];

/** Role rows, in the order the vocabulary uses them rather than alphabetically. */
const ROLE_ROWS = BOX_ROLES.map((role) => ({ key: role, label: role }));

/**
 * The panel.
 *
 * TABBED, BECAUSE THERE ARE FORTY OF THEM. `Controls.svelte` makes that a
 * flag and its own comment names the case: a handful of knobs gains
 * nothing from tabs and fifty in one scroll is what wants them. Six
 * sections is about the point where a person can hold the list in their
 * head, which is why `light` carries twelve rows rather than splitting.
 *
 * EVERY SLIDER IS `live`, and that is a claim about the renderer rather
 * than a preference. `main.ts` retints without allocating — materials,
 * lights, fog and the poses' vertex buffers are all written in place — so
 * following the thumb costs a few thousand float writes a frame. The
 * three rows that are NOT live are the ones in {@link RESTYLE_KEYS}, and
 * they are a select and a checkbox, which have no drag to follow.
 */
export const LOOK_SECTIONS: readonly ControlSection<LookValues>[] = [
  {
    title: "look",
    controls: [
      {
        kind: "select",
        key: "preset",
        label: "preset",
        options: PRESETS.map((p) => ({ value: p.id, label: p.label })),
        description: "Load a whole look. Every control below stays editable afterwards.",
      },
      {
        kind: "select",
        key: "surface",
        label: "surface",
        options: SURFACES,
        description:
          "solid writes depth and is opaque; translucent turns depth writing OFF so the far " +
          "side of the lap shows through; flat is an unlit fill in the exact colours below; " +
          "wireframe is the page as it was. The light section applies to the two lit ones.",
      },
      {
        kind: "slider",
        key: "opacity",
        label: "opacity",
        min: 0.05,
        max: 1,
        step: 0.01,
        live: true,
        visibleWhen: { surface: ["translucent", "flat", "wireframe"] },
        description: "Fill alpha. A solid surface is opaque by definition and ignores it.",
      },
      { kind: "flags", label: "outline", items: [{ key: "edges", label: "edges" }] },
      {
        kind: "slider",
        key: "edgeOpacity",
        label: "edge alpha",
        min: 0,
        max: 1,
        step: 0.01,
        live: true,
        visibleWhen: { edges: true },
      },
      {
        kind: "slider",
        key: "edgeTint",
        label: "edge tint",
        min: 0,
        max: 1,
        step: 0.01,
        live: true,
        visibleWhen: { edges: true },
        description: "0 draws the outline black; 1 draws it in the fill's own hue.",
      },
    ],
  },
  {
    title: "palette",
    controls: [
      ...ROLE_ROWS.map(
        (r) =>
          ({
            kind: "color",
            key: r.key,
            label: r.label,
            description: `Every ${r.label} on the lap, in both populations.`,
          }) as const,
      ),
      {
        kind: "color",
        key: "cover",
        label: "cover accent",
        description: "Structure OVER the racing line mixes toward this, keeping its role's hue.",
      },
      { kind: "slider", key: "coverMix", label: "cover mix", min: 0, max: 1, step: 0.01, live: true },
      {
        kind: "color",
        key: "reference",
        label: "reference",
        description: "The optional local catalogue drawn beside the generated dressing.",
      },
      {
        kind: "slider",
        key: "referenceMix",
        label: "reference mix",
        min: 0,
        max: 1,
        step: 0.01,
        live: true,
        description:
          "1 folds the reference to one flat colour, so it does not compete with the " +
          "generated layer; 0 codes both identically, for comparing them role by role.",
      },
    ],
  },
  {
    title: "light",
    controls: [
      { kind: "color", key: "sky", label: "sky" },
      { kind: "color", key: "ground", label: "bounce" },
      {
        kind: "slider",
        key: "hemi",
        label: "hemisphere",
        min: 0,
        max: 3,
        step: 0.05,
        live: true,
        description:
          "Shades a face by which way it points and nothing else, so the same box reads the " +
          "same anywhere on the lap. At 0 nothing is lit and tone mapping switches off.",
      },
      { kind: "color", key: "key", label: "key" },
      { kind: "slider", key: "keyIntensity", label: "key", min: 0, max: 3, step: 0.05, live: true },
      {
        kind: "slider",
        key: "keyAzimuth",
        label: "key angle",
        min: 0,
        max: 360,
        step: 1,
        unit: "°",
        live: true,
      },
      {
        kind: "slider",
        key: "keyElevation",
        label: "key height",
        min: 0,
        max: 89,
        step: 1,
        unit: "°",
        live: true,
      },
      { kind: "color", key: "fill", label: "fill" },
      { kind: "slider", key: "fillIntensity", label: "fill", min: 0, max: 2, step: 0.05, live: true },
      {
        kind: "slider",
        key: "roughness",
        label: "roughness",
        min: 0,
        max: 1,
        step: 0.01,
        live: true,
        visibleWhen: { surface: ["solid", "translucent"] },
      },
      {
        kind: "slider",
        key: "metalness",
        label: "metalness",
        min: 0,
        max: 1,
        step: 0.01,
        live: true,
        visibleWhen: { surface: ["solid", "translucent"] },
        description: "Needs something to reflect; with no environment map it only darkens.",
      },
      { kind: "slider", key: "exposure", label: "exposure", min: 0.2, max: 3, step: 0.01, live: true },
    ],
  },
  {
    title: "air",
    controls: [
      { kind: "color", key: "background", label: "sky top" },
      {
        kind: "color",
        key: "horizon",
        label: "sky bottom",
        description: "Equal to the top is a flat sky, which is the more diagrammatic of the two.",
      },
      {
        kind: "color",
        key: "fog",
        label: "fog",
        description:
          "Matching the sky dissolves distance; lighter than it makes distance pale without " +
          "dissolving, which keeps the far side of the circuit readable as a shape.",
      },
      { kind: "slider", key: "fogNear", label: "fog near", min: 0, max: 400, step: 5, live: true },
      { kind: "slider", key: "fogFar", label: "fog far", min: 100, max: 2000, step: 10, live: true },
    ],
  },
  {
    title: "track",
    controls: [
      { kind: "color", key: "road", label: "road" },
      {
        kind: "slider",
        key: "roadOpacity",
        label: "road alpha",
        min: 0.05,
        max: 1,
        step: 0.01,
        live: true,
      },
      { kind: "color", key: "centreline", label: "racing line" },
      { kind: "color", key: "car", label: "car" },
    ],
  },
  {
    title: "map",
    controls: [
      {
        kind: "select",
        key: "mapSurface",
        label: "surface",
        options: SURFACES,
        description:
          "The map picks its own material class, so a lit surface here under a look with the " +
          "lights at zero draws a black plate — pick flat or wireframe for an unlit look.",
      },
      {
        kind: "slider",
        key: "mapOpacity",
        label: "opacity",
        min: 0.05,
        max: 1,
        step: 0.01,
        live: true,
        description:
          "From above, overlapping translucent boxes read as a smear of density rather than " +
          "as a layout — and the layout is the only thing the map view is for.",
      },
      { kind: "color", key: "mapTint", label: "tint" },
      {
        kind: "slider",
        key: "mapMix",
        label: "tint mix",
        min: 0,
        max: 1,
        step: 0.01,
        live: true,
        description: "How far the map folds the role colours into one, so the plan reads as a plan.",
      },
    ],
  },
];
