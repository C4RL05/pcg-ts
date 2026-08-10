import{n as e,t}from"./mobile-DCLgnEZN.js";var n=!1;function r(){if(n)return;n=!0;let e=document.createElement(`style`);e.textContent=`
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
@media ${t} {
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
`,document.head.appendChild(e)}function i(t){r();let n=document.createElement(`div`);n.className=`pcg-overlay`;let i=document.createElement(`h1`);i.textContent=t.title;let a=document.createElement(`span`);a.className=`pcg-chevron`,a.textContent=`▾`,i.appendChild(a),n.appendChild(i),i.setAttribute(`role`,`button`),i.tabIndex=0;let o=()=>{i.setAttribute(`aria-expanded`,String(!n.classList.contains(`pcg-collapsed`)))},s=()=>{n.classList.toggle(`pcg-collapsed`),o()};i.addEventListener(`click`,s),i.addEventListener(`keydown`,e=>{(e.key===`Enter`||e.key===` `)&&(e.preventDefault(),s())});let c=e();if(c.matches&&n.classList.add(`pcg-collapsed`),c.addEventListener(`change`,e=>{n.classList.toggle(`pcg-collapsed`,e.matches),o()}),o(),t.info){let e=document.createElement(`p`);e.className=`pcg-info`,e.textContent=t.info,n.appendChild(e)}let l=document.createElement(`div`);n.appendChild(l);let u=document.createElement(`div`);u.className=`pcg-stats`,n.appendChild(u),document.body.appendChild(n);function d(e){let t=document.createElement(`div`);t.className=`pcg-row`;let n=document.createElement(`label`);return n.textContent=e,t.appendChild(n),l.appendChild(t),t}return{el:n,addSeed(e,t){let n=d(`seed`),r=document.createElement(`input`);r.type=`number`,r.step=`1`,r.value=String(e),r.addEventListener(`change`,()=>{let e=Math.floor(Number(r.value));Number.isFinite(e)&&t(e>>>0)}),n.appendChild(r)},addSlider(e,t,n){let r=d(e),i=document.createElement(`input`);i.type=`range`,i.min=String(t.min),i.max=String(t.max),i.step=String(t.step),i.value=String(t.value);let a=document.createElement(`span`);a.className=`pcg-val`;let o=t.format??(e=>String(e));a.textContent=o(t.value),i.addEventListener(`input`,()=>{let e=Number(i.value);a.textContent=o(e),n(e)}),r.appendChild(i),r.appendChild(a)},addSelect(e,t,n,r){let i=d(e),a=document.createElement(`select`);for(let e of t){let t=document.createElement(`option`);t.value=e.value,t.textContent=e.label,a.appendChild(t)}a.value=n,a.addEventListener(`change`,()=>r(a.value)),i.appendChild(a)},addCheckbox(e,t,n){let r=d(e),i=document.createElement(`input`);i.type=`checkbox`,i.checked=t,i.addEventListener(`change`,()=>n(i.checked)),r.appendChild(i)},addStat(e){let t=document.createElement(`div`);t.className=`pcg-stat`;let n=document.createElement(`span`);n.textContent=e;let r=document.createElement(`span`);return r.textContent=`–`,t.appendChild(n),t.appendChild(r),u.appendChild(t),e=>{r.textContent=String(e)}},addCollapsible(e,t=!1){let r=document.createElement(`details`);r.open=t;let i=document.createElement(`summary`);i.textContent=e,r.appendChild(i);let a=document.createElement(`pre`);return r.appendChild(a),n.appendChild(r),a},addNote(e){let t=document.createElement(`p`);t.className=`pcg-note`,t.textContent=e,n.appendChild(t)}}}export{i as t};