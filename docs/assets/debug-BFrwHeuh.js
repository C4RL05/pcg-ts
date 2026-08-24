import{Bn as e,Br as t,Dr as n,Fr as r,Hn as i,Hr as a,Ht as o,Ir as s,Kn as c,Lr as l,Mr as u,Nn as d,Nr as f,Or as p,Pr as m,Rr as h,Tr as g,Un as _,Ut as v,Vn as y,Vr as b,Vt as x,Wn as S,Xn as C,Yn as w,Zn as T,jr as E,kn as ee,kr as D,nr as O,qn as te,wr as ne,zn as re,zr as ie}from"./wordmark-dvlHq1kU.js";import{Ut as ae,Wt as oe,o as se,s as ce}from"./three.core-B85ZZh_6.js";var k=class extends Error{constructor(e){super(e),this.name=`GpuCompileError`}};function A(e,t){let n=Math.fround(e);if(!Number.isFinite(n))throw new k(`${t}: value ${e} is not representable as a finite f32 (WGSL kernels compute in f32; keep magnitudes within ~3.4e38)`);return Object.is(n,-0)?`-0f`:`${String(n)}f`}function le(e){return`${e>>>0}u`}function j(e){return`0x${(e>>>0).toString(16).padStart(8,`0`)}u`}var M=j,ue=A(34028234663852886e22,`internal f32 max`);function de(e,t){let n=M(e);for(let e of t)n=`pcg_hash_mix(${n}, ${e})`;return`pcg_hash_finalize(${n})`}function fe(){let e=[];for(let t=0;t<12;t++){let n=e=>A(w[t*3+e],`internal GRAD3`);e.push(`  vec3<f32>(${n(0)}, ${n(1)}, ${n(2)}),`)}return`var<private> PCG_GRAD3: array<vec3<f32>, 12> = array<vec3<f32>, 12>(
${e.join(`
`)}
);`}var N=e=>t=>A(t,e),pe=new Map([[`PCG_GRAD3`,{deps:[],text:fe()}],[`pcg_hash_mix`,{deps:[],text:`fn pcg_hash_mix(h_in: u32, value: u32) -> u32 {
  var k = value * ${M(s)};
  k = (k << 15u) | (k >> 17u);
  k = k * ${M(l)};
  var h = h_in ^ k;
  h = (h << 13u) | (h >> 19u);
  h = h * 5u + ${M(h)};
  return h;
}`}],[`pcg_hash_finalize`,{deps:[],text:`fn pcg_hash_finalize(h_in: u32) -> u32 {
  var h = h_in ^ (h_in >> 16u);
  h = h * ${M(f)};
  h = h ^ (h >> 13u);
  h = h * ${M(m)};
  h = h ^ (h >> 16u);
  return h;
}`}],[`pcg_hash3`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash3(a: u32, b: u32, c: u32) -> u32 {
  return ${de(t(3),[`a`,`b`,`c`])};
}`}],[`pcg_hash4`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash4(a: u32, b: u32, c: u32, d: u32) -> u32 {
  return ${de(t(4),[`a`,`b`,`c`,`d`])};
}`}],[`pcg_hash5`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash5(a: u32, b: u32, c: u32, d: u32, e: u32) -> u32 {
  return ${de(t(5),[`a`,`b`,`c`,`d`,`e`])};
}`}],[`pcg_hash_float`,{deps:[],text:`fn pcg_hash_float(h: u32) -> f32 {
  return f32(h >> 8u) * ${A(r,`internal hashFloat scale`)};
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
  return ${N(`internal PERLIN_SCALE`)(te)} * pcg_mix(
    pcg_mix(pcg_mix(n000, n100, u), pcg_mix(n010, n110, u), v),
    pcg_mix(pcg_mix(n001, n101, u), pcg_mix(n011, n111, u), v),
    w);
}`}],[`pcg_simplex_corner`,{deps:[`pcg_hash4`,`PCG_GRAD3`],text:`fn pcg_simplex_corner(seed: u32, i: i32, j: i32, k: i32, x: f32, y: f32, z: f32) -> f32 {
  let t = ${N(`internal simplex R2`)(_)} - x * x - y * y - z * z;
  if (t <= 0f) {
    return 0f;
  }
  let g = pcg_hash4(seed, bitcast<u32>(i), bitcast<u32>(j), bitcast<u32>(k)) % 12u;
  let t2 = t * t;
  return t2 * t2 * dot(PCG_GRAD3[g], vec3<f32>(x, y, z));
}`}],[`pcg_simplex_noise`,{deps:[`pcg_simplex_corner`],text:`fn pcg_simplex_noise(seed: u32, p: vec3<f32>) -> f32 {
  let s = (p.x + p.y + p.z) * ${N(`internal simplex F3`)(y)};
  let i = i32(floor(p.x + s));
  let j = i32(floor(p.y + s));
  let k = i32(floor(p.z + s));
  let t = f32(i + j + k) * ${N(`internal simplex G3`)(i)};
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
  let x1 = x0 - f32(i1) + ${N(`internal simplex G3`)(i)};
  let y1 = y0 - f32(j1) + ${N(`internal simplex G3`)(i)};
  let z1 = z0 - f32(k1) + ${N(`internal simplex G3`)(i)};
  let x2 = x0 - f32(i2) + ${N(`internal simplex 2*G3`)(2*i)};
  let y2 = y0 - f32(j2) + ${N(`internal simplex 2*G3`)(2*i)};
  let z2 = z0 - f32(k2) + ${N(`internal simplex 2*G3`)(2*i)};
  let x3 = x0 - 1f + ${N(`internal simplex 3*G3`)(3*i)};
  let y3 = y0 - 1f + ${N(`internal simplex 3*G3`)(3*i)};
  let z3 = z0 - 1f + ${N(`internal simplex 3*G3`)(3*i)};
  return ${N(`internal SIMPLEX_SCALE`)(72)} * (pcg_simplex_corner(seed, i, j, k, x0, y0, z0)
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
  var f1 = ${ue};
  var f2 = ${ue};
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
}`}]]);function me(e){let t=new Set,n=e=>{if(t.has(e))return;let r=pe.get(e);if(!r)throw Error(`internal: unknown WGSL library item "${e}"`);t.add(e);for(let e of r.deps)n(e)};for(let t of e)n(t);let r=[];for(let[e,n]of pe)t.has(e)&&r.push(n.text);return r}var he=`apply2`;function ge(e,t=!1){return e>0?16+e*16:t?16:12}var _e=[`x`,`y`,`z`,`w`];function P(e,t,n){if(t.kind===`const`)return ye(t,n);let r=be(e,t,n);return t.type===`f32`?r:`f32(${r})`}function ve(e,t,n){return t.kind===`const`?ye(t,n):be(e,t,n)}function ye(e,t){let n=e.tupleSize===1?0:t;if(n>=4)throw Error(`apply codegen: constant slot ${e.slot} has no component ${n} (a uniform slot holds 4 f32 components)`);return`params.consts[${e.slot}].${_e[n]}`}function be(e,t,n){return t.tupleSize===1?`${e}[i]`:n===0?`${e}[i * ${t.tupleSize}u]`:`${e}[i * ${t.tupleSize}u + ${n}u]`}function xe(e,t,n){return t===1?`${e}[i]`:n===0?`${e}[i * ${t}u]`:`${e}[i * ${t}u + ${n}u]`}var F=class{items=[];add(e,t,n,r){return this.items.push({role:e,access:t,elem:n,comment:r}),`b${this.items.length}`}};function Se(e){let t=0;for(let n of e)if(n.kind===`const`){if(n.slot<0||n.slot>=4)throw Error(`apply codegen: constant slot ${n.slot} is out of range; an apply kernel carries at most 4 uniform constant slots (raise MAX_APPLY_CONST_SLOTS in applyKernels.ts if a new node kind needs more)`);t=Math.max(t,n.slot+1)}return t}function I(e,t,n,r,i,a=!1){let o=[`@group(0) @binding(0) var<uniform> params: PcgParams;`],s=[];n.forEach((e,t)=>{let n=t+1,r=e.access===`read`?`read`:`read_write`;o.push(`@group(0) @binding(${n}) var<storage, ${r}> b${n}: array<${e.elem}>; // ${e.comment}`),s.push({binding:n,role:e.role,access:e.access})});let c=a?`
  base: u32,`:t===0?``:`
  _pad0: u32,`;return{wgsl:`// Generated by pcg-ts resident-run apply codegen.
// Dispatch: 1D, chunked; element index i = chunkOffset + gid.x, one
// invocation per element; only element i's slots are accessed.

struct PcgParams {
  count: u32,
  seed: u32,
  chunkOffset: u32,${t===0?c:`${c}\n  consts: array<vec4<f32>, ${t}>,`}
}

${o.join(`
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
`,entryPoint:`main`,workgroupSize:64,bindings:s,constSlots:t,uniformBytes:ge(t,a),key:`${he}|${e}`}}var L=e=>e.kind===`column`?`${e.type}x${e.tupleSize}`:`constx${e.tupleSize}@${e.slot}`;function Ce(e,t,n){let r=e.kind===`const`?`f32`:e.type,i=t===`f32`&&e.kind===`column`&&e.type===`f32`,a=i?`u32`:r,o=t===`bool`||i?`u32`:t,s=new F,c=e.kind===`column`?s.add(`value`,`read`,a,`value column ${L(e)}`):``,l=e.kind===`column`?{...e,type:a}:e,u=s.add(`target`,`read_write`,o,`target attribute ${t} tupleSize ${n}`),d=(e,n)=>{switch(t){case`f32`:return i?e:n;case`i32`:return r===`f32`?`i32(${e})`:r===`i32`?e:`bitcast<i32>(${e})`;case`u32`:return r===`f32`?`u32(${e})`:r===`u32`?e:`bitcast<u32>(${e})`;default:return`select(0u, 1u, ${e} != ${r===`f32`?`0f`:r===`i32`?`0i`:`0u`})`}},f=[];for(let e=0;e<n;e++){let t=ve(c,l,e);f.push(`  ${xe(u,n,e)} = ${d(t,P(c,l,e))};`)}return I(`setAttribute|val=${L(e)}|out=${t}x${n}`,Se([e]),s.items,[],f.join(`
`))}var we={euler:`fn pcg_quat_from_euler_deg(r: vec3<f32>) -> vec4<f32> {
  let h = r * ${A(Math.PI/360,`internal PI/360`)};
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
}`};function Te(e,t,n,r,i){let a=new F,o=e.kind===`column`?a.add(`translate`,`read`,e.type,`translate column ${L(e)}`):``,s=t.kind===`column`?a.add(`rotateEuler`,`read`,t.type,`rotateEuler column ${L(t)}`):``,c=n.kind===`column`?a.add(`scale`,`read`,n.type,`scale column ${L(n)}`):``,l=a.add(`P`,`read_write`,`f32`,`attribute P: f32 tupleSize 3`),u=r?a.add(`rot`,`read_write`,`f32`,`attribute rot: f32 tupleSize 4`):``,d=i?a.add(`scaleAttr`,`read_write`,`f32`,`attribute scale: f32 tupleSize 3`):``,f=[];return f.push(`  let s = vec3<f32>(${[0,1,2].map(e=>P(c,n,e)).join(`, `)});`),f.push(`  let q = pcg_quat_from_euler_deg(vec3<f32>(${[0,1,2].map(e=>P(s,t,e)).join(`, `)}));`),f.push(`  let v = pcg_rotate_vec(q, vec3<f32>(${l}[i * 3u] * s.x, ${l}[i * 3u + 1u] * s.y, ${l}[i * 3u + 2u] * s.z));`),f.push(`  ${l}[i * 3u] = v.x + ${P(o,e,0)};`),f.push(`  ${l}[i * 3u + 1u] = v.y + ${P(o,e,1)};`),f.push(`  ${l}[i * 3u + 2u] = v.z + ${P(o,e,2)};`),r&&(f.push(`  let q2 = pcg_quat_mul(q, vec4<f32>(${u}[i * 4u], ${u}[i * 4u + 1u], ${u}[i * 4u + 2u], ${u}[i * 4u + 3u]));`),f.push(`  ${u}[i * 4u] = q2.x;`),f.push(`  ${u}[i * 4u + 1u] = q2.y;`),f.push(`  ${u}[i * 4u + 2u] = q2.z;`),f.push(`  ${u}[i * 4u + 3u] = q2.w;`)),i&&(f.push(`  ${d}[i * 3u] = ${d}[i * 3u] * s.x;`),f.push(`  ${d}[i * 3u + 1u] = ${d}[i * 3u + 1u] * s.y;`),f.push(`  ${d}[i * 3u + 2u] = ${d}[i * 3u + 2u] * s.z;`)),I(`transformPoints|t=${L(e)}|r=${L(t)}|s=${L(n)}|rot=${+!!r}|scl=${+!!i}`,Se([e,t,n]),a.items,[we.euler,we.mul,we.rotate],f.join(`
`))}function Ee(e,t){let n=new F,r=e.kind===`column`?n.add(`amount`,`read`,e.type,`amount column ${L(e)}`):``,i=t?n.add(`seed`,`read`,`u32`,`attribute seed: u32 tupleSize 1`):``,a=n.add(`P`,`read_write`,`f32`,`attribute P: f32 tupleSize 3`),o=[];o.push(`  let ident = pcg_hash4(bitcast<u32>(${a}[i * 3u]), bitcast<u32>(${a}[i * 3u + 1u]), bitcast<u32>(${a}[i * 3u + 2u]), ${t?`${i}[i]`:`0u`});`);for(let t=0;t<3;t++){let n=t===0?`i * 3u`:`i * 3u + ${t}u`;o.push(`  ${a}[${n}] = ${a}[${n}] + (pcg_hash_float(pcg_hash3(params.seed, ident, ${t}u)) * 2f - 1f) * ${P(r,e,t)};`)}return I(`jitterPoints|a=${L(e)}|s=${+!!t}`,Se([e]),n.items,me([`pcg_hash3`,`pcg_hash4`,`pcg_hash_float`]),o.join(`
`))}var De={"+x":`f, u, -r`,"-x":`-f, u, r`,"+y":`-r, f, u`,"-y":`r, -f, u`,"+z":`r, u, f`,"-z":`-r, u, -f`};function Oe(e,t,n){let r=new F,i=e.kind===`column`?r.add(`direction`,`read`,e.type,`direction column ${L(e)}`):``,a=r.add(`rot`,`read_write`,`f32`,`attribute rot: f32 tupleSize 4`),o=A(1e-12,`internal ORIENT_PARALLEL_EPS`),s=`  let d = vec3<f32>(${[0,1,2].map(t=>P(i,e,t)).join(`, `)});
  let dl = dot(d, d);
  if (dl == 0f) {
    return; // zero direction: keep the prior rot
  }
  let f = d * (1f / sqrt(dl));
  let up = vec3<f32>(${[0,1,2].map(e=>P(``,n,e)).join(`, `)});
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
  let q = pcg_quat_from_basis(${De[t]});
  ${a}[i * 4u] = q.x;
  ${a}[i * 4u + 1u] = q.y;
  ${a}[i * 4u + 2u] = q.z;
  ${a}[i * 4u + 3u] = q.w;`;return I(`orientAlongVector|d=${L(e)}|axis=${t}|up=${L(n)}`,Se([e,n]),r.items,[we.basis],s)}function ke(e,t,n=!1,r=0){let i=r>0;if(i&&r<3)throw Error(`apply codegen: spawnInstances colour source has tupleSize ${r}; components 0-2 are read as RGB, so it must be at least 3 (the planner rejects narrower columns before reaching codegen)`);let a=new F,o=a.add(`P`,`read`,`f32`,`attribute P: f32 tupleSize 3`),s=e?a.add(`rot`,`read`,`f32`,`attribute rot: f32 tupleSize 4`):``,c=t?a.add(`scaleAttr`,`read`,`f32`,`attribute scale: f32 tupleSize 3`):``,l=a.add(`transforms`,`read_write`,`f32`,`out: 16 f32 per instance`),u=n?a.add(`perm`,`read`,`u32`,`grouping permutation: source point index per slot`):``,d=i?a.add(`color`,`read`,`f32`,`colour source: f32 tupleSize ${r}`):``,f=i?a.add(`colors`,`read_write`,`f32`,`out: 4 f32 per instance (vec3 storage stride, [3] = 0 pad)`):``,p=n?`src`:`i`,m=e?`vec4<f32>(${s}[${p} * 4u], ${s}[${p} * 4u + 1u], ${s}[${p} * 4u + 2u], ${s}[${p} * 4u + 3u])`:`vec4<f32>(0f, 0f, 0f, 1f)`,h=t?`vec3<f32>(${c}[${p} * 3u], ${c}[${p} * 3u + 1u], ${c}[${p} * 3u + 2u])`:`vec3<f32>(1f, 1f, 1f)`,g=`${n?`  let src = ${u}[params.base + i];\n`:``}  let q = ${m};
  let s = ${h};
  let x2 = q.x + q.x;
  let y2 = q.y + q.y;
  let z2 = q.z + q.z;
  let xx = q.x * x2;
  let xy = q.x * y2;
  let xz = q.x * z2;
  let yy = q.y * y2;
  let yz = q.y * z2;
  let zz = q.z * z2;
  let wx = q.w * x2;
  let wy = q.w * y2;
  let wz = q.w * z2;
  let o = i * 16u;
  ${l}[o] = (1f - (yy + zz)) * s.x;
  ${l}[o + 1u] = (xy + wz) * s.x;
  ${l}[o + 2u] = (xz - wy) * s.x;
  ${l}[o + 3u] = 0f;
  ${l}[o + 4u] = (xy - wz) * s.y;
  ${l}[o + 5u] = (1f - (xx + zz)) * s.y;
  ${l}[o + 6u] = (yz + wx) * s.y;
  ${l}[o + 7u] = 0f;
  ${l}[o + 8u] = (xz + wy) * s.z;
  ${l}[o + 9u] = (yz - wx) * s.z;
  ${l}[o + 10u] = (1f - (xx + yy)) * s.z;
  ${l}[o + 11u] = 0f;
  ${l}[o + 12u] = ${o}[${p} * 3u];
  ${l}[o + 13u] = ${o}[${p} * 3u + 1u];
  ${l}[o + 14u] = ${o}[${p} * 3u + 2u];
  ${l}[o + 15u] = 1f;${i?`
  // Same ${p}: this instance's colour is this instance's point's colour.
  let cs = ${p} * ${r}u;
  let co = i * 4u;
  ${f}[co] = ${d}[cs];
  ${f}[co + 1u] = ${d}[cs + 1u];
  ${f}[co + 2u] = ${d}[cs + 2u];
  ${f}[co + 3u] = 0f;`:``}`;return I(`spawnInstances|rot=${+!!e}|scl=${+!!t}${n?`|perm`:``}${i?`|color=${r}`:``}`,0,a.items,[],g,n)}var Ae=64,je=`wgsl2`,Me=[`x`,`y`,`z`,`w`];function R(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}function Ne(e,t,n){return new k(`${e}: ${t} has tupleSize ${n}, but GPU kernels support tuple sizes 1 to 4; evaluate this field on the CPU instead, or split it into components`)}function z(e,t,n){let r=1;for(let i of n)if(i!==1){if(r!==1&&r!==i)throw new k(`${t}: ${e}: incompatible tuple sizes ${r} and ${i}`);r=i}return r}var Pe=class{layout;params;lines=[];libRoots=new Set;usesSeed=!1;valueNumbers=new Map;bindings=new Map;helpers=new Map;helperTexts=[];helperCounters=new Map;varCounter=0;constructor(e,t,n){this.layout=e,this.params=n,t.forEach((t,n)=>{this.bindings.set(t,{name:t,varName:`in${n}`,binding:n+1,attr:e.attributes[t]})})}paramSlot(e){let t=this.params.slots.get(e);if(t===void 0)throw Error(`internal: param ${JSON.stringify(e)} was not pre-planned`);return{slot:t,arity:this.params.arities[t]}}attrIsSlot(e,t){let n=this.params.attrIsSlots.get(X(e,t));if(n===void 0)throw Error(`internal: attributeIs ${X(e,t)} was not pre-planned`);return n}emit(e,t){let n=this.valueNumbers.get(e);if(n)return n;let r={ref:`v${this.varCounter++}`,size:t};return this.lines.push(`  let ${r.ref} = ${e};`),this.valueNumbers.set(e,r),r}binding(e){let t=this.bindings.get(e);if(!t)throw Error(`internal: attribute ${JSON.stringify(e)} was not pre-bound`);return t}boundAttrs(){return[...this.bindings.values()]}helper(e,t){let n=this.helpers.get(t);if(n)return n;let r=this.helperCounters.get(e)??0;this.helperCounters.set(e,r+1);let i=`pcg_${e}_${r}`;return this.helpers.set(t,i),this.helperTexts.push(t.replaceAll(`@NAME@`,i)),i}helperBlocks(){return this.helperTexts}};function B(e,t){return e.size===t?e.ref:`vec${t}<f32>(${e.ref})`}function V(e){return e===1?`0f`:`vec${e}<f32>(0f)`}function H(e){return e===1?`1f`:`vec${e}<f32>(1f)`}function Fe(e,t){return e===1?t:`vec${e}<f32>(${t})`}function Ie(e){let t=Object.keys(e.attributes).sort();return t.length===0?`the layout declares no attributes`:`layout attributes: ${t.map(e=>JSON.stringify(e)).join(`, `)}`}function Le(e,t,n,r,i){let a=e.layout.attributes;if(!Object.hasOwn(a,n))throw new k(`${t}: ${i}attribute ${JSON.stringify(n)} is not in the kernel layout; ${Ie(e.layout)}`);let o=a[n];if(o.type===`string`)throw new k(`${t}: ${i}attribute ${JSON.stringify(n)} has type "string"; a string column has no numeric value to read — test it with { fn: "attributeIs", name: ${JSON.stringify(n)}, value: "..." }, which is 1 where it matches and 0 elsewhere, or select on it with { fn: "byAttribute", name: ${JSON.stringify(n)}, cases: {...}, default: ... }, or read a numeric or bool attribute`);if(r!==void 0&&o.tupleSize!==r)throw new k(`${t}: ${i}attribute ${JSON.stringify(n)}: expected tupleSize ${r}, got ${o.tupleSize} in the kernel layout`);if(o.tupleSize>4)throw Ne(t,`${i}attribute ${JSON.stringify(n)}`,o.tupleSize);return o}function Re(e,t,n,r,i){let a=Le(e,t,n,r,i),o=e.binding(n),s=a.tupleSize,c=e=>a.type===`f32`?e:`f32(${e})`;if(s===1)return e.emit(c(`${o.varName}[i]`),1);let l=[];for(let e=0;e<s;e++)l.push(c(`${o.varName}[${U(s,e)}]`));return e.emit(`vec${s}<f32>(${l.join(`, `)})`,s)}function U(e,t){return e===1?`i`:t===0?`i * ${e}u`:`i * ${e}u + ${t}u`}var W=new Map;function ze(){return[...W.keys()].sort()}function Be(e,t,n){let r=String(e.fn),i=W.get(r);if(!i)throw new k(`${t}: field fn "${r}" is not supported by the WGSL compiler; supported fns: ${ze().join(`, `)}`);return i(e,t,n)}function G(e,t,n){return typeof e==`number`?n.emit(A(e,t),1):Array.isArray(e)?Ve(e,t,n):Be(e,t,n)}function Ve(e,t,n){let r=e.length;if(r>4)throw Ne(t,`constant`,r);if(r===1)return n.emit(A(e[0],t),1);let i=e.map(e=>A(e,t));return n.emit(`vec${r}<f32>(${i.join(`, `)})`,r)}function K(e){return e.args}W.set(`constant`,(e,t,n)=>{let r=e.value;return typeof r==`number`?n.emit(A(r,`${t}.value`),1):Ve(r,`${t}.value`,n)}),W.set(`attribute`,(e,t,n)=>{let r=e.name,i=e.tupleSize;return Re(n,t,r,i,``)});function He(e,t,n,r,i){let a=e.layout.attributes;if(!Object.hasOwn(a,n))throw new k(`${t}: ${r}: attribute ${JSON.stringify(n)} is not in the kernel layout; ${Ie(e.layout)}`);let o=a[n];if(o.type!==`string`)throw new k(`${t}: ${r}: attribute ${JSON.stringify(n)} has type ${JSON.stringify(o.type)}, but ${r} ${i} a string attribute; compare a numeric attribute with { fn: "eq", args: [{ fn: "attribute", name: ${JSON.stringify(n)} }, <number>] }`);return o}W.set(`attributeIs`,(e,t,n)=>{let r=e.name,i=e.value,a=He(n,t,r,`attributeIs`,`tests`),o=n.binding(r),s=n.attrIsSlot(r,i);return n.emit(`select(0f, 1f, f32(${o.varName}[${U(a.tupleSize,0)}]) == params.consts[${s}].x)`,1)}),W.set(`byAttribute`,(e,t,n)=>{let r=e.name,i=e.cases,a=He(n,t,r,`byAttribute`,`selects on`),o=n.binding(r),s=Object.keys(i).sort(),c=s.map(e=>G(i[e],`${t}.cases[${JSON.stringify(e)}]`,n)),l=G(e.default,`${t}.default`,n),u=z(`byAttribute`,t,[...c.map(e=>e.size),l.size]),d=n.emit(`f32(${o.varName}[${U(a.tupleSize,0)}])`,1),f=B(l,u);return s.forEach((e,t)=>{let i=n.attrIsSlot(r,e);f=`select(${f}, ${B(c[t],u)}, ${d.ref} == params.consts[${i}].x)`}),n.emit(f,u)}),W.set(`position`,(e,t,n)=>Re(n,t,`P`,3,`position reads `)),W.set(`param`,(e,t,n)=>{let r=e.name,i=p(e);if(i!==void 0)return Be(i,`${t}<${r}>`,n);let{slot:a,arity:o}=n.paramSlot(r),s=e=>`params.consts[${a}].${Me[e]}`;return o===1?n.emit(s(0),1):n.emit(`vec${o}<f32>(${Array.from({length:o},(e,t)=>s(t)).join(`, `)})`,o)}),W.set(`index`,(e,t,n)=>n.emit(`f32(i)`,1)),W.set(`fraction`,(e,t,n)=>n.emit(`f32(i) / f32(max(params.count, 2u) - 1u)`,1)),W.set(`nodeSeed`,(e,t,n)=>(n.usesSeed=!0,n.emit(`f32(params.seed >> 8u) * 256.0 + f32(params.seed & 0xFFu)`,1))),W.set(`randomField`,(e,t,n)=>{let r=e.key,i=typeof r==`string`?b(r):(r??0)>>>0;n.usesSeed=!0,n.libRoots.add(`pcg_hash3`),n.libRoots.add(`pcg_hash4`),n.libRoots.add(`pcg_hash_float`);let a=`randomField's per-point identity reads `,o=Le(n,t,`P`,void 0,a);if(o.tupleSize<3)throw new k(`${t}: ${a}attribute "P" with x, y and z (tupleSize 3), got tupleSize ${o.tupleSize}`);let s=n.binding(`P`).varName,c=e=>{let t=`${s}[${U(o.tupleSize,e)}]`;return o.type===`f32`?`bitcast<u32>(${t})`:`bitcast<u32>(f32(${t}))`},l=`0u`,u=Object.hasOwn(n.layout.attributes,`seed`)?n.layout.attributes.seed:void 0;if(u!==void 0){if(u.tupleSize!==1||u.type!==`u32`&&u.type!==`i32`)throw new k(`${t}: ${a}the standard point attribute "seed" as a u32 or i32 scalar, but the layout has it as ${u.type}x${u.tupleSize}; this field resolves on the CPU instead`);let e=n.binding(`seed`).varName;l=u.type===`u32`?`${e}[i]`:`bitcast<u32>(${e}[i])`}let d=`pcg_hash4(${c(0)}, ${c(1)}, ${c(2)}, ${l})`;return n.emit(`pcg_hash_float(pcg_hash3(params.seed, ${j(i)}, ${d}))`,1)});function q(e,t,n){W.set(e,(r,i,a)=>{let o=K(r),s=[];for(let e=0;e<t;e++)s.push(G(o[e],`${i}.args[${e}]`,a));let c=z(e,i,s.map(e=>e.size)),l=s.map(e=>B(e,c));return a.emit(n(l,c),c)})}q(`add`,2,e=>`${e[0]} + ${e[1]}`),q(`sub`,2,e=>`${e[0]} - ${e[1]}`),q(`mul`,2,e=>`${e[0]} * ${e[1]}`),q(`div`,2,e=>`${e[0]} / ${e[1]}`),q(`min`,2,e=>`min(${e[0]}, ${e[1]})`),q(`max`,2,e=>`max(${e[0]}, ${e[1]})`),q(`abs`,1,e=>`abs(${e[0]})`),q(`floor`,1,e=>`floor(${e[0]})`),q(`fract`,1,e=>`${e[0]} - floor(${e[0]})`),q(`mod`,2,e=>`${e[0]} - ${e[1]} * floor(${e[0]} / ${e[1]})`),q(`sign`,1,(e,t)=>`select(${V(t)}, ${H(t)}, ${e[0]} > ${V(t)}) - select(${V(t)}, ${H(t)}, ${e[0]} < ${V(t)})`),q(`sin`,1,e=>`sin(${e[0]})`),q(`cos`,1,e=>`cos(${e[0]})`),q(`tan`,1,e=>`tan(${e[0]})`),q(`asin`,1,e=>`asin(${e[0]})`),q(`acos`,1,e=>`acos(${e[0]})`),q(`atan`,1,e=>`atan(${e[0]})`),q(`atan2`,2,e=>`atan2(${e[0]}, ${e[1]})`),q(`sqrt`,1,e=>`sqrt(${e[0]})`),q(`pow`,2,e=>`pow(${e[0]}, ${e[1]})`),q(`exp`,1,e=>`exp(${e[0]})`),q(`log`,1,e=>`log(${e[0]})`),q(`clamp`,3,e=>`clamp(${e[0]}, ${e[1]}, ${e[2]})`),q(`lerp`,3,e=>`${e[0]} + (${e[1]} - ${e[0]}) * ${e[2]}`),q(`select`,3,(e,t)=>`select(${e[2]}, ${e[1]}, ${e[0]} != ${V(t)})`),q(`lt`,2,(e,t)=>`select(${V(t)}, ${H(t)}, ${e[0]} < ${e[1]})`),q(`le`,2,(e,t)=>`select(${V(t)}, ${H(t)}, ${e[0]} <= ${e[1]})`),q(`gt`,2,(e,t)=>`select(${V(t)}, ${H(t)}, ${e[0]} > ${e[1]})`),q(`ge`,2,(e,t)=>`select(${V(t)}, ${H(t)}, ${e[0]} >= ${e[1]})`),q(`eq`,2,(e,t)=>`select(${V(t)}, ${H(t)}, ${e[0]} == ${e[1]})`),q(`ne`,2,(e,t)=>`select(${V(t)}, ${H(t)}, ${e[0]} != ${e[1]})`),q(`step`,2,(e,t)=>`select(${V(t)}, ${H(t)}, ${e[1]} >= ${e[0]})`),W.set(`remap`,(e,t,n)=>{let r=K(e).map((e,r)=>G(e,`${t}.args[${r}]`,n)),i=z(`remap`,t,r.map(e=>e.size)),[a,o,s,c,l]=r.map(e=>B(e,i)),u=n.emit(`${s} - ${o}`,i),d=V(i),f=n.emit(`select(${u.ref}, ${H(i)}, ${u.ref} == ${d})`,i);return n.emit(`select(${c} + ((${a} - ${o}) / ${f.ref}) * (${l} - ${c}), ${c}, ${u.ref} == ${d})`,i)}),W.set(`dot`,(e,t,n)=>{let r=K(e),i=G(r[0],`${t}.args[0]`,n),a=G(r[1],`${t}.args[1]`,n),o=z(`dot`,t,[i.size,a.size]);return o===1?n.emit(`${i.ref} * ${a.ref}`,1):n.emit(`dot(${B(i,o)}, ${B(a,o)})`,1)}),W.set(`cross`,(e,t,n)=>{let r=K(e),i=G(r[0],`${t}.args[0]`,n),a=G(r[1],`${t}.args[1]`,n);for(let[e,n]of[[`a`,i],[`b`,a]])if(n.size!==3)throw new k(`${t}: cross: argument \`${e}\` has width ${n.size}, but a cross product is defined for width 3 only. Scalars do NOT broadcast into one here — build a vec3 with \`vec(x, y, z)\`, or use \`dot\` for a product that works at any width.`);return n.emit(`cross(${i.ref}, ${a.ref})`,3)}),W.set(`smoothstep`,(e,t,n)=>{let r=K(e).map((e,r)=>G(e,`${t}.args[${r}]`,n)),i=z(`smoothstep`,t,r.map(e=>e.size)),[a,o,s]=r.map(e=>B(e,i)),c=V(i),l=H(i),u=n.emit(`select(${c}, ${l}, ${a} == ${o})`,i),d=n.emit(`${o} - ${a}`,i),f=n.emit(`select(${d.ref}, ${l}, ${u.ref} != ${c})`,i),p=n.emit(`clamp((${s} - ${a}) / ${f.ref}, ${c}, ${l})`,i),m=n.emit(`(${p.ref} * ${p.ref}) * (${Fe(i,`3f`)} - ${Fe(i,`2f`)} * ${p.ref})`,i);return n.emit(`select(${m.ref}, select(${c}, ${l}, ${s} >= ${a}), ${u.ref} != ${c})`,i)}),W.set(`distance`,(e,t,n)=>{let r=K(e),i=G(r[0],`${t}.args[0]`,n),a=G(r[1],`${t}.args[1]`,n),o=z(`distance`,t,[i.size,a.size]),s=n.emit(`${B(i,o)} - ${B(a,o)}`,o);if(o===1)return n.emit(`abs(${s.ref})`,1);let c=n.emit(`dot(${s.ref}, ${s.ref})`,1);return n.emit(`sqrt(${c.ref})`,1)}),W.set(`length`,(e,t,n)=>{let r=G(K(e)[0],`${t}.args[0]`,n);if(r.size===1)return n.emit(`abs(${r.ref})`,1);let i=n.emit(`dot(${r.ref}, ${r.ref})`,1);return n.emit(`sqrt(${i.ref})`,1)}),W.set(`normalize`,(e,t,n)=>{let r=G(K(e)[0],`${t}.args[0]`,n),i=r.size===1?n.emit(`${r.ref} * ${r.ref}`,1):n.emit(`dot(${r.ref}, ${r.ref})`,1),a=n.emit(`select(0f, 1f / sqrt(${i.ref}), ${i.ref} > 0f)`,1);return n.emit(`${r.ref} * ${a.ref}`,r.size)}),W.set(`vec`,(e,t,n)=>{let r=K(e).map((e,r)=>G(e,`${t}.args[${r}]`,n)),i=r.reduce((e,t)=>e+t.size,0);if(i>4)throw Ne(t,`vec result`,i);return r.length===1?r[0]:n.emit(`vec${i}<f32>(${r.map(e=>e.ref).join(`, `)})`,i)}),W.set(`component`,(e,t,n)=>{let r=G(K(e)[0],`${t}.args[0]`,n),i=e.index;if(i>=r.size)throw new k(`${t}: component: index ${i} out of range for tupleSize ${r.size}`);return r.size===1?r:n.emit(`${r.ref}.${Me[i]}`,1)}),W.set(`ramp`,(e,t,n)=>{let r=G(K(e)[0],`${t}.args[0]`,n);if(r.size!==1)throw new k(`${t}: ramp: input must be scalar, got tupleSize ${r.size}`);let i=e.stops,a=n.helper(`ramp`,Ue(i,`${t}.stops`));return n.emit(`${a}(${r.ref})`,1)});function Ue(e,t){let n=e=>A(e,t),r=e.length-1,i=[];i.push(`fn @NAME@(t: f32) -> f32 {`),i.push(`  if (t <= ${n(e[0][0])}) {`),i.push(`    return ${n(e[0][1])};`),i.push(`  }`),i.push(`  if (t >= ${n(e[r][0])}) {`),i.push(`    return ${n(e[r][1])};`),i.push(`  }`);let a=t=>{let r=e[t-1][0],i=e[t-1][1],a=e[t][0]-r,o=e[t][1]-i;return`${n(i)} + ${n(o)} * ((t - ${n(r)}) / ${n(a)})`};for(let t=1;t<r;t++)i.push(`  if (t <= ${n(e[t][0])}) {`),i.push(`    return ${a(t)};`),i.push(`  }`);return r>=1?i.push(`  return ${a(r)};`):i.push(`  return t;`),i.push(`}`),i.join(`
`)}var We={valueNoise:e,perlinNoise:c,simplexNoise:S,worleyNoise:re},Ge={valueNoise:`pcg_value_noise`,perlinNoise:`pcg_perlin_noise`,simplexNoise:`pcg_simplex_noise`};function J(e){return e.opts??{}}function Ke(e,t,n,r){let i=J(t),a=i.position===void 0?n:`${n}.opts.position`,o=i.position===void 0?Re(r,n,`P`,3,`${e} position reads `):G(i.position,a,r);if(o.size!==3)throw new k(`${a}: ${e}: position field must have tupleSize 3, got ${o.size}`);let s=A(i.frequency??1,`${n}.opts.frequency`),[c,l,u]=i.offset??[0,0,0],d=`vec3<f32>(${A(c,`${n}.opts.offset`)}, ${A(l,`${n}.opts.offset`)}, ${A(u,`${n}.opts.offset`)})`;return r.emit(`${o.ref} * ${s} + ${d}`,3)}function qe(e){return e.libRoots.add(`pcg_hash_mix`),e.libRoots.add(`pcg_hash_finalize`),e.helper(`hash2`,`fn @NAME@(a: u32, b: u32) -> u32 {
  return pcg_hash_finalize(pcg_hash_mix(pcg_hash_mix(${j(t(2))}, a), b));
}`)}function Je(e){return typeof e==`object`&&!!e}function Ye(e,t,n){if(e===void 0)return`0u`;if(typeof e==`number`)return le(e);let r=e.name;if(typeof r!=`string`||r===``)throw new k(`${t}.opts.seed.variant: param requires a non-empty string name`);if(p(e)!==void 0)throw new k(`${t}.opts.seed.variant: param ${JSON.stringify(r)} is bound to a Field, and a seed is resolved in u32 integer math with no per-element form; bind an integer, or evaluate this field on the CPU`);let{slot:i}=n.paramSlot(r);return`u32(params.consts[${i}].x)`}function Xe(e,t,n){return Je(e)?(n.usesSeed=!0,{expr:`${qe(n)}(params.seed, ${Ye(e.variant,t,n)})`}):{literal:(e??0)>>>0}}function Ze(e,t,n){let r=We[e];return`literal`in t?j(T(r,t.literal)):`${qe(n)}(${j(r)}, ${t.expr})`}function Qe(e,t,n,r){let[i,a]=n,o=a-i;return e.emit(`(${t.ref} - ${A(i,r)}) / ${A(o,r)}`,1)}for(let e of[`valueNoise`,`perlinNoise`,`simplexNoise`])W.set(e,(t,n,r)=>{let i=J(t),a=Ze(e,Xe(i.seed,n,r),r),o=Ke(e,t,n,r);r.libRoots.add(Ge[e]);let s=r.emit(`${Ge[e]}(${a}, ${o.ref})`,1);return i.normalized===!0?Qe(r,s,C[e],`${n}.opts.normalized`):s});W.set(`worleyNoise`,(e,t,n)=>{let r=J(e),i=r.output??`f1`,a=r.exact===!0,o=Ze(`worleyNoise`,Xe(r.seed,t,n),n),s=Ke(`worleyNoise`,e,t,n);n.libRoots.add(`pcg_worley`);let c=i!==`f1`,l=n.emit(`pcg_worley(${o}, ${s.ref}, ${a}, ${c})`,2),u=i===`f1`?n.emit(`${l.ref}.x`,1):i===`f2`?n.emit(`${l.ref}.y`,1):n.emit(`${l.ref}.y - ${l.ref}.x`,1);return r.normalized===!0?Qe(n,u,C.worleyNoise[i],`${t}.opts.normalized`):u});function $e(e){return e===`worleyNoise`?C.worleyNoise.f1:C[e]}function et(e,t,n){return e===`worleyNoise`?`pcg_worley(${t}, ${n}, false, false).x`:`${Ge[e]}(${t}, ${n})`}W.set(`fbm`,(e,t,n)=>{let r=e.base,i=J(e),a=i.octaves??4,o=i.lacunarity??2,s=i.gain??.5,c=i.frequency??1,[l,u,d]=i.offset??[0,0,0],f=Xe(i.seed,t,n),p=i.position===void 0?t:`${t}.opts.position`,m=i.position===void 0?Re(n,t,`P`,3,`fbm position reads `):G(i.position,p,n);if(m.size!==3)throw new k(`${p}: fbm: position field must have tupleSize 3, got ${m.size}`);let h=$e(r),g=[],_=[],v=[],y=1,b=c,x=0,S=0;for(let e=0;e<a;e++)g.push(Ze(r,`literal`in f?{literal:ie(f.literal,e)}:{expr:`${qe(n)}(ns, ${le(e)})`},n)),_.push(A(b,`${t}.opts.frequency`)),v.push(A(y,`${t}.opts.gain`)),x+=y>=0?y*h[0]:y*h[1],S+=y>=0?y*h[1]:y*h[0],y*=s,b*=o;n.libRoots.add(r===`worleyNoise`?`pcg_worley`:Ge[r]);let C=`vec3<f32>(${A(l,`${t}.opts.offset`)}, ${A(u,`${t}.opts.offset`)}, ${A(d,`${t}.opts.offset`)})`,w=`fn @NAME@(p: vec3<f32>) -> f32 {
${`literal`in f?``:`  let ns = ${f.expr};\n`}  var seeds = array<u32, ${a}>(${g.join(`, `)});
  var freqs = array<f32, ${a}>(${_.join(`, `)});
  var amps = array<f32, ${a}>(${v.join(`, `)});
  var sum = 0f;
  for (var o = 0u; o < ${le(a)}; o++) {
    sum = sum + ${et(r,`seeds[o]`,`p * freqs[o] + `+C)} * amps[o];
  }
  return sum;
}`,T=n.helper(`fbm`,w),E=n.emit(`${T}(${m.ref})`,1);if(i.normalized!==!0)return E;if(!(S>x))throw new k(`${t}: fbm: normalized: true needs a non-degenerate output range, got [${x}, ${S}] for this octaves/gain configuration`);return Qe(n,E,[x,S],`${t}.opts.normalized`)});var tt=new Set([`valueNoise`,`perlinNoise`,`simplexNoise`,`worleyNoise`,`fbm`]);function Y(e,t){if(!R(e))return;let n=e.fn;if(n===`param`){let n=p(e);n!==void 0&&Y(n,t);return}if(n===`attribute`||n===`attributeIs`){typeof e.name==`string`&&t.add(e.name);return}if(n===`byAttribute`){typeof e.name==`string`&&t.add(e.name);for(let n of E(e))Y(n,t);return}if(n===`position`){t.add(`P`);return}if(n===`randomField`){t.add(`P`),t.add(`seed`);return}if(typeof n==`string`&&tt.has(n)){let n=e.opts;R(n)&&n.position!==void 0?Y(n.position,t):t.add(`P`);return}let r=e.args;if(Array.isArray(r))for(let e of r)Y(e,t)}var nt=16;function X(e,t){return`${JSON.stringify(e)},${JSON.stringify(t)}`}var rt={names:[],slots:new Map,arities:[],attrIs:[],attrIsSlots:new Map};function it(e){return typeof e==`number`?1:e.length}function at(e,t){if(R(e)){if(t(e),e.fn===`param`){let n=p(e);n!==void 0&&at(n,t);return}for(let n of E(e))at(n,t)}}function ot(e){let t=ct.get(e);if(t!==void 0)return t;let n=lt.get(e);if(n!==void 0)throw n;try{let t=st(e);return ct.set(e,t),t}catch(t){throw t instanceof k&&lt.set(e,t),t}}function st(e){let t=new Map,r=new Set,i=new Map;if(at(e,e=>{if(e.fn===`attributeIs`){if(typeof e.name!=`string`||e.name===``||typeof e.value!=`string`)return;i.set(X(e.name,e.value),{attr:e.name,value:e.value});return}if(e.fn===`byAttribute`){if(typeof e.name!=`string`||e.name===``||!R(e.cases))return;for(let t of Object.keys(e.cases))i.set(X(e.name,t),{attr:e.name,value:t});return}if(e.fn!==`param`||typeof e.name!=`string`||e.name===``)return;let a=e.name;if(p(e)!==void 0)return;if(n(e))throw new k(`param ${JSON.stringify(a)} is bound to a Field that carries no spec (a makeField closure, or something composed over one), so there is nothing to compile in its place; this expression evaluates on the CPU — build the bound field with the grammar constructors or fieldFromJson if it should lower`);r.add(a);let o=D(e);if(o===void 0)return;let s=it(o);if(s>4)throw new k(`param ${JSON.stringify(a)} is bound to a ${s}-tuple, but a uniform slot holds 4 components; bind a tuple of 1 to 4, or evaluate this field on the CPU`);let c=t.get(a);if(c!==void 0&&c!==s)throw new k(`param ${JSON.stringify(a)} is bound to a ${c}-tuple in one place and a ${s}-tuple in another within the same expression; one uniform slot serves the name, so both references must have the same arity`);t.set(a,s)}),r.size===0&&i.size===0)return rt;let a=[...r].sort(),o=[...i.keys()].sort(),s=a.length+o.length;if(s>nt)throw new k(`this field needs ${s} uniform constant slots (${a.length} distinct params and ${o.length} distinct string literals across its attributeIs tests and byAttribute case keys), but a kernel carries at most ${nt}; split the expression, or evaluate it on the CPU (raise MAX_FIELD_CONST_SLOTS in compile.ts if an expression legitimately needs more)`);return{names:a,slots:new Map(a.map((e,t)=>[e,t])),arities:a.map(e=>t.get(e)??1),attrIs:o.map(e=>i.get(e)),attrIsSlots:new Map(o.map((e,t)=>[e,a.length+t]))}}var ct=new WeakMap,lt=new WeakMap,ut=new WeakMap;function dt(e){let t=``;return e.names.length>0&&(t+=`|params=[${e.names.map((t,n)=>`${JSON.stringify(t)}:${e.arities[n]}`).join(`,`)}]`),e.attrIs.length>0&&(t+=`|attrIs=[${e.attrIs.map(e=>X(e.attr,e.value)).join(`;`)}]`),t}function ft(e,t){let n=ot(e);if(n.names.length===0&&n.attrIs.length===0)return t;let r=ut.get(e);if(r!==void 0)return r;let i=`${d(e).key}${dt(n)}`;return ut.set(e,i),i}function pt(e,t){return e.length===t.length&&e.every((e,n)=>Object.is(e,t[n]))}function mt(e,t){return t.constSlots===0?{values:[]}:t.attrIsSlots.length>0?{problem:`this kernel carries ${t.attrIsSlots.length} string-literal slot(s) (${t.attrIsSlots.map(e=>`${JSON.stringify(e.attr)} == ${JSON.stringify(e.value)}`).join(`, `)}) whose values are string-table indices of the geometry being cooked; fill them with constSlotValues, which takes that geometry's attribute set`}:ht(e,t)}function ht(e,t){let n=new Map,r;if(at(e,e=>{if(e.fn!==`param`||typeof e.name!=`string`||e.name===``)return;let t=e.name;if(p(e)!==void 0)return;let i=D(e);if(i===void 0){r??=`param ${JSON.stringify(t)} has no bound value`;return}let a=typeof i==`number`?[i]:[...i],o=n.get(t);o===void 0?n.set(t,a):pt(o,a)||(r??=`param ${JSON.stringify(t)} is bound to two different values in one expression`)}),r!==void 0)return{problem:r};let i=[];for(let e of t.paramNames){let t=n.get(e);if(t===void 0)return{problem:`param ${JSON.stringify(e)} is not referenced by this spec`};for(let e=0;e<4;e++)i.push(e<t.length?t[e]:0)}return{values:i}}var gt=-1;function _t(e,t,n){if(t.constSlots===0)return{values:[]};let r=ht(e,t);if(`problem`in r||t.attrIsSlots.length===0)return r;let i=[...r.values];for(let e of t.attrIsSlots){let t=n.get(e.attr);if(t===void 0||t.type!==`string`)return{problem:`attributeIs ${JSON.stringify(e.attr)}: this geometry has no string attribute of that name (${t===void 0?`no such attribute`:`it is ${t.type}`}), so the literal has no index to resolve to`};let r=t.lookupString(e.value)??gt;for(let e=0;e<4;e++)i.push(e===0?r:0)}return{values:i}}var vt=new Set([`f32`,`i32`,`u32`,`bool`,`string`]);function yt(e){if(!R(e)||!R(e.attributes))throw new k(`compileFieldSpec: layout must be { attributes: { name: { type, tupleSize } } }`);for(let[t,n]of Object.entries(e.attributes)){if(!R(n)||!vt.has(n.type))throw new k(`kernel layout attribute ${JSON.stringify(t)}: unknown type ${JSON.stringify(n?.type)}; valid types: "f32", "i32", "u32", "bool", "string" (a string column binds as u32 and is readable only through attributeIs)`);let e=n.tupleSize;if(typeof e!=`number`||!Number.isInteger(e)||e<1)throw new k(`kernel layout attribute ${JSON.stringify(t)}: tupleSize must be a positive integer, got ${String(e)}`)}}function bt(e){return typeof e==`number`?{fn:`constant`,value:e}:Array.isArray(e)?{fn:`constant`,value:[...e]}:e}function xt(e){return e.type===`bool`||e.type===`string`?`u32`:e.type}function St(e,t){yt(t);let n=bt(e),r=d(n),i=new Set;Y(n,i);let a=[...i].filter(e=>Object.hasOwn(t.attributes,e)).sort(),o=ot(n),s=new Pe(t,a,o),c=`f32`,l=0,u=[],f=e=>{if(l=e.size,e.size===1)u.push(`  outBuf[i] = ${e.ref};`);else for(let t=0;t<e.size;t++)u.push(`  outBuf[${U(e.size,t)}] = ${e.ref}.${Me[t]};`)},p=n.fn===`attribute`?n.name:n.fn===`position`?`P`:void 0;if(n.fn===`index`)c=`u32`,l=1,u.push(`  outBuf[i] = i;`);else if(p!==void 0){let e=Le(s,`$`,p,n.fn===`position`?3:n.tupleSize,n.fn===`position`?`position reads `:``);if(e.type===`i32`||e.type===`u32`){c=e.type,l=e.tupleSize;let t=s.binding(p);for(let n=0;n<e.tupleSize;n++)u.push(`  outBuf[${U(e.tupleSize,n)}] = ${t.varName}[${U(e.tupleSize,n)}];`)}else f(Be(n,`$`,s))}else f(Be(n,`$`,s));let m=s.boundAttrs(),h=m.map(e=>({name:e.name,type:xt(e.attr),tupleSize:e.attr.tupleSize,binding:e.binding})),g=m.length+1,_=[`@group(0) @binding(0) var<uniform> params: PcgParams;`];for(let e of m)_.push(`@group(0) @binding(${e.binding}) var<storage, read> ${e.varName}: array<${xt(e.attr)}>; // attribute ${JSON.stringify(e.name)}: ${e.attr.type} tupleSize ${e.attr.tupleSize}`);_.push(`@group(0) @binding(${g}) var<storage, read_write> outBuf: array<${c}>;`);let v=o.names.length+o.attrIs.length,y=[`// Generated by pcg-ts compileFieldSpec (WGSL field kernel).
// Dispatch: 1D, chunked; each chunk runs ceil(chunkElements / ${Ae}) workgroups of ${Ae}
// with element index i = chunkOffset + gid.x; one invocation per element.

struct PcgParams {
  count: u32,
  seed: u32,
  chunkOffset: u32,${v===0?``:`\n  _pad0: u32,\n  consts: array<vec4<f32>, ${v}>,`}
}

${_.join(`
`)}`,...me(s.libRoots),...s.helperBlocks(),`@compute @workgroup_size(${Ae})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x + params.chunkOffset;
  if (i >= params.count) {
    return;
  }
${[...s.lines,...u].join(`
`)}
}`],b=m.map(e=>`${JSON.stringify(e.name)}:${e.attr.type}x${e.attr.tupleSize}`).join(`,`),x=`${r.key}${dt(o)}`;return ut.set(n,x),{wgsl:`${y.join(`

`)}\n`,entryPoint:`main`,workgroupSize:Ae,outTupleSize:l,outType:c,inputs:h,bindings:{uniforms:0,output:g},constSlots:v,paramNames:o.names,attrIsSlots:o.attrIs,uniformBytes:ge(v),usesSeed:s.usesSeed,key:`${je}|spec=${x}|layout=[${b}]`}}var Z={MAP_READ:1,COPY_SRC:4,COPY_DST:8,VERTEX:32,UNIFORM:64,STORAGE:128},Ct={READ:1},wt=256;function Tt(e){let t=wt;for(;t<e;)t*=2;return t}var Et=class{device;maxPooledBytes;free=new Map;meta=new Map;detachedSet=new WeakSet;idleBytes=0;idleCount=0;created=0;reused=0;destroyed=0;detachedTotal=0;detachedLive=0;detachedLiveBytes=0;constructor(e,t){this.device=e,this.maxPooledBytes=t}acquire(e,t){let n=Tt(e),r=`${t}|${n}`,i=this.free.get(r)?.pop();if(i!==void 0)return this.idleBytes-=n,this.idleCount--,this.reused++,i;let a=this.device.createBuffer({size:n,usage:t});return this.meta.set(a,{key:r,bytes:n}),this.created++,a}release(e){let t=this.meta.get(e);if(t===void 0)throw this.detachedSet.has(e)?Error(`BufferPool.release: buffer was detached from this pool, so the pool no longer owns it and cannot reclaim it; destroy it through the DetachedBuffer that detach() returned (or the handle wrapping it) and stop releasing it`):Error(`BufferPool.release: buffer was not acquired from this pool`);if(this.idleBytes+t.bytes>this.maxPooledBytes){this.meta.delete(e),e.destroy(),this.destroyed++;return}let n=this.free.get(t.key);n===void 0&&(n=[],this.free.set(t.key,n)),n.push(e),this.idleBytes+=t.bytes,this.idleCount++}detach(e){let t=this.meta.get(e);if(t===void 0)throw Error(this.detachedSet.has(e)?`BufferPool.detach: buffer was already detached from this pool; ownership can only leave once — reuse the DetachedBuffer the first detach() returned`:`BufferPool.detach: buffer was not acquired from this pool`);this.meta.delete(e),this.detachedSet.add(e),this.detachedTotal++,this.detachedLive++,this.detachedLiveBytes+=t.bytes;let n=!1,r=this;return{buffer:e,bytes:t.bytes,get destroyed(){return n},destroy(){n||(n=!0,r.detachedLive--,r.detachedLiveBytes-=t.bytes,r.destroyed++,e.destroy())}}}get stats(){return{buffersCreated:this.created,buffersReused:this.reused,buffersDestroyed:this.destroyed,pooledBuffers:this.idleCount,pooledBytes:this.idleBytes,buffersDetached:this.detachedTotal,detachedBuffers:this.detachedLive,detachedBytes:this.detachedLiveBytes}}dispose(){for(let e of this.free.values())for(let t of e)this.meta.delete(t),t.destroy(),this.destroyed++;this.free.clear(),this.idleBytes=0,this.idleCount=0}},Dt=`webgpu`,Ot=class{backend=Dt;byteLength;detached;label;constructor(e,t,n){this.detached=e,this.byteLength=t,this.label=n}get disposed(){return this.detached.destroyed}get resource(){if(this.detached.destroyed)throw Error(`device transforms handle (${this.label}) was disposed; its GPU buffer is destroyed and cannot be bound. Dispose a handle only after the last frame that reads it, and re-cook to obtain a fresh one (device-resident outputs are never memoized, so every cook produces a new handle)`);return this.detached.buffer}dispose(){this.detached.destroy()}};function kt(e,t,n){return new Ot(e,t,n)}var At=65535;function jt(e,t){let n=At*e;return Math.max(e,Math.floor(Math.min(t??n,n)/e)*e)}var Mt=16,Nt=`pcg-resident-run/5`;function Pt(e){return e.format===Nt?e:null}var Ft={reason:`run-plan-failed`},It=[`+x`,`-x`,`+y`,`-y`,`+z`,`-z`];function Lt(e){if(typeof e!=`object`||!e||Array.isArray(e))return!1;let t=e;if(t.fn===`randomField`)return!0;for(let e of E(t))if(Lt(e))return!0;return!1}function Rt(e){return Array.isArray(e)&&e.length===3&&e.every(e=>typeof e==`number`&&Number.isFinite(e))}var Q=class extends Error{};function zt(e,t,n,r,i){let a=[...e].map(([e,t])=>({name:e,slot:t})),o=i||r===null,s=t.reduce((e,t)=>e+t.bytes,0),c=n.reduce((e,t)=>e+t,0),l=o?a.reduce((e,n)=>e+t[n.slot].bytes,0):0;return{writtenList:a,materialize:o,totalBytes:s+c+l+(r?.bytes??0)+(r?.colorBytes??0)+(r?.permBytes??0)}}function Bt(e,t,n,r){let i=t.count,o=new Map(Object.entries(t.attributes)),s=[],c=new Map,l=[],u=new Map,d=[],f=[],p=null,m=()=>Object.fromEntries(o),h=e=>{let t=c.get(e);if(t!==void 0)return t;let n=o.get(e);if(n===void 0||n.type===`string`)throw new Q(e);let r=s.length;return s.push({bytes:i*n.tupleSize*4,init:`attr`,name:e}),c.set(e,r),r},_=(e,t,n)=>{let r=s.length;return s.push({bytes:i*t*4,init:n,name:e}),c.set(e,r),r},v=(e,t,n)=>{let r=o.get(e);if(r===void 0||r.type!==t||r.tupleSize!==n)throw new Q(e)},y=(e,t,n)=>{let r=t.length/4;if(r>=4)throw Error(`resident run: "${n}" needs more than 4 uniform constant slots for its constant params; raise MAX_APPLY_CONST_SLOTS in applyKernels.ts (each slot costs 16 bytes of the per-chunk uniform and nothing else)`);for(let n=0;n<4;n++)t.push(n<e.length?e[n]:0);return{kind:`const`,tupleSize:e.length,slot:r}},b=(e,t,n,o,s,c)=>{let d;if(a(e)){let t=g(e,r);if(t===void 0)throw new Q(`no spec`);if(u.has(`P`)&&Lt(t))throw new Q(`identity after P write`);d=t}else if(typeof e==`number`||Array.isArray(e)&&e.every(e=>typeof e==`number`)){let t=typeof e==`number`?[e]:e;if(t.length<1||t.length>4||o!==null&&!o.includes(t.length))throw new Q(`tuple`);for(let e of t)if(!Number.isFinite(Math.fround(e)))throw new Q(`f32 range`);return{param:y(t,s,c),ref:null}}else throw new Q(`bad param value`);let f;try{f=St(d,{attributes:m()})}catch{throw new Q(`compile`)}if(f.inputs.length+1>8)throw new Q(`buffers`);if(o!==null&&!o.includes(f.outTupleSize))throw new Q(`tuple`);if(f.attrIsSlots.length>0)throw new Q(`attributeIs / byAttribute need a per-dispatch string table`);let p=mt(d,f);if(`problem`in p)throw new Q(`param bindings`);let _=l.length;return l.push(i*f.outTupleSize*4),n.push({key:f.key,wgsl:f.wgsl,entryPoint:f.entryPoint,workgroupSize:f.workgroupSize,seed:t,uniformsBinding:f.bindings.uniforms,uniformBytes:f.uniformBytes,consts:p.values,perBatch:!1,bindings:[...f.inputs.map(e=>({binding:e.binding,ref:{kind:`slot`,index:h(e.name)}})),{binding:f.bindings.output,ref:{kind:`col`,index:_}}]}),{param:{kind:`column`,type:f.outType,tupleSize:f.outTupleSize},ref:{kind:`col`,index:_}}},x=(e,t,n,r,i=!1)=>{if(e.constSlots*4!==r.length)throw Error(`resident run: apply kernel "${e.key}" declares ${e.constSlots} constant slots but the planner allocated ${r.length/4}`);return{key:e.key,wgsl:e.wgsl,entryPoint:e.entryPoint,workgroupSize:e.workgroupSize,seed:t,uniformsBinding:0,uniformBytes:e.uniformBytes,consts:r,perBatch:i,bindings:e.bindings.map(e=>{let t=n[e.role];if(t===void 0)throw new Q(`unmapped role ${e.role}`);return{binding:e.binding,ref:t}})}};try{for(let t of e){let n=t===e[e.length-1],r=[],a=[],s=t.params;switch(t.kind){case`setAttribute`:{let e=s.name,n=s.type,i=s.tupleSize;if(typeof e!=`string`)throw new Q(`name`);if(n!==`f32`&&n!==`i32`&&n!==`u32`&&n!==`bool`)throw new Q(`type`);if(typeof i!=`number`||!Number.isInteger(i)||i<1||i>4)throw new Q(`tupleSize`);let c=typeof s.seed==`number`?s.seed:NaN,l=c===0?t.seed:ie(t.seed,c),{param:f,ref:p}=b(s.value,l,r,i===1?[1]:[1,i],a,t.kind),m=_(e,i,`none`);o.set(e,{type:n,tupleSize:i}),u.set(e,m),d.push({op:`replace`,name:e,type:n,tupleSize:i});let h={target:{kind:`slot`,index:m}};p!==null&&(h.value=p),r.push(x(Ce(f,n,i),0,h,a));break}case`transformPoints`:{v(`P`,`f32`,3);let e=b(s.translate,t.seed,r,[1,3],a,t.kind),n=b(s.rotateEuler,t.seed,r,[1,3],a,t.kind),i=b(s.scale,t.seed,r,[1,3],a,t.kind),c=o.get(`rot`),l=c!==void 0&&c.type===`f32`&&c.tupleSize===4,d=o.get(`scale`),f=d!==void 0&&d.type===`f32`&&d.tupleSize===3,p=h(`P`);u.set(`P`,p);let m={P:{kind:`slot`,index:p}};if(e.ref!==null&&(m.translate=e.ref),n.ref!==null&&(m.rotateEuler=n.ref),i.ref!==null&&(m.scale=i.ref),l){let e=h(`rot`);u.set(`rot`,e),m.rot={kind:`slot`,index:e}}if(f){let e=h(`scale`);u.set(`scale`,e),m.scaleAttr={kind:`slot`,index:e}}r.push(x(Te(e.param,n.param,i.param,l,f),0,m,a));break}case`jitterPoints`:{if(v(`P`,`f32`,3),u.has(`P`))throw new Q(`identity after P write`);let e=typeof s.seed==`number`?s.seed:NaN,n=ie(t.seed,e),i=b(s.amount,n,r,[1,3],a,t.kind),c=o.get(`seed`),l=c!==void 0;if(l&&(c.type!==`u32`||c.tupleSize!==1))throw new Q(`seed attribute shape`);let d=h(`P`);u.set(`P`,d);let f={P:{kind:`slot`,index:d}};i.ref!==null&&(f.amount=i.ref),l&&(f.seed={kind:`slot`,index:h(`seed`)}),r.push(x(Ee(i.param,l),n,f,a));break}case`orientAlongVector`:{let e=s.axis;if(!It.includes(e))throw new Q(`axis`);if(!Rt(s.up))throw new Q(`up`);let n=b(s.direction,t.seed,r,[1,3],a,t.kind),i=s.up,c=i[0]*i[0]+i[1]*i[1]+i[2]*i[2],l=c>0?1/Math.sqrt(c):0,f=[i[0]*l,i[1]*l,i[2]*l];for(let e of f)if(!Number.isFinite(Math.fround(e)))throw new Q(`up range`);let p=y(f,a,t.kind),m=o.get(`rot`),g=m!==void 0&&m.type===`f32`&&m.tupleSize===4?h(`rot`):_(`rot`,4,`quat-default`);o.set(`rot`,{type:`f32`,tupleSize:4}),u.set(`rot`,g),d.push({op:`ensure-rot`});let v={rot:{kind:`slot`,index:g}};n.ref!==null&&(v.direction=n.ref),r.push(x(Oe(n.param,e,p),0,v,a));break}case`spawnInstances`:{if(!n)throw new Q(`spawnInstances must be the run's last member`);let e=s.assetId;if(typeof e!=`string`||e===``)throw new Q(`assetId`);if(v(`P`,`f32`,3),i>1048576)throw new Q(`${i} instances over MAX_INSTANCES`);let t=s.assetAttr;if(t!==void 0&&typeof t!=`string`)throw new Q(`assetAttr`);let c=t===void 0?``:t;if(c!==``){let e=o.get(c);if(e===void 0)throw new Q(`assetAttr "${c}" not on the point domain`);if(e.type!==`string`)throw new Q(`assetAttr "${c}" is ${e.type}, not string`)}let l=s.colorAttr;if(l!==void 0&&typeof l!=`string`)throw new Q(`colorAttr`);let u=l===void 0?``:l,d=0;if(u!==``){let e=o.get(u);if(e===void 0)throw new Q(`colorAttr "${u}" not on the point domain`);if(e.type!==`f32`||e.tupleSize<3)throw new Q(`colorAttr "${u}" is ${e.type}x${e.tupleSize}`);d=e.tupleSize}let f=o.get(`rot`),m=f!==void 0&&f.type===`f32`&&f.tupleSize===4,g=o.get(`scale`),_=g!==void 0&&g.type===`f32`&&g.tupleSize===3,y={P:{kind:`slot`,index:h(`P`)},transforms:{kind:`out`}};m&&(y.rot={kind:`slot`,index:h(`rot`)}),_&&(y.scaleAttr={kind:`slot`,index:h(`scale`)});let b=c!==``;b&&(y.perm={kind:`perm`}),d>0&&(y.color={kind:`slot`,index:h(u)},y.colors={kind:`colorOut`}),r.push(x(ke(m,_,b,d),0,y,a,b)),p={assetId:e,assetAttr:c,colorAttr:u,colorTupleSize:d,count:i,bytes:i*64,colorBytes:d>0?i*Mt:0,permBytes:b?i*4:0};break}default:throw new Q(`unknown kind ${t.kind}`)}f.push({id:t.id,type:t.type,steps:r})}}catch(e){if(e instanceof Q)return Ft;throw e}let{writtenList:S,materialize:C,totalBytes:w}=zt(u,s,l,p,t.needsGeometry);return w>n?{reason:`run-too-large`}:{plan:{format:Nt,count:i,members:f,slots:s,cols:l,written:S,layoutOps:d,materialize:C,instances:p,totalBytes:w}}}var Vt={f32:Float32Array,i32:Int32Array,u32:Uint32Array};function Ht(){return new Promise(e=>setTimeout(e,0))}async function Ut(e,t,n,r){let{device:i,pool:a}=e,{geo:o,signal:s,budgetMs:c}=n,l=t.count;if(o.attrs.point.count!==l)throw Error(`resident run: plan was built for ${l} points but the input geometry has ${o.attrs.point.count}; plans are single-cook artifacts — re-plan for new inputs`);let u=()=>{if(s?.aborted)throw new O},d=[],f=(e,t)=>{let n=a.acquire(e,t);return d.push(n),n},p=new Set,m=[];try{let n=o.attrs.point,s=t.slots.map(e=>{let t=f(e.bytes,Z.STORAGE|Z.COPY_DST|Z.COPY_SRC);if(e.init===`attr`){let r=n.require(e.name),a=e.bytes/4;if(r.data instanceof Uint8Array){let e=new Uint32Array(a);for(let t=0;t<a;t++)e[t]=r.data[t];i.queue.writeBuffer(t,0,e)}else i.queue.writeBuffer(t,0,r.data.subarray(0,a))}else if(e.init===`quat-default`){let n=new Float32Array(e.bytes/4);for(let e=3;e<n.length;e+=4)n[e]=1;i.queue.writeBuffer(t,0,n)}return t}),d=t.cols.map(e=>f(e,Z.STORAGE|Z.COPY_DST|Z.COPY_SRC)),h=t.instances===null?void 0:x(o,{defaultAssetId:t.instances.assetId,...t.instances.assetAttr===``?{}:{assetAttr:t.instances.assetAttr}}),g=t.instances!==null&&t.instances.permBytes>0?f(t.instances.permBytes,Z.STORAGE|Z.COPY_DST):void 0;g!==void 0&&h!==void 0&&i.queue.writeBuffer(g,0,h.perm);let _=Z.STORAGE|Z.COPY_DST|Z.COPY_SRC|Z.VERTEX,v=h===void 0?[]:Array.from(h.counts,e=>f(e*64,_)),y=h===void 0||t.instances===null||t.instances.colorBytes===0?[]:Array.from(h.counts,e=>f(e*Mt,_)),b=(e,t)=>{if(e.kind===`slot`)return s[e.index];if(e.kind===`col`)return d[e.index];if(e.kind===`colorOut`){let e=y[t];if(e===void 0)throw Error(`resident run: a kernel binds a retained instance-colour buffer but the plan declares no colour output (plan and kernels disagree)`);return e}if(e.kind===`perm`){if(g===void 0)throw Error(`resident run: a kernel binds the grouping permutation but the plan declares no per-point asset attribute (plan and kernels disagree)`);return g}let n=v[t];if(n===void 0)throw Error(`resident run: a kernel binds a retained instance-transform buffer but the plan declares no instances output (plan and kernels disagree)`);return n},S=i.createCommandEncoder(),C=S.beginComputePass(),w=performance.now();for(let n of t.members){u();for(let t of n.steps){let n=e.getPipeline(t.key,t.wgsl,t.entryPoint,r);C.setPipeline(n);let a=jt(t.workgroupSize,e.maxElementsPerDispatch),o=t.perBatch&&h!==void 0?Array.from(h.counts,(e,t)=>({batch:t,elements:e,base:h.offsets[t]})):[{batch:0,elements:l,base:0}];for(let e of o){r!==void 0&&r.dispatches++;let o=new ArrayBuffer(t.uniformBytes),s=new Uint8Array(o),c=new Uint32Array(o,0,t.uniformBytes>=16?4:3);c[0]=e.elements,c[1]=t.seed>>>0,t.perBatch&&(c[3]=e.base),t.consts.length>0&&new Float32Array(o,16,t.consts.length).set(t.consts);let l=Math.ceil(e.elements/a);for(let r=0;r<l;r++){let o=f(t.uniformBytes,Z.UNIFORM|Z.COPY_DST);c[2]=r*a,i.queue.writeBuffer(o,0,s);let l=i.createBindGroup({layout:n.getBindGroupLayout(0),entries:[{binding:t.uniformsBinding,resource:{buffer:o}},...t.bindings.map(t=>({binding:t.binding,resource:{buffer:b(t.ref,e.batch)}}))]}),u=Math.min(a,e.elements-r*a);C.setBindGroup(0,l),C.dispatchWorkgroups(Math.ceil(u/t.workgroupSize))}}}c!==void 0&&performance.now()-w>c&&(await Ht(),u(),w=performance.now())}C.end();let T=[],E,D=t.materialize?t.written.reduce((e,n)=>e+t.slots[n.slot].bytes,0):0;if(D>0){E=f(D,Z.COPY_DST|Z.MAP_READ);let e=0;for(let n of t.written){let r=t.slots[n.slot].bytes;S.copyBufferToBuffer(s[n.slot],0,E,e,r),T.push(e),e+=r}}i.queue.submit([S.finish()]);let O;if(t.materialize){let e;if(E!==void 0){await E.mapAsync(Ct.READ,0,D);try{e=E.getMappedRange(0,D).slice(0)}finally{E.unmap()}}u(),O=ee(o);let n=O.attrs.point;for(let e of t.layoutOps)if(e.op===`replace`)n.replace(e.name,e.type,e.tupleSize);else{let e=n.get(`rot`);(!e||e.type!==`f32`||e.tupleSize!==4)&&(e&&n.remove(`rot`),n.add(`rot`,`f32`,4,[0,0,0,1]))}t.written.forEach((t,r)=>{let i=n.require(t.name),a=l*i.tupleSize;if(e===void 0)throw Error(`resident run: readback missing for a written attribute`);if(i.data instanceof Uint8Array){let t=new Uint32Array(e,T[r],a);for(let e=0;e<a;e++)i.data[e]=t[e]}else{let n=Vt[i.type];if(n===void 0)throw Error(`resident run: cannot materialize attribute "${t.name}" of type ${i.type}`);i.data.set(new n(e,T[r],a))}})}else u();let te;if(t.instances!==null){let e=t.instances.colorBytes>0;if(h===void 0||v.length!==h.order.length||y.length!==(e?h.order.length:0))throw Error(`resident run: the plan declares an instances output but the acquired transform buffers do not match the grouping (library bug: plan.instances, the grouping, and the acquired buffers must agree)`);let n=(e,t,n)=>{let r=a.detach(e);p.add(e);try{return kt(r,t,n)}catch(e){throw r.destroy(),e}},r=[];for(let t=0;t<h.order.length;t++){let i=h.order[t],a=h.counts[t],o=n(v[t],a*64,`${a} instances of "${i}"`);if(m.push(o),!e){r.push({residency:`device`,assetId:i,count:a,transforms:o});continue}let s=n(y[t],a*Mt,`${a} instance colours of "${i}"`);m.push(s),r.push({residency:`device`,assetId:i,count:a,transforms:o,colors:s})}te=r}r!==void 0&&(r.residentRuns++,r.fusedNodes+=t.members.length,r.readbacksSaved+=t.members.length-+!!t.materialize);let ne={};return O!==void 0&&(ne.geo=O),te!==void 0&&(ne.deviceBatches=te),ne}catch(e){for(let e of m)e.dispose();throw e instanceof O?e:Error(`GpuFieldEvaluator: resident run failed (${t.members.length} fused nodes [${t.members.map(e=>`"${e.id}"`).join(`, `)}], ${l} points): ${e instanceof Error?e.message:String(e)}`,{cause:e})}finally{for(let e of d)p.has(e)||a.release(e)}}var Wt=`gpu2`,Gt=268435456,Kt=[`spawnInstances`],qt={f32:Float32Array,i32:Int32Array,u32:Uint32Array},Jt={f32:Float32Array,i32:Int32Array,u32:Uint32Array};function Yt(e){let t=e=>e!==void 0&&e!==``?e:`?`;return[Wt,t(e?.vendor),t(e?.architecture),t(e?.device),t(e?.description)].join(`|`)}function $(e,t){return e!==void 0&&(e.fallbacks[t]=(e.fallbacks[t]??0)+1),null}var Xt=class{cacheSalt;residentTerminals;acceptDerivedSpecs;device;kernels=new Map;pipelines=new Map;pool;maxElementsPerDispatch;maxResidentBytes;constructor(e,t={}){if(t.maxElementsPerDispatch!==void 0&&!Number.isFinite(t.maxElementsPerDispatch))throw Error(`GpuFieldEvaluator: maxElementsPerDispatch must be a finite number, got ${t.maxElementsPerDispatch}; leave it unset to use the device maximum`);this.device=e,this.cacheSalt=Yt(t.adapterInfo??e.adapterInfo),this.pool=new Et(e,t.maxPooledBytes??Gt),this.maxElementsPerDispatch=t.maxElementsPerDispatch,this.maxResidentBytes=t.maxResidentBytes??536870912,this.residentTerminals=t.deviceInstances===!0?Kt:[],this.acceptDerivedSpecs=ne(t)}get pipelineCacheSize(){return this.pipelines.size}get kernelCacheSize(){return this.kernels.size}get poolStats(){return this.pool.stats}dispose(){this.pool.dispose()}chunkElements(e){let t=At*e.workgroupSize,n=Math.min(this.maxElementsPerDispatch??t,t);return Math.max(e.workgroupSize,Math.floor(n/e.workgroupSize)*e.workgroupSize)}resolveField(e,t,n){let r=g(e,this.acceptDerivedSpecs);if(r===void 0)return $(n,u(e));let i=t.geo.attrs[t.domain],a={},o=[];for(let e of i.names().sort()){let t=i.get(e);t!==void 0&&(a[e]={type:t.type,tupleSize:t.tupleSize},o.push(`${JSON.stringify(e)}:${t.type}x${t.tupleSize}`))}let s;try{s=ft(r,e.key)}catch{return $(n,`compile-error`)}let c=`${s.length}#${s}|${o.join(`,`)}`,l=this.kernels.get(c);if(l===void 0){try{l=St(r,{attributes:a})}catch(e){l=e instanceof Error?e:Error(String(e))}this.kernels.set(c,l)}if(l instanceof Error)return $(n,`compile-error`);if(l.inputs.length+1>8)return $(n,`too-many-buffers`);let d=_t(r,l,i);if(`problem`in d)return $(n,`param-bindings`);let f=i.count;if(f===0)return Promise.resolve({data:new Jt[l.outType](0),tupleSize:l.outTupleSize});let p=this.getPipeline(l.key,l.wgsl,l.entryPoint,n);return n!==void 0&&n.dispatches++,this.dispatch(e,t,l,p,f,d.values)}getPipeline(e,t,n,r){let i=this.pipelines.get(e);if(i!==void 0)return r!==void 0&&r.pipelineCacheHits++,i;let a=this.device.createShaderModule({code:t}),o=this.device.createComputePipeline({layout:`auto`,compute:{module:a,entryPoint:n}});return this.pipelines.set(e,o),r!==void 0&&r.pipelinesCompiled++,o}planRun(e,t,n){let r=Bt(e,t,this.maxResidentBytes,this.acceptDerivedSpecs);return`plan`in r?r.plan:(n!==void 0&&(n.fallbacks[r.reason]=(n.fallbacks[r.reason]??0)+1),null)}executeRun(e,t,n){let r=Pt(e);return r===null?Promise.reject(Error(`GpuFieldEvaluator.executeRun: plan was not produced by this library's planRun; pass the object returned by planRun on the same resolver`)):Ut({device:this.device,pool:this.pool,maxElementsPerDispatch:this.maxElementsPerDispatch,getPipeline:(e,t,n,r)=>this.getPipeline(e,t,n,r)},r,t,n)}async dispatch(e,t,n,r,i,a){let o=this.device,s=[],c=(e,t)=>{let n=this.pool.acquire(e,t);return s.push(n),n};try{let e=this.chunkElements(n),s=Math.ceil(i/e),l=[],u=t.geo.attrs[t.domain];for(let e of n.inputs){let t=u.require(e.name),n=i*e.tupleSize,r;if(t.data instanceof Uint8Array){let e=new Uint32Array(n);for(let r=0;r<n;r++)e[r]=t.data[r];r=e}else r=t.data.subarray(0,n);let a=c(n*4,Z.STORAGE|Z.COPY_DST);o.queue.writeBuffer(a,0,r),l.push({binding:e.binding,resource:{buffer:a}})}let d=i*n.outTupleSize*4,f=c(d,Z.STORAGE|Z.COPY_SRC);l.push({binding:n.bindings.output,resource:{buffer:f}});let p=c(d,Z.COPY_DST|Z.MAP_READ),m=new ArrayBuffer(n.uniformBytes),h=new Uint8Array(m),g=new Uint32Array(m,0,3);g[0]=i,g[1]=t.seed>>>0,a.length>0&&new Float32Array(m,16,a.length).set(a);let _=[];for(let t=0;t<s;t++){let i=c(n.uniformBytes,Z.UNIFORM|Z.COPY_DST);g[2]=t*e,o.queue.writeBuffer(i,0,h),_.push(o.createBindGroup({layout:r.getBindGroupLayout(0),entries:[{binding:n.bindings.uniforms,resource:{buffer:i}},...l]}))}let v=o.createCommandEncoder(),y=v.beginComputePass();y.setPipeline(r);for(let t=0;t<s;t++){let r=Math.min(e,i-t*e);y.setBindGroup(0,_[t]),y.dispatchWorkgroups(Math.ceil(r/n.workgroupSize))}y.end(),v.copyBufferToBuffer(f,0,p,0,d),o.queue.submit([v.finish()]),await p.mapAsync(Ct.READ,0,d);let b;try{b=p.getMappedRange(0,d).slice(0)}finally{p.unmap()}return{data:new qt[n.outType](b),tupleSize:n.outTupleSize}}catch(n){throw Error(`GpuFieldEvaluator: dispatch failed for field ${e.key} (${i} elements on the ${t.domain} domain): ${n instanceof Error?n.message:String(n)}`,{cause:n})}finally{for(let e of s)this.pool.release(e)}}};function Zt(e,t={}){let n=e.attrs.point,r=n.get(`P`);if(!r||r.type!==`f32`||r.tupleSize!==3)throw Error(`toPointsObject: geometry needs a point attribute "P" (f32, tupleSize 3)`);let i=n.count,a=new ce;a.setAttribute(`position`,new se(r.data.slice(0,i*3),3));let s=!1,c=t.useColor===!1?void 0:v(n.get(`color`));if(c){let e=new Float32Array(i*3);for(let t=0;t<i;t++)o(e,t*3,c,t);a.setAttribute(`color`,new se(e,3)),s=!0}let l=new oe({size:t.size??.1,sizeAttenuation:!0,vertexColors:s});return new ae(a,l)}export{Xt as n,Zt as t};