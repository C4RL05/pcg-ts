import{$i as e,$r as t,Gr as n,Gt as r,Kr as i,Pi as a,Q as o,Qi as s,Wr as c,Wt as l,aa as u,ai as d,ca as f,ci as p,da as m,di as h,ea as g,et as _,fi as v,ia as y,ii as b,l as x,la as ee,li as S,mi as C,ni as w,oa as T,oi as E,pa as D,pi as O,ra as te,ri as ne,sa as re,ta as ie,u as ae,ua as oe}from"./mobile-CqGYuGMJ.js";var k=class extends Error{constructor(e){super(e),this.name=`GpuCompileError`}};function A(e,t){let n=Math.fround(e);if(!Number.isFinite(n))throw new k(`${t}: value ${e} is not representable as a finite f32 (WGSL kernels compute in f32; keep magnitudes within ~3.4e38)`);return Object.is(n,-0)?`-0f`:`${String(n)}f`}function se(e){return`${e>>>0}u`}function j(e){return`0x${(e>>>0).toString(16).padStart(8,`0`)}u`}var M=j,ce=A(34028234663852886e22,`internal f32 max`);function le(e,t){let n=M(e);for(let e of t)n=`pcg_hash_mix(${n}, ${e})`;return`pcg_hash_finalize(${n})`}function ue(){let e=[];for(let t=0;t<12;t++){let n=e=>A(v[t*3+e],`internal GRAD3`);e.push(`  vec3<f32>(${n(0)}, ${n(1)}, ${n(2)}),`)}return`var<private> PCG_GRAD3: array<vec3<f32>, 12> = array<vec3<f32>, 12>(
${e.join(`
`)}
);`}var N=e=>t=>A(t,e),de=new Map([[`PCG_GRAD3`,{deps:[],text:ue()}],[`pcg_hash_mix`,{deps:[],text:`fn pcg_hash_mix(h_in: u32, value: u32) -> u32 {
  var k = value * ${M(T)};
  k = (k << 15u) | (k >> 17u);
  k = k * ${M(re)};
  var h = h_in ^ k;
  h = (h << 13u) | (h >> 19u);
  h = h * 5u + ${M(f)};
  return h;
}`}],[`pcg_hash_finalize`,{deps:[],text:`fn pcg_hash_finalize(h_in: u32) -> u32 {
  var h = h_in ^ (h_in >> 16u);
  h = h * ${M(te)};
  h = h ^ (h >> 13u);
  h = h * ${M(y)};
  h = h ^ (h >> 16u);
  return h;
}`}],[`pcg_hash3`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash3(a: u32, b: u32, c: u32) -> u32 {
  return ${le(oe(3),[`a`,`b`,`c`])};
}`}],[`pcg_hash4`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash4(a: u32, b: u32, c: u32, d: u32) -> u32 {
  return ${le(oe(4),[`a`,`b`,`c`,`d`])};
}`}],[`pcg_hash5`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash5(a: u32, b: u32, c: u32, d: u32, e: u32) -> u32 {
  return ${le(oe(5),[`a`,`b`,`c`,`d`,`e`])};
}`}],[`pcg_hash_float`,{deps:[],text:`fn pcg_hash_float(h: u32) -> f32 {
  return f32(h >> 8u) * ${A(u,`internal hashFloat scale`)};
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
  return ${N(`internal PERLIN_SCALE`)(S)} * pcg_mix(
    pcg_mix(pcg_mix(n000, n100, u), pcg_mix(n010, n110, u), v),
    pcg_mix(pcg_mix(n001, n101, u), pcg_mix(n011, n111, u), v),
    w);
}`}],[`pcg_simplex_corner`,{deps:[`pcg_hash4`,`PCG_GRAD3`],text:`fn pcg_simplex_corner(seed: u32, i: i32, j: i32, k: i32, x: f32, y: f32, z: f32) -> f32 {
  let t = ${N(`internal simplex R2`)(d)} - x * x - y * y - z * z;
  if (t <= 0f) {
    return 0f;
  }
  let g = pcg_hash4(seed, bitcast<u32>(i), bitcast<u32>(j), bitcast<u32>(k)) % 12u;
  let t2 = t * t;
  return t2 * t2 * dot(PCG_GRAD3[g], vec3<f32>(x, y, z));
}`}],[`pcg_simplex_noise`,{deps:[`pcg_simplex_corner`],text:`fn pcg_simplex_noise(seed: u32, p: vec3<f32>) -> f32 {
  let s = (p.x + p.y + p.z) * ${N(`internal simplex F3`)(ne)};
  let i = i32(floor(p.x + s));
  let j = i32(floor(p.y + s));
  let k = i32(floor(p.z + s));
  let t = f32(i + j + k) * ${N(`internal simplex G3`)(b)};
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
  let x1 = x0 - f32(i1) + ${N(`internal simplex G3`)(b)};
  let y1 = y0 - f32(j1) + ${N(`internal simplex G3`)(b)};
  let z1 = z0 - f32(k1) + ${N(`internal simplex G3`)(b)};
  let x2 = x0 - f32(i2) + ${N(`internal simplex 2*G3`)(2*b)};
  let y2 = y0 - f32(j2) + ${N(`internal simplex 2*G3`)(2*b)};
  let z2 = z0 - f32(k2) + ${N(`internal simplex 2*G3`)(2*b)};
  let x3 = x0 - 1f + ${N(`internal simplex 3*G3`)(3*b)};
  let y3 = y0 - 1f + ${N(`internal simplex 3*G3`)(3*b)};
  let z3 = z0 - 1f + ${N(`internal simplex 3*G3`)(3*b)};
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
  var f1 = ${ce};
  var f2 = ${ce};
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
}`}]]);function fe(e){let t=new Set,n=e=>{if(t.has(e))return;let r=de.get(e);if(!r)throw Error(`internal: unknown WGSL library item "${e}"`);t.add(e);for(let e of r.deps)n(e)};for(let t of e)n(t);let r=[];for(let[e,n]of de)t.has(e)&&r.push(n.text);return r}var P=64,pe=`wgsl2`,me=[`x`,`y`,`z`,`w`];function F(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}function he(e,t,n){return new k(`${e}: ${t} has tupleSize ${n}, but GPU kernels support tuple sizes 1 to 4; evaluate this field on the CPU instead, or split it into components`)}function ge(e,t,n){let r=1;for(let i of n)if(i!==1){if(r!==1&&r!==i)throw new k(`${t}: ${e}: incompatible tuple sizes ${r} and ${i}`);r=i}return r}var _e=class{layout;lines=[];libRoots=new Set;usesSeed=!1;valueNumbers=new Map;bindings=new Map;helpers=new Map;helperTexts=[];helperCounters=new Map;varCounter=0;constructor(e,t){this.layout=e,t.forEach((t,n)=>{this.bindings.set(t,{name:t,varName:`in${n}`,binding:n+1,attr:e.attributes[t]})})}emit(e,t){let n=this.valueNumbers.get(e);if(n)return n;let r={ref:`v${this.varCounter++}`,size:t};return this.lines.push(`  let ${r.ref} = ${e};`),this.valueNumbers.set(e,r),r}binding(e){let t=this.bindings.get(e);if(!t)throw Error(`internal: attribute ${JSON.stringify(e)} was not pre-bound`);return t}boundAttrs(){return[...this.bindings.values()]}helper(e,t){let n=this.helpers.get(t);if(n)return n;let r=this.helperCounters.get(e)??0;this.helperCounters.set(e,r+1);let i=`pcg_${e}_${r}`;return this.helpers.set(t,i),this.helperTexts.push(t.replaceAll(`@NAME@`,i)),i}helperBlocks(){return this.helperTexts}};function I(e,t){return e.size===t?e.ref:`vec${t}<f32>(${e.ref})`}function L(e){return e===1?`0f`:`vec${e}<f32>(0f)`}function R(e){return e===1?`1f`:`vec${e}<f32>(1f)`}function ve(e){let t=Object.keys(e.attributes).sort();return t.length===0?`the layout declares no attributes`:`layout attributes: ${t.map(e=>JSON.stringify(e)).join(`, `)}`}function ye(e,t,n,r,i){let a=e.layout.attributes;if(!Object.hasOwn(a,n))throw new k(`${t}: ${i}attribute ${JSON.stringify(n)} is not in the kernel layout; ${ve(e.layout)}`);let o=a[n];if(o.type===`string`)throw new k(`${t}: ${i}attribute ${JSON.stringify(n)} has type "string"; string attributes cannot be read as fields and are CPU-only — use a numeric or bool attribute`);if(r!==void 0&&o.tupleSize!==r)throw new k(`${t}: ${i}attribute ${JSON.stringify(n)}: expected tupleSize ${r}, got ${o.tupleSize} in the kernel layout`);if(o.tupleSize>4)throw he(t,`${i}attribute ${JSON.stringify(n)}`,o.tupleSize);return o}function z(e,t,n,r,i){let a=ye(e,t,n,r,i),o=e.binding(n),s=a.tupleSize,c=e=>a.type===`f32`?e:`f32(${e})`;if(s===1)return e.emit(c(`${o.varName}[i]`),1);let l=[];for(let e=0;e<s;e++)l.push(c(`${o.varName}[${B(s,e)}]`));return e.emit(`vec${s}<f32>(${l.join(`, `)})`,s)}function B(e,t){return e===1?`i`:t===0?`i * ${e}u`:`i * ${e}u + ${t}u`}var V=new Map;function be(){return[...V.keys()].sort()}function xe(e,t,n){let r=String(e.fn),i=V.get(r);if(!i)throw new k(`${t}: field fn "${r}" is not supported by the WGSL compiler; supported fns: ${be().join(`, `)}`);return i(e,t,n)}function H(e,t,n){return typeof e==`number`?n.emit(A(e,t),1):Array.isArray(e)?Se(e,t,n):xe(e,t,n)}function Se(e,t,n){let r=e.length;if(r>4)throw he(t,`constant`,r);if(r===1)return n.emit(A(e[0],t),1);let i=e.map(e=>A(e,t));return n.emit(`vec${r}<f32>(${i.join(`, `)})`,r)}function U(e){return e.args}V.set(`constant`,(e,t,n)=>{let r=e.value;return typeof r==`number`?n.emit(A(r,`${t}.value`),1):Se(r,`${t}.value`,n)}),V.set(`attribute`,(e,t,n)=>{let r=e.name,i=e.tupleSize;return z(n,t,r,i,``)}),V.set(`position`,(e,t,n)=>z(n,t,`P`,3,`position reads `)),V.set(`index`,(e,t,n)=>n.emit(`f32(i)`,1)),V.set(`fraction`,(e,t,n)=>n.emit(`f32(i) / f32(max(params.count, 2u) - 1u)`,1)),V.set(`randomField`,(e,t,n)=>{let r=e.key,i=typeof r==`string`?m(r):(r??0)>>>0;n.usesSeed=!0,n.libRoots.add(`pcg_hash3`),n.libRoots.add(`pcg_hash4`),n.libRoots.add(`pcg_hash_float`);let a=`randomField's per-point identity reads `,o=ye(n,t,`P`,void 0,a);if(o.tupleSize<3)throw new k(`${t}: ${a}attribute "P" with x, y and z (tupleSize 3), got tupleSize ${o.tupleSize}`);let s=n.binding(`P`).varName,c=e=>{let t=`${s}[${B(o.tupleSize,e)}]`;return o.type===`f32`?`bitcast<u32>(${t})`:`bitcast<u32>(f32(${t}))`},l=`0u`,u=Object.hasOwn(n.layout.attributes,`seed`)?n.layout.attributes.seed:void 0;if(u!==void 0){if(u.tupleSize!==1||u.type!==`u32`&&u.type!==`i32`)throw new k(`${t}: ${a}the standard point attribute "seed" as a u32 or i32 scalar, but the layout has it as ${u.type}x${u.tupleSize}; this field resolves on the CPU instead`);let e=n.binding(`seed`).varName;l=u.type===`u32`?`${e}[i]`:`bitcast<u32>(${e}[i])`}let d=`pcg_hash4(${c(0)}, ${c(1)}, ${c(2)}, ${l})`;return n.emit(`pcg_hash_float(pcg_hash3(params.seed, ${j(i)}, ${d}))`,1)});function W(e,t,n){V.set(e,(r,i,a)=>{let o=U(r),s=[];for(let e=0;e<t;e++)s.push(H(o[e],`${i}.args[${e}]`,a));let c=ge(e,i,s.map(e=>e.size)),l=s.map(e=>I(e,c));return a.emit(n(l,c),c)})}W(`add`,2,e=>`${e[0]} + ${e[1]}`),W(`sub`,2,e=>`${e[0]} - ${e[1]}`),W(`mul`,2,e=>`${e[0]} * ${e[1]}`),W(`div`,2,e=>`${e[0]} / ${e[1]}`),W(`min`,2,e=>`min(${e[0]}, ${e[1]})`),W(`max`,2,e=>`max(${e[0]}, ${e[1]})`),W(`abs`,1,e=>`abs(${e[0]})`),W(`floor`,1,e=>`floor(${e[0]})`),W(`sin`,1,e=>`sin(${e[0]})`),W(`cos`,1,e=>`cos(${e[0]})`),W(`tan`,1,e=>`tan(${e[0]})`),W(`asin`,1,e=>`asin(${e[0]})`),W(`acos`,1,e=>`acos(${e[0]})`),W(`atan`,1,e=>`atan(${e[0]})`),W(`atan2`,2,e=>`atan2(${e[0]}, ${e[1]})`),W(`clamp`,3,e=>`clamp(${e[0]}, ${e[1]}, ${e[2]})`),W(`lerp`,3,e=>`${e[0]} + (${e[1]} - ${e[0]}) * ${e[2]}`),W(`select`,3,(e,t)=>`select(${e[2]}, ${e[1]}, ${e[0]} != ${L(t)})`),W(`lt`,2,(e,t)=>`select(${L(t)}, ${R(t)}, ${e[0]} < ${e[1]})`),W(`le`,2,(e,t)=>`select(${L(t)}, ${R(t)}, ${e[0]} <= ${e[1]})`),W(`gt`,2,(e,t)=>`select(${L(t)}, ${R(t)}, ${e[0]} > ${e[1]})`),W(`ge`,2,(e,t)=>`select(${L(t)}, ${R(t)}, ${e[0]} >= ${e[1]})`),W(`eq`,2,(e,t)=>`select(${L(t)}, ${R(t)}, ${e[0]} == ${e[1]})`),W(`ne`,2,(e,t)=>`select(${L(t)}, ${R(t)}, ${e[0]} != ${e[1]})`),V.set(`remap`,(e,t,n)=>{let r=U(e).map((e,r)=>H(e,`${t}.args[${r}]`,n)),i=ge(`remap`,t,r.map(e=>e.size)),[a,o,s,c,l]=r.map(e=>I(e,i)),u=n.emit(`${s} - ${o}`,i),d=L(i),f=n.emit(`select(${u.ref}, ${R(i)}, ${u.ref} == ${d})`,i);return n.emit(`select(${c} + ((${a} - ${o}) / ${f.ref}) * (${l} - ${c}), ${c}, ${u.ref} == ${d})`,i)}),V.set(`dot`,(e,t,n)=>{let r=U(e),i=H(r[0],`${t}.args[0]`,n),a=H(r[1],`${t}.args[1]`,n),o=ge(`dot`,t,[i.size,a.size]);return o===1?n.emit(`${i.ref} * ${a.ref}`,1):n.emit(`dot(${I(i,o)}, ${I(a,o)})`,1)}),V.set(`length`,(e,t,n)=>{let r=H(U(e)[0],`${t}.args[0]`,n);if(r.size===1)return n.emit(`abs(${r.ref})`,1);let i=n.emit(`dot(${r.ref}, ${r.ref})`,1);return n.emit(`sqrt(${i.ref})`,1)}),V.set(`normalize`,(e,t,n)=>{let r=H(U(e)[0],`${t}.args[0]`,n),i=r.size===1?n.emit(`${r.ref} * ${r.ref}`,1):n.emit(`dot(${r.ref}, ${r.ref})`,1),a=n.emit(`select(0f, 1f / sqrt(${i.ref}), ${i.ref} > 0f)`,1);return n.emit(`${r.ref} * ${a.ref}`,r.size)}),V.set(`vec`,(e,t,n)=>{let r=U(e).map((e,r)=>H(e,`${t}.args[${r}]`,n)),i=r.reduce((e,t)=>e+t.size,0);if(i>4)throw he(t,`vec result`,i);return r.length===1?r[0]:n.emit(`vec${i}<f32>(${r.map(e=>e.ref).join(`, `)})`,i)}),V.set(`component`,(e,t,n)=>{let r=H(U(e)[0],`${t}.args[0]`,n),i=e.index;if(i>=r.size)throw new k(`${t}: component: index ${i} out of range for tupleSize ${r.size}`);return r.size===1?r:n.emit(`${r.ref}.${me[i]}`,1)}),V.set(`ramp`,(e,t,n)=>{let r=H(U(e)[0],`${t}.args[0]`,n);if(r.size!==1)throw new k(`${t}: ramp: input must be scalar, got tupleSize ${r.size}`);let i=e.stops,a=n.helper(`ramp`,Ce(i,`${t}.stops`));return n.emit(`${a}(${r.ref})`,1)});function Ce(e,t){let n=e=>A(e,t),r=e.length-1,i=[];i.push(`fn @NAME@(t: f32) -> f32 {`),i.push(`  if (t <= ${n(e[0][0])}) {`),i.push(`    return ${n(e[0][1])};`),i.push(`  }`),i.push(`  if (t >= ${n(e[r][0])}) {`),i.push(`    return ${n(e[r][1])};`),i.push(`  }`);let a=t=>{let r=e[t-1][0],i=e[t-1][1],a=e[t][0]-r,o=e[t][1]-i;return`${n(i)} + ${n(o)} * ((t - ${n(r)}) / ${n(a)})`};for(let t=1;t<r;t++)i.push(`  if (t <= ${n(e[t][0])}) {`),i.push(`    return ${a(t)};`),i.push(`  }`);return r>=1?i.push(`  return ${a(r)};`):i.push(`  return t;`),i.push(`}`),i.join(`
`)}var we={valueNoise:h,perlinNoise:p,simplexNoise:E,worleyNoise:w},G={valueNoise:`pcg_value_noise`,perlinNoise:`pcg_perlin_noise`,simplexNoise:`pcg_simplex_noise`};function K(e){return e.opts??{}}function Te(e,t,n,r){let i=K(t),a=i.position===void 0?n:`${n}.opts.position`,o=i.position===void 0?z(r,n,`P`,3,`${e} position reads `):H(i.position,a,r);if(o.size!==3)throw new k(`${a}: ${e}: position field must have tupleSize 3, got ${o.size}`);let s=A(i.frequency??1,`${n}.opts.frequency`),[c,l,u]=i.offset??[0,0,0],d=`vec3<f32>(${A(c,`${n}.opts.offset`)}, ${A(l,`${n}.opts.offset`)}, ${A(u,`${n}.opts.offset`)})`;return r.emit(`${o.ref} * ${s} + ${d}`,3)}function Ee(e,t){return C(we[e],(t??0)>>>0)}function De(e,t,n,r){let[i,a]=n,o=a-i;return e.emit(`(${t.ref} - ${A(i,r)}) / ${A(o,r)}`,1)}for(let e of[`valueNoise`,`perlinNoise`,`simplexNoise`])V.set(e,(t,n,r)=>{let i=K(t),a=Te(e,t,n,r);r.libRoots.add(G[e]);let o=r.emit(`${G[e]}(${j(Ee(e,i.seed))}, ${a.ref})`,1);return i.normalized===!0?De(r,o,O[e],`${n}.opts.normalized`):o});V.set(`worleyNoise`,(e,t,n)=>{let r=K(e),i=r.output??`f1`,a=r.exact===!0,o=Te(`worleyNoise`,e,t,n);n.libRoots.add(`pcg_worley`);let s=i!==`f1`,c=n.emit(`pcg_worley(${j(Ee(`worleyNoise`,r.seed))}, ${o.ref}, ${a}, ${s})`,2),l=i===`f1`?n.emit(`${c.ref}.x`,1):i===`f2`?n.emit(`${c.ref}.y`,1):n.emit(`${c.ref}.y - ${c.ref}.x`,1);return r.normalized===!0?De(n,l,O.worleyNoise[i],`${t}.opts.normalized`):l});function Oe(e){return e===`worleyNoise`?O.worleyNoise.f1:O[e]}function ke(e,t,n){return e===`worleyNoise`?`pcg_worley(${t}, ${n}, false, false).x`:`${G[e]}(${t}, ${n})`}V.set(`fbm`,(e,t,n)=>{let r=e.base,i=K(e),a=i.octaves??4,o=i.lacunarity??2,s=i.gain??.5,c=i.seed??0,l=i.frequency??1,[u,d,f]=i.offset??[0,0,0],p=i.position===void 0?t:`${t}.opts.position`,m=i.position===void 0?z(n,t,`P`,3,`fbm position reads `):H(i.position,p,n);if(m.size!==3)throw new k(`${p}: fbm: position field must have tupleSize 3, got ${m.size}`);let h=Oe(r),g=[],_=[],v=[],y=1,b=l,x=0,S=0;for(let e=0;e<a;e++)g.push(j(Ee(r,ee(c,e)))),_.push(A(b,`${t}.opts.frequency`)),v.push(A(y,`${t}.opts.gain`)),x+=y>=0?y*h[0]:y*h[1],S+=y>=0?y*h[1]:y*h[0],y*=s,b*=o;n.libRoots.add(r===`worleyNoise`?`pcg_worley`:G[r]);let C=`vec3<f32>(${A(u,`${t}.opts.offset`)}, ${A(d,`${t}.opts.offset`)}, ${A(f,`${t}.opts.offset`)})`,w=`fn @NAME@(p: vec3<f32>) -> f32 {
  var seeds = array<u32, ${a}>(${g.join(`, `)});
  var freqs = array<f32, ${a}>(${_.join(`, `)});
  var amps = array<f32, ${a}>(${v.join(`, `)});
  var sum = 0f;
  for (var o = 0u; o < ${se(a)}; o++) {
    sum = sum + ${ke(r,`seeds[o]`,`p * freqs[o] + `+C)} * amps[o];
  }
  return sum;
}`,T=n.helper(`fbm`,w),E=n.emit(`${T}(${m.ref})`,1);if(i.normalized!==!0)return E;if(!(S>x))throw new k(`${t}: fbm: normalized: true needs a non-degenerate output range, got [${x}, ${S}] for this octaves/gain configuration`);return De(n,E,[x,S],`${t}.opts.normalized`)});var Ae=new Set([`valueNoise`,`perlinNoise`,`simplexNoise`,`worleyNoise`,`fbm`]);function je(e,t){if(!F(e))return;let n=e.fn;if(n===`attribute`){typeof e.name==`string`&&t.add(e.name);return}if(n===`position`){t.add(`P`);return}if(n===`randomField`){t.add(`P`),t.add(`seed`);return}if(typeof n==`string`&&Ae.has(n)){let n=e.opts;F(n)&&n.position!==void 0?je(n.position,t):t.add(`P`);return}let r=e.args;if(Array.isArray(r))for(let e of r)je(e,t)}var Me=new Set([`f32`,`i32`,`u32`,`bool`,`string`]);function Ne(e){if(!F(e)||!F(e.attributes))throw new k(`compileFieldSpec: layout must be { attributes: { name: { type, tupleSize } } }`);for(let[t,n]of Object.entries(e.attributes)){if(!F(n)||!Me.has(n.type))throw new k(`kernel layout attribute ${JSON.stringify(t)}: unknown type ${JSON.stringify(n?.type)}; valid types: "f32", "i32", "u32", "bool" ("string" is accepted but CPU-only)`);let e=n.tupleSize;if(typeof e!=`number`||!Number.isInteger(e)||e<1)throw new k(`kernel layout attribute ${JSON.stringify(t)}: tupleSize must be a positive integer, got ${String(e)}`)}}function Pe(e){return typeof e==`number`?{fn:`constant`,value:e}:Array.isArray(e)?{fn:`constant`,value:[...e]}:e}function Fe(e){return e.type===`bool`?`u32`:e.type}function Ie(e,n){Ne(n);let r=Pe(e),i=t(r),a=new Set;je(r,a);let o=new _e(n,[...a].filter(e=>Object.hasOwn(n.attributes,e)&&n.attributes[e].type!==`string`).sort()),s=`f32`,c=0,l=[],u=e=>{if(c=e.size,e.size===1)l.push(`  outBuf[i] = ${e.ref};`);else for(let t=0;t<e.size;t++)l.push(`  outBuf[${B(e.size,t)}] = ${e.ref}.${me[t]};`)},d=r.fn===`attribute`?r.name:r.fn===`position`?`P`:void 0;if(r.fn===`index`)s=`u32`,c=1,l.push(`  outBuf[i] = i;`);else if(d!==void 0){let e=ye(o,`$`,d,r.fn===`position`?3:r.tupleSize,r.fn===`position`?`position reads `:``);if(e.type===`i32`||e.type===`u32`){s=e.type,c=e.tupleSize;let t=o.binding(d);for(let n=0;n<e.tupleSize;n++)l.push(`  outBuf[${B(e.tupleSize,n)}] = ${t.varName}[${B(e.tupleSize,n)}];`)}else u(xe(r,`$`,o))}else u(xe(r,`$`,o));let f=o.boundAttrs(),p=f.map(e=>({name:e.name,type:Fe(e.attr),tupleSize:e.attr.tupleSize,binding:e.binding})),m=f.length+1,h=[`@group(0) @binding(0) var<uniform> params: PcgParams;`];for(let e of f)h.push(`@group(0) @binding(${e.binding}) var<storage, read> ${e.varName}: array<${Fe(e.attr)}>; // attribute ${JSON.stringify(e.name)}: ${e.attr.type} tupleSize ${e.attr.tupleSize}`);h.push(`@group(0) @binding(${m}) var<storage, read_write> outBuf: array<${s}>;`);let g=[`// Generated by pcg-ts compileFieldSpec (WGSL field kernel).
// Dispatch: 1D, chunked; each chunk runs ceil(chunkElements / ${P}) workgroups of ${P}
// with element index i = chunkOffset + gid.x; one invocation per element.

struct PcgParams {
  count: u32,
  seed: u32,
  chunkOffset: u32,
}

${h.join(`
`)}`,...fe(o.libRoots),...o.helperBlocks(),`@compute @workgroup_size(${P})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x + params.chunkOffset;
  if (i >= params.count) {
    return;
  }
${[...o.lines,...l].join(`
`)}
}`],_=f.map(e=>`${JSON.stringify(e.name)}:${e.attr.type}x${e.attr.tupleSize}`).join(`,`);return{wgsl:`${g.join(`

`)}\n`,entryPoint:`main`,workgroupSize:P,outTupleSize:c,outType:s,inputs:p,bindings:{uniforms:0,output:m},usesSeed:o.usesSeed,key:`${pe}|spec=${i.key}|layout=[${_}]`}}var q={MAP_READ:1,COPY_SRC:4,COPY_DST:8,VERTEX:32,UNIFORM:64,STORAGE:128},Le={READ:1},Re=256;function ze(e){let t=Re;for(;t<e;)t*=2;return t}var Be=class{device;maxPooledBytes;free=new Map;meta=new Map;detachedSet=new WeakSet;idleBytes=0;idleCount=0;created=0;reused=0;destroyed=0;detachedTotal=0;detachedLive=0;detachedLiveBytes=0;constructor(e,t){this.device=e,this.maxPooledBytes=t}acquire(e,t){let n=ze(e),r=`${t}|${n}`,i=this.free.get(r)?.pop();if(i!==void 0)return this.idleBytes-=n,this.idleCount--,this.reused++,i;let a=this.device.createBuffer({size:n,usage:t});return this.meta.set(a,{key:r,bytes:n}),this.created++,a}release(e){let t=this.meta.get(e);if(t===void 0)throw this.detachedSet.has(e)?Error(`BufferPool.release: buffer was detached from this pool, so the pool no longer owns it and cannot reclaim it; destroy it through the DetachedBuffer that detach() returned (or the handle wrapping it) and stop releasing it`):Error(`BufferPool.release: buffer was not acquired from this pool`);if(this.idleBytes+t.bytes>this.maxPooledBytes){this.meta.delete(e),e.destroy(),this.destroyed++;return}let n=this.free.get(t.key);n===void 0&&(n=[],this.free.set(t.key,n)),n.push(e),this.idleBytes+=t.bytes,this.idleCount++}detach(e){let t=this.meta.get(e);if(t===void 0)throw Error(this.detachedSet.has(e)?`BufferPool.detach: buffer was already detached from this pool; ownership can only leave once — reuse the DetachedBuffer the first detach() returned`:`BufferPool.detach: buffer was not acquired from this pool`);this.meta.delete(e),this.detachedSet.add(e),this.detachedTotal++,this.detachedLive++,this.detachedLiveBytes+=t.bytes;let n=!1,r=this;return{buffer:e,bytes:t.bytes,get destroyed(){return n},destroy(){n||(n=!0,r.detachedLive--,r.detachedLiveBytes-=t.bytes,r.destroyed++,e.destroy())}}}get stats(){return{buffersCreated:this.created,buffersReused:this.reused,buffersDestroyed:this.destroyed,pooledBuffers:this.idleCount,pooledBytes:this.idleBytes,buffersDetached:this.detachedTotal,detachedBuffers:this.detachedLive,detachedBytes:this.detachedLiveBytes}}dispose(){for(let e of this.free.values())for(let t of e)this.meta.delete(t),t.destroy(),this.destroyed++;this.free.clear(),this.idleBytes=0,this.idleCount=0}},Ve=`apply2`;function He(e,t=!1){return e>0?16+e*16:t?16:12}var Ue=[`x`,`y`,`z`,`w`];function J(e,t,n){if(t.kind===`const`)return Ge(t,n);let r=Ke(e,t,n);return t.type===`f32`?r:`f32(${r})`}function We(e,t,n){return t.kind===`const`?Ge(t,n):Ke(e,t,n)}function Ge(e,t){let n=e.tupleSize===1?0:t;if(n>=4)throw Error(`apply codegen: constant slot ${e.slot} has no component ${n} (a uniform slot holds 4 f32 components)`);return`params.consts[${e.slot}].${Ue[n]}`}function Ke(e,t,n){return t.tupleSize===1?`${e}[i]`:n===0?`${e}[i * ${t.tupleSize}u]`:`${e}[i * ${t.tupleSize}u + ${n}u]`}function qe(e,t,n){return t===1?`${e}[i]`:n===0?`${e}[i * ${t}u]`:`${e}[i * ${t}u + ${n}u]`}var Y=class{items=[];add(e,t,n,r){return this.items.push({role:e,access:t,elem:n,comment:r}),`b${this.items.length}`}};function X(e){let t=0;for(let n of e)if(n.kind===`const`){if(n.slot<0||n.slot>=4)throw Error(`apply codegen: constant slot ${n.slot} is out of range; an apply kernel carries at most 4 uniform constant slots (raise MAX_APPLY_CONST_SLOTS in applyKernels.ts if a new node kind needs more)`);t=Math.max(t,n.slot+1)}return t}function Z(e,t,n,r,i,a=!1){let o=[`@group(0) @binding(0) var<uniform> params: PcgParams;`],s=[];n.forEach((e,t)=>{let n=t+1,r=e.access===`read`?`read`:`read_write`;o.push(`@group(0) @binding(${n}) var<storage, ${r}> b${n}: array<${e.elem}>; // ${e.comment}`),s.push({binding:n,role:e.role,access:e.access})});let c=a?`
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
`,entryPoint:`main`,workgroupSize:64,bindings:s,constSlots:t,uniformBytes:He(t,a),key:`${Ve}|${e}`}}var Q=e=>e.kind===`column`?`${e.type}x${e.tupleSize}`:`constx${e.tupleSize}@${e.slot}`;function Je(e,t,n){let r=e.kind===`const`?`f32`:e.type,i=t===`f32`&&e.kind===`column`&&e.type===`f32`,a=i?`u32`:r,o=t===`bool`||i?`u32`:t,s=new Y,c=e.kind===`column`?s.add(`value`,`read`,a,`value column ${Q(e)}`):``,l=e.kind===`column`?{...e,type:a}:e,u=s.add(`target`,`read_write`,o,`target attribute ${t} tupleSize ${n}`),d=(e,n)=>{switch(t){case`f32`:return i?e:n;case`i32`:return r===`f32`?`i32(${e})`:r===`i32`?e:`bitcast<i32>(${e})`;case`u32`:return r===`f32`?`u32(${e})`:r===`u32`?e:`bitcast<u32>(${e})`;default:return`select(0u, 1u, ${e} != ${r===`f32`?`0f`:r===`i32`?`0i`:`0u`})`}},f=[];for(let e=0;e<n;e++){let t=We(c,l,e);f.push(`  ${qe(u,n,e)} = ${d(t,J(c,l,e))};`)}return Z(`setAttribute|val=${Q(e)}|out=${t}x${n}`,X([e]),s.items,[],f.join(`
`))}var Ye={euler:`fn pcg_quat_from_euler_deg(r: vec3<f32>) -> vec4<f32> {
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
}`};function Xe(e,t,n,r,i){let a=new Y,o=e.kind===`column`?a.add(`translate`,`read`,e.type,`translate column ${Q(e)}`):``,s=t.kind===`column`?a.add(`rotateEuler`,`read`,t.type,`rotateEuler column ${Q(t)}`):``,c=n.kind===`column`?a.add(`scale`,`read`,n.type,`scale column ${Q(n)}`):``,l=a.add(`P`,`read_write`,`f32`,`attribute P: f32 tupleSize 3`),u=r?a.add(`rot`,`read_write`,`f32`,`attribute rot: f32 tupleSize 4`):``,d=i?a.add(`scaleAttr`,`read_write`,`f32`,`attribute scale: f32 tupleSize 3`):``,f=[];return f.push(`  let s = vec3<f32>(${[0,1,2].map(e=>J(c,n,e)).join(`, `)});`),f.push(`  let q = pcg_quat_from_euler_deg(vec3<f32>(${[0,1,2].map(e=>J(s,t,e)).join(`, `)}));`),f.push(`  let v = pcg_rotate_vec(q, vec3<f32>(${l}[i * 3u] * s.x, ${l}[i * 3u + 1u] * s.y, ${l}[i * 3u + 2u] * s.z));`),f.push(`  ${l}[i * 3u] = v.x + ${J(o,e,0)};`),f.push(`  ${l}[i * 3u + 1u] = v.y + ${J(o,e,1)};`),f.push(`  ${l}[i * 3u + 2u] = v.z + ${J(o,e,2)};`),r&&(f.push(`  let q2 = pcg_quat_mul(q, vec4<f32>(${u}[i * 4u], ${u}[i * 4u + 1u], ${u}[i * 4u + 2u], ${u}[i * 4u + 3u]));`),f.push(`  ${u}[i * 4u] = q2.x;`),f.push(`  ${u}[i * 4u + 1u] = q2.y;`),f.push(`  ${u}[i * 4u + 2u] = q2.z;`),f.push(`  ${u}[i * 4u + 3u] = q2.w;`)),i&&(f.push(`  ${d}[i * 3u] = ${d}[i * 3u] * s.x;`),f.push(`  ${d}[i * 3u + 1u] = ${d}[i * 3u + 1u] * s.y;`),f.push(`  ${d}[i * 3u + 2u] = ${d}[i * 3u + 2u] * s.z;`)),Z(`transformPoints|t=${Q(e)}|r=${Q(t)}|s=${Q(n)}|rot=${+!!r}|scl=${+!!i}`,X([e,t,n]),a.items,[Ye.euler,Ye.mul,Ye.rotate],f.join(`
`))}function Ze(e,t){let n=new Y,r=e.kind===`column`?n.add(`amount`,`read`,e.type,`amount column ${Q(e)}`):``,i=t?n.add(`seed`,`read`,`u32`,`attribute seed: u32 tupleSize 1`):``,a=n.add(`P`,`read_write`,`f32`,`attribute P: f32 tupleSize 3`),o=[];o.push(`  let ident = pcg_hash4(bitcast<u32>(${a}[i * 3u]), bitcast<u32>(${a}[i * 3u + 1u]), bitcast<u32>(${a}[i * 3u + 2u]), ${t?`${i}[i]`:`0u`});`);for(let t=0;t<3;t++){let n=t===0?`i * 3u`:`i * 3u + ${t}u`;o.push(`  ${a}[${n}] = ${a}[${n}] + (pcg_hash_float(pcg_hash3(params.seed, ident, ${t}u)) * 2f - 1f) * ${J(r,e,t)};`)}return Z(`jitterPoints|a=${Q(e)}|s=${+!!t}`,X([e]),n.items,fe([`pcg_hash3`,`pcg_hash4`,`pcg_hash_float`]),o.join(`
`))}var Qe={"+x":`f, u, -r`,"-x":`-f, u, r`,"+y":`-r, f, u`,"-y":`r, -f, u`,"+z":`r, u, f`,"-z":`-r, u, -f`};function $e(e,t,n){let r=new Y,i=e.kind===`column`?r.add(`direction`,`read`,e.type,`direction column ${Q(e)}`):``,a=r.add(`rot`,`read_write`,`f32`,`attribute rot: f32 tupleSize 4`),o=A(1e-12,`internal ORIENT_PARALLEL_EPS`),s=`  let d = vec3<f32>(${[0,1,2].map(t=>J(i,e,t)).join(`, `)});
  let dl = dot(d, d);
  if (dl == 0f) {
    return; // zero direction: keep the prior rot
  }
  let f = d * (1f / sqrt(dl));
  let up = vec3<f32>(${[0,1,2].map(e=>J(``,n,e)).join(`, `)});
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
  let q = pcg_quat_from_basis(${Qe[t]});
  ${a}[i * 4u] = q.x;
  ${a}[i * 4u + 1u] = q.y;
  ${a}[i * 4u + 2u] = q.z;
  ${a}[i * 4u + 3u] = q.w;`;return Z(`orientAlongVector|d=${Q(e)}|axis=${t}|up=${Q(n)}`,X([e,n]),r.items,[Ye.basis],s)}function et(e,t,n=!1,r=0){let i=r>0;if(i&&r<3)throw Error(`apply codegen: spawnInstances colour source has tupleSize ${r}; components 0-2 are read as RGB, so it must be at least 3 (the planner rejects narrower columns before reaching codegen)`);let a=new Y,o=a.add(`P`,`read`,`f32`,`attribute P: f32 tupleSize 3`),s=e?a.add(`rot`,`read`,`f32`,`attribute rot: f32 tupleSize 4`):``,c=t?a.add(`scaleAttr`,`read`,`f32`,`attribute scale: f32 tupleSize 3`):``,l=a.add(`transforms`,`read_write`,`f32`,`out: 16 f32 per instance`),u=n?a.add(`perm`,`read`,`u32`,`grouping permutation: source point index per slot`):``,d=i?a.add(`color`,`read`,`f32`,`colour source: f32 tupleSize ${r}`):``,f=i?a.add(`colors`,`read_write`,`f32`,`out: 4 f32 per instance (vec3 storage stride, [3] = 0 pad)`):``,p=n?`src`:`i`,m=e?`vec4<f32>(${s}[${p} * 4u], ${s}[${p} * 4u + 1u], ${s}[${p} * 4u + 2u], ${s}[${p} * 4u + 3u])`:`vec4<f32>(0f, 0f, 0f, 1f)`,h=t?`vec3<f32>(${c}[${p} * 3u], ${c}[${p} * 3u + 1u], ${c}[${p} * 3u + 2u])`:`vec3<f32>(1f, 1f, 1f)`,g=`${n?`  let src = ${u}[params.base + i];\n`:``}  let q = ${m};
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
  ${f}[co + 3u] = 0f;`:``}`;return Z(`spawnInstances|rot=${+!!e}|scl=${+!!t}${n?`|perm`:``}${i?`|color=${r}`:``}`,0,a.items,[],g,n)}var tt=`webgpu`,nt=class{backend=tt;byteLength;detached;label;constructor(e,t,n){this.detached=e,this.byteLength=t,this.label=n}get disposed(){return this.detached.destroyed}get resource(){if(this.detached.destroyed)throw Error(`device transforms handle (${this.label}) was disposed; its GPU buffer is destroyed and cannot be bound. Dispose a handle only after the last frame that reads it, and re-cook to obtain a fresh one (device-resident outputs are never memoized, so every cook produces a new handle)`);return this.detached.buffer}dispose(){this.detached.destroy()}};function rt(e,t,n){return new nt(e,t,n)}var it=65535;function at(e,t){let n=it*e;return Math.max(e,Math.floor(Math.min(t??n,n)/e)*e)}var ot=16,st=`pcg-resident-run/5`;function ct(e){return e.format===st?e:null}var lt={reason:`run-plan-failed`},ut=[`+x`,`-x`,`+y`,`-y`,`+z`,`-z`];function dt(e){if(typeof e!=`object`||!e||Array.isArray(e))return!1;let t=e;if(t.fn===`randomField`)return!0;let n=t.args;if(Array.isArray(n)){for(let e of n)if(dt(e))return!0}let r=t.opts;return!!(typeof r==`object`&&r&&dt(r.position))}function ft(e){return Array.isArray(e)&&e.length===3&&e.every(e=>typeof e==`number`&&Number.isFinite(e))}var $=class extends Error{},pt=[];function mt(e,t,n,r,i){let a=[...e].map(([e,t])=>({name:e,slot:t})),o=i||r===null,s=t.reduce((e,t)=>e+t.bytes,0),c=n.reduce((e,t)=>e+t,0),l=o?a.reduce((e,n)=>e+t[n.slot].bytes,0):0;return{writtenList:a,materialize:o,totalBytes:s+c+l+(r?.bytes??0)+(r?.colorBytes??0)+(r?.permBytes??0)}}function ht(t,n,r,i){let a=n.count,o=new Map(Object.entries(n.attributes)),s=[],c=new Map,l=[],u=new Map,d=[],f=[],p=null,m=()=>Object.fromEntries(o),h=e=>{let t=c.get(e);if(t!==void 0)return t;let n=o.get(e);if(n===void 0||n.type===`string`)throw new $(e);let r=s.length;return s.push({bytes:a*n.tupleSize*4,init:`attr`,name:e}),c.set(e,r),r},g=(e,t,n)=>{let r=s.length;return s.push({bytes:a*t*4,init:n,name:e}),c.set(e,r),r},_=(e,t,n)=>{let r=o.get(e);if(r===void 0||r.type!==t||r.tupleSize!==n)throw new $(e)},v=(e,t,n)=>{let r=t.length/4;if(r>=4)throw Error(`resident run: "${n}" needs more than 4 uniform constant slots for its constant params; raise MAX_APPLY_CONST_SLOTS in applyKernels.ts (each slot costs 16 bytes of the per-chunk uniform and nothing else)`);for(let n=0;n<4;n++)t.push(n<e.length?e[n]:0);return{kind:`const`,tupleSize:e.length,slot:r}},y=(t,n,r,o,s,c)=>{let d;if(ie(t)){let n=e(t,i);if(n===void 0)throw new $(`no spec`);if(u.has(`P`)&&dt(n))throw new $(`identity after P write`);d=n}else if(typeof t==`number`||Array.isArray(t)&&t.every(e=>typeof e==`number`)){let e=typeof t==`number`?[t]:t;if(e.length<1||e.length>4||o!==null&&!o.includes(e.length))throw new $(`tuple`);for(let t of e)if(!Number.isFinite(Math.fround(t)))throw new $(`f32 range`);return{param:v(e,s,c),ref:null}}else throw new $(`bad param value`);let f;try{f=Ie(d,{attributes:m()})}catch{throw new $(`compile`)}if(f.inputs.length+1>8)throw new $(`buffers`);if(o!==null&&!o.includes(f.outTupleSize))throw new $(`tuple`);let p=l.length;return l.push(a*f.outTupleSize*4),r.push({key:f.key,wgsl:f.wgsl,entryPoint:f.entryPoint,workgroupSize:f.workgroupSize,seed:n,uniformsBinding:f.bindings.uniforms,uniformBytes:12,consts:pt,perBatch:!1,bindings:[...f.inputs.map(e=>({binding:e.binding,ref:{kind:`slot`,index:h(e.name)}})),{binding:f.bindings.output,ref:{kind:`col`,index:p}}]}),{param:{kind:`column`,type:f.outType,tupleSize:f.outTupleSize},ref:{kind:`col`,index:p}}},b=(e,t,n,r,i=!1)=>{if(e.constSlots*4!==r.length)throw Error(`resident run: apply kernel "${e.key}" declares ${e.constSlots} constant slots but the planner allocated ${r.length/4}`);return{key:e.key,wgsl:e.wgsl,entryPoint:e.entryPoint,workgroupSize:e.workgroupSize,seed:t,uniformsBinding:0,uniformBytes:e.uniformBytes,consts:r,perBatch:i,bindings:e.bindings.map(e=>{let t=n[e.role];if(t===void 0)throw new $(`unmapped role ${e.role}`);return{binding:e.binding,ref:t}})}};try{for(let e of t){let n=e===t[t.length-1],r=[],i=[],s=e.params;switch(e.kind){case`setAttribute`:{let t=s.name,n=s.type,a=s.tupleSize;if(typeof t!=`string`)throw new $(`name`);if(n!==`f32`&&n!==`i32`&&n!==`u32`&&n!==`bool`)throw new $(`type`);if(typeof a!=`number`||!Number.isInteger(a)||a<1||a>4)throw new $(`tupleSize`);let c=typeof s.seed==`number`?s.seed:NaN,l=c===0?e.seed:ee(e.seed,c),{param:f,ref:p}=y(s.value,l,r,a===1?[1]:[1,a],i,e.kind),m=g(t,a,`none`);o.set(t,{type:n,tupleSize:a}),u.set(t,m),d.push({op:`replace`,name:t,type:n,tupleSize:a});let h={target:{kind:`slot`,index:m}};p!==null&&(h.value=p),r.push(b(Je(f,n,a),0,h,i));break}case`transformPoints`:{_(`P`,`f32`,3);let t=y(s.translate,e.seed,r,[1,3],i,e.kind),n=y(s.rotateEuler,e.seed,r,[1,3],i,e.kind),a=y(s.scale,e.seed,r,[1,3],i,e.kind),c=o.get(`rot`),l=c!==void 0&&c.type===`f32`&&c.tupleSize===4,d=o.get(`scale`),f=d!==void 0&&d.type===`f32`&&d.tupleSize===3,p=h(`P`);u.set(`P`,p);let m={P:{kind:`slot`,index:p}};if(t.ref!==null&&(m.translate=t.ref),n.ref!==null&&(m.rotateEuler=n.ref),a.ref!==null&&(m.scale=a.ref),l){let e=h(`rot`);u.set(`rot`,e),m.rot={kind:`slot`,index:e}}if(f){let e=h(`scale`);u.set(`scale`,e),m.scaleAttr={kind:`slot`,index:e}}r.push(b(Xe(t.param,n.param,a.param,l,f),0,m,i));break}case`jitterPoints`:{if(_(`P`,`f32`,3),u.has(`P`))throw new $(`identity after P write`);let t=typeof s.seed==`number`?s.seed:NaN,n=ee(e.seed,t),a=y(s.amount,n,r,[1,3],i,e.kind),c=o.get(`seed`),l=c!==void 0;if(l&&(c.type!==`u32`||c.tupleSize!==1))throw new $(`seed attribute shape`);let d=h(`P`);u.set(`P`,d);let f={P:{kind:`slot`,index:d}};a.ref!==null&&(f.amount=a.ref),l&&(f.seed={kind:`slot`,index:h(`seed`)}),r.push(b(Ze(a.param,l),n,f,i));break}case`orientAlongVector`:{let t=s.axis;if(!ut.includes(t))throw new $(`axis`);if(!ft(s.up))throw new $(`up`);let n=y(s.direction,e.seed,r,[1,3],i,e.kind),a=s.up,c=a[0]*a[0]+a[1]*a[1]+a[2]*a[2],l=c>0?1/Math.sqrt(c):0,f=[a[0]*l,a[1]*l,a[2]*l];for(let e of f)if(!Number.isFinite(Math.fround(e)))throw new $(`up range`);let p=v(f,i,e.kind),m=o.get(`rot`),_=m!==void 0&&m.type===`f32`&&m.tupleSize===4?h(`rot`):g(`rot`,4,`quat-default`);o.set(`rot`,{type:`f32`,tupleSize:4}),u.set(`rot`,_),d.push({op:`ensure-rot`});let x={rot:{kind:`slot`,index:_}};n.ref!==null&&(x.direction=n.ref),r.push(b($e(n.param,t,p),0,x,i));break}case`spawnInstances`:{if(!n)throw new $(`spawnInstances must be the run's last member`);let e=s.assetId;if(typeof e!=`string`||e===``)throw new $(`assetId`);if(_(`P`,`f32`,3),a>1048576)throw new $(`${a} instances over MAX_INSTANCES`);let t=s.assetAttr;if(t!==void 0&&typeof t!=`string`)throw new $(`assetAttr`);let c=t===void 0?``:t;if(c!==``){let e=o.get(c);if(e===void 0)throw new $(`assetAttr "${c}" not on the point domain`);if(e.type!==`string`)throw new $(`assetAttr "${c}" is ${e.type}, not string`)}let l=s.colorAttr;if(l!==void 0&&typeof l!=`string`)throw new $(`colorAttr`);let u=l===void 0?``:l,d=0;if(u!==``){let e=o.get(u);if(e===void 0)throw new $(`colorAttr "${u}" not on the point domain`);if(e.type!==`f32`||e.tupleSize<3)throw new $(`colorAttr "${u}" is ${e.type}x${e.tupleSize}`);d=e.tupleSize}let f=o.get(`rot`),m=f!==void 0&&f.type===`f32`&&f.tupleSize===4,g=o.get(`scale`),v=g!==void 0&&g.type===`f32`&&g.tupleSize===3,y={P:{kind:`slot`,index:h(`P`)},transforms:{kind:`out`}};m&&(y.rot={kind:`slot`,index:h(`rot`)}),v&&(y.scaleAttr={kind:`slot`,index:h(`scale`)});let x=c!==``;x&&(y.perm={kind:`perm`}),d>0&&(y.color={kind:`slot`,index:h(u)},y.colors={kind:`colorOut`}),r.push(b(et(m,v,x,d),0,y,i,x)),p={assetId:e,assetAttr:c,colorAttr:u,colorTupleSize:d,count:a,bytes:a*64,colorBytes:d>0?a*ot:0,permBytes:x?a*4:0};break}default:throw new $(`unknown kind ${e.kind}`)}f.push({id:e.id,type:e.type,steps:r})}}catch(e){if(e instanceof $)return lt;throw e}let{writtenList:x,materialize:S,totalBytes:C}=mt(u,s,l,p,n.needsGeometry);return C>r?{reason:`run-too-large`}:{plan:{format:st,count:a,members:f,slots:s,cols:l,written:x,layoutOps:d,materialize:S,instances:p,totalBytes:C}}}var gt={f32:Float32Array,i32:Int32Array,u32:Uint32Array};function _t(){return new Promise(e=>setTimeout(e,0))}async function vt(e,t,n,r){let{device:i,pool:o}=e,{geo:s,signal:l,budgetMs:u}=n,d=t.count;if(s.attrs.point.count!==d)throw Error(`resident run: plan was built for ${d} points but the input geometry has ${s.attrs.point.count}; plans are single-cook artifacts — re-plan for new inputs`);let f=()=>{if(l?.aborted)throw new D},p=[],m=(e,t)=>{let n=o.acquire(e,t);return p.push(n),n},h=new Set,g=[];try{let n=s.attrs.point,l=t.slots.map(e=>{let t=m(e.bytes,q.STORAGE|q.COPY_DST|q.COPY_SRC);if(e.init===`attr`){let r=n.require(e.name),a=e.bytes/4;if(r.data instanceof Uint8Array){let e=new Uint32Array(a);for(let t=0;t<a;t++)e[t]=r.data[t];i.queue.writeBuffer(t,0,e)}else i.queue.writeBuffer(t,0,r.data.subarray(0,a))}else if(e.init===`quat-default`){let n=new Float32Array(e.bytes/4);for(let e=3;e<n.length;e+=4)n[e]=1;i.queue.writeBuffer(t,0,n)}return t}),p=t.cols.map(e=>m(e,q.STORAGE|q.COPY_DST|q.COPY_SRC)),_=t.instances===null?void 0:c(s,{defaultAssetId:t.instances.assetId,...t.instances.assetAttr===``?{}:{assetAttr:t.instances.assetAttr}}),v=t.instances!==null&&t.instances.permBytes>0?m(t.instances.permBytes,q.STORAGE|q.COPY_DST):void 0;v!==void 0&&_!==void 0&&i.queue.writeBuffer(v,0,_.perm);let y=q.STORAGE|q.COPY_DST|q.COPY_SRC|q.VERTEX,b=_===void 0?[]:Array.from(_.counts,e=>m(e*64,y)),x=_===void 0||t.instances===null||t.instances.colorBytes===0?[]:Array.from(_.counts,e=>m(e*ot,y)),ee=(e,t)=>{if(e.kind===`slot`)return l[e.index];if(e.kind===`col`)return p[e.index];if(e.kind===`colorOut`){let e=x[t];if(e===void 0)throw Error(`resident run: a kernel binds a retained instance-colour buffer but the plan declares no colour output (plan and kernels disagree)`);return e}if(e.kind===`perm`){if(v===void 0)throw Error(`resident run: a kernel binds the grouping permutation but the plan declares no per-point asset attribute (plan and kernels disagree)`);return v}let n=b[t];if(n===void 0)throw Error(`resident run: a kernel binds a retained instance-transform buffer but the plan declares no instances output (plan and kernels disagree)`);return n},S=i.createCommandEncoder(),C=S.beginComputePass(),w=performance.now();for(let n of t.members){f();for(let t of n.steps){let n=e.getPipeline(t.key,t.wgsl,t.entryPoint,r);C.setPipeline(n);let a=at(t.workgroupSize,e.maxElementsPerDispatch),o=t.perBatch&&_!==void 0?Array.from(_.counts,(e,t)=>({batch:t,elements:e,base:_.offsets[t]})):[{batch:0,elements:d,base:0}];for(let e of o){r!==void 0&&r.dispatches++;let o=new ArrayBuffer(t.uniformBytes),s=new Uint8Array(o),c=new Uint32Array(o,0,t.uniformBytes>=16?4:3);c[0]=e.elements,c[1]=t.seed>>>0,t.perBatch&&(c[3]=e.base),t.consts.length>0&&new Float32Array(o,16,t.consts.length).set(t.consts);let l=Math.ceil(e.elements/a);for(let r=0;r<l;r++){let o=m(t.uniformBytes,q.UNIFORM|q.COPY_DST);c[2]=r*a,i.queue.writeBuffer(o,0,s);let l=i.createBindGroup({layout:n.getBindGroupLayout(0),entries:[{binding:t.uniformsBinding,resource:{buffer:o}},...t.bindings.map(t=>({binding:t.binding,resource:{buffer:ee(t.ref,e.batch)}}))]}),u=Math.min(a,e.elements-r*a);C.setBindGroup(0,l),C.dispatchWorkgroups(Math.ceil(u/t.workgroupSize))}}}u!==void 0&&performance.now()-w>u&&(await _t(),f(),w=performance.now())}C.end();let T=[],E,D=t.materialize?t.written.reduce((e,n)=>e+t.slots[n.slot].bytes,0):0;if(D>0){E=m(D,q.COPY_DST|q.MAP_READ);let e=0;for(let n of t.written){let r=t.slots[n.slot].bytes;S.copyBufferToBuffer(l[n.slot],0,E,e,r),T.push(e),e+=r}}i.queue.submit([S.finish()]);let O;if(t.materialize){let e;if(E!==void 0){await E.mapAsync(Le.READ,0,D);try{e=E.getMappedRange(0,D).slice(0)}finally{E.unmap()}}f(),O=a(s);let n=O.attrs.point;for(let e of t.layoutOps)if(e.op===`replace`)n.replace(e.name,e.type,e.tupleSize);else{let e=n.get(`rot`);(!e||e.type!==`f32`||e.tupleSize!==4)&&(e&&n.remove(`rot`),n.add(`rot`,`f32`,4,[0,0,0,1]))}t.written.forEach((t,r)=>{let i=n.require(t.name),a=d*i.tupleSize;if(e===void 0)throw Error(`resident run: readback missing for a written attribute`);if(i.data instanceof Uint8Array){let t=new Uint32Array(e,T[r],a);for(let e=0;e<a;e++)i.data[e]=t[e]}else{let n=gt[i.type];if(n===void 0)throw Error(`resident run: cannot materialize attribute "${t.name}" of type ${i.type}`);i.data.set(new n(e,T[r],a))}})}else f();let te;if(t.instances!==null){let e=t.instances.colorBytes>0;if(_===void 0||b.length!==_.order.length||x.length!==(e?_.order.length:0))throw Error(`resident run: the plan declares an instances output but the acquired transform buffers do not match the grouping (library bug: plan.instances, the grouping, and the acquired buffers must agree)`);let n=(e,t,n)=>{let r=o.detach(e);h.add(e);try{return rt(r,t,n)}catch(e){throw r.destroy(),e}},r=[];for(let t=0;t<_.order.length;t++){let i=_.order[t],a=_.counts[t],o=n(b[t],a*64,`${a} instances of "${i}"`);if(g.push(o),!e){r.push({residency:`device`,assetId:i,count:a,transforms:o});continue}let s=n(x[t],a*ot,`${a} instance colours of "${i}"`);g.push(s),r.push({residency:`device`,assetId:i,count:a,transforms:o,colors:s})}te=r}r!==void 0&&(r.residentRuns++,r.fusedNodes+=t.members.length,r.readbacksSaved+=t.members.length-+!!t.materialize);let ne={};return O!==void 0&&(ne.geo=O),te!==void 0&&(ne.deviceBatches=te),ne}catch(e){for(let e of g)e.dispose();throw e instanceof D?e:Error(`GpuFieldEvaluator: resident run failed (${t.members.length} fused nodes [${t.members.map(e=>`"${e.id}"`).join(`, `)}], ${d} points): ${e instanceof Error?e.message:String(e)}`,{cause:e})}finally{for(let e of p)h.has(e)||o.release(e)}}var yt=`gpu2`,bt=268435456,xt=[`spawnInstances`],St={f32:Float32Array,i32:Int32Array,u32:Uint32Array},Ct={f32:Float32Array,i32:Int32Array,u32:Uint32Array};function wt(e){let t=e=>e!==void 0&&e!==``?e:`?`;return[yt,t(e?.vendor),t(e?.architecture),t(e?.device),t(e?.description)].join(`|`)}function Tt(e,t){return e!==void 0&&(e.fallbacks[t]=(e.fallbacks[t]??0)+1),null}var Et=class{cacheSalt;residentTerminals;acceptDerivedSpecs;device;kernels=new Map;pipelines=new Map;pool;maxElementsPerDispatch;maxResidentBytes;constructor(e,t={}){if(t.maxElementsPerDispatch!==void 0&&!Number.isFinite(t.maxElementsPerDispatch))throw Error(`GpuFieldEvaluator: maxElementsPerDispatch must be a finite number, got ${t.maxElementsPerDispatch}; leave it unset to use the device maximum`);this.device=e,this.cacheSalt=wt(t.adapterInfo??e.adapterInfo),this.pool=new Be(e,t.maxPooledBytes??bt),this.maxElementsPerDispatch=t.maxElementsPerDispatch,this.maxResidentBytes=t.maxResidentBytes??536870912,this.residentTerminals=t.deviceInstances===!0?xt:[],this.acceptDerivedSpecs=s(t)}get pipelineCacheSize(){return this.pipelines.size}get poolStats(){return this.pool.stats}dispose(){this.pool.dispose()}chunkElements(e){let t=it*e.workgroupSize,n=Math.min(this.maxElementsPerDispatch??t,t);return Math.max(e.workgroupSize,Math.floor(n/e.workgroupSize)*e.workgroupSize)}resolveField(t,n,r){let i=e(t,this.acceptDerivedSpecs);if(i===void 0)return Tt(r,g(t));let a=n.geo.attrs[n.domain],o={},s=[];for(let e of a.names().sort()){let t=a.get(e);t!==void 0&&(o[e]={type:t.type,tupleSize:t.tupleSize},s.push(`${JSON.stringify(e)}:${t.type}x${t.tupleSize}`))}let c=`${t.key.length}#${t.key}|${s.join(`,`)}`,l=this.kernels.get(c);if(l===void 0){try{l=Ie(i,{attributes:o})}catch(e){l=e instanceof Error?e:Error(String(e))}this.kernels.set(c,l)}if(l instanceof Error)return Tt(r,`compile-error`);if(l.inputs.length+1>8)return Tt(r,`too-many-buffers`);let u=a.count;if(u===0)return Promise.resolve({data:new Ct[l.outType](0),tupleSize:l.outTupleSize});let d=this.getPipeline(l.key,l.wgsl,l.entryPoint,r);return r!==void 0&&r.dispatches++,this.dispatch(t,n,l,d,u)}getPipeline(e,t,n,r){let i=this.pipelines.get(e);if(i!==void 0)return r!==void 0&&r.pipelineCacheHits++,i;let a=this.device.createShaderModule({code:t}),o=this.device.createComputePipeline({layout:`auto`,compute:{module:a,entryPoint:n}});return this.pipelines.set(e,o),r!==void 0&&r.pipelinesCompiled++,o}planRun(e,t,n){let r=ht(e,t,this.maxResidentBytes,this.acceptDerivedSpecs);return`plan`in r?r.plan:(n!==void 0&&(n.fallbacks[r.reason]=(n.fallbacks[r.reason]??0)+1),null)}executeRun(e,t,n){let r=ct(e);return r===null?Promise.reject(Error(`GpuFieldEvaluator.executeRun: plan was not produced by this library's planRun; pass the object returned by planRun on the same resolver`)):vt({device:this.device,pool:this.pool,maxElementsPerDispatch:this.maxElementsPerDispatch,getPipeline:(e,t,n,r)=>this.getPipeline(e,t,n,r)},r,t,n)}async dispatch(e,t,n,r,i){let a=this.device,o=[],s=(e,t)=>{let n=this.pool.acquire(e,t);return o.push(n),n};try{let e=this.chunkElements(n),o=Math.ceil(i/e),c=[],l=t.geo.attrs[t.domain];for(let e of n.inputs){let t=l.require(e.name),n=i*e.tupleSize,r;if(t.data instanceof Uint8Array){let e=new Uint32Array(n);for(let r=0;r<n;r++)e[r]=t.data[r];r=e}else r=t.data.subarray(0,n);let o=s(n*4,q.STORAGE|q.COPY_DST);a.queue.writeBuffer(o,0,r),c.push({binding:e.binding,resource:{buffer:o}})}let u=i*n.outTupleSize*4,d=s(u,q.STORAGE|q.COPY_SRC);c.push({binding:n.bindings.output,resource:{buffer:d}});let f=s(u,q.COPY_DST|q.MAP_READ),p=[];for(let l=0;l<o;l++){let o=s(12,q.UNIFORM|q.COPY_DST);a.queue.writeBuffer(o,0,new Uint32Array([i,t.seed>>>0,l*e])),p.push(a.createBindGroup({layout:r.getBindGroupLayout(0),entries:[{binding:n.bindings.uniforms,resource:{buffer:o}},...c]}))}let m=a.createCommandEncoder(),h=m.beginComputePass();h.setPipeline(r);for(let t=0;t<o;t++){let r=Math.min(e,i-t*e);h.setBindGroup(0,p[t]),h.dispatchWorkgroups(Math.ceil(r/n.workgroupSize))}h.end(),m.copyBufferToBuffer(d,0,f,0,u),a.queue.submit([m.finish()]),await f.mapAsync(Le.READ,0,u);let g;try{g=f.getMappedRange(0,u).slice(0)}finally{f.unmap()}return{data:new St[n.outType](g),tupleSize:n.outTupleSize}}catch(n){throw Error(`GpuFieldEvaluator: dispatch failed for field ${e.key} (${i} elements on the ${t.domain} domain): ${n instanceof Error?n.message:String(n)}`,{cause:n})}finally{for(let e of o)this.pool.release(e)}}};function Dt(e){return Array.isArray(e)?e.map(e=>e.clone()):e.clone()}function Ot(e){return Array.isArray(e)?e:[e]}function kt(e,t){let n=[];try{for(let r of e){let e=t[r.assetId];if(!e){let e=Object.keys(t).sort().join(`, `);throw Error(`toInstancedMeshes: unknown assetId "${r.assetId}"; known assets: `+(e===``?`(none)`:e))}if(r.transforms.length!==r.count*16)throw Error(`toInstancedMeshes: batch "${r.assetId}" has ${r.transforms.length} transform floats, expected count * 16 = ${r.count*16}`);if(r.colors&&r.colors.length!==r.count*3)throw Error(`toInstancedMeshes: batch "${r.assetId}" has ${r.colors.length} colour floats, expected count * 3 = ${r.count*3} (rgb per instance; alpha is dropped at the spawner)`);let i=new _(e.geometry,Dt(e.material),r.count);i.instanceMatrix.array.set(r.transforms),i.instanceMatrix.needsUpdate=!0,r.colors&&(i.instanceColor=new o(r.colors.slice(),3),i.instanceColor.needsUpdate=!0),i.name=r.assetId,i.computeBoundingSphere(),n.push(i)}}catch(e){for(let e of n){e.dispose();for(let t of Ot(e.material))t.dispose()}throw e}return n}function At(e,t={}){let a=e.attrs.point,o=a.get(`P`);if(!o||o.type!==`f32`||o.tupleSize!==3)throw Error(`toPointsObject: geometry needs a point attribute "P" (f32, tupleSize 3)`);let s=a.count,c=new ae;c.setAttribute(`position`,new x(o.data.slice(0,s*3),3));let u=!1,d=t.useColor===!1?void 0:i(a.get(`color`));if(d){let e=new Float32Array(s*3);for(let t=0;t<s;t++)n(e,t*3,d,t);c.setAttribute(`color`,new x(e,3)),u=!0}let f=new r({size:t.size??.1,sizeAttenuation:!0,vertexColors:u});return new l(c,f)}export{Et as a,kt as i,Dt as n,Ot as r,At as t};