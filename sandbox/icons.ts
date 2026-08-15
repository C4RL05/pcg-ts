/**
 * One icon per node-registry CATEGORY, drawn in the top-left of every node
 * box.
 *
 * WHY SHAPE AND NOT COLOUR. The canvas' colour budget is spent elsewhere
 * (see the palette note in `index.html`): green marks the node being
 * edited, and two hues mark the two rare pin kinds. Category is a
 * ten-valued fact, and ten hues do not exist on this page — the site's
 * declared marks are six, and they span 8x in contrast against black, so
 * they are not ten equal-weight anything. Shape has no such ceiling. The
 * icon therefore spends NO colour and carries its identity entirely in
 * silhouette: it is grey, and which grey is decided by each of the two
 * places that draw it, not here. The node box pins it to `--sb-ink-mid`,
 * one step under the title's white, because a fill carries more mass than
 * a run of strokes at the same value; the node menu lets it inherit
 * `currentColor` so it is exactly as faint as the heading it sits in.
 * Neither is "the same colour as the text beside it" — they are two
 * different answers to the same question, and both are deliberate.
 *
 * The set was chosen as a SET: no two of these reduce to the same blob at
 * the size they are drawn (hexagon / plus / tilted slab / down-wedge /
 * long diagonal / portrait capsule / landscape slab / 2x2 dots / two bars
 * / horizontal arrow). Picking ten individually good icons and finding
 * out later that three of them are circles is the failure mode here.
 *
 * A category with no entry draws NO icon rather than a placeholder glyph.
 * A box with a blank corner reads as "this one has no category", which is
 * true; a question mark reads as "the icon failed to load", which is not.
 * The same applies to a type that declares no category at all, which the
 * registry permits for third-party registrations.
 *
 * PROVENANCE. Phosphor Icons, bold weight, `viewBox="0 0 256 256"`, taken
 * verbatim from https://github.com/phosphor-icons/core at
 * `assets/bold/<name>-bold.svg`. Phosphor's bold weight is distributed as
 * FILLED paths rather than strokes, which is what lets each one be a
 * single `d` that its caller only has to `fill`, with no stroke width to
 * rescale alongside the glyph. Every icon below was a single `<path>`
 * upstream, so nothing is concatenated.
 *
 * Licence: MIT, Copyright (c) 2023 Phosphor Icons. The notice ships with
 * the copies, which is this comment; no visible in-app credit is required.
 * Inlined rather than installed on purpose — the browser build takes no
 * runtime dependency for ten path strings.
 */

/** The coordinate system every path below is drawn in. */
export const ICON_VIEWBOX = "0 0 256 256";

