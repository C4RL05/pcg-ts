/**
 * Minimal overlay-panel factory shared by the examples: a fixed dark
 * panel with a title, plain-DOM controls (seed input, sliders, selects,
 * checkboxes), live stat lines, and collapsible <pre> sections. Per
 * project convention this stays plain DOM — anything richer (see the
 * fields playground) uses Svelte.
 */

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
  el.appendChild(h1);
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
