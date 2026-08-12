import{A as e,At as t,Bt as n,D as r,Ft as i,It as a,Lt as o,Nt as s,O as c,Rt as l,S as u,T as d,Ut as f,Vt as p,Wt as m,at as h,b as g,h as _,jt as v,k as y,kt as b,qt as x,s as S,v as C,w,x as T,y as E,zt as D}from"./mobile-BAPbsnLk.js";var O=class extends Error{constructor(e){super(e),this.name=`GpuCompileError`}};function k(e,t){let n=Math.fround(e);if(!Number.isFinite(n))throw new O(`${t}: value ${e} is not representable as a finite f32 (WGSL kernels compute in f32; keep magnitudes within ~3.4e38)`);return Object.is(n,-0)?`-0f`:`${String(n)}f`}function A(e){return`${e>>>0}u`}function j(e){return`0x${(e>>>0).toString(16).padStart(8,`0`)}u`}var M=j,ee=k(34028234663852886e22,`internal f32 max`);function te(e,t){let n=M(e);for(let e of t)n=`pcg_hash_mix(${n}, ${e})`;return`pcg_hash_finalize(${n})`}function ne(){let e=[];for(let t=0;t<12;t++){let n=e=>k(c[t*3+e],`internal GRAD3`);e.push(`  vec3<f32>(${n(0)}, ${n(1)}, ${n(2)}),`)}return`var<private> PCG_GRAD3: array<vec3<f32>, 12> = array<vec3<f32>, 12>(
${e.join(`
`)}
);`}var N=e=>t=>k(t,e),re=new Map([[`PCG_GRAD3`,{deps:[],text:ne()}],[`pcg_hash_mix`,{deps:[],text:`fn pcg_hash_mix(h_in: u32, value: u32) -> u32 {
  var k = value * ${M(l)};
  k = (k << 15u) | (k >> 17u);
  k = k * ${M(D)};
  var h = h_in ^ k;
  h = (h << 13u) | (h >> 19u);
  h = h * 5u + ${M(n)};
  return h;
}`}],[`pcg_hash_finalize`,{deps:[],text:`fn pcg_hash_finalize(h_in: u32) -> u32 {
  var h = h_in ^ (h_in >> 16u);
  h = h * ${M(i)};
  h = h ^ (h >> 13u);
  h = h * ${M(a)};
  h = h ^ (h >> 16u);
  return h;
}`}],[`pcg_hash3`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash3(a: u32, b: u32, c: u32) -> u32 {
  return ${te(f(3),[`a`,`b`,`c`])};
}`}],[`pcg_hash4`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash4(a: u32, b: u32, c: u32, d: u32) -> u32 {
  return ${te(f(4),[`a`,`b`,`c`,`d`])};
}`}],[`pcg_hash5`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash5(a: u32, b: u32, c: u32, d: u32, e: u32) -> u32 {
  return ${te(f(5),[`a`,`b`,`c`,`d`,`e`])};
}`}],[`pcg_hash_float`,{deps:[],text:`fn pcg_hash_float(h: u32) -> f32 {
  return f32(h >> 8u) * ${k(o,`internal hashFloat scale`)};
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
  return ${N(`internal PERLIN_SCALE`)(d)} * pcg_mix(
    pcg_mix(pcg_mix(n000, n100, u), pcg_mix(n010, n110, u), v),
    pcg_mix(pcg_mix(n001, n101, u), pcg_mix(n011, n111, u), v),
    w);
}`}],[`pcg_simplex_corner`,{deps:[`pcg_hash4`,`PCG_GRAD3`],text:`fn pcg_simplex_corner(seed: u32, i: i32, j: i32, k: i32, x: f32, y: f32, z: f32) -> f32 {
  let t = ${N(`internal simplex R2`)(T)} - x * x - y * y - z * z;
  if (t <= 0f) {
    return 0f;
  }
  let g = pcg_hash4(seed, bitcast<u32>(i), bitcast<u32>(j), bitcast<u32>(k)) % 12u;
  let t2 = t * t;
  return t2 * t2 * dot(PCG_GRAD3[g], vec3<f32>(x, y, z));
}`}],[`pcg_simplex_noise`,{deps:[`pcg_simplex_corner`],text:`fn pcg_simplex_noise(seed: u32, p: vec3<f32>) -> f32 {
  let s = (p.x + p.y + p.z) * ${N(`internal simplex F3`)(E)};
  let i = i32(floor(p.x + s));
  let j = i32(floor(p.y + s));
  let k = i32(floor(p.z + s));
  let t = f32(i + j + k) * ${N(`internal simplex G3`)(g)};
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
  let x1 = x0 - f32(i1) + ${N(`internal simplex G3`)(g)};
  let y1 = y0 - f32(j1) + ${N(`internal simplex G3`)(g)};
  let z1 = z0 - f32(k1) + ${N(`internal simplex G3`)(g)};
  let x2 = x0 - f32(i2) + ${N(`internal simplex 2*G3`)(2*g)};
  let y2 = y0 - f32(j2) + ${N(`internal simplex 2*G3`)(2*g)};
  let z2 = z0 - f32(k2) + ${N(`internal simplex 2*G3`)(2*g)};
  let x3 = x0 - 1f + ${N(`internal simplex 3*G3`)(3*g)};
  let y3 = y0 - 1f + ${N(`internal simplex 3*G3`)(3*g)};
  let z3 = z0 - 1f + ${N(`internal simplex 3*G3`)(3*g)};
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
  var f1 = ${ee};
  var f2 = ${ee};
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
}`}]]);function ie(e){let t=new Set,n=e=>{if(t.has(e))return;let r=re.get(e);if(!r)throw Error(`internal: unknown WGSL library item "${e}"`);t.add(e);for(let e of r.deps)n(e)};for(let t of e)n(t);let r=[];for(let[e,n]of re)t.has(e)&&r.push(n.text);return r}var P=64,ae=`wgsl2`,oe=[`x`,`y`,`z`,`w`];function F(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}function se(e,t,n){return new O(`${e}: ${t} has tupleSize ${n}, but GPU kernels support tuple sizes 1 to 4; evaluate this field on the CPU instead, or split it into components`)}function ce(e,t,n){let r=1;for(let i of n)if(i!==1){if(r!==1&&r!==i)throw new O(`${t}: ${e}: incompatible tuple sizes ${r} and ${i}`);r=i}return r}var le=class{layout;lines=[];libRoots=new Set;usesSeed=!1;valueNumbers=new Map;bindings=new Map;helpers=new Map;helperTexts=[];helperCounters=new Map;varCounter=0;constructor(e,t){this.layout=e,t.forEach((t,n)=>{this.bindings.set(t,{name:t,varName:`in${n}`,binding:n+1,attr:e.attributes[t]})})}emit(e,t){let n=this.valueNumbers.get(e);if(n)return n;let r={ref:`v${this.varCounter++}`,size:t};return this.lines.push(`  let ${r.ref} = ${e};`),this.valueNumbers.set(e,r),r}binding(e){let t=this.bindings.get(e);if(!t)throw Error(`internal: attribute ${JSON.stringify(e)} was not pre-bound`);return t}boundAttrs(){return[...this.bindings.values()]}helper(e,t){let n=this.helpers.get(t);if(n)return n;let r=this.helperCounters.get(e)??0;this.helperCounters.set(e,r+1);let i=`pcg_${e}_${r}`;return this.helpers.set(t,i),this.helperTexts.push(t.replaceAll(`@NAME@`,i)),i}helperBlocks(){return this.helperTexts}};function ue(e,t){return e.size===t?e.ref:`vec${t}<f32>(${e.ref})`}function I(e){return e===1?`0f`:`vec${e}<f32>(0f)`}function L(e){return e===1?`1f`:`vec${e}<f32>(1f)`}function de(e){let t=Object.keys(e.attributes).sort();return t.length===0?`the layout declares no attributes`:`layout attributes: ${t.map(e=>JSON.stringify(e)).join(`, `)}`}function fe(e,t,n,r,i){let a=e.layout.attributes;if(!Object.hasOwn(a,n))throw new O(`${t}: ${i}attribute ${JSON.stringify(n)} is not in the kernel layout; ${de(e.layout)}`);let o=a[n];if(o.type===`string`)throw new O(`${t}: ${i}attribute ${JSON.stringify(n)} has type "string"; string attributes cannot be read as fields and are CPU-only — use a numeric or bool attribute`);if(r!==void 0&&o.tupleSize!==r)throw new O(`${t}: ${i}attribute ${JSON.stringify(n)}: expected tupleSize ${r}, got ${o.tupleSize} in the kernel layout`);if(o.tupleSize>4)throw se(t,`${i}attribute ${JSON.stringify(n)}`,o.tupleSize);return o}function R(e,t,n,r,i){let a=fe(e,t,n,r,i),o=e.binding(n),s=a.tupleSize,c=e=>a.type===`f32`?e:`f32(${e})`;if(s===1)return e.emit(c(`${o.varName}[i]`),1);let l=[];for(let e=0;e<s;e++)l.push(c(`${o.varName}[${z(s,e)}]`));return e.emit(`vec${s}<f32>(${l.join(`, `)})`,s)}function z(e,t){return e===1?`i`:t===0?`i * ${e}u`:`i * ${e}u + ${t}u`}var B=new Map;function pe(){return[...B.keys()].sort()}function me(e,t,n){let r=String(e.fn),i=B.get(r);if(!i)throw new O(`${t}: field fn "${r}" is not supported by the WGSL compiler; supported fns: ${pe().join(`, `)}`);return i(e,t,n)}function V(e,t,n){return typeof e==`number`?n.emit(k(e,t),1):Array.isArray(e)?he(e,t,n):me(e,t,n)}function he(e,t,n){let r=e.length;if(r>4)throw se(t,`constant`,r);if(r===1)return n.emit(k(e[0],t),1);let i=e.map(e=>k(e,t));return n.emit(`vec${r}<f32>(${i.join(`, `)})`,r)}function H(e){return e.args}B.set(`constant`,(e,t,n)=>{let r=e.value;return typeof r==`number`?n.emit(k(r,`${t}.value`),1):he(r,`${t}.value`,n)}),B.set(`attribute`,(e,t,n)=>{let r=e.name,i=e.tupleSize;return R(n,t,r,i,``)}),B.set(`position`,(e,t,n)=>R(n,t,`P`,3,`position reads `)),B.set(`index`,(e,t,n)=>n.emit(`f32(i)`,1)),B.set(`fraction`,(e,t,n)=>n.emit(`f32(i) / f32(max(params.count, 2u) - 1u)`,1)),B.set(`randomField`,(e,t,n)=>{let r=e.key,i=typeof r==`string`?m(r):(r??0)>>>0;n.usesSeed=!0,n.libRoots.add(`pcg_hash3`),n.libRoots.add(`pcg_hash4`),n.libRoots.add(`pcg_hash_float`);let a=`randomField's per-point identity reads `,o=fe(n,t,`P`,void 0,a);if(o.tupleSize<3)throw new O(`${t}: ${a}attribute "P" with x, y and z (tupleSize 3), got tupleSize ${o.tupleSize}`);let s=n.binding(`P`).varName,c=e=>{let t=`${s}[${z(o.tupleSize,e)}]`;return o.type===`f32`?`bitcast<u32>(${t})`:`bitcast<u32>(f32(${t}))`},l=`0u`,u=Object.hasOwn(n.layout.attributes,`seed`)?n.layout.attributes.seed:void 0;if(u!==void 0){if(u.tupleSize!==1||u.type!==`u32`&&u.type!==`i32`)throw new O(`${t}: ${a}the standard point attribute "seed" as a u32 or i32 scalar, but the layout has it as ${u.type}x${u.tupleSize}; this field resolves on the CPU instead`);let e=n.binding(`seed`).varName;l=u.type===`u32`?`${e}[i]`:`bitcast<u32>(${e}[i])`}let d=`pcg_hash4(${c(0)}, ${c(1)}, ${c(2)}, ${l})`;return n.emit(`pcg_hash_float(pcg_hash3(params.seed, ${j(i)}, ${d}))`,1)});function U(e,t,n){B.set(e,(r,i,a)=>{let o=H(r),s=[];for(let e=0;e<t;e++)s.push(V(o[e],`${i}.args[${e}]`,a));let c=ce(e,i,s.map(e=>e.size)),l=s.map(e=>ue(e,c));return a.emit(n(l,c),c)})}U(`add`,2,e=>`${e[0]} + ${e[1]}`),U(`sub`,2,e=>`${e[0]} - ${e[1]}`),U(`mul`,2,e=>`${e[0]} * ${e[1]}`),U(`div`,2,e=>`${e[0]} / ${e[1]}`),U(`min`,2,e=>`min(${e[0]}, ${e[1]})`),U(`max`,2,e=>`max(${e[0]}, ${e[1]})`),U(`abs`,1,e=>`abs(${e[0]})`),U(`floor`,1,e=>`floor(${e[0]})`),U(`sin`,1,e=>`sin(${e[0]})`),U(`cos`,1,e=>`cos(${e[0]})`),U(`tan`,1,e=>`tan(${e[0]})`),U(`asin`,1,e=>`asin(${e[0]})`),U(`acos`,1,e=>`acos(${e[0]})`),U(`atan`,1,e=>`atan(${e[0]})`),U(`atan2`,2,e=>`atan2(${e[0]}, ${e[1]})`),U(`clamp`,3,e=>`clamp(${e[0]}, ${e[1]}, ${e[2]})`),U(`lerp`,3,e=>`${e[0]} + (${e[1]} - ${e[0]}) * ${e[2]}`),U(`select`,3,(e,t)=>`select(${e[2]}, ${e[1]}, ${e[0]} != ${I(t)})`),U(`lt`,2,(e,t)=>`select(${I(t)}, ${L(t)}, ${e[0]} < ${e[1]})`),U(`le`,2,(e,t)=>`select(${I(t)}, ${L(t)}, ${e[0]} <= ${e[1]})`),U(`gt`,2,(e,t)=>`select(${I(t)}, ${L(t)}, ${e[0]} > ${e[1]})`),U(`ge`,2,(e,t)=>`select(${I(t)}, ${L(t)}, ${e[0]} >= ${e[1]})`),U(`eq`,2,(e,t)=>`select(${I(t)}, ${L(t)}, ${e[0]} == ${e[1]})`),U(`ne`,2,(e,t)=>`select(${I(t)}, ${L(t)}, ${e[0]} != ${e[1]})`),B.set(`remap`,(e,t,n)=>{let r=H(e).map((e,r)=>V(e,`${t}.args[${r}]`,n)),i=ce(`remap`,t,r.map(e=>e.size)),[a,o,s,c,l]=r.map(e=>ue(e,i)),u=n.emit(`${s} - ${o}`,i),d=I(i),f=n.emit(`select(${u.ref}, ${L(i)}, ${u.ref} == ${d})`,i);return n.emit(`select(${c} + ((${a} - ${o}) / ${f.ref}) * (${l} - ${c}), ${c}, ${u.ref} == ${d})`,i)}),B.set(`dot`,(e,t,n)=>{let r=H(e),i=V(r[0],`${t}.args[0]`,n),a=V(r[1],`${t}.args[1]`,n),o=ce(`dot`,t,[i.size,a.size]);return o===1?n.emit(`${i.ref} * ${a.ref}`,1):n.emit(`dot(${ue(i,o)}, ${ue(a,o)})`,1)}),B.set(`length`,(e,t,n)=>{let r=V(H(e)[0],`${t}.args[0]`,n);if(r.size===1)return n.emit(`abs(${r.ref})`,1);let i=n.emit(`dot(${r.ref}, ${r.ref})`,1);return n.emit(`sqrt(${i.ref})`,1)}),B.set(`normalize`,(e,t,n)=>{let r=V(H(e)[0],`${t}.args[0]`,n),i=r.size===1?n.emit(`${r.ref} * ${r.ref}`,1):n.emit(`dot(${r.ref}, ${r.ref})`,1),a=n.emit(`select(0f, 1f / sqrt(${i.ref}), ${i.ref} > 0f)`,1);return n.emit(`${r.ref} * ${a.ref}`,r.size)}),B.set(`vec`,(e,t,n)=>{let r=H(e).map((e,r)=>V(e,`${t}.args[${r}]`,n)),i=r.reduce((e,t)=>e+t.size,0);if(i>4)throw se(t,`vec result`,i);return r.length===1?r[0]:n.emit(`vec${i}<f32>(${r.map(e=>e.ref).join(`, `)})`,i)}),B.set(`component`,(e,t,n)=>{let r=V(H(e)[0],`${t}.args[0]`,n),i=e.index;if(i>=r.size)throw new O(`${t}: component: index ${i} out of range for tupleSize ${r.size}`);return r.size===1?r:n.emit(`${r.ref}.${oe[i]}`,1)}),B.set(`ramp`,(e,t,n)=>{let r=V(H(e)[0],`${t}.args[0]`,n);if(r.size!==1)throw new O(`${t}: ramp: input must be scalar, got tupleSize ${r.size}`);let i=e.stops,a=n.helper(`ramp`,ge(i,`${t}.stops`));return n.emit(`${a}(${r.ref})`,1)});function ge(e,t){let n=e=>k(e,t),r=e.length-1,i=[];i.push(`fn @NAME@(t: f32) -> f32 {`),i.push(`  if (t <= ${n(e[0][0])}) {`),i.push(`    return ${n(e[0][1])};`),i.push(`  }`),i.push(`  if (t >= ${n(e[r][0])}) {`),i.push(`    return ${n(e[r][1])};`),i.push(`  }`);let a=t=>{let r=e[t-1][0],i=e[t-1][1],a=e[t][0]-r,o=e[t][1]-i;return`${n(i)} + ${n(o)} * ((t - ${n(r)}) / ${n(a)})`};for(let t=1;t<r;t++)i.push(`  if (t <= ${n(e[t][0])}) {`),i.push(`    return ${a(t)};`),i.push(`  }`);return r>=1?i.push(`  return ${a(r)};`):i.push(`  return t;`),i.push(`}`),i.join(`
`)}var _e={valueNoise:r,perlinNoise:w,simplexNoise:u,worleyNoise:C},W={valueNoise:`pcg_value_noise`,perlinNoise:`pcg_perlin_noise`,simplexNoise:`pcg_simplex_noise`};function G(e){return e.opts??{}}function ve(e,t,n,r){let i=G(t),a=i.position===void 0?n:`${n}.opts.position`,o=i.position===void 0?R(r,n,`P`,3,`${e} position reads `):V(i.position,a,r);if(o.size!==3)throw new O(`${a}: ${e}: position field must have tupleSize 3, got ${o.size}`);let s=k(i.frequency??1,`${n}.opts.frequency`),[c,l,u]=i.offset??[0,0,0],d=`vec3<f32>(${k(c,`${n}.opts.offset`)}, ${k(l,`${n}.opts.offset`)}, ${k(u,`${n}.opts.offset`)})`;return r.emit(`${o.ref} * ${s} + ${d}`,3)}function ye(t,n){return e(_e[t],(n??0)>>>0)}function be(e,t,n,r){let[i,a]=n,o=a-i;return e.emit(`(${t.ref} - ${k(i,r)}) / ${k(o,r)}`,1)}for(let e of[`valueNoise`,`perlinNoise`,`simplexNoise`])B.set(e,(t,n,r)=>{let i=G(t),a=ve(e,t,n,r);r.libRoots.add(W[e]);let o=r.emit(`${W[e]}(${j(ye(e,i.seed))}, ${a.ref})`,1);return i.normalized===!0?be(r,o,y[e],`${n}.opts.normalized`):o});B.set(`worleyNoise`,(e,t,n)=>{let r=G(e),i=r.output??`f1`,a=r.exact===!0,o=ve(`worleyNoise`,e,t,n);n.libRoots.add(`pcg_worley`);let s=i!==`f1`,c=n.emit(`pcg_worley(${j(ye(`worleyNoise`,r.seed))}, ${o.ref}, ${a}, ${s})`,2),l=i===`f1`?n.emit(`${c.ref}.x`,1):i===`f2`?n.emit(`${c.ref}.y`,1):n.emit(`${c.ref}.y - ${c.ref}.x`,1);return r.normalized===!0?be(n,l,y.worleyNoise[i],`${t}.opts.normalized`):l});function xe(e){return e===`worleyNoise`?y.worleyNoise.f1:y[e]}function Se(e,t,n){return e===`worleyNoise`?`pcg_worley(${t}, ${n}, false, false).x`:`${W[e]}(${t}, ${n})`}B.set(`fbm`,(e,t,n)=>{let r=e.base,i=G(e),a=i.octaves??4,o=i.lacunarity??2,s=i.gain??.5,c=i.seed??0,l=i.frequency??1,[u,d,f]=i.offset??[0,0,0],m=i.position===void 0?t:`${t}.opts.position`,h=i.position===void 0?R(n,t,`P`,3,`fbm position reads `):V(i.position,m,n);if(h.size!==3)throw new O(`${m}: fbm: position field must have tupleSize 3, got ${h.size}`);let g=xe(r),_=[],v=[],y=[],b=1,x=l,S=0,C=0;for(let e=0;e<a;e++)_.push(j(ye(r,p(c,e)))),v.push(k(x,`${t}.opts.frequency`)),y.push(k(b,`${t}.opts.gain`)),S+=b>=0?b*g[0]:b*g[1],C+=b>=0?b*g[1]:b*g[0],b*=s,x*=o;n.libRoots.add(r===`worleyNoise`?`pcg_worley`:W[r]);let w=`vec3<f32>(${k(u,`${t}.opts.offset`)}, ${k(d,`${t}.opts.offset`)}, ${k(f,`${t}.opts.offset`)})`,T=`fn @NAME@(p: vec3<f32>) -> f32 {
  var seeds = array<u32, ${a}>(${_.join(`, `)});
  var freqs = array<f32, ${a}>(${v.join(`, `)});
  var amps = array<f32, ${a}>(${y.join(`, `)});
  var sum = 0f;
  for (var o = 0u; o < ${A(a)}; o++) {
    sum = sum + ${Se(r,`seeds[o]`,`p * freqs[o] + `+w)} * amps[o];
  }
  return sum;
}`,E=n.helper(`fbm`,T),D=n.emit(`${E}(${h.ref})`,1);if(i.normalized!==!0)return D;if(!(C>S))throw new O(`${t}: fbm: normalized: true needs a non-degenerate output range, got [${S}, ${C}] for this octaves/gain configuration`);return be(n,D,[S,C],`${t}.opts.normalized`)});var Ce=new Set([`valueNoise`,`perlinNoise`,`simplexNoise`,`worleyNoise`,`fbm`]);function we(e,t){if(!F(e))return;let n=e.fn;if(n===`attribute`){typeof e.name==`string`&&t.add(e.name);return}if(n===`position`){t.add(`P`);return}if(n===`randomField`){t.add(`P`),t.add(`seed`);return}if(typeof n==`string`&&Ce.has(n)){let n=e.opts;F(n)&&n.position!==void 0?we(n.position,t):t.add(`P`);return}let r=e.args;if(Array.isArray(r))for(let e of r)we(e,t)}var Te=new Set([`f32`,`i32`,`u32`,`bool`,`string`]);function Ee(e){if(!F(e)||!F(e.attributes))throw new O(`compileFieldSpec: layout must be { attributes: { name: { type, tupleSize } } }`);for(let[t,n]of Object.entries(e.attributes)){if(!F(n)||!Te.has(n.type))throw new O(`kernel layout attribute ${JSON.stringify(t)}: unknown type ${JSON.stringify(n?.type)}; valid types: "f32", "i32", "u32", "bool" ("string" is accepted but CPU-only)`);let e=n.tupleSize;if(typeof e!=`number`||!Number.isInteger(e)||e<1)throw new O(`kernel layout attribute ${JSON.stringify(t)}: tupleSize must be a positive integer, got ${String(e)}`)}}function De(e){return typeof e==`number`?{fn:`constant`,value:e}:Array.isArray(e)?{fn:`constant`,value:[...e]}:e}function Oe(e){return e.type===`bool`?`u32`:e.type}function ke(e,t){Ee(t);let n=De(e),r=_(n),i=new Set;we(n,i);let a=new le(t,[...i].filter(e=>Object.hasOwn(t.attributes,e)&&t.attributes[e].type!==`string`).sort()),o=`f32`,s=0,c=[],l=e=>{if(s=e.size,e.size===1)c.push(`  outBuf[i] = ${e.ref};`);else for(let t=0;t<e.size;t++)c.push(`  outBuf[${z(e.size,t)}] = ${e.ref}.${oe[t]};`)},u=n.fn===`attribute`?n.name:n.fn===`position`?`P`:void 0;if(n.fn===`index`)o=`u32`,s=1,c.push(`  outBuf[i] = i;`);else if(u!==void 0){let e=fe(a,`$`,u,n.fn===`position`?3:n.tupleSize,n.fn===`position`?`position reads `:``);if(e.type===`i32`||e.type===`u32`){o=e.type,s=e.tupleSize;let t=a.binding(u);for(let n=0;n<e.tupleSize;n++)c.push(`  outBuf[${z(e.tupleSize,n)}] = ${t.varName}[${z(e.tupleSize,n)}];`)}else l(me(n,`$`,a))}else l(me(n,`$`,a));let d=a.boundAttrs(),f=d.map(e=>({name:e.name,type:Oe(e.attr),tupleSize:e.attr.tupleSize,binding:e.binding})),p=d.length+1,m=[`@group(0) @binding(0) var<uniform> params: PcgParams;`];for(let e of d)m.push(`@group(0) @binding(${e.binding}) var<storage, read> ${e.varName}: array<${Oe(e.attr)}>; // attribute ${JSON.stringify(e.name)}: ${e.attr.type} tupleSize ${e.attr.tupleSize}`);m.push(`@group(0) @binding(${p}) var<storage, read_write> outBuf: array<${o}>;`);let h=[`// Generated by pcg-ts compileFieldSpec (WGSL field kernel).
// Dispatch: 1D, chunked; each chunk runs ceil(chunkElements / ${P}) workgroups of ${P}
// with element index i = chunkOffset + gid.x; one invocation per element.

struct PcgParams {
  count: u32,
  seed: u32,
  chunkOffset: u32,
}

${m.join(`
`)}`,...ie(a.libRoots),...a.helperBlocks(),`@compute @workgroup_size(${P})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x + params.chunkOffset;
  if (i >= params.count) {
    return;
  }
${[...a.lines,...c].join(`
`)}
}`],g=d.map(e=>`${JSON.stringify(e.name)}:${e.attr.type}x${e.attr.tupleSize}`).join(`,`);return{wgsl:`${h.join(`

`)}\n`,entryPoint:`main`,workgroupSize:P,outTupleSize:s,outType:o,inputs:f,bindings:{uniforms:0,output:p},usesSeed:a.usesSeed,key:`${ae}|spec=${r.key}|layout=[${g}]`}}var K={MAP_READ:1,COPY_SRC:4,COPY_DST:8,VERTEX:32,UNIFORM:64,STORAGE:128},Ae={READ:1},je=256;function Me(e){let t=je;for(;t<e;)t*=2;return t}var Ne=class{device;maxPooledBytes;free=new Map;meta=new Map;detachedSet=new WeakSet;idleBytes=0;idleCount=0;created=0;reused=0;destroyed=0;detachedTotal=0;detachedLive=0;detachedLiveBytes=0;constructor(e,t){this.device=e,this.maxPooledBytes=t}acquire(e,t){let n=Me(e),r=`${t}|${n}`,i=this.free.get(r)?.pop();if(i!==void 0)return this.idleBytes-=n,this.idleCount--,this.reused++,i;let a=this.device.createBuffer({size:n,usage:t});return this.meta.set(a,{key:r,bytes:n}),this.created++,a}release(e){let t=this.meta.get(e);if(t===void 0)throw this.detachedSet.has(e)?Error(`BufferPool.release: buffer was detached from this pool, so the pool no longer owns it and cannot reclaim it; destroy it through the DetachedBuffer that detach() returned (or the handle wrapping it) and stop releasing it`):Error(`BufferPool.release: buffer was not acquired from this pool`);if(this.idleBytes+t.bytes>this.maxPooledBytes){this.meta.delete(e),e.destroy(),this.destroyed++;return}let n=this.free.get(t.key);n===void 0&&(n=[],this.free.set(t.key,n)),n.push(e),this.idleBytes+=t.bytes,this.idleCount++}detach(e){let t=this.meta.get(e);if(t===void 0)throw Error(this.detachedSet.has(e)?`BufferPool.detach: buffer was already detached from this pool; ownership can only leave once — reuse the DetachedBuffer the first detach() returned`:`BufferPool.detach: buffer was not acquired from this pool`);this.meta.delete(e),this.detachedSet.add(e),this.detachedTotal++,this.detachedLive++,this.detachedLiveBytes+=t.bytes;let n=!1,r=this;return{buffer:e,bytes:t.bytes,get destroyed(){return n},destroy(){n||(n=!0,r.detachedLive--,r.detachedLiveBytes-=t.bytes,r.destroyed++,e.destroy())}}}get stats(){return{buffersCreated:this.created,buffersReused:this.reused,buffersDestroyed:this.destroyed,pooledBuffers:this.idleCount,pooledBytes:this.idleBytes,buffersDetached:this.detachedTotal,detachedBuffers:this.detachedLive,detachedBytes:this.detachedLiveBytes}}dispose(){for(let e of this.free.values())for(let t of e)this.meta.delete(t),t.destroy(),this.destroyed++;this.free.clear(),this.idleBytes=0,this.idleCount=0}},Pe=`apply2`;function Fe(e,t=!1){return e>0?16+e*16:t?16:12}var Ie=[`x`,`y`,`z`,`w`];function q(e,t,n){if(t.kind===`const`)return Re(t,n);let r=ze(e,t,n);return t.type===`f32`?r:`f32(${r})`}function Le(e,t,n){return t.kind===`const`?Re(t,n):ze(e,t,n)}function Re(e,t){let n=e.tupleSize===1?0:t;if(n>=4)throw Error(`apply codegen: constant slot ${e.slot} has no component ${n} (a uniform slot holds 4 f32 components)`);return`params.consts[${e.slot}].${Ie[n]}`}function ze(e,t,n){return t.tupleSize===1?`${e}[i]`:n===0?`${e}[i * ${t.tupleSize}u]`:`${e}[i * ${t.tupleSize}u + ${n}u]`}function Be(e,t,n){return t===1?`${e}[i]`:n===0?`${e}[i * ${t}u]`:`${e}[i * ${t}u + ${n}u]`}var J=class{items=[];add(e,t,n,r){return this.items.push({role:e,access:t,elem:n,comment:r}),`b${this.items.length}`}};function Y(e){let t=0;for(let n of e)if(n.kind===`const`){if(n.slot<0||n.slot>=4)throw Error(`apply codegen: constant slot ${n.slot} is out of range; an apply kernel carries at most 4 uniform constant slots (raise MAX_APPLY_CONST_SLOTS in applyKernels.ts if a new node kind needs more)`);t=Math.max(t,n.slot+1)}return t}function X(e,t,n,r,i,a=!1){let o=[`@group(0) @binding(0) var<uniform> params: PcgParams;`],s=[];n.forEach((e,t)=>{let n=t+1,r=e.access===`read`?`read`:`read_write`;o.push(`@group(0) @binding(${n}) var<storage, ${r}> b${n}: array<${e.elem}>; // ${e.comment}`),s.push({binding:n,role:e.role,access:e.access})});let c=a?`
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
`,entryPoint:`main`,workgroupSize:64,bindings:s,constSlots:t,uniformBytes:Fe(t,a),key:`${Pe}|${e}`}}var Z=e=>e.kind===`column`?`${e.type}x${e.tupleSize}`:`constx${e.tupleSize}@${e.slot}`;function Ve(e,t,n){let r=e.kind===`const`?`f32`:e.type,i=t===`f32`&&e.kind===`column`&&e.type===`f32`,a=i?`u32`:r,o=t===`bool`||i?`u32`:t,s=new J,c=e.kind===`column`?s.add(`value`,`read`,a,`value column ${Z(e)}`):``,l=e.kind===`column`?{...e,type:a}:e,u=s.add(`target`,`read_write`,o,`target attribute ${t} tupleSize ${n}`),d=(e,n)=>{switch(t){case`f32`:return i?e:n;case`i32`:return r===`f32`?`i32(${e})`:r===`i32`?e:`bitcast<i32>(${e})`;case`u32`:return r===`f32`?`u32(${e})`:r===`u32`?e:`bitcast<u32>(${e})`;default:return`select(0u, 1u, ${e} != ${r===`f32`?`0f`:r===`i32`?`0i`:`0u`})`}},f=[];for(let e=0;e<n;e++){let t=Le(c,l,e);f.push(`  ${Be(u,n,e)} = ${d(t,q(c,l,e))};`)}return X(`setAttribute|val=${Z(e)}|out=${t}x${n}`,Y([e]),s.items,[],f.join(`
`))}var Q={euler:`fn pcg_quat_from_euler_deg(r: vec3<f32>) -> vec4<f32> {
  let h = r * ${k(Math.PI/360,`internal PI/360`)};
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
}`};function He(e,t,n,r,i){let a=new J,o=e.kind===`column`?a.add(`translate`,`read`,e.type,`translate column ${Z(e)}`):``,s=t.kind===`column`?a.add(`rotateEuler`,`read`,t.type,`rotateEuler column ${Z(t)}`):``,c=n.kind===`column`?a.add(`scale`,`read`,n.type,`scale column ${Z(n)}`):``,l=a.add(`P`,`read_write`,`f32`,`attribute P: f32 tupleSize 3`),u=r?a.add(`rot`,`read_write`,`f32`,`attribute rot: f32 tupleSize 4`):``,d=i?a.add(`scaleAttr`,`read_write`,`f32`,`attribute scale: f32 tupleSize 3`):``,f=[];return f.push(`  let s = vec3<f32>(${[0,1,2].map(e=>q(c,n,e)).join(`, `)});`),f.push(`  let q = pcg_quat_from_euler_deg(vec3<f32>(${[0,1,2].map(e=>q(s,t,e)).join(`, `)}));`),f.push(`  let v = pcg_rotate_vec(q, vec3<f32>(${l}[i * 3u] * s.x, ${l}[i * 3u + 1u] * s.y, ${l}[i * 3u + 2u] * s.z));`),f.push(`  ${l}[i * 3u] = v.x + ${q(o,e,0)};`),f.push(`  ${l}[i * 3u + 1u] = v.y + ${q(o,e,1)};`),f.push(`  ${l}[i * 3u + 2u] = v.z + ${q(o,e,2)};`),r&&(f.push(`  let q2 = pcg_quat_mul(q, vec4<f32>(${u}[i * 4u], ${u}[i * 4u + 1u], ${u}[i * 4u + 2u], ${u}[i * 4u + 3u]));`),f.push(`  ${u}[i * 4u] = q2.x;`),f.push(`  ${u}[i * 4u + 1u] = q2.y;`),f.push(`  ${u}[i * 4u + 2u] = q2.z;`),f.push(`  ${u}[i * 4u + 3u] = q2.w;`)),i&&(f.push(`  ${d}[i * 3u] = ${d}[i * 3u] * s.x;`),f.push(`  ${d}[i * 3u + 1u] = ${d}[i * 3u + 1u] * s.y;`),f.push(`  ${d}[i * 3u + 2u] = ${d}[i * 3u + 2u] * s.z;`)),X(`transformPoints|t=${Z(e)}|r=${Z(t)}|s=${Z(n)}|rot=${+!!r}|scl=${+!!i}`,Y([e,t,n]),a.items,[Q.euler,Q.mul,Q.rotate],f.join(`
`))}function Ue(e,t){let n=new J,r=e.kind===`column`?n.add(`amount`,`read`,e.type,`amount column ${Z(e)}`):``,i=t?n.add(`seed`,`read`,`u32`,`attribute seed: u32 tupleSize 1`):``,a=n.add(`P`,`read_write`,`f32`,`attribute P: f32 tupleSize 3`),o=[];o.push(`  let ident = pcg_hash4(bitcast<u32>(${a}[i * 3u]), bitcast<u32>(${a}[i * 3u + 1u]), bitcast<u32>(${a}[i * 3u + 2u]), ${t?`${i}[i]`:`0u`});`);for(let t=0;t<3;t++){let n=t===0?`i * 3u`:`i * 3u + ${t}u`;o.push(`  ${a}[${n}] = ${a}[${n}] + (pcg_hash_float(pcg_hash3(params.seed, ident, ${t}u)) * 2f - 1f) * ${q(r,e,t)};`)}return X(`jitterPoints|a=${Z(e)}|s=${+!!t}`,Y([e]),n.items,ie([`pcg_hash3`,`pcg_hash4`,`pcg_hash_float`]),o.join(`
`))}var We={"+x":`f, u, -r`,"-x":`-f, u, r`,"+y":`-r, f, u`,"-y":`r, -f, u`,"+z":`r, u, f`,"-z":`-r, u, -f`};function Ge(e,t,n){let r=new J,i=e.kind===`column`?r.add(`direction`,`read`,e.type,`direction column ${Z(e)}`):``,a=r.add(`rot`,`read_write`,`f32`,`attribute rot: f32 tupleSize 4`),o=k(1e-12,`internal ORIENT_PARALLEL_EPS`),s=`  let d = vec3<f32>(${[0,1,2].map(t=>q(i,e,t)).join(`, `)});
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
  let q = pcg_quat_from_basis(${We[t]});
  ${a}[i * 4u] = q.x;
  ${a}[i * 4u + 1u] = q.y;
  ${a}[i * 4u + 2u] = q.z;
  ${a}[i * 4u + 3u] = q.w;`;return X(`orientAlongVector|d=${Z(e)}|axis=${t}|up=${Z(n)}`,Y([e,n]),r.items,[Q.basis],s)}function Ke(e,t,n=!1,r=0){let i=r>0;if(i&&r<3)throw Error(`apply codegen: spawnInstances colour source has tupleSize ${r}; components 0-2 are read as RGB, so it must be at least 3 (the planner rejects narrower columns before reaching codegen)`);let a=new J,o=a.add(`P`,`read`,`f32`,`attribute P: f32 tupleSize 3`),s=e?a.add(`rot`,`read`,`f32`,`attribute rot: f32 tupleSize 4`):``,c=t?a.add(`scaleAttr`,`read`,`f32`,`attribute scale: f32 tupleSize 3`):``,l=a.add(`transforms`,`read_write`,`f32`,`out: 16 f32 per instance`),u=n?a.add(`perm`,`read`,`u32`,`grouping permutation: source point index per slot`):``,d=i?a.add(`color`,`read`,`f32`,`colour source: f32 tupleSize ${r}`):``,f=i?a.add(`colors`,`read_write`,`f32`,`out: 4 f32 per instance (vec3 storage stride, [3] = 0 pad)`):``,p=n?`src`:`i`,m=e?`vec4<f32>(${s}[${p} * 4u], ${s}[${p} * 4u + 1u], ${s}[${p} * 4u + 2u], ${s}[${p} * 4u + 3u])`:`vec4<f32>(0f, 0f, 0f, 1f)`,h=t?`vec3<f32>(${c}[${p} * 3u], ${c}[${p} * 3u + 1u], ${c}[${p} * 3u + 2u])`:`vec3<f32>(1f, 1f, 1f)`,g=`${n?`  let src = ${u}[params.base + i];\n`:``}  let q = ${m};
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
  ${f}[co + 3u] = 0f;`:``}`;return X(`spawnInstances|rot=${+!!e}|scl=${+!!t}${n?`|perm`:``}${i?`|color=${r}`:``}`,0,a.items,[],g,n)}var qe=`webgpu`,Je=class{backend=qe;byteLength;detached;label;constructor(e,t,n){this.detached=e,this.byteLength=t,this.label=n}get disposed(){return this.detached.destroyed}get resource(){if(this.detached.destroyed)throw Error(`device transforms handle (${this.label}) was disposed; its GPU buffer is destroyed and cannot be bound. Dispose a handle only after the last frame that reads it, and re-cook to obtain a fresh one (device-resident outputs are never memoized, so every cook produces a new handle)`);return this.detached.buffer}dispose(){this.detached.destroy()}};function Ye(e,t,n){return new Je(e,t,n)}var Xe=65535;function Ze(e,t){let n=Xe*e;return Math.max(e,Math.floor(Math.min(t??n,n)/e)*e)}var Qe=16,$e=`pcg-resident-run/5`;function et(e){return e.format===$e?e:null}var tt={reason:`run-plan-failed`},nt=[`+x`,`-x`,`+y`,`-y`,`+z`,`-z`];function rt(e){if(typeof e!=`object`||!e||Array.isArray(e))return!1;let t=e;if(t.fn===`randomField`)return!0;let n=t.args;if(Array.isArray(n)){for(let e of n)if(rt(e))return!0}let r=t.opts;return!!(typeof r==`object`&&r&&rt(r.position))}function it(e){return Array.isArray(e)&&e.length===3&&e.every(e=>typeof e==`number`&&Number.isFinite(e))}var $=class extends Error{},at=[];function ot(e,t,n,r,i){let a=[...e].map(([e,t])=>({name:e,slot:t})),o=i||r===null,s=t.reduce((e,t)=>e+t.bytes,0),c=n.reduce((e,t)=>e+t,0),l=o?a.reduce((e,n)=>e+t[n.slot].bytes,0):0;return{writtenList:a,materialize:o,totalBytes:s+c+l+(r?.bytes??0)+(r?.colorBytes??0)+(r?.permBytes??0)}}function st(e,n,r,i){let a=n.count,o=new Map(Object.entries(n.attributes)),c=[],l=new Map,u=[],d=new Map,f=[],m=[],h=null,g=()=>Object.fromEntries(o),_=e=>{let t=l.get(e);if(t!==void 0)return t;let n=o.get(e);if(n===void 0||n.type===`string`)throw new $(e);let r=c.length;return c.push({bytes:a*n.tupleSize*4,init:`attr`,name:e}),l.set(e,r),r},v=(e,t,n)=>{let r=c.length;return c.push({bytes:a*t*4,init:n,name:e}),l.set(e,r),r},y=(e,t,n)=>{let r=o.get(e);if(r===void 0||r.type!==t||r.tupleSize!==n)throw new $(e)},b=(e,t,n)=>{let r=t.length/4;if(r>=4)throw Error(`resident run: "${n}" needs more than 4 uniform constant slots for its constant params; raise MAX_APPLY_CONST_SLOTS in applyKernels.ts (each slot costs 16 bytes of the per-chunk uniform and nothing else)`);for(let n=0;n<4;n++)t.push(n<e.length?e[n]:0);return{kind:`const`,tupleSize:e.length,slot:r}},x=(e,n,r,o,c,l)=>{let f;if(s(e)){let n=t(e,i);if(n===void 0)throw new $(`no spec`);if(d.has(`P`)&&rt(n))throw new $(`identity after P write`);f=n}else if(typeof e==`number`||Array.isArray(e)&&e.every(e=>typeof e==`number`)){let t=typeof e==`number`?[e]:e;if(t.length<1||t.length>4||o!==null&&!o.includes(t.length))throw new $(`tuple`);for(let e of t)if(!Number.isFinite(Math.fround(e)))throw new $(`f32 range`);return{param:b(t,c,l),ref:null}}else throw new $(`bad param value`);let p;try{p=ke(f,{attributes:g()})}catch{throw new $(`compile`)}if(p.inputs.length+1>8)throw new $(`buffers`);if(o!==null&&!o.includes(p.outTupleSize))throw new $(`tuple`);let m=u.length;return u.push(a*p.outTupleSize*4),r.push({key:p.key,wgsl:p.wgsl,entryPoint:p.entryPoint,workgroupSize:p.workgroupSize,seed:n,uniformsBinding:p.bindings.uniforms,uniformBytes:12,consts:at,perBatch:!1,bindings:[...p.inputs.map(e=>({binding:e.binding,ref:{kind:`slot`,index:_(e.name)}})),{binding:p.bindings.output,ref:{kind:`col`,index:m}}]}),{param:{kind:`column`,type:p.outType,tupleSize:p.outTupleSize},ref:{kind:`col`,index:m}}},S=(e,t,n,r,i=!1)=>{if(e.constSlots*4!==r.length)throw Error(`resident run: apply kernel "${e.key}" declares ${e.constSlots} constant slots but the planner allocated ${r.length/4}`);return{key:e.key,wgsl:e.wgsl,entryPoint:e.entryPoint,workgroupSize:e.workgroupSize,seed:t,uniformsBinding:0,uniformBytes:e.uniformBytes,consts:r,perBatch:i,bindings:e.bindings.map(e=>{let t=n[e.role];if(t===void 0)throw new $(`unmapped role ${e.role}`);return{binding:e.binding,ref:t}})}};try{for(let t of e){let n=t===e[e.length-1],r=[],i=[],s=t.params;switch(t.kind){case`setAttribute`:{let e=s.name,n=s.type,a=s.tupleSize;if(typeof e!=`string`)throw new $(`name`);if(n!==`f32`&&n!==`i32`&&n!==`u32`&&n!==`bool`)throw new $(`type`);if(typeof a!=`number`||!Number.isInteger(a)||a<1||a>4)throw new $(`tupleSize`);let c=typeof s.seed==`number`?s.seed:NaN,l=c===0?t.seed:p(t.seed,c),{param:u,ref:m}=x(s.value,l,r,a===1?[1]:[1,a],i,t.kind),h=v(e,a,`none`);o.set(e,{type:n,tupleSize:a}),d.set(e,h),f.push({op:`replace`,name:e,type:n,tupleSize:a});let g={target:{kind:`slot`,index:h}};m!==null&&(g.value=m),r.push(S(Ve(u,n,a),0,g,i));break}case`transformPoints`:{y(`P`,`f32`,3);let e=x(s.translate,t.seed,r,[1,3],i,t.kind),n=x(s.rotateEuler,t.seed,r,[1,3],i,t.kind),a=x(s.scale,t.seed,r,[1,3],i,t.kind),c=o.get(`rot`),l=c!==void 0&&c.type===`f32`&&c.tupleSize===4,u=o.get(`scale`),f=u!==void 0&&u.type===`f32`&&u.tupleSize===3,p=_(`P`);d.set(`P`,p);let m={P:{kind:`slot`,index:p}};if(e.ref!==null&&(m.translate=e.ref),n.ref!==null&&(m.rotateEuler=n.ref),a.ref!==null&&(m.scale=a.ref),l){let e=_(`rot`);d.set(`rot`,e),m.rot={kind:`slot`,index:e}}if(f){let e=_(`scale`);d.set(`scale`,e),m.scaleAttr={kind:`slot`,index:e}}r.push(S(He(e.param,n.param,a.param,l,f),0,m,i));break}case`jitterPoints`:{if(y(`P`,`f32`,3),d.has(`P`))throw new $(`identity after P write`);let e=typeof s.seed==`number`?s.seed:NaN,n=p(t.seed,e),a=x(s.amount,n,r,[1,3],i,t.kind),c=o.get(`seed`),l=c!==void 0;if(l&&(c.type!==`u32`||c.tupleSize!==1))throw new $(`seed attribute shape`);let u=_(`P`);d.set(`P`,u);let f={P:{kind:`slot`,index:u}};a.ref!==null&&(f.amount=a.ref),l&&(f.seed={kind:`slot`,index:_(`seed`)}),r.push(S(Ue(a.param,l),n,f,i));break}case`orientAlongVector`:{let e=s.axis;if(!nt.includes(e))throw new $(`axis`);if(!it(s.up))throw new $(`up`);let n=x(s.direction,t.seed,r,[1,3],i,t.kind),a=s.up,c=a[0]*a[0]+a[1]*a[1]+a[2]*a[2],l=c>0?1/Math.sqrt(c):0,u=[a[0]*l,a[1]*l,a[2]*l];for(let e of u)if(!Number.isFinite(Math.fround(e)))throw new $(`up range`);let p=b(u,i,t.kind),m=o.get(`rot`),h=m!==void 0&&m.type===`f32`&&m.tupleSize===4?_(`rot`):v(`rot`,4,`quat-default`);o.set(`rot`,{type:`f32`,tupleSize:4}),d.set(`rot`,h),f.push({op:`ensure-rot`});let g={rot:{kind:`slot`,index:h}};n.ref!==null&&(g.direction=n.ref),r.push(S(Ge(n.param,e,p),0,g,i));break}case`spawnInstances`:{if(!n)throw new $(`spawnInstances must be the run's last member`);let e=s.assetId;if(typeof e!=`string`||e===``)throw new $(`assetId`);if(y(`P`,`f32`,3),a>1048576)throw new $(`${a} instances over MAX_INSTANCES`);let t=s.assetAttr;if(t!==void 0&&typeof t!=`string`)throw new $(`assetAttr`);let c=t===void 0?``:t;if(c!==``){let e=o.get(c);if(e===void 0)throw new $(`assetAttr "${c}" not on the point domain`);if(e.type!==`string`)throw new $(`assetAttr "${c}" is ${e.type}, not string`)}let l=s.colorAttr;if(l!==void 0&&typeof l!=`string`)throw new $(`colorAttr`);let u=l===void 0?``:l,d=0;if(u!==``){let e=o.get(u);if(e===void 0)throw new $(`colorAttr "${u}" not on the point domain`);if(e.type!==`f32`||e.tupleSize<3)throw new $(`colorAttr "${u}" is ${e.type}x${e.tupleSize}`);d=e.tupleSize}let f=o.get(`rot`),p=f!==void 0&&f.type===`f32`&&f.tupleSize===4,m=o.get(`scale`),g=m!==void 0&&m.type===`f32`&&m.tupleSize===3,v={P:{kind:`slot`,index:_(`P`)},transforms:{kind:`out`}};p&&(v.rot={kind:`slot`,index:_(`rot`)}),g&&(v.scaleAttr={kind:`slot`,index:_(`scale`)});let b=c!==``;b&&(v.perm={kind:`perm`}),d>0&&(v.color={kind:`slot`,index:_(u)},v.colors={kind:`colorOut`}),r.push(S(Ke(p,g,b,d),0,v,i,b)),h={assetId:e,assetAttr:c,colorAttr:u,colorTupleSize:d,count:a,bytes:a*64,colorBytes:d>0?a*Qe:0,permBytes:b?a*4:0};break}default:throw new $(`unknown kind ${t.kind}`)}m.push({id:t.id,type:t.type,steps:r})}}catch(e){if(e instanceof $)return tt;throw e}let{writtenList:C,materialize:w,totalBytes:T}=ot(d,c,u,h,n.needsGeometry);return T>r?{reason:`run-too-large`}:{plan:{format:$e,count:a,members:m,slots:c,cols:u,written:C,layoutOps:f,materialize:w,instances:h,totalBytes:T}}}var ct={f32:Float32Array,i32:Int32Array,u32:Uint32Array};function lt(){return new Promise(e=>setTimeout(e,0))}async function ut(e,t,n,r){let{device:i,pool:a}=e,{geo:o,signal:s,budgetMs:c}=n,l=t.count;if(o.attrs.point.count!==l)throw Error(`resident run: plan was built for ${l} points but the input geometry has ${o.attrs.point.count}; plans are single-cook artifacts — re-plan for new inputs`);let u=()=>{if(s?.aborted)throw new x},d=[],f=(e,t)=>{let n=a.acquire(e,t);return d.push(n),n},p=new Set,m=[];try{let n=o.attrs.point,s=t.slots.map(e=>{let t=f(e.bytes,K.STORAGE|K.COPY_DST|K.COPY_SRC);if(e.init===`attr`){let r=n.require(e.name),a=e.bytes/4;if(r.data instanceof Uint8Array){let e=new Uint32Array(a);for(let t=0;t<a;t++)e[t]=r.data[t];i.queue.writeBuffer(t,0,e)}else i.queue.writeBuffer(t,0,r.data.subarray(0,a))}else if(e.init===`quat-default`){let n=new Float32Array(e.bytes/4);for(let e=3;e<n.length;e+=4)n[e]=1;i.queue.writeBuffer(t,0,n)}return t}),d=t.cols.map(e=>f(e,K.STORAGE|K.COPY_DST|K.COPY_SRC)),g=t.instances===null?void 0:S(o,{defaultAssetId:t.instances.assetId,...t.instances.assetAttr===``?{}:{assetAttr:t.instances.assetAttr}}),_=t.instances!==null&&t.instances.permBytes>0?f(t.instances.permBytes,K.STORAGE|K.COPY_DST):void 0;_!==void 0&&g!==void 0&&i.queue.writeBuffer(_,0,g.perm);let v=K.STORAGE|K.COPY_DST|K.COPY_SRC|K.VERTEX,y=g===void 0?[]:Array.from(g.counts,e=>f(e*64,v)),b=g===void 0||t.instances===null||t.instances.colorBytes===0?[]:Array.from(g.counts,e=>f(e*Qe,v)),x=(e,t)=>{if(e.kind===`slot`)return s[e.index];if(e.kind===`col`)return d[e.index];if(e.kind===`colorOut`){let e=b[t];if(e===void 0)throw Error(`resident run: a kernel binds a retained instance-colour buffer but the plan declares no colour output (plan and kernels disagree)`);return e}if(e.kind===`perm`){if(_===void 0)throw Error(`resident run: a kernel binds the grouping permutation but the plan declares no per-point asset attribute (plan and kernels disagree)`);return _}let n=y[t];if(n===void 0)throw Error(`resident run: a kernel binds a retained instance-transform buffer but the plan declares no instances output (plan and kernels disagree)`);return n},C=i.createCommandEncoder(),w=C.beginComputePass(),T=performance.now();for(let n of t.members){u();for(let t of n.steps){let n=e.getPipeline(t.key,t.wgsl,t.entryPoint,r);w.setPipeline(n);let a=Ze(t.workgroupSize,e.maxElementsPerDispatch),o=t.perBatch&&g!==void 0?Array.from(g.counts,(e,t)=>({batch:t,elements:e,base:g.offsets[t]})):[{batch:0,elements:l,base:0}];for(let e of o){r!==void 0&&r.dispatches++;let o=new ArrayBuffer(t.uniformBytes),s=new Uint8Array(o),c=new Uint32Array(o,0,t.uniformBytes>=16?4:3);c[0]=e.elements,c[1]=t.seed>>>0,t.perBatch&&(c[3]=e.base),t.consts.length>0&&new Float32Array(o,16,t.consts.length).set(t.consts);let l=Math.ceil(e.elements/a);for(let r=0;r<l;r++){let o=f(t.uniformBytes,K.UNIFORM|K.COPY_DST);c[2]=r*a,i.queue.writeBuffer(o,0,s);let l=i.createBindGroup({layout:n.getBindGroupLayout(0),entries:[{binding:t.uniformsBinding,resource:{buffer:o}},...t.bindings.map(t=>({binding:t.binding,resource:{buffer:x(t.ref,e.batch)}}))]}),u=Math.min(a,e.elements-r*a);w.setBindGroup(0,l),w.dispatchWorkgroups(Math.ceil(u/t.workgroupSize))}}}c!==void 0&&performance.now()-T>c&&(await lt(),u(),T=performance.now())}w.end();let E=[],D,O=t.materialize?t.written.reduce((e,n)=>e+t.slots[n.slot].bytes,0):0;if(O>0){D=f(O,K.COPY_DST|K.MAP_READ);let e=0;for(let n of t.written){let r=t.slots[n.slot].bytes;C.copyBufferToBuffer(s[n.slot],0,D,e,r),E.push(e),e+=r}}i.queue.submit([C.finish()]);let k;if(t.materialize){let e;if(D!==void 0){await D.mapAsync(Ae.READ,0,O);try{e=D.getMappedRange(0,O).slice(0)}finally{D.unmap()}}u(),k=h(o);let n=k.attrs.point;for(let e of t.layoutOps)if(e.op===`replace`)n.replace(e.name,e.type,e.tupleSize);else{let e=n.get(`rot`);(!e||e.type!==`f32`||e.tupleSize!==4)&&(e&&n.remove(`rot`),n.add(`rot`,`f32`,4,[0,0,0,1]))}t.written.forEach((t,r)=>{let i=n.require(t.name),a=l*i.tupleSize;if(e===void 0)throw Error(`resident run: readback missing for a written attribute`);if(i.data instanceof Uint8Array){let t=new Uint32Array(e,E[r],a);for(let e=0;e<a;e++)i.data[e]=t[e]}else{let n=ct[i.type];if(n===void 0)throw Error(`resident run: cannot materialize attribute "${t.name}" of type ${i.type}`);i.data.set(new n(e,E[r],a))}})}else u();let A;if(t.instances!==null){let e=t.instances.colorBytes>0;if(g===void 0||y.length!==g.order.length||b.length!==(e?g.order.length:0))throw Error(`resident run: the plan declares an instances output but the acquired transform buffers do not match the grouping (library bug: plan.instances, the grouping, and the acquired buffers must agree)`);let n=(e,t,n)=>{let r=a.detach(e);p.add(e);try{return Ye(r,t,n)}catch(e){throw r.destroy(),e}},r=[];for(let t=0;t<g.order.length;t++){let i=g.order[t],a=g.counts[t],o=n(y[t],a*64,`${a} instances of "${i}"`);if(m.push(o),!e){r.push({residency:`device`,assetId:i,count:a,transforms:o});continue}let s=n(b[t],a*Qe,`${a} instance colours of "${i}"`);m.push(s),r.push({residency:`device`,assetId:i,count:a,transforms:o,colors:s})}A=r}r!==void 0&&(r.residentRuns++,r.fusedNodes+=t.members.length,r.readbacksSaved+=t.members.length-+!!t.materialize);let j={};return k!==void 0&&(j.geo=k),A!==void 0&&(j.deviceBatches=A),j}catch(e){for(let e of m)e.dispose();throw e instanceof x?e:Error(`GpuFieldEvaluator: resident run failed (${t.members.length} fused nodes [${t.members.map(e=>`"${e.id}"`).join(`, `)}], ${l} points): ${e instanceof Error?e.message:String(e)}`,{cause:e})}finally{for(let e of d)p.has(e)||a.release(e)}}var dt=`gpu2`,ft=268435456,pt=[`spawnInstances`],mt={f32:Float32Array,i32:Int32Array,u32:Uint32Array},ht={f32:Float32Array,i32:Int32Array,u32:Uint32Array};function gt(e){let t=e=>e!==void 0&&e!==``?e:`?`;return[dt,t(e?.vendor),t(e?.architecture),t(e?.device),t(e?.description)].join(`|`)}function _t(e,t){return e!==void 0&&(e.fallbacks[t]=(e.fallbacks[t]??0)+1),null}var vt=class{cacheSalt;residentTerminals;acceptDerivedSpecs;device;kernels=new Map;pipelines=new Map;pool;maxElementsPerDispatch;maxResidentBytes;constructor(e,t={}){if(t.maxElementsPerDispatch!==void 0&&!Number.isFinite(t.maxElementsPerDispatch))throw Error(`GpuFieldEvaluator: maxElementsPerDispatch must be a finite number, got ${t.maxElementsPerDispatch}; leave it unset to use the device maximum`);this.device=e,this.cacheSalt=gt(t.adapterInfo??e.adapterInfo),this.pool=new Ne(e,t.maxPooledBytes??ft),this.maxElementsPerDispatch=t.maxElementsPerDispatch,this.maxResidentBytes=t.maxResidentBytes??536870912,this.residentTerminals=t.deviceInstances===!0?pt:[],this.acceptDerivedSpecs=b(t)}get pipelineCacheSize(){return this.pipelines.size}get poolStats(){return this.pool.stats}dispose(){this.pool.dispose()}chunkElements(e){let t=Xe*e.workgroupSize,n=Math.min(this.maxElementsPerDispatch??t,t);return Math.max(e.workgroupSize,Math.floor(n/e.workgroupSize)*e.workgroupSize)}resolveField(e,n,r){let i=t(e,this.acceptDerivedSpecs);if(i===void 0)return _t(r,v(e));let a=n.geo.attrs[n.domain],o={},s=[];for(let e of a.names().sort()){let t=a.get(e);t!==void 0&&(o[e]={type:t.type,tupleSize:t.tupleSize},s.push(`${JSON.stringify(e)}:${t.type}x${t.tupleSize}`))}let c=`${e.key.length}#${e.key}|${s.join(`,`)}`,l=this.kernels.get(c);if(l===void 0){try{l=ke(i,{attributes:o})}catch(e){l=e instanceof Error?e:Error(String(e))}this.kernels.set(c,l)}if(l instanceof Error)return _t(r,`compile-error`);if(l.inputs.length+1>8)return _t(r,`too-many-buffers`);let u=a.count;if(u===0)return Promise.resolve({data:new ht[l.outType](0),tupleSize:l.outTupleSize});let d=this.getPipeline(l.key,l.wgsl,l.entryPoint,r);return r!==void 0&&r.dispatches++,this.dispatch(e,n,l,d,u)}getPipeline(e,t,n,r){let i=this.pipelines.get(e);if(i!==void 0)return r!==void 0&&r.pipelineCacheHits++,i;let a=this.device.createShaderModule({code:t}),o=this.device.createComputePipeline({layout:`auto`,compute:{module:a,entryPoint:n}});return this.pipelines.set(e,o),r!==void 0&&r.pipelinesCompiled++,o}planRun(e,t,n){let r=st(e,t,this.maxResidentBytes,this.acceptDerivedSpecs);return`plan`in r?r.plan:(n!==void 0&&(n.fallbacks[r.reason]=(n.fallbacks[r.reason]??0)+1),null)}executeRun(e,t,n){let r=et(e);return r===null?Promise.reject(Error(`GpuFieldEvaluator.executeRun: plan was not produced by this library's planRun; pass the object returned by planRun on the same resolver`)):ut({device:this.device,pool:this.pool,maxElementsPerDispatch:this.maxElementsPerDispatch,getPipeline:(e,t,n,r)=>this.getPipeline(e,t,n,r)},r,t,n)}async dispatch(e,t,n,r,i){let a=this.device,o=[],s=(e,t)=>{let n=this.pool.acquire(e,t);return o.push(n),n};try{let e=this.chunkElements(n),o=Math.ceil(i/e),c=[],l=t.geo.attrs[t.domain];for(let e of n.inputs){let t=l.require(e.name),n=i*e.tupleSize,r;if(t.data instanceof Uint8Array){let e=new Uint32Array(n);for(let r=0;r<n;r++)e[r]=t.data[r];r=e}else r=t.data.subarray(0,n);let o=s(n*4,K.STORAGE|K.COPY_DST);a.queue.writeBuffer(o,0,r),c.push({binding:e.binding,resource:{buffer:o}})}let u=i*n.outTupleSize*4,d=s(u,K.STORAGE|K.COPY_SRC);c.push({binding:n.bindings.output,resource:{buffer:d}});let f=s(u,K.COPY_DST|K.MAP_READ),p=[];for(let l=0;l<o;l++){let o=s(12,K.UNIFORM|K.COPY_DST);a.queue.writeBuffer(o,0,new Uint32Array([i,t.seed>>>0,l*e])),p.push(a.createBindGroup({layout:r.getBindGroupLayout(0),entries:[{binding:n.bindings.uniforms,resource:{buffer:o}},...c]}))}let m=a.createCommandEncoder(),h=m.beginComputePass();h.setPipeline(r);for(let t=0;t<o;t++){let r=Math.min(e,i-t*e);h.setBindGroup(0,p[t]),h.dispatchWorkgroups(Math.ceil(r/n.workgroupSize))}h.end(),m.copyBufferToBuffer(d,0,f,0,u),a.queue.submit([m.finish()]),await f.mapAsync(Ae.READ,0,u);let g;try{g=f.getMappedRange(0,u).slice(0)}finally{f.unmap()}return{data:new mt[n.outType](g),tupleSize:n.outTupleSize}}catch(n){throw Error(`GpuFieldEvaluator: dispatch failed for field ${e.key} (${i} elements on the ${t.domain} domain): ${n instanceof Error?n.message:String(n)}`,{cause:n})}finally{for(let e of o)this.pool.release(e)}}};export{vt as t};