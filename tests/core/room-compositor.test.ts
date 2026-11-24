import { describe, it, expect } from "vitest";
import { sortIsometricObjects, renderRoom } from "../../src/core/room-compositor.js";
import { PixcelAssetSchema, RoomLayoutSchema } from "../../src/core/schema.js";
import { loadPalette } from "../../src/core/palette.js";

describe("topological isometric room compositor", () => {
  it("sorts a 1x1 chair behind, beside, and in front of a 2x1 desk accurately", () => {
    const ordered = sortIsometricObjects([
      { id: "chair-front", tx: 1, ty: 2, footprintX: 1, footprintY: 1 },
      { id: "desk", tx: 1, ty: 1, footprintX: 2, footprintY: 1 },
      { id: "chair-back", tx: 2, ty: 0, footprintX: 1, footprintY: 1 },
    ]);
    expect(ordered.map((o) => o.id)).toEqual(["chair-back", "desk", "chair-front"]);
  });

  it("handles overlapping/cyclic footprints deterministically without infinite loops or dropped items", () => {
    const items = [
      { id: "a", tx: 1, ty: 1, footprintX: 2, footprintY: 2 },
      { id: "b", tx: 2, ty: 2, footprintX: 2, footprintY: 2 },
      { id: "c", tx: 1, ty: 2, footprintX: 2, footprintY: 1 },
    ];
    const ordered = sortIsometricObjects(items);
    expect(ordered).toHaveLength(3);
    expect(new Set(ordered.map((i) => i.id))).toEqual(new Set(["a", "b", "c"]));
  });

  it("composites floor, edge wall, wall-decor, and rotated multi-tile object cleanly", async () => {
    const palette = await loadPalette("office-night");
    const floor = PixcelAssetSchema.parse({
      schemaVersion: 1, id: "floor", layer: "floor", outlineMode: "none", tilePreset: "64x32", voxelsPerTile: 16, footprintTiles: [1, 1],
      materials: { w: { color: "#4b3121", kind: "wood" } },
      ops: [{ op: "box", from: [0, 0, 0], to: [15, 15, 0], material: "w" }],
    });
    const wall = PixcelAssetSchema.parse({
      schemaVersion: 1, id: "wall", layer: "wall", outlineMode: "top-only", tilePreset: "64x32", voxelsPerTile: 16, footprintTiles: [1, 1],
      materials: { s: { color: "#2a334d", kind: "matte" } },
      ops: [{ op: "box", from: [0, 0, 0], to: [15, 1, 23], material: "s" }],
    });
    const desk = PixcelAssetSchema.parse({
      schemaVersion: 1, id: "desk", layer: "object", outlineMode: "silhouette", tilePreset: "64x32", voxelsPerTile: 16, footprintTiles: [2, 1],
      materials: { d: { color: "#6b442a", kind: "wood" } },
      ops: [{ op: "box", from: [1, 1, 0], to: [30, 14, 7], material: "d" }],
    });
    const room = RoomLayoutSchema.parse({
      schemaVersion: 1, id: "mini", tilePreset: "64x32", widthTiles: 3, depthTiles: 3,
      floors: [
        { assetId: "floor", tx: 0, ty: 0 }, { assetId: "floor", tx: 1, ty: 0 },
        { assetId: "floor", tx: 0, ty: 1 }, { assetId: "floor", tx: 1, ty: 1 },
      ],
      walls: [{ assetId: "wall", tx: 0, ty: 0, edge: "nw" }],
      wallDecor: [],
      objects: [{ assetId: "desk", tx: 0, ty: 0, direction: "sw" }],
    });
    const res = renderRoom(room, new Map([["floor", floor], ["wall", wall], ["desk", desk]]), palette);
    expect(res.width).toBeGreaterThan(100);
    expect(res.height).toBeGreaterThan(60);
  });
});
