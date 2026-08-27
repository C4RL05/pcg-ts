import{An as e,D as t,En as n,Fn as r,Hr as i,It as a,Jr as o,Rr as ee,Rt as te,Wn as ne,Zn as re,Zr as ie,br as ae,gr as oe,hn as se,hr as s,kn as ce,mn as le,pi as c,qr as ue,r as l,sr as de}from"./wordmark-CrTwGKuQ.js";import{t as fe}from"./types-C9vZymIy.js";import{A as u,St as d,U as pe,Vt as f,W as me,jt as p,q as m}from"./three.core-B85ZZh_6.js";import{t as h}from"./scene-QpK-6DxV.js";import{t as he}from"./gpu-CACZqdd1.js";import{t as ge}from"./worldBinding-Bp0GpDUJ.js";import{n as _e,t as ve}from"./panel-BxfdjczJ.js";var ye=.35,be=777;function xe(){let e=new ne,t=e.add(le,{count:170,boundsMin:[-800,0,-800],boundsMax:[800,0,800]}),n=e.add(r,{name:`scale`,tupleSize:3,value:(()=>{let e=i(ie(`mega`),0,1,5,13);return ue(e,ee(e,1.6),e)})()}),a=e.add(te,{assetId:`megarock`});return e.connect(t,`out`,n,`in`),e.connect(n,`out`,a,`in`),e.output(a,`instances`,`instances`),{name:`landmarks`,cellSize:`unbounded`,generationRadius:1/0,graph:e,bind(e,r){e.setParam(t,`seed`,r.seed),e.setParam(n,`seed`,c(r.seed,9))}}}function Se(t){let{cellSize:a,generationRadius:oe,anchored:s}=t,l=t.halo?4:0,u=new ne,d=s?u.add(se,{density:ye,cellSize:7,latticeMode:`xz`,height:0}):u.add(le,{count:Math.round(ye*(a+2*l)**2)}),pe=u.add(r,{name:`density`,tupleSize:1,value:i(re(de,{seed:be,frequency:.02,octaves:3}),-1,1,0,1)}),f=u.add(e,{mode:`probabilistic`}),me=u.add(n,{radius:4,countAttr:`nbrCount`}),p=u.add(ce,{mode:`inside`}),m=u.add(r,{name:`scale`,tupleSize:3,value:(()=>{let e=i(ae(o(`nbrCount`),2,16),2,16,.4,1.35),t=ee(e,i(ie(`rock`),0,1,.85,1.15));return ue(t,t,t)})()}),h=u.add(te,{assetId:`rock`});return u.connect(d,`out`,pe,`in`),u.connect(pe,`out`,f,`in`),u.connect(f,`out`,me,`in`),u.connect(me,`out`,p,`in`),u.connect(p,`out`,m,`in`),u.connect(m,`out`,h,`in`),u.output(h,`instances`,`instances`),{name:`rocks`,cellSize:a,generationRadius:oe,graph:u,bind(e,t){let{min:n,max:r}=fe(t);e.setParam(d,`boundsMin`,[n[0]-l,0,n[1]-l]),e.setParam(d,`boundsMax`,[r[0]+l,0,r[1]+l]);let i=s?t.worldSeed:t.seed;e.setParam(d,`seed`,i),e.setParam(f,`seed`,c(i,1)),e.setParam(m,`seed`,c(i,2)),e.setParam(p,`boundsMin`,[n[0],-1,n[1]]),e.setParam(p,`boundsMax`,[r[0],1,r[1]])}}}function Ce(e){return e instanceof Error?e.message:String(e)}function we(e){let t=(e?.description??``)===``?e?.device:e?.description;return[e?.vendor,e?.architecture,t].filter(e=>typeof e==`string`&&e!==``).join(` · `)||`adapter (no info exposed)`}async function Te(e){let t=navigator.gpu;if(t===void 0)return{error:`navigator.gpu is missing — this browser has no WebGPU.`};try{let n=await t.requestAdapter();if(n===null)return{error:`navigator.gpu.requestAdapter() returned null — no compatible GPU adapter.`};let r=n.info,i=await n.requestDevice(),a=i.lost;return a!==void 0&&a.then(t=>{e(`${t?.reason??`unknown`}: ${t?.message??`no detail`}`)}),{device:i,info:r,label:we(r)}}catch(e){return{error:`requestDevice() failed: ${Ce(e)}`}}}function Ee(e){let t=e.info===void 0?{}:{adapterInfo:e.info};return{derived:new he(e.device,{...t,acceptDerivedSpecs:!0}),strict:new he(e.device,t)}}var De=class{cacheSalt;residentTerminals;acceptDerivedSpecs;base;seen=new Set;constructor(e){this.base=e,this.cacheSalt=e.cacheSalt,this.residentTerminals=e.residentTerminals,this.acceptDerivedSpecs=e.acceptDerivedSpecs}resolveField(e,t,n){return n!==void 0&&this.seen.add(n),this.base.resolveField(e,t,n)}planRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.planRun(e,t,n)}executeRun(e,t,n){return n!==void 0&&this.seen.add(n),this.base.executeRun(e,t,n)}drain(){if(this.seen.size===0)return;let e=oe();for(let t of this.seen){e.dispatches+=t.dispatches,e.pipelinesCompiled+=t.pipelinesCompiled,e.pipelineCacheHits+=t.pipelineCacheHits,e.residentRuns+=t.residentRuns,e.fusedNodes+=t.fusedNodes,e.readbacksSaved+=t.readbacksSaved;for(let[n,r]of Object.entries(t.fallbacks))e.fallbacks[n]=(e.fallbacks[n]??0)+r}return this.seen.clear(),e}};function Oe(e){let t=Object.entries(e).sort(([e],[t])=>e.localeCompare(t));return t.length===0?`none`:t.map(([e,t])=>`${e} ×${t}`).join(`, `)}var g=1,_=18,v=140,y=`gpu`,b=!0,x=20,S=!0,C=!0,w=!0,ke=7,Ae=12,je=8,Me=5e3;function Ne(e){return e instanceof Error?e.message:String(e)}var{scene:T,camera:E,start:Pe}=h({cameraPosition:[0,26,0],orbit:!1,fog:{near:140,far:640},far:1600}),D=new d(new f(4e3,4e3),new p({color:1449515,roughness:1}));D.rotation.x=-Math.PI/2,D.position.y=-.03,T.add(D);var Fe=40,O;function Ie(){O&&(T.remove(O),O.geometry.dispose(),O.material.dispose());let e=new pe(x*Fe,Fe,4158656,2903936),t=e.material;t.transparent=!0,t.opacity=.45,t.depthWrite=!1,e.position.y=.02,e.visible=w,T.add(e),O=e}function Le(){!O||!O.visible||(O.position.x=Math.round(E.position.x/x)*x,O.position.z=Math.round(E.position.z/x)*x)}var Re=new p({color:8028816,roughness:.95,flatShading:!0}),ze=new p({color:6121077,roughness:1,flatShading:!0}),Be={megarock:{geometry:new u(1).translate(0,.62,0),material:ze},rock:{geometry:new m(.55).translate(0,.33,0),material:Re}},Ve,He,k=`requesting…`,A,j=!1,Ue=``,M;function N(){return Ve!==void 0&&!j}function We(){if(!(y===`cpu`||!N()))return b?Ve:He}var P;function Ge(e,t){let n=[{name:`landmarks`,graph:e},{name:`rocks`,graph:t}];P?P.set(n):P=ve(n,{into:_t,title:`infinite world`})}function Ke(e,t){let n=e*1.25/t+1.5;return Math.max(256,Math.ceil(Math.PI*n*n))}function qe(e){let t=0;for(let n of Object.keys(e))for(let r of e[n])if(r.kind===`instances`)for(let e of r.batches)t+=e.count;return t}var F,Je=0,I,Ye=0,L=!1,Xe=0;function R(){F&&(F.disposed=!0,F.abort.abort(),F.binding.dispose(),T.remove(F.group));let e=new me;T.add(e);let t=new ge({group:e,assets:Be}),n=new Map,r=We(),i={world:void 0,group:e,binding:t,cellInstances:n,tap:r===void 0?void 0:new De(r),abort:new AbortController,disposed:!1},o=[xe(),Se({cellSize:x,generationRadius:v,anchored:S,halo:C})];Ge(o[0].graph,o[1].graph),i.world=new a({seed:g,levels:o,maxCellsPerLevel:Ke(v,x),...i.tap===void 0?{}:{gpu:i.tap},onCellReady:(e,r,a)=>{i.disposed||(t.cellReady(e,r,a),n.set(`${e}|${r[0]},${r[1]}`,qe(a)))},onCellEvicted:(e,r)=>{i.disposed||(t.cellEvicted(e,r),n.delete(`${e}|${r[0]},${r[1]}`))}}),F=i,Je=0,M=void 0,I=void 0,gt(),Ze(i,Ae)}function Ze(e,t){let n=++Xe;$=!0,Ye=performance.now(),e.world.update([E.position.x,0,E.position.z],{budgetMs:t,maxCooksPerUpdate:je,signal:e.abort.signal,...e.tap===void 0?{}:{gpu:e.tap}}).then(t=>{if(e.disposed)return;Je=t.pending,I=t.elapsedMs;let n=e.tap?.drain();n!==void 0&&(M=n),gt(),L&&(L=!1,Z(ht()))}).catch(t=>{t instanceof s||(console.error(t),e.disposed||Z(`update failed: ${Ne(t)}`))}).finally(()=>{n===Xe&&($=!1)})}var z=0,Qe=0,B=new Set;window.addEventListener(`keydown`,e=>{let t=e.key.toLowerCase();if(t===`g`){J(y===`gpu`?`cpu`:`gpu`);return}B.add(t)}),window.addEventListener(`keyup`,e=>B.delete(e.key.toLowerCase())),document.addEventListener(`visibilitychange`,()=>{document.visibilityState===`visible`&&(Ye=performance.now())});var V=_e({title:`infinite world`,info:`Unbounded landmark level + world-anchored rock cells streamed around a flying camera. Steer with A/D or arrow keys.`}),$e=document.createElement(`style`);$e.textContent=`
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
`,document.head.appendChild($e);var et=V.el.querySelector(`.pcg-stats`)?.previousElementSibling??V.el;V.addSeed(g,e=>{g=e,R()}),V.addSlider(`speed`,{min:0,max:80,step:1,value:_,format:e=>`${e} u/s`},e=>{_=e}),V.addSlider(`gen radius`,{min:60,max:240,step:10,value:v,format:e=>`${e} u`},e=>{v=e,R()}),V.addSlider(`cell size`,{min:20,max:80,step:20,value:x,format:e=>`${e} u`},e=>{x=e,Ie(),R()}),V.addCheckbox(`world-anchored`,S,e=>{S=e,mt(),R()}),V.addCheckbox(`halo (4 u)`,C,e=>{C=e,R()}),V.addCheckbox(`cell grid`,w,e=>{w=e,O&&(O.visible=e),Le()});var H=document.createElement(`div`);H.className=`pcg04-seg`;var U=document.createElement(`button`);U.type=`button`,U.textContent=`GPU per-node`;var W=document.createElement(`button`);W.type=`button`,W.textContent=`CPU`,H.append(U,W);var G=document.createElement(`p`);G.className=`pcg04-hint`,G.textContent=`G switches path · A/D or ←/→ steer`;var K=document.createElement(`div`);K.className=`pcg-row`;var tt=document.createElement(`label`);tt.textContent=`derived specs`;var q=document.createElement(`input`);q.type=`checkbox`,q.checked=b,q.addEventListener(`change`,()=>{b=q.checked,R()}),K.append(tt,q),et.prepend(H,G,K);function J(e){if(e!==y){if(e===`gpu`&&!N()){Z(j?Q():A??`GPU path not ready yet.`);return}y=e,Y(),R(),Z(ht())}}U.addEventListener(`click`,()=>J(`gpu`)),W.addEventListener(`click`,()=>J(`cpu`));function Y(){U.setAttribute(`aria-pressed`,String(y===`gpu`)),W.setAttribute(`aria-pressed`,String(y===`cpu`)),U.disabled=!N(),U.title=A===void 0?j?Q():``:A,q.disabled=!N()||y===`cpu`}var X=V.addStat(`adapter`),nt=V.addStat(`fps`),rt=V.addStat(`rock source`),it=V.addStat(`rock cells`),at=V.addStat(`cooked / evicted`),ot=V.addStat(`pending`),st=V.addStat(`instances`),ct=V.addStat(`position`),lt=V.addStat(`cook`),ut=V.addStat(`resident runs / fused members`),dt=V.addStat(`device dispatches`),ft=V.addStat(`gpu fallbacks`),pt=V.addStat(`status`);function Z(e){pt(e)}function mt(){rt(S?`pointScatterInWorld`:`pointScatterInBounds`)}function Q(){return`device lost (${Ue}) — the GPU path is disabled; reload for a fresh device`}function ht(){return j?Q():y===`cpu`?`CPU path — no resolver passed to the cook`:N()?b?`GPU per-node — combinator fields accepted via acceptDerivedSpecs`:`GPU per-node — acceptDerivedSpecs off, so every field falls back`:A??`requesting WebGPU adapter…`}function gt(){if(lt(I===void 0?`–`:`${I.toFixed(1)} ms`),M===void 0){ut(F?.tap===void 0?`– (no GPU resolver)`:`–`),dt(`–`),ft(`–`);return}ut(`${M.residentRuns} / ${M.fusedNodes}`),dt(String(M.dispatches)),ft(Oe(M.fallbacks))}var _t=V.addSlot();l(),V.addNote(`Drag “cell size”: the blue grid re-cells the world and the rocks do not move or resize. Untick “halo” to watch every border grow a band of undersized rocks, and “world-anchored” to watch the same drag re-roll the world from scratch.`);var vt=V.addCollapsible(`anchoring · what the fine level actually does`);vt.textContent=`pointScatterInWorld scatters over an INFINITE lattice fixed to
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
update cooks nothing.`;function bt(e){j=!0,Ue=e,k=`device lost`,X(k),Z(Q()),Y(),y===`gpu`&&(y=`cpu`,Y(),R())}async function xt(){let e=await Te(bt);if(`error`in e){A=e.error,k=`no WebGPU adapter`,X(k),y=`cpu`,Y(),Z(`${e.error} Running the CPU path.`);return}try{let t=Ee(e);Ve=t.derived,He=t.strict}catch(e){A=`GpuFieldEvaluator construction failed: ${Ne(e)}`,k=`evaluator unavailable`,X(k),y=`cpu`,Y(),Z(`${A} Running the CPU path.`);return}j||(k=e.label,X(k),Y(),Z(ht()),y===`gpu`&&R())}var $=!1,St=t(e=>nt(e));X(k),Z(`requesting WebGPU adapter…`),Y(),mt(),gt(),Ie(),R(),xt(),Pe(e=>{St(),Qe=(B.has(`a`)||B.has(`arrowleft`)?1:0)-(B.has(`d`)||B.has(`arrowright`)?1:0),z+=Qe*1.1*e,E.position.x+=Math.sin(z)*_*e,E.position.z+=Math.cos(z)*_*e,E.position.y=26,E.lookAt(E.position.x+Math.sin(z)*60,5,E.position.z+Math.cos(z)*60),Le();let t=F;if(t&&!$?Ze(t,ke):$&&!L&&performance.now()-Ye>Me&&(L=!0,Z(`a cook has been in flight for over 5 s — the GPU device may have been lost.`)),t){let e=t.world.stats(),n=e.levels.find(e=>e.name===`rocks`)?.cellCount??0;it(String(n)),at(`${e.totalCooked} / ${e.totalEvicted}`),ot(String(Je));let r=0;for(let e of t.cellInstances.values())r+=e;st(String(r)),ct(`${E.position.x.toFixed(0)}, ${E.position.z.toFixed(0)}`)}});