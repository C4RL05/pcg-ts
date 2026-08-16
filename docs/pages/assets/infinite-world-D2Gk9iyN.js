import{Ct as e,Fi as t,G as n,Gi as r,Hi as i,Hr as a,Ht as o,K as s,Mt as c,N as l,Qi as u,Sa as d,Ti as ee,Vi as te,Vr as f,Xi as ne,Y as re,_a as ie,ci as ae,di as oe,ea as se,fi as ce,ni as le,pi as p,r as m,ra as ue,ri as de,ta as fe}from"./mobile--VUURbwl.js";import{t as h}from"./scene-BQ9d-VjD.js";import{a as g}from"./debug-Bd7zbgzI.js";import{t as pe}from"./worldBinding-CwrayFnP.js";import{t as me}from"./overlay-BEVpt8SF.js";var he=.35,ge=777;function _e(){let e=new te,t=e.add(le,{count:170,boundsMin:[-800,0,-800],boundsMax:[800,0,800]}),n=e.add(p,{name:`scale`,tupleSize:3,value:(()=>{let e=u(ue(`mega`),0,1,5,13);return se(e,ne(e,1.6),e)})()}),r=e.add(a,{assetId:`megarock`});return e.connect(t,`out`,n,`in`),e.connect(n,`out`,r,`in`),e.output(r,`instances`,`instances`),{name:`landmarks`,cellSize:`unbounded`,generationRadius:1/0,graph:e,bind(e,r){e.setParam(t,`seed`,r.seed),e.setParam(n,`seed`,ie(r.seed,9))}}}function ve(e){let{cellSize:n,generationRadius:i,anchored:o}=e,s=e.halo?4:0,c=new te,l=o?c.add(de,{density:he,cellSize:7,latticeMode:`xz`,height:0}):c.add(le,{count:Math.round(he*(n+2*s)**2)}),d=c.add(p,{name:`density`,tupleSize:1,value:u(ee(t,{seed:ge,frequency:.02,octaves:3}),-1,1,0,1)}),f=c.add(ce,{mode:`probabilistic`}),re=c.add(ae,{radius:4,countAttr:`nbrCount`}),m=c.add(oe,{mode:`inside`}),h=c.add(p,{name:`scale`,tupleSize:3,value:(()=>{let e=u(r(fe(`nbrCount`),2,16),2,16,.4,1.35),t=ne(e,u(ue(`rock`),0,1,.85,1.15));return se(t,t,t)})()}),g=c.add(a,{assetId:`rock`});return c.connect(l,`out`,d,`in`),c.connect(d,`out`,f,`in`),c.connect(f,`out`,re,`in`),c.connect(re,`out`,m,`in`),c.connect(m,`out`,h,`in`),c.connect(h,`out`,g,`in`),c.output(g,`instances`,`instances`),{name:`rocks`,cellSize:n,generationRadius:i,graph:c,bind(e,t){e.setParam(l,`boundsMin`,[t.min[0]-s,0,t.min[1]-s]),e.setParam(l,`boundsMax`,[t.max[0]+s,0,t.max[1]+s]);let n=o?t.worldSeed:t.seed;e.setParam(l,`seed`,n),e.setParam(f,`seed`,ie(n,1)),e.setParam(h,`seed`,ie(n,2)),e.setParam(m,`boundsMin`,[t.min[0],-1,t.min[1]]),e.setParam(m,`boundsMax`,[t.max[0],1,t.max[1]])}}}function ye(e){return e instanceof Error?e.message:String(e)}function be(e){let t=(e?.description??``)===``?e?.device:e?.description;return[e?.vendor,e?.architecture,t].filter(e=>typeof e==`string`&&e!==``).join(` · `)||`adapter (no info exposed)`}async function xe(e){let t=navigator.gpu;if(t===void 0)return{error:`navigator.gpu is missing — this browser has no WebGPU.`};try{let n=await t.requestAdapter();if(n===null)return{error:`navigator.gpu.requestAdapter() returned null — no compatible GPU adapter.`};let r=n.info,i=await n.requestDevice(),a=i.lost;return a!==void 0&&a.then(t=>{e(`${t?.reason??`unknown`}: ${t?.message??`no detail`}`)}),{device:i,info:r,label:be(r)}}catch(e){return{error:`requestDevice() failed: ${ye(e)}`}}}function Se(e){let t=e.info===void 0?{}:{adapterInfo:e.info};return{derived:new g(e.device,{...t,acceptDerivedSpecs:!0}),strict:new g(e.device,t)}}var Ce=class{cacheSalt;residentTerminals;acceptDerivedSpecs;base;seen=new Set;constructor(e){this.base=e,this.cacheSalt=e.cacheSalt,this.residentTerminals=e.residentTerminals,this.acceptDerivedSpecs=e.acceptDerivedSpecs}resolveField(e,t,n){return n!==void 0&&this.seen.add(n),this.base.resolveField(e,t,n)}planRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.planRun(e,t,n)}executeRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.executeRun(e,t,n)}drain(){if(this.seen.size===0)return;let e=i();for(let t of this.seen){e.dispatches+=t.dispatches,e.pipelinesCompiled+=t.pipelinesCompiled,e.pipelineCacheHits+=t.pipelineCacheHits,e.residentRuns+=t.residentRuns,e.fusedNodes+=t.fusedNodes,e.readbacksSaved+=t.readbacksSaved;for(let[n,r]of Object.entries(t.fallbacks))e.fallbacks[n]=(e.fallbacks[n]??0)+r}return this.seen.clear(),e}};function we(e){let t=Object.entries(e).sort(([e],[t])=>e.localeCompare(t));return t.length===0?`none`:t.map(([e,t])=>`${e} ×${t}`).join(`, `)}var _=1,v=18,y=140,b=`gpu`,x=!0,S=20,C=!0,w=!0,T=!0,Te=7,Ee=12,De=8,Oe=5e3;function ke(e){return e instanceof Error?e.message:String(e)}var{scene:E,camera:D,start:Ae}=h({cameraPosition:[0,26,0],orbit:!1,fog:{near:140,far:640},far:1600}),je=new e(new o(4e3,4e3),new c({color:1449515,roughness:1}));je.rotation.x=-Math.PI/2,je.position.y=-.03,E.add(je);var Me=40,O;function Ne(){O&&(E.remove(O),O.geometry.dispose(),O.material.dispose());let e=new n(S*Me,Me,4158656,2903936),t=e.material;t.transparent=!0,t.opacity=.45,t.depthWrite=!1,e.position.y=.02,e.visible=T,E.add(e),O=e}function Pe(){!O||!O.visible||(O.position.x=Math.round(D.position.x/S)*S,O.position.z=Math.round(D.position.z/S)*S)}var Fe=new c({color:8028816,roughness:.95,flatShading:!0}),Ie=new c({color:6121077,roughness:1,flatShading:!0}),Le={megarock:{geometry:new l(1).translate(0,.62,0),material:Ie},rock:{geometry:new re(.55).translate(0,.33,0),material:Fe}},k,Re,A=`requesting…`,j,M=!1,ze=``,N;function P(){return k!==void 0&&!M}function Be(){if(!(b===`cpu`||!P()))return x?k:Re}function Ve(e,t){let n=e*1.25/t+1.5;return Math.max(256,Math.ceil(Math.PI*n*n))}function He(e){let t=0;for(let n of Object.keys(e))for(let r of e[n])if(r.kind===`instances`)for(let e of r.batches)t+=e.count;return t}var F,Ue=0,I,We=0,L=!1,Ge=0;function R(){F&&(F.disposed=!0,F.abort.abort(),F.binding.dispose(),E.remove(F.group));let e=new s;E.add(e);let t=new pe({group:e,assets:Le}),n=new Map,r=Be(),i={world:void 0,group:e,binding:t,cellInstances:n,tap:r===void 0?void 0:new Ce(r),abort:new AbortController,disposed:!1};i.world=new f({seed:_,levels:[_e(),ve({cellSize:S,generationRadius:y,anchored:C,halo:w})],maxCellsPerLevel:Ve(y,S),...i.tap===void 0?{}:{gpu:i.tap},onCellReady:(e,r,a)=>{i.disposed||(t.cellReady(e,r,a),n.set(`${e}|${r[0]},${r[1]}`,He(a)))},onCellEvicted:(e,r)=>{i.disposed||(t.cellEvicted(e,r),n.delete(`${e}|${r[0]},${r[1]}`))}}),F=i,Ue=0,N=void 0,I=void 0,dt(),Ke(i,Ee)}function Ke(e,t){let n=++Ge;$=!0,We=performance.now(),e.world.update([D.position.x,0,D.position.z],{budgetMs:t,maxCooksPerUpdate:De,signal:e.abort.signal,...e.tap===void 0?{}:{gpu:e.tap}}).then(t=>{if(e.disposed)return;Ue=t.pending,I=t.elapsedMs;let n=e.tap?.drain();n!==void 0&&(N=n),dt(),L&&(L=!1,Z(ut()))}).catch(t=>{t instanceof d||(console.error(t),e.disposed||Z(`update failed: ${ke(t)}`))}).finally(()=>{n===Ge&&($=!1)})}var z=0,qe=0,B=new Set;window.addEventListener(`keydown`,e=>{let t=e.key.toLowerCase();if(t===`g`){J(b===`gpu`?`cpu`:`gpu`);return}B.add(t)}),window.addEventListener(`keyup`,e=>B.delete(e.key.toLowerCase())),document.addEventListener(`visibilitychange`,()=>{document.visibilityState===`visible`&&(We=performance.now())});var V=me({title:`infinite world`,info:`Unbounded landmark level + world-anchored rock cells streamed around a flying camera. Steer with A/D or arrow keys.`}),Je=document.createElement(`style`);Je.textContent=`
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
`,document.head.appendChild(Je);var Ye=V.el.querySelector(`.pcg-stats`)?.previousElementSibling??V.el;V.addSeed(_,e=>{_=e,R()}),V.addSlider(`speed`,{min:0,max:80,step:1,value:v,format:e=>`${e} u/s`},e=>{v=e}),V.addSlider(`gen radius`,{min:60,max:240,step:10,value:y,format:e=>`${e} u`},e=>{y=e,R()}),V.addSlider(`cell size`,{min:20,max:80,step:20,value:S,format:e=>`${e} u`},e=>{S=e,Ne(),R()}),V.addCheckbox(`world-anchored`,C,e=>{C=e,lt(),R()}),V.addCheckbox(`halo (4 u)`,w,e=>{w=e,R()}),V.addCheckbox(`cell grid`,T,e=>{T=e,O&&(O.visible=e),Pe()});var H=document.createElement(`div`);H.className=`pcg04-seg`;var U=document.createElement(`button`);U.type=`button`,U.textContent=`GPU per-node`;var W=document.createElement(`button`);W.type=`button`,W.textContent=`CPU`,H.append(U,W);var G=document.createElement(`p`);G.className=`pcg04-hint`,G.textContent=`G switches path · A/D or ←/→ steer`;var K=document.createElement(`div`);K.className=`pcg-row`;var Xe=document.createElement(`label`);Xe.textContent=`derived specs`;var q=document.createElement(`input`);q.type=`checkbox`,q.checked=x,q.addEventListener(`change`,()=>{x=q.checked,R()}),K.append(Xe,q),Ye.prepend(H,G,K);function J(e){if(e!==b){if(e===`gpu`&&!P()){Z(M?Q():j??`GPU path not ready yet.`);return}b=e,Y(),R(),Z(ut())}}U.addEventListener(`click`,()=>J(`gpu`)),W.addEventListener(`click`,()=>J(`cpu`));function Y(){U.setAttribute(`aria-pressed`,String(b===`gpu`)),W.setAttribute(`aria-pressed`,String(b===`cpu`)),U.disabled=!P(),U.title=j===void 0?M?Q():``:j,q.disabled=!P()||b===`cpu`}var X=V.addStat(`adapter`),Ze=V.addStat(`fps`),Qe=V.addStat(`rock source`),$e=V.addStat(`rock cells`),et=V.addStat(`cooked / evicted`),tt=V.addStat(`pending`),nt=V.addStat(`instances`),rt=V.addStat(`position`),it=V.addStat(`cook`),at=V.addStat(`resident runs / fused members`),ot=V.addStat(`device dispatches`),st=V.addStat(`gpu fallbacks`),ct=V.addStat(`status`);function Z(e){ct(e)}function lt(){Qe(C?`pointScatterInWorld`:`pointScatterInBounds`)}function Q(){return`device lost (${ze}) — the GPU path is disabled; reload for a fresh device`}function ut(){return M?Q():b===`cpu`?`CPU path — no resolver passed to the cook`:P()?x?`GPU per-node — combinator fields accepted via acceptDerivedSpecs`:`GPU per-node — acceptDerivedSpecs off, so every field falls back`:j??`requesting WebGPU adapter…`}function dt(){if(it(I===void 0?`–`:`${I.toFixed(1)} ms`),N===void 0){at(F?.tap===void 0?`– (no GPU resolver)`:`–`),ot(`–`),st(`–`);return}at(`${N.residentRuns} / ${N.fusedNodes}`),ot(String(N.dispatches)),st(we(N.fallbacks))}V.addNote(`Drag “cell size”: the blue grid re-cells the world and the rocks do not move or resize. Untick “halo” to watch every border grow a band of undersized rocks, and “world-anchored” to watch the same drag re-roll the world from scratch.`);var ft=V.addCollapsible(`anchoring · what the fine level actually does`);ft.textContent=`pointScatterInWorld scatters over an INFINITE lattice fixed to
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
anything that has to see past its own bounds.`;var pt=V.addCollapsible(`diagnostics · why nothing fuses here`);pt.textContent=`resident runs / fused members reads 0 / 0 on BOTH paths, and
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
update cooks nothing.`;function mt(e){M=!0,ze=e,A=`device lost`,X(A),Z(Q()),Y(),b===`gpu`&&(b=`cpu`,Y(),R())}async function ht(){let e=await xe(mt);if(`error`in e){j=e.error,A=`no WebGPU adapter`,X(A),b=`cpu`,Y(),Z(`${e.error} Running the CPU path.`);return}try{let t=Se(e);k=t.derived,Re=t.strict}catch(e){j=`GpuFieldEvaluator construction failed: ${ke(e)}`,A=`evaluator unavailable`,X(A),b=`cpu`,Y(),Z(`${j} Running the CPU path.`);return}M||(A=e.label,X(A),Y(),Z(ut()),b===`gpu`&&R())}var $=!1,gt=m(e=>Ze(e));X(A),Z(`requesting WebGPU adapter…`),Y(),lt(),dt(),Ne(),R(),ht(),Ae(e=>{gt(),qe=(B.has(`a`)||B.has(`arrowleft`)?1:0)-(B.has(`d`)||B.has(`arrowright`)?1:0),z+=qe*1.1*e,D.position.x+=Math.sin(z)*v*e,D.position.z+=Math.cos(z)*v*e,D.position.y=26,D.lookAt(D.position.x+Math.sin(z)*60,5,D.position.z+Math.cos(z)*60),Pe();let t=F;if(t&&!$?Ke(t,Te):$&&!L&&performance.now()-We>Oe&&(L=!0,Z(`a cook has been in flight for over 5 s — the GPU device may have been lost.`)),t){let e=t.world.stats(),n=e.levels.find(e=>e.name===`rocks`)?.cellCount??0;$e(String(n)),et(`${e.totalCooked} / ${e.totalEvicted}`),tt(String(Ue));let r=0;for(let e of t.cellInstances.values())r+=e;nt(String(r)),rt(`${D.position.x.toFixed(0)}, ${D.position.z.toFixed(0)}`)}});