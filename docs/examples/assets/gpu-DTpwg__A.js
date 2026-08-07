import{Ci as e,Gi as t,Hi as n,Ji as r,Ki as i,Si as a,Ui as o,Vi as s,Wi as c,Xi as l,Zi as u,_i as d,bi as f,di as p,ei as m,fi as h,hi as g,ii as _,li as v,mi as y,ni as b,pi as x,qi as S,vi as C,xi as w}from"./fps-BoTsOt51.js";var T=class extends Error{constructor(e){super(e),this.name=`GpuCompileError`}};function E(e,t){let n=Math.fround(e);if(!Number.isFinite(n))throw new T(`${t}: value ${e} is not representable as a finite f32 (WGSL kernels compute in f32; keep magnitudes within ~3.4e38)`);return Object.is(n,-0)?`-0f`:`${String(n)}f`}function ee(e){return`${e>>>0}u`}function D(e){return`0x${(e>>>0).toString(16).padStart(8,`0`)}u`}var O=D,te=E(34028234663852886e22,`internal f32 max`);function k(e,t){let n=O(e);for(let e of t)n=`pcg_hash_mix(${n}, ${e})`;return`pcg_hash_finalize(${n})`}function ne(){let e=[];for(let t=0;t<12;t++){let n=e=>E(w[t*3+e],`internal GRAD3`);e.push(`  vec3<f32>(${n(0)}, ${n(1)}, ${n(2)}),`)}return`var<private> PCG_GRAD3: array<vec3<f32>, 12> = array<vec3<f32>, 12>(
${e.join(`
`)}
);`}var A=e=>t=>E(t,e),re=new Map([[`PCG_GRAD3`,{deps:[],text:ne()}],[`pcg_hash_mix`,{deps:[],text:`fn pcg_hash_mix(h_in: u32, value: u32) -> u32 {
  var k = value * ${O(t)};
  k = (k << 15u) | (k >> 17u);
  k = k * ${O(i)};
  var h = h_in ^ k;
  h = (h << 13u) | (h >> 19u);
  h = h * 5u + ${O(S)};
  return h;
}`}],[`pcg_hash_finalize`,{deps:[],text:`fn pcg_hash_finalize(h_in: u32) -> u32 {
  var h = h_in ^ (h_in >> 16u);
  h = h * ${O(n)};
  h = h ^ (h >> 13u);
  h = h * ${O(o)};
  h = h ^ (h >> 16u);
  return h;
}`}],[`pcg_hash3`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash3(a: u32, b: u32, c: u32) -> u32 {
  return ${k(l(3),[`a`,`b`,`c`])};
}`}],[`pcg_hash4`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash4(a: u32, b: u32, c: u32, d: u32) -> u32 {
  return ${k(l(4),[`a`,`b`,`c`,`d`])};
}`}],[`pcg_hash5`,{deps:[`pcg_hash_mix`,`pcg_hash_finalize`],text:`fn pcg_hash5(a: u32, b: u32, c: u32, d: u32, e: u32) -> u32 {
  return ${k(l(5),[`a`,`b`,`c`,`d`,`e`])};
}`}],[`pcg_hash_float`,{deps:[],text:`fn pcg_hash_float(h: u32) -> f32 {
  return f32(h >> 8u) * ${E(c,`internal hashFloat scale`)};
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
  return ${A(`internal PERLIN_SCALE`)(C)} * pcg_mix(
    pcg_mix(pcg_mix(n000, n100, u), pcg_mix(n010, n110, u), v),
    pcg_mix(pcg_mix(n001, n101, u), pcg_mix(n011, n111, u), v),
    w);
}`}],[`pcg_simplex_corner`,{deps:[`pcg_hash4`,`PCG_GRAD3`],text:`fn pcg_simplex_corner(seed: u32, i: i32, j: i32, k: i32, x: f32, y: f32, z: f32) -> f32 {
  let t = ${A(`internal simplex R2`)(y)} - x * x - y * y - z * z;
  if (t <= 0f) {
    return 0f;
  }
  let g = pcg_hash4(seed, bitcast<u32>(i), bitcast<u32>(j), bitcast<u32>(k)) % 12u;
  let t2 = t * t;
  return t2 * t2 * dot(PCG_GRAD3[g], vec3<f32>(x, y, z));
}`}],[`pcg_simplex_noise`,{deps:[`pcg_simplex_corner`],text:`fn pcg_simplex_noise(seed: u32, p: vec3<f32>) -> f32 {
  let s = (p.x + p.y + p.z) * ${A(`internal simplex F3`)(h)};
  let i = i32(floor(p.x + s));
  let j = i32(floor(p.y + s));
  let k = i32(floor(p.z + s));
  let t = f32(i + j + k) * ${A(`internal simplex G3`)(x)};
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
  let x1 = x0 - f32(i1) + ${A(`internal simplex G3`)(x)};
  let y1 = y0 - f32(j1) + ${A(`internal simplex G3`)(x)};
  let z1 = z0 - f32(k1) + ${A(`internal simplex G3`)(x)};
  let x2 = x0 - f32(i2) + ${A(`internal simplex 2*G3`)(2*x)};
  let y2 = y0 - f32(j2) + ${A(`internal simplex 2*G3`)(2*x)};
  let z2 = z0 - f32(k2) + ${A(`internal simplex 2*G3`)(2*x)};
  let x3 = x0 - 1f + ${A(`internal simplex 3*G3`)(3*x)};
  let y3 = y0 - 1f + ${A(`internal simplex 3*G3`)(3*x)};
  let z3 = z0 - 1f + ${A(`internal simplex 3*G3`)(3*x)};
  return ${A(`internal SIMPLEX_SCALE`)(72)} * (pcg_simplex_corner(seed, i, j, k, x0, y0, z0)
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
  var f1 = ${te};
  var f2 = ${te};
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
}`}]]);function ie(e){let t=new Set,n=e=>{if(t.has(e))return;let r=re.get(e);if(!r)throw Error(`internal: unknown WGSL library item "${e}"`);t.add(e);for(let e of r.deps)n(e)};for(let t of e)n(t);let r=[];for(let[e,n]of re)t.has(e)&&r.push(n.text);return r}var j=64,ae=`wgsl2`,oe=[`x`,`y`,`z`,`w`];function M(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}function N(e,t,n){return new T(`${e}: ${t} has tupleSize ${n}, but GPU kernels support tuple sizes 1 to 4; evaluate this field on the CPU instead, or split it into components`)}function se(e,t,n){let r=1;for(let i of n)if(i!==1){if(r!==1&&r!==i)throw new T(`${t}: ${e}: incompatible tuple sizes ${r} and ${i}`);r=i}return r}var ce=class{layout;lines=[];libRoots=new Set;usesSeed=!1;valueNumbers=new Map;bindings=new Map;helpers=new Map;helperTexts=[];helperCounters=new Map;varCounter=0;constructor(e,t){this.layout=e,t.forEach((t,n)=>{this.bindings.set(t,{name:t,varName:`in${n}`,binding:n+1,attr:e.attributes[t]})})}emit(e,t){let n=this.valueNumbers.get(e);if(n)return n;let r={ref:`v${this.varCounter++}`,size:t};return this.lines.push(`  let ${r.ref} = ${e};`),this.valueNumbers.set(e,r),r}binding(e){let t=this.bindings.get(e);if(!t)throw Error(`internal: attribute ${JSON.stringify(e)} was not pre-bound`);return t}boundAttrs(){return[...this.bindings.values()]}helper(e,t){let n=this.helpers.get(t);if(n)return n;let r=this.helperCounters.get(e)??0;this.helperCounters.set(e,r+1);let i=`pcg_${e}_${r}`;return this.helpers.set(t,i),this.helperTexts.push(t.replaceAll(`@NAME@`,i)),i}helperBlocks(){return this.helperTexts}};function P(e,t){return e.size===t?e.ref:`vec${t}<f32>(${e.ref})`}function F(e){return e===1?`0f`:`vec${e}<f32>(0f)`}function I(e){return e===1?`1f`:`vec${e}<f32>(1f)`}function le(e){let t=Object.keys(e.attributes).sort();return t.length===0?`the layout declares no attributes`:`layout attributes: ${t.map(e=>JSON.stringify(e)).join(`, `)}`}function ue(e,t,n,r,i){let a=e.layout.attributes;if(!Object.hasOwn(a,n))throw new T(`${t}: ${i}attribute ${JSON.stringify(n)} is not in the kernel layout; ${le(e.layout)}`);let o=a[n];if(o.type===`string`)throw new T(`${t}: ${i}attribute ${JSON.stringify(n)} has type "string"; string attributes cannot be read as fields and are CPU-only — use a numeric or bool attribute`);if(r!==void 0&&o.tupleSize!==r)throw new T(`${t}: ${i}attribute ${JSON.stringify(n)}: expected tupleSize ${r}, got ${o.tupleSize} in the kernel layout`);if(o.tupleSize>4)throw N(t,`${i}attribute ${JSON.stringify(n)}`,o.tupleSize);return o}function L(e,t,n,r,i){let a=ue(e,t,n,r,i),o=e.binding(n),s=a.tupleSize,c=e=>a.type===`f32`?e:`f32(${e})`;if(s===1)return e.emit(c(`${o.varName}[i]`),1);let l=[];for(let e=0;e<s;e++)l.push(c(`${o.varName}[${R(s,e)}]`));return e.emit(`vec${s}<f32>(${l.join(`, `)})`,s)}function R(e,t){return e===1?`i`:t===0?`i * ${e}u`:`i * ${e}u + ${t}u`}var z=new Map;function de(){return[...z.keys()].sort()}function fe(e,t,n){let r=String(e.fn),i=z.get(r);if(!i)throw new T(`${t}: field fn "${r}" is not supported by the WGSL compiler; supported fns: ${de().join(`, `)}`);return i(e,t,n)}function B(e,t,n){return typeof e==`number`?n.emit(E(e,t),1):Array.isArray(e)?pe(e,t,n):fe(e,t,n)}function pe(e,t,n){let r=e.length;if(r>4)throw N(t,`constant`,r);if(r===1)return n.emit(E(e[0],t),1);let i=e.map(e=>E(e,t));return n.emit(`vec${r}<f32>(${i.join(`, `)})`,r)}function V(e){return e.args}z.set(`constant`,(e,t,n)=>{let r=e.value;return typeof r==`number`?n.emit(E(r,`${t}.value`),1):pe(r,`${t}.value`,n)}),z.set(`attribute`,(e,t,n)=>{let r=e.name,i=e.tupleSize;return L(n,t,r,i,``)}),z.set(`position`,(e,t,n)=>L(n,t,`P`,3,`position reads `)),z.set(`index`,(e,t,n)=>n.emit(`f32(i)`,1)),z.set(`randomField`,(e,t,n)=>{let r=e.key,i=typeof r==`string`?u(r):(r??0)>>>0;return n.usesSeed=!0,n.libRoots.add(`pcg_hash3`),n.libRoots.add(`pcg_hash_float`),n.emit(`pcg_hash_float(pcg_hash3(params.seed, ${D(i)}, i))`,1)});function H(e,t,n){z.set(e,(r,i,a)=>{let o=V(r),s=[];for(let e=0;e<t;e++)s.push(B(o[e],`${i}.args[${e}]`,a));let c=se(e,i,s.map(e=>e.size)),l=s.map(e=>P(e,c));return a.emit(n(l,c),c)})}H(`add`,2,e=>`${e[0]} + ${e[1]}`),H(`sub`,2,e=>`${e[0]} - ${e[1]}`),H(`mul`,2,e=>`${e[0]} * ${e[1]}`),H(`div`,2,e=>`${e[0]} / ${e[1]}`),H(`min`,2,e=>`min(${e[0]}, ${e[1]})`),H(`max`,2,e=>`max(${e[0]}, ${e[1]})`),H(`abs`,1,e=>`abs(${e[0]})`),H(`floor`,1,e=>`floor(${e[0]})`),H(`sin`,1,e=>`sin(${e[0]})`),H(`cos`,1,e=>`cos(${e[0]})`),H(`tan`,1,e=>`tan(${e[0]})`),H(`asin`,1,e=>`asin(${e[0]})`),H(`acos`,1,e=>`acos(${e[0]})`),H(`atan`,1,e=>`atan(${e[0]})`),H(`atan2`,2,e=>`atan2(${e[0]}, ${e[1]})`),H(`clamp`,3,e=>`clamp(${e[0]}, ${e[1]}, ${e[2]})`),H(`lerp`,3,e=>`${e[0]} + (${e[1]} - ${e[0]}) * ${e[2]}`),H(`select`,3,(e,t)=>`select(${e[2]}, ${e[1]}, ${e[0]} != ${F(t)})`),H(`lt`,2,(e,t)=>`select(${F(t)}, ${I(t)}, ${e[0]} < ${e[1]})`),H(`le`,2,(e,t)=>`select(${F(t)}, ${I(t)}, ${e[0]} <= ${e[1]})`),H(`gt`,2,(e,t)=>`select(${F(t)}, ${I(t)}, ${e[0]} > ${e[1]})`),H(`ge`,2,(e,t)=>`select(${F(t)}, ${I(t)}, ${e[0]} >= ${e[1]})`),H(`eq`,2,(e,t)=>`select(${F(t)}, ${I(t)}, ${e[0]} == ${e[1]})`),z.set(`remap`,(e,t,n)=>{let r=V(e).map((e,r)=>B(e,`${t}.args[${r}]`,n)),i=se(`remap`,t,r.map(e=>e.size)),[a,o,s,c,l]=r.map(e=>P(e,i)),u=n.emit(`${s} - ${o}`,i),d=F(i),f=n.emit(`select(${u.ref}, ${I(i)}, ${u.ref} == ${d})`,i);return n.emit(`select(${c} + ((${a} - ${o}) / ${f.ref}) * (${l} - ${c}), ${c}, ${u.ref} == ${d})`,i)}),z.set(`dot`,(e,t,n)=>{let r=V(e),i=B(r[0],`${t}.args[0]`,n),a=B(r[1],`${t}.args[1]`,n),o=se(`dot`,t,[i.size,a.size]);return o===1?n.emit(`${i.ref} * ${a.ref}`,1):n.emit(`dot(${P(i,o)}, ${P(a,o)})`,1)}),z.set(`length`,(e,t,n)=>{let r=B(V(e)[0],`${t}.args[0]`,n);if(r.size===1)return n.emit(`abs(${r.ref})`,1);let i=n.emit(`dot(${r.ref}, ${r.ref})`,1);return n.emit(`sqrt(${i.ref})`,1)}),z.set(`normalize`,(e,t,n)=>{let r=B(V(e)[0],`${t}.args[0]`,n),i=r.size===1?n.emit(`${r.ref} * ${r.ref}`,1):n.emit(`dot(${r.ref}, ${r.ref})`,1),a=n.emit(`select(0f, 1f / sqrt(${i.ref}), ${i.ref} > 0f)`,1);return n.emit(`${r.ref} * ${a.ref}`,r.size)}),z.set(`vec`,(e,t,n)=>{let r=V(e).map((e,r)=>B(e,`${t}.args[${r}]`,n)),i=r.reduce((e,t)=>e+t.size,0);if(i>4)throw N(t,`vec result`,i);return r.length===1?r[0]:n.emit(`vec${i}<f32>(${r.map(e=>e.ref).join(`, `)})`,i)}),z.set(`component`,(e,t,n)=>{let r=B(V(e)[0],`${t}.args[0]`,n),i=e.index;if(i>=r.size)throw new T(`${t}: component: index ${i} out of range for tupleSize ${r.size}`);return r.size===1?r:n.emit(`${r.ref}.${oe[i]}`,1)}),z.set(`ramp`,(e,t,n)=>{let r=B(V(e)[0],`${t}.args[0]`,n);if(r.size!==1)throw new T(`${t}: ramp: input must be scalar, got tupleSize ${r.size}`);let i=e.stops,a=n.helper(`ramp`,me(i,`${t}.stops`));return n.emit(`${a}(${r.ref})`,1)});function me(e,t){let n=e=>E(e,t),r=e.length-1,i=[];i.push(`fn @NAME@(t: f32) -> f32 {`),i.push(`  if (t <= ${n(e[0][0])}) {`),i.push(`    return ${n(e[0][1])};`),i.push(`  }`),i.push(`  if (t >= ${n(e[r][0])}) {`),i.push(`    return ${n(e[r][1])};`),i.push(`  }`);let a=t=>{let r=e[t-1][0],i=e[t-1][1],a=e[t][0]-r,o=e[t][1]-i;return`${n(i)} + ${n(o)} * ((t - ${n(r)}) / ${n(a)})`};for(let t=1;t<r;t++)i.push(`  if (t <= ${n(e[t][0])}) {`),i.push(`    return ${a(t)};`),i.push(`  }`);return r>=1?i.push(`  return ${a(r)};`):i.push(`  return t;`),i.push(`}`),i.join(`
`)}var he={valueNoise:f,perlinNoise:d,simplexNoise:g,worleyNoise:p},U={valueNoise:`pcg_value_noise`,perlinNoise:`pcg_perlin_noise`,simplexNoise:`pcg_simplex_noise`};function W(e){return e.opts??{}}function ge(e,t,n,r){let i=W(t),a=i.position===void 0?n:`${n}.opts.position`,o=i.position===void 0?L(r,n,`P`,3,`${e} position reads `):B(i.position,a,r);if(o.size!==3)throw new T(`${a}: ${e}: position field must have tupleSize 3, got ${o.size}`);let s=E(i.frequency??1,`${n}.opts.frequency`),[c,l,u]=i.offset??[0,0,0],d=`vec3<f32>(${E(c,`${n}.opts.offset`)}, ${E(l,`${n}.opts.offset`)}, ${E(u,`${n}.opts.offset`)})`;return r.emit(`${o.ref} * ${s} + ${d}`,3)}function _e(t,n){return e(he[t],(n??0)>>>0)}function ve(e,t,n,r){let[i,a]=n,o=a-i;return e.emit(`(${t.ref} - ${E(i,r)}) / ${E(o,r)}`,1)}for(let e of[`valueNoise`,`perlinNoise`,`simplexNoise`])z.set(e,(t,n,r)=>{let i=W(t),o=ge(e,t,n,r);r.libRoots.add(U[e]);let s=r.emit(`${U[e]}(${D(_e(e,i.seed))}, ${o.ref})`,1);return i.normalized===!0?ve(r,s,a[e],`${n}.opts.normalized`):s});z.set(`worleyNoise`,(e,t,n)=>{let r=W(e),i=r.output??`f1`,o=r.exact===!0,s=ge(`worleyNoise`,e,t,n);n.libRoots.add(`pcg_worley`);let c=i!==`f1`,l=n.emit(`pcg_worley(${D(_e(`worleyNoise`,r.seed))}, ${s.ref}, ${o}, ${c})`,2),u=i===`f1`?n.emit(`${l.ref}.x`,1):i===`f2`?n.emit(`${l.ref}.y`,1):n.emit(`${l.ref}.y - ${l.ref}.x`,1);return r.normalized===!0?ve(n,u,a.worleyNoise[i],`${t}.opts.normalized`):u});function ye(e){return e===`worleyNoise`?a.worleyNoise.f1:a[e]}function be(e,t,n){return e===`worleyNoise`?`pcg_worley(${t}, ${n}, false, false).x`:`${U[e]}(${t}, ${n})`}z.set(`fbm`,(e,t,n)=>{let i=e.base,a=W(e),o=a.octaves??4,s=a.lacunarity??2,c=a.gain??.5,l=a.seed??0,u=a.frequency??1,[d,f,p]=a.offset??[0,0,0],m=a.position===void 0?t:`${t}.opts.position`,h=a.position===void 0?L(n,t,`P`,3,`fbm position reads `):B(a.position,m,n);if(h.size!==3)throw new T(`${m}: fbm: position field must have tupleSize 3, got ${h.size}`);let g=ye(i),_=[],v=[],y=[],b=1,x=u,S=0,C=0;for(let e=0;e<o;e++)_.push(D(_e(i,r(l,e)))),v.push(E(x,`${t}.opts.frequency`)),y.push(E(b,`${t}.opts.gain`)),S+=b>=0?b*g[0]:b*g[1],C+=b>=0?b*g[1]:b*g[0],b*=c,x*=s;n.libRoots.add(i===`worleyNoise`?`pcg_worley`:U[i]);let w=`vec3<f32>(${E(d,`${t}.opts.offset`)}, ${E(f,`${t}.opts.offset`)}, ${E(p,`${t}.opts.offset`)})`,O=`fn @NAME@(p: vec3<f32>) -> f32 {
  var seeds = array<u32, ${o}>(${_.join(`, `)});
  var freqs = array<f32, ${o}>(${v.join(`, `)});
  var amps = array<f32, ${o}>(${y.join(`, `)});
  var sum = 0f;
  for (var o = 0u; o < ${ee(o)}; o++) {
    sum = sum + ${be(i,`seeds[o]`,`p * freqs[o] + `+w)} * amps[o];
  }
  return sum;
}`,te=n.helper(`fbm`,O),k=n.emit(`${te}(${h.ref})`,1);if(a.normalized!==!0)return k;if(!(C>S))throw new T(`${t}: fbm: normalized: true needs a non-degenerate output range, got [${S}, ${C}] for this octaves/gain configuration`);return ve(n,k,[S,C],`${t}.opts.normalized`)});var xe=new Set([`valueNoise`,`perlinNoise`,`simplexNoise`,`worleyNoise`,`fbm`]);function G(e,t){if(!M(e))return;let n=e.fn;if(n===`attribute`){typeof e.name==`string`&&t.add(e.name);return}if(n===`position`){t.add(`P`);return}if(typeof n==`string`&&xe.has(n)){let n=e.opts;M(n)&&n.position!==void 0?G(n.position,t):t.add(`P`);return}let r=e.args;if(Array.isArray(r))for(let e of r)G(e,t)}var Se=new Set([`f32`,`i32`,`u32`,`bool`,`string`]);function Ce(e){if(!M(e)||!M(e.attributes))throw new T(`compileFieldSpec: layout must be { attributes: { name: { type, tupleSize } } }`);for(let[t,n]of Object.entries(e.attributes)){if(!M(n)||!Se.has(n.type))throw new T(`kernel layout attribute ${JSON.stringify(t)}: unknown type ${JSON.stringify(n?.type)}; valid types: "f32", "i32", "u32", "bool" ("string" is accepted but CPU-only)`);let e=n.tupleSize;if(typeof e!=`number`||!Number.isInteger(e)||e<1)throw new T(`kernel layout attribute ${JSON.stringify(t)}: tupleSize must be a positive integer, got ${String(e)}`)}}function we(e){return typeof e==`number`?{fn:`constant`,value:e}:Array.isArray(e)?{fn:`constant`,value:[...e]}:e}function Te(e){return e.type===`bool`?`u32`:e.type}function Ee(e,t){Ce(t);let n=we(e),r=b(n),i=new Set;G(n,i);let a=new ce(t,[...i].filter(e=>Object.hasOwn(t.attributes,e)&&t.attributes[e].type!==`string`).sort()),o=`f32`,s=0,c=[],l=e=>{if(s=e.size,e.size===1)c.push(`  outBuf[i] = ${e.ref};`);else for(let t=0;t<e.size;t++)c.push(`  outBuf[${R(e.size,t)}] = ${e.ref}.${oe[t]};`)},u=n.fn===`attribute`?n.name:n.fn===`position`?`P`:void 0;if(n.fn===`index`)o=`u32`,s=1,c.push(`  outBuf[i] = i;`);else if(u!==void 0){let e=ue(a,`$`,u,n.fn===`position`?3:n.tupleSize,n.fn===`position`?`position reads `:``);if(e.type===`i32`||e.type===`u32`){o=e.type,s=e.tupleSize;let t=a.binding(u);for(let n=0;n<e.tupleSize;n++)c.push(`  outBuf[${R(e.tupleSize,n)}] = ${t.varName}[${R(e.tupleSize,n)}];`)}else l(fe(n,`$`,a))}else l(fe(n,`$`,a));let d=a.boundAttrs(),f=d.map(e=>({name:e.name,type:Te(e.attr),tupleSize:e.attr.tupleSize,binding:e.binding})),p=d.length+1,m=[`@group(0) @binding(0) var<uniform> params: PcgParams;`];for(let e of d)m.push(`@group(0) @binding(${e.binding}) var<storage, read> ${e.varName}: array<${Te(e.attr)}>; // attribute ${JSON.stringify(e.name)}: ${e.attr.type} tupleSize ${e.attr.tupleSize}`);m.push(`@group(0) @binding(${p}) var<storage, read_write> outBuf: array<${o}>;`);let h=[`// Generated by pcg-ts compileFieldSpec (WGSL field kernel).
// Dispatch: 1D, chunked; each chunk runs ceil(chunkElements / ${j}) workgroups of ${j}
// with element index i = chunkOffset + gid.x; one invocation per element.

struct PcgParams {
  count: u32,
  seed: u32,
  chunkOffset: u32,
}

${m.join(`
`)}`,...ie(a.libRoots),...a.helperBlocks(),`@compute @workgroup_size(${j})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x + params.chunkOffset;
  if (i >= params.count) {
    return;
  }
${[...a.lines,...c].join(`
`)}
}`],g=d.map(e=>`${JSON.stringify(e.name)}:${e.attr.type}x${e.attr.tupleSize}`).join(`,`);return{wgsl:`${h.join(`

`)}\n`,entryPoint:`main`,workgroupSize:j,outTupleSize:s,outType:o,inputs:f,bindings:{uniforms:0,output:p},usesSeed:a.usesSeed,key:`${ae}|spec=${r.key}|layout=[${g}]`}}var K={MAP_READ:1,COPY_SRC:4,COPY_DST:8,VERTEX:32,UNIFORM:64,STORAGE:128},De={READ:1},Oe=256;function ke(e){let t=Oe;for(;t<e;)t*=2;return t}var Ae=class{device;maxPooledBytes;free=new Map;meta=new Map;detachedSet=new WeakSet;idleBytes=0;idleCount=0;created=0;reused=0;destroyed=0;detachedTotal=0;detachedLive=0;detachedLiveBytes=0;constructor(e,t){this.device=e,this.maxPooledBytes=t}acquire(e,t){let n=ke(e),r=`${t}|${n}`,i=this.free.get(r)?.pop();if(i!==void 0)return this.idleBytes-=n,this.idleCount--,this.reused++,i;let a=this.device.createBuffer({size:n,usage:t});return this.meta.set(a,{key:r,bytes:n}),this.created++,a}release(e){let t=this.meta.get(e);if(t===void 0)throw this.detachedSet.has(e)?Error(`BufferPool.release: buffer was detached from this pool, so the pool no longer owns it and cannot reclaim it; destroy it through the DetachedBuffer that detach() returned (or the handle wrapping it) and stop releasing it`):Error(`BufferPool.release: buffer was not acquired from this pool`);if(this.idleBytes+t.bytes>this.maxPooledBytes){this.meta.delete(e),e.destroy(),this.destroyed++;return}let n=this.free.get(t.key);n===void 0&&(n=[],this.free.set(t.key,n)),n.push(e),this.idleBytes+=t.bytes,this.idleCount++}detach(e){let t=this.meta.get(e);if(t===void 0)throw Error(this.detachedSet.has(e)?`BufferPool.detach: buffer was already detached from this pool; ownership can only leave once — reuse the DetachedBuffer the first detach() returned`:`BufferPool.detach: buffer was not acquired from this pool`);this.meta.delete(e),this.detachedSet.add(e),this.detachedTotal++,this.detachedLive++,this.detachedLiveBytes+=t.bytes;let n=!1,r=this;return{buffer:e,bytes:t.bytes,get destroyed(){return n},destroy(){n||(n=!0,r.detachedLive--,r.detachedLiveBytes-=t.bytes,r.destroyed++,e.destroy())}}}get stats(){return{buffersCreated:this.created,buffersReused:this.reused,buffersDestroyed:this.destroyed,pooledBuffers:this.idleCount,pooledBytes:this.idleBytes,buffersDetached:this.detachedTotal,detachedBuffers:this.detachedLive,detachedBytes:this.detachedLiveBytes}}dispose(){for(let e of this.free.values())for(let t of e)this.meta.delete(t),t.destroy(),this.destroyed++;this.free.clear(),this.idleBytes=0,this.idleCount=0}},je=`apply2`;function Me(e){return e===0?12:16+e*16}var Ne=[`x`,`y`,`z`,`w`];function q(e,t,n){if(t.kind===`const`)return Fe(t,n);let r=Ie(e,t,n);return t.type===`f32`?r:`f32(${r})`}function Pe(e,t,n){return t.kind===`const`?Fe(t,n):Ie(e,t,n)}function Fe(e,t){let n=e.tupleSize===1?0:t;if(n>=4)throw Error(`apply codegen: constant slot ${e.slot} has no component ${n} (a uniform slot holds 4 f32 components)`);return`params.consts[${e.slot}].${Ne[n]}`}function Ie(e,t,n){return t.tupleSize===1?`${e}[i]`:n===0?`${e}[i * ${t.tupleSize}u]`:`${e}[i * ${t.tupleSize}u + ${n}u]`}function Le(e,t,n){return t===1?`${e}[i]`:n===0?`${e}[i * ${t}u]`:`${e}[i * ${t}u + ${n}u]`}var J=class{items=[];add(e,t,n,r){return this.items.push({role:e,access:t,elem:n,comment:r}),`b${this.items.length}`}};function Y(e){let t=0;for(let n of e)if(n.kind===`const`){if(n.slot<0||n.slot>=4)throw Error(`apply codegen: constant slot ${n.slot} is out of range; an apply kernel carries at most 4 uniform constant slots (raise MAX_APPLY_CONST_SLOTS in applyKernels.ts if a new node kind needs more)`);t=Math.max(t,n.slot+1)}return t}function X(e,t,n,r,i){let a=[`@group(0) @binding(0) var<uniform> params: PcgParams;`],o=[];return n.forEach((e,t)=>{let n=t+1,r=e.access===`read`?`read`:`read_write`;a.push(`@group(0) @binding(${n}) var<storage, ${r}> b${n}: array<${e.elem}>; // ${e.comment}`),o.push({binding:n,role:e.role,access:e.access})}),{wgsl:`// Generated by pcg-ts resident-run apply codegen.
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
`,entryPoint:`main`,workgroupSize:64,bindings:o,constSlots:t,uniformBytes:Me(t),key:`${je}|${e}`}}var Z=e=>e.kind===`column`?`${e.type}x${e.tupleSize}`:`constx${e.tupleSize}@${e.slot}`;function Re(e,t,n){let r=e.kind===`const`?`f32`:e.type,i=t===`f32`&&e.kind===`column`&&e.type===`f32`,a=i?`u32`:r,o=t===`bool`||i?`u32`:t,s=new J,c=e.kind===`column`?s.add(`value`,`read`,a,`value column ${Z(e)}`):``,l=e.kind===`column`?{...e,type:a}:e,u=s.add(`target`,`read_write`,o,`target attribute ${t} tupleSize ${n}`),d=(e,n)=>{switch(t){case`f32`:return i?e:n;case`i32`:return r===`f32`?`i32(${e})`:r===`i32`?e:`bitcast<i32>(${e})`;case`u32`:return r===`f32`?`u32(${e})`:r===`u32`?e:`bitcast<u32>(${e})`;default:return`select(0u, 1u, ${e} != ${r===`f32`?`0f`:r===`i32`?`0i`:`0u`})`}},f=[];for(let e=0;e<n;e++){let t=Pe(c,l,e);f.push(`  ${Le(u,n,e)} = ${d(t,q(c,l,e))};`)}return X(`setAttribute|val=${Z(e)}|out=${t}x${n}`,Y([e]),s.items,[],f.join(`
`))}var Q={euler:`fn pcg_quat_from_euler_deg(r: vec3<f32>) -> vec4<f32> {
  let h = r * ${E(Math.PI/360,`internal PI/360`)};
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
}`};function ze(e,t,n,r,i){let a=new J,o=e.kind===`column`?a.add(`translate`,`read`,e.type,`translate column ${Z(e)}`):``,s=t.kind===`column`?a.add(`rotateEuler`,`read`,t.type,`rotateEuler column ${Z(t)}`):``,c=n.kind===`column`?a.add(`scale`,`read`,n.type,`scale column ${Z(n)}`):``,l=a.add(`P`,`read_write`,`f32`,`attribute P: f32 tupleSize 3`),u=r?a.add(`rot`,`read_write`,`f32`,`attribute rot: f32 tupleSize 4`):``,d=i?a.add(`scaleAttr`,`read_write`,`f32`,`attribute scale: f32 tupleSize 3`):``,f=[];return f.push(`  let s = vec3<f32>(${[0,1,2].map(e=>q(c,n,e)).join(`, `)});`),f.push(`  let q = pcg_quat_from_euler_deg(vec3<f32>(${[0,1,2].map(e=>q(s,t,e)).join(`, `)}));`),f.push(`  let v = pcg_rotate_vec(q, vec3<f32>(${l}[i * 3u] * s.x, ${l}[i * 3u + 1u] * s.y, ${l}[i * 3u + 2u] * s.z));`),f.push(`  ${l}[i * 3u] = v.x + ${q(o,e,0)};`),f.push(`  ${l}[i * 3u + 1u] = v.y + ${q(o,e,1)};`),f.push(`  ${l}[i * 3u + 2u] = v.z + ${q(o,e,2)};`),r&&(f.push(`  let q2 = pcg_quat_mul(q, vec4<f32>(${u}[i * 4u], ${u}[i * 4u + 1u], ${u}[i * 4u + 2u], ${u}[i * 4u + 3u]));`),f.push(`  ${u}[i * 4u] = q2.x;`),f.push(`  ${u}[i * 4u + 1u] = q2.y;`),f.push(`  ${u}[i * 4u + 2u] = q2.z;`),f.push(`  ${u}[i * 4u + 3u] = q2.w;`)),i&&(f.push(`  ${d}[i * 3u] = ${d}[i * 3u] * s.x;`),f.push(`  ${d}[i * 3u + 1u] = ${d}[i * 3u + 1u] * s.y;`),f.push(`  ${d}[i * 3u + 2u] = ${d}[i * 3u + 2u] * s.z;`)),X(`transformPoints|t=${Z(e)}|r=${Z(t)}|s=${Z(n)}|rot=${+!!r}|scl=${+!!i}`,Y([e,t,n]),a.items,[Q.euler,Q.mul,Q.rotate],f.join(`
`))}function Be(e){let t=new J,n=e.kind===`column`?t.add(`amount`,`read`,e.type,`amount column ${Z(e)}`):``,r=t.add(`P`,`read_write`,`f32`,`attribute P: f32 tupleSize 3`),i=[];for(let t=0;t<3;t++){let a=t===0?`i * 3u`:`i * 3u + ${t}u`;i.push(`  ${r}[${a}] = ${r}[${a}] + (pcg_hash_float(pcg_hash3(params.seed, i, ${t}u)) * 2f - 1f) * ${q(n,e,t)};`)}return X(`jitterPoints|a=${Z(e)}`,Y([e]),t.items,ie([`pcg_hash3`,`pcg_hash_float`]),i.join(`
`))}var Ve={"+x":`f, u, -r`,"-x":`-f, u, r`,"+y":`-r, f, u`,"-y":`r, -f, u`,"+z":`r, u, f`,"-z":`-r, u, -f`};function He(e,t,n){let r=new J,i=e.kind===`column`?r.add(`direction`,`read`,e.type,`direction column ${Z(e)}`):``,a=r.add(`rot`,`read_write`,`f32`,`attribute rot: f32 tupleSize 4`),o=E(1e-12,`internal ORIENT_PARALLEL_EPS`),s=`  let d = vec3<f32>(${[0,1,2].map(t=>q(i,e,t)).join(`, `)});
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
  let q = pcg_quat_from_basis(${Ve[t]});
  ${a}[i * 4u] = q.x;
  ${a}[i * 4u + 1u] = q.y;
  ${a}[i * 4u + 2u] = q.z;
  ${a}[i * 4u + 3u] = q.w;`;return X(`orientAlongVector|d=${Z(e)}|axis=${t}|up=${Z(n)}`,Y([e,n]),r.items,[Q.basis],s)}function Ue(e,t){let n=new J,r=n.add(`P`,`read`,`f32`,`attribute P: f32 tupleSize 3`),i=e?n.add(`rot`,`read`,`f32`,`attribute rot: f32 tupleSize 4`):``,a=t?n.add(`scaleAttr`,`read`,`f32`,`attribute scale: f32 tupleSize 3`):``,o=n.add(`transforms`,`read_write`,`f32`,`out: 16 f32 per instance`),s=`  let q = ${e?`vec4<f32>(${i}[i * 4u], ${i}[i * 4u + 1u], ${i}[i * 4u + 2u], ${i}[i * 4u + 3u])`:`vec4<f32>(0f, 0f, 0f, 1f)`};
  let s = ${t?`vec3<f32>(${a}[i * 3u], ${a}[i * 3u + 1u], ${a}[i * 3u + 2u])`:`vec3<f32>(1f, 1f, 1f)`};
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
  ${o}[o] = (1f - (yy + zz)) * s.x;
  ${o}[o + 1u] = (xy + wz) * s.x;
  ${o}[o + 2u] = (xz - wy) * s.x;
  ${o}[o + 3u] = 0f;
  ${o}[o + 4u] = (xy - wz) * s.y;
  ${o}[o + 5u] = (1f - (xx + zz)) * s.y;
  ${o}[o + 6u] = (yz + wx) * s.y;
  ${o}[o + 7u] = 0f;
  ${o}[o + 8u] = (xz + wy) * s.z;
  ${o}[o + 9u] = (yz - wx) * s.z;
  ${o}[o + 10u] = (1f - (xx + yy)) * s.z;
  ${o}[o + 11u] = 0f;
  ${o}[o + 12u] = ${r}[i * 3u];
  ${o}[o + 13u] = ${r}[i * 3u + 1u];
  ${o}[o + 14u] = ${r}[i * 3u + 2u];
  ${o}[o + 15u] = 1f;`;return X(`spawnInstances|rot=${+!!e}|scl=${+!!t}`,0,n.items,[],s)}var We=`webgpu`,Ge=class{backend=We;byteLength;detached;label;constructor(e,t,n){this.detached=e,this.byteLength=t,this.label=n}get disposed(){return this.detached.destroyed}get resource(){if(this.detached.destroyed)throw Error(`device transforms handle (${this.label}) was disposed; its GPU buffer is destroyed and cannot be bound. Dispose a handle only after the last frame that reads it, and re-cook to obtain a fresh one (device-resident outputs are never memoized, so every cook produces a new handle)`);return this.detached.buffer}dispose(){this.detached.destroy()}};function Ke(e,t,n){return new Ge(e,t,n)}var qe=65535;function Je(e,t){let n=qe*e;return Math.max(e,Math.floor(Math.min(t??n,n)/e)*e)}var Ye=`pcg-resident-run/3`;function Xe(e){return e.format===Ye?e:null}var Ze={reason:`run-plan-failed`},Qe=[`+x`,`-x`,`+y`,`-y`,`+z`,`-z`];function $e(e){return Array.isArray(e)&&e.length===3&&e.every(e=>typeof e==`number`&&Number.isFinite(e))}var $=class extends Error{},et=[];function tt(e,t,n){let i=t.count,a=new Map(Object.entries(t.attributes)),o=[],c=new Map,l=[],u=new Map,d=[],f=[],p=null,m=()=>Object.fromEntries(a),h=e=>{let t=c.get(e);if(t!==void 0)return t;let n=a.get(e);if(n===void 0||n.type===`string`)throw new $(e);let r=o.length;return o.push({bytes:i*n.tupleSize*4,init:`attr`,name:e}),c.set(e,r),r},g=(e,t,n)=>{let r=o.length;return o.push({bytes:i*t*4,init:n,name:e}),c.set(e,r),r},v=(e,t,n)=>{let r=a.get(e);if(r===void 0||r.type!==t||r.tupleSize!==n)throw new $(e)},y=(e,t,n)=>{let r=t.length/4;if(r>=4)throw Error(`resident run: "${n}" needs more than 4 uniform constant slots for its constant params; raise MAX_APPLY_CONST_SLOTS in applyKernels.ts (each slot costs 16 bytes of the per-chunk uniform and nothing else)`);for(let n=0;n<4;n++)t.push(n<e.length?e[n]:0);return{kind:`const`,tupleSize:e.length,slot:r}},b=(e,t,n,r,a,o)=>{let c;if(s(e)){let t=_(e);if(t===void 0)throw new $(`no spec`);c=t}else if(typeof e==`number`||Array.isArray(e)&&e.every(e=>typeof e==`number`)){let t=typeof e==`number`?[e]:e;if(t.length<1||t.length>4||r!==null&&!r.includes(t.length))throw new $(`tuple`);for(let e of t)if(!Number.isFinite(Math.fround(e)))throw new $(`f32 range`);return{param:y(t,a,o),ref:null}}else throw new $(`bad param value`);let u;try{u=Ee(c,{attributes:m()})}catch{throw new $(`compile`)}if(u.inputs.length+1>8)throw new $(`buffers`);if(r!==null&&!r.includes(u.outTupleSize))throw new $(`tuple`);let d=l.length;return l.push(i*u.outTupleSize*4),n.push({key:u.key,wgsl:u.wgsl,entryPoint:u.entryPoint,workgroupSize:u.workgroupSize,seed:t,uniformsBinding:u.bindings.uniforms,uniformBytes:12,consts:et,bindings:[...u.inputs.map(e=>({binding:e.binding,ref:{kind:`slot`,index:h(e.name)}})),{binding:u.bindings.output,ref:{kind:`col`,index:d}}]}),{param:{kind:`column`,type:u.outType,tupleSize:u.outTupleSize},ref:{kind:`col`,index:d}}},x=(e,t,n,r)=>{if(e.constSlots*4!==r.length)throw Error(`resident run: apply kernel "${e.key}" declares ${e.constSlots} constant slots but the planner allocated ${r.length/4}`);return{key:e.key,wgsl:e.wgsl,entryPoint:e.entryPoint,workgroupSize:e.workgroupSize,seed:t,uniformsBinding:0,uniformBytes:e.uniformBytes,consts:r,bindings:e.bindings.map(e=>{let t=n[e.role];if(t===void 0)throw new $(`unmapped role ${e.role}`);return{binding:e.binding,ref:t}})}};try{for(let t of e){let n=t===e[e.length-1],o=[],s=[],c=t.params;switch(t.kind){case`setAttribute`:{let e=c.name,n=c.type,i=c.tupleSize;if(typeof e!=`string`)throw new $(`name`);if(n!==`f32`&&n!==`i32`&&n!==`u32`&&n!==`bool`)throw new $(`type`);if(typeof i!=`number`||!Number.isInteger(i)||i<1||i>4)throw new $(`tupleSize`);let l=typeof c.seed==`number`?c.seed:NaN,f=l===0?t.seed:r(t.seed,l),{param:p,ref:m}=b(c.value,f,o,i===1?[1]:[1,i],s,t.kind),h=g(e,i,`none`);a.set(e,{type:n,tupleSize:i}),u.set(e,h),d.push({op:`replace`,name:e,type:n,tupleSize:i});let _={target:{kind:`slot`,index:h}};m!==null&&(_.value=m),o.push(x(Re(p,n,i),0,_,s));break}case`transformPoints`:{v(`P`,`f32`,3);let e=b(c.translate,t.seed,o,[1,3],s,t.kind),n=b(c.rotateEuler,t.seed,o,[1,3],s,t.kind),r=b(c.scale,t.seed,o,[1,3],s,t.kind),i=a.get(`rot`),l=i!==void 0&&i.type===`f32`&&i.tupleSize===4,d=a.get(`scale`),f=d!==void 0&&d.type===`f32`&&d.tupleSize===3,p=h(`P`);u.set(`P`,p);let m={P:{kind:`slot`,index:p}};if(e.ref!==null&&(m.translate=e.ref),n.ref!==null&&(m.rotateEuler=n.ref),r.ref!==null&&(m.scale=r.ref),l){let e=h(`rot`);u.set(`rot`,e),m.rot={kind:`slot`,index:e}}if(f){let e=h(`scale`);u.set(`scale`,e),m.scaleAttr={kind:`slot`,index:e}}o.push(x(ze(e.param,n.param,r.param,l,f),0,m,s));break}case`jitterPoints`:{v(`P`,`f32`,3);let e=typeof c.seed==`number`?c.seed:NaN,n=r(t.seed,e),i=b(c.amount,n,o,[1,3],s,t.kind),a=h(`P`);u.set(`P`,a);let l={P:{kind:`slot`,index:a}};i.ref!==null&&(l.amount=i.ref),o.push(x(Be(i.param),n,l,s));break}case`orientAlongVector`:{let e=c.axis;if(!Qe.includes(e))throw new $(`axis`);if(!$e(c.up))throw new $(`up`);let n=b(c.direction,t.seed,o,[1,3],s,t.kind),r=c.up,i=r[0]*r[0]+r[1]*r[1]+r[2]*r[2],l=i>0?1/Math.sqrt(i):0,f=[r[0]*l,r[1]*l,r[2]*l];for(let e of f)if(!Number.isFinite(Math.fround(e)))throw new $(`up range`);let p=y(f,s,t.kind),m=a.get(`rot`),_=m!==void 0&&m.type===`f32`&&m.tupleSize===4?h(`rot`):g(`rot`,4,`quat-default`);a.set(`rot`,{type:`f32`,tupleSize:4}),u.set(`rot`,_),d.push({op:`ensure-rot`});let v={rot:{kind:`slot`,index:_}};n.ref!==null&&(v.direction=n.ref),o.push(x(He(n.param,e,p),0,v,s));break}case`spawnInstances`:{if(!n)throw new $(`spawnInstances must be the run's last member`);let e=c.assetId;if(typeof e!=`string`||e===``)throw new $(`assetId`);if(c.assetAttr!==``&&c.assetAttr!==void 0)throw new $(`assetAttr`);v(`P`,`f32`,3);let t=a.get(`rot`),r=t!==void 0&&t.type===`f32`&&t.tupleSize===4,l=a.get(`scale`),u=l!==void 0&&l.type===`f32`&&l.tupleSize===3,d={P:{kind:`slot`,index:h(`P`)},transforms:{kind:`out`}};r&&(d.rot={kind:`slot`,index:h(`rot`)}),u&&(d.scaleAttr={kind:`slot`,index:h(`scale`)}),o.push(x(Ue(r,u),0,d,s)),p={assetId:e,count:i,bytes:i*64};break}default:throw new $(`unknown kind ${t.kind}`)}f.push({id:t.id,type:t.type,steps:o})}}catch(e){if(e instanceof $)return Ze;throw e}let S=[...u].map(([e,t])=>({name:e,slot:t})),C=t.needsGeometry||p===null,w=o.reduce((e,t)=>e+t.bytes,0),T=l.reduce((e,t)=>e+t,0),E=C?S.reduce((e,t)=>e+o[t.slot].bytes,0):0,ee=w+T+E+(p?.bytes??0);return ee>n?{reason:`run-too-large`}:{plan:{format:Ye,count:i,members:f,slots:o,cols:l,written:S,layoutOps:d,materialize:C,instances:p,totalBytes:ee}}}var nt={f32:Float32Array,i32:Int32Array,u32:Uint32Array};function rt(){return new Promise(e=>setTimeout(e,0))}async function it(e,t,n,r){let{device:i,pool:a}=e,{geo:o,signal:s,budgetMs:c}=n,l=t.count;if(o.attrs.point.count!==l)throw Error(`resident run: plan was built for ${l} points but the input geometry has ${o.attrs.point.count}; plans are single-cook artifacts — re-plan for new inputs`);let u=()=>{if(s?.aborted)throw new v},d=[],f=(e,t)=>{let n=a.acquire(e,t);return d.push(n),n},p=new Set,h;try{let n=o.attrs.point,s=t.slots.map(e=>{let t=f(e.bytes,K.STORAGE|K.COPY_DST|K.COPY_SRC);if(e.init===`attr`){let r=n.require(e.name),a=e.bytes/4;if(r.data instanceof Uint8Array){let e=new Uint32Array(a);for(let t=0;t<a;t++)e[t]=r.data[t];i.queue.writeBuffer(t,0,e)}else i.queue.writeBuffer(t,0,r.data.subarray(0,a))}else if(e.init===`quat-default`){let n=new Float32Array(e.bytes/4);for(let e=3;e<n.length;e+=4)n[e]=1;i.queue.writeBuffer(t,0,n)}return t}),d=t.cols.map(e=>f(e,K.STORAGE|K.COPY_DST|K.COPY_SRC)),g=t.instances===null?void 0:f(t.instances.bytes,K.STORAGE|K.COPY_DST|K.COPY_SRC|K.VERTEX),_=e=>{if(e.kind===`slot`)return s[e.index];if(e.kind===`col`)return d[e.index];if(g===void 0)throw Error(`resident run: a kernel binds the retained instance-transform buffer but the plan declares no instances output (plan and kernels disagree)`);return g},v=i.createCommandEncoder(),y=v.beginComputePass(),b=performance.now();for(let n of t.members){u();for(let t of n.steps){let n=e.getPipeline(t.key,t.wgsl,t.entryPoint,r);r!==void 0&&r.dispatches++,y.setPipeline(n);let a=Je(t.workgroupSize,e.maxElementsPerDispatch),o=Math.ceil(l/a),s=new ArrayBuffer(t.uniformBytes),c=new Uint8Array(s),u=new Uint32Array(s,0,3);u[0]=l,u[1]=t.seed>>>0,t.consts.length>0&&new Float32Array(s,16,t.consts.length).set(t.consts);for(let e=0;e<o;e++){let r=f(t.uniformBytes,K.UNIFORM|K.COPY_DST);u[2]=e*a,i.queue.writeBuffer(r,0,c);let o=i.createBindGroup({layout:n.getBindGroupLayout(0),entries:[{binding:t.uniformsBinding,resource:{buffer:r}},...t.bindings.map(e=>({binding:e.binding,resource:{buffer:_(e.ref)}}))]}),s=Math.min(a,l-e*a);y.setBindGroup(0,o),y.dispatchWorkgroups(Math.ceil(s/t.workgroupSize))}}c!==void 0&&performance.now()-b>c&&(await rt(),u(),b=performance.now())}y.end();let x=[],S,C=t.materialize?t.written.reduce((e,n)=>e+t.slots[n.slot].bytes,0):0;if(C>0){S=f(C,K.COPY_DST|K.MAP_READ);let e=0;for(let n of t.written){let r=t.slots[n.slot].bytes;v.copyBufferToBuffer(s[n.slot],0,S,e,r),x.push(e),e+=r}}i.queue.submit([v.finish()]);let w;if(t.materialize){let e;if(S!==void 0){await S.mapAsync(De.READ,0,C);try{e=S.getMappedRange(0,C).slice(0)}finally{S.unmap()}}u(),w=m(o);let n=w.attrs.point;for(let e of t.layoutOps)if(e.op===`replace`)n.replace(e.name,e.type,e.tupleSize);else{let e=n.get(`rot`);(!e||e.type!==`f32`||e.tupleSize!==4)&&(e&&n.remove(`rot`),n.add(`rot`,`f32`,4,[0,0,0,1]))}t.written.forEach((t,r)=>{let i=n.require(t.name),a=l*i.tupleSize;if(e===void 0)throw Error(`resident run: readback missing for a written attribute`);if(i.data instanceof Uint8Array){let t=new Uint32Array(e,x[r],a);for(let e=0;e<a;e++)i.data[e]=t[e]}else{let n=nt[i.type];if(n===void 0)throw Error(`resident run: cannot materialize attribute "${t.name}" of type ${i.type}`);i.data.set(new n(e,x[r],a))}})}else u();let T;if(t.instances!==null){if(g===void 0)throw Error(`resident run: the plan declares an instances output but no transform buffer was acquired (library bug: plan.instances and the acquired buffer must agree)`);let e=a.detach(g);p.add(g),h=Ke(e,t.instances.bytes,`${t.instances.count} instances of "${t.instances.assetId}"`),T=[{residency:`device`,assetId:t.instances.assetId,count:t.instances.count,transforms:h}]}r!==void 0&&(r.residentRuns++,r.fusedNodes+=t.members.length,r.readbacksSaved+=t.members.length-+!!t.materialize);let E={};return w!==void 0&&(E.geo=w),T!==void 0&&(E.deviceBatches=T),E}catch(e){throw h?.dispose(),e instanceof v?e:Error(`GpuFieldEvaluator: resident run failed (${t.members.length} fused nodes [${t.members.map(e=>`"${e.id}"`).join(`, `)}], ${l} points): ${e instanceof Error?e.message:String(e)}`,{cause:e})}finally{for(let e of d)p.has(e)||a.release(e)}}var at=`gpu2`,ot=268435456,st=[`spawnInstances`],ct={f32:Float32Array,i32:Int32Array,u32:Uint32Array},lt={f32:Float32Array,i32:Int32Array,u32:Uint32Array};function ut(e){let t=e=>e!==void 0&&e!==``?e:`?`;return[at,t(e?.vendor),t(e?.architecture),t(e?.device),t(e?.description)].join(`|`)}function dt(e,t){return e!==void 0&&(e.fallbacks[t]=(e.fallbacks[t]??0)+1),null}var ft=class{cacheSalt;residentTerminals;device;kernels=new Map;pipelines=new Map;pool;maxElementsPerDispatch;maxResidentBytes;constructor(e,t={}){if(t.maxElementsPerDispatch!==void 0&&!Number.isFinite(t.maxElementsPerDispatch))throw Error(`GpuFieldEvaluator: maxElementsPerDispatch must be a finite number, got ${t.maxElementsPerDispatch}; leave it unset to use the device maximum`);this.device=e,this.cacheSalt=ut(t.adapterInfo??e.adapterInfo),this.pool=new Ae(e,t.maxPooledBytes??ot),this.maxElementsPerDispatch=t.maxElementsPerDispatch,this.maxResidentBytes=t.maxResidentBytes??536870912,this.residentTerminals=t.deviceInstances===!0?st:[]}get pipelineCacheSize(){return this.pipelines.size}get poolStats(){return this.pool.stats}dispose(){this.pool.dispose()}chunkElements(e){let t=qe*e.workgroupSize,n=Math.min(this.maxElementsPerDispatch??t,t);return Math.max(e.workgroupSize,Math.floor(n/e.workgroupSize)*e.workgroupSize)}resolveField(e,t,n){let r=_(e);if(r===void 0)return dt(n,`no-spec`);let i=t.geo.attrs[t.domain],a={},o=[];for(let e of i.names().sort()){let t=i.get(e);t!==void 0&&(a[e]={type:t.type,tupleSize:t.tupleSize},o.push(`${JSON.stringify(e)}:${t.type}x${t.tupleSize}`))}let s=`${e.key.length}#${e.key}|${o.join(`,`)}`,c=this.kernels.get(s);if(c===void 0){try{c=Ee(r,{attributes:a})}catch(e){c=e instanceof Error?e:Error(String(e))}this.kernels.set(s,c)}if(c instanceof Error)return dt(n,`compile-error`);if(c.inputs.length+1>8)return dt(n,`too-many-buffers`);let l=i.count;if(l===0)return Promise.resolve({data:new lt[c.outType](0),tupleSize:c.outTupleSize});let u=this.getPipeline(c.key,c.wgsl,c.entryPoint,n);return n!==void 0&&n.dispatches++,this.dispatch(e,t,c,u,l)}getPipeline(e,t,n,r){let i=this.pipelines.get(e);if(i!==void 0)return r!==void 0&&r.pipelineCacheHits++,i;let a=this.device.createShaderModule({code:t}),o=this.device.createComputePipeline({layout:`auto`,compute:{module:a,entryPoint:n}});return this.pipelines.set(e,o),r!==void 0&&r.pipelinesCompiled++,o}planRun(e,t,n){let r=tt(e,t,this.maxResidentBytes);return`plan`in r?r.plan:(n!==void 0&&(n.fallbacks[r.reason]=(n.fallbacks[r.reason]??0)+1),null)}executeRun(e,t,n){let r=Xe(e);return r===null?Promise.reject(Error(`GpuFieldEvaluator.executeRun: plan was not produced by this library's planRun; pass the object returned by planRun on the same resolver`)):it({device:this.device,pool:this.pool,maxElementsPerDispatch:this.maxElementsPerDispatch,getPipeline:(e,t,n,r)=>this.getPipeline(e,t,n,r)},r,t,n)}async dispatch(e,t,n,r,i){let a=this.device,o=[],s=(e,t)=>{let n=this.pool.acquire(e,t);return o.push(n),n};try{let e=this.chunkElements(n),o=Math.ceil(i/e),c=[],l=t.geo.attrs[t.domain];for(let e of n.inputs){let t=l.require(e.name),n=i*e.tupleSize,r;if(t.data instanceof Uint8Array){let e=new Uint32Array(n);for(let r=0;r<n;r++)e[r]=t.data[r];r=e}else r=t.data.subarray(0,n);let o=s(n*4,K.STORAGE|K.COPY_DST);a.queue.writeBuffer(o,0,r),c.push({binding:e.binding,resource:{buffer:o}})}let u=i*n.outTupleSize*4,d=s(u,K.STORAGE|K.COPY_SRC);c.push({binding:n.bindings.output,resource:{buffer:d}});let f=s(u,K.COPY_DST|K.MAP_READ),p=[];for(let l=0;l<o;l++){let o=s(12,K.UNIFORM|K.COPY_DST);a.queue.writeBuffer(o,0,new Uint32Array([i,t.seed>>>0,l*e])),p.push(a.createBindGroup({layout:r.getBindGroupLayout(0),entries:[{binding:n.bindings.uniforms,resource:{buffer:o}},...c]}))}let m=a.createCommandEncoder(),h=m.beginComputePass();h.setPipeline(r);for(let t=0;t<o;t++){let r=Math.min(e,i-t*e);h.setBindGroup(0,p[t]),h.dispatchWorkgroups(Math.ceil(r/n.workgroupSize))}h.end(),m.copyBufferToBuffer(d,0,f,0,u),a.queue.submit([m.finish()]),await f.mapAsync(De.READ,0,u);let g;try{g=f.getMappedRange(0,u).slice(0)}finally{f.unmap()}return{data:new ct[n.outType](g),tupleSize:n.outTupleSize}}catch(n){throw Error(`GpuFieldEvaluator: dispatch failed for field ${e.key} (${i} elements on the ${t.domain} domain): ${n instanceof Error?n.message:String(n)}`,{cause:n})}finally{for(let e of o)this.pool.release(e)}}};export{ft as t};