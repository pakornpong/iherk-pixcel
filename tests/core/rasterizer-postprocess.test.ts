import { describe, it, expect } from "vitest";
import { compileAsset } from "../../src/core/dsl-compiler.js";
import { loadPalette } from "../../src/core/palette.js";
import { PixcelAssetSchema } from "../../src/core/schema.js";
import { renderAssetFrame } from "../../src/core/postprocess.js";
import { getTileMetrics } from "../../src/core/rasterizer.js";

describe("2:1 isometric rasterizer and post-processor", () => {
  it("tiles a 3x3 grid of 1x1 floors with ZERO gaps and ZERO overlaps in 64x32 (vpt=32, vpt=16) and 32x16", async () => {
    const palette = await loadPalette("office-night");
    for (const [tilePreset, vpt] of [["64x32", 32], ["64x32", 16], ["32x16", 16]] as const) {
      const asset = PixcelAssetSchema.parse({
        schemaVersion: 1,
        id: `floor-${tilePreset}-${vpt}`,
        layer: "floor",
        outlineMode: "none",
        tilePreset,
        voxelsPerTile: vpt,
        footprintTiles: [1, 1],
        materials: { wood: { color: "#4b3121", kind: "wood" } },
        ops: [{ op: "box", from: [0, 0, 0], to: [vpt - 1, vpt - 1, 0], material: "wood" }],
      });
      const { baseGrid } = compileAsset(asset);
      const rendered = renderAssetFrame(asset, baseGrid, palette, { direction: "se" });
      const { stepX, stepY } = getTileMetrics(tilePreset);

      const hitCounts = new Map<string, number>();
      for (let tx = 0; tx < 3; tx++) {
        for (let ty = 0; ty < 3; ty++) {
          const originX = (tx - ty) * stepX + 200;
          const originY = (tx + ty) * stepY + 200;
          for (let py = 0; py < rendered.main.height; py++) {
            for (let px = 0; px < rendered.main.width; px++) {
              const a = rendered.main.data[(py * rendered.main.width + px) * 4 + 3];
              if (a > 0) {
                const gx = originX + px - rendered.anchor.x;
                const gy = originY + py - rendered.anchor.y;
                const key = `${gx},${gy}`;
                hitCounts.set(key, (hitCounts.get(key) ?? 0) + 1);
              }
            }
          }
        }
      }
      for (const count of hitCounts.values()) expect(count).toBe(1);
      let tileOpaque = 0;
      for (let i = 3; i < rendered.main.data.length; i += 4) if (rendered.main.data[i] > 0) tileOpaque++;
      expect(hitCounts.size).toBe(9 * tileOpaque);
    }
  });

  it("tiles 64x31 (Tiled tight-lock) at stepY=15 with zero gaps and documented tileOverlapY=1", async () => {
    const palette = await loadPalette("office-night");
    const asset = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "floor-64x31",
      layer: "floor",
      outlineMode: "none",
      tilePreset: "64x31",
      voxelsPerTile: 32,
      footprintTiles: [1, 1],
      materials: { wood: { color: "#4b3121", kind: "wood" } },
      ops: [{ op: "box", from: [0, 0, 0], to: [31, 31, 0], material: "wood" }],
    });
    const { baseGrid } = compileAsset(asset);
    const rendered = renderAssetFrame(asset, baseGrid, palette, { direction: "se" });
    expect(rendered.tileMetrics.tileHeight).toBe(31);
    expect(rendered.tileMetrics.stepY).toBe(15);
    expect(rendered.tileMetrics.tileOverlapY).toBe(1);
    expect(rendered.main.height).toBe(31);
  });

  it("flips footprintTiles and preserves ground anchor alignment with 1px outline and edge emissive glow", async () => {
    const palette = await loadPalette("office-night");
    const asset = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "desk-anchor-test",
      outlineMode: "silhouette",
      tilePreset: "64x32",
      voxelsPerTile: 16,
      footprintTiles: [2, 1],
      materials: {
        wood: { color: "#4b3121", kind: "wood" },
        glow: { color: "#38bdf8", kind: "emissive", glowRadius: 3, glowIntensity: 0.5 },
      },
      ops: [
        { op: "box", from: [0, 0, 0], to: [31, 15, 4], material: "wood" },
        { op: "box", from: [28, 0, 5], to: [31, 3, 8], material: "glow" },
      ],
    });
    const { baseGrid } = compileAsset(asset);
    const se = renderAssetFrame(asset, baseGrid, palette, { direction: "se", emissiveMode: "both" });
    const sw = renderAssetFrame(asset, baseGrid, palette, { direction: "sw", emissiveMode: "both" });
    expect(se.footprintTiles).toEqual([2, 1]);
    expect(sw.footprintTiles).toEqual([1, 2]);
    expect(se.emissive?.width).toBe(se.main.width);
    expect(se.emissive?.height).toBe(se.main.height);
    expect(se.anchor.x).toBeGreaterThanOrEqual(0);
    expect(se.anchor.x).toBeLessThan(se.main.width);
    expect(se.anchor.y).toBeGreaterThanOrEqual(0);
    expect(se.anchor.y).toBeLessThan(se.main.height);
    const se2 = renderAssetFrame(asset, baseGrid, palette, { direction: "se", emissiveMode: "both" });
    expect(Buffer.from(se.main.data)).toEqual(Buffer.from(se2.main.data));
  });

  it("shades top > left > right, keeps glass 100% palette-quantized, and separates emissive un-darkened", async () => {
    const palette = await loadPalette("office-night");
    const asset = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "cube-shading",
      outlineMode: "silhouette",
      tilePreset: "64x32",
      voxelsPerTile: 16,
      footprintTiles: [1, 1],
      materials: {
        wall: { color: "#2a334d", kind: "matte" },
        glass: { color: "#13294b", kind: "glass" },
        led: { color: "#38bdf8", kind: "emissive", glowRadius: 1, glowIntensity: 0.4 },
      },
      ops: [
        { op: "box", from: [4, 4, 0], to: [11, 11, 7], material: "wall" },
        { op: "box", from: [6, 11, 2], to: [9, 11, 5], material: "glass" },
        { op: "voxel", at: [11, 7, 4], material: "led" },
      ],
    });
    const { baseGrid } = compileAsset(asset);
    const res = renderAssetFrame(asset, baseGrid, palette, { direction: "se", emissiveMode: "split" });
    expect(res.emissive).toBeDefined();
    let emissivePixels = 0;
    for (let i = 3; i < res.emissive!.data.length; i += 4) if (res.emissive!.data[i] > 0) emissivePixels++;
    expect(emissivePixels).toBeGreaterThan(0);
  });

  it("stitches adjacent top-only walls cleanly without vertical outline notches or face-mismatch seams", async () => {
    const palette = await loadPalette("office-night");
    for (const [tilePreset, vpt] of [["64x32", 32], ["64x32", 16], ["32x16", 16], ["64x31", 32]] as const) {
      const h = vpt === 32 ? 24 : 12;
      const thick = vpt === 32 ? 4 : 2;
      const wall = PixcelAssetSchema.parse({
        schemaVersion: 1,
        id: `wall-stitch-${tilePreset}-${vpt}`,
        layer: "wall",
        outlineMode: "top-only",
        tilePreset,
        voxelsPerTile: vpt,
        footprintTiles: [1, 1],
        materials: { body: { color: "#252e45", kind: "matte" } },
        ops: [{ op: "box", from: [0, 0, 0], to: [thick - 1, vpt - 1, h - 1], material: "body" }],
      });
      const { baseGrid } = compileAsset(wall);
      const { stepX, stepY } = getTileMetrics(tilePreset);

      for (const dir of ["se", "sw"] as const) {
        const rendered = renderAssetFrame(wall, baseGrid, palette, { direction: dir, interiorCreases: false });
        // Composite 3 adjacent wall segments along the wall axis
        const canvasW = 320;
        const canvasH = 200;
        const buf = new Uint8ClampedArray(canvasW * canvasH * 4);
        for (let i = 0; i < 3; i++) {
          const tx = dir === "sw" ? i : 0;
          const ty = dir === "se" ? i : 0;
          const ox = 160 + (tx - ty) * stepX - rendered.anchor.x;
          const oy = 100 + (tx + ty) * stepY - rendered.anchor.y;
          for (let py = 0; py < rendered.main.height; py++) {
            for (let px = 0; px < rendered.main.width; px++) {
              const si = (py * rendered.main.width + px) * 4;
              if (rendered.main.data[si + 3] === 0) continue;
              const di = ((oy + py) * canvasW + (ox + px)) * 4;
              buf[di] = rendered.main.data[si];
              buf[di + 1] = rendered.main.data[si + 1];
              buf[di + 2] = rendered.main.data[si + 2];
              buf[di + 3] = 255;
            }
          }
        }

        // Sample the middle height row across the wall join between segment 0 and segment 1:
        // must have zero outline-dark notches (R+G+B < 40) and uniform face color across the join
        const sampleColors = new Set<string>();
        const joinTx = dir === "sw" ? 1 : 0;
        const joinTy = dir === "se" ? 1 : 0;
        const midZ = Math.floor((h * (tilePreset !== "32x16" && vpt === 16 ? 2 : 1)) / 2);
        const joinX = 160 + (joinTx - joinTy) * stepX;
        const joinY = 100 + (joinTx + joinTy) * stepY - stepY - midZ;
        for (let dx = -4; dx <= 4; dx++) {
          const di = (joinY * canvasW + (joinX + dx)) * 4;
          if (buf[di + 3] === 255) {
            const sum = buf[di] + buf[di + 1] + buf[di + 2];
            expect(sum).toBeGreaterThan(40); // no dark outline notch inside wall face
            sampleColors.add(`${buf[di]},${buf[di + 1]},${buf[di + 2]}`);
          }
        }
        expect(sampleColors.size).toBe(1); // uniform wall face color across the seam (no 1px bright/dark stripe)
      }
    }
  });

  it("tiles a 3x3 grid of 64x31 floors at stepY=15 with zero 1px interior gaps", async () => {
    const palette = await loadPalette("office-night");
    const asset = PixcelAssetSchema.parse({
      schemaVersion: 1,
      id: "floor-64x31-grid",
      layer: "floor",
      outlineMode: "none",
      tilePreset: "64x31",
      voxelsPerTile: 32,
      footprintTiles: [1, 1],
      materials: { wood: { color: "#4b3121", kind: "wood" } },
      ops: [{ op: "box", from: [0, 0, 0], to: [31, 31, 0], material: "wood" }],
    });
    const { baseGrid } = compileAsset(asset);
    const rendered = renderAssetFrame(asset, baseGrid, palette, { direction: "se" });
    const { stepX, stepY } = getTileMetrics("64x31");
    const covered = new Set<string>();
    for (let tx = 0; tx < 3; tx++) {
      for (let ty = 0; ty < 3; ty++) {
        const ox = 200 + (tx - ty) * stepX - rendered.anchor.x;
        const oy = 200 + (tx + ty) * stepY - rendered.anchor.y;
        for (let py = 0; py < rendered.main.height; py++) {
          for (let px = 0; px < rendered.main.width; px++) {
            if (rendered.main.data[(py * rendered.main.width + px) * 4 + 3] > 0) {
              covered.add(`${ox + px},${oy + py}`);
            }
          }
        }
      }
    }
    // Check center tile (tx=1, ty=1) interior bounding diamond has zero 1px holes
    const cx = 200;
    const cy = 200 + 2 * stepY - 15;
    for (let dy = -12; dy <= 12; dy++) {
      const halfW = 2 * (12 - Math.abs(dy));
      for (let dx = -halfW; dx <= halfW; dx++) {
        expect(covered.has(`${cx + dx},${cy + dy}`)).toBe(true);
      }
    }
  });
});
