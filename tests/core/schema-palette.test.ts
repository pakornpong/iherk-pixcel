import { describe, it, expect } from "vitest";
import { PixcelAssetSchema, RoomLayoutSchema } from "../../src/core/schema.js";
import {
  parseHexColor,
  parseHexListPalette,
  buildShadeRamp,
  findNearestPaletteColor,
  loadPalette,
} from "../../src/core/palette.js";

describe("schema and palette", () => {
  it("validates a minimal asset with Phase 2 parts/partTransforms hooks", () => {
    const parsed = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "desk-test",
      category: "furniture",
      layer: "object",
      outlineMode: "silhouette",
      tilePreset: "64x32",
      voxelsPerTile: 32,
      footprintTiles: [2, 1],
      palette: "office-night",
      materials: { wood: { color: "#4b3121", kind: "wood" } },
      parts: { top: { pivot: [0, 0, 14] } },
      ops: [{ op: "box", from: [0, 0, 0], to: [1, 1, 1], material: "wood", part: "top" }],
      frames: [{ name: "idle_0", durationMs: 500, ops: [], partTransforms: { top: { translate: [0, 0, 0] } } }],
    });
    expect(parsed.footprintTiles).toEqual([2, 1]);
  });

  it("rejects invalid asset IDs containing path traversal", () => {
    expect(() =>
      PixcelAssetSchema.parse({
        schemaVersion: 1,
        id: "../evil",
        materials: { a: { color: "#ffffff", kind: "matte" } },
        ops: [],
      }),
    ).toThrow();
  });

  it("produces luminance-ordered hue-shifted shade ramps (highlight > base > shadow > deepShadow > outline)", () => {
    const ramp = buildShadeRamp("#4b3121", "wood");
    const lum = ([r, g, b]: [number, number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    expect(lum(ramp.highlight)).toBeGreaterThan(lum(ramp.base));
    expect(lum(ramp.base)).toBeGreaterThan(lum(ramp.shadow));
    expect(lum(ramp.shadow)).toBeGreaterThan(lum(ramp.deepShadow));
    expect(lum(ramp.deepShadow)).toBeGreaterThanOrEqual(lum(ramp.outline));
  });

  it("parses .hex / Lospec palettes and matches nearest color", () => {
    const pal = parseHexListPalette("lospec-sample", "#0a0e1a\n38bdf8\n#4b3121\n");
    expect(Object.keys(pal.colors)).toHaveLength(3);
    const match = findNearestPaletteColor([50, 185, 250], pal);
    expect(match.hex.toLowerCase()).toBe("#38bdf8");
  });

  it("loads built-in office-night and office-day palettes and rejects invalid hex", async () => {
    const night = await loadPalette("office-night");
    const day = await loadPalette("office-day");
    expect(Object.keys(night.colors).length).toBeGreaterThanOrEqual(16);
    expect(Object.keys(day.colors).length).toBeGreaterThanOrEqual(12);
    expect(() => parseHexColor("not-a-color")).toThrow();
  });

  it("validates layered room layout schema", () => {
    const room = RoomLayoutSchema.parse({
      schemaVersion: 1,
      id: "test-room",
      tilePreset: "64x32",
      widthTiles: 4,
      depthTiles: 4,
      floors: [{ assetId: "floor-wood-plank", tx: 0, ty: 0 }],
      walls: [{ assetId: "wall-slate-plain", tx: 0, ty: 0, edge: "nw" }],
      wallDecor: [{ assetId: "whiteboard-arch", tx: 1, ty: 0, edge: "nw" }],
      objects: [{ assetId: "desk-dev-dual", tx: 1, ty: 1, direction: "se" }],
    });
    expect(room.objects[0].direction).toBe("se");
  });
});
