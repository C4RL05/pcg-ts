/**
 * WGSL apply-kernel codegen for device-resident runs: for each resident
 * node kind, the kernel that applies the node's semantics to the
 * resident attribute buffers, given its already-materialized field
 * columns. Codegen only — nothing here touches a device.
 *
 * Semantics are ported from the CPU node sources (`src/nodes/attributes.ts`
 * `setAttribute` numeric mode; `src/nodes/pointOps.ts` transformPoints /
 * jitterPoints / orientAlongVector loops and `src/nodes/util.ts`
 * quaternion math; `src/spawn/instances.ts` `composeTRS` for the
 * spawner terminal), which remain the bit-exact reference:
 *
 * - setAttribute stores are bit-exact for same-type f32/i32/u32 columns
 *   (raw copies) and for in-range integer conversions; out-of-range or
 *   NaN float→int stores differ (JS ToInt32/ToUint32 wraps, WGSL
 *   saturates) — GIGO class, same as the phase-20 lattice-wrap lines.
 * - jitterPoints reproduces the `hashFloat(hashCombine(seed, i, k))`
 *   chain bit-for-bit (u32 hash + exact-in-f32 hashFloat); the final
 *   `* 2 - 1`, amount multiply, and accumulate round in f32 where the
 *   CPU rounds once from f64 — tolerance class.
 * - transformPoints / orientAlongVector float math computes in f32
 *   (quaternion construction, basis branches) where the CPU computes in
 *   f64 and stores f32. Two further divergences beyond that width gap:
 *   `pcg_rotate_vec` re-associates the CPU's `A + B - C` into
 *   `A + (B - C)` via WGSL `cross`, and `cross`/`dot` may contract into
 *   FMA where the CPU's explicit expressions cannot — both shift the
 *   last ulps independently of f32-vs-f64. Branchy paths (quatFromBasis
 *   trace branches, up-parallel fallbacks) can flip at knife-edge inputs
 *   within tolerance; the baked parallel epsilon is the nearest f32 to
 *   1e-12 (9.99999996e-13, strictly below the CPU's f64 1e-12), so the
 *   fallback branch set differs by slightly more than rounding alone.
 *   orientAlongVector's zero-direction test can additionally flip for
 *   subnormal direction magnitudes (f32 squares flush to zero where f64
 *   keeps them) — subnormal GIGO class.
 * - spawnInstances' compose-TRS is the same expression tree as
 *   `composeTRS` evaluated in f32 instead of f64. The translation column
 *   is a straight copy of P and the constant rows are literals, so those
 *   are exact; the basis columns carry the width gap (measured 4.8e-7
 *   absolute, 1.7e-8 of the basis range, on the reference adapter), and
 *   an absent rot/scale compiles to the literal identity/one, which
 *   makes the whole matrix exact. Tolerance class, not a bit-exact port:
 *   these bytes drive a renderer, never a seed chain.
 *
 * Aliasing: apply kernels access only element `i`'s slots of any buffer
 * (never cross-element), param columns are separate buffers materialized
 * before the apply dispatch, and chunked dispatches partition the
 * element range exactly — so read_write attribute buffers are raced by
 * nothing.
 *
 * Constant params (phase 25): a param that is a plain number or number
 * tuple needs no column and no field kernel — its components ride the
 * kernel's own `PcgParams` uniform as `consts[slot]` ({@link
 * ApplyConstRef}), read with the same scalar-broadcast rule columns use.
 * A constant source is always f32 (exactly what the constant column it
 * replaces produced), and a JS number written through a `Float32Array`
 * rounds identically to the `wgslF32` literal that column's kernel
 * stored — so moving a param from a column to a slot does not move an
 * output byte, with one measured exception: a WGSL front end may flush
 * an f32 LITERAL that is `-0` or subnormal to `+0` (the D3D12 back end
 * does), while a uniform load is not a literal and keeps the bits. Those
 * constants therefore now land on the CPU's exact bytes where the column
 * landed `+0` — a move onto the reference, pinned by the device suite's
 * "carries -0 and subnormal constants" case. Values live in the uniform,
 * never in the WGSL text: the
 * specialization key encodes only which params are constant, their
 * tuple sizes, and their slots, so editing a constant rebinds a uniform
 * and hits the pipeline cache instead of compiling.
 *
 * The uniform tail this file defines ({@link APPLY_CONST_OFFSET},
 * {@link APPLY_CONST_STRIDE}, {@link APPLY_CONST_COMPONENTS},
 * {@link applyUniformBytes}) is shared, not apply-only: a FIELD kernel
 * carrying `{"fn":"param"}` slots declares the identical `_pad0` +
 * `array<vec4<f32>>` layout and the executor writes both kinds through
 * the same offset. It lives here because this is where the argument for
 * it — a slot rather than a literal, so a value edit rebinds instead of
 * recompiling — was first written down.
 */
import type { GpuScalarType } from "./types.js";
import { libClosure, wgslF32 } from "./wgslLib.js";

/** 1D workgroup size every apply kernel dispatches with. */
export const APPLY_WORKGROUP_SIZE = 64;

