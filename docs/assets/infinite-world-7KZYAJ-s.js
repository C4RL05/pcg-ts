import{$r as e,An as t,D as n,Dn as r,Er as i,Gn as a,In as o,Jr as s,Lt as c,Qn as ee,Wr as te,cr as ne,ei as re,gn as ie,hn as ae,jn as oe,r as se,ri as ce,vr as l,yi as u,yr as d,zt as le}from"./wordmark-1f_kjN-C.js";import{t as ue}from"./types-C9vZymIy.js";import{A as f,Ht as p,St as m,U as h,W as g,jt as _,q as v}from"./three.core-auuZCBBV.js";import{t as de}from"./scene-BYRX2PP5.js";import{t as fe}from"./gpu-DlBthG8L.js";import{r as pe}from"./three-BOVIlnmx.js";import{n as me,t as he}from"./panel-Q1e-Sbno.js";var ge=.35,_e=777;function ve(){let t=new a,n=t.add(ae,{count:170,boundsMin:[-800,0,-800],boundsMax:[800,0,800]}),r=t.add(o,{name:`scale`,tupleSize:3,value:(()=>{let t=s(ce(`mega`),0,1,5,13);return e(t,te(t,1.6),t)})()}),i=t.add(le,{assetId:`megarock`});return t.connect(n,`out`,r,`in`),t.connect(r,`out`,i,`in`),t.output(i,`instances`,`instances`),{name:`landmarks`,cellSize:`unbounded`,generationRadius:1/0,graph:t,bind(e,t){e.setParam(n,`seed`,t.seed),e.setParam(r,`seed`,u(t.seed,9))}}}function ye(n){let{cellSize:c,generationRadius:se,anchored:l}=n,d=n.halo?4:0,f=new a,p=l?f.add(ie,{density:ge,cellSize:7,latticeMode:`xz`,height:0}):f.add(ae,{count:Math.round(ge*(c+2*d)**2)}),m=f.add(o,{name:`density`,tupleSize:1,value:s(ee(ne,{seed:_e,frequency:.02,octaves:3}),-1,1,0,1)}),h=f.add(oe,{mode:`probabilistic`}),g=f.add(r,{radius:4,countAttr:`nbrCount`}),_=f.add(t,{mode:`inside`}),v=f.add(o,{name:`scale`,tupleSize:3,value:(()=>{let t=s(i(re(`nbrCount`),2,16),2,16,.4,1.35),n=te(t,s(ce(`rock`),0,1,.85,1.15));return e(n,n,n)})()}),de=f.add(le,{assetId:`rock`});return f.connect(p,`out`,m,`in`),f.connect(m,`out`,h,`in`),f.connect(h,`out`,g,`in`),f.connect(g,`out`,_,`in`),f.connect(_,`out`,v,`in`),f.connect(v,`out`,de,`in`),f.output(de,`instances`,`instances`),{name:`rocks`,cellSize:c,generationRadius:se,graph:f,bind(e,t){let{min:n,max:r}=ue(t);e.setParam(p,`boundsMin`,[n[0]-d,0,n[1]-d]),e.setParam(p,`boundsMax`,[r[0]+d,0,r[1]+d]);let i=l?t.worldSeed:t.seed;e.setParam(p,`seed`,i),e.setParam(h,`seed`,u(i,1)),e.setParam(v,`seed`,u(i,2)),e.setParam(_,`boundsMin`,[n[0],-1,n[1]]),e.setParam(_,`boundsMax`,[r[0],1,r[1]])}}}function be(e){return e instanceof Error?e.message:String(e)}function xe(e){let t=(e?.description??``)===``?e?.device:e?.description;return[e?.vendor,e?.architecture,t].filter(e=>typeof e==`string`&&e!==``).join(` · `)||`adapter (no info exposed)`}async function Se(e){let t=navigator.gpu;if(t===void 0)return{error:`navigator.gpu is missing — this browser has no WebGPU.`};try{let n=await t.requestAdapter();if(n===null)return{error:`navigator.gpu.requestAdapter() returned null — no compatible GPU adapter.`};let r=n.info,i=await n.requestDevice(),a=i.lost;return a!==void 0&&a.then(t=>{e(`${t?.reason??`unknown`}: ${t?.message??`no detail`}`)}),{device:i,info:r,label:xe(r)}}catch(e){return{error:`requestDevice() failed: ${be(e)}`}}}function Ce(e){let t=e.info===void 0?{}:{adapterInfo:e.info};return{derived:new fe(e.device,{...t,acceptDerivedSpecs:!0}),strict:new fe(e.device,t)}}var we=class{cacheSalt;residentTerminals;acceptDerivedSpecs;base;seen=new Set;constructor(e){this.base=e,this.cacheSalt=e.cacheSalt,this.residentTerminals=e.residentTerminals,this.acceptDerivedSpecs=e.acceptDerivedSpecs}resolveField(e,t,n){return n!==void 0&&this.seen.add(n),this.base.resolveField(e,t,n)}planRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.planRun(e,t,n)}executeRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.executeRun(e,t,n)}drain(){if(this.seen.size===0)return;let e=d();for(let t of this.seen){e.dispatches+=t.dispatches,e.pipelinesCompiled+=t.pipelinesCompiled,e.pipelineCacheHits+=t.pipelineCacheHits,e.residentRuns+=t.residentRuns,e.fusedNodes+=t.fusedNodes,e.readbacksSaved+=t.readbacksSaved;for(let[n,r]of Object.entries(t.fallbacks))e.fallbacks[n]=(e.fallbacks[n]??0)+r}return this.seen.clear(),e}};function Te(e){let t=Object.entries(e).sort(([e],[t])=>e.localeCompare(t));return t.length===0?`none`:t.map(([e,t])=>`${e} ×${t}`).join(`, `)}var y=1,b=18,x=140,S=`gpu`,C=!0,w=20,T=!0,E=!0,D=!0,Ee=7,De=12,Oe=8,ke=5e3;function Ae(e){return e instanceof Error?e.message:String(e)}var{scene:O,camera:k,start:je}=de({cameraPosition:[0,26,0],orbit:!1,fog:{near:140,far:640},far:1600}),A=new m(new p(4e3,4e3),new _({color:1449515,roughness:1}));A.rotation.x=-Math.PI/2,A.position.y=-.03,O.add(A);var Me=40,j;function Ne(){j&&(O.remove(j),j.geometry.dispose(),j.material.dispose());let e=new h(w*Me,Me,4158656,2903936),t=e.material;t.transparent=!0,t.opacity=.45,t.depthWrite=!1,e.position.y=.02,e.visible=D,O.add(e),j=e}function Pe(){!j||!j.visible||(j.position.x=Math.round(k.position.x/w)*w,j.position.z=Math.round(k.position.z/w)*w)}var Fe=new _({color:8028816,roughness:.95,flatShading:!0}),Ie=new _({color:6121077,roughness:1,flatShading:!0}),Le={megarock:{geometry:new f(1).translate(0,.62,0),material:Ie},rock:{geometry:new v(.55).translate(0,.33,0),material:Fe}},M,Re,N=`requesting…`,P,F=!1,ze=``,I;function L(){return M!==void 0&&!F}function Be(){if(!(S===`cpu`||!L()))return C?M:Re}var R;function Ve(e,t){let n=[{name:`landmarks`,graph:e},{name:`rocks`,graph:t}];R?R.set(n):R=he(n,{into:_t,title:`infinite world`})}function He(e,t){let n=e*1.25/t+1.5;return Math.max(256,Math.ceil(Math.PI*n*n))}function Ue(e){let t=0;for(let n of Object.keys(e))for(let r of e[n])if(r.kind===`instances`)for(let e of r.batches)t+=e.count;return t}var z,We=0,B,Ge=0,V=!1,Ke=0;function H(){z&&(z.disposed=!0,z.abort.abort(),z.binding.dispose(),O.remove(z.group));let e=new g;O.add(e);let t=new pe({group:e,assets:Le}),n=new Map,r=Be(),i={world:void 0,group:e,binding:t,cellInstances:n,tap:r===void 0?void 0:new we(r),abort:new AbortController,disposed:!1},a=[ve(),ye({cellSize:w,generationRadius:x,anchored:T,halo:E})];Ve(a[0].graph,a[1].graph),i.world=new c({seed:y,levels:a,maxCellsPerLevel:He(x,w),...i.tap===void 0?{}:{gpu:i.tap},onCellReady:(e,r,a)=>{i.disposed||(t.cellReady(e,r,a),n.set(`${e}|${r[0]},${r[1]}`,Ue(a)))},onCellEvicted:(e,r)=>{i.disposed||(t.cellEvicted(e,r),n.delete(`${e}|${r[0]},${r[1]}`))}}),z=i,We=0,I=void 0,B=void 0,gt(),qe(i,De)}function qe(e,t){let n=++Ke;$=!0,Ge=performance.now(),e.world.update([k.position.x,0,k.position.z],{budgetMs:t,maxCooksPerUpdate:Oe,signal:e.abort.signal,...e.tap===void 0?{}:{gpu:e.tap}}).then(t=>{if(e.disposed)return;We=t.pending,B=t.elapsedMs;let n=e.tap?.drain();n!==void 0&&(I=n),gt(),V&&(V=!1,Z(ht()))}).catch(t=>{t instanceof l||(console.error(t),e.disposed||Z(`update failed: ${Ae(t)}`))}).finally(()=>{n===Ke&&($=!1)})}var U=0,Je=0,W=new Set;window.addEventListener(`keydown`,e=>{let t=e.key.toLowerCase();if(t===`g`){tt(S===`gpu`?`cpu`:`gpu`);return}W.add(t)}),window.addEventListener(`keyup`,e=>W.delete(e.key.toLowerCase())),document.addEventListener(`visibilitychange`,()=>{document.visibilityState===`visible`&&(Ge=performance.now())});var G=me({title:`infinite world`,info:`Unbounded landmark level + world-anchored rock cells streamed around a flying camera. Steer with A/D or arrow keys.`}),Ye=document.createElement(`style`);Ye.textContent=`
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
`,document.head.appendChild(Ye);var Xe=G.el.querySelector(`.pcg-stats`)?.previousElementSibling??G.el;G.addSeed(y,e=>{y=e,H()}),G.addSlider(`speed`,{min:0,max:80,step:1,value:b,format:e=>`${e} u/s`},e=>{b=e}),G.addSlider(`gen radius`,{min:60,max:240,step:10,value:x,format:e=>`${e} u`},e=>{x=e,H()}),G.addSlider(`cell size`,{min:20,max:80,step:20,value:w,format:e=>`${e} u`},e=>{w=e,Ne(),H()}),G.addCheckbox(`world-anchored`,T,e=>{T=e,mt(),H()}),G.addCheckbox(`halo (4 u)`,E,e=>{E=e,H()}),G.addCheckbox(`cell grid`,D,e=>{D=e,j&&(j.visible=e),Pe()});var Ze=document.createElement(`div`);Ze.className=`pcg04-seg`;var K=document.createElement(`button`);K.type=`button`,K.textContent=`GPU per-node`;var q=document.createElement(`button`);q.type=`button`,q.textContent=`CPU`,Ze.append(K,q);var Qe=document.createElement(`p`);Qe.className=`pcg04-hint`,Qe.textContent=`G switches path · A/D or ←/→ steer`;var $e=document.createElement(`div`);$e.className=`pcg-row`;var et=document.createElement(`label`);et.textContent=`derived specs`;var J=document.createElement(`input`);J.type=`checkbox`,J.checked=C,J.addEventListener(`change`,()=>{C=J.checked,H()}),$e.append(et,J),Xe.prepend(Ze,Qe,$e);function tt(e){if(e!==S){if(e===`gpu`&&!L()){Z(F?Q():P??`GPU path not ready yet.`);return}S=e,Y(),H(),Z(ht())}}K.addEventListener(`click`,()=>tt(`gpu`)),q.addEventListener(`click`,()=>tt(`cpu`));function Y(){K.setAttribute(`aria-pressed`,String(S===`gpu`)),q.setAttribute(`aria-pressed`,String(S===`cpu`)),K.disabled=!L(),K.title=P===void 0?F?Q():``:P,J.disabled=!L()||S===`cpu`}var X=G.addStat(`adapter`),nt=G.addStat(`fps`),rt=G.addStat(`rock source`),it=G.addStat(`rock cells`),at=G.addStat(`cooked / evicted`),ot=G.addStat(`pending`),st=G.addStat(`instances`),ct=G.addStat(`position`),lt=G.addStat(`cook`),ut=G.addStat(`resident runs / fused members`),dt=G.addStat(`device dispatches`),ft=G.addStat(`gpu fallbacks`),pt=G.addStat(`status`);function Z(e){pt(e)}function mt(){rt(T?`pointScatterInWorld`:`pointScatterInBounds`)}function Q(){return`device lost (${ze}) — the GPU path is disabled; reload for a fresh device`}function ht(){return F?Q():S===`cpu`?`CPU path — no resolver passed to the cook`:L()?C?`GPU per-node — combinator fields accepted via acceptDerivedSpecs`:`GPU per-node — acceptDerivedSpecs off, so every field falls back`:P??`requesting WebGPU adapter…`}function gt(){if(lt(B===void 0?`–`:`${B.toFixed(1)} ms`),I===void 0){ut(z?.tap===void 0?`– (no GPU resolver)`:`–`),dt(`–`),ft(`–`);return}ut(`${I.residentRuns} / ${I.fusedNodes}`),dt(String(I.dispatches)),ft(Te(I.fallbacks))}var _t=G.addSlot();se(),G.addNote(`Drag “cell size”: the blue grid re-cells the world and the rocks do not move or resize. Untick “halo” to watch every border grow a band of undersized rocks, and “world-anchored” to watch the same drag re-roll the world from scratch.`);var vt=G.addCollapsible(`anchoring · what the fine level actually does`);vt.textContent=`pointScatterInWorld scatters over an INFINITE lattice fixed to
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
update cooks nothing.`;function bt(e){F=!0,ze=e,N=`device lost`,X(N),Z(Q()),Y(),S===`gpu`&&(S=`cpu`,Y(),H())}async function xt(){let e=await Se(bt);if(`error`in e){P=e.error,N=`no WebGPU adapter`,X(N),S=`cpu`,Y(),Z(`${e.error} Running the CPU path.`);return}try{let t=Ce(e);M=t.derived,Re=t.strict}catch(e){P=`GpuFieldEvaluator construction failed: ${Ae(e)}`,N=`evaluator unavailable`,X(N),S=`cpu`,Y(),Z(`${P} Running the CPU path.`);return}F||(N=e.label,X(N),Y(),Z(ht()),S===`gpu`&&H())}var $=!1,St=n(e=>nt(e));X(N),Z(`requesting WebGPU adapter…`),Y(),mt(),gt(),Ne(),H(),xt(),je(e=>{St(),Je=(W.has(`a`)||W.has(`arrowleft`)?1:0)-(W.has(`d`)||W.has(`arrowright`)?1:0),U+=Je*1.1*e,k.position.x+=Math.sin(U)*b*e,k.position.z+=Math.cos(U)*b*e,k.position.y=26,k.lookAt(k.position.x+Math.sin(U)*60,5,k.position.z+Math.cos(U)*60),Pe();let t=z;if(t&&!$?qe(t,Ee):$&&!V&&performance.now()-Ge>ke&&(V=!0,Z(`a cook has been in flight for over 5 s — the GPU device may have been lost.`)),t){let e=t.world.stats(),n=e.levels.find(e=>e.name===`rocks`)?.cellCount??0;it(String(n)),at(`${e.totalCooked} / ${e.totalEvicted}`),ot(String(We));let r=0;for(let e of t.cellInstances.values())r+=e;st(String(r)),ct(`${k.position.x.toFixed(0)}, ${k.position.z.toFixed(0)}`)}});