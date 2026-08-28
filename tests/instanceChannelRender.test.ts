/**
 * A PER-INSTANCE CHANNEL, READ BY A SHADER, MEASURED IN PIXELS.
 *
 * `src/three/instanced.test.ts` covers the BINDING thirteen ways: every
 * non-reserved channel becomes an `InstancedBufferAttribute` of its own
 * name, with its dtype and item size intact, on a geometry clone the mesh
 * owns. Every one of those assertions stops at the geometry. None of them
 * — none of anything in this repo, until this file — proves a shader can
 * READ one back, because `toInstancedMeshes` deliberately writes no
 * shader ("the library ships the data, not the shader") and a vitest
 * worker has no GL context to run one in.
 *
 * So this suite draws. It builds a point cloud, spawns it through
 * `buildInstanceBatches` → `toInstancedMeshes`, gives the asset a
 * material that reads the channel, renders four instances into a 64x16
 * render target in a real browser, and reads the pixels back. The
 * assertion that has never existed is "the colour of instance `i` is the
 * value channel `c` carried for instance `i`".
 *
 * Two more things fall out of having a draw call at all:
 *
 * - **The `gpuType` question, both directions.** `docs/authoring.md`
 *   warns that three defaults an instanced attribute to `FloatType`, so
 *   a `u32` channel bound without setting `gpuType` is "read back as a
 *   float and suffers at the shader exactly the 2^24 collision the
 *   spawner refused". `u32-default-gpuType` and `u32-IntType` are that
 *   claim, run — and in three r185 IT DOES NOT HOLD: both read every id
 *   back exactly, and byte-for-byte identically. `gpuType` is not what
 *   decides, because the ARRAY CLASS already does. The comment on the
 *   pair carries the three source lines that settle it. Treat that
 *   paragraph of the documentation as owing a correction.
 * - **The collision is real, in the other place.** `f32-widened-id`
 *   carries the same four ids in an f32 column — the widening
 *   `src/spawn` refuses to do — and two of the four land on one pixel
 *   value. That is what the dtype preservation buys, shown rather than
 *   argued.
 *
 * ## Why WebGL is the primary target
 *
 * `toInstancedMeshes` imports only `three` and branches on nothing
 * renderer-shaped: the geometry attribute it produces is byte-identical
 * whichever renderer draws it. What is NOT identical is where `gpuType`
 * is consulted, and in three r185 the only place the classic renderer
 * reads it is `WebGLBindingStates`' integer-attribute test. A
 * WebGPU-only test could therefore not put the documented trap under a
 * measurement at all. WebGL also reads back synchronously and through no
 * output colour transform, which is what lets the assertions below be
 * exact to one 8-bit LSB rather than "close enough".
 *
 * The device-resident WebGPU adapter (`src/three/webgpuInstances.ts`) is
 * not the shipped path for a custom channel either — it binds only the
 * instance matrix and the reserved colour, and a graph naming
 * `instanceAttrs` is rejected back to the CPU spawner, which lands here.
 * `WebGPURenderer` is still covered, in `describe("under
 * WebGPURenderer")` below, because the documentation calls it the
 * supported host for per-instance data and no test in this repo had ever
 * drawn with it. It draws the same two channels through a
 * `NodeMaterial` and a TSL `attribute()`, and — measured — agrees with
 * the WebGL readback byte for byte.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GAINS,
  ID_BASE,
  ID_SCALE,
  IDS,
  N,
  TINTS,
  expectedIdByte,
  expectedTintBytes,
  expectedWidenedIdByte,
} from "./support/instanceChannelFixture.js";
import {
  browserSuiteName,
  openHarness,
  probeBrowser,
  type Harness,
} from "./support/instanceChannelHarness.js";
import type { CaseResult, RunResult, Sample } from "./support/instanceChannelPage.js";

const PROBE = probeBrowser();

/** Launching a browser, bundling a page and drawing five scenes. */
const HARNESS_TIMEOUT_MS = 180_000;

function caseOf(run: RunResult, name: string): CaseResult {
  const found = run.webgl.find((c) => c.name === name);
  if (found === undefined) {
    throw new Error(`no WebGL case named "${name}"; ran: ${run.webgl.map((c) => c.name).join(", ")}`);
  }
  return found;
}

