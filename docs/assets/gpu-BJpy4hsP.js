import{Ao as e,Bo as t,Bs as n,Do as r,Eo as i,Fs as a,Go as o,Gs as s,Hs as c,Io as l,Is as u,Js as d,Ks as f,Lo as p,Ms as m,No as h,Oo as g,Po as _,Ps as v,Ro as y,Rs as b,Us as x,Vs as S,Ws as C,Yo as w,Ys as T,bo as E,go as ee,ha as te,jo as ne,js as re,ko as D,qo as O,qs as k,zs as ie}from"./wordmark-BkASP7CQ.js";var A=class extends Error{constructor(e){super(e),this.name=`GpuCompileError`}};function j(e,t){let n=Math.fround(e);if(!Number.isFinite(n))throw new A(`${t}: value ${e} is not representable as a finite f32 (WGSL kernels compute in f32; keep magnitudes within ~3.4e38)`);return Object.is(n,-0)?`-0f`:`${String(n)}f`}function ae(e){return`${e>>>0}u`}function M(e){return`0x${(e>>>0).toString(16).padStart(8,`0`)}u`}var N=M,oe=j(34028234663852886e22,`internal f32 max`);function se(e,t){let n=N(e);for(let e of t)n=`pcg_hash_mix(${n}, ${e})`;return`pcg_hash_finalize(${n})`}function ce(){let e=[];for(let t=0;t<12;t++){let n=e=>j(l[t*3+e],`internal GRAD3`);e.push(`  vec3<f32>(${n(0)}, ${n(1)}, ${n(2)}),`)}return`var<private> PCG_GRAD3: array<vec3<f32>, 12> = array<vec3<f32>, 12>(
${e.join(`
`)}
);`}var P=e=>t=>j(t,e),le=new Map([[`PCG_GRAD3`,{deps:[],text:ce()}],[`pcg_hash_mix`,{deps:[],text:`fn pcg_hash_mix(h_in: u32, value: u32) -> u32 {
  var k = value * ${N(x)};
  k = (k << 15u) | (k >> 17u);
  k = k * ${N(C)};
  var h = h_in ^ k;
  h = (h << 13u) | (h >> 19u);
  h = h * 5u + ${N(s)};
  return h;
}`}],[`pcg_hash_finalize`,{deps:[],text:`fn pcg_hash_finalize(h_in: u32) -> u32 {
  var h = h_in ^ (h_in >> 16u);
  h = h * ${N(n)};
  h = h ^ (h >> 13u);
  h = h * ${N(S)};
  h = h ^ (h >> 16u);
  return h;
}`}],[`pcg_hash3`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash3(a: u32, b: u32, c: u32) -> u32 {
  return ${se(k(3),[`a`,`b`,`c`])};
}`}],[`pcg_hash4`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash4(a: u32, b: u32, c: u32, d: u32) -> u32 {
  return ${se(k(4),[`a`,`b`,`c`,`d`])};
}`}],[`pcg_hash5`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash5(a: u32, b: u32, c: u32, d: u32, e: u32) -> u32 {
  return ${se(k(5),[`a`,`b`,`c`,`d`,`e`])};
}`}],[`pcg_hash_float`,{deps:[],text:`fn pcg_hash_float(h: u32) -> f32 {
  return f32(h >> 8u) * ${j(c,`internal hashFloat scale`)};
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
  return ${P(`internal PERLIN_SCALE`)(_)} * pcg_mix(
    pcg_mix(pcg_mix(n000, n100, u), pcg_mix(n010, n110, u), v),
    pcg_mix(pcg_mix(n001, n101, u), pcg_mix(n011, n111, u), v),
    w);
}`}],[`pcg_simplex_corner`,{deps:[`pcg_hash4`,`PCG_GRAD3`],text:`fn pcg_simplex_corner(seed: u32, i: i32, j: i32, k: i32, x: f32, y: f32, z: f32) -> f32 {
  let t = ${P(`internal simplex R2`)(e)} - x * x - y * y - z * z;
  if (t <= 0f) {
    return 0f;
  }
  let g = pcg_hash4(seed, bitcast<u32>(i), bitcast<u32>(j), bitcast<u32>(k)) % 12u;
  let t2 = t * t;
  return t2 * t2 * dot(PCG_GRAD3[g], vec3<f32>(x, y, z));
}`}],[`pcg_simplex_noise`,{deps:[`pcg_simplex_corner`],text:`fn pcg_simplex_noise(seed: u32, p: vec3<f32>) -> f32 {
  let s = (p.x + p.y + p.z) * ${P(`internal simplex F3`)(g)};
  let i = i32(floor(p.x + s));
  let j = i32(floor(p.y + s));
  let k = i32(floor(p.z + s));
  let t = f32(i + j + k) * ${P(`internal simplex G3`)(D)};
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
  let x1 = x0 - f32(i1) + ${P(`internal simplex G3`)(D)};
  let y1 = y0 - f32(j1) + ${P(`internal simplex G3`)(D)};
  let z1 = z0 - f32(k1) + ${P(`internal simplex G3`)(D)};
  let x2 = x0 - f32(i2) + ${P(`internal simplex 2*G3`)(2*D)};
  let y2 = y0 - f32(j2) + ${P(`internal simplex 2*G3`)(2*D)};
  let z2 = z0 - f32(k2) + ${P(`internal simplex 2*G3`)(2*D)};
  let x3 = x0 - 1f + ${P(`internal simplex 3*G3`)(3*D)};
  let y3 = y0 - 1f + ${P(`internal simplex 3*G3`)(3*D)};
  let z3 = z0 - 1f + ${P(`internal simplex 3*G3`)(3*D)};
  return ${P(`internal SIMPLEX_SCALE`)(72)} * (pcg_simplex_corner(seed, i, j, k, x0, y0, z0)
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
  var f1 = ${oe};
  var f2 = ${oe};
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
}`}]]);function ue(e){let t=new Set,n=e=>{if(t.has(e))return;let r=le.get(e);if(!r)throw Error(`internal: unknown WGSL library item "${e}"`);t.add(e);for(let e of r.deps)n(e)};for(let t of e)n(t);let r=[];for(let[e,n]of le)t.has(e)&&r.push(n.text);return r}var de=`apply2`;function fe(e,t=!1){return e>0?16+e*16:t?16:12}var pe=[`x`,`y`,`z`,`w`];function F(e,t,n){if(t.kind===`const`)return he(t,n);let r=ge(e,t,n);return t.type===`f32`?r:`f32(${r})`}function me(e,t,n){return t.kind===`const`?he(t,n):ge(e,t,n)}function he(e,t){let n=e.tupleSize===1?0:t;if(n>=4)throw Error(`apply codegen: constant slot ${e.slot} has no component ${n} (a uniform slot holds 4 f32 components)`);return`params.consts[${e.slot}].${pe[n]}`}function ge(e,t,n){return t.tupleSize===1?`${e}[i]`:n===0?`${e}[i * ${t.tupleSize}u]`:`${e}[i * ${t.tupleSize}u + ${n}u]`}function _e(e,t,n){return t===1?`${e}[i]`:n===0?`${e}[i * ${t}u]`:`${e}[i * ${t}u + ${n}u]`}var I=class{items=[];add(e,t,n,r){return this.items.push({role:e,access:t,elem:n,comment:r}),`b${this.items.length}`}};function ve(e){let t=0;for(let n of e)if(n.kind===`const`){if(n.slot<0||n.slot>=4)throw Error(`apply codegen: constant slot ${n.slot} is out of range; an apply kernel carries at most 4 uniform constant slots (raise MAX_APPLY_CONST_SLOTS in applyKernels.ts if a new node kind needs more)`);t=Math.max(t,n.slot+1)}return t}function L(e,t,n,r,i,a=!1){let o=[`@group(0) @binding(0) var<uniform> params: PcgParams;`],s=[];n.forEach((e,t)=>{let n=t+1,r=e.access===`read`?`read`:`read_write`;o.push(`@group(0) @binding(${n}) var<storage, ${r}> b${n}: array<${e.elem}>; // ${e.comment}`),s.push({binding:n,role:e.role,access:e.access})});let c=a?`
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
`,entryPoint:`main`,workgroupSize:64,bindings:s,constSlots:t,uniformBytes:fe(t,a),key:`${de}|${e}`}}var R=e=>e.kind===`column`?`${e.type}x${e.tupleSize}`:`constx${e.tupleSize}@${e.slot}`;function ye(e,t,n){let r=e.kind===`const`?`f32`:e.type,i=t===`f32`&&e.kind===`column`&&e.type===`f32`,a=i?`u32`:r,o=t===`bool`||i?`u32`:t,s=new I,c=e.kind===`column`?s.add(`value`,`read`,a,`value column ${R(e)}`):``,l=e.kind===`column`?{...e,type:a}:e,u=s.add(`target`,`read_write`,o,`target attribute ${t} tupleSize ${n}`),d=(e,n)=>{switch(t){case`f32`:return i?e:n;case`i32`:return r===`f32`?`i32(${e})`:r===`i32`?e:`bitcast<i32>(${e})`;case`u32`:return r===`f32`?`u32(${e})`:r===`u32`?e:`bitcast<u32>(${e})`;default:return`select(0u, 1u, ${e} != ${r===`f32`?`0f`:r===`i32`?`0i`:`0u`})`}},f=[];for(let e=0;e<n;e++){let t=me(c,l,e);f.push(`  ${_e(u,n,e)} = ${d(t,F(c,l,e))};`)}return L(`setAttribute|val=${R(e)}|out=${t}x${n}`,ve([e]),s.items,[],f.join(`
`))}var be={euler:`fn pcg_quat_from_euler_deg(r: vec3<f32>) -> vec4<f32> {
  let h = r * ${j(Math.PI/360,`internal PI/360`)};
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
}`};function xe(e,t,n,r,i){let a=new I,o=e.kind===`column`?a.add(`translate`,`read`,e.type,`translate column ${R(e)}`):``,s=t.kind===`column`?a.add(`rotateEuler`,`read`,t.type,`rotateEuler column ${R(t)}`):``,c=n.kind===`column`?a.add(`scale`,`read`,n.type,`scale column ${R(n)}`):``,l=a.add(`P`,`read_write`,`f32`,`attribute P: f32 tupleSize 3`),u=r?a.add(`rot`,`read_write`,`f32`,`attribute rot: f32 tupleSize 4`):``,d=i?a.add(`scaleAttr`,`read_write`,`f32`,`attribute scale: f32 tupleSize 3`):``,f=[];return f.push(`  let s = vec3<f32>(${[0,1,2].map(e=>F(c,n,e)).join(`, `)});`),f.push(`  let q = pcg_quat_from_euler_deg(vec3<f32>(${[0,1,2].map(e=>F(s,t,e)).join(`, `)}));`),f.push(`  let v = pcg_rotate_vec(q, vec3<f32>(${l}[i * 3u] * s.x, ${l}[i * 3u + 1u] * s.y, ${l}[i * 3u + 2u] * s.z));`),f.push(`  ${l}[i * 3u] = v.x + ${F(o,e,0)};`),f.push(`  ${l}[i * 3u + 1u] = v.y + ${F(o,e,1)};`),f.push(`  ${l}[i * 3u + 2u] = v.z + ${F(o,e,2)};`),r&&(f.push(`  let q2 = pcg_quat_mul(q, vec4<f32>(${u}[i * 4u], ${u}[i * 4u + 1u], ${u}[i * 4u + 2u], ${u}[i * 4u + 3u]));`),f.push(`  ${u}[i * 4u] = q2.x;`),f.push(`  ${u}[i * 4u + 1u] = q2.y;`),f.push(`  ${u}[i * 4u + 2u] = q2.z;`),f.push(`  ${u}[i * 4u + 3u] = q2.w;`)),i&&(f.push(`  ${d}[i * 3u] = ${d}[i * 3u] * s.x;`),f.push(`  ${d}[i * 3u + 1u] = ${d}[i * 3u + 1u] * s.y;`),f.push(`  ${d}[i * 3u + 2u] = ${d}[i * 3u + 2u] * s.z;`)),L(`transformPoints|t=${R(e)}|r=${R(t)}|s=${R(n)}|rot=${+!!r}|scl=${+!!i}`,ve([e,t,n]),a.items,[be.euler,be.mul,be.rotate],f.join(`
`))}function Se(e,t){let n=new I,r=e.kind===`column`?n.add(`amount`,`read`,e.type,`amount column ${R(e)}`):``,i=t?n.add(`seed`,`read`,`u32`,`attribute seed: u32 tupleSize 1`):``,a=n.add(`P`,`read_write`,`f32`,`attribute P: f32 tupleSize 3`),o=[];o.push(`  let ident = pcg_hash4(bitcast<u32>(${a}[i * 3u]), bitcast<u32>(${a}[i * 3u + 1u]), bitcast<u32>(${a}[i * 3u + 2u]), ${t?`${i}[i]`:`0u`});`);for(let t=0;t<3;t++){let n=t===0?`i * 3u`:`i * 3u + ${t}u`;o.push(`  ${a}[${n}] = ${a}[${n}] + (pcg_hash_float(pcg_hash3(params.seed, ident, ${t}u)) * 2f - 1f) * ${F(r,e,t)};`)}return L(`jitterPoints|a=${R(e)}|s=${+!!t}`,ve([e]),n.items,ue([`pcg_hash3`,`pcg_hash4`,`pcg_hash_float`]),o.join(`
`))}var Ce={"+x":`f, u, -r`,"-x":`-f, u, r`,"+y":`-r, f, u`,"-y":`r, -f, u`,"+z":`r, u, f`,"-z":`-r, u, -f`};function we(e,t,n){let r=new I,i=e.kind===`column`?r.add(`direction`,`read`,e.type,`direction column ${R(e)}`):``,a=r.add(`rot`,`read_write`,`f32`,`attribute rot: f32 tupleSize 4`),o=j(1e-12,`internal ORIENT_PARALLEL_EPS`),s=`  let d = vec3<f32>(${[0,1,2].map(t=>F(i,e,t)).join(`, `)});
  let dl = dot(d, d);
  if (dl == 0f) {
    return; // zero direction: keep the prior rot
  }
  let f = d * (1f / sqrt(dl));
  let up = vec3<f32>(${[0,1,2].map(e=>F(``,n,e)).join(`, `)});
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
  let q = pcg_quat_from_basis(${Ce[t]});
  ${a}[i * 4u] = q.x;
  ${a}[i * 4u + 1u] = q.y;
  ${a}[i * 4u + 2u] = q.z;
  ${a}[i * 4u + 3u] = q.w;`;return L(`orientAlongVector|d=${R(e)}|axis=${t}|up=${R(n)}`,ve([e,n]),r.items,[be.basis],s)}function Te(e,t,n=!1,r=0){let i=r>0;if(i&&r<3)throw Error(`apply codegen: spawnInstances colour source has tupleSize ${r}; components 0-2 are read as RGB, so it must be at least 3 (the planner rejects narrower columns before reaching codegen)`);let a=new I,o=a.add(`P`,`read`,`f32`,`attribute P: f32 tupleSize 3`),s=e?a.add(`rot`,`read`,`f32`,`attribute rot: f32 tupleSize 4`):``,c=t?a.add(`scaleAttr`,`read`,`f32`,`attribute scale: f32 tupleSize 3`):``,l=a.add(`transforms`,`read_write`,`f32`,`out: 16 f32 per instance`),u=n?a.add(`perm`,`read`,`u32`,`grouping permutation: source point index per slot`):``,d=i?a.add(`color`,`read`,`f32`,`colour source: f32 tupleSize ${r}`):``,f=i?a.add(`colors`,`read_write`,`f32`,`out: 4 f32 per instance (vec3 storage stride, [3] = 0 pad)`):``,p=n?`src`:`i`,m=e?`vec4<f32>(${s}[${p} * 4u], ${s}[${p} * 4u + 1u], ${s}[${p} * 4u + 2u], ${s}[${p} * 4u + 3u])`:`vec4<f32>(0f, 0f, 0f, 1f)`,h=t?`vec3<f32>(${c}[${p} * 3u], ${c}[${p} * 3u + 1u], ${c}[${p} * 3u + 2u])`:`vec3<f32>(1f, 1f, 1f)`,g=`${n?`  let src = ${u}[params.base + i];\n`:``}  let q = ${m};
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
  ${f}[co + 3u] = 0f;`:``}`;return L(`spawnInstances|rot=${+!!e}|scl=${+!!t}${n?`|perm`:``}${i?`|color=${r}`:``}`,0,a.items,[],g,n)}function Ee(e,t,n=!1){if(!Number.isInteger(e)||e<1||e>4)throw Error(`apply codegen: per-instance channel itemSize ${e} is out of range; a channel binds as a WGSL storage array of a scalar or a vec2/vec3/vec4, so it must be a whole number in 1..4 (the planner rejects wider columns before reaching codegen)`);let r=e===3?4:e;if(t!==r)throw Error(`apply codegen: per-instance channel of itemSize ${e} spends ${r} slots per instance, not ${t}; pass the \`components\` deviceInstanceAttributeLayout returns rather than a second reading of the vec3 padding rule`);let i=new I,a=i.add(`src`,`read`,`u32`,`channel source: ${e} word(s) per point`),o=i.add(`out`,`read_write`,`u32`,`out: ${t} word(s) per instance${t===e?``:` (vec3 storage stride, [3] = 0 pad)`}`),s=n?i.add(`perm`,`read`,`u32`,`grouping permutation: source point index per slot`):``,c=n?`src`:`i`,l=t=>e===1?`${a}[${c}]`:t===0?`${a}[s]`:`${a}[s + ${t}u]`,u=e=>t===1?`${o}[i]`:e===0?`${o}[o]`:`${o}[o + ${e}u]`,d=[];n&&d.push(`  let src = ${s}[params.base + i];`),e>1&&d.push(`  let s = ${c} * ${e}u;`),t>1&&d.push(`  let o = i * ${t}u;`);for(let t=0;t<e;t++)d.push(`  ${u(t)} = ${l(t)};`);for(let n=e;n<t;n++)d.push(`  ${u(n)} = 0u;`);return L(`instanceChannel|ts=${e}|c=${t}${n?`|perm`:``}`,0,i.items,[],d.join(`
`),n)}var De=64,Oe=`wgsl2`,ke=[`x`,`y`,`z`,`w`];function z(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}function Ae(e,t,n){return new A(`${e}: ${t} has tupleSize ${n}, but GPU kernels support tuple sizes 1 to 4; evaluate this field on the CPU instead, or split it into components`)}function B(e,t,n){let r=1;for(let i of n)if(i!==1){if(r!==1&&r!==i)throw new A(`${t}: ${e}: incompatible tuple sizes ${r} and ${i}`);r=i}return r}var je=class{layout;params;lines=[];libRoots=new Set;usesSeed=!1;valueNumbers=new Map;bindings=new Map;helpers=new Map;helperTexts=[];helperCounters=new Map;varCounter=0;constructor(e,t,n){this.layout=e,this.params=n,t.forEach((t,n)=>{this.bindings.set(t,{name:t,varName:`in${n}`,binding:n+1,attr:e.attributes[t]})})}paramSlot(e){let t=this.params.slots.get(e);if(t===void 0)throw Error(`internal: param ${JSON.stringify(e)} was not pre-planned`);return{slot:t,arity:this.params.arities[t]}}attrIsSlot(e,t){let n=this.params.attrIsSlots.get(X(e,t));if(n===void 0)throw Error(`internal: attributeIs ${X(e,t)} was not pre-planned`);return n}emit(e,t){let n=this.valueNumbers.get(e);if(n)return n;let r={ref:`v${this.varCounter++}`,size:t};return this.lines.push(`  let ${r.ref} = ${e};`),this.valueNumbers.set(e,r),r}binding(e){let t=this.bindings.get(e);if(!t)throw Error(`internal: attribute ${JSON.stringify(e)} was not pre-bound`);return t}boundAttrs(){return[...this.bindings.values()]}helper(e,t){let n=this.helpers.get(t);if(n)return n;let r=this.helperCounters.get(e)??0;this.helperCounters.set(e,r+1);let i=`pcg_${e}_${r}`;return this.helpers.set(t,i),this.helperTexts.push(t.replaceAll(`@NAME@`,i)),i}helperBlocks(){return this.helperTexts}};function V(e,t){return e.size===t?e.ref:`vec${t}<f32>(${e.ref})`}function H(e){return e===1?`0f`:`vec${e}<f32>(0f)`}function U(e){return e===1?`1f`:`vec${e}<f32>(1f)`}function Me(e,t){return e===1?t:`vec${e}<f32>(${t})`}function Ne(e){let t=Object.keys(e.attributes).sort();return t.length===0?`the layout declares no attributes`:`layout attributes: ${t.map(e=>JSON.stringify(e)).join(`, `)}`}function Pe(e,t,n,r,i){let a=e.layout.attributes;if(!Object.hasOwn(a,n))throw new A(`${t}: ${i}attribute ${JSON.stringify(n)} is not in the kernel layout; ${Ne(e.layout)}`);let o=a[n];if(o.type===`string`)throw new A(`${t}: ${i}attribute ${JSON.stringify(n)} has type "string"; a string column has no numeric value to read — test it with { fn: "attributeIs", name: ${JSON.stringify(n)}, value: "..." }, which is 1 where it matches and 0 elsewhere, or select on it with { fn: "byAttribute", name: ${JSON.stringify(n)}, cases: {...}, default: ... }, or read a numeric or bool attribute`);if(r!==void 0&&o.tupleSize!==r)throw new A(`${t}: ${i}attribute ${JSON.stringify(n)}: expected tupleSize ${r}, got ${o.tupleSize} in the kernel layout`);if(o.tupleSize>4)throw Ae(t,`${i}attribute ${JSON.stringify(n)}`,o.tupleSize);return o}function Fe(e,t,n,r,i){let a=Pe(e,t,n,r,i),o=e.binding(n),s=a.tupleSize,c=e=>a.type===`f32`?e:`f32(${e})`;if(s===1)return e.emit(c(`${o.varName}[i]`),1);let l=[];for(let e=0;e<s;e++)l.push(c(`${o.varName}[${W(s,e)}]`));return e.emit(`vec${s}<f32>(${l.join(`, `)})`,s)}function W(e,t){return e===1?`i`:t===0?`i * ${e}u`:`i * ${e}u + ${t}u`}var G=new Map;function Ie(){return[...G.keys()].sort()}function Le(e,t,n){let r=String(e.fn),i=G.get(r);if(!i)throw new A(`${t}: field fn "${r}" is not supported by the WGSL compiler; supported fns: ${Ie().join(`, `)}`);return i(e,t,n)}function K(e,t,n){return typeof e==`number`?n.emit(j(e,t),1):Array.isArray(e)?Re(e,t,n):Le(e,t,n)}function Re(e,t,n){let r=e.length;if(r>4)throw Ae(t,`constant`,r);if(r===1)return n.emit(j(e[0],t),1);let i=e.map(e=>j(e,t));return n.emit(`vec${r}<f32>(${i.join(`, `)})`,r)}function q(e){return e.args}G.set(`constant`,(e,t,n)=>{let r=e.value;return typeof r==`number`?n.emit(j(r,`${t}.value`),1):Re(r,`${t}.value`,n)}),G.set(`attribute`,(e,t,n)=>{let r=e.name,i=e.tupleSize;return Fe(n,t,r,i,``)});function ze(e,t,n,r,i){let a=e.layout.attributes;if(!Object.hasOwn(a,n))throw new A(`${t}: ${r}: attribute ${JSON.stringify(n)} is not in the kernel layout; ${Ne(e.layout)}`);let o=a[n];if(o.type!==`string`)throw new A(`${t}: ${r}: attribute ${JSON.stringify(n)} has type ${JSON.stringify(o.type)}, but ${r} ${i} a string attribute; compare a numeric attribute with { fn: "eq", args: [{ fn: "attribute", name: ${JSON.stringify(n)} }, <number>] }`);return o}G.set(`attributeIs`,(e,t,n)=>{let r=e.name,i=e.value,a=ze(n,t,r,`attributeIs`,`tests`),o=n.binding(r),s=n.attrIsSlot(r,i);return n.emit(`select(0f, 1f, f32(${o.varName}[${W(a.tupleSize,0)}]) == params.consts[${s}].x)`,1)}),G.set(`byAttribute`,(e,t,n)=>{let r=e.name,i=e.cases,a=ze(n,t,r,`byAttribute`,`selects on`),o=n.binding(r),s=Object.keys(i).sort(),c=s.map(e=>K(i[e],`${t}.cases[${JSON.stringify(e)}]`,n)),l=K(e.default,`${t}.default`,n),u=B(`byAttribute`,t,[...c.map(e=>e.size),l.size]),d=n.emit(`f32(${o.varName}[${W(a.tupleSize,0)}])`,1),f=V(l,u);return s.forEach((e,t)=>{let i=n.attrIsSlot(r,e);f=`select(${f}, ${V(c[t],u)}, ${d.ref} == params.consts[${i}].x)`}),n.emit(f,u)}),G.set(`position`,(e,t,n)=>Fe(n,t,`P`,3,`position reads `)),G.set(`param`,(e,t,n)=>{let r=e.name,i=a(e);if(i!==void 0)return Le(i,`${t}<${r}>`,n);let{slot:o,arity:s}=n.paramSlot(r),c=e=>`params.consts[${o}].${ke[e]}`;return s===1?n.emit(c(0),1):n.emit(`vec${s}<f32>(${Array.from({length:s},(e,t)=>c(t)).join(`, `)})`,s)}),G.set(`index`,(e,t,n)=>n.emit(`f32(i)`,1)),G.set(`fraction`,(e,t,n)=>n.emit(`f32(i) / f32(max(params.count, 2u) - 1u)`,1)),G.set(`nodeSeed`,(e,t,n)=>(n.usesSeed=!0,n.emit(`f32(params.seed >> 8u) * 256.0 + f32(params.seed & 0xFFu)`,1))),G.set(`randomField`,(e,t,n)=>{let r=e.key,i=typeof r==`string`?d(r):(r??0)>>>0;n.usesSeed=!0,n.libRoots.add(`pcg_hash3`),n.libRoots.add(`pcg_hash4`),n.libRoots.add(`pcg_hash_float`);let a=`randomField's per-point identity reads `,o=Pe(n,t,`P`,void 0,a);if(o.tupleSize<3)throw new A(`${t}: ${a}attribute "P" with x, y and z (tupleSize 3), got tupleSize ${o.tupleSize}`);let s=n.binding(`P`).varName,c=e=>{let t=`${s}[${W(o.tupleSize,e)}]`;return o.type===`f32`?`bitcast<u32>(${t})`:`bitcast<u32>(f32(${t}))`},l=`0u`,u=Object.hasOwn(n.layout.attributes,`seed`)?n.layout.attributes.seed:void 0;if(u!==void 0){if(u.tupleSize!==1||u.type!==`u32`&&u.type!==`i32`)throw new A(`${t}: ${a}the standard point attribute "seed" as a u32 or i32 scalar, but the layout has it as ${u.type}x${u.tupleSize}; this field resolves on the CPU instead`);let e=n.binding(`seed`).varName;l=u.type===`u32`?`${e}[i]`:`bitcast<u32>(${e}[i])`}let f=`pcg_hash4(${c(0)}, ${c(1)}, ${c(2)}, ${l})`;return n.emit(`pcg_hash_float(pcg_hash3(params.seed, ${M(i)}, ${f}))`,1)}),G.set(`randomFrom`,(e,t,n)=>{let r=e.key,i=typeof r==`string`?d(r):(r??0)>>>0,a=K(q(e)[0],`${t}.args[0]`,n);if(a.size!==1)throw new A(`${t}: randomFrom's key must be ONE number per element, got width ${a.size}; reduce it first, e.g. component(<expr>, 0)`);return n.usesSeed=!0,n.libRoots.add(`pcg_hash3`),n.libRoots.add(`pcg_hash_float`),n.emit(`pcg_hash_float(pcg_hash3(params.seed, ${M(i)}, bitcast<u32>(${V(a,1)})))`,1)});function J(e,t,n){G.set(e,(r,i,a)=>{let o=q(r),s=[];for(let e=0;e<t;e++)s.push(K(o[e],`${i}.args[${e}]`,a));let c=B(e,i,s.map(e=>e.size)),l=s.map(e=>V(e,c));return a.emit(n(l,c),c)})}J(`add`,2,e=>`${e[0]} + ${e[1]}`),J(`sub`,2,e=>`${e[0]} - ${e[1]}`),J(`mul`,2,e=>`${e[0]} * ${e[1]}`),J(`div`,2,e=>`${e[0]} / ${e[1]}`),J(`min`,2,e=>`min(${e[0]}, ${e[1]})`),J(`max`,2,e=>`max(${e[0]}, ${e[1]})`),J(`abs`,1,e=>`abs(${e[0]})`),J(`floor`,1,e=>`floor(${e[0]})`),J(`trunc`,1,e=>`trunc(${e[0]})`),J(`fract`,1,e=>`${e[0]} - floor(${e[0]})`),J(`mod`,2,e=>`${e[0]} - ${e[1]} * floor(${e[0]} / ${e[1]})`),J(`rem`,2,e=>`${e[0]} - ${e[1]} * trunc(${e[0]} / ${e[1]})`),J(`sign`,1,(e,t)=>`select(${H(t)}, ${U(t)}, ${e[0]} > ${H(t)}) - select(${H(t)}, ${U(t)}, ${e[0]} < ${H(t)})`),J(`sin`,1,e=>`sin(${e[0]})`),J(`cos`,1,e=>`cos(${e[0]})`),J(`tan`,1,e=>`tan(${e[0]})`),J(`asin`,1,e=>`asin(${e[0]})`),J(`acos`,1,e=>`acos(${e[0]})`),J(`atan`,1,e=>`atan(${e[0]})`),J(`atan2`,2,e=>`atan2(${e[0]}, ${e[1]})`),J(`sqrt`,1,e=>`sqrt(${e[0]})`),J(`pow`,2,e=>`pow(${e[0]}, ${e[1]})`),J(`exp`,1,e=>`exp(${e[0]})`),J(`exp2`,1,e=>`exp2(${e[0]})`),J(`log`,1,e=>`log(${e[0]})`),J(`log2`,1,e=>`log2(${e[0]})`),J(`clamp`,3,e=>`clamp(${e[0]}, ${e[1]}, ${e[2]})`),J(`lerp`,3,e=>`${e[0]} + (${e[1]} - ${e[0]}) * ${e[2]}`),J(`select`,3,(e,t)=>`select(${e[2]}, ${e[1]}, ${e[0]} != ${H(t)})`),J(`lt`,2,(e,t)=>`select(${H(t)}, ${U(t)}, ${e[0]} < ${e[1]})`),J(`le`,2,(e,t)=>`select(${H(t)}, ${U(t)}, ${e[0]} <= ${e[1]})`),J(`gt`,2,(e,t)=>`select(${H(t)}, ${U(t)}, ${e[0]} > ${e[1]})`),J(`ge`,2,(e,t)=>`select(${H(t)}, ${U(t)}, ${e[0]} >= ${e[1]})`),J(`eq`,2,(e,t)=>`select(${H(t)}, ${U(t)}, ${e[0]} == ${e[1]})`),J(`ne`,2,(e,t)=>`select(${H(t)}, ${U(t)}, ${e[0]} != ${e[1]})`),J(`step`,2,(e,t)=>`select(${H(t)}, ${U(t)}, ${e[1]} >= ${e[0]})`),G.set(`remap`,(e,t,n)=>{let r=q(e).map((e,r)=>K(e,`${t}.args[${r}]`,n)),i=B(`remap`,t,r.map(e=>e.size)),[a,o,s,c,l]=r.map(e=>V(e,i)),u=n.emit(`${s} - ${o}`,i),d=H(i),f=n.emit(`select(${u.ref}, ${U(i)}, ${u.ref} == ${d})`,i);return n.emit(`select(${c} + ((${a} - ${o}) / ${f.ref}) * (${l} - ${c}), ${c}, ${u.ref} == ${d})`,i)}),G.set(`dot`,(e,t,n)=>{let r=q(e),i=K(r[0],`${t}.args[0]`,n),a=K(r[1],`${t}.args[1]`,n),o=B(`dot`,t,[i.size,a.size]);return o===1?n.emit(`${i.ref} * ${a.ref}`,1):n.emit(`dot(${V(i,o)}, ${V(a,o)})`,1)}),G.set(`cross`,(e,t,n)=>{let r=q(e),i=K(r[0],`${t}.args[0]`,n),a=K(r[1],`${t}.args[1]`,n);for(let[e,n]of[[`a`,i],[`b`,a]])if(n.size!==3)throw new A(`${t}: cross: argument \`${e}\` has width ${n.size}, but a cross product is defined for width 3 only. Scalars do NOT broadcast into one here — build a vec3 with \`vec(x, y, z)\`, or use \`dot\` for a product that works at any width.`);return n.emit(`cross(${i.ref}, ${a.ref})`,3)}),G.set(`smoothstep`,(e,t,n)=>{let r=q(e).map((e,r)=>K(e,`${t}.args[${r}]`,n)),i=B(`smoothstep`,t,r.map(e=>e.size)),[a,o,s]=r.map(e=>V(e,i)),c=H(i),l=U(i),u=n.emit(`select(${c}, ${l}, ${a} == ${o})`,i),d=n.emit(`${o} - ${a}`,i),f=n.emit(`select(${d.ref}, ${l}, ${u.ref} != ${c})`,i),p=n.emit(`clamp((${s} - ${a}) / ${f.ref}, ${c}, ${l})`,i),m=n.emit(`(${p.ref} * ${p.ref}) * (${Me(i,`3f`)} - ${Me(i,`2f`)} * ${p.ref})`,i);return n.emit(`select(${m.ref}, select(${c}, ${l}, ${s} >= ${a}), ${u.ref} != ${c})`,i)}),G.set(`distance`,(e,t,n)=>{let r=q(e),i=K(r[0],`${t}.args[0]`,n),a=K(r[1],`${t}.args[1]`,n),o=B(`distance`,t,[i.size,a.size]),s=n.emit(`${V(i,o)} - ${V(a,o)}`,o);if(o===1)return n.emit(`abs(${s.ref})`,1);let c=n.emit(`dot(${s.ref}, ${s.ref})`,1);return n.emit(`sqrt(${c.ref})`,1)}),G.set(`length`,(e,t,n)=>{let r=K(q(e)[0],`${t}.args[0]`,n);if(r.size===1)return n.emit(`abs(${r.ref})`,1);let i=n.emit(`dot(${r.ref}, ${r.ref})`,1);return n.emit(`sqrt(${i.ref})`,1)}),G.set(`normalize`,(e,t,n)=>{let r=K(q(e)[0],`${t}.args[0]`,n),i=r.size===1?n.emit(`${r.ref} * ${r.ref}`,1):n.emit(`dot(${r.ref}, ${r.ref})`,1),a=n.emit(`select(0f, 1f / sqrt(${i.ref}), ${i.ref} > 0f)`,1);return n.emit(`${r.ref} * ${a.ref}`,r.size)}),G.set(`vec`,(e,t,n)=>{let r=q(e).map((e,r)=>K(e,`${t}.args[${r}]`,n)),i=r.reduce((e,t)=>e+t.size,0);if(i>4)throw Ae(t,`vec result`,i);return r.length===1?r[0]:n.emit(`vec${i}<f32>(${r.map(e=>e.ref).join(`, `)})`,i)}),G.set(`component`,(e,t,n)=>{let r=K(q(e)[0],`${t}.args[0]`,n),i=e.index;if(i>=r.size)throw new A(`${t}: component: index ${i} out of range for tupleSize ${r.size}`);return r.size===1?r:n.emit(`${r.ref}.${ke[i]}`,1)}),G.set(`ramp`,(e,t,n)=>{let r=K(q(e)[0],`${t}.args[0]`,n);if(r.size!==1)throw new A(`${t}: ramp: input must be scalar, got tupleSize ${r.size}`);let i=e.stops,a=n.helper(`ramp`,Be(i,`${t}.stops`));return n.emit(`${a}(${r.ref})`,1)});function Be(e,t){let n=e=>j(e,t),r=e.length-1,i=[];i.push(`fn @NAME@(t: f32) -> f32 {`),i.push(`  if (t <= ${n(e[0][0])}) {`),i.push(`    return ${n(e[0][1])};`),i.push(`  }`),i.push(`  if (t >= ${n(e[r][0])}) {`),i.push(`    return ${n(e[r][1])};`),i.push(`  }`);let a=t=>{let r=e[t-1][0],i=e[t-1][1],a=e[t][0]-r,o=e[t][1]-i;return`${n(i)} + ${n(o)} * ((t - ${n(r)}) / ${n(a)})`};for(let t=1;t<r;t++)i.push(`  if (t <= ${n(e[t][0])}) {`),i.push(`    return ${a(t)};`),i.push(`  }`);return r>=1?i.push(`  return ${a(r)};`):i.push(`  return t;`),i.push(`}`),i.join(`
`)}var Ve={valueNoise:r,perlinNoise:h,simplexNoise:ne,worleyNoise:i},He={valueNoise:`pcg_value_noise`,perlinNoise:`pcg_perlin_noise`,simplexNoise:`pcg_simplex_noise`};function Ue(e){return e.opts??{}}function We(e,t,n,r){let i=Ue(t),a=i.position===void 0?n:`${n}.opts.position`,o=i.position===void 0?Fe(r,n,`P`,3,`${e} position reads `):K(i.position,a,r);if(o.size!==3)throw new A(`${a}: ${e}: position field must have tupleSize 3, got ${o.size}`);let s=j(i.frequency??1,`${n}.opts.frequency`),[c,l,u]=i.offset??[0,0,0],d=`vec3<f32>(${j(c,`${n}.opts.offset`)}, ${j(l,`${n}.opts.offset`)}, ${j(u,`${n}.opts.offset`)})`;return r.emit(`${o.ref} * ${s} + ${d}`,3)}function Ge(e){return e.libRoots.add(`pcg_hash_mix`),e.libRoots.add(`pcg_hash_finalize`),e.helper(`hash2`,`fn @NAME@(a: u32, b: u32) -> u32 {
  return pcg_hash_finalize(pcg_hash_mix(pcg_hash_mix(${M(k(2))}, a), b));
}`)}function Ke(e){return typeof e==`object`&&!!e}function qe(e,t,n){if(e===void 0)return`0u`;if(typeof e==`number`)return ae(e);let r=e.name;if(typeof r!=`string`||r===``)throw new A(`${t}.opts.seed.variant: param requires a non-empty string name`);if(a(e)!==void 0)throw new A(`${t}.opts.seed.variant: param ${JSON.stringify(r)} is bound to a Field, and a seed is resolved in u32 integer math with no per-element form; bind an integer, or evaluate this field on the CPU`);let{slot:i}=n.paramSlot(r);return`u32(params.consts[${i}].x)`}function Je(e,t,n){return Ke(e)?(n.usesSeed=!0,{expr:`${Ge(n)}(params.seed, ${qe(e.variant,t,n)})`}):{literal:(e??0)>>>0}}function Ye(e,t,n){let r=Ve[e];return`literal`in t?M(y(r,t.literal)):`${Ge(n)}(${M(r)}, ${t.expr})`}function Xe(e,t,n,r){let[i,a]=n,o=a-i;return e.emit(`(${t.ref} - ${j(i,r)}) / ${j(o,r)}`,1)}for(let e of[`valueNoise`,`perlinNoise`,`simplexNoise`])G.set(e,(t,n,r)=>{let i=Ue(t),a=Ye(e,Je(i.seed,n,r),r),o=We(e,t,n,r);r.libRoots.add(He[e]);let s=r.emit(`${He[e]}(${a}, ${o.ref})`,1);return i.normalized===!0?Xe(r,s,p[e],`${n}.opts.normalized`):s});G.set(`worleyNoise`,(e,t,n)=>{let r=Ue(e),i=r.output??`f1`,a=r.exact===!0,o=Ye(`worleyNoise`,Je(r.seed,t,n),n),s=We(`worleyNoise`,e,t,n);n.libRoots.add(`pcg_worley`);let c=i!==`f1`,l=n.emit(`pcg_worley(${o}, ${s.ref}, ${a}, ${c})`,2),u=i===`f1`?n.emit(`${l.ref}.x`,1):i===`f2`?n.emit(`${l.ref}.y`,1):n.emit(`${l.ref}.y - ${l.ref}.x`,1);return r.normalized===!0?Xe(n,u,p.worleyNoise[i],`${t}.opts.normalized`):u});function Ze(e){return e===`worleyNoise`?p.worleyNoise.f1:p[e]}function Qe(e,t,n){return e===`worleyNoise`?`pcg_worley(${t}, ${n}, false, false).x`:`${He[e]}(${t}, ${n})`}G.set(`fbm`,(e,t,n)=>{let r=e.base,i=Ue(e),a=i.octaves??4,o=i.lacunarity??2,s=i.gain??.5,c=i.frequency??1,[l,u,d]=i.offset??[0,0,0],p=Je(i.seed,t,n),m=i.position===void 0?t:`${t}.opts.position`,h=i.position===void 0?Fe(n,t,`P`,3,`fbm position reads `):K(i.position,m,n);if(h.size!==3)throw new A(`${m}: fbm: position field must have tupleSize 3, got ${h.size}`);let g=Ze(r),_=[],v=[],y=[],b=1,x=c,S=0,C=0;for(let e=0;e<a;e++)_.push(Ye(r,`literal`in p?{literal:f(p.literal,e)}:{expr:`${Ge(n)}(ns, ${ae(e)})`},n)),v.push(j(x,`${t}.opts.frequency`)),y.push(j(b,`${t}.opts.gain`)),S+=b>=0?b*g[0]:b*g[1],C+=b>=0?b*g[1]:b*g[0],b*=s,x*=o;n.libRoots.add(r===`worleyNoise`?`pcg_worley`:He[r]);let w=`vec3<f32>(${j(l,`${t}.opts.offset`)}, ${j(u,`${t}.opts.offset`)}, ${j(d,`${t}.opts.offset`)})`,T=`fn @NAME@(p: vec3<f32>) -> f32 {
${`literal`in p?``:`  let ns = ${p.expr};\n`}  var seeds = array<u32, ${a}>(${_.join(`, `)});
  var freqs = array<f32, ${a}>(${v.join(`, `)});
  var amps = array<f32, ${a}>(${y.join(`, `)});
  var sum = 0f;
  for (var o = 0u; o < ${ae(a)}; o++) {
    sum = sum + ${Qe(r,`seeds[o]`,`p * freqs[o] + `+w)} * amps[o];
  }
  return sum;
}`,E=n.helper(`fbm`,T),ee=n.emit(`${E}(${h.ref})`,1);if(i.normalized!==!0)return ee;if(!(C>S))throw new A(`${t}: fbm: normalized: true needs a non-degenerate output range, got [${S}, ${C}] for this octaves/gain configuration`);return Xe(n,ee,[S,C],`${t}.opts.normalized`)});var $e=new Set([`valueNoise`,`perlinNoise`,`simplexNoise`,`worleyNoise`,`fbm`]);function Y(e,t){if(!z(e))return;let n=e.fn;if(n===`param`){let n=a(e);n!==void 0&&Y(n,t);return}if(n===`attribute`||n===`attributeIs`){typeof e.name==`string`&&t.add(e.name);return}if(n===`byAttribute`){typeof e.name==`string`&&t.add(e.name);for(let n of b(e))Y(n,t);return}if(n===`position`){t.add(`P`);return}if(n===`randomField`){t.add(`P`),t.add(`seed`);return}if(typeof n==`string`&&$e.has(n)){let n=e.opts;z(n)&&n.position!==void 0?Y(n.position,t):t.add(`P`);return}let r=e.args;if(Array.isArray(r))for(let e of r)Y(e,t)}var et=16;function X(e,t){return`${JSON.stringify(e)},${JSON.stringify(t)}`}var tt={names:[],slots:new Map,arities:[],attrIs:[],attrIsSlots:new Map};function nt(e){return typeof e==`number`?1:e.length}function rt(e,t){if(z(e)){if(t(e),e.fn===`param`){let n=a(e);n!==void 0&&rt(n,t);return}for(let n of b(e))rt(n,t)}}function it(e){let t=ot.get(e);if(t!==void 0)return t;let n=st.get(e);if(n!==void 0)throw n;try{let t=at(e);return ot.set(e,t),t}catch(t){throw t instanceof A&&st.set(e,t),t}}function at(e){let t=new Map,n=new Set,r=new Map;if(rt(e,e=>{if(e.fn===`attributeIs`){if(typeof e.name!=`string`||e.name===``||typeof e.value!=`string`)return;r.set(X(e.name,e.value),{attr:e.name,value:e.value});return}if(e.fn===`byAttribute`){if(typeof e.name!=`string`||e.name===``||!z(e.cases))return;for(let t of Object.keys(e.cases))r.set(X(e.name,t),{attr:e.name,value:t});return}if(e.fn!==`param`||typeof e.name!=`string`||e.name===``)return;let i=e.name;if(a(e)!==void 0)return;if(v(e))throw new A(`param ${JSON.stringify(i)} is bound to a Field that carries no spec (a makeField closure, or something composed over one), so there is nothing to compile in its place; this expression evaluates on the CPU — build the bound field with the grammar constructors or fieldFromJson if it should lower`);n.add(i);let o=u(e);if(o===void 0)return;let s=nt(o);if(s>4)throw new A(`param ${JSON.stringify(i)} is bound to a ${s}-tuple, but a uniform slot holds 4 components; bind a tuple of 1 to 4, or evaluate this field on the CPU`);let c=t.get(i);if(c!==void 0&&c!==s)throw new A(`param ${JSON.stringify(i)} is bound to a ${c}-tuple in one place and a ${s}-tuple in another within the same expression; one uniform slot serves the name, so both references must have the same arity`);t.set(i,s)}),n.size===0&&r.size===0)return tt;let i=[...n].sort(),o=[...r.keys()].sort(),s=i.length+o.length;if(s>et)throw new A(`this field needs ${s} uniform constant slots (${i.length} distinct params and ${o.length} distinct string literals across its attributeIs tests and byAttribute case keys), but a kernel carries at most ${et}; split the expression, or evaluate it on the CPU (raise MAX_FIELD_CONST_SLOTS in compile.ts if an expression legitimately needs more)`);return{names:i,slots:new Map(i.map((e,t)=>[e,t])),arities:i.map(e=>t.get(e)??1),attrIs:o.map(e=>r.get(e)),attrIsSlots:new Map(o.map((e,t)=>[e,i.length+t]))}}var ot=new WeakMap,st=new WeakMap,ct=new WeakMap;function lt(e){let t=``;return e.names.length>0&&(t+=`|params=[${e.names.map((t,n)=>`${JSON.stringify(t)}:${e.arities[n]}`).join(`,`)}]`),e.attrIs.length>0&&(t+=`|attrIs=[${e.attrIs.map(e=>X(e.attr,e.value)).join(`;`)}]`),t}function ut(e,t){let n=it(e);if(n.names.length===0&&n.attrIs.length===0)return t;let r=ct.get(e);if(r!==void 0)return r;let i=`${E(e).key}${lt(n)}`;return ct.set(e,i),i}function dt(e,t){return e.length===t.length&&e.every((e,n)=>Object.is(e,t[n]))}function ft(e,t){return t.constSlots===0?{values:[]}:t.attrIsSlots.length>0?{problem:`this kernel carries ${t.attrIsSlots.length} string-literal slot(s) (${t.attrIsSlots.map(e=>`${JSON.stringify(e.attr)} == ${JSON.stringify(e.value)}`).join(`, `)}) whose values are string-table indices of the geometry being cooked; fill them with constSlotValues, which takes that geometry's attribute set`}:pt(e,t)}function pt(e,t){let n=new Map,r;if(rt(e,e=>{if(e.fn!==`param`||typeof e.name!=`string`||e.name===``)return;let t=e.name;if(a(e)!==void 0)return;let i=u(e);if(i===void 0){r??=`param ${JSON.stringify(t)} has no bound value`;return}let o=typeof i==`number`?[i]:[...i],s=n.get(t);s===void 0?n.set(t,o):dt(s,o)||(r??=`param ${JSON.stringify(t)} is bound to two different values in one expression`)}),r!==void 0)return{problem:r};let i=[];for(let e of t.paramNames){let t=n.get(e);if(t===void 0)return{problem:`param ${JSON.stringify(e)} is not referenced by this spec`};for(let e=0;e<4;e++)i.push(e<t.length?t[e]:0)}return{values:i}}var mt=-1;function ht(e,t,n){if(t.constSlots===0)return{values:[]};let r=pt(e,t);if(`problem`in r||t.attrIsSlots.length===0)return r;let i=[...r.values];for(let e of t.attrIsSlots){let t=n.get(e.attr);if(t===void 0||t.type!==`string`)return{problem:`attributeIs ${JSON.stringify(e.attr)}: this geometry has no string attribute of that name (${t===void 0?`no such attribute`:`it is ${t.type}`}), so the literal has no index to resolve to`};let r=t.lookupString(e.value)??mt;for(let e=0;e<4;e++)i.push(e===0?r:0)}return{values:i}}var gt=new Set([`f32`,`i32`,`u32`,`bool`,`string`]);function _t(e){if(!z(e)||!z(e.attributes))throw new A(`compileFieldSpec: layout must be { attributes: { name: { type, tupleSize } } }`);for(let[t,n]of Object.entries(e.attributes)){if(!z(n)||!gt.has(n.type))throw new A(`kernel layout attribute ${JSON.stringify(t)}: unknown type ${JSON.stringify(n?.type)}; valid types: "f32", "i32", "u32", "bool", "string" (a string column binds as u32 and is readable only through attributeIs)`);let e=n.tupleSize;if(typeof e!=`number`||!Number.isInteger(e)||e<1)throw new A(`kernel layout attribute ${JSON.stringify(t)}: tupleSize must be a positive integer, got ${String(e)}`)}}function vt(e){return typeof e==`number`?{fn:`constant`,value:e}:Array.isArray(e)?{fn:`constant`,value:[...e]}:e}function yt(e){return e.type===`bool`||e.type===`string`?`u32`:e.type}function bt(e,t){_t(t);let n=vt(e),r=E(n),i=new Set;Y(n,i);let a=[...i].filter(e=>Object.hasOwn(t.attributes,e)).sort(),o=it(n),s=new je(t,a,o),c=`f32`,l=0,u=[],d=e=>{if(l=e.size,e.size===1)u.push(`  outBuf[i] = ${e.ref};`);else for(let t=0;t<e.size;t++)u.push(`  outBuf[${W(e.size,t)}] = ${e.ref}.${ke[t]};`)},f=n.fn===`attribute`?n.name:n.fn===`position`?`P`:void 0;if(n.fn===`index`)c=`u32`,l=1,u.push(`  outBuf[i] = i;`);else if(f!==void 0){let e=Pe(s,`$`,f,n.fn===`position`?3:n.tupleSize,n.fn===`position`?`position reads `:``);if(e.type===`i32`||e.type===`u32`){c=e.type,l=e.tupleSize;let t=s.binding(f);for(let n=0;n<e.tupleSize;n++)u.push(`  outBuf[${W(e.tupleSize,n)}] = ${t.varName}[${W(e.tupleSize,n)}];`)}else d(Le(n,`$`,s))}else d(Le(n,`$`,s));let p=s.boundAttrs(),m=p.map(e=>({name:e.name,type:yt(e.attr),tupleSize:e.attr.tupleSize,binding:e.binding})),h=p.length+1,g=[`@group(0) @binding(0) var<uniform> params: PcgParams;`];for(let e of p)g.push(`@group(0) @binding(${e.binding}) var<storage, read> ${e.varName}: array<${yt(e.attr)}>; // attribute ${JSON.stringify(e.name)}: ${e.attr.type} tupleSize ${e.attr.tupleSize}`);g.push(`@group(0) @binding(${h}) var<storage, read_write> outBuf: array<${c}>;`);let _=o.names.length+o.attrIs.length,v=[`// Generated by pcg-ts compileFieldSpec (WGSL field kernel).
// Dispatch: 1D, chunked; each chunk runs ceil(chunkElements / ${De}) workgroups of ${De}
// with element index i = chunkOffset + gid.x; one invocation per element.

struct PcgParams {
  count: u32,
  seed: u32,
  chunkOffset: u32,${_===0?``:`\n  _pad0: u32,\n  consts: array<vec4<f32>, ${_}>,`}
}

${g.join(`
`)}`,...ue(s.libRoots),...s.helperBlocks(),`@compute @workgroup_size(${De})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x + params.chunkOffset;
  if (i >= params.count) {
    return;
  }
${[...s.lines,...u].join(`
`)}
}`],y=p.map(e=>`${JSON.stringify(e.name)}:${e.attr.type}x${e.attr.tupleSize}`).join(`,`),b=`${r.key}${lt(o)}`;return ct.set(n,b),{wgsl:`${v.join(`

`)}\n`,entryPoint:`main`,workgroupSize:De,outTupleSize:l,outType:c,inputs:m,bindings:{uniforms:0,output:h},constSlots:_,paramNames:o.names,attrIsSlots:o.attrIs,uniformBytes:fe(_),usesSeed:s.usesSeed,key:`${Oe}|spec=${b}|layout=[${y}]`}}var Z={MAP_READ:1,COPY_SRC:4,COPY_DST:8,VERTEX:32,UNIFORM:64,STORAGE:128},xt={READ:1},St=256;function Ct(e){let t=St;for(;t<e;)t*=2;return t}var wt=class{device;maxPooledBytes;free=new Map;meta=new Map;detachedSet=new WeakSet;idleBytes=0;idleCount=0;created=0;reused=0;destroyed=0;detachedTotal=0;detachedLive=0;detachedLiveBytes=0;constructor(e,t){this.device=e,this.maxPooledBytes=t}acquire(e,t){let n=Ct(e),r=`${t}|${n}`,i=this.free.get(r)?.pop();if(i!==void 0)return this.idleBytes-=n,this.idleCount--,this.reused++,i;let a=this.device.createBuffer({size:n,usage:t});return this.meta.set(a,{key:r,bytes:n}),this.created++,a}release(e){let t=this.meta.get(e);if(t===void 0)throw this.detachedSet.has(e)?Error(`BufferPool.release: buffer was detached from this pool, so the pool no longer owns it and cannot reclaim it; destroy it through the DetachedBuffer that detach() returned (or the handle wrapping it) and stop releasing it`):Error(`BufferPool.release: buffer was not acquired from this pool`);if(this.idleBytes+t.bytes>this.maxPooledBytes){this.meta.delete(e),e.destroy(),this.destroyed++;return}let n=this.free.get(t.key);n===void 0&&(n=[],this.free.set(t.key,n)),n.push(e),this.idleBytes+=t.bytes,this.idleCount++}detach(e){let t=this.meta.get(e);if(t===void 0)throw Error(this.detachedSet.has(e)?`BufferPool.detach: buffer was already detached from this pool; ownership can only leave once — reuse the DetachedBuffer the first detach() returned`:`BufferPool.detach: buffer was not acquired from this pool`);this.meta.delete(e),this.detachedSet.add(e),this.detachedTotal++,this.detachedLive++,this.detachedLiveBytes+=t.bytes;let n=!1,r=this;return{buffer:e,bytes:t.bytes,get destroyed(){return n},destroy(){n||(n=!0,r.detachedLive--,r.detachedLiveBytes-=t.bytes,r.destroyed++,e.destroy())}}}get stats(){return{buffersCreated:this.created,buffersReused:this.reused,buffersDestroyed:this.destroyed,pooledBuffers:this.idleCount,pooledBytes:this.idleBytes,buffersDetached:this.detachedTotal,detachedBuffers:this.detachedLive,detachedBytes:this.detachedLiveBytes}}dispose(){for(let e of this.free.values())for(let t of e)this.meta.delete(t),t.destroy(),this.destroyed++;this.free.clear(),this.idleBytes=0,this.idleCount=0}},Tt=`webgpu`,Et=class{backend=Tt;byteLength;detached;label;constructor(e,t,n){this.detached=e,this.byteLength=t,this.label=n}get disposed(){return this.detached.destroyed}get resource(){if(this.detached.destroyed)throw Error(`device transforms handle (${this.label}) was disposed; its GPU buffer is destroyed and cannot be bound. Dispose a handle only after the last frame that reads it, and re-cook to obtain a fresh one (device-resident outputs are never memoized, so every cook produces a new handle)`);return this.detached.buffer}dispose(){this.detached.destroy()}};function Dt(e,t,n){return new Et(e,t,n)}var Ot=65535;function kt(e,t){let n=Ot*e;return Math.max(e,Math.floor(Math.min(t??n,n)/e)*e)}var At=16,jt=`pcg-resident-run/6`;function Mt(e){return e.format===jt?e:null}var Nt={reason:`run-plan-failed`},Pt=[`+x`,`-x`,`+y`,`-y`,`+z`,`-z`];function Ft(e){if(typeof e!=`object`||!e||Array.isArray(e))return!1;let t=e;if(t.fn===`randomField`)return!0;for(let e of b(t))if(Ft(e))return!0;return!1}function It(e){return Array.isArray(e)&&e.length===3&&e.every(e=>typeof e==`number`&&Number.isFinite(e))}var Q=class extends Error{};function Lt(e,t,n,r,i){let a=[...e].map(([e,t])=>({name:e,slot:t})),o=i||r===null,s=t.reduce((e,t)=>e+t.bytes,0),c=n.reduce((e,t)=>e+t,0),l=o?a.reduce((e,n)=>e+t[n.slot].bytes,0):0;return{writtenList:a,materialize:o,totalBytes:s+c+l+(r?.bytes??0)+(r?.colorBytes??0)+(r?.channelBytes??0)+(r?.permBytes??0)}}function Rt(e,n,r,i,a={}){let o=a.deviceInstanceAttrs===!0,s=n.count,c=new Map(Object.entries(n.attributes)),l=[],u=new Map,d=[],p=new Map,h=[],g=[],_=null,v=()=>Object.fromEntries(c),y=e=>{let t=u.get(e);if(t!==void 0)return t;let n=c.get(e);if(n===void 0||n.type===`string`)throw new Q(e);let r=l.length;return l.push({bytes:s*n.tupleSize*4,init:`attr`,name:e}),u.set(e,r),r},b=(e,t,n)=>{let r=l.length;return l.push({bytes:s*t*4,init:n,name:e}),u.set(e,r),r},x=(e,t,n)=>{let r=c.get(e);if(r===void 0||r.type!==t||r.tupleSize!==n)throw new Q(e)},S=(e,t,n)=>{let r=t.length/4;if(r>=4)throw Error(`resident run: "${n}" needs more than 4 uniform constant slots for its constant params; raise MAX_APPLY_CONST_SLOTS in applyKernels.ts (each slot costs 16 bytes of the per-chunk uniform and nothing else)`);for(let n=0;n<4;n++)t.push(n<e.length?e[n]:0);return{kind:`const`,tupleSize:e.length,slot:r}},C=(e,t,n,r,a,o)=>{let c;if(T(e)){let t=m(e,i);if(t===void 0)throw new Q(`no spec`);if(p.has(`P`)&&Ft(t))throw new Q(`identity after P write`);c=t}else if(typeof e==`number`||Array.isArray(e)&&e.every(e=>typeof e==`number`)){let t=typeof e==`number`?[e]:e;if(t.length<1||t.length>4||r!==null&&!r.includes(t.length))throw new Q(`tuple`);for(let e of t)if(!Number.isFinite(Math.fround(e)))throw new Q(`f32 range`);return{param:S(t,a,o),ref:null}}else throw new Q(`bad param value`);let l;try{l=bt(c,{attributes:v()})}catch{throw new Q(`compile`)}if(l.inputs.length+1>8)throw new Q(`buffers`);if(r!==null&&!r.includes(l.outTupleSize))throw new Q(`tuple`);if(l.attrIsSlots.length>0)throw new Q(`attributeIs / byAttribute need a per-dispatch string table`);let u=ft(c,l);if(`problem`in u)throw new Q(`param bindings`);let f=d.length;return d.push(s*l.outTupleSize*4),n.push({key:l.key,wgsl:l.wgsl,entryPoint:l.entryPoint,workgroupSize:l.workgroupSize,seed:t,uniformsBinding:l.bindings.uniforms,uniformBytes:l.uniformBytes,consts:u.values,perBatch:!1,bindings:[...l.inputs.map(e=>({binding:e.binding,ref:{kind:`slot`,index:y(e.name)}})),{binding:l.bindings.output,ref:{kind:`col`,index:f}}]}),{param:{kind:`column`,type:l.outType,tupleSize:l.outTupleSize},ref:{kind:`col`,index:f}}},w=(e,t,n,r,i=!1)=>{if(e.constSlots*4!==r.length)throw Error(`resident run: apply kernel "${e.key}" declares ${e.constSlots} constant slots but the planner allocated ${r.length/4}`);return{key:e.key,wgsl:e.wgsl,entryPoint:e.entryPoint,workgroupSize:e.workgroupSize,seed:t,uniformsBinding:0,uniformBytes:e.uniformBytes,consts:r,perBatch:i,bindings:e.bindings.map(e=>{let t=n[e.role];if(t===void 0)throw new Q(`unmapped role ${e.role}`);return{binding:e.binding,ref:t}})}};try{for(let n of e){let r=n===e[e.length-1],i=[],a=[],l=n.params;switch(n.kind){case`setAttribute`:{let e=l.name,t=l.type,r=l.tupleSize;if(typeof e!=`string`)throw new Q(`name`);if(t!==`f32`&&t!==`i32`&&t!==`u32`&&t!==`bool`)throw new Q(`type`);if(typeof r!=`number`||!Number.isInteger(r)||r<1||r>4)throw new Q(`tupleSize`);let o=typeof l.seed==`number`?l.seed:NaN,s=o===0?n.seed:f(n.seed,o),{param:u,ref:d}=C(l.value,s,i,r===1?[1]:[1,r],a,n.kind),m=b(e,r,`none`);c.set(e,{type:t,tupleSize:r}),p.set(e,m),h.push({op:`replace`,name:e,type:t,tupleSize:r});let g={target:{kind:`slot`,index:m}};d!==null&&(g.value=d),i.push(w(ye(u,t,r),0,g,a));break}case`transformPoints`:{x(`P`,`f32`,3);let e=C(l.translate,n.seed,i,[1,3],a,n.kind),t=C(l.rotateEuler,n.seed,i,[1,3],a,n.kind),r=C(l.scale,n.seed,i,[1,3],a,n.kind),o=c.get(`rot`),s=o!==void 0&&o.type===`f32`&&o.tupleSize===4,u=c.get(`scale`),d=u!==void 0&&u.type===`f32`&&u.tupleSize===3,f=y(`P`);p.set(`P`,f);let m={P:{kind:`slot`,index:f}};if(e.ref!==null&&(m.translate=e.ref),t.ref!==null&&(m.rotateEuler=t.ref),r.ref!==null&&(m.scale=r.ref),s){let e=y(`rot`);p.set(`rot`,e),m.rot={kind:`slot`,index:e}}if(d){let e=y(`scale`);p.set(`scale`,e),m.scaleAttr={kind:`slot`,index:e}}i.push(w(xe(e.param,t.param,r.param,s,d),0,m,a));break}case`jitterPoints`:{if(x(`P`,`f32`,3),p.has(`P`))throw new Q(`identity after P write`);let e=typeof l.seed==`number`?l.seed:NaN,t=f(n.seed,e),r=C(l.amount,t,i,[1,3],a,n.kind),o=c.get(`seed`),s=o!==void 0;if(s&&(o.type!==`u32`||o.tupleSize!==1))throw new Q(`seed attribute shape`);let u=y(`P`);p.set(`P`,u);let d={P:{kind:`slot`,index:u}};r.ref!==null&&(d.amount=r.ref),s&&(d.seed={kind:`slot`,index:y(`seed`)}),i.push(w(Se(r.param,s),t,d,a));break}case`orientAlongVector`:{let e=l.axis;if(!Pt.includes(e))throw new Q(`axis`);if(!It(l.up))throw new Q(`up`);let t=C(l.direction,n.seed,i,[1,3],a,n.kind),r=l.up,o=r[0]*r[0]+r[1]*r[1]+r[2]*r[2],s=o>0?1/Math.sqrt(o):0,u=[r[0]*s,r[1]*s,r[2]*s];for(let e of u)if(!Number.isFinite(Math.fround(e)))throw new Q(`up range`);let d=S(u,a,n.kind),f=c.get(`rot`),m=f!==void 0&&f.type===`f32`&&f.tupleSize===4?y(`rot`):b(`rot`,4,`quat-default`);c.set(`rot`,{type:`f32`,tupleSize:4}),p.set(`rot`,m),h.push({op:`ensure-rot`});let g={rot:{kind:`slot`,index:m}};t.ref!==null&&(g.direction=t.ref),i.push(w(we(t.param,e,d),0,g,a));break}case`spawnInstances`:{if(!r)throw new Q(`spawnInstances must be the run's last member`);let e=l.assetId;if(typeof e!=`string`||e===``)throw new Q(`assetId`);if(x(`P`,`f32`,3),s>1048576)throw new Q(`${s} instances over MAX_INSTANCES`);let n=l.assetAttr;if(n!==void 0&&typeof n!=`string`)throw new Q(`assetAttr`);let u=n===void 0?``:n;if(u!==``){let e=c.get(u);if(e===void 0)throw new Q(`assetAttr "${u}" not on the point domain`);if(e.type!==`string`)throw new Q(`assetAttr "${u}" is ${e.type}, not string`)}let d=l.instanceAttrs,f=[];if(d!==void 0){if(!Array.isArray(d))throw new Q(`instanceAttrs`);if(d.length>0&&!o)throw new Q(`instanceAttrs names ${d.length} per-instance channel(s) and this resolver did not opt in to device channels (deviceInstanceAttrs)`);let e=new Set;for(let n of d){if(typeof n!=`string`)throw new Q(`instanceAttrs entry is not a string`);if(n===``)throw new Q(`instanceAttrs contains an empty name`);if(e.has(n))throw new Q(`instanceAttrs names "${n}" twice`);if(e.add(n),n===`color`)throw new Q(`instanceAttrs cannot carry "${t}" — the name is reserved for per-instance RGB (colorAttr is the route)`);let r=c.get(n);if(r===void 0)throw new Q(`instanceAttrs "${n}" not on the point domain`);if(r.type===`string`)throw new Q(`instanceAttrs "${n}" is a string attribute`);if(!Number.isInteger(r.tupleSize)||r.tupleSize<1||r.tupleSize>4)throw new Q(`instanceAttrs "${n}" has tupleSize ${r.tupleSize}; a device channel binds as a scalar or a vec2/vec3/vec4`);let i;try{i=O(r.type,r.tupleSize)}catch{throw new Q(`instanceAttrs "${n}" has no device channel layout`)}f.push({name:n,type:r.type,itemSize:r.tupleSize,components:i.components,byteStride:i.byteStride})}}let p=l.colorAttr;if(p!==void 0&&typeof p!=`string`)throw new Q(`colorAttr`);let m=p===void 0?``:p,h=0;if(m!==``){let e=c.get(m);if(e===void 0)throw new Q(`colorAttr "${m}" not on the point domain`);if(e.type!==`f32`||e.tupleSize<3)throw new Q(`colorAttr "${m}" is ${e.type}x${e.tupleSize}`);h=e.tupleSize}let g=c.get(`rot`),v=g!==void 0&&g.type===`f32`&&g.tupleSize===4,b=c.get(`scale`),S=b!==void 0&&b.type===`f32`&&b.tupleSize===3,C={P:{kind:`slot`,index:y(`P`)},transforms:{kind:`out`}};v&&(C.rot={kind:`slot`,index:y(`rot`)}),S&&(C.scaleAttr={kind:`slot`,index:y(`scale`)});let T=u!==``;T&&(C.perm={kind:`perm`}),h>0&&(C.color={kind:`slot`,index:y(m)},C.colors={kind:`colorOut`}),i.push(w(Te(v,S,T,h),0,C,a,T)),f.forEach((e,t)=>{let n={src:{kind:`slot`,index:y(e.name)},out:{kind:`channelOut`,index:t}};T&&(n.perm={kind:`perm`}),i.push(w(Ee(e.itemSize,e.components,T),0,n,[],T))}),_={assetId:e,assetAttr:u,colorAttr:m,colorTupleSize:h,count:s,bytes:s*64,colorBytes:h>0?s*At:0,channels:f,channelBytes:f.reduce((e,t)=>e+s*t.byteStride,0),permBytes:T?s*4:0};break}default:throw new Q(`unknown kind ${n.kind}`)}g.push({id:n.id,type:n.type,steps:i})}}catch(e){if(e instanceof Q)return Nt;throw e}let{writtenList:E,materialize:ee,totalBytes:te}=Lt(p,l,d,_,n.needsGeometry);return te>r?{reason:`run-too-large`}:{plan:{format:jt,count:s,members:g,slots:l,cols:d,written:E,layoutOps:h,materialize:ee,instances:_,totalBytes:te}}}var zt={f32:Float32Array,i32:Int32Array,u32:Uint32Array};function Bt(){return new Promise(e=>setTimeout(e,0))}async function Vt(e,n,r,i){let{device:a,pool:s}=e,{geo:c,signal:l,budgetMs:u}=r,d=n.count;if(c.attrs.point.count!==d)throw Error(`resident run: plan was built for ${d} points but the input geometry has ${c.attrs.point.count}; plans are single-cook artifacts — re-plan for new inputs`);let f=()=>{if(l?.aborted)throw new o},p=[],m=(e,t)=>{let n=s.acquire(e,t);return p.push(n),n},h=new Set,g=[];try{let r=c.attrs.point,o=n.slots.map(e=>{let t=m(e.bytes,Z.STORAGE|Z.COPY_DST|Z.COPY_SRC);if(e.init===`attr`){let n=r.require(e.name),i=e.bytes/4;if(n.data instanceof Uint8Array){let e=new Uint32Array(i);for(let t=0;t<i;t++)e[t]=n.data[t];a.queue.writeBuffer(t,0,e)}else a.queue.writeBuffer(t,0,n.data.subarray(0,i))}else if(e.init===`quat-default`){let n=new Float32Array(e.bytes/4);for(let e=3;e<n.length;e+=4)n[e]=1;a.queue.writeBuffer(t,0,n)}return t}),l=n.cols.map(e=>m(e,Z.STORAGE|Z.COPY_DST|Z.COPY_SRC)),p=n.instances===null?void 0:te(c,{defaultAssetId:n.instances.assetId,...n.instances.assetAttr===``?{}:{assetAttr:n.instances.assetAttr}}),_=n.instances!==null&&n.instances.permBytes>0?m(n.instances.permBytes,Z.STORAGE|Z.COPY_DST):void 0;_!==void 0&&p!==void 0&&a.queue.writeBuffer(_,0,p.perm);let v=Z.STORAGE|Z.COPY_DST|Z.COPY_SRC|Z.VERTEX,y=p===void 0?[]:Array.from(p.counts,e=>m(e*64,v)),b=p===void 0||n.instances===null||n.instances.colorBytes===0?[]:Array.from(p.counts,e=>m(e*At,v)),x=n.instances?.channels??[],S=p===void 0||x.length===0?[]:Array.from(p.counts,e=>x.map(t=>m(e*t.byteStride,v))),C=(e,t)=>{if(e.kind===`slot`)return o[e.index];if(e.kind===`col`)return l[e.index];if(e.kind===`colorOut`){let e=b[t];if(e===void 0)throw Error(`resident run: a kernel binds a retained instance-colour buffer but the plan declares no colour output (plan and kernels disagree)`);return e}if(e.kind===`channelOut`){let n=S[t]?.[e.index];if(n===void 0)throw Error(`resident run: a kernel binds retained per-instance channel ${e.index} but the plan declares no such channel (plan and kernels disagree)`);return n}if(e.kind===`perm`){if(_===void 0)throw Error(`resident run: a kernel binds the grouping permutation but the plan declares no per-point asset attribute (plan and kernels disagree)`);return _}let n=y[t];if(n===void 0)throw Error(`resident run: a kernel binds a retained instance-transform buffer but the plan declares no instances output (plan and kernels disagree)`);return n},T=a.createCommandEncoder(),E=T.beginComputePass(),ne=performance.now();for(let t of n.members){f();for(let n of t.steps){let t=e.getPipeline(n.key,n.wgsl,n.entryPoint,i);E.setPipeline(t);let r=kt(n.workgroupSize,e.maxElementsPerDispatch),o=n.perBatch&&p!==void 0?Array.from(p.counts,(e,t)=>({batch:t,elements:e,base:p.offsets[t]})):[{batch:0,elements:d,base:0}];for(let e of o){i!==void 0&&i.dispatches++;let o=new ArrayBuffer(n.uniformBytes),s=new Uint8Array(o),c=new Uint32Array(o,0,n.uniformBytes>=16?4:3);c[0]=e.elements,c[1]=n.seed>>>0,n.perBatch&&(c[3]=e.base),n.consts.length>0&&new Float32Array(o,16,n.consts.length).set(n.consts);let l=Math.ceil(e.elements/r);for(let i=0;i<l;i++){let o=m(n.uniformBytes,Z.UNIFORM|Z.COPY_DST);c[2]=i*r,a.queue.writeBuffer(o,0,s);let l=a.createBindGroup({layout:t.getBindGroupLayout(0),entries:[{binding:n.uniformsBinding,resource:{buffer:o}},...n.bindings.map(t=>({binding:t.binding,resource:{buffer:C(t.ref,e.batch)}}))]}),u=Math.min(r,e.elements-i*r);E.setBindGroup(0,l),E.dispatchWorkgroups(Math.ceil(u/n.workgroupSize))}}}u!==void 0&&performance.now()-ne>u&&(await Bt(),f(),ne=performance.now())}E.end();let re=[],D,O=n.materialize?n.written.reduce((e,t)=>e+n.slots[t.slot].bytes,0):0;if(O>0){D=m(O,Z.COPY_DST|Z.MAP_READ);let e=0;for(let t of n.written){let r=n.slots[t.slot].bytes;T.copyBufferToBuffer(o[t.slot],0,D,e,r),re.push(e),e+=r}}a.queue.submit([T.finish()]);let k;if(n.materialize){let e;if(D!==void 0){await D.mapAsync(xt.READ,0,O);try{e=D.getMappedRange(0,O).slice(0)}finally{D.unmap()}}f(),k=ee(c);let t=k.attrs.point;for(let e of n.layoutOps)if(e.op===`replace`)t.replace(e.name,e.type,e.tupleSize);else{let e=t.get(`rot`);(!e||e.type!==`f32`||e.tupleSize!==4)&&(e&&t.remove(`rot`),t.add(`rot`,`f32`,4,[0,0,0,1]))}n.written.forEach((n,r)=>{let i=t.require(n.name),a=d*i.tupleSize;if(e===void 0)throw Error(`resident run: readback missing for a written attribute`);if(i.data instanceof Uint8Array){let t=new Uint32Array(e,re[r],a);for(let e=0;e<a;e++)i.data[e]=t[e]}else{let t=zt[i.type];if(t===void 0)throw Error(`resident run: cannot materialize attribute "${n.name}" of type ${i.type}`);i.data.set(new t(e,re[r],a))}})}else f();let ie;if(n.instances!==null){let e=n.instances.colorBytes>0;if(p===void 0||y.length!==p.order.length||b.length!==(e?p.order.length:0)||S.length!==(x.length>0?p.order.length:0)||S.some(e=>e.length!==x.length))throw Error(`resident run: the plan declares an instances output but the acquired transform buffers do not match the grouping (library bug: plan.instances, the grouping, and the acquired buffers must agree)`);let r=(e,t,n)=>{let r=s.detach(e);h.add(e);try{return Dt(r,t,n)}catch(e){throw r.destroy(),e}},i=[];for(let n=0;n<p.order.length;n++){let a=p.order[n],o=p.counts[n],s=r(y[n],o*64,`${o} instances of "${a}"`);g.push(s);let c=Object.create(null);if(e){let e=r(b[n],o*At,`${o} instance colours of "${a}"`);g.push(e),c[t]={handle:e,type:`f32`,itemSize:3}}x.forEach((e,t)=>{let i=r(S[n][t],o*e.byteStride,`${o} instance "${e.name}" values of "${a}"`);g.push(i),c[e.name]={handle:i,type:e.type,itemSize:e.itemSize}}),i.push(w(a,o,s,c))}ie=i}i!==void 0&&(i.residentRuns++,i.fusedNodes+=n.members.length,i.readbacksSaved+=n.members.length-+!!n.materialize);let A={};return k!==void 0&&(A.geo=k),ie!==void 0&&(A.deviceBatches=ie),A}catch(e){for(let e of g)e.dispose();throw e instanceof o?e:Error(`GpuFieldEvaluator: resident run failed (${n.members.length} fused nodes [${n.members.map(e=>`"${e.id}"`).join(`, `)}], ${d} points): ${e instanceof Error?e.message:String(e)}`,{cause:e})}finally{for(let e of p)h.has(e)||s.release(e)}}var Ht=`gpu2`,Ut=268435456,Wt=[`spawnInstances`],Gt={f32:Float32Array,i32:Int32Array,u32:Uint32Array},Kt={f32:Float32Array,i32:Int32Array,u32:Uint32Array};function qt(e){let t=e=>e!==void 0&&e!==``?e:`?`;return[Ht,t(e?.vendor),t(e?.architecture),t(e?.device),t(e?.description)].join(`|`)}function $(e,t){return e!==void 0&&(e.fallbacks[t]=(e.fallbacks[t]??0)+1),null}var Jt=class{cacheSalt;residentTerminals;acceptDerivedSpecs;deviceInstanceAttrs;device;kernels=new Map;pipelines=new Map;pool;maxElementsPerDispatch;maxResidentBytes;constructor(e,t={}){if(t.maxElementsPerDispatch!==void 0&&!Number.isFinite(t.maxElementsPerDispatch))throw Error(`GpuFieldEvaluator: maxElementsPerDispatch must be a finite number, got ${t.maxElementsPerDispatch}; leave it unset to use the device maximum`);if(t.deviceInstanceAttrs===!0&&t.deviceInstances!==!0)throw Error(`GpuFieldEvaluator: deviceInstanceAttrs requires deviceInstances: true — per-instance channels ride on a device-resident spawner terminal, and without deviceInstances no spawner is one, so the flag could never take effect. Pass both to produce channels on the device (and bind them yourself from batch.attributes[name].handle.resource), or drop deviceInstanceAttrs to let the CPU spawner produce transforms and channels together.`);this.device=e,this.cacheSalt=qt(t.adapterInfo??e.adapterInfo),this.pool=new wt(e,t.maxPooledBytes??Ut),this.maxElementsPerDispatch=t.maxElementsPerDispatch,this.maxResidentBytes=t.maxResidentBytes??536870912,this.residentTerminals=t.deviceInstances===!0?Wt:[],this.deviceInstanceAttrs=t.deviceInstanceAttrs===!0,this.acceptDerivedSpecs=re(t)}get pipelineCacheSize(){return this.pipelines.size}get kernelCacheSize(){return this.kernels.size}get poolStats(){return this.pool.stats}dispose(){this.pool.dispose()}chunkElements(e){let t=Ot*e.workgroupSize,n=Math.min(this.maxElementsPerDispatch??t,t);return Math.max(e.workgroupSize,Math.floor(n/e.workgroupSize)*e.workgroupSize)}resolveField(e,t,n){let r=m(e,this.acceptDerivedSpecs);if(r===void 0)return $(n,ie(e));let i=t.geo.attrs[t.domain],a={},o=[];for(let e of i.names().sort()){let t=i.get(e);t!==void 0&&(a[e]={type:t.type,tupleSize:t.tupleSize},o.push(`${JSON.stringify(e)}:${t.type}x${t.tupleSize}`))}let s;try{s=ut(r,e.key)}catch{return $(n,`compile-error`)}let c=`${s.length}#${s}|${o.join(`,`)}`,l=this.kernels.get(c);if(l===void 0){try{l=bt(r,{attributes:a})}catch(e){l=e instanceof Error?e:Error(String(e))}this.kernels.set(c,l)}if(l instanceof Error)return $(n,`compile-error`);if(l.inputs.length+1>8)return $(n,`too-many-buffers`);let u=ht(r,l,i);if(`problem`in u)return $(n,`param-bindings`);let d=i.count;if(d===0)return Promise.resolve({data:new Kt[l.outType](0),tupleSize:l.outTupleSize});let f=this.getPipeline(l.key,l.wgsl,l.entryPoint,n);return n!==void 0&&n.dispatches++,this.dispatch(e,t,l,f,d,u.values)}getPipeline(e,t,n,r){let i=this.pipelines.get(e);if(i!==void 0)return r!==void 0&&r.pipelineCacheHits++,i;let a=this.device.createShaderModule({code:t}),o=this.device.createComputePipeline({layout:`auto`,compute:{module:a,entryPoint:n}});return this.pipelines.set(e,o),r!==void 0&&r.pipelinesCompiled++,o}planRun(e,t,n){let r=Rt(e,t,this.maxResidentBytes,this.acceptDerivedSpecs,{deviceInstanceAttrs:this.deviceInstanceAttrs});return`plan`in r?r.plan:(n!==void 0&&(n.fallbacks[r.reason]=(n.fallbacks[r.reason]??0)+1),null)}executeRun(e,t,n){let r=Mt(e);return r===null?Promise.reject(Error(`GpuFieldEvaluator.executeRun: plan was not produced by this library's planRun; pass the object returned by planRun on the same resolver`)):Vt({device:this.device,pool:this.pool,maxElementsPerDispatch:this.maxElementsPerDispatch,getPipeline:(e,t,n,r)=>this.getPipeline(e,t,n,r)},r,t,n)}async dispatch(e,t,n,r,i,a){let o=this.device,s=[],c=(e,t)=>{let n=this.pool.acquire(e,t);return s.push(n),n};try{let e=this.chunkElements(n),s=Math.ceil(i/e),l=[],u=t.geo.attrs[t.domain];for(let e of n.inputs){let t=u.require(e.name),n=i*e.tupleSize,r;if(t.data instanceof Uint8Array){let e=new Uint32Array(n);for(let r=0;r<n;r++)e[r]=t.data[r];r=e}else r=t.data.subarray(0,n);let a=c(n*4,Z.STORAGE|Z.COPY_DST);o.queue.writeBuffer(a,0,r),l.push({binding:e.binding,resource:{buffer:a}})}let d=i*n.outTupleSize*4,f=c(d,Z.STORAGE|Z.COPY_SRC);l.push({binding:n.bindings.output,resource:{buffer:f}});let p=c(d,Z.COPY_DST|Z.MAP_READ),m=new ArrayBuffer(n.uniformBytes),h=new Uint8Array(m),g=new Uint32Array(m,0,3);g[0]=i,g[1]=t.seed>>>0,a.length>0&&new Float32Array(m,16,a.length).set(a);let _=[];for(let t=0;t<s;t++){let i=c(n.uniformBytes,Z.UNIFORM|Z.COPY_DST);g[2]=t*e,o.queue.writeBuffer(i,0,h),_.push(o.createBindGroup({layout:r.getBindGroupLayout(0),entries:[{binding:n.bindings.uniforms,resource:{buffer:i}},...l]}))}let v=o.createCommandEncoder(),y=v.beginComputePass();y.setPipeline(r);for(let t=0;t<s;t++){let r=Math.min(e,i-t*e);y.setBindGroup(0,_[t]),y.dispatchWorkgroups(Math.ceil(r/n.workgroupSize))}y.end(),v.copyBufferToBuffer(f,0,p,0,d),o.queue.submit([v.finish()]),await p.mapAsync(xt.READ,0,d);let b;try{b=p.getMappedRange(0,d).slice(0)}finally{p.unmap()}return{data:new Gt[n.outType](b),tupleSize:n.outTupleSize}}catch(n){throw Error(`GpuFieldEvaluator: dispatch failed for field ${e.key} (${i} elements on the ${t.domain} domain): ${n instanceof Error?n.message:String(n)}`,{cause:n})}finally{for(let e of s)this.pool.release(e)}}};export{Jt as t};