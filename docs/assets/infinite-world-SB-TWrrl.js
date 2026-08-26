import{D as e,Dn as t,Gr as n,Hr as r,It as i,Jn as a,Lr as o,Nn as ee,On as te,Pr as ne,Rt as re,Vn as ie,Vr as ae,_r as oe,fn as se,fr as ce,ir as le,pn as ue,pr as s,r as c,si as de,wn as fe}from"./wordmark-CyNLsl1q.js";import{t as pe}from"./types-C9vZymIy.js";import{A as l,St as u,U as d,Vt as f,W as p,jt as m,q as h}from"./three.core-B85ZZh_6.js";import{t as g}from"./scene-QpK-6DxV.js";import{t as me}from"./gpu-DtIj_R1e.js";import{t as he}from"./worldBinding-DGZr96Oe.js";import{n as ge,t as _e}from"./panel-B9zxXEj6.js";var ve=.35,ye=777;function be(){let e=new ie,t=e.add(se,{count:170,boundsMin:[-800,0,-800],boundsMax:[800,0,800]}),r=e.add(ee,{name:`scale`,tupleSize:3,value:(()=>{let e=o(n(`mega`),0,1,5,13);return ae(e,ne(e,1.6),e)})()}),i=e.add(re,{assetId:`megarock`});return e.connect(t,`out`,r,`in`),e.connect(r,`out`,i,`in`),e.output(i,`instances`,`instances`),{name:`landmarks`,cellSize:`unbounded`,generationRadius:1/0,graph:e,bind(e,n){e.setParam(t,`seed`,n.seed),e.setParam(r,`seed`,de(n.seed,9))}}}function xe(e){let{cellSize:i,generationRadius:ce,anchored:s}=e,c=e.halo?4:0,l=new ie,u=s?l.add(ue,{density:ve,cellSize:7,latticeMode:`xz`,height:0}):l.add(se,{count:Math.round(ve*(i+2*c)**2)}),d=l.add(ee,{name:`density`,tupleSize:1,value:o(a(le,{seed:ye,frequency:.02,octaves:3}),-1,1,0,1)}),f=l.add(te,{mode:`probabilistic`}),p=l.add(fe,{radius:4,countAttr:`nbrCount`}),m=l.add(t,{mode:`inside`}),h=l.add(ee,{name:`scale`,tupleSize:3,value:(()=>{let e=o(oe(r(`nbrCount`),2,16),2,16,.4,1.35),t=ne(e,o(n(`rock`),0,1,.85,1.15));return ae(t,t,t)})()}),g=l.add(re,{assetId:`rock`});return l.connect(u,`out`,d,`in`),l.connect(d,`out`,f,`in`),l.connect(f,`out`,p,`in`),l.connect(p,`out`,m,`in`),l.connect(m,`out`,h,`in`),l.connect(h,`out`,g,`in`),l.output(g,`instances`,`instances`),{name:`rocks`,cellSize:i,generationRadius:ce,graph:l,bind(e,t){let{min:n,max:r}=pe(t);e.setParam(u,`boundsMin`,[n[0]-c,0,n[1]-c]),e.setParam(u,`boundsMax`,[r[0]+c,0,r[1]+c]);let i=s?t.worldSeed:t.seed;e.setParam(u,`seed`,i),e.setParam(f,`seed`,de(i,1)),e.setParam(h,`seed`,de(i,2)),e.setParam(m,`boundsMin`,[n[0],-1,n[1]]),e.setParam(m,`boundsMax`,[r[0],1,r[1]])}}}function Se(e){return e instanceof Error?e.message:String(e)}function Ce(e){let t=(e?.description??``)===``?e?.device:e?.description;return[e?.vendor,e?.architecture,t].filter(e=>typeof e==`string`&&e!==``).join(` · `)||`adapter (no info exposed)`}async function we(e){let t=navigator.gpu;if(t===void 0)return{error:`navigator.gpu is missing — this browser has no WebGPU.`};try{let n=await t.requestAdapter();if(n===null)return{error:`navigator.gpu.requestAdapter() returned null — no compatible GPU adapter.`};let r=n.info,i=await n.requestDevice(),a=i.lost;return a!==void 0&&a.then(t=>{e(`${t?.reason??`unknown`}: ${t?.message??`no detail`}`)}),{device:i,info:r,label:Ce(r)}}catch(e){return{error:`requestDevice() failed: ${Se(e)}`}}}function Te(e){let t=e.info===void 0?{}:{adapterInfo:e.info};return{derived:new me(e.device,{...t,acceptDerivedSpecs:!0}),strict:new me(e.device,t)}}var Ee=class{cacheSalt;residentTerminals;acceptDerivedSpecs;base;seen=new Set;constructor(e){this.base=e,this.cacheSalt=e.cacheSalt,this.residentTerminals=e.residentTerminals,this.acceptDerivedSpecs=e.acceptDerivedSpecs}resolveField(e,t,n){return n!==void 0&&this.seen.add(n),this.base.resolveField(e,t,n)}planRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.planRun(e,t,n)}executeRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.executeRun(e,t,n)}drain(){if(this.seen.size===0)return;let e=s();for(let t of this.seen){e.dispatches+=t.dispatches,e.pipelinesCompiled+=t.pipelinesCompiled,e.pipelineCacheHits+=t.pipelineCacheHits,e.residentRuns+=t.residentRuns,e.fusedNodes+=t.fusedNodes,e.readbacksSaved+=t.readbacksSaved;for(let[n,r]of Object.entries(t.fallbacks))e.fallbacks[n]=(e.fallbacks[n]??0)+r}return this.seen.clear(),e}};function De(e){let t=Object.entries(e).sort(([e],[t])=>e.localeCompare(t));return t.length===0?`none`:t.map(([e,t])=>`${e} ×${t}`).join(`, `)}var _=1,v=18,y=140,b=`gpu`,x=!0,S=20,C=!0,w=!0,T=!0,Oe=7,ke=12,Ae=8,je=5e3;function Me(e){return e instanceof Error?e.message:String(e)}var{scene:E,camera:D,start:Ne}=g({cameraPosition:[0,26,0],orbit:!1,fog:{near:140,far:640},far:1600}),Pe=new u(new f(4e3,4e3),new m({color:1449515,roughness:1}));Pe.rotation.x=-Math.PI/2,Pe.position.y=-.03,E.add(Pe);var Fe=40,O;function Ie(){O&&(E.remove(O),O.geometry.dispose(),O.material.dispose());let e=new d(S*Fe,Fe,4158656,2903936),t=e.material;t.transparent=!0,t.opacity=.45,t.depthWrite=!1,e.position.y=.02,e.visible=T,E.add(e),O=e}function Le(){!O||!O.visible||(O.position.x=Math.round(D.position.x/S)*S,O.position.z=Math.round(D.position.z/S)*S)}var Re=new m({color:8028816,roughness:.95,flatShading:!0}),ze=new m({color:6121077,roughness:1,flatShading:!0}),Be={megarock:{geometry:new l(1).translate(0,.62,0),material:ze},rock:{geometry:new h(.55).translate(0,.33,0),material:Re}},Ve,He,k=`requesting…`,A,j=!1,Ue=``,M;function N(){return Ve!==void 0&&!j}function We(){if(!(b===`cpu`||!N()))return x?Ve:He}var P;function Ge(e,t){let n=[{name:`landmarks`,graph:e},{name:`rocks`,graph:t}];P?P.set(n):P=_e(n,{into:_t,title:`infinite world`})}function Ke(e,t){let n=e*1.25/t+1.5;return Math.max(256,Math.ceil(Math.PI*n*n))}function qe(e){let t=0;for(let n of Object.keys(e))for(let r of e[n])if(r.kind===`instances`)for(let e of r.batches)t+=e.count;return t}var F,I=0,L,R=0,z=!1,Je=0;function B(){F&&(F.disposed=!0,F.abort.abort(),F.binding.dispose(),E.remove(F.group));let e=new p;E.add(e);let t=new he({group:e,assets:Be}),n=new Map,r=We(),a={world:void 0,group:e,binding:t,cellInstances:n,tap:r===void 0?void 0:new Ee(r),abort:new AbortController,disposed:!1},o=[be(),xe({cellSize:S,generationRadius:y,anchored:C,halo:w})];Ge(o[0].graph,o[1].graph),a.world=new i({seed:_,levels:o,maxCellsPerLevel:Ke(y,S),...a.tap===void 0?{}:{gpu:a.tap},onCellReady:(e,r,i)=>{a.disposed||(t.cellReady(e,r,i),n.set(`${e}|${r[0]},${r[1]}`,qe(i)))},onCellEvicted:(e,r)=>{a.disposed||(t.cellEvicted(e,r),n.delete(`${e}|${r[0]},${r[1]}`))}}),F=a,I=0,M=void 0,L=void 0,gt(),Ye(a,ke)}function Ye(e,t){let n=++Je;$=!0,R=performance.now(),e.world.update([D.position.x,0,D.position.z],{budgetMs:t,maxCooksPerUpdate:Ae,signal:e.abort.signal,...e.tap===void 0?{}:{gpu:e.tap}}).then(t=>{if(e.disposed)return;I=t.pending,L=t.elapsedMs;let n=e.tap?.drain();n!==void 0&&(M=n),gt(),z&&(z=!1,Z(ht()))}).catch(t=>{t instanceof ce||(console.error(t),e.disposed||Z(`update failed: ${Me(t)}`))}).finally(()=>{n===Je&&($=!1)})}var V=0,Xe=0,H=new Set;window.addEventListener(`keydown`,e=>{let t=e.key.toLowerCase();if(t===`g`){tt(b===`gpu`?`cpu`:`gpu`);return}H.add(t)}),window.addEventListener(`keyup`,e=>H.delete(e.key.toLowerCase())),document.addEventListener(`visibilitychange`,()=>{document.visibilityState===`visible`&&(R=performance.now())});var U=ge({title:`infinite world`,info:`Unbounded landmark level + world-anchored rock cells streamed around a flying camera. Steer with A/D or arrow keys.`}),Ze=document.createElement(`style`);Ze.textContent=`
.pcg04-seg { display: flex; gap: 6px; margin: 4px 0 4px; }
.pcg04-seg button {
  flex: 1; padding: 6px 4px; cursor: pointer; border-radius: var(--ed-radius);
  border: 1px solid var(--ed-edge); background: var(--ed-well); color: var(--ed-ink-mid);
  font: 12px system-ui, sans-serif;
}
.pcg04-seg button:hover:not(:disabled) { border-color: var(--ed-accent); color: var(--ed-ink); }
.pcg04-seg button[aria-pressed="true"] { background: var(--ed-raised-hi); border-color: var(--ed-accent); color: var(--ed-ink-hi); }
.pcg04-seg button:disabled { opacity: 0.4; cursor: not-allowed; }
.pcg04-hint { margin: 0 0 10px; color: var(--ed-ink-faint); font-size: 11px; }
`,document.head.appendChild(Ze);var Qe=U.el.querySelector(`.pcg-stats`)?.previousElementSibling??U.el;U.addSeed(_,e=>{_=e,B()}),U.addSlider(`speed`,{min:0,max:80,step:1,value:v,format:e=>`${e} u/s`},e=>{v=e}),U.addSlider(`gen radius`,{min:60,max:240,step:10,value:y,format:e=>`${e} u`},e=>{y=e,B()}),U.addSlider(`cell size`,{min:20,max:80,step:20,value:S,format:e=>`${e} u`},e=>{S=e,Ie(),B()}),U.addCheckbox(`world-anchored`,C,e=>{C=e,mt(),B()}),U.addCheckbox(`halo (4 u)`,w,e=>{w=e,B()}),U.addCheckbox(`cell grid`,T,e=>{T=e,O&&(O.visible=e),Le()});var W=document.createElement(`div`);W.className=`pcg04-seg`;var G=document.createElement(`button`);G.type=`button`,G.textContent=`GPU per-node`;var K=document.createElement(`button`);K.type=`button`,K.textContent=`CPU`,W.append(G,K);var q=document.createElement(`p`);q.className=`pcg04-hint`,q.textContent=`G switches path · A/D or ←/→ steer`;var $e=document.createElement(`div`);$e.className=`pcg-row`;var et=document.createElement(`label`);et.textContent=`derived specs`;var J=document.createElement(`input`);J.type=`checkbox`,J.checked=x,J.addEventListener(`change`,()=>{x=J.checked,B()}),$e.append(et,J),Qe.prepend(W,q,$e);function tt(e){if(e!==b){if(e===`gpu`&&!N()){Z(j?Q():A??`GPU path not ready yet.`);return}b=e,Y(),B(),Z(ht())}}G.addEventListener(`click`,()=>tt(`gpu`)),K.addEventListener(`click`,()=>tt(`cpu`));function Y(){G.setAttribute(`aria-pressed`,String(b===`gpu`)),K.setAttribute(`aria-pressed`,String(b===`cpu`)),G.disabled=!N(),G.title=A===void 0?j?Q():``:A,J.disabled=!N()||b===`cpu`}var X=U.addStat(`adapter`),nt=U.addStat(`fps`),rt=U.addStat(`rock source`),it=U.addStat(`rock cells`),at=U.addStat(`cooked / evicted`),ot=U.addStat(`pending`),st=U.addStat(`instances`),ct=U.addStat(`position`),lt=U.addStat(`cook`),ut=U.addStat(`resident runs / fused members`),dt=U.addStat(`device dispatches`),ft=U.addStat(`gpu fallbacks`),pt=U.addStat(`status`);function Z(e){pt(e)}function mt(){rt(C?`pointScatterInWorld`:`pointScatterInBounds`)}function Q(){return`device lost (${Ue}) — the GPU path is disabled; reload for a fresh device`}function ht(){return j?Q():b===`cpu`?`CPU path — no resolver passed to the cook`:N()?x?`GPU per-node — combinator fields accepted via acceptDerivedSpecs`:`GPU per-node — acceptDerivedSpecs off, so every field falls back`:A??`requesting WebGPU adapter…`}function gt(){if(lt(L===void 0?`–`:`${L.toFixed(1)} ms`),M===void 0){ut(F?.tap===void 0?`– (no GPU resolver)`:`–`),dt(`–`),ft(`–`);return}ut(`${M.residentRuns} / ${M.fusedNodes}`),dt(String(M.dispatches)),ft(De(M.fallbacks))}var _t=U.addSlot();c(),U.addNote(`Drag “cell size”: the blue grid re-cells the world and the rocks do not move or resize. Untick “halo” to watch every border grow a band of undersized rocks, and “world-anchored” to watch the same drag re-roll the world from scratch.`);var vt=U.addCollapsible(`anchoring · what the fine level actually does`);vt.textContent=`pointScatterInWorld scatters over an INFINITE lattice fixed to
world coordinates and returns the points inside the query
window. Position and per-point seed are a pure function of the
node seed, the seed param, the lattice mode, the lattice cellSize
and the point's own lattice cell and index — never of the window.
Three consequences, and this page leans on all three:

  1  the window only SELECTS. Re-cell the world (the cell size
     slider) and the same rocks come back, because nothing in
     their derivation ever saw a cell.
  2  a halo is just a wider query. Each rock's SIZE comes from
     pointNeighborhood counting the rocks within 4 u of it,
     which does not stop at a border — so each cell queries
     itself grown by 4 u, measures over that, and only then
     clips back with filterByBounds. Both cells sharing a border
     derive the same points in the overlap and count the same
     neighbours, so a rock is the same size either way.
     A counted neighbourhood has a FINITE halo width, exactly
     the radius; a greedy op like selfPrune, whose verdict for
     one point depends on verdicts for others, has none, which
     is why size here is measured rather than competed for.
  3  a cell never asks a sibling for anything. It derives the
     halo from world coordinates, so cook order, eviction and
     which neighbours happen to be resident change nothing.

The lattice cellSize is 7 u here — the content's own scale,
deliberately NOT the World cell size. Tying the two would make
the world a function of the runtime's partitioning, which is
exactly what the cell size slider is there to disprove.

Downstream ops stay anchored because their randomness and their
orderings key on point IDENTITY (stored position bits plus the
per-point seed attribute), not on array index: filterByDensity's
probabilistic draw, pointNeighborhood's tie-break and summation
order, and randomField inside the scale field all decide the
same way for the same rock in whichever cell derived it, however
many points were filtered out of the array first.

bind therefore seeds those nodes from ctx.worldSeed, which is
cell-INVARIANT, and passes only the window per cell. It never
calls graph.setSeed: a per-cell whole-graph reseed reaches the
source's node seed too and quietly turns it back into a per-cell
scatter — still deterministic, no longer anchored.

Unticking "world-anchored" swaps in pointScatterInBounds over
the identical window, at the same expected population. Its
positions are a function OF the window, so the halo reproduces
nothing: every rock re-rolls when the partition changes, and
each cell measures its seams against neighbours the cell next
door has never heard of. Deterministic, still — and useless for
anything that has to see past its own bounds.`;var yt=U.addCollapsible(`diagnostics · why nothing fuses here`);yt.textContent=`resident runs / fused members reads 0 / 0 on BOTH paths, and
that is a property of these graphs, not of the device.

A device-resident run needs two or more ADJACENT fusable nodes.
Of the node types used here, only setAttribute declares a CHAIN
resident descriptor. The scatter sources, the two filters and
pointNeighborhood declare none, and spawnInstances declares a
TERMINAL one, which joins a run only when the resolver advertises
that kind in residentTerminals — this page does not (see 09).

  landmarks   scatter -> setAttribute -> spawnInstances
                         ^ lone fusable node: a run of one, so no run

  rocks       scatter -> setAttribute -> filterByDensity
                      -> pointNeighborhood -> filterByBounds
                      -> setAttribute -> spawnInstances
                         ^ two fusable nodes, three non-members
                           between them: two runs of one

Every member of a run must be element-count preserving on one
geometry in/out, which rules out filterByDensity and
filterByBounds outright. pointNeighborhood does preserve the
count, but it declares no resident descriptor — a spatial query
is not a per-element kernel — so it cannot be a member either.
The three of them are exactly what breaks the only chain here
that could have fused: delete them and the two setAttribute nodes
become a single 2-member run.

What acceptDerivedSpecs buys on this page is the PER-NODE path.
Every field in levels.ts is combinator-built (remap, vec, mul,
randomField, fbm(perlinNoise)), so each derives its spec rather
than having one authored via fieldFromJson:

  flag off   each field counts a "derived-spec" fallback and
             evaluates on the CPU -> 0 dispatches
  flag on    each field compiles to WGSL -> 1 dispatch per
             resolved field column

Field columns offered to the device per cook:
  landmarks   1   (the scale vec)
  rocks       2   (the density fbm, the scale vec)

Reading the numbers: "cook" is UpdateStats.elapsedMs, the wall time
of one budgeted update, which may cook several cells or none. World
discards each cell's CookStats, so the three counters under it are
summed from the CookStats.gpu objects captured by the resolver tap
over that same update, and hold their last non-empty value when an
update cooks nothing.`;function bt(e){j=!0,Ue=e,k=`device lost`,X(k),Z(Q()),Y(),b===`gpu`&&(b=`cpu`,Y(),B())}async function xt(){let e=await we(bt);if(`error`in e){A=e.error,k=`no WebGPU adapter`,X(k),b=`cpu`,Y(),Z(`${e.error} Running the CPU path.`);return}try{let t=Te(e);Ve=t.derived,He=t.strict}catch(e){A=`GpuFieldEvaluator construction failed: ${Me(e)}`,k=`evaluator unavailable`,X(k),b=`cpu`,Y(),Z(`${A} Running the CPU path.`);return}j||(k=e.label,X(k),Y(),Z(ht()),b===`gpu`&&B())}var $=!1,St=e(e=>nt(e));X(k),Z(`requesting WebGPU adapter…`),Y(),mt(),gt(),Ie(),B(),xt(),Ne(e=>{St(),Xe=(H.has(`a`)||H.has(`arrowleft`)?1:0)-(H.has(`d`)||H.has(`arrowright`)?1:0),V+=Xe*1.1*e,D.position.x+=Math.sin(V)*v*e,D.position.z+=Math.cos(V)*v*e,D.position.y=26,D.lookAt(D.position.x+Math.sin(V)*60,5,D.position.z+Math.cos(V)*60),Le();let t=F;if(t&&!$?Ye(t,Oe):$&&!z&&performance.now()-R>je&&(z=!0,Z(`a cook has been in flight for over 5 s — the GPU device may have been lost.`)),t){let e=t.world.stats(),n=e.levels.find(e=>e.name===`rocks`)?.cellCount??0;it(String(n)),at(`${e.totalCooked} / ${e.totalEvicted}`),ot(String(I));let r=0;for(let e of t.cellInstances.values())r+=e;st(String(r)),ct(`${D.position.x.toFixed(0)}, ${D.position.z.toFixed(0)}`)}});