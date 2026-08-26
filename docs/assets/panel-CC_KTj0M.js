import{$ as e,A as t,At as n,B as r,C as i,Dt as a,J as o,Mt as s,N as c,Nt as l,O as u,Ot as ee,Q as d,R as f,S as p,St as m,T as h,W as g,Xt as _,Y as te,Z as v,_ as y,_t as b,a as x,bt as S,c as C,ct as w,d as T,et as E,g as D,gt as O,h as k,ht as A,i as j,in as M,it as N,jt as ne,k as P,kt as re,l as F,lt as I,mt as L,nt as R,ot as z,p as ie,pt as B,q as V,rt as H,s as ae,st as U,tt as oe,ut as W,vt as G,w as K,wt as q,x as J,xt as Y,yt as X,z as se}from"./wordmark-D_Ltmhfo.js";var Z=!1;function ce(){if(Z)return;Z=!0;let e=document.createElement(`style`);e.textContent=`
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
.pcg-overlay select {
  flex: 1; padding: 3px 6px; background: var(--ed-well); color: var(--ed-ink);
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
@media ${j} {
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
`,document.head.appendChild(e)}function le(e){ce();let t=document.createElement(`div`);t.className=`pcg-overlay`;let n=document.createElement(`h1`);n.textContent=e.title;let r=document.createElement(`span`);r.className=`pcg-chevron`,r.textContent=`▾`,n.appendChild(r),t.appendChild(n),n.setAttribute(`role`,`button`),n.tabIndex=0;let i=()=>{n.setAttribute(`aria-expanded`,String(!t.classList.contains(`pcg-collapsed`)))},a=()=>{t.classList.toggle(`pcg-collapsed`),i()};n.addEventListener(`click`,a),n.addEventListener(`keydown`,e=>{(e.key===`Enter`||e.key===` `)&&(e.preventDefault(),a())});let o=x();if(o.matches&&t.classList.add(`pcg-collapsed`),o.addEventListener(`change`,e=>{t.classList.toggle(`pcg-collapsed`,e.matches),i()}),i(),e.info){let n=document.createElement(`p`);n.className=`pcg-info`,n.textContent=e.info,t.appendChild(n)}let s=document.createElement(`div`);t.appendChild(s);let c=document.createElement(`div`);c.className=`pcg-stats`,t.appendChild(c),document.body.appendChild(t);function l(e){let t=document.createElement(`div`);t.className=`pcg-row`;let n=document.createElement(`label`);return n.textContent=e,t.appendChild(n),s.appendChild(t),t}function u(e,t){let n=document.createElement(`span`);n.className=`pcg-numbox`,n.appendChild(e);let r=document.createElement(`span`);r.className=`pcg-steps`;for(let[n,i,a]of[[-1,`−`,`decrease`],[1,`+`,`increase`]]){let o=document.createElement(`button`);o.type=`button`,o.tabIndex=-1,o.textContent=i,o.setAttribute(`aria-label`,a);let s,c,l=()=>{n>0?e.stepUp():e.stepDown(),t()},u=()=>{clearTimeout(s),clearInterval(c)};o.addEventListener(`pointerdown`,e=>{e.preventDefault(),l(),s=setTimeout(()=>{c=setInterval(l,60)},400)});for(let e of[`pointerup`,`pointerleave`,`pointercancel`])o.addEventListener(e,u);r.appendChild(o)}return n.appendChild(r),n}return{el:t,addSeed(e,t){let n=l(`seed`),r=document.createElement(`input`);r.type=`number`,r.step=`1`,r.min=`0`,r.value=String(e);let i=()=>{let e=Math.floor(r.valueAsNumber);Number.isFinite(e)&&t(e>>>0)};r.addEventListener(`change`,i),n.appendChild(u(r,i))},addSlider(e,t,n){let r=l(e),i=document.createElement(`input`);i.type=`range`,i.min=String(t.min),i.max=String(t.max),i.step=String(t.step),i.value=String(t.value);let a=document.createElement(`span`);a.className=`pcg-val`;let o=t.format??(e=>String(e));a.textContent=o(t.value);let s=e=>{let n=t.max-t.min,r=n>0?(e-t.min)/n:0;i.style.setProperty(`--p`,`${Math.min(1,Math.max(0,r))*100}%`)};s(t.value),i.addEventListener(`input`,()=>{let e=Number(i.value);a.textContent=o(e),s(e),n(e)}),r.appendChild(i),r.appendChild(a)},addSelect(e,t,n,r){let i=l(e),a=document.createElement(`select`);for(let e of t){let t=document.createElement(`option`);t.value=e.value,t.textContent=e.label,a.appendChild(t)}a.value=n,a.addEventListener(`change`,()=>r(a.value)),i.appendChild(a)},addCheckbox(e,t,n){let r=l(e),i=document.createElement(`input`);i.type=`checkbox`,i.checked=t,i.addEventListener(`change`,()=>n(i.checked)),r.appendChild(i)},addStat(e){let t=document.createElement(`div`);t.className=`pcg-stat`;let n=document.createElement(`span`);n.textContent=e;let r=document.createElement(`span`);return r.textContent=`–`,t.appendChild(n),t.appendChild(r),c.appendChild(t),e=>{r.textContent=String(e)}},addCollapsible(e,n=!1){let r=document.createElement(`details`);r.open=n;let i=document.createElement(`summary`);i.textContent=e,r.appendChild(i);let a=document.createElement(`pre`);return r.appendChild(a),t.appendChild(r),a},addNote(e){let n=document.createElement(`p`);n.className=`pcg-note`,n.textContent=e,t.appendChild(n)},addSlot(){let e=document.createElement(`div`);return e.className=`pcg-slot`,t.appendChild(e),e}}}Q[l]=`shared/graph/GraphView.svelte`;var ue=I(H(`<path class="edge-casing svelte-v559t8"></path><path></path>`,1),Q[l],[[193,8],[194,8]]),de=I(H(`<svg role="img"><g><!><!></g></svg>`),Q[l],[[171,0,[[185,2]]]]);function Q(e,r){o(new.target),re(r,!0,Q);let i=P(r,`previews`,19,()=>new Map),l=P(r,`interactive`,3,!0),u=P(r,`label`,3,`node graph`),d=n(m(void 0),`svgEl`),p=n(m(S({x:0,y:0,z:1})),`view`),h=null,_=n(q(()=>new Map([...i()].map(([e,t])=>[e,t.length]))),`rowCounts`),v=n(q(()=>new Map(r.nodes.map(e=>[e.id,e]))),`byId`);function x(e,t){return r.floor??D(e,t)}function j(){if(!W(d))return;let e=W(d).getBoundingClientRect();if(X(e.width,0)||X(e.height,0))return;let t=T(r.nodes,W(_));Y(p,ie(t,e,{floor:x(t,e),preferActual:l()}),!0)}function M(){if(!W(d))return;let e=T(r.nodes,W(_));Y(p,X(e,null)?{x:0,y:0,z:1}:F(1,e,W(d).getBoundingClientRect()),!0)}L(()=>{r.nodes,r.floor,l(),j()}),L(()=>{let e=W(d);if(!e)return;let t=new ResizeObserver(()=>j());return t.observe(e),()=>t.disconnect()});function N(e){if(!l()||!W(d))return;e.preventDefault();let t=W(d).getBoundingClientRect(),n=x(T(r.nodes,W(_)),t);Y(p,k(W(p),t,e.clientX,e.clientY,e.deltaY,n),!0)}function ne(e){!l()||X(e.button,0,!1)||(h={px:e.clientX,py:e.clientY,ox:W(p).x,oy:W(p).y},W(d)?.setPointerCapture(e.pointerId))}function I(e){h&&Y(p,{...W(p),x:h.ox+(e.clientX-h.px),y:h.oy+(e.clientY-h.py)},!0)}function R(){h=null}function z(){l()&&j()}var H={...te(),get fit(){return j},get actualSize(){return M}},K=de();w(`pointermove`,A,I),w(`pointerup`,A,R);let J;var Z=O(K),ce=O(Z);a(()=>g(ce,17,()=>r.edges,e=>`${e.from}.${e.fromPin}->${e.to}.${e.toPin}`,(e,t)=>{let r=n(q(()=>C(W(v),W(t))),`d`);W(r);var i=oe(),o=b(i),s=e=>{var n=ue(),i=b(n),a=G(i);B(e=>{c(i,`d`,W(r)),se(a,0,`edge-line k-${e??``}`,`svelte-v559t8`),c(a,`d`,W(r))},[()=>ae(W(v),W(t))]),E(e,n)};a(()=>V(o,e=>{W(r)&&e(s)}),`if`,Q,191,6),E(e,i)}),`each`,Q,189,4);var le=G(ce);return a(()=>g(le,17,()=>r.nodes,e=>e.id,(e,t)=>{{let n=q(()=>i().get(W(t).id));a(()=>y(e,{get node(){return W(t)},get params(){return W(n)}}),`component`,Q,198,6,{componentTag:`NodeBox`})}}),`each`,Q,197,4),s(Z),s(K),t(K,e=>Y(d,e),()=>W(d)),B(e=>{J=se(K,0,`view svelte-v559t8`,null,J,{interactive:l()}),c(K,`aria-label`,u()),c(Z,`transform`,`translate(${W(p).x??``} ${W(p).y??``}) scale(${W(p).z??``})`),f(Z,`--hairline: ${e??``}`)},[()=>Math.max(1,1/W(p).z)]),w(`wheel`,K,N),U(`pointerdown`,K,ne),U(`dblclick`,K,z),E(e,K),ee(H)}z([`pointerdown`,`dblclick`]);function fe(e){let t=e.parentNode;return document.body.appendChild(e),{destroy(){t&&e.parentNode===document.body&&t.appendChild(e),e.remove()}}}function pe(e){return typeof e==`object`&&!!e&&!Array.isArray(e)&&`fn`in e}function me(e){if(pe(e))try{return`ƒ ${M(e).replace(/\s+/g,` `)}`}catch{return`ƒ`}return typeof e==`number`?J(e):typeof e==`boolean`?String(e):typeof e==`string`?e===``?`–`:e:Array.isArray(e)?e.length===0?`–`:e.map(e=>typeof e==`number`?J(e):String(e)).join(`, `):e==null?`–`:`…`}function he(e,t){try{return i(e.type)}catch{let n=e=>[...e??[]].map(e=>({name:e,kind:`any`,multi:!1}));return{inputs:n(t.inputs.get(e.id)),outputs:n(t.outputs.get(e.id))}}}function ge(e){let t=new Map,n=new Map,r=(e,t,n)=>{let r=e.get(t);r||e.set(t,r=new Set),r.add(n)};for(let i of e.connections??[])r(n,i.from[0],i.from[1]),r(t,i.to[0],i.to[1]);for(let t of e.outputs??[])r(n,t.id,t.pin);return{inputs:t,outputs:n}}function _e(e){let t=ge(e),n=new Map,r=e.nodes.map(e=>{let r=he(e,t),i=p(e.type),a=Object.entries(e.params).map(([e,t])=>({key:e,value:me(t),field:pe(t)}));return n.set(e.id,K(a)),{id:e.id,type:e.type,...e.ref===void 0?{}:{label:e.ref.name},...i===void 0?{}:{category:i},x:0,y:0,inputs:r.inputs,outputs:r.outputs}}),i=(e.connections??[]).map(e=>({from:e.from[0],fromPin:e.from[1],to:e.to[0],toPin:e.to[1]}));return h(r,i,new Map([...n].map(([e,t])=>[e,t.length]))),{nodes:r,edges:i,previews:n}}$[l]=`shared/graph/GraphPanel.svelte`;var ve=I(R(`<button type="button" role="tab"> </button>`),$[l],[[187,14]]),ye=I(R(`<div class="tabs svelte-ul999b" role="tablist" aria-label="graphs"></div>`),$[l],[[185,10]]),be=I(R(`<span class="heading svelte-ul999b"> </span>`),$[l],[[197,10]]),xe=I(R(`<p class="empty svelte-ul999b">This graph could not be laid out.</p>`),$[l],[[215,10]]),Se=I(R(`<div class="backdrop svelte-ul999b" role="presentation"><div class="sheet svelte-ul999b" role="dialog" aria-modal="true"><header class="svelte-ul999b"><!> <span class="meta svelte-ul999b"><!></span> <button class="close svelte-ul999b" type="button" aria-label="close">✕</button></header> <div class="body svelte-ul999b"><!></div> <footer class="svelte-ul999b">scroll to zoom · drag to pan · double-click to fit · read-only</footer></div></div>`),$[l],[[176,2,[[182,4,[[183,6,[[199,8],[202,8]]],[206,6],[222,6]]]]]]),Ce=I(R(`<div class="pcg-graph-panel svelte-ul999b"><button class="thumb svelte-ul999b" type="button"><span class="cap svelte-ul999b"><span class="name svelte-ul999b"> </span> <span class="count svelte-ul999b"><!></span></span> <span class="frame svelte-ul999b"><!></span></button></div> <!>`,1),$[l],[[138,0,[[139,2,[[145,4,[[146,6],[147,6]]],[151,4]]]]]]);function $(e,t){o(new.target),re(t,!0,$);let i=P(t,`title`,3,`graph`),l=n(m(S(t.initial)),`graphs`),f=n(m(!1),`open`),p=n(m(0),`selected`);function h(e){Y(l,e,!0),W(p)>=e.length&&Y(p,0),x()}let _=n(m(S([])),`pictures`),v=n(q(()=>W(_)[Math.min(W(p),W(_).length-1)]??null),`current`),y=n(q(()=>W(l)[Math.min(W(p),W(l).length-1)]?.name??``),`currentName`);function x(){Y(_,W(l).map(e=>{try{return _e(e.json)}catch{return null}}),!0)}u(x);function C(e){X(e.key,`Escape`)&&W(f)&&(e.preventDefault(),Y(f,!1))}var T={...te(),get setGraphs(){return h}},D=Ce();w(`keydown`,A,C);var k=b(D),j=O(k),M=O(j),F=O(M),I=O(F,!0);s(F);var L=G(F,2),R=O(L),z=e=>{var t=N();B(()=>d(t,`${W(v).nodes.length??``} nodes`)),E(e,t)},ie=e=>{var t=N(`…`);E(e,t)};a(()=>V(R,e=>{W(v)?e(z):e(ie,-1)}),`if`,$,148,8),s(L),s(M);var H=G(M,2),ae=O(H),oe=e=>{a(()=>Q(e,{get nodes(){return W(v).nodes},get edges(){return W(v).edges},get previews(){return W(v).previews},interactive:!1,floor:.09,get label(){return`${W(y)??``} graph, thumbnail`}}),`component`,$,153,8,{componentTag:`GraphView`})};a(()=>V(ae,e=>{W(v)&&e(oe)}),`if`,$,152,6),s(H),s(j),s(k);var K=G(k,2),J=e=>{var t=Se(),n=O(t),i=O(n),o=O(i),u=e=>{var t=ye();a(()=>g(t,23,()=>W(l),e=>e.name,(e,t,n)=>{var r=ve();let i;var a=O(r,!0);s(r),B(()=>{c(r,`aria-selected`,X(W(n),W(p))),i=se(r,1,`svelte-ul999b`,null,i,{on:X(W(n),W(p))}),d(a,W(t).name)}),U(`click`,r,function(){return Y(p,W(n),!0)}),E(e,r)}),`each`,$,186,12),s(t),E(e,t)},ee=e=>{var t=be(),n=O(t,!0);s(t),B(()=>d(n,W(y))),E(e,t)};a(()=>V(o,e=>{W(l).length>1?e(u):e(ee,-1)}),`if`,$,184,8);var m=G(o,2),h=O(m),_=e=>{var t=N();B(()=>d(t,`${W(v).nodes.length??``} nodes · ${W(v).edges.length??``} connections`)),E(e,t)};a(()=>V(h,e=>{W(v)&&e(_)}),`if`,$,200,10),s(m);var te=G(m,2);s(i);var b=G(i,2),x=O(b),S=e=>{a(()=>Q(e,{get nodes(){return W(v).nodes},get edges(){return W(v).edges},get previews(){return W(v).previews},get label(){return`${W(y)??``} graph`}}),`component`,$,208,10,{componentTag:`GraphView`})},C=e=>{var t=xe();E(e,t)};a(()=>V(x,e=>{W(v)?e(S):e(C,-1)}),`if`,$,207,8),s(b),ne(2),s(n),s(t),r(t,e=>fe?.(e)),B(()=>c(n,`aria-label`,`${W(y)??``} graph`)),U(`pointerdown`,t,function(e){return X(e.target,e.currentTarget)&&Y(f,!1)}),U(`click`,te,function(){return Y(f,!1)}),E(e,t)};return a(()=>V(K,e=>{W(f)&&e(J)}),`if`,$,166,0),B(()=>{c(j,`aria-label`,`show the ${(W(y)||i())??``} graph`),d(I,W(y)||i())}),U(`click`,j,function(){return Y(f,!0)}),E(e,D),ee(T)}z([`click`,`pointerdown`]);function we(e){let t=[];for(let n of e)try{t.push({name:n.name,json:_(n.graph)})}catch(e){console.warn(`graph panel: "${n.name}" could not be serialized, so it is not shown`,e)}return t}function Te(t,n){let r=document.createElement(`div`);n.into.appendChild(r);let i=v($,{target:r,props:{initial:we(t),title:n.title??`graph`}}),a=i;return{set(e){a.setGraphs(we(e))},destroy(){e(i),r.remove()}}}export{le as n,Te as t};