<script lang="ts">
  /**
   * The look playground, as the demo's own panel.
   *
   * A THIN THING ON PURPOSE. `shared/Controls.svelte` already knows how a
   * row looks, when a drag has settled and which rows a gate hides; this
   * component owns only what is actually this page's: which section a
   * commit belongs to, whether it is cheap enough to follow the thumb,
   * and the two buttons the control kit has no kind for.
   *
   * THE VALUES RECORD IS THE SOURCE OF TRUTH FOR THE PANEL and the look is
   * the source of truth for the renderer, which is not a contradiction and
   * is the arrangement `Controls.svelte`'s own header describes: it holds
   * no copy of `values`, renders what it is given and hands edits back.
   * Every edit is written into the record and then, in the same tick, into
   * the live look — so the two can only disagree for the length of one
   * handler.
   */
  import Controls from "../../shared/Controls.svelte";
  import PanelShell from "../../shared/PanelShell.svelte";
  import { applyCommit, type ControlCommit } from "../../shared/controls.js";
  import { DEFAULT_PRESET, PRESETS, cloneLook, type Look } from "./look.js";
  import { LOOK_SECTIONS, RESTYLE_KEYS, readLook, writeLook, type LookValues } from "./lookPanel.js";

  let {
    look,
    preset = DEFAULT_PRESET.id,
    onRetint,
    onRestyle,
  }: {
    /** The live look. Mutated in place; never replaced. */
    look: Look;
    /** Which preset the host started from, for the select's initial value. */
    preset?: string;
    /** A colour or scalar moved: repaint, allocate nothing. */
    onRetint: () => void;
    /** A material class changed: rebuild. */
    onRestyle: () => void;
  } = $props();

  // READ ONCE, DELIBERATELY. The warning this suppresses is the right
  // warning for a prop that gets REPLACED, and `look` never is: the host
  // holds one object for the life of the page and mutates it in place,
  // precisely so that every material and light already holding the
  // reference keeps seeing the current values. A derived here would
  // re-snapshot the record on every edit and stomp a half-finished one.
  // svelte-ignore state_referenced_locally
  let values = $state<LookValues>(readLook(look, preset));
  let tab = $state("look");
  let copied = $state(false);

  /**
   * WHICH CALLBACK A COMMIT EARNS, and the check is on the KEY rather than
   * on the control kind. `surface` is a select and so is `preset`, but one
   * changes a material class and the other does not necessarily — a preset
   * that happens to share the current surface is a pure retint, and asking
   * `RESTYLE_KEYS` per key is what makes that fall out rather than needing
   * a special case.
   */
  function push(commit: ControlCommit<LookValues>): void {
    applyCommit(values, commit);
    if (commit.kind === "select" && commit.key === "preset") {
      loadPreset(commit.value);
      return;
    }
    const before = look.surface;
    const beforeMap = look.mapSurface;
    const beforeEdges = look.edges;
    writeLook(look, values);
    const structural =
      RESTYLE_KEYS.has(String(commit.key)) &&
      (look.surface !== before || look.mapSurface !== beforeMap || look.edges !== beforeEdges);
    if (structural) onRestyle();
    else onRetint();
  }

  /**
   * Load a whole look, and decide once whether it needs a rebuild.
   *
   * COMPARED RATHER THAN ASSUMED. Most presets differ from most others by
   * colour alone — `monument` and `x-ray` share a surface — and a
   * preset switch that always rebuilt would spend a second on a change
   * a repaint covers.
   */
  function loadPreset(id: string): void {
    const found = PRESETS.find((p) => p.id === id);
    if (!found) return;
    const structural =
      found.look.surface !== look.surface ||
      found.look.mapSurface !== look.mapSurface ||
      found.look.edges !== look.edges;
    const next = cloneLook(found.look);
    values = readLook(next, id);
    writeLook(look, values);
    if (structural) onRestyle();
    else onRetint();
  }

  /**
   * The look as JSON, so a setting found here can become a preset there.
   *
   * THE POINT OF THE WHOLE PANEL, in one button. A playground whose
   * answers can only be described in prose has to be re-found by whoever
   * reads the description; this hands back the literal object that
   * `look.ts` holds four of, ready to paste in beside them.
   */
  /**
   * Re-read the live look, for a change this panel did not make.
   *
   * THE PROBE IS THE ONLY CALLER and that is the whole reason it exists.
   * `window.pcgRacetrack.setLook` patches the look from outside — it is
   * how a capture asks for a named look without scraping Svelte rows by
   * label — and the panel holds its own record, so without this the two
   * silently disagree. It showed up as a screenshot of a black-and-white
   * x-ray lap with "monument / solid — lit" printed beside it, which is
   * the panel confidently describing a look that had been gone for
   * several seconds.
   *
   * NO CALLBACK BACK TO THE HOST. The host is where the change came from;
   * telling it again would be a second repaint of a picture that is
   * already correct.
   */
  export function sync(): void {
    values = readLook(look, values.preset);
  }

  async function copy(): Promise<void> {
    const text = JSON.stringify(look, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 1400);
    } catch {
      // A clipboard a page is not allowed to write is not an error worth
      // a dialog: the console is where the value is still recoverable
      // from, which is better than a message saying it is not.
      console.log(text);
      copied = true;
      setTimeout(() => (copied = false), 1400);
    }
  }
</script>

<!--
  ITS OWN CARD, NOT A SLOT IN THE READOUT PANEL, and that is a correction.
  This mounted through `Overlay.addSlot` first, which appends — so forty
  controls landed underneath eleven stat rows and a paragraph of prose,
  below the fold on any normal window. A tweaking tool you have to scroll
  to find is not a tweaking tool; the very first thing asked of it was
  "I thought you were doing a playground".

  `PanelShell` is the shell the Svelte panels were built to wear and had
  no wearer: fixed top-right, its own scroll, and a bottom sheet under
  `NARROW_MEDIA_QUERY`. The left overlay keeps the readouts and the graph
  thumbnail, which is what it is good at — a column of numbers to read
  rather than a surface to work on.
-->
<PanelShell title="look" width={312}>
  <div class="look">
    <Controls
      sections={LOOK_SECTIONS}
      {values}
      onInput={push}
      onCommit={push}
      bind:tab
      tabbed={true}
    />
    <div class="actions">
      <button type="button" onclick={() => loadPreset(values.preset)}>reset to preset</button>
      <button type="button" onclick={copy}>{copied ? "copied" : "copy JSON"}</button>
    </div>
  </div>
</PanelShell>

<style>
  .look {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .actions {
    display: flex;
    gap: 6px;
  }

  button {
    flex: 1;
    padding: 5px 8px;
    font: inherit;
    font-size: 11px;
    color: var(--ed-fg-dim, #b9b9c4);
    background: var(--ed-bg-raised, #1c1c22);
    border: 1px solid var(--ed-line, #33333d);
    border-radius: 4px;
    cursor: pointer;
  }

  button:hover {
    color: var(--ed-fg, #eceaf2);
    border-color: var(--ed-line-strong, #4a4a58);
  }
</style>
