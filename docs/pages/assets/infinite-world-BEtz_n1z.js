import{G as e,Hr as t,Ji as n,K as r,N as i,Nt as a,Ta as o,Ur as ee,Ut as s,Vi as te,Y as c,Zi as ne,ai as re,di as ie,gi as l,hi as ae,ia as u,ji as oe,la as se,mi as ce,na as le,oa as ue,oi as de,qi as d,r as f,sa as fe,wi as pe,wt as p}from"./mobile-CY74Je-d.js";import{t as m}from"./scene-F8p8GKUe.js";import{a as h}from"./debug-CbAK_moY.js";import{t as me}from"./worldBinding-CE8flR0l.js";import{t as he}from"./overlay-Bhmv9tIJ.js";var ge=.35,_e=777;function ve(){let e=new pe,t=e.add(re,{count:170,boundsMin:[-800,0,-800],boundsMax:[800,0,800]}),n=e.add(l,{name:`scale`,tupleSize:3,value:(()=>{let e=u(se(`mega`),0,1,5,13);return ue(e,le(e,1.6),e)})()}),r=e.add(ee,{assetId:`megarock`});return e.connect(t,`out`,n,`in`),e.connect(n,`out`,r,`in`),e.output(r,`instances`,`instances`),{name:`landmarks`,cellSize:`unbounded`,generationRadius:1/0,graph:e,bind(e,r){e.setParam(t,`seed`,r.seed),e.setParam(n,`seed`,o(r.seed,9))}}}function ye(e){let{cellSize:t,generationRadius:n,anchored:r}=e,i=e.halo?4:0,a=new pe,s=r?a.add(de,{density:ge,cellSize:7,latticeMode:`xz`,height:0}):a.add(re,{count:Math.round(ge*(t+2*i)**2)}),c=a.add(l,{name:`density`,tupleSize:1,value:u(oe(te,{seed:_e,frequency:.02,octaves:3}),-1,1,0,1)}),d=a.add(ae,{mode:`probabilistic`}),f=a.add(ie,{radius:4,countAttr:`nbrCount`}),p=a.add(ce,{mode:`inside`}),m=a.add(l,{name:`scale`,tupleSize:3,value:(()=>{let e=u(ne(fe(`nbrCount`),2,16),2,16,.4,1.35),t=le(e,u(se(`rock`),0,1,.85,1.15));return ue(t,t,t)})()}),h=a.add(ee,{assetId:`rock`});return a.connect(s,`out`,c,`in`),a.connect(c,`out`,d,`in`),a.connect(d,`out`,f,`in`),a.connect(f,`out`,p,`in`),a.connect(p,`out`,m,`in`),a.connect(m,`out`,h,`in`),a.output(h,`instances`,`instances`),{name:`rocks`,cellSize:t,generationRadius:n,graph:a,bind(e,t){e.setParam(s,`boundsMin`,[t.min[0]-i,0,t.min[1]-i]),e.setParam(s,`boundsMax`,[t.max[0]+i,0,t.max[1]+i]);let n=r?t.worldSeed:t.seed;e.setParam(s,`seed`,n),e.setParam(d,`seed`,o(n,1)),e.setParam(m,`seed`,o(n,2)),e.setParam(p,`boundsMin`,[t.min[0],-1,t.min[1]]),e.setParam(p,`boundsMax`,[t.max[0],1,t.max[1]])}}}function be(e){return e instanceof Error?e.message:String(e)}function xe(e){let t=(e?.description??``)===``?e?.device:e?.description;return[e?.vendor,e?.architecture,t].filter(e=>typeof e==`string`&&e!==``).join(` · `)||`adapter (no info exposed)`}async function Se(e){let t=navigator.gpu;if(t===void 0)return{error:`navigator.gpu is missing — this browser has no WebGPU.`};try{let n=await t.requestAdapter();if(n===null)return{error:`navigator.gpu.requestAdapter() returned null — no compatible GPU adapter.`};let r=n.info,i=await n.requestDevice(),a=i.lost;return a!==void 0&&a.then(t=>{e(`${t?.reason??`unknown`}: ${t?.message??`no detail`}`)}),{device:i,info:r,label:xe(r)}}catch(e){return{error:`requestDevice() failed: ${be(e)}`}}}function Ce(e){let t=e.info===void 0?{}:{adapterInfo:e.info};return{derived:new h(e.device,{...t,acceptDerivedSpecs:!0}),strict:new h(e.device,t)}}var we=class{cacheSalt;residentTerminals;acceptDerivedSpecs;base;seen=new Set;constructor(e){this.base=e,this.cacheSalt=e.cacheSalt,this.residentTerminals=e.residentTerminals,this.acceptDerivedSpecs=e.acceptDerivedSpecs}resolveField(e,t,n){return n!==void 0&&this.seen.add(n),this.base.resolveField(e,t,n)}planRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.planRun(e,t,n)}executeRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.executeRun(e,t,n)}drain(){if(this.seen.size===0)return;let e=n();for(let t of this.seen){e.dispatches+=t.dispatches,e.pipelinesCompiled+=t.pipelinesCompiled,e.pipelineCacheHits+=t.pipelineCacheHits,e.residentRuns+=t.residentRuns,e.fusedNodes+=t.fusedNodes,e.readbacksSaved+=t.readbacksSaved;for(let[n,r]of Object.entries(t.fallbacks))e.fallbacks[n]=(e.fallbacks[n]??0)+r}return this.seen.clear(),e}};function Te(e){let t=Object.entries(e).sort(([e],[t])=>e.localeCompare(t));return t.length===0?`none`:t.map(([e,t])=>`${e} ×${t}`).join(`, `)}var g=1,_=18,v=140,y=`gpu`,b=!0,x=20,S=!0,Ee=!0,C=!0,De=7,Oe=12,ke=8,Ae=5e3;function je(e){return e instanceof Error?e.message:String(e)}var{scene:w,camera:T,start:Me}=m({cameraPosition:[0,26,0],orbit:!1,fog:{near:140,far:640},far:1600}),E=new p(new s(4e3,4e3),new a({color:1449515,roughness:1}));E.rotation.x=-Math.PI/2,E.position.y=-.03,w.add(E);var Ne=40,D;function Pe(){D&&(w.remove(D),D.geometry.dispose(),D.material.dispose());let t=new e(x*Ne,Ne,4158656,2903936),n=t.material;n.transparent=!0,n.opacity=.45,n.depthWrite=!1,t.position.y=.02,t.visible=C,w.add(t),D=t}function Fe(){!D||!D.visible||(D.position.x=Math.round(T.position.x/x)*x,D.position.z=Math.round(T.position.z/x)*x)}var Ie=new a({color:8028816,roughness:.95,flatShading:!0}),Le=new a({color:6121077,roughness:1,flatShading:!0}),Re={megarock:{geometry:new i(1).translate(0,.62,0),material:Le},rock:{geometry:new c(.55).translate(0,.33,0),material:Ie}},O,ze,k=`requesting…`,A,j=!1,Be=``,M;function N(){return O!==void 0&&!j}function Ve(){if(!(y===`cpu`||!N()))return b?O:ze}function He(e,t){let n=e*1.25/t+1.5;return Math.max(256,Math.ceil(Math.PI*n*n))}function Ue(e){let t=0;for(let n of Object.keys(e))for(let r of e[n])if(r.kind===`instances`)for(let e of r.batches)t+=e.count;return t}var P,F=0,I,L=0,R=!1,We=0;function z(){P&&(P.disposed=!0,P.abort.abort(),P.binding.dispose(),w.remove(P.group));let e=new r;w.add(e);let n=new me({group:e,assets:Re}),i=new Map,a=Ve(),o={world:void 0,group:e,binding:n,cellInstances:i,tap:a===void 0?void 0:new we(a),abort:new AbortController,disposed:!1};o.world=new t({seed:g,levels:[ve(),ye({cellSize:x,generationRadius:v,anchored:S,halo:Ee})],maxCellsPerLevel:He(v,x),...o.tap===void 0?{}:{gpu:o.tap},onCellReady:(e,t,r)=>{o.disposed||(n.cellReady(e,t,r),i.set(`${e}|${t[0]},${t[1]}`,Ue(r)))},onCellEvicted:(e,t)=>{o.disposed||(n.cellEvicted(e,t),i.delete(`${e}|${t[0]},${t[1]}`))}}),P=o,F=0,M=void 0,I=void 0,dt(),Ge(o,Oe)}function Ge(e,t){let n=++We;$=!0,L=performance.now(),e.world.update([T.position.x,0,T.position.z],{budgetMs:t,maxCooksPerUpdate:ke,signal:e.abort.signal,...e.tap===void 0?{}:{gpu:e.tap}}).then(t=>{if(e.disposed)return;F=t.pending,I=t.elapsedMs;let n=e.tap?.drain();n!==void 0&&(M=n),dt(),R&&(R=!1,Z(ut()))}).catch(t=>{t instanceof d||(console.error(t),e.disposed||Z(`update failed: ${je(t)}`))}).finally(()=>{n===We&&($=!1)})}var B=0,Ke=0,V=new Set;window.addEventListener(`keydown`,e=>{let t=e.key.toLowerCase();if(t===`g`){Xe(y===`gpu`?`cpu`:`gpu`);return}V.add(t)}),window.addEventListener(`keyup`,e=>V.delete(e.key.toLowerCase())),document.addEventListener(`visibilitychange`,()=>{document.visibilityState===`visible`&&(L=performance.now())});var H=he({title:`infinite world`,info:`Unbounded landmark level + world-anchored rock cells streamed around a flying camera. Steer with A/D or arrow keys.`}),qe=document.createElement(`style`);qe.textContent=`
.pcg04-seg { display: flex; gap: 6px; margin: 4px 0 4px; }
.pcg04-seg button {
  flex: 1; padding: 6px 4px; cursor: pointer; border-radius: 6px;
  border: 1px solid #33405a; background: #161d29; color: #aeb9c9;
  font: 12px system-ui, sans-serif;
}
.pcg04-seg button:hover:not(:disabled) { border-color: #4c8dff; color: #dbe4f0; }
.pcg04-seg button[aria-pressed="true"] { background: #1d3a6b; border-color: #4c8dff; color: #eaf2ff; }
.pcg04-seg button:disabled { opacity: 0.4; cursor: not-allowed; }
.pcg04-hint { margin: 0 0 10px; color: #6f7c8f; font-size: 11px; }
`,document.head.appendChild(qe);var Je=H.el.querySelector(`.pcg-stats`)?.previousElementSibling??H.el;H.addSeed(g,e=>{g=e,z()}),H.addSlider(`speed`,{min:0,max:80,step:1,value:_,format:e=>`${e} u/s`},e=>{_=e}),H.addSlider(`gen radius`,{min:60,max:240,step:10,value:v,format:e=>`${e} u`},e=>{v=e,z()}),H.addSlider(`cell size`,{min:20,max:80,step:20,value:x,format:e=>`${e} u`},e=>{x=e,Pe(),z()}),H.addCheckbox(`world-anchored`,S,e=>{S=e,lt(),z()}),H.addCheckbox(`halo (4 u)`,Ee,e=>{Ee=e,z()}),H.addCheckbox(`cell grid`,C,e=>{C=e,D&&(D.visible=e),Fe()});var U=document.createElement(`div`);U.className=`pcg04-seg`;var W=document.createElement(`button`);W.type=`button`,W.textContent=`GPU per-node`;var G=document.createElement(`button`);G.type=`button`,G.textContent=`CPU`,U.append(W,G);var K=document.createElement(`p`);K.className=`pcg04-hint`,K.textContent=`G switches path · A/D or ←/→ steer`;var q=document.createElement(`div`);q.className=`pcg-row`;var Ye=document.createElement(`label`);Ye.textContent=`derived specs`;var J=document.createElement(`input`);J.type=`checkbox`,J.checked=b,J.addEventListener(`change`,()=>{b=J.checked,z()}),q.append(Ye,J),Je.prepend(U,K,q);function Xe(e){if(e!==y){if(e===`gpu`&&!N()){Z(j?Q():A??`GPU path not ready yet.`);return}y=e,Y(),z(),Z(ut())}}W.addEventListener(`click`,()=>Xe(`gpu`)),G.addEventListener(`click`,()=>Xe(`cpu`));function Y(){W.setAttribute(`aria-pressed`,String(y===`gpu`)),G.setAttribute(`aria-pressed`,String(y===`cpu`)),W.disabled=!N(),W.title=A===void 0?j?Q():``:A,J.disabled=!N()||y===`cpu`}var X=H.addStat(`adapter`),Ze=H.addStat(`fps`),Qe=H.addStat(`rock source`),$e=H.addStat(`rock cells`),et=H.addStat(`cooked / evicted`),tt=H.addStat(`pending`),nt=H.addStat(`instances`),rt=H.addStat(`position`),it=H.addStat(`cook`),at=H.addStat(`resident runs / fused members`),ot=H.addStat(`device dispatches`),st=H.addStat(`gpu fallbacks`),ct=H.addStat(`status`);function Z(e){ct(e)}function lt(){Qe(S?`pointScatterInWorld`:`pointScatterInBounds`)}function Q(){return`device lost (${Be}) — the GPU path is disabled; reload for a fresh device`}function ut(){return j?Q():y===`cpu`?`CPU path — no resolver passed to the cook`:N()?b?`GPU per-node — combinator fields accepted via acceptDerivedSpecs`:`GPU per-node — acceptDerivedSpecs off, so every field falls back`:A??`requesting WebGPU adapter…`}function dt(){if(it(I===void 0?`–`:`${I.toFixed(1)} ms`),M===void 0){at(P?.tap===void 0?`– (no GPU resolver)`:`–`),ot(`–`),st(`–`);return}at(`${M.residentRuns} / ${M.fusedNodes}`),ot(String(M.dispatches)),st(Te(M.fallbacks))}H.addNote(`Drag “cell size”: the blue grid re-cells the world and the rocks do not move or resize. Untick “halo” to watch every border grow a band of undersized rocks, and “world-anchored” to watch the same drag re-roll the world from scratch.`);var ft=H.addCollapsible(`anchoring · what the fine level actually does`);ft.textContent=`pointScatterInWorld scatters over an INFINITE lattice fixed to
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
anything that has to see past its own bounds.`;var pt=H.addCollapsible(`diagnostics · why nothing fuses here`);pt.textContent=`resident runs / fused members reads 0 / 0 on BOTH paths, and
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
update cooks nothing.`;function mt(e){j=!0,Be=e,k=`device lost`,X(k),Z(Q()),Y(),y===`gpu`&&(y=`cpu`,Y(),z())}async function ht(){let e=await Se(mt);if(`error`in e){A=e.error,k=`no WebGPU adapter`,X(k),y=`cpu`,Y(),Z(`${e.error} Running the CPU path.`);return}try{let t=Ce(e);O=t.derived,ze=t.strict}catch(e){A=`GpuFieldEvaluator construction failed: ${je(e)}`,k=`evaluator unavailable`,X(k),y=`cpu`,Y(),Z(`${A} Running the CPU path.`);return}j||(k=e.label,X(k),Y(),Z(ut()),y===`gpu`&&z())}var $=!1,gt=f(e=>Ze(e));X(k),Z(`requesting WebGPU adapter…`),Y(),lt(),dt(),Pe(),z(),ht(),Me(e=>{gt(),Ke=(V.has(`a`)||V.has(`arrowleft`)?1:0)-(V.has(`d`)||V.has(`arrowright`)?1:0),B+=Ke*1.1*e,T.position.x+=Math.sin(B)*_*e,T.position.z+=Math.cos(B)*_*e,T.position.y=26,T.lookAt(T.position.x+Math.sin(B)*60,5,T.position.z+Math.cos(B)*60),Fe();let t=P;if(t&&!$?Ge(t,De):$&&!R&&performance.now()-L>Ae&&(R=!0,Z(`a cook has been in flight for over 5 s — the GPU device may have been lost.`)),t){let e=t.world.stats(),n=e.levels.find(e=>e.name===`rocks`)?.cellCount??0;$e(String(n)),et(`${e.totalCooked} / ${e.totalEvicted}`),tt(String(F));let r=0;for(let e of t.cellInstances.values())r+=e;nt(String(r)),rt(`${T.position.x.toFixed(0)}, ${T.position.z.toFixed(0)}`)}});