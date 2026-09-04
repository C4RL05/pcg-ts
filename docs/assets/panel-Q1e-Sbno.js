import{$ as e,A as t,At as n,B as r,C as i,Ct as a,G as o,J as s,Mt as c,Nt as l,O as u,Ot as d,P as f,Pt as p,Q as m,S as h,St as g,T as _,Tt as v,V as y,X as b,Y as ee,Zt as x,_ as S,_t as C,a as w,an as T,at as E,bt as D,c as O,ct as k,d as A,dt as j,et as M,g as te,gt as N,h as P,ht as F,i as I,it as L,j as R,jt as z,kt as ne,l as re,lt as B,mt as V,nt as ie,p as ae,rt as H,s as oe,st as U,tt as W,ut as G,vt as K,w as q,x as J,xt as se,yt as Y,z as ce}from"./wordmark-1f_kjN-C.js";var X=!1;function Z(){if(X)return;X=!0;let e=document.createElement(`style`);e.textContent=`
.pcg-overlay {
  position: fixed; top: 12px; left: 12px; z-index: 10;
  /* Stops SHORT OF THE BOTTOM, not 12px from it: the wordmark sits in this
     corner (see shared/wordmark.ts) and a panel long enough to reach the
     floor lands on top of it. 45px is the mark's 13, its own 12 of margin,
     the panel's 12 at the top, and 8 of air between the two. Every page
     that builds this overlay draws that mark, so there is no case where
     this reserves space for nothing. */
  /* The bar this panel scrolls on is not styled here: the two scrollbar
     properties inherit, and tokens.css declares both on :root for every
     scrolling surface at once. See it for why they are the whole
     treatment. (No backticks in this comment, or in any other in this
     string: the whole stylesheet is one template literal.) */
  width: 300px; max-height: calc(100vh - 45px); overflow-y: auto;
  padding: 14px 16px; box-sizing: border-box;
  background: var(--ed-panel);
  border: 1px solid var(--ed-rule); border-radius: var(--ed-radius-lg);
  color: var(--ed-ink); font: 13px/1.45 system-ui, sans-serif;
  backdrop-filter: blur(6px);
}
.pcg-overlay h1 { margin: 0 0 2px; font-size: 15px; font-weight: 600; color: var(--ed-ink-hi); }
.pcg-overlay .pcg-info { margin: 0 0 10px; color: var(--ed-ink-dim); font-size: 12px; }
.pcg-overlay .pcg-row { display: flex; align-items: center; gap: 8px; margin: 7px 0; }
.pcg-overlay .pcg-row > label { flex: 0 0 96px; color: var(--ed-ink-mid); font-size: 12px; }
/* The slider: a solid bar filled to its value, and no thumb. Kept
   character for character in step with the same rule in
   shared/Controls.svelte — the two panels are one look built twice, this
   one in plain DOM and that one in Svelte, and a slider that differs
   between the demos and the editor is the seam showing. Both layers are
   painted on the input and both engine tracks are blanked, because
   neither engine's own parts can express a fill both of them draw:
   Firefox has ::-moz-range-progress and Chrome has nothing like it. The
   width comes from --p, set per element in addSlider. */
.pcg-overlay input[type="range"] {
  -webkit-appearance: none; appearance: none;
  flex: 1; min-width: 0; height: 16px; margin: 0;
  background-color: transparent;
  background-image:
    linear-gradient(var(--ed-slider-fill), var(--ed-slider-fill)),
    linear-gradient(var(--ed-slider-track), var(--ed-slider-track));
  background-repeat: no-repeat;
  background-position: left center, left center;
  background-size: var(--p, 0%) 8px, 100% 8px;
  cursor: ew-resize;
}
.pcg-overlay input[type="range"]::-webkit-slider-runnable-track { height: 100%; background: none; border: 0; }
.pcg-overlay input[type="range"]::-moz-range-track { height: 100%; background: none; border: 0; }
/* Transparent and one pixel wide rather than absent: a zero-width thumb
   loses the grab target on WebKit and display:none takes the drag with
   it. What the eye follows is the edge of the fill, which is where the
   thumb still is. */
.pcg-overlay input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 1px; height: 8px; margin-top: 4px;
  border: 0; border-radius: 0; background: transparent;
}
.pcg-overlay input[type="range"]::-moz-range-thumb {
  width: 1px; height: 8px; border: 0; border-radius: 0; background: transparent;
}
/* The default ring follows the thumb, which is now invisible and a pixel
   wide, so it goes around the whole track instead. */
.pcg-overlay input[type="range"]:focus { outline: none; }
.pcg-overlay input[type="range"]:focus-visible { outline: 1px solid var(--ed-focus); outline-offset: 3px; }
.pcg-overlay input[type="range"]:hover { filter: brightness(1.45); }
/* The number field and its stepper, kept in step with
   shared/NumberBox.svelte: minus and plus, square, the full height of
   the field, at its right edge, shown on hover. One look built twice for
   the same reason the slider is — this panel is plain DOM and that one
   is Svelte. The platform spinner cannot be reshaped into this (one box
   for both arrows on WebKit, nothing at all on Firefox), so it is hidden
   and replaced rather than restyled. */
.pcg-overlay .pcg-numbox { position: relative; display: inline-flex; width: 90px; }
.pcg-overlay input[type="number"] {
  width: 100%; padding: 3px 6px; box-sizing: border-box;
  background: var(--ed-well); color: var(--ed-ink); border: 1px solid var(--ed-edge); border-radius: var(--ed-radius);
  font: 12px ui-monospace, monospace;
}
.pcg-overlay input[type="number"]::-webkit-outer-spin-button,
.pcg-overlay input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.pcg-overlay input[type="number"] { -moz-appearance: textfield; appearance: textfield; }
.pcg-overlay .pcg-steps {
  position: absolute; top: 1px; right: 1px; bottom: 1px;
  display: flex; opacity: 0; pointer-events: none; transition: opacity 0.08s;
}
.pcg-overlay .pcg-numbox:hover .pcg-steps,
.pcg-overlay .pcg-numbox:focus-within .pcg-steps { opacity: 1; pointer-events: auto; }
.pcg-overlay .pcg-steps button {
  height: 100%; aspect-ratio: 1; padding: 0;
  display: grid; place-items: center;
  background: transparent; color: var(--ed-ink-mid);
  border: 0; border-radius: 0;
  font: 12px system-ui, sans-serif; line-height: 1; cursor: pointer; user-select: none;
}
/* At rest only the glyph: the field already has a border, and a plate
   inside it would be a second frame four pixels from the first. The
   fill arrives under the pointer, where it says which one you will hit. */
.pcg-overlay .pcg-steps button:hover { background: var(--ed-raised-hi); color: var(--ed-ink-hi); }
.pcg-overlay .pcg-steps button:active { background: var(--ed-edge); }
/* min-width: 0 is the load-bearing half of this rule, and the reason the
   panel had a horizontal scrollbar until 2026-08-29. A flex item's
   automatic minimum is its MIN-CONTENT width, and a select's min-content
   is its longest OPTION — not its selected one — so one long option in a
   list the row never shows at rest pushes the select past the panel's
   inner edge. The panel scrolls vertically, and per the overflow spec a
   visible overflow-x beside a non-visible overflow-y computes to auto:
   the bar appears with nothing visibly out of place to explain it. Its
   Svelte twin in shared/Controls.svelte carries the same declaration for
   the same reason; keep the two in step — this bug WAS the two drifting
   apart. This bounds the damage but does not do the caller's job: a
   label wider than the row now CLIPS instead of overflowing. At the
   300px width the row leaves the select 162px, and an option's padding,
   border and arrow eat ~34 of that, so the text itself has about 129px
   — roughly 20 characters of the 12px UI font. */
.pcg-overlay select {
  flex: 1; min-width: 0; padding: 3px 6px; background: var(--ed-well); color: var(--ed-ink);
  border: 1px solid var(--ed-edge); border-radius: var(--ed-radius); font: 12px system-ui, sans-serif;
}
.pcg-overlay input[type="checkbox"] { accent-color: var(--ed-accent); }
.pcg-overlay .pcg-val { flex: 0 0 44px; text-align: right; color: var(--ed-figure); font: 12px ui-monospace, monospace; }
.pcg-overlay .pcg-stats { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--ed-rule); }
/* Flex items default to min-width:auto, so a long value used to overrun the
   label. Wrap the row instead: when the pair does not fit, the value drops to
   its own right-aligned line rather than breaking "105.0 KiB" mid-number or
   clipping the label. */
.pcg-overlay .pcg-stat { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 0 10px; margin: 2px 0; }
.pcg-overlay .pcg-stat span:first-child { color: var(--ed-ink-dim); font-size: 12px; flex: 0 1 auto; min-width: 0; }
.pcg-overlay .pcg-stat span:last-child { color: var(--ed-figure); font: 12px ui-monospace, monospace; flex: 0 1 auto; margin-left: auto; min-width: 0; text-align: right; overflow-wrap: anywhere; }
.pcg-overlay details { margin-top: 10px; border-top: 1px solid var(--ed-rule); padding-top: 8px; }
.pcg-overlay summary { cursor: pointer; color: var(--ed-ink-mid); font-size: 12px; user-select: none; }
.pcg-overlay pre {
  margin: 8px 0 0; padding: 8px; max-height: 260px; overflow: auto;
  background: var(--ed-well); border: 1px solid var(--ed-rule); border-radius: var(--ed-radius);
  color: var(--ed-ink-mid); font: 11px/1.5 ui-monospace, monospace; white-space: pre;
}
.pcg-overlay .pcg-note { margin-top: 8px; color: var(--ed-ink-faint); font-size: 11px; }
/* A section the overlay does not draw itself. Same rule and spacing as
   .pcg-stats, so whatever fills it reads as part of the panel rather than as
   something sitting on top of it. */
.pcg-overlay .pcg-slot { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--ed-rule); }
/* The chevron only exists for the bottom-sheet layout below; on desktop the
   title is not a toggle, so the glyph stays hidden. */
.pcg-overlay .pcg-chevron { display: none; }
/* Below the shared breakpoint the panel becomes a full-width bottom sheet so
   the 3D content keeps the screen. Collapse is a max-height clip rather than
   display:none: the capture tooling scrapes .pcg-stat textContent for
   readiness, so the stat rows must stay in the DOM. */
@media ${I} {
  .pcg-overlay {
    top: auto; left: 0; right: 0; bottom: 0;
    width: auto; z-index: 12;
    max-height: 50vh;   /* fallback for pre-dvh browsers */
    max-height: 50dvh;
    border-radius: var(--ed-radius-lg) var(--ed-radius-lg) 0 0;
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
    background: var(--ed-solid); /* content scrolls under the sticky bar */
    cursor: pointer;
  }
  .pcg-overlay .pcg-chevron { display: inline-block; float: right; color: var(--ed-ink-dim); transition: transform 0.2s; }
  .pcg-overlay.pcg-collapsed { max-height: calc(48px + env(safe-area-inset-bottom)); overflow: hidden; }
  .pcg-overlay.pcg-collapsed .pcg-chevron { transform: rotate(180deg); }
}
`,document.head.appendChild(e)}function le(e){Z();let t=document.createElement(`div`);t.className=`pcg-overlay`;let n=document.createElement(`h1`);n.textContent=e.title;let r=document.createElement(`span`);r.className=`pcg-chevron`,r.textContent=`▾`,n.appendChild(r),t.appendChild(n),n.setAttribute(`role`,`button`),n.tabIndex=0;let i=()=>{n.setAttribute(`aria-expanded`,String(!t.classList.contains(`pcg-collapsed`)))},a=()=>{t.classList.toggle(`pcg-collapsed`),i()};n.addEventListener(`click`,a),n.addEventListener(`keydown`,e=>{(e.key===`Enter`||e.key===` `)&&(e.preventDefault(),a())});let o=w();if(o.matches&&t.classList.add(`pcg-collapsed`),o.addEventListener(`change`,e=>{t.classList.toggle(`pcg-collapsed`,e.matches),i()}),i(),e.info){let n=document.createElement(`p`);n.className=`pcg-info`,n.textContent=e.info,t.appendChild(n)}let s=document.createElement(`div`);t.appendChild(s);let c=document.createElement(`div`);c.className=`pcg-stats`,t.appendChild(c),document.body.appendChild(t);function l(e){let t=document.createElement(`div`);t.className=`pcg-row`;let n=document.createElement(`label`);return n.textContent=e,t.appendChild(n),s.appendChild(t),t}function u(e,t){let n=document.createElement(`span`);n.className=`pcg-numbox`,n.appendChild(e);let r=document.createElement(`span`);r.className=`pcg-steps`;for(let[n,i,a]of[[-1,`−`,`decrease`],[1,`+`,`increase`]]){let o=document.createElement(`button`);o.type=`button`,o.tabIndex=-1,o.textContent=i,o.setAttribute(`aria-label`,a);let s,c,l=()=>{n>0?e.stepUp():e.stepDown(),t()},u=()=>{clearTimeout(s),clearInterval(c)};o.addEventListener(`pointerdown`,e=>{e.preventDefault(),l(),s=setTimeout(()=>{c=setInterval(l,60)},400)});for(let e of[`pointerup`,`pointerleave`,`pointercancel`])o.addEventListener(e,u);r.appendChild(o)}return n.appendChild(r),n}return{el:t,addSeed(e,t){let n=l(`seed`),r=document.createElement(`input`);r.type=`number`,r.step=`1`,r.min=`0`,r.value=String(e);let i=()=>{let e=Math.floor(r.valueAsNumber);Number.isFinite(e)&&t(e>>>0)};r.addEventListener(`change`,i),n.appendChild(u(r,i))},addSlider(e,t,n){let r=l(e),i=document.createElement(`input`);i.type=`range`,i.min=String(t.min),i.max=String(t.max),i.step=String(t.step),i.value=String(t.value);let a=document.createElement(`span`);a.className=`pcg-val`;let o=t.format??(e=>String(e));a.textContent=o(t.value);let s=e=>{let n=t.max-t.min,r=n>0?(e-t.min)/n:0;i.style.setProperty(`--p`,`${Math.min(1,Math.max(0,r))*100}%`)};s(t.value),i.addEventListener(`input`,()=>{let e=Number(i.value);a.textContent=o(e),s(e),n(e)}),r.appendChild(i),r.appendChild(a)},addSelect(e,t,n,r){let i=l(e),a=document.createElement(`select`);for(let e of t){let t=document.createElement(`option`);t.value=e.value,t.textContent=e.label,a.appendChild(t)}a.value=n,a.addEventListener(`change`,()=>r(a.value)),i.appendChild(a)},addCheckbox(e,t,n){let r=l(e),i=document.createElement(`input`);i.type=`checkbox`,i.checked=t,i.addEventListener(`change`,()=>n(i.checked)),r.appendChild(i)},addStat(e){let t=document.createElement(`div`);t.className=`pcg-stat`;let n=document.createElement(`span`);n.textContent=e;let r=document.createElement(`span`);return r.textContent=`–`,t.appendChild(n),t.appendChild(r),c.appendChild(t),e=>{r.textContent=String(e)}},addCollapsible(e,n=!1){let r=document.createElement(`details`);r.open=n;let i=document.createElement(`summary`);i.textContent=e,r.appendChild(i);let a=document.createElement(`pre`);return r.appendChild(a),t.appendChild(r),a},addNote(e){let n=document.createElement(`p`);n.className=`pcg-note`,n.textContent=e,t.appendChild(n)},addSlot(){let e=document.createElement(`div`);return e.className=`pcg-slot`,t.appendChild(e),e}}}Q[p]=`shared/graph/GraphView.svelte`;var ue=G(L(`<path class="edge-casing svelte-v559t8"></path><path></path>`,1),Q[p],[[193,8],[194,8]]),de=G(L(`<svg role="img"><g><!><!></g></svg>`),Q[p],[[171,0,[[185,2]]]]);function Q(e,i){ee(new.target),n(i,!0,Q);let c=t(i,`previews`,19,()=>new Map),u=t(i,`interactive`,3,!0),p=t(i,`label`,3,`node graph`),m=z(a(void 0),`svgEl`),h=z(a(se({x:0,y:0,z:1})),`view`),_=null,y=z(v(()=>new Map([...c()].map(([e,t])=>[e,t.length]))),`rowCounts`),x=z(v(()=>new Map(i.nodes.map(e=>[e.id,e]))),`byId`);function w(e,t){return i.floor??te(e,t)}function T(){if(!j(m))return;let e=j(m).getBoundingClientRect();if(D(e.width,0)||D(e.height,0))return;let t=A(i.nodes,j(y));g(h,ae(t,e,{floor:w(t,e),preferActual:u()}),!0)}function E(){if(!j(m))return;let e=A(i.nodes,j(y));g(h,D(e,null)?{x:0,y:0,z:1}:re(1,e,j(m).getBoundingClientRect()),!0)}F(()=>{i.nodes,i.floor,u(),T()}),F(()=>{let e=j(m);if(!e)return;let t=new ResizeObserver(()=>T());return t.observe(e),()=>t.disconnect()});function M(e){if(!u()||!j(m))return;e.preventDefault();let t=j(m).getBoundingClientRect(),n=w(A(i.nodes,j(y)),t);g(h,P(j(h),t,e.clientX,e.clientY,e.deltaY,n),!0)}function I(e){!u()||D(e.button,0,!1)||(_={px:e.clientX,py:e.clientY,ox:j(h).x,oy:j(h).y},j(m)?.setPointerCapture(e.pointerId))}function L(e){_&&g(h,{...j(h),x:_.ox+(e.clientX-_.px),y:_.oy+(e.clientY-_.py)},!0)}function H(){_=null}function U(){u()&&T()}var G={...b(),get fit(){return T},get actualSize(){return E}},q=de();B(`pointermove`,N,L),B(`pointerup`,N,H);let J;var X=C(q),Z=C(X);d(()=>o(Z,17,()=>i.edges,e=>`${e.from}.${e.fromPin}->${e.to}.${e.toPin}`,(e,t)=>{let n=z(v(()=>O(j(x),j(t))),`d`);j(n);var i=ie(),a=K(i),o=e=>{var i=ue(),a=K(i),o=Y(a);V(e=>{f(a,`d`,j(n)),r(o,0,`edge-line k-${e??``}`,`svelte-v559t8`),f(o,`d`,j(n))},[()=>oe(j(x),j(t))]),W(e,i)};d(()=>s(a,e=>{j(n)&&e(o)}),`if`,Q,191,6),W(e,i)}),`each`,Q,189,4);var le=Y(Z);return d(()=>o(le,17,()=>i.nodes,e=>e.id,(e,t)=>{{let n=v(()=>c().get(j(t).id));d(()=>S(e,{get node(){return j(t)},get params(){return j(n)}}),`component`,Q,198,6,{componentTag:`NodeBox`})}}),`each`,Q,197,4),l(X),l(q),R(q,e=>g(m,e),()=>j(m)),V(e=>{J=r(q,0,`view svelte-v559t8`,null,J,{interactive:u()}),f(q,`aria-label`,p()),f(X,`transform`,`translate(${j(h).x??``} ${j(h).y??``}) scale(${j(h).z??``})`),ce(X,`--hairline: ${e??``}`)},[()=>Math.max(1,1/j(h).z)]),B(`wheel`,q,M),k(`pointerdown`,q,I),k(`dblclick`,q,U),W(e,q),ne(G)}U([`pointerdown`,`dblclick`]);function fe(e){let t=e.parentNode;return document.body.appendChild(e),{destroy(){t&&e.parentNode===document.body&&t.appendChild(e),e.remove()}}}function pe(e){return typeof e==`object`&&!!e&&!Array.isArray(e)&&`fn`in e}function me(e){if(pe(e))try{return`ƒ ${T(e).replace(/\s+/g,` `)}`}catch{return`ƒ`}return typeof e==`number`?J(e):typeof e==`boolean`?String(e):typeof e==`string`?e===``?`–`:e:Array.isArray(e)?e.length===0?`–`:e.map(e=>typeof e==`number`?J(e):String(e)).join(`, `):e==null?`–`:`…`}function he(e,t){try{return i(e.type)}catch{let n=e=>[...e??[]].map(e=>({name:e,kind:`any`,multi:!1}));return{inputs:n(t.inputs.get(e.id)),outputs:n(t.outputs.get(e.id))}}}function ge(e){let t=new Map,n=new Map,r=(e,t,n)=>{let r=e.get(t);r||e.set(t,r=new Set),r.add(n)};for(let i of e.connections??[])r(n,i.from[0],i.from[1]),r(t,i.to[0],i.to[1]);for(let t of e.outputs??[])r(n,t.id,t.pin);return{inputs:t,outputs:n}}function _e(e){let t=ge(e),n=new Map,r=e.nodes.map(e=>{let r=he(e,t),i=h(e.type),a=Object.entries(e.params).map(([e,t])=>({key:e,value:me(t),field:pe(t)}));return n.set(e.id,q(a)),{id:e.id,type:e.type,...e.ref===void 0?{}:{label:e.ref.name},...i===void 0?{}:{category:i},x:0,y:0,inputs:r.inputs,outputs:r.outputs}}),i=(e.connections??[]).map(e=>({from:e.from[0],fromPin:e.from[1],to:e.to[0],toPin:e.to[1]}));return _(r,i,new Map([...n].map(([e,t])=>[e,t.length]))),{nodes:r,edges:i,previews:n}}$[p]=`shared/graph/GraphPanel.svelte`;var ve=G(H(`<button type="button" role="tab"> </button>`),$[p],[[187,14]]),ye=G(H(`<div class="tabs svelte-ul999b" role="tablist" aria-label="graphs"></div>`),$[p],[[185,10]]),be=G(H(`<span class="heading svelte-ul999b"> </span>`),$[p],[[197,10]]),xe=G(H(`<p class="empty svelte-ul999b">This graph could not be laid out.</p>`),$[p],[[215,10]]),Se=G(H(`<div class="backdrop svelte-ul999b" role="presentation"><div class="sheet svelte-ul999b" role="dialog" aria-modal="true"><header class="svelte-ul999b"><!> <span class="meta svelte-ul999b"><!></span> <button class="close svelte-ul999b" type="button" aria-label="close">✕</button></header> <div class="body svelte-ul999b"><!></div> <footer class="svelte-ul999b">scroll to zoom · drag to pan · double-click to fit · read-only</footer></div></div>`),$[p],[[176,2,[[182,4,[[183,6,[[199,8],[202,8]]],[206,6],[222,6]]]]]]),Ce=G(H(`<div class="pcg-graph-panel svelte-ul999b"><button class="thumb svelte-ul999b" type="button"><span class="cap svelte-ul999b"><span class="name svelte-ul999b"> </span> <span class="count svelte-ul999b"><!></span></span> <span class="frame svelte-ul999b"><!></span></button></div> <!>`,1),$[p],[[138,0,[[139,2,[[145,4,[[146,6],[147,6]]],[151,4]]]]]]);function $(i,p){ee(new.target),n(p,!0,$);let m=t(p,`title`,3,`graph`),h=z(a(se(p.initial)),`graphs`),_=z(a(!1),`open`),x=z(a(0),`selected`);function S(e){g(h,e,!0),j(x)>=e.length&&g(x,0),A()}let w=z(a(se([])),`pictures`),T=z(v(()=>j(w)[Math.min(j(x),j(w).length-1)]??null),`current`),O=z(v(()=>j(h)[Math.min(j(x),j(h).length-1)]?.name??``),`currentName`);function A(){g(w,j(h).map(e=>{try{return _e(e.json)}catch{return null}}),!0)}u(A);function M(e){D(e.key,`Escape`)&&j(_)&&(e.preventDefault(),g(_,!1))}var te={...b(),get setGraphs(){return S}},P=Ce();B(`keydown`,N,M);var F=K(P),I=C(F),L=C(I),R=C(L),re=C(R,!0);l(R);var ie=Y(R,2),ae=C(ie),H=t=>{var n=E();V(()=>e(n,`${j(T).nodes.length??``} nodes`)),W(t,n)},oe=e=>{var t=E(`…`);W(e,t)};d(()=>s(ae,e=>{j(T)?e(H):e(oe,-1)}),`if`,$,148,8),l(ie),l(L);var U=Y(L,2),G=C(U),q=e=>{d(()=>Q(e,{get nodes(){return j(T).nodes},get edges(){return j(T).edges},get previews(){return j(T).previews},interactive:!1,floor:.09,get label(){return`${j(O)??``} graph, thumbnail`}}),`component`,$,153,8,{componentTag:`GraphView`})};d(()=>s(G,e=>{j(T)&&e(q)}),`if`,$,152,6),l(U),l(I),l(F);var J=Y(F,2),ce=t=>{var n=Se(),i=C(n),a=C(i),u=C(a),p=t=>{var n=ye();d(()=>o(n,23,()=>j(h),e=>e.name,(t,n,i)=>{var a=ve();let o;var s=C(a,!0);l(a),V(()=>{f(a,`aria-selected`,D(j(i),j(x))),o=r(a,1,`svelte-ul999b`,null,o,{on:D(j(i),j(x))}),e(s,j(n).name)}),k(`click`,a,function(){return g(x,j(i),!0)}),W(t,a)}),`each`,$,186,12),l(n),W(t,n)},m=t=>{var n=be(),r=C(n,!0);l(n),V(()=>e(r,j(O))),W(t,n)};d(()=>s(u,e=>{j(h).length>1?e(p):e(m,-1)}),`if`,$,184,8);var v=Y(u,2),b=C(v),ee=t=>{var n=E();V(()=>e(n,`${j(T).nodes.length??``} nodes · ${j(T).edges.length??``} connections`)),W(t,n)};d(()=>s(b,e=>{j(T)&&e(ee)}),`if`,$,200,10),l(v);var S=Y(v,2);l(a);var w=Y(a,2),A=C(w),M=e=>{d(()=>Q(e,{get nodes(){return j(T).nodes},get edges(){return j(T).edges},get previews(){return j(T).previews},get label(){return`${j(O)??``} graph`}}),`component`,$,208,10,{componentTag:`GraphView`})},te=e=>{var t=xe();W(e,t)};d(()=>s(A,e=>{j(T)?e(M):e(te,-1)}),`if`,$,207,8),l(w),c(2),l(i),l(n),y(n,e=>fe?.(e)),V(()=>f(i,`aria-label`,`${j(O)??``} graph`)),k(`pointerdown`,n,function(e){return D(e.target,e.currentTarget)&&g(_,!1)}),k(`click`,S,function(){return g(_,!1)}),W(t,n)};return d(()=>s(J,e=>{j(_)&&e(ce)}),`if`,$,166,0),V(()=>{f(I,`aria-label`,`show the ${(j(O)||m())??``} graph`),e(re,j(O)||m())}),k(`click`,I,function(){return g(_,!0)}),W(i,P),ne(te)}U([`click`,`pointerdown`]);function we(e){let t=[];for(let n of e)try{t.push({name:n.name,json:x(n.graph)})}catch(e){console.warn(`graph panel: "${n.name}" could not be serialized, so it is not shown`,e)}return t}function Te(e,t){let n=document.createElement(`div`);t.into.appendChild(n);let r=m($,{target:n,props:{initial:we(e),title:t.title??`graph`}}),i=r;return{set(e){i.setGraphs(we(e))},destroy(){M(r),n.remove()}}}export{le as n,Te as t};