export const CATEGORY_ICONS: Record<string, string> = {
  // cube — a closed hexagonal mass; the one solid volume, for the nodes
  // that make something out of nothing.
  source:
    "M225.6,62.64l-88-48.17a19.91,19.91,0,0,0-19.2,0l-88,48.17A20,20,0,0,0,20,80.19v95.62a20,20,0,0,0,10.4,17.55l88,48.17a19.89,19.89,0,0,0,19.2,0l88-48.17A20,20,0,0,0,236,175.81V80.19A20,20,0,0,0,225.6,62.64ZM128,36.57,200,76,128,115.4,56,76ZM44,96.79l72,39.4v76.67L44,173.44Zm96,116.07V136.19l72-39.4v76.65Z",
  // arrows-out-cardinal — a four-way plus, fully joined at every arm, for
  // the ops that move points around.
  "point op":
    "M87.51,64.49a12,12,0,0,1,0-17l32-32a12,12,0,0,1,17,0l32,32a12,12,0,0,1-17,17L140,53V96a12,12,0,0,1-24,0V53L104.49,64.49A12,12,0,0,1,87.51,64.49Zm64,127L140,203V160a12,12,0,0,0-24,0v43l-11.51-11.52a12,12,0,0,0-17,17l32,32a12,12,0,0,0,17,0l32-32a12,12,0,0,0-17-17Zm89-72-32-32a12,12,0,0,0-17,17L203,116H160a12,12,0,0,0,0,24h43l-11.52,11.51a12,12,0,0,0,17,17l32-32A12,12,0,0,0,240.49,119.51ZM53,140H96a12,12,0,0,0,0-24H53l11.52-11.51a12,12,0,1,0-17-17l-32,32a12,12,0,0,0,0,17l32,32a12,12,0,1,0,17-17Z",
  // tag — a pointed slab, and the only tilted mass in the set; an
  // attribute is a NAME stuck on something.
  attribute:
    "M246.15,133.18,146.83,33.86A19.85,19.85,0,0,0,132.69,28H40A12,12,0,0,0,28,40v92.69a19.85,19.85,0,0,0,5.86,14.14l99.32,99.32a20,20,0,0,0,28.28,0l84.69-84.69A20,20,0,0,0,246.15,133.18Zm-98.83,93.17L52,131V52h79l95.32,95.32ZM104,88A16,16,0,1,1,88,72,16,16,0,0,1,104,88Z",
  // funnel — wide at the top, narrow at the bottom; the only downward
  // wedge, and the shape of the operation itself.
  filter:
    "M234.29,47.91A20,20,0,0,0,216,36H40A20,20,0,0,0,25.2,69.45l.12.14L92,140.75V216a20,20,0,0,0,31.1,16.64l32-21.33A20,20,0,0,0,164,194.66V140.75l66.67-71.16.12-.14A20,20,0,0,0,234.29,47.91Zm-91,79.89A12,12,0,0,0,140,136v56.52l-24,16V136a12,12,0,0,0-3.25-8.2L49.23,60H206.77Z",
  // eyedropper — one long diagonal, the only icon on that axis, so it is
  // told apart by orientation before any detail resolves.
  sampler:
    "M228,67.24a39.77,39.77,0,0,0-12.51-28.52C199.91,24,174.71,24.5,159.29,39.93L142.48,56.84a28,28,0,0,0-35.64,3.29l-9,9a20,20,0,0,0-.73,27.49L48.9,144.84A43.76,43.76,0,0,0,37,185.28l-7.5,17.19a17.66,17.66,0,0,0,3.71,19.65,19.9,19.9,0,0,0,22.15,4.19l16.31-7.13a43.88,43.88,0,0,0,39.45-12.09l48.24-48.26a20,20,0,0,0,27.47-.73l9-9a28.06,28.06,0,0,0,3.26-35.72l17.23-17.33A39.69,39.69,0,0,0,228,67.24ZM94.15,190.11a20,20,0,0,1-20,5,11.93,11.93,0,0,0-8.32.47L57,199.38,60.69,191a12,12,0,0,0,.37-8.64,19.92,19.92,0,0,1,4.81-20.55l48.2-48.22,28.28,28.3Zm105.14-111-25.37,25.52a12,12,0,0,0,0,16.95l4.88,4.89a4,4,0,0,1,0,5.66l-6.14,6.15-55-55.05,6.14-6.14a4,4,0,0,1,5.65,0L134.35,82a12,12,0,0,0,8.49,3.51h0A12,12,0,0,0,151.34,82l24.94-25.08c6.3-6.3,16.48-6.63,22.71-.74a16,16,0,0,1,.3,23Z",
  // cylinder — the only portrait mass, and a surface swept around an
  // axis, which is what these two nodes build.
  surface:
    "M179.14,24.08C165.28,16.29,147.12,12,128,12S90.72,16.29,76.86,24.08C60.83,33.1,52,45.86,52,60V196c0,14.14,8.83,26.9,24.86,35.92C90.72,239.71,108.88,244,128,244s37.28-4.29,51.14-12.08c16-9,24.86-21.78,24.86-35.92V60C204,45.86,195.17,33.1,179.14,24.08ZM88.63,45c10.17-5.72,24.52-9,39.37-9s29.2,3.28,39.37,9c8,4.52,12.63,10,12.63,15s-4.6,10.48-12.63,15c-10.17,5.72-24.52,9-39.37,9s-29.2-3.28-39.37-9C80.6,70.48,76,65,76,60S80.6,49.52,88.63,45Zm78.74,166c-10.17,5.72-24.52,9-39.37,9s-29.2-3.28-39.37-9C80.6,206.48,76,201,76,196V95.4l.86.52C90.72,103.71,108.88,108,128,108s37.28-4.29,51.14-12.08l.86-.52V196C180,201,175.4,206.48,167.37,211Z",
  // folder — a landscape slab with a notched tab; a graph kept inside a
  // node is a container, and this is the container shape.
  composite:
    "M216,68H133.39l-26-29.29a20,20,0,0,0-15-6.71H40A20,20,0,0,0,20,52V200.62A19.41,19.41,0,0,0,39.38,220H216.89A19.13,19.13,0,0,0,236,200.89V88A20,20,0,0,0,216,68ZM44,56H90.61l10.67,12H44ZM212,196H44V92H212Z",
  // squares-four — many copies of one thing, which is what the spawner
  // emits. The 2x2 pattern survives even once the squares fill in.
  spawn:
    "M100,36H56A20,20,0,0,0,36,56v44a20,20,0,0,0,20,20h44a20,20,0,0,0,20-20V56A20,20,0,0,0,100,36ZM96,96H60V60H96ZM200,36H156a20,20,0,0,0-20,20v44a20,20,0,0,0,20,20h44a20,20,0,0,0,20-20V56A20,20,0,0,0,200,36Zm-4,60H160V60h36Zm-96,40H56a20,20,0,0,0-20,20v44a20,20,0,0,0,20,20h44a20,20,0,0,0,20-20V156A20,20,0,0,0,100,136Zm-4,60H60V160H96Zm104-60H156a20,20,0,0,0-20,20v44a20,20,0,0,0,20,20h44a20,20,0,0,0,20-20V156A20,20,0,0,0,200,136Zm-4,60H160V160h36Z",
  // equals — two fat bars with nothing to lose when downscaled; a
  // constant is a definition.
  value:
    "M228,160a12,12,0,0,1-12,12H40a12,12,0,0,1,0-24H216A12,12,0,0,1,228,160ZM40,108H216a12,12,0,0,0,0-24H40a12,12,0,0,0,0,24Z",
  // sign-in — an arrow entering a bracket, the only horizontal arrow; the
  // node exists to inject data from outside.
  io: "M144.49,136.49l-40,40a12,12,0,0,1-17-17L107,140H24a12,12,0,0,1,0-24h83L87.51,96.49a12,12,0,0,1,17-17l40,40A12,12,0,0,1,144.49,136.49ZM200,28H136a12,12,0,0,0,0,24h52V204H136a12,12,0,0,0,0,24h64a12,12,0,0,0,12-12V40A12,12,0,0,0,200,28Z",
};
