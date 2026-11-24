import { parseHexColor } from "../palette.js";
import type { PixcelAsset } from "../schema.js";
import type { VoxelGrid } from "../voxel-grid.js";
import { createRGBAImage, type RGBAImage } from "./png.js";

export function exportSpriteStack(grid: VoxelGrid, asset: PixcelAsset): RGBAImage {
  const bounds = grid.getBounds();
  if (!bounds) {
    return createRGBAImage(1, 1);
  }
  const sliceW = bounds.maxX - bounds.minX + 1;
  const sliceH = bounds.maxY - bounds.minY + 1;
  const layersZ = bounds.maxZ - bounds.minZ + 1;

  const img = createRGBAImage(sliceW * layersZ, sliceH);
  for (const [x, y, z, cell] of grid.entries()) {
    const mat = asset.materials[cell.material];
    if (!mat) continue;
    const rgba = parseHexColor(mat.color);
    const lx = x - bounds.minX;
    const ly = y - bounds.minY;
    const lz = z - bounds.minZ;
    const px = lz * sliceW + lx;
    const py = ly;
    const idx = (py * img.width + px) * 4;
    img.data[idx] = rgba[0];
    img.data[idx + 1] = rgba[1];
    img.data[idx + 2] = rgba[2];
    img.data[idx + 3] = 255;
  }
  return img;
}