/**
 * Apply-kernel codegen version folded into specialization keys. Bump
 * whenever emitted WGSL text changes; when the change can alter
 * produced bytes, ALSO bump the evaluator's `SALT_VERSION` so memo
 * caches never serve stale fused output.
 *
 * Multi-asset grouping deliberately did NOT bump it. It added a NEW
 * compose variant (`|perm`, with the `base` header field), and every
 * pre-existing kernel — the non-indexed compose included — still emits
 * character-for-character the text it emitted before, under the same key.
 * Nothing cached can be stale, because nothing cached changed. That is
 * the test to apply to any future variant: a bump is required unless the
 * existing keys still map to the existing bytes.
 *
 * Per-instance channels did not bump it either, and pass the same test
 * from the other direction: {@link makeInstanceChannelApply} is a WHOLE
 * NEW kernel under keys (`instanceChannel|...`) nothing has ever cached,
 * and it changed not one character of any existing one — the compose
 * kernel included, which is exactly why channels did not go into it.
 */
const APPLY_VERSION = "apply2";

/**
 * Uniform constant slots one apply kernel may carry. The maximum any
 * kind takes today is 3 (transformPoints' translate / rotateEuler /
 * scale, all constant); orientAlongVector takes 2 (direction + the
 * normalized up hint). Raising this costs 16 bytes per slot per chunk
 * uniform and nothing else.
 */
export const MAX_APPLY_CONST_SLOTS = 4;

/** Byte size of the scalar `PcgParams` header {count, seed, chunkOffset}. */
export const APPLY_UNIFORM_HEADER_BYTES = 12;

/**
 * Byte size of the header when the kernel also carries the u32 `base`
 * (see {@link makeComposeInstancesApply}'s indexed mode). `base` lands in
 * the padding the `consts` array's 16-byte alignment already reserved, so
 * a kernel with constant slots pays nothing for it and a kernel without
 * them pays 4 bytes per chunk uniform.
 */
export const APPLY_UNIFORM_BASE_HEADER_BYTES = 16;

/**
 * Byte offset of the `consts` array inside `PcgParams`. `array<vec4<f32>>`
 * requires 16-byte alignment (and a 16-byte element stride) in the
 * uniform address space, so the 12-byte scalar header is padded to 16.
 */
export const APPLY_CONST_OFFSET = 16;

/** Byte stride of one constant slot (`vec4<f32>`). */
export const APPLY_CONST_STRIDE = 16;

/** Components one constant slot holds (`vec4<f32>`), zero-padded. */
export const APPLY_CONST_COMPONENTS = 4;

/**
 * Uniform byte size of an apply kernel carrying `constSlots` slots and,
 * optionally, the `base` header field.
 */
export function applyUniformBytes(constSlots: number, hasBase = false): number {
  if (constSlots > 0) return APPLY_CONST_OFFSET + constSlots * APPLY_CONST_STRIDE;
  return hasBase ? APPLY_UNIFORM_BASE_HEADER_BYTES : APPLY_UNIFORM_HEADER_BYTES;
}

/** Shape of a bound field column (the producing kernel's output). */
export interface ApplyColRef {
  readonly kind: "column";
  readonly type: GpuScalarType;
  readonly tupleSize: number;
}

/**
 * A constant param riding uniform slot `slot` as f32 components. The
 * planner allocates slots per apply kernel, in param order, and writes
 * the values into the per-chunk uniform.
 */
export interface ApplyConstRef {
  readonly kind: "const";
  readonly tupleSize: number;
  readonly slot: number;
}

/** Where an apply kernel reads a node param from. */
export type ApplyParamRef = ApplyColRef | ApplyConstRef;

/** One storage binding of an apply kernel, in binding-index order. */
export interface ApplyBinding {
  readonly binding: number;
  /** Kind-specific role the planner maps to a buffer (see each maker). */
  readonly role: string;
  readonly access: "read" | "read_write";
}

/** A generated apply kernel (uniforms are always binding 0, PcgParams). */
export interface ApplyKernel {
  readonly wgsl: string;
  readonly entryPoint: "main";
  readonly workgroupSize: number;
  readonly bindings: readonly ApplyBinding[];
  /** Constant slots the kernel's `PcgParams` declares (0 = none). */
  readonly constSlots: number;
  /** Byte size of this kernel's `PcgParams` uniform. */
  readonly uniformBytes: number;
  /** Stable specialization key (pipeline cache). */
  readonly key: string;
}

const XYZW = ["x", "y", "z", "w"] as const;

/**
 * Read component k of a param as f32, broadcasting scalar sources.
 * Columns read their storage buffer (`v` is the bound variable name and
 * non-f32 elements convert); constants read their uniform slot, which
 * is f32 by construction.
 */
function paramReadF32(v: string, p: ApplyParamRef, k: number): string {
  if (p.kind === "const") return constRead(p, k);
  const e = colReadRaw(v, p, k);
  return p.type === "f32" ? e : `f32(${e})`;
}

/**
 * Raw (unconverted) component read with scalar broadcast: identical to
 * {@link paramReadF32} for constants, which carry no other type.
 */
function paramReadRaw(v: string, p: ApplyParamRef, k: number): string {
  return p.kind === "const" ? constRead(p, k) : colReadRaw(v, p, k);
}

/** Uniform-slot component read; tuple 1 broadcasts component 0. */
function constRead(p: ApplyConstRef, k: number): string {
  const c = p.tupleSize === 1 ? 0 : k;
  if (c >= APPLY_CONST_COMPONENTS) {
    throw new Error(
      `apply codegen: constant slot ${p.slot} has no component ${c} ` +
        `(a uniform slot holds ${APPLY_CONST_COMPONENTS} f32 components)`,
    );
  }
  return `params.consts[${p.slot}].${XYZW[c]}`;
}

