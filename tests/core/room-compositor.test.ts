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

  it("draws back-wall decor behind foreground walls and masks occluded emissive pixels in split/both modes", async () => {
    const palette = await loadPalette("office-night");
    const backWall = PixcelAssetSchema.parse({
      schemaVersion: 1, id: "w-back", layer: "wall", outlineMode: "none", tilePreset: "64x32", voxelsPerTile: 16, footprintTiles: [1, 1],
      materials: { s: { color: "#252e45", kind: "matte" } },
      ops: [{ op: "box", from: [0, 0, 0], to: [1, 15, 20], material: "s" }],
    });
    const decor = PixcelAssetSchema.parse({
      schemaVersion: 1, id: "decor-bright", layer: "wall-decor", outlineMode: "none", tilePreset: "64x32", voxelsPerTile: 16, footprintTiles: [1, 1],
      materials: { w: { color: "#e6e9ef", kind: "emissive", glowRadius: 0, glowIntensity: 0 } },
      ops: [{ op: "box", from: [2, 2, 4], to: [2, 13, 16], material: "w" }],
    });
    const fgBlocker = PixcelAssetSchema.parse({
      schemaVersion: 1, id: "fg-blocker", layer: "wall", outlineMode: "none", tilePreset: "64x32", voxelsPerTile: 16, footprintTiles: [1, 1],
      materials: { blk: { color: "#b93848", kind: "matte" } },
      ops: [{ op: "box", from: [0, 0, 0], to: [15, 15, 40], material: "blk" }],
    });
    // 1. Back-wall decor at (0,0) must NOT draw on top of fg-blocker at (1,1):
    //    No bright white (#e6e9ef) decor pixels may appear inside the center overlap band where fg-blocker covers it,
    //    AND when fg-blocker is an opaque object in front of a glowing object, emissive must be cleared behind fg-blocker!
    const fgObj = PixcelAssetSchema.parse({
      schemaVersion: 1, id: "fg-obj", layer: "object", outlineMode: "none", tilePreset: "64x32", voxelsPerTile: 16, footprintTiles: [1, 1],
      materials: { blk: { color: "#b93848", kind: "matte" } },
      ops: [{ op: "box", from: [0, 0, 0], to: [15, 15, 22], material: "blk" }],
    });
    const room = RoomLayoutSchema.parse({
      schemaVersion: 1, id: "occlusion-test", tilePreset: "64x32", widthTiles: 3, depthTiles: 3,
      floors: [],
      walls: [
        { assetId: "w-back", tx: 0, ty: 0, edge: "nw" },
        { assetId: "fg-blocker", tx: 1, ty: 1, edge: "nw" },
      ],
      wallDecor: [{ assetId: "decor-bright", tx: 0, ty: 0, edge: "nw" }],
      objects: [{ assetId: "fg-obj", tx: 1, ty: 1, direction: "se" }],
    });
    const res = renderRoom(
      room,
      new Map([["w-back", backWall], ["decor-bright", decor], ["fg-blocker", fgBlocker], ["fg-obj", fgObj]]),
      palette,
      { emissiveMode: "both" },
    );
    let leakedEmissive = 0;
    for (let i = 0; i < res.main.data.length; i += 4) {
      if (res.main.data[i] > 140 && res.main.data[i + 1] < 90 && res.main.data[i + 2] < 100) {
        if (res.emissive && res.emissive.data[i + 3] > 0) leakedEmissive++;
      }
    }
    expect(leakedEmissive).toBe(0);

    // Also test wall-only ordering (without fg-obj): white decor at (0,0) must be hidden behind fg-blocker wall at (1,1)
    const wallOnlyRoom = RoomLayoutSchema.parse({
      schemaVersion: 1, id: "wall-order-test", tilePreset: "64x32", widthTiles: 3, depthTiles: 3,
      floors: [],
      walls: [
        { assetId: "w-back", tx: 0, ty: 0, edge: "nw" },
        { assetId: "fg-blocker", tx: 1, ty: 1, edge: "nw" },
      ],
      wallDecor: [{ assetId: "decor-bright", tx: 0, ty: 0, edge: "nw" }],
      objects: [],
    });
    const wallOnlyRes = renderRoom(
      wallOnlyRoom,
      new Map([["w-back", backWall], ["decor-bright", decor], ["fg-blocker", fgBlocker]]),
      palette,
      { emissiveMode: "baked" },
    );
    // White decor sits at (0,0) z=4..16; fg-blocker is 16x16x22 at (1,1) which fully covers (0,0) z=0..16 in screen space
    let visibleWhitePixels = 0;
    for (let i = 0; i < wallOnlyRes.main.data.length; i += 4) {
      if (wallOnlyRes.main.data[i] > 210 && wallOnlyRes.main.data[i + 1] > 210 && wallOnlyRes.main.data[i + 2] > 210) {
        visibleWhitePixels++;
      }
    }
    expect(visibleWhitePixels).toBe(0);
  });
});
