import{$o as e,As as t,D as n,Ds as r,Es as i,Fo as a,Go as ee,Ha as te,Ko as ne,Ks as re,To as ie,Ua as ae,Yt as o,_s as oe,_t as s,bt as c,eo as se,fa as ce,gt as l,hn as u,in as d,io as le,lo as ue,r as f,ro as de,rt as p,ua as m,vo as fe,xs as h}from"./wordmark-BkASP7CQ.js";import{t as pe}from"./types-C9vZymIy.js";import{t as g}from"./scene-C_96KjqV.js";import{t as me}from"./gpu-BJpy4hsP.js";import{r as he}from"./three-DWYpPtpM.js";import{n as ge,t as _e}from"./panel-BJJarKyN.js";var ve=.35,ye=777;function be(){let e=new fe,n=e.add(te,{count:170,boundsMin:[-800,0,-800],boundsMax:[800,0,800]}),r=e.add(ue,{name:`scale`,tupleSize:3,value:(()=>{let e=h(t(`mega`),0,1,5,13);return i(e,oe(e,1.6),e)})()}),a=e.add(ce,{assetId:`megarock`});return e.connect(n,`out`,r,`in`),e.connect(r,`out`,a,`in`),e.output(a,`instances`,`instances`),{name:`landmarks`,cellSize:`unbounded`,generationRadius:1/0,graph:e,bind(e,t){e.setParam(n,`seed`,t.seed),e.setParam(r,`seed`,re(t.seed,9))}}}function xe(n){let{cellSize:ee,generationRadius:ne,anchored:o}=n,s=n.halo?4:0,c=new fe,l=o?c.add(ae,{density:ve,cellSize:7,latticeMode:`xz`,height:0}):c.add(te,{count:Math.round(ve*(ee+2*s)**2)}),u=c.add(ue,{name:`density`,tupleSize:1,value:h(ie(a,{seed:ye,frequency:.02,octaves:3}),-1,1,0,1)}),d=c.add(le,{mode:`probabilistic`}),f=c.add(se,{radius:4,countAttr:`nbrCount`}),p=c.add(de,{mode:`inside`}),m=c.add(ue,{name:`scale`,tupleSize:3,value:(()=>{let n=h(e(r(`nbrCount`),2,16),2,16,.4,1.35),a=oe(n,h(t(`rock`),0,1,.85,1.15));return i(a,a,a)})()}),g=c.add(ce,{assetId:`rock`});return c.connect(l,`out`,u,`in`),c.connect(u,`out`,d,`in`),c.connect(d,`out`,f,`in`),c.connect(f,`out`,p,`in`),c.connect(p,`out`,m,`in`),c.connect(m,`out`,g,`in`),c.output(g,`instances`,`instances`),{name:`rocks`,cellSize:ee,generationRadius:ne,graph:c,bind(e,t){let{min:n,max:r}=pe(t);e.setParam(l,`boundsMin`,[n[0]-s,0,n[1]-s]),e.setParam(l,`boundsMax`,[r[0]+s,0,r[1]+s]);let i=o?t.worldSeed:t.seed;e.setParam(l,`seed`,i),e.setParam(d,`seed`,re(i,1)),e.setParam(m,`seed`,re(i,2)),e.setParam(p,`boundsMin`,[n[0],-1,n[1]]),e.setParam(p,`boundsMax`,[r[0],1,r[1]])}}}function Se(e){return e instanceof Error?e.message:String(e)}function Ce(e){let t=(e?.description??``)===``?e?.device:e?.description;return[e?.vendor,e?.architecture,t].filter(e=>typeof e==`string`&&e!==``).join(` · `)||`adapter (no info exposed)`}async function we(e){let t=navigator.gpu;if(t===void 0)return{error:`navigator.gpu is missing — this browser has no WebGPU.`};try{let n=await t.requestAdapter();if(n===null)return{error:`navigator.gpu.requestAdapter() returned null — no compatible GPU adapter.`};let r=n.info,i=await n.requestDevice(),a=i.lost;return a!==void 0&&a.then(t=>{e(`${t?.reason??`unknown`}: ${t?.message??`no detail`}`)}),{device:i,info:r,label:Ce(r)}}catch(e){return{error:`requestDevice() failed: ${Se(e)}`}}}function Te(e){let t=e.info===void 0?{}:{adapterInfo:e.info};return{derived:new me(e.device,{...t,acceptDerivedSpecs:!0}),strict:new me(e.device,t)}}var Ee=class{cacheSalt;residentTerminals;acceptDerivedSpecs;base;seen=new Set;constructor(e){this.base=e,this.cacheSalt=e.cacheSalt,this.residentTerminals=e.residentTerminals,this.acceptDerivedSpecs=e.acceptDerivedSpecs}resolveField(e,t,n){return n!==void 0&&this.seen.add(n),this.base.resolveField(e,t,n)}planRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.planRun(e,t,n)}executeRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.executeRun(e,t,n)}drain(){if(this.seen.size===0)return;let e=ne();for(let t of this.seen){e.dispatches+=t.dispatches,e.pipelinesCompiled+=t.pipelinesCompiled,e.pipelineCacheHits+=t.pipelineCacheHits,e.residentRuns+=t.residentRuns,e.fusedNodes+=t.fusedNodes,e.readbacksSaved+=t.readbacksSaved;for(let[n,r]of Object.entries(t.fallbacks))e.fallbacks[n]=(e.fallbacks[n]??0)+r}return this.seen.clear(),e}};function De(e){let t=Object.entries(e).sort(([e],[t])=>e.localeCompare(t));return t.length===0?`none`:t.map(([e,t])=>`${e} ×${t}`).join(`, `)}var Oe=1,_=18,v=140,y=`gpu`,b=!0,x=20,S=!0,C=!0,w=!0,ke=7,Ae=12,je=8,Me=5e3;function Ne(e){return e instanceof Error?e.message:String(e)}var{scene:T,camera:E,start:Pe}=g({cameraPosition:[0,26,0],orbit:!1,fog:{near:140,far:640},far:1600}),D=new o(new u(4e3,4e3),new d({color:1449515,roughness:1}));D.rotation.x=-Math.PI/2,D.position.y=-.03,T.add(D);var Fe=40,O;function Ie(){O&&(T.remove(O),O.geometry.dispose(),O.material.dispose());let e=new l(x*Fe,Fe,4158656,2903936),t=e.material;t.transparent=!0,t.opacity=.45,t.depthWrite=!1,e.position.y=.02,e.visible=w,T.add(e),O=e}function Le(){!O||!O.visible||(O.position.x=Math.round(E.position.x/x)*x,O.position.z=Math.round(E.position.z/x)*x)}var Re=new d({color:8028816,roughness:.95,flatShading:!0}),ze=new d({color:6121077,roughness:1,flatShading:!0}),Be={megarock:{geometry:new p(1).translate(0,.62,0),material:ze},rock:{geometry:new c(.55).translate(0,.33,0),material:Re}},k,Ve,A=`requesting…`,j,M=!1,He=``,N;function P(){return k!==void 0&&!M}function Ue(){if(!(y===`cpu`||!P()))return b?k:Ve}var We;function Ge(e,t){let n=[{name:`landmarks`,graph:e},{name:`rocks`,graph:t}];We?We.set(n):We=_e(n,{into:_t,title:`infinite world`})}function Ke(e,t){let n=e*1.25/t+1.5;return Math.max(256,Math.ceil(Math.PI*n*n))}function qe(e){let t=0;for(let n of Object.keys(e))for(let r of e[n])if(r.kind===`instances`)for(let e of r.batches)t+=e.count;return t}var F,Je=0,I,L=0,R=!1,Ye=0;function z(){F&&(F.disposed=!0,F.abort.abort(),F.binding.dispose(),T.remove(F.group));let e=new s;T.add(e);let t=new he({group:e,assets:Be}),n=new Map,r=Ue(),i={world:void 0,group:e,binding:t,cellInstances:n,tap:r===void 0?void 0:new Ee(r),abort:new AbortController,disposed:!1},a=[be(),xe({cellSize:x,generationRadius:v,anchored:S,halo:C})];Ge(a[0].graph,a[1].graph),i.world=new m({seed:Oe,levels:a,maxCellsPerLevel:Ke(v,x),...i.tap===void 0?{}:{gpu:i.tap},onCellReady:(e,r,a)=>{i.disposed||(t.cellReady(e,r,a),n.set(`${e}|${r[0]},${r[1]}`,qe(a)))},onCellEvicted:(e,r)=>{i.disposed||(t.cellEvicted(e,r),n.delete(`${e}|${r[0]},${r[1]}`))}}),F=i,Je=0,N=void 0,I=void 0,gt(),Xe(i,Ae)}function Xe(e,t){let n=++Ye;$=!0,L=performance.now(),e.world.update([E.position.x,0,E.position.z],{budgetMs:t,maxCooksPerUpdate:je,signal:e.abort.signal,...e.tap===void 0?{}:{gpu:e.tap}}).then(t=>{if(e.disposed)return;Je=t.pending,I=t.elapsedMs;let n=e.tap?.drain();n!==void 0&&(N=n),gt(),R&&(R=!1,Z(ht()))}).catch(t=>{t instanceof ee||(console.error(t),e.disposed||Z(`update failed: ${Ne(t)}`))}).finally(()=>{n===Ye&&($=!1)})}var B=0,Ze=0,V=new Set;window.addEventListener(`keydown`,e=>{let t=e.key.toLowerCase();if(t===`g`){tt(y===`gpu`?`cpu`:`gpu`);return}V.add(t)}),window.addEventListener(`keyup`,e=>V.delete(e.key.toLowerCase())),document.addEventListener(`visibilitychange`,()=>{document.visibilityState===`visible`&&(L=performance.now())});var H=ge({title:`infinite world`,info:`Unbounded landmark level + world-anchored rock cells streamed around a flying camera. Steer with A/D or arrow keys.`}),Qe=document.createElement(`style`);Qe.textContent=`
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
`,document.head.appendChild(Qe);var $e=H.el.querySelector(`.pcg-stats`)?.previousElementSibling??H.el;H.addSeed(Oe,e=>{Oe=e,z()}),H.addSlider(`speed`,{min:0,max:80,step:1,value:_,format:e=>`${e} u/s`},e=>{_=e}),H.addSlider(`gen radius`,{min:60,max:240,step:10,value:v,format:e=>`${e} u`},e=>{v=e,z()}),H.addSlider(`cell size`,{min:20,max:80,step:20,value:x,format:e=>`${e} u`},e=>{x=e,Ie(),z()}),H.addCheckbox(`world-anchored`,S,e=>{S=e,mt(),z()}),H.addCheckbox(`halo (4 u)`,C,e=>{C=e,z()}),H.addCheckbox(`cell grid`,w,e=>{w=e,O&&(O.visible=e),Le()});var U=document.createElement(`div`);U.className=`pcg04-seg`;var W=document.createElement(`button`);W.type=`button`,W.textContent=`GPU per-node`;var G=document.createElement(`button`);G.type=`button`,G.textContent=`CPU`,U.append(W,G);var K=document.createElement(`p`);K.className=`pcg04-hint`,K.textContent=`G switches path · A/D or ←/→ steer`;var q=document.createElement(`div`);q.className=`pcg-row`;var et=document.createElement(`label`);et.textContent=`derived specs`;var J=document.createElement(`input`);J.type=`checkbox`,J.checked=b,J.addEventListener(`change`,()=>{b=J.checked,z()}),q.append(et,J),$e.prepend(U,K,q);function tt(e){if(e!==y){if(e===`gpu`&&!P()){Z(M?Q():j??`GPU path not ready yet.`);return}y=e,Y(),z(),Z(ht())}}W.addEventListener(`click`,()=>tt(`gpu`)),G.addEventListener(`click`,()=>tt(`cpu`));function Y(){W.setAttribute(`aria-pressed`,String(y===`gpu`)),G.setAttribute(`aria-pressed`,String(y===`cpu`)),W.disabled=!P(),W.title=j===void 0?M?Q():``:j,J.disabled=!P()||y===`cpu`}var X=H.addStat(`adapter`),nt=H.addStat(`fps`),rt=H.addStat(`rock source`),it=H.addStat(`rock cells`),at=H.addStat(`cooked / evicted`),ot=H.addStat(`pending`),st=H.addStat(`instances`),ct=H.addStat(`position`),lt=H.addStat(`cook`),ut=H.addStat(`resident runs / fused members`),dt=H.addStat(`device dispatches`),ft=H.addStat(`gpu fallbacks`),pt=H.addStat(`status`);function Z(e){pt(e)}function mt(){rt(S?`pointScatterInWorld`:`pointScatterInBounds`)}function Q(){return`device lost (${He}) — the GPU path is disabled; reload for a fresh device`}function ht(){return M?Q():y===`cpu`?`CPU path — no resolver passed to the cook`:P()?b?`GPU per-node — combinator fields accepted via acceptDerivedSpecs`:`GPU per-node — acceptDerivedSpecs off, so every field falls back`:j??`requesting WebGPU adapter…`}function gt(){if(lt(I===void 0?`–`:`${I.toFixed(1)} ms`),N===void 0){ut(F?.tap===void 0?`– (no GPU resolver)`:`–`),dt(`–`),ft(`–`);return}ut(`${N.residentRuns} / ${N.fusedNodes}`),dt(String(N.dispatches)),ft(De(N.fallbacks))}var _t=H.addSlot();f(),H.addNote(`Drag “cell size”: the blue grid re-cells the world and the rocks do not move or resize. Untick “halo” to watch every border grow a band of undersized rocks, and “world-anchored” to watch the same drag re-roll the world from scratch.`);var vt=H.addCollapsible(`anchoring · what the fine level actually does`);vt.textContent=`pointScatterInWorld scatters over an INFINITE lattice fixed to
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
anything that has to see past its own bounds.`;var yt=H.addCollapsible(`diagnostics · why nothing fuses here`);yt.textContent=`resident runs / fused members reads 0 / 0 on BOTH paths, and
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
update cooks nothing.`;function bt(e){M=!0,He=e,A=`device lost`,X(A),Z(Q()),Y(),y===`gpu`&&(y=`cpu`,Y(),z())}async function xt(){let e=await we(bt);if(`error`in e){j=e.error,A=`no WebGPU adapter`,X(A),y=`cpu`,Y(),Z(`${e.error} Running the CPU path.`);return}try{let t=Te(e);k=t.derived,Ve=t.strict}catch(e){j=`GpuFieldEvaluator construction failed: ${Ne(e)}`,A=`evaluator unavailable`,X(A),y=`cpu`,Y(),Z(`${j} Running the CPU path.`);return}M||(A=e.label,X(A),Y(),Z(ht()),y===`gpu`&&z())}var $=!1,St=n(e=>nt(e));X(A),Z(`requesting WebGPU adapter…`),Y(),mt(),gt(),Ie(),z(),xt(),Pe(e=>{St(),Ze=(V.has(`a`)||V.has(`arrowleft`)?1:0)-(V.has(`d`)||V.has(`arrowright`)?1:0),B+=Ze*1.1*e,E.position.x+=Math.sin(B)*_*e,E.position.z+=Math.cos(B)*_*e,E.position.y=26,E.lookAt(E.position.x+Math.sin(B)*60,5,E.position.z+Math.cos(B)*60),Le();let t=F;if(t&&!$?Xe(t,ke):$&&!R&&performance.now()-L>Me&&(R=!0,Z(`a cook has been in flight for over 5 s — the GPU device may have been lost.`)),t){let e=t.world.stats(),n=e.levels.find(e=>e.name===`rocks`)?.cellCount??0;it(String(n)),at(`${e.totalCooked} / ${e.totalEvicted}`),ot(String(Je));let r=0;for(let e of t.cellInstances.values())r+=e;st(String(r)),ct(`${E.position.x.toFixed(0)}, ${E.position.z.toFixed(0)}`)}});