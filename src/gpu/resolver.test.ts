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
import {
  createGpuCookStats,
  evaluateField,
  makeField,
  mul,
  position,
  randomField,
  type FieldLike,
  type ResidentMemberDesc,
  type ResidentRunContext,
} from "../fields/index.js";
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
  it("code-authored fields fall back with reason derived-spec", () => {
    const ev = new GpuFieldEvaluator(untouchableDevice());
    expect(ev.acceptDerivedSpecs).toBe(false); // the shipped default
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
      fallbacks: { "derived-spec": 1 },
    });
  });

  it("indescribable fields keep the reason no-spec, with the flag either way", () => {
    // `no-spec` did not become a synonym for "code-authored": it still
    // names the population no flag can rescue.
    const geo = makeCorpusGeometry(4);
    for (const acceptDerivedSpecs of [false, true]) {
      const ev = new GpuFieldEvaluator(untouchableDevice(), { acceptDerivedSpecs });
      const stats = createGpuCookStats();
      const opaque = makeField("opaque", 1, (ctx) => evaluateField(randomField("x"), ctx));
      expect(ev.resolveField(opaque, { geo, domain: "point", seed: 0 }, stats)).toBeNull();
      expect(stats.fallbacks, `accept=${acceptDerivedSpecs}`).toEqual({ "no-spec": 1 });
      // ...and so does a combinator tree built over one.
      const stats2 = createGpuCookStats();
      expect(ev.resolveField(mul(opaque, 2), { geo, domain: "point", seed: 0 }, stats2)).toBeNull();
      expect(stats2.fallbacks, `accept=${acceptDerivedSpecs} (tree)`).toEqual({ "no-spec": 1 });
    }
  });

  it("acceptDerivedSpecs is advertised, and admits the same field", () => {
    // The device is untouchable, so reaching a dispatch attempt is proof
    // the gate opened: eligibility is decided before any device contact.
    const ev = new GpuFieldEvaluator(untouchableDevice(), { acceptDerivedSpecs: true });
    expect(ev.acceptDerivedSpecs).toBe(true);
    const stats = createGpuCookStats();
    const geo = makeCorpusGeometry(4);
    expect(() =>
      ev.resolveField(randomField("authored"), { geo, domain: "point", seed: 0 }, stats),
    ).toThrow(/fake device was touched/);
    expect(stats.fallbacks).toEqual({});
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

  it("planRun applies the evaluator's own flag, not a default", () => {
    // The run planner is the fourth seam, and the only one the evaluator
    // reaches by passing the flag ONWARD rather than reading it. If that
    // hand-off is dropped, a chain declines members the per-field path
    // accepts (or the reverse) and the two disagree silently — planning
    // is device-free, so this is observable without an adapter.
    const member = (amount: FieldLike): ResidentMemberDesc => ({
      id: "jit",
      type: "jitterPoints",
      kind: "jitterPoints",
      params: { amount, seed: 7 },
      seed: 12345,
    });
    const ctx: ResidentRunContext = {
      attributes: { P: { type: "f32", tupleSize: 3 } },
      count: 16,
      needsGeometry: true,
    };
    const derived = mul(position(), 0.1);
    const authored = fieldFromJson({ fn: "mul", args: [{ fn: "position" }, 0.1] });
    expect(derived.key).toBe(authored.key); // same field, different provenance

    const narrow = new GpuFieldEvaluator(untouchableDevice());
    const narrowStats = createGpuCookStats();
    expect(narrow.planRun([member(derived)], ctx, narrowStats)).toBeNull();
    expect(narrowStats.fallbacks).toEqual({ "run-plan-failed": 1 });
    expect(narrow.planRun([member(authored)], ctx, createGpuCookStats())).not.toBeNull();

    const wide = new GpuFieldEvaluator(untouchableDevice(), { acceptDerivedSpecs: true });
    const wideStats = createGpuCookStats();
    expect(wide.planRun([member(derived)], ctx, wideStats)).not.toBeNull();
    expect(wideStats.fallbacks).toEqual({});
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
    // `fraction` is the one input whose VALUE depends on the count, so
    // the empty count is the case where it could plausibly divide by
    // zero. It never dispatches, and matches the CPU's empty column.
    const frac = await ev.resolveField(fieldFromJson({ fn: "fraction" }), ctx, stats)!;
    expect(frac.data).toBeInstanceOf(Float32Array);
    expect(frac.data.length).toBe(0);
    expect(frac.tupleSize).toBe(1);
    expect(Array.from(frac.data)).toEqual(
      Array.from(evaluateField(fieldFromJson({ fn: "fraction" }), ctx).data),
    );
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
    expect(ev.cacheSalt).toBe("gpu2|acme|gen9|gpu-1|Acme GPU");
  });

  it("falls back to the device's own adapterInfo, then to placeholders", () => {
    const fromDevice = new GpuFieldEvaluator(untouchableDevice({ vendor: "acme", description: "" }));
    expect(fromDevice.cacheSalt).toBe("gpu2|acme|?|?|?");
    const bare = new GpuFieldEvaluator(untouchableDevice());
    expect(bare.cacheSalt).toBe("gpu2|?|?|?|?");
  });

  it("explicit adapter info wins over the device's", () => {
    const ev = new GpuFieldEvaluator(untouchableDevice({ vendor: "device-side" }), {
      adapterInfo: { vendor: "explicit" },
    });
    expect(ev.cacheSalt).toBe("gpu2|explicit|?|?|?");
  });
});

