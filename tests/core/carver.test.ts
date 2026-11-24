import { describe, it, expect } from "vitest";
import { createRGBAImage } from "../../src/core/exporters/png.js";
import { loadPalette } from "../../src/core/palette.js";
import { carveFromOrthographicViews } from "../../src/core/carver.js";
import { compileAsset } from "../../src/core/dsl-compiler.js";

function paintRect(
  img: ReturnType<typeof createRGBAImage>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgba: [number, number, number, number],
) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * img.width + x) * 4;
      img.data[i] = rgba[0];
      img.data[i + 1] = rgba[1];
      img.data[i + 2] = rgba[2];
      img.data[i + 3] = rgba[3];
    }
  }
}

describe("2D-to-3D orthographic carver", () => {
  it("carves an L-shaped 3D model from front + side + top PNG views and box-merges into compact ops", async () => {
    const palette = await loadPalette("office-night");
    const front = createRGBAImage(8, 8);
    const side = createRGBAImage(8, 8);
    const top = createRGBAImage(8, 8);
    paintRect(front, 0, 0, 7, 7, [75, 49, 33, 255]);
    paintRect(side, 0, 0, 7, 7, [75, 49, 33, 255]);
    paintRect(top, 0, 0, 7, 3, [75, 49, 33, 255]);
    paintRect(top, 0, 4, 3, 7, [56, 189, 248, 255]);

    const asset = carveFromOrthographicViews({ front, side, top }, { id: "carved-l", palette, voxelsPerTile: 16 });
    const { baseGrid } = compileAsset(asset);
    expect(baseGrid.has(6, 1, 4)).toBe(true);
    expect(baseGrid.has(6, 6, 4)).toBe(false);
    expect(baseGrid.has(1, 6, 4)).toBe(true);
    expect(asset.ops.length).toBeLessThan(baseGrid.size);
  });

  it("supports 1-view extrusion with configurable depth and rejects empty/mismatched views", async () => {
    const palette = await loadPalette("office-night");
    const front = createRGBAImage(4, 4);
    paintRect(front, 1, 1, 2, 2, [56, 189, 248, 255]);
    const extruded = carveFromOrthographicViews({ front }, { id: "sign-extruded", palette, depth: 3 });
    const { baseGrid } = compileAsset(extruded);
    expect(baseGrid.size).toBe(2 * 2 * 3);

    const empty = createRGBAImage(4, 4);
    expect(() => carveFromOrthographicViews({ front: empty }, { id: "empty", palette })).toThrow(/opaque/i);

    const badSide = createRGBAImage(4, 10);
    expect(() => carveFromOrthographicViews({ front, side: badSide }, { id: "bad", palette })).toThrow(/dimension|height/i);
  });
});
