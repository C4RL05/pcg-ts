import{$i as e,Bi as t,C as n,Ci as r,Fi as i,Hi as a,Ii as o,Ji as s,Ki as c,Li as l,Mi as u,Ni as d,Oi as f,Pi as p,Qi as m,Ri as h,S as g,T as _,Ta as v,Ti as y,Ui as b,Vi as x,Xi as S,Yi as C,Zi as w,_ as T,a as E,aa as D,c as O,d as k,ea as A,g as j,h as M,hi as N,i as P,ia as F,ji as I,l as L,mi as R,na as z,oa as B,p as ee,pi as te,qi as V,s as H,sa as U,va as W,vi as G,w as K,wi as q,x as J,zi as Y}from"./wordmark-DlQk1LJM.js";var X=!1;function Z(){if(X)return;X=!0;let e=document.createElement(`style`);e.textContent=`
.pcg-overlay {
  position: fixed; top: 12px; left: 12px; z-index: 10;
  /* Stops SHORT OF THE BOTTOM, not 12px from it: the wordmark sits in this
     corner (see shared/wordmark.ts) and a panel long enough to reach the
     floor lands on top of it. 45px is the mark's 13, its own 12 of margin,
     the panel's 12 at the top, and 8 of air between the two. Every page
     that builds this overlay draws that mark, so there is no case where
     this reserves space for nothing. */
  width: 300px; max-height: calc(100vh - 45px); overflow-y: auto;
  /* The panel scrolls on the longer pages, and the platform's default bar
     is a bright slab down a surface that is otherwise pure black — the one
     part of this chrome nobody had styled, invisible until the surface
     under it stopped being blue-grey. */
  scrollbar-width: thin; scrollbar-color: var(--ed-edge) transparent;
  padding: 14px 16px; box-sizing: border-box;
  background: var(--ed-panel);
  border: 1px solid var(--ed-rule); border-radius: 10px;
  color: var(--ed-ink); font: 13px/1.45 system-ui, sans-serif;
  backdrop-filter: blur(6px);
}
.pcg-overlay h1 { margin: 0 0 2px; font-size: 15px; font-weight: 600; color: var(--ed-ink-hi); }
.pcg-overlay .pcg-info { margin: 0 0 10px; color: var(--ed-ink-dim); font-size: 12px; }
.pcg-overlay .pcg-row { display: flex; align-items: center; gap: 8px; margin: 7px 0; }
.pcg-overlay .pcg-row > label { flex: 0 0 96px; color: var(--ed-ink-mid); font-size: 12px; }
.pcg-overlay input[type="range"] { flex: 1; accent-color: var(--ed-accent); min-width: 0; }
.pcg-overlay input[type="number"] {
  width: 90px; padding: 3px 6px; box-sizing: border-box;
  background: var(--ed-well); color: var(--ed-ink); border: 1px solid var(--ed-edge); border-radius: 5px;
  font: 12px ui-monospace, monospace;
}
.pcg-overlay select {
  flex: 1; padding: 3px 6px; background: var(--ed-well); color: var(--ed-ink);
  border: 1px solid var(--ed-edge); border-radius: 5px; font: 12px system-ui, sans-serif;
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
  background: var(--ed-well); border: 1px solid var(--ed-rule); border-radius: 6px;
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
@media ${P} {
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
    background: var(--ed-solid); /* content scrolls under the sticky bar */
    cursor: pointer;
  }
  .pcg-overlay .pcg-chevron { display: inline-block; float: right; color: var(--ed-ink-dim); transition: transform 0.2s; }
  .pcg-overlay.pcg-collapsed { max-height: calc(48px + env(safe-area-inset-bottom)); overflow: hidden; }
  .pcg-overlay.pcg-collapsed .pcg-chevron { transform: rotate(180deg); }
}
`,document.head.appendChild(e)}function Q(e){Z();let t=document.createElement(`div`);t.className=`pcg-overlay`;let n=document.createElement(`h1`);n.textContent=e.title;let r=document.createElement(`span`);r.className=`pcg-chevron`,r.textContent=`▾`,n.appendChild(r),t.appendChild(n),n.setAttribute(`role`,`button`),n.tabIndex=0;let i=()=>{n.setAttribute(`aria-expanded`,String(!t.classList.contains(`pcg-collapsed`)))},a=()=>{t.classList.toggle(`pcg-collapsed`),i()};n.addEventListener(`click`,a),n.addEventListener(`keydown`,e=>{(e.key===`Enter`||e.key===` `)&&(e.preventDefault(),a())});let o=E();if(o.matches&&t.classList.add(`pcg-collapsed`),o.addEventListener(`change`,e=>{t.classList.toggle(`pcg-collapsed`,e.matches),i()}),i(),e.info){let n=document.createElement(`p`);n.className=`pcg-info`,n.textContent=e.info,t.appendChild(n)}let s=document.createElement(`div`);t.appendChild(s);let c=document.createElement(`div`);c.className=`pcg-stats`,t.appendChild(c),document.body.appendChild(t);function l(e){let t=document.createElement(`div`);t.className=`pcg-row`;let n=document.createElement(`label`);return n.textContent=e,t.appendChild(n),s.appendChild(t),t}return{el:t,addSeed(e,t){let n=l(`seed`),r=document.createElement(`input`);r.type=`number`,r.step=`1`,r.value=String(e),r.addEventListener(`change`,()=>{let e=Math.floor(Number(r.value));Number.isFinite(e)&&t(e>>>0)}),n.appendChild(r)},addSlider(e,t,n){let r=l(e),i=document.createElement(`input`);i.type=`range`,i.min=String(t.min),i.max=String(t.max),i.step=String(t.step),i.value=String(t.value);let a=document.createElement(`span`);a.className=`pcg-val`;let o=t.format??(e=>String(e));a.textContent=o(t.value),i.addEventListener(`input`,()=>{let e=Number(i.value);a.textContent=o(e),n(e)}),r.appendChild(i),r.appendChild(a)},addSelect(e,t,n,r){let i=l(e),a=document.createElement(`select`);for(let e of t){let t=document.createElement(`option`);t.value=e.value,t.textContent=e.label,a.appendChild(t)}a.value=n,a.addEventListener(`change`,()=>r(a.value)),i.appendChild(a)},addCheckbox(e,t,n){let r=l(e),i=document.createElement(`input`);i.type=`checkbox`,i.checked=t,i.addEventListener(`change`,()=>n(i.checked)),r.appendChild(i)},addStat(e){let t=document.createElement(`div`);t.className=`pcg-stat`;let n=document.createElement(`span`);n.textContent=e;let r=document.createElement(`span`);return r.textContent=`–`,t.appendChild(n),t.appendChild(r),c.appendChild(t),e=>{r.textContent=String(e)}},addCollapsible(e,n=!1){let r=document.createElement(`details`);r.open=n;let i=document.createElement(`summary`);i.textContent=e,r.appendChild(i);let a=document.createElement(`pre`);return r.appendChild(a),t.appendChild(r),a},addNote(e){let n=document.createElement(`p`);n.className=`pcg-note`,n.textContent=e,t.appendChild(n)},addSlot(){let e=document.createElement(`div`);return e.className=`pcg-slot`,t.appendChild(e),e}}}var ne=h(`<path class="edge-casing svelte-v559t8"></path><path></path>`,1),re=h(`<svg role="img"><g><!><!></g></svg>`);function $(t,n){D(n,!0);let l=R(n,`previews`,19,()=>new Map),u=R(n,`interactive`,3,!0),d=R(n,`label`,3,`node graph`),p=A(void 0),h=A(m({x:0,y:0,z:1})),g=null,_=z(()=>new Map([...l()].map(([e,t])=>[e,t.length]))),v=z(()=>new Map(n.nodes.map(e=>[e.id,e])));function y(e,t){return n.floor??j(e,t)}function E(){if(!b(p))return;let t=b(p).getBoundingClientRect();if(t.width===0||t.height===0)return;let r=k(n.nodes,b(_));e(h,ee(r,t,{floor:y(r,t),preferActual:u()}),!0)}function P(){if(!b(p))return;let t=k(n.nodes,b(_));e(h,t===null?{x:0,y:0,z:1}:L(1,t,b(p).getBoundingClientRect()),!0)}V(()=>{n.nodes,n.floor,u(),E()}),V(()=>{let e=b(p);if(!e)return;let t=new ResizeObserver(()=>E());return t.observe(e),()=>t.disconnect()});function B(t){if(!u()||!b(p))return;t.preventDefault();let r=b(p).getBoundingClientRect(),i=y(k(n.nodes,b(_)),r);e(h,M(b(h),r,t.clientX,t.clientY,t.deltaY,i),!0)}function te(e){!u()||e.button!==0||(g={px:e.clientX,py:e.clientY,ox:b(h).x,oy:b(h).y},b(p)?.setPointerCapture(e.pointerId))}function W(t){g&&e(h,{...b(h),x:g.ox+(t.clientX-g.px),y:g.oy+(t.clientY-g.py)},!0)}function K(){g=null}function J(){u()&&E()}var Y={fit:E,actualSize:P},X=re();a(`pointermove`,s,W),a(`pointerup`,s,K);let Z;var Q=C(X),$=C(Q);f($,17,()=>n.edges,e=>`${e.from}.${e.fromPin}->${e.to}.${e.toPin}`,(e,t)=>{let n=z(()=>O(b(v),b(t)));var r=o(),a=S(r),s=e=>{var r=ne(),a=S(r),o=w(a);c(e=>{G(a,`d`,b(n)),q(o,0,`edge-line k-${e??``}`,`svelte-v559t8`),G(o,`d`,b(n))},[()=>H(b(v),b(t))]),i(e,r)};I(a,e=>{b(n)&&e(s)}),i(e,r)});var ie=w($);return f(ie,17,()=>n.nodes,e=>e.id,(e,t)=>{{let n=z(()=>l().get(b(t).id));T(e,{get node(){return b(t)},get params(){return b(n)}})}}),U(Q),U(X),N(X,t=>e(p,t),()=>b(p)),c(e=>{Z=q(X,0,`view svelte-v559t8`,null,Z,{interactive:u()}),G(X,`aria-label`,d()),G(Q,`transform`,`translate(${b(h).x??``} ${b(h).y??``}) scale(${b(h).z??``})`),r(Q,`--hairline: ${e??``}`)},[()=>Math.max(1,1/b(h).z)]),a(`wheel`,X,B),x(`pointerdown`,X,te),x(`dblclick`,X,J),i(t,X),F(Y)}t([`pointerdown`,`dblclick`]);function ie(e){let t=e.parentNode;return document.body.appendChild(e),{destroy(){t&&e.parentNode===document.body&&t.appendChild(e),e.remove()}}}function ae(e){return typeof e==`object`&&!!e&&!Array.isArray(e)&&`fn`in e}function oe(e){if(ae(e))try{return`ƒ ${v(e).replace(/\s+/g,` `)}`}catch{return`ƒ`}return typeof e==`number`?J(e):typeof e==`boolean`?String(e):typeof e==`string`?e===``?`–`:e:Array.isArray(e)?e.length===0?`–`:e.map(e=>typeof e==`number`?J(e):String(e)).join(`, `):e==null?`–`:`…`}function se(e,t){try{return n(e.type)}catch{let n=e=>[...e??[]].map(e=>({name:e,kind:`any`,multi:!1}));return{inputs:n(t.inputs.get(e.id)),outputs:n(t.outputs.get(e.id))}}}function ce(e){let t=new Map,n=new Map,r=(e,t,n)=>{let r=e.get(t);r||e.set(t,r=new Set),r.add(n)};for(let i of e.connections??[])r(n,i.from[0],i.from[1]),r(t,i.to[0],i.to[1]);for(let t of e.outputs??[])r(n,t.id,t.pin);return{inputs:t,outputs:n}}function le(e){let t=ce(e),n=new Map,r=e.nodes.map(e=>{let r=se(e,t),i=g(e.type),a=Object.entries(e.params).map(([e,t])=>({key:e,value:oe(t),field:ae(t)}));return n.set(e.id,K(a)),{id:e.id,type:e.type,...e.ref===void 0?{}:{label:e.ref.name},...i===void 0?{}:{category:i},x:0,y:0,inputs:r.inputs,outputs:r.outputs}}),i=(e.connections??[]).map(e=>({from:e.from[0],fromPin:e.from[1],to:e.to[0],toPin:e.to[1]}));return _(r,i,new Map([...n].map(([e,t])=>[e,t.length]))),{nodes:r,edges:i,previews:n}}var ue=l(`<button type="button" role="tab"> </button>`),de=l(`<div class="tabs svelte-ul999b" role="tablist" aria-label="graphs"></div>`),fe=l(`<span class="heading svelte-ul999b"> </span>`),pe=l(`<p class="empty svelte-ul999b">This graph could not be laid out.</p>`),me=l(`<div class="backdrop svelte-ul999b" role="presentation"><div class="sheet svelte-ul999b" role="dialog" aria-modal="true"><header class="svelte-ul999b"><!> <span class="meta svelte-ul999b"><!></span> <button class="close svelte-ul999b" type="button" aria-label="close">✕</button></header> <div class="body svelte-ul999b"><!></div> <footer class="svelte-ul999b">scroll to zoom · drag to pan · double-click to fit · read-only</footer></div></div>`),he=l(`<div class="pcg-graph-panel svelte-ul999b"><button class="thumb svelte-ul999b" type="button"><span class="cap svelte-ul999b"><span class="name svelte-ul999b"> </span> <span class="count svelte-ul999b"><!></span></span> <span class="frame svelte-ul999b"><!></span></button></div> <!>`,1);function ge(t,n){D(n,!0);let r=R(n,`title`,3,`graph`),o=A(m(n.initial)),l=A(!1),u=A(0);function p(t){e(o,t,!0),b(u)>=t.length&&e(u,0),v()}let h=A(m([])),g=z(()=>b(h)[Math.min(b(u),b(h).length-1)]??null),_=z(()=>b(o)[Math.min(b(u),b(o).length-1)]?.name??``);function v(){e(h,b(o).map(e=>{try{return le(e.json)}catch{return null}}),!0)}te(v);function T(t){t.key===`Escape`&&b(l)&&(t.preventDefault(),e(l,!1))}var E={setGraphs:p},O=he();a(`keydown`,s,T);var k=S(O),j=C(k),M=C(j),N=C(M),P=C(N,!0);U(N);var L=w(N,2),ee=C(L),V=e=>{var t=Y();c(()=>d(t,`${b(g).nodes.length??``} nodes`)),i(e,t)},H=e=>{var t=Y(`…`);i(e,t)};I(ee,e=>{b(g)?e(V):e(H,-1)}),U(L),U(M);var W=w(M,2),K=C(W),J=e=>{$(e,{get nodes(){return b(g).nodes},get edges(){return b(g).edges},get previews(){return b(g).previews},interactive:!1,floor:.09,get label(){return`${b(_)??``} graph, thumbnail`}})};I(K,e=>{b(g)&&e(J)}),U(W),U(j),U(k);var X=w(k,2),Z=t=>{var n=me(),r=C(n),a=C(r),s=C(a),p=t=>{var n=de();f(n,23,()=>b(o),e=>e.name,(t,n,r)=>{var a=ue();let o;var s=C(a,!0);U(a),c(()=>{G(a,`aria-selected`,b(r)===b(u)),o=q(a,1,`svelte-ul999b`,null,o,{on:b(r)===b(u)}),d(s,b(n).name)}),x(`click`,a,()=>e(u,b(r),!0)),i(t,a)}),U(n),i(t,n)},m=e=>{var t=fe(),n=C(t,!0);U(t),c(()=>d(n,b(_))),i(e,t)};I(s,e=>{b(o).length>1?e(p):e(m,-1)});var h=w(s,2),v=C(h),S=e=>{var t=Y();c(()=>d(t,`${b(g).nodes.length??``} nodes · ${b(g).edges.length??``} connections`)),i(e,t)};I(v,e=>{b(g)&&e(S)}),U(h);var T=w(h,2);U(a);var E=w(a,2),D=C(E),O=e=>{$(e,{get nodes(){return b(g).nodes},get edges(){return b(g).edges},get previews(){return b(g).previews},get label(){return`${b(_)??``} graph`}})},k=e=>{var t=pe();i(e,t)};I(D,e=>{b(g)?e(O):e(k,-1)}),U(E),B(2),U(r),U(n),y(n,e=>ie?.(e)),c(()=>G(r,`aria-label`,`${b(_)??``} graph`)),x(`pointerdown`,n,t=>t.target===t.currentTarget&&e(l,!1)),x(`click`,T,()=>e(l,!1)),i(t,n)};return I(X,e=>{b(l)&&e(Z)}),c(()=>{G(j,`aria-label`,`show the ${(b(_)||r())??``} graph`),d(P,b(_)||r())}),x(`click`,j,()=>e(l,!0)),i(t,O),F(E)}t([`click`,`pointerdown`]);function _e(e){let t=[];for(let n of e)try{t.push({name:n.name,json:W(n.graph)})}catch(e){console.warn(`graph panel: "${n.name}" could not be serialized, so it is not shown`,e)}return t}function ve(e,t){let n=document.createElement(`div`);t.into.appendChild(n);let r=u(ge,{target:n,props:{initial:_e(e),title:t.title??`graph`}}),i=r;return{set(e){i.setGraphs(_e(e))},destroy(){p(r),n.remove()}}}export{Q as n,ve as t};