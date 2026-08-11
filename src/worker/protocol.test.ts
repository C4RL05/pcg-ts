import { MessageChannel } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { createTriangleMesh, type Geometry } from "../data/index.js";
import {
  CookCancelledError,
  GraphValidationError,
  NodeExecutionError,
  makeGeometryItem,
  makeInstancesItem,
  makeValueItem,
} from "../graph/index.js";
import type { CellOutputs } from "../runtime/types.js";
import { geometryDiff, outputsDiff } from "../runtime/testSupport.js";
import {
  decodeError,
  decodeOutputs,
  encodeError,
  encodeOutputs,
  type EncodedOutputs,
} from "./protocol.js";

/**
 * A geometry exercising every attribute type, all four domains, string
 * tables (including the replaced-default edge where table[0] is no longer
 * the current default), and real topology.
 */
function richGeometry(): Geometry {
  const geo = createTriangleMesh(
    [0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1],
    [0, 1, 2, 1, 3, 2],
  );
  const pts = geo.attrs.point;
  const f = pts.add("density", "f32", 1, 0.5);
  const v = pts.add("vel", "f32", 3);
  const i = pts.add("idx", "i32", 1, -1);
  const u = pts.add("seedCol", "u32", 1);
  const b = pts.add("alive", "bool", 1, 1);
  for (let k = 0; k < geo.pointCount; k++) {
    f.set(k, k * 0.25);
    v.setTuple(k, [k, -k, k * 2]);
    i.set(k, k - 2);
    u.set(k, k * 977);
    b.set(k, k % 2);
  }
  // String attr whose default is REPLACED after values were interned, so
  // the table's slot 0 is the old default — the wire format must carry the
  // table verbatim for the u32 indices to stay byte-identical.
  const s = pts.add("species", "string", 1, "oak");
  s.setString(0, "pine");
  s.setString(1, "birch");
  pts.replace("species", "string", 1, "fir");
  const s2 = pts.require("species");
  s2.setString(2, "pine");
  s2.setString(3, "oak");
  // Vertex and detail domain columns, so no domain is trivially empty.
  const vc = geo.attrs.vertex.add("corner", "u32", 1);
  for (let k = 0; k < geo.vertexCount; k++) vc.set(k, k);
  geo.attrs.detail.add("label", "string", 1, "cellA");
  geo.attrs.detail.add("bounds", "f32", 3, [1, 2, 3]);
  return geo;
}

function richOutputs(): CellOutputs {
  return {
    terrain: [makeGeometryItem(richGeometry(), ["ground", "solid"])],
    trees: [
      makeInstancesItem([
        {
          assetId: "tree/oak",
          count: 2,
          transforms: new Float32Array(Array.from({ length: 32 }, (_, k) => k * 0.5)),
          colors: new Float32Array([1, 0.5, 0.25, 0.1, 0.2, 0.3]),
        },
        {
          assetId: "tree/fir",
          count: 1,
          transforms: new Float32Array(Array.from({ length: 16 }, (_, k) => 1 - k)),
        },
      ]),
    ],
    meta: [
      makeValueItem(42),
      makeValueItem("hello", ["tag1"]),
      makeValueItem(true),
      makeValueItem([1.5, -2.5, 3]),
    ],
  };
}

