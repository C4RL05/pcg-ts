import{Gt as e,H as t,Ht as n,Kt as r,N as i,St as a,Ut as o,Vt as s,Wt as c,Xt as l,Y as u,Yt as d,Zt as f,_t as p,at as m,bt as h,dt as g,ft as _,gt as ee,k as v,mt as te,n as y,nt as b,o as x,ot as ne,pt as re,qt as ie,rt as S,s as ae,st as oe,ut as se,xt as C,yt as ce,zt as le}from"./OrbitControls-T5ZMkvp0.js";import{t as ue}from"./recook-DLZ34zXJ.js";import{t as de}from"./scene-Cwh6BJNL.js";import{A as w,B as fe,C as pe,D as T,E,F as me,H as D,L as he,M as O,N as ge,P as _e,V as ve,_ as ye,a as be,c as xe,d as Se,f as Ce,g as we,i as Te,j as Ee,n as De,p as Oe,u as ke,v as k,w as A,x as j,y as M,z as Ae}from"./disclose-version-BKE8TYfr.js";var N=class extends Error{constructor(e){super(e),this.name=`GpuCompileError`}};function P(e,t){let n=Math.fround(e);if(!Number.isFinite(n))throw new N(`${t}: value ${e} is not representable as a finite f32 (WGSL kernels compute in f32; keep magnitudes within ~3.4e38)`);return Object.is(n,-0)?`-0f`:`${String(n)}f`}function je(e){return`${e>>>0}u`}function F(e){return`0x${(e>>>0).toString(16).padStart(8,`0`)}u`}var I=F,Me=P(34028234663852886e22,`internal f32 max`);function L(e,t){let n=I(e);for(let e of t)n=`pcg_hash_mix(${n}, ${e})`;return`pcg_hash_finalize(${n})`}function Ne(){let e=[];for(let t=0;t<12;t++){let n=e=>P(h[t*3+e],`internal GRAD3`);e.push(`  vec3<f32>(${n(0)}, ${n(1)}, ${n(2)}),`)}return`var<private> PCG_GRAD3: array<vec3<f32>, 12> = array<vec3<f32>, 12>(
${e.join(`
`)}
);`}var R=e=>t=>P(t,e),Pe=new Map([[`PCG_GRAD3`,{deps:[],text:Ne()}],[`pcg_hash_mix`,{deps:[],text:`fn pcg_hash_mix(h_in: u32, value: u32) -> u32 {
  var k = value * ${I(c)};
  k = (k << 15u) | (k >> 17u);
  k = k * ${I(e)};
  var h = h_in ^ k;
  h = (h << 13u) | (h >> 19u);
  h = h * 5u + ${I(r)};
  return h;
}`}],[`pcg_hash_finalize`,{deps:[],text:`fn pcg_hash_finalize(h_in: u32) -> u32 {
  var h = h_in ^ (h_in >> 16u);
  h = h * ${I(s)};
  h = h ^ (h >> 13u);
  h = h * ${I(n)};
  h = h ^ (h >> 16u);
  return h;
}`}],[`pcg_hash3`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash3(a: u32, b: u32, c: u32) -> u32 {
  return ${L(d(3),[`a`,`b`,`c`])};
}`}],[`pcg_hash4`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash4(a: u32, b: u32, c: u32, d: u32) -> u32 {
  return ${L(d(4),[`a`,`b`,`c`,`d`])};
}`}],[`pcg_hash5`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash5(a: u32, b: u32, c: u32, d: u32, e: u32) -> u32 {
  return ${L(d(5),[`a`,`b`,`c`,`d`,`e`])};
}`}],[`pcg_hash_float`,{deps:[],text:`fn pcg_hash_float(h: u32) -> f32 {
  return f32(h >> 8u) * ${P(o,`internal hashFloat scale`)};
}`}],[`pcg_fade`,{deps:[],text:`fn pcg_fade(t: f32) -> f32 {
  return t * t * t * (t * (t * 6f - 15f) + 10f);
}`}],[`pcg_mix`,{deps:[],text:`fn pcg_mix(a: f32, b: f32, t: f32) -> f32 {
  return a + (b - a) * t;
}`}],[`pcg_value_noise`,{deps:[`pcg_hash4`,`pcg_hash_float`,`pcg_fade`,`pcg_mix`],text:`fn pcg_value_noise(seed: u32, p: vec3<f32>) -> f32 {
  let pf = floor(p);
  let x0 = bitcast<u32>(i32(pf.x));
  let y0 = bitcast<u32>(i32(pf.y));
  let z0 = bitcast<u32>(i32(pf.z));
  let fr = p - pf;
  let u = pcg_fade(fr.x);
  let v = pcg_fade(fr.y);
  let w = pcg_fade(fr.z);
  let v000 = pcg_hash_float(pcg_hash4(seed, x0, y0, z0));
  let v100 = pcg_hash_float(pcg_hash4(seed, x0 + 1u, y0, z0));
  let v010 = pcg_hash_float(pcg_hash4(seed, x0, y0 + 1u, z0));
  let v110 = pcg_hash_float(pcg_hash4(seed, x0 + 1u, y0 + 1u, z0));
  let v001 = pcg_hash_float(pcg_hash4(seed, x0, y0, z0 + 1u));
  let v101 = pcg_hash_float(pcg_hash4(seed, x0 + 1u, y0, z0 + 1u));
  let v011 = pcg_hash_float(pcg_hash4(seed, x0, y0 + 1u, z0 + 1u));
  let v111 = pcg_hash_float(pcg_hash4(seed, x0 + 1u, y0 + 1u, z0 + 1u));
  return pcg_mix(
    pcg_mix(pcg_mix(v000, v100, u), pcg_mix(v010, v110, u), v),
    pcg_mix(pcg_mix(v001, v101, u), pcg_mix(v011, v111, u), v),
    w);
}`}],[`pcg_perlin_gdot`,{deps:[`pcg_hash4`,`PCG_GRAD3`],text:`fn pcg_perlin_gdot(seed: u32, xi: u32, yi: u32, zi: u32, d: vec3<f32>) -> f32 {
  let g = pcg_hash4(seed, xi, yi, zi) % 12u;
  return dot(PCG_GRAD3[g], d);
}`}],[`pcg_perlin_noise`,{deps:[`pcg_perlin_gdot`,`pcg_fade`,`pcg_mix`],text:`fn pcg_perlin_noise(seed: u32, p: vec3<f32>) -> f32 {
  let pf = floor(p);
  let x0 = bitcast<u32>(i32(pf.x));
  let y0 = bitcast<u32>(i32(pf.y));
  let z0 = bitcast<u32>(i32(pf.z));
  let fr = p - pf;
  let u = pcg_fade(fr.x);
  let v = pcg_fade(fr.y);
  let w = pcg_fade(fr.z);
  let n000 = pcg_perlin_gdot(seed, x0, y0, z0, fr);
  let n100 = pcg_perlin_gdot(seed, x0 + 1u, y0, z0, fr - vec3<f32>(1f, 0f, 0f));
  let n010 = pcg_perlin_gdot(seed, x0, y0 + 1u, z0, fr - vec3<f32>(0f, 1f, 0f));
  let n110 = pcg_perlin_gdot(seed, x0 + 1u, y0 + 1u, z0, fr - vec3<f32>(1f, 1f, 0f));
  let n001 = pcg_perlin_gdot(seed, x0, y0, z0 + 1u, fr - vec3<f32>(0f, 0f, 1f));
  let n101 = pcg_perlin_gdot(seed, x0 + 1u, y0, z0 + 1u, fr - vec3<f32>(1f, 0f, 1f));
  let n011 = pcg_perlin_gdot(seed, x0, y0 + 1u, z0 + 1u, fr - vec3<f32>(0f, 1f, 1f));
  let n111 = pcg_perlin_gdot(seed, x0 + 1u, y0 + 1u, z0 + 1u, fr - vec3<f32>(1f, 1f, 1f));
  return ${R(`internal PERLIN_SCALE`)(p)} * pcg_mix(
    pcg_mix(pcg_mix(n000, n100, u), pcg_mix(n010, n110, u), v),
    pcg_mix(pcg_mix(n001, n101, u), pcg_mix(n011, n111, u), v),
    w);
}`}],[`pcg_simplex_corner`,{deps:[`pcg_hash4`,`PCG_GRAD3`],text:`fn pcg_simplex_corner(seed: u32, i: i32, j: i32, k: i32, x: f32, y: f32, z: f32) -> f32 {
  let t = ${R(`internal simplex R2`)(re)} - x * x - y * y - z * z;
  if (t <= 0f) {
    return 0f;
  }
  let g = pcg_hash4(seed, bitcast<u32>(i), bitcast<u32>(j), bitcast<u32>(k)) % 12u;
  let t2 = t * t;
  return t2 * t2 * dot(PCG_GRAD3[g], vec3<f32>(x, y, z));
}`}],[`pcg_simplex_noise`,{deps:[`pcg_simplex_corner`],text:`fn pcg_simplex_noise(seed: u32, p: vec3<f32>) -> f32 {
  let s = (p.x + p.y + p.z) * ${R(`internal simplex F3`)(g)};
  let i = i32(floor(p.x + s));
  let j = i32(floor(p.y + s));
  let k = i32(floor(p.z + s));
  let t = f32(i + j + k) * ${R(`internal simplex G3`)(_)};
  let x0 = p.x - (f32(i) - t);
  let y0 = p.y - (f32(j) - t);
  let z0 = p.z - (f32(k) - t);
  var i1: i32;
  var j1: i32;
  var k1: i32;
  var i2: i32;
  var j2: i32;
  var k2: i32;
  if (x0 >= y0) {
    if (y0 >= z0) {
      i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
    } else if (x0 >= z0) {
      i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
    } else {
      i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
    }
  } else {
    if (y0 < z0) {
      i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
    } else if (x0 < z0) {
      i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
    } else {
      i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
    }
  }
  let x1 = x0 - f32(i1) + ${R(`internal simplex G3`)(_)};
  let y1 = y0 - f32(j1) + ${R(`internal simplex G3`)(_)};
  let z1 = z0 - f32(k1) + ${R(`internal simplex G3`)(_)};
  let x2 = x0 - f32(i2) + ${R(`internal simplex 2*G3`)(2*_)};
  let y2 = y0 - f32(j2) + ${R(`internal simplex 2*G3`)(2*_)};
  let z2 = z0 - f32(k2) + ${R(`internal simplex 2*G3`)(2*_)};
  let x3 = x0 - 1f + ${R(`internal simplex 3*G3`)(3*_)};
  let y3 = y0 - 1f + ${R(`internal simplex 3*G3`)(3*_)};
  let z3 = z0 - 1f + ${R(`internal simplex 3*G3`)(3*_)};
  return ${R(`internal SIMPLEX_SCALE`)(72)} * (pcg_simplex_corner(seed, i, j, k, x0, y0, z0)
    + pcg_simplex_corner(seed, i + i1, j + j1, k + k1, x1, y1, z1)
    + pcg_simplex_corner(seed, i + i2, j + j2, k + k2, x2, y2, z2)
    + pcg_simplex_corner(seed, i + 1, j + 1, k + 1, x3, y3, z3));
}`}],[`pcg_worley_point_dist`,{deps:[`pcg_hash5`,`pcg_hash_float`],text:`fn pcg_worley_point_dist(seed: u32, gx: i32, gy: i32, gz: i32, p: vec3<f32>) -> f32 {
  let ux = bitcast<u32>(gx);
  let uy = bitcast<u32>(gy);
  let uz = bitcast<u32>(gz);
  let px = f32(gx) + pcg_hash_float(pcg_hash5(seed, ux, uy, uz, 0u));
  let py = f32(gy) + pcg_hash_float(pcg_hash5(seed, ux, uy, uz, 1u));
  let pz = f32(gz) + pcg_hash_float(pcg_hash5(seed, ux, uy, uz, 2u));
  let dx = px - p.x;
  let dy = py - p.y;
  let dz = pz - p.z;
  return sqrt(dx * dx + dy * dy + dz * dz);
}`}],[`pcg_worley`,{deps:[`pcg_worley_point_dist`],text:`fn pcg_worley(seed: u32, p: vec3<f32>, exact: bool, needs_f2: bool) -> vec2<f32> {
  let cx = i32(floor(p.x));
  let cy = i32(floor(p.y));
  let cz = i32(floor(p.z));
  var f1 = ${Me};
  var f2 = ${Me};
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let d = pcg_worley_point_dist(seed, cx + dx, cy + dy, cz + dz, p);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
  }
  if (exact) {
    var r = 1;
    loop {
      var needed = f1;
      if (needs_f2) {
        needed = f2;
      }
      if (!(r < 3 && needed > f32(r))) {
        break;
      }
      r = r + 1;
      for (var dz = -r; dz <= r; dz++) {
        let az = abs(dz);
        for (var dy = -r; dy <= r; dy++) {
          let ay = abs(dy);
          for (var dx = -r; dx <= r; dx++) {
            let ax = abs(dx);
            if (ax != r && ay != r && az != r) {
              continue;
            }
            let d = pcg_worley_point_dist(seed, cx + dx, cy + dy, cz + dz, p);
            if (d < f1) {
              f2 = f1;
              f1 = d;
            } else if (d < f2) {
              f2 = d;
            }
          }
        }
      }
    }
  }
  return vec2<f32>(f1, f2);
}`}]]);function Fe(e){let t=new Set,n=e=>{if(t.has(e))return;let r=Pe.get(e);if(!r)throw Error(`internal: unknown WGSL library item "${e}"`);t.add(e);for(let e of r.deps)n(e)};for(let t of e)n(t);let r=[];for(let[e,n]of Pe)t.has(e)&&r.push(n.text);return r}var Ie=64,Le=`wgsl1`,Re=[`x`,`y`,`z`,`w`];function z(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}function ze(e,t,n){return new N(`${e}: ${t} has tupleSize ${n}, but GPU kernels support tuple sizes 1 to 4; evaluate this field on the CPU instead, or split it into components`)}function Be(e,t,n){let r=1;for(let i of n)if(i!==1){if(r!==1&&r!==i)throw new N(`${t}: ${e}: incompatible tuple sizes ${r} and ${i}`);r=i}return r}var Ve=class{layout;lines=[];libRoots=new Set;usesSeed=!1;valueNumbers=new Map;bindings=new Map;helpers=new Map;helperTexts=[];helperCounters=new Map;varCounter=0;constructor(e,t){this.layout=e,t.forEach((t,n)=>{this.bindings.set(t,{name:t,varName:`in${n}`,binding:n+1,attr:e.attributes[t]})})}emit(e,t){let n=this.valueNumbers.get(e);if(n)return n;let r={ref:`v${this.varCounter++}`,size:t};return this.lines.push(`  let ${r.ref} = ${e};`),this.valueNumbers.set(e,r),r}binding(e){let t=this.bindings.get(e);if(!t)throw Error(`internal: attribute ${JSON.stringify(e)} was not pre-bound`);return t}boundAttrs(){return[...this.bindings.values()]}helper(e,t){let n=this.helpers.get(t);if(n)return n;let r=this.helperCounters.get(e)??0;this.helperCounters.set(e,r+1);let i=`pcg_${e}_${r}`;return this.helpers.set(t,i),this.helperTexts.push(t.replaceAll(`@NAME@`,i)),i}helperBlocks(){return this.helperTexts}};function He(e,t){return e.size===t?e.ref:`vec${t}<f32>(${e.ref})`}function B(e){return e===1?`0f`:`vec${e}<f32>(0f)`}function V(e){return e===1?`1f`:`vec${e}<f32>(1f)`}function Ue(e){let t=Object.keys(e.attributes).sort();return t.length===0?`the layout declares no attributes`:`layout attributes: ${t.map(e=>JSON.stringify(e)).join(`, `)}`}function We(e,t,n,r,i){let a=e.layout.attributes;if(!Object.hasOwn(a,n))throw new N(`${t}: ${i}attribute ${JSON.stringify(n)} is not in the kernel layout; ${Ue(e.layout)}`);let o=a[n];if(o.type===`string`)throw new N(`${t}: ${i}attribute ${JSON.stringify(n)} has type "string"; string attributes cannot be read as fields and are CPU-only — use a numeric or bool attribute`);if(r!==void 0&&o.tupleSize!==r)throw new N(`${t}: ${i}attribute ${JSON.stringify(n)}: expected tupleSize ${r}, got ${o.tupleSize} in the kernel layout`);if(o.tupleSize>4)throw ze(t,`${i}attribute ${JSON.stringify(n)}`,o.tupleSize);return o}function H(e,t,n,r,i){let a=We(e,t,n,r,i),o=e.binding(n),s=a.tupleSize,c=e=>a.type===`f32`?e:`f32(${e})`;if(s===1)return e.emit(c(`${o.varName}[i]`),1);let l=[];for(let e=0;e<s;e++)l.push(c(`${o.varName}[${U(s,e)}]`));return e.emit(`vec${s}<f32>(${l.join(`, `)})`,s)}function U(e,t){return e===1?`i`:t===0?`i * ${e}u`:`i * ${e}u + ${t}u`}var W=new Map;function Ge(){return[...W.keys()].sort()}function Ke(e,t,n){let r=String(e.fn),i=W.get(r);if(!i)throw new N(`${t}: field fn "${r}" is not supported by the WGSL compiler; supported fns: ${Ge().join(`, `)}`);return i(e,t,n)}function G(e,t,n){return typeof e==`number`?n.emit(P(e,t),1):Array.isArray(e)?qe(e,t,n):Ke(e,t,n)}function qe(e,t,n){let r=e.length;if(r>4)throw ze(t,`constant`,r);if(r===1)return n.emit(P(e[0],t),1);let i=e.map(e=>P(e,t));return n.emit(`vec${r}<f32>(${i.join(`, `)})`,r)}function K(e){return e.args}W.set(`constant`,(e,t,n)=>{let r=e.value;return typeof r==`number`?n.emit(P(r,`${t}.value`),1):qe(r,`${t}.value`,n)}),W.set(`attribute`,(e,t,n)=>{let r=e.name,i=e.tupleSize;return H(n,t,r,i,``)}),W.set(`position`,(e,t,n)=>H(n,t,`P`,3,`position reads `)),W.set(`index`,(e,t,n)=>n.emit(`f32(i)`,1)),W.set(`randomField`,(e,t,n)=>{let r=e.key,i=typeof r==`string`?l(r):(r??0)>>>0;return n.usesSeed=!0,n.libRoots.add(`pcg_hash3`),n.libRoots.add(`pcg_hash_float`),n.emit(`pcg_hash_float(pcg_hash3(params.seed, ${F(i)}, i))`,1)});function q(e,t,n){W.set(e,(r,i,a)=>{let o=K(r),s=[];for(let e=0;e<t;e++)s.push(G(o[e],`${i}.args[${e}]`,a));let c=Be(e,i,s.map(e=>e.size)),l=s.map(e=>He(e,c));return a.emit(n(l,c),c)})}q(`add`,2,e=>`${e[0]} + ${e[1]}`),q(`sub`,2,e=>`${e[0]} - ${e[1]}`),q(`mul`,2,e=>`${e[0]} * ${e[1]}`),q(`div`,2,e=>`${e[0]} / ${e[1]}`),q(`min`,2,e=>`min(${e[0]}, ${e[1]})`),q(`max`,2,e=>`max(${e[0]}, ${e[1]})`),q(`abs`,1,e=>`abs(${e[0]})`),q(`floor`,1,e=>`floor(${e[0]})`),q(`sin`,1,e=>`sin(${e[0]})`),q(`cos`,1,e=>`cos(${e[0]})`),q(`tan`,1,e=>`tan(${e[0]})`),q(`asin`,1,e=>`asin(${e[0]})`),q(`acos`,1,e=>`acos(${e[0]})`),q(`atan`,1,e=>`atan(${e[0]})`),q(`atan2`,2,e=>`atan2(${e[0]}, ${e[1]})`),q(`clamp`,3,e=>`clamp(${e[0]}, ${e[1]}, ${e[2]})`),q(`lerp`,3,e=>`${e[0]} + (${e[1]} - ${e[0]}) * ${e[2]}`),q(`select`,3,(e,t)=>`select(${e[2]}, ${e[1]}, ${e[0]} != ${B(t)})`),q(`lt`,2,(e,t)=>`select(${B(t)}, ${V(t)}, ${e[0]} < ${e[1]})`),q(`le`,2,(e,t)=>`select(${B(t)}, ${V(t)}, ${e[0]} <= ${e[1]})`),q(`gt`,2,(e,t)=>`select(${B(t)}, ${V(t)}, ${e[0]} > ${e[1]})`),q(`ge`,2,(e,t)=>`select(${B(t)}, ${V(t)}, ${e[0]} >= ${e[1]})`),q(`eq`,2,(e,t)=>`select(${B(t)}, ${V(t)}, ${e[0]} == ${e[1]})`),W.set(`remap`,(e,t,n)=>{let r=K(e).map((e,r)=>G(e,`${t}.args[${r}]`,n)),i=Be(`remap`,t,r.map(e=>e.size)),[a,o,s,c,l]=r.map(e=>He(e,i)),u=n.emit(`${s} - ${o}`,i),d=B(i),f=n.emit(`select(${u.ref}, ${V(i)}, ${u.ref} == ${d})`,i);return n.emit(`select(${c} + ((${a} - ${o}) / ${f.ref}) * (${l} - ${c}), ${c}, ${u.ref} == ${d})`,i)}),W.set(`dot`,(e,t,n)=>{let r=K(e),i=G(r[0],`${t}.args[0]`,n),a=G(r[1],`${t}.args[1]`,n),o=Be(`dot`,t,[i.size,a.size]);return o===1?n.emit(`${i.ref} * ${a.ref}`,1):n.emit(`dot(${He(i,o)}, ${He(a,o)})`,1)}),W.set(`length`,(e,t,n)=>{let r=G(K(e)[0],`${t}.args[0]`,n);if(r.size===1)return n.emit(`abs(${r.ref})`,1);let i=n.emit(`dot(${r.ref}, ${r.ref})`,1);return n.emit(`sqrt(${i.ref})`,1)}),W.set(`normalize`,(e,t,n)=>{let r=G(K(e)[0],`${t}.args[0]`,n),i=r.size===1?n.emit(`${r.ref} * ${r.ref}`,1):n.emit(`dot(${r.ref}, ${r.ref})`,1),a=n.emit(`select(0f, 1f / sqrt(${i.ref}), ${i.ref} > 0f)`,1);return n.emit(`${r.ref} * ${a.ref}`,r.size)}),W.set(`vec`,(e,t,n)=>{let r=K(e).map((e,r)=>G(e,`${t}.args[${r}]`,n)),i=r.reduce((e,t)=>e+t.size,0);if(i>4)throw ze(t,`vec result`,i);return r.length===1?r[0]:n.emit(`vec${i}<f32>(${r.map(e=>e.ref).join(`, `)})`,i)}),W.set(`component`,(e,t,n)=>{let r=G(K(e)[0],`${t}.args[0]`,n),i=e.index;if(i>=r.size)throw new N(`${t}: component: index ${i} out of range for tupleSize ${r.size}`);return r.size===1?r:n.emit(`${r.ref}.${Re[i]}`,1)}),W.set(`ramp`,(e,t,n)=>{let r=G(K(e)[0],`${t}.args[0]`,n);if(r.size!==1)throw new N(`${t}: ramp: input must be scalar, got tupleSize ${r.size}`);let i=e.stops,a=n.helper(`ramp`,Je(i,`${t}.stops`));return n.emit(`${a}(${r.ref})`,1)});function Je(e,t){let n=e=>P(e,t),r=e.length-1,i=[];i.push(`fn @NAME@(t: f32) -> f32 {`),i.push(`  if (t <= ${n(e[0][0])}) {`),i.push(`    return ${n(e[0][1])};`),i.push(`  }`),i.push(`  if (t >= ${n(e[r][0])}) {`),i.push(`    return ${n(e[r][1])};`),i.push(`  }`);let a=t=>{let r=e[t-1][0],i=e[t-1][1],a=e[t][0]-r,o=e[t][1]-i;return`${n(i)} + ${n(o)} * ((t - ${n(r)}) / ${n(a)})`};for(let t=1;t<r;t++)i.push(`  if (t <= ${n(e[t][0])}) {`),i.push(`    return ${a(t)};`),i.push(`  }`);return r>=1?i.push(`  return ${a(r)};`):i.push(`  return t;`),i.push(`}`),i.join(`
`)}var Ye={valueNoise:ce,perlinNoise:ee,simplexNoise:te,worleyNoise:se},Xe={valueNoise:`pcg_value_noise`,perlinNoise:`pcg_perlin_noise`,simplexNoise:`pcg_simplex_noise`};function Ze(e){return e.opts??{}}function Qe(e,t,n,r){let i=Ze(t),a=i.position===void 0?n:`${n}.opts.position`,o=i.position===void 0?H(r,n,`P`,3,`${e} position reads `):G(i.position,a,r);if(o.size!==3)throw new N(`${a}: ${e}: position field must have tupleSize 3, got ${o.size}`);let s=P(i.frequency??1,`${n}.opts.frequency`),[c,l,u]=i.offset??[0,0,0],d=`vec3<f32>(${P(c,`${n}.opts.offset`)}, ${P(l,`${n}.opts.offset`)}, ${P(u,`${n}.opts.offset`)})`;return r.emit(`${o.ref} * ${s} + ${d}`,3)}function $e(e,t){return a(Ye[e],(t??0)>>>0)}function et(e,t,n,r){let[i,a]=n,o=a-i;return e.emit(`(${t.ref} - ${P(i,r)}) / ${P(o,r)}`,1)}for(let e of[`valueNoise`,`perlinNoise`,`simplexNoise`])W.set(e,(t,n,r)=>{let i=Ze(t),a=Qe(e,t,n,r);r.libRoots.add(Xe[e]);let o=r.emit(`${Xe[e]}(${F($e(e,i.seed))}, ${a.ref})`,1);return i.normalized===!0?et(r,o,C[e],`${n}.opts.normalized`):o});W.set(`worleyNoise`,(e,t,n)=>{let r=Ze(e),i=r.output??`f1`,a=r.exact===!0,o=Qe(`worleyNoise`,e,t,n);n.libRoots.add(`pcg_worley`);let s=i!==`f1`,c=n.emit(`pcg_worley(${F($e(`worleyNoise`,r.seed))}, ${o.ref}, ${a}, ${s})`,2),l=i===`f1`?n.emit(`${c.ref}.x`,1):i===`f2`?n.emit(`${c.ref}.y`,1):n.emit(`${c.ref}.y - ${c.ref}.x`,1);return r.normalized===!0?et(n,l,C.worleyNoise[i],`${t}.opts.normalized`):l});function tt(e){return e===`worleyNoise`?C.worleyNoise.f1:C[e]}function nt(e,t,n){return e===`worleyNoise`?`pcg_worley(${t}, ${n}, false, false).x`:`${Xe[e]}(${t}, ${n})`}W.set(`fbm`,(e,t,n)=>{let r=e.base,i=Ze(e),a=i.octaves??4,o=i.lacunarity??2,s=i.gain??.5,c=i.seed??0,l=i.frequency??1,[u,d,f]=i.offset??[0,0,0],p=i.position===void 0?t:`${t}.opts.position`,m=i.position===void 0?H(n,t,`P`,3,`fbm position reads `):G(i.position,p,n);if(m.size!==3)throw new N(`${p}: fbm: position field must have tupleSize 3, got ${m.size}`);let h=tt(r),g=[],_=[],ee=[],v=1,te=l,y=0,b=0;for(let e=0;e<a;e++)g.push(F($e(r,ie(c,e)))),_.push(P(te,`${t}.opts.frequency`)),ee.push(P(v,`${t}.opts.gain`)),y+=v>=0?v*h[0]:v*h[1],b+=v>=0?v*h[1]:v*h[0],v*=s,te*=o;n.libRoots.add(r===`worleyNoise`?`pcg_worley`:Xe[r]);let x=`vec3<f32>(${P(u,`${t}.opts.offset`)}, ${P(d,`${t}.opts.offset`)}, ${P(f,`${t}.opts.offset`)})`,ne=`fn @NAME@(p: vec3<f32>) -> f32 {
  var seeds = array<u32, ${a}>(${g.join(`, `)});
  var freqs = array<f32, ${a}>(${_.join(`, `)});
  var amps = array<f32, ${a}>(${ee.join(`, `)});
  var sum = 0f;
  for (var o = 0u; o < ${je(a)}; o++) {
    sum = sum + ${nt(r,`seeds[o]`,`p * freqs[o] + `+x)} * amps[o];
  }
  return sum;
}`,re=n.helper(`fbm`,ne),S=n.emit(`${re}(${m.ref})`,1);if(i.normalized!==!0)return S;if(!(b>y))throw new N(`${t}: fbm: normalized: true needs a non-degenerate output range, got [${y}, ${b}] for this octaves/gain configuration`);return et(n,S,[y,b],`${t}.opts.normalized`)});var rt=new Set([`valueNoise`,`perlinNoise`,`simplexNoise`,`worleyNoise`,`fbm`]);function it(e,t){if(!z(e))return;let n=e.fn;if(n===`attribute`){typeof e.name==`string`&&t.add(e.name);return}if(n===`position`){t.add(`P`);return}if(typeof n==`string`&&rt.has(n)){let n=e.opts;z(n)&&n.position!==void 0?it(n.position,t):t.add(`P`);return}let r=e.args;if(Array.isArray(r))for(let e of r)it(e,t)}var at=new Set([`f32`,`i32`,`u32`,`bool`,`string`]);function ot(e){if(!z(e)||!z(e.attributes))throw new N(`compileFieldSpec: layout must be { attributes: { name: { type, tupleSize } } }`);for(let[t,n]of Object.entries(e.attributes)){if(!z(n)||!at.has(n.type))throw new N(`kernel layout attribute ${JSON.stringify(t)}: unknown type ${JSON.stringify(n?.type)}; valid types: "f32", "i32", "u32", "bool" ("string" is accepted but CPU-only)`);let e=n.tupleSize;if(typeof e!=`number`||!Number.isInteger(e)||e<1)throw new N(`kernel layout attribute ${JSON.stringify(t)}: tupleSize must be a positive integer, got ${String(e)}`)}}function st(e){return typeof e==`number`?{fn:`constant`,value:e}:Array.isArray(e)?{fn:`constant`,value:[...e]}:e}function ct(e){return e.type===`bool`?`u32`:e.type}function lt(e,t){ot(t);let n=st(e),r=S(n),i=new Set;it(n,i);let a=new Ve(t,[...i].filter(e=>Object.hasOwn(t.attributes,e)&&t.attributes[e].type!==`string`).sort()),o=`f32`,s=0,c=[],l=e=>{if(s=e.size,e.size===1)c.push(`  outBuf[i] = ${e.ref};`);else for(let t=0;t<e.size;t++)c.push(`  outBuf[${U(e.size,t)}] = ${e.ref}.${Re[t]};`)},u=n.fn===`attribute`?n.name:n.fn===`position`?`P`:void 0;if(n.fn===`index`)o=`u32`,s=1,c.push(`  outBuf[i] = i;`);else if(u!==void 0){let e=We(a,`$`,u,n.fn===`position`?3:n.tupleSize,n.fn===`position`?`position reads `:``);if(e.type===`i32`||e.type===`u32`){o=e.type,s=e.tupleSize;let t=a.binding(u);for(let n=0;n<e.tupleSize;n++)c.push(`  outBuf[${U(e.tupleSize,n)}] = ${t.varName}[${U(e.tupleSize,n)}];`)}else l(Ke(n,`$`,a))}else l(Ke(n,`$`,a));let d=a.boundAttrs(),f=d.map(e=>({name:e.name,type:ct(e.attr),tupleSize:e.attr.tupleSize,binding:e.binding})),p=d.length+1,m=[`@group(0) @binding(0) var<uniform> params: PcgParams;`];for(let e of d)m.push(`@group(0) @binding(${e.binding}) var<storage, read> ${e.varName}: array<${ct(e.attr)}>; // attribute ${JSON.stringify(e.name)}: ${e.attr.type} tupleSize ${e.attr.tupleSize}`);m.push(`@group(0) @binding(${p}) var<storage, read_write> outBuf: array<${o}>;`);let h=[`// Generated by pcg-ts compileFieldSpec (WGSL field kernel).
// Dispatch: 1D, ceil(count / ${Ie}) workgroups of ${Ie}; one invocation per element.

struct PcgParams {
  count: u32,
  seed: u32,
}

${m.join(`
`)}`,...Fe(a.libRoots),...a.helperBlocks(),`@compute @workgroup_size(${Ie})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) {
    return;
  }
