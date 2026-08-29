import {
  BoxGeometry,
  Color,
  InstancedBufferAttribute,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Texture,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import { describe, expect, it } from "vitest";
import { createPointCloud, type AttrData } from "../data/index.js";
import type { InstanceAttributes, InstanceBatch } from "../graph/data.js";
import { buildInstanceBatches } from "../spawn/instances.js";
import {
  materialListOf,
  ownsGeometry,
  ownsMaterial,
  toInstancedMeshes,
  type AssetMap,
} from "./instanced.js";

function assets(...ids: string[]): AssetMap {
  const map: AssetMap = {};
  for (const id of ids) {
    map[id] = { geometry: new BoxGeometry(), material: new MeshBasicMaterial() };
  }
  return map;
}

describe("toInstancedMeshes", () => {
  it("per-instance matrices match three's own Matrix4.compose", () => {
    // Arbitrary transforms; quaternions built by three itself.
    const rows: Array<{ p: Vector3; q: Quaternion; s: Vector3 }> = [
      {
        p: new Vector3(1, 2, 3),
        q: new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.7),
        s: new Vector3(2, 0.5, 1.25),
      },
      {
        p: new Vector3(-4, 0.25, 9),
        q: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2),
        s: new Vector3(1, 1, 1),
      },
      {
        p: new Vector3(0, -1, 0.5),
        q: new Quaternion().setFromAxisAngle(new Vector3(-2, 1, 5).normalize(), 2.4),
        s: new Vector3(0.1, 3, 0.7),
      },
    ];
    const geo = createPointCloud(rows.length);
    const P = geo.attrs.point.require("P");
    const rot = geo.attrs.point.require("rot");
    const scale = geo.attrs.point.require("scale");
    rows.forEach(({ p, q, s }, i) => {
      P.setTuple(i, [p.x, p.y, p.z]);
      rot.setTuple(i, [q.x, q.y, q.z, q.w]);
      scale.setTuple(i, [s.x, s.y, s.z]);
    });

    const batches = buildInstanceBatches(geo, { defaultAssetId: "a" });
    const [mesh] = toInstancedMeshes(batches, assets("a"));
    expect(mesh.count).toBe(rows.length);
    expect(mesh.name).toBe("a");
    expect(mesh.instanceMatrix.array).toHaveLength(rows.length * 16);

    const got = new Matrix4();
    rows.forEach(({ p, q, s }, i) => {
      mesh.getMatrixAt(i, got);
      const expected = new Matrix4().compose(p, q, s);
      // Expected is f64; ours went through f32 storage — compare within 1e-6.
      got.elements.forEach((v, k) => {
        expect(Math.abs(v - expected.elements[k]), `instance ${i} element ${k}`).toBeLessThan(1e-6);
      });
    });
  });

  it("builds one mesh per batch, sharing asset geometry but cloning the material", () => {
    const geo = createPointCloud(3);
    const attr = geo.attrs.point.add("asset", "string", 1, "");
    attr.setString(0, "tree");
    attr.setString(1, "rock");
    attr.setString(2, "tree");
    const batches = buildInstanceBatches(geo, { defaultAssetId: "d", assetAttr: "asset" });
    const map = assets("tree", "rock");
    const meshes = toInstancedMeshes(batches, map);
    expect(meshes.map((m) => m.name)).toEqual(["tree", "rock"]);
    expect(meshes.map((m) => m.count)).toEqual([2, 1]);
    expect(meshes[0].geometry).toBe(map.tree.geometry);
    // The material is a per-mesh CLONE: three's renderer releases a
    // mesh's cached render state only when that mesh's material fires
    // `dispose`, and the asset map's material must never be disposed —
    // so each mesh needs its own (see renderStateRelease.test.ts).
    expect(meshes[0].material).not.toBe(map.tree.material);
    expect((meshes[0].material as Material).type).toBe((map.tree.material as Material).type);
  });

  it("clones per MESH, not per asset: two meshes of one asset get distinct materials", () => {
    const geo = createPointCloud(2);
    const batches = [
      ...buildInstanceBatches(geo, { defaultAssetId: "tree" }),
      ...buildInstanceBatches(geo, { defaultAssetId: "tree" }),
    ];
    const meshes = toInstancedMeshes(batches, assets("tree"));
    expect(meshes).toHaveLength(2);
    expect(meshes[0].material).not.toBe(meshes[1].material);
  });

  it("the clone shares textures by reference — no GPU resource is duplicated", () => {
    const texture = new Texture();
    const material = new MeshBasicMaterial({ map: texture, color: 0x336644 });
    const map: AssetMap = { tree: { geometry: new BoxGeometry(), material } };
    const batches = buildInstanceBatches(createPointCloud(1), { defaultAssetId: "tree" });
    const [mesh] = toInstancedMeshes(batches, map);
    const clone = mesh.material as MeshBasicMaterial;
    expect(clone.map, "textures must be shared, not cloned").toBe(texture);
    expect(clone.color.getHex()).toBe(0x336644);
    // Disposing the clone must not ripple into the shared texture.
    let textureDisposed = 0;
    texture.addEventListener("dispose", () => textureDisposed++);
    clone.dispose();
    expect(textureDisposed).toBe(0);
  });

  it("clones every element of a multi-material asset, and materialListOf sees them all", () => {
    const materials = [new MeshBasicMaterial(), new MeshBasicMaterial()];
    const map: AssetMap = { tree: { geometry: new BoxGeometry(), material: materials } };
    const batches = buildInstanceBatches(createPointCloud(1), { defaultAssetId: "tree" });
    const [mesh] = toInstancedMeshes(batches, map);
    const clones = materialListOf(mesh.material as Material | Material[]);
    expect(clones).toHaveLength(2);
    for (const [i, clone] of clones.entries()) {
      expect(clone, `element ${i} must be a clone`).not.toBe(materials[i]);
    }
  });

  it("a failing later batch disposes the materials the earlier batches minted", () => {
    // The meshes are local to the throwing call — the caller never sees
    // them, so nothing else could ever dispose their clones. Intercept
    // `clone` so every minted material carries a dispose listener from
    // birth.
    const material = new MeshBasicMaterial();
    const minted: Material[] = [];
    const disposed: Material[] = [];
    const originalClone = material.clone.bind(material);
    material.clone = () => {
      const clone = originalClone();
      minted.push(clone);
      clone.addEventListener("dispose", () => disposed.push(clone));
      return clone;
    };
    const map: AssetMap = { tree: { geometry: new BoxGeometry(), material } };
    const good = buildInstanceBatches(createPointCloud(2), { defaultAssetId: "tree" });
    const bad = buildInstanceBatches(createPointCloud(1), { defaultAssetId: "missing" });
    expect(() => toInstancedMeshes([...good, ...bad], map)).toThrow(/unknown assetId "missing"/);
    expect(minted, "the good batch's clone must have been minted first").toHaveLength(1);
    expect(disposed, "…and disposed before the error escaped").toEqual(minted);
    // The asset's own material was never disposed — only the clone.
    let assetDisposed = 0;
    material.addEventListener("dispose", () => assetDisposed++);
    expect(assetDisposed).toBe(0);
  });

  it("unknown assetId throws, listing the known ids", () => {
    const batches = buildInstanceBatches(createPointCloud(1), { defaultAssetId: "bush" });
    expect(() => toInstancedMeshes(batches, assets("tree", "rock"))).toThrow(
      /unknown assetId "bush".*rock, tree/,
    );
    expect(() => toInstancedMeshes(batches, {})).toThrow(/\(none\)/);
  });

  it("rejects a batch whose transform length disagrees with its count", () => {
    expect(() =>
      toInstancedMeshes(
        [{ assetId: "a", count: 2, transforms: new Float32Array(16) }],
        assets("a"),
      ),
    ).toThrow(/count \* 16/);
  });
});

