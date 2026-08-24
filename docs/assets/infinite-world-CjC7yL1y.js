import{Cn as e,Cr as t,D as n,It as r,Jn as i,Rn as a,Rt as o,_n as ee,bn as te,br as ne,cn as re,hr as ie,jn as ae,nr as oe,or as se,r as ce,rr as s,sn as le,vr as c,xn as ue,xr as de,zr as l}from"./wordmark-BhAKRouD.js";import{t as fe}from"./types-C9vZymIy.js";import{A as u,St as d,U as f,Vt as p,W as pe,jt as m,q as h}from"./three.core-B85ZZh_6.js";import{t as g}from"./scene-QpK-6DxV.js";import{n as me}from"./debug-DCECVz9O.js";import{t as he}from"./worldBinding-27nFHQsV.js";import{n as ge,t as _e}from"./panel-CzCtq1qh.js";var ve=.35,ye=777;function be(){let n=new ae,r=n.add(le,{count:170,boundsMin:[-800,0,-800],boundsMax:[800,0,800]}),i=n.add(e,{name:`scale`,tupleSize:3,value:(()=>{let e=c(t(`mega`),0,1,5,13);return ne(e,ie(e,1.6),e)})()}),a=n.add(o,{assetId:`megarock`});return n.connect(r,`out`,i,`in`),n.connect(i,`out`,a,`in`),n.output(a,`instances`,`instances`),{name:`landmarks`,cellSize:`unbounded`,generationRadius:1/0,graph:n,bind(e,t){e.setParam(r,`seed`,t.seed),e.setParam(i,`seed`,l(t.seed,9))}}}function xe(n){let{cellSize:r,generationRadius:oe,anchored:ce}=n,s=n.halo?4:0,u=new ae,d=ce?u.add(re,{density:ve,cellSize:7,latticeMode:`xz`,height:0}):u.add(le,{count:Math.round(ve*(r+2*s)**2)}),f=u.add(e,{name:`density`,tupleSize:1,value:c(a(i,{seed:ye,frequency:.02,octaves:3}),-1,1,0,1)}),p=u.add(ue,{mode:`probabilistic`}),pe=u.add(ee,{radius:4,countAttr:`nbrCount`}),m=u.add(te,{mode:`inside`}),h=u.add(e,{name:`scale`,tupleSize:3,value:(()=>{let e=c(se(de(`nbrCount`),2,16),2,16,.4,1.35),n=ie(e,c(t(`rock`),0,1,.85,1.15));return ne(n,n,n)})()}),g=u.add(o,{assetId:`rock`});return u.connect(d,`out`,f,`in`),u.connect(f,`out`,p,`in`),u.connect(p,`out`,pe,`in`),u.connect(pe,`out`,m,`in`),u.connect(m,`out`,h,`in`),u.connect(h,`out`,g,`in`),u.output(g,`instances`,`instances`),{name:`rocks`,cellSize:r,generationRadius:oe,graph:u,bind(e,t){let{min:n,max:r}=fe(t);e.setParam(d,`boundsMin`,[n[0]-s,0,n[1]-s]),e.setParam(d,`boundsMax`,[r[0]+s,0,r[1]+s]);let i=ce?t.worldSeed:t.seed;e.setParam(d,`seed`,i),e.setParam(p,`seed`,l(i,1)),e.setParam(h,`seed`,l(i,2)),e.setParam(m,`boundsMin`,[n[0],-1,n[1]]),e.setParam(m,`boundsMax`,[r[0],1,r[1]])}}}function Se(e){return e instanceof Error?e.message:String(e)}function Ce(e){let t=(e?.description??``)===``?e?.device:e?.description;return[e?.vendor,e?.architecture,t].filter(e=>typeof e==`string`&&e!==``).join(` · `)||`adapter (no info exposed)`}async function we(e){let t=navigator.gpu;if(t===void 0)return{error:`navigator.gpu is missing — this browser has no WebGPU.`};try{let n=await t.requestAdapter();if(n===null)return{error:`navigator.gpu.requestAdapter() returned null — no compatible GPU adapter.`};let r=n.info,i=await n.requestDevice(),a=i.lost;return a!==void 0&&a.then(t=>{e(`${t?.reason??`unknown`}: ${t?.message??`no detail`}`)}),{device:i,info:r,label:Ce(r)}}catch(e){return{error:`requestDevice() failed: ${Se(e)}`}}}function Te(e){let t=e.info===void 0?{}:{adapterInfo:e.info};return{derived:new me(e.device,{...t,acceptDerivedSpecs:!0}),strict:new me(e.device,t)}}var Ee=class{cacheSalt;residentTerminals;acceptDerivedSpecs;base;seen=new Set;constructor(e){this.base=e,this.cacheSalt=e.cacheSalt,this.residentTerminals=e.residentTerminals,this.acceptDerivedSpecs=e.acceptDerivedSpecs}resolveField(e,t,n){return n!==void 0&&this.seen.add(n),this.base.resolveField(e,t,n)}planRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.planRun(e,t,n)}executeRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.executeRun(e,t,n)}drain(){if(this.seen.size===0)return;let e=s();for(let t of this.seen){e.dispatches+=t.dispatches,e.pipelinesCompiled+=t.pipelinesCompiled,e.pipelineCacheHits+=t.pipelineCacheHits,e.residentRuns+=t.residentRuns,e.fusedNodes+=t.fusedNodes,e.readbacksSaved+=t.readbacksSaved;for(let[n,r]of Object.entries(t.fallbacks))e.fallbacks[n]=(e.fallbacks[n]??0)+r}return this.seen.clear(),e}};function De(e){let t=Object.entries(e).sort(([e],[t])=>e.localeCompare(t));return t.length===0?`none`:t.map(([e,t])=>`${e} ×${t}`).join(`, `)}var _=1,v=18,y=140,b=`gpu`,x=!0,S=20,C=!0,w=!0,T=!0,Oe=7,ke=12,Ae=8,je=5e3;function Me(e){return e instanceof Error?e.message:String(e)}var{scene:E,camera:D,start:Ne}=g({cameraPosition:[0,26,0],orbit:!1,fog:{near:140,far:640},far:1600}),O=new d(new p(4e3,4e3),new m({color:1449515,roughness:1}));O.rotation.x=-Math.PI/2,O.position.y=-.03,E.add(O);var Pe=40,k;function Fe(){k&&(E.remove(k),k.geometry.dispose(),k.material.dispose());let e=new f(S*Pe,Pe,4158656,2903936),t=e.material;t.transparent=!0,t.opacity=.45,t.depthWrite=!1,e.position.y=.02,e.visible=T,E.add(e),k=e}function Ie(){!k||!k.visible||(k.position.x=Math.round(D.position.x/S)*S,k.position.z=Math.round(D.position.z/S)*S)}var Le=new m({color:8028816,roughness:.95,flatShading:!0}),Re=new m({color:6121077,roughness:1,flatShading:!0}),ze={megarock:{geometry:new u(1).translate(0,.62,0),material:Re},rock:{geometry:new h(.55).translate(0,.33,0),material:Le}},Be,Ve,A=`requesting…`,j,M=!1,He=``,N;function P(){return Be!==void 0&&!M}function Ue(){if(!(b===`cpu`||!P()))return x?Be:Ve}var F;function We(e,t){let n=[{name:`landmarks`,graph:e},{name:`rocks`,graph:t}];F?F.set(n):F=_e(n,{into:_t,title:`infinite world`})}function Ge(e,t){let n=e*1.25/t+1.5;return Math.max(256,Math.ceil(Math.PI*n*n))}function Ke(e){let t=0;for(let n of Object.keys(e))for(let r of e[n])if(r.kind===`instances`)for(let e of r.batches)t+=e.count;return t}var I,L=0,R,z=0,B=!1,qe=0;function V(){I&&(I.disposed=!0,I.abort.abort(),I.binding.dispose(),E.remove(I.group));let e=new pe;E.add(e);let t=new he({group:e,assets:ze}),n=new Map,i=Ue(),a={world:void 0,group:e,binding:t,cellInstances:n,tap:i===void 0?void 0:new Ee(i),abort:new AbortController,disposed:!1},o=[be(),xe({cellSize:S,generationRadius:y,anchored:C,halo:w})];We(o[0].graph,o[1].graph),a.world=new r({seed:_,levels:o,maxCellsPerLevel:Ge(y,S),...a.tap===void 0?{}:{gpu:a.tap},onCellReady:(e,r,i)=>{a.disposed||(t.cellReady(e,r,i),n.set(`${e}|${r[0]},${r[1]}`,Ke(i)))},onCellEvicted:(e,r)=>{a.disposed||(t.cellEvicted(e,r),n.delete(`${e}|${r[0]},${r[1]}`))}}),I=a,L=0,N=void 0,R=void 0,Q(),Je(a,ke)}function Je(e,t){let n=++qe;$=!0,z=performance.now(),e.world.update([D.position.x,0,D.position.z],{budgetMs:t,maxCooksPerUpdate:Ae,signal:e.abort.signal,...e.tap===void 0?{}:{gpu:e.tap}}).then(t=>{if(e.disposed)return;L=t.pending,R=t.elapsedMs;let n=e.tap?.drain();n!==void 0&&(N=n),Q(),B&&(B=!1,X(gt()))}).catch(t=>{t instanceof oe||(console.error(t),e.disposed||X(`update failed: ${Me(t)}`))}).finally(()=>{n===qe&&($=!1)})}var H=0,Ye=0,U=new Set;window.addEventListener(`keydown`,e=>{let t=e.key.toLowerCase();if(t===`g`){nt(b===`gpu`?`cpu`:`gpu`);return}U.add(t)}),window.addEventListener(`keyup`,e=>U.delete(e.key.toLowerCase())),document.addEventListener(`visibilitychange`,()=>{document.visibilityState===`visible`&&(z=performance.now())});var W=ge({title:`infinite world`,info:`Unbounded landmark level + world-anchored rock cells streamed around a flying camera. Steer with A/D or arrow keys.`}),Xe=document.createElement(`style`);Xe.textContent=`
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
`,document.head.appendChild(Xe);var Ze=W.el.querySelector(`.pcg-stats`)?.previousElementSibling??W.el;W.addSeed(_,e=>{_=e,V()}),W.addSlider(`speed`,{min:0,max:80,step:1,value:v,format:e=>`${e} u/s`},e=>{v=e}),W.addSlider(`gen radius`,{min:60,max:240,step:10,value:y,format:e=>`${e} u`},e=>{y=e,V()}),W.addSlider(`cell size`,{min:20,max:80,step:20,value:S,format:e=>`${e} u`},e=>{S=e,Fe(),V()}),W.addCheckbox(`world-anchored`,C,e=>{C=e,ht(),V()}),W.addCheckbox(`halo (4 u)`,w,e=>{w=e,V()}),W.addCheckbox(`cell grid`,T,e=>{T=e,k&&(k.visible=e),Ie()});var Qe=document.createElement(`div`);Qe.className=`pcg04-seg`;var G=document.createElement(`button`);G.type=`button`,G.textContent=`GPU per-node`;var K=document.createElement(`button`);K.type=`button`,K.textContent=`CPU`,Qe.append(G,K);var $e=document.createElement(`p`);$e.className=`pcg04-hint`,$e.textContent=`G switches path · A/D or ←/→ steer`;var et=document.createElement(`div`);et.className=`pcg-row`;var tt=document.createElement(`label`);tt.textContent=`derived specs`;var q=document.createElement(`input`);q.type=`checkbox`,q.checked=x,q.addEventListener(`change`,()=>{x=q.checked,V()}),et.append(tt,q),Ze.prepend(Qe,$e,et);function nt(e){if(e!==b){if(e===`gpu`&&!P()){X(M?Z():j??`GPU path not ready yet.`);return}b=e,J(),V(),X(gt())}}G.addEventListener(`click`,()=>nt(`gpu`)),K.addEventListener(`click`,()=>nt(`cpu`));function J(){G.setAttribute(`aria-pressed`,String(b===`gpu`)),K.setAttribute(`aria-pressed`,String(b===`cpu`)),G.disabled=!P(),G.title=j===void 0?M?Z():``:j,q.disabled=!P()||b===`cpu`}var Y=W.addStat(`adapter`),rt=W.addStat(`fps`),it=W.addStat(`rock source`),at=W.addStat(`rock cells`),ot=W.addStat(`cooked / evicted`),st=W.addStat(`pending`),ct=W.addStat(`instances`),lt=W.addStat(`position`),ut=W.addStat(`cook`),dt=W.addStat(`resident runs / fused members`),ft=W.addStat(`device dispatches`),pt=W.addStat(`gpu fallbacks`),mt=W.addStat(`status`);function X(e){mt(e)}function ht(){it(C?`pointScatterInWorld`:`pointScatterInBounds`)}function Z(){return`device lost (${He}) — the GPU path is disabled; reload for a fresh device`}function gt(){return M?Z():b===`cpu`?`CPU path — no resolver passed to the cook`:P()?x?`GPU per-node — combinator fields accepted via acceptDerivedSpecs`:`GPU per-node — acceptDerivedSpecs off, so every field falls back`:j??`requesting WebGPU adapter…`}function Q(){if(ut(R===void 0?`–`:`${R.toFixed(1)} ms`),N===void 0){dt(I?.tap===void 0?`– (no GPU resolver)`:`–`),ft(`–`),pt(`–`);return}dt(`${N.residentRuns} / ${N.fusedNodes}`),ft(String(N.dispatches)),pt(De(N.fallbacks))}var _t=W.addSlot();ce(),W.addNote(`Drag “cell size”: the blue grid re-cells the world and the rocks do not move or resize. Untick “halo” to watch every border grow a band of undersized rocks, and “world-anchored” to watch the same drag re-roll the world from scratch.`);var vt=W.addCollapsible(`anchoring · what the fine level actually does`);vt.textContent=`pointScatterInWorld scatters over an INFINITE lattice fixed to
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
anything that has to see past its own bounds.`;var yt=W.addCollapsible(`diagnostics · why nothing fuses here`);yt.textContent=`resident runs / fused members reads 0 / 0 on BOTH paths, and
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
update cooks nothing.`;function bt(e){M=!0,He=e,A=`device lost`,Y(A),X(Z()),J(),b===`gpu`&&(b=`cpu`,J(),V())}async function xt(){let e=await we(bt);if(`error`in e){j=e.error,A=`no WebGPU adapter`,Y(A),b=`cpu`,J(),X(`${e.error} Running the CPU path.`);return}try{let t=Te(e);Be=t.derived,Ve=t.strict}catch(e){j=`GpuFieldEvaluator construction failed: ${Me(e)}`,A=`evaluator unavailable`,Y(A),b=`cpu`,J(),X(`${j} Running the CPU path.`);return}M||(A=e.label,Y(A),J(),X(gt()),b===`gpu`&&V())}var $=!1,St=n(e=>rt(e));Y(A),X(`requesting WebGPU adapter…`),J(),ht(),Q(),Fe(),V(),xt(),Ne(e=>{St(),Ye=(U.has(`a`)||U.has(`arrowleft`)?1:0)-(U.has(`d`)||U.has(`arrowright`)?1:0),H+=Ye*1.1*e,D.position.x+=Math.sin(H)*v*e,D.position.z+=Math.cos(H)*v*e,D.position.y=26,D.lookAt(D.position.x+Math.sin(H)*60,5,D.position.z+Math.cos(H)*60),Ie();let t=I;if(t&&!$?Je(t,Oe):$&&!B&&performance.now()-z>je&&(B=!0,X(`a cook has been in flight for over 5 s — the GPU device may have been lost.`)),t){let e=t.world.stats(),n=e.levels.find(e=>e.name===`rocks`)?.cellCount??0;at(String(n)),ot(`${e.totalCooked} / ${e.totalEvicted}`),st(String(L));let r=0;for(let e of t.cellInstances.values())r+=e;ct(String(r)),lt(`${D.position.x.toFixed(0)}, ${D.position.z.toFixed(0)}`)}});