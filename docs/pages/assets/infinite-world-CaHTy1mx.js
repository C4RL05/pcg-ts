import{Cn as e,Cr as t,D as n,It as r,Mn as i,Nr as a,Or as o,Pr as s,Rt as ee,Yn as c,bn as te,hn as ne,in as re,nr as ie,r as l,rn as ae,rr as u,sr as oe,ti as d,yn as se,zn as ce,zr as le}from"./wordmark-Eq0WOm6o.js";import{A as f,St as p,U as m,Vt as h,W as g,jt as _,q as v}from"./three.core-B85ZZh_6.js";import{t as ue}from"./scene-QpK-6DxV.js";import{a as de}from"./debug-Bkb31jOc.js";import{t as fe}from"./worldBinding-sgdUwJHR.js";import{n as pe,t as me}from"./panel-CuO5exj5.js";var he=.35,ge=777;function _e(){let n=new i,r=n.add(ae,{count:170,boundsMin:[-800,0,-800],boundsMax:[800,0,800]}),s=n.add(e,{name:`scale`,tupleSize:3,value:(()=>{let e=o(le(`mega`),0,1,5,13);return a(e,t(e,1.6),e)})()}),c=n.add(ee,{assetId:`megarock`});return n.connect(r,`out`,s,`in`),n.connect(s,`out`,c,`in`),n.output(c,`instances`,`instances`),{name:`landmarks`,cellSize:`unbounded`,generationRadius:1/0,graph:n,bind(e,t){e.setParam(r,`seed`,t.seed),e.setParam(s,`seed`,d(t.seed,9))}}}function ve(n){let{cellSize:r,generationRadius:ie,anchored:l}=n,u=n.halo?4:0,f=new i,p=l?f.add(re,{density:he,cellSize:7,latticeMode:`xz`,height:0}):f.add(ae,{count:Math.round(he*(r+2*u)**2)}),m=f.add(e,{name:`density`,tupleSize:1,value:o(ce(c,{seed:ge,frequency:.02,octaves:3}),-1,1,0,1)}),h=f.add(te,{mode:`probabilistic`}),g=f.add(ne,{radius:4,countAttr:`nbrCount`}),_=f.add(se,{mode:`inside`}),v=f.add(e,{name:`scale`,tupleSize:3,value:(()=>{let e=o(oe(s(`nbrCount`),2,16),2,16,.4,1.35),n=t(e,o(le(`rock`),0,1,.85,1.15));return a(n,n,n)})()}),ue=f.add(ee,{assetId:`rock`});return f.connect(p,`out`,m,`in`),f.connect(m,`out`,h,`in`),f.connect(h,`out`,g,`in`),f.connect(g,`out`,_,`in`),f.connect(_,`out`,v,`in`),f.connect(v,`out`,ue,`in`),f.output(ue,`instances`,`instances`),{name:`rocks`,cellSize:r,generationRadius:ie,graph:f,bind(e,t){e.setParam(p,`boundsMin`,[t.min[0]-u,0,t.min[1]-u]),e.setParam(p,`boundsMax`,[t.max[0]+u,0,t.max[1]+u]);let n=l?t.worldSeed:t.seed;e.setParam(p,`seed`,n),e.setParam(h,`seed`,d(n,1)),e.setParam(v,`seed`,d(n,2)),e.setParam(_,`boundsMin`,[t.min[0],-1,t.min[1]]),e.setParam(_,`boundsMax`,[t.max[0],1,t.max[1]])}}}function ye(e){return e instanceof Error?e.message:String(e)}function be(e){let t=(e?.description??``)===``?e?.device:e?.description;return[e?.vendor,e?.architecture,t].filter(e=>typeof e==`string`&&e!==``).join(` · `)||`adapter (no info exposed)`}async function xe(e){let t=navigator.gpu;if(t===void 0)return{error:`navigator.gpu is missing — this browser has no WebGPU.`};try{let n=await t.requestAdapter();if(n===null)return{error:`navigator.gpu.requestAdapter() returned null — no compatible GPU adapter.`};let r=n.info,i=await n.requestDevice(),a=i.lost;return a!==void 0&&a.then(t=>{e(`${t?.reason??`unknown`}: ${t?.message??`no detail`}`)}),{device:i,info:r,label:be(r)}}catch(e){return{error:`requestDevice() failed: ${ye(e)}`}}}function Se(e){let t=e.info===void 0?{}:{adapterInfo:e.info};return{derived:new de(e.device,{...t,acceptDerivedSpecs:!0}),strict:new de(e.device,t)}}var Ce=class{cacheSalt;residentTerminals;acceptDerivedSpecs;base;seen=new Set;constructor(e){this.base=e,this.cacheSalt=e.cacheSalt,this.residentTerminals=e.residentTerminals,this.acceptDerivedSpecs=e.acceptDerivedSpecs}resolveField(e,t,n){return n!==void 0&&this.seen.add(n),this.base.resolveField(e,t,n)}planRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.planRun(e,t,n)}executeRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.executeRun(e,t,n)}drain(){if(this.seen.size===0)return;let e=u();for(let t of this.seen){e.dispatches+=t.dispatches,e.pipelinesCompiled+=t.pipelinesCompiled,e.pipelineCacheHits+=t.pipelineCacheHits,e.residentRuns+=t.residentRuns,e.fusedNodes+=t.fusedNodes,e.readbacksSaved+=t.readbacksSaved;for(let[n,r]of Object.entries(t.fallbacks))e.fallbacks[n]=(e.fallbacks[n]??0)+r}return this.seen.clear(),e}};function we(e){let t=Object.entries(e).sort(([e],[t])=>e.localeCompare(t));return t.length===0?`none`:t.map(([e,t])=>`${e} ×${t}`).join(`, `)}var Te=1,y=18,b=140,x=`gpu`,S=!0,C=20,w=!0,T=!0,E=!0,Ee=7,De=12,Oe=8,ke=5e3;function Ae(e){return e instanceof Error?e.message:String(e)}var{scene:D,camera:O,start:je}=ue({cameraPosition:[0,26,0],orbit:!1,fog:{near:140,far:640},far:1600}),k=new p(new h(4e3,4e3),new _({color:1449515,roughness:1}));k.rotation.x=-Math.PI/2,k.position.y=-.03,D.add(k);var Me=40,A;function Ne(){A&&(D.remove(A),A.geometry.dispose(),A.material.dispose());let e=new m(C*Me,Me,4158656,2903936),t=e.material;t.transparent=!0,t.opacity=.45,t.depthWrite=!1,e.position.y=.02,e.visible=E,D.add(e),A=e}function Pe(){!A||!A.visible||(A.position.x=Math.round(O.position.x/C)*C,A.position.z=Math.round(O.position.z/C)*C)}var Fe=new _({color:8028816,roughness:.95,flatShading:!0}),Ie=new _({color:6121077,roughness:1,flatShading:!0}),Le={megarock:{geometry:new f(1).translate(0,.62,0),material:Ie},rock:{geometry:new v(.55).translate(0,.33,0),material:Fe}},j,Re,M=`requesting…`,N,P=!1,ze=``,F;function I(){return j!==void 0&&!P}function Be(){if(!(x===`cpu`||!I()))return S?j:Re}var L;function Ve(e,t){let n=[{name:`landmarks`,graph:e},{name:`rocks`,graph:t}];L?L.set(n):L=me(n,{into:gt,title:`infinite world`})}function He(e,t){let n=e*1.25/t+1.5;return Math.max(256,Math.ceil(Math.PI*n*n))}function Ue(e){let t=0;for(let n of Object.keys(e))for(let r of e[n])if(r.kind===`instances`)for(let e of r.batches)t+=e.count;return t}var R,We=0,z,Ge=0,B=!1,Ke=0;function V(){R&&(R.disposed=!0,R.abort.abort(),R.binding.dispose(),D.remove(R.group));let e=new g;D.add(e);let t=new fe({group:e,assets:Le}),n=new Map,i=Be(),a={world:void 0,group:e,binding:t,cellInstances:n,tap:i===void 0?void 0:new Ce(i),abort:new AbortController,disposed:!1},o=[_e(),ve({cellSize:C,generationRadius:b,anchored:w,halo:T})];Ve(o[0].graph,o[1].graph),a.world=new r({seed:Te,levels:o,maxCellsPerLevel:He(b,C),...a.tap===void 0?{}:{gpu:a.tap},onCellReady:(e,r,i)=>{a.disposed||(t.cellReady(e,r,i),n.set(`${e}|${r[0]},${r[1]}`,Ue(i)))},onCellEvicted:(e,r)=>{a.disposed||(t.cellEvicted(e,r),n.delete(`${e}|${r[0]},${r[1]}`))}}),R=a,We=0,F=void 0,z=void 0,Q(),qe(a,De)}function qe(e,t){let n=++Ke;$=!0,Ge=performance.now(),e.world.update([O.position.x,0,O.position.z],{budgetMs:t,maxCooksPerUpdate:Oe,signal:e.abort.signal,...e.tap===void 0?{}:{gpu:e.tap}}).then(t=>{if(e.disposed)return;We=t.pending,z=t.elapsedMs;let n=e.tap?.drain();n!==void 0&&(F=n),Q(),B&&(B=!1,X(ht()))}).catch(t=>{t instanceof ie||(console.error(t),e.disposed||X(`update failed: ${Ae(t)}`))}).finally(()=>{n===Ke&&($=!1)})}var H=0,Je=0,U=new Set;window.addEventListener(`keydown`,e=>{let t=e.key.toLowerCase();if(t===`g`){tt(x===`gpu`?`cpu`:`gpu`);return}U.add(t)}),window.addEventListener(`keyup`,e=>U.delete(e.key.toLowerCase())),document.addEventListener(`visibilitychange`,()=>{document.visibilityState===`visible`&&(Ge=performance.now())});var W=pe({title:`infinite world`,info:`Unbounded landmark level + world-anchored rock cells streamed around a flying camera. Steer with A/D or arrow keys.`}),Ye=document.createElement(`style`);Ye.textContent=`
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
`,document.head.appendChild(Ye);var Xe=W.el.querySelector(`.pcg-stats`)?.previousElementSibling??W.el;W.addSeed(Te,e=>{Te=e,V()}),W.addSlider(`speed`,{min:0,max:80,step:1,value:y,format:e=>`${e} u/s`},e=>{y=e}),W.addSlider(`gen radius`,{min:60,max:240,step:10,value:b,format:e=>`${e} u`},e=>{b=e,V()}),W.addSlider(`cell size`,{min:20,max:80,step:20,value:C,format:e=>`${e} u`},e=>{C=e,Ne(),V()}),W.addCheckbox(`world-anchored`,w,e=>{w=e,mt(),V()}),W.addCheckbox(`halo (4 u)`,T,e=>{T=e,V()}),W.addCheckbox(`cell grid`,E,e=>{E=e,A&&(A.visible=e),Pe()});var Ze=document.createElement(`div`);Ze.className=`pcg04-seg`;var G=document.createElement(`button`);G.type=`button`,G.textContent=`GPU per-node`;var K=document.createElement(`button`);K.type=`button`,K.textContent=`CPU`,Ze.append(G,K);var Qe=document.createElement(`p`);Qe.className=`pcg04-hint`,Qe.textContent=`G switches path · A/D or ←/→ steer`;var $e=document.createElement(`div`);$e.className=`pcg-row`;var et=document.createElement(`label`);et.textContent=`derived specs`;var q=document.createElement(`input`);q.type=`checkbox`,q.checked=S,q.addEventListener(`change`,()=>{S=q.checked,V()}),$e.append(et,q),Xe.prepend(Ze,Qe,$e);function tt(e){if(e!==x){if(e===`gpu`&&!I()){X(P?Z():N??`GPU path not ready yet.`);return}x=e,J(),V(),X(ht())}}G.addEventListener(`click`,()=>tt(`gpu`)),K.addEventListener(`click`,()=>tt(`cpu`));function J(){G.setAttribute(`aria-pressed`,String(x===`gpu`)),K.setAttribute(`aria-pressed`,String(x===`cpu`)),G.disabled=!I(),G.title=N===void 0?P?Z():``:N,q.disabled=!I()||x===`cpu`}var Y=W.addStat(`adapter`),nt=W.addStat(`fps`),rt=W.addStat(`rock source`),it=W.addStat(`rock cells`),at=W.addStat(`cooked / evicted`),ot=W.addStat(`pending`),st=W.addStat(`instances`),ct=W.addStat(`position`),lt=W.addStat(`cook`),ut=W.addStat(`resident runs / fused members`),dt=W.addStat(`device dispatches`),ft=W.addStat(`gpu fallbacks`),pt=W.addStat(`status`);function X(e){pt(e)}function mt(){rt(w?`pointScatterInWorld`:`pointScatterInBounds`)}function Z(){return`device lost (${ze}) — the GPU path is disabled; reload for a fresh device`}function ht(){return P?Z():x===`cpu`?`CPU path — no resolver passed to the cook`:I()?S?`GPU per-node — combinator fields accepted via acceptDerivedSpecs`:`GPU per-node — acceptDerivedSpecs off, so every field falls back`:N??`requesting WebGPU adapter…`}function Q(){if(lt(z===void 0?`–`:`${z.toFixed(1)} ms`),F===void 0){ut(R?.tap===void 0?`– (no GPU resolver)`:`–`),dt(`–`),ft(`–`);return}ut(`${F.residentRuns} / ${F.fusedNodes}`),dt(String(F.dispatches)),ft(we(F.fallbacks))}var gt=W.addSlot();l(),W.addNote(`Drag “cell size”: the blue grid re-cells the world and the rocks do not move or resize. Untick “halo” to watch every border grow a band of undersized rocks, and “world-anchored” to watch the same drag re-roll the world from scratch.`);var _t=W.addCollapsible(`anchoring · what the fine level actually does`);_t.textContent=`pointScatterInWorld scatters over an INFINITE lattice fixed to
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
update cooks nothing.`;function yt(e){P=!0,ze=e,M=`device lost`,Y(M),X(Z()),J(),x===`gpu`&&(x=`cpu`,J(),V())}async function bt(){let e=await xe(yt);if(`error`in e){N=e.error,M=`no WebGPU adapter`,Y(M),x=`cpu`,J(),X(`${e.error} Running the CPU path.`);return}try{let t=Se(e);j=t.derived,Re=t.strict}catch(e){N=`GpuFieldEvaluator construction failed: ${Ae(e)}`,M=`evaluator unavailable`,Y(M),x=`cpu`,J(),X(`${N} Running the CPU path.`);return}P||(M=e.label,Y(M),J(),X(ht()),x===`gpu`&&V())}var $=!1,xt=n(e=>nt(e));Y(M),X(`requesting WebGPU adapter…`),J(),mt(),Q(),Ne(),V(),bt(),je(e=>{xt(),Je=(U.has(`a`)||U.has(`arrowleft`)?1:0)-(U.has(`d`)||U.has(`arrowright`)?1:0),H+=Je*1.1*e,O.position.x+=Math.sin(H)*y*e,O.position.z+=Math.cos(H)*y*e,O.position.y=26,O.lookAt(O.position.x+Math.sin(H)*60,5,O.position.z+Math.cos(H)*60),Pe();let t=R;if(t&&!$?qe(t,Ee):$&&!B&&performance.now()-Ge>ke&&(B=!0,X(`a cook has been in flight for over 5 s — the GPU device may have been lost.`)),t){let e=t.world.stats(),n=e.levels.find(e=>e.name===`rocks`)?.cellCount??0;it(String(n)),at(`${e.totalCooked} / ${e.totalEvicted}`),ot(String(We));let r=0;for(let e of t.cellInstances.values())r+=e;st(String(r)),ct(`${O.position.x.toFixed(0)}, ${O.position.z.toFixed(0)}`)}});