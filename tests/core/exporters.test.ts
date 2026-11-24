import { describe, it, expect } from "vitest";
import { compileAsset } from "../../src/core/dsl-compiler.js";
import { loadPalette } from "../../src/core/palette.js";
import { PixcelAssetSchema, AtlasSchema } from "../../src/core/schema.js";
import { renderAssetFrame } from "../../src/core/postprocess.js";
import { encodePNG, decodePNG } from "../../src/core/exporters/png.js";
import { packSpriteAtlas } from "../../src/core/exporters/atlas.js";
import { encodeAnimatedGIF } from "../../src/core/exporters/gif.js";
import { exportSpriteStack } from "../../src/core/exporters/sprite-stack.js";
import { exportObjMtl } from "../../src/core/exporters/obj.js";

describe("exporters", () => {
  it("packs TexturePacker JSON Hash atlas with matching emissive sheet rects and pivots", async () => {
    const palette = await loadPalette("office-night");
    const asset = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "server-mini",
      footprintTiles: [1, 1],
      voxelsPerTile: 16,
      materials: {
        body: { color: "#171c26", kind: "metal" },
        led: { color: "#22c55e", kind: "emissive", glowRadius: 1, glowIntensity: 0.4 },
      },
      ops: [
        { op: "box", from: [2, 2, 0], to: [13, 13, 10], material: "body" },
        { op: "voxel", at: [13, 5, 8], material: "led" },
      ],
      frames: [
        { name: "f0", durationMs: 400, ops: [] },
        { name: "f1", durationMs: 400, ops: [{ op: "voxel", at: [13, 9, 8], material: "led" }] },
      ],
    });
    const { frames } = compileAsset(asset);
    const sprites = frames.map((f) => {
      const r = renderAssetFrame(asset, f.grid, palette, { direction: "se", emissiveMode: "both" });
      return {
        key: `${asset.id}/se/${f.name}`,
        assetId: asset.id,
        direction: "se" as const,
        frameName: f.name,
        durationMs: f.durationMs,
        layer: asset.layer,
        footprintTiles: r.footprintTiles,
        anchor: r.anchor,
        image: r.main,
        emissive: r.emissive,
      };
    });

    const packed = packSpriteAtlas(sprites, {
      imageName: "atlas.png",
      emissiveImageName: "atlas_emissive.png",
      tilePreset: "64x32",
    });
    const parsedAtlas = AtlasSchema.parse(packed.atlas);
    expect(parsedAtlas.meta.image).toBe("atlas.png");
    expect(parsedAtlas.meta.emissiveImage).toBe("atlas_emissive.png");
    expect(packed.emissiveSheet?.width).toBe(packed.sheet.width);
    expect(packed.emissiveSheet?.height).toBe(packed.sheet.height);
    const decoded = decodePNG(encodePNG(packed.sheet));
    expect(decoded.width).toBe(packed.sheet.width);

    const gif = encodeAnimatedGIF(sprites.map((s) => ({ image: s.image, durationMs: s.durationMs })));
    expect(gif.subarray(0, 6).toString("ascii")).toBe("GIF89a");

    const stack = exportSpriteStack(frames[0].grid, asset);
    expect(stack.width).toBeGreaterThan(0);
    expect(stack.height).toBeGreaterThan(0);

    const { obj, mtl } = exportObjMtl(frames[0].grid, asset, "server-mini.mtl");
    expect(obj).toContain("mtllib server-mini.mtl");
    expect(obj).toContain("usemtl body");
    expect(mtl).toContain("newmtl led");
  });
});
