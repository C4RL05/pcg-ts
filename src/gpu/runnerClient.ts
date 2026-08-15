/**
 * Test-side client for `deviceRunner.mjs`: builds dispatch tasks from
 * compiled kernels + geometry (mirroring the evaluator's marshalling
 * contract), spawns the plain-Node runner, and decodes results.
 * Test-only — see the runner's header for why device bulk work runs out
 * of process.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Geometry } from "../data/index.js";
import type { Column } from "../fields/index.js";
import type { CompiledFieldKernel, GpuScalarType } from "./types.js";

/** A validate- or dispatch-mode task for the runner. */
export interface RunnerTask {
  readonly name: string;
  readonly mode: "validate" | "dispatch";
  readonly wgsl: string;
  readonly workgroupSize?: number;
  readonly count?: number;
  readonly seed?: number;
  readonly uniformsBinding?: number;
  readonly outputBinding?: number;
  readonly outBytes?: number;
  readonly inputs?: readonly { binding: number; data: string }[];
  readonly runs?: number;
}

/** One task's result: front-end errors, plus readbacks for dispatches. */
export interface RunnerResult {
  readonly name: string;
  readonly errors: readonly string[];
  readonly runs?: readonly string[];
}

const CTORS: Record<GpuScalarType, new (buffer: ArrayBuffer) => Column["data"]> = {
  f32: Float32Array,
  i32: Int32Array,
  u32: Uint32Array,
};

function toBase64(view: ArrayBufferView): string {
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString("base64");
}

/** Decode one dispatch readback into a Column of the kernel's out type. */
export function decodeRun(kernel: CompiledFieldKernel, base64: string): Column {
  const buf = Buffer.from(base64, "base64");
  const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { data: new CTORS[kernel.outType](copy), tupleSize: kernel.outTupleSize };
}

/**
 * Build a dispatch task for `kernel` over the first `count` elements of
 * the geometry's point domain, marshalling exactly as the evaluator
 * does: tightly packed SoA scalar prefixes, bool columns widened to
 * u32 0/1.
 *
 * A kernel carrying `{"fn":"param"}` uniform slots is REFUSED rather
 * than dispatched: this protocol's uniform is the bare 12-byte
 * {count, seed, chunkOffset} the runner hardcodes, so binding it to a
 * kernel whose `PcgParams` is 16 + 16n bytes would read whatever the
 * driver leaves past the header and quietly produce bytes no CPU
 * evaluation ever made. The corpus already carries a `param` spec (for
 * front-end VALIDATION, which needs no uniform), so the trap is one line
 * away and worth an error rather than a comment — `params.device.test.ts`
 * measures param parity through the real evaluator instead.
 */
export function dispatchTask(
  name: string,
  kernel: CompiledFieldKernel,
  geo: Geometry,
  count: number,
  seed: number,
  runs = 1,
): RunnerTask {
  if (kernel.constSlots > 0) {
    // Both kinds of slot, named by kind: a `param` is missing a VALUE the
    // caller bound, an `attributeIs` is missing an INDEX only a geometry
    // has, and an author who has to extend this protocol needs to know
    // which of the two they are looking at.
    const holders: string[] = [];
    if (kernel.paramNames.length > 0) {
      holders.push(`param(s) ${kernel.paramNames.map((n) => JSON.stringify(n)).join(", ")}`);
    }
    if (kernel.attrIsSlots.length > 0) {
      holders.push(
        `attributeIs literal(s) ${kernel.attrIsSlots
          .map((a) => `${JSON.stringify(a.attr)} == ${JSON.stringify(a.value)}`)
          .join(", ")}`,
      );
    }
    throw new Error(
      `dispatchTask("${name}"): this kernel declares ${kernel.constSlots} uniform constant slot(s) ` +
        `for ${holders.join(" and ")}, and the device ` +
        "runner protocol writes only the 12-byte {count, seed, chunkOffset} header — it cannot carry " +
        "their values. Dispatch such kernels through GpuFieldEvaluator (see params.testsupport.ts and " +
        "attributeIs.testsupport.ts), or extend RunnerTask and deviceRunner.mjs to write the slots at " +
        "APPLY_CONST_OFFSET",
    );
  }
  const set = geo.attrs.point;
  const inputs = kernel.inputs.map((input) => {
    const attr = set.require(input.name);
    const n = count * input.tupleSize;
    if (attr.data instanceof Uint8Array) {
      const widened = new Uint32Array(n);
      for (let i = 0; i < n; i++) widened[i] = attr.data[i];
      return { binding: input.binding, data: toBase64(widened) };
    }
    return { binding: input.binding, data: toBase64(attr.data.subarray(0, n)) };
  });
  return {
    name,
    mode: "dispatch",
    wgsl: kernel.wgsl,
    workgroupSize: kernel.workgroupSize,
    count,
    seed,
    uniformsBinding: kernel.bindings.uniforms,
    outputBinding: kernel.bindings.output,
    outBytes: count * kernel.outTupleSize * 4,
    inputs,
    runs,
  };
}

/**
 * Run tasks in the plain-Node device runner. Throws when the runner
 * reports failure (including "no WebGPU adapter" — callers gate on
 * `testDevice` first, so this only fires on real breakage).
 */
export function runDeviceTasks(tasks: readonly RunnerTask[]): RunnerResult[] {
  const runner = fileURLToPath(new URL("./deviceRunner.mjs", import.meta.url));
  const stdout = execFileSync(process.execPath, [runner], {
    input: JSON.stringify({ tasks }),
    encoding: "utf8",
    maxBuffer: 1 << 28,
    timeout: 300_000,
  });
  const parsed = JSON.parse(stdout) as
    | { ok: true; results: RunnerResult[] }
    | { ok: false; error: string };
  if (!parsed.ok) throw new Error(`deviceRunner failed: ${parsed.error}`);
  return parsed.results;
}
