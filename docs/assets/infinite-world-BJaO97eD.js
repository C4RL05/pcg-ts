import{$r as e,An as t,D as n,En as r,Fn as i,It as a,Qr as o,Rt as ee,Tr as te,Ur as ne,Wn as re,Zn as ie,_r as ae,hn as oe,kn as se,mn as ce,ni as le,qr as s,r as c,sr as ue,vi as l,vr as u}from"./wordmark-BQdiYzv9.js";import{t as de}from"./types-C9vZymIy.js";import{A as d,Ht as f,St as fe,U as p,W as pe,jt as m,q as h}from"./three.core-auuZCBBV.js";import{t as g}from"./scene-DOE2mmoN.js";import{t as me}from"./gpu-BkULYzXd.js";import{r as he}from"./three-DPycw-BW.js";import{n as ge,t as _e}from"./panel-wYNnXtTd.js";var ve=.35,ye=777;function be(){let e=new re,t=e.add(ce,{count:170,boundsMin:[-800,0,-800],boundsMax:[800,0,800]}),n=e.add(i,{name:`scale`,tupleSize:3,value:(()=>{let e=s(le(`mega`),0,1,5,13);return o(e,ne(e,1.6),e)})()}),r=e.add(ee,{assetId:`megarock`});return e.connect(t,`out`,n,`in`),e.connect(n,`out`,r,`in`),e.output(r,`instances`,`instances`),{name:`landmarks`,cellSize:`unbounded`,generationRadius:1/0,graph:e,bind(e,r){e.setParam(t,`seed`,r.seed),e.setParam(n,`seed`,l(r.seed,9))}}}function xe(n){let{cellSize:a,generationRadius:ae,anchored:c}=n,u=n.halo?4:0,d=new re,f=c?d.add(oe,{density:ve,cellSize:7,latticeMode:`xz`,height:0}):d.add(ce,{count:Math.round(ve*(a+2*u)**2)}),fe=d.add(i,{name:`density`,tupleSize:1,value:s(ie(ue,{seed:ye,frequency:.02,octaves:3}),-1,1,0,1)}),p=d.add(t,{mode:`probabilistic`}),pe=d.add(r,{radius:4,countAttr:`nbrCount`}),m=d.add(se,{mode:`inside`}),h=d.add(i,{name:`scale`,tupleSize:3,value:(()=>{let t=s(te(e(`nbrCount`),2,16),2,16,.4,1.35),n=ne(t,s(le(`rock`),0,1,.85,1.15));return o(n,n,n)})()}),g=d.add(ee,{assetId:`rock`});return d.connect(f,`out`,fe,`in`),d.connect(fe,`out`,p,`in`),d.connect(p,`out`,pe,`in`),d.connect(pe,`out`,m,`in`),d.connect(m,`out`,h,`in`),d.connect(h,`out`,g,`in`),d.output(g,`instances`,`instances`),{name:`rocks`,cellSize:a,generationRadius:ae,graph:d,bind(e,t){let{min:n,max:r}=de(t);e.setParam(f,`boundsMin`,[n[0]-u,0,n[1]-u]),e.setParam(f,`boundsMax`,[r[0]+u,0,r[1]+u]);let i=c?t.worldSeed:t.seed;e.setParam(f,`seed`,i),e.setParam(p,`seed`,l(i,1)),e.setParam(h,`seed`,l(i,2)),e.setParam(m,`boundsMin`,[n[0],-1,n[1]]),e.setParam(m,`boundsMax`,[r[0],1,r[1]])}}}function Se(e){return e instanceof Error?e.message:String(e)}function Ce(e){let t=(e?.description??``)===``?e?.device:e?.description;return[e?.vendor,e?.architecture,t].filter(e=>typeof e==`string`&&e!==``).join(` · `)||`adapter (no info exposed)`}async function we(e){let t=navigator.gpu;if(t===void 0)return{error:`navigator.gpu is missing — this browser has no WebGPU.`};try{let n=await t.requestAdapter();if(n===null)return{error:`navigator.gpu.requestAdapter() returned null — no compatible GPU adapter.`};let r=n.info,i=await n.requestDevice(),a=i.lost;return a!==void 0&&a.then(t=>{e(`${t?.reason??`unknown`}: ${t?.message??`no detail`}`)}),{device:i,info:r,label:Ce(r)}}catch(e){return{error:`requestDevice() failed: ${Se(e)}`}}}function Te(e){let t=e.info===void 0?{}:{adapterInfo:e.info};return{derived:new me(e.device,{...t,acceptDerivedSpecs:!0}),strict:new me(e.device,t)}}var Ee=class{cacheSalt;residentTerminals;acceptDerivedSpecs;base;seen=new Set;constructor(e){this.base=e,this.cacheSalt=e.cacheSalt,this.residentTerminals=e.residentTerminals,this.acceptDerivedSpecs=e.acceptDerivedSpecs}resolveField(e,t,n){return n!==void 0&&this.seen.add(n),this.base.resolveField(e,t,n)}planRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.planRun(e,t,n)}executeRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.executeRun(e,t,n)}drain(){if(this.seen.size===0)return;let e=u();for(let t of this.seen){e.dispatches+=t.dispatches,e.pipelinesCompiled+=t.pipelinesCompiled,e.pipelineCacheHits+=t.pipelineCacheHits,e.residentRuns+=t.residentRuns,e.fusedNodes+=t.fusedNodes,e.readbacksSaved+=t.readbacksSaved;for(let[n,r]of Object.entries(t.fallbacks))e.fallbacks[n]=(e.fallbacks[n]??0)+r}return this.seen.clear(),e}};function De(e){let t=Object.entries(e).sort(([e],[t])=>e.localeCompare(t));return t.length===0?`none`:t.map(([e,t])=>`${e} ×${t}`).join(`, `)}var Oe=1,_=18,v=140,y=`gpu`,b=!0,x=20,S=!0,C=!0,w=!0,ke=7,Ae=12,je=8,Me=5e3;function Ne(e){return e instanceof Error?e.message:String(e)}var{scene:T,camera:E,start:Pe}=g({cameraPosition:[0,26,0],orbit:!1,fog:{near:140,far:640},far:1600}),D=new fe(new f(4e3,4e3),new m({color:1449515,roughness:1}));D.rotation.x=-Math.PI/2,D.position.y=-.03,T.add(D);var Fe=40,O;function Ie(){O&&(T.remove(O),O.geometry.dispose(),O.material.dispose());let e=new p(x*Fe,Fe,4158656,2903936),t=e.material;t.transparent=!0,t.opacity=.45,t.depthWrite=!1,e.position.y=.02,e.visible=w,T.add(e),O=e}function Le(){!O||!O.visible||(O.position.x=Math.round(E.position.x/x)*x,O.position.z=Math.round(E.position.z/x)*x)}var Re=new m({color:8028816,roughness:.95,flatShading:!0}),ze=new m({color:6121077,roughness:1,flatShading:!0}),Be={megarock:{geometry:new d(1).translate(0,.62,0),material:ze},rock:{geometry:new h(.55).translate(0,.33,0),material:Re}},k,Ve,A=`requesting…`,j,M=!1,He=``,N;function P(){return k!==void 0&&!M}function Ue(){if(!(y===`cpu`||!P()))return b?k:Ve}var F;function We(e,t){let n=[{name:`landmarks`,graph:e},{name:`rocks`,graph:t}];F?F.set(n):F=_e(n,{into:_t,title:`infinite world`})}function Ge(e,t){let n=e*1.25/t+1.5;return Math.max(256,Math.ceil(Math.PI*n*n))}function Ke(e){let t=0;for(let n of Object.keys(e))for(let r of e[n])if(r.kind===`instances`)for(let e of r.batches)t+=e.count;return t}var I,L=0,R,z=0,B=!1,qe=0;function V(){I&&(I.disposed=!0,I.abort.abort(),I.binding.dispose(),T.remove(I.group));let e=new pe;T.add(e);let t=new he({group:e,assets:Be}),n=new Map,r=Ue(),i={world:void 0,group:e,binding:t,cellInstances:n,tap:r===void 0?void 0:new Ee(r),abort:new AbortController,disposed:!1},o=[be(),xe({cellSize:x,generationRadius:v,anchored:S,halo:C})];We(o[0].graph,o[1].graph),i.world=new a({seed:Oe,levels:o,maxCellsPerLevel:Ge(v,x),...i.tap===void 0?{}:{gpu:i.tap},onCellReady:(e,r,a)=>{i.disposed||(t.cellReady(e,r,a),n.set(`${e}|${r[0]},${r[1]}`,Ke(a)))},onCellEvicted:(e,r)=>{i.disposed||(t.cellEvicted(e,r),n.delete(`${e}|${r[0]},${r[1]}`))}}),I=i,L=0,N=void 0,R=void 0,gt(),Je(i,Ae)}function Je(e,t){let n=++qe;$=!0,z=performance.now(),e.world.update([E.position.x,0,E.position.z],{budgetMs:t,maxCooksPerUpdate:je,signal:e.abort.signal,...e.tap===void 0?{}:{gpu:e.tap}}).then(t=>{if(e.disposed)return;L=t.pending,R=t.elapsedMs;let n=e.tap?.drain();n!==void 0&&(N=n),gt(),B&&(B=!1,Z(ht()))}).catch(t=>{t instanceof ae||(console.error(t),e.disposed||Z(`update failed: ${Ne(t)}`))}).finally(()=>{n===qe&&($=!1)})}var H=0,Ye=0,U=new Set;window.addEventListener(`keydown`,e=>{let t=e.key.toLowerCase();if(t===`g`){tt(y===`gpu`?`cpu`:`gpu`);return}U.add(t)}),window.addEventListener(`keyup`,e=>U.delete(e.key.toLowerCase())),document.addEventListener(`visibilitychange`,()=>{document.visibilityState===`visible`&&(z=performance.now())});var W=ge({title:`infinite world`,info:`Unbounded landmark level + world-anchored rock cells streamed around a flying camera. Steer with A/D or arrow keys.`}),Xe=document.createElement(`style`);Xe.textContent=`
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
`,document.head.appendChild(Xe);var Ze=W.el.querySelector(`.pcg-stats`)?.previousElementSibling??W.el;W.addSeed(Oe,e=>{Oe=e,V()}),W.addSlider(`speed`,{min:0,max:80,step:1,value:_,format:e=>`${e} u/s`},e=>{_=e}),W.addSlider(`gen radius`,{min:60,max:240,step:10,value:v,format:e=>`${e} u`},e=>{v=e,V()}),W.addSlider(`cell size`,{min:20,max:80,step:20,value:x,format:e=>`${e} u`},e=>{x=e,Ie(),V()}),W.addCheckbox(`world-anchored`,S,e=>{S=e,mt(),V()}),W.addCheckbox(`halo (4 u)`,C,e=>{C=e,V()}),W.addCheckbox(`cell grid`,w,e=>{w=e,O&&(O.visible=e),Le()});var G=document.createElement(`div`);G.className=`pcg04-seg`;var K=document.createElement(`button`);K.type=`button`,K.textContent=`GPU per-node`;var q=document.createElement(`button`);q.type=`button`,q.textContent=`CPU`,G.append(K,q);var Qe=document.createElement(`p`);Qe.className=`pcg04-hint`,Qe.textContent=`G switches path · A/D or ←/→ steer`;var $e=document.createElement(`div`);$e.className=`pcg-row`;var et=document.createElement(`label`);et.textContent=`derived specs`;var J=document.createElement(`input`);J.type=`checkbox`,J.checked=b,J.addEventListener(`change`,()=>{b=J.checked,V()}),$e.append(et,J),Ze.prepend(G,Qe,$e);function tt(e){if(e!==y){if(e===`gpu`&&!P()){Z(M?Q():j??`GPU path not ready yet.`);return}y=e,Y(),V(),Z(ht())}}K.addEventListener(`click`,()=>tt(`gpu`)),q.addEventListener(`click`,()=>tt(`cpu`));function Y(){K.setAttribute(`aria-pressed`,String(y===`gpu`)),q.setAttribute(`aria-pressed`,String(y===`cpu`)),K.disabled=!P(),K.title=j===void 0?M?Q():``:j,J.disabled=!P()||y===`cpu`}var X=W.addStat(`adapter`),nt=W.addStat(`fps`),rt=W.addStat(`rock source`),it=W.addStat(`rock cells`),at=W.addStat(`cooked / evicted`),ot=W.addStat(`pending`),st=W.addStat(`instances`),ct=W.addStat(`position`),lt=W.addStat(`cook`),ut=W.addStat(`resident runs / fused members`),dt=W.addStat(`device dispatches`),ft=W.addStat(`gpu fallbacks`),pt=W.addStat(`status`);function Z(e){pt(e)}function mt(){rt(S?`pointScatterInWorld`:`pointScatterInBounds`)}function Q(){return`device lost (${He}) — the GPU path is disabled; reload for a fresh device`}function ht(){return M?Q():y===`cpu`?`CPU path — no resolver passed to the cook`:P()?b?`GPU per-node — combinator fields accepted via acceptDerivedSpecs`:`GPU per-node — acceptDerivedSpecs off, so every field falls back`:j??`requesting WebGPU adapter…`}function gt(){if(lt(R===void 0?`–`:`${R.toFixed(1)} ms`),N===void 0){ut(I?.tap===void 0?`– (no GPU resolver)`:`–`),dt(`–`),ft(`–`);return}ut(`${N.residentRuns} / ${N.fusedNodes}`),dt(String(N.dispatches)),ft(De(N.fallbacks))}var _t=W.addSlot();c(),W.addNote(`Drag “cell size”: the blue grid re-cells the world and the rocks do not move or resize. Untick “halo” to watch every border grow a band of undersized rocks, and “world-anchored” to watch the same drag re-roll the world from scratch.`);var vt=W.addCollapsible(`anchoring · what the fine level actually does`);vt.textContent=`pointScatterInWorld scatters over an INFINITE lattice fixed to
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
anything that has to see past its own bounds.`;var yt=W.addCollapsible(`diagnostics · why nothing fuses here`);yt.textContent=`resident runs / fused members reads 0 / 0 on BOTH paths, and
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
update cooks nothing.`;function bt(e){M=!0,He=e,A=`device lost`,X(A),Z(Q()),Y(),y===`gpu`&&(y=`cpu`,Y(),V())}async function xt(){let e=await we(bt);if(`error`in e){j=e.error,A=`no WebGPU adapter`,X(A),y=`cpu`,Y(),Z(`${e.error} Running the CPU path.`);return}try{let t=Te(e);k=t.derived,Ve=t.strict}catch(e){j=`GpuFieldEvaluator construction failed: ${Ne(e)}`,A=`evaluator unavailable`,X(A),y=`cpu`,Y(),Z(`${j} Running the CPU path.`);return}M||(A=e.label,X(A),Y(),Z(ht()),y===`gpu`&&V())}var $=!1,St=n(e=>nt(e));X(A),Z(`requesting WebGPU adapter…`),Y(),mt(),gt(),Ie(),V(),xt(),Pe(e=>{St(),Ye=(U.has(`a`)||U.has(`arrowleft`)?1:0)-(U.has(`d`)||U.has(`arrowright`)?1:0),H+=Ye*1.1*e,E.position.x+=Math.sin(H)*_*e,E.position.z+=Math.cos(H)*_*e,E.position.y=26,E.lookAt(E.position.x+Math.sin(H)*60,5,E.position.z+Math.cos(H)*60),Le();let t=I;if(t&&!$?Je(t,ke):$&&!B&&performance.now()-z>Me&&(B=!0,Z(`a cook has been in flight for over 5 s — the GPU device may have been lost.`)),t){let e=t.world.stats(),n=e.levels.find(e=>e.name===`rocks`)?.cellCount??0;it(String(n)),at(`${e.totalCooked} / ${e.totalEvicted}`),ot(String(L));let r=0;for(let e of t.cellInstances.values())r+=e;st(String(r)),ct(`${E.position.x.toFixed(0)}, ${E.position.z.toFixed(0)}`)}});