import { describe, it, expect } from "vitest";
import { VoxelGrid, rotateFootprintTiles } from "../../src/core/voxel-grid.js";
import { compileAsset } from "../../src/core/dsl-compiler.js";
import { PixcelAssetSchema } from "../../src/core/schema.js";

describe("VoxelGrid and DSL compiler", () => {
  it("rotates an asymmetric 2x1 voxel grid 4x90deg CW back to the exact original voxels", () => {
    const g = new VoxelGrid();
    g.set(0, 0, 0, { material: "a" });
    g.set(63, 10, 5, { material: "b" });
    const r1 = g.rotate90CW(1, 64, 32);
    expect([r1.footprintVoxelsX, r1.footprintVoxelsY]).toEqual([32, 64]);
    expect(rotateFootprintTiles([2, 1], "sw")).toEqual([1, 2]);
    const r4 = r1.grid.rotate90CW(3, r1.footprintVoxelsX, r1.footprintVoxelsY);
    expect(r4.grid.get(0, 0, 0)?.material).toBe("a");
    expect(r4.grid.get(63, 10, 5)?.material).toBe("b");
    expect(r4.grid.size).toBe(2);
  });

  it("compiles box, hollowBox, cylinder, slope, line, voxel, mirror, decals, and frame overrides", () => {
    const asset = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "dsl-primitives",
      footprintTiles: [1, 1],
      voxelsPerTile: 16,
      materials: {
        a: { color: "#4b3121", kind: "wood" },
        b: { color: "#38bdf8", kind: "emissive" },
      },
      ops: [
        { op: "hollowBox", from: [0, 0, 0], to: [3, 3, 3], material: "a", thickness: 1 },
        { op: "voxel", at: [1, 1, 1], material: "b" },
        { op: "line", from: [4, 0, 0], to: [4, 0, 3], material: "a" },
        { op: "cylinder", center: [10, 10], zFrom: 0, zTo: 2, radius: 2, material: "a" },
        { op: "slope", from: [0, 8, 0], to: [3, 10, 3], axis: "+X", material: "a" },
        { op: "mirror", axis: "x", pivot: 8, ops: [{ op: "voxel", at: [2, 14, 0], material: "b" }] },
      ],
      decals: [
        { face: "+X", origin: [3, 1, 2], legend: { ".": null, "x": "b" }, rows: ["xx", ".x"] },
      ],
      frames: [
        { name: "f0", durationMs: 300, ops: [] },
        { name: "f1", durationMs: 300, ops: [{ op: "voxel", at: [0, 0, 3], material: "b" }] },
      ],
    });
    const { baseGrid, frames } = compileAsset(asset);
    expect(baseGrid.has(1, 1, 1)).toBe(true);
    expect(baseGrid.has(2, 2, 2)).toBe(false); // hollow interior
    expect(baseGrid.get(3, 1, 2)?.material).toBe("b"); // decal row 0 col 0
    expect(baseGrid.get(14, 14, 0)?.material).toBe("b"); // mirrored across x=8
    expect(frames).toHaveLength(2);
    expect(frames[0].grid.get(0, 0, 3)?.material).toBe("a");
    expect(frames[1].grid.get(0, 0, 3)?.material).toBe("b");
  });

  it("throws an actionable error when an op or decal references an unknown material", () => {
    const asset = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "bad-mat",
      materials: { a: { color: "#112233", kind: "matte" } },
      ops: [{ op: "box", from: [0, 0, 0], to: [1, 1, 1], material: "missing_mat" }],
    });
    expect(() => compileAsset(asset)).toThrow(/missing_mat/);
  });

  it("rejects negative coords from mirror/decal/cylinder/partTransforms and rejects out-of-bounds coords > 512", () => {
    const negMirror = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "neg-mirror",
      materials: { a: { color: "#112233", kind: "matte" } },
      ops: [{ op: "mirror", axis: "x", pivot: 1, ops: [{ op: "voxel", at: [5, 0, 0], material: "a" }] }],
    });
    expect(() => compileAsset(negMirror)).toThrow(/negative|bounds/i);

    const negDecal = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "neg-decal",
      materials: { a: { color: "#112233", kind: "matte" } },
      ops: [],
      decals: [{ face: "+X", origin: [0, 0, 0], legend: { x: "a" }, rows: ["x", "x"] }],
    });
    expect(() => compileAsset(negDecal)).toThrow(/negative|bounds/i);

    const negTransform = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "neg-tf",
      materials: { a: { color: "#112233", kind: "matte" } },
      ops: [{ op: "voxel", at: [0, 0, 0], material: "a", part: "p" }],
      frames: [{ name: "f0", durationMs: 100, ops: [], partTransforms: { p: { translate: [-2, 0, 0] } } }],
    });
    expect(() => compileAsset(negTransform)).toThrow(/negative|bounds/i);

    expect(() =>
      PixcelAssetSchema.parse({
        schemaVersion: 1,
        id: "huge-coord",
        materials: { a: { color: "#112233", kind: "matte" } },
        ops: [{ op: "box", from: [0, 0, 0], to: [10000, 10, 10], material: "a" }],
      }),
    ).toThrow();
  });
});
