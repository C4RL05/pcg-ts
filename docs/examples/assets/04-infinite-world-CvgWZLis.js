import{Dt as e,M as t,Mt as n,Ot as r,St as i,Wt as a,X as o,Z as s,a as ee,b as te,d as c,dt as l,i as ne,j as re,m as ie,mt as ae,ot as oe,p as se,q as ce,r as u,wt as d}from"./mobile-CAlugUcx.js";import{G as f,H as p,Ot as m,Rt as le,V as h,k as g,yt as _}from"./three.core-BdLaVEE2.js";import{t as v}from"./worldBinding-CA8Muc6e.js";import{t as y}from"./gpu-C0R2KJAD.js";import{t as ue}from"./overlay-Brkm6ktz.js";import{t as de}from"./scene-DVQazRvt.js";var fe=.35,pe=777;function me(){let t=new ce,r=t.add(re,{count:170,boundsMin:[-800,0,-800],boundsMax:[800,0,800]}),o=t.add(c,{name:`scale`,tupleSize:3,value:(()=>{let t=d(n(`mega`),0,1,5,13);return e(t,i(t,1.6),t)})()}),s=t.add(ee,{assetId:`megarock`});return t.connect(r,`out`,o,`in`),t.connect(o,`out`,s,`in`),t.output(s,`instances`,`instances`),{name:`landmarks`,cellSize:`unbounded`,generationRadius:1/0,graph:t,bind(e,t){e.setParam(r,`seed`,t.seed),e.setParam(o,`seed`,a(t.seed,9))}}}function he(o){let{cellSize:l,generationRadius:ne,anchored:u}=o,f=o.halo?4:0,p=new ce,m=u?p.add(t,{density:fe,cellSize:7,latticeMode:`xz`,height:0}):p.add(re,{count:Math.round(fe*(l+2*f)**2)}),le=p.add(c,{name:`density`,tupleSize:1,value:d(s(oe,{seed:pe,frequency:.02,octaves:3}),-1,1,0,1)}),h=p.add(ie,{mode:`probabilistic`}),g=p.add(te,{radius:4,countAttr:`nbrCount`}),_=p.add(se,{mode:`inside`}),v=p.add(c,{name:`scale`,tupleSize:3,value:(()=>{let t=d(ae(r(`nbrCount`),2,16),2,16,.4,1.35),a=i(t,d(n(`rock`),0,1,.85,1.15));return e(a,a,a)})()}),y=p.add(ee,{assetId:`rock`});return p.connect(m,`out`,le,`in`),p.connect(le,`out`,h,`in`),p.connect(h,`out`,g,`in`),p.connect(g,`out`,_,`in`),p.connect(_,`out`,v,`in`),p.connect(v,`out`,y,`in`),p.output(y,`instances`,`instances`),{name:`rocks`,cellSize:l,generationRadius:ne,graph:p,bind(e,t){e.setParam(m,`boundsMin`,[t.min[0]-f,0,t.min[1]-f]),e.setParam(m,`boundsMax`,[t.max[0]+f,0,t.max[1]+f]);let n=u?t.worldSeed:t.seed;e.setParam(m,`seed`,n),e.setParam(h,`seed`,a(n,1)),e.setParam(v,`seed`,a(n,2)),e.setParam(_,`boundsMin`,[t.min[0],-1,t.min[1]]),e.setParam(_,`boundsMax`,[t.max[0],1,t.max[1]])}}}function ge(e){return e instanceof Error?e.message:String(e)}function _e(e){let t=(e?.description??``)===``?e?.device:e?.description;return[e?.vendor,e?.architecture,t].filter(e=>typeof e==`string`&&e!==``).join(` · `)||`adapter (no info exposed)`}async function ve(e){let t=navigator.gpu;if(t===void 0)return{error:`navigator.gpu is missing — this browser has no WebGPU.`};try{let n=await t.requestAdapter();if(n===null)return{error:`navigator.gpu.requestAdapter() returned null — no compatible GPU adapter.`};let r=n.info,i=await n.requestDevice(),a=i.lost;return a!==void 0&&a.then(t=>{e(`${t?.reason??`unknown`}: ${t?.message??`no detail`}`)}),{device:i,info:r,label:_e(r)}}catch(e){return{error:`requestDevice() failed: ${ge(e)}`}}}function ye(e){let t=e.info===void 0?{}:{adapterInfo:e.info};return{derived:new y(e.device,{...t,acceptDerivedSpecs:!0}),strict:new y(e.device,t)}}var be=class{cacheSalt;residentTerminals;acceptDerivedSpecs;base;seen=new Set;constructor(e){this.base=e,this.cacheSalt=e.cacheSalt,this.residentTerminals=e.residentTerminals,this.acceptDerivedSpecs=e.acceptDerivedSpecs}resolveField(e,t,n){return n!==void 0&&this.seen.add(n),this.base.resolveField(e,t,n)}planRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.planRun(e,t,n)}executeRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.executeRun(e,t,n)}drain(){if(this.seen.size===0)return;let e=l();for(let t of this.seen){e.dispatches+=t.dispatches,e.pipelinesCompiled+=t.pipelinesCompiled,e.pipelineCacheHits+=t.pipelineCacheHits,e.residentRuns+=t.residentRuns,e.fusedNodes+=t.fusedNodes,e.readbacksSaved+=t.readbacksSaved;for(let[n,r]of Object.entries(t.fallbacks))e.fallbacks[n]=(e.fallbacks[n]??0)+r}return this.seen.clear(),e}};function xe(e){let t=Object.entries(e).sort(([e],[t])=>e.localeCompare(t));return t.length===0?`none`:t.map(([e,t])=>`${e} ×${t}`).join(`, `)}var Se=1,b=18,x=140,S=`gpu`,C=!0,w=20,T=!0,E=!0,Ce=!0,we=7,Te=12,Ee=8,De=5e3;function Oe(e){return e instanceof Error?e.message:String(e)}var{scene:D,camera:O,start:ke}=de({cameraPosition:[0,26,0],orbit:!1,fog:{near:140,far:640},far:1600}),Ae=new _(new le(4e3,4e3),new m({color:1449515,roughness:1}));Ae.rotation.x=-Math.PI/2,Ae.position.y=-.03,D.add(Ae);var je=40,k;function Me(){k&&(D.remove(k),k.geometry.dispose(),k.material.dispose());let e=new h(w*je,je,4158656,2903936),t=e.material;t.transparent=!0,t.opacity=.45,t.depthWrite=!1,e.position.y=.02,e.visible=Ce,D.add(e),k=e}function Ne(){!k||!k.visible||(k.position.x=Math.round(O.position.x/w)*w,k.position.z=Math.round(O.position.z/w)*w)}var Pe=new m({color:8028816,roughness:.95,flatShading:!0}),Fe=new m({color:6121077,roughness:1,flatShading:!0}),Ie={megarock:{geometry:new g(1).translate(0,.62,0),material:Fe},rock:{geometry:new f(.55).translate(0,.33,0),material:Pe}},A,Le,j=`requesting…`,M,N=!1,Re=``,P;function F(){return A!==void 0&&!N}function ze(){if(!(S===`cpu`||!F()))return C?A:Le}function Be(e,t){let n=e*1.25/t+1.5;return Math.max(256,Math.ceil(Math.PI*n*n))}function Ve(e){let t=0;for(let n of Object.keys(e))for(let r of e[n])if(r.kind===`instances`)for(let e of r.batches)t+=e.count;return t}var I,He=0,L,Ue=0,R=!1,We=0;function z(){I&&(I.disposed=!0,I.abort.abort(),I.binding.dispose(),D.remove(I.group));let e=new p;D.add(e);let t=new v({group:e,assets:Ie}),n=new Map,r=ze(),i={world:void 0,group:e,binding:t,cellInstances:n,tap:r===void 0?void 0:new be(r),abort:new AbortController,disposed:!1};i.world=new ne({seed:Se,levels:[me(),he({cellSize:w,generationRadius:x,anchored:T,halo:E})],maxCellsPerLevel:Be(x,w),...i.tap===void 0?{}:{gpu:i.tap},onCellReady:(e,r,a)=>{i.disposed||(t.cellReady(e,r,a),n.set(`${e}|${r[0]},${r[1]}`,Ve(a)))},onCellEvicted:(e,r)=>{i.disposed||(t.cellEvicted(e,r),n.delete(`${e}|${r[0]},${r[1]}`))}}),I=i,He=0,P=void 0,L=void 0,dt(),Ge(i,Te)}function Ge(e,t){let n=++We;$=!0,Ue=performance.now(),e.world.update([O.position.x,0,O.position.z],{budgetMs:t,maxCooksPerUpdate:Ee,signal:e.abort.signal,...e.tap===void 0?{}:{gpu:e.tap}}).then(t=>{if(e.disposed)return;He=t.pending,L=t.elapsedMs;let n=e.tap?.drain();n!==void 0&&(P=n),dt(),R&&(R=!1,Z(ut()))}).catch(t=>{t instanceof o||(console.error(t),e.disposed||Z(`update failed: ${Oe(t)}`))}).finally(()=>{n===We&&($=!1)})}var B=0,Ke=0,V=new Set;window.addEventListener(`keydown`,e=>{let t=e.key.toLowerCase();if(t===`g`){Xe(S===`gpu`?`cpu`:`gpu`);return}V.add(t)}),window.addEventListener(`keyup`,e=>V.delete(e.key.toLowerCase())),document.addEventListener(`visibilitychange`,()=>{document.visibilityState===`visible`&&(Ue=performance.now())});var H=ue({title:`04 · infinite world`,info:`Unbounded landmark level + world-anchored rock cells streamed around a flying camera. Steer with A/D or arrow keys.`}),qe=document.createElement(`style`);qe.textContent=`
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
`,document.head.appendChild(qe);var Je=H.el.querySelector(`.pcg-stats`)?.previousElementSibling??H.el;H.addSeed(Se,e=>{Se=e,z()}),H.addSlider(`speed`,{min:0,max:80,step:1,value:b,format:e=>`${e} u/s`},e=>{b=e}),H.addSlider(`gen radius`,{min:60,max:240,step:10,value:x,format:e=>`${e} u`},e=>{x=e,z()}),H.addSlider(`cell size`,{min:20,max:80,step:20,value:w,format:e=>`${e} u`},e=>{w=e,Me(),z()}),H.addCheckbox(`world-anchored`,T,e=>{T=e,lt(),z()}),H.addCheckbox(`halo (4 u)`,E,e=>{E=e,z()}),H.addCheckbox(`cell grid`,Ce,e=>{Ce=e,k&&(k.visible=e),Ne()});var U=document.createElement(`div`);U.className=`pcg04-seg`;var W=document.createElement(`button`);W.type=`button`,W.textContent=`GPU per-node`;var G=document.createElement(`button`);G.type=`button`,G.textContent=`CPU`,U.append(W,G);var K=document.createElement(`p`);K.className=`pcg04-hint`,K.textContent=`G switches path · A/D or ←/→ steer`;var q=document.createElement(`div`);q.className=`pcg-row`;var Ye=document.createElement(`label`);Ye.textContent=`derived specs`;var J=document.createElement(`input`);J.type=`checkbox`,J.checked=C,J.addEventListener(`change`,()=>{C=J.checked,z()}),q.append(Ye,J),Je.prepend(U,K,q);function Xe(e){if(e!==S){if(e===`gpu`&&!F()){Z(N?Q():M??`GPU path not ready yet.`);return}S=e,Y(),z(),Z(ut())}}W.addEventListener(`click`,()=>Xe(`gpu`)),G.addEventListener(`click`,()=>Xe(`cpu`));function Y(){W.setAttribute(`aria-pressed`,String(S===`gpu`)),G.setAttribute(`aria-pressed`,String(S===`cpu`)),W.disabled=!F(),W.title=M===void 0?N?Q():``:M,J.disabled=!F()||S===`cpu`}var X=H.addStat(`adapter`),Ze=H.addStat(`fps`),Qe=H.addStat(`rock source`),$e=H.addStat(`rock cells`),et=H.addStat(`cooked / evicted`),tt=H.addStat(`pending`),nt=H.addStat(`instances`),rt=H.addStat(`position`),it=H.addStat(`cook`),at=H.addStat(`resident runs / fused members`),ot=H.addStat(`device dispatches`),st=H.addStat(`gpu fallbacks`),ct=H.addStat(`status`);function Z(e){ct(e)}function lt(){Qe(T?`pointScatterInWorld`:`pointScatterInBounds`)}function Q(){return`device lost (${Re}) — the GPU path is disabled; reload for a fresh device`}function ut(){return N?Q():S===`cpu`?`CPU path — no resolver passed to the cook`:F()?C?`GPU per-node — combinator fields accepted via acceptDerivedSpecs`:`GPU per-node — acceptDerivedSpecs off, so every field falls back`:M??`requesting WebGPU adapter…`}function dt(){if(it(L===void 0?`–`:`${L.toFixed(1)} ms`),P===void 0){at(I?.tap===void 0?`– (no GPU resolver)`:`–`),ot(`–`),st(`–`);return}at(`${P.residentRuns} / ${P.fusedNodes}`),ot(String(P.dispatches)),st(xe(P.fallbacks))}H.addNote(`Drag “cell size”: the blue grid re-cells the world and the rocks do not move or resize. Untick “halo” to watch every border grow a band of undersized rocks, and “world-anchored” to watch the same drag re-roll the world from scratch.`);var ft=H.addCollapsible(`anchoring · what the fine level actually does`);ft.textContent=`pointScatterInWorld scatters over an INFINITE lattice fixed to
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
update cooks nothing.`;function mt(e){N=!0,Re=e,j=`device lost`,X(j),Z(Q()),Y(),S===`gpu`&&(S=`cpu`,Y(),z())}async function ht(){let e=await ve(mt);if(`error`in e){M=e.error,j=`no WebGPU adapter`,X(j),S=`cpu`,Y(),Z(`${e.error} Running the CPU path.`);return}try{let t=ye(e);A=t.derived,Le=t.strict}catch(e){M=`GpuFieldEvaluator construction failed: ${Oe(e)}`,j=`evaluator unavailable`,X(j),S=`cpu`,Y(),Z(`${M} Running the CPU path.`);return}N||(j=e.label,X(j),Y(),Z(ut()),S===`gpu`&&z())}var $=!1,gt=u(e=>Ze(e));X(j),Z(`requesting WebGPU adapter…`),Y(),lt(),dt(),Me(),z(),ht(),ke(e=>{gt(),Ke=(V.has(`a`)||V.has(`arrowleft`)?1:0)-(V.has(`d`)||V.has(`arrowright`)?1:0),B+=Ke*1.1*e,O.position.x+=Math.sin(B)*b*e,O.position.z+=Math.cos(B)*b*e,O.position.y=26,O.lookAt(O.position.x+Math.sin(B)*60,5,O.position.z+Math.cos(B)*60),Ne();let t=I;if(t&&!$?Ge(t,we):$&&!R&&performance.now()-Ue>De&&(R=!0,Z(`a cook has been in flight for over 5 s — the GPU device may have been lost.`)),t){let e=t.world.stats(),n=e.levels.find(e=>e.name===`rocks`)?.cellCount??0;$e(String(n)),et(`${e.totalCooked} / ${e.totalEvicted}`),tt(String(He));let r=0;for(let e of t.cellInstances.values())r+=e;nt(String(r)),rt(`${O.position.x.toFixed(0)}, ${O.position.z.toFixed(0)}`)}});