/** Raw column component read with scalar broadcast. */
function colReadRaw(v: string, col: ApplyColRef, k: number): string {
  if (col.tupleSize === 1) return `${v}[i]`;
  return k === 0 ? `${v}[i * ${col.tupleSize}u]` : `${v}[i * ${col.tupleSize}u + ${k}u]`;
}

function flatIdx(v: string, ts: number, k: number): string {
  if (ts === 1) return `${v}[i]`;
  return k === 0 ? `${v}[i * ${ts}u]` : `${v}[i * ${ts}u + ${k}u]`;
}

/**
 * Positional storage-binding allocator: bindings are numbered from 1 in
 * declaration order (0 is always the uniform), and a constant param
 * consumes none — so a kernel's binding indices depend on which of its
 * params are columns. The role each index carries is what the planner
 * maps to a buffer, so callers must add bindings in the order the
 * generated body expects and use the returned variable names.
 */
class BindingList {
  readonly items: { role: string; access: "read" | "read_write"; elem: GpuScalarType; comment: string }[] = [];

  /** Declare the next storage binding; returns its WGSL variable name. */
  add(role: string, access: "read" | "read_write", elem: GpuScalarType, comment: string): string {
    this.items.push({ role, access, elem, comment });
    return `b${this.items.length}`;
  }
}

/** Constant slots a kernel needs to declare, given its param refs. */
function constSlotsOf(params: readonly ApplyParamRef[]): number {
  let slots = 0;
  for (const p of params) {
    if (p.kind !== "const") continue;
    if (p.slot < 0 || p.slot >= MAX_APPLY_CONST_SLOTS) {
      throw new Error(
        `apply codegen: constant slot ${p.slot} is out of range; an apply kernel carries at ` +
          `most ${MAX_APPLY_CONST_SLOTS} uniform constant slots (raise MAX_APPLY_CONST_SLOTS ` +
          "in applyKernels.ts if a new node kind needs more)",
      );
    }
    slots = Math.max(slots, p.slot + 1);
  }
  return slots;
}

function assemble(
  kindKey: string,
  constSlots: number,
  bindings: readonly { role: string; access: "read" | "read_write"; elem: GpuScalarType; comment: string }[],
  helpers: readonly string[],
  body: string,
  hasBase = false,
): ApplyKernel {
  const decls: string[] = ["@group(0) @binding(0) var<uniform> params: PcgParams;"];
  const out: ApplyBinding[] = [];
  bindings.forEach((b, i) => {
    const binding = i + 1;
    const access = b.access === "read" ? "read" : "read_write";
    decls.push(
      `@group(0) @binding(${binding}) var<storage, ${access}> b${binding}: array<${b.elem}>; // ${b.comment}`,
    );
    out.push({ binding, role: b.role, access: b.access });
  });
  // The scalar header pads to 16 bytes so the vec4 array lands on its
  // required alignment; slot values are written per chunk, never baked.
  // The fourth u32 is that padding: `base` when the kernel indexes
  // through a permutation, an inert `_pad0` otherwise — so adding the
  // field moved no existing kernel's text.
  const fourth = hasBase ? "\n  base: u32," : constSlots === 0 ? "" : "\n  _pad0: u32,";
  const constMembers =
    constSlots === 0 ? fourth : `${fourth}\n  consts: array<vec4<f32>, ${constSlots}>,`;
  const wgsl = `// Generated by pcg-ts resident-run apply codegen.
// Dispatch: 1D, chunked; element index i = chunkOffset + gid.x, one
// invocation per element; only element i's slots are accessed.

struct PcgParams {
  count: u32,
  seed: u32,
  chunkOffset: u32,${constMembers}
}

${decls.join("\n")}

${helpers.length > 0 ? `${helpers.join("\n\n")}\n\n` : ""}@compute @workgroup_size(${APPLY_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x + params.chunkOffset;
  if (i >= params.count) {
    return;
  }
${body}
}
`;
  return {
    wgsl,
    entryPoint: "main",
    workgroupSize: APPLY_WORKGROUP_SIZE,
    bindings: out,
    constSlots,
    uniformBytes: applyUniformBytes(constSlots, hasBase),
    key: `${APPLY_VERSION}|${kindKey}`,
  };
}

/**
 * Specialization-key fragment for a param source. Constants contribute
 * their tuple size and slot — never their values, so a constant edit
 * rebinds the uniform and reuses the pipeline.
 */
const paramKey = (p: ApplyParamRef): string =>
  p.kind === "column" ? `${p.type}x${p.tupleSize}` : `constx${p.tupleSize}@${p.slot}`;

// ---------------------------------------------------------------------------
// setAttribute (numeric mode): store the value source into the target.
// Roles: "value" (present only when the value is a column), "target"
// (the attribute being written).

/**
 * Store conversions mirror the CPU typed-array stores: same-type f32
 * copies move raw bits (u32-bound buffers) so the pure hash chain stays
 * bit-exact and subnormals survive; integer↔integer conversions use
 * bitcast (the modular ToInt32/ToUint32 semantics); float→int uses the
 * WGSL conversion (in-range truncation identical; out-of-range/NaN is
 * GIGO — see the module doc); bool stores nonzero as 1 (NaN != 0 is
 * true in both).
 */
