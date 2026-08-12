import{$ as e,Ct as t,E as n,F as r,Ot as i,P as a,Pt as ee,Q as o,Vt as te,Z as s,_ as ne,a as re,bt as c,i as ie,q as ae,qt as l,r as oe,st as u,ut as se,vt as ce,wt as le}from"./mobile-BAPbsnLk.js";import{G as d,H as f,Ot as p,Rt as m,V as h,k as g,yt as _}from"./three.core-BdLaVEE2.js";import{t as v}from"./scene-DVQazRvt.js";import{t as ue}from"./worldBinding-BxtkbC0b.js";import{t as de}from"./gpu-D0ORSvu-.js";import{t as fe}from"./overlay-Bia06VU3.js";var pe=.35,me=777;function he(){let n=new ee,r=n.add(a,{count:170,boundsMin:[-800,0,-800],boundsMax:[800,0,800]}),o=n.add(e,{name:`scale`,tupleSize:3,value:(()=>{let e=c(i(`mega`),0,1,5,13);return t(e,ce(e,1.6),e)})()}),s=n.add(re,{assetId:`megarock`});return n.connect(r,`out`,o,`in`),n.connect(o,`out`,s,`in`),n.output(s,`instances`,`instances`),{name:`landmarks`,cellSize:`unbounded`,generationRadius:1/0,graph:n,bind(e,t){e.setParam(r,`seed`,t.seed),e.setParam(o,`seed`,te(t.seed,9))}}}function ge(ie){let{cellSize:l,generationRadius:oe,anchored:u}=ie,d=ie.halo?4:0,f=new ee,p=u?f.add(r,{density:pe,cellSize:7,latticeMode:`xz`,height:0}):f.add(a,{count:Math.round(pe*(l+2*d)**2)}),m=f.add(e,{name:`density`,tupleSize:1,value:c(ne(n,{seed:me,frequency:.02,octaves:3}),-1,1,0,1)}),h=f.add(o,{mode:`probabilistic`}),g=f.add(ae,{radius:4,countAttr:`nbrCount`}),_=f.add(s,{mode:`inside`}),v=f.add(e,{name:`scale`,tupleSize:3,value:(()=>{let e=c(se(le(`nbrCount`),2,16),2,16,.4,1.35),n=ce(e,c(i(`rock`),0,1,.85,1.15));return t(n,n,n)})()}),ue=f.add(re,{assetId:`rock`});return f.connect(p,`out`,m,`in`),f.connect(m,`out`,h,`in`),f.connect(h,`out`,g,`in`),f.connect(g,`out`,_,`in`),f.connect(_,`out`,v,`in`),f.connect(v,`out`,ue,`in`),f.output(ue,`instances`,`instances`),{name:`rocks`,cellSize:l,generationRadius:oe,graph:f,bind(e,t){e.setParam(p,`boundsMin`,[t.min[0]-d,0,t.min[1]-d]),e.setParam(p,`boundsMax`,[t.max[0]+d,0,t.max[1]+d]);let n=u?t.worldSeed:t.seed;e.setParam(p,`seed`,n),e.setParam(h,`seed`,te(n,1)),e.setParam(v,`seed`,te(n,2)),e.setParam(_,`boundsMin`,[t.min[0],-1,t.min[1]]),e.setParam(_,`boundsMax`,[t.max[0],1,t.max[1]])}}}function _e(e){return e instanceof Error?e.message:String(e)}function ve(e){let t=(e?.description??``)===``?e?.device:e?.description;return[e?.vendor,e?.architecture,t].filter(e=>typeof e==`string`&&e!==``).join(` · `)||`adapter (no info exposed)`}async function ye(e){let t=navigator.gpu;if(t===void 0)return{error:`navigator.gpu is missing — this browser has no WebGPU.`};try{let n=await t.requestAdapter();if(n===null)return{error:`navigator.gpu.requestAdapter() returned null — no compatible GPU adapter.`};let r=n.info,i=await n.requestDevice(),a=i.lost;return a!==void 0&&a.then(t=>{e(`${t?.reason??`unknown`}: ${t?.message??`no detail`}`)}),{device:i,info:r,label:ve(r)}}catch(e){return{error:`requestDevice() failed: ${_e(e)}`}}}function be(e){let t=e.info===void 0?{}:{adapterInfo:e.info};return{derived:new de(e.device,{...t,acceptDerivedSpecs:!0}),strict:new de(e.device,t)}}var xe=class{cacheSalt;residentTerminals;acceptDerivedSpecs;base;seen=new Set;constructor(e){this.base=e,this.cacheSalt=e.cacheSalt,this.residentTerminals=e.residentTerminals,this.acceptDerivedSpecs=e.acceptDerivedSpecs}resolveField(e,t,n){return n!==void 0&&this.seen.add(n),this.base.resolveField(e,t,n)}planRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.planRun(e,t,n)}executeRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.executeRun(e,t,n)}drain(){if(this.seen.size===0)return;let e=u();for(let t of this.seen){e.dispatches+=t.dispatches,e.pipelinesCompiled+=t.pipelinesCompiled,e.pipelineCacheHits+=t.pipelineCacheHits,e.residentRuns+=t.residentRuns,e.fusedNodes+=t.fusedNodes,e.readbacksSaved+=t.readbacksSaved;for(let[n,r]of Object.entries(t.fallbacks))e.fallbacks[n]=(e.fallbacks[n]??0)+r}return this.seen.clear(),e}};function Se(e){let t=Object.entries(e).sort(([e],[t])=>e.localeCompare(t));return t.length===0?`none`:t.map(([e,t])=>`${e} ×${t}`).join(`, `)}var Ce=1,y=18,b=140,x=`gpu`,S=!0,C=20,w=!0,T=!0,E=!0,we=7,Te=12,Ee=8,De=5e3;function Oe(e){return e instanceof Error?e.message:String(e)}var{scene:D,camera:O,start:ke}=v({cameraPosition:[0,26,0],orbit:!1,fog:{near:140,far:640},far:1600}),Ae=new _(new m(4e3,4e3),new p({color:1449515,roughness:1}));Ae.rotation.x=-Math.PI/2,Ae.position.y=-.03,D.add(Ae);var je=40,k;function Me(){k&&(D.remove(k),k.geometry.dispose(),k.material.dispose());let e=new h(C*je,je,4158656,2903936),t=e.material;t.transparent=!0,t.opacity=.45,t.depthWrite=!1,e.position.y=.02,e.visible=E,D.add(e),k=e}function Ne(){!k||!k.visible||(k.position.x=Math.round(O.position.x/C)*C,k.position.z=Math.round(O.position.z/C)*C)}var Pe=new p({color:8028816,roughness:.95,flatShading:!0}),Fe=new p({color:6121077,roughness:1,flatShading:!0}),Ie={megarock:{geometry:new g(1).translate(0,.62,0),material:Fe},rock:{geometry:new d(.55).translate(0,.33,0),material:Pe}},A,Le,j=`requesting…`,M,N=!1,Re=``,P;function F(){return A!==void 0&&!N}function ze(){if(!(x===`cpu`||!F()))return S?A:Le}function Be(e,t){let n=e*1.25/t+1.5;return Math.max(256,Math.ceil(Math.PI*n*n))}function Ve(e){let t=0;for(let n of Object.keys(e))for(let r of e[n])if(r.kind===`instances`)for(let e of r.batches)t+=e.count;return t}var I,He=0,L,R=0,z=!1,Ue=0;function B(){I&&(I.disposed=!0,I.abort.abort(),I.binding.dispose(),D.remove(I.group));let e=new f;D.add(e);let t=new ue({group:e,assets:Ie}),n=new Map,r=ze(),i={world:void 0,group:e,binding:t,cellInstances:n,tap:r===void 0?void 0:new xe(r),abort:new AbortController,disposed:!1};i.world=new ie({seed:Ce,levels:[he(),ge({cellSize:C,generationRadius:b,anchored:w,halo:T})],maxCellsPerLevel:Be(b,C),...i.tap===void 0?{}:{gpu:i.tap},onCellReady:(e,r,a)=>{i.disposed||(t.cellReady(e,r,a),n.set(`${e}|${r[0]},${r[1]}`,Ve(a)))},onCellEvicted:(e,r)=>{i.disposed||(t.cellEvicted(e,r),n.delete(`${e}|${r[0]},${r[1]}`))}}),I=i,He=0,P=void 0,L=void 0,dt(),We(i,Te)}function We(e,t){let n=++Ue;$=!0,R=performance.now(),e.world.update([O.position.x,0,O.position.z],{budgetMs:t,maxCooksPerUpdate:Ee,signal:e.abort.signal,...e.tap===void 0?{}:{gpu:e.tap}}).then(t=>{if(e.disposed)return;He=t.pending,L=t.elapsedMs;let n=e.tap?.drain();n!==void 0&&(P=n),dt(),z&&(z=!1,Z(ut()))}).catch(t=>{t instanceof l||(console.error(t),e.disposed||Z(`update failed: ${Oe(t)}`))}).finally(()=>{n===Ue&&($=!1)})}var V=0,Ge=0,H=new Set;window.addEventListener(`keydown`,e=>{let t=e.key.toLowerCase();if(t===`g`){Xe(x===`gpu`?`cpu`:`gpu`);return}H.add(t)}),window.addEventListener(`keyup`,e=>H.delete(e.key.toLowerCase())),document.addEventListener(`visibilitychange`,()=>{document.visibilityState===`visible`&&(R=performance.now())});var U=fe({title:`02 · infinite world`,info:`Unbounded landmark level + world-anchored rock cells streamed around a flying camera. Steer with A/D or arrow keys.`}),Ke=document.createElement(`style`);Ke.textContent=`
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
`,document.head.appendChild(Ke);var qe=U.el.querySelector(`.pcg-stats`)?.previousElementSibling??U.el;U.addSeed(Ce,e=>{Ce=e,B()}),U.addSlider(`speed`,{min:0,max:80,step:1,value:y,format:e=>`${e} u/s`},e=>{y=e}),U.addSlider(`gen radius`,{min:60,max:240,step:10,value:b,format:e=>`${e} u`},e=>{b=e,B()}),U.addSlider(`cell size`,{min:20,max:80,step:20,value:C,format:e=>`${e} u`},e=>{C=e,Me(),B()}),U.addCheckbox(`world-anchored`,w,e=>{w=e,lt(),B()}),U.addCheckbox(`halo (4 u)`,T,e=>{T=e,B()}),U.addCheckbox(`cell grid`,E,e=>{E=e,k&&(k.visible=e),Ne()});var W=document.createElement(`div`);W.className=`pcg04-seg`;var G=document.createElement(`button`);G.type=`button`,G.textContent=`GPU per-node`;var K=document.createElement(`button`);K.type=`button`,K.textContent=`CPU`,W.append(G,K);var q=document.createElement(`p`);q.className=`pcg04-hint`,q.textContent=`G switches path · A/D or ←/→ steer`;var Je=document.createElement(`div`);Je.className=`pcg-row`;var Ye=document.createElement(`label`);Ye.textContent=`derived specs`;var J=document.createElement(`input`);J.type=`checkbox`,J.checked=S,J.addEventListener(`change`,()=>{S=J.checked,B()}),Je.append(Ye,J),qe.prepend(W,q,Je);function Xe(e){if(e!==x){if(e===`gpu`&&!F()){Z(N?Q():M??`GPU path not ready yet.`);return}x=e,Y(),B(),Z(ut())}}G.addEventListener(`click`,()=>Xe(`gpu`)),K.addEventListener(`click`,()=>Xe(`cpu`));function Y(){G.setAttribute(`aria-pressed`,String(x===`gpu`)),K.setAttribute(`aria-pressed`,String(x===`cpu`)),G.disabled=!F(),G.title=M===void 0?N?Q():``:M,J.disabled=!F()||x===`cpu`}var X=U.addStat(`adapter`),Ze=U.addStat(`fps`),Qe=U.addStat(`rock source`),$e=U.addStat(`rock cells`),et=U.addStat(`cooked / evicted`),tt=U.addStat(`pending`),nt=U.addStat(`instances`),rt=U.addStat(`position`),it=U.addStat(`cook`),at=U.addStat(`resident runs / fused members`),ot=U.addStat(`device dispatches`),st=U.addStat(`gpu fallbacks`),ct=U.addStat(`status`);function Z(e){ct(e)}function lt(){Qe(w?`pointScatterInWorld`:`pointScatterInBounds`)}function Q(){return`device lost (${Re}) — the GPU path is disabled; reload for a fresh device`}function ut(){return N?Q():x===`cpu`?`CPU path — no resolver passed to the cook`:F()?S?`GPU per-node — combinator fields accepted via acceptDerivedSpecs`:`GPU per-node — acceptDerivedSpecs off, so every field falls back`:M??`requesting WebGPU adapter…`}function dt(){if(it(L===void 0?`–`:`${L.toFixed(1)} ms`),P===void 0){at(I?.tap===void 0?`– (no GPU resolver)`:`–`),ot(`–`),st(`–`);return}at(`${P.residentRuns} / ${P.fusedNodes}`),ot(String(P.dispatches)),st(Se(P.fallbacks))}U.addNote(`Drag “cell size”: the blue grid re-cells the world and the rocks do not move or resize. Untick “halo” to watch every border grow a band of undersized rocks, and “world-anchored” to watch the same drag re-roll the world from scratch.`);var ft=U.addCollapsible(`anchoring · what the fine level actually does`);ft.textContent=`pointScatterInWorld scatters over an INFINITE lattice fixed to
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
anything that has to see past its own bounds.`;var pt=U.addCollapsible(`diagnostics · why nothing fuses here`);pt.textContent=`resident runs / fused members reads 0 / 0 on BOTH paths, and
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
update cooks nothing.`;function mt(e){N=!0,Re=e,j=`device lost`,X(j),Z(Q()),Y(),x===`gpu`&&(x=`cpu`,Y(),B())}async function ht(){let e=await ye(mt);if(`error`in e){M=e.error,j=`no WebGPU adapter`,X(j),x=`cpu`,Y(),Z(`${e.error} Running the CPU path.`);return}try{let t=be(e);A=t.derived,Le=t.strict}catch(e){M=`GpuFieldEvaluator construction failed: ${Oe(e)}`,j=`evaluator unavailable`,X(j),x=`cpu`,Y(),Z(`${M} Running the CPU path.`);return}N||(j=e.label,X(j),Y(),Z(ut()),x===`gpu`&&B())}var $=!1,gt=oe(e=>Ze(e));X(j),Z(`requesting WebGPU adapter…`),Y(),lt(),dt(),Me(),B(),ht(),ke(e=>{gt(),Ge=(H.has(`a`)||H.has(`arrowleft`)?1:0)-(H.has(`d`)||H.has(`arrowright`)?1:0),V+=Ge*1.1*e,O.position.x+=Math.sin(V)*y*e,O.position.z+=Math.cos(V)*y*e,O.position.y=26,O.lookAt(O.position.x+Math.sin(V)*60,5,O.position.z+Math.cos(V)*60),Ne();let t=I;if(t&&!$?We(t,we):$&&!z&&performance.now()-R>De&&(z=!0,Z(`a cook has been in flight for over 5 s — the GPU device may have been lost.`)),t){let e=t.world.stats(),n=e.levels.find(e=>e.name===`rocks`)?.cellCount??0;$e(String(n)),et(`${e.totalCooked} / ${e.totalEvicted}`),tt(String(He));let r=0;for(let e of t.cellInstances.values())r+=e;nt(String(r)),rt(`${O.position.x.toFixed(0)}, ${O.position.z.toFixed(0)}`)}});