/**
 * Minimal overlay-panel factory shared by the examples: a fixed dark
 * panel with a title, plain-DOM controls (seed input, sliders, selects,
 * checkboxes), live stat lines, and collapsible <pre> sections. Per
 * project convention this stays plain DOM — anything richer (see the
 * fields playground) uses Svelte. Below NARROW_MEDIA_QUERY the panel
 * becomes a full-width bottom sheet, collapsed to its title bar by
 * default; tapping the title expands it to a scrollable ~50dvh sheet.
 */

import { NARROW_MEDIA_QUERY, narrowScreen } from "./mobile.js";

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
.pcg-overlay {
  position: fixed; top: 12px; left: 12px; z-index: 10;
  width: 300px; max-height: calc(100vh - 24px); overflow-y: auto;
  padding: 14px 16px; box-sizing: border-box;
  background: rgba(13, 17, 23, 0.88);
  border: 1px solid #2a3548; border-radius: 10px;
  color: #dbe4f0; font: 13px/1.45 system-ui, sans-serif;
  backdrop-filter: blur(6px);
}
.pcg-overlay h1 { margin: 0 0 2px; font-size: 15px; font-weight: 600; color: #f0f4fa; }
.pcg-overlay .pcg-info { margin: 0 0 10px; color: #8b98ab; font-size: 12px; }
.pcg-overlay .pcg-row { display: flex; align-items: center; gap: 8px; margin: 7px 0; }
.pcg-overlay .pcg-row > label { flex: 0 0 96px; color: #aeb9c9; font-size: 12px; }
.pcg-overlay input[type="range"] { flex: 1; accent-color: #4c8dff; min-width: 0; }
.pcg-overlay input[type="number"] {
  width: 90px; padding: 3px 6px; box-sizing: border-box;
  background: #161d29; color: #dbe4f0; border: 1px solid #33405a; border-radius: 5px;
  font: 12px ui-monospace, monospace;
}
.pcg-overlay select {
  flex: 1; padding: 3px 6px; background: #161d29; color: #dbe4f0;
  border: 1px solid #33405a; border-radius: 5px; font: 12px system-ui, sans-serif;
}
.pcg-overlay input[type="checkbox"] { accent-color: #4c8dff; }
.pcg-overlay .pcg-val { flex: 0 0 44px; text-align: right; color: #8fd0ff; font: 12px ui-monospace, monospace; }
.pcg-overlay .pcg-stats { margin-top: 10px; padding-top: 8px; border-top: 1px solid #223047; }
/* Flex items default to min-width:auto, so a long value used to overrun the
   label. Wrap the row instead: when the pair does not fit, the value drops to
   its own right-aligned line rather than breaking "105.0 KiB" mid-number or
   clipping the label. */
.pcg-overlay .pcg-stat { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 0 10px; margin: 2px 0; }
.pcg-overlay .pcg-stat span:first-child { color: #8b98ab; font-size: 12px; flex: 0 1 auto; min-width: 0; }
.pcg-overlay .pcg-stat span:last-child { color: #b8f5c8; font: 12px ui-monospace, monospace; flex: 0 0 auto; margin-left: auto; min-width: 0; text-align: right; overflow-wrap: anywhere; }
.pcg-overlay details { margin-top: 10px; border-top: 1px solid #223047; padding-top: 8px; }
.pcg-overlay summary { cursor: pointer; color: #aeb9c9; font-size: 12px; user-select: none; }
.pcg-overlay pre {
  margin: 8px 0 0; padding: 8px; max-height: 260px; overflow: auto;
  background: #0a0e14; border: 1px solid #223047; border-radius: 6px;
  color: #9ecbff; font: 11px/1.5 ui-monospace, monospace; white-space: pre;
}
.pcg-overlay .pcg-note { margin-top: 8px; color: #6f7c8f; font-size: 11px; }
/* The chevron only exists for the bottom-sheet layout below; on desktop the
   title is not a toggle, so the glyph stays hidden. */
.pcg-overlay .pcg-chevron { display: none; }
/* Below the shared breakpoint the panel becomes a full-width bottom sheet so
   the 3D content keeps the screen. Collapse is a max-height clip rather than
   display:none: the capture tooling scrapes .pcg-stat textContent for
   readiness, so the stat rows must stay in the DOM. */
@media ${NARROW_MEDIA_QUERY} {
  .pcg-overlay {
    top: auto; left: 0; right: 0; bottom: 0;
    width: auto; z-index: 12;
    max-height: 50vh;   /* fallback for pre-dvh browsers */
    max-height: 50dvh;
    border-radius: 12px 12px 0 0;
    border-width: 1px 0 0 0;
    padding: 0 16px calc(10px + env(safe-area-inset-bottom));
    transition: max-height 0.25s ease;
    overscroll-behavior: contain;
  }
  .pcg-overlay h1 {
    position: sticky; top: 0; z-index: 1;
    margin: 0 -16px;                    /* full-bleed tap target */
    padding: 13px 16px;
    line-height: 22px;                  /* bar height: 22 + 2*13 = 48px */
    background: rgba(13, 17, 23, 0.96); /* content scrolls under the sticky bar */
    cursor: pointer;
  }
  .pcg-overlay .pcg-chevron { display: inline-block; float: right; color: #8b98ab; transition: transform 0.2s; }
  .pcg-overlay.pcg-collapsed { max-height: calc(48px + env(safe-area-inset-bottom)); overflow: hidden; }
  .pcg-overlay.pcg-collapsed .pcg-chevron { transform: rotate(180deg); }
}
`;
  document.head.appendChild(style);
}

/** The overlay panel handle. */
export interface Overlay {
  readonly el: HTMLElement;
  /** Numeric seed input; fires on change/Enter with the parsed value. */
  addSeed(initial: number, onChange: (seed: number) => void): void;
  addSlider(
    label: string,
    opts: { min: number; max: number; step: number; value: number; format?: (v: number) => string },
    onChange: (value: number) => void,
  ): void;
  addSelect(
    label: string,
    options: readonly { value: string; label: string }[],
    initial: string,
    onChange: (value: string) => void,
  ): void;
  addCheckbox(label: string, initial: boolean, onChange: (checked: boolean) => void): void;
  /** A labelled stat line; returns its setter. */
  addStat(label: string): (value: string | number) => void;
  /** A collapsible section holding a <pre>; returns the pre element. */
  addCollapsible(summary: string, open?: boolean): HTMLPreElement;
  addNote(text: string): void;
}

/** Create the overlay panel and attach it to the page. */
export function createOverlay(opts: { title: string; info?: string }): Overlay {
  injectStyles();
  const el = document.createElement("div");
  el.className = "pcg-overlay";
  const h1 = document.createElement("h1");
  h1.textContent = opts.title;
  /* The chevron lives inside the h1 (never as a sibling): some examples
     locate the controls container via .pcg-stats.previousElementSibling, so
     no element may come between the controls div and the stats div. */
  const chevron = document.createElement("span");
  chevron.className = "pcg-chevron";
  chevron.textContent = "▾";
  h1.appendChild(chevron);
  el.appendChild(h1);

  /* The title doubles as the bottom-sheet collapse toggle on narrow screens.
     The listeners are always attached; outside the media query the
     pcg-collapsed class has no visual effect, so desktop is unaffected. */
  h1.setAttribute("role", "button");
  h1.tabIndex = 0;
  const syncExpanded = (): void => {
    h1.setAttribute("aria-expanded", String(!el.classList.contains("pcg-collapsed")));
  };
  const toggle = (): void => {
    el.classList.toggle("pcg-collapsed");
    syncExpanded();
  };
  h1.addEventListener("click", toggle);
  h1.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      toggle();
    }
  });
  const narrow = narrowScreen();
  if (narrow.matches) el.classList.add("pcg-collapsed");
  /* Entering narrow collapses the sheet; leaving it clears the class so a
     rotation or resize never strands the desktop panel clipped. */
  narrow.addEventListener("change", (ev) => {
    el.classList.toggle("pcg-collapsed", ev.matches);
    syncExpanded();
  });
  syncExpanded();
  if (opts.info) {
    const p = document.createElement("p");
    p.className = "pcg-info";
    p.textContent = opts.info;
    el.appendChild(p);
  }
  const controls = document.createElement("div");
  el.appendChild(controls);
  const stats = document.createElement("div");
  stats.className = "pcg-stats";
  el.appendChild(stats);
  document.body.appendChild(el);

  function row(label: string): HTMLDivElement {
    const div = document.createElement("div");
    div.className = "pcg-row";
    const lab = document.createElement("label");
    lab.textContent = label;
    div.appendChild(lab);
    controls.appendChild(div);
    return div;
  }

  return {
    el,
    addSeed(initial, onChange) {
      const div = row("seed");
      const input = document.createElement("input");
      input.type = "number";
      input.step = "1";
      input.value = String(initial);
      input.addEventListener("change", () => {
        const v = Math.floor(Number(input.value));
        if (Number.isFinite(v)) onChange(v >>> 0);
      });
      div.appendChild(input);
    },
    addSlider(label, o, onChange) {
      const div = row(label);
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(o.min);
      input.max = String(o.max);
      input.step = String(o.step);
      input.value = String(o.value);
      const val = document.createElement("span");
      val.className = "pcg-val";
      const fmt = o.format ?? ((v: number) => String(v));
      val.textContent = fmt(o.value);
      input.addEventListener("input", () => {
        const v = Number(input.value);
        val.textContent = fmt(v);
        onChange(v);
      });
      div.appendChild(input);
      div.appendChild(val);
    },
    addSelect(label, options, initial, onChange) {
      const div = row(label);
      const select = document.createElement("select");
      for (const opt of options) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        select.appendChild(o);
      }
      select.value = initial;
      select.addEventListener("change", () => onChange(select.value));
      div.appendChild(select);
    },
    addCheckbox(label, initial, onChange) {
      const div = row(label);
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = initial;
      input.addEventListener("change", () => onChange(input.checked));
      div.appendChild(input);
    },
    addStat(label) {
      const line = document.createElement("div");
      line.className = "pcg-stat";
      const name = document.createElement("span");
      name.textContent = label;
      const value = document.createElement("span");
      value.textContent = "–";
      line.appendChild(name);
      line.appendChild(value);
      stats.appendChild(line);
      return (v) => {
        value.textContent = String(v);
      };
    },
    addCollapsible(summary, open = false) {
      const details = document.createElement("details");
      details.open = open;
      const sum = document.createElement("summary");
      sum.textContent = summary;
      details.appendChild(sum);
      const pre = document.createElement("pre");
      details.appendChild(pre);
      el.appendChild(details);
      return pre;
    },
    addNote(text) {
      const p = document.createElement("p");
      p.className = "pcg-note";
      p.textContent = text;
      el.appendChild(p);
    },
  };
}
