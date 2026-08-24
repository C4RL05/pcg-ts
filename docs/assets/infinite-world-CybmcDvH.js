import{$a as e,D as t,Fa as n,Ga as r,Ja as i,Lo as a,Mo as o,No as ee,Pa as te,Ss as s,Ya as ne,Yt as re,Zo as ie,_t as c,bt as l,da as ae,es as u,gt as d,in as f,is as oe,la as p,mn as se,mo as ce,os as le,r as m,rs as ue,rt as h,so as de,wo as fe}from"./wordmark-BS5KHLdi.js";import{t as pe}from"./types-C9vZymIy.js";import{t as g}from"./scene-DUWBWzzc.js";import{t as me}from"./gpu-Bq7IwNJW.js";import{t as he}from"./worldBinding-CzsvL1kZ.js";import{n as ge,t as _e}from"./panel-B07HmFCS.js";var ve=.35,ye=777;function be(){let t=new de,n=t.add(te,{count:170,boundsMin:[-800,0,-800],boundsMax:[800,0,800]}),r=t.add(e,{name:`scale`,tupleSize:3,value:(()=>{let e=u(le(`mega`),0,1,5,13);return ue(e,ie(e,1.6),e)})()}),i=t.add(ae,{assetId:`megarock`});return t.connect(n,`out`,r,`in`),t.connect(r,`out`,i,`in`),t.output(i,`instances`,`instances`),{name:`landmarks`,cellSize:`unbounded`,generationRadius:1/0,graph:t,bind(e,t){e.setParam(n,`seed`,t.seed),e.setParam(r,`seed`,s(t.seed,9))}}}function xe(t){let{cellSize:o,generationRadius:ee,anchored:re}=t,c=t.halo?4:0,l=new de,d=re?l.add(n,{density:ve,cellSize:7,latticeMode:`xz`,height:0}):l.add(te,{count:Math.round(ve*(o+2*c)**2)}),f=l.add(e,{name:`density`,tupleSize:1,value:u(ce(fe,{seed:ye,frequency:.02,octaves:3}),-1,1,0,1)}),p=l.add(ne,{mode:`probabilistic`}),se=l.add(r,{radius:4,countAttr:`nbrCount`}),m=l.add(i,{mode:`inside`}),h=l.add(e,{name:`scale`,tupleSize:3,value:(()=>{let e=u(a(oe(`nbrCount`),2,16),2,16,.4,1.35),t=ie(e,u(le(`rock`),0,1,.85,1.15));return ue(t,t,t)})()}),g=l.add(ae,{assetId:`rock`});return l.connect(d,`out`,f,`in`),l.connect(f,`out`,p,`in`),l.connect(p,`out`,se,`in`),l.connect(se,`out`,m,`in`),l.connect(m,`out`,h,`in`),l.connect(h,`out`,g,`in`),l.output(g,`instances`,`instances`),{name:`rocks`,cellSize:o,generationRadius:ee,graph:l,bind(e,t){let{min:n,max:r}=pe(t);e.setParam(d,`boundsMin`,[n[0]-c,0,n[1]-c]),e.setParam(d,`boundsMax`,[r[0]+c,0,r[1]+c]);let i=re?t.worldSeed:t.seed;e.setParam(d,`seed`,i),e.setParam(p,`seed`,s(i,1)),e.setParam(h,`seed`,s(i,2)),e.setParam(m,`boundsMin`,[n[0],-1,n[1]]),e.setParam(m,`boundsMax`,[r[0],1,r[1]])}}}function Se(e){return e instanceof Error?e.message:String(e)}function Ce(e){let t=(e?.description??``)===``?e?.device:e?.description;return[e?.vendor,e?.architecture,t].filter(e=>typeof e==`string`&&e!==``).join(` · `)||`adapter (no info exposed)`}async function we(e){let t=navigator.gpu;if(t===void 0)return{error:`navigator.gpu is missing — this browser has no WebGPU.`};try{let n=await t.requestAdapter();if(n===null)return{error:`navigator.gpu.requestAdapter() returned null — no compatible GPU adapter.`};let r=n.info,i=await n.requestDevice(),a=i.lost;return a!==void 0&&a.then(t=>{e(`${t?.reason??`unknown`}: ${t?.message??`no detail`}`)}),{device:i,info:r,label:Ce(r)}}catch(e){return{error:`requestDevice() failed: ${Se(e)}`}}}function Te(e){let t=e.info===void 0?{}:{adapterInfo:e.info};return{derived:new me(e.device,{...t,acceptDerivedSpecs:!0}),strict:new me(e.device,t)}}var Ee=class{cacheSalt;residentTerminals;acceptDerivedSpecs;base;seen=new Set;constructor(e){this.base=e,this.cacheSalt=e.cacheSalt,this.residentTerminals=e.residentTerminals,this.acceptDerivedSpecs=e.acceptDerivedSpecs}resolveField(e,t,n){return n!==void 0&&this.seen.add(n),this.base.resolveField(e,t,n)}planRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.planRun(e,t,n)}executeRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.executeRun(e,t,n)}drain(){if(this.seen.size===0)return;let e=ee();for(let t of this.seen){e.dispatches+=t.dispatches,e.pipelinesCompiled+=t.pipelinesCompiled,e.pipelineCacheHits+=t.pipelineCacheHits,e.residentRuns+=t.residentRuns,e.fusedNodes+=t.fusedNodes,e.readbacksSaved+=t.readbacksSaved;for(let[n,r]of Object.entries(t.fallbacks))e.fallbacks[n]=(e.fallbacks[n]??0)+r}return this.seen.clear(),e}};function De(e){let t=Object.entries(e).sort(([e],[t])=>e.localeCompare(t));return t.length===0?`none`:t.map(([e,t])=>`${e} ×${t}`).join(`, `)}var _=1,v=18,y=140,b=`gpu`,x=!0,S=20,C=!0,w=!0,T=!0,Oe=7,ke=12,Ae=8,je=5e3;function Me(e){return e instanceof Error?e.message:String(e)}var{scene:E,camera:D,start:Ne}=g({cameraPosition:[0,26,0],orbit:!1,fog:{near:140,far:640},far:1600}),O=new re(new se(4e3,4e3),new f({color:1449515,roughness:1}));O.rotation.x=-Math.PI/2,O.position.y=-.03,E.add(O);var Pe=40,k;function Fe(){k&&(E.remove(k),k.geometry.dispose(),k.material.dispose());let e=new d(S*Pe,Pe,4158656,2903936),t=e.material;t.transparent=!0,t.opacity=.45,t.depthWrite=!1,e.position.y=.02,e.visible=T,E.add(e),k=e}function Ie(){!k||!k.visible||(k.position.x=Math.round(D.position.x/S)*S,k.position.z=Math.round(D.position.z/S)*S)}var Le=new f({color:8028816,roughness:.95,flatShading:!0}),Re=new f({color:6121077,roughness:1,flatShading:!0}),ze={megarock:{geometry:new h(1).translate(0,.62,0),material:Re},rock:{geometry:new l(.55).translate(0,.33,0),material:Le}},A,Be,j=`requesting…`,M,N=!1,Ve=``,P;function F(){return A!==void 0&&!N}function He(){if(!(b===`cpu`||!F()))return x?A:Be}var I;function Ue(e,t){let n=[{name:`landmarks`,graph:e},{name:`rocks`,graph:t}];I?I.set(n):I=_e(n,{into:_t,title:`infinite world`})}function We(e,t){let n=e*1.25/t+1.5;return Math.max(256,Math.ceil(Math.PI*n*n))}function Ge(e){let t=0;for(let n of Object.keys(e))for(let r of e[n])if(r.kind===`instances`)for(let e of r.batches)t+=e.count;return t}var L,R=0,z,B=0,V=!1,Ke=0;function H(){L&&(L.disposed=!0,L.abort.abort(),L.binding.dispose(),E.remove(L.group));let e=new c;E.add(e);let t=new he({group:e,assets:ze}),n=new Map,r=He(),i={world:void 0,group:e,binding:t,cellInstances:n,tap:r===void 0?void 0:new Ee(r),abort:new AbortController,disposed:!1},a=[be(),xe({cellSize:S,generationRadius:y,anchored:C,halo:w})];Ue(a[0].graph,a[1].graph),i.world=new p({seed:_,levels:a,maxCellsPerLevel:We(y,S),...i.tap===void 0?{}:{gpu:i.tap},onCellReady:(e,r,a)=>{i.disposed||(t.cellReady(e,r,a),n.set(`${e}|${r[0]},${r[1]}`,Ge(a)))},onCellEvicted:(e,r)=>{i.disposed||(t.cellEvicted(e,r),n.delete(`${e}|${r[0]},${r[1]}`))}}),L=i,R=0,P=void 0,z=void 0,gt(),qe(i,ke)}function qe(e,t){let n=++Ke;$=!0,B=performance.now(),e.world.update([D.position.x,0,D.position.z],{budgetMs:t,maxCooksPerUpdate:Ae,signal:e.abort.signal,...e.tap===void 0?{}:{gpu:e.tap}}).then(t=>{if(e.disposed)return;R=t.pending,z=t.elapsedMs;let n=e.tap?.drain();n!==void 0&&(P=n),gt(),V&&(V=!1,Z(ht()))}).catch(t=>{t instanceof o||(console.error(t),e.disposed||Z(`update failed: ${Me(t)}`))}).finally(()=>{n===Ke&&($=!1)})}var U=0,Je=0,W=new Set;window.addEventListener(`keydown`,e=>{let t=e.key.toLowerCase();if(t===`g`){tt(b===`gpu`?`cpu`:`gpu`);return}W.add(t)}),window.addEventListener(`keyup`,e=>W.delete(e.key.toLowerCase())),document.addEventListener(`visibilitychange`,()=>{document.visibilityState===`visible`&&(B=performance.now())});var G=ge({title:`infinite world`,info:`Unbounded landmark level + world-anchored rock cells streamed around a flying camera. Steer with A/D or arrow keys.`}),Ye=document.createElement(`style`);Ye.textContent=`
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
`,document.head.appendChild(Ye);var Xe=G.el.querySelector(`.pcg-stats`)?.previousElementSibling??G.el;G.addSeed(_,e=>{_=e,H()}),G.addSlider(`speed`,{min:0,max:80,step:1,value:v,format:e=>`${e} u/s`},e=>{v=e}),G.addSlider(`gen radius`,{min:60,max:240,step:10,value:y,format:e=>`${e} u`},e=>{y=e,H()}),G.addSlider(`cell size`,{min:20,max:80,step:20,value:S,format:e=>`${e} u`},e=>{S=e,Fe(),H()}),G.addCheckbox(`world-anchored`,C,e=>{C=e,mt(),H()}),G.addCheckbox(`halo (4 u)`,w,e=>{w=e,H()}),G.addCheckbox(`cell grid`,T,e=>{T=e,k&&(k.visible=e),Ie()});var Ze=document.createElement(`div`);Ze.className=`pcg04-seg`;var K=document.createElement(`button`);K.type=`button`,K.textContent=`GPU per-node`;var q=document.createElement(`button`);q.type=`button`,q.textContent=`CPU`,Ze.append(K,q);var Qe=document.createElement(`p`);Qe.className=`pcg04-hint`,Qe.textContent=`G switches path · A/D or ←/→ steer`;var $e=document.createElement(`div`);$e.className=`pcg-row`;var et=document.createElement(`label`);et.textContent=`derived specs`;var J=document.createElement(`input`);J.type=`checkbox`,J.checked=x,J.addEventListener(`change`,()=>{x=J.checked,H()}),$e.append(et,J),Xe.prepend(Ze,Qe,$e);function tt(e){if(e!==b){if(e===`gpu`&&!F()){Z(N?Q():M??`GPU path not ready yet.`);return}b=e,Y(),H(),Z(ht())}}K.addEventListener(`click`,()=>tt(`gpu`)),q.addEventListener(`click`,()=>tt(`cpu`));function Y(){K.setAttribute(`aria-pressed`,String(b===`gpu`)),q.setAttribute(`aria-pressed`,String(b===`cpu`)),K.disabled=!F(),K.title=M===void 0?N?Q():``:M,J.disabled=!F()||b===`cpu`}var X=G.addStat(`adapter`),nt=G.addStat(`fps`),rt=G.addStat(`rock source`),it=G.addStat(`rock cells`),at=G.addStat(`cooked / evicted`),ot=G.addStat(`pending`),st=G.addStat(`instances`),ct=G.addStat(`position`),lt=G.addStat(`cook`),ut=G.addStat(`resident runs / fused members`),dt=G.addStat(`device dispatches`),ft=G.addStat(`gpu fallbacks`),pt=G.addStat(`status`);function Z(e){pt(e)}function mt(){rt(C?`pointScatterInWorld`:`pointScatterInBounds`)}function Q(){return`device lost (${Ve}) — the GPU path is disabled; reload for a fresh device`}function ht(){return N?Q():b===`cpu`?`CPU path — no resolver passed to the cook`:F()?x?`GPU per-node — combinator fields accepted via acceptDerivedSpecs`:`GPU per-node — acceptDerivedSpecs off, so every field falls back`:M??`requesting WebGPU adapter…`}function gt(){if(lt(z===void 0?`–`:`${z.toFixed(1)} ms`),P===void 0){ut(L?.tap===void 0?`– (no GPU resolver)`:`–`),dt(`–`),ft(`–`);return}ut(`${P.residentRuns} / ${P.fusedNodes}`),dt(String(P.dispatches)),ft(De(P.fallbacks))}var _t=G.addSlot();m(),G.addNote(`Drag “cell size”: the blue grid re-cells the world and the rocks do not move or resize. Untick “halo” to watch every border grow a band of undersized rocks, and “world-anchored” to watch the same drag re-roll the world from scratch.`);var vt=G.addCollapsible(`anchoring · what the fine level actually does`);vt.textContent=`pointScatterInWorld scatters over an INFINITE lattice fixed to
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
anything that has to see past its own bounds.`;var yt=G.addCollapsible(`diagnostics · why nothing fuses here`);yt.textContent=`resident runs / fused members reads 0 / 0 on BOTH paths, and
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
update cooks nothing.`;function bt(e){N=!0,Ve=e,j=`device lost`,X(j),Z(Q()),Y(),b===`gpu`&&(b=`cpu`,Y(),H())}async function xt(){let e=await we(bt);if(`error`in e){M=e.error,j=`no WebGPU adapter`,X(j),b=`cpu`,Y(),Z(`${e.error} Running the CPU path.`);return}try{let t=Te(e);A=t.derived,Be=t.strict}catch(e){M=`GpuFieldEvaluator construction failed: ${Me(e)}`,j=`evaluator unavailable`,X(j),b=`cpu`,Y(),Z(`${M} Running the CPU path.`);return}N||(j=e.label,X(j),Y(),Z(ht()),b===`gpu`&&H())}var $=!1,St=t(e=>nt(e));X(j),Z(`requesting WebGPU adapter…`),Y(),mt(),gt(),Fe(),H(),xt(),Ne(e=>{St(),Je=(W.has(`a`)||W.has(`arrowleft`)?1:0)-(W.has(`d`)||W.has(`arrowright`)?1:0),U+=Je*1.1*e,D.position.x+=Math.sin(U)*v*e,D.position.z+=Math.cos(U)*v*e,D.position.y=26,D.lookAt(D.position.x+Math.sin(U)*60,5,D.position.z+Math.cos(U)*60),Ie();let t=L;if(t&&!$?qe(t,Oe):$&&!V&&performance.now()-B>je&&(V=!0,Z(`a cook has been in flight for over 5 s — the GPU device may have been lost.`)),t){let e=t.world.stats(),n=e.levels.find(e=>e.name===`rocks`)?.cellCount??0;it(String(n)),at(`${e.totalCooked} / ${e.totalEvicted}`),ot(String(R));let r=0;for(let e of t.cellInstances.values())r+=e;st(String(r)),ct(`${D.position.x.toFixed(0)}, ${D.position.z.toFixed(0)}`)}});