export function makeSetAttributeApply(
  value: ApplyParamRef,
  targetType: "f32" | "i32" | "u32" | "bool",
  tupleSize: number,
): ApplyKernel {
  // Bind element types: bool targets are u32 0/1 buffers; the bit-exact
  // f32→f32 column copy binds both sides as u32. The raw u32 copy is in
  // fact *more* bit-preserving than the CPU store, which canonicalizes
  // non-canonical NaN payloads on the way through a Float32Array. A
  // constant source is f32 in the uniform and stores through the f32
  // path — same bits, since its value round-trips a Float32Array too.
  const srcType: GpuScalarType = value.kind === "const" ? "f32" : value.type;
  const rawF32Copy = targetType === "f32" && value.kind === "column" && value.type === "f32";
  const colElem: GpuScalarType = rawF32Copy ? "u32" : srcType;
  const outElem: GpuScalarType = targetType === "bool" || rawF32Copy ? "u32" : targetType;
  const bindings = new BindingList();
  const valueVar =
    value.kind === "column"
      ? bindings.add("value", "read", colElem, `value column ${paramKey(value)}`)
      : "";
  // The raw f32 copy rebinds the column as u32; constants are unchanged.
  const src: ApplyParamRef = value.kind === "column" ? { ...value, type: colElem } : value;
  const targetVar = bindings.add(
    "target",
    "read_write",
    outElem,
    `target attribute ${targetType} tupleSize ${tupleSize}`,
  );
  const conv = (raw: string, f32: string): string => {
    switch (targetType) {
      case "f32":
        return rawF32Copy ? raw : f32; // f32(int) matches fround(Number(v))
      case "i32":
        return srcType === "f32" ? `i32(${raw})` : srcType === "i32" ? raw : `bitcast<i32>(${raw})`;
      case "u32":
        return srcType === "f32" ? `u32(${raw})` : srcType === "u32" ? raw : `bitcast<u32>(${raw})`;
      default: {
        const zero = srcType === "f32" ? "0f" : srcType === "i32" ? "0i" : "0u";
        return `select(0u, 1u, ${raw} != ${zero})`;
      }
    }
  };
  const lines: string[] = [];
  for (let k = 0; k < tupleSize; k++) {
    const raw = paramReadRaw(valueVar, src, k);
    lines.push(`  ${flatIdx(targetVar, tupleSize, k)} = ${conv(raw, paramReadF32(valueVar, src, k))};`);
  }
  return assemble(
    `setAttribute|val=${paramKey(value)}|out=${targetType}x${tupleSize}`,
    constSlotsOf([value]),
    bindings.items,
    [],
    lines.join("\n"),
  );
}

// ---------------------------------------------------------------------------
// quaternion helpers shared by transformPoints / orientAlongVector,
// ported from src/nodes/util.ts (same formulas and branch structure).

const QUAT_HELPERS: Record<string, string> = {
  // quatFromEulerDeg: extrinsic XYZ (R = Rz * Ry * Rx), degrees.
  euler: `fn pcg_quat_from_euler_deg(r: vec3<f32>) -> vec4<f32> {
  let h = r * ${wgslF32(Math.PI / 360, "internal PI/360")};
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
}`,
  mul: `fn pcg_quat_mul(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z);
}`,
  rotate: `fn pcg_rotate_vec(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let t = 2f * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}`,
  // quatFromBasis: three.js setFromRotationMatrix trace branches.
  basis: `fn pcg_quat_from_basis(bx: vec3<f32>, by: vec3<f32>, bz: vec3<f32>) -> vec4<f32> {
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
}`,
};

// ---------------------------------------------------------------------------
// transformPoints: P' = R * (scale * P) + translate, composing with
// existing rot (quaternion product) / scale (componentwise) attributes.
// Roles: "translate", "rotateEuler", "scale" (each present only when
// that param is a column), "P", then "rot" / "scaleAttr" when composed
// (all f32 buffers).

export function makeTransformPointsApply(
  translate: ApplyParamRef,
  rotateEuler: ApplyParamRef,
  scale: ApplyParamRef,
  hasRot: boolean,
  hasScale: boolean,
): ApplyKernel {
  // Declaration order is param order then attributes; constant params
  // declare nothing, so the attribute bindings shift down accordingly.
  const bindings = new BindingList();
  const tVar =
    translate.kind === "column"
      ? bindings.add("translate", "read", translate.type, `translate column ${paramKey(translate)}`)
      : "";
  const rVar =
    rotateEuler.kind === "column"
      ? bindings.add("rotateEuler", "read", rotateEuler.type, `rotateEuler column ${paramKey(rotateEuler)}`)
      : "";
  const sVar =
    scale.kind === "column"
      ? bindings.add("scale", "read", scale.type, `scale column ${paramKey(scale)}`)
      : "";
  const pVar = bindings.add("P", "read_write", "f32", "attribute P: f32 tupleSize 3");
  const rotVar = hasRot
    ? bindings.add("rot", "read_write", "f32", "attribute rot: f32 tupleSize 4")
    : "";
  const sclVar = hasScale
    ? bindings.add("scaleAttr", "read_write", "f32", "attribute scale: f32 tupleSize 3")
    : "";
  const lines: string[] = [];
  lines.push(`  let s = vec3<f32>(${[0, 1, 2].map((k) => paramReadF32(sVar, scale, k)).join(", ")});`);
  lines.push(`  let q = pcg_quat_from_euler_deg(vec3<f32>(${[0, 1, 2].map((k) => paramReadF32(rVar, rotateEuler, k)).join(", ")}));`);
  lines.push(`  let v = pcg_rotate_vec(q, vec3<f32>(${pVar}[i * 3u] * s.x, ${pVar}[i * 3u + 1u] * s.y, ${pVar}[i * 3u + 2u] * s.z));`);
  lines.push(`  ${pVar}[i * 3u] = v.x + ${paramReadF32(tVar, translate, 0)};`);
  lines.push(`  ${pVar}[i * 3u + 1u] = v.y + ${paramReadF32(tVar, translate, 1)};`);
  lines.push(`  ${pVar}[i * 3u + 2u] = v.z + ${paramReadF32(tVar, translate, 2)};`);
  if (hasRot) {
    lines.push(`  let q2 = pcg_quat_mul(q, vec4<f32>(${rotVar}[i * 4u], ${rotVar}[i * 4u + 1u], ${rotVar}[i * 4u + 2u], ${rotVar}[i * 4u + 3u]));`);
    lines.push(`  ${rotVar}[i * 4u] = q2.x;`);
    lines.push(`  ${rotVar}[i * 4u + 1u] = q2.y;`);
    lines.push(`  ${rotVar}[i * 4u + 2u] = q2.z;`);
    lines.push(`  ${rotVar}[i * 4u + 3u] = q2.w;`);
  }
  if (hasScale) {
    lines.push(`  ${sclVar}[i * 3u] = ${sclVar}[i * 3u] * s.x;`);
    lines.push(`  ${sclVar}[i * 3u + 1u] = ${sclVar}[i * 3u + 1u] * s.y;`);
    lines.push(`  ${sclVar}[i * 3u + 2u] = ${sclVar}[i * 3u + 2u] * s.z;`);
  }
  return assemble(
    `transformPoints|t=${paramKey(translate)}|r=${paramKey(rotateEuler)}|s=${paramKey(scale)}|rot=${hasRot ? 1 : 0}|scl=${hasScale ? 1 : 0}`,
    constSlotsOf([translate, rotateEuler, scale]),
    bindings.items,
    [QUAT_HELPERS.euler, QUAT_HELPERS.mul, QUAT_HELPERS.rotate],
    lines.join("\n"),
  );
}

