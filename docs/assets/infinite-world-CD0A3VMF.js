import{Aa as e,Ao as t,D as n,Fo as r,Ha as i,Ka as a,So as ee,Xa as o,Yt as te,Zo as ne,_t as re,ao as ie,bt as s,cs as ae,da as oe,fo as se,gt as c,in as l,ja as ce,jo as u,ks as d,la as f,mn as p,ns as m,ps as le,qa as ue,r as h,rt as g,ss as de}from"./wordmark-DBxhtYW2.js";import{t as _}from"./scene-VKAL322z.js";import{a as fe}from"./debug-CTlp9TzD.js";import{t as pe}from"./worldBinding-B9R7KCjj.js";import{n as me,t as he}from"./panel-ChUI7D04.js";var ge=.35,_e=777;function ve(){let t=new ie,n=t.add(e,{count:170,boundsMin:[-800,0,-800],boundsMax:[800,0,800]}),r=t.add(o,{name:`scale`,tupleSize:3,value:(()=>{let e=m(le(`mega`),0,1,5,13);return de(e,ne(e,1.6),e)})()}),i=t.add(oe,{assetId:`megarock`});return t.connect(n,`out`,r,`in`),t.connect(r,`out`,i,`in`),t.output(i,`instances`,`instances`),{name:`landmarks`,cellSize:`unbounded`,generationRadius:1/0,graph:t,bind(e,t){e.setParam(n,`seed`,t.seed),e.setParam(r,`seed`,d(t.seed,9))}}}function ye(t){let{cellSize:n,generationRadius:te,anchored:re}=t,s=t.halo?4:0,c=new ie,l=re?c.add(ce,{density:ge,cellSize:7,latticeMode:`xz`,height:0}):c.add(e,{count:Math.round(ge*(n+2*s)**2)}),u=c.add(o,{name:`density`,tupleSize:1,value:m(se(ee,{seed:_e,frequency:.02,octaves:3}),-1,1,0,1)}),f=c.add(ue,{mode:`probabilistic`}),p=c.add(i,{radius:4,countAttr:`nbrCount`}),h=c.add(a,{mode:`inside`}),g=c.add(o,{name:`scale`,tupleSize:3,value:(()=>{let e=m(r(ae(`nbrCount`),2,16),2,16,.4,1.35),t=ne(e,m(le(`rock`),0,1,.85,1.15));return de(t,t,t)})()}),_=c.add(oe,{assetId:`rock`});return c.connect(l,`out`,u,`in`),c.connect(u,`out`,f,`in`),c.connect(f,`out`,p,`in`),c.connect(p,`out`,h,`in`),c.connect(h,`out`,g,`in`),c.connect(g,`out`,_,`in`),c.output(_,`instances`,`instances`),{name:`rocks`,cellSize:n,generationRadius:te,graph:c,bind(e,t){e.setParam(l,`boundsMin`,[t.min[0]-s,0,t.min[1]-s]),e.setParam(l,`boundsMax`,[t.max[0]+s,0,t.max[1]+s]);let n=re?t.worldSeed:t.seed;e.setParam(l,`seed`,n),e.setParam(f,`seed`,d(n,1)),e.setParam(g,`seed`,d(n,2)),e.setParam(h,`boundsMin`,[t.min[0],-1,t.min[1]]),e.setParam(h,`boundsMax`,[t.max[0],1,t.max[1]])}}}function be(e){return e instanceof Error?e.message:String(e)}function xe(e){let t=(e?.description??``)===``?e?.device:e?.description;return[e?.vendor,e?.architecture,t].filter(e=>typeof e==`string`&&e!==``).join(` · `)||`adapter (no info exposed)`}async function Se(e){let t=navigator.gpu;if(t===void 0)return{error:`navigator.gpu is missing — this browser has no WebGPU.`};try{let n=await t.requestAdapter();if(n===null)return{error:`navigator.gpu.requestAdapter() returned null — no compatible GPU adapter.`};let r=n.info,i=await n.requestDevice(),a=i.lost;return a!==void 0&&a.then(t=>{e(`${t?.reason??`unknown`}: ${t?.message??`no detail`}`)}),{device:i,info:r,label:xe(r)}}catch(e){return{error:`requestDevice() failed: ${be(e)}`}}}function Ce(e){let t=e.info===void 0?{}:{adapterInfo:e.info};return{derived:new fe(e.device,{...t,acceptDerivedSpecs:!0}),strict:new fe(e.device,t)}}var we=class{cacheSalt;residentTerminals;acceptDerivedSpecs;base;seen=new Set;constructor(e){this.base=e,this.cacheSalt=e.cacheSalt,this.residentTerminals=e.residentTerminals,this.acceptDerivedSpecs=e.acceptDerivedSpecs}resolveField(e,t,n){return n!==void 0&&this.seen.add(n),this.base.resolveField(e,t,n)}planRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.planRun(e,t,n)}executeRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.executeRun(e,t,n)}drain(){if(this.seen.size===0)return;let e=u();for(let t of this.seen){e.dispatches+=t.dispatches,e.pipelinesCompiled+=t.pipelinesCompiled,e.pipelineCacheHits+=t.pipelineCacheHits,e.residentRuns+=t.residentRuns,e.fusedNodes+=t.fusedNodes,e.readbacksSaved+=t.readbacksSaved;for(let[n,r]of Object.entries(t.fallbacks))e.fallbacks[n]=(e.fallbacks[n]??0)+r}return this.seen.clear(),e}};function Te(e){let t=Object.entries(e).sort(([e],[t])=>e.localeCompare(t));return t.length===0?`none`:t.map(([e,t])=>`${e} ×${t}`).join(`, `)}var v=1,y=18,b=140,x=`gpu`,S=!0,C=20,w=!0,T=!0,E=!0,Ee=7,De=12,Oe=8,ke=5e3;function Ae(e){return e instanceof Error?e.message:String(e)}var{scene:D,camera:O,start:je}=_({cameraPosition:[0,26,0],orbit:!1,fog:{near:140,far:640},far:1600}),Me=new te(new p(4e3,4e3),new l({color:1449515,roughness:1}));Me.rotation.x=-Math.PI/2,Me.position.y=-.03,D.add(Me);var Ne=40,k;function Pe(){k&&(D.remove(k),k.geometry.dispose(),k.material.dispose());let e=new c(C*Ne,Ne,4158656,2903936),t=e.material;t.transparent=!0,t.opacity=.45,t.depthWrite=!1,e.position.y=.02,e.visible=E,D.add(e),k=e}function Fe(){!k||!k.visible||(k.position.x=Math.round(O.position.x/C)*C,k.position.z=Math.round(O.position.z/C)*C)}var Ie=new l({color:8028816,roughness:.95,flatShading:!0}),Le=new l({color:6121077,roughness:1,flatShading:!0}),Re={megarock:{geometry:new g(1).translate(0,.62,0),material:Le},rock:{geometry:new s(.55).translate(0,.33,0),material:Ie}},ze,Be,A=`requesting…`,j,M=!1,Ve=``,N;function P(){return ze!==void 0&&!M}function He(){if(!(x===`cpu`||!P()))return S?ze:Be}var F;function Ue(e,t){let n=[{name:`landmarks`,graph:e},{name:`rocks`,graph:t}];F?F.set(n):F=he(n,{into:gt,title:`infinite world`})}function We(e,t){let n=e*1.25/t+1.5;return Math.max(256,Math.ceil(Math.PI*n*n))}function Ge(e){let t=0;for(let n of Object.keys(e))for(let r of e[n])if(r.kind===`instances`)for(let e of r.batches)t+=e.count;return t}var I,L=0,R,z=0,B=!1,Ke=0;function V(){I&&(I.disposed=!0,I.abort.abort(),I.binding.dispose(),D.remove(I.group));let e=new re;D.add(e);let t=new pe({group:e,assets:Re}),n=new Map,r=He(),i={world:void 0,group:e,binding:t,cellInstances:n,tap:r===void 0?void 0:new we(r),abort:new AbortController,disposed:!1},a=[ve(),ye({cellSize:C,generationRadius:b,anchored:w,halo:T})];Ue(a[0].graph,a[1].graph),i.world=new f({seed:v,levels:a,maxCellsPerLevel:We(b,C),...i.tap===void 0?{}:{gpu:i.tap},onCellReady:(e,r,a)=>{i.disposed||(t.cellReady(e,r,a),n.set(`${e}|${r[0]},${r[1]}`,Ge(a)))},onCellEvicted:(e,r)=>{i.disposed||(t.cellEvicted(e,r),n.delete(`${e}|${r[0]},${r[1]}`))}}),I=i,L=0,N=void 0,R=void 0,ht(),qe(i,De)}function qe(e,n){let r=++Ke;$=!0,z=performance.now(),e.world.update([O.position.x,0,O.position.z],{budgetMs:n,maxCooksPerUpdate:Oe,signal:e.abort.signal,...e.tap===void 0?{}:{gpu:e.tap}}).then(t=>{if(e.disposed)return;L=t.pending,R=t.elapsedMs;let n=e.tap?.drain();n!==void 0&&(N=n),ht(),B&&(B=!1,Z(mt()))}).catch(n=>{n instanceof t||(console.error(n),e.disposed||Z(`update failed: ${Ae(n)}`))}).finally(()=>{r===Ke&&($=!1)})}var H=0,Je=0,U=new Set;window.addEventListener(`keydown`,e=>{let t=e.key.toLowerCase();if(t===`g`){et(x===`gpu`?`cpu`:`gpu`);return}U.add(t)}),window.addEventListener(`keyup`,e=>U.delete(e.key.toLowerCase())),document.addEventListener(`visibilitychange`,()=>{document.visibilityState===`visible`&&(z=performance.now())});var W=me({title:`infinite world`,info:`Unbounded landmark level + world-anchored rock cells streamed around a flying camera. Steer with A/D or arrow keys.`}),Ye=document.createElement(`style`);Ye.textContent=`
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
`,document.head.appendChild(Ye);var Xe=W.el.querySelector(`.pcg-stats`)?.previousElementSibling??W.el;W.addSeed(v,e=>{v=e,V()}),W.addSlider(`speed`,{min:0,max:80,step:1,value:y,format:e=>`${e} u/s`},e=>{y=e}),W.addSlider(`gen radius`,{min:60,max:240,step:10,value:b,format:e=>`${e} u`},e=>{b=e,V()}),W.addSlider(`cell size`,{min:20,max:80,step:20,value:C,format:e=>`${e} u`},e=>{C=e,Pe(),V()}),W.addCheckbox(`world-anchored`,w,e=>{w=e,pt(),V()}),W.addCheckbox(`halo (4 u)`,T,e=>{T=e,V()}),W.addCheckbox(`cell grid`,E,e=>{E=e,k&&(k.visible=e),Fe()});var G=document.createElement(`div`);G.className=`pcg04-seg`;var K=document.createElement(`button`);K.type=`button`,K.textContent=`GPU per-node`;var q=document.createElement(`button`);q.type=`button`,q.textContent=`CPU`,G.append(K,q);var Ze=document.createElement(`p`);Ze.className=`pcg04-hint`,Ze.textContent=`G switches path · A/D or ←/→ steer`;var Qe=document.createElement(`div`);Qe.className=`pcg-row`;var $e=document.createElement(`label`);$e.textContent=`derived specs`;var J=document.createElement(`input`);J.type=`checkbox`,J.checked=S,J.addEventListener(`change`,()=>{S=J.checked,V()}),Qe.append($e,J),Xe.prepend(G,Ze,Qe);function et(e){if(e!==x){if(e===`gpu`&&!P()){Z(M?Q():j??`GPU path not ready yet.`);return}x=e,Y(),V(),Z(mt())}}K.addEventListener(`click`,()=>et(`gpu`)),q.addEventListener(`click`,()=>et(`cpu`));function Y(){K.setAttribute(`aria-pressed`,String(x===`gpu`)),q.setAttribute(`aria-pressed`,String(x===`cpu`)),K.disabled=!P(),K.title=j===void 0?M?Q():``:j,J.disabled=!P()||x===`cpu`}var X=W.addStat(`adapter`),tt=W.addStat(`fps`),nt=W.addStat(`rock source`),rt=W.addStat(`rock cells`),it=W.addStat(`cooked / evicted`),at=W.addStat(`pending`),ot=W.addStat(`instances`),st=W.addStat(`position`),ct=W.addStat(`cook`),lt=W.addStat(`resident runs / fused members`),ut=W.addStat(`device dispatches`),dt=W.addStat(`gpu fallbacks`),ft=W.addStat(`status`);function Z(e){ft(e)}function pt(){nt(w?`pointScatterInWorld`:`pointScatterInBounds`)}function Q(){return`device lost (${Ve}) — the GPU path is disabled; reload for a fresh device`}function mt(){return M?Q():x===`cpu`?`CPU path — no resolver passed to the cook`:P()?S?`GPU per-node — combinator fields accepted via acceptDerivedSpecs`:`GPU per-node — acceptDerivedSpecs off, so every field falls back`:j??`requesting WebGPU adapter…`}function ht(){if(ct(R===void 0?`–`:`${R.toFixed(1)} ms`),N===void 0){lt(I?.tap===void 0?`– (no GPU resolver)`:`–`),ut(`–`),dt(`–`);return}lt(`${N.residentRuns} / ${N.fusedNodes}`),ut(String(N.dispatches)),dt(Te(N.fallbacks))}var gt=W.addSlot();h(),W.addNote(`Drag “cell size”: the blue grid re-cells the world and the rocks do not move or resize. Untick “halo” to watch every border grow a band of undersized rocks, and “world-anchored” to watch the same drag re-roll the world from scratch.`);var _t=W.addCollapsible(`anchoring · what the fine level actually does`);_t.textContent=`pointScatterInWorld scatters over an INFINITE lattice fixed to
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
anything that has to see past its own bounds.`;var vt=W.addCollapsible(`diagnostics · why nothing fuses here`);vt.textContent=`resident runs / fused members reads 0 / 0 on BOTH paths, and
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
update cooks nothing.`;function yt(e){M=!0,Ve=e,A=`device lost`,X(A),Z(Q()),Y(),x===`gpu`&&(x=`cpu`,Y(),V())}async function bt(){let e=await Se(yt);if(`error`in e){j=e.error,A=`no WebGPU adapter`,X(A),x=`cpu`,Y(),Z(`${e.error} Running the CPU path.`);return}try{let t=Ce(e);ze=t.derived,Be=t.strict}catch(e){j=`GpuFieldEvaluator construction failed: ${Ae(e)}`,A=`evaluator unavailable`,X(A),x=`cpu`,Y(),Z(`${j} Running the CPU path.`);return}M||(A=e.label,X(A),Y(),Z(mt()),x===`gpu`&&V())}var $=!1,xt=n(e=>tt(e));X(A),Z(`requesting WebGPU adapter…`),Y(),pt(),ht(),Pe(),V(),bt(),je(e=>{xt(),Je=(U.has(`a`)||U.has(`arrowleft`)?1:0)-(U.has(`d`)||U.has(`arrowright`)?1:0),H+=Je*1.1*e,O.position.x+=Math.sin(H)*y*e,O.position.z+=Math.cos(H)*y*e,O.position.y=26,O.lookAt(O.position.x+Math.sin(H)*60,5,O.position.z+Math.cos(H)*60),Fe();let t=I;if(t&&!$?qe(t,Ee):$&&!B&&performance.now()-z>ke&&(B=!0,Z(`a cook has been in flight for over 5 s — the GPU device may have been lost.`)),t){let e=t.world.stats(),n=e.levels.find(e=>e.name===`rocks`)?.cellCount??0;rt(String(n)),it(`${e.totalCooked} / ${e.totalEvicted}`),at(String(L));let r=0;for(let e of t.cellInstances.values())r+=e;ot(String(r)),st(`${O.position.x.toFixed(0)}, ${O.position.z.toFixed(0)}`)}});