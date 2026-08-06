/**
 * Plain-Node GPU task runner for the device test suites. Test-only.
 *
 * Reads a JSON task list on stdin, executes it against the first WebGPU
 * adapter (Dawn via the `webgpu` dev dependency), and writes a JSON
 * result to stdout. Runs as a separate plain `node` process because the
 * Dawn bindings are unstable inside vitest worker processes beyond a few
 * dozen async operations (flaky native crash); a plain child process
 * executes hundreds of shader compilations and dispatches reliably.
 *
 * Protocol (stdin):
 *   { tasks: [
 *     { name, mode: "validate", wgsl }
 *     { name, mode: "dispatch", wgsl, workgroupSize, count, seed,
 *       uniformsBinding, outputBinding, outBytes,
 *       inputs: [{ binding, data: <base64 of tightly packed scalars> }],
 *       runs }
 *   ] }
 *
 * Protocol (stdout):
 *   { ok: true, adapter: { vendor, architecture, device, description },
 *     results: [{ name, errors: [string], runs?: [base64] }] }
 *   { ok: false, error: string }   // includes "no WebGPU adapter"
 *
 * Every task compiles its module and reports error-severity diagnostics;
 * dispatch tasks additionally run `runs` independent dispatch+readback
 * cycles with fresh buffers (byte-equality across runs is the
 * determinism check on the caller's side).
 */
import { create } from "webgpu";

const USAGE = { MAP_READ: 0x1, COPY_SRC: 0x4, COPY_DST: 0x8, UNIFORM: 0x40, STORAGE: 0x80 };
const MAP_READ = 0x1;

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function fail(error) {
  process.stdout.write(JSON.stringify({ ok: false, error }));
  process.exit(0);
}

async function main() {
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch (err) {
    return fail(`bad task JSON: ${err}`);
  }
  const gpu = create([]);
  const adapter = await gpu.requestAdapter();
  if (!adapter) return fail("no WebGPU adapter");
  const info = adapter.info ?? {};
  const device = await adapter.requestDevice();

  const results = [];
  for (const task of input.tasks) {
    const module = device.createShaderModule({ code: task.wgsl });
    const compilation = await module.getCompilationInfo();
    const errors = compilation.messages
      .filter((m) => m.type === "error")
      .map((m) => `${m.lineNum ?? "?"}:${m.linePos ?? "?"} ${m.message}`);
    const result = { name: task.name, errors };
    results.push(result);
    if (errors.length > 0 || task.mode !== "dispatch") continue;

    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
    result.runs = [];
    for (let run = 0; run < (task.runs ?? 1); run++) {
      const buffers = [];
      const uniformBuf = device.createBuffer({
        size: 8,
        usage: USAGE.UNIFORM | USAGE.COPY_DST,
      });
      buffers.push(uniformBuf);
      device.queue.writeBuffer(uniformBuf, 0, new Uint32Array([task.count, task.seed >>> 0]));
      const entries = [{ binding: task.uniformsBinding, resource: { buffer: uniformBuf } }];
      for (const inputDesc of task.inputs) {
        const bytes = Buffer.from(inputDesc.data, "base64");
        const buf = device.createBuffer({
          size: bytes.byteLength,
          usage: USAGE.STORAGE | USAGE.COPY_DST,
        });
        buffers.push(buf);
        device.queue.writeBuffer(buf, 0, bytes);
        entries.push({ binding: inputDesc.binding, resource: { buffer: buf } });
      }
      const outBuf = device.createBuffer({
        size: task.outBytes,
        usage: USAGE.STORAGE | USAGE.COPY_SRC,
      });
      const readBuf = device.createBuffer({
        size: task.outBytes,
        usage: USAGE.COPY_DST | USAGE.MAP_READ,
      });
      buffers.push(outBuf, readBuf);
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [...entries, { binding: task.outputBinding, resource: { buffer: outBuf } }],
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(task.count / task.workgroupSize));
      pass.end();
      encoder.copyBufferToBuffer(outBuf, 0, readBuf, 0, task.outBytes);
      device.queue.submit([encoder.finish()]);
      await readBuf.mapAsync(MAP_READ);
      result.runs.push(Buffer.from(readBuf.getMappedRange()).toString("base64"));
      readBuf.unmap();
      for (const buf of buffers) buf.destroy();
    }
  }

  process.stdout.write(
    JSON.stringify({
      ok: true,
      adapter: {
        vendor: info.vendor,
        architecture: info.architecture,
        device: info.device,
        description: info.description,
      },
      results,
    }),
  );
  process.exit(0);
}

main().catch((err) => fail(String(err?.stack ?? err)));
