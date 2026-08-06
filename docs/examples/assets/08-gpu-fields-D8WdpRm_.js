import{$t as e,Ct as t,G as n,Gt as r,H as i,Ht as a,Jt as o,Kt as s,N as c,Qt as l,St as u,Tt as d,Ut as f,Wt as p,X as m,Xt as h,Yt as g,_t as _,at as v,bt as y,ct as b,dt as x,en as S,gt as C,ht as w,it as ee,k as te,lt as ne,mt as re,n as ie,o as ae,pt as T,q as oe,qt as se,rt as ce,s as le,st as ue,wt as de,yt as fe}from"./OrbitControls-BM2k1NjQ.js";import{t as pe}from"./recook-DLZ34zXJ.js";import{t as me}from"./scene-By2BIpYn.js";import{B as he,C as ge,D as E,F as _e,H as ve,I as ye,M as be,N as D,O,P as xe,R as Se,T as k,U as A,V as Ce,_ as we,a as Te,c as Ee,d as De,f as Oe,g as j,i as ke,j as M,n as Ae,p as je,u as Me,v as N,w as Ne,x as P,y as F}from"./disclose-version-CMA9i9Ee.js";var I=class extends Error{constructor(e){super(e),this.name=`GpuCompileError`}};function L(e,t){let n=Math.fround(e);if(!Number.isFinite(n))throw new I(`${t}: value ${e} is not representable as a finite f32 (WGSL kernels compute in f32; keep magnitudes within ~3.4e38)`);return Object.is(n,-0)?`-0f`:`${String(n)}f`}function Pe(e){return`${e>>>0}u`}function R(e){return`0x${(e>>>0).toString(16).padStart(8,`0`)}u`}var z=R,Fe=L(34028234663852886e22,`internal f32 max`);function Ie(e,t){let n=z(e);for(let e of t)n=`pcg_hash_mix(${n}, ${e})`;return`pcg_hash_finalize(${n})`}function Le(){let e=[];for(let n=0;n<12;n++){let r=e=>L(t[n*3+e],`internal GRAD3`);e.push(`  vec3<f32>(${r(0)}, ${r(1)}, ${r(2)}),`)}return`var<private> PCG_GRAD3: array<vec3<f32>, 12> = array<vec3<f32>, 12>(
${e.join(`
`)}
);`}var B=e=>t=>L(t,e),Re=new Map([[`PCG_GRAD3`,{deps:[],text:Le()}],[`pcg_hash_mix`,{deps:[],text:`fn pcg_hash_mix(h_in: u32, value: u32) -> u32 {
  var k = value * ${z(se)};
  k = (k << 15u) | (k >> 17u);
  k = k * ${z(o)};
  var h = h_in ^ k;
  h = (h << 13u) | (h >> 19u);
  h = h * 5u + ${z(g)};
  return h;
}`}],[`pcg_hash_finalize`,{deps:[],text:`fn pcg_hash_finalize(h_in: u32) -> u32 {
  var h = h_in ^ (h_in >> 16u);
  h = h * ${z(p)};
  h = h ^ (h >> 13u);
  h = h * ${z(r)};
  h = h ^ (h >> 16u);
  return h;
}`}],[`pcg_hash3`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash3(a: u32, b: u32, c: u32) -> u32 {
  return ${Ie(l(3),[`a`,`b`,`c`])};
}`}],[`pcg_hash4`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash4(a: u32, b: u32, c: u32, d: u32) -> u32 {
  return ${Ie(l(4),[`a`,`b`,`c`,`d`])};
}`}],[`pcg_hash5`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash5(a: u32, b: u32, c: u32, d: u32, e: u32) -> u32 {
  return ${Ie(l(5),[`a`,`b`,`c`,`d`,`e`])};
}`}],[`pcg_hash_float`,{deps:[],text:`fn pcg_hash_float(h: u32) -> f32 {
  return f32(h >> 8u) * ${L(s,`internal hashFloat scale`)};
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
  return ${B(`internal PERLIN_SCALE`)(y)} * pcg_mix(
    pcg_mix(pcg_mix(n000, n100, u), pcg_mix(n010, n110, u), v),
    pcg_mix(pcg_mix(n001, n101, u), pcg_mix(n011, n111, u), v),
    w);
}`}],[`pcg_simplex_corner`,{deps:[`pcg_hash4`,`PCG_GRAD3`],text:`fn pcg_simplex_corner(seed: u32, i: i32, j: i32, k: i32, x: f32, y: f32, z: f32) -> f32 {
  let t = ${B(`internal simplex R2`)(C)} - x * x - y * y - z * z;
  if (t <= 0f) {
    return 0f;
  }
  let g = pcg_hash4(seed, bitcast<u32>(i), bitcast<u32>(j), bitcast<u32>(k)) % 12u;
  let t2 = t * t;
  return t2 * t2 * dot(PCG_GRAD3[g], vec3<f32>(x, y, z));
}`}],[`pcg_simplex_noise`,{deps:[`pcg_simplex_corner`],text:`fn pcg_simplex_noise(seed: u32, p: vec3<f32>) -> f32 {
  let s = (p.x + p.y + p.z) * ${B(`internal simplex F3`)(re)};
  let i = i32(floor(p.x + s));
  let j = i32(floor(p.y + s));
  let k = i32(floor(p.z + s));
  let t = f32(i + j + k) * ${B(`internal simplex G3`)(w)};
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
  let x1 = x0 - f32(i1) + ${B(`internal simplex G3`)(w)};
  let y1 = y0 - f32(j1) + ${B(`internal simplex G3`)(w)};
  let z1 = z0 - f32(k1) + ${B(`internal simplex G3`)(w)};
  let x2 = x0 - f32(i2) + ${B(`internal simplex 2*G3`)(2*w)};
  let y2 = y0 - f32(j2) + ${B(`internal simplex 2*G3`)(2*w)};
  let z2 = z0 - f32(k2) + ${B(`internal simplex 2*G3`)(2*w)};
  let x3 = x0 - 1f + ${B(`internal simplex 3*G3`)(3*w)};
  let y3 = y0 - 1f + ${B(`internal simplex 3*G3`)(3*w)};
  let z3 = z0 - 1f + ${B(`internal simplex 3*G3`)(3*w)};
  return ${B(`internal SIMPLEX_SCALE`)(72)} * (pcg_simplex_corner(seed, i, j, k, x0, y0, z0)
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
  var f1 = ${Fe};
  var f2 = ${Fe};
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
}`}]]);function ze(e){let t=new Set,n=e=>{if(t.has(e))return;let r=Re.get(e);if(!r)throw Error(`internal: unknown WGSL library item "${e}"`);t.add(e);for(let e of r.deps)n(e)};for(let t of e)n(t);let r=[];for(let[e,n]of Re)t.has(e)&&r.push(n.text);return r}var Be=64,Ve=`wgsl2`,He=[`x`,`y`,`z`,`w`];function Ue(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}function We(e,t,n){return new I(`${e}: ${t} has tupleSize ${n}, but GPU kernels support tuple sizes 1 to 4; evaluate this field on the CPU instead, or split it into components`)}function Ge(e,t,n){let r=1;for(let i of n)if(i!==1){if(r!==1&&r!==i)throw new I(`${t}: ${e}: incompatible tuple sizes ${r} and ${i}`);r=i}return r}var Ke=class{layout;lines=[];libRoots=new Set;usesSeed=!1;valueNumbers=new Map;bindings=new Map;helpers=new Map;helperTexts=[];helperCounters=new Map;varCounter=0;constructor(e,t){this.layout=e,t.forEach((t,n)=>{this.bindings.set(t,{name:t,varName:`in${n}`,binding:n+1,attr:e.attributes[t]})})}emit(e,t){let n=this.valueNumbers.get(e);if(n)return n;let r={ref:`v${this.varCounter++}`,size:t};return this.lines.push(`  let ${r.ref} = ${e};`),this.valueNumbers.set(e,r),r}binding(e){let t=this.bindings.get(e);if(!t)throw Error(`internal: attribute ${JSON.stringify(e)} was not pre-bound`);return t}boundAttrs(){return[...this.bindings.values()]}helper(e,t){let n=this.helpers.get(t);if(n)return n;let r=this.helperCounters.get(e)??0;this.helperCounters.set(e,r+1);let i=`pcg_${e}_${r}`;return this.helpers.set(t,i),this.helperTexts.push(t.replaceAll(`@NAME@`,i)),i}helperBlocks(){return this.helperTexts}};function qe(e,t){return e.size===t?e.ref:`vec${t}<f32>(${e.ref})`}function V(e){return e===1?`0f`:`vec${e}<f32>(0f)`}function Je(e){return e===1?`1f`:`vec${e}<f32>(1f)`}function Ye(e){let t=Object.keys(e.attributes).sort();return t.length===0?`the layout declares no attributes`:`layout attributes: ${t.map(e=>JSON.stringify(e)).join(`, `)}`}function Xe(e,t,n,r,i){let a=e.layout.attributes;if(!Object.hasOwn(a,n))throw new I(`${t}: ${i}attribute ${JSON.stringify(n)} is not in the kernel layout; ${Ye(e.layout)}`);let o=a[n];if(o.type===`string`)throw new I(`${t}: ${i}attribute ${JSON.stringify(n)} has type "string"; string attributes cannot be read as fields and are CPU-only — use a numeric or bool attribute`);if(r!==void 0&&o.tupleSize!==r)throw new I(`${t}: ${i}attribute ${JSON.stringify(n)}: expected tupleSize ${r}, got ${o.tupleSize} in the kernel layout`);if(o.tupleSize>4)throw We(t,`${i}attribute ${JSON.stringify(n)}`,o.tupleSize);return o}function Ze(e,t,n,r,i){let a=Xe(e,t,n,r,i),o=e.binding(n),s=a.tupleSize,c=e=>a.type===`f32`?e:`f32(${e})`;if(s===1)return e.emit(c(`${o.varName}[i]`),1);let l=[];for(let e=0;e<s;e++)l.push(c(`${o.varName}[${Qe(s,e)}]`));return e.emit(`vec${s}<f32>(${l.join(`, `)})`,s)}function Qe(e,t){return e===1?`i`:t===0?`i * ${e}u`:`i * ${e}u + ${t}u`}var H=new Map;function $e(){return[...H.keys()].sort()}function et(e,t,n){let r=String(e.fn),i=H.get(r);if(!i)throw new I(`${t}: field fn "${r}" is not supported by the WGSL compiler; supported fns: ${$e().join(`, `)}`);return i(e,t,n)}function U(e,t,n){return typeof e==`number`?n.emit(L(e,t),1):Array.isArray(e)?tt(e,t,n):et(e,t,n)}function tt(e,t,n){let r=e.length;if(r>4)throw We(t,`constant`,r);if(r===1)return n.emit(L(e[0],t),1);let i=e.map(e=>L(e,t));return n.emit(`vec${r}<f32>(${i.join(`, `)})`,r)}function W(e){return e.args}H.set(`constant`,(e,t,n)=>{let r=e.value;return typeof r==`number`?n.emit(L(r,`${t}.value`),1):tt(r,`${t}.value`,n)}),H.set(`attribute`,(e,t,n)=>{let r=e.name,i=e.tupleSize;return Ze(n,t,r,i,``)}),H.set(`position`,(e,t,n)=>Ze(n,t,`P`,3,`position reads `)),H.set(`index`,(e,t,n)=>n.emit(`f32(i)`,1)),H.set(`randomField`,(t,n,r)=>{let i=t.key,a=typeof i==`string`?e(i):(i??0)>>>0;return r.usesSeed=!0,r.libRoots.add(`pcg_hash3`),r.libRoots.add(`pcg_hash_float`),r.emit(`pcg_hash_float(pcg_hash3(params.seed, ${R(a)}, i))`,1)});function G(e,t,n){H.set(e,(r,i,a)=>{let o=W(r),s=[];for(let e=0;e<t;e++)s.push(U(o[e],`${i}.args[${e}]`,a));let c=Ge(e,i,s.map(e=>e.size)),l=s.map(e=>qe(e,c));return a.emit(n(l,c),c)})}G(`add`,2,e=>`${e[0]} + ${e[1]}`),G(`sub`,2,e=>`${e[0]} - ${e[1]}`),G(`mul`,2,e=>`${e[0]} * ${e[1]}`),G(`div`,2,e=>`${e[0]} / ${e[1]}`),G(`min`,2,e=>`min(${e[0]}, ${e[1]})`),G(`max`,2,e=>`max(${e[0]}, ${e[1]})`),G(`abs`,1,e=>`abs(${e[0]})`),G(`floor`,1,e=>`floor(${e[0]})`),G(`sin`,1,e=>`sin(${e[0]})`),G(`cos`,1,e=>`cos(${e[0]})`),G(`tan`,1,e=>`tan(${e[0]})`),G(`asin`,1,e=>`asin(${e[0]})`),G(`acos`,1,e=>`acos(${e[0]})`),G(`atan`,1,e=>`atan(${e[0]})`),G(`atan2`,2,e=>`atan2(${e[0]}, ${e[1]})`),G(`clamp`,3,e=>`clamp(${e[0]}, ${e[1]}, ${e[2]})`),G(`lerp`,3,e=>`${e[0]} + (${e[1]} - ${e[0]}) * ${e[2]}`),G(`select`,3,(e,t)=>`select(${e[2]}, ${e[1]}, ${e[0]} != ${V(t)})`),G(`lt`,2,(e,t)=>`select(${V(t)}, ${Je(t)}, ${e[0]} < ${e[1]})`),G(`le`,2,(e,t)=>`select(${V(t)}, ${Je(t)}, ${e[0]} <= ${e[1]})`),G(`gt`,2,(e,t)=>`select(${V(t)}, ${Je(t)}, ${e[0]} > ${e[1]})`),G(`ge`,2,(e,t)=>`select(${V(t)}, ${Je(t)}, ${e[0]} >= ${e[1]})`),G(`eq`,2,(e,t)=>`select(${V(t)}, ${Je(t)}, ${e[0]} == ${e[1]})`),H.set(`remap`,(e,t,n)=>{let r=W(e).map((e,r)=>U(e,`${t}.args[${r}]`,n)),i=Ge(`remap`,t,r.map(e=>e.size)),[a,o,s,c,l]=r.map(e=>qe(e,i)),u=n.emit(`${s} - ${o}`,i),d=V(i),f=n.emit(`select(${u.ref}, ${Je(i)}, ${u.ref} == ${d})`,i);return n.emit(`select(${c} + ((${a} - ${o}) / ${f.ref}) * (${l} - ${c}), ${c}, ${u.ref} == ${d})`,i)}),H.set(`dot`,(e,t,n)=>{let r=W(e),i=U(r[0],`${t}.args[0]`,n),a=U(r[1],`${t}.args[1]`,n),o=Ge(`dot`,t,[i.size,a.size]);return o===1?n.emit(`${i.ref} * ${a.ref}`,1):n.emit(`dot(${qe(i,o)}, ${qe(a,o)})`,1)}),H.set(`length`,(e,t,n)=>{let r=U(W(e)[0],`${t}.args[0]`,n);if(r.size===1)return n.emit(`abs(${r.ref})`,1);let i=n.emit(`dot(${r.ref}, ${r.ref})`,1);return n.emit(`sqrt(${i.ref})`,1)}),H.set(`normalize`,(e,t,n)=>{let r=U(W(e)[0],`${t}.args[0]`,n),i=r.size===1?n.emit(`${r.ref} * ${r.ref}`,1):n.emit(`dot(${r.ref}, ${r.ref})`,1),a=n.emit(`select(0f, 1f / sqrt(${i.ref}), ${i.ref} > 0f)`,1);return n.emit(`${r.ref} * ${a.ref}`,r.size)}),H.set(`vec`,(e,t,n)=>{let r=W(e).map((e,r)=>U(e,`${t}.args[${r}]`,n)),i=r.reduce((e,t)=>e+t.size,0);if(i>4)throw We(t,`vec result`,i);return r.length===1?r[0]:n.emit(`vec${i}<f32>(${r.map(e=>e.ref).join(`, `)})`,i)}),H.set(`component`,(e,t,n)=>{let r=U(W(e)[0],`${t}.args[0]`,n),i=e.index;if(i>=r.size)throw new I(`${t}: component: index ${i} out of range for tupleSize ${r.size}`);return r.size===1?r:n.emit(`${r.ref}.${He[i]}`,1)}),H.set(`ramp`,(e,t,n)=>{let r=U(W(e)[0],`${t}.args[0]`,n);if(r.size!==1)throw new I(`${t}: ramp: input must be scalar, got tupleSize ${r.size}`);let i=e.stops,a=n.helper(`ramp`,nt(i,`${t}.stops`));return n.emit(`${a}(${r.ref})`,1)});function nt(e,t){let n=e=>L(e,t),r=e.length-1,i=[];i.push(`fn @NAME@(t: f32) -> f32 {`),i.push(`  if (t <= ${n(e[0][0])}) {`),i.push(`    return ${n(e[0][1])};`),i.push(`  }`),i.push(`  if (t >= ${n(e[r][0])}) {`),i.push(`    return ${n(e[r][1])};`),i.push(`  }`);let a=t=>{let r=e[t-1][0],i=e[t-1][1],a=e[t][0]-r,o=e[t][1]-i;return`${n(i)} + ${n(o)} * ((t - ${n(r)}) / ${n(a)})`};for(let t=1;t<r;t++)i.push(`  if (t <= ${n(e[t][0])}) {`),i.push(`    return ${a(t)};`),i.push(`  }`);return r>=1?i.push(`  return ${a(r)};`):i.push(`  return t;`),i.push(`}`),i.join(`
`)}var rt={valueNoise:u,perlinNoise:fe,simplexNoise:_,worleyNoise:T},it={valueNoise:`pcg_value_noise`,perlinNoise:`pcg_perlin_noise`,simplexNoise:`pcg_simplex_noise`};function at(e){return e.opts??{}}function ot(e,t,n,r){let i=at(t),a=i.position===void 0?n:`${n}.opts.position`,o=i.position===void 0?Ze(r,n,`P`,3,`${e} position reads `):U(i.position,a,r);if(o.size!==3)throw new I(`${a}: ${e}: position field must have tupleSize 3, got ${o.size}`);let s=L(i.frequency??1,`${n}.opts.frequency`),[c,l,u]=i.offset??[0,0,0],d=`vec3<f32>(${L(c,`${n}.opts.offset`)}, ${L(l,`${n}.opts.offset`)}, ${L(u,`${n}.opts.offset`)})`;return r.emit(`${o.ref} * ${s} + ${d}`,3)}function st(e,t){return d(rt[e],(t??0)>>>0)}function ct(e,t,n,r){let[i,a]=n,o=a-i;return e.emit(`(${t.ref} - ${L(i,r)}) / ${L(o,r)}`,1)}for(let e of[`valueNoise`,`perlinNoise`,`simplexNoise`])H.set(e,(t,n,r)=>{let i=at(t),a=ot(e,t,n,r);r.libRoots.add(it[e]);let o=r.emit(`${it[e]}(${R(st(e,i.seed))}, ${a.ref})`,1);return i.normalized===!0?ct(r,o,de[e],`${n}.opts.normalized`):o});H.set(`worleyNoise`,(e,t,n)=>{let r=at(e),i=r.output??`f1`,a=r.exact===!0,o=ot(`worleyNoise`,e,t,n);n.libRoots.add(`pcg_worley`);let s=i!==`f1`,c=n.emit(`pcg_worley(${R(st(`worleyNoise`,r.seed))}, ${o.ref}, ${a}, ${s})`,2),l=i===`f1`?n.emit(`${c.ref}.x`,1):i===`f2`?n.emit(`${c.ref}.y`,1):n.emit(`${c.ref}.y - ${c.ref}.x`,1);return r.normalized===!0?ct(n,l,de.worleyNoise[i],`${t}.opts.normalized`):l});function lt(e){return e===`worleyNoise`?de.worleyNoise.f1:de[e]}function ut(e,t,n){return e===`worleyNoise`?`pcg_worley(${t}, ${n}, false, false).x`:`${it[e]}(${t}, ${n})`}H.set(`fbm`,(e,t,n)=>{let r=e.base,i=at(e),a=i.octaves??4,o=i.lacunarity??2,s=i.gain??.5,c=i.seed??0,l=i.frequency??1,[u,d,f]=i.offset??[0,0,0],p=i.position===void 0?t:`${t}.opts.position`,m=i.position===void 0?Ze(n,t,`P`,3,`fbm position reads `):U(i.position,p,n);if(m.size!==3)throw new I(`${p}: fbm: position field must have tupleSize 3, got ${m.size}`);let g=lt(r),_=[],v=[],y=[],b=1,x=l,S=0,C=0;for(let e=0;e<a;e++)_.push(R(st(r,h(c,e)))),v.push(L(x,`${t}.opts.frequency`)),y.push(L(b,`${t}.opts.gain`)),S+=b>=0?b*g[0]:b*g[1],C+=b>=0?b*g[1]:b*g[0],b*=s,x*=o;n.libRoots.add(r===`worleyNoise`?`pcg_worley`:it[r]);let w=`vec3<f32>(${L(u,`${t}.opts.offset`)}, ${L(d,`${t}.opts.offset`)}, ${L(f,`${t}.opts.offset`)})`,ee=`fn @NAME@(p: vec3<f32>) -> f32 {
  var seeds = array<u32, ${a}>(${_.join(`, `)});
  var freqs = array<f32, ${a}>(${v.join(`, `)});
  var amps = array<f32, ${a}>(${y.join(`, `)});
  var sum = 0f;
  for (var o = 0u; o < ${Pe(a)}; o++) {
    sum = sum + ${ut(r,`seeds[o]`,`p * freqs[o] + `+w)} * amps[o];
  }
  return sum;
}`,te=n.helper(`fbm`,ee),ne=n.emit(`${te}(${m.ref})`,1);if(i.normalized!==!0)return ne;if(!(C>S))throw new I(`${t}: fbm: normalized: true needs a non-degenerate output range, got [${S}, ${C}] for this octaves/gain configuration`);return ct(n,ne,[S,C],`${t}.opts.normalized`)});var dt=new Set([`valueNoise`,`perlinNoise`,`simplexNoise`,`worleyNoise`,`fbm`]);function ft(e,t){if(!Ue(e))return;let n=e.fn;if(n===`attribute`){typeof e.name==`string`&&t.add(e.name);return}if(n===`position`){t.add(`P`);return}if(typeof n==`string`&&dt.has(n)){let n=e.opts;Ue(n)&&n.position!==void 0?ft(n.position,t):t.add(`P`);return}let r=e.args;if(Array.isArray(r))for(let e of r)ft(e,t)}var pt=new Set([`f32`,`i32`,`u32`,`bool`,`string`]);function mt(e){if(!Ue(e)||!Ue(e.attributes))throw new I(`compileFieldSpec: layout must be { attributes: { name: { type, tupleSize } } }`);for(let[t,n]of Object.entries(e.attributes)){if(!Ue(n)||!pt.has(n.type))throw new I(`kernel layout attribute ${JSON.stringify(t)}: unknown type ${JSON.stringify(n?.type)}; valid types: "f32", "i32", "u32", "bool" ("string" is accepted but CPU-only)`);let e=n.tupleSize;if(typeof e!=`number`||!Number.isInteger(e)||e<1)throw new I(`kernel layout attribute ${JSON.stringify(t)}: tupleSize must be a positive integer, got ${String(e)}`)}}function ht(e){return typeof e==`number`?{fn:`constant`,value:e}:Array.isArray(e)?{fn:`constant`,value:[...e]}:e}function gt(e){return e.type===`bool`?`u32`:e.type}function _t(e,t){mt(t);let n=ht(e),r=v(n),i=new Set;ft(n,i);let a=new Ke(t,[...i].filter(e=>Object.hasOwn(t.attributes,e)&&t.attributes[e].type!==`string`).sort()),o=`f32`,s=0,c=[],l=e=>{if(s=e.size,e.size===1)c.push(`  outBuf[i] = ${e.ref};`);else for(let t=0;t<e.size;t++)c.push(`  outBuf[${Qe(e.size,t)}] = ${e.ref}.${He[t]};`)},u=n.fn===`attribute`?n.name:n.fn===`position`?`P`:void 0;if(n.fn===`index`)o=`u32`,s=1,c.push(`  outBuf[i] = i;`);else if(u!==void 0){let e=Xe(a,`$`,u,n.fn===`position`?3:n.tupleSize,n.fn===`position`?`position reads `:``);if(e.type===`i32`||e.type===`u32`){o=e.type,s=e.tupleSize;let t=a.binding(u);for(let n=0;n<e.tupleSize;n++)c.push(`  outBuf[${Qe(e.tupleSize,n)}] = ${t.varName}[${Qe(e.tupleSize,n)}];`)}else l(et(n,`$`,a))}else l(et(n,`$`,a));let d=a.boundAttrs(),f=d.map(e=>({name:e.name,type:gt(e.attr),tupleSize:e.attr.tupleSize,binding:e.binding})),p=d.length+1,m=[`@group(0) @binding(0) var<uniform> params: PcgParams;`];for(let e of d)m.push(`@group(0) @binding(${e.binding}) var<storage, read> ${e.varName}: array<${gt(e.attr)}>; // attribute ${JSON.stringify(e.name)}: ${e.attr.type} tupleSize ${e.attr.tupleSize}`);m.push(`@group(0) @binding(${p}) var<storage, read_write> outBuf: array<${o}>;`);let h=[`// Generated by pcg-ts compileFieldSpec (WGSL field kernel).
// Dispatch: 1D, chunked; each chunk runs ceil(chunkElements / ${Be}) workgroups of ${Be}
// with element index i = chunkOffset + gid.x; one invocation per element.

struct PcgParams {
  count: u32,
  seed: u32,
  chunkOffset: u32,
}

${m.join(`
`)}`,...ze(a.libRoots),...a.helperBlocks(),`@compute @workgroup_size(${Be})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x + params.chunkOffset;
  if (i >= params.count) {
    return;
  }
${[...a.lines,...c].join(`
`)}
}`],g=d.map(e=>`${JSON.stringify(e.name)}:${e.attr.type}x${e.attr.tupleSize}`).join(`,`);return{wgsl:`${h.join(`

`)}\n`,entryPoint:`main`,workgroupSize:Be,outTupleSize:s,outType:o,inputs:f,bindings:{uniforms:0,output:p},usesSeed:a.usesSeed,key:`${Ve}|spec=${r.key}|layout=[${g}]`}}var K={MAP_READ:1,COPY_SRC:4,COPY_DST:8,UNIFORM:64,STORAGE:128},vt={READ:1},yt=256;function bt(e){let t=yt;for(;t<e;)t*=2;return t}var xt=class{device;maxPooledBytes;free=new Map;meta=new Map;idleBytes=0;idleCount=0;created=0;reused=0;destroyed=0;constructor(e,t){this.device=e,this.maxPooledBytes=t}acquire(e,t){let n=bt(e),r=`${t}|${n}`,i=this.free.get(r)?.pop();if(i!==void 0)return this.idleBytes-=n,this.idleCount--,this.reused++,i;let a=this.device.createBuffer({size:n,usage:t});return this.meta.set(a,{key:r,bytes:n}),this.created++,a}release(e){let t=this.meta.get(e);if(t===void 0)throw Error(`BufferPool.release: buffer was not acquired from this pool`);if(this.idleBytes+t.bytes>this.maxPooledBytes){this.meta.delete(e),e.destroy(),this.destroyed++;return}let n=this.free.get(t.key);n===void 0&&(n=[],this.free.set(t.key,n)),n.push(e),this.idleBytes+=t.bytes,this.idleCount++}get stats(){return{buffersCreated:this.created,buffersReused:this.reused,buffersDestroyed:this.destroyed,pooledBuffers:this.idleCount,pooledBytes:this.idleBytes}}dispose(){for(let e of this.free.values())for(let t of e)this.meta.delete(t),t.destroy(),this.destroyed++;this.free.clear(),this.idleBytes=0,this.idleCount=0}},St=`apply2`;function Ct(e){return e===0?12:16+e*16}var wt=[`x`,`y`,`z`,`w`];function q(e,t,n){if(t.kind===`const`)return Et(t,n);let r=Dt(e,t,n);return t.type===`f32`?r:`f32(${r})`}function Tt(e,t,n){return t.kind===`const`?Et(t,n):Dt(e,t,n)}function Et(e,t){let n=e.tupleSize===1?0:t;if(n>=4)throw Error(`apply codegen: constant slot ${e.slot} has no component ${n} (a uniform slot holds 4 f32 components)`);return`params.consts[${e.slot}].${wt[n]}`}function Dt(e,t,n){return t.tupleSize===1?`${e}[i]`:n===0?`${e}[i * ${t.tupleSize}u]`:`${e}[i * ${t.tupleSize}u + ${n}u]`}function Ot(e,t,n){return t===1?`${e}[i]`:n===0?`${e}[i * ${t}u]`:`${e}[i * ${t}u + ${n}u]`}var kt=class{items=[];add(e,t,n,r){return this.items.push({role:e,access:t,elem:n,comment:r}),`b${this.items.length}`}};function At(e){let t=0;for(let n of e)if(n.kind===`const`){if(n.slot<0||n.slot>=4)throw Error(`apply codegen: constant slot ${n.slot} is out of range; an apply kernel carries at most 4 uniform constant slots (raise MAX_APPLY_CONST_SLOTS in applyKernels.ts if a new node kind needs more)`);t=Math.max(t,n.slot+1)}return t}function jt(e,t,n,r,i){let a=[`@group(0) @binding(0) var<uniform> params: PcgParams;`],o=[];return n.forEach((e,t)=>{let n=t+1,r=e.access===`read`?`read`:`read_write`;a.push(`@group(0) @binding(${n}) var<storage, ${r}> b${n}: array<${e.elem}>; // ${e.comment}`),o.push({binding:n,role:e.role,access:e.access})}),{wgsl:`// Generated by pcg-ts resident-run apply codegen.
// Dispatch: 1D, chunked; element index i = chunkOffset + gid.x, one
// invocation per element; only element i's slots are accessed.

struct PcgParams {
  count: u32,
  seed: u32,
  chunkOffset: u32,${t===0?``:`
  _pad0: u32,
  consts: array<vec4<f32>, ${t}>,`}
}

${a.join(`
`)}

${r.length>0?`${r.join(`

`)}\n\n`:``}@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x + params.chunkOffset;
  if (i >= params.count) {
    return;
  }
${i}
}
`,entryPoint:`main`,workgroupSize:64,bindings:o,constSlots:t,uniformBytes:Ct(t),key:`${St}|${e}`}}var J=e=>e.kind===`column`?`${e.type}x${e.tupleSize}`:`constx${e.tupleSize}@${e.slot}`;function Mt(e,t,n){let r=e.kind===`const`?`f32`:e.type,i=t===`f32`&&e.kind===`column`&&e.type===`f32`,a=i?`u32`:r,o=t===`bool`||i?`u32`:t,s=new kt,c=e.kind===`column`?s.add(`value`,`read`,a,`value column ${J(e)}`):``,l=e.kind===`column`?{...e,type:a}:e,u=s.add(`target`,`read_write`,o,`target attribute ${t} tupleSize ${n}`),d=(e,n)=>{switch(t){case`f32`:return i?e:n;case`i32`:return r===`f32`?`i32(${e})`:r===`i32`?e:`bitcast<i32>(${e})`;case`u32`:return r===`f32`?`u32(${e})`:r===`u32`?e:`bitcast<u32>(${e})`;default:return`select(0u, 1u, ${e} != ${r===`f32`?`0f`:r===`i32`?`0i`:`0u`})`}},f=[];for(let e=0;e<n;e++){let t=Tt(c,l,e);f.push(`  ${Ot(u,n,e)} = ${d(t,q(c,l,e))};`)}return jt(`setAttribute|val=${J(e)}|out=${t}x${n}`,At([e]),s.items,[],f.join(`
`))}var Nt={euler:`fn pcg_quat_from_euler_deg(r: vec3<f32>) -> vec4<f32> {
  let h = r * ${L(Math.PI/360,`internal PI/360`)};
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
}`};function Pt(e,t,n,r,i){let a=new kt,o=e.kind===`column`?a.add(`translate`,`read`,e.type,`translate column ${J(e)}`):``,s=t.kind===`column`?a.add(`rotateEuler`,`read`,t.type,`rotateEuler column ${J(t)}`):``,c=n.kind===`column`?a.add(`scale`,`read`,n.type,`scale column ${J(n)}`):``,l=a.add(`P`,`read_write`,`f32`,`attribute P: f32 tupleSize 3`),u=r?a.add(`rot`,`read_write`,`f32`,`attribute rot: f32 tupleSize 4`):``,d=i?a.add(`scaleAttr`,`read_write`,`f32`,`attribute scale: f32 tupleSize 3`):``,f=[];return f.push(`  let s = vec3<f32>(${[0,1,2].map(e=>q(c,n,e)).join(`, `)});`),f.push(`  let q = pcg_quat_from_euler_deg(vec3<f32>(${[0,1,2].map(e=>q(s,t,e)).join(`, `)}));`),f.push(`  let v = pcg_rotate_vec(q, vec3<f32>(${l}[i * 3u] * s.x, ${l}[i * 3u + 1u] * s.y, ${l}[i * 3u + 2u] * s.z));`),f.push(`  ${l}[i * 3u] = v.x + ${q(o,e,0)};`),f.push(`  ${l}[i * 3u + 1u] = v.y + ${q(o,e,1)};`),f.push(`  ${l}[i * 3u + 2u] = v.z + ${q(o,e,2)};`),r&&(f.push(`  let q2 = pcg_quat_mul(q, vec4<f32>(${u}[i * 4u], ${u}[i * 4u + 1u], ${u}[i * 4u + 2u], ${u}[i * 4u + 3u]));`),f.push(`  ${u}[i * 4u] = q2.x;`),f.push(`  ${u}[i * 4u + 1u] = q2.y;`),f.push(`  ${u}[i * 4u + 2u] = q2.z;`),f.push(`  ${u}[i * 4u + 3u] = q2.w;`)),i&&(f.push(`  ${d}[i * 3u] = ${d}[i * 3u] * s.x;`),f.push(`  ${d}[i * 3u + 1u] = ${d}[i * 3u + 1u] * s.y;`),f.push(`  ${d}[i * 3u + 2u] = ${d}[i * 3u + 2u] * s.z;`)),jt(`transformPoints|t=${J(e)}|r=${J(t)}|s=${J(n)}|rot=${+!!r}|scl=${+!!i}`,At([e,t,n]),a.items,[Nt.euler,Nt.mul,Nt.rotate],f.join(`
`))}function Ft(e){let t=new kt,n=e.kind===`column`?t.add(`amount`,`read`,e.type,`amount column ${J(e)}`):``,r=t.add(`P`,`read_write`,`f32`,`attribute P: f32 tupleSize 3`),i=[];for(let t=0;t<3;t++){let a=t===0?`i * 3u`:`i * 3u + ${t}u`;i.push(`  ${r}[${a}] = ${r}[${a}] + (pcg_hash_float(pcg_hash3(params.seed, i, ${t}u)) * 2f - 1f) * ${q(n,e,t)};`)}return jt(`jitterPoints|a=${J(e)}`,At([e]),t.items,ze([`pcg_hash3`,`pcg_hash_float`]),i.join(`
`))}var It={"+x":`f, u, -r`,"-x":`-f, u, r`,"+y":`-r, f, u`,"-y":`r, -f, u`,"+z":`r, u, f`,"-z":`-r, u, -f`};function Lt(e,t,n){let r=new kt,i=e.kind===`column`?r.add(`direction`,`read`,e.type,`direction column ${J(e)}`):``,a=r.add(`rot`,`read_write`,`f32`,`attribute rot: f32 tupleSize 4`),o=L(1e-12,`internal ORIENT_PARALLEL_EPS`),s=`  let d = vec3<f32>(${[0,1,2].map(t=>q(i,e,t)).join(`, `)});
  let dl = dot(d, d);
  if (dl == 0f) {
    return; // zero direction: keep the prior rot
  }
  let f = d * (1f / sqrt(dl));
  let up = vec3<f32>(${[0,1,2].map(e=>q(``,n,e)).join(`, `)});
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
  let q = pcg_quat_from_basis(${It[t]});
  ${a}[i * 4u] = q.x;
  ${a}[i * 4u + 1u] = q.y;
  ${a}[i * 4u + 2u] = q.z;
  ${a}[i * 4u + 3u] = q.w;`;return jt(`orientAlongVector|d=${J(e)}|axis=${t}|up=${J(n)}`,At([e,n]),r.items,[Nt.basis],s)}var Rt=65535;function zt(e,t){let n=Rt*e;return Math.max(e,Math.floor(Math.min(t??n,n)/e)*e)}var Bt=`pcg-resident-run/2`;function Vt(e){return e.format===Bt?e:null}var Ht={reason:`run-plan-failed`},Ut=[`+x`,`-x`,`+y`,`-y`,`+z`,`-z`];function Wt(e){return Array.isArray(e)&&e.length===3&&e.every(e=>typeof e==`number`&&Number.isFinite(e))}var Y=class extends Error{},Gt=[];function Kt(e,t,n){let r=t.count,i=new Map(Object.entries(t.attributes)),a=[],o=new Map,s=[],c=new Map,l=[],u=[],d=()=>Object.fromEntries(i),p=e=>{let t=o.get(e);if(t!==void 0)return t;let n=i.get(e);if(n===void 0||n.type===`string`)throw new Y(e);let s=a.length;return a.push({bytes:r*n.tupleSize*4,init:`attr`,name:e}),o.set(e,s),s},m=(e,t,n)=>{let i=a.length;return a.push({bytes:r*t*4,init:n,name:e}),o.set(e,i),i},g=(e,t,n)=>{let r=i.get(e);if(r===void 0||r.type!==t||r.tupleSize!==n)throw new Y(e)},_=(e,t,n)=>{let r=t.length/4;if(r>=4)throw Error(`resident run: "${n}" needs more than 4 uniform constant slots for its constant params; raise MAX_APPLY_CONST_SLOTS in applyKernels.ts (each slot costs 16 bytes of the per-chunk uniform and nothing else)`);for(let n=0;n<4;n++)t.push(n<e.length?e[n]:0);return{kind:`const`,tupleSize:e.length,slot:r}},v=(e,t,n,i,a,o)=>{let c;if(f(e)){let t=ue(e);if(t===void 0)throw new Y(`no spec`);c=t}else if(typeof e==`number`||Array.isArray(e)&&e.every(e=>typeof e==`number`)){let t=typeof e==`number`?[e]:e;if(t.length<1||t.length>4||i!==null&&!i.includes(t.length))throw new Y(`tuple`);for(let e of t)if(!Number.isFinite(Math.fround(e)))throw new Y(`f32 range`);return{param:_(t,a,o),ref:null}}else throw new Y(`bad param value`);let l;try{l=_t(c,{attributes:d()})}catch{throw new Y(`compile`)}if(l.inputs.length+1>8)throw new Y(`buffers`);if(i!==null&&!i.includes(l.outTupleSize))throw new Y(`tuple`);let u=s.length;return s.push(r*l.outTupleSize*4),n.push({key:l.key,wgsl:l.wgsl,entryPoint:l.entryPoint,workgroupSize:l.workgroupSize,seed:t,uniformsBinding:l.bindings.uniforms,uniformBytes:12,consts:Gt,bindings:[...l.inputs.map(e=>({binding:e.binding,ref:{kind:`slot`,index:p(e.name)}})),{binding:l.bindings.output,ref:{kind:`col`,index:u}}]}),{param:{kind:`column`,type:l.outType,tupleSize:l.outTupleSize},ref:{kind:`col`,index:u}}},y=(e,t,n,r)=>{if(e.constSlots*4!==r.length)throw Error(`resident run: apply kernel "${e.key}" declares ${e.constSlots} constant slots but the planner allocated ${r.length/4}`);return{key:e.key,wgsl:e.wgsl,entryPoint:e.entryPoint,workgroupSize:e.workgroupSize,seed:t,uniformsBinding:0,uniformBytes:e.uniformBytes,consts:r,bindings:e.bindings.map(e=>{let t=n[e.role];if(t===void 0)throw new Y(`unmapped role ${e.role}`);return{binding:e.binding,ref:t}})}};try{for(let t of e){let e=[],n=[],r=t.params;switch(t.kind){case`setAttribute`:{let a=r.name,o=r.type,s=r.tupleSize;if(typeof a!=`string`)throw new Y(`name`);if(o!==`f32`&&o!==`i32`&&o!==`u32`&&o!==`bool`)throw new Y(`type`);if(typeof s!=`number`||!Number.isInteger(s)||s<1||s>4)throw new Y(`tupleSize`);let u=typeof r.seed==`number`?r.seed:NaN,d=u===0?t.seed:h(t.seed,u),{param:f,ref:p}=v(r.value,d,e,s===1?[1]:[1,s],n,t.kind),g=m(a,s,`none`);i.set(a,{type:o,tupleSize:s}),c.set(a,g),l.push({op:`replace`,name:a,type:o,tupleSize:s});let _={target:{kind:`slot`,index:g}};p!==null&&(_.value=p),e.push(y(Mt(f,o,s),0,_,n));break}case`transformPoints`:{g(`P`,`f32`,3);let a=v(r.translate,t.seed,e,[1,3],n,t.kind),o=v(r.rotateEuler,t.seed,e,[1,3],n,t.kind),s=v(r.scale,t.seed,e,[1,3],n,t.kind),l=i.get(`rot`),u=l!==void 0&&l.type===`f32`&&l.tupleSize===4,d=i.get(`scale`),f=d!==void 0&&d.type===`f32`&&d.tupleSize===3,m=p(`P`);c.set(`P`,m);let h={P:{kind:`slot`,index:m}};if(a.ref!==null&&(h.translate=a.ref),o.ref!==null&&(h.rotateEuler=o.ref),s.ref!==null&&(h.scale=s.ref),u){let e=p(`rot`);c.set(`rot`,e),h.rot={kind:`slot`,index:e}}if(f){let e=p(`scale`);c.set(`scale`,e),h.scaleAttr={kind:`slot`,index:e}}e.push(y(Pt(a.param,o.param,s.param,u,f),0,h,n));break}case`jitterPoints`:{g(`P`,`f32`,3);let i=typeof r.seed==`number`?r.seed:NaN,a=h(t.seed,i),o=v(r.amount,a,e,[1,3],n,t.kind),s=p(`P`);c.set(`P`,s);let l={P:{kind:`slot`,index:s}};o.ref!==null&&(l.amount=o.ref),e.push(y(Ft(o.param),a,l,n));break}case`orientAlongVector`:{let a=r.axis;if(!Ut.includes(a))throw new Y(`axis`);if(!Wt(r.up))throw new Y(`up`);let o=v(r.direction,t.seed,e,[1,3],n,t.kind),s=r.up,u=s[0]*s[0]+s[1]*s[1]+s[2]*s[2],d=u>0?1/Math.sqrt(u):0,f=[s[0]*d,s[1]*d,s[2]*d];for(let e of f)if(!Number.isFinite(Math.fround(e)))throw new Y(`up range`);let h=_(f,n,t.kind),g=i.get(`rot`),b=g!==void 0&&g.type===`f32`&&g.tupleSize===4?p(`rot`):m(`rot`,4,`quat-default`);i.set(`rot`,{type:`f32`,tupleSize:4}),c.set(`rot`,b),l.push({op:`ensure-rot`});let x={rot:{kind:`slot`,index:b}};o.ref!==null&&(x.direction=o.ref),e.push(y(Lt(o.param,a,h),0,x,n));break}default:throw new Y(`unknown kind ${t.kind}`)}u.push({id:t.id,type:t.type,steps:e})}}catch(e){if(e instanceof Y)return Ht;throw e}let b=[...c].map(([e,t])=>({name:e,slot:t})),x=a.reduce((e,t)=>e+t.bytes,0),S=s.reduce((e,t)=>e+t,0),C=b.reduce((e,t)=>e+a[t.slot].bytes,0),w=x+S+C;return w>n?{reason:`run-too-large`}:{plan:{format:Bt,count:r,members:u,slots:a,cols:s,written:b,layoutOps:l,totalBytes:w}}}var qt={f32:Float32Array,i32:Int32Array,u32:Uint32Array};function Jt(){return new Promise(e=>setTimeout(e,0))}async function Yt(e,t,n,r){let{device:i,pool:a}=e,{geo:o,signal:s,budgetMs:c}=n,l=t.count;if(o.attrs.point.count!==l)throw Error(`resident run: plan was built for ${l} points but the input geometry has ${o.attrs.point.count}; plans are single-cook artifacts — re-plan for new inputs`);let u=()=>{if(s?.aborted)throw new x},d=[],f=(e,t)=>{let n=a.acquire(e,t);return d.push(n),n};try{let n=o.attrs.point,a=t.slots.map(e=>{let t=f(e.bytes,K.STORAGE|K.COPY_DST|K.COPY_SRC);if(e.init===`attr`){let r=n.require(e.name),a=e.bytes/4;if(r.data instanceof Uint8Array){let e=new Uint32Array(a);for(let t=0;t<a;t++)e[t]=r.data[t];i.queue.writeBuffer(t,0,e)}else i.queue.writeBuffer(t,0,r.data.subarray(0,a))}else if(e.init===`quat-default`){let n=new Float32Array(e.bytes/4);for(let e=3;e<n.length;e+=4)n[e]=1;i.queue.writeBuffer(t,0,n)}return t}),s=t.cols.map(e=>f(e,K.STORAGE|K.COPY_DST|K.COPY_SRC)),d=e=>e.kind===`slot`?a[e.index]:s[e.index],p=i.createCommandEncoder(),m=p.beginComputePass(),h=performance.now();for(let n of t.members){u();for(let t of n.steps){let n=e.getPipeline(t.key,t.wgsl,t.entryPoint,r);r!==void 0&&r.dispatches++,m.setPipeline(n);let a=zt(t.workgroupSize,e.maxElementsPerDispatch),o=Math.ceil(l/a),s=new ArrayBuffer(t.uniformBytes),c=new Uint8Array(s),u=new Uint32Array(s,0,3);u[0]=l,u[1]=t.seed>>>0,t.consts.length>0&&new Float32Array(s,16,t.consts.length).set(t.consts);for(let e=0;e<o;e++){let r=f(t.uniformBytes,K.UNIFORM|K.COPY_DST);u[2]=e*a,i.queue.writeBuffer(r,0,c);let o=i.createBindGroup({layout:n.getBindGroupLayout(0),entries:[{binding:t.uniformsBinding,resource:{buffer:r}},...t.bindings.map(e=>({binding:e.binding,resource:{buffer:d(e.ref)}}))]}),s=Math.min(a,l-e*a);m.setBindGroup(0,o),m.dispatchWorkgroups(Math.ceil(s/t.workgroupSize))}}c!==void 0&&performance.now()-h>c&&(await Jt(),u(),h=performance.now())}m.end();let g=t.written.reduce((e,n)=>e+t.slots[n.slot].bytes,0),_=f(g,K.COPY_DST|K.MAP_READ),v=[],y=0;for(let e of t.written){let n=t.slots[e.slot].bytes;p.copyBufferToBuffer(a[e.slot],0,_,y,n),v.push(y),y+=n}i.queue.submit([p.finish()]),await _.mapAsync(vt.READ,0,g);let b;try{b=_.getMappedRange(0,g).slice(0)}finally{_.unmap()}u();let x=ce(o),S=x.attrs.point;for(let e of t.layoutOps)if(e.op===`replace`)S.replace(e.name,e.type,e.tupleSize);else{let e=S.get(`rot`);(!e||e.type!==`f32`||e.tupleSize!==4)&&(e&&S.remove(`rot`),S.add(`rot`,`f32`,4,[0,0,0,1]))}return t.written.forEach((e,t)=>{let n=S.require(e.name),r=l*n.tupleSize;if(n.data instanceof Uint8Array){let e=new Uint32Array(b,v[t],r);for(let t=0;t<r;t++)n.data[t]=e[t]}else{let i=qt[n.type];if(i===void 0)throw Error(`resident run: cannot materialize attribute "${e.name}" of type ${n.type}`);n.data.set(new i(b,v[t],r))}}),r!==void 0&&(r.residentRuns++,r.fusedNodes+=t.members.length,r.readbacksSaved+=t.members.length-1),{geo:x}}catch(e){throw e instanceof x?e:Error(`GpuFieldEvaluator: resident run failed (${t.members.length} fused nodes [${t.members.map(e=>`"${e.id}"`).join(`, `)}], ${l} points): ${e instanceof Error?e.message:String(e)}`,{cause:e})}finally{for(let e of d)a.release(e)}}var Xt=`gpu2`,Zt=268435456,Qt={f32:Float32Array,i32:Int32Array,u32:Uint32Array},$t={f32:Float32Array,i32:Int32Array,u32:Uint32Array};function en(e){let t=e=>e!==void 0&&e!==``?e:`?`;return[Xt,t(e?.vendor),t(e?.architecture),t(e?.device),t(e?.description)].join(`|`)}function tn(e,t){return e!==void 0&&(e.fallbacks[t]=(e.fallbacks[t]??0)+1),null}var nn=class{cacheSalt;device;kernels=new Map;pipelines=new Map;pool;maxElementsPerDispatch;maxResidentBytes;constructor(e,t={}){if(t.maxElementsPerDispatch!==void 0&&!Number.isFinite(t.maxElementsPerDispatch))throw Error(`GpuFieldEvaluator: maxElementsPerDispatch must be a finite number, got ${t.maxElementsPerDispatch}; leave it unset to use the device maximum`);this.device=e,this.cacheSalt=en(t.adapterInfo??e.adapterInfo),this.pool=new xt(e,t.maxPooledBytes??Zt),this.maxElementsPerDispatch=t.maxElementsPerDispatch,this.maxResidentBytes=t.maxResidentBytes??536870912}get pipelineCacheSize(){return this.pipelines.size}get poolStats(){return this.pool.stats}dispose(){this.pool.dispose()}chunkElements(e){let t=Rt*e.workgroupSize,n=Math.min(this.maxElementsPerDispatch??t,t);return Math.max(e.workgroupSize,Math.floor(n/e.workgroupSize)*e.workgroupSize)}resolveField(e,t,n){let r=ue(e);if(r===void 0)return tn(n,`no-spec`);let i=t.geo.attrs[t.domain],a={},o=[];for(let e of i.names().sort()){let t=i.get(e);t!==void 0&&(a[e]={type:t.type,tupleSize:t.tupleSize},o.push(`${JSON.stringify(e)}:${t.type}x${t.tupleSize}`))}let s=`${e.key.length}#${e.key}|${o.join(`,`)}`,c=this.kernels.get(s);if(c===void 0){try{c=_t(r,{attributes:a})}catch(e){c=e instanceof Error?e:Error(String(e))}this.kernels.set(s,c)}if(c instanceof Error)return tn(n,`compile-error`);if(c.inputs.length+1>8)return tn(n,`too-many-buffers`);let l=i.count;if(l===0)return Promise.resolve({data:new $t[c.outType](0),tupleSize:c.outTupleSize});let u=this.getPipeline(c.key,c.wgsl,c.entryPoint,n);return n!==void 0&&n.dispatches++,this.dispatch(e,t,c,u,l)}getPipeline(e,t,n,r){let i=this.pipelines.get(e);if(i!==void 0)return r!==void 0&&r.pipelineCacheHits++,i;let a=this.device.createShaderModule({code:t}),o=this.device.createComputePipeline({layout:`auto`,compute:{module:a,entryPoint:n}});return this.pipelines.set(e,o),r!==void 0&&r.pipelinesCompiled++,o}planRun(e,t,n){let r=Kt(e,t,this.maxResidentBytes);return`plan`in r?r.plan:(n!==void 0&&(n.fallbacks[r.reason]=(n.fallbacks[r.reason]??0)+1),null)}executeRun(e,t,n){let r=Vt(e);return r===null?Promise.reject(Error(`GpuFieldEvaluator.executeRun: plan was not produced by this library's planRun; pass the object returned by planRun on the same resolver`)):Yt({device:this.device,pool:this.pool,maxElementsPerDispatch:this.maxElementsPerDispatch,getPipeline:(e,t,n,r)=>this.getPipeline(e,t,n,r)},r,t,n)}async dispatch(e,t,n,r,i){let a=this.device,o=[],s=(e,t)=>{let n=this.pool.acquire(e,t);return o.push(n),n};try{let e=this.chunkElements(n),o=Math.ceil(i/e),c=[],l=t.geo.attrs[t.domain];for(let e of n.inputs){let t=l.require(e.name),n=i*e.tupleSize,r;if(t.data instanceof Uint8Array){let e=new Uint32Array(n);for(let r=0;r<n;r++)e[r]=t.data[r];r=e}else r=t.data.subarray(0,n);let o=s(n*4,K.STORAGE|K.COPY_DST);a.queue.writeBuffer(o,0,r),c.push({binding:e.binding,resource:{buffer:o}})}let u=i*n.outTupleSize*4,d=s(u,K.STORAGE|K.COPY_SRC);c.push({binding:n.bindings.output,resource:{buffer:d}});let f=s(u,K.COPY_DST|K.MAP_READ),p=[];for(let l=0;l<o;l++){let o=s(12,K.UNIFORM|K.COPY_DST);a.queue.writeBuffer(o,0,new Uint32Array([i,t.seed>>>0,l*e])),p.push(a.createBindGroup({layout:r.getBindGroupLayout(0),entries:[{binding:n.bindings.uniforms,resource:{buffer:o}},...c]}))}let m=a.createCommandEncoder(),h=m.beginComputePass();h.setPipeline(r);for(let t=0;t<o;t++){let r=Math.min(e,i-t*e);h.setBindGroup(0,p[t]),h.dispatchWorkgroups(Math.ceil(r/n.workgroupSize))}h.end(),m.copyBufferToBuffer(d,0,f,0,u),a.queue.submit([m.finish()]),await f.mapAsync(vt.READ,0,u);let g;try{g=f.getMappedRange(0,u).slice(0)}finally{f.unmap()}return{data:new Qt[n.outType](g),tupleSize:n.outTupleSize}}catch(n){throw Error(`GpuFieldEvaluator: dispatch failed for field ${e.key} (${i} elements on the ${t.domain} domain): ${n instanceof Error?n.message:String(n)}`,{cause:n})}finally{for(let e of o)this.pool.release(e)}}},rn=[`cpu`,`gpu-node`,`gpu-fused`],an={cpu:`CPU`,"gpu-node":`GPU per-node`,"gpu-fused":`GPU fused`},on=8388608,sn=[1e5,5e5,1e6,2e6],cn=P(`<div class="notice svelte-1yy0qs2"> </div>`),ln=P(`<button> </button>`),un=P(`<option> </option>`),dn=P(`<i class="svelte-1yy0qs2"> </i>`),fn=P(`<div><div class="pl svelte-1yy0qs2"><b class="svelte-1yy0qs2"> </b> <!></div> <div class="pv svelte-1yy0qs2"> </div> <div class="pm svelte-1yy0qs2"> <!></div></div>`),pn=P(`<div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">counters from</span><b class="svelte-1yy0qs2"> </b></div>`),mn=P(`<!> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">resident runs / fused nodes</span> <b class="svelte-1yy0qs2"> </b></div> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">readbacks saved</span><b class="svelte-1yy0qs2"> </b></div> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">dispatches (member kernels)</span><b class="svelte-1yy0qs2"> </b></div> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">pipelines compiled / cache hits</span> <b class="svelte-1yy0qs2"> </b></div> <div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2">gpu fallbacks</span><b class="svelte-1yy0qs2"> </b></div>`,1),hn=P(`<div class="stat svelte-1yy0qs2"><span class="svelte-1yy0qs2"> </span> <b class="svelte-1yy0qs2"> </b></div>`),gn=P(`<div class="error svelte-1yy0qs2"> </div>`),_n=P(`<div class="panel svelte-1yy0qs2"><h1 class="svelte-1yy0qs2">08 · gpu fields</h1> <p class="info svelte-1yy0qs2"><code class="svelte-1yy0qs2">setAttribute(wobble) → jitterPoints → transformPoints → setAttribute(tint) →
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
    fused chain's three constant <code class="svelte-1yy0qs2">transformPoints</code> params ride the run's uniform rather
    than device columns, so they add no dispatch and no per-point memory.</p></div>`);function vn(e,t){Ce(t,!0);let n=Ae(t,`bridge`,7),r=ye(xe(t.initial));n().publish=e=>{_e(r,e,!0)};function i(e){return e>=1e6?`${e/1e6}M`:`${e/1e3}k`}function a(e){return e===void 0?`–`:`${e.toFixed(1)} ms`}function o(e){let t=Object.entries(e).map(([e,t])=>`${e}×${t}`);return t.length>0?t.join(`, `):`none`}function s(e){let t=E(r).reports.cpu.bestMs,n=E(r).reports[e].bestMs;if(!(e===`cpu`||t===void 0||n===void 0||n<=0))return`×${(t/n).toFixed(1)}`}function c(e){return e===`cpu`||E(r).gpuAvailable}function l(e){e===E(r).path||E(r).cooking||!c(e)||t.host.setPath(e)}let u=ye(xe(t.initial.seed));function d(){let e=Math.floor(Number(E(u)));Number.isFinite(e)&&t.host.setSeed(e>>>0)}let f=Se(()=>E(r).reports[E(r).path]),p=Se(()=>E(f).gpu??E(r).reports[`gpu-fused`].gpu??E(r).reports[`gpu-node`].gpu),m=Se(()=>E(f).gpu===void 0?E(r).reports[`gpu-fused`].gpu===void 0?E(r).reports[`gpu-node`].gpu===void 0?void 0:`gpu per-node`:`gpu fused`:void 0),h=on/1048576;var g=_n(),_=D(M(g),4),v=e=>{var t=cn(),n=M(t);A(t),O(()=>N(n,`CPU-only: ${(E(r).gpuReason===``?`detecting WebGPU…`:E(r).gpuReason)??``}`)),F(e,t)};j(_,e=>{E(r).gpuAvailable||e(v)});var y=D(_,2),b=D(M(y),2);je(b,20,()=>rn,e=>e,(e,t)=>{var n=ln();let i;var a=M(n,!0);A(n),O(e=>{n.disabled=e,i=Oe(n,1,`svelte-1yy0qs2`,null,i,{active:E(r).path===t}),N(a,an[t])},[()=>!c(t)]),k(`click`,n,()=>l(t)),F(e,n)}),A(b),A(y);var x=D(y,2),S=D(M(x),2);je(S,20,()=>sn,e=>e,(e,t)=>{var n=un(),r=M(n,!0);A(n);var a={};O(e=>{N(r,e),a!==(a=t)&&(n.value=(n.__value=t)??``)},[()=>i(t)]),F(e,n)}),A(S);var C;Me(S),A(x);var w=D(x,2),ee=D(M(w),2);Te(ee),A(w);var te=D(w,2),ne=D(M(te),2);Te(ne);var re=D(ne,2),ie=M(re,!0);A(re),A(te);var ae=D(te,2),T=D(M(ae),2),oe=M(T);oe.value=oe.__value=`default`;var se=D(oe),ce=M(se);A(se),se.value=se.__value=`tight`,A(T);var le;Me(T),A(ae);var ue=D(ae,2),de=D(M(ue),2);A(ue);var fe=D(ue,2),pe=D(M(fe),2),me=D(pe,2);A(fe);var we=D(fe,2);je(we,20,()=>rn,e=>e,(e,t)=>{var n=fn();let i;var o=M(n),l=M(o),u=M(l,!0);A(l);var d=D(l,2),f=e=>{var n=dn(),r=M(n);A(n),O(e=>N(r,`${e??``} vs CPU`),[()=>s(t)]),F(e,n)},p=Se(()=>s(t)!==void 0);j(d,e=>{E(p)&&e(f)}),A(o);var m=D(o,2),h=M(m);A(m);var g=D(m,2),_=M(g),v=D(_),y=e=>{var n=ge();O(e=>N(n,`· warm ${e??``}`),[()=>a(E(r).reports[t].warmMs)]),F(e,n)};j(v,e=>{E(r).reports[t].warmMs!==void 0&&e(y)}),A(g),A(n),O((e,a,o)=>{i=Oe(n,1,`pathrow svelte-1yy0qs2`,null,i,e),N(u,an[t]),N(h,`${a??``} · best ${o??``}`),N(_,`hash ${E(r).reports[t].hash??`–`??``} · nodes ${E(r).reports[t].nodes??`–`??``} `)},[()=>({sel:E(r).path===t,off:!c(t)}),()=>a(E(r).reports[t].lastMs),()=>a(E(r).reports[t].bestMs)]),F(e,n)}),A(we);var Ne=D(we,2),P=M(Ne),I=D(M(P)),L=M(I,!0);A(I),A(P);var Pe=D(P,2),R=D(M(Pe)),z=M(R,!0);A(R),A(Pe);var Fe=D(Pe,2),Ie=D(M(Fe)),Le=M(Ie,!0);A(Ie),A(Fe);var B=D(Fe,2),Re=D(M(B)),ze=M(Re,!0);A(Re),A(B);var Be=D(B,2),Ve=e=>{var t=mn(),n=be(t),r=e=>{var t=pn(),n=D(M(t)),r=M(n,!0);A(n),A(t),O(()=>N(r,E(m))),F(e,t)};j(n,e=>{E(m)!==void 0&&e(r)});var i=D(n,2),a=D(M(i),2),s=M(a);A(a),A(i);var c=D(i,2),l=D(M(c)),u=M(l,!0);A(l),A(c);var d=D(c,2),f=D(M(d)),h=M(f,!0);A(f),A(d);var g=D(d,2),_=D(M(g),2),v=M(_);A(_),A(g);var y=D(g,2),b=D(M(y)),x=M(b,!0);A(b),A(y),O(e=>{N(s,`${E(p).residentRuns??``} / ${E(p).fusedNodes??``}`),N(u,E(p).readbacksSaved),N(h,E(p).dispatches),N(v,`${E(p).pipelinesCompiled??``} / ${E(p).pipelineCacheHits??``}`),N(x,e)},[()=>o(E(p).fallbacks)]),F(e,t)};j(Be,e=>{E(p)!==void 0&&e(Ve)});var He=D(Be,2),Ue=e=>{var t=hn(),n=M(t),i=M(n);A(n);var a=D(n,2),o=M(a);A(a),A(t),O((e,t,n)=>{N(i,`max |cpu−${an[E(r).deviation.path]??``}| (${e??``} pts)`),N(o,`${t??``} · ${n??``} range-ULP`)},[()=>E(r).deviation.window.toLocaleString(),()=>E(r).deviation.maxAbs.toExponential(2),()=>E(r).deviation.rangeUlp.toFixed(1)]),F(e,t)};j(He,e=>{E(r).deviation!==void 0&&e(Ue)});var We=D(He,2),Ge=e=>{var t=gn(),n=M(t,!0);A(t),O(()=>N(n,E(r).error)),F(e,t)};j(We,e=>{E(r).error!==void 0&&e(Ge)}),A(Ne);var Ke=D(Ne,2),qe=D(M(Ke),2),V=M(qe,!0);A(qe),A(Ke),ve(2),A(g),O((e,t)=>{C!==(C=E(r).count)&&(S.value=(S.__value=E(r).count)??``,De(S,E(r).count)),Ee(ne,E(r).frequency),N(ie,e),T.disabled=!E(r).gpuAvailable,N(ce,`${h} MiB — force run-too-large`),le!==(le=E(r).residentBudget)&&(T.value=(T.__value=E(r).residentBudget)??``,De(T,E(r).residentBudget)),de.disabled=E(r).cooking,pe.disabled=E(r).cooking,me.disabled=E(r).cooking,N(L,E(r).adapter),N(z,t),N(Le,E(r).fps),N(ze,E(r).cooking?`cooking…`:`idle`),N(V,E(r).specJson)},[()=>E(r).frequency.toFixed(3),()=>E(r).points.toLocaleString()]),k(`change`,S,e=>t.host.setCount(Number(e.currentTarget.value))),k(`change`,ee,d),ke(ee,()=>E(u),e=>_e(u,e)),k(`change`,ne,e=>t.host.setFrequency(Number(e.currentTarget.value))),k(`change`,T,e=>t.host.setResidentBudget(e.currentTarget.value)),k(`click`,de,()=>t.host.measureAll()),k(`click`,pe,()=>t.host.rebuild()),k(`click`,me,()=>t.host.cookWarm()),F(e,g),he()}Ne([`click`,`change`]);function yn(e){return{fn:`clamp`,args:[{fn:`add`,args:[{fn:`add`,args:[{fn:`mul`,args:[{fn:`fbm`,base:`simplexNoise`,opts:{frequency:e,octaves:5,normalized:!0}},.62]},{fn:`mul`,args:[{fn:`worleyNoise`,opts:{frequency:e*2.1,output:`f2-f1`,normalized:!0}},.3]}]},{fn:`mul`,args:[{fn:`randomField`,key:`sparkle`},.08]}]},0,1]}}function bn(e){let t=yn(e);return{fn:`vec`,args:[{fn:`ramp`,args:[t],stops:[[0,.02],[.3,.05],[.55,.1],[.75,.95],[1,1]]},{fn:`ramp`,args:[t],stops:[[0,.03],[.3,.25],[.55,.75],[.75,.7],[1,.97]]},{fn:`ramp`,args:[t],stops:[[0,.1],[.3,.55],[.55,.8],[.75,.25],[1,.9]]}]}}function xn(e){let t=(t,n)=>({fn:`remap`,args:[{fn:`perlinNoise`,opts:{seed:t,frequency:e*.8,offset:n,normalized:!0}},0,1,0,.9]});return{fn:`vec`,args:[t(11,[0,0,0]),t(23,[37,5,-19]),t(47,[-11,61,5])]}}function Sn(e){return{fn:`add`,args:[.35,{fn:`add`,args:[{fn:`mul`,args:[{fn:`randomField`,key:`size`},.5]},{fn:`mul`,args:[{fn:`ramp`,args:[{fn:`worleyNoise`,opts:{frequency:e*1.4,output:`f1`,normalized:!0}}],stops:[[0,1],[.4,.35],[1,.05]]},1.6]}]}]}}var Cn=30,wn=9,Tn=16384,En=1,Dn=1e6,On=.055,X=`cpu`,kn=`default`;function An(){let e=new b(En),t=e.add(m,{count:Dn,boundsMin:[-30,-9,-30],boundsMax:[Cn,wn,Cn]}),r=e.add(i,{name:`wobble`,domain:`point`,type:`f32`,tupleSize:3,value:v(xn(On))}),a=e.add(n,{amount:v({fn:`attribute`,name:`wobble`,tupleSize:3}),seed:7}),o=e.add(oe,{translate:[0,0,0],rotateEuler:[0,14,0],scale:[1,.92,1]}),s=v(bn(On)),c=e.add(i,{name:`tint`,domain:`point`,type:`f32`,tupleSize:3,value:s}),l=e.add(i,{name:`psize`,domain:`point`,type:`f32`,tupleSize:1,value:v(Sn(On))});return e.connect(t,`out`,r,`in`),e.connect(r,`out`,a,`in`),e.connect(a,`out`,o,`in`),e.connect(o,`out`,c,`in`),e.connect(c,`out`,l,`in`),e.output(l,`out`,`points`),{graph:e,tintNode:c,tintField:s}}var jn=An(),Mn,Nn,Pn,Fn=!1;function In(e){return{cacheSalt:e.cacheSalt,resolveField:(t,n,r)=>e.resolveField(t,n,r),planRun:()=>null,executeRun:(t,n,r)=>e.executeRun(t,n,r)}}async function Ln(){let e=navigator.gpu;if(e===void 0)return{error:`navigator.gpu is missing — this browser has no WebGPU`};try{let t=await e.requestAdapter();if(t===null)return{error:`requestAdapter() returned null — no compatible GPU adapter`};let n=t.info,r=await t.requestDevice(),i=r.lost;i!==void 0&&i.then(e=>{Fn=!0,Z.cooking=!1,Z.error=`WebGPU device lost (${e?.reason??`unknown`}: ${e?.message??`no detail`}) — GPU paths are disabled; reload to get a fresh device.`,Z.gpuAvailable=!1,Q()});let a=n===void 0?{}:{adapterInfo:n};Mn=new nn(r,a),Nn=new nn(r,{...a,maxResidentBytes:on}),Pn=In(Mn);let o=[n?.vendor,n?.architecture,n?.description===``?n?.device:n?.description].filter(e=>typeof e==`string`&&e!==``).join(` · `)||`adapter (no info exposed)`;return console.info(`08-gpu-fields: WebGPU ready — ${o}; cacheSalt=${Mn.cacheSalt}`),{label:o}}catch(e){return console.error(`08-gpu-fields: WebGPU init failed, falling back to CPU:`,e),{error:`WebGPU init failed: ${e instanceof Error?e.message:String(e)}`}}}function Rn(e){if(e!==`cpu`)return e===`gpu-node`?Pn:kn===`tight`?Nn:Mn}function zn(e){return e===`cpu`||Mn!==void 0&&!Fn}var{scene:Bn,camera:Vn,renderer:Hn,start:Un}=me({cameraPosition:[52,26,52]});function Wn(){return window.innerHeight/(2*Math.tan(Vn.fov*Math.PI/360))}var Gn=new c({uniforms:{uScale:{value:Wn()},uPx:{value:Hn.getPixelRatio()}},vertexShader:`
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
    }`,blending:2,depthWrite:!1,transparent:!0}),Kn;function qn(e,t,n){let r=e.pointCount,i=e.attrs.point.require(`P`).data,a=new le;a.setAttribute(`position`,new ae(i.slice(0,r*3),3)),a.setAttribute(`aTint`,new ae(t.slice(0,r*3),3)),a.setAttribute(`aSize`,new ae(n.slice(0,r),1)),a.computeBoundingSphere(),Kn!==void 0&&(Bn.remove(Kn),Kn.geometry.dispose()),Kn=new te(a,Gn),Bn.add(Kn)}window.addEventListener(`resize`,()=>{Gn.uniforms.uScale.value=Wn(),Gn.uniforms.uPx.value=Hn.getPixelRatio()});function Jn(e,t){for(let n=0;n<t.length;n++)e^=t[n],e=Math.imul(e,16777619);return e>>>0}function Yn(e,t){let n=2166136261;return n=Jn(n,new Uint32Array(e.buffer,e.byteOffset,e.length)),n=Jn(n,new Uint32Array(t.buffer,t.byteOffset,t.length)),n.toString(16).padStart(8,`0`)}function Xn(e,t,n){let r=Math.min(Tn,e.pointCount);if(r===0)return;let i=S(r),o=i.attrs.point.require(`P`).data,s=e.attrs.point.require(`P`).data;o.set(s.subarray(0,r*3));let c=jn.graph.describe().nodes.find(e=>e.id===jn.tintNode.id);if(c===void 0)return;let l=a(jn.tintField,{geo:i,domain:`point`,seed:c.seed}),u=0,d=0;for(let e=0;e<r*3;e++){let n=l.data[e],r=Math.abs(n-t[e]);r>u&&(u=r);let i=Math.abs(n);i>d&&(d=i)}let f=u===0?0:d===0?1/0:u/(2**-23*d);return{maxAbs:u,rangeUlp:f,window:r,path:n}}function Zn(){return{cpu:{},"gpu-node":{},"gpu-fused":{}}}var Z={gpuAvailable:!1,gpuReason:``,adapter:`detecting…`,path:X,count:Dn,seed:En,frequency:On,residentBudget:kn,cooking:!1,fps:`–`,points:0,reports:Zn(),specJson:JSON.stringify(bn(On),null,2)},Qn={};function Q(){Qn.publish?.({...Z,reports:{cpu:{...Z.reports.cpu},"gpu-node":{...Z.reports[`gpu-node`]},"gpu-fused":{...Z.reports[`gpu-fused`]}},deviation:Z.deviation&&{...Z.deviation}})}function $n(){Z.reports=Zn(),Z.deviation=void 0}function er(){return new Promise(e=>{let t=setTimeout(e,250);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(t),e()}))})}async function tr(e){if(!zn(e.path))return;e.warm||(jn=An()),X=e.path,Z.path=e.path,Z.cooking=!0,Z.error=void 0,Q(),await er();let t=Rn(e.path),n=performance.now(),r;try{r=await ee(jn.graph,t===void 0?{budgetMs:14}:{gpu:t,budgetMs:14})}catch(e){console.error(`08-gpu-fields: cook failed:`,e),Z.cooking=!1,Z.error=e instanceof Error?e.message:String(e),Q();return}let i=performance.now()-n,a=ne(r.outputs.points);if(a===void 0){Z.cooking=!1,Z.error=`cook produced no geometry`,Q();return}let o=a.pointCount,s=a.attrs.point.require(`tint`).data.subarray(0,o*3),c=a.attrs.point.require(`psize`).data.subarray(0,o);qn(a,s,c);let l=Z.reports[e.path];l.nodes=`${r.stats.cooked} / ${r.stats.cached}`,r.stats.cooked>0?(l.lastMs=i,l.bestMs=l.bestMs===void 0?i:Math.min(l.bestMs,i)):l.warmMs=i,l.hash=Yn(s,c),r.stats.gpu!==void 0&&r.stats.cooked>0&&(l.gpu={dispatches:r.stats.gpu.dispatches,pipelinesCompiled:r.stats.gpu.pipelinesCompiled,pipelineCacheHits:r.stats.gpu.pipelineCacheHits,residentRuns:r.stats.gpu.residentRuns,fusedNodes:r.stats.gpu.fusedNodes,readbacksSaved:r.stats.gpu.readbacksSaved,fallbacks:{...r.stats.gpu.fallbacks}}),Z.points=o,e.path!==`cpu`&&r.stats.cooked>0&&(Z.deviation=Xn(a,s,e.path)),Z.cooking=!1,Q()}var nr=[],rr=pe(async()=>{for(;nr.length>0;){let e=nr.shift();e!==void 0&&await tr(e)}});function $(...e){nr=e,rr()}we(vn,{target:(()=>{let e=document.getElementById(`panel`);if(e===null)throw Error(`missing #panel element`);return e})(),props:{bridge:Qn,host:{setPath(e){zn(e)&&(Z.path=e,$({path:e,warm:!1}))},setCount(e){Dn=e,Z.count=e,$n(),$({path:X,warm:!1})},setSeed(e){En=e,Z.seed=e,$n(),$({path:X,warm:!1})},setFrequency(e){On=e,Z.frequency=e,Z.specJson=JSON.stringify(bn(e),null,2),$n(),$({path:X,warm:!1})},setResidentBudget(e){kn=e,Z.residentBudget=e,$n(),$({path:X,warm:!1})},measureAll(){$(...rn.filter(zn).sort((e,t)=>e===`cpu`?1:t===`cpu`?-1:0).map(e=>({path:e,warm:!1})))},rebuild(){$({path:X,warm:!1})},cookWarm(){$({path:X,warm:!0})}},initial:{...Z}}}),Ln().then(e=>{`label`in e?(Z.gpuAvailable=!0,Z.adapter=e.label,X=`gpu-fused`,Z.path=`gpu-fused`):(Z.gpuAvailable=!1,Z.gpuReason=e.error,Z.adapter=`none`),Q(),$({path:X,warm:!1})});var ir=ie(e=>{Z.fps=e,Q()});Un(()=>ir());