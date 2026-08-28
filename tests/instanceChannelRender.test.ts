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
  SHARED_FIRST,
  SHARED_SECOND,
  TINTS,
  expectedIdByte,
  expectedTintBytes,
  expectedWidenedIdByte,
} from "./support/instanceChannelFixture.js";
import {
  browserSuiteName,
  openHarness,
  probeBrowser,
  type ConsoleLine,
  type Harness,
} from "./support/instanceChannelHarness.js";
import type { CaseResult, RunResult, Sample } from "./support/instanceChannelPage.js";

const PROBE = probeBrowser();

/**
 * The two cases whose whole subject is a WRONG PICTURE WITH NO
 * COMPLAINT: a material declaring a channel the batch does not publish,
 * and a second batch of one asset id that carries no channel while its
 * sibling does. Run alone so the tab's log can be attributed to them.
 */
const SILENT_CASES = ["declared-absent-f32", "shared-asset-unchannelled-batch"] as const;

/** The control for that measurement: a case that DOES make the driver talk. */
const LOUD_CASE = "declared-absent-u32";

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
    let provided: RunResult;
    let silentLines: readonly ConsoleLine[];
    let loudLines: readonly ConsoleLine[];
    let nodeLines: readonly ConsoleLine[];
    let nodeFixedLines: readonly ConsoleLine[];
    let nodeRun: RunResult;
    let nodeFixedRun: RunResult;

    beforeAll(async () => {
      harness = await openHarness();
      // One page, four evaluations: the browser launch is the expensive
      // part and the sabotage runs are the proof that the clean run's
      // assertions are not vacuous.
      clean = await harness.run({ webgpu: true });
      reversed = await harness.run({ sabotage: "reverse", webgpu: true });
      dropped = await harness.run({ sabotage: "drop" });
      // The missing-channel cases' knob, and it runs the other way round
      // from the sabotage runs: those BREAK a working case, this FIXES a
      // broken one. Same page, same materials, same draw — the only
      // difference is that the batch publishes the channel the material
      // declares.
      provided = await harness.run({ provideChannels: true, webgpu: true });
      // Two more evaluations, of ONE case each, and they measure the
      // console rather than the pixels. The tab's log has no case
      // boundaries in it, so attributing a line — or the absence of one —
      // to a case means running that case alone. The second run is the
      // CONTROL: an instrument that reports "nothing was said" has to be
      // shown saying "something was said" on a case that does say
      // something, or it is only measuring its own blind spot.
      await harness.settle();
      const beforeSilent = harness.console.length;
      await harness.run({ only: [...SILENT_CASES] });
      await harness.settle();
      silentLines = harness.console.slice(beforeSilent);
      await harness.run({ only: [LOUD_CASE] });
      await harness.settle();
      loudLines = harness.console.slice(beforeSilent + silentLines.length);
      // And the same case AGAIN with the node pipeline switched on. The
      // WebGL half of this run is one of the two just shown to print
      // nothing, so whatever appears here is the WebGPU half's.
      const beforeNode = harness.console.length;
      nodeRun = await harness.run({ only: ["declared-absent-f32"], webgpu: true });
      await harness.settle();
      nodeLines = harness.console.slice(beforeNode);
      const beforeNodeFixed = harness.console.length;
      nodeFixedRun = await harness.run({
        only: ["declared-absent-f32"],
        webgpu: true,
        provideChannels: true,
      });
      await harness.settle();
      nodeFixedLines = harness.console.slice(beforeNodeFixed);
      if (process.env.PCG_CHANNEL_DEBUG === "1") {
        const compact = (run: RunResult, label: string): unknown => ({
          label,
          webgl: run.webgl.map((c) => ({
            name: c.name,
            rgba: c.samples.map((s) => [s.r, s.g, s.b, s.a]),
            bg: [c.background.r, c.background.g, c.background.b, c.background.a],
            glErrors: c.glErrors,
            programs: c.programs,
          })),
          webgpu: run.webgpu.map((c) => ({
            name: c.name,
            skipped: c.skipped,
            error: c.error,
            rgba: c.samples.map((s) => [s.r, s.g, s.b, s.a]),
            bg: [c.background.r, c.background.g, c.background.b, c.background.a],
          })),
        });
        console.log(
          "PCG_CHANNEL_DEBUG " +
            JSON.stringify(
              {
                renderer: clean.renderer,
                runs: [
                  compact(clean, "clean"),
                  compact(reversed, "reverse"),
                  compact(dropped, "drop"),
                  compact(provided, "provided"),
                ],
                pageErrors: harness.errors,
                pageConsole: harness.console,
                silentLines,
                loudLines,
                nodeLines,
                nodeFixedLines,
                nodeRun: compact(nodeRun, "nodeRun"),
                nodeFixedRun: compact(nodeFixedRun, "nodeFixedRun"),
              },
              null,
              1,
            ),
        );
      }
    }, HARNESS_TIMEOUT_MS);

    // Same budget as the setup hook, and for the same reason: closing a
    // headed Chrome is not instant, and under a full-suite run it competes
    // with everything else for the machine. Vitest's default 10 s hook
    // timeout is enough in isolation and is NOT enough in a full run, which
    // reddened the file twice with all twelve tests passing -- a failure
    // that reports as a suite error and names no assertion.
    afterAll(async () => {
      await harness?.close();
    }, HARNESS_TIMEOUT_MS);

    const webgpuSkipReason = (): string => webgpuSkipReasonFrom([clean, reversed]);

    /**
     * The cases whose whole subject is a draw that DOES NOT happen: a
     * type mismatch the driver refuses, and an integer attribute the
     * material declares and nothing binds. Each has its own test, and
     * both would fail the blanket "a fragment was written" sweep below
     * for the reason they exist.
     */
    const DRAWS_NOTHING = new Set(["u32-declared-float", "declared-absent-u32"]);

    it("the browser drew: every instance wrote a fragment and the background did not", () => {
      expect(harness.errors, "the page raised no errors").toEqual([]);
      for (const c of clean.webgl) {
        expect(c.background.a, `${c.name}: the row above the instances is untouched clear`).toBe(0);
        if (DRAWS_NOTHING.has(c.name)) continue; // see their own tests
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
     * A CHANNEL THE MATERIAL DECLARES AND NO BATCH CARRIES.
     *
     * The failure an integrator actually hits, and it is not "the names
     * disagree" — a host whose shader owns the attribute names carries a
     * map from the graph's channel names onto its own, and a map entry
     * can be stale. Nothing about that is malformed: the batch is a valid
     * channelled batch, the material is a valid material, and neither
     * knows the other exists. `toInstancedMeshes` binds what the batch
     * carries; the shader declares what it declares.
     *
     * MEASURED, on this machine, in the run this file already had: an
     * absent FLOAT attribute reads 0 for every instance, every fragment
     * runs, no GL error is queued, and the picture is every instance
     * identical. The `provided` run is the proof — the same page, the
     * same materials, the same draw, with the batch publishing the name
     * the material declares — and it draws the four colours.
     *
     * WHETHER ANYTHING SAYS SO DEPENDS ON THE MATERIAL, and that turned
     * out to be the interesting half. Under a `ShaderMaterial` nothing is
     * printed at any severity: `WebGLBindingStates` has a legitimate
     * meaning for an unbound float attribute (the generic constant) and
     * uses it without comment. Under a `NodeMaterial` three's
     * `AttributeNode` looks the name up on the geometry as it builds and
     * warns BY NAME. Same batch, same mistake, a diagnostic in one host
     * and none in the other — both pinned below.
     *
     * Two neighbours are pinned beside it because they are NOT the same
     * failure and the documentation has to be able to tell them apart:
     * an absent INTEGER attribute is refused outright (`0x502`, no
     * fragment, a driver warning), and a second batch of the same asset
     * id carrying no channel at all shades zeros through the program its
     * channelled sibling compiled.
     *
     * This is three's behaviour, not the library's. It is pinned here
     * because the channel feature is what hands it to people.
     */
    describe("a channel the material declares and no batch carries", () => {
      const BLACK: [number, number, number] = [0, 0, 0];

      /**
       * The WebGPU case of ONE named run, or a skip naming why there is
       * none — the three states kept apart.
       *
       * A console measurement has to separate "the case ran and said
       * nothing" from "the case never ran", because both look like an
       * empty list and only the first is a finding. Everything below is
       * required before a slice of the log may be attributed:
       *
       * - the page reported a case at all (an absent `navigator.gpu`, a
       *   WebGL-backend fallback and a thrown init all arrive as one
       *   sentinel entry named "webgpu" carrying `skipped`),
       * - it did not throw mid-draw (`error`),
       * - and it actually produced `N` samples.
       *
       * Anything else is `ctx.skip` with the page's own words. Never a
       * pass, never a fail: a machine with no WebGPU has not disproved
       * three's warning, and must not be allowed to say it has.
       */
      function drewOrSkip(run: RunResult, ctx: { skip: (note?: string) => void }): CaseResult {
        const found = run.webgpu.find((c) => c.name === "declared-absent-f32");
        const why =
          found === undefined
            ? (run.webgpu.find((c) => c.skipped !== undefined)?.skipped ??
              webgpuSkipReasonFrom([run, clean, reversed]))
            : (found.skipped ??
              (found.error !== undefined
                ? `the WebGPU case threw instead of drawing: ${found.error}`
                : found.samples.length !== N
                  ? `the WebGPU case reported ${found.samples.length} samples, expected ${N}`
                  : undefined));
        if (found === undefined || why !== undefined) {
          ctx.skip(why ?? "the page ran no WebGPU case for this run");
          throw new Error("unreachable: ctx.skip aborts");
        }
        return found;
      }

      it("an absent f32 channel reads zero for every instance, with no error anywhere", () => {
        const c = caseOf(clean, "declared-absent-f32");
        for (let i = 0; i < N; i++) {
          expect(rgb(c.samples[i]), `instance ${i} reads the absent channel as zero`).toEqual(BLACK);
          // The fragment RAN. A drawn black and an untouched target are
          // the same three bytes and completely different events, and
          // alpha is the byte that separates them (see the page header).
          expect(c.samples[i].a, `instance ${i}: the fragment ran and wrote black`).toBe(255);
        }
        // ONE value across every instance — which on screen is "every
        // instance identical", the shape a per-instance size or phase
        // collapses to and the reason this is missed.
        expect(new Set(c.samples.map((s) => `${s.r},${s.g},${s.b}`)).size).toBe(1);
        expect(c.glErrors, "the driver queued nothing").toEqual([]);
      });

      it("and the same page draws the four colours once the batch publishes that name", () => {
        const fixed = caseOf(provided, "declared-absent-f32");
        for (let i = 0; i < N; i++) {
          expect(rgb(fixed.samples[i]), `instance ${i}`).toEqual(expectedTintBytes(i));
        }
        // Byte for byte the working case's own pixels, from the same run:
        // the material was always able to draw this, so the zeros above
        // are the ABSENCE of the column and nothing else about the case.
        expect(fixed.samples).toEqual(caseOf(provided, "f32-tint").samples);
        expect(
          fixed.samples,
          "the clean run's zeros and this run's colours must differ, or the knob does nothing",
        ).not.toEqual(caseOf(clean, "declared-absent-f32").samples);
      });

      it("an absent INTEGER channel is the loud one: the draw is refused", () => {
        const c = caseOf(clean, "declared-absent-u32");
        expect(c.samples.map((s) => s.a), "no fragment was written anywhere").toEqual([0, 0, 0, 0]);
        expect(c.glErrors, "WebGL2 INVALID_OPERATION").toContain("0x502");
        // Same case, same material, channel published: it draws. So the
        // refusal is the missing declaration's, not the machine's.
        const fixed = caseOf(provided, "declared-absent-u32");
        expect(reds(fixed)).toEqual([0, 1, 2, 3].map(expectedIdByte));
        expect(fixed.glErrors).toEqual([]);
      });

      it("a second batch of one asset id, carrying no channel, shades zeros through its sibling's program", () => {
        const c = caseOf(clean, "shared-asset-unchannelled-batch");
        // The CHANNELLED batch in the same scene draws correctly, so "the
        // case was broken" is not an available explanation for the other
        // two columns.
        for (const i of SHARED_FIRST) {
          expect(rgb(c.samples[i]), `instance ${i} is in the channelled batch`).toEqual(
            expectedTintBytes(i),
          );
        }
        for (const i of SHARED_SECOND) {
          expect(rgb(c.samples[i]), `instance ${i} is in the batch with no channel`).toEqual(BLACK);
          expect(c.samples[i].a, `instance ${i}: the fragment ran`).toBe(255);
        }
        expect(c.glErrors, "and nothing was refused").toEqual([]);
        // TWO meshes, ONE program: the unchannelled mesh is not drawing
        // through a pipeline of its own that happens to be missing an
        // attribute, it is drawing through the pipeline its sibling
        // compiled WITH those attributes. That is the integrator's
        // report, as a number.
        expect(c.meshes, "two batches of one asset id are two meshes").toBe(2);
        expect(c.programs, "compiled once and shared").toBe(1);
        expect(caseOf(clean, "f32-tint").meshes, "and one batch is one mesh").toBe(1);
      });

      it("that second batch draws correctly the moment it carries the channel too", () => {
        const c = caseOf(provided, "shared-asset-unchannelled-batch");
        for (let i = 0; i < N; i++) {
          expect(rgb(c.samples[i]), `instance ${i}`).toEqual(expectedTintBytes(i));
        }
        expect(c.samples).not.toEqual(caseOf(clean, "shared-asset-unchannelled-batch").samples);
      });

      /**
       * THE SUBSTANTIVE HALF: not "the pixels are wrong" but "nothing
       * said so". Two extra evaluations in the setup hook draw the silent
       * cases alone and then the loud one alone, because the tab's log
       * has no case boundaries in it and a line can only be attributed to
       * a case that ran by itself.
       *
       * The control is asserted FIRST and it is not decoration: a console
       * hook that had come unwired, or a snapshot taken before the
       * browser process flushed, would report "nothing was printed" for
       * everything. The loud case is the same instrument, in the same
       * session, hearing something.
       */
      it("and under WebGL nothing is printed at any severity — measured against a case that does print", () => {
        expect(
          loudLines.map((l) => `${l.type}: ${l.text}`),
          "the control: the refused integer draw printed something",
        ).not.toEqual([]);
        expect(
          loudLines.every((l) => l.type === "warn"),
          `even the loud one only warns: ${loudLines.map((l) => l.type).join(", ")}`,
        ).toBe(true);
        expect(
          silentLines.map((l) => `${l.type}: ${l.text}`),
          "the two silent cases printed nothing at all — no error, no warning, no log",
        ).toEqual([]);
      });

      /**
       * AND THE NODE PIPELINE IS NOT SILENT, which is the one place the
       * two renderers genuinely disagree and the reason this measurement
       * is not a footnote.
       *
       * `AttributeNode` looks the attribute up on the geometry when it
       * builds, finds nothing, and says so BY NAME. Nothing on the WebGL
       * side does: `WebGLBindingStates` has a legitimate meaning for an
       * unbound float attribute (the generic constant) and uses it
       * without comment. So an integrator on a `NodeMaterial` has a
       * diagnostic and one on a `ShaderMaterial` has none, from the same
       * batch and the same mistake.
       *
       * This test is also what proves the console hook hears a JS
       * `console.warn` at all: every other line in a MEASURED slice comes
       * from ANGLE through the browser process, so without this one the
       * silence measured above would rest on an untested path. (The tab
       * does print one other JS warning across a session — three's
       * `renderAsync()` deprecation — but it falls in no measured slice,
       * so it cannot stand in for this.)
       *
       * THE GUARD IS ON THE RUN THAT PRODUCED THE LINES, and that is the
       * whole correctness of this test rather than a detail. An absent
       * `navigator.gpu`, a fallback to the WebGL backend, or a device
       * that dies under a loaded full-suite run all produce a WebGPU half
       * that never drew — and therefore no warning. Read as "three stayed
       * silent" that is a fabricated finding; read as "not measurable" it
       * is a skip. Gating on `clean` instead (which is what this did, and
       * which reddened for exactly this reason) checks a DIFFERENT
       * evaluation of the page: WebGPU can be fine in the first run and
       * gone by the sixth.
       */
      it("but the node pipeline DOES name the missing attribute, so the silence is WebGL's alone", (ctx) => {
        const drew = drewOrSkip(nodeRun, ctx);
        const texts = nodeLines.map((l) => `${l.type}: ${l.text}`);
        expect(drew.samples.map(rgb), "the node case drew the zeros these lines describe").toEqual(
          [BLACK, BLACK, BLACK, BLACK],
        );
        for (const name of ["tint", "gain"]) {
          expect(
            texts.some((t) => t.includes("AttributeNode") && t.includes(`"${name}" not found`)),
            `three named the missing "${name}"; it printed: ${texts.join(" | ") || "(nothing)"}`,
          ).toBe(true);
        }
        // A warning, not an error — nothing is thrown and nothing stops.
        expect(nodeLines.every((l) => l.type === "warn"), texts.join(" | ")).toBe(true);
        // And it stops once the column exists — the same case, the same
        // page, the same material, differing only in whether the batch
        // publishes the name. So the warning reports the ABSENCE and is
        // not a fixed noise this pipeline always makes.
        //
        // Guarded the same way, and this direction is the one that would
        // LIE rather than shout: a corrected run whose WebGPU half never
        // drew also prints no `AttributeNode` line, and without the guard
        // that reads as "the warning stopped because the channel is
        // there". Assert it DREW the four colours first, then assert the
        // silence.
        const fixed = drewOrSkip(nodeFixedRun, ctx);
        expect(
          fixed.samples.map(rgb),
          "the corrected run drew the channel, so its silence is attributable",
        ).toEqual([0, 1, 2, 3].map((i) => expectedTintBytes(i)));
        expect(
          nodeFixedLines.filter((l) => l.text.includes("AttributeNode")).map((l) => l.text),
          `no attribute was reported missing; the run printed: ${
            nodeFixedLines.map((l) => `${l.type}: ${l.text}`).join(" | ") || "(nothing)"
          }`,
        ).toEqual([]);
      });

      /**
       * The same question under `WebGPURenderer`, which is the renderer
       * the report came from and a different code path end to end: a
       * `NodeMaterial` with a TSL `attribute()` naming a column the
       * geometry has not got, on the WebGPU backend rather than through
       * `WebGLBindingStates`' generic-attribute fallback.
       *
       * THE PIXELS ONLY. Whether anything was said about it is a separate
       * measurement and a separate answer — see the console test above,
       * which is where this pair stops agreeing.
       */
      it("WebGPURenderer draws the same picture: zeros, with every fragment written", (ctx) => {
        // A THROW would be a perfectly good answer — a better one for an
        // integrator — and it is not what happens. `drewOrSkip` turns one
        // into a skip naming it, so a throw can never read here as a
        // silent zero.
        const c = drewOrSkip(clean, ctx);
        for (let i = 0; i < N; i++) {
          expect(rgb(c.samples[i]), `instance ${i}`).toEqual(BLACK);
          expect(c.samples[i].a, `instance ${i}: the fragment ran`).toBe(255);
        }
        const fixed = provided.webgpu.find((x) => x.name === "declared-absent-f32");
        expect(fixed?.samples.map(rgb), "the same material draws once the column exists").toEqual(
          [0, 1, 2, 3].map((i) => expectedTintBytes(i)),
        );
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
