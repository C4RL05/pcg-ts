import{$n as e,$r as t,Kr as n,Qn as r,Un as i,Vt as a,Xn as o,Xr as s,Yn as c,Yr as l,Zn as u,Zr as d,ai as f,ar as p,ci as m,ei as h,er as g,fr as _,ii as v,li as y,ni as b,nr as x,oi as S,or as C,qr as w,ri as T,rr as E,si as D,sr as O,ti as ee,ui as te,zn as ne}from"./wordmark-B5k0wSGX.js";var k=class extends Error{constructor(e){super(e),this.name=`GpuCompileError`}};function A(e,t){let n=Math.fround(e);if(!Number.isFinite(n))throw new k(`${t}: value ${e} is not representable as a finite f32 (WGSL kernels compute in f32; keep magnitudes within ~3.4e38)`);return Object.is(n,-0)?`-0f`:`${String(n)}f`}function re(e){return`${e>>>0}u`}function j(e){return`0x${(e>>>0).toString(16).padStart(8,`0`)}u`}var M=j,ie=A(34028234663852886e22,`internal f32 max`);function ae(e,t){let n=M(e);for(let e of t)n=`pcg_hash_mix(${n}, ${e})`;return`pcg_hash_finalize(${n})`}function oe(){let e=[];for(let t=0;t<12;t++){let n=e=>A(p[t*3+e],`internal GRAD3`);e.push(`  vec3<f32>(${n(0)}, ${n(1)}, ${n(2)}),`)}return`var<private> PCG_GRAD3: array<vec3<f32>, 12> = array<vec3<f32>, 12>(
${e.join(`
`)}
);`}var N=e=>t=>A(t,e),se=new Map([[`PCG_GRAD3`,{deps:[],text:oe()}],[`pcg_hash_mix`,{deps:[],text:`fn pcg_hash_mix(h_in: u32, value: u32) -> u32 {
  var k = value * ${M(v)};
  k = (k << 15u) | (k >> 17u);
  k = k * ${M(f)};
  var h = h_in ^ k;
  h = (h << 13u) | (h >> 19u);
  h = h * 5u + ${M(S)};
  return h;
}`}],[`pcg_hash_finalize`,{deps:[],text:`fn pcg_hash_finalize(h_in: u32) -> u32 {
  var h = h_in ^ (h_in >> 16u);
  h = h * ${M(ee)};
  h = h ^ (h >> 13u);
  h = h * ${M(b)};
  h = h ^ (h >> 16u);
  return h;
}`}],[`pcg_hash3`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash3(a: u32, b: u32, c: u32) -> u32 {
  return ${ae(m(3),[`a`,`b`,`c`])};
}`}],[`pcg_hash4`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash4(a: u32, b: u32, c: u32, d: u32) -> u32 {
  return ${ae(m(4),[`a`,`b`,`c`,`d`])};
}`}],[`pcg_hash5`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash5(a: u32, b: u32, c: u32, d: u32, e: u32) -> u32 {
  return ${ae(m(5),[`a`,`b`,`c`,`d`,`e`])};
}`}],[`pcg_hash_float`,{deps:[],text:`fn pcg_hash_float(h: u32) -> f32 {
  return f32(h >> 8u) * ${A(T,`internal hashFloat scale`)};
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
  return ${N(`internal PERLIN_SCALE`)(E)} * pcg_mix(
    pcg_mix(pcg_mix(n000, n100, u), pcg_mix(n010, n110, u), v),
    pcg_mix(pcg_mix(n001, n101, u), pcg_mix(n011, n111, u), v),
    w);
}`}],[`pcg_simplex_corner`,{deps:[`pcg_hash4`,`PCG_GRAD3`],text:`fn pcg_simplex_corner(seed: u32, i: i32, j: i32, k: i32, x: f32, y: f32, z: f32) -> f32 {
  let t = ${N(`internal simplex R2`)(e)} - x * x - y * y - z * z;
  if (t <= 0f) {
    return 0f;
  }
  let g = pcg_hash4(seed, bitcast<u32>(i), bitcast<u32>(j), bitcast<u32>(k)) % 12u;
  let t2 = t * t;
  return t2 * t2 * dot(PCG_GRAD3[g], vec3<f32>(x, y, z));
}`}],[`pcg_simplex_noise`,{deps:[`pcg_simplex_corner`],text:`fn pcg_simplex_noise(seed: u32, p: vec3<f32>) -> f32 {
  let s = (p.x + p.y + p.z) * ${N(`internal simplex F3`)(u)};
  let i = i32(floor(p.x + s));
  let j = i32(floor(p.y + s));
  let k = i32(floor(p.z + s));
  let t = f32(i + j + k) * ${N(`internal simplex G3`)(r)};
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
  let x1 = x0 - f32(i1) + ${N(`internal simplex G3`)(r)};
  let y1 = y0 - f32(j1) + ${N(`internal simplex G3`)(r)};
  let z1 = z0 - f32(k1) + ${N(`internal simplex G3`)(r)};
  let x2 = x0 - f32(i2) + ${N(`internal simplex 2*G3`)(2*r)};
  let y2 = y0 - f32(j2) + ${N(`internal simplex 2*G3`)(2*r)};
  let z2 = z0 - f32(k2) + ${N(`internal simplex 2*G3`)(2*r)};
  let x3 = x0 - 1f + ${N(`internal simplex 3*G3`)(3*r)};
  let y3 = y0 - 1f + ${N(`internal simplex 3*G3`)(3*r)};
  let z3 = z0 - 1f + ${N(`internal simplex 3*G3`)(3*r)};
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
  var f1 = ${ie};
  var f2 = ${ie};
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
}`}]]);function ce(e){let t=new Set,n=e=>{if(t.has(e))return;let r=se.get(e);if(!r)throw Error(`internal: unknown WGSL library item "${e}"`);t.add(e);for(let e of r.deps)n(e)};for(let t of e)n(t);let r=[];for(let[e,n]of se)t.has(e)&&r.push(n.text);return r}var le=`apply2`;function ue(e,t=!1){return e>0?16+e*16:t?16:12}var de=[`x`,`y`,`z`,`w`];function P(e,t,n){if(t.kind===`const`)return pe(t,n);let r=me(e,t,n);return t.type===`f32`?r:`f32(${r})`}function fe(e,t,n){return t.kind===`const`?pe(t,n):me(e,t,n)}function pe(e,t){let n=e.tupleSize===1?0:t;if(n>=4)throw Error(`apply codegen: constant slot ${e.slot} has no component ${n} (a uniform slot holds 4 f32 components)`);return`params.consts[${e.slot}].${de[n]}`}function me(e,t,n){return t.tupleSize===1?`${e}[i]`:n===0?`${e}[i * ${t.tupleSize}u]`:`${e}[i * ${t.tupleSize}u + ${n}u]`}function he(e,t,n){return t===1?`${e}[i]`:n===0?`${e}[i * ${t}u]`:`${e}[i * ${t}u + ${n}u]`}var F=class{items=[];add(e,t,n,r){return this.items.push({role:e,access:t,elem:n,comment:r}),`b${this.items.length}`}};function ge(e){let t=0;for(let n of e)if(n.kind===`const`){if(n.slot<0||n.slot>=4)throw Error(`apply codegen: constant slot ${n.slot} is out of range; an apply kernel carries at most 4 uniform constant slots (raise MAX_APPLY_CONST_SLOTS in applyKernels.ts if a new node kind needs more)`);t=Math.max(t,n.slot+1)}return t}function I(e,t,n,r,i,a=!1){let o=[`@group(0) @binding(0) var<uniform> params: PcgParams;`],s=[];n.forEach((e,t)=>{let n=t+1,r=e.access===`read`?`read`:`read_write`;o.push(`@group(0) @binding(${n}) var<storage, ${r}> b${n}: array<${e.elem}>; // ${e.comment}`),s.push({binding:n,role:e.role,access:e.access})});let c=a?`
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
`,entryPoint:`main`,workgroupSize:64,bindings:s,constSlots:t,uniformBytes:ue(t,a),key:`${le}|${e}`}}var L=e=>e.kind===`column`?`${e.type}x${e.tupleSize}`:`constx${e.tupleSize}@${e.slot}`;function _e(e,t,n){let r=e.kind===`const`?`f32`:e.type,i=t===`f32`&&e.kind===`column`&&e.type===`f32`,a=i?`u32`:r,o=t===`bool`||i?`u32`:t,s=new F,c=e.kind===`column`?s.add(`value`,`read`,a,`value column ${L(e)}`):``,l=e.kind===`column`?{...e,type:a}:e,u=s.add(`target`,`read_write`,o,`target attribute ${t} tupleSize ${n}`),d=(e,n)=>{switch(t){case`f32`:return i?e:n;case`i32`:return r===`f32`?`i32(${e})`:r===`i32`?e:`bitcast<i32>(${e})`;case`u32`:return r===`f32`?`u32(${e})`:r===`u32`?e:`bitcast<u32>(${e})`;default:return`select(0u, 1u, ${e} != ${r===`f32`?`0f`:r===`i32`?`0i`:`0u`})`}},f=[];for(let e=0;e<n;e++){let t=fe(c,l,e);f.push(`  ${he(u,n,e)} = ${d(t,P(c,l,e))};`)}return I(`setAttribute|val=${L(e)}|out=${t}x${n}`,ge([e]),s.items,[],f.join(`
`))}var R={euler:`fn pcg_quat_from_euler_deg(r: vec3<f32>) -> vec4<f32> {
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
}`};function ve(e,t,n,r,i){let a=new F,o=e.kind===`column`?a.add(`translate`,`read`,e.type,`translate column ${L(e)}`):``,s=t.kind===`column`?a.add(`rotateEuler`,`read`,t.type,`rotateEuler column ${L(t)}`):``,c=n.kind===`column`?a.add(`scale`,`read`,n.type,`scale column ${L(n)}`):``,l=a.add(`P`,`read_write`,`f32`,`attribute P: f32 tupleSize 3`),u=r?a.add(`rot`,`read_write`,`f32`,`attribute rot: f32 tupleSize 4`):``,d=i?a.add(`scaleAttr`,`read_write`,`f32`,`attribute scale: f32 tupleSize 3`):``,f=[];return f.push(`  let s = vec3<f32>(${[0,1,2].map(e=>P(c,n,e)).join(`, `)});`),f.push(`  let q = pcg_quat_from_euler_deg(vec3<f32>(${[0,1,2].map(e=>P(s,t,e)).join(`, `)}));`),f.push(`  let v = pcg_rotate_vec(q, vec3<f32>(${l}[i * 3u] * s.x, ${l}[i * 3u + 1u] * s.y, ${l}[i * 3u + 2u] * s.z));`),f.push(`  ${l}[i * 3u] = v.x + ${P(o,e,0)};`),f.push(`  ${l}[i * 3u + 1u] = v.y + ${P(o,e,1)};`),f.push(`  ${l}[i * 3u + 2u] = v.z + ${P(o,e,2)};`),r&&(f.push(`  let q2 = pcg_quat_mul(q, vec4<f32>(${u}[i * 4u], ${u}[i * 4u + 1u], ${u}[i * 4u + 2u], ${u}[i * 4u + 3u]));`),f.push(`  ${u}[i * 4u] = q2.x;`),f.push(`  ${u}[i * 4u + 1u] = q2.y;`),f.push(`  ${u}[i * 4u + 2u] = q2.z;`),f.push(`  ${u}[i * 4u + 3u] = q2.w;`)),i&&(f.push(`  ${d}[i * 3u] = ${d}[i * 3u] * s.x;`),f.push(`  ${d}[i * 3u + 1u] = ${d}[i * 3u + 1u] * s.y;`),f.push(`  ${d}[i * 3u + 2u] = ${d}[i * 3u + 2u] * s.z;`)),I(`transformPoints|t=${L(e)}|r=${L(t)}|s=${L(n)}|rot=${+!!r}|scl=${+!!i}`,ge([e,t,n]),a.items,[R.euler,R.mul,R.rotate],f.join(`
`))}function ye(e,t){let n=new F,r=e.kind===`column`?n.add(`amount`,`read`,e.type,`amount column ${L(e)}`):``,i=t?n.add(`seed`,`read`,`u32`,`attribute seed: u32 tupleSize 1`):``,a=n.add(`P`,`read_write`,`f32`,`attribute P: f32 tupleSize 3`),o=[];o.push(`  let ident = pcg_hash4(bitcast<u32>(${a}[i * 3u]), bitcast<u32>(${a}[i * 3u + 1u]), bitcast<u32>(${a}[i * 3u + 2u]), ${t?`${i}[i]`:`0u`});`);for(let t=0;t<3;t++){let n=t===0?`i * 3u`:`i * 3u + ${t}u`;o.push(`  ${a}[${n}] = ${a}[${n}] + (pcg_hash_float(pcg_hash3(params.seed, ident, ${t}u)) * 2f - 1f) * ${P(r,e,t)};`)}return I(`jitterPoints|a=${L(e)}|s=${+!!t}`,ge([e]),n.items,ce([`pcg_hash3`,`pcg_hash4`,`pcg_hash_float`]),o.join(`
`))}var be={"+x":`f, u, -r`,"-x":`-f, u, r`,"+y":`-r, f, u`,"-y":`r, -f, u`,"+z":`r, u, f`,"-z":`-r, u, -f`};function xe(e,t,n){let r=new F,i=e.kind===`column`?r.add(`direction`,`read`,e.type,`direction column ${L(e)}`):``,a=r.add(`rot`,`read_write`,`f32`,`attribute rot: f32 tupleSize 4`),o=A(1e-12,`internal ORIENT_PARALLEL_EPS`),s=`  let d = vec3<f32>(${[0,1,2].map(t=>P(i,e,t)).join(`, `)});
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
  let q = pcg_quat_from_basis(${be[t]});
  ${a}[i * 4u] = q.x;
  ${a}[i * 4u + 1u] = q.y;
  ${a}[i * 4u + 2u] = q.z;
  ${a}[i * 4u + 3u] = q.w;`;return I(`orientAlongVector|d=${L(e)}|axis=${t}|up=${L(n)}`,ge([e,n]),r.items,[R.basis],s)}function Se(e,t,n=!1,r=0){let i=r>0;if(i&&r<3)throw Error(`apply codegen: spawnInstances colour source has tupleSize ${r}; components 0-2 are read as RGB, so it must be at least 3 (the planner rejects narrower columns before reaching codegen)`);let a=new F,o=a.add(`P`,`read`,`f32`,`attribute P: f32 tupleSize 3`),s=e?a.add(`rot`,`read`,`f32`,`attribute rot: f32 tupleSize 4`):``,c=t?a.add(`scaleAttr`,`read`,`f32`,`attribute scale: f32 tupleSize 3`):``,l=a.add(`transforms`,`read_write`,`f32`,`out: 16 f32 per instance`),u=n?a.add(`perm`,`read`,`u32`,`grouping permutation: source point index per slot`):``,d=i?a.add(`color`,`read`,`f32`,`colour source: f32 tupleSize ${r}`):``,f=i?a.add(`colors`,`read_write`,`f32`,`out: 4 f32 per instance (vec3 storage stride, [3] = 0 pad)`):``,p=n?`src`:`i`,m=e?`vec4<f32>(${s}[${p} * 4u], ${s}[${p} * 4u + 1u], ${s}[${p} * 4u + 2u], ${s}[${p} * 4u + 3u])`:`vec4<f32>(0f, 0f, 0f, 1f)`,h=t?`vec3<f32>(${c}[${p} * 3u], ${c}[${p} * 3u + 1u], ${c}[${p} * 3u + 2u])`:`vec3<f32>(1f, 1f, 1f)`,g=`${n?`  let src = ${u}[params.base + i];\n`:``}  let q = ${m};
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
  ${f}[co + 3u] = 0f;`:``}`;return I(`spawnInstances|rot=${+!!e}|scl=${+!!t}${n?`|perm`:``}${i?`|color=${r}`:``}`,0,a.items,[],g,n)}var Ce=64,we=`wgsl2`,Te=[`x`,`y`,`z`,`w`];function z(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}function Ee(e,t,n){return new k(`${e}: ${t} has tupleSize ${n}, but GPU kernels support tuple sizes 1 to 4; evaluate this field on the CPU instead, or split it into components`)}function B(e,t,n){let r=1;for(let i of n)if(i!==1){if(r!==1&&r!==i)throw new k(`${t}: ${e}: incompatible tuple sizes ${r} and ${i}`);r=i}return r}var De=class{layout;params;lines=[];libRoots=new Set;usesSeed=!1;valueNumbers=new Map;bindings=new Map;helpers=new Map;helperTexts=[];helperCounters=new Map;varCounter=0;constructor(e,t,n){this.layout=e,this.params=n,t.forEach((t,n)=>{this.bindings.set(t,{name:t,varName:`in${n}`,binding:n+1,attr:e.attributes[t]})})}paramSlot(e){let t=this.params.slots.get(e);if(t===void 0)throw Error(`internal: param ${JSON.stringify(e)} was not pre-planned`);return{slot:t,arity:this.params.arities[t]}}attrIsSlot(e,t){let n=this.params.attrIsSlots.get(X(e,t));if(n===void 0)throw Error(`internal: attributeIs ${X(e,t)} was not pre-planned`);return n}emit(e,t){let n=this.valueNumbers.get(e);if(n)return n;let r={ref:`v${this.varCounter++}`,size:t};return this.lines.push(`  let ${r.ref} = ${e};`),this.valueNumbers.set(e,r),r}binding(e){let t=this.bindings.get(e);if(!t)throw Error(`internal: attribute ${JSON.stringify(e)} was not pre-bound`);return t}boundAttrs(){return[...this.bindings.values()]}helper(e,t){let n=this.helpers.get(t);if(n)return n;let r=this.helperCounters.get(e)??0;this.helperCounters.set(e,r+1);let i=`pcg_${e}_${r}`;return this.helpers.set(t,i),this.helperTexts.push(t.replaceAll(`@NAME@`,i)),i}helperBlocks(){return this.helperTexts}};function V(e,t){return e.size===t?e.ref:`vec${t}<f32>(${e.ref})`}function H(e){return e===1?`0f`:`vec${e}<f32>(0f)`}function U(e){return e===1?`1f`:`vec${e}<f32>(1f)`}function Oe(e,t){return e===1?t:`vec${e}<f32>(${t})`}function ke(e){let t=Object.keys(e.attributes).sort();return t.length===0?`the layout declares no attributes`:`layout attributes: ${t.map(e=>JSON.stringify(e)).join(`, `)}`}function Ae(e,t,n,r,i){let a=e.layout.attributes;if(!Object.hasOwn(a,n))throw new k(`${t}: ${i}attribute ${JSON.stringify(n)} is not in the kernel layout; ${ke(e.layout)}`);let o=a[n];if(o.type===`string`)throw new k(`${t}: ${i}attribute ${JSON.stringify(n)} has type "string"; a string column has no numeric value to read — test it with { fn: "attributeIs", name: ${JSON.stringify(n)}, value: "..." }, which is 1 where it matches and 0 elsewhere, or select on it with { fn: "byAttribute", name: ${JSON.stringify(n)}, cases: {...}, default: ... }, or read a numeric or bool attribute`);if(r!==void 0&&o.tupleSize!==r)throw new k(`${t}: ${i}attribute ${JSON.stringify(n)}: expected tupleSize ${r}, got ${o.tupleSize} in the kernel layout`);if(o.tupleSize>4)throw Ee(t,`${i}attribute ${JSON.stringify(n)}`,o.tupleSize);return o}function je(e,t,n,r,i){let a=Ae(e,t,n,r,i),o=e.binding(n),s=a.tupleSize,c=e=>a.type===`f32`?e:`f32(${e})`;if(s===1)return e.emit(c(`${o.varName}[i]`),1);let l=[];for(let e=0;e<s;e++)l.push(c(`${o.varName}[${W(s,e)}]`));return e.emit(`vec${s}<f32>(${l.join(`, `)})`,s)}function W(e,t){return e===1?`i`:t===0?`i * ${e}u`:`i * ${e}u + ${t}u`}var G=new Map;function Me(){return[...G.keys()].sort()}function Ne(e,t,n){let r=String(e.fn),i=G.get(r);if(!i)throw new k(`${t}: field fn "${r}" is not supported by the WGSL compiler; supported fns: ${Me().join(`, `)}`);return i(e,t,n)}function K(e,t,n){return typeof e==`number`?n.emit(A(e,t),1):Array.isArray(e)?Pe(e,t,n):Ne(e,t,n)}function Pe(e,t,n){let r=e.length;if(r>4)throw Ee(t,`constant`,r);if(r===1)return n.emit(A(e[0],t),1);let i=e.map(e=>A(e,t));return n.emit(`vec${r}<f32>(${i.join(`, `)})`,r)}function q(e){return e.args}G.set(`constant`,(e,t,n)=>{let r=e.value;return typeof r==`number`?n.emit(A(r,`${t}.value`),1):Pe(r,`${t}.value`,n)}),G.set(`attribute`,(e,t,n)=>{let r=e.name,i=e.tupleSize;return je(n,t,r,i,``)});function Fe(e,t,n,r,i){let a=e.layout.attributes;if(!Object.hasOwn(a,n))throw new k(`${t}: ${r}: attribute ${JSON.stringify(n)} is not in the kernel layout; ${ke(e.layout)}`);let o=a[n];if(o.type!==`string`)throw new k(`${t}: ${r}: attribute ${JSON.stringify(n)} has type ${JSON.stringify(o.type)}, but ${r} ${i} a string attribute; compare a numeric attribute with { fn: "eq", args: [{ fn: "attribute", name: ${JSON.stringify(n)} }, <number>] }`);return o}G.set(`attributeIs`,(e,t,n)=>{let r=e.name,i=e.value,a=Fe(n,t,r,`attributeIs`,`tests`),o=n.binding(r),s=n.attrIsSlot(r,i);return n.emit(`select(0f, 1f, f32(${o.varName}[${W(a.tupleSize,0)}]) == params.consts[${s}].x)`,1)}),G.set(`byAttribute`,(e,t,n)=>{let r=e.name,i=e.cases,a=Fe(n,t,r,`byAttribute`,`selects on`),o=n.binding(r),s=Object.keys(i).sort(),c=s.map(e=>K(i[e],`${t}.cases[${JSON.stringify(e)}]`,n)),l=K(e.default,`${t}.default`,n),u=B(`byAttribute`,t,[...c.map(e=>e.size),l.size]),d=n.emit(`f32(${o.varName}[${W(a.tupleSize,0)}])`,1),f=V(l,u);return s.forEach((e,t)=>{let i=n.attrIsSlot(r,e);f=`select(${f}, ${V(c[t],u)}, ${d.ref} == params.consts[${i}].x)`}),n.emit(f,u)}),G.set(`position`,(e,t,n)=>je(n,t,`P`,3,`position reads `)),G.set(`param`,(e,t,n)=>{let r=e.name,i=s(e);if(i!==void 0)return Ne(i,`${t}<${r}>`,n);let{slot:a,arity:o}=n.paramSlot(r),c=e=>`params.consts[${a}].${Te[e]}`;return o===1?n.emit(c(0),1):n.emit(`vec${o}<f32>(${Array.from({length:o},(e,t)=>c(t)).join(`, `)})`,o)}),G.set(`index`,(e,t,n)=>n.emit(`f32(i)`,1)),G.set(`fraction`,(e,t,n)=>n.emit(`f32(i) / f32(max(params.count, 2u) - 1u)`,1)),G.set(`nodeSeed`,(e,t,n)=>(n.usesSeed=!0,n.emit(`f32(params.seed >> 8u) * 256.0 + f32(params.seed & 0xFFu)`,1))),G.set(`randomField`,(e,t,n)=>{let r=e.key,i=typeof r==`string`?y(r):(r??0)>>>0;n.usesSeed=!0,n.libRoots.add(`pcg_hash3`),n.libRoots.add(`pcg_hash4`),n.libRoots.add(`pcg_hash_float`);let a=`randomField's per-point identity reads `,o=Ae(n,t,`P`,void 0,a);if(o.tupleSize<3)throw new k(`${t}: ${a}attribute "P" with x, y and z (tupleSize 3), got tupleSize ${o.tupleSize}`);let s=n.binding(`P`).varName,c=e=>{let t=`${s}[${W(o.tupleSize,e)}]`;return o.type===`f32`?`bitcast<u32>(${t})`:`bitcast<u32>(f32(${t}))`},l=`0u`,u=Object.hasOwn(n.layout.attributes,`seed`)?n.layout.attributes.seed:void 0;if(u!==void 0){if(u.tupleSize!==1||u.type!==`u32`&&u.type!==`i32`)throw new k(`${t}: ${a}the standard point attribute "seed" as a u32 or i32 scalar, but the layout has it as ${u.type}x${u.tupleSize}; this field resolves on the CPU instead`);let e=n.binding(`seed`).varName;l=u.type===`u32`?`${e}[i]`:`bitcast<u32>(${e}[i])`}let d=`pcg_hash4(${c(0)}, ${c(1)}, ${c(2)}, ${l})`;return n.emit(`pcg_hash_float(pcg_hash3(params.seed, ${j(i)}, ${d}))`,1)});function J(e,t,n){G.set(e,(r,i,a)=>{let o=q(r),s=[];for(let e=0;e<t;e++)s.push(K(o[e],`${i}.args[${e}]`,a));let c=B(e,i,s.map(e=>e.size)),l=s.map(e=>V(e,c));return a.emit(n(l,c),c)})}J(`add`,2,e=>`${e[0]} + ${e[1]}`),J(`sub`,2,e=>`${e[0]} - ${e[1]}`),J(`mul`,2,e=>`${e[0]} * ${e[1]}`),J(`div`,2,e=>`${e[0]} / ${e[1]}`),J(`min`,2,e=>`min(${e[0]}, ${e[1]})`),J(`max`,2,e=>`max(${e[0]}, ${e[1]})`),J(`abs`,1,e=>`abs(${e[0]})`),J(`floor`,1,e=>`floor(${e[0]})`),J(`fract`,1,e=>`${e[0]} - floor(${e[0]})`),J(`mod`,2,e=>`${e[0]} - ${e[1]} * floor(${e[0]} / ${e[1]})`),J(`sign`,1,(e,t)=>`select(${H(t)}, ${U(t)}, ${e[0]} > ${H(t)}) - select(${H(t)}, ${U(t)}, ${e[0]} < ${H(t)})`),J(`sin`,1,e=>`sin(${e[0]})`),J(`cos`,1,e=>`cos(${e[0]})`),J(`tan`,1,e=>`tan(${e[0]})`),J(`asin`,1,e=>`asin(${e[0]})`),J(`acos`,1,e=>`acos(${e[0]})`),J(`atan`,1,e=>`atan(${e[0]})`),J(`atan2`,2,e=>`atan2(${e[0]}, ${e[1]})`),J(`sqrt`,1,e=>`sqrt(${e[0]})`),J(`pow`,2,e=>`pow(${e[0]}, ${e[1]})`),J(`exp`,1,e=>`exp(${e[0]})`),J(`log`,1,e=>`log(${e[0]})`),J(`clamp`,3,e=>`clamp(${e[0]}, ${e[1]}, ${e[2]})`),J(`lerp`,3,e=>`${e[0]} + (${e[1]} - ${e[0]}) * ${e[2]}`),J(`select`,3,(e,t)=>`select(${e[2]}, ${e[1]}, ${e[0]} != ${H(t)})`),J(`lt`,2,(e,t)=>`select(${H(t)}, ${U(t)}, ${e[0]} < ${e[1]})`),J(`le`,2,(e,t)=>`select(${H(t)}, ${U(t)}, ${e[0]} <= ${e[1]})`),J(`gt`,2,(e,t)=>`select(${H(t)}, ${U(t)}, ${e[0]} > ${e[1]})`),J(`ge`,2,(e,t)=>`select(${H(t)}, ${U(t)}, ${e[0]} >= ${e[1]})`),J(`eq`,2,(e,t)=>`select(${H(t)}, ${U(t)}, ${e[0]} == ${e[1]})`),J(`ne`,2,(e,t)=>`select(${H(t)}, ${U(t)}, ${e[0]} != ${e[1]})`),J(`step`,2,(e,t)=>`select(${H(t)}, ${U(t)}, ${e[1]} >= ${e[0]})`),G.set(`remap`,(e,t,n)=>{let r=q(e).map((e,r)=>K(e,`${t}.args[${r}]`,n)),i=B(`remap`,t,r.map(e=>e.size)),[a,o,s,c,l]=r.map(e=>V(e,i)),u=n.emit(`${s} - ${o}`,i),d=H(i),f=n.emit(`select(${u.ref}, ${U(i)}, ${u.ref} == ${d})`,i);return n.emit(`select(${c} + ((${a} - ${o}) / ${f.ref}) * (${l} - ${c}), ${c}, ${u.ref} == ${d})`,i)}),G.set(`dot`,(e,t,n)=>{let r=q(e),i=K(r[0],`${t}.args[0]`,n),a=K(r[1],`${t}.args[1]`,n),o=B(`dot`,t,[i.size,a.size]);return o===1?n.emit(`${i.ref} * ${a.ref}`,1):n.emit(`dot(${V(i,o)}, ${V(a,o)})`,1)}),G.set(`cross`,(e,t,n)=>{let r=q(e),i=K(r[0],`${t}.args[0]`,n),a=K(r[1],`${t}.args[1]`,n);for(let[e,n]of[[`a`,i],[`b`,a]])if(n.size!==3)throw new k(`${t}: cross: argument \`${e}\` has width ${n.size}, but a cross product is defined for width 3 only. Scalars do NOT broadcast into one here — build a vec3 with \`vec(x, y, z)\`, or use \`dot\` for a product that works at any width.`);return n.emit(`cross(${i.ref}, ${a.ref})`,3)}),G.set(`smoothstep`,(e,t,n)=>{let r=q(e).map((e,r)=>K(e,`${t}.args[${r}]`,n)),i=B(`smoothstep`,t,r.map(e=>e.size)),[a,o,s]=r.map(e=>V(e,i)),c=H(i),l=U(i),u=n.emit(`select(${c}, ${l}, ${a} == ${o})`,i),d=n.emit(`${o} - ${a}`,i),f=n.emit(`select(${d.ref}, ${l}, ${u.ref} != ${c})`,i),p=n.emit(`clamp((${s} - ${a}) / ${f.ref}, ${c}, ${l})`,i),m=n.emit(`(${p.ref} * ${p.ref}) * (${Oe(i,`3f`)} - ${Oe(i,`2f`)} * ${p.ref})`,i);return n.emit(`select(${m.ref}, select(${c}, ${l}, ${s} >= ${a}), ${u.ref} != ${c})`,i)}),G.set(`distance`,(e,t,n)=>{let r=q(e),i=K(r[0],`${t}.args[0]`,n),a=K(r[1],`${t}.args[1]`,n),o=B(`distance`,t,[i.size,a.size]),s=n.emit(`${V(i,o)} - ${V(a,o)}`,o);if(o===1)return n.emit(`abs(${s.ref})`,1);let c=n.emit(`dot(${s.ref}, ${s.ref})`,1);return n.emit(`sqrt(${c.ref})`,1)}),G.set(`length`,(e,t,n)=>{let r=K(q(e)[0],`${t}.args[0]`,n);if(r.size===1)return n.emit(`abs(${r.ref})`,1);let i=n.emit(`dot(${r.ref}, ${r.ref})`,1);return n.emit(`sqrt(${i.ref})`,1)}),G.set(`normalize`,(e,t,n)=>{let r=K(q(e)[0],`${t}.args[0]`,n),i=r.size===1?n.emit(`${r.ref} * ${r.ref}`,1):n.emit(`dot(${r.ref}, ${r.ref})`,1),a=n.emit(`select(0f, 1f / sqrt(${i.ref}), ${i.ref} > 0f)`,1);return n.emit(`${r.ref} * ${a.ref}`,r.size)}),G.set(`vec`,(e,t,n)=>{let r=q(e).map((e,r)=>K(e,`${t}.args[${r}]`,n)),i=r.reduce((e,t)=>e+t.size,0);if(i>4)throw Ee(t,`vec result`,i);return r.length===1?r[0]:n.emit(`vec${i}<f32>(${r.map(e=>e.ref).join(`, `)})`,i)}),G.set(`component`,(e,t,n)=>{let r=K(q(e)[0],`${t}.args[0]`,n),i=e.index;if(i>=r.size)throw new k(`${t}: component: index ${i} out of range for tupleSize ${r.size}`);return r.size===1?r:n.emit(`${r.ref}.${Te[i]}`,1)}),G.set(`ramp`,(e,t,n)=>{let r=K(q(e)[0],`${t}.args[0]`,n);if(r.size!==1)throw new k(`${t}: ramp: input must be scalar, got tupleSize ${r.size}`);let i=e.stops,a=n.helper(`ramp`,Ie(i,`${t}.stops`));return n.emit(`${a}(${r.ref})`,1)});function Ie(e,t){let n=e=>A(e,t),r=e.length-1,i=[];i.push(`fn @NAME@(t: f32) -> f32 {`),i.push(`  if (t <= ${n(e[0][0])}) {`),i.push(`    return ${n(e[0][1])};`),i.push(`  }`),i.push(`  if (t >= ${n(e[r][0])}) {`),i.push(`    return ${n(e[r][1])};`),i.push(`  }`);let a=t=>{let r=e[t-1][0],i=e[t-1][1],a=e[t][0]-r,o=e[t][1]-i;return`${n(i)} + ${n(o)} * ((t - ${n(r)}) / ${n(a)})`};for(let t=1;t<r;t++)i.push(`  if (t <= ${n(e[t][0])}) {`),i.push(`    return ${a(t)};`),i.push(`  }`);return r>=1?i.push(`  return ${a(r)};`):i.push(`  return t;`),i.push(`}`),i.join(`
`)}var Le={valueNoise:o,perlinNoise:x,simplexNoise:g,worleyNoise:c},Re={valueNoise:`pcg_value_noise`,perlinNoise:`pcg_perlin_noise`,simplexNoise:`pcg_simplex_noise`};function ze(e){return e.opts??{}}function Be(e,t,n,r){let i=ze(t),a=i.position===void 0?n:`${n}.opts.position`,o=i.position===void 0?je(r,n,`P`,3,`${e} position reads `):K(i.position,a,r);if(o.size!==3)throw new k(`${a}: ${e}: position field must have tupleSize 3, got ${o.size}`);let s=A(i.frequency??1,`${n}.opts.frequency`),[c,l,u]=i.offset??[0,0,0],d=`vec3<f32>(${A(c,`${n}.opts.offset`)}, ${A(l,`${n}.opts.offset`)}, ${A(u,`${n}.opts.offset`)})`;return r.emit(`${o.ref} * ${s} + ${d}`,3)}function Ve(e){return e.libRoots.add(`pcg_hash_mix`),e.libRoots.add(`pcg_hash_finalize`),e.helper(`hash2`,`fn @NAME@(a: u32, b: u32) -> u32 {
  return pcg_hash_finalize(pcg_hash_mix(pcg_hash_mix(${j(m(2))}, a), b));
}`)}function He(e){return typeof e==`object`&&!!e}function Ue(e,t,n){if(e===void 0)return`0u`;if(typeof e==`number`)return re(e);let r=e.name;if(typeof r!=`string`||r===``)throw new k(`${t}.opts.seed.variant: param requires a non-empty string name`);if(s(e)!==void 0)throw new k(`${t}.opts.seed.variant: param ${JSON.stringify(r)} is bound to a Field, and a seed is resolved in u32 integer math with no per-element form; bind an integer, or evaluate this field on the CPU`);let{slot:i}=n.paramSlot(r);return`u32(params.consts[${i}].x)`}function We(e,t,n){return He(e)?(n.usesSeed=!0,{expr:`${Ve(n)}(params.seed, ${Ue(e.variant,t,n)})`}):{literal:(e??0)>>>0}}function Ge(e,t,n){let r=Le[e];return`literal`in t?j(O(r,t.literal)):`${Ve(n)}(${j(r)}, ${t.expr})`}function Ke(e,t,n,r){let[i,a]=n,o=a-i;return e.emit(`(${t.ref} - ${A(i,r)}) / ${A(o,r)}`,1)}for(let e of[`valueNoise`,`perlinNoise`,`simplexNoise`])G.set(e,(t,n,r)=>{let i=ze(t),a=Ge(e,We(i.seed,n,r),r),o=Be(e,t,n,r);r.libRoots.add(Re[e]);let s=r.emit(`${Re[e]}(${a}, ${o.ref})`,1);return i.normalized===!0?Ke(r,s,C[e],`${n}.opts.normalized`):s});G.set(`worleyNoise`,(e,t,n)=>{let r=ze(e),i=r.output??`f1`,a=r.exact===!0,o=Ge(`worleyNoise`,We(r.seed,t,n),n),s=Be(`worleyNoise`,e,t,n);n.libRoots.add(`pcg_worley`);let c=i!==`f1`,l=n.emit(`pcg_worley(${o}, ${s.ref}, ${a}, ${c})`,2),u=i===`f1`?n.emit(`${l.ref}.x`,1):i===`f2`?n.emit(`${l.ref}.y`,1):n.emit(`${l.ref}.y - ${l.ref}.x`,1);return r.normalized===!0?Ke(n,u,C.worleyNoise[i],`${t}.opts.normalized`):u});function qe(e){return e===`worleyNoise`?C.worleyNoise.f1:C[e]}function Je(e,t,n){return e===`worleyNoise`?`pcg_worley(${t}, ${n}, false, false).x`:`${Re[e]}(${t}, ${n})`}G.set(`fbm`,(e,t,n)=>{let r=e.base,i=ze(e),a=i.octaves??4,o=i.lacunarity??2,s=i.gain??.5,c=i.frequency??1,[l,u,d]=i.offset??[0,0,0],f=We(i.seed,t,n),p=i.position===void 0?t:`${t}.opts.position`,m=i.position===void 0?je(n,t,`P`,3,`fbm position reads `):K(i.position,p,n);if(m.size!==3)throw new k(`${p}: fbm: position field must have tupleSize 3, got ${m.size}`);let h=qe(r),g=[],_=[],v=[],y=1,b=c,x=0,S=0;for(let e=0;e<a;e++)g.push(Ge(r,`literal`in f?{literal:D(f.literal,e)}:{expr:`${Ve(n)}(ns, ${re(e)})`},n)),_.push(A(b,`${t}.opts.frequency`)),v.push(A(y,`${t}.opts.gain`)),x+=y>=0?y*h[0]:y*h[1],S+=y>=0?y*h[1]:y*h[0],y*=s,b*=o;n.libRoots.add(r===`worleyNoise`?`pcg_worley`:Re[r]);let C=`vec3<f32>(${A(l,`${t}.opts.offset`)}, ${A(u,`${t}.opts.offset`)}, ${A(d,`${t}.opts.offset`)})`,w=`fn @NAME@(p: vec3<f32>) -> f32 {
${`literal`in f?``:`  let ns = ${f.expr};\n`}  var seeds = array<u32, ${a}>(${g.join(`, `)});
  var freqs = array<f32, ${a}>(${_.join(`, `)});
  var amps = array<f32, ${a}>(${v.join(`, `)});
  var sum = 0f;
  for (var o = 0u; o < ${re(a)}; o++) {
    sum = sum + ${Je(r,`seeds[o]`,`p * freqs[o] + `+C)} * amps[o];
  }
  return sum;
}`,T=n.helper(`fbm`,w),E=n.emit(`${T}(${m.ref})`,1);if(i.normalized!==!0)return E;if(!(S>x))throw new k(`${t}: fbm: normalized: true needs a non-degenerate output range, got [${x}, ${S}] for this octaves/gain configuration`);return Ke(n,E,[x,S],`${t}.opts.normalized`)});var Ye=new Set([`valueNoise`,`perlinNoise`,`simplexNoise`,`worleyNoise`,`fbm`]);function Y(e,n){if(!z(e))return;let r=e.fn;if(r===`param`){let t=s(e);t!==void 0&&Y(t,n);return}if(r===`attribute`||r===`attributeIs`){typeof e.name==`string`&&n.add(e.name);return}if(r===`byAttribute`){typeof e.name==`string`&&n.add(e.name);for(let r of t(e))Y(r,n);return}if(r===`position`){n.add(`P`);return}if(r===`randomField`){n.add(`P`),n.add(`seed`);return}if(typeof r==`string`&&Ye.has(r)){let t=e.opts;z(t)&&t.position!==void 0?Y(t.position,n):n.add(`P`);return}let i=e.args;if(Array.isArray(i))for(let e of i)Y(e,n)}var Xe=16;function X(e,t){return`${JSON.stringify(e)},${JSON.stringify(t)}`}var Ze={names:[],slots:new Map,arities:[],attrIs:[],attrIsSlots:new Map};function Qe(e){return typeof e==`number`?1:e.length}function $e(e,n){if(z(e)){if(n(e),e.fn===`param`){let t=s(e);t!==void 0&&$e(t,n);return}for(let r of t(e))$e(r,n)}}function et(e){let t=nt.get(e);if(t!==void 0)return t;let n=rt.get(e);if(n!==void 0)throw n;try{let t=tt(e);return nt.set(e,t),t}catch(t){throw t instanceof k&&rt.set(e,t),t}}function tt(e){let t=new Map,n=new Set,r=new Map;if($e(e,e=>{if(e.fn===`attributeIs`){if(typeof e.name!=`string`||e.name===``||typeof e.value!=`string`)return;r.set(X(e.name,e.value),{attr:e.name,value:e.value});return}if(e.fn===`byAttribute`){if(typeof e.name!=`string`||e.name===``||!z(e.cases))return;for(let t of Object.keys(e.cases))r.set(X(e.name,t),{attr:e.name,value:t});return}if(e.fn!==`param`||typeof e.name!=`string`||e.name===``)return;let i=e.name;if(s(e)!==void 0)return;if(l(e))throw new k(`param ${JSON.stringify(i)} is bound to a Field that carries no spec (a makeField closure, or something composed over one), so there is nothing to compile in its place; this expression evaluates on the CPU — build the bound field with the grammar constructors or fieldFromJson if it should lower`);n.add(i);let a=d(e);if(a===void 0)return;let o=Qe(a);if(o>4)throw new k(`param ${JSON.stringify(i)} is bound to a ${o}-tuple, but a uniform slot holds 4 components; bind a tuple of 1 to 4, or evaluate this field on the CPU`);let c=t.get(i);if(c!==void 0&&c!==o)throw new k(`param ${JSON.stringify(i)} is bound to a ${c}-tuple in one place and a ${o}-tuple in another within the same expression; one uniform slot serves the name, so both references must have the same arity`);t.set(i,o)}),n.size===0&&r.size===0)return Ze;let i=[...n].sort(),a=[...r.keys()].sort(),o=i.length+a.length;if(o>Xe)throw new k(`this field needs ${o} uniform constant slots (${i.length} distinct params and ${a.length} distinct string literals across its attributeIs tests and byAttribute case keys), but a kernel carries at most ${Xe}; split the expression, or evaluate it on the CPU (raise MAX_FIELD_CONST_SLOTS in compile.ts if an expression legitimately needs more)`);return{names:i,slots:new Map(i.map((e,t)=>[e,t])),arities:i.map(e=>t.get(e)??1),attrIs:a.map(e=>r.get(e)),attrIsSlots:new Map(a.map((e,t)=>[e,i.length+t]))}}var nt=new WeakMap,rt=new WeakMap,it=new WeakMap;function at(e){let t=``;return e.names.length>0&&(t+=`|params=[${e.names.map((t,n)=>`${JSON.stringify(t)}:${e.arities[n]}`).join(`,`)}]`),e.attrIs.length>0&&(t+=`|attrIs=[${e.attrIs.map(e=>X(e.attr,e.value)).join(`;`)}]`),t}function ot(e,t){let n=et(e);if(n.names.length===0&&n.attrIs.length===0)return t;let r=it.get(e);if(r!==void 0)return r;let a=`${i(e).key}${at(n)}`;return it.set(e,a),a}function st(e,t){return e.length===t.length&&e.every((e,n)=>Object.is(e,t[n]))}function ct(e,t){return t.constSlots===0?{values:[]}:t.attrIsSlots.length>0?{problem:`this kernel carries ${t.attrIsSlots.length} string-literal slot(s) (${t.attrIsSlots.map(e=>`${JSON.stringify(e.attr)} == ${JSON.stringify(e.value)}`).join(`, `)}) whose values are string-table indices of the geometry being cooked; fill them with constSlotValues, which takes that geometry's attribute set`}:lt(e,t)}function lt(e,t){let n=new Map,r;if($e(e,e=>{if(e.fn!==`param`||typeof e.name!=`string`||e.name===``)return;let t=e.name;if(s(e)!==void 0)return;let i=d(e);if(i===void 0){r??=`param ${JSON.stringify(t)} has no bound value`;return}let a=typeof i==`number`?[i]:[...i],o=n.get(t);o===void 0?n.set(t,a):st(o,a)||(r??=`param ${JSON.stringify(t)} is bound to two different values in one expression`)}),r!==void 0)return{problem:r};let i=[];for(let e of t.paramNames){let t=n.get(e);if(t===void 0)return{problem:`param ${JSON.stringify(e)} is not referenced by this spec`};for(let e=0;e<4;e++)i.push(e<t.length?t[e]:0)}return{values:i}}var ut=-1;function dt(e,t,n){if(t.constSlots===0)return{values:[]};let r=lt(e,t);if(`problem`in r||t.attrIsSlots.length===0)return r;let i=[...r.values];for(let e of t.attrIsSlots){let t=n.get(e.attr);if(t===void 0||t.type!==`string`)return{problem:`attributeIs ${JSON.stringify(e.attr)}: this geometry has no string attribute of that name (${t===void 0?`no such attribute`:`it is ${t.type}`}), so the literal has no index to resolve to`};let r=t.lookupString(e.value)??ut;for(let e=0;e<4;e++)i.push(e===0?r:0)}return{values:i}}var ft=new Set([`f32`,`i32`,`u32`,`bool`,`string`]);function pt(e){if(!z(e)||!z(e.attributes))throw new k(`compileFieldSpec: layout must be { attributes: { name: { type, tupleSize } } }`);for(let[t,n]of Object.entries(e.attributes)){if(!z(n)||!ft.has(n.type))throw new k(`kernel layout attribute ${JSON.stringify(t)}: unknown type ${JSON.stringify(n?.type)}; valid types: "f32", "i32", "u32", "bool", "string" (a string column binds as u32 and is readable only through attributeIs)`);let e=n.tupleSize;if(typeof e!=`number`||!Number.isInteger(e)||e<1)throw new k(`kernel layout attribute ${JSON.stringify(t)}: tupleSize must be a positive integer, got ${String(e)}`)}}function mt(e){return typeof e==`number`?{fn:`constant`,value:e}:Array.isArray(e)?{fn:`constant`,value:[...e]}:e}function ht(e){return e.type===`bool`||e.type===`string`?`u32`:e.type}function gt(e,t){pt(t);let n=mt(e),r=i(n),a=new Set;Y(n,a);let o=[...a].filter(e=>Object.hasOwn(t.attributes,e)).sort(),s=et(n),c=new De(t,o,s),l=`f32`,u=0,d=[],f=e=>{if(u=e.size,e.size===1)d.push(`  outBuf[i] = ${e.ref};`);else for(let t=0;t<e.size;t++)d.push(`  outBuf[${W(e.size,t)}] = ${e.ref}.${Te[t]};`)},p=n.fn===`attribute`?n.name:n.fn===`position`?`P`:void 0;if(n.fn===`index`)l=`u32`,u=1,d.push(`  outBuf[i] = i;`);else if(p!==void 0){let e=Ae(c,`$`,p,n.fn===`position`?3:n.tupleSize,n.fn===`position`?`position reads `:``);if(e.type===`i32`||e.type===`u32`){l=e.type,u=e.tupleSize;let t=c.binding(p);for(let n=0;n<e.tupleSize;n++)d.push(`  outBuf[${W(e.tupleSize,n)}] = ${t.varName}[${W(e.tupleSize,n)}];`)}else f(Ne(n,`$`,c))}else f(Ne(n,`$`,c));let m=c.boundAttrs(),h=m.map(e=>({name:e.name,type:ht(e.attr),tupleSize:e.attr.tupleSize,binding:e.binding})),g=m.length+1,_=[`@group(0) @binding(0) var<uniform> params: PcgParams;`];for(let e of m)_.push(`@group(0) @binding(${e.binding}) var<storage, read> ${e.varName}: array<${ht(e.attr)}>; // attribute ${JSON.stringify(e.name)}: ${e.attr.type} tupleSize ${e.attr.tupleSize}`);_.push(`@group(0) @binding(${g}) var<storage, read_write> outBuf: array<${l}>;`);let v=s.names.length+s.attrIs.length,y=[`// Generated by pcg-ts compileFieldSpec (WGSL field kernel).
// Dispatch: 1D, chunked; each chunk runs ceil(chunkElements / ${Ce}) workgroups of ${Ce}
// with element index i = chunkOffset + gid.x; one invocation per element.

struct PcgParams {
  count: u32,
  seed: u32,
  chunkOffset: u32,${v===0?``:`\n  _pad0: u32,\n  consts: array<vec4<f32>, ${v}>,`}
}

${_.join(`
`)}`,...ce(c.libRoots),...c.helperBlocks(),`@compute @workgroup_size(${Ce})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x + params.chunkOffset;
  if (i >= params.count) {
    return;
  }
${[...c.lines,...d].join(`
`)}
}`],b=m.map(e=>`${JSON.stringify(e.name)}:${e.attr.type}x${e.attr.tupleSize}`).join(`,`),x=`${r.key}${at(s)}`;return it.set(n,x),{wgsl:`${y.join(`

`)}\n`,entryPoint:`main`,workgroupSize:Ce,outTupleSize:u,outType:l,inputs:h,bindings:{uniforms:0,output:g},constSlots:v,paramNames:s.names,attrIsSlots:s.attrIs,uniformBytes:ue(v),usesSeed:c.usesSeed,key:`${we}|spec=${x}|layout=[${b}]`}}var Z={MAP_READ:1,COPY_SRC:4,COPY_DST:8,VERTEX:32,UNIFORM:64,STORAGE:128},_t={READ:1},vt=256;function yt(e){let t=vt;for(;t<e;)t*=2;return t}var bt=class{device;maxPooledBytes;free=new Map;meta=new Map;detachedSet=new WeakSet;idleBytes=0;idleCount=0;created=0;reused=0;destroyed=0;detachedTotal=0;detachedLive=0;detachedLiveBytes=0;constructor(e,t){this.device=e,this.maxPooledBytes=t}acquire(e,t){let n=yt(e),r=`${t}|${n}`,i=this.free.get(r)?.pop();if(i!==void 0)return this.idleBytes-=n,this.idleCount--,this.reused++,i;let a=this.device.createBuffer({size:n,usage:t});return this.meta.set(a,{key:r,bytes:n}),this.created++,a}release(e){let t=this.meta.get(e);if(t===void 0)throw this.detachedSet.has(e)?Error(`BufferPool.release: buffer was detached from this pool, so the pool no longer owns it and cannot reclaim it; destroy it through the DetachedBuffer that detach() returned (or the handle wrapping it) and stop releasing it`):Error(`BufferPool.release: buffer was not acquired from this pool`);if(this.idleBytes+t.bytes>this.maxPooledBytes){this.meta.delete(e),e.destroy(),this.destroyed++;return}let n=this.free.get(t.key);n===void 0&&(n=[],this.free.set(t.key,n)),n.push(e),this.idleBytes+=t.bytes,this.idleCount++}detach(e){let t=this.meta.get(e);if(t===void 0)throw Error(this.detachedSet.has(e)?`BufferPool.detach: buffer was already detached from this pool; ownership can only leave once — reuse the DetachedBuffer the first detach() returned`:`BufferPool.detach: buffer was not acquired from this pool`);this.meta.delete(e),this.detachedSet.add(e),this.detachedTotal++,this.detachedLive++,this.detachedLiveBytes+=t.bytes;let n=!1,r=this;return{buffer:e,bytes:t.bytes,get destroyed(){return n},destroy(){n||(n=!0,r.detachedLive--,r.detachedLiveBytes-=t.bytes,r.destroyed++,e.destroy())}}}get stats(){return{buffersCreated:this.created,buffersReused:this.reused,buffersDestroyed:this.destroyed,pooledBuffers:this.idleCount,pooledBytes:this.idleBytes,buffersDetached:this.detachedTotal,detachedBuffers:this.detachedLive,detachedBytes:this.detachedLiveBytes}}dispose(){for(let e of this.free.values())for(let t of e)this.meta.delete(t),t.destroy(),this.destroyed++;this.free.clear(),this.idleBytes=0,this.idleCount=0}},xt=`webgpu`,St=class{backend=xt;byteLength;detached;label;constructor(e,t,n){this.detached=e,this.byteLength=t,this.label=n}get disposed(){return this.detached.destroyed}get resource(){if(this.detached.destroyed)throw Error(`device transforms handle (${this.label}) was disposed; its GPU buffer is destroyed and cannot be bound. Dispose a handle only after the last frame that reads it, and re-cook to obtain a fresh one (device-resident outputs are never memoized, so every cook produces a new handle)`);return this.detached.buffer}dispose(){this.detached.destroy()}};function Ct(e,t,n){return new St(e,t,n)}var wt=65535;function Tt(e,t){let n=wt*e;return Math.max(e,Math.floor(Math.min(t??n,n)/e)*e)}var Et=16,Dt=`pcg-resident-run/5`;function Ot(e){return e.format===Dt?e:null}var kt={reason:`run-plan-failed`},At=[`+x`,`-x`,`+y`,`-y`,`+z`,`-z`];function jt(e){if(typeof e!=`object`||!e||Array.isArray(e))return!1;let n=e;if(n.fn===`randomField`)return!0;for(let e of t(n))if(jt(e))return!0;return!1}function Mt(e){return Array.isArray(e)&&e.length===3&&e.every(e=>typeof e==`number`&&Number.isFinite(e))}var Q=class extends Error{};function Nt(e,t,n,r,i){let a=[...e].map(([e,t])=>({name:e,slot:t})),o=i||r===null,s=t.reduce((e,t)=>e+t.bytes,0),c=n.reduce((e,t)=>e+t,0),l=o?a.reduce((e,n)=>e+t[n.slot].bytes,0):0;return{writtenList:a,materialize:o,totalBytes:s+c+l+(r?.bytes??0)+(r?.colorBytes??0)+(r?.permBytes??0)}}function Pt(e,t,n,r){let i=t.count,a=new Map(Object.entries(t.attributes)),o=[],s=new Map,c=[],l=new Map,u=[],d=[],f=null,p=()=>Object.fromEntries(a),m=e=>{let t=s.get(e);if(t!==void 0)return t;let n=a.get(e);if(n===void 0||n.type===`string`)throw new Q(e);let r=o.length;return o.push({bytes:i*n.tupleSize*4,init:`attr`,name:e}),s.set(e,r),r},h=(e,t,n)=>{let r=o.length;return o.push({bytes:i*t*4,init:n,name:e}),s.set(e,r),r},g=(e,t,n)=>{let r=a.get(e);if(r===void 0||r.type!==t||r.tupleSize!==n)throw new Q(e)},_=(e,t,n)=>{let r=t.length/4;if(r>=4)throw Error(`resident run: "${n}" needs more than 4 uniform constant slots for its constant params; raise MAX_APPLY_CONST_SLOTS in applyKernels.ts (each slot costs 16 bytes of the per-chunk uniform and nothing else)`);for(let n=0;n<4;n++)t.push(n<e.length?e[n]:0);return{kind:`const`,tupleSize:e.length,slot:r}},v=(e,t,n,a,o,s)=>{let u;if(te(e)){let t=w(e,r);if(t===void 0)throw new Q(`no spec`);if(l.has(`P`)&&jt(t))throw new Q(`identity after P write`);u=t}else if(typeof e==`number`||Array.isArray(e)&&e.every(e=>typeof e==`number`)){let t=typeof e==`number`?[e]:e;if(t.length<1||t.length>4||a!==null&&!a.includes(t.length))throw new Q(`tuple`);for(let e of t)if(!Number.isFinite(Math.fround(e)))throw new Q(`f32 range`);return{param:_(t,o,s),ref:null}}else throw new Q(`bad param value`);let d;try{d=gt(u,{attributes:p()})}catch{throw new Q(`compile`)}if(d.inputs.length+1>8)throw new Q(`buffers`);if(a!==null&&!a.includes(d.outTupleSize))throw new Q(`tuple`);if(d.attrIsSlots.length>0)throw new Q(`attributeIs / byAttribute need a per-dispatch string table`);let f=ct(u,d);if(`problem`in f)throw new Q(`param bindings`);let h=c.length;return c.push(i*d.outTupleSize*4),n.push({key:d.key,wgsl:d.wgsl,entryPoint:d.entryPoint,workgroupSize:d.workgroupSize,seed:t,uniformsBinding:d.bindings.uniforms,uniformBytes:d.uniformBytes,consts:f.values,perBatch:!1,bindings:[...d.inputs.map(e=>({binding:e.binding,ref:{kind:`slot`,index:m(e.name)}})),{binding:d.bindings.output,ref:{kind:`col`,index:h}}]}),{param:{kind:`column`,type:d.outType,tupleSize:d.outTupleSize},ref:{kind:`col`,index:h}}},y=(e,t,n,r,i=!1)=>{if(e.constSlots*4!==r.length)throw Error(`resident run: apply kernel "${e.key}" declares ${e.constSlots} constant slots but the planner allocated ${r.length/4}`);return{key:e.key,wgsl:e.wgsl,entryPoint:e.entryPoint,workgroupSize:e.workgroupSize,seed:t,uniformsBinding:0,uniformBytes:e.uniformBytes,consts:r,perBatch:i,bindings:e.bindings.map(e=>{let t=n[e.role];if(t===void 0)throw new Q(`unmapped role ${e.role}`);return{binding:e.binding,ref:t}})}};try{for(let t of e){let n=t===e[e.length-1],r=[],o=[],s=t.params;switch(t.kind){case`setAttribute`:{let e=s.name,n=s.type,i=s.tupleSize;if(typeof e!=`string`)throw new Q(`name`);if(n!==`f32`&&n!==`i32`&&n!==`u32`&&n!==`bool`)throw new Q(`type`);if(typeof i!=`number`||!Number.isInteger(i)||i<1||i>4)throw new Q(`tupleSize`);let c=typeof s.seed==`number`?s.seed:NaN,d=c===0?t.seed:D(t.seed,c),{param:f,ref:p}=v(s.value,d,r,i===1?[1]:[1,i],o,t.kind),m=h(e,i,`none`);a.set(e,{type:n,tupleSize:i}),l.set(e,m),u.push({op:`replace`,name:e,type:n,tupleSize:i});let g={target:{kind:`slot`,index:m}};p!==null&&(g.value=p),r.push(y(_e(f,n,i),0,g,o));break}case`transformPoints`:{g(`P`,`f32`,3);let e=v(s.translate,t.seed,r,[1,3],o,t.kind),n=v(s.rotateEuler,t.seed,r,[1,3],o,t.kind),i=v(s.scale,t.seed,r,[1,3],o,t.kind),c=a.get(`rot`),u=c!==void 0&&c.type===`f32`&&c.tupleSize===4,d=a.get(`scale`),f=d!==void 0&&d.type===`f32`&&d.tupleSize===3,p=m(`P`);l.set(`P`,p);let h={P:{kind:`slot`,index:p}};if(e.ref!==null&&(h.translate=e.ref),n.ref!==null&&(h.rotateEuler=n.ref),i.ref!==null&&(h.scale=i.ref),u){let e=m(`rot`);l.set(`rot`,e),h.rot={kind:`slot`,index:e}}if(f){let e=m(`scale`);l.set(`scale`,e),h.scaleAttr={kind:`slot`,index:e}}r.push(y(ve(e.param,n.param,i.param,u,f),0,h,o));break}case`jitterPoints`:{if(g(`P`,`f32`,3),l.has(`P`))throw new Q(`identity after P write`);let e=typeof s.seed==`number`?s.seed:NaN,n=D(t.seed,e),i=v(s.amount,n,r,[1,3],o,t.kind),c=a.get(`seed`),u=c!==void 0;if(u&&(c.type!==`u32`||c.tupleSize!==1))throw new Q(`seed attribute shape`);let d=m(`P`);l.set(`P`,d);let f={P:{kind:`slot`,index:d}};i.ref!==null&&(f.amount=i.ref),u&&(f.seed={kind:`slot`,index:m(`seed`)}),r.push(y(ye(i.param,u),n,f,o));break}case`orientAlongVector`:{let e=s.axis;if(!At.includes(e))throw new Q(`axis`);if(!Mt(s.up))throw new Q(`up`);let n=v(s.direction,t.seed,r,[1,3],o,t.kind),i=s.up,c=i[0]*i[0]+i[1]*i[1]+i[2]*i[2],d=c>0?1/Math.sqrt(c):0,f=[i[0]*d,i[1]*d,i[2]*d];for(let e of f)if(!Number.isFinite(Math.fround(e)))throw new Q(`up range`);let p=_(f,o,t.kind),g=a.get(`rot`),b=g!==void 0&&g.type===`f32`&&g.tupleSize===4?m(`rot`):h(`rot`,4,`quat-default`);a.set(`rot`,{type:`f32`,tupleSize:4}),l.set(`rot`,b),u.push({op:`ensure-rot`});let x={rot:{kind:`slot`,index:b}};n.ref!==null&&(x.direction=n.ref),r.push(y(xe(n.param,e,p),0,x,o));break}case`spawnInstances`:{if(!n)throw new Q(`spawnInstances must be the run's last member`);let e=s.assetId;if(typeof e!=`string`||e===``)throw new Q(`assetId`);if(g(`P`,`f32`,3),i>1048576)throw new Q(`${i} instances over MAX_INSTANCES`);let t=s.assetAttr;if(t!==void 0&&typeof t!=`string`)throw new Q(`assetAttr`);let c=t===void 0?``:t;if(c!==``){let e=a.get(c);if(e===void 0)throw new Q(`assetAttr "${c}" not on the point domain`);if(e.type!==`string`)throw new Q(`assetAttr "${c}" is ${e.type}, not string`)}let l=s.colorAttr;if(l!==void 0&&typeof l!=`string`)throw new Q(`colorAttr`);let u=l===void 0?``:l,d=0;if(u!==``){let e=a.get(u);if(e===void 0)throw new Q(`colorAttr "${u}" not on the point domain`);if(e.type!==`f32`||e.tupleSize<3)throw new Q(`colorAttr "${u}" is ${e.type}x${e.tupleSize}`);d=e.tupleSize}let p=a.get(`rot`),h=p!==void 0&&p.type===`f32`&&p.tupleSize===4,_=a.get(`scale`),v=_!==void 0&&_.type===`f32`&&_.tupleSize===3,b={P:{kind:`slot`,index:m(`P`)},transforms:{kind:`out`}};h&&(b.rot={kind:`slot`,index:m(`rot`)}),v&&(b.scaleAttr={kind:`slot`,index:m(`scale`)});let x=c!==``;x&&(b.perm={kind:`perm`}),d>0&&(b.color={kind:`slot`,index:m(u)},b.colors={kind:`colorOut`}),r.push(y(Se(h,v,x,d),0,b,o,x)),f={assetId:e,assetAttr:c,colorAttr:u,colorTupleSize:d,count:i,bytes:i*64,colorBytes:d>0?i*Et:0,permBytes:x?i*4:0};break}default:throw new Q(`unknown kind ${t.kind}`)}d.push({id:t.id,type:t.type,steps:r})}}catch(e){if(e instanceof Q)return kt;throw e}let{writtenList:b,materialize:x,totalBytes:S}=Nt(l,o,c,f,t.needsGeometry);return S>n?{reason:`run-too-large`}:{plan:{format:Dt,count:i,members:d,slots:o,cols:c,written:b,layoutOps:u,materialize:x,instances:f,totalBytes:S}}}var Ft={f32:Float32Array,i32:Int32Array,u32:Uint32Array};function It(){return new Promise(e=>setTimeout(e,0))}async function Lt(e,t,n,r){let{device:i,pool:o}=e,{geo:s,signal:c,budgetMs:l}=n,u=t.count;if(s.attrs.point.count!==u)throw Error(`resident run: plan was built for ${u} points but the input geometry has ${s.attrs.point.count}; plans are single-cook artifacts — re-plan for new inputs`);let d=()=>{if(c?.aborted)throw new _},f=[],p=(e,t)=>{let n=o.acquire(e,t);return f.push(n),n},m=new Set,h=[];try{let n=s.attrs.point,c=t.slots.map(e=>{let t=p(e.bytes,Z.STORAGE|Z.COPY_DST|Z.COPY_SRC);if(e.init===`attr`){let r=n.require(e.name),a=e.bytes/4;if(r.data instanceof Uint8Array){let e=new Uint32Array(a);for(let t=0;t<a;t++)e[t]=r.data[t];i.queue.writeBuffer(t,0,e)}else i.queue.writeBuffer(t,0,r.data.subarray(0,a))}else if(e.init===`quat-default`){let n=new Float32Array(e.bytes/4);for(let e=3;e<n.length;e+=4)n[e]=1;i.queue.writeBuffer(t,0,n)}return t}),f=t.cols.map(e=>p(e,Z.STORAGE|Z.COPY_DST|Z.COPY_SRC)),g=t.instances===null?void 0:a(s,{defaultAssetId:t.instances.assetId,...t.instances.assetAttr===``?{}:{assetAttr:t.instances.assetAttr}}),_=t.instances!==null&&t.instances.permBytes>0?p(t.instances.permBytes,Z.STORAGE|Z.COPY_DST):void 0;_!==void 0&&g!==void 0&&i.queue.writeBuffer(_,0,g.perm);let v=Z.STORAGE|Z.COPY_DST|Z.COPY_SRC|Z.VERTEX,y=g===void 0?[]:Array.from(g.counts,e=>p(e*64,v)),b=g===void 0||t.instances===null||t.instances.colorBytes===0?[]:Array.from(g.counts,e=>p(e*Et,v)),x=(e,t)=>{if(e.kind===`slot`)return c[e.index];if(e.kind===`col`)return f[e.index];if(e.kind===`colorOut`){let e=b[t];if(e===void 0)throw Error(`resident run: a kernel binds a retained instance-colour buffer but the plan declares no colour output (plan and kernels disagree)`);return e}if(e.kind===`perm`){if(_===void 0)throw Error(`resident run: a kernel binds the grouping permutation but the plan declares no per-point asset attribute (plan and kernels disagree)`);return _}let n=y[t];if(n===void 0)throw Error(`resident run: a kernel binds a retained instance-transform buffer but the plan declares no instances output (plan and kernels disagree)`);return n},S=i.createCommandEncoder(),C=S.beginComputePass(),w=performance.now();for(let n of t.members){d();for(let t of n.steps){let n=e.getPipeline(t.key,t.wgsl,t.entryPoint,r);C.setPipeline(n);let a=Tt(t.workgroupSize,e.maxElementsPerDispatch),o=t.perBatch&&g!==void 0?Array.from(g.counts,(e,t)=>({batch:t,elements:e,base:g.offsets[t]})):[{batch:0,elements:u,base:0}];for(let e of o){r!==void 0&&r.dispatches++;let o=new ArrayBuffer(t.uniformBytes),s=new Uint8Array(o),c=new Uint32Array(o,0,t.uniformBytes>=16?4:3);c[0]=e.elements,c[1]=t.seed>>>0,t.perBatch&&(c[3]=e.base),t.consts.length>0&&new Float32Array(o,16,t.consts.length).set(t.consts);let l=Math.ceil(e.elements/a);for(let r=0;r<l;r++){let o=p(t.uniformBytes,Z.UNIFORM|Z.COPY_DST);c[2]=r*a,i.queue.writeBuffer(o,0,s);let l=i.createBindGroup({layout:n.getBindGroupLayout(0),entries:[{binding:t.uniformsBinding,resource:{buffer:o}},...t.bindings.map(t=>({binding:t.binding,resource:{buffer:x(t.ref,e.batch)}}))]}),u=Math.min(a,e.elements-r*a);C.setBindGroup(0,l),C.dispatchWorkgroups(Math.ceil(u/t.workgroupSize))}}}l!==void 0&&performance.now()-w>l&&(await It(),d(),w=performance.now())}C.end();let T=[],E,D=t.materialize?t.written.reduce((e,n)=>e+t.slots[n.slot].bytes,0):0;if(D>0){E=p(D,Z.COPY_DST|Z.MAP_READ);let e=0;for(let n of t.written){let r=t.slots[n.slot].bytes;S.copyBufferToBuffer(c[n.slot],0,E,e,r),T.push(e),e+=r}}i.queue.submit([S.finish()]);let O;if(t.materialize){let e;if(E!==void 0){await E.mapAsync(_t.READ,0,D);try{e=E.getMappedRange(0,D).slice(0)}finally{E.unmap()}}d(),O=ne(s);let n=O.attrs.point;for(let e of t.layoutOps)if(e.op===`replace`)n.replace(e.name,e.type,e.tupleSize);else{let e=n.get(`rot`);(!e||e.type!==`f32`||e.tupleSize!==4)&&(e&&n.remove(`rot`),n.add(`rot`,`f32`,4,[0,0,0,1]))}t.written.forEach((t,r)=>{let i=n.require(t.name),a=u*i.tupleSize;if(e===void 0)throw Error(`resident run: readback missing for a written attribute`);if(i.data instanceof Uint8Array){let t=new Uint32Array(e,T[r],a);for(let e=0;e<a;e++)i.data[e]=t[e]}else{let n=Ft[i.type];if(n===void 0)throw Error(`resident run: cannot materialize attribute "${t.name}" of type ${i.type}`);i.data.set(new n(e,T[r],a))}})}else d();let ee;if(t.instances!==null){let e=t.instances.colorBytes>0;if(g===void 0||y.length!==g.order.length||b.length!==(e?g.order.length:0))throw Error(`resident run: the plan declares an instances output but the acquired transform buffers do not match the grouping (library bug: plan.instances, the grouping, and the acquired buffers must agree)`);let n=(e,t,n)=>{let r=o.detach(e);m.add(e);try{return Ct(r,t,n)}catch(e){throw r.destroy(),e}},r=[];for(let t=0;t<g.order.length;t++){let i=g.order[t],a=g.counts[t],o=n(y[t],a*64,`${a} instances of "${i}"`);if(h.push(o),!e){r.push({residency:`device`,assetId:i,count:a,transforms:o});continue}let s=n(b[t],a*Et,`${a} instance colours of "${i}"`);h.push(s),r.push({residency:`device`,assetId:i,count:a,transforms:o,colors:s})}ee=r}r!==void 0&&(r.residentRuns++,r.fusedNodes+=t.members.length,r.readbacksSaved+=t.members.length-+!!t.materialize);let te={};return O!==void 0&&(te.geo=O),ee!==void 0&&(te.deviceBatches=ee),te}catch(e){for(let e of h)e.dispose();throw e instanceof _?e:Error(`GpuFieldEvaluator: resident run failed (${t.members.length} fused nodes [${t.members.map(e=>`"${e.id}"`).join(`, `)}], ${u} points): ${e instanceof Error?e.message:String(e)}`,{cause:e})}finally{for(let e of f)m.has(e)||o.release(e)}}var Rt=`gpu2`,zt=268435456,Bt=[`spawnInstances`],Vt={f32:Float32Array,i32:Int32Array,u32:Uint32Array},Ht={f32:Float32Array,i32:Int32Array,u32:Uint32Array};function Ut(e){let t=e=>e!==void 0&&e!==``?e:`?`;return[Rt,t(e?.vendor),t(e?.architecture),t(e?.device),t(e?.description)].join(`|`)}function $(e,t){return e!==void 0&&(e.fallbacks[t]=(e.fallbacks[t]??0)+1),null}var Wt=class{cacheSalt;residentTerminals;acceptDerivedSpecs;device;kernels=new Map;pipelines=new Map;pool;maxElementsPerDispatch;maxResidentBytes;constructor(e,t={}){if(t.maxElementsPerDispatch!==void 0&&!Number.isFinite(t.maxElementsPerDispatch))throw Error(`GpuFieldEvaluator: maxElementsPerDispatch must be a finite number, got ${t.maxElementsPerDispatch}; leave it unset to use the device maximum`);this.device=e,this.cacheSalt=Ut(t.adapterInfo??e.adapterInfo),this.pool=new bt(e,t.maxPooledBytes??zt),this.maxElementsPerDispatch=t.maxElementsPerDispatch,this.maxResidentBytes=t.maxResidentBytes??536870912,this.residentTerminals=t.deviceInstances===!0?Bt:[],this.acceptDerivedSpecs=n(t)}get pipelineCacheSize(){return this.pipelines.size}get kernelCacheSize(){return this.kernels.size}get poolStats(){return this.pool.stats}dispose(){this.pool.dispose()}chunkElements(e){let t=wt*e.workgroupSize,n=Math.min(this.maxElementsPerDispatch??t,t);return Math.max(e.workgroupSize,Math.floor(n/e.workgroupSize)*e.workgroupSize)}resolveField(e,t,n){let r=w(e,this.acceptDerivedSpecs);if(r===void 0)return $(n,h(e));let i=t.geo.attrs[t.domain],a={},o=[];for(let e of i.names().sort()){let t=i.get(e);t!==void 0&&(a[e]={type:t.type,tupleSize:t.tupleSize},o.push(`${JSON.stringify(e)}:${t.type}x${t.tupleSize}`))}let s;try{s=ot(r,e.key)}catch{return $(n,`compile-error`)}let c=`${s.length}#${s}|${o.join(`,`)}`,l=this.kernels.get(c);if(l===void 0){try{l=gt(r,{attributes:a})}catch(e){l=e instanceof Error?e:Error(String(e))}this.kernels.set(c,l)}if(l instanceof Error)return $(n,`compile-error`);if(l.inputs.length+1>8)return $(n,`too-many-buffers`);let u=dt(r,l,i);if(`problem`in u)return $(n,`param-bindings`);let d=i.count;if(d===0)return Promise.resolve({data:new Ht[l.outType](0),tupleSize:l.outTupleSize});let f=this.getPipeline(l.key,l.wgsl,l.entryPoint,n);return n!==void 0&&n.dispatches++,this.dispatch(e,t,l,f,d,u.values)}getPipeline(e,t,n,r){let i=this.pipelines.get(e);if(i!==void 0)return r!==void 0&&r.pipelineCacheHits++,i;let a=this.device.createShaderModule({code:t}),o=this.device.createComputePipeline({layout:`auto`,compute:{module:a,entryPoint:n}});return this.pipelines.set(e,o),r!==void 0&&r.pipelinesCompiled++,o}planRun(e,t,n){let r=Pt(e,t,this.maxResidentBytes,this.acceptDerivedSpecs);return`plan`in r?r.plan:(n!==void 0&&(n.fallbacks[r.reason]=(n.fallbacks[r.reason]??0)+1),null)}executeRun(e,t,n){let r=Ot(e);return r===null?Promise.reject(Error(`GpuFieldEvaluator.executeRun: plan was not produced by this library's planRun; pass the object returned by planRun on the same resolver`)):Lt({device:this.device,pool:this.pool,maxElementsPerDispatch:this.maxElementsPerDispatch,getPipeline:(e,t,n,r)=>this.getPipeline(e,t,n,r)},r,t,n)}async dispatch(e,t,n,r,i,a){let o=this.device,s=[],c=(e,t)=>{let n=this.pool.acquire(e,t);return s.push(n),n};try{let e=this.chunkElements(n),s=Math.ceil(i/e),l=[],u=t.geo.attrs[t.domain];for(let e of n.inputs){let t=u.require(e.name),n=i*e.tupleSize,r;if(t.data instanceof Uint8Array){let e=new Uint32Array(n);for(let r=0;r<n;r++)e[r]=t.data[r];r=e}else r=t.data.subarray(0,n);let a=c(n*4,Z.STORAGE|Z.COPY_DST);o.queue.writeBuffer(a,0,r),l.push({binding:e.binding,resource:{buffer:a}})}let d=i*n.outTupleSize*4,f=c(d,Z.STORAGE|Z.COPY_SRC);l.push({binding:n.bindings.output,resource:{buffer:f}});let p=c(d,Z.COPY_DST|Z.MAP_READ),m=new ArrayBuffer(n.uniformBytes),h=new Uint8Array(m),g=new Uint32Array(m,0,3);g[0]=i,g[1]=t.seed>>>0,a.length>0&&new Float32Array(m,16,a.length).set(a);let _=[];for(let t=0;t<s;t++){let i=c(n.uniformBytes,Z.UNIFORM|Z.COPY_DST);g[2]=t*e,o.queue.writeBuffer(i,0,h),_.push(o.createBindGroup({layout:r.getBindGroupLayout(0),entries:[{binding:n.bindings.uniforms,resource:{buffer:i}},...l]}))}let v=o.createCommandEncoder(),y=v.beginComputePass();y.setPipeline(r);for(let t=0;t<s;t++){let r=Math.min(e,i-t*e);y.setBindGroup(0,_[t]),y.dispatchWorkgroups(Math.ceil(r/n.workgroupSize))}y.end(),v.copyBufferToBuffer(f,0,p,0,d),o.queue.submit([v.finish()]),await p.mapAsync(_t.READ,0,d);let b;try{b=p.getMappedRange(0,d).slice(0)}finally{p.unmap()}return{data:new Vt[n.outType](b),tupleSize:n.outTupleSize}}catch(n){throw Error(`GpuFieldEvaluator: dispatch failed for field ${e.key} (${i} elements on the ${t.domain} domain): ${n instanceof Error?n.message:String(n)}`,{cause:n})}finally{for(let e of s)this.pool.release(e)}}};export{Wt as t};