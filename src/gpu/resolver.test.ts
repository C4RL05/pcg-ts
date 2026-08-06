/**
 * CPU-only evaluator tests (run everywhere, no adapter): the
 * eligibility gate returns null with machine-readable reasons before
 * ever touching the device, the empty-count path skips dispatch, and
 * the cache salt derives from adapter identity + format version. The
 * fake device throws on any contact, proving these paths are
 * device-free.
 */
import { describe, expect, it } from "vitest";
import { Geometry } from "../data/index.js";
import { createGpuCookStats, randomField } from "../fields/index.js";
import { fieldFromJson, type FieldSpec } from "../nodes/fieldJson.js";
import type { GpuBufferLike, GpuDeviceLike } from "./device.js";
import { GpuFieldEvaluator } from "./evaluator.js";
import { makeCorpusGeometry } from "./testGeometry.js";

/** A device that fails loudly if the evaluator ever touches it. */
function untouchableDevice(adapterInfo?: GpuDeviceLike["adapterInfo"]): GpuDeviceLike {
  const boom = (): never => {
    throw new Error("fake device was touched — this path must be device-free");
  };
  return {
    queue: { writeBuffer: boom, submit: boom },
    ...(adapterInfo !== undefined ? { adapterInfo } : {}),
    createShaderModule: boom,
    createComputePipeline: boom,
    createBuffer: boom,
    createBindGroup: boom,
    createCommandEncoder: boom,
  };
}

