import{$t as e,Ct as t,G as n,Gt as r,H as i,Ht as a,Jt as o,Kt as s,N as c,Qt as l,St as u,Tt as d,Ut as f,Wt as p,X as m,Xt as h,Yt as g,_t as _,at as v,bt as y,ct as b,dt as x,en as S,gt as C,ht as w,it as ee,k as te,lt as T,mt as ne,n as re,o as ie,pt as E,q as ae,qt as oe,rt as se,s as ce,st as le,wt as ue,yt as de}from"./OrbitControls-BM2k1NjQ.js";import{t as fe}from"./recook-DLZ34zXJ.js";import{t as pe}from"./scene-By2BIpYn.js";import{B as me,C as he,D,F as ge,H as _e,I as ve,M as ye,N as O,O as k,P as be,R as xe,T as A,U as j,V as Se,_ as Ce,a as we,c as Te,d as Ee,f as De,g as M,i as Oe,j as N,n as ke,p as Ae,u as je,v as P,w as Me,x as F,y as I}from"./disclose-version-CMA9i9Ee.js";var L=class extends Error{constructor(e){super(e),this.name=`GpuCompileError`}};function R(e,t){let n=Math.fround(e);if(!Number.isFinite(n))throw new L(`${t}: value ${e} is not representable as a finite f32 (WGSL kernels compute in f32; keep magnitudes within ~3.4e38)`);return Object.is(n,-0)?`-0f`:`${String(n)}f`}function Ne(e){return`${e>>>0}u`}function z(e){return`0x${(e>>>0).toString(16).padStart(8,`0`)}u`}var B=z,Pe=R(34028234663852886e22,`internal f32 max`);function Fe(e,t){let n=B(e);for(let e of t)n=`pcg_hash_mix(${n}, ${e})`;return`pcg_hash_finalize(${n})`}function Ie(){let e=[];for(let n=0;n<12;n++){let r=e=>R(t[n*3+e],`internal GRAD3`);e.push(`  vec3<f32>(${r(0)}, ${r(1)}, ${r(2)}),`)}return`var<private> PCG_GRAD3: array<vec3<f32>, 12> = array<vec3<f32>, 12>(
${e.join(`
`)}
);`}var V=e=>t=>R(t,e),Le=new Map([[`PCG_GRAD3`,{deps:[],text:Ie()}],[`pcg_hash_mix`,{deps:[],text:`fn pcg_hash_mix(h_in: u32, value: u32) -> u32 {
  var k = value * ${B(oe)};
  k = (k << 15u) | (k >> 17u);
  k = k * ${B(o)};
  var h = h_in ^ k;
  h = (h << 13u) | (h >> 19u);
  h = h * 5u + ${B(g)};
  return h;
}`}],[`pcg_hash_finalize`,{deps:[],text:`fn pcg_hash_finalize(h_in: u32) -> u32 {
  var h = h_in ^ (h_in >> 16u);
  h = h * ${B(p)};
  h = h ^ (h >> 13u);
  h = h * ${B(r)};
  h = h ^ (h >> 16u);
  return h;
}`}],[`pcg_hash3`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash3(a: u32, b: u32, c: u32) -> u32 {
  return ${Fe(l(3),[`a`,`b`,`c`])};
}`}],[`pcg_hash4`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash4(a: u32, b: u32, c: u32, d: u32) -> u32 {
  return ${Fe(l(4),[`a`,`b`,`c`,`d`])};
}`}],[`pcg_hash5`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash5(a: u32, b: u32, c: u32, d: u32, e: u32) -> u32 {
  return ${Fe(l(5),[`a`,`b`,`c`,`d`,`e`])};
}`}],[`pcg_hash_float`,{deps:[],text:`fn pcg_hash_float(h: u32) -> f32 {
  return f32(h >> 8u) * ${R(s,`internal hashFloat scale`)};
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
  return ${V(`internal PERLIN_SCALE`)(y)} * pcg_mix(
    pcg_mix(pcg_mix(n000, n100, u), pcg_mix(n010, n110, u), v),
    pcg_mix(pcg_mix(n001, n101, u), pcg_mix(n011, n111, u), v),
    w);
}`}],[`pcg_simplex_corner`,{deps:[`pcg_hash4`,`PCG_GRAD3`],text:`fn pcg_simplex_corner(seed: u32, i: i32, j: i32, k: i32, x: f32, y: f32, z: f32) -> f32 {
  let t = ${V(`internal simplex R2`)(C)} - x * x - y * y - z * z;
  if (t <= 0f) {
    return 0f;
  }
  let g = pcg_hash4(seed, bitcast<u32>(i), bitcast<u32>(j), bitcast<u32>(k)) % 12u;
  let t2 = t * t;
  return t2 * t2 * dot(PCG_GRAD3[g], vec3<f32>(x, y, z));
}`}],[`pcg_simplex_noise`,{deps:[`pcg_simplex_corner`],text:`fn pcg_simplex_noise(seed: u32, p: vec3<f32>) -> f32 {
  let s = (p.x + p.y + p.z) * ${V(`internal simplex F3`)(ne)};
  let i = i32(floor(p.x + s));
  let j = i32(floor(p.y + s));
  let k = i32(floor(p.z + s));
  let t = f32(i + j + k) * ${V(`internal simplex G3`)(w)};
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
  let x1 = x0 - f32(i1) + ${V(`internal simplex G3`)(w)};
  let y1 = y0 - f32(j1) + ${V(`internal simplex G3`)(w)};
  let z1 = z0 - f32(k1) + ${V(`internal simplex G3`)(w)};
  let x2 = x0 - f32(i2) + ${V(`internal simplex 2*G3`)(2*w)};
  let y2 = y0 - f32(j2) + ${V(`internal simplex 2*G3`)(2*w)};
  let z2 = z0 - f32(k2) + ${V(`internal simplex 2*G3`)(2*w)};
  let x3 = x0 - 1f + ${V(`internal simplex 3*G3`)(3*w)};
  let y3 = y0 - 1f + ${V(`internal simplex 3*G3`)(3*w)};
  let z3 = z0 - 1f + ${V(`internal simplex 3*G3`)(3*w)};
  return ${V(`internal SIMPLEX_SCALE`)(72)} * (pcg_simplex_corner(seed, i, j, k, x0, y0, z0)
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
  var f1 = ${Pe};
  var f2 = ${Pe};
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
}`}]]);function Re(e){let t=new Set,n=e=>{if(t.has(e))return;let r=Le.get(e);if(!r)throw Error(`internal: unknown WGSL library item "${e}"`);t.add(e);for(let e of r.deps)n(e)};for(let t of e)n(t);let r=[];for(let[e,n]of Le)t.has(e)&&r.push(n.text);return r}var ze=64,Be=`wgsl2`,Ve=[`x`,`y`,`z`,`w`];function He(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}function Ue(e,t,n){return new L(`${e}: ${t} has tupleSize ${n}, but GPU kernels support tuple sizes 1 to 4; evaluate this field on the CPU instead, or split it into components`)}function We(e,t,n){let r=1;for(let i of n)if(i!==1){if(r!==1&&r!==i)throw new L(`${t}: ${e}: incompatible tuple sizes ${r} and ${i}`);r=i}return r}var Ge=class{layout;lines=[];libRoots=new Set;usesSeed=!1;valueNumbers=new Map;bindings=new Map;helpers=new Map;helperTexts=[];helperCounters=new Map;varCounter=0;constructor(e,t){this.layout=e,t.forEach((t,n)=>{this.bindings.set(t,{name:t,varName:`in${n}`,binding:n+1,attr:e.attributes[t]})})}emit(e,t){let n=this.valueNumbers.get(e);if(n)return n;let r={ref:`v${this.varCounter++}`,size:t};return this.lines.push(`  let ${r.ref} = ${e};`),this.valueNumbers.set(e,r),r}binding(e){let t=this.bindings.get(e);if(!t)throw Error(`internal: attribute ${JSON.stringify(e)} was not pre-bound`);return t}boundAttrs(){return[...this.bindings.values()]}helper(e,t){let n=this.helpers.get(t);if(n)return n;let r=this.helperCounters.get(e)??0;this.helperCounters.set(e,r+1);let i=`pcg_${e}_${r}`;return this.helpers.set(t,i),this.helperTexts.push(t.replaceAll(`@NAME@`,i)),i}helperBlocks(){return this.helperTexts}};function Ke(e,t){return e.size===t?e.ref:`vec${t}<f32>(${e.ref})`}function H(e){return e===1?`0f`:`vec${e}<f32>(0f)`}function qe(e){return e===1?`1f`:`vec${e}<f32>(1f)`}function Je(e){let t=Object.keys(e.attributes).sort();return t.length===0?`the layout declares no attributes`:`layout attributes: ${t.map(e=>JSON.stringify(e)).join(`, `)}`}function Ye(e,t,n,r,i){let a=e.layout.attributes;if(!Object.hasOwn(a,n))throw new L(`${t}: ${i}attribute ${JSON.stringify(n)} is not in the kernel layout; ${Je(e.layout)}`);let o=a[n];if(o.type===`string`)throw new L(`${t}: ${i}attribute ${JSON.stringify(n)} has type "string"; string attributes cannot be read as fields and are CPU-only — use a numeric or bool attribute`);if(r!==void 0&&o.tupleSize!==r)throw new L(`${t}: ${i}attribute ${JSON.stringify(n)}: expected tupleSize ${r}, got ${o.tupleSize} in the kernel layout`);if(o.tupleSize>4)throw Ue(t,`${i}attribute ${JSON.stringify(n)}`,o.tupleSize);return o}function Xe(e,t,n,r,i){let a=Ye(e,t,n,r,i),o=e.binding(n),s=a.tupleSize,c=e=>a.type===`f32`?e:`f32(${e})`;if(s===1)return e.emit(c(`${o.varName}[i]`),1);let l=[];for(let e=0;e<s;e++)l.push(c(`${o.varName}[${Ze(s,e)}]`));return e.emit(`vec${s}<f32>(${l.join(`, `)})`,s)}function Ze(e,t){return e===1?`i`:t===0?`i * ${e}u`:`i * ${e}u + ${t}u`}var U=new Map;function Qe(){return[...U.keys()].sort()}function $e(e,t,n){let r=String(e.fn),i=U.get(r);if(!i)throw new L(`${t}: field fn "${r}" is not supported by the WGSL compiler; supported fns: ${Qe().join(`, `)}`);return i(e,t,n)}function W(e,t,n){return typeof e==`number`?n.emit(R(e,t),1):Array.isArray(e)?et(e,t,n):$e(e,t,n)}function et(e,t,n){let r=e.length;if(r>4)throw Ue(t,`constant`,r);if(r===1)return n.emit(R(e[0],t),1);let i=e.map(e=>R(e,t));return n.emit(`vec${r}<f32>(${i.join(`, `)})`,r)}function G(e){return e.args}U.set(`constant`,(e,t,n)=>{let r=e.value;return typeof r==`number`?n.emit(R(r,`${t}.value`),1):et(r,`${t}.value`,n)}),U.set(`attribute`,(e,t,n)=>{let r=e.name,i=e.tupleSize;return Xe(n,t,r,i,``)}),U.set(`position`,(e,t,n)=>Xe(n,t,`P`,3,`position reads `)),U.set(`index`,(e,t,n)=>n.emit(`f32(i)`,1)),U.set(`randomField`,(t,n,r)=>{let i=t.key,a=typeof i==`string`?e(i):(i??0)>>>0;return r.usesSeed=!0,r.libRoots.add(`pcg_hash3`),r.libRoots.add(`pcg_hash_float`),r.emit(`pcg_hash_float(pcg_hash3(params.seed, ${z(a)}, i))`,1)});function K(e,t,n){U.set(e,(r,i,a)=>{let o=G(r),s=[];for(let e=0;e<t;e++)s.push(W(o[e],`${i}.args[${e}]`,a));let c=We(e,i,s.map(e=>e.size)),l=s.map(e=>Ke(e,c));return a.emit(n(l,c),c)})}K(`add`,2,e=>`${e[0]} + ${e[1]}`),K(`sub`,2,e=>`${e[0]} - ${e[1]}`),K(`mul`,2,e=>`${e[0]} * ${e[1]}`),K(`div`,2,e=>`${e[0]} / ${e[1]}`),K(`min`,2,e=>`min(${e[0]}, ${e[1]})`),K(`max`,2,e=>`max(${e[0]}, ${e[1]})`),K(`abs`,1,e=>`abs(${e[0]})`),K(`floor`,1,e=>`floor(${e[0]})`),K(`sin`,1,e=>`sin(${e[0]})`),K(`cos`,1,e=>`cos(${e[0]})`),K(`tan`,1,e=>`tan(${e[0]})`),K(`asin`,1,e=>`asin(${e[0]})`),K(`acos`,1,e=>`acos(${e[0]})`),K(`atan`,1,e=>`atan(${e[0]})`),K(`atan2`,2,e=>`atan2(${e[0]}, ${e[1]})`),K(`clamp`,3,e=>`clamp(${e[0]}, ${e[1]}, ${e[2]})`),K(`lerp`,3,e=>`${e[0]} + (${e[1]} - ${e[0]}) * ${e[2]}`),K(`select`,3,(e,t)=>`select(${e[2]}, ${e[1]}, ${e[0]} != ${H(t)})`),K(`lt`,2,(e,t)=>`select(${H(t)}, ${qe(t)}, ${e[0]} < ${e[1]})`),K(`le`,2,(e,t)=>`select(${H(t)}, ${qe(t)}, ${e[0]} <= ${e[1]})`),K(`gt`,2,(e,t)=>`select(${H(t)}, ${qe(t)}, ${e[0]} > ${e[1]})`),K(`ge`,2,(e,t)=>`select(${H(t)}, ${qe(t)}, ${e[0]} >= ${e[1]})`),K(`eq`,2,(e,t)=>`select(${H(t)}, ${qe(t)}, ${e[0]} == ${e[1]})`),U.set(`remap`,(e,t,n)=>{let r=G(e).map((e,r)=>W(e,`${t}.args[${r}]`,n)),i=We(`remap`,t,r.map(e=>e.size)),[a,o,s,c,l]=r.map(e=>Ke(e,i)),u=n.emit(`${s} - ${o}`,i),d=H(i),f=n.emit(`select(${u.ref}, ${qe(i)}, ${u.ref} == ${d})`,i);return n.emit(`select(${c} + ((${a} - ${o}) / ${f.ref}) * (${l} - ${c}), ${c}, ${u.ref} == ${d})`,i)}),U.set(`dot`,(e,t,n)=>{let r=G(e),i=W(r[0],`${t}.args[0]`,n),a=W(r[1],`${t}.args[1]`,n),o=We(`dot`,t,[i.size,a.size]);return o===1?n.emit(`${i.ref} * ${a.ref}`,1):n.emit(`dot(${Ke(i,o)}, ${Ke(a,o)})`,1)}),U.set(`length`,(e,t,n)=>{let r=W(G(e)[0],`${t}.args[0]`,n);if(r.size===1)return n.emit(`abs(${r.ref})`,1);let i=n.emit(`dot(${r.ref}, ${r.ref})`,1);return n.emit(`sqrt(${i.ref})`,1)}),U.set(`normalize`,(e,t,n)=>{let r=W(G(e)[0],`${t}.args[0]`,n),i=r.size===1?n.emit(`${r.ref} * ${r.ref}`,1):n.emit(`dot(${r.ref}, ${r.ref})`,1),a=n.emit(`select(0f, 1f / sqrt(${i.ref}), ${i.ref} > 0f)`,1);return n.emit(`${r.ref} * ${a.ref}`,r.size)}),U.set(`vec`,(e,t,n)=>{let r=G(e).map((e,r)=>W(e,`${t}.args[${r}]`,n)),i=r.reduce((e,t)=>e+t.size,0);if(i>4)throw Ue(t,`vec result`,i);return r.length===1?r[0]:n.emit(`vec${i}<f32>(${r.map(e=>e.ref).join(`, `)})`,i)}),U.set(`component`,(e,t,n)=>{let r=W(G(e)[0],`${t}.args[0]`,n),i=e.index;if(i>=r.size)throw new L(`${t}: component: index ${i} out of range for tupleSize ${r.size}`);return r.size===1?r:n.emit(`${r.ref}.${Ve[i]}`,1)}),U.set(`ramp`,(e,t,n)=>{let r=W(G(e)[0],`${t}.args[0]`,n);if(r.size!==1)throw new L(`${t}: ramp: input must be scalar, got tupleSize ${r.size}`);let i=e.stops,a=n.helper(`ramp`,tt(i,`${t}.stops`));return n.emit(`${a}(${r.ref})`,1)});function tt(e,t){let n=e=>R(e,t),r=e.length-1,i=[];i.push(`fn @NAME@(t: f32) -> f32 {`),i.push(`  if (t <= ${n(e[0][0])}) {`),i.push(`    return ${n(e[0][1])};`),i.push(`  }`),i.push(`  if (t >= ${n(e[r][0])}) {`),i.push(`    return ${n(e[r][1])};`),i.push(`  }`);let a=t=>{let r=e[t-1][0],i=e[t-1][1],a=e[t][0]-r,o=e[t][1]-i;return`${n(i)} + ${n(o)} * ((t - ${n(r)}) / ${n(a)})`};for(let t=1;t<r;t++)i.push(`  if (t <= ${n(e[t][0])}) {`),i.push(`    return ${a(t)};`),i.push(`  }`);return r>=1?i.push(`  return ${a(r)};`):i.push(`  return t;`),i.push(`}`),i.join(`
`)}var nt={valueNoise:u,perlinNoise:de,simplexNoise:_,worleyNoise:E},rt={valueNoise:`pcg_value_noise`,perlinNoise:`pcg_perlin_noise`,simplexNoise:`pcg_simplex_noise`};function it(e){return e.opts??{}}function at(e,t,n,r){let i=it(t),a=i.position===void 0?n:`${n}.opts.position`,o=i.position===void 0?Xe(r,n,`P`,3,`${e} position reads `):W(i.position,a,r);if(o.size!==3)throw new L(`${a}: ${e}: position field must have tupleSize 3, got ${o.size}`);let s=R(i.frequency??1,`${n}.opts.frequency`),[c,l,u]=i.offset??[0,0,0],d=`vec3<f32>(${R(c,`${n}.opts.offset`)}, ${R(l,`${n}.opts.offset`)}, ${R(u,`${n}.opts.offset`)})`;return r.emit(`${o.ref} * ${s} + ${d}`,3)}function ot(e,t){return d(nt[e],(t??0)>>>0)}function st(e,t,n,r){let[i,a]=n,o=a-i;return e.emit(`(${t.ref} - ${R(i,r)}) / ${R(o,r)}`,1)}for(let e of[`valueNoise`,`perlinNoise`,`simplexNoise`])U.set(e,(t,n,r)=>{let i=it(t),a=at(e,t,n,r);r.libRoots.add(rt[e]);let o=r.emit(`${rt[e]}(${z(ot(e,i.seed))}, ${a.ref})`,1);return i.normalized===!0?st(r,o,ue[e],`${n}.opts.normalized`):o});U.set(`worleyNoise`,(e,t,n)=>{let r=it(e),i=r.output??`f1`,a=r.exact===!0,o=at(`worleyNoise`,e,t,n);n.libRoots.add(`pcg_worley`);let s=i!==`f1`,c=n.emit(`pcg_worley(${z(ot(`worleyNoise`,r.seed))}, ${o.ref}, ${a}, ${s})`,2),l=i===`f1`?n.emit(`${c.ref}.x`,1):i===`f2`?n.emit(`${c.ref}.y`,1):n.emit(`${c.ref}.y - ${c.ref}.x`,1);return r.normalized===!0?st(n,l,ue.worleyNoise[i],`${t}.opts.normalized`):l});function ct(e){return e===`worleyNoise`?ue.worleyNoise.f1:ue[e]}function lt(e,t,n){return e===`worleyNoise`?`pcg_worley(${t}, ${n}, false, false).x`:`${rt[e]}(${t}, ${n})`}U.set(`fbm`,(e,t,n)=>{let r=e.base,i=it(e),a=i.octaves??4,o=i.lacunarity??2,s=i.gain??.5,c=i.seed??0,l=i.frequency??1,[u,d,f]=i.offset??[0,0,0],p=i.position===void 0?t:`${t}.opts.position`,m=i.position===void 0?Xe(n,t,`P`,3,`fbm position reads `):W(i.position,p,n);if(m.size!==3)throw new L(`${p}: fbm: position field must have tupleSize 3, got ${m.size}`);let g=ct(r),_=[],v=[],y=[],b=1,x=l,S=0,C=0;for(let e=0;e<a;e++)_.push(z(ot(r,h(c,e)))),v.push(R(x,`${t}.opts.frequency`)),y.push(R(b,`${t}.opts.gain`)),S+=b>=0?b*g[0]:b*g[1],C+=b>=0?b*g[1]:b*g[0],b*=s,x*=o;n.libRoots.add(r===`worleyNoise`?`pcg_worley`:rt[r]);let w=`vec3<f32>(${R(u,`${t}.opts.offset`)}, ${R(d,`${t}.opts.offset`)}, ${R(f,`${t}.opts.offset`)})`,ee=`fn @NAME@(p: vec3<f32>) -> f32 {
  var seeds = array<u32, ${a}>(${_.join(`, `)});
  var freqs = array<f32, ${a}>(${v.join(`, `)});
  var amps = array<f32, ${a}>(${y.join(`, `)});
  var sum = 0f;
  for (var o = 0u; o < ${Ne(a)}; o++) {
    sum = sum + ${lt(r,`seeds[o]`,`p * freqs[o] + `+w)} * amps[o];
  }
  return sum;
}`,te=n.helper(`fbm`,ee),T=n.emit(`${te}(${m.ref})`,1);if(i.normalized!==!0)return T;if(!(C>S))throw new L(`${t}: fbm: normalized: true needs a non-degenerate output range, got [${S}, ${C}] for this octaves/gain configuration`);return st(n,T,[S,C],`${t}.opts.normalized`)});var ut=new Set([`valueNoise`,`perlinNoise`,`simplexNoise`,`worleyNoise`,`fbm`]);function dt(e,t){if(!He(e))return;let n=e.fn;if(n===`attribute`){typeof e.name==`string`&&t.add(e.name);return}if(n===`position`){t.add(`P`);return}if(typeof n==`string`&&ut.has(n)){let n=e.opts;He(n)&&n.position!==void 0?dt(n.position,t):t.add(`P`);return}let r=e.args;if(Array.isArray(r))for(let e of r)dt(e,t)}var ft=new Set([`f32`,`i32`,`u32`,`bool`,`string`]);function pt(e){if(!He(e)||!He(e.attributes))throw new L(`compileFieldSpec: layout must be { attributes: { name: { type, tupleSize } } }`);for(let[t,n]of Object.entries(e.attributes)){if(!He(n)||!ft.has(n.type))throw new L(`kernel layout attribute ${JSON.stringify(t)}: unknown type ${JSON.stringify(n?.type)}; valid types: "f32", "i32", "u32", "bool" ("string" is accepted but CPU-only)`);let e=n.tupleSize;if(typeof e!=`number`||!Number.isInteger(e)||e<1)throw new L(`kernel layout attribute ${JSON.stringify(t)}: tupleSize must be a positive integer, got ${String(e)}`)}}function mt(e){return typeof e==`number`?{fn:`constant`,value:e}:Array.isArray(e)?{fn:`constant`,value:[...e]}:e}function ht(e){return e.type===`bool`?`u32`:e.type}function gt(e,t){pt(t);let n=mt(e),r=v(n),i=new Set;dt(n,i);let a=new Ge(t,[...i].filter(e=>Object.hasOwn(t.attributes,e)&&t.attributes[e].type!==`string`).sort()),o=`f32`,s=0,c=[],l=e=>{if(s=e.size,e.size===1)c.push(`  outBuf[i] = ${e.ref};`);else for(let t=0;t<e.size;t++)c.push(`  outBuf[${Ze(e.size,t)}] = ${e.ref}.${Ve[t]};`)},u=n.fn===`attribute`?n.name:n.fn===`position`?`P`:void 0;if(n.fn===`index`)o=`u32`,s=1,c.push(`  outBuf[i] = i;`);else if(u!==void 0){let e=Ye(a,`$`,u,n.fn===`position`?3:n.tupleSize,n.fn===`position`?`position reads `:``);if(e.type===`i32`||e.type===`u32`){o=e.type,s=e.tupleSize;let t=a.binding(u);for(let n=0;n<e.tupleSize;n++)c.push(`  outBuf[${Ze(e.tupleSize,n)}] = ${t.varName}[${Ze(e.tupleSize,n)}];`)}else l($e(n,`$`,a))}else l($e(n,`$`,a));let d=a.boundAttrs(),f=d.map(e=>({name:e.name,type:ht(e.attr),tupleSize:e.attr.tupleSize,binding:e.binding})),p=d.length+1,m=[`@group(0) @binding(0) var<uniform> params: PcgParams;`];for(let e of d)m.push(`@group(0) @binding(${e.binding}) var<storage, read> ${e.varName}: array<${ht(e.attr)}>; // attribute ${JSON.stringify(e.name)}: ${e.attr.type} tupleSize ${e.attr.tupleSize}`);m.push(`@group(0) @binding(${p}) var<storage, read_write> outBuf: array<${o}>;`);let h=[`// Generated by pcg-ts compileFieldSpec (WGSL field kernel).
// Dispatch: 1D, chunked; each chunk runs ceil(chunkElements / ${ze}) workgroups of ${ze}
// with element index i = chunkOffset + gid.x; one invocation per element.

struct PcgParams {
  count: u32,
  seed: u32,
  chunkOffset: u32,
}

${m.join(`
`)}`,...Re(a.libRoots),...a.helperBlocks(),`@compute @workgroup_size(${ze})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x + params.chunkOffset;
  if (i >= params.count) {
    return;
  }
${[...a.lines,...c].join(`
`)}
}`],g=d.map(e=>`${JSON.stringify(e.name)}:${e.attr.type}x${e.attr.tupleSize}`).join(`,`);return{wgsl:`${h.join(`

`)}\n`,entryPoint:`main`,workgroupSize:ze,outTupleSize:s,outType:o,inputs:f,bindings:{uniforms:0,output:p},usesSeed:a.usesSeed,key:`${Be}|spec=${r.key}|layout=[${g}]`}}var q={MAP_READ:1,COPY_SRC:4,COPY_DST:8,UNIFORM:64,STORAGE:128},_t={READ:1},vt=256;function yt(e){let t=vt;for(;t<e;)t*=2;return t}var bt=class{device;maxPooledBytes;free=new Map;meta=new Map;idleBytes=0;idleCount=0;created=0;reused=0;destroyed=0;constructor(e,t){this.device=e,this.maxPooledBytes=t}acquire(e,t){let n=yt(e),r=`${t}|${n}`,i=this.free.get(r)?.pop();if(i!==void 0)return this.idleBytes-=n,this.idleCount--,this.reused++,i;let a=this.device.createBuffer({size:n,usage:t});return this.meta.set(a,{key:r,bytes:n}),this.created++,a}release(e){let t=this.meta.get(e);if(t===void 0)throw Error(`BufferPool.release: buffer was not acquired from this pool`);if(this.idleBytes+t.bytes>this.maxPooledBytes){this.meta.delete(e),e.destroy(),this.destroyed++;return}let n=this.free.get(t.key);n===void 0&&(n=[],this.free.set(t.key,n)),n.push(e),this.idleBytes+=t.bytes,this.idleCount++}get stats(){return{buffersCreated:this.created,buffersReused:this.reused,buffersDestroyed:this.destroyed,pooledBuffers:this.idleCount,pooledBytes:this.idleBytes}}dispose(){for(let e of this.free.values())for(let t of e)this.meta.delete(t),t.destroy(),this.destroyed++;this.free.clear(),this.idleBytes=0,this.idleCount=0}},xt=`apply1`;function J(e,t,n){let r=St(e,t,n);return t.type===`f32`?r:`f32(${r})`}function St(e,t,n){return t.tupleSize===1?`${e}[i]`:n===0?`${e}[i * ${t.tupleSize}u]`:`${e}[i * ${t.tupleSize}u + ${n}u]`}function Ct(e,t,n){return t===1?`${e}[i]`:n===0?`${e}[i * ${t}u]`:`${e}[i * ${t}u + ${n}u]`}function wt(e,t,n,r){let i=[`@group(0) @binding(0) var<uniform> params: PcgParams;`],a=[];return t.forEach((e,t)=>{let n=t+1,r=e.access===`read`?`read`:`read_write`;i.push(`@group(0) @binding(${n}) var<storage, ${r}> b${n}: array<${e.elem}>; // ${e.comment}`),a.push({binding:n,role:e.role,access:e.access})}),{wgsl:`// Generated by pcg-ts resident-run apply codegen.
// Dispatch: 1D, chunked; element index i = chunkOffset + gid.x, one
// invocation per element; only element i's slots are accessed.

struct PcgParams {
  count: u32,
  seed: u32,
  chunkOffset: u32,
}

${i.join(`
`)}

${n.length>0?`${n.join(`

`)}\n\n`:``}@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x + params.chunkOffset;
  if (i >= params.count) {
    return;
  }
${r}
}
`,entryPoint:`main`,workgroupSize:64,bindings:a,key:`${xt}|${e}`}}var Y=e=>`${e.type}x${e.tupleSize}`;function Tt(e,t,n){let r=t===`f32`&&e.type===`f32`,i=r?`u32`:e.type,a=t===`bool`||r?`u32`:t,o={type:i,tupleSize:e.tupleSize},s=(n,i)=>{switch(t){case`f32`:return r?n:i;case`i32`:return e.type===`f32`?`i32(${n})`:e.type===`i32`?n:`bitcast<i32>(${n})`;case`u32`:return e.type===`f32`?`u32(${n})`:e.type===`u32`?n:`bitcast<u32>(${n})`;default:return`select(0u, 1u, ${n} != ${e.type===`f32`?`0f`:e.type===`i32`?`0i`:`0u`})`}},c=[];for(let e=0;e<n;e++){let t=St(`b1`,o,e);c.push(`  ${Ct(`b2`,n,e)} = ${s(t,J(`b1`,o,e))};`)}return wt(`setAttribute|col=${Y(e)}|out=${t}x${n}`,[{role:`value`,access:`read`,elem:i,comment:`value column ${Y(e)}`},{role:`target`,access:`read_write`,elem:a,comment:`target attribute ${t} tupleSize ${n}`}],[],c.join(`
`))}var Et={euler:`fn pcg_quat_from_euler_deg(r: vec3<f32>) -> vec4<f32> {
  let h = r * ${R(Math.PI/360,`internal PI/360`)};
  let sx = sin(h.x);
  let cx = cos(h.x);
  let sy = sin(h.y);
  let cy = cos(h.y);
  let sz = sin(h.z);
  let cz = cos(h.z);
  return vec4<f32>(
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz);
}`,mul:`fn pcg_quat_mul(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z);
}`,rotate:`fn pcg_rotate_vec(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let t = 2f * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}`,basis:`fn pcg_quat_from_basis(bx: vec3<f32>, by: vec3<f32>, bz: vec3<f32>) -> vec4<f32> {
  let m11 = bx.x;
  let m12 = by.x;
  let m13 = bz.x;
  let m21 = bx.y;
  let m22 = by.y;
  let m23 = bz.y;
  let m31 = bx.z;
  let m32 = by.z;
  let m33 = bz.z;
  let trace = m11 + m22 + m33;
  if (trace > 0f) {
    let s = 0.5f / sqrt(trace + 1f);
    return vec4<f32>((m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25f / s);
  } else if (m11 > m22 && m11 > m33) {
    let s = 2f * sqrt(1f + m11 - m22 - m33);
    return vec4<f32>(0.25f * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s);
  } else if (m22 > m33) {
    let s = 2f * sqrt(1f + m22 - m11 - m33);
    return vec4<f32>((m12 + m21) / s, 0.25f * s, (m23 + m32) / s, (m13 - m31) / s);
  }
  let s = 2f * sqrt(1f + m33 - m11 - m22);
  return vec4<f32>((m13 + m31) / s, (m23 + m32) / s, 0.25f * s, (m21 - m12) / s);
}`};function Dt(e,t,n,r,i){let a=[{role:`translate`,access:`read`,elem:e.type,comment:`translate column ${Y(e)}`},{role:`rotateEuler`,access:`read`,elem:t.type,comment:`rotateEuler column ${Y(t)}`},{role:`scale`,access:`read`,elem:n.type,comment:`scale column ${Y(n)}`},{role:`P`,access:`read_write`,elem:`f32`,comment:`attribute P: f32 tupleSize 3`}],o=5,s=``,c=``;r&&(s=`b${o++}`,a.push({role:`rot`,access:`read_write`,elem:`f32`,comment:`attribute rot: f32 tupleSize 4`})),i&&(c=`b${o++}`,a.push({role:`scaleAttr`,access:`read_write`,elem:`f32`,comment:`attribute scale: f32 tupleSize 3`}));let l=[];return l.push(`  let s = vec3<f32>(${[0,1,2].map(e=>J(`b3`,n,e)).join(`, `)});`),l.push(`  let q = pcg_quat_from_euler_deg(vec3<f32>(${[0,1,2].map(e=>J(`b2`,t,e)).join(`, `)}));`),l.push(`  let v = pcg_rotate_vec(q, vec3<f32>(b4[i * 3u] * s.x, b4[i * 3u + 1u] * s.y, b4[i * 3u + 2u] * s.z));`),l.push(`  b4[i * 3u] = v.x + ${J(`b1`,e,0)};`),l.push(`  b4[i * 3u + 1u] = v.y + ${J(`b1`,e,1)};`),l.push(`  b4[i * 3u + 2u] = v.z + ${J(`b1`,e,2)};`),r&&(l.push(`  let q2 = pcg_quat_mul(q, vec4<f32>(${s}[i * 4u], ${s}[i * 4u + 1u], ${s}[i * 4u + 2u], ${s}[i * 4u + 3u]));`),l.push(`  ${s}[i * 4u] = q2.x;`),l.push(`  ${s}[i * 4u + 1u] = q2.y;`),l.push(`  ${s}[i * 4u + 2u] = q2.z;`),l.push(`  ${s}[i * 4u + 3u] = q2.w;`)),i&&(l.push(`  ${c}[i * 3u] = ${c}[i * 3u] * s.x;`),l.push(`  ${c}[i * 3u + 1u] = ${c}[i * 3u + 1u] * s.y;`),l.push(`  ${c}[i * 3u + 2u] = ${c}[i * 3u + 2u] * s.z;`)),wt(`transformPoints|t=${Y(e)}|r=${Y(t)}|s=${Y(n)}|rot=${+!!r}|scl=${+!!i}`,a,[Et.euler,Et.mul,Et.rotate],l.join(`
`))}function Ot(e){let t=[];for(let n=0;n<3;n++){let r=n===0?`i * 3u`:`i * 3u + ${n}u`;t.push(`  b2[${r}] = b2[${r}] + (pcg_hash_float(pcg_hash3(params.seed, i, ${n}u)) * 2f - 1f) * ${J(`b1`,e,n)};`)}return wt(`jitterPoints|a=${Y(e)}`,[{role:`amount`,access:`read`,elem:e.type,comment:`amount column ${Y(e)}`},{role:`P`,access:`read_write`,elem:`f32`,comment:`attribute P: f32 tupleSize 3`}],Re([`pcg_hash3`,`pcg_hash_float`]),t.join(`
`))}var kt={"+x":`f, u, -r`,"-x":`-f, u, r`,"+y":`-r, f, u`,"-y":`r, -f, u`,"+z":`r, u, f`,"-z":`-r, u, -f`};function At(e,t,n){let r=n[0]*n[0]+n[1]*n[1]+n[2]*n[2],i=r>0?1/Math.sqrt(r):0,a=e=>R(n[e]*i,`orientAlongVector up`),o=R(1e-12,`internal ORIENT_PARALLEL_EPS`),s=`  let d = vec3<f32>(${[0,1,2].map(t=>J(`b1`,e,t)).join(`, `)});
  let dl = dot(d, d);
  if (dl == 0f) {
    return; // zero direction: keep the prior rot
  }
  let f = d * (1f / sqrt(dl));
  let up = vec3<f32>(${a(0)}, ${a(1)}, ${a(2)});
  // right = up x forward, falling back when (anti)parallel.
  var r = cross(up, f);
  var rl = dot(r, r);
  if (rl <= ${o}) {
    // [0, 0, 1] x f
    r = vec3<f32>(-f.y, f.x, 0f);
    rl = r.x * r.x + r.y * r.y;
    if (rl <= ${o}) {
      // f is (anti)parallel to Z too; [1, 0, 0] x f always works here.
      r = vec3<f32>(0f, -f.z, f.y);
      rl = r.y * r.y + r.z * r.z;
    }
  }
  r = r * (1f / sqrt(rl));
  // u = forward x right (unit: forward and right are orthonormal).
  let u = cross(f, r);
  let q = pcg_quat_from_basis(${kt[t]});
  b2[i * 4u] = q.x;
  b2[i * 4u + 1u] = q.y;
  b2[i * 4u + 2u] = q.z;
  b2[i * 4u + 3u] = q.w;`;return wt(`orientAlongVector|d=${Y(e)}|axis=${t}|up=${[0,1,2].map(a).join(`,`)}`,[{role:`direction`,access:`read`,elem:e.type,comment:`direction column ${Y(e)}`},{role:`rot`,access:`read_write`,elem:`f32`,comment:`attribute rot: f32 tupleSize 4`}],[Et.basis],s)}var jt=65535;function Mt(e,t){let n=jt*e;return Math.max(e,Math.floor(Math.min(t??n,n)/e)*e)}var Nt=`pcg-resident-run/1`;function Pt(e){return e.format===Nt?e:null}var Ft={reason:`run-plan-failed`},It=[`+x`,`-x`,`+y`,`-y`,`+z`,`-z`];function Lt(e){return Array.isArray(e)&&e.length===3&&e.every(e=>typeof e==`number`&&Number.isFinite(e))}var X=class extends Error{};function Rt(e,t,n){let r=t.count,i=new Map(Object.entries(t.attributes)),a=[],o=new Map,s=[],c=new Map,l=[],u=[],d=()=>Object.fromEntries(i),p=e=>{let t=o.get(e);if(t!==void 0)return t;let n=i.get(e);if(n===void 0||n.type===`string`)throw new X(e);let s=a.length;return a.push({bytes:r*n.tupleSize*4,init:`attr`,name:e}),o.set(e,s),s},m=(e,t,n)=>{let i=a.length;return a.push({bytes:r*t*4,init:n,name:e}),o.set(e,i),i},g=(e,t,n)=>{let r=i.get(e);if(r===void 0||r.type!==t||r.tupleSize!==n)throw new X(e)},_=(e,t,n,i)=>{let a;if(f(e)){let t=le(e);if(t===void 0)throw new X(`no spec`);a=t}else if(typeof e==`number`||Array.isArray(e)&&e.every(e=>typeof e==`number`))a=e;else throw new X(`bad param value`);let o;try{o=gt(a,{attributes:d()})}catch{throw new X(`compile`)}if(o.inputs.length+1>8)throw new X(`buffers`);if(i!==null&&!i.includes(o.outTupleSize))throw new X(`tuple`);let c=s.length;return s.push(r*o.outTupleSize*4),n.push({key:o.key,wgsl:o.wgsl,entryPoint:o.entryPoint,workgroupSize:o.workgroupSize,seed:t,uniformsBinding:o.bindings.uniforms,bindings:[...o.inputs.map(e=>({binding:e.binding,ref:{kind:`slot`,index:p(e.name)}})),{binding:o.bindings.output,ref:{kind:`col`,index:c}}]}),{col:{type:o.outType,tupleSize:o.outTupleSize},ref:{kind:`col`,index:c}}},v=(e,t,n)=>({key:e.key,wgsl:e.wgsl,entryPoint:e.entryPoint,workgroupSize:e.workgroupSize,seed:t,uniformsBinding:0,bindings:e.bindings.map(e=>{let t=n[e.role];if(t===void 0)throw new X(`unmapped role ${e.role}`);return{binding:e.binding,ref:t}})});try{for(let t of e){let e=[],n=t.params;switch(t.kind){case`setAttribute`:{let r=n.name,a=n.type,o=n.tupleSize;if(typeof r!=`string`)throw new X(`name`);if(a!==`f32`&&a!==`i32`&&a!==`u32`&&a!==`bool`)throw new X(`type`);if(typeof o!=`number`||!Number.isInteger(o)||o<1||o>4)throw new X(`tupleSize`);let s=typeof n.seed==`number`?n.seed:NaN,u=s===0?t.seed:h(t.seed,s),{col:d,ref:f}=_(n.value,u,e,o===1?[1]:[1,o]),p=m(r,o,`none`);i.set(r,{type:a,tupleSize:o}),c.set(r,p),l.push({op:`replace`,name:r,type:a,tupleSize:o}),e.push(v(Tt(d,a,o),0,{value:f,target:{kind:`slot`,index:p}}));break}case`transformPoints`:{g(`P`,`f32`,3);let r=_(n.translate,t.seed,e,[1,3]),a=_(n.rotateEuler,t.seed,e,[1,3]),o=_(n.scale,t.seed,e,[1,3]),s=i.get(`rot`),l=s!==void 0&&s.type===`f32`&&s.tupleSize===4,u=i.get(`scale`),d=u!==void 0&&u.type===`f32`&&u.tupleSize===3,f=p(`P`);c.set(`P`,f);let m={translate:r.ref,rotateEuler:a.ref,scale:o.ref,P:{kind:`slot`,index:f}};if(l){let e=p(`rot`);c.set(`rot`,e),m.rot={kind:`slot`,index:e}}if(d){let e=p(`scale`);c.set(`scale`,e),m.scaleAttr={kind:`slot`,index:e}}e.push(v(Dt(r.col,a.col,o.col,l,d),0,m));break}case`jitterPoints`:{g(`P`,`f32`,3);let r=typeof n.seed==`number`?n.seed:NaN,i=h(t.seed,r),a=_(n.amount,i,e,[1,3]),o=p(`P`);c.set(`P`,o),e.push(v(Ot(a.col),i,{amount:a.ref,P:{kind:`slot`,index:o}}));break}case`orientAlongVector`:{let r=n.axis;if(!It.includes(r))throw new X(`axis`);if(!Lt(n.up))throw new X(`up`);let a=_(n.direction,t.seed,e,[1,3]),o=i.get(`rot`),s=o!==void 0&&o.type===`f32`&&o.tupleSize===4?p(`rot`):m(`rot`,4,`quat-default`);i.set(`rot`,{type:`f32`,tupleSize:4}),c.set(`rot`,s),l.push({op:`ensure-rot`}),e.push(v(At(a.col,r,n.up),0,{direction:a.ref,rot:{kind:`slot`,index:s}}));break}default:throw new X(`unknown kind ${t.kind}`)}u.push({id:t.id,type:t.type,steps:e})}}catch(e){if(e instanceof X)return Ft;throw e}let y=[...c].map(([e,t])=>({name:e,slot:t})),b=a.reduce((e,t)=>e+t.bytes,0),x=s.reduce((e,t)=>e+t,0),S=y.reduce((e,t)=>e+a[t.slot].bytes,0),C=b+x+S;return C>n?{reason:`run-too-large`}:{plan:{format:Nt,count:r,members:u,slots:a,cols:s,written:y,layoutOps:l,totalBytes:C}}}var zt={f32:Float32Array,i32:Int32Array,u32:Uint32Array};function Bt(){return new Promise(e=>setTimeout(e,0))}async function Vt(e,t,n,r){let{device:i,pool:a}=e,{geo:o,signal:s,budgetMs:c}=n,l=t.count;if(o.attrs.point.count!==l)throw Error(`resident run: plan was built for ${l} points but the input geometry has ${o.attrs.point.count}; plans are single-cook artifacts — re-plan for new inputs`);let u=()=>{if(s?.aborted)throw new x},d=[],f=(e,t)=>{let n=a.acquire(e,t);return d.push(n),n};try{let n=o.attrs.point,a=t.slots.map(e=>{let t=f(e.bytes,q.STORAGE|q.COPY_DST|q.COPY_SRC);if(e.init===`attr`){let r=n.require(e.name),a=e.bytes/4;if(r.data instanceof Uint8Array){let e=new Uint32Array(a);for(let t=0;t<a;t++)e[t]=r.data[t];i.queue.writeBuffer(t,0,e)}else i.queue.writeBuffer(t,0,r.data.subarray(0,a))}else if(e.init===`quat-default`){let n=new Float32Array(e.bytes/4);for(let e=3;e<n.length;e+=4)n[e]=1;i.queue.writeBuffer(t,0,n)}return t}),s=t.cols.map(e=>f(e,q.STORAGE|q.COPY_DST|q.COPY_SRC)),d=e=>e.kind===`slot`?a[e.index]:s[e.index],p=i.createCommandEncoder(),m=p.beginComputePass(),h=performance.now();for(let n of t.members){u();for(let t of n.steps){let n=e.getPipeline(t.key,t.wgsl,t.entryPoint,r);r!==void 0&&r.dispatches++,m.setPipeline(n);let a=Mt(t.workgroupSize,e.maxElementsPerDispatch),o=Math.ceil(l/a);for(let e=0;e<o;e++){let r=f(12,q.UNIFORM|q.COPY_DST);i.queue.writeBuffer(r,0,new Uint32Array([l,t.seed>>>0,e*a]));let o=i.createBindGroup({layout:n.getBindGroupLayout(0),entries:[{binding:t.uniformsBinding,resource:{buffer:r}},...t.bindings.map(e=>({binding:e.binding,resource:{buffer:d(e.ref)}}))]}),s=Math.min(a,l-e*a);m.setBindGroup(0,o),m.dispatchWorkgroups(Math.ceil(s/t.workgroupSize))}}c!==void 0&&performance.now()-h>c&&(await Bt(),u(),h=performance.now())}m.end();let g=t.written.reduce((e,n)=>e+t.slots[n.slot].bytes,0),_=f(g,q.COPY_DST|q.MAP_READ),v=[],y=0;for(let e of t.written){let n=t.slots[e.slot].bytes;p.copyBufferToBuffer(a[e.slot],0,_,y,n),v.push(y),y+=n}i.queue.submit([p.finish()]),await _.mapAsync(_t.READ,0,g);let b;try{b=_.getMappedRange(0,g).slice(0)}finally{_.unmap()}u();let x=se(o),S=x.attrs.point;for(let e of t.layoutOps)if(e.op===`replace`)S.replace(e.name,e.type,e.tupleSize);else{let e=S.get(`rot`);(!e||e.type!==`f32`||e.tupleSize!==4)&&(e&&S.remove(`rot`),S.add(`rot`,`f32`,4,[0,0,0,1]))}return t.written.forEach((e,t)=>{let n=S.require(e.name),r=l*n.tupleSize;if(n.data instanceof Uint8Array){let e=new Uint32Array(b,v[t],r);for(let t=0;t<r;t++)n.data[t]=e[t]}else{let i=zt[n.type];if(i===void 0)throw Error(`resident run: cannot materialize attribute "${e.name}" of type ${n.type}`);n.data.set(new i(b,v[t],r))}}),r!==void 0&&(r.residentRuns++,r.fusedNodes+=t.members.length,r.readbacksSaved+=t.members.length-1),{geo:x}}catch(e){throw e instanceof x?e:Error(`GpuFieldEvaluator: resident run failed (${t.members.length} fused nodes [${t.members.map(e=>`"${e.id}"`).join(`, `)}], ${l} points): ${e instanceof Error?e.message:String(e)}`,{cause:e})}finally{for(let e of d)a.release(e)}}var Ht=`gpu1`,Ut=268435456,Wt={f32:Float32Array,i32:Int32Array,u32:Uint32Array},Gt={f32:Float32Array,i32:Int32Array,u32:Uint32Array};function Kt(e){let t=e=>e!==void 0&&e!==``?e:`?`;return[Ht,t(e?.vendor),t(e?.architecture),t(e?.device),t(e?.description)].join(`|`)}function qt(e,t){return e!==void 0&&(e.fallbacks[t]=(e.fallbacks[t]??0)+1),null}var Jt=class{cacheSalt;device;kernels=new Map;pipelines=new Map;pool;maxElementsPerDispatch;maxResidentBytes;constructor(e,t={}){if(t.maxElementsPerDispatch!==void 0&&!Number.isFinite(t.maxElementsPerDispatch))throw Error(`GpuFieldEvaluator: maxElementsPerDispatch must be a finite number, got ${t.maxElementsPerDispatch}; leave it unset to use the device maximum`);this.device=e,this.cacheSalt=Kt(t.adapterInfo??e.adapterInfo),this.pool=new bt(e,t.maxPooledBytes??Ut),this.maxElementsPerDispatch=t.maxElementsPerDispatch,this.maxResidentBytes=t.maxResidentBytes??536870912}get pipelineCacheSize(){return this.pipelines.size}get poolStats(){return this.pool.stats}dispose(){this.pool.dispose()}chunkElements(e){let t=jt*e.workgroupSize,n=Math.min(this.maxElementsPerDispatch??t,t);return Math.max(e.workgroupSize,Math.floor(n/e.workgroupSize)*e.workgroupSize)}resolveField(e,t,n){let r=le(e);if(r===void 0)return qt(n,`no-spec`);let i=t.geo.attrs[t.domain],a={},o=[];for(let e of i.names().sort()){let t=i.get(e);t!==void 0&&(a[e]={type:t.type,tupleSize:t.tupleSize},o.push(`${JSON.stringify(e)}:${t.type}x${t.tupleSize}`))}let s=`${e.key.length}#${e.key}|${o.join(`,`)}`,c=this.kernels.get(s);if(c===void 0){try{c=gt(r,{attributes:a})}catch(e){c=e instanceof Error?e:Error(String(e))}this.kernels.set(s,c)}if(c instanceof Error)return qt(n,`compile-error`);if(c.inputs.length+1>8)return qt(n,`too-many-buffers`);let l=i.count;if(l===0)return Promise.resolve({data:new Gt[c.outType](0),tupleSize:c.outTupleSize});let u=this.getPipeline(c.key,c.wgsl,c.entryPoint,n);return n!==void 0&&n.dispatches++,this.dispatch(e,t,c,u,l)}getPipeline(e,t,n,r){let i=this.pipelines.get(e);if(i!==void 0)return r!==void 0&&r.pipelineCacheHits++,i;let a=this.device.createShaderModule({code:t}),o=this.device.createComputePipeline({layout:`auto`,compute:{module:a,entryPoint:n}});return this.pipelines.set(e,o),r!==void 0&&r.pipelinesCompiled++,o}planRun(e,t,n){let r=Rt(e,t,this.maxResidentBytes);return`plan`in r?r.plan:(n!==void 0&&(n.fallbacks[r.reason]=(n.fallbacks[r.reason]??0)+1),null)}executeRun(e,t,n){let r=Pt(e);return r===null?Promise.reject(Error(`GpuFieldEvaluator.executeRun: plan was not produced by this library's planRun; pass the object returned by planRun on the same resolver`)):Vt({device:this.device,pool:this.pool,maxElementsPerDispatch:this.maxElementsPerDispatch,getPipeline:(e,t,n,r)=>this.getPipeline(e,t,n,r)},r,t,n)}async dispatch(e,t,n,r,i){let a=this.device,o=[],s=(e,t)=>{let n=this.pool.acquire(e,t);return o.push(n),n};try{let e=this.chunkElements(n),o=Math.ceil(i/e),c=[],l=t.geo.attrs[t.domain];for(let e of n.inputs){let t=l.require(e.name),n=i*e.tupleSize,r;if(t.data instanceof Uint8Array){let e=new Uint32Array(n);for(let r=0;r<n;r++)e[r]=t.data[r];r=e}else r=t.data.subarray(0,n);let o=s(n*4,q.STORAGE|q.COPY_DST);a.queue.writeBuffer(o,0,r),c.push({binding:e.binding,resource:{buffer:o}})}let u=i*n.outTupleSize*4,d=s(u,q.STORAGE|q.COPY_SRC);c.push({binding:n.bindings.output,resource:{buffer:d}});let f=s(u,q.COPY_DST|q.MAP_READ),p=[];for(let l=0;l<o;l++){let o=s(12,q.UNIFORM|q.COPY_DST);a.queue.writeBuffer(o,0,new Uint32Array([i,t.seed>>>0,l*e])),p.push(a.createBindGroup({layout:r.getBindGroupLayout(0),entries:[{binding:n.bindings.uniforms,resource:{buffer:o}},...c]}))}let m=a.createCommandEncoder(),h=m.beginComputePass();h.setPipeline(r);for(let t=0;t<o;t++){let r=Math.min(e,i-t*e);h.setBindGroup(0,p[t]),h.dispatchWorkgroups(Math.ceil(r/n.workgroupSize))}h.end(),m.copyBufferToBuffer(d,0,f,0,u),a.queue.submit([m.finish()]),await f.mapAsync(_t.READ,0,u);let g;try{g=f.getMappedRange(0,u).slice(0)}finally{f.unmap()}return{data:new Wt[n.outType](g),tupleSize:n.outTupleSize}}catch(n){throw Error(`GpuFieldEvaluator: dispatch failed for field ${e.key} (${i} elements on the ${t.domain} domain): ${n instanceof Error?n.message:String(n)}`,{cause:n})}finally{for(let e of o)this.pool.release(e)}}},Yt=[`cpu`,`gpu-node`,`gpu-fused`],Xt={cpu:`CPU`,"gpu-node":`GPU per-node`,"gpu-fused":`GPU fused`},Zt=8388608,Qt=[1e5,5e5,1e6,2e6],$t=F(`<div class="notice svelte-1yy0qs2"> </div>`),en=F(`<button> </button>`),tn=F(`<option> </option>`),nn=F(`<i class="svelte-1yy0qs2"> </i>`),rn=F(`<div><div class="pl svelte-1yy0qs2"><b class="svelte-1yy0qs2"> </b> <!></div> <div class="pv svelte-1yy0qs2"> </div> <div class="pm svelte-1yy0qs2"> <!></div></div>`),an=F(`<div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">counters from</span><b class="svelte-1yy0qs2"> </b></div>`),on=F(`<!> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">resident runs / fused nodes</span> <b class="svelte-1yy0qs2"> </b></div> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">readbacks saved</span><b class="svelte-1yy0qs2"> </b></div> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">dispatches (member kernels)</span><b class="svelte-1yy0qs2"> </b></div> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">pipelines compiled / cache hits</span> <b class="svelte-1yy0qs2"> </b></div> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">gpu fallbacks</span><b class="svelte-1yy0qs2"> </b></div>`,1),sn=F(`<div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2"> </span> <b class="svelte-1yy0qs2"> </b></div>`),cn=F(`<div class="error svelte-1yy0qs2"> </div>`),ln=F(`<div class="panel svelte-1yy0qs2"><h1 class="svelte-1yy0qs2">08 · gpu fields</h1> <p class="info svelte-1yy0qs2"><code class="svelte-1yy0qs2">setAttribute(wobble) → jitterPoints → transformPoints → setAttribute(tint) →
    setAttribute(psize)</code> over a million-point scatter. All five are fusable node kinds in a
    straight line, so with the plain evaluator the whole chain becomes <b class="svelte-1yy0qs2">one device-resident
    run</b>: columns stay in storage buffers and only the terminal reads back. Compare it against
    the same graph cooked per-node on the same device, and against the CPU — the bit-exact
    reference.</p> <!> <div class="row svelte-1yy0qs2"><span class="svelte-1yy0qs2">cook path</span> <div class="seg svelte-1yy0qs2"></div></div> <label class="row svelte-1yy0qs2"><span class="svelte-1yy0qs2">points</span> <select class="svelte-1yy0qs2"></select></label> <label class="row svelte-1yy0qs2"><span class="svelte-1yy0qs2">seed</span> <input class="num svelte-1yy0qs2" type="number" step="1"/></label> <label class="row svelte-1yy0qs2"><span class="svelte-1yy0qs2">frequency</span> <input type="range" min="0.02" max="0.14" step="0.005" class="svelte-1yy0qs2"/> <em class="svelte-1yy0qs2"> </em></label> <label class="row svelte-1yy0qs2"><span class="svelte-1yy0qs2">resident cap</span> <select class="svelte-1yy0qs2"><option>512 MiB (default)</option><option> </option></select></label> <div class="row svelte-1yy0qs2"><span class="svelte-1yy0qs2">measure</span> <button class="wide svelte-1yy0qs2">cook all paths (cold)</button></div> <div class="row svelte-1yy0qs2"><span class="svelte-1yy0qs2">recook</span> <button class="wide svelte-1yy0qs2">cold</button> <button class="wide svelte-1yy0qs2">warm</button></div> <div class="paths svelte-1yy0qs2"></div> <div class="stats svelte-1yy0qs2"><div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">adapter</span><b class="svelte-1yy0qs2"> </b></div> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">points</span><b class="svelte-1yy0qs2"> </b></div> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">fps</span><b class="svelte-1yy0qs2"> </b></div> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">cook</span><b class="svelte-1yy0qs2"> </b></div> <!> <!> <!></div> <details class="svelte-1yy0qs2"><summary class="svelte-1yy0qs2">tint FieldSpec JSON (what actually cooks)</summary> <pre class="svelte-1yy0qs2"> </pre></details> <p class="note svelte-1yy0qs2">Every wall time is a <b class="svelte-1yy0qs2">cold-cache</b> cook (fresh graph). That is deliberate: the terminal node
    holds one memo slot, and a fused cook stores under a run key while a per-node cook stores under
    a node key — so flipping the path always recooks the chain, by design. <code class="svelte-1yy0qs2">dispatches</code> counts member kernels, not <code class="svelte-1yy0qs2">dispatchWorkgroups</code> calls (a chunked kernel still counts
    once). The three hashes differ (float ops carry documented per-op budgets; hash/random streams
    are bit-exact) but each path is deterministic: recook cold and the same hash comes back. A warm
    recook reports <code class="svelte-1yy0qs2">nodes 0 / 6</code> in ~0 ms and does no device work at all — the fused run
    comes back from its terminal's single memo entry — so the counters above stay the cold ones. The
    fused chain's three constant <code class="svelte-1yy0qs2">transformPoints</code> params each still cost a device column
    and a dispatch, which is why a constant-heavy chain can trail per-node GPU.</p></div>`);function un(e,t){Se(t,!0);let n=ke(t,`bridge`,7),r=ve(be(t.initial));n().publish=e=>{ge(r,e,!0)};function i(e){return e>=1e6?`${e/1e6}M`:`${e/1e3}k`}function a(e){return e===void 0?`–`:`${e.toFixed(1)} ms`}function o(e){let t=Object.entries(e).map(([e,t])=>`${e}×${t}`);return t.length>0?t.join(`, `):`none`}function s(e){let t=D(r).reports.cpu.bestMs,n=D(r).reports[e].bestMs;if(!(e===`cpu`||t===void 0||n===void 0||n<=0))return`×${(t/n).toFixed(1)}`}function c(e){return e===`cpu`||D(r).gpuAvailable}function l(e){e===D(r).path||D(r).cooking||!c(e)||t.host.setPath(e)}let u=ve(be(t.initial.seed));function d(){let e=Math.floor(Number(D(u)));Number.isFinite(e)&&t.host.setSeed(e>>>0)}let f=xe(()=>D(r).reports[D(r).path]),p=xe(()=>D(f).gpu??D(r).reports[`gpu-fused`].gpu??D(r).reports[`gpu-node`].gpu),m=xe(()=>D(f).gpu===void 0?D(r).reports[`gpu-fused`].gpu===void 0?D(r).reports[`gpu-node`].gpu===void 0?void 0:`gpu per-node`:`gpu fused`:void 0),h=Zt/1048576;var g=ln(),_=O(N(g),4),v=e=>{var t=$t(),n=N(t);j(t),k(()=>P(n,`CPU-only: ${(D(r).gpuReason===``?`detecting WebGPU…`:D(r).gpuReason)??``}`)),I(e,t)};M(_,e=>{D(r).gpuAvailable||e(v)});var y=O(_,2),b=O(N(y),2);Ae(b,20,()=>Yt,e=>e,(e,t)=>{var n=en();let i;var a=N(n,!0);j(n),k(e=>{n.disabled=e,i=De(n,1,`svelte-1yy0qs2`,null,i,{active:D(r).path===t}),P(a,Xt[t])},[()=>!c(t)]),A(`click`,n,()=>l(t)),I(e,n)}),j(b),j(y);var x=O(y,2),S=O(N(x),2);Ae(S,20,()=>Qt,e=>e,(e,t)=>{var n=tn(),r=N(n,!0);j(n);var a={};k(e=>{P(r,e),a!==(a=t)&&(n.value=(n.__value=t)??``)},[()=>i(t)]),I(e,n)}),j(S);var C;je(S),j(x);var w=O(x,2),ee=O(N(w),2);we(ee),j(w);var te=O(w,2),T=O(N(te),2);we(T);var ne=O(T,2),re=N(ne,!0);j(ne),j(te);var ie=O(te,2),E=O(N(ie),2),ae=N(E);ae.value=ae.__value=`default`;var oe=O(ae),se=N(oe);j(oe),oe.value=oe.__value=`tight`,j(E);var ce;je(E),j(ie);var le=O(ie,2),ue=O(N(le),2);j(le);var de=O(le,2),fe=O(N(de),2),pe=O(fe,2);j(de);var Ce=O(de,2);Ae(Ce,20,()=>Yt,e=>e,(e,t)=>{var n=rn();let i;var o=N(n),l=N(o),u=N(l,!0);j(l);var d=O(l,2),f=e=>{var n=nn(),r=N(n);j(n),k(e=>P(r,`${e??``} vs CPU`),[()=>s(t)]),I(e,n)},p=xe(()=>s(t)!==void 0);M(d,e=>{D(p)&&e(f)}),j(o);var m=O(o,2),h=N(m);j(m);var g=O(m,2),_=N(g),v=O(_),y=e=>{var n=he();k(e=>P(n,`· warm ${e??``}`),[()=>a(D(r).reports[t].warmMs)]),I(e,n)};M(v,e=>{D(r).reports[t].warmMs!==void 0&&e(y)}),j(g),j(n),k((e,a,o)=>{i=De(n,1,`pathrow svelte-1yy0qs2`,null,i,e),P(u,Xt[t]),P(h,`${a??``} · best ${o??``}`),P(_,`hash ${D(r).reports[t].hash??`–`??``} · nodes ${D(r).reports[t].nodes??`–`??``} `)},[()=>({sel:D(r).path===t,off:!c(t)}),()=>a(D(r).reports[t].lastMs),()=>a(D(r).reports[t].bestMs)]),I(e,n)}),j(Ce);var Me=O(Ce,2),F=N(Me),L=O(N(F)),R=N(L,!0);j(L),j(F);var Ne=O(F,2),z=O(N(Ne)),B=N(z,!0);j(z),j(Ne);var Pe=O(Ne,2),Fe=O(N(Pe)),Ie=N(Fe,!0);j(Fe),j(Pe);var V=O(Pe,2),Le=O(N(V)),Re=N(Le,!0);j(Le),j(V);var ze=O(V,2),Be=e=>{var t=on(),n=ye(t),r=e=>{var t=an(),n=O(N(t)),r=N(n,!0);j(n),j(t),k(()=>P(r,D(m))),I(e,t)};M(n,e=>{D(m)!==void 0&&e(r)});var i=O(n,2),a=O(N(i),2),s=N(a);j(a),j(i);var c=O(i,2),l=O(N(c)),u=N(l,!0);j(l),j(c);var d=O(c,2),f=O(N(d)),h=N(f,!0);j(f),j(d);var g=O(d,2),_=O(N(g),2),v=N(_);j(_),j(g);var y=O(g,2),b=O(N(y)),x=N(b,!0);j(b),j(y),k(e=>{P(s,`${D(p).residentRuns??``} / ${D(p).fusedNodes??``}`),P(u,D(p).readbacksSaved),P(h,D(p).dispatches),P(v,`${D(p).pipelinesCompiled??``} / ${D(p).pipelineCacheHits??``}`),P(x,e)},[()=>o(D(p).fallbacks)]),I(e,t)};M(ze,e=>{D(p)!==void 0&&e(Be)});var Ve=O(ze,2),He=e=>{var t=sn(),n=N(t),i=N(n);j(n);var a=O(n,2),o=N(a);j(a),j(t),k((e,t,n)=>{P(i,`max |cpu−${Xt[D(r).deviation.path]??``}| (${e??``} pts)`),P(o,`${t??``} · ${n??``} range-ULP`)},[()=>D(r).deviation.window.toLocaleString(),()=>D(r).deviation.maxAbs.toExponential(2),()=>D(r).deviation.rangeUlp.toFixed(1)]),I(e,t)};M(Ve,e=>{D(r).deviation!==void 0&&e(He)});var Ue=O(Ve,2),We=e=>{var t=cn(),n=N(t,!0);j(t),k(()=>P(n,D(r).error)),I(e,t)};M(Ue,e=>{D(r).error!==void 0&&e(We)}),j(Me);var Ge=O(Me,2),Ke=O(N(Ge),2),H=N(Ke,!0);j(Ke),j(Ge),_e(2),j(g),k((e,t)=>{C!==(C=D(r).count)&&(S.value=(S.__value=D(r).count)??``,Ee(S,D(r).count)),Te(T,D(r).frequency),P(re,e),E.disabled=!D(r).gpuAvailable,P(se,`${h} MiB — force run-too-large`),ce!==(ce=D(r).residentBudget)&&(E.value=(E.__value=D(r).residentBudget)??``,Ee(E,D(r).residentBudget)),ue.disabled=D(r).cooking,fe.disabled=D(r).cooking,pe.disabled=D(r).cooking,P(R,D(r).adapter),P(B,t),P(Ie,D(r).fps),P(Re,D(r).cooking?`cooking…`:`idle`),P(H,D(r).specJson)},[()=>D(r).frequency.toFixed(3),()=>D(r).points.toLocaleString()]),A(`change`,S,e=>t.host.setCount(Number(e.currentTarget.value))),A(`change`,ee,d),Oe(ee,()=>D(u),e=>ge(u,e)),A(`change`,T,e=>t.host.setFrequency(Number(e.currentTarget.value))),A(`change`,E,e=>t.host.setResidentBudget(e.currentTarget.value)),A(`click`,ue,()=>t.host.measureAll()),A(`click`,fe,()=>t.host.rebuild()),A(`click`,pe,()=>t.host.cookWarm()),I(e,g),me()}Me([`click`,`change`]);function dn(e){return{fn:`clamp`,args:[{fn:`add`,args:[{fn:`add`,args:[{fn:`mul`,args:[{fn:`fbm`,base:`simplexNoise`,opts:{frequency:e,octaves:5,normalized:!0}},.62]},{fn:`mul`,args:[{fn:`worleyNoise`,opts:{frequency:e*2.1,output:`f2-f1`,normalized:!0}},.3]}]},{fn:`mul`,args:[{fn:`randomField`,key:`sparkle`},.08]}]},0,1]}}function fn(e){let t=dn(e);return{fn:`vec`,args:[{fn:`ramp`,args:[t],stops:[[0,.02],[.3,.05],[.55,.1],[.75,.95],[1,1]]},{fn:`ramp`,args:[t],stops:[[0,.03],[.3,.25],[.55,.75],[.75,.7],[1,.97]]},{fn:`ramp`,args:[t],stops:[[0,.1],[.3,.55],[.55,.8],[.75,.25],[1,.9]]}]}}function pn(e){let t=(t,n)=>({fn:`remap`,args:[{fn:`perlinNoise`,opts:{seed:t,frequency:e*.8,offset:n,normalized:!0}},0,1,0,.9]});return{fn:`vec`,args:[t(11,[0,0,0]),t(23,[37,5,-19]),t(47,[-11,61,5])]}}function mn(e){return{fn:`add`,args:[.35,{fn:`add`,args:[{fn:`mul`,args:[{fn:`randomField`,key:`size`},.5]},{fn:`mul`,args:[{fn:`ramp`,args:[{fn:`worleyNoise`,opts:{frequency:e*1.4,output:`f1`,normalized:!0}}],stops:[[0,1],[.4,.35],[1,.05]]},1.6]}]}]}}var hn=30,gn=9,_n=16384,vn=1,yn=1e6,bn=.055,Z=`cpu`,xn=`default`;function Sn(){let e=new b(vn),t=e.add(m,{count:yn,boundsMin:[-30,-9,-30],boundsMax:[hn,gn,hn]}),r=e.add(i,{name:`wobble`,domain:`point`,type:`f32`,tupleSize:3,value:v(pn(bn))}),a=e.add(n,{amount:v({fn:`attribute`,name:`wobble`,tupleSize:3}),seed:7}),o=e.add(ae,{translate:[0,0,0],rotateEuler:[0,14,0],scale:[1,.92,1]}),s=v(fn(bn)),c=e.add(i,{name:`tint`,domain:`point`,type:`f32`,tupleSize:3,value:s}),l=e.add(i,{name:`psize`,domain:`point`,type:`f32`,tupleSize:1,value:v(mn(bn))});return e.connect(t,`out`,r,`in`),e.connect(r,`out`,a,`in`),e.connect(a,`out`,o,`in`),e.connect(o,`out`,c,`in`),e.connect(c,`out`,l,`in`),e.output(l,`out`,`points`),{graph:e,tintNode:c,tintField:s}}var Cn=Sn(),wn,Tn,En,Dn=!1;function On(e){return{cacheSalt:e.cacheSalt,resolveField:(t,n,r)=>e.resolveField(t,n,r),planRun:()=>null,executeRun:(t,n,r)=>e.executeRun(t,n,r)}}async function kn(){let e=navigator.gpu;if(e===void 0)return{error:`navigator.gpu is missing — this browser has no WebGPU`};try{let t=await e.requestAdapter();if(t===null)return{error:`requestAdapter() returned null — no compatible GPU adapter`};let n=t.info,r=await t.requestDevice(),i=r.lost;i!==void 0&&i.then(e=>{Dn=!0,Q.cooking=!1,Q.error=`WebGPU device lost (${e?.reason??`unknown`}: ${e?.message??`no detail`}) — GPU paths are disabled; reload to get a fresh device.`,Q.gpuAvailable=!1,Gn()});let a=n===void 0?{}:{adapterInfo:n};wn=new Jt(r,a),Tn=new Jt(r,{...a,maxResidentBytes:Zt}),En=On(wn);let o=[n?.vendor,n?.architecture,n?.description===``?n?.device:n?.description].filter(e=>typeof e==`string`&&e!==``).join(` · `)||`adapter (no info exposed)`;return console.info(`08-gpu-fields: WebGPU ready — ${o}; cacheSalt=${wn.cacheSalt}`),{label:o}}catch(e){return console.error(`08-gpu-fields: WebGPU init failed, falling back to CPU:`,e),{error:`WebGPU init failed: ${e instanceof Error?e.message:String(e)}`}}}function An(e){if(e!==`cpu`)return e===`gpu-node`?En:xn===`tight`?Tn:wn}function jn(e){return e===`cpu`||wn!==void 0&&!Dn}var{scene:Mn,camera:Nn,renderer:Pn,start:Fn}=pe({cameraPosition:[52,26,52]});function In(){return window.innerHeight/(2*Math.tan(Nn.fov*Math.PI/360))}var Ln=new c({uniforms:{uScale:{value:In()},uPx:{value:Pn.getPixelRatio()}},vertexShader:`
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
    }`,blending:2,depthWrite:!1,transparent:!0}),Rn;function zn(e,t,n){let r=e.pointCount,i=e.attrs.point.require(`P`).data,a=new ce;a.setAttribute(`position`,new ie(i.slice(0,r*3),3)),a.setAttribute(`aTint`,new ie(t.slice(0,r*3),3)),a.setAttribute(`aSize`,new ie(n.slice(0,r),1)),a.computeBoundingSphere(),Rn!==void 0&&(Mn.remove(Rn),Rn.geometry.dispose()),Rn=new te(a,Ln),Mn.add(Rn)}window.addEventListener(`resize`,()=>{Ln.uniforms.uScale.value=In(),Ln.uniforms.uPx.value=Pn.getPixelRatio()});function Bn(e,t){for(let n=0;n<t.length;n++)e^=t[n],e=Math.imul(e,16777619);return e>>>0}function Vn(e,t){let n=2166136261;return n=Bn(n,new Uint32Array(e.buffer,e.byteOffset,e.length)),n=Bn(n,new Uint32Array(t.buffer,t.byteOffset,t.length)),n.toString(16).padStart(8,`0`)}function Hn(e,t,n){let r=Math.min(_n,e.pointCount);if(r===0)return;let i=S(r),o=i.attrs.point.require(`P`).data,s=e.attrs.point.require(`P`).data;o.set(s.subarray(0,r*3));let c=Cn.graph.describe().nodes.find(e=>e.id===Cn.tintNode.id);if(c===void 0)return;let l=a(Cn.tintField,{geo:i,domain:`point`,seed:c.seed}),u=0,d=0;for(let e=0;e<r*3;e++){let n=l.data[e],r=Math.abs(n-t[e]);r>u&&(u=r);let i=Math.abs(n);i>d&&(d=i)}let f=u===0?0:d===0?1/0:u/(2**-23*d);return{maxAbs:u,rangeUlp:f,window:r,path:n}}function Un(){return{cpu:{},"gpu-node":{},"gpu-fused":{}}}var Q={gpuAvailable:!1,gpuReason:``,adapter:`detecting…`,path:Z,count:yn,seed:vn,frequency:bn,residentBudget:xn,cooking:!1,fps:`–`,points:0,reports:Un(),specJson:JSON.stringify(fn(bn),null,2)},Wn={};function Gn(){Wn.publish?.({...Q,reports:{cpu:{...Q.reports.cpu},"gpu-node":{...Q.reports[`gpu-node`]},"gpu-fused":{...Q.reports[`gpu-fused`]}},deviation:Q.deviation&&{...Q.deviation}})}function Kn(){Q.reports=Un(),Q.deviation=void 0}function qn(){return new Promise(e=>{let t=setTimeout(e,250);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(t),e()}))})}async function Jn(e){if(!jn(e.path))return;e.warm||(Cn=Sn()),Z=e.path,Q.path=e.path,Q.cooking=!0,Q.error=void 0,Gn(),await qn();let t=An(e.path),n=performance.now(),r;try{r=await ee(Cn.graph,t===void 0?{budgetMs:14}:{gpu:t,budgetMs:14})}catch(e){console.error(`08-gpu-fields: cook failed:`,e),Q.cooking=!1,Q.error=e instanceof Error?e.message:String(e),Gn();return}let i=performance.now()-n,a=T(r.outputs.points);if(a===void 0){Q.cooking=!1,Q.error=`cook produced no geometry`,Gn();return}let o=a.pointCount,s=a.attrs.point.require(`tint`).data.subarray(0,o*3),c=a.attrs.point.require(`psize`).data.subarray(0,o);zn(a,s,c);let l=Q.reports[e.path];l.nodes=`${r.stats.cooked} / ${r.stats.cached}`,r.stats.cooked>0?(l.lastMs=i,l.bestMs=l.bestMs===void 0?i:Math.min(l.bestMs,i)):l.warmMs=i,l.hash=Vn(s,c),r.stats.gpu!==void 0&&r.stats.cooked>0&&(l.gpu={dispatches:r.stats.gpu.dispatches,pipelinesCompiled:r.stats.gpu.pipelinesCompiled,pipelineCacheHits:r.stats.gpu.pipelineCacheHits,residentRuns:r.stats.gpu.residentRuns,fusedNodes:r.stats.gpu.fusedNodes,readbacksSaved:r.stats.gpu.readbacksSaved,fallbacks:{...r.stats.gpu.fallbacks}}),Q.points=o,e.path!==`cpu`&&r.stats.cooked>0&&(Q.deviation=Hn(a,s,e.path)),Q.cooking=!1,Gn()}var Yn=[],Xn=fe(async()=>{for(;Yn.length>0;){let e=Yn.shift();e!==void 0&&await Jn(e)}});function $(...e){Yn=e,Xn()}Ce(un,{target:(()=>{let e=document.getElementById(`panel`);if(e===null)throw Error(`missing #panel element`);return e})(),props:{bridge:Wn,host:{setPath(e){jn(e)&&(Q.path=e,$({path:e,warm:!1}))},setCount(e){yn=e,Q.count=e,Kn(),$({path:Z,warm:!1})},setSeed(e){vn=e,Q.seed=e,Kn(),$({path:Z,warm:!1})},setFrequency(e){bn=e,Q.frequency=e,Q.specJson=JSON.stringify(fn(e),null,2),Kn(),$({path:Z,warm:!1})},setResidentBudget(e){xn=e,Q.residentBudget=e,Kn(),$({path:Z,warm:!1})},measureAll(){$(...Yt.filter(jn).sort((e,t)=>e===`cpu`?1:t===`cpu`?-1:0).map(e=>({path:e,warm:!1})))},rebuild(){$({path:Z,warm:!1})},cookWarm(){$({path:Z,warm:!0})}},initial:{...Q}}}),kn().then(e=>{`label`in e?(Q.gpuAvailable=!0,Q.adapter=e.label,Z=`gpu-fused`,Q.path=`gpu-fused`):(Q.gpuAvailable=!1,Q.gpuReason=e.error,Q.adapter=`none`),Gn(),$({path:Z,warm:!1})});var Zn=re(e=>{Q.fps=e,Gn()});Fn(()=>Zn());