// ---------------------------------------------------------------------------
// jitterPoints: P[i][k] += (hashFloat(hashCombine(seed, identity, k)) * 2
// - 1) * amount[i][k]. Roles: "amount" (when a column), "seed" (when the
// cloud carries the attribute), "P". The seed is the node's
// jitter-combined seed; CPU `hashCombine(seed, ident, k)` is exactly the
// library's `pcg_hash3` (both chain hashSeed(3) through the same murmur
// rounds) — bit-exact, pinned by the device parity suite.
//
// The identity is `pcg_hash4` over the f32 bit patterns of the INCOMING
// P.xyz and the `seed` attribute, matching `src/data/identity.ts`. Both
// halves are read into locals before the first store, because the kernel
// then overwrites the very positions the identity is built from.

export function makeJitterPointsApply(amount: ApplyParamRef, hasSeedAttr: boolean): ApplyKernel {
  const bindings = new BindingList();
  const aVar =
    amount.kind === "column"
      ? bindings.add("amount", "read", amount.type, `amount column ${paramKey(amount)}`)
      : "";
  const sVar = hasSeedAttr
    ? bindings.add("seed", "read", "u32", "attribute seed: u32 tupleSize 1")
    : "";
  const pVar = bindings.add("P", "read_write", "f32", "attribute P: f32 tupleSize 3");
  const lines: string[] = [];
  lines.push(
    `  let ident = pcg_hash4(bitcast<u32>(${pVar}[i * 3u]), bitcast<u32>(${pVar}[i * 3u + 1u]), bitcast<u32>(${pVar}[i * 3u + 2u]), ${hasSeedAttr ? `${sVar}[i]` : "0u"});`,
  );
  for (let k = 0; k < 3; k++) {
    const idx = k === 0 ? "i * 3u" : `i * 3u + ${k}u`;
    lines.push(
      `  ${pVar}[${idx}] = ${pVar}[${idx}] + (pcg_hash_float(pcg_hash3(params.seed, ident, ${k}u)) * 2f - 1f) * ${paramReadF32(aVar, amount, k)};`,
    );
  }
  return assemble(
    `jitterPoints|a=${paramKey(amount)}|s=${hasSeedAttr ? 1 : 0}`,
    constSlotsOf([amount]),
    bindings.items,
    libClosure(["pcg_hash3", "pcg_hash4", "pcg_hash_float"]),
    lines.join("\n"),
  );
}

// ---------------------------------------------------------------------------
// orientAlongVector: build rot quaternions pointing `axis` along the
// direction column, up hint fixing roll, with the CPU's fallback and
// keep-prior-rot-on-zero-direction semantics. Roles: "direction"
// (column, when it is not constant), "rot" (read_write; prior values
// pre-loaded so skipped lanes keep them). The axis is baked (it selects
// a basis permutation); the up hint rides a uniform slot, normalized in
// f64 by the planner exactly as the CPU normalizes it, so editing it
// rebinds the uniform instead of recompiling the pipeline.

const ORIENT_BASIS_ARGS: Record<string, string> = {
  "+x": "f, u, -r",
  "-x": "-f, u, r",
  "+y": "-r, f, u",
  "-y": "r, -f, u",
  "+z": "r, u, f",
  "-z": "-r, u, -f",
};