describe("GpuFieldEvaluator eligibility gate (device-free)", () => {
  it("code-authored fields fall back with reason no-spec", () => {
    const ev = new GpuFieldEvaluator(untouchableDevice());
    const stats = createGpuCookStats();
    const geo = makeCorpusGeometry(4);
    const res = ev.resolveField(randomField("authored"), { geo, domain: "point", seed: 0 }, stats);
    expect(res).toBeNull();
    expect(stats).toEqual({
      dispatches: 0,
      pipelinesCompiled: 0,
      pipelineCacheHits: 0,
      residentRuns: 0,
      fusedNodes: 0,
      readbacksSaved: 0,
      fallbacks: { "no-spec": 1 },
    });
  });

  it("string-attribute reads fall back with reason compile-error, and the failure is cached", () => {
    const ev = new GpuFieldEvaluator(untouchableDevice());
    const stats = createGpuCookStats();
    const geo = makeCorpusGeometry(4);
    geo.attrs.point.add("label", "string", 1);
    const field = fieldFromJson({ fn: "attribute", name: "label" });
    const ctx = { geo, domain: "point" as const, seed: 0 };
    expect(ev.resolveField(field, ctx, stats)).toBeNull();
    expect(ev.resolveField(field, ctx, stats)).toBeNull();
    expect(stats.fallbacks).toEqual({ "compile-error": 2 });
  });

  it("missing attributes fall back with reason compile-error", () => {
    const ev = new GpuFieldEvaluator(untouchableDevice());
    const stats = createGpuCookStats();
    const geo = makeCorpusGeometry(4);
    const field = fieldFromJson({ fn: "attribute", name: "nonexistent" });
    expect(ev.resolveField(field, { geo, domain: "point", seed: 0 }, stats)).toBeNull();
    expect(stats.fallbacks).toEqual({ "compile-error": 1 });
  });

  it("kernels needing more than the baseline storage-buffer limit fall back", () => {
    const ev = new GpuFieldEvaluator(untouchableDevice());
    const stats = createGpuCookStats();
    const geo = new Geometry();
    const names: string[] = [];
    for (let i = 0; i < 8; i++) {
      const name = `a${i}`;
      geo.attrs.point.add(name, "f32", 1);
      names.push(name);
    }
    geo.attrs.point.resize(4);
    // Sum of 8 distinct attributes: 8 input buffers + 1 output = 9 > 8.
    let spec: FieldSpec = { fn: "attribute", name: names[0] };
    for (let i = 1; i < 8; i++) {
      spec = { fn: "add", args: [spec, { fn: "attribute", name: names[i] }] };
    }
    const res = ev.resolveField(fieldFromJson(spec), { geo, domain: "point", seed: 0 }, stats);
    expect(res).toBeNull();
    expect(stats.fallbacks).toEqual({ "too-many-buffers": 1 });
  });

  it("counts beyond one dispatch's coverage commit to GPU (chunked, never a fallback)", async () => {
    // A count above 65535 * workgroupSize used to fall back with
    // "dispatch-too-large"; chunked dispatch removed that reason from
    // the vocabulary. The fake device compiles the pipeline but throws
    // a sentinel at buffer creation: a non-null (rejected) promise
    // proves the evaluator committed to the GPU path for the large
    // count instead of returning null at the gate.
    const boom = (): never => {
      throw new Error("buffer-sentinel");
    };
    const device: GpuDeviceLike = {
      queue: {
        writeBuffer: boom,
        submit: boom,
      },
      createShaderModule: () => ({
        getCompilationInfo: () => Promise.resolve({ messages: [] }),
      }),
      createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
      createBuffer: boom,
      createBindGroup: boom,
      createCommandEncoder: boom,
    };
    const ev = new GpuFieldEvaluator(device);
    const stats = createGpuCookStats();
    const geo = new Geometry();
    geo.attrs.point.add("density", "f32", 1);
    geo.attrs.point.resize(65535 * 64 + 1);
    const field = fieldFromJson({ fn: "attribute", name: "density" });
    const pending = ev.resolveField(field, { geo, domain: "point", seed: 0 }, stats);
    expect(pending).not.toBeNull();
    await expect(pending).rejects.toThrow(/dispatch failed .* buffer-sentinel/s);
    expect(stats.fallbacks).toEqual({});
    expect(stats.dispatches).toBe(1);
  });

  it("count 0 resolves to an empty column of the kernel's type without dispatching", async () => {
    const ev = new GpuFieldEvaluator(untouchableDevice());
    const stats = createGpuCookStats();
    const geo = makeCorpusGeometry(0);
    const ctx = { geo, domain: "point" as const, seed: 0 };
    const f32 = await ev.resolveField(fieldFromJson({ fn: "randomField" }), ctx, stats)!;
    expect(f32.data).toBeInstanceOf(Float32Array);
    expect(f32.data.length).toBe(0);
    expect(f32.tupleSize).toBe(1);
    const u32 = await ev.resolveField(fieldFromJson({ fn: "index" }), ctx, stats)!;
    expect(u32.data).toBeInstanceOf(Uint32Array);
    expect(u32.data.length).toBe(0);
    const vec = await ev.resolveField(fieldFromJson({ fn: "position" }), ctx, stats)!;
    expect(vec.tupleSize).toBe(3);
    expect(stats).toEqual({ dispatches: 0, pipelinesCompiled: 0, pipelineCacheHits: 0, residentRuns: 0, fusedNodes: 0, readbacksSaved: 0, fallbacks: {} });
    expect(ev.pipelineCacheSize).toBe(0);
  });

  it("resolveField without a stats sink still works", () => {
    const ev = new GpuFieldEvaluator(untouchableDevice());
    const geo = makeCorpusGeometry(4);
    expect(ev.resolveField(randomField("x"), { geo, domain: "point", seed: 0 })).toBeNull();
  });

  it("non-finite maxElementsPerDispatch is rejected at construction", () => {
    // A NaN override would make the chunk plan NaN, skip every
    // dispatch, and silently return uncomputed (zero/stale) bytes —
    // verified against a real adapter before this guard existed.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(
        () => new GpuFieldEvaluator(untouchableDevice(), { maxElementsPerDispatch: bad }),
      ).toThrow(/maxElementsPerDispatch must be a finite number/);
    }
    // Finite values — even degenerate ones — stay accepted (clamped).
    expect(() => new GpuFieldEvaluator(untouchableDevice(), { maxElementsPerDispatch: 0 })).not.toThrow();
  });

  it("a readback failure never releases a still-mapped buffer into the pool", async () => {
    // First resolve: getMappedRange throws (OOM-class). The finally
    // block must unmap before the pool gets the readback buffer back;
    // otherwise the pooled mapped buffer poisons every later reuse of
    // its bucket. The fake enforces WebGPU mapped-state rules.
    interface FakeBuffer extends GpuBufferLike {
      bytes: Uint8Array;
      mapped: boolean;
    }
    let mapRangeCalls = 0;
    const copies: Array<{ src: FakeBuffer; dst: FakeBuffer; size: number }> = [];
    const device: GpuDeviceLike = {
      queue: {
        writeBuffer(buffer, offset, data) {
          const b = buffer as FakeBuffer;
          if (b.mapped) throw new Error("validation: writeBuffer on a mapped buffer");
          b.bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), offset);
        },
        submit() {
          for (const c of copies) c.dst.bytes.set(c.src.bytes.subarray(0, c.size));
          copies.length = 0;
        },
      },
      createShaderModule: () => ({ getCompilationInfo: () => Promise.resolve({ messages: [] }) }),
      createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
      createBuffer({ size }) {
        const raw = new ArrayBuffer(size);
        const buf: FakeBuffer = {
          bytes: new Uint8Array(raw),
          mapped: false,
          mapAsync: () => {
            if (buf.mapped) return Promise.reject(new Error("validation: mapAsync on a mapped buffer"));
            buf.mapped = true;
            return Promise.resolve(undefined);
          },
          getMappedRange(offset = 0, len = buf.bytes.length) {
            if (!buf.mapped) throw new Error("validation: getMappedRange while unmapped");
            mapRangeCalls++;
            if (mapRangeCalls === 1) throw new RangeError("simulated OOM in getMappedRange");
            return raw.slice(offset, offset + len);
          },
          unmap() {
            buf.mapped = false;
          },
          destroy() {},
        };
        return buf;
      },
      createBindGroup: () => ({}),
      createCommandEncoder: () => ({
        beginComputePass: () => ({
          setPipeline() {},
          setBindGroup() {},
          dispatchWorkgroups() {},
          end() {},
        }),
        copyBufferToBuffer(src, _so, dst, _do, size) {
          const s = src as FakeBuffer;
          const d = dst as FakeBuffer;
          if (s.mapped || d.mapped) throw new Error("validation: copy with a mapped buffer");
          copies.push({ src: s, dst: d, size });
        },
        finish: () => ({}),
      }),
    };
    const ev = new GpuFieldEvaluator(device);
    const geo = new Geometry();
    geo.attrs.point.add("density", "f32", 1);
    geo.attrs.point.resize(16);
    const ctx = { geo, domain: "point" as const, seed: 0 };
    const field = fieldFromJson({ fn: "attribute", name: "density" });
    await expect(ev.resolveField(field, ctx)!).rejects.toThrow(/simulated OOM/);
    // The pool must have gotten every buffer back unmapped: the second
    // resolve reuses them and succeeds.
    const col = await ev.resolveField(field, ctx)!;
    expect(col.data.length).toBe(16);
    expect(ev.poolStats.buffersReused).toBeGreaterThan(0);
  });
});

describe("GpuFieldEvaluator cache salt", () => {
  it("derives from explicit adapter info + format version", () => {
    const ev = new GpuFieldEvaluator(untouchableDevice(), {
      adapterInfo: { vendor: "acme", architecture: "gen9", device: "gpu-1", description: "Acme GPU" },
    });
    expect(ev.cacheSalt).toBe("gpu1|acme|gen9|gpu-1|Acme GPU");
  });

  it("falls back to the device's own adapterInfo, then to placeholders", () => {
    const fromDevice = new GpuFieldEvaluator(untouchableDevice({ vendor: "acme", description: "" }));
    expect(fromDevice.cacheSalt).toBe("gpu1|acme|?|?|?");
    const bare = new GpuFieldEvaluator(untouchableDevice());
    expect(bare.cacheSalt).toBe("gpu1|?|?|?|?");
  });

  it("explicit adapter info wins over the device's", () => {
    const ev = new GpuFieldEvaluator(untouchableDevice({ vendor: "device-side" }), {
      adapterInfo: { vendor: "explicit" },
    });
    expect(ev.cacheSalt).toBe("gpu1|explicit|?|?|?");
  });
});