${[...a.lines,...c].join(`
`)}
}`],g=d.map(e=>`${JSON.stringify(e.name)}:${e.attr.type}x${e.attr.tupleSize}`).join(`,`);return{wgsl:`${h.join(`

`)}\n`,entryPoint:`main`,workgroupSize:Ie,outTupleSize:s,outType:o,inputs:f,bindings:{uniforms:0,output:p},usesSeed:a.usesSeed,key:`${Le}|spec=${r.key}|layout=[${g}]`}}var J={MAP_READ:1,COPY_SRC:4,COPY_DST:8,UNIFORM:64,STORAGE:128},ut={READ:1},dt=`gpu1`,ft=8,pt=65535,mt={f32:Float32Array,i32:Int32Array,u32:Uint32Array},ht={f32:Float32Array,i32:Int32Array,u32:Uint32Array};function gt(e){let t=e=>e!==void 0&&e!==``?e:`?`;return[dt,t(e?.vendor),t(e?.architecture),t(e?.device),t(e?.description)].join(`|`)}function _t(e,t){return e!==void 0&&(e.fallbacks[t]=(e.fallbacks[t]??0)+1),null}var vt=class{cacheSalt;device;kernels=new Map;pipelines=new Map;constructor(e,t={}){this.device=e,this.cacheSalt=gt(t.adapterInfo??e.adapterInfo)}get pipelineCacheSize(){return this.pipelines.size}resolveField(e,t,n){let r=m(e);if(r===void 0)return _t(n,`no-spec`);let i=t.geo.attrs[t.domain],a={},o=[];for(let e of i.names().sort()){let t=i.get(e);t!==void 0&&(a[e]={type:t.type,tupleSize:t.tupleSize},o.push(`${JSON.stringify(e)}:${t.type}x${t.tupleSize}`))}let s=`${e.key.length}#${e.key}|${o.join(`,`)}`,c=this.kernels.get(s);if(c===void 0){try{c=lt(r,{attributes:a})}catch(e){c=e instanceof Error?e:Error(String(e))}this.kernels.set(s,c)}if(c instanceof Error)return _t(n,`compile-error`);if(c.inputs.length+1>ft)return _t(n,`too-many-buffers`);let l=i.count;if(Math.ceil(l/c.workgroupSize)>pt)return _t(n,`dispatch-too-large`);if(l===0)return Promise.resolve({data:new ht[c.outType](0),tupleSize:c.outTupleSize});let u=this.pipelines.get(c.key);if(u===void 0){let e=this.device.createShaderModule({code:c.wgsl});u={pipeline:this.device.createComputePipeline({layout:`auto`,compute:{module:e,entryPoint:c.entryPoint}}),kernel:c},this.pipelines.set(c.key,u),n!==void 0&&n.pipelinesCompiled++}else n!==void 0&&n.pipelineCacheHits++;return n!==void 0&&n.dispatches++,this.dispatch(e,t,c,u,l)}async dispatch(e,t,n,r,i){let a=this.device,o=[];try{let e=a.createBuffer({size:8,usage:J.UNIFORM|J.COPY_DST});o.push(e),a.queue.writeBuffer(e,0,new Uint32Array([i,t.seed>>>0]));let s=[{binding:n.bindings.uniforms,resource:{buffer:e}}],c=t.geo.attrs[t.domain];for(let e of n.inputs){let t=c.require(e.name),n=i*e.tupleSize,r;if(t.data instanceof Uint8Array){let e=new Uint32Array(n);for(let r=0;r<n;r++)e[r]=t.data[r];r=e}else r=t.data.subarray(0,n);let l=a.createBuffer({size:n*4,usage:J.STORAGE|J.COPY_DST});o.push(l),a.queue.writeBuffer(l,0,r),s.push({binding:e.binding,resource:{buffer:l}})}let l=i*n.outTupleSize*4,u=a.createBuffer({size:l,usage:J.STORAGE|J.COPY_SRC});o.push(u),s.push({binding:n.bindings.output,resource:{buffer:u}});let d=a.createBuffer({size:l,usage:J.COPY_DST|J.MAP_READ});o.push(d);let f=a.createBindGroup({layout:r.pipeline.getBindGroupLayout(0),entries:s}),p=a.createCommandEncoder(),m=p.beginComputePass();m.setPipeline(r.pipeline),m.setBindGroup(0,f),m.dispatchWorkgroups(Math.ceil(i/n.workgroupSize)),m.end(),p.copyBufferToBuffer(u,0,d,0,l),a.queue.submit([p.finish()]),await d.mapAsync(ut.READ);let h=d.getMappedRange().slice(0);return d.unmap(),{data:new mt[n.outType](h),tupleSize:n.outTupleSize}}catch(n){throw Error(`GpuFieldEvaluator: dispatch failed for field ${e.key} (${i} elements on the ${t.domain} domain): ${n instanceof Error?n.message:String(n)}`,{cause:n})}finally{for(let e of o)e.destroy()}}},yt=[1e5,5e5,1e6,2e6],bt=j(`<div class="notice svelte-1yy0qs2"> </div>`),xt=j(`<option> </option>`),St=j(`<div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">GPU speedup (best/best)</span><b class="svelte-1yy0qs2"> </b></div>`),Ct=j(`<div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">gpu dispatches</span><b class="svelte-1yy0qs2"> </b></div> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">pipelines compiled / cache hits</span> <b class="svelte-1yy0qs2"> </b></div> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">gpu fallbacks</span><b class="svelte-1yy0qs2"> </b></div>`,1),wt=j(`<div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2"> </span> <b class="svelte-1yy0qs2"> </b></div>`),Tt=j(`<div class="error svelte-1yy0qs2"> </div>`),Et=j(`<div class="panel svelte-1yy0qs2"><h1 class="svelte-1yy0qs2">08 · gpu fields</h1> <p class="info svelte-1yy0qs2">pointScatterInBounds → setAttribute ×2, whose JSON field expressions compile to WGSL compute
    kernels when the cook is handed a <code class="svelte-1yy0qs2">GpuFieldEvaluator</code>. Toggle the path — same graph,
    same seed; the CPU is the bit-exact reference. Expect a CPU cook at 1M+ points to block for
    seconds — that contrast is the demo.</p> <!> <div class="row svelte-1yy0qs2"><span class="svelte-1yy0qs2">cook path</span> <div class="seg svelte-1yy0qs2"><button>CPU</button> <button>GPU</button></div></div> <label class="row svelte-1yy0qs2"><span class="svelte-1yy0qs2">points</span> <select class="svelte-1yy0qs2"></select></label> <label class="row svelte-1yy0qs2"><span class="svelte-1yy0qs2">seed</span> <input class="num svelte-1yy0qs2" type="number" step="1"/></label> <label class="row svelte-1yy0qs2"><span class="svelte-1yy0qs2">frequency</span> <input type="range" min="0.02" max="0.14" step="0.005" class="svelte-1yy0qs2"/> <em class="svelte-1yy0qs2"> </em></label> <div class="row svelte-1yy0qs2"><span class="svelte-1yy0qs2">determinism</span> <button class="wide svelte-1yy0qs2">recook from cold caches</button></div> <div class="stats svelte-1yy0qs2"><div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">adapter</span><b class="svelte-1yy0qs2"> </b></div> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">points</span><b class="svelte-1yy0qs2"> </b></div> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">fps</span><b class="svelte-1yy0qs2"> </b></div> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">cook</span> <b class="svelte-1yy0qs2"> </b></div> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">nodes cooked / cached</span><b class="svelte-1yy0qs2"> </b></div> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">CPU cook wall</span><b class="svelte-1yy0qs2"> </b></div> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">GPU cook wall</span><b class="svelte-1yy0qs2"> </b></div> <!> <!> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">CPU output hash</span><b class="svelte-1yy0qs2"> </b></div> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">GPU output hash</span><b class="svelte-1yy0qs2"> </b></div> <!> <!></div> <details class="svelte-1yy0qs2"><summary class="svelte-1yy0qs2">tint FieldSpec JSON (what actually cooks)</summary> <pre class="svelte-1yy0qs2"> </pre></details> <p class="note svelte-1yy0qs2">Hashes are FNV-1a over the cooked tint+size bytes. The CPU and GPU hashes differ (float ops
    carry documented per-op budgets; hash/random streams are bit-exact) but each path is
    deterministic: recook from cold caches and the same hash comes back. The deviation line is the
    live parity measurement on this adapter.</p></div>`);function Dt(e,t){fe(t,!0);let n=De(t,`bridge`,7),r=me(ge(t.initial));n().publish=e=>{_e(r,e,!0)};function i(e){return e>=1e6?`${e/1e6}M`:`${e/1e3}k`}function a(e){return e===void 0?`–`:`${e.toFixed(1)} ms`}function o(e){return`${a(e.lastMs)} · best ${a(e.bestMs)}`}function s(e){let t=Object.entries(e).map(([e,t])=>`${e}×${t}`);return t.length>0?t.join(`, `):`none`}function c(e){e===E(r).mode||E(r).cooking||t.host.setMode(e)}let l=me(ge(t.initial.seed));function u(){let e=Math.floor(Number(E(l)));Number.isFinite(e)&&t.host.setSeed(e>>>0)}let d=he(()=>E(r).cpu.bestMs!==void 0&&E(r).gpu.bestMs!==void 0&&E(r).gpu.bestMs>0?(E(r).cpu.bestMs/E(r).gpu.bestMs).toFixed(1):void 0);var f=Et(),p=O(w(f),4),m=e=>{var t=bt(),n=w(t);D(t),T(()=>k(n,`CPU-only: ${(E(r).gpuReason===``?`detecting WebGPU…`:E(r).gpuReason)??``}`)),M(e,t)};we(p,e=>{E(r).gpuAvailable||e(m)});var h=O(p,2),g=O(w(h),2),_=w(g);let ee;var v=O(_,2);let te;D(g),D(h);var y=O(h,2),b=O(w(y),2);Oe(b,20,()=>yt,e=>e,(e,t)=>{var n=xt(),r=w(n,!0);D(n);var a={};T(e=>{k(r,e),a!==(a=t)&&(n.value=(n.__value=t)??``)},[()=>i(t)]),M(e,n)}),D(b);var x;ke(b),D(y);var ne=O(y,2),re=O(w(ne),2);be(re),D(ne);var ie=O(ne,2),S=O(w(ie),2);be(S);var ae=O(S,2),oe=w(ae,!0);D(ae),D(ie);var se=O(ie,2),C=O(w(se),2);D(se);var ce=O(se,2),le=w(ce),ue=O(w(le)),de=w(ue,!0);D(ue),D(le);var pe=O(le,2),ye=O(w(pe)),j=w(ye,!0);D(ye),D(pe);var N=O(pe,2),P=O(w(N)),je=w(P,!0);D(P),D(N);var F=O(N,2),I=O(w(F),2),Me=w(I,!0);D(I),D(F);var L=O(F,2),Ne=O(w(L)),R=w(Ne,!0);D(Ne),D(L);var Pe=O(L,2),Fe=O(w(Pe)),Ie=w(Fe,!0);D(Fe),D(Pe);var Le=O(Pe,2),Re=O(w(Le)),z=w(Re,!0);D(Re),D(Le);var ze=O(Le,2),Be=e=>{var t=St(),n=O(w(t)),r=w(n);D(n),D(t),T(()=>k(r,`×${E(d)??``}`)),M(e,t)};we(ze,e=>{E(d)!==void 0&&e(Be)});var Ve=O(ze,2),He=e=>{var t=Ct(),n=Ee(t),i=O(w(n)),a=w(i,!0);D(i),D(n);var o=O(n,2),c=O(w(o),2),l=w(c);D(c),D(o);var u=O(o,2),d=O(w(u)),f=w(d,!0);D(d),D(u),T(e=>{k(a,E(r).gpuStats.dispatches),k(l,`${E(r).gpuStats.pipelinesCompiled??``} / ${E(r).gpuStats.pipelineCacheHits??``}`),k(f,e)},[()=>s(E(r).gpuStats.fallbacks)]),M(e,t)};we(Ve,e=>{E(r).gpuStats!==void 0&&e(He)});var B=O(Ve,2),V=O(w(B)),Ue=w(V,!0);D(V),D(B);var We=O(B,2),H=O(w(We)),U=w(H,!0);D(H),D(We);var W=O(We,2),Ge=e=>{var t=wt(),n=w(t),i=w(n);D(n);var a=O(n,2),o=w(a);D(a),D(t),T((e,t,n)=>{k(i,`max |cpu−gpu| (${e??``} pts)`),k(o,`${t??``} · ${n??``} range-ULP`)},[()=>E(r).deviation.window.toLocaleString(),()=>E(r).deviation.maxAbs.toExponential(2),()=>E(r).deviation.rangeUlp.toFixed(1)]),M(e,t)};we(W,e=>{E(r).deviation!==void 0&&e(Ge)});var Ke=O(W,2),G=e=>{var t=Tt(),n=w(t,!0);D(t),T(()=>k(n,E(r).error)),M(e,t)};we(Ke,e=>{E(r).error!==void 0&&e(G)}),D(ce);var qe=O(ce,2),K=O(w(qe),2),q=w(K,!0);D(K),D(qe),ve(2),D(f),T((e,t,n,i)=>{ee=Ce(_,1,`svelte-1yy0qs2`,null,ee,{active:E(r).mode===`cpu`}),v.disabled=!E(r).gpuAvailable,te=Ce(v,1,`svelte-1yy0qs2`,null,te,{active:E(r).mode===`gpu`}),x!==(x=E(r).count)&&(b.value=(b.__value=E(r).count)??``,Se(b,E(r).count)),xe(S,E(r).frequency),k(oe,e),C.disabled=E(r).cooking,k(de,E(r).adapter),k(j,t),k(je,E(r).fps),k(Me,E(r).cooking?`cooking…`:`idle`),k(R,E(r).nodes),k(Ie,n),k(z,i),k(Ue,E(r).cpu.hash??`–`),k(U,E(r).gpu.hash??`–`),k(q,E(r).specJson)},[()=>E(r).frequency.toFixed(3),()=>E(r).points.toLocaleString(),()=>o(E(r).cpu),()=>o(E(r).gpu)]),A(`click`,_,()=>c(`cpu`)),A(`click`,v,()=>c(`gpu`)),A(`change`,b,e=>t.host.setCount(Number(e.currentTarget.value))),A(`change`,re,u),Te(re,()=>E(l),e=>_e(l,e)),A(`change`,S,e=>t.host.setFrequency(Number(e.currentTarget.value))),A(`click`,C,()=>t.host.rebuild()),M(e,f),Ae()}pe([`click`,`change`]);function Ot(e){return{fn:`clamp`,args:[{fn:`add`,args:[{fn:`add`,args:[{fn:`mul`,args:[{fn:`fbm`,base:`simplexNoise`,opts:{frequency:e,octaves:5,normalized:!0}},.62]},{fn:`mul`,args:[{fn:`worleyNoise`,opts:{frequency:e*2.1,output:`f2-f1`,normalized:!0}},.3]}]},{fn:`mul`,args:[{fn:`randomField`,key:`sparkle`},.08]}]},0,1]}}function kt(e){let t=Ot(e);return{fn:`vec`,args:[{fn:`ramp`,args:[t],stops:[[0,.02],[.3,.05],[.55,.1],[.75,.95],[1,1]]},{fn:`ramp`,args:[t],stops:[[0,.03],[.3,.25],[.55,.75],[.75,.7],[1,.97]]},{fn:`ramp`,args:[t],stops:[[0,.1],[.3,.55],[.55,.8],[.75,.25],[1,.9]]}]}}function At(e){return{fn:`add`,args:[.35,{fn:`add`,args:[{fn:`mul`,args:[{fn:`randomField`,key:`size`},.5]},{fn:`mul`,args:[{fn:`ramp`,args:[{fn:`worleyNoise`,opts:{frequency:e*1.4,output:`f1`,normalized:!0}}],stops:[[0,1],[.4,.35],[1,.05]]},1.6]}]}]}}var jt=30,Mt=9,Nt=16384,Pt=1,Ft=1e6,It=.055,Lt=`cpu`;function Rt(){let e=new ne(Pt),n=e.add(u,{count:Ft,boundsMin:[-30,-9,-30],boundsMax:[jt,Mt,jt]}),r=S(kt(It)),i=e.add(t,{name:`tint`,domain:`point`,type:`f32`,tupleSize:3,value:r}),a=e.add(t,{name:`psize`,domain:`point`,type:`f32`,tupleSize:1,value:S(At(It))});return e.connect(n,`out`,i,`in`),e.connect(i,`out`,a,`in`),e.output(a,`out`,`points`),{graph:e,scatter:n,tintNode:i,sizeNode:a,tintField:r}}var Y=Rt(),zt;async function Bt(){let e=navigator.gpu;if(e===void 0)return{error:`navigator.gpu is missing — this browser has no WebGPU`};try{let t=await e.requestAdapter();if(t===null)return{error:`requestAdapter() returned null — no compatible GPU adapter`};let n=t.info;zt=new vt(await t.requestDevice(),n===void 0?{}:{adapterInfo:n});let r=[n?.vendor,n?.architecture,n?.description===``?n?.device:n?.description].filter(e=>typeof e==`string`&&e!==``).join(` · `)||`adapter (no info exposed)`;return console.info(`08-gpu-fields: WebGPU ready — ${r}; cacheSalt=${zt.cacheSalt}`),{label:r}}catch(e){return console.error(`08-gpu-fields: WebGPU init failed, falling back to CPU:`,e),{error:`WebGPU init failed: ${e instanceof Error?e.message:String(e)}`}}}var{scene:Vt,camera:Ht,renderer:Ut,start:Wt}=de({cameraPosition:[52,26,52]});function Gt(){return window.innerHeight/(2*Math.tan(Ht.fov*Math.PI/360))}var Kt=new i({uniforms:{uScale:{value:Gt()},uPx:{value:Ut.getPixelRatio()}},vertexShader:`
    attribute vec3 aTint;
    attribute float aSize;
    uniform float uScale, uPx;
    varying vec3 vColor;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float px = aSize * 0.05 * uScale * uPx / max(0.1, -mv.z);
      float fade = clamp(px, 0.0, 1.0);
      vColor = aTint * (0.45 + 0.55 * fade);
      gl_PointSize = clamp(px, 1.0, 40.0 * uPx);
      gl_Position = projectionMatrix * mv;
    }`,fragmentShader:`
    varying vec3 vColor;
    void main() {
      vec2 q = gl_PointCoord - 0.5;
      float d = length(q) * 2.0;
      if (d > 1.0) discard;
      float a = pow(1.0 - d, 1.8);
      gl_FragColor = vec4(vColor * a, 1.0);
    }`,blending:2,depthWrite:!1,transparent:!0}),X;function qt(e,t,n){let r=e.pointCount,i=e.attrs.point.require(`P`).data,a=new ae;a.setAttribute(`position`,new x(i.slice(0,r*3),3)),a.setAttribute(`aTint`,new x(t.slice(0,r*3),3)),a.setAttribute(`aSize`,new x(n.slice(0,r),1)),a.computeBoundingSphere(),X!==void 0&&(Vt.remove(X),X.geometry.dispose()),X=new v(a,Kt),Vt.add(X)}window.addEventListener(`resize`,()=>{Kt.uniforms.uScale.value=Gt(),Kt.uniforms.uPx.value=Ut.getPixelRatio()});function Jt(e,t){for(let n=0;n<t.length;n++)e^=t[n],e=Math.imul(e,16777619);return e>>>0}function Yt(e,t){let n=2166136261;return n=Jt(n,new Uint32Array(e.buffer,e.byteOffset,e.length)),n=Jt(n,new Uint32Array(t.buffer,t.byteOffset,t.length)),n.toString(16).padStart(8,`0`)}function Xt(e,t){let n=Math.min(Nt,e.pointCount);if(n===0)return;let r=f(n),i=r.attrs.point.require(`P`).data,a=e.attrs.point.require(`P`).data;i.set(a.subarray(0,n*3));let o=Y.graph.describe().nodes.find(e=>e.id===Y.tintNode.id);if(o===void 0)return;let s=le(Y.tintField,{geo:r,domain:`point`,seed:o.seed}),c=0,l=0;for(let e=0;e<n*3;e++){let n=s.data[e],r=Math.abs(n-t[e]);r>c&&(c=r);let i=Math.abs(n);i>l&&(l=i)}let u=c===0?0:l===0?1/0:c/(2**-23*l);return{maxAbs:c,rangeUlp:u,window:n}}var Z={gpuAvailable:!1,gpuReason:``,adapter:`detecting…`,mode:Lt,count:Ft,seed:Pt,frequency:It,cooking:!1,fps:`–`,points:0,nodes:`–`,cpu:{},gpu:{},specJson:JSON.stringify(kt(It),null,2)},Zt={};function Q(){Zt.publish?.({...Z,cpu:{...Z.cpu},gpu:{...Z.gpu},gpuStats:Z.gpuStats&&{...Z.gpuStats,fallbacks:{...Z.gpuStats.fallbacks}},deviation:Z.deviation&&{...Z.deviation}})}function Qt(){Z.cpu={},Z.gpu={},Z.deviation=void 0,Z.gpuStats=void 0}function $t(){return new Promise(e=>{let t=setTimeout(e,250);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(t),e()}))})}var $=ue(async()=>{let e=Lt===`gpu`&&zt!==void 0;Z.cooking=!0,Z.error=void 0,Q(),await $t();let t=performance.now(),n;try{n=await b(Y.graph,e?{gpu:zt,budgetMs:14}:{budgetMs:14})}catch(e){console.error(`08-gpu-fields: cook failed:`,e),Z.cooking=!1,Z.error=e instanceof Error?e.message:String(e),Q();return}let r=performance.now()-t,i=oe(n.outputs.points);if(i===void 0){Z.cooking=!1,Z.error=`cook produced no geometry`,Q();return}let a=i.pointCount,o=i.attrs.point.require(`tint`).data.subarray(0,a*3),s=i.attrs.point.require(`psize`).data.subarray(0,a);qt(i,o,s);let c=e?Z.gpu:Z.cpu;n.stats.cooked>0&&(c.lastMs=r,c.bestMs=c.bestMs===void 0?r:Math.min(c.bestMs,r)),c.hash=Yt(o,s),Z.points=a,Z.nodes=`${n.stats.cooked} / ${n.stats.cached}`,n.stats.gpu!==void 0&&(Z.gpuStats={dispatches:n.stats.gpu.dispatches,pipelinesCompiled:n.stats.gpu.pipelinesCompiled,pipelineCacheHits:n.stats.gpu.pipelineCacheHits,fallbacks:{...n.stats.gpu.fallbacks}},e&&n.stats.gpu.dispatches>0&&(Z.deviation=Xt(i,o))),Z.cooking=!1,Q()});ye(Dt,{target:(()=>{let e=document.getElementById(`panel`);if(e===null)throw Error(`missing #panel element`);return e})(),props:{bridge:Zt,host:{setMode(e){(e!==`gpu`||zt!==void 0)&&(Lt=e,Z.mode=e,$())},setCount(e){Ft=e,Z.count=e,Y.graph.setParam(Y.scatter,`count`,e),Qt(),$()},setSeed(e){Pt=e,Z.seed=e,Y.graph.setSeed(e),Qt(),$()},setFrequency(e){It=e,Z.frequency=e,Y.tintField=S(kt(e)),Y.graph.setParam(Y.tintNode,`value`,Y.tintField),Y.graph.setParam(Y.sizeNode,`value`,S(At(e))),Z.specJson=JSON.stringify(kt(e),null,2),Qt(),$()},rebuild(){Y=Rt(),$()}},initial:{...Z}}}),Bt().then(e=>{`label`in e?(Z.gpuAvailable=!0,Z.adapter=e.label,Lt=`gpu`,Z.mode=`gpu`):(Z.gpuAvailable=!1,Z.gpuReason=e.error,Z.adapter=`none`),Q(),$()});var en=y(e=>{Z.fps=e,Q()});Wt(()=>en());