export function makeOrientApply(
  direction: ApplyParamRef,
  axis: "+x" | "-x" | "+y" | "-y" | "+z" | "-z",
  up: ApplyConstRef,
): ApplyKernel {
  const bindings = new BindingList();
  const dVar =
    direction.kind === "column"
      ? bindings.add("direction", "read", direction.type, `direction column ${paramKey(direction)}`)
      : "";
  const rotVar = bindings.add("rot", "read_write", "f32", "attribute rot: f32 tupleSize 4");
  const eps = wgslF32(1e-12, "internal ORIENT_PARALLEL_EPS");
  const body = `  let d = vec3<f32>(${[0, 1, 2].map((k) => paramReadF32(dVar, direction, k)).join(", ")});
  let dl = dot(d, d);
  if (dl == 0f) {
    return; // zero direction: keep the prior rot
  }
  let f = d * (1f / sqrt(dl));
  let up = vec3<f32>(${[0, 1, 2].map((k) => paramReadF32("", up, k)).join(", ")});
  // right = up x forward, falling back when (anti)parallel.
  var r = cross(up, f);
  var rl = dot(r, r);
  if (rl <= ${eps}) {
    // [0, 0, 1] x f
    r = vec3<f32>(-f.y, f.x, 0f);
    rl = r.x * r.x + r.y * r.y;
    if (rl <= ${eps}) {
      // f is (anti)parallel to Z too; [1, 0, 0] x f always works here.
      r = vec3<f32>(0f, -f.z, f.y);
      rl = r.y * r.y + r.z * r.z;
    }
  }
  r = r * (1f / sqrt(rl));
  // u = forward x right (unit: forward and right are orthonormal).
  let u = cross(f, r);
  let q = pcg_quat_from_basis(${ORIENT_BASIS_ARGS[axis]});
  ${rotVar}[i * 4u] = q.x;
  ${rotVar}[i * 4u + 1u] = q.y;
  ${rotVar}[i * 4u + 2u] = q.z;
  ${rotVar}[i * 4u + 3u] = q.w;`;
  return assemble(
    `orientAlongVector|d=${paramKey(direction)}|axis=${axis}|up=${paramKey(up)}`,
    constSlotsOf([direction, up]),
    bindings.items,
    [QUAT_HELPERS.basis],
    body,
  );
}

// ---------------------------------------------------------------------------
// spawnInstances: compose one column-major 4x4 instance matrix per point
// from the resident P / rot / scale buffers, into a device buffer the run
// retains instead of reading back. Roles: "P" (read), "rot" and
// "scaleAttr" (read, only when the attribute exists with the right
// shape), "transforms" (read_write, the output), — in indexed mode —
// "perm" (read, the host-planned grouping permutation), and — when the
// spawner asked for colour — "color" (read, the source attribute column)
// and "colors" (read_write, the second output).

/**
 * f32 slots one device instance COLOUR occupies: three components and one
 * of padding, so 16 bytes per instance where the CPU batch packs 12.
 *
 * Not a tuning knob and not a choice. A renderer reads an instance-colour
 * storage attribute as `array<vec3<f32>>`, and WGSL gives that a 16-byte
 * element stride (vec3 has 16-byte alignment in the storage address
 * space). three's own WebGPU backend says the same thing in code: an
 * itemSize-3 storage attribute is repacked to 4 components before upload,
 * commented "WGSL does not support packed vec3 data in storage buffers,
 * pad to vec4". Writing 3 floats per instance here would shift every
 * colour after the first by a growing offset — which looks like a shader
 * bug and is a layout bug.
 *
 * The kernel writes the pad slot as an explicit 0 rather than leaving it:
 * these buffers come from a reuse pool, and a handed-out buffer whose
 * every byte is defined is one a test can compare in full.
 */
export const INSTANCE_COLOR_COMPONENTS = 4;

/**
 * Compose-TRS kernel: `out[i] = T(P) * R(rot) * S(scale)` written as 16
 * consecutive f32 in `THREE.Matrix4.elements` order (first column at 0-3,
 * translation at 12-14, 15 = 1).
 *
 * A direct port of `composeTRS` (`src/spawn/instances.ts`): the same
 * eleven products, the same `(1 - (yy + zz)) * s` factorization, the same
 * write order — so the two differ only in float width and in whatever the
 * WGSL back end contracts into FMA. That is a documented TOLERANCE class,
 * not a bit-exact port: the CPU keeps an f64 interior and rounds once per
 * store, the device computes the whole expression in f32. These bytes
 * drive a renderer, never a seed chain, and the CPU path stays the
 * reference (the device suite measures the deviation over a dense
 * sample).
 *
 * Missing `rot` / `scale` attributes are compiled out to the literal
 * identity quaternion and unit scale, matching `buildInstanceBatches`'
 * defaults exactly — including its shape check, which the planner
 * mirrors, so an `f32x3` "rot" is *ignored* on both paths rather than
 * misread.
 *
 * `indexed` selects the multi-asset (phase 29) form. The host plans the
 * grouping (`groupPointsByAsset`) and uploads its permutation; the kernel
 * then dispatches once per asset over that batch's element range, reading
 * `src = perm[base + i]` and writing destination `i`. So the DESTINATION
 * index is still the invocation index — every output slot is written by
 * exactly one lane of exactly one dispatch — while the SOURCE is the
 * point the host's stable partition put in that slot. No device-side sort
 * is involved, and grouping order comes from the CPU spec verbatim.
 *
 * `colorTupleSize` (0 = no colour) adds the second output: components
 * 0-2 of the named f32 attribute, gathered from the SAME `src` the
 * matrix reads, into `colors` at {@link INSTANCE_COLOR_COMPONENTS} f32
 * per instance. Sharing `src` is the whole structural argument — this is
 * the device mirror of `buildInstanceBatches` reading colour inside its
 * own per-instance loop from the `i` that places the transform. One
 * index expression, no second traversal, so an instance's colour cannot
 * come from a different point than its matrix did, and there is no
 * ordering left to test into place. Unlike `composeTRS` this is a pure
 * GATHER — no arithmetic, therefore no ULP class — so the bytes must
 * equal the CPU's exactly.
 *
 * Non-indexed, colourless mode emits byte-identical WGSL to the
 * pre-phase-29 kernel, under the same specialization key, so the
 * constant-`assetId` path neither recompiles nor moves an output byte.
 * That is also why the colour bindings are declared LAST: every
 * pre-existing variant keeps the exact binding indices — and the exact
 * text — it had, which is what lets {@link APPLY_VERSION} stay put.
 */
