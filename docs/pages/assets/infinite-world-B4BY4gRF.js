import{Ct as e,G as t,Gi as n,Hi as r,Hr as i,Ht as a,K as o,Mt as s,N as c,Oi as ee,Qi as l,Ri as te,Si as ne,Vr as u,Xi as re,Y as d,ea as ie,fi as ae,ii as oe,li as se,mi as f,pi as ce,r as p,ra as le,ri as ue,ta as de,va as fe,wa as m}from"./mobile-CZ0nlfyJ.js";import{t as h}from"./scene-CD-LAjDW.js";import{a as g}from"./debug-0LO-qV1u.js";import{t as pe}from"./worldBinding-XRrZCAsH.js";import{t as me}from"./overlay-kRRp_XKn.js";var he=.35,ge=777;function _e(){let e=new ne,t=e.add(ue,{count:170,boundsMin:[-800,0,-800],boundsMax:[800,0,800]}),n=e.add(f,{name:`scale`,tupleSize:3,value:(()=>{let e=l(le(`mega`),0,1,5,13);return ie(e,re(e,1.6),e)})()}),r=e.add(i,{assetId:`megarock`});return e.connect(t,`out`,n,`in`),e.connect(n,`out`,r,`in`),e.output(r,`instances`,`instances`),{name:`landmarks`,cellSize:`unbounded`,generationRadius:1/0,graph:e,bind(e,r){e.setParam(t,`seed`,r.seed),e.setParam(n,`seed`,fe(r.seed,9))}}}function ve(e){let{cellSize:t,generationRadius:r,anchored:a}=e,o=e.halo?4:0,s=new ne,c=a?s.add(oe,{density:he,cellSize:7,latticeMode:`xz`,height:0}):s.add(ue,{count:Math.round(he*(t+2*o)**2)}),u=s.add(f,{name:`density`,tupleSize:1,value:l(ee(te,{seed:ge,frequency:.02,octaves:3}),-1,1,0,1)}),d=s.add(ce,{mode:`probabilistic`}),p=s.add(se,{radius:4,countAttr:`nbrCount`}),m=s.add(ae,{mode:`inside`}),h=s.add(f,{name:`scale`,tupleSize:3,value:(()=>{let e=l(n(de(`nbrCount`),2,16),2,16,.4,1.35),t=re(e,l(le(`rock`),0,1,.85,1.15));return ie(t,t,t)})()}),g=s.add(i,{assetId:`rock`});return s.connect(c,`out`,u,`in`),s.connect(u,`out`,d,`in`),s.connect(d,`out`,p,`in`),s.connect(p,`out`,m,`in`),s.connect(m,`out`,h,`in`),s.connect(h,`out`,g,`in`),s.output(g,`instances`,`instances`),{name:`rocks`,cellSize:t,generationRadius:r,graph:s,bind(e,t){e.setParam(c,`boundsMin`,[t.min[0]-o,0,t.min[1]-o]),e.setParam(c,`boundsMax`,[t.max[0]+o,0,t.max[1]+o]);let n=a?t.worldSeed:t.seed;e.setParam(c,`seed`,n),e.setParam(d,`seed`,fe(n,1)),e.setParam(h,`seed`,fe(n,2)),e.setParam(m,`boundsMin`,[t.min[0],-1,t.min[1]]),e.setParam(m,`boundsMax`,[t.max[0],1,t.max[1]])}}}function ye(e){return e instanceof Error?e.message:String(e)}function be(e){let t=(e?.description??``)===``?e?.device:e?.description;return[e?.vendor,e?.architecture,t].filter(e=>typeof e==`string`&&e!==``).join(` · `)||`adapter (no info exposed)`}async function xe(e){let t=navigator.gpu;if(t===void 0)return{error:`navigator.gpu is missing — this browser has no WebGPU.`};try{let n=await t.requestAdapter();if(n===null)return{error:`navigator.gpu.requestAdapter() returned null — no compatible GPU adapter.`};let r=n.info,i=await n.requestDevice(),a=i.lost;return a!==void 0&&a.then(t=>{e(`${t?.reason??`unknown`}: ${t?.message??`no detail`}`)}),{device:i,info:r,label:be(r)}}catch(e){return{error:`requestDevice() failed: ${ye(e)}`}}}function Se(e){let t=e.info===void 0?{}:{adapterInfo:e.info};return{derived:new g(e.device,{...t,acceptDerivedSpecs:!0}),strict:new g(e.device,t)}}var Ce=class{cacheSalt;residentTerminals;acceptDerivedSpecs;base;seen=new Set;constructor(e){this.base=e,this.cacheSalt=e.cacheSalt,this.residentTerminals=e.residentTerminals,this.acceptDerivedSpecs=e.acceptDerivedSpecs}resolveField(e,t,n){return n!==void 0&&this.seen.add(n),this.base.resolveField(e,t,n)}planRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.planRun(e,t,n)}executeRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.executeRun(e,t,n)}drain(){if(this.seen.size===0)return;let e=r();for(let t of this.seen){e.dispatches+=t.dispatches,e.pipelinesCompiled+=t.pipelinesCompiled,e.pipelineCacheHits+=t.pipelineCacheHits,e.residentRuns+=t.residentRuns,e.fusedNodes+=t.fusedNodes,e.readbacksSaved+=t.readbacksSaved;for(let[n,r]of Object.entries(t.fallbacks))e.fallbacks[n]=(e.fallbacks[n]??0)+r}return this.seen.clear(),e}};function we(e){let t=Object.entries(e).sort(([e],[t])=>e.localeCompare(t));return t.length===0?`none`:t.map(([e,t])=>`${e} ×${t}`).join(`, `)}var Te=1,_=18,v=140,y=`gpu`,b=!0,x=20,S=!0,C=!0,w=!0,Ee=7,De=12,Oe=8,ke=5e3;function Ae(e){return e instanceof Error?e.message:String(e)}var{scene:T,camera:E,start:je}=h({cameraPosition:[0,26,0],orbit:!1,fog:{near:140,far:640},far:1600}),D=new e(new a(4e3,4e3),new s({color:1449515,roughness:1}));D.rotation.x=-Math.PI/2,D.position.y=-.03,T.add(D);var Me=40,O;function Ne(){O&&(T.remove(O),O.geometry.dispose(),O.material.dispose());let e=new t(x*Me,Me,4158656,2903936),n=e.material;n.transparent=!0,n.opacity=.45,n.depthWrite=!1,e.position.y=.02,e.visible=w,T.add(e),O=e}function Pe(){!O||!O.visible||(O.position.x=Math.round(E.position.x/x)*x,O.position.z=Math.round(E.position.z/x)*x)}var Fe=new s({color:8028816,roughness:.95,flatShading:!0}),Ie=new s({color:6121077,roughness:1,flatShading:!0}),Le={megarock:{geometry:new c(1).translate(0,.62,0),material:Ie},rock:{geometry:new d(.55).translate(0,.33,0),material:Fe}},Re,ze,k=`requesting…`,A,j=!1,Be=``,M;function N(){return Re!==void 0&&!j}function Ve(){if(!(y===`cpu`||!N()))return b?Re:ze}function He(e,t){let n=e*1.25/t+1.5;return Math.max(256,Math.ceil(Math.PI*n*n))}function Ue(e){let t=0;for(let n of Object.keys(e))for(let r of e[n])if(r.kind===`instances`)for(let e of r.batches)t+=e.count;return t}var P,F=0,I,We=0,L=!1,Ge=0;function R(){P&&(P.disposed=!0,P.abort.abort(),P.binding.dispose(),T.remove(P.group));let e=new o;T.add(e);let t=new pe({group:e,assets:Le}),n=new Map,r=Ve(),i={world:void 0,group:e,binding:t,cellInstances:n,tap:r===void 0?void 0:new Ce(r),abort:new AbortController,disposed:!1};i.world=new u({seed:Te,levels:[_e(),ve({cellSize:x,generationRadius:v,anchored:S,halo:C})],maxCellsPerLevel:He(v,x),...i.tap===void 0?{}:{gpu:i.tap},onCellReady:(e,r,a)=>{i.disposed||(t.cellReady(e,r,a),n.set(`${e}|${r[0]},${r[1]}`,Ue(a)))},onCellEvicted:(e,r)=>{i.disposed||(t.cellEvicted(e,r),n.delete(`${e}|${r[0]},${r[1]}`))}}),P=i,F=0,M=void 0,I=void 0,dt(),Ke(i,De)}function Ke(e,t){let n=++Ge;$=!0,We=performance.now(),e.world.update([E.position.x,0,E.position.z],{budgetMs:t,maxCooksPerUpdate:Oe,signal:e.abort.signal,...e.tap===void 0?{}:{gpu:e.tap}}).then(t=>{if(e.disposed)return;F=t.pending,I=t.elapsedMs;let n=e.tap?.drain();n!==void 0&&(M=n),dt(),L&&(L=!1,Z(ut()))}).catch(t=>{t instanceof m||(console.error(t),e.disposed||Z(`update failed: ${Ae(t)}`))}).finally(()=>{n===Ge&&($=!1)})}var z=0,qe=0,B=new Set;window.addEventListener(`keydown`,e=>{let t=e.key.toLowerCase();if(t===`g`){J(y===`gpu`?`cpu`:`gpu`);return}B.add(t)}),window.addEventListener(`keyup`,e=>B.delete(e.key.toLowerCase())),document.addEventListener(`visibilitychange`,()=>{document.visibilityState===`visible`&&(We=performance.now())});var V=me({title:`infinite world`,info:`Unbounded landmark level + world-anchored rock cells streamed around a flying camera. Steer with A/D or arrow keys.`}),Je=document.createElement(`style`);Je.textContent=`
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
`,document.head.appendChild(Je);var Ye=V.el.querySelector(`.pcg-stats`)?.previousElementSibling??V.el;V.addSeed(Te,e=>{Te=e,R()}),V.addSlider(`speed`,{min:0,max:80,step:1,value:_,format:e=>`${e} u/s`},e=>{_=e}),V.addSlider(`gen radius`,{min:60,max:240,step:10,value:v,format:e=>`${e} u`},e=>{v=e,R()}),V.addSlider(`cell size`,{min:20,max:80,step:20,value:x,format:e=>`${e} u`},e=>{x=e,Ne(),R()}),V.addCheckbox(`world-anchored`,S,e=>{S=e,lt(),R()}),V.addCheckbox(`halo (4 u)`,C,e=>{C=e,R()}),V.addCheckbox(`cell grid`,w,e=>{w=e,O&&(O.visible=e),Pe()});var H=document.createElement(`div`);H.className=`pcg04-seg`;var U=document.createElement(`button`);U.type=`button`,U.textContent=`GPU per-node`;var W=document.createElement(`button`);W.type=`button`,W.textContent=`CPU`,H.append(U,W);var G=document.createElement(`p`);G.className=`pcg04-hint`,G.textContent=`G switches path · A/D or ←/→ steer`;var K=document.createElement(`div`);K.className=`pcg-row`;var Xe=document.createElement(`label`);Xe.textContent=`derived specs`;var q=document.createElement(`input`);q.type=`checkbox`,q.checked=b,q.addEventListener(`change`,()=>{b=q.checked,R()}),K.append(Xe,q),Ye.prepend(H,G,K);function J(e){if(e!==y){if(e===`gpu`&&!N()){Z(j?Q():A??`GPU path not ready yet.`);return}y=e,Y(),R(),Z(ut())}}U.addEventListener(`click`,()=>J(`gpu`)),W.addEventListener(`click`,()=>J(`cpu`));function Y(){U.setAttribute(`aria-pressed`,String(y===`gpu`)),W.setAttribute(`aria-pressed`,String(y===`cpu`)),U.disabled=!N(),U.title=A===void 0?j?Q():``:A,q.disabled=!N()||y===`cpu`}var X=V.addStat(`adapter`),Ze=V.addStat(`fps`),Qe=V.addStat(`rock source`),$e=V.addStat(`rock cells`),et=V.addStat(`cooked / evicted`),tt=V.addStat(`pending`),nt=V.addStat(`instances`),rt=V.addStat(`position`),it=V.addStat(`cook`),at=V.addStat(`resident runs / fused members`),ot=V.addStat(`device dispatches`),st=V.addStat(`gpu fallbacks`),ct=V.addStat(`status`);function Z(e){ct(e)}function lt(){Qe(S?`pointScatterInWorld`:`pointScatterInBounds`)}function Q(){return`device lost (${Be}) — the GPU path is disabled; reload for a fresh device`}function ut(){return j?Q():y===`cpu`?`CPU path — no resolver passed to the cook`:N()?b?`GPU per-node — combinator fields accepted via acceptDerivedSpecs`:`GPU per-node — acceptDerivedSpecs off, so every field falls back`:A??`requesting WebGPU adapter…`}function dt(){if(it(I===void 0?`–`:`${I.toFixed(1)} ms`),M===void 0){at(P?.tap===void 0?`– (no GPU resolver)`:`–`),ot(`–`),st(`–`);return}at(`${M.residentRuns} / ${M.fusedNodes}`),ot(String(M.dispatches)),st(we(M.fallbacks))}V.addNote(`Drag “cell size”: the blue grid re-cells the world and the rocks do not move or resize. Untick “halo” to watch every border grow a band of undersized rocks, and “world-anchored” to watch the same drag re-roll the world from scratch.`);var ft=V.addCollapsible(`anchoring · what the fine level actually does`);ft.textContent=`pointScatterInWorld scatters over an INFINITE lattice fixed to
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
update cooks nothing.`;function mt(e){j=!0,Be=e,k=`device lost`,X(k),Z(Q()),Y(),y===`gpu`&&(y=`cpu`,Y(),R())}async function ht(){let e=await xe(mt);if(`error`in e){A=e.error,k=`no WebGPU adapter`,X(k),y=`cpu`,Y(),Z(`${e.error} Running the CPU path.`);return}try{let t=Se(e);Re=t.derived,ze=t.strict}catch(e){A=`GpuFieldEvaluator construction failed: ${Ae(e)}`,k=`evaluator unavailable`,X(k),y=`cpu`,Y(),Z(`${A} Running the CPU path.`);return}j||(k=e.label,X(k),Y(),Z(ut()),y===`gpu`&&R())}var $=!1,gt=p(e=>Ze(e));X(k),Z(`requesting WebGPU adapter…`),Y(),lt(),dt(),Ne(),R(),ht(),je(e=>{gt(),qe=(B.has(`a`)||B.has(`arrowleft`)?1:0)-(B.has(`d`)||B.has(`arrowright`)?1:0),z+=qe*1.1*e,E.position.x+=Math.sin(z)*_*e,E.position.z+=Math.cos(z)*_*e,E.position.y=26,E.lookAt(E.position.x+Math.sin(z)*60,5,E.position.z+Math.cos(z)*60),Pe();let t=P;if(t&&!$?Ke(t,Ee):$&&!L&&performance.now()-We>ke&&(L=!0,Z(`a cook has been in flight for over 5 s — the GPU device may have been lost.`)),t){let e=t.world.stats(),n=e.levels.find(e=>e.name===`rocks`)?.cellCount??0;$e(String(n)),et(`${e.totalCooked} / ${e.totalEvicted}`),tt(String(F));let r=0;for(let e of t.cellInstances.values())r+=e;nt(String(r)),rt(`${E.position.x.toFixed(0)}, ${E.position.z.toFixed(0)}`)}});