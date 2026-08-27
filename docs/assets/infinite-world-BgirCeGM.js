import{An as e,D as t,En as n,Fn as r,Hr as i,It as a,Kr as o,Rr as ee,Rt as te,Wn as ne,Xr as re,Zn as ie,br as ae,fi as oe,gr as se,hn as ce,hr as s,kn as le,mn as ue,qr as de,r as c,sr as fe}from"./wordmark-C09dygsG.js";import{t as pe}from"./types-C9vZymIy.js";import{A as l,St as u,U as d,Vt as f,W as p,jt as m,q as h}from"./three.core-B85ZZh_6.js";import{t as g}from"./scene-QpK-6DxV.js";import{t as me}from"./gpu-CUUpBHvw.js";import{t as he}from"./worldBinding-Dpy1Vw4a.js";import{n as ge,t as _e}from"./panel-DkLbD6L9.js";var ve=.35,ye=777;function be(){let e=new ne,t=e.add(ue,{count:170,boundsMin:[-800,0,-800],boundsMax:[800,0,800]}),n=e.add(r,{name:`scale`,tupleSize:3,value:(()=>{let e=i(re(`mega`),0,1,5,13);return o(e,ee(e,1.6),e)})()}),a=e.add(te,{assetId:`megarock`});return e.connect(t,`out`,n,`in`),e.connect(n,`out`,a,`in`),e.output(a,`instances`,`instances`),{name:`landmarks`,cellSize:`unbounded`,generationRadius:1/0,graph:e,bind(e,r){e.setParam(t,`seed`,r.seed),e.setParam(n,`seed`,oe(r.seed,9))}}}function xe(t){let{cellSize:a,generationRadius:se,anchored:s}=t,c=t.halo?4:0,l=new ne,u=s?l.add(ce,{density:ve,cellSize:7,latticeMode:`xz`,height:0}):l.add(ue,{count:Math.round(ve*(a+2*c)**2)}),d=l.add(r,{name:`density`,tupleSize:1,value:i(ie(fe,{seed:ye,frequency:.02,octaves:3}),-1,1,0,1)}),f=l.add(e,{mode:`probabilistic`}),p=l.add(n,{radius:4,countAttr:`nbrCount`}),m=l.add(le,{mode:`inside`}),h=l.add(r,{name:`scale`,tupleSize:3,value:(()=>{let e=i(ae(de(`nbrCount`),2,16),2,16,.4,1.35),t=ee(e,i(re(`rock`),0,1,.85,1.15));return o(t,t,t)})()}),g=l.add(te,{assetId:`rock`});return l.connect(u,`out`,d,`in`),l.connect(d,`out`,f,`in`),l.connect(f,`out`,p,`in`),l.connect(p,`out`,m,`in`),l.connect(m,`out`,h,`in`),l.connect(h,`out`,g,`in`),l.output(g,`instances`,`instances`),{name:`rocks`,cellSize:a,generationRadius:se,graph:l,bind(e,t){let{min:n,max:r}=pe(t);e.setParam(u,`boundsMin`,[n[0]-c,0,n[1]-c]),e.setParam(u,`boundsMax`,[r[0]+c,0,r[1]+c]);let i=s?t.worldSeed:t.seed;e.setParam(u,`seed`,i),e.setParam(f,`seed`,oe(i,1)),e.setParam(h,`seed`,oe(i,2)),e.setParam(m,`boundsMin`,[n[0],-1,n[1]]),e.setParam(m,`boundsMax`,[r[0],1,r[1]])}}}function Se(e){return e instanceof Error?e.message:String(e)}function Ce(e){let t=(e?.description??``)===``?e?.device:e?.description;return[e?.vendor,e?.architecture,t].filter(e=>typeof e==`string`&&e!==``).join(` · `)||`adapter (no info exposed)`}async function we(e){let t=navigator.gpu;if(t===void 0)return{error:`navigator.gpu is missing — this browser has no WebGPU.`};try{let n=await t.requestAdapter();if(n===null)return{error:`navigator.gpu.requestAdapter() returned null — no compatible GPU adapter.`};let r=n.info,i=await n.requestDevice(),a=i.lost;return a!==void 0&&a.then(t=>{e(`${t?.reason??`unknown`}: ${t?.message??`no detail`}`)}),{device:i,info:r,label:Ce(r)}}catch(e){return{error:`requestDevice() failed: ${Se(e)}`}}}function Te(e){let t=e.info===void 0?{}:{adapterInfo:e.info};return{derived:new me(e.device,{...t,acceptDerivedSpecs:!0}),strict:new me(e.device,t)}}var Ee=class{cacheSalt;residentTerminals;acceptDerivedSpecs;base;seen=new Set;constructor(e){this.base=e,this.cacheSalt=e.cacheSalt,this.residentTerminals=e.residentTerminals,this.acceptDerivedSpecs=e.acceptDerivedSpecs}resolveField(e,t,n){return n!==void 0&&this.seen.add(n),this.base.resolveField(e,t,n)}planRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.planRun(e,t,n)}executeRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.executeRun(e,t,n)}drain(){if(this.seen.size===0)return;let e=se();for(let t of this.seen){e.dispatches+=t.dispatches,e.pipelinesCompiled+=t.pipelinesCompiled,e.pipelineCacheHits+=t.pipelineCacheHits,e.residentRuns+=t.residentRuns,e.fusedNodes+=t.fusedNodes,e.readbacksSaved+=t.readbacksSaved;for(let[n,r]of Object.entries(t.fallbacks))e.fallbacks[n]=(e.fallbacks[n]??0)+r}return this.seen.clear(),e}};function De(e){let t=Object.entries(e).sort(([e],[t])=>e.localeCompare(t));return t.length===0?`none`:t.map(([e,t])=>`${e} ×${t}`).join(`, `)}var _=1,v=18,y=140,b=`gpu`,x=!0,S=20,C=!0,Oe=!0,ke=!0,Ae=7,je=12,Me=8,Ne=5e3;function Pe(e){return e instanceof Error?e.message:String(e)}var{scene:w,camera:T,start:Fe}=g({cameraPosition:[0,26,0],orbit:!1,fog:{near:140,far:640},far:1600}),E=new u(new f(4e3,4e3),new m({color:1449515,roughness:1}));E.rotation.x=-Math.PI/2,E.position.y=-.03,w.add(E);var Ie=40,D;function Le(){D&&(w.remove(D),D.geometry.dispose(),D.material.dispose());let e=new d(S*Ie,Ie,4158656,2903936),t=e.material;t.transparent=!0,t.opacity=.45,t.depthWrite=!1,e.position.y=.02,e.visible=ke,w.add(e),D=e}function Re(){!D||!D.visible||(D.position.x=Math.round(T.position.x/S)*S,D.position.z=Math.round(T.position.z/S)*S)}var ze=new m({color:8028816,roughness:.95,flatShading:!0}),Be=new m({color:6121077,roughness:1,flatShading:!0}),Ve={megarock:{geometry:new l(1).translate(0,.62,0),material:Be},rock:{geometry:new h(.55).translate(0,.33,0),material:ze}},He,Ue,O=`requesting…`,k,A=!1,We=``,j;function M(){return He!==void 0&&!A}function Ge(){if(!(b===`cpu`||!M()))return x?He:Ue}var N;function Ke(e,t){let n=[{name:`landmarks`,graph:e},{name:`rocks`,graph:t}];N?N.set(n):N=_e(n,{into:_t,title:`infinite world`})}function qe(e,t){let n=e*1.25/t+1.5;return Math.max(256,Math.ceil(Math.PI*n*n))}function Je(e){let t=0;for(let n of Object.keys(e))for(let r of e[n])if(r.kind===`instances`)for(let e of r.batches)t+=e.count;return t}var P,F=0,I,Ye=0,L=!1,Xe=0;function R(){P&&(P.disposed=!0,P.abort.abort(),P.binding.dispose(),w.remove(P.group));let e=new p;w.add(e);let t=new he({group:e,assets:Ve}),n=new Map,r=Ge(),i={world:void 0,group:e,binding:t,cellInstances:n,tap:r===void 0?void 0:new Ee(r),abort:new AbortController,disposed:!1},o=[be(),xe({cellSize:S,generationRadius:y,anchored:C,halo:Oe})];Ke(o[0].graph,o[1].graph),i.world=new a({seed:_,levels:o,maxCellsPerLevel:qe(y,S),...i.tap===void 0?{}:{gpu:i.tap},onCellReady:(e,r,a)=>{i.disposed||(t.cellReady(e,r,a),n.set(`${e}|${r[0]},${r[1]}`,Je(a)))},onCellEvicted:(e,r)=>{i.disposed||(t.cellEvicted(e,r),n.delete(`${e}|${r[0]},${r[1]}`))}}),P=i,F=0,j=void 0,I=void 0,gt(),Ze(i,je)}function Ze(e,t){let n=++Xe;$=!0,Ye=performance.now(),e.world.update([T.position.x,0,T.position.z],{budgetMs:t,maxCooksPerUpdate:Me,signal:e.abort.signal,...e.tap===void 0?{}:{gpu:e.tap}}).then(t=>{if(e.disposed)return;F=t.pending,I=t.elapsedMs;let n=e.tap?.drain();n!==void 0&&(j=n),gt(),L&&(L=!1,Z(ht()))}).catch(t=>{t instanceof s||(console.error(t),e.disposed||Z(`update failed: ${Pe(t)}`))}).finally(()=>{n===Xe&&($=!1)})}var z=0,Qe=0,B=new Set;window.addEventListener(`keydown`,e=>{let t=e.key.toLowerCase();if(t===`g`){J(b===`gpu`?`cpu`:`gpu`);return}B.add(t)}),window.addEventListener(`keyup`,e=>B.delete(e.key.toLowerCase())),document.addEventListener(`visibilitychange`,()=>{document.visibilityState===`visible`&&(Ye=performance.now())});var V=ge({title:`infinite world`,info:`Unbounded landmark level + world-anchored rock cells streamed around a flying camera. Steer with A/D or arrow keys.`}),$e=document.createElement(`style`);$e.textContent=`
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
`,document.head.appendChild($e);var et=V.el.querySelector(`.pcg-stats`)?.previousElementSibling??V.el;V.addSeed(_,e=>{_=e,R()}),V.addSlider(`speed`,{min:0,max:80,step:1,value:v,format:e=>`${e} u/s`},e=>{v=e}),V.addSlider(`gen radius`,{min:60,max:240,step:10,value:y,format:e=>`${e} u`},e=>{y=e,R()}),V.addSlider(`cell size`,{min:20,max:80,step:20,value:S,format:e=>`${e} u`},e=>{S=e,Le(),R()}),V.addCheckbox(`world-anchored`,C,e=>{C=e,mt(),R()}),V.addCheckbox(`halo (4 u)`,Oe,e=>{Oe=e,R()}),V.addCheckbox(`cell grid`,ke,e=>{ke=e,D&&(D.visible=e),Re()});var H=document.createElement(`div`);H.className=`pcg04-seg`;var U=document.createElement(`button`);U.type=`button`,U.textContent=`GPU per-node`;var W=document.createElement(`button`);W.type=`button`,W.textContent=`CPU`,H.append(U,W);var G=document.createElement(`p`);G.className=`pcg04-hint`,G.textContent=`G switches path · A/D or ←/→ steer`;var K=document.createElement(`div`);K.className=`pcg-row`;var tt=document.createElement(`label`);tt.textContent=`derived specs`;var q=document.createElement(`input`);q.type=`checkbox`,q.checked=x,q.addEventListener(`change`,()=>{x=q.checked,R()}),K.append(tt,q),et.prepend(H,G,K);function J(e){if(e!==b){if(e===`gpu`&&!M()){Z(A?Q():k??`GPU path not ready yet.`);return}b=e,Y(),R(),Z(ht())}}U.addEventListener(`click`,()=>J(`gpu`)),W.addEventListener(`click`,()=>J(`cpu`));function Y(){U.setAttribute(`aria-pressed`,String(b===`gpu`)),W.setAttribute(`aria-pressed`,String(b===`cpu`)),U.disabled=!M(),U.title=k===void 0?A?Q():``:k,q.disabled=!M()||b===`cpu`}var X=V.addStat(`adapter`),nt=V.addStat(`fps`),rt=V.addStat(`rock source`),it=V.addStat(`rock cells`),at=V.addStat(`cooked / evicted`),ot=V.addStat(`pending`),st=V.addStat(`instances`),ct=V.addStat(`position`),lt=V.addStat(`cook`),ut=V.addStat(`resident runs / fused members`),dt=V.addStat(`device dispatches`),ft=V.addStat(`gpu fallbacks`),pt=V.addStat(`status`);function Z(e){pt(e)}function mt(){rt(C?`pointScatterInWorld`:`pointScatterInBounds`)}function Q(){return`device lost (${We}) — the GPU path is disabled; reload for a fresh device`}function ht(){return A?Q():b===`cpu`?`CPU path — no resolver passed to the cook`:M()?x?`GPU per-node — combinator fields accepted via acceptDerivedSpecs`:`GPU per-node — acceptDerivedSpecs off, so every field falls back`:k??`requesting WebGPU adapter…`}function gt(){if(lt(I===void 0?`–`:`${I.toFixed(1)} ms`),j===void 0){ut(P?.tap===void 0?`– (no GPU resolver)`:`–`),dt(`–`),ft(`–`);return}ut(`${j.residentRuns} / ${j.fusedNodes}`),dt(String(j.dispatches)),ft(De(j.fallbacks))}var _t=V.addSlot();c(),V.addNote(`Drag “cell size”: the blue grid re-cells the world and the rocks do not move or resize. Untick “halo” to watch every border grow a band of undersized rocks, and “world-anchored” to watch the same drag re-roll the world from scratch.`);var vt=V.addCollapsible(`anchoring · what the fine level actually does`);vt.textContent=`pointScatterInWorld scatters over an INFINITE lattice fixed to
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
anything that has to see past its own bounds.`;var yt=V.addCollapsible(`diagnostics · why nothing fuses here`);yt.textContent=`resident runs / fused members reads 0 / 0 on BOTH paths, and
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
update cooks nothing.`;function bt(e){A=!0,We=e,O=`device lost`,X(O),Z(Q()),Y(),b===`gpu`&&(b=`cpu`,Y(),R())}async function xt(){let e=await we(bt);if(`error`in e){k=e.error,O=`no WebGPU adapter`,X(O),b=`cpu`,Y(),Z(`${e.error} Running the CPU path.`);return}try{let t=Te(e);He=t.derived,Ue=t.strict}catch(e){k=`GpuFieldEvaluator construction failed: ${Pe(e)}`,O=`evaluator unavailable`,X(O),b=`cpu`,Y(),Z(`${k} Running the CPU path.`);return}A||(O=e.label,X(O),Y(),Z(ht()),b===`gpu`&&R())}var $=!1,St=t(e=>nt(e));X(O),Z(`requesting WebGPU adapter…`),Y(),mt(),gt(),Le(),R(),xt(),Fe(e=>{St(),Qe=(B.has(`a`)||B.has(`arrowleft`)?1:0)-(B.has(`d`)||B.has(`arrowright`)?1:0),z+=Qe*1.1*e,T.position.x+=Math.sin(z)*v*e,T.position.z+=Math.cos(z)*v*e,T.position.y=26,T.lookAt(T.position.x+Math.sin(z)*60,5,T.position.z+Math.cos(z)*60),Re();let t=P;if(t&&!$?Ze(t,Ae):$&&!L&&performance.now()-Ye>Ne&&(L=!0,Z(`a cook has been in flight for over 5 s — the GPU device may have been lost.`)),t){let e=t.world.stats(),n=e.levels.find(e=>e.name===`rocks`)?.cellCount??0;it(String(n)),at(`${e.totalCooked} / ${e.totalEvicted}`),ot(String(F));let r=0;for(let e of t.cellInstances.values())r+=e;st(String(r)),ct(`${T.position.x.toFixed(0)}, ${T.position.z.toFixed(0)}`)}});