export function makeComposeInstancesApply(
  hasRot: boolean,
  hasScale: boolean,
  indexed = false,
  colorTupleSize = 0,
): ApplyKernel {
  const hasColor = colorTupleSize > 0;
  if (hasColor && colorTupleSize < 3) {
    throw new Error(
      `apply codegen: spawnInstances colour source has tupleSize ${colorTupleSize}; components ` +
        "0-2 are read as RGB, so it must be at least 3 (the planner rejects narrower columns " +
        "before reaching codegen)",
    );
  }
  const bindings = new BindingList();
  const pVar = bindings.add("P", "read", "f32", "attribute P: f32 tupleSize 3");
  const rotVar = hasRot ? bindings.add("rot", "read", "f32", "attribute rot: f32 tupleSize 4") : "";
  const sclVar = hasScale
    ? bindings.add("scaleAttr", "read", "f32", "attribute scale: f32 tupleSize 3")
    : "";
  const outVar = bindings.add("transforms", "read_write", "f32", "out: 16 f32 per instance");
  // Declared last so P/rot/scale/transforms keep the binding indices the
  // non-indexed kernel gives them.
  const permVar = indexed
    ? bindings.add("perm", "read", "u32", "grouping permutation: source point index per slot")
    : "";
  // And after THAT, so every colourless variant is unchanged too.
  //
  // Binding budget: this kernel's widest form binds seven storage
  // buffers (P, rot, scale, transforms, perm, colour source, colour out)
  // against the baseline `maxStorageBuffersPerShaderStage` of 8 — the
  // uniform is not one of them. One free slot is left. Anything added
  // here after this point needs that limit checked, not assumed — which
  // is why NAMED per-instance channels are their own kernel
  // ({@link makeInstanceChannelApply}, three bindings, one dispatch per
  // channel per batch) rather than more bindings on this one: extending
  // it in place would have bought exactly one channel.
  const colVar = hasColor
    ? bindings.add("color", "read", "f32", `colour source: f32 tupleSize ${colorTupleSize}`)
    : "";
  const colOutVar = hasColor
    ? bindings.add(
        "colors",
        "read_write",
        "f32",
        `out: ${INSTANCE_COLOR_COMPONENTS} f32 per instance (vec3 storage stride, [3] = 0 pad)`,
      )
    : "";
  // Source element: the permuted point in indexed mode, the invocation
  // index itself otherwise.
  const src = indexed ? "src" : "i";
  const q = hasRot
    ? `vec4<f32>(${rotVar}[${src} * 4u], ${rotVar}[${src} * 4u + 1u], ${rotVar}[${src} * 4u + 2u], ${rotVar}[${src} * 4u + 3u])`
    : "vec4<f32>(0f, 0f, 0f, 1f)";
  const s = hasScale
    ? `vec3<f32>(${sclVar}[${src} * 3u], ${sclVar}[${src} * 3u + 1u], ${sclVar}[${src} * 3u + 2u])`
    : "vec3<f32>(1f, 1f, 1f)";
  const body = `${indexed ? `  let src = ${permVar}[params.base + i];\n` : ""}  let q = ${q};
  let s = ${s};
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
  ${outVar}[o] = (1f - (yy + zz)) * s.x;
  ${outVar}[o + 1u] = (xy + wz) * s.x;
  ${outVar}[o + 2u] = (xz - wy) * s.x;
  ${outVar}[o + 3u] = 0f;
  ${outVar}[o + 4u] = (xy - wz) * s.y;
  ${outVar}[o + 5u] = (1f - (xx + zz)) * s.y;
  ${outVar}[o + 6u] = (yz + wx) * s.y;
  ${outVar}[o + 7u] = 0f;
  ${outVar}[o + 8u] = (xz + wy) * s.z;
  ${outVar}[o + 9u] = (yz - wx) * s.z;
  ${outVar}[o + 10u] = (1f - (xx + yy)) * s.z;
  ${outVar}[o + 11u] = 0f;
  ${outVar}[o + 12u] = ${pVar}[${src} * 3u];
  ${outVar}[o + 13u] = ${pVar}[${src} * 3u + 1u];
  ${outVar}[o + 14u] = ${pVar}[${src} * 3u + 2u];
  ${outVar}[o + 15u] = 1f;${
    hasColor
      ? `
  // Same ${src}: this instance's colour is this instance's point's colour.
  let cs = ${src} * ${colorTupleSize}u;
  let co = i * ${INSTANCE_COLOR_COMPONENTS}u;
  ${colOutVar}[co] = ${colVar}[cs];
  ${colOutVar}[co + 1u] = ${colVar}[cs + 1u];
  ${colOutVar}[co + 2u] = ${colVar}[cs + 2u];
  ${colOutVar}[co + 3u] = 0f;`
      : ""
  }`;
  return assemble(
    `spawnInstances|rot=${hasRot ? 1 : 0}|scl=${hasScale ? 1 : 0}${indexed ? "|perm" : ""}` +
      `${hasColor ? `|color=${colorTupleSize}` : ""}`,
    0,
    bindings.items,
    [],
    body,
    indexed,
  );
}