describe("toInstancedMeshes per-instance colour", () => {
  /** Cloud of `n` points at x = i, red channel encoding i / 10. */
  function paintedCloud(n: number) {
    const geo = createPointCloud(n);
    const P = geo.attrs.point.require("P");
    const color = geo.attrs.point.require("color");
    for (let i = 0; i < n; i++) {
      P.setTuple(i, [i, 0, 0]);
      color.setTuple(i, [i / 10, 0.25, 0.5, 0.75]);
    }
    return geo;
  }

  it("leaves instanceColor null when the batch carries no colour", () => {
    // Every cloud has a `color` attribute at [1,1,1,1]; a spawn that did
    // not ask for it must not flip three's instancing-colour variant.
    const batches = buildInstanceBatches(paintedCloud(3), { defaultAssetId: "a" });
    const [mesh] = toInstancedMeshes(batches, assets("a"));
    expect(mesh.instanceColor).toBeNull();
  });

  it("writes instanceColor from a batch that carries colour", () => {
    const batches = buildInstanceBatches(paintedCloud(3), {
      defaultAssetId: "a",
      colorAttr: "color",
    });
    const [mesh] = toInstancedMeshes(batches, assets("a"));
    const instanceColor = mesh.instanceColor;
    if (!instanceColor) throw new Error("expected an instanceColor attribute");
    expect(instanceColor.itemSize).toBe(3);
    expect(instanceColor.count).toBe(3);
    const got = new Color();
    for (let i = 0; i < 3; i++) {
      mesh.getColorAt(i, got);
      expect(got.r).toBeCloseTo(i / 10, 6);
      expect(got.g).toBeCloseTo(0.25, 6);
      expect(got.b).toBeCloseTo(0.5, 6);
    }
  });

  it("copies the colours: the mesh does not alias the batch's buffer", () => {
    const batches = buildInstanceBatches(paintedCloud(2), {
      defaultAssetId: "a",
      colorAttr: "color",
    });
    const [mesh] = toInstancedMeshes(batches, assets("a"));
    (mesh.instanceColor?.array as Float32Array)[0] = 42;
    expect(batches[0].colors?.[0]).toBe(0);
  });

  it("rejects a batch whose colour length disagrees with its count", () => {
    expect(() =>
      toInstancedMeshes(
        [
          {
            assetId: "a",
            count: 2,
            transforms: new Float32Array(32),
            colors: new Float32Array(3),
          },
        ],
        assets("a"),
      ),
    ).toThrow(/count \* 3/);
  });
});

/** The message of the error `fn` throws. Fails loudly when it does not throw. */
function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected the call to throw, but it returned normally");
}

/**
 * Named per-instance channels: the general host ABI beside colour.
 *
 * Two claims run through all of it. The DTYPE is the ABI — a `u32` id
 * arrives as a `Uint32Array` and not as an f32 that lost its low bits —
 * and a channel is an attribute of the GEOMETRY, which is why a channelled
 * batch cannot share the asset map's geometry and why the clone it gets
 * instead has to be disposed with the mesh.
 */
