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
import { createPointCloud } from "../data/index.js";
import { buildInstanceBatches } from "../spawn/instances.js";
import { materialListOf, ownsGeometry, toInstancedMeshes, type AssetMap } from "./instanced.js";

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