// ---------------------------------------------------------------------------
// spawnInstances: one NAMED per-instance channel, gathered out of a
// resident attribute buffer into its own retained buffer. Roles: "src"
// (read, the source attribute column), "out" (read_write, the retained
// channel buffer) and — in indexed mode — "perm" (read, the same
// host-planned grouping permutation the compose kernel reads).

/**
 * Per-instance channel gather kernel: `out[i] = src[perm[base + i]]`,
 * all components, one dispatch per asset batch exactly as the compose
 * kernel runs.
 *
 * **A separate kernel per channel, not more bindings on compose.** The
 * compose kernel's widest form already binds seven of the baseline
 * `maxStorageBuffersPerShaderStage` of 8 (see
 * {@link makeComposeInstancesApply}), so folding channels into it would
 * buy exactly ONE and then fail on the second. This binds three
 * (source, output, permutation) whatever the channel is, so the number of
 * channels a spawn may carry is bounded by nothing here — it costs one
 * dispatch and one buffer each, and no binding budget.
 *
 * **Every channel is a WORD gather, whatever its dtype.** Both sides bind
 * as `array<u32>`, so the kernel moves raw 4-byte words and never a
 * value: there is no conversion to round, no arithmetic to contract into
 * FMA, and no float path to canonicalize a NaN payload. That is why this
 * is a bit-exact port of the CPU spawner's `readInstanceAttr` and not a
 * tolerance class — the same argument colour makes, generalized. It is
 * also why the dtype is absent from the generated text and from the
 * specialization key: `f32x2` and `u32x2` are the same kernel, and the
 * element type travels on the batch's `DeviceInstanceAttribute` where a
 * renderer reads it. A `bool` channel arrives here already widened to
 * u32 0/1, because that is how every bool column enters a resident slot.
 *
 * `components` is what {@link deviceInstanceAttributeLayout} says the
 * buffer spends per instance — `itemSize`, except that 3 pads to 4 for
 * the WGSL `array<vec3<T>>` 16-byte stride. It is PASSED IN rather than
 * recomputed so the padding rule has exactly one owner; the pad slot is
 * written as an explicit zero for the same reason the colour kernel
 * writes its own, namely that these buffers come from a reuse pool and a
 * handed-out buffer whose every byte is defined is one a test can compare
 * in full.
 *
 * `indexed` selects multi-asset mode and reads the source through the
 * SAME `perm[base + i]` the matrix did, so an instance's channel value
 * and its transform always come from one point. Sharing the expression is
 * the correctness argument, exactly as it is for colour.
 */
export function makeInstanceChannelApply(
  itemSize: number,
  components: number,
  indexed = false,
): ApplyKernel {
  if (!Number.isInteger(itemSize) || itemSize < 1 || itemSize > 4) {
    throw new Error(
      `apply codegen: per-instance channel itemSize ${itemSize} is out of range; a channel binds ` +
        "as a WGSL storage array of a scalar or a vec2/vec3/vec4, so it must be a whole number " +
        "in 1..4 (the planner rejects wider columns before reaching codegen)",
    );
  }
  const expected = itemSize === 3 ? 4 : itemSize;
  if (components !== expected) {
    throw new Error(
      `apply codegen: per-instance channel of itemSize ${itemSize} spends ${expected} slots per ` +
        `instance, not ${components}; pass the \`components\` deviceInstanceAttributeLayout ` +
        "returns rather than a second reading of the vec3 padding rule",
    );
  }
  const bindings = new BindingList();
  const srcVar = bindings.add("src", "read", "u32", `channel source: ${itemSize} word(s) per point`);
  const outVar = bindings.add(
    "out",
    "read_write",
    "u32",
    `out: ${components} word(s) per instance${components !== itemSize ? " (vec3 storage stride, [3] = 0 pad)" : ""}`,
  );
  // Declared last, mirroring the compose kernel: the non-indexed variant
  // keeps the binding indices it would have had without a permutation.
  const permVar = indexed
    ? bindings.add("perm", "read", "u32", "grouping permutation: source point index per slot")
    : "";
  const src = indexed ? "src" : "i";
  const read = (k: number): string =>
    itemSize === 1 ? `${srcVar}[${src}]` : k === 0 ? `${srcVar}[s]` : `${srcVar}[s + ${k}u]`;
  const write = (k: number): string =>
    components === 1 ? `${outVar}[i]` : k === 0 ? `${outVar}[o]` : `${outVar}[o + ${k}u]`;
  const lines: string[] = [];
  if (indexed) lines.push(`  let src = ${permVar}[params.base + i];`);
  if (itemSize > 1) lines.push(`  let s = ${src} * ${itemSize}u;`);
  if (components > 1) lines.push(`  let o = i * ${components}u;`);
  for (let k = 0; k < itemSize; k++) lines.push(`  ${write(k)} = ${read(k)};`);
  // The vec3 pad. Written, never left: see the doc comment.
  for (let k = itemSize; k < components; k++) lines.push(`  ${write(k)} = 0u;`);
  return assemble(
    `instanceChannel|ts=${itemSize}|c=${components}${indexed ? "|perm" : ""}`,
    0,
    bindings.items,
    [],
    lines.join("\n"),
    indexed,
  );
}