describe("toInstancedMeshes per-instance channels", () => {
  /**
   * Cloud of `n` points carrying a `seed` (u32 past 2^24, where an f32
   * would start losing values), a `phase` (f32) and an `offset` (f32x3).
   */
  function channelledCloud(n: number) {
    const geo = createPointCloud(n);
    const seed = geo.attrs.point.require("seed");
    const phase = geo.attrs.point.add("phase", "f32", 1, 0);
    const offset = geo.attrs.point.add("offset", "f32", 3, [0, 0, 0]);
    for (let i = 0; i < n; i++) {
      seed.set(i, 16777217 + i * 7);
      phase.set(i, i / 4);
      offset.setTuple(i, [i, 10 - i, i * 0.5]);
    }
    return geo;
  }

  /** The geometry attribute a channel became, narrowed to what it must be. */
  function channelAttr(geometry: BufferGeometry, name: string): InstancedBufferAttribute {
    const attr = geometry.getAttribute(name);
    expect(attr, `geometry attribute "${name}"`).toBeInstanceOf(InstancedBufferAttribute);
    return attr as InstancedBufferAttribute;
  }

  it("every non-colour channel becomes an InstancedBufferAttribute of its own name", () => {
    const batches = buildInstanceBatches(channelledCloud(3), {
      defaultAssetId: "a",
      instanceAttrs: ["seed", "phase", "offset"],
    });
    const [mesh] = toInstancedMeshes(batches, assets("a"));

    const seed = channelAttr(mesh.geometry, "seed");
    // The dtype survives: a `u32` id reaches the shader as an integer,
    // not as an f32 that rounded 2^24 + 1 down to 2^24.
    expect(seed.array).toBeInstanceOf(Uint32Array);
    expect(seed.itemSize, "item size is derived as length / count").toBe(1);
    expect(seed.count).toBe(3);
    expect(Array.from(seed.array)).toEqual([16777217, 16777224, 16777231]);
    // A COPY, like the transforms: the batch belongs to a cached graph
    // item that may back several meshes.
    expect(seed.array, "the mesh must not alias the batch's column").not.toBe(
      batches[0].attributes?.seed,
    );

    const offset = channelAttr(mesh.geometry, "offset");
    expect(offset.array).toBeInstanceOf(Float32Array);
    expect(offset.itemSize, "a 3-tuple attribute is 3 components per instance").toBe(3);
    expect(offset.count).toBe(3);
    expect(Array.from(offset.array)).toEqual([0, 10, 0, 1, 9, 0.5, 2, 8, 1]);
    expect(offset.array).not.toBe(batches[0].attributes?.offset);

    const phase = channelAttr(mesh.geometry, "phase");
    expect(phase.array).toBeInstanceOf(Float32Array);
    expect(phase.itemSize).toBe(1);
    expect(Array.from(phase.array)).toEqual([0, 0.25, 0.5]);
  });

  it("a channelled batch owns a geometry clone; a bare or merely coloured one shares", () => {
    const map = assets("a");

    const [bare] = toInstancedMeshes(
      buildInstanceBatches(createPointCloud(2), { defaultAssetId: "a" }),
      map,
    );
    expect(bare.geometry, "no channels: the asset map's own geometry").toBe(map.a.geometry);
    expect(ownsGeometry(bare)).toBe(false);

    // Instance colour hangs on the MESH (`instanceColor`), not on the
    // geometry, so a coloured spawn must not force a clone either.
    const [coloured] = toInstancedMeshes(
      buildInstanceBatches(createPointCloud(2), { defaultAssetId: "a", colorAttr: "color" }),
      map,
    );
    expect(coloured.instanceColor).not.toBeNull();
    expect(coloured.geometry, "colour alone still shares the asset geometry").toBe(map.a.geometry);
    expect(ownsGeometry(coloured)).toBe(false);

    const [channelled] = toInstancedMeshes(
      buildInstanceBatches(channelledCloud(2), { defaultAssetId: "a", instanceAttrs: ["seed"] }),
      map,
    );
    expect(channelled.geometry, "a channel is an attribute OF the geometry").not.toBe(
      map.a.geometry,
    );
    expect(ownsGeometry(channelled)).toBe(true);
    expect(map.a.geometry.hasAttribute("seed"), "the asset's geometry is untouched").toBe(false);
  });

  it("two channelled batches of ONE asset get two clones that cannot see each other", () => {
    const map = assets("a");
    const first = buildInstanceBatches(channelledCloud(2), {
      defaultAssetId: "a",
      instanceAttrs: ["seed"],
    });
    const otherCloud = channelledCloud(2);
    const otherSeed = otherCloud.attrs.point.require("seed");
    otherSeed.set(0, 900);
    otherSeed.set(1, 901);
    const second = buildInstanceBatches(otherCloud, {
      defaultAssetId: "a",
      instanceAttrs: ["seed"],
    });

    const meshes = toInstancedMeshes([...first, ...second], map);
    expect(meshes).toHaveLength(2);
    expect(meshes[0].geometry).not.toBe(meshes[1].geometry);
    expect(ownsGeometry(meshes[0]) && ownsGeometry(meshes[1])).toBe(true);
    // Sharing one geometry would publish the last cook's ids to every
    // mesh drawing the asset; each clone holds only its own batch's.
    expect(Array.from(channelAttr(meshes[0].geometry, "seed").array)).toEqual([
      16777217, 16777224,
    ]);
    expect(Array.from(channelAttr(meshes[1].geometry, "seed").array)).toEqual([900, 901]);
    expect(map.a.geometry.hasAttribute("seed"), "and neither reached the asset").toBe(false);
  });

  it("the documented dispose sequence frees the clone and never the asset geometry", () => {
    const map = assets("a");
    const [mesh] = toInstancedMeshes(
      buildInstanceBatches(channelledCloud(3), { defaultAssetId: "a", instanceAttrs: ["seed"] }),
      map,
    );
    expect(ownsGeometry(mesh)).toBe(true);
    let cloneDisposed = 0;
    let assetDisposed = 0;
    mesh.geometry.addEventListener("dispose", () => cloneDisposed++);
    map.a.geometry.addEventListener("dispose", () => assetDisposed++);

    // Exactly the three-part teardown `toInstancedMeshes` documents and
    // `WorldThreeBinding` runs on every release path.
    mesh.dispose();
    for (const material of materialListOf(mesh.material)) material.dispose();
    if (ownsGeometry(mesh)) mesh.geometry.dispose();

    expect(cloneDisposed, "a per-batch clone nothing disposes is the leak").toBe(1);
    expect(assetDisposed, "the asset map owns the shared geometry").toBe(0);
  });

  it("a failing later batch disposes the geometry clones the earlier ones minted", () => {
    // The meshes are local to the throwing call, so nothing else could
    // ever dispose their clones. Intercept `clone` so every minted
    // geometry carries a dispose listener from birth.
    const geometry = new BoxGeometry();
    const minted: BufferGeometry[] = [];
    const disposed: BufferGeometry[] = [];
    const originalClone = geometry.clone.bind(geometry);
    geometry.clone = () => {
      const clone = originalClone();
      minted.push(clone);
      clone.addEventListener("dispose", () => disposed.push(clone));
      return clone;
    };
    let assetDisposed = 0;
    geometry.addEventListener("dispose", () => assetDisposed++);
    const map: AssetMap = { tree: { geometry, material: new MeshBasicMaterial() } };

    const good = buildInstanceBatches(channelledCloud(2), {
      defaultAssetId: "tree",
      instanceAttrs: ["seed"],
    });
    const bad = buildInstanceBatches(createPointCloud(1), { defaultAssetId: "missing" });
    expect(() => toInstancedMeshes([...good, ...bad], map)).toThrow(/unknown assetId "missing"/);
    expect(minted, "the channelled batch cloned the asset geometry").toHaveLength(1);
    expect(disposed, "…and it was disposed before the error escaped").toEqual(minted);
    expect(assetDisposed, "only the clone; never the asset's own").toBe(0);
  });

  it("refuses a channel named after a geometry attribute three already means something by", () => {
    for (const name of ["position", "normal"]) {
      const message = messageOf(() =>
        toInstancedMeshes(
          [
            {
              assetId: "a",
              count: 2,
              transforms: new Float32Array(32),
              attributes: { [name]: new Float32Array(6) },
            },
          ],
          assets("a"),
        ),
      );
      expect(message).toContain(
        `toInstancedMeshes: batch "a" carries a per-instance channel named "${name}"`,
      );
      expect(message).toContain("would overwrite the asset's own vertex data");
      expect(message).toContain(
        "Rename the point attribute upstream (setAttribute) and name the new one in " +
          "spawnInstances' instanceAttrs",
      );
      expect(message).toContain(
        "Reserved: instanceColor, instanceMatrix, normal, position, skinIndex, skinWeight, " +
          "tangent, uv, uv1, uv2, uv3.",
      );
    }
  });

  it("refuses a channel whose length is not a whole number of components per instance", () => {
    const message = messageOf(() =>
      toInstancedMeshes(
        [
          {
            assetId: "a",
            count: 3,
            transforms: new Float32Array(48),
            attributes: { seed: new Uint32Array(5) },
          },
        ],
        assets("a"),
      ),
    );
    expect(message).toContain('toInstancedMeshes: batch "a" channel "seed" has 5 elements');
    expect(message).toContain("not a whole number per instance for 3 instances");
    expect(message).toContain(
      "a channel is count * itemSize elements and its item size is recovered as length / count",
    );
  });

  it("refuses a channel wider than a vertex attribute can carry", () => {
    // The SPAWNER carries a 5-tuple happily — the dtype and tuple size are
    // the point domain's — so this ceiling is the renderer's, and the
    // message has to say what to do about it upstream.
    const geo = createPointCloud(2);
    geo.attrs.point.add("wide", "f32", 5, [0, 0, 0, 0, 0]);
    const batches = buildInstanceBatches(geo, { defaultAssetId: "a", instanceAttrs: ["wide"] });
    expect(batches[0].attributes?.wide).toHaveLength(10);

    const message = messageOf(() => toInstancedMeshes(batches, assets("a")));
    expect(message).toContain(
      'toInstancedMeshes: batch "a" channel "wide" is 5 components per instance',
    );
    expect(message).toContain("a vertex attribute carries at most 4");
    expect(message).toContain(
      "Split the point attribute into several narrower ones upstream and name each in " +
        "instanceAttrs.",
    );
  });

  it("a zero-instance batch with an empty channel binds nothing and clones nothing", () => {
    const map = assets("a");
    const [mesh] = toInstancedMeshes(
      [
        {
          assetId: "a",
          count: 0,
          transforms: new Float32Array(0),
          attributes: { seed: new Uint32Array(0) },
        },
      ],
      map,
    );
    expect(mesh.count).toBe(0);
    // No instances means no recoverable item size (it is length / count)
    // and no attribute worth binding — so nothing to own either.
    expect(mesh.geometry.hasAttribute("seed")).toBe(false);
    expect(mesh.geometry).toBe(map.a.geometry);
    expect(ownsGeometry(mesh)).toBe(false);
  });

  it("refuses a zero-instance batch whose channel still holds elements", () => {
    const message = messageOf(() =>
      toInstancedMeshes(
        [
          {
            assetId: "a",
            count: 0,
            transforms: new Float32Array(0),
            attributes: { seed: new Uint32Array(3) },
          },
        ],
        assets("a"),
      ),
    );
    expect(message).toContain(
      'toInstancedMeshes: batch "a" declares 0 instances but its "seed" channel has 3 elements',
    );
  });

  it("colour rides instanceColor and never becomes a geometry attribute", () => {
    const map = assets("a");
    const geo = createPointCloud(2);
    const color = geo.attrs.point.require("color");
    color.setTuple(0, [0.5, 0.25, 0.125, 1]);
    color.setTuple(1, [1, 0, 0, 1]);
    const [mesh] = toInstancedMeshes(
      buildInstanceBatches(geo, { defaultAssetId: "a", colorAttr: "color" }),
      map,
    );
    expect(mesh.instanceColor?.itemSize).toBe(3);
    expect(
      mesh.geometry.hasAttribute("color"),
      "instanceColor is a MESH property that flips the shader variant, not an attribute",
    ).toBe(false);
    expect(mesh.geometry).toBe(map.a.geometry);
    expect(ownsGeometry(mesh)).toBe(false);
  });

  it("…and the same for a batch carrying colour as the reserved channel by hand", () => {
    // `instanceAttributesOf` reads one record whether the batch spelled
    // colour as `colors` or as `attributes.color`, so the reserved channel
    // must take the identical path: the mesh, never the geometry.
    const map = assets("a");
    const [mesh] = toInstancedMeshes(
      [
        {
          assetId: "a",
          count: 2,
          transforms: new Float32Array(32),
          attributes: { color: new Float32Array([0.5, 0.25, 0.125, 1, 0, 0]) },
        },
      ],
      map,
    );
    const instanceColor = mesh.instanceColor;
    if (!instanceColor) throw new Error("expected an instanceColor attribute");
    expect(instanceColor.itemSize).toBe(3);
    expect(instanceColor.count).toBe(2);
    expect(Array.from(instanceColor.array)).toEqual([0.5, 0.25, 0.125, 1, 0, 0]);
    expect(mesh.geometry.hasAttribute("color")).toBe(false);
    expect(mesh.geometry).toBe(map.a.geometry);
    expect(ownsGeometry(mesh)).toBe(false);
  });

  it("paints a HAND-BUILT batch that spells colour beside an empty attributes record", () => {
    // The shape a host writes when it fills `attributes` generically and
    // finds no named channel to put in it. Colour used to reach the
    // adapter as nothing at all: `instanceAttributesOf` tested
    // `attributes !== undefined`, an empty record passed, and the plain
    // `colors` was never lifted. Nothing about the batch is wrong, so
    // there was no error either — just an unpainted mesh.
    const map = assets("a");
    const [mesh] = toInstancedMeshes(
      [
        {
          assetId: "a",
          count: 2,
          transforms: new Float32Array(32),
          attributes: {},
          colors: new Float32Array([0.5, 0.25, 0.125, 1, 0, 0]),
        },
      ],
      map,
    );
    const instanceColor = mesh.instanceColor;
    if (!instanceColor) throw new Error("expected an instanceColor attribute");
    expect(Array.from(instanceColor.array)).toEqual([0.5, 0.25, 0.125, 1, 0, 0]);
  });

  it("paints a HAND-BUILT batch that spells colour beside OTHER named channels", () => {
    // The same defect one channel later: a non-empty record is still not
    // a record that says "no colour".
    const map = assets("a");
    const [mesh] = toInstancedMeshes(
      [
        {
          assetId: "a",
          count: 2,
          transforms: new Float32Array(32),
          attributes: { phase: new Float32Array([0.25, 0.75]) },
          colors: new Float32Array([0.5, 0.25, 0.125, 1, 0, 0]),
        },
      ],
      map,
    );
    expect(Array.from(mesh.instanceColor?.array ?? [])).toEqual([0.5, 0.25, 0.125, 1, 0, 0]);
    // …and the named channel still lands on the geometry clone.
    expect(Array.from(channelAttr(mesh.geometry, "phase").array)).toEqual([0.25, 0.75]);
    expect(ownsGeometry(mesh)).toBe(true);
  });
});