const rgb = (s: Sample): [number, number, number] => [s.r, s.g, s.b];
const reds = (c: CaseResult): number[] => c.samples.map((s) => s.r);

/**
 * Why no WebGPU case drew, in the page's own words.
 *
 * The page reports an unavailable WebGPU as ONE sentinel entry named
 * "webgpu" rather than a skipped entry per case, so a lookup by case
 * name finds nothing and would report "no WebGPU cases ran" while the
 * page knew the actual reason (no `navigator.gpu`, a fallback to the
 * WebGL backend, or a thrown init). This is the only place that reason
 * is recoverable, and a skip whose note is wrong is a skip nobody can
 * act on.
 */
function webgpuSkipReasonFrom(runs: readonly RunResult[]): string {
  for (const run of runs) {
    const said = run.webgpu.find((c) => c.skipped !== undefined)?.skipped;
    if (said !== undefined) return said;
  }
  return "the page ran no WebGPU cases and gave no reason";
}

describe.skipIf("reason" in PROBE)(
  browserSuiteName("per-instance channels reach the shader", PROBE),
  () => {
    let harness: Harness;
    let clean: RunResult;
    let reversed: RunResult;
    let dropped: RunResult;

    beforeAll(async () => {
      harness = await openHarness();
      // One page, four evaluations: the browser launch is the expensive
      // part and the sabotage runs are the proof that the clean run's
      // assertions are not vacuous.
      clean = await harness.run({ webgpu: true });
      reversed = await harness.run({ sabotage: "reverse", webgpu: true });
      dropped = await harness.run({ sabotage: "drop" });
      if (process.env.PCG_CHANNEL_DEBUG === "1") {
        const compact = (run: RunResult, label: string): unknown => ({
          label,
          webgl: run.webgl.map((c) => ({
            name: c.name,
            rgba: c.samples.map((s) => [s.r, s.g, s.b, s.a]),
            bg: [c.background.r, c.background.g, c.background.b, c.background.a],
            glErrors: c.glErrors,
          })),
          webgpu: run.webgpu.map((c) => ({
            name: c.name,
            skipped: c.skipped,
            rgba: c.samples.map((s) => [s.r, s.g, s.b, s.a]),
            bg: [c.background.r, c.background.g, c.background.b, c.background.a],
          })),
        });
        console.log(
          "PCG_CHANNEL_DEBUG " +
            JSON.stringify(
              {
                renderer: clean.renderer,
                runs: [compact(clean, "clean"), compact(reversed, "reverse"), compact(dropped, "drop")],
                pageErrors: harness.errors,
              },
              null,
              1,
            ),
        );
      }
    }, HARNESS_TIMEOUT_MS);

    afterAll(async () => {
      await harness?.close();
    });

    const webgpuSkipReason = (): string => webgpuSkipReasonFrom([clean, reversed]);

    it("the browser drew: every instance wrote a fragment and the background did not", () => {
      expect(harness.errors, "the page raised no errors").toEqual([]);
      for (const c of clean.webgl) {
        expect(c.background.a, `${c.name}: the row above the instances is untouched clear`).toBe(0);
        if (c.name === "u32-declared-float") continue; // see its own test
        for (let i = 0; i < N; i++) {
          expect(c.samples[i].a, `${c.name} instance ${i}: a fragment was written here`).toBe(255);
        }
        expect(c.glErrors, `${c.name}: no GL error between the draw and the readback`).toEqual([]);
      }
    });

    it("an f32 channel is what the shader reads: the pixel is the value", () => {
      const c = caseOf(clean, "f32-tint");
      for (let i = 0; i < N; i++) {
        // EXACT, with no tolerance. `GAINS` is chosen so no component
        // lands near the `x.5` where the RGBA8 write has to pick a
        // direction, which leaves nothing for a tolerance to absorb —
        // and a tolerance is exactly where a small wrong answer would
        // hide. See the comment on `GAINS`.
        expect(
          rgb(c.samples[i]),
          `instance ${i}: tint ${TINTS[i].join(", ")} at gain ${GAINS[i]}`,
        ).toEqual(expectedTintBytes(i));
      }
      // Four instances, four different pixels: instance ORDER survived
      // the spawner, the bind and the draw.
      expect(new Set(c.samples.map((s) => `${s.r},${s.g},${s.b}`)).size).toBe(N);
    });

    /**
     * THE `gpuType` PAIR, AND WHAT IT MEASURED.
     *
     * `docs/authoring.md` says a `u32` channel bound without `gpuType`
     * is "read back as a float and suffers at the shader exactly the
     * 2^24 collision the spawner refused". In three r185 it is not: both
     * of these cases read every id back exactly, and they read back
     * IDENTICALLY. The mechanism is `WebGLBindingStates`:
     *
     *     const integer = ( type === gl.INT || type === gl.UNSIGNED_INT
     *                       || geometryAttribute.gpuType === IntType );
     *
     * `type` comes from the ARRAY, and a `u32` channel arrives as a
     * `Uint32Array` — `toInstancedMeshes` copies the column with
     * `.slice()`, which preserves the class — so `type` is already
     * `gl.UNSIGNED_INT` and `vertexAttribIPointer` is used whatever
     * `gpuType` says. The same holds on both WebGPU paths:
     * `WebGPUAttributeUtils` maps `Uint32Array` to the `uint32` vertex
     * format from the array alone, and the WebGL fallback's
     * `GLSLNodeBuilder.getTypeFromAttribute` keeps `uint` for a
     * `Uint32Array` explicitly.
     *
     * These two tests are therefore written to pin the BEHAVIOUR (both
     * exact) rather than the documented mechanism, and the pair is kept
     * — rather than collapsed into one — precisely because the doc
     * predicts they differ. If a future three makes `gpuType` load-bearing
     * again, `u32-default-gpuType` is the one that reddens.
     */
    it("a u32 channel above 2^24 reaches the shader exactly, with gpuType left at three's default", () => {
      const c = caseOf(clean, "u32-default-gpuType");
      expect(
        reds(c),
        `ids ${IDS.join(", ")} decoded as (id - ${ID_BASE}) * ${ID_SCALE} in the red byte`,
      ).toEqual([0, 1, 2, 3].map(expectedIdByte));
      // The top byte of every id, so the shader is reading the WHOLE
      // 32-bit value and not just its low bits.
      for (let i = 0; i < N; i++) {
        expect(c.samples[i].b, `instance ${i}: id >> 24`).toBe(1);
      }
      // No two instances collide — the failure the dtype exists to
      // prevent, checked at the pixel.
      expect(new Set(reds(c)).size).toBe(N);
    });

    it("setting gpuType = IntType changes nothing: the same pixels, byte for byte", () => {
      const withType = caseOf(clean, "u32-IntType");
      const withoutType = caseOf(clean, "u32-default-gpuType");
      expect(withType.samples).toEqual(withoutType.samples);
      expect(reds(withType)).toEqual([0, 1, 2, 3].map(expectedIdByte));
    });

    it("the widening the spawner refuses collides at the pixel: two ids, one colour", () => {
      const c = caseOf(clean, "f32-widened-id");
      expect(reds(c), "the same four ids carried in an f32 column").toEqual(
        [0, 1, 2, 3].map(expectedWidenedIdByte),
      );
      // 2^24 and 2^24 + 1 are one f32, so they are one pixel...
      expect(c.samples[0].r, "2^24 and 2^24 + 1 are the same f32").toBe(c.samples[1].r);
      // ...while 2^24 + 2 and 2^24 + 3 are not, which is what makes this
      // a rounding result and not "the attribute never arrived".
      expect(c.samples[2].r).not.toBe(c.samples[3].r);
      expect(new Set(reds(c)).size, "three distinct values out of four ids").toBe(3);
    });

    /**
     * The other half of the host's job, and the one place the
     * documentation's advice has teeth: the LIBRARY binds the dtype the
     * column had, and DECLARING it is the host's. Get the declaration
     * wrong and the failure is loud — measured here as WebGL2's
     * `INVALID_OPERATION` (0x502) and a draw that produces no fragment
     * at all — rather than the quiet wrong number the documentation
     * predicts. That is the useful thing to tell an integrator.
     */
    it("declaring an integer channel `in float` fails loudly rather than silently rounding", () => {
      const c = caseOf(clean, "u32-declared-float");
      const exact = [0, 1, 2, 3].map(expectedIdByte);
      // FIRST, evidence that the harness was drawing at all in this run.
      // Without it every assertion below is satisfied by a browser that
      // rendered nothing whatsoever, which is the one shape of false
      // pass this file exists to rule out: the sibling case binds the
      // SAME column through the SAME page and put fragments on screen.
      expect(
        caseOf(clean, "u32-default-gpuType").samples.map((s) => s.a),
        "the sibling case in this same run drew, so a blank here is the declaration's doing",
      ).toEqual([255, 255, 255, 255]);
      expect(
        reds(c),
        `read ${reds(c).join(", ")}; glErrors ${c.glErrors.join(", ") || "(none)"}`,
      ).not.toEqual(exact);
      // Either the driver reported the type mismatch or it drew nothing;
      // both are loud. Which one is a driver detail, so accept both — but
      // "no error AND pixels" would mean it silently did something.
      const drewNothing = c.samples.every((s) => s.a === 0);
      expect(
        c.glErrors.length > 0 || drewNothing,
        `glErrors ${c.glErrors.join(", ") || "(none)"}, alphas ${c.samples.map((s) => s.a).join(", ")}`,
      ).toBe(true);
    });

    /**
     * PROOF THAT THE ASSERTIONS ABOVE CAN FAIL.
     *
     * Every case is re-run with the bound attribute deliberately
     * corrupted after `toInstancedMeshes` returns, and the same pixels
     * are read back. If the harness were drawing nothing, sampling a
     * stale buffer, or reading a channel the shader never touched, these
     * would come back identical to the clean run.
     */
    describe("a corrupted binding reddens the same assertions", () => {
      it("reversing the channel's per-instance records swaps the colours", () => {
        const c = caseOf(reversed, "f32-tint");
        for (let i = 0; i < N; i++) {
          // Only `tint` is reversed, so instance i draws with tint
          // `N-1-i` and its OWN gain — a stricter expectation than
          // "something changed", and one only a live read can satisfy.
          const got = rgb(c.samples[i]);
          expect(
            got,
            `instance ${i} now draws instance ${N - 1 - i}'s tint at its own gain`,
          ).toEqual(expectedTintBytes(N - 1 - i, i));
          // And is therefore NOT its own, which is the clean test failing.
          expect(got, `instance ${i} would fail the clean assertion`).not.toEqual(
            expectedTintBytes(i),
          );
        }
      });

      it("reversing the u32 ids reverses the decoded red bytes", () => {
        const c = caseOf(reversed, "u32-default-gpuType");
        expect(reds(c)).toEqual([3, 2, 1, 0].map(expectedIdByte));
        expect(reds(c)).not.toEqual([0, 1, 2, 3].map(expectedIdByte));
      });

      it("deleting the attribute blanks the float quad and refuses the integer draw", () => {
        const tint = caseOf(dropped, "f32-tint");
        for (let i = 0; i < N; i++) {
          // A disabled FLOAT vertex attribute reads as the constant
          // (0,0,0,1), so the quad is black — but alpha 255 proves the
          // fragment ran and the harness is not reporting a blank target.
          expect(rgb(tint.samples[i]), `instance ${i} with no "tint" attribute`).toEqual([0, 0, 0]);
          expect(tint.samples[i].a).toBe(255);
        }
        // The INTEGER case behaves differently and the title has to say
        // so: `in uint` with no bound integer attribute is not a
        // constant, it is invalid, so WebGL2 refuses the draw outright
        // and no fragment appears. Asserting only "the reds changed"
        // would have been satisfied by a blank readback and would have
        // let the harness pass while drawing nothing at all.
        const id = caseOf(dropped, "u32-default-gpuType");
        expect(reds(id)).not.toEqual([0, 1, 2, 3].map(expectedIdByte));
        expect(id.samples.map((s) => s.a), "the integer draw was refused").toEqual([0, 0, 0, 0]);
        expect(id.glErrors.length, "and the driver said so").toBeGreaterThan(0);
      });

      it("the WebGPU cases move too, so their green is not a fixed picture", (ctx) => {
        const before = clean.webgpu.find((c) => c.name === "u32-default-gpuType");
        const after = reversed.webgpu.find((c) => c.name === "u32-default-gpuType");
        if (before?.samples.length && after?.samples.length) {
          expect(after.samples.map((s) => s.r)).toEqual([3, 2, 1, 0].map(expectedIdByte));
          expect(after.samples).not.toEqual(before.samples);
          return;
        }
        // The page reports an unavailable WebGPU as ONE sentinel entry
        // named "webgpu", not as a skipped entry per case, so looking
        // the reason up by case name finds nothing and the skip would
        // read "no WebGPU cases ran" when the page knew exactly why.
        ctx.skip(webgpuSkipReason());
      });
    });

    /**
     * `WebGPURenderer`, which `docs/authoring.md` calls the supported
     * host for per-instance data and which no test in this repo had ever
     * drawn with. The same two channels, through `NodeMaterial` and a
     * TSL `attribute()` instead of a `ShaderMaterial`, on the real
     * WebGPU backend (a fallback to its WebGL backend skips instead —
     * that would be measuring the WebGL path twice).
     *
     * Each test asserts twice, and the order is deliberate. FIRST the
     * renderer-independent claim: four channel values arrive as four
     * distinct per-instance values, in the right order. That is the
     * library's actual business and it survives any per-channel monotone
     * output transform. THEN the strong claim: the bytes equal the WebGL
     * readback exactly. Measured, they do — the node pipeline applies no
     * output transform when the destination is a render target — but it
     * is three's behaviour rather than this library's, so it is asserted
     * second and says so when it breaks.
     */
    describe("under WebGPURenderer", () => {
      /**
       * A drawn case, or a DYNAMIC SKIP naming why there is none.
       *
       * Not an early `return`: a WebGPU-less machine would then report a
       * passing test that asserted nothing, which is the exact failure
       * mode this whole file was written to stop shipping.
       */
      function gpuCase(name: string, ctx: { skip: (note?: string) => void }): CaseResult {
        const found = clean.webgpu.find((c) => c.name === name);
        if (found === undefined || found.skipped !== undefined) {
          ctx.skip(found?.skipped ?? webgpuSkipReason());
          throw new Error("unreachable: ctx.skip aborts");
        }
        return found;
      }

      it("an f32 channel drives four distinct instance colours", (ctx) => {
        const c = gpuCase("f32-tint", ctx);
        for (let i = 0; i < N; i++) {
          expect(c.samples[i].a, `instance ${i}: a fragment was written`).toBe(255);
        }
        expect(new Set(c.samples.map((s) => `${s.r},${s.g},${s.b}`)).size).toBe(N);
        // Red rank order follows tint.r * gain — 0.2, 0.4, 0.4, 0.3 —
        // so instance 0 is darkest and 3 sits between it and 1.
        expect(c.samples[0].r).toBeLessThan(c.samples[3].r);
        expect(c.samples[3].r).toBeLessThan(c.samples[1].r);
        expect(
          c.samples,
          "WebGPURenderer disagreed with WebGLRenderer on the same channel — an output " +
            "colour transform on the render-target path would do this; the channel itself " +
            "arrived (the assertions above passed)",
        ).toEqual(caseOf(clean, "f32-tint").samples);
      });

      it("a u32 channel above 2^24 arrives without collapsing", (ctx) => {
        const c = gpuCase("u32-default-gpuType", ctx);
        const r = reds(c);
        expect(new Set(r).size, `four ids, read back as ${r.join(", ")}`).toBe(N);
        for (let i = 1; i < N; i++) expect(r[i]).toBeGreaterThan(r[i - 1]);
        // `WebGPUAttributeUtils` maps `Uint32Array` to the `uint32`
        // vertex format from the array alone, so `gpuType` is no more
        // load-bearing here than it is on the WebGL side.
        expect(r).toEqual([0, 1, 2, 3].map(expectedIdByte));
      });
    });
  },
);
