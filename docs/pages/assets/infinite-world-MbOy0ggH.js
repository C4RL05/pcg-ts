import{Aa as e,Ao as t,D as n,Ha as r,Ka as i,Os as a,Po as ee,So as te,Xa as o,Xo as ne,Yt as re,_t as s,ao as ie,bt as c,da as ae,fo as oe,fs as se,gt as l,in as u,ja as ce,ko as d,la as f,mn as p,os as le,qa as ue,r as m,rt as h,ss as de,ts as g}from"./wordmark-DlQk1LJM.js";import{t as _}from"./scene-EMKaqTOq.js";import{a as fe}from"./debug-BcvKWgwT.js";import{t as pe}from"./worldBinding-CKhvpXkw.js";import{n as me,t as he}from"./panel-BXM848Pr.js";var ge=.35,_e=777;function ve(){let t=new ie,n=t.add(e,{count:170,boundsMin:[-800,0,-800],boundsMax:[800,0,800]}),r=t.add(o,{name:`scale`,tupleSize:3,value:(()=>{let e=g(se(`mega`),0,1,5,13);return le(e,ne(e,1.6),e)})()}),i=t.add(ae,{assetId:`megarock`});return t.connect(n,`out`,r,`in`),t.connect(r,`out`,i,`in`),t.output(i,`instances`,`instances`),{name:`landmarks`,cellSize:`unbounded`,generationRadius:1/0,graph:t,bind(e,t){e.setParam(n,`seed`,t.seed),e.setParam(r,`seed`,a(t.seed,9))}}}function ye(t){let{cellSize:n,generationRadius:re,anchored:s}=t,c=t.halo?4:0,l=new ie,u=s?l.add(ce,{density:ge,cellSize:7,latticeMode:`xz`,height:0}):l.add(e,{count:Math.round(ge*(n+2*c)**2)}),d=l.add(o,{name:`density`,tupleSize:1,value:g(oe(te,{seed:_e,frequency:.02,octaves:3}),-1,1,0,1)}),f=l.add(ue,{mode:`probabilistic`}),p=l.add(r,{radius:4,countAttr:`nbrCount`}),m=l.add(i,{mode:`inside`}),h=l.add(o,{name:`scale`,tupleSize:3,value:(()=>{let e=g(ee(de(`nbrCount`),2,16),2,16,.4,1.35),t=ne(e,g(se(`rock`),0,1,.85,1.15));return le(t,t,t)})()}),_=l.add(ae,{assetId:`rock`});return l.connect(u,`out`,d,`in`),l.connect(d,`out`,f,`in`),l.connect(f,`out`,p,`in`),l.connect(p,`out`,m,`in`),l.connect(m,`out`,h,`in`),l.connect(h,`out`,_,`in`),l.output(_,`instances`,`instances`),{name:`rocks`,cellSize:n,generationRadius:re,graph:l,bind(e,t){e.setParam(u,`boundsMin`,[t.min[0]-c,0,t.min[1]-c]),e.setParam(u,`boundsMax`,[t.max[0]+c,0,t.max[1]+c]);let n=s?t.worldSeed:t.seed;e.setParam(u,`seed`,n),e.setParam(f,`seed`,a(n,1)),e.setParam(h,`seed`,a(n,2)),e.setParam(m,`boundsMin`,[t.min[0],-1,t.min[1]]),e.setParam(m,`boundsMax`,[t.max[0],1,t.max[1]])}}}function be(e){return e instanceof Error?e.message:String(e)}function xe(e){let t=(e?.description??``)===``?e?.device:e?.description;return[e?.vendor,e?.architecture,t].filter(e=>typeof e==`string`&&e!==``).join(` · `)||`adapter (no info exposed)`}async function Se(e){let t=navigator.gpu;if(t===void 0)return{error:`navigator.gpu is missing — this browser has no WebGPU.`};try{let n=await t.requestAdapter();if(n===null)return{error:`navigator.gpu.requestAdapter() returned null — no compatible GPU adapter.`};let r=n.info,i=await n.requestDevice(),a=i.lost;return a!==void 0&&a.then(t=>{e(`${t?.reason??`unknown`}: ${t?.message??`no detail`}`)}),{device:i,info:r,label:xe(r)}}catch(e){return{error:`requestDevice() failed: ${be(e)}`}}}function Ce(e){let t=e.info===void 0?{}:{adapterInfo:e.info};return{derived:new fe(e.device,{...t,acceptDerivedSpecs:!0}),strict:new fe(e.device,t)}}var we=class{cacheSalt;residentTerminals;acceptDerivedSpecs;base;seen=new Set;constructor(e){this.base=e,this.cacheSalt=e.cacheSalt,this.residentTerminals=e.residentTerminals,this.acceptDerivedSpecs=e.acceptDerivedSpecs}resolveField(e,t,n){return n!==void 0&&this.seen.add(n),this.base.resolveField(e,t,n)}planRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.planRun(e,t,n)}executeRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.executeRun(e,t,n)}drain(){if(this.seen.size===0)return;let e=t();for(let t of this.seen){e.dispatches+=t.dispatches,e.pipelinesCompiled+=t.pipelinesCompiled,e.pipelineCacheHits+=t.pipelineCacheHits,e.residentRuns+=t.residentRuns,e.fusedNodes+=t.fusedNodes,e.readbacksSaved+=t.readbacksSaved;for(let[n,r]of Object.entries(t.fallbacks))e.fallbacks[n]=(e.fallbacks[n]??0)+r}return this.seen.clear(),e}};function Te(e){let t=Object.entries(e).sort(([e],[t])=>e.localeCompare(t));return t.length===0?`none`:t.map(([e,t])=>`${e} ×${t}`).join(`, `)}var Ee=1,v=18,y=140,b=`gpu`,x=!0,S=20,C=!0,w=!0,T=!0,De=7,Oe=12,ke=8,Ae=5e3;function je(e){return e instanceof Error?e.message:String(e)}var{scene:E,camera:D,start:Me}=_({cameraPosition:[0,26,0],orbit:!1,fog:{near:140,far:640},far:1600}),O=new re(new p(4e3,4e3),new u({color:1449515,roughness:1}));O.rotation.x=-Math.PI/2,O.position.y=-.03,E.add(O);var Ne=40,k;function Pe(){k&&(E.remove(k),k.geometry.dispose(),k.material.dispose());let e=new l(S*Ne,Ne,4158656,2903936),t=e.material;t.transparent=!0,t.opacity=.45,t.depthWrite=!1,e.position.y=.02,e.visible=T,E.add(e),k=e}function Fe(){!k||!k.visible||(k.position.x=Math.round(D.position.x/S)*S,k.position.z=Math.round(D.position.z/S)*S)}var Ie=new u({color:8028816,roughness:.95,flatShading:!0}),Le=new u({color:6121077,roughness:1,flatShading:!0}),Re={megarock:{geometry:new h(1).translate(0,.62,0),material:Le},rock:{geometry:new c(.55).translate(0,.33,0),material:Ie}},A,ze,j=`requesting…`,M,N=!1,Be=``,P;function F(){return A!==void 0&&!N}function Ve(){if(!(b===`cpu`||!F()))return x?A:ze}var I;function He(e,t){let n=[{name:`landmarks`,graph:e},{name:`rocks`,graph:t}];I?I.set(n):I=he(n,{into:gt,title:`infinite world`})}function Ue(e,t){let n=e*1.25/t+1.5;return Math.max(256,Math.ceil(Math.PI*n*n))}function We(e){let t=0;for(let n of Object.keys(e))for(let r of e[n])if(r.kind===`instances`)for(let e of r.batches)t+=e.count;return t}var L,R=0,z,Ge=0,B=!1,Ke=0;function V(){L&&(L.disposed=!0,L.abort.abort(),L.binding.dispose(),E.remove(L.group));let e=new s;E.add(e);let t=new pe({group:e,assets:Re}),n=new Map,r=Ve(),i={world:void 0,group:e,binding:t,cellInstances:n,tap:r===void 0?void 0:new we(r),abort:new AbortController,disposed:!1},a=[ve(),ye({cellSize:S,generationRadius:y,anchored:C,halo:w})];He(a[0].graph,a[1].graph),i.world=new f({seed:Ee,levels:a,maxCellsPerLevel:Ue(y,S),...i.tap===void 0?{}:{gpu:i.tap},onCellReady:(e,r,a)=>{i.disposed||(t.cellReady(e,r,a),n.set(`${e}|${r[0]},${r[1]}`,We(a)))},onCellEvicted:(e,r)=>{i.disposed||(t.cellEvicted(e,r),n.delete(`${e}|${r[0]},${r[1]}`))}}),L=i,R=0,P=void 0,z=void 0,Q(),qe(i,Oe)}function qe(e,t){let n=++Ke;$=!0,Ge=performance.now(),e.world.update([D.position.x,0,D.position.z],{budgetMs:t,maxCooksPerUpdate:ke,signal:e.abort.signal,...e.tap===void 0?{}:{gpu:e.tap}}).then(t=>{if(e.disposed)return;R=t.pending,z=t.elapsedMs;let n=e.tap?.drain();n!==void 0&&(P=n),Q(),B&&(B=!1,X(ht()))}).catch(t=>{t instanceof d||(console.error(t),e.disposed||X(`update failed: ${je(t)}`))}).finally(()=>{n===Ke&&($=!1)})}var H=0,Je=0,U=new Set;window.addEventListener(`keydown`,e=>{let t=e.key.toLowerCase();if(t===`g`){tt(b===`gpu`?`cpu`:`gpu`);return}U.add(t)}),window.addEventListener(`keyup`,e=>U.delete(e.key.toLowerCase())),document.addEventListener(`visibilitychange`,()=>{document.visibilityState===`visible`&&(Ge=performance.now())});var W=me({title:`infinite world`,info:`Unbounded landmark level + world-anchored rock cells streamed around a flying camera. Steer with A/D or arrow keys.`}),Ye=document.createElement(`style`);Ye.textContent=`
.pcg04-seg { display: flex; gap: 6px; margin: 4px 0 4px; }
.pcg04-seg button {
  flex: 1; padding: 6px 4px; cursor: pointer; border-radius: 6px;
  border: 1px solid var(--ed-edge); background: var(--ed-well); color: var(--ed-ink-mid);
  font: 12px system-ui, sans-serif;
}
.pcg04-seg button:hover:not(:disabled) { border-color: var(--ed-accent); color: var(--ed-ink); }
.pcg04-seg button[aria-pressed="true"] { background: var(--ed-raised-hi); border-color: var(--ed-accent); color: var(--ed-ink-hi); }
.pcg04-seg button:disabled { opacity: 0.4; cursor: not-allowed; }
.pcg04-hint { margin: 0 0 10px; color: var(--ed-ink-faint); font-size: 11px; }
`,document.head.appendChild(Ye);var Xe=W.el.querySelector(`.pcg-stats`)?.previousElementSibling??W.el;W.addSeed(Ee,e=>{Ee=e,V()}),W.addSlider(`speed`,{min:0,max:80,step:1,value:v,format:e=>`${e} u/s`},e=>{v=e}),W.addSlider(`gen radius`,{min:60,max:240,step:10,value:y,format:e=>`${e} u`},e=>{y=e,V()}),W.addSlider(`cell size`,{min:20,max:80,step:20,value:S,format:e=>`${e} u`},e=>{S=e,Pe(),V()}),W.addCheckbox(`world-anchored`,C,e=>{C=e,mt(),V()}),W.addCheckbox(`halo (4 u)`,w,e=>{w=e,V()}),W.addCheckbox(`cell grid`,T,e=>{T=e,k&&(k.visible=e),Fe()});var Ze=document.createElement(`div`);Ze.className=`pcg04-seg`;var G=document.createElement(`button`);G.type=`button`,G.textContent=`GPU per-node`;var K=document.createElement(`button`);K.type=`button`,K.textContent=`CPU`,Ze.append(G,K);var Qe=document.createElement(`p`);Qe.className=`pcg04-hint`,Qe.textContent=`G switches path · A/D or ←/→ steer`;var $e=document.createElement(`div`);$e.className=`pcg-row`;var et=document.createElement(`label`);et.textContent=`derived specs`;var q=document.createElement(`input`);q.type=`checkbox`,q.checked=x,q.addEventListener(`change`,()=>{x=q.checked,V()}),$e.append(et,q),Xe.prepend(Ze,Qe,$e);function tt(e){if(e!==b){if(e===`gpu`&&!F()){X(N?Z():M??`GPU path not ready yet.`);return}b=e,J(),V(),X(ht())}}G.addEventListener(`click`,()=>tt(`gpu`)),K.addEventListener(`click`,()=>tt(`cpu`));function J(){G.setAttribute(`aria-pressed`,String(b===`gpu`)),K.setAttribute(`aria-pressed`,String(b===`cpu`)),G.disabled=!F(),G.title=M===void 0?N?Z():``:M,q.disabled=!F()||b===`cpu`}var Y=W.addStat(`adapter`),nt=W.addStat(`fps`),rt=W.addStat(`rock source`),it=W.addStat(`rock cells`),at=W.addStat(`cooked / evicted`),ot=W.addStat(`pending`),st=W.addStat(`instances`),ct=W.addStat(`position`),lt=W.addStat(`cook`),ut=W.addStat(`resident runs / fused members`),dt=W.addStat(`device dispatches`),ft=W.addStat(`gpu fallbacks`),pt=W.addStat(`status`);function X(e){pt(e)}function mt(){rt(C?`pointScatterInWorld`:`pointScatterInBounds`)}function Z(){return`device lost (${Be}) — the GPU path is disabled; reload for a fresh device`}function ht(){return N?Z():b===`cpu`?`CPU path — no resolver passed to the cook`:F()?x?`GPU per-node — combinator fields accepted via acceptDerivedSpecs`:`GPU per-node — acceptDerivedSpecs off, so every field falls back`:M??`requesting WebGPU adapter…`}function Q(){if(lt(z===void 0?`–`:`${z.toFixed(1)} ms`),P===void 0){ut(L?.tap===void 0?`– (no GPU resolver)`:`–`),dt(`–`),ft(`–`);return}ut(`${P.residentRuns} / ${P.fusedNodes}`),dt(String(P.dispatches)),ft(Te(P.fallbacks))}var gt=W.addSlot();m(),W.addNote(`Drag “cell size”: the blue grid re-cells the world and the rocks do not move or resize. Untick “halo” to watch every border grow a band of undersized rocks, and “world-anchored” to watch the same drag re-roll the world from scratch.`);var _t=W.addCollapsible(`anchoring · what the fine level actually does`);_t.textContent=`pointScatterInWorld scatters over an INFINITE lattice fixed to
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
update cooks nothing.`;function yt(e){N=!0,Be=e,j=`device lost`,Y(j),X(Z()),J(),b===`gpu`&&(b=`cpu`,J(),V())}async function bt(){let e=await Se(yt);if(`error`in e){M=e.error,j=`no WebGPU adapter`,Y(j),b=`cpu`,J(),X(`${e.error} Running the CPU path.`);return}try{let t=Ce(e);A=t.derived,ze=t.strict}catch(e){M=`GpuFieldEvaluator construction failed: ${je(e)}`,j=`evaluator unavailable`,Y(j),b=`cpu`,J(),X(`${M} Running the CPU path.`);return}N||(j=e.label,Y(j),J(),X(ht()),b===`gpu`&&V())}var $=!1,xt=n(e=>nt(e));Y(j),X(`requesting WebGPU adapter…`),J(),mt(),Q(),Pe(),V(),bt(),Me(e=>{xt(),Je=(U.has(`a`)||U.has(`arrowleft`)?1:0)-(U.has(`d`)||U.has(`arrowright`)?1:0),H+=Je*1.1*e,D.position.x+=Math.sin(H)*v*e,D.position.z+=Math.cos(H)*v*e,D.position.y=26,D.lookAt(D.position.x+Math.sin(H)*60,5,D.position.z+Math.cos(H)*60),Fe();let t=L;if(t&&!$?qe(t,De):$&&!B&&performance.now()-Ge>Ae&&(B=!0,X(`a cook has been in flight for over 5 s — the GPU device may have been lost.`)),t){let e=t.world.stats(),n=e.levels.find(e=>e.name===`rocks`)?.cellCount??0;it(String(n)),at(`${e.totalCooked} / ${e.totalEvicted}`),ot(String(R));let r=0;for(let e of t.cellInstances.values())r+=e;st(String(r)),ct(`${D.position.x.toFixed(0)}, ${D.position.z.toFixed(0)}`)}});