describe("encodeOutputs / decodeOutputs", () => {
  it("round-trips outputs byte-identically, tags included", () => {
    const outputs = richOutputs();
    const { encoded, transfer } = encodeOutputs(outputs);
    const decoded = decodeOutputs(encoded);
    expect(outputsDiff(outputs, decoded)).toBeNull();
    expect([...decoded.terrain[0].tags].sort()).toEqual(["ground", "solid"]);
    expect([...decoded.meta[1].tags]).toEqual(["tag1"]);
    expect(transfer.length).toBeGreaterThan(0);
  });

  it("keeps string-table indices byte-identical across the replaced-default edge", () => {
    const outputs = richOutputs();
    const { encoded } = encodeOutputs(outputs);
    const decoded = decodeOutputs(encoded);
    const src = (outputs.terrain[0] as { geo: Geometry }).geo.attrs.point.require("species");
    const dst = (decoded.terrain[0] as { geo: Geometry }).geo.attrs.point.require("species");
    expect([...dst.stringTable]).toEqual([...src.stringTable]);
    expect(Array.from(dst.data.slice(0, 4))).toEqual(Array.from(src.data.slice(0, 4)));
    // The CURRENT default survives too: a post-decode resize must fill
    // with "fir" (the replacement), not "oak" (table slot 0).
    const set = (decoded.terrain[0] as { geo: Geometry }).geo.attrs.point;
    const count = set.count;
    set.resize(count + 1);
    expect(set.require("species").getString(count)).toBe("fir");
  });

  it("gives decoded items fresh revs", () => {
    const outputs = richOutputs();
    const decoded = decodeOutputs(encodeOutputs(outputs).encoded);
    const srcRevs = new Set(Object.values(outputs).flatMap((c) => c.map((i) => i.rev)));
    for (const collection of Object.values(decoded)) {
      for (const item of collection) expect(srcRevs.has(item.rev)).toBe(false);
    }
  });

  it("transfers buffers for real: sources detach, receiver decodes identically", async () => {
    const outputs = richOutputs();
    const { encoded, transfer } = encodeOutputs(outputs);
    const before = transfer.map((b) => b.byteLength);
    expect(before.every((n) => n > 0)).toBe(true);

    const { port1, port2 } = new MessageChannel();
    const received = new Promise<EncodedOutputs>((resolve) => {
      port2.once("message", (msg: EncodedOutputs) => resolve(msg));
    });
    port1.postMessage(encoded, transfer);
    // Detachment is the proof of transfer: a copied buffer keeps its bytes.
    expect(transfer.every((b) => b.byteLength === 0)).toBe(true);
    const decoded = decodeOutputs(await received);
    port1.close();
    port2.close();
    expect(outputsDiff(outputs, decoded)).toBeNull();
  });

  it("copies rather than detaches the live cook data it encodes", () => {
    const outputs = richOutputs();
    const geo = (outputs.terrain[0] as { geo: Geometry }).geo;
    const snapshot = decodeOutputs(encodeOutputs(outputs).encoded);
    const { encoded, transfer } = encodeOutputs(outputs);
    const { port1, port2 } = new MessageChannel();
    port1.postMessage(encoded, transfer);
    port1.close();
    port2.close();
    // The source geometry (standing in for a worker's live memo cache)
    // still matches the pre-encode snapshot: nothing of its storage was
    // detached by the post.
    expect(geometryDiff(geo, (snapshot.terrain[0] as { geo: Geometry }).geo)).toBeNull();
  });

  it("refuses device-resident instances with the fix in the message", async () => {
    const { makeDeviceInstancesItem } = await import("../graph/data.js");
    const item = makeDeviceInstancesItem([
      {
        residency: "device",
        assetId: "a",
        count: 1,
        transforms: { buffer: {} as never, byteLength: 64, dispose() {} } as never,
      } as never,
    ]);
    expect(() => encodeOutputs({ out: [item] })).toThrow(/device-resident/);
    expect(() => encodeOutputs({ out: [item] })).toThrow(/CPU-only/);
  });
});

describe("encodeError / decodeError", () => {
  it("rehydrates library error classes with messages verbatim", () => {
    const cases: readonly Error[] = [
      new NodeExecutionError("tree-pts", new Error("boom: param x")),
      new CookCancelledError(),
      new GraphValidationError('node "a" has no output pin "nope"'),
    ];
    for (const err of cases) {
      const back = decodeError(encodeError(err));
      expect(back.constructor).toBe(err.constructor);
      expect(back.name).toBe(err.name);
      expect(back.message).toBe(err.message);
    }
    const node = decodeError(encodeError(new NodeExecutionError("tree-pts", new Error("x"))));
    expect((node as NodeExecutionError).nodeId).toBe("tree-pts");
  });

  it("keeps unknown error names on a plain Error", () => {
    const custom = new Error("odd failure");
    custom.name = "SomethingElseError";
    const back = decodeError(encodeError(custom));
    expect(back.name).toBe("SomethingElseError");
    expect(back.message).toBe("odd failure");
  });

  it("stringifies non-Error throws", () => {
    const back = decodeError(encodeError("just a string"));
    expect(back.message).toBe("just a string");
  });
});