/**
 * THE OPT-IN CHANNEL EXPECTATION.
 *
 * `toInstancedMeshes` binds what the batch carries and never learns what
 * the material declares, so the two can disagree with nothing malformed on
 * either side — and `tests/instanceChannelRender.test.ts` draws what
 * happens then: the declared-but-unbound float attribute reads zero for
 * every instance, every fragment runs and writes black, no GL error is
 * queued, and a `ShaderMaterial` under WebGL prints nothing at any
 * severity. `requireChannels` is how a caller that DOES know its material's
 * attribute names turns that picture into a named error.
 *
 * The names below (`tint`, `gain`) are the render suite's, so the two files
 * read as one story.
 */
describe("toInstancedMeshes requireChannels", () => {
  /** Cloud of `n` points carrying a `tint` (f32x3) and a `gain` (f32). */
  function tintedCloud(n: number) {
    const geo = createPointCloud(n);
    const tint = geo.attrs.point.add("tint", "f32", 3, [0, 0, 0]);
    const gain = geo.attrs.point.add("gain", "f32", 1, 0);
    for (let i = 0; i < n; i++) {
      tint.setTuple(i, [i / 4, 0.5, 1 - i / 4]);
      gain.set(i, 0.25 + i / 8);
    }
    return geo;
  }

  it("changes nothing for a caller that does not ask", () => {
    // The whole feature's first constraint: a host that passes nothing —
    // or an empty options object, or an empty list — must get the meshes
    // it always got. Plenty of callers legitimately draw batches with no
    // channels at all, and this is the batch shape that would break first.
    const bare = buildInstanceBatches(createPointCloud(3), { defaultAssetId: "a" });
    for (const options of [undefined, {}, { requireChannels: [] }]) {
      const [mesh] = toInstancedMeshes(bare, assets("a"), options);
      expect(mesh.count, `options ${JSON.stringify(options)}`).toBe(3);
      expect(mesh.geometry.hasAttribute("tint")).toBe(false);
      expect(ownsGeometry(mesh)).toBe(false);
    }
  });

  it("passes a batch that carries everything asked for, and does not mind extras", () => {
    // The other half of "no false positive": the check must be satisfiable,
    // and a batch carrying MORE than was asked for is not a violation —
    // the expectation is what the material needs, not an exact inventory.
    const batches = buildInstanceBatches(tintedCloud(3), {
      defaultAssetId: "a",
      instanceAttrs: ["tint", "gain"],
    });
    const [both] = toInstancedMeshes(batches, assets("a"), {
      requireChannels: ["tint", "gain"],
    });
    expect(both.count).toBe(3);
    const gain = both.geometry.getAttribute("gain").array as Float32Array;
    expect(Array.from(gain), "the required channel really was bound").toEqual([0.25, 0.375, 0.5]);
    // A subset of what the batch carries: still fine.
    const [subset] = toInstancedMeshes(batches, assets("a"), { requireChannels: ["gain"] });
    expect(subset.geometry.hasAttribute("tint"), "the extra channel is still bound").toBe(true);
  });

  it("refuses a batch missing a required channel, naming it, the batch and what it DID carry", () => {
    // A batch that carries a real channel, just not the ones asked for —
    // the stale-map shape, where nothing is malformed and the two name
    // lists are the whole diagnosis.
    const batches = buildInstanceBatches(createPointCloud(2), {
      defaultAssetId: "tree",
      instanceAttrs: ["seed"],
    });
    const message = messageOf(() =>
      toInstancedMeshes(batches, assets("tree"), { requireChannels: ["gain", "tint"] }),
    );
    // The three things a host can act on: which batch, which names are
    // missing, and which names the batch actually has — because the
    // realistic cause is a stale map and the fix is visible only when the
    // two lists sit side by side.
    expect(message).toBe(
      'toInstancedMeshes: batch "tree" does not carry the required per-instance channels ' +
        '"gain", "tint"; it carries "seed". requireChannels asked for "gain", "tint". Nothing ' +
        "downstream would refuse this: three binds only what the batch carries and never sees " +
        'what the material declares. A material declaring "gain" as a FLOAT reads it as ZEROS ' +
        "for every instance — the fragments still run and write black, every instance draws " +
        "identical, and a ShaderMaterial under WebGL logs nothing at any severity. Declared as " +
        "an INTEGER it fails loudly instead, and the symptom looks unrelated: WebGL2 refuses " +
        "the draw with INVALID_OPERATION and nothing is drawn at all. The usual cause is a " +
        "stale channel-name map: compare the two lists above, then either publish the name from " +
        "the spawn (spawnInstances' instanceAttrs, or colorAttr for the reserved \"color\" " +
        "channel) or drop it from requireChannels.",
    );
    // ZEROS is in there on purpose: a host that has been staring at black
    // instances greps for the word before it greps for anything else.
    expect(message).toContain("ZEROS");
  });

  it("says channel, singular, for one missing name, and reports a channel-less batch as (none)", () => {
    const message = messageOf(() =>
      toInstancedMeshes(
        buildInstanceBatches(createPointCloud(2), { defaultAssetId: "a" }),
        assets("a"),
        { requireChannels: ["tint"] },
      ),
    );
    expect(message).toContain(
      'batch "a" does not carry the required per-instance channel "tint"; it carries (none).',
    );
    // The plural branch must not fire for one name. Asserted on the exact
    // phrase rather than the bare word, which `requireChannels` would
    // satisfy by accident and which would then never fail.
    expect(message).not.toContain("per-instance channels");
  });

  /**
   * THE CASE THAT REACHES ORDINARY CONSUMERS, and the reason the
   * expectation is checked per BATCH rather than once per call or once per
   * asset id.
   *
   * Two `buildInstanceBatches` calls for one asset id — two cooked cells,
   * nothing misspelled — where only the first carries the channel. Measured
   * in `tests/instanceChannelRender.test.ts`: two meshes, ONE compiled
   * program (three's `WebGLPrograms` keys its cache on shader source, so
   * the per-mesh material clones share it), and the unchannelled mesh
   * shades zeros through the pipeline its sibling compiled. Nothing about
   * the second batch is malformed, so no other check here can see it.
   */
  it("catches the second batch of one asset id that carries no channel", () => {
    const channelled = buildInstanceBatches(tintedCloud(2), {
      defaultAssetId: "a",
      instanceAttrs: ["tint"],
    });
    const unchannelled = buildInstanceBatches(createPointCloud(2), { defaultAssetId: "a" });
    // The channelled batch ALONE is accepted, so the refusal below is the
    // second batch's doing and not the expectation refusing everything.
    expect(
      toInstancedMeshes(channelled, assets("a"), { requireChannels: ["tint"] }),
    ).toHaveLength(1);
    const message = messageOf(() =>
      toInstancedMeshes([...channelled, ...unchannelled], assets("a"), {
        requireChannels: ["tint"],
      }),
    );
    // Same asset id in both, so the carried list is what tells them apart —
    // and it is the empty one that was refused.
    expect(message).toContain('batch "a" does not carry the required per-instance channel "tint"');
    expect(message).toContain("it carries (none)");
  });

  it("disposes the earlier batches' clones when a later one is refused", () => {
    // The refusal is a build error like any other, so the unwind has to
    // reclaim what the accepted batches already minted — otherwise turning
    // the expectation on would trade a wrong picture for a leak.
    const geometry = new BoxGeometry();
    const material = new MeshBasicMaterial();
    const mintedGeoms: BufferGeometry[] = [];
    const disposedGeoms: BufferGeometry[] = [];
    const cloneGeom = geometry.clone.bind(geometry);
    geometry.clone = () => {
      const clone = cloneGeom();
      mintedGeoms.push(clone);
      clone.addEventListener("dispose", () => disposedGeoms.push(clone));
      return clone;
    };
    const mintedMats: Material[] = [];
    const disposedMats: Material[] = [];
    const cloneMat = material.clone.bind(material);
    material.clone = () => {
      const clone = cloneMat();
      mintedMats.push(clone);
      clone.addEventListener("dispose", () => disposedMats.push(clone));
      return clone;
    };
    const map: AssetMap = { a: { geometry, material } };
    const good = buildInstanceBatches(tintedCloud(2), {
      defaultAssetId: "a",
      instanceAttrs: ["tint"],
    });
    const bad = buildInstanceBatches(createPointCloud(2), { defaultAssetId: "a" });
    expect(() =>
      toInstancedMeshes([...good, ...bad], map, { requireChannels: ["tint"] }),
    ).toThrow(/does not carry the required per-instance channel "tint"/);
    expect(mintedGeoms, "the accepted batch cloned the asset geometry").toHaveLength(1);
    expect(disposedGeoms, "…and it was disposed on the way out").toEqual(mintedGeoms);
    expect(mintedMats).toHaveLength(1);
    expect(disposedMats).toEqual(mintedMats);
  });

  /**
   * THE RESERVED CHANNEL IS EXPRESSIBLE, under either spelling.
   *
   * `colors` is sugar for the reserved `"color"` entry and
   * `instanceAttributesOf` returns ONE record with the lift already done,
   * so reading presence there costs nothing and admits both spellings for
   * free. It is admitted rather than excluded because a material that
   * multiplies by instance colour has the same silent failure — three
   * leaves `instanceColor` null, so every instance draws the material's own
   * colour — and excluding it would give a host two mechanisms for one
   * question.
   */
  it('accepts "color" from either spelling and refuses a batch with neither', () => {
    const map = assets("a");
    const painted = createPointCloud(2);
    painted.attrs.point.require("color").setTuple(0, [0.5, 0.25, 0.125, 1]);
    // Spelling one: the spawner's own `colors`.
    const [sugar] = toInstancedMeshes(
      buildInstanceBatches(painted, { defaultAssetId: "a", colorAttr: "color" }),
      map,
      { requireChannels: ["color"] },
    );
    expect(sugar.instanceColor).not.toBeNull();
    // Spelling two: a hand-built batch naming the reserved channel.
    const [named] = toInstancedMeshes(
      [
        {
          assetId: "a",
          count: 2,
          transforms: new Float32Array(32),
          attributes: { color: new Float32Array([0.5, 0.25, 0.125, 1, 0, 0]) },
        },
      ],
      map,
      { requireChannels: ["color"] },
    );
    expect(named.instanceColor?.count).toBe(2);
    // And neither: refused, with the consequence that is NOT zeros spelled
    // out, because a host told "it reads as zeros" would look for black
    // instances and find the material's own colour instead.
    const message = messageOf(() =>
      toInstancedMeshes(
        buildInstanceBatches(createPointCloud(2), { defaultAssetId: "a" }),
        map,
        { requireChannels: ["color"] },
      ),
    );
    expect(message).toContain('does not carry the required per-instance channel "color"');
    expect(message).toContain("three leaves `instanceColor` null");
    expect(message).toContain("USE_INSTANCING_COLOR shader variant never turns on");
    expect(message).toContain("draws the material's own colour rather than black");
    // And the zeros sentence is ABSENT, which is the whole reason the two
    // consequences are written separately: a host sent looking for black
    // instances would not find any, and would conclude the error was wrong.
    expect(message, "colour does not read as zeros; it draws the material's colour").not.toContain(
      "ZEROS",
    );
    // Both sentences appear when both kinds are missing, so neither is a
    // fixed string this message always carries.
    const mixed = messageOf(() =>
      toInstancedMeshes(
        buildInstanceBatches(createPointCloud(2), { defaultAssetId: "a" }),
        map,
        { requireChannels: ["color", "tint"] },
      ),
    );
    expect(mixed).toContain('A material declaring "tint" as a FLOAT reads it as ZEROS');
    expect(mixed).toContain("three leaves `instanceColor` null");
  });

  it("checks a zero-instance batch too, and an empty column satisfies it", () => {
    // No exception for count 0, deliberately. It cannot draw a wrong
    // picture yet, but an exception would be a hole in exactly the shape
    // this check exists to close, and a batch missing a channel at count 0
    // is the batch that will be missing it at count 500.
    const message = messageOf(() =>
      toInstancedMeshes(
        [{ assetId: "a", count: 0, transforms: new Float32Array(0) }],
        assets("a"),
        { requireChannels: ["tint"] },
      ),
    );
    expect(message).toContain('does not carry the required per-instance channel "tint"');
    // A zero-instance batch's channels must be EMPTY columns (there is no
    // item size to recover), and an empty column is still the channel
    // being carried — so this one passes, binds nothing and clones nothing.
    const map = assets("a");
    const [mesh] = toInstancedMeshes(
      [
        {
          assetId: "a",
          count: 0,
          transforms: new Float32Array(0),
          attributes: { tint: new Float32Array(0) },
        },
      ],
      map,
      { requireChannels: ["tint"] },
    );
    expect(mesh.count).toBe(0);
    expect(mesh.geometry).toBe(map.a.geometry);
    expect(ownsGeometry(mesh)).toBe(false);
  });

  /**
   * A host's own channel-filling loop, written the ordinary way, with a
   * name its column map has not got.
   *
   * This is the STALE MAP as source code rather than as a description, and
   * it type-checks: the project does not enable `noUncheckedIndexedAccess`,
   * so `columns[name]` is `AttrData` to the compiler and `undefined` at
   * runtime. A key present with no value is therefore the shape the
   * realistic cause actually produces, and it must not read as coverage.
   */
  function hostFilled(names: readonly string[], columns: Record<string, AttrData>): InstanceAttributes {
    const out: Record<string, AttrData> = {};
    for (const name of names) out[name] = columns[name];
    return out;
  }

  it("a key present with NO VALUE is missing — the stale map's own shape", () => {
    // Found by verification, and it is the worst failure this check could
    // have: an own enumerable "color" key holding nothing passes a naive
    // presence test, `toInstancedMeshes` binds nothing, `instanceColor`
    // stays null, USE_INSTANCING_COLOR never turns on, and every instance
    // draws the material's own colour — while the expectation reports the
    // batch as satisfying it. A hole reported as coverage.
    const attributes = hostFilled(["color"], {});
    expect(
      Object.prototype.propertyIsEnumerable.call(attributes, "color"),
      "the key really is own and enumerable — only the value is missing",
    ).toBe(true);
    const batch = { assetId: "a", count: 2, transforms: new Float32Array(32), attributes };
    // Unasked, this is exactly the silent wrong picture: a mesh is built
    // and nothing is bound. Shown first, so the refusal below is not a
    // matter of taste.
    const [drawn] = toInstancedMeshes([batch], assets("a"));
    expect(drawn.instanceColor, "nothing was bound: the silent case").toBeNull();
    expect(messageOf(() => toInstancedMeshes([batch], assets("a"), { requireChannels: ["color"] })))
      .toContain('does not carry the required per-instance channel "color"');
    // The same hole one name over. Here the unchecked build does not go
    // quiet, it dies inside three with a message naming neither the batch
    // nor the channel — so the refusal is an upgrade either way.
    const named = {
      assetId: "a",
      count: 2,
      transforms: new Float32Array(32),
      attributes: hostFilled(["tint"], {}),
    };
    expect(messageOf(() => toInstancedMeshes([named], assets("a")))).not.toContain("tint");
    expect(messageOf(() => toInstancedMeshes([named], assets("a"), { requireChannels: ["tint"] })))
      .toContain('batch "a" does not carry the required per-instance channel "tint"');
  });

  it("never lists a missing name as carried: a present-but-empty key is reported as its own state", () => {
    // The message's one job is to let a host compare what it asked for
    // against what arrived. `Object.keys` alone puts a present-but-empty
    // name on BOTH sides — "does not carry \"tint\" … it carries
    // \"phase\", \"tint\"" — and then tells the reader to compare the two
    // lists, which is unusable in exactly the stale-map shape this whole
    // check exists for. So the two states are separated by name.
    const attributes = hostFilled(["phase", "tint"], { phase: new Float32Array([0.25, 0.75]) });
    expect(Object.keys(attributes), "the key IS there — only its value is not").toEqual([
      "phase",
      "tint",
    ]);
    const message = messageOf(() =>
      toInstancedMeshes(
        [{ assetId: "a", count: 2, transforms: new Float32Array(32), attributes }],
        assets("a"),
        { requireChannels: ["tint"] },
      ),
    );
    expect(message).toContain(
      'batch "a" does not carry the required per-instance channel "tint"; it carries "phase" ' +
        '("tint" is present but holds no column). requireChannels asked for "tint".',
    );
    // The contradiction, asserted as its own claim: the missing name must
    // never appear inside the carried list.
    const carried = /it carries ([^(.]*)/.exec(message)?.[1] ?? "";
    expect(carried, "the carried list must not contain the name reported missing").not.toContain(
      "tint",
    );
    // Plural, and with nothing left to carry: the sentence still reads.
    const twoEmpty = messageOf(() =>
      toInstancedMeshes(
        [
          {
            assetId: "a",
            count: 2,
            transforms: new Float32Array(32),
            attributes: hostFilled(["tint", "gain"], {}),
          },
        ],
        assets("a"),
        { requireChannels: ["tint", "gain"] },
      ),
    );
    expect(twoEmpty).toContain(
      'it carries (none) ("gain", "tint" are present but hold no column).',
    );
  });

  it("refuses an expectation that names a reserved geometry attribute, before any batch", () => {
    // Such a name can never be satisfied — the loop refuses a batch that
    // CARRIES it — so without this the per-batch refusal would advise
    // publishing the name from the spawn, which is the one action the
    // reserved-name guard rejects. An error that recommends a refused fix
    // is worse than no error.
    const message = messageOf(() =>
      toInstancedMeshes(
        buildInstanceBatches(createPointCloud(2), { defaultAssetId: "a" }),
        assets("a"),
        { requireChannels: ["normal"] },
      ),
    );
    expect(message).toContain(
      'toInstancedMeshes: requireChannels names "normal", which is a geometry attribute three ' +
        "already means something by",
    );
    expect(message).toContain("can never be satisfied by any batch");
    expect(message).toContain(
      "Reserved: instanceColor, instanceMatrix, normal, position, skinIndex, skinWeight, " +
        "tangent, uv, uv1, uv2, uv3.",
    );
    // …and it says the reserved COLOUR is the exception, because that is
    // the next question anyone reading this sentence has.
    expect(message).toContain('The reserved "color" channel is not on that list and IS requirable');
    // Raised before a batch is even looked at: an empty batch list still
    // reports it, so the caller learns on the first call rather than on
    // the first cook that happens to spawn something.
    expect(messageOf(() => toInstancedMeshes([], {}, { requireChannels: ["position"] }))).toContain(
      'requireChannels names "position"',
    );
  });

  it("reports a repeated name once", () => {
    const message = messageOf(() =>
      toInstancedMeshes(
        buildInstanceBatches(createPointCloud(2), { defaultAssetId: "a" }),
        assets("a"),
        { requireChannels: ["tint", "tint"] },
      ),
    );
    // Singular, and the name once — the caller's own list is echoed back
    // verbatim further along, which is where a duplicate is informative.
    expect(message).toContain('required per-instance channel "tint"; it carries (none)');
    expect(message).toContain('requireChannels asked for "tint", "tint"');
  });

  it("an inherited channel does not satisfy it — the same key set the binding loop sees", () => {
    // The one way this check could report a false PASS. The binding loop
    // reads `Object.entries(channels)`, which sees own enumerable keys and
    // nothing else, so a `tint` reachable only through a prototype binds
    // nothing at all. A plain `channels.tint !== undefined` presence test
    // would find it and wave the batch through to the identical silent
    // zeros — so presence is read own-and-enumerable, exactly as
    // `instanceAttributesOf` reads the colour channel.
    const inherited = Object.create({ tint: new Float32Array([1, 2, 3, 4, 5, 6]) }) as Record<
      string,
      Float32Array
    >;
    expect(inherited.tint, "the prototype really does carry it").toBeInstanceOf(Float32Array);
    const batch = { assetId: "a", count: 2, transforms: new Float32Array(32), attributes: inherited };
    // Unasked, the batch builds and binds NOTHING — which is the wrong
    // picture this refuses, shown first so the refusal is not a matter of
    // opinion.
    const [drawn] = toInstancedMeshes([batch], assets("a"));
    expect(drawn.geometry.hasAttribute("tint"), "nothing was bound from the prototype").toBe(false);
    const message = messageOf(() =>
      toInstancedMeshes([batch], assets("a"), { requireChannels: ["tint"] }),
    );
    expect(message).toContain('does not carry the required per-instance channel "tint"');
    expect(message).toContain("it carries (none)");
  });
});

describe("toInstancedMeshes unwind", () => {
  /**
   * A host's own material class, which is what an asset map holds: the
   * meshes this function discards carry `.clone()`s of it, so its
   * `dispose` is the caller's code running inside our teardown.
   */
  class ThrowingMaterial extends MeshBasicMaterial {
    static disposed = 0;
    override dispose(): void {
      ThrowingMaterial.disposed++;
      throw new Error("host material dispose threw");
    }
  }

  it("disposes every discarded mesh and still reports the BUILD error", () => {
    ThrowingMaterial.disposed = 0;
    const map: AssetMap = {
      a: { geometry: new BoxGeometry(), material: new ThrowingMaterial() },
      b: { geometry: new BoxGeometry(), material: new ThrowingMaterial() },
    };
    const batch = (assetId: string) => ({
      assetId,
      count: 1,
      transforms: new Float32Array(16),
    });
    // The third batch names an asset the map does not have; the first two
    // built fine and must be disposed on the way out.
    expect(() => toInstancedMeshes([batch("a"), batch("b"), batch("nope")], map)).toThrow(
      'unknown assetId "nope"',
    );
    // Both were attempted: an unguarded loop stops at the first throw.
    expect(ThrowingMaterial.disposed).toBe(2);
  });
});

/**
 * Host-supplied materials.
 *
 * The default is a per-mesh CLONE, and not for appearance: three's
 * renderer releases a mesh's cached render state through exactly one
 * signal, that mesh's material's `dispose` event. A host that pools its
 * own materials has had to overwrite `mesh.material` and dispose what it
 * displaced; `materialFor` is the direct route, and the whole of what it
 * changes is OWNERSHIP — the mesh draws what the callback returned, no
 * clone is minted at all, and nothing in this library ever disposes it.
 * Every test here is about one of those two claims.
 */
describe("toInstancedMeshes materialFor", () => {
  /** An asset map whose materials record every clone minted and every dispose taken. */
  function trackedAssets(...ids: string[]) {
    const map: AssetMap = {};
    const minted: Material[] = [];
    const disposed: Material[] = [];
    const assetDisposed: Material[] = [];
    for (const id of ids) {
      const material = new MeshBasicMaterial();
      const originalClone = material.clone.bind(material);
      material.clone = () => {
        const clone = originalClone();
        minted.push(clone);
        clone.addEventListener("dispose", () => disposed.push(clone));
        return clone;
      };
      material.addEventListener("dispose", () => assetDisposed.push(material));
      map[id] = { geometry: new BoxGeometry(), material };
    }
    return { map, minted, disposed, assetDisposed };
  }

  /** A material the HOST owns, watching for a dispose the library must never fire. */
  function pooledMaterial() {
    const material = new MeshBasicMaterial();
    const disposed: Material[] = [];
    material.addEventListener("dispose", () => disposed.push(material));
    return { material, disposed };
  }

  const batchesOf = (assetId: string, n = 2) =>
    buildInstanceBatches(createPointCloud(n), { defaultAssetId: assetId });

  it("draws the material the callback returned and mints no clone at all", () => {
    const { map, minted, assetDisposed } = trackedAssets("tree");
    const { material: pooled } = pooledMaterial();
    const [mesh] = toInstancedMeshes(batchesOf("tree"), map, { materialFor: () => pooled });
    // Identity, not equivalence: the point of the option is that the host
    // keeps drawing through the object it already has a pipeline for.
    expect(mesh.material, "the mesh draws the caller's own material").toBe(pooled);
    // Not "minted and dropped" — not minted. The clone this replaces is a
    // material allocation per mesh per cook on a streaming path.
    expect(minted, "no clone was minted for this batch").toHaveLength(0);
    expect(assetDisposed, "the asset map's material is still the caller's").toHaveLength(0);
    expect(ownsMaterial(mesh), "flagged, so every teardown path can tell").toBe(false);
  });

  it("a mesh built without the option is OWNED — absence is the default, not a flag", () => {
    // The polarity guard. `pcgOwnsMaterial` records the EXCEPTION, so a
    // mesh from any older build, or from the device adapter, still reads
    // as the library's to dispose; written the other way round, every one
    // of them would leak its render state.
    const [mesh] = toInstancedMeshes(batchesOf("a"), assets("a"));
    expect(ownsMaterial(mesh)).toBe(true);
    expect(mesh.userData.pcgOwnsMaterial, "nothing is written for the default").toBeUndefined();
  });

  it("returning undefined falls back to the per-mesh clone for that batch", () => {
    // The per-asset lever: a host pools for the assets its own shader
    // knows and takes the default for the rest. It is supported because
    // the fallback is otherwise inexpressible — `cloneAssetMaterial` is
    // not exported, so a caller reproducing it has to rewrite the
    // slot-by-slot branch too.
    const { map, minted } = trackedAssets("tree", "rock");
    const { material: pooled } = pooledMaterial();
    const meshes = toInstancedMeshes([...batchesOf("tree"), ...batchesOf("rock", 1)], map, {
      materialFor: (batch) => (batch.assetId === "tree" ? pooled : undefined),
    });
    expect(meshes.map((m) => m.name)).toEqual(["tree", "rock"]);
    expect(meshes[0].material).toBe(pooled);
    expect(ownsMaterial(meshes[0])).toBe(false);
    expect(minted, "exactly one clone: the batch the callback passed on").toHaveLength(1);
    expect(meshes[1].material).toBe(minted[0]);
    expect(ownsMaterial(meshes[1])).toBe(true);
  });

  it("a null from an untyped host falls through too, and is not flagged foreign", () => {
    // The types forbid `null`, so this is only reachable from JS or a cast
    // — a pool lookup spelled `pool[id] ?? null`. It has to normalise to
    // the `undefined` fall-through rather than travel on: nullish to the
    // mint but not `undefined` to the flag would mint a clone and then
    // mark it host-owned, and nothing would ever dispose it.
    const { map, minted } = trackedAssets("tree");
    const meshes = toInstancedMeshes([...batchesOf("tree")], map, {
      materialFor: () => null as unknown as undefined,
    });
    expect(minted, "the clone is still minted").toHaveLength(1);
    expect(meshes[0].material).toBe(minted[0]);
    expect(ownsMaterial(meshes[0]), "and the library still owns it").toBe(true);
  });

  it("is asked once per batch and handed the batch itself", () => {
    const seen: InstanceBatch[] = [];
    const { map } = trackedAssets("tree", "rock");
    const batches = [...batchesOf("tree"), ...batchesOf("rock", 1)];
    toInstancedMeshes(batches, map, {
      materialFor: (batch) => {
        seen.push(batch);
        return undefined;
      },
    });
    // The batch is the whole argument on purpose: `assetId` keys the
    // host's own map and `attributes` says which channels this batch
    // carries — the two questions a pooled-material host asks.
    expect(seen).toEqual(batches);
    expect(seen[0]).toBe(batches[0]);
  });

  it("never disposes a supplied material on the unwind, while a minted clone still is", () => {
    // THE CLAIM THAT MATTERS. A build that throws half-way disposes what
    // it minted — but a pooled material is still drawing for every mesh
    // of every other call, so disposing it here would turn a batch error
    // into a blank screen somewhere else.
    const { map, minted, disposed } = trackedAssets("tree", "rock");
    const { material: pooled, disposed: pooledDisposed } = pooledMaterial();
    const batches = [...batchesOf("tree"), ...batchesOf("rock", 1), ...batchesOf("missing", 1)];
    expect(() =>
      toInstancedMeshes(batches, map, {
        materialFor: (batch) => (batch.assetId === "tree" ? pooled : undefined),
      }),
    ).toThrow(/unknown assetId "missing"/);
    expect(minted, "only the rock batch took a clone").toHaveLength(1);
    expect(disposed, "…and that clone must not outlive the failed call").toEqual(minted);
    expect(pooledDisposed, "the host's material is the host's, failure or not").toEqual([]);
  });

  it("takes a slot-for-slot array for a multi-material asset", () => {
    const slots = [new MeshBasicMaterial(), new MeshBasicMaterial()];
    const map: AssetMap = {
      tree: {
        geometry: new BoxGeometry(),
        material: [new MeshBasicMaterial(), new MeshBasicMaterial()],
      },
    };
    const [mesh] = toInstancedMeshes(batchesOf("tree", 1), map, { materialFor: () => slots });
    expect(mesh.material, "the array itself, in slot order").toBe(slots);
    expect(ownsMaterial(mesh)).toBe(false);
    for (const [i, slot] of materialListOf(mesh.material).entries()) {
      expect(slot, `slot ${i} is the caller's own`).toBe(slots[i]);
    }
  });

  it("refuses a slot mismatch, naming the batch, both shapes and the fix", () => {
    const twoSlots: AssetMap = {
      tree: {
        geometry: new BoxGeometry(),
        material: [new MeshBasicMaterial(), new MeshBasicMaterial()],
      },
    };
    const single = new MeshBasicMaterial();
    // three answers a mismatch by DRAWING, and the message has to say
    // which picture the caller would have got. Verified against
    // WebGLRenderer.projectObject in three 0.185.1: the array branch
    // walks `geometry.groups` and takes `material[group.materialIndex]`
    // behind an `if (groupMaterial && ...)` guard, so an index the array
    // does not reach is skipped; the non-array branch pushes the whole
    // geometry once with `group = null`.
    const tooFew = messageOf(() =>
      toInstancedMeshes(batchesOf("tree", 1), twoSlots, { materialFor: () => single }),
    );
    expect(tooFew).toContain(
      'materialFor returned a single material for batch "tree", whose asset declares an array of ' +
        "2 materials",
    );
    expect(tooFew, "the mechanism, so the symptom is recognisable").toContain(
      "material[group.materialIndex]",
    );
    expect(tooFew, "what actually happens to an unreached group").toContain("SILENTLY SKIPS");
    expect(tooFew, "the fix, spelled out").toContain("Return an array of 2 materials");
    expect(tooFew).toContain("repeat the same pooled material per slot");
    expect(tooFew).toContain("return undefined for this batch");

    // Too many, from the same check.
    const tooMany = messageOf(() =>
      toInstancedMeshes(batchesOf("tree", 1), assets("tree"), {
        materialFor: () => [single, single],
      }),
    );
    expect(tooMany).toContain(
      'materialFor returned an array of 2 materials for batch "tree", whose asset declares a ' +
        "single material",
    );
    expect(tooMany).toContain("Return a single material");
  });

  it("refuses a 1-element ARRAY for a single-material asset — shape binds, not just count", () => {
    // THE COUNTS MATCH AND IT IS STILL WRONG, which is why the check
    // cannot be a length comparison. `Array.isArray(mesh.material)` is
    // what selects three's per-group path, and every asset here draws a
    // BoxGeometry — six groups, materialIndex 0..5 — so a 1-element array
    // would draw the +X face and silently drop the other five.
    const single = new MeshBasicMaterial();
    const asArray = messageOf(() =>
      toInstancedMeshes(batchesOf("tree", 1), assets("tree"), { materialFor: () => [single] }),
    );
    expect(asArray).toContain(
      'materialFor returned an array of 1 material for batch "tree", whose asset declares a ' +
        "single material",
    );
    expect(asArray).toContain("match in COUNT and in SHAPE");
    expect(asArray).toContain("a 1-element array on a six-group box draws one face");

    // And the mirror: a bare material where the asset declares an array
    // of one, which would draw the whole geometry through slot 0.
    const oneSlotArray: AssetMap = {
      tree: { geometry: new BoxGeometry(), material: [new MeshBasicMaterial()] },
    };
    const asSingle = messageOf(() =>
      toInstancedMeshes(batchesOf("tree", 1), oneSlotArray, { materialFor: () => single }),
    );
    expect(asSingle).toContain(
      'materialFor returned a single material for batch "tree", whose asset declares an array of ' +
        "1 material",
    );
    expect(asSingle, "the fix keeps the asset's own shape").toContain("Return an array of 1");
  });

  it("refuses BEFORE minting: no geometry clone for the refused batch, earlier clones freed", () => {
    // The ordering claim, pinned where it is observable: the refused
    // batch carries a CHANNEL, so a check placed after the mint would
    // have cloned the asset geometry on its way to the error — and that
    // clone would be unreachable, since the mesh never joins the list the
    // unwind walks.
    const { map, minted, disposed } = trackedAssets("rock");
    const geometry = new BoxGeometry();
    let geometryClones = 0;
    const originalClone = geometry.clone.bind(geometry);
    geometry.clone = () => {
      geometryClones++;
      return originalClone();
    };
    map.tree = { geometry, material: [new MeshBasicMaterial(), new MeshBasicMaterial()] };
    const single = new MeshBasicMaterial();
    const channelled = buildInstanceBatches(createPointCloud(1), {
      defaultAssetId: "tree",
      instanceAttrs: ["seed"],
    });
    expect(() =>
      toInstancedMeshes([...batchesOf("rock", 1), ...channelled], map, {
        materialFor: (batch) => (batch.assetId === "tree" ? single : undefined),
      }),
    ).toThrow(/materialFor returned a single material/);
    expect(geometryClones, "the refusal landed before anything was minted").toBe(0);
    expect(minted, "the rock batch built first").toHaveLength(1);
    expect(disposed, "…and its clone did not outlive the refusal").toEqual(minted);
  });

  it("a callback that THROWS mints nothing for its batch and frees the earlier batches", () => {
    // The other way arbitrary host code leaves this loop. Same claim as
    // the refusal above, and it has to hold for an error this library
    // never authored.
    const { map, minted, disposed } = trackedAssets("rock");
    const geometry = new BoxGeometry();
    let geometryClones = 0;
    const originalClone = geometry.clone.bind(geometry);
    geometry.clone = () => {
      geometryClones++;
      return originalClone();
    };
    map.tree = { geometry, material: new MeshBasicMaterial() };
    const channelled = buildInstanceBatches(createPointCloud(1), {
      defaultAssetId: "tree",
      instanceAttrs: ["seed"],
    });
    expect(() =>
      toInstancedMeshes([...batchesOf("rock", 1), ...channelled], map, {
        materialFor: (batch) => {
          if (batch.assetId === "tree") throw new Error("host pool is closed");
          return undefined;
        },
      }),
    ).toThrow("host pool is closed");
    expect(geometryClones).toBe(0);
    expect(minted).toHaveLength(1);
    expect(disposed, "the host's error is not a reason to leak the earlier clone").toEqual(minted);
  });

  it("the two ownership flags are independent: a channelled batch still owns its geometry", () => {
    // A channel is an attribute of the GEOMETRY, so that clone is minted
    // and owned however the material was obtained. The documented dispose
    // sequence has to free exactly one of the two.
    const { material: pooled, disposed: pooledDisposed } = pooledMaterial();
    const map = assets("a");
    const [mesh] = toInstancedMeshes(
      buildInstanceBatches(createPointCloud(2), { defaultAssetId: "a", instanceAttrs: ["seed"] }),
      map,
      { materialFor: () => pooled },
    );
    expect(ownsGeometry(mesh), "the channel forced a geometry clone").toBe(true);
    expect(ownsMaterial(mesh), "the material is still the host's").toBe(false);
    expect(mesh.geometry).not.toBe(map.a.geometry);

    let cloneDisposed = 0;
    let assetGeoDisposed = 0;
    mesh.geometry.addEventListener("dispose", () => cloneDisposed++);
    map.a.geometry.addEventListener("dispose", () => assetGeoDisposed++);
    // The sequence exactly as `toInstancedMeshes`' docs state it.
    mesh.dispose();
    if (ownsMaterial(mesh)) for (const m of materialListOf(mesh.material)) m.dispose();
    if (ownsGeometry(mesh)) mesh.geometry.dispose();
    expect(cloneDisposed, "the per-batch clone is freed").toBe(1);
    expect(assetGeoDisposed, "the asset map's geometry is not").toBe(0);
    expect(pooledDisposed, "and neither is the host's material").toEqual([]);
  });
});