/**
 * The two keys, from the cache side (device-free: an empty domain
 * resolves without a dispatch, and both caches are populated before the
 * count is looked at). `field.key` carries a bound `param`'s VALUE — the
 * CPU memo contract — so a kernel cache keyed on it would gain an entry
 * per value. Both maps here are unbounded, which makes that a leak on
 * every slider drag rather than a slowdown.
 */
describe("param rebinding does not grow the caches", () => {
  const SPEC: FieldSpec = {
    fn: "mul",
    args: [{ fn: "attribute", name: "density" }, { fn: "param", name: "amp" }],
  };

  it("a hundred values compile one kernel", () => {
    const ev = new GpuFieldEvaluator(untouchableDevice());
    const geo = makeCorpusGeometry(0);
    const ctx = { geo, domain: "point" as const, seed: 0 };
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const field = fieldFromJson(SPEC, { amp: i * 0.01 });
      keys.add(field.key);
      expect(ev.resolveField(field, ctx)).not.toBeNull();
    }
    // The premise: every value really did produce a distinct field key.
    expect(keys.size).toBe(100);
    expect(ev.kernelCacheSize).toBe(1);
    expect(ev.pipelineCacheSize).toBe(0); // no dispatch on an empty domain
  });

  it("...but a different arity is a different kernel, because the text differs", () => {
    const ev = new GpuFieldEvaluator(untouchableDevice());
    const ctx = { geo: makeCorpusGeometry(0), domain: "point" as const, seed: 0 };
    ev.resolveField(fieldFromJson({ fn: "param", name: "amp" }, { amp: 1 }), ctx);
    expect(ev.kernelCacheSize).toBe(1);
    ev.resolveField(fieldFromJson({ fn: "param", name: "amp" }, { amp: [1, 2, 3] }), ctx);
    expect(ev.kernelCacheSize).toBe(2);
  });

  it("declines a param nothing bound, so the CPU raises the named refusal", () => {
    const ev = new GpuFieldEvaluator(untouchableDevice());
    const stats = createGpuCookStats();
    // Count 4, not 0: the binding check must precede the empty-domain
    // shortcut, and this asserts it does for a populated domain too.
    const ctx = { geo: makeCorpusGeometry(4), domain: "point" as const, seed: 0 };
    expect(ev.resolveField(fieldFromJson(SPEC), ctx, stats)).toBeNull();
    expect(stats.fallbacks).toEqual({ "param-bindings": 1 });
    // ...and on an empty domain, where an empty column would have hidden it.
    const stats2 = createGpuCookStats();
    const empty = { geo: makeCorpusGeometry(0), domain: "point" as const, seed: 0 };
    expect(ev.resolveField(fieldFromJson(SPEC), empty, stats2)).toBeNull();
    expect(stats2.fallbacks).toEqual({ "param-bindings": 1 });
  });

  it("declines one name bound two ways in a single expression", () => {
    // Only reachable by composing two separately-bound fields in code;
    // one uniform slot cannot serve both, and picking either would serve
    // bytes the CPU never produced.
    const ev = new GpuFieldEvaluator(untouchableDevice(), { acceptDerivedSpecs: true });
    const stats = createGpuCookStats();
    const ctx = { geo: makeCorpusGeometry(4), domain: "point" as const, seed: 0 };
    const one = fieldFromJson({ fn: "param", name: "amp" }, { amp: 1 });
    const two = fieldFromJson({ fn: "param", name: "amp" }, { amp: 2 });
    expect(ev.resolveField(mul(one, two), ctx, stats)).toBeNull();
    expect(stats.fallbacks).toEqual({ "param-bindings": 1 